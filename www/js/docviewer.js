/* ============================================================================
 * docviewer.js — 스마트비서 내장 문서 뷰어 (SmartDocs)
 * ----------------------------------------------------------------------------
 * 배포본 doc-viewer-ho30.onrender.com 의 뷰어를 그대로 이식(1:1)했다. 차이점은
 * 변환 경로뿐: 배포본은 자기 서버(/api/convert)로 보내지만, 여기서는 스마트비서
 * 우편함 파이프라인(OfficeBridge, kind='doc')으로 PC가 변환해 돌려준다.
 * 담긴 기능(배포본과 동일):
 *   · 엑셀(xls/xlsx/csv) → 브라우저에서 바로 「표로 보기」(SheetJS, 변환 안 함) + 「📄 PDF로 보기」 토글
 *   · 전체화면 = 브라우저 Fullscreen API(requestFullscreen) — 일반 문서 한 장 크게 보기
 *   · PPT → ▶ 슬라이드쇼(전체화면·자동재생·간격·반복·좌우탭)
 *   · 회전(⟳) · 야간(🌙) · 스크롤⇄한장넘김(📖) · 폭맞춤/확대·축소(－＋·핀치·더블탭) · 좌우 스와이프
 *   · 책 넘김(StPageFlip, 종이 접힘) — 전체화면 한 장 보기에서 토글(라이브러리 없으면 자동 폴백)
 * 라이브러리는 www/vendor 에 번들(pdf.js / xlsx / page-flip).
 * ==========================================================================*/
