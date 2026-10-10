/* ============================================================================
 * k-scene.js — 「일하는 케이」(v9.4) + 가벼운 움직임(v9.5)
 * ----------------------------------------------------------------------------
 * 화면마다 케이가 그 화면의 일을 하는 모습으로 서 있고(허리 위 · 배경 없는 그림), 옆 말풍선으로 한마디 한다.
 *   자리(장면)는 index.html 에 미리 있다:  <div class="ksc" id="…"><div class="ksc-l">…<div class="ksp"><b>케이</b><p></p></div></div>
 *                                          <span class="kfigw"><img class="kfig"></span></div>
 *   각 화면의 코드(app.js · health.js · today-card.js)가 「자기가 이미 가진 값」으로 KScene.set(id, 자세, 한마디)를 부른다.
 * 지키는 선
 *   · 한마디는 앱이 실제로 아는 값으로만. 값이 없으면 set(id, '', '') → 장면이 숨는다. AI 호출·새 서버 조회·짐작 없음.
 *   · 화면당 한마디. 재촉·평가·건강 판단 없음(수와 칸 이름만 말한다).
 *   · 새 버튼·새 알림 없음 — 장면은 누르는 곳이 아니다.
 *   · 자세 그림은 「지금 보이는 모습이 기본 머리 + 그 자세 그림이 있는 옷」에서만(KChar.poseUrl — 서버에서 받는 옷은 받아 둔 뒤).
 *     그 밖의 옷·머리 · 아직 못 받은 때는 그 옷의 표정 사진을 액자처럼 세워 대신한다.
 * 움직임(v9.5 — 그림은 그대로, 나타나는 방식만):
 *   · 화면을 열어 장면이 처음 보일 때: 케이와 말풍선이 스르륵 올라오고, 한마디가 말하듯 차례로 찍힌다(길어도 0.9초).
 *   · 같은 화면에서 자세가 바뀔 때: 그림이 부드럽게 바뀌고 한마디가 다시 찍힌다. 글자만 바뀔 때(「12분째」→「13분째」)는 그냥 바뀐다.
 *   · 글자가 찍히는 동안에도 자리(줄 수·높이)는 처음부터 다 잡혀 있어 화면이 흔들리지 않고, 장면은 누르기를 막지 않는다.
 *   · 케이 「움직임」을 껐거나 폰이 「움직임 줄이기」면 전부 꺼진다(바로 다 보인다). opt.quiet 로 부르는 자리(건강 머리줄)도 항상 바로.
 * 자세: note 받아 적기 · report 서류 건네기 · desk 책상에서 일하기 · guide 안내 손짓 · clip 기록판 · sorry 사과 인사 · idle 평소(웃는 상반신)
 * ==========================================================================*/
