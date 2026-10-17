/* k-fashion-show.js — (O-0557) 케이 패션쇼.
 *
 * 왜: 옷마다 있는 움직임이 인사(숙이기)뿐이었다. 꾸미기 「옷」 탭의 옷장 머리줄 [▶ 패션쇼]를 누르면 케이가 옷장의 옷을 한 벌에 8초씩
 *     갈아입으며 걸어 나와 → 한 바퀴 → 포즈를 보여 준다(동작 「라2」 · 2026-10-16 확정).
 * 나눠 맡는 일:
 *   · app.js(「O-0557」 블록) — 쇼 목록(옷장과 같은 목록 · 순서 · 묶음 이름) · 지금 옷 · 「이 옷 입기」(옷장 칸을 누를 때와 같은 함수 kwWear)를 넘겨준다.
 *   · k-character.js(KChar.show) — 옷마다 무엇을 보일지(패션쇼 영상 → 인사 영상 → 서 있는 그림)와 파일 받기.
 *   · 이 파일 — 화면만 그린다. 옷을 바꾸지 않는다(「이 옷 입기」만 app.js 의 함수를 부른다).
 * 화면 짜임: 꾸미기 화면 위에 덮는 한 장(문서 맨 바깥 · z-index 850 — 「케이 무대」와 같은 층, 녹음 띠(900)·확인 창보다 아래).
 *   꾸미기 화면이 닫히면(녹음 띠 · 바로가기 · 알림으로 다른 화면에 갈 때) 스스로 닫힌다. 폰 뒤로 가기 = 닫기(app.js goBack).
 * 조작은 아래 단추 줄만: [이전] [멈춤/재생] [이 옷 입기] [다음] + 위 [닫기]. 화면을 눌러 넘기는 자리는 없다(스치기만 해도 넘어가지 않게).
 * 옷이 바뀔 때 효과 = 「플래시처럼 번쩍」 하나(0.4초 · 따뜻한 흰빛 + 반짝이). 움직임 줄이기(케이 얼굴 움직이기 끔 · 폰 설정)면 영상 대신 그림, 0.12초 서서히.
 * 마무리: 마지막 옷이 끝나면 지금 입은 옷으로 돌아와 멈춘다 — [다시 보기] [닫기].
 * 받기: 열 때 첫째 · 둘째 옷을 받고, 보는 동안 다음 두 벌을 차례로 미리 받는다(한 번에 하나). 늦으면 그 옷은 그림으로 보이고 쇼는 멈추지 않는다.
 *   첫 옷은 패션쇼 영상이 올 때까지 최대 2.5초 기다렸다 시작한다(그동안 첫 장면 그림 · 진행 막대는 멈춰 있음).
 *   그림으로 시작한 옷도 1.5초 안에 영상이 준비되면 그때 영상으로 처음부터 튼다(이미 인사 영상이 돌고 있으면 바꾸지 않는다 — 도중에 툭 끊겨 보이지 않게).
 * 스위치(app.js): KFS_UI 'off' 면 init 이 불리지 않는다 = 단추가 없고 이 파일이 없는 것과 같다. KFS_SEG = 한 벌 길이(초).
 */