(function (global) {
  'use strict';
  var toast = function () {};
  var $ = function (id) { return document.getElementById(id); };

  if (typeof global.pdfjsLib !== 'undefined') {
    try { global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; } catch (e) {}
  }

  // ============ DOM ============
  var rootEl, viewerEl, overlay, panel, fileInput, pagesEl, tableviewEl, sheetBar, sheetSel, xlToggleBtn;
  var pageNavGrp, scroller, pageBadge, fnameLabel, prevBtn, nextBtn, darkBtn, rotateBtn, slideshowBtn, fullscreenBtn, layoutBtn;
  var ssEl, ssStage, ssWrap, ssCanvas, ssTitle, ssBadge, ssExitBtn, ssPrevBtn, ssNextBtn, ssPlayBtn, ssLoopBtn, ssRotateBtn, ssIntervalSel;
  var ssCtlShow, ssCtlPage, ssPrevPBtn, ssNextPBtn, ssZoomInBtn, ssZoomOutBtn, ssFitBtn, ssFlipBtn, flipStageEl, flipHintEl;

  // ============ 상태 ============
  var viewMode = 'pdf';
  var isExcelDoc = false, excelWorkbook = null, excelFile = null, excelName = '', excelView = 'table', excelPdfBuf = null;
  var tableFontPx = 15; var TABLE_FONT_MIN = 9, TABLE_FONT_MAX = 40, TABLE_FONT_DEFAULT = 15;
  var pdfDoc = null, baseScale = 1, userZoom = 1, renderedZoom = 1, userRotation = 0, curIsPpt = false;
  var pdfPaged = false, pageModeCur = 1;
  try { pdfPaged = localStorage.getItem('docviewer_paged') === '1'; } catch (e) {}
  var DPR = Math.min(global.devicePixelRatio || 1, 2.5);
  var opToken = 0;
  var EXCEL_EXTS = ['xls', 'xlsx', 'csv', 'ods'];
  var VIEWABLE = ['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];

  function extOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase(); }
  function isExcelExt(ext) { return EXCEL_EXTS.indexOf(ext) >= 0; }
  function isPptName(name) { var e = extOf(name); return e === 'ppt' || e === 'pptx'; }
  function isPptMime(t) { t = String(t || '').toLowerCase(); return t.indexOf('presentationml') >= 0 || t.indexOf('powerpoint') >= 0; }
  function isViewable(name, mime) { if (VIEWABLE.indexOf(extOf(name)) !== -1) return true; return /pdf|word|excel|spreadsheet|presentation|officedocument|hwp/i.test(mime || ''); }

  // ============ 화면 전환 ============
  function showViewer() { if (rootEl) rootEl.classList.add('on'); }
  function showPick() {
    closeSlideshow();
    if (rootEl) rootEl.classList.remove('on');
  }

  // ============ 오버레이 ============
  function showLoading(msg, sub) {
    panel.innerHTML = '<div class="spinner"></div><div class="msg">' + esc(msg) + '</div>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '<div class="bar-wrap"><div class="bar-fill" id="dvBarFill"></div></div>';
    overlay.classList.add('on');
  }
  function setProgress(pct) { var b = $('dvBarFill'); if (b) b.style.width = Math.max(2, Math.min(100, pct)) + '%'; }
  function showError(msg, sub, retryFn) {
    panel.innerHTML = '<div class="err-emoji">⚠️</div><div class="msg">' + esc(msg) + '</div>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
      (retryFn ? '<button class="btn" id="dvErrRetry" style="margin-top:20px;">🔄 다시 시도</button>' : '') +
      '<button class="' + (retryFn ? 'btn ghost' : 'btn') + '" id="dvErrClose" style="margin-top:' + (retryFn ? '10px' : '20px') + ';">확인</button>';
    overlay.classList.add('on');
    $('dvErrClose').onclick = function () { hideOverlay(); if (!pdfDoc && !isExcelDoc) showPick(); };
    if (retryFn) $('dvErrRetry').onclick = function () { hideOverlay(); try { retryFn(); } catch (e) {} };
  }
  function hideOverlay() { overlay.classList.remove('on'); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ============ 야간 보기(기기별 기억) ============
  var DARK_STORE = 'docviewer_dark';
  function applyDark(on) {
    rootEl.classList.toggle('dark', !!on);
    if (darkBtn) { darkBtn.textContent = on ? '☀️' : '🌙'; darkBtn.title = on ? '밝게 보기' : '야간 보기'; }
    try { localStorage.setItem(DARK_STORE, on ? '1' : '0'); } catch (e) {}
  }

  // ============ 뷰어 모드 전환 ============
  function setViewMode(mode) {
    viewMode = mode;
    var isTable = (mode === 'table');
    tableviewEl.style.display = isTable ? 'block' : 'none';
    pagesEl.style.display = isTable ? 'none' : 'block';
    pageNavGrp.style.display = isTable ? 'none' : 'flex';
    rotateBtn.style.display = isTable ? 'none' : 'inline-flex';
    pageBadge.style.display = isTable ? 'none' : 'flex';
    $('zoomFit').textContent = isTable ? '기본' : '폭맞춤';
    updateFeatureButtons();
    sheetBar.style.display = (isTable && excelWorkbook && excelWorkbook.SheetNames.length > 1) ? 'flex' : 'none';
  }
  function updateFeatureButtons() {
    var isPdf = (viewMode === 'pdf') && !!pdfDoc;
    slideshowBtn.style.display = (isPdf && curIsPpt) ? 'inline-flex' : 'none';
    fullscreenBtn.style.display = (isPdf && !curIsPpt) ? 'inline-flex' : 'none';
    updateLayoutBtn();
  }
  function updateLayoutBtn() {
    var show = (viewMode === 'pdf') && !!pdfDoc;
    layoutBtn.style.display = show ? 'inline-flex' : 'none';
    layoutBtn.textContent = pdfPaged ? '📜 스크롤' : '📖 넘김';
    layoutBtn.title = pdfPaged ? '위아래로 죽 스크롤해서 보기' : '한 장씩 좌우로 넘겨 보기';
  }

  // ============ 파일 처리 ============
  function handleFile(file) {
    if (!file) return;
    var ext = extOf(file.name);
    isExcelDoc = false; xlToggleBtn.style.display = 'none';
    if (isExcelExt(ext)) { openExcelFile(file); return; }
    convertAndShowPdf(file);
  }

  // ============ 엑셀 「표로 보기」(SheetJS, 서버 안 감) ============
  function openExcelFile(file) {
    if (typeof XLSX === 'undefined') { convertAndShowPdf(file); return; }
    isExcelDoc = true; excelFile = file; excelName = file.name; excelPdfBuf = null; excelWorkbook = null; excelView = 'table'; pdfDoc = null;
    showViewer(); fnameLabel.textContent = file.name;
    setViewMode('table'); updateXlToggle();
    showLoading('엑셀을 표로 여는 중…', '폰에서 바로 표로 그립니다.'); setProgress(30);
    var reader = new FileReader();
    reader.onload = function () {
      try {
        setProgress(65);
        var data = new Uint8Array(reader.result);
        var wb = XLSX.read(data, { type: 'array', cellStyles: true, cellDates: true, cellNF: true });
        if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) throw new Error('시트가 없습니다.');
        excelWorkbook = wb; buildSheetSelector(); renderSheet(0); hideOverlay(); updateXlToggle();
      } catch (err) { isExcelDoc = false; xlToggleBtn.style.display = 'none'; convertAndShowPdf(file); }
    };
    reader.onerror = function () { isExcelDoc = false; xlToggleBtn.style.display = 'none'; convertAndShowPdf(file); };
    reader.readAsArrayBuffer(file);
  }
  function buildSheetSelector() {
    sheetSel.innerHTML = '';
    excelWorkbook.SheetNames.forEach(function (nm, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = nm; sheetSel.appendChild(o); });
    sheetSel.value = '0';
    sheetBar.style.display = (viewMode === 'table' && excelWorkbook.SheetNames.length > 1) ? 'flex' : 'none';
  }
  function renderSheet(idx) {
    if (!excelWorkbook) return;
    idx = Math.max(0, Math.min(excelWorkbook.SheetNames.length - 1, idx || 0));
    var ws = excelWorkbook.Sheets[excelWorkbook.SheetNames[idx]];
    sheetSel.value = String(idx); tableviewEl.innerHTML = ''; tableFontPx = TABLE_FONT_DEFAULT; applyTableFont();
    if (!ws || !ws['!ref']) { var e = document.createElement('div'); e.style.cssText = 'padding:24px;color:var(--sub);font-size:16px;'; e.textContent = '빈 시트입니다.'; tableviewEl.appendChild(e); }
    else tableviewEl.appendChild(buildSheetTable(ws));
    scroller.scrollTop = 0; scroller.scrollLeft = 0;
  }
  function buildSheetTable(ws) {
    var XU = XLSX.utils, ref = XU.decode_range(ws['!ref']);
    var minR = ref.e.r + 1, maxR = ref.s.r - 1, minC = ref.e.c + 1, maxC = ref.s.c - 1;
    for (var R = ref.s.r; R <= ref.e.r; R++) for (var C = ref.s.c; C <= ref.e.c; C++) {
      var cell = ws[XU.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') { if (R < minR) minR = R; if (R > maxR) maxR = R; if (C < minC) minC = C; if (C > maxC) maxC = C; }
    }
    var merges = ws['!merges'] || [];
    merges.forEach(function (m) { if (m.s.r < minR) minR = m.s.r; if (m.e.r > maxR) maxR = m.e.r; if (m.s.c < minC) minC = m.s.c; if (m.e.c > maxC) maxC = m.e.c; });
    if (maxR < minR || maxC < minC) { var d = document.createElement('div'); d.style.cssText = 'padding:24px;color:var(--sub);font-size:16px;'; d.textContent = '표시할 데이터가 없습니다.'; return d; }
    var covered = {}, span = {};
    merges.forEach(function (m) { for (var R2 = m.s.r; R2 <= m.e.r; R2++) for (var C2 = m.s.c; C2 <= m.e.c; C2++) { if (R2 === m.s.r && C2 === m.s.c) span[R2 + ',' + C2] = { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 }; else covered[R2 + ',' + C2] = true; } });
    var cols = ws['!cols'] || [], table = document.createElement('table'), tbody = document.createElement('tbody');
    for (var r = minR; r <= maxR; r++) {
      var tr = document.createElement('tr');
      for (var c = minC; c <= maxC; c++) {
        var key = r + ',' + c; if (covered[key]) continue;
        var td = document.createElement('td'); var sp = span[key];
        if (sp) { if (sp.rs > 1) td.rowSpan = sp.rs; if (sp.cs > 1) td.colSpan = sp.cs; }
        var cl = ws[XU.encode_cell({ r: r, c: c })]; var text = '';
        if (cl) { if (cl.w !== undefined && cl.w !== null) text = cl.w; else if (cl.v !== undefined && cl.v !== null) text = String(cl.v); }
        td.textContent = text; applyCellStyle(td, cl);
        if (r === minR && (!sp || sp.cs === 1)) { var cw = cols[c]; if (cw && (cw.wch || cw.width)) { var w = cw.wch || cw.width; td.style.minWidth = Math.max(3, Math.min(60, Math.round(w))) + 'ch'; } }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody); return table;
  }
  function readFillHex(s) { var rgb = null; if (s.fill && s.fill.fgColor && s.fill.fgColor.rgb) rgb = s.fill.fgColor.rgb; else if (s.patternType && s.fgColor && s.fgColor.rgb) rgb = s.fgColor.rgb; if (!rgb) return null; var hex = '#' + String(rgb).slice(-6); return (hex.length === 7) ? hex : null; }
  function pickTextColor(hex) { var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16); return (0.2126 * r + 0.7152 * g + 0.0722 * b < 145) ? '#ffffff' : '#1a1a1a'; }
  function applyCellStyle(td, cell) {
    if (!cell) return;
    try {
      if (cell.t === 'n' || cell.t === 'd') td.style.textAlign = 'right';
      var s = cell.s; if (!s) return;
      var bgApplied = false, hex = readFillHex(s);
      if (hex && hex.toLowerCase() !== '#ffffff') { td.style.background = hex; bgApplied = true; }
      if (s.font) { if (s.font.bold) td.style.fontWeight = '700'; if (s.font.italic) td.style.fontStyle = 'italic'; if (s.font.underline) td.style.textDecoration = 'underline'; }
      var fc = s.font && s.font.color && s.font.color.rgb;
      if (fc) td.style.color = '#' + String(fc).slice(-6); else if (bgApplied) td.style.color = pickTextColor(hex);
      if (s.alignment && s.alignment.horizontal) { var h = s.alignment.horizontal; if (h === 'center' || h === 'left' || h === 'right') td.style.textAlign = h; }
    } catch (e) {}
  }
  function applyTableFont() { tableviewEl.style.fontSize = tableFontPx + 'px'; }
  function stepTableFont(f) { tableFontPx = Math.max(TABLE_FONT_MIN, Math.min(TABLE_FONT_MAX, Math.round(tableFontPx * f))); applyTableFont(); }
  function updateXlToggle() { if (!isExcelDoc) { xlToggleBtn.style.display = 'none'; return; } xlToggleBtn.style.display = 'inline-flex'; xlToggleBtn.textContent = (excelView === 'table') ? '📄 PDF로 보기' : '📊 표로 보기'; }
  function toggleExcelView() {
    if (!isExcelDoc) return;
    if (excelView === 'table') {
      if (excelPdfBuf) { excelView = 'pdf'; loadPdf({ data: new Uint8Array(excelPdfBuf.slice(0)) }, excelName, false); updateXlToggle(); }
      else openExcelAsPdf();
    } else { excelView = 'table'; setViewMode('table'); if (excelWorkbook) renderSheet(parseInt(sheetSel.value, 10) || 0); updateXlToggle(); }
  }
  function openExcelAsPdf() {
    if (!excelFile) return;
    showLoading('PDF로 변환 중…', 'PC 문서를 폰용으로 변환하고 있어요.'); setProgress(6);
    convertViaOffice(excelFile, excelName, function (buf) {
      excelPdfBuf = buf; excelView = 'pdf'; loadPdf({ data: new Uint8Array(excelPdfBuf.slice(0)) }, excelName, false); updateXlToggle();
    }, function (msg) { showError('PDF로 변환하지 못했습니다.', msg, openExcelAsPdf); });
  }

  // ============ 변환(스마트비서 우편함 — OfficeBridge) ============
  // PDF는 바로, 그 밖(오피스/한글/PPT)은 PC가 변환한 PDF를 받아 표시. (배포본의 /api/convert 대체)
  function convertAndShowPdf(file) {
    setViewMode('pdf'); showViewer();
    var ext = extOf(file.name); fnameLabel.textContent = file.name;
    var wasPpt = isPptName(file.name) || isPptMime(file.type);
    if (ext === 'pdf' || /pdf/i.test(file.type)) {
      showLoading('문서를 여는 중…', 'PDF는 바로 표시됩니다.'); setProgress(20);
      var fr = new FileReader();
      fr.onload = function () { openPdfArrayBuffer(fr.result, file.name, wasPpt); };
      fr.onerror = function () { showError('파일을 읽지 못했습니다.', ''); };
      fr.readAsArrayBuffer(file);
      return;
    }
    showLoading('문서를 여는 중…', 'PC 문서를 폰용으로 변환하고 있어요. 처음 한 번은 1~2분 걸릴 수 있어요.'); setProgress(10);
    convertViaOffice(file, file.name, function (buf) { openPdfArrayBuffer(buf, file.name, wasPpt); },
      function (msg) { showError('이 문서를 열지 못했습니다.', msg, function () { convertAndShowPdf(file); }); });
  }
  function convertViaOffice(file, name, onDone, onErr) {
    if (!global.OfficeBridge) { onErr('연결 모듈을 찾지 못했어요.'); return; }
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token(), op = ++opToken;
    var memo = { id: id, token: tok, title: (name || '문서').slice(0, 40) };
    OfficeBridge.sendDoc(memo, file, function (phase, done, total) { if (op === opToken && total > 1) setProgress(6 + (done / total) * 49); })
      .then(function () { if (op === opToken) pollConvert(id, tok, name, op, onDone, onErr); })
      .catch(function (e) { if (op === opToken) onErr((e && e.message) || String(e)); });
  }
  function pollConvert(id, tok, name, op, onDone, onErr) {
    var start = Date.now(), MAX = 4 * 60 * 1000; setProgress(70);
    (function loop() {
      if (op !== opToken) return;
      OfficeBridge.poll(id, tok).then(function (res) {
        if (op !== opToken) return;
        if (res && res.status === 'done') {
          var d = OfficeBridge.docResultFrom(res);
          if (d && d.pdf_url) {
            setProgress(88);
            fetch(d.pdf_url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.arrayBuffer(); })
              .then(function (buf) { if (op === opToken) onDone(buf); })
              .catch(function (e) { if (op === opToken) onErr((e && e.message) || String(e)); });
          } else { onErr((d && d.error) || res.error || '이 문서는 변환하지 못했어요. 암호가 걸렸거나 형식이 특수할 수 있어요.'); }
          return;
        }
        if (Date.now() - start > MAX) { onErr('변환이 오래 걸려요. PC가 켜져 있는지 확인하고 다시 시도해 주세요.'); return; }
        setTimeout(loop, 2500);
      }).catch(function () { setTimeout(loop, 3500); });
    })();
  }

  function openPdfArrayBuffer(buf, name, isPpt) { loadPdf({ data: new Uint8Array(buf) }, name, isPpt); }

  // ============ 렌더링(지연 렌더) ============
  var p1w = 612, p1h = 792, renderToken = 0, io = null;
  function loadPdf(src, name, isPpt) {
    setViewMode('pdf'); fnameLabel.textContent = name || '문서';
    global.pdfjsLib.getDocument(src).promise.then(function (doc) {
      if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
      pdfDoc = doc; userZoom = 1; renderedZoom = 1; userRotation = 0; return computeBaseScale();
    }).then(function () {
      curIsPpt = (isPpt === undefined) ? isPptName(name) : !!isPpt; pageModeCur = 1;
      renderPdfLayout(); hideOverlay(); scroller.scrollTop = 0; scroller.scrollLeft = 0;
      updatePageBadge(); updateFeatureButtons();
    }).catch(function (err) { showError('문서를 표시하지 못했습니다.', (err && err.message) ? err.message : ''); });
  }
  function computeBaseScale() {
    return pdfDoc.getPage(1).then(function (page) { var vp1 = page.getViewport({ scale: 1, rotation: userRotation }); p1w = vp1.width; p1h = vp1.height; baseScale = (scroller.clientWidth - 12) / vp1.width; });
  }
  function buildSlots() {
    renderToken++; pagesEl.style.transform = 'none'; renderedZoom = userZoom; pagesEl.innerHTML = '';
    if (io) io.disconnect(); io = new IntersectionObserver(onIntersect, { root: scroller, rootMargin: '700px 0px' });
    var scale = baseScale * userZoom, w = Math.floor(p1w * scale), h = Math.floor(p1h * scale);
    for (var i = 1; i <= pdfDoc.numPages; i++) { var slot = document.createElement('div'); slot.className = 'page-slot'; slot.dataset.page = i; slot.dataset.rendered = '0'; slot.style.width = w + 'px'; slot.style.height = h + 'px'; pagesEl.appendChild(slot); io.observe(slot); }
  }
  function onIntersect(entries) { entries.forEach(function (en) { if (en.isIntersecting) renderSlot(en.target); else clearSlot(en.target); }); }
  function renderSlot(slot) {
    if (slot.dataset.rendered === '1' || slot.dataset.rendering === '1') return;
    var num = +slot.dataset.page, token = renderToken; slot.dataset.rendering = '1'; var scale = baseScale * userZoom;
    pdfDoc.getPage(num).then(function (page) {
      if (token !== renderToken) { slot.dataset.rendering = '0'; return; }
      var vp = page.getViewport({ scale: scale, rotation: userRotation });
      slot.style.width = Math.floor(vp.width) + 'px'; slot.style.height = Math.floor(vp.height) + 'px';
      var canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width * DPR); canvas.height = Math.floor(vp.height * DPR);
      var ctx = canvas.getContext('2d'); slot.innerHTML = ''; slot.appendChild(canvas);
      return page.render({ canvasContext: ctx, viewport: vp, transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null }).promise.then(function () {
        if (token !== renderToken) { slot.innerHTML = ''; slot.dataset.rendered = '0'; } else slot.dataset.rendered = '1'; slot.dataset.rendering = '0';
      });
    }).catch(function () { slot.dataset.rendering = '0'; });
  }
  function clearSlot(slot) { if (slot.dataset.rendered === '1') { slot.innerHTML = ''; slot.dataset.rendered = '0'; } }
  function renderPdfLayout() { if (pdfPaged) { if (io) io.disconnect(); renderPagedPage(); } else buildSlots(); }
  function renderPagedPage() {
    if (!pdfDoc) return; renderToken++; var token = renderToken; pagesEl.style.transform = 'none'; renderedZoom = userZoom; pagesEl.innerHTML = '';
    pageModeCur = Math.max(1, Math.min(pdfDoc.numPages, pageModeCur)); var scale = baseScale * userZoom;
    pdfDoc.getPage(pageModeCur).then(function (page) {
      if (token !== renderToken) return;
      var vp = page.getViewport({ scale: scale, rotation: userRotation });
      var slot = document.createElement('div'); slot.className = 'page-slot'; slot.style.width = Math.floor(vp.width) + 'px'; slot.style.height = Math.floor(vp.height) + 'px';
      var canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width * DPR); canvas.height = Math.floor(vp.height * DPR);
      var ctx = canvas.getContext('2d'); slot.appendChild(canvas); pagesEl.appendChild(slot);
      return page.render({ canvasContext: ctx, viewport: vp, transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null }).promise.then(function () { if (token !== renderToken) return; scroller.scrollTop = 0; scroller.scrollLeft = 0; });
    }).catch(function () {});
  }
  function setPdfLayout(paged) {
    if (pdfPaged === paged) { updateLayoutBtn(); return; }
    var keep = getCurrentPage(); pdfPaged = paged;
    try { localStorage.setItem('docviewer_paged', paged ? '1' : '0'); } catch (e) {}
    updateLayoutBtn(); if (viewMode !== 'pdf' || !pdfDoc) return;
    userZoom = 1; renderedZoom = 1;
    if (paged) { pageModeCur = keep; if (io) io.disconnect(); renderPagedPage(); }
    else { buildSlots(); requestAnimationFrame(function () { goToPage(keep, true); }); }
    updatePageBadge();
  }

  // ============ 줌 ============
  function applyZoom() { if (!pdfDoc) return; renderPdfLayout(); updatePageBadge(); }
  function stepZoom(f) { userZoom = Math.max(0.5, Math.min(5, userZoom * f)); applyZoom(); }
  function livePreview() { pagesEl.style.transform = 'scale(' + (userZoom / renderedZoom) + ')'; }

  // ============ 회전 ============
  function rotate() {
    userRotation = (userRotation + 90) % 360; if (!pdfDoc) return; var keepPage = getCurrentPage();
    computeBaseScale().then(function () {
      if (pdfPaged) { pageModeCur = keepPage; renderPagedPage(); updatePageBadge(); }
      else { buildSlots(); updatePageBadge(); requestAnimationFrame(function () { goToPage(keepPage, true); }); }
    });
  }

  // ============ 페이지 표시·이동 ============
  function getCurrentPage() {
    if (!pdfDoc) return 1;
    if (pdfPaged) return Math.max(1, Math.min(pdfDoc.numPages, pageModeCur));
    var kids = pagesEl.children, mid = scroller.scrollTop + scroller.clientHeight / 2, acc = 0;
    for (var i = 0; i < kids.length; i++) { acc += kids[i].offsetHeight + 12; if (mid <= acc) return i + 1; }
    return kids.length || 1;
  }
  function updatePageBadge() {
    if (!pdfDoc) { pageBadge.textContent = '– / –'; return; }
    pageBadge.textContent = getCurrentPage() + ' / ' + pdfDoc.numPages;
    prevBtn.disabled = (getCurrentPage() <= 1); nextBtn.disabled = (getCurrentPage() >= pdfDoc.numPages);
  }
  function goToPage(n, instant) {
    if (!pdfDoc) return; n = Math.max(1, Math.min(pdfDoc.numPages, n));
    if (pdfPaged) { pageModeCur = n; userZoom = 1; renderPagedPage(); updatePageBadge(); return; }
    var slot = pagesEl.children[n - 1]; if (!slot) return;
    scroller.scrollTo({ top: slot.offsetTop - 6, behavior: instant ? 'auto' : 'smooth' });
  }
  function promptGoToPage() {
    if (!pdfDoc) return; var ans = null;
    try { ans = global.prompt('몇 쪽으로 이동할까요? (1 ~ ' + pdfDoc.numPages + ')', String(getCurrentPage())); } catch (e) {}
    if (ans == null) return; var n = parseInt(ans, 10); if (!isNaN(n)) goToPage(n);
  }

  // ============ 슬라이드쇼 / 전체화면(Fullscreen API) ============
  var ssOpen = false, ssMode = 'show', ssIndex = 1, ssRenderToken = 0, ssTimer = null, ssPlaying = false, ssLoop = false, ssInterval = 5000, ssHideT = null;
  var ssRot = 0, ssZoom = 1, ssZoomLive = 1, ssPinching = false, ssPinchStart = 0, ssPinchZoom0 = 1, ssJustPinched = false;
  var bookFlip = false; try { bookFlip = localStorage.getItem('docviewer_bookflip') === '1'; } catch (e) {}
  var pageFlip = null, bookActive = false, flipCur = 1, flipLayout = null, flipPageAspect = 0.773, flipPageEls = [], flipRenderSeq = 0, flipHintT = null, flipResizeT = null, flipBookEl = null;

  function renderSlide(n) {
    if (!pdfDoc) return; ssIndex = Math.max(1, Math.min(pdfDoc.numPages, n)); updateSSInfo(); ssCanvas.style.transform = 'none'; var token = ++ssRenderToken;
    pdfDoc.getPage(ssIndex).then(function (page) {
      if (token !== ssRenderToken || !ssOpen) return;
      var vpBase = page.getViewport({ scale: 1, rotation: ssRot });
      var fit = Math.min(global.innerWidth / vpBase.width, global.innerHeight / vpBase.height);
      var vp = page.getViewport({ scale: fit * (ssZoom || 1), rotation: ssRot });
      var cw = Math.floor(vp.width), ch = Math.floor(vp.height);
      ssCanvas.width = Math.floor(cw * DPR); ssCanvas.height = Math.floor(ch * DPR); ssCanvas.style.width = cw + 'px'; ssCanvas.style.height = ch + 'px';
      var ctx = ssCanvas.getContext('2d'); ctx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
      return page.render({ canvasContext: ctx, viewport: vp, transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null }).promise.then(function () {
        applySSZoomState();
        if (ssZoom > 1.01) requestAnimationFrame(function () { ssStage.scrollLeft = Math.max(0, (ssStage.scrollWidth - ssStage.clientWidth) / 2); ssStage.scrollTop = Math.max(0, (ssStage.scrollHeight - ssStage.clientHeight) / 2); });
      });
    }).catch(function () {});
  }
  function applySSZoomState() { ssStage.classList.toggle('zoomed', ssZoom > 1.01); }
  function ssStepZoom(f) { ssZoom = Math.max(1, Math.min(5, +(ssZoom * f).toFixed(3))); applySSZoomState(); renderSlide(ssIndex); showSSControls(); }
  function ssZoomFit() { ssZoom = 1; applySSZoomState(); renderSlide(ssIndex); showSSControls(); }
  function updateSSInfo() { if (!pdfDoc) return; ssBadge.textContent = ssIndex + ' / ' + pdfDoc.numPages; ssPrevBtn.disabled = (ssIndex <= 1) && !ssLoop; ssNextBtn.disabled = (ssIndex >= pdfDoc.numPages) && !ssLoop; }
  function ssGo(n) { if (ssZoom > 1.01) { ssZoom = 1; applySSZoomState(); } renderSlide(n); if (ssPlaying) scheduleNext(); }
  function ssNext() { if (ssIndex < pdfDoc.numPages) ssGo(ssIndex + 1); else if (ssLoop) ssGo(1); }
  function ssPrev() { if (ssIndex > 1) ssGo(ssIndex - 1); else if (ssLoop) ssGo(pdfDoc.numPages); }
  function updatePlayBtn() { ssPlayBtn.textContent = ssPlaying ? '⏸' : '▶'; ssPlayBtn.title = ssPlaying ? '정지' : '자동 재생'; ssPlayBtn.classList.toggle('on', ssPlaying); }
  function scheduleNext() { if (ssTimer) clearTimeout(ssTimer); ssTimer = setTimeout(function () { if (!ssPlaying || !ssOpen) return; if (ssIndex >= pdfDoc.numPages) { if (ssLoop) { renderSlide(1); scheduleNext(); } else stopAutoplay(); } else { renderSlide(ssIndex + 1); scheduleNext(); } }, ssInterval); }
  function startAutoplay() { if (!pdfDoc) return; ssPlaying = true; updatePlayBtn(); if (ssIndex >= pdfDoc.numPages && !ssLoop) renderSlide(1); scheduleNext(); showSSControls(); }
  function stopAutoplay() { ssPlaying = false; updatePlayBtn(); if (ssTimer) { clearTimeout(ssTimer); ssTimer = null; } }
  function showSSControls() { ssEl.classList.remove('controls-hidden'); if (ssHideT) clearTimeout(ssHideT); if (bookActive) return; ssHideT = setTimeout(function () { if (ssOpen) ssEl.classList.add('controls-hidden'); }, 2800); }
  function toggleSSControls() { if (ssEl.classList.contains('controls-hidden')) showSSControls(); else ssEl.classList.add('controls-hidden'); }
  function ssTapAt(x) { var w = global.innerWidth; if (x < w * 0.4) { ssPrev(); showSSControls(); } else if (x > w * 0.6) { ssNext(); showSSControls(); } else toggleSSControls(); }
  function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
  function tryLockLandscape() { try { if (screen.orientation && screen.orientation.lock) { var p = screen.orientation.lock('landscape'); if (p && p.catch) p.catch(function () {}); } } catch (e) {} }
  function tryUnlockOrientation() { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {} }
  function openSlideshow() { if (!pdfDoc) return; ssMode = 'show'; openSSCommon(); }
  function openFullscreenPage() { if (!pdfDoc) return; ssMode = 'page'; openSSCommon(); }
  function openSSCommon() {
    ssOpen = true; ssRot = 0; ssZoom = 1; ssZoomLive = 1; ssPinching = false; applySSZoomState(); ssRotateBtn.classList.remove('on'); ssCanvas.style.transform = 'none';
    ssCtlShow.style.display = (ssMode === 'show') ? 'flex' : 'none'; ssCtlPage.style.display = (ssMode === 'page') ? 'flex' : 'none';
    ssTitle.textContent = fnameLabel.textContent || '문서'; ssIndex = getCurrentPage();
    bookActive = false; ssEl.classList.remove('book'); ssStage.style.display = ''; destroyPageFlip();
    ssFlipBtn.style.display = (ssMode === 'page' && flipAvailable()) ? 'inline-flex' : 'none'; updateFlipUI();
    ssEl.classList.add('on'); document.addEventListener('keydown', ssKey);
    try {
      var rq = ssEl.requestFullscreen || ssEl.webkitRequestFullscreen;
      var lockIf = function () { if (ssMode === 'show') tryLockLandscape(); };
      if (rq) { var p = rq.call(ssEl); if (p && p.then) p.then(lockIf).catch(lockIf); else lockIf(); } else lockIf();
    } catch (e) { if (ssMode === 'show') tryLockLandscape(); }
    renderSlide(ssIndex); if (ssMode === 'show') updatePlayBtn();
    if (ssMode === 'page' && bookFlip && flipAvailable()) enterBookFlip();
    showSSControls();
  }
  function closeSlideshow() {
    if (!ssOpen) return; ssOpen = false;
    if (bookActive) { bookActive = false; ssEl.classList.remove('book'); destroyPageFlip(); ssStage.style.display = ''; }
    if (flipResizeT) { clearTimeout(flipResizeT); flipResizeT = null; } if (flipHintT) { clearTimeout(flipHintT); flipHintT = null; } if (flipHintEl) flipHintEl.classList.remove('show');
    stopAutoplay(); document.removeEventListener('keydown', ssKey); if (ssHideT) { clearTimeout(ssHideT); ssHideT = null; } tryUnlockOrientation();
    try { if (document.fullscreenElement) { var p = document.exitFullscreen(); if (p && p.catch) p.catch(function () {}); } } catch (e) {}
    ssEl.classList.remove('on'); ssEl.classList.remove('controls-hidden'); ssRot = 0; ssZoom = 1; ssZoomLive = 1; ssPinching = false; ssCanvas.style.transform = 'none'; applySSZoomState(); ssRotateBtn.classList.remove('on');
    // 전체화면에서 넘긴 쪽을 일반 뷰어에도 반영
    if (pdfDoc) { if (pdfPaged) { pageModeCur = ssIndex; renderPagedPage(); } else goToPage(ssIndex, true); updatePageBadge(); }
  }
  function ssKey(e) {
    if (!ssOpen) return;
    if (e.key === 'Escape') { closeSlideshow(); return; }
    if (bookActive) { if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); try { pageFlip.flipNext(); } catch (x) {} showSSControls(); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); try { pageFlip.flipPrev(); } catch (x) {} showSSControls(); } return; }
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); ssNext(); showSSControls(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); ssPrev(); showSSControls(); }
  }

  // ============ 책 넘김(StPageFlip) ============
  function flipAvailable() { return (typeof St !== 'undefined') && St && !!St.PageFlip; }
  function showFlipHint(msg) { if (!flipHintEl) return; flipHintEl.textContent = msg; flipHintEl.classList.add('show'); if (flipHintT) clearTimeout(flipHintT); flipHintT = setTimeout(function () { flipHintEl.classList.remove('show'); }, 2600); }
  function computeFlipLayout(pa) {
    var availW = global.innerWidth - 8, availH = global.innerHeight - 8, spread = (global.innerWidth > global.innerHeight) && (global.innerWidth >= 720), singleW, singleH;
    if (spread) { var h = availH, w = h * (2 * pa); if (w > availW) { w = availW; h = w / (2 * pa); } singleW = w / 2; singleH = h; }
    else { var h2 = availH, w2 = h2 * pa; if (w2 > availW) { w2 = availW; h2 = w2 / pa; } singleW = w2; singleH = h2; }
    return { spread: spread, singleW: Math.max(40, singleW), singleH: Math.max(40, singleH) };
  }
  function renderFlipPage(num, seq) {
    var el = flipPageEls[num - 1]; if (!el || el.dataset.rendered === '1' || el.dataset.rendering === '1') return; if (!pdfDoc || !flipLayout) return;
    el.dataset.rendering = '1'; var cssW = flipLayout.singleW, cssH = flipLayout.singleH;
    pdfDoc.getPage(num).then(function (page) {
      if (seq !== flipRenderSeq) { el.dataset.rendering = '0'; return; }
      var vp0 = page.getViewport({ scale: 1 }), scale = Math.min(cssW / vp0.width, cssH / vp0.height), vp = page.getViewport({ scale: scale * DPR });
      var canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(cssW * DPR)); canvas.height = Math.max(1, Math.round(cssH * DPR));
      var ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      var offX = (canvas.width - vp.width) / 2, offY = (canvas.height - vp.height) / 2;
      return page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, offX, offY] }).promise.then(function () { if (seq !== flipRenderSeq) { el.dataset.rendering = '0'; return; } el.innerHTML = ''; el.appendChild(canvas); el.dataset.rendered = '1'; el.dataset.rendering = '0'; });
    }).catch(function () { el.dataset.rendering = '0'; });
  }
  function renderFlipWindow(seq) {
    if (!bookActive || !pdfDoc) return; var cur = flipCur;
    try { if (pageFlip && pageFlip.getCurrentPageIndex) cur = pageFlip.getCurrentPageIndex() + 1; } catch (e) {}
    var from = Math.max(1, cur - 2), to = Math.min(pdfDoc.numPages, cur + 3);
    for (var n = from; n <= to; n++) renderFlipPage(n, (seq || flipRenderSeq));
  }
  function updateFlipBadge() { if (!pdfDoc) return; ssBadge.textContent = flipCur + ' / ' + pdfDoc.numPages; }
  function destroyPageFlip() { if (pageFlip) { try { pageFlip.destroy(); } catch (e) {} pageFlip = null; } try { if (flipStageEl) flipStageEl.innerHTML = ''; } catch (e) {} flipBookEl = null; flipPageEls = []; }
  function buildBook() {
    if (!flipAvailable() || !pdfDoc) return; flipRenderSeq++; var mySeq = flipRenderSeq; destroyPageFlip(); flipLayout = computeFlipLayout(flipPageAspect);
    flipBookEl = document.createElement('div'); flipBookEl.id = 'flipBook'; flipStageEl.appendChild(flipBookEl); flipPageEls = [];
    for (var i = 1; i <= pdfDoc.numPages; i++) { var d = document.createElement('div'); d.className = 'flip-page'; d.dataset.page = String(i); d.dataset.rendered = '0'; flipBookEl.appendChild(d); flipPageEls.push(d); }
    try {
      pageFlip = new St.PageFlip(flipBookEl, { width: Math.round(flipLayout.singleW), height: Math.round(flipLayout.singleH), size: 'fixed', usePortrait: !flipLayout.spread, showCover: false, drawShadow: true, flippingTime: 650, maxShadowOpacity: 0.5, mobileScrollSupport: false, useMouseEvents: true, swipeDistance: 30, disableFlipByClick: false, autoSize: false });
      pageFlip.loadFromHTML(flipBookEl.querySelectorAll('.flip-page'));
      pageFlip.on('flip', function (e) { flipCur = ((e.data | 0) + 1); updateFlipBadge(); renderFlipWindow(mySeq); showSSControls(); });
      pageFlip.on('changeState', function (e) { if (e.data === 'read') renderFlipWindow(mySeq); });
      try { pageFlip.turnToPage(Math.max(0, Math.min(pdfDoc.numPages - 1, flipCur - 1))); } catch (e) {}
      renderFlipWindow(mySeq); updateFlipBadge();
    } catch (err) { destroyPageFlip(); bookActive = false; ssEl.classList.remove('book'); ssStage.style.display = ''; setBookFlipPref(false); updateFlipUI(); renderSlide(ssIndex); showFlipHint('책 넘김을 열지 못해 기본 보기로 전환했어요'); }
  }
  function scheduleBookRebuild() { if (!bookActive) return; if (flipResizeT) clearTimeout(flipResizeT); flipResizeT = setTimeout(function () { if (ssOpen && bookActive) buildBook(); }, 220); }
  function setBookFlipPref(v) { bookFlip = !!v; try { localStorage.setItem('docviewer_bookflip', v ? '1' : '0'); } catch (e) {} }
  function enterBookFlip() {
    if (!pdfDoc || !flipAvailable() || ssMode !== 'page') return; if (bookActive) return;
    flipCur = Math.max(1, Math.min(pdfDoc.numPages, ssIndex || 1)); bookActive = true; ssEl.classList.add('book'); ssStage.style.display = 'none'; ssZoom = 1; applySSZoomState(); updateFlipUI(); showSSControls();
    pdfDoc.getPage(1).then(function (pg) { var vp = pg.getViewport({ scale: 1 }); if (vp.width && vp.height) flipPageAspect = vp.width / vp.height; }).catch(function () {}).then(function () { if (bookActive) buildBook(); });
  }
  function exitBookFlip() { ssIndex = Math.max(1, Math.min(pdfDoc ? pdfDoc.numPages : 1, flipCur)); bookActive = false; ssEl.classList.remove('book'); destroyPageFlip(); ssStage.style.display = ''; ssZoom = 1; applySSZoomState(); updateFlipUI(); renderSlide(ssIndex); showSSControls(); }
  function updateFlipUI() { var on = bookActive; ssFlipBtn.classList.toggle('on', on); ssZoomOutBtn.style.display = on ? 'none' : 'inline-flex'; ssFitBtn.style.display = on ? 'none' : 'inline-flex'; ssZoomInBtn.style.display = on ? 'none' : 'inline-flex'; ssRotateBtn.style.display = on ? 'none' : 'inline-flex'; }
  function toggleBookFlip() {
    if (!flipAvailable()) { showFlipHint('이 기기에선 책 넘김을 쓸 수 없어 기본 보기로 봅니다'); return; } if (ssMode !== 'page') return;
    if (bookActive) { setBookFlipPref(false); exitBookFlip(); showFlipHint('기본 보기로 돌아왔어요 (확대·팬·회전 가능)'); }
    else { setBookFlipPref(true); enterBookFlip(); showFlipHint('책 넘김 · 확대하려면 📖를 다시 끄세요'); }
  }

  // ============ 진입점 ============
  function handleLocalFile(file) {
    if (!file) return; opToken++;
    if (!isViewable(file.name, file.type)) { showViewer(); setViewMode('pdf'); fnameLabel.textContent = file.name; showError('이 형식은 뷰어에서 열 수 없어요.', extOf(file.name) || file.name); return; }
    handleFile(file);
  }
  function viewChatAttachment(att) {
    if (!att || !att.url) { toast('열 수 있는 파일이 아니에요.'); return; }
    opToken++; var op = opToken; var name = att.name || '문서';
    showViewer(); setViewMode('pdf'); fnameLabel.textContent = name;
    showLoading('문서를 여는 중…', '문서를 불러오고 있어요.'); setProgress(15);
    fetch(att.url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.blob(); })
      .then(function (blob) { if (op !== opToken) return; var f = new File([blob], name, { type: blob.type || att.mime || 'application/octet-stream' }); handleFile(f); })
      .catch(function (e) { if (op === opToken) showError('문서를 여는 데 실패했어요.', (e && e.message) || String(e)); });
  }

  // ============ 초기화 ============
  function init(opts) {
    opts = opts || {};
    if (opts.toast) toast = opts.toast;
    rootEl = $('docRoot'); viewerEl = $('viewer'); overlay = $('docOverlay'); panel = $('docPanel'); fileInput = $('docFileInput');
    pagesEl = $('pages'); tableviewEl = $('tableview'); sheetBar = $('sheetBar'); sheetSel = $('sheetSel'); xlToggleBtn = $('dvXlToggle');
    pageNavGrp = $('pageNavGrp'); scroller = $('scroller'); pageBadge = $('dvBadge'); fnameLabel = $('dvFname');
    prevBtn = $('dvPrev'); nextBtn = $('dvNext'); darkBtn = $('dvDark'); rotateBtn = $('dvRotate'); slideshowBtn = $('dvSlideshow'); fullscreenBtn = $('dvFullscreen'); layoutBtn = $('layoutBtn');
    ssEl = $('slideshow'); ssStage = $('ssStage'); ssWrap = $('ssWrap'); ssCanvas = $('ssCanvas'); ssTitle = $('ssTitle'); ssBadge = $('ssBadge');
    ssExitBtn = $('ssExit'); ssPrevBtn = $('ssPrev'); ssNextBtn = $('ssNext'); ssPlayBtn = $('ssPlay'); ssLoopBtn = $('ssLoop'); ssRotateBtn = $('ssRotate'); ssIntervalSel = $('ssInterval');
    ssCtlShow = $('ssCtlShow'); ssCtlPage = $('ssCtlPage'); ssPrevPBtn = $('ssPrevP'); ssNextPBtn = $('ssNextP'); ssZoomInBtn = $('ssZoomIn'); ssZoomOutBtn = $('ssZoomOut'); ssFitBtn = $('ssFit'); ssFlipBtn = $('ssFlip'); flipStageEl = $('flipStage'); flipHintEl = $('flipHint');

    // 야간 초기화
    (function () { var on = false; try { on = localStorage.getItem(DARK_STORE) === '1'; } catch (e) {} applyDark(on); })();

    if ($('docPickBtn')) $('docPickBtn').addEventListener('click', function () { if (fileInput) fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) handleLocalFile(f); });

    $('dvBack').onclick = showPick;
    $('dvZoomIn').onclick = function () { if (viewMode === 'table') stepTableFont(1.15); else stepZoom(1.25); };
    $('dvZoomOut').onclick = function () { if (viewMode === 'table') stepTableFont(1 / 1.15); else stepZoom(0.8); };
    $('zoomFit').onclick = function () { if (viewMode === 'table') { tableFontPx = TABLE_FONT_DEFAULT; applyTableFont(); return; } userZoom = 1; applyZoom(); };
    prevBtn.onclick = function () { goToPage(getCurrentPage() - 1); };
    nextBtn.onclick = function () { goToPage(getCurrentPage() + 1); };
    pageBadge.onclick = promptGoToPage;
    rotateBtn.onclick = rotate;
    darkBtn.onclick = function () { applyDark(!rootEl.classList.contains('dark')); };
    slideshowBtn.onclick = openSlideshow;
    fullscreenBtn.onclick = openFullscreenPage;
    layoutBtn.onclick = function () { setPdfLayout(!pdfPaged); };
    xlToggleBtn.onclick = toggleExcelView;
    sheetSel.onchange = function () { if (excelWorkbook) renderSheet(parseInt(sheetSel.value, 10) || 0); };

    // 슬라이드쇼 버튼 배선
    ssExitBtn.onclick = function (e) { e.stopPropagation(); closeSlideshow(); };
    ssPrevBtn.onclick = function (e) { e.stopPropagation(); ssPrev(); showSSControls(); };
    ssNextBtn.onclick = function (e) { e.stopPropagation(); ssNext(); showSSControls(); };
    ssPrevPBtn.onclick = function (e) { e.stopPropagation(); if (bookActive) { try { pageFlip.flipPrev(); } catch (x) {} } else { ssZoom = 1; ssPrev(); } showSSControls(); };
    ssNextPBtn.onclick = function (e) { e.stopPropagation(); if (bookActive) { try { pageFlip.flipNext(); } catch (x) {} } else { ssZoom = 1; ssNext(); } showSSControls(); };
    ssZoomInBtn.onclick = function (e) { e.stopPropagation(); ssStepZoom(1.25); };
    ssZoomOutBtn.onclick = function (e) { e.stopPropagation(); ssStepZoom(0.8); };
    ssFitBtn.onclick = function (e) { e.stopPropagation(); ssZoomFit(); };
    ssPlayBtn.onclick = function (e) { e.stopPropagation(); if (ssPlaying) stopAutoplay(); else startAutoplay(); showSSControls(); };
    ssLoopBtn.onclick = function (e) { e.stopPropagation(); ssLoop = !ssLoop; ssLoopBtn.classList.toggle('on', ssLoop); ssLoopBtn.title = ssLoop ? '반복 켜짐' : '반복'; updateSSInfo(); showSSControls(); };
    ssRotateBtn.onclick = function (e) { e.stopPropagation(); ssRot = (ssRot === 0) ? 90 : 0; ssRotateBtn.classList.toggle('on', ssRot !== 0); renderSlide(ssIndex); showSSControls(); };
    ssIntervalSel.onclick = function (e) { e.stopPropagation(); };
    ssIntervalSel.onchange = function (e) { e.stopPropagation(); ssInterval = parseInt(ssIntervalSel.value, 10) || 5000; if (ssPlaying) scheduleNext(); showSSControls(); };
    ssFlipBtn.onclick = function (e) { e.stopPropagation(); toggleBookFlip(); };

    // ---- 일반 뷰어 제스처: 핀치·더블탭·스와이프 ----
    var pinchStart = 0, pinchZoom0 = 1, pinchTableFont0 = 15, pinching = false;
    scroller.addEventListener('touchstart', function (e) { if (e.touches.length === 2) { pinching = true; pinchStart = dist(e.touches); pinchZoom0 = userZoom; pinchTableFont0 = tableFontPx; } }, { passive: true });
    scroller.addEventListener('touchmove', function (e) {
      if (pinching && e.touches.length === 2) {
        e.preventDefault(); var r = dist(e.touches) / pinchStart;
        if (viewMode === 'table') { tableFontPx = Math.max(TABLE_FONT_MIN, Math.min(TABLE_FONT_MAX, Math.round(pinchTableFont0 * r))); applyTableFont(); }
        else { userZoom = Math.max(0.5, Math.min(5, pinchZoom0 * r)); livePreview(); }
      }
    }, { passive: false });
    scroller.addEventListener('touchend', function (e) { if (pinching && e.touches.length < 2) { pinching = false; if (viewMode !== 'table') applyZoom(); } });
    var lastTap = 0, tapX = 0, tapY = 0, swX = 0, swY = 0;
    scroller.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { tapX = swX = e.touches[0].clientX; tapY = swY = e.touches[0].clientY; } }, { passive: true });
    scroller.addEventListener('touchend', function (e) {
      // 더블탭 확대(표 제외)
      if (!pinching && e.touches.length === 0 && viewMode !== 'table') {
        var ct = e.changedTouches && e.changedTouches[0];
        if (ct && !(Math.abs(ct.clientX - tapX) > 24 || Math.abs(ct.clientY - tapY) > 24)) {
          var now = Date.now(); if (now - lastTap < 300) { userZoom = (userZoom > 1.2) ? 1 : 2; applyZoom(); lastTap = 0; } else lastTap = now;
        }
      }
      // 한장넘김 좌우 스와이프
      if (pdfPaged && viewMode === 'pdf' && !pinching && userZoom <= 1.01 && e.changedTouches && e.changedTouches.length) {
        var t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { if (dx < 0) goToPage(pageModeCur + 1); else goToPage(pageModeCur - 1); }
      }
    });
    scroller.addEventListener('scroll', function () { global.requestAnimationFrame(updatePageBadge); }, { passive: true });

    // ---- 슬라이드쇼 제스처 ----
    var ssTX = 0, ssTY = 0;
    ssStage.addEventListener('touchstart', function (e) { if (e.touches.length === 2) { ssPinching = true; ssPinchStart = dist(e.touches); ssPinchZoom0 = ssZoom; ssZoomLive = ssZoom; return; } if (e.touches.length === 1) { ssTX = e.touches[0].clientX; ssTY = e.touches[0].clientY; } }, { passive: true });
    ssStage.addEventListener('touchmove', function (e) { if (ssPinching && e.touches.length === 2) { e.preventDefault(); var r = dist(e.touches) / ssPinchStart; ssZoomLive = Math.max(1, Math.min(5, ssPinchZoom0 * r)); ssCanvas.style.transform = 'scale(' + (ssZoomLive / (ssZoom || 1)) + ')'; } }, { passive: false });
    ssStage.addEventListener('touchend', function (e) {
      if (ssPinching && e.touches.length < 2) { ssPinching = false; ssZoom = ssZoomLive; applySSZoomState(); renderSlide(ssIndex); ssJustPinched = true; setTimeout(function () { ssJustPinched = false; }, 350); return; }
      if (ssJustPinched) return; if (!e.changedTouches || !e.changedTouches.length) return;
      var t = e.changedTouches[0], dx = t.clientX - ssTX, dy = t.clientY - ssTY;
      if (ssZoom > 1.01) { if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { e.preventDefault(); toggleSSControls(); } return; }
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); if (dx < 0) ssNext(); else ssPrev(); showSSControls(); }
      else if (Math.abs(dx) < 25 && Math.abs(dy) < 25) { e.preventDefault(); ssTapAt(t.clientX); }
    });
    ssStage.addEventListener('click', function (e) { if (ssZoom > 1.01) return; ssTapAt(e.clientX); });

    // ---- 리사이즈/방향 ----
    var rT;
    global.addEventListener('resize', function () {
      if (ssOpen) { if (bookActive) scheduleBookRebuild(); else renderSlide(ssIndex); return; }
      if (!pdfDoc || !rootEl.classList.contains('on')) return; clearTimeout(rT); rT = setTimeout(function () { computeBaseScale().then(renderPdfLayout).then(updatePageBadge); }, 250);
    });
    global.addEventListener('orientationchange', function () { if (!ssOpen) return; if (bookActive) { scheduleBookRebuild(); setTimeout(function () { if (ssOpen && bookActive) buildBook(); }, 280); return; } renderSlide(ssIndex); setTimeout(function () { if (ssOpen) renderSlide(ssIndex); }, 250); });
  }

  global.SmartDocs = {
    init: init,
    pick: function () { if (fileInput) fileInput.click(); },
    showPick: showPick,
    handleLocalFile: handleLocalFile,
    viewChatAttachment: viewChatAttachment,
    isViewable: isViewable, extOf: extOf,
    isViewerOpen: function () { return !!(rootEl && rootEl.classList.contains('on')); },
    isFullscreen: function () { return ssOpen; },
    closeFullscreen: closeSlideshow,
    leave: function () { closeSlideshow(); showPick(); }
  };
})(window);
