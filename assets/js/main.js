/*
  main.js — site behaviour for the RASIN presentation:
  theme (light/dark, synced into same-origin iframes), language (ar/en from assets/i18n),
  section navigation (current-section highlight, mobile dropdown) and presentation mode
  (fullscreen, keyboard paging, "n / 8" progress).
*/
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  /* ---------------- Toast ---------------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }

  /* ---------------- i18n ---------------- */
  var dicts = {};
  function t(key) {
    var d = dicts[root.lang] || {};
    return d[key] != null ? d[key] : key;
  }

  function loadDict(lang) {
    if (dicts[lang]) return Promise.resolve(dicts[lang]);
    var fallback = function () {
      var b = window.RASIN_I18N && window.RASIN_I18N[lang];
      if (b) dicts[lang] = b;
      return dicts[lang] || null;
    };
    // fetch works over http (Live Server, GitHub Pages); on file:// it is blocked, so use the bundled copy.
    if (location.protocol === 'file:' || !window.fetch) return Promise.resolve(fallback());
    return fetch('assets/i18n/' + lang + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { dicts[lang] = j; return j; })
      .catch(fallback);
  }

  function applyDict(d) {
    if (!d) return;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = d[el.getAttribute('data-i18n')];
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var v = d[el.getAttribute('data-i18n-aria')];
      if (v != null) el.setAttribute('aria-label', v);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var v = d[el.getAttribute('data-i18n-title')];
      if (v != null) el.setAttribute('title', v);
    });
  }

  function setLang(lang) {
    return loadDict(lang).then(function (d) {
      if (!d) { toast('Language file could not be loaded.'); return; }
      root.lang = lang;
      root.dir = lang === 'ar' ? 'rtl' : 'ltr';
      applyDict(d);
      store('rasin-lang', lang);
      refreshToolLabels();
      updateNavToggle();
      fitNav();
    });
  }

  /* ---------------- Theme ---------------- */
  function syncFrameTheme(frame, theme) {
    try {
      var doc = frame.contentDocument;
      if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', theme);
    } catch (e) { /* cross-origin (e.g. file://) — ignore silently */ }
  }
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    store('rasin-theme', theme);
    document.querySelectorAll('iframe').forEach(function (f) { syncFrameTheme(f, theme); });
    refreshToolLabels();
  }
  document.querySelectorAll('iframe').forEach(function (f) {
    f.addEventListener('load', function () { syncFrameTheme(f, root.getAttribute('data-theme')); });
  });
  // Follow the OS setting until the user picks a theme explicitly.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    var saved = null;
    try { saved = localStorage.getItem('rasin-theme'); } catch (err) {}
    if (!saved) {
      var th = e.matches ? 'dark' : 'light';
      root.setAttribute('data-theme', th);
      document.querySelectorAll('iframe').forEach(function (f) { syncFrameTheme(f, th); });
      refreshToolLabels();
    }
  });

  /* ---------------- Tool buttons ---------------- */
  var themeBtn = document.getElementById('themeBtn');
  var langBtn = document.getElementById('langBtn');
  var langGlyph = document.getElementById('langGlyph');
  var presentBtn = document.getElementById('presentBtn');

  function refreshToolLabels() {
    var dark = root.getAttribute('data-theme') === 'dark';
    themeBtn.setAttribute('aria-label', t(dark ? 'ui.themeToLight' : 'ui.themeToDark'));
    themeBtn.title = themeBtn.getAttribute('aria-label');
    // The glyph names the language you switch *to*.
    langGlyph.textContent = root.lang === 'ar' ? 'EN' : 'ع';
    langBtn.setAttribute('aria-label', root.lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    langBtn.title = langBtn.getAttribute('aria-label');
    var on = root.classList.contains('is-presenting');
    presentBtn.setAttribute('aria-label', t(on ? 'ui.presentExit' : 'ui.present'));
    presentBtn.title = presentBtn.getAttribute('aria-label');
  }

  themeBtn.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  langBtn.addEventListener('click', function () {
    setLang(root.lang === 'ar' ? 'en' : 'ar');
  });

  /* ---------------- Sections & nav ---------------- */
  var sections = Array.prototype.slice.call(document.querySelectorAll('main > .sec'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('#navList a'));
  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  var navToggleNum = document.getElementById('navToggleNum');
  var navToggleLabel = document.getElementById('navToggleLabel');
  var current = 0;

  function updateNavToggle() {
    var link = navLinks[current];
    if (!link) return;
    navToggleNum.textContent = String(current + 1).padStart(2, '0');
    var label = link.querySelector('[data-i18n]');
    navToggleLabel.setAttribute('data-i18n', label.getAttribute('data-i18n'));
    navToggleLabel.textContent = label.textContent;
    navToggle.setAttribute('aria-label', t('nav.toggle') + ': ' + label.textContent);
  }

  function setCurrent(i) {
    if (i < 0 || i >= sections.length) return;
    current = i;
    navLinks.forEach(function (a, j) {
      if (j === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    updateNavToggle();
    updateProgress();
  }

  // The section crossing a line ~40% down the viewport is the current one.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) setCurrent(sections.indexOf(en.target));
      });
    }, { rootMargin: '-40% 0px -59% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  // Switch to the dropdown whenever the inline links would overflow the bar.
  function fitNav() {
    nav.classList.add('is-measuring');
    nav.classList.remove('is-compact');
    var list = document.getElementById('navList');
    var tooWide = window.innerWidth <= 900 || list.scrollWidth > nav.clientWidth + 1;
    nav.classList.toggle('is-compact', tooWide);
    nav.classList.remove('is-measuring');
    if (!tooWide) closeNav();
  }
  window.addEventListener('resize', fitNav);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitNav);
  fitNav();

  function closeNav() {
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
  navToggle.addEventListener('click', function () {
    var open = !nav.classList.contains('is-open');
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      var a = navLinks[current] || navLinks[0];
      a.focus();
    }
  });
  navLinks.forEach(function (a) { a.addEventListener('click', closeNav); });
  document.addEventListener('click', function (e) { if (!nav.contains(e.target)) closeNav(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { closeNav(); navToggle.focus(); }
  });

  function goTo(i) {
    i = Math.max(0, Math.min(sections.length - 1, i));
    sections[i].scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    setCurrent(i);
  }

  /* ---------------- Presentation mode ---------------- */
  var progressTicks = document.getElementById('progressTicks');
  var progressText = document.getElementById('progressText');
  sections.forEach(function () { progressTicks.appendChild(document.createElement('i')); });

  function updateProgress() {
    progressText.textContent = (current + 1) + ' / ' + sections.length;
    Array.prototype.forEach.call(progressTicks.children, function (el, j) { el.classList.toggle('on', j <= current); });
  }

  var fsGranted = false;
  function enterPresent() {
    root.classList.add('is-presenting');
    presentBtn.setAttribute('aria-pressed', 'true');
    refreshToolLabels();
    updateProgress();
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) { toast(t('ui.fullscreenDenied')); return; }
    try {
      var p = req.call(root);
      if (p && p.then) {
        p.then(function () { fsGranted = true; })
         .catch(function () { toast(t('ui.fullscreenDenied')); });
      } else { fsGranted = true; }
    } catch (e) { toast(t('ui.fullscreenDenied')); }
  }
  function exitPresent() {
    root.classList.remove('is-presenting');
    presentBtn.setAttribute('aria-pressed', 'false');
    refreshToolLabels();
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      var ex = document.exitFullscreen || document.webkitExitFullscreen;
      try { var p = ex.call(document); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    fsGranted = false;
  }
  presentBtn.addEventListener('click', function () {
    if (root.classList.contains('is-presenting')) exitPresent(); else enterPresent();
  });
  // Leaving fullscreen with Esc also ends presentation mode.
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl && fsGranted && root.classList.contains('is-presenting')) exitPresent();
    });
  });

  // Vertical keys page through a tall section first, then move to the next one;
  // horizontal arrows always jump a whole section (direction-aware for RTL).
  function step(dir, wholeSection) {
    var sec = sections[current];
    var r = sec.getBoundingClientRect();
    var vh = window.innerHeight;
    var hdr = document.getElementById('topbar').offsetHeight;
    var behavior = reduceMotion.matches ? 'auto' : 'smooth';
    if (!wholeSection) {
      if (dir > 0 && r.bottom > vh + 40) {
        window.scrollBy({ top: Math.min(r.bottom - vh, (vh - hdr) * 0.85), behavior: behavior });
        return;
      }
      if (dir < 0 && r.top < hdr - 40) {
        window.scrollBy({ top: -Math.min(hdr - r.top, (vh - hdr) * 0.85), behavior: behavior });
        return;
      }
    }
    goTo(current + dir);
  }

  document.addEventListener('keydown', function (e) {
    if (!root.classList.contains('is-presenting')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    // Let Space activate a focused button/link instead of paging.
    if (e.key === ' ' && tg && /^(BUTTON|A|SUMMARY)$/.test(tg.tagName)) return;

    var rtl = root.dir === 'rtl';
    var dir = 0, whole = false;
    switch (e.key) {
      case 'PageDown': case 'ArrowDown': dir = 1; break;
      case 'PageUp': case 'ArrowUp': dir = -1; break;
      case ' ': dir = e.shiftKey ? -1 : 1; break;
      case 'ArrowLeft': dir = rtl ? 1 : -1; whole = true; break;
      case 'ArrowRight': dir = rtl ? -1 : 1; whole = true; break;
      case 'Home': e.preventDefault(); goTo(0); return;
      case 'End': e.preventDefault(); goTo(sections.length - 1); return;
      default: return;
    }
    e.preventDefault();
    step(dir, whole);
  });

  /* ---------------- Hero background model ---------------- */
  var heroBg = document.getElementById('heroBg');
  var heroFrame = document.getElementById('heroFrame');
  if (heroFrame) {
    heroFrame.addEventListener('load', function () { heroBg.classList.add('is-live'); });
    heroFrame.addEventListener('error', function () { heroFrame.remove(); });
  }

  /* ---------------- Reveal: SEC-08 red line draws in once the section is in view ---------------- */
  var national = document.querySelector('.sec-national');
  if (national) {
    if ('IntersectionObserver' in window && !reduceMotion.matches) {
      var nio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { national.classList.add('in-view'); nio.disconnect(); }
        });
      }, { threshold: 0.35 });
      nio.observe(national);
    } else {
      national.classList.add('in-view');
    }
  }

  /* ---------------- Init ---------------- */
  // Arabic is inline in the HTML; load its dictionary too so switching back works.
  loadDict('ar').then(function () {
    if (root.lang === 'en') return setLang('en');
    refreshToolLabels();
    updateNavToggle();
  });
  refreshToolLabels();
  setCurrent(0);
})();
