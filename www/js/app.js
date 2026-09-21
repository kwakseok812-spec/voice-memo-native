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
  var MAT_MAX_MB = 40;                    // 자료 1개 상한(단일 업로드 안전선)
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

  /* ---------- 화면 전환(홈 ↔ 서브화면) ---------- */
  var SUBS = [recPrep, recView, recordedPanel, filePanelRef(), searchPanelRef(), $('chatView'), $('lockerView'), $('healthView'), $('docsView'), processing, resultWrap];
  function filePanelRef() { return $('filePanel'); }
  function searchPanelRef() { return $('searchPanel'); }
  var homeFooter = $('homeFooter');
  function showHome() {
    if (window.SmartDocs && SmartDocs.leave) { try { SmartDocs.leave(); } catch (e) {} }   // 문서 뷰어 오버레이 닫기
    SUBS.forEach(hide); clearSearch(); show(homeView); scrollTop();
    if (homeFooter) homeFooter.style.display = '';       // 하단 안내문은 홈에서만
    updateRecIndicator();
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
  function renderMatList() {
    var html;
    if (!pendingMaterials.length) {
      html = '<p class="empty" style="margin:4px 0">첨부한 회의자료가 없어요. (선택)</p>';
    } else {
      html = '<div class="vfiles">' + pendingMaterials.map(function (f, i) {
        var mb = Math.round((f.size || 0) / 1024 / 1024 * 10) / 10;
        return '<div class="filemeta"><svg><use href="#i-doc"/></svg>' + esc(f.name || '자료') +
          (mb ? ' · ' + mb + 'MB' : '') +
          ' <button type="button" class="matdel" data-i="' + i + '" aria-label="빼기" ' +
          'style="margin-left:auto;background:none;border:0;color:inherit;font-size:16px;cursor:pointer">✕</button></div>';
      }).join('') + '</div>';
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
  function openMatPicker() { if (matInput) matInput.click(); }   // 두 화면의 [회의자료 붙이기] 공용 — 바로 파일 선택 열림
  if (matAttach) matAttach.addEventListener('click', openMatPicker);
  if (matAttachPrep) matAttachPrep.addEventListener('click', openMatPicker);
  if (matInput) matInput.addEventListener('change', function () {
    var arr = Array.prototype.slice.call(this.files || []);
    var tooBig = arr.filter(function (f) { return (f.size || 0) > MAT_MAX_MB * 1024 * 1024; });
    arr = arr.filter(function (f) { return (f.size || 0) <= MAT_MAX_MB * 1024 * 1024; });
    if (tooBig.length) toast('⚠️ ' + tooBig.length + '개가 너무 커서(각 ' + MAT_MAX_MB + 'MB 초과) 제외했어요.');
    pendingMaterials = pendingMaterials.concat(arr);
    renderMatList();
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

  function onRecorded(blob) {
    stopRecTimer(); isRecording = false;
    if (recCancelled) { recCancelled = false; pendingBlob = null; showHome(); return; }
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
      HistoryModule.update(memo.id, { status: 'failed', error: String(e && e.message || e) });
      renderHistory(); showHome();
      showBanner('⚠️ 전송 실패(오프라인일 수 있어요). 녹음은 안전하게 보관됐어요 — 인터넷 되면 <b>지난 메모</b>에서 다시 눌러 보세요.');
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
      toast('임시 저장했어요. 지난 메모에서 자료를 붙여 보낼 수 있어요.');
    }).catch(function () { showBanner('임시 저장에 실패했어요. 녹음은 아직 화면에 있어요.'); });
  });
  // 지난 메모의 임시저장 항목 → 자료 붙이기 + 보내기 + 삭제
  function openDraftModal(e) {
    OfficeBridge.getDraft(e.id).then(function (rec) {
      var matN = (rec && rec.materials && rec.materials.length) || 0;
      modalTitle.textContent = (e.title || '메모') + '  ·  ' + (e.date || '');
      var html = '<div class="card rcard"><div class="h"><svg><use href="#i-mic"/></svg>임시 저장된 녹음</div>' +
        '<div style="padding:2px 2px 0;line-height:1.6">' +
        '이 녹음은 폰에 임시 저장돼 있어요(<b>아직 PC로 안 보냈어요</b>).<br>' +
        '회의자료(선택)를 붙이고 <b>PC로 보내기</b>를 누르면 녹음+자료를 함께 정리해 드려요.<br>' +
        '<b>붙인 자료:</b> <span id="mDraftMatN">' + matN + '</span>개' +
        '</div></div>' +
        '<div class="btnrow">' +
        '<button id="mDraftAttach" class="btn ghost"><svg><use href="#i-plus"/></svg>회의자료 붙이기</button>' +
        '<button id="mDraftSend" class="btn primary"><svg><use href="#i-spark"/></svg>PC로 보내기</button>' +
        '</div>' +
        '<div class="btnrow"><button id="mDraftDel" class="btn ghost sm danger"><svg><use href="#i-trash"/></svg>삭제</button></div>';
      modalBody.innerHTML = html;
      $('mDraftAttach').addEventListener('click', function () { draftAttachId = e.id; if ($('draftMatInput')) $('draftMatInput').click(); });
      $('mDraftSend').addEventListener('click', function () { closeModal(); resumeSendDraft(e.id); });
      $('mDraftDel').addEventListener('click', function () {
        OfficeBridge.delDraft(e.id); HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('임시 저장을 삭제했어요.');
      });
      modal.style.display = 'flex';
    });
  }
  // 임시저장 재개 시 자료 첨부 전용 입력(모달에서 [회의자료 붙이기])
  var draftAttachId = null;
  if ($('draftMatInput')) $('draftMatInput').addEventListener('change', function () {
    var fs = Array.prototype.slice.call(this.files || []); this.value = '';
    var id = draftAttachId; if (!id || !fs.length) return;
    OfficeBridge.getDraft(id).then(function (rec) {
      if (!rec) { toast('임시 저장을 찾지 못했어요.'); return; }
      rec.materials = (rec.materials || []).concat(fs);
      OfficeBridge.saveDraft(rec).then(function (ok) {
        if (!ok) { toast('자료 붙이기에 실패했어요.'); return; }
        var span = $('mDraftMatN'); if (span) span.textContent = String(rec.materials.length);
        toast('자료 ' + fs.length + '개를 붙였어요. [PC로 보내기]를 누르면 함께 정리돼요.');
      });
    });
  });
  // 임시저장 → 실제 발송(대표님이 [PC 보내기]를 눌렀을 때만 실행). 기존 send/sendAudioChunked 재사용.
  //  실패 시: draft 는 그대로 두고(유실 방지), send 가 pending 에 남긴 잔재는 dropPending 으로 제거해 자동발송을 막는다.
  function resumeSendDraft(id) {
    OfficeBridge.getDraft(id).then(function (rec) {
      if (!rec || !rec.blob) { showBanner('임시 저장한 녹음을 찾지 못했어요.'); renderHistory(); return; }
      var memo = { id: rec.id, token: rec.token, title: rec.title, ext: rec.ext, date: rec.date, time: rec.time,
                   materials: rec.materials || [] };
      var blob = rec.blob;
      if ((blob.size || 0) > OfficeBridge.CHUNK_SIZE) {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' });
        videoProg[id] = '올릴 준비 중…'; renderHistory();
        OfficeBridge.sendAudioChunked(memo, blob, function (phase, done, total) { videoProg[id] = '올리는 중 ' + done + '/' + total + ' 조각'; renderHistory(); })
          .then(function () { OfficeBridge.delDraft(id); HistoryModule.update(id, { status: 'processing' }); videoProg[id] = 'PC에서 정리 준비 중…'; renderHistory(); startVideoPolling(id, memo.token); })
          .catch(function () { OfficeBridge.dropPending(id); delete videoProg[id]; HistoryModule.update(id, { status: 'draft' }); renderHistory(); showHome(); showBanner('⚠️ 전송 실패 — 임시 저장은 그대로 있어요. 지난 메모에서 다시 보내세요.'); });
        toast('긴 녹음은 조각으로 나눠 보내요. 지난 메모에서 진행 상태를 볼 수 있어요.'); showHome();
      } else {
        HistoryModule.update(id, { status: 'pending', kind: 'audio' }); renderHistory();
        openScreen(processing); setProcessing('🖥️ PC로 보내는 중…');
        OfficeBridge.send(memo, blob).then(function () {
          OfficeBridge.delDraft(id);
          HistoryModule.update(id, { status: 'processing' }); renderHistory();
          setProcessing('🖨️ PC에서 정리 중… 잠시만요 (처음엔 1~2분 걸릴 수 있어요)');
          startPolling(id, memo.token);
        }).catch(function () {
          OfficeBridge.dropPending(id);                 // send 가 pending 에 넣은 잔재 제거 → 자동발송 방지
          HistoryModule.update(id, { status: 'draft', error: null }); renderHistory(); showHome();
          showBanner('⚠️ 전송 실패(오프라인일 수 있어요). 임시 저장은 그대로 있어요 — 지난 메모에서 다시 보내세요.');
          setStatus('전송 실패', 'err');
        });
      }
    });
  }

  /* ---------- 결과 폴링 ---------- */
  function startPolling(id, token) {
    stopPolling(); pollingId = id;
    var started = Date.now();
    pollTimer = setInterval(function () {
      OfficeBridge.poll(id, token).then(function (res) {
        if (!res) return;
        if (res.status === 'done') {
          stopPolling();
          HistoryModule.update(id, {
            status: 'done', kind: res.kind, transcript: res.transcript, summary_json: res.summary_json,
            content_md: res.content_md, pdf_url: res.pdf_url, docx_url: res.docx_url, pptx_url: res.pptx_url,
            title: res.title, error: res.error || null
          });
          renderHistory(); setStatus('정리 완료', 'idle');
          if (isOpen(processing)) showResult(id);            // 기다리는 중이면 결과로 이동
          else toast('✅ 정리 완료 — 지난 메모에서 볼 수 있어요.');  // 홈 등에 있으면 방해 없이 알림만
        } else if (res.status === 'processing') {
          setProcessing('🖨️ PC에서 정리 중… 잠시만요');
        } else if (res.error) {
          setProcessing('처리 중 문제가 있었어요. 잠시 후 다시 시도돼요…');
        }
        if (Date.now() - started > 5 * 60 * 1000) {
          stopPolling(); showHome();
          showBanner('아직 정리 중이에요. PC가 켜져 있는지 확인하고, 잠시 후 <b>지난 메모</b>에서 다시 확인해 주세요.');
        }
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
  function renderCards(sj) {
    sj = sj || {};
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

  /* ---------- 지난 메모 ---------- */
  function iconFor(kind) { return kind === 'photo' ? 'i-image' : kind === 'video' ? 'i-video' : kind === 'search' ? 'i-card' : 'i-mic'; }
  function renderHistory() {
    var list = HistoryModule.list();
    if (historyCount) historyCount.textContent = list.length ? list.length + '건' : '';
    if (!list.length) { historyList.innerHTML = '<div class="empty-note">녹음·사진·영상·명함을 보내면 여기에 쌓여요.</div>'; return; }
    historyList.innerHTML = list.map(function (e) {
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
    }).join('');
    Array.prototype.forEach.call(historyList.querySelectorAll('.item'), function (el) {
      el.addEventListener('click', function () { onHistoryClick(el.getAttribute('data-id')); });
    });
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
    } else {
      openScreen(processing); setProcessing('🖨️ PC에서 정리 중… 잠시만요'); startPolling(id, e.token);
    }
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
    $('mFailDel').addEventListener('click', function () { HistoryModule.remove(e.id); closeModal(); renderHistory(); toast('삭제했어요.'); });
    modal.style.display = 'flex';
  }
  function retryFailedMemo(id) {
    var e = HistoryModule.get(id); if (!e) return;
    toast('다시 보내는 중…');
    HistoryModule.update(id, { status: 'processing', error: null });   // 즉시 '정리중'으로 보이게(재시도 시작 표시)
    renderHistory();
    var handled = false;
    OfficeBridge.flush(function (memo) {
      if (memo.id === id) {           // 대기열에서 이 항목 재업로드 성공 → 결과 폴링
        handled = true;
        HistoryModule.update(id, { status: 'processing', error: null }); renderHistory();
        startPolling(id, e.token);
      }
    }).then(function () {
      if (!handled) {                 // 못 보냈으면(대기열에 없음/또 실패) 실패로 되돌리고 사유 안내
        HistoryModule.update(id, { status: 'failed' }); renderHistory();
        showBanner('⚠️ 다시 보내기에 실패했어요. 인터넷 연결과 PC 상태를 확인하고 잠시 후 다시 시도해 주세요.');
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
  function closeModal() { modal.style.display = 'none'; }
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });

  /* ===================== 사진·영상: 미리보기 + 설명 → 묶음 전송 ===================== */
  var filePanel = $('filePanel'), pendingFiles = [], pendingKind = null;
  var MAX_MB = 45;

  function reviewFiles(fileList, kind) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    // 사진만 용량 제한(각 45MB). 영상은 큰 것도 허용(큰 영상은 조각으로 나눠 전송).
    if (kind === 'photo') {
      var tooBig = arr.filter(function (f) { return (f.size || 0) > MAX_MB * 1024 * 1024; });
      arr = arr.filter(function (f) { return (f.size || 0) <= MAX_MB * 1024 * 1024; });
      if (tooBig.length) toast('⚠️ ' + tooBig.length + '개가 너무 커서(각 ' + MAX_MB + 'MB 초과) 제외했어요.');
    }
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
        var r = new FileReader(); r.onload = function () { im.src = r.result; }; r.readAsDataURL(f);
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
  if ($('fileCancel')) $('fileCancel').addEventListener('click', function () { pendingFiles = []; pendingKind = null; showHome(); });
  if ($('fileSend')) $('fileSend').addEventListener('click', function () {
    if (!pendingFiles.length) { showHome(); return; }
    var files = pendingFiles, kind = pendingKind;
    var title = ($('fileTitle').value || '').trim();
    var note = ($('fileNote').value || '').trim();
    var isCard = kind === 'photo' && $('isCard') && $('isCard').checked;
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
        toast('긴 영상 업로드 실패 — 지난 메모에서 다시 시도해 주세요.');
      });
    });
    toast('긴 영상은 시간이 걸려요. 다른 일 하셔도 돼요 — 지난 메모에서 진행 상태를 볼 수 있어요.');
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
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: String(e && e.message || e) });
      delete videoProg[memo.id]; renderHistory();
      toast('긴 음성 업로드 실패 — 지난 메모에서 다시 시도해 주세요.');
    });
    toast('긴 녹음은 조각으로 나눠 보내요. 다른 일 하셔도 돼요 — 지난 메모에서 진행 상태를 볼 수 있어요.');
    showHome();
  }
  function startVideoPolling(id, token) {
    if (videoPollers[id]) return;
    var started = Date.now();
    videoPollers[id] = setInterval(function () {
      OfficeBridge.poll(id, token).then(function (res) {
        if (!res) return;
        if (res.status === 'done') {
          clearInterval(videoPollers[id]); delete videoPollers[id]; delete videoProg[id];
          HistoryModule.update(id, {
            status: 'done', kind: res.kind, transcript: res.transcript, summary_json: res.summary_json,
            content_md: res.content_md, pdf_url: res.pdf_url, docx_url: res.docx_url, pptx_url: res.pptx_url,
            title: res.title, error: res.error || null
          });
          renderHistory();
          toast((res.kind === 'audio' ? '🎙️ 긴 녹음 정리 완료' : '🎬 영상 정리 완료') + ' — 지난 메모에서 볼 수 있어요.');
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
      showBanner('⚠️ 업로드 실패: ' + (e && e.message || e) + '. <b>지난 메모</b>에서 다시 눌러 주세요.');
    });
  }
  if ($('btnPhoto')) $('btnPhoto').addEventListener('click', function () { $('photoInput').click(); });
  if ($('btnVideo')) $('btnVideo').addEventListener('click', function () { $('videoInput').click(); });
  $('photoInput').addEventListener('change', function () { if (this.files && this.files.length) reviewFiles(this.files, 'photo'); this.value = ''; });
  $('videoInput').addEventListener('change', function () { if (this.files && this.files.length) reviewFiles(this.files, 'video'); this.value = ''; });

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
  var CHAT_THREAD_KEY = 'smart_chat_thread', CHAT_MSGS_KEY = 'smart_chat_msgs';
  var OFFICE_SINCE_KEY = 'smart_office_since';   // 케이 방송(office_broadcast)을 어디까지 가져왔는지 표식
  var DELETED_BIDS_KEY = 'smart_deleted_bids';   // 대표님이 지운 케이 방송(bid) 무덤 — 다시 안 그리게
  var chatThread = getChatThread(), chatMsgs = loadChatMsgs(), chatUnseen = 0, chatTimer = null;
  // ── PC↔폰 채팅 동기화(1단계) ───────────────────────────────────────────────
  var SYNC_SINCE_KEY = 'smart_chat_sync_since';   // 대화 동기화를 어디까지 가져왔는지 표식
  var SYNC_PASS_KEY = 'smart_sync_pass';          // 이 기기에 저장한 연동 암호
  var SYNC_PROMPTED_KEY = 'smart_sync_prompted';  // 첫 안내를 이미 띄웠는지(반복 안내 방지)
  var syncLoading = false, syncTimer = null;
  var deletedBids = loadDeletedBids();          // 대표님이 지운 방송/대화 행 id 목록(재출현 방지 · 로컬 tombstone)
  var officeLoading = false;
  // ── v4.0 멀티기기 일관성 ──────────────────────────────────────────────────
  //  마커를 localStorage 에 굳혀 두면(기기별·세션별로 '지금'에 멈춰) 다른 기기 이력이 안 보이고
  //  꼬였다. 대신 채팅을 '열 때마다' 서버 전체(EPOCH)에서 재구성하고, 세션 중에는 메모리 상의
  //  high-water(가장 최근 ts)로만 증분 조회한다 → 모든 기기가 열 때 같은 상태로 수렴, 마커 꼬임 없음.
  var CHAT_EPOCH = '1970-01-01T00:00:00.000Z';
  var chatSyncHW = CHAT_EPOCH;    // 대화 동기화 세션 high-water(메모리 전용, 열 때 EPOCH 로 리셋)
  var officeHW = CHAT_EPOCH;      // 케이 방송 세션 high-water(메모리 전용)
  var APP_VERSION = 'v4.3';       // M1: 화면에 표시해 대표님이 최신본인지 알게 한다 (v4.3: 답 기다리는 중에도 다음 메시지 바로 전송 가능 — 전송 잠금 해제, 케이는 FIFO 순차 처리)
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
  var HF = { THRESH: 0.05, POLL: 160, SILENCE_MS: 1600, NOSPEECH_MS: 7000, MAX_TURN_MS: 30000, MIN_SPEECH_MS: 400, MAX_MISS: 3 };

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
        kaiAudio.addEventListener('ended', function () {
          if (playingBubbleEl) { playingBubbleEl.classList.remove('playing'); playingBubbleEl = null; }
          if (convoOn) scheduleNextListen(350);   // 케이 목소리 끝 → 다음 말 듣기(연속 대화)
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
        if (convoOn) scheduleNextListen(900);   // 자동재생 막혀도 대화 루프는 이어감
        else toast('🔊 소리를 들으려면 "듣기"를 눌러 주세요.');
      });
    } catch (e) {}
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
          ? { role: 'me', text: m.text, ts: m.ts, id: m.id, token: m.token, answered: !!m.answered, files: m.files || null, up: !!m.up, vin: !!m.vin, uid: m.uid || null, cid: m.cid || null, rid: m.rid || null, remote: !!m.remote }
          : { role: 'k', text: m.text, ts: m.ts, files: m.files || null, bid: m.bid || null, vurl: m.vurl || null, uid: m.uid || null, notice: !!m.notice, cid: m.cid || null, rid: m.rid || null }; });
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
      var attrs = (!isUp && f.url) ? (' data-att-url="' + esc(f.url) + '"') : ' disabled';
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
  function downloadAttachment(url, name) {
    if (!url) return;
    var fname = name || (url.split('/').pop().split('?')[0]) || 'download';
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
        var w = window.open(url, '_blank');   // 폴백: 브라우저로 열어 저장
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
    function doScroll() {
      if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
      try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}
    }
    // 레이아웃이 아직 반영되지 않았을 수 있어 한 프레임 뒤 실행 + 짧은 지연으로 한 번 더(이미지·첨부 등 늦게 커지는 콘텐츠 대비)
    requestAnimationFrame(function () { requestAnimationFrame(doScroll); });
    setTimeout(doScroll, 80);
  }
  // 대표님 지시(2026-09-22, v4.3): 앞 답을 기다리는 중에도 다음 메시지를 '바로' 보낼 수 있어야 한다.
  //   각 질문은 고유 id/token 을 갖고, reconcileChat 이 질문마다 따로 poll 해 답을 그 질문에만 매칭한다.
  //   PC(chat_responder.py)도 pending 을 created_at 순(FIFO)으로 하나씩 처리하므로 여러 개가 동시에
  //   대기해도 순서·매칭이 엉키지 않는다 → 전송 버튼을 '대기 중'이라고 잠그지 않는다(항상 활성).
  function updateSendEnabled() { if (chatSend) chatSend.disabled = false; }
  function updateChatBadge() {
    var b = $('chatBadge'); if (!b) return;
    if (chatUnseen > 0) { b.textContent = chatUnseen > 9 ? '9+' : String(chatUnseen); b.style.display = 'inline-flex'; }
    else b.style.display = 'none';
  }
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
  function renderChat() {
    var q = chatSearchOn ? chatSearchQuery.trim().toLowerCase() : '';
    if (!chatMsgs.length && !q) {
      chatLog.innerHTML = '<div class="chatintro"><div class="chatintro-ic"><svg><use href="#i-spark"/></svg></div>' +
        '<b>안녕하세요, 대표님</b><p>무엇이든 물어보시거나 일을 시켜 보세요.<br>예: “내일 일정 정리해줘”, “학과 회의록 초안 만들어줘”.</p></div>';
      return;
    }
    var shown = 0;
    var html = chatMsgs.map(function (m) {
      if (m.role === 'typing') return '';
      if (q && !msgMatches(m, q)) return '';                // 검색 중이면 일치하는 말풍선만
      var inner = m.text ? (q ? chatTextHL(m.text, q) : chatText(m.text))
        : (m.vin ? '<span class="voicemark"><svg><use href="#i-mic"/></svg>음성 메시지</span>' : '');
      if (m.role === 'me' && m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span style="opacity:.75">올리는 중…</span>';
      inner += attachChips(m.files, m.role === 'me');
      if (m.role === 'k' && (m.text || m.vurl)) {           // 모든 케이 답에 [듣기](없으면 온디맨드 생성)
        if (!m.lid) m.lid = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        inner += '<button type="button" class="voiceplay" data-lid="' + m.lid + '"><svg><use href="#i-sound"/></svg>' + (m.vurl ? '다시 듣기' : '듣기') + '</button>';
      }
      if (!inner) return '';
      // 단순 알림성 방송(건강 리마인더·매시간 확인·봇 경보 등)은 「🔔 알림」 배지로 대화와 구분(2026-09-20)
      if (m.role === 'k' && m.notice) inner = '<div class="noticerow"><span class="noticebadge">🔔 알림</span></div>' + inner;
      shown++;
      // ⋯ 메뉴 버튼(복사·삭제). 텍스트 선택/복사를 방해하지 않게 우상단 고정.
      return '<div class="bubble ' + (m.role === 'me' ? 'me' : 'k') + (m.notice ? ' notice' : '') + '" data-uid="' + msgUid(m) + '">' + inner +
        '<button type="button" class="bmenu" aria-label="메시지 메뉴(복사·삭제)">⋯</button></div>';
    }).join('');
    if (q) {                                                // 검색 모드: 결과 안내 + (없으면) 빈 안내
      var info = $('chatSearchInfo');
      if (info) { info.style.display = 'block'; info.textContent = shown ? ('“' + chatSearchQuery.trim() + '” 검색 결과 ' + shown + '개') : '“' + chatSearchQuery.trim() + '”에 일치하는 대화가 없어요.'; }
      chatLog.innerHTML = html || '';
      chatLog.scrollTop = 0;
      try { window.scrollTo(0, 0); } catch (e) {}
      return;
    }
    if (anyAwaiting()) {
      html += '<div class="bubble k typing"><span></span><span></span><span></span></div>';
      // 답이 늦으면(약 35초 이상) "멈춘 것처럼" 보이지 않게 안내를 함께 띄운다
      var slowWait = chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token && (Date.now() - (m.ts || 0) > 35000); });
      if (slowWait) html += '<div class="waitnote">케이가 PC에서 확인 중이에요. 조금 걸릴 수 있어요.</div>';
    }
    chatLog.innerHTML = html;
    chatScrollBottom();
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
  function openChat(opts) {
    opts = opts || {};
    openScreen(chatView);
    // 검색 상태는 대화에 들어올 때 항상 닫힌 상태로 시작(바·안내·검색어 초기화)
    chatSearchOn = false; chatSearchQuery = '';
    if ($('chatSearchBar')) $('chatSearchBar').style.display = 'none';
    if ($('chatSearchInput')) $('chatSearchInput').value = '';
    if ($('chatSearchInfo')) { $('chatSearchInfo').style.display = 'none'; $('chatSearchInfo').textContent = ''; }
    chatUnseen = 0; updateChatBadge();
    setSeenHW(Date.now());                        // v4.2: '지금까지는 다 봤다'를 굳혀 둠 → 껐다 켜도 배지가 되살아나지 않음
    renderPending(); updateConvoToggle();        // 기본: 조용한 텍스트(음성 대화 모드 꺼짐)
    // v4.0: 채팅을 열 때마다 서버 전체에서 재구성한다 → 어느 기기서 열어도 같은 대화가 보인다.
    //   세션 high-water 를 EPOCH 로 리셋하면 다음 loadChatSync/loadOfficePushes 가 전체를 받아온다.
    chatSyncHW = CHAT_EPOCH; officeHW = CHAT_EPOCH;
    renderChat(); reconcileChat();               // 들어올 때 그동안 도착한 답을 즉시 반영
    loadOfficePushes();                          // 케이 방송 전체(삭제분 제외) 재구성
    startChatSync();                              // PC↔폰 대화 동기화(암호 있으면 폴링, 없으면 게이트 안내)
    // C4: 공유함과 동일 — 연동 암호가 없으면 조용히 넘기지 말고 매번 안내(암호 없으면 기기 간 대화가 안 보임).
    if (!getSyncPass()) showSyncGate(true);
    if (anyAwaiting()) startChatReconcile();
    // 진입 시 입력창 자동 포커스 안 함(대표님 지시) — 직접 탭했을 때만 브라우저 기본동작으로 포커스됨
  }
  // 입력창 높이 자동 조절. 키 입력마다 style.height='auto' 후 scrollHeight 를 읽으면
  // 그때마다 문서 전체 레이아웃이 강제로 다시 계산돼(대화가 길수록 무거워짐) 타이핑이 버벅인다.
  // → requestAnimationFrame 으로 한 프레임에 한 번만 재계산하게 합쳐 강제 리플로우를 줄인다(2026-09-21).
  var _agChatRaf = 0;
  function autoGrowChat() {
    if (!chatInput) return;
    if (_agChatRaf) return;                 // 이미 이번 프레임에 예약됨 → 중복 리플로우 방지
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
    var textUsed = false;
    // (1) 사진이 붙어 있으면 통합 전송(케이가 사진을 보고 답) — 글은 사진과 함께 감
    if (imgs.length) {
      chatPendingImages = [];
      sendChatTurnUI({ text: text, files: imgs, audioBlob: null });
      textUsed = true;
    }
    // (2) 파일이 붙어 있으면 파일 전송 — 글이 아직 안 쓰였으면 첫 파일 묶음에 함께 붙임
    if (files.length) {
      chatPendingFiles = [];
      var big = files.filter(function (f) { return (f.size || 0) > CHAT_CHUNK_LIMIT; });
      var small = files.filter(function (f) { return (f.size || 0) <= CHAT_CHUNK_LIMIT; });
      if (small.length) { pushChatFileMsg(small, false, textUsed ? '' : text); textUsed = true; }
      big.forEach(function (f) { pushChatFileMsg([f], true, textUsed ? '' : text); textUsed = true; });
      if (big.length) toast('큰 파일은 나눠 올려요 — 시간이 걸릴 수 있어요.');
    }
    renderPending();
    // (3) 남은 순수 텍스트(첨부가 하나도 없을 때) — 기존 경로(음성 답은 음성 대화 모드일 때만)
    if (!textUsed && text) {
      var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
      chatMsgs.push({ role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false });
      saveChatMsgs(); renderChat(); updateSendEnabled();
      OfficeBridge.sendChat(id, tok, chatThread, text, { speak: convoOn }).then(function () {
        startChatReconcile();
      }).catch(function () {
        var m = findMsg(id); if (m) m.answered = true;
        chatMsgs.push({ role: 'k', text: '죄송해요, 전송이 안 됐어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
        saveChatMsgs(); renderChat(); updateSendEnabled();
      });
    }
  }

  /* ---- 통합 전송: (선택)음성 + (선택)사진 + 텍스트 한 턴 → 케이가 보고/듣고 답 ---- */
  function sendChatTurnUI(o) {
    o = o || {};
    var text = (o.text || '').trim(), imgs = o.files || [], blob = o.audioBlob || null;
    if (!text && !imgs.length && !blob) return;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var dispFiles = imgs.map(function (f) { return { name: f.name || '사진', size: f.size || 0, mime: f.type || '', kind: 'image' }; });
    var meMsg = { role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false,
                  files: dispFiles.length ? dispFiles : null, up: true, uploading: true, vin: !!blob };
    chatMsgs.push(meMsg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var note = text;                              // 사진만 있고 말/글이 없으면 기본 질문
    if (!note && !blob && imgs.length) note = '이 사진을 보고 설명해 주세요.';
    var memo = { id: id, token: tok, thread: chatThread,
                 title: text ? text.slice(0, 20) : (blob ? '음성대화' : '사진'), note: note };
    OfficeBridge.sendChatTurn(memo, { audioBlob: blob, files: imgs, speak: convoOn }).then(function () {
      meMsg.uploading = false; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile();
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
    if (!chatConvoStatus) return;
    if (t) { chatConvoStatus.style.display = 'block'; chatConvoStatus.textContent = t; }
    else { chatConvoStatus.style.display = 'none'; chatConvoStatus.textContent = ''; }
  }
  function stopAmpPoll() { if (ampTimer) { clearInterval(ampTimer); ampTimer = null; } }
  function kaiPlaying() { return !!(kaiAudio && !kaiAudio.paused && !kaiAudio.ended && kaiAudio.currentTime > 0); }

  // 한 번의 듣기 turn 시작. auto=연속 대화 루프의 일부인지.
  function startListen(auto) {
    if (chatRecording) return;
    if (!isOpen(chatView)) return;
    if (anyAwaiting()) return;                    // 답 기다리는 중엔 안 들음
    if (kaiPlaying()) return;                     // ⚠️ 케이 목소리 재생 중엔 녹음 안 함(자기 목소리 오인 방지)
    if (isRecording) { toast('먼저 홈의 녹음을 마쳐 주세요.'); if (convoOn) stopConvo(true); return; }
    if (!RecordingModule.isSupported()) { toast('이 기기에서는 음성 입력을 쓸 수 없어요.'); if (convoOn) stopConvo(true); return; }
    unlockKaiAudio();
    var r = ensureChatRecorder();
    lsnSpoke = false; lsnSpeechMs = 0; lsnStartTs = Date.now(); lsnLastSound = Date.now(); lsnPendingSend = false; lsnReason = '';
    chatRecording = true; setChatMic(true);
    if (auto) setConvoStatus('말씀하세요… (끝나면 자동으로 보내요)');
    r.start();
    stopAmpPoll();
    ampTimer = setInterval(pollAmp, HF.POLL);
  }
  function pollAmp() {
    if (!chatRecording) { stopAmpPoll(); return; }
    var r = chatRecorder; if (!r || !r.getAmplitude) return;
    if (ampBusy) return; ampBusy = true;
    r.getAmplitude().then(function (level) {
      ampBusy = false;
      if (!chatRecording) return;
      var now = Date.now();
      if (level >= HF.THRESH) { lsnLastSound = now; lsnSpeechMs += HF.POLL; if (lsnSpeechMs >= HF.MIN_SPEECH_MS) lsnSpoke = true; }
      if (lsnSpoke && (now - lsnLastSound) >= HF.SILENCE_MS) { endListen('silence'); return; }
      if (!lsnSpoke && (now - lsnStartTs) >= HF.NOSPEECH_MS) { endListen('nospeech'); return; }
      if ((now - lsnStartTs) >= HF.MAX_TURN_MS) { endListen(lsnSpoke ? 'max' : 'nospeech'); return; }
    }).catch(function () { ampBusy = false; });
  }
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
      sendChatTurnUI({ text: '', files: imgs, audioBlob: blob });   // 음성(+있으면 사진) 전송
    } else {
      // 말이 없었음/취소
      if (convoOn) {
        convoMiss++;
        if (convoMiss >= HF.MAX_MISS) { stopConvo(true); toast('말씀이 없어 대화를 멈췄어요. 다시 시작하려면 「음성 대화」를 켜세요.'); }
        else { setConvoStatus('말씀을 기다려요…'); scheduleNextListen(500); }
      } else {
        if (lsnReason === 'nospeech') toast('말씀이 안 들렸어요. 다시 눌러 말씀해 주세요.');
      }
    }
  }
  function scheduleNextListen(delay) {
    if (!convoOn || nextListenArmed) return;
    nextListenArmed = true;
    setTimeout(function () {
      nextListenArmed = false;
      if (convoOn && isOpen(chatView) && !anyAwaiting() && !kaiPlaying()) startListen(true);
    }, delay || 400);
  }
  function startConvo() {
    if (convoOn) return;
    convoOn = true; convoMiss = 0; updateConvoToggle();
    toast('음성 대화를 시작해요. 말씀하시면 자동으로 오가요. 끝내려면 다시 누르세요.');
    if (!anyAwaiting() && !kaiPlaying()) startListen(true);
    else setConvoStatus('케이가 답하는 중…');
  }
  function stopConvo(auto) {
    convoOn = false; nextListenArmed = false; convoMiss = 0;
    updateConvoToggle(); stopAmpPoll();
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
    unlockKaiAudio();
    if (m.vurl) { playKaiVoice(m.vurl, btn); return; }
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
      try { var rd = new FileReader(); rd.onload = function () { im.src = rd.result; }; rd.readAsDataURL(f); } catch (e) {}
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
        try { var rd = new FileReader(); rd.onload = function () { im.src = rd.result; }; rd.readAsDataURL(f); } catch (e) {}
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
    arr = arr.filter(function (f) { return (f.size || 0) <= 45 * 1024 * 1024; });   // 각 45MB 이하
    var room = Math.max(0, 6 - chatPendingImages.length);
    if (arr.length > room) { arr = arr.slice(0, room); toast('사진은 한 번에 최대 6장까지예요.'); }
    if (!arr.length) return;
    chatPendingImages = chatPendingImages.concat(arr);
    renderPending();
    toast('사진을 붙였어요. 말하거나 질문을 적어 보내세요.');
  }
  function findMsg(id) { for (var i = 0; i < chatMsgs.length; i++) if (chatMsgs[i].id === id) return chatMsgs[i]; return null; }
  function startChatReconcile() {
    if (chatTimer) return;
    reconcileChat();
    chatTimer = setInterval(reconcileChat, 2500);
  }
  function stopChatReconcile() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }
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
      var limitMs = (m.files ? 20 : 6) * 60 * 1000;
      if ((nowT - (m.ts || 0)) > limitMs) {
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
    pending.forEach(function (m) { if (!m._slowShown && (nowT - (m.ts || 0)) > 35000) { m._slowShown = true; slowChanged = true; } });
    if (slowChanged && isOpen(chatView)) renderChat();
    pending.forEach(function (m) {
      if (m._polling) return; m._polling = true;
      OfficeBridge.poll(m.id, m.token).then(function (res) {
        m._polling = false;
        if (chatMsgs.indexOf(m) === -1) return;    // 사이에 이 질문이 삭제됐으면 답을 붙이지 않음
        if (m.answered || m._doneShown) return;    // 하드 타임아웃 sweep 이 이미 풀었으면 중복 처리 안 함
        if (res && res.status === 'done') {
          m.answered = true; m._doneShown = true;
          if (m.vin) m.text = (res.transcript || '').trim() || '(음성)';   // 음성 질문 → 전사문을 내 말풍선에 채움
          var reply = res.content_md || (res.summary_json && res.summary_json.reply) || '답을 못 만들었어요. 다시 물어봐 주세요.';
          var atts = OfficeBridge.attachmentsFrom(res);   // 케이가 보낸 첨부(하향)
          var vurl = res.summary_json && res.summary_json.voice_url;   // 케이 목소리(mp3)
          var kmsg = { role: 'k', text: reply, ts: Date.now(), rid: m.id };   // v4.0: 답도 같은 행 id(삭제 시 함께 숨김)
          if (atts.length) kmsg.files = atts;
          if (vurl) kmsg.vurl = vurl;
          chatMsgs.push(kmsg);
          saveChatMsgs();
          if (isOpen(chatView)) {
            renderChat();
            if (vurl) {                          // 음성 대화 모드 답 → 즉시 자동재생(끝나면 다음 듣기)
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
        } else if (Date.now() - (m.ts || 0) > (m.files ? 20 : 6) * 60 * 1000) {   // 파일 첨부는 여유롭게
          m.answered = true;
          chatMsgs.push({ role: 'k', text: '시간이 오래 걸려요. 다시 물어봐 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
          saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
        }
      }).catch(function () { m._polling = false; });
    });
  }
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
    if (officeLoading || !(window.OfficeBridge && OfficeBridge.listOfficePushes)) return;
    officeLoading = true;
    var since = officeSince();
    OfficeBridge.listOfficePushes(since).then(function (rows) {
      officeLoading = false;
      if (!rows || !rows.length) return;
      var added = 0, unseenAdded = 0, maxTs = since;   // added=화면에 새로 그린 수 / unseenAdded=배지로 셀 수(자동알림·이미 본 것 제외)
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (row.ts && row.ts > maxTs) maxTs = row.ts;
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
        if (isOpen(chatView)) { renderChat(); setSeenHW(maxTs); }   // 보고 있으면 방금 것까지 '본 것'으로 굳힘(재시작 후 재계산 방지)
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('케이가 새 소식을 보냈어요.'); }
      }
      officeHW = maxTs;   // v4.0: 세션 high-water 전진(메모리). 열 때 EPOCH 로 리셋되어 전체 재동기화됨
    }).catch(function () { officeLoading = false; });
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
  function setSyncPass(p) { try { if (p) localStorage.setItem(SYNC_PASS_KEY, p); else localStorage.removeItem(SYNC_PASS_KEY); } catch (e) {} }
  function syncSince() { return chatSyncHW; }   // v4.0: 메모리 high-water(열 때 EPOCH → 서버 전체 재구성)
  // 이 대화 줄(행 id)을 이미 갖고 있나? (내가 보낸 것 .id / 이미 받은 것 .cid 둘 다 검사)
  function hasChatRow(cid) {
    for (var i = 0; i < chatMsgs.length; i++) {
      if ((chatMsgs[i].id && chatMsgs[i].id === cid) || (chatMsgs[i].cid && chatMsgs[i].cid === cid)) return true;
    }
    return false;
  }
  function loadChatSync() {
    if (syncLoading || !(window.OfficeBridge && OfficeBridge.listChatHistory)) return;
    var pass = getSyncPass();
    if (!pass) return;                              // 암호 미설정 → 동기화 꺼짐(조용히, 에러 없음)
    syncLoading = true;
    var since = syncSince();
    OfficeBridge.listChatHistory(since, pass).then(function (rows) {
      syncLoading = false;
      if (!rows || !rows.length) return;
      var added = 0, unseenAdded = 0, maxTs = since;
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        if (row.ts && row.ts > maxTs) maxTs = row.ts;
        if (hasChatRow(row.id)) return;             // 내가 보낸 것/이미 받은 것 → 건너뜀(중복 방지)
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
        if (isOpen(chatView)) { renderChat(); setSeenHW(maxTs); }
        else if (unseenAdded > 0) { chatUnseen += unseenAdded; updateChatBadge(); toast('다른 기기에서 보낸 대화가 도착했어요.'); }
      }
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
    startChatSync();                                  // 곧바로 한 번 확인(암호 틀리면 게이트가 다시 뜸)
  });
  if ($('syncGateLater')) $('syncGateLater').addEventListener('click', function () { hideSyncGate(); });

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

  function loadLockerMsgs() { try { var a = JSON.parse(localStorage.getItem(LOCKER_MSGS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
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
      if (m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span style="opacity:.75">올리는 중…</span>';
      if (m.error) inner += (inner ? '<br>' : '') + '<span style="color:var(--rec)">올리지 못했어요</span>';
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
  function sendLockerMsg() {
    if (!lockerInput) return;
    var text = (lockerInput.value || '').trim();
    var files = lockerPendingFiles.slice();
    if (!text && !files.length) return;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var disp = files.map(function (f) { return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) }; });
    var item = { id: id, text: text, ts: Date.now(), files: disp.length ? disp : null, up: !!files.length, uploading: !!files.length };
    lockerMsgs.push(item); saveLockerMsgs();
    lockerInput.value = ''; autoGrowLocker(); lockerPendingFiles = []; renderLockerPending(); renderLocker();
    var memo = { id: id, token: tok, text: text };
    OfficeBridge.sendLocker(memo, files).then(function (savedFiles) {
      item.uploading = false;
      if (savedFiles && savedFiles.length) item.files = savedFiles;   // 공개 url 채워 내 기기서도 다운로드칩 표시
      saveLockerMsgs(); if (isOpen(lockerView)) renderLocker();
    }).catch(function (e) {
      item.uploading = false; item.error = true; saveLockerMsgs();
      if (isOpen(lockerView)) renderLocker();
      toast('올리지 못했어요 (' + (e && e.message || e) + '). 다시 시도해 주세요.');
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

  if ($('btnLocker')) $('btnLocker').addEventListener('click', openLocker);
  if ($('lockerSend')) $('lockerSend').addEventListener('click', sendLockerMsg);
  if (lockerInput) {
    lockerInput.addEventListener('input', autoGrowLocker);
    lockerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLockerMsg(); } });
  }
  if ($('lockerAttach')) $('lockerAttach').addEventListener('click', function () { var fi = $('lockerFileInput'); if (fi) fi.click(); });
  if ($('lockerFileInput')) $('lockerFileInput').addEventListener('change', function () {
    var fs = Array.prototype.slice.call(this.files || []);
    if (fs.length) { lockerPendingFiles = lockerPendingFiles.concat(fs); renderLockerPending(); }
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
      if (files && files.length) onFiles(files);
    });
  }
  // 채팅: 드롭 → 기존 첨부 대기줄(chatPendingFiles)로 (전송 때 글과 함께 발송)
  enableDropZone($('chatView'), function (files) { onChatFilesPicked(files); });
  // 공유함: 드롭 → 기존 공유함 대기줄(lockerPendingFiles)로 (전송 때 sendLocker로 업로드)
  enableDropZone($('lockerView'), function (files) {
    var fs = Array.prototype.slice.call(files || []);
    if (!fs.length) return;
    lockerPendingFiles = lockerPendingFiles.concat(fs); renderLockerPending();
    toast('파일을 붙였어요. 보내기를 누르세요.');
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
    var url = b.getAttribute('data-att-url'); var w = window.open(url, '_blank');
    if (!w) toast('파일을 열지 못했어요 — 다시 눌러 주세요.');
  });

  // 홈 소장 K 오브 → 케이 채팅(옛 가로 카드 대체, 진입 경로 일원화)
  if ($('btnVoiceChat')) $('btnVoiceChat').addEventListener('click', function () { openChat(); });
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
  // 음성 대화 모드(핸즈프리) 켜기/끄기
  if (chatConvoToggle) chatConvoToggle.addEventListener('click', function () {
    if (convoOn) stopConvo(false); else startConvo();
  });
  if (chatInput) {
    chatInput.addEventListener('input', autoGrowChat);
    chatInput.addEventListener('keydown', function (e) {
      // 한글 조합 중(IME) Enter 는 "글자 확정"용이다. 이때 전송하면 마지막 음절이 잘리거나
      // 조기 전송돼 "글자가 하나씩 잘 안 들어가는" 현상이 난다 → 조합 중이면 무시(2026-09-22).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); }
    });
  }

  /* ---- 채팅 파일 첨부(대표님 → 케이, 상향) ---- */
  var CHAT_CHUNK_LIMIT = 45 * 1024 * 1024;   // 이보다 큰 파일은 청크 업로드(단일 50MB 한도 우회)
  function pushChatFileMsg(files, chunked, userText) {
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    userText = (userText || '').trim();
    var upFiles = Array.prototype.map.call(files, function (f) {
      return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) };
    });
    var names = upFiles.map(function (f) { return f.name; });
    var note = (userText ? (userText + '\n\n') : '') + '[파일 첨부] ' + names.join(', ') + ' — 대표님이 이 파일을 보내셨어요. 확인해 주세요.';
    var msg = { role: 'me', text: userText, ts: Date.now(), id: id, token: tok, answered: false, files: upFiles, up: true, uploading: true };
    chatMsgs.push(msg); saveChatMsgs(); renderChat(); updateSendEnabled();
    var memo = { id: id, token: tok, thread: chatThread, title: names[0] || '파일', note: note };
    var work = chunked ? OfficeBridge.sendChatChunked(memo, files[0]) : OfficeBridge.sendChatBatch(memo, files);
    work.then(function () {
      msg.uploading = false; saveChatMsgs();
      if (isOpen(chatView)) renderChat();
      startChatReconcile();
    }).catch(function (e) {
      msg.answered = true; msg.uploading = false;
      chatMsgs.push({ role: 'k', text: '파일 전송이 안 됐어요(' + (e && e.message || e) + '). 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
      saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
    });
  }
  // 파일을 고르면 '바로 보내지 않고' 대기줄(pending)에 붙인다 → 대표님이 계속 글을 쓸 수 있고, 전송 때 함께 나감.
  function onChatFilesPicked(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    var room = Math.max(0, 10 - chatPendingFiles.length);
    if (arr.length > room) { arr = arr.slice(0, room); toast('파일은 한 번에 최대 10개까지예요.'); }
    if (!arr.length) return;
    chatPendingFiles = chatPendingFiles.concat(arr);
    renderPending();
    toast('파일을 붙였어요. 글을 더 쓰거나 전송을 누르세요.');
  }
  if ($('chatAttach')) $('chatAttach').addEventListener('click', function () {
    $('chatFileInput').click();                              // 첨부는 언제든 가능(붙여두고 계속 입력)
  });
  if ($('chatFileInput')) $('chatFileInput').addEventListener('change', function () {
    if (this.files && this.files.length) onChatFilesPicked(this.files);
    this.value = '';
  });
  // 케이가 보낸 첨부(하향) 탭 → 열기/저장 (기존 문서 버튼과 동일한 window.open 방식)
  if (chatLog) chatLog.addEventListener('click', function (ev) {
    // 링크 탭 → 외부로 열기(선택 복사와 별개)
    var ln = ev.target.closest ? ev.target.closest('a.chatlink,[data-link]') : null;
    if (ln) { ev.preventDefault(); var lu = ln.getAttribute('data-link') || ln.getAttribute('href'); var lw = window.open(lu, '_blank'); if (!lw) toast('링크를 열지 못했어요.'); return; }
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
    var url = b.getAttribute('data-att-url');
    var w = window.open(url, '_blank');
    if (!w) toast('파일을 열지 못했어요 — 다시 눌러 주세요.');
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
    sheetTitle.textContent = title;
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
    openSheet('이 메시지', snippet(m), '삭제', function () { deleteMessage(uid); }, msgCopyText(m));
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
  if ($('chatSearchInput')) {
    $('chatSearchInput').addEventListener('input', function () { chatSearchQuery = this.value || ''; renderChat(); });
    $('chatSearchInput').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeChatSearch(); });
  }

  /* ===================== 테마 토글 ===================== */
  if ($('themeToggle')) $('themeToggle').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-style') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  /* ===================== 뒤로가기 ===================== */
  var toastEl = $('toast'), toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.display = 'block';
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.style.display = 'none'; }, 250);
    }, 1800);
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
    if (sheetEl && isOpen(sheetEl)) { closeSheet(); return true; }
    if ($('syncGate') && isOpen($('syncGate'))) { hideSyncGate(); return true; }   // PC 연동 암호창도 뒤로가기로 닫히게
    if (isOpen(modal)) { closeModal(); return true; }
    if (convoOn) { stopConvo(false); return true; }   // 연속 대화 중 뒤로 = 음성 대화 끝내기(화면 유지)
    if (chatRecording) { endListen('manualcancel'); return true; }   // 듣는 중 뒤로 = 이번 듣기 취소
    // 녹음 화면에서 뒤로 = 정지/계속 선택(예전엔 여기서 무조건 막혀 '먹통'이었음)
    if (isRecording && isOpen(recView)) { openRecLeaveSheet(); return true; }
    if (isOpen(processing)) { showHome(); setStatus('대기 중', 'idle'); toast('정리는 뒤에서 계속돼요 — 지난 메모에서 확인하세요.'); return true; }
    // 문서 뷰어: 전체화면 → 뷰어 → 고르기 → 홈 순으로 한 단계씩 빠져나온다(docRoot는 고정 오버레이)
    if (window.SmartDocs && SmartDocs.isFullscreen && SmartDocs.isFullscreen()) { try { SmartDocs.closeFullscreen(); } catch (e) {} return true; }
    if (window.SmartDocs && SmartDocs.isViewerOpen && SmartDocs.isViewerOpen()) { try { SmartDocs.showPick(); } catch (e) {} return true; }
    if (isOpen($('docsView'))) { showHome(); setStatus('대기 중', 'idle'); return true; }
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
    Capacitor.Plugins.App.addListener('backButton', function () {
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
  if (!getSeenHW()) setSeenHW(Date.now());
  loadOfficePushes();   // 시작 시 그동안 조용히 쌓인 케이 방송을 확인(무푸시 방송은 이때 배지로 알림)
  loadChatSync();       // 시작 시, 다른 기기에서 온 대화도 한 번 확인(암호 설정돼 있을 때만)

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
  if (window.SmartDocs && SmartDocs.init) { try { SmartDocs.init({ toast: toast }); } catch (e) {} }
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
    if (d.error) { toast(d.error || '공유된 문서를 여는 데 실패했어요.'); return; }
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
  window.addEventListener('smartOpenHealth', function () { openHealth(); });       // 건강 리마인더 탭 → 건강 탭 열기
  window.addEventListener('smartChatPush', function () {                          // 앱 열려 있을 때 수신 → 답 당겨오기
    startChatReconcile(); reconcileChat();
    loadOfficePushes();                                                           // 케이 방송 푸시일 수도 있으니 함께 확인
    loadChatSync();                                                               // 다른 기기에서 온 대화도 함께 확인
  });
  if (window.SmartPush && SmartPush.init) { try { SmartPush.init(); } catch (e) {} }
  // M1: 버전 표시 — 대표님이 지금 보는 화면이 최신본인지 알 수 있게(특히 PC판 캐시 확인용)
  try { var _av = $('appVer'); if (_av) _av.textContent = '스마트비서 ' + APP_VERSION; } catch (e) {}
})();
