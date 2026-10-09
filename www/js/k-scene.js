/* ============================================================================
 * k-scene.js — 「일하는 케이」(v9.4)
 * ----------------------------------------------------------------------------
 * 화면마다 케이가 그 화면의 일을 하는 모습으로 서 있고(허리 위 · 배경 없는 그림), 옆 말풍선으로 한마디 한다.
 *   자리(장면)는 index.html 에 미리 있다:  <div class="ksc" id="…"><div class="ksc-l">…<div class="ksp"><b>케이</b><p></p></div></div>
 *                                          <span class="kfigw"><img class="kfig"></span></div>
 *   각 화면의 코드(app.js · health.js · today-card.js)가 「자기가 이미 가진 값」으로 KScene.set(id, 자세, 한마디)를 부른다.
 * 지키는 선
 *   · 한마디는 앱이 실제로 아는 값으로만. 값이 없으면 set(id, '', '') → 장면이 숨는다. AI 호출·새 서버 조회·짐작 없음.
 *   · 화면당 한마디. 재촉·평가·건강 판단 없음(수와 칸 이름만 말한다).
 *   · 새 버튼·새 알림 없음 — 장면은 누르는 곳이 아니다.
 *   · 전부 정지 그림이라 「움직임」 끔 · 움직임 줄이기 설정과 무관하게 같다.
 *   · 자세 그림은 「기본 머리 + 그 자세 그림이 있는 옷」에서만(KChar.poseUrl). 그 밖의 옷·머리는 그 옷의 표정 사진을 액자처럼 세워 대신한다.
 * 자세: note 받아 적기 · report 서류 건네기 · desk 책상에서 일하기 · guide 안내 손짓 · clip 기록판 · sorry 사과 인사 · idle 평소(웃는 상반신)
 * ==========================================================================*/
(function () {
  'use strict';
  // 자세 그림이 없을 때 대신 쓰는 표정(그 옷의 표정 사진)
  var POSE_EXPR = { note: 'neutral', report: 'smile', desk: 'thinking', guide: 'smile', clip: 'neutral', sorry: 'concern', idle: 'smile' };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // 그 자세의 그림: {src, cut}. cut=true 는 배경 없는 자세 그림, false 는 표정 사진(액자 모양으로 보인다).
  function fig(pose) {
    var K = window.KChar; if (!K) return { src: '', cut: false };
    var u = K.poseUrl ? K.poseUrl(pose) : '';
    if (u) return { src: u, cut: true };
    return { src: K.exprUrl(POSE_EXPR[pose] || 'neutral'), cut: false };
  }
  function paintFig(host, pose) {
    var im = host.querySelector('.kfig'); if (!im) return;
    var f = fig(pose);
    if (f.src && im.getAttribute('src') !== f.src) im.setAttribute('src', f.src);
    host.classList.toggle('cut', f.cut); host.classList.toggle('photo', !f.cut);
  }
  // 장면 하나 맞추기. text 가 비면 숨긴다.
  function set(id, pose, text) {
    var el = typeof id === 'string' ? $(id) : id; if (!el) return;
    if (!text) { el.style.display = 'none'; el.removeAttribute('data-pose'); return; }
    el.style.display = '';
    el.setAttribute('data-pose', pose || 'idle');
    paintFig(el, pose || 'idle');
    var p = el.querySelector('.ksp p'); if (p && p.textContent !== text) p.textContent = text;
  }
  // 빈 화면·오류 자리에 넣을 덩어리(케이가 크게 + 말풍선). 그 화면의 코드가 innerHTML 로 넣는다.
  function emptyHtml(pose, text) {
    var f = fig(pose);
    return '<div class="kempty ' + (f.cut ? 'cut' : 'photo') + '" data-pose="' + esc(pose) + '" role="status">' +
      '<span class="kfigw"><img class="kfig" alt="케이" draggable="false" src="' + esc(f.src) + '"></span>' +
      '<div class="ksp"><b>케이</b><p>' + esc(text) + '</p></div></div>';
  }
  // 그림만(빈 대화의 큰 케이)
  function figHtml(pose, cls) {
    var f = fig(pose);
    return '<span class="kfigw ' + (cls || '') + ' ' + (f.cut ? 'cut' : 'photo') + '" data-pose="' + esc(pose) + '"><img class="kfig" alt="케이" draggable="false" src="' + esc(f.src) + '"></span>';
  }
  // 옷·머리를 바꾸면 화면에 있는 장면 그림을 전부 그 모습으로
  function repaint() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-pose]'), function (el) {
      var pose = el.getAttribute('data-pose'); if (!pose || !el.querySelector('.kfig')) return;
      paintFig(el, pose);
    });
  }
  if (window.KChar) {
    try { KChar.onChange(repaint); KChar.ready.then(repaint); if (KChar.catalogReady) KChar.catalogReady.then(repaint); } catch (e) {}
  }
  window.KScene = { set: set, fig: fig, emptyHtml: emptyHtml, figHtml: figHtml, repaint: repaint };
})();
