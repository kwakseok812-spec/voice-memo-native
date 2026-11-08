/* ============================================================================
 * phone-apps.js — 폰의 다른 앱을 스마트비서에서 열어 주는 통로 (v9.80, O-0781)
 * ----------------------------------------------------------------------------
 * 무엇: ① 홈 「OTT」 칸(v9.80 까지 「영상」) → 5줄 목록 시트(유튜브·넷플릭스·웨이브·티빙·디즈니+)  ② 업무 앱 화면 맨 위 「포인트 앱 바로 열기」(캐시워크·손목닥터·에이헬스·야핏무브·캐시슬라이드 스텝업·토스·KB스타포인트)
 *       누르면 그 폰 앱의 첫 화면이 열린다(앱을 합치는 것이 아니라 열어 주는 통로). 앱 안의 특정 화면(토스 만보기·KB 스타포인트 화면)으로는 들어가지 않는다 — 첫 화면만.
 * 어떻게: 기존 네이티브 ExternalApp.launchApp({pkg}) · openStore({pkg}) 를 그대로 쓴다(새 네이티브 방법 없음). 열 수 있는 앱은 자바 허용 목록에 있는 것만이다.
 *       목록은 이 파일에 고정(서버·SQL 변경 없음 — 연동 암호·인터넷이 없어도 항상 보인다).
 * 세 곳이 같아야 한다(어긋나면 시험 phone_apps_test.py 가 잡는다): 이 파일의 패키지 ⇔ ExternalAppPlugin.java LAUNCH_ALLOWED ⇔ AndroidManifest.xml <queries><package>.
 *       앱을 하나 더 넣을 때마다 앱 업데이트(새 APK)가 필요하다. 금융 앱(토스·KB스타뱅킹)도 실행만 한다 — 로그인·계좌·포인트 값은 읽지도 입력하지도 않는다.
 * 유튜브 줄: 기존 app.js 의 openBrave(Brave 지정·「Brave 앱이 없습니다」 시트·PC 새 탭)를 그대로 부른다(ctx.openBrave).
 * 연타: 홈 칸·시트 줄·업무 앱 카드·유튜브가 하나의 잠금(700ms)을 쓴다 — 같은 줄이 두 번, 다른 앱 두 개가 겹쳐 열리지 않는다.
 * PC(비 Capacitor)·폰 일반 브라우저: 화면은 폰과 똑같이 보이고 동작만 다르다 — 유튜브 줄 = 새 탭, 나머지 = 「폰에서만 열립니다」 안내.
 * 스위치(app.js): VIDEO_TAB('on'|'brave'|'off') · POINT_APPS('on'|'off').
 * app.js 연결: PhoneApps.init({toast, openSheet, openBrave}) · PhoneApps.openVideoSheet() · PhoneApps.openApp(id) · PhoneApps.tryLock()
 * 시험: PhonePure(순수 함수·목록)는 화면 없이 시험할 수 있게 밖으로 내놓았다(node 에서도 require 가능).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 목록·순수 함수
   * ===================================================================*/
  var PC_DESC = '폰에서만 열립니다';
  var PC_MSG = '폰에서만 열립니다 — 폰의 스마트비서에서 눌러 주세요.';
  var OLD_APK_MSG = '앱을 새 버전으로 바꾸면 바로 열 수 있습니다.';

  /* OTT 시트 5줄(순서 그대로). brave:true = 기존 유튜브(Brave) 동작. 패키지는 플레이 스토어 앱 제목으로 확인한 값(설계안 3장). */
  var VIDEO = [
    { id: 'youtube', name: '유튜브', desc: 'Brave로 열기', brave: true },
    { id: 'netflix', name: '넷플릭스', pkg: 'com.netflix.mediaclient', desc: '앱 열기' },
    { id: 'wavve', name: '웨이브', pkg: 'kr.co.captv.pooqV2', desc: '앱 열기' },        // 옛 푹 시절 주소(…pooq)는 플레이에서 404 — 쓰지 않는다
    { id: 'tving', name: '티빙', pkg: 'net.cj.cjhv.gs.tving', desc: '앱 열기' },
    { id: 'disney', name: '디즈니+', pkg: 'com.disney.disneyplus', desc: '앱 열기' }
  ];
  /* 업무 앱 「포인트 앱 바로 열기」 7장(순서 그대로, 2열 같은 크기 칸 — 칸에는 아이콘과 앱 이름만, 설명어구 없음). store = 미설치 시트·실패 토스트에 쓰는 스토어 이름(카드 이름과 다를 때만).
   * v9.81: 「머니워크(에이헬스)」→「에이헬스」, 「캐시슬라이드」(잠금화면 앱 com.cashslide — 걷기 앱이 아님)→「캐시슬라이드 스텝업」(com.nbt.moves, 플레이 스토어 제목 「캐시슬라이드 스텝업 - 걸으면 돈버는 만보기」, NBT Inc.). */
  var POINTS = [
    { id: 'cashwalk', name: '캐시워크', pkg: 'com.cashwalk.cashwalk', icon: '👟' },                       // 한국판 하나만(같은 이름 해외·일본판은 다른 앱)
    { id: 'wristdoctor', name: '손목닥터', pkg: 'kr.go.seoul.healthcare', icon: '⌚' },
    { id: 'ahealth', name: '에이헬스', pkg: 'com.tracerofficial', icon: '💰' },                           // 스토어 제목 「에이헬스 - 구 머니워크」 (옛 머니워크 이름은 화면에 쓰지 않는다)
    { id: 'yafitmove', name: '야핏무브', pkg: 'kr.co.openit.openrider', icon: '🏃' },                      // 야핏사이클(com.yafit.cycle)은 다른 앱
    { id: 'stepup', name: '캐시슬라이드 스텝업', pkg: 'com.nbt.moves', icon: '🔓' },                      // 잠금화면 앱 com.cashslide 는 다른 앱(넣지 않는다)
    { id: 'toss', name: '토스', pkg: 'viva.republica.toss', icon: '💙' },                                 // 토스 만보기는 별도 앱이 아니라 토스 앱 안 기능
    { id: 'kbstar', name: 'KB스타포인트', store: 'KB스타뱅킹', pkg: 'com.kbstar.kbbank', icon: '⭐' }          // 스타포인트는 KB스타뱅킹 앱 안 메뉴 — 미설치 시트에서만 「KB스타뱅킹」
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function all() { return VIDEO.concat(POINTS); }
  function byId(id) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function packages() { return all().filter(function (x) { return x.pkg; }).map(function (x) { return x.pkg; }); }
  function storeName(it) { return (it && (it.store || it.name)) || ''; }
  /* 조사 「을(를)」을 쓰지 않는다 — 「○○ 앱이 없습니다 / ○○ 앱을 열지 못했습니다」로 고정(앱 이름 끝소리와 무관하게 자연스럽다) */
  function missingTitle(n) { return n + ' 앱이 없습니다'; }
  function missingMsg(n) { return '플레이 스토어에서 ' + n + ' 앱을 설치한 뒤 다시 눌러 주세요.'; }
  function failMsg(n) { return n + ' 앱을 열지 못했습니다 — 다시 눌러 주세요.'; }
  /* 목록이 말이 되는가(중복·빠진 칸·패키지 모양). 문제 목록을 돌려준다(빈 배열 = 정상). */
  function validate() {
    var bad = [], ids = {}, pk = {};
    all().forEach(function (x) {
      if (!x.id || ids[x.id]) bad.push('id 중복/없음: ' + x.id); ids[x.id] = 1;
      if (!x.name || (!x.desc && !x.icon)) bad.push('이름/설명 없음: ' + x.id);
      if (x.pkg) {
        if (!/^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(x.pkg)) bad.push('패키지 모양: ' + x.pkg);
        if (pk[x.pkg]) bad.push('패키지 중복: ' + x.pkg); pk[x.pkg] = 1;
      } else if (!x.brave) bad.push('패키지 없음: ' + x.id);
    });
    POINTS.forEach(function (x) { if (!x.icon) bad.push('아이콘 없음: ' + x.id); });
    return bad;
  }

  var PhonePure = { VIDEO: VIDEO, POINTS: POINTS, PC_DESC: PC_DESC, PC_MSG: PC_MSG, OLD_APK_MSG: OLD_APK_MSG, all: all, byId: byId, packages: packages, storeName: storeName, missingTitle: missingTitle, missingMsg: missingMsg, failMsg: failMsg, validate: validate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = { PhonePure: PhonePure }; }
  if (typeof document === 'undefined') return;   // node 시험: 화면 부분은 건너뜀

  /* =====================================================================
   * 2. 화면·앱 열기
   * ===================================================================*/
  var ctx = null, lastGo = 0;

  function isNative() { var C = global.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
  function plugin() { return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.ExternalApp; }
  /* 하나의 잠금(700ms): 잠금을 얻은 쪽만 앱을 연다. 유튜브(openBrave)도 같은 잠금을 쓴다. */
  function tryLock() { var n = Date.now(); if (n - lastGo < 700) return false; lastGo = n; return true; }

  function openApp(id) {
    var it = byId(id);
    if (!ctx || !it || !it.pkg) return false;
    if (!tryLock()) return false;
    if (!isNative()) { ctx.toast(PC_MSG, 3200); return false; }
    var EA = plugin();
    if (!EA || typeof EA.launchApp !== 'function') { ctx.toast(OLD_APK_MSG, 3000); return false; }
    var nm = storeName(it);
    var fail = function () { ctx.toast(failMsg(nm), 2800); };
    var storeFail = function () { ctx.toast('플레이 스토어를 열지 못했습니다.'); };
    try {
      EA.launchApp({ pkg: it.pkg }).then(function (r) {
        if (r && r.opened) return;   // 그 앱이 앞으로 나옴 — 말 없이 끝
        if (r && r.reason === 'not_installed') {
          ctx.openSheet(missingTitle(nm), missingMsg(nm), '스토어 열기', function () {
            try { EA.openStore({ pkg: it.pkg }).then(function (s) { if (!s || !s.opened) storeFail(); }, storeFail); } catch (e) { storeFail(); }
          }, null, null, { positive: true, icon: 'i-download' });
          return;
        }
        fail();
      }, fail);
    } catch (e) { fail(); }
    return true;
  }

  /* OTT 5줄 시트 — 채팅 ＋ 고르기 창(atm-sheet)과 같은 틀(뒤로 가기로 닫힘은 app.js goBack 의 .shin-sheet 처리가 맡는다) */
  function openVideoSheet() {
    if (!ctx) return;
    var old = document.querySelector('.atm-sheet'); if (old) { try { old.remove(); } catch (e) {} }
    var native = isNative();
    var sh = document.createElement('div');
    sh.className = 'sheet shin-sheet atm-sheet vid-sheet';
    sh.innerHTML = '<div class="sheet-box" role="dialog" aria-label="OTT 앱 고르기"><div class="sheet-head">무엇을 볼까요?</div>' +
      VIDEO.map(function (v) {
        var d = (!native && !v.brave) ? PC_DESC : v.desc;
        return '<button type="button" class="sheet-btn" data-vid="' + esc(v.id) + '"><svg class="atm-ic"><use href="#i-play"/></svg><span><b>' + esc(v.name) + '</b><small>' + esc(d) + '</small></span></button>';
      }).join('') +
      '<button type="button" class="sheet-btn atm-close" data-vid="close">닫기</button></div>';
    sh.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-vid]') : null;
      if (!b && ev.target !== sh) return;
      var k = b && b.getAttribute('data-vid'), v = (k && k !== 'close') ? byId(k) : null;
      if (v && !v.brave && !isNative()) { ctx.toast(PC_MSG, 3200); return; }   // PC: 열 수 없는 줄은 안내만 하고 시트는 그대로
      try { sh.remove(); } catch (e) {}
      if (!v) return;
      if (v.brave) { try { ctx.openBrave(); } catch (e) {} }
      else openApp(v.id);
    });
    document.body.appendChild(sh);
    sh.style.display = 'flex';
  }

  function init(c) { ctx = c; return true; }

  global.PhoneApps = {
    init: init, openApp: openApp, openVideoSheet: openVideoSheet, tryLock: tryLock, isNative: isNative,
    VIDEO: VIDEO, POINTS: POINTS, PC_DESC: PC_DESC,
    _test: { lastGo: function () { return lastGo; } }
  };
  global.PhonePure = PhonePure;
})(typeof window !== 'undefined' ? window : globalThis);
