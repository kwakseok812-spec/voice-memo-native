/* ============================================================================
 * docviewer.js — 스마트비서 내장 문서 뷰어 (SmartDocs)
 * ----------------------------------------------------------------------------
 * 기존 앱 apps/doc-viewer 의 PDF.js 뷰어 엔진(지연 렌더·핀치 줌·폭 맞춤·페이지 배지)을
 * 스마트비서 화면(#docsView) 안에 그대로 이식한 것. 화면 전환(openScreen)은 app.js 가
 * 맡고, 이 모듈은 #docPick(문서 고르기) ↔ #docViewer(PDF 표시) 두 하위 패널만 오간다.
 *
 * 문서→PDF 변환은 스마트비서의 우편함 파이프라인(OfficeBridge)을 재사용한다:
 *   - 폰에서 고른 PDF        → 업로드 없이 그 자리에서 PDF.js 로 표시(가장 빠름).
 *   - 폰에서 고른 오피스/한글 → OfficeBridge.sendDoc → PC(doc_worker) 가 PDF 변환 → 표시.
 *   - 케이가 채팅으로 보낸 문서(첨부) → PDF 면 서명URL 을 바로 표시, 그 외는 convertDoc 로 변환.
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

  // ---- DOM (init 시 바인딩) ----
  var pickEl, viewerEl, statusEl, fnameEl, badgeEl, scroller, pagesEl, fileInput;

  // ---- 렌더 상태 ----
  var pdfDoc = null, baseScale = 1, userZoom = 1, renderedZoom = 1;
  var p1w = 612, p1h = 792, renderToken = 0, io = null;
  var DPR = Math.min(global.devicePixelRatio || 1, 2.5);
  var opToken = 0;                     // 변환/폴링 취소용(화면을 떠나면 증가)
  var VIEWABLE = ['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];

  function extOf(name) { return ((String(name || '').split('.').pop()) || '').toLowerCase(); }
  function isViewable(name, mime) {
    var e = extOf(name);
    if (VIEWABLE.indexOf(e) !== -1) return true;
    return /pdf|word|excel|spreadsheet|presentation|officedocument|hwp/i.test(mime || '');
  }

  // ============ 패널 전환 ============
  function showPick() {
    if (viewerEl) viewerEl.style.display = 'none';
    if (pickEl) pickEl.style.display = 'block';
  }
  function showViewer() {
    if (pickEl) pickEl.style.display = 'none';
    if (viewerEl) viewerEl.style.display = 'flex';
  }
  function setStatus(html, kind) {
    if (!statusEl) return;
    if (!html) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; return; }
    statusEl.className = 'doc-status ' + (kind || '');
    statusEl.innerHTML = html;
    statusEl.style.display = 'block';
  }
  function loadingStatus(msg, sub) {
    setStatus('<span class="spinner"></span><span class="ds-tx">' + esc(msg) +
      (sub ? '<br><small>' + esc(sub) + '</small>' : '') + '</span>', 'load');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ============ PDF.js 렌더링(지연 렌더 = 보이는 페이지만) ============
  function loadPdfSrc(src, name) {
    if (!pdfReady) { setStatus('⚠️ PDF 표시기를 불러오지 못했어요. 앱을 다시 열어 주세요.', 'err'); showPick(); return; }
    var myOp = opToken;
    showViewer();
    if (fnameEl) fnameEl.textContent = name || '문서';
    global.pdfjsLib.getDocument(src).promise.then(function (doc) {
      if (myOp !== opToken) { try { doc.destroy(); } catch (e) {} return; }
      if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
      pdfDoc = doc; userZoom = 1; renderedZoom = 1;
      return computeBaseScale();
    }).then(function () {
      if (myOp !== opToken || !pdfDoc) return;
      buildSlots();
      setStatus('');
      scroller.scrollTop = 0;
      updateBadge();
    }).catch(function (err) {
      if (myOp !== opToken) return;
      setStatus('⚠️ 문서를 표시하지 못했어요.' + (err && err.message ? '<br><small>' + esc(err.message) + '</small>' : ''), 'err');
      showPick();
    });
  }
  function computeBaseScale() {
    return pdfDoc.getPage(1).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      p1w = vp1.width; p1h = vp1.height;
      var avail = scroller.clientWidth - 12;
      baseScale = avail / vp1.width;
    });
  }
  function buildSlots() {
    renderToken++;
    pagesEl.style.transform = 'none';
    renderedZoom = userZoom;
    pagesEl.innerHTML = '';
    if (io) io.disconnect();
    io = new IntersectionObserver(onIntersect, { root: scroller, rootMargin: '700px 0px' });
    var scale = baseScale * userZoom;
    var w = Math.floor(p1w * scale), h = Math.floor(p1h * scale);
    for (var i = 1; i <= pdfDoc.numPages; i++) {
      var slot = document.createElement('div');
      slot.className = 'doc-slot';
      slot.dataset.page = i; slot.dataset.rendered = '0';
      slot.style.width = w + 'px'; slot.style.height = h + 'px';
      pagesEl.appendChild(slot);
      io.observe(slot);
    }
  }
  function onIntersect(entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) renderSlot(en.target); else clearSlot(en.target);
    });
  }
  function renderSlot(slot) {
    if (slot.dataset.rendered === '1' || slot.dataset.rendering === '1') return;
    var num = +slot.dataset.page, token = renderToken;
    slot.dataset.rendering = '1';
    var scale = baseScale * userZoom;
    pdfDoc.getPage(num).then(function (page) {
      if (token !== renderToken) { slot.dataset.rendering = '0'; return; }
      var vp = page.getViewport({ scale: scale });
      slot.style.width = Math.floor(vp.width) + 'px';
      slot.style.height = Math.floor(vp.height) + 'px';
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * DPR);
      canvas.height = Math.floor(vp.height * DPR);
      var ctx = canvas.getContext('2d');
      slot.innerHTML = ''; slot.appendChild(canvas);
      return page.render({
        canvasContext: ctx, viewport: vp,
        transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null
      }).promise.then(function () {
        if (token !== renderToken) { slot.innerHTML = ''; slot.dataset.rendered = '0'; }
        else slot.dataset.rendered = '1';
        slot.dataset.rendering = '0';
      });
    }).catch(function () { slot.dataset.rendering = '0'; });
  }
  function clearSlot(slot) {
    if (slot.dataset.rendered === '1') { slot.innerHTML = ''; slot.dataset.rendered = '0'; }
  }
  function applyZoom() { if (!pdfDoc) return; buildSlots(); updateBadge(); }
  function stepZoom(f) { userZoom = Math.max(0.5, Math.min(5, userZoom * f)); applyZoom(); }
  function livePreview() { pagesEl.style.transform = 'scale(' + (userZoom / renderedZoom) + ')'; }
  function updateBadge() {
    if (!pdfDoc) { if (badgeEl) badgeEl.textContent = '– / –'; return; }
    var kids = pagesEl.children, mid = scroller.scrollTop + scroller.clientHeight / 2, cur = 1, acc = 0;
    for (var i = 0; i < kids.length; i++) {
      acc += kids[i].offsetHeight + 12;
      cur = i + 1;
      if (mid <= acc) break;
    }
    if (badgeEl) badgeEl.textContent = cur + ' / ' + pdfDoc.numPages;
  }

  // ============ 공개 진입점 ============
  // 폰에서 고른 문서 파일 처리(PDF는 그 자리서, 오피스/한글은 PC 변환).
  function handleLocalFile(file) {
    if (!file) return;
    opToken++;
    var name = file.name || '문서';
    if (!isViewable(name, file.type)) { setStatus('⚠️ 이 형식은 뷰어에서 열 수 없어요: ' + esc(extOf(name) || name), 'err'); showPick(); return; }
    if (extOf(name) === 'pdf' || /pdf/i.test(file.type)) {
      // PDF: 업로드 없이 바로 표시
      loadingStatus('문서를 여는 중…', 'PDF는 바로 표시돼요.');
      var fr = new FileReader();
      fr.onload = function () { loadPdfSrc({ data: new Uint8Array(fr.result) }, name); };
      fr.onerror = function () { setStatus('⚠️ 파일을 읽지 못했어요.', 'err'); showPick(); };
      fr.readAsArrayBuffer(file);
      return;
    }
    // 오피스/한글: PC 변환 파이프라인
    convertAndView({ file: file, name: name, ext: extOf(name) });
  }

  // 케이가 채팅으로 보낸 문서 첨부를 뷰어로. att={name,url,mime,size,kind}
  function viewChatAttachment(att) {
    if (!att || !att.url) { toast('열 수 있는 파일이 아니에요.'); return; }
    opToken++;
    var name = att.name || '문서', ext = extOf(name);
    if (ext === 'pdf' || /pdf/i.test(att.mime || '')) {
      loadingStatus('문서를 여는 중…', 'PDF는 바로 표시돼요.');
      var myOp = opToken;
      fetch(att.url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.arrayBuffer(); })
        .then(function (buf) { if (myOp === opToken) loadPdfSrc({ data: new Uint8Array(buf) }, name); })
        .catch(function (e) { if (myOp === opToken) { setStatus('⚠️ 문서를 여는 데 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); } });
      return;
    }
    // 오피스/한글: 업로드 없이 서명URL만 PC로 넘겨 변환
    convertAndView({ sourceUrl: att.url, name: name, ext: ext });
  }

  // 공통: PC 변환 요청 → 폴링 → 결과 PDF 표시. src={file}|{sourceUrl,name,ext}
  function convertAndView(src) {
    if (!global.OfficeBridge) { setStatus('⚠️ 연결 모듈을 찾지 못했어요.', 'err'); showPick(); return; }
    var myOp = opToken;
    var id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    var memo = { id: id, token: tok, title: (src.name || '문서').slice(0, 40) };
    var kindKo = { hwp: '한글', hwpx: '한글', doc: '워드', docx: '워드', xls: '엑셀', xlsx: '엑셀', ppt: 'PPT', pptx: 'PPT' }[src.ext] || '문서';
    loadingStatus('PC에서 ' + kindKo + ' 문서를 변환하고 있어요…', '처음 한 번은 1~2분 걸릴 수 있어요. PC가 켜져 있어야 해요.');
    var started = src.file
      ? OfficeBridge.sendDoc(memo, src.file, function (phase, done, total) {
          if (myOp === opToken && total > 1) loadingStatus('올리는 중… ' + done + '/' + total, 'PC가 변환을 준비하고 있어요.');
        })
      : OfficeBridge.convertDoc(memo, src.sourceUrl, src.name, src.ext);
    started.then(function () {
      if (myOp !== opToken) return;
      pollConvert(id, tok, src.name, myOp);
    }).catch(function (e) {
      if (myOp === opToken) { setStatus('⚠️ 변환 요청이 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); }
    });
  }

  function pollConvert(id, tok, name, myOp) {
    var start = Date.now(), MAX_MS = 4 * 60 * 1000;
    (function loop() {
      if (myOp !== opToken) return;                    // 화면을 떠남 → 중단
      OfficeBridge.poll(id, tok).then(function (res) {
        if (myOp !== opToken) return;
        if (res && res.status === 'done') {
          var d = OfficeBridge.docResultFrom(res);
          if (d && d.pdf_url) {
            loadingStatus('문서를 여는 중…');
            fetch(d.pdf_url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.arrayBuffer(); })
              .then(function (buf) { if (myOp === opToken) loadPdfSrc({ data: new Uint8Array(buf) }, d.name || name); })
              .catch(function (e) { if (myOp === opToken) { setStatus('⚠️ 변환은 됐지만 여는 데 실패했어요.<br><small>' + esc(e && e.message || e) + '</small>', 'err'); showPick(); } });
          } else {
            var msg = (d && d.error) ? d.error : (res.error || '이 문서는 변환하지 못했어요.');
            setStatus('⚠️ ' + esc(msg) + '<br><small>암호가 걸렸거나 형식이 특수한 문서일 수 있어요.</small>', 'err');
            showPick();
          }
          return;
        }
        if (Date.now() - start > MAX_MS) {
          setStatus('⚠️ 변환이 오래 걸려요. PC가 켜져 있는지 확인하고 다시 시도해 주세요.', 'err'); showPick(); return;
        }
        setTimeout(loop, 2500);
      }).catch(function () { setTimeout(loop, 3500); });
    })();
  }

  // 화면을 떠날 때(뒤로/목록) 호출 — 진행 중 폴링·렌더 정리
  function leave() { opToken++; }

  // ============ 초기화(이벤트 배선) ============
  function init(opts) {
    opts = opts || {};
    if (opts.toast) toast = opts.toast;
    pickEl = $('docPick'); viewerEl = $('docViewer'); statusEl = $('docStatus');
    fnameEl = $('docFname'); badgeEl = $('docPageBadge');
    scroller = $('docScroller'); pagesEl = $('docPages'); fileInput = $('docFileInput');

    if ($('docPickBtn')) $('docPickBtn').addEventListener('click', function () { if (fileInput) fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) handleLocalFile(f);
    });
    if ($('docToList')) $('docToList').addEventListener('click', function () { leave(); setStatus(''); showPick(); });
    if ($('docZoomIn')) $('docZoomIn').addEventListener('click', function () { stepZoom(1.25); });
    if ($('docZoomOut')) $('docZoomOut').addEventListener('click', function () { stepZoom(0.8); });
    if ($('docZoomFit')) $('docZoomFit').addEventListener('click', function () { userZoom = 1; applyZoom(); });

    // 핀치 확대/축소
    var pinchStart = 0, pinchZoom0 = 1, pinching = false;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
    if (scroller) {
      scroller.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) { pinching = true; pinchStart = dist(e.touches); pinchZoom0 = userZoom; }
      }, { passive: true });
      scroller.addEventListener('touchmove', function (e) {
        if (pinching && e.touches.length === 2) {
          e.preventDefault();
          userZoom = Math.max(0.5, Math.min(5, pinchZoom0 * (dist(e.touches) / pinchStart)));
          livePreview();
        }
      }, { passive: false });
      scroller.addEventListener('touchend', function (e) {
        if (pinching && e.touches.length < 2) { pinching = false; applyZoom(); }
      });
      scroller.addEventListener('scroll', function () { global.requestAnimationFrame(updateBadge); }, { passive: true });
    }
    var rT;
    global.addEventListener('resize', function () {
      if (!pdfDoc || !viewerEl || viewerEl.style.display === 'none') return;
      clearTimeout(rT);
      rT = setTimeout(function () { computeBaseScale().then(buildSlots).then(updateBadge); }, 250);
    });
  }

  global.SmartDocs = {
    init: init,
    pick: function () { if (fileInput) fileInput.click(); },
    showPick: function () { leave(); setStatus(''); showPick(); },
    handleLocalFile: handleLocalFile,
    viewChatAttachment: viewChatAttachment,
    isViewable: isViewable,
    extOf: extOf,
    leave: leave
  };
})(window);
