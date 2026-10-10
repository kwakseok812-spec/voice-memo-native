/* ============================================================================
 * k-motion.js — 누른 뒤의 움직임 효과 (v9.6 · O-0387)
 * ----------------------------------------------------------------------------
 * 대표님이 시안(「누른 뒤 움직임 효과」 10가지)에서 고르신 효과를 여기에 하나씩 얹는다.
 *   지금 든 것: 6번 옷 갈아입기 = 「가 · 반짝임」 (꾸미기 화면의 큰 사진)
 *
 * 공통 규칙(효과를 더할 때도 이 파일의 값만 쓴다):
 *   · 동작은 누르는 즉시 바뀌고, 효과는 그 위에 얹힌다(효과가 끝나기를 기다리는 동작은 없다).
 *   · 세기는 LEVEL 하나(대표님이 시안에서 보신 「과감」). 앱 화면에 세기 설정은 만들지 않는다.
 *   · 길이는 아무리 길어도 0.6초(MAX_MS). transform · opacity 만 움직인다.
 *   · 움직임을 쉬는 때(calm): 「케이 꾸미기 → 케이 얼굴 움직이기」를 껐거나 폰의 「움직임 줄이기」가 켜져 있을 때(k-scene.js 의 calm 과 같은 기준)
 *       → 이동 · 확대 · 빛줄기 · 반짝이 없이 0.12초 서서히 바뀜만 남긴다.
 *   · 진동은 넣지 않았다(앱에 진동 권한 android.permission.VIBRATE 가 없다 — 넣으려면 매니페스트 한 줄 + 새 빌드). 넣게 되면 여기 한 곳(buzz)에 둔다.
 * ==========================================================================*/
