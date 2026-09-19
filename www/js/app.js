/* ============================================================================
 * app.js  —  화면 연결(글루)  [PC-중심 개편판]
 * ----------------------------------------------------------------------------
 * 흐름: 🎙️녹음 → ⏹️정지 → 제목 입력 → 🖥️PC로 보내기(오디오 업로드)
 *       → PC가 전사·정리·문서생성 → 결과 폴링 → 정리 내용 + PDF/Word/PPT 표시
 *   - 폰은 전사하지 않는다(정확도 위해 PC가 함). 폰은 "녹음·전송·표시"만.
 * ==========================================================================*/
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var btnRecord = $('btnRecord'), statusText = $('statusText'), statusDot = $('statusDot');
  var levelBar = $('levelBar'), banner = $('banner');
  var recordedPanel = $('recordedPanel'), memoTitle = $('memoTitle'), btnSend = $('btnSend'), btnRetake = $('btnRetake');
  var processing = $('processing'), processingText = $('processingText');
  var resultWrap = $('resultWrap'), resultArea = $('resultArea'), transcriptView = $('transcriptView');
  var docBtns = $('docBtns'), exportMsg = $('exportMsg'), btnDelete = $('btnDelete');
  var historyList = $('historyList'), historyCount = $('historyCount');
  var modal = $('modal'), modalTitle = $('modalTitle'), modalBody = $('modalBody'), modalClose = $('modalClose');

  var pendingBlob = null, pollTimer = null, pollingId = null, viewId = null;
  var recTimerEl = $('recTimer'), recStart = 0, recInterval = null;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtSec(s) { s = Math.max(0, Math.floor(s)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
  function startRecTimer() {
    recStart = Date.now();
    if (recTimerEl) { recTimerEl.style.display = 'block'; recTimerEl.textContent = '녹음 시간 00:00'; }
    if (recInterval) clearInterval(recInterval);
    recInterval = setInterval(function () {
      if (recTimerEl) recTimerEl.textContent = '녹음 시간 ' + fmtSec((Date.now() - recStart) / 1000);
    }, 500);
  }
  function stopRecTimer() { if (recInterval) { clearInterval(recInterval); recInterval = null; } }

  if (!RecordingModule.isSupported()) {
    banner.style.display = 'block';
    banner.innerHTML = '⚠️ 이 브라우저는 녹음을 지원하지 않습니다. 갤럭시/안드로이드의 <b>Chrome</b>에서 열어 주세요.';
    btnRecord.disabled = true; btnRecord.classList.add('disabled');
  }

  var recorder = new RecordingModule({
    onStatus: function (s) {
      if (s === 'recording') setStatus('녹음 중… 끝나면 정지', 'rec');
      else if (s === 'stopped') setStatus('녹음 완료', 'idle');
      else if (s === 'error') setStatus('오류', 'err');
    },
    onLevel: function (v) { levelBar.style.width = Math.round(v * 100) + '%'; },
    onError: function (m) { showBanner('⚠️ ' + m); },
    onAudio: function (blob) { onRecorded(blob); }
  });

  var isRecording = false;
  btnRecord.addEventListener('click', function () {
    if (btnRecord.disabled) return;
    if (!isRecording) {
      hideBanner(); hide(resultWrap); hide(processing);
      recorder.start(); isRecording = true; startRecTimer();
      btnRecord.textContent = '⏹️  녹음 정지'; btnRecord.classList.add('recording');
    } else {
      recorder.stop(); isRecording = false; stopRecTimer();
      btnRecord.textContent = '🎙️  녹음 시작'; btnRecord.classList.remove('recording');
    }
  });

  function onRecorded(blob) {
    stopRecTimer();
    pendingBlob = blob;
    memoTitle.value = defaultTitle();
    show(recordedPanel);
    // 실제 "녹음된 길이"를 보여준다(네이티브가 알려줌) — 몇 초가 담겼는지 즉시 확인
    var durMs = (recorder && recorder.lastDurationMs) || 0;
    if (recTimerEl) {
      if (durMs > 0) recTimerEl.textContent = '✅ 녹음된 길이 ' + fmtSec(durMs / 1000) + ' (' + Math.round(durMs / 1000) + '초)';
      // durMs 0(웹 등)이면 마지막 경과시간 표시 유지
      recTimerEl.style.display = 'block';
    }
    setStatus('녹음 완료 — 제목 정하고 PC로 보내세요', 'idle');
  }
  btnRetake.addEventListener('click', function () {
    pendingBlob = null; hide(recordedPanel); setStatus('대기 중', 'idle');
  });

  btnSend.addEventListener('click', function () {
    if (!pendingBlob) { showBanner('먼저 녹음해 주세요.'); return; }
    var t = now();
    var memo = {
      id: OfficeBridge.uuid(), token: OfficeBridge.token(),
      title: (memoTitle.value || '').trim() || defaultTitle(),
      ext: OfficeBridge.extFromBlob(pendingBlob), date: t.date, time: t.time
    };
    HistoryModule.add({ id: memo.id, token: memo.token, title: memo.title, date: t.date, time: t.time, status: 'pending' });
    renderHistory();
    hide(recordedPanel); show(processing); setProcessing('🖥️ PC로 보내는 중…');
    var blob = pendingBlob; pendingBlob = null;
    OfficeBridge.send(memo, blob).then(function () {
      HistoryModule.update(memo.id, { status: 'processing' });
      renderHistory();
      setProcessing('🖨️ PC에서 정리 중… 잠시만요 (처음엔 1~2분 걸릴 수 있어요)');
      startPolling(memo.id, memo.token);
    }).catch(function (e) {
      HistoryModule.update(memo.id, { status: 'failed', error: String(e && e.message || e) });
      renderHistory(); hide(processing);
      showBanner('⚠️ 전송 실패(오프라인일 수 있어요). 녹음은 안전하게 보관됐어요 — 인터넷 되면 목록에서 [재시도]를 누르세요.');
      setStatus('전송 실패', 'err');
    });
  });

  /* --- 결과 폴링 --- */
  function startPolling(id, token) {
    stopPolling(); pollingId = id;
    var started = Date.now();
    pollTimer = setInterval(function () {
      OfficeBridge.poll(id, token).then(function (res) {
        if (!res) return;
        if (res.status === 'done') {
          stopPolling();
          HistoryModule.update(id, {
            status: 'done', transcript: res.transcript, summary_json: res.summary_json,
            pdf_url: res.pdf_url, docx_url: res.docx_url, pptx_url: res.pptx_url, title: res.title, error: res.error || null
          });
          renderHistory(); hide(processing); showResult(id);
          setStatus('정리 완료', 'idle');
        } else if (res.status === 'processing') {
          setProcessing('🖨️ PC에서 정리 중… 잠시만요');
        } else if (res.error) {
          setProcessing('처리 중 문제가 있었어요. 잠시 후 다시 시도돼요…');
        }
        // 너무 오래 걸리면(5분) 폴링만 멈추고 목록에서 나중에 확인
        if (Date.now() - started > 5 * 60 * 1000) {
          stopPolling(); hide(processing);
          showBanner('아직 정리 중이에요. PC가 켜져 있는지 확인하고, 잠시 후 <b>지난 메모</b>에서 다시 확인해 주세요.');
        }
      }).catch(function () { /* 네트워크 일시 오류 → 다음 주기 */ });
    }, 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; pollingId = null; }

  /* --- 결과 표시 --- */
  function showResult(id) {
    var e = HistoryModule.get(id); if (!e) return;
    viewId = id;
    resultArea.innerHTML = renderCards(e.summary_json);
    transcriptView.textContent = (e.transcript || '(전사 내용이 비어 있어요)');
    docBtns.innerHTML = renderDocButtons(e);
    wireDocButtons(docBtns, e);
    setExportMsg('', '');
    show(resultWrap);
  }

  function renderCards(sj) {
    sj = sj || {};
    var html = '';
    html += section('📌 핵심 요약', sj.summary, '핵심 문장을 찾지 못했어요.');
    html += section('✅ 할 일', sj.todos, '할 일로 보이는 내용이 없어요.');
    html += section('📖 결정사항', sj.decisions, '결정/합의로 보이는 내용이 없어요.');
    if (sj.keywords && sj.keywords.length) {
      html += '<div class="card"><h3>🔑 자주 나온 단어</h3><div class="chips">';
      sj.keywords.forEach(function (k) { html += '<span class="chip">' + esc(k.word) + ' <b>' + k.count + '</b></span>'; });
      html += '</div></div>';
    }
    return html || '<p class="empty">정리 결과가 없어요.</p>';
  }
  function section(title, arr, empty) {
    var h = '<div class="card"><h3>' + title + '</h3>';
    if (arr && arr.length) { h += '<ul>'; arr.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; }); h += '</ul>'; }
    else h += '<p class="empty">' + empty + '</p>';
    return h + '</div>';
  }

  function renderDocButtons(e) {
    var pdf = e.pdf_url, docx = e.docx_url, pptx = e.pptx_url;
    var h = '';
    h += pdf
      ? '<button class="savebtn primary big" data-open="' + esc(pdf) + '">📄 폰에서 바로 보기 (PDF)</button>'
      : '<button class="savebtn primary big" disabled>📄 PDF (생성 대기/실패)</button>';
    h += '<p class="savehint">폰에서는 이 <b>PDF</b>로 보세요. 앱 없이 바로 열려요.</p>';
    h += '<details id="officeExport" class="office"><summary>📊 PPT · 📄 Word (PC·편집용)</summary><div class="btnrow subtle">';
    h += pptx ? '<button data-open="' + esc(pptx) + '">📊 PPT</button>' : '<button disabled>📊 PPT</button>';
    h += docx ? '<button data-open="' + esc(docx) + '">📄 Word</button>' : '<button disabled>📄 Word</button>';
    h += '</div></details>';
    h += '<p class="savehint warn">⚠️ PPT·Word는 <b>PC(또는 오피스 앱)</b>에서 열려요. 폰에서는 <b>압축파일(zip)</b>로 보일 수 있어요 — 폰에선 위 <b>PDF</b>로 보세요.</p>';
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
    var oe = host.querySelector('#officeExport');
    var isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (oe && !isPhone) oe.open = true;
  }

  btnDelete.addEventListener('click', function () {
    if (viewId) HistoryModule.remove(viewId);
    viewId = null; hide(resultWrap); renderHistory(); setStatus('대기 중', 'idle');
  });

  /* --- 지난 메모 --- */
  function renderHistory() {
    var list = HistoryModule.list();
    historyCount.textContent = list.length ? '(' + list.length + '건)' : '';
    if (!list.length) { historyList.innerHTML = '<p class="empty" style="color:#6b7280;font-size:14px;">녹음한 메모가 여기에 쌓입니다.</p>'; return; }
    historyList.innerHTML = list.map(function (e) {
      var badge, cls;
      if (e.status === 'done') { badge = '완료'; cls = 'ok'; }
      else if (e.status === 'failed') { badge = '재시도'; cls = 'wait'; }
      else { badge = '정리 중…'; cls = 'proc'; }
      return '<div class="histitem" data-id="' + e.id + '"><span class="htitle">' + esc(e.title) + '</span>' +
        '<span class="hmeta"><span class="sent ' + cls + '" data-badge="' + e.status + '">' + badge + '</span>' +
        '<span class="hdate">' + e.date + '</span></span></div>';
    }).join('');
    Array.prototype.forEach.call(historyList.querySelectorAll('.histitem'), function (el) {
      el.addEventListener('click', function () { onHistoryClick(el.getAttribute('data-id')); });
    });
  }
  function onHistoryClick(id) {
    var e = HistoryModule.get(id); if (!e) return;
    if (e.status === 'done') { openModal(e); }
    else if (e.status === 'failed') {
      // 재시도: IndexedDB에 보관된 오디오를 다시 업로드
      setStatus('재시도 중…', 'rec');
      OfficeBridge.flush(function (memo) {
        if (memo.id === id) { HistoryModule.update(id, { status: 'processing', error: null }); renderHistory(); show(processing); setProcessing('🖨️ PC에서 정리 중…'); startPolling(id, e.token); }
      }).then(function () {
        var cur = HistoryModule.get(id);
        if (cur && cur.status === 'failed') showBanner('재시도 실패 — 인터넷 연결을 확인해 주세요.');
      });
    } else {
      // pending/processing → 폴링 재개
      show(processing); setProcessing('🖨️ PC에서 정리 중… 잠시만요'); startPolling(id, e.token);
    }
  }

  /* --- 지난 메모 상세(모달) --- */
  function openModal(e) {
    modalTitle.textContent = e.title + '  ·  ' + e.date;
    var html = renderCards(e.summary_json);
    html += '<div class="card"><h3>📝 전사 원문</h3><p style="white-space:pre-wrap;font-size:15px">' + esc(e.transcript || '(없음)') + '</p></div>';
    html += '<div id="mDocBtns">' + renderDocButtons(e) + '</div>';
    html += '<div class="btnrow"><button id="mDelete" class="danger">🗑 삭제</button></div>';
    modalBody.innerHTML = html;
    wireDocButtons($('mDocBtns'), e);
    $('mDelete').addEventListener('click', function () { HistoryModule.remove(e.id); closeModal(); renderHistory(); });
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; }
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(); });

  /* --- 유틸 --- */
  function defaultTitle() { var d = new Date(); return '메모 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + d.getHours() + '시'; }
  function now() { var d = new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return { date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), time: p(d.getHours()) + ':' + p(d.getMinutes()) }; }
  function setStatus(t, k) { statusText.textContent = t; statusDot.className = 'dot ' + (k || 'idle'); }
  function setExportMsg(m, k) { exportMsg.textContent = m || ''; exportMsg.className = 'exportmsg ' + (k || ''); }
  function setProcessing(t) { processingText.textContent = t; }
  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none'; }
  function showBanner(m) { banner.style.display = 'block'; banner.innerHTML = m; }
  function hideBanner() { if (RecordingModule.isSupported()) banner.style.display = 'none'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  setStatus('대기 중', 'idle');
  renderHistory();

  // 시작 시: 밀렸던 업로드 재시도 + 처리 중이던 메모 폴링 재개
  OfficeBridge.flush(function () { renderHistory(); });
  HistoryModule.list().forEach(function (e) {
    if ((e.status === 'pending' || e.status === 'processing') && e.token && !pollTimer) {
      startPolling(e.id, e.token);
    }
  });
})();