(function () {
  'use strict';
  var api = null, root = null, el = {}, slots = [], front = 0, show = null, closing = 0, qChain = null, qSeen = {};
  var SEG = 8, INTRO_MS = 1100, LATE_MS = 1500, PROBE_MS = 250, FX_MS = 400, FIRST_WAIT_MS = 2500;
  var RANK = { still: 0, bow: 1, show: 2 };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function calm() {                                    // 움직임 줄이기: 케이 얼굴 움직이기 끔 · 절전 · 폰 「움직임 줄이기」(KMotion · KScene 과 같은 기준)
    try {
      if (window.KChar && KChar.motionOn && !KChar.motionOn()) return true;
      return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return true; }
  }
  function an(n, kf, o) { if (!n || !n.animate) return null; try { return n.animate(kf, o); } catch (e) { return null; } }
  var G = {
    x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
    next: '<path d="M5 5.5v13l9-6.5zM16 5h3v14h-3z" fill="currentColor"/>',
    prev: '<path d="M19 5.5v13l-9-6.5zM5 5h3v14H5z" fill="currentColor"/>'
  };
  function glyph(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + G[n] + '</svg>'; }
  function slotHtml(id) {
    return '<div class="kfs-slot" id="' + id + '"><div class="kfs-media"><img alt="" decoding="async" draggable="false">' +
      '<video muted playsinline webkit-playsinline preload="auto" disablepictureinpicture></video></div></div>';
  }

  /* ---- 화면 틀(처음 열 때 한 번) ---- */
  function build() {
    if (root) return true;
    if (!document.body) return false;
    root = document.createElement('section');
    root.id = 'kFashionShow'; root.className = 'kfs'; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '케이 패션쇼');
    root.innerHTML = slotHtml('kfsSlotA') + slotHtml('kfsSlotB') +
      '<div class="kfs-floor"></div><div class="kfs-shade-t"></div><div class="kfs-shade-b"></div>' +
      '<div class="kfs-flash"></div><div class="kfs-fx"></div>' +
      '<div class="kfs-top"><div class="kfs-bars"></div>' +
        '<div class="kfs-head"><span class="kfs-title">케이 패션쇼<small class="kfs-cnt"></small></span><span class="kfs-sp"></span>' +
        '<button type="button" class="kfs-x" data-kfs="close" aria-label="패션쇼 닫기">' + glyph('x') + '</button></div></div>' +
      '<div class="kfs-bot"><div class="kfs-bot-in">' +
        '<div class="kfs-tag" aria-live="polite"><span class="kfs-nm"></span></div>' +
        '<div class="kfs-ctl kfs-ctl-show">' +
          '<button type="button" class="kfs-ic" data-kfs="prev" aria-label="이전 옷">' + glyph('prev') + '</button>' +
          '<button type="button" class="kfs-ic kfs-play" data-kfs="play" aria-label="멈춤">' + glyph('pause') + '</button>' +
          '<button type="button" class="kfs-wear" data-kfs="wear">이 옷 입기</button>' +
          '<button type="button" class="kfs-ic" data-kfs="next" aria-label="다음 옷">' + glyph('next') + '</button>' +
        '</div>' +
        '<div class="kfs-ctl kfs-ctl-end" hidden>' +
          '<button type="button" class="kfs-ghost" data-kfs="again">다시 보기</button>' +
          '<button type="button" class="kfs-wear" data-kfs="close">닫기</button>' +
        '</div>' +
      '</div></div>' +
      '<button type="button" class="kfs-intro" data-kfs="skip" aria-label="여는 글 건너뛰기"><b>케이 패션쇼</b><small></small></button>';
    document.body.appendChild(root);
    slots = [root.querySelector('#kfsSlotA'), root.querySelector('#kfsSlotB')];
    ['bars', 'cnt', 'tag', 'nm', 'flash', 'fx', 'intro', 'play', 'wear'].forEach(function (k) { el[k] = root.querySelector('.kfs-' + k); });
    el.introSub = el.intro.querySelector('small');
    el.ctlShow = root.querySelector('.kfs-ctl-show'); el.ctlEnd = root.querySelector('.kfs-ctl-end');
    slots.forEach(function (s) {
      var v = s.querySelector('video');
      v.muted = true; v.defaultMuted = true; v.loop = false;
      v.addEventListener('playing', function () { s.classList.add('vid-on'); });
      v.addEventListener('error', function () { if (v.getAttribute('src')) { s.classList.remove('vid-on'); s._kind = 'still'; } });   // 못 읽은 영상 → 밑에 깔린 그림 그대로
      // 영상이 끝나면(8초보다 짧은 영상 · 인사 영상) 끝 장면에 머문다 — 따로 할 일 없음(loop 아님)
    });
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && show) { ev.preventDefault(); close(); } });
    // 꾸미기 화면이 다른 길로 닫히면(녹음 띠 · 바로가기 · 알림) 이 화면도 닫는다
    var view = document.getElementById('kWardrobeView');
    if (view && window.MutationObserver) {
      try { new MutationObserver(function () { if (show && view.style.display === 'none') close(true); }).observe(view, { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden && show) pause(true); });   // 앱이 화면 밖으로 나가면 멈춤(돌아와서 재생을 누르면 이어서)
    return true;
  }

  /* ---- 받기(한 번에 하나 · 보는 옷과 다음 두 벌) ---- */
  function want(i) {
    if (!show || !api) return;
    var o = show.list[i]; if (!o) return;
    var still = calm(), key = o.id + (still ? '|s' : '|v');
    if (qSeen[key]) return; qSeen[key] = 1;
    var run = function () { if (!show) return null; return api.ensure(o.id, { still: still }); };
    qChain = (qChain || Promise.resolve()).then(run, run).then(null, function () {});
  }

  /* ---- 한 칸에 옷 하나 걸기 ---- */
  function planOf(o) { try { return api.plan(o.id) || { kind: 'still', still: '' }; } catch (e) { return { kind: 'still', still: '' }; } }
  function slotLoad(s, o, end) {
    var im = s.querySelector('img'), v = s.querySelector('video'), p = planOf(o);
    var still = end || calm() || p.kind === 'still';
    s.classList.remove('vid-on', 'kb');
    s._id = o.id;
    if (still) {
      s._kind = 'still';
      if (im.getAttribute('src') !== (p.still || '')) im.setAttribute('src', p.still || '');
      if (v.getAttribute('src')) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.removeAttribute('poster'); try { v.load(); } catch (e) {} }
      if (!end && !calm()) { void s.offsetWidth; s.classList.add('kb'); }   // 그림 장면: 한 벌 동안 천천히 다가가기
      return p;
    }
    s._kind = p.kind;
    if (im.getAttribute('src') !== (p.under || '')) im.setAttribute('src', p.under || '');
    if (p.under) v.setAttribute('poster', p.under); else v.removeAttribute('poster');
    if (v.getAttribute('src') !== p.video) { v.setAttribute('src', p.video); try { v.load(); } catch (e) {} }
    try { v.currentTime = 0; } catch (e) {}
    return p;
  }
  function playSlot(s) {
    var v = s.querySelector('video');
    if (s._kind === 'still' || !v.getAttribute('src')) return;
    var pr; try { pr = v.play(); } catch (e) { return; }
    if (pr && pr.catch) pr.catch(function () {});      // 재생을 못 하면 밑의 그림이 그대로 보인다
  }
  function stopSlot(s) { var v = s.querySelector('video'); try { v.pause(); } catch (e) {} }

  /* ---- 옷 바꾸기(다음 장면을 뒤 칸에 걸어 두고 앞뒤를 바꾼다 · 효과는 0.4초 · 다음 영상 재생은 효과를 기다리지 않는다) ---- */
  function swapTo(o, end) {
    var A = slots[front], B = slots[1 - front];
    slotLoad(B, o, end);
    if (!end) playSlot(B);
    B.style.zIndex = 2; A.style.zIndex = 1;
    B.style.opacity = 1;
    var done = function (late) { if (late === true && slots[front] === A) return; A.style.opacity = 0; stopSlot(A); };   // 그사이 한 번 더 바꿔 A 가 다시 앞 칸이면 숨기지 않는다(움직임 줄이기 연타)
    if (calm()) {
      var a0 = an(B, [{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      if (a0) a0.onfinish = function () { done(true); }; else done();
    } else {
      done();
      an(el.flash, [{ opacity: 0 }, { opacity: .75, offset: .2 }, { opacity: 0 }], { duration: FX_MS, easing: 'ease-out' });
      an(B.querySelector('.kfs-media'), [{ transform: 'scale(1.035)', filter: 'brightness(1.2)' }, { transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      try { if (window.KMotion && KMotion.sparkle) KMotion.sparkle(el.fx, KMotion.cnt ? KMotion.cnt(10) : 5); } catch (e) {}
    }
    front = 1 - front;
  }

  /* ---- 이름표 · 번호 · 진행 막대 ---- */
  function catOf(o) { return o.category || '기타'; }
  function tag(o, i, anim) {
    var cur = api.cur(), on = o.id === cur;
    el.nm.innerHTML = esc(o.name) + (on ? '<span class="kfs-badge">입는 중</span>' : '') + '<small>' + esc(catOf(o)) + '</small>';
    el.cnt.textContent = (i + 1) + ' / ' + show.list.length;
    if (anim) { el.tag.classList.remove('in'); if (!calm()) { void el.tag.offsetWidth; el.tag.classList.add('in'); } }
    el.wear.disabled = on;
    el.wear.textContent = on ? '지금 입은 옷' : '이 옷 입기';
  }
  function bars() { el.bars.innerHTML = show.list.map(function () { return '<i><b></b></i>'; }).join(''); }
  function paintBars(p) {
    var bs = el.bars.children;
    for (var i = 0; i < bs.length; i++) bs[i].firstChild.style.width = (show.end || i < show.i ? 100 : (i > show.i ? 0 : Math.max(0, Math.min(100, p * 100)))) + '%';
  }
  function setPlayIcon() {
    el.play.innerHTML = glyph(show.paused ? 'play' : 'pause');
    el.play.setAttribute('aria-label', show.paused ? '다시 재생' : '멈춤');
  }

  /* ---- 흐름 ---- */
  function goTo(i) {
    if (!show) return;
    show.end = false; show.hold = 0; el.ctlShow.hidden = false; el.ctlEnd.hidden = true;
    var o = show.list[i];
    swapTo(o, false);
    show.i = i; show.t0 = performance.now(); show.acc = 0; show.paused = false; show.probe = 0;
    tag(o, i, true); setPlayIcon(); paintBars(0);
    want(i); want(i + 1); want(i + 2);
  }
  function curOutfit() {                               // 마무리 장에 보일 「지금 입은 옷」(쇼 목록에서 — 없으면 KChar 의 지금 옷)
    var id = api.cur();
    for (var i = 0; i < show.list.length; i++) if (show.list[i].id === id) return show.list[i];
    try { return KChar.outfit(); } catch (e) { return show.list[0]; }
  }
  function finish() {
    var cur = curOutfit();
    show.end = true; show.paused = true; paintBars(1);
    swapTo(cur, true);
    el.nm.innerHTML = esc(cur.name) + '<span class="kfs-badge">입는 중</span><small>지금 옷으로 돌아왔습니다</small>';
    el.cnt.textContent = show.list.length + '벌 끝';
    el.tag.classList.remove('in'); if (!calm()) { void el.tag.offsetWidth; el.tag.classList.add('in'); }
    el.ctlShow.hidden = true; el.ctlEnd.hidden = false;
    try { el.ctlEnd.querySelector('[data-kfs="again"]').focus({ preventScroll: true }); } catch (e) {}
  }
  function probeLate(now) {                            // 그림으로 시작한 옷: 1.5초 안에 영상이 준비되면 그때 처음부터 튼다
    var s = slots[front];
    if (s._kind !== 'still' || show.end || now - show.t0 > LATE_MS || now - (show.probe || 0) < PROBE_MS) return;
    show.probe = now;
    var o = show.list[show.i], p = planOf(o);
    if (calm() || p.kind === 'still') {                // 그림 자리: 첫 장면 그림이 새로 받아졌으면 그것으로만 바꾼다
      var im = s.querySelector('img');
      if (p.still && im.getAttribute('src') !== p.still) im.setAttribute('src', p.still);
      return;
    }
    slotLoad(s, o, false); playSlot(s);
    show.t0 = now; show.acc = 0;
  }
  function holdFirst(now) {                            // 첫 옷: 패션쇼 영상이 올 때까지(최대 2.5초) 시계를 세우지 않는다. 다 됐으면 true
    if (!show.hold) return true;
    var o = show.list[show.i], p = planOf(o);
    if (p.kind !== 'show' && now < show.hold) return false;
    show.hold = 0;
    var s = slots[front];
    if (RANK[p.kind] > RANK[s._kind || 'still'] && !calm()) slotLoad(s, o, false);
    playSlot(s);
    show.t0 = now; show.acc = 0; show.probe = 0;
    return true;
  }
  function loop(now) {
    if (!show) return;
    if (show.started && !show.paused && !show.end && holdFirst(now)) {
      probeLate(now);
      var p = (show.acc + (now - show.t0) / 1000) / SEG;
      paintBars(p);
      if (p >= 1) { if (show.i + 1 < show.list.length) goTo(show.i + 1); else finish(); }
    }
    show.raf = requestAnimationFrame(loop);
  }
  function pause(on) {
    if (!show || show.end || !show.started || on === show.paused) return;
    if (show.hold) { show.hold = 0; show.t0 = performance.now(); show.acc = 0; }   // 첫 옷을 기다리는 중에 멈춤 → 기다림은 끝내고 그 자리에서 멈춘다
    var s = slots[front];
    if (on) { show.acc += (performance.now() - show.t0) / 1000; show.paused = true; stopSlot(s); }
    else { show.t0 = performance.now(); show.paused = false; playSlot(s); }
    setPlayIcon();
  }
  function start() {
    if (!show || show.started) return;
    show.started = true; show.paused = !!document.hidden;   // 여는 글 동안 화면이 숨겨졌으면 멈춘 채 시작합니다
    el.intro.classList.remove('go');
    show.t0 = performance.now(); show.acc = 0; show.probe = 0;
    var p0 = planOf(show.list[show.i]), s0 = slots[front];
    if (!calm() && p0.hasShow && p0.kind !== 'show') show.hold = show.t0 + FIRST_WAIT_MS;   // 첫 옷의 패션쇼 영상을 받는 중 → 조금 기다린다
    else {
      if (!calm() && RANK[p0.kind] > RANK[s0._kind || 'still']) slotLoad(s0, show.list[show.i], false);   // 여는 글 동안 더 나은 영상이 받아졌으면 그것으로
      if (!show.paused) playSlot(s0);
    }
    setPlayIcon();
  }

  /* ---- 누름 ---- */
  function onClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-kfs]') : null;
    if (!b || !show) return;
    var k = b.getAttribute('data-kfs');
    if (k === 'skip') { start(); return; }
    if (k === 'close') { close(); return; }
    if (!show.started) start();
    if (k === 'play') { pause(!show.paused); return; }
    if (k === 'prev') { goTo(Math.max(0, show.i - 1)); return; }
    if (k === 'next') { if (show.i + 1 < show.list.length) goTo(show.i + 1); else finish(); return; }
    if (k === 'again') { goTo(0); return; }
    if (k === 'wear') {
      var o = show.list[show.i]; if (!o || o.id === api.cur()) return;
      close(false, function () { try { api.wear(o.id); } catch (e) {} });   // 쇼를 닫고(0.22초) 꾸미기에서 갈아입는다 — 옷장 칸을 누를 때와 같은 함수
    }
  }

  /* ---- 열고 닫기 ---- */
  function under(on) {                                 // 뒤에 깔린 화면은 읽어 주는 프로그램 · 키보드가 지나치게(inert) — 「케이 무대」와 같은 방식
    try { var a = document.querySelector('.app'); if (a) { if (on) a.setAttribute('inert', ''); else a.removeAttribute('inert'); } } catch (e) {}
  }
  function open() {
    if (!api || !build()) return false;
    if (show) return true;
    var list = []; try { list = api.list() || []; } catch (e) { list = []; }
    if (!list.length) return false;
    clearTimeout(closing);
    show = { list: list, i: 0, t0: 0, acc: 0, paused: true, end: false, started: false, probe: 0, raf: 0 };
    qSeen = {};
    root.classList.toggle('calm', calm());
    root.classList.remove('leave'); root.classList.add('open');
    if (!calm()) { root.classList.remove('enter'); void root.offsetWidth; root.classList.add('enter'); setTimeout(function () { if (root) root.classList.remove('enter'); }, 340); }
    bars(); paintBars(0);
    slots[0].style.opacity = 1; slots[1].style.opacity = 0; slots[0].style.zIndex = 2; slots[1].style.zIndex = 1; front = 0;
    slotLoad(slots[0], list[0], false);
    tag(list[0], 0, false); setPlayIcon();
    el.ctlShow.hidden = false; el.ctlEnd.hidden = true;
    el.introSub.textContent = '옷 ' + list.length + '벌';
    want(0); want(1); want(2);
    under(true);
    try { root.focus({ preventScroll: true }); } catch (e) {}
    if (calm()) start();
    else { el.intro.classList.remove('go'); void el.intro.offsetWidth; el.intro.classList.add('go'); show.introT = setTimeout(start, INTRO_MS); }   // 여는 글은 누르면 바로 넘어간다
    show.raf = requestAnimationFrame(loop);
    return true;
  }
  function close(now, after) {
    if (!show) return;
    cancelAnimationFrame(show.raf); clearTimeout(show.introT);
    show = null;
    slots.forEach(function (s) { stopSlot(s); });
    el.intro.classList.remove('go');
    under(false);
    var fin = function () {
      if (!root) return;
      root.classList.remove('open', 'leave', 'enter');
      slots.forEach(function (s) { var v = s.querySelector('video'); if (v.getAttribute('src')) { v.removeAttribute('src'); try { v.load(); } catch (e) {} } s.classList.remove('vid-on', 'kb'); });
      if (after) after();
    };
    clearTimeout(closing);
    if (now || calm()) { fin(); return; }
    root.classList.add('leave');
    closing = setTimeout(fin, 220);
    try { var o = document.getElementById('kwShowBtn'); if (o && !after) o.focus({ preventScroll: true }); } catch (e) {}   // 키보드(PC판)로 쓰던 자리로
  }
  // 지금 옷이 바뀌었을 때(다른 기기에서 맞춰 옴 등) 「입는 중」 딱지와 「이 옷 입기」 단추를 바로 맞춘다(움직임 없이)
  function refresh() {
    if (!show) return;
    if (show.end) { var cur = curOutfit(); el.nm.innerHTML = esc(cur.name) + '<span class="kfs-badge">입는 중</span><small>지금 옷으로 돌아왔습니다</small>'; return; }
    tag(show.list[show.i], show.i, false);
  }

  window.KFShow = {
    init: function (a) { api = a || null; if (a && typeof a.seg === 'number' && a.seg >= 2 && a.seg <= 30) SEG = a.seg; },
    open: open, close: close, refresh: refresh,
    isOpen: function () { return !!show; },
    state: function () {                               // 시험·확인용(읽기만)
      if (!show) return null;
      var s = slots[front], v = s ? s.querySelector('video') : null, im = s ? s.querySelector('img') : null;
      return { i: show.i, n: show.list.length, ids: show.list.map(function (o) { return o.id; }), end: show.end, paused: show.paused, started: show.started, seg: SEG,
        kind: s ? s._kind : '', shown: s ? s._id : '', vidOn: !!(s && s.classList.contains('vid-on')), vt: v ? v.currentTime : 0, vPaused: v ? v.paused : true,
        vSrc: v ? (v.getAttribute('src') || '') : '', img: im ? (im.getAttribute('src') || '') : '' };
    }
  };
})();