(function () {
  'use strict';
  // 자세 그림이 없을 때 대신 쓰는 표정(그 옷의 표정 사진)
  var POSE_EXPR = { note: 'neutral', report: 'smile', desk: 'thinking', guide: 'smile', clip: 'neutral', sorry: 'concern', idle: 'smile' };
  var TYPE_STEP = 30, TYPE_MIN = 280, TYPE_MAX = 900;       // 글자 찍힘: 30ms 마다 · 전체 0.28~0.9초
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // 움직임을 쓰지 않는가(케이 움직임 끔 · 절전 · 폰 「움직임 줄이기」)
  function calm() {
    try {
      if (window.KChar && KChar.motionOn && !KChar.motionOn()) return true;
      return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // 그 자세의 그림: {src, cut}. cut=true 는 배경 없는 자세 그림, false 는 표정 사진(액자 모양으로 보인다).
  function fig(pose) {
    var K = window.KChar; if (!K) return { src: '', cut: false };
    var u = K.poseUrl ? K.poseUrl(pose) : '';
    if (u) return { src: u, cut: true };
    return { src: K.exprUrl(POSE_EXPR[pose] || 'neutral'), cut: false };
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function paintFig(host, pose, swap) {
    var im = host.querySelector('.kfig'); if (!im) return;
    var f = fig(pose);
    if (f.src && im.getAttribute('src') !== f.src) {
      im.setAttribute('src', f.src);
      if (swap && !calm()) restart(im, 'kfig-swap');
    }
    host.classList.toggle('cut', f.cut); host.classList.toggle('photo', !f.cut);
  }
  /* ---- 한마디가 말하듯 찍히기 ----
   * p 안을 [보이는 부분][아직 안 보이는 부분(투명)] 두 조각으로 두고 경계만 옮긴다 → 줄 수·높이가 처음부터 그대로다.
   * p.textContent 는 언제 읽어도 전체 문장이다. */
  // 찍히는 동안에는 그 알림 자리(role="status")를 aria-busy 로 두어 화면 읽기가 30ms 마다 바뀌는 조각을 읽지 않게 하고, 끝나면 풀어 전체 문장을 한 번 읽게 한다.
  function busy(p, on) { var h = p.closest ? p.closest('[role="status"]') : null; if (!h) return; if (on) h.setAttribute('aria-busy', 'true'); else h.removeAttribute('aria-busy'); }
  function stopType(p) { if (p._kt) { clearInterval(p._kt); p._kt = 0; } busy(p, false); }
  function type(p, text) {
    stopType(p);
    if (calm() || text.length < 3) { p.textContent = text; return; }
    var on = document.createElement('span'), off = document.createElement('span');
    off.className = 'kt-off';
    busy(p, true);
    p.textContent = ''; p.appendChild(on); p.appendChild(off);
    off.textContent = text;
    var total = Math.max(TYPE_MIN, Math.min(TYPE_MAX, text.length * TYPE_STEP));
    var per = Math.max(1, Math.ceil(text.length / (total / TYPE_STEP))), i = 0;
    p._kt = setInterval(function () {
      i = Math.min(text.length, i + per);
      on.textContent = text.slice(0, i); off.textContent = text.slice(i);
      if (i >= text.length) { p.textContent = text; stopType(p); }
    }, TYPE_STEP);
  }
  // 장면 하나 맞추기. text 가 비면 숨긴다. opt.quiet = 움직임 없이 바로(빨리 쓰는 화면).
  function set(id, pose, text, opt) {
    var el = typeof id === 'string' ? $(id) : id; if (!el) return;
    opt = opt || {};
    var p = el.querySelector('.ksp p');
    if (!text) { el.style.display = 'none'; el.removeAttribute('data-pose'); el._kShown = false; if (p) stopType(p); return; }
    pose = pose || 'idle';
    var fresh = !el._kShown || el.style.display === 'none';
    var oldPose = el.getAttribute('data-pose');
    el.style.display = '';
    el.setAttribute('data-pose', pose);
    paintFig(el, pose, !fresh && !opt.quiet && oldPose !== pose);
    el._kShown = true;
    if (calm() || opt.quiet) el.classList.remove('ksc-in');
    else if (fresh) restart(el, 'ksc-in');
    if (p && p.textContent !== text) {
      if (!opt.quiet && (fresh || oldPose !== pose)) type(p, text);
      else { stopType(p); p.textContent = text; }
    }
  }
  // 화면을 새로 열었다(app.js openScreen·showHome) → 다음에 맞추는 장면은 「처음 보이는 것」으로 친다
  function reset() {
    Array.prototype.forEach.call(document.querySelectorAll('.ksc'), function (el) { el._kShown = false; });
  }
  // 빈 화면·오류 자리에 넣을 덩어리(케이가 크게 + 말풍선). 그 화면의 코드가 innerHTML 로 넣는다.
  function emptyHtml(pose, text) {
    var f = fig(pose);
    return '<div class="kempty ' + (f.cut ? 'cut' : 'photo') + (calm() ? '' : ' ksc-in') + '" data-pose="' + esc(pose) + '" role="status">' +
      '<span class="kfigw"><img class="kfig" alt="케이" draggable="false" src="' + esc(f.src) + '"></span>' +
      '<div class="ksp"><b>케이</b><p>' + esc(text) + '</p></div></div>';
  }
  // 그림만(빈 대화의 큰 케이)
  function figHtml(pose, cls) {
    var f = fig(pose);
    return '<span class="kfigw ' + (cls || '') + ' ' + (f.cut ? 'cut' : 'photo') + '" data-pose="' + esc(pose) + '"><img class="kfig" alt="케이" draggable="false" src="' + esc(f.src) + '"></span>';
  }
  // 옷·머리를 바꾸거나 서버 자산을 받아 오면 화면에 있는 장면 그림을 전부 그 모습으로
  function repaint() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pose]'), function (el) {
      var pose = el.getAttribute('data-pose'); if (!pose || !el.querySelector('.kfig')) return;
      paintFig(el, pose, false);
    });
  }
  if (window.KChar) {
    try { KChar.onChange(repaint); KChar.ready.then(repaint); if (KChar.catalogReady) KChar.catalogReady.then(repaint); } catch (e) {}
  }
  window.KScene = { set: set, fig: fig, emptyHtml: emptyHtml, figHtml: figHtml, repaint: repaint, reset: reset, calm: calm };
})();
