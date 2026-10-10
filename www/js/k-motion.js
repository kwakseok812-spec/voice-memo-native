/* ============================================================================
 * k-motion.js — 누른 뒤의 움직임 효과 (v9.6 · O-0387)
 * ----------------------------------------------------------------------------
 * 대표님이 시안(「누른 뒤 움직임 효과」 10가지)에서 고르신 효과를 여기에 하나씩 얹는다.
 *   지금 든 것: 1번 단추 누름 반응 · 2번 채팅 보내기 · 3번 건강 기록 저장 · 6번 옷 갈아입기(가 · 반짝임) · 7번 음성 대화 시작/끝
 *   넣지 않은 것: 4번(화면 미끄러짐) · 5번 · 8번 · 9번 · 10번
 *
 * 공통 규칙(효과를 더할 때도 이 파일의 값만 쓴다):
 *   · 동작은 누르는 즉시 바뀌고, 효과는 그 위에 얹힌다(효과가 끝나기를 기다리는 동작은 없다 — 이 파일은 화면만 움직이고 앱의 일은 건드리지 않는다).
 *   · 세기는 LEVEL 하나(대표님이 시안에서 보신 「과감」). 앱 화면에 세기 설정은 만들지 않는다.
 *   · 길이는 아무리 길어도 0.6초(MAX_MS). transform · opacity 만 움직인다(체크 그리기의 작은 선 하나만 예외).
 *   · 움직임을 쉬는 때(calm): 「케이 꾸미기 → 케이 얼굴 움직이기」를 껐거나 폰의 「움직임 줄이기」가 켜져 있을 때(k-scene.js 의 calm 과 같은 기준)
 *       → 이동 · 확대 · 물결 · 빛줄기 · 반짝이 · 색종이 없이 0.12초 서서히 바뀜만 남긴다(없어도 되는 효과는 아예 쉰다).
 *   · 진동은 넣지 않았다(앱에 진동 권한 android.permission.VIBRATE 가 없다 — 넣으려면 매니페스트 한 줄 + 새 빌드). 넣게 되면 여기 한 곳(buzz)에 둔다.
 * ==========================================================================*/