(function () {
  'use strict';
  var LEVEL = 'bold';                                                                    // 세기: calm 차분 · normal 보통 · bold 과감
  var PR = { calm: { a: .45, t: .85, n: 0 }, normal: { a: 1, t: 1, n: .5 }, bold: { a: 1.7, t: 1.12, n: 1 } };   // a 움직임 크기 · t 길이 배수 · n 반짝이 수 배수
  var MAX_MS = 600, CALM_MS = 120;
  var EOUT = 'cubic-bezier(.2,.8,.2,1)';
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1l2.4 8.6L23 12l-8.6 2.4L12 23l-2.4-8.6L1 12l8.6-2.4z"/></svg>';

  function calm() {
    try {
      if (window.KChar && KChar.motionOn && !KChar.motionOn()) return true;
      return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return true; }
  }
  function amp() { return calm() ? 0 : PR[LEVEL].a; }
  function cnt(n) { return calm() ? 0 : Math.round(n * PR[LEVEL].n); }
  function T(ms) { return calm() ? Math.min(CALM_MS, ms) : Math.min(MAX_MS, Math.round(ms * PR[LEVEL].t)); }
  function an(el, kf, o) { if (!el || !el.animate) return null; try { return el.animate(kf, o); } catch (e) { return null; } }
  function after(a, fn) { if (a && a.finished && a.finished.then) a.finished.then(fn, function () {}); else fn(); }
  function drop(n) { try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {} }
  function buzz() { /* 진동 자리(지금은 아무것도 하지 않는다 — 위 설명) */ }

  // 반짝이: host(위치 기준이 되는 상자) 안 아무 데나 n 개가 잠깐 피었다 진다
  function sparkle(host, n) {
    if (!host || n <= 0) return;
    for (var i = 0; i < n; i++) (function () {
      var s = document.createElement('i'), sz = 12 + Math.random() * 16;
      s.className = 'kmo-spk'; s.innerHTML = STAR;
      s.style.cssText = 'left:' + (8 + Math.random() * 84) + '%;top:' + (8 + Math.random() * 70) + '%;width:' + sz + 'px;height:' + sz + 'px;margin:' + (-sz / 2) + 'px 0 0 ' + (-sz / 2) + 'px';
      host.appendChild(s);
      var a = an(s, [{ transform: 'scale(0) rotate(0deg)', opacity: 0 }, { transform: 'scale(1) rotate(60deg)', opacity: 1, offset: .45 }, { transform: 'scale(0) rotate(120deg)', opacity: 0 }],
        { duration: T(380), easing: 'ease-out', delay: Math.random() * 150, fill: 'both' });
      after(a, function () { drop(s); });
    })();
  }
  // 빛줄기 한 번: host 를 왼쪽에서 오른쪽으로 지나간다
  function shine(host, before) {
    if (!host) return;
    var sh = document.createElement('div'); sh.className = 'kmo-shine';
    if (before && before.parentNode === host) host.insertBefore(sh, before); else host.appendChild(sh);
    var a = an(sh, [{ transform: 'translateX(-160%) skewX(-18deg)', opacity: 0 }, { opacity: .2 + .22 * amp(), offset: .3 }, { transform: 'translateX(420%) skewX(-18deg)', opacity: 0 }], { duration: T(520), easing: 'ease-in-out', fill: 'both' });
    after(a, function () { drop(sh); });
  }

  /* ---------------- 6번 옷 갈아입기 — 「가 · 반짝임」 ----------------
   * 쓰는 법(app.js 꾸미기 화면):  var g = KMotion.snap(hero);  → 옷을 바꾼다(즉시) →  KMotion.outfitSwap(hero, g);
   *   snap     = 바꾸기 직전에 보이던 모습을 한 장 떠 둔다(영상이 돌고 있었으면 그 장면).
   *   outfitSwap = 떠 둔 옛 모습을 새 모습 위에 얹어 서서히 걷어 내고(겹쳐 넘김), 새 모습은 아주 조금 컸다가 자리 잡는다 + 빛줄기 한 번 + 작은 별.
   *   얼굴 통일(O-0393) 뒤로는 옷을 넘겨도 얼굴이 같은 자리에 있으므로, 확대는 얼굴 가운데를 축으로 아주 작게(최대 3.4%) — 얼굴이 흔들려 보이지 않게. */
  var GROW = .02;                                                // 새 모습이 처음에 커져 있는 정도 × 세기(과감 1.7 → 3.4%). 시안의 6%는 얼굴이 움직여 보여 줄였다
  var live = [];                                                 // 지금 도는 효과의 조각들(연달아 누르면 앞의 것을 걷어 낸다)
  function clearLive() { live.forEach(function (x) { try { if (x.cancel) x.cancel(); else drop(x); } catch (e) {} }); live = []; }
  function snap(hero) {
    try {
      var face = hero && hero.querySelector('.kface'); if (!face) return null;
      var img = face.querySelector('.kf-img'), vid = face.querySelector('.kf-vid'), g = null;
      var w = face.clientWidth, h = face.clientHeight; if (!w || !h) return null;
      if (vid && face.classList.contains('vid-on') && vid.videoWidth) {          // 영상이 보이는 중 → 그 장면을 그림으로
        g = document.createElement('canvas'); g.width = w * 2; g.height = h * 2;
        var vw = vid.videoWidth, vh = vid.videoHeight, sc = Math.max(g.width / vw, g.height / vh), dw = vw * sc, dh = vh * sc;
        var op = (getComputedStyle(vid).objectPosition || '50% 50%').split(' '), px = parseFloat(op[0]) / 100, py = parseFloat(op[1]) / 100;
        if (isNaN(px)) px = .5; if (isNaN(py)) py = .5;
        g.getContext('2d').drawImage(vid, (g.width - dw) * px, (g.height - dh) * py, dw, dh);
      } else if (img && img.getAttribute('src') && img.complete && img.naturalWidth) {
        g = document.createElement('img'); g.alt = ''; g.draggable = false; g.src = img.getAttribute('src');
        g.style.objectPosition = getComputedStyle(img).objectPosition;
      }
      if (g) g.className = 'kmo-ghost';
      return g;
    } catch (e) { return null; }
  }
  function outfitSwap(hero, ghost) {
    try {
      clearLive();
      var main = hero && (hero.querySelector('.kw-hero-main') || hero), face = hero && hero.querySelector('.kface');
      if (!main || !face) return;
      var cap = main.querySelector('.kw-hero-cap'), a = amp();
      if (ghost) {                                               // 옛 모습을 얹어 서서히 걷어 낸다(새 모습은 이미 그 밑에 있다)
        if (cap) main.insertBefore(ghost, cap); else main.appendChild(ghost);
        live.push(ghost);
        after(an(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: T(360), easing: 'ease-out', fill: 'both' }), function () { drop(ghost); });
      }
      if (calm()) return;                                        // 움직임을 쉬는 때: 서서히 바뀜(0.12초)만
      face.style.transformOrigin = '50% 38%';                  // 축 = 얼굴 가운데(얼굴이 가장 덜 움직인다)
      var z = an(face, [{ transform: 'scale(' + (1 + GROW * a) + ')' }, { transform: 'none' }], { duration: T(360), easing: EOUT });
      if (z) live.push(z);
      shine(main, cap);
      sparkle(main, cnt(12));
      var nm = main.querySelector('.kw-hero-cap b');
      if (nm) an(nm, [{ transform: 'translateY(' + (6 * a) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(300), easing: EOUT });
      var th = document.querySelector('#kwGrid .kw-item.on .kw-th');
      if (th) an(th, [{ transform: 'scale(.94)' }, { transform: 'none' }], { duration: T(300), easing: EOUT });
      buzz();
    } catch (e) {}
  }

  window.KMotion = { level: LEVEL, calm: calm, amp: amp, cnt: cnt, T: T, an: an, after: after, sparkle: sparkle, shine: shine, snap: snap, outfitSwap: outfitSwap,
                     maxMs: MAX_MS };
})();
