/* ============================================================================
 * push.js  —  FCM 푸시 알림 (안드로이드 네이티브 전용)
 * ----------------------------------------------------------------------------
 * 앱 시작 시: 알림 권한 요청 → 등록 → FCM 토큰 획득 → Supabase 우편함(push_tokens)에
 *   업서트(대표님 기기 식별). 케이(PC 워커)가 답장을 기록하면 그 토큰들로 푸시를 쏜다.
 *
 * 화면 전환은 이 파일이 직접 하지 않고, window 이벤트로 app.js 에 넘긴다(결합 최소화):
 *   - smartOpenChat : 알림을 탭했을 때 → 케이 대화 열기
 *   - smartChatPush : 앱이 열려 있을 때 알림 수신 → 답을 즉시 당겨오기(배지 갱신)
 *   - smartReadClear: (v9.1) 다른 기기에서 읽었다는 조용한 푸시 수신 → 읽음 기준만 바로 받아 숫자 내리기
 *
 * 여기 쓰는 키는 **공개(publishable) 키뿐**(office-bridge.js 와 동일). 발송은 PC 가 비밀 키로 한다(앱엔 없음).
 * v7.5(O-0130): 표 직접 쓰기(anon 정책)를 없애고 연동 암호 게이트 RPC push_token_register 로만 등록한다
 *   (공개 키로 토큰 목록을 읽을 수 없게). 암호가 아직 없으면 토큰을 기억해 두었다가 암호가 들어오면
 *   SmartPush.retry() 로 다시 등록한다(app.js 연동 암호 저장 시 호출).
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

  var LS_TOKEN = 'smart_push_token', LS_AT = 'smart_push_saved_at', LS_LABEL = 'smart_push_label';
  /* v8.2(O-0157) 이 기기가 「알림에서 바로 답장」을 할 수 있다는 표시를 토큰 등록 이름(label)에 붙인다.
   *   서버(push_sender.py)는 label 에 'nreply' 가 있는 기기에만 케이 답장을 데이터 전용 푸시로 보내
   *   앱이 [답장] 버튼 달린 알림을 직접 만들게 한다. 옛 APK(이 표시 없음)는 지금처럼 일반 알림을 받는다 → 옛 기기 무영향.
   *   네이티브 KBridge 플러그인이 있는 APK(v8.2+)에서만 붙인다. */
  /* v9.1(O-0209) 'rclr' = 이 기기는 「다른 기기에서 읽음」 조용한 푸시(data.k_clear)를 받아 알림·위젯을 스스로 내릴 수 있다.
   *   서버(push_sender.py)는 이 표시가 있는 기기에만 조용한 푸시를 보내고, 채팅 화면 알림에 꼬리표(tag)를 붙인다.
   *   옛 APK(v9.0 이하)는 이 표시가 없어 지금과 똑같은 푸시만 받는다 → 옛 기기 무영향. */
  function tokenLabel() {
    try { if (Cap && Cap.Plugins && Cap.Plugins.KBridge) return '스마트비서|v8.2|nreply|rclr'; } catch (e) {}
    return '스마트비서';
  }
  var SAVE_MIN_INTERVAL = 12 * 60 * 60 * 1000;   // 같은 토큰은 12시간에 한 번만 재기록(불필요한 쓰기 방지)

  var LS_PENDING = 'smart_push_pending';
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  // FCM 토큰을 우편함(push_tokens)에 등록 — RPC push_token_register(연동 암호 게이트).
  function saveToken(tok) {
    var c = cfg();
    if (!c || !tok) return Promise.resolve(false);
    var pass = syncPass();
    if (!pass) {                                   // 암호 전 → 기억만(암호 입력 후 retry)
      try { localStorage.setItem(LS_PENDING, tok); } catch (e) {}
      logi('연동 암호 전 — 토큰 등록 보류'); return Promise.resolve(false);
    }
    try {
      var prev = localStorage.getItem(LS_TOKEN);
      var at = parseInt(localStorage.getItem(LS_AT) || '0', 10);
      var prevLabel = localStorage.getItem(LS_LABEL) || '';
      // v8.2: label(기능 표시)이 바뀌었으면 12시간 안이라도 다시 등록 — 업데이트 직후 바로 서버가 알게
      if (prev === tok && prevLabel === tokenLabel() && (Date.now() - at) < SAVE_MIN_INTERVAL) { logi('토큰 변동 없음 — 저장 생략'); return Promise.resolve(true); }
    } catch (e) {}
    return fetch(c.url + '/rest/v1/rpc/push_token_register', {
      method: 'POST',
      headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: tok, p_platform: 'android', p_label: tokenLabel(), p_pass: pass })
    }).then(function (r) {
      if (!r.ok) {
        if (r.status === 400 || r.status === 401 || r.status === 403) { try { localStorage.setItem(LS_PENDING, tok); } catch (e) {} }
        throw new Error('토큰 저장 실패(HTTP ' + r.status + ')');
      }
      try { localStorage.setItem(LS_TOKEN, tok); localStorage.setItem(LS_AT, String(Date.now())); localStorage.setItem(LS_LABEL, tokenLabel()); localStorage.removeItem(LS_PENDING); } catch (e) {}
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
    PN.addListener('pushNotificationReceived', function (n) {
      // v9.1(O-0209) 「다른 기기에서 읽음」 조용한 푸시 → 새 답을 당겨올 일은 없고, 읽음 기준만 바로 받아 숫자를 내린다(app.js)
      var clr = false;
      try { clr = !!(n && n.data && String(n.data.k_clear) === '1'); } catch (e) {}
      try { global.dispatchEvent(new CustomEvent(clr ? 'smartReadClear' : 'smartChatPush')); } catch (e) {}
    });
    // 알림 탭 → 화면 열기. data.screen 으로 분기(건강 리마인더 → 건강 탭, 그 외 → 케이 대화)
    PN.addListener('pushNotificationActionPerformed', function (a) {
      // v5.2(A): 알림을 탭해 진입하면 쌓인 알림/앱아이콘 배지를 정리(읽었으니 사라지게).
      try { if (PN.removeAllDeliveredNotifications) PN.removeAllDeliveredNotifications(); } catch (e) {}
      var scr = '';
      try { scr = (a && a.notification && a.notification.data && a.notification.data.screen) || ''; } catch (e) {}
      try { global.dispatchEvent(new CustomEvent(scr === 'health' ? 'smartOpenHealth' : scr === 'ideas' ? 'smartOpenIdeas' : 'smartOpenChat')); } catch (e) {}   // v5.5: 아이디어 제안 알림 → 아이디어 화면
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

  function retry() {                               // 연동 암호가 새로 들어왔을 때(app.js) — 보류된 토큰 등록
    var t = null; try { t = localStorage.getItem(LS_PENDING); } catch (e) {}
    if (t) { try { localStorage.removeItem(LS_AT); } catch (e) {} saveToken(t); }
  }
  global.SmartPush = { init: init, saveToken: saveToken, retry: retry };
})(window);
