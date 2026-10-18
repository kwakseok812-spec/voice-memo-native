/* ============================================================================
 * app.js — 화면 연결(글루)  [v0.7 디자인 적용판]
 *  - 흐름/로직은 그대로(PC-중심): 폰은 녹음·전송·표시만, 전사·정리·문서는 PC.
 *  - 화면 전환식(홈 ↔ 서브화면), 다크/라이트 토글, 저사양 blur 폴백.
 * ==========================================================================*/
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 테마 + 저사양 폴백 (가장 먼저) ---------- */
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('smart_theme'); } catch (e) {}
    var prefersLight = false;
    try { prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
    var mode = saved || (prefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-style', mode);
    // 저사양(코어/메모리 적음) 기기: 유리 blur 끄고 반투명만
    try {
      var lc = navigator.hardwareConcurrency || 8, dm = navigator.deviceMemory || 8;
      if (lc <= 4 || dm <= 3) document.documentElement.classList.add('no-blur');
    } catch (e) {}
  })();
  /* ---------- v6.8(O-0089): 고정 머리줄 제목 알약 ----------
     화면을 조금이라도 내리면 <html>에 subbar-float 를 붙여, 고정된 머리줄의 제목(작업 현황 등)·케이 이름표에도
     버튼과 같은 알약 배경을 준다(아래로 지나가는 글자와 겹쳐 지저분해지지 않게). 머리줄 판(배경 막)은 없다.
     스크롤마다 한 번(requestAnimationFrame)만 계산하고, 상태가 바뀔 때만 class 를 고친다(렉 없음). */
  (function initSubbarFloat() {
    var root = document.documentElement, on = null, queued = false;
    function upd() {
      queued = false;
      var v = (window.pageYOffset || root.scrollTop || 0) > 4;
      if (v !== on) { on = v; root.classList.toggle('subbar-float', v); }
    }
    function req() { if (!queued) { queued = true; requestAnimationFrame(upd); } }
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req, { passive: true });
    upd();
  })();
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-style', mode);
    try { localStorage.setItem('smart_theme', mode); } catch (e) {}
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', mode === 'light' ? '#F7F9FF' : '#070B1D');
  }

  var btnRecord = $('btnRecord'), btnStop = $('btnStop'), btnCancelRec = $('btnCancelRec');
  var statusText = $('statusText'), statusDot = $('statusDot'), banner = $('banner');
  var levelBar = $('levelBar');   // (디자인에선 파형 CSS 애니메이션 — 없을 수 있음)
  var orbLabel = $('orbLabel'), orbHint = $('orbHint');
  var homeView = $('homeView'), recView = $('recView'), recPrep = $('recPrep');
  var btnStartRec = $('btnStartRec'), matAttach = $('matAttach'), matInput = $('matInput'), matList = $('matList');
  var matAttachPrep = $('matAttachPrep'), matListPrep = $('matListPrep');   // 녹음 전(준비 화면) 첨부 UI(2026-09-21)
  var recordedPanel = $('recordedPanel'), memoTitle = $('memoTitle'), btnSend = $('btnSend'), btnRetake = $('btnRetake'), btnDraft = $('btnDraft');
  var recDoneBadge = $('recDoneBadge');
  var processing = $('processing'), processingText = $('processingText');
  var resultWrap = $('resultWrap'), resultArea = $('resultArea'), transcriptView = $('transcriptView');
  var docBtns = $('docBtns'), exportMsg = $('exportMsg'), btnDelete = $('btnDelete');
  var historyList = $('historyList'), historyCount = $('historyCount');
  var modal = $('modal'), modalTitle = $('modalTitle'), modalBody = $('modalBody'), modalClose = $('modalClose');

  var pendingBlob = null, pollTimer = null, pollingId = null, viewId = null;
  var pendingMaterials = [];              // 회의자료(선택) — 녹음 전(준비)·후(완료) 양쪽에서 붙일 수 있음(2026-09-21)
  // v6.6(O-0086): 파일 크기 상한은 office-bridge.js 의 MAX_UPLOAD_BYTES(5GB) 하나로 통일.
  //   (옛 값: 회의자료 40MB · 사진 45MB · 채팅 사진 45MB(말없이 뺌) · 영상/채팅파일/문서는 상한 없음)
  var MAX_UPLOAD_BYTES = (window.OfficeBridge && OfficeBridge.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024;
  // 고른 파일 중 5GB 넘는 것은 빼고 쉬운 말로 알린다. 반환: 남은 파일 배열.
  function keepSendable(arr) {
    arr = Array.prototype.slice.call(arr || []);
    var big = arr.filter(function (f) { return (f && f.size || 0) > MAX_UPLOAD_BYTES; });
    if (big.length) {
      var who = big.length === 1 ? ('「' + (big[0].name || '파일') + '」') : (big.length + '개 파일');
      toast('⚠️ ' + who + '은 너무 커서 뺐습니다. 5GB까지 보낼 수 있습니다.');
    }
    var keep = arr.filter(function (f) { return (f && f.size || 0) <= MAX_UPLOAD_BYTES; });
    keep.removed = big.length;                    // 뺀 게 있으면 뒤따르는 '붙였어요' 안내가 경고를 덮지 않게
    return keep;
  }
  // 미리보기 썸네일: 파일을 메모리로 통째 읽지 않고(readAsDataURL 금지 — 큰 사진이면 폰이 멈춤) 주소만 만든다.
  function thumbSrc(im, f) {
    try { var u = URL.createObjectURL(f); im.onload = im.onerror = function () { try { URL.revokeObjectURL(u); } catch (x) {} }; im.src = u; } catch (e) {}
  }
  var recTimerEl = $('recTimer'), recStart = 0, recInterval = null;
  var isRecording = false, recCancelled = false;
  /* v9.8(O-0442) 녹음하면서 다른 화면 보기 — 스위치.
   *   true  : 녹음 화면 [뒤로](묻지 않고 나감) · 위쪽 띠(화면을 밀어 내림) · 홈 단추가 돌아가는 길 · 녹음 상태 되찾기 · 확인 창들.
   *   false : 2026-09-21 방식 그대로(「뒤로」 창 + 아래 알약). 화면 규칙(styles.css)은 html.rec-v2 일 때만 먹는다.
   *   네이티브(자바) 쪽은 덧붙이기만 해서 어느 쪽이든 맞물린다. */
  /* 스캔 허브 1단계(영수증) — 스위치. 'on' 이면 ＋ 창에 「영수증 등록」 줄 · 결과 화면에 확인 카드가 생긴다.
   *   'off' 면 이 기능의 모든 입구가 닫혀 v9.20 과 똑같이 움직인다(SCAN_HUB 를 보는 곳은 전부 이 값 하나만 본다). 앞쪽에 둔 까닭: 첫 채팅 그림보다 먼저 값이 있어야 해서. */
  var SCAN_HUB = 'on';
  var REC_ROAM_V2 = true;
  try { document.documentElement.classList.toggle('rec-v2', REC_ROAM_V2); } catch (e) {}
  /* v9.10(O-0449) 끊긴 녹음 찾기 — 스위치.
   *   true  : 회의 녹음을 시작 · 정지할 때 폰 안쪽에 일지 한 건을 남기고(네이티브 RecJournal), 앱을 다시 열면 끊긴 녹음 · 보내지 않은 녹음을
   *           찾아 알린다([이어서 녹음] · [여기까지 저장] · [나중에]). 녹음 준비 화면의 저장 공간 한 줄, 「녹음이 끊겼습니다」 알림, 진단 값(meta.rec).
   *   false : v9.9 와 같은 화면(끊기면 글만). 네이티브에는 일지를 적으라는 표시를 넘기지 않는다 → 녹음 서비스도 v9.9 와 같게 돈다.
   *   녹음하는 방식(녹음기 설정 · 시작 · 정지)은 어느 쪽이든 그대로다. REC_ROAM_V2 가 꺼져 있으면 이것도 쉰다. */
  var REC_FIND = true;
  var recFindItems = [];            // 폰에 남아 있는 끊긴 녹음 · 보내지 않은 녹음(묶음 단위 — 네이티브가 준 그대로)
  var recFindAsked = {};            // 이번 실행에서 이미 창으로 여쭌 묶음
  var recGroup = '', recGroupNext = '';   // 지금 이어 녹음 중인 묶음 · [이어서 녹음]을 눌러 다음 시작에 쓸 묶음
  var recCur = null;                // 「녹음 완료」 화면에 올라와 있는 녹음의 일지 정보 {gid, recovered, ...}
  var recDiagLast = null;           // 가장 최근에 받은 진단 값(녹음을 보낼 때 메모 행 meta.rec 에 싣는다)
  var REC_HANDED_KEY = 'smart_rec_handed';   // 임시저장 · 보내기로 넘긴 묶음 번호들(넘김 표시를 쓰기 직전에 앱이 꺼졌을 때 두 번 묻지 않게)
  var REC_SESSION_KEY = 'smart_rec_session';   // 지금 도는 회의 녹음의 표식 {at: 시작 시각(ms)} — 앱 화면이 다시 만들어졌을 때 「계속되던 그 녹음인가」를 가린다
  var recLost = false;                         // 녹음기가 멈춘 것 같다(노란 띠)
  var recLive = false;                         // 녹음기가 「시작됐다」고 알린 뒤인가(마이크 허용 창을 기다리는 동안은 아직 아니다)
  var recPanelShared = false;                  // 「녹음 완료」 화면이 다른 앱에서 공유받은 파일을 보여 주는 중인가
  var recIndicator = $('recIndicator'), recIndTime = $('recIndTime');   // 녹음 중 미니 배너(백그라운드 녹음 표시 · 2026-09-21)
  var recIndTx = $('recIndTx'), recIndGo = $('recIndGo');

  /* ---------- 유틸 ---------- */
  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }
  function isOpen(el) { return el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'; }
  function scrollTop() { try { window.scrollTo(0, 0); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function setStatus(t, k) { if (statusText) statusText.textContent = t; if (statusDot) statusDot.className = 'dot ' + (k || 'idle'); }
  function setExportMsg(m, k) { if (exportMsg) { exportMsg.textContent = m || ''; exportMsg.className = 'exportmsg ' + (k || ''); } }
  /* v9.4 일하는 케이(보내는 중 화면): stage = 'send' 올리는 중 · 'got' 서버에 저장된 뒤 · 'retry' 정리하다 문제가 생겨 다시 하는 중.
   *   「잘 받았습니다」는 올리기가 끝나 서버에 저장된 뒤(got)에만 말한다. what = 'memo'(녹음 → 회의록) | 'media'(사진·영상 — 결과가 회의록에 올라가지 않는다).
   *   what 은 그 메모의 종류로 정한다(procWhat) — 올릴 때뿐 아니라 5초마다 상태를 다시 볼 때 · 기록에서 다시 열 때도 같은 문구가 유지되게. */
  var PROC_SAY = {
    send:  { pose: 'idle',  memo: 'PC로 보내고 있습니다.', media: 'PC로 올리고 있습니다.' },
    got:   { pose: 'idle',  memo: '잘 받았습니다. 정리해서 회의록에 올려 두겠습니다. 다른 일 보셔도 됩니다.', media: '잘 받았습니다. 살펴보고 있습니다. 다른 일 보셔도 됩니다.' },
    retry: { pose: 'sorry', memo: '죄송합니다, 정리하다 문제가 있었습니다. 잠시 뒤 다시 해 보겠습니다.', media: '죄송합니다, 살펴보다 문제가 있었습니다. 잠시 뒤 다시 해 보겠습니다.' }
  };
  function procWhat(id) {
    var e = null; try { e = HistoryModule.get(id); } catch (x) {}
    return (e && (e.kind === 'photo' || e.kind === 'video')) ? 'media' : 'memo';
  }
  function setProcessing(t, stage, what) {
    if (processingText) processingText.textContent = t;
    var d = PROC_SAY[stage];
    // v9.6: 케이가 한마디를 하는 동안에는 아래 진행 줄을 작은 한 줄로 줄인다(같은 말을 두 번 하지 않게 — styles.css .processing.with-k)
    try { var pb = processingText && processingText.parentNode; if (pb) pb.classList.toggle('with-k', !!(d && window.KScene)); } catch (e) {}
    if (!d || !window.KScene) return;
    KScene.set('kscProc', d.pose, d[what === 'media' ? 'media' : 'memo']);
  }
  function showBanner(m) { if (banner) { banner.style.display = 'block'; banner.innerHTML = m; } }
  function hideBanner() { if (banner && RecordingModule.isSupported()) banner.style.display = 'none'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtSec(s) { s = Math.max(0, Math.floor(s)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
  // v9.8: 녹음 시간 글자 — 1시간 전까지는 12:34, 넘으면 1:15:10(예전에는 75:10). 녹음 화면·띠·홈 단추·완료 화면이 모두 이 함수 하나를 쓴다.
  function fmtRec(s) {
    s = Math.max(0, Math.floor(s));
    if (!REC_ROAM_V2 || s < 3600) return fmtSec(s);
    return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }
  // 「12분 34초」처럼 읽는 글(확인 창용)
  function fmtRecKo(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + '시간 ' : '') + ((h || m) ? m + '분 ' : '') + x + '초';
  }
  function defaultTitle() { var d = new Date(); return '메모 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + d.getHours() + '시'; }
  function now() { var d = new Date(); var p = pad2; return { date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), time: p(d.getHours()) + ':' + p(d.getMinutes()) }; }
  /* v6.5 (O-0085): 서버 시각(created_at 등, UTC) → 한국 시간 {date:'YYYY-MM-DD', time:'HH:MM'}.
   *   예전엔 문자열을 잘라 UTC(02:45)를 그대로 보여 한국 11:45 가 02:45 로, 한국 00~09시 녹음은 날짜가 하루 전으로 보였다.
   *   한국은 서머타임이 없어 +9시간 고정 → 기기 시간대(해외 출장 등)와 무관하게 늘 한국 시각·날짜.
   *   'T'·공백 구분, 소수초 자릿수, 'Z'·'+00'·'+00:00'·'+0000' 모두 직접 해석(엔진별 Date.parse 차이 회피).
   *   시간대 표기가 없으면 서버 관례대로 UTC 로 본다. 해석 실패 시 null. */
  function kstParts(iso) {
    if (!iso) return null;
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
    var t;
    if (m) {
      t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      var z = m[7];
      if (z && z.toUpperCase() !== 'Z') {
        var sg = z.charAt(0) === '-' ? -1 : 1, zz = z.slice(1).replace(':', '');
        t -= sg * (+zz.slice(0, 2) * 60 + +(zz.slice(2, 4) || 0)) * 60000;
      }
    } else {
      t = Date.parse(iso); if (isNaN(t)) return null;
    }
    var k = new Date(t + 9 * 3600000);   // UTC+9 로 옮긴 뒤 getUTC* 로 읽음
    return { date: k.getUTCFullYear() + '-' + pad2(k.getUTCMonth() + 1) + '-' + pad2(k.getUTCDate()),
             time: pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes()) };
  }
  /* v6.5 (O-0085): 녹음/영상 길이(초) — PC 워커가 summary_json 에 적은 값. duration_sec 우선, 없으면
   *   영상 워커의 duration_min(분). 모르면 0(→ 화면엔 길이 없이 '녹음'만). */
  function memoDurSec(r) {
    var sj = (r && r.summary_json) || {};
    var s = Number(sj.duration_sec);
    if (isFinite(s) && s > 0) return s;
    var mn = Number(sj.duration_min);
    if (isFinite(mn) && mn > 0) return mn * 60;
    return 0;
  }
  /* 길이 → '1시간 40분' / '35분' / '45초'. 분 단위는 버림(6049초=1시간 40분). */
  function fmtDurKo(sec) {
    sec = Math.floor(Number(sec) || 0);
    if (sec <= 0) return '';
    if (sec < 60) return sec + '초';
    var mins = Math.floor(sec / 60), h = Math.floor(mins / 60), mm = mins % 60;
    if (!h) return mm + '분';
    return h + '시간' + (mm ? ' ' + mm + '분' : '');
  }

  /* ---------- 화면 전환(홈 ↔ 서브화면) ---------- */
  var SUBS = [recPrep, recView, recordedPanel, filePanelRef(), searchPanelRef(), $('chatView'), $('lockerView'), $('meetingsView'), $('ideasView'), $('healthView'), $('docsView'), $('ordersView'), $('kWardrobeView'), $('remindersView'), $('starsView'), processing, resultWrap];   // v6.0: kWardrobeView(케이 꾸미기)   // v5.5: ideasView(아이디어 수첩) 등록 · v5.8: ordersView(작업 현황)
  function filePanelRef() { return $('filePanel'); }
  function searchPanelRef() { return $('searchPanel'); }
  var homeFooter = $('homeFooter');
  // v9.4: 홈이 보일 때만 html.home-on — 폴드 펼침(넓은 화면)에서 홈만 2단으로 넓힌다(다른 화면 폭은 그대로).
  function syncHomeOn() { try { document.documentElement.classList.toggle('home-on', isOpen(homeView)); } catch (e) {} }
  /* v9.4 홈 큰 카드의 인사 한 줄 — 때에 맞는 인사(k-intro.js 의 GREETINGS 목록을 그대로 쓴다).
   *   앱을 켠 뒤 한 번 정하고(시작 인사에 방금 나온 말은 뺀다), 그 뒤로는 시간대(아침 04~11 · 낮 11~17 · 저녁 17~04)가 바뀐 채
   *   홈이 다시 보일 때(다른 화면에서 돌아옴 · 앱으로 돌아옴)에만 그 시간대의 인사로 바꾼다. 같은 시간대 안에서는 바꾸지 않는다.
   *   아침에는 홈 카드의 얼굴만 8초 동안 밝게 웃는다(KChar.faceFlash — 채팅·머리줄 얼굴의 표정은 바꾸지 않는다). */
  var homeGreetBand = '';
  function greetBandNow() { var hr = new Date(Date.now() + 9 * 3600000).getUTCHours(); return (hr >= 4 && hr < 11) ? 'morning' : (hr >= 11 && hr < 17) ? 'day' : (hr >= 17 && hr < 22) ? 'evening' : 'night'; }   // v9.6: 밤 22~04시
  function paintHomeGreet() {
    var h1 = $('homeGreet'); if (!h1 || !window.KIntro || !KIntro.pickGreeting) return;
    var band = greetBandNow();
    if (band === homeGreetBand) return;                 // 같은 시간대 — 그대로 둔다
    var first = !homeGreetBand;
    homeGreetBand = band;
    try {
      var last = null;
      if (first) { try { last = localStorage.getItem('smart_k_intro_line'); } catch (e) {} }
      else last = h1.getAttribute('data-kg') || null;   // 방금까지 보이던 인사는 빼고 고른다
      // v9.6: 이번 실행에서 시작 인사가 나왔으면 홈은 다른 인사를 또 하지 않고 그 인사를 그대로 이어 보여 준다(인사가 두 번 이어지지 않게)
      var g = null, sid = (first && KIntro.sessionLine) ? KIntro.sessionLine() : '';
      if (sid) { var gl = KIntro.greetings().filter(function (x) { return x.id === sid; }); if (gl.length) g = gl[0]; }
      if (!g) g = KIntro.pickGreeting(null, last);
      if (g && g.text) { h1.setAttribute('data-kg', g.id || ''); h1.innerHTML = esc(g.text).replace('대표님', '<em>대표님</em>'); }
      h1.setAttribute('data-kband', band);
      // v9.5: 인사말이 스르륵 올라온다(케이 움직임 끔 · 폰 「움직임 줄이기」면 바로)
      var gw = h1.parentNode;
      if (gw && window.KScene && KScene.calm && !KScene.calm()) { gw.classList.remove('kg-in'); void gw.offsetWidth; gw.classList.add('kg-in'); }
      var face = document.querySelector('#kHero .kface');
      if (band === 'morning' && face && window.KChar && KChar.faceFlash) KChar.ready.then(function () { KChar.faceFlash(face, 'cheer', 8000); });
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { try { if (!document.hidden && isOpen(homeView)) paintHomeGreet(); } catch (e) {} });
  document.addEventListener('kintro:line', function () { try { homeGreetBand = ''; paintHomeGreet(); } catch (e) {} });   // v9.6: 시작 인사가 고른 말로 홈 인사를 맞춘다
  var chatFromDocs = false;      // O-0548: 문서 뷰어 [💬]로 채팅에 왔으면 뒤로 = 보던 문서로
  function dropChatReturn() { chatFromDocs = false; try { if (window.SmartDocs && SmartDocs.dropChatReturn) SmartDocs.dropChatReturn(); } catch (e) {} }
  function showHome() {
    dropChatReturn();
    if (window.SmartDocs && SmartDocs.leave) { try { SmartDocs.leave(); } catch (e) {} }   // 문서 뷰어 오버레이 닫기
    try { if (isOpen($('kWardrobeView'))) kwHush(); } catch (e) {}   // v9.10: 케이 꾸미기를 [뒤로] 아닌 길(바로가기 등)로 떠날 때도 틀어 둔 소리를 멈춘다
    SUBS.forEach(hide); clearSearch(); show(homeView); scrollTop(); syncHomeOn();
    try { if (window.KScene && KScene.reset) KScene.reset(); } catch (e) {}   // v9.5: 화면을 새로 열면 장면이 스르륵 다시 등장
    try { paintHomeGreet(); } catch (e) {}                // v9.4: 시간대가 바뀌었으면 인사만 갱신
    if (homeFooter) homeFooter.style.display = '';       // 하단 안내문은 홈에서만
    updateRecIndicator();
    try { renderKBubble(); } catch (e) {}                 // (O-0117) 홈에 돌아오면 케이 말풍선 꼬리 위치·문구 다시 맞춤
    try { liveRefresh(); } catch (e) {}                   // v7.7(O-0134): 홈으로 돌아온 순간 새 방송·대화를 한 번 받아 말풍선 갱신
    syncConvoMode();                                      // (O-0124) 채팅을 떠나면 「스마트비서」 머리줄을 다시 보이게
    setTimeout(function () { try { refreshKStat(false); } catch (e) {} }, 0);   // v9.6: 홈 카드가 PC 상태를 사실대로 말하게(채팅 머리줄 점과 같은 값)
    setTimeout(function () { try { if (getSyncPass()) refreshOrders(true); } catch (e) {} }, 300);   // v5.8: 홈 「작업 현황」 미완료 숫자
    try { if (window.TodayCard) TodayCard.refresh(true); } catch (e) {}   // (O-0129) 홈 「오늘 한눈에」 카드
  }
  function openScreen(el) {
    // O-0548: 뷰어 [💬]로 채팅에 간 뒤 뒤로 가기가 아닌 길(작업 현황 · 알림 · 녹음 띠 등)로 다른 화면에 가면 돌아올 자리를 버린다
    //   (뒤로 가기 길은 goBack 이 chatFromDocs 를 먼저 내리고 문서 화면을 연다 → 여기서 버리지 않는다)
    if (chatFromDocs && el !== chatView) dropChatReturn();
    // v9.10: 케이 꾸미기에서 녹음 띠 · 바로가기 · 알림으로 다른 화면에 갈 때 — 틀어 둔 미리 듣기 · 인사를 먼저 멈춘다(예전에는 몇 초 남았다)
    try { if (el !== $('kWardrobeView') && isOpen($('kWardrobeView'))) kwHush(); } catch (e) {}
    // 문서 뷰어(고정 오버레이)는 문서 화면으로 갈 때가 아니면 닫는다(다른 화면을 가리지 않게)
    if (window.SmartDocs && SmartDocs.leave && el !== $('docsView')) { try { SmartDocs.leave(); } catch (e) {} }
    hide(homeView);
    SUBS.forEach(function (x) { if (x !== el) hide(x); });
    if (el !== searchPanelRef()) clearSearch();
    show(el); scrollTop(); syncHomeOn();
    try { if (window.KScene && KScene.reset) KScene.reset(); } catch (e) {}   // v9.5
    if (homeFooter) homeFooter.style.display = 'none';   // 다른 화면에선 숨김
    updateRecIndicator();
    syncConvoMode();                                      // (O-0124) 음성 대화 중 채팅으로 돌아오면 무대 화면으로
  }
  /* 녹음 중 미니 배너: 녹음이 살아있는데 녹음 화면(recView)이 아닌 다른 화면에 있을 때만 보인다.
   * 녹음은 화면과 무관하게 네이티브 포그라운드 서비스로 계속되므로, 이 배너로 "녹음 중"을 계속 알리고
   * 탭하면 녹음 화면으로 돌아가 [정지]/[취소] 할 수 있다. */
  function updateRecIndicator() {
    if (!recIndicator) return;
    var on = isRecording && !isOpen(recView);
    var wasOn = recIndicator.style.display !== 'none';
    recIndicator.style.display = on ? 'flex' : 'none';
    if (!REC_ROAM_V2) return;
    // v9.8: 띠가 보이는 동안 화면 전체를 띠 높이만큼 민다(html.rec-band → --rec-h). 글·모양도 여기서 맞춘다.
    var de = document.documentElement, calm = false;
    de.classList.toggle('rec-on', !!isRecording);
    de.classList.toggle('rec-band', on);
    try { calm = !!(window.KScene && KScene.calm && KScene.calm()); de.classList.toggle('rec-calm', calm); } catch (e) {}
    // 내려오는 움직임은 띠가 새로 나타날 때 한 번만(움직임을 쉬는 때에는 없음)
    if (on && !wasOn && !calm) { recIndicator.classList.remove('rec-in'); void recIndicator.offsetWidth; recIndicator.classList.add('rec-in'); }
    else if (!on || calm) recIndicator.classList.remove('rec-in');
    recIndicator.classList.toggle('warn', !!(isRecording && recLost));
    if (recIndTx) recIndTx.textContent = (isRecording && recLost) ? '녹음이 멈춘 것 같습니다. 눌러서 확인해 주십시오' : '녹음 중';
    if (recIndGo) recIndGo.textContent = '녹음 화면으로 ›';
    recIndicator.setAttribute('aria-label', (isRecording && recLost) ? '녹음이 멈춘 것 같습니다. 누르면 녹음 화면으로 갑니다' : '녹음 중. 누르면 녹음 화면으로 돌아갑니다');
    paintRecHome();
  }
  if (recIndicator) recIndicator.addEventListener('click', function () { openScreen(recView); });
  // v9.8: 홈의 「회의 녹음」 단추 — 녹음 중에는 돌아가는 길(예전에는 눌러도 반응이 없었다). 띠와 같은 말 「녹음 화면으로」.
  function paintRecHome() {
    if (!REC_ROAM_V2 || !btnRecord) return;
    var lab = btnRecord.querySelector('.kh-reclab'); if (!lab) return;
    var tx = isRecording ? ('녹음 중 ' + (recIndTime ? recIndTime.textContent : '') + ' · 녹음 화면으로') : '회의 녹음';
    if (lab.textContent !== tx) lab.textContent = tx;
    btnRecord.setAttribute('aria-label', isRecording ? '녹음 중. 누르면 녹음 화면으로 돌아갑니다' : '회의 녹음 시작');
  }
  // v9.8: 화면을 다 쓰는 곳(문서 전체화면 · 슬라이드쇼)에서는 띠를 접어 작은 알약으로(html.rec-chip)
  function syncRecChip() {
    try {
      var ss = $('slideshow'), ssOn = !!(ss && ss.classList.contains('on'));
      var full = document.body.classList.contains('doc-fs') || ssOn;
      document.documentElement.classList.toggle('rec-chip', full);
      // 브라우저 전체화면(Fullscreen API)은 그 요소 안의 것만 그린다 → 전체화면 동안에는 표시를 그 안으로 옮겨 두고, 나오면 제자리로
      if (recIndicator) {
        if (ssOn && recIndicator.parentNode !== ss) ss.appendChild(recIndicator);
        else if (!ssOn && recIndicator.parentNode !== document.body) document.body.appendChild(recIndicator);
      }
    } catch (e) {}
  }
  if (REC_ROAM_V2 && window.MutationObserver) {
    try {
      var _recMo = new MutationObserver(syncRecChip);
      _recMo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      if ($('slideshow')) _recMo.observe($('slideshow'), { attributes: true, attributeFilter: ['class'] });
      syncRecChip();
    } catch (e) {}
  }

  /* ---------- 녹음 ---------- */
  // v9.4 일하는 케이: 녹음 중 = 받아 적는 모습 + 한마디(값 = 녹음 시작 뒤 지난 분 — 타이머와 같은 시계)
  function recScene(sec) {
    if (!window.KScene) return;
    var min = Math.floor((sec || 0) / 60);
    if (REC_ROAM_V2 && recLost) { KScene.set('kscRec', 'sorry', '녹음이 멈춘 것 같습니다. 정지를 눌러 지금까지의 녹음을 확인해 주십시오.'); return; }
    // v9.8: 첫 1분의 한마디로 「나가도 녹음은 계속된다」를 알린다(따로 안내 줄을 만들지 않는다)
    var first = REC_ROAM_V2 ? '받아 적고 있습니다. 다른 화면을 보셔도 계속 적겠습니다.' : '받아 적고 있습니다. 편하게 말씀하세요.';
    KScene.set('kscRec', 'note', min >= 1 ? '받아 적고 있습니다. ' + min + '분째입니다.' : first);
  }
  // elapsedMs: (v9.8) 이미 돌고 있던 녹음을 되찾을 때 — 그만큼 지난 것으로 시작한다. 평소에는 0.
  function startRecTimer(elapsedMs) {
    recStart = Date.now() - (elapsedMs > 0 ? elapsedMs : 0);
    var s0 = (Date.now() - recStart) / 1000;
    if (recTimerEl) recTimerEl.textContent = fmtRec(s0);
    if (recIndTime) recIndTime.textContent = fmtRec(s0);
    if (recInterval) clearInterval(recInterval);
    recScene(s0);
    recInterval = setInterval(function () {
      var s = (Date.now() - recStart) / 1000;
      if (recTimerEl) recTimerEl.textContent = fmtRec(s);
      if (recIndTime) recIndTime.textContent = fmtRec(s);   // 미니 배너 시간도 함께 갱신
      recScene(s);
      paintRecHome();
    }, 500);
    startRecWatch();
  }
  function stopRecTimer() { if (recInterval) { clearInterval(recInterval); recInterval = null; } stopRecWatch(); }

  /* v9.8(O-0442) 녹음기가 실제로 돌고 있는지 지켜보기.
   *   화면의 시간은 화면 시계로만 흐른다 → 녹음기가 멈춰도 띠의 시간은 계속 올라간다. 그래서 녹음 중에는 8초마다
   *   녹음기에게 직접 묻는다(폰: 네이티브 서비스 · PC판: 브라우저 녹음기와 마이크 선).
   *   「돌고 있지 않다」가 두 번 이어지거나 녹음기가 오류를 알렸으면: 노란 띠 + 녹음 화면의 케이 한마디(진동은 넣지 않는다).
   *   녹음을 스스로 끊거나 다시 시작하지는 않는다 — 확인하고 정지하는 것은 사람이 한다.
   *   물어보지 못한 경우(옛 앱 · 통신 오류)는 「모름」으로 두고 아무것도 바꾸지 않는다. */
  var REC_WATCH_MS = 8000;
  var recWatchTimer = null, recWatchMiss = 0, recWatchBusy = false;
  function recWatchTick() {
    if (!isRecording || !recLive || recWatchBusy || !recorder || !recorder.alive) return;   // 시작이 확인되기 전(마이크 허용 창 등)에는 묻지 않는다
    recWatchBusy = true;
    recorder.alive().then(function (st) {
      recWatchBusy = false;
      if (!isRecording || !st || !st.known) return;
      if (st.on && !st.failed) { recWatchMiss = 0; return; }
      recWatchMiss = st.failed ? 2 : recWatchMiss + 1;
      if (recWatchMiss >= 2 && !recLost) {
        recLost = true;
        // v9.10: 「녹음이 끊겼습니다」 알림 한 번(진동은 폰 설정을 따른다). 녹음기가 오류를 알린 경우는 네이티브가 이미 띄웠다.
        try { if (!st.failed) recFindNotice(); } catch (e) {}
        updateRecIndicator();
        recScene((Date.now() - recStart) / 1000);
        if (isOpen(recView)) toast('녹음이 멈춘 것 같습니다. 정지를 눌러 확인해 주십시오.', 4000);
      }
    }).catch(function () { recWatchBusy = false; });
  }
  function startRecWatch() {
    stopRecWatch();
    if (!REC_ROAM_V2) return;
    recWatchMiss = 0;
    recWatchTimer = setInterval(recWatchTick, REC_WATCH_MS);
  }
  function stopRecWatch() { if (recWatchTimer) { clearInterval(recWatchTimer); recWatchTimer = null; } recWatchBusy = false; }
  // 화면이 다시 보이면(다른 앱·화면 꺼짐에서 돌아옴) 기다리지 않고 바로 한 번 묻는다
  document.addEventListener('visibilitychange', function () { try { if (!document.hidden && REC_ROAM_V2 && isRecording) recWatchTick(); } catch (e) {} });

  // 지금 도는 회의 녹음의 표식(시작 시각). 정지·취소·시작 실패 때 지운다.
  function recSessionSet(at) { try { localStorage.setItem(REC_SESSION_KEY, JSON.stringify({ at: at || Date.now() })); } catch (e) {} }
  function recSessionGet() { try { var o = JSON.parse(localStorage.getItem(REC_SESSION_KEY) || 'null'); return (o && o.at) ? o : null; } catch (e) { return null; } }
  function recSessionClear() { try { localStorage.removeItem(REC_SESSION_KEY); } catch (e) {} }

  /* v9.8(O-0442) 앱 화면이 다시 만들어졌을 때(최근 앱에서 밀어 닫았다 열기 · 폰이 화면을 정리함) — 녹음 상태 되찾기.
   *   녹음은 네이티브 서비스에서 계속 돌 수 있는데 새로 뜬 화면은 그것을 모른다 → 켜질 때 서비스에 묻는다.
   *   ① 회의 녹음이 돌고 있다 → 띠·타이머를 그 녹음의 지난 시간으로 세운다.
   *        저장해 둔 시작 시각과 같으면 「계속되고 있었습니다」, 다르거나 알 수 없으면 「한 번 끊겼을 수 있습니다」(사실대로).
   *   ② 주인을 잃은 음성 입력(대화 한 마디·아이디어)이 돌고 있다 → 받을 화면이 없으니 끝낸다(안 그러면 다음 회의 녹음 시작이 막힌다).
   *   ③ 녹음이 돌고 있지 않은데 표식이 남아 있다 → 그 녹음은 앱이 닫히며 끊긴 것. 숨기지 않고 알린다.
   *   PC판은 페이지를 새로 열면 녹음도 사라지므로 ③만 해당한다. */
  var recRecoverBusy = null;
  function recSay(fn) {                                  // 시작 인사가 화면을 덮고 있는 동안에는 기다렸다가 말한다
    (function wait(n) {
      try { if (window.KIntro && KIntro.active && KIntro.active() && n < 24) { setTimeout(function () { wait(n + 1); }, 500); return; } } catch (e) {}
      try { fn(); } catch (e) {}
    })(0);
  }
  function recRecover() {
    if (!REC_ROAM_V2) return Promise.resolve(false);
    if (isRecording) return Promise.resolve(true);
    if (recRecoverBusy) return recRecoverBusy;
    var q = RecordingModule.status ? RecordingModule.status() : Promise.resolve({ known: false, on: false });
    recRecoverBusy = q.then(function (st) {
      recRecoverBusy = null;
      st = st || {};
      var sess = recSessionGet();
      if (isRecording) return true;                       // 그 사이 새로 시작했다
      if (chatRecording || ideaRecording) return false;   // 이 화면이 방금 시작한 음성 입력 — 건드리지 않는다
      if (st.known && st.on && (st.kind === 'meeting' || (!st.rich && sess))) {
        var same = !!(sess && st.startedAt && Math.abs(sess.at - st.startedAt) < 15000);
        isRecording = true; recCancelled = false; recLost = !!st.failed; recLive = true;
        try { recorder.adopt(); } catch (e) {}
        startRecTimer(st.elapsedMs || (sess ? Date.now() - sess.at : 0));
        recSessionSet(st.startedAt || recStart);
        setStatus('녹음 중', 'rec'); updateRecIndicator();
        recSay(function () {
          if (same) toast('녹음이 계속되고 있었습니다.', 4000);   // 짧게(폰 폭에서 2줄) — 돌아가는 길은 띠가 보여 준다
          else showBanner('⚠️ 녹음이 돌고 있습니다. 다만 앱 화면이 닫혔다 열린 사이에 <b>한 번 끊겼을 수 있습니다</b> — 정지한 뒤 담긴 길이를 확인해 주십시오.');
        });
        recFindScan(0, false, false);                     // v9.10: 지금 녹음과 별개로 남아 있는 것이 있으면 목록만 맞춘다(묻지는 않는다)
        return true;
      }
      if (st.known && st.on && st.rich && (st.kind === 'chat' || st.kind === 'idea')) {
        try { if (RecordingModule.stopOrphan) RecordingModule.stopOrphan(); } catch (e) {}
        recFindScan(0, true, false);
        return false;
      }
      if (sess && ((st.known && !st.on) || !readNative())) {
        recSessionClear();
        // v9.10: 끊긴 녹음을 폰에서 찾는다. 찾으면 창으로 알리고, 파일을 정말 찾지 못했을 때만 사실대로 글을 띄운다.
        if (recFindApi()) { recFindScan(sess.at, true, true); return false; }
        var d = new Date(sess.at);
        recSay(function () {
          showBanner('⚠️ 앱이 닫히면서 지난 녹음(' + d.getHours() + '시 ' + pad2(d.getMinutes()) + '분 시작)이 끊겼습니다. 이번 판에서는 그 녹음을 다시 열 수 없습니다.');
        });
        return false;
      }
      recFindScan(0, true, false);                        // v9.10: 표식이 없어도 일지에 남은 것(정지 뒤 보내지 않은 녹음 등)을 찾는다
      return false;
    }).catch(function () { recRecoverBusy = null; return false; });
    return recRecoverBusy;
  }
  // 회의 녹음 알림을 눌러 들어왔다 → 녹음 화면으로(화면이 새로 뜬 참이면 되찾은 뒤에)
  function recOpenFromNotif() {
    if (isRecording) { openScreen(recView); return; }
    recRecover().then(function (ok) { if (ok && isRecording) openScreen(recView); });
  }
  /* ===================== v9.10(O-0449) 끊긴 녹음 찾기 =====================
   * 폰 안쪽의 일지(네이티브 RecJournal)가 「끊긴 녹음」(녹음 중이라고 적힌 채 남은 것)과 「보내지 않은 녹음」(정지했는데 임시저장 · 보내기로
   * 넘기지 않은 것)을 묶음 단위로 알려 준다. 화면은 그것을 ① 창으로 한 번 여쭙고 ② 홈 · 회의록의 「진행 중」 목록에 항목으로 두고
   * ③ 홈 케이 카드의 한 줄로 말한다. 새 화면은 없다 — 선택 창 · 「진행 중」 목록 · 「녹음 완료」 화면을 그대로 쓴다.
   *   [이어서 녹음]  = 새 녹음을 평소 방식 그대로 시작하되 「같은 회의」라고 표시 → 정지하면 앞 녹음과 한 파일로 이어 준다(끊긴 지 60분까지).
   *   [여기까지 저장] = 남아 있는 녹음을 「녹음 완료」 화면에 올린다(제목 · 회의자료 · 보내기 · 임시 저장은 평소와 같다).
   *   [나중에]        = 「진행 중」 목록에 「끊긴 녹음」 항목으로 남는다.   [목록에서 빼기] = 목록에서만 뺀다.
   * 이 판은 어떤 녹음 파일도 지우지 않는다. 폰이 스스로 다시 녹음을 시작하지도 않는다(누르실 때만).
   * 네이티브가 옛 판이거나 PC판이면 recFindApi() 가 null → 모두 건너뛰고 v9.9 와 같게 돈다. */
  function recFindApi() {
    try { var f = (REC_FIND && REC_ROAM_V2) ? RecordingModule.find : null; return (f && f.ok && f.ok()) ? f : null; } catch (e) { return null; }
  }
  // 시각 글: 「오후 2시 5분」(ap=true) · 「2시 52분」. 빠진 구간은 「2시 52분~54분」처럼 시각으로 적는다(녹음 길이 1:18:40 과 헷갈리지 않게).
  function recHM(ms, ap) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    return (ap ? (h < 12 ? '오전 ' : '오후 ') : '') + (h % 12 || 12) + '시 ' + m + '분';
  }
  function recSpan(a, b) {
    var x = new Date(a), y = new Date(b);
    if (x.getHours() === y.getHours() && x.getDate() === y.getDate()) return x.getMinutes() === y.getMinutes() ? recHM(a) : recHM(a) + '~' + y.getMinutes() + '분';
    return recHM(a) + '~' + recHM(b);
  }
  function recWhen(ms) {            // 오늘이 아니면 날짜를 앞에 붙인다
    var d = new Date(ms), n = new Date();
    var same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return (same ? '' : (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ') + recHM(ms, true);
  }
  function recTitleAt(ms) { var d = new Date(ms || Date.now()); return '메모 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + d.getHours() + '시'; }
  function recDurText(ms) { return fmtDurKo(Math.floor((ms || 0) / 1000)) || '몇 초'; }
  function recGapLine(gaps) {
    try {
      if (!gaps || !gaps.length) return '';
      var tot = 0; gaps.forEach(function (g) { tot += Math.max(0, (g.b || 0) - (g.a || 0)); });
      var t = fmtDurKo(Math.max(1, Math.round(tot / 1000))) || '잠깐';
      return '약 ' + t + (/초$/.test(t) ? '가' : '이') + ' 빠졌습니다 (' + recSpan(gaps[0].a, gaps[0].b) + (gaps.length > 1 ? ' 등 ' + gaps.length + '곳' : '') + ')';
    } catch (e) { return ''; }
  }
  function recHandedMap() { try { return JSON.parse(localStorage.getItem(REC_HANDED_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function recHandedSet(gid, memoId) {
    try {
      var m = recHandedMap(); m[gid] = { id: memoId || '', t: Date.now() };
      var ks = Object.keys(m); if (ks.length > 60) { ks.sort(function (a, b) { return (m[a].t || 0) - (m[b].t || 0); }); ks.slice(0, ks.length - 60).forEach(function (k) { delete m[k]; }); }
      localStorage.setItem(REC_HANDED_KEY, JSON.stringify(m));
    } catch (e) {}
  }
  // 폰에 남은 것을 다시 읽어 목록 · 홈 한 줄을 맞춘다. ask=true 면 아직 여쭙지 않은 것을 창으로 여쭙는다.
  //   sessAt = 예전 화면이 남긴 「녹음 시작 시각」 표식(v9.8 · v9.9 에서 끊긴 녹음도 그 시각으로 찾는다). fromSess = 그 표식에서 온 부름.
  var recFindBusy = null;
  function recFindScan(sessAt, ask, fromSess) {
    var api = recFindApi(); if (!api) return Promise.resolve(null);
    if (recFindBusy) return recFindBusy;
    recFindBusy = api.lost(sessAt || 0).then(function (items) {
      recFindBusy = null;
      if (!items) { if (fromSess) recFindNoFile(sessAt); return null; }
      var handed = recHandedMap(), keep = [];
      items.forEach(function (it) {
        if (!it || !it.gid) return;
        if (handed[it.gid]) { api.mark(it.gid, 'handed', 'late'); return; }            // 넘김 표시를 쓰기 직전에 앱이 꺼진 경우 — 다시 묻지 않는다
        if (recCur && recCur.gid === it.gid && pendingBlob) return;                    // 지금 「녹음 완료」 화면에 올라와 있는 그 녹음
        keep.push(it);
      });
      keep.sort(function (a, b) { return (b.endedAt || 0) - (a.endedAt || 0); });
      recFindItems = keep;
      recFindSync();
      if (fromSess && !keep.some(function (it) { return it.type === 'cut'; })) recFindNoFile(sessAt);
      if (ask && !isRecording) recFindAsk();
      return keep;
    }).catch(function () { recFindBusy = null; return null; });
    return recFindBusy;
  }
  function recFindNoFile(sessAt) {
    if (!sessAt) return;
    var d = new Date(sessAt);
    recSay(function () { showBanner('⚠️ 앱이 닫히면서 지난 녹음(' + d.getHours() + '시 ' + pad2(d.getMinutes()) + '분 시작)이 끊겼습니다. 그 녹음 파일을 폰에서 찾지 못했습니다.'); });
  }
  function recFindSubText(it) {
    if (!it.readable) return '열리지 않는 파일';
    return recDurText(it.durMs) + (it.type === 'unsent' ? ' · 눌러서 열기' : ' · 눌러서 저장');
  }
  // 「진행 중」 목록(지난 메모 기록)과 맞춘다 — 항목 id 는 'rf-' + 묶음 번호. 홈 케이 한 줄도 다시 그린다.
  function recFindSync() {
    try {
      var want = {};
      recFindItems.forEach(function (it) { want['rf-' + it.gid] = it; });
      HistoryModule.list().forEach(function (e) { if (e.status === 'lost' && !want[e.id]) HistoryModule.remove(e.id); });
      recFindItems.forEach(function (it) {
        var id = 'rf-' + it.gid, d = new Date(it.startedAt || Date.now());
        var f = { title: recTitleAt(it.startedAt), date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
                  status: 'lost', kind: 'audio', recGid: it.gid, recType: it.type, recSub: recFindSubText(it) };
        if (HistoryModule.get(id)) HistoryModule.update(id, f); else { f.id = id; f.token = ''; HistoryModule.add(f); }
      });
      renderHistory();
    } catch (e) {}
    try { homeSayRepaint(); } catch (e) {}
  }
  function recFindGet(gid) { for (var i = 0; i < recFindItems.length; i++) if (recFindItems[i].gid === gid) return recFindItems[i]; return null; }
  // 홈 케이 카드의 한 줄(SmartHomeSay 가 부른다). 열리는 것이 없으면 말하지 않는다.
  function recHomeLine() {
    if (!recFindApi() || isRecording) return '';
    var ok = recFindItems.filter(function (it) { return it.readable; });
    if (!ok.length) return '';
    if (ok.length > 1) return (ok.every(function (it) { return it.type === 'unsent'; }) ? '보내지 않은 녹음 ' : '끊긴 녹음 ') + ok.length + '건이 폰에 남아 있습니다.';
    return (ok[0].type === 'unsent' ? '보내지 않은 녹음 ' : '끊긴 녹음 ') + recDurText(ok[0].durMs) + ' 분량이 폰에 남아 있습니다.';
  }
  function recFindAsk() {
    var fresh = recFindItems.filter(function (it) { return !it.asked && !recFindAsked[it.gid]; });
    if (!fresh.length) return;
    recSay(function () {
      if (isRecording || (pendingBlob && isOpen(recordedPanel))) return;       // 그 사이 다른 일을 시작했다 — 목록과 홈 한 줄이 남아 있다
      if (sheetEl && isOpen(sheetEl)) return;                                  // 다른 창이 떠 있다 — 덮지 않는다
      var api = recFindApi();
      fresh.forEach(function (it) { recFindAsked[it.gid] = 1; it.asked = true; if (api) api.mark(it.gid, 'asked', ''); });
      if (fresh.length === 1) recFindSheetOne(fresh[0]); else recFindSheetMany(fresh);
    });
  }
  function recFindCanGo(it) { return !!(it && it.readable && it.type === 'cut' && (Date.now() - (it.endedAt || 0)) <= 60 * 60000); }
  function recFindSheetOne(it) {
    var O = { positive: true, recmsg: true, cancelLabel: '나중에', main: 'confirm' };
    if (!it.readable) {
      openSheet('이 녹음은 열리지 않습니다', recWhen(it.startedAt) + '에 시작한 녹음 파일이\n열리지 않습니다.\n지우지 않고 폰에 그대로 두었습니다.', '확인', null, null, null,
        { positive: true, recmsg: true, cancelLabel: '닫기', main: 'confirm' });
      return;
    }
    if (it.type === 'unsent') {
      O.icon = 'i-note';
      openSheet('보내지 않은 녹음이 있습니다', recWhen(it.startedAt) + '에 녹음한 ' + recDurText(it.durMs) + ' 분량이\n아직 폰에만 있습니다.', '열기', function () { recFindSave(it); }, null, null, O);
      return;
    }
    var mins = (Date.now() - (it.endedAt || 0)) / 60000, go = recFindCanGo(it);
    if (go && mins <= 10) O.main = 'extra';            // 끊긴 지 10분 안이면 기본은 [이어서 녹음], 넘었으면 [여기까지 저장]
    openSheet('끊긴 녹음이 있습니다',
      recWhen(it.startedAt) + '에 시작한 회의 녹음이\n' + recHM(it.endedAt) + '에 끊겼습니다.\n끊기기 전 ' + recDurText(it.durMs) + ' 분량은 폰에 있습니다.',
      '여기까지 저장', function () { recFindSave(it); }, null,
      go ? { label: '이어서 녹음', action: function () { recFindContinue(it); } } : null, O);
  }
  function recFindSheetMany(list) {
    var lines = list.slice(0, 4).map(function (it) {
      var d = new Date(it.startedAt);
      return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + recHM(it.startedAt, true) + ' · ' + (it.readable ? recDurText(it.durMs) : '열리지 않음');
    });
    if (list.length > 4) lines.push('외 ' + (list.length - 4) + '건');
    var allCut = list.every(function (it) { return it.type === 'cut'; });
    openSheet((allCut ? '끊긴 녹음이 ' : '보내지 않은 녹음이 ') + list.length + '건 있습니다', lines.join('\n') + '\n\n폰에 그대로 남아 있습니다.', '하나씩 보기', function () { openMeetings(); }, null, null,
      { positive: true, icon: 'i-note', recmsg: true, cancelLabel: '나중에', main: 'confirm' });
  }
  // 「진행 중」 목록의 항목을 눌렀다 — 임시저장 · 실패 항목과 같은 창에서 고른다. [목록에서 빼기]는 여기에만 둔다.
  function recFindItemOpen(gid) {
    var it = recFindGet(gid);
    if (!it) { recFindScan(0, false, false); toast(tw('이미 처리된 녹음입니다.')); return; }
    var dur = recDurText(it.durMs), go = recFindCanGo(it), body;
    if (!it.readable) body = '이 녹음 파일은 열리지 않습니다.<br>지우지 않고 폰에 그대로 두었습니다.';
    else if (it.type === 'unsent') body = recWhen(it.startedAt) + '에 녹음한 <b>' + esc(dur) + '</b> 분량이 아직 폰에만 있습니다.';
    else body = recWhen(it.startedAt) + '에 시작한 회의 녹음이 ' + recHM(it.endedAt) + '에 끊겼습니다.<br>끊기기 전 <b>' + esc(dur) + '</b> 분량은 폰에 있습니다.';
    modalTitle.textContent = recTitleAt(it.startedAt);
    modalBody.innerHTML = '<div class="card rcard"><div class="h"><svg><use href="#i-mic"/></svg>' + (it.type === 'unsent' ? '보내지 않은 녹음' : '끊긴 녹음') + '</div>' +
      '<div style="padding:2px 2px 0;line-height:1.6;word-break:keep-all">' + body + '</div></div>' +
      '<div class="btnrow">' +
      (it.readable ? '<button id="mRfSave" class="btn primary"><svg><use href="#i-check"/></svg>' + (it.type === 'unsent' ? '열기' : '여기까지 저장') + '</button>' : '') +
      (go ? '<button id="mRfGo" class="btn ghost"><svg><use href="#i-mic"/></svg>이어서 녹음</button>' : '') +
      '</div>' +
      '<div class="btnrow"><button id="mRfDrop" class="btn ghost sm"><svg><use href="#i-x"/></svg>목록에서 빼기</button></div>' +
      '<div class="draft-hint">목록에서 빼도 녹음 파일은 지우지 않고 폰에 그대로 둡니다.</div>';
    if ($('mRfSave')) $('mRfSave').addEventListener('click', function () { closeModal(); recFindSave(it); });
    if ($('mRfGo')) $('mRfGo').addEventListener('click', function () { closeModal(); recFindContinue(it); });
    $('mRfDrop').addEventListener('click', function () {
      openSheet('목록에서 뺄까요?', '녹음 파일은 지우지 않고 폰에 그대로 둡니다.', '목록에서 빼기', function () {
        var api = recFindApi(); if (api) api.mark(it.gid, 'dropped', 'list');
        recFindItems = recFindItems.filter(function (x) { return x.gid !== it.gid; });
        closeModal(); recFindSync(); toast(tw('목록에서 뺐습니다.'));
      });
    });
    modal.style.display = 'flex';
  }
  // [이어서 녹음] — 평소의 [녹음 시작]과 같은 길로 시작하고, 「앞 녹음과 같은 묶음」이라는 표시만 함께 넘긴다.
  function recFindContinue(it) {
    if (!recFindApi() || !it) return;
    if (isRecording) { openScreen(recView); return; }
    if (pendingBlob && !recPanelShared) { openScreen(recordedPanel); toast(tw('아직 보내지 않은 녹음이 있습니다.'), 3000); return; }
    if (chatRecording || ideaRecording) { toast(tw('말로 입력을 마친 뒤 눌러\u00a0주십시오.'), 3000); return; }
    recGroupNext = it.gid;
    pendingMaterials = []; renderMatList();
    if (btnStartRec) btnStartRec.click();
    setTimeout(function () {
      if (!(isRecording && recGroup)) { recGroupNext = ''; return; }
      toast(tw('이어서 녹음합니다.'), 2500);
      recFindItems = recFindItems.filter(function (x) { return x.gid !== it.gid; });   // 이어 녹음하는 동안 그 묶음은 「끊긴 녹음」이 아니다
      recFindSync();
    }, 700);
  }
  function recPanelText(title, retakeHtml) {
    var ttl = recordedPanel ? recordedPanel.querySelector('.subbar .title') : null;
    if (ttl) ttl.textContent = title;
    if (btnRetake) btnRetake.innerHTML = retakeHtml;
  }
  // [여기까지 저장] · [열기] — 남아 있는 녹음을 「녹음 완료」 화면에 올린다(제목 · 회의자료 · 보내기 · 임시 저장은 평소와 같다).
  function recFindSave(it) {
    var api = recFindApi(); if (!api || !it) return;
    if (isRecording) { toast(tw('녹음을 마친 뒤 눌러\u00a0주십시오.'), 3000); return; }
    if (pendingBlob && !recPanelShared) { openScreen(recordedPanel); toast(tw('아직 보내지 않은 녹음이 있습니다.'), 3000); return; }
    toast(tw('녹음을 불러옵니다…'), 2500);
    api.open(it.gid).then(function (r) {
      if (!r || !r.ok || !r.blob) {
        if (r && r.code === 'unreadable') {
          it.readable = false; recFindSync();
          openSheet('이 녹음은 열리지 않습니다', recWhen(it.startedAt) + '에 시작한 녹음 파일이\n열리지 않습니다.\n지우지 않고 폰에 그대로 두었습니다.', '확인', null, null, null,
            { positive: true, recmsg: true, cancelLabel: '닫기', main: 'confirm' });
        } else toast(tw('녹음을 열지 못했습니다.'), 3000);
        return;
      }
      if (isRecording || (pendingBlob && !recPanelShared)) return;            // 불러오는 사이 다른 녹음이 시작됐다
      hideBanner();
      recPanelMode(false);
      pendingBlob = r.blob; pendingMaterials = []; renderMatList();
      recCur = { gid: r.gid || it.gid, recovered: true, type: it.type, startedAt: r.startedAt || it.startedAt, endedAt: r.endedAt || it.endedAt,
                 durMs: r.durationMs || 0, joined: !!r.joined, parts: r.parts || 1, gaps: r.gaps || [], skipped: r.skipped || 0, code: r.code || '' };
      if (memoTitle) memoTitle.value = recTitleAt(recCur.startedAt);
      recPanelText(it.type === 'unsent' ? '보내지 않은 녹음' : '끊긴 녹음', '<svg><use href="#i-x"/></svg>닫기 (나중에)');
      var lines = [];
      if (it.type === 'unsent') lines.push('✅ 녹음됐습니다 · ' + fmtRec(recCur.durMs / 1000), '(' + recWhen(recCur.startedAt) + '에 녹음 · 아직 보내지 않음)');
      else lines.push('끊기기 전 ' + recDurText(recCur.durMs) + ' 분량이 남아 있었습니다', '(' + recWhen(recCur.endedAt) + '에 끊김)');
      var gl = recGapLine(recCur.gaps); if (gl) lines.push(gl);
      if (recCur.skipped) lines.push('열리지 않는 부분 ' + recCur.skipped + '개는 뺐습니다');
      if (recDoneBadge) recDoneBadge.textContent = lines.join('\n');
      openScreen(recordedPanel);
      setStatus('녹음 — 제목 정하고 보내기', 'idle');
      recFindItems = recFindItems.filter(function (x) { return x.gid !== it.gid && x.gid !== recCur.gid; });
      recFindSync();
      recFindDiag(recCur.gid);
    }).catch(function () { toast(tw('녹음을 열지 못했습니다.'), 3000); });
  }
  function recFindDiag(sid) {
    var api = recFindApi(); if (!api) return;
    try { api.diag(sid || '').then(function (d) { if (d) recDiagLast = d; }); } catch (e) {}
  }
  // 정지해서 「녹음 완료」 화면이 떴다(onRecorded) — 일지 번호를 붙들고, 이어 녹음이었다면 빠진 구간을 딱지에 적는다.
  function recFindOnRecorded(durMs) {
    var grp = recGroup; recGroup = ''; recCur = null;
    var last = (recorder && recorder.last) || null;
    if (!recFindApi() || !last || !last.sid) return;
    recCur = { gid: last.gid || last.sid, sid: last.sid, recovered: false, type: 'new', startedAt: last.startedAt || 0, durMs: durMs || 0,
               joined: !!last.joined, parts: last.parts || 1, gaps: last.gaps || [], skipped: last.skipped || 0, code: last.code || '', cont: !!grp };
    var more = [];
    if (recCur.joined) { var gl = recGapLine(recCur.gaps); if (gl) more.push(gl); }
    else if (grp) more.push('앞 녹음과 잇지 못했습니다.', '앞 녹음은 「진행 중인 메모」에 있습니다.');
    if (recCur.skipped) more.push('열리지 않는 부분 ' + recCur.skipped + '개는 뺐습니다');
    if (more.length && recDoneBadge) recDoneBadge.textContent = recDoneBadge.textContent + '\n' + more.join('\n');
    recFindDiag(last.sid);
    recFindScan(0, false, false);       // 이어 담긴 앞부분은 목록에서 빠지고, 잇지 못한 앞부분은 남는다
  }
  // 「녹음 완료」 화면의 녹음을 보내지 않고 내려놓았다(discardRecorded).
  function recFindDiscard() {
    var c = recCur; recCur = null;
    var api = recFindApi(); if (!c || !api) return;
    if (c.recovered) { recFindScan(0, false, false); return; }      // [닫기 (나중에)] — 버린 것이 아니다. 목록에 다시 나타난다.
    api.mark(c.gid, 'dropped', 'discard');                          // [버리기] · [다시 녹음] — 목록에 올리지 않는다(파일은 지우지 않는다)
  }
  // 임시저장 · 보내기로 넘겼다 — 폰 저장소에 원본이 들어간 것을 확인한 뒤에만 부른다.
  function recFindHanded(gid, memoId, how) {
    if (!gid) return;
    recHandedSet(gid, memoId);
    var api = recFindApi(); if (api) api.mark(gid, 'handed', how || '');
    recFindItems = recFindItems.filter(function (x) { return x.gid !== gid; });
    recFindSync();
  }
  function recMetaOf(c) {
    var m = { v: 1, gid: c.gid, how: c.recovered ? (c.type === 'unsent' ? 'unsent' : 'cut') : (c.cont ? 'cont' : 'new'), ms: c.durMs || 0, at: c.startedAt || 0 };
    if (c.endedAt) m.end = c.endedAt;
    if (c.parts > 1 || c.joined) { m.parts = c.parts; m.joined = c.joined ? 1 : 0; }
    if (c.gaps && c.gaps.length) m.gaps = c.gaps.map(function (g) { return [g.a, g.b]; });
    if (c.skipped) m.skip = c.skipped;
    if (c.code) m.code = c.code;
    if (recDiagLast) m.d = recDiagLast;
    return m;
  }
  // [PC로 보내 정리하기]를 눌렀다 — 메모에 일지 번호 · 진단 값을 싣고, 「넘김」 표시는 원본이 폰 저장소에 들어간 뒤에 남긴다(memo.onStored).
  function recFindAttach(memo) {
    var c = recCur; recCur = null;
    if (!c || !recFindApi()) return;
    memo.recSid = c.gid;
    memo.recMeta = recMetaOf(c);
    memo.onStored = function () { recFindHanded(c.gid, memo.id, 'send'); };
  }
  // 앱이 살아 있는 채로 녹음기가 멈춘 것을 화면이 알아챘다 — 「녹음이 끊겼습니다」 알림 한 번(같은 녹음에 되풀이 없음)
  function recFindNotice() { var api = recFindApi(); if (api) { try { api.notice(recStart); } catch (e) {} } }
  // 녹음 준비 화면의 저장 공간 한 줄 — 모자라 보일 때만. 녹음 파일 + 정지 때 화면이 읽은 사본 + 보관 사본, 세 벌로 어림한다(1분에 약 1MB).
  function recSpaceHint() {
    var el = $('recSpaceHint'); if (!el) return;
    el.style.display = 'none';
    var api = recFindApi(); if (!api) return;
    api.space().then(function (mb) {
      if (!(mb > 0) || !isOpen(recPrep)) return;
      var min = Math.floor(mb / 3);
      if (min >= 180) return;
      el.textContent = '남은 저장 공간으로는 약 ' + (min >= 60 ? fmtDurKo(min * 60) : Math.max(1, min) + '분') + '쯤 녹음할 수 있습니다.';
      el.style.display = '';
    }).catch(function () {});
  }
  // 스위치가 꺼져 있거나 네이티브가 옛 판이면 「진행 중」 목록에 남은 「끊긴 녹음」 항목을 걷는다(누를 수 없는 항목이 남지 않게)
  setTimeout(function () {
    try { if (!recFindApi()) { var ch = false; HistoryModule.list().forEach(function (e) { if (e.status === 'lost') { HistoryModule.remove(e.id); ch = true; } }); if (ch) renderHistory(); } } catch (e) {}
  }, 0);

  // PC판: 녹음 중이거나 아직 보내지 않은 녹음이 있을 때 탭을 닫거나 새로 고치려 하면 브라우저가 한 번 묻는다(문구는 브라우저가 정한다)
  if (REC_ROAM_V2 && !readNative()) {
    window.addEventListener('beforeunload', function (e) {
      if (isRecording || (pendingBlob && !recPanelShared)) { e.preventDefault(); e.returnValue = ''; return ''; }
    });
  }

  if (!RecordingModule.isSupported()) {
    showBanner('⚠️ 이 브라우저는 녹음을 지원하지 않습니다. 갤럭시/안드로이드의 <b>Chrome</b>에서 열어 주세요.');
    if (btnRecord) { btnRecord.disabled = true; btnRecord.style.opacity = '.5'; }
  }

  var recorder = new RecordingModule({
    kind: 'meeting',                     // v9.8: 회의 녹음(다른 종류의 녹음이 끼어들지 못하게 네이티브가 구분한다)
    onStatus: function (s) {
      if (s === 'recording') { setStatus('녹음 중', 'rec'); if (REC_ROAM_V2 && isRecording) { recLive = true; recSessionSet(recStart); } }
      else if (s === 'stopped') setStatus('녹음 완료', 'idle');
      else if (s === 'error') {
        setStatus('오류', 'err');
        // 녹음 시작 실패(네이티브 reject 등) 정리: 타이머 계속 돌아 혼란주지 않게 상태를 되돌리고
        //   녹음/준비 화면이면 홈으로 복귀(실패 안내 배너는 onError 가 이미 표시). — 2026-09-21
        if (isRecording) { isRecording = false; recLost = false; recSessionClear(); stopRecTimer(); updateRecIndicator(); }
        if (recGroup) { recGroup = ''; try { recFindScan(0, false, false); } catch (e) {} }   // v9.10: 시작하지 못했다 — 이어 녹음 표시를 거두고 목록을 다시 맞춘다(끊긴 녹음은 그대로 있다)
        if (isOpen(recView) || isOpen(recPrep)) showHome();
      }
    },
    onLevel: function (v) { if (levelBar) levelBar.style.width = Math.round(v * 100) + '%'; },
    onError: function (m) {
      showBanner('⚠️ ' + m);
      // v9.8: 정지했는데 녹음 파일을 받지 못한 경우 — 안내(홈 화면의 배너)가 보이게 녹음 화면에 남겨 두지 않는다
      if (REC_ROAM_V2 && !isRecording) { recLost = false; if (isOpen(recView)) showHome(); }
      // v9.10: 정지했는데 파일을 받지 못했다(녹음 서비스가 먼저 사라진 경우 등) — 폰에 남은 것이 있는지 바로 찾아 알린다
      try { if (!isRecording) recFindScan(0, true, false); } catch (e) {}
    },
    onAudio: function (blob) { onRecorded(blob); }
  });

  /* ---------- 회의자료 첨부(녹음 전 준비 화면 + 녹음 후 완료 화면 공용) ----------
   * pendingMaterials(하나) 를 두 화면(matList·matListPrep)에 똑같이 그려서
   * 녹음 전에 붙인 자료가 녹음 후에도 그대로 이어지고, 어느 쪽에서든 더 붙이거나 뺄 수 있다. */
  // 자료 줄 목록(이름 · 용량 · ✕). 녹음 화면과 임시저장 재개 창(v7.9)이 함께 쓴다.
  //   긴 이름은 한 줄에서 말줄임(…) — 용량과 ✕ 는 항상 보이게. ✕ 의 data-i = 목록에서의 순서.
  //   compact=true 는 임시저장 창용 낮은 줄(창이 길어져 [PC로 보내기]가 화면 밖으로 밀리지 않게).
  function matListHtml(files, compact) {
    return '<div class="vfiles"' + (compact ? ' style="gap:6px"' : '') + '>' + files.map(function (f, i) {
      var mb = Math.round((f.size || 0) / 1024 / 1024 * 10) / 10;
      return '<div class="filemeta"' + (compact ? ' style="padding:8px 12px;font-size:14px;border-radius:12px"' : '') + '><svg><use href="#i-doc"/></svg>' +
        '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.name || '자료') + '</span>' +
        (mb ? '<span style="flex:none;white-space:nowrap">· ' + mb + 'MB</span>' : '') +
        ' <button type="button" class="matdel" data-i="' + i + '" aria-label="빼기" ' +
        'style="flex:none;margin-left:auto;background:none;border:0;color:inherit;font-size:16px;cursor:pointer">✕</button></div>';
    }).join('') + '</div>';
  }
  function renderMatList() {
    var html;
    if (!pendingMaterials.length) {
      html = '<p class="empty" style="margin:4px 0">첨부한 회의자료가 없습니다. (선택)</p>';
    } else {
      html = matListHtml(pendingMaterials) + '<div class="draft-hint">' + MAT_LIMIT_HINT + '</div>';
    }
    [matList, matListPrep].forEach(function (box) {
      if (!box) return;
      box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll('.matdel'), function (b) {
        b.addEventListener('click', function () {
          pendingMaterials.splice(+b.getAttribute('data-i'), 1); renderMatList();
        });
      });
    });
  }
  /* v7.8: 같은 자료를 두 번 고르면 두 번 붙던 것 — 이름·크기·수정시각이 모두 같으면 같은 파일로 보고 한 번만 붙인다.
   *   (녹음 화면·임시저장 재개 창 공용) 반환: 새로 붙일 파일 배열, .dup = 빼 버린 중복 수. */
  function matKey(f) { return ((f && f.name) || '') + '|' + ((f && f.size) || 0) + '|' + ((f && f.lastModified) || 0); }
  function newMaterials(have, picked) {
    var seen = {}, out = [], dup = 0;
    (have || []).forEach(function (f) { seen[matKey(f)] = 1; });
    (picked || []).forEach(function (f) { var k = matKey(f); if (seen[k]) { dup++; return; } seen[k] = 1; out.push(f); });
    out.dup = dup;
    return out;
  }
  // v7.8: PC가 요약에 읽어 넣는 자료 글자 수 상한(voice-memo-collector collect.py MAT_TEXT_PER·MAT_TEXT_TOTAL)을 앱에서도 알린다.
  //   ⚠️ PC 쪽 값을 바꾸면 이 문구도 함께 고칠 것.
  var MAT_LIMIT_HINT = '자료가 길거나 많으면 자료 하나당 앞에서 약 2만 자, 모두 합쳐 약 6만 자까지만 요약에 반영됩니다.';
  function openMatPicker() { if (matInput) matInput.click(); }   // 두 화면의 [회의자료 붙이기] 공용 — 바로 파일 선택 열림
  if (matAttach) matAttach.addEventListener('click', openMatPicker);
  if (matAttachPrep) matAttachPrep.addEventListener('click', openMatPicker);
  if (matInput) matInput.addEventListener('change', function () {
    var arr = keepSendable(this.files);          // v6.6: 회의자료 40MB → 5GB(File 그대로 스트리밍 업로드)
    var add = newMaterials(pendingMaterials, arr);
    pendingMaterials = pendingMaterials.concat(add);
    renderMatList();
    if (add.dup && !arr.removed) toast('이미 붙인 자료 ' + add.dup + '개는 다시 붙이지 않았습니다.');
    this.value = '';
  });

  // 홈에서 녹음 오브 → 바로 녹음하지 않고 「준비 화면」으로(자료 첨부 + [녹음 시작])
  if (btnRecord) btnRecord.addEventListener('click', function () {
    if (REC_ROAM_V2 && isRecording) { openScreen(recView); return; }      // v9.8: 녹음 중에는 돌아가는 길
    if (btnRecord.disabled || isRecording) return;
    // v9.8: 아직 보내지 않은 녹음이 남아 있으면(완료 화면을 다른 길로 떠난 경우) 새로 시작하기 전에 그 화면으로 — 새 녹음이 덮어쓰지 않게
    if (REC_ROAM_V2 && pendingBlob && !recPanelShared) { openScreen(recordedPanel); toast(tw('아직 보내지 않은 녹음이 있습니다.'), 3000); return; }
    hideBanner();
    pendingMaterials = []; renderMatList();   // 준비 화면 진입 — 회의자료 첨부 새로 시작(녹음 전에도 붙일 수 있음)
    openScreen(recPrep);
    setStatus('녹음 준비 — 시작을 눌러 주세요', 'idle');
    try { recSpaceHint(); } catch (e) {}      // v9.10: 저장 공간이 모자라 보이면 한 줄(읽기만 — 시작을 막지 않는다)
  });
  // 준비 화면의 [녹음 시작] → 이때 실제 녹음 시작(붙여둔 회의자료는 그대로 유지)
  if (btnStartRec) btnStartRec.addEventListener('click', function () {
    if (isRecording) return;
    if (!RecordingModule.isSupported()) { showBanner('⚠️ 이 브라우저는 녹음을 지원하지 않습니다.'); return; }
    // v9.8: 아직 보내지 않은 녹음이 있으면 어느 길로 왔든(바로가기 포함) 새 녹음이 덮어쓰지 않게 그 녹음으로 데려간다
    if (REC_ROAM_V2 && pendingBlob && !recPanelShared) { openScreen(recordedPanel); toast(tw('아직 보내지 않은 녹음이 있습니다.'), 3000); return; }
    // v9.8: 음성 대화·아이디어 녹음이 같은 녹음기를 쓰고 있으면 먼저 마치게 한다(겹치면 한쪽이 다른 쪽을 끊는다)
    if (REC_ROAM_V2 && (chatRecording || ideaRecording)) { toast(tw('말로 입력을 마친 뒤 눌러\u00a0주십시오.'), 3000); return; }
    if (REC_ROAM_V2 && convoOn) { try { stopConvo(true); } catch (e) {} }
    hideBanner();
    // v9.8: 앱이 내고 있던 소리(답 듣기·미리 듣기)는 녹음을 시작하면서 멈춘다
    if (REC_ROAM_V2) {
      try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {}
      try { if (window.KChar && KChar.voice.speaking()) KChar.voice.stop(); } catch (e) {}
      try { kvPvStop(); } catch (e) {}
    }
    recCancelled = false; isRecording = true; recLost = false; recLive = false;
    // v9.10: 일지를 적는 녹음인지 · 이어 녹음이면 어느 묶음인지를 녹음기에 알려 둔다(녹음 방식에는 닿지 않는다)
    try { recGroup = recFindApi() ? (recGroupNext || '') : ''; recGroupNext = ''; recorder.find = !!recFindApi(); recorder.group = recGroup; recorder.dropNext = false; recorder.last = null; } catch (e) {}
    openScreen(recView); startRecTimer();
    recorder.start();
  });
  if (btnStop) btnStop.addEventListener('click', function () {
    if (!isRecording) return;
    isRecording = false; stopRecTimer(); recSessionClear();
    if (REC_ROAM_V2) updateRecIndicator();
    recorder.stop();   // → onAudio → onRecorded
  });
  function cancelRecNow() {
    if (!isRecording) { showHome(); return; }
    recCancelled = true; isRecording = false; recLost = false; stopRecTimer(); recSessionClear();
    try { recorder.dropNext = true; recGroup = ''; } catch (e) {}   // v9.10: 버린 녹음은 일지에 「버림」으로 — 끊긴 녹음 목록에 오르지 않게
    try { recorder.stop(); } catch (e) {}
    pendingBlob = null; pendingMaterials = []; showHome(); setStatus('대기 중', 'idle');
  }
  if (btnCancelRec) btnCancelRec.addEventListener('click', function () {
    // v9.8: 10초 넘게 녹음했으면 한 번 확인한다(예전에는 한 번 누르면 바로 버려졌다)
    var sec = isRecording ? (Date.now() - recStart) / 1000 : 0;
    if (REC_ROAM_V2 && isRecording && sec >= 10) {
      openSheet('녹음을 버릴까요?', '지금까지 녹음한 ' + fmtRecKo(sec) + '가 지워집니다. 되살릴 수 없습니다.', '버리기', cancelRecNow, null, null, { cancelLabel: '계속 녹음' });
      return;
    }
    cancelRecNow();
  });

  /* v8.4(O-0162) 다른 앱에서 공유받은 녹음 파일(통화 녹음·음성 녹음기 m4a·mp3·wav 등) → 회의록.
   *   앱 녹음이 끝났을 때와 같은 「녹음 완료」 화면(pendingBlob)에 올려 둔다 → 보내는 길(OfficeBridge.send / sendAudioChunked),
   *   PC 처리(collect.py·video_worker 전사·요약·회의자료 반영)는 앱 녹음과 완전히 같다. 화면 머리글·[다시 녹음] 글만 잠깐 바꾼다. */
  function recPanelMode(shared) {
    recPanelShared = !!shared;
    var ttl = recordedPanel ? recordedPanel.querySelector('.subbar .title') : null;
    if (ttl) ttl.textContent = shared ? '녹음 파일 정리' : '녹음 완료';
    if (btnRetake) btnRetake.innerHTML = shared ? '<svg><use href="#i-x"/></svg>취소' : '<svg><use href="#i-mic"/></svg>다시 녹음';
  }
  function titleFromAudioName(n) {
    var t = String(n || '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.slice(0, 40);
  }
  function audioToMeeting(f) {
    if (!f) return;
    if (isRecording) { toast('지금 녹음 중입니다. 녹음을 마친 뒤 다시 공유해 주세요.', 3500); return; }
    if (REC_ROAM_V2 && pendingBlob && !recPanelShared) { openScreen(recordedPanel); toast(tw('아직 보내지 않은 녹음이 있습니다.'), 3000); return; }
    hideBanner();
    pendingBlob = f; pendingMaterials = []; renderMatList();
    recCur = null;                                        // v9.10: 다른 앱에서 받은 파일 — 일지와 무관하다
    if (memoTitle) memoTitle.value = titleFromAudioName(f.name) || defaultTitle();
    var mb = (f.size || 0) / 1024 / 1024;
    if (recDoneBadge) recDoneBadge.textContent = '📎 공유받은 녹음 파일 · ' + (f.name || '녹음') + (mb ? ' · ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + 'MB' : '');
    recPanelMode(true);
    openScreen(recordedPanel);
    setStatus('녹음 파일 — 제목 정하고 보내기', 'idle');
    toast('제목을 확인하고, 필요하면 회의자료를 붙인 뒤 [PC로 보내 정리하기]를 누르세요.', 4000);
  }
  function onRecorded(blob) {
    var wasLost = recLost;
    stopRecTimer(); isRecording = false; recLost = false; recSessionClear();
    if (recCancelled) {
      recCancelled = false; pendingBlob = null; showHome();
      try { recFindScan(0, false, false); } catch (e) {}   // v9.10: 이어 녹음을 취소했으면 앞 녹음이 목록에 다시 나타나게(취소한 부분만 「버림」)
      return;
    }
    recPanelMode(false);                       // v8.4: 공유 파일 화면이었다면 원래 글로
    pendingBlob = blob;
    renderMatList();     // 준비 화면에서 붙인 회의자료를 그대로 이어받고, 완료 화면에서 더 붙일 수 있게(2026-09-21)
    if (memoTitle) memoTitle.value = defaultTitle();
    var durMs = (recorder && recorder.lastDurationMs) || 0;
    if (recDoneBadge) recDoneBadge.textContent = durMs > 0
      ? '✅ 녹음됐습니다 · ' + fmtRec(durMs / 1000) + ' (' + Math.round(durMs / 1000) + '초)'
      : '✅ 녹음됐습니다';
    // v9.8: 녹음기가 멈춘 것 같다는 표시가 떠 있던 녹음 — 담긴 길이를 사실대로 알린다
    if (REC_ROAM_V2 && wasLost && recDoneBadge) recDoneBadge.textContent = durMs > 0
      ? '⚠️ 녹음이 도중에 멈춘 것 같습니다 · 담긴 길이 ' + fmtRec(durMs / 1000) + ' — 보내기 전에 길이를 확인해 주십시오.'
      : '⚠️ 녹음이 도중에 멈춘 것 같습니다 — 담긴 길이를 확인하지 못했습니다.';
    try { recFindOnRecorded(durMs); } catch (e) {}        // v9.10: 일지 번호를 붙들고, 이어 녹음이었으면 빠진 구간을 딱지에 적는다
    openScreen(recordedPanel);
    setStatus('녹음 완료 — 제목 정하고 보내기', 'idle');
  }
  function discardRecorded() {
    pendingBlob = null; pendingMaterials = [];
    try { recFindDiscard(); } catch (e) {}                // v9.10: 일지에 「버림」(끊긴 녹음을 열었다 닫은 경우는 목록에 다시 올린다)
    showHome(); setStatus('대기 중', 'idle');
  }
  /* v9.8(O-0442) 「녹음 완료」 화면을 떠나려 할 때 — 아직 보내지 않은 내 녹음이면 한 번 묻는다.
   *   [임시저장](기존 기능 그대로 — 폰에 보관, 회의록 「진행 중」에서 다시 연다) · [버리기] · [계속 보기].
   *   다른 앱에서 공유받은 파일은 원본이 그 앱에 남아 있어 묻지 않는다. 돌려주는 값: true = 창을 띄웠다. */
  function guardRecorded() {
    if (!REC_ROAM_V2 || !pendingBlob || recPanelShared) return false;
    if (recCur && recCur.recovered && recFindApi()) return false;   // v9.10: 폰에 남아 있던 녹음을 연 것 — 닫아도 사라지지 않으므로 묻지 않는다
    openSheet('아직 보내지 않은 녹음입니다', '이대로 나가면 이 녹음은 사라집니다.', '버리기', discardRecorded, null,
      { label: '임시저장', action: function () { if (btnDraft) btnDraft.click(); } }, { cancelLabel: '계속 보기' });
    return true;
  }
  if (btnRetake) btnRetake.addEventListener('click', function () {
    if (guardRecorded()) return;
    discardRecorded();
  });

  if (btnSend) btnSend.addEventListener('click', function () {
    if (!pendingBlob) { showBanner('먼저 녹음해 주세요.'); return; }
    var t = now();
    var memo = {
      id: OfficeBridge.uuid(), token: OfficeBridge.token(),
      title: (memoTitle.value || '').trim() || defaultTitle(),
      ext: OfficeBridge.extFromBlob(pendingBlob), date: t.date, time: t.time,
      materials: (pendingMaterials && pendingMaterials.length) ? pendingMaterials.slice() : []
    };
    try { recFindAttach(memo); } catch (e) {}                            // v9.10: 일지 번호 · 진단 값(meta.rec) · 넘김 표시
    var blob = pendingBlob; pendingBlob = null; pendingMaterials = [];   // 자료는 memo 에 실었으니 초기화
    // 녹음이 길어 단일 업로드 한도(40MB)를 넘으면 → 조각 전송(백그라운드, 긴 영상과 동일 UX)
    if ((blob.size || 0) > OfficeBridge.CHUNK_SIZE) {
      sendChunkedAudioMemo(memo, blob);
      return;
    }
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending' });
    renderHistory();
    openScreen(processing); setProcessing('🖥️ PC로 보내는 중…', 'send');
    OfficeBridge.send(memo, blob).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' }); renderHistory();
      setProcessing('PC에서 정리 중 · 처음엔 1~2분 걸릴 수 있습니다', 'got');
      startPolling(memo.id, memo.token);
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: friendlyErr(e) });
      renderHistory(); showHome();
      showBanner('⚠️ 전송 실패 — ' + esc(friendlyErr(e)) + '<br>녹음은 안전하게 보관됐습니다 — <b>회의록</b> 맨 위 「진행 중」에서 다시 눌러 보세요.');
      setStatus('전송 실패', 'err');
    });
  });

  /* ---------- v3.8 임시 저장(draft): 지금 안 보내고 폰에 보관 → 나중에 자료 붙여 발송 ----------
   * 대표님 의도: 회의 중 녹음은 먼저, 회의자료(hwp 등)는 나중에 폰으로 옮겨 붙여 정리.
   * 안전 핵심: draft 오디오는 IndexedDB 'drafts' 스토어(=flush 대상 아님)에 담겨
   *   대표님이 [PC 보내기]를 누르기 전까지 절대 자동 발송되지 않는다. 앱을 껐다 켜도 유지. */
  if (btnDraft) btnDraft.addEventListener('click', function () {
    if (!pendingBlob) { showBanner('먼저 녹음해 주세요.'); return; }
    var t = now();
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var title = (memoTitle.value || '').trim() || defaultTitle();
    var rec = {
      id: id, title: title, token: tok, ext: OfficeBridge.extFromBlob(pendingBlob), blob: pendingBlob,
      materials: (pendingMaterials && pendingMaterials.length) ? pendingMaterials.slice() : [],
      date: t.date, time: t.time
    };
    var rc = (recCur && recFindApi()) ? recCur : null;    // v9.10: 일지 번호 · 진단 값을 임시저장에도 실어 둔다(나중에 보낼 때 meta.rec 로)
    if (rc) { rec.recSid = rc.gid; try { rec.recMeta = recMetaOf(rc); } catch (e) {} }
    OfficeBridge.saveDraft(rec).then(function (ok) {
      if (!ok) { showBanner('임시 저장에 실패했습니다(저장 공간을 확인해 주세요). 녹음은 아직 화면에 있습니다.'); return; }
      HistoryModule.add({ id: id, token: tok, title: title, date: t.date, time: t.time, status: 'draft', kind: 'audio' });
      if (rc) { recCur = null; try { recFindHanded(rc.gid, id, 'draft'); } catch (e) {} }   // 임시저장에 들어간 것을 확인한 뒤에 「넘김」
      pendingBlob = null; pendingMaterials = [];          // 저장 성공 후에만 비운다(실패 시 녹음 보존)
      renderHistory(); showHome(); setStatus('임시 저장됨', 'idle');
      toast('임시 저장했습니다. 회의록 「진행 중」에서 자료를 붙여 보낼 수 있습니다.');
    }).catch(function () { showBanner('임시 저장에 실패했습니다. 녹음은 아직 화면에 있습니다.'); });
  });
  /* 임시저장 제목 고치기: 녹음 직후 화면(memoTitle)에서만 되던 제목 수정을 임시저장을 다시 연 창에서도.
   *   - 제목의 기준은 지난 메모 목록(HistoryModule, 즉시 저장) — 창을 어떻게 닫든 고친 제목이 남는다.
   *   - IndexedDB draft 에도 같은 제목을 써 둔다. 자료 붙이기와 같은 레코드를 읽고-고쳐-쓰므로
   *     editDraft 한 줄로 차례대로 처리한다(동시에 쓰면 한쪽이 붙인 자료나 제목을 덮어쓴다).
   *   - draft 레코드에는 녹음(수십 MB)이 통째로 들어 있어 쓸 때마다 전체를 읽고 다시 쓴다. 그래서 글자를
   *     치는 동안에는 목록(가벼움)만 고치고, draft 쓰기는 입력을 마쳤을 때(change·blur)·자료 붙이기·
   *     [PC로 보내기]·창이 닫힐 때(closeModal 공통 지점 — ✕·바깥 터치·뒤로가기)에 한 번만 한다.
   *   - 비우면 기본 이름(녹음한 날짜·시각 기준 '메모 M월 D일 H시')으로 돌아간다. */
  var draftQ = Promise.resolve();
  function editDraft(id, fn) {
    draftQ = draftQ.then(function () {
      return OfficeBridge.getDraft(id).then(function (rec) {
        if (!rec) return null;
        fn(rec);
        return OfficeBridge.saveDraft(rec).then(function (ok) { return ok ? rec : false; });
      });
    }).catch(function () { return false; });
    return draftQ;
  }
  function draftDefaultTitle(e) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((e && e.date) || ''), h = /^(\d{1,2}):/.exec((e && e.time) || '');
    return (m && h) ? '메모 ' + (+m[2]) + '월 ' + (+m[3]) + '일 ' + (+h[1]) + '시' : defaultTitle();
  }
  var modalOnClose = null;          // 지금 열린 창이 닫힐 때 한 번 할 일(closeModal 이 부르고 비운다)
  function setDraftTitle(e, raw) {  // 가벼운 저장: 지난 메모 목록만. 바뀌었으면 true
    var title = (raw || '').trim() || draftDefaultTitle(e);
    if (title === e.title) return false;
    e.title = title;
    HistoryModule.update(e.id, { title: title });
    return true;
  }
  // 지난 메모의 임시저장 항목 → 제목 고치기 + 자료 붙이기 + 보내기 + 삭제
  function openDraftModal(e) {
    OfficeBridge.getDraft(e.id).then(function (rec) {
      var matN = (rec && rec.materials && rec.materials.length) || 0;
      if (!e.title) e.title = (rec && rec.title) || '';     // 제목 없는 옛 임시저장 — draft 쪽 제목이 있으면 그것부터
      modalTitle.textContent = (e.title || '메모') + '  ·  ' + (e.date || '');
      var html = '<div class="label" style="margin-top:0">제목 <span class="hint">(PC에 저장될 파일 이름이 됩니다)</span></div>' +
        '<div class="input filled" style="margin-bottom:14px"><svg class="lead"><use href="#i-note"/></svg>' +
        '<input id="mDraftTitle" type="text" maxlength="40" value="' + esc(e.title || '') + '" ' +
        'placeholder="' + esc(draftDefaultTitle(e)) + '" enterkeyhint="done"></div>' +
        '<div class="card rcard"><div class="h"><svg><use href="#i-mic"/></svg>임시 저장된 녹음</div>' +
        '<div style="padding:2px 2px 0;line-height:1.6">' +
        '이 녹음은 폰에 임시 저장돼 있습니다(<b>아직 PC로 보내지 않았습니다</b>).<br>' +
        '회의자료(선택)를 붙이고 <b>PC로 보내기</b>를 누르면 녹음+자료를 함께 정리해 드립니다.<br>' +
        '<b>붙인 자료:</b> <span id="mDraftMatN">' + matN + '</span>개' +
        // v7.9: 개수만 보이던 것 → 이름 목록 + 하나씩 빼기(✕). 자료가 많아도 창이 길어지지 않게 3줄 남짓만 보이고 목록만 따로 스크롤.
        '<div id="mDraftMatList" data-id="' + esc(e.id) + '" style="margin-top:8px;max-height:150px;overflow-y:auto"></div>' +
        '<span id="mDraftMatHint" style="' + (matN ? '' : 'display:none') + '"><small>' + MAT_LIMIT_HINT + '</small></span>' +
        (e.error ? '<br><span style="color:var(--rec,#c0392b)"><b>지난번 보내기 실패:</b> ' + esc(e.error) + '</span>' +
                   '<br>다시 <b>PC로 보내기</b>를 누르면 이어서 보냅니다(이미 올라간 부분은 건너뜀).' : '') +
        '</div></div>' +
        '<div class="btnrow">' +
        '<button id="mDraftAttach" class="btn ghost"><svg><use href="#i-plus"/></svg>회의자료 붙이기</button>' +
        '<button id="mDraftSend" class="btn primary"><svg><use href="#i-spark"/></svg>PC로 보내기</button>' +
        '</div>' +
        '<div class="btnrow"><button id="mDraftDel" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button></div>';
      modalBody.innerHTML = html;
      // 제목: 치는 동안엔 목록·창 머리글만(가벼움), 녹음이 든 draft 쓰기는 flushTitle 에서 한 번. 비우면 기본 이름.
      var ti = $('mDraftTitle'), listT = null, dirty = false;
      function typeTitle() {
        if (setDraftTitle(e, ti.value)) dirty = true;
        modalTitle.textContent = e.title + '  ·  ' + (e.date || '');
        if (listT) clearTimeout(listT);
        listT = setTimeout(function () { listT = null; renderHistory(); }, 300);   // 뒤 목록은 잠깐 모아서 다시 그림
      }
      function flushTitle() {           // 입력을 마친 시점에 draft 에 한 번만 쓴다(고친 게 없으면 쓰지 않음)
        if (setDraftTitle(e, ti.value)) dirty = true;
        if (!dirty) return;
        dirty = false;
        var title = e.title;
        editDraft(e.id, function (rec) { rec.title = title; });
      }
      ti.addEventListener('input', typeTitle);
      ti.addEventListener('change', function () { typeTitle(); flushTitle(); });
      ti.addEventListener('blur', flushTitle);
      modalOnClose = function () {      // ✕·바깥 터치·뒤로가기 — 입력칸에 포커스가 있는 채 닫혀도 남게
        flushTitle();
        if (listT) { clearTimeout(listT); listT = null; }
        renderHistory();
      };
      ti.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ti.blur(); } });
      ti.addEventListener('focus', function () {      // 키보드가 올라온 뒤에도 입력칸이 보이게
        setTimeout(function () { try { ti.scrollIntoView({ block: 'center' }); } catch (x) {} }, 300);
      });
      $('mDraftAttach').addEventListener('click', function () { flushTitle(); draftAttachId = e.id; if ($('draftMatInput')) $('draftMatInput').click(); });
      $('mDraftSend').addEventListener('click', function () {
        closeModal(); resumeSendDraft(e.id);          // closeModal 이 제목을 draft 에 쓰고(draftQ), 보내기는 그 뒤에 읽는다
      });
      $('mDraftDel').addEventListener('click', function () {
        // v7.9: 확인을 한 번 거친다(confirm() 금지 → 기존 시트). [취소]면 창·입력 중이던 제목은 그대로.
        openSheet('이 임시 저장을 삭제할까요?',
          '아직 PC로 보내지 않은 녹음입니다. 지우면 녹음과 붙인 자료를 되살릴 수 없습니다.',
          '삭제', function () {
            modalOnClose = null; dirty = false;           // 지우는 항목에 제목을 다시 쓰지 않는다
            draftQ = draftQ.then(function () { return OfficeBridge.delDraft(e.id); }).catch(function () {});   // 쓰는 중인 제목·자료가 끝난 뒤 지운다(지운 뒤 되살아나지 않게)
            HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('임시 저장을 삭제했습니다.');
          });
      });
      renderDraftMats(rec);
      modal.style.display = 'flex';
    });
  }
  /* v7.9 임시저장 창의 붙인 자료 목록 + 하나씩 빼기.
   *   - 자료의 서버 저장 이름은 `{id}/mat_{번호}` 다. 예전엔 번호가 "목록에서의 순서"였는데, 보내다 실패한 뒤
   *     앞의 자료를 빼면 뒤 자료가 앞 번호를 물려받아, 이미 올라가 있던 다른 파일을 제 것으로 알고 건너뛴다
   *     (이름은 B인데 내용은 A). 그래서 자료마다 한 번 받은 번호(matSlots)를 끝까지 쓰고, 뺀 번호는 다시 쓰지 않는다(matNext).
   *     번호가 없는 옛 임시저장은 지금 순서가 곧 번호(예전 규칙과 같다).
   *   - 빼기도 제목·자료 붙이기와 같은 줄(editDraft)로 처리한다. */
  function draftSlots(rec) {
    var m = rec.materials || (rec.materials = []);
    if (!rec.matSlots || rec.matSlots.length !== m.length) { rec.matSlots = m.map(function (f, i) { return i; }); rec.matNext = m.length; }
    if (!(rec.matNext >= 0)) rec.matNext = rec.matSlots.reduce(function (a, b) { return Math.max(a, b + 1); }, 0);
    return rec.matSlots;
  }
  function renderDraftMats(rec) {
    var box = $('mDraftMatList');
    if (!box || !rec || box.getAttribute('data-id') !== rec.id) return;   // 그새 다른 창이 열렸으면 그리지 않는다
    var mats = rec.materials || [];
    var span = $('mDraftMatN'); if (span) span.textContent = String(mats.length);
    var lh = $('mDraftMatHint'); if (lh) lh.style.display = mats.length ? '' : 'none';
    box.innerHTML = mats.length ? matListHtml(mats, true) : '';
    Array.prototype.forEach.call(box.querySelectorAll('.matdel'), function (b) {
      b.addEventListener('click', function () {
        var f = mats[+b.getAttribute('data-i')]; if (!f) return;
        var key = matKey(f), found = false;
        b.disabled = true;                                   // 두 번 눌러 두 개가 빠지지 않게
        editDraft(rec.id, function (r) {
          var slots = draftSlots(r);
          for (var i = 0; i < r.materials.length; i++) {
            if (matKey(r.materials[i]) === key) { r.materials.splice(i, 1); slots.splice(i, 1); found = true; break; }
          }
        }).then(function (r) {
          if (r === null) { toast('임시 저장을 찾지 못했습니다.'); return; }
          if (!r) { toast('자료를 빼지 못했습니다.'); b.disabled = false; return; }
          renderDraftMats(r);
          if (found) toast('자료를 뺐습니다.');
        });
      });
    });
  }
  // 임시저장 재개 시 자료 첨부 전용 입력(모달에서 [회의자료 붙이기])
  var draftAttachId = null;
  if ($('draftMatInput')) $('draftMatInput').addEventListener('change', function () {
    var fs = Array.prototype.slice.call(this.files || []); this.value = '';
    var id = draftAttachId; if (!id || !fs.length) return;
    var added = 0, dup = 0;
    editDraft(id, function (rec) {
      var add = newMaterials(rec.materials, fs);            // v7.8: 이미 붙인 자료는 다시 붙이지 않는다
      added = add.length; dup = add.dup;
      var slots = draftSlots(rec);
      add.forEach(function () { slots.push(rec.matNext++); });
      rec.materials = (rec.materials || []).concat(add);
    }).then(function (rec) {
      if (rec === null) { toast('임시 저장을 찾지 못했습니다.'); return; }
      if (!rec) { toast('자료 붙이기에 실패했습니다.'); return; }
      renderDraftMats(rec);
      if (!added) { toast('이미 붙인 자료입니다. 다시 붙이지 않았습니다.'); return; }
      toast('자료 ' + added + '개를 붙였습니다.' + (dup ? ' (이미 붙인 ' + dup + '개는 뺐습니다.)' : '') + ' [PC로 보내기]를 누르면 함께 정리됩니다.');
    });
  });
  /* v6.4(2026-09-29) 실패 이유를 쉬운 말로 — 예전엔 이유 없이 "전송 실패 — 다시 보내세요"만 떠서
   *   무엇이 문제인지(인터넷? 파일? 서버?) 알 수 없었다(O-0085 「기획혁신처회의」). */
  function friendlyErr(e) {
    if (!e) return '알 수 없는 이유로 보내지 못했습니다.';
    return String(e.friendly || e.message || e);
  }
  // 임시저장 발송 실패: 임시저장은 그대로 두고(유실 방지) 이유를 항목에 남기고 배너로 알린다.
  function draftSendFailed(id, err) {
    var why = friendlyErr(err);
    var tail = (err && err.reason === 'unreadable')
      ? ' 폰 저장 공간·앱 상태 문제일 수 있으니 이 항목은 지우지 마시고 저에게 알려 주세요.'
      : ' 회의록 → 진행 중 → 이 항목 → <b>PC로 보내기</b>를 다시 누르면 이어서 보냅니다(이미 올라간 부분은 건너뜀).';
    HistoryModule.update(id, { status: 'draft', error: why }); renderHistory(); showHome();
    showBanner('⚠️ 전송 실패 — ' + esc(why) + '<br>임시 저장한 녹음은 폰에 그대로 있습니다.' + tail);
    setStatus('전송 실패', 'err');
  }
  // 보내기는 됐지만 붙인 자료 중 못 붙인 것(너무 큼·읽기 실패 등)이 있으면 알려 준다(녹음은 정상 전송).
  function noticeSkippedMaterials(memo) {
    var sk = (memo && memo.materialsSkipped) || [];
    // v7.9: 긴 녹음을 다시 보냈는데 PC가 이미 정리를 시작한 뒤라 고친 제목·자료를 넣지 못한 경우(OfficeBridge resendEdit)
    var late = (memo && memo.resendEdit === 'too_late')
      ? '📎 녹음은 PC로 보냈습니다. 다만 PC가 이미 이 녹음의 정리를 시작한 뒤라, 다시 보내면서 <b>고친 제목이나 새로 붙인·뺀 자료</b>가 있었다면 그건 반영되지 않았습니다(처음 보낸 내용으로 정리됩니다).'
      : '';
    if (!sk.length) { if (late) showBanner(late); return; }
    showBanner((late ? late + '<br>' : '') + '📎 녹음은 PC로 보냈습니다. 다만 자료 ' + sk.length + '개는 함께 붙이지 못했습니다:<br>' +
      sk.map(function (x) { return '· ' + esc(x.msg || x.name); }).join('<br>') +
      '<br>(큰 한글·PPT 파일은 PDF로 저장해 크기를 줄이면 붙일 수 있습니다. 이 녹음은 자료 없이 정리됩니다.)');
  }
  // 임시저장 → 실제 발송(대표님이 [PC 보내기]를 눌렀을 때만 실행). 기존 send/sendAudioChunked 재사용.
  //  실패 시: draft 는 그대로 두고(유실 방지), send 가 pending 에 남긴 잔재는 dropPending 으로 제거해 자동발송을 막는다.
  function resumeSendDraft(id) {
    draftQ.then(function () { return OfficeBridge.getDraft(id); }).then(function (rec) {   // 쓰는 중인 제목·자료가 끝난 뒤 읽는다
      if (!rec || !rec.blob) { showBanner('임시 저장한 녹음을 찾지 못했습니다.'); renderHistory(); return; }
      var he = HistoryModule.get(id);                       // 고친 제목의 기준은 지난 메모 목록
      var title = (he && he.title) || rec.title || draftDefaultTitle(he || rec);
      var memo = { id: rec.id, token: rec.token, title: title, ext: rec.ext, date: rec.date, time: rec.time,
                   materials: rec.materials || [], matSlots: rec.matSlots };   // v7.9: 자료 저장 번호(없으면 순서대로)
      if (rec.recMeta) { memo.recSid = rec.recSid; memo.recMeta = rec.recMeta; }   // v9.10: 임시저장에 실어 둔 진단 값
      var blob = rec.blob;
      if ((blob.size || 0) > OfficeBridge.CHUNK_SIZE) {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' });
        videoProg[id] = '올릴 준비 중…'; renderHistory();
        OfficeBridge.sendAudioChunked(memo, blob, function (phase, done, total) { videoProg[id] = '올리는 중 ' + done + '/' + total + ' 조각'; renderHistory(); })
          .then(function () { OfficeBridge.delDraft(id); HistoryModule.update(id, { status: 'processing', error: null }); videoProg[id] = 'PC에서 정리 준비 중…'; renderHistory(); startVideoPolling(id, memo.token); noticeSkippedMaterials(memo); })
          .catch(function (err) { OfficeBridge.dropPending(id); delete videoProg[id]; draftSendFailed(id, err); });
        toast('긴 녹음은 조각으로 나눠 보냅니다. 홈 「진행 중인 메모」에서 상태를 볼 수 있습니다.'); showHome();
      } else {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' }); renderHistory();
        openScreen(processing); setProcessing('🖥️ PC로 보내는 중…', 'send');
        OfficeBridge.send(memo, blob).then(function () {
          OfficeBridge.delDraft(id);
          HistoryModule.update(id, { status: 'processing', error: null }); renderHistory();
          setProcessing('PC에서 정리 중 · 처음엔 1~2분 걸릴 수 있습니다', 'got');
          startPolling(id, memo.token);
          noticeSkippedMaterials(memo);
        }).catch(function (err) {
          OfficeBridge.dropPending(id);                 // send 가 pending 에 넣은 잔재 제거 → 자동발송 방지
          draftSendFailed(id, err);
        });
      }
    });
  }

  /* ---------- 결과 폴링 ---------- */
  // 안전 업로드(2026-09-22, v5.1): 서버에 이 메모 '행'이 없는(=전송이 서버까지 못 닿은) 채 이 시간을
  //   넘기면 자동으로 '실패'로 되돌려 [다시 보내기]/[삭제] 가 뜨게 한다. 근거: 정상 정리는 행이 즉시
  //   존재하고(느린 전사여도 행은 있음) poll 이 행을 돌려준다 → 오탐 없음. '행 자체가 없음'만 스턱으로 본다.
  var STUCK_MS = 10 * 60 * 1000;
  function autoFailStuck(id) {
    OfficeBridge.markResendable(id).then(function () {   // 보존 원본이 있으면 재전송 대상으로 되돌림(없으면 무해)
      var e = HistoryModule.get(id);
      if (e && e.status !== 'done') {
        HistoryModule.update(id, { status: 'failed',
          error: 'PC가 이 녹음을 받지 못했습니다(전송이 서버까지 도달하지 못함). 다시 보내거나 삭제해 주세요.' });
        renderHistory();
      }
    });
  }
  function startPolling(id, token) {
    stopPolling(); pollingId = id;
    var started = Date.now();
    var lastRowAt = Date.now();      // 마지막으로 서버에서 이 메모 '행'을 본 시각(무행 지속 감지)
    var bannerShown = false;
    pollTimer = setInterval(function () {
      OfficeBridge.poll(id, token).then(function (res) {
        if (!res) {                  // 행 없음 = 서버 미수신. STUCK_MS 넘게 지속되면 자동복구.
          if (Date.now() - lastRowAt > STUCK_MS) { stopPolling(); autoFailStuck(id); }
          return;
        }
        lastRowAt = Date.now();
        if (res.status === 'done') {
          stopPolling();
          HistoryModule.update(id, {
            status: 'done', kind: res.kind, transcript: res.transcript, summary_json: res.summary_json,
            content_md: res.content_md, pdf_url: res.pdf_url, docx_url: res.docx_url, pptx_url: res.pptx_url,
            title: res.title, error: res.error || null
          });
          OfficeBridge.dropPending(id);                    // 실제 정리 완료 확인 → 폰 원본 삭제(안전)
          renderHistory(); setStatus('정리 완료', 'idle');
          if (isOpen(processing)) showResult(id);            // 기다리는 중이면 결과로 이동
          else toast('✅ 정리 완료 — 「회의록」에서 볼 수 있습니다.');  // 홈 등에 있으면 방해 없이 알림만
          return;
        } else if (res.status === 'processing') {
          setProcessing('PC에서 정리 중…', 'got', procWhat(id));
        } else if (res.error) {
          setProcessing('처리 중 문제가 있었습니다. 잠시 후 다시 시도됩니다…', 'retry', procWhat(id));
        }
        // 포그라운드 대기화면 안내(1회) — 폴링은 멈추지 않는다(done/자동복구를 계속 감지해야 하므로).
        if (!bannerShown && isOpen(processing) && Date.now() - started > 5 * 60 * 1000) {
          bannerShown = true; showHome();
          showBanner('아직 정리 중입니다. PC가 켜져 있는지 확인하고, 잠시 후 <b>회의록</b>에서 다시 확인해 주세요.');
        }
        // 러너웨이 방지: 행이 있어도(정상·느린 정리) 이 시간을 넘기면 폴링을 조용히 멈춘다.
        //   (남은 done 은 다음 앱 실행/열람 시 복원 폴러가 잡는다. 무행 실패는 위 STUCK_MS 로 이미 처리됨.)
        if (Date.now() - started > 25 * 60 * 1000) stopPolling();
      }).catch(function () {});
    }, 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; pollingId = null; }

  /* ---------- 결과 표시 ---------- */
  function showResult(id) {
    var e = HistoryModule.get(id); if (!e) return;
    viewId = id;
    var tl = $('transcriptLabel');
    scanDelGuard(false);
    if (e.kind === 'photo' && isScanSj(e.summary_json)) {            // 스캔 허브: 영수증 확인 카드(스위치 off 면 이 줄을 건너뛴다 = v9.20 그대로)
      if (tl) tl.style.display = 'none'; transcriptView.style.display = 'none';
      resultArea.innerHTML = renderScanCard(e);
      wireScanCard(e);
      scanDelGuard(scanState(e) === 'registering');
      scanSyncOnOpen(e);
      docBtns.innerHTML = '';
      setExportMsg('', '');
      openScreen(resultWrap);
      return;
    }
    if (e.kind === 'photo' || e.kind === 'video') {
      var result = (e.summary_json && e.summary_json.result) || '(결과 없음)';
      var detail = e.content_md || '';
      resultArea.innerHTML =
        rtitle(e, e.kind === 'photo' ? '사진 분석' : '영상 분석') +
        rcard('i-note', '분석 결과', '<p>' + esc(result) + '</p>') +
        (detail ? rcard('i-list', '상세', '<p>' + esc(detail) + '</p>') : '');
      if (e.kind === 'video' && e.transcript) {
        if (tl) tl.style.display = 'block'; transcriptView.style.display = 'block';
        transcriptView.textContent = e.transcript;
      } else {
        if (tl) tl.style.display = 'none'; transcriptView.style.display = 'none';
      }
      docBtns.innerHTML = (e.pdf_url || e.docx_url || e.pptx_url) ? renderDocButtons(e) : '';
      if (docBtns.innerHTML) wireDocButtons(docBtns, e);
    } else {
      // 음성메모: 전사 원문은 PC(.md)에만 보관 — 앱은 정리본만 표시(2026-09-21)
      if (tl) tl.style.display = 'none';
      transcriptView.style.display = 'none'; transcriptView.textContent = '';
      var sj = e.summary_json || {};
      var html = rtitle(e, '정리 결과');
      if (sj.integrated && sj.minutes)   // 회의자료를 함께 낸 경우: 통합 회의록 카드
        html += rcard('i-note', '통합 회의록', '<div class="minutes" style="white-space:pre-wrap">' + esc(sj.minutes) + '</div>');
      html += renderCards(sj);
      resultArea.innerHTML = html;
      docBtns.innerHTML = renderDocButtons(e);
      wireDocButtons(docBtns, e);
    }
    setExportMsg('', '');
    openScreen(resultWrap);
  }

  /* ===================== 스캔 허브: 영수증 확인 카드 =====================
   * PC 가 남긴 summary_json.scan(v1)을 카드로 보여 주고, [등록]을 누르면 채팅에 한 줄 「#스캔 <행id 앞 8자리> 등록 <JSON>」을 보낸다.
   * 앱은 등록을 직접 하지 않는다(PC 가 검증해 한 번만 등록). 돈 값은 이 카드에서 고친 칸만 JSON 에 담는다(허용 키 7개).
   * 상태: read → (confirmed) → registering → registered / failed / unknown / skipped / duplicate. 앱은 poll 로 바뀐 상태를 보여 준다. */
  var SCAN_OPEX = { from: '2026-08-01', to: '2027-02-28' };       // 운영비 앱 예산 기간(밖이면 경고 · 등록 잠금)
  var SCAN_RSCH = { from: '2026-05-01', to: '2027-02-28' };       // 연구비 과제 기간(밖이면 경고만)
  var SCAN_RCAT = ['연구재료비', '연구활동비', '연구수당'];
  var SCAN_RSUB = ['회의비', '국외 출장 여비', '수용비 및 수수료', '기술정보활동비(전문가활용비)', '조사연구비', '연구홍보비', '국내 출장 여비 및 시내교통비', '연구환경유지비', '야근(특근) 식대'];
  var SCAN_TERMINAL = { registered: 1, failed: 1, unknown: 1, skipped: 1, duplicate: 1 };
  var scanDraft = {}, scanUi = {}, scanPollers = {}, scanNextDisp = null;
  function isScanSj(sj) { return SCAN_HUB === 'on' && !!sj && typeof sj === 'object' && !!sj.scan && typeof sj.scan === 'object' && sj.scan.type === 'receipt'; }
  function scanWon(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function scanDateOk(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var d = new Date(s + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function scanAmt(v) { var s = String(v == null ? '' : v).replace(/[,\s원]/g, ''); return /^\d{1,9}$/.test(s) && +s > 0 ? +s : 0; }
  function scanDraftFor(e) {
    var id = e.id, d = scanDraft[id];
    if (d) return d;
    var sc = e.summary_json.scan, sg = sc.suggest || {}, tc = Array.isArray(sc.target_candidates) ? sc.target_candidates : [];
    var app = '';
    for (var i = 0; i < tc.length; i++) { if (tc[i] && (tc[i].app === 'opex' || tc[i].app === 'research')) { app = tc[i].app; break; } }
    var merchant = sc.merchant ? String(sc.merchant) : '';
    d = scanDraft[id] = {
      app: app, date: sc.date || '', amount: (sc.amount != null && sc.amount !== '') ? String(sc.amount) : '', merchant: merchant,
      desc: String(sg.description || merchant || ''),
      ocat: String(sg.category || '식비'),
      rcat: SCAN_RCAT.indexOf(sg.category) !== -1 ? sg.category : '연구활동비',
      rsub: SCAN_RSUB.indexOf(sg.sub_item) !== -1 ? sg.sub_item : SCAN_RSUB[0]
    };
    return d;
  }
  // 이 카드로 등록할 수 있는지 · 막힌 까닭(없으면 '')
  function scanLockWhy(sc, d) {
    if (!d.app) return '어느 앱에 넣을지 골라 주십시오';
    if (!scanDateOk(d.date)) return '날짜를 입력해 주십시오';
    if (!scanAmt(d.amount)) return '금액을 입력해 주십시오';
    if (!String(d.merchant || '').trim()) return '사용처를 입력해 주십시오';
    if (!String(d.desc || '').trim()) return '설명을 입력해 주십시오';
    if (d.app === 'opex') {
      if (!String(d.ocat || '').trim()) return '항목을 입력해 주십시오';
      if (d.date < SCAN_OPEX.from || d.date > SCAN_OPEX.to) return '운영비 예산 기간(' + SCAN_OPEX.from + ' ~ ' + SCAN_OPEX.to + ') 밖의 날짜입니다';
    } else {
      if (SCAN_RCAT.indexOf(d.rcat) === -1) return '항목을 골라 주십시오';
      if (d.rcat === '연구활동비' && SCAN_RSUB.indexOf(d.rsub) === -1) return '세부 항목을 골라 주십시오';
    }
    if (sc.dup_of) return '이미 처리한 영수증과 같습니다';
    return '';
  }
  function scanSummaryLine(d) {
    var a = scanAmt(d.amount), w = a ? scanWon(a) + '원' : '금액';
    if (d.app === 'opex') return '운영비 앱에 ' + w + '을 넣습니다';
    if (d.app === 'research') return '연구비 앱 · ' + d.rcat + (d.rcat === '연구활동비' ? ' > ' + d.rsub : '') + '에 ' + w + '을 넣습니다';
    return '넣을 앱을 골라 주십시오';
  }
  // 채팅 한 줄(허용 키만 · 값은 형식 검사를 거친 것만). sub_item 은 연구비 · 연구활동비일 때만.
  function scanBuildPayload(d) {
    var o = { app: d.app };
    if (d.app === 'opex') o.category = String(d.ocat).trim();
    else { o.category = d.rcat; if (d.rcat === '연구활동비') o.sub_item = d.rsub; }
    o.description = String(d.desc).replace(/\s+/g, ' ').trim().slice(0, 100);
    o.date = d.date; o.amount = scanAmt(d.amount);
    o.merchant = String(d.merchant).replace(/\s+/g, ' ').trim().slice(0, 60);
    return o;
  }
  function scanChatLine(id, payload) { return '#스캔 ' + String(id).replace(/-/g, '').slice(0, 8) + ' 등록 ' + JSON.stringify(payload); }
  function scanCopyText(sc, d) {
    var a = scanAmt(d.amount) || sc.amount, dt = scanDateOk(d.date) ? d.date : (sc.date || '');
    return ['날짜 ' + dt, '금액 ' + (a ? scanWon(a) + '원' : ''), '사용처 ' + (d.merchant || sc.merchant || ''),
      '앱 ' + (d.app === 'research' ? '연구비' : d.app === 'opex' ? '운영비' : ''),
      '항목 ' + (d.app === 'research' ? d.rcat + (d.rcat === '연구활동비' ? ' > ' + d.rsub : '') : d.ocat), '설명 ' + (d.desc || '')].join('\n');
  }
  // 썸네일: PC 가 summary_json.scan.thumb_b64(JPEG 긴 변 240px · 품질 60 의 base64 글)로 준 것만 그린다. 없으면 한 줄 안내.
  function scanThumbHtml(e, sc) {
    var b = sc.thumb_b64;
    if (typeof b === 'string' && b.length > 20 && b.length < 400000 && /^[A-Za-z0-9+\/]+={0,2}$/.test(b))
      return '<div class="scan-thumb"><img src="data:image/jpeg;base64,' + b + '" alt="영수증 사진"></div>';
    return '<div class="scan-thumb"><span class="scan-nothumb">사진은 PC에<br>보관되어<br>있습니다</span></div>';
  }
  function scanChips(items, cur, attr) {
    return items.map(function (it) {
      return '<button type="button" class="chip hchip scan-chip' + (cur === it.v ? ' on' : '') + '" ' + attr + '="' + esc(it.v) + '" aria-pressed="' + (cur === it.v) + '">' + esc(it.t) + '</button>';
    }).join('');
  }
  function scanState(e) {
    var sc = e.summary_json.scan, st = String(sc.state || 'read');
    if (e.scan_skip) return 'skipped';
    if (st === 'read' && scanWaiting(e)) return 'registering';
    if (st === 'confirmed') return 'registering';
    return st;
  }
  function scanFld(key, label, val, extra, bad) {
    return '<label class="scan-f' + (bad ? ' empty' : '') + '" data-f="' + key + '"><span>' + label + '</span><input data-sf="' + key + '" ' + extra + ' value="' + esc(val) + '"></label>';
  }
  function renderScanCard(e) {
    var sc = e.summary_json.scan, st = scanState(e), d = scanDraftFor(e), calm = replyCalm();
    var amt = scanAmt(d.amount) || scanAmt(sc.amount);
    var head = rtitle(e, '영수증');
    var thumb = scanThumbHtml(e, sc);
    var cls = 'card rcard scan-card' + (calm ? '' : ' scan-in');
    var body = '', foot = '';
    var cardLine = (sc.card_last4 && /^\d{4}$/.test(String(sc.card_last4))) ? '<span class="chip scan-cardchip">카드 ···· ' + esc(sc.card_last4) + '</span>' : '';
    if (st === 'registered') {
      var where = d.app === 'research' ? '연구비 앱' : '운영비 앱';
      body = '<div class="scan-done"><svg><use href="#i-check"/></svg><b>' + where + '에 ' + (amt ? scanWon(amt) + '원을' : '내용을') + ' 넣었습니다</b></div>' +
        '<div class="scan-sub">' + esc(sc.date || d.date || '') + ' · ' + esc(sc.merchant || d.merchant || '') + '</div>';
    } else if (st === 'registering') {
      body = '<div class="scan-wait"><span class="scan-spin" aria-hidden="true"></span><b>등록 중입니다…</b></div><div class="scan-sub">잠시 기다려 주십시오. 결과가 바뀌면 이 화면에 나옵니다. 한 번만 넣으므로 다시 누르지 않으셔도 됩니다.</div>';
    } else if (st === 'failed' && sc.amount == null && sc.date == null) {
      body = '<div class="scan-bad"><b>읽지 못했습니다 · 다시 찍기</b></div><div class="scan-sub">사진이 흐리거나 영수증이 아닐 수 있습니다. 밝은 곳에서 평평하게 놓고 다시 찍어 주십시오.</div>';
      foot = '<div class="scan-btns"><button type="button" class="btn primary" data-scan-retake>다시 찍기</button></div>';
    } else if (st === 'failed') {
      body = '<div class="scan-bad"><b>넣지 못했습니다</b></div><div class="scan-sub">입력 내용을 복사해 앱에 직접 넣어 주십시오.</div>';
      foot = '<div class="scan-btns"><button type="button" class="btn primary" data-scan-copy>입력 내용 복사</button></div>';
    } else if (st === 'unknown') {
      body = '<div class="scan-bad warn"><b>확인이 필요합니다</b></div><div class="scan-sub">등록이 되었는지 알 수 없습니다. 같은 내용을 또 넣지 않도록, 해당 앱에서 직접 확인해 주십시오.</div>';
    } else if (st === 'duplicate') {
      body = '<div class="scan-bad warn"><b>이미 같은 내역이 있습니다</b></div><div class="scan-sub">같은 날짜·금액이 앱에 있어 등록하지 않았습니다.</div>';
    } else if (st === 'skipped') {
      body = '<div class="scan-sub"><b>등록하지 않았습니다.</b></div>';
    } else {                                                          // read: 고쳐서 등록할 수 있는 카드
      var why = scanLockWhy(sc, d), conf = sc.conf || {};
      var warns = (Array.isArray(sc.warnings) ? sc.warnings : []).map(function (w) { return '<div class="scan-warn">⚠ ' + esc(w) + '</div>'; }).join('');
      if (sc.dup_of) warns = '<div class="scan-warn">⚠ 이미 처리한 영수증과 같습니다</div>' + warns;
      if (sc.last_error) warns = '<div class="scan-warn scan-reject">⚠ ' + esc(scanRejectWhy(sc.last_error)) + '</div>' + warns;
      var fields =
        scanFld('date', '날짜', d.date, 'type="date"', !scanDateOk(d.date) || conf.date === 'low') +
        scanFld('amount', '금액(원)', d.amount, 'type="text" inputmode="numeric" autocomplete="off"', !scanAmt(d.amount) || conf.amount === 'low') +
        scanFld('merchant', '사용처', d.merchant, 'type="text" maxlength="60"', !String(d.merchant).trim() || conf.merchant === 'low');
      var appChips = '<div class="scan-row"><span class="scan-lab">어느 앱에</span><div class="scan-chips" data-chips="app">' +
        scanChips([{ v: 'opex', t: '운영비' }, { v: 'research', t: '연구비' }], d.app, 'data-scan-app') + '</div></div>';
      var item = '';
      if (d.app === 'opex') {
        item = scanFld('ocat', '항목', d.ocat, 'type="text" maxlength="30"', !String(d.ocat).trim());
      } else if (d.app === 'research') {
        item = '<div class="scan-row"><span class="scan-lab">분류</span><div class="scan-chips" data-chips="rcat">' +
          scanChips(SCAN_RCAT.map(function (c) { return { v: c, t: c }; }), d.rcat, 'data-scan-rcat') + '</div></div>';
        if (d.rcat === '연구활동비') item += '<div class="scan-row"><span class="scan-lab">세부 항목</span><div class="scan-chips" data-chips="rsub">' +
          scanChips(SCAN_RSUB.map(function (c) { return { v: c, t: c }; }), d.rsub, 'data-scan-rsub') + '</div></div>';
        if (scanDateOk(d.date) && (d.date < SCAN_RSCH.from || d.date > SCAN_RSCH.to)) warns += '<div class="scan-warn">⚠ 과제 기간(' + SCAN_RSCH.from + ' ~ ' + SCAN_RSCH.to + ') 밖의 날짜입니다</div>';
      }
      var desc = scanFld('desc', '설명', d.desc, 'type="text" maxlength="100"', !String(d.desc).trim());
      body = '<div class="scan-top">' + thumb + '<div class="scan-fields">' + cardLine + fields + '</div></div>' +
        '<div class="scan-form">' + appChips + item + desc + '</div>' + warns +
        '<div class="scan-sumline" id="scanSum">' + esc(scanSummaryLine(d)) + '</div>' +
        '<div class="scan-lockwhy" id="scanWhy"' + (why ? '' : ' style="display:none"') + '>' + esc(why) + '</div>';
      foot = '<div class="scan-btns"><button type="button" class="btn ghost" data-scan-skip>등록 안 함</button>' +
        '<button type="button" class="btn primary" id="scanGo" data-scan-go' + (why ? ' disabled' : '') + '><svg><use href="#i-check"/></svg>등록</button></div>';
      return head + '<div class="' + cls + '" data-scan-id="' + esc(e.id) + '">' + body + foot + '</div>';
    }
    return head + '<div class="' + cls + '" data-scan-id="' + esc(e.id) + '"><div class="scan-top">' + thumb + '<div class="scan-fields">' + cardLine + '</div></div>' + body + foot + '</div>';
  }
  function scanRefresh(e) {                       // 입력 중에는 칸을 다시 그리지 않고 요약·잠금만 갱신(커서 유지)
    var sc = e.summary_json.scan, d = scanDraftFor(e), why = scanLockWhy(sc, d);
    var s = $('scanSum'); if (s) s.textContent = scanSummaryLine(d);
    var w = $('scanWhy'); if (w) { w.textContent = why; w.style.display = why ? '' : 'none'; }
    var b = $('scanGo'); if (b) b.disabled = !!why;
    Array.prototype.forEach.call(resultArea.querySelectorAll('.scan-f'), function (el) {
      var k = el.getAttribute('data-f'), bad = false;
      if (k === 'date') bad = !scanDateOk(d.date); else if (k === 'amount') bad = !scanAmt(d.amount);
      else if (k === 'merchant') bad = !String(d.merchant).trim(); else if (k === 'desc') bad = !String(d.desc).trim(); else if (k === 'ocat') bad = !String(d.ocat).trim();
      el.classList.toggle('empty', bad);
    });
  }
  function scanRedraw(id) {
    if (viewId !== id || !isOpen(resultWrap)) return;
    var n = HistoryModule.get(id); if (!n || !isScanSj(n.summary_json)) return;
    resultArea.innerHTML = renderScanCard(n); wireScanCard(n);
    scanDelGuard(scanState(n) === 'registering');
  }
  // 등록 중에는 아래쪽 「이 메모 삭제」를 숨긴다 — [등록]을 두 번 누르면 카드가 짧아지며 그 자리로 올라온 삭제 단추를 눌러 버리는 것을 막는다
  function scanDelGuard(on) { var b = $('btnDelete'); if (b && b.parentNode) b.parentNode.style.display = on ? 'none' : ''; }
  function wireScanCard(e) {
    var root = resultArea.querySelector('[data-scan-id]'); if (!root) return;
    var sc = e.summary_json.scan, d = scanDraftFor(e), st = scanState(e);
    if (st === 'registering') startScanPoll(e.id);
    Array.prototype.forEach.call(root.querySelectorAll('input[data-sf]'), function (inp) {
      inp.addEventListener('input', function () { d[inp.getAttribute('data-sf')] = inp.value; scanRefresh(e); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-scan-app]'), function (b) {
      b.addEventListener('click', function () { d.app = b.getAttribute('data-scan-app'); scanRedraw(e.id); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-scan-rcat]'), function (b) {
      b.addEventListener('click', function () { d.rcat = b.getAttribute('data-scan-rcat'); scanRedraw(e.id); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-scan-rsub]'), function (b) {
      b.addEventListener('click', function () { d.rsub = b.getAttribute('data-scan-rsub'); scanRedraw(e.id); });
    });
    var skip = root.querySelector('[data-scan-skip]');
    if (skip) skip.addEventListener('click', function () { scanSkip(e); });
    var cp = root.querySelector('[data-scan-copy]');
    if (cp) cp.addEventListener('click', function () { copyToClipboard(scanCopyText(sc, d)); });
    var rt = root.querySelector('[data-scan-retake]');
    if (rt) rt.addEventListener('click', function () { photoAsScan = true; filePanelFromChat = false; $('photoInput').click(); });
    var go = root.querySelector('[data-scan-go]');
    if (go) go.addEventListener('click', function () {
      if (scanLockWhy(sc, d) || scanUi[e.id]) return;                      // 잠금 · 중복 누름
      var a = scanAmt(d.amount);
      if (d.app === 'research') {
        openSheet('연구비 앱에 넣을까요?', d.rcat + (d.rcat === '연구활동비' ? '·' + d.rsub : '') + '에 ' + scanWon(a) + '원을 넣습니다. 앱에서 지울 수 없습니다.',
          '넣기', function () { scanRegister(e, d); }, null, null, { positive: true, cancelLabel: '취소' });
      } else scanRegister(e, d);
    });
  }
  function scanSkipLine(id) { return '#스캔 ' + String(id).replace(/-/g, '').slice(0, 8) + ' 안함'; }
  // [등록 안 함]: PC 에 「#스캔 <id8> 안함」 한 줄을 보낸 뒤 카드를 「등록하지 않았습니다」로 닫는다. 못 보냈으면 카드를 그대로 두고 다시 누르게 한다.
  function scanSkip(e) {
    if (scanUi[e.id]) return;
    if (!getSyncPass()) { showSyncGate(true, '영수증 등록을 취소하려면 PC 연동 암호를 입력해 주십시오.'); return; }
    scanUi[e.id] = 'sending';
    unlockKaiAudio();
    scanNextDisp = '🧾 영수증 등록 안 함';
    sendPlainChat(scanSkipLine(e.id), false).then(function (ok) {
      delete scanUi[e.id];
      if (ok) { HistoryModule.update(e.id, { scan_skip: true, scan_sent: null }); toast('등록하지 않았습니다.'); }
      else toast('보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주십시오.');
      scanRedraw(e.id);
    });
  }
  function scanRegister(e, d) {
    var sc = e.summary_json.scan;
    if (scanLockWhy(sc, d) || scanUi[e.id]) return;
    if (!getSyncPass()) { showSyncGate(true, '영수증을 등록하려면 PC 연동 암호를 입력해 주십시오.'); return; }
    var payload = scanBuildPayload(d), line = scanChatLine(e.id, payload);
    scanUi[e.id] = 'sending';                                         // 누르는 즉시 잠금(두 번 눌러도 한 번만 보냄)
    var base = String(sc.last_error || '');
    var cur = HistoryModule.get(e.id);                                // 옛 거절 사유는 화면에서 지운다(이번 요청의 결과와 섞이지 않게)
    if (cur && cur.summary_json && cur.summary_json.scan && cur.summary_json.scan.last_error) { delete cur.summary_json.scan.last_error; HistoryModule.update(e.id, { summary_json: cur.summary_json }); }
    scanRedraw(e.id);
    unlockKaiAudio();
    scanNextDisp = '🧾 영수증 등록 요청 · ' + scanWon(payload.amount) + '원 · ' + (payload.app === 'research' ? '연구비' : '운영비');
    sendPlainChat(line, false).then(function (ok) {
      if (ok) { scanUi[e.id] = 'registering'; HistoryModule.update(e.id, { scan_sent: { at: Date.now(), base: base } }); scanRedraw(e.id); startScanPoll(e.id); }
      else { delete scanUi[e.id]; toast('보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주십시오.'); scanRedraw(e.id); }
    });
  }
  // PC 가 거절(_reject)하면 state 는 read 그대로이고 scan.last_error 에 사유 글만 남는다. 사유는 PC 글을 그대로 쓰지 않고 아래 쉬운 말로 바꿔 보인다.
  function scanRejectWhy(msg) {
    var s = String(msg || '');
    var map = [
      ['허용되지 않은 항목', '보낸 내용에 처리할 수 없는 항목이 있었습니다. 다시 눌러 주십시오.'],
      ['가리키는 앱과 다릅니다', '카드가 가리키는 앱과 다른 앱을 고르셨습니다. 어느 앱인지 다시 확인해 주십시오.'],
      ['대상 앱이 올바르지', '넣을 앱을 다시 골라 주십시오.'],
      ['날짜가 없거나', '날짜를 확인해 주십시오.'],
      ['금액이 없거나', '금액을 확인해 주십시오.'],
      ['예산 기간', '날짜가 예산 기간 밖입니다. 날짜를 확인해 주십시오.'],
      ['쓸 수 없는 글자', '사용처나 설명에 쓸 수 없는 글자가 있습니다. 한글·영문·숫자만 남겨 주십시오.'],
      ['운영비 항목 글자', '항목은 한글 10자 이내로 적어 주십시오.'],
      ['세부항목', '세부 항목을 다시 골라 주십시오.'],
      ['연구비 대분류', '연구비 분류를 다시 골라 주십시오.'],
      ['사용처·설명이 필요', '사용처와 설명을 입력해 주십시오.'],
      ['이미 처리한 영수증과 같', '이미 처리한 영수증과 같아 등록하지 않았습니다.'],
      ['이미 처리 중', '이미 처리 중이거나 끝난 영수증입니다.']
    ];
    for (var i = 0; i < map.length; i++) if (s.indexOf(map[i][0]) !== -1) return map[i][1];
    return '등록하지 못했습니다. 내용을 확인하고 다시 눌러 주십시오.';
  }
  // PC 에서 받은 최신 summary_json 을 반영한다. 반환: 'reject' | 'final' | 'changed' | ''
  function scanApply(id, sj) {
    var en = HistoryModule.get(id);
    if (!en || !sj || !sj.scan || typeof sj.scan !== 'object') return '';
    var st = String(sj.scan.state || 'read'), le = sj.scan.last_error ? String(sj.scan.last_error) : '';
    var before = en.summary_json && en.summary_json.scan || {};
    var waiting = scanWaiting(en);
    var res = '';
    if (st === 'read' && waiting && le && scanErrIsNew(en, le)) {       // 거절: 「등록 중」 잠금을 풀고 사유를 보인다
      delete scanUi[id]; HistoryModule.update(id, { summary_json: sj, scan_sent: null });
      toast(scanRejectWhy(le)); res = 'reject';
    } else if (st !== 'read' && st !== 'confirmed' && st !== 'registering') {
      delete scanUi[id]; HistoryModule.update(id, { summary_json: sj, scan_sent: null }); res = 'final';
    } else if (st === 'read' && !waiting) {
      if (JSON.stringify(sj.scan) !== JSON.stringify(before)) { HistoryModule.update(id, { summary_json: sj }); res = 'changed'; }
    } else if (JSON.stringify(sj.scan) !== JSON.stringify(before)) { HistoryModule.update(id, { summary_json: sj }); res = 'changed'; }
    return res;
  }
  // 「등록 요청을 보냈음」 표시: 이력(HistoryModule)의 scan_sent = { at, base } — 앱을 닫았다 열어도 남는다. base = 보낼 때 PC 가 남겨 둔 옛 사유(새 거절과 구별).
  var SCAN_WAIT_MS = 15 * 60 * 1000;
  function scanSentActive(en) { return !!(en && en.scan_sent && en.scan_sent.at && Date.now() - en.scan_sent.at < SCAN_WAIT_MS); }
  function scanWaiting(en) { return !!scanUi[en.id] || scanSentActive(en); }
  function scanErrIsNew(en, le) {
    var s = en.scan_sent;
    if (!s) return true;
    return le !== (s.base || '') || Date.now() - s.at > 30000;       // 같은 사유가 30초 넘게 그대로면 PC 가 다시 거절한 것으로 본다
  }
  // 확인 카드를 열 때 서버의 최신 상태를 한 번 읽는다(앱을 닫은 사이 PC 가 처리했을 수 있다). 실패해도 화면은 그대로 둔다.
  function scanSyncOnOpen(e) {
    var id = e.id;
    OfficeBridge.poll(id, e.token).then(function (res) {
      var r = scanApply(id, res && res.summary_json);
      if (r === 'final' || r === 'reject') { if (scanPollers[id]) { clearInterval(scanPollers[id]); delete scanPollers[id]; } }
      if (r) scanRedraw(id);
      var n = HistoryModule.get(id);
      if (n && isScanSj(n.summary_json) && scanState(n) === 'registering') startScanPoll(id);
    }).catch(function () {});
  }
  function startScanPoll(id) {
    if (scanPollers[id]) return;
    var started = Date.now();
    scanPollers[id] = setInterval(function () {
      var en = HistoryModule.get(id);
      if (!en || Date.now() - started > 15 * 60 * 1000) { clearInterval(scanPollers[id]); delete scanPollers[id]; return; }
      OfficeBridge.poll(id, en.token).then(function (res) {
        var r = scanApply(id, res && res.summary_json);
        if (!r) return;
        if (r === 'final' || r === 'reject') { clearInterval(scanPollers[id]); delete scanPollers[id]; }
        if (r === 'final') {
          var st = HistoryModule.get(id).summary_json.scan.state;
          toast(st === 'registered' ? '✅ 영수증을 앱에 넣었습니다.' : st === 'failed' ? '영수증을 넣지 못했습니다.' : st === 'duplicate' ? '이미 같은 내역이 있습니다.' : st === 'skipped' ? '등록하지 않았습니다.' : '영수증 등록 확인이 필요합니다.');
        }
        scanRedraw(id);
      }).catch(function () {});
    }, 4000);
  }

  function rtitle(e, fallback) {
    return '<div class="rtitle"><h2>' + esc(e.title || fallback) + '</h2><div class="rmeta">' +
      (e.date ? '<span class="chip">' + esc(e.date) + '</span>' : '') +
      '<span class="chip on">완료</span></div></div>';
  }
  function rcard(icon, title, inner) {
    return '<div class="card rcard"><div class="h"><svg><use href="#' + icon + '"/></svg>' + esc(title) + '</div>' + inner + '</div>';
  }
  function checkList(arr, empty, dec) {
    if (!arr || !arr.length) return '<p class="empty">' + empty + '</p>';
    return '<div class="check' + (dec ? ' dec' : '') + '">' + arr.map(function (s) {
      return '<div><i>' + (dec ? '<svg><use href="#i-check"/></svg>' : '') + '</i>' + esc(s) + '</div>';
    }).join('') + '</div>';
  }
  // v5.7(준비안 · 2026-09-25 · 빌드·배포 전): 요약 v3(summary_json.brief)면 '한눈 요약' 화면.
  //   맨 위 한 줄 결론을 크게 → 핵심(번호) → (교수 피드백) → 결정 → 할 일(담당·기한 칩) → 미결·다음 → 상세(접힘).
  //   brief 가 없는 옛 요약본은 아래 기존 renderCards 그대로(하위호환). '자주 나온 단어' 카드는 brief 화면에선 숨김.
  function hiNum(s) {   // 숫자·날짜·수량을 굵게(esc 뒤 적용 — esc 는 숫자 엔티티를 만들지 않음)
    return esc(s).replace(/(\d{1,4}(?:[.\/~:\-]\d{1,4})*(?:\s?(?:명|억원|억|만원|원|%|점|학점|개월|월|일|주차|주|시|분|년|개|차|회|쪽|건|팀))?(?:\([월화수목금토일]\))?)/g,
      '<b style="color:var(--text)">$1</b>');
  }
  function briefList(arr, numbered) {
    return '<div class="check">' + arr.map(function (s, i) {
      return '<div><i style="border:none;font-weight:800;color:var(--cyan)">' + (numbered ? (i + 1) : '·') + '</i><span>' + hiNum(s) + '</span></div>';
    }).join('') + '</div>';
  }
  function briefTodo(arr) {
    return '<div class="check">' + arr.map(function (t) {
      var chips = (t.owner ? '<span class="chip" style="height:26px;font-size:13px;margin:4px 6px 0 0">담당 <b>' + esc(t.owner) + '</b></span>' : '') +
                  (t.due ? '<span class="chip" style="height:26px;font-size:13px;margin:4px 6px 0 0">기한 <b>' + esc(t.due) + '</b></span>' : '');
      return '<div><i></i><span>' + hiNum(t.task) + (chips ? '<br>' + chips : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function briefCard(cls, icon, title, inner) {
    return '<div class="card rcard' + (cls ? ' ' + cls : '') + '"><div class="h"><svg><use href="#' + icon + '"/></svg>' + esc(title) + '</div>' + inner + '</div>';
  }
  function renderBrief(sj) {
    var b = sj.brief, tut = b.mode === 'tutoring', html = '';
    // ① 한 줄 결론 + 핵심 — 이 카드만 봐도 파악이 끝나게
    html += '<div class="card rcard" style="border-left:4px solid var(--cyan)">' +
      '<div class="h"><svg><use href="#i-note"/></svg>' + (tut ? '이번 튜터링 한 줄' : '한 줄 결론') + '</div>' +
      '<p style="font-size:19px;font-weight:800;line-height:1.45;margin:0 0 12px">' + hiNum(b.headline || '') + '</p>' +
      ((b.key_points && b.key_points.length) ? '<div class="h" style="margin-top:4px">' + (tut ? '진행 상황' : '핵심') + '</div>' + briefList(b.key_points, true) : '') +
      '</div>';
    if (tut && b.feedback && b.feedback.length) html += briefCard('todo', 'i-flag', '교수 피드백', briefList(b.feedback, false));
    if (b.decisions && b.decisions.length) html += briefCard('dec', 'i-flag', tut ? '팀 결정 사항' : '결정 사항',
      '<div class="check dec">' + b.decisions.map(function (d) { return '<div><i><svg><use href="#i-check"/></svg></i><span>' + hiNum(d) + '</span></div>'; }).join('') + '</div>');
    if (b.todos && b.todos.length) html += briefCard('todo', 'i-list', tut ? '다음까지 할 일' : '할 일', briefTodo(b.todos));
    if (b.next && b.next.length) html += briefCard('', 'i-list', tut ? '미결·확인 필요' : '다음 일정·미결', briefList(b.next, false));
    if (b.detail && b.detail.length)
      html += '<details class="card rcard" style="padding:10px 12px"><summary style="cursor:pointer;font-weight:600">상세 정리 (펼치기)</summary>' +
        '<div style="margin-top:10px">' + briefList(b.detail, false) + '</div></details>';
    return html;
  }
  function renderCards(sj) {
    sj = sj || {};
    if (sj.brief && sj.brief.headline) return renderBrief(sj);
    var html = '';
    var sum = (sj.summary && sj.summary.length) ? sj.summary.join(' ') : '';
    html += '<div class="card rcard"><div class="h"><svg><use href="#i-note"/></svg>요약</div>' +
      (sum ? '<p>' + esc(sum) + '</p>' : '<p class="empty">핵심 문장을 찾지 못했습니다.</p>') + '</div>';
    html += '<div class="card rcard todo"><div class="h"><svg><use href="#i-list"/></svg>할 일</div>' +
      checkList(sj.todos, '할 일로 보이는 내용이 없습니다.', false) + '</div>';
    html += '<div class="card rcard dec"><div class="h"><svg><use href="#i-flag"/></svg>결정 사항</div>' +
      checkList(sj.decisions, '결정·합의로 보이는 내용이 없습니다.', true) + '</div>';
    if (sj.keywords && sj.keywords.length) {
      html += '<div class="card rcard"><div class="h"><svg><use href="#i-search"/></svg>자주 나온 단어</div><div class="chips">' +
        sj.keywords.map(function (k) { return '<span class="chip">' + esc(k.word) + ' <b>' + k.count + '</b></span>'; }).join('') +
        '</div></div>';
    }
    return html;
  }

  function renderDocButtons(e) {
    var defs = [
      ['pdf', 'PDF', 'PDF', '바로 보기', e.pdf_url],
      ['word', 'W', 'Word', '편집용', e.docx_url],
      ['ppt', 'P', 'PPT', '발표용', e.pptx_url]
    ];
    var h = '<div class="docs-label">문서로 받기</div><div class="docs">';
    defs.forEach(function (d) {
      h += d[4]
        ? '<button class="card doc ' + d[0] + '" data-open="' + esc(d[4]) + '"><span class="badge">' + d[1] + '</span><b>' + d[2] + '</b><small>' + d[3] + '</small></button>'
        : '<button class="card doc ' + d[0] + '" disabled><span class="badge">' + d[1] + '</span><b>' + d[2] + '</b><small>대기</small></button>';
    });
    h += '</div>';
    h += '<p class="savehint warn">폰에서는 <b>PDF</b>로 바로 보세요. Word·PPT는 PC(또는 오피스 앱)에서 열립니다.</p>';
    return h;
  }
  function wireDocButtons(host, e) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () {
        var url = b.getAttribute('data-open');
        var w = window.open(url, '_blank');
        setExportMsg(w ? '새 탭에서 열었습니다.' : '팝업이 막혔습니다 — 다시 눌러 주세요.', w ? 'ok' : 'err');
      });
    });
  }

  if (btnDelete) btnDelete.addEventListener('click', function () {
    if (viewId) HistoryModule.remove(viewId);
    viewId = null; showHome(); renderHistory(); setStatus('대기 중', 'idle');
  });

  /* ---------- 회의 요약 탭(v5.2) — 서버 done 요약본 열람 전용 ----------
   * 서버(list_recent_memos)를 단일 소스로 직접 보여준다(HistoryModule 병합 안 함).
   * 요약이 주(主), 원문(전사/상세)은 <details> 로 접어 옵션으로 펼친다. 삭제·재전송 없음. */
  var meetingsRows = [], meetingsDetailOpen = false;
  /* v9.4 일하는 케이(회의록 맨 위) — 값은 이 화면이 이미 가진 것만:
   *   이 폰에서 보낸 녹음 중 「보내는 중·정리 중」인 수(HistoryModule — 임시 저장·실패는 세지 않는다) · 서버 정리본 목록(meetingsRows) · 불러오기 상태(mtgState). */
  var mtgState = '';                                 // '' 아직 | 'loading' | 'ok' | 'nopass' | 'fail' | 'na'(기능 없음)
  function cutText(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
  function meetingsScene() {
    if (!window.KScene) return;
    var wl = HistoryModule.list().filter(function (e) { return e.status === 'pending' || e.status === 'processing'; });
    var working = wl.length, allAudio = wl.every(function (e) { return e.kind !== 'photo' && e.kind !== 'video'; });
    var pose = '', text = '';
    if (working) { pose = 'desk'; text = (allAudio ? '녹음 ' : '') + working + '건을 정리하고 있습니다. 끝나면 여기에 올려 두겠습니다.'; }
    else if (mtgState === 'loading') { pose = 'idle'; text = '회의록을 가져오고 있습니다.'; }
    else if (mtgState === 'nopass') { pose = 'guide'; text = '연동 암호를 넣어 주시면 정리된 회의록을 보여 드리겠습니다.'; }
    else if (mtgState === 'fail') { pose = 'sorry'; text = '죄송합니다, 회의록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'; }
    else if (mtgState === 'ok' && meetingsRows.length) { pose = 'report'; text = '「' + cutText(meetingsRows[0].title || '회의 요약', 18) + '」 정리본이 준비돼 있습니다.'; }
    else if (mtgState === 'ok') { pose = 'guide'; text = '아직 정리본이 없습니다. 녹음하시면 제가 정리해 두겠습니다.'; }
    KScene.set('kscMeetings', pose, text);
  }
  function openMeetings() {
    openScreen($('meetingsView'));
    showMeetingsList();
    mtgState = '';
    renderHistory();                                 // (O-0176) 맨 위 「진행 중」·맨 아래 「이 폰에서 보낸 기록」은 암호 없이도(이 폰 기록)
    var host = $('meetingsList'); if (!host) return;
    if (!(window.OfficeBridge && OfficeBridge.listRecentMemos)) {
      host.innerHTML = '<p class="empty" style="padding:16px">이 기능을 아직 쓸 수 없습니다(업데이트 필요).</p>'; mtgState = 'na'; meetingsScene(); return;
    }
    // 🔒 회의 요약은 민감정보 → 채팅·공유함과 동일한 PC 연동 암호 게이트(중복 UI 없이 기존 게이트 재사용).
    var pass = getSyncPass();
    if (!pass) {
      host.innerHTML = '';                            // v9.4: 안내는 맨 위 케이가 말한다(같은 말을 두 번 하지 않게)
      mtgState = 'nopass'; meetingsScene();
      showSyncGate(true, '회의록을 보려면 PC 연동 암호를 입력해 주세요.');
      return;
    }
    host.innerHTML = '';
    mtgState = 'loading'; meetingsScene();
    OfficeBridge.listRecentMemos(100, pass).then(function (rows) {
      meetingsRows = Array.isArray(rows) ? rows : [];
      mtgState = 'ok';
      renderMeetingsList();
    }).catch(function (e) {
      if (e && e.badpass) {                          // 암호 불일치/미설정 → 저장 암호 지우고 재입력 유도(기존 게이트)
        setSyncPass('');
        host.innerHTML = '<p class="empty" style="padding:16px">암호가 맞지 않습니다. 다시 입력해 주세요.</p>';
        mtgState = 'nopass'; meetingsScene();
        if (isOpen($('meetingsView'))) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.');
      } else {
        host.innerHTML = '';
        mtgState = 'fail'; meetingsScene();
      }
    });
  }
  function showMeetingsList() {
    var l = $('meetingsList'), d = $('meetingsDetail');
    if (d) { d.style.display = 'none'; d.innerHTML = ''; }
    if (l) l.style.display = '';
    meetingsDetailOpen = false;
    var tp = $('mtgTop'); if (tp) tp.style.display = '';            // (O-0176) 상세에서 목록으로 오면 「진행 중」 칸 다시
    var lw = $('mtgLocalWrap'); if (lw) lw.style.display = (HistoryModule.list().some(function (e) { return e.status === 'done'; })) ? '' : 'none';
    scrollTop();
  }
  function renderMeetingsList() {
    var host = $('meetingsList'); if (!host) return;
    meetingsScene();
    if (!meetingsRows.length) { host.innerHTML = ''; return; }     // v9.4: 「아직 정리본이 없습니다」는 맨 위 케이가 말한다
    var lastDate = '', html = '';
    meetingsRows.forEach(function (r, idx) {
      // v6.5 (O-0085): 날짜 묶음은 한국 날짜 기준. 카드의 시각(올린 시각=대표님께 의미 없는 숫자)은 빼고
      //   녹음 길이를 보여 준다 — '녹음 · 1시간 40분'. 길이를 모르면 '녹음'만.
      var kp = kstParts(r.created_at);
      var d = kp ? kp.date : '';
      if (d && d !== lastDate) { html += '<div style="padding:12px 6px 4px;font-size:12px;opacity:.6;font-weight:700">' + esc(d) + '</div>'; lastDate = d; }
      var kb = (r.kind === 'video') ? '영상' : '녹음';
      var dur = fmtDurKo(memoDurSec(r));
      html += '<button class="card action wide" data-mtg="' + idx + '">' +
              '<span class="ic blue"><svg><use href="#i-note"/></svg></span>' +
              '<span class="tx"><b>' + esc(r.title || '회의 요약') + '</b><small>' + esc(kb + (dur ? '  ·  ' + dur : '')) + '</small></span>' +
              '<svg class="chev"><use href="#i-chev-r"/></svg></button>';
    });
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('[data-mtg]'), function (b) {
      b.addEventListener('click', function () { openMeetingDetail(parseInt(b.getAttribute('data-mtg'), 10)); });
    });
  }
  function openMeetingDetail(idx) {
    var r = meetingsRows[idx]; if (!r) return;
    var d = $('meetingsDetail'), l = $('meetingsList'); if (!d) return;
    var sj = r.summary_json || {};
    var kp = kstParts(r.created_at);                      // v6.5: 한국 시간(참고용) — 예전엔 UTC 가 그대로 보였음
    var when = kp ? (kp.date + ' ' + kp.time) : '';
    var dur = fmtDurKo(memoDurSec(r));
    var html = '<button class="back" id="mtgBackToList" style="margin:6px 0"><svg><use href="#i-chev-l"/></svg>목록으로</button>';
    html += '<div class="rtitle"><h2>' + esc(r.title || '회의 요약') + '</h2><div class="rmeta">' +
            (when ? '<span class="chip">' + esc(when) + '</span>' : '') +
            (dur ? '<span class="chip">' + esc(((r.kind === 'video') ? '영상 ' : '녹음 ') + dur) + '</span>' : '') +
            '<span class="chip on">요약</span></div></div>';
    // v5.3: 이름 변경 · 삭제(소프트삭제) — 연동암호 게이트, 확인은 기존 시트/모달 재사용
    // v9.20: [복사] — 화면에 보이는 정리본(원문 제외)을 글로 복사. 스위치 MTG_COPY='off' 면 v9.19 와 같은 두 단추
    var mcOn = (MTG_COPY === 'on'), mcSty = mcOn ? ' style="flex:1 1 0;min-width:0;padding-left:8px;padding-right:8px"' : '';
    html += '<div class="btnrow"' + (mcOn ? ' style="flex-direction:row;gap:8px"' : '') + '>' +
            (mcOn ? '<button id="mtgCopy" class="btn ghost sm"' + mcSty + '><svg><use href="#i-copy"/></svg>복사</button>' : '') +
            '<button id="mtgRename" class="btn ghost sm"' + mcSty + '><svg><use href="#i-note"/></svg>이름 변경</button>' +
            '<button id="mtgDelete" class="btn ghost sm danger"' + mcSty + '><svg><use href="#i-trash"/></svg>삭제</button>' +
            '</div>';
    if (sj.integrated && sj.minutes)   // 회의자료 함께 낸 경우: 통합 회의록
      html += rcard('i-note', '통합 회의록', '<div class="minutes" style="white-space:pre-wrap">' + esc(sj.minutes) + '</div>');
    html += renderCards(sj);           // 요약·할 일·결정·키워드 카드(기존 헬퍼 재사용)
    // 원문(전사/상세)은 기본 접힘 — 요약이 주, 원문은 옵션(대표님 지시)
    var raw = r.transcript || r.content_md || '';
    if (raw) {
      html += '<details class="card rcard" style="padding:10px 12px">' +
              '<summary style="cursor:pointer;font-weight:600">원문 전체 보기 (펼치기)</summary>' +
              '<div style="white-space:pre-wrap;margin-top:8px;line-height:1.6">' + esc(raw) + '</div></details>';
    }
    d.innerHTML = html;
    if (l) l.style.display = 'none';
    var tp = $('mtgTop'); if (tp) tp.style.display = 'none';        // (O-0176) 상세를 볼 땐 「진행 중」·「이 폰 기록」 숨김
    var lw = $('mtgLocalWrap'); if (lw) lw.style.display = 'none';
    d.style.display = 'block';
    meetingsDetailOpen = true;
    var bk = $('mtgBackToList'); if (bk) bk.addEventListener('click', showMeetingsList);
    var mcb = $('mtgCopy'); if (mcb) mcb.addEventListener('click', function () { copyToClipboard(meetingCopyText(r)); });
    var rn = $('mtgRename'); if (rn) rn.addEventListener('click', function () { renameMeetingPrompt(idx); });
    var dl = $('mtgDelete'); if (dl) dl.addEventListener('click', function () { confirmDeleteMeeting(idx); });
    scrollTop();
  }
  // v9.20: 회의록 상세 [복사] 글 — 화면과 같은 순서(제목·일시·길이 → 통합 회의록 → 요약 카드들). 원문(접힌 항목)은 넣지 않는다.
  //   renderBrief · renderCards 의 순서를 따라가는 글 전용 함수이며 HTML 을 쪼개 쓰지 않는다. 비어 있는 칸은 줄을 만들지 않는다.
  function meetingCopyText(r) {
    r = r || {};
    var sj = r.summary_json || {}, out = [];
    function T(v) { return (v == null) ? '' : String(v).replace(/\s+$/, ''); }
    function list(arr, numbered) {
      var o = [];
      (Array.isArray(arr) ? arr : []).forEach(function (x, i) { var t = T(x); if (t) o.push((numbered ? (i + 1) + '. ' : '- ') + t); });
      return o;
    }
    function section(title, lines) { if (lines && lines.length) { out.push(''); out.push('[' + title + ']'); lines.forEach(function (l) { out.push(l); }); } }
    var kp = kstParts(r.created_at), when = kp ? (kp.date + ' ' + kp.time) : '', dur = fmtDurKo(memoDurSec(r));
    out.push(T(r.title) || '회의 요약');
    var meta = [when, dur ? (((r.kind === 'video') ? '영상 ' : '녹음 ') + dur) : ''].filter(function (x) { return x; }).join(' · ');
    if (meta) out.push(meta);
    if (sj.integrated && sj.minutes) section('통합 회의록', [T(sj.minutes)]);
    var b = sj.brief;
    if (b && b.headline) {
      var tut = b.mode === 'tutoring';
      section(tut ? '이번 튜터링 한 줄' : '한 줄 결론', [T(b.headline)]);
      section(tut ? '진행 상황' : '핵심', list(b.key_points, true));
      if (tut) section('교수 피드백', list(b.feedback, false));
      section(tut ? '팀 결정 사항' : '결정 사항', list(b.decisions, false));
      var td = [];
      (Array.isArray(b.todos) ? b.todos : []).forEach(function (t) {
        if (!t) return;
        var task = T(typeof t === 'string' ? t : t.task); if (!task) return;
        var tail = [];
        if (t.owner) tail.push('담당 ' + T(t.owner));
        if (t.due) tail.push('기한 ' + T(t.due));
        td.push('- ' + task + (tail.length ? ' (' + tail.join(' · ') + ')' : ''));
      });
      section(tut ? '다음까지 할 일' : '할 일', td);
      section(tut ? '미결·확인 필요' : '다음 일정·미결', list(b.next, false));
      section('상세 정리', list(b.detail, false));
    } else {
      var sum = (Array.isArray(sj.summary) ? sj.summary : []).map(T).filter(function (x) { return x; }).join(' ');
      section('요약', sum ? [sum] : []);
      section('할 일', list(sj.todos, false));
      section('결정 사항', list(sj.decisions, false));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  // v5.3: 이름 변경 — 기존 modal 재사용(텍스트 입력). 서버 title 만 변경(PC 원본 무관).
  function renameMeetingPrompt(idx) {
    var r = meetingsRows[idx]; if (!r) return;
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, '이름을 변경하려면 PC 연동 암호를 입력해 주세요.'); return; }
    modalTitle.textContent = '이름 변경';
    var cur = r.title || '';
    var html = '<div class="card rcard"><div class="h"><svg><use href="#i-note"/></svg>표시 이름 바꾸기</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">앱에 보이는 <b>표시 이름</b>만 바뀝니다(PC에 저장된 원본 파일은 그대로입니다).</div>' +
      '<input id="mtgRenameInput" type="text" maxlength="120" value="' + esc(cur) + '" ' +
      'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px" placeholder="새 이름을 입력하세요"></div>' +
      '<div class="btnrow">' +
      '<button id="mtgRenameSave" class="btn primary"><svg><use href="#i-check"/></svg>저장</button>' +
      '<button id="mtgRenameCancel" class="btn ghost sm"><svg><use href="#i-x"/></svg>취소</button>' +
      '</div>';
    modalBody.innerHTML = html;
    var inp = $('mtgRenameInput');
    $('mtgRenameCancel').addEventListener('click', closeModal);
    $('mtgRenameSave').addEventListener('click', function () {
      var nt = ((inp && inp.value) || '').trim();
      if (!nt) { toast('이름을 입력해 주세요.'); return; }
      if (nt.length > 120) nt = nt.slice(0, 120);
      if (nt === (r.title || '')) { closeModal(); return; }   // 변화 없음
      OfficeBridge.renameMemo(r.id, nt, getSyncPass()).then(function (ok) {
        if (!ok) { toast('이름을 바꾸지 못했습니다(대상을 찾지 못함).'); return; }
        r.title = nt;                     // 로컬 캐시 갱신 → 목록·상세 즉시 반영
        closeModal(); renderMeetingsList(); openMeetingDetail(idx);
        toast('이름을 바꿨습니다.');
      }).catch(function (e) {
        closeModal();
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
        else toast('이름 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      });
    });
    modal.style.display = 'flex';
    setTimeout(function () { if (inp) try { inp.focus(); inp.select(); } catch (e) {} }, 60);
  }
  // v5.3: 삭제 — 소프트삭제(hide_memo 재사용, 복구 가능). 확인은 기존 시트(openSheet) 재사용.
  function confirmDeleteMeeting(idx) {
    var r = meetingsRows[idx]; if (!r) return;
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, '삭제하려면 PC 연동 암호를 입력해 주세요.'); return; }
    openSheet('이 회의록을 삭제할까요?',
      '목록에서 사라집니다. 소프트삭제라 서버 원본과 PC 파일은 남아 있어(복구 가능) 안심하셔도 됩니다.',
      '삭제', function () {
        OfficeBridge.hideMemo(r.id, getSyncPass()).then(function () {
          meetingsRows.splice(idx, 1);          // 로컬 캐시에서 제거
          showMeetingsList(); renderMeetingsList();
          toast('삭제했습니다.');
        }).catch(function (e) {
          if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
          else toast('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        });
      });
  }

  /* ---------- (O-0176 D) 진행 중인 메모 · 회의록 ----------
   * 예전 홈 「지난 메모」(이 폰 기록)와 「회의 요약」(서버)을 「회의록」 하나로 합쳤다.
   *   · 홈: 끝나지 않은 것(정리중·임시저장·재시도)이 있을 때만 「진행 중인 메모」 칸(최대 3건 + 「외 N건 · 회의록에서 보기」).
   *   · 회의록 화면 맨 위 「진행 중」: 같은 목록 전부(없으면 「없어요」 한 줄).
   *   · 회의록 화면 맨 아래 접힘 「이 폰에서 보낸 기록」: 끝난 것(사진·영상·명함 결과 포함) — 예전 지난 메모의 완료 항목.
   * 누르면 예전과 같은 onHistoryClick(재전송·임시저장 자료 붙이기·삭제·결과 보기 그대로). */
  var HOME_PROG_MAX = 3;
  var PROG_FOLD_KEY = 'smart_prog_fold';
  function progFolded() { try { return localStorage.getItem(PROG_FOLD_KEY) === '1'; } catch (e) { return false; } }
  if ($('homeProgHead')) $('homeProgHead').addEventListener('click', function () {
    try { if (progFolded()) localStorage.removeItem(PROG_FOLD_KEY); else localStorage.setItem(PROG_FOLD_KEY, '1'); } catch (e) {}
    renderHistory();
  });
  function iconFor(kind) { return kind === 'photo' ? 'i-image' : kind === 'video' ? 'i-video' : kind === 'search' ? 'i-card' : 'i-mic'; }
  function historyItemHtml(e) {
    var badge, cls;
    if (e.status === 'done') { badge = '완료'; cls = 'b-ok'; }
    else if (e.status === 'draft') { badge = '임시저장'; cls = 'b-draft'; }   // v3.8: 아직 안 보낸 녹음
    else if (e.status === 'failed') { badge = '재시도'; cls = 'b-wait'; }
    else if (e.status === 'lost') { badge = e.recType === 'unsent' ? '안 보낸 녹음' : '끊긴 녹음'; cls = 'b-wait'; }   // v9.10: 폰에 남아 있는 녹음
    else { badge = '정리중'; cls = 'b-proc'; }
    var vp = (videoProg && videoProg[e.id]) || '';
    var sub = (vp && e.status !== 'done') ? vp : (e.date || '');
    if (e.status === 'lost' && e.recSub) sub = e.recSub;
    return '<button class="card item" data-id="' + e.id + '">' +
      '<span class="ic"><svg><use href="#' + iconFor(e.kind) + '"/></svg></span>' +
      '<span class="tx"><b>' + esc(e.title) + '</b><small>' + esc(sub) + '</small></span>' +
      '<span class="badge ' + cls + '">' + badge + '</span>' +
      '<svg class="chev"><use href="#i-chev-r"/></svg></button>';
  }
  function wireHistoryItems(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.item'), function (el) {
      el.addEventListener('click', function () { onHistoryClick(el.getAttribute('data-id')); });
    });
  }
  function renderHistory() {
    var list = HistoryModule.list();
    var prog = list.filter(function (e) { return e.status !== 'done'; });
    var done = list.filter(function (e) { return e.status === 'done'; });
    // ① 홈 「진행 중인 메모」 — 있을 때만
    var wrap = $('homeProgress');
    if (wrap) wrap.style.display = prog.length ? '' : 'none';
    var pf = progFolded(), ph = $('homeProgHead');                 // (O-0176) 접힘이면 목록만 숨김(건수는 제목 옆에 그대로)
    if (ph) { ph.classList.toggle('folded', pf); ph.setAttribute('aria-expanded', pf ? 'false' : 'true'); }
    if (historyList) historyList.style.display = pf ? 'none' : '';
    if (historyCount) historyCount.textContent = prog.length ? prog.length + '건 · 끝나면 「회의록」에' : '';
    if (historyList) {
      var rest = prog.length - HOME_PROG_MAX;
      historyList.innerHTML = prog.slice(0, HOME_PROG_MAX).map(historyItemHtml).join('') +
        (rest > 0 ? '<button type="button" class="prog-more" id="homeProgMore">외 ' + rest + '건 · 회의록에서 보기</button>' : '');
      wireHistoryItems(historyList);
      var pm = $('homeProgMore'); if (pm) pm.addEventListener('click', openMeetings);
    }
    // ② 회의록 화면 「진행 중」 칸
    var mp = $('mtgProgress');
    if (mp) {
      mp.innerHTML = prog.length ? prog.map(historyItemHtml).join('')
        : '<div class="empty-note">정리 중이거나 임시 저장한 녹음은 없습니다.</div>';
      wireHistoryItems(mp);
    }
    try { if (isOpen($('meetingsView'))) meetingsScene(); } catch (e) {}      // v9.4: 정리 중인 수가 바뀌면 케이 한마디도
    var mc = $('mtgProgCount'); if (mc) mc.textContent = prog.length ? prog.length + '건' : '';
    // ③ 회의록 화면 맨 아래 「이 폰에서 보낸 기록」(끝난 것, 접힘)
    var lw = $('mtgLocalWrap'), ml = $('mtgLocal');
    if (lw) lw.style.display = (done.length && !meetingsDetailOpen) ? '' : 'none';
    var lc = $('mtgLocalCount'); if (lc) lc.textContent = done.length ? done.length + '건' : '';
    if (ml) { ml.innerHTML = done.map(historyItemHtml).join(''); wireHistoryItems(ml); }
  }
  function onHistoryClick(id) {
    var e = HistoryModule.get(id); if (!e) return;
    if (e.status === 'done') {
      if (e.kind === 'photo' || e.kind === 'video') showResult(id);
      else openModal(e);
    } else if (e.status === 'lost') {
      recFindItemOpen(e.recGid);   // v9.10 끊긴 녹음 · 보내지 않은 녹음 — [여기까지 저장] · [이어서 녹음] · [목록에서 빼기]
    } else if (e.status === 'draft') {
      openDraftModal(e);           // v3.8 임시저장 — 자료 붙이기 + [PC 보내기] + 삭제
    } else if (e.status === 'failed') {
      openFailedModal(e);          // 실패 항목도 눌러서 열림 — 사유 안내 + [다시 보내기]/[삭제] (2026-09-21)
    } else if (e.status === 'processing') {
      openProcessingModal(e);      // v5.1: 정리중 — 상태 안내 + [계속 기다리기]/[삭제](굳었을 때 직접 지울 수 있게)
    } else {
      openScreen(processing); setProcessing('PC에서 정리 중…', 'got', procWhat(id)); startPolling(id, e.token);
    }
  }
  /* ---------- 정리중(processing) 항목: 상태 안내 + 계속 기다리기 + 삭제 (v5.1) ----------
   * 예전엔 'processing' 항목을 누르면 정리중 화면+폴링만 떠서, 서버 미수신으로 굳은 항목을 지울 UI가
   * 전혀 없었다(2026-09-22 CCUBIO 사고). 이제 눌러서 상태를 보고, 굳었으면 직접 [삭제] 할 수 있다.
   *   ⚠️ 삭제는 '명시적 사용자 탭'으로만 — 정상 진행 중인 정리를 성급히 지우지 않는다. */
  function openProcessingModal(e) {
    modalTitle.textContent = (e.title || '메모') + '  ·  ' + (e.date || '');
    var html = '<div class="card rcard"><div class="h"><svg><use href="#i-spark"/></svg>PC에서 정리 중</div>' +
      '<div style="padding:2px 2px 0;line-height:1.6">' +
      '이 메모는 지금 PC에서 정리 중입니다.<br>' +
      '만약 <b>10분 넘게 계속 “정리 중”에서 멈춰</b> 있다면, 전송이 PC까지 닿지 못했을 수 있습니다' +
      '(그럴 땐 잠시 뒤 자동으로 <b>실패</b>로 바뀌어 다시 보낼 수 있습니다).<br>' +
      '지금 바로 정리하려면 아래 <b>삭제</b>로 이 항목을 지우고 다시 녹음해 보내 주세요.' +
      '</div></div>' +
      '<div class="btnrow">' +
      '<button id="mProcWait" class="btn primary"><svg><use href="#i-refresh"/></svg>계속 기다리기</button>' +
      '<button id="mProcDel" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button>' +
      '</div>';
    modalBody.innerHTML = html;
    $('mProcWait').addEventListener('click', function () {
      closeModal(); openScreen(processing); setProcessing('PC에서 정리 중…', 'got', procWhat(e.id)); startPolling(e.id, e.token);
    });
    $('mProcDel').addEventListener('click', function () {
      if (videoPollers[e.id]) { clearInterval(videoPollers[e.id]); delete videoPollers[e.id]; }
      delete videoProg[e.id];
      if (pollingId === e.id) stopPolling();
      OfficeBridge.dropPending(e.id);              // 남은 원본(있으면) 함께 정리
      HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('삭제했습니다.');
    });
    modal.style.display = 'flex';
  }
  /* ---------- 전송 실패한 메모: 사유 안내 + 다시 보내기 + 삭제 (2026-09-21) ----------
   * 예전엔 실패 항목을 누르면 화면 변화 없이 조용히 재시도만 돌아 "눌러도 반응이 없다"고 느껴졌다.
   * 이제 항목을 누르면 모달로 사유를 보여주고, [다시 보내기](즉시 피드백)·[삭제](영영 갇히지 않게)를 준다. */
  function openFailedModal(e) {
    modalTitle.textContent = (e.title || '메모') + '  ·  ' + (e.date || '');
    var reason = e.error ? esc(e.error) : '인터넷 연결이 끊겼을 수 있습니다';
    var html = '<div class="card rcard"><div class="h"><svg><use href="#i-flag"/></svg>전송 실패</div>' +
      '<div style="padding:2px 2px 0;line-height:1.6">' +
      '이 항목을 PC로 보내지 못했습니다.<br><b>사유:</b> ' + reason + '<br><br>' +
      '📶 인터넷 연결(와이파이·데이터)과 PC가 켜져 있는지 확인하고 <b>다시 보내기</b>를 눌러 주세요.<br>' +
      '녹음·파일은 이 기기에 안전하게 보관돼 있습니다.' +
      '</div></div>' +
      '<div class="btnrow">' +
      '<button id="mRetry" class="btn primary"><svg><use href="#i-refresh"/></svg>다시 보내기</button>' +
      '<button id="mFailDel" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button>' +
      '</div>';
    modalBody.innerHTML = html;
    $('mRetry').addEventListener('click', function () { closeModal(); retryFailedMemo(e.id); });
    $('mFailDel').addEventListener('click', function () {
      // v7.9: 확인을 한 번 거친다(confirm() 금지 → 기존 시트).
      openSheet('이 항목을 삭제할까요?',
        'PC로 보내지 못한 항목입니다. 지우면 폰에 보관된 녹음·파일도 함께 지워져 되살릴 수 없습니다.',
        '삭제', function () {
          // v7.8: 보관 원본(IndexedDB pending)도 함께 지운다 — 남겨 두면 목록에서 지운 뒤에도 다음 앱 실행·인터넷 복귀 때
          //   flush() 가 그 녹음·파일을 PC로 자동 전송했다(지운 항목이 보내짐). [정리중] 삭제(mProcDel)와 같은 처리.
          OfficeBridge.dropPending(e.id);
          HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('삭제했습니다.');
        });
    });
    modal.style.display = 'flex';
  }
  function retryFailedMemo(id) {
    var e = HistoryModule.get(id); if (!e) return;
    toast('다시 보내는 중…');
    HistoryModule.update(id, { status: 'processing', error: null });   // 즉시 '정리중'으로 보이게(재시도 시작 표시)
    renderHistory();
    var handled = false, failErr = null;
    // v5.1: 보존된 원본(sent:true 로 대기 중이던 것 포함)을 재전송 대상으로 되돌린 뒤 flush.
    OfficeBridge.markResendable(id).then(function () {
      return OfficeBridge.flush(function (memo) {
        if (memo.id === id) {           // 대기열에서 이 항목 재업로드 성공 → 결과 폴링
          handled = true;
          HistoryModule.update(id, { status: 'processing', error: null }); renderHistory();
          startPolling(id, e.token);
          noticeSkippedMaterials(memo);
        }
      }, function (memo, err) { if (memo.id === id) failErr = err; });   // v6.4: 실패 이유 받기
    }).then(function () {
      if (!handled) {                 // 못 보냈으면(대기열에 없음/또 실패) 실패로 되돌리고 사유 안내
        HistoryModule.update(id, { status: 'failed', error: failErr ? friendlyErr(failErr) : (e.error || null) }); renderHistory();
        showBanner('⚠️ 다시 보내기에 실패했습니다. ' + (failErr ? esc(friendlyErr(failErr)) : '인터넷 연결과 PC 상태를 확인하고 잠시 후 다시 시도해 주세요.'));
      }
    }).catch(function () {
      if (!handled) { HistoryModule.update(id, { status: 'failed' }); renderHistory(); }
      showBanner('⚠️ 다시 보내기에 실패했습니다. 인터넷 연결을 확인해 주세요.');
    });
  }

  /* ---------- 상세 모달 ---------- */
  function openModal(e) {
    modalTitle.textContent = e.title + '  ·  ' + e.date;
    var sj = e.summary_json || {};
    var html = '';
    if (sj.integrated && sj.minutes)   // 통합 회의록(회의자료 함께 낸 경우)
      html += rcard('i-note', '통합 회의록', '<div class="minutes" style="white-space:pre-wrap">' + esc(sj.minutes) + '</div>');
    html += renderCards(sj);
    // 전사 원문은 PC(.md)에만 보관 — 앱 모달에는 표시하지 않음(2026-09-21)
    html += '<div id="mDocBtns">' + renderDocButtons(e) + '</div>';
    html += '<div class="btnrow"><button id="mDelete" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button></div>';
    modalBody.innerHTML = html;
    wireDocButtons($('mDocBtns'), e);
    $('mDelete').addEventListener('click', function () { HistoryModule.remove(e.id); closeModal(); renderHistory(); });
    modal.style.display = 'flex';
  }
  function closeModal() {
    var h = modalOnClose; modalOnClose = null;
    modal.style.display = 'none';
    if (h) { try { h(); } catch (x) {} }
  }
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });

  /* ===================== 사진·영상: 미리보기 + 설명 → 묶음 전송 ===================== */
  var filePanel = $('filePanel'), pendingFiles = [], pendingKind = null;
  function reviewFiles(fileList, kind) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    // v6.6: 사진·영상 모두 한 파일 5GB까지(옛 값: 사진 45MB, 영상 상한 없음). 큰 영상은 40MB 조각으로 나눠 전송.
    arr = keepSendable(arr);
    if (!arr.length) return;
    pendingFiles = arr; pendingKind = kind;
    var t = now();
    if ($('filePanelTitle')) $('filePanelTitle').textContent = (kind === 'photo' ? '사진 보내기' : '영상 보내기');
    $('fileTitle').value = (kind === 'photo' ? '사진 ' : '영상 ') + t.date + ' ' + t.time + (arr.length > 1 ? (' 외 ' + arr.length + '개') : '');
    $('fileNote').value = '';
    $('fileKindLabel').textContent = (kind === 'photo' ? '사진' : '영상') + ' ' + arr.length + '개';
    $('cardCheckWrap').style.display = kind === 'photo' ? 'flex' : 'none';
    if ($('isCard')) $('isCard').checked = false;
    var prev = $('filePreview');
    if (kind === 'photo') {
      prev.innerHTML = '<div class="thumbs"></div>';
      var box = prev.querySelector('.thumbs');
      arr.slice(0, 8).forEach(function (f, i) {
        var t2 = document.createElement('div'); t2.className = 'thumb';
        t2.innerHTML = '<span class="n">' + (i + 1) + '</span>';
        var im = document.createElement('img');
        thumbSrc(im, f);                          // v6.6: readAsDataURL(통째 읽기) → 주소만
        t2.appendChild(im); box.appendChild(t2);
      });
      if (arr.length > 8) box.insertAdjacentHTML('beforeend', '<div class="morethumb">+' + (arr.length - 8) + '</div>');
    } else {
      prev.innerHTML = '<div class="vfiles">' + arr.map(function (f) {
        var mb = Math.round((f.size || 0) / 1024 / 1024 * 10) / 10;
        return '<div class="filemeta"><svg><use href="#i-video"/></svg>' + esc(f.name || '영상') + (mb ? ' · ' + mb + 'MB' : '') + '</div>';
      }).join('') + '</div>';
    }
    openScreen(filePanel);
  }
  if ($('fileCancel')) $('fileCancel').addEventListener('click', function () {
    pendingFiles = []; pendingKind = null; setScanPanel(false);
    if (filePanelFromChat) { filePanelFromChat = false; openChat(); return; }   // (O-0176) 채팅 ＋ 에서 왔으면 채팅으로
    showHome();
  });
  if ($('fileSend')) $('fileSend').addEventListener('click', function () {
    if (!pendingFiles.length) { showHome(); return; }
    var files = pendingFiles, kind = pendingKind;
    var title = ($('fileTitle').value || '').trim();
    var note = ($('fileNote').value || '').trim();
    var isCard = kind === 'photo' && $('isCard') && $('isCard').checked;
    var asScan = pendingScan && kind === 'photo' && SCAN_HUB === 'on';
    if (asScan) { files = [files[0]]; isCard = false; }
    pendingScan = false; if ($('filePanel')) $('filePanel').classList.remove('scan-mode');
    filePanelFromChat = false;                               // (O-0176) 보낸 뒤엔 홈(「진행 중인 메모」에서 상태 확인)
    pendingFiles = []; pendingKind = null;
    sendFiles(files, kind, title, note, isCard, asScan);
  });

  // 라우터: 영상 중 큰 것(>45MB)은 조각 전송(백그라운드), 나머지는 묶음 전송(포그라운드)
  var VIDEO_CHUNK_LIMIT = 45 * 1024 * 1024;
  function sendFiles(files, kind, title, note, isCard, asScan) {
    if (!files || !files.length) return;
    if (kind === 'video') {
      var big = [], small = [];
      Array.prototype.forEach.call(files, function (f) { ((f.size || 0) > VIDEO_CHUNK_LIMIT ? big : small).push(f); });
      if (small.length) sendBatchMemo(small, 'video', title, note, false);
      if (big.length) sendChunkedVideos(big, title, note);
      if (!small.length) showHome();
      return;
    }
    sendBatchMemo(files, kind, title, note, isCard, asScan);
  }

  /* 긴 영상: 조각 전송 + 백그라운드 진행(다른 기능 안 막음 — 대원칙) */
  var videoProg = {}, videoPollers = {};
  function sendChunkedVideos(list, title, note) {
    Array.prototype.forEach.call(list, function (file, idx) {
      var t = now();
      var mb = Math.round((file.size || 0) / 1024 / 1024);
      var memo = {
        id: OfficeBridge.uuid(), token: OfficeBridge.token(),
        title: (title || '긴 영상') + (list.length > 1 ? (' (' + (idx + 1) + ')') : ''),
        kind: 'video', note: note || null, date: t.date, time: t.time
      };
      HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending', kind: 'video' });
      videoProg[memo.id] = '올릴 준비 중… (' + mb + 'MB)';
      renderHistory();
      OfficeBridge.sendVideoChunked(memo, file, function (phase, done, total) {
        videoProg[memo.id] = '올리는 중 ' + done + '/' + total + ' 조각';
        renderHistory();
      }).then(function () {
        HistoryModule.update(memo.id, { status: 'processing' });
        videoProg[memo.id] = 'PC에서 분석 준비 중…';
        renderHistory();
        startVideoPolling(memo.id, memo.token);
      }).catch(function (e) {
        HistoryModule.update(memo.id, { status: 'failed', error: String(e && e.message || e) });
        delete videoProg[memo.id]; renderHistory();
        toast('긴 영상 업로드 실패 — 홈 「진행 중인 메모」에서 다시 시도해 주세요.');
      });
    });
    toast('긴 영상은 시간이 걸립니다. 다른 일 하셔도 됩니다 — 홈 「진행 중인 메모」에서 상태를 볼 수 있습니다.');
    showHome();
  }
  /* 긴 음성(2시간 등): 조각 전송 + 백그라운드 진행(긴 영상과 동일 UX — 다른 기능 안 막음) */
  function sendChunkedAudioMemo(memo, blob) {
    var mb = Math.round((blob.size || 0) / 1024 / 1024);
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: memo.date, time: memo.time, status: 'pending', kind: 'audio' });
    videoProg[memo.id] = '올릴 준비 중… (' + mb + 'MB)';
    renderHistory();
    OfficeBridge.sendAudioChunked(memo, blob, function (phase, done, total) {
      videoProg[memo.id] = '올리는 중 ' + done + '/' + total + ' 조각';
      renderHistory();
    }).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' });
      videoProg[memo.id] = 'PC에서 정리 준비 중…';
      renderHistory();
      startVideoPolling(memo.id, memo.token);
      noticeSkippedMaterials(memo);
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: friendlyErr(e) });
      delete videoProg[memo.id]; renderHistory();
      toast('긴 음성 업로드 실패 — ' + friendlyErr(e) + ' 홈 「진행 중인 메모」에서 다시 보내 주세요.');
    });
    toast('긴 녹음은 조각으로 나눠 보냅니다. 다른 일 하셔도 됩니다 — 홈 「진행 중인 메모」에서 상태를 볼 수 있습니다.');
    showHome();
  }
  function startVideoPolling(id, token) {
    if (videoPollers[id]) return;
    var started = Date.now();
    var lastRowAt = Date.now();      // 무행(서버 미수신) 지속 감지 — v5.1
    videoPollers[id] = setInterval(function () {
      OfficeBridge.poll(id, token).then(function (res) {
        if (!res) {                  // 행 없음 = 서버 미수신. STUCK_MS 넘게 지속되면 자동복구.
          if (Date.now() - lastRowAt > STUCK_MS) {
            clearInterval(videoPollers[id]); delete videoPollers[id]; delete videoProg[id]; autoFailStuck(id);
          }
          return;
        }
        lastRowAt = Date.now();
        if (res.status === 'done') {
          clearInterval(videoPollers[id]); delete videoPollers[id]; delete videoProg[id];
          HistoryModule.update(id, {
            status: 'done', kind: res.kind, transcript: res.transcript, summary_json: res.summary_json,
            content_md: res.content_md, pdf_url: res.pdf_url, docx_url: res.docx_url, pptx_url: res.pptx_url,
            title: res.title, error: res.error || null
          });
          OfficeBridge.dropPending(id);                    // 실제 정리 완료 확인 → 폰 원본 삭제(안전)
          renderHistory();
          toast((res.kind === 'audio' ? '🎙️ 긴 녹음 정리 완료' : '🎬 영상 정리 완료') + ' — 「회의록」에서 볼 수 있습니다.');
        } else {
          if (res.progress_msg) { videoProg[id] = res.progress_msg; renderHistory(); }
          if (Date.now() - started > 3 * 60 * 60 * 1000) { clearInterval(videoPollers[id]); delete videoPollers[id]; }  // 최장 3시간
        }
      }).catch(function () {});
    }, 5000);
  }

  function sendBatchMemo(files, kind, title, note, isCard, asScan) {
    if (!files || !files.length) return;
    var t = now();
    var noteFull = note || '';
    if (isCard) noteFull = noteFull ? ('명함. ' + noteFull) : '명함';
    var scan = !!(asScan && SCAN_HUB === 'on' && kind === 'photo');
    if (scan) { files = [files[0]]; noteFull = '영수증'; }    // 영수증: note 는 정확히 '영수증', 한 장만
    var memo = {
      id: OfficeBridge.uuid(), token: OfficeBridge.token(),
      title: title || ((kind === 'photo' ? '사진 ' : '영상 ') + t.date + ' ' + t.time),
      kind: kind, note: noteFull || null, date: t.date, time: t.time
    };
    if (scan) {
      memo.scan = { type: 'receipt', v: 1 };
    }
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending', kind: kind });
    renderHistory();
    openScreen(processing); setProcessing('⬆️ 올리는 중… (' + files.length + '개)', 'send', 'media');
    OfficeBridge.sendBatch(memo, files, function (done, total) {
      setProcessing('⬆️ 올리는 중… ' + done + '/' + total);
    }).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' }); renderHistory();
      setProcessing(scan ? '🧾 영수증을 읽는 중… (보통 1~2분)' : kind === 'photo' ? '🖼️ 사진 분석 중… (명함이면 등록합니다)' : '🎬 영상 분석 중… (조금 걸릴 수 있습니다)', 'got', 'media');
      startPolling(memo.id, memo.token);
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: String(e && e.message || e) });
      renderHistory(); showHome();
      showBanner('⚠️ 업로드 실패: ' + (e && e.message || e) + '. 홈 <b>진행 중인 메모</b>에서 다시 눌러 주세요.');
    });
  }
  if ($('btnPhoto')) $('btnPhoto').addEventListener('click', function () { $('photoInput').click(); });
  if ($('btnVideo')) $('btnVideo').addEventListener('click', function () { $('videoInput').click(); });
  $('photoInput').addEventListener('change', function () {
    if (this.files && this.files.length) {
      if (photoAsScan && SCAN_HUB === 'on') {                   // 영수증 모드: 한 장만(여러 장이면 첫 장 + 안내 한 줄)
        reviewFiles([this.files[0]], 'photo'); setScanPanel(true, this.files.length > 1);
      } else {
        reviewFiles(this.files, 'photo'); setScanPanel(false);
      }
      if (photoAsCard) {                                        // (O-0176) 채팅 ＋ 「명함 등록」 — 명함 스위치를 켠 채로(끄면 일반 사진 PC 정리)
        if ($('isCard')) $('isCard').checked = true;
        if ($('filePanelTitle')) $('filePanelTitle').textContent = '명함 등록 · 사진 PC 정리';
      }
    } else filePanelFromChat = false;
    photoAsCard = false; photoAsScan = false; this.value = '';
  });
  $('videoInput').addEventListener('change', function () {
    if (this.files && this.files.length) { reviewFiles(this.files, 'video'); if ($('filePanelTitle')) $('filePanelTitle').textContent = '영상 정리 (PC로)'; }
    else filePanelFromChat = false;
    this.value = '';
  });
  /* (O-0176) 홈 「사진 보내기」「영상 보내기」 칸을 뺀 대신 채팅 입력줄 [＋]를 누르면 고르기 창:
   *   ① 파일·사진을 케이에게(예전 ＋ 그대로) ② 명함 등록·사진 PC 정리(예전 홈 사진 보내기 — collect 사진 정리·명함 등록)
   *   ③ 영상 정리(예전 홈 영상 보내기 — 45MB 넘으면 조각 전송·PC 영상 정리). ②③은 채팅 첨부(케이에게)와 다른 길이라 그대로 살린다.
   *   글 쓰는 중(폰 네이티브 입력 바)의 ＋ 는 예전처럼 곧장 파일 고르기(native-input.js) — 이 창은 웹 입력줄 ＋ 에서만.
   *   뒤로가기로 닫힘(goBack 의 .shin-sheet 처리). 보내기 뒤에는 홈 「진행 중인 메모」에서 상태가 보인다. */
  var photoAsCard = false, filePanelFromChat = false;
  var photoAsScan = false, pendingScan = false;
  function setScanPanel(on, extra) {
    pendingScan = !!(SCAN_HUB === 'on' && on && pendingFiles.length);
    var fp = $('filePanel'); if (fp) fp.classList.toggle('scan-mode', pendingScan);
    var n = $('scanFileNote');
    if (n) { n.style.display = pendingScan ? 'block' : 'none'; n.textContent = pendingScan ? ('영수증은 한 번에 한 장만 읽습니다.' + (extra ? ' 고르신 사진 중 첫 장만 보냅니다.' : '')) : ''; }
    if (pendingScan) {
      if ($('filePanelTitle')) $('filePanelTitle').textContent = '영수증 등록';
      if ($('fileKindLabel')) $('fileKindLabel').textContent = '영수증 1장';
      var t = now(); if ($('fileTitle')) $('fileTitle').value = '영수증 ' + t.date + ' ' + t.time;
      if ($('cardCheckWrap')) $('cardCheckWrap').style.display = 'none';
      if ($('isCard')) $('isCard').checked = false;
    }
  }
  function openAttachMenu() {
    photoAsCard = false; filePanelFromChat = false; photoAsScan = false;          // 지난번에 고르기를 취소했으면 남은 표시를 지움
    var old = document.querySelector('.atm-sheet'); if (old) { try { old.remove(); } catch (e) {} }
    var sh = document.createElement('div');
    sh.className = 'sheet shin-sheet atm-sheet';
    sh.innerHTML = '<div class="sheet-box" role="dialog" aria-label="보내기 고르기"><div class="sheet-head">무엇을 보낼까요?</div>' +
      '<button type="button" class="sheet-btn" data-atm="file"><svg class="atm-ic"><use href="#i-image"/></svg><span><b>파일·사진을 케이에게</b><small>채팅에 붙여 케이에게 보여 주기</small></span></button>' +
      '<button type="button" class="sheet-btn" data-atm="card"><svg class="atm-ic"><use href="#i-card"/></svg><span><b>명함 등록 · 사진 PC 정리</b><small>PC가 명함 대장에 넣거나 사진을 정리(명함 스위치로 고름)</small></span></button>' +
      (SCAN_HUB === 'on' ? '<button type="button" class="sheet-btn" data-atm="receipt"><svg class="atm-ic"><use href="#i-note"/></svg><span><b>영수증 등록</b><small>케이가 읽어서 운영비·연구비 앱에 넣을 내용을 보여 드립니다</small></span></button>' : '') +
      '<button type="button" class="sheet-btn" data-atm="video"><svg class="atm-ic"><use href="#i-video"/></svg><span><b>영상 정리 (PC로)</b><small>긴 녹화도 조각으로 나눠 보내 PC가 요약</small></span></button>' +
      '<button type="button" class="sheet-btn atm-close" data-atm="close">닫기</button></div>';
    sh.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-atm]') : null;
      if (!b && ev.target !== sh) return;
      try { sh.remove(); } catch (e) {}
      var k = b && b.getAttribute('data-atm');
      if (k === 'file') $('chatFileInput').click();
      else if (k === 'card') { photoAsCard = true; filePanelFromChat = true; $('photoInput').click(); }
      else if (k === 'receipt' && SCAN_HUB === 'on') { photoAsScan = true; filePanelFromChat = true; $('photoInput').click(); }
      else if (k === 'video') { filePanelFromChat = true; $('videoInput').click(); }
    });
    document.body.appendChild(sh);
    sh.style.display = 'flex';
  }

  /* ===================== 명함 검색 ===================== */
  var searchPanel = $('searchPanel'), searchInput = $('searchInput'), searchResults = $('searchResults'), searchMsg = $('searchMsg');
  var searchPollTimer = null;   // 진행 중인 검색 폴링 — 검색 화면을 나가면 멈춘다
  function stopSearchPoll() { if (searchPollTimer) { clearInterval(searchPollTimer); searchPollTimer = null; } }
  function clearSearch() {
    stopSearchPoll();   // 검색 중 나가도 뒤에서 계속 조회하지 않게
    // 검색 전 빈 화면: 무엇을 하는 화면인지 예시로 안내(2026-09-20)
    if (searchResults) searchResults.innerHTML = '<div class="empty-note">찾으실 분의 이름이나 회사를 한글로 검색하세요.<br>예: 홍길동, 셀트리온</div>';
    setSearchMsg('', '');
    if (searchInput) searchInput.value = '';
  }
  if ($('btnSearchToggle')) $('btnSearchToggle').addEventListener('click', function () {
    openScreen(searchPanel); clearSearch();
    if (searchInput) setTimeout(function () { searchInput.focus(); }, 60);
  });
  function setSearchMsg(m, k) { if (searchMsg) { searchMsg.textContent = m || ''; searchMsg.className = 'exportmsg ' + (k || ''); } }
  function doSearch() {
    var q = (searchInput.value || '').trim();
    if (!q) { setSearchMsg('이름이나 기관을 한글로 입력하세요.', 'err'); return; }
    setSearchMsg('🔎 검색 중…', 'work'); searchResults.innerHTML = '';
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    OfficeBridge.createSearch({ id: id, token: tok, note: q }).then(function () {
      pollSearch(id, tok, function (res) {
        var sj = res.summary_json || {};
        renderSearchResults(sj.matches || [], sj.count || 0, q);
      });
    }).catch(function (e) { setSearchMsg('검색 요청 실패: ' + (e && e.message || e), 'err'); });
  }
  if ($('searchGo')) $('searchGo').addEventListener('click', doSearch);
  if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  function pollSearch(id, tok, onDone) {
    stopSearchPoll();   // 이전 검색 폴링이 남아 있으면 정리
    var started = Date.now();
    searchPollTimer = setInterval(function () {
      OfficeBridge.poll(id, tok).then(function (res) {
        if (res && res.status === 'done') { stopSearchPoll(); onDone(res); }
        else if (Date.now() - started > 60000) { stopSearchPoll(); setSearchMsg('시간이 걸립니다. PC가 켜져 있는지 확인 후 다시 검색해 주세요.', 'err'); }
      }).catch(function () {});
    }, 2000);
  }
  function renderSearchResults(matches, count, q) {
    if (!matches.length) {
      setSearchMsg('', '');
      searchResults.innerHTML = '<div class="card"><p class="empty">🔍 <b>"' + esc(q) + '"</b> 결과가 없습니다.<br>이름·기관의 <b>일부만</b> 넣어도 됩니다. 예: 방부형 → 방부, 연성대학교 → 연성</p></div>';
      return;
    }
    setSearchMsg('', '');
    var html = '<div class="count"><b>' + count + '명</b> 찾았습니다</div><div class="list">';
    matches.forEach(function (m, idx) {
      var name = (m.name || '').trim();
      var av = name ? name.charAt(0) : '·';
      html += '<div class="card person">';
      html += '<div class="head"><span class="avatar' + (idx % 2 ? ' c' : '') + '">' + esc(av) + '</span>' +
        '<div><div class="nm">' + esc(name) + (m.title ? '<span>' + esc(m.title) + '</span>' : '') + '</div>' +
        '<div class="org">' + esc([m.org, m.dept].filter(Boolean).join(' · ')) + '</div></div></div>';
      var meta = '';
      if (m.mobile) meta += '<div><svg><use href="#i-phone"/></svg><a href="tel:' + esc(m.mobile) + '">' + esc(m.mobile) + '</a></div>';
      if (m.office) meta += '<div><svg><use href="#i-phone"/></svg><a href="tel:' + esc(m.office) + '">' + esc(m.office) + '</a></div>';
      if (m.email) meta += '<div><svg><use href="#i-mail"/></svg><a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a></div>';
      if (meta) html += '<div class="meta">' + meta + '</div>';
      if (m.note) html += '<div class="savehint" style="text-align:left;margin:0">' + esc(m.note) + '</div>';
      if (m.photo_path) html += '<button class="btn ghost sm cardphoto" data-photo="' + esc(m.photo_path) + '"><svg><use href="#i-card"/></svg>명함 사진 보기</button>';
      html += '</div>';
    });
    html += '</div>';
    searchResults.innerHTML = html;
    Array.prototype.forEach.call(searchResults.querySelectorAll('[data-photo]'), function (b) {
      b.addEventListener('click', function () { openCardPhoto(b.getAttribute('data-photo'), b); });
    });
  }
  function openCardPhoto(path, btn) {
    var label = btn.innerHTML;
    btn.textContent = '불러오는 중…'; btn.disabled = true;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    OfficeBridge.createSearch({ id: id, token: tok, note: 'photo:' + path }).then(function () {
      pollSearch(id, tok, function (res) {
        var url = res.summary_json && res.summary_json.photo_url;
        btn.innerHTML = label; btn.disabled = false;
        if (url) showCardPhotoModal(url);
        else setSearchMsg('사진을 찾지 못했습니다.', 'err');
      });
    }).catch(function () {
      btn.innerHTML = label; btn.disabled = false;
      setSearchMsg('사진을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.', 'err');
    });
  }
  function showCardPhotoModal(url) {
    modalTitle.textContent = '명함 사진';
    modalBody.innerHTML = '<div class="cardphotowrap"><img src="' + esc(url) + '" alt="명함 사진" class="cardphotoimg"></div>' +
      '<p class="savehint">닫으면 검색 결과로 돌아갑니다. 사진을 눌러 새 창에서 크게 볼 수 있습니다.</p>';
    var im = modalBody.querySelector('.cardphotoimg');
    if (im) im.addEventListener('click', function () { window.open(url, '_blank'); });
    modal.style.display = 'flex';
  }

  /* ===================== 케이와 대화 ===================== */
  // 메시지 저장 형식: 질문 {role:'me', text, ts, id, token, answered} · 답 {role:'k', text, ts}
  // 답은 각 질문의 (id,token)으로 RPC 재조회 → 화면을 나갔다 와도, 앱을 껐다 켜도 복원된다.
  var chatView = $('chatView'), chatLog = $('chatLog'), chatInput = $('chatInput'), chatSend = $('chatSend');
  var chatMic = $('chatMic'), chatMicLabel = $('chatMicLabel'), chatCam = $('chatCam'), chatCamInput = $('chatCamInput');
  var chatPendingStrip = $('chatPendingStrip');
  var chatConvoToggle = $('chatConvoToggle'), chatConvoLabel = $('chatConvoLabel'), chatConvoStatus = $('chatConvoStatus');
  var chatKStage = $('chatKStage'), chatKStageText = $('chatKStageText'), chatKStageHint = $('chatKStageHint');   // (O-0124) 음성 대화 무대
  var CHAT_THREAD_KEY = 'smart_chat_thread', CHAT_MSGS_KEY = 'smart_chat_msgs';
  var OFFICE_SINCE_KEY = 'smart_office_since';   // 케이 방송(office_broadcast)을 어디까지 가져왔는지 표식
  var DELETED_BIDS_KEY = 'smart_deleted_bids';   // 대표님이 지운 케이 방송(bid) 무덤 — 다시 안 그리게
  var chatThread = getChatThread(), chatMsgs = loadChatMsgs(), chatUnseen = 0, chatTimer = null;
  // v4.5(2026-09-22): 한글(IME) 조합 중에 백그라운드 폴링(loadChatSync/reconcile)이 대화목록을
  //   다시 그리면(chatLog.innerHTML 재설정) 조합이 끊겨 "글자가 하나씩 씹힌다". 조합 중엔 재렌더를
  //   미뤘다가 조합이 끝나면(또는 포커스가 빠지면) 한 번에 그린다.
  var chatComposing = false, chatRenderDeferred = false;
  // ── PC↔폰 채팅 동기화(1단계) ───────────────────────────────────────────────
  var SYNC_SINCE_KEY = 'smart_chat_sync_since';   // 대화 동기화를 어디까지 가져왔는지 표식
  var SYNC_PASS_KEY = 'smart_sync_pass';          // 이 기기에 저장한 연동 암호
  var SYNC_PROMPTED_KEY = 'smart_sync_prompted';  // 첫 안내를 이미 띄웠는지(반복 안내 방지)
  var syncLoading = false, syncTimer = null;
  var deletedBids = loadDeletedBids();          // 대표님이 지운 방송/대화 행 id 목록(재출현 방지 · 로컬 tombstone)
  var officeLoading = false;
  var officeLoadingAt = 0, syncLoadingAt = 0;   // v7.7(O-0134): 조회가 멈춰 굳은 '조회 중' 표시를 45초 뒤 풀기 위한 시작 시각
  // ── v4.0 멀티기기 일관성 ──────────────────────────────────────────────────
  //  마커를 localStorage 에 굳혀 두면(기기별·세션별로 '지금'에 멈춰) 다른 기기 이력이 안 보이고
  //  꼬였다. 대신 채팅을 '열 때마다' 서버 전체(EPOCH)에서 재구성하고, 세션 중에는 메모리 상의
  //  high-water(가장 최근 ts)로만 증분 조회한다 → 모든 기기가 열 때 같은 상태로 수렴, 마커 꼬임 없음.
  var CHAT_EPOCH = '1970-01-01T00:00:00.000Z';
  var chatSyncHW = CHAT_EPOCH;    // 대화 동기화 세션 high-water(메모리 전용, 열 때 EPOCH 로 리셋)
  var officeHW = CHAT_EPOCH;      // 케이 방송 세션 high-water(메모리 전용)
  // ── v7.0(O-0102) 채팅 개수 상한 없애기 ─────────────────────────────────────
  //  예전: 열 때 서버에서 방송 최신 300 + 대화 최신 1000만 받아 그 밖(옛 대화)은 앱에서 볼 길이 없었다(9/29 O-0101 사고의 뿌리).
  //  이제: 열 때 대화+방송을 합친 최신 CHAT_PAGE_SIZE 건만 받고(list_chat_page), 맨 위 [이전 대화 더 보기]로
  //  그보다 옛것을 한 쪽씩 끝(첫 대화)까지 이어 받는다. 실시간 새 메시지는 예전 증분 조회(since)를 그대로 쓴다.
  //  서버에 list_chat_page 가 아직 없거나(404) 암호가 없으면 예전 방식 그대로(자동 폴백).
  var CHAT_PAGE_SIZE = 150;        // 한 쪽 크기(서버 최대 500). 쪽 수 제한은 없다
  var chatOlder = null;            // 다음 [이전 대화 더 보기] 커서 {ts: 서버 ts 문자열 그대로, id}. null=아직 쪽 조회 안 함
  var chatHasMore = false;         // 커서보다 옛것이 더 있나(마지막 쪽이 꽉 찼나)
  var chatOlderBusy = false;       // 옛 쪽 불러오는 중
  var chatPageMissing = false;     // 서버에 list_chat_page 없음(404) → 이번 실행 동안 예전 방식
  // v8.3(O-0161) ⭐ 저장한 답: 저장된 행 id 표(서버 star_list 로 채움, 이 기기 캐시) · 「그 대화 위치로」 이동 중 표시
  var STAR_IDS_KEY = 'smart_star_ids';
  var starIds = (function () { try { return JSON.parse(localStorage.getItem(STAR_IDS_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  var chatJumpUid = '', chatJumpUntil = 0;
  var APP_VERSION = 'v9.7';     // M1: 화면에 표시해 대표님이 최신본인지 알게 한다 (v9.7(O-0401): 케이 꾸미기 「설정」에서 케이 목소리 고르기 — PC 가 목록을 내려 줄 때만 「따뜻한 목소리 · 매끄러운 목소리 · 세라피나」 세 줄과 미리 듣기가 보이고, 고르면 PC 에 알려 브리핑과 글 채팅 [듣기]에 쓴다(음성 대화는 세라피나 그대로). 기기 음성은 아래 「직접 읽기」 묶음으로. PC 가 꺼 두었으면 예전 화면 그대로 · versionCode 51) (v9.6.1: 옷장 목록 그림을 「허리 위 · 회색 배경」판으로 — 그림 교체 · versionCode 50) (v9.5.1(O-0386): 건강 탭 끼니 칸(아침·점심·저녁)에 「안 먹음」 — 누르면 그 끼니는 적은 것으로 세고 한 줄로 접힘, 다시 누르면 풀림 · versionCode 48) (v9.4(O-0344·O-0353): 건강 탭 — ＋/− 가 지난 기록값에서 시작 · 지난 날짜 고치기 · 약·영양제를 위로, 적은 끼니는 한 줄로 · 안 올라간 칸 표시+자동 재전송(다른 기기 값 안 덮음) · 9칸 기준 / 누르는 자리 넓힘 · 밝은 화면 흐린 글씨 진하게 · 옛 문구 정리 / 케이가 보낸 알림·보고 목록을 연동 암호로 잠금 · versionCode 46) (v9.3(O-0247): 도구 「미러링」 — 폰 화면을 로키드 안경에 비추기, 별도 앱이던 것을 스마트비서 안으로(홈 「도구」 맨 아래 「안경 연결」 한 줄 → 네이티브 미러링 화면, 기능·안경 앱과의 통신은 별도 앱 v0.4 그대로, 폰 앱·안드로이드 10 이상에서만 보임, 허용 창은 그 화면에서 「시작」을 누를 때만). v9.2(O-0233): 음성 대화 효과음 줄이기가 폴드8에서 안 먹히던 문제 — 받아쓰기 신호음이 알림 소리 통로로 나서 그 통로를 줄이도록 바꿈, 벨소리·미디어는 건드리지 않음, 진단 값 추가. v9.1(O-0209): PC판에서 채팅을 읽으면 폰 앱을 열지 않아도 폰의 알림 서랍·앱 아이콘 숫자·바탕화면 위젯 수가 내려감 — PC 워커가 서버 읽음 기준(k_read_state)이 앞으로 간 것을 보고 「조용한 푸시」(data.k_clear, 화면에 아무것도 안 뜸)를 보내고, 폰(KClear)이 「읽은 시각까지」의 케이 답장 알림·채팅 화면 알림(꼬리표 kc|chat|시각)만 내림. 건강·아이디어 알림과 그 뒤에 온 알림은 그대로. 새 화면·버튼 없음. 옛 APK(v9.0 이하)에는 조용한 푸시를 보내지 않음(기기 표시 rclr). v9.1 에 함께 넣은 것 — (O-0210) 음성 대화 측정·알림: 폰 쪽 시각(말 끝 판정 뒤 기다린 시간·조각/답 받은 때·목소리 시작)을 다음 음성 턴에 실어 PC 로그로 보냄(meta.vprev), 목소리를 못 만든 턴은 안내 글. 화면·버튼·말 끝 기다림 값은 그대로. (O-0223) 음성 대화 효과음: 폰 받아쓰기가 내는 삑·띠링을 「케이 꾸미기」 화면 한 줄에서 켬/작게(기본)/끔으로 — 작게=듣기 시작 삑만 30%로 남기고 뒤는 끔, 끝나면 원래 음량으로 되돌림. (O-0226) 케이 표정: 감사·드릴게요·알겠습니다 같은 일상 답과 「네,」「대표님,」으로 시작하는 답도 미소, 웃는 얼굴은 15초(예전 7초), 정지 사진으로 보이는 자리(말풍선 옆 동그란 얼굴·프로필 첫 사진·움직임 끔)의 기본 얼굴을 미소로. 움직이는 영상(평소·말하는 중)은 그대로, 걱정 낱말(죄송·보류·지연)이 있으면 웃지 않음. 새 버튼·화면 없음. (O-0217) 말로 길 안내: 「○○까지 길 안내해 줘」에 케이 답 아래 [길찾기] 칩 → 네이버 지도(홈 「길찾기」·일정 [길찾기]와 같은 통로). PC 스위치(o0217_switch.json)가 켜져야 칩이 붙음. v9.0(O-0201): 읽음 기준 기기 간 공유 — 폰·PC판 어느 쪽에서든 채팅을 읽으면 다른 기기의 「새 메시지 N건」도 내려감(서버 한 줄 k_read_state · 연동 암호 RPC get_chat_read/mark_chat_read, 올리는 값은 서버가 메시지에 매긴 시각, 채팅을 실제로 보고 있을 때만 · PC판은 창 선택+최근 5분 내 조작, 서버 SQL 이 없거나 옛 APK 면 예전처럼 기기별 기준). 작업 카드·작업 현황의 결정 대기 항목에 [승인]·[수정 요청](채팅에 「#번호 승인」/「#번호 수정 요청: …」을 대신 보냄 — 새 서버 경로 없음, 승인은 확인 시트 한 번). 홈 「오늘 한눈에」 접힌 한 줄 — PC가 일정·메일을 못 불러온 날 「일정 0 · 메일 0」 대신 「못 불러왔어요」. v8.9(O-0189 긴급): 음성 대화가 말하는 중에 끊고 보내던 문제 — 폰 받아쓰기를 「이어 듣기」로(인식기가 스스로 끝내도 보내지 않고 다시 들으며 글을 이어 붙임), 보내는 때는 새 글자·큰 소리 없이 「말 끝 기다림」이 지났을 때·[다 말했어요]를 눌렀을 때·60초를 채웠을 때뿐. 말 끝 기다림 0.9초 → 기본 2초(무대 「기다림」 칩으로 짧게 1.2초/보통 2초/길게 3초, 이 기기에 저장), 녹음 경로도 같은 값(소음 적응 유지). 무대에 [다 말했어요 · 지금 보내기] 버튼. 끝난 이유·말한 길이를 PC 로그로(글 내용 아님). v8.8(O-0175·O-0176·O-0177·O-0178): 홈 정리 — 오늘 한눈에 아래를 「도구」 4칸×2줄(회의록·문서 뷰어·건강·계산기 / 공유함·아이디어·명함 검색·길찾기) + 「PC 연결」 두 줄(「Claude Code 연결」=PC 케이 대화방, 「PC 원격 제어」=크롬 원격 데스크톱, 문서 뷰어 편집 시트도 [PC 원격 제어 열기])로. 홈에서 작업 현황·예약한 알림·저장한 답 카드를 빼고 오늘 한눈에(「작업 현황 보기」 늘 보임·「예약한 알림」 한 줄·[말로 맡기기 (일정·알림)]·머리줄 눌러 접기 한 줄 요약)와 채팅 📋·☆ 로. 「지난 메모」+「회의 요약」 → 「회의록」(맨 위 「진행 중」 칸, 홈엔 진행 중인 것만·접기). 홈 사진·영상 보내기 칸 → 채팅 ＋ 고르기 창(케이에게 / 명함 등록·사진 PC 정리 / 영상 정리). 앱 서랍 「케이 음성」 아이콘 제거(바로가기 「음성 대화」는 그대로), 바로가기 「사진 보내기」→「케이에게 사진」. 계산기(O-0178) — 기본+공학용(삼각·역삼각·log·ln·거듭제곱·루트·n!·EXP·DEG/RAD·메모리·Ans), 직접 만든 계산 엔진(eval 없음), 계산 기록, [케이에게 묻기], 넓은 화면은 공학 자판 함께, 키보드 입력. 음성 대화 속도(O-0177) — 폰에서 바로 받아쓰기(KSpeech)·실시간 글자, 말 끝 판정 약 0.9초+소음 적응(vad.js), 조각 목소리 차례 재생(PC 스위치가 켜졌을 때), 케이 얼굴을 눌러 말 끊기. v8.7 까지: v8.7(O-0173·O-0174): 홈 「PC 화면」 카드 — 누르면 크롬 원격 데스크톱 앱이 바로 열림(없으면 플레이 스토어 안내, PC판은 원격 데스크톱 웹 새 탭, 문서 뷰어 [원격 화면 열기]와 같은 동작). 문서 뷰어 [✏️ 편집하기]를 워드·엑셀·PPT(doc·docx·xls·xlsx·ppt·pptx)에도 켬 — PC 편집 워커가 COM 으로 정확한 경로의 문서 창만 찾아 앞으로(다른 폴더 같은 이름 문서와 헷갈리지 않음, 엑셀·PPT 는 같은 이름이 열려 있으면 「(2)」 사본으로 엶). v8.6(O-0171·O-0172): 문서 뷰어 [✏️ 편집하기] — 한글(hwp·hwpx) 문서를 24시간 PC의 진짜 한글 프로그램으로 열어(창 최대화·맨 앞) 크롬 원격 데스크톱(삼성 DeX)으로 고치고 [저장] → [다 됐어요]로 고친 문서를 PDF·원본 파일로 돌려받음(채팅에도 첨부·푸시 없음). 원본은 PC 경로·사무소 서버 주소·폰 파일 순으로(최근 연 문서는 원본 다시 고르기). 연동 암호 확인 RPC로만 요청. [원격 화면 열기]=크롬 원격 데스크톱 앱(없으면 스토어), PC판은 원격 데스크톱 웹. 넓은 화면(900px↑)은 가운데 대화상자. 워드·엑셀·PPT 편집은 EDIT_ON_EXTS 한 줄로 켤 수 있음(PC 변환기가 켜 둔 Office 창을 닫던 문제는 O-0172로 고침). v8.5(O-0169): 홈 「오늘 한눈에」 날씨 줄 맨 앞에 「지금 21° 흐림」(앱이 Open-Meteo 를 직접 읽음 — 서울 시청 좌표만·키 없음, 홈이 보이는 동안 10분마다·열 때 3분보다 묵었으면 다시, 실패하면 PC 요약의 이번 시각 예보 「16시 21°」), 누르면 「오늘 날씨」 창 — 지금(크게)·남은 하루 우산·오늘 1시간 단위 가로 줄(지금 시각이 맨 왼쪽, 지난 시간은 흐리게, 저녁엔 내일 0~9시까지)·출퇴근 칸, 뒤로가기로 닫힘. v8.4(O-0162): 채팅 답을 기다리는 동안 점 세 개 옆에 「캘린더 확인 중…」처럼 케이가 지금 하는 일(PC 진행 표시) / 채팅 머리줄 케이 얼굴 옆 PC 상태 점(초록 정상·주황 바쁨·빨강 PC 응답 없음, 펼친 화면은 글자까지, 응답 없으면 맨 아래 안내) / 홈 「오늘 한눈에」 출퇴근 날씨·우산 한 줄(서울, 누르면 자세히) / 다른 앱에서 녹음 파일(통화 녹음 등)을 [공유]하면 [회의록으로 정리]·[케이에게 보내기] 고르기 — 회의록은 앱 녹음과 같은 화면·같은 정리 / 글자 크기 4단계(맨 위 「가가」·케이 꾸미기, 말풍선·입력창·홈 카드·문서 뷰어 글·엑셀 표). v8.3(O-0161): 말로 알림 예약 — 케이가 되읽어 확인 뒤 등록, 정한 시각에 앱 알림(PC 발송기·토큰 0), 홈 「예약한 알림」 목록·취소 / 앱 서랍 「케이 음성」 — 측면 버튼 두 번 누르기 → 바로 음성 대화 / 케이 답 [⋯] → ⭐ 저장, 홈·채팅 ☆ 「저장한 답」(검색·그 대화로·해제, 서버 저장) / 사무소 방송에 미리 붙인 케이 목소리 [▶ 듣기](아침 브리핑). v8.2: 어디서든 [공유] → 케이(O-0157) — 카톡 글·링크·사진 여러 장·파일을 공유하면 채팅에 첨부·본문이 채워져 열리고 빠른 칩 「요약해 줘」「답장 써 줘」「일정 잡아 줘」, 공유 문서 1개는 [문서 뷰어로 열기]/[케이에게 보내기] 고르기(「열기」는 예전처럼 곧장 뷰어). 케이 답장 알림에서 바로 [답장](앱을 안 열어도 됨, 잠금 해제 후에만, 자동 알림엔 버튼 없음). 아이콘 길게 눌러 음성 대화·녹음(바로 시작)·사진 보내기·오늘 한눈에. 바탕화면 케이 위젯 3종(한 줄·얼굴·카드, 스스로 깨어나지 않음, 「위젯에 내용 숨기기」). + 보안(O-0158): 채팅·사진·영상·명함검색·아이디어는 연동 암호 확인 RPC(submit_memo)로만 보냄 — 서버가 「확인됨」 표시를 남기고 PC는 그 표시를 확인. v8.1: 문서 뷰어 [케이에게 묻기·맡기기](O-0154) — 보던 문서를 쪽 번호·시트와 함께 케이 채팅으로(묻기 칩 3·맡기기 칩 2·직접 적기, 탭 2개 이상이면 열린 문서 함께 보내기), 엑셀은 원본·그 밖은 변환 PDF, PC 변환본이 서버에 있으면 다시 올리지 않음, 묻고 나와도 「이어서 보기」로 남음. v8.0: 문서 뷰어 여러 문서 탭(O-0153) — 보던 화면에서 [＋ 파일 더 열기]로 문서를 더 열면 탭(1·2·3…)으로 붙고, 탭을 누르면 보던 쪽·확대·회전·시트 그대로 왔다갔다. 최대 5개·같은 문서는 그 탭으로·여는 데 실패하면 보던 탭으로·탭 2개 이상 두고 나가면 고르기 화면 「열어 둔 문서 · 이어서 보기」. v7.9: 삭제 전 확인 — 임시저장·실패 항목을 지우기 전에 한 번 물어봄. 임시저장 창에 붙인 자료 이름 목록과 하나씩 빼기(✕). 재전송 시 자료 뒤바뀜 방지(자료마다 고정 저장 번호). 긴 녹음(조각 전송)을 다시 보낼 때 고친 제목·자료 반영(서버 update_pending_memo, PC가 조각을 다 받기 전까지 · 늦었으면 안내). 채팅·공유함 파일 이름 칩 — 폰에서 APK·압축·한글·오피스 파일은 크롬 대신 앱이 직접 저장(사진·영상·PDF는 그대로 열기). 다운로드 실패 사유 표시. 다운로드 멈춤 감지 10분 → 시작 대기 45초/진행 멈춤 2분. v7.8: 홈 「길찾기」 카드 — 누르면 네이버 지도 앱이 바로 열림(nmap://map, 앱 없거나 PC판이면 웹 지도). 임시저장을 다시 열어 제목 고치기 — 치는 동안엔 목록만, 녹음이 든 임시저장 쓰기는 입력을 마쳤을 때·보내기·창 닫힐 때 한 번, 비우면 기본 이름. 회의자료 중복 붙이기 방지·요약 상한 안내. 실패 항목을 삭제한 뒤에도 자동 전송되던 문제(삭제 시 dropPending). 「작업 현황」 화살표 위치. v7.7: 안읽음 실시간 갱신(O-0134) — 앱을 껐다 켜야만 새 메시지·홈 케이 말풍선이 보이던 문제. 화면이 보이는 동안 30초마다 케이 방송·다른 기기 대화를 조용히 받고, 앱 복귀·홈 복귀 즉시 한 번 받음, 화면 꺼짐·백그라운드면 멈춤. 방송·대화 조회 15초 타임아웃 + 굳은 '조회 중' 45초 뒤 풀기. 안읽음 계산·알림 제외·OS 알림/아이콘 배지는 그대로. v7.6: 홈 「오늘 한눈에」 일정 [길찾기](O-0133) — 장소가 기관·주소인 일정 옆 버튼 → 네이버 지도 앱 검색(nmap://search, 좌표·키 없음, [도착] 한 번 더 = 현재 위치 출발 대중교통), 앱 없으면 웹 지도, 방 이름만·온라인 회의는 버튼 숨김, PC판은 웹 지도. v7.5: 홈 「오늘 한눈에」(O-0129) — 녹음·케이 버튼 아래 카드 한 장: 오늘 일정(지금·다음 강조, 지난 일정은 접음)·답할 메일(제목·보낸 사람)·챙길 일(작업 현황 미완료, 확인 필요 먼저)+[말로 일정 잡기](채팅 열고 음성 대화). 일정·메일은 PC가 07~21시 매시 읽기 전용으로 만든 서버 요약(get_home_digest, 연동 암호), 할 일은 작업 현황 결과 재사용. 누르면 상세 시트→채팅 초안만(보내지 않음). + 건강기록 잠그기(O-0130) — 건강 탭 조회·저장과 푸시 토큰 등록을 연동 암호 게이트 RPC(health_list·health_upsert·push_token_register)로 옮김: 공개 키만으로는 건강기록·토큰을 읽거나 고칠 수 없게. 암호가 없으면 연동 암호 창, 폰에만 남은 값은 암호가 들어오면 올림. v7.4: 음성 대화 케이 무대(O-0124) — 「음성 대화」를 켜면 채팅 화면 위쪽 40%에 케이가 크게(말할 땐 talk 영상·들을 땐 idle, 기본머리 외·영상 실패는 정지 사진+끄덕임), 상태 줄 「듣는 중/답하는 중/말하는 중」, 대화 글은 무대 아래 상자에서 스크롤(위 가장자리 흐림), 음성 대화 중엔 맨 위 「스마트비서」 줄 접기, 키보드가 올라오면 무대 축소, 무대가 안 보이면 영상 정지·헤더 작은 얼굴 영상은 멈춤. 끄면 예전 화면 그대로. v7.3: 홈 「PC 케이에게 직접」 고침(O-0120) — 바로 claude.ai/code를 열어 새 클라우드 작업 시트가 뜨던 것을, 먼저 3줄 안내 시트(✕로 닫기 → Code 목록에서 PC 세션 고르기) + [Claude 앱 열기]로. 세션 제목·주소는 PC_K_* 상수 한 곳. v7.2: 통합 배포(O-0118) — 홈 케이 말풍선(O-0117, 숫자 배지 대신 「대표님, ○○」)·「문제」 표정 판정 좁히기 + 케이 전신 시작 인사(O-0116, 자막 멘트 13개·목소리 없음·설정 하루 첫 실행만(기본)/켤 때마다/끄기·[지금 보기]) + 꾸미기 전신 10벌(누르면 인사는 버건디만) + 네이티브 시작화면 다크(#070B1D) 통일 + 홈 「PC 케이에게 직접」(claude.ai/code 바깥으로 열기). v7.1: 글을 먼저 쓰면 첨부가 안 되던 문제 수정(O-0108) — 폰 입력 바의 ＋/카메라가 네이티브 파일 선택(NativeInput.pickFiles)으로 직접 골라 첨부 대기줄(window.SmartAttach)에 붙임·첨부만 보내기 가능·옛 APK는 예전 방식 + 채팅 긴 메시지 접기(O-0111) — 20줄 넘는 본문은 15줄까지만+아래 흐림+[전체 보기 ▼]/[접기 ▲], 펼친 상태는 다시 그려도 유지. v7.0: 채팅 개수 상한 없애기(O-0102) — 열 때 최신 150건(대화+방송 합쳐)만 빠르게 받고, 맨 위 [이전 대화 더 보기]로 첫 대화까지 끝없이 이어 보기(서버 list_chat_page 쪽 조회·연동 암호 잠금), 검색은 [옛 대화까지 모두 찾기]로 전체에서, 한 기기서 지운 방송은 다른 기기에서도 안 보이게(서버 숨김 제외). 서버 SQL 미적용이면 예전 방식으로 자동. v6.9: 문서 뷰어 — 큰 문서 올리기가 끊기지 않게(O-0097: 조각마다 진행률·멈춤 감시·자동 재시도, 조각이 다 올라간 뒤에만 PC에 요청, [다시 시도]는 이어서 올리거나 이미 변환된 결과를 바로 엶), 기다림은 PC가 변환을 시작한 뒤부터(작은 문서 5분·큰 문서 10분, 단계·경과 표시) + 「최근 연 문서」(O-0098: 이 기기에 변환본 보관 → 다시 열 때 변환 없이 바로, 지난번 본 쪽부터, 즐겨찾기·지우기·모두 비우기, 최대 1GB·40개 넘치면 오래 안 연 것부터 자동 정리). v6.8: 상단 고정 머리줄의 판 제거(O-0089) — 폰에서 v6.6 헤더가 앱 배경 위에 단색 네모 판으로 떠 보이고 상태바 덮개가 위 앱 제목을 가리던 문제. 머리줄은 투명, [뒤로]·오른쪽 버튼만 알약으로 떠 있고, 스크롤하면 제목·케이 이름표도 알약 배경. 상태바 덮개 삭제·blur 없음. v6.7: 폰 [⬇ 다운로드] 실제 저장(O-0088) — 안드로이드 WebView 는 blob <a download> 를 저장하지 못해 「저장했어요」만 뜨고 파일이 없던 문제. 폰은 네이티브 FileDownload(DownloadManager)로 「다운로드」 폴더에 실제 저장·저장 확인 뒤에만 성공 안내·APK 는 설치 화면으로(처음 한 번 「이 출처 허용」)·실패 시 웹페이지로 받기 자동 전환. 채팅·공유함 공통, PC판은 그대로. v6.6: 파일 크기 상한 5GB 통일(O-0086) — 회의자료 40MB·사진 45MB·채팅 사진 45MB(말없이 뺌)를 5GB로, 상한 없던 영상·채팅 파일·문서 뷰어·공유함도 같은 5GB(OfficeBridge.MAX_UPLOAD_BYTES 하나), 넘으면 「5GB까지 보낼 수 있어요」 안내, 사진 미리보기는 통째 읽기(readAsDataURL) 대신 주소(createObjectURL)로. 「공유/열기」로 넘어온 문서는 네이티브 60MB 유지+앱 안에서 고르는 길 안내. + 모든 서브 화면 상단(뒤로 버튼·제목) 고정(O-0087, 채팅과 같은 방식). v6.5: 회의 요약 시각 한국시간화(O-0085) — 서버 created_at(UTC)을 잘라 쓰던 탓에 11:45 가 02:45 로, 한국 00~09시 녹음은 날짜가 하루 전으로 보이던 문제 수정(kstParts, +9 고정). 목록 카드는 시각 대신 녹음 길이('녹음 · 1시간 40분', 모르면 '녹음')를 표시, 상세는 한국 일시+길이 칩. v6.4: 녹음 재전송 수정(O-0085) — 서버가 '이미 있음'을 400+statusCode 409 로 줘서 재전송이 회의자료 mat_0 에서 죽던 문제 해결(중복=성공), 녹음 조각은 먼저 읽고 올림·재전송은 PC가 받은 조각부터 이어서, 못 붙인 자료(너무 큼·읽기 실패)는 빼고 녹음은 보냄+안내, 실패 이유를 쉬운 말로 표시, 회의자료 저장 확장자 추정(pdf·hwp 등, 모르면 bin). v6.3: 공유함 큰 파일·파일명·실패안내 — 한 번에 올리는 한도를 서버 전역 한도(계획 5GB)로, 진행률 %, 실패 시 이유(용량/인터넷/파일 읽기/서버/권한)를 쉬운 말로 말풍선에 표시하고 파일은 보낼 칸에 되돌려 둠, 폴더 드래그는 걸러 안내, 저장 키 확장자 영문·숫자만(한글 확장자 InvalidKey 방지 — 채팅·문서·회의자료 업로드 공통), 다운로드는 원래 이름 그대로. v6.2: 긴생머리(h02) × 옷 10벌 조합 idle 반복영상(서버 catalog 의 combos[].idle, 없으면 정지 사진). v6.1: 케이 머리 스타일 10종 — 「케이 꾸미기」 옷/머리 탭, 지금 옷 × 머리 조합 사진(서버 공개 버킷 kchar/catalog.json, 실패·오프라인이면 번들 옷장+기본머리로 폴백), [＋ 추가 요청]. v6.0: 소장 「케이」 캐릭터 1차 — 채팅 케이 말풍선 원형 아바타(연속은 첫 칸만)+이름, 헤더 작은 얼굴+「케이 · 소장」→프로필 카드, 홈 「소장 K」 버튼 안 얼굴, idle/talk 반복영상(저전력·실패 시 정지사진), 답장 키워드별 표정, 옷장 「케이 꾸미기」(wardrobe.json 데이터 기반·로컬 저장), 목소리 선택(기본=PC 무료 선희 / 기기 내장 한국어 음성), 「듣기」는 말풍선 아래 줄. v5.9: 채팅 열림 위치 — 열 때·알림 탭·앱 복귀 시 첫 안읽음 메시지의 '시작'에서 열기(없으면 맨 아래), 「여기부터 새 메시지」 구분선, 보는 중 새 메시지는 맨 아래 근처일 때만 그 시작으로 부드럽게·위로 읽는 중이면 위치 유지, 내가 보낸 직후는 맨 아래. + 「작업 현황」 끝난 일 지우기 — 완료·취소·실패·보류 카드마다 [지우기], 「최근 끝난 일」 [모두 지우기](완료·취소만), 맨 아래 [지운 항목 다시 보기]. 지우기=서버 숨김 표시(hidden_at)만, 기록 원본·PC 지시 대장은 그대로. 확인은 앱 시트. v5.8: 채팅 「오퍼스 5.5」 1회 지정(켜고 보낸 그 1건만 meta.model_pref='opus' → PC 케이가 오퍼스 5.5로 처리, 보내면 자동으로 꺼짐 · 웹·네이티브 입력 둘 다) + 「작업 카드」(내 메시지 아래 대장 번호·상태·결과·처리 모델, 자동 갱신) + 「작업 현황」 화면(미완료·최근 완료, 창구 표시) — PC 지시 대장의 서버 사본 office_orders 를 연동암호 게이트 RPC로 조회. v5.7: 「회의 요약」 한눈 요약 — summary_json.brief(요약 v3)면 한 줄 결론을 크게+핵심/교수피드백/결정/할 일(담당·기한 칩)/미결 섹션 구분+상세 접힘, 숫자·날짜 굵게, 잡음 '자주 나온 단어' 숨김. brief 없는 옛 요약은 기존 표시 그대로. v5.6: 💡 아이디어 알림 즉시화 — 밤/낮 분기 제거, 항상 '보냈습니다 — 몇 분 안에 제안서를 보내드릴게요'(워커가 조용시간 없이 즉시 발송하도록 바뀐 데 맞춤). v5.5: 💡 아이디어 수첩 → 활용 제안(큰 버튼 즉시 녹음·글 입력·제안서 목록·갈래 태그 필터·[진행해줘]/[보류]). v5.4: 채팅 말풍선의 「🔔 알림」 딱지·호박색 테두리 표시 제거 — 알림 메시지도 일반 대화처럼 보임(메시지 자체·안읽음 카운트 제외는 그대로). v5.3=회의 요약 이름변경·삭제, v5.2=배지 클리어+회의 요약 탭, v5.1=안전 업로드.)
  APP_VERSION = 'v9.8';         // v9.8(O-0442): 녹음하면서 다른 화면 보기 — 위쪽 띠·녹음 화면 [뒤로]·녹음 상태 되찾기 (윗줄은 지난 판들의 기록 — 새 판부터는 여기에 한 줄씩 적는다 · versionCode 52)
  APP_VERSION = 'v9.9';         // v9.9(O-0451): 케이 꾸미기(옷 / 설정)로 가는 길을 채팅에서 홈으로 — 홈 케이 카드 오른쪽 위 「옷·설정」 단추(자리는 상수 KW_HOME 하나: corner 가안 · row 나안 · off 예전처럼), 홈에서 열면 닫을 때 홈으로 돌아오고 옷이 바뀌었으면 홈 카드가 한 번 반짝임, 채팅의 케이 프로필 카드는 남기고 [케이 꾸미기] 단추만 빼고 안내 한 줄. 꾸미기 「설정」 탭을 누르면 탭 줄이 폰 상태바 높이만큼 [뒤로] 밑에 깔리던 것 고침(회의 녹음 띠가 떠 있을 때도 그 높이만큼 비켜 선다). (O-0416) 버건디 인사 영상을 머리를 섞지 않은 판으로 · 자막 시점 1.04초 · versionCode 53
  APP_VERSION = 'v9.10';        // v9.10(O-0449): 끊긴 녹음 찾기 — 회의 녹음을 시작 · 정지할 때 폰 안쪽에 일지를 남기고, 앱을 다시 열면 끊긴 녹음 · 보내지 않은 녹음을 찾아 알림([이어서 녹음] · [여기까지 저장] · [나중에], 스위치 REC_FIND). 홈 케이 한 줄, 「녹음이 끊겼습니다」 알림 한 번, 녹음 준비 화면의 저장 공간 한 줄, 진단 값 meta.rec. 녹음하는 방식은 그대로 · 어떤 녹음 파일도 지우지 않음 · versionCode 54 (버전 글자는 화면 표시용 — 크기 비교에 쓰지 않는다: '9.10' 은 글자로 견주면 '9.9' 보다 작다)
  APP_VERSION = 'v9.11';        // v9.11(O-0450 · O-0472): 케이 그림을 새 그림으로 — 앱에 든 옷 13벌의 표정 · 작은 얼굴 · 전신 · 옷장 목록 그림과 알림 · 홈 화면 위젯의 둥근 얼굴(그림만 바뀌고 이름 · 자리는 그대로). 버건디의 움직이는 얼굴(평소 · 말하기)을 새 영상으로(7.5초 · 5.4초 — 눈을 깜빡이고 어깨까지 조금 움직인다). 새 영상에서는 말이 시작될 때 · 끝날 때 영상이 툭 끊기지 않고 0.35초 겹쳐 넘어간다(k-character.js 스위치 KF_XFADE: new · all · off — off 면 v9.10 과 같다). 나머지 옷의 움직이는 얼굴과 서버에서 받는 옷 7벌의 그림은 서버 묶음으로 따로 바뀐다(앱 설치와 무관). 걱정 · 생각 표정은 다시 받은 그림(주름 없이 은은하게 · 생각 표정의 눈 방향을 한쪽으로). (O-0487) 케이 옷 기기 간 맞추기 — 폰이나 PC판 한쪽에서 옷을 갈아입히면 다른 기기의 케이도 길게 30초 안에 같은 옷으로 바뀐다(처음 값은 폰의 옷 · 기기마다 다른 옷은 못 입힌다 · 서버에 옷 함수가 생긴 뒤에야 켜지고 그 전에는 v9.10 처럼 기기 저장만 · 스위치 OUTFIT_SYNC on / off) · versionCode 55
  APP_VERSION = 'v9.12';        // v9.12(O-0490): 케이 목소리 고르는 자리를 「케이 무대」 화면으로 — 꾸미기 「설정」에는 한 줄(지금 목소리 ›)만 두고, 누르면 케이가 「지금 목소리」 카드를 소개하는 화면이 열린다. 아래 번호판(여자 1–12 · 남자 1–12)의 번호를 누르면 예시를 들려 드리고 그 목소리로 바꾼다(빠름 = 동그란 번호 · 느림 = 둥근 네모 · 본인 목소리에는 꼬리표, 목록에 없는 번호는 점선 자리). 예시 소리는 그 화면을 열었을 때만 두 개씩 미리 받는다(예전에는 꾸미기를 열면 전부 한꺼번에). 기기 음성(「이 폰이 · 이 기기가 직접 읽기」)은 뺐다(골라 두신 저장값은 지우지 않음). 목소리를 고른 직후 PC 상태가 늦게 따라와도 안내 한 줄 · [듣기] 기다림이 고른 목소리의 것으로 유지된다. 스위치 KV_UI(stage · list) · KV_WARM(open · all · tap) · KV_DEVICE(false · true) — list · all · true 면 v9.11 의 줄 목록 화면 · versionCode 56
  APP_VERSION = 'v9.13';        // v9.13: 블랙 슬림 원피스 · 오프숄더 니트의 전신 그림을 다른 옷과 같은 키 · 비율로(꾸미기 전신 칸 · 시작 인사의 서 있는 그림) + 오프숄더의 옷장 목록 그림. 그림 3장만 바뀌고 코드는 그대로다. 두 옷의 새 인사 영상과 오프숄더의 새 통화 영상은 서버 묶음으로 따로 바뀐다(앱 설치 뒤) · 블랙 슬림의 통화 화면 · 옷장 목록 그림은 그대로 · versionCode 57
  APP_VERSION = 'v9.14';        // v9.14: 홈 맨 위 버전 표시 — 「스마트비서」 제목 바로 옆에 작은 알약(v9.14)으로 지금 설치된 버전이 보인다. 홈 맨 아래의 흐린 버전 줄은 뺐다(같은 일을 하는 자리는 하나만 · 스위치 VER_SPOT: top · bottom — bottom 이면 v9.13 처럼 맨 아래 한 줄) · versionCode 58
  APP_VERSION = 'v9.15';        // v9.15(O-0544): 문서 뷰어 「수정 요청」 — [✏️ 편집하기]를 [✏️ 고치기]로 바꾸고 두 갈래(표시해서 요청하기 · PC 화면으로 직접 고치기). 문서 위에 [펜]으로 동그라미 · 밑줄(표는 칸 · 행 · 열 · 표 전체 칩), 양 끝 손잡이로 범위 조정, 메모(빠른 칩 · 글 · 🎤 받아쓰기), 번호 핀 · 목록(이 기기 7일 보관) · [PC로 보내기] → PC가 원본의 사본(_rev1)을 고쳐 「고친 곳 표시 PDF」와 함께 채팅으로. 보낸 뒤 [요청 취소] · 「이어서 고치기」. 문서를 0.5초 길게 눌러도 켜짐(옷·설정 → 설정에서 끄기), [? 사용법] 7장(처음 한 번 저절로). PDF 는 수정 요청만, 엑셀 · PPT · 스캔은 교정 표시 PDF 로 돌려드림. 진동 권한 추가(길게 누를 때 짧게 한 번) · versionCode 59
  APP_VERSION = 'v9.16';        // v9.16(O-0545): 채팅 답장 — 말풍선 ⋯ → 「↩ 답장」을 고르면 입력 줄 위에 원래 메시지가 붙고, 보낸 말풍선 맨 위에 인용(누르면 그 메시지로). PC 응답기가 그 메시지를 읽어 이어서 답한다. 폰 입력 바 안에도 인용 줄 · versionCode 60
  APP_VERSION = 'v9.17';        // v9.17(O-0547): 수정 요청 메모의 「🎤 말로 적기」가 누르자마자 꺼지던 문제 — 2초 멈춤 시계가 말하기 전부터 돌던 것을 말이 시작된 뒤부터로(말이 없으면 8초), 채팅 받아쓰기와 같은 길(이어 듣기 · 효과음 설정)로 켜고, 멈출 때 마지막 말까지 받아 넣음. 「준비 중 → 듣는 중」 표시, 꺼지면 이유(권한 없음 · 회의 녹음 중 · 음성 대화 중 · 잘 못 들음)를 짧게 보여 줌. 실제로 받아 적은 글이 있을 때만 「말로 적음」 표시. (O-0548) 문서 뷰어 머리줄 [💬]로 채팅 바로 가기(수정 요청 화면에도) — 채팅에서 뒤로 가면 보던 문서의 같은 쪽 · 같은 확대로, 수정 요청 화면이었으면 펜/손 · 적던 메모까지 그대로 · versionCode 61
  APP_VERSION = 'v9.18';        // v9.18(O-0551): 케이 옷 자산 — 서버에서 그림 · 영상이 바뀐 옷을 입으면, 기기가 기억하던 옛 묶음의 빠진 파일(옛 인사 영상 등)을 받지 않고 새 묶음부터 받는다. 자리(인사 영상 짝 · 얼굴 영상 · 통화 · 자세 그림 · 서버 옷 사진)마다 새 파일이 다 준비되면 그 자리만 먼저 새것으로 바꿔, 새 파일 하나를 못 받아도 옛 인사 영상이 남지 않는다(k-character.js 스위치 KA_NEXT_FIRST on / off — off 면 v9.17 과 같다). (O-0545 ②) 채팅 말풍선을 왼쪽으로 밀면 답장 — 말풍선이 손가락(PC판은 마우스)을 따라 밀리고 ↩ 가 나타나며, 문턱을 넘겨 놓으면 ⋯ → 「↩ 답장」과 같은 답장 띠가 붙는다(세로 스크롤 · 글자 고르기 · 링크 · 첨부 · 화면 가장자리 뒤로 가기는 그대로 · 스위치 REPLY_SWIPE true / false) · versionCode 62
  APP_VERSION = 'v9.19';        // v9.19(O-0557): 케이 패션쇼 — 꾸미기 「옷」 탭의 옷장 머리줄 [▶ 패션쇼]를 누르면 케이가 옷장의 옷을(옷장과 같은 목록 · 순서 · 묶음 이름) 한 벌에 8초씩 갈아입으며 걸어 나와 → 한 바퀴 → 포즈. 옷이 바뀔 때 플래시처럼 번쩍 · 진행 막대 · 아래 단추 줄([이전] [멈춤] [이 옷 입기] [다음])로만 조작 · 마지막엔 지금 입은 옷으로 돌아와 [다시 보기] [닫기]. 보기만 해서는 옷이 바뀌지 않고 「이 옷 입기」만 옷장 칸을 누를 때와 같은 함수로 갈아입는다. 패션쇼 영상이 아직 없는 옷은 인사 영상 → 서 있는 그림으로 대신 · 움직임 줄이기면 그림으로. 패션쇼 영상은 서버 묶음(show 칸)에서 쇼를 열 때만 받는다(다음 옷 미리 받기) · 스위치 KFS_UI · versionCode 63
  APP_VERSION = 'v9.20';        // v9.20: 못 보낸 말풍선 [다시 보내기] · 쓰던 채팅 글 임시 보관 · 회의록 [복사] · 패션쇼 / 수정 요청 / 밀어서 답장 결함 수리
  // ── 음성 대화(핸즈프리) + 카메라 상태 ──
  //  기본은 "조용한 텍스트": 말/글로 물어도 답은 글로만. 음성 답은 (1) 각 답의 [듣기](온디맨드)
  //  또는 (2) 「음성 대화 모드」를 켰을 때만 → 그때만 speak 요청(평소 mp3 미생성 = 낭비 없음).
  var chatPendingImages = [];               // 케이에게 보여줄 사진(전송 전 대기)
  var chatPendingFiles = [];                // 첨부 파일(문서 등, 전송 전 대기) — 일반 메신저처럼 붙여두고 계속 입력
  var chatRecording = false, chatRecorder = null;
  var kaiAudio = null, kaiAudioUnlocked = false, silentWavCache = null;
  var kaiPlaySeq = 0, kaiStopSeq = 0;       // O-0468: 재생마다 번호 — [멈춤]으로 끊은 재생은 「막힘」 안내·이어가기를 하지 않는다
  // 핸즈프리: 무음 자동 감지 → 자동 전송 → (음성)답 → 재생 끝나면 자동 다시 듣기
  var convoOn = false, convoMiss = 0, ampTimer = null, ampBusy = false, nextListenArmed = false;
  var lsnSpoke = false, lsnSpeechMs = 0, lsnStartTs = 0, lsnLastSound = 0, lsnPendingSend = false, lsnReason = '';
  // O-0177 ③ 말 끝 기다림(녹음→PC 전사 경로 = 받아쓰기 미지원·PC판·받아쓰기 실패 때): 1600 → 900ms + 주변 소음 적응.
  //   · 시작 0.5초(CALIB_MS) 동안 진폭을 재서 그 방의 잡음 수준을 잡고, 말 판정선 = max(THRESH, 잡음×NOISE_MUL + NOISE_ADD)(상한 THRESH_MAX).
  //     조용한 방은 예전 0.05 그대로, 시끄러운 곳은 판정선이 올라가 잡음을 말로 오인해 끝나지 않는 일을 막는다.
  //     ⚠️ 측정 중 이미 말을 시작하셨으면(진폭이 THRESH×4 이상) 그 값은 잡음으로 치지 않는다.
  //   · 말한 지 3초가 넘으면 SILENCE_LONG_MS(1100)로 — 긴 말 중간에 생각하며 잠깐 쉬어도 덜 끊기게. 짧은 대답은 900ms에 바로 보냄.
  //   · POLL 160 → 100ms: 끝 판정이 최대 0.16초 늦던 것을 0.1초로. MIN_SPEECH 400ms(헛기침·잡음 한 번으로 말 시작 판정 안 함) 유지.
  //   · 근거·시험: _jobs_output\20261003_o0177_voice_speed_bargein\vad_sim_test.js (합성 진폭 6가지 경우 시험)
  //   ▶ O-0189(v8.9, 대표님 「말하고 있는데 끊고 전송해 버린다」): 900/1100ms 는 너무 짧았다 → 무음 기다림은 아래 「말 끝 기다림」 설정값
  //     (짧게 1.2초 / 보통 2.0초(기본) / 길게 3.0초)을 그대로 쓴다(applyEndWait 가 SILENCE_MS·SILENCE_LONG_MS 를 채움). 소음 적응은 유지.
  //     한 번에 말할 수 있는 길이 30초 → 60초.
  var HF = { THRESH: 0.05, POLL: 100, SILENCE_MS: 2000, SILENCE_LONG_MS: 2000, LONG_AFTER_MS: 3000, NOSPEECH_MS: 7000,
             MAX_TURN_MS: 60000, MIN_SPEECH_MS: 400, MAX_MISS: 3,
             CALIB_MS: 500, NOISE_MUL: 1.8, NOISE_ADD: 0.02, THRESH_MAX: 0.3 };   // 소음 적응 값은 시험 파일(vad_sim_test.js)의 NEW 와 같음
  var HF_OLD = { THRESH: 0.05, POLL: 160, SILENCE_MS: 1600, NOSPEECH_MS: 7000, MAX_TURN_MS: 30000, MIN_SPEECH_MS: 400, MAX_MISS: 3 };
  /* ---- O-0177 음성 대화 속도 개선 스위치(하나씩 끌 수 있음 — false 면 그 부분만 예전 그대로) ----
   *  STREAM    ① 케이 답을 첫 문장부터 조각 목소리로(meta.vstream=1 요청). PC 스위치(o0177_switch.json voice_stream)가 꺼져 있으면
   *              PC가 예전처럼 한 덩어리 voice_url 로 답하므로 앱도 자동으로 예전처럼 재생한다.
   *  DEVICE_STT ② 폰에서 바로 받아쓰기(안드로이드 SpeechRecognizer, 기기 내 인식 우선) → 글자로 보냄. 미지원·실패·PC판이면 녹음 경로.
   *  ADAPT_VAD ③ 위 HF(900ms+소음 적응). false 면 HF_OLD(1600ms 고정) 그대로.
   *  TAP_CUT   ④ 케이가 말하는(또는 답을 만드는) 중 무대(케이 얼굴)를 누르면 즉시 멈추고 듣기. 목소리로 끼어들기는 만들지 않음(대표님 결정).
   *  POLL_FAST_MS  음성 대화로 답을 기다리는 동안 확인 간격(평소 2500ms). 서버 호출은 get_voice_memo(연동 토큰) 그대로. */
  var VC = { STREAM: true, DEVICE_STT: true, ADAPT_VAD: true, TAP_CUT: true, POLL_FAST_MS: 600,
             STT_NOSPEECH_MS: 8000, STT_MAX_MS: 60000, STT_FINAL_WAIT_MS: 1200,
             STT_LOUD_DB: 5,            // 소리 크기가 그 자리 바닥값보다 이만큼(dB) 크면 「아직 말하는 중일 수 있음」
             STT_MUTE_RESTART: true };  // 일반 인식기(기기 내 인식 아님)가 다시 들을 때 삑 소리를 0.7초 끔(기기 내 인식기는 해당 없음)
  if (!VC.ADAPT_VAD) HF = HF_OLD;
  /* ---- O-0189 「말 끝 기다림」 설정(이 기기에 저장) ----
   *  말을 멈춘 뒤 이만큼 조용하면 보낸다. 짧게 1.2초 / 보통 2.0초(기본) / 길게 3.0초. 무대의 「기다림」 칩을 누를 때마다 바뀐다.
   *  기다리기 싫으면 무대의 [다 말했어요]로 바로 보낸다. 폰 받아쓰기·녹음 경로 둘 다 같은 값을 쓴다. */
  var ENDWAIT_KEY = 'smart_convo_endwait';
  var ENDWAIT = { short: { ms: 1200, name: '짧게', sec: '1.2초' }, normal: { ms: 2000, name: '보통', sec: '2초' }, long: { ms: 3000, name: '길게', sec: '3초' } };
  var endWaitMode = (function () { try { var v = localStorage.getItem(ENDWAIT_KEY); return ENDWAIT[v] ? v : 'normal'; } catch (e) { return 'normal'; } })();
  function endWaitMs() { return ENDWAIT[endWaitMode].ms; }
  function applyEndWait() {
    if (HF !== HF_OLD) { HF.SILENCE_MS = endWaitMs(); HF.SILENCE_LONG_MS = endWaitMs(); }
    var chip = $('chatKStageWait');
    if (chip) chip.textContent = '기다림 ' + ENDWAIT[endWaitMode].name + ' · ' + ENDWAIT[endWaitMode].sec;
  }
  function cycleEndWait() {
    endWaitMode = endWaitMode === 'short' ? 'normal' : (endWaitMode === 'normal' ? 'long' : 'short');
    try { localStorage.setItem(ENDWAIT_KEY, endWaitMode); } catch (e) {}
    applyEndWait();
    toast('말 끝 기다림: ' + ENDWAIT[endWaitMode].name + '(' + ENDWAIT[endWaitMode].sec + ') — 말을 멈추고 이만큼 지나면 보냅니다.');
  }

  /* ---- O-0223 「음성 대화 효과음」 설정(이 기기에 저장, 케이 꾸미기 화면) ----
   *  대표님 말씀(2026-10-04): 「듣는 과정 중에 계속 소리 나는 거 불편」 「말이 끝나고 또 띠링… 생각보다 크고 불편해」.
   *  그 삑·띠링은 안드로이드 받아쓰기(SpeechRecognizer)가 듣기 시작·끝낼 때 스스로 내는 소리다(앱이 만든 소리 아님).
   *  폰 플러그인(KSpeech sfx)이 듣는 동안만 폰의 「알림 소리」를 줄이거나 꺼서 막는다. 끝나면 원래 음량으로 되돌린다.
   *  (O-0233, 2026-10-05: v9.1 은 미디어·시스템 소리를 줄였는데 대표님 폰에서는 「끔」에서도 소리가 났다. 폰 음량 막대에서 「알림」을 끄니
   *   사라졌다 → 이 폰의 받아쓰기 신호음은 알림 통로로 난다. 그래서 줄이는 통로를 알림 소리로 바꿨다. 벨소리·미디어는 건드리지 않는다.
   *   부작용: 듣는 몇 초 동안은 카카오톡 같은 다른 앱의 알림 소리도 같이 작아지거나 안 난다(알림 자체는 온다).
   *   진동·무음·방해 금지 중에는 아무것도 바꾸지 않는다.)
   *    soft(기본) = 「작게」: 듣기 시작 삑만 지금 음량의 30%로 남기고, 그 뒤 다시 듣기·끝 띠링은 끔
   *    off        = 「끔」  : 듣는 동안 모두 끔(시작 신호도 없음 — 화면의 「말씀하세요…」로만 알 수 있음)
   *    on         = 「켬」  : 예전 그대로
   *  옛 APK(플러그인에 sfx 가 없는 판)는 이 값을 모른 척하므로 예전과 똑같이 동작한다. PC판은 받아쓰기를 안 써서 해당 없음. */
  var SFX_KEY = 'smart_convo_sfx';
  var SFX_MODES = { on: '켬', soft: '작게', off: '끔' };
  var sfxMode = (function () { try { var v = localStorage.getItem(SFX_KEY); return SFX_MODES[v] ? v : 'soft'; } catch (e) { return 'soft'; } })();
  function renderSfx() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ksfx]'), function (b) {
      var on = b.getAttribute('data-ksfx') === sfxMode;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-ksfx]'), function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-ksfx'); if (!SFX_MODES[v]) return;
      sfxMode = v;
      try { localStorage.setItem(SFX_KEY, v); } catch (e) {}
      renderSfx();
      toast(v === 'off' ? '음성 대화 효과음을 껐습니다. 듣는 동안은 다른 앱 알림 소리도 나지 않습니다.'
          : v === 'soft' ? '음성 대화 효과음을 작게 했습니다. 듣는 동안은 다른 앱 알림 소리도 작아집니다.'
          : '음성 대화 효과음을 예전처럼 켰습니다.');
    });
  });
  renderSfx();

  /* ---- v5.8 「오퍼스 5.5」 1회 지정 ----
   * 대표님 지시(2026-09-25): "중요 작업을 지시할 경우에만 오퍼스를 체크해서 진행하겠다."
   *  · 기본 꺼짐(평소처럼 PC 케이가 알아서 모델 선택). 켜고 보낸 「그 1건」에만 meta.model_pref='opus'.
   *  · 보내는 순간 자동으로 꺼진다(takeOpus) → 실수로 계속 오퍼스로 도는 일이 없다.
   *  · 켜져 있는 동안은 칩 색·안내문으로 눈에 띄게 표시. 네이티브 입력 바(안드로이드)에도 같은 칩이 있고
   *    서로 상태를 맞춘다(native-input.js 가 window.SmartOpus 로 읽고/쓴다). */
  var opusNext = false;
  var chatOpusToggle = $('chatOpusToggle'), chatOpusLabel = $('chatOpusLabel'), chatOpusHint = $('chatOpusHint');
  function setOpusNext(on) {
    opusNext = !!on;
    if (chatOpusToggle) chatOpusToggle.setAttribute('aria-pressed', opusNext ? 'true' : 'false');
    if (chatOpusLabel) chatOpusLabel.textContent = opusNext ? '오퍼스 5.5 켜짐' : '오퍼스 5.5';
    if (chatOpusHint) {
      chatOpusHint.textContent = opusNext ? '다음에 보내는 1건을 오퍼스 5.5로 처리합니다' : '중요 작업일 때만 켜고 보내세요';
      chatOpusHint.className = 'opushint' + (opusNext ? ' on' : '');
    }
  }
  function takeOpus() { var on = opusNext; if (on) setOpusNext(false); return on; }   // 보낸 그 1건에만 쓰고 끔
  window.SmartOpus = { get: function () { return opusNext; }, set: function (on) { setOpusNext(on); } };

  /* ---- 케이 목소리 재생(안드로이드 자동재생 언락 + 수동 재생 폴백) ----
   * 안드로이드 WebView 는 사용자 제스처 없이 소리 재생을 막는다. 그래서
   *  (1) 대표님이 마이크/카메라/보내기를 '탭'하는 그 순간(제스처)에 무음을 한번 재생해 오디오를 '깨우고',
   *  (2) 케이 답 mp3 가 도착하면 그 깨워둔 <audio> 로 재생한다.
   * 그래도 막히면 말풍선의 "다시 듣기"(그 자체가 제스처)로 언제든 들으실 수 있다. */
  function silentWav() {
    if (silentWavCache) return silentWavCache;
    try {
      var sr = 8000, n = 400, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
      function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
      ws(0, 'RIFF'); v.setUint32(4, 36 + n, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr, true);
      v.setUint16(32, 1, true); v.setUint16(34, 8, true); ws(36, 'data'); v.setUint32(40, n, true);
      for (var i = 0; i < n; i++) v.setUint8(44 + i, 128);
      var bytes = new Uint8Array(buf), bin = '';
      for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
      silentWavCache = 'data:audio/wav;base64,' + btoa(bin);
    } catch (e) { silentWavCache = ''; }
    return silentWavCache;
  }
  function ensureKaiAudio() {
    if (!kaiAudio) {
      try {
        kaiAudio = new Audio(); kaiAudio.preload = 'auto';
        // v6.0: 케이 목소리가 나오는 동안 얼굴을 talk 영상으로(무음 언락 재생은 제외)
        kaiAudio.addEventListener('playing', function () { if (window.KChar && kaiAudio.src && kaiAudio.src.indexOf('data:') !== 0) KChar.setTalking(true); });
        // O-0210: 이 음성 턴의 케이 목소리가 처음 실제로 나기 시작한 때(측정용). 다른 말풍선 [듣기]를 누른 재생은 세지 않는다.
        kaiAudio.addEventListener('playing', function () {
          if (vlat && !vlat.play && kaiAudio.src && kaiAudio.src.indexOf('data:') !== 0 && (kaiQ.rid === vlat.id || vlat.done)) vlat.play = Date.now();
        });
        ['ended', 'pause', 'error', 'emptied'].forEach(function (ev) { kaiAudio.addEventListener(ev, function () { if (window.KChar) KChar.setTalking(false); }); });
        // O-0468: 소리가 멈추면(끝남 · 다른 소리가 대신 들어옴 · 녹음 시작 · 대화 끝내기 등 어느 길이든) 그 말풍선 단추를 [듣기]로 되돌린다
        ['pause', 'emptied'].forEach(function (ev) { kaiAudio.addEventListener(ev, function () { if (kaiAudio.paused) listenAudioEnd(); }); });
        kaiAudio.addEventListener('ended', function () {
          listenAudioEnd();
          if (vqHasMore()) { vqPump(); return; }  // O-0177 ①: 다음 목소리 조각이 이미 와 있으면 곧장 이어서
          if (convoOn && vqWaiting()) { setConvoStatus('케이가 답하는 중…'); return; }   // 다음 조각을 아직 만드는 중
          // v9.6: 목소리가 끝난 그 순간 통화 화면의 케이는 바로 「듣는 모습」으로(입이 소리보다 오래 움직이지 않게). 그림만 먼저 바꾼다 — 다음 듣기를 여는 시점·값(아래 350)은 그대로.
          try { if (convoOn && window.KCall && KCall.active()) KCall.sync('listen'); } catch (e) {}
          if (convoOn) scheduleNextListen(350);   // 케이 목소리 끝 → 다음 말 듣기(연속 대화)
        });
        // O-0177: 조각 하나를 못 읽어도(주소 만료·네트워크) 멈추지 않고 다음 조각 → 없으면 다음 듣기
        kaiAudio.addEventListener('error', function () {
          if (!kaiAudio.src || kaiAudio.src.indexOf('data:') === 0) return;
          if (vqHasMore()) { setTimeout(vqPump, 120); return; }
          if (kaiQ.rid && convoOn && !vqWaiting()) scheduleNextListen(500);
        });
      } catch (e) {}
    }
    return kaiAudio;
  }
  function unlockKaiAudio() {
    var a = ensureKaiAudio(); if (!a || kaiAudioUnlocked) return;
    if (!a.paused && !a.ended && a.src && a.src.indexOf('data:') !== 0) return;   // O-0468: 케이 목소리가 나는 중이면 건드리지 않는다(무음을 끼워 넣으면 듣던 소리가 끊긴다 — 미리 붙은 소리를 듣다가 [보내기]·마이크를 누를 때)
    try {
      a.src = silentWav();
      var p = a.play();
      if (p && p.then) p.then(function () { try { a.pause(); a.currentTime = 0; } catch (e) {} kaiAudioUnlocked = true; }).catch(function () {});
      else kaiAudioUnlocked = true;
    } catch (e) {}
  }
  /* bubbleEl = 그 소리의 말풍선 [듣기] 단추(또는 그 말풍선의 lid 글자). 주면 그 단추가 「멈춤」으로 바뀐다(O-0468 — 상태는 lid 로 잡아 다시 그려도 유지). */
  function playKaiVoice(url, bubbleEl) {
    var a = ensureKaiAudio(); if (!a || !url) return;
    try {
      var lid = typeof bubbleEl === 'string' ? bubbleEl : ((bubbleEl && bubbleEl.getAttribute && bubbleEl.getAttribute('data-lid')) || '');
      var my = ++kaiPlaySeq, st = null;
      if (lid) st = listenSet(lid, 'play', false);
      else listenAudioEnd();                    // 말풍선 없는 소리(음성 대화 조각)가 대신 들어온다 → 앞 말풍선 단추는 되돌린다
      a.src = url; a.currentTime = 0;
      var p = a.play();
      if (p && p.then) p.catch(function () {
        if (st && listenSt === st) listenClear();
        if (my === kaiStopSeq) return;          // O-0468: [멈춤]으로 끊은 것 — 막힌 것이 아니다
        if (vqHasMore()) { setTimeout(vqPump, 150); return; }   // O-0177: 조각 하나가 막혀도 다음 조각으로
        if (convoOn && vqWaiting()) return;
        if (convoOn) scheduleNextListen(900);   // 자동재생 막혀도 대화 루프는 이어감
        else if (my === kaiPlaySeq) toast('🔊 소리를 들으려면 "듣기"를 눌러 주세요.');   // 다른 소리가 대신 들어온 것이면 안내하지 않는다
      });
    } catch (e) {}
  }

  /* ==================== O-0177 ① 케이 목소리 조각 차례 재생 ====================
   * PC(o0177_switch voice_stream 켜짐)가 케이 답의 첫 문장이 나오는 즉시 목소리 조각을 만들어,
   * 처리 중인 행의 summary_json.voice_parts=[{u,t}] 에 하나씩 붙인다(get_voice_memo 로 읽음 — 연동 토큰 그대로, 새 통로 없음).
   * 앱은 음성 대화로 답을 기다리는 동안 VC.POLL_FAST_MS 마다 확인해 새 조각을 차례로 이어 재생한다.
   * 답이 끝나면(done) 남은 조각까지 이어 재생하고, 다 끝나면 다음 듣기. 조각이 하나도 없으면 예전 voice_url 그대로.
   * 무대를 눌러 끊으면(TAP_CUT) 그 턴의 남은 조각은 버린다(m.vcut) — 답 글은 그대로 채팅에 남는다. */
  var kaiQ = { rid: null, list: [], next: 0, pre: [] };
  /* ---- O-0210 음성 턴의 폰 쪽 시각(측정용 — 화면·동작은 그대로) ----
   * 보낸 순간부터 잰 ms: sub=서버에 등록됨 · p1=첫 목소리 조각을 받음 · play=소리가 나기 시작 · done=답 전체를 받음.
   * 다음 음성 턴을 보낼 때 meta.vprev 로 실어 PC [지연] 로그에 「폰직전=」으로 남는다(글 내용 아님, 서버 호출 추가 없음).
   * 대화의 마지막 턴은 실어 보낼 다음 턴이 없어 남지 않는다. 옛 PC 응답기는 이 칸을 모르고 지나간다. */
  var vlat = null;
  function vlatStart(id) { vlat = { id: id, t0: Date.now(), sub: 0, p1: 0, play: 0, done: 0 }; }
  function vlatMark(id, k) { if (vlat && vlat.id === id && !vlat[k]) vlat[k] = Date.now(); }
  function vlatTake() {
    var v = vlat; if (!v || !v.sub) return null;
    function d(x) { return x ? Math.max(0, x - v.t0) : null; }
    return { id: String(v.id).slice(0, 8), sub: d(v.sub), p1: d(v.p1), play: d(v.play), done: d(v.done) };
  }
  function vqHasMore() { return !!(kaiQ.rid && kaiQ.next < kaiQ.list.length && convoOn); }
  function vqWaiting() {                         // 이 턴의 조각이 더 올 수 있음(아직 답이 안 끝남)
    if (!kaiQ.rid) return false;
    var m = findMsg(kaiQ.rid);
    return !!(m && !m.answered && !m.vcut);
  }
  function vqReset(rid) { kaiQ = { rid: rid || null, list: [], next: 0, pre: [] }; }
  function vqFeed(m, parts) {
    if (!m || m.vcut || !convoOn || !Array.isArray(parts)) return;
    if (kaiQ.rid !== m.id) vqReset(m.id);
    for (var i = kaiQ.list.length; i < parts.length; i++) {
      var u = parts[i] && (parts[i].u || parts[i].url);
      if (!u) continue;
      kaiQ.list.push(u);
      try { var pa = new Audio(); pa.preload = 'auto'; pa.src = u; kaiQ.pre.push(pa); } catch (e) {}   // 이어 재생 틈을 줄이려 미리 받아 둠
    }
    vqPump();
  }
  function vqPump() {
    // ⚠️ kaiPlaying() 은 currentTime>0 을 보므로 막 시작한 조각을 「안 나옴」으로 볼 수 있다 → paused 로 직접 확인(덮어쓰기 방지)
    if (!vqHasMore() || (kaiAudio && !kaiAudio.paused && !kaiAudio.ended)) return;
    var u = kaiQ.list[kaiQ.next++];
    setConvoStatus('케이가 말하는 중…');
    stageLive('');
    playKaiVoice(u, null);
  }
  function vqCut() {                              // 끊기: 지금 소리 멈추고 남은 조각·앞으로 올 조각 버림
    chatMsgs.forEach(function (m) { if (m.role === 'me' && !m.answered && m.id && m.token) m.vcut = true; });
    vqReset(null);
    try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {}
    try { if (window.KChar && KChar.voice && KChar.voice.speaking && KChar.voice.speaking()) KChar.voice.stop(); } catch (e) {}
    if (listenSt && listenSt.ph === 'play') listenClear();
  }

  function getChatThread() {
    try {
      var t = localStorage.getItem(CHAT_THREAD_KEY);
      if (!t) { t = 'th_' + OfficeBridge.token().slice(0, 14); localStorage.setItem(CHAT_THREAD_KEY, t); }
      return t;
    } catch (e) { return 'th_' + Math.random().toString(16).slice(2, 16); }
  }
  function loadChatMsgs() {
    try {
      var a = JSON.parse(localStorage.getItem(CHAT_MSGS_KEY) || '[]');
      a = a.filter(function (m) { return m && m.role !== 'typing'; });
      // 옛 형식(질문에 answered/id 없음)은 이미 지난 것으로 간주 → 무한 대기 방지
      a.forEach(function (m) { if (m.role === 'me' && m.answered === undefined) m.answered = true; });
      return a;
    } catch (e) { return []; }
  }
  function saveChatMsgs() {
    try {
      // ⚠️ cid·rid 를 반드시 함께 저장한다(2026-09-22 배지 버그 수정).
      //   cid = 다른 기기에서 온 대화 줄의 서버 행 id. 이게 저장 안 되면 앱 재시작 후 hasChatRow(cid)
      //   dedupe 가 전부 실패해, 부팅 때 도는 loadChatSync 가 「이미 본 대화」를 새 소식으로 다시 세어
      //   chatUnseen 이 부풀고 안 읽은 게 0인데도 배지가 계속 「9+」로 남았다. rid 는 삭제 tombstone(rowIdOf)용.
      var slim = chatMsgs.filter(function (m) { return m.role !== 'typing'; }).slice(-120)
        .map(function (m) { return m.role === 'me'
          ? { role: 'me', text: m.text, ts: m.ts, id: m.id, token: m.token, answered: !!m.answered, files: m.files || null, up: !!m.up, vin: !!m.vin, uid: m.uid || null, cid: m.cid || null, rid: m.rid || null, remote: !!m.remote, opus: !!m.opus, waitFrom: m.waitFrom || null, via: m.via || null, rq: m.rq || null, nosrv: !!m.nosrv, srv: !!m.srv, disp: m.disp || null }
          : { role: 'k', text: m.text, ts: m.ts, files: m.files || null, bid: m.bid || null, vurl: m.vurl || null, uid: m.uid || null, notice: !!m.notice, cid: m.cid || null, rid: m.rid || null, vtts: !!m.vtts, vplayed: !!m.vplayed, fe: m.fe || null }; });   // v8.3: vtts·vplayed
      localStorage.setItem(CHAT_MSGS_KEY, JSON.stringify(slim));
    } catch (e) {}
  }
  // 각 말풍선을 지목·삭제하기 위한 안정적 고유 id(없으면 만들어 준다)
  function msgUid(m) {
    if (!m.uid) m.uid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return m.uid;
  }
  // 대표님이 지운 케이 방송(bid) 무덤 — list_office_pushes가 다시 내려줘도 안 그리게
  function loadDeletedBids() {
    try { var a = JSON.parse(localStorage.getItem(DELETED_BIDS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveDeletedBids() {
    try { localStorage.setItem(DELETED_BIDS_KEY, JSON.stringify(deletedBids.slice(-1000))); } catch (e) {}
  }
  function isDeletedBid(bid) { return !!bid && deletedBids.indexOf(bid) !== -1; }
  // v4.0: 「전체 삭제」는 이 시각 이전 서버 대화/방송을 이 기기서 다시 안 그리게 하는 경계(로컬 뷰 정리).
  //   개별 삭제(deletedBids tombstone)와 달리, 갯수 제한 없이 옛 이력 전체를 한 번에 가린다.
  var CHAT_CLEARED_KEY = 'smart_chat_cleared_before';
  function getChatClearedBefore() { try { return localStorage.getItem(CHAT_CLEARED_KEY) || ''; } catch (e) { return ''; } }
  function isBeforeCleared(ts) { var c = getChatClearedBefore(); return !!c && !!ts && ts <= c; }
  // v4.2: 안읽음 배지 전용 '이미 본' 경계(시각). localStorage 에 epoch millis 로 굳혀 앱을 껐다 켜도 유지.
  //   ▷ 왜 필요한가(v4.1 cid/rid 영속화로도 +9 가 안 없어진 진짜 이유):
  //     · 배지 홍수의 주 출처는 「케이 방송」(건강문진·매시간알림·브리핑) = loadOfficePushes 경로다.
  //       이 경로 dedupe 는 hasBroadcast(bid) 인데, 앱 시작 시 chatMsgs 는 saveChatMsgs 가 남긴 최근
  //       120개뿐이라, 120개 밖으로 밀려난 옛 방송은 dedupe 를 못 타 매 재시작마다 새로 세어졌다.
  //     · v4.1 이 손댄 cid/rid 는 다른 경로(loadChatSync)용이고, 그마저도 같은 120개 윈도 한계가 있다.
  //   ▷ 해법: id(bid/cid) 대신 '시각'으로 판정한다. 이 경계 이하 ts 는 '이미 본 것'으로 보고 배지에서
  //     제외한다(대화 내용 표시는 그대로). 경계는 앞으로만 전진(단조 증가). 업데이트 첫 실행 때 '지금'을
  //     한 번 심어 두면, 그전에 쌓인 모든 방송·대화는 '본 것'이 되어 배지가 깨끗해진다(1회성 정리).
  var CHAT_SEEN_HW_KEY = 'smart_chat_seen_hw';
  function getSeenHW() { try { var v = localStorage.getItem(CHAT_SEEN_HW_KEY); var n = v ? parseInt(v, 10) : 0; return (n && !isNaN(n)) ? n : 0; } catch (e) { return 0; } }
  function setSeenHW(v) {
    var n = (typeof v === 'number') ? v : Date.parse(v);
    if (!n || isNaN(n)) return;
    try { var cur = getSeenHW(); if (n > cur) localStorage.setItem(CHAT_SEEN_HW_KEY, String(n)); } catch (e) {}
  }
  function isSeenTs(ts) { var h = getSeenHW(); if (!h) return false; var n = Date.parse(ts); return !!n && !isNaN(n) && n <= h; }
  /* ===================== (O-0201) 읽음 기준 기기 간 공유 =====================
   * 대표님: 「폰과 PC판이 한쪽에서 읽고 나면 공유해야 하는데, 오랜만에 PC판을 켜면 채팅에 숫자가 쌓여 있다」.
   * 원인: 위 '이미 본 경계'(smart_chat_seen_hw)가 기기마다 따로라, 폰에서 읽은 것을 PC판은 모른다.
   * 해법: 같은 경계를 서버 한 줄(k_read_state · 연동 암호 RPC)에도 두고 기기들이 함께 쓴다. 새 화면·버튼 없음.
   *  · 올리기(readNote): 채팅 화면을 「실제로 보고 있을 때」(readPresent) 그려진 메시지 중 서버가 매긴 시각이 가장 늦은 것.
   *      기기 시계(Date.now())는 올리지 않는다 → 시계가 다른 기기끼리도 안전. 서버는 더 클 때만 받아들인다(뒤로 안 감).
   *  · 받기(readPull): 앱 시작(방송·대화를 세기 '전에' 먼저) · 화면이 보이는 동안 30초마다 · 앱/홈 복귀 즉시(v7.7 조회에 얹음).
   *      받은 값이 이 기기 경계보다 늦으면 경계를 그만큼 당기고, 안읽음 수를 「그 뒤에 온 것」만으로 다시 센다(내려가기만 함).
   *  · 이 기기 경계 = 기기 자체 기준과 서버 기준 중 더 늦은 것(setSeenHW 가 큰 값만 받음) — 기기 자체 기준은 예전 그대로 둔다.
   *  · 서버 SQL 미적용(404)·암호 없음·통신 실패·오프라인 → 아무것도 하지 않음 = 예전(기기별 기준) 그대로(404 는 10분 뒤 다시 확인).
   *  · 옛 APK(v8.9 이하)는 이 RPC 를 모른다 → 그 기기는 예전처럼, 새 버전 기기끼리만 맞춘다.
   * 「실제로 보고 있다」 판정(readPresent):
   *  · 폰(APK): 화면이 켜져 있고 앱이 앞에 있을 때(폰은 안 보면 화면이 꺼진다).
   *  · PC판: 창이 보이고 + 이 창이 선택돼 있고 + 최근 5분 안에 마우스·키보드를 만졌을 때.
   *      24시간 켜 둔 PC에 채팅 화면이 떠 있기만 한 것은 「읽음」이 아니다(그러면 폰의 새 소식 표시가 전부 사라진다). */
  var READ_GATE_MS = 2500;         // 시작·정기 조회 때 서버 읽음 기준을 기다려 주는 한도(넘으면 예전처럼 먼저 진행)
  var READ_ACTIVE_MS = 5 * 60 * 1000;
  var readSrvMs = 0;               // 서버가 알려 준 읽음 기준(ms)
  var readLoadedMs = 0;            // 이 기기가 받아 온 메시지의 「서버 시각」 중 가장 늦은 것(ms) — 보고 있을 때 그려지면 읽음 후보
  var readCandMs = 0;              // 서버에 올릴 후보(ms)
  var readActAt = 0;               // (PC판) 마지막으로 마우스·키보드를 만진 때
  var READ_RETRY_MS = 10 * 60 * 1000;   // 서버에 함수가 없다고(404) 나오면 10분 쉬었다 다시 물어본다(SQL 적용·되돌림과 앱 실행 순서가 엇갈려도 스스로 맞춰짐)
  var readMissAt = 0, readPulling = false, readPullAt = 0, readPushing = false, readPushT = 0, readFailAt = 0;
  function readNative() { try { var C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } }
  // 「at 으로부터 ms 안쪽인가」 — 기기 시계가 뒤로 맞춰져(자동 시각 보정 등) 차이가 음수가 되면 '안쪽 아님'으로 본다(쉬는 시간이 끝없이 늘어나지 않게).
  function readWithin(at, ms) { var d = Date.now() - at; return !!at && d >= 0 && d < ms; }
  function readSyncOn() { return !!(!readWithin(readMissAt, READ_RETRY_MS) && window.OfficeBridge && OfficeBridge.getChatRead && OfficeBridge.markChatRead && getSyncPass()); }
  function readTsMs(ts) { if (typeof ts === 'number') return ts > 0 ? ts : 0; var n = ts ? Date.parse(ts) : NaN; return isNaN(n) ? 0 : n; }
  function readLoaded(ts) { var ms = readTsMs(ts); if (ms > readLoadedMs) readLoadedMs = ms; }
  function readPresent() {
    if (document.hidden || liveAppActive === false) return false;
    if (readNative()) return true;
    var focus = true; try { if (document.hasFocus) focus = document.hasFocus(); } catch (e) {}
    return focus && readWithin(readActAt, READ_ACTIVE_MS);
  }
  // 경계(hw) 뒤에 온 안읽음 수 — 서버에 있는 케이 말풍선(방송·답) 1건씩 + 아직 답이 없는 다른 기기 질문. 알림(notice)은 예전처럼 제외.
  //   · 시각은 서버가 매긴 것으로 잰다: 방송·다른 기기 대화는 ts 가 곧 서버 시각, 이 기기에서 묻고 받은 답은 sts(readStampOwn 이 달아 줌, 없으면 도착 시각).
  //   · 이 기기에만 있는 안내 말풍선(「전송이 안 됐어요」 등 — 서버 행 없음)은 세지 않는다(다른 기기에서 읽을 수 없는 것이라 숫자가 안 내려가게 된다).
  function chatUnreadAfter(hw) {
    var n = 0, kc = {}, i, m;
    for (i = 0; i < chatMsgs.length; i++) { m = chatMsgs[i]; if (m && m.role === 'k' && m.cid) kc[m.cid] = 1; }
    for (i = 0; i < chatMsgs.length; i++) {
      m = chatMsgs[i];
      if (!m || m.notice || (m.sts || m.ts || 0) <= hw) continue;
      if (m.role === 'k') { if (m.bid || m.cid || m.rid) n++; }
      else if (m.role === 'me' && m.remote && !(m.cid && kc[m.cid])) n++;
    }
    return n;
  }
  // 지금 경계 기준으로 안읽음을 다시 세어, 줄었으면 반영한다. 숫자는 「내려가기만」 한다(서버 기준 때문에 안읽음이 새로 생기지 않게).
  function readRecount() {
    var n = chatUnreadAfter(getSeenHW());
    if (n < chatUnseen) { chatUnseen = n; updateChatBadge(); }   // 홈 케이 말풍선·바탕화면 위젯까지 함께 내려간다
  }
  // 이 기기에서 묻고 받은 답은 「도착한 때의 기기 시계」로 적혀 있다 → 서버가 그 대화 줄에 매긴 시각(row.ts)을 sts 로 달아 둔다.
  //   (대화 동기화가 이 기기 것이라 건너뛰는 줄에서 부른다. 달라진 것이 있으면 true)
  function readStampOwn(row, own) {
    var ms = readTsMs(row.ts), m = own[row.id];
    if (!ms || !m || m.sts === ms) return false;
    m.sts = ms; return true;
  }
  function readOwnAnswers() {                      // 이 기기에서 물은 질문의 행 id → 그 답 말풍선
    var o = {}, i, m;
    for (i = 0; i < chatMsgs.length; i++) { m = chatMsgs[i]; if (m && m.role === 'k' && m.rid && !m.cid && !m.bid) o[m.rid] = m; }
    return o;
  }
  // 서버 읽음 기준을 이 기기에 반영.
  function readApply(iso) {
    var ms = readTsMs(iso); if (!ms) return;
    if (ms > readSrvMs) readSrvMs = ms;
    if (ms <= getSeenHW()) return;
    setSeenHW(ms);
    if (getSeenHW() < ms) return;                  // 저장 실패(사생활 보호 창 등) → 손대지 않음(예전 동작)
    readRecount();
  }
  function readNote(ts) {                          // 부르는 쪽이 「채팅을 보고 있음」(readPresent)을 확인한 뒤 부른다
    var ms = readTsMs(ts); if (!ms) return;
    if (ms > readCandMs) readCandMs = ms;
    readPushSoon();
  }
  function readPushSoon() {
    if (readPushT || !readSyncOn() || readCandMs <= readSrvMs) return;
    readPushT = setTimeout(function () { readPushT = 0; readPush(); }, 1200);   // 잇달아 오는 메시지는 한 번에 올림
  }
  function readPush() {
    if (readPushing || !readSyncOn() || readCandMs <= readSrvMs) return;
    if (readWithin(readFailAt, 20000)) return;     // 방금 실패했으면 20초 쉼(다음 정기 조회 때 다시)
    readPushing = true;
    var sent = readCandMs;
    OfficeBridge.markChatRead(new Date(sent).toISOString(), getSyncPass(), readNative() ? 'phone' : 'pc').then(function (d) {
      readPushing = false;
      if (d && d.seen_upto) readApply(d.seen_upto);
      if (readSrvMs < sent && readCandMs <= sent) readCandMs = readSrvMs;   // 서버가 값을 깎았으면 그 후보는 버림(되풀이 전송 방지)
      if (readCandMs > readSrvMs) readPushSoon();  // 그사이 더 읽었으면 이어서
    }).catch(function (e) {
      readPushing = false;
      if (e && e.notready) readMissAt = Date.now();   // 서버 SQL 미적용 → 예전 방식(10분 뒤 다시 확인)
      else readFailAt = Date.now();                // 인터넷 끊김·암호 문제 등 → 후보는 그대로 두고 나중에 다시
    });
  }
  // done 이 있으면 서버 값을 받은 뒤(늦으면 READ_GATE_MS 뒤) 꼭 한 번 부른다 — 방송·대화를 세기 「전에」 기준부터 맞추려는 용도.
  function readPull(done) {
    var fin = function () { if (done) { var d = done; done = null; d(); } };
    if (!readSyncOn()) { fin(); return; }
    if (readPulling && readWithin(readPullAt, 20000)) { fin(); return; }
    readPulling = true; readPullAt = Date.now();
    var cap = done ? setTimeout(fin, READ_GATE_MS) : 0;
    OfficeBridge.getChatRead(getSyncPass()).then(function (d) {
      readPulling = false; if (cap) clearTimeout(cap);
      if (d && d.seen_upto) readApply(d.seen_upto);
      fin();
      readPushSoon();                              // 올리지 못하고 남은 후보가 있으면 이어서
    }).catch(function (e) {
      readPulling = false; if (cap) clearTimeout(cap);
      if (e && e.notready) readMissAt = Date.now();
      fin();
    });
  }
  // (PC판) 마우스·키보드를 만지면 「보고 있음」. 그때 채팅이 열려 있고 아직 올리지 않은 것이 있으면 올린다.
  function readActivity() {
    readActAt = Date.now();
    if (readLoadedMs > readCandMs && readLoadedMs > readSrvMs && isOpen(chatView) && !chatSearchOn && readPresent()) readNote(readLoadedMs);
  }
  try {
    ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, readActivity, { passive: true }); });
  } catch (e) {}
  /* ---- 채팅 첨부 파일 유틸(업로드·다운로드 공용 렌더) ---- */
  function fmtBytes(b) { b = b || 0; if (b < 1024) return b + 'B'; if (b < 1024 * 1024) return Math.round(b / 1024) + 'KB'; return (Math.round(b / 1024 / 1024 * 10) / 10) + 'MB'; }
  function fileKindOf(mime, name) {
    var m = (mime || '').toLowerCase(), n = (name || '').toLowerCase();
    if (/^image\//.test(m) || /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(n)) return 'image';
    if (/^video\//.test(m) || /\.(mp4|mov|avi|mkv|webm|m4v|3gp)$/.test(n)) return 'video';
    return 'document';
  }
  function attachIcon(f) { var k = f.kind || fileKindOf(f.mime, f.name); return k === 'image' ? 'i-image' : k === 'video' ? 'i-video' : 'i-note'; }
  var DOC_VIEW_EXTS = ['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];
  function isViewableDoc(f) {
    if (!f || !f.url) return false;
    var k = f.kind || fileKindOf(f.mime, f.name);
    if (k === 'image' || k === 'video') return false;
    var ext = ((String(f.name || '').split('.').pop()) || '').toLowerCase();
    if (DOC_VIEW_EXTS.indexOf(ext) !== -1) return true;
    return /pdf|word|excel|spreadsheet|presentation|officedocument|hwp/i.test(f.mime || '');
  }
  /* (O-0217) 길 안내 칩 — 케이가 「○○까지 길 안내」에 답하며 붙인 목적지. 누르면 네이버 지도(today-card.js openRoute).
   *   좌표가 있으면 [대중교통]·[도보]·[자동차] 세 갈래로 바로 길찾기, 없으면 [네이버 지도에서 찾기] 하나(도착 → 길찾기 한 번 더). */
  var NAV_LABEL = { 'public': '대중교통', 'walk': '도보', 'car': '자동차' };
  function navChip(f) {
    var n = f.nav, data = ' data-nav="' + esc(JSON.stringify(n)) + '"';
    var title = '<svg><use href="#i-route"/></svg><span class="an">' + esc((n.name || n.dest) + ' 길찾기') + '</span>';
    var html;
    if (n.lat != null && n.lng != null) {
      // 장소 이름표(누르는 곳 아님) + 세 갈래 버튼 — 같은 일을 하는 버튼을 둘 두지 않는다(기능 중복 금지)
      html = '<div class="attach navtitle">' + title + '</div>' +
        '<div class="navmodes">' + ['public', 'walk', 'car'].map(function (k) {
          return '<button type="button" class="attach-dl navgo' + (k === (n.mode || 'public') ? ' on' : '') + '"' + data +
            ' data-nav-mode="' + k + '">' + NAV_LABEL[k] + '</button>';
        }).join('') + '</div>' +
        (n.addr ? '<small class="navhint">' + esc(n.addr) + ' — 장소가 맞는지 확인하고 출발하세요</small>' : '');
    } else {
      html = '<button type="button" class="attach navgo"' + data + ' data-nav-mode="">' + title + '<span class="asz">네이버 지도</span></button>' +
        '<small class="navhint">지도에서 장소를 고른 뒤 [도착] → 길찾기를 누르세요</small>';
    }
    return '<div class="attachitem navitem">' + html + '</div>';
  }
  function navChipClick(ev) {
    var b = ev.target.closest ? ev.target.closest('.navgo[data-nav]') : null;
    if (!b) return false;
    var nav = null;
    try { nav = JSON.parse(b.getAttribute('data-nav') || 'null'); } catch (e) {}
    if (!nav || !window.TodayCard || !TodayCard.openRoute) { toast('지도를 열지 못했습니다 — 다시 눌러 주세요.'); return true; }
    TodayCard.openRoute(nav, b.getAttribute('data-nav-mode') || '');
    return true;
  }
  function attachChips(files, isUp) {
    if (!files || !files.length) return '';
    return '<div class="attachlist">' + files.map(function (f) {
      if (f && f.kind === 'nav' && f.nav) return navChip(f);    // (O-0217) 케이 답의 길 안내 칩
      var sz = f.size ? '<span class="asz">' + esc(fmtBytes(f.size)) + '</span>' : '';
      var attrs = (!isUp && f.url) ? (' data-att-url="' + esc(f.url) + '" data-att-name="' + esc(f.name || '파일') + '"') : ' disabled';   // 이름: v7.9 폰에서 칩을 눌렀을 때 저장으로 보낼지 판정
      var chip = '<button type="button" class="attach' + (isUp ? ' up' : '') + '"' + attrs + '>' +
        '<svg><use href="#' + attachIcon(f) + '"/></svg><span class="an">' + esc(f.name || '파일') + '</span>' + sz + '</button>';
      // 케이가 보낸 문서(하향)면 [뷰어로 보기] 버튼을 함께 — 폰에서 PC와 똑같이 열람
      if (!isUp && isViewableDoc(f)) {
        chip += '<button type="button" class="attach-view" data-view-url="' + esc(f.url) +
          '" data-view-name="' + esc(f.name || '문서') + '" data-view-mime="' + esc(f.mime || '') + '">' +
          '<svg><use href="#i-doc"/></svg>뷰어로 보기</button>';
      }
      // 받은 파일(url 있음)이면 [다운로드] — 기기 다운로드 폴더로 저장(안드로이드·PC 공용, 2026-09-21)
      if (!isUp && f.url) {
        chip += '<button type="button" class="attach-dl" data-dl-url="' + esc(f.url) +
          '" data-dl-name="' + esc(f.name || '파일') + '">⬇ 다운로드</button>';
      }
      return '<div class="attachitem">' + chip + '</div>';
    }).join('') + '</div>';
  }
  /* 첨부 파일을 기기 다운로드 폴더로 저장(채팅·공유함 공용 · 2026-09-21).
   * fetch → Blob → <a download> 방식: PC(PWA)는 곧장 다운로드 폴더에 저장되고,
   * 안드로이드(Capacitor WebView)는 blob 다운로드를 WebView 가 받아 다운로드 폴더에 저장한다.
   * CORS 등으로 fetch 가 막히면 새 탭으로 열어(브라우저에서 저장) 최소한 파일에 닿게 한다(폴백). */
  // v6.3: 저장 파일명 — 원래 이름을 그대로 쓰되 윈도·안드로이드가 못 쓰는 글자(\ / : * ? " < > | 제어문자)만 '_'로,
  //   끝의 점·공백 제거, 너무 길면 확장자를 살리고 앞부분을 줄인다(한글·공백·괄호·대괄호·이모지는 그대로).
  function safeDownloadName(name) {
    var n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
    if (!n) n = 'download';
    if (n.length > 150) {
      var dot = n.lastIndexOf('.'), ext = (dot > 0 && n.length - dot <= 10) ? n.slice(dot) : '';
      n = n.slice(0, 150 - ext.length) + ext;
    }
    return n;
  }
  /* v6.7(2026-09-29, O-0088): 폰(네이티브 앱)에서는 blob 방식이 실제 파일을 만들지 못한다.
   *   안드로이드 WebView 에는 <a download href="blob:"> 를 받아 줄 다운로드 처리기가 없어서, 예전엔
   *   "다운로드 폴더에 저장했어요"만 뜨고 파일은 없었다(거짓 성공). → 폰은 네이티브 FileDownload 플러그인
   *   (안드로이드 DownloadManager)으로 받는다: 실제 「다운로드」 폴더에 저장 · 저장 확인 뒤에만 성공 안내 ·
   *   APK 는 바로 설치 화면 · 실패하면 ① 웹페이지(브라우저)로 받기로 자동 전환. PC판(크롬)은 예전 그대로. */
  var APK_MIME = 'application/vnd.android.package-archive';
  var dlBusy = {};                 // 같은 파일 연타 방지(받는 중이면 한 번만)
  var dlProgHooked = false;
  var dlPendingInstall = null;     // 「이 출처 허용」 켜러 설정에 간 APK 다운로드 id — 앱으로 돌아오면 설치 화면을 다시 연다
  function isNativeApp() {
    var C = window.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  }
  // ① 웹페이지로 받기(브라우저로 넘김) — 공유함(공개 버킷) 주소면 ?download=원래이름 → 서버가 원래 이름으로 내려준다(v6.3)
  function openInBrowserForDownload(url, fname) {
    var fu = url;
    if (url.indexOf('/storage/v1/object/public/') !== -1 && !/[?&]download=/.test(url)) fu = url + (url.indexOf('?') === -1 ? '?' : '&') + 'download=' + encodeURIComponent(fname);
    return !!window.open(fu, '_blank');
  }
  function nativeDownload(url, fname) {
    var FD = window.Capacitor.Plugins && window.Capacitor.Plugins.FileDownload;
    if (!FD) {                                     // 플러그인 없는 옛 빌드 → 웹페이지로 받기
      toast(openInBrowserForDownload(url, fname) ? '웹페이지로 연결했습니다 — 거기서 받아 주세요.' : '다운로드에 실패했습니다 — 다시 눌러 주세요.', 4000);
      return;
    }
    if (dlBusy[url]) { toast('이미 받는 중입니다 — 알림창에서 진행을 볼 수 있습니다.', 3000); return; }
    dlBusy[url] = true;
    if (!dlProgHooked && FD.addListener) {
      dlProgHooked = true;
      try { FD.addListener('progress', function (p) { if (p && p.pct != null) toast('다운로드 중… ' + p.pct + '% (' + (p.name || '') + ')'); }); } catch (e) {}
    }
    var isApk = /\.apk$/i.test(fname);
    toast('다운로드 중… (' + fname + ')', 3000);
    FD.download({ url: url, name: fname, open: true }).then(function (r) {
      delete dlBusy[url];
      var saved = (r && r.name) || fname, how = r && r.open;
      if (how === 'need_permission') {             // 처음 한 번: 스마트비서에 「이 출처 허용」이 꺼져 있음 → 설정 화면이 열려 있다
        dlPendingInstall = r.id;
        toast('다운로드 폴더에 저장했습니다(' + saved + '). 설치하려면 「이 출처 허용」을 켜고 돌아오세요 — 설치 화면을 바로 열어 드리겠습니다.', 7000);
      } else if (how === 'opened') {
        toast('다운로드 폴더에 저장했습니다(' + saved + ')' + (isApk ? ' — 설치 화면을 열었습니다.' : '.'), 4000);
      } else {
        toast('다운로드 폴더에 저장했습니다(' + saved + '). 「내 파일 › 다운로드」에서 열어 주세요.', 5000);
      }
    }).catch(function (e) {
      delete dlBusy[url];
      if (e && e.code === 'CANCELLED') { toast('다운로드를 취소했습니다.'); return; }
      // 앱 저장이 안 되면 ① 웹페이지로 받기로 자동 전환(서버 파일은 그대로라 브라우저로는 받아진다)
      //   v7.9: 왜 안 됐는지도 함께 알린다(예전엔 사유를 버렸다).
      var why = dlFailReason(e);
      toast(openInBrowserForDownload(url, fname) ? why + ' — 웹페이지로 연결했습니다. 거기서 받아 주세요.' : why + ' — 다시 눌러 주세요.', 8000);
    });
  }
  // 설정에서 「이 출처 허용」을 켜고 앱으로 돌아오면 → 받아 둔 APK 설치 화면을 한 번 더 연다(다시 받지 않음)
  function retryPendingInstall() {
    if (dlPendingInstall == null) return;
    var FD = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FileDownload;
    var id = dlPendingInstall; dlPendingInstall = null;
    if (!FD || !FD.open) return;
    FD.open({ id: String(id), mime: APK_MIME, askPermission: false }).then(function (r) {
      if (r && r.open === 'opened') toast('설치 화면을 열었습니다.', 3000);
      else if (r && r.open === 'need_permission') toast('「이 출처 허용」이 아직 꺼져 있습니다. 켠 뒤 [⬇ 다운로드]를 다시 눌러 주세요(파일은 다운로드 폴더에 있습니다).', 7000);
      else toast('파일은 다운로드 폴더에 있습니다 — 「내 파일 › 다운로드」에서 눌러 설치해 주세요.', 6000);
    }).catch(function () {});
  }
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    try { window.Capacitor.Plugins.App.addListener('appStateChange', function (st) { if (st && st.isActive) setTimeout(retryPendingInstall, 400); }); } catch (e) {}
  }
  /* v7.9 파일 이름 칩(누르면 여는 쪽) — 폰에서는 브라우저가 바로 보여 줄 수 있는 것(사진·영상·PDF·글·소리)만
   *   예전처럼 열고, 그 밖(APK·압축·한글·오피스 등)은 [⬇ 다운로드]와 같은 네이티브 저장으로 보낸다.
   *   예전엔 칩이 전부 크롬으로 넘어가 APK 가 「유해 파일」 확인·크롬의 별도 출처 허용에 걸렸다(앱 저장은 [⬇ 다운로드]만 탔다).
   *   PC판(크롬·PWA)은 예전 그대로 연다. */
  var CHIP_OPEN_EXTS = ['pdf', 'txt', 'mp3', 'm4a', 'wav', 'ogg'];
  function openAttachmentChip(url, name) {
    if (!url) return;
    if (isNativeApp() && name) {
      var ext = ((String(name).split('.').pop()) || '').toLowerCase();
      if (fileKindOf('', name) === 'document' && CHIP_OPEN_EXTS.indexOf(ext) === -1) { downloadAttachment(url, name); return; }
    }
    var w = window.open(url, '_blank');
    if (!w) toast('파일을 열지 못했습니다 — 다시 눌러 주세요.');
  }
  // v7.9 네이티브 저장 실패 사유(FileDownloadPlugin 의 오류 코드) → 쉬운 말. 괄호 안 코드는 소장에게 알려 줄 때 쓴다.
  //   FAILED_n 의 n = 안드로이드 DownloadManager 사유(1000번대) 또는 서버 응답 번호(HTTP), WAITING_n = 시작 전 대기 사유.
  function dlFailReason(e) {
    var code = String((e && e.code) || ''), m, n, why;
    if ((m = /^FAILED_(\d+)$/.exec(code))) {
      n = +m[1];
      why = n === 1006 ? '폰 저장 공간이 부족합니다'
        : (n === 1001 || n === 1007 || n === 1009) ? '폰에 파일을 쓰지 못했습니다'
        : (n === 1004 || n === 1008) ? '받는 중에 인터넷이 끊겼습니다'
        : (n === 403 || n === 400 || n === 404 || n === 410) ? '파일 주소가 만료됐거나 서버에 파일이 없습니다'
        : (n >= 500 && n < 600) ? '서버가 잠시 응답하지 않습니다'
        : '받는 중에 문제가 생겼습니다';
    } else if ((m = /^WAITING_(\d+)$/.exec(code))) {
      n = +m[1];
      why = n === 2 ? '인터넷 연결을 기다리다 시작하지 못했습니다'
        : n === 3 ? '큰 파일이라 폰이 와이파이를 기다리다 시작하지 못했습니다'
        : '폰이 다운로드를 시작하지 못하고 대기만 했습니다';
    } else {
      why = code === 'STALLED' ? '받다가 2분 넘게 멈춰 있었습니다'
        : code === 'INCOMPLETE' ? '파일이 끝까지 받아지지 않았습니다'
        : code === 'BAD_URL' ? '파일 주소가 올바르지 않습니다'
        : (code === 'NO_DM' || code === 'ENQUEUE_FAIL') ? '폰이 다운로드를 시작하지 못했습니다'
        : code === 'QUERY_FAIL' ? '다운로드 상태를 확인하지 못했습니다'
        : '앱에서 저장하지 못했습니다';
    }
    return why + (code ? '(' + code + ')' : '');
  }
  function downloadAttachment(url, name) {
    if (!url) return;
    var fname = safeDownloadName(name || (url.split('/').pop().split('?')[0]) || 'download');
    if (isNativeApp()) { nativeDownload(url, fname); return; }   // v6.7: 폰 = 네이티브 저장
    // ↓ PC판(크롬·PWA) — 예전 방식 그대로(fetch → Blob → <a download>, 크롬은 실제로 다운로드 폴더에 저장됨)
    toast('다운로드 중…');
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (blob) {
        var bu = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = bu; a.download = fname; a.rel = 'noopener';
        document.body.appendChild(a); a.click();
        setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(bu); } catch (e) {} }, 5000);
        toast('다운로드 폴더에 저장했습니다.');
      })
      .catch(function () {
        // 폴백: 브라우저로 열어 저장(공유함 공개 주소면 원래 이름으로 — openInBrowserForDownload)
        var w = openInBrowserForDownload(url, fname);
        toast(w ? '브라우저에서 저장해 주세요.' : '다운로드에 실패했습니다 — 다시 눌러 주세요.');
      });
  }
  function anyAwaiting() { return chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token; }); }
  // 이스케이프된 문자열에서 http/https URL을 파랑+밑줄 링크로. data-link엔 원래 URL(&amp;→&) 보관.
  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}"'])/g, function (m) {
      var raw = m.replace(/&amp;/g, '&').replace(/"/g, '%22');
      return '<a class="chatlink" data-link="' + raw + '" target="_blank" rel="noopener">' + m + '</a>';
    });
  }
  function chatText(s) {
    return linkify(esc(s))
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')   // **강조** → 굵게
      .replace(/\n/g, '<br>');
  }
  /* ---- 클립보드 복사(전체 복사) ---- */
  function copyToClipboard(text) {
    text = String(text == null ? '' : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('복사됐습니다.'); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta); toast(ok ? '복사됐습니다.' : '복사하지 못했습니다. 글자를 길게 눌러 직접 복사해 주세요.');
    } catch (e) { toast('복사하지 못했습니다. 글자를 길게 눌러 직접 복사해 주세요.'); }
  }
  // 말풍선 하나를 통째로 복사할 텍스트(본문 + 첨부 이름·링크)
  function msgCopyText(m) {
    var parts = [];
    if (m.text) parts.push(m.text);
    if (m.files && m.files.length) m.files.forEach(function (f) { parts.push((f.name || '파일') + (f.url ? (' ' + f.url) : '')); });
    if (!parts.length && m.vin) parts.push('(음성 메시지)');
    return parts.join('\n');
  }
  function chatScrollBottom() {
    // chatLog는 자체 높이 제약이 없어 실제로는 window(문서)가 스크롤된다 →
    // chatLog.scrollTop과 window 스크롤을 함께 맨 아래로 내린다(포커스는 건드리지 않음).
    var token = ++chatScrollSeq;                 // v5.9: 뒤늦게 도는 다른 스크롤 예약(새 메시지 위치 등)과 겹치지 않게
    function doScroll() {
      if (token !== chatScrollSeq) return;
      if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
      try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}
    }
    // 레이아웃이 아직 반영되지 않았을 수 있어 한 프레임 뒤 실행 + 짧은 지연으로 한 번 더(이미지·첨부 등 늦게 커지는 콘텐츠 대비)
    requestAnimationFrame(function () { requestAnimationFrame(doScroll); });
    setTimeout(doScroll, 80);
  }
  /* ===================== v5.9 채팅 열림 위치 — 「새 메시지의 시작」에서 열기 (2026-09-25) =====================
   * 대표님 말씀: 새 메시지가 오면 그 메시지가 시작하는 위치에서 열려야 하는데 무조건 맨 아래에서 열려,
   *   다시 위로 올려 확인해야 하는 불편.
   * ▷ 안읽음 기준은 새로 만들지 않고 기존 '이미 본 경계'(smart_chat_seen_hw, getSeenHW)를 그대로 쓴다.
   *   채팅을 열 때(또는 앱으로 돌아올 때) 그 경계를 먼저 붙잡아 두고(chatAnchorHW), 그보다 늦게 온
   *   케이 말풍선·다른 기기에서 온 대화 중 첫 번째를 화면 위쪽(고정 헤더 바로 아래)에 맞춘다.
   *   알림(notice) 메시지는 안읽음 카운트에서 빠져 있으므로 여기서도 제외(기존 판정 유지).
   * ▷ 안 읽은 게 없으면 예전처럼 맨 아래.
   * ▷ 열고 나서 몇 초 동안(CHAT_ANCHOR_MS)은 서버 재구성·작업카드 갱신 등으로 다시 그려져도 같은 위치를
   *   다시 맞춘다. 대표님이 손으로 스크롤하면(터치·휠·키) 그 즉시 자동 맞춤을 멈춘다.
   * ▷ 보고 있는 중에 새 메시지가 오면: 맨 아래 근처였으면 새 메시지의 '시작'으로 부드럽게 이동,
   *   위로 올려 읽는 중이면 보던 말풍선 위치를 그대로 지킨다. 내가 보낸 직후엔 예전처럼 맨 아래.
   * ▷ 말풍선은 content-visibility:auto 라 화면 밖 높이가 추정값(52px)이다 → 한 번에 안 맞을 수 있어
   *   rAF·짧은 지연으로 몇 차례 재보정한다. */
  var CHAT_ANCHOR_MS = 5000;
  var chatScrollSeq = 0;           // 스크롤 예약 번호 — 새 예약이 오면 옛 예약(재보정)은 알아서 멈춘다
  var chatAnchorHW = 0;            // 열 때 붙잡은 '이미 본 경계'(epoch ms). 0이면 앵커 모드 아님
  var chatAnchorUntil = 0;         // 앵커 모드 유지 기한
  var chatAnchorArmedAt = 0;
  var chatAnchorKind = '';         // 'open'(열기·알림 탭) | 'resume'(앱 복귀)
  var chatNewDivUid = '';          // 「여기부터 새 메시지」 구분선을 붙일 말풍선 uid(이번 열람 동안 유지)
  var chatRenderedUids = null;     // 직전 렌더에 있던 말풍선 uid 맵(null=기준 없음 → 새 메시지 판정 안 함)
  var chatUserTouchAt = 0;         // 대표님이 마지막으로 직접 스크롤을 시작한 시각
  function markChatUserScroll() { chatUserTouchAt = Date.now(); }
  try {
    window.addEventListener('touchstart', markChatUserScroll, { passive: true });
    window.addEventListener('wheel', markChatUserScroll, { passive: true });
    window.addEventListener('mousedown', markChatUserScroll, { passive: true });   // PC: 스크롤바 끌기
    window.addEventListener('keydown', function (e) {
      var k = e && e.key;
      if (k === 'PageUp' || k === 'PageDown' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'Home' || k === 'End') markChatUserScroll();
    });
  } catch (e) {}
  function armChatAnchor(kind, hw) {
    // 알림 탭(open)과 앱 복귀(resume)는 거의 동시에 온다(순서 일정치 않음) → 이미 잡힌 앵커가 살아 있으면 더 이른 경계를 쓰고, 열기 쪽을 우선
    if (chatAnchorActive()) {
      if (chatAnchorHW && (!hw || chatAnchorHW < hw)) hw = chatAnchorHW;
      if (chatAnchorKind === 'open') kind = 'open';
    }
    chatAnchorKind = kind; chatAnchorHW = hw || 0;
    chatAnchorArmedAt = Date.now(); chatAnchorUntil = chatAnchorHW ? chatAnchorArmedAt + CHAT_ANCHOR_MS : 0;
    // 새 열람이면 옛 구분선·렌더 기준을 지운다(복귀는 보던 화면을 이어 가므로 그대로 두고, 새 안읽음이 있을 때만 구분선을 옮김)
    if (kind === 'open') { chatNewDivUid = ''; chatRenderedUids = null; }
  }
  function chatAnchorActive() {
    if (!chatAnchorHW || Date.now() > chatAnchorUntil) return false;
    if (chatUserTouchAt > chatAnchorArmedAt) { chatAnchorUntil = 0; return false; }   // 손으로 움직였으면 끝
    return true;
  }
  function isIncomingMsg(m) { return m.role === 'k' || (m.role === 'me' && !!m.remote); }
  function isUnreadSince(m, hw) { return !!hw && isIncomingMsg(m) && !m.notice && (m.ts || 0) > hw; }
  // (O-0124) 음성 대화 무대가 켜진 동안은 화면이 한 장으로 고정되고 대화 글만 chatLog 상자 안에서 스크롤된다
  //   (평소엔 지금처럼 window 가 스크롤). 아래 스크롤 도우미들은 이 한 가지만 갈라서 처리한다.
  function chatBoxMode() { return !!(chatView && chatLog && chatView.classList.contains('convo-on')); }
  function chatScrollByY(dy, smooth) {
    if (chatBoxMode()) {
      var t = Math.max(0, chatLog.scrollTop + dy);
      try { if (smooth && chatLog.scrollTo) chatLog.scrollTo({ top: t, behavior: 'smooth' }); else chatLog.scrollTop = t; }
      catch (e) { chatLog.scrollTop = t; }
      return;
    }
    var y = Math.max(0, (window.pageYOffset || 0) + dy);
    try { if (smooth) window.scrollTo({ top: y, behavior: 'smooth' }); else window.scrollTo(0, y); }
    catch (e) { try { window.scrollTo(0, y); } catch (e2) {} }
  }
  // 고정 헤더(.subbar, sticky) 아래로 말풍선 시작이 오도록 하는 위쪽 여백
  function chatHeadOffset() {
    if (chatBoxMode()) { try { return chatLog.getBoundingClientRect().top + 8; } catch (e) {} }   // (O-0124) 무대 아래 대화 상자 맨 위
    var h = 0;
    try {
      var sb = chatView && chatView.querySelector('.subbar');
      if (sb) h = (parseFloat(getComputedStyle(sb).top) || 0) + sb.offsetHeight;
    } catch (e) {}
    return h + 8;
  }
  function chatNearBottom() {
    if (chatBoxMode()) return (chatLog.scrollHeight - (chatLog.scrollTop + chatLog.clientHeight)) < 160;   // (O-0124)
    try {
      var de = document.documentElement;
      var y = window.pageYOffset || de.scrollTop || 0;
      return (Math.max(de.scrollHeight, document.body.scrollHeight) - (y + window.innerHeight)) < 160;
    } catch (e) { return true; }
  }
  // uid 말풍선(바로 위에 구분선이 있으면 구분선)의 시작을 헤더 아래에 맞춘다
  function chatScrollToUid(uid, smooth) {
    var token = ++chatScrollSeq, started = Date.now();
    function target() {
      var el = chatLog && chatLog.querySelector('[data-uid="' + uid + '"]');
      if (!el) return null;
      var row = el.closest ? el.closest('.krow') : null; if (row) el = row;   // v6.0: 케이 말풍선은 아바타 줄(krow) 기준
      var prev = el.previousElementSibling;
      return (prev && prev.classList && prev.classList.contains('chatnewdiv')) ? prev : el;
    }
    function go(sm) {
      if (token !== chatScrollSeq || chatUserTouchAt > started) return;
      var el = target(); if (!el) return;
      var dy = el.getBoundingClientRect().top - chatHeadOffset();
      if (Math.abs(dy) < 2) return;
      chatScrollByY(dy, sm);                      // (O-0124) 평소=window · 음성 대화 무대=대화 상자
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { go(!!smooth); }); });
    if (smooth) setTimeout(function () { go(false); }, 700);   // 부드러운 이동이 끝난 뒤 한 번만 보정
    else { setTimeout(function () { go(false); }, 80); setTimeout(function () { go(false); }, 250); setTimeout(function () { go(false); }, 600); }
  }
  // 위로 올려 읽는 중: 다시 그리기 전 보던 말풍선의 화면 위치를 기억했다가 그대로 되돌린다
  function chatCaptureView() {
    try {
      var off = chatHeadOffset(), bs = chatLog.querySelectorAll('.bubble[data-uid]');
      for (var i = 0; i < bs.length; i++) {
        var r = bs[i].getBoundingClientRect();
        if (r.bottom > off) return { uid: bs[i].getAttribute('data-uid'), top: r.top };
      }
    } catch (e) {}
    return null;
  }
  function chatRestoreView(v) {
    var token = ++chatScrollSeq, started = Date.now();
    function fix(first) {
      if (token !== chatScrollSeq || (!first && chatUserTouchAt > started)) return;
      var el = chatLog && chatLog.querySelector('[data-uid="' + v.uid + '"]'); if (!el) return;
      var dy = el.getBoundingClientRect().top - v.top;
      if (Math.abs(dy) >= 1) chatScrollByY(dy, false);   // (O-0124) 평소=window · 음성 대화 무대=대화 상자
    }
    fix(true);
    requestAnimationFrame(function () { fix(false); });
    setTimeout(function () { fix(false); }, 80);
    setTimeout(function () { fix(false); }, 250);
  }
  // 보고 있는 동안(화면이 켜져 있을 때만) 그려진 것까지 '본 것'으로 굳힌다 → 다음에 열 때 오판 방지
  function markChatSeenRendered() {
    if (document.hidden) return;
    var mx = 0;
    for (var i = 0; i < chatMsgs.length; i++) if ((chatMsgs[i].ts || 0) > mx) mx = chatMsgs[i].ts;
    if (mx) setSeenHW(mx);
    if (readLoadedMs && readPresent()) readNote(readLoadedMs);   // (O-0201) 다른 기기에도 「여기까지 읽음」 — 서버가 매긴 시각만 올린다
  }
  // 대표님 지시(2026-09-22, v4.3): 앞 답을 기다리는 중에도 다음 메시지를 '바로' 보낼 수 있어야 한다.
  //   각 질문은 고유 id/token 을 갖고, reconcileChat 이 질문마다 따로 poll 해 답을 그 질문에만 매칭한다.
  //   PC(chat_responder.py)도 pending 을 created_at 순(FIFO)으로 하나씩 처리하므로 여러 개가 동시에
  //   대기해도 순서·매칭이 엉키지 않는다 → 전송 버튼을 '대기 중'이라고 잠그지 않는다(항상 활성).
  function updateSendEnabled() { if (chatSend) chatSend.disabled = false; }
  // (O-0117, 2026-09-30 대표님 지시) 홈 케이 사진 위 숫자 배지 → 케이 말풍선.
  //   안읽음 카운트(chatUnseen)·알림(notice) 제외 규칙·OS 알림/앱아이콘 배지는 그대로 두고, 「보여 주는 방식」만 바꿨다.
  function updateChatBadge() {
    var b = $('chatBadge');                       // 옛 숫자 배지(구버전 화면 호환) — 있으면 늘 숨김
    if (b) b.style.display = 'none';
    renderKBubble();
  }
  /* ---- 홈 케이 말풍선 ----
   * 문구: 1건 = 소식 종류별(KChar.moodFor: 문제/완료/확인요청/그 밖), 여러 건 = 「새 메시지 N건」.
   *   같은 메시지에는 늘 같은 문구(메시지 시각으로 고름) → 다시 그려도 말이 바뀌지 않고, 메시지마다는 조금씩 다르다.
   * 미리보기: 가장 최근 안읽은 케이 메시지의 첫 줄(한 줄, 넘치면 …).
   * 얼굴: 그 메시지의 표정(EXPR_RULES)을 새 소식이 왔을 때 한 번 잠깐 보여 준다(KChar.setExpr flash).
   * 움직임: 처음 나타날 때 한 번만 부드럽게. 움직임 끔·절전·모션 감소 설정이면 애니메이션 없이 바로. */
  var K_BUBBLE_LINES = {
    news:    ['대표님, 보고드릴 게 하나 있습니다', '대표님, 새 소식 하나 가져왔습니다', '대표님, 전해 드릴 말씀이 있습니다'],
    done:    ['대표님, 맡기신 일 끝났습니다!', '대표님, 말씀하신 일 마쳤습니다!'],
    ask:     ['대표님, 확인해 주실 게 있습니다', '대표님, 여쭤볼 게 하나 있습니다'],
    problem: ['대표님, 말씀드릴 문제가 있습니다', '대표님, 잠깐 보셔야 할 일이 생겼습니다'],
    many:    ['대표님! 새 메시지 {n}건이 와 있습니다', '대표님, 읽지 않으신 메시지가 {n}건 있습니다']
  };
  var kBubbleKey = '', kBubbleSettleT = 0;       // 지금 말풍선이 가리키는 메시지(새 소식이 왔는지 판단) · 펼침 끝 타이머
  function kBubblePick(list, seed) {
    var h = 0, s = String(seed || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return list[Math.abs(h) % list.length];
  }
  function kBubblePreview(m) {
    if (!m) return '';
    var lines = String(m.text || '').split('\n'), first = '';
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/\*\*/g, '').replace(/^\s*(#{1,6}\s+|[-*•·]\s+|>\s*)/, '').replace(/\s+/g, ' ').trim();
      if (t && !/^[-=_|:\s]+$/.test(t)) { first = t; break; }
    }
    if (!first && m.files && m.files.length) first = '📎 파일 ' + m.files.length + '개를 보냈습니다';
    else if (!first && m.vurl) first = '🔊 음성으로 답했습니다';
    return first.length > 80 ? first.slice(0, 80) + '…' : first;
  }
  // 가장 최근 안읽은 메시지(알림 제외): 케이 답을 먼저, 없으면 다른 기기에서 온 대화
  function kBubbleLatest() {
    var seen = getSeenHW(), k = null, any = null;
    for (var i = chatMsgs.length - 1; i >= 0; i--) {
      var m = chatMsgs[i];
      if (!m || m.notice || (m.ts || 0) <= seen) continue;
      if (!any) any = m;
      if (m.role === 'k') { k = m; break; }
    }
    return k || any;
  }
  function renderKBubble() {
    pushWidget(false);                            // v8.2(O-0157): 바탕화면 위젯도 같은 내용으로(값이 바뀔 때만 보냄)
    var wrap = $('kBubbleWrap'), btn = $('kBubble'); if (!wrap || !btn) return;
    var n = chatUnseen > 0 ? chatUnseen : 0;
    var vbtn = $('btnVoiceChat');
    var side = wrap.parentNode;                                   // v9.4 .kh-side — 말풍선이 뜨면 그 위의 「오늘 보고 한 줄」은 내린다
    if (!n) {
      clearTimeout(kBubbleSettleT);
      wrap.classList.remove('on', 'pop', 'settled'); btn.setAttribute('tabindex', '-1'); kBubbleKey = '';
      if (vbtn) vbtn.setAttribute('aria-label', '소장 K(케이)와 대화');
      if (side) side.classList.remove('bub-on');
      try { if (window.TodayCard && TodayCard.paintSay) TodayCard.paintSay(); } catch (e) {}
      return;
    }
    if (side) side.classList.add('bub-on');
    var m = kBubbleLatest();
    var mood = (m && m.role === 'k' && window.KChar && KChar.moodFor) ? KChar.moodFor(m.text || '') : { kind: 'news', expr: 'neutral' };
    var seed = m ? String(m.ts || '') + '|' + String(m.text || '').slice(0, 20) : 'n';
    var title = n > 1
      ? kBubblePick(K_BUBBLE_LINES.many, seed).replace('{n}', n > 99 ? '99+' : String(n))
      : kBubblePick(K_BUBBLE_LINES[mood.kind] || K_BUBBLE_LINES.news, seed);
    var prev = kBubblePreview(m);
    $('kBubbleTitle').textContent = title;
    var pv = $('kBubblePrev'); pv.textContent = prev; pv.style.display = prev ? '' : 'none';
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', title + (prev ? ' — ' + prev : '') + ' (눌러서 대화 열기)');
    if (vbtn) vbtn.setAttribute('aria-label', '소장 K(케이)와 대화 — 안 읽은 메시지 ' + n + '건');
    // 꼬리가 케이 얼굴 가운데를 가리키게(오브 위치 실측, 못 재면 CSS 기본값)
    try {
      var face = vbtn && vbtn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      if (face && face.width && wr.width) wrap.style.setProperty('--kbub-tail', Math.round(face.left + face.width / 2 - wr.left) + 'px');
    } catch (e) {}
    var key = seed + '|' + n;
    var firstShow = !wrap.classList.contains('on');
    var calm = !(window.KChar && KChar.motionOn && KChar.motionOn());
    wrap.classList.toggle('calm', calm);
    wrap.classList.add('on');
    if (firstShow && !calm) {                      // 나타날 때 한 번만(다시 그릴 때마다 흔들지 않음)
      wrap.classList.remove('pop', 'settled'); void wrap.offsetWidth; wrap.classList.add('pop');
      clearTimeout(kBubbleSettleT);                // 펼침이 끝난 뒤에야 그림자·꼬리를 밖으로 보이게(펼치는 동안은 잘라 둠)
      kBubbleSettleT = setTimeout(function () { if (wrap.classList.contains('on')) wrap.classList.add('settled'); }, 480);
    } else if (calm) wrap.classList.add('settled');
    if (key !== kBubbleKey) {
      var fresh = !!kBubbleKey || firstShow;       // 새 소식 → 그 표정을 잠깐
      kBubbleKey = key;
      if (window.KChar && KChar.setExpr && m && m.role === 'k') KChar.setExpr(mood.expr || 'neutral', fresh);
    }
  }
  window.addEventListener('resize', function () { if (chatUnseen > 0) renderKBubble(); });
  /* ---- 대화 검색(순수 로컬 · 필터 방식) ----
   * 원본은 localStorage(chatMsgs). 검색어가 있으면 '일치하는 말풍선만' 남기고 일치 부분을 강조한다.
   * 닫으면(X) 전체 대화로 정확히 복귀. 대소문자 무시·부분일치. 서버 재조회 없음. */
  var chatSearchOn = false, chatSearchQuery = '';
  function msgMatches(m, q) {
    if ((m.text || '').toLowerCase().indexOf(q) !== -1) return true;
    if (m.files && m.files.length) {
      for (var i = 0; i < m.files.length; i++) {
        if ((m.files[i].name || '').toLowerCase().indexOf(q) !== -1) return true;
      }
    }
    return false;
  }
  function chatTextHL(s, q) {
    var out = esc(s);
    if (q) {
      var qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { out = out.replace(new RegExp('(' + qe + ')', 'gi'), '<mark>$1</mark>'); } catch (e) {}
    }
    return linkify(out).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  }
  /* ---- v6.0 소장 「케이」 캐릭터: 말풍선 아바타·표정 ----
   * 표정 규칙은 js/k-character.js 의 EXPR_RULES 한 곳에만 있다(KChar.exprFor). */
  var kLastUidSeen = null;                        // 마지막 케이 답 uid(새 답장이 왔는지 = 표정 잠깐 보여주기)
  /* (O-0226) 말풍선 옆 동그란 얼굴: 기본은 미소 사진(KChar.avatarUrl 이 「평소」 자리에 미소를 돌려준다).
   *   걱정·생각 중 낱말이 든 답(죄송·보류·지연·확인 중…) 옆에서는 웃지 않는다 → 예전처럼 평소 사진(data-kraw).
   *   마지막 케이 답만 그 답의 표정 사진(applyKExpr — 예전 그대로). */
  function kRowCalm(m) {
    if (!m || !window.KChar) return false;
    var e = KChar.exprFor(m.text || '');
    return e === 'concern' || e === 'thinking';
  }
  function kRowHtml(start, bubbleHtml, extra, m) {
    var calm = kRowCalm(m);
    return '<div class="krow ' + (start ? 'kstart' : 'kcont') + (extra || '') + '"><div class="kavcol">' +
      (start ? '<img class="kav" data-kexpr="neutral"' + (calm ? ' data-kraw="1"' : '') + ' src="' +
        (window.KChar ? KChar.avatarUrl('neutral', null, calm) : '') + '" alt="케이" draggable="false">' : '') +
      '</div><div class="kcol">' + (start ? '<div class="kname">케이</div>' : '') + bubbleHtml + '</div></div>';
  }
  function applyKExpr(lastKMsg) {
    if (!window.KChar) return;
    var expr = lastKMsg ? KChar.exprFor(lastKMsg.text || '') : 'neutral';
    var rows = chatLog.querySelectorAll('.krow.kstart:not(.ktyping) img.kav');
    if (rows.length && lastKMsg) {
      var im = rows[rows.length - 1];
      im.setAttribute('data-kexpr', expr); im.removeAttribute('data-kraw'); im.setAttribute('src', KChar.avatarUrl(expr));
    }
    var uid = lastKMsg ? msgUid(lastKMsg) : '';
    var fresh = kLastUidSeen !== null && uid && uid !== kLastUidSeen;   // 처음 그릴 땐 깜짝 표정 없이
    kLastUidSeen = uid;
    KChar.setExpr(expr, fresh);
  }
  /* ---- O-0111 긴 메시지 접기(카톡 「전체 보기」) — 2026-09-30 대표님 지시 ----
   * 말풍선 본문(.bfold)이 20줄 높이를 넘으면 15줄까지만 보이게 접고, 아래 끝을 흐리게 + [전체 보기 ▼].
   *   누르면 그 자리에서 펼치고 [접기 ▲]로 다시 접는다. 잘라내는 게 아니다 — 전문은 DOM·저장본에 그대로.
   * ▷ 판정은 글자 수가 아니라 실제 그려진 높이(scrollHeight) — 줄바꿈 많은 짧은 글·폭 차이(폰/펼친 폴드/PC)를 그대로 반영.
   * ▷ 15줄 ≈ 폰(390px 폭) 화면 높이의 절반. 20줄 미만은 접지 않는다(몇 줄 숨기려고 버튼을 다는 건 오히려 번거로움).
   * ▷ 줄 수 기준이라 키보드가 올라와 화면 높이가 바뀌어도 접힘이 흔들리지 않는다(폭이 바뀔 때만 다시 잰다).
   * ▷ 펼친 말풍선은 chatFoldOpen(uid)에 기억 → 새 메시지·[이전 대화 더 보기]·다시 그리기 뒤에도 펼친 채 유지(앱을 끄면 초기화). */
  var CHAT_FOLD_SHOW_LINES = 15, CHAT_FOLD_MIN_LINES = 20;
  var chatFoldOpen = {};
  // 20줄이 '될 수도 있는' 글만 후보로 감싼다(한 줄 12자로 넉넉히 어림 = 좁은 폰에서도 놓치지 않게).
  //   짧은 글은 .bfold 조차 안 붙어 예전과 똑같이 그려지고, 높이 재기 비용도 없다. 진짜 판정은 applyChatFolds 의 실측.
  function chatFoldMaybe(s) {
    var ls = String(s).split('\n'), n = 0;
    for (var i = 0; i < ls.length; i++) { n += Math.max(1, Math.ceil(ls[i].length / 12)); if (n >= CHAT_FOLD_MIN_LINES - 1) return true; }
    return false;
  }
  var chatFoldCache = {};   // uid → 「폭|글자수」에서 잰 판정(true=접을 대상). 같은 폭이면 다시 그려도 재지 않는다(렉 방지)
  function applyChatFolds() {
    if (!chatLog || !chatLog.offsetHeight) return;      // 채팅 화면이 안 보일 땐 높이를 못 잰다 → 접지 않고 전부 보임(열 때 다시 그림)
    var els = chatLog.querySelectorAll('.bfold'), hit = [], need = [], bubs = [];
    if (!els.length) return;
    var w = chatLog.clientWidth;
    for (var c = 0; c < els.length; c++) {
      var ck = w + '|' + els[c].textContent.length, cv = chatFoldCache[els[c].getAttribute('data-fuid')];
      if (cv && cv.k === ck) { if (cv.f) hit.push(els[c]); } else need.push(els[c]);
    }
    if (need.length) {
      // ⚠️ 말풍선은 렉 방지로 content-visibility:auto(화면 밖은 안 그림)라, 방금 그린 말풍선은 폭이 내용 없이(≈52px)
      //   잡혀 높이가 수십 배로 부풀어 보인다(실측). → 처음 재는 말풍선만 잠깐 'visible'로 풀었다가 바로 되돌린다.
      for (var k = 0; k < need.length; k++) { bubs.push(need[k].closest('.bubble')); if (bubs[k]) bubs[k].style.contentVisibility = 'visible'; }
      var minH = (parseFloat(getComputedStyle(need[0]).lineHeight) || 24.8) * CHAT_FOLD_MIN_LINES;
      for (var i = 0; i < need.length; i++) {             // 읽기만 모아서(리플로우 1번)
        var big = need[i].scrollHeight > minH;
        chatFoldCache[need[i].getAttribute('data-fuid')] = { k: w + '|' + need[i].textContent.length, f: big };
        if (big) hit.push(need[i]);
      }
      for (var r = 0; r < bubs.length; r++) if (bubs[r]) bubs[r].style.contentVisibility = '';
    }
    if (!hit.length) return;
    var showH = Math.round((parseFloat(getComputedStyle(hit[0]).lineHeight) || 24.8) * CHAT_FOLD_SHOW_LINES);
    for (var j = 0; j < hit.length; j++) {                // 그다음 한꺼번에 쓰기
      var f = hit[j], open = !!chatFoldOpen[f.getAttribute('data-fuid')];
      f.style.setProperty('--fold-h', showH + 'px');
      f.classList.add('bfoldable');
      if (!open) f.classList.add('folded');
      f.insertAdjacentHTML('afterend', '<button type="button" class="bfoldbtn" aria-expanded="' + open + '">' + (open ? '접기 ▲' : '전체 보기 ▼') + '</button>');
    }
  }
  function toggleChatFold(btn) {
    var bub = btn.closest('.bubble'), f = bub && bub.querySelector('.bfold');
    if (!f) return;
    var uid = f.getAttribute('data-fuid'), fold = !f.classList.contains('folded');
    var before = btn.getBoundingClientRect().top;
    ++chatScrollSeq;                                     // 뒤늦게 도는 자동 스크롤 예약이 있으면 취소(화면이 튀지 않게)
    f.classList.toggle('folded', fold);
    if (fold) delete chatFoldOpen[uid]; else chatFoldOpen[uid] = 1;
    btn.textContent = fold ? '전체 보기 ▼' : '접기 ▲';
    btn.setAttribute('aria-expanded', String(!fold));
    // 펼칠 땐 위쪽이 그대로라 화면이 안 움직인다. 접을 땐 글이 위로 줄어드니 → 누른 버튼이 손가락 아래 그 자리에 있게 되돌린다.
    if (fold) { var dy = btn.getBoundingClientRect().top - before; if (Math.abs(dy) >= 1) try { window.scrollBy(0, dy); } catch (e) {} }
  }
  // 폭이 바뀌면(폴드 펼침·화면 회전·PC 창 크기) 줄 수가 달라지니 다시 그려 다시 잰다. 높이만 바뀌는 건(키보드) 무시.
  (function () {
    var lastW = window.innerWidth, t = 0;
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth; clearTimeout(t);
      t = setTimeout(function () { if (chatLog && isOpen(chatView) && !chatSearchOn) renderChat(); }, 250);
    }, { passive: true });
  })();
  function renderChat() {
    chatFx = null;
    try { renderChatInner(); } finally { try { callCaption(); } catch (e) {} }   // v9.6: 답이 올 때마다 전체 화면 자막도
    // v9.6(O-0387 2번) 채팅 보내기 움직임: 새로 그린 「뒤」에, 방금 보낸 말·방금 온 말·보낸 말 아래 한 줄이 바뀐 곳에만 얹는다(그리기·스크롤은 이미 끝났다)
    try {
      if (chatFx && window.KMotion && KMotion.chat && chatLog && isOpen(chatView) && !chatSearchOn)
        KMotion.chat(chatLog, { mine: chatFx.mine, incoming: chatFx.incoming, convo: convoOn, send: chatSend, face: chatView.querySelector('#kHeadBtn .kface') });
    } catch (e) {}
    chatFx = null;
  }
  var chatFx = null;
  /* v9.6 (O-0356 ③⑤) 채팅의 날짜 줄 · 보낸 말 아래 한 줄 · 대기 줄
   *  날짜 줄: 한국시간으로 날짜가 바뀌는 자리에 「10월 9일 목요일」 한 줄(해가 다르면 연도까지). 검색 중에는 넣지 않는다.
   *  보낸 말 아래: 「보내는 중…」 → 「보냄」(서버에 올라간 것을 확인) → 「받았습니다」(PC의 케이가 받아 처리를 시작한 것을 확인).
   *    앱이 아는 것은 「받았다」까지라 「읽었습니다」라고 하지 않는다. 답이 오면 이 줄은 사라진다(답이 곧 그 표시).
   *  대기 줄(점 세 개 옆): PC가 남긴 진행 글을 케이의 말로(「캘린더 확인 중…」 → 「캘린더 확인 중입니다」). 받은 뒤 진행 글이 아직 없으면 「확인하고 있습니다」,
   *    아직 받지 못했으면 점만(받지도 않았는데 확인 중이라고 하지 않는다). */
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function chatDayKey(ts) { if (!ts) return ''; var d = new Date(ts + 9 * 3600000); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
  function chatDayLabel(ts) {
    var d = new Date(ts + 9 * 3600000), n = new Date(Date.now() + 9 * 3600000);
    return (d.getUTCFullYear() !== n.getUTCFullYear() ? d.getUTCFullYear() + '년 ' : '') + (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + DOW_KO[d.getUTCDay()] + '요일';
  }
  function msgWaiting(m) { return !!(m && m.role === 'me' && !m.answered && m.id && m.token && !m.vcut); }
  function markMsgStat(m, status) {
    var ch = false;
    if (!m.sent) { m.sent = true; ch = true; }
    if (status === 'processing' && !m.got) { m.got = true; ch = true; }
    return ch;
  }
  // (v9.20) 못 보낸 말(nosrv)에 붙는 줄 — 'text' = 글이라 다시 보낼 수 있음 / 'pick' = 사진 · 파일(앱을 다시 켠 뒤라 보관본이 없음) / '' = 줄 없음
  function resendKind(m) {
    if (RESEND_UI === 'off' || !m || m.role !== 'me' || !m.nosrv || m._resending || !m.id || !m.token || m.vin) return '';
    if (Date.now() - (m.ts || 0) > RESEND_MAX_MS) return '';
    if (m.files && m.files.length) return (m._att && RESEND_UI === 'on') ? 'att' : 'pick';   // 'att' = 앱이 켜져 있는 동안 메모리에 남긴 사진 · 작은 파일(저장하지 않음)
    return m.text ? 'text' : '';
  }
  function msgStatHtml(m) {
    var rk = resendKind(m);
    if (rk) return '<div class="msgstat fail" data-ms="' + msgUid(m) + '">못 보냈습니다 · ' +
      (rk !== 'pick' ? '<button type="button" class="msgretry" data-retry="' + msgUid(m) + '">다시 보내기</button>' : '사진·파일은 다시 골라 주십시오') + '</div>';
    if (!msgWaiting(m) || m.uploading) return '';
    var t = m.got ? '받았습니다' : (m.sent ? (kStatState === 'down' ? '보냄 · PC가 응답하지 않아 아직 받지 못했습니다' : '보냄') : '보내는 중…');
    return '<div class="msgstat' + (m.got ? ' got' : '') + '" data-ms="' + msgUid(m) + '">' + t + '</div>';
  }
  function progSay(p) {
    p = String(p || '').replace(/[.…]+$/, '').trim();
    if (!p) return '';
    if (/중$/.test(p)) return p + '입니다';
    if (/(니다|세요|어요|아요)$/.test(p)) return p;
    return p;
  }
  function awaitSay() {
    var p = awaitingProg(); if (p) return progSay(p);
    return chatMsgs.some(function (m) { return msgWaiting(m) && m.got; }) ? '확인하고 있습니다' : '';
  }
  function renderChatInner() {
    // IME(한글) 조합 중이면 목록 DOM을 건드리지 않는다 → 조합이 끊겨 글자가 씹히는 것을 막는다.
    // 미룬 렌더는 compositionend/blur 에서 flushChatRender()로 한 번에 반영(v4.5).
    if (chatComposing) { chatRenderDeferred = true; return; }
    var q = chatSearchOn ? chatSearchQuery.trim().toLowerCase() : '';
    if (!chatMsgs.length && !q) {
      chatLog.innerHTML = chatLockHtml() + '<div class="chatintro">' +
        (window.KScene ? KScene.figHtml('guide', 'intro') : '<div class="chatintro-ic"><svg><use href="#i-spark"/></svg></div>') +
        '<b>안녕하세요, 대표님</b><p>무엇이든 물어보시거나 일을 시켜 보세요.<br>예: “내일 일정 정리해줘”, “학과 회의록 초안 만들어줘”.</p></div>';
      chatRenderedUids = {};
      return;
    }
    // v5.9: 다시 그리기 '전' 상태(맨 아래 근처였나 · 보던 말풍선)를 먼저 잰다
    var viewOpen = !q && isOpen(chatView);
    var anchorOn = viewOpen && chatAnchorActive();
    var wasNearBottom = viewOpen ? chatNearBottom() : true;
    var keepView = (viewOpen && !wasNearBottom) ? chatCaptureView() : null;
    var prevUids = chatRenderedUids, nowUids = {};
    var firstUnreadUid = '', newIncomingUid = '', newMine = false, newMineUid = '';
    if (anchorOn) {                                     // 붙잡아 둔 경계 이후 첫 안읽음(내용 있는 말풍선만)
      for (var ai = 0; ai < chatMsgs.length; ai++) {
        var am = chatMsgs[ai];
        if (am.role !== 'typing' && isUnreadSince(am, chatAnchorHW) && (am.text || am.vin || am.vurl || (am.files && am.files.length))) { firstUnreadUid = msgUid(am); break; }
      }
      if (firstUnreadUid) chatNewDivUid = firstUnreadUid;
    }
    var shown = 0, prevKind = '';                          // v6.0: 직전에 그린 말풍선 종류(케이 연속이면 아바타 생략)
    var prevDay = '';                                      // v9.6: 날짜가 바뀌는 자리에 날짜 줄
    var lastKMsg = null;
    for (var li = chatMsgs.length - 1; li >= 0; li--) { if (chatMsgs[li].role === 'k' && (chatMsgs[li].text || chatMsgs[li].vurl)) { lastKMsg = chatMsgs[li]; break; } }
    var html = chatMsgs.map(function (m) {
      if (m.role === 'typing') return '';
      if (q && !msgMatches(m, q)) return '';                // 검색 중이면 일치하는 말풍선만
      var inner = m.text ? (q ? chatTextHL(m.text, q) : chatText((SCAN_HUB === 'on' && m.disp) ? m.disp : m.text))
        : (m.vin ? '<span class="voicemark"><svg><use href="#i-mic"/></svg>음성 메시지</span>' : '');
      if (m.role === 'me' && m.opus && inner) inner = '<span class="opustag">오퍼스 5.5</span><br>' + inner;   // v5.8
      // O-0111: 긴 글은 접어 보이게 — 본문 글만 .bfold 로 감싼다(첨부·[듣기]는 접지 않고 항상 보임).
      //   전문은 DOM 에 그대로 있고 높이만 가린다. 실제 접기 판정은 그린 뒤 applyChatFolds()가 높이로 한다.
      if (m.text && !q && chatFoldMaybe(m.text)) inner = '<div class="bfold" data-fuid="' + msgUid(m) + '">' + inner + '</div>';
      if (m.role === 'me' && m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span style="opacity:.75">올리는 중…</span>';
      inner += attachChips(m.files, m.role === 'me');
      if (m.role === 'k' && (m.text || m.vurl)) {           // 모든 케이 답에 [듣기](없으면 온디맨드 생성)
        if (!m.lid) m.lid = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        // v8.3(O-0161): 사무소가 미리 목소리를 붙여 보낸 방송(아침 브리핑 --tts)은 「▶ 듣기」(아직 안 들은 것). 그 밖은 예전 그대로.
        inner += listenBtnHtml(m);                          // O-0468: 글·모양은 지금 상태(듣기 / 준비 중 / 멈춤)대로 — 아래 「답변별 [듣기]」
      }
      if (m.role === 'k' && starIds[rowIdOf(m) || '']) inner += '<span class="bstar" aria-label="저장한 답">⭐</span>';   // v8.3 ⭐ 저장 표시
      if (!inner) return '';
      if (m.role === 'me' && m.rq) inner = quoteHtml(m.rq) + inner;   // (O-0545) 답장으로 보낸 말: 맨 위에 원래 메시지 인용(누르면 그리로)
      // v5.4(2026-09-23, 대표님 지시): 「🔔 알림」 딱지·호박색 테두리 등 화면 표시를 제거한다.
      //   메시지 자체는 그대로 오고 일반 말풍선처럼 보인다. ⚠️ 내부 notice 플래그(m.notice)는 그대로 두어
      //   '안읽음 배지 카운트 제외' 로직(아래 !isNotice)은 유지한다 — 알림이 안읽음 숫자를 올리지 않게.
      //   (예전: noticerow/noticebadge 딱지 + 말풍선 ' notice' 클래스 → v5.4에서 렌더만 제거.)
      // v5.9: 새 메시지 판정(검색 중엔 안 함) + 「여기부터 새 메시지」 구분선
      var uid = msgUid(m), divider = '', dayDiv = '';
      if (!q) {
        var dk = chatDayKey(m.ts);
        if (dk && dk !== prevDay) { dayDiv = '<div class="chatday"><span>' + esc(chatDayLabel(m.ts)) + '</span></div>'; prevDay = dk; }
        nowUids[uid] = 1;
        if (prevUids && !prevUids[uid]) {
          if (isIncomingMsg(m)) { if (!newIncomingUid) newIncomingUid = uid; }
          else { newMine = true; newMineUid = uid; }        // 이 기기에서 방금 보낸 내 메시지
        }
        if (uid === chatNewDivUid && shown > 0) divider = '<div class="chatnewdiv"><span>여기부터 새 메시지</span></div>';
      }
      shown++;
      // ⋯ 메뉴 버튼(복사·삭제). 텍스트 선택/복사를 방해하지 않게 우상단 고정.
      var bubbleHtml = '<div class="bubble ' + (m.role === 'me' ? 'me' : 'k') + '" data-uid="' + uid + '">' + inner +
        '<button type="button" class="bmenu" aria-label="메시지 메뉴(답장·복사·삭제)">⋯</button></div>';
      if (m.role === 'me') {
        prevKind = 'me';
        return dayDiv + divider + bubbleHtml + (!q ? msgStatHtml(m) + orderCardHtml(m) : '');   // v5.8: 작업 카드(대장에 접수된 메시지만) · v9.6: 보낸 말 아래 「보냄 → 받았습니다」
      }
      // v6.0: 케이 말풍선 = 왼쪽 원형 아바타 + 이름(연속 메시지는 첫 칸만)
      var kStart = !(prevKind === 'k' && !divider && !dayDiv);
      prevKind = 'k';
      return dayDiv + divider + kRowHtml(kStart, bubbleHtml, '', m);
    }).join('');
    if (q) {                                                // 검색 모드: 결과 안내 + (없으면) 빈 안내
      var info = $('chatSearchInfo');
      if (info) {
        info.style.display = 'block';
        var qt = esc(chatSearchQuery.trim());
        var ih = shown ? ('“' + qt + '” 검색 결과 ' + shown + '개') : '“' + qt + '”에 일치하는 대화가 없습니다.';
        // v7.0: 옛 대화가 아직 서버에 남아 있으면(불러온 것 안에서만 찾았음) → 전부 받아 와서 찾기
        if (chatHasMore) ih += '<br><span class="chatsearchnote">지금 불러온 대화 안에서 찾았습니다.</span> ' +
          '<button type="button" id="chatSearchMore" class="chatsearchmore"' + (chatOlderBusy ? ' disabled' : '') + '>' +
          (chatOlderBusy ? '불러오는 중…' : '옛 대화까지 모두 찾기') + '</button>';
        info.innerHTML = ih;
      }
      chatLog.innerHTML = html || '';
      applyKExpr(null);
      chatLog.scrollTop = 0;
      try { window.scrollTo(0, 0); } catch (e) {}
      chatRenderedUids = null;                            // v5.9: 검색을 닫고 돌아올 땐 기준 없이(=맨 아래) 다시 그림
      return;
    }
    if (anyAwaiting()) {
      // v8.4(O-0162): 점 세 개 옆에 「케이가 지금 뭐 하는지」(PC가 처리 중 행에 남긴 progress_msg). 없으면 예전처럼 점만.
      var ptx = awaitSay();                                // v9.6: 케이의 말로(「캘린더 확인 중입니다」 · 받은 뒤 진행 글이 없으면 「확인하고 있습니다」)
      html += kRowHtml(prevKind !== 'k', '<div class="bubble k typing"><span></span><span></span><span></span>' +
        '<em class="tprog"' + (ptx ? '' : ' style="display:none"') + '>' + esc(ptx) + '</em></div>', ' ktyping');
      // 답이 늦으면(약 35초 이상) "멈춘 것처럼" 보이지 않게 안내를 함께 띄운다
      var slowWait = chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token && (Date.now() - (m.ts || 0) > 35000); });
      if (kStatState === 'down') html += '<div class="waitnote down">PC가 응답하지 않아 지금은 답을 드리지 못합니다. PC가 켜져 있는지 확인해 주세요. 켜지면 이어서 답하겠습니다.</div>';
      else if (kStatState === 'login') html += '<div class="waitnote down">PC의 로그인이 풀려 지금은 답을 드리지 못합니다. PC에서 다시 로그인해 주시면 이어서 답하겠습니다.</div>';
      else if (slowWait) html += '<div class="waitnote">조금 더 걸립니다. 다른 일 보셔도 됩니다.</div>';
    } else if (kStatState === 'down') {                    // v8.4: 기다리는 답이 없어도 PC가 꺼져 있으면 맨 아래 한 줄로 알림
      html += '<div class="waitnote down">PC가 응답하지 않아 지금은 답을 드리지 못합니다. 보내 두시면 PC가 켜진 뒤 답하겠습니다.</div>';
    } else if (kStatState === 'login') {                   // v9.6: PC는 켜져 있지만 로그인이 풀린 때
      html += '<div class="waitnote down">PC의 로그인이 풀려 지금은 답을 드리지 못합니다. PC에서 다시 로그인해 주시면 이어서 답하겠습니다.</div>';
    }
    chatFx = { mine: newMineUid, incoming: newIncomingUid };   // v9.6(O-0387 2번): 다 그린 뒤 renderChat 이 움직임 효과를 얹는다
    chatLog.innerHTML = chatLockHtml() + chatMoreHtml() + html;         // v7.0: 맨 위 [이전 대화 더 보기] / 「여기가 대화의 처음이에요」
    applyChatFolds();                                    // O-0111: 긴 말풍선 접기(아래 스크롤 계산 '전'에 높이를 확정)
    chatRenderedUids = nowUids;
    applyKExpr(lastKMsg);                                // v6.0: 마지막 케이 답 표정 → 마지막 아바타·헤더·홈
    // v5.9: 어디로 스크롤할지 — 우선순위 ① 내가 방금 보냄 → 맨 아래(예전 그대로)
    //   ② 열기·복귀 직후(앵커 모드) 안읽음 있음 → 첫 안읽음의 시작  ③ 보는 중 새 메시지 + 맨 아래 근처 → 새 메시지 시작(부드럽게)
    //   ④ 맨 아래 근처 → 맨 아래(예전 그대로)  ⑤ 위로 올려 읽는 중 → 보던 위치 유지
    //   ⑥ 열기(open)인데 안읽음 없음 → 맨 아래(예전 그대로) / 복귀(resume)인데 없음 → ③~⑤ 규칙
    if (!viewOpen) { chatScrollBottom(); return; }
    // v8.3: 「저장한 답」에서 누른 대화로 가는 중이면(몇 초간) 다른 자동 스크롤보다 그 말풍선을 먼저 붙잡아 둔다
    if (chatJumpUid && Date.now() < chatJumpUntil && !newMine) { chatScrollToUid(chatJumpUid, false); markChatSeenRendered(); return; }
    if (newMine) { chatAnchorUntil = 0; chatScrollBottom(); }
    else if (anchorOn && firstUnreadUid) chatScrollToUid(firstUnreadUid, false);
    else if (anchorOn && chatAnchorKind === 'open') chatScrollBottom();
    else if (newIncomingUid && wasNearBottom) chatScrollToUid(newIncomingUid, true);
    else if (wasNearBottom || !prevUids) chatScrollBottom();
    else if (keepView) chatRestoreView(keepView);
    markChatSeenRendered();
  }
  function openChatSearch() {
    chatSearchOn = true;
    var bar = $('chatSearchBar'); if (bar) bar.style.display = 'flex';
    var inp = $('chatSearchInput'); if (inp) { setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60); }
    renderChat();
  }
  function closeChatSearch() {
    chatSearchOn = false; chatSearchQuery = '';
    var bar = $('chatSearchBar'); if (bar) bar.style.display = 'none';
    var inp = $('chatSearchInput'); if (inp) inp.value = '';
    var info = $('chatSearchInfo'); if (info) { info.style.display = 'none'; info.textContent = ''; }
    renderChat();
  }
  // v5.2(A): OS 알림 트레이/앱아이콘 배지 클리어(네이티브 전용). 인앱 #chatBadge 로직과 별개 —
  //   채팅을 읽거나 앱으로 돌아오면 쌓인 푸시 알림·런처 배지 숫자가 사라지게 한다.
  function clearDeliveredNotifications() {
    try {
      var Cap = window.Capacitor;
      if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() &&
          Cap.Plugins && Cap.Plugins.PushNotifications &&
          Cap.Plugins.PushNotifications.removeAllDeliveredNotifications) {
        Cap.Plugins.PushNotifications.removeAllDeliveredNotifications();
      }
    } catch (e) {}
  }
  function openChat(opts) {
    opts = opts || {};
    openScreen(chatView);
    clearDeliveredNotifications();                 // v5.2(A): 채팅 열람 시 OS 알림/배지 정리
    // 검색 상태는 대화에 들어올 때 항상 닫힌 상태로 시작(바·안내·검색어 초기화)
    chatSearchOn = false; chatSearchQuery = '';
    if ($('chatSearchBar')) $('chatSearchBar').style.display = 'none';
    if ($('chatSearchInput')) $('chatSearchInput').value = '';
    if ($('chatSearchInfo')) { $('chatSearchInfo').style.display = 'none'; $('chatSearchInfo').textContent = ''; }
    chatUnseen = 0; updateChatBadge();
    armChatAnchor('open', getSeenHW());           // v5.9: '어디까지 봤나'를 굳히기 전에 붙잡아 둔다 → 첫 안읽음의 시작에서 열기
    setSeenHW(Date.now());                        // v4.2: '지금까지는 다 봤다'를 굳혀 둠 → 껐다 켜도 배지가 되살아나지 않음
    renderPending(); updateConvoToggle();        // 기본: 조용한 텍스트(음성 대화 모드 꺼짐)
    // v4.0: 채팅을 열 때마다 서버 전체에서 재구성한다 → 어느 기기서 열어도 같은 대화가 보인다.
    //   세션 high-water 를 EPOCH 로 리셋하면 다음 loadChatSync/loadOfficePushes 가 전체를 받아온다.
    chatSyncHW = CHAT_EPOCH; officeHW = CHAT_EPOCH;
    renderChat(); reconcileChat();               // 들어올 때 그동안 도착한 답을 즉시 반영
    // v7.0: 먼저 최신 한 쪽(대화+방송 합쳐 CHAT_PAGE_SIZE 건)을 받고, 그 최신 시각부터 증분 조회를 잇는다.
    //   쪽 조회를 못 하면(암호 없음·서버 SQL 미적용·통신 실패) 예전처럼 EPOCH 부터(최신 300/1000) 재구성.
    loadChatFirstPage(function () {
      loadOfficePushes();                        // 케이 방송(쪽 조회 성공 시엔 그 이후 새것만)
      startChatSync();                            // PC↔폰 대화 동기화(암호 있으면 폴링, 없으면 게이트 안내)
    });
    ordFullOnce = true; startOrderPoll();         // v5.8: 작업 카드 — 열 때 최근 메시지들 카드 한 번 전체 확인
    // C4: 공유함과 동일 — 연동 암호가 없으면 조용히 넘기지 말고 매번 안내(암호 없으면 기기 간 대화가 안 보임).
    if (!getSyncPass()) showSyncGate(true);
    else refreshStarIds(false);                   // v8.3: 다른 기기에서 저장·해제한 ⭐ 표시도 맞춘다(1분에 한 번까지)
    try { refreshKStat(true); } catch (e) {}      // v8.4(O-0162) 머리줄 PC 케이 상태 점
    if (anyAwaiting()) startChatReconcile();
    try { replyTipOnce(); } catch (e) {}           // (O-0545) 처음 한 번 「⋯ → ↩ 답장」 안내
    try { if (chatReply) showReplyBar(); } catch (e) {}   // (O-0545) 채팅을 나갔다 와도 띠는 그대로
    // 진입 시 입력창 자동 포커스 안 함(대표님 지시) — 직접 탭했을 때만 브라우저 기본동작으로 포커스됨
  }
  // 입력창 높이 자동 조절. 키 입력마다 style.height='auto' 후 scrollHeight 를 읽으면
  // 그때마다 문서 전체 레이아웃이 강제로 다시 계산돼(대화가 길수록 무거워짐) 타이핑이 버벅인다.
  // → requestAnimationFrame 으로 한 프레임에 한 번만 재계산하게 합쳐 강제 리플로우를 줄인다(2026-09-21).
  // 입력창 높이 자동 조절. v4.7(2026-09-22): v4.6의 '조합 중 높이 얼리기'를 걷어냈다.
  //   실측 결과 입력창 높이가 바뀌어도 대화목록(.chatlog)은 재배치되지 않았다(문서 스크롤 구조라 문서만
  //   길어질 뿐 목록·말풍선 위치는 그대로였다). 즉 v4.6의 억제는 목록 reflow를 막은 게 아니라 입력창
  //   높이만 얼려서, 미확정(조합 중) 마지막 한글이 화면에 안 나오다가 확정(스페이스·점)해야 보이던
  //   증상을 유발했다. → 이제 조합 중에도 입력창은 브라우저 기본대로 정상 확장시켜 마지막 글자가 항상
  //   보이게 한다. 렉 방지는 rAF 배칭(프레임당 리플로우 1회)으로 유지한다.
  var _agChatRaf = 0;
  function autoGrowChat() {
    if (!chatInput) return;
    if (_agChatRaf) return;                 // 이미 이번 프레임에 예약됨 → 프레임당 1회로 리플로우를 합침
    _agChatRaf = requestAnimationFrame(function () {
      _agChatRaf = 0;
      if (!chatInput) return;
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(120, chatInput.scrollHeight) + 'px';
    });
  }
  function sendChatMsg() {
    if (!chatInput) return;
    var text = (chatInput.value || '').trim();
    var imgs = chatPendingImages.slice();
    var files = chatPendingFiles.slice();
    if (!text && !imgs.length && !files.length) return;
    // (2026-09-22, v4.3) 앞 답을 기다리는 중에도 다음 메시지를 바로 보낼 수 있게 잠금 해제.
    //   케이는 받은 순서(FIFO)대로 처리하고, 각 질문은 고유 id/token 으로 답이 따로 매칭된다.
    //   대기 상태는 '입력 막기'가 아니라 화면의 점 세 개(typing) 표시로만 알린다.
    unlockKaiAudio();                             // 이 탭(제스처)에 오디오를 깨워둠 → 답 목소리 자동재생 대비
    chatInput.value = ''; autoGrowChat();
    draftDrop();                                  // (v9.20) 보낸 글은 임시 보관에서 바로(동기) 지운다 — 대기 중인 저장 타이머도 취소
    var opus = takeOpus();                        // v5.8: 켜져 있었으면 이번 1건(첨부 포함 한 번의 전송)에만 적용하고 끔
    var rt = takeReply();                         // (O-0545) 답장: 글이 실리는 한 건(없으면 첫 건)에만 싣고 띠를 내린다
    var textUsed = false;
    // (1) 사진이 붙어 있으면 통합 전송(케이가 사진을 보고 답) — 글은 사진과 함께 감
    if (imgs.length) {
      chatPendingImages = [];
      sendChatTurnUI({ text: text, files: imgs, audioBlob: null, opus: opus, replyTo: rt });
      textUsed = true; rt = null;
    }
    // (2) 파일이 붙어 있으면 파일 전송 — 글이 아직 안 쓰였으면 첫 파일 묶음에 함께 붙임
    if (files.length) {
      chatPendingFiles = [];
      var big = files.filter(function (f) { return (f.size || 0) > CHAT_CHUNK_LIMIT; });
      var small = files.filter(function (f) { return (f.size || 0) <= CHAT_CHUNK_LIMIT; });
      if (small.length) { pushChatFileMsg(small, false, textUsed ? '' : text, opus, rt); textUsed = true; rt = null; }
      big.forEach(function (f) { pushChatFileMsg([f], true, textUsed ? '' : text, opus, rt); textUsed = true; rt = null; });
      if (big.length) toast('큰 파일은 나눠 올립니다 — 시간이 걸릴 수 있습니다.');
    }
    renderPending();
    // (3) 남은 순수 텍스트(첨부가 하나도 없을 때) — 기존 경로(음성 답은 음성 대화 모드일 때만)
    if (!textUsed && text) sendPlainChat(text, opus, rt);
    else if (rt) giveBackReply(rt);               // (O-0545) 실을 곳이 없었으면 띠를 그대로 둔다
  }
  // v9.6: 전송 실패의 오류 원문(영어일 때가 많다)은 화면에 붙이지 않는다 — 대표님께는 뜻 없는 글자다. 원인을 찾을 때 볼 수 있게 콘솔에만 남긴다.
  function errLog(where, e) { try { console.warn('[전송 실패] ' + where + ': ' + String((e && e.message) || e || '').replace(/\s+/g, ' ').trim().slice(0, 300)); } catch (x) {} }
  // 순수 텍스트 1건을 케이 채팅으로 보낸다(sendChatMsg 의 (3)과 같은 경로 — O-0040 「추가 요청」도 이걸 재사용)
  //   (O-0545) rt = 답장(입력 줄에서 보낼 때만 sendChatMsg 가 넘긴다). ⚠️ 이 함수 안에서 답장 띠를 꺼내 쓰지 않는다 —
  //   작업 카드 [승인]·[수정 요청]·꾸미기 추가 요청도 이 함수를 쓰므로, 그 단추에 엉뚱하게 답장이 붙지 않게.
  function sendPlainChat(text, opus, rt) {
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var pm = { role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false, opus: opus };
    if (SCAN_HUB === 'on' && scanNextDisp) { pm.disp = scanNextDisp; scanNextDisp = null; }   // 스캔 등록 줄은 말풍선에 짧은 안내로 보인다(실제로 보내는 글은 그대로)
    if (rt) pm.rq = { id: rt.id, side: rt.side, snip: rt.snip, at: rt.at || 0 };
    chatMsgs.push(pm);
    saveChatMsgs(); renderChat(); updateSendEnabled();
    return OfficeBridge.sendChat(id, tok, chatThread, text, { speak: convoOn, modelPref: opus ? 'opus' : null, replyTo: rt || null }).then(function () {
      pm.srv = true;                            // (O-0545) 서버에 올라감 → 이 말에도 답장할 수 있다
      kickOrderPoll();                          // v5.8: 작업 카드가 곧 붙도록
      startChatReconcile();
      return true;
    }).catch(function (e) {
      errLog('글', e);
      var m = findMsg(id); if (m) { m.answered = true; m.nosrv = true; }
      giveBackReply(rt);                          // (O-0545) 못 보낸 답장은 띠로 되돌려 다시 쓰실 때 그대로 실리게
      chatMsgs.push({ role: 'k', text: '죄송합니다, 말씀이 저에게 전송되지 않았습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now(), fe: id });   // fe = 이 사과가 가리키는 못 보낸 말의 id(다시 보내기 성공 때 지움)
      saveChatMsgs(); renderChat(); updateSendEnabled();
      return false;
    });
  }

  // (v9.20) 못 보낸 말 다시 보내기 — 같은 id · token 그대로(R1). 눌림 한 번에 한 번만(R3). 시간 제한은 지금부터 새로(R5).
  function dropApology(id) {
    var n = chatMsgs.length;
    chatMsgs = chatMsgs.filter(function (x) { return !(x.role === 'k' && x.fe === id); });
    return chatMsgs.length !== n;
  }
  // 사진 · 작은 파일 보관: 보내기가 실패했을 때만 File 목록을 메모리(m._att)에 남긴다(저장 안 함 · 합계 100MB 초과면 남기지 않음 · 45MB 넘는 큰 파일(조각 전송)은 제외).
  //   kind 'turn' = 사진(말·사진 한 턴, sendChatTurn) / 'batch' = 작은 파일(sendChatBatch). memo · opts 는 처음 보낼 때 쓴 것 그대로(같은 id · token · note).
  function keepAtt(m, kind, files, memo, opts) {
    try {
      var total = 0, arr = Array.prototype.slice.call(files || []);
      arr.forEach(function (f) { total += (f && f.size) || 0; });
      if (!arr.length || total > RESEND_ATT_MAX) { delete m._att; return; }
      m._att = { kind: kind, files: arr, memo: memo, opts: opts || null };
    } catch (e) { delete m._att; }
  }
  function resendChatMsg(uid) {
    var m = null;
    for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) { m = chatMsgs[i]; break; } }
    var rk = resendKind(m);
    if (!rk || rk === 'pick') return false;
    var a = (rk === 'att') ? m._att : null;
    m._resending = true; m.nosrv = false; m.answered = false; m.sent = false; m.got = false; m.waitFrom = Date.now();
    if (a) m.uploading = true;
    saveChatMsgs(); renderChat(); updateSendEnabled();
    var id = m.id, work;
    if (!a) work = OfficeBridge.sendChat(id, m.token, chatThread, m.text, { speak: convoOn, modelPref: m.opus ? 'opus' : null, replyTo: m.rq || null });
    else if (a.kind === 'batch') work = OfficeBridge.sendChatBatch(a.memo, a.files);
    else work = OfficeBridge.sendChatTurn(a.memo, a.opts || {});
    work.then(function (res) {
      if (res === 'exists') errLog('다시 보내기', '서버에 이미 있던 말(같은 id) — 새 행 없음');   // R7: 화면 변화 없음, 콘솔에만
      m._resending = false; m.srv = true; m.uploading = false; delete m._att;
      dropApology(id);
      saveChatMsgs(); if (isOpen(chatView)) renderChat();
      kickOrderPoll(); startChatReconcile();
    }).catch(function (e) {
      errLog('다시 보내기', e);
      m._resending = false; m.nosrv = true; m.answered = true; m.uploading = false;
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();      // 사과 말풍선은 이미 있으니 새로 쌓지 않는다(보관본 m._att 는 그대로 남아 다시 누를 수 있음)
    });
    return true;
  }
  function resendClick(uid) {
    var m = null;
    for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) { m = chatMsgs[i]; break; } }
    var rk = resendKind(m);
    if (!rk || rk === 'pick') return;
    if (RESEND_UI === 'text') {                       // 안전 모드: 한 번 더 묻는다
      openSheet('다시 보낼까요?', '이미 PC에 도착했을 수도 있습니다. 같은 말을 다시 보냅니다.', '다시 보내기', function () { resendChatMsg(uid); });
      if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-check'); }
      return;
    }
    resendChatMsg(uid);
  }

  /* ---- 통합 전송: (선택)음성 + (선택)사진 + 텍스트 한 턴 → 케이가 보고/듣고 답 ---- */
  function sendChatTurnUI(o) {
    o = o || {};
    var text = (o.text || '').trim(), imgs = o.files || [], blob = o.audioBlob || null;
    if (!text && !imgs.length && !blob) return;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var dispFiles = imgs.map(function (f) { return { name: f.name || '사진', size: f.size || 0, mime: f.type || '', kind: 'image' }; });
    var dev = !!(o.sttDevice && text && !blob);   // O-0177 ②: 폰 받아쓰기 글자(음성 턴으로 보냄 — PC가 전사를 건너뜀)
    var vs = !!(VC.STREAM && convoOn && (blob || dev));   // O-0177 ①: 음성 대화 턴만 조각 목소리 요청
    var vturn = !!(convoOn && (blob || dev));     // O-0210: 음성 대화 턴이면 직전 턴의 폰 쪽 시각을 싣고, 이번 턴을 재기 시작
    var vprev = vturn ? vlatTake() : null;
    if (vturn) vlatStart(id);
    var meMsg = { role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false,
                  files: dispFiles.length ? dispFiles : null, up: true, uploading: true, vin: !!blob, opus: !!o.opus };
    var rt = o.replyTo || null;                   // (O-0545) 답장(글·사진·음성 턴)
    if (rt) meMsg.rq = { id: rt.id, side: rt.side, snip: rt.snip, at: rt.at || 0 };
    if (dev) meMsg.vdev = true;
    if (vs) meMsg.vs = true;
    chatMsgs.push(meMsg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var note = text;                              // 사진만 있고 말/글이 없으면 기본 질문
    if (!note && !blob && imgs.length) note = '이 사진을 보고 설명해 주세요.';
    var memo = { id: id, token: tok, thread: chatThread,
                 title: text ? text.slice(0, 20) : (blob ? '음성대화' : '사진'), note: note };
    var turnOpts = { audioBlob: blob, files: imgs, speak: convoOn, modelPref: o.opus ? 'opus' : null,
                     sttDevice: dev, vstream: vs, vend: o.vend || null, vprev: vprev, replyTo: rt };
    OfficeBridge.sendChatTurn(memo, turnOpts).then(function () {
      vlatMark(id, 'sub');                        // O-0210
      meMsg.uploading = false; meMsg.srv = true; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile(); kickOrderPoll();      // v5.8
    }).catch(function (e) {
      meMsg.answered = true; meMsg.uploading = false; meMsg.nosrv = true;
      keepAtt(meMsg, 'turn', imgs, memo, turnOpts);   // (v9.20) 다시 보내기용 보관(메모리만)
      giveBackReply(rt);                          // (O-0545)
      errLog('말·사진 한 턴', e);
      chatMsgs.push({ role: 'k', text: '죄송합니다, 말씀이 저에게 전송되지 않았습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now(), fe: id });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    });
  }

  /* ==================== 음성 입력(무음 자동 감지 · 핸즈프리) ====================
   * STT: 이 기기 WebView 는 브라우저 실시간 받아쓰기(SpeechRecognition)를 못 쓰므로(안드로이드 WebView
   *   미지원·과거 삑소리/끊김으로 폐기), 검증된 "네이티브 녹음→업로드→PC whisper 전사" 경로를 쓴다.
   * 무음 감지: 네이티브 MediaRecorder.getMaxAmplitude() 를 폴링해 "말→멈춤"을 판정한다(같은 녹음기에서
   *   진폭을 읽으므로 두 번째 마이크 접근/경합이 없다). 브라우저(테스트)에선 AnalyserNode 레벨을 쓴다.
   * 자동 종료: 말이 시작된 뒤 SILENCE_MS 무음 → 자동 정지·전송. (한 번 누르면 끝, 두 번 누르기 불필요)
   * 연속 대화(convoOn): 케이 음성 답 재생이 끝나면 자동으로 다음 듣기 → 반복. [음성 대화 끝내기]로 멈춤. */
  function ensureChatRecorder() {
    if (chatRecorder) return chatRecorder;
    chatRecorder = new RecordingModule({
      kind: 'chat',                      // v9.8: 음성 대화 한 마디(회의 녹음과 섞이지 않게)
      onError: function (m) {
        toast('🎤 ' + m); stopAmpPoll(); chatRecording = false; setChatMic(false);
        if (convoOn) stopConvo(true);   // 마이크 시작 실패 → 무한 재시도 말고 대화 멈춤(대표님이 다시 시작)
      },
      onAudio: function (blob) { chatRecording = false; setChatMic(false); onListenAudio(blob); }
    });
    return chatRecorder;
  }
  function setChatMic(rec) {
    if (!chatMic) return;
    chatMic.classList.toggle('rec', rec);
    if (chatMicLabel) chatMicLabel.textContent = rec ? '듣는 중…' : '눌러서 말하기';
  }
  function setConvoStatus(t) {
    setConvoStageStatus(t);                       // (O-0124) 무대 아래 상태 줄도 함께
    if (!chatConvoStatus) return;
    if (t) { chatConvoStatus.style.display = 'block'; chatConvoStatus.textContent = t; }
    else { chatConvoStatus.style.display = 'none'; chatConvoStatus.textContent = ''; }
  }
  /* ---- (O-0124) 음성 대화 무대 ----
   * 음성 대화를 켜면 채팅 화면 위쪽에 케이가 크게(data-kface="convo") 나온다. 얼굴 움직임은 기존 흐름 그대로:
   *   케이 목소리 재생 → kaiAudio 'playing' → KChar.setTalking(true) → talk 영상 / 끝나면 idle.
   *   (기본머리 외 조합=정지 사진+끄덕임, 영상 실패·절전=정지 사진 — KChar 가 알아서 대신한다)
   * 상태 문구는 기존 setConvoStatus 문구를 그대로 받아 「큰 글씨 + 작은 안내」로 바꿔 보여 준다.
   * 무대가 안 보이면(음성 대화 끔·다른 화면·앱이 뒤로) 영상은 KChar 의 IntersectionObserver·visibilitychange 로 멈춘다. */
  function setConvoStageStatus(t) {
    if (!chatKStage) return;
    t = String(t || '');
    var st = 'idle', big = '음성 대화', small = '';
    if (t.indexOf('말하는') !== -1) { st = 'talk'; big = '케이가 말하는 중…'; small = '말이 끝나면 다시 듣겠습니다'; stageLive(''); }
    else if (t.indexOf('답하는') !== -1) { st = 'think'; big = '케이가 답하는 중…'; small = '잠시만 기다려 주세요'; }
    else if (t.indexOf('기다립니다') !== -1) { st = 'listen'; big = '듣는 중…'; small = '말씀을 기다리고 있습니다'; }
    else if (t) { st = 'listen'; big = '듣는 중…'; small = '다 말씀하셨으면 아래 [다 말했어요]'; }
    chatKStage.setAttribute('data-state', st);
    if (chatKStageText) chatKStageText.textContent = big;
    if (chatKStageHint) chatKStageHint.textContent = small;
    try { if (window.KCall) KCall.sync(st); } catch (e) {}          // v9.6: 전체 화면의 케이 모습도 그 상태로(듣는 · 생각하는 · 말하는)
    callCaption();
  }
  /* ---- v9.6 음성 대화 전체 화면 ----
   * 음성 대화를 켜면 케이가 화면 전체(허리 위 상반신)로 나오고, 아래에는 자막 · 상태 · 기존 단추만 남는다.
   *   자막 = 케이가 방금 한 말(대화 목록의 마지막 케이 말 — 답이 올 때마다 갱신) + 내가 한 말 한 줄(받아쓰는 중이면 그 글).
   *   자막을 누르거나 위로 쓸어 올리면 지난 대화가 펼쳐지고(.convo-log = 예전 음성 대화 화면 그대로), 다시 누르면 전체 화면.
   *   화면이 꺼지지 않게 한다(문서 뷰어와 같은 방식 · 음성 대화를 끄면 해제). 새 단추·새 설정 없음. */
  var callWake = null, callWakeNative = false;
  function callWakeOn(on) {
    on = !!on;
    try {
      if (on) {
        if (navigator.wakeLock && !callWake && !document.hidden) navigator.wakeLock.request('screen').then(function (l) { callWake = l; try { l.addEventListener('release', function () { callWake = null; }); } catch (e) {} }, function () {});
      } else if (callWake) { callWake.release(); callWake = null; }
    } catch (e) {}
    // 폰 앱: 웹 방식(navigator.wakeLock)이 거절되는 기기에서도 꺼지지 않게 창 자체에 「화면 켜 두기」를 건다(KBridge.keepScreenOn · v9.6 APK 부터, 옛 APK 는 조용히 지나감)
    if (on !== callWakeNative) {
      callWakeNative = on;
      try { var kb = kbPlugin(); if (kb && kb.keepScreenOn) { var pr = kb.keepScreenOn({ on: on }); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) {}
    }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && convoOn && chatView && chatView.classList.contains('convo-on') && isOpen(chatView)) callWakeOn(true); });
  function callCaption() {
    var k = $('kCallK'), me = $('kCallMe'); if (!k || !me || !chatView || !chatView.classList.contains('convo-full')) return;
    var lastK = '', lastMe = '', meNewer = false;
    for (var i = chatMsgs.length - 1; i >= 0 && (!lastK || !lastMe); i--) {
      var m = chatMsgs[i]; if (!m || m.notice) continue;
      if (!lastK && m.role === 'k' && m.text) lastK = String(m.text);
      else if (!lastMe && m.role === 'me' && m.text) { lastMe = String(m.text); if (!lastK) meNewer = true; }
    }
    if (meNewer) lastK = '';        // 내가 방금 한 말에 케이가 아직 답하지 않았으면 지난 답을 자막에 남기지 않는다(「나: …」 한 줄 + 위의 「답하는 중」)
    var live = ($('chatKStageLive') || {}).textContent || '';
    var kt = lastK.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); if (kt.length > 120) kt = kt.slice(0, 118) + '…';
    var mt = (live || lastMe).replace(/\s+/g, ' ').trim();
    if (k.textContent !== kt) k.textContent = kt;
    var mm = mt ? '나: ' + mt : '';
    if (me.textContent !== mm) me.textContent = mm;
  }
  function setConvoLog(open) {
    if (!chatView) return;
    chatView.classList.toggle('convo-log', !!open);
    var cap = $('kCallCap'), more = $('kCallMore');
    if (cap) cap.setAttribute('aria-label', open ? '전체 화면으로 돌아가기' : '지난 대화 펼치기');
    if (more) more.textContent = open ? '전체 화면으로' : '지난 대화 보기';
    if (open) { try { chatScrollBottom(); } catch (e) {} if (window.KChar) KChar.mount(); }
    else callCaption();
  }
  (function () {
    var cap = $('kCallCap'); if (!cap) return;
    var y0 = null;
    cap.addEventListener('click', function (ev) { ev.stopPropagation(); setConvoLog(!chatView.classList.contains('convo-log')); });
    cap.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cap.click(); } });
    cap.addEventListener('touchstart', function (ev) { y0 = ev.touches && ev.touches[0] ? ev.touches[0].clientY : null; }, { passive: true });
    cap.addEventListener('touchend', function (ev) {      // 위로 쓸어 올리면 펼침
      var y1 = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].clientY : null;
      if (y0 != null && y1 != null && y0 - y1 > 40 && !chatView.classList.contains('convo-log')) { ev.preventDefault(); setConvoLog(true); }
      y0 = null;
    });
  })();
  // 채팅 화면이 열려 있고 음성 대화 중일 때만 맨 위 「스마트비서」 머리줄을 접는다(다른 화면엔 영향 없음)
  function syncConvoMode() {
    var on = false;
    try { on = !!(convoOn && chatView && isOpen(chatView)); } catch (e) { on = false; }
    document.documentElement.classList.toggle('convo-mode', on);
    // v9.6: 화면 켜 두기 · 전체 화면의 케이 영상은 「음성 대화 중 + 채팅 화면이 열려 있을 때」만(채팅을 떠나면 멈추고, 돌아오면 다시)
    callWakeOn(on);
    try { if (window.KCall) { if (on && !KCall.active()) KCall.start(chatKStage ? chatKStage.getAttribute('data-state') : 'idle'); else if (!on && KCall.active()) KCall.stop(); } } catch (e) {}
  }
  function setConvoStage(on) {
    on = !!on;
    if (!chatView || chatView.classList.contains('convo-on') === on) { syncConvoMode(); return; }
    var wasBottom = chatNearBottom();              // 레이아웃이 바뀌기 전 위치(끌 때: 맨 아래였으면 맨 아래로 복귀)
    // v9.6(O-0387 7번): 효과가 시작할 자리(누른 단추의 지금 위치)와, 끌 때 통화 화면이 화면 전체였는지를 화면을 바꾸기 「전」에 재 둔다
    var kmFrom = null, kmWasFull = false;
    try { if (window.KMotion && chatConvoToggle) { kmFrom = chatConvoToggle.getBoundingClientRect(); kmWasFull = !on && KMotion.fullStage(chatView); } } catch (e) {}
    chatView.classList.toggle('convo-on', on);
    chatView.classList.toggle('convo-full', on);   // v9.6: 음성 대화 = 전체 화면
    chatView.classList.remove('convo-log');
    setConvoLog(false);
    syncConvoMode();                               // 화면 켜 두기 · 전체 화면의 케이(KCall)도 여기서 켜고 끈다
    if (window.KChar) {
      var head = chatView.querySelector('[data-kface="head"]');
      if (KChar.hold) KChar.hold(head, on);       // 큰 무대가 도는 동안 헤더의 작은 얼굴 영상은 멈춤(영상 1개만 재생)
      KChar.mount();                               // 무대 얼굴을 지금 옷·머리로 곧바로 그림
    }
    if (on) { scrollTop(); chatScrollBottom(); }   // 켤 때: 최근 대화가 무대 아래 상자 맨 아래에 보이게
    else if (wasBottom) chatScrollBottom();
    // v9.6(O-0387 7번): 화면은 위에서 이미 바뀌었다 — 그 위에 움직임만 얹는다(마이크·듣기 시작·종료 처리는 이 줄과 무관하게 예전 그 시점에 돈다)
    try {
      if (window.KMotion && isOpen(chatView)) {
        if (on) KMotion.callStart(kmFrom, chatView);
        else KMotion.callEnd(chatConvoToggle ? chatConvoToggle.getBoundingClientRect() : null, chatView, kmWasFull);
      }
    } catch (e) {}
  }
  function stopAmpPoll() { if (ampTimer) { clearInterval(ampTimer); ampTimer = null; } }
  function kaiPlaying() { return !!(kaiAudio && !kaiAudio.paused && !kaiAudio.ended && kaiAudio.currentTime > 0); }

  // O-0177: 「기다리는 답」 중 무대 탭으로 끊은 턴(m.vcut)은 빼고 본다 — 끊은 뒤엔 그 답을 기다리지 않고 새 말을 듣는다.
  //   (anyAwaiting 은 그대로 둔다: 입력창·안내 등 다른 곳은 예전 그대로)
  function awaitingLive() { return chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token && !m.vcut; }); }

  // 한 번의 듣기 turn 시작. auto=연속 대화 루프의 일부인지.
  function startListen(auto) {
    if (chatRecording || stt.on) {
      // v9.6: 이미 듣고 있던 중이면(음성 대화 중 대화를 펼쳐 「글」로 보내 목소리 답을 받은 경우 등) 듣기를 새로 열지는 않는다.
      //   다만 케이 목소리가 끝난 뒤의 차례(auto)인데 상태 알약이 「케이가 말하는 중…」으로 남아 있으면 아무도 되돌리지 않으므로, 여기서 듣는 문구로 되돌린다(문구는 듣기를 열 때 쓰는 것 그대로).
      if (auto && convoOn && isOpen(chatView)) setConvoStatus('말씀하세요… (끝나면 자동으로 보냅니다)');
      return;
    }
    if (!isOpen(chatView)) return;
    if (awaitingLive()) return;                   // 답 기다리는 중엔 안 들음
    if (kaiPlaying() || vqHasMore()) return;      // ⚠️ 케이 목소리 재생 중엔 녹음 안 함(자기 목소리 오인 방지) — O-0177 결정: 이 게이트 유지
    if (isRecording) { toast(REC_ROAM_V2 ? REC_BUSY_VOICE : '먼저 홈의 녹음을 마쳐 주세요.', REC_ROAM_V2 ? 3200 : 0); if (convoOn) stopConvo(true); return; }
    // O-0177 ②: 음성 대화 중이고 폰 받아쓰기가 되면 그걸로(실패하면 이 턴부터 아래 녹음 경로)
    if (auto && convoOn && sttUsable()) { unlockKaiAudio(); sttListen(); return; }
    startRecListen(auto);
  }
  function startRecListen(auto) {
    if (chatRecording || stt.on) return;
    if (!RecordingModule.isSupported()) { toast('이 기기에서는 음성 입력을 쓸 수 없습니다.'); if (convoOn) stopConvo(true); return; }
    unlockKaiAudio();
    var r = ensureChatRecorder();
    lsnSpoke = false; lsnSpeechMs = 0; lsnStartTs = Date.now(); lsnLastSound = Date.now(); lsnPendingSend = false; lsnReason = '';
    lsnVad = (window.KVad ? KVad.create(HF, lsnStartTs) : null);   // O-0177 ③ 소음 적응 판정(vad.js 없으면 아래 예전 판정)
    chatRecording = true; setChatMic(true);
    if (auto) setConvoStatus('말씀하세요… (끝나면 자동으로 보냅니다)');
    stageLive('');
    r.start();
    stopAmpPoll();
    ampTimer = setInterval(pollAmp, HF.POLL);
  }
  var lsnVad = null;
  function pollAmp() {
    if (!chatRecording) { stopAmpPoll(); return; }
    var r = chatRecorder; if (!r || !r.getAmplitude) return;
    if (ampBusy) return; ampBusy = true;
    r.getAmplitude().then(function (level) {
      ampBusy = false;
      if (!chatRecording) return;
      var now = Date.now();
      if (lsnVad) {
        var res = KVad.step(lsnVad, level, now);
        lsnSpoke = lsnVad.spoke;
        if (res) endListen(res);
        return;
      }
      if (level >= HF.THRESH) { lsnLastSound = now; lsnSpeechMs += HF.POLL; if (lsnSpeechMs >= HF.MIN_SPEECH_MS) lsnSpoke = true; }
      if (lsnSpoke && (now - lsnLastSound) >= HF.SILENCE_MS) { endListen('silence'); return; }
      if (!lsnSpoke && (now - lsnStartTs) >= HF.NOSPEECH_MS) { endListen('nospeech'); return; }
      if ((now - lsnStartTs) >= HF.MAX_TURN_MS) { endListen(lsnSpoke ? 'max' : 'nospeech'); return; }
    }).catch(function () { ampBusy = false; });
  }

  /* ==================== O-0177 ② 폰에서 바로 받아쓰기(KSpeech 네이티브 플러그인) ====================
   * 말하는 동안 안드로이드 인식기가 부분 결과(글자)를 계속 준다 → 무대 아래에 실시간 표시.
   * 말 끝: 부분 결과가 STT_END_MS(0.9초, 3초 넘게 말했으면 1.2초) 동안 바뀌지 않으면 인식기에 「마무리」를 시키고
   *        최종 글자(없으면 마지막 부분 결과)를 기존 글 경로(submit_memo)로 보낸다 — meta.voice+meta.stt='device'(음성 턴, PC 전사 생략).
   * 폴백: 플러그인 없음(옛 APK·PC판)·「사용 불가」·시작 실패·인식 오류 → 같은 턴을 곧장 녹음→PC 전사 경로로.
   *       실패가 두 번 쌓이거나 권한 거부면 이번 실행 동안은 받아쓰기를 끄고 녹음 경로만 쓴다(같은 실패를 매번 겪지 않게).
   * ⚠️ 소리 파일을 만들지 않으므로 서버에 오디오가 올라가지 않는다(지금보다 개인정보 노출이 줄어든다). */
  var KS = null;
  try { if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins) KS = Capacitor.Plugins.KSpeech || null; } catch (e) { KS = null; }
  var ks = { checked: false, ok: false, onDevice: false, fails: 0, off: false, p: null };
  // O-0189: stt.s = 말 끝 판정 상태(vad.js KVad.stt*) — 이어 붙인 글(acc)·지금 토막(cur)·마지막으로 말한 때·큰 소리 난 때
  var stt = { on: false, s: null, timer: null, finishing: false, finWait: null, why: '' };
  function sttUsable() { return !!(VC.DEVICE_STT && KS && ks.ok && !ks.off && window.KVad && KVad.sttNew) && !(window.SmartMarkup && SmartMarkup.micOn && SmartMarkup.micOn()); }   // O-0544: 수정 요청 메모 받아쓰기 중이면 채팅 받아쓰기를 켜지 않는다(녹음 경로로)
  function ksInit() {
    if (!VC.DEVICE_STT || !KS) return Promise.resolve(false);
    if (ks.p) return ks.p;
    try {
      KS.addListener('partial', function (e) { sttOnPartial(e && e.text); });
      KS.addListener('segment', function (e) { sttOnSegment(e || {}); });      // O-0189: 인식기가 스스로 끝낸 토막(다시 듣는 중)
      KS.addListener('rms', function (e) { sttOnRms(e && e.db); });            // O-0189: 소리 크기
      KS.addListener('speech', function () { if (stt.on && stt.s) stt.s.lastLoud = Date.now(); });
      KS.addListener('final', function (e) { sttDiag(e); sttOnFinal(e && e.text); });
      KS.addListener('error', function (e) { sttDiag(e); sttOnError(e || {}); });
      KS.addListener('diag', function (e) { if (e && e.k) sttDiag({ diag: e }); });   // O-0233: 듣기 시작(s)·준비됨(r) 때의 소리 통로 상태
    } catch (e) {}
    ks.p = KS.available().then(function (r) {
      ks.checked = true; ks.ok = !!(r && r.available); ks.onDevice = !!(r && r.onDevice);
      return ks.ok;
    }).catch(function () { ks.checked = true; ks.ok = false; return false; });
    return ks.p;
  }
  function stageLive(t, mode) {
    var el = $('chatKStageLive'); if (!el) return;
    t = String(t || '');
    if (t.length > 64) t = '…' + t.slice(-62);     // O-0189: 이어 붙여 길어지면 끝부분(방금 한 말)이 보이게
    el.textContent = t;
    el.className = 'kstage-live' + (mode ? ' ' + mode : '');
    try { callCaption(); } catch (e) {}            // v9.6: 전체 화면 자막의 「나:」 줄
  }
  /* O-0189(v8.9) 말 끝 판정 — 「말하고 있는데 끊고 보내 버린다」 고침
   *  v8.8 이 끊은 조건 두 가지(코드로 확인):
   *   (가) 부분 결과(글자)가 0.9초(3초 넘게 말했으면 1.2초) 안 바뀌면 끝 — 생각하며 1초만 쉬어도 걸린다. 인식기 자체 판정보다 늘 먼저 걸리는 쪽.
   *   (나) 인식기가 스스로 끝내 결과(onResults)를 주면 곧바로 전송 — v8.8 은 인식기에 「1.2~1.5초 조용하면 끝」이라고까지 알려 줬다.
   *  이제: 인식기는 이어 듣기(continuous) — 스스로 끝내도 보내지 않고 곧바로 다시 들으며 글을 이어 붙인다.
   *        보내는 때는 ① 새 글자도 큰 소리도 없이 「말 끝 기다림」(기본 2초)이 지났을 때 ② [다 말했어요]를 눌렀을 때 ③ 60초를 채웠을 때뿐.
   *  끝난 이유(quiet/manual/max)·말한 길이·토막 수는 meta.vend 로 PC에 보내 [지연] 로그에 남는다(글 내용 아님 — 다음에 원인 추적용). */
  function sttCfg() { return { endMs: endWaitMs(), noSpeechMs: VC.STT_NOSPEECH_MS, maxMs: VC.STT_MAX_MS }; }
  /* O-0233 효과음 진단 값 — 폰 플러그인이 알려 주는 「소리 통로 상태」를 이번 턴에 모아 두었다가 meta.vend.dg 로 PC에 보낸다.
   *  들어가는 것: 적용한 효과음 값·통로별 음량과 음소거 여부·줄이기 호출의 결과(성공/안 먹힘/예외 이름)·소리 출력 기기 종류·
   *              실제로 쓴 인식기·듣는 동안 소리를 낸 재생기의 쓰임새. 글 내용·소리·개인정보는 없다.
   *  s=듣기 시작 직후, r=준비됨 0.35초 뒤, e=끝(되돌리기 전). 옛 APK(v9.1 이하)는 이 값을 주지 않으므로 dg 칸이 그냥 빠진다. */
  function sttDiag(e) {
    if (!e || !stt.on) return;
    if (typeof e.onDevice === 'boolean') stt.od = e.onDevice;       // 실제로 쓴 인식기(기기 내/일반)
    var d = e.diag;
    if (!d || typeof d !== 'object' || !d.k) return;
    var k = String(d.k); if (k !== 's' && k !== 'r' && k !== 'e') return;
    var c = {}; for (var x in d) { if (x !== 'k' && Object.prototype.hasOwnProperty.call(d, x)) c[x] = d[x]; }
    (stt.dg = stt.dg || {})[k] = c;
  }
  function sttDiagTake() {
    var d = stt.dg; if (!d) return null;
    try {
      if (JSON.stringify(d).length <= 2400) return d;
      ['s', 'r', 'e'].forEach(function (k) { if (d[k]) { delete d[k].pb; delete d[k].pl; } });   // 너무 길면 재생기 목록부터 뺌
      return JSON.stringify(d).length <= 2400 ? d : { s: { m: d.s && d.s.m, act: d.s && d.s.act, cut: 1 } };
    } catch (x) { return null; }
  }
  function sttListen() {
    var now = Date.now();
    stt = { on: true, s: KVad.sttNew(now), timer: null, finishing: false, finWait: null, why: '', dg: null, od: null };
    setChatMic(true);
    setConvoStatus('말씀하세요… (끝나면 자동으로 보냅니다)');
    stageLive('');
    var w = endWaitMs();
    var me = stt;
    KS.start({ lang: 'ko-KR', partial: true, continuous: true, muteRestart: !!VC.STT_MUTE_RESTART, sfx: sfxMode,   // O-0223 효과음
               completeMs: w + 1500, possiblyMs: w + 1000, minMs: 3000 }).then(function (r) {
      if (me === stt && r && typeof r.onDevice === 'boolean' && stt.od === null) stt.od = r.onDevice;   // O-0233: 이번에 실제로 만든 인식기
    }).catch(function (e) {
      sttOnError({ reason: (e && e.code) || 'start' });
    });
    stt.timer = setInterval(sttTick, 150);
  }
  function sttCleanup() {
    if (stt.timer) { clearInterval(stt.timer); stt.timer = null; }
    if (stt.finWait) { clearTimeout(stt.finWait); stt.finWait = null; }
    stt.on = false; stt.finishing = false;
    setChatMic(false);
  }
  function sttTick() {
    if (!stt.on || stt.finishing) return;
    var now = Date.now();
    if (!isOpen(chatView) || document.hidden) {      // 화면을 떠나면 조용히 멈춤(돌아오면 visibilitychange 가 다시 듣기)
      sttCleanup(); try { KS.cancel(); } catch (e) {}
      if (convoOn) setConvoStatus('말씀을 기다립니다…');
      return;
    }
    var r = KVad.sttCheck(stt.s, now, sttCfg());
    if (r === 'quiet' || r === 'max') { sttFinish(r); return; }
    if (r === 'nospeech') { sttCleanup(); try { KS.cancel(); } catch (e) {} listenMiss('nospeech'); return; }
  }
  function sttFinish(why) {
    if (!stt.on || stt.finishing) return;
    stt.finishing = true; stt.why = why || 'quiet';
    stt.finAt = Date.now();                       // O-0210: 측정용(말 끝 기다림 값은 건드리지 않음)
    if (stt.timer) { clearInterval(stt.timer); stt.timer = null; }
    try { KS.stop(); } catch (e) {}
    stt.finWait = setTimeout(function () { try { KS.cancel(); } catch (e) {} sttDone(); }, VC.STT_FINAL_WAIT_MS);
  }
  function sttOnPartial(t) {
    if (!stt.on || stt.finishing) return;
    if (KVad.sttPartial(stt.s, t, Date.now())) stageLive(KVad.sttText(stt.s));
  }
  function sttOnSegment(e) {                          // 인식기가 스스로 끝냄 → 글만 이어 붙이고 계속 듣는다(보내지 않음)
    if (!stt.on || stt.finishing) return;
    KVad.sttSegment(stt.s, e.text, Date.now());
    stageLive(KVad.sttText(stt.s));
  }
  function sttOnRms(db) {
    if (!stt.on || stt.finishing) return;
    KVad.sttRms(stt.s, Number(db), Date.now(), VC.STT_LOUD_DB);
  }
  function sttOnFinal(t) {
    if (!stt.on) return;
    if (!stt.finishing) { sttOnSegment({ text: t }); return; }   // 마무리를 시킨 적이 없는데 온 결과(옛 방식 응답) → 토막으로만
    KVad.sttSegment(stt.s, t, Date.now());
    sttDone();
  }
  function sttOnError(e) {
    if (!stt.on) return;
    var why = String(e.reason || '');
    var has = !!KVad.sttText(stt.s);
    if (stt.finishing) { if (has) sttDone(); else { sttCleanup(); listenMiss('nospeech'); } return; }
    if (why === 'nospeech' || why === 'nomatch') {    // 이어 듣기가 안 되는 상황에서 온 「말 없음」 — 들은 게 있으면 그걸로
      if (has) { stt.why = 'rec-' + why; stt.finishing = true; sttDone(); } else { sttCleanup(); listenMiss('nospeech'); }
      return;
    }
    if (why === 'recording') {        // v9.8: 네이티브가 「회의 녹음 중」이라 받아쓰기를 열지 않았다 — 녹음 경로로 넘기지 않고 멈춘다
      sttCleanup(); try { KS.cancel(); } catch (x) {}
      toast(REC_BUSY_VOICE, 3200); if (convoOn) stopConvo(true);
      return;
    }
    ks.fails++;
    if (why === 'permission' || why === 'unavailable' || ks.fails >= 2) ks.off = true;
    if (has) { stt.why = 'err-' + (why || 'x'); stt.finishing = true; sttDone(); return; }   // 이미 들은 말은 버리지 않고 보냄
    sttCleanup(); try { KS.cancel(); } catch (x) {}
    if (convoOn && isOpen(chatView)) startRecListen(true);   // 같은 턴을 녹음 경로로 바로 이어서
  }
  function sttDone() {
    if (!stt.on) return;
    var s = stt.s, why = stt.why || 'quiet';
    sttCleanup();
    if (s.cur) KVad.sttSegment(s, '', Date.now());   // 남은 부분 결과가 있으면 이어 붙임
    var text = KVad.sttText(s);
    if (!text) { listenMiss('nospeech'); return; }
    convoMiss = 0; ks.fails = 0;
    var imgs = chatPendingImages.slice(); chatPendingImages = []; renderPending();
    if (convoOn) setConvoStatus('케이가 답하는 중…');
    stageLive(text, 'sent');
    // O-0233: od = 이번 턴에 「실제로 쓴」 인식기(예전에는 앱을 켤 때 한 번 물어본 값이라, 기기 내 인식이 안 돼 일반 인식기로 넘어가도 기기내로 찍혔다)
    var vend = { p: 'dev', end: why, wait: endWaitMs(), ms: Math.max(0, (s.lastAct || 0) - (s.first || s.t0)),
                 total: Date.now() - s.t0, segs: s.segs, od: (typeof stt.od === 'boolean' ? stt.od : ks.onDevice) ? 1 : 0,
                 fin: stt.finAt ? Math.max(0, Date.now() - stt.finAt) : 0,   // O-0210: 말 끝 판정 → 보내기까지(마지막 글자 기다림)
                 sfx: sfxMode };                                               // O-0233: 이 턴에 고른 효과음 값
    var dg = sttDiagTake(); if (dg) vend.dg = dg;                              // O-0233: 소리 통로 진단 값(있을 때만)
    sendChatTurnUI({ text: text, files: imgs, sttDevice: true, opus: takeOpus(), vend: vend, replyTo: takeReplyVoice(text) });   // (O-0545) 답장 띠가 있으면 이 턴에(음성 대화 중엔 3글자 이상일 때만)
  }
  // O-0189 [다 말했어요] — 기다리지 않고 지금 보내기(받아쓰기·녹음 경로 공통)
  function sayDone() {
    if (stt.on) { if (!stt.finishing) sttFinish('manual'); return; }
    if (chatRecording) { endListen('manualsend'); return; }
  }
  function listenMiss(reason) {
    if (convoOn) {
      convoMiss++;
      if (convoMiss >= HF.MAX_MISS) { stopConvo(true); toast('말씀이 없어 대화를 멈췄습니다. 다시 시작하려면 「음성 대화」를 켜세요.'); }
      else { setConvoStatus('말씀을 기다립니다…'); scheduleNextListen(500); }
    } else if (reason === 'nospeech') toast('말씀이 안 들렸습니다. 다시 눌러 말씀해 주세요.');
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && convoOn && isOpen(chatView) && !stt.on && !chatRecording) scheduleNextListen(500);
  });

  /* ==================== O-0177 ④ 무대(케이 얼굴) 탭 → 말 끊고 듣기 ====================
   * 대표님 결정(2026-10-03): 「케이 얼굴 눌러서 내가 다시 말하는 게 낫겠어」 — 목소리로 끼어들기는 만들지 않는다
   * (케이 재생 중 마이크를 끄는 기존 게이트 그대로). 무대 전체가 누르는 자리.
   *   · 케이가 말하는 중·답을 만드는 중 → 소리 즉시 멈춤 + 남은 조각 버림 + 「듣고 있어요」 + 바로 듣기.
   *     PC 쪽 답 만들기는 계속되고, 그 답은 글로 채팅에 남는다(목소리는 안 나옴). 새 말은 다음 턴으로.
   *   · 이미 듣는 중이면 안내만. */
  function onStageTap() {
    if (!VC.TAP_CUT || !convoOn) return;
    if (stt.on || chatRecording) { toast('듣고 있습니다. 말씀하세요.'); return; }
    vqCut();
    nextListenArmed = false;
    toast('듣고 있습니다.');
    startListen(true);
  }
  if (chatKStage) { chatKStage.addEventListener('click', onStageTap); if (!VC.TAP_CUT) chatKStage.classList.add('notap'); }
  // O-0189: 무대의 [다 말했어요](지금 보내기) · 「기다림」 칩(짧게/보통/길게) — 무대 탭(말 끊기)으로 번지지 않게 stopPropagation
  (function () {
    var b = $('chatKStageSend'), w = $('chatKStageWait');
    if (b) b.addEventListener('click', function (ev) { ev.stopPropagation(); sayDone(); });
    if (w) w.addEventListener('click', function (ev) { ev.stopPropagation(); cycleEndWait(); });
    applyEndWait();
  })();
  function endListen(reason) {
    if (!chatRecording) return;
    stopAmpPoll();
    lsnReason = reason;
    lsnPendingSend = (reason === 'silence' || reason === 'max' || reason === 'manualsend');
    chatRecording = false;                        // onAudio → onListenAudio 곧 옴
    try { chatRecorder.stop(); } catch (e) {}
  }
  function onListenAudio(blob) {
    if (chatMicLabel) chatMicLabel.textContent = '눌러서 말하기';
    var doSend = lsnPendingSend && blob;
    if (doSend) {
      convoMiss = 0;
      var imgs = chatPendingImages.slice(); chatPendingImages = []; renderPending();
      if (convoOn) setConvoStatus('케이가 답하는 중…');
      var vend = convoOn ? { p: 'rec', end: lsnReason, wait: endWaitMs(), total: Date.now() - lsnStartTs } : null;   // O-0189 끝난 이유(로그용)
      sendChatTurnUI({ text: '', files: imgs, audioBlob: blob, opus: takeOpus(), vend: vend, replyTo: takeReplyVoice(null) });   // 음성(+있으면 사진) 전송 · v5.8 오퍼스 1회 · (O-0545) 답장
    } else {
      listenMiss(lsnReason);                     // 말이 없었음/취소(O-0177: 받아쓰기 경로와 같은 처리로 묶음)
    }
  }
  function scheduleNextListen(delay) {
    if (!convoOn || nextListenArmed) return;
    nextListenArmed = true;
    setTimeout(function () {
      nextListenArmed = false;
      if (convoOn && isOpen(chatView) && !awaitingLive() && !kaiPlaying() && !vqHasMore()) startListen(true);
    }, delay || 400);
  }
  var REC_BUSY_VOICE = '회의 녹음 중에는 음성 대화를 쓸 수 없습니다. 글로 보내 주십시오.';
  function startConvo() {
    if (convoOn) return;
    if (REC_ROAM_V2 && isRecording) { toast(REC_BUSY_VOICE, 3200); return; }   // v9.8: 켜졌다 꺼지지 않게 누르는 순간 막는다
    convoOn = true; convoMiss = 0; updateConvoToggle();
    restartChatReconcile();                       // O-0177: 음성 대화 중엔 답 확인을 빠르게
    toast('음성 대화를 시작합니다. 말씀하시면 자동으로 오갑니다. 끝내려면 다시 누르세요.');
    // O-0177 ②: 받아쓰기 가능 여부를 먼저 확인(첫 확인만 0.1초 안팎) → 그다음 듣기 시작
    ksInit().then(function () {
      if (!convoOn) return;
      if (!awaitingLive() && !kaiPlaying()) startListen(true);
      else setConvoStatus('케이가 답하는 중…');
    });
  }
  function stopConvo(auto) {
    convoOn = false; nextListenArmed = false; convoMiss = 0;
    updateConvoToggle(); stopAmpPoll();
    restartChatReconcile();                       // O-0177: 확인 간격을 평소(2.5초)로
    if (stt.on) { sttCleanup(); try { KS.cancel(); } catch (e) {} }   // O-0177 ②
    vqReset(null); stageLive('');
    if (chatRecording) { chatRecording = false; lsnPendingSend = false; try { chatRecorder.stop(); } catch (e) {} }
    try { if (kaiAudio) kaiAudio.pause(); } catch (e) {}
    setConvoStatus(null);
    if (chatMicLabel) chatMicLabel.textContent = '눌러서 말하기';
    if (!auto) toast('음성 대화를 끝냈습니다.');
  }
  function updateConvoToggle() {
    if (chatConvoToggle) {
      chatConvoToggle.setAttribute('aria-pressed', convoOn ? 'true' : 'false');
      if (chatConvoLabel) chatConvoLabel.textContent = convoOn ? '대화 끝내기' : '음성 대화 시작';
    }
    if (chatMic) chatMic.disabled = convoOn;      // 연속 대화 중엔 단발 마이크 비활성(루프가 제어)
    if (!convoOn) setConvoStatus(null);
    setConvoStage(convoOn);                       // (O-0124) 음성 대화 무대 켜기/끄기
  }
  // 단발(한 번 누르면 말 끝날 때 자동 전송). 듣는 중 다시 누르면 지금 보내기(자동종료 안 될 때 대비).
  function toggleChatMic() {
    if (convoOn) { toast('음성 대화 중입니다.'); return; }
    if (anyAwaiting()) { toast('앞 답을 받은 뒤에 말할 수 있습니다.'); return; }
    if (isRecording) { toast(REC_ROAM_V2 ? REC_BUSY_VOICE : '먼저 홈의 녹음을 마쳐 주세요.', REC_ROAM_V2 ? 3200 : 0); return; }
    if (!chatRecording) startListen(false);
    else endListen('manualsend');
  }

  /* ---- 답변별 [듣기]: 평소엔 그 답의 mp3 가 없으니 "온디맨드"로 그때 생성해 재생 ----
   * (안 들을 답은 생성 안 함 = 가장 효율적) 이미 vurl 이 있으면(연속 대화 등) 바로 재생. */
  function findKByLid(lid) { for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].role === 'k' && chatMsgs[i].lid === lid) return chatMsgs[i]; } return null; }
  /* ---- O-0468 [듣기]의 상태 = 한 번에 한 말풍선(「다시 누르면 멈추게」) ----
   *   listenSt = { lid, ph:'load'(목소리 준비 중)|'play'(읽는 중), dev(이 기기 음성으로 읽는 중) } · 없으면 모두 [듣기]
   *   예전에는 단추(DOM)에 표시를 붙여 두어서, 새 메시지가 와 채팅을 다시 그리면 표시가 사라지고 「다시 누름」은 처음부터 다시 틀었다(멈출 길이 없었다).
   *   · 읽는 중인 단추를 다시 누름 → 바로 멈춤 · 다른 말풍선을 누름 → 앞 소리는 멈추고 새것(겹치지 않는다)
   *   · 준비 중에 다시 누름 → 기다림을 그만둔다(준비가 끝나도 틀지 않는다). PC 에 이미 청한 소리는 받아만 둔다 → 다음에 누르면 바로 나온다(같은 글을 두 번 청하지 않는다)
   *   · 단추 글·모양은 listenFace 한 곳에서 정한다(채팅을 다시 그려도 같다).  LISTEN_STOP=false 면 예전 동작(다시 누르면 처음부터 · 준비 중엔 못 누름). */
  var LISTEN_STOP = true;
  var listenSt = null, listenTapT = 0;
  var ttsJobs = {};                                  // lid → { id, tok } : PC 에 청해 둔 목소리(아직 만드는 중)
  function listenBtnOf(lid) { return (chatLog && lid) ? chatLog.querySelector('.voiceplay[data-lid="' + lid + '"]') : null; }
  function listenFace(m) {                           // [붙일 class, 속 글, 화면 읽기용 이름]
    var st = (listenSt && listenSt.lid === m.lid) ? listenSt : null;
    if (st && st.ph === 'load') return ['loading', '<svg><use href="#i-sound"/></svg>준비 중…', LISTEN_STOP ? '목소리 준비 중 · 누르면 그만둡니다' : '목소리 준비 중'];
    if (st && LISTEN_STOP) return ['playing', '<svg><use href="#i-stop"/></svg>멈춤', '읽는 중 · 누르면 멈춥니다'];
    // v8.3(O-0161): 사무소가 미리 목소리를 붙여 보낸 방송(아침 브리핑 --tts)은 「▶ 듣기」(아직 안 들은 것). 그 밖은 예전 그대로.
    return [st ? 'playing' : '', '<svg><use href="#i-sound"/></svg>' + (m.vurl ? ((m.bid && m.vtts && !m.vplayed) ? '▶ 듣기' : '다시 듣기') : '듣기'), ''];
  }
  function listenBtnHtml(m) {
    var f = listenFace(m);
    return '<button type="button" class="voiceplay' + (f[0] ? ' ' + f[0] : '') + '" data-lid="' + m.lid + '"' + (f[2] ? ' aria-label="' + f[2] + '"' : '') +
      (f[0] === 'playing' && LISTEN_STOP ? ' aria-pressed="true"' : '') + (f[0] === 'loading' && !LISTEN_STOP ? ' disabled' : '') + '>' + f[1] + '</button>';
  }
  function listenPaint(lid) {                        // 그 말풍선 단추만 지금 상태로 고쳐 그린다(채팅 전체를 다시 그리지 않는다)
    var b = listenBtnOf(lid), m = b ? findKByLid(lid) : null; if (!m) return;
    var f = listenFace(m);
    b.classList.toggle('playing', f[0] === 'playing'); b.classList.toggle('loading', f[0] === 'loading');
    if (f[2]) b.setAttribute('aria-label', f[2]); else b.removeAttribute('aria-label');
    if (f[0] === 'playing' && LISTEN_STOP) b.setAttribute('aria-pressed', 'true'); else b.removeAttribute('aria-pressed');
    if (f[0] === 'loading' && !LISTEN_STOP) b.setAttribute('disabled', ''); else b.removeAttribute('disabled');
    b.innerHTML = f[1];
  }
  function listenSet(lid, ph, dev) {
    var old = listenSt;
    listenSt = { lid: lid, ph: ph, dev: !!dev };
    if (old && old.lid !== lid) listenPaint(old.lid);
    listenPaint(lid);
    return listenSt;
  }
  function listenClear() { var st = listenSt; if (!st) return; listenSt = null; listenPaint(st.lid); }
  function listenAudioEnd() { if (listenSt && listenSt.ph === 'play' && !listenSt.dev) listenClear(); }   // 케이 목소리(mp3)가 멈췄다
  /* 지금 [듣기]로 나는 소리·기다림을 끝낸다. [멈춤]을 누른 때(user=true)와, 다른 말풍선의 [듣기]를 누른 때(user=false) 쓴다. */
  function listenStop(user) {
    var st = listenSt; if (!st) return false;
    listenSt = null;
    if (st.ph === 'play') {
      if (st.dev) { try { if (window.KChar) KChar.voice.stop(); } catch (e) {} }
      else { kaiStopSeq = kaiPlaySeq; try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {} }
    }
    listenPaint(st.lid);
    // 음성 대화 중에 자동으로 나오던 답을 [멈춤]으로 끊었으면 — 목소리가 끝났을 때와 같이 다음 말을 듣는다(대화가 멈춰 서지 않게)
    if (user && st.ph === 'play' && !st.dev && convoOn) scheduleNextListen(350);
    return true;
  }
  /* v9.8(O-0442) 회의 녹음 중에 소리를 내려 할 때 — 한 번 확인한 뒤 재생한다(스피커 소리가 회의 자리에 나고 녹음에도 들어간다).
   *   이미 나고 있는 소리를 멈추는 누름은 묻지 않는다. */
  function recSoundGuard(go) {
    if (!REC_ROAM_V2 || !isRecording) { go(); return; }
    openSheet('회의 녹음 중입니다', '지금 들으시면 폰에서 소리가 나고 녹음에도 들어갑니다.', '그래도 듣기', go, null, null,
      { cancelLabel: '닫기', positive: true, icon: 'i-sound' });
  }
  function onListenBtn(lid, btn) {
    if (listenSt && listenSt.lid === lid) {            // 지금 읽는 중·준비 중인 그 단추를 다시 눌렀다 — 묻지 않는다
      if (Date.now() - listenTapT < 350) return;       //   연달아 두 번 눌린 것(더블 탭)은 한 번으로 본다 — 켜자마자 꺼지지 않게
      if (LISTEN_STOP || listenSt.dev) { listenStop(true); return; }
      if (listenSt.ph === 'load') return;
      onListenBtnGo(lid); return;                      // (LISTEN_STOP=false) 예전처럼 처음부터 다시
    }
    listenTapT = Date.now();
    recSoundGuard(function () { onListenBtnGo(lid); });
  }
  function onListenBtnGo(lid) {
    var m = findKByLid(lid); if (!m) return;
    listenStop(false);                                 // 앞의 소리·기다림은 여기서 끝낸다(둘이 겹쳐 나지 않게)
    m._recAsk = !!isRecording;                         // 녹음 중에 「그래도 듣기」로 청한 것 — 준비되면 바로 틀어도 된다
    // v6.0: 「목소리」에서 이 기기 음성을 골랐으면 PC 요청 없이 바로 기기에서 읽는다(무료·즉시).
    var dv = KV_DEVICE && window.KChar && KChar.voice.active();   // O-0490: 기기 음성을 뺐다(KV_DEVICE=false) — 골라 두신 저장값이 있어도 PC 가 만든 케이 목소리로 간다
    if (dv && m.text) {
      try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {}
      var st = listenSet(lid, 'play', true);
      var fin = function () { if (listenSt === st) listenClear(); };
      if (KChar.voice.speak(m.text, dv, { onend: fin, onerror: fin })) return;
      fin();                                           // 기기 음성 실패 → 아래 케이 기본 목소리로
    }
    if (window.KChar && KChar.voice.speaking()) KChar.voice.stop();
    unlockKaiAudio();
    // v8.3: 사무소가 미리 붙인 목소리(서명 주소 7일)는 6일 반이 지나면 만료로 보고 그때 새로 만든다(예전 [듣기]와 같은 길)
    if (m.vurl && m.vtts && m.ts && (Date.now() - m.ts) > 6.5 * 86400000) { m.vurl = null; m.vtts = false; }
    if (m.vurl) {
      if (m.vtts && !m.vplayed) { m.vplayed = true; saveChatMsgs(); }
      playKaiVoice(m.vurl, lid); return;
    }
    listenSet(lid, 'load', false);
    if (ttsJobs[lid]) return;                          // 앞서 청해 둔 소리가 아직 만들어지는 중 — 다시 청하지 않고 그것을 기다린다
    var job = ttsJobs[lid] = { id: OfficeBridge.uuid(), tok: OfficeBridge.token(), t0: Date.now(), told: false, away: false };
    OfficeBridge.requestTts(job.id, job.tok, m.text || '').then(function () {
      pollTts(job, m, 0);
    }).catch(function () { ttsEnd(job, m, '준비하지 못했습니다. 다시 눌러\u00a0주십시오.'); });
  }
  function ttsWaiting(m) { return !!(listenSt && listenSt.ph === 'load' && listenSt.lid === m.lid); }   // 화면에서 이 소리를 기다리는 중인가
  function ttsEnd(job, m, msg) {                       // 못 만든 채로 끝남 — 기다리던 중이면 단추를 되돌리고 알린다(그만둔 뒤면 조용히)
    if (ttsJobs[m.lid] === job) delete ttsJobs[m.lid];
    if (!ttsWaiting(m)) return;
    listenClear(); toast(tw(msg));
  }
  /* 기다리는 방식(O-0468 이어서): 느린 목소리로 긴 글이면 몇 분이 걸린다.
   *   · 0.7초마다 확인, 1분이 넘으면 2초마다. PC 가 알려 준 시간(kvListenWaitS)을 넘기면 그만둔다(안 알려 주면 예전처럼 40번).
   *     그만두기 전에 한 번은 꼭 확인한다 — 앱이 뒤에 가 있던 동안 이미 다 만들어졌을 수 있다.
   *   · 10초가 넘으면 한 번만 「만드는 중」 안내. 단추는 그동안 「준비 중…」(다시 누르면 그만둔다).
   *   · 다 됐을 때 채팅 화면이 아니거나 앱이 뒤에 있었으면 틀지 않는다 → 단추 「다시 듣기」 + 안내(갑자기 소리가 나지 않게). */
  var TTS_READY_NOTE = '「다시\u00a0듣기」를 누르면 들립니다.';
  var ttsReadyHeld = false;                            // 앱이 뒤에 있을 때 준비가 끝남 → 돌아오면 한 번 알린다
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { for (var k in ttsJobs) ttsJobs[k].away = true; return; }
    if (ttsReadyHeld) { ttsReadyHeld = false; toast(tw(TTS_READY_NOTE), 3500); }
  });
  function pollTts(job, m, tries) {
    if (ttsJobs[m.lid] !== job) return;
    OfficeBridge.poll(job.id, job.tok).then(function (res) {
      if (ttsJobs[m.lid] !== job) return;
      if (res && res.status === 'done') {
        var url = res.summary_json && res.summary_json.voice_url;
        if (!url) { ttsEnd(job, m, '음성을 만들지 못했습니다.'); return; }
        var waiting = ttsWaiting(m);
        delete ttsJobs[m.lid];
        m.vurl = url; saveChatMsgs();
        if (!waiting) { listenPaint(m.lid); return; }  // 기다림을 그만두셨다 — 받아만 두고 틀지 않는다(단추 글만 「다시 듣기」로)
        // v9.8: 준비를 청한 뒤에 회의 녹음이 시작됐다면 저절로 틀지 않는다(회의 자리에 소리가 난다)
        var away = job.away || document.hidden || !isOpen(chatView);
        if ((REC_ROAM_V2 && isRecording && !m._recAsk) || away) {
          listenClear();
          if (document.hidden) ttsReadyHeld = true; else toast(tw(TTS_READY_NOTE), 3500);
        }
        else playKaiVoice(url, m.lid);
      } else ttsAgain(job, m, tries, 700);
    }).catch(function () { ttsAgain(job, m, tries, 900); });
  }
  function ttsAgain(job, m, tries, gap) {
    if (ttsJobs[m.lid] !== job) return;
    var el = Date.now() - job.t0, w = kvListenWaitS();
    if (w ? el > w * 1000 : tries >= 40) { ttsEnd(job, m, '준비가 지연됩니다. 다시 눌러\u00a0주십시오.'); return; }
    if (!job.told && el > 10000 && ttsWaiting(m) && isOpen(chatView) && !document.hidden) { job.told = true; toast(tw('목소리 준비 중입니다. 누르면 그만둡니다.'), 3200); }
    setTimeout(function () { pollTts(job, m, tries + 1); }, el > 60000 ? Math.max(gap, 2000) : gap);
  }

  /* ---- 카메라/갤러리: 케이에게 보여줄 사진 붙이기(전송 전 대기) ---- */
  function renderPending() {
    if (!chatPendingStrip) return;
    if (!chatPendingImages.length && !chatPendingFiles.length) { chatPendingStrip.style.display = 'none'; chatPendingStrip.innerHTML = ''; return; }
    chatPendingStrip.style.display = 'flex';
    chatPendingStrip.innerHTML = '';
    // 사진 미리보기(썸네일)
    chatPendingImages.forEach(function (f, i) {
      var d = document.createElement('div'); d.className = 'pend';
      var im = document.createElement('img');
      thumbSrc(im, f);                            // v6.6: readAsDataURL(통째 읽기) → 주소만
      var b = document.createElement('button'); b.className = 'rm'; b.type = 'button';
      b.innerHTML = '<svg><use href="#i-x"/></svg>';
      b.addEventListener('click', function () { chatPendingImages.splice(i, 1); renderPending(); });
      d.appendChild(im); d.appendChild(b); chatPendingStrip.appendChild(d);
    });
    // 첨부 파일 — 그림이면 썸네일, 그 밖은 이름칩(고른 순서 그대로)
    chatPendingFiles.forEach(function (f, i) {
      var isImg = fileKindOf(f.type, f.name) === 'image';
      var b = document.createElement('button'); b.className = 'rm'; b.type = 'button';
      b.innerHTML = '<svg><use href="#i-x"/></svg>';
      b.addEventListener('click', function () { chatPendingFiles.splice(i, 1); renderPending(); });
      var d = document.createElement('div');
      if (isImg) {
        d.className = 'pend';
        var im = document.createElement('img');
        thumbSrc(im, f);                          // v6.6
        d.appendChild(im); d.appendChild(b);
      } else {
        d.className = 'pend pendfile';
        var ic = document.createElement('span'); ic.className = 'pf-ic';
        ic.innerHTML = '<svg><use href="#' + attachIcon({ mime: f.type, name: f.name }) + '"/></svg>';
        var nm = document.createElement('span'); nm.className = 'pf-name'; nm.textContent = f.name || '파일';
        var sz = document.createElement('span'); sz.className = 'pf-sz'; sz.textContent = f.size ? fmtBytes(f.size) : '';
        d.appendChild(ic); d.appendChild(nm); if (sz.textContent) d.appendChild(sz); d.appendChild(b);
      }
      chatPendingStrip.appendChild(d);
    });
  }
  function onChatCamPicked(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    arr = keepSendable(arr);                      // v6.6: 각 45MB(말없이 뺌) → 5GB(넘으면 안내)
    var removed = arr.removed;
    var room = Math.max(0, 6 - chatPendingImages.length);
    if (arr.length > room) { arr = arr.slice(0, room); toast('사진은 한 번에 최대 6장까지입니다.'); }
    if (!arr.length) return;
    chatPendingImages = chatPendingImages.concat(arr);
    renderPending();
    if (!removed) toast('사진을 붙였습니다. 말하거나 질문을 적어 보내세요.');
  }
  function findMsg(id) { for (var i = 0; i < chatMsgs.length; i++) if (chatMsgs[i].id === id) return chatMsgs[i]; return null; }
  function startChatReconcile() {
    if (chatTimer) return;
    reconcileChat();
    // O-0177: 음성 대화 중엔 VC.POLL_FAST_MS(0.6초)마다 — 목소리 조각·답을 빨리 받는다. 평소엔 예전 2.5초.
    chatTimer = setInterval(reconcileChat, (convoOn && VC.POLL_FAST_MS) ? VC.POLL_FAST_MS : 2500);
  }
  function stopChatReconcile() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }
  function restartChatReconcile() { if (chatTimer) { stopChatReconcile(); startChatReconcile(); } }
  // 대기 중인 질문들의 답을 RPC로 확인해 반영(화면 밖에서도 계속 — 대원칙: 다른 기능과 독립)
  function reconcileChat() {
    var pending = chatMsgs.filter(function (m) { return m.role === 'me' && !m.answered && m.id && m.token; });
    if (!pending.length) { stopChatReconcile(); updateSendEnabled(); return; }
    var nowT = Date.now(), slowChanged = false;
    // ⏰ 하드 타임아웃 sweep(2026-09-22, poll 결과와 독립) — 예전엔 이 시간초과 판정이 poll 의 .then 안에만
    //   있어서, 네트워크가 멈춰 poll 이 영영 안 끝나거나 서버 불통으로 계속 실패하면 답도 못 받고
    //   입력창도 영영 안 풀렸다("한 번 보내면 다음 전송 안 됨"). 이제 벽시계로 직접 풀어준다:
    //   보낸 지 텍스트 6분·첨부 20분이 지나면 poll 상태와 무관하게 answered 로 확정해 잠금을 해제한다.
    var gaveUp = false;
    pending.forEach(function (m) {
      var limitMs = ((m.files || m.opus) ? 20 : 6) * 60 * 1000;   // v5.8: 오퍼스 지정도 첨부처럼 여유(창구 상한 10분)
      if ((nowT - (m.waitFrom || m.ts || 0)) > limitMs) {   // v8.2: 알림 답장은 앱이 넘겨받은 때(waitFrom)부터
        m.answered = true; m._polling = false; m._doneShown = true;
        chatMsgs.push({ role: 'k', text: '죄송합니다, 제 답이 너무 늦어지고 있습니다. 다시 한 번 말씀해 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
        gaveUp = true;
      }
    });
    if (gaveUp) { saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled(); }
    // 아직 시간이 안 지난 대기 메시지만 다시 추린다(방금 풀린 것 제외).
    pending = chatMsgs.filter(function (m) { return m.role === 'me' && !m.answered && m.id && m.token; });
    if (!pending.length) { stopChatReconcile(); updateSendEnabled(); return; }
    // 답이 늦어지면(약 35초) 한 번만 재렌더 → "케이가 PC에서 확인 중이에요" 안내가 뜨게 한다
    pending.forEach(function (m) { if (!m._slowShown && (nowT - (m.waitFrom || m.ts || 0)) > 35000) { m._slowShown = true; slowChanged = true; } });
    if (slowChanged && isOpen(chatView)) renderChat();
    pending.forEach(function (m) {
      if (m._polling) return; m._polling = true;
      OfficeBridge.poll(m.id, m.token).then(function (res) {
        m._polling = false;
        if (chatMsgs.indexOf(m) === -1) return;    // 사이에 이 질문이 삭제됐으면 답을 붙이지 않음
        if (m.answered || m._doneShown) return;    // 하드 타임아웃 sweep 이 이미 풀었으면 중복 처리 안 함
        if (res && res.status && res.status !== 'done' && markMsgStat(m, res.status) && isOpen(chatView)) renderChat();   // v9.6: 보낸 말 아래 「보냄 → 받았습니다」
        if (res && res.status !== 'done') setAwaitProg(m, res);       // v8.4(O-0162) 진행 표시
        // O-0177 ①: 처리 중에도 목소리 조각이 붙어 있으면 바로 이어 재생(음성 대화 중·끊지 않은 턴만)
        if (res && res.status !== 'done' && m.vs && res.summary_json && Array.isArray(res.summary_json.voice_parts) &&
            convoOn && !m.vcut && isOpen(chatView)) {
          if (m.vin && !m.text && res.transcript) { m.text = String(res.transcript).trim(); saveChatMsgs(); renderChat(); }   // 내 말풍선도 먼저 채움
          if (res.summary_json.voice_parts.length) vlatMark(m.id, 'p1');   // O-0210
          vqFeed(m, res.summary_json.voice_parts);
        }
        if (res && res.status === 'done') {
          m.answered = true; m._doneShown = true; m.prog = '';
          if (m.vin) m.text = (res.transcript || '').trim() || '(음성)';   // 음성 질문 → 전사문을 내 말풍선에 채움
          var reply = res.content_md || (res.summary_json && res.summary_json.reply) || '죄송합니다, 답을 만들지 못했습니다. 다시 한 번 말씀해 주세요.';
          var atts = OfficeBridge.attachmentsFrom(res);   // 케이가 보낸 첨부(하향)
          var vurl = res.summary_json && res.summary_json.voice_url;   // 케이 목소리(mp3)
          var vparts = res.summary_json && Array.isArray(res.summary_json.voice_parts) ? res.summary_json.voice_parts : null;   // O-0177 ①
          if (vparts && vparts.length) vlatMark(m.id, 'p1');
          vlatMark(m.id, 'done');                     // O-0210
          // O-0210 ⑥: PC가 목소리를 못 만든 턴(voice_fail: 못 만든 조각 수, 전부면 -1)은 알려 준다. 옛 PC는 이 칸을 안 보낸다 = 예전 그대로.
          var vfail = res.summary_json ? Number(res.summary_json.voice_fail || 0) : 0;
          if (vfail && convoOn && !m.vcut && isOpen(chatView)) {
            toast(vfail < 0 ? '목소리를 만들지 못했습니다. 답은 글로 남겼습니다.' : '목소리 일부를 만들지 못했습니다. 답 전체는 글로 확인해 주세요.');
          }
          if (m.vcut) { vurl = null; vparts = null; }   // O-0177 ④: 무대 탭으로 끊은 턴 — 답은 글로만
          var kmsg = { role: 'k', text: reply, ts: Date.now(), rid: m.id };   // v4.0: 답도 같은 행 id(삭제 시 함께 숨김)
          if (atts.length) kmsg.files = atts;
          if (vurl) kmsg.vurl = vurl;
          chatMsgs.push(kmsg);
          saveChatMsgs();
          setTimeout(pollOrderCards, 1500);          // v5.8: 답이 오면 작업 카드도 곧바로 갱신(PC가 대장에 결과를 막 적은 직후)
          if (isOpen(chatView)) {
            renderChat();
            if (vparts && vparts.length && convoOn) {   // O-0177 ①: 조각 목소리 — 남은 조각까지 이어 재생, 다 끝나면 다음 듣기
              vqFeed(m, vparts);
              if (!(kaiAudio && !kaiAudio.paused && !kaiAudio.ended) && !vqHasMore()) scheduleNextListen(350);
            } else if (vurl) {                   // 음성 대화 모드 답 → 즉시 자동재생(끝나면 다음 듣기)
              if (convoOn) setConvoStatus('케이가 말하는 중…');
              setTimeout(function () {
                var ks = chatLog.querySelectorAll('.bubble.k .voiceplay');
                playKaiVoice(vurl, ks.length ? ks[ks.length - 1] : null);
              }, 80);
            } else if (convoOn) {                // 음성 답이 없으면(생성 실패 등) 곧장 다음 듣기
              scheduleNextListen(700);
            }
          }
          else { chatUnseen++; updateChatBadge(); toast(vurl ? '케이가 음성으로 답했습니다.' : (atts.length ? '케이가 파일을 보냈습니다.' : '케이 답장이 도착했습니다.')); }
          updateSendEnabled();
        } else if (Date.now() - (m.waitFrom || m.ts || 0) > ((m.files || m.opus) ? 20 : 6) * 60 * 1000) {   // 파일 첨부·오퍼스 지정은 여유롭게
          m.answered = true;
          chatMsgs.push({ role: 'k', text: '죄송합니다, 제 답이 너무 늦어지고 있습니다. 다시 한 번 말씀해 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
          saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
        }
      }).catch(function () { m._polling = false; });
    });
  }
  /* ==================== v8.4(O-0162) ① 케이가 지금 뭐 하는지 · ② PC 케이 상태 점 ====================
   * ① PC 채팅 응답기가 처리 중인 행의 progress_msg 에 「캘린더 확인 중…」「문서 읽는 중…」 같은 한 줄을 남긴다.
   *    앱은 원래 2.5초마다 부르던 get_voice_memo(poll) 결과에서 그 줄만 꺼내 점 세 개 옆에 보여 준다(서버 호출 추가 없음).
   *    PC 스위치(v84_switch.json progress_live)가 꺼져 있거나 옛 PC면 줄이 없으니 예전처럼 점만.
   * ② get_k_status(연동 암호)로 PC 응답기의 하트비트(60초)를 읽어 머리줄 얼굴 옆 점: 초록=정상 · 주황=바쁨 · 빨강=PC 응답 없음(3분 넘게 소식 없음).
   *    채팅 화면이 보일 때만 30초마다 1번. 서버 함수가 없거나 PC가 아직 한 번도 안 남겼으면 점을 숨긴다(예전 머리줄 그대로). */
  function progLabel(res) {
    if (!res || res.status !== 'processing') return '';
    var p = String(res.progress_msg || '').trim();
    var mm = /^받는 중 (\d+)\/(\d+)$/.exec(p);                 // 큰 첨부 조각 받기(기존 PC 문구)
    if (mm) return '보내신 파일 받는 중… (' + mm[1] + '/' + mm[2] + ')';
    return p.slice(0, 40);
  }
  function awaitingProg() {
    for (var i = 0; i < chatMsgs.length; i++) {
      var m = chatMsgs[i];
      if (m.role === 'me' && !m.answered && m.id && m.token && m.prog) return m.prog;
    }
    return '';
  }
  function setAwaitProg(m, res) {
    var p = progLabel(res);
    if (p === (m.prog || '')) return;
    m.prog = p;
    updateTypingProg();
  }
  function updateTypingProg() {
    var p = awaitSay();
    var el = chatLog ? chatLog.querySelector('.ktyping .tprog') : null;
    if (el) {
      el.textContent = p; el.style.display = p ? '' : 'none';
    }
    if (convoOn && chatKStage && chatKStage.getAttribute('data-state') === 'think' && chatKStageHint) chatKStageHint.textContent = p || '잠시만 기다려 주세요';
  }

  var kStatState = null, kStatData = null, kStatBusy = false, kStatMissing = false, kStatLast = 0;
  var kStatErr = false;                               // v9.10: 가장 최근에 PC 상태를 읽으려다 실패했다(통신 · 암호) — 「목록을 불러오지 못했습니다」를 사실일 때만 적으려고
  var KSTAT_DOWN_S = 180;                        // PC 하트비트 60초 × 3 — 이보다 오래 소식이 없으면 「PC 응답 없음」
  function kStatCalc(d) {
    if (!d || !d.updated_at) return null;
    var up = Date.parse(d.updated_at); if (isNaN(up)) return null;
    var now = Date.parse(d.server_now); if (isNaN(now)) now = Date.now();   // 서버 시계 기준(폰 시계가 틀려도 맞게)
    if (d.stopping || (now - up) / 1000 > KSTAT_DOWN_S) return 'down';
    if (kLoginOf(d) === 'expired') return 'login';        // v9.6: PC는 켜져 있지만 클로드 로그인이 풀려 답을 만들지 못하는 상태
    return d.busy ? 'busy' : 'ok';
  }
  /* v9.6 (O-0356 ①의 앱 쪽) PC가 알려 주는 로그인 상태 — k_status 의 login 칸 { state: 'ok'|'soon'|'dying'|'expired', login_until, answer_until }.
   *   PC 스위치(o0356_switch.json 의 kstatus)가 켜졌을 때만 온다. 칸이 없으면 '' → 예전과 똑같이 동작한다.
   *   expired = 지금 답을 못 만든다(상태 'login') · dying = 로그인은 풀렸고 answer_until 까지만 답할 수 있다 · soon = login_until 에 만료 예정. */
  function kLoginOf(d) { var l = d && d.login; return (l && typeof l.state === 'string') ? l.state : ''; }
  function kLoginWhen(iso) {
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var d = new Date(t + 9 * 3600000), n = new Date(Date.now() + 9 * 3600000), hm = d.getUTCHours() + '시' + (d.getUTCMinutes() ? ' ' + d.getUTCMinutes() + '분' : '');
    return (d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate()) ? '오늘 ' + hm : (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + hm;
  }
  function kLoginTail() {                                  // 자리에 있을 때(정상·바쁨) 상태 문장 뒤에 붙이는 한 줄
    var d = kStatData || {}, s = kLoginOf(d), l = d.login || {}, w;
    if (s === 'dying') { w = kLoginWhen(l.answer_until); return ' 다만 PC의 로그인이 풀려' + (w ? ' ' + w + '까지만' : ' 곧') + ' 답할 수 있습니다. PC에서 다시 로그인해 주세요.'; }
    if (s === 'soon') { w = kLoginWhen(l.login_until); return w ? ' PC의 로그인이 ' + w + '에 만료됩니다.' : ''; }
    return '';
  }
  function kAway() { return kStatState === 'down' || kStatState === 'login'; }   // 지금 답을 드리지 못하는 상태인가
  function kStatSentence() {
    var d = kStatData || {};
    if (kStatState === 'ok') return '🟢 지금 자리에 있습니다. 보내시면 바로 답하겠습니다.' + kLoginTail();
    if (kStatState === 'busy') return (d.busy_kind === 'other'
      ? '🟠 지금 다른 창구의 일을 하고 있습니다. 보내시면 끝나는 대로 답하겠습니다.'
      : '🟠 지금 앞의 질문에 답하고 있습니다. 보내시면 차례대로 답하겠습니다.') + kLoginTail();
    if (kStatState === 'login') return '🔴 PC의 클로드 로그인이 풀려 지금은 제가 답을 드리지 못합니다. PC에서 다시 로그인해 주시면 이어서 답하겠습니다.';
    if (kStatState === 'down') {
      var mins = 0;
      try { mins = Math.round((Date.parse(d.server_now) - Date.parse(d.updated_at)) / 60000); } catch (e) {}
      return '🔴 PC가 ' + (mins > 0 && mins < 600 ? mins + '분째 ' : '') + '응답이 없어 지금은 제가 답을 드리지 못합니다. PC가 켜져 있는지, 인터넷이 되는지 확인해 주세요. 보내 두시면 PC가 켜진 뒤 답하겠습니다.';
    }
    return '';
  }
  /* v9.6 (O-0356 ②) 홈 큰 카드의 한 줄을 사실대로: PC가 응답하지 않으면 그 사실을, 지금 돌아가는 일이 있으면 그 일을 먼저 말한다.
   *   값은 이미 받는 것만 — PC 상태(get_k_status · 채팅 머리줄 점과 같은 값 · 3분 기준) · 작업 현황(ordersRows 의 activity.live).
   *   없으면 null → 오늘 보고 한 줄(today-card.js) 그대로. 알림은 보내지 않는다(화면의 말만 바뀐다). */
  window.SmartHomeSay = function () {
    try {
      // v9.10(O-0449): 폰에 끊긴 녹음 · 보내지 않은 녹음이 남아 있으면 그것부터 말한다(말풍선이 떠 있어도 내리지 않는다 — over)
      var rl = recHomeLine(); if (rl) return { kind: 'rec', over: true, text: rl };
      if (kStatState === 'down') {
        var d = kStatData || {}, mins = 0;
        try { mins = Math.round((Date.parse(d.server_now) - Date.parse(d.updated_at)) / 60000); } catch (e) {}
        return { kind: 'down', text: 'PC와 연결이 끊겨 지금은 답을 드리지 못합니다.' + (mins > 0 && mins < 600 ? ' ' + mins + '분째입니다.' : '') };
      }
      if (kStatState === 'login') return { kind: 'down', text: 'PC의 로그인이 풀려 지금은 답을 드리지 못합니다.' };
      var live = null;
      (ordersRows || []).forEach(function (o) { if (!live && !ORD_CLOSED[o.status] && o.activity && o.activity.live) live = o; });
      if (live) return { kind: 'work', text: '「' + cutText(live.summary || live.id, 18) + '」 — 지금 만들고 있습니다.' };
    } catch (e) {}
    return null;
  };
  var homeDownShown = false;
  function homeSayRepaint() {
    try { if (window.TodayCard && TodayCard.paintSay) TodayCard.paintSay(); } catch (e) {}
    // PC가 응답하지 않는 것을 처음 알게 된 때 한 번, 홈 카드의 얼굴만 8초 동안 걱정하는 표정(움직임 설정과 무관한 정지 사진 한 장 — 다른 자리 얼굴은 그대로)
    try {
      if (!kAway()) { homeDownShown = false; return; }
      var f = document.querySelector('#kHero .kface');
      if (!homeDownShown && f && isOpen(homeView) && window.KChar && KChar.faceFlash) { homeDownShown = true; KChar.ready.then(function () { KChar.faceFlash(f, 'concern', 8000); }); }
    } catch (e) {}
  }
  function renderKStat() {
    var dot = $('kHeadDot'), sub = $('kHeadSub'), btn = $('kHeadBtn'), ps = $('kProfStat');
    if (!dot || !sub) return;
    if (!kStatState) {
      dot.style.display = 'none'; sub.textContent = '소장'; sub.className = '';
      if (btn) btn.setAttribute('aria-label', '케이 프로필 보기');
      if (ps) ps.style.display = 'none';
      return;
    }
    var kcls = kStatState === 'login' ? 'down' : kStatState;   // 로그인 풀림은 「응답 없음」과 같은 빨간 점
    dot.className = 'kstat ' + kcls; dot.style.display = '';
    sub.className = 'kst-' + kcls;
    // 좁은 폰(접은 폴드 등)은 머리줄 자리가 없어 점 색만(글자는 「소장」 그대로) — 넓은 화면(펼친 폴드·PC)에서만 「· 정상」 같은 글을 붙인다(CSS .kst-w)
    var word = kStatState === 'ok' ? '정상' : (kStatState === 'busy' ? '바쁨' : (kStatState === 'login' ? '로그인 풀림' : 'PC 응답 없음'));
    sub.innerHTML = '소장<span class="kst-w"> · ' + word + '</span>';
    if (btn) btn.setAttribute('aria-label', '케이 프로필 보기 — PC 케이 ' + word);
    if (ps) { ps.textContent = kStatSentence(); ps.style.display = ''; }
  }
  function refreshKStat(force) {
    var pass = getSyncPass();
    if (!pass || kStatMissing || !window.OfficeBridge || !OfficeBridge.getKStatus) { if (kStatState) { kStatState = null; renderKStat(); } return; }
    if (kStatBusy) return;
    if (!force && Date.now() - kStatLast < 25000) return;
    kStatBusy = true; kStatLast = Date.now();
    OfficeBridge.getKStatus(pass).then(function (d) {
      kStatBusy = false; kStatErr = false;
      var prev = kStatState;
      if (kvHold && d && d.voice && d.voice.chosen === kvHold.key) kvHold = null;   // v9.7: PC 상태가 방금 바꾼 값을 따라왔다 → 이제부터는 PC 값을 그대로 따른다
      kStatData = d; kStatState = kStatCalc(d);
      renderKStat();
      if (prev !== kStatState) homeSayRepaint();          // v9.6: 홈 카드 한 줄도 그 상태로
      if (isOpen($('kWardrobeView')) && !kvPending) renderKVoices();   // v9.7(O-0401): 꾸미기 「설정」의 케이 목소리 줄(PC 가 내려 준 목록)
      if (prev !== kStatState && isOpen(chatView) && (prev === 'down' || prev === 'login' || kAway())) renderChat();   // 「PC 응답 없음」 안내 줄을 붙이거나 뗀다
    }).catch(function (e) {
      kStatBusy = false;
      var hadErr = kStatErr; kStatErr = !(e && e.notready);   // 서버 함수가 없는 것은 「못 받아 온 것」이 아니다
      if (!hadErr && kStatErr && !kStatData && isOpen($('kWardrobeView'))) { try { renderKVoices(); } catch (e2) {} }   // 받아 둔 것도 없으면 그 줄의 글을 「불러오는 중」에서 사실대로 바꾼다
      if (e && (e.notready || e.badpass)) {          // 서버 함수 없음 → 이번 실행 동안 다시 묻지 않음 / 암호 틀림 → 숨김
        if (e.notready) kStatMissing = true;
        kStatState = null; renderKStat();
        if (e.badpass) { kStatData = null; kvCacheSet(null); }   // v9.7: 암호가 틀리면 받아 둔 목소리 목록도 쓰지 않는다(기기에 적어 둔 것까지 지운다)
        if (isOpen($('kWardrobeView'))) renderKVoices();
      }                                              // 인터넷 끊김 등은 마지막 상태를 그대로 둔다
    });
  }
  setInterval(function () { try { if (!document.hidden && (isOpen(chatView) || isOpen(homeView) || kwSetOpen())) refreshKStat(false); } catch (e) {} }, 30000);   // v9.6: 홈이 보일 때도(홈 카드 한 줄) · v9.7: 꾸미기 「설정」이 보일 때도(케이 목소리 줄)
  function kwSetOpen() { var v = document.getElementById('kWardrobeView'), sp = document.getElementById('kwSetPane'); return !!(v && sp && isOpen(v) && sp.style.display !== 'none'); }
  document.addEventListener('visibilitychange', function () { try { if (!document.hidden && (isOpen(chatView) || isOpen(homeView))) refreshKStat(true); } catch (e) {} });

  /* ---- 케이가 먼저 보낸 사무소 방송(office_broadcast) 되읽기 ----
   * PC(notify_app.py)가 넣은 방송 행을 list_office_pushes RPC 로 가져와 케이 말풍선으로 추가한다.
   * · 중복방지: 이미 그린 방송은 bid(=행 id)로 걸러 다시 안 그린다(앱 재시작 후에도 유지).
   * · 표식(since): 마지막으로 가져온 ts 를 localStorage 에 저장 → 그 이후 방송만 다음에 가져온다.
   *   첫 실행이면 '지금'으로 잡아 과거·시험 행을 쏟아내지 않는다(이후 쌓이는 것만 순차로 보임).
   * · 기존 대화(대표님↔케이)와 공존: 병합 후 ts 순으로 정렬해 시간순을 유지한다. */
  function officeSince() { return officeHW; }   // v4.0: 메모리 high-water(열 때 EPOCH). 마커 localStorage 미사용
  function hasBroadcast(bid) {
    for (var i = 0; i < chatMsgs.length; i++) if (chatMsgs[i].bid && chatMsgs[i].bid === bid) return true;
    return false;
  }
  function sortChatByTime() {
    chatMsgs.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }
  function loadOfficePushes() {
    if (!(window.OfficeBridge && OfficeBridge.listOfficePushes)) return;
    // v7.7(O-0134): 예전엔 조회 하나가 끝나지 않으면(소켓 멈춤) officeLoading 이 영영 true 로 남아
    //   그 뒤 방송을 다시 받지 않았다 → 앱을 껐다 켜야 보였다. 45초 넘게 걸린 조회는 버린 것으로 보고 다시 받는다.
    if (officeLoading && (Date.now() - officeLoadingAt) < 45000) return;
    // v9.4(O-0353) 알림·보고 목록 잠금: 연동 암호가 없는 기기는 목록을 부르지 않는다(채팅 맨 위에 「연동 암호를 넣으면 … 보입니다」 안내 — chatLockHtml).
    //   암호가 틀리면(badpass) 여기서는 창을 띄우지 않는다 — 같은 암호로 도는 대화 동기화(loadChatSync)가 암호를 지우고 창을 띄운다(창이 두 번 뜨지 않게).
    var pushPass = getSyncPass();
    if (!pushPass) return;
    officeLoading = true; officeLoadingAt = Date.now();
    var since = officeSince();
    OfficeBridge.listOfficePushes(since, pushPass).then(function (rows) {
      officeLoading = false;
      if (!rows || !rows.length) return;
      var added = 0, unseenAdded = 0, maxTs = since;   // added=화면에 새로 그린 수 / unseenAdded=배지로 셀 수(자동알림·이미 본 것 제외)
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (row.ts && row.ts > maxTs) maxTs = row.ts;
        readLoaded(row.ts);                                    // (O-0201) 받아 온 것의 서버 시각
        if (isDeletedBid(row.id)) return;                      // 대표님이 지운 방송 — 다시 안 그림
        if (isBeforeCleared(row.ts)) return;                   // 「전체 삭제」 경계 이전 방송은 안 그림
        if (hasBroadcast(row.id)) return;                      // 이미 그린 방송 — 건너뜀
        var reply = row.content_md || (row.summary_json && row.summary_json.reply) || '';
        var atts = OfficeBridge.attachmentsFrom({ summary_json: row.summary_json });   // 첨부칩(PDF 등)
        if (!reply && !atts.length) return;                    // 본문·첨부 모두 없으면 표시할 것 없음
        var ts = row.ts ? Date.parse(row.ts) : Date.now();
        var isNotice = !!(row.summary_json && row.summary_json.notice);   // 🔔 자동 알림(건강·매시간·봇 경보 등)
        var kmsg = { role: 'k', text: reply, ts: (isNaN(ts) ? Date.now() : ts), bid: row.id };
        if (atts.length) kmsg.files = atts;
        // 단순 알림성 방송이면 표식(앱이 「🔔 알림」 배지 표시) — notify_app --kind notice 가 넣어준다
        if (isNotice) kmsg.notice = true;
        if (row.summary_json && row.summary_json.voice_url) { kmsg.vurl = row.summary_json.voice_url; kmsg.vtts = true; }   // v8.3 [▶ 듣기]
        kmsg.rid = row.id;                                     // v4.0: 행 id(삭제 시 서버 숨김 대상)
        chatMsgs.push(kmsg);
        added++;
        // v4.2 배지 카운트: (1) 자동 알림(notice)은 제외(대표님이 답장으로 오인 안 하게, 🔔 배지로 이미 구분됨),
        //   (2) '이미 본' 경계(ts) 이하도 제외 → 재시작 때 120개 밖으로 밀려난 옛 방송이 다시 세어지던 +9 를 막는다.
        if (!isNotice && !isSeenTs(row.ts)) unseenAdded++;
      });
      if (added) {
        sortChatByTime();
        saveChatMsgs();
        if (isOpen(chatView)) { renderChat(); if (!document.hidden) setSeenHW(maxTs); }   // 보고 있으면 방금 것까지 '본 것'으로 굳힘(재시작 후 재계산 방지) · v5.9: 앱이 뒤로 가 있을 땐 굳히지 않음(복귀 때 새 메시지 위치로)
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('케이가 새 소식을 보냈습니다.'); }
      }
      if (isOpen(chatView) && !chatSearchOn && readPresent()) readNote(readLoadedMs);   // (O-0201) 채팅을 보고 있으면 방금 것까지 다른 기기에도 「읽음」(검색 중 제외)
      officeHW = maxTs;   // v4.0: 세션 high-water 전진(메모리). 열 때 EPOCH 로 리셋되어 전체 재동기화됨
    }).catch(function () { officeLoading = false; });
  }

  /* ===================== v7.0(O-0102) 대화 쪽 조회 — 개수 상한 없이 첫 대화까지 =====================
   * 대표님 지시: 「스마트비서 앱 채팅 제한 없애」.
   * · 열 때: list_chat_page(최신 한 쪽, 대화+방송 합쳐 CHAT_PAGE_SIZE 건) → 합치고, 그 최신 시각을 증분 조회의
   *   출발점(chatSyncHW·officeHW)으로 삼는다. 그 뒤 새 메시지는 예전 증분 조회(since)가 그대로 받는다.
   * · 맨 위 [이전 대화 더 보기]: 커서(chatOlder = 지금까지 받은 가장 옛 행)보다 옛것을 한 쪽 더 → 끝까지.
   * · 검색은 불러온 말풍선 안에서 찾으므로, 옛것이 남아 있으면 [옛 대화까지 모두 찾기]로 전부 받아 온다.
   * · 옛 쪽은 배지(안읽음)로 세지 않고, 화면 위치도 보던 말풍선에 그대로 둔다(아래로 튀지 않게).
   * · 쪽 조회가 안 되면(암호 없음·서버 SQL 미적용 404·통신 실패) 예전 방식 그대로 → 지금보다 나빠지지 않음. */
  function chatTsMs(ts) { var n = ts ? Date.parse(ts) : NaN; return isNaN(n) ? 0 : n; }
  // 쪽 조회 행을 chatMsgs 에 합친다(이미 있는 것·개별 삭제·「전체 삭제」 경계 이전은 제외). 새로 넣은 말풍선 목록을 돌려준다.
  function mergeChatPageRows(rows) {
    var have = {}, added = [];
    chatMsgs.forEach(function (m) { if (m.id) have[m.id] = 1; if (m.cid) have[m.cid] = 1; if (m.bid) have[m.bid] = 1; });
    (rows || []).forEach(function (row) {
      if (!row || !row.id || have[row.id]) return;
      if (isDeletedBid(row.id) || isBeforeCleared(row.ts)) return;
      have[row.id] = 1;
      var sj = row.summary_json || null;
      var ts = chatTsMs(row.ts) || Date.now();
      var atts = OfficeBridge.attachmentsFrom({ summary_json: sj });
      if (row.src === 'push') {                          // 케이 방송 — loadOfficePushes 와 같은 모양
        var reply = row.content_md || (sj && sj.reply) || '';
        if (!reply && !atts.length) return;
        var km = { role: 'k', text: reply, ts: ts, bid: row.id };
        if (atts.length) km.files = atts;
        if (sj && sj.notice) km.notice = true;
        if (sj && sj.voice_url) { km.vurl = sj.voice_url; km.vtts = true; }   // v8.3: 미리 붙인 케이 목소리(아침 브리핑 등)
        km.rid = row.id;
        chatMsgs.push(km); added.push(km);
        return;
      }
      // 대화 줄 — loadChatSync 와 같은 모양(질문 말풍선 + 케이 답)
      var q = (row.note || '').trim();
      var a = (row.content_md || (sj && sj.reply) || '').trim();
      var me = { role: 'me', text: q || '(음성/파일)', ts: ts - 1, cid: row.id, answered: true, remote: true, rid: row.id };
      var rq0 = rqFromServer(sj && sj.reply_of); if (rq0) me.rq = rq0;   // (O-0545) 다른 기기에서 보낸 답장 — PC 가 남긴 인용
      chatMsgs.push(me); added.push(me);
      if (a || atts.length) {
        var k2 = { role: 'k', text: a, ts: ts, cid: row.id, rid: row.id };
        if (atts.length) k2.files = atts;
        var vu = sj && sj.voice_url; if (vu) k2.vurl = vu;
        chatMsgs.push(k2); added.push(k2);
      }
    });
    return added;
  }
  function chatPageCanRun() { return !!(getSyncPass() && !chatPageMissing && window.OfficeBridge && OfficeBridge.listChatPage); }
  function chatPageFail(e) {
    if (e && e.missing) {                            // 서버 SQL 미적용(또는 되돌림) → 이번 실행은 예전 방식
      chatPageMissing = true; chatHasMore = false; chatOlder = null;
      if (isOpen(chatView)) renderChat();            // 맨 위 [더 보기]/「처음이에요」 줄을 바로 걷어 낸다
      return;
    }
    if (e && e.badpass) {
      setSyncPass('');
      if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.');
    }
  }
  // 열 때 최신 한 쪽. done() 은 성공·실패와 무관하게 꼭 한 번 부른다(그다음 증분 조회를 잇게).
  function loadChatFirstPage(done) {
    var fin = function () { if (done) { var d = done; done = null; d(); } };
    if (!chatPageCanRun()) { fin(); return; }
    // 이미 옛 쪽까지 받아 둔 상태에서 다시 열었을 때, 그사이 새 메시지가 한 쪽을 넘게 쌓였으면 사이가 빈다 → 커서를 새로 잡는다
    var prevNewest = 0;
    chatMsgs.forEach(function (m) { if ((m.rid || m.bid || m.cid) && (m.ts || 0) > prevNewest) prevNewest = m.ts; });
    OfficeBridge.listChatPage(null, null, CHAT_PAGE_SIZE, getSyncPass()).then(function (rows) {
      var oldest = rows.length ? rows[rows.length - 1] : null;
      var full = rows.length >= CHAT_PAGE_SIZE;
      var gap = !!(chatOlder && oldest && full && chatTsMs(oldest.ts) > prevNewest);
      if (!chatOlder || gap || !oldest) {
        chatOlder = oldest ? { ts: oldest.ts, id: oldest.id } : { ts: '', id: '' };   // 빈 커서 = 쪽 조회는 됐고 더 없음
        chatHasMore = !!oldest && full && !isBeforeCleared(oldest.ts);
      }
      var added = mergeChatPageRows(rows);
      if (rows.length && rows[0].ts) { chatSyncHW = rows[0].ts; officeHW = rows[0].ts; readLoaded(rows[0].ts); }   // 이 뒤로는 새것만 증분 조회 · (O-0201) 서버 시각
      if (added.length) { sortChatByTime(); saveChatMsgs(); }
      if (isOpen(chatView)) renderChat();
      fin();
    }).catch(function (e) { chatPageFail(e); fin(); });
  }
  // [이전 대화 더 보기] — 한 쪽 더. cb(ok, 추가 수)
  function loadOlderChat(cb) {
    if (chatOlderBusy || !chatHasMore || !chatOlder || !chatOlder.ts || !chatPageCanRun()) { if (cb) cb(false, 0); return; }
    chatOlderBusy = true;
    var btn = chatLog && chatLog.querySelector('.chatmorebtn');
    if (btn) { btn.disabled = true; btn.textContent = '불러오는 중…'; }
    OfficeBridge.listChatPage(chatOlder.ts, chatOlder.id, CHAT_PAGE_SIZE, getSyncPass()).then(function (rows) {
      chatOlderBusy = false;
      var oldest = rows.length ? rows[rows.length - 1] : null;
      if (oldest) chatOlder = { ts: oldest.ts, id: oldest.id };
      chatHasMore = !!oldest && rows.length >= CHAT_PAGE_SIZE && !isBeforeCleared(oldest.ts);
      var added = mergeChatPageRows(rows);
      if (added.length) {
        sortChatByTime();
        // 옛 말풍선은 '새로 도착한 메시지'가 아니다 → 렌더 기준에 미리 넣어 새 메시지 스크롤·구분선이 안 붙게
        if (chatRenderedUids) added.forEach(function (m) { chatRenderedUids[msgUid(m)] = 1; });
      }
      if (isOpen(chatView)) {
        var keep = chatSearchOn ? null : chatCaptureView();   // 보던 말풍선(= 지금 맨 위 말풍선) 위치 그대로
        renderChat();
        if (keep) chatRestoreView(keep);
      }
      if (cb) cb(true, added.length);
    }).catch(function (e) {
      chatOlderBusy = false;
      chatPageFail(e);
      if (!(e && (e.missing || e.badpass))) toast('이전 대화를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
      if (isOpen(chatView)) renderChat();
      if (cb) cb(false, 0);
    });
  }
  // 검색용: 남은 옛 대화를 끝까지(안전 상한 200쪽 = 3만 건) 받아 온 뒤 검색 결과를 다시 그린다
  function loadAllOlderChat() {
    if (chatOlderBusy) return;
    var pages = 0, info = $('chatSearchInfo');
    function step() {
      if (!chatHasMore || pages >= 200) { if (isOpen(chatView)) renderChat(); return; }
      pages++;
      if (info) { info.style.display = 'block'; info.textContent = '옛 대화를 불러오는 중… (' + pages + '쪽)'; }
      loadOlderChat(function (ok) { if (ok) step(); else if (isOpen(chatView)) renderChat(); });
    }
    step();
  }
  // 대화 목록 맨 위 줄: [이전 대화 더 보기] / 「여기가 대화의 처음이에요」 (쪽 조회를 안 했으면 아무것도 없음 = 예전 화면)
  // v9.4(O-0353): 연동 암호가 없는 기기 — 케이가 보낸 알림·보고 목록 대신 안내 한 줄(누르면 기존 연동 암호 창). 새 화면 없음.
  function chatLockHtml() {
    if (getSyncPass()) return '';
    return '<div class="chatmore"><button type="button" class="chatlockbtn">연동 암호를 넣으면 알림·보고가 보입니다</button></div>';
  }
  function chatMoreHtml() {
    if (!chatOlder) return '';
    if (chatHasMore) {
      return '<div class="chatmore"><button type="button" class="chatmorebtn"' + (chatOlderBusy ? ' disabled' : '') + '>' +
        (chatOlderBusy ? '불러오는 중…' : '이전 대화 더 보기') + '</button></div>';
    }
    return '<div class="chatmore end">여기가 대화의 처음입니다</div>';
  }

  /* ===================== PC↔폰 채팅 동기화(1단계) =====================
   * 목적: "지금부터" 폰에서 보낸 글/케이 답이 PC에, PC에서 보낸 것이 폰에 뜨게 한다.
   * 방식: 전용 조회 RPC(list_chat_history)를 채팅 화면 열려 있을 때 몇 초마다 부른다.
   *   · 서버는 대화 줄(질문 note + 답 content_md + 첨부)만 시간순으로 돌려준다(방송·개인필드 제외).
   *   · 이 기기가 "직접 보낸" 줄(chatMsgs 에 이미 .id 로 있음)과 이미 받은 줄(.cid)은 건너뛴다 → 중복 없음.
   *   · 과거 전체 재구성은 하지 않는다(2단계). 첫 실행 표식을 '지금'으로 잡아 새로 생기는 것만 얹는다.
   * 보안: 공개 저장소라 anon 키가 노출되므로, 조회 RPC 는 연동 암호(passcode)로 잠근다.
   *   암호는 기기에 1회 저장(localStorage) — 서버 대조값과 맞을 때만 대화가 내려온다. */
  function getSyncPass() { try { return localStorage.getItem(SYNC_PASS_KEY) || ''; } catch (e) { return ''; } }
  function setSyncPass(p) {
    try { if (p) localStorage.setItem(SYNC_PASS_KEY, p); else localStorage.removeItem(SYNC_PASS_KEY); } catch (e) {}
    // v8.2(O-0158): 알림 [답장]도 연동 암호 확인 RPC 로 보내므로 폰 네이티브 안전 저장소(Keystore 암호화)에도 맞춰 둔다
    try { var KB = kbPlugin(); if (KB && KB.setContext) KB.setContext({ pass: p || '' }); } catch (e) {}
  }
  function syncSince() { return chatSyncHW; }   // v4.0: 메모리 high-water(열 때 EPOCH → 서버 전체 재구성)
  // 이 대화 줄(행 id)을 이미 갖고 있나? (내가 보낸 것 .id / 이미 받은 것 .cid 둘 다 검사)
  function hasChatRow(cid) {
    for (var i = 0; i < chatMsgs.length; i++) {
      if ((chatMsgs[i].id && chatMsgs[i].id === cid) || (chatMsgs[i].cid && chatMsgs[i].cid === cid)) return true;
    }
    return false;
  }
  function loadChatSync() {
    if (!(window.OfficeBridge && OfficeBridge.listChatHistory)) return;
    if (syncLoading && (Date.now() - syncLoadingAt) < 45000) return;   // v7.7(O-0134): 굳은 '조회 중'은 45초 뒤 풀기
    var pass = getSyncPass();
    if (!pass) return;                              // 암호 미설정 → 동기화 꺼짐(조용히, 에러 없음)
    syncLoading = true; syncLoadingAt = Date.now();
    var since = syncSince();
    OfficeBridge.listChatHistory(since, pass).then(function (rows) {
      syncLoading = false;
      if (!rows || !rows.length) return;
      var added = 0, unseenAdded = 0, maxTs = since;
      var ownK = readOwnAnswers(), stamped = false;   // (O-0201) 이 기기에서 묻고 받은 답에 서버 시각 달기
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (row.ts && row.ts > maxTs) maxTs = row.ts;
        readLoaded(row.ts);                         // (O-0201) 이 기기에서 묻고 받은 답의 서버 시각도 여기서 안다(건너뛰는 줄 포함)
        if (hasChatRow(row.id)) { if (readStampOwn(row, ownK)) stamped = true; return; }   // 내가 보낸 것/이미 받은 것 → 건너뜀(중복 방지)
        if (isDeletedBid(row.id)) return;           // 개별 삭제한 것(tombstone)
        if (isBeforeCleared(row.ts)) return;        // 「전체 삭제」 경계 이전은 이 기기서 안 그림
        var q = (row.note || '').trim();
        var a = (row.content_md || (row.summary_json && row.summary_json.reply) || '').trim();
        var atts = OfficeBridge.attachmentsFrom({ summary_json: row.summary_json });
        var ts = row.ts ? Date.parse(row.ts) : Date.now(); if (isNaN(ts)) ts = Date.now();
        // 다른 기기에서 온 질문(내 말풍선). token 이 없으니 reconcile 이 다시 폴링하지 않는다(answered=true).
        var meR = { role: 'me', text: q || '(음성/파일)', ts: ts - 1, cid: row.id, answered: true, remote: true, rid: row.id };
        var rq1 = rqFromServer(row.summary_json && row.summary_json.reply_of); if (rq1) meR.rq = rq1;   // (O-0545)
        chatMsgs.push(meR);
        if (a || atts.length) {                     // 케이 답(있으면)
          var km = { role: 'k', text: a, ts: ts, cid: row.id, rid: row.id };
          if (atts.length) km.files = atts;
          var v = row.summary_json && row.summary_json.voice_url; if (v) km.vurl = v;
          chatMsgs.push(km);
        }
        added++;
        // v4.2 배지: '이미 본' 경계(ts) 이하(재시작 시 120개 밖으로 밀려나 다시 내려온 옛 대화)는 세지 않는다.
        if (!isSeenTs(row.ts)) unseenAdded++;
      });
      if (added) {
        sortChatByTime();
        saveChatMsgs();
        if (isOpen(chatView)) { renderChat(); if (!document.hidden) setSeenHW(maxTs); }   // v5.9: 앱이 뒤로 가 있을 땐 '본 것'으로 굳히지 않음(복귀 때 새 메시지 위치로)
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('다른 기기에서 보낸 대화가 도착했습니다.'); }
      }
      if (stamped) readRecount();                  // (O-0201) 서버 시각을 새로 안 답이 있으면 — 다른 기기에서 이미 읽은 것일 수 있다
      if (isOpen(chatView) && !chatSearchOn && readPresent()) readNote(readLoadedMs);   // (O-0201) 검색 중(결과만 보는 중)에는 올리지 않음
      chatSyncHW = maxTs;   // v4.0: 세션 high-water 전진(메모리). 열 때 EPOCH 로 리셋됨
    }).catch(function (e) {
      syncLoading = false;
      if (e && e.badpass) {                          // 암호가 틀림(또는 서버 미설정) → 저장한 암호 지우고 재입력 유도
        setSyncPass('');
        if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.');
      }
    });
  }
  function startChatSync() {
    if (syncTimer) return;
    loadChatSync();
    syncTimer = setInterval(function () {
      if (!isOpen(chatView)) { stopChatSync(); return; }   // 채팅을 벗어나면 스스로 멈춤
      loadChatSync();
    }, 3500);
  }
  function stopChatSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }

  // 연동 암호 게이트
  function showSyncGate(force, errMsg) {
    var g = $('syncGate'); if (!g) return;
    if (getSyncPass() && !force) return;             // 이미 설정됨 → 강제 아니면 안 띄움
    var er = $('syncGateErr');
    if (er) { if (errMsg) { er.textContent = errMsg; er.style.display = 'block'; } else { er.style.display = 'none'; } }
    var inp = $('syncGateInput'); if (inp) inp.value = '';
    g.style.display = 'flex';
    setTimeout(function () { if (inp) try { inp.focus(); } catch (e) {} }, 60);
  }
  function hideSyncGate() {
    var g = $('syncGate'); if (g) g.style.display = 'none';
    try { localStorage.setItem(SYNC_PROMPTED_KEY, '1'); } catch (e) {}   // 안내는 한 번만
  }
  if ($('syncGateSave')) $('syncGateSave').addEventListener('click', function () {
    var p = (($('syncGateInput') && $('syncGateInput').value) || '').trim();
    if (!p) { showSyncGate(true, '암호를 입력해 주세요.'); return; }
    setSyncPass(p); hideSyncGate();
    try { localStorage.setItem(SYNC_SINCE_KEY, new Date().toISOString()); } catch (e) {}  // 지금부터 동기화(과거 안 쏟음)
    toast('PC 연동 암호를 저장했습니다.');
    if (isOpen(chatView) && !chatOlder) loadChatFirstPage(startChatSync);   // v7.0: 채팅에서 암호를 넣었으면 최신 한 쪽부터(→ 이전 대화 더 보기)
    else startChatSync();                             // 곧바로 한 번 확인(암호 틀리면 게이트가 다시 뜸)
    loadOfficePushes();                               // v9.4(O-0353): 알림·보고 목록도 이제 연동 암호로 읽는다 → 넣자마자 받아 온다
    if (isOpen(chatView)) renderChat();               //   채팅 맨 위 「연동 암호를 넣으면 …」 안내 줄을 내린다
    try { if (window.KChar && KChar.assets) KChar.assets.refresh(); } catch (e) {}     // v9.5: 케이 자산(자세 그림·영상·새 옷)도 암호가 있어야 받는다
    try { if (window.HealthTab && HealthTab.flush) HealthTab.flush(); } catch (e) {}   // v9.4(O-0344): 암호가 없어 폰에만 남아 있던 건강 기록 올리기
    if (isOpen($('meetingsView'))) openMeetings();    // v5.2: 회의 요약 탭에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen($('ideasView'))) refreshIdeas(false);  // v5.5: 아이디어 화면에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen($('ordersView'))) refreshOrders(false); // v5.8: 작업 현황에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen(chatView)) { ordFullOnce = true; pollOrderCards(); }   // v5.8: 작업 카드도 곧바로
    try { if (window.SmartPush && SmartPush.retry) SmartPush.retry(); } catch (e) {}           // v7.5(O-0130): 보류된 푸시 토큰 등록
    try { if (isOpen($('healthView')) && window.HealthTab) { if (HealthTab.resume) HealthTab.resume(); else HealthTab.open(); } } catch (e) {}    // v7.5: 건강 탭에서 넣었으면 다시 불러오기 · v9.4: 지난 날짜를 고치던 중이면 그 화면 그대로
    try { refreshOrders(true); if (window.TodayCard) TodayCard.refresh(false); } catch (e) {} // v7.5: 홈 「오늘 한눈에」
  });
  if ($('syncGateLater')) $('syncGateLater').addEventListener('click', function () { hideSyncGate(); });

  /* ===================== v5.8 작업 카드 · 작업 현황 =====================
   * 대표님: "매번 작업을 지시해도 하는 건지 안 하는 건지 알 수가 없어."
   * 원본은 PC 지시 대장(office-orders\orders.json). orders_log.py 가 쓸 때마다 서버 표 office_orders 로
   * 사본을 올리고(미러), 앱은 연동 암호 게이트 RPC 로 읽기만 한다(쓰기·삭제 없음).
   *  · 작업 카드: 내가 보낸 채팅 메시지(행 id = 대장 source_id) 아래에 [O-번호 · 상태 · 처리 모델 · 결과 한 줄].
   *    대장에 접수된 메시지(일반 차선)에만 붙는다 — 짧은 인사(빠른 차선)는 대장에 안 올라가므로 카드 없음.
   *    채팅이 열려 있는 동안 8초마다: 아직 안 끝난 카드 + 최근 15분 안에 보낸(카드 아직 없는) 메시지만 조회.
   *  · 작업 현황: 미완료 전부(창구 표시) + 최근 끝난 것. 열려 있는 동안 15초마다 갱신.
   * ⚠️ 채팅 화면 새 요소엔 backdrop-filter 금지(v4.5 타이핑 렉) · confirm 금지 · 암호 없거나 틀리면 기존 게이트. */
  var ORDER_CARDS_KEY = 'smart_order_cards';
  var ORD_CLOSED = { '완료': 1, '취소': 1 };
  var ORD_ST_CLASS = { '접수': 's-recv', '진행': 's-prog', '완료': 's-done', '보류': 's-hold', '실패': 's-fail', '취소': 's-canc' };
  var orderCards = loadOrderCards(), ordTimer = null, ordBusy = false, ordFullOnce = false;
  var ordersView = $('ordersView'), ordersBody = $('ordersBody'), ordersTimer = null, ordersBusy = false;
  var ordersFromChat = false, ordersHl = '';
  // v5.9: 「지우기」(숨김) 가능한 상태 = 끝난 일(완료·취소) + 멈춘 일(실패·보류=작업실 「확인 필요」 포함).
  //   접수·진행 중인 일은 지우지 않는다(그건 채팅의 「#번호 취소」 몫). 서버도 같은 목록만 받아준다.
  var ORD_HIDEABLE = { '완료': 1, '취소': 1, '실패': 1, '보류': 1 };
  var ordersRows = [];

  function loadOrderCards() { try { var o = JSON.parse(localStorage.getItem(ORDER_CARDS_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
  function saveOrderCards() {
    try {
      var keys = Object.keys(orderCards);
      if (keys.length > 200) {                     // 오래된 것부터 정리(최근 200개만 보관)
        keys.sort(function (a, b) { return (orderCards[a]._t || 0) - (orderCards[b]._t || 0); });
        keys.slice(0, keys.length - 200).forEach(function (k) { delete orderCards[k]; });
      }
      localStorage.setItem(ORDER_CARDS_KEY, JSON.stringify(orderCards));
    } catch (e) {}
  }
  // 모델 id → 대표님이 읽기 쉬운 이름. (claude-opus-5-5 → 오퍼스 5.5, claude-sonnet-5 → 소넷 5)
  function modelLabel(id) {
    if (!id) return '';
    var s = String(id).toLowerCase(), r;
    if (/^router-|^recover/.test(s)) return '';
    if (s === 'haiku-fast') return '하이쿠(빠른 답)';
    var names = { opus: '오퍼스', sonnet: '소넷', haiku: '하이쿠', fable: '페이블' };
    for (var k in names) {
      if (s.indexOf(k) === -1) continue;
      r = s.match(new RegExp(k + '-(\\d+)(?:-(\\d{1,2})(?!\\d))?'));
      return names[k] + (r ? (' ' + r[1] + (r[2] ? '.' + r[2] : '')) : '');
    }
    return String(id);
  }
  function fmtKst(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function ordStatusHtml(st) { return '<span class="ordst ' + (ORD_ST_CLASS[st] || '') + '">' + esc(st || '?') + '</span>'; }
  function ordModelHtml(model, wantOpus) {
    var lb = modelLabel(model);
    if (!lb && wantOpus) lb = '오퍼스 5.5 요청';
    if (!lb) return '';
    return '<span class="ordmodel' + (/오퍼스/.test(lb) ? ' opus' : '') + '">' + esc(lb) + '</span>';
  }
  /* v5.8 검수 표시: 진행 활동 · 완료 근거 · 감독관 재촉 · 소장 검토 → 카드만 보고
   *   「하고 있다(진행 중 N분째·최근 활동)」 / 「진짜 끝냈다(✅근거)」 / 「말로만 끝냈다(⚠️근거 없음·활동 없음)」가 구분되게. */
  function minsSince(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000)); }
  function ordActivityLine(o) {
    var a = o.activity; if (!a) return '';
    if (!ORD_CLOSED[o.status] && a.live) {
      var mn = minsSince(a.started);
      return '진행 중' + (mn != null ? ' (' + (mn < 1 ? '방금 시작' : mn + '분째') + ')' : '') + (a.last ? ' · 최근: ' + a.last : '');
    }
    if (!(a.tools > 0)) return '활동 없음(답변만)';
    return '활동: ' + (a.summary || (a.tools + '건'));
  }
  function ordEvidenceHtml(o) {
    var e = o.evidence; if (!e || !e.mark) return '';
    var cls = e.grade === 'ok' ? 'ev-ok' : e.grade === 'partial' ? 'ev-part' : e.grade === 'none' ? 'ev-none' : 'ev-unk';
    return '<span class="ordev ' + cls + '">' + esc(e.mark + ' ' + (e.label || '')) + '</span>';
  }
  function ordExtraHtml(o) {
    var h = '';
    if (o.nudge && o.nudge.count) h += '<span class="ordtag">감독관 재촉 ' + esc(o.nudge.count) + '회</span>';
    if (o.nudge && o.nudge.escalated) h += '<span class="ordtag warn">재촉해도 안 끝남</span>';
    if (o.reviewed_by) h += '<span class="ordtag ok">소장 검토 완료</span>';
    return h;
  }
  function orderCardHtml(m) {
    if (!orderCards) return '';                      // (시작 직후 모듈 초기화 전 렌더 대비)
    var key = m.id || m.cid; if (!key) return '';
    var o = orderCards[key]; if (!o || !o.id) return '';
    var line = o.result || o.summary || '';
    var act = ordActivityLine(o);
    var ev = ORD_CLOSED[o.status] && o.evidence && o.evidence.text ? o.evidence.text : '';
    return '<div class="ordcard" data-ord="' + esc(o.id) + '">' +
      '<div class="oc-h"><span class="oc-id">' + esc(o.id) + '</span>' + ordStatusHtml(o.status) + ordModelHtml(o.model, m.opus || o.model_pref === 'opus') +
      (ORD_CLOSED[o.status] ? ordEvidenceHtml(o) : '') + ordExtraHtml(o) + '</div>' +
      (act ? '<div class="oc-a">' + esc(act) + '</div>' : '') +
      (line ? '<div class="oc-r">' + esc(line) + '</div>' : '') +
      (ev ? '<div class="oc-e">근거: ' + esc(ev) + '</div>' : '') +
      ordDecideHtml(o) + '</div>';                    // (O-0201 추가) 결정 대기일 때만 [승인]·[수정 요청]
  }
  /* ===================== (O-0201 추가) 작업 카드에서 [승인]·[수정 요청] =====================
   * 근거(O-0195): 앱에서 작업실로 간 일의 절반가량이 「확인 필요(대표님 결정 대기)」로 멈추는데, 풀려면 채팅에 「#번호 승인」을 쳐야 했다.
   * ▷ 새 서버 경로 없음: 버튼은 채팅에 「#작업실번호 승인」 / 「#작업실번호 수정 요청: …」을 대신 보낼 뿐이다(sendPlainChat —
   *   손으로 치는 것과 같은 글·같은 경로. PC 응답기가 「#번호 승인」을 판정기 없이 바로 이어받는다). 글로 치는 방법도 그대로 된다.
   * ▷ 보이는 때: 대장 상태가 「보류」이고 작업실 상태가 need_approval(확인 필요)일 때만. 진행 중·완료·실패 카드는 예전 그대로.
   *   PC 작업실은 끝난 지 48시간 안의 「확인 필요」만 이어받으므로(job_queue.approval_candidates), 그보다 오래된 건은 버튼 대신 안내만.
   * ▷ 잘못 누름 방지: [승인]은 기존 확인 시트를 한 번 거친다. 보내는 동안 버튼은 꺼지고, 못 보내면 카드에 사유가 남는다.
   *   이 기기에서 이미 보낸 건은 버튼 대신 「보냈어요 · 시각」(다시 눌러 두 번 접수되지 않게, 이 기기에 기억).
   * ▷ 모양은 아이디어 화면의 [진행해줘]/[보류]와 같은 버튼(.btn.primary/.btn.ghost) — 채팅 화면이라 backdrop-filter 는 끈다. */
  var ORD_DECIDED_KEY = 'smart_ord_decided';
  var ORD_APPROVE_WINDOW_MS = 47 * 3600 * 1000;      // PC 쪽 48시간 창보다 1시간 여유
  var ordDecided = (function () { try { var o = JSON.parse(localStorage.getItem(ORD_DECIDED_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } })();
  var ordDecBusy = {}, ordDecErr = {};
  function saveOrdDecided() {
    try {
      var ks = Object.keys(ordDecided);
      if (ks.length > 100) { ks.sort(function (a, b) { return (ordDecided[a].at || 0) - (ordDecided[b].at || 0); }); ks.slice(0, ks.length - 100).forEach(function (k) { delete ordDecided[k]; }); }
      localStorage.setItem(ORD_DECIDED_KEY, JSON.stringify(ordDecided));
    } catch (e) {}
  }
  function ordNeedsDecision(o) { return !!(o && o.status === '보류' && o.job_status === 'need_approval' && (o.job_seq | 0) > 0); }
  function ordDecideHtml(o) {
    if (!ordNeedsDecision(o)) return '';
    var id = esc(o.id), d = ordDecided[o.id];
    if (d && d.seq === (o.job_seq | 0)) {
      return '<div class="ord-sent">✓ ' + (d.k === 'revise' ? '수정 요청을' : '승인을') + ' 보냈습니다 · ' + esc(fmtKst(new Date(d.at).toISOString())) +
        ' — 케이 답은 채팅에서 확인해 주세요</div>';
    }
    var t = Date.parse(o.u || o.updated_at || '');
    if (!isNaN(t) && Date.now() - t > ORD_APPROVE_WINDOW_MS) {
      return '<div class="ord-sent warn">결정을 기다린 지 이틀 가까이 지나 버튼으로는 이어받지 못합니다. 채팅으로 케이에게 말씀해 주세요.</div>';
    }
    var busy = !!ordDecBusy[o.id];
    return '<div class="ord-actions">' +
      '<button type="button" class="btn primary" data-ord-approve="' + id + '"' + (busy ? ' disabled' : '') + '><svg><use href="#i-check"/></svg>' + (busy ? '보내는 중…' : '승인') + '</button>' +
      '<button type="button" class="btn ghost" data-ord-revise="' + id + '"' + (busy ? ' disabled' : '') + '>수정 요청</button></div>' +
      (ordDecErr[o.id] ? '<div class="ord-sent err">' + esc(ordDecErr[o.id]) + '</div>' : '');
  }
  function ordDecideFind(id) {
    var o = ordFind(id); if (o) return o;
    for (var k in orderCards) { if (orderCards[k] && orderCards[k].id === id) return orderCards[k]; }
    return null;
  }
  function ordDecideRedraw() {
    if (isOpen(chatView)) renderChat();
    if (isOpen(ordersView)) renderOrders(ordersRows);
  }
  function ordApproveText(o) { return '#' + (o.job_seq | 0) + ' 승인'; }
  function ordReviseText(o, t) {
    return '#' + (o.job_seq | 0) + ' 수정 요청: ' + t + '\n(이 작업을 그대로 실행하지 말고, 위 내용대로 고쳐서 다시 보고해 주세요.)';
  }
  function ordDecideSend(o, kind, text) {
    if (!getSyncPass()) { showSyncGate(true, (kind === 'revise' ? '수정 요청을' : '승인을') + ' 보내려면 PC 연동 암호를 입력해 주세요.'); return; }
    if (ordDecBusy[o.id]) return;
    ordDecBusy[o.id] = true; delete ordDecErr[o.id];
    ordDecideRedraw();
    unlockKaiAudio();
    // 「작업 현황」에서 눌렀을 때: sendPlainChat 이 채팅을 다시 그리며 예약하는 '맨 아래로' 스크롤이 이 화면(같은 문서 스크롤)을 끌어내리지 않게 취소한다.
    var keepScroll = function () { if (!isOpen(chatView)) chatScrollSeq++; };
    var sending = sendPlainChat(text, false);
    keepScroll();
    sending.then(function (ok) {
      keepScroll();
      delete ordDecBusy[o.id];
      if (ok) {
        ordDecided[o.id] = { k: kind, at: Date.now(), seq: (o.job_seq | 0) }; saveOrdDecided();
        toast((kind === 'revise' ? '수정 요청을' : '승인을') + ' 케이에게 보냈습니다. 채팅에서 답을 확인하세요.');
      } else {
        ordDecErr[o.id] = '보내지 못했습니다 — 인터넷 연결을 확인하고 다시 눌러 주세요.';
        toast('보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.');
      }
      ordDecideRedraw();
    });
  }
  function confirmApproveOrder(id) {
    var o = ordDecideFind(id); if (!o || !ordNeedsDecision(o) || ordDecBusy[id]) return;
    var s = (o.summary || '').replace(/\s+/g, ' ').trim(); if (s.length > 60) s = s.slice(0, 60) + '…';
    // 무엇을 승인하는지 = 대장에 이미 있는 결과 요약(작업실 보고 첫머리)을 그대로 쓴다. 앞의 「작업실 #N 확인 필요(대표님 결정 대기) · 」 머리말만 뗀다.
    var r = (o.result || '').replace(/\s+/g, ' ').replace(/^작업실 #\d+ 확인 필요\(대표님 결정 대기\)\s*·\s*/, '').trim(); if (r.length > 120) r = r.slice(0, 120) + '…';
    openSheet('작업 #' + (o.job_seq | 0) + ' 승인할까요?',
      (s ? '「' + s + '」\n' : '') + (r ? '보고: ' + r + '\n' : '') +
      '\n승인하면 케이가 이 작업을 이어받아, 보고에서 여쭌 것(발송·배포 등)을 실행합니다.\n채팅에는 「' + ordApproveText(o) + '」이라고 전달됩니다.',
      '승인', function () { ordDecideSend(o, 'approve', ordApproveText(o)); });
    if (sheetMsg) sheetMsg.classList.add('pck');     // 여러 줄 안내(왼쪽 정렬·줄바꿈 유지·높이 제한 해제) — 기존 시트 모양 재사용
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-check'); }   // 긍정 동작 — 빨간 휴지통 대신 ✓(아이디어 [진행해줘]와 같게)
  }
  function openReviseOrder(id) {
    var o = ordDecideFind(id); if (!o || !ordNeedsDecision(o) || ordDecBusy[id]) return;
    modalTitle.textContent = '작업 #' + (o.job_seq | 0) + ' 수정 요청';
    modalBody.innerHTML = '<div class="card rcard"><div class="h"><svg><use href="#i-note"/></svg>어떻게 고칠까요?</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">한 줄로 적어 주시면 케이에게 채팅으로 보냅니다. 승인이 아니라서, 고친 뒤 다시 보고받습니다.</div>' +
      '<input id="ordRevInput" type="text" maxlength="200" ' +
      'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px" placeholder="예: 표는 빼고 2쪽으로 줄여 줘"></div>' +
      '<div class="btnrow">' +
      '<button id="ordRevSend" class="btn primary"><svg><use href="#i-check"/></svg>보내기</button>' +
      '<button id="ordRevCancel" class="btn ghost sm"><svg><use href="#i-x"/></svg>취소</button>' +
      '</div>';
    var inp = $('ordRevInput');
    $('ordRevCancel').addEventListener('click', closeModal);
    function go() {
      var t = ((inp && inp.value) || '').replace(/\s+/g, ' ').trim();
      if (!t) { toast('어떻게 고칠지 한 줄 적어 주세요.'); return; }
      if (t.length > 200) t = t.slice(0, 200);
      closeModal();
      ordDecideSend(o, 'revise', ordReviseText(o, t));
    }
    $('ordRevSend').addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); go(); } });
    modal.style.display = 'flex';
    setTimeout(function () { if (inp) try { inp.focus(); } catch (e) {} }, 60);
  }
  // 카드 안 버튼을 눌렀으면 처리하고 true(카드 전체 누르기 = 작업 현황 열기보다 먼저 본다)
  function ordDecideClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target : null; if (!t) return false;
    var a = t.closest('[data-ord-approve]'); if (a) { ev.preventDefault(); if (!a.disabled) confirmApproveOrder(a.getAttribute('data-ord-approve')); return true; }
    var r = t.closest('[data-ord-revise]'); if (r) { ev.preventDefault(); if (!r.disabled) openReviseOrder(r.getAttribute('data-ord-revise')); return true; }
    return false;
  }
  // 이번에 조회할 원본 id: (전체 1회) 최근 내 메시지 40개 / (평소) 안 끝난 카드 + 최근 15분 내 보낸 카드 없는 메시지
  function orderPollIds(full) {
    if (!orderCards) orderCards = loadOrderCards();
    var now = Date.now(), ids = [], mine = chatMsgs.filter(function (m) { return m.role === 'me' && (m.id || m.cid); });
    mine.slice(-40).forEach(function (m) {
      var key = m.id || m.cid, c = orderCards[key];
      if (full) { ids.push(key); return; }
      if (c && c.id) { if (!ORD_CLOSED[c.status]) ids.push(key); return; }
      if (now - (m.ts || 0) < 15 * 60 * 1000) ids.push(key);
    });
    return ids;
  }
  function startOrderPoll() {
    if (!ordTimer) ordTimer = setInterval(function () {
      if (!isOpen(chatView)) { clearInterval(ordTimer); ordTimer = null; return; }
      pollOrderCards();
    }, 8000);
    pollOrderCards();
  }
  // 방금 보낸 메시지: PC 응답기가 집어 대장에 올리기까지 몇 초 → 2.5초·6초 뒤 한 번씩 더 확인 + 주기 폴링 시작
  function kickOrderPoll() { startOrderPoll(); setTimeout(pollOrderCards, 2500); setTimeout(pollOrderCards, 6000); }
  function pollOrderCards() {
    if (ordBusy || !(window.OfficeBridge && OfficeBridge.listOfficeOrdersBySource)) return;
    var pass = getSyncPass(); if (!pass) return;       // 암호 없으면 조용히(채팅 게이트가 이미 안내)
    var full = ordFullOnce; ordFullOnce = false;
    var ids = orderPollIds(full); if (!ids.length) return;
    ordBusy = true;
    OfficeBridge.listOfficeOrdersBySource(ids, pass).then(function (rows) {
      ordBusy = false;
      var changed = false;
      rows.forEach(function (r) {
        if (!r || !r.source_id) return;
        var old = orderCards[r.source_id];
        var nv = { id: r.id, status: r.status, result: r.result || '', summary: r.summary || '', model: r.model || '', u: r.updated_at || '', _t: Date.now(),
                   activity: r.activity || null, evidence: r.evidence || null, nudge: r.nudge || null, reviewed_by: r.reviewed_by || '', model_pref: r.model_pref || '',   // v5.8 검수 칸
                   job_seq: r.job_seq || 0, job_status: r.job_status || '' };   // (O-0201 추가) 결정 대기 판정([승인]·[수정 요청])
        var sig = function (x) { return x ? JSON.stringify([x.id, x.status, x.result, x.model, x.activity, x.evidence, x.nudge, x.reviewed_by, x.job_seq || 0, x.job_status || '']) : ''; };
        if (sig(old) !== sig(nv)) changed = true;
        orderCards[r.source_id] = nv;
      });
      var liveAny = rows.some(function (r) { return r && r.activity && r.activity.live && !ORD_CLOSED[r.status]; });
      if (changed) { saveOrderCards(); if (isOpen(chatView)) renderChat(); }
      else if (liveAny && Date.now() - (pollOrderCards._lastLive || 0) > 60000) { pollOrderCards._lastLive = Date.now(); if (isOpen(chatView)) renderChat(); }
    }).catch(function (e) {
      ordBusy = false;
      if (e && e.badpass) { setSyncPass(''); if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
    });
  }

  /* ---- 작업 현황 화면 ---- */
  function openOrders(fromChat, hlId) {
    ordersFromChat = !!fromChat; ordersHl = hlId || '';
    openScreen(ordersView);
    if (ordersBody && !ordersBody.innerHTML) { ordersBody.innerHTML = '<div class="ord-empty">가져오고 있습니다…</div>'; ordersScene('loading'); }
    refreshOrders(false);
    if (!ordersTimer) ordersTimer = setInterval(function () {
      if (!isOpen(ordersView)) { clearInterval(ordersTimer); ordersTimer = null; return; }
      refreshOrders(true);
    }, 15000);
  }
  function refreshOrders(silent) {
    if (!(window.OfficeBridge && OfficeBridge.listOfficeOrders)) return;
    var pass = getSyncPass();
    if (!pass) {
      if (!silent && isOpen(ordersView)) showSyncGate(true, '작업 현황을 보려면 PC 연동 암호를 입력해 주세요.');
      if (ordersBody) ordersBody.innerHTML = '';     // v9.4: 안내는 맨 위 케이가 말한다
      ordersScene('nopass');
      return;
    }
    if (ordersBusy) return; ordersBusy = true;
    OfficeBridge.listOfficeOrders(80, pass).then(function (rows) {
      ordersBusy = false;
      renderOrders(rows);
      try { if (window.TodayCard) TodayCard.setOrders(rows); } catch (e) {}   // (O-0129) 같은 결과로 「챙길 일」(추가 호출 없음)
    }).catch(function (e) {
      ordersBusy = false;
      if (e && e.badpass) { setSyncPass(''); if (isOpen(ordersView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); return; }
      if (ordersBody && !silent) { ordersBody.innerHTML = '<div class="ord-err">인터넷 연결을 확인하고 새로고침을 눌러 주세요.</div>'; ordersScene('fail'); }
    });
  }
  /* v9.4 일하는 케이(작업 현황 맨 위) — 값은 방금 받은 목록(ordersRows)뿐:
   *   지금 돌아가는 일(activity.live) → 책상에서 일하는 모습 + 그 일의 요지 / 대표님 결정을 기다리는 일(보류 + 작업실 need_approval, 아직 답 안 보냄) → 서류 건네기 + 건수
   *   / 그 밖 → 평소 모습 + 남은 건수. state: 'loading' | 'nopass' | 'fail' | (없음 = 목록 기준) */
  /* v9.5 책상 자세 기준(상수 하나로 켜고 끈다) — v9.6: 대표님 결정(2026-10-10 「2번 진행」)으로 켰다.
   *   false = 「지금 돌아가는 일」(activity.live)이 있을 때만 책상에서 일하는 모습.
   *   true  = 대장 상태가 「진행」인 일이 있어도 책상에서 일하는 모습. 한마디는 사실대로 「…일을 진행하고 있습니다.」
   *           (지금 실제로 손이 움직이는 중인지는 모르므로 「지금 만들고 있습니다」는 activity.live 일 때만 말한다).
   *   「진행」이 여러 건이면 가장 최근에 갱신된 일을 말한다.
   * ORD_DESK_PROGRESS_MAX_H: 「진행」으로 오래 남은 일 때문에 책상 모습이 늘 나오지 않게 하는 값 — 이 시간 안에 갱신된(대장의 갱신 시각 기준) 「진행」만 본다.
   *   24 = 소장 결정(2026-10-10 밤 — 대장에 7일째 「진행」인 일이 있어 제한이 없으면 늘 책상에 앉아 있게 된다). 0 = 제한 없음. */
  var ORD_DESK_ON_PROGRESS = true;
  var ORD_DESK_PROGRESS_MAX_H = 24;
  // 시험 환경(로컬 시험 서버 127.0.0.1 + 가짜 통신)에서만 켜 볼 수 있다. 배포본(폰 앱 · PC판)에서는 위 상수만 본다 — 화면 밖에서 바꿀 길이 없다.
  try {
    if (location.hostname === '127.0.0.1' && window.__mock) {
      if (typeof window.__ordDeskOnProgress === 'boolean') ORD_DESK_ON_PROGRESS = window.__ordDeskOnProgress;
      if (typeof window.__ordDeskMaxH === 'number') ORD_DESK_PROGRESS_MAX_H = window.__ordDeskMaxH;
    }
  } catch (e) {}
  function ordProgFresh(o) {
    if (!ORD_DESK_PROGRESS_MAX_H) return true;
    var t = Date.parse(o.updated_at || o.received_at || '');
    return !isNaN(t) && (Date.now() - t) <= ORD_DESK_PROGRESS_MAX_H * 3600000;
  }
  function ordersScene(state) {
    if (!window.KScene) return;
    var pose = 'idle', text = '';
    if (state === 'loading') text = '작업 현황을 가져오고 있습니다.';
    else if (state === 'nopass') { pose = 'guide'; text = '연동 암호를 넣어 주시면 작업 현황을 보여 드리겠습니다.'; }
    else if (state === 'fail') { pose = 'sorry'; text = '죄송합니다, 작업 현황을 불러오지 못했습니다.'; }
    else {
      var open = ordersRows.filter(function (o) { return !ORD_CLOSED[o.status]; });
      var live = null, wait = 0, prog = null;
      open.forEach(function (o) {
        if (!live && o.activity && o.activity.live) live = o;
        if (o.status === '진행' && ordProgFresh(o) && (!prog || String(o.updated_at || '') > String(prog.updated_at || ''))) prog = o;   // 가장 최근에 갱신된 「진행」
        var d = ordDecided[o.id];
        if (ordNeedsDecision(o) && !(d && d.seq === (o.job_seq | 0))) wait++;
      });
      if (live) { pose = 'desk'; text = '「' + cutText(live.summary || live.id, 20) + '」 — 지금 만들고 있습니다.'; }
      else if (ORD_DESK_ON_PROGRESS && prog) { pose = 'desk'; text = '「' + cutText(prog.summary || prog.id, 20) + '」 일을 진행하고 있습니다.'; }
      else if (wait) { pose = 'report'; text = '확인해 주실 일이 ' + wait + '건 있습니다.'; }
      else if (open.length) text = '아직 안 끝난 일이 ' + open.length + '건 있습니다.';
      else text = '맡기신 일은 다 끝났습니다.';
    }
    KScene.set('kscOrders', pose, text);
  }
  function ordItemHtml(o) {
    var when = o.closed_at ? ('끝남 ' + fmtKst(o.closed_at)) : ('갱신 ' + fmtKst(o.updated_at || o.received_at));
    return '<div class="card ord-item' + (ordersHl && ordersHl === o.id ? ' hl' : '') + '" data-oid="' + esc(o.id) + '">' +
      '<div class="oi-h"><span class="oi-id">' + esc(o.id) + '</span>' + ordStatusHtml(o.status) +
      '<span class="ordch">' + esc(o.channel || '?') + '</span>' + ordModelHtml(o.model, o.model_pref === 'opus') +
      '<span class="oi-when">' + esc(when) + '</span></div>' +
      '<div class="oi-s">' + esc(o.summary || '(요지 없음)') + '</div>' +
      ((ORD_CLOSED[o.status] ? ordEvidenceHtml(o) : '') + ordExtraHtml(o) ? '<div class="oi-tags">' + (ORD_CLOSED[o.status] ? ordEvidenceHtml(o) : '') + ordExtraHtml(o) + '</div>' : '') +
      (ordActivityLine(o) ? '<div class="oi-a">' + esc(ordActivityLine(o)) + '</div>' : '') +
      (o.result ? '<div class="oi-r">' + esc(o.result) + '</div>' : '') +
      (ORD_CLOSED[o.status] && o.evidence && o.evidence.text ? '<div class="oi-r oi-e">근거: ' + esc(o.evidence.text) + '</div>' : '') +
      ordDecideHtml(o) +                               // (O-0201 추가) 결정 대기일 때만 [승인]·[수정 요청]
      '<div class="oi-foot"><span class="oi-r" style="font-size:12px;color:var(--dim)">접수 ' + esc(fmtKst(o.received_at)) + (o.job_seq ? ' · 작업실 #' + esc(o.job_seq) : '') + '</span>' +
      (ORD_HIDEABLE[o.status] ? '<button type="button" class="oi-del" data-ord-del="' + esc(o.id) + '" aria-label="이 항목 지우기" title="목록에서 지우기"><svg><use href="#i-trash"/></svg>지우기</button>' : '') +
      '</div></div>';
  }
  function renderOrders(rows) {
    if (!ordersBody) return;
    rows = Array.isArray(rows) ? rows : [];
    var open = rows.filter(function (o) { return !ORD_CLOSED[o.status]; });
    var done = rows.filter(function (o) { return ORD_CLOSED[o.status]; }).slice(0, 15);
    updateOrdersBadge(open.length);
    ordersRows = rows;
    var h = '<div class="ord-sec">아직 안 끝난 일 <small>' + open.length + '건</small></div>';
    h += open.length ? open.map(ordItemHtml).join('') : '<div class="ord-empty">지금 진행 중이거나 기다리는 일이 없습니다.</div>';
    h += '<div class="ord-sec">최근 끝난 일 <small>' + done.length + '건' +
      (done.length ? ' <button type="button" class="ord-clear" id="ordersClearDone"><svg><use href="#i-trash"/></svg>모두 지우기</button>' : '') + '</small></div>';
    h += done.length ? done.map(ordItemHtml).join('') : '<div class="ord-empty">아직 없습니다.</div>';
    h += '<div class="ord-restore"><button type="button" class="ord-restore-btn" id="ordersRestore">지운 항목 다시 보기</button></div>';   // v5.9: 숨김 되살리기
    ordersBody.innerHTML = h;
    ordersScene();
    if (ordersHl) {                                  // 카드에서 들어왔으면 그 항목으로 스크롤(한 번만)
      var el = ordersBody.querySelector('[data-oid="' + ordersHl.replace(/"/g, '') + '"]');
      if (el) try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      ordersHl = '';
    }
  }
  /* ---- v5.9 작업 현황 「지우기」 = 숨김(서버 hidden_at). 서버 원본 행·PC 지시 대장은 그대로 ----
   * ⚠️ confirm() 금지(앱 함정) → 기존 확인 시트(openSheet) 재사용. 암호 없거나 틀리면 기존 게이트. */
  function ordHideErr(e) {
    if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); return; }
    if (e && e.notready) { toast('서버 준비가 아직 되지 않았습니다(저에게 알려 주세요).'); return; }
    toast('지우지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  function ordFind(id) { for (var i = 0; i < ordersRows.length; i++) if (ordersRows[i].id === id) return ordersRows[i]; return null; }
  function ordDoHide(ids, doneMsg) {
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, '지우려면 PC 연동 암호를 입력해 주세요.'); return; }
    OfficeBridge.hideOfficeOrders(ids, pass).then(function (n) {
      renderOrders(ordersRows.filter(function (o) { return ids.indexOf(o.id) === -1; }));   // 바로 화면에서 빼고
      refreshOrders(true);                                                                 // 서버 기준으로 다시 확인
      toast(n > 0 ? doneMsg.replace('{n}', n) : '지울 항목이 없었습니다(이미 다시 진행 중일 수 있습니다).');
    }).catch(ordHideErr);
  }
  function confirmHideOrder(id) {
    var o = ordFind(id); if (!o || !ORD_HIDEABLE[o.status]) return;
    var open = !ORD_CLOSED[o.status];                // 보류·실패 = 아직 소장이 챙기는 일
    var s = (o.summary || '').replace(/\s+/g, ' ').trim(); if (s.length > 50) s = s.slice(0, 50) + '…';
    openSheet(o.id + ' 항목을 지울까요?',
      '「' + (s || '요지 없음') + '」 — ' +
      (open ? '목록에서만 사라집니다. 아직 「' + o.status + '」 상태라 PC 지시 대장엔 남아 제가 계속 챙기겠습니다. '
            : '목록에서만 사라지고 기록 원본은 남습니다. ') +
      '맨 아래 [지운 항목 다시 보기]로 되살릴 수 있습니다.',
      '지우기', function () { ordDoHide([id], '지웠습니다.'); });
  }
  function confirmClearDoneOrders() {
    var ids = ordersRows.filter(function (o) { return ORD_CLOSED[o.status]; }).map(function (o) { return o.id; });
    if (!ids.length) { toast('지울 끝난 일이 없습니다.'); return; }
    openSheet('끝난 일 ' + ids.length + '건을 모두 지울까요?',
      '「완료」「취소」된 일만 목록에서 사라집니다(「보류」「실패」·진행 중인 일은 그대로). 기록 원본은 지워지지 않고, 맨 아래 [지운 항목 다시 보기]로 되살릴 수 있습니다.',
      '모두 지우기', function () { ordDoHide(ids, '끝난 일 {n}건을 지웠습니다.'); });
  }
  function confirmRestoreOrders() {
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, 'PC 연동 암호를 입력해 주세요.'); return; }
    openSheet('지운 항목을 다시 보이게 할까요?', '작업 현황에서 지웠던 항목이 전부 목록으로 돌아옵니다.', '다시 보기', function () {
      OfficeBridge.restoreOfficeOrders(getSyncPass()).then(function (n) {
        refreshOrders(false);
        toast(n > 0 ? n + '건을 다시 보이게 했습니다.' : '지운 항목이 없습니다.');
      }).catch(ordHideErr);
    });
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-refresh'); }   // 되살리기는 빨간 휴지통 대신
  }
  if (ordersBody) ordersBody.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    if (ordDecideClick(ev)) return;                    // (O-0201 추가) [승인]·[수정 요청]
    var d = t.closest('[data-ord-del]'); if (d) { ev.preventDefault(); confirmHideOrder(d.getAttribute('data-ord-del')); return; }
    if (t.closest('#ordersClearDone')) { ev.preventDefault(); confirmClearDoneOrders(); return; }
    if (t.closest('#ordersRestore')) { ev.preventDefault(); confirmRestoreOrders(); return; }
  });

  function updateOrdersBadge(n) {
    var b = $('ordersOpenBadge'); if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = ''; } else b.style.display = 'none';
  }

  /* ===================== PC↔폰 공유함(locker) =====================
   * 카카오톡 「나와의 채팅」처럼, 케이(chat_responder)는 개입하지 않고 대표님 기기끼리만
   * 글·파일을 올려두고 서로 보는 방. 케이 답변 없음. 순수 보관·기기간 공유.
   *   · 서버: kind='locker' 로 저장 → 어떤 워커도 처리 안 함(collect 는 명시 스킵, 나머지는 kind 필터로 자동 제외).
   *   · 동기화: list_locker RPC 를 방 열렸을 때 폴링(같은 연동 암호 재사용). 채팅과 완전히 별도 스트림.
   *   · 파일: 공개 버킷 locker 에 올려 공개 URL 로 상대 기기서 다운로드(변환 없음). */
  // ⚠️ 공유함은 "완전 공유" — 모든 기기가 서버의 전체 목록을 똑같이 본다(채팅의 '지금부터'와 다름).
  //    since 표식 키를 v2 로 바꿔(기존에 '지금'으로 굳어 있던 낡은 표식을 한 번 무시) 모든 기기가
  //    처음 열 때 아주 과거부터(=서버 전체) 다시 받도록 한다. 이후엔 표식이 전진해 새 것만 증분 수신.
  var LOCKER_MSGS_KEY = 'smart_locker_msgs', LOCKER_SINCE_KEY = 'smart_locker_since2';
  var LOCKER_EPOCH = '1970-01-01T00:00:00.000Z';   // 처음 열 때 여기부터 = 서버 공유함 전체를 본다
  var lockerView = $('lockerView'), lockerLog = $('lockerLog'), lockerInput = $('lockerInput');
  var lockerLoading = false, lockerTimer = null, lockerPendingFiles = [];
  var lockerMsgs = loadLockerMsgs();
  // v4.0: 공유함도 삭제를 서버 반영 + 로컬 tombstone. v3.9(전체 재조회) 뒤로 "지워도 다시 뜸"을 막는다.
  var LOCKER_DELETED_KEY = 'smart_locker_deleted';       // 개별 삭제한 행 id(재출현 방지)
  var LOCKER_CLEARED_KEY = 'smart_locker_cleared_before'; // 「전체 삭제」 경계(이 시각 이전은 이 기기서 안 그림)
  function loadLockerDeleted() { try { var a = JSON.parse(localStorage.getItem(LOCKER_DELETED_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  var lockerDeleted = loadLockerDeleted();
  function saveLockerDeleted() { try { localStorage.setItem(LOCKER_DELETED_KEY, JSON.stringify(lockerDeleted.slice(-1000))); } catch (e) {} }
  function isLockerDeleted(id) { return !!id && lockerDeleted.indexOf(id) !== -1; }
  function isLockerBeforeCleared(ts) { var c = ''; try { c = localStorage.getItem(LOCKER_CLEARED_KEY) || ''; } catch (e) {} return !!c && !!ts && ts <= c; }

  function loadLockerMsgs() {
    try {
      var a = JSON.parse(localStorage.getItem(LOCKER_MSGS_KEY) || '[]'); if (!Array.isArray(a)) return [];
      // v6.3: 올리던 중 앱·창이 닫혀 끝나지 못한 항목 → '올리는 중…'에 영원히 머물지 않게 실패로 표시
      a.forEach(function (m) { if (m && m.uploading) { m.uploading = false; m.error = true; m.errorMsg = '앱이 닫혀 전송이 중간에 끊겼습니다. 파일을 다시 보내 주세요.'; delete m.progress; } });
      return a;
    } catch (e) { return []; }
  }
  function saveLockerMsgs() {
    try {
      lockerMsgs.forEach(function (m) { if (!m.uid) m.uid = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); });
      localStorage.setItem(LOCKER_MSGS_KEY, JSON.stringify(lockerMsgs.slice(-500)));
    } catch (e) {}
  }
  function lockerSince() {
    // 처음(표식 없음)이면 아주 과거부터 → list_locker 가 서버 공유함 전체(최근 500)를 돌려준다(완전 공유).
    try { var s = localStorage.getItem(LOCKER_SINCE_KEY); if (!s) { s = LOCKER_EPOCH; localStorage.setItem(LOCKER_SINCE_KEY, s); } return s; }
    catch (e) { return LOCKER_EPOCH; }
  }
  function hasLockerRow(cid) {
    for (var i = 0; i < lockerMsgs.length; i++) {
      if ((lockerMsgs[i].id && lockerMsgs[i].id === cid) || (lockerMsgs[i].cid && lockerMsgs[i].cid === cid)) return true;
    }
    return false;
  }
  function lockerScroll() { try { if (lockerLog) lockerLog.scrollTop = lockerLog.scrollHeight; window.scrollTo(0, document.body.scrollHeight); } catch (e) {} }
  function lockerUid(m) { if (!m.uid) m.uid = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); return m.uid; }

  function renderLocker() {
    if (!lockerLog) return;
    if (!lockerMsgs.length) {
      lockerLog.innerHTML = '<div class="chatintro"><div class="chatintro-ic"><svg><use href="#i-copy"/></svg></div>' +
        '<b>PC↔폰 공유함</b><p>여기에 올린 글·파일은 <b>케이가 보지 않고</b> 폰과 PC에서 함께 보입니다.<br>한쪽에서 올리면 다른 쪽에도 뜹니다.</p></div>';
      return;
    }
    lockerLog.innerHTML = lockerMsgs.map(function (m) {
      var inner = m.text ? chatText(m.text) : '';
      if (m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span class="lk-prog" style="opacity:.75">' + esc(lockerProgText(m)) + '</span>';
      if (m.error) inner += (inner ? '<br>' : '') + (m.errorMsg ? '<span class="lk-err" style="display:block;margin-top:4px;padding:7px 9px;border-radius:9px;background:rgba(0,0,0,.32);color:#fff;line-height:1.45"><b>올리지 못했습니다</b><br>' + esc(m.errorMsg) + '</span>' : '<span style="color:var(--rec)">올리지 못했습니다</span>');
      inner += attachChips(m.files, false);                 // 항상 다운로드 가능(공개 url)
      if (!inner) inner = '<span style="opacity:.6">(빈 메모)</span>';
      return '<div class="bubble me" data-uid="' + lockerUid(m) + '">' + inner +
        '<button type="button" class="bmenu" aria-label="메뉴(복사·삭제)">⋯</button></div>';
    }).join('');
    lockerScroll();
  }
  function renderLockerPending() {
    var strip = $('lockerPendingStrip'); if (!strip) return;
    if (!lockerPendingFiles.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
    strip.style.display = 'flex';
    strip.innerHTML = lockerPendingFiles.map(function (f, i) {
      return '<span class="pendchip">' + esc(f.name || '파일') + '<button type="button" data-i="' + i + '" aria-label="빼기">×</button></span>';
    }).join('');
    Array.prototype.forEach.call(strip.querySelectorAll('button[data-i]'), function (b) {
      b.addEventListener('click', function () { lockerPendingFiles.splice(+b.getAttribute('data-i'), 1); renderLockerPending(); });
    });
  }
  function autoGrowLocker() { if (!lockerInput) return; lockerInput.style.height = 'auto'; lockerInput.style.height = Math.min(120, lockerInput.scrollHeight) + 'px'; }

  function openLocker() {
    openScreen(lockerView);
    renderLocker(); renderLockerPending();
    loadLockerSync(); startLockerSync();
    // 공유함은 연동 암호가 있어야 다른 기기(PC↔폰)의 파일을 받아온다. 암호가 없으면
    // 조용히 '안 보이는' 상태가 되므로, 없을 땐 매번 암호 입력을 안내한다(v3.9).
    if (!getSyncPass()) showSyncGate(true);
  }
  // v6.3: 진행률 글자 — '올리는 중… 37% (20.6/55.8MB)'
  function lockerProgText(m) {
    var p = m.progress;
    if (!p || !p.total) return '올리는 중…';
    var pct = Math.min(100, Math.floor(p.sent * 100 / p.total));
    var mb = function (n) { return (n / 1048576).toFixed(1); };
    return '올리는 중… ' + pct + '% (' + mb(p.sent) + '/' + mb(p.total) + 'MB' + (p.count > 1 ? ', ' + (p.index + 1) + '/' + p.count + '번째 파일' : '') + ')';
  }
  // 진행률은 해당 말풍선 글자만 바꾼다(목록 전체 재그리기는 무거움). 없으면 0.3초 간격으로 전체 재그리기.
  function updateLockerProgress(item) {
    if (!isOpen(lockerView) || !lockerLog) return;
    var el = null;
    try { el = lockerLog.querySelector('.bubble[data-uid="' + item.uid + '"] .lk-prog'); } catch (x) {}
    if (el) { el.textContent = lockerProgText(item); return; }
    var now = Date.now();
    if (!item._lastRender || now - item._lastRender > 300) { item._lastRender = now; renderLocker(); }
  }
  var lockerRestored = {};   // v6.3: 실패 후 파일을 대기줄로 되돌린 말풍선 uid(이 화면 세션에서만 — 저장 안 함)
  function sendLockerMsg() {
    if (!lockerInput) return;
    var text = (lockerInput.value || '').trim();
    var files = lockerPendingFiles.slice();
    if (!text && !files.length) return;
    // v6.3: 앞서 실패해 파일을 대기줄로 되돌려 둔 말풍선은 이번 재전송이 대신하므로 지운다(중복 방지)
    lockerMsgs = lockerMsgs.filter(function (m) { return !(m.error && m.uid && lockerRestored[m.uid]); });
    lockerRestored = {};
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var disp = files.map(function (f) { return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) }; });
    var item = { id: id, text: text, ts: Date.now(), files: disp.length ? disp : null, up: !!files.length, uploading: !!files.length };
    lockerUid(item);
    lockerMsgs.push(item); saveLockerMsgs();
    lockerInput.value = ''; autoGrowLocker(); lockerPendingFiles = []; renderLockerPending(); renderLocker();
    var memo = { id: id, token: tok, text: text };
    OfficeBridge.sendLocker(memo, files, function (sent, total, index, count) {
      item.progress = { sent: sent, total: total, index: index, count: count };   // 화면용(저장 안 함)
      updateLockerProgress(item);
    }).then(function (savedFiles) {
      item.uploading = false; delete item.progress; delete item._lastRender;
      if (savedFiles && savedFiles.length) item.files = savedFiles;   // 공개 url 채워 내 기기서도 다운로드칩 표시
      saveLockerMsgs(); if (isOpen(lockerView)) renderLocker();
    }).catch(function (e) {
      var why = (e && (e.friendly || e.message)) || String(e || '알 수 없는 오류'), restored = false;
      item.uploading = false; item.error = true; item.errorMsg = why; delete item.progress; delete item._lastRender;
      // 파일은 보낼 대기줄로 되돌려 두고(파일 객체는 이 화면에만 있음), 글은 입력칸이 비어 있으면 되돌린다 → [보내기]만 다시 누르면 재전송
      if (files.length && e && e.reason !== 'too_big' && e.reason !== 'unreadable') {
        lockerPendingFiles = files.concat(lockerPendingFiles); lockerRestored[item.uid] = true; restored = true; renderLockerPending();
        if (text && lockerInput && !lockerInput.value) { lockerInput.value = text; autoGrowLocker(); }
      }
      saveLockerMsgs();
      if (isOpen(lockerView)) renderLocker();
      toast('올리지 못했습니다 — ' + why + (restored ? ' (파일은 보낼 칸에 다시 넣어 두었습니다)' : ''));
    });
  }
  function loadLockerSync() {
    if (lockerLoading || !(window.OfficeBridge && OfficeBridge.listLocker)) return;
    var pass = getSyncPass(); if (!pass) return;
    lockerLoading = true;
    // v3.9: 매번 서버 공유함 '전체'(EPOCH부터, 최근 500)를 받아 id 로 중복 제거한다.
    //   증분 마커(since)를 쓰면 옛 PC판 캐시·기기 시계차로 마커가 과하게 전진했을 때
    //   그 뒤로 올라온 파일이 'ts > since'에서 걸러져 "올렸는데 안 보인다"가 났다.
    //   개인 보관함이라 전체 재조회가 가벼워, 마커 꼬임에 영향받지 않게 항상 전체를 본다.
    OfficeBridge.listLocker(LOCKER_EPOCH, pass).then(function (rows) {
      lockerLoading = false;
      if (!rows || !rows.length) return;
      var added = 0;
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (hasLockerRow(row.id)) return;               // 내가 올린 것/이미 받은 것 → 건너뜀(중복 방지)
        if (isLockerDeleted(row.id)) return;            // v4.0: 개별 삭제한 것 — 다시 안 그림(재출현 방지)
        if (isLockerBeforeCleared(row.ts)) return;      // v4.0: 「전체 삭제」 경계 이전은 이 기기서 안 그림
        var meta = row.meta || {};
        var files = (meta.files || []).map(function (f) {
          return { name: f.name || '파일', url: f.url || '', size: f.size || 0, mime: f.mime || '', kind: f.kind || '' };
        }).filter(function (f) { return f.url; });
        var ts = row.ts ? Date.parse(row.ts) : Date.now(); if (isNaN(ts)) ts = Date.now();
        lockerMsgs.push({ text: (row.note || '').trim(), ts: ts, files: files.length ? files : null, cid: row.id, remote: true });
        added++;
      });
      if (added) {
        lockerMsgs.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        saveLockerMsgs();
        if (isOpen(lockerView)) renderLocker();
        else toast('공유함에 새 자료가 도착했습니다.');
      }
    }).catch(function (e) {
      lockerLoading = false;
      if (e && e.badpass) { setSyncPass(''); if (isOpen(lockerView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
    });
  }
  function startLockerSync() {
    if (lockerTimer) return;
    lockerTimer = setInterval(function () {
      if (!isOpen(lockerView)) { stopLockerSync(); return; }
      loadLockerSync();
    }, 3500);
  }
  function stopLockerSync() { if (lockerTimer) { clearInterval(lockerTimer); lockerTimer = null; } }

  function openLockerActionSheet(uid) {
    var m = null;
    for (var i = 0; i < lockerMsgs.length; i++) { if (lockerMsgs[i].uid === uid) { m = lockerMsgs[i]; break; } }
    if (!m) return;
    var copyText = (m.text || '').trim() || (m.files && m.files.length ? m.files.map(function (f) { return f.url; }).filter(Boolean).join('\n') : '');
    var title = (m.text ? (m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text) : (m.files && m.files.length ? '(첨부 파일)' : '(빈 메모)'));
    openSheet('이 항목', title, '삭제', function () { deleteLocker(uid); }, copyText || null);
  }
  function deleteLocker(uid) {
    var target = null;
    for (var i = 0; i < lockerMsgs.length; i++) { if (lockerMsgs[i].uid === uid) { target = lockerMsgs[i]; break; } }
    if (!target) return;
    var rid = target.cid || target.id || null;     // 서버 행 id(있으면 서버에서도 숨김)
    if (rid) {
      if (lockerDeleted.indexOf(rid) === -1) { lockerDeleted.push(rid); saveLockerDeleted(); }   // 로컬 tombstone(재출현 방지)
      var pass = getSyncPass();
      if (pass && window.OfficeBridge && OfficeBridge.hideMemo) OfficeBridge.hideMemo(rid, pass).catch(function () {});   // 다른 기기서도 삭제
    }
    lockerMsgs = lockerMsgs.filter(function (x) { return x.uid !== uid; });
    saveLockerMsgs(); renderLocker(); toast('삭제했습니다.');
  }
  function clearAllLocker() {
    if (!lockerMsgs.length) { toast('지울 자료가 없습니다.'); return; }
    openSheet('공유함을 모두 지울까요?', '이 기기 화면의 목록만 지워집니다(다른 기기·서버에 올린 파일은 그대로 남습니다).', '전체 삭제', function () {
      // v4.0: 경계 마커로 '이 시각 이전' 서버 항목을 이 기기서 다시 안 그리게(v3.9 전체 재조회로 되살아나던 것 방지)
      try { localStorage.setItem(LOCKER_CLEARED_KEY, new Date().toISOString()); } catch (e) {}
      lockerMsgs = []; saveLockerMsgs();
      renderLocker(); toast('공유함 목록을 지웠습니다.');
    });
  }

  // (O-0118 → O-0120 v7.3) 「PC 케이에게 직접」
  //   v7.2는 claude.ai/code 를 바로 열어, 폰 Claude 앱에서 「새 클라우드 작업(저장소 선택)」 시트가 떴다.
  //   원격 제어(Remote Control) 세션 주소(claude.ai/code/session_…)는 PC 쪽 대화가 압축·재개될 때마다 바뀌어
  //   (9/18~10/1 사이 7번 바뀜) 고정 주소로 박으면 곧 죽는다 → 먼저 짧은 안내 시트를 띄우고 [Claude 앱 열기]로 연다.
  //   ▼ 나중에 바꿀 곳은 이 상수 셋뿐.
  //   PC_K_SESSION_URL: 실제로 열어 확인된 세션 주소가 생기면 여기에 넣는다(비어 있으면 PC_K_OPEN_URL 사용).
  var PC_K_SESSION_TITLE = '통합 앱 메신저/메일/뷰어 기능';
  var PC_K_OPEN_URL = 'https://claude.ai/code';
  var PC_K_SESSION_URL = '';
  function openPcKClaude() {
    var w = null;
    try { w = window.open(PC_K_SESSION_URL || PC_K_OPEN_URL, '_blank'); } catch (e) {}
    if (!w) toast('Claude 화면을 열지 못했습니다 — 다시 눌러 주세요.');
  }
  if ($('btnPcK')) $('btnPcK').addEventListener('click', function () {
    openSheet('Claude Code 연결',
      'PC 케이와 대화방(Claude 앱)에서 직접 일을 시키는 곳입니다. PC 화면을 직접 보며 조작하려면 「PC 원격 제어」를 누르세요.\n' +
      '① Claude 앱이 열리면 새 작업 창은 ✕로 닫아 주세요.\n' +
      '② Code 대화 목록에서 컴퓨터 표시(초록 점)가 붙은 「' + PC_K_SESSION_TITLE + '」을 고르세요.\n' +
      '③ 그 대화창에 바로 입력하시면 PC 케이에게 전달됩니다.',
      'Claude 앱 열기', openPcKClaude);
    if (sheetMsg) sheetMsg.classList.add('pck');   // 여러 줄 안내(왼쪽 정렬·줄바꿈 유지·높이 제한 해제)
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-chat'); }   // 여는 동작이라 빨간 휴지통 대신
  });
  // v8.7(O-0173) 홈 「PC 화면」 — 크롬 원격 데스크톱으로 24시간 PC 화면을 직접 보고 조작(대표님 「크롬 원격제어 버튼도 따로」).
  //   폰: ExternalApp.launchApp(com.google.chromeremotedesktop), 없으면 「스토어 열기」 시트 / PC판: remotedesktop.google.com/access 새 탭.
  //   여는 방법은 문서 뷰어 [원격 화면 열기]와 같은 한 곳(docviewer.js editOpenRemote → SmartDocs.openRemote).
  if ($('btnPcScreen')) $('btnPcScreen').addEventListener('click', function () {
    if (window.SmartDocs && typeof SmartDocs.openRemote === 'function') { SmartDocs.openRemote(); return; }
    var w = null; try { w = window.open('https://remotedesktop.google.com/access', '_blank', 'noopener'); } catch (e) {}
    if (!w) toast('원격 화면을 열지 못했습니다 — 「크롬 원격 데스크톱」 앱을 직접 열어 주세요.');
  });
  // v9.3(O-0247) 홈 「미러링」 — 폰 화면을 로키드 안경에 비추는 네이티브 화면을 연다(별도 앱 「미러링」 v0.4 를 앱 안으로 옮긴 것).
  //   칸은 처음에 숨겨져 있고(index.html), 폰 앱의 Mirror 플러그인이 「쓸 수 있음」(안드로이드 10 이상)이라고 답할 때만 보인다.
  //   PC판·옛 APK·안드로이드 9 이하에서는 숨긴 채다. 미러링으로 가는 길은 이 칸 하나뿐이다(「보내는 중」 알림을 눌러도 같은 화면).
  //   화면 공유·근처 기기·알림 허용 창은 그 화면에서 「시작」을 누를 때만 뜬다 — 여기서는 화면을 열기만 한다.
  (function () {
    var b = $('btnMirror'), sub = $('mirrorSub');
    if (!b) return;
    var C = window.Capacitor;
    var MP = C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.Mirror;
    if (!MP || typeof MP.status !== 'function' || typeof MP.open !== 'function') return;
    b.addEventListener('click', function () {
      try {
        MP.open().then(function (r) { if (!r || !r.opened) toast('미러링 화면을 열지 못했습니다 — 다시 눌러 주세요.'); })
                 .catch(function () { toast('미러링 화면을 열지 못했습니다 — 다시 눌러 주세요.'); });
      } catch (e) { toast('미러링 화면을 열지 못했습니다 — 다시 눌러 주세요.'); }
    });
    try {
      MP.status().then(function (r) {
        if (!r || !r.supported) return;
        b.style.display = ''; if (sub) sub.style.display = '';
      }).catch(function () {});
    } catch (e) {}
  })();
  if ($('btnLocker')) $('btnLocker').addEventListener('click', openLocker);
  if ($('btnMeetings')) $('btnMeetings').addEventListener('click', openMeetings);   // v5.2: 회의 요약 탭
  if ($('lockerSend')) $('lockerSend').addEventListener('click', sendLockerMsg);
  if (lockerInput) {
    lockerInput.addEventListener('input', autoGrowLocker);
    lockerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLockerMsg(); } });
  }
  if ($('lockerAttach')) $('lockerAttach').addEventListener('click', function () { var fi = $('lockerFileInput'); if (fi) fi.click(); });
  function onLockerFilesPicked(fileList) {
    var fs = keepSendable(fileList);              // v6.6: 5GB 초과는 고를 때 바로 빼고 안내(보낼 때 거절되기 전에)
    if (fs.length) { lockerPendingFiles = lockerPendingFiles.concat(fs); renderLockerPending(); }
  }
  if ($('lockerFileInput')) $('lockerFileInput').addEventListener('change', function () {
    onLockerFilesPicked(this.files);
    this.value = '';
  });

  /* ---- 드래그 앤 드롭 첨부(PC판=마우스). 파일을 화면에 끌어다 놓으면 기존 첨부 경로로 그대로 태운다.
         폰(터치)은 파일 드래그 이벤트가 없어 이 리스너가 아예 안 걸리므로 기존 첨부 흐름에 무해하다.
         'Files' 종류의 드래그일 때만 반응(대화 글자 선택·드래그엔 반응 안 함). ---- */
  function dragHasFiles(e) {
    try { var t = e.dataTransfer && e.dataTransfer.types; if (!t) return false; return (t.indexOf ? t.indexOf('Files') !== -1 : Array.prototype.indexOf.call(t, 'Files') !== -1); } catch (x) { return false; }
  }
  function enableDropZone(el, onFiles) {
    if (!el) return;
    var depth = 0;
    el.addEventListener('dragenter', function (e) { if (!dragHasFiles(e)) return; e.preventDefault(); depth++; el.classList.add('dropping'); });
    el.addEventListener('dragover', function (e) { if (!dragHasFiles(e)) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch (x) {} });
    el.addEventListener('dragleave', function (e) { if (!dragHasFiles(e)) return; depth--; if (depth <= 0) { depth = 0; el.classList.remove('dropping'); } });
    el.addEventListener('drop', function (e) {
      if (!dragHasFiles(e)) return;
      e.preventDefault(); depth = 0; el.classList.remove('dropping');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      // v6.3: 폴더를 끌어 놓으면 브라우저가 '크기 0짜리 파일'처럼 넘겨 전송이 실패한다 → 폴더는 빼고 알려 준다
      var arr = Array.prototype.slice.call(files), items = e.dataTransfer.items, dirs = 0;
      if (items && items.length === arr.length) {
        arr = arr.filter(function (f, i) {
          var it = items[i], en = null;
          try { en = it && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch (x) {}
          if (en && en.isDirectory) { dirs++; return false; }
          return true;
        });
      }
      if (arr.length) onFiles(arr);
      if (dirs) toast('폴더는 올릴 수 없습니다(' + dirs + '개 뺐습니다). 폴더 안 파일을 골라 끌거나, 압축(zip)해서 올려 주세요.');   // 폴더 안내가 뒤에 떠야 가려지지 않음
    });
  }
  // 채팅: 드롭 → 기존 첨부 대기줄(chatPendingFiles)로 (전송 때 글과 함께 발송)
  enableDropZone($('chatView'), function (files) { onChatFilesPicked(files); });
  // 공유함: 드롭 → 기존 공유함 대기줄(lockerPendingFiles)로 (전송 때 sendLocker로 업로드)
  enableDropZone($('lockerView'), function (files) {
    var fs = keepSendable(files);                 // v6.6
    var removed = fs.removed;
    if (!fs.length) return;
    lockerPendingFiles = lockerPendingFiles.concat(fs); renderLockerPending();
    if (!removed) toast('파일을 붙였습니다. 보내기를 누르세요.');
  });
  if ($('lockerMenuBtn')) $('lockerMenuBtn').addEventListener('click', function () {
    var linked = !!getSyncPass();
    openSheet('공유함 메뉴',
      linked ? 'PC와 폰이 연동되어 있습니다.' : 'PC(크롬)에서도 같은 공유함을 보려면 연동하세요.',
      '공유함 전체 삭제', clearAllLocker, null,
      { label: linked ? 'PC 연동 암호 변경' : 'PC 연동 암호 설정', action: function () { showSyncGate(true); } });
  });
  if (lockerLog) lockerLog.addEventListener('click', function (ev) {
    var ln = ev.target.closest ? ev.target.closest('a.chatlink,[data-link]') : null;
    if (ln) { ev.preventDefault(); var lu = ln.getAttribute('data-link') || ln.getAttribute('href'); var lw = window.open(lu, '_blank'); if (!lw) toast('링크를 열지 못했습니다.'); return; }
    var mb = ev.target.closest ? ev.target.closest('.bmenu') : null;
    if (mb) { var bub = mb.closest('.bubble[data-uid]'); if (bub) openLockerActionSheet(bub.getAttribute('data-uid')); return; }
    var dv = ev.target.closest ? ev.target.closest('[data-view-url]') : null;
    if (dv) {                                        // 공유함 문서도 [뷰어로 보기] → 문서 뷰어로 표시(2026-09-21)
      openDocFromChat({ url: dv.getAttribute('data-view-url'), name: dv.getAttribute('data-view-name'), mime: dv.getAttribute('data-view-mime'), kind: 'document' });
      return;
    }
    var dl = ev.target.closest ? ev.target.closest('[data-dl-url]') : null;
    if (dl) { downloadAttachment(dl.getAttribute('data-dl-url'), dl.getAttribute('data-dl-name')); return; }   // [다운로드]
    var b = ev.target.closest ? ev.target.closest('[data-att-url]') : null;
    if (!b) return;
    openAttachmentChip(b.getAttribute('data-att-url'), b.getAttribute('data-att-name'));   // v7.9: 폰은 APK 등 = 네이티브 저장
  });

  // 홈 소장 K 오브 → 케이 채팅(옛 가로 카드 대체, 진입 경로 일원화)
  if ($('btnVoiceChat')) $('btnVoiceChat').addEventListener('click', function () { openChat(); });
  if ($('kBubble')) $('kBubble').addEventListener('click', function () { openChat(); });   // (O-0117) 케이 말풍선 → 대화(첫 안읽음 위치)

  /* ---- v6.0 케이 프로필 카드 + 옷장 「케이 꾸미기」 ---- */
  var kProfile = $('kProfile'), kwFrom = null;
  function openKProfile() {
    if (!kProfile) return;
    var pf = kProfile.querySelector('[data-kface=profile]');
    if (window.KChar) KChar.restartFace(pf, 2000);  // 정지 사진 먼저 → 영상은 0초부터(눈 감은 프레임 방지). (O-0226) 첫 사진이 미소라 2초 보여 준 뒤 움직이는 영상으로(예전 0.45초)
    kProfile.style.display = 'flex';
  }
  function closeKProfile() { if (kProfile) kProfile.style.display = 'none'; }
  if ($('kHeadBtn')) $('kHeadBtn').addEventListener('click', openKProfile);
  if ($('kProfClose')) $('kProfClose').addEventListener('click', closeKProfile);
  if (kProfile) kProfile.addEventListener('click', function (ev) { if (ev.target === kProfile) closeKProfile(); });
  if ($('kProfWardrobe')) $('kProfWardrobe').addEventListener('click', function () { closeKProfile(); openKWardrobe(); });   // v9.9: 홈에 길이 있으면(KW_HOME) 이 단추는 숨는다 — KW_HOME='off' 일 때만 보인다
  /* ---- v9.9 (O-0451) 케이 꾸미기(옷 / 설정)로 가는 길: 채팅 프로필 카드 → 홈 케이 카드 ----
   * 자리는 이 상수 하나로 고른다(이 값만 바꿔 다시 묶으면 된다 — index.html · styles.css 에는 세 모습이 모두 들어 있다):
   *   'corner' = 가안: 홈 케이 카드 오른쪽 위 「옷·설정」 단추(「소장 K」 이름표는 왼쪽 위로)
   *   'row'    = 나안: 케이 카드 바로 아래 한 줄(「지금 옷 · ○○ … 옷·설정 ›」)
   *   'off'    = v9.7 그대로: 홈에는 없고, 채팅에서 케이 얼굴 → 프로필 카드의 [케이 꾸미기]
   * 꾸미기 화면 자체는 그대로다. 홈에서 열면 닫을 때 홈으로 돌아온다(kwFrom — 예전부터 있던 갈래). */
  var KW_HOME = 'corner';
  var kwHomeOn = (KW_HOME === 'corner' || KW_HOME === 'row');
  try { document.documentElement.setAttribute('data-kwhome', kwHomeOn ? KW_HOME : 'off'); } catch (e) {}
  if (kwHomeOn) {
    ['kHeroDress', 'kHeroDressRow'].forEach(function (id) { if ($(id)) $(id).addEventListener('click', function () { openKWardrobe(); }); });   // 보이는 것은 둘 중 하나뿐이다(styles.css)
    if (KW_HOME === 'row' && window.KChar) {             // 나안: 한 줄에 지금 옷 이름(옷이 바뀌면 따라 바뀐다)
      var paintKwHomeRow = function () {
        try {
          var nm = KChar.lookName ? KChar.lookName() : KChar.outfit().name;
          if ($('kHeroDressNow')) $('kHeroDressNow').textContent = nm;
          if ($('kHeroDressRow')) $('kHeroDressRow').setAttribute('aria-label', '케이 옷·설정 열기 — 지금 옷 ' + nm);
        } catch (e) {}
      };
      KChar.ready.then(paintKwHomeRow); KChar.onChange(paintKwHomeRow);
    }
  }
  /* (O-0471) 옷 목록을 내려도 「지금 모습」(상반신 + 전신)이 따라온다 — js/k-wardrobe-follow.js. 여기서는 켜기만 한다(화면이 열리고 닫히는 것 · 탭 · 옷 바뀜은 그 파일이 스스로 지켜본다).
   *   KW_FOLLOW       'dock' = 내리면 위 사진이 줄어들며 [뒤로] 줄 밑에 붙는다 · 'off' = 예전 그대로(아래 세 값도 함께 꺼진다)
   *   KW_FOLLOW_SIZE  붙은 사진의 높이 = 화면 높이 × 이 값(0.20 → 0.25 로 올리면 사진이 커지고 목록 자리가 그만큼 준다)
   *   KW_FOLLOW_WIDE  넓은 화면(폴드 펼침 · 폭 700 이상)에서 왼쪽에 사진을 붙여 두고 오른쪽에서 고른다 · false = 넓은 화면도 좁은 화면처럼
   *   KW_SET_FADE     「설정」 탭을 올렸을 때 사진이 [뒤로] 줄 뒤로 비치지 않게 서서히 사라진다 · false = 예전처럼 비친다
   *   KW_FOLLOW_CSS   줄어드는 움직임을 CSS 가 스크롤에 붙여 돌린다(폰에서 떨리지 않게) · false = 스크립트가 스크롤마다 값을 적는 방식(실기기에서 CSS 방식이 이상할 때의 비상용) */
  var KW_FOLLOW = 'dock', KW_FOLLOW_SIZE = 0.20, KW_FOLLOW_WIDE = true, KW_SET_FADE = true, KW_FOLLOW_CSS = true;
  try { if (window.KWFollow) KWFollow.init(KW_FOLLOW, { size: KW_FOLLOW_SIZE, wide: KW_FOLLOW_WIDE, setFade: KW_SET_FADE, css: KW_FOLLOW_CSS }); } catch (e) {}
  // v9.6: 꾸미기 화면의 「옷 / 설정」 탭. 옷 탭 = 옷장만 · 설정 탭 = 설정만(목소리 → 움직임 → 음성 대화 효과음 → (폰만) 바탕화면 위젯 → 글자 크기 → 시작 인사).
  //   고른 탭은 저장하지 않는다 — 꾸미기를 열 때마다 「옷」에서 시작한다(예전 「옷 / 머리」 탭도 저장하지 않았다 → 남아 있는 옛 선택값이 없다).
  //   모르는 값(옛 'hair' 등)이 와도 「옷」으로 본다.
  function setKwTab(which, user) {
    var set = which === 'set';
    [['kwTabOutfit', !set], ['kwTabSet', set]].forEach(function (x) { var b = $(x[0]); if (b) { b.classList.toggle('on', x[1]); b.setAttribute('aria-selected', x[1] ? 'true' : 'false'); } });
    if ($('kwOutfitPane')) $('kwOutfitPane').style.display = set ? 'none' : '';
    if ($('kwSetPane')) $('kwSetPane').style.display = set ? '' : 'none';
    if (set) { try { refreshKStat(true); } catch (e) {} }            // v9.7(O-0401): 케이 목소리 줄 — 설정 탭을 열 때 PC 상태를 한 번 읽는다(받으면 다시 그린다)
    else { try { if (kvPvStop()) renderKVoices(); } catch (e) {} }    //   「옷」 탭으로 가면 미리 듣기를 멈춘다
    // 직접 「설정」을 눌렀을 때: 탭 줄이 화면 위쪽에 오게 올려, 목소리 → 움직임 → 음성 대화 효과음이 한 화면에 들어오게 한다(큰 사진은 위로 넘어간다)
    if (user && set) { try { var seg = document.querySelector('#kWardrobeView .kw-seg'); if (seg) seg.scrollIntoView({ block: 'start' }); } catch (e) {} }
  }
  if ($('kwTabOutfit')) $('kwTabOutfit').addEventListener('click', function () { setKwTab('outfit', true); });
  if ($('kwTabSet')) $('kwTabSet').addEventListener('click', function () { setKwTab('set', true); });
  var kwOutfitAtOpen = '';                            // v9.9: 꾸미기를 열 때 입고 있던 옷(홈으로 돌아왔을 때 「바뀌었나」를 본다)
  function openKWardrobe() {
    kwFrom = isOpen(chatView) ? 'chat' : 'home';
    var kmFrom = null;                                // v9.9(O-0451): 홈에서 열 때 — 바꾸기 직전의 홈 카드 자리·모습을 떠 둔다(효과용 · 화면은 아래에서 바로 바뀐다)
    try { if (kwFrom === 'home' && window.KMotion && KMotion.wardrobeGrab) kmFrom = KMotion.wardrobeGrab($('kHero')); } catch (e) {}
    try { kwOutfitAtOpen = window.KChar ? KChar.outfit().id : ''; } catch (e) { kwOutfitAtOpen = ''; }
    setKwTab('outfit');
    openScreen($('kWardrobeView'));
    renderKWardrobe();
    if (window.KChar) KChar.mount();
    try { if (window.KChar && KChar.assets) KChar.assets.ensureThumbs(); } catch (e) {}   // v9.5: 서버에서 받는 새 옷의 옷장 사진(받으면 목록에 나타난다)
    try { ofWardrobeOpened(); } catch (e) {}          // (O-0487) 다른 기기에서 바꾼 옷이 있으면 열자마자 맞춘다
    try { if (kwFrom === 'home' && window.KMotion && KMotion.wardrobeOpen) KMotion.wardrobeOpen(kmFrom, $('kWardrobeView')); } catch (e) {}
  }
  // v9.10: 케이 꾸미기에서 틀어 둔 소리(목소리 미리 듣기 · 직접 읽기 · 전신 인사)를 멈춘다 — 닫기 단추와, 다른 길로 화면을 떠날 때가 함께 쓴다
  function kwHush() {
    try { if (window.KChar) KChar.voice.stop(); } catch (e) {}
    try { kvPvStop(); } catch (e) {}
    try { stopKFullBow(); } catch (e) {}
  }
  function closeKWardrobe() {
    if (window.KChar) KChar.voice.stop();
    kvPvStop();                                       // v9.7: 케이 목소리 미리 듣기도 멈춘다
    stopKFullBow();
    if (kwFrom === 'chat') { openChat(); return; }
    var kmFrom = null, changed = false;               // v9.9(O-0451): 홈으로 돌아간다 — 큰 사진이 홈 카드 자리로 내려앉고, 옷이 바뀌었으면 홈 카드가 한 번 반짝인다
    try { if (window.KMotion && KMotion.wardrobeGrab) kmFrom = KMotion.wardrobeGrab($('kwHero')); } catch (e) {}
    // v9.10: 녹음 띠가 떠 있고 큰 사진이 띠 뒤로 올라가 있을 때(「설정」 탭처럼 화면을 내린 상태)는 내려앉는 사진을 띄우지 않는다 — 띠를 스쳐 지나갔다.
    //   그때는 옅게 나타나기만 한다. 큰 사진이 띠 아래에 다 보이는 때(「옷」 탭)는 v9.9 의 움직임 그대로.
    try { if (REC_ROAM_V2 && isRecording && kmFrom && recIndicator && recIndicator.style.display !== 'none' && kmFrom.t < recIndicator.getBoundingClientRect().bottom) kmFrom = null; } catch (e) {}
    try { changed = !!(window.KChar && kwOutfitAtOpen && KChar.outfit().id !== kwOutfitAtOpen); } catch (e) {}
    showHome(); setStatus('대기 중', 'idle');
    try { if (window.KMotion && KMotion.wardrobeClose) KMotion.wardrobeClose(kmFrom, $('kHero'), changed); } catch (e) {}
  }
  /* v9.5: 같은 묶음끼리 이어지게 모은다(묶음 순서 = 처음 나온 순서, 묶음 안 순서는 그대로) — 서버에서 온 새 옷도 자기 묶음 끝에 붙는다.
   *   v9.19(O-0557): 옷장 화면과 패션쇼가 같은 순서를 쓰도록 함수 하나로 뺐다(순서 규칙은 예전 그대로). cats = 묶음별 벌 수 · catOrder = 묶음 순서 */
  function kwSorted(list) {
    var cats = {}, catOrder = [];
    list.forEach(function (o) { var c = o.category || ''; if (!cats[c]) catOrder.push(c); cats[c] = (cats[c] || 0) + 1; });
    var out = list.map(function (o, i) { return { o: o, i: i }; }).sort(function (a, b) {
      var d = catOrder.indexOf(a.o.category || '') - catOrder.indexOf(b.o.category || ''); return d || (a.i - b.i);
    }).map(function (x) { return x.o; });
    return { list: out, cats: cats, catOrder: catOrder };
  }
  function renderKWardrobe() {
    if (!window.KChar) return;
    var cur = KChar.outfit(), list = KChar.outfits();
    if ($('kwCurName')) $('kwCurName').textContent = KChar.lookName ? KChar.lookName() : cur.name;
    if ($('kwCount')) $('kwCount').textContent = String(list.length);
    var g = $('kwGrid');
    if (g) {
      var lastCat = null, srt = kwSorted(list), cats = srt.cats;
      list = srt.list;
      var multiCat = Object.keys(cats).length > 1;
      g.innerHTML = list.map(function (o) {
        var on = o.id === cur.id, head = '';
        var c = o.category || '';
        if (multiCat && c !== lastCat) { lastCat = c; head = '<div class="kw-cat">' + esc(c || '기타') + ' <small>' + cats[c] + '벌</small></div>'; }
        return head + '<button type="button" class="kw-item' + (on ? ' on' : '') + '" data-outfit="' + esc(o.id) + '">' +
          '<span class="kw-th"><img src="' + esc(KChar.thumbUrl(o)) + '" alt="" loading="lazy">' + (on ? '<span class="kw-on">입는 중</span>' : '') +
          '</span>' +
          '<span class="kw-nm">' + esc(o.name) + '</span></button>';
      }).join('') +
        '<button type="button" class="kw-item new" data-kreq="outfit"><span class="kw-th"><div><svg><use href="#i-plus"/></svg>추가 요청</div></span><span class="kw-nm">새 옷 부탁하기</span></button>';
    }
    // v9.5: 연동 암호가 없으면 서버 자산을 받지 않는다 → 그 사실을 한 줄로(기존 「연동 암호를 넣으면 …」 안내와 같은 말투 · 새 화면 없음)
    var an = $('kwAssetNote');
    if (an) {
      var nop = !getSyncPass();
      an.textContent = nop ? '연동 암호를 넣으면 다른 옷의 움직임·자세 그림과 새 옷을 받아 옵니다.' : '';
      an.style.display = nop ? 'block' : 'none';
    }
    try { paintKwSyncNote(); } catch (e) {}           // (O-0487) 옷 맞추기가 실제로 켜져 있을 때만 「모든 기기에 함께 적용됩니다」
    var sb = $('kwShowBtn');                           // v9.19(O-0557) 패션쇼 단추 — 스위치가 켜져 있고 옷이 있을 때만
    if (sb) { sb.hidden = !kfsOn || !KChar.outfits().length; sb.classList.toggle('calm', !KChar.motionOn()); if (sb.parentNode) sb.parentNode.classList.toggle('has-show', !sb.hidden); }   // has-show: 폰 폭에서 안내 글을 둘째 줄로(k-fashion-show.css)
    renderKVoices();
    renderKFull();
    renderKIntro();
    var mo = $('kwMotion');
    if (mo) mo.checked = KChar.motionPref();
    if ($('kwMotionWhy')) $('kwMotionWhy').textContent = (KChar.motionPref() && KChar.motionBlockReason()) ? ('지금은 정지 사진: ' + KChar.motionBlockReason()) : '';
  }
  // (O-0116) 꾸미기 상단: 상반신 옆에 전신. 전신 사진이 없는 옷은 예전처럼 상반신 한 장.
  /* (O-0464) 전신을 눌러 인사를 볼 때 머리가 바뀌어 보이던 것 — 서 있는 그림(전신 사진)과 인사 영상의 머리가 달라,
   *   누르는 순간(사진 → 영상)과 끝나는 순간(영상 → 사진)에 0.15초 겹쳐 넘어가며 머리가 바뀌었다.
   *   시작 인사(k-intro.js)는 그 영상의 첫 장면 그림(bow_poster)을 깔아 두고 틀어서 티가 없다 → 전신 칸도 같은 짝을 쓴다.
   *   KW_FB_STILL  'poster' = 인사 영상을 틀 수 있는 옷은 그 영상의 첫 장면을 서 있는 그림으로 · 'photo' = v9.9 그대로(전신 사진)
   *   KW_BOW_END   'hold'   = 인사가 끝나면 끝 장면에 머문다(다시 누르면 처음부터) · 'back' = v9.9 그대로(끝나면 서 있는 그림으로)
   *   둘 다 예전 값이면 v9.9 와 똑같이 움직인다. 인사 영상이 없는 옷 · 움직임을 끈 기기 · 다른 머리 조합은 전신 사진 그대로다. */
  var KW_FB_STILL = 'poster', KW_BOW_END = 'hold';
  var kwFullKey = null;
  function kwFullStill() {                                 // 전신 칸에 깔 그림: 다음에 틀 인사 영상의 첫 장면(없으면 전신 사진)
    var u = KChar.fullbodyUrl(), nx = null;
    try { if (u && KW_FB_STILL === 'poster' && KChar.bowPeek && KChar.motionOn()) nx = KChar.bowPeek(); } catch (e) { nx = null; }
    return (nx && nx.posterUrl) ? nx.posterUrl : u;
  }
  function kwBowPoster(video) {                            // 그 인사 영상의 첫 장면 그림(없으면 '')
    var l = [], i; try { l = KChar.bowList ? KChar.bowList() : []; } catch (e) { l = []; }
    for (i = 0; i < l.length; i++) if (l[i].video === video) return l[i].posterUrl || '';
    return '';
  }
  function paintKFullStill(src) {
    var img = $('kwFullImg'); if (!img || !window.KChar) return;
    src = src || kwFullStill();
    if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
  }
  function stopKFullBow() {
    var fb = $('kwFull'), v = $('kwFullVid'); if (!fb || !v) return;
    var was = fb.classList.contains('bowing') || fb.classList.contains('held');
    fb.classList.remove('bowing'); fb.classList.remove('held');
    try { v.pause(); } catch (e) {}
    if (was) paintKFullStill();                            // 인사가 여러 개인 옷: 다음에 틀 인사의 첫 장면으로(하나뿐이면 같은 그림)
  }
  // 「○○으로/로」: 받침이 없거나 ㄹ 받침이면 「로」, 그 밖의 받침이면 「으로」. 한글로 끝나지 않으면 「(으)로」.
  function josaRo(w) {
    var c = String(w || '').replace(/[\s)\]」』"']+$/, '').slice(-1), k = c ? c.charCodeAt(0) - 0xAC00 : -1;
    if (k < 0 || k > 11171) return '(으)로';
    var j = k % 28; return (j === 0 || j === 8) ? '로' : '으로';
  }
  function renderKFull() {
    var hero = $('kwHero'), img = $('kwFullImg'); if (!hero || !img || !window.KChar || !KChar.fullbodyUrl) return;
    var u = KChar.fullbodyUrl();
    hero.classList.toggle('has-fb', !!u);
    var bow = KChar.bowUrl ? KChar.bowUrl() : '', canBow = !!(bow && KChar.motionOn());
    // (O-0464) 같은 모습을 다시 그리는 것(파일 받기가 끝났다는 알림 등)이면 재생 중인 인사 · 머문 끝 장면을 건드리지 않는다. 옷 · 사진 · 인사 영상이 바뀌었을 때만 멈추고 새로 깐다.
    var key = '';
    try { key = [KChar.outfit().id, u, canBow ? KChar.bowList().map(function (b) { return b.video + '>' + (b.posterUrl || ''); }).join(',') : ''].join('|'); } catch (e) { key = ''; }
    var asBefore = (KW_FB_STILL !== 'poster' && KW_BOW_END !== 'hold');
    if (asBefore || !key || key !== kwFullKey) { kwFullKey = key; stopKFullBow(); paintKFullStill(); }
    if ($('kwFullTip')) $('kwFullTip').style.display = canBow ? '' : 'none';
  }
  if ($('kwFull')) $('kwFull').addEventListener('click', function () {
    if (!window.KChar) return;
    var v = $('kwFullVid'), fb = this, bow = KChar.bowUrl ? KChar.bowUrl() : '';
    if (bow && KChar.bowPick && KChar.motionOn() && v && !fb.classList.contains('bowing')) bow = KChar.bowPick() || bow;   // v9.6: 인사 영상이 여러 개인 옷은 누를 때마다 번갈아(끝 장면에 머문 뒤 다시 누를 때도)
    if (!bow) {                                            // v9.4: 인사 영상이 없는 옷 — 눌러도 아무 일 없던 것을 한 줄 안내로
      toast('인사 영상은 준비 중입니다');
      // v9.5: 서버 목록에는 있는데 아직 못 받은 영상이면 지금 받는다(데이터 절약 모드여도 — 직접 누르셨으므로). 받으면 「눌러 보세요」가 뜬다.
      try { if (KChar.bowState && KChar.bowState() === 'pending' && KChar.assets) KChar.assets.ensureOutfit(KChar.outfit().id, { bow: true }); } catch (e) {}
      return;
    }
    if (!KChar.motionOn() || !v) return;                  // 움직임 꺼짐 → 사진 그대로
    if (fb.classList.contains('bowing')) { stopKFullBow(); return; }
    if (v.getAttribute('src') !== bow) {
      // (O-0464) 다른 영상으로 바꿀 때: 영상 자리가 잠깐 비므로 그 영상의 첫 장면을 먼저 깔아 둔다(끝 장면에 머물던 것은 내린다)
      fb.classList.remove('held');
      if (KW_FB_STILL === 'poster') paintKFullStill(kwBowPoster(bow));
      v.setAttribute('src', bow); try { v.load(); } catch (e) {}
    }
    try { v.currentTime = 0; } catch (e) {}
    v.onplaying = function () { fb.classList.remove('held'); fb.classList.add('bowing'); };
    v.onended = function () {
      if (KW_BOW_END === 'hold') { fb.classList.remove('bowing'); fb.classList.add('held'); }   // 끝 장면에 머문다(다시 누르면 처음부터)
      else stopKFullBow();
    };
    v.onerror = function () { stopKFullBow(); };
    try { var p = v.play(); if (p && p.catch) p.catch(function () { stopKFullBow(); }); } catch (e) { stopKFullBow(); }
  });
  // (O-0116) 시작 인사 설정: 하루 첫 실행만(기본) / 켤 때마다 / 끄기 + [지금 보기]
  function renderKIntro() {
    if (!window.KIntro) return;
    var p = KIntro.pref();
    Array.prototype.forEach.call(document.querySelectorAll('[data-kintro]'), function (b) { b.classList.toggle('on', b.getAttribute('data-kintro') === p); });
    var why = KIntro.blockReason();
    if ($('kwIntroWhy')) $('kwIntroWhy').textContent = (p !== 'off' && why) ? ('지금은 나오지 않습니다: ' + why) : '';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-kintro]'), function (b) {
    b.addEventListener('click', function () {
      if (!window.KIntro) return;
      var v = b.getAttribute('data-kintro'); KIntro.setPref(v); renderKIntro();
      toast(v === 'off' ? '시작 인사를 껐습니다.' : v === 'always' ? '앱을 켤 때마다 케이가 인사합니다.' : '하루 처음 켤 때만 케이가 인사합니다.');
    });
  });
  if ($('kwIntroTry')) $('kwIntroTry').addEventListener('click', function () { if (window.KIntro) KIntro.play(); });
  // O-0040: [＋ 추가 요청] — 한 줄 입력 → 기존 케이 채팅 전송 경로(sendPlainChat)로 보낸다(새 서버 API 없음)
  function kDecorRequestText(kind, text) { return '[케이 꾸미기 추가 요청] 옷: ' + text; }   // v9.6: 머리 부탁하기는 없앴다(머리 고정)
  function openKDecorRequest(kind) {
    modalTitle.textContent = '새 옷 부탁하기';
    modalBody.innerHTML = '<div class="card rcard"><div class="h"><svg><use href="#i-plus"/></svg>어떤 옷을 원하세요?</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">한 줄로 적어 주시면 케이에게 보냅니다. 만들어지면 옷장에 추가됩니다(앱을 다시 열면 보입니다).</div>' +
      '<input id="kReqInput" type="text" maxlength="100" ' +
      'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px" placeholder="' +
      '예: 가을 트렌치코트"></div>' +
      '<div class="btnrow">' +
      '<button id="kReqSend" class="btn primary"><svg><use href="#i-check"/></svg>보내기</button>' +
      '<button id="kReqCancel" class="btn ghost sm"><svg><use href="#i-x"/></svg>취소</button>' +
      '</div>';
    var inp = $('kReqInput');
    $('kReqCancel').addEventListener('click', closeModal);
    function go() {
      var t = ((inp && inp.value) || '').replace(/\s+/g, ' ').trim();
      if (!t) { toast('원하시는 옷을 적어 주세요.'); return; }
      if (t.length > 100) t = t.slice(0, 100);
      closeModal();
      unlockKaiAudio();
      sendPlainChat(kDecorRequestText(kind, t), false).then(function (ok) {
        if (ok) { if (kwFrom === 'home') toast('케이에게 채팅으로 보냈습니다. 만들면 알려 드리겠습니다.', 2600); else toast('요청을 보냈습니다. 만들면 알려 드리겠습니다.'); }   // v9.9: 홈에서 연 꾸미기에서는 채팅 화면이 안 보인다 → 어디로 보냈는지 한마디 더(옷을 고르던 화면은 그대로 둔다)
        else toast('요청을 보내지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      });
    }
    $('kReqSend').addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); go(); } });
    modal.style.display = 'flex';
    setTimeout(function () { if (inp) try { inp.focus(); } catch (e) {} }, 60);
  }
  /* ==================== v9.7 (O-0401) 케이 목소리 고르기 ====================
   * PC(k_voice.py)가 상태 알림(get_k_status)의 voice 칸으로 목록을 내려 준다:
   *   { v:1, chosen:'warm', list:[{k,name,desc,ok,why}], scope:'…', limit:'…', note:'…'(선택), fb:N, wait:초(선택 — [듣기]에도 켰을 때 기다릴 최대 초) }
   *   chosen = 대표님이 고르신 목소리(값은 PC 한 곳에만 있다 → 폰·PC판이 같은 값을 본다) · ok=false 면 지금은 못 쓰는 줄(why=사유)
   *   scope·limit = 어디서 나오는지·하루 횟수 안내(PC 가 실제 설정대로 적어 보낸다) · fb = 오늘 다른 목소리로 대신 읽은 횟수
   * voice 칸이 없으면(PC 스위치 꺼짐·옛 PC·연동 암호 없음·서버 함수 없음) 새 줄을 그리지 않는다 = 예전 화면 그대로.
   * 고르면: 그 줄에 「바꾸는 중…」 → [듣기] 요청에 칸 하나(voice_set)를 얹어 보내고 → 그 요청 행의 결과로 확정한다(상태 알림을 기다리지 않는다).
   *   확정 전에는 동그라미를 옮기지 않는다(바뀌었다 되돌아오는 일이 없게). PC 가 꺼져 있으면 보내지 않는다.
   * (O-0469) 견본 = 줄마다 PC 가 주소를 준다: list[].sample(그 목소리로 「안녕하세요, 케이입니다.」를 읽은 mp3 · 서버 저장소의 주소 · 없으면 "") · 묶음의 sample_text(읽는 문장).
   *   줄을 누르면 → 그 목소리로 고르기(아래) + 견본을 한 번 들려 준다. 읽는 중인 줄을 다시 누르면 멈춘다. 견본이 없는 줄은 「견본 준비 중」이라고 적는다(고르기는 된다).
   *   주소는 받은 그대로 쓴다(자르거나 조립하지 않는다). 목소리가 늘어도 PC 가 목록과 함께 주므로 앱을 다시 깔지 않는다.
   *   v9.7 의 [미리 듣기] 단추와 앱에 넣어 둔 소리 3개(assets/voice/pv_*.mp3)는 이제 쓰지 않는다(그 세 줄이 목록에서 빠졌다 · 파일은 남겨 둠).
   * 「이 폰이 직접 읽기」(기기 음성)는 글 채팅 [듣기]에서만 쓰이는 따로 묶음이다(예전 저장값·동작 그대로 · 다시 누르면 꺼짐). */
  var KV_CACHE_KEY = 'smart_k_voice_srv';
  var KV_MAX_ROWS = 40;                               // O-0469: 목록 줄 수(예전 6 — 「남자1…」이 더해지면 넘는다). 받은 값을 무한정 그리지 않게 넉넉한 상한만 둔다
  var KV_PICK_FOLLOW = true;                          // O-0469: 바꾸는 중에 다른 줄을 누르면 「마지막에 누른 줄」로 따라간다(false = 예전처럼 「앞의 바꾸기가 끝난 뒤에」 안내)
  /* O-0490 (2026-10-13) 케이 목소리 고르는 자리를 「케이 무대」 화면으로 — 아래 「O-0490」 블록(kvStage…) · js/k-voice-stage.js · css/k-voice-stage.css
   *   KV_UI      'stage' = 꾸미기 「설정」에는 한 줄(지금 목소리)만 두고, 누르면 무대 화면이 열린다 · 'list' = v9.10 의 줄 목록 그대로
   *   KV_WARM    예시 소리 미리 받기 — 'open' = 목소리를 고르는 자리가 실제로 보일 때만(무대 화면을 열었을 때 · 목록 방식이면 「설정」 탭) 두 개씩 차례로
   *              'all' = v9.10 그대로(꾸미기를 열면 곧바로 전부 한꺼번에) · 'tap' = 미리 받지 않는다(누를 때 그 주소로 바로 튼다)
   *   KV_DEVICE  기기 음성(「이 폰이 · 이 기기가 직접 읽기」) — false = 그 줄을 그리지 않고 [듣기]도 기기 음성으로 가지 않는다(2026-10-13 확정 「기기 음성은 빼」).
   *              골라 두신 저장값(smart_k_voice)은 지우지 않고 무시한다 → true 로 되돌리면 예전에 고른 음성이 그대로 살아난다. k-character.js 의 기기 음성 코드는 그대로 둔다. */
  var KV_UI = 'stage', KV_WARM = 'open', KV_DEVICE = false;
  var kvPending = null;                               // { key, id, tok, t0, note, timer }
  var kvNext = '';                                    // 바꾸는 중에 누른 다음 줄(앞의 바꾸기가 끝나면 이어서 청한다)
  var kvJust = '';                                    // 방금 확정된 줄(동그라미가 톡 들어오는 움직임 한 번)
  var kvPvAudio = null, kvPvKey = '', kvPvSeq = 0;    // 견본 소리: 지금 읽는 줄 · 재생 번호(늦게 온 「끝남·실패」가 새 재생을 건드리지 않게)
  var kvPvBad = '';                                   // 견본을 받아 오지 못한 줄(그 줄에 사실대로 적는다 · 다시 누르면 지운다)
  var kvPvBlob = {};                                  // 견본 주소 → 미리 받아 둔 소리(blob 주소) · 'x' 받는 중 · 'f' 못 받음. 누르자마자 나게 하려는 것(못 받았으면 주소로 바로 튼다)
  /* 방금 바꾼 값 믿기: 확정(요청 행의 결과) 뒤 75초(PC 상태 주기 60초 + 여유) 동안은, 상태 알림이 아직 옛 값을 주더라도 결과로 받은 값을 보인다.
   *   PC 는 요청 행을 「완료」로 바꾼 뒤에 상태를 따로 올리므로 그 사이에 읽으면 옛 값이 온다 → 「바꿨습니다」 직후 동그라미가 되돌아가 보이던 문제(1차 검토 중간 1).
   *   상태가 새 값을 따라오면 곧바로 풀고(그 뒤의 진짜 변경은 그대로 따른다), 75초가 지나도 옛 값이면 PC 의 값을 따른다.
   *   (O-0490) 고른 목소리에 딸린 값도 함께 지킨다 — 옛 상태에는 고른 번호만이 아니라 안내 한 줄(scope)·[듣기] 기다림(wait)도 옛 목소리 것이 실려 온다.
   *     번호만 지키면 카드는 「남자11 · 느림」인데 안내 줄은 빠른 목소리용 글로 되돌아가 보였다(1차 검토). PC 는 바꾸기 결과에 새 목록(scope·wait 포함)을 실어 준다 → 그 값을 든다.
   *     결과에 scope 가 없으면(옛 PC) 믿는 동안 안내 줄을 비운다(옛 목소리 글을 보이느니 안 보이는 편) · wait 는 결과에 있을 때만 지킨다. */
  var kvHold = null;                                  // { key, until, scope, wait(없으면 null) }
  var KV_HOLD_MS = 75000;
  /* [듣기]를 기다리는 시간: PC 가 알려 준 초(voice.wait)만큼 — 청한 때부터 잰다. 느린 목소리로 긴 글이면 몇 분이 걸려서 상한을 30분으로 둔다(예전 180초).
   *   PC 가 안 주면 0 = 예전 그대로 40번(약 30초). 값만 받아 두므로 PC 에서 바꿔도 앱을 다시 깔지 않는다. */
  var KV_WAIT_MAX_S = 1800;
  function kvListenWaitS() { try { var c = kvCurrent(), w = c && c.blk.wait; return w ? Math.max(30, w) : 0; } catch (e) { return 0; } }
  function kvText(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  /* 견본 주소: 이 앱의 서버 저장소 주소일 때만 받는다(다른 곳의 주소를 틀지 않는다). 받은 주소는 통째로 그대로 쓴다 — 서명 주소(?token=…&v=…)라 한 글자도 바꾸지 않는다. */
  function kvSampleUrl(u) {
    if (typeof u !== 'string' || !u || u.length > 2000) return '';
    var base = (window.OfficeBridge && OfficeBridge.CONFIG && OfficeBridge.CONFIG.url) || '';
    return (base && u.indexOf(base + '/storage/v1/object/') === 0) ? u : '';
  }
  function kvBlockOf(d) {                             // 받은 값을 그대로 믿지 않는다: 모양을 확인하고 길이를 묶는다(이름 12 · 설명 60 · 사유 40 · 안내 60자)
    var v = d && d.voice;
    if (!v || typeof v !== 'object' || v.v !== 1 || !Array.isArray(v.list)) return null;
    var list = [], seen = {};
    v.list.slice(0, KV_MAX_ROWS).forEach(function (r) {
      if (!r || typeof r.k !== 'string' || !/^[a-z0-9_]{1,24}$/.test(r.k) || seen[r.k]) return;
      seen[r.k] = 1;
      list.push({ k: r.k, name: kvText(r.name || r.k, 12), desc: kvText(r.desc, 60), ok: r.ok !== false, why: kvText(r.why, 40), sample: kvSampleUrl(r.sample),
        kind: (r.kind === 'fast' || r.kind === 'slow') ? r.kind : '', self: r.tag === 'self' });   // O-0490: kind = 빠름/느림(없으면 '' → 중립 모양) · tag 'self' = 본인 목소리(무대 화면이 쓴다)
        // O-0469: 설명은 PC 가 준 대로(PC 상한 30자 — 앱에서 또 자르지 않게 넉넉히) · 견본 주소
    });
    if (!list.length) return null;
    var chosen = (typeof v.chosen === 'string' && seen[v.chosen]) ? v.chosen : list[0].k;
    return { chosen: chosen, list: list, scope: kvText(v.scope, 60), limit: kvText(v.limit, 60), note: kvText(v.note, 60),
      say: kvText(v.sample_text, 40), ai: kvText(v.ai, 30),   // O-0490: 예시가 읽는 문장 · (PC 가 줄 때만) 「AI 음성」 표시 글
      fb: Math.max(0, Math.min(999, parseInt(v.fb, 10) || 0)), wait: Math.max(0, Math.min(KV_WAIT_MAX_S, parseInt(v.wait, 10) || 0)) };
  }
  function kvCacheGet() { try { return kvBlockOf({ voice: JSON.parse(localStorage.getItem(KV_CACHE_KEY) || 'null') }); } catch (e) { return null; } }
  function kvCacheSet(raw) { try { if (raw) localStorage.setItem(KV_CACHE_KEY, JSON.stringify(raw)); else localStorage.removeItem(KV_CACHE_KEY); } catch (e) {} }
  // 지금 그릴 목록: { blk, down } 또는 null(새 줄 없음). 상태를 한 번이라도 받았으면 그 값이 기준이고, 아직 못 받았으면 지난번에 받아 둔 것을 먼저 그린다.
  function kvCurrent() {
    if (!getSyncPass() || kStatMissing) return null;
    if (kStatData) {
      var b = kvBlockOf(kStatData);
      if (b && kvHold) {                              // 방금 바꾼 값 믿기(위 설명)
        if (Date.now() >= kvHold.until || !kvRow(b, kvHold.key)) kvHold = null;   // 시간이 지났다(상태가 따라온 것은 refreshKStat 이 받은 값으로 가린다)
        else {
          if (b.chosen !== kvHold.key) { b.chosen = kvHold.key; kStatData.voice.chosen = kvHold.key; }
          if (b.scope !== kvHold.scope) { b.scope = kvHold.scope; kStatData.voice.scope = kvHold.scope; }   // O-0490: 안내 한 줄도 고른 목소리의 것으로(위 설명)
          if (kvHold.wait != null && b.wait !== kvHold.wait) { b.wait = kvHold.wait; kStatData.voice.wait = kvHold.wait; }
        }
      }
      kvCacheSet(b ? kStatData.voice : null);         // 칸이 사라졌으면(기능 꺼짐·옛 PC) 받아 둔 것도 지운다
      return b ? { blk: b, down: kStatState === 'down' } : null;
    }
    var c = kvCacheGet();
    return c ? { blk: c, down: false } : null;
  }
  function kvRow(blk, k) { for (var i = 0; i < blk.list.length; i++) if (blk.list[i].k === k) return blk.list[i]; return null; }
  function kvPvStop() {
    kvPvSeq++;
    try { if (kvPvAudio) { kvPvAudio.pause(); kvPvAudio.removeAttribute('src'); } } catch (e) {}
    var was = kvPvKey; kvPvKey = '';
    return !!was;
  }
  /* 설정 화면이 열려 있을 때 견본을 미리 받아 둔다(줄마다 수십 KB · 한 번만) → 누르는 순간 바로 난다. 못 받아도 누를 때 주소로 다시 시도한다. */
  function kvPvWarm(blk) {
    if (KV_WARM !== 'all') { kvWarmGo(blk); return; }      // O-0490: 보일 때만 · 두 개씩(아래 「O-0490」 블록). 'all' 이면 아래 v9.10 그대로
    if (!window.fetch || !window.URL || !URL.createObjectURL) return;
    blk.list.forEach(function (r) {
      var u = r.sample; if (!u || kvPvBlob[u]) return;
      kvPvBlob[u] = 'x';
      fetch(u).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
        .then(function (b) { kvPvBlob[u] = (b && b.size > 300 && /^audio\//.test(b.type || '')) ? URL.createObjectURL(b) : 'f'; })
        .catch(function () { kvPvBlob[u] = 'f'; });
    });
  }
  /* 줄을 눌렀다: 고르기 + 견본. 읽는 중인 줄을 다시 누르면 멈춘다(고른 값은 그대로 · 묻지 않는다). */
  function kvTap(key) {
    var cur = kvCurrent(), row = cur ? kvRow(cur.blk, key) : null; if (!row) return;
    if (kvPvKey === key) { kvPvStop(); renderKVoices(); return; }
    var st = kvPick(key);                              // 고르기는 예전 그대로(이미 고른 줄이면 아무 일도 없다)
    if (!row.sample) {                                 // 견본이 아직 없다 — 줄에 「견본 준비 중」이 적혀 있다. 아무 반응이 없어 보이지 않게, 고르기도 일어나지 않은 누름에는 한마디
      if (kvPvStop()) renderKVoices();
      if (st === 'same' && !kvStageOn()) toast(tw('이 목소리의 예시는 준비 중입니다.'), 2200);   // O-0490: 무대 화면에서는 케이 카드가 알린다
      return;
    }
    recSoundGuard(function () { kvPvPlay(key, row.sample); });   // v9.8: 회의 녹음 중에는 한 번 확인(고르기는 소리가 없어 그대로 된다)
  }
  function kvPvPlay(key, url) {
    if (window.KChar && KChar.voice.speaking()) KChar.voice.stop();
    kvPvStop();                                        // 앞 줄의 견본은 멈춘다(겹치지 않게)
    try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {}
    if (kvPvBad === key) kvPvBad = '';
    var my = ++kvPvSeq;
    function end(fail) {
      if (my !== kvPvSeq) return;                      // 멈췄거나 다른 줄로 넘어간 뒤에 온 알림
      kvPvSeq++; kvPvKey = '';
      if (fail) { kvPvBad = key; if (!kvStageOn()) toast(tw('예시만 못\u00a0받았습니다. 고르기는 됩니다.'), 3000); }   // O-0490: 무대 화면에서는 안내 한 줄 자리에 적는다
      if (isOpen($('kWardrobeView'))) renderKVoices();
    }
    try {
      if (!kvPvAudio) { kvPvAudio = new Audio(); kvPvAudio.preload = 'auto'; }
      kvPvAudio.onended = function () { end(false); };
      kvPvAudio.onerror = function () { end(true); };
      var got = kvPvBlob[url];
      kvPvAudio.src = (typeof got === 'string' && got.indexOf('blob:') === 0) ? got : url; kvPvKey = key;
      var p = kvPvAudio.play();
      if (p && p.then) p.catch(function () { end(true); });
    } catch (e) { kvPvKey = key; end(true); return; }
    renderKVoices();
  }
  function kvDone(ok, why, res) {                     // ok: true=바뀜 · false=못 바꿈 · null=2분이 지나도 답이 없음
    var p = kvPending; if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    kvPending = null;
    var cur = kvCurrent(), row = cur ? kvRow(cur.blk, p.key) : null, nm = row ? row.name : '';
    if (ok === true) {
      var nb = res && res.voice ? kvBlockOf({ voice: res.voice }) : null;
      if (kStatData) {                                // PC 가 결과에 실어 준 최신 목록으로 바꾼다(없으면 고른 값만 옮긴다)
        if (nb) kStatData.voice = res.voice;
        else if (kStatData.voice) kStatData.voice.chosen = p.key;
      } else if (nb) kvCacheSet(res.voice);
      var nbOk = !!nb && nb.chosen === p.key;          // 결과에 실린 목록이 방금 고른 목소리의 것일 때만 그 scope·wait 를 믿는다
      kvHold = { key: p.key, until: Date.now() + KV_HOLD_MS,   // 곧 읽을 상태 알림이 옛 값을 주더라도 이 값을 보인다
        scope: (nbOk && typeof res.voice.scope === 'string') ? nb.scope : '', wait: (nbOk && res.voice.wait != null) ? nb.wait : null };
      kvJust = p.key; setTimeout(function () { if (kvJust === p.key) kvJust = ''; }, 600);
      // O-0469: 「여자1(으)로」가 되지 않게 조사를 피한다. 「다음에 읽을 때부터 이 목소리」는 브리핑 전용 줄에서는 사실이 아니라 뺐다(어디서 나오는지는 그 줄 설명과 바로 아래 안내가 말한다)
      if ((!kvNext || kvNext === p.key) && !kvStageOn()) toast(tw('「' + nm + '」 목소리로 바꿨습니다.'), 2600);   // O-0490: 무대 화면에서는 「지금 목소리」 자리에 「바꿨습니다 ✓」
    } else if (ok === false) {
      var whyTx = why ? kvText(why, 40) : '다시 눌러\u00a0주십시오.';      // PC 가 사유를 주면 그 글(40자까지)
      toast(tw('바꾸지 못했습니다. ' + whyTx), 2800);
    } else {
      toast('아직 바뀌지 않았습니다. 잠시 뒤 설정을 다시 열어 확인해 주세요.', 3200);
    }
    var nx = kvNext; kvNext = '';                     // O-0469: 바꾸는 중에 누른 줄이 있으면 이어서 그 줄로
    if (nx && ok !== null) { var c2 = kvCurrent(); if (c2 && kvRow(c2.blk, nx) && nx !== c2.blk.chosen) kvPick(nx); }
    if (isOpen($('kWardrobeView'))) renderKVoices();
    if (!kvPending) refreshKStat(true);               // 화면을 PC 의 실제 값과 다시 맞춘다
  }
  function kvPoll() {
    var p = kvPending; if (!p) return;
    var el = Date.now() - p.t0;
    if (el > 120000) { kvDone(null); return; }
    if (el > 8000 && !p.slow) {                       // 응답기는 한 번에 한 건 — 케이가 답을 쓰는 중이면 그 뒤에 바뀐다
      p.slow = true;
      p.note = kStatState === 'busy' ? '케이가 답을 쓰는 중이라, 끝나면 바뀝니다' : '바꾸는 중… 조금 더 걸리고 있습니다';
      if (isOpen($('kWardrobeView'))) renderKVoices();
    }
    OfficeBridge.poll(p.id, p.tok).then(function (res) {
      if (kvPending !== p) return;
      if (res && res.status && res.status !== 'pending' && res.status !== 'processing') {
        var vs = res.summary_json && res.summary_json.voice_set;
        if (vs && vs.ok === true) kvDone(true, '', vs); else kvDone(false, vs && vs.why);
      } else p.timer = setTimeout(kvPoll, 700);
    }).catch(function () { if (kvPending === p) p.timer = setTimeout(kvPoll, 1200); });
  }
  /* 돌려주는 값(O-0469 · kvTap 이 쓴다): 'sent' 청함 · 'next' 앞의 바꾸기 뒤에 이어서 · 'same' 이미 이 목소리 · 'busy'·'down'·'' 못 함 */
  function kvPick(key) {
    var cur = kvCurrent(); if (!cur) return '';
    var row = kvRow(cur.blk, key); if (!row) return '';
    if (kvPending) {
      if (!KV_PICK_FOLLOW) { toast('앞의 바꾸기가 끝난 뒤에 눌러 주세요.'); return 'busy'; }
      kvNext = (key === kvPending.key) ? '' : key;    // 마지막에 누른 줄로 따라간다(바꾸는 중인 그 줄을 다시 누르면 이어서 바꿀 것을 지운다)
      renderKVoices(); return 'next';
    }
    if (key === cur.blk.chosen) return 'same';        // 이미 이 목소리
    if (cur.down) { toast(tw('PC가 꺼져 있습니다. 켜지면 눌러\u00a0주십시오.'), 2800); return 'down'; }
    if (!window.OfficeBridge || !OfficeBridge.requestVoiceSet) return '';
    var p = kvPending = { key: key, id: OfficeBridge.uuid(), tok: OfficeBridge.token(), t0: Date.now(), note: '바꾸는 중…', timer: null, slow: false };
    renderKVoices();
    OfficeBridge.requestVoiceSet(p.id, p.tok, key).then(function () { if (kvPending === p) kvPoll(); })
      .catch(function (e) { if (kvPending === p) kvDone(false, e && e.friendly ? e.friendly : ''); });
    return 'sent';
  }
  /* O-0469: 줄이 많아지면 이름 앞 낱말(「여자」「남자」…)로 묶어 작은 머리글을 단다 — PC 가 묶음 칸을 주지 않아도 된다.
   *   모든 줄이 「낱말+번호」 모양이고 낱말이 두 가지 이상일 때만(그 밖에는 머리글 없이 받은 순서 그대로). */
  function kvGroups(list) {
    var order = [], by = {}, ok = true;
    list.forEach(function (r) {
      var m = /^(.*?)[\s]*\d+$/.exec(r.name), g = m ? m[1].trim() : '';
      if (!g) ok = false;
      if (!by[g]) { by[g] = []; order.push(g); }
      by[g].push(r);
    });
    if (!ok || order.length < 2) return [{ name: '', rows: list }];
    return order.map(function (g) { return { name: g, rows: by[g] }; });
  }
  function renderKVoices() {
    var box = $('kwVoices'); if (!box || !window.KChar) return;
    if (KV_UI === 'stage') { kvStageRow(box); return; }   // O-0490: 「설정」에는 한 줄만 — 줄 목록(아래)은 KV_UI='list' 일 때 쓴다
    var V = KChar.voice, pref = KV_DEVICE ? V.pref() : '', vs = KV_DEVICE ? V.list() : [];   // O-0490: 기기 음성을 뺐으면 그 줄들을 그리지 않는다
    var act = KV_DEVICE ? V.active() : null;          // 고른 기기 음성이 지금 없으면 기본으로 표시
    var cur = kvCurrent(), hd = $('kwVoiceHd'), hs = $('kwVoiceSub');
    if (hd) hd.textContent = cur ? '케이 목소리' : '목소리';
    if (hs) hs.textContent = cur ? '모든 기기에 함께 적용' : (KV_DEVICE ? '무료 음성만 씁니다' : '');
    box.classList.toggle('kv', !!cur);
    box.classList.toggle('calm', !!(KChar.motionOn && !KChar.motionOn()));   // 「케이 얼굴 움직이기」를 끄셨으면 돌거나 튀지 않게(CSS .calm)
    if (cur) {
      var blk = cur.blk, out = [], phone = isNativeApp();   // 폰 앱이면 「이 폰」, PC판·브라우저면 「이 기기」
      var anySample = blk.list.some(function (r) { return !!r.sample; });
      var pendKey = kvNext || (kvPending ? kvPending.key : '');   // 동그라미가 도는 줄 = 마지막에 누른 줄
      if (anySample) out.push('<div class="kw-vnote kv-how">목소리를 누르면 그 목소리로 인사말을 들려 드리고, 그 목소리로 바꿉니다.</div>');
      kvGroups(blk.list).forEach(function (grp) {
        if (grp.name) out.push('<div class="kw-vgrp">' + esc(grp.name) + '</div>');
        grp.rows.forEach(function (r) {
          var on = r.k === blk.chosen, pend = pendKey === r.k, pv = kvPvKey === r.k;
          var sub = pend ? ((kvPending && kvPending.key === r.k) ? kvPending.note : '바꾸는 중…')
            : (r.ok ? r.desc : (on ? '지금은 쓸 수 없습니다 — ' + (r.why || '잠시 쉬는 중입니다') : (r.why || '지금은 쓸 수 없습니다')));
          // 견본 상태 한 줄: 없으면 「견본 준비 중」, 받아 오지 못했으면 사실대로(조용히 아무 소리도 안 나는 줄이 없게)
          var stl = kvPvBad === r.k ? '<small class="kv-st warn">예시 소리를 받아 오지 못했습니다. 잠시 뒤 다시 눌러 주십시오.</small>'
            : (!r.sample ? '<small class="kv-st">예시 준비 중</small>' : '');
          out.push('<div class="kw-voice kv-row' + (on ? ' on' : '') + (pend ? ' pend' : '') + (pv ? ' pv' : '') + (!pend && (cur.down || (!r.ok && !on)) ? ' dim' : '') + (kvJust === r.k ? ' just' : '') +   // 고르신 줄은 못 쓸 때도 흐리게 하지 않는다(사유 글이 읽혀야 한다) — PC 가 꺼졌을 때만 모두 흐리게
            '" role="button" tabindex="0" aria-pressed="' + (on ? 'true' : 'false') + '" data-kvoice="' + esc(r.k) + '"' +
            (pv ? ' aria-label="' + esc(r.name) + ' · 예시를 들려 드리는 중 · 누르면 멈춥니다"' : '') + '>' +
            '<span class="rd"></span><span class="tx"><b>' + esc(r.name) + '</b><small' + ((!r.ok && on && !pend) ? ' class="warn"' : '') + '>' + esc(sub) + '</small>' + stl + '</span>' +
            (r.sample ? '<span class="kv-ic" aria-hidden="true"><svg><use href="#' + (pv ? 'i-stop' : 'i-sound') + '"/></svg></span>' : '') +
            '</div>');
          // 고르신 줄 바로 아래: 그 목소리가 어디서 나오는지(PC 가 실제 설정대로 적어 보낸 한 줄) — 브리핑 전용 줄을 골랐을 때 [듣기]·대화는 다른 목소리라는 것이 그 자리에서 읽히게
          if (on && blk.scope) out.push('<div class="kw-vnote kv-here">' + esc(blk.scope) + '</div>');
        });
      });
      kvPvWarm(blk);
      if (cur.down) out.push('<div class="kw-vnote warn">PC가 꺼져 있어 지금은 바꿀 수 없습니다. PC가 켜지면 바꿀 수 있습니다.</div>');
      if (blk.limit || blk.note) out.push('<div class="kw-vnote">' + (blk.limit ? '<span>' + esc(blk.limit) + '</span>' : '') + (blk.note ? '<span>' + esc(blk.note) + '</span>' : '') + '</div>');
      // 기기 음성을 켜 둔 기기에서는 위 안내가 반만 맞다: [듣기]를 누르면 브리핑까지 그 음성으로 바로 읽는다(onListenBtn 의 기존 동작) → 사실 한 줄
      if (act) out.push('<div class="kw-vnote">' + (phone ? '「이 폰이 직접 읽기」를 켜 두셔서 이 폰의 [듣기]는 브리핑도 그 음성으로 읽습니다.' : '「이 기기가 직접 읽기」를 켜 두셔서 이 기기의 [듣기]는 브리핑도 그 음성으로 읽습니다.') + '</div>');
      if (blk.fb > 0) out.push('<div class="kw-vnote">오늘 다른 목소리로 대신 읽은 것 ' + blk.fb + '번</div>');
      if (vs.length) {                                 // 기기 음성이 있을 때만 보이는 따로 묶음(예전 저장값·동작 그대로)
        out.push('<div class="kw-vsub"><b>' + (phone ? '이 폰이 직접 읽기' : '이 기기가 직접 읽기') + '</b><small>글 채팅 [듣기]에서만 · 다시 누르면 꺼집니다</small></div>');
        vs.forEach(function (v) {
          var on = act && act.name === v.name;
          out.push('<div class="kw-voice' + (on ? ' on' : '') + '" role="button" tabindex="0" aria-pressed="' + (on ? 'true' : 'false') + '" data-voice="' + esc(v.name) + '">' +
            '<span class="rd"></span><span class="tx"><b>' + esc(v.name) + '</b><small>' + (on ? (phone ? '이 폰' : '이 기기') + '의 [듣기]는 이 음성으로 바로 읽습니다' :'이 기기 음성' + (V.isFemaleGuess(v) ? ' · 여성' : '') + ' · 바로 읽습니다') + '</small></span>' +
            '<button type="button" class="try" data-try="' + esc(v.name) + '">미리 듣기</button></div>');
        });
        if (pref && !act) out.push('<div class="kw-vnote">골라 두신 기기 음성(' + esc(pref) + ')을 찾지 못해 케이 목소리로 읽습니다.</div>');
      }
      box.innerHTML = out.join('');
      return;
    }
    // O-0469: 목록이 없을 때도 사실대로 — 연동 암호가 없으면 아래 한 줄이 말하고, 있으면 이 줄의 설명 자리에 적는다(줄을 더하지 않는다 → 「설정」 세 묶음이 한 화면에 들어오던 높이 그대로)
    // v9.10: 「불러오지 못했습니다」는 실제로 못 받아 왔을 때만. PC 가 목록 칸을 주지 않는 경우(스위치 꺼짐 · 옛 PC · 서버 함수 없음)는 고장이 아니므로 예전 글 그대로.
    //   가르는 법: 상태는 받았는데 voice 칸이 아예 없다 = PC 가 주지 않음 / voice 칸은 왔는데 쓸 수 없는 모양이다 · 읽기에 실패했다 = 못 받아 옴 / 아직 한 번도 못 읽었다 = 불러오는 중
    var noList = kvNoListText();                        // O-0490: 무대 방식의 한 줄도 같은 글을 쓴다(아래 「O-0490」 블록으로 옮김 — 글·가르는 법은 그대로)
    var rows = ['<button type="button" class="kw-voice' + (!act ? ' on' : '') + '" data-voice="">' +
      '<span class="rd"></span><span class="tx"><b>케이 기본 목소리</b><small>' + noList + '</small></span></button>'];
    vs.forEach(function (v) {
      var on = act && act.name === v.name;
      rows.push('<div class="kw-voice' + (on ? ' on' : '') + '" role="button" tabindex="0" data-voice="' + esc(v.name) + '">' +
        '<span class="rd"></span><span class="tx"><b>' + esc(v.name) + '</b><small>이 기기 음성' + (V.isFemaleGuess(v) ? ' · 여성' : '') + ' · 바로 읽습니다</small></span>' +
        '<button type="button" class="try" data-try="' + esc(v.name) + '">미리 듣기</button></div>');
    });
    if (!KV_DEVICE) { /* O-0490: 기기 음성을 뺐다 — 「내장 음성」 안내도 하지 않는다 */ }
    else if (!V.supported()) rows.push('<div class="kw-vnote">이 기기(앱)는 내장 음성을 지원하지 않아 케이 기본 목소리만 쓸 수 있습니다.</div>');
    else if (!vs.length) rows.push('<div class="kw-vnote">이 기기에 한국어 내장 음성이 없어 케이 기본 목소리만 쓸 수 있습니다.</div>');
    else if (pref && !act) rows.push('<div class="kw-vnote">골라 두신 기기 음성(' + esc(pref) + ')을 찾지 못해 기본 목소리로 읽습니다.</div>');
    if (!getSyncPass()) rows.push('<div class="kw-vnote">연동 암호가 없어 케이 목소리 설정을 PC에서 받아 오지 못했습니다.</div>');   // v9.7: 사실만(넣으면 받아 온다 · PC 에서 꺼 두었으면 그대로)
    box.innerHTML = rows.join('');
  }
  /* ==================== O-0490 케이 목소리 「케이 무대」 ====================
   * 꾸미기 「설정」의 케이 목소리 자리에는 한 줄(지금 목소리 ›)만 그리고, 누르면 무대 화면(js/k-voice-stage.js)이 열린다. 같은 일을 하는 길은 이 한 줄뿐이다.
   * 고르기 · 예시 소리 · 녹음 중 확인 · 연달아 누르기는 위의 예전 함수(kvTap · kvPick · kvPvPlay · recSoundGuard)를 그대로 쓴다 — 무대 화면은 그리기만 한다.
   * 무대 화면이 열려 있는 동안에도 꾸미기 화면은 그 밑에 열려 있다 → 「꾸미기가 열려 있으면 renderKVoices」로 걸어 둔 예전 갱신 길(PC 상태 30초 조회 · 바꾸기 결과 · 예시 끝남)이
   *   그대로 이 화면까지 온다(renderKVoices → kvStageRow → KVStage.paint). 다른 기기에서 목소리를 바꾸면 그 조회로 이 화면에도 반영된다. */
  function kvStageOn() { return KV_UI === 'stage' && !!window.KVStage && KVStage.isOpen(); }
  /* 목록이 없을 때 그 자리에 적는 글(v9.10 그대로): 「불러오지 못했습니다」는 실제로 못 받아 왔을 때만.
   *   상태는 받았는데 voice 칸이 아예 없다 = PC 가 주지 않음(스위치 꺼짐 · 옛 PC · 서버 함수 없음 · 연동 암호 없음) / 칸은 왔는데 쓸 수 없는 모양 · 읽기 실패 = 못 받아 옴 / 아직 한 번도 못 읽음 = 불러오는 중 */
  function kvNoListText() {
    var kvNone = !getSyncPass() || kStatMissing || (!!kStatData && (kStatData.voice === undefined || kStatData.voice === null));
    return kvNone ? 'PC에서 만들어 보냅니다' : ((kStatData || kStatErr) ? '목소리 목록을 불러오지 못했습니다' : '목소리 목록을 불러오는 중입니다');
  }
  /* 예시 소리 미리 받기(KV_WARM='open'): 목소리를 고르는 자리가 실제로 보일 때만, 두 개씩 차례로.
   *   v9.10 은 꾸미기를 여는 순간(옷만 갈아입으러 와도) 목록의 예시를 전부 한꺼번에 받았다(24개면 약 290KB · 24개 동시).
   *   받는 순서 = 지금 고른 목소리 → 같은 묶음(여자/남자) → 다른 묶음. 자리를 떠나면 새로 받기를 멈춘다(받던 것은 마저 받는다 · 다시 열면 남은 것부터).
   *   받아 둔 것은 kvPvBlob 에 남는다(앱을 켠 동안 주소마다 한 번). 아직 못 받은 번호를 누르면 예전처럼 그 주소로 바로 튼다. */
  var kvWarmQ = [], kvWarmBusy = 0, KV_WARM_AT_ONCE = 2;
  function kvGroupOf(name) { var m = /^(.*?)\s*\d+$/.exec(name || ''); return m ? m[1].trim() : ''; }
  function kvWarmWant() {
    if (KV_WARM !== 'open') return false;
    if (KV_UI === 'stage') return kvStageOn();
    return kwSetOpen();                                 // 목록 방식: 「설정」 탭이 보일 때
  }
  function kvWarmGo(blk) {
    if (!kvWarmWant() || !window.fetch || !window.URL || !URL.createObjectURL) return;
    var ch = kvRow(blk, blk.chosen), g = ch ? kvGroupOf(ch.name) : '', a = [], b = [], c = [];
    blk.list.forEach(function (r) {
      if (!r.sample || kvPvBlob[r.sample]) return;
      (r.k === blk.chosen ? a : (kvGroupOf(r.name) === g ? b : c)).push(r.sample);
    });
    kvWarmQ = a.concat(b, c);
    kvWarmPump();
  }
  function kvWarmPump() {
    while (kvWarmBusy < KV_WARM_AT_ONCE && kvWarmQ.length) {
      if (!kvWarmWant()) { kvWarmQ = []; return; }
      var u = kvWarmQ.shift();
      if (!kvPvBlob[u]) kvWarmOne(u);
    }
  }
  function kvWarmOne(u) {
    kvPvBlob[u] = 'x'; kvWarmBusy++;
    var done = function () { kvWarmBusy--; kvWarmPump(); };
    fetch(u).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
      .then(function (b) { kvPvBlob[u] = (b && b.size > 300 && /^audio\//.test(b.type || '')) ? URL.createObjectURL(b) : 'f'; })
      .catch(function () { kvPvBlob[u] = 'f'; }).then(done, done);
  }
  /* 「설정」의 한 줄: 「여자1 [빠름] ›」 — 누르면 무대 화면. 목록이 없으면(연동 암호 없음 · PC 가 주지 않음 · 못 받아 옴 · 불러오는 중) 그 사실을 적고, 눌러도 열리지 않는다. */
  var kvRowHtml = null;
  function kvStageRow(box) {
    var cur = kvCurrent(), hd = $('kwVoiceHd'), hs = $('kwVoiceSub'), html;
    if (hd) hd.textContent = '케이 목소리';
    if (hs) hs.textContent = cur ? '모든 기기에 함께 적용' : '';
    box.classList.remove('kv');
    box.classList.toggle('calm', !!(KChar.motionOn && !KChar.motionOn()));
    if (cur) {
      var blk = cur.blk, row = kvRow(blk, blk.chosen) || blk.list[0];
      var pendKey = kvNext || (kvPending ? kvPending.key : ''), pendRow = pendKey ? kvRow(blk, pendKey) : null;   // 확정 전에는 이름을 옮기지 않는다(바뀌었다 되돌아오는 일이 없게)
      var bad = !row.ok && !pendRow;
      var sub = pendRow ? (pendRow.name + ' 목소리로 바꾸는 중…') : (bad ? '지금은 쓸 수 없습니다 — ' + (row.why || '잠시 쉬는 중입니다') : '누르면 ' + blk.list.length + '개 목소리에서 고릅니다');
      html = '<button type="button" class="card toggle kv-open' + (pendRow ? ' pend' : '') + '" data-kvopen aria-label="케이 목소리 고르기 — 지금 ' + esc(row.name) + '">' +
        '<span><b><span class="kv-open-nm">' + esc(row.name) + '</span>' + KVStage.spdHtml(row.kind) + (row.self ? KVStage.ownHtml(true) : '') + '</b>' +
        '<small' + (bad ? ' class="warn"' : '') + '>' + esc(sub) + '</small></span><svg class="chev" aria-hidden="true"><use href="#i-chev-r"/></svg></button>';
      kvPvWarm(blk);
    } else {
      html = '<div class="card toggle kv-open none"><span><b>케이 기본 목소리</b><small>' + kvNoListText() + '</small></span></div>' +
        (!getSyncPass() ? '<div class="kw-vnote">연동 암호가 없어 케이 목소리 설정을 PC에서 받아 오지 못했습니다.</div>' : '');
    }
    if (html !== kvRowHtml || !box.firstChild) { box.innerHTML = html; kvRowHtml = html; }   // 같은 모습이면 다시 그리지 않는다(누르는 중인 단추가 바뀌지 않게)
    try { KVStage.paint(); } catch (e) {}
  }
  function kvStageState() {                              // 무대 화면이 그릴 때 읽는 값(그 화면은 이 값만 보고 그린다)
    var pendKey = kvNext || (kvPending ? kvPending.key : '');
    return { cur: kvCurrent(), pendKey: pendKey, pendNote: (kvPending && kvPending.key === pendKey) ? kvPending.note : '', pvKey: kvPvKey, pvBad: kvPvBad, just: kvJust };
  }
  if (KV_UI === 'stage' && window.KVStage) {
    KVStage.init({
      state: kvStageState,
      tap: function (k) { kvTap(k); },                   // 고르기 + 예시(녹음 중이면 한 번 확인 — recSoundGuard · 고르기는 소리가 없어 그대로 된다)
      stop: function () { kvPvStop(); },                 // 화면을 떠날 때 예시 소리 멈춤
      opened: function () { try { refreshKStat(false); } catch (e) {} var c = kvCurrent(); if (c) kvPvWarm(c.blk); },
      closed: function () { kvWarmQ = []; try { renderKVoices(); } catch (e) {} }
    });
    if ($('kwVoices')) $('kwVoices').addEventListener('click', function (ev) {
      var o = (ev.target && ev.target.closest) ? ev.target.closest('[data-kvopen]') : null;
      if (o) KVStage.open();
    });
  } else if (KV_UI === 'stage') KV_UI = 'list';           // 무대 파일이 없으면(읽기 실패) 줄 목록으로 — 목소리를 고를 길이 사라지지 않게
  /* ==================== O-0557 케이 패션쇼 ====================
   * 꾸미기 「옷」 탭의 옷장 머리줄 [▶ 패션쇼](이 한 곳) → js/k-fashion-show.js 의 한 장. 그 화면은 그리기만 하고, 여기서 넘겨주는 것은 셋뿐이다:
   *   목록 = 옷장과 같은 목록 · 순서 · 묶음 이름(kwSorted — 옷이 늘거나 빠지면 쇼도 함께) · 지금 옷 · 「이 옷 입기」 = kwWear(옷장 칸을 누를 때와 같은 함수).
   * 무엇을 보일지(패션쇼 영상 → 인사 영상 → 서 있는 그림)와 받기는 KChar.show(k-character.js).
   *   KFS_UI   'on' = 단추가 보인다 · 'off' = 단추가 없다(v9.18 과 같은 화면 — 쇼 화면은 만들어지지도 않는다)
   *   KFS_SEG  한 벌 길이(초) — 패션쇼 영상(라2: 걸어 나와 → 한 바퀴 → 포즈)이 8초라 8 */
  var KFS_UI = 'on', KFS_SEG = 8;
  var kfsOn = KFS_UI === 'on' && !!window.KFShow && !!window.KChar && !!KChar.show;
  if (kfsOn) {
    KFShow.init({
      seg: KFS_SEG,
      list: function () { return kwSorted(KChar.outfits()).list; },
      cur: function () { return KChar.outfit().id; },
      plan: function (id) { return KChar.show.plan(id); },
      ensure: function (id, o) { return KChar.show.ensure(id, o); },
      wear: function (id) { kwWear(id); }
    });
    if ($('kwShowBtn')) $('kwShowBtn').addEventListener('click', function () {
      try { if (kvPvStop()) renderKVoices(); } catch (e) {}       // 목소리 미리 듣기 · 전신 인사가 돌고 있으면 멈춘다(쇼는 소리가 없다)
      try { stopKFullBow(); } catch (e) {}
      KFShow.open();
    });
  }
  if (window.KChar) {
    KChar.voice.onVoices(function () { if (isOpen($('kWardrobeView'))) renderKVoices(); });
    KChar.onChange(function () { if (isOpen($('kWardrobeView'))) renderKWardrobe(); if (kfsOn) KFShow.refresh(); });   // v9.19: 쇼 도중 옷이 바뀌면(다른 기기) 「입는 중」 · 「이 옷 입기」를 바로 맞춘다
  }
  /* ---- (O-0487) 케이 옷 기기 간 맞추기 — 폰에서 갈아입히면 PC판(같은 코드)과 다른 기기의 케이도 같은 옷, 반대 방향도 같게 ----
   * 서버 한 줄(k_outfit_state)에 「지금 입은 옷」을 두고 폰·PC판이 함께 쓴다. PC 워커는 거치지 않는다(PC 가 꺼져도 맞춰진다).
   *  · 올리기: 이 기기에서 **직접** 갈아입힌 때만(KChar.onWear 의 src='user'). 다른 기기 것을 받아 입은 것(src='remote')은 올리지 않는다
   *      → 받은 옷이 「내가 고른 것」으로 되올라가 두 기기가 서로 뒤집는 일이 없다. 연달아 누르면 0.8초 모아 마지막 것만.
   *      올릴 것은 기기에 적어 둔다(OF_UP_KEY = {id, at 고른 때}) → 실패·오프라인이면 다음 조회 때 다시.
   *      보낼 때는 「고른 뒤 지난 시간」만 보낸다(시계의 차이라 기기 시계가 틀려도 맞다). 서버가 「서버 지금 − 지난 시간」으로 고른 때를 정한다.
   *  · 받기: 앱 시작 · 화면이 보이는 동안 30초마다 · 앱/창 복귀 즉시(v7.7 조회 옆에서 get_k_outfit 한 번) · 꾸미기를 열 때 · 통화·인사가 끝난 때.
   *  · 반영: 서버 값의 고른 때(changed_at)가 이 기기가 마지막으로 반영한 것보다 **늦을 때만**(늦게 온 옛 답이 방금 고른 옷을 되돌리지 못한다).
   *      이 기기에 아직 못 올린 것이 있으면 받지 않고 먼저 올린다 → 서버가 가려서(accepted · reason) 돌려준 옷으로 맞춘다.
   *      갈아입히는 길은 KChar.setOutfit(id, 'remote') 하나 — 서버 옷을 아직 못 받았으면 기존 받기 흐름(받는 중 표시 → 다 받으면 입힘)을 그대로 탄다.
   *  · 받지 못하면 지금 옷 그대로. 다시 해 보는 것은 서버 값이 바뀌지 않는 한 3회까지(1분 간격) — 앱을 다시 켜면 처음부터.
   *  · 이 앱 판·서버 목록 어디에도 없는 옷이면 지금 옷 그대로 두고 넘어간다(이 기기 옷을 되올리지 않는다).
   *  · 음성 통화 · 시작 인사 · 전신 인사가 도는 중에는 미뤘다가 끝난 때 바로 한 번 조회해 맞춘다.
   *  · 처음(서버 값이 비어 있음): OUTFIT_SYNC_SEED 에 따라 — 'phone' 이면 폰 앱만 지금 옷을 올린다(PC판은 기다린다).
   *      서버에 값이 이미 있으면 폰도 서버 값을 따른다(어느 기기에서든 직접 고른 것이므로).
   *  · 서버에 함수가 없으면(SQL 미적용 · 되돌림 = 404) 10분 쉬었다 다시 물어본다. 그동안은 예전처럼 기기 저장만 — 올릴 것도 비운다(묵혀 두지 않는다).
   *  · 옛 앱(v9.10 이하)은 올리지도 받지도 않는다 → 그 기기만 예전처럼.
   * 스위치: OUTFIT_SYNC 'on' | 'off'(끄면 v9.10 과 같다 — 서버를 부르지 않고 안내 글도 예전 그대로)
   *         OUTFIT_SYNC_SEED 'phone' | 'any' | 'none'(처음 값을 누가 올리나)    OUTFIT_SYNC_NOTE 'line' | 'quiet'(들어올 때 한 줄 안내) */
  var OUTFIT_SYNC = 'on';
  var OUTFIT_SYNC_SEED = 'phone';
  var OUTFIT_SYNC_NOTE = 'line';
  var OF_UP_KEY = 'smart_k_outfit_up';        // 아직 서버에 못 올린 것 {id, at}
  var OF_SEEN_KEY = 'smart_k_outfit_srv';     // 마지막으로 반영한(또는 넘어간) 서버 값 {at: 서버가 준 changed_at 그대로, id}
  var OF_RETRY_MS = 10 * 60 * 1000;           // 서버에 함수가 없을 때 쉬는 시간(읽음 기준의 READ_RETRY_MS 와 같은 뜻)
  var OF_TRY_GAP_MS = 60000, OF_TRY_MAX = 3;  // 받지 못한 옷: 1분 간격으로 3회까지
  var OF_NOTE_GAP_MS = 60000;                 // 들어올 때 한 줄 안내는 60초에 한 번만
  var OF_UP_MAX_MS = 30 * 24 * 3600 * 1000;   // 30일 넘게 못 올린 것은 버린다(서버도 30일까지만 본다)
  var ofLive = false, ofReady = false, ofSrvNull = false, ofSeeded = false;
  var ofMissAt = 0, ofFailAt = 0, ofPulling = false, ofPullAt = 0, ofPushing = false, ofPushT = 0;
  var ofWant = null, ofGhost = null, ofNoteAt = 0, ofWatchT = 0, ofWatchN = 0;
  function ofLs(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function ofLsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function ofUp() { var u = ofLs(OF_UP_KEY); return (u && typeof u.id === 'string' && typeof u.at === 'number') ? u : null; }
  function ofSeen() { var x = ofLs(OF_SEEN_KEY); return (x && typeof x.at === 'string') ? x : null; }
  function ofCan() { return OUTFIT_SYNC === 'on' && !!(window.KChar && KChar.onWear && window.OfficeBridge && OfficeBridge.getKOutfit && OfficeBridge.setKOutfit); }
  function ofOn() { return ofCan() && !!getSyncPass() && !readWithin(ofMissAt, OF_RETRY_MS); }
  function ofSyncLive() { return ofCan() && ofLive && !!getSyncPass(); }      // 지금 실제로 맞춰지고 있는가(안내 글이 이것을 본다)
  // 서버 시각 문자열을 깎지 않고 견준다: 초 아래 여섯 자리(마이크로초)까지. Date 는 밀리초까지만 알아서 나머지는 글자에서 읽는다.
  function ofTs(str) {
    var ms = (typeof str === 'string') ? Date.parse(str) : NaN; if (isNaN(ms)) return { ok: false, sec: 0, us: 0 };
    var m = /\.(\d+)/.exec(str), f = ((m ? m[1] : '') + '000000').slice(0, 6);
    return { ok: true, sec: Math.floor(ms / 1000), us: parseInt(f, 10) || 0 };
  }
  function ofCmp(a, b) { var x = ofTs(a), y = ofTs(b); return x.sec !== y.sec ? (x.sec > y.sec ? 1 : -1) : (x.us === y.us ? 0 : (x.us > y.us ? 1 : -1)); }
  function ofSetLive(v) { v = !!v; if (ofLive === v) return; ofLive = v; try { paintKwSyncNote(); } catch (e) {} }
  // 꾸미기 「옷」 탭 아래 안내 글 — 실제로 맞춰지고 있을 때만 한 마디를 붙인다(목소리 줄의 「모든 기기에 함께 적용」과 같은 말). 아니면 v9.10 글 그대로.
  function paintKwSyncNote() {
    var n = $('kwSyncNote'); if (!n) return;
    var t = ofSyncLive() ? tw('바꾸면 채팅·홈·프로필의 케이 사진도 함께 바뀝니다. 모든 기기에 함께 적용됩니다.') : '바꾸면 채팅·홈·프로필의 케이 사진도 함께 바뀝니다.';
    if (n.textContent !== t) n.textContent = t;
  }
  function ofStopWatch() { if (ofWatchT) { clearInterval(ofWatchT); ofWatchT = 0; } }
  function ofResolve(w) { ofLsSet(OF_SEEN_KEY, { at: w.at, id: w.id }); if (ofWant === w) ofWant = null; if (!ofWant) ofStopWatch(); }
  function ofMissed() {                               // 서버에 함수가 없다 → 예전 방식. 올릴 것 · 기다리던 것을 비운다
    ofMissAt = Date.now(); ofLsSet(OF_UP_KEY, null); ofWant = null; ofGhost = null; ofStopWatch();
    try { if (KChar.assets && KChar.assets.dropWant) KChar.assets.dropWant('remote'); } catch (e) {}
    ofSetLive(false);
  }
  function ofBusy() {                                 // 케이가 바뀌면 끊기는 때: 음성 통화 · 시작 인사 · 꾸미기 전신 인사
    try { if (convoOn) return true; } catch (e) {}
    try { if (window.KCall && KCall.active && KCall.active()) return true; } catch (e) {}
    try { if (window.KIntro && KIntro.active && KIntro.active()) return true; } catch (e) {}
    try { var fb = $('kwFull'); if (fb && fb.classList.contains('bowing') && isOpen($('kWardrobeView'))) return true; } catch (e) {}
    return false;
  }
  function ofWatch() {                                // 끝나기를 1초마다 본다(최대 30분) → 끝난 때 바로 한 번 조회
    if (ofWatchT) return;
    ofWatchN = 0;
    ofWatchT = setInterval(function () {
      if (!ofWant || ++ofWatchN > 1800) { ofStopWatch(); return; }
      if (ofBusy()) return;
      ofStopWatch();
      ofPullAt = 0;
      if (!ofPull()) ofTry();                         // 조회를 못 하는 때(쉬는 중 등)는 알고 있는 값으로
    }, 1000);
  }
  function ofPull() {
    if (!ofOn()) return false;
    if (ofPulling && readWithin(ofPullAt, 20000)) return true;
    if (!ofPulling && readWithin(ofPullAt, 2000)) return true;     // 복귀 · 화면 열기가 겹쳐도 한 번만
    ofPulling = true; ofPullAt = Date.now();
    OfficeBridge.getKOutfit(getSyncPass()).then(function (d) {
      ofPulling = false;
      if (!d || !('outfit' in d)) { ofTry(); return; }             // 답의 모양이 다르다(칸이 없다) → 이번에는 넘어간다. null(아직 아무도 안 올림)과는 다르다
      ofSetLive(true);
      ofTake(d.outfit);
      if (ofUp()) ofPushSoon(0);                                   // 올리지 못하고 남은 것이 있으면 이어서
    }).catch(function (e) {
      ofPulling = false;
      if (e && e.notready) ofMissed(); else ofTry();               // 끊김 · 서버 오류 · 암호 문제 → 알고 있는 값으로 이어 간다(다음 조회 때 다시 묻는다)
    });
    return true;
  }
  function ofTake(o) {                                // 서버가 알려 준 「지금 입은 옷」(아직 없으면 null)
    ofSrvNull = (o === null || o === undefined);
    if (ofSrvNull) { ofSeed(); return; }
    if (typeof o !== 'object' || typeof o.id !== 'string' || !/^[a-z0-9_]{1,48}$/i.test(o.id) || !ofTs(o.changed_at).ok) return;
    if (ofUp()) return;                               // 아직 못 올린 것이 있다 → 먼저 올리고, 서버가 가려 준 것을 받는다
    var seen = ofSeen();
    if (seen && ofCmp(o.changed_at, seen.at) <= 0) return;         // 이미 반영한 값이거나, 늦게 도착한 옛 답
    if (!ofWant || ofWant.at !== o.changed_at || ofWant.id !== o.id) ofWant = { id: o.id, at: o.changed_at, tries: 0, last: 0, told: false };
    ofTry();
  }
  function ofHas(id) { var o = null; try { KChar.outfits().forEach(function (x) { if (x.id === id) o = x; }); } catch (e) {} return o; }
  function ofTry() {
    var w = ofWant; if (!w || !ofReady || !ofCan() || ofUp()) return;
    var K = window.KChar, A = K.assets || {};
    if (K.outfit().id === w.id) { try { if (A.dropWant) A.dropWant('remote'); } catch (e) {} ofResolve(w); return; }   // 이미 그 옷
    var uw = A.wantInfo ? A.wantInfo() : null;
    if (uw && uw.src === 'user' && readWithin(uw.at, 60000)) return;   // 방금 이 기기에서 누른 서버 옷을 받는 중 → 그것이 입혀져 올라가면 서버가 가려 준다
    if (ofBusy()) { ofWatch(); return; }
    var o = ofHas(w.id);
    if (o && !o.pending) {                            // 이 기기에 있는 옷 → 바로
      try { ofGhost = (isOpen($('kWardrobeView')) && window.KMotion && KMotion.snap) ? KMotion.snap($('kwHero')) : null; } catch (e) { ofGhost = null; }
      if (K.setOutfit(w.id, 'remote') !== true) ofGhost = null;    // 갈아입으면 ofWear('remote') 가 마무리한다
      return;
    }
    if (w.tries >= OF_TRY_MAX || readWithin(w.last, OF_TRY_GAP_MS)) return;
    w.tries++; w.last = Date.now();
    if (o) {                                          // 서버 옷 · 아직 못 받음 → 기존 받기 흐름(다 받으면 KChar 가 스스로 입힌다)
      if (K.setOutfit(w.id, 'remote') === 'pending') ofWaitMark(w, true);
      return;
    }
    // 옷장 목록에 안 보이는 옷 → 서버 목록을 새로 보고 옷장 사진을 받는다(꾸미기를 열 때와 같은 길)
    var p = null; try { p = A.refresh ? A.refresh() : null; } catch (e) {}
    Promise.resolve(p).then(function () { return A.ensureThumbs ? A.ensureThumbs() : false; }).then(function () {
      if (ofWant !== w) return;
      if (ofHas(w.id)) { w.tries--; w.last = 0; ofTry(); return; }
      // 방금 새로 본 서버 목록에도, 이 앱에도 없는 옷(옛 판 · 빠진 옷) → 지금 옷 그대로 넘어간다
      if (A.state && A.state() === 'ok' && A.knows && !A.knows(w.id)) ofResolve(w);
    }, function () {});
  }
  function ofWaitMark(w, say) {                       // 받는 중 표시(꾸미기를 열어 두신 때만 — v9.10 붙은 판의 「받는 중…」과 같은 것)
    try {
      if (!isOpen($('kWardrobeView'))) return;
      if (window.KWFollow && KWFollow.wait) KWFollow.wait(w.id);
      if (say && !w.told) { w.told = true; toast(tw('다른 기기에서 고르신 옷을 받고 있습니다.'), 2600); }
    } catch (e) {}
  }
  function ofWardrobeOpened() {
    if (!ofCan()) return;
    ofPull();
    var uw = (ofWant && KChar.assets && KChar.assets.wantInfo) ? KChar.assets.wantInfo() : null;
    if (uw && uw.src === 'remote' && uw.id === ofWant.id) ofWaitMark(ofWant, false);
  }
  function ofArrive() {                               // 다른 기기에서 고른 옷으로 갈아입었다 → 보고 계신 화면이 홈 · 꾸미기일 때만 반짝임 + 한 줄
    var g = ofGhost; ofGhost = null;
    var inW = isOpen($('kWardrobeView')), inH = isOpen(homeView);
    if (document.hidden || !(inW || inH)) return;     // 채팅 · 건강 · 녹음 등 다른 화면에서는 조용히 바뀐다
    try { if (inW && window.KMotion && KMotion.outfitSwap) KMotion.outfitSwap($('kwHero'), g); } catch (e) {}
    try {                                             // 홈: 꾸미기에서 새 옷으로 돌아왔을 때와 같은 반짝임 한 번(움직임을 쉬는 때는 없음)
      var hh = (!inW && inH && window.KMotion && KMotion.shine && KMotion.sparkle && !(KMotion.calm && KMotion.calm())) ? $('kHero') : null;
      if (hh) { KMotion.shine(hh, hh.querySelector('.kh-side')); KMotion.sparkle(hh, KMotion.cnt ? KMotion.cnt(10) : 10); }
    } catch (e) {}
    if (OUTFIT_SYNC_NOTE !== 'line' || readWithin(ofNoteAt, OF_NOTE_GAP_MS)) return;
    ofNoteAt = Date.now();
    var nm = KChar.outfit().name;
    toast(tw('다른 기기에서 고르신 ' + nm + josaRo(nm) + ' 갈아입었습니다.'), 3200, true);
  }
  function ofWear(id, src, at) {                      // KChar 가 실제로 갈아입혔을 때
    if (!ofCan()) return;
    if (src === 'remote') {
      var w = ofWant; if (w && w.id === id) ofResolve(w);
      ofArrive();
      return;
    }
    ofWant = null; ofGhost = null; ofStopWatch();     // 이 기기에서 직접 고름 = 가장 나중 → 기다리던 것은 접는다
    if (!getSyncPass() || readWithin(ofMissAt, OF_RETRY_MS)) return;
    ofLsSet(OF_UP_KEY, { id: id, at: (typeof at === 'number' && at > 0) ? at : Date.now() });
    ofPushSoon(800, true);
  }
  function ofPushSoon(ms, reset) {
    if (reset && ofPushT) { clearTimeout(ofPushT); ofPushT = 0; }
    if (ofPushT || !ofUp() || !ofOn()) return;
    ofPushT = setTimeout(function () { ofPushT = 0; ofPush(); }, ms || 0);
  }
  function ofPush() {
    var up = ofUp(); if (!up || ofPushing || !ofOn()) return;
    if (!ofLive) { ofPull(); return; }                // 서버가 받아 주는지 아직 모른다 → 먼저 물어본다(답이 오면 이어서 올린다)
    if (readWithin(ofFailAt, 20000)) return;          // 방금 실패했으면 20초 쉼(다음 조회 때 다시)
    var age = Date.now() - up.at; if (!(age >= 0)) age = 0;        // 기기 시계가 뒤로 맞춰졌으면 「방금」으로
    if (age > OF_UP_MAX_MS) { ofLsSet(OF_UP_KEY, null); return; }
    ofPushing = true;
    OfficeBridge.setKOutfit(up.id, getSyncPass(), readNative() ? 'phone' : 'pc', Math.round(age)).then(function (d) {
      ofPushing = false;
      var now = ofUp(), same = !!(now && now.id === up.id && now.at === up.at);
      if (same) ofLsSet(OF_UP_KEY, null);
      if (!same) { ofPushSoon(0); return; }           // 그사이 또 바꾸셨다 → 그것을 이어서 올린다
      if (!d || !('outfit' in d)) return;
      var o = d.outfit, okO = !!(o && typeof o === 'object' && typeof o.id === 'string' && ofTs(o.changed_at).ok);
      if (d.accepted === true) { if (okO) ofLsSet(OF_SEEN_KEY, { at: o.changed_at, id: o.id }); return; }
      if (d.reason === 'bad_key') {                   // 서버가 이 옷 열쇠를 받지 않는다 → 이 기기 옷은 그대로 둔다(서버 옷으로 되돌리지 않는다)
        if (okO) ofLsSet(OF_SEEN_KEY, { at: o.changed_at, id: o.id });
        return;
      }
      ofTake(o);                                      // 'older' = 다른 기기가 더 나중에 고름 → 그 옷으로
    }).catch(function (e) {
      ofPushing = false;
      if (e && e.notready) ofMissed(); else ofFailAt = Date.now();   // 끊김 · 암호 문제 등 → 올릴 것은 그대로 두고 나중에 다시
    });
  }
  function ofSeed() {                                 // 서버에 아직 값이 없다 → 정해 둔 기기만 지금 옷을 올린다
    if (ofSeeded || !ofReady || ofUp()) return;
    if (OUTFIT_SYNC_SEED !== 'any' && !(OUTFIT_SYNC_SEED === 'phone' && readNative())) return;
    var id = ''; try { id = KChar.outfit().id; } catch (e) {}
    try {                                             // 골라 둔 옷이 서버 옷이라 아직 못 받아 기본 옷으로 보이는 중이면, 골라 둔 쪽을 올린다
      var sv = localStorage.getItem('smart_k_outfit') || '';
      if (sv && /^[a-z0-9_]{1,48}$/i.test(sv) && KChar.assets && KChar.assets.knows && KChar.assets.knows(sv)) id = sv;
    } catch (e) {}
    if (!id) return;
    ofSeeded = true;
    ofLsSet(OF_UP_KEY, { id: id, at: Date.now() });
    ofPushSoon(0);
  }
  function ofGo() { ofReady = true; if (ofSrvNull) ofSeed(); ofTry(); }   // 옷장(받아 둔 서버 옷 포함)을 다 읽은 뒤부터 반영한다
  if (ofCan()) {
    KChar.onWear(ofWear);
    try { (KChar.assetsReady || KChar.ready).then(ofGo, ofGo); } catch (e) { ofGo(); }
  }
  /* 옷장에서 옷 한 벌을 입는다 — 옷장 칸을 누를 때와 패션쇼 「이 옷 입기」(O-0557)가 함께 쓰는 하나의 길(옷 맞추기 O-0487 도 KChar.setOutfit 의 onWear 로 그대로 따라간다) */
  function kwWear(id) {
    if (!window.KChar || !id) return;
    var kmGhost = (window.KMotion && id !== KChar.outfit().id) ? KMotion.snap($('kwHero')) : null;   // v9.6(O-0387): 바꾸기 직전 모습을 한 장 떠 둔다(효과용 — 옷은 아래에서 즉시 바뀐다)
    var sr = KChar.setOutfit(id);
    if (sr === 'pending') { toast('옷을 받고 있습니다. 잠시만 기다려 주세요.'); return; }        // v9.5: 서버 옷 — 사진을 다 받으면 바로 갈아입는다
    if (sr) { renderKWardrobe(); if (isOpen(chatView)) renderChat(); toast(KChar.outfit().name + josaRo(KChar.outfit().name) + ' 갈아입었습니다.');
      if (window.KMotion) KMotion.outfitSwap($('kwHero'), kmGhost); }                                 // 옷은 이미 바뀌었고, 그 위에 반짝임만 얹는다(0.6초 안)
  }
  if ($('kWardrobeView')) $('kWardrobeView').addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t.closest || !window.KChar) return;
    var rq = t.closest('[data-kreq]');
    if (rq) { openKDecorRequest(rq.getAttribute('data-kreq')); return; }
    var it = t.closest('[data-outfit]');
    if (it) { kwWear(it.getAttribute('data-outfit')); return; }
    var tr = t.closest('[data-try]');
    if (tr) {
      var v = null, nm = tr.getAttribute('data-try');
      KChar.voice.list().forEach(function (x) { if (x.name === nm) v = x; });
      if (v && REC_ROAM_V2 && isRecording && !tr._recOk) {              // v9.8: 회의 녹음 중에는 한 번 확인(「그래도 듣기」면 같은 누름을 다시 보낸다)
        recSoundGuard(function () { tr._recOk = true; try { tr.click(); } finally { tr._recOk = false; } });
        return;
      }
      if (v) { if (kvPvStop()) renderKVoices(); KChar.voice.speak('대표님, 안녕하세요. 케이입니다. 이 목소리로 읽어 드리겠습니다.', v); }
      return;
    }
    var kv = t.closest('[data-kvoice]');               // v9.7: 케이 목소리 고르기(PC 에 요청 → 결과로 확정) · O-0469: 같은 누름에 그 목소리 견본
    if (kv) { kvTap(kv.getAttribute('data-kvoice')); return; }
    var vo = t.closest('[data-voice]');
    if (vo) {
      var vn = vo.getAttribute('data-voice');
      if (kvCurrent()) {                               // v9.7: 「직접 읽기」 묶음 — 고른 줄을 다시 누르면 꺼진다
        var ac = KChar.voice.active();
        if (ac && ac.name === vn) { KChar.voice.setPref(''); renderKVoices(); toast('껐습니다. [듣기]는 케이 목소리로 읽습니다.'); }
        else { KChar.voice.setPref(vn); renderKVoices(); toast('글 채팅 [듣기]는 이 기기 음성으로 읽어 드리겠습니다.'); }
        return;
      }
      KChar.voice.setPref(vn); renderKVoices(); toast(vn ? '이 기기 음성으로 읽어 드리겠습니다.' : '케이 기본 목소리로 읽어 드리겠습니다.');
    }
  });
  // v9.7: 줄이 단추가 아니라 div(role=button)라 키보드(PC판)에서도 Enter·Space 로 고를 수 있게
  if ($('kwVoices')) $('kwVoices').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var r = ev.target; if (!r || !r.classList || !r.classList.contains('kw-voice') || r.tagName === 'BUTTON') return;
    ev.preventDefault(); r.click();
  });
  if ($('kwMotion')) $('kwMotion').addEventListener('change', function () {
    if (!window.KChar) return;
    KChar.setMotionPref(this.checked);
    renderKWardrobe();
  });
  if (chatSend) chatSend.addEventListener('click', sendChatMsg);
  // 음성 대화 도구 연결
  if (chatMic) chatMic.addEventListener('click', toggleChatMic);
  if (chatCam) chatCam.addEventListener('click', function () {
    if (chatCamInput) chatCamInput.click();                  // 사진도 붙여두고 계속 입력 가능
  });
  if (chatCamInput) chatCamInput.addEventListener('change', function () {
    if (this.files && this.files.length) onChatCamPicked(this.files);
    this.value = '';
  });
  // v5.8: 「오퍼스 5.5」 1회 지정 칩
  if (chatOpusToggle) chatOpusToggle.addEventListener('click', function () {
    setOpusNext(!opusNext);
    if (opusNext) toast('다음에 보내는 1건을 오퍼스 5.5로 처리합니다(보내면 자동으로 꺼집니다).');
  });
  // v5.8: 작업 현황 열기(채팅 헤더 · 홈 카드)
  if ($('chatOrdersBtn')) $('chatOrdersBtn').addEventListener('click', function () { openOrders(true); });
  if ($('btnOrders')) $('btnOrders').addEventListener('click', function () { openOrders(false); });
  if ($('ordersRefresh')) $('ordersRefresh').addEventListener('click', function () { refreshOrders(false); toast('새로 불러왔습니다.'); });
  // 음성 대화 모드(핸즈프리) 켜기/끄기
  if (chatConvoToggle) chatConvoToggle.addEventListener('click', function () {
    if (convoOn) stopConvo(false); else startConvo();
  });
  // 조합 중 미뤄둔 재렌더를 한 번에 반영(v4.5)
  function flushChatRender() {
    if (chatRenderDeferred) { chatRenderDeferred = false; if (isOpen(chatView)) renderChat(); }
  }
  /* ---- (v9.20) 쓰던 채팅 글 임시 보관 ----
   *  · 입력칸(#chatInput)의 글을 이 기기(localStorage 'smart_chat_draft')에만 0.6초 뒤 저장 · 앱을 껐다 켜도 3일 안이면 입력칸이 비어 있을 때 되살린다.
   *  · 보낼 때는 바로(동기) 지운다. 실패한 글은 보관을 되살리지 않는다(말풍선의 [다시 보내기]로 처리 — 같은 글이 두 곳에 생기지 않게).
   *  · 되살리기 전에 보낸 말과 대조해 같은 글이 보관 시각 이후에 이미 나갔으면 버린다. 채팅 입력칸만 대상(공유함 · 아이디어 · 암호 입력칸은 제외).
   *  · 한계: 폰의 네이티브 입력 바는 닫힐 때(또는 보낼 때)만 글이 웹 입력칸으로 넘어오므로, 바를 연 채 앱이 종료되면 그 글은 보관되지 않는다.
   *  · 스위치 DRAFT_KEEP='off' → 저장 · 복원 없음(부팅 때 남은 보관 글도 지운다). */
  var DRAFT_KEEP = 'on', DRAFT_KEY = 'smart_chat_draft', DRAFT_TTL_MS = 3 * 24 * 3600 * 1000, DRAFT_MAX = 20000, DRAFT_DEBOUNCE_MS = 600;
  var draftT = null;
  function draftDrop() { clearTimeout(draftT); draftT = null; try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function draftSaveNow() {
    clearTimeout(draftT); draftT = null;
    if (DRAFT_KEEP !== 'on' || !chatInput) return;
    var v = String(chatInput.value || '');
    try {
      if (!v.trim()) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: v.slice(0, DRAFT_MAX), at: Date.now() }));
    } catch (e) {}
  }
  function draftLater() { if (DRAFT_KEEP !== 'on') return; clearTimeout(draftT); draftT = setTimeout(draftSaveNow, DRAFT_DEBOUNCE_MS); }   // 타이머가 돌 때 입력칸의 「그때 값」을 읽는다(보낸 글을 낡은 값으로 다시 쓰지 않음)
  function draftRestore() {
    if (!chatInput) return;
    if (DRAFT_KEEP !== 'on') { draftDrop(); return; }
    var d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || typeof d.t !== 'string' || !d.t.trim() || !(d.at > 0)) { if (d) draftDrop(); return; }
    if (Date.now() - d.at > DRAFT_TTL_MS) { draftDrop(); return; }                          // 3일이 지남
    var same = chatMsgs.some(function (m) { return m && m.role === 'me' && String(m.text || '').trim() === d.t.trim() && (m.ts || 0) >= d.at; });
    if (same) { draftDrop(); return; }                                                       // 이미 보낸 글
    if (String(chatInput.value || '').trim()) return;                                       // 입력칸에 이미 글이 있으면 건드리지 않음(공유로 채워진 글 등)
    chatInput.value = d.t; autoGrowChat();
  }
  if (DRAFT_KEEP === 'on') {
    document.addEventListener('visibilitychange', function () { if (document.hidden) draftSaveNow(); });
    window.addEventListener('pagehide', draftSaveNow);
  }
  draftRestore();
  if (chatInput) {
    // v4.7: 조합 상태(chatComposing)는 '대화목록 재렌더를 잠깐 미루는' 용도로만 쓴다.
    //   입력창(textarea)의 표시·높이확장은 조합 중에도 절대 막지 않는다 → 미확정 마지막 글자가 항상 보인다.
    //   (입력 이벤트의 isComposing 을 조합 판정의 최종 기준으로 삼는다 — compositionstart 가 늦는 IME 대비)
    chatInput.addEventListener('input', function (e) {
      chatComposing = !!(e && e.isComposing);   // 목록 재렌더 보류 판단용(true여도 아래 autoGrow는 그대로 실행)
      autoGrowChat();                            // 조합 중에도 입력창 높이 확장 → 마지막 글자 잘림 없음
      draftLater();                              // (v9.20) 쓰던 글 임시 보관(0.6초 뒤)
      if (!chatComposing) flushChatRender();     // 조합이 끝난(또는 조합 아닌) 입력에서 미뤄둔 목록 렌더 반영
    });
    // 한글 조합 시작/끝 추적 → 조합 중에는 대화목록(chatLog) '재렌더만' 미룬다(입력창은 안 건드림)
    chatInput.addEventListener('compositionstart', function () { chatComposing = true; });
    chatInput.addEventListener('compositionend', function () { chatComposing = false; autoGrowChat(); flushChatRender(); });
    // 조합 도중 포커스가 빠지면 compositionend 가 안 오는 브라우저가 있어 안전하게 해제
    chatInput.addEventListener('blur', function () { chatComposing = false; flushChatRender(); });
    chatInput.addEventListener('keydown', function (e) {
      // 한글 조합 중(IME) Enter 는 "글자 확정"용이다. 이때 전송하면 마지막 음절이 잘리거나
      // 조기 전송돼 "글자가 하나씩 잘 안 들어가는" 현상이 난다 → 조합 중이면 무시(2026-09-22).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
    });
  }

  /* ---- 채팅 파일 첨부(대표님 → 케이, 상향) ---- */
  var CHAT_CHUNK_LIMIT = 45 * 1024 * 1024;   // 이보다 큰 파일은 청크 업로드(단일 50MB 한도 우회)
  function pushChatFileMsg(files, chunked, userText, opus, rt) {   // (O-0545) rt = 답장(입력 줄에서 보낼 때 첫 묶음만)
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    userText = (userText || '').trim();
    var upFiles = Array.prototype.map.call(files, function (f) {
      return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) };
    });
    var names = upFiles.map(function (f) { return f.name; });
    var note = (userText ? (userText + '\n\n') : '') + '[파일 첨부] ' + names.join(', ') + ' — 대표님이 이 파일을 보내셨습니다. 확인해 주세요.';
    var msg = { role: 'me', text: userText, ts: Date.now(), id: id, token: tok, answered: false, files: upFiles, up: true, uploading: true, opus: !!opus };
    if (rt) msg.rq = { id: rt.id, side: rt.side, snip: rt.snip, at: rt.at || 0 };
    chatMsgs.push(msg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var memo = { id: id, token: tok, thread: chatThread, title: names[0] || '파일', note: note };
    if (opus) memo.modelPref = 'opus';           // v5.8: 오퍼스 5.5 1회 지정
    if (rt) memo.replyTo = rt;                   // (O-0545)
    var work = chunked ? OfficeBridge.sendChatChunked(memo, files[0]) : OfficeBridge.sendChatBatch(memo, files);
    work.then(function () {
      msg.uploading = false; msg.srv = true; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile(); kickOrderPoll();      // v5.8
    }).catch(function (e) {
      msg.answered = true; msg.uploading = false; msg.nosrv = true;
      if (!chunked) keepAtt(msg, 'batch', files, memo, null);   // (v9.20) 다시 보내기용 보관(메모리만 · 큰 파일(조각 전송)은 제외)
      giveBackReply(rt);                          // (O-0545)
      errLog('파일', e);
      chatMsgs.push({ role: 'k', text: '죄송합니다, 보내신 파일이 저에게 전송되지 않았습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now(), fe: id });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    });
  }
  // 파일을 고르면 '바로 보내지 않고' 대기줄(pending)에 붙인다 → 대표님이 계속 글을 쓸 수 있고, 전송 때 함께 나감.
  function onChatFilesPicked(fileList) {
    var arr = keepSendable(fileList);             // v6.6: 한 파일 5GB까지(45MB 넘으면 40MB 조각 전송)
    var removed = arr.removed;
    if (!arr.length) return;
    var room = Math.max(0, 10 - chatPendingFiles.length);
    if (arr.length > room) { arr = arr.slice(0, room); toast('파일은 한 번에 최대 10개까지입니다.'); }
    if (!arr.length) return;
    chatPendingFiles = chatPendingFiles.concat(arr);
    renderPending();
    if (!removed) toast('파일을 붙였습니다. 글을 더 쓰거나 전송을 누르세요.');
  }
  if ($('chatAttach')) $('chatAttach').addEventListener('click', function () {
    openAttachMenu();                                        // (O-0176) 고르기 창: 케이에게 / 명함·사진 PC 정리 / 영상 정리
  });
  if ($('chatFileInput')) $('chatFileInput').addEventListener('change', function () {
    if (this.files && this.files.length) onChatFilesPicked(this.files);
    this.value = '';
  });
  // v7.1(2026-09-30): 폰 네이티브 입력 바(글 쓰는 중)의 ＋/카메라는 웹 파일칸을 대신 누를 수 없다
  //   (WebView 에 '사용자 동작'이 없어 파일 선택 창이 막힘). native-input.js 가 네이티브로 파일을 골라
  //   File 로 만든 뒤 이 입구로 넘긴다 → 웹에서 고른 것과 똑같이 첨부 대기줄에 붙는다.
  window.SmartAttach = {
    chat: onChatFilesPicked,
    chatCam: onChatCamPicked,
    locker: onLockerFilesPicked,
    toast: function (m, ms) { toast(m, ms); }
  };
  // 케이가 보낸 첨부(하향) 탭 → 열기/저장 (기존 문서 버튼과 동일한 window.open 방식)
  if (chatLog) chatLog.addEventListener('click', function (ev) {
    var lockb = ev.target.closest ? ev.target.closest('.chatlockbtn') : null;   // v9.4(O-0353): 연동 암호 안내 줄 → 기존 연동 암호 창
    if (lockb) { showSyncGate(true, '케이가 보낸 알림·보고를 보려면 PC 연동 암호를 입력해 주세요.'); return; }
    var more = ev.target.closest ? ev.target.closest('.chatmorebtn') : null;   // v7.0: [이전 대화 더 보기]
    if (more) { loadOlderChat(); return; }
    var fb = ev.target.closest ? ev.target.closest('.bfoldbtn') : null;   // O-0111: [전체 보기 ▼]/[접기 ▲]
    if (fb) { toggleChatFold(fb); return; }
    var kav = ev.target.closest ? ev.target.closest('img.kav') : null;   // v6.0: 말풍선 옆 케이 사진 → 프로필 카드
    if (kav) { openKProfile(); return; }
    // 링크 탭 → 외부로 열기(선택 복사와 별개)
    var ln = ev.target.closest ? ev.target.closest('a.chatlink,[data-link]') : null;
    if (ln) { ev.preventDefault(); var lu = ln.getAttribute('data-link') || ln.getAttribute('href'); var lw = window.open(lu, '_blank'); if (!lw) toast('링크를 열지 못했습니다.'); return; }
    if (ordDecideClick(ev)) return;                    // (O-0201 추가) 작업 카드 안 [승인]·[수정 요청]
    if (navChipClick(ev)) return;                      // (O-0217) 케이 답의 [길찾기] 칩 → 네이버 지도
    var oc = ev.target.closest ? ev.target.closest('.ordcard[data-ord]') : null;   // v5.8: 작업 카드 → 작업 현황(그 항목 강조)
    if (oc) { openOrders(true, oc.getAttribute('data-ord')); return; }
    var bq = ev.target.closest ? ev.target.closest('.bquote[data-qid]') : null;   // (O-0545) 인용 상자 → 원래 메시지로
    if (bq) { jumpToReply(bq.getAttribute('data-qid'), bq.getAttribute('data-qside')); return; }
    var rtb = ev.target.closest ? ev.target.closest('.msgretry[data-retry]') : null;   // (v9.20) 못 보낸 말 [다시 보내기]
    if (rtb) { ev.preventDefault(); resendClick(rtb.getAttribute('data-retry')); return; }
    // ⋯ 메뉴 → 복사·삭제 시트
    var mb = ev.target.closest ? ev.target.closest('.bmenu') : null;
    if (mb) { var bub = mb.closest('.bubble[data-uid]'); if (bub) openMsgActionSheet(bub.getAttribute('data-uid')); return; }
    var vp = ev.target.closest ? ev.target.closest('[data-lid]') : null;
    if (vp) { onListenBtn(vp.getAttribute('data-lid'), vp); return; }
    var dv = ev.target.closest ? ev.target.closest('[data-view-url]') : null;
    if (dv) {                                        // [뷰어로 보기] → 문서 뷰어로 표시
      openDocFromChat({ url: dv.getAttribute('data-view-url'), name: dv.getAttribute('data-view-name'), mime: dv.getAttribute('data-view-mime'), kind: 'document' });
      return;
    }
    var dl = ev.target.closest ? ev.target.closest('[data-dl-url]') : null;
    if (dl) { downloadAttachment(dl.getAttribute('data-dl-url'), dl.getAttribute('data-dl-name')); return; }   // [다운로드]
    var b = ev.target.closest ? ev.target.closest('[data-att-url]') : null;
    if (!b) return;
    openAttachmentChip(b.getAttribute('data-att-url'), b.getAttribute('data-att-name'));   // v7.9: 폰은 APK 등 = 네이티브 저장
  });

  /* ===================== 메시지 복사·삭제(⋯ 메뉴) · 전체 지우기 =====================
   * 원본은 localStorage(chatMsgs)다. 각 말풍선의 [⋯] → 시트에서 [복사]/[삭제].
   *  · 텍스트는 이제 드래그/길게눌러 「부분 선택 복사」가 되고(user-select:text),
   *    「전체 복사」는 [⋯]→[복사](클립보드). 길게누르기=삭제는 선택을 가로채서 폐지했다.
   *  · 전체: 헤더의 ⋮ → [대화 전체 삭제].
   *  · 폴링/새 메시지 수신은 그대로 — 삭제는 과거 이력만 지운다(케이 방송은 무덤으로 재출현 방지). */
  var sheetEl = $('chatSheet'), sheetTitle = $('chatSheetTitle'), sheetMsg = $('chatSheetMsg');
  var sheetConfirm = $('chatSheetConfirm'), sheetConfirmLabel = $('chatSheetConfirmLabel'), sheetCancel = $('chatSheetCancel');
  var sheetCopyBtn = $('chatSheetCopy');
  var sheetHintEl = $('chatSheetHint');  // 부분 복사 힌트(복사 가능한 메시지 시트에서만 표시)
  var sheetAction = null;               // 확인(삭제 등) 시 실행할 함수
  var sheetCopyVal = null;              // 이 시트의 [복사] 대상 텍스트(null이면 복사 버튼 숨김)
  var sheetExtraBtn = $('chatSheetExtra'), sheetExtraLabel = $('chatSheetExtraLabel');
  var sheetExtraAction = null;          // 보조 버튼(예: PC 연동) 실행 함수
  var sheetReplyBtn = $('chatSheetReply'), sheetReplyUid = null;   // (O-0545) ⋯ 시트 맨 위 「↩ 답장」

  // extra: { label, action } — 있으면 보조 버튼 하나 더 표시(선택)
  // opts(v9.8, 선택): { cancelLabel: 맨 아래 닫기 단추의 글(기본 '취소'), positive: 확인 단추를 빨간 휴지통 대신 평소 모양으로, icon: 그때의 그림 }
  function openSheet(title, msg, confirmLabel, action, copyText, extra, opts) {
    if (!sheetEl) return;
    if (sheetReplyBtn) sheetReplyBtn.style.display = 'none';   // (O-0545) 답장은 말풍선 ⋯ 시트에서만(openMsgActionSheet 가 다시 켠다)
    sheetReplyUid = null;
    if (sheetCancel) sheetCancel.textContent = (opts && opts.cancelLabel) || '취소';
    // v5.5: 확인 버튼 모양을 매번 기본(빨간 휴지통)으로 되돌린다 — 아이디어 [진행해줘] 시트가 잠시 긍정형(✓)으로 바꿔 쓰기 때문.
    if (sheetConfirm) { sheetConfirm.classList.add('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-trash'); }
    sheetTitle.textContent = title;
    sheetMsg.classList.remove('pck');   // v7.3: 「PC 케이에게 직접」 여러 줄 안내 모양은 그 시트에서만
    sheetMsg.textContent = msg || '';
    sheetMsg.style.display = msg ? 'block' : 'none';
    if (sheetConfirmLabel) sheetConfirmLabel.textContent = confirmLabel || '삭제';
    sheetAction = action || null;
    sheetCopyVal = (copyText != null && copyText !== '') ? copyText : null;
    if (sheetCopyBtn) sheetCopyBtn.style.display = sheetCopyVal ? 'flex' : 'none';
    if (sheetHintEl) sheetHintEl.style.display = sheetCopyVal ? 'block' : 'none';   // 복사 가능한 메시지 시트에서만 힌트
    if (sheetExtraBtn) {
      if (extra && extra.label) { if (sheetExtraLabel) sheetExtraLabel.textContent = extra.label; sheetExtraBtn.style.display = 'flex'; sheetExtraAction = extra.action || null; }
      else { sheetExtraBtn.style.display = 'none'; sheetExtraAction = null; }
    }
    if (opts && opts.positive && sheetConfirm) { sheetConfirm.classList.remove('danger'); var _pu = sheetConfirm.querySelector('use'); if (_pu) _pu.setAttribute('href', '#' + (opts.icon || 'i-check')); }
    // v9.10: 여러 줄 글(낱말 단위 줄바꿈 · 가운데) · 기본 단추 돋보이기 — 끊긴 녹음 창에서만 쓴다(안 주면 예전 모양 그대로)
    sheetMsg.classList.toggle('recmsg', !!(opts && opts.recmsg));
    if (sheetConfirm) sheetConfirm.classList.toggle('main', !!(opts && opts.main === 'confirm'));
    if (sheetExtraBtn) sheetExtraBtn.classList.toggle('main', !!(opts && opts.main === 'extra'));
    sheetEl.style.display = 'flex';
  }
  function closeSheet() { if (sheetEl) sheetEl.style.display = 'none'; sheetAction = null; sheetCopyVal = null; sheetExtraAction = null; sheetReplyUid = null; }
  if (sheetExtraBtn) sheetExtraBtn.addEventListener('click', function () { var a = sheetExtraAction; closeSheet(); if (a) a(); });
  function snippet(m) {
    var t = (m && m.text ? m.text : '').replace(/\s+/g, ' ').trim();
    if (!t) { if (m && m.files && m.files.length) return '(첨부 파일)'; if (m && m.vin) return '(음성 메시지)'; return '(내용 없음)'; }
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }
  // 말풍선 [⋯] → 복사·삭제 시트
  function openMsgActionSheet(uid) {
    var m = null;
    for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) { m = chatMsgs[i]; break; } }
    if (!m) return;
    // v8.3(O-0161): 케이 답(서버에 있는 것)이면 「⭐ 저장」/「☆ 저장 해제」를 함께 — 폰·PC 어디서나 같은 「저장한 답」
    var sid = (m.role === 'k') ? rowIdOf(m) : null, extra = null;
    if (sid && !/^k/.test(String(sid)) && String(sid).length >= 32) {
      var on = !!starIds[sid];
      extra = { label: on ? '☆ 저장 해제' : '⭐ 저장', action: function () { toggleStar(sid, !on); } };
    }
    openSheet('이 메시지', snippet(m), '삭제', function () { deleteMessage(uid); }, msgCopyText(m), extra);
    if (REPLY_UI && sheetReplyBtn && replyRowId(m)) { sheetReplyBtn.style.display = 'flex'; sheetReplyUid = uid; }   // (O-0545)
  }
  // v4.0: 한 메시지를 지우면 그 "대화 줄(turn) 전체"(질문+답)를 지우고, 서버에도 숨김 반영해 모든 기기서 사라지게.
  function rowIdOf(m) { return (m && (m.rid || m.id || m.cid || m.bid)) || null; }

  /* ===================== (O-0545) 답장 — 고른 메시지를 인용해서 이어 말하기 =====================
   * 요청(10/15, 지시대장 O-0545): 「케이가 메시지 보내고 나서 해당 메시지에 대해서 내가 이어서 말해도 연속성이 없더라고 …
   *   이전 메시지를 답변을 다는 방식으로 이전 메시지를 연계해서 메시지를 보낼 수 있게 해줘」
   *  · 말풍선 ⋯ → 시트 맨 위 「↩ 답장」 → 입력칸이 바로 열리고 그 위에 답장 띠(폰은 네이티브 입력 바 안 인용 줄).
   *  · 보내면 meta.reply_to = { id: 원 행 id, side: 'k'|'me', snip: 앱에 보인 첫 120자 } — PC 응답기(o0545_reply.py)가
   *    원 행을 읽어 「이번 말씀은 이 메시지에 대한 답」으로 케이에게 준다. 내 말풍선 맨 위에는 인용 상자(누르면 원래 메시지로 · 0.9초 반짝).
   *  · 답장은 입력 줄에서 직접 보낸 첫 한 건(글·사진·파일·음성 턴)에만 실리고 바로 지워진다.
   *    sendPlainChat() 안에서는 꺼내 쓰지 않는다(작업 카드 [승인]·[수정 요청]·꾸미기 추가 요청이 같은 함수를 쓴다).
   *  · 보내기에 실패하면 같은 인용을 띠로 되돌린다(다시 쓰시면 그대로 실린다). 음성 대화 중에는 3글자 이상인 첫 턴에만.
   *  · 다른 기기에서 보낸 답장은 PC 가 남긴 summary_json.reply_of 로 같은 인용 상자를 그린다.
   *  · 띠는 앱을 끄면 사라진다(저장하지 않음). 움직임 줄이기(KScene.calm · 폰 설정)면 움직임 없이.
   *  · 스위치 REPLY_UI=false → ⋯ 시트에 「답장」이 안 보인다(이미 받은 인용 상자는 그대로 그린다). */
  var REPLY_UI = true;
  /* (v9.20) 못 보낸 말풍선 [다시 보내기] — 'on' = 글(사진 · 작은 파일은 앱이 켜져 있는 동안) / 'text' = 글만(누르기 전 확인 시트) / 'off' = v9.19 와 같음.
   *  같은 id · token 으로만 다시 보낸다(서버 submit_memo 가 같은 id 를 'exists' 로 돌려줘 PC 에 두 번 들어가지 않음). 새 id 는 만들지 않는다.
   *  24시간이 지난 말 · 음성 말풍선은 단추를 보이지 않는다. 시간 제한은 다시 보낸 시각부터 새로 센다. */
  var RESEND_UI = 'on', RESEND_MAX_MS = 24 * 3600 * 1000, RESEND_ATT_MAX = 100 * 1024 * 1024;
  var MTG_COPY = 'on';                               // (v9.20) 회의록 상세 [복사] — 'off' 면 단추 없음(v9.19 와 같은 화면)
  var REPLY_TIP_KEY = 'smart_reply_tip_seen';        // 처음 한 번 「⋯에 답장이 생겼습니다」 안내
  var REPLY_SWIPE = true;                            // (O-0545 ②, v9.18) 말풍선을 왼쪽으로 밀어 답장 — false 면 ⋯ 시트만(v9.17 그대로). 아래 「밀어서 답장」
  var REPLY_SWIPE_TIP_KEY = 'smart_reply_swipe_tip_seen';
  var REPLY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var chatReply = null;                              // { id, side, snip, at } — 지금 입력 줄에 걸린 답장
  function replyCalm() {
    try {
      if (window.KScene && KScene.calm && KScene.calm()) return true;
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  // 답장할 수 있는 말풍선인가 → 서버 행 id(소문자) · 아니면 null(보내는 중·못 보낸 말·이 기기 안내 글)
  function replyRowId(m) {
    if (!m || m.role === 'typing' || m.uploading || m.nosrv) return null;
    var id = rowIdOf(m);
    if (!id || !REPLY_UUID_RE.test(String(id))) return null;
    if (m.role === 'me' && !(m.answered || m.sent || m.srv || m.cid)) return null;   // 서버에 올라간 것을 아직 모르는 말
    return String(id).toLowerCase();
  }
  function replySnip(m, n) {
    var t = (m && m.text ? String(m.text) : '').replace(/\s+/g, ' ').trim();
    if (!t && m && m.files && m.files.length) t = '(첨부: ' + m.files.slice(0, 3).map(function (f) { return f.name || '파일'; }).join(', ') + ')';
    if (!t && m && m.vin) t = '(음성 메시지)';
    n = n || 120;
    return t.length > n ? t.slice(0, n) + '…' : t;
  }
  function replyWhen(ts) {                          // 오늘이면 「13:55」, 아니면 「10/14 13:55」(한국 시각)
    if (!ts) return '';
    var d = new Date(ts + 9 * 3600000), n = new Date(Date.now() + 9 * 3600000);
    var hm = ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
    var same = d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
    return same ? hm : (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + hm;
  }
  function findReplyOrig(id, side) {
    var want = side === 'me' ? 'me' : 'k';
    for (var i = chatMsgs.length - 1; i >= 0; i--) {
      var x = chatMsgs[i];
      if (x.role === want && String(rowIdOf(x) || '').toLowerCase() === id) return x;
    }
    return null;
  }
  function quoteHtml(rq) {
    if (!rq || !rq.id) return '';
    var o = findReplyOrig(rq.id, rq.side);
    var gone = !o && isDeletedBid(rq.id);
    var at = (o && o.ts) || rq.at || 0;
    var t = gone ? '(지워진 메시지)' : (o ? replySnip(o, 140) : (rq.snip || '(이전 메시지)'));
    return '<span class="bquote" role="button" tabindex="0" data-qid="' + esc(rq.id) + '" data-qside="' + (rq.side === 'me' ? 'me' : 'k') + '">' +
      '<b>↩ ' + (rq.side === 'me' ? '내 메시지' : '케이') + (at ? ' · ' + esc(replyWhen(at)) : '') + '</b><span>' + esc(t) + '</span></span>';
  }
  function rqFromServer(ro) {                       // PC 가 남긴 summary_json.reply_of → 인용 상자 값(모양이 틀리면 null)
    if (!ro || typeof ro !== 'object') return null;
    var id = String(ro.id || '').toLowerCase(), side = ro.side === 'me' ? 'me' : (ro.side === 'k' ? 'k' : '');
    if (!REPLY_UUID_RE.test(id) || !side) return null;
    var at = ro.at ? Date.parse(ro.at) : 0;
    return { id: id, side: side, snip: String(ro.snip || '').slice(0, 140), at: isNaN(at) ? 0 : at };
  }
  function replyLabel(r) { return (r.side === 'me' ? '내 메시지에 답장' : '케이에게 답장') + (r.at ? ' · ' + replyWhen(r.at) : ''); }
  function showReplyBar() {
    var bar = $('chatReplyBar'); if (!bar) return;
    if (!chatReply) { hideReplyBar(false); return; }
    if ($('chatReplyLabel')) $('chatReplyLabel').textContent = replyLabel(chatReply);
    if ($('chatReplyText')) $('chatReplyText').textContent = chatReply.snip || '';
    bar.classList.remove('off');
    bar.style.display = '';
    replyPlace(); replyWatch(true);
    if (!replyCalm()) { bar.classList.remove('rb-in'); void bar.offsetWidth; bar.classList.add('rb-in'); }
    if (chatView) chatView.classList.add('has-reply');
  }
  function hideReplyBar(anim) {
    var bar = $('chatReplyBar'); if (!bar) return;
    if (chatView) chatView.classList.remove('has-reply');
    replyWatch(false);
    if (bar.style.display === 'none') return;
    if (anim && !replyCalm()) {
      bar.classList.remove('rb-in'); bar.classList.add('off');
      setTimeout(function () { if (!chatReply) { bar.classList.remove('off'); bar.style.display = 'none'; } else bar.classList.remove('off'); }, 130);
    } else { bar.classList.remove('rb-in', 'off'); bar.style.display = 'none'; }
  }
  // 띠는 입력 줄 바로 위에 붙는다(둘 다 sticky) — 입력 줄 높이가 바뀌면(글이 여러 줄) 띠 자리도 따라 올린다
  var replyRO = null;
  function replyPlace() {
    var bar = $('chatReplyBar'), cb = chatView && chatView.querySelector('.chatbar');
    if (!bar || !cb) return;
    var h = cb.offsetHeight;
    if (h > 0) bar.style.bottom = h + 'px';
  }
  function replyWatch(on) {
    var cb = chatView && chatView.querySelector('.chatbar');
    if (!cb || typeof ResizeObserver !== 'function') return;
    if (on && !replyRO) { replyRO = new ResizeObserver(function () { replyPlace(); }); replyRO.observe(cb); }
    else if (!on && replyRO) { try { replyRO.disconnect(); } catch (e) {} replyRO = null; }
  }
  function replyNativeSync() { try { if (window.SmartNativeInput && SmartNativeInput.quoteSync) SmartNativeInput.quoteSync(); } catch (e) {} }
  function startReply(uid) {
    var m = null;
    for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) { m = chatMsgs[i]; break; } }
    var id = replyRowId(m);
    if (!id) { toast(tw('이 메시지에는 답장할 수 없습니다.')); return; }
    chatReply = { id: id, side: m.role === 'me' ? 'me' : 'k', snip: replySnip(m, 120), at: m.ts || 0 };
    showReplyBar();
    // 입력칸을 바로 연다: 폰 = 네이티브 입력 바(인용 줄 포함), PC판 = 글칸에 커서. 음성 대화 전체 화면이면 띠만(다음 음성 턴에 실림).
    if (chatView && chatView.classList.contains('convo-full') && !chatView.classList.contains('convo-log')) return;
    var opened = false;
    try { if (window.SmartNativeInput && SmartNativeInput.open) opened = !!SmartNativeInput.open('chat'); } catch (e) { opened = false; }
    if (!opened && chatInput) { try { chatInput.focus(); } catch (e) {} }
  }
  function clearReply(anim) { chatReply = null; hideReplyBar(anim); replyNativeSync(); }
  function takeReply() {                            // 입력 줄 경로에서 보낼 때 한 번 — 실을 값을 돌려주고 띠를 내린다
    if (!chatReply) return null;
    var r = { id: chatReply.id, side: chatReply.side, snip: chatReply.snip, at: chatReply.at };
    chatReply = null; hideReplyBar(false); replyNativeSync();
    return r;
  }
  function takeReplyVoice(text) {                   // 음성 턴: 음성 대화(핸즈프리) 중엔 「음, 어」 같은 짧은 소리에 붙지 않게 3글자 이상일 때만
    if (!chatReply) return null;
    if (convoOn && text != null && String(text).replace(/\s+/g, '').length < 3) return null;
    return takeReply();
  }
  function giveBackReply(r) {                       // 보내기 실패 → 같은 인용을 띠로(그새 다른 것을 고르셨으면 그대로 둔다)
    if (!r || chatReply) return;
    chatReply = { id: r.id, side: r.side, snip: r.snip, at: r.at || 0 };
    showReplyBar(); replyNativeSync();
  }
  // 인용 상자·띠를 누르면 원래 메시지로(불러온 범위 밖이면 이전 대화를 최대 5쪽까지 불러 찾는다)
  function jumpToReply(id, side, tries) {
    if (!id) return;
    var o = findReplyOrig(id, side);
    if (o) {
      var el = chatLog && chatLog.querySelector('.bubble[data-uid="' + msgUid(o) + '"]');
      if (!el) { toast(tw(chatSearchOn ? '검색을 닫으면 그 메시지로 갈 수 있습니다.' : '그 메시지를 화면에서 찾지 못했습니다.')); return; }
      var calm = replyCalm();
      try { el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
      el.classList.remove('rq-flash', 'calm'); void el.offsetWidth;
      el.classList.add('rq-flash'); if (calm) el.classList.add('calm');
      setTimeout(function () { el.classList.remove('rq-flash', 'calm'); }, calm ? 1200 : 950);
      return;
    }
    if (isDeletedBid(id)) { toast(tw('지워진 메시지입니다.')); return; }
    tries = tries || 0;
    if (tries < 5 && chatHasMore && chatPageCanRun()) {
      if (!tries) toast(tw('이전 대화에서 찾는 중…'));
      loadOlderChat(function (ok) { if (ok) jumpToReply(id, side, tries + 1); else toast(tw('옛 대화라 찾지 못했습니다.')); });
      return;
    }
    toast(tw('옛 대화라 찾지 못했습니다.'));
  }
  // 처음 한 번만: ⋯ 에 답장이 생겼다는 안내. 아래 입력칸·답장 띠를 가리지 않게 화면 위쪽(머리줄 아래)에 작은 알림판으로 띄운다.
  //   누르면 닫히고, 6.5초 뒤 저절로 사라진다. 「봤다」 표시는 실제로 띄운 뒤에 남긴다(띄우기 전에 채팅을 닫으면 다음에 다시).
  //   (O-0545 ②) 밀어서 답장(REPLY_SWIPE)이 켜져 있으면 안내에 「말풍선을 왼쪽으로 밀어도 …」 한 줄을 더한다. ⋯ 안내를 이미 본 기기에는 그 한 줄만 한 번 더(따로 기억).
  function replyTipOnce() {
    if (!REPLY_UI) return;
    var seenMenu = false, seenSwipe = true;
    try {
      seenMenu = !!localStorage.getItem(REPLY_TIP_KEY);
      seenSwipe = !REPLY_SWIPE || !!localStorage.getItem(REPLY_SWIPE_TIP_KEY);
      if (seenMenu && seenSwipe) return;
      if (!chatMsgs.some(function (m) { return m.role === 'k' && replyRowId(m); })) return;
    } catch (e) { return; }
    setTimeout(function () {
      if (!isOpen(chatView) || !chatView || $('replyTip')) return;
      var el = document.createElement('div');
      el.id = 'replyTip'; el.className = 'replytip'; el.setAttribute('role', 'status');
      var lines = [];
      if (!seenMenu) lines.push(tw('말풍선 오른쪽 위 ⋯ 를 누르면 그 메시지에 답장할 수 있습니다.'));
      if (!seenSwipe) lines.push(tw('말풍선을 왼쪽으로 밀어도 답장할 수 있습니다.'));
      el.innerHTML = '<b>' + esc(tw(seenMenu ? '새 기능 · 밀어서 답장' : '새 기능 · 답장')) + '</b>' + lines.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
      chatView.appendChild(el);
      if (!replyCalm()) { void el.offsetWidth; el.classList.add('rt-in'); }
      try { localStorage.setItem(REPLY_TIP_KEY, '1'); if (REPLY_SWIPE) localStorage.setItem(REPLY_SWIPE_TIP_KEY, '1'); } catch (e) {}
      var gone = false;
      function hide() { if (gone) return; gone = true; if (el.parentNode) el.parentNode.removeChild(el); }
      el.addEventListener('click', hide);
      setTimeout(hide, 6500);
    }, 900);
  }
  if (sheetReplyBtn) sheetReplyBtn.addEventListener('click', function () { var u = sheetReplyUid; closeSheet(); if (u) startReply(u); });
  if ($('chatReplyBar')) $('chatReplyBar').addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('#chatReplyX')) return;
    if (chatReply) jumpToReply(chatReply.id, chatReply.side);
  });
  if ($('chatReplyBar')) $('chatReplyBar').addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && chatReply && ev.target === this) { ev.preventDefault(); jumpToReply(chatReply.id, chatReply.side); }
  });
  if ($('chatReplyX')) $('chatReplyX').addEventListener('click', function (ev) { ev.stopPropagation(); clearReply(true); });
  /* ===================== (O-0545 ②, v9.18) 밀어서 답장 — 말풍선을 왼쪽으로 밀면 답장(카카오톡처럼) =====================
   * 요청(10/16, 지시대장 O-0545): 「보통 카카오톡에서는 왼쪽으로 드래그 하면 자동으로 답변기능이 되던데 할 수 없나」
   *  · 말풍선이 손가락(PC판은 마우스)을 따라 왼쪽으로 조금 밀리고, 비는 자리에 ↩ 가 나타난다. 문턱(RS_TH)을 넘으면 ↩ 가 톡 커지며 짧은 진동,
   *    그 상태로 놓으면 ⋯ → 「↩ 답장」과 같은 startReply() 를 부른다(답장 길은 하나 — 띠 · 입력칸 열기 · 보내기 모두 같은 함수).
   *    문턱 전에 놓거나 되돌리면 아무 일 없이 제자리로(0.18초).
   *  · 세로 스크롤과 헷갈리지 않게: 가로로 RS_SLOP 넘게, 세로보다 1.6배 넘게 움직였을 때만 시작한다. 세로가 먼저면 그 손길은 끝까지 스크롤.
   *  · 방해하지 않는 것: 글자를 고르고 있을 때 · 길게 누른 뒤(글자 고르기) · 링크 · 첨부 · [전체 보기] · ⋯ · 인용 상자 · [듣기] · 작업 카드 ·
   *    가로로 밀리는 칸(표 · 코드) 위에서 시작한 손길 · PC판에서 글자 바로 위를 끄는 것(= 글자 고르기). PC판은 말풍선의 빈 자리에서 끌 때만.
   *  · 안드로이드 가장자리 뒤로 가기 몸짓과 겹치지 않게: 화면 양 끝 RS_EDGE 안에서 시작한 손길은 무시.
   *  · 움직임 줄이기(KScene.calm · 폰 설정)면 말풍선은 움직이지 않고 ↩ 만 나타난다. 진동 = 이미 쓰는 방식(수정 요청과 같음 · VIBRATE 권한은 v9.15 부터 있음).
   *  · 스위치 REPLY_SWIPE = false → 밀기를 받지 않는다(⋯ 시트 답장은 그대로). */
  var RS_TH = 60, RS_SLOP = 10, RS_EDGE = 28, RS_LONG = 450, RS_RATIO = 1.6;
  var RS_SKIP = 'a,button,input,textarea,select,video,audio,img.kav,.bmenu,.bfoldbtn,.bquote,.attach,.ordcard,.navchip,[data-att-url],[data-dl-url],[data-view-url],[data-lid],[data-link],[role="button"]';
  var rs = null, rsIc = null, rsEatAt = 0;
  function rsBuzz() {
    try {
      if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.Haptics) { Capacitor.Plugins.Haptics.vibrate({ duration: 20 }); return; }
      if (navigator.vibrate) navigator.vibrate(20);
    } catch (e) {}
  }
  function rsSelecting() { try { var s = window.getSelection && window.getSelection(); return !!(s && !s.isCollapsed && String(s).length); } catch (e) { return false; } }
  function rsHScroll(el, bub) {                       // 가로로 밀리는 칸(넓은 표 · 코드) 안에서 시작했나
    for (var n = el; n && n !== bub && n.nodeType === 1; n = n.parentNode) {
      if (n.scrollWidth > n.clientWidth + 2) { var ox = ''; try { ox = getComputedStyle(n).overflowX; } catch (e) {} if (ox === 'auto' || ox === 'scroll') return true; }
    }
    return false;
  }
  function rsOnText(x, y) {                           // PC판: 마우스가 글자 바로 위인가(그렇다면 글자 고르기에 맡긴다). 알 수 없으면 「글자 위」로 본다
    try {
      var node = null, off = 0;
      if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
      else if (document.caretPositionFromPoint) { var cp = document.caretPositionFromPoint(x, y); if (cp) { node = cp.offsetNode; off = cp.offset; } }
      else return true;
      if (!node || node.nodeType !== 3) return false;
      var rg = document.createRange(), len = node.length || 0;
      rg.setStart(node, Math.max(0, off - 1)); rg.setEnd(node, Math.min(len, off + 1));
      var rc = rg.getClientRects();
      for (var i = 0; i < rc.length; i++) { if (x >= rc[i].left - 3 && x <= rc[i].right + 3 && y >= rc[i].top - 2 && y <= rc[i].bottom + 2) return true; }
      return false;
    } catch (e) { return true; }
  }
  function rsMsg(uid) { for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) return chatMsgs[i]; } return null; }
  function rsStart(target, x, y, mouse) {
    rs = null;
    if (!REPLY_SWIPE || !REPLY_UI || !chatLog || !target || !target.closest) return;
    var bub = target.closest('.bubble[data-uid]');
    if (!bub || !chatLog.contains(bub) || bub.classList.contains('typing')) return;
    if (target.closest(RS_SKIP) || rsHScroll(target, bub)) return;
    if (!mouse && (x < RS_EDGE || x > (window.innerWidth || 0) - RS_EDGE)) return;   // 화면 가장자리 = 안드로이드 뒤로 가기 몸짓
    if (rsSelecting()) return;
    if (mouse && rsOnText(x, y)) return;
    var uid = bub.getAttribute('data-uid');
    if (!replyRowId(rsMsg(uid))) return;
    rs = { bub: bub, uid: uid, x0: x, y0: y, t0: Date.now(), mouse: !!mouse, on: false, d: 0, past: false, calm: replyCalm(), rect: null };
  }
  function rsIcon() {
    if (rsIc && rsIc.parentNode) return rsIc;
    rsIc = document.createElement('div');
    rsIc.id = 'replySwipeIc'; rsIc.className = 'rsic'; rsIc.setAttribute('aria-hidden', 'true');
    rsIc.innerHTML = '<span>↩</span>';
    document.body.appendChild(rsIc);
    return rsIc;
  }
  function rsPaint() {
    if (!rs || !rs.on) return;
    var d = rs.d, shown = d <= RS_TH ? d : RS_TH + (d - RS_TH) * 0.35;
    shown = Math.min(shown, 96);
    if (!rs.calm) rs.bub.style.transform = 'translateX(' + (-shown).toFixed(1) + 'px)';
    var ic = rsIcon(), r = rs.rect, gap = rs.calm ? 0 : Math.min(shown, 64);
    var p = Math.max(0, Math.min(1, rs.calm ? d / RS_TH : (shown - 12) / (RS_TH - 12)));
    var top = Math.max(8, Math.min((window.innerHeight || 600) - 44, r.top + Math.min(r.height, 120) / 2 - 18));
    ic.style.left = Math.round(r.right - (rs.calm ? 22 : gap / 2) - 18) + 'px';
    ic.style.top = Math.round(top) + 'px';
    ic.style.opacity = p.toFixed(2);
    ic.style.transform = 'scale(' + (0.55 + 0.45 * p).toFixed(3) + ')';
    ic.classList.toggle('past', rs.past);
  }
  function rsMove(x, y, ev) {
    if (!rs) return;
    if (!rs.bub.isConnected) { rsEnd(false); return; }  // 그 사이 채팅이 다시 그려졌다
    var dx = x - rs.x0, dy = y - rs.y0;
    if (!rs.on) {
      if (Math.abs(dy) > RS_SLOP && Math.abs(dy) * RS_RATIO >= Math.abs(dx)) { rs = null; return; }   // 세로가 먼저 = 스크롤
      if (dx > RS_SLOP) { rs = null; return; }                                                       // 오른쪽으로 미는 것은 답장이 아니다
      if (!(dx < -RS_SLOP && Math.abs(dx) > Math.abs(dy) * RS_RATIO)) return;
      if (!rs.mouse && Date.now() - rs.t0 > RS_LONG) { rs = null; return; }                            // 길게 누른 뒤 = 글자 고르기
      if (rsSelecting()) { rs = null; return; }
      rs.on = true; rs.rect = rs.bub.getBoundingClientRect();
      rs.bub.classList.add('rs-drag');
      if (rs.mouse) document.documentElement.classList.add('rs-mousedrag');
    }
    if (ev && ev.cancelable) ev.preventDefault();
    rs.d = Math.max(0, -dx);
    var past = rs.d >= RS_TH;
    if (past && !rs.past) rsBuzz();
    rs.past = past;
    rsPaint();
  }
  function rsEnd(commit) {
    var s = rs; rs = null;
    if (!s || !s.on) return;
    if (s.mouse) rsEatAt = Date.now();                 // 마우스로 끌고 난 뒤 따라오는 누름(click)은 먹는다(링크 · 접기 등이 눌리지 않게). 손가락으로 끌면 click 이 따라오지 않으므로 먹지 않는다(다음 정상 탭이 한 번 무시되던 것)
    document.documentElement.classList.remove('rs-mousedrag');
    var b = s.bub;
    b.classList.remove('rs-drag');
    if (!s.calm) { b.classList.add('rs-back'); b.style.transform = ''; setTimeout(function () { b.classList.remove('rs-back'); }, 220); }
    if (rsIc) {
      var ic = rsIc;
      if (commit && s.past && !s.calm) { ic.classList.add('go'); setTimeout(function () { ic.classList.remove('go', 'past'); ic.style.opacity = '0'; }, 200); }
      else { ic.classList.remove('past'); ic.style.opacity = '0'; }
    }
    if (commit && s.past) startReply(s.uid);
  }
  if (chatLog) {
    chatLog.addEventListener('touchstart', function (ev) {
      if (!ev.touches || ev.touches.length !== 1) { if (rs) rsEnd(false); return; }
      var t = ev.touches[0]; rsStart(ev.target, t.clientX, t.clientY, false);
    }, { passive: true });
    chatLog.addEventListener('touchmove', function (ev) {
      if (!rs) return;
      if (!ev.touches || ev.touches.length !== 1) { rsEnd(false); return; }
      var t = ev.touches[0]; rsMove(t.clientX, t.clientY, ev);
    }, { passive: false });                            // 가로로 미는 동안만 스크롤을 막는다(세로면 손대지 않음)
    chatLog.addEventListener('touchend', function () { if (rs) rsEnd(true); }, { passive: true });
    chatLog.addEventListener('touchcancel', function () { if (rs) rsEnd(false); }, { passive: true });
    chatLog.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0 || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.metaKey) return;
      if (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents) return;   // 손가락이 만든 흉내 마우스 사건은 위에서 이미 받았다
      rsStart(ev.target, ev.clientX, ev.clientY, true);
    });
    document.addEventListener('mousemove', function (ev) { if (rs && rs.mouse) rsMove(ev.clientX, ev.clientY, ev); });
    document.addEventListener('mouseup', function () { if (rs && rs.mouse) rsEnd(true); });
    window.addEventListener('blur', function () { if (rs) rsEnd(false); });
    chatLog.addEventListener('click', function (ev) {  // 끌고 난 직후의 누름은 여기서 멈춘다(아래 말풍선 누름 처리보다 먼저 — 잡는 단계)
      if (rsEatAt && Date.now() - rsEatAt < 400) { rsEatAt = 0; ev.stopPropagation(); ev.preventDefault(); }
    }, true);
  }
  // 폰 네이티브 입력 바(native-input.js)가 쓰는 입구: 인용 줄 내용 · ✕ · 인용 줄 누르기
  window.SmartReply = {
    get: function () { return chatReply ? { label: replyLabel(chatReply), text: chatReply.snip || '' } : null; },
    clear: function () { clearReply(false); },
    jump: function () { if (chatReply) jumpToReply(chatReply.id, chatReply.side); },
    on: function () { return !!REPLY_UI; }
  };
  function deleteMessage(uid) {
    var target = null;
    for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].uid === uid) { target = chatMsgs[i]; break; } }
    if (!target) return;
    var rid = rowIdOf(target);
    if (rid) {
      if (deletedBids.indexOf(rid) === -1) { deletedBids.push(rid); saveDeletedBids(); }   // 로컬 tombstone(즉시·재구성에도 유지)
      var pass = getSyncPass();
      if (pass && window.OfficeBridge && OfficeBridge.hideMemo) {
        OfficeBridge.hideMemo(rid, pass).catch(function () {});   // 다른 기기서도 사라지게(실패해도 이 기기엔 이미 사라짐)
      }
      // 같은 줄의 모든 말풍선(질문+답) 제거
      chatMsgs = chatMsgs.filter(function (x) { return rowIdOf(x) !== rid; });
    } else {
      // 서버 행이 없는 로컬 전용 메시지(미발송 등) → 이 항목만 제거
      chatMsgs = chatMsgs.filter(function (x) { return x.uid !== uid; });
    }
    saveChatMsgs();
    renderChat();
    updateSendEnabled();                            // 대기 중이던 질문을 지웠다면 입력 잠금 해제
    toast('삭제했습니다.');
  }
  function openClearAllSheet() {
    if (!chatMsgs.length) { toast('지울 대화가 없습니다.'); return; }
    openSheet('대화를 모두 삭제할까요?', '이 기기 화면의 대화가 모두 지워집니다(다른 기기·서버 기록은 그대로). 되돌릴 수 없습니다.', '전체 삭제', clearAllChat);
  }
  function clearAllChat() {
    // v4.0: 「전체 삭제」는 이 기기 뷰 정리 — '이 시각 이전' 서버 대화/방송을 이 기기서 다시 안 그리게 경계를 세운다.
    //   (개별 삭제만 서버 숨김으로 모든 기기 반영. 전체 삭제는 기기별 뷰 정리라 다른 기기엔 영향 없음.)
    try { localStorage.setItem(CHAT_CLEARED_KEY, new Date().toISOString()); } catch (e) {}
    chatMsgs = [];
    saveChatMsgs();
    draftDrop();                                      // (v9.20) 임시 보관 글도 함께 지운다
    officeHW = CHAT_EPOCH; chatSyncHW = CHAT_EPOCH;   // 다음 동기화는 경계 이후만 그린다
    chatOlder = null; chatHasMore = false;            // v7.0: 경계 이전 옛 쪽은 더 볼 게 없음(다음 열람 때 새로 잡음)
    stopChatReconcile();
    renderChat();
    updateSendEnabled();
    toast('이 기기의 대화를 모두 지웠습니다.');
  }
  if (sheetConfirm) sheetConfirm.addEventListener('click', function () {
    var act = sheetAction; closeSheet(); if (act) act();
  });
  if (sheetCopyBtn) sheetCopyBtn.addEventListener('click', function () {
    var v = sheetCopyVal; closeSheet(); if (v != null) copyToClipboard(v);
  });
  if (sheetCancel) sheetCancel.addEventListener('click', closeSheet);
  if (sheetEl) sheetEl.addEventListener('click', function (ev) { if (ev.target === sheetEl) closeSheet(); });
  if ($('chatMenuBtn')) $('chatMenuBtn').addEventListener('click', function () {
    var linked = !!getSyncPass();
    openSheet('대화 메뉴',
      linked ? 'PC와 폰이 연동되어 있습니다.' : 'PC(크롬)에서도 같은 대화를 보려면 연동하세요.',
      '대화 전체 삭제', openClearAllSheet, null,
      { label: linked ? 'PC 연동 암호 변경' : 'PC 연동 암호 설정', action: function () { showSyncGate(true); } });
  });

  /* ===================== 대화 검색(🔍) ===================== */
  if ($('chatSearchBtn')) $('chatSearchBtn').addEventListener('click', function () {
    if (chatSearchOn) closeChatSearch(); else openChatSearch();
  });
  if ($('chatSearchClose')) $('chatSearchClose').addEventListener('click', closeChatSearch);
  // v7.0: 검색 안내 줄의 [옛 대화까지 모두 찾기]
  if ($('chatSearchInfo')) $('chatSearchInfo').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#chatSearchMore') : null;
    if (b && !b.disabled) { b.disabled = true; b.textContent = '불러오는 중…'; loadAllOlderChat(); }
  });
  if ($('chatSearchInput')) {
    $('chatSearchInput').addEventListener('input', function () { chatSearchQuery = this.value || ''; renderChat(); });
    $('chatSearchInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeChatSearch(); });
  }

  /* ===================== v8.4(O-0162) 글자 크기 4단계 =====================
   * 작게(0.9)·보통(1, 예전 그대로)·크게(1.15)·아주 크게(1.3). <html data-fs="sm|lg|xl"> 하나로 CSS(styles.css·docviewer.css 끝)가
   *   채팅 말풍선·입력창·홈 카드(오늘 한눈에·버튼 카드·지난 메모)·문서 뷰어 글(엑셀 표 포함)을 키운다. PDF 그림(캔버스)은 확대 기능이 따로 있어 제외.
   * 폰(이 기기)에만 저장(localStorage) — 폴드 안·밖 화면, PC판이 각자. 폰 네이티브 입력 바는 열 때 크기를 넘긴다(native-input.js).
   * 고르는 곳: 맨 위 「가가」 버튼 · 케이 꾸미기 → 「글자 크기」. 보통이면 속성을 아예 지워 예전과 한 글자도 다르지 않게. */
  var FS_KEY = 'smart_font_size';
  var FS_LIST = [{ k: 'sm', n: '작게', s: 0.9 }, { k: 'md', n: '보통', s: 1 }, { k: 'lg', n: '크게', s: 1.15 }, { k: 'xl', n: '아주 크게', s: 1.3 }];
  function fsGet() { var v = 'md'; try { v = localStorage.getItem(FS_KEY) || 'md'; } catch (e) {} return FS_LIST.some(function (x) { return x.k === v; }) ? v : 'md'; }
  function fsInfo(k) { for (var i = 0; i < FS_LIST.length; i++) if (FS_LIST[i].k === k) return FS_LIST[i]; return FS_LIST[1]; }
  function fsApply(k) {
    if (k === 'md') document.documentElement.removeAttribute('data-fs');
    else document.documentElement.setAttribute('data-fs', k);
    var now = $('kwFontNow'); if (now) now.textContent = '지금: ' + fsInfo(k).n;
  }
  function fsSet(k) {
    try { localStorage.setItem(FS_KEY, k); } catch (e) {}
    fsApply(k);
    try { if (isOpen(chatView)) renderChat(); } catch (e) {}           // 긴 말풍선 접기 높이 다시 재기
    try { if (window.TodayCard) TodayCard.render(); } catch (e) {}
  }
  window.SmartFont = { get: fsGet, set: fsSet, scale: function () { return fsInfo(fsGet()).s; } };
  fsApply(fsGet());
  var fsSheet = null;
  function closeFontSheet() { if (fsSheet) { fsSheet.remove(); fsSheet = null; } }
  function openFontSheet() {
    closeFontSheet();
    var cur = fsGet();
    fsSheet = document.createElement('div');
    fsSheet.className = 'sheet fs-sheet';
    var h = '<div class="sheet-box" role="dialog" aria-label="글자 크기"><div class="sheet-head">글자 크기</div>' +
      '<div class="fs-seg" role="radiogroup">';
    FS_LIST.forEach(function (x) {
      h += '<button type="button" class="fs-opt' + (x.k === cur ? ' on' : '') + '" data-fs-k="' + x.k + '" role="radio" aria-checked="' + (x.k === cur) + '">' +
        '<span class="fs-a" style="font-size:' + Math.round(17 * x.s) + 'px">가</span><small>' + x.n + '</small></button>';
    });
    h += '</div><div class="fs-preview"><div class="bubble k">대표님, 오늘 오후 3시에 학과 회의가 있습니다. 회의자료는 아침에 보내 드렸습니다.</div>' +
      '<div class="bubble me">고마워, 4시로 옮겨 줘</div></div>' +
      '<div class="sheet-hint">채팅·입력창·홈 카드·문서 뷰어 글에 적용됩니다. 이 폰에만 저장됩니다.</div>' +
      '<button type="button" class="sheet-btn" data-fs-close>닫기</button></div>';
    fsSheet.innerHTML = h;
    fsSheet.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-fs-k]') : null;
      if (b) {
        var k = b.getAttribute('data-fs-k');
        fsSet(k);
        Array.prototype.forEach.call(fsSheet.querySelectorAll('[data-fs-k]'), function (x) {
          var on = x.getAttribute('data-fs-k') === k; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on));
        });
        return;
      }
      if (ev.target === fsSheet || (ev.target.closest && ev.target.closest('[data-fs-close]'))) closeFontSheet();
    });
    document.body.appendChild(fsSheet);
    fsSheet.style.display = 'flex';
  }
  if ($('fontBtn')) $('fontBtn').addEventListener('click', openFontSheet);
  if ($('kwFontRow')) $('kwFontRow').addEventListener('click', openFontSheet);

  /* ===================== 테마 토글 ===================== */
  if ($('themeToggle')) $('themeToggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-style') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  /* ===================== 뒤로가기 ===================== */
  var toastEl = $('toast'), toastTimer = null;
  /* v9.10: 안내 글이 좁은 폭(폰 390px — 안내 상자 195px)에서 낱말 중간에 꺾이지 않게 한다. 낱말 안 글자 사이에 이음 문자(U+2060)를 넣어 띄어쓰기에서만 줄이 나뉜다.
   *   한 줄에 붙여 둘 두 낱말은 글에 \u00a0(줄이 나뉘지 않는 띄어쓰기)로 적는다. .toast 스타일은 그대로다 — 이번 판에서 새로 넣거나 고친 글에만 쓴다(v9.8 의 「위\u2060쪽」과 같은 방법). */
  function tw(s) { return String(s).replace(/([^ ])(?=[^ ])/g, '$1\u2060'); }
  function toast(msg, ms, wide) {  // v6.7: ms(선택) — 긴 안내(설치 허용 등)는 더 오래 보이게. 기본 1.8초 그대로 · (O-0487) wide = 옷 이름이 든 긴 한 줄을 넓게(두 줄 안에 들게). 주지 않으면 예전 그대로
    if (!toastEl) return;
    toastEl.style.width = wide ? 'max-content' : ''; toastEl.style.maxWidth = wide ? '86vw' : '';   // 넓은 한 줄은 이 요소에만 값을 준다(styles.css 의 .toast 는 그대로 둔다)
    toastEl.textContent = msg; toastEl.style.display = 'block';
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.style.display = 'none'; }, 250);
    }, ms || 1800);
  }
  /* 녹음 화면에서 뒤로가기 → 갇히지 않게 선택지를 준다(2026-09-21):
   *   · [녹음 정지하고 나가기] → 정지(→ 완료 화면에서 제목·보내기)
   *   · [계속 녹음하며 나가기]  → 홈으로. 녹음은 백그라운드로 계속되고 빨간 배너로 표시
   *   · (취소=시트 닫기) → 녹음 화면 유지 */
  function openRecLeaveSheet() {
    openSheet(
      '녹음 중입니다',
      '녹음을 멈추지 않고 다른 화면으로 갈 수 있습니다. 화면을 옮겨도 녹음은 계속됩니다.',
      '녹음 정지하고 나가기',
      function () {   // 정지 → onAudio → onRecorded → 완료 화면
        if (!isRecording) return;
        isRecording = false; stopRecTimer(); updateRecIndicator();
        try { recorder.stop(); } catch (e) {}
      },
      null,
      { label: '계속 녹음하며 나가기', action: function () {
          showHome(); setStatus('녹음 중(백그라운드)', 'rec');
          toast('녹음은 계속되고 있습니다 — 아래 빨간 「녹음 중」을 누르면 녹음 화면으로 갑니다.');
        } }
    );
  }
  // v9.8: 녹음 화면에서 나가기 — 묻지 않는다. 녹음은 계속되고, 위쪽 띠·홈의 녹음 단추로 돌아온다.
  function leaveRecScreen() {
    showHome(); setStatus('녹음 중(백그라운드)', 'rec');
    // 폰 폭(390px)에서 2줄 이내가 되게 짧게. 「위」와 「쪽」 사이에서 줄이 갈리지 않게 붙임표(U+2060)를 넣었다 → 「녹음은 계속됩니다. / 위쪽 띠로 돌아옵니다.」
    toast('녹음은 계속됩니다. 위\u2060쪽 띠로 돌아옵니다.', 3500);
  }
  function goBack() {
    if (fsSheet) { closeFontSheet(); return true; }                        // v8.4: 글자 크기 창
    if (window.TodayCard && TodayCard.closeWeather && TodayCard.closeWeather()) return true;   // v8.5(O-0169): 오늘 날씨 창
    if (document.querySelector('.shin-sheet')) { try { document.querySelector('.shin-sheet').remove(); } catch (e) {} return true; }   // v8.4: 공유 고르기 창(문서·녹음)
    if (kProfile && isOpen(kProfile)) { closeKProfile(); return true; }   // v6.0: 케이 프로필 카드
    if (sheetEl && isOpen(sheetEl)) { closeSheet(); return true; }
    if ($('syncGate') && isOpen($('syncGate'))) { hideSyncGate(); return true; }   // PC 연동 암호창도 뒤로가기로 닫히게
    if (isOpen(modal)) { closeModal(); return true; }
    if (window.KVStage && KVStage.isOpen()) { KVStage.close(); return true; }   // O-0490: 케이 목소리 무대 화면 → 꾸미기 「설정」으로(예시 소리도 멈춘다)
    if (window.KFShow && KFShow.isOpen()) { KFShow.close(); return true; }      // O-0557: 케이 패션쇼 → 꾸미기 「옷」으로
    if (convoOn) { stopConvo(false); return true; }   // 연속 대화 중 뒤로 = 음성 대화 끝내기(화면 유지)
    if (chatRecording) { endListen('manualcancel'); return true; }   // 듣는 중 뒤로 = 이번 듣기 취소
    // 녹음 화면에서 뒤로 = 정지/계속 선택(예전엔 여기서 무조건 막혀 '먹통'이었음)
    if (isRecording && isOpen(recView)) { if (REC_ROAM_V2) leaveRecScreen(); else openRecLeaveSheet(); return true; }
    if (REC_ROAM_V2 && isOpen(recView)) { showHome(); setStatus('대기 중', 'idle'); return true; }      // 녹음이 시작되지 못한 채 남은 녹음 화면
    if (isOpen(recordedPanel) && pendingBlob && recCur && recCur.recovered && recFindApi()) { discardRecorded(); return true; }   // v9.10: 폰에 남아 있던 녹음을 연 화면 — 닫으면 목록으로 돌아간다
    if (isOpen(recordedPanel) && guardRecorded()) return true;                                          // v9.8: 아직 보내지 않은 녹음 — 한 번 묻는다
    if (isOpen(processing)) { showHome(); setStatus('대기 중', 'idle'); toast('정리는 뒤에서 계속됩니다 — 홈 「진행 중인 메모」에서 확인하세요.'); return true; }
    // 문서 뷰어: 전체화면 → 뷰어 → 고르기 → 홈 순으로 한 단계씩 빠져나온다(docRoot는 고정 오버레이)
    if (chatFromDocs && isOpen(chatView)) {     // O-0548: 뷰어 [💬]로 온 채팅 → 보던 문서의 같은 쪽 · 같은 확대(수정 요청 화면이었으면 그 화면)로
      chatFromDocs = false; openScreen($('docsView'));
      try { if (window.SmartDocs && SmartDocs.resumeFromChat) SmartDocs.resumeFromChat(); } catch (e) {}
      return true;
    }
    if (window.SmartDocs && SmartDocs.isFullscreen && SmartDocs.isFullscreen()) { try { SmartDocs.closeFullscreen(); } catch (e) {} return true; }
    if (window.SmartDocs && SmartDocs.isViewerOpen && SmartDocs.isViewerOpen()) { try { SmartDocs.showPick(); } catch (e) {} return true; }
    if (isOpen($('docsView'))) { showHome(); setStatus('대기 중', 'idle'); return true; }
    if (isOpen($('ideasView'))) {      // v5.5: 아이디어 수첩 — 녹음 중이면 '멈추고 보내기'(잠결 아이디어 유실 방지), 아니면 홈
      if (ideaRecording) { stopIdeaRec(); toast('녹음을 멈추고 보냈습니다.'); return true; }
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen($('ordersView'))) {     // v5.8: 작업 현황 — 채팅에서 왔으면 채팅으로, 아니면 홈으로
      if (ordersFromChat) { ordersFromChat = false; openChat(); return true; }
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen($('kWardrobeView'))) { closeKWardrobe(); return true; }   // v6.0: 케이 꾸미기 → 온 곳으로
    if (isOpen($('starsView'))) {      // v8.3: 저장한 답 — 채팅 머리줄에서 왔으면 채팅으로, 아니면 홈으로
      if (starsFromChat) { starsFromChat = false; openChat(); return true; }
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen($('remindersView'))) { showHome(); setStatus('대기 중', 'idle'); return true; }   // v8.3: 예약한 알림
    if (isOpen($('meetingsView'))) {   // v5.2: 상세 열려 있으면 목록으로, 아니면 홈으로
      if (meetingsDetailOpen) { showMeetingsList(); return true; }
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen($('healthView')) && window.HealthTab && HealthTab.back && HealthTab.back()) return true;   // v9.4(O-0344): 지난 날짜 고치는 중 → 기록 보기 목록으로
    if (isOpen(filePanel) && filePanelFromChat) { filePanelFromChat = false; pendingFiles = []; pendingKind = null; openChat(); return true; }   // (O-0176) 채팅 ＋ 에서 왔으면 채팅으로
    if (isOpen(recPrep) || isOpen(recordedPanel) || isOpen(filePanel) || isOpen(searchPanel) || isOpen(resultWrap) || isOpen(chatView) || isOpen($('lockerView')) || isOpen($('healthView'))) {
      // v9.8: 녹음 중(또는 보내지 않은 녹음이 남아 있는 동안)에는 붙여 둔 회의자료를 지우지 않는다 — 다른 화면을 보고 돌아와도 완료 화면까지 이어진다
      if (!(REC_ROAM_V2 && (isRecording || pendingBlob))) pendingMaterials = [];
      showHome(); setStatus('대기 중', 'idle'); stopLockerSync(); return true;
    }
    return false;
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (b) {
    b.addEventListener('click', function () { goBack(); });
  });
  var backExitArmed = false, backExitTimer = null;
  if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
    // v5.2(A): 앱이 포그라운드로 돌아오면 쌓인 OS 알림/앱아이콘 배지를 정리한다(읽었으니 사라지게).
    Capacitor.Plugins.App.addListener('appStateChange', function (st) {
      if (st && st.isActive) clearDeliveredNotifications();
    });
    Capacitor.Plugins.App.addListener('backButton', function () {
      if (window.KIntro && KIntro.active()) { KIntro.skip(); return; }   // (O-0116) 시작 인사 중 뒤로 = 건너뛰기(앱 종료 아님)
      if (goBack()) return;
      // 녹음이 백그라운드로 살아있는데 홈에서 뒤로 = 앱 종료 대신 녹음 화면으로(실수로 녹음 유실 방지)
      if (isRecording) {
        // v9.8: 홈에 그대로 둔다(예전에는 녹음 화면으로 보내, 「뒤로」를 누를 때마다 홈↔녹음 화면을 오갔다)
        if (REC_ROAM_V2) { toast('녹음은 계속됩니다. 앱에서 나가시려면 홈 버튼을 눌러 주십시오.', 3500); return; }
        openScreen(recView); toast('녹음 중입니다 — 정지 후 나가 주세요.'); return;
      }
      if (backExitArmed) { try { Capacitor.Plugins.App.exitApp(); } catch (e) {} }
      else {
        backExitArmed = true; toast('한 번 더 누르면 나갑니다');
        if (backExitTimer) clearTimeout(backExitTimer);
        backExitTimer = setTimeout(function () { backExitArmed = false; }, 2000);
      }
    });
  }

  /* ===================== 💡 아이디어 수첩 → 활용 제안 (v5.5, 2026-09-24) =====================
   * 대표님 지시: 자려고 눕거나 막 깼을 때·문득 떠오를 때 폰에 말하면, 그걸 바탕으로 활용(프로그램·자동화·
   *   문서·교육·연구·보관) 제안을 받아 삶을 편하게.
   * 흐름: 큰 버튼 한 번 = 즉시 녹음(준비화면 없음) → 다시 누르면 정지·즉시 전송.  글로 적어도 됨.
   *   · 음성: OfficeBridge.send(memo{kind:'idea'}, blob) — v5.1 안전 업로드 그대로(원본 선영속,
   *     폰 원본 삭제는 서버 status==='done' 확인 뒤 dropPending).
   *   · 글  : OfficeBridge.sendIdeaText.
   *   · PC 워커 idea_worker.py 가 전사(원문 먼저 저장) → 활용 제안서(summary_json.idea) → 알림.
   *   · 목록: list_ideas(연동암호 게이트) — 서버가 단일 소스, 아직 서버에 없는 것만 로컬 목록으로 보탠다.
   *   · 결정: [진행해줘](추천안 또는 고른 방향)/[보류] → set_idea_decision. 진행해줘는 소장 K 채팅으로도 전달.
   * ⚠️ confirm() 금지 → openSheet. 새 화면은 SUBS·goBack 에 등록됨. 새 backdrop-filter 없음. */
  var ideasView = $('ideasView'), ideaList = $('ideaList'), ideaFilterEl = $('ideaFilter');
  var ideaRecBtn = $('ideaRecBtn'), ideaRecLabel = $('ideaRecLabel'), ideaRecHint = $('ideaRecHint');
  var ideaInput = $('ideaInput'), ideaSendBtn = $('ideaSend');
  var IDEA_LOCAL_KEY = 'smart_ideas_local';
  var IDEA_STUCK_MS = 10 * 60 * 1000;          // 보냈는데 서버에 행이 10분째 없으면 '전송 실패'로(v5.1 STUCK_MS 와 동일 근거)
  var IDEA_MAX_REC_MS = 5 * 60 * 1000;         // 한 번에 최대 5분(잠결에 켜둔 채 잠드는 것 방지)
  var IDEA_TAGS = { app: '💻앱', auto: '⚙️자동화', doc: '📄문서', edu: '🎓교육', research: '🔬연구', keep: '📌보관' };
  var IDEA_TAG_ORDER = ['app', 'auto', 'doc', 'edu', 'research', 'keep'];
  var ideaRows = [], ideaFilter = 'all', ideaPollTimer = null, ideaLoading = false;
  var ideaRecorder = null, ideaRecording = false, ideaRecCancel = false, ideaRecStart = 0, ideaRecTick = null, ideaRecAuto = null;

  function loadIdeaLocal() { try { var a = JSON.parse(localStorage.getItem(IDEA_LOCAL_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveIdeaLocal(a) { try { localStorage.setItem(IDEA_LOCAL_KEY, JSON.stringify((a || []).slice(-100))); } catch (e) {} }
  function upsertIdeaLocal(rec) {
    var a = loadIdeaLocal(), i;
    for (i = 0; i < a.length; i++) if (a[i].id === rec.id) { a[i] = Object.assign({}, a[i], rec); saveIdeaLocal(a); return; }
    a.push(rec); saveIdeaLocal(a);
  }
  function removeIdeaLocal(id) { saveIdeaLocal(loadIdeaLocal().filter(function (x) { return x.id !== id; })); }
  function ideaSentToast() {
    toast('보냈습니다 — 몇 분 안에 제안서를 보내 드리겠습니다');
  }

  /* ---- 화면 열기 / 서버 목록 ---- */
  function openIdeas() {
    openScreen(ideasView);
    renderIdeas();
    refreshIdeas(false);
    startIdeaPoll();
  }
  function startIdeaPoll() {
    if (ideaPollTimer) return;
    ideaPollTimer = setInterval(function () {
      if (!isOpen(ideasView)) { clearInterval(ideaPollTimer); ideaPollTimer = null; return; }
      var busy = loadIdeaLocal().length || ideaRows.some(function (r) { return r.status !== 'done'; });
      if (busy) refreshIdeas(true);
    }, 15000);
  }
  // silent=true: 암호 없으면 조용히 넘어감(시작 시 원본 정리용). false: 암호 게이트를 띄움.
  function refreshIdeas(silent) {
    if (!(window.OfficeBridge && OfficeBridge.listIdeas)) return;
    var pass = getSyncPass();
    if (!pass) {
      if (!silent && isOpen(ideasView)) showSyncGate(true, '아이디어 목록을 보려면 PC 연동 암호를 입력해 주세요.');
      renderIdeas(); return;
    }
    if (ideaLoading) return; ideaLoading = true;
    OfficeBridge.listIdeas(100, pass).then(function (rows) {
      ideaLoading = false;
      ideaRows = Array.isArray(rows) ? rows : [];
      var onServer = {};
      ideaRows.forEach(function (r) {
        onServer[r.id] = true;
        if (r.status === 'done') OfficeBridge.dropPending(r.id);   // ★ PC 정리 확인 뒤에만 폰 원본 삭제(v5.1 규약)
      });
      // 로컬 목록 정리: 서버에 올라간 것은 서버 목록이 보여주므로 로컬 표시를 뗀다(원본 삭제는 위 done 조건만).
      var now = Date.now(), changed = false;
      var a = loadIdeaLocal().filter(function (x) {
        if (onServer[x.id]) { changed = true; return false; }
        if (x.status === 'sent' && now - (x.ts || now) > IDEA_STUCK_MS) {   // 보냈다는데 서버에 없음 → 실패로
          x.status = 'failed'; x.err = 'PC가 받지 못했습니다(전송이 서버까지 도달하지 못함).'; changed = true;
          if (x.input === 'voice') OfficeBridge.markResendable(x.id);
        }
        return true;
      });
      if (changed) saveIdeaLocal(a);
      renderIdeas();
    }).catch(function (e) {
      ideaLoading = false;
      if (e && e.badpass) {
        setSyncPass('');
        if (!silent && isOpen(ideasView)) showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.');
      } else if (!silent) toast('아이디어 목록을 불러오지 못했습니다. 잠시 후 다시 시도합니다.');
      renderIdeas();
    });
  }

  /* ---- 그리기 ---- */
  function ideaOf(r) { return (r && r.summary_json && r.summary_json.idea) || null; }
  function ideaWhen(ts) {
    var d = new Date(ts); if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function ideaStatus(r) {   // [라벨, 클래스]
    var sj = r.summary_json || {}, idea = ideaOf(r);
    if (idea) {
      if (sj.decision === 'go') return ['진행 요청', 'go'];
      if (sj.decision === 'hold') return ['보류', ''];
      return ['제안완료', 'done'];
    }
    if (r.status === 'done') return [sj.retry ? '제안 재시도 중' : '제안 실패', sj.retry ? 'wait' : 'err'];
    return ['정리중', 'wait'];
  }
  function renderIdeaFilter(rows) {
    if (!ideaFilterEl) return;
    var cnt = {}; IDEA_TAG_ORDER.forEach(function (k) { cnt[k] = 0; });
    rows.forEach(function (r) { var i = ideaOf(r); (i && i.tags || []).forEach(function (t) { if (cnt[t] != null) cnt[t]++; }); });
    var html = '<button class="chip' + (ideaFilter === 'all' ? ' on' : '') + '" data-if="all">전체 ' + rows.length + '</button>';
    IDEA_TAG_ORDER.forEach(function (k) {
      if (!cnt[k] && ideaFilter !== k) return;
      html += '<button class="chip' + (ideaFilter === k ? ' on' : '') + '" data-if="' + k + '">' + IDEA_TAGS[k] + ' ' + cnt[k] + '</button>';
    });
    ideaFilterEl.innerHTML = rows.length ? html : '';
    Array.prototype.forEach.call(ideaFilterEl.querySelectorAll('[data-if]'), function (b) {
      b.addEventListener('click', function () { ideaFilter = b.getAttribute('data-if'); renderIdeas(); });
    });
  }
  function renderIdeaCard(r, local) {
    var idea = ideaOf(r), sj = r.summary_json || {}, st, said;
    if (local) {
      st = r.status === 'failed' ? ['전송 실패', 'err'] : (r.status === 'sending' ? ['보내는 중', 'wait'] : ['정리중', 'wait']);
      said = r.input === 'text' ? (r.text || '') : '(말씀하신 녹음 — PC에서 받아쓰는 중입니다)';
    } else {
      st = ideaStatus(r);
      said = [r.transcript || '', r.note || ''].filter(function (x) { return x && x.trim(); }).join('\n');
      if (!said) said = (r.status === 'done') ? '(인식된 말이 없습니다)' : '(PC에서 받아쓰는 중입니다)';
    }
    var title = (idea && idea.title) || (said && said.charAt(0) !== '(' ? said.slice(0, 22) + (said.length > 22 ? '…' : '') : '아이디어');
    var h = '<div class="card idea-item" data-iid="' + esc(r.id) + '">';
    h += '<div class="idea-head"><b>' + esc(title) + '</b><span class="idea-st ' + st[1] + '">' + esc(st[0]) + '</span></div>';
    h += '<div class="idea-when">' + esc(ideaWhen(local ? r.ts : r.created_at)) + (local && r.input === 'voice' ? ' · 🎤' : '') + '</div>';
    if (idea && idea.tags && idea.tags.length) {
      h += '<div class="idea-tags">' + idea.tags.map(function (t) { return '<span class="idea-tag">' + esc(IDEA_TAGS[t] || t) + '</span>'; }).join('') + '</div>';
    }
    // 말한 내용(전사) — 제안이 있으면 접어서, 없으면 펼쳐서
    if (idea) h += '<details><summary>말씀하신 내용 보기</summary><div class="idea-said">' + esc(said) + '</div></details>';
    else h += '<div class="idea-said">' + esc(said) + '</div>';
    if (idea) {
      var pick = idea.pick || 0, chosen = (sj.decision === 'go' && sj.choice != null) ? sj.choice : null;
      h += '<div class="idea-body"><b>핵심</b> ' + esc(idea.summary || '') + '</div>';
      (idea.uses || []).forEach(function (u, i) {
        h += '<div class="idea-use' + (i === pick ? ' pick' : '') + '">' +
             ((i === pick || chosen === i) ? '<div class="u-b">' + (i === pick ? '<span class="idea-st go">★ 소장 추천</span> ' : '') +
               (chosen === i ? '<span class="idea-st done">진행 요청함</span>' : '') + '</div>' : '') +
             '<div class="u-h">' + (i + 1) + ') ' + esc(u.tag || IDEA_TAGS[u.cat] || '') + ' ' + esc(u.what || '') + '</div>' +
             '<div class="u-t">' + esc(u.how || '') + '</div>' +
             (u.effect ? '<div class="u-e">→ ' + esc(u.effect) + '</div>' : '') +
             (i !== pick ? '<button class="btn ghost sm" data-igo="' + i + '">이 방향으로 진행</button>' : '') +
             '</div>';
      });
      h += '<div class="idea-meta">👍 <b>소장 추천 ' + (pick + 1) + '번</b> — ' + esc(idea.pick_reason || '') +
           '<br>난이도 ' + esc(idea.difficulty || '') + ' · 예상 ' + esc(idea.effort || '') + '</div>';
      if ((idea.links && idea.links.length) || idea.related_note) {
        h += '<div class="idea-meta">🔗 ' + (idea.links && idea.links.length ? '「' + esc(idea.links.join(', ')) + '」과 연결됨' + (idea.related_note ? ' — ' : '') : '') + esc(idea.related_note || '') + '</div>';
      }
      if (idea.clarify) h += '<div class="idea-meta">❓ ' + esc(idea.clarify) + '</div>';
      h += '<div class="idea-actions">' +
           '<button class="btn primary" data-igo="' + pick + '">진행해줘</button>' +
           '<button class="btn ghost" data-ihold="1">보류</button></div>';
    } else if (!local && r.status === 'done' && r.error) {
      h += '<div class="idea-meta">⚠️ ' + esc(r.error) + '</div>';
    } else if (local && r.status === 'failed') {
      h += '<div class="idea-meta">⚠️ ' + esc(r.err || '전송하지 못했습니다. 폰에 안전하게 보관돼 있습니다.') + '</div>' +
           '<div class="idea-actions"><button class="btn primary" data-iresend="1">다시 보내기</button></div>';
    } else if (!local && r.progress_msg) {
      h += '<div class="idea-meta">⏳ ' + esc(r.progress_msg) + '</div>';
    }
    h += '<div class="idea-actions end"><button class="btn ghost idea-del" data-idel="1"><svg><use href="#i-trash"/></svg>삭제</button></div>';
    h += '</div>';
    return h;
  }
  function renderIdeas() {
    if (!ideaList) return;
    var onServer = {}; ideaRows.forEach(function (r) { onServer[r.id] = true; });
    var locals = loadIdeaLocal().filter(function (x) { return !onServer[x.id]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    renderIdeaFilter(ideaRows);
    var rows = ideaFilter === 'all' ? ideaRows : ideaRows.filter(function (r) { var i = ideaOf(r); return i && (i.tags || []).indexOf(ideaFilter) !== -1; });
    var html = '';
    if (ideaFilter === 'all') locals.forEach(function (x) { html += renderIdeaCard(x, true); });
    rows.forEach(function (r) { html += renderIdeaCard(r, false); });
    if (!html) {
      html = !getSyncPass()
        ? '<p class="empty-note">아이디어 목록을 보려면 PC 연동 암호가 필요합니다.</p>'
        : '<p class="empty-note">' + (ideaFilter === 'all' ? '떠오른 생각을 말하거나 적어 보세요.<br>제가 어떻게 활용할지 제안해 드리겠습니다.' : '이 갈래의 아이디어가 아직 없습니다.') + '</p>';
    }
    ideaList.innerHTML = html;
    Array.prototype.forEach.call(ideaList.querySelectorAll('[data-iid]'), function (card) {
      var id = card.getAttribute('data-iid');
      Array.prototype.forEach.call(card.querySelectorAll('[data-igo]'), function (b) {
        b.addEventListener('click', function () { decideIdea(id, 'go', parseInt(b.getAttribute('data-igo'), 10) || 0); });
      });
      var hb = card.querySelector('[data-ihold]'); if (hb) hb.addEventListener('click', function () { decideIdea(id, 'hold', null); });
      var rb = card.querySelector('[data-iresend]'); if (rb) rb.addEventListener('click', function () { resendIdea(id); });
      var db = card.querySelector('[data-idel]'); if (db) db.addEventListener('click', function () { deleteIdea(id); });
    });
  }

  /* ---- 보내기: 음성 ---- */
  function ensureIdeaRecorder() {
    if (ideaRecorder) return ideaRecorder;
    ideaRecorder = new RecordingModule({
      kind: 'idea',                      // v9.8
      onStatus: function (s) { if (s === 'error') resetIdeaRecUI(); },
      onError: function (m) { toast('🎤 ' + m); resetIdeaRecUI(); },
      onAudio: function (blob) { onIdeaAudio(blob); }
    });
    return ideaRecorder;
  }
  function setIdeaRecUI(on) {
    if (ideaRecBtn) { ideaRecBtn.classList.toggle('stop', on); ideaRecBtn.classList.toggle('pulsing', on); }
    var ic = $('ideaRecIcon'); if (ic) ic.innerHTML = '<use href="#' + (on ? 'i-stop' : 'i-mic') + '"/>';
    if (ideaRecLabel) ideaRecLabel.textContent = on ? '듣고 있습니다 00:00' : '눌러서 말하기';
    if (ideaRecHint) ideaRecHint.textContent = on ? '다 말씀하셨으면 한 번 더 누르세요 — 바로 보냅니다' : '한 번 누르면 바로 녹음, 다시 누르면 보냅니다';
  }
  function resetIdeaRecUI() {
    ideaRecording = false;
    if (ideaRecTick) { clearInterval(ideaRecTick); ideaRecTick = null; }
    if (ideaRecAuto) { clearTimeout(ideaRecAuto); ideaRecAuto = null; }
    setIdeaRecUI(false);
  }
  function startIdeaRec() {
    if (ideaRecording) return;
    if (isRecording) { toast(REC_ROAM_V2 ? '회의 녹음 중에는 말로 남길 수 없습니다. 글로 적어 주십시오.' : '회의 녹음이 진행 중입니다. 먼저 마쳐 주세요.', REC_ROAM_V2 ? 3200 : 0); return; }
    if (chatRecording) { toast('케이와 음성 대화 중입니다. 먼저 마쳐 주세요.'); return; }
    if (!RecordingModule.isSupported()) { toast('이 기기에서는 녹음을 쓸 수 없습니다. 글로 적어 주세요.'); return; }
    var r = ensureIdeaRecorder();
    ideaRecCancel = false; ideaRecording = true; ideaRecStart = Date.now();
    setIdeaRecUI(true);
    ideaRecTick = setInterval(function () {
      if (ideaRecLabel) ideaRecLabel.textContent = '듣고 있습니다 ' + fmtSec((Date.now() - ideaRecStart) / 1000);
    }, 500);
    ideaRecAuto = setTimeout(function () { if (ideaRecording) { toast('5분이 지나 자동으로 보냈습니다.'); stopIdeaRec(); } }, IDEA_MAX_REC_MS);
    try { r.start(); } catch (e) { toast('녹음을 시작하지 못했습니다.'); resetIdeaRecUI(); }
  }
  function stopIdeaRec() {
    if (!ideaRecording) return;
    resetIdeaRecUI();
    if (ideaRecLabel) ideaRecLabel.textContent = '보내는 중…';
    try { ideaRecorder.stop(); } catch (e) { toast('녹음 정지에 실패했습니다.'); setIdeaRecUI(false); }
  }
  function onIdeaAudio(blob) {
    setIdeaRecUI(false);
    if (ideaRecCancel) { ideaRecCancel = false; return; }
    var dur = (ideaRecorder && ideaRecorder.lastDurationMs) || 0;
    if (!blob || (blob.size || 0) < 1200 || (dur && dur < 700)) { toast('너무 짧습니다. 버튼을 누르고 말씀한 뒤 다시 눌러 주세요.'); return; }
    var t = now();
    var memo = { id: OfficeBridge.uuid(), token: OfficeBridge.token(), title: '아이디어', kind: 'idea',
                 ext: OfficeBridge.extFromBlob(blob), date: t.date, time: t.time, materials: [] };
    upsertIdeaLocal({ id: memo.id, token: memo.token, ts: Date.now(), input: 'voice', status: 'sending' });
    renderIdeas();
    OfficeBridge.send(memo, blob).then(function () {
      upsertIdeaLocal({ id: memo.id, status: 'sent', ts: Date.now() });
      renderIdeas(); ideaSentToast(); startIdeaPoll();
    }).catch(function (e) {
      upsertIdeaLocal({ id: memo.id, status: 'failed', err: '전송 실패(인터넷 확인). 녹음은 폰에 안전하게 보관돼 있습니다 — 연결되면 자동으로 다시 보냅니다.' });
      renderIdeas(); toast('⚠️ 전송 실패 — 녹음은 폰에 보관됐습니다. 인터넷이 되면 자동으로 다시 보냅니다.');
    });
  }
  if (ideaRecBtn) ideaRecBtn.addEventListener('click', function () {
    if (ideaRecording) stopIdeaRec(); else startIdeaRec();
  });

  /* ---- 보내기: 글 ---- */
  function sendIdeaTextUI(text, reuseId, reuseTok) {
    var id = reuseId || OfficeBridge.uuid(), tok = reuseTok || OfficeBridge.token();
    upsertIdeaLocal({ id: id, token: tok, ts: Date.now(), input: 'text', text: text, status: 'sending' });
    renderIdeas();
    return OfficeBridge.sendIdeaText({ id: id, token: tok, note: text }).then(function () {
      upsertIdeaLocal({ id: id, status: 'sent', ts: Date.now() });
      renderIdeas(); ideaSentToast(); startIdeaPoll();
    }).catch(function () {
      upsertIdeaLocal({ id: id, status: 'failed', err: '전송 실패(인터넷 확인). 적으신 글은 폰에 남아 있습니다.' });
      renderIdeas(); toast('⚠️ 전송 실패 — 글은 남아 있습니다. [다시 보내기]를 눌러 주세요.');
    });
  }
  if (ideaSendBtn) ideaSendBtn.addEventListener('click', function () {
    var text = ((ideaInput && ideaInput.value) || '').trim();
    if (!text) { toast('아이디어를 적어 주세요.'); return; }
    if (ideaInput) ideaInput.value = '';
    sendIdeaTextUI(text.slice(0, 4000));
  });
  function resendIdea(id) {
    var x = null; loadIdeaLocal().forEach(function (e) { if (e.id === id) x = e; });
    if (!x) return;
    if (x.input === 'text') { sendIdeaTextUI(x.text || '', x.id, x.token); return; }
    upsertIdeaLocal({ id: id, status: 'sending', ts: Date.now() }); renderIdeas();
    OfficeBridge.markResendable(id).then(function () {
      return OfficeBridge.flush();                                // 보존 원본(IndexedDB)을 같은 id 로 재전송
    }).then(function () {
      // flush 는 건별 실패를 삼키므로 여기선 'sent'로 두고, 10분 안에 서버에 안 보이면 refreshIdeas 가 다시 '실패'로 돌린다.
      upsertIdeaLocal({ id: id, status: 'sent', ts: Date.now() }); renderIdeas(); startIdeaPoll();
      setTimeout(function () { refreshIdeas(true); }, 4000);
    }).catch(function () {
      upsertIdeaLocal({ id: id, status: 'failed' }); renderIdeas(); toast('아직 보내지 못했습니다. 잠시 후 다시 눌러 주세요.');
    });
  }

  /* ---- 결정: [진행해줘]/[보류] ---- */
  function findIdeaRow(id) { for (var i = 0; i < ideaRows.length; i++) if (ideaRows[i].id === id) return ideaRows[i]; return null; }
  function decideIdea(id, decision, choice) {
    var r = findIdeaRow(id), idea = ideaOf(r); if (!r || !idea) return;
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, 'PC 연동 암호를 입력해 주세요.'); return; }
    var u = (idea.uses || [])[choice || 0] || {};
    var doIt = function () {
      OfficeBridge.setIdeaDecision(id, decision, decision === 'go' ? (choice || 0) : null, getSyncPass()).then(function (ok) {
        if (!ok) { toast('저장하지 못했습니다(아직 정리 전일 수 있습니다).'); return; }
        r.summary_json = Object.assign({}, r.summary_json || {}, { decision: decision, choice: decision === 'go' ? (choice || 0) : null });
        renderIdeas();
        if (decision === 'hold') { toast('보류로 표시했습니다.'); return; }
        forwardIdeaToK(r, idea, choice || 0);
      }).catch(function (e) {
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
        else toast('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      });
    };
    if (decision !== 'go') { doIt(); return; }
    openSheet('이 방향으로 진행할까요?',
      (choice + 1) + ') ' + (u.tag || '') + ' ' + (u.what || '') + '\n저에게 채팅으로 전달됩니다. 계획을 먼저 정리해 여쭙겠습니다.',
      '진행해줘', doIt);
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-check'); }   // 긍정 동작이라 휴지통·빨강 대신 ✓
  }
  // 진행해줘 → 소장 K 채팅으로 전달(대표님 이름으로 보내는 채팅 1건). 실패해도 결정 저장은 이미 끝남.
  function forwardIdeaToK(r, idea, choice) {
    var u = (idea.uses || [])[choice] || {};
    var said = [r.transcript || '', r.note || ''].filter(function (x) { return x && x.trim(); }).join(' ').slice(0, 300);
    var text = '💡 [아이디어 진행 요청] 「' + (idea.title || '아이디어') + '」\n' +
               '진행할 방향: ' + (choice + 1) + ') ' + (u.tag || '') + ' ' + (u.what || '') + ' — ' + (u.how || '') + '\n' +
               (choice !== (idea.pick || 0) ? '(소장 추천은 ' + ((idea.pick || 0) + 1) + '번이었지만 이 방향으로 골랐습니다)\n' : '') +
               '말한 내용: ' + said + '\n' +
               '소장님, 바로 만들지 말고 먼저 진행 계획(범위·일정·제가 승인할 것)을 정리해서 알려 주세요.';
    try {
      var cid = OfficeBridge.uuid(), tok = OfficeBridge.token();
      chatMsgs.push({ role: 'me', text: text, ts: Date.now(), id: cid, token: tok, answered: false });
      saveChatMsgs(); renderChat();
      OfficeBridge.sendChat(cid, tok, chatThread, text, { speak: false }).then(function () {
        startChatReconcile();
        toast('진행 요청을 보냈습니다. 채팅에서 제 답을 확인하세요.');
      }).catch(function () {
        var m = findMsg(cid); if (m) m.answered = true;
        saveChatMsgs(); renderChat();
        toast('결정은 저장됐지만 저에게 전달되지 않았습니다. 채팅으로 한 번 말씀해 주세요.');
      });
    } catch (e) { toast('결정은 저장됐습니다. 저에게는 채팅으로 한 번 말씀해 주세요.'); }
  }

  /* ---- 삭제(소프트삭제 hide_memo 재사용 · 복구 가능) ---- */
  function deleteIdea(id) {
    var isLocal = !findIdeaRow(id);
    openSheet('이 아이디어를 지울까요?',
      isLocal ? '아직 PC로 보내지 못한 아이디어입니다. 지우면 폰에 보관된 원본도 함께 지워집니다.'
              : '목록에서 사라집니다. 소프트삭제라 서버 원본은 남아 있어(복구 가능) 안심하셔도 됩니다.',
      '삭제', function () {
        if (isLocal) { removeIdeaLocal(id); OfficeBridge.dropPending(id); renderIdeas(); toast('지웠습니다.'); return; }
        var pass = getSyncPass();
        if (!pass) { showSyncGate(true, '삭제하려면 PC 연동 암호를 입력해 주세요.'); return; }
        OfficeBridge.hideMemo(id, pass).then(function () {
          ideaRows = ideaRows.filter(function (x) { return x.id !== id; });
          OfficeBridge.dropPending(id);                             // 폰에 남은 원본(있으면)도 정리
          removeIdeaLocal(id); renderIdeas(); toast('지웠습니다.');
        }).catch(function (e) {
          if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
          else toast('삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        });
      });
  }

  if ($('btnIdeas')) $('btnIdeas').addEventListener('click', openIdeas);
  window.addEventListener('smartOpenIdeas', function () { openIdeas(); });   // 제안 알림 탭 → 아이디어 화면

  /* ===================== 시작 ===================== */
  setStatus('대기 중', 'idle');
  renderHistory();
  showHome();
  OfficeBridge.flush(function () { renderHistory(); });
  HistoryModule.list().forEach(function (e) {
    if (!e.token) return;
    if (e.kind === 'video' && e.status === 'processing') {
      startVideoPolling(e.id, e.token);   // 긴 영상: 백그라운드로 이어서 진행 확인
    } else if ((e.status === 'pending' || e.status === 'processing') && e.kind !== 'video' && !pollTimer) {
      startPolling(e.id, e.token);
    }
  });
  // 앱을 껐다 켜도, 나가 있는 동안 도착한 케이 답을 이어받는다(배지·복원)
  if (anyAwaiting()) startChatReconcile();
  // v4.2: '이미 본' 경계가 아직 없으면(=이 버전 설치 후 첫 실행) 지금 시각으로 한 번 심어 둔다(1회성 정리).
  //   이렇게 하면 그전에 쌓인 과거 방송·대화는 '본 것'으로 간주돼, 아래 loadOfficePushes/loadChatSync 가
  //   그것들을 다시 안읽음으로 세지 않는다(대표님 증상: 새 메시지 없는데 +9 → 해소). 이후 새로 오는 것만 배지.
  // (O-0201) 세기 전에 서버 읽음 기준부터 받는다 → 다른 기기에서 이미 읽은 것은 처음부터 세지 않는다(숫자가 떴다 사라지지 않게).
  //   못 받으면(암호 없음·SQL 미적용·오프라인·2.5초 초과) 예전 그대로. 첫 실행의 '지금' 심기는 예전처럼 기다리지 않고 바로 한다
  //   (서버를 기다리는 동안 경계가 비어 있으면 그 틈에 온 조회가 옛 메시지를 전부 안읽음으로 센다).
  if (!getSeenHW()) setSeenHW(Date.now());
  readPull(function () {
    loadOfficePushes();   // 시작 시 그동안 조용히 쌓인 케이 방송을 확인(무푸시 방송은 이때 배지로 알림)
    loadChatSync();       // 시작 시, 다른 기기에서 온 대화도 한 번 확인(암호 설정돼 있을 때만)
  });
  try { ofPull(); } catch (e) {}   // (O-0487) 케이 옷: 다른 기기에서 바꾼 것이 있으면 맞춘다(시작을 기다리게 하지 않는다 — 따로 묻는다)
  // v5.5: 보내 둔 아이디어가 있으면 조용히 한 번 확인 → PC 정리(done)된 것의 폰 원본 정리·로컬 표시 갱신
  if (loadIdeaLocal().length && getSyncPass()) refreshIdeas(true);

  /* ---- 건강 탭: 화면 열기/연결(로직은 health.js) ---- */
  var healthView = $('healthView');
  function openHealth() {
    openScreen(healthView);
    if (window.HealthTab && HealthTab.open) { try { HealthTab.open(); } catch (e) {} }
  }
  if (window.HealthTab && HealthTab.init) { try { HealthTab.init({ toast: toast }); } catch (e) {} }
  if ($('btnHealth')) $('btnHealth').addEventListener('click', openHealth);

  /* ---- 문서 뷰어: 화면 열기/연결(로직은 docviewer.js) ---- */
  var docsView = $('docsView');
  function openDocs() {
    openScreen(docsView);
    if (window.SmartDocs && SmartDocs.showPick) { try { SmartDocs.showPick(); } catch (e) {} }
  }
  // v6.9: 최근 연 문서 삭제·비우기 확인은 앱 확인 시트로(confirm() 금지)
  if (window.SmartDocs && SmartDocs.init) { try { SmartDocs.init({ toast: toast, confirm: function (t, m, label, fn, o) { openSheet(t, m, label, fn); if (o && o.positive && sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#' + (o.icon || 'i-check')); } },   // v8.7: 「스토어 열기」 같은 여는 동작은 빨간 휴지통 대신 보통 버튼
    ask: askKFromDoc,
    edit: { download: downloadAttachment },                      // O-0171 PC에서 편집하기 — 고친 파일 받기는 채팅 첨부와 같은 저장 경로
    chat: function () { chatFromDocs = true; openChat(); } }); } catch (e) {} }   // O-0548 뷰어 [💬] → 채팅(뒤로 가면 보던 문서로)

  /* ---- O-0544 문서 뷰어 「수정 요청」 — 보내기 · 취소 · 상태(화면은 markup.js) ----
   *   [PC로 보내기] → 채팅 첨부 통로(sendChatDocAsk, 연동 암호 확인 submit_memo)로 한 행:
   *     note = 사람이 읽는 요약(채팅 말풍선은 이 요약 글만) · files = 짚은 곳 그림(mark_N.jpg) + (폰 원본이면) 원본 파일
   *     meta.markup = {v, doc:{name,ext,key,pages,src:{type:pc_path|url|upload}, after_rid}, marks:[…], opts}
   *   PC 응답기(markup_intake.py)가 케이 판단 없이 작업실(markup)로 넘기고 「받았어요 …(작업 #N)」으로 답한다.
   *   [요청 취소] → meta.markup_cancel = {rid} 한 행(PC가 작업을 멈추고 답한다). 상태는 작업 카드와 같은 목록(list_office_orders_by_source). */
  function mkDataUrlToFile(du, name) {
    try {
      var m = /^data:([^;]+);base64,(.*)$/.exec(du || ''); if (!m) return null;
      var bin = atob(m[2]), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new File([u], name, { type: m[1] });
    } catch (e) { return null; }
  }
  function mkSend(p) {
    if (!window.OfficeBridge) return Promise.reject(new Error('보내기 준비가 되지 않았습니다'));
    if (!getSyncPass()) {
      try { window.dispatchEvent(new CustomEvent('smartBadPass', { detail: { need: true } })); } catch (x) {}
      var pe = new Error('연동 암호가 필요합니다'); pe.friendly = '연동 암호를 넣으신 뒤 다시 눌러 주세요'; return Promise.reject(pe);
    }
    var d = p.doc || {}, s = d.src || {}, entries = [], src;
    if (s.pcPath) src = { type: 'pc_path', path: s.pcPath };
    else if (s.url) src = { type: 'url', url: s.url };
    else if (s.file) {
      if ((s.file.size || 0) > CHAT_CHUNK_LIMIT) { var be = new Error('원본이 너무 큽니다'); be.friendly = '원본이 45MB를 넘어 폰에서 보낼 수 없습니다 — PC에 있는 파일로 열어 주세요'; return Promise.reject(be); }
      src = { type: 'upload', file: { name: d.name, size: s.file.size || 0 } };
    } else return Promise.reject(new Error('원본 파일이 없습니다'));
    var marks = (p.marks || []).map(function (m) {
      var shot = '';
      if (m.shot) { var f = mkDataUrlToFile(m.shot, 'mark_' + m.n + '.jpg'); if (f) { entries.push({ file: f }); shot = f.name; } }
      var o = {}; for (var k in m) if (m.hasOwnProperty(k)) o[k] = m[k];
      o.shot = shot; return o;
    });
    if (src.type === 'upload') entries.push({ file: new File([s.file], d.name, { type: s.file.type || 'application/octet-stream' }) });
    var lines = marks.map(function (m) { return m.n + ') ' + m.page + '쪽 「' + String(m.label || m.text || '').slice(0, 30) + '」 → ' + m.note; });
    var head = '✏️ 「' + d.name + '」 수정 요청 ' + marks.length + '건을 PC로 보냈습니다' + (d.after_rid ? ' (앞 요청에 이어서)' : '');
    var note = head + '\n' + lines.join('\n');
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var msg = { role: 'me', text: note, ts: Date.now(), id: id, token: tok, answered: false, files: [], up: true, uploading: true };
    chatMsgs.push(msg); saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    var memo = { id: id, token: tok, thread: chatThread, title: ('수정 요청 · ' + d.name).slice(0, 40), note: note,
                 extraMeta: { markup: { v: 1, doc: { name: d.name, ext: d.ext, key: d.key, pages: d.pages || 0, src: src, after_rid: d.after_rid || null },
                                        marks: marks, opts: { marked_pdf: true } } } };
    return OfficeBridge.sendChatDocAsk(memo, entries).then(function () {
      msg.uploading = false; saveChatMsgs(); if (isOpen(chatView)) renderChat();
      startChatReconcile(); kickOrderPoll();
      return { rid: id };
    }, function (e) {
      msg.answered = true; msg.uploading = false;
      chatMsgs.push({ role: 'k', text: '수정 요청을 PC로 보내지 못했습니다(' + ((e && (e.friendly || e.message)) || '알 수 없는 오류') + '). 문서 화면에서 다시 눌러 주세요. 적어 두신 요청은 그대로 남아 있습니다.', ts: Date.now() });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
      throw e;
    });
  }
  function mkCancel(rid) {
    if (!window.OfficeBridge || !getSyncPass()) return Promise.reject(new Error('연동 암호가 필요합니다'));
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token(), note = '✏️ 보낸 수정 요청을 취소해 주세요';
    chatMsgs.push({ role: 'me', text: note, ts: Date.now(), id: id, token: tok, answered: false, files: [], up: true });
    saveChatMsgs(); if (isOpen(chatView)) renderChat();
    return OfficeBridge.sendChatDocAsk({ id: id, token: tok, thread: chatThread, title: '수정 요청 취소', note: note, extraMeta: { markup_cancel: { rid: rid } } }, [])
      .then(function () { startChatReconcile(); kickOrderPoll(); return true; });
  }
  function mkStatus(rids) {
    var pass = getSyncPass();
    if (!pass || !(window.OfficeBridge && OfficeBridge.listOfficeOrdersBySource)) return Promise.resolve({});
    return OfficeBridge.listOfficeOrdersBySource(rids, pass).then(function (rows) {
      var m = {}; (rows || []).forEach(function (r) { if (r && r.source_id) m[r.source_id] = { status: r.status || '', job_status: r.job_status || '', job_seq: r.job_seq || 0 }; });
      return m;
    });
  }
  if (window.SmartMarkup) {
    SmartMarkup.setHost({ send: mkSend, cancel: mkCancel, status: mkStatus, toast: toast,
      sttBusy: function () { return !!(convoOn || (stt && stt.on)); },   // 음성 대화 · 채팅 받아쓰기 중이면 메모 받아쓰기를 켜지 않는다(설계 8절 잠금)
      sfx: function () { return sfxMode; },
      goChat: function () { if (window.SmartDocs && SmartDocs.goChat) SmartDocs.goChat(); },   // O-0548: 수정 요청 화면의 [💬] · [채팅 보기] · [작업 현황에서 보기] → 뷰어와 같은 길(뒤로 가면 그 화면 그대로)
      openChat: function () { openChat(); },
      reopenFix: function () { if (window.SmartDocs && SmartDocs.openFix) SmartDocs.openFix(); },
      setOrig: function (f) { if (window.SmartDocs && SmartDocs.setOrig) SmartDocs.setOrig(f); } });
    // 옷·설정 → 설정 「길게 눌러 수정 요청 켜기」(이 기기에만 저장)
    (function () {
      var cb = $('kwMkLong'); if (!cb) return;
      cb.checked = SmartMarkup.longPressOn();
      cb.addEventListener('change', function () { SmartMarkup.setLongPress(cb.checked); toast(cb.checked ? '문서를 길게 누르면 수정 요청이 켜집니다' : '길게 누르기로는 켜지지 않습니다. [✏️ 고치기]로 여십시오'); });
    })();
  }

  /* ---- v8.1(O-0154) 문서 뷰어 [케이에게 묻기·맡기기] ----
   * 대표님이 보던 문서(변환된 PDF / 엑셀 원본)를 채팅 첨부 통로로 케이에게 보낸다. 새 서버 테이블 없음.
   *   · PC가 이미 변환해 서버에 둔 PDF(문서 요청 행)가 살아 있으면 다시 올리지 않고 그 번호만 넘긴다(SmartDocs.checkRef).
   *   · 질문 글(note)에 「어느 문서 몇 쪽을 보다가」를 함께 적는다 → 케이 즉답·작업실 지시(원문) 어디로 가도 그대로 따라간다.
   *     meta.doc_ctx 에도 같은 내용을 구조로 남긴다(PC 응답기의 「큰 문서 나눠 읽기」 안내용).
   *   · 케이 답은 평소처럼 채팅(음성 대화 중이면 목소리로도). 보던 문서는 「문서 보기 → 이어서 보기」에 남는다. */
  // 받침 따라 을/를 (마지막 한글 글자 기준, 한글이 없으면 '을(를)')
  function josaEulReul(w) {
    var s = String(w || '');
    for (var i = s.length - 1; i >= 0; i--) { var c = s.charCodeAt(i); if (c >= 0xAC00 && c <= 0xD7A3) return ((c - 0xAC00) % 28) ? '을' : '를'; if (/[0-9A-Za-z]/.test(s[i])) break; }
    return '을(를)';
  }
  function docAskWhere(it) {
    if (it.kind === 'excel' && it.view !== 'pdf') return it.sheet ? ('「' + it.sheet + '」 시트') : '';
    return it.page ? (it.page + '쪽') : '';
  }
  function docAskLine(it, i, sent) {
    var w = docAskWhere(it), tot = (it.kind === 'excel' && it.view !== 'pdf') ? (it.sheets ? '시트 ' + it.sheets + '개' : '') : (it.pages ? '전체 ' + it.pages + '쪽' : '');
    var what = it.kind === 'excel' ? (sent.isPdf ? 'PDF로 바꾼 것' : '엑셀 원본') : (it.ext === 'pdf' ? 'PDF 원본' : 'PC가 PDF로 바꾼 것');
    return (i + 1) + ') ' + it.name + ' → 첨부 「' + sent.name + '」(' + what + ')' +
      (w ? ' · ' + (it.active ? '보던 곳 ' : '본 곳 ') + w : '') + (tot ? ' / ' + tot : '') + (it.active ? ' ← 지금 보던 문서' : '');
  }
  function askKFromDoc(p) {
    if (!p || !p.items || !p.items.length || !window.OfficeBridge) return;
    var items = p.items, act = items.filter(function (x) { return x.active; })[0] || items[0];
    var where = docAskWhere(act), wp = (where || '문서') + (items.length > 1 ? ' 외 ' + (items.length - 1) + '개' : '');
    var dispCap = '📄 「' + act.name + '」 ' + wp + josaEulReul(wp) + ' 보며';
    openChat();                                                     // 뷰어는 「열어 둔 문서」로 남는다(docviewer parked)
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var dispFiles = items.map(function (x) {
      var b = x.orig || x.pdf;
      return { name: x.orig ? x.name : x.sendName, size: (b && b.size) || 0, mime: x.orig ? (x.orig.type || '') : 'application/pdf', kind: 'document' };
    });
    var msg = { role: 'me', text: dispCap + '\n' + p.question, ts: Date.now(), id: id, token: tok, answered: false,
                files: dispFiles, up: true, uploading: true };
    chatMsgs.push(msg); saveChatMsgs(); renderChat(); updateSendEnabled();
    function fail(text) {
      msg.answered = true; msg.uploading = false;
      chatMsgs.push({ role: 'k', text: text, ts: Date.now() });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    }
    var checks = items.map(function (x) { return (x.ref && SmartDocs.checkRef) ? SmartDocs.checkRef(x.ref) : Promise.resolve(null); });
    Promise.all(checks).then(function (refs) {
      var entries = [], lines = [], dropped = [], ctxDocs = [];
      items.forEach(function (x, i) {
        var r = refs[i], blob = x.orig || x.pdf, name = x.orig ? x.name : x.sendName;
        if (r && !x.orig) {
          if (!x.pages && r.pages) x.pages = r.pages;
          entries.push({ ref: r, name: name, size: (x.pdf && x.pdf.size) || 0 });
        } else if (blob) {
          var single = items.length === 1;
          if ((blob.size || 0) > CHAT_CHUNK_LIMIT && !single) { dropped.push(x.name); return; }   // 여러 개 묶음엔 45MB까지만
          entries.push({ file: new File([blob], name, { type: x.orig ? (x.orig.type || 'application/octet-stream') : 'application/pdf' }) });
        } else { dropped.push(x.name); return; }
        lines.push(docAskLine(x, entries.length - 1, { name: name, isPdf: !x.orig }));
        ctxDocs.push({ name: x.name, file: name, ext: x.ext, kind: x.kind, view: x.view, page: x.page || 0, pages: x.pages || 0,
                       sheet: x.sheet || '', sheets: x.sheets || 0, active: !!x.active, reused: !!(r && !x.orig) });
      });
      (p.missing || []).forEach(function (n) { dropped.push(n); });
      if (!entries.length) { fail('보던 문서를 보내지 못했습니다. 문서를 다시 열고 [케이에게 묻기]를 눌러 주세요.'); return; }
      var hw = where || '문서';
      var head = '[문서 보며 질문] 대표님이 스마트비서 문서 뷰어에서 「' + act.name + '」 ' + hw +
                 (act.pages && !(act.kind === 'excel' && act.view !== 'pdf') ? '(전체 ' + act.pages + '쪽)' : '') + josaEulReul(hw) + ' 보다가 보내셨습니다.';
      var note = p.question + '\n\n' + head + '\n보낸 문서:\n' + lines.join('\n') +
                 (dropped.length ? '\n(못 보낸 문서: ' + dropped.join(', ') + ' — 내용은 추측하지 말 것)' : '');
      var memo = { id: id, token: tok, thread: chatThread, title: act.name.slice(0, 40), note: note,
                   extraMeta: { speak: !!convoOn, doc_ctx: { v: 1, all: !!p.all, chip: p.chip || null, docs: ctxDocs } } };
      if (dropped.length) toast('너무 크거나 사본이 없는 문서는 빼고 보냈습니다: ' + dropped.join(', '));
      var one = entries.length === 1 && entries[0].file && entries[0].file.size > CHAT_CHUNK_LIMIT;
      var work = one ? OfficeBridge.sendChatChunked(memo, entries[0].file) : OfficeBridge.sendChatDocAsk(memo, entries);
      if (one) toast('큰 문서라 나눠 올립니다 — 시간이 걸릴 수 있습니다.');
      return work.then(function () {
        msg.uploading = false; saveChatMsgs();
        if (isOpen(chatView)) renderChat();
        startChatReconcile(); kickOrderPoll();
        toast('보던 문서는 「문서 보기 → 이어서 보기」에 그대로 있습니다.');
      });
    }).catch(function (e) {
      var why = (e && (e.friendly || e.message)) || String(e);
      fail('문서를 케이에게 보내지 못했습니다(' + why + '). 인터넷 연결을 확인하고 문서 화면에서 다시 눌러 주세요.');
    });
  }
  if ($('btnDocs')) $('btnDocs').addEventListener('click', openDocs);
  // 채팅 첨부(케이가 보낸 문서)의 [뷰어로 보기] → 문서 뷰어 화면으로 바로 표시
  function openDocFromChat(att) {
    openScreen(docsView);
    if (window.SmartDocs && SmartDocs.viewChatAttachment) { try { SmartDocs.viewChatAttachment(att); } catch (e) { toast('문서를 여는 데 실패했습니다.'); } }
  }

  /* ---- 다른 앱에서 "공유/열기 → 스마트비서"로 넘어온 문서를 뷰어로 표시 ----
     네이티브(MainActivity)가 content:// 파일을 읽어 base64로 넘겨준다.
     여기서 File 객체로 복원해 SmartDocs.handleLocalFile에 태우면
     PDF는 폰에서 바로, 오피스·한글·엑셀은 기존 변환 경로(OfficeBridge kind='doc')로 표시된다. */
  function b64ToBytes(b64) {
    var bin = atob(b64 || ''); var len = bin.length; var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function openSharedDoc(d) {
    if (!d) return;
    if (d.error) {
      // v6.6: 「공유/열기」는 폰 안에서 파일을 통째로 옮기는 방식이라 60MB까지만(네이티브 제한 유지).
      //   더 큰 파일은 앱 안에서 직접 고르면 5GB까지 된다 — 그 길을 알려 준다.
      var tip = /60MB/.test(d.error) ? ' 큰 파일은 스마트비서의 「문서 보기」·「공유함」·채팅 첨부에서 직접 고르면 5GB까지 보낼 수 있습니다.' : '';
      toast((d.error || '공유된 문서를 여는 데 실패했습니다.') + tip); return;
    }
    try {
      var bytes = b64ToBytes(d.b64);
      var f = new File([bytes], d.name || 'document', { type: d.mime || 'application/octet-stream' });
      openScreen(docsView);
      if (window.SmartDocs && SmartDocs.handleLocalFile) { SmartDocs.handleLocalFile(f); }
      else { toast('문서 뷰어를 준비하지 못했습니다.'); }
    } catch (e) { toast('공유된 문서를 여는 데 실패했습니다.'); }
  }
  // 조기 스텁(index.html head)을 실제 처리기로 교체하고, 그동안 큐에 쌓인 것을 처리한다.
  window.__smartSharedDoc = function (name, mime, b64) { openSharedDoc({ name: name, mime: mime, b64: b64 }); };
  window.__smartSharedDocError = function (msg, name) { openSharedDoc({ error: msg, name: name }); };
  (function () {
    try {
      var q = window.__smartSharedDocQueue || [];
      window.__smartSharedDocQueue = [];
      for (var i = 0; i < q.length; i++) openSharedDoc(q[i]);
    } catch (e) {}
  })();

  /* ---- 푸시 알림(FCM): 등록·수신은 push.js. 여기선 대화 화면과 연결만 한다 ---- */
  window.addEventListener('smartOpenChat', function () { openChat(); });          // 알림 탭 → 대화 열기
  // v5.9: 채팅을 켜 둔 채 앱을 나갔다 돌아오면(폰 복귀·PC 창 전환) 그사이 온 첫 메시지의 시작으로.
  //   알림 탭은 smartOpenChat → openChat 이 다시 처리하므로, 여기선 경계만 붙잡고 다시 그린다.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !isOpen(chatView) || chatSearchOn) return;
    armChatAnchor('resume', getSeenHW());
    renderChat();
  });
  window.addEventListener('smartOpenHealth', function () { openHealth(); });       // 건강 리마인더 탭 → 건강 탭 열기
  // v8.2(O-0158): 보내기가 연동 암호 문제로 막히면(틀림/없음) 암호 창 — 대화 동기화의 badpass 처리와 같은 방식
  window.addEventListener('smartBadPass', function (ev) {
    var need = !!(ev && ev.detail && ev.detail.need);
    if (!need) setSyncPass('');
    showSyncGate(true, need ? '보내려면 연동 암호가 필요합니다. 입력해 주세요.' : '암호가 맞지 않습니다. 다시 입력해 주세요.');
  });
  window.addEventListener('smartChatPush', function () {                          // 앱 열려 있을 때 수신 → 답 당겨오기
    startChatReconcile(); reconcileChat();
    loadOfficePushes();                                                           // 케이 방송 푸시일 수도 있으니 함께 확인
    loadChatSync();                                                               // 다른 기기에서 온 대화도 함께 확인
    setTimeout(function () { readPull(); }, 5000);                                // (O-0201) 다른 기기에서 바로 읽었으면 곧 숫자를 내린다(정기 조회 30초를 기다리지 않게)
  });
  // v9.1(O-0209): 「다른 기기(PC판)에서 읽음」 조용한 푸시 — 앱이 살아 있으면 읽음 기준을 바로 받아 홈 말풍선·위젯 수를 내린다.
  //   (알림 서랍·위젯은 네이티브 KClear 가 앱이 꺼져 있어도 내린다. 여기는 앱 화면의 숫자를 30초 기다리지 않게 하는 몫)
  window.addEventListener('smartReadClear', function () { readPull(); });
  /* ---- v7.7(O-0134) 안읽음 실시간 갱신 — 앱을 껐다 켜지 않아도 새 메시지가 바로 보이게 ----
   * 대표님 불편: 「채팅에 안 읽은 메시지가 있으면 앱을 껐다 켜야만 보인다」.
   * 원인: 채팅 화면 밖에서 케이 방송(loadOfficePushes)·다른 기기 대화(loadChatSync)를 받는 때가
   *   ① 앱 시작 ② 채팅 열기 ③ 앱이 앞에 떠 있을 때 푸시 수신 — 이 셋뿐이었다.
   *   · 앱이 뒤에 있을 때 온 푸시는 OS 알림으로만 가고(pushNotificationReceived 가 안 불림), 알림을 누르지 않고
   *     아이콘·최근 앱으로 돌아오면 아무것도 다시 받지 않았다.
   *   · 무푸시 방송(--no-push, 조용시간 --quiet-auto)·PC에서 나눈 대화는 푸시가 없어 앱 시작 때만 보였다.
   *   · 조회 하나가 멈추면 officeLoading 이 true 로 굳어 푸시가 와도 다시 안 받았다(→ 15초 타임아웃·45초 풀기로 해결).
   * 해법: 화면이 보이는 동안만 LIVE_INTERVAL 마다 조용히 받고, 앱이 앞으로 돌아온 순간·홈으로 돌아온 순간 즉시 한 번 받는다.
   *   화면이 꺼지거나 앱이 뒤로 가면 타이머를 멈춘다(배터리). 안읽음 계산·중복 방지·알림(notice) 제외·채팅 화면 즉시 읽음은
   *   기존 loadOfficePushes/loadChatSync 규칙 그대로(hasBroadcast·hasChatRow·isSeenTs).
   * 간격 30초 근거: 푸시가 오는 메시지는 푸시 수신·복귀 즉시 경로로 바로 뜨고, 이 타이머는 푸시 없는 메시지의 안전망이다.
   *   조회 2건(보통 빈 목록, 1KB 미만)이 30초마다 = 화면 켜진 1시간에 240건 — 서버·데이터 부담은 무시할 수준이고,
   *   LTE 무선 모듈이 한 번 깨면 수 초 켜져 있으므로 10초 이하로 줄이면 사실상 계속 켜진 상태가 돼 배터리를 먹는다. */
  var LIVE_INTERVAL = 30000, LIVE_MIN_GAP = 3000;   // 30초마다 · 복귀/홈 이벤트가 겹쳐도 3초 안엔 한 번만
  var liveTimer = null, liveLastAt = 0, liveAppActive = true, liveReady = false;
  function liveVisible() { return !document.hidden && liveAppActive; }
  function liveRefresh() {
    if (!liveReady || !liveVisible()) return;
    var now = Date.now();
    if (now - liveLastAt < LIVE_MIN_GAP) return;
    liveLastAt = now;
    readPull(function () {                         // (O-0201) 다른 기기에서 읽은 데까지 먼저 맞춘 뒤 새것을 센다(읽음 공유가 꺼져 있으면 곧바로 아래 실행)
      loadOfficePushes();                          // 케이 방송(새것만 — 세션 high-water 이후)
      loadChatSync();                              // 다른 기기(PC 등)에서 나눈 대화(암호 있을 때만)
    });
    if (anyAwaiting()) startChatReconcile();       // 보낸 질문의 답 기다리는 중이면 확인 재개
    try { ofPull(); } catch (e) {}                 // (O-0487) 케이 옷 기기 간 맞추기(작은 조회 한 건)
  }
  function startLive() { if (liveTimer || !liveVisible()) return; liveTimer = setInterval(liveRefresh, LIVE_INTERVAL); }
  function stopLive() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
  function liveForeground() { startLive(); liveRefresh(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopLive(); else liveForeground(); });
  if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
    try {
      Capacitor.Plugins.App.addListener('appStateChange', function (st) {
        liveAppActive = !!(st && st.isActive);
        if (liveAppActive) liveForeground(); else stopLive();
      });
    } catch (e) {}
  }
  liveReady = true; liveLastAt = Date.now();       // 방금 시작 때 한 번 받았으므로 첫 정기 조회는 30초 뒤
  startLive();
  if (window.SmartPush && SmartPush.init) { try { SmartPush.init(); } catch (e) {} }
  // M1: 버전 표시 — 대표님이 지금 보는 화면이 최신본인지 알 수 있게(특히 PC판 캐시 확인용)
  // v9.14: 버전은 맨 위 「스마트비서」 옆 작은 알약 하나로(예: v9.14) — 홈 맨 아래 흐린 한 줄은 찾기 어려웠다. 같은 일을 하는 자리는 하나만 둔다.
  //   VER_SPOT: 'top' = 맨 위 알약만(홈 맨 아래 줄은 떼어 냄) · 'bottom' = v9.13 처럼 홈 맨 아래 한 줄만
  var VER_SPOT = 'top';
  try {
    var _av = $('appVer'), _vt = $('appVerTop');
    if (VER_SPOT === 'bottom' || !_vt) { if (_av) _av.textContent = '스마트비서 ' + APP_VERSION; }
    else { _vt.textContent = APP_VERSION; if (homeFooter && homeFooter.parentNode) homeFooter.parentNode.removeChild(homeFooter); }
  } catch (e) {}
  setTimeout(function () { try { if (getSyncPass()) refreshOrders(true); } catch (e) {} }, 1500);   // v5.8: 시작 시 홈 「작업 현황」 숫자

  /* (O-0129) 홈 「오늘 한눈에」 카드(today-card.js)가 쓰는 창구 — 화면 이동·시트·초안만 넘긴다(데이터 쓰기 없음). */
  window.SmartHome = {
    getSyncPass: getSyncPass,
    needPass: function (msg) { showSyncGate(true, msg || ''); },   // v7.5(O-0130) 건강 탭 RPC 가 암호 없음/틀림일 때
    refreshOrders: function () { try { refreshOrders(true); } catch (e) {} },
    toast: function (msg, ms) { toast(msg, ms); },   // (O-0133) 일정 [길찾기] 안내
    openOrders: function (hlId) { openOrders(false, hlId || ''); },
    openReminders: function () { openReminders(); },   // (O-0176) 오늘 한눈에 「예약한 알림」 한 줄 → 목록·취소
    sheet: function (title, msg, label, icon, action) {
      openSheet(title, msg, label, action);
      if (sheetMsg) sheetMsg.classList.add('pck');   // 여러 줄(시각·장소·보낸 사람) 왼쪽 정렬로
      if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#' + (icon || 'i-chat')); }
    },
    draft: function (text) {                       // 채팅을 열고 입력창에 초안만 넣는다(보내지 않음 — 대표님이 다듬어 보내심)
      openChat();
      var ci = $('chatInput'); if (ci) { ci.value = text || ''; try { ci.dispatchEvent(new Event('input')); } catch (e) {} }
    },
    startVoiceSchedule: function () {              // 채팅 열고 음성 대화 시작 → 말씀하시면 PC 케이가 확인 문구 뒤 등록
      openChat();
      setTimeout(function () { try { startConvo(); } catch (e) {} }, 350);
    },
    // v8.2(O-0157) 다른 앱 [공유]로 받은 것(share-in.js) → 채팅 첨부 대기줄에 붙이고 채팅 열기(보내지 않음)
    shareToChat: function (o) {
      o = o || {};
      openChat();
      if (o.images && o.images.length) onChatCamPicked(o.images);
      if (o.files && o.files.length) onChatFilesPicked(o.files);
    },
    // v8.4(O-0162) 공유로 받은 녹음 파일 → 「회의록으로 정리」: 앱에서 녹음을 마친 것과 똑같은 「녹음 완료」 화면으로.
    //   제목 고치기·회의자료 붙이기·[PC로 보내 정리하기]·[임시 저장]이 그대로 쓰이고, 40MB 넘으면 조각 전송(긴 녹음과 같은 길).
    audioToMeeting: function (f) { audioToMeeting(f); },
    // v8.2(O-0157) 공유로 받은 문서 1개 → [문서 뷰어로 열기]
    openDocFile: function (f) {
      openScreen(docsView);
      if (window.SmartDocs && SmartDocs.handleLocalFile) { try { SmartDocs.handleLocalFile(f); } catch (e) { toast('문서를 여는 데 실패했습니다.'); } }
      else toast('문서 뷰어를 준비하지 못했습니다.');
    }
  };
  setTimeout(function () { try { if (window.TodayCard) TodayCard.refresh(true); } catch (e) {} }, 1600);
  syncHomeOn(); paintHomeGreet();                                  // v9.4 홈 큰 카드: 폴드 2단 표시 + 때에 맞는 인사 한 줄(앱을 켠 뒤 한 번)

  /* ==================== v8.3(O-0161) ⭐ 저장한 답 · ⏰ 예약한 알림 ====================
   * 둘 다 서버 표(k_stars·k_reminders)를 연동 암호 게이트 RPC 로만 읽고 쓴다(공개 키로 표 직접 접근 불가 — O-0158 원칙).
   *  · ⭐ 저장: 채팅 케이 말풍선 [⋯] → 「⭐ 저장」. 저장 표시는 말풍선 오른쪽 아래 ⭐. 목록은 홈 「저장한 답」·채팅 머리줄 ☆.
   *    목록에서 누르면 그 대화 자리로(안 불러온 옛 대화면 [이전 대화 더 보기]를 대신 눌러 가며 찾음).
   *  · ⏰ 예약: 등록은 케이(채팅·음성)가 한다. 이 화면은 목록·취소만(+ [케이에게 알림 부탁하기] = 음성 대화 바로 시작). */
  var KST_DOW = '일월화수목금토';
  function kstLabel(iso) {
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var d = new Date(t + 9 * 3600000), h = d.getUTCHours(), mi = d.getUTCMinutes();
    return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일(' + KST_DOW[d.getUTCDay()] + ') ' +
      (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function kstDayHint(iso) {                         // 「오늘」「내일」(한국 날짜 기준), 그 밖은 ''
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var day = function (ms) { var d = new Date(ms + 9 * 3600000); return d.getUTCFullYear() * 400 + d.getUTCMonth() * 32 + d.getUTCDate(); };
    var a = day(t), n = day(Date.now()), n1 = day(Date.now() + 86400000);
    return a === n ? '오늘' : (a === n1 ? '내일' : '');
  }
  function v83PassOrGate() {
    var p = getSyncPass();
    if (!p) showSyncGate(true);
    return p;
  }
  function v83Fail(e, bodyEl, what) {
    if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
    if (bodyEl) bodyEl.innerHTML = '<div class="empty-note">' + (e && e.notready ? '서버 준비가 아직 되지 않았습니다(저에게 알려 주세요).'
      : (e && e.badpass ? '연동 암호를 넣으면 ' + what + '이(가) 보입니다.' : what + '을(를) 불러오지 못했습니다. 잠시 뒤 새로고침을 눌러 주세요.')) + '</div>';
  }

  // ---------- ⭐ 저장 ----------
  function saveStarIds() { try { localStorage.setItem(STAR_IDS_KEY, JSON.stringify(starIds)); } catch (e) {} }
  var starIdsAt = 0;
  function refreshStarIds(force) {                    // 서버의 저장 목록으로 말풍선 ⭐ 표시를 맞춘다(여러 기기 일치)
    var p = getSyncPass();
    if (!p || !(window.OfficeBridge && OfficeBridge.listStars)) return;
    if (!force && Date.now() - starIdsAt < 60000) return;
    starIdsAt = Date.now();
    OfficeBridge.listStars(null, 500, p).then(function (rows) {
      var nx = {}; rows.forEach(function (r) { if (r && r.memo_id) nx[r.memo_id] = 1; });
      var changed = JSON.stringify(nx) !== JSON.stringify(starIds);
      starIds = nx; saveStarIds();
      if (changed && isOpen(chatView)) renderChat();
    }).catch(function () {});
  }
  function toggleStar(memoId, on) {
    var p = v83PassOrGate(); if (!p) return;
    if (on) starIds[memoId] = 1; else delete starIds[memoId];       // 먼저 화면에(낙관적), 실패하면 되돌림
    saveStarIds(); if (isOpen(chatView)) renderChat();
    OfficeBridge.setStar(memoId, on, p).then(function (ok) {
      if (!ok) throw new Error('NOT_SAVED');
      toast(on ? '⭐ 저장했습니다 — 채팅 맨 위 ☆ 「저장한 답」에서 모아 볼 수 있습니다.' : '저장을 풀었습니다.');
      if (isOpen($('starsView'))) loadStars();
    }).catch(function (e) {
      if (on) delete starIds[memoId]; else starIds[memoId] = 1;
      saveStarIds(); if (isOpen(chatView)) renderChat();
      if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
      else toast(e && e.notready ? '서버 준비가 아직 되지 않았습니다.' : (on ? '저장하지 못했습니다. 잠시 뒤 다시 해 주세요.' : '저장을 풀지 못했습니다.'));
    });
  }
  var starsFromChat = false, starsRows = [], starsQTimer = 0, starsSeq = 0;
  function openStars(fromChat) {
    starsFromChat = !!fromChat;
    openScreen($('starsView'));
    var q = $('starsQuery'); if (q) q.value = '';
    loadStars();
  }
  function loadStars() {
    var body = $('starsBody'); if (!body) return;
    var p = v83PassOrGate();
    if (!p) { body.innerHTML = '<div class="empty-note">연동 암호를 넣으면 저장한 답이 보입니다.</div>'; return; }
    var q = (($('starsQuery') || {}).value || '').trim(), seq = ++starsSeq;
    if (!starsRows.length) body.innerHTML = '<div class="empty-note">불러오는 중…</div>';
    OfficeBridge.listStars(q || null, 300, p).then(function (rows) {
      if (seq !== starsSeq) return;                  // 그사이 검색어가 바뀜
      starsRows = rows;
      if (!q) { var nx = {}; rows.forEach(function (r) { nx[r.memo_id] = 1; }); starIds = nx; saveStarIds(); starIdsAt = Date.now(); }
      renderStars(q);
    }).catch(function (e) { if (seq === starsSeq) v83Fail(e, body, '저장한 답'); });
  }
  function starPreview(s, n) { s = String(s || '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function renderStars(q) {
    var body = $('starsBody'); if (!body) return;
    if (!starsRows.length) {
      body.innerHTML = '<div class="empty-note">' + (q ? '“' + esc(q) + '”이(가) 들어간 저장한 답이 없습니다.'
        : '아직 저장한 답이 없습니다.<br>채팅에서 케이 답의 [⋯] → 「⭐ 저장」을 눌러 보세요.') + '</div>';
      return;
    }
    body.innerHTML = '<div class="ord-sec">' + (q ? '찾은 답' : '저장한 답') + ' <small>' + starsRows.length + '개 · 최근 저장순</small></div>' +
      starsRows.map(function (r) {
        var a = starPreview(r.content_md || (r.summary_json && r.summary_json.reply) || '', 220);
        var qn = r.src === 'chat' ? starPreview(r.note, 60) : '';
        return '<div class="card ord-item star-item" data-mid="' + esc(r.memo_id) + '">' +
          '<div class="oi-h"><span class="st-src">' + (r.src === 'push' ? '케이 소식' : '케이 답') + '</span>' +
          '<span class="oi-when">' + esc(kstLabel(r.ts)) + '</span></div>' +
          (qn ? '<div class="st-q">대표님: ' + esc(qn) + '</div>' : '') +
          '<div class="st-a">' + esc(a || '(첨부만 있는 답)') + '</div>' +
          '<div class="oi-foot"><button type="button" class="st-go">대화에서 보기 ›</button>' +
          '<button type="button" class="st-off" aria-label="저장 해제">☆ 저장 해제</button></div></div>';
      }).join('');
  }
  if ($('starsBody')) $('starsBody').addEventListener('click', function (ev) {
    var card = ev.target.closest ? ev.target.closest('.star-item') : null; if (!card) return;
    var mid = card.getAttribute('data-mid');
    if (ev.target.closest('.st-off')) {
      openSheet('저장을 풀까요?', '「저장한 답」 목록에서만 빠지고, 대화는 그대로 남습니다.', '저장 해제', function () {
        starsRows = starsRows.filter(function (r) { return r.memo_id !== mid; });
        renderStars((($('starsQuery') || {}).value || '').trim());
        toggleStar(mid, false);
      });
      if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-star'); }
      return;
    }
    jumpToRow(mid);
  });
  if ($('starsQuery')) $('starsQuery').addEventListener('input', function () {
    clearTimeout(starsQTimer); starsQTimer = setTimeout(loadStars, 350);
  });
  if ($('starsRefresh')) $('starsRefresh').addEventListener('click', loadStars);
  if ($('btnStars')) $('btnStars').addEventListener('click', function () { openStars(false); });
  if ($('chatStarsBtn')) $('chatStarsBtn').addEventListener('click', function () { openStars(true); });

  // 저장한 답 → 그 대화 자리로. 안 불러온 옛 대화면 한 쪽씩 더 불러오며 찾는다(최대 60쪽).
  function findKUidByRow(mid) {
    for (var i = 0; i < chatMsgs.length; i++) { var m = chatMsgs[i]; if (m.role === 'k' && rowIdOf(m) === mid) return msgUid(m); }
    return '';
  }
  function jumpToRow(mid) {
    starsFromChat = false;
    openChat();
    var tries = 0, pages = 0;
    toast('그 대화를 찾는 중입니다…', 1500);
    function land(uid) {
      chatJumpUid = uid; chatJumpUntil = Date.now() + 3500;
      renderChat();
      setTimeout(function () {
        var el = chatLog && chatLog.querySelector('[data-uid="' + uid + '"]');
        if (el) { el.classList.add('starhl'); setTimeout(function () { el.classList.remove('starhl'); }, 2600); }
      }, 120);
    }
    function step() {
      var uid = findKUidByRow(mid);
      if (uid) { land(uid); return; }
      if (tries++ < 12 && (!chatOlder || chatOlderBusy)) { setTimeout(step, 300); return; }   // 첫 쪽을 받는 중
      if (chatHasMore && pages < 60) { pages++; loadOlderChat(function (ok) { if (ok) step(); else notFound(); }); return; }
      notFound();
    }
    function notFound() {
      var r = null; for (var i = 0; i < starsRows.length; i++) if (starsRows[i].memo_id === mid) { r = starsRows[i]; break; }
      toast('대화에서 그 답을 찾지 못했습니다(이 기기에서 지웠을 수 있습니다).', 3200);
      if (r) {
        openSheet('저장한 답', starPreview(r.content_md, 600), '닫기', null, r.content_md || '');
        if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _x = sheetConfirm.querySelector('use'); if (_x) _x.setAttribute('href', '#i-x'); }
      }
    }
    setTimeout(step, 350);
  }

  // ---------- ⏰ 예약한 알림 ----------
  var REM_COUNT_KEY = 'smart_rem_count';
  function setRemBadge(n) {
    var b = $('remindersBadge'); if (!b) return;
    if (n > 0) { b.textContent = '예약 ' + n; b.style.display = ''; } else b.style.display = 'none';
    try { localStorage.setItem(REM_COUNT_KEY, String(n || 0)); } catch (e) {}
  }
  try { setRemBadge(parseInt(localStorage.getItem(REM_COUNT_KEY) || '0', 10) || 0); } catch (e) {}
  var REPEAT_KO = { daily: '매일', weekdays: '평일', weekly: '매주' };
  function openReminders() { openScreen($('remindersView')); loadReminders(); }
  function loadReminders() {
    var body = $('remindersBody'); if (!body) return;
    var p = v83PassOrGate();
    if (!p) { body.innerHTML = '<div class="empty-note">연동 암호를 넣으면 예약한 알림이 보입니다.</div>'; return; }
    if (!body.firstChild) body.innerHTML = '<div class="empty-note">불러오는 중…</div>';
    OfficeBridge.listReminders(p).then(renderReminders).catch(function (e) { v83Fail(e, body, '예약한 알림'); });
  }
  var remRows = [];
  function renderReminders(rows) {
    var body = $('remindersBody'); if (!body) return;
    remRows = rows || [];
    var act = remRows.filter(function (r) { return r.status === 'active' || r.status === 'sending'; })
      .sort(function (a, b) { return (Date.parse(a.fire_at) || 0) - (Date.parse(b.fire_at) || 0); });   // 서버도 정렬하지만 한 번 더
    var done = remRows.filter(function (r) { return !(r.status === 'active' || r.status === 'sending'); });
    setRemBadge(act.length);
    try { if (window.TodayCard && TodayCard.setReminders) TodayCard.setReminders(remRows); } catch (e) {}   // (O-0176) 오늘 한눈에 한 줄도 맞춤
    var h = '<div class="ord-sec">예약 중 <small>' + act.length + '개 · 가까운 순</small></div>';
    h += act.length ? act.map(function (r) { return remItemHtml(r, true); }).join('')
      : '<div class="empty-note">예약된 알림이 없습니다.<br>위 [말로 맡기기]를 누르고 “내일 아침 8시에 우산 챙기라고 알려 줘”처럼 말씀해 보세요.</div>';
    if (done.length) {
      h += '<div class="ord-sec">지난 알림 <small>최근 30일</small></div>' + done.map(function (r) { return remItemHtml(r, false); }).join('');
    }
    body.innerHTML = h;
  }
  function remItemHtml(r, active) {
    var rep = REPEAT_KO[r.repeat] || '';
    var st = active ? (kstDayHint(r.fire_at) ? '<span class="rm-day">' + kstDayHint(r.fire_at) + '</span>' : '')
      : (r.status === 'cancelled' ? '<span class="rm-st">취소함</span>' : (r.status === 'failed' ? '<span class="rm-st bad">보내지 못함</span>' : '<span class="rm-st ok">보냄</span>'));
    var when = active ? r.fire_at : (r.last_sent_at || r.fire_at);
    return '<div class="card ord-item rm-item' + (active ? '' : ' past') + '" data-rid="' + esc(r.id) + '">' +
      '<div class="oi-h"><span class="rm-when">' + esc(kstLabel(when)) + '</span>' + (rep ? '<span class="rm-rep">' + rep + '</span>' : '') + st + '</div>' +
      '<div class="oi-s">' + esc(r.body || '') + '</div>' +
      (active ? '<div class="oi-foot"><button type="button" class="rm-cancel">알림 취소</button></div>' : '') + '</div>';
  }
  if ($('remindersBody')) $('remindersBody').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.rm-cancel') : null; if (!b) return;
    var card = b.closest('.rm-item'), id = card && card.getAttribute('data-rid'), r = null;
    for (var i = 0; i < remRows.length; i++) if (remRows[i].id === id) { r = remRows[i]; break; }
    if (!r) return;
    openSheet('이 알림을 취소할까요?', kstLabel(r.fire_at) + (REPEAT_KO[r.repeat] ? ' · ' + REPEAT_KO[r.repeat] : '') + ' — 「' + (r.body || '') + '」', '알림 취소', function () {
      var p = v83PassOrGate(); if (!p) return;
      OfficeBridge.cancelReminder(id, p).then(function (ok) {
        toast(ok ? '알림을 취소했습니다.' : '이미 지나갔거나 취소된 알림입니다.');
        loadReminders();
      }).catch(function (e) {
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않습니다. 다시 입력해 주세요.'); }
        else toast('취소하지 못했습니다. 잠시 뒤 다시 해 주세요.');
      });
    });
  });
  if ($('remindersRefresh')) $('remindersRefresh').addEventListener('click', loadReminders);
  if ($('btnReminders')) $('btnReminders').addEventListener('click', openReminders);
  if ($('remindersAsk')) $('remindersAsk').addEventListener('click', function () { runShortcut('voice'); });

  /* ==================== v8.2(O-0157) 네이티브 연결(KBridge) ====================
   * 폰(APK v8.2+)에서만. PC판·옛 APK 는 KBridge 가 없어 아무것도 하지 않는다.
   *  ① 알림 [답장]이 쓸 대화방(thread)·서버 주소·공개 키를 네이티브에 알려 둔다(연동 암호는 넘기지 않음 — 필요 없음).
   *  ② 알림에서 보낸 답장(outbox)을 채팅에 「내 말풍선」으로 넣고, 케이 답을 평소처럼 기다린다.
   *  ③ 아이콘 길게 누르기 바로가기 · 위젯 · 내 알림 탭 → 해당 화면.
   *  ④ 바탕화면 위젯 = 홈 케이 말풍선과 같은 내용(안읽음 수·최근 안읽은 한 줄, 알림 notice 제외). */
  function kbPlugin() {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform() || !C.Plugins) return null;
    return C.Plugins.KBridge || null;
  }
  var WIDGET_HIDE_KEY = 'smart_widget_hide';
  function widgetHide() { try { return localStorage.getItem(WIDGET_HIDE_KEY) === '1'; } catch (e) { return false; } }
  var widgetSig = '', widgetT = 0, widgetFrom = Date.now() + 6000;   // 시작 직후 6초는 서버 조회가 끝나길 기다렸다가(빈 값으로 위젯을 지우지 않게)
  function pushWidget(now) {
    var KB = kbPlugin(); if (!KB || !KB.updateWidget) return;
    if (!widgetFrom) return;                       // 아직 이 블록이 실행되기 전(앱 시작 중) — 끝에서 한 번 부른다
    clearTimeout(widgetT);
    widgetT = setTimeout(function () {
      var n = chatUnseen > 0 ? chatUnseen : 0;
      var m = n ? kBubbleLatest() : null;
      var title = (n && $('kBubbleTitle')) ? ($('kBubbleTitle').textContent || '') : '';
      var line = n ? kBubblePreview(m) : '';
      var at = (m && m.ts) ? m.ts : 0;
      var hide = widgetHide();
      // v9.1(O-0209) maxts = 그 메시지의 「서버 시각」 — 방송·다른 기기 대화는 ts 가 곧 서버 시각, 이 기기에서 물은 답은 sts(아직 모르면 0).
      //   네이티브가 「다른 기기에서 읽음」 푸시를 받았을 때, 앱이 센 안읽음이 그 뒤의 것인지 견주는 데 쓴다(옛 APK 는 이 칸을 무시).
      var maxts = !m ? 0 : ((m.bid || m.cid) ? (readTsMs(m.sts || m.ts) || 0) : (readTsMs(m.sts) || 0));
      var sig = [n, title, line, at, hide, maxts].join('|');
      if (sig === widgetSig) return;                // 같은 값이면 보내지 않음(위젯 다시 그리기 최소화)
      widgetSig = sig;
      try { KB.updateWidget({ count: String(n), title: title, line: line, at: String(at || 0), hide: hide, maxts: String(maxts) }); } catch (e) {}
    }, now ? 0 : Math.max(800, widgetFrom - Date.now()));
  }
  function importNotifReplies() {
    var KB = kbPlugin(); if (!KB || !KB.takeOutbox) return;
    KB.takeOutbox().then(function (r) {
      var items = (r && r.items) || [], added = 0, failed = [], passFail = false;
      items.forEach(function (it) {
        if (!it) return;
        if (it.failed) { failed.push(String(it.text || '')); if (it.why === 'nopass' || it.why === 'badpass') passFail = true; return; }
        if (!it.id || !it.token || hasChatRow(it.id)) return;   // 이미 동기화로 들어왔으면 건너뜀
        chatMsgs.push({ role: 'me', text: String(it.text || ''), ts: Number(it.ts) || Date.now(), id: it.id, token: it.token,
                        answered: false, waitFrom: Date.now(), via: 'notif' });
        added++;
      });
      if (failed.length) {
        chatMsgs.push({ role: 'k', ts: Date.now(),
          text: '알림에서 보내신 답장 ' + failed.length + '건은 ' + (passFail ? '연동 암호 확인이 안 돼' : '인터넷 문제로') + ' 전송되지 않았습니다 — 「' + failed[0].slice(0, 40) + (failed[0].length > 40 ? '…' : '') + '」' + (failed.length > 1 ? ' 외' : '') + '. 필요하면 여기서 다시 보내 주세요.' });
      }
      if (added || failed.length) {
        sortChatByTime(); saveChatMsgs();
        if (isOpen(chatView)) renderChat();
        if (added) startChatReconcile();
      }
    }).catch(function () {});
  }
  // v9.8(O-0442): 켜질 때 한 번 — 네이티브에서 계속 돌던 회의 녹음이 있으면 되찾는다
  setTimeout(function () { try { recRecover(); } catch (e) {} }, 400);
  function kbSkipIntro() { try { if (window.KIntro && KIntro.active && KIntro.active()) KIntro.skip(); } catch (e) {} }
  function runShortcut(name) {
    kbSkipIntro();
    if (name === 'voice') {                        // 케이와 음성 대화 — 채팅 열고 바로 듣기 시작
      openChat();
      setTimeout(function () { try { startConvo(); } catch (e) {} }, 400);
    } else if (name === 'record') {                // 바로 녹음 시작(이미 녹음 중이면 녹음 화면으로)
      if (isRecording) { openScreen(recView); return; }
      showHome();
      if (btnRecord) btnRecord.click();
      // v9.8: 준비 화면이 실제로 열렸을 때만 이어서 시작한다 — 보내지 않은 녹음이 있어 그 화면으로 간 경우에는 새 녹음을 시작하지 않는다
      setTimeout(function () { if (btnStartRec && !isRecording && (!REC_ROAM_V2 || isOpen(recPrep))) btnStartRec.click(); }, 250);
    } else if (name === 'photo') {                 // 케이에게 사진 보내기 — 채팅 열고 사진 고르기 창
      openChat();
      setTimeout(function () {
        var ok = false;
        try { ok = !!(window.SmartNativePick && SmartNativePick('chatCam', 'image/*')); } catch (e) {}
        if (!ok) toast('아래 카메라 버튼을 눌러 사진을 골라 주세요.');
      }, 350);
    } else if (name === 'today') {                 // 홈 「오늘 한눈에」 카드로
      showHome();
      setTimeout(function () {
        var tc = $('todayCard');
        if (tc && tc.style.display !== 'none') { try { tc.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }
        else toast(getSyncPass() ? '오늘 한눈에를 불러오는 중입니다.' : '오늘 한눈에는 연동 암호를 넣으면 보입니다.');
      }, 700);
    }
  }
  function onKLaunch(ev) {
    if (!ev) return;
    if (ev.kind === 'shortcut') { runShortcut(ev.name); return; }
    if (ev.kind === 'rec') { kbSkipIntro(); recOpenFromNotif(); return; }   // v9.8: 회의 녹음 알림을 누름 → 녹음 화면(케이 답장 알림·대화는 건드리지 않는다)
    if (ev.kind === 'open') {                      // 위젯·[답장] 알림 탭
      kbSkipIntro();
      importNotifReplies();
      if (ev.screen === 'health') openHealth();
      else if (ev.screen === 'ideas') openIdeas();
      else openChat();
    }
  }
  (function initKBridge() {
    var KB = kbPlugin(); if (!KB) return;
    try { KB.setContext({ thread: chatThread, url: OfficeBridge.CONFIG.url, key: OfficeBridge.CONFIG.key, pass: getSyncPass() }); } catch (e) {}
    importNotifReplies();
    try { KB.addListener('launch', onKLaunch); } catch (e) {}
    try { KB.addListener('replySent', function () { importNotifReplies(); }); } catch (e) {}
    if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App) {
      try { Capacitor.Plugins.App.addListener('appStateChange', function (st) { if (st && st.isActive) importNotifReplies(); }); } catch (e) {}
    }
    pushWidget(false);
    // 「케이 꾸미기」 화면의 위젯 설정(폰에서만 보임)
    var row = $('kwWidgetRow'), cb = $('kwWidgetHide');
    if (row) row.style.display = '';
    if ($('kwWidgetSec')) $('kwWidgetSec').style.display = '';
    if (cb) {
      cb.checked = widgetHide();
      cb.addEventListener('change', function () {
        try { localStorage.setItem(WIDGET_HIDE_KEY, cb.checked ? '1' : '0'); } catch (e) {}
        pushWidget(true);
        toast(cb.checked ? '위젯에는 「새 소식 N건」만 보입니다.' : '위젯에 새 소식 한 줄이 보입니다.');
      });
    }
  })();
})();
