/* ============================================================================
 * native-input.js  —  네이티브(안드로이드) 채팅 입력
 * ----------------------------------------------------------------------------
 * 채팅 입력은 커스텀 네이티브 플러그인 "NativeInput" 이 담당한다.
 *   - 안드로이드 WebView 의 <textarea> 한글(IME) 조합 씹힘/마지막 글자 지연을 근본 회피.
 *   - 웹 입력창(chatInput/lockerInput)을 탭하면 WebView 자체 키보드 대신 네이티브 입력 바가
 *     화면 하단에 올라온다 → 한글 조합이 OS 수준에서 매끄럽게 이뤄진다.
 *   - "보내기/＋/카메라" 는 네이티브 바에서 이벤트로 알려주고, 이 파일이 기존 웹 버튼
 *     (#chatSend/#chatAttach/#chatCam 등)을 그대로 클릭한다 → 전송·첨부·동기화는 웹 그대로.
 *   - v5.8: 채팅 입력 바 위에 「오퍼스 5.5」 칩(1회 지정). 웹 칩(window.SmartOpus)과 상태를 맞춘다:
 *     열 때 웹 상태를 넘기고, 네이티브에서 켜고/끄면 'opus' 이벤트로 웹에 반영, 보내면 양쪽 모두 자동으로 꺼짐.
 *   - ⭐ 색은 하드코딩하지 않는다. "지금 화면에 실제 적용된 색"(라이트/다크 어느 쪽이든, 테마 토글
 *     후에도)을 DOM 에서 읽어 네이티브에 넘겨 톤을 항상 일치시킨다.
 *
 * 네이티브가 아니면(=일반 브라우저/PC판) 아무것도 하지 않는다 → 웹 입력창이 평소대로 동작.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Cap = global.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
  var NI = Cap.Plugins && Cap.Plugins.NativeInput;
  if (!NI) { if (global.console) console.log('[native-input] 플러그인 없음 — 웹 입력창 유지'); return; }

  // 대상별 웹 요소 매핑: 입력창 · 전송 · 첨부(＋) · 카메라(공유함엔 없음) · 안내문
  var MAP = {
    chat:   { input: 'chatInput',   send: 'chatSend',   attach: 'chatAttach',   cam: 'chatCam', hint: '메시지 입력', opus: true },
    locker: { input: 'lockerInput', send: 'lockerSend', attach: 'lockerAttach', cam: null,      hint: '여기에 글을 쓰거나 파일을 올리세요' },
    idea:   { input: 'ideaInput',   send: 'ideaSend',   attach: null,           cam: null,      hint: '떠오른 생각을 적어 주세요' }   // v5.5 아이디어 수첩
  };
  var current = null;      // 현재 열려 있는 입력 대상('chat' | 'locker')
  var hiddenBar = null;    // 네이티브 입력 중 숨겨둔 웹 하단 바(.chatbar) — 닫힐 때 복원
  var lastOpen = 0;        // click/touchend 중복 방지용

  function el(id) { return id ? document.getElementById(id) : null; }

  // CSS 색(rgb/rgba/#RGB/#RRGGBB)을 안드로이드 Color.parseColor 가 읽는 #AARRGGBB(또는 #RRGGBB)로.
  function toHex(c) {
    if (!c) return null;
    c = String(c).trim();
    if (c.charAt(0) === '#') {
      if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];   // #RGB → #RRGGBB
      return c;                                                                    // 이미 #RRGGBB(AA)
    }
    var m = c.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    var p = m[1].split(',');
    var r = parseInt(p[0], 10), g = parseInt(p[1], 10), b = parseInt(p[2], 10);
    var a = (p.length > 3) ? Math.round(parseFloat(p[3]) * 255) : 255;
    function h(n) { n = Math.max(0, Math.min(255, n | 0)); return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + h(a) + h(r) + h(g) + h(b);
  }

  // 지금 화면에 실제 적용된 색을 DOM 에서 읽는다(테마 무관 자동 일치).
  function readColors(target) {
    var m = MAP[target]; var ta = el(m.input);
    var root = getComputedStyle(document.documentElement);
    var v = function (n) { return (root.getPropertyValue(n) || '').trim(); };
    var wrap = (ta && ta.closest) ? (ta.closest('.chatinput') || ta) : ta;
    var attachEl = el(m.attach);
    var fieldBg = wrap ? getComputedStyle(wrap).backgroundColor : '';
    var iconBg = attachEl ? getComputedStyle(attachEl).backgroundColor : '';
    var textCol = ta ? getComputedStyle(ta).color : '';
    return {
      bar:         toHex(v('--bg1')),
      field:       toHex(fieldBg),
      fieldBorder: toHex(v('--glass-b')),
      hairline:    toHex(v('--glass-b')),
      text:        toHex(textCol),
      hint:        toHex(v('--dim')),
      iconBg:      toHex(iconBg),
      iconColor:   toHex(v('--p1')),
      send1:       toHex(v('--p1')),
      send2:       toHex(v('--p2')),
      opus1:       toHex(v('--opus1')),   // v5.8 「오퍼스 5.5」 칩 켜짐 색
      opus2:       toHex(v('--opus2'))
    };
  }

  // 네이티브 입력 바가 웹 하단 바(.chatbar) 자리를 그대로 대체하므로, 열려 있는 동안 웹 하단 바를
  // 숨겨 "입력창이 두 개로 보이는" 이중구조를 없앤다. visibility:hidden(자리 유지)로 스크롤 튐 방지.
  function hideWebBar(ta) {
    var bar = ta && ta.closest ? ta.closest('.chatbar') : null;
    if (bar) { bar.style.visibility = 'hidden'; hiddenBar = bar; }
  }
  function restoreWebBar() {
    if (hiddenBar) { hiddenBar.style.visibility = ''; hiddenBar = null; }
  }

  function openFor(target) {
    var m = MAP[target]; if (!m) return;
    var ta = el(m.input); if (!ta) return;
    var now = Date.now();
    if (now - lastOpen < 400) { current = target; return; }  // 탭 한 번에 이벤트가 두 번 와도 한 번만
    lastOpen = now;
    current = target;
    hideWebBar(ta);   // 웹 하단 바 숨김 → 화면엔 네이티브 입력 바 하나만
    try {
      var p = NI.open({
        target: target, text: ta.value || '', hint: m.hint,
        colors: readColors(target),
        hasAttach: !!m.attach, hasCamera: !!m.cam,
        hasOpus: !!m.opus,                                                     // v5.8
        opusOn: !!(m.opus && global.SmartOpus && global.SmartOpus.get())
      });
      if (p && p.catch) p.catch(function () { restoreWebBar(); });  // 열기 실패 시 원복
    } catch (e) { restoreWebBar(); }
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
    ta.addEventListener('focus', function () { try { ta.blur(); } catch (_) {} });
    ta.addEventListener('click', onTap);
    ta.addEventListener('touchend', onTap);
  }

  // 네이티브 "보내기" → 웹 입력창에 텍스트를 넣고 기존 전송 버튼 클릭(= sendChatMsg/sendLockerMsg)
  NI.addListener('send', function (ev) {
    if (!current) return;
    var m = MAP[current]; var ta = el(m.input); var btn = el(m.send);
    if (!ta || !btn) return;
    ta.value = (ev && ev.text) || '';
    // v5.8: 네이티브 칩 상태를 이번 전송에 반영(웹 sendChatMsg 가 takeOpus 로 쓰고 끈다)
    if (MAP[current].opus && global.SmartOpus) { try { global.SmartOpus.set(!!(ev && ev.opus)); } catch (e) {} }
    try { btn.click(); } catch (e) {}
  });

  // v5.8: 네이티브 「오퍼스 5.5」 칩을 켜고/끄면 웹 칩도 같은 상태로(바를 닫았을 때 웹 화면이 맞게 보이도록)
  NI.addListener('opus', function (ev) {
    if (!current || !MAP[current].opus || !global.SmartOpus) return;
    try { global.SmartOpus.set(!!(ev && ev.on)); } catch (e) {}
  });

  /* v7.1(2026-09-30) 「글을 먼저 쓰면 첨부가 안 된다」 수정.
   *  원인: 네이티브 입력 바(Dialog)의 ＋를 누르면 예전엔 웹 첨부 버튼을 JS 로 대신 눌렀다
   *        → 웹 <input type=file>.click(). 그런데 손가락은 Dialog 를 눌렀으므로 WebView 에는
   *        '사용자 동작(user activation)'이 없어 Chromium 이 파일 선택 창을 조용히 막았다.
   *        (글을 안 쓰고 웹 화면의 ＋를 직접 누르면 사용자 동작이 있어 정상 → "글 먼저"일 때만 고장)
   *  해결: 네이티브가 파일 선택 창을 직접 열고(NativeInput.pickFiles), 고른 파일을 File 로 만들어
   *        app.js 의 첨부 입구(window.SmartAttach)로 넘긴다 → 대기줄·전송은 웹 그대로.
   *        옛 APK(플러그인에 pickFiles 없음)면 예전 방식(웹 버튼 클릭)으로 동작한다. */
  var NATIVE_PICK_MAX = 300 * 1024 * 1024;   // 이보다 큰 파일은 메모리 부담 → 입력 바를 닫고 웹 ＋로 안내

  function hasNativePick() {
    try {
      var hs = Cap.PluginHeaders || [];
      for (var i = 0; i < hs.length; i++) {
        if (hs[i] && hs[i].name === 'NativeInput') {
          var ms = hs[i].methods || [];
          for (var j = 0; j < ms.length; j++) if (ms[j] && ms[j].name === 'pickFiles') return true;
          return false;
        }
      }
    } catch (e) {}
    return false;
  }
  function say(msg, ms) { try { if (global.SmartAttach && global.SmartAttach.toast) global.SmartAttach.toast(msg, ms); } catch (e) {} }

  // 네이티브가 캐시에 복사해 둔 사본(path) → 웹 File 객체
  function toFile(f) {
    var url = (typeof Cap.convertFileSrc === 'function') ? Cap.convertFileSrc(f.path) : f.path;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new File([b], f.name || '파일', { type: f.mime || b.type || '', lastModified: Date.now() });
    }).catch(function () { return null; });
  }

  // hookName: SmartAttach 의 입구 이름, accept: 'image/*' 등, fallbackBtn: 옛 방식용 웹 버튼
  function pickNative(hookName, accept, fallbackBtn) {
    var hook = global.SmartAttach && global.SmartAttach[hookName];
    if (typeof hook !== 'function' || !hasNativePick()) {       // 옛 APK·입구 없음 → 예전 방식
      if (fallbackBtn) { try { fallbackBtn.click(); } catch (e) {} }
      return;
    }
    NI.pickFiles({ accept: accept || '*/*', multiple: true }).then(function (res) {
      var list = (res && res.files) || [];
      var requested = (res && res.requested) || 0;
      if (!list.length) { if (requested > 0) say('고른 파일을 읽지 못했어요. 다시 시도해 주세요.'); return; }
      var big = list.filter(function (f) { return (f.size || 0) > NATIVE_PICK_MAX; });
      var ok = list.filter(function (f) { return (f.size || 0) <= NATIVE_PICK_MAX; });
      return Promise.all(ok.map(toFile)).then(function (files) {
        files = files.filter(Boolean);
        if (files.length) hook(files);
        var failed = ok.length - files.length + (requested > list.length ? requested - list.length : 0);
        if (big.length) {
          say('300MB가 넘는 파일(' + big.length + '개)은 입력창을 닫고 아래 ＋ 버튼으로 붙여 주세요.', 4000);
        } else if (failed > 0) {
          say('파일 ' + failed + '개를 읽지 못했어요. 다시 골라 주세요.', 3000);
        }
      });
    }).catch(function () {
      say('파일 선택 창을 열지 못했어요. 입력창을 닫고 아래 ＋ 버튼을 눌러 주세요.', 3500);
    });
  }

  // 네이티브 "＋"(첨부) → 네이티브 파일 선택 → 첨부 대기줄. 입력 바는 열린 채 유지(글 그대로).
  NI.addListener('attach', function () {
    if (!current) return;
    var m = MAP[current];
    pickNative(current, '*/*', el(m.attach));   // current = 'chat' | 'locker' (SmartAttach 입구 이름과 같음)
  });

  // 네이티브 "카메라" → 사진 고르기(웹 chatCamInput 과 같은 image/*) → 사진 대기줄. 공유함엔 카메라 없음.
  NI.addListener('camera', function () {
    if (!current) return;
    var m = MAP[current];
    if (!m.cam) return;
    pickNative('chatCam', 'image/*', el(m.cam));
  });

  // 네이티브 입력 바 닫힘 → 웹 하단 바 복원 + 안 보낸 초안을 웹 입력창으로 되돌려 저장(이어쓰기)
  NI.addListener('close', function (ev) {
    restoreWebBar();
    if (!current) return;
    var m = MAP[current]; var ta = el(m.input);
    if (ta) {
      ta.value = (ev && ev.text) || '';
      try { ta.dispatchEvent(new Event('input')); } catch (_) {}   // 높이 자동조절 반영
    }
    current = null;
  });

  function init() { wire('chat'); wire('locker'); wire('idea'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  if (global.console) console.log('[native-input] 네이티브 채팅 입력 활성화(색 자동 일치)');
})(window);
