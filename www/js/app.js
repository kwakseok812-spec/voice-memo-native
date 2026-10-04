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
      toast('⚠️ ' + who + '은 너무 커서 뺐어요. 5GB까지 보낼 수 있어요.');
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
  var recIndicator = $('recIndicator'), recIndTime = $('recIndTime');   // 녹음 중 미니 배너(백그라운드 녹음 표시 · 2026-09-21)

  /* ---------- 유틸 ---------- */
  function show(el) { if (el) el.style.display = ''; }
  function hide(el) { if (el) el.style.display = 'none'; }
  function isOpen(el) { return el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'; }
  function scrollTop() { try { window.scrollTo(0, 0); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function setStatus(t, k) { if (statusText) statusText.textContent = t; if (statusDot) statusDot.className = 'dot ' + (k || 'idle'); }
  function setExportMsg(m, k) { if (exportMsg) { exportMsg.textContent = m || ''; exportMsg.className = 'exportmsg ' + (k || ''); } }
  function setProcessing(t) { if (processingText) processingText.textContent = t; }
  function showBanner(m) { if (banner) { banner.style.display = 'block'; banner.innerHTML = m; } }
  function hideBanner() { if (banner && RecordingModule.isSupported()) banner.style.display = 'none'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtSec(s) { s = Math.max(0, Math.floor(s)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
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
  var SUBS = [recPrep, recView, recordedPanel, filePanelRef(), searchPanelRef(), $('chatView'), $('lockerView'), $('meetingsView'), $('ideasView'), $('healthView'), $('docsView'), $('ordersView'), $('kWardrobeView'), $('remindersView'), $('starsView'), $('calcView'), processing, resultWrap];   // v6.0: kWardrobeView(케이 꾸미기)   // v5.5: ideasView(아이디어 수첩) 등록 · v5.8: ordersView(작업 현황)
  function filePanelRef() { return $('filePanel'); }
  function searchPanelRef() { return $('searchPanel'); }
  var homeFooter = $('homeFooter');
  function showHome() {
    if (window.SmartDocs && SmartDocs.leave) { try { SmartDocs.leave(); } catch (e) {} }   // 문서 뷰어 오버레이 닫기
    SUBS.forEach(hide); clearSearch(); show(homeView); scrollTop();
    if (homeFooter) homeFooter.style.display = '';       // 하단 안내문은 홈에서만
    updateRecIndicator();
    try { renderKBubble(); } catch (e) {}                 // (O-0117) 홈에 돌아오면 케이 말풍선 꼬리 위치·문구 다시 맞춤
    try { liveRefresh(); } catch (e) {}                   // v7.7(O-0134): 홈으로 돌아온 순간 새 방송·대화를 한 번 받아 말풍선 갱신
    syncConvoMode();                                      // (O-0124) 채팅을 떠나면 「스마트비서」 머리줄을 다시 보이게
    setTimeout(function () { try { if (getSyncPass()) refreshOrders(true); } catch (e) {} }, 300);   // v5.8: 홈 「작업 현황」 미완료 숫자
    try { if (window.TodayCard) TodayCard.refresh(true); } catch (e) {}   // (O-0129) 홈 「오늘 한눈에」 카드
  }
  function openScreen(el) {
    // 문서 뷰어(고정 오버레이)는 문서 화면으로 갈 때가 아니면 닫는다(다른 화면을 가리지 않게)
    if (window.SmartDocs && SmartDocs.leave && el !== $('docsView')) { try { SmartDocs.leave(); } catch (e) {} }
    hide(homeView);
    SUBS.forEach(function (x) { if (x !== el) hide(x); });
    if (el !== searchPanelRef()) clearSearch();
    show(el); scrollTop();
    if (homeFooter) homeFooter.style.display = 'none';   // 다른 화면에선 숨김
    updateRecIndicator();
    syncConvoMode();                                      // (O-0124) 음성 대화 중 채팅으로 돌아오면 무대 화면으로
  }
  /* 녹음 중 미니 배너: 녹음이 살아있는데 녹음 화면(recView)이 아닌 다른 화면에 있을 때만 보인다.
   * 녹음은 화면과 무관하게 네이티브 포그라운드 서비스로 계속되므로, 이 배너로 "녹음 중"을 계속 알리고
   * 탭하면 녹음 화면으로 돌아가 [정지]/[취소] 할 수 있다. */
  function updateRecIndicator() {
    if (!recIndicator) return;
    if (isRecording && !isOpen(recView)) recIndicator.style.display = 'flex';
    else recIndicator.style.display = 'none';
  }
  if (recIndicator) recIndicator.addEventListener('click', function () { openScreen(recView); });

  /* ---------- 녹음 ---------- */
  function startRecTimer() {
    recStart = Date.now();
    if (recTimerEl) recTimerEl.textContent = '00:00';
    if (recIndTime) recIndTime.textContent = '00:00';
    if (recInterval) clearInterval(recInterval);
    recInterval = setInterval(function () {
      var s = (Date.now() - recStart) / 1000;
      if (recTimerEl) recTimerEl.textContent = fmtSec(s);
      if (recIndTime) recIndTime.textContent = fmtSec(s);   // 미니 배너 시간도 함께 갱신
    }, 500);
  }
  function stopRecTimer() { if (recInterval) { clearInterval(recInterval); recInterval = null; } }

  if (!RecordingModule.isSupported()) {
    showBanner('⚠️ 이 브라우저는 녹음을 지원하지 않습니다. 갤럭시/안드로이드의 <b>Chrome</b>에서 열어 주세요.');
    if (btnRecord) { btnRecord.disabled = true; btnRecord.style.opacity = '.5'; }
  }

  var recorder = new RecordingModule({
    onStatus: function (s) {
      if (s === 'recording') setStatus('녹음 중', 'rec');
      else if (s === 'stopped') setStatus('녹음 완료', 'idle');
      else if (s === 'error') {
        setStatus('오류', 'err');
        // 녹음 시작 실패(네이티브 reject 등) 정리: 타이머 계속 돌아 혼란주지 않게 상태를 되돌리고
        //   녹음/준비 화면이면 홈으로 복귀(실패 안내 배너는 onError 가 이미 표시). — 2026-09-21
        if (isRecording) { isRecording = false; stopRecTimer(); updateRecIndicator(); }
        if (isOpen(recView) || isOpen(recPrep)) showHome();
      }
    },
    onLevel: function (v) { if (levelBar) levelBar.style.width = Math.round(v * 100) + '%'; },
    onError: function (m) { showBanner('⚠️ ' + m); },
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
      html = '<p class="empty" style="margin:4px 0">첨부한 회의자료가 없어요. (선택)</p>';
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
  var MAT_LIMIT_HINT = '자료가 길거나 많으면 자료 하나당 앞에서 약 2만 자, 모두 합쳐 약 6만 자까지만 요약에 반영돼요.';
  function openMatPicker() { if (matInput) matInput.click(); }   // 두 화면의 [회의자료 붙이기] 공용 — 바로 파일 선택 열림
  if (matAttach) matAttach.addEventListener('click', openMatPicker);
  if (matAttachPrep) matAttachPrep.addEventListener('click', openMatPicker);
  if (matInput) matInput.addEventListener('change', function () {
    var arr = keepSendable(this.files);          // v6.6: 회의자료 40MB → 5GB(File 그대로 스트리밍 업로드)
    var add = newMaterials(pendingMaterials, arr);
    pendingMaterials = pendingMaterials.concat(add);
    renderMatList();
    if (add.dup && !arr.removed) toast('이미 붙인 자료 ' + add.dup + '개는 다시 붙이지 않았어요.');
    this.value = '';
  });

  // 홈에서 녹음 오브 → 바로 녹음하지 않고 「준비 화면」으로(자료 첨부 + [녹음 시작])
  if (btnRecord) btnRecord.addEventListener('click', function () {
    if (btnRecord.disabled || isRecording) return;
    hideBanner();
    pendingMaterials = []; renderMatList();   // 준비 화면 진입 — 회의자료 첨부 새로 시작(녹음 전에도 붙일 수 있음)
    openScreen(recPrep);
    setStatus('녹음 준비 — 시작을 눌러 주세요', 'idle');
  });
  // 준비 화면의 [녹음 시작] → 이때 실제 녹음 시작(붙여둔 회의자료는 그대로 유지)
  if (btnStartRec) btnStartRec.addEventListener('click', function () {
    if (isRecording) return;
    if (!RecordingModule.isSupported()) { showBanner('⚠️ 이 브라우저는 녹음을 지원하지 않습니다.'); return; }
    hideBanner();
    recCancelled = false; isRecording = true;
    openScreen(recView); startRecTimer();
    recorder.start();
  });
  if (btnStop) btnStop.addEventListener('click', function () {
    if (!isRecording) return;
    isRecording = false; stopRecTimer();
    recorder.stop();   // → onAudio → onRecorded
  });
  if (btnCancelRec) btnCancelRec.addEventListener('click', function () {
    if (!isRecording) { showHome(); return; }
    recCancelled = true; isRecording = false; stopRecTimer();
    try { recorder.stop(); } catch (e) {}
    pendingBlob = null; pendingMaterials = []; showHome(); setStatus('대기 중', 'idle');
  });

  /* v8.4(O-0162) 다른 앱에서 공유받은 녹음 파일(통화 녹음·음성 녹음기 m4a·mp3·wav 등) → 회의록.
   *   앱 녹음이 끝났을 때와 같은 「녹음 완료」 화면(pendingBlob)에 올려 둔다 → 보내는 길(OfficeBridge.send / sendAudioChunked),
   *   PC 처리(collect.py·video_worker 전사·요약·회의자료 반영)는 앱 녹음과 완전히 같다. 화면 머리글·[다시 녹음] 글만 잠깐 바꾼다. */
  function recPanelMode(shared) {
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
    if (isRecording) { toast('지금 녹음 중이에요. 녹음을 마친 뒤 다시 공유해 주세요.', 3500); return; }
    hideBanner();
    pendingBlob = f; pendingMaterials = []; renderMatList();
    if (memoTitle) memoTitle.value = titleFromAudioName(f.name) || defaultTitle();
    var mb = (f.size || 0) / 1024 / 1024;
    if (recDoneBadge) recDoneBadge.textContent = '📎 공유받은 녹음 파일 · ' + (f.name || '녹음') + (mb ? ' · ' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + 'MB' : '');
    recPanelMode(true);
    openScreen(recordedPanel);
    setStatus('녹음 파일 — 제목 정하고 보내기', 'idle');
    toast('제목을 확인하고, 필요하면 회의자료를 붙인 뒤 [PC로 보내 정리하기]를 누르세요.', 4000);
  }
  function onRecorded(blob) {
    stopRecTimer(); isRecording = false;
    if (recCancelled) { recCancelled = false; pendingBlob = null; showHome(); return; }
    recPanelMode(false);                       // v8.4: 공유 파일 화면이었다면 원래 글로
    pendingBlob = blob;
    renderMatList();     // 준비 화면에서 붙인 회의자료를 그대로 이어받고, 완료 화면에서 더 붙일 수 있게(2026-09-21)
    if (memoTitle) memoTitle.value = defaultTitle();
    var durMs = (recorder && recorder.lastDurationMs) || 0;
    if (recDoneBadge) recDoneBadge.textContent = durMs > 0
      ? '✅ 녹음됐어요 · ' + fmtSec(durMs / 1000) + ' (' + Math.round(durMs / 1000) + '초)'
      : '✅ 녹음됐어요';
    openScreen(recordedPanel);
    setStatus('녹음 완료 — 제목 정하고 보내기', 'idle');
  }
  if (btnRetake) btnRetake.addEventListener('click', function () {
    pendingBlob = null; pendingMaterials = []; showHome(); setStatus('대기 중', 'idle');
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
    var blob = pendingBlob; pendingBlob = null; pendingMaterials = [];   // 자료는 memo 에 실었으니 초기화
    // 녹음이 길어 단일 업로드 한도(40MB)를 넘으면 → 조각 전송(백그라운드, 긴 영상과 동일 UX)
    if ((blob.size || 0) > OfficeBridge.CHUNK_SIZE) {
      sendChunkedAudioMemo(memo, blob);
      return;
    }
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending' });
    renderHistory();
    openScreen(processing); setProcessing('🖥️ PC로 보내는 중…');
    OfficeBridge.send(memo, blob).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' }); renderHistory();
      setProcessing('🖨️ PC에서 정리 중… 잠시만요 (처음엔 1~2분 걸릴 수 있어요)');
      startPolling(memo.id, memo.token);
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: friendlyErr(e) });
      renderHistory(); showHome();
      showBanner('⚠️ 전송 실패 — ' + esc(friendlyErr(e)) + '<br>녹음은 안전하게 보관됐어요 — <b>회의록</b> 맨 위 「진행 중」에서 다시 눌러 보세요.');
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
    OfficeBridge.saveDraft(rec).then(function (ok) {
      if (!ok) { showBanner('임시 저장에 실패했어요(저장 공간을 확인해 주세요). 녹음은 아직 화면에 있어요.'); return; }
      HistoryModule.add({ id: id, token: tok, title: title, date: t.date, time: t.time, status: 'draft', kind: 'audio' });
      pendingBlob = null; pendingMaterials = [];          // 저장 성공 후에만 비운다(실패 시 녹음 보존)
      renderHistory(); showHome(); setStatus('임시 저장됨', 'idle');
      toast('임시 저장했어요. 회의록 「진행 중」에서 자료를 붙여 보낼 수 있어요.');
    }).catch(function () { showBanner('임시 저장에 실패했어요. 녹음은 아직 화면에 있어요.'); });
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
      var html = '<div class="label" style="margin-top:0">제목 <span class="hint">(PC에 저장될 파일 이름이 돼요)</span></div>' +
        '<div class="input filled" style="margin-bottom:14px"><svg class="lead"><use href="#i-note"/></svg>' +
        '<input id="mDraftTitle" type="text" maxlength="40" value="' + esc(e.title || '') + '" ' +
        'placeholder="' + esc(draftDefaultTitle(e)) + '" enterkeyhint="done"></div>' +
        '<div class="card rcard"><div class="h"><svg><use href="#i-mic"/></svg>임시 저장된 녹음</div>' +
        '<div style="padding:2px 2px 0;line-height:1.6">' +
        '이 녹음은 폰에 임시 저장돼 있어요(<b>아직 PC로 안 보냈어요</b>).<br>' +
        '회의자료(선택)를 붙이고 <b>PC로 보내기</b>를 누르면 녹음+자료를 함께 정리해 드려요.<br>' +
        '<b>붙인 자료:</b> <span id="mDraftMatN">' + matN + '</span>개' +
        // v7.9: 개수만 보이던 것 → 이름 목록 + 하나씩 빼기(✕). 자료가 많아도 창이 길어지지 않게 3줄 남짓만 보이고 목록만 따로 스크롤.
        '<div id="mDraftMatList" data-id="' + esc(e.id) + '" style="margin-top:8px;max-height:150px;overflow-y:auto"></div>' +
        '<span id="mDraftMatHint" style="' + (matN ? '' : 'display:none') + '"><small>' + MAT_LIMIT_HINT + '</small></span>' +
        (e.error ? '<br><span style="color:var(--rec,#c0392b)"><b>지난번 보내기 실패:</b> ' + esc(e.error) + '</span>' +
                   '<br>다시 <b>PC로 보내기</b>를 누르면 이어서 보내요(이미 올라간 부분은 건너뜀).' : '') +
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
          '아직 PC로 보내지 않은 녹음이에요. 지우면 녹음과 붙인 자료를 되살릴 수 없어요.',
          '삭제', function () {
            modalOnClose = null; dirty = false;           // 지우는 항목에 제목을 다시 쓰지 않는다
            draftQ = draftQ.then(function () { return OfficeBridge.delDraft(e.id); }).catch(function () {});   // 쓰는 중인 제목·자료가 끝난 뒤 지운다(지운 뒤 되살아나지 않게)
            HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('임시 저장을 삭제했어요.');
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
          if (r === null) { toast('임시 저장을 찾지 못했어요.'); return; }
          if (!r) { toast('자료를 빼지 못했어요.'); b.disabled = false; return; }
          renderDraftMats(r);
          if (found) toast('자료를 뺐어요.');
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
      if (rec === null) { toast('임시 저장을 찾지 못했어요.'); return; }
      if (!rec) { toast('자료 붙이기에 실패했어요.'); return; }
      renderDraftMats(rec);
      if (!added) { toast('이미 붙인 자료예요. 다시 붙이지 않았어요.'); return; }
      toast('자료 ' + added + '개를 붙였어요.' + (dup ? ' (이미 붙인 ' + dup + '개는 뺐어요.)' : '') + ' [PC로 보내기]를 누르면 함께 정리돼요.');
    });
  });
  /* v6.4(2026-09-29) 실패 이유를 쉬운 말로 — 예전엔 이유 없이 "전송 실패 — 다시 보내세요"만 떠서
   *   무엇이 문제인지(인터넷? 파일? 서버?) 알 수 없었다(O-0085 「기획혁신처회의」). */
  function friendlyErr(e) {
    if (!e) return '알 수 없는 이유로 보내지 못했어요.';
    return String(e.friendly || e.message || e);
  }
  // 임시저장 발송 실패: 임시저장은 그대로 두고(유실 방지) 이유를 항목에 남기고 배너로 알린다.
  function draftSendFailed(id, err) {
    var why = friendlyErr(err);
    var tail = (err && err.reason === 'unreadable')
      ? ' 폰 저장 공간·앱 상태 문제일 수 있으니 이 항목은 지우지 마시고 소장에게 알려 주세요.'
      : ' 회의록 → 진행 중 → 이 항목 → <b>PC로 보내기</b>를 다시 누르면 이어서 보내요(이미 올라간 부분은 건너뜀).';
    HistoryModule.update(id, { status: 'draft', error: why }); renderHistory(); showHome();
    showBanner('⚠️ 전송 실패 — ' + esc(why) + '<br>임시 저장한 녹음은 폰에 그대로 있어요.' + tail);
    setStatus('전송 실패', 'err');
  }
  // 보내기는 됐지만 붙인 자료 중 못 붙인 것(너무 큼·읽기 실패 등)이 있으면 알려 준다(녹음은 정상 전송).
  function noticeSkippedMaterials(memo) {
    var sk = (memo && memo.materialsSkipped) || [];
    // v7.9: 긴 녹음을 다시 보냈는데 PC가 이미 정리를 시작한 뒤라 고친 제목·자료를 넣지 못한 경우(OfficeBridge resendEdit)
    var late = (memo && memo.resendEdit === 'too_late')
      ? '📎 녹음은 PC로 보냈어요. 다만 PC가 이미 이 녹음의 정리를 시작한 뒤라, 다시 보내면서 <b>고친 제목이나 새로 붙인·뺀 자료</b>가 있었다면 그건 반영되지 않았어요(처음 보낸 내용으로 정리돼요).'
      : '';
    if (!sk.length) { if (late) showBanner(late); return; }
    showBanner((late ? late + '<br>' : '') + '📎 녹음은 PC로 보냈어요. 다만 자료 ' + sk.length + '개는 함께 붙이지 못했어요:<br>' +
      sk.map(function (x) { return '· ' + esc(x.msg || x.name); }).join('<br>') +
      '<br>(큰 한글·PPT 파일은 PDF로 저장해 크기를 줄이면 붙일 수 있어요. 이 녹음은 자료 없이 정리돼요.)');
  }
  // 임시저장 → 실제 발송(대표님이 [PC 보내기]를 눌렀을 때만 실행). 기존 send/sendAudioChunked 재사용.
  //  실패 시: draft 는 그대로 두고(유실 방지), send 가 pending 에 남긴 잔재는 dropPending 으로 제거해 자동발송을 막는다.
  function resumeSendDraft(id) {
    draftQ.then(function () { return OfficeBridge.getDraft(id); }).then(function (rec) {   // 쓰는 중인 제목·자료가 끝난 뒤 읽는다
      if (!rec || !rec.blob) { showBanner('임시 저장한 녹음을 찾지 못했어요.'); renderHistory(); return; }
      var he = HistoryModule.get(id);                       // 고친 제목의 기준은 지난 메모 목록
      var title = (he && he.title) || rec.title || draftDefaultTitle(he || rec);
      var memo = { id: rec.id, token: rec.token, title: title, ext: rec.ext, date: rec.date, time: rec.time,
                   materials: rec.materials || [], matSlots: rec.matSlots };   // v7.9: 자료 저장 번호(없으면 순서대로)
      var blob = rec.blob;
      if ((blob.size || 0) > OfficeBridge.CHUNK_SIZE) {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' });
        videoProg[id] = '올릴 준비 중…'; renderHistory();
        OfficeBridge.sendAudioChunked(memo, blob, function (phase, done, total) { videoProg[id] = '올리는 중 ' + done + '/' + total + ' 조각'; renderHistory(); })
          .then(function () { OfficeBridge.delDraft(id); HistoryModule.update(id, { status: 'processing', error: null }); videoProg[id] = 'PC에서 정리 준비 중…'; renderHistory(); startVideoPolling(id, memo.token); noticeSkippedMaterials(memo); })
          .catch(function (err) { OfficeBridge.dropPending(id); delete videoProg[id]; draftSendFailed(id, err); });
        toast('긴 녹음은 조각으로 나눠 보내요. 홈 「진행 중인 메모」에서 상태를 볼 수 있어요.'); showHome();
      } else {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' }); renderHistory();
        openScreen(processing); setProcessing('🖥️ PC로 보내는 중…');
        OfficeBridge.send(memo, blob).then(function () {
          OfficeBridge.delDraft(id);
          HistoryModule.update(id, { status: 'processing', error: null }); renderHistory();
          setProcessing('🖨️ PC에서 정리 중… 잠시만요 (처음엔 1~2분 걸릴 수 있어요)');
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
          error: 'PC가 이 녹음을 받지 못했어요(전송이 서버까지 도달하지 못함). 다시 보내거나 삭제해 주세요.' });
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
          else toast('✅ 정리 완료 — 「회의록」에서 볼 수 있어요.');  // 홈 등에 있으면 방해 없이 알림만
          return;
        } else if (res.status === 'processing') {
          setProcessing('🖨️ PC에서 정리 중… 잠시만요');
        } else if (res.error) {
          setProcessing('처리 중 문제가 있었어요. 잠시 후 다시 시도돼요…');
        }
        // 포그라운드 대기화면 안내(1회) — 폴링은 멈추지 않는다(done/자동복구를 계속 감지해야 하므로).
        if (!bannerShown && isOpen(processing) && Date.now() - started > 5 * 60 * 1000) {
          bannerShown = true; showHome();
          showBanner('아직 정리 중이에요. PC가 켜져 있는지 확인하고, 잠시 후 <b>회의록</b>에서 다시 확인해 주세요.');
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
      (sum ? '<p>' + esc(sum) + '</p>' : '<p class="empty">핵심 문장을 찾지 못했어요.</p>') + '</div>';
    html += '<div class="card rcard todo"><div class="h"><svg><use href="#i-list"/></svg>할 일</div>' +
      checkList(sj.todos, '할 일로 보이는 내용이 없어요.', false) + '</div>';
    html += '<div class="card rcard dec"><div class="h"><svg><use href="#i-flag"/></svg>결정 사항</div>' +
      checkList(sj.decisions, '결정·합의로 보이는 내용이 없어요.', true) + '</div>';
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
    h += '<p class="savehint warn">폰에서는 <b>PDF</b>로 바로 보세요. Word·PPT는 PC(또는 오피스 앱)에서 열려요.</p>';
    return h;
  }
  function wireDocButtons(host, e) {
    Array.prototype.forEach.call(host.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () {
        var url = b.getAttribute('data-open');
        var w = window.open(url, '_blank');
        setExportMsg(w ? '새 탭에서 열었어요.' : '팝업이 막혔어요 — 다시 눌러 주세요.', w ? 'ok' : 'err');
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
  function openMeetings() {
    openScreen($('meetingsView'));
    showMeetingsList();
    renderHistory();                                 // (O-0176) 맨 위 「진행 중」·맨 아래 「이 폰에서 보낸 기록」은 암호 없이도(이 폰 기록)
    var host = $('meetingsList'); if (!host) return;
    if (!(window.OfficeBridge && OfficeBridge.listRecentMemos)) {
      host.innerHTML = '<p class="empty" style="padding:16px">이 기능을 아직 쓸 수 없어요(업데이트 필요).</p>'; return;
    }
    // 🔒 회의 요약은 민감정보 → 채팅·공유함과 동일한 PC 연동 암호 게이트(중복 UI 없이 기존 게이트 재사용).
    var pass = getSyncPass();
    if (!pass) {
      host.innerHTML = '<p class="empty" style="padding:16px">정리된 회의록을 보려면 PC 연동 암호가 필요해요.</p>';
      showSyncGate(true, '회의록을 보려면 PC 연동 암호를 입력해 주세요.');
      return;
    }
    host.innerHTML = '<p class="empty" style="padding:16px">불러오는 중…</p>';
    OfficeBridge.listRecentMemos(100, pass).then(function (rows) {
      meetingsRows = Array.isArray(rows) ? rows : [];
      renderMeetingsList();
    }).catch(function (e) {
      if (e && e.badpass) {                          // 암호 불일치/미설정 → 저장 암호 지우고 재입력 유도(기존 게이트)
        setSyncPass('');
        host.innerHTML = '<p class="empty" style="padding:16px">암호가 맞지 않아요. 다시 입력해 주세요.</p>';
        if (isOpen($('meetingsView'))) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.');
      } else {
        host.innerHTML = '<p class="empty" style="padding:16px">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>';
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
    if (!meetingsRows.length) { host.innerHTML = '<p class="empty" style="padding:16px">아직 정리된 회의록이 없어요. 녹음이 정리되면 여기에 쌓여요.</p>'; return; }
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
    html += '<div class="btnrow">' +
            '<button id="mtgRename" class="btn ghost sm"><svg><use href="#i-note"/></svg>이름 변경</button>' +
            '<button id="mtgDelete" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button>' +
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
    var rn = $('mtgRename'); if (rn) rn.addEventListener('click', function () { renameMeetingPrompt(idx); });
    var dl = $('mtgDelete'); if (dl) dl.addEventListener('click', function () { confirmDeleteMeeting(idx); });
    scrollTop();
  }
  // v5.3: 이름 변경 — 기존 modal 재사용(텍스트 입력). 서버 title 만 변경(PC 원본 무관).
  function renameMeetingPrompt(idx) {
    var r = meetingsRows[idx]; if (!r) return;
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, '이름을 변경하려면 PC 연동 암호를 입력해 주세요.'); return; }
    modalTitle.textContent = '이름 변경';
    var cur = r.title || '';
    var html = '<div class="card rcard"><div class="h"><svg><use href="#i-note"/></svg>표시 이름 바꾸기</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">앱에 보이는 <b>표시 이름</b>만 바뀌어요(PC에 저장된 원본 파일은 그대로예요).</div>' +
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
        if (!ok) { toast('이름을 바꾸지 못했어요(대상을 찾지 못함).'); return; }
        r.title = nt;                     // 로컬 캐시 갱신 → 목록·상세 즉시 반영
        closeModal(); renderMeetingsList(); openMeetingDetail(idx);
        toast('이름을 바꿨어요.');
      }).catch(function (e) {
        closeModal();
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
        else toast('이름 변경에 실패했어요. 잠시 후 다시 시도해 주세요.');
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
      '목록에서 사라져요. 소프트삭제라 서버 원본과 PC 파일은 남아 있어(복구 가능) 안심하셔도 돼요.',
      '삭제', function () {
        OfficeBridge.hideMemo(r.id, getSyncPass()).then(function () {
          meetingsRows.splice(idx, 1);          // 로컬 캐시에서 제거
          showMeetingsList(); renderMeetingsList();
          toast('삭제했어요.');
        }).catch(function (e) {
          if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
          else toast('삭제에 실패했어요. 잠시 후 다시 시도해 주세요.');
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
    else { badge = '정리중'; cls = 'b-proc'; }
    var vp = (videoProg && videoProg[e.id]) || '';
    var sub = (vp && e.status !== 'done') ? vp : (e.date || '');
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
        : '<div class="empty-note">지금 정리 중이거나 임시 저장한 녹음이 없어요.</div>';
      wireHistoryItems(mp);
    }
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
    } else if (e.status === 'draft') {
      openDraftModal(e);           // v3.8 임시저장 — 자료 붙이기 + [PC 보내기] + 삭제
    } else if (e.status === 'failed') {
      openFailedModal(e);          // 실패 항목도 눌러서 열림 — 사유 안내 + [다시 보내기]/[삭제] (2026-09-21)
    } else if (e.status === 'processing') {
      openProcessingModal(e);      // v5.1: 정리중 — 상태 안내 + [계속 기다리기]/[삭제](굳었을 때 직접 지울 수 있게)
    } else {
      openScreen(processing); setProcessing('🖨️ PC에서 정리 중… 잠시만요'); startPolling(id, e.token);
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
      '이 메모는 지금 PC에서 정리 중이에요.<br>' +
      '만약 <b>10분 넘게 계속 “정리 중”에서 멈춰</b> 있다면, 전송이 PC까지 닿지 못했을 수 있어요' +
      '(그럴 땐 잠시 뒤 자동으로 <b>실패</b>로 바뀌어 다시 보낼 수 있어요).<br>' +
      '지금 바로 정리하려면 아래 <b>삭제</b>로 이 항목을 지우고 다시 녹음해 보내 주세요.' +
      '</div></div>' +
      '<div class="btnrow">' +
      '<button id="mProcWait" class="btn primary"><svg><use href="#i-refresh"/></svg>계속 기다리기</button>' +
      '<button id="mProcDel" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button>' +
      '</div>';
    modalBody.innerHTML = html;
    $('mProcWait').addEventListener('click', function () {
      closeModal(); openScreen(processing); setProcessing('🖨️ PC에서 정리 중… 잠시만요'); startPolling(e.id, e.token);
    });
    $('mProcDel').addEventListener('click', function () {
      if (videoPollers[e.id]) { clearInterval(videoPollers[e.id]); delete videoPollers[e.id]; }
      delete videoProg[e.id];
      if (pollingId === e.id) stopPolling();
      OfficeBridge.dropPending(e.id);              // 남은 원본(있으면) 함께 정리
      HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('삭제했어요.');
    });
    modal.style.display = 'flex';
  }
  /* ---------- 전송 실패한 메모: 사유 안내 + 다시 보내기 + 삭제 (2026-09-21) ----------
   * 예전엔 실패 항목을 누르면 화면 변화 없이 조용히 재시도만 돌아 "눌러도 반응이 없다"고 느껴졌다.
   * 이제 항목을 누르면 모달로 사유를 보여주고, [다시 보내기](즉시 피드백)·[삭제](영영 갇히지 않게)를 준다. */
  function openFailedModal(e) {
    modalTitle.textContent = (e.title || '메모') + '  ·  ' + (e.date || '');
    var reason = e.error ? esc(e.error) : '인터넷 연결이 끊겼을 수 있어요';
    var html = '<div class="card rcard"><div class="h"><svg><use href="#i-flag"/></svg>전송 실패</div>' +
      '<div style="padding:2px 2px 0;line-height:1.6">' +
      '이 항목을 PC로 보내지 못했어요.<br><b>사유:</b> ' + reason + '<br><br>' +
      '📶 인터넷 연결(와이파이·데이터)과 PC가 켜져 있는지 확인하고 <b>다시 보내기</b>를 눌러 주세요.<br>' +
      '녹음·파일은 이 기기에 안전하게 보관돼 있어요.' +
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
        'PC로 보내지 못한 항목이에요. 지우면 폰에 보관된 녹음·파일도 함께 지워져 되살릴 수 없어요.',
        '삭제', function () {
          // v7.8: 보관 원본(IndexedDB pending)도 함께 지운다 — 남겨 두면 목록에서 지운 뒤에도 다음 앱 실행·인터넷 복귀 때
          //   flush() 가 그 녹음·파일을 PC로 자동 전송했다(지운 항목이 보내짐). [정리중] 삭제(mProcDel)와 같은 처리.
          OfficeBridge.dropPending(e.id);
          HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('삭제했어요.');
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
        showBanner('⚠️ 다시 보내기에 실패했어요. ' + (failErr ? esc(friendlyErr(failErr)) : '인터넷 연결과 PC 상태를 확인하고 잠시 후 다시 시도해 주세요.'));
      }
    }).catch(function () {
      if (!handled) { HistoryModule.update(id, { status: 'failed' }); renderHistory(); }
      showBanner('⚠️ 다시 보내기에 실패했어요. 인터넷 연결을 확인해 주세요.');
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
    pendingFiles = []; pendingKind = null;
    if (filePanelFromChat) { filePanelFromChat = false; openChat(); return; }   // (O-0176) 채팅 ＋ 에서 왔으면 채팅으로
    showHome();
  });
  if ($('fileSend')) $('fileSend').addEventListener('click', function () {
    if (!pendingFiles.length) { showHome(); return; }
    var files = pendingFiles, kind = pendingKind;
    var title = ($('fileTitle').value || '').trim();
    var note = ($('fileNote').value || '').trim();
    var isCard = kind === 'photo' && $('isCard') && $('isCard').checked;
    filePanelFromChat = false;                               // (O-0176) 보낸 뒤엔 홈(「진행 중인 메모」에서 상태 확인)
    pendingFiles = []; pendingKind = null;
    sendFiles(files, kind, title, note, isCard);
  });

  // 라우터: 영상 중 큰 것(>45MB)은 조각 전송(백그라운드), 나머지는 묶음 전송(포그라운드)
  var VIDEO_CHUNK_LIMIT = 45 * 1024 * 1024;
  function sendFiles(files, kind, title, note, isCard) {
    if (!files || !files.length) return;
    if (kind === 'video') {
      var big = [], small = [];
      Array.prototype.forEach.call(files, function (f) { ((f.size || 0) > VIDEO_CHUNK_LIMIT ? big : small).push(f); });
      if (small.length) sendBatchMemo(small, 'video', title, note, false);
      if (big.length) sendChunkedVideos(big, title, note);
      if (!small.length) showHome();
      return;
    }
    sendBatchMemo(files, kind, title, note, isCard);
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
    toast('긴 영상은 시간이 걸려요. 다른 일 하셔도 돼요 — 홈 「진행 중인 메모」에서 상태를 볼 수 있어요.');
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
    toast('긴 녹음은 조각으로 나눠 보내요. 다른 일 하셔도 돼요 — 홈 「진행 중인 메모」에서 상태를 볼 수 있어요.');
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
          toast((res.kind === 'audio' ? '🎙️ 긴 녹음 정리 완료' : '🎬 영상 정리 완료') + ' — 「회의록」에서 볼 수 있어요.');
        } else {
          if (res.progress_msg) { videoProg[id] = res.progress_msg; renderHistory(); }
          if (Date.now() - started > 3 * 60 * 60 * 1000) { clearInterval(videoPollers[id]); delete videoPollers[id]; }  // 최장 3시간
        }
      }).catch(function () {});
    }, 5000);
  }

  function sendBatchMemo(files, kind, title, note, isCard) {
    if (!files || !files.length) return;
    var t = now();
    var noteFull = note || '';
    if (isCard) noteFull = noteFull ? ('명함. ' + noteFull) : '명함';
    var memo = {
      id: OfficeBridge.uuid(), token: OfficeBridge.token(),
      title: title || ((kind === 'photo' ? '사진 ' : '영상 ') + t.date + ' ' + t.time),
      kind: kind, note: noteFull || null, date: t.date, time: t.time
    };
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending', kind: kind });
    renderHistory();
    openScreen(processing); setProcessing('⬆️ 올리는 중… (' + files.length + '개)');
    OfficeBridge.sendBatch(memo, files, function (done, total) {
      setProcessing('⬆️ 올리는 중… ' + done + '/' + total);
    }).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' }); renderHistory();
      setProcessing(kind === 'photo' ? '🖼️ 사진 분석 중… (명함이면 등록해요)' : '🎬 영상 분석 중… (조금 걸릴 수 있어요)');
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
      reviewFiles(this.files, 'photo');
      if (photoAsCard) {                                        // (O-0176) 채팅 ＋ 「명함 등록」 — 명함 스위치를 켠 채로(끄면 일반 사진 PC 정리)
        if ($('isCard')) $('isCard').checked = true;
        if ($('filePanelTitle')) $('filePanelTitle').textContent = '명함 등록 · 사진 PC 정리';
      }
    } else filePanelFromChat = false;
    photoAsCard = false; this.value = '';
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
  function openAttachMenu() {
    photoAsCard = false; filePanelFromChat = false;          // 지난번에 고르기를 취소했으면 남은 표시를 지움
    var old = document.querySelector('.atm-sheet'); if (old) { try { old.remove(); } catch (e) {} }
    var sh = document.createElement('div');
    sh.className = 'sheet shin-sheet atm-sheet';
    sh.innerHTML = '<div class="sheet-box" role="dialog" aria-label="보내기 고르기"><div class="sheet-head">무엇을 보낼까요?</div>' +
      '<button type="button" class="sheet-btn" data-atm="file"><svg class="atm-ic"><use href="#i-image"/></svg><span><b>파일·사진을 케이에게</b><small>채팅에 붙여 케이에게 보여 주기</small></span></button>' +
      '<button type="button" class="sheet-btn" data-atm="card"><svg class="atm-ic"><use href="#i-card"/></svg><span><b>명함 등록 · 사진 PC 정리</b><small>PC가 명함 대장에 넣거나 사진을 정리(명함 스위치로 고름)</small></span></button>' +
      '<button type="button" class="sheet-btn" data-atm="video"><svg class="atm-ic"><use href="#i-video"/></svg><span><b>영상 정리 (PC로)</b><small>긴 녹화도 조각으로 나눠 보내 PC가 요약</small></span></button>' +
      '<button type="button" class="sheet-btn atm-close" data-atm="close">닫기</button></div>';
    sh.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-atm]') : null;
      if (!b && ev.target !== sh) return;
      try { sh.remove(); } catch (e) {}
      var k = b && b.getAttribute('data-atm');
      if (k === 'file') $('chatFileInput').click();
      else if (k === 'card') { photoAsCard = true; filePanelFromChat = true; $('photoInput').click(); }
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
        else if (Date.now() - started > 60000) { stopSearchPoll(); setSearchMsg('시간이 걸려요. PC가 켜져 있는지 확인 후 다시 검색해 주세요.', 'err'); }
      }).catch(function () {});
    }, 2000);
  }
  function renderSearchResults(matches, count, q) {
    if (!matches.length) {
      setSearchMsg('', '');
      searchResults.innerHTML = '<div class="card"><p class="empty">🔍 <b>"' + esc(q) + '"</b> 결과가 없어요.<br>이름·기관의 <b>일부만</b> 넣어도 돼요. 예: 방부형 → 방부, 연성대학교 → 연성</p></div>';
      return;
    }
    setSearchMsg('', '');
    var html = '<div class="count"><b>' + count + '명</b> 찾았어요</div><div class="list">';
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
        else setSearchMsg('사진을 찾지 못했어요.', 'err');
      });
    }).catch(function () {
      btn.innerHTML = label; btn.disabled = false;
      setSearchMsg('사진을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.', 'err');
    });
  }
  function showCardPhotoModal(url) {
    modalTitle.textContent = '명함 사진';
    modalBody.innerHTML = '<div class="cardphotowrap"><img src="' + esc(url) + '" alt="명함 사진" class="cardphotoimg"></div>' +
      '<p class="savehint">닫으면 검색 결과로 돌아가요. 사진을 눌러 새 창에서 크게 볼 수 있어요.</p>';
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
  var APP_VERSION = 'v9.1';       // M1: 화면에 표시해 대표님이 최신본인지 알게 한다 (v9.1(O-0209): PC판에서 채팅을 읽으면 폰 앱을 열지 않아도 폰의 알림 서랍·앱 아이콘 숫자·바탕화면 위젯 수가 내려감 — PC 워커가 서버 읽음 기준(k_read_state)이 앞으로 간 것을 보고 「조용한 푸시」(data.k_clear, 화면에 아무것도 안 뜸)를 보내고, 폰(KClear)이 「읽은 시각까지」의 케이 답장 알림·채팅 화면 알림(꼬리표 kc|chat|시각)만 내림. 건강·아이디어 알림과 그 뒤에 온 알림은 그대로. 새 화면·버튼 없음. 옛 APK(v9.0 이하)에는 조용한 푸시를 보내지 않음(기기 표시 rclr). v9.0(O-0201): 읽음 기준 기기 간 공유 — 폰·PC판 어느 쪽에서든 채팅을 읽으면 다른 기기의 「새 메시지 N건」도 내려감(서버 한 줄 k_read_state · 연동 암호 RPC get_chat_read/mark_chat_read, 올리는 값은 서버가 메시지에 매긴 시각, 채팅을 실제로 보고 있을 때만 · PC판은 창 선택+최근 5분 내 조작, 서버 SQL 이 없거나 옛 APK 면 예전처럼 기기별 기준). 작업 카드·작업 현황의 결정 대기 항목에 [승인]·[수정 요청](채팅에 「#번호 승인」/「#번호 수정 요청: …」을 대신 보냄 — 새 서버 경로 없음, 승인은 확인 시트 한 번). 홈 「오늘 한눈에」 접힌 한 줄 — PC가 일정·메일을 못 불러온 날 「일정 0 · 메일 0」 대신 「못 불러왔어요」. v8.9(O-0189 긴급): 음성 대화가 말하는 중에 끊고 보내던 문제 — 폰 받아쓰기를 「이어 듣기」로(인식기가 스스로 끝내도 보내지 않고 다시 들으며 글을 이어 붙임), 보내는 때는 새 글자·큰 소리 없이 「말 끝 기다림」이 지났을 때·[다 말했어요]를 눌렀을 때·60초를 채웠을 때뿐. 말 끝 기다림 0.9초 → 기본 2초(무대 「기다림」 칩으로 짧게 1.2초/보통 2초/길게 3초, 이 기기에 저장), 녹음 경로도 같은 값(소음 적응 유지). 무대에 [다 말했어요 · 지금 보내기] 버튼. 끝난 이유·말한 길이를 PC 로그로(글 내용 아님). v8.8(O-0175·O-0176·O-0177·O-0178): 홈 정리 — 오늘 한눈에 아래를 「도구」 4칸×2줄(회의록·문서 뷰어·건강·계산기 / 공유함·아이디어·명함 검색·길찾기) + 「PC 연결」 두 줄(「Claude Code 연결」=PC 케이 대화방, 「PC 원격 제어」=크롬 원격 데스크톱, 문서 뷰어 편집 시트도 [PC 원격 제어 열기])로. 홈에서 작업 현황·예약한 알림·저장한 답 카드를 빼고 오늘 한눈에(「작업 현황 보기」 늘 보임·「예약한 알림」 한 줄·[말로 맡기기 (일정·알림)]·머리줄 눌러 접기 한 줄 요약)와 채팅 📋·☆ 로. 「지난 메모」+「회의 요약」 → 「회의록」(맨 위 「진행 중」 칸, 홈엔 진행 중인 것만·접기). 홈 사진·영상 보내기 칸 → 채팅 ＋ 고르기 창(케이에게 / 명함 등록·사진 PC 정리 / 영상 정리). 앱 서랍 「케이 음성」 아이콘 제거(바로가기 「음성 대화」는 그대로), 바로가기 「사진 보내기」→「케이에게 사진」. 계산기(O-0178) — 기본+공학용(삼각·역삼각·log·ln·거듭제곱·루트·n!·EXP·DEG/RAD·메모리·Ans), 직접 만든 계산 엔진(eval 없음), 계산 기록, [케이에게 묻기], 넓은 화면은 공학 자판 함께, 키보드 입력. 음성 대화 속도(O-0177) — 폰에서 바로 받아쓰기(KSpeech)·실시간 글자, 말 끝 판정 약 0.9초+소음 적응(vad.js), 조각 목소리 차례 재생(PC 스위치가 켜졌을 때), 케이 얼굴을 눌러 말 끊기. v8.7 까지: v8.7(O-0173·O-0174): 홈 「PC 화면」 카드 — 누르면 크롬 원격 데스크톱 앱이 바로 열림(없으면 플레이 스토어 안내, PC판은 원격 데스크톱 웹 새 탭, 문서 뷰어 [원격 화면 열기]와 같은 동작). 문서 뷰어 [✏️ 편집하기]를 워드·엑셀·PPT(doc·docx·xls·xlsx·ppt·pptx)에도 켬 — PC 편집 워커가 COM 으로 정확한 경로의 문서 창만 찾아 앞으로(다른 폴더 같은 이름 문서와 헷갈리지 않음, 엑셀·PPT 는 같은 이름이 열려 있으면 「(2)」 사본으로 엶). v8.6(O-0171·O-0172): 문서 뷰어 [✏️ 편집하기] — 한글(hwp·hwpx) 문서를 24시간 PC의 진짜 한글 프로그램으로 열어(창 최대화·맨 앞) 크롬 원격 데스크톱(삼성 DeX)으로 고치고 [저장] → [다 됐어요]로 고친 문서를 PDF·원본 파일로 돌려받음(채팅에도 첨부·푸시 없음). 원본은 PC 경로·사무소 서버 주소·폰 파일 순으로(최근 연 문서는 원본 다시 고르기). 연동 암호 확인 RPC로만 요청. [원격 화면 열기]=크롬 원격 데스크톱 앱(없으면 스토어), PC판은 원격 데스크톱 웹. 넓은 화면(900px↑)은 가운데 대화상자. 워드·엑셀·PPT 편집은 EDIT_ON_EXTS 한 줄로 켤 수 있음(PC 변환기가 켜 둔 Office 창을 닫던 문제는 O-0172로 고침). v8.5(O-0169): 홈 「오늘 한눈에」 날씨 줄 맨 앞에 「지금 21° 흐림」(앱이 Open-Meteo 를 직접 읽음 — 서울 시청 좌표만·키 없음, 홈이 보이는 동안 10분마다·열 때 3분보다 묵었으면 다시, 실패하면 PC 요약의 이번 시각 예보 「16시 21°」), 누르면 「오늘 날씨」 창 — 지금(크게)·남은 하루 우산·오늘 1시간 단위 가로 줄(지금 시각이 맨 왼쪽, 지난 시간은 흐리게, 저녁엔 내일 0~9시까지)·출퇴근 칸, 뒤로가기로 닫힘. v8.4(O-0162): 채팅 답을 기다리는 동안 점 세 개 옆에 「캘린더 확인 중…」처럼 케이가 지금 하는 일(PC 진행 표시) / 채팅 머리줄 케이 얼굴 옆 PC 상태 점(초록 정상·주황 바쁨·빨강 PC 응답 없음, 펼친 화면은 글자까지, 응답 없으면 맨 아래 안내) / 홈 「오늘 한눈에」 출퇴근 날씨·우산 한 줄(서울, 누르면 자세히) / 다른 앱에서 녹음 파일(통화 녹음 등)을 [공유]하면 [회의록으로 정리]·[케이에게 보내기] 고르기 — 회의록은 앱 녹음과 같은 화면·같은 정리 / 글자 크기 4단계(맨 위 「가가」·케이 꾸미기, 말풍선·입력창·홈 카드·문서 뷰어 글·엑셀 표). v8.3(O-0161): 말로 알림 예약 — 케이가 되읽어 확인 뒤 등록, 정한 시각에 앱 알림(PC 발송기·토큰 0), 홈 「예약한 알림」 목록·취소 / 앱 서랍 「케이 음성」 — 측면 버튼 두 번 누르기 → 바로 음성 대화 / 케이 답 [⋯] → ⭐ 저장, 홈·채팅 ☆ 「저장한 답」(검색·그 대화로·해제, 서버 저장) / 사무소 방송에 미리 붙인 케이 목소리 [▶ 듣기](아침 브리핑). v8.2: 어디서든 [공유] → 케이(O-0157) — 카톡 글·링크·사진 여러 장·파일을 공유하면 채팅에 첨부·본문이 채워져 열리고 빠른 칩 「요약해 줘」「답장 써 줘」「일정 잡아 줘」, 공유 문서 1개는 [문서 뷰어로 열기]/[케이에게 보내기] 고르기(「열기」는 예전처럼 곧장 뷰어). 케이 답장 알림에서 바로 [답장](앱을 안 열어도 됨, 잠금 해제 후에만, 자동 알림엔 버튼 없음). 아이콘 길게 눌러 음성 대화·녹음(바로 시작)·사진 보내기·오늘 한눈에. 바탕화면 케이 위젯 3종(한 줄·얼굴·카드, 스스로 깨어나지 않음, 「위젯에 내용 숨기기」). + 보안(O-0158): 채팅·사진·영상·명함검색·아이디어는 연동 암호 확인 RPC(submit_memo)로만 보냄 — 서버가 「확인됨」 표시를 남기고 PC는 그 표시를 확인. v8.1: 문서 뷰어 [케이에게 묻기·맡기기](O-0154) — 보던 문서를 쪽 번호·시트와 함께 케이 채팅으로(묻기 칩 3·맡기기 칩 2·직접 적기, 탭 2개 이상이면 열린 문서 함께 보내기), 엑셀은 원본·그 밖은 변환 PDF, PC 변환본이 서버에 있으면 다시 올리지 않음, 묻고 나와도 「이어서 보기」로 남음. v8.0: 문서 뷰어 여러 문서 탭(O-0153) — 보던 화면에서 [＋ 파일 더 열기]로 문서를 더 열면 탭(1·2·3…)으로 붙고, 탭을 누르면 보던 쪽·확대·회전·시트 그대로 왔다갔다. 최대 5개·같은 문서는 그 탭으로·여는 데 실패하면 보던 탭으로·탭 2개 이상 두고 나가면 고르기 화면 「열어 둔 문서 · 이어서 보기」. v7.9: 삭제 전 확인 — 임시저장·실패 항목을 지우기 전에 한 번 물어봄. 임시저장 창에 붙인 자료 이름 목록과 하나씩 빼기(✕). 재전송 시 자료 뒤바뀜 방지(자료마다 고정 저장 번호). 긴 녹음(조각 전송)을 다시 보낼 때 고친 제목·자료 반영(서버 update_pending_memo, PC가 조각을 다 받기 전까지 · 늦었으면 안내). 채팅·공유함 파일 이름 칩 — 폰에서 APK·압축·한글·오피스 파일은 크롬 대신 앱이 직접 저장(사진·영상·PDF는 그대로 열기). 다운로드 실패 사유 표시. 다운로드 멈춤 감지 10분 → 시작 대기 45초/진행 멈춤 2분. v7.8: 홈 「길찾기」 카드 — 누르면 네이버 지도 앱이 바로 열림(nmap://map, 앱 없거나 PC판이면 웹 지도). 임시저장을 다시 열어 제목 고치기 — 치는 동안엔 목록만, 녹음이 든 임시저장 쓰기는 입력을 마쳤을 때·보내기·창 닫힐 때 한 번, 비우면 기본 이름. 회의자료 중복 붙이기 방지·요약 상한 안내. 실패 항목을 삭제한 뒤에도 자동 전송되던 문제(삭제 시 dropPending). 「작업 현황」 화살표 위치. v7.7: 안읽음 실시간 갱신(O-0134) — 앱을 껐다 켜야만 새 메시지·홈 케이 말풍선이 보이던 문제. 화면이 보이는 동안 30초마다 케이 방송·다른 기기 대화를 조용히 받고, 앱 복귀·홈 복귀 즉시 한 번 받음, 화면 꺼짐·백그라운드면 멈춤. 방송·대화 조회 15초 타임아웃 + 굳은 '조회 중' 45초 뒤 풀기. 안읽음 계산·알림 제외·OS 알림/아이콘 배지는 그대로. v7.6: 홈 「오늘 한눈에」 일정 [길찾기](O-0133) — 장소가 기관·주소인 일정 옆 버튼 → 네이버 지도 앱 검색(nmap://search, 좌표·키 없음, [도착] 한 번 더 = 현재 위치 출발 대중교통), 앱 없으면 웹 지도, 방 이름만·온라인 회의는 버튼 숨김, PC판은 웹 지도. v7.5: 홈 「오늘 한눈에」(O-0129) — 녹음·케이 버튼 아래 카드 한 장: 오늘 일정(지금·다음 강조, 지난 일정은 접음)·답할 메일(제목·보낸 사람)·챙길 일(작업 현황 미완료, 확인 필요 먼저)+[말로 일정 잡기](채팅 열고 음성 대화). 일정·메일은 PC가 07~21시 매시 읽기 전용으로 만든 서버 요약(get_home_digest, 연동 암호), 할 일은 작업 현황 결과 재사용. 누르면 상세 시트→채팅 초안만(보내지 않음). + 건강기록 잠그기(O-0130) — 건강 탭 조회·저장과 푸시 토큰 등록을 연동 암호 게이트 RPC(health_list·health_upsert·push_token_register)로 옮김: 공개 키만으로는 건강기록·토큰을 읽거나 고칠 수 없게. 암호가 없으면 연동 암호 창, 폰에만 남은 값은 암호가 들어오면 올림. v7.4: 음성 대화 케이 무대(O-0124) — 「음성 대화」를 켜면 채팅 화면 위쪽 40%에 케이가 크게(말할 땐 talk 영상·들을 땐 idle, 기본머리 외·영상 실패는 정지 사진+끄덕임), 상태 줄 「듣는 중/답하는 중/말하는 중」, 대화 글은 무대 아래 상자에서 스크롤(위 가장자리 흐림), 음성 대화 중엔 맨 위 「스마트비서」 줄 접기, 키보드가 올라오면 무대 축소, 무대가 안 보이면 영상 정지·헤더 작은 얼굴 영상은 멈춤. 끄면 예전 화면 그대로. v7.3: 홈 「PC 케이에게 직접」 고침(O-0120) — 바로 claude.ai/code를 열어 새 클라우드 작업 시트가 뜨던 것을, 먼저 3줄 안내 시트(✕로 닫기 → Code 목록에서 PC 세션 고르기) + [Claude 앱 열기]로. 세션 제목·주소는 PC_K_* 상수 한 곳. v7.2: 통합 배포(O-0118) — 홈 케이 말풍선(O-0117, 숫자 배지 대신 「대표님, ○○」)·「문제」 표정 판정 좁히기 + 케이 전신 시작 인사(O-0116, 자막 멘트 13개·목소리 없음·설정 하루 첫 실행만(기본)/켤 때마다/끄기·[지금 보기]) + 꾸미기 전신 10벌(누르면 인사는 버건디만) + 네이티브 시작화면 다크(#070B1D) 통일 + 홈 「PC 케이에게 직접」(claude.ai/code 바깥으로 열기). v7.1: 글을 먼저 쓰면 첨부가 안 되던 문제 수정(O-0108) — 폰 입력 바의 ＋/카메라가 네이티브 파일 선택(NativeInput.pickFiles)으로 직접 골라 첨부 대기줄(window.SmartAttach)에 붙임·첨부만 보내기 가능·옛 APK는 예전 방식 + 채팅 긴 메시지 접기(O-0111) — 20줄 넘는 본문은 15줄까지만+아래 흐림+[전체 보기 ▼]/[접기 ▲], 펼친 상태는 다시 그려도 유지. v7.0: 채팅 개수 상한 없애기(O-0102) — 열 때 최신 150건(대화+방송 합쳐)만 빠르게 받고, 맨 위 [이전 대화 더 보기]로 첫 대화까지 끝없이 이어 보기(서버 list_chat_page 쪽 조회·연동 암호 잠금), 검색은 [옛 대화까지 모두 찾기]로 전체에서, 한 기기서 지운 방송은 다른 기기에서도 안 보이게(서버 숨김 제외). 서버 SQL 미적용이면 예전 방식으로 자동. v6.9: 문서 뷰어 — 큰 문서 올리기가 끊기지 않게(O-0097: 조각마다 진행률·멈춤 감시·자동 재시도, 조각이 다 올라간 뒤에만 PC에 요청, [다시 시도]는 이어서 올리거나 이미 변환된 결과를 바로 엶), 기다림은 PC가 변환을 시작한 뒤부터(작은 문서 5분·큰 문서 10분, 단계·경과 표시) + 「최근 연 문서」(O-0098: 이 기기에 변환본 보관 → 다시 열 때 변환 없이 바로, 지난번 본 쪽부터, 즐겨찾기·지우기·모두 비우기, 최대 1GB·40개 넘치면 오래 안 연 것부터 자동 정리). v6.8: 상단 고정 머리줄의 판 제거(O-0089) — 폰에서 v6.6 헤더가 앱 배경 위에 단색 네모 판으로 떠 보이고 상태바 덮개가 위 앱 제목을 가리던 문제. 머리줄은 투명, [뒤로]·오른쪽 버튼만 알약으로 떠 있고, 스크롤하면 제목·케이 이름표도 알약 배경. 상태바 덮개 삭제·blur 없음. v6.7: 폰 [⬇ 다운로드] 실제 저장(O-0088) — 안드로이드 WebView 는 blob <a download> 를 저장하지 못해 「저장했어요」만 뜨고 파일이 없던 문제. 폰은 네이티브 FileDownload(DownloadManager)로 「다운로드」 폴더에 실제 저장·저장 확인 뒤에만 성공 안내·APK 는 설치 화면으로(처음 한 번 「이 출처 허용」)·실패 시 웹페이지로 받기 자동 전환. 채팅·공유함 공통, PC판은 그대로. v6.6: 파일 크기 상한 5GB 통일(O-0086) — 회의자료 40MB·사진 45MB·채팅 사진 45MB(말없이 뺌)를 5GB로, 상한 없던 영상·채팅 파일·문서 뷰어·공유함도 같은 5GB(OfficeBridge.MAX_UPLOAD_BYTES 하나), 넘으면 「5GB까지 보낼 수 있어요」 안내, 사진 미리보기는 통째 읽기(readAsDataURL) 대신 주소(createObjectURL)로. 「공유/열기」로 넘어온 문서는 네이티브 60MB 유지+앱 안에서 고르는 길 안내. + 모든 서브 화면 상단(뒤로 버튼·제목) 고정(O-0087, 채팅과 같은 방식). v6.5: 회의 요약 시각 한국시간화(O-0085) — 서버 created_at(UTC)을 잘라 쓰던 탓에 11:45 가 02:45 로, 한국 00~09시 녹음은 날짜가 하루 전으로 보이던 문제 수정(kstParts, +9 고정). 목록 카드는 시각 대신 녹음 길이('녹음 · 1시간 40분', 모르면 '녹음')를 표시, 상세는 한국 일시+길이 칩. v6.4: 녹음 재전송 수정(O-0085) — 서버가 '이미 있음'을 400+statusCode 409 로 줘서 재전송이 회의자료 mat_0 에서 죽던 문제 해결(중복=성공), 녹음 조각은 먼저 읽고 올림·재전송은 PC가 받은 조각부터 이어서, 못 붙인 자료(너무 큼·읽기 실패)는 빼고 녹음은 보냄+안내, 실패 이유를 쉬운 말로 표시, 회의자료 저장 확장자 추정(pdf·hwp 등, 모르면 bin). v6.3: 공유함 큰 파일·파일명·실패안내 — 한 번에 올리는 한도를 서버 전역 한도(계획 5GB)로, 진행률 %, 실패 시 이유(용량/인터넷/파일 읽기/서버/권한)를 쉬운 말로 말풍선에 표시하고 파일은 보낼 칸에 되돌려 둠, 폴더 드래그는 걸러 안내, 저장 키 확장자 영문·숫자만(한글 확장자 InvalidKey 방지 — 채팅·문서·회의자료 업로드 공통), 다운로드는 원래 이름 그대로. v6.2: 긴생머리(h02) × 옷 10벌 조합 idle 반복영상(서버 catalog 의 combos[].idle, 없으면 정지 사진). v6.1: 케이 머리 스타일 10종 — 「케이 꾸미기」 옷/머리 탭, 지금 옷 × 머리 조합 사진(서버 공개 버킷 kchar/catalog.json, 실패·오프라인이면 번들 옷장+기본머리로 폴백), [＋ 추가 요청]. v6.0: 소장 「케이」 캐릭터 1차 — 채팅 케이 말풍선 원형 아바타(연속은 첫 칸만)+이름, 헤더 작은 얼굴+「케이 · 소장」→프로필 카드, 홈 「소장 K」 버튼 안 얼굴, idle/talk 반복영상(저전력·실패 시 정지사진), 답장 키워드별 표정, 옷장 「케이 꾸미기」(wardrobe.json 데이터 기반·로컬 저장), 목소리 선택(기본=PC 무료 선희 / 기기 내장 한국어 음성), 「듣기」는 말풍선 아래 줄. v5.9: 채팅 열림 위치 — 열 때·알림 탭·앱 복귀 시 첫 안읽음 메시지의 '시작'에서 열기(없으면 맨 아래), 「여기부터 새 메시지」 구분선, 보는 중 새 메시지는 맨 아래 근처일 때만 그 시작으로 부드럽게·위로 읽는 중이면 위치 유지, 내가 보낸 직후는 맨 아래. + 「작업 현황」 끝난 일 지우기 — 완료·취소·실패·보류 카드마다 [지우기], 「최근 끝난 일」 [모두 지우기](완료·취소만), 맨 아래 [지운 항목 다시 보기]. 지우기=서버 숨김 표시(hidden_at)만, 기록 원본·PC 지시 대장은 그대로. 확인은 앱 시트. v5.8: 채팅 「오퍼스 5.5」 1회 지정(켜고 보낸 그 1건만 meta.model_pref='opus' → PC 케이가 오퍼스 5.5로 처리, 보내면 자동으로 꺼짐 · 웹·네이티브 입력 둘 다) + 「작업 카드」(내 메시지 아래 대장 번호·상태·결과·처리 모델, 자동 갱신) + 「작업 현황」 화면(미완료·최근 완료, 창구 표시) — PC 지시 대장의 서버 사본 office_orders 를 연동암호 게이트 RPC로 조회. v5.7: 「회의 요약」 한눈 요약 — summary_json.brief(요약 v3)면 한 줄 결론을 크게+핵심/교수피드백/결정/할 일(담당·기한 칩)/미결 섹션 구분+상세 접힘, 숫자·날짜 굵게, 잡음 '자주 나온 단어' 숨김. brief 없는 옛 요약은 기존 표시 그대로. v5.6: 💡 아이디어 알림 즉시화 — 밤/낮 분기 제거, 항상 '보냈습니다 — 몇 분 안에 제안서를 보내드릴게요'(워커가 조용시간 없이 즉시 발송하도록 바뀐 데 맞춤). v5.5: 💡 아이디어 수첩 → 활용 제안(큰 버튼 즉시 녹음·글 입력·제안서 목록·갈래 태그 필터·[진행해줘]/[보류]). v5.4: 채팅 말풍선의 「🔔 알림」 딱지·호박색 테두리 표시 제거 — 알림 메시지도 일반 대화처럼 보임(메시지 자체·안읽음 카운트 제외는 그대로). v5.3=회의 요약 이름변경·삭제, v5.2=배지 클리어+회의 요약 탭, v5.1=안전 업로드.)
  // ── 음성 대화(핸즈프리) + 카메라 상태 ──
  //  기본은 "조용한 텍스트": 말/글로 물어도 답은 글로만. 음성 답은 (1) 각 답의 [듣기](온디맨드)
  //  또는 (2) 「음성 대화 모드」를 켰을 때만 → 그때만 speak 요청(평소 mp3 미생성 = 낭비 없음).
  var chatPendingImages = [];               // 케이에게 보여줄 사진(전송 전 대기)
  var chatPendingFiles = [];                // 첨부 파일(문서 등, 전송 전 대기) — 일반 메신저처럼 붙여두고 계속 입력
  var chatRecording = false, chatRecorder = null;
  var kaiAudio = null, kaiAudioUnlocked = false, playingBubbleEl = null, silentWavCache = null;
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
    toast('말 끝 기다림: ' + ENDWAIT[endWaitMode].name + '(' + ENDWAIT[endWaitMode].sec + ') — 말을 멈추고 이만큼 지나면 보내요.');
  }

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
      chatOpusHint.textContent = opusNext ? '다음에 보내는 1건을 오퍼스 5.5로 처리해요' : '중요 작업일 때만 켜고 보내세요';
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
        kaiAudio.addEventListener('ended', function () {
          if (playingBubbleEl) { playingBubbleEl.classList.remove('playing'); playingBubbleEl = null; }
          if (vqHasMore()) { vqPump(); return; }  // O-0177 ①: 다음 목소리 조각이 이미 와 있으면 곧장 이어서
          if (convoOn && vqWaiting()) { setConvoStatus('케이가 답하는 중…'); return; }   // 다음 조각을 아직 만드는 중
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
    try {
      a.src = silentWav();
      var p = a.play();
      if (p && p.then) p.then(function () { try { a.pause(); a.currentTime = 0; } catch (e) {} kaiAudioUnlocked = true; }).catch(function () {});
      else kaiAudioUnlocked = true;
    } catch (e) {}
  }
  function playKaiVoice(url, bubbleEl) {
    var a = ensureKaiAudio(); if (!a || !url) return;
    try {
      if (playingBubbleEl && playingBubbleEl !== bubbleEl) playingBubbleEl.classList.remove('playing');
      a.src = url; a.currentTime = 0;
      if (bubbleEl) { playingBubbleEl = bubbleEl; bubbleEl.classList.add('playing'); }
      var p = a.play();
      if (p && p.then) p.catch(function () {
        if (bubbleEl) bubbleEl.classList.remove('playing'); playingBubbleEl = null;
        if (vqHasMore()) { setTimeout(vqPump, 150); return; }   // O-0177: 조각 하나가 막혀도 다음 조각으로
        if (convoOn && vqWaiting()) return;
        if (convoOn) scheduleNextListen(900);   // 자동재생 막혀도 대화 루프는 이어감
        else toast('🔊 소리를 들으려면 "듣기"를 눌러 주세요.');
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
    if (playingBubbleEl) { playingBubbleEl.classList.remove('playing'); playingBubbleEl = null; }
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
          ? { role: 'me', text: m.text, ts: m.ts, id: m.id, token: m.token, answered: !!m.answered, files: m.files || null, up: !!m.up, vin: !!m.vin, uid: m.uid || null, cid: m.cid || null, rid: m.rid || null, remote: !!m.remote, opus: !!m.opus, waitFrom: m.waitFrom || null, via: m.via || null }
          : { role: 'k', text: m.text, ts: m.ts, files: m.files || null, bid: m.bid || null, vurl: m.vurl || null, uid: m.uid || null, notice: !!m.notice, cid: m.cid || null, rid: m.rid || null, vtts: !!m.vtts, vplayed: !!m.vplayed }; });   // v8.3: vtts·vplayed
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
  function attachChips(files, isUp) {
    if (!files || !files.length) return '';
    return '<div class="attachlist">' + files.map(function (f) {
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
      toast(openInBrowserForDownload(url, fname) ? '웹페이지로 연결했어요 — 거기서 받아 주세요.' : '다운로드에 실패했어요 — 다시 눌러 주세요.', 4000);
      return;
    }
    if (dlBusy[url]) { toast('이미 받는 중이에요 — 알림창에서 진행을 볼 수 있어요.', 3000); return; }
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
        toast('다운로드 폴더에 저장했어요(' + saved + '). 설치하려면 「이 출처 허용」을 켜고 돌아오세요 — 설치 화면을 바로 열어 드릴게요.', 7000);
      } else if (how === 'opened') {
        toast('다운로드 폴더에 저장했어요(' + saved + ')' + (isApk ? ' — 설치 화면을 열었어요.' : '.'), 4000);
      } else {
        toast('다운로드 폴더에 저장했어요(' + saved + '). 「내 파일 › 다운로드」에서 열어 주세요.', 5000);
      }
    }).catch(function (e) {
      delete dlBusy[url];
      if (e && e.code === 'CANCELLED') { toast('다운로드를 취소했어요.'); return; }
      // 앱 저장이 안 되면 ① 웹페이지로 받기로 자동 전환(서버 파일은 그대로라 브라우저로는 받아진다)
      //   v7.9: 왜 안 됐는지도 함께 알린다(예전엔 사유를 버렸다).
      var why = dlFailReason(e);
      toast(openInBrowserForDownload(url, fname) ? why + ' — 웹페이지로 연결했어요. 거기서 받아 주세요.' : why + ' — 다시 눌러 주세요.', 8000);
    });
  }
  // 설정에서 「이 출처 허용」을 켜고 앱으로 돌아오면 → 받아 둔 APK 설치 화면을 한 번 더 연다(다시 받지 않음)
  function retryPendingInstall() {
    if (dlPendingInstall == null) return;
    var FD = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FileDownload;
    var id = dlPendingInstall; dlPendingInstall = null;
    if (!FD || !FD.open) return;
    FD.open({ id: String(id), mime: APK_MIME, askPermission: false }).then(function (r) {
      if (r && r.open === 'opened') toast('설치 화면을 열었어요.', 3000);
      else if (r && r.open === 'need_permission') toast('「이 출처 허용」이 아직 꺼져 있어요. 켠 뒤 [⬇ 다운로드]를 다시 눌러 주세요(파일은 다운로드 폴더에 있어요).', 7000);
      else toast('파일은 다운로드 폴더에 있어요 — 「내 파일 › 다운로드」에서 눌러 설치해 주세요.', 6000);
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
    if (!w) toast('파일을 열지 못했어요 — 다시 눌러 주세요.');
  }
  // v7.9 네이티브 저장 실패 사유(FileDownloadPlugin 의 오류 코드) → 쉬운 말. 괄호 안 코드는 소장에게 알려 줄 때 쓴다.
  //   FAILED_n 의 n = 안드로이드 DownloadManager 사유(1000번대) 또는 서버 응답 번호(HTTP), WAITING_n = 시작 전 대기 사유.
  function dlFailReason(e) {
    var code = String((e && e.code) || ''), m, n, why;
    if ((m = /^FAILED_(\d+)$/.exec(code))) {
      n = +m[1];
      why = n === 1006 ? '폰 저장 공간이 부족해요'
        : (n === 1001 || n === 1007 || n === 1009) ? '폰에 파일을 쓰지 못했어요'
        : (n === 1004 || n === 1008) ? '받는 중에 인터넷이 끊겼어요'
        : (n === 403 || n === 400 || n === 404 || n === 410) ? '파일 주소가 만료됐거나 서버에 파일이 없어요'
        : (n >= 500 && n < 600) ? '서버가 잠시 응답하지 않아요'
        : '받는 중에 문제가 생겼어요';
    } else if ((m = /^WAITING_(\d+)$/.exec(code))) {
      n = +m[1];
      why = n === 2 ? '인터넷 연결을 기다리다 시작하지 못했어요'
        : n === 3 ? '큰 파일이라 폰이 와이파이를 기다리다 시작하지 못했어요'
        : '폰이 다운로드를 시작하지 못하고 대기만 했어요';
    } else {
      why = code === 'STALLED' ? '받다가 2분 넘게 멈춰 있었어요'
        : code === 'INCOMPLETE' ? '파일이 끝까지 받아지지 않았어요'
        : code === 'BAD_URL' ? '파일 주소가 올바르지 않아요'
        : (code === 'NO_DM' || code === 'ENQUEUE_FAIL') ? '폰이 다운로드를 시작하지 못했어요'
        : code === 'QUERY_FAIL' ? '다운로드 상태를 확인하지 못했어요'
        : '앱에서 저장하지 못했어요';
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
        toast('다운로드 폴더에 저장했어요.');
      })
      .catch(function () {
        // 폴백: 브라우저로 열어 저장(공유함 공개 주소면 원래 이름으로 — openInBrowserForDownload)
        var w = openInBrowserForDownload(url, fname);
        toast(w ? '브라우저에서 저장해 주세요.' : '다운로드에 실패했어요 — 다시 눌러 주세요.');
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
      navigator.clipboard.writeText(text).then(function () { toast('복사됐어요.'); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta); toast(ok ? '복사됐어요.' : '복사하지 못했어요. 글자를 길게 눌러 직접 복사해 주세요.');
    } catch (e) { toast('복사하지 못했어요. 글자를 길게 눌러 직접 복사해 주세요.'); }
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
    news:    ['대표님, 보고드릴 게 하나 있어요', '대표님, 새 소식 하나 가져왔어요', '대표님, 전해 드릴 말씀이 있어요'],
    done:    ['대표님, 맡기신 일 끝났어요!', '대표님, 말씀하신 일 마쳤어요!'],
    ask:     ['대표님, 확인해 주실 게 있어요', '대표님, 여쭤볼 게 하나 있어요'],
    problem: ['대표님, 말씀드릴 문제가 있어요', '대표님, 잠깐 보셔야 할 일이 생겼어요'],
    many:    ['대표님! 새 메시지 {n}건이 와 있어요', '대표님, 읽지 않으신 메시지가 {n}건 있어요']
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
    if (!first && m.files && m.files.length) first = '📎 파일 ' + m.files.length + '개를 보냈어요';
    else if (!first && m.vurl) first = '🔊 음성으로 답했어요';
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
    if (!n) {
      clearTimeout(kBubbleSettleT);
      wrap.classList.remove('on', 'pop', 'settled'); btn.setAttribute('tabindex', '-1'); kBubbleKey = '';
      if (vbtn) vbtn.setAttribute('aria-label', '소장 K(케이)와 대화');
      return;
    }
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
  function kAvatar(expr) { return (window.KChar ? KChar.avatarUrl(expr) : ''); }
  function kRowHtml(start, bubbleHtml, extra) {
    return '<div class="krow ' + (start ? 'kstart' : 'kcont') + (extra || '') + '"><div class="kavcol">' +
      (start ? '<img class="kav" data-kexpr="neutral" src="' + kAvatar('neutral') + '" alt="케이" draggable="false">' : '') +
      '</div><div class="kcol">' + (start ? '<div class="kname">케이</div>' : '') + bubbleHtml + '</div></div>';
  }
  function applyKExpr(lastKMsg) {
    if (!window.KChar) return;
    var expr = lastKMsg ? KChar.exprFor(lastKMsg.text || '') : 'neutral';
    var rows = chatLog.querySelectorAll('.krow.kstart:not(.ktyping) img.kav');
    if (rows.length && lastKMsg) {
      var im = rows[rows.length - 1];
      im.setAttribute('data-kexpr', expr); im.setAttribute('src', KChar.avatarUrl(expr));
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
    // IME(한글) 조합 중이면 목록 DOM을 건드리지 않는다 → 조합이 끊겨 글자가 씹히는 것을 막는다.
    // 미룬 렌더는 compositionend/blur 에서 flushChatRender()로 한 번에 반영(v4.5).
    if (chatComposing) { chatRenderDeferred = true; return; }
    var q = chatSearchOn ? chatSearchQuery.trim().toLowerCase() : '';
    if (!chatMsgs.length && !q) {
      chatLog.innerHTML = '<div class="chatintro"><div class="chatintro-ic"><svg><use href="#i-spark"/></svg></div>' +
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
    var firstUnreadUid = '', newIncomingUid = '', newMine = false;
    if (anchorOn) {                                     // 붙잡아 둔 경계 이후 첫 안읽음(내용 있는 말풍선만)
      for (var ai = 0; ai < chatMsgs.length; ai++) {
        var am = chatMsgs[ai];
        if (am.role !== 'typing' && isUnreadSince(am, chatAnchorHW) && (am.text || am.vin || am.vurl || (am.files && am.files.length))) { firstUnreadUid = msgUid(am); break; }
      }
      if (firstUnreadUid) chatNewDivUid = firstUnreadUid;
    }
    var shown = 0, prevKind = '';                          // v6.0: 직전에 그린 말풍선 종류(케이 연속이면 아바타 생략)
    var lastKMsg = null;
    for (var li = chatMsgs.length - 1; li >= 0; li--) { if (chatMsgs[li].role === 'k' && (chatMsgs[li].text || chatMsgs[li].vurl)) { lastKMsg = chatMsgs[li]; break; } }
    var html = chatMsgs.map(function (m) {
      if (m.role === 'typing') return '';
      if (q && !msgMatches(m, q)) return '';                // 검색 중이면 일치하는 말풍선만
      var inner = m.text ? (q ? chatTextHL(m.text, q) : chatText(m.text))
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
        var vlbl = m.vurl ? ((m.bid && m.vtts && !m.vplayed) ? '▶ 듣기' : '다시 듣기') : '듣기';
        inner += '<button type="button" class="voiceplay" data-lid="' + m.lid + '"><svg><use href="#i-sound"/></svg>' + vlbl + '</button>';
      }
      if (m.role === 'k' && starIds[rowIdOf(m) || '']) inner += '<span class="bstar" aria-label="저장한 답">⭐</span>';   // v8.3 ⭐ 저장 표시
      if (!inner) return '';
      // v5.4(2026-09-23, 대표님 지시): 「🔔 알림」 딱지·호박색 테두리 등 화면 표시를 제거한다.
      //   메시지 자체는 그대로 오고 일반 말풍선처럼 보인다. ⚠️ 내부 notice 플래그(m.notice)는 그대로 두어
      //   '안읽음 배지 카운트 제외' 로직(아래 !isNotice)은 유지한다 — 알림이 안읽음 숫자를 올리지 않게.
      //   (예전: noticerow/noticebadge 딱지 + 말풍선 ' notice' 클래스 → v5.4에서 렌더만 제거.)
      // v5.9: 새 메시지 판정(검색 중엔 안 함) + 「여기부터 새 메시지」 구분선
      var uid = msgUid(m), divider = '';
      if (!q) {
        nowUids[uid] = 1;
        if (prevUids && !prevUids[uid]) {
          if (isIncomingMsg(m)) { if (!newIncomingUid) newIncomingUid = uid; }
          else newMine = true;                              // 이 기기에서 방금 보낸 내 메시지
        }
        if (uid === chatNewDivUid && shown > 0) divider = '<div class="chatnewdiv"><span>여기부터 새 메시지</span></div>';
      }
      shown++;
      // ⋯ 메뉴 버튼(복사·삭제). 텍스트 선택/복사를 방해하지 않게 우상단 고정.
      var bubbleHtml = '<div class="bubble ' + (m.role === 'me' ? 'me' : 'k') + '" data-uid="' + uid + '">' + inner +
        '<button type="button" class="bmenu" aria-label="메시지 메뉴(복사·삭제)">⋯</button></div>';
      if (m.role === 'me') {
        prevKind = 'me';
        return divider + bubbleHtml + (!q ? orderCardHtml(m) : '');   // v5.8: 작업 카드(대장에 접수된 메시지만)
      }
      // v6.0: 케이 말풍선 = 왼쪽 원형 아바타 + 이름(연속 메시지는 첫 칸만)
      var kStart = !(prevKind === 'k' && !divider);
      prevKind = 'k';
      return divider + kRowHtml(kStart, bubbleHtml, '');
    }).join('');
    if (q) {                                                // 검색 모드: 결과 안내 + (없으면) 빈 안내
      var info = $('chatSearchInfo');
      if (info) {
        info.style.display = 'block';
        var qt = esc(chatSearchQuery.trim());
        var ih = shown ? ('“' + qt + '” 검색 결과 ' + shown + '개') : '“' + qt + '”에 일치하는 대화가 없어요.';
        // v7.0: 옛 대화가 아직 서버에 남아 있으면(불러온 것 안에서만 찾았음) → 전부 받아 와서 찾기
        if (chatHasMore) ih += '<br><span class="chatsearchnote">지금 불러온 대화 안에서 찾았어요.</span> ' +
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
      var ptx = awaitingProg();
      html += kRowHtml(prevKind !== 'k', '<div class="bubble k typing"><span></span><span></span><span></span>' +
        '<em class="tprog"' + (ptx ? '' : ' style="display:none"') + '>' + esc(ptx) + '</em></div>', ' ktyping');
      // 답이 늦으면(약 35초 이상) "멈춘 것처럼" 보이지 않게 안내를 함께 띄운다
      var slowWait = chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token && (Date.now() - (m.ts || 0) > 35000); });
      if (kStatState === 'down') html += '<div class="waitnote down">PC가 응답하지 않아요. PC가 켜져 있는지 확인해 주세요. 켜지면 이어서 답해요.</div>';
      else if (slowWait && !ptx) html += '<div class="waitnote">케이가 PC에서 확인 중이에요. 조금 걸릴 수 있어요.</div>';
    } else if (kStatState === 'down') {                    // v8.4: 기다리는 답이 없어도 PC가 꺼져 있으면 맨 아래 한 줄로 알림
      html += '<div class="waitnote down">PC가 응답하지 않아요. 지금 보내 두시면 PC가 켜진 뒤 답해요.</div>';
    }
    chatLog.innerHTML = chatMoreHtml() + html;         // v7.0: 맨 위 [이전 대화 더 보기] / 「여기가 대화의 처음이에요」
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
    var opus = takeOpus();                        // v5.8: 켜져 있었으면 이번 1건(첨부 포함 한 번의 전송)에만 적용하고 끔
    var textUsed = false;
    // (1) 사진이 붙어 있으면 통합 전송(케이가 사진을 보고 답) — 글은 사진과 함께 감
    if (imgs.length) {
      chatPendingImages = [];
      sendChatTurnUI({ text: text, files: imgs, audioBlob: null, opus: opus });
      textUsed = true;
    }
    // (2) 파일이 붙어 있으면 파일 전송 — 글이 아직 안 쓰였으면 첫 파일 묶음에 함께 붙임
    if (files.length) {
      chatPendingFiles = [];
      var big = files.filter(function (f) { return (f.size || 0) > CHAT_CHUNK_LIMIT; });
      var small = files.filter(function (f) { return (f.size || 0) <= CHAT_CHUNK_LIMIT; });
      if (small.length) { pushChatFileMsg(small, false, textUsed ? '' : text, opus); textUsed = true; }
      big.forEach(function (f) { pushChatFileMsg([f], true, textUsed ? '' : text, opus); textUsed = true; });
      if (big.length) toast('큰 파일은 나눠 올려요 — 시간이 걸릴 수 있어요.');
    }
    renderPending();
    // (3) 남은 순수 텍스트(첨부가 하나도 없을 때) — 기존 경로(음성 답은 음성 대화 모드일 때만)
    if (!textUsed && text) sendPlainChat(text, opus);
  }
  // 순수 텍스트 1건을 케이 채팅으로 보낸다(sendChatMsg 의 (3)과 같은 경로 — O-0040 「추가 요청」도 이걸 재사용)
  function sendPlainChat(text, opus) {
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    chatMsgs.push({ role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false, opus: opus });
    saveChatMsgs(); renderChat(); updateSendEnabled();
    return OfficeBridge.sendChat(id, tok, chatThread, text, { speak: convoOn, modelPref: opus ? 'opus' : null }).then(function () {
      kickOrderPoll();                          // v5.8: 작업 카드가 곧 붙도록
      startChatReconcile();
      return true;
    }).catch(function () {
      var m = findMsg(id); if (m) m.answered = true;
      chatMsgs.push({ role: 'k', text: '죄송해요, 전송이 안 됐어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
      saveChatMsgs(); renderChat(); updateSendEnabled();
      return false;
    });
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
    if (dev) meMsg.vdev = true;
    if (vs) meMsg.vs = true;
    chatMsgs.push(meMsg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var note = text;                              // 사진만 있고 말/글이 없으면 기본 질문
    if (!note && !blob && imgs.length) note = '이 사진을 보고 설명해 주세요.';
    var memo = { id: id, token: tok, thread: chatThread,
                 title: text ? text.slice(0, 20) : (blob ? '음성대화' : '사진'), note: note };
    OfficeBridge.sendChatTurn(memo, { audioBlob: blob, files: imgs, speak: convoOn, modelPref: o.opus ? 'opus' : null,
                                      sttDevice: dev, vstream: vs, vend: o.vend || null, vprev: vprev }).then(function () {
      vlatMark(id, 'sub');                        // O-0210
      meMsg.uploading = false; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile(); kickOrderPoll();      // v5.8
    }).catch(function (e) {
      meMsg.answered = true; meMsg.uploading = false;
      chatMsgs.push({ role: 'k', text: '전송이 안 됐어요(' + (e && e.message || e) + '). 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
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
    if (t.indexOf('말하는') !== -1) { st = 'talk'; big = '케이가 말하는 중…'; small = '말이 끝나면 다시 들을게요'; stageLive(''); }
    else if (t.indexOf('답하는') !== -1) { st = 'think'; big = '케이가 답하는 중…'; small = '잠시만 기다려 주세요'; }
    else if (t.indexOf('기다려요') !== -1) { st = 'listen'; big = '듣는 중…'; small = '말씀을 기다리고 있어요'; }
    else if (t) { st = 'listen'; big = '듣는 중…'; small = '다 말씀하셨으면 아래 [다 말했어요]'; }
    chatKStage.setAttribute('data-state', st);
    if (chatKStageText) chatKStageText.textContent = big;
    if (chatKStageHint) chatKStageHint.textContent = small;
  }
  // 채팅 화면이 열려 있고 음성 대화 중일 때만 맨 위 「스마트비서」 머리줄을 접는다(다른 화면엔 영향 없음)
  function syncConvoMode() {
    var on = false;
    try { on = !!(convoOn && chatView && isOpen(chatView)); } catch (e) { on = false; }
    document.documentElement.classList.toggle('convo-mode', on);
  }
  function setConvoStage(on) {
    on = !!on;
    if (!chatView || chatView.classList.contains('convo-on') === on) { syncConvoMode(); return; }
    var wasBottom = chatNearBottom();              // 레이아웃이 바뀌기 전 위치(끌 때: 맨 아래였으면 맨 아래로 복귀)
    chatView.classList.toggle('convo-on', on);
    syncConvoMode();
    if (window.KChar) {
      var head = chatView.querySelector('[data-kface="head"]');
      if (KChar.hold) KChar.hold(head, on);       // 큰 무대가 도는 동안 헤더의 작은 얼굴 영상은 멈춤(영상 1개만 재생)
      KChar.mount();                               // 무대 얼굴을 지금 옷·머리로 곧바로 그림
    }
    if (on) { scrollTop(); chatScrollBottom(); }   // 켤 때: 최근 대화가 무대 아래 상자 맨 아래에 보이게
    else if (wasBottom) chatScrollBottom();
  }
  function stopAmpPoll() { if (ampTimer) { clearInterval(ampTimer); ampTimer = null; } }
  function kaiPlaying() { return !!(kaiAudio && !kaiAudio.paused && !kaiAudio.ended && kaiAudio.currentTime > 0); }

  // O-0177: 「기다리는 답」 중 무대 탭으로 끊은 턴(m.vcut)은 빼고 본다 — 끊은 뒤엔 그 답을 기다리지 않고 새 말을 듣는다.
  //   (anyAwaiting 은 그대로 둔다: 입력창·안내 등 다른 곳은 예전 그대로)
  function awaitingLive() { return chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token && !m.vcut; }); }

  // 한 번의 듣기 turn 시작. auto=연속 대화 루프의 일부인지.
  function startListen(auto) {
    if (chatRecording || stt.on) return;
    if (!isOpen(chatView)) return;
    if (awaitingLive()) return;                   // 답 기다리는 중엔 안 들음
    if (kaiPlaying() || vqHasMore()) return;      // ⚠️ 케이 목소리 재생 중엔 녹음 안 함(자기 목소리 오인 방지) — O-0177 결정: 이 게이트 유지
    if (isRecording) { toast('먼저 홈의 녹음을 마쳐 주세요.'); if (convoOn) stopConvo(true); return; }
    // O-0177 ②: 음성 대화 중이고 폰 받아쓰기가 되면 그걸로(실패하면 이 턴부터 아래 녹음 경로)
    if (auto && convoOn && sttUsable()) { unlockKaiAudio(); sttListen(); return; }
    startRecListen(auto);
  }
  function startRecListen(auto) {
    if (chatRecording || stt.on) return;
    if (!RecordingModule.isSupported()) { toast('이 기기에서는 음성 입력을 쓸 수 없어요.'); if (convoOn) stopConvo(true); return; }
    unlockKaiAudio();
    var r = ensureChatRecorder();
    lsnSpoke = false; lsnSpeechMs = 0; lsnStartTs = Date.now(); lsnLastSound = Date.now(); lsnPendingSend = false; lsnReason = '';
    lsnVad = (window.KVad ? KVad.create(HF, lsnStartTs) : null);   // O-0177 ③ 소음 적응 판정(vad.js 없으면 아래 예전 판정)
    chatRecording = true; setChatMic(true);
    if (auto) setConvoStatus('말씀하세요… (끝나면 자동으로 보내요)');
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
  function sttUsable() { return !!(VC.DEVICE_STT && KS && ks.ok && !ks.off && window.KVad && KVad.sttNew); }
  function ksInit() {
    if (!VC.DEVICE_STT || !KS) return Promise.resolve(false);
    if (ks.p) return ks.p;
    try {
      KS.addListener('partial', function (e) { sttOnPartial(e && e.text); });
      KS.addListener('segment', function (e) { sttOnSegment(e || {}); });      // O-0189: 인식기가 스스로 끝낸 토막(다시 듣는 중)
      KS.addListener('rms', function (e) { sttOnRms(e && e.db); });            // O-0189: 소리 크기
      KS.addListener('speech', function () { if (stt.on && stt.s) stt.s.lastLoud = Date.now(); });
      KS.addListener('final', function (e) { sttOnFinal(e && e.text); });
      KS.addListener('error', function (e) { sttOnError(e || {}); });
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
  }
  /* O-0189(v8.9) 말 끝 판정 — 「말하고 있는데 끊고 보내 버린다」 고침
   *  v8.8 이 끊은 조건 두 가지(코드로 확인):
   *   (가) 부분 결과(글자)가 0.9초(3초 넘게 말했으면 1.2초) 안 바뀌면 끝 — 생각하며 1초만 쉬어도 걸린다. 인식기 자체 판정보다 늘 먼저 걸리는 쪽.
   *   (나) 인식기가 스스로 끝내 결과(onResults)를 주면 곧바로 전송 — v8.8 은 인식기에 「1.2~1.5초 조용하면 끝」이라고까지 알려 줬다.
   *  이제: 인식기는 이어 듣기(continuous) — 스스로 끝내도 보내지 않고 곧바로 다시 들으며 글을 이어 붙인다.
   *        보내는 때는 ① 새 글자도 큰 소리도 없이 「말 끝 기다림」(기본 2초)이 지났을 때 ② [다 말했어요]를 눌렀을 때 ③ 60초를 채웠을 때뿐.
   *  끝난 이유(quiet/manual/max)·말한 길이·토막 수는 meta.vend 로 PC에 보내 [지연] 로그에 남는다(글 내용 아님 — 다음에 원인 추적용). */
  function sttCfg() { return { endMs: endWaitMs(), noSpeechMs: VC.STT_NOSPEECH_MS, maxMs: VC.STT_MAX_MS }; }
  function sttListen() {
    var now = Date.now();
    stt = { on: true, s: KVad.sttNew(now), timer: null, finishing: false, finWait: null, why: '' };
    setChatMic(true);
    setConvoStatus('말씀하세요… (끝나면 자동으로 보내요)');
    stageLive('');
    var w = endWaitMs();
    KS.start({ lang: 'ko-KR', partial: true, continuous: true, muteRestart: !!VC.STT_MUTE_RESTART,
               completeMs: w + 1500, possiblyMs: w + 1000, minMs: 3000 }).catch(function (e) {
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
      if (convoOn) setConvoStatus('말씀을 기다려요…');
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
    var vend = { p: 'dev', end: why, wait: endWaitMs(), ms: Math.max(0, (s.lastAct || 0) - (s.first || s.t0)),
                 total: Date.now() - s.t0, segs: s.segs, od: ks.onDevice ? 1 : 0,
                 fin: stt.finAt ? Math.max(0, Date.now() - stt.finAt) : 0 };   // O-0210: 말 끝 판정 → 보내기까지(마지막 글자 기다림)
    sendChatTurnUI({ text: text, files: imgs, sttDevice: true, opus: takeOpus(), vend: vend });
  }
  // O-0189 [다 말했어요] — 기다리지 않고 지금 보내기(받아쓰기·녹음 경로 공통)
  function sayDone() {
    if (stt.on) { if (!stt.finishing) sttFinish('manual'); return; }
    if (chatRecording) { endListen('manualsend'); return; }
  }
  function listenMiss(reason) {
    if (convoOn) {
      convoMiss++;
      if (convoMiss >= HF.MAX_MISS) { stopConvo(true); toast('말씀이 없어 대화를 멈췄어요. 다시 시작하려면 「음성 대화」를 켜세요.'); }
      else { setConvoStatus('말씀을 기다려요…'); scheduleNextListen(500); }
    } else if (reason === 'nospeech') toast('말씀이 안 들렸어요. 다시 눌러 말씀해 주세요.');
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
    if (stt.on || chatRecording) { toast('듣고 있어요. 말씀하세요.'); return; }
    vqCut();
    nextListenArmed = false;
    toast('듣고 있어요.');
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
      sendChatTurnUI({ text: '', files: imgs, audioBlob: blob, opus: takeOpus(), vend: vend });   // 음성(+있으면 사진) 전송 · v5.8 오퍼스 1회
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
  function startConvo() {
    if (convoOn) return;
    convoOn = true; convoMiss = 0; updateConvoToggle();
    restartChatReconcile();                       // O-0177: 음성 대화 중엔 답 확인을 빠르게
    toast('음성 대화를 시작해요. 말씀하시면 자동으로 오가요. 끝내려면 다시 누르세요.');
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
    if (!auto) toast('음성 대화를 끝냈어요.');
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
    if (convoOn) { toast('음성 대화 중이에요.'); return; }
    if (anyAwaiting()) { toast('앞 답을 받은 뒤에 말할 수 있어요.'); return; }
    if (isRecording) { toast('먼저 홈의 녹음을 마쳐 주세요.'); return; }
    if (!chatRecording) startListen(false);
    else endListen('manualsend');
  }

  /* ---- 답변별 [듣기]: 평소엔 그 답의 mp3 가 없으니 "온디맨드"로 그때 생성해 재생 ----
   * (안 들을 답은 생성 안 함 = 가장 효율적) 이미 vurl 이 있으면(연속 대화 등) 바로 재생. */
  function findKByLid(lid) { for (var i = 0; i < chatMsgs.length; i++) { if (chatMsgs[i].role === 'k' && chatMsgs[i].lid === lid) return chatMsgs[i]; } return null; }
  function resetListenBtn(btn, lbl) { if (!btn) return; btn._loading = false; btn.classList.remove('loading'); btn.removeAttribute('disabled'); btn.innerHTML = lbl; }
  function onListenBtn(lid, btn) {
    var m = findKByLid(lid); if (!m) return;
    // v6.0: 「목소리」에서 이 기기 음성을 골랐으면 PC 요청 없이 바로 기기에서 읽는다(무료·즉시).
    var dv = window.KChar && KChar.voice.active();
    if (dv && m.text) {
      if (btn.classList.contains('playing')) { KChar.voice.stop(); btn.classList.remove('playing'); return; }
      try { if (kaiAudio && !kaiAudio.paused) kaiAudio.pause(); } catch (e) {}
      if (playingBubbleEl && playingBubbleEl !== btn) playingBubbleEl.classList.remove('playing');
      playingBubbleEl = btn; btn.classList.add('playing');
      var ok = KChar.voice.speak(m.text, dv, {
        onend: function () { btn.classList.remove('playing'); if (playingBubbleEl === btn) playingBubbleEl = null; },
        onerror: function () { btn.classList.remove('playing'); if (playingBubbleEl === btn) playingBubbleEl = null; }
      });
      if (ok) return;
      btn.classList.remove('playing');                 // 기기 음성 실패 → 아래 케이 기본 목소리로
    }
    if (window.KChar && KChar.voice.speaking()) KChar.voice.stop();
    unlockKaiAudio();
    // v8.3: 사무소가 미리 붙인 목소리(서명 주소 7일)는 6일 반이 지나면 만료로 보고 그때 새로 만든다(예전 [듣기]와 같은 길)
    if (m.vurl && m.vtts && m.ts && (Date.now() - m.ts) > 6.5 * 86400000) { m.vurl = null; m.vtts = false; }
    if (m.vurl) {
      if (m.vtts && !m.vplayed) { m.vplayed = true; saveChatMsgs(); var _lb = btn.lastChild; if (_lb && _lb.nodeType === 3) _lb.nodeValue = '다시 듣기'; }
      playKaiVoice(m.vurl, btn); return;
    }
    if (btn._loading) return;
    var lbl = btn.innerHTML;
    btn._loading = true; btn.classList.add('loading'); btn.setAttribute('disabled', '');
    btn.innerHTML = '<svg><use href="#i-sound"/></svg>준비 중…';
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    OfficeBridge.requestTts(id, tok, m.text || '').then(function () {
      pollTts(id, tok, 0, m, lbl);
    }).catch(function () { resetListenBtn(btn, lbl); toast('음성을 준비하지 못했어요. 잠시 후 다시 눌러 주세요.'); });
  }
  function pollTts(id, tok, tries, m, lbl) {
    if (tries > 40) { var b0 = chatLog.querySelector('[data-lid="' + m.lid + '"]'); resetListenBtn(b0, lbl); toast('음성 준비가 지연돼요. 잠시 후 다시 눌러 주세요.'); return; }
    OfficeBridge.poll(id, tok).then(function (res) {
      var b = chatLog.querySelector('[data-lid="' + m.lid + '"]');
      if (res && res.status === 'done') {
        var url = res.summary_json && res.summary_json.voice_url;
        if (url) {
          m.vurl = url; saveChatMsgs();
          if (isOpen(chatView)) renderChat();
          var fresh = chatLog.querySelector('[data-lid="' + m.lid + '"]');
          playKaiVoice(url, fresh || b);
        } else { resetListenBtn(b, lbl); toast('음성을 만들지 못했어요.'); }
      } else {
        setTimeout(function () { pollTts(id, tok, tries + 1, m, lbl); }, 700);
      }
    }).catch(function () { setTimeout(function () { pollTts(id, tok, tries + 1, m, lbl); }, 900); });
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
    if (arr.length > room) { arr = arr.slice(0, room); toast('사진은 한 번에 최대 6장까지예요.'); }
    if (!arr.length) return;
    chatPendingImages = chatPendingImages.concat(arr);
    renderPending();
    if (!removed) toast('사진을 붙였어요. 말하거나 질문을 적어 보내세요.');
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
        chatMsgs.push({ role: 'k', text: '시간이 오래 걸려요. 다시 물어봐 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
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
          var reply = res.content_md || (res.summary_json && res.summary_json.reply) || '답을 못 만들었어요. 다시 물어봐 주세요.';
          var atts = OfficeBridge.attachmentsFrom(res);   // 케이가 보낸 첨부(하향)
          var vurl = res.summary_json && res.summary_json.voice_url;   // 케이 목소리(mp3)
          var vparts = res.summary_json && Array.isArray(res.summary_json.voice_parts) ? res.summary_json.voice_parts : null;   // O-0177 ①
          if (vparts && vparts.length) vlatMark(m.id, 'p1');
          vlatMark(m.id, 'done');                     // O-0210
          // O-0210 ⑥: PC가 목소리를 못 만든 턴(voice_fail: 못 만든 조각 수, 전부면 -1)은 알려 준다. 옛 PC는 이 칸을 안 보낸다 = 예전 그대로.
          var vfail = res.summary_json ? Number(res.summary_json.voice_fail || 0) : 0;
          if (vfail && convoOn && !m.vcut && isOpen(chatView)) {
            toast(vfail < 0 ? '목소리를 만들지 못했어요. 답은 글로 남겼어요.' : '목소리 일부를 만들지 못했어요. 답 전체는 글로 확인해 주세요.');
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
          else { chatUnseen++; updateChatBadge(); toast(vurl ? '케이가 음성으로 답했어요.' : (atts.length ? '케이가 파일을 보냈어요.' : '케이 답장이 도착했어요.')); }
          updateSendEnabled();
        } else if (Date.now() - (m.waitFrom || m.ts || 0) > ((m.files || m.opus) ? 20 : 6) * 60 * 1000) {   // 파일 첨부·오퍼스 지정은 여유롭게
          m.answered = true;
          chatMsgs.push({ role: 'k', text: '시간이 오래 걸려요. 다시 물어봐 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
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
    var p = awaitingProg();
    var el = chatLog ? chatLog.querySelector('.ktyping .tprog') : null;
    if (el) {
      el.textContent = p; el.style.display = p ? '' : 'none';
      var wn = chatLog.querySelector('.waitnote:not(.down)'); if (wn && p) wn.style.display = 'none';   // 진행이 보이면 「조금 걸릴 수 있어요」는 접음
    }
    if (convoOn && chatKStage && chatKStage.getAttribute('data-state') === 'think' && chatKStageHint) chatKStageHint.textContent = p || '잠시만 기다려 주세요';
  }

  var kStatState = null, kStatData = null, kStatBusy = false, kStatMissing = false, kStatLast = 0;
  var KSTAT_DOWN_S = 180;                        // PC 하트비트 60초 × 3 — 이보다 오래 소식이 없으면 「PC 응답 없음」
  function kStatCalc(d) {
    if (!d || !d.updated_at) return null;
    var up = Date.parse(d.updated_at); if (isNaN(up)) return null;
    var now = Date.parse(d.server_now); if (isNaN(now)) now = Date.now();   // 서버 시계 기준(폰 시계가 틀려도 맞게)
    if (d.stopping || (now - up) / 1000 > KSTAT_DOWN_S) return 'down';
    return d.busy ? 'busy' : 'ok';
  }
  function kStatSentence() {
    var d = kStatData || {};
    if (kStatState === 'ok') return '🟢 PC 케이가 켜져 있어요. 보내시면 바로 답해요.';
    if (kStatState === 'busy') return d.busy_kind === 'other'
      ? '🟠 케이가 다른 창구 일을 하는 중이에요. 보내시면 끝나는 대로 답해요.'
      : '🟠 케이가 앞의 질문에 답하는 중이에요. 보내시면 차례대로 답해요.';
    if (kStatState === 'down') {
      var mins = 0;
      try { mins = Math.round((Date.parse(d.server_now) - Date.parse(d.updated_at)) / 60000); } catch (e) {}
      return '🔴 PC가 ' + (mins > 0 && mins < 600 ? mins + '분째 ' : '') + '응답이 없어요. PC가 켜져 있는지, 인터넷이 되는지 확인해 주세요. 보내 두시면 PC가 살아난 뒤 답해요.';
    }
    return '';
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
    dot.className = 'kstat ' + kStatState; dot.style.display = '';
    sub.className = 'kst-' + kStatState;
    // 좁은 폰(접은 폴드 등)은 머리줄 자리가 없어 점 색만(글자는 「소장」 그대로) — 넓은 화면(펼친 폴드·PC)에서만 「· 정상」 같은 글을 붙인다(CSS .kst-w)
    var word = kStatState === 'ok' ? '정상' : (kStatState === 'busy' ? '바쁨' : 'PC 응답 없음');
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
      kStatBusy = false;
      var prev = kStatState;
      kStatData = d; kStatState = kStatCalc(d);
      renderKStat();
      if (prev !== kStatState && isOpen(chatView) && (prev === 'down' || kStatState === 'down')) renderChat();   // 「PC 응답 없음」 안내 줄을 붙이거나 뗀다
    }).catch(function (e) {
      kStatBusy = false;
      if (e && (e.notready || e.badpass)) {          // 서버 함수 없음 → 이번 실행 동안 다시 묻지 않음 / 암호 틀림 → 숨김
        if (e.notready) kStatMissing = true;
        kStatState = null; renderKStat();
      }                                              // 인터넷 끊김 등은 마지막 상태를 그대로 둔다
    });
  }
  setInterval(function () { try { if (!document.hidden && isOpen(chatView)) refreshKStat(false); } catch (e) {} }, 30000);
  document.addEventListener('visibilitychange', function () { try { if (!document.hidden && isOpen(chatView)) refreshKStat(true); } catch (e) {} });

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
    officeLoading = true; officeLoadingAt = Date.now();
    var since = officeSince();
    OfficeBridge.listOfficePushes(since).then(function (rows) {
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
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('케이가 새 소식을 보냈어요.'); }
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
      if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.');
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
      if (!(e && (e.missing || e.badpass))) toast('이전 대화를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.');
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
  function chatMoreHtml() {
    if (!chatOlder) return '';
    if (chatHasMore) {
      return '<div class="chatmore"><button type="button" class="chatmorebtn"' + (chatOlderBusy ? ' disabled' : '') + '>' +
        (chatOlderBusy ? '불러오는 중…' : '이전 대화 더 보기') + '</button></div>';
    }
    return '<div class="chatmore end">여기가 대화의 처음이에요</div>';
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
        chatMsgs.push({ role: 'me', text: q || '(음성/파일)', ts: ts - 1, cid: row.id, answered: true, remote: true, rid: row.id });
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
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('다른 기기에서 보낸 대화가 도착했어요.'); }
      }
      if (stamped) readRecount();                  // (O-0201) 서버 시각을 새로 안 답이 있으면 — 다른 기기에서 이미 읽은 것일 수 있다
      if (isOpen(chatView) && !chatSearchOn && readPresent()) readNote(readLoadedMs);   // (O-0201) 검색 중(결과만 보는 중)에는 올리지 않음
      chatSyncHW = maxTs;   // v4.0: 세션 high-water 전진(메모리). 열 때 EPOCH 로 리셋됨
    }).catch(function (e) {
      syncLoading = false;
      if (e && e.badpass) {                          // 암호가 틀림(또는 서버 미설정) → 저장한 암호 지우고 재입력 유도
        setSyncPass('');
        if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.');
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
    toast('PC 연동 암호를 저장했어요.');
    if (isOpen(chatView) && !chatOlder) loadChatFirstPage(startChatSync);   // v7.0: 채팅에서 암호를 넣었으면 최신 한 쪽부터(→ 이전 대화 더 보기)
    else startChatSync();                             // 곧바로 한 번 확인(암호 틀리면 게이트가 다시 뜸)
    if (isOpen($('meetingsView'))) openMeetings();    // v5.2: 회의 요약 탭에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen($('ideasView'))) refreshIdeas(false);  // v5.5: 아이디어 화면에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen($('ordersView'))) refreshOrders(false); // v5.8: 작업 현황에서 암호를 넣었으면 바로 다시 불러온다
    if (isOpen(chatView)) { ordFullOnce = true; pollOrderCards(); }   // v5.8: 작업 카드도 곧바로
    try { if (window.SmartPush && SmartPush.retry) SmartPush.retry(); } catch (e) {}           // v7.5(O-0130): 보류된 푸시 토큰 등록
    try { if (isOpen($('healthView')) && window.HealthTab) HealthTab.open(); } catch (e) {}    // v7.5: 건강 탭에서 넣었으면 다시 불러오기
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
      return '<div class="ord-sent">✓ ' + (d.k === 'revise' ? '수정 요청을' : '승인을') + ' 보냈어요 · ' + esc(fmtKst(new Date(d.at).toISOString())) +
        ' — 케이 답은 채팅에서 확인해 주세요</div>';
    }
    var t = Date.parse(o.u || o.updated_at || '');
    if (!isNaN(t) && Date.now() - t > ORD_APPROVE_WINDOW_MS) {
      return '<div class="ord-sent warn">결정을 기다린 지 이틀 가까이 지나 버튼으로는 이어받지 못해요. 채팅으로 케이에게 말씀해 주세요.</div>';
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
        toast((kind === 'revise' ? '수정 요청을' : '승인을') + ' 케이에게 보냈어요. 채팅에서 답을 확인하세요.');
      } else {
        ordDecErr[o.id] = '보내지 못했어요 — 인터넷 연결을 확인하고 다시 눌러 주세요.';
        toast('보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
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
      '\n승인하면 케이가 이 작업을 이어받아, 보고에서 여쭌 것(발송·배포 등)을 실행해요.\n채팅에는 「' + ordApproveText(o) + '」이라고 전달돼요.',
      '승인', function () { ordDecideSend(o, 'approve', ordApproveText(o)); });
    if (sheetMsg) sheetMsg.classList.add('pck');     // 여러 줄 안내(왼쪽 정렬·줄바꿈 유지·높이 제한 해제) — 기존 시트 모양 재사용
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-check'); }   // 긍정 동작 — 빨간 휴지통 대신 ✓(아이디어 [진행해줘]와 같게)
  }
  function openReviseOrder(id) {
    var o = ordDecideFind(id); if (!o || !ordNeedsDecision(o) || ordDecBusy[id]) return;
    modalTitle.textContent = '작업 #' + (o.job_seq | 0) + ' 수정 요청';
    modalBody.innerHTML = '<div class="card rcard"><div class="h"><svg><use href="#i-note"/></svg>어떻게 고칠까요?</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">한 줄로 적어 주시면 케이에게 채팅으로 보내요. 승인이 아니라서, 고친 뒤 다시 보고받아요.</div>' +
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
      if (e && e.badpass) { setSyncPass(''); if (isOpen(chatView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
    });
  }

  /* ---- 작업 현황 화면 ---- */
  function openOrders(fromChat, hlId) {
    ordersFromChat = !!fromChat; ordersHl = hlId || '';
    openScreen(ordersView);
    if (ordersBody && !ordersBody.innerHTML) ordersBody.innerHTML = '<div class="ord-empty">불러오는 중…</div>';
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
      if (ordersBody) ordersBody.innerHTML = '<div class="ord-empty">PC 연동 암호를 넣으면 작업 현황이 보여요.</div>';
      return;
    }
    if (ordersBusy) return; ordersBusy = true;
    OfficeBridge.listOfficeOrders(80, pass).then(function (rows) {
      ordersBusy = false;
      renderOrders(rows);
      try { if (window.TodayCard) TodayCard.setOrders(rows); } catch (e) {}   // (O-0129) 같은 결과로 「챙길 일」(추가 호출 없음)
    }).catch(function (e) {
      ordersBusy = false;
      if (e && e.badpass) { setSyncPass(''); if (isOpen(ordersView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); return; }
      if (ordersBody && !silent) ordersBody.innerHTML = '<div class="ord-err">작업 현황을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침을 눌러 주세요.</div>';
    });
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
    h += open.length ? open.map(ordItemHtml).join('') : '<div class="ord-empty">지금 진행 중이거나 기다리는 일이 없어요.</div>';
    h += '<div class="ord-sec">최근 끝난 일 <small>' + done.length + '건' +
      (done.length ? ' <button type="button" class="ord-clear" id="ordersClearDone"><svg><use href="#i-trash"/></svg>모두 지우기</button>' : '') + '</small></div>';
    h += done.length ? done.map(ordItemHtml).join('') : '<div class="ord-empty">아직 없어요.</div>';
    h += '<div class="ord-restore"><button type="button" class="ord-restore-btn" id="ordersRestore">지운 항목 다시 보기</button></div>';   // v5.9: 숨김 되살리기
    ordersBody.innerHTML = h;
    if (ordersHl) {                                  // 카드에서 들어왔으면 그 항목으로 스크롤(한 번만)
      var el = ordersBody.querySelector('[data-oid="' + ordersHl.replace(/"/g, '') + '"]');
      if (el) try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      ordersHl = '';
    }
  }
  /* ---- v5.9 작업 현황 「지우기」 = 숨김(서버 hidden_at). 서버 원본 행·PC 지시 대장은 그대로 ----
   * ⚠️ confirm() 금지(앱 함정) → 기존 확인 시트(openSheet) 재사용. 암호 없거나 틀리면 기존 게이트. */
  function ordHideErr(e) {
    if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); return; }
    if (e && e.notready) { toast('서버 준비가 아직 안 됐어요(소장에게 알려 주세요).'); return; }
    toast('지우지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  function ordFind(id) { for (var i = 0; i < ordersRows.length; i++) if (ordersRows[i].id === id) return ordersRows[i]; return null; }
  function ordDoHide(ids, doneMsg) {
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, '지우려면 PC 연동 암호를 입력해 주세요.'); return; }
    OfficeBridge.hideOfficeOrders(ids, pass).then(function (n) {
      renderOrders(ordersRows.filter(function (o) { return ids.indexOf(o.id) === -1; }));   // 바로 화면에서 빼고
      refreshOrders(true);                                                                 // 서버 기준으로 다시 확인
      toast(n > 0 ? doneMsg.replace('{n}', n) : '지울 항목이 없었어요(이미 다시 진행 중일 수 있어요).');
    }).catch(ordHideErr);
  }
  function confirmHideOrder(id) {
    var o = ordFind(id); if (!o || !ORD_HIDEABLE[o.status]) return;
    var open = !ORD_CLOSED[o.status];                // 보류·실패 = 아직 소장이 챙기는 일
    var s = (o.summary || '').replace(/\s+/g, ' ').trim(); if (s.length > 50) s = s.slice(0, 50) + '…';
    openSheet(o.id + ' 항목을 지울까요?',
      '「' + (s || '요지 없음') + '」 — ' +
      (open ? '목록에서만 사라져요. 아직 「' + o.status + '」 상태라 PC 지시 대장엔 남아 소장이 계속 챙겨요. '
            : '목록에서만 사라지고 기록 원본은 남아요. ') +
      '맨 아래 [지운 항목 다시 보기]로 되살릴 수 있어요.',
      '지우기', function () { ordDoHide([id], '지웠어요.'); });
  }
  function confirmClearDoneOrders() {
    var ids = ordersRows.filter(function (o) { return ORD_CLOSED[o.status]; }).map(function (o) { return o.id; });
    if (!ids.length) { toast('지울 끝난 일이 없어요.'); return; }
    openSheet('끝난 일 ' + ids.length + '건을 모두 지울까요?',
      '「완료」「취소」된 일만 목록에서 사라져요(「보류」「실패」·진행 중인 일은 그대로). 기록 원본은 지워지지 않고, 맨 아래 [지운 항목 다시 보기]로 되살릴 수 있어요.',
      '모두 지우기', function () { ordDoHide(ids, '끝난 일 {n}건을 지웠어요.'); });
  }
  function confirmRestoreOrders() {
    var pass = getSyncPass();
    if (!pass) { showSyncGate(true, 'PC 연동 암호를 입력해 주세요.'); return; }
    openSheet('지운 항목을 다시 보이게 할까요?', '작업 현황에서 지웠던 항목이 전부 목록으로 돌아와요.', '다시 보기', function () {
      OfficeBridge.restoreOfficeOrders(getSyncPass()).then(function (n) {
        refreshOrders(false);
        toast(n > 0 ? n + '건을 다시 보이게 했어요.' : '지운 항목이 없어요.');
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
      a.forEach(function (m) { if (m && m.uploading) { m.uploading = false; m.error = true; m.errorMsg = '앱이 닫혀 전송이 중간에 끊겼어요. 파일을 다시 보내 주세요.'; delete m.progress; } });
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
        '<b>PC↔폰 공유함</b><p>여기에 올린 글·파일은 <b>케이가 보지 않고</b> 폰과 PC에서 함께 보여요.<br>한쪽에서 올리면 다른 쪽에도 떠요.</p></div>';
      return;
    }
    lockerLog.innerHTML = lockerMsgs.map(function (m) {
      var inner = m.text ? chatText(m.text) : '';
      if (m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span class="lk-prog" style="opacity:.75">' + esc(lockerProgText(m)) + '</span>';
      if (m.error) inner += (inner ? '<br>' : '') + (m.errorMsg ? '<span class="lk-err" style="display:block;margin-top:4px;padding:7px 9px;border-radius:9px;background:rgba(0,0,0,.32);color:#fff;line-height:1.45"><b>올리지 못했어요</b><br>' + esc(m.errorMsg) + '</span>' : '<span style="color:var(--rec)">올리지 못했어요</span>');
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
      toast('올리지 못했어요 — ' + why + (restored ? ' (파일은 보낼 칸에 다시 넣어 두었어요)' : ''));
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
        else toast('공유함에 새 자료가 도착했어요.');
      }
    }).catch(function (e) {
      lockerLoading = false;
      if (e && e.badpass) { setSyncPass(''); if (isOpen(lockerView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
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
    saveLockerMsgs(); renderLocker(); toast('삭제했어요.');
  }
  function clearAllLocker() {
    if (!lockerMsgs.length) { toast('지울 자료가 없어요.'); return; }
    openSheet('공유함을 모두 지울까요?', '이 기기 화면의 목록만 지워져요(다른 기기·서버에 올린 파일은 그대로 남아요).', '전체 삭제', function () {
      // v4.0: 경계 마커로 '이 시각 이전' 서버 항목을 이 기기서 다시 안 그리게(v3.9 전체 재조회로 되살아나던 것 방지)
      try { localStorage.setItem(LOCKER_CLEARED_KEY, new Date().toISOString()); } catch (e) {}
      lockerMsgs = []; saveLockerMsgs();
      renderLocker(); toast('공유함 목록을 지웠어요.');
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
    if (!w) toast('Claude 화면을 열지 못했어요 — 다시 눌러 주세요.');
  }
  if ($('btnPcK')) $('btnPcK').addEventListener('click', function () {
    openSheet('Claude Code 연결',
      'PC 케이와 대화방(Claude 앱)에서 직접 일을 시키는 곳이에요. PC 화면을 직접 보며 조작하려면 「PC 원격 제어」를 누르세요.\n' +
      '① Claude 앱이 열리면 새 작업 창은 ✕로 닫아 주세요.\n' +
      '② Code 대화 목록에서 컴퓨터 표시(초록 점)가 붙은 「' + PC_K_SESSION_TITLE + '」을 고르세요.\n' +
      '③ 그 대화창에 바로 입력하시면 PC 케이에게 전달돼요.',
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
    if (!w) toast('원격 화면을 열지 못했어요 — 「크롬 원격 데스크톱」 앱을 직접 열어 주세요.');
  });
  // v7.8 홈 「길찾기」 — 화면을 바꾸지 않고 바로 네이버 지도를 연다(돌아오면 홈 그대로). 여는 방법은 today-card.js 한 곳.
  if ($('btnRoute')) $('btnRoute').addEventListener('click', function () {
    if (window.TodayCard && TodayCard.openMap) TodayCard.openMap();
    else toast('지도를 열지 못했어요 — 다시 눌러 주세요.');
  });
  if ($('btnLocker')) $('btnLocker').addEventListener('click', openLocker);
  if ($('btnCalc')) $('btnCalc').addEventListener('click', function () {   // (O-0178) 계산기
    openScreen($('calcView'));
    if (window.SmartCalc && SmartCalc.onOpen) SmartCalc.onOpen();
  });
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
      if (dirs) toast('폴더는 올릴 수 없어요(' + dirs + '개 뺐어요). 폴더 안 파일을 골라 끌거나, 압축(zip)해서 올려 주세요.');   // 폴더 안내가 뒤에 떠야 가려지지 않음
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
    if (!removed) toast('파일을 붙였어요. 보내기를 누르세요.');
  });
  if ($('lockerMenuBtn')) $('lockerMenuBtn').addEventListener('click', function () {
    var linked = !!getSyncPass();
    openSheet('공유함 메뉴',
      linked ? 'PC와 폰이 연동되어 있어요.' : 'PC(크롬)에서도 같은 공유함을 보려면 연동하세요.',
      '공유함 전체 삭제', clearAllLocker, null,
      { label: linked ? 'PC 연동 암호 변경' : 'PC 연동 암호 설정', action: function () { showSyncGate(true); } });
  });
  if (lockerLog) lockerLog.addEventListener('click', function (ev) {
    var ln = ev.target.closest ? ev.target.closest('a.chatlink,[data-link]') : null;
    if (ln) { ev.preventDefault(); var lu = ln.getAttribute('data-link') || ln.getAttribute('href'); var lw = window.open(lu, '_blank'); if (!lw) toast('링크를 열지 못했어요.'); return; }
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
    if (window.KChar) KChar.restartFace(pf, 450);   // 정지 사진 먼저 → 영상은 0초부터(눈 감은 프레임 방지)
    kProfile.style.display = 'flex';
  }
  function closeKProfile() { if (kProfile) kProfile.style.display = 'none'; }
  if ($('kHeadBtn')) $('kHeadBtn').addEventListener('click', openKProfile);
  if ($('kProfClose')) $('kProfClose').addEventListener('click', closeKProfile);
  if (kProfile) kProfile.addEventListener('click', function (ev) { if (ev.target === kProfile) closeKProfile(); });
  if ($('kProfWardrobe')) $('kProfWardrobe').addEventListener('click', function () { closeKProfile(); openKWardrobe(); });
  function openKWardrobe() {
    kwFrom = isOpen(chatView) ? 'chat' : 'home';
    openScreen($('kWardrobeView'));
    renderKWardrobe();
    if (window.KChar) KChar.mount();
  }
  function closeKWardrobe() {
    if (window.KChar) KChar.voice.stop();
    stopKFullBow();
    if (kwFrom === 'chat') openChat(); else { showHome(); setStatus('대기 중', 'idle'); }
  }
  function renderKWardrobe() {
    if (!window.KChar) return;
    var cur = KChar.outfit(), list = KChar.outfits();
    if ($('kwCurName')) $('kwCurName').textContent = KChar.lookName ? KChar.lookName() : cur.name;
    var curHair = KChar.hair ? KChar.hair() : null, hairOn = curHair && curHair.id !== KChar.defaultHair;
    if ($('kwCount')) $('kwCount').textContent = String(list.length);
    var g = $('kwGrid');
    if (g) {
      var lastCat = null, cats = {};
      list.forEach(function (o) { var c = o.category || ''; cats[c] = (cats[c] || 0) + 1; });
      var multiCat = Object.keys(cats).length > 1;
      g.innerHTML = list.map(function (o) {
        var on = o.id === cur.id, head = '';
        var c = o.category || '';
        if (multiCat && c !== lastCat) { lastCat = c; head = '<div class="kw-cat">' + esc(c || '기타') + ' <small>' + cats[c] + '벌</small></div>'; }
        return head + '<button type="button" class="kw-item' + (on ? ' on' : '') + '" data-outfit="' + esc(o.id) + '">' +
          '<span class="kw-th"><img src="' + esc(KChar.thumbUrl(o)) + '" alt="" loading="lazy">' + (on ? '<span class="kw-on">입는 중</span>' : '') +
          (hairOn && !KChar.hasLook(curHair.id, o.id) ? '<span class="kw-soon">이 머리는 준비 중</span>' : '') + '</span>' +
          '<span class="kw-nm">' + esc(o.name) + '</span></button>';
      }).join('') +
        '<button type="button" class="kw-item new" data-kreq="outfit"><span class="kw-th"><div><svg><use href="#i-plus"/></svg>추가 요청</div></span><span class="kw-nm">새 옷 부탁하기</span></button>';
    }
    renderKHairs();
    renderKVoices();
    renderKFull();
    renderKIntro();
    var mo = $('kwMotion');
    if (mo) mo.checked = KChar.motionPref();
    if ($('kwMotionWhy')) $('kwMotionWhy').textContent = (KChar.motionPref() && KChar.motionBlockReason()) ? ('지금은 정지 사진: ' + KChar.motionBlockReason()) : '';
  }
  // O-0040: 머리 목록 — 지금 옷으로 한 모습 썸네일. 이 옷과의 조합 사진이 아직 없으면 「준비 중」(고르면 기본머리 사진으로 보임)
  function renderKHairs() {
    var g = $('kwHairGrid'); if (!g || !window.KChar || !KChar.hairs) return;
    var hs = KChar.hairs(), cur = KChar.hair(), o = KChar.outfit();
    if ($('kwHairCount')) $('kwHairCount').textContent = String(hs.length);
    g.innerHTML = hs.map(function (h) {
      var on = h.id === cur.id, ready = KChar.hasLook(h.id, o.id);
      return '<button type="button" class="kw-item' + (on ? ' on' : '') + '" data-hair="' + esc(h.id) + '">' +
        '<span class="kw-th"><img src="' + esc(KChar.hairThumbUrl(h)) + '" alt="" loading="lazy">' + (on ? '<span class="kw-on">하는 중</span>' : '') +
        (!ready ? '<span class="kw-soon">이 옷은 준비 중</span>' : '') + '</span>' +
        '<span class="kw-nm">' + esc(h.name) + '</span></button>';
    }).join('') +
      '<button type="button" class="kw-item new" data-kreq="hair"><span class="kw-th"><div><svg><use href="#i-plus"/></svg>추가 요청</div></span><span class="kw-nm">새 머리 부탁하기</span></button>';
    var note = $('kwHairNote');
    if (note) {
      var st = KChar.catalogState ? KChar.catalogState() : { source: 'bundle' };
      var msg = '';
      if (cur.id !== KChar.defaultHair && !KChar.hasLook(cur.id, o.id)) msg = '「' + cur.name + '」 + 「' + o.name + '」 사진은 준비 중이라 지금은 기본 머리 사진으로 보여요.';
      else if (cur.id !== KChar.defaultHair) msg = '기본 단발이 아닐 때는 표정 변화·움직임 없이 사진 한 장으로 보여요.';
      else if (st.source === 'bundle' && hs.length <= 1) msg = '머리 목록을 불러오지 못했어요(인터넷 연결 확인). 지금은 기본 머리만 보여요.';
      note.textContent = msg;
      note.style.display = msg ? 'block' : 'none';
    }
  }
  // (O-0116) 꾸미기 상단: 상반신 옆에 전신. 전신 사진이 없는 옷/머리 조합은 예전처럼 상반신 한 장.
  function stopKFullBow() {
    var fb = $('kwFull'), v = $('kwFullVid'); if (!fb || !v) return;
    fb.classList.remove('bowing');
    try { v.pause(); } catch (e) {}
  }
  function renderKFull() {
    var hero = $('kwHero'), img = $('kwFullImg'); if (!hero || !img || !window.KChar || !KChar.fullbodyUrl) return;
    var u = KChar.fullbodyUrl();
    hero.classList.toggle('has-fb', !!u);
    stopKFullBow();
    if (u && img.getAttribute('src') !== u) img.setAttribute('src', u);
    var bow = KChar.bowUrl ? KChar.bowUrl() : '';
    if ($('kwFullTip')) $('kwFullTip').style.display = (bow && KChar.motionOn()) ? '' : 'none';
  }
  if ($('kwFull')) $('kwFull').addEventListener('click', function () {
    if (!window.KChar) return;
    var v = $('kwFullVid'), fb = this, bow = KChar.bowUrl ? KChar.bowUrl() : '';
    if (!bow || !KChar.motionOn() || !v) return;          // 인사 영상이 없거나 움직임 꺼짐 → 사진 그대로
    if (fb.classList.contains('bowing')) { stopKFullBow(); return; }
    if (v.getAttribute('src') !== bow) { v.setAttribute('src', bow); try { v.load(); } catch (e) {} }
    try { v.currentTime = 0; } catch (e) {}
    v.onplaying = function () { fb.classList.add('bowing'); };
    v.onended = function () { stopKFullBow(); };
    v.onerror = function () { stopKFullBow(); };
    try { var p = v.play(); if (p && p.catch) p.catch(function () { stopKFullBow(); }); } catch (e) { stopKFullBow(); }
  });
  // (O-0116) 시작 인사 설정: 하루 첫 실행만(기본) / 켤 때마다 / 끄기 + [지금 보기]
  function renderKIntro() {
    if (!window.KIntro) return;
    var p = KIntro.pref();
    Array.prototype.forEach.call(document.querySelectorAll('[data-kintro]'), function (b) { b.classList.toggle('on', b.getAttribute('data-kintro') === p); });
    var why = KIntro.blockReason();
    if ($('kwIntroWhy')) $('kwIntroWhy').textContent = (p !== 'off' && why) ? ('지금은 안 나와요: ' + why) : '';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-kintro]'), function (b) {
    b.addEventListener('click', function () {
      if (!window.KIntro) return;
      var v = b.getAttribute('data-kintro'); KIntro.setPref(v); renderKIntro();
      toast(v === 'off' ? '시작 인사를 껐어요.' : v === 'always' ? '앱을 켤 때마다 케이가 인사해요.' : '하루 처음 켤 때만 케이가 인사해요.');
    });
  });
  if ($('kwIntroTry')) $('kwIntroTry').addEventListener('click', function () { if (window.KIntro) KIntro.play(); });
  function setKwTab(which) {
    var hairTab = which === 'hair';
    if ($('kwTabOutfit')) $('kwTabOutfit').classList.toggle('on', !hairTab);
    if ($('kwTabHair')) $('kwTabHair').classList.toggle('on', hairTab);
    if ($('kwOutfitPane')) $('kwOutfitPane').style.display = hairTab ? 'none' : '';
    if ($('kwHairPane')) $('kwHairPane').style.display = hairTab ? '' : 'none';
  }
  if ($('kwTabOutfit')) $('kwTabOutfit').addEventListener('click', function () { setKwTab('outfit'); });
  if ($('kwTabHair')) $('kwTabHair').addEventListener('click', function () { setKwTab('hair'); });
  // O-0040: [＋ 추가 요청] — 한 줄 입력 → 기존 케이 채팅 전송 경로(sendPlainChat)로 보낸다(새 서버 API 없음)
  function kDecorRequestText(kind, text) { return '[케이 꾸미기 추가 요청] ' + (kind === 'hair' ? '머리' : '옷') + ': ' + text; }
  function openKDecorRequest(kind) {
    var isHair = kind === 'hair';
    modalTitle.textContent = isHair ? '새 머리 부탁하기' : '새 옷 부탁하기';
    modalBody.innerHTML = '<div class="card rcard"><div class="h"><svg><use href="#i-plus"/></svg>' + (isHair ? '어떤 머리 스타일을 원하세요?' : '어떤 옷을 원하세요?') + '</div>' +
      '<div style="padding:2px 2px 8px;line-height:1.6">한 줄로 적어 주시면 케이에게 보내요. 만들어지면 옷장에 추가돼요(앱을 다시 열면 보여요).</div>' +
      '<input id="kReqInput" type="text" maxlength="100" ' +
      'style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:15px" placeholder="' +
      (isHair ? '예: 어깨 길이 굵은 웨이브' : '예: 가을 트렌치코트') + '"></div>' +
      '<div class="btnrow">' +
      '<button id="kReqSend" class="btn primary"><svg><use href="#i-check"/></svg>보내기</button>' +
      '<button id="kReqCancel" class="btn ghost sm"><svg><use href="#i-x"/></svg>취소</button>' +
      '</div>';
    var inp = $('kReqInput');
    $('kReqCancel').addEventListener('click', closeModal);
    function go() {
      var t = ((inp && inp.value) || '').replace(/\s+/g, ' ').trim();
      if (!t) { toast(isHair ? '원하시는 머리를 적어 주세요.' : '원하시는 옷을 적어 주세요.'); return; }
      if (t.length > 100) t = t.slice(0, 100);
      closeModal();
      unlockKaiAudio();
      sendPlainChat(kDecorRequestText(kind, t), false).then(function (ok) {
        if (ok) toast('요청을 케이에게 보냈어요. 만들면 알려드릴게요.');
        else toast('요청을 보내지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      });
    }
    $('kReqSend').addEventListener('click', go);
    if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); go(); } });
    modal.style.display = 'flex';
    setTimeout(function () { if (inp) try { inp.focus(); } catch (e) {} }, 60);
  }
  function renderKVoices() {
    var box = $('kwVoices'); if (!box || !window.KChar) return;
    var V = KChar.voice, pref = V.pref(), vs = V.list();
    var act = V.active();                             // 고른 기기 음성이 지금 없으면 기본으로 표시
    var rows = ['<button type="button" class="kw-voice' + (!act ? ' on' : '') + '" data-voice="">' +
      '<span class="rd"></span><span class="tx"><b>케이 기본 목소리</b><small>한국어 여성 · 선희(무료 뉴럴 음성) · PC에서 만들어 보내요</small></span></button>'];
    vs.forEach(function (v) {
      var on = act && act.name === v.name;
      rows.push('<div class="kw-voice' + (on ? ' on' : '') + '" role="button" tabindex="0" data-voice="' + esc(v.name) + '">' +
        '<span class="rd"></span><span class="tx"><b>' + esc(v.name) + '</b><small>이 기기 음성' + (V.isFemaleGuess(v) ? ' · 여성' : '') + ' · 바로 읽어요</small></span>' +
        '<button type="button" class="try" data-try="' + esc(v.name) + '">미리 듣기</button></div>');
    });
    if (!V.supported()) rows.push('<div class="kw-vnote">이 기기(앱)는 내장 음성을 지원하지 않아 케이 기본 목소리만 쓸 수 있어요.</div>');
    else if (!vs.length) rows.push('<div class="kw-vnote">이 기기에 한국어 내장 음성이 없어 케이 기본 목소리만 쓸 수 있어요.</div>');
    else if (pref && !act) rows.push('<div class="kw-vnote">골라 두신 기기 음성(' + esc(pref) + ')을 찾지 못해 기본 목소리로 읽어요.</div>');
    box.innerHTML = rows.join('');
  }
  if (window.KChar) {
    KChar.voice.onVoices(function () { if (isOpen($('kWardrobeView'))) renderKVoices(); });
    KChar.onChange(function () { if (isOpen($('kWardrobeView'))) renderKWardrobe(); });
  }
  if ($('kWardrobeView')) $('kWardrobeView').addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t.closest || !window.KChar) return;
    var rq = t.closest('[data-kreq]');
    if (rq) { openKDecorRequest(rq.getAttribute('data-kreq')); return; }
    var hr = t.closest('[data-hair]');
    if (hr) {
      var hid = hr.getAttribute('data-hair');
      if (KChar.setHair(hid)) {
        renderKWardrobe(); if (isOpen(chatView)) renderChat();
        toast(KChar.hasLook(hid) ? '케이가 ' + KChar.hair().name + '(으)로 바꿨어요.' : KChar.hair().name + ' + 지금 옷 사진은 준비 중이라 기본 머리 사진으로 보여요.');
      }
      return;
    }
    var it = t.closest('[data-outfit]');
    if (it) {
      var id = it.getAttribute('data-outfit');
      if (KChar.setOutfit(id)) { renderKWardrobe(); if (isOpen(chatView)) renderChat(); toast('케이가 ' + KChar.outfit().name + '(으)로 갈아입었어요.'); }
      return;
    }
    var tr = t.closest('[data-try]');
    if (tr) {
      var v = null, nm = tr.getAttribute('data-try');
      KChar.voice.list().forEach(function (x) { if (x.name === nm) v = x; });
      if (v) KChar.voice.speak('대표님, 안녕하세요. 케이입니다. 이 목소리로 읽어 드릴게요.', v);
      return;
    }
    var vo = t.closest('[data-voice]');
    if (vo) { KChar.voice.setPref(vo.getAttribute('data-voice')); renderKVoices(); toast(vo.getAttribute('data-voice') ? '이 기기 음성으로 읽어 드릴게요.' : '케이 기본 목소리로 읽어 드릴게요.'); }
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
    if (opusNext) toast('다음에 보내는 1건을 오퍼스 5.5로 처리해요(보내면 자동으로 꺼져요).');
  });
  // v5.8: 작업 현황 열기(채팅 헤더 · 홈 카드)
  if ($('chatOrdersBtn')) $('chatOrdersBtn').addEventListener('click', function () { openOrders(true); });
  if ($('btnOrders')) $('btnOrders').addEventListener('click', function () { openOrders(false); });
  if ($('ordersRefresh')) $('ordersRefresh').addEventListener('click', function () { refreshOrders(false); toast('새로 불러왔어요.'); });
  // 음성 대화 모드(핸즈프리) 켜기/끄기
  if (chatConvoToggle) chatConvoToggle.addEventListener('click', function () {
    if (convoOn) stopConvo(false); else startConvo();
  });
  // 조합 중 미뤄둔 재렌더를 한 번에 반영(v4.5)
  function flushChatRender() {
    if (chatRenderDeferred) { chatRenderDeferred = false; if (isOpen(chatView)) renderChat(); }
  }
  if (chatInput) {
    // v4.7: 조합 상태(chatComposing)는 '대화목록 재렌더를 잠깐 미루는' 용도로만 쓴다.
    //   입력창(textarea)의 표시·높이확장은 조합 중에도 절대 막지 않는다 → 미확정 마지막 글자가 항상 보인다.
    //   (입력 이벤트의 isComposing 을 조합 판정의 최종 기준으로 삼는다 — compositionstart 가 늦는 IME 대비)
    chatInput.addEventListener('input', function (e) {
      chatComposing = !!(e && e.isComposing);   // 목록 재렌더 보류 판단용(true여도 아래 autoGrow는 그대로 실행)
      autoGrowChat();                            // 조합 중에도 입력창 높이 확장 → 마지막 글자 잘림 없음
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
  function pushChatFileMsg(files, chunked, userText, opus) {
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    userText = (userText || '').trim();
    var upFiles = Array.prototype.map.call(files, function (f) {
      return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) };
    });
    var names = upFiles.map(function (f) { return f.name; });
    var note = (userText ? (userText + '\n\n') : '') + '[파일 첨부] ' + names.join(', ') + ' — 대표님이 이 파일을 보내셨어요. 확인해 주세요.';
    var msg = { role: 'me', text: userText, ts: Date.now(), id: id, token: tok, answered: false, files: upFiles, up: true, uploading: true, opus: !!opus };
    chatMsgs.push(msg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var memo = { id: id, token: tok, thread: chatThread, title: names[0] || '파일', note: note };
    if (opus) memo.modelPref = 'opus';           // v5.8: 오퍼스 5.5 1회 지정
    var work = chunked ? OfficeBridge.sendChatChunked(memo, files[0]) : OfficeBridge.sendChatBatch(memo, files);
    work.then(function () {
      msg.uploading = false; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile(); kickOrderPoll();      // v5.8
    }).catch(function (e) {
      msg.answered = true; msg.uploading = false;
      chatMsgs.push({ role: 'k', text: '파일 전송이 안 됐어요(' + (e && e.message || e) + '). 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    });
  }
  // 파일을 고르면 '바로 보내지 않고' 대기줄(pending)에 붙인다 → 대표님이 계속 글을 쓸 수 있고, 전송 때 함께 나감.
  function onChatFilesPicked(fileList) {
    var arr = keepSendable(fileList);             // v6.6: 한 파일 5GB까지(45MB 넘으면 40MB 조각 전송)
    var removed = arr.removed;
    if (!arr.length) return;
    var room = Math.max(0, 10 - chatPendingFiles.length);
    if (arr.length > room) { arr = arr.slice(0, room); toast('파일은 한 번에 최대 10개까지예요.'); }
    if (!arr.length) return;
    chatPendingFiles = chatPendingFiles.concat(arr);
    renderPending();
    if (!removed) toast('파일을 붙였어요. 글을 더 쓰거나 전송을 누르세요.');
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
    var more = ev.target.closest ? ev.target.closest('.chatmorebtn') : null;   // v7.0: [이전 대화 더 보기]
    if (more) { loadOlderChat(); return; }
    var fb = ev.target.closest ? ev.target.closest('.bfoldbtn') : null;   // O-0111: [전체 보기 ▼]/[접기 ▲]
    if (fb) { toggleChatFold(fb); return; }
    var kav = ev.target.closest ? ev.target.closest('img.kav') : null;   // v6.0: 말풍선 옆 케이 사진 → 프로필 카드
    if (kav) { openKProfile(); return; }
    // 링크 탭 → 외부로 열기(선택 복사와 별개)
    var ln = ev.target.closest ? ev.target.closest('a.chatlink,[data-link]') : null;
    if (ln) { ev.preventDefault(); var lu = ln.getAttribute('data-link') || ln.getAttribute('href'); var lw = window.open(lu, '_blank'); if (!lw) toast('링크를 열지 못했어요.'); return; }
    if (ordDecideClick(ev)) return;                    // (O-0201 추가) 작업 카드 안 [승인]·[수정 요청]
    var oc = ev.target.closest ? ev.target.closest('.ordcard[data-ord]') : null;   // v5.8: 작업 카드 → 작업 현황(그 항목 강조)
    if (oc) { openOrders(true, oc.getAttribute('data-ord')); return; }
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

  // extra: { label, action } — 있으면 보조 버튼 하나 더 표시(선택)
  function openSheet(title, msg, confirmLabel, action, copyText, extra) {
    if (!sheetEl) return;
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
    sheetEl.style.display = 'flex';
  }
  function closeSheet() { if (sheetEl) sheetEl.style.display = 'none'; sheetAction = null; sheetCopyVal = null; sheetExtraAction = null; }
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
  }
  // v4.0: 한 메시지를 지우면 그 "대화 줄(turn) 전체"(질문+답)를 지우고, 서버에도 숨김 반영해 모든 기기서 사라지게.
  function rowIdOf(m) { return (m && (m.rid || m.id || m.cid || m.bid)) || null; }
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
    toast('삭제했어요.');
  }
  function openClearAllSheet() {
    if (!chatMsgs.length) { toast('지울 대화가 없어요.'); return; }
    openSheet('대화를 모두 삭제할까요?', '이 기기 화면의 대화가 모두 지워져요(다른 기기·서버 기록은 그대로). 되돌릴 수 없어요.', '전체 삭제', clearAllChat);
  }
  function clearAllChat() {
    // v4.0: 「전체 삭제」는 이 기기 뷰 정리 — '이 시각 이전' 서버 대화/방송을 이 기기서 다시 안 그리게 경계를 세운다.
    //   (개별 삭제만 서버 숨김으로 모든 기기 반영. 전체 삭제는 기기별 뷰 정리라 다른 기기엔 영향 없음.)
    try { localStorage.setItem(CHAT_CLEARED_KEY, new Date().toISOString()); } catch (e) {}
    chatMsgs = [];
    saveChatMsgs();
    officeHW = CHAT_EPOCH; chatSyncHW = CHAT_EPOCH;   // 다음 동기화는 경계 이후만 그린다
    chatOlder = null; chatHasMore = false;            // v7.0: 경계 이전 옛 쪽은 더 볼 게 없음(다음 열람 때 새로 잡음)
    stopChatReconcile();
    renderChat();
    updateSendEnabled();
    toast('이 기기의 대화를 모두 지웠어요.');
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
      linked ? 'PC와 폰이 연동되어 있어요.' : 'PC(크롬)에서도 같은 대화를 보려면 연동하세요.',
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
    h += '</div><div class="fs-preview"><div class="bubble k">대표님, 오늘 오후 3시에 학과 회의가 있어요. 회의자료는 아침에 보내 드렸어요.</div>' +
      '<div class="bubble me">고마워, 4시로 옮겨 줘</div></div>' +
      '<div class="sheet-hint">채팅·입력창·홈 카드·문서 뷰어 글에 적용돼요. 이 폰에만 저장돼요.</div>' +
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
  function toast(msg, ms) {        // v6.7: ms(선택) — 긴 안내(설치 허용 등)는 더 오래 보이게. 기본 1.8초 그대로
    if (!toastEl) return;
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
      '녹음 중이에요',
      '녹음을 멈추지 않고 다른 화면으로 갈 수 있어요. 화면을 옮겨도 녹음은 계속돼요.',
      '녹음 정지하고 나가기',
      function () {   // 정지 → onAudio → onRecorded → 완료 화면
        if (!isRecording) return;
        isRecording = false; stopRecTimer(); updateRecIndicator();
        try { recorder.stop(); } catch (e) {}
      },
      null,
      { label: '계속 녹음하며 나가기', action: function () {
          showHome(); setStatus('녹음 중(백그라운드)', 'rec');
          toast('녹음은 계속되고 있어요 — 아래 빨간 「녹음 중」을 누르면 녹음 화면으로 가요.');
        } }
    );
  }
  function goBack() {
    if (fsSheet) { closeFontSheet(); return true; }                        // v8.4: 글자 크기 창
    if (window.TodayCard && TodayCard.closeWeather && TodayCard.closeWeather()) return true;   // v8.5(O-0169): 오늘 날씨 창
    if (document.querySelector('.shin-sheet')) { try { document.querySelector('.shin-sheet').remove(); } catch (e) {} return true; }   // v8.4: 공유 고르기 창(문서·녹음)
    if (kProfile && isOpen(kProfile)) { closeKProfile(); return true; }   // v6.0: 케이 프로필 카드
    if (sheetEl && isOpen(sheetEl)) { closeSheet(); return true; }
    if ($('syncGate') && isOpen($('syncGate'))) { hideSyncGate(); return true; }   // PC 연동 암호창도 뒤로가기로 닫히게
    if (isOpen(modal)) { closeModal(); return true; }
    if (convoOn) { stopConvo(false); return true; }   // 연속 대화 중 뒤로 = 음성 대화 끝내기(화면 유지)
    if (chatRecording) { endListen('manualcancel'); return true; }   // 듣는 중 뒤로 = 이번 듣기 취소
    // 녹음 화면에서 뒤로 = 정지/계속 선택(예전엔 여기서 무조건 막혀 '먹통'이었음)
    if (isRecording && isOpen(recView)) { openRecLeaveSheet(); return true; }
    if (isOpen(processing)) { showHome(); setStatus('대기 중', 'idle'); toast('정리는 뒤에서 계속돼요 — 홈 「진행 중인 메모」에서 확인하세요.'); return true; }
    // 문서 뷰어: 전체화면 → 뷰어 → 고르기 → 홈 순으로 한 단계씩 빠져나온다(docRoot는 고정 오버레이)
    if (window.SmartDocs && SmartDocs.isFullscreen && SmartDocs.isFullscreen()) { try { SmartDocs.closeFullscreen(); } catch (e) {} return true; }
    if (window.SmartDocs && SmartDocs.isViewerOpen && SmartDocs.isViewerOpen()) { try { SmartDocs.showPick(); } catch (e) {} return true; }
    if (isOpen($('docsView'))) { showHome(); setStatus('대기 중', 'idle'); return true; }
    if (isOpen($('ideasView'))) {      // v5.5: 아이디어 수첩 — 녹음 중이면 '멈추고 보내기'(잠결 아이디어 유실 방지), 아니면 홈
      if (ideaRecording) { stopIdeaRec(); toast('녹음을 멈추고 보냈어요.'); return true; }
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
    if (isOpen($('calcView'))) {       // (O-0178) 계산기 — 기록이 열려 있으면 기록만 닫고, 아니면 홈으로
      if (window.SmartCalc && SmartCalc.closeHistory && SmartCalc.closeHistory()) return true;
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen($('meetingsView'))) {   // v5.2: 상세 열려 있으면 목록으로, 아니면 홈으로
      if (meetingsDetailOpen) { showMeetingsList(); return true; }
      showHome(); setStatus('대기 중', 'idle'); return true;
    }
    if (isOpen(filePanel) && filePanelFromChat) { filePanelFromChat = false; pendingFiles = []; pendingKind = null; openChat(); return true; }   // (O-0176) 채팅 ＋ 에서 왔으면 채팅으로
    if (isOpen(recPrep) || isOpen(recordedPanel) || isOpen(filePanel) || isOpen(searchPanel) || isOpen(resultWrap) || isOpen(chatView) || isOpen($('lockerView')) || isOpen($('healthView'))) {
      pendingMaterials = []; showHome(); setStatus('대기 중', 'idle'); stopLockerSync(); return true;
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
      if (isRecording) { openScreen(recView); toast('녹음 중이에요 — 정지 후 나가 주세요.'); return; }
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
    toast('보냈습니다 — 몇 분 안에 제안서를 보내드릴게요');
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
          x.status = 'failed'; x.err = 'PC가 받지 못했어요(전송이 서버까지 도달하지 못함).'; changed = true;
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
        if (!silent && isOpen(ideasView)) showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.');
      } else if (!silent) toast('아이디어 목록을 불러오지 못했어요. 잠시 후 다시 시도해요.');
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
      said = r.input === 'text' ? (r.text || '') : '(말씀하신 녹음 — PC에서 받아쓰는 중이에요)';
    } else {
      st = ideaStatus(r);
      said = [r.transcript || '', r.note || ''].filter(function (x) { return x && x.trim(); }).join('\n');
      if (!said) said = (r.status === 'done') ? '(인식된 말이 없어요)' : '(PC에서 받아쓰는 중이에요)';
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
      h += '<div class="idea-meta">⚠️ ' + esc(r.err || '전송하지 못했어요. 폰에 안전하게 보관돼 있어요.') + '</div>' +
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
        ? '<p class="empty-note">아이디어 목록을 보려면 PC 연동 암호가 필요해요.</p>'
        : '<p class="empty-note">' + (ideaFilter === 'all' ? '떠오른 생각을 말하거나 적어 보세요.<br>소장이 어떻게 활용할지 제안해 드려요.' : '이 갈래의 아이디어가 아직 없어요.') + '</p>';
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
      onStatus: function (s) { if (s === 'error') resetIdeaRecUI(); },
      onError: function (m) { toast('🎤 ' + m); resetIdeaRecUI(); },
      onAudio: function (blob) { onIdeaAudio(blob); }
    });
    return ideaRecorder;
  }
  function setIdeaRecUI(on) {
    if (ideaRecBtn) { ideaRecBtn.classList.toggle('stop', on); ideaRecBtn.classList.toggle('pulsing', on); }
    var ic = $('ideaRecIcon'); if (ic) ic.innerHTML = '<use href="#' + (on ? 'i-stop' : 'i-mic') + '"/>';
    if (ideaRecLabel) ideaRecLabel.textContent = on ? '듣고 있어요 00:00' : '눌러서 말하기';
    if (ideaRecHint) ideaRecHint.textContent = on ? '다 말씀하셨으면 한 번 더 누르세요 — 바로 보내요' : '한 번 누르면 바로 녹음, 다시 누르면 보내요';
  }
  function resetIdeaRecUI() {
    ideaRecording = false;
    if (ideaRecTick) { clearInterval(ideaRecTick); ideaRecTick = null; }
    if (ideaRecAuto) { clearTimeout(ideaRecAuto); ideaRecAuto = null; }
    setIdeaRecUI(false);
  }
  function startIdeaRec() {
    if (ideaRecording) return;
    if (isRecording) { toast('회의 녹음이 진행 중이에요. 먼저 마쳐 주세요.'); return; }
    if (chatRecording) { toast('케이와 음성 대화 중이에요. 먼저 마쳐 주세요.'); return; }
    if (!RecordingModule.isSupported()) { toast('이 기기에서는 녹음을 쓸 수 없어요. 글로 적어 주세요.'); return; }
    var r = ensureIdeaRecorder();
    ideaRecCancel = false; ideaRecording = true; ideaRecStart = Date.now();
    setIdeaRecUI(true);
    ideaRecTick = setInterval(function () {
      if (ideaRecLabel) ideaRecLabel.textContent = '듣고 있어요 ' + fmtSec((Date.now() - ideaRecStart) / 1000);
    }, 500);
    ideaRecAuto = setTimeout(function () { if (ideaRecording) { toast('5분이 지나 자동으로 보냈어요.'); stopIdeaRec(); } }, IDEA_MAX_REC_MS);
    try { r.start(); } catch (e) { toast('녹음을 시작하지 못했어요.'); resetIdeaRecUI(); }
  }
  function stopIdeaRec() {
    if (!ideaRecording) return;
    resetIdeaRecUI();
    if (ideaRecLabel) ideaRecLabel.textContent = '보내는 중…';
    try { ideaRecorder.stop(); } catch (e) { toast('녹음 정지에 실패했어요.'); setIdeaRecUI(false); }
  }
  function onIdeaAudio(blob) {
    setIdeaRecUI(false);
    if (ideaRecCancel) { ideaRecCancel = false; return; }
    var dur = (ideaRecorder && ideaRecorder.lastDurationMs) || 0;
    if (!blob || (blob.size || 0) < 1200 || (dur && dur < 700)) { toast('너무 짧아요. 버튼을 누르고 말씀한 뒤 다시 눌러 주세요.'); return; }
    var t = now();
    var memo = { id: OfficeBridge.uuid(), token: OfficeBridge.token(), title: '아이디어', kind: 'idea',
                 ext: OfficeBridge.extFromBlob(blob), date: t.date, time: t.time, materials: [] };
    upsertIdeaLocal({ id: memo.id, token: memo.token, ts: Date.now(), input: 'voice', status: 'sending' });
    renderIdeas();
    OfficeBridge.send(memo, blob).then(function () {
      upsertIdeaLocal({ id: memo.id, status: 'sent', ts: Date.now() });
      renderIdeas(); ideaSentToast(); startIdeaPoll();
    }).catch(function (e) {
      upsertIdeaLocal({ id: memo.id, status: 'failed', err: '전송 실패(인터넷 확인). 녹음은 폰에 안전하게 보관돼 있어요 — 연결되면 자동으로 다시 보내요.' });
      renderIdeas(); toast('⚠️ 전송 실패 — 녹음은 폰에 보관됐어요. 인터넷이 되면 자동으로 다시 보내요.');
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
      upsertIdeaLocal({ id: id, status: 'failed', err: '전송 실패(인터넷 확인). 적으신 글은 폰에 남아 있어요.' });
      renderIdeas(); toast('⚠️ 전송 실패 — 글은 남아 있어요. [다시 보내기]를 눌러 주세요.');
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
      upsertIdeaLocal({ id: id, status: 'failed' }); renderIdeas(); toast('아직 보내지 못했어요. 잠시 후 다시 눌러 주세요.');
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
        if (!ok) { toast('저장하지 못했어요(아직 정리 전일 수 있어요).'); return; }
        r.summary_json = Object.assign({}, r.summary_json || {}, { decision: decision, choice: decision === 'go' ? (choice || 0) : null });
        renderIdeas();
        if (decision === 'hold') { toast('보류로 표시했어요.'); return; }
        forwardIdeaToK(r, idea, choice || 0);
      }).catch(function (e) {
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
        else toast('저장에 실패했어요. 잠시 후 다시 시도해 주세요.');
      });
    };
    if (decision !== 'go') { doIt(); return; }
    openSheet('이 방향으로 진행할까요?',
      (choice + 1) + ') ' + (u.tag || '') + ' ' + (u.what || '') + '\n소장 K에게 채팅으로 전달돼요. 소장이 계획을 먼저 정리해 여쭤요.',
      '진행해줘', doIt);
    if (sheetConfirm) { sheetConfirm.classList.remove('danger'); var _u = sheetConfirm.querySelector('use'); if (_u) _u.setAttribute('href', '#i-check'); }   // 긍정 동작이라 휴지통·빨강 대신 ✓
  }
  // 진행해줘 → 소장 K 채팅으로 전달(대표님 이름으로 보내는 채팅 1건). 실패해도 결정 저장은 이미 끝남.
  function forwardIdeaToK(r, idea, choice) {
    var u = (idea.uses || [])[choice] || {};
    var said = [r.transcript || '', r.note || ''].filter(function (x) { return x && x.trim(); }).join(' ').slice(0, 300);
    var text = '💡 [아이디어 진행 요청] 「' + (idea.title || '아이디어') + '」\n' +
               '진행할 방향: ' + (choice + 1) + ') ' + (u.tag || '') + ' ' + (u.what || '') + ' — ' + (u.how || '') + '\n' +
               (choice !== (idea.pick || 0) ? '(소장 추천은 ' + ((idea.pick || 0) + 1) + '번이었지만 이 방향으로 골랐어요)\n' : '') +
               '말한 내용: ' + said + '\n' +
               '소장님, 바로 만들지 말고 먼저 진행 계획(범위·일정·제가 승인할 것)을 정리해서 알려 주세요.';
    try {
      var cid = OfficeBridge.uuid(), tok = OfficeBridge.token();
      chatMsgs.push({ role: 'me', text: text, ts: Date.now(), id: cid, token: tok, answered: false });
      saveChatMsgs(); renderChat();
      OfficeBridge.sendChat(cid, tok, chatThread, text, { speak: false }).then(function () {
        startChatReconcile();
        toast('진행 요청을 소장 K에게 보냈어요. 채팅에서 답을 확인하세요.');
      }).catch(function () {
        var m = findMsg(cid); if (m) m.answered = true;
        saveChatMsgs(); renderChat();
        toast('결정은 저장됐지만 소장에게 전달하지 못했어요. 채팅으로 한 번 말씀해 주세요.');
      });
    } catch (e) { toast('결정은 저장됐어요. 소장 전달은 채팅으로 한 번 말씀해 주세요.'); }
  }

  /* ---- 삭제(소프트삭제 hide_memo 재사용 · 복구 가능) ---- */
  function deleteIdea(id) {
    var isLocal = !findIdeaRow(id);
    openSheet('이 아이디어를 지울까요?',
      isLocal ? '아직 PC로 보내지 못한 아이디어예요. 지우면 폰에 보관된 원본도 함께 지워져요.'
              : '목록에서 사라져요. 소프트삭제라 서버 원본은 남아 있어(복구 가능) 안심하셔도 돼요.',
      '삭제', function () {
        if (isLocal) { removeIdeaLocal(id); OfficeBridge.dropPending(id); renderIdeas(); toast('지웠어요.'); return; }
        var pass = getSyncPass();
        if (!pass) { showSyncGate(true, '삭제하려면 PC 연동 암호를 입력해 주세요.'); return; }
        OfficeBridge.hideMemo(id, pass).then(function () {
          ideaRows = ideaRows.filter(function (x) { return x.id !== id; });
          OfficeBridge.dropPending(id);                             // 폰에 남은 원본(있으면)도 정리
          removeIdeaLocal(id); renderIdeas(); toast('지웠어요.');
        }).catch(function (e) {
          if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
          else toast('삭제에 실패했어요. 잠시 후 다시 시도해 주세요.');
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
    edit: { download: downloadAttachment } }); } catch (e) {} }   // O-0171 PC에서 편집하기 — 고친 파일 받기는 채팅 첨부와 같은 저장 경로

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
      if (!entries.length) { fail('보던 문서를 보내지 못했어요. 문서를 다시 열고 [케이에게 묻기]를 눌러 주세요.'); return; }
      var hw = where || '문서';
      var head = '[문서 보며 질문] 대표님이 스마트비서 문서 뷰어에서 「' + act.name + '」 ' + hw +
                 (act.pages && !(act.kind === 'excel' && act.view !== 'pdf') ? '(전체 ' + act.pages + '쪽)' : '') + josaEulReul(hw) + ' 보다가 보내셨어요.';
      var note = p.question + '\n\n' + head + '\n보낸 문서:\n' + lines.join('\n') +
                 (dropped.length ? '\n(못 보낸 문서: ' + dropped.join(', ') + ' — 내용은 추측하지 말 것)' : '');
      var memo = { id: id, token: tok, thread: chatThread, title: act.name.slice(0, 40), note: note,
                   extraMeta: { speak: !!convoOn, doc_ctx: { v: 1, all: !!p.all, chip: p.chip || null, docs: ctxDocs } } };
      if (dropped.length) toast('너무 크거나 사본이 없는 문서는 빼고 보냈어요: ' + dropped.join(', '));
      var one = entries.length === 1 && entries[0].file && entries[0].file.size > CHAT_CHUNK_LIMIT;
      var work = one ? OfficeBridge.sendChatChunked(memo, entries[0].file) : OfficeBridge.sendChatDocAsk(memo, entries);
      if (one) toast('큰 문서라 나눠 올려요 — 시간이 걸릴 수 있어요.');
      return work.then(function () {
        msg.uploading = false; saveChatMsgs();
        if (isOpen(chatView)) renderChat();
        startChatReconcile(); kickOrderPoll();
        toast('보던 문서는 「문서 보기 → 이어서 보기」에 그대로 있어요.');
      });
    }).catch(function (e) {
      var why = (e && (e.friendly || e.message)) || String(e);
      fail('문서를 케이에게 보내지 못했어요(' + why + '). 인터넷 연결을 확인하고 문서 화면에서 다시 눌러 주세요.');
    });
  }
  if ($('btnDocs')) $('btnDocs').addEventListener('click', openDocs);
  // 채팅 첨부(케이가 보낸 문서)의 [뷰어로 보기] → 문서 뷰어 화면으로 바로 표시
  function openDocFromChat(att) {
    openScreen(docsView);
    if (window.SmartDocs && SmartDocs.viewChatAttachment) { try { SmartDocs.viewChatAttachment(att); } catch (e) { toast('문서를 여는 데 실패했어요.'); } }
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
      var tip = /60MB/.test(d.error) ? ' 큰 파일은 스마트비서의 「문서 보기」·「공유함」·채팅 첨부에서 직접 고르면 5GB까지 보낼 수 있어요.' : '';
      toast((d.error || '공유된 문서를 여는 데 실패했어요.') + tip); return;
    }
    try {
      var bytes = b64ToBytes(d.b64);
      var f = new File([bytes], d.name || 'document', { type: d.mime || 'application/octet-stream' });
      openScreen(docsView);
      if (window.SmartDocs && SmartDocs.handleLocalFile) { SmartDocs.handleLocalFile(f); }
      else { toast('문서 뷰어를 준비하지 못했어요.'); }
    } catch (e) { toast('공유된 문서를 여는 데 실패했어요.'); }
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
    showSyncGate(true, need ? '보내려면 연동 암호가 필요해요. 입력해 주세요.' : '암호가 맞지 않아요. 다시 입력해 주세요.');
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
  try { var _av = $('appVer'); if (_av) _av.textContent = '스마트비서 ' + APP_VERSION; } catch (e) {}
  setTimeout(function () { try { if (getSyncPass()) refreshOrders(true); } catch (e) {} }, 1500);   // v5.8: 시작 시 홈 「작업 현황」 숫자

  /* (O-0129) 홈 「오늘 한눈에」 카드(today-card.js)가 쓰는 창구 — 화면 이동·시트·초안만 넘긴다(데이터 쓰기 없음). */
  window.SmartHome = {
    getSyncPass: getSyncPass,
    needPass: function (msg) { showSyncGate(true, msg || ''); },   // v7.5(O-0130) 건강 탭 RPC 가 암호 없음/틀림일 때
    refreshOrders: function () { try { refreshOrders(true); } catch (e) {} },
    toast: function (msg, ms) { toast(msg, ms); },   // (O-0133) 일정 [길찾기] 안내
    openOrders: function (hlId) { openOrders(false, hlId || ''); },
    openReminders: function () { openReminders(); },   // (O-0176) 오늘 한눈에 「예약한 알림」 한 줄 → 목록·취소
    // (O-0178) 계산기 [케이에게 묻기] 「이 계산 맞는지 봐 줘」: 채팅을 열고 그 글을 평소 전송 경로(sendChatMsg → submit_memo)로 바로 보낸다.
    //   입력창에 쓰던 글이 있으면 덮어쓰지 않고 채워만 둔다(대표님이 보고 보내시게).
    sendText: function (text) {
      openChat();
      var ci = $('chatInput'); if (!ci) return;
      var had = (ci.value || '').trim();
      ci.value = had ? had + '\n' + (text || '') : (text || '');
      try { ci.dispatchEvent(new Event('input')); } catch (e) {}
      if (!had) { try { sendChatMsg(); } catch (e) {} }
    },
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
      if (window.SmartDocs && SmartDocs.handleLocalFile) { try { SmartDocs.handleLocalFile(f); } catch (e) { toast('문서를 여는 데 실패했어요.'); } }
      else toast('문서 뷰어를 준비하지 못했어요.');
    }
  };
  setTimeout(function () { try { if (window.TodayCard) TodayCard.refresh(true); } catch (e) {} }, 1600);

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
    if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
    if (bodyEl) bodyEl.innerHTML = '<div class="empty-note">' + (e && e.notready ? '서버 준비가 아직 안 됐어요(소장에게 알려 주세요).'
      : (e && e.badpass ? '연동 암호를 넣으면 ' + what + '이(가) 보여요.' : what + '을(를) 불러오지 못했어요. 잠시 뒤 새로고침을 눌러 주세요.')) + '</div>';
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
      toast(on ? '⭐ 저장했어요 — 채팅 맨 위 ☆ 「저장한 답」에서 모아 볼 수 있어요.' : '저장을 풀었어요.');
      if (isOpen($('starsView'))) loadStars();
    }).catch(function (e) {
      if (on) delete starIds[memoId]; else starIds[memoId] = 1;
      saveStarIds(); if (isOpen(chatView)) renderChat();
      if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
      else toast(e && e.notready ? '서버 준비가 아직 안 됐어요.' : (on ? '저장하지 못했어요. 잠시 뒤 다시 해 주세요.' : '저장을 풀지 못했어요.'));
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
    if (!p) { body.innerHTML = '<div class="empty-note">연동 암호를 넣으면 저장한 답이 보여요.</div>'; return; }
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
      body.innerHTML = '<div class="empty-note">' + (q ? '“' + esc(q) + '”이(가) 들어간 저장한 답이 없어요.'
        : '아직 저장한 답이 없어요.<br>채팅에서 케이 답의 [⋯] → 「⭐ 저장」을 눌러 보세요.') + '</div>';
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
      openSheet('저장을 풀까요?', '「저장한 답」 목록에서만 빠지고, 대화는 그대로 남아요.', '저장 해제', function () {
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
    toast('그 대화를 찾는 중이에요…', 1500);
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
      toast('대화에서 그 답을 찾지 못했어요(이 기기에서 지웠을 수 있어요).', 3200);
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
    if (!p) { body.innerHTML = '<div class="empty-note">연동 암호를 넣으면 예약한 알림이 보여요.</div>'; return; }
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
      : '<div class="empty-note">예약된 알림이 없어요.<br>위 [말로 맡기기]를 누르고 “내일 아침 8시에 우산 챙기라고 알려 줘”처럼 말씀해 보세요.</div>';
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
        toast(ok ? '알림을 취소했어요.' : '이미 지나갔거나 취소된 알림이에요.');
        loadReminders();
      }).catch(function (e) {
        if (e && e.badpass) { setSyncPass(''); showSyncGate(true, '암호가 맞지 않아요. 다시 입력해 주세요.'); }
        else toast('취소하지 못했어요. 잠시 뒤 다시 해 주세요.');
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
          text: '알림에서 보내신 답장 ' + failed.length + '건은 ' + (passFail ? '연동 암호 확인이 안 돼' : '인터넷 문제로') + ' 전송되지 않았어요 — 「' + failed[0].slice(0, 40) + (failed[0].length > 40 ? '…' : '') + '」' + (failed.length > 1 ? ' 외' : '') + '. 필요하면 여기서 다시 보내 주세요.' });
      }
      if (added || failed.length) {
        sortChatByTime(); saveChatMsgs();
        if (isOpen(chatView)) renderChat();
        if (added) startChatReconcile();
      }
    }).catch(function () {});
  }
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
      setTimeout(function () { if (btnStartRec && !isRecording) btnStartRec.click(); }, 250);
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
        else toast(getSyncPass() ? '오늘 한눈에를 불러오는 중이에요.' : '오늘 한눈에는 연동 암호를 넣으면 보여요.');
      }, 700);
    }
  }
  function onKLaunch(ev) {
    if (!ev) return;
    if (ev.kind === 'shortcut') { runShortcut(ev.name); return; }
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
        toast(cb.checked ? '위젯에는 「새 소식 N건」만 보여요.' : '위젯에 새 소식 한 줄이 보여요.');
      });
    }
  })();
})();
