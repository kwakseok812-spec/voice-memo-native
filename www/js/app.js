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
  var homeView = $('homeView'), recView = $('recView');
  var recordedPanel = $('recordedPanel'), memoTitle = $('memoTitle'), btnSend = $('btnSend'), btnRetake = $('btnRetake');
  var recDoneBadge = $('recDoneBadge');
  var processing = $('processing'), processingText = $('processingText');
  var resultWrap = $('resultWrap'), resultArea = $('resultArea'), transcriptView = $('transcriptView');
  var docBtns = $('docBtns'), exportMsg = $('exportMsg'), btnDelete = $('btnDelete');
  var historyList = $('historyList'), historyCount = $('historyCount');
  var modal = $('modal'), modalTitle = $('modalTitle'), modalBody = $('modalBody'), modalClose = $('modalClose');

  var pendingBlob = null, pollTimer = null, pollingId = null, viewId = null;
  var recTimerEl = $('recTimer'), recStart = 0, recInterval = null;
  var isRecording = false, recCancelled = false;

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
  var SUBS = [recView, recordedPanel, filePanelRef(), searchPanelRef(), $('chatView'), $('healthView'), processing, resultWrap];
  function filePanelRef() { return $('filePanel'); }
  function searchPanelRef() { return $('searchPanel'); }
  function showHome() {
    SUBS.forEach(hide); clearSearch(); show(homeView); scrollTop();
  }
  function openScreen(el) {
    hide(homeView);
    SUBS.forEach(function (x) { if (x !== el) hide(x); });
    if (el !== searchPanelRef()) clearSearch();
    show(el); scrollTop();
  }

  /* ---------- 녹음 ---------- */
  function startRecTimer() {
    recStart = Date.now();
    if (recTimerEl) recTimerEl.textContent = '00:00';
    if (recInterval) clearInterval(recInterval);
    recInterval = setInterval(function () {
      if (recTimerEl) recTimerEl.textContent = fmtSec((Date.now() - recStart) / 1000);
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
      else if (s === 'error') setStatus('오류', 'err');
    },
    onLevel: function (v) { if (levelBar) levelBar.style.width = Math.round(v * 100) + '%'; },
    onError: function (m) { showBanner('⚠️ ' + m); },
    onAudio: function (blob) { onRecorded(blob); }
  });

  if (btnRecord) btnRecord.addEventListener('click', function () {
    if (btnRecord.disabled || isRecording) return;
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
    pendingBlob = null; showHome(); setStatus('대기 중', 'idle');
  });

  function onRecorded(blob) {
    stopRecTimer(); isRecording = false;
    if (recCancelled) { recCancelled = false; pendingBlob = null; showHome(); return; }
    pendingBlob = blob;
    if (memoTitle) memoTitle.value = defaultTitle();
    var durMs = (recorder && recorder.lastDurationMs) || 0;
    if (recDoneBadge) recDoneBadge.textContent = durMs > 0
      ? '✅ 녹음됐어요 · ' + fmtSec(durMs / 1000) + ' (' + Math.round(durMs / 1000) + '초)'
      : '✅ 녹음됐어요';
    openScreen(recordedPanel);
    setStatus('녹음 완료 — 제목 정하고 보내기', 'idle');
  }
  if (btnRetake) btnRetake.addEventListener('click', function () {
    pendingBlob = null; showHome(); setStatus('대기 중', 'idle');
  });

  if (btnSend) btnSend.addEventListener('click', function () {
    if (!pendingBlob) { showBanner('먼저 녹음해 주세요.'); return; }
    var t = now();
    var memo = {
      id: OfficeBridge.uuid(), token: OfficeBridge.token(),
      title: (memoTitle.value || '').trim() || defaultTitle(),
      ext: OfficeBridge.extFromBlob(pendingBlob), date: t.date, time: t.time
    };
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending' });
    renderHistory();
    openScreen(processing); setProcessing('🖥️ PC로 보내는 중…');
    var blob = pendingBlob; pendingBlob = null;
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
          renderHistory(); showResult(id); setStatus('정리 완료', 'idle');
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
      if (tl) tl.style.display = 'block'; transcriptView.style.display = 'block';
      resultArea.innerHTML = rtitle(e, '정리 결과') + renderCards(e.summary_json);
      transcriptView.textContent = (e.transcript || '(전사 내용이 비어 있어요)');
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
    } else if (e.status === 'failed') {
      setStatus('재시도 중…', 'rec');
      OfficeBridge.flush(function (memo) {
        if (memo.id === id) { HistoryModule.update(id, { status: 'processing', error: null }); renderHistory(); openScreen(processing); setProcessing('🖨️ PC에서 정리 중…'); startPolling(id, e.token); }
      }).then(function () {
        var cur = HistoryModule.get(id);
        if (cur && cur.status === 'failed') showBanner('재시도 실패 — 인터넷 연결을 확인해 주세요.');
      });
    } else {
      openScreen(processing); setProcessing('🖨️ PC에서 정리 중… 잠시만요'); startPolling(id, e.token);
    }
  }

  /* ---------- 상세 모달 ---------- */
  function openModal(e) {
    modalTitle.textContent = e.title + '  ·  ' + e.date;
    var html = renderCards(e.summary_json);
    html += rcard('i-note', '전사 원문', '<p>' + esc(e.transcript || '(없음)') + '</p>');
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
          toast('🎬 영상 정리 완료 — 지난 메모에서 볼 수 있어요.');
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
  function clearSearch() {
    if (searchResults) searchResults.innerHTML = '';
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
    var started = Date.now();
    var t = setInterval(function () {
      OfficeBridge.poll(id, tok).then(function (res) {
        if (res && res.status === 'done') { clearInterval(t); onDone(res); }
        else if (Date.now() - started > 60000) { clearInterval(t); setSearchMsg('시간이 걸려요. PC가 켜져 있는지 확인 후 다시 검색해 주세요.', 'err'); }
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
  var CHAT_THREAD_KEY = 'smart_chat_thread', CHAT_MSGS_KEY = 'smart_chat_msgs';
  var chatThread = getChatThread(), chatMsgs = loadChatMsgs(), chatUnseen = 0, chatTimer = null;

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
      var slim = chatMsgs.filter(function (m) { return m.role !== 'typing'; }).slice(-120)
        .map(function (m) { return m.role === 'me'
          ? { role: 'me', text: m.text, ts: m.ts, id: m.id, token: m.token, answered: !!m.answered, files: m.files || null, up: !!m.up }
          : { role: 'k', text: m.text, ts: m.ts, files: m.files || null }; });
      localStorage.setItem(CHAT_MSGS_KEY, JSON.stringify(slim));
    } catch (e) {}
  }
  /* ---- 채팅 첨부 파일 유틸(업로드·다운로드 공용 렌더) ---- */
  function fmtBytes(b) { b = b || 0; if (b < 1024) return b + 'B'; if (b < 1024 * 1024) return Math.round(b / 1024) + 'KB'; return (Math.round(b / 1024 / 1024 * 10) / 10) + 'MB'; }
  function fileKindOf(mime, name) {
    var m = (mime || '').toLowerCase(), n = (name || '').toLowerCase();
    if (/^image\//.test(m) || /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/.test(n)) return 'image';
    if (/^video\//.test(m) || /\.(mp4|mov|avi|mkv|webm|m4v|3gp)$/.test(n)) return 'video';
    return 'document';
  }
  function attachIcon(f) { var k = f.kind || fileKindOf(f.mime, f.name); return k === 'image' ? 'i-image' : k === 'video' ? 'i-video' : 'i-note'; }
  function attachChips(files, isUp) {
    if (!files || !files.length) return '';
    return '<div class="attachlist">' + files.map(function (f) {
      var sz = f.size ? '<span class="asz">' + esc(fmtBytes(f.size)) + '</span>' : '';
      var attrs = (!isUp && f.url) ? (' data-att-url="' + esc(f.url) + '"') : ' disabled';
      return '<button type="button" class="attach' + (isUp ? ' up' : '') + '"' + attrs + '>' +
        '<svg><use href="#' + attachIcon(f) + '"/></svg><span class="an">' + esc(f.name || '파일') + '</span>' + sz + '</button>';
    }).join('') + '</div>';
  }
  function anyAwaiting() { return chatMsgs.some(function (m) { return m.role === 'me' && !m.answered && m.id && m.token; }); }
  function chatText(s) {
    return esc(s)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')   // **강조** → 굵게
      .replace(/\n/g, '<br>');
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
  function updateSendEnabled() { if (chatSend) chatSend.disabled = anyAwaiting(); }
  function updateChatBadge() {
    var b = $('chatBadge'); if (!b) return;
    if (chatUnseen > 0) { b.textContent = chatUnseen > 9 ? '9+' : String(chatUnseen); b.style.display = 'inline-flex'; }
    else b.style.display = 'none';
  }
  function renderChat() {
    if (!chatMsgs.length) {
      chatLog.innerHTML = '<div class="chatintro"><div class="chatintro-ic"><svg><use href="#i-spark"/></svg></div>' +
        '<b>안녕하세요, 교수님</b><p>무엇이든 물어보시거나 일을 시켜 보세요.<br>예: “내일 일정 정리해줘”, “학과 회의록 초안 만들어줘”.</p></div>';
      return;
    }
    var html = chatMsgs.map(function (m) {
      if (m.role === 'typing') return '';
      var inner = m.text ? chatText(m.text) : '';
      if (m.role === 'me' && m.up && m.uploading) inner += (inner ? '<br>' : '') + '<span style="opacity:.75">올리는 중…</span>';
      inner += attachChips(m.files, m.role === 'me');
      if (!inner) return '';
      return '<div class="bubble ' + (m.role === 'me' ? 'me' : 'k') + '">' + inner + '</div>';
    }).join('');
    if (anyAwaiting()) html += '<div class="bubble k typing"><span></span><span></span><span></span></div>';
    chatLog.innerHTML = html;
    chatScrollBottom();
  }
  function openChat() {
    openScreen(chatView);
    chatUnseen = 0; updateChatBadge();
    renderChat(); reconcileChat();               // 들어올 때 그동안 도착한 답을 즉시 반영
    if (anyAwaiting()) startChatReconcile();
    // 진입 시 입력창 자동 포커스 안 함(교수님 지시) — 직접 탭했을 때만 브라우저 기본동작으로 포커스됨
  }
  function autoGrowChat() { if (!chatInput) return; chatInput.style.height = 'auto'; chatInput.style.height = Math.min(120, chatInput.scrollHeight) + 'px'; }
  function sendChatMsg() {
    if (!chatInput) return;
    var text = (chatInput.value || '').trim();
    if (!text || anyAwaiting()) return;          // 앞 질문 답 오기 전엔 다음 전송 잠금(순서 유지)
    chatInput.value = ''; autoGrowChat();
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    chatMsgs.push({ role: 'me', text: text, ts: Date.now(), id: id, token: tok, answered: false });
    saveChatMsgs(); renderChat(); updateSendEnabled();
    OfficeBridge.sendChat(id, tok, chatThread, text).then(function () {
      startChatReconcile();
    }).catch(function () {
      // 전송 자체 실패 → 그 질문에 오류답 달고 잠금 해제
      var m = findMsg(id); if (m) m.answered = true;
      chatMsgs.push({ role: 'k', text: '죄송해요, 전송이 안 됐어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', ts: Date.now() });
      saveChatMsgs(); renderChat(); updateSendEnabled();
    });
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
    pending.forEach(function (m) {
      if (m._polling) return; m._polling = true;
      OfficeBridge.poll(m.id, m.token).then(function (res) {
        m._polling = false;
        if (res && res.status === 'done') {
          m.answered = true;
          var reply = res.content_md || (res.summary_json && res.summary_json.reply) || '답을 못 만들었어요. 다시 물어봐 주세요.';
          var atts = OfficeBridge.attachmentsFrom(res);   // 케이가 보낸 첨부(하향)
          var kmsg = { role: 'k', text: reply, ts: Date.now() };
          if (atts.length) kmsg.files = atts;
          chatMsgs.push(kmsg);
          saveChatMsgs();
          if (isOpen(chatView)) renderChat();
          else { chatUnseen++; updateChatBadge(); toast(atts.length ? '케이가 파일을 보냈어요.' : '케이 답장이 도착했어요.'); }
          updateSendEnabled();
        } else if (Date.now() - (m.ts || 0) > (m.files ? 20 : 6) * 60 * 1000) {   // 파일 첨부는 여유롭게
          m.answered = true;
          chatMsgs.push({ role: 'k', text: '시간이 오래 걸려요. 다시 물어봐 주세요. (PC가 켜져 있는지 확인해 주세요.)', ts: Date.now() });
          saveChatMsgs(); if (isOpen(chatView)) renderChat(); updateSendEnabled();
        }
      }).catch(function () { m._polling = false; });
    });
  }
  if ($('btnChat')) $('btnChat').addEventListener('click', openChat);
  if (chatSend) chatSend.addEventListener('click', sendChatMsg);
  if (chatInput) {
    chatInput.addEventListener('input', autoGrowChat);
    chatInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMsg(); } });
  }

  /* ---- 채팅 파일 첨부(교수님 → 케이, 상향) ---- */
  var CHAT_CHUNK_LIMIT = 45 * 1024 * 1024;   // 이보다 큰 파일은 청크 업로드(단일 50MB 한도 우회)
  function pushChatFileMsg(files, chunked) {
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var upFiles = Array.prototype.map.call(files, function (f) {
      return { name: f.name || '파일', size: f.size || 0, mime: f.type || '', kind: fileKindOf(f.type, f.name) };
    });
    var names = upFiles.map(function (f) { return f.name; });
    var note = '[파일 첨부] ' + names.join(', ') + ' — 교수님이 이 파일을 보내셨어요. 확인해 주세요.';
    var msg = { role: 'me', text: '', ts: Date.now(), id: id, token: tok, answered: false, files: upFiles, up: true, uploading: true };
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
  function onChatFilesPicked(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    var big = arr.filter(function (f) { return (f.size || 0) > CHAT_CHUNK_LIMIT; });
    var small = arr.filter(function (f) { return (f.size || 0) <= CHAT_CHUNK_LIMIT; });
    if (small.length) pushChatFileMsg(small, false);       // 작은 파일들: 한 번에(한 말풍선)
    big.forEach(function (f) { pushChatFileMsg([f], true); });   // 큰 파일: 각각 청크로(개별 말풍선)
    if (big.length) toast('큰 파일은 나눠 올려요 — 시간이 걸릴 수 있어요.');
  }
  if ($('chatAttach')) $('chatAttach').addEventListener('click', function () {
    if (anyAwaiting()) { toast('앞 답을 받은 뒤에 보낼 수 있어요.'); return; }
    $('chatFileInput').click();
  });
  if ($('chatFileInput')) $('chatFileInput').addEventListener('change', function () {
    if (this.files && this.files.length) onChatFilesPicked(this.files);
    this.value = '';
  });
  // 케이가 보낸 첨부(하향) 탭 → 열기/저장 (기존 문서 버튼과 동일한 window.open 방식)
  if (chatLog) chatLog.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-att-url]') : null;
    if (!b) return;
    var url = b.getAttribute('data-att-url');
    var w = window.open(url, '_blank');
    if (!w) toast('파일을 열지 못했어요 — 다시 눌러 주세요.');
  });

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
  function goBack() {
    if (isOpen(modal)) { closeModal(); return true; }
    if (isRecording) { toast('녹음 중이에요. 정지 또는 취소를 눌러 주세요.'); return true; }
    if (isOpen(processing)) { toast('처리 중이에요. 잠시만요.'); return true; }
    if (isOpen(recordedPanel) || isOpen(filePanel) || isOpen(searchPanel) || isOpen(resultWrap) || isOpen(chatView) || isOpen($('healthView'))) {
      showHome(); setStatus('대기 중', 'idle'); return true;
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

  /* ---- 건강 탭: 화면 열기/연결(로직은 health.js) ---- */
  var healthView = $('healthView');
  function openHealth() {
    openScreen(healthView);
    if (window.HealthTab && HealthTab.open) { try { HealthTab.open(); } catch (e) {} }
  }
  if (window.HealthTab && HealthTab.init) { try { HealthTab.init({ toast: toast }); } catch (e) {} }
  if ($('btnHealth')) $('btnHealth').addEventListener('click', openHealth);

  /* ---- 푸시 알림(FCM): 등록·수신은 push.js. 여기선 대화 화면과 연결만 한다 ---- */
  window.addEventListener('smartOpenChat', function () { openChat(); });          // 알림 탭 → 대화 열기
  window.addEventListener('smartOpenHealth', function () { openHealth(); });       // 건강 리마인더 탭 → 건강 탭 열기
  window.addEventListener('smartChatPush', function () {                          // 앱 열려 있을 때 수신 → 답 당겨오기
    startChatReconcile(); reconcileChat();
  });
  if (window.SmartPush && SmartPush.init) { try { SmartPush.init(); } catch (e) {} }
})();
