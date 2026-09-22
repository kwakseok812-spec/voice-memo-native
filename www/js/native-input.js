/* ============================================================================
 * native-input.js  —  네이티브(안드로이드) 채팅 입력
 * ----------------------------------------------------------------------------
 * 채팅 입력은 커스텀 네이티브 플러그인 "NativeInput" 이 담당한다.
 *   - 안드로이드 WebView 의 <textarea> 한글(IME) 조합이 "한 글자씩 씹히고 마지막 글자가
 *     늦게 보이는" 고질 문제를 근본 회피하기 위한 것.
 *   - 웹 입력창(chatInput/lockerInput)을 탭하면 WebView 자체 키보드 대신 네이티브 입력 바가
 *     화면 하단에 올라온다 → 한글 조합이 OS(네이티브 텍스트 위젯) 수준에서 매끄럽게 이뤄진다.
 *   - "보내기" 시 네이티브가 넘겨준 텍스트를 웹 입력창에 넣고 기존 전송 버튼(#chatSend/#lockerSend)을
 *     그대로 클릭한다 → 전송·화면·멀티기기 동기화 등 나머지 채팅 로직은 전부 기존 웹 그대로.
 *
 * 네이티브가 아니면(=일반 브라우저/PC판) 아무것도 하지 않는다 → 웹 입력창이 평소대로 동작.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Cap = global.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
  var NI = Cap.Plugins && Cap.Plugins.NativeInput;
  if (!NI) { if (global.console) console.log('[native-input] 플러그인 없음 — 웹 입력창 유지'); return; }

  // 대상별 웹 요소 매핑: 입력창 · 전송버튼 · 안내문
  var MAP = {
    chat:   { input: 'chatInput',   send: 'chatSend',   hint: '메시지 입력' },
    locker: { input: 'lockerInput', send: 'lockerSend', hint: '여기에 글을 쓰거나 파일을 올리세요' }
  };
  var current = null;      // 현재 열려 있는 입력 대상('chat' | 'locker')
  var lastOpen = 0;        // click/touchend 중복 방지용

  function el(id) { return document.getElementById(id); }

  function openFor(target) {
    var m = MAP[target]; if (!m) return;
    var ta = el(m.input); if (!ta) return;
    var now = Date.now();
    if (now - lastOpen < 400) { current = target; return; }  // 탭 한 번에 이벤트가 두 번 와도 한 번만
    lastOpen = now;
    current = target;
    try { NI.open({ target: target, text: ta.value || '', hint: m.hint }); } catch (e) {}
  }

  // 웹 textarea 를 "탭하면 네이티브 입력이 열리는 버튼"으로 바꾼다.
  //  - readOnly + inputmode=none 로 WebView 자체 키보드(=한글 씹힘의 원인)가 절대 안 뜨게 한다.
  //  - 프로그램으로 .value 를 넣는 것은 readOnly 여도 가능하므로 전송 로직에는 영향 없음.
  function wire(target) {
    var m = MAP[target]; var ta = el(m.input); if (!ta) return;
    ta.readOnly = true;
    ta.setAttribute('inputmode', 'none');
    ta.style.cursor = 'pointer';
    var onTap = function (e) { if (e) e.preventDefault(); try { ta.blur(); } catch (_) {} openFor(target); };
    // 혹시 포커스가 잡혀도 즉시 풀어 WebView 키보드가 안 뜨게 한다.
    ta.addEventListener('focus', function () { try { ta.blur(); } catch (_) {} });
    ta.addEventListener('click', onTap);
    ta.addEventListener('touchend', onTap);
  }

  // 네이티브 "보내기" → 웹 입력창에 텍스트를 넣고 기존 전송 버튼을 클릭(= sendChatMsg/sendLockerMsg)
  NI.addListener('send', function (ev) {
    if (!current) return;
    var m = MAP[current]; var ta = el(m.input); var btn = el(m.send);
    if (!ta || !btn) return;
    ta.value = (ev && ev.text) || '';
    try { btn.click(); } catch (e) {}
    // 전송 후 입력창 비우기는 기존 send 로직(sendChatMsg/sendLockerMsg)이 담당한다.
  });

  // 네이티브 입력 바가 닫힘 → 아직 안 보낸 초안을 웹 입력창으로 되돌려 저장(다음에 열면 이어쓰기)
  NI.addListener('close', function (ev) {
    if (!current) return;
    var m = MAP[current]; var ta = el(m.input);
    if (ta) {
      ta.value = (ev && ev.text) || '';
      try { ta.dispatchEvent(new Event('input')); } catch (_) {}   // 높이 자동조절 반영
    }
    current = null;
  });

  function init() { wire('chat'); wire('locker'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  if (global.console) console.log('[native-input] 네이티브 채팅 입력 활성화');
})(window);