(function () {
  'use strict';
  var LEVEL = 'bold';                                                                    // 세기: calm 차분 · normal 보통 · bold 과감
  var PR = { calm: { a: .45, t: .85, o: 0, n: 0 }, normal: { a: 1, t: 1, o: 1, n: .5 }, bold: { a: 1.7, t: 1.12, o: 2, n: 1 } };   // a 움직임 크기 · t 길이 배수 · o 튐 · n 반짝이 수 배수
  var MAX_MS = 600, CALM_MS = 120;
  var EOUT = 'cubic-bezier(.2,.8,.2,1)';
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1l2.4 8.6L23 12l-8.6 2.4L12 23l-2.4-8.6L1 12l8.6-2.4z"/></svg>';
  var COLS = ['#6C7BFF', '#A855F7', '#22D3EE', '#34D399', '#FBBF24', '#F43F5E'];

  function calm() {
    try {
      if (window.KChar && KChar.motionOn && !KChar.motionOn()) return true;
      return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return true; }
  }
  function amp() { return calm() ? 0 : PR[LEVEL].a; }
  function cnt(n) { return calm() ? 0 : Math.round(n * PR[LEVEL].n); }
  function T(ms) { return calm() ? Math.min(CALM_MS, ms) : Math.min(MAX_MS, Math.round(ms * PR[LEVEL].t)); }
  function SPR() { var o = calm() ? 0 : PR[LEVEL].o; return o === 0 ? EOUT : (o === 1 ? 'cubic-bezier(.3,1.3,.45,1)' : 'cubic-bezier(.3,1.75,.4,1)'); }
  function an(el, kf, o) { if (!el || !el.animate) return null; try { return el.animate(kf, o); } catch (e) { return null; } }
  function after(a, fn) { if (a && a.finished && a.finished.then) a.finished.then(fn, function () {}); else fn(); }
  function drop(n) { try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch (e) {} }
  function vis(el) { return !!(el && el.getClientRects && el.getClientRects().length); }
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
  // 색종이: 화면의 한 점(x, y — 화면 기준)에서 n 개가 터졌다 진다
  function burst(x, y, n, r) {
    for (var i = 0; i < n; i++) (function (i) {
      var p = document.createElement('i'); p.className = 'kmo-pt' + (i % 3 === 0 ? ' r' : '');
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.background = COLS[i % COLS.length];
      document.body.appendChild(p);
      var ang = Math.random() * Math.PI * 2, d = r * (.45 + Math.random() * .75), dx = Math.cos(ang) * d, dy = Math.sin(ang) * d - r * .35, rot = (Math.random() * 540 - 270) | 0;
      var a = an(p, [{ transform: 'translate(0,0) scale(.3)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1) rotate(' + rot + 'deg)', opacity: 1, offset: .55 },
        { transform: 'translate(' + (dx * 1.12) + 'px,' + (dy + 26) + 'px) scale(.5) rotate(' + (rot * 1.3) + 'deg)', opacity: 0 }], { duration: T(500), easing: 'cubic-bezier(.1,.7,.3,1)', delay: Math.random() * 30, fill: 'both' });
      after(a, function () { drop(p); });
    })(i);
  }

  /* ---------------- 1번 단추 누름 반응 ----------------
   * 한 곳(문서 전체)에서 누름을 모아 처리한다. 단추의 일(click)은 건드리지 않는다 — 여기서는 보이는 반응만 얹는다.
   *   물결을 넣는 단추(불투명한 것만): RIPPLE.  눌림·놓을 때 튐만 넣는 단추(뒤가 비치는 유리 단추 · 연달아 누르는 칩): PRESS.
   *   빼는 것: 문서 뷰어 단추 · 건강 ＋/−(연달아 누름) · 녹음/케이 큰 동그라미(자기 효과가 있다) · 꺼진 단추.
   * 잘못 터지지 않게: 손가락은 0.06초 뒤에 반응을 시작하고, 그 사이 10px 넘게 움직이거나(화면 밀기) 브라우저가 취소하면 아무것도 하지 않는다.
   *   짧게 톡 누른 것은 손을 뗄 때 한 번에(눌림 → 튐) 보여 준다. 마우스·키보드는 바로. 길게 누르고 있으면 눌린 채로 있다가 뗄 때 돌아온다. */
  var RIPPLE = '.btn.primary, .chatsend, .tool, .hseg-btn, .htogbtn';
  var PRESS = '.btn, .iconbtn, .back, .vpill, .hchip, .kw-item, .kstage-send, .sheet-btn, .td-row, .td-more';
  var SKIP_IN = '#docRoot, .hstepbtn, .orbbtn, [disabled], [aria-disabled="true"]';
  var TOUCH_WAIT = 60, MOVE_MAX = 10;
  var pr = null;                                                 // 지금 누르고 있는 단추 하나
  function pressTarget(t) {
    if (!t || !t.closest) return null;
    var b = t.closest(RIPPLE + ', ' + PRESS); if (!b) return null;
    if (b.closest(SKIP_IN)) return null;
    return b;
  }
  function ripple(b, x, y) {
    if (calm() || !b.matches(RIPPLE)) return;
    var r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.3;
    var cx = (x == null ? r.left + r.width / 2 : x) - r.left, cy = (y == null ? r.top + r.height / 2 : y) - r.top;
    var s = document.createElement('span'); s.className = 'kmo-rp';
    s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (cx - size / 2) + 'px;top:' + (cy - size / 2) + 'px';
    var st = getComputedStyle(b), rel = st.position === 'static';
    if (rel) b.classList.add('kmo-rel');
    b.classList.add('kmo-clip');
    b._kmoRp = (b._kmoRp || 0) + 1;
    b.appendChild(s);
    var a = an(s, [{ transform: 'scale(.04)', opacity: .2 + .14 * amp() }, { transform: 'scale(1)', opacity: 0 }], { duration: T(480), easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'both' });
    after(a, function () { drop(s); b._kmoRp--; if (b._kmoRp <= 0) { b.classList.remove('kmo-clip'); if (rel) b.classList.remove('kmo-rel'); } });
  }
  function downScale() { return calm() ? 1 : (1 - .035 * Math.max(.6, amp())); }
  function glass(b) { try { var s = getComputedStyle(b), f = s.backdropFilter || s.webkitBackdropFilter || ''; return !!f && f !== 'none'; } catch (e) { return false; } }
  function pressIn(p) {
    if (p.inAnim || calm()) return;
    if (p.el.matches(RIPPLE)) p.inAnim = an(p.el, [{ transform: 'scale(1)' }, { transform: 'scale(' + downScale() + ')' }], { duration: T(90), easing: 'ease-out', fill: 'forwards' });
    else p.inAnim = true;                                        // 유리 단추는 눌림을 지금의 :active 꾸밈에 맡긴다(흐림을 다시 계산하지 않게 새 움직임을 얹지 않는다)
    ripple(p.el, p.x, p.y);
  }
  function pressOut(p, ok) {
    var b = p.el, a = amp();
    if (p.inAnim && p.inAnim.cancel) {
      var back = an(b, [{ transform: 'scale(' + downScale() + ')' }, { transform: 'scale(1)' }], { duration: T(ok ? 300 : 120), easing: ok ? SPR() : 'ease-out' });
      p.inAnim.cancel();
      if (!back) b.style.transform = '';
    } else if (ok && a && !b.matches(RIPPLE) && !glass(b)) {       // 뒤가 흐린 유리 단추는 지금의 눌림 꾸밈 그대로 둔다(흐림을 프레임마다 다시 계산하지 않게)
      an(b, [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: T(260), easing: SPR() });
    }
    if (ok && a) {
      var ic = b.querySelector('.ic') || b.querySelector('svg');
      if (ic) an(ic, [{ transform: 'none' }, { transform: 'translateY(' + (-4 * a) + 'px) scale(' + (1 + .1 * a) + ')' }, { transform: 'none' }], { duration: T(340), easing: EOUT });
    }
  }
  function pressEnd(ok) {
    var p = pr; if (!p) return; pr = null;
    clearTimeout(p.timer);
    if (ok && !p.inAnim) pressIn(p);                             // 톡 누른 것: 뗄 때 눌림과 튐을 한 번에
    if (p.inAnim) pressOut(p, ok);
  }
  function initPress() {
    if (!window.PointerEvent) return;
    document.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button > 0) return;
      if (pr) pressEnd(false);
      var b = pressTarget(ev.target); if (!b) return;
      var p = pr = { el: b, x: ev.clientX, y: ev.clientY, id: ev.pointerId, inAnim: null, timer: 0 };
      if (ev.pointerType === 'touch') p.timer = setTimeout(function () { if (pr === p) pressIn(p); }, TOUCH_WAIT);
      else pressIn(p);
    }, { passive: true, capture: true });
    document.addEventListener('pointermove', function (ev) {
      var p = pr; if (!p || ev.pointerId !== p.id) return;
      if (Math.abs(ev.clientX - p.x) > MOVE_MAX || Math.abs(ev.clientY - p.y) > MOVE_MAX) pressEnd(false);   // 화면을 밀거나 끄는 중 — 누른 것으로 치지 않는다
    }, { passive: true, capture: true });
    document.addEventListener('pointerup', function (ev) {
      var p = pr; if (!p || ev.pointerId !== p.id) return;
      var over = document.elementFromPoint(ev.clientX, ev.clientY);
      pressEnd(!!(over && p.el.contains(over)));
    }, { passive: true, capture: true });
    document.addEventListener('pointercancel', function () { pressEnd(false); }, { passive: true, capture: true });
    document.addEventListener('keydown', function (ev) {
      if ((ev.key !== 'Enter' && ev.key !== ' ') || ev.repeat) return;
      var b = pressTarget(ev.target); if (!b || calm()) return;
      var p = { el: b, x: null, y: null, inAnim: null, timer: 0 }; pressIn(p); pressOut(p, true);
    }, { passive: true, capture: true });
  }

  /* ---------------- 2번 채팅 보내기 ----------------
   * app.js 가 대화를 다시 그린 「뒤」에 부른다: KMotion.chat(log, { mine, incoming, convo, send, face })
   *   mine     = 방금 이 기기에서 보낸 말의 말풍선 표시(data-uid) → 화면 아래(보내기 단추 자리 · 폰은 입력 바가 네이티브라 화면 아래 가장자리)에서 올라온다
   *   incoming = 방금 온 케이 말 → 살짝 커지며 나타난다
   *   보낸 말 아래 한 줄(.msgstat — 2부에서 넣은 「보냄 → 받았습니다」 그 표시 하나)이 바뀌는 순간 살짝 떠오르고, 「받았습니다」가 될 때 머리줄의 케이 얼굴이 끄덕인다.
   *   음성 대화 중(convo)에는 아무 효과도 넣지 않는다(음성은 지연에 민감하다). */
  var statSeen = {}, typingSeen = false;
  // 대화는 통째로 다시 그려진다(보낸 직후 수십 ms 안에 한 번 더 그려지기도 한다) → 걸어 둔 움직임을 적어 두었다가, 다시 그려진 새 요소에 「남은 시간만큼」 이어서 건다.
  var runs = [], runSeq = 0;
  function run(log, sel, kf, opt) {
    var r = { id: ++runSeq, sel: sel, kf: kf, opt: opt, t0: performance.now(), end: (opt.duration || 0) + (opt.delay || 0) };
    runs.push(r); apply(log, r);
  }
  function apply(log, r) {
    var el = log.querySelector(r.sel); if (!el || el._kmoRun === r.id) return;
    var a = an(el, r.kf, r.opt); if (!a) return;
    el._kmoRun = r.id;
    var gone = performance.now() - r.t0;
    if (gone > 16) { try { a.currentTime = gone; } catch (e) {} }
  }
  function replay(log) {
    var now = performance.now();
    runs = runs.filter(function (r) { return now - r.t0 < r.end; });
    runs.forEach(function (r) { apply(log, r); });
  }
  function chat(log, o) {
    o = o || {};
    if (!log) return;
    var quiet = !!o.convo;
    if (quiet) runs = []; else replay(log);                               // 다시 그려진 것이면 앞의 움직임을 이어서
    var stats = Array.prototype.slice.call(log.querySelectorAll('.msgstat[data-ms]')), now = {};
    var typing = log.querySelector('.ktyping .bubble');
    stats.forEach(function (el) {
      var id = el.getAttribute('data-ms'), st = el.classList.contains('got') ? 'got' : el.textContent;
      now[id] = st;
      if (quiet || !(id in statSeen) || statSeen[id] === st) return;       // 처음 보는 줄(화면을 연 때·방금 보낸 말)과 그대로인 줄은 움직이지 않는다
      run(log, '.msgstat[data-ms="' + id + '"]', [{ opacity: 0, transform: 'translateY(' + (-4 * amp()) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: T(240), easing: EOUT });
      if (st === 'got' && o.face && amp()) an(o.face, [{ transform: 'none' }, { transform: 'translateY(' + (2 * amp()) + 'px) rotate(' + (-5 * amp()) + 'deg)' }, { transform: 'none' }], { duration: T(380), easing: EOUT });
    });
    statSeen = now;
    if (typing && !typingSeen && !quiet && amp()) run(log, '.ktyping .bubble', [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(300), easing: SPR() });
    typingSeen = !!typing;
    if (quiet) return;
    if (o.mine) {
      var msel = '.bubble.me[data-uid="' + o.mine + '"]', me = log.querySelector(msel);
      if (me) {
        var to = me.getBoundingClientRect(), from = null;
        if (o.send && vis(o.send)) from = o.send.getBoundingClientRect();
        var fx = from ? from.left + from.width / 2 - to.width / 2 : to.left, fy = from ? from.top : (window.innerHeight - 20);
        if (calm()) run(log, msel, [{ opacity: .35 }, { opacity: 1 }], { duration: T(340) });
        else run(log, msel, [{ transform: 'translate(' + (fx - to.left) + 'px,' + Math.max(0, fy - to.top) + 'px) scale(.94)', opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: T(340), easing: SPR() });
        if (o.send && vis(o.send) && amp()) {
          var pl = o.send.querySelector('svg'), a = amp();
          if (pl) an(pl, [{ transform: 'none', opacity: 1 }, { transform: 'translate(' + (10 * a) + 'px,' + (-10 * a) + 'px) scale(.5)', opacity: 0, offset: .45 }, { transform: 'translate(' + (-8 * a) + 'px,' + (8 * a) + 'px) scale(.5)', opacity: 0, offset: .5 }, { transform: 'none', opacity: 1 }], { duration: T(420), easing: 'ease-out' });
        }
      }
    }
    if (o.incoming && amp()) run(log, '.bubble.k[data-uid="' + o.incoming + '"]', [{ transform: 'scale(.94)', opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: T(300), easing: SPR() });
  }

  /* ---------------- 3번 건강 기록 저장 ----------------
   * health.js 가 「대표님이 방금 누른 변화」에서만 부른다(서버 값을 받아 맞출 때는 부르지 않는다).
   *   checkDraw(i)        = 칸이 처음 채워질 때 체크 표시를 선으로 그린다
   *   rollNumber(p, n, up) = 케이 한 줄의 「9칸 중 N칸」 숫자가 굴러 바뀐다
   *   saved(el)           = 「적어 두었습니다」가 될 때 살짝 떠오른다
   *   cheer(el)           = 9칸을 다 채웠을 때의 작은 축하(지금 있는 케이 장면에 색종이를 얹는다 — 하루 한 번은 health.js 가 지킨다) */
  var CK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="kmo-ckp" pathLength="1" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function checkDraw(i) {
    if (!i) return;
    if (calm()) { an(i, [{ opacity: .3 }, { opacity: 1 }], { duration: T(240) }); return; }
    try {
      i.innerHTML = CK;
      var p = i.querySelector('.kmo-ckp'); p.style.strokeDasharray = '1';
      an(p, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: T(280), easing: 'ease-out', fill: 'backwards' });
      an(i, [{ transform: 'scale(.6)' }, { transform: 'none' }], { duration: T(300), easing: SPR() });
    } catch (e) {}
  }
  function rollNumber(p, n, up) {
    if (!p || n == null) return;
    try {
      var t = p.textContent, m = /중 (\d+)칸/.exec(t);
      if (!m || +m[1] !== +n) return;
      var at = m.index + 2;
      p.textContent = '';
      p.appendChild(document.createTextNode(t.slice(0, at)));
      var b = document.createElement('b'); b.className = 'kmo-num'; b.textContent = m[1]; p.appendChild(b);
      p.appendChild(document.createTextNode(t.slice(at + m[1].length)));
      if (calm()) an(b, [{ opacity: .3 }, { opacity: 1 }], { duration: T(260) });
      else an(b, [{ transform: 'translateY(' + (up ? 70 : -70) + '%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(260), easing: SPR() });
    } catch (e) {}
  }
  function saved(el) {
    if (!el) return;
    an(el, [{ transform: 'translateY(' + (3 * amp()) + 'px)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: T(240), easing: EOUT });
  }
  function cheer(el) {
    if (!el || calm()) return;
    try {
      var r = el.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + 8, cnt(26), 96);
      var sp = el.querySelector('.ksp');
      if (sp) an(sp, [{ transform: 'translateY(' + (10 * amp()) + 'px)' }, { transform: 'none' }], { duration: T(360), easing: SPR() });
    } catch (e) {}
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

  /* ---------------- 7번 음성 대화 시작 · 끝 ----------------
   * app.js 가 화면을 「이미 바꾼 뒤」에 부른다(마이크·듣기 시작·종료 처리는 이 효과와 무관하게 예전 그 시점에 돈다 — 여기에는 기다림이 없다).
   *   callStart(from, view) = 누른 단추 자리(from — 바꾸기 전 위치)에서 원이 퍼지고 그 위로 통화 화면이 나타난다 · 아래 단추는 밑에서, 위 줄은 위에서 들어온다.
   *   callEnd(to, view)     = 통화 화면이 단추 자리(to — 돌아온 뒤 위치)로 오므라든다. 채팅 화면은 이미 돌아와 있고, 그 위를 덮은 원이 줄어들 뿐이다.
   *   덮개는 누름을 받지 않는다(pointer-events 없음) — 「케이 얼굴 눌러 말 끊기」를 가리지 않는다.
   *   넓은 화면(폴드 펼침 · 가로 — 왼쪽 케이 | 오른쪽 대화)은 원 없이 왼쪽 케이만 서서히. */
  var wash = null;
  function mkWash(rect, cls) {
    drop(wash);
    var W = window.innerWidth, H = window.innerHeight, cx = rect ? rect.left + rect.width / 2 : W / 2, cy = rect ? rect.top + rect.height / 2 : H - 40;
    var r = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + 8;
    var w = document.createElement('div'); w.className = 'kmo-wash ' + cls;
    w.style.cssText = 'left:' + (cx - r) + 'px;top:' + (cy - r) + 'px;width:' + (2 * r) + 'px;height:' + (2 * r) + 'px';
    document.body.appendChild(w); wash = w; return w;
  }
  function fullStage(view) {                                    // 지금 통화 화면이 화면 전체를 덮는 모습인가(좁은 화면 · 대화를 펼치지 않음)
    var st = view && view.querySelector('.kstage');
    return !!(st && view.classList.contains('convo-full') && !view.classList.contains('convo-log') && getComputedStyle(st).position === 'fixed');
  }
  function callStart(from, view) {
    try {
      var st = view && view.querySelector('.kstage'); if (!st) return;
      var a = amp();
      if (!fullStage(view)) {                                    // 넓은 화면: 왼쪽 케이만
        var kc = view.querySelector('.kcall');
        if (kc && vis(kc)) an(kc, calm() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateX(' + (-3 * a) + '%)' }, { opacity: 1, transform: 'none' }], { duration: T(360), easing: EOUT });
        return;
      }
      if (calm()) { an(st, [{ opacity: 0 }, { opacity: 1 }], { duration: T(120) }); return; }
      var w = mkWash(from, 'in');
      an(w, [{ transform: 'scale(.04)' }, { transform: 'scale(1)' }], { duration: T(360), easing: 'cubic-bezier(.3,.1,.2,1)', fill: 'forwards' });
      var c = an(st, [{ opacity: 0 }, { opacity: 0, offset: .3 }, { opacity: 1 }], { duration: T(460), easing: 'ease-out' });
      var bot = view.querySelector('.voicerow'), top = st.querySelector('.kstage-status'), back = view.querySelector('.subbar .back');
      if (bot) an(bot, [{ transform: 'translateY(' + (30 * a) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(300), easing: SPR(), delay: T(190), fill: 'backwards' });
      [top, back].forEach(function (e) { if (e) an(e, [{ transform: 'translateY(' + (-14 * a) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(280), easing: EOUT, delay: T(200), fill: 'backwards' }); });
      after(c, function () { if (wash === w) { drop(w); wash = null; } });
      setTimeout(function () { if (wash === w) { drop(w); wash = null; } }, MAX_MS + 100);        // 혹시 끝남 신호를 못 받아도 덮개가 남지 않게
    } catch (e) { drop(wash); wash = null; }
  }
  function callEnd(to, view, wasFull) {
    try {
      drop(wash); wash = null;
      if (!wasFull || calm()) return;                            // 넓은 화면 · 움직임을 쉬는 때: 그냥 바로 돌아온다
      var w = mkWash(to, 'out');
      var c = an(w, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.04)', opacity: 1, offset: .9 }, { transform: 'scale(.04)', opacity: 0 }], { duration: T(380), easing: 'cubic-bezier(.5,0,.4,1)', fill: 'forwards' });
      after(c, function () { if (wash === w) { drop(w); wash = null; } });
      setTimeout(function () { if (wash === w) { drop(w); wash = null; } }, MAX_MS + 100);
      var btn = view && view.querySelector('#chatConvoToggle');
      if (btn) an(btn, [{ transform: 'scale(.9)' }, { transform: 'none' }], { duration: T(280), easing: SPR(), delay: T(240), fill: 'backwards' });
    } catch (e) { drop(wash); wash = null; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPress); else initPress();

  window.KMotion = { level: LEVEL, maxMs: MAX_MS, calm: calm, amp: amp, cnt: cnt, T: T, an: an, after: after,
                     sparkle: sparkle, shine: shine, burst: burst,
                     chat: chat,                                                         // 2번
                     checkDraw: checkDraw, rollNumber: rollNumber, saved: saved, cheer: cheer,   // 3번
                     snap: snap, outfitSwap: outfitSwap,                                 // 6번
                     callStart: callStart, callEnd: callEnd, fullStage: fullStage };     // 7번
})();
