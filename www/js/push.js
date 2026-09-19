/* ============================================================================
 * push.js  —  FCM 푸시 알림 (안드로이드 네이티브 전용)
 * ----------------------------------------------------------------------------
 * 앱 시작 시: 알림 권한 요청 → 등록 → FCM 토큰 획득 → Supabase 우편함(push_tokens)에
 *   업서트(교수님 기기 식별). 케이(PC 워커)가 답장을 기록하면 그 토큰들로 푸시를 쏜다.
 *
 * 화면 전환은 이 파일이 직접 하지 않고, window 이벤트로 app.js 에 넘긴다(결합 최소화):
 *   - smartOpenChat : 알림을 탭했을 때 → 케이 대화 열기
 *   - smartChatPush : 앱이 열려 있을 때 알림 수신 → 답을 즉시 당겨오기(배지 갱신)
 *
 * 여기 쓰는 키는 **공개(publishable) 키뿐**(office-bridge.js 와 동일). 토큰 저장은
 * anon 의 INSERT/UPSERT 만 허용된다(RLS). 발송은 PC 가 비밀 키로 한다(앱엔 없음).
 * 일반 브라우저(비네이티브)에서는 아무것도 하지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var Cap = global.Capacitor;
  function isNative() {
    return Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform();
  }
  function cfg() { return (global.OfficeBridge && OfficeBridge.CONFIG) || null; }
  function logi(m) { if (global.console) try { console.log('[push] ' + m); } catch (e) {} }
  function logw(m) { if (global.console) try { console.warn('[push] ' + m); } catch (e) {} }

  var LS_TOKEN = 'smart_push_token', LS_AT = 'smart_push_saved_at';
  var SAVE_MIN_INTERVAL = 12 * 60 * 60 * 1000;   // 같은 토큰은 12시간에 한 번만 재기록(불필요한 쓰기 방지)

  // FCM 토큰을 우편함(push_tokens)에 업서트. publishable 키 + Prefer: merge-duplicates.
  function saveToken(tok) {
    var c = cfg();
    if (!c || !tok) return Promise.resolve(false);
    try {
      var prev = localStorage.getItem(LS_TOKEN);
      var at = parseInt(localStorage.getItem(LS_AT) || '0', 10);
      if (prev === tok && (Date.now() - at) < SAVE_MIN_INTERVAL) { logi('토큰 변동 없음 — 저장 생략'); return Promise.resolve(true); }
    } catch (e) {}
    return fetch(c.url + '/rest/v1/push_tokens', {
      method: 'POST',
      headers: {
        'apikey': c.key, 'Authorization': 'Bearer ' + c.key,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ token: tok, platform: 'android', label: '스마트비서', updated_at: new Date().toISOString() })
    }).then(function (r) {
      if (!r.ok) throw new Error('토큰 저장 실패(HTTP ' + r.status + ')');
      try { localStorage.setItem(LS_TOKEN, tok); localStorage.setItem(LS_AT, String(Date.now())); } catch (e) {}
      logi('토큰 저장 완료');
      return true;
    }).catch(function (e) { logw('토큰 저장 실패: ' + (e && e.message)); return false; });
  }

  function init() {
    if (!isNative()) { logi('네이티브 아님 — 푸시 비활성'); return; }
    var PN = Cap.Plugins && Cap.Plugins.PushNotifications;
    if (!PN) { logw('PushNotifications 플러그인을 찾지 못했어요'); return; }

    // 리스너부터 등록(등록 이벤트를 놓치지 않도록)
    PN.addListener('registration', function (t) {
      var tok = t && t.value;
      if (tok) saveToken(tok); else logw('등록됐지만 토큰이 비어 있음');
    });
    PN.addListener('registrationError', function (e) { logw('등록 오류: ' + (e && (e.error || JSON.stringify(e)))); });

    // 앱이 포그라운드일 때 수신 → 케이 답을 즉시 당겨오기(app.js 가 배지/토스트 처리)
    PN.addListener('pushNotificationReceived', function () {
      try { global.dispatchEvent(new CustomEvent('smartChatPush')); } catch (e) {}
    });
    // 알림 탭 → 케이 대화 열기
    PN.addListener('pushNotificationActionPerformed', function () {
      try { global.dispatchEvent(new CustomEvent('smartOpenChat')); } catch (e) {}
    });

    // 권한 확인 → 없으면 요청 → 허용 시 등록
    PN.checkPermissions().then(function (p) {
      if (p && p.receive === 'granted') return p;
      return PN.requestPermissions();
    }).then(function (p) {
      if (p && p.receive === 'granted') { logi('알림 권한 허용 — 등록'); return PN.register(); }
      logi('알림 권한 거부/보류 — 등록 생략');
    }).catch(function (e) { logw('초기화 실패: ' + (e && e.message)); });
  }

  global.SmartPush = { init: init, saveToken: saveToken };
})(window);
