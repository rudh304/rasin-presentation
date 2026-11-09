/*
  main.js — site behaviour for the RASIN presentation:
  theme (light/dark, synced into same-origin iframes), language (ar/en from assets/i18n),
  section navigation (current-section highlight, mobile dropdown) and presentation mode
  (fullscreen, keyboard paging, "n / 10" progress).
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
      document.dispatchEvent(new Event('rasin:lang'));   // let text built by script re-render
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

  /* ---------------- Reveal: SEC-09 red line draws in once the section is in view ---------------- */
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

  /* ---------------- SEC-04 strategies: CIA filter dims the cards that do not support the chosen goal ---------------- */
  var strats = document.getElementById('strats');
  if (strats) {
    var fbtns = document.querySelectorAll('.strat-fbtn');
    fbtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-f');
        if (f === 'all') strats.removeAttribute('data-filter'); else strats.setAttribute('data-filter', f);
        fbtns.forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      });
    });
  }

  /* ---------------- Reveal: SEC-08 phrase boxes rise in once when they enter view; siblings are staggered ---------------- */
  var revealSel = '.takeaways li, .nogap, .nogap-steps li';
  var boxes = document.querySelectorAll(revealSel);
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in-view'); rio.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    boxes.forEach(function (el) {
      var i = Array.prototype.indexOf.call(el.parentNode.children, el);
      el.style.setProperty('--rv-i', Math.min(i, 3));
      el.classList.add('rv');
      rio.observe(el);
    });
  } else {
    boxes.forEach(function (el) { el.classList.add('in-view'); });
  }

  /* ---------------- SEC-05 function words: one shared note, opened from the pressed word ---------------- */
  var fnPop = document.getElementById('fnPop');
  if (fnPop) {
    var fnTitle = fnPop.querySelector('.fn-pop-t');
    var fnDesc = fnPop.querySelector('.fn-pop-d');
    var fnOff = fnPop.querySelector('.fn-pop-off');
    var fnOpen = null;
    var fnHovered = false;   // opened by mouse hover (closes on leave) rather than pinned by a click
    var fnTimer = null;
    var closeFn = function () {
      clearTimeout(fnTimer);
      fnPop.hidden = true;
      if (fnOpen) fnOpen.setAttribute('aria-expanded', 'false');
      fnOpen = null;
      fnHovered = false;
    };
    var openFn = function (b) {
      closeFn();
      var k = 'fn.' + b.getAttribute('data-fn');
      // data-i18n keeps the open note in step with a language switch
      fnTitle.setAttribute('data-i18n', k);
      fnTitle.textContent = t(k);
      fnDesc.setAttribute('data-i18n', k + '.d');
      fnDesc.textContent = t(k + '.d');
      fnOff.hidden = b.parentNode.classList.contains('on');
      b.closest('.el-foot').appendChild(fnPop);
      fnPop.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      fnOpen = b;
    };
    var leaveFn = function (e) {
      if (e.pointerType !== 'mouse' || !fnHovered) return;
      // short delay so the mouse can cross the gap from the word to the note
      clearTimeout(fnTimer);
      fnTimer = setTimeout(closeFn, 150);
    };
    document.querySelectorAll('.fn-btn').forEach(function (b) {
      b.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(fnTimer);
        if (fnOpen === b) return;
        if (fnOpen && !fnHovered) return;   // leave a pinned note alone
        openFn(b);
        fnHovered = true;
      });
      b.addEventListener('pointerleave', leaveFn);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (fnOpen === b && fnHovered) { clearTimeout(fnTimer); fnHovered = false; return; }   // pin it
        if (fnOpen === b) { closeFn(); return; }
        openFn(b);
      });
    });
    fnPop.addEventListener('pointerenter', function () { clearTimeout(fnTimer); });
    fnPop.addEventListener('pointerleave', leaveFn);
    document.addEventListener('click', function (e) {
      if (fnOpen && !fnPop.contains(e.target)) closeFn();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fnOpen) { var b = fnOpen; closeFn(); b.focus(); }
    });
  }

  /* ---------------- "Why RASIN?" note ---------------- */
  var whyBtn = document.getElementById('whyBtn');
  var whyPop = document.getElementById('whyPop');
  if (whyBtn && whyPop) {
    var setWhy = function (open) {
      whyPop.hidden = !open;
      whyBtn.setAttribute('aria-expanded', String(open));
    };
    whyBtn.addEventListener('click', function (e) { e.stopPropagation(); setWhy(whyPop.hidden); });
    document.addEventListener('click', function (e) {
      if (!whyPop.hidden && !whyPop.contains(e.target)) setWhy(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !whyPop.hidden) { setWhy(false); whyBtn.focus(); }
    });
  }

  /* ---------------- SEC-06 intruder challenge: five layers, each attempt stopped by a real control ---------------- */
  // Option text lives in the i18n files as ch.sN.oM (+ .c control, .w why); `type` names the
  // SEC-05 system the control belongs to (its card title key), or ch.design for layout decisions.
  var CH_STEPS = [
    { z: 0, types: ['s4.c3.title', 's4.c1.title', 's4.c4.title'] },
    { z: 1, types: ['s4.c4.title', 'ch.design', 's4.c3.title'] },
    { z: 3, types: ['s4.c2.title', 'ch.design', 's4.c4.title'] },
    { z: 3, types: ['s4.c5.title', 's4.c5.title', 's4.c3.title'] },
    { z: 4, types: ['s4.c5.title', 's4.c5.title', 's4.c2.title'] }
  ];
  var chalOpen = document.getElementById('chalOpen');
  var chalBody = document.getElementById('chalBody');
  if (chalOpen && chalBody) {
    var ch = { step: 0, chosen: null, log: [] };
    var el = function (tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    var btn = function (cls, text, fn) {
      var b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    };
    var renderChal = function (focusSel) {
      chalBody.textContent = '';
      var total = CH_STEPS.length;
      if (ch.step >= total) {
        var end = el('div', 'chal-end');
        end.appendChild(el('h4', 'chal-q', t('ch.endTitle'))).tabIndex = -1;
        end.appendChild(el('p', 'chal-end-text', t('ch.endText')));
        end.appendChild(el('p', 'label', t('ch.endList')));
        var ul = el('ol', 'chal-log');
        ch.log.forEach(function (r) {
          var li = el('li');
          li.appendChild(el('span', 'chal-z cz' + r.z, 'Z' + r.z));
          li.appendChild(el('b', null, t(r.c)));
          li.appendChild(el('span', 'chal-type', t(r.type)));
          ul.appendChild(li);
        });
        end.appendChild(ul);
        var row = el('div', 'chal-actions');
        row.appendChild(btn('chal-btn', t('ch.again'), function () { ch = { step: 0, chosen: null, log: [] }; renderChal('.chal-q'); }));
        row.appendChild(btn('chal-btn chal-btn-ghost', t('ch.close'), function () { setChal(false); chalOpen.focus(); }));
        end.appendChild(row);
        chalBody.appendChild(end);
      } else {
        var s = CH_STEPS[ch.step], p = 'ch.s' + (ch.step + 1);
        var bar = el('ol', 'chal-steps');
        bar.setAttribute('aria-hidden', 'true');
        CH_STEPS.forEach(function (st, i) {
          bar.appendChild(el('li', 'cz' + st.z + (i < ch.step ? ' done' : i === ch.step ? ' now' : '')));
        });
        chalBody.appendChild(bar);
        var head = el('p', 'chal-layer');
        head.appendChild(el('span', 'chal-z cz' + s.z, 'Z' + s.z));
        head.appendChild(document.createTextNode(t('ch.layer') + ' ' + (ch.step + 1) + ' ' + t('ch.of') + ' ' + total + ' · ' + t(p + '.t')));
        chalBody.appendChild(head);
        chalBody.appendChild(el('h4', 'chal-q', t(p + '.q'))).tabIndex = -1;
        var opts = el('div', 'chal-opts');
        [1, 2, 3].forEach(function (o, i) {
          var b = btn('chal-opt', t(p + '.o' + o), function () {
            if (ch.chosen != null) return;
            ch.chosen = i;
            ch.log.push({ z: s.z, c: p + '.o' + o + '.c', type: s.types[i] });
            renderChal('.chal-res-t');
          });
          if (ch.chosen != null) {
            b.disabled = true;
            if (ch.chosen === i) b.classList.add('is-chosen');
          }
          opts.appendChild(b);
        });
        chalBody.appendChild(opts);
        if (ch.chosen != null) {
          var k = p + '.o' + (ch.chosen + 1);
          var res = el('div', 'chal-res');
          var rt = el('p', 'chal-res-t');
          rt.tabIndex = -1;
          rt.appendChild(el('span', 'chal-stop', t('ch.stopped')));
          rt.appendChild(document.createTextNode(' ' + t(k + '.c')));
          res.appendChild(rt);
          res.appendChild(el('p', 'chal-res-w', t(k + '.w')));
          res.appendChild(el('span', 'chal-type', t(s.types[ch.chosen])));
          chalBody.appendChild(res);
          var last = ch.step === total - 1;
          chalBody.appendChild(btn('chal-btn', t(last ? 'ch.finish' : 'ch.next'), function () {
            ch.step++; ch.chosen = null; renderChal('.chal-q');
          }));
        }
      }
      if (focusSel) { var f = chalBody.querySelector(focusSel); if (f) f.focus(); }
    };
    var setChal = function (open) {
      chalBody.hidden = !open;
      chalOpen.setAttribute('aria-expanded', String(open));
      chalOpen.querySelector('.chal-cta').textContent = t(open ? 'ch.close' : 'ch.start');
      chalOpen.querySelector('.chal-cta').setAttribute('data-i18n', open ? 'ch.close' : 'ch.start');
      if (open) renderChal('.chal-q');
    };
    chalOpen.addEventListener('click', function () { setChal(chalBody.hidden); });
    document.addEventListener('rasin:lang', function () { if (!chalBody.hidden) renderChal(); });
  }

  /* ---------------- Glossary: technical terms get a dotted underline and a short note ---------------- */
  // First mention per section only, so the page does not fill up with underlines.
  // Terms sit inside i18n text (textContent is replaced on a language switch), so they are re-marked after each switch.
  var TERMS = [
    { k: 'mantrap', ar: /Mantrap|(?:لل|ال)?غرف(?:ة)? (?:ال)?عازلة/, en: /mantraps?/i },
    { k: 'ups', ar: /\bUPS\b/, en: /\bUPS\b/ },
    { k: 'n1', ar: /N\+1/, en: /N\+1/ },
    { k: 'vesda', ar: /VESDA/, en: /VESDA/ },
    { k: 'ecc', ar: /\bECC(?:-2:2024)?/, en: /\bECC(?:-2:2024)?/ },
    { k: 'bms', ar: /\bBMS\b/, en: /\bBMS\b/ },
    { k: 'bollard', ar: /Bollards/, en: /[Bb]ollards?/ },
    { k: 'gas', ar: /(?:بال|ال)غاز النظيف/, en: /[Cc]lean-agent(?: gas)?/ },
    { k: '2fa', ar: /(?:ال)?تحقق (?:ال)?ثنائي|(?:ال)?قارئات (?:ال)?ثنائية|(?:ال)?قارئ (?:ال)?ثنائي/, en: /two-factor/i },
    { k: 'cia', ar: /ثلاثية CIA|\bCIA\b/, en: /CIA triad|\bCIA\b/ },
    { k: 'did', ar: /(?:ال)?دفاع في العمق/, en: /[Dd]efen[cs]e in [Dd]epth/ },
    { k: 'iso', ar: /ISO(?:\/IEC)? 27001(?::2022)?/, en: /ISO(?:\/IEC)? 27001(?::2022)?/ },
    { k: 'nist', ar: /NIST(?: SP 800-53)?/, en: /NIST(?: SP 800-53)?/ },
    { k: 'cool', ar: /(?:ال)?تبريد (?:ال)?دقيق/, en: /precision cooling/i },
    { k: 'desk', ar: /(?:ال)?مكتب (?:ال)?نظيف/, en: /clean[- ]desk/i },
    { k: 'matrix', ar: /مصفوفة (?:ال)?صلاحيات/, en: /(?:access|role|permissions) matrix/i },
    { k: 'iot', ar: /إنترنت الأشياء/, en: /Internet of Things/i },
    { k: 'conv', ar: /(?:ال)?تقارب بين الأمن المادي و(?:ال)?سيبراني/, en: /[Ss]ecurity [Cc]onvergence|convergence/ },
    { k: 'soc', ar: /مركز (?:ال)?عمليات(?: (?:ال)?أمنية)?/, en: /(?:security )?operations cent(?:er|re)/i },
    { k: 'iam', ar: /\bIAM\b/, en: /\bIAM\b/ },
    { k: 'epo', ar: /(?:مفتاح )?فصل الطاقة الطارئ/, en: /emergency power-off/i }
  ];
  var TERM_SKIP = 'a,button,svg,script,style,h1,h2,.term,.chal,.plate,.nca-badge,.fn-pop,.why-pop,.term-pop,.sub-latin,.ref-link,.sr-only,[hidden],html[lang="en"] .dup-en';
  var termPop = document.getElementById('termPop');
  function unmarkTerms() {
    document.querySelectorAll('main .term').forEach(function (s) {
      var p = s.parentNode;
      p.replaceChild(document.createTextNode(s.textContent), s);
      p.normalize();
    });
  }
  function markTerms() {
    unmarkTerms();
    var lang = root.lang === 'en' ? 'en' : 'ar';
    document.querySelectorAll('main > .sec').forEach(function (sec) {
      TERMS.forEach(function (term) {
        var re = term[lang];
        var walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, {
          acceptNode: function (n) {
            var p = n.parentElement;
            return p && !p.closest(TERM_SKIP) && re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        });
        var node = walker.nextNode();
        if (!node) return;
        var m = node.nodeValue.match(re);
        var hit = node.splitText(m.index);
        hit.splitText(m[0].length);
        var span = document.createElement('span');
        span.className = 'term';
        span.tabIndex = 0;
        span.setAttribute('data-term', term.k);
        span.textContent = hit.nodeValue;
        hit.parentNode.replaceChild(span, hit);
      });
    });
  }
  if (termPop) {
    var termNow = null;
    var termTimer = null;
    var showTerm = function (span) {
      clearTimeout(termTimer);
      if (termNow && termNow !== span) termNow.removeAttribute('aria-describedby');
      var k = 'gl.' + span.getAttribute('data-term');
      termPop.querySelector('.term-pop-t').textContent = t(k + '.t');
      termPop.querySelector('.term-pop-d').textContent = t(k + '.d');
      termPop.hidden = false;
      span.setAttribute('aria-describedby', 'termPop');
      termNow = span;
      var r = span.getBoundingClientRect(), pw = termPop.offsetWidth, ph = termPop.offsetHeight;
      var top = r.top - ph - 8 < 8 ? r.bottom + 8 : r.top - ph - 8;
      var left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
      termPop.style.top = top + 'px';
      termPop.style.left = left + 'px';
    };
    var hideTerm = function () {
      clearTimeout(termTimer);
      termPop.hidden = true;
      if (termNow) termNow.removeAttribute('aria-describedby');
      termNow = null;
    };
    document.addEventListener('pointerover', function (e) {
      var s = e.target.closest && e.target.closest('.term');
      if (s && e.pointerType === 'mouse') showTerm(s);
    });
    document.addEventListener('pointerout', function (e) {
      var s = e.target.closest && e.target.closest('.term');
      if (s && e.pointerType === 'mouse') termTimer = setTimeout(hideTerm, 120);
    });
    document.addEventListener('focusin', function (e) {
      if (e.target.classList && e.target.classList.contains('term')) showTerm(e.target);
    });
    document.addEventListener('focusout', function (e) {
      if (e.target.classList && e.target.classList.contains('term')) hideTerm();
    });
    document.addEventListener('click', function (e) {
      var s = e.target.closest && e.target.closest('.term');
      if (s) { if (termNow === s) hideTerm(); else showTerm(s); }
      else if (termNow) hideTerm();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && termNow) hideTerm(); });
    window.addEventListener('scroll', function () { if (termNow) hideTerm(); }, { passive: true });
    document.addEventListener('rasin:lang', markTerms);
  }

  /* ---------------- Init ---------------- */
  // Arabic is inline in the HTML; load its dictionary too so switching back works.
  loadDict('ar').then(function () {
    if (root.lang === 'en') return setLang('en');
    document.dispatchEvent(new Event('rasin:lang'));
    refreshToolLabels();
    updateNavToggle();
  });
  refreshToolLabels();
  setCurrent(0);
})();
