/* ============================================================================
 * docviewer.js — 스마트비서 내장 문서 뷰어 (SmartDocs)
 * ----------------------------------------------------------------------------
 * 기존 apps/doc-viewer 의 PDF.js 뷰어(지연 렌더·핀치 줌·폭 맞춤·페이지 배지·연속
 * 스크롤·리사이즈 대응)를 그대로 이식하고, 대표님 요청 기능을 더했다:
 *   · 전체화면 보기(앱 크롬을 숨기고 화면 가득)
 *   · 보기 모드: 연속 스크롤 ↔ 한 장씩(single-page) + 좌우 스와이프/이전·다음 버튼
 *   · 책 넘김(페이지 플립) 모션 on/off
 *   · 회전(90°), 야간(색 반전) 보기
 *   · 폭 맞춤 ↔ 페이지(전체) 맞춤 토글, 확대/축소(버튼·핀치), 페이지 이동(점프)
 *   · 최근 본 문서(세션 기억)
 * 변환은 스마트비서 우편함 파이프라인(OfficeBridge, kind='doc')을 재사용한다.
 * PDF.js 는 www/vendor 에 번들(오프라인·CDN 차단 대비).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var toast = function () {};
  var pdfReady = (typeof global.pdfjsLib !== 'undefined');
  if (pdfReady) {
    try { global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; } catch (e) { pdfReady = false; }
  }

  // ---- DOM ----
  var pickEl, viewerEl, statusEl, fnameEl, badgeEl, scroller, pagesEl, fileInput, pageNav, jumpBtn;

  // ---- 상태 ----
  var pdfDoc = null, userZoom = 1, renderedZoom = 1;
  var p1w = 612, p1h = 792, renderToken = 0, io = null;
  var DPR = Math.min(global.devicePixelRatio || 1, 2.5);
  var opToken = 0;
  var viewMode = 'scroll';      // 'scroll'(연속) | 'page'(한 장씩)
  var fitMode = 'width';        // 'width'(폭 맞춤) | 'page'(페이지 맞춤)
  var rotation = 0;             // 0/90/180/270
  var night = false, flip = true, fullscreen = false;
  var curPage = 1;             // page 모드 현재 쪽
  var recents = [];            // {name, buf}(세션 기억, 메모리)
  var VIEWABLE = ['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];

  function extOf(name) { return ((String(name || '').split('.').pop()) || '').toLowerCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isViewable(name, mime) {
    if (VIEWABLE.indexOf(extOf(name)) !== -1) return true;
    return /pdf|word|excel|spreadsheet|presentation|officedocument|hwp/i.test(mime || '');
  }

  // ============ 패널 전환 ============
  function showPick() {
    if (viewerEl) viewerEl.style.display = 'none';
    if (pickEl) pickEl.style.display = 'block';
    setFullscreen(false);
    renderRecents();
  }
  function showViewer() {
    if (pickEl) pickEl.style.display = 'none';
    if (viewerEl) viewerEl.style.display = 'flex';
  }
  function setStatus(html, kind) {
    if (!statusEl) return;
    if (!html) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; return; }
    statusEl.className = 'doc-status ' + (kind || '');
    statusEl.innerHTML = html; statusEl.style.display = 'block';
  }
  function loadingStatus(msg, sub) {
    setStatus('<span class="spinner"></span><span class="ds-tx">' + esc(msg) +
      (sub ? '<br><small>' + esc(sub) + '</small>' : '') + '</span>', 'load');
  }

  // ============ PDF 열기 ============
  function loadPdfSrc(src, name, keepBuf) {
    if (!pdfReady) { setStatus('⚠️ PDF 표시기를 불러오지 못했어요. 앱을 다시 열어 주세요.', 'err'); showPick(); return; }
    var myOp = opToken;
    showViewer();
    if (fnameEl) fnameEl.textContent = name || '문서';
    global.pdfjsLib.getDocument(src).promise.then(function (doc) {
      if (myOp !== opToken) { try { doc.destroy(); } catch (e) {} return; }
      if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
      pdfDoc = doc; userZoom = 1; renderedZoom = 1; rotation = 0; curPage = 1;
      if (keepBuf && src && src.data) addRecent(name, src.data);
      return computeBaseScale();
    }).then(function () {
      if (myOp !== opToken || !pdfDoc) return;
      setStatus('');
      applyNight();
      rebuild();
      scroller.scrollTop = 0;
    }).catch(function (err) {
      if (myOp !== opToken) return;
      setStatus('⚠️ 문서를 표시하지 못했어요.' + (err && err.message ? '<br><small>' + esc(err.message) + '</small>' : ''), 'err');
      showPick();
    });
  }

  function rotFor(page) { return (page.rotate + rotation) % 360; }
  // 한 페이지의 렌더 배율(fit 모드·회전·userZoom 반영)
  function scaleFor(page) {
    var vp1 = page.getViewport({ scale: 1, rotation: rotFor(page) });
    var availW = Math.max(80, scroller.clientWidth - 12);
    var availH = Math.max(80, scroller.clientHeight - 12);
    var s = (fitMode === 'page') ? Math.min(availW / vp1.width, availH / vp1.height) : (availW / vp1.width);
    return s * userZoom;
  }
  function computeBaseScale() {
    return pdfDoc.getPage(1).then(function (page) {
      var vp1 = page.getViewport({ scale: 1, rotation: rotFor(page) });
      p1w = vp1.width; p1h = vp1.height;
    });
  }

  // ============ 다시 그리기(모드 분기) ============
  function rebuild() {
    if (!pdfDoc) return;
    if (viewMode === 'page') { if (pageNav) pageNav.style.display = 'flex'; renderPage(); }
    else { if (pageNav) pageNav.style.display = 'none'; buildSlots(); }
    updateBadge();
  }

  // ---- 연속 스크롤(지연 렌더) ----
  function buildSlots() {
    renderToken++;
    pagesEl.style.transform = 'none';
    renderedZoom = userZoom;
    pagesEl.innerHTML = '';
    if (io) io.disconnect();
    io = new IntersectionObserver(onIntersect, { root: scroller, rootMargin: '700px 0px' });
    var w = Math.floor(p1w * (scroller.clientWidth - 12) / p1w * (userZoom));  // 대략치(렌더 시 보정)
    // 초기 슬롯 크기 추정: 폭 맞춤 기준 page1
    var availW = Math.max(80, scroller.clientWidth - 12);
    var s0 = (fitMode === 'page' ? Math.min(availW / p1w, (scroller.clientHeight - 12) / p1h) : availW / p1w) * userZoom;
    var sw = Math.floor(p1w * s0), sh = Math.floor(p1h * s0);
    for (var i = 1; i <= pdfDoc.numPages; i++) {
      var slot = document.createElement('div');
      slot.className = 'doc-slot';
      slot.dataset.page = i; slot.dataset.rendered = '0';
      slot.style.width = sw + 'px'; slot.style.height = sh + 'px';
      pagesEl.appendChild(slot);
      io.observe(slot);
    }
  }
  function onIntersect(entries) {
    entries.forEach(function (en) { if (en.isIntersecting) renderSlot(en.target); else clearSlot(en.target); });
  }
  function renderSlot(slot) {
    if (slot.dataset.rendered === '1' || slot.dataset.rendering === '1') return;
    var num = +slot.dataset.page, token = renderToken;
    slot.dataset.rendering = '1';
    pdfDoc.getPage(num).then(function (page) {
      if (token !== renderToken) { slot.dataset.rendering = '0'; return; }
      var vp = page.getViewport({ scale: scaleFor(page), rotation: rotFor(page) });
      slot.style.width = Math.floor(vp.width) + 'px'; slot.style.height = Math.floor(vp.height) + 'px';
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * DPR); canvas.height = Math.floor(vp.height * DPR);
      var ctx = canvas.getContext('2d');
      slot.innerHTML = ''; slot.appendChild(canvas);
      return page.render({ canvasContext: ctx, viewport: vp, transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null }).promise.then(function () {
        if (token !== renderToken) { slot.innerHTML = ''; slot.dataset.rendered = '0'; }
        else slot.dataset.rendered = '1';
        slot.dataset.rendering = '0';
      });
    }).catch(function () { slot.dataset.rendering = '0'; });
  }
  function clearSlot(slot) { if (slot.dataset.rendered === '1') { slot.innerHTML = ''; slot.dataset.rendered = '0'; } }

  // ---- 한 장씩(single-page) ----
  function renderPage(anim) {
    if (!pdfDoc) return;
    var token = ++renderToken;
    curPage = Math.max(1, Math.min(pdfDoc.numPages, curPage));
    pdfDoc.getPage(curPage).then(function (page) {
      if (token !== renderToken) return;
      var vp = page.getViewport({ scale: scaleFor(page), rotation: rotFor(page) });
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * DPR); canvas.height = Math.floor(vp.height * DPR);
      canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: vp, transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null }).promise.then(function () {
        if (token !== renderToken) return;
        var wrap = document.createElement('div');
        wrap.className = 'doc-slot' + (anim && flip ? (' flip-' + anim) : '');
        wrap.appendChild(canvas);
        pagesEl.innerHTML = ''; pagesEl.appendChild(wrap);
        scroller.scrollTop = 0;
        updateBadge();
      });
    }).catch(function () {});
  }
  function goPage(delta) {
    if (!pdfDoc || viewMode !== 'page') return;
    var np = curPage + delta;
    if (np < 1 || np > pdfDoc.numPages) return;
    curPage = np;
    renderPage(delta > 0 ? 'next' : 'prev');
  }

  // ============ 배지·이동 ============
  function updateBadge() {
    if (!pdfDoc) { if (badgeEl) badgeEl.textContent = '– / –'; return; }
    var n = pdfDoc.numPages, cur;
    if (viewMode === 'page') cur = curPage;
    else {
      var kids = pagesEl.children, mid = scroller.scrollTop + scroller.clientHeight / 2, acc = 0; cur = 1;
      for (var i = 0; i < kids.length; i++) { acc += kids[i].offsetHeight + 12; cur = i + 1; if (mid <= acc) break; }
    }
    if (badgeEl) badgeEl.textContent = cur + ' / ' + n;
    if (jumpBtn) jumpBtn.textContent = cur + ' / ' + n;
  }
  function jumpTo() {
    if (!pdfDoc) return;
    var ans = null;
    try { ans = global.prompt('몇 쪽으로 갈까요? (1 ~ ' + pdfDoc.numPages + ')', String(viewMode === 'page' ? curPage : 1)); } catch (e) { ans = null; }
    if (ans == null) return;
    var n = parseInt(String(ans).replace(/[^0-9]/g, ''), 10);
    if (!n || n < 1 || n > pdfDoc.numPages) { toast('1부터 ' + pdfDoc.numPages + ' 사이 숫자를 넣어 주세요.'); return; }
    if (viewMode === 'page') { curPage = n; renderPage(); }
    else {
      var kids = pagesEl.children;
      if (kids[n - 1]) scroller.scrollTop = kids[n - 1].offsetTop - 6;
      updateBadge();
    }
  }

  // ============ 줌 ============
  function applyZoom() { if (!pdfDoc) return; if (viewMode === 'page') renderPage(); else buildSlots(); updateBadge(); }
  function stepZoom(f) { userZoom = Math.max(0.4, Math.min(6, userZoom * f)); applyZoom(); }
  function livePreview() { pagesEl.style.transform = 'scale(' + (userZoom / renderedZoom) + ')'; }

  // ============ 보기 옵션 ============
  function toggleFit() {
    fitMode = (fitMode === 'width') ? 'page' : 'width';
    userZoom = 1;
    var b = $('docFitToggle'); if (b) b.textContent = (fitMode === 'width') ? '폭' : '쪽';
    computeBaseScale().then(applyZoom);
  }
  function toggleMode() {
    viewMode = (viewMode === 'scroll') ? 'page' : 'scroll';
    var lb = $('docModeLabel'); if (lb) lb.textContent = (viewMode === 'page') ? '한 장씩' : '연속';
    var ic = $('docModeToggle'); if (ic) { var u = ic.querySelector('use'); if (u) u.setAttribute('href', viewMode === 'page' ? '#i-onepage' : '#i-scroll'); }
    setOptActive('docModeToggle', viewMode === 'page');
    userZoom = 1;
    rebuild();
  }
  function toggleFlip() { flip = !flip; setOptActive('docFlipToggle', flip); toast(flip ? '책 넘김 모션 켬' : '책 넘김 모션 끔'); }
  function rotate90() { rotation = (rotation + 90) % 360; computeBaseScale().then(applyZoom); }
  function applyNight() { if (pagesEl) pagesEl.classList.toggle('doc-night', night); }
  function toggleNight() { night = !night; applyNight(); setOptActive('docNight', night); }
  function setOptActive(id, on) { var b = $(id); if (b) b.classList.toggle('on', !!on); }

  // ============ 전체화면 ============
  function setFullscreen(on) {
    fullscreen = !!on;
    document.body.classList.toggle('doc-fs', fullscreen);
    var b = $('docFull'); if (b) { var u = b.querySelector('use'); if (u) u.setAttribute('href', fullscreen ? '#i-shrink' : '#i-expand'); b.title = fullscreen ? '전체화면 끄기' : '전체화면'; }
    // 레이아웃이 바뀌므로 스케일 재계산
    if (pdfDoc) setTimeout(function () { computeBaseScale().then(applyZoom); }, 60);
  }
  function toggleFullscreen() { setFullscreen(!fullscreen); }

  // ============ 진입점 ============
  function handleLocalFile(file) {
    if (!file) return;
    opToken++;
    var name = file.name || '문서';
    if (!isViewable(name, file.type)) { setStatus('⚠️ 이 형식은 뷰어에서 열 수 없어요: ' + esc(extOf(name) || name), 'err'); showPick(); return; }
    if (extOf(name) === 'pdf' || /pdf/i.test(file.type)) {
      loadingStatus('문서를 여는 중…', 'PDF는 바로 표시돼요.');
      var fr = new FileReader();
      fr.onload = function () { loadPdfSrc({ data: new Uint8Array(fr.result) }, name, true); };
      fr.onerror = function () { setStatus('⚠️ 파일을 읽지 못했어요.', 'err'); showPick(); };
      fr.readAsArrayBuffer(file);
      return;
    }
    convertAndView({ file: file, name: name, ext: extOf(name) });
  }

  function viewChatAttachment(att) {
    if (!att || !att.url) { toast('열 수 있는 파일이 아니에요.'); return; }
    opToken++;
    var name = att.name || '문서', ext = extOf(name);
    if (ext === 'pdf' || /pdf/i.test(att.mime || '')) {
      loadingStatus('문서를 여는 중…', 'PDF는 바로 표시돼요.');
      var myOp = opToken;
      fetch(att.url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.arrayBuffer(); })
        .then(function (buf) { if (myOp === opToken) loadPdfSrc({ data: new Uint8Array(buf) }, name, true); })
        .catch(function (e) { if (myOp === opToken) { setStatus('⚠️ 문서를 여는 데 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); } });
      return;
    }
    convertAndView({ sourceUrl: att.url, name: name, ext: ext });
  }

  function convertAndView(src) {
    if (!global.OfficeBridge) { setStatus('⚠️ 연결 모듈을 찾지 못했어요.', 'err'); showPick(); return; }
    var myOp = opToken;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var memo = { id: id, token: tok, title: (src.name || '문서').slice(0, 40) };
    var kindKo = { hwp: '한글', hwpx: '한글', doc: '워드', docx: '워드', xls: '엑셀', xlsx: '엑셀', ppt: 'PPT', pptx: 'PPT' }[src.ext] || '문서';
    loadingStatus('PC에서 ' + kindKo + ' 문서를 변환하고 있어요…', '처음 한 번은 1~2분 걸릴 수 있어요. PC가 켜져 있어야 해요.');
    var started = src.file
      ? OfficeBridge.sendDoc(memo, src.file, function (phase, done, total) { if (myOp === opToken && total > 1) loadingStatus('올리는 중… ' + done + '/' + total, 'PC가 변환을 준비하고 있어요.'); })
      : OfficeBridge.convertDoc(memo, src.sourceUrl, src.name, src.ext);
    started.then(function () { if (myOp === opToken) pollConvert(id, tok, src.name, myOp); })
      .catch(function (e) { if (myOp === opToken) { setStatus('⚠️ 변환 요청이 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); } });
  }
  function pollConvert(id, tok, name, myOp) {
    var start = Date.now(), MAX_MS = 4 * 60 * 1000;
    (function loop() {
      if (myOp !== opToken) return;
      OfficeBridge.poll(id, tok).then(function (res) {
        if (myOp !== opToken) return;
        if (res && res.status === 'done') {
          var d = OfficeBridge.docResultFrom(res);
          if (d && d.pdf_url) {
            loadingStatus('문서를 여는 중…');
            fetch(d.pdf_url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.arrayBuffer(); })
              .then(function (buf) { if (myOp === opToken) loadPdfSrc({ data: new Uint8Array(buf) }, d.name || name, true); })
              .catch(function (e) { if (myOp === opToken) { setStatus('⚠️ 변환은 됐지만 여는 데 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); } });
          } else {
            var msg = (d && d.error) ? d.error : (res.error || '이 문서는 변환하지 못했어요.');
            setStatus('⚠️ ' + esc(msg) + '<br><small>암호가 걸렸거나 형식이 특수한 문서일 수 있어요.</small>', 'err'); showPick();
          }
          return;
        }
        if (Date.now() - start > MAX_MS) { setStatus('⚠️ 변환이 오래 걸려요. PC가 켜져 있는지 확인하고 다시 시도해 주세요.', 'err'); showPick(); return; }
        setTimeout(loop, 2500);
      }).catch(function () { setTimeout(loop, 3500); });
    })();
  }

  // ============ 최근 본 문서(세션 기억) ============
  function addRecent(name, buf) {
    try {
      var copy = buf.slice(0);                       // 렌더용과 분리 보관
      recents.unshift({ name: name || '문서', buf: copy });
      if (recents.length > 8) recents.pop();
    } catch (e) {}
  }
  function renderRecents() {
    var sec = $('docRecent'), list = $('docRecentList');
    if (!sec || !list) return;
    if (!recents.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block'; list.innerHTML = '';
    recents.forEach(function (r, i) {
      var b = document.createElement('button'); b.className = 'doc-recent-item'; b.type = 'button';
      b.innerHTML = '<svg><use href="#i-doc"/></svg><span>' + esc(r.name) + '</span>';
      b.addEventListener('click', function () {
        opToken++; loadingStatus('문서를 여는 중…');
        loadPdfSrc({ data: new Uint8Array(r.buf.slice(0)) }, r.name, false);
      });
      list.appendChild(b);
    });
  }

  // 화면을 떠날 때 정리 + 뷰 옵션 초기화(다음 열람에 영향 없게)
  function leave() {
    opToken++; setFullscreen(false);
    viewMode = 'scroll'; fitMode = 'width'; rotation = 0; night = false; userZoom = 1;
  }

  // ============ 초기화 ============
  function init(opts) {
    opts = opts || {};
    if (opts.toast) toast = opts.toast;
    pickEl = $('docPick'); viewerEl = $('docViewer'); statusEl = $('docStatus');
    fnameEl = $('docFname'); badgeEl = $('docPageBadge');
    scroller = $('docScroller'); pagesEl = $('docPages'); fileInput = $('docFileInput');
    pageNav = $('docPageNav'); jumpBtn = $('docJump');

    if ($('docPickBtn')) $('docPickBtn').addEventListener('click', function () { if (fileInput) fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) handleLocalFile(f); });
    if ($('docToList')) $('docToList').addEventListener('click', function () { leave(); setStatus(''); showPick(); });
    if ($('docZoomIn')) $('docZoomIn').addEventListener('click', function () { stepZoom(1.25); });
    if ($('docZoomOut')) $('docZoomOut').addEventListener('click', function () { stepZoom(0.8); });
    if ($('docFitToggle')) $('docFitToggle').addEventListener('click', toggleFit);
    if ($('docFull')) $('docFull').addEventListener('click', toggleFullscreen);
    if ($('docModeToggle')) $('docModeToggle').addEventListener('click', toggleMode);
    if ($('docFlipToggle')) { $('docFlipToggle').addEventListener('click', toggleFlip); setOptActive('docFlipToggle', flip); }
    if ($('docRotate')) $('docRotate').addEventListener('click', rotate90);
    if ($('docNight')) $('docNight').addEventListener('click', toggleNight);
    if (badgeEl) badgeEl.addEventListener('click', jumpTo);
    if (jumpBtn) jumpBtn.addEventListener('click', jumpTo);
    if ($('docPrev')) $('docPrev').addEventListener('click', function () { goPage(-1); });
    if ($('docNext')) $('docNext').addEventListener('click', function () { goPage(1); });

    // 핀치 확대/축소 + (한 장씩 모드) 좌우 스와이프 페이지 넘김
    var pinchStart = 0, pinchZoom0 = 1, pinching = false, sx = 0, sy = 0, swiping = false;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
    if (scroller) {
      scroller.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) { pinching = true; pinchStart = dist(e.touches); pinchZoom0 = userZoom; swiping = false; }
        else if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = (viewMode === 'page' && userZoom <= 1.02); }
      }, { passive: true });
      scroller.addEventListener('touchmove', function (e) {
        if (pinching && e.touches.length === 2) { e.preventDefault(); userZoom = Math.max(0.4, Math.min(6, pinchZoom0 * (dist(e.touches) / pinchStart))); livePreview(); }
      }, { passive: false });
      scroller.addEventListener('touchend', function (e) {
        if (pinching && e.touches.length < 2) { pinching = false; applyZoom(); return; }
        if (swiping && e.changedTouches && e.changedTouches.length) {
          var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { goPage(dx < 0 ? 1 : -1); }
        }
        swiping = false;
      });
      scroller.addEventListener('scroll', function () { if (viewMode === 'scroll') global.requestAnimationFrame(updateBadge); }, { passive: true });
    }
    var rT;
    global.addEventListener('resize', function () {
      if (!pdfDoc || !viewerEl || viewerEl.style.display === 'none') return;
      clearTimeout(rT); rT = setTimeout(function () { computeBaseScale().then(applyZoom); }, 250);
    });
  }

  global.SmartDocs = {
    init: init,
    pick: function () { if (fileInput) fileInput.click(); },
    showPick: function () { leave(); setStatus(''); showPick(); },
    handleLocalFile: handleLocalFile,
    viewChatAttachment: viewChatAttachment,
    isViewable: isViewable, extOf: extOf, leave: leave,
    isFullscreen: function () { return fullscreen; },
    exitFullscreen: function () { setFullscreen(false); }
  };
})(window);
