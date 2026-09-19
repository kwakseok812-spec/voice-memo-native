/* ============================================================================
 * install.js  —  홈 화면 "설치" 안내 모듈 (독립)
 * ----------------------------------------------------------------------------
 * - 배너를 맨 위에 항상 보여준다(설치 방법 링크 + "설치 안 돼도 그냥 쓸 수 있어요" 안내).
 * - 크롬이 설치 가능해지면(beforeinstallprompt) 큰 "설치" 버튼을 자동으로 띄운다.
 * - 버튼을 누르면 네이티브 설치창을 연다(제스처 1회 필요 — 완전자동은 불가).
 * - 설치되면(appinstalled) 배너를 숨긴다.
 * - "설치 방법 보기"를 누르면 현재 브라우저를 감지해 그 브라우저 안내만 크게 보여준다.
 * - 이미 앱 모드(standalone)면 배너를 숨긴다.
 * ==========================================================================*/

(function () {
  'use strict';

  var bar = document.getElementById('installBar');
  var btn = document.getElementById('installBtn');
  var help = document.getElementById('installHelpLink');
  var helpBox = document.getElementById('installHelp');
  if (!bar || !btn) return;

  var deferredPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

  // 이미 설치되어 앱으로 열림 → 배너 숨김
  if (isStandalone()) { bar.style.display = 'none'; return; }

  // 배너는 항상 보이게(설치 방법 링크 + 안내문). 큰 버튼은 이벤트가 오면 표시.
  bar.style.display = 'block';
  if (help) help.style.display = 'inline';

  // 1) 크롬이 "설치 가능" 신호 → 큰 설치버튼 자동 표시
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = 'block';
  });

  // 2) 버튼 → 네이티브 설치창
  btn.addEventListener('click', function () {
    if (!deferredPrompt) { showHelp(); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') { bar.style.display = 'none'; }
      else { showHelp(); }
      deferredPrompt = null;
    });
  });

  // 3) 설치 완료 → 배너 숨김
  window.addEventListener('appinstalled', function () {
    btn.textContent = '✅ 설치됨';
    setTimeout(function () { bar.style.display = 'none'; }, 2000);
  });

  // 4) 브라우저 감지 안내
  function browserGuide() {
    var ua = navigator.userAgent || '';
    if (/SamsungBrowser/i.test(ua)) {
      return '<b>삼성 인터넷</b>에서 설치:<br>아래쪽 <b>≡ 메뉴</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.';
    }
    if (/FxiOS|CriOS/i.test(ua) || /iPhone|iPad|iPod/i.test(ua)) {
      return '<b>iPhone(사파리)</b>에서 설치:<br>아래 <b>공유 버튼</b>(□↑) → <b>홈 화면에 추가</b>를 누르세요.<br>(※ 아이폰은 음성 인식이 지원되지 않습니다.)';
    }
    if (/Android/i.test(ua) && /Chrome/i.test(ua)) {
      return '<b>크롬(Chrome)</b>에서 설치:<br>오른쪽 위 <b>⋮ 메뉴</b> → <b>앱 설치</b>(또는 <b>홈 화면에 추가</b>)를 누르세요.<br>메뉴에 안 보이면, 이 배너의 파란 <b>설치</b> 버튼이 뜰 때까지 잠시 기다렸다가 누르세요.';
    }
    return '<b>크롬</b>: ⋮ 메뉴 → "앱 설치".<br><b>삼성 인터넷</b>: ≡ 메뉴 → "현재 페이지 추가" → "홈 화면".';
  }
  function showHelp() {
    if (!helpBox) return;
    helpBox.innerHTML = browserGuide();
    helpBox.style.display = 'block';
  }
  if (help) { help.addEventListener('click', function (ev) { ev.preventDefault(); showHelp(); }); }
})();
