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
 *   · v8.0(O-0153) 여러 문서 탭(최대 5개, 탭마다 보던 쪽·확대·회전·시트 기억, [＋ 파일 더 열기])
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
  // v8.4(O-0162) 글자 크기 4단계: 엑셀 표의 「처음 크기」(시트 바꾸기·[맞춤])를 설정 배율에 맞춘다(15px × 0.9~1.3). 손가락 확대·축소는 그대로.
  function tableFontBase() { var k = 1; try { k = (window.SmartFont && SmartFont.scale) ? (SmartFont.scale() || 1) : 1; } catch (e) {} return Math.round(TABLE_FONT_DEFAULT * k); }
  var pdfDoc = null, baseScale = 1, userZoom = 1, renderedZoom = 1, userRotation = 0, curIsPpt = false;
  var pdfPaged = false, pageModeCur = 1;
  try { pdfPaged = localStorage.getItem('docviewer_paged') === '1'; } catch (e) {}
  var DPR = Math.min(global.devicePixelRatio || 1, 2.5);
  var opToken = 0;
  var EXCEL_EXTS = ['xls', 'xlsx', 'csv', 'ods'];
  var VIEWABLE = ['hwp', 'hwpx', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];

  // v6.9: 지금 열린 문서의 저장 키(최근 목록)·원래 파일 정보·이어볼 쪽
  var curKey = null, curSrcUrl = null, curFileInfo = null, resumePage = 0, excelKey = null, excelPdfBlob = null;
  var confirmFn = null;   // 앱의 확인 시트(openSheet) — confirm() 금지
  var idbWarned = false;  // 목록 저장 불가 안내는 한 번만

  // v8.0(O-0153) 여러 문서 탭
  //   · 탭마다 「변환 끝난 PDF(Blob) 또는 엑셀 원본」과 보던 자리(쪽·확대·회전·시트)만 들고 있다.
  //   · 화면에 그리는(=PDF 엔진·캔버스를 쥔) 문서는 언제나 하나뿐 — 탭을 바꾸면 앞 문서 엔진은 풀고 새로 연다.
  //     (폰 웹뷰 메모리 보호. 다시 열 때 변환·내려받기는 없다 — 들고 있는 PDF 를 바로 그린다)
  var MAX_TABS = 5;
  var tabs = [], activeIdx = -1, liveTabId = null, tabSeq = 0;
  var openIntent = null;           // 'new' = 새 문서를 탭으로 여는 중 · 'restore' = 탭 다시 그리는 중 · null
  var pendingRestore = null, pendingPdfBlob = null, loadSeq = 0, STALE = { stale: true };
  var tabsEl, tabListEl, tabAddBtn, sheetEl;
  // v8.1(O-0154) 케이에게 묻기·맡기기
  var askEl = null, askBtn = null, askHandler = null, askChip = null;
  var parked = false;              // 케이에게 묻느라 뷰어를 잠시 나옴 → 탭이 1개라도 「열어 둔 문서」로 남긴다
  // O-0171 PC에서 편집하기: 지금 문서의 「원본」을 어디서 다시 구할 수 있나(폰 파일 / 서버 주소 전체 / PC 경로)
  var curOrig = null, curSrcFull = null, curPcPath = null;

  function extOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase(); }
  function blobToBuf(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(fr.error); }; fr.readAsArrayBuffer(blob); });
  }
  function fmtSize(n) { return (global.OfficeBridge && OfficeBridge.fmtSize) ? OfficeBridge.fmtSize(n) : (Math.round((n || 0) / 1048576) + 'MB'); }

  /* ============ v6.9(O-0098) 최근 연 문서 — 폰(또는 PC 브라우저) 안 저장본 ============
   * 옛 독립 뷰어(doc-viewer-ho30)는 IndexedDB 'docviewer_docs' 에 본 문서를 보관해(30개·200MB, 즐겨찾기·이어보기)
   * 다시 열 때 변환 없이 바로 보였다. 스마트비서로 옮길 때 이 부분이 빠졌던 것을 되살린다.
   *   · DB 'smartdocs_recent' — 'meta'(목록용 가벼운 정보) + 'blob'(PDF·엑셀 원본) 두 칸으로 나눠
   *     목록을 그릴 때 큰 파일을 건드리지 않는다.
   *   · 같은 문서 판정 = 파일 내용 지문(SHA-256, 64MB 이하는 전체·그 이상은 앞·가운데·끝 4MB 표본+이름·수정일).
   *     「공유/열기」·채팅·공유함처럼 수정일이 매번 새로 붙는 경로에서도 같은 파일이면 같은 키가 된다.
   *     채팅·공유함 [뷰어로 보기]는 파일 주소(서명 토큰을 뗀 경로)로도 먼저 찾아 내려받기조차 건너뛴다.
   *   · 한도: 최대 40개, 용량 = min(1GB, 이 앱에 허용된 저장 공간의 절반). 넘치면 즐겨찾기가 아닌 것부터
   *     오래 안 연 순서로 자동 정리. 방금 연 문서는 지우지 않는다.
   *   · 기기마다 따로 저장(서버에 올리지 않음). */
  var DocStore = (function () {
    var DB = 'smartdocs_recent', VER = 1, META = 'meta', BLOB = 'blob';
    var MAX_COUNT = 40, CAP = 1024 * 1024 * 1024, FLOOR = 100 * 1024 * 1024;
    var FULL_HASH_MAX = 64 * 1024 * 1024, SAMPLE = 4 * 1024 * 1024;   // 전체 지문은 64MB까지(「공유/열기」 60MB 한도 포함) — 폰 메모리 보호
    var limit = CAP, dbP = null;
    function open() {
      if (dbP) return dbP;
      dbP = new Promise(function (res, rej) {
        if (!global.indexedDB) { rej(new Error('no indexedDB')); return; }
        var rq; try { rq = indexedDB.open(DB, VER); } catch (e) { rej(e); return; }
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(BLOB)) db.createObjectStore(BLOB, { keyPath: 'key' });
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { dbP = null; rej(rq.error); };
      });
      return dbP;
    }
    function rq2p(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
    function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error('abort')); }; }); }
    function sortList(a) {
      return (a || []).sort(function (x, y) {
        if (!!y.fav !== !!x.fav) return (y.fav ? 1 : 0) - (x.fav ? 1 : 0);
        return (y.openedAt || 0) - (x.openedAt || 0);
      });
    }
    function list() { return open().then(function (db) { return rq2p(db.transaction(META, 'readonly').objectStore(META).getAll()); }).then(sortList).catch(function () { return []; }); }
    function get(key) { if (!key) return Promise.resolve(null); return open().then(function (db) { return rq2p(db.transaction(META, 'readonly').objectStore(META).get(key)); }).then(function (r) { return r || null; }).catch(function () { return null; }); }
    function getBlobs(key) { return open().then(function (db) { return rq2p(db.transaction(BLOB, 'readonly').objectStore(BLOB).get(key)); }).then(function (r) { return r || null; }).catch(function () { return null; }); }
    function findBySrc(src) { if (!src) return Promise.resolve(null); return list().then(function (a) { for (var i = 0; i < a.length; i++) if (a[i].srcUrl === src) return a[i]; return null; }); }
    function touch(key, patch) {
      if (!key) return Promise.resolve();
      return open().then(function (db) {
        var tx = db.transaction(META, 'readwrite'), st = tx.objectStore(META), g = st.get(key);
        g.onsuccess = function () { var m = g.result; if (!m) return; for (var k in patch) if (patch.hasOwnProperty(k)) m[k] = patch[k]; st.put(m); };
        return txDone(tx);
      }).catch(function () {});
    }
    function del(key) {
      return open().then(function (db) {
        var tx = db.transaction([META, BLOB], 'readwrite'); tx.objectStore(META).delete(key); tx.objectStore(BLOB).delete(key); return txDone(tx);
      }).catch(function () {});
    }
    function clearAll() {
      return open().then(function (db) {
        var tx = db.transaction([META, BLOB], 'readwrite'); tx.objectStore(META).clear(); tx.objectStore(BLOB).clear(); return txDone(tx);
      }).catch(function () {});
    }
    function computeLimit() {
      try {
        if (global.navigator && navigator.storage && navigator.storage.estimate) {
          return navigator.storage.estimate().then(function (e) {
            var q = e && e.quota;
            limit = (q && q > 0) ? Math.max(FLOOR, Math.min(CAP, Math.floor(q * 0.5))) : CAP;
            return limit;
          }, function () { return limit; });
        }
      } catch (e) {}
      return Promise.resolve(limit);
    }
    // 넘치면 오래 안 연 것부터 정리(즐겨찾기·protect 제외). 반환: 지운 개수.
    function cleanup(protect, target) {
      return computeLimit().then(list).then(function (a) {
        var cap = target || limit, total = 0, count = a.length, n = 0;
        a.forEach(function (m) { total += (m.bytes || 0); });
        var rm = a.filter(function (m) { return !m.fav && m.key !== protect; })
                  .sort(function (x, y) { return (x.openedAt || 0) - (y.openedAt || 0); });
        var dels = [];
        while ((count > MAX_COUNT || total > cap) && rm.length) {
          var m = rm.shift(); dels.push(del(m.key)); total -= (m.bytes || 0); count--; n++;
        }
        return Promise.all(dels).then(function () { return n; });
      }).catch(function () { return 0; });
    }
    function writeOnce(meta, blobs) {
      return open().then(function (db) {
        var tx = db.transaction([META, BLOB], 'readwrite'), ms = tx.objectStore(META), bs = tx.objectStore(BLOB);
        var gm = ms.get(meta.key), gb = bs.get(meta.key), now = Date.now();
        gb.onsuccess = function () {
          var om = gm.result || {}, ob = gb.result || {};
          var nb = { key: meta.key, pdf: blobs.pdf || ob.pdf || null, orig: blobs.orig || ob.orig || null };
          var m = {}, k;
          for (k in om) if (om.hasOwnProperty(k)) m[k] = om[k];
          for (k in meta) if (meta.hasOwnProperty(k) && meta[k] != null) m[k] = meta[k];
          m.bytes = (nb.pdf ? nb.pdf.size : 0) + (nb.orig ? nb.orig.size : 0);
          m.savedAt = om.savedAt || now; m.openedAt = now;
          m.fav = !!om.fav; m.lastPage = om.lastPage || 0;
          bs.put(nb); ms.put(m);
        };
        return txDone(tx);
      });
    }
    // 저장(같은 키면 합침: 즐겨찾기·이어볼 쪽 유지). 반환: {saved, removed, skipped}
    function save(meta, blobs) {
      var bytes = (blobs.pdf ? blobs.pdf.size : 0) + (blobs.orig ? blobs.orig.size : 0);
      return open().then(computeLimit, function () { return null; }).then(function (lim) {
        if (lim === null) return { saved: false, removed: 0, skipped: 'unavailable' };   // IndexedDB 막힘(비공개 창·저장 차단 등)
        if (bytes > limit) return { saved: false, removed: 0, skipped: 'too_big' };   // 한 개가 한도보다 크면 보관하지 않음
        return writeOnce(meta, blobs).catch(function () {
          // 저장 공간 부족(QuotaExceeded 등) → 한도의 절반까지 비우고 한 번만 다시
          return cleanup(meta.key, Math.floor(limit / 2)).then(function () { return writeOnce(meta, blobs); });
        }).then(function () {
          return cleanup(meta.key).then(function (n) { return { saved: true, removed: n }; });
        }, function () { return { saved: false, removed: 0, skipped: 'quota' }; });
      });
    }
    function hex(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2); return s; }
    function keyOf(file) {
      var size = (file && file.size) || 0, name = (file && file.name) || '', lm = (file && file.lastModified) || 0;
      var fallback = 'n:' + size + ':' + name + ':' + lm;
      var subtle = global.crypto && global.crypto.subtle;
      if (!subtle || !file) return Promise.resolve(fallback);
      var full = size <= FULL_HASH_MAX, src;
      if (full) src = file;
      else { var mid = Math.floor(size / 2); src = new Blob([file.slice(0, SAMPLE), file.slice(mid - SAMPLE / 2, mid + SAMPLE / 2), file.slice(size - SAMPLE)]); }
      return blobToBuf(src).then(function (buf) { return subtle.digest('SHA-256', buf); }).then(function (h) {
        return full ? ('h:' + size + ':' + hex(h)) : ('s:' + size + ':' + hex(h) + ':' + name + ':' + lm);
      }).catch(function () { return fallback; });
    }
    function usage() { return list().then(function (a) { var t = 0; a.forEach(function (m) { t += (m.bytes || 0); }); return { count: a.length, bytes: t, limit: limit }; }); }
    function persist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {} }
    return { list: list, get: get, getBlobs: getBlobs, findBySrc: findBySrc, touch: touch, del: del, clearAll: clearAll,
             save: save, cleanup: cleanup, keyOf: keyOf, usage: usage, computeLimit: computeLimit, persist: persist,
             limit: function () { return limit; }, MAX_COUNT: MAX_COUNT };
  })();
  function srcBase(url) { return String(url || '').split('#')[0].split('?')[0]; }
  function isExcelExt(ext) { return EXCEL_EXTS.indexOf(ext) >= 0; }
  function isPptName(name) { var e = extOf(name); return e === 'ppt' || e === 'pptx'; }
  function isPptMime(t) { t = String(t || '').toLowerCase(); return t.indexOf('presentationml') >= 0 || t.indexOf('powerpoint') >= 0; }
  function isViewable(name, mime) { if (VIEWABLE.indexOf(extOf(name)) !== -1) return true; return /pdf|word|excel|spreadsheet|presentation|officedocument|hwp/i.test(mime || ''); }

  // ============ 화면 전환 ============
  function showViewer() { if (rootEl) rootEl.classList.add('on'); }
  // 뷰어를 닫고 문서 고르기 화면으로. v8.0: 탭이 2개 이상이면 탭(문서 목록)은 남겨 두고 엔진만 푼다
  //   → 고르기 화면 「열어 둔 문서 · 이어서 보기」로 돌아온다. 1개면 예전과 똑같이 닫힌다.
  function leaveViewer() {
    opToken++;      // 진행 중이던 변환·다운로드 콜백을 무효화(취소) — 나가면 뒤에서 계속 돌지 않게
    cancelUpload(); // v6.9: 올리던 조각 전송도 멈춘다(이미 올라간 조각은 장부에 남아 다음에 이어 올림)
    releaseWake();
    hideOverlay();  // 변환 스피너 오버레이가 남아 화면을 가리는(갇히는) 것을 막는다
    closeSlideshow();
    closeSheet();
    if (lastPageT) { clearTimeout(lastPageT); lastPageT = null; }
    snapshotActive(true);                       // 나가기 직전 본 쪽을 바로 저장(최근 목록 「○쪽까지 보셨어요」)
    curKey = null; openIntent = null; pendingRestore = null;
    closeAsk(); closeEdit();
    if (tabs.length >= 2 || (parked && tabs.length)) { clearDocView(); liveTabId = null; }   // v8.1: 케이에게 묻고 나가면 1개라도 남긴다
    else { tabs = []; activeIdx = -1; liveTabId = null; parked = false; }
    if (rootEl) rootEl.classList.remove('on');
    renderTabs(); renderOpenCard();
    renderRecent();
  }

  // ============ 오버레이 ============
  // v6.9: 진행 패널 — ① 올리기 ② PC 변환 ③ 열기 단계 표시 + 큰 글씨 상태 + 진행률 숫자 + 안내 한 줄.
  //   setLoading({step, msg, sub, pct, pctText, hint}) 로 패널을 다시 그리지 않고 글자만 바꾼다(취소 버튼 유지).
  function showLoading(msg, sub) {
    panel.innerHTML = '<div class="spinner"></div>' +
      '<div class="dv-steps" id="dvSteps" style="display:none"><span data-s="1">① 올리기</span><span data-s="2">② PC 변환</span><span data-s="3">③ 열기</span></div>' +
      '<div class="msg" id="dvMsg">' + esc(msg) + '</div>' +
      '<div class="sub" id="dvSub"' + (sub ? '' : ' style="display:none"') + '>' + esc(sub || '') + '</div>' +
      '<div class="bar-wrap"><div class="bar-fill" id="dvBarFill"></div></div>' +
      '<div class="dv-pct" id="dvPct"></div>' +
      '<div class="dv-hint" id="dvHint" style="display:none"></div>' +
      '<button class="btn ghost" id="dvLoadCancel" style="margin-top:18px;">취소하고 나가기</button>';
    overlay.classList.add('on');
    // 변환이 오래 걸려도 기다리다 빠져나올 수 있게 — 취소하면 진행 중이던 변환을 멈추고 문서 고르기 화면으로
    var cx = $('dvLoadCancel');
    if (cx) {                                    // v8.0: 탭이 있으면 「취소」= 보던 문서로 돌아감
      if (openIntent === 'new' && tabs.length) cx.textContent = '취소';
      cx.onclick = function () { if (openIntent === 'new' && tabs.length) abortOpen(); else leaveViewer(); };
    }
  }
  function setLoading(o) {
    if (!o || !$('dvMsg')) return;                       // 오류 화면으로 바뀐 뒤면 무시
    var st = $('dvSteps');
    if (st && o.step) {
      st.style.display = 'flex';
      Array.prototype.forEach.call(st.children, function (el) {
        var s = +el.getAttribute('data-s');
        el.className = (s < o.step) ? 'done' : (s === o.step ? 'on' : '');
      });
    }
    if (o.msg != null) $('dvMsg').textContent = o.msg;
    function txt(id, v) { var el = $(id); if (!el || v === undefined) return; el.textContent = v || ''; el.style.display = v ? '' : 'none'; }
    txt('dvSub', o.sub); txt('dvPct', o.pctText); txt('dvHint', o.hint);
    if (o.pct != null) setProgress(o.pct);
  }
  function setProgress(pct) { var b = $('dvBarFill'); if (b) b.style.width = Math.max(2, Math.min(100, pct)) + '%'; }
  function showError(msg, sub, retryFn) {
    panel.innerHTML = '<div class="err-emoji">⚠️</div><div class="msg">' + esc(msg) + '</div>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') +
      (retryFn ? '<button class="btn" id="dvErrRetry" style="margin-top:20px;">🔄 다시 시도</button>' : '') +
      '<button class="' + (retryFn ? 'btn ghost' : 'btn') + '" id="dvErrClose" style="margin-top:' + (retryFn ? '10px' : '20px') + ';">확인</button>';
    overlay.classList.add('on');
    $('dvErrClose').onclick = function () {
      hideOverlay();
      if (openIntent === 'restore') { failRestore(); return; }     // v8.0: 탭을 다시 그리지 못함 → 그 탭만 닫기
      if (openIntent === 'new') { abortOpen(); return; }           // v8.0: 새 문서 실패 → 보던 탭으로(없으면 예전처럼 닫기)
      if (!pdfDoc && !isExcelDoc) leaveViewer(); else refreshFname();
    };
    if (retryFn) $('dvErrRetry').onclick = function () { hideOverlay(); try { retryFn(); } catch (e) {} };
  }
  function hideOverlay() { if (overlay) overlay.classList.remove('on'); }
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
  // v6.9: 먼저 「최근 연 문서」 저장본이 있는지 본다(있으면 변환 요청 없이 바로). opts.srcUrl = 채팅·공유함 파일 주소.
  function handleFile(file, opts) {
    if (!file) return;
    opts = opts || {};
    var ext = extOf(file.name), op = opToken;
    isExcelDoc = false; xlToggleBtn.style.display = 'none';
    curKey = null; curSrcUrl = opts.srcUrl || null; resumePage = 0;
    curFileInfo = { name: file.name || '문서', ext: ext, size: file.size || 0 };
    curOrig = file; curSrcFull = opts.srcFull || null; curPcPath = opts.pcPath || null;   // O-0171
    clearDocView();                                     // 앞 문서가 새 파일 이름 아래 남아 보이지 않게
    showViewer(); fnameLabel.textContent = file.name;
    showLoading('문서를 확인하는 중…', '전에 열어 본 문서면 변환 없이 바로 보여 드려요.'); setProgress(4);
    function proceed() {
      if (op !== opToken) return;
      if (isExcelExt(ext)) { openExcelFile(file); return; }
      convertAndShowPdf(file);
    }
    DocStore.keyOf(file).then(function (key) {
      if (op !== opToken) return null;
      if (openIntent === 'new') {                                   // v8.0: 이미 탭에 열린 문서면 그 탭으로
        var di = tabByKey(key);
        if (di >= 0) { openIntent = null; hideOverlay(); showTab(di); return null; }
        if (tabs.length >= MAX_TABS) { capToast(); abortOpen(); return null; }
      }
      curKey = key;
      return DocStore.get(key).then(function (meta) {
        if (op !== opToken) return;
        if (meta) {
          var patch = {};
          if (curSrcUrl && meta.srcUrl !== curSrcUrl) patch.srcUrl = curSrcUrl;
          if (file.name && meta.name !== file.name) { patch.name = file.name; meta.name = file.name; }   // 내용이 같은 파일 → 방금 고른 이름으로
          if (Object.keys(patch).length) DocStore.touch(key, patch);
          openStored(meta, op, file);
          return;
        }
        proceed();
      });
    }).catch(function () { proceed(); });
  }
  // v6.9: 새 문서를 열기 전에 앞 문서 화면을 비운다(예전엔 새 문서 변환이 실패하면 앞 문서가 새 이름 아래 그대로 보였다).
  function clearDocView() {
    renderToken++;
    if (io) { try { io.disconnect(); } catch (e) {} }
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
    if (pagesEl) { pagesEl.innerHTML = ''; pagesEl.style.transform = 'none'; }
    if (tableviewEl) tableviewEl.innerHTML = '';
    excelWorkbook = null; isExcelDoc = false;
    if (xlToggleBtn) xlToggleBtn.style.display = 'none';
    if (sheetBar) sheetBar.style.display = 'none';
    setViewMode('pdf'); updatePageBadge();
  }
  // 저장본 열기(변환·업로드 없음). 저장본이 사라졌으면 file 이 있을 때만 원래 길로.
  function openStored(meta, op, file) {
    if (pdfDoc || excelWorkbook) clearDocView();
    showViewer(); fnameLabel.textContent = meta.name;
    showLoading('저장해 둔 문서를 여는 중…', '전에 변환해 둔 문서라 바로 열려요.'); setProgress(40);
    DocStore.getBlobs(meta.key).then(function (b) {
      if (op !== opToken) return;
      if (!b || !(b.pdf || b.orig)) {
        DocStore.del(meta.key); renderRecent();
        if (file) { curKey = meta.key; if (isExcelExt(extOf(file.name))) openExcelFile(file); else convertAndShowPdf(file); }
        else showError('폰에 저장해 둔 문서가 없어졌어요.', '원래 파일을 다시 골라 주세요.');
        return;
      }
      curKey = meta.key; curSrcUrl = meta.srcUrl || curSrcUrl; resumePage = meta.lastPage || 0;
      if (file) curOrig = file;                                        // O-0171: 원본(있으면) — 편집하기에 쓴다
      if (!curSrcFull && isServerFileUrl(meta.srcUrl)) curSrcFull = meta.srcUrl;   // 공유함 공개 주소는 토큰이 없어 그대로 쓸 수 있다
      curFileInfo = { name: meta.name, ext: meta.ext || extOf(meta.name), size: meta.size || 0 };
      DocStore.touch(meta.key, { openedAt: Date.now() });
      if (meta.kind === 'excel' && b.orig) {
        var f = new File([b.orig], meta.name, { type: b.orig.type || 'application/octet-stream' });
        openExcelFile(f, { pdfBlob: b.pdf || null, stored: true });
        return;
      }
      if (!b.pdf) { showError('저장본을 열지 못했어요.', '원래 파일을 다시 골라 주세요.'); return; }
      setProgress(70);
      pendingPdfBlob = b.pdf;                                       // v8.0: 탭이 들고 있을 PDF(저장본 = 기기 저장소 사본)
      blobToBuf(b.pdf).then(function (buf) {
        if (op !== opToken) return;
        loadPdf({ data: new Uint8Array(buf) }, meta.name, meta.isPpt);
      }, function () { if (op === opToken) showError('저장본을 읽지 못했어요.', '원래 파일을 다시 골라 주세요.'); });
    });
  }
  // 지금 문서를 최근 목록에 저장(변환 결과 PDF 또는 엑셀 원본). 조용히 실패해도 보기에는 영향 없음.
  function saveCurrent(kind, blobs, isPpt) {
    if (!curKey || !curFileInfo) return;
    var key = curKey;
    DocStore.save({ key: key, name: curFileInfo.name, ext: curFileInfo.ext, kind: kind, isPpt: !!isPpt,
                    size: curFileInfo.size, srcUrl: curSrcUrl || null }, blobs).then(function (r) {
      if (r && r.removed > 0) toast('저장 공간을 위해 오래 안 연 문서 ' + r.removed + '개를 목록에서 정리했어요.');
      if (r && r.skipped === 'quota') toast('폰 저장 공간이 모자라 이 문서는 최근 목록에 넣지 못했어요.');
      if (r && r.skipped === 'unavailable' && !idbWarned) { idbWarned = true; toast('이 기기에서는 목록 저장을 쓸 수 없어요. 문서 보기는 그대로 돼요.'); }
      if (key === curKey && pdfDoc) DocStore.touch(key, { pages: pdfDoc.numPages });
    });
  }

  // ============ 엑셀 「표로 보기」(SheetJS, 서버 안 감) ============
  function openExcelFile(file, xo) {
    xo = xo || {};
    if (typeof XLSX === 'undefined') { convertAndShowPdf(file); return; }
    var intent = openIntent, rs = pendingRestore; pendingRestore = null;   // v8.0
    excelKey = curKey; excelPdfBlob = xo.pdfBlob || null;
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
        excelWorkbook = wb; buildSheetSelector(); renderSheet(rs ? (rs.sheet || 0) : 0);
        if (rs) { if (rs.font) { tableFontPx = rs.font; applyTableFont(); } scroller.scrollTop = rs.ttop || 0; scroller.scrollLeft = rs.tleft || 0; }
        hideOverlay(); updateXlToggle();
        if (!xo.stored) saveCurrent('excel', { orig: file });            // v6.9: 최근 목록(원본 그대로 → 다시 표로)
        if (intent === 'new') commitNewTab('excel');                     // v8.0: 새 탭으로 등록
        else if (intent === 'restore') markRestored();
        if (rs && rs.excelView === 'pdf' && excelPdfBlob) { pendingRestore = rs; toggleExcelView(); }
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
    sheetSel.value = String(idx); tableviewEl.innerHTML = ''; tableFontPx = tableFontBase(); applyTableFont();
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
      else if (excelPdfBlob) {                                           // v6.9: 저장해 둔 PDF 가 있으면 변환 없이
        var eb = excelPdfBlob;
        blobToBuf(eb).then(function (buf) { if (excelPdfBlob !== eb) return; excelPdfBuf = buf; excelView = 'pdf'; loadPdf({ data: new Uint8Array(excelPdfBuf.slice(0)) }, excelName, false); updateXlToggle(); },
                           function () { excelPdfBlob = null; openExcelAsPdf(); });
      }
      else openExcelAsPdf();
    } else { excelView = 'table'; setViewMode('table'); if (excelWorkbook) renderSheet(parseInt(sheetSel.value, 10) || 0); updateXlToggle(); }
  }
  function openExcelAsPdf() {
    if (!excelFile) return;
    showLoading('PDF로 변환 중…', 'PC 문서를 폰용으로 변환하고 있어요.'); setProgress(6);
    var k = excelKey;
    convertViaOffice(excelFile, excelName, function (buf) {
      excelPdfBuf = buf; excelView = 'pdf';
      if (k) { try { excelPdfBlob = new Blob([buf], { type: 'application/pdf' }); curKey = k; saveCurrent('excel', { pdf: excelPdfBlob }); } catch (e) {} }
      loadPdf({ data: new Uint8Array(excelPdfBuf.slice(0)) }, excelName, false); updateXlToggle();
    }, function (msg, resumable) { showError(resumable ? '아직 PDF로 열지 못했어요.' : 'PDF로 변환하지 못했습니다.', msg, openExcelAsPdf); }, k);
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
      function (msg, resumable) { showError(resumable ? '아직 문서를 열지 못했어요.' : '이 문서를 열지 못했습니다.', msg, function () { convertAndShowPdf(file); }); },
      curKey);
  }

  /* ============ v6.9(O-0097) 변환 요청 — 끊겨도 이어서, 기다림은 PC가 변환을 시작한 뒤부터 ============
   * 요청 장부(localStorage 'docviewer_jobs_v1'): 파일 키 → {id, tok, parts(서버가 받았다고 답한 조각), rowSent, ...}
   *   [다시 시도]·같은 파일 다시 열기 때 먼저 장부의 지난 요청을 서버에 물어본다.
   *     · 이미 변환 끝(pdf_url) → 다시 올리지 않고 그 결과를 바로 연다.
   *     · PC가 아직 처리 중·차례 대기 → 다시 올리지 않고 이어서 기다린다.
   *     · 행이 없음(올리다 끊김) → 이미 올라간 조각은 건너뛰고 나머지만 올린다(같은 요청 번호).
   *     · 지난번이 실패로 끝남 → 새 요청으로 처음부터.
   * 기다림 단계(서버 행의 status·progress 는 PC 워커 doc_worker.py 가 쓴다 — 읽기만 확인):
   *     pending                     → PC 차례 기다림(앞 문서 처리 중일 수 있음) — 최대 15분
   *     processing & 조각 받는 중    → progress_msg 「받는 중 k/n」 — 진행이 있으면 대기 시계를 다시 셈
   *     processing & 다 받음(또는 단일) → 여기서부터 변환 시계: 작은 문서 5분, 큰 문서(20MB↑) 10분
   *     done                        → summary_json.doc.pdf_url(쪽수 pages) 또는 error
   *   ⚠️ 워커는 변환 중 쪽수 진행을 쓰지 않는다(쪽수는 끝나야 앎). 변환 중 progress_msg 를 따로 쓰면 그 글을 그대로 보여 준다. */
  var JOB_STORE = 'docviewer_jobs_v1', JOB_KEEP_MS = 6 * 24 * 3600 * 1000;   // 결과 주소(서명 7일)보다 짧게
  var BIG_DOC = 20 * 1024 * 1024;
  var QUEUE_MAX = 15 * 60 * 1000, CONV_MAX_SMALL = 5 * 60 * 1000, CONV_MAX_BIG = 10 * 60 * 1000;
  function jobsLoad() { try { return JSON.parse(localStorage.getItem(JOB_STORE) || '{}') || {}; } catch (e) { return {}; } }
  function jobsSave(m) {
    try {
      var now = Date.now(), keys = Object.keys(m).filter(function (k) { return m[k] && now - (m[k].ts || 0) < JOB_KEEP_MS; });
      keys.sort(function (a, b) { return (m[b].ts || 0) - (m[a].ts || 0); });
      var out = {}; keys.slice(0, 20).forEach(function (k) { out[k] = m[k]; });
      localStorage.setItem(JOB_STORE, JSON.stringify(out));
    } catch (e) {}
  }
  function jobGet(k) { var j = jobsLoad()[k]; return (j && Date.now() - (j.ts || 0) < JOB_KEEP_MS) ? j : null; }
  function jobPut(k, j) { var m = jobsLoad(); m[k] = j; jobsSave(m); }
  function jobDel(k) { var m = jobsLoad(); delete m[k]; jobsSave(m); }
  function fmtDur(ms) { var s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); s = s % 60; return m ? (m + '분 ' + (s < 10 ? '0' : '') + s + '초') : (s + '초'); }

  // 화면 켜 두기(지원하는 기기만 — 안드로이드 크롬/웹뷰·PC 크롬). 올리고 기다리는 동안 화면이 꺼져 끊기는 것을 줄인다.
  var wakeLock = null, wakeWanted = false, curCtl = null;
  function acquireWake() {
    wakeWanted = true;
    try {
      if (navigator.wakeLock && !wakeLock && !document.hidden) {
        navigator.wakeLock.request('screen').then(function (l) {
          if (!wakeWanted) { try { l.release(); } catch (e) {} return; }
          wakeLock = l; try { l.addEventListener('release', function () { wakeLock = null; }); } catch (e) {}
        }).catch(function () {});
      }
    } catch (e) {}
  }
  function releaseWake() { wakeWanted = false; try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  function cancelUpload() { if (curCtl) { curCtl.cancelled = true; try { if (curCtl.xhr) curCtl.xhr.abort(); } catch (e) {} curCtl = null; } }
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden && wakeWanted) acquireWake(); }); } catch (e) {}

  // PDF 결과 내려받기(진행률). onPct(0~1)
  function downloadPdf(url, onPct) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true); xhr.responseType = 'arraybuffer';
      xhr.onprogress = function (e) { if (e.lengthComputable && onPct) onPct(e.loaded / e.total); };
      xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response); else reject(new Error('내려받기 실패(' + xhr.status + ')')); };
      xhr.onerror = function () { reject(new Error('인터넷 연결이 끊겨 변환된 문서를 받지 못했어요.')); };
      xhr.send();
    });
  }

  // onErr(글, 이어하기가능) — 이어하기 가능이면 [다시 시도] 때 처음부터 다시 올리지 않는다.
  function convertViaOffice(file, name, onDone, onErr, key) {
    if (!global.OfficeBridge) { onErr('연결 모듈을 찾지 못했어요.', false); return; }
    var op = ++opToken;
    var jk = key || ('f:' + (file.name || '') + '|' + (file.size || 0) + '|' + (file.lastModified || 0));
    var size = file.size || 0, big = size >= BIG_DOC;
    acquireWake();
    function alive() { return op === opToken; }
    // keep=true: 장부 유지([다시 시도] 때 이어서). suffix 를 주면 기본 안내 대신 그 글을 붙인다.
    function fail(msg, keep, suffix) {
      if (!alive()) return;
      releaseWake(); curCtl = null;
      if (!keep) jobDel(jk);
      onErr(msg + (suffix != null ? suffix : (keep ? ' [다시 시도]를 누르면 처음부터 다시 올리지 않고 이어서 해요.' : '')), !!keep);
    }
    var CONV_MAX = big ? CONV_MAX_BIG : CONV_MAX_SMALL;
    var STUCK_SUFFIX = ' [다시 시도]를 누르면 PC에 새로 요청해요(문서를 처음부터 다시 올려요).';
    // v6.9 검토 반영: PC 워커가 변환 중에 죽으면 서버 행이 processing 에 굳는다(워커는 pending 만 집음).
    //   그 요청을 계속 기다리면 영영 안 끝나므로, 한 번 시간 초과(convTimedOut)했거나 변환 시작 뒤 한도의 2배가
    //   지났으면 [다시 시도] 때 옛 요청을 버리고 새 요청으로 처음부터 올린다(PC 쪽 수정이 없어도 빠져나옴).
    function isStuck(job, now) {
      return !!job.convTimedOut || (!!job.convStartAt && now - job.convStartAt > 2 * CONV_MAX);
    }
    function startFresh() {
      var job = { id: OfficeBridge.uuid(), tok: OfficeBridge.token(), name: name || file.name || '문서', size: size,
                  parts: {}, total: 0, chunked: size > OfficeBridge.CHUNK_SIZE, rowSent: false, ts: Date.now() };
      jobPut(jk, job);
      upload(job);
    }
    function upload(job) {
      var ctl = curCtl = { cancelled: false };
      var baseHint = big ? '큰 문서예요. 다 올라갈 때까지 이 화면을 켜 둔 채 기다려 주세요.' : '';
      var resumed = Object.keys(job.parts || {}).length > 0;
      var label = resumed ? '남은 부분을 이어서 올리는 중… ' : '문서를 올리는 중… ';
      setLoading({ step: 1, msg: label, sub: job.name + ' · ' + fmtSize(size), pct: 3, pctText: '', hint: baseHint });
      var memo = { id: job.id, token: job.tok, title: (job.name || '문서').slice(0, 40) };
      OfficeBridge.sendDoc(memo, file, null, {
        done: job.parts, ctl: ctl,
        onBytes: function (sent, total) {
          if (!alive()) return;
          var p = total ? sent / total : 1;
          setLoading({ msg: label + Math.floor(p * 100) + '%', pct: 3 + p * 55, pctText: fmtSize(sent) + ' / ' + fmtSize(total) });
        },
        onPartOk: function (k, total) { job.parts[k] = true; job.total = total; jobPut(jk, job); if (alive()) setLoading({ hint: baseHint }); },
        onRetry: function (k, n) { if (alive()) setLoading({ hint: '전송이 끊겨 다시 올리는 중이에요(' + (n + 1) + '번째 시도)…' }); },
        onRowSent: function () { job.rowSent = true; jobPut(jk, job); }
      }).then(function (r) {
        if (!alive()) return;
        curCtl = null; job.chunked = r.chunked; job.total = r.total; job.rowSent = true; jobPut(jk, job);
        waitConvert(job);
      }, function (e) {
        if (!alive() || (e && e.reason === 'cancelled')) return;
        curCtl = null;
        var permanent = e && (e.reason === 'too_big' || e.reason === 'too_big_server' || e.reason === 'unreadable' || e.reason === 'bad_key');
        fail((e && (e.friendly || e.message)) || String(e), !permanent);
      });
    }
    function waitConvert(job) {
      var tWait = Date.now(), lastProg = -1, netFail = 0;
      setLoading({ step: 2, msg: 'PC에 전달했어요', sub: 'PC가 받아 변환을 시작하면 알려 드려요.', pct: 60, pctText: '', hint: '' });
      (function loop() {
        if (!alive()) return;
        OfficeBridge.poll(job.id, job.tok).then(function (res) {
          if (!alive()) return;
          netFail = 0;
          if (res && res.status === 'done') {
            var d = OfficeBridge.docResultFrom(res);
            if (d && d.pdf_url) { openResult(job, d, false); return; }
            fail((d && d.error) || '이 문서는 변환하지 못했어요. 암호가 걸렸거나 형식이 특수할 수 있어요.', false);
            return;
          }
          var st = res && res.status, prog = (res && res.progress) | 0, ptot = (res && res.progress_total) | 0;
          var pmsg = (res && res.progress_msg) || '';
          var converting = st === 'processing' && (!job.chunked || (ptot > 0 && prog >= ptot));
          var now = Date.now();
          if (converting) {
            if (!job.convStartAt) { job.convStartAt = now; jobPut(jk, job); }   // 변환 시작 시각(다시 열어도 이어서 셈)
            var el = now - job.convStartAt;
            var extra = (pmsg && !/^받는 중/.test(pmsg)) ? pmsg : '';          // PC가 변환 진행 글을 쓰면 그대로
            setLoading({ step: 2, msg: 'PC에서 변환 중… ' + fmtDur(el), sub: extra || (job.name + ' · ' + fmtSize(size)),
                         pct: 62 + 30 * Math.min(1, el / (big ? 240000 : 90000)), pctText: '',
                         hint: el > 60000 ? (big ? '큰 문서라 변환에 몇 분 걸려요. 최대 10분까지 기다려요.' : '조금 오래 걸리고 있어요. 최대 5분까지 기다려요.') : '' });
            if (el > CONV_MAX) {
              job.convTimedOut = true; jobPut(jk, job);
              fail('PC가 ' + (big ? '10' : '5') + '분 넘게 변환 중이에요. PC가 멈췄을 수 있어요.', true, STUCK_SUFFIX); return;
            }
          } else if (st === 'processing') {
            if (prog !== lastProg) { lastProg = prog; tWait = now; }
            setLoading({ step: 2, msg: 'PC가 문서를 받는 중… ' + prog + '/' + ptot, sub: '다 받으면 바로 변환을 시작해요.', pct: 60 + 2 * (ptot ? prog / ptot : 0), pctText: '', hint: '' });
            if (now - tWait > QUEUE_MAX) { job.convTimedOut = true; jobPut(jk, job); fail('PC가 문서를 받다가 멈췄어요.', true, STUCK_SUFFIX); return; }
          } else {
            var w = now - tWait;
            setLoading({ step: 2, msg: 'PC 차례를 기다리는 중… ' + fmtDur(w),
                         sub: w > 20000 ? 'PC가 앞 문서를 처리하고 있거나 잠시 꺼져 있을 수 있어요. 요청은 PC에 남아 있어요.' : 'PC가 곧 받아 갈 거예요.',
                         pct: 60, pctText: '', hint: '' });
            if (w > QUEUE_MAX) { fail('PC가 15분 동안 이 문서를 받아 가지 않았어요. PC가 켜져 있는지 확인해 주세요.', true); return; }
          }
          setTimeout(loop, 2500);
        }, function () {
          if (!alive()) return;
          if (!netFail) netFail = Date.now();
          var nf = Date.now() - netFail;
          if (nf > 20000) setLoading({ hint: '인터넷 연결을 확인하는 중이에요… (' + fmtDur(nf) + ')' });
          if (nf > QUEUE_MAX) { fail('인터넷 연결이 오래 끊겨 있어요.', true); return; }
          setTimeout(loop, 3500);
        });
      })();
    }
    function openResult(job, d, reused) {
      setLoading({ step: 3, msg: reused ? '이미 변환된 문서를 받는 중…' : ('변환 완료' + (d.pages ? '(' + d.pages + '쪽)' : '') + ' · 폰으로 받는 중…'),
                   sub: reused ? '지난번에 PC가 변환해 둔 결과라 다시 올리지 않아요.' : '', pct: 92, pctText: '', hint: '' });
      job.doneAt = Date.now(); jobPut(jk, job);
      downloadPdf(d.pdf_url, function (p) { if (alive()) setLoading({ pct: 92 + 8 * p, pctText: Math.floor(p * 100) + '%' }); })
        .then(function (buf) { if (!alive()) return; releaseWake(); onDone(buf); }, function (e) {
          if (!alive()) return;
          if (reused) { jobDel(jk); startFresh(); return; }   // 지난 결과 주소가 만료 → 새로
          fail((e && e.message) || '변환된 문서를 받지 못했어요.', true);
        });
    }
    // 시작: 장부에 지난 요청이 있으면 먼저 서버에 물어본다.
    var prev = jobGet(jk);
    if (!prev) { startFresh(); return; }
    setLoading({ step: 2, msg: '지난번 요청을 확인하는 중…', sub: '이미 PC에 보낸 문서인지 확인하고 있어요.', pct: 8, pctText: '', hint: '' });
    OfficeBridge.poll(prev.id, prev.tok).then(function (res) {
      if (!alive()) return;
      prev.parts = prev.parts || {};
      if (!res) {                                             // 행이 없음 = 올리다 끊긴 요청
        if (prev.rowSent) { jobDel(jk); startFresh(); return; }
        upload(prev); return;                                 // 올라간 조각은 건너뛰고 이어서
      }
      if (res.status === 'done') {
        var d = OfficeBridge.docResultFrom(res);
        if (d && d.pdf_url) { openResult(prev, d, true); return; }   // 이미 변환됨 → 다시 올리지 않음
        jobDel(jk); startFresh(); return;                    // 지난번은 실패로 끝남 → 처음부터
      }
      if (res.status === 'processing' && isStuck(prev, Date.now())) { jobDel(jk); startFresh(); return; }   // 굳은 요청 → 새로
      waitConvert(prev);                                      // PC가 아직 처리 중 → 이어서 기다림
    }, function () {
      fail('인터넷 연결을 확인할 수 없어요. 연결을 확인해 주세요.', true);
    });
  }

  // v6.9: 변환 결과·PDF 는 PDF.js 에 넘기기 '전에' 최근 목록용 사본(Blob)을 만든다(PDF.js 가 버퍼를 가져가 비울 수 있음).
  function openPdfArrayBuffer(buf, name, isPpt) {
    try { var pb = new Blob([buf], { type: 'application/pdf' }); pendingPdfBlob = pb; saveCurrent('pdf', { pdf: pb }, isPpt); } catch (e) {}
    loadPdf({ data: new Uint8Array(buf) }, name, isPpt);
  }

  // ============ 렌더링(지연 렌더) ============
  var p1w = 612, p1h = 792, renderToken = 0, io = null;
  function loadPdf(src, name, isPpt) {
    var seq = ++loadSeq, intent = openIntent, rs = pendingRestore; pendingRestore = null;   // v8.0: 탭 등록·자리 되살리기
    setViewMode('pdf'); fnameLabel.textContent = name || '문서';
    global.pdfjsLib.getDocument(src).promise.then(function (doc) {
      if (seq !== loadSeq) { try { doc.destroy(); } catch (e) {} throw STALE; }   // 그 사이 다른 탭을 눌렀음
      if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} }
      pdfDoc = doc; userZoom = (rs && rs.zoom) || 1; renderedZoom = userZoom; userRotation = (rs && rs.rot) || 0; return computeBaseScale();
    }).then(function () {
      if (seq !== loadSeq) throw STALE;
      curIsPpt = (isPpt === undefined) ? isPptName(name) : !!isPpt; pageModeCur = 1;
      if (intent === 'new' && !isExcelDoc) commitNewTab('pdf');      // v8.0: 새 문서 → 탭으로 등록
      else if (intent === 'restore') markRestored();
      var want = rs ? Math.min(rs.page || 1, pdfDoc.numPages) : Math.min(resumePage || 0, pdfDoc.numPages); resumePage = 0;
      if (want > 1 && pdfPaged) pageModeCur = want;
      renderPdfLayout(); hideOverlay(); scroller.scrollTop = 0; scroller.scrollLeft = 0;
      if (rs && !pdfPaged && rs.pos) {                     // v8.0: 탭으로 돌아오면 보던 자리 그대로
        requestAnimationFrame(function () { if (seq !== loadSeq) return; listSetPos(pagesEl, scroller, rs.pos); if (rs.left) scroller.scrollLeft = rs.left; updatePageBadge(); });
      } else if (want > 1) {                               // v6.9: 지난번 본 쪽부터(옛 독립 뷰어의 이어보기)
        if (!pdfPaged) requestAnimationFrame(function () { goToPage(want, true); updatePageBadge(); });
        if (!rs) toast('📖 ' + want + '쪽부터 이어서 보여 드려요');
      }
      if (curKey) DocStore.touch(curKey, { pages: pdfDoc.numPages });
      var lt = activeTab(); if (lt && liveTabId === lt.id) lt.pages = pdfDoc.numPages;   // v8.1: 케이에게 「전체 ○쪽」
      updatePageBadge(); updateFeatureButtons();
    }).catch(function (err) { if (err === STALE) return; showError('문서를 표시하지 못했습니다.', (err && err.message) ? err.message : ''); });
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
    scheduleLastPage();
  }
  // v6.9: 지금 보는 쪽을 최근 목록에 기억(1.2초 모아서 한 번 저장)
  var lastPageT = null;
  function scheduleLastPage() {
    if (!curKey || !pdfDoc || viewMode !== 'pdf') return;
    var k = curKey, p = getCurrentPage();
    if (lastPageT) clearTimeout(lastPageT);
    lastPageT = setTimeout(function () { lastPageT = null; if (k === curKey) DocStore.touch(k, { lastPage: p }); }, 1200);
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

  /* ============ v8.0(O-0153) 여러 문서 탭 ============
   * 대표님 지시: "문서를 보고 있는 화면에서 파일을 더 열고, 탭으로 1번·2번·3번 파일을 왔다갔다."
   *   · [＋ 파일 더 열기] → 시트(폰에서 파일 고르기 · 최근 연 문서) → 새 문서가 탭으로 붙는다. 보던 문서는 탭으로 남는다.
   *   · 탭을 누르면 그 문서가 「보던 쪽·확대·회전·시트」 그대로 다시 열린다(변환·내려받기 없음).
   *   · 같은 문서를 또 열면 새 탭을 만들지 않고 그 탭으로 간다. 최대 MAX_TABS 개.
   * 메모리: 화면에 그리는 PDF 엔진은 언제나 1개. 보이지 않는 탭은 엔진·캔버스를 쥐지 않고 PDF 사본(Blob)만 든다.
   * ==========================================================================*/
  function tabByKey(key) { if (!key) return -1; for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) return i; return -1; }
  function activeTab() { return (activeIdx >= 0 && tabs[activeIdx]) || null; }
  function viewerOpen() { return !!(rootEl && rootEl.classList.contains('on')); }
  function copyState(st) { var o = {}; if (st) for (var k in st) if (st.hasOwnProperty(k)) o[k] = st[k]; return o; }
  function capToast() { toast('문서는 ' + MAX_TABS + '개까지 함께 열 수 있어요. 위 탭의 ✕로 하나를 닫고 다시 열어 주세요.'); }
  function refreshFname() {
    var t = activeTab(); if (fnameLabel && t && liveTabId === t.id) fnameLabel.textContent = t.name;
  }

  // 연속 스크롤 목록에서 「쪽 단위 위치」(3.25 = 3쪽의 1/4 지점) — 탭으로 돌아올 때 보던 자리를 그대로 되살린다.
  function slotTop(listEl, k) { var f = listEl.firstElementChild; return k.offsetTop - (f ? f.offsetTop : 0) + 10; }
  function listPos(listEl, sc) {
    var kids = listEl.children, top = sc.scrollTop;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i], t0 = slotTop(listEl, k) - 6, h = k.offsetHeight + 12;
      if (top < t0 + h || i === kids.length - 1) return i + 1 + Math.max(0, Math.min(0.999, (top - t0) / h));
    }
    return 1;
  }
  function listSetPos(listEl, sc, p) {
    var kids = listEl.children; if (!kids.length) return;
    var i = Math.max(0, Math.min(kids.length - 1, Math.floor(p) - 1)), k = kids[i];
    var frac = Math.max(0, Math.min(0.999, p - (i + 1)));
    sc.scrollTop = Math.max(0, slotTop(listEl, k) - 6 + frac * (k.offsetHeight + 12));
  }

  // 지금 화면의 문서 자리를 탭에 적어 둔다(탭 전환·새 문서 열기·나가기 직전).
  function snapshotActive(touchRecent) {
    var t = activeTab(); if (!t || liveTabId !== t.id) return;
    var st = t.state || (t.state = {});
    if (isExcelDoc) {
      st.excelView = excelView; st.sheet = parseInt(sheetSel.value, 10) || 0; st.font = tableFontPx;
      if (excelWorkbook) { st.sheetName = excelWorkbook.SheetNames[st.sheet] || ''; st.sheetCount = excelWorkbook.SheetNames.length; }   // v8.1 케이에게 묻기
      if (excelView === 'table') { st.ttop = scroller.scrollTop; st.tleft = scroller.scrollLeft; }
      if (!excelPdfBlob && excelPdfBuf) { try { excelPdfBlob = new Blob([excelPdfBuf], { type: 'application/pdf' }); } catch (e) {} }
      if (excelPdfBlob) t.pdfBlob = excelPdfBlob;
    }
    if (pdfDoc && viewMode === 'pdf') {
      st.pos = pdfPaged ? pageModeCur : listPos(pagesEl, scroller); st.page = getCurrentPage();
      st.zoom = userZoom; st.rot = userRotation; st.left = scroller.scrollLeft;
      if (t.key) { var pr = DocStore.touch(t.key, { lastPage: st.page }); if (touchRecent && pr && pr.then) pr.then(renderRecent); }
    }
  }
  function beginOpen() { closeSheet(); snapshotActive(); liveTabId = null; openIntent = 'new'; pendingRestore = null; pendingPdfBlob = null; }
  function markRestored() { var t = activeTab(); if (t) liveTabId = t.id; openIntent = null; renderTabs(); }
  function commitNewTab(kind) {
    var info = curFileInfo || {};
    var t = { id: ++tabSeq, key: curKey || null, srcUrl: curSrcUrl || null, name: info.name || fnameLabel.textContent || '문서',
              ext: info.ext || extOf(info.name), size: info.size || 0, kind: kind, state: {} };
    if (kind === 'excel') { t.file = excelFile; t.pdfBlob = excelPdfBlob || null; }
    else { t.blob = pendingPdfBlob; t.isPpt = curIsPpt; }
    t.orig = (kind === 'excel') ? (excelFile || curOrig) : curOrig;   // O-0171 편집하기용 원본
    t.srcFull = curSrcFull || null; t.pcPath = curPcPath || null;
    pendingPdfBlob = null; openIntent = null;
    tabs.push(t); activeIdx = tabs.length - 1; liveTabId = t.id;
    renderTabs();
    if (tabs.length === 2) toast('📑 두 번째 문서를 열었어요. 위 탭을 눌러 왔다갔다 보세요.');
  }
  // 새 문서 열기를 그만둠(취소·실패·한도) → 보던 탭으로. 탭이 없으면 예전처럼 뷰어를 닫는다.
  function abortOpen() {
    opToken++; cancelUpload(); releaseWake(); hideOverlay(); openIntent = null; pendingRestore = null; pendingPdfBlob = null;
    if (tabs.length) { activateTab(Math.max(0, Math.min(activeIdx, tabs.length - 1)), { noSnap: true }); return; }
    leaveViewer();
  }
  function failRestore() {
    openIntent = null; var i = activeIdx;
    if (tabs[i]) tabs.splice(i, 1);
    toast('이 탭의 문서를 다시 열지 못해 탭을 닫았어요. 「최근 연 문서」에서 다시 열어 주세요.');
    if (tabs.length) activateTab(Math.min(i, tabs.length - 1), { noSnap: true }); else { activeIdx = -1; leaveViewer(); }
  }
  // 탭 하나를 화면에 다시 그린다(들고 있는 PDF·엑셀 원본으로 — 변환·내려받기 없음).
  function activateTab(i, o) {
    o = o || {}; if (i < 0 || i >= tabs.length) return;
    if (!o.noSnap) snapshotActive();
    opToken++; var op = opToken; cancelUpload(); releaseWake(); hideOverlay(); closeSlideshow();
    var t = tabs[i]; activeIdx = i; liveTabId = null; parked = false;
    clearDocView();
    curKey = t.key || null; curSrcUrl = t.srcUrl || null; resumePage = 0;
    curFileInfo = { name: t.name, ext: t.ext, size: t.size };
    curOrig = t.orig || null; curSrcFull = t.srcFull || null; curPcPath = t.pcPath || null;   // O-0171
    showViewer(); fnameLabel.textContent = t.name; renderTabs(); renderOpenCard();
    openIntent = 'restore'; pendingRestore = copyState(t.state);
    if (t.kind === 'excel' && t.file) { openExcelFile(t.file, { pdfBlob: t.pdfBlob || null, stored: true }); return; }
    if (!t.blob) { failRestore(); return; }
    blobToBuf(t.blob).then(function (buf) {
      if (op !== opToken) return;
      loadPdf({ data: new Uint8Array(buf) }, t.name, t.isPpt);
    }, function () { if (op === opToken) failRestore(); });
  }
  function showTab(i) {
    if (i === activeIdx && liveTabId === tabs[i].id && viewerOpen()) return;
    showViewer(); activateTab(i);
  }
  function closeTab(i) {
    var t = tabs[i]; if (!t) return;
    var wasActive = (i === activeIdx);
    if (wasActive) snapshotActive(true);
    tabs.splice(i, 1);
    if (!tabs.length) { activeIdx = -1; liveTabId = null; parked = false; leaveViewer(); return; }
    if (wasActive) activateTab(Math.min(i, tabs.length - 1), { noSnap: true });
    else { if (i < activeIdx) activeIdx--; renderTabs(); }
  }
  // 뒤로(← · 폰 뒤로가기): 시트 닫기 → 여는 중이면 취소(보던 탭으로) → 뷰어 닫기
  function backAction() {
    if (!viewerOpen()) { leaveViewer(); return; }
    if (sheetEl && sheetEl.classList.contains('on')) { closeSheet(); return; }
    if (askEl && askEl.classList.contains('on')) { closeAsk(); return; }   // v8.1
    if (editEl && editEl.classList.contains('on')) { closeEdit(); return; }   // O-0171
    if (openIntent === 'new' && tabs.length) { abortOpen(); return; }
    leaveViewer();
  }

  // ---------- 탭 띠 ----------
  function renderTabs() {
    if (!tabsEl) return;
    tabsEl.style.display = (viewerOpen() && tabs.length >= 1) ? 'flex' : 'none';
    if (tabAddBtn) { tabAddBtn.textContent = tabs.length <= 1 ? '＋ 파일 더 열기' : '＋'; tabAddBtn.classList.toggle('wide', tabs.length <= 1); }
    updateAskBtn();                                                  // v8.1: [케이에게 묻기]는 문서가 화면에 다 그려졌을 때만
    updateEditBtn();                                                 // O-0171: [편집하기]도 같은 때(한글·워드·엑셀·PPT만)
    if (!tabListEl) return;
    tabListEl.innerHTML = tabs.map(function (t, i) {
      var b = TYPE_BADGE[t.ext || extOf(t.name)] || ['', 't-etc'];
      return '<div class="dv-tab' + (i === activeIdx ? ' on' : '') + '" data-i="' + i + '">' +
        '<button class="dv-tabmain" type="button" data-act="go" title="' + esc(t.name) + '">' +
          '<span class="dv-tbadge ' + b[1] + '">' + (i + 1) + '</span>' +
          '<span class="dv-tname">' + esc(t.name) + '</span></button>' +
        '<button class="dv-tabx" type="button" data-act="x" aria-label="' + esc(t.name) + ' 탭 닫기">✕</button>' +
      '</div>';
    }).join('');
    var onEl = tabListEl.querySelector('.dv-tab.on');
    if (onEl) { try { var L = onEl.offsetLeft, R = L + onEl.offsetWidth; if (L < tabListEl.scrollLeft || onEl.offsetWidth >= tabListEl.clientWidth) tabListEl.scrollLeft = Math.max(0, L - 8); else if (R > tabListEl.scrollLeft + tabListEl.clientWidth) tabListEl.scrollLeft = R - tabListEl.clientWidth + 8; } catch (e) {} }
  }
  function onTabClick(ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-act]') : null, row = btn && btn.closest('.dv-tab');
    if (!btn || !row) return;
    var i = +row.getAttribute('data-i'); if (!tabs[i]) return;
    if (btn.getAttribute('data-act') === 'x') closeTab(i); else showTab(i);
  }
  // 문서 고르기 화면의 「열어 둔 문서」(탭 2개 이상 두고 나갔을 때)
  function renderOpenCard() {
    var w = $('docOpenWrap'); if (!w) return;
    if ((tabs.length < 2 && !(parked && tabs.length)) || viewerOpen()) { w.style.display = 'none'; return; }
    w.style.display = '';
    var info = $('docOpenInfo'); if (info) info.textContent = tabs.length + '개';
    var nm = $('docOpenNames');
    if (nm) nm.innerHTML = tabs.map(function (t, i) { return '<div class="dv-openrow"><b>' + (i + 1) + '</b> ' + esc(t.name) + '</div>'; }).join('');
  }

  // ---------- [＋ 파일 더 열기] 시트 ----------
  function openSheet() {
    if (!sheetEl) { if (fileInput) fileInput.click(); return; }
    if (tabs.length >= MAX_TABS) { capToast(); return; }
    sheetEl.classList.add('on');
    var note = $('dvsNote'); if (note) note.textContent = '지금 보던 문서는 위 탭에 그대로 남아요 · 최대 ' + MAX_TABS + '개';
    var list = $('dvsList'); if (!list) return;
    list.innerHTML = '<div class="dvs-empty">불러오는 중…</div>';
    DocStore.list().then(function (items) {
      if (!sheetEl.classList.contains('on')) return;
      if (!items.length) { list.innerHTML = '<div class="dvs-empty">아직 최근 연 문서가 없어요.</div>'; return; }
      list.innerHTML = items.slice(0, 20).map(function (m) {
        var b = TYPE_BADGE[m.ext || extOf(m.name)] || [String(m.ext || '문서').toUpperCase().slice(0, 4), 't-etc'];
        var open = tabByKey(m.key) >= 0;
        var bits = [fmtWhen(m.openedAt)]; if (m.kind === 'excel') bits.push('표'); else if (m.pages) bits.push(m.pages + '쪽');
        return '<button class="dvs-row' + (open ? ' open' : '') + '" type="button" data-key="' + esc(m.key) + '">' +
          '<span class="dv-tbadge big ' + b[1] + '">' + esc(b[0]) + '</span>' +
          '<span class="dvs-tx"><span class="dvs-nm">' + esc(m.name) + '</span><span class="dvs-mt">' + esc(bits.join(' · ')) + '</span></span>' +
          (open ? '<span class="dvs-open">열려 있음</span>' : '') + '</button>';
      }).join('');
    });
  }
  function closeSheet() { if (sheetEl) sheetEl.classList.remove('on'); }
  function openRecentKey(key) {
    closeSheet();
    var di = tabByKey(key);
    if (di >= 0) { showTab(di); return; }
    if (tabs.length >= MAX_TABS) { capToast(); return; }
    beginOpen(); opToken++; var op = opToken;
    DocStore.get(key).then(function (meta) {
      if (op !== opToken) return;
      if (!meta) { renderRecent(); toast('목록에서 이미 지워진 문서예요.'); abortOpen(); return; }
      isExcelDoc = false; xlToggleBtn.style.display = 'none'; curSrcUrl = null;
      curOrig = null; curSrcFull = null; curPcPath = null;              // O-0171
      openStored(meta, op, null);
    });
  }
  function initTabs() {
    if (tabListEl) tabListEl.addEventListener('click', onTabClick);
    if (tabAddBtn) tabAddBtn.onclick = openSheet;
    if (sheetEl) {
      sheetEl.addEventListener('click', function (e) { if (e.target === sheetEl) closeSheet(); });
      var pk = $('dvsPick'); if (pk) pk.onclick = function () { closeSheet(); if (fileInput) fileInput.click(); };
      var cl = $('dvsClose'); if (cl) cl.onclick = closeSheet;
      var ls = $('dvsList'); if (ls) ls.addEventListener('click', function (e) { var r = e.target.closest ? e.target.closest('.dvs-row') : null; if (r) openRecentKey(r.getAttribute('data-key')); });
    }
    var rs = $('docOpenResume'); if (rs) rs.onclick = function () { if (!tabs.length) { renderOpenCard(); return; } showViewer(); activateTab(Math.max(0, Math.min(activeIdx, tabs.length - 1)), { noSnap: true }); };
    var ca = $('docOpenCloseAll'); if (ca) ca.onclick = function () { tabs = []; activeIdx = -1; liveTabId = null; parked = false; renderOpenCard(); renderTabs(); toast('열어 둔 문서를 모두 닫았어요. (최근 연 문서에는 남아 있어요)'); };
  }

  /* ============ v8.1(O-0154) 케이에게 묻기·맡기기 ============
   * 대표님 지시: 보고 있는 문서를 케이 채팅으로 넘겨 「이 규정 핵심만」「3쪽 표 설명해 줘」「1차안과 뭐가 달라?」를 묻고,
   *   문서를 바탕으로 한 지시(공문 초안·보고서)도 바로 맡긴다.
   *   · 화면 오른쪽 아래 [케이에게 묻기] → 시트: 빠른 칩(묻기 3 + 맡기기 2, 탭 2개 이상이면 「차이점」) + 직접 적기
   *     + (탭 2개 이상) 「열린 문서 함께 보내기」.
   *   · 보내기는 app.js 가 넘겨 준 askHandler 가 맡는다(채팅 화면으로 넘어가 첨부와 함께 전송 — 기존 채팅 첨부 통로).
   *   · 여기서는 「무엇을 보고 있었나」(문서 이름·보던 쪽·전체 쪽·시트)와 「보낼 파일」(변환된 PDF / 엑셀 원본,
   *     PC가 이미 변환해 서버에 둔 PDF가 있으면 그 번호)만 모아 넘긴다. 문서 원본·서버 테이블은 새로 만들지 않는다.
   * ==========================================================================*/
  var ASK_REF_MAX_AGE = 5 * 24 * 3600 * 1000;   // PC 변환본(voice-docs view.pdf)을 다시 쓰는 기간 — 장부 보관(6일)보다 짧게
  // 받침 따라 을/를 (마지막 한글 글자 기준, 한글이 없으면 '을(를)')
  function josaEulReul(w) {
    var s = String(w || '');
    for (var i = s.length - 1; i >= 0; i--) { var c = s.charCodeAt(i); if (c >= 0xAC00 && c <= 0xD7A3) return ((c - 0xAC00) % 28) ? '을' : '를'; if (/[0-9A-Za-z]/.test(s[i])) break; }
    return '을(를)';
  }
  function askBase(name) { var n = String(name || '문서'); var i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; }
  function askItem(t, i) {
    var st = t.state || {}, ext = t.ext || extOf(t.name), excel = t.kind === 'excel';
    var it = { name: t.name, ext: ext, kind: t.kind, active: i === activeIdx, view: excel ? (st.excelView || 'table') : 'pdf',
               page: st.page || 0, pages: t.pages || 0, sheet: st.sheetName || '', sheets: st.sheetCount || 0,
               pdf: null, orig: null, ref: null, sendName: '' };
    if (excel) {
      it.orig = t.file || null; it.sendName = t.name;               // 엑셀은 원본 그대로(숫자·수식을 케이가 직접 연다)
      if (!it.orig && t.pdfBlob) { it.pdf = t.pdfBlob; it.sendName = askBase(t.name) + '.pdf'; }
    } else {
      it.pdf = t.blob || null; it.sendName = (ext === 'pdf') ? t.name : (askBase(t.name) + '.pdf');
    }
    // PC가 이미 변환해 서버(voice-docs)에 올려 둔 PDF 가 있으면 다시 올리지 않고 그 요청 번호만 넘긴다(PDF 원본은 해당 없음).
    if (!excel && ext !== 'pdf' && t.key) {
      var j = jobGet(t.key);
      if (j && j.id && j.tok && j.doneAt && Date.now() - j.doneAt < ASK_REF_MAX_AGE) it.ref = { id: j.id, tok: j.tok };
    }
    return it;
  }
  // 지금 열린 문서들의 「보던 자리 + 보낼 파일」. 화면에 그려진 문서가 없으면 null.
  function askContext() {
    var t = activeTab(); if (!t || liveTabId !== t.id) return null;
    snapshotActive();
    if (pdfDoc && viewMode === 'pdf') t.pages = t.pages || pdfDoc.numPages;
    return { active: activeIdx, items: tabs.map(askItem) };
  }
  function askWhere(it) {                                            // 「8쪽」·「시트 '1학기'」
    if (it.kind === 'excel' && it.view !== 'pdf') return it.sheet ? ('「' + it.sheet + '」 시트') : '표';
    return it.page ? (it.page + '쪽') : '';
  }
  var ASK_CHIPS = [
    { g: 'ask', id: 'sum', label: '핵심만 요약', q: function () { return '이 문서 핵심만 쉽게 요약해 줘.'; } },
    { g: 'ask', id: 'here', label: function (it) { return '지금 보는 ' + (askWhere(it) || '부분') + ' 설명'; },
      q: function (it) { return '지금 보고 있는 ' + (askWhere(it) || '부분') + ' 내용을 쉽게 설명해 줘.'; } },
    { g: 'ask', id: 'nums', label: '표·숫자 정리', q: function () { return '이 문서의 표와 숫자를 한눈에 보기 쉽게 정리해 줘.'; } },
    { g: 'ask', id: 'diff', multi: true, label: '열린 문서 차이점', q: function () { return '열어 둔 문서들을 비교해서 무엇이 달라졌는지 알려 줘.'; } },
    { g: 'do', id: 'memo', label: '이 문서로 공문 초안', q: function () { return '이 문서를 바탕으로 공문 초안을 만들어 줘.'; } },
    { g: 'do', id: 'rep', label: '요점으로 보고서 1쪽', q: function () { return '이 문서 요점으로 1쪽짜리 보고서를 만들어 줘.'; } }
  ];
  function chipLabel(c, it) { return typeof c.label === 'function' ? c.label(it) : c.label; }
  function updateAskBtn() {
    if (!askBtn) return;
    var t = activeTab();
    askBtn.style.display = (askHandler && viewerOpen() && t && liveTabId === t.id) ? 'inline-flex' : 'none';
  }
  function openAsk() {
    if (!askEl || !askHandler) return;
    var ctx = askContext();
    if (!ctx) { toast('문서가 다 열린 뒤에 눌러 주세요.'); return; }
    closeSheet();
    var it = ctx.items[ctx.active], multi = ctx.items.length >= 2;
    var where = askWhere(it);
    var wp = where || '문서';
    $('dvaNote').textContent = '「' + it.name + '」 ' + wp + josaEulReul(wp) + ' 보고 계세요. 이 문서를 케이에게 함께 보내요.';
    function chipsHtml(g) {
      return ASK_CHIPS.filter(function (c) { return c.g === g && (!c.multi || multi); }).map(function (c) {
        return '<button class="dva-chip' + (c.g === 'do' ? ' do' : '') + '" type="button" data-chip="' + c.id + '">' + esc(chipLabel(c, it)) + '</button>';
      }).join('');
    }
    $('dvaAskChips').innerHTML = chipsHtml('ask');
    $('dvaDoChips').innerHTML = chipsHtml('do');
    var mw = $('dvaMultiWrap'), cb = $('dvaMulti');
    if (multi) {
      mw.style.display = '';
      cb.checked = false;
      $('dvaMultiLbl').textContent = '열린 문서 ' + ctx.items.length + '개 함께 보내기 (차이점 묻기)';
      $('dvaMultiNames').innerHTML = ctx.items.map(function (x, i) {
        return '<div class="dva-mrow' + (x.active ? ' on' : '') + '"><b>' + (i + 1) + '</b> ' + esc(x.name) +
          (askWhere(x) ? ' <span>· ' + esc(askWhere(x)) + (x.active ? ' 보는 중' : (x.kind === 'excel' && x.view !== 'pdf' ? '' : '까지 봄')) + '</span>' : '') + '</div>';
      }).join('');
    } else { mw.style.display = 'none'; cb.checked = false; }
    var tx = $('dvaText'); tx.value = ''; askChip = null;
    askEl.classList.add('on'); askEl._ctx = ctx;
    updateAskSend();
  }
  function closeAsk() { if (askEl) { askEl.classList.remove('on'); askEl._ctx = null; } }
  function updateAskSend() {
    var b = $('dvaSend'); if (!b) return;
    b.disabled = !String($('dvaText').value || '').trim();
  }
  function onAskChip(id) {
    var ctx = askEl && askEl._ctx; if (!ctx) return;
    var c = null; ASK_CHIPS.forEach(function (x) { if (x.id === id) c = x; }); if (!c) return;
    var it = ctx.items[ctx.active];
    $('dvaText').value = c.q(it); askChip = id;
    if (c.multi) $('dvaMulti').checked = true;
    Array.prototype.forEach.call(askEl.querySelectorAll('.dva-chip'), function (b) { b.classList.toggle('on', b.getAttribute('data-chip') === id); });
    updateAskSend();
  }
  function sendAsk() {
    var ctx = askEl && askEl._ctx; if (!ctx) return;
    var q = String($('dvaText').value || '').trim(); if (!q) { toast('물어보실 말씀을 골라 주시거나 적어 주세요.'); return; }
    var all = !!($('dvaMulti') && $('dvaMulti').checked && ctx.items.length >= 2);
    var items = all ? ctx.items : [ctx.items[ctx.active]];
    var miss = items.filter(function (x) { return !x.pdf && !x.orig && !x.ref; });
    if (miss.length === items.length) { toast('이 문서는 보낼 사본이 없어요. 문서를 다시 열고 눌러 주세요.'); return; }
    var payload = { question: q, chip: askChip, all: all, items: items.filter(function (x) { return x.pdf || x.orig || x.ref; }),
                    missing: miss.map(function (x) { return x.name; }) };
    closeAsk();
    parked = true;                                                   // 채팅을 보고 돌아오면 「열어 둔 문서 · 이어서 보기」
    try { askHandler(payload); } catch (e) { toast('케이에게 보내지 못했어요. 다시 눌러 주세요.'); }
  }
  // 이미 서버에 있는 PC 변환본이 지금도 살아 있는지 확인(요청 행 + 서명 주소). 실패하면 null → 폰 사본을 올린다.
  function checkRef(ref) {
    if (!ref || !global.OfficeBridge) return Promise.resolve(null);
    return OfficeBridge.poll(ref.id, ref.tok).then(function (res) {
      var d = res && res.status === 'done' ? OfficeBridge.docResultFrom(res) : null;
      if (!d || !d.pdf_url) return null;
      return fetch(d.pdf_url, { method: 'GET', headers: { Range: 'bytes=0-0' } }).then(function (r) {
        try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) {}
        return (r.ok || r.status === 206) ? { id: ref.id, tok: ref.tok, pages: d.pages || 0 } : null;
      });
    }).catch(function () { return null; });
  }
  function initAsk() {
    askEl = $('dvAsk'); askBtn = $('dvAskBtn');
    if (askBtn) askBtn.onclick = openAsk;
    if (!askEl) return;
    askEl.addEventListener('click', function (e) {
      if (e.target === askEl) { closeAsk(); return; }
      var c = e.target.closest ? e.target.closest('[data-chip]') : null;
      if (c) onAskChip(c.getAttribute('data-chip'));
    });
    var tx = $('dvaText'); if (tx) tx.addEventListener('input', updateAskSend);
    var sb = $('dvaSend'); if (sb) sb.onclick = sendAsk;
    var cl = $('dvaClose'); if (cl) cl.onclick = closeAsk;
  }

  /* ============ O-0171 ✏️ PC에서 편집하기 (한글·워드·엑셀·PPT) ============
   * 대표님(삼성 DeX: 폴드8 + 모니터·키보드·마우스)이 보던 문서를 「진짜 프로그램」으로 고치는 흐름:
   *   [✏️ 편집하기] → PC가 그 파일을 한글/워드/엑셀/PowerPoint로 열고 창을 최대화·맨 앞으로(edit_worker.py)
   *   → [🖥️ 원격 화면 열기] = 크롬 원격 데스크톱 앱(폰) / 원격 데스크톱 웹(PC판) → 원격으로 고치고 [저장]
   *   → [다 됐어요] → PC가 저장본을 폰용 PDF로 돌려줌 → [고친 문서 보기]·[파일 받기]
   *   · 원본은 다시 올리지 않는 길을 먼저: PC 경로(케이 첨부에 pc_path) > 사무소 서버 주소(케이 첨부·공유함) > 폰 파일.
   *   · 진행 중인 편집은 기기에 적어 둔다(앱을 껐다 켜도 [다 됐어요]를 누를 수 있게) — 문서 키별 1건, 1일 보관.
   *   · 보내기는 연동 암호 확인 RPC(submit_memo)로만. 암호가 없거나 틀리면 앱의 연동 암호 창이 뜬다(smartBadPass).
   * ==========================================================================*/
  var EDITABLE = { hwp: '한글', hwpx: '한글', doc: '워드', docx: '워드', xls: '엑셀', xlsx: '엑셀', ppt: 'PowerPoint', pptx: 'PowerPoint' };
  // ★ [편집하기]를 보여 줄 형식 — 이 한 줄이 켜고 끄는 곳.
  //   2026-10-03 대표님 「일단 한글부터」 → 같은 날 v8.7(O-0174) 「워드, 엑셀, ppt도 한글처럼」으로 6개 형식 추가.
  //   (PC 변환기 O-0172 패치 적용 · PC 편집 워커는 워드·엑셀·PPT 창을 COM 으로 정확한 경로의 문서만 찾음(O-0174))
  //   PC 쪽 edit_config.json 의 enabled_exts 와 같이 바꿀 것(안 맞으면 PC가 정중히 거절). 한글만으로 되돌리기 = ['hwp', 'hwpx'].
  var EDIT_ON_EXTS = ['hwp', 'hwpx', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  var CRD_PKG = 'com.google.chromeremotedesktop', CRD_WEB = 'https://remotedesktop.google.com/access';
  var EDIT_STORE = 'smartedit_sessions_v1', EDIT_KEEP_MS = 24 * 3600 * 1000;
  var editEl = null, editBtn = null, editOpts = null, editCtx = null, editPollT = null, editSeq = 0, editPickInput = null;
  function editOn(ext) { return !!EDITABLE[ext] && EDIT_ON_EXTS.indexOf(ext) >= 0; }
  function isNativeApp() { var C = global.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
  function isServerFileUrl(u) {
    u = String(u || ''); if (!global.OfficeBridge) return false;
    var b = OfficeBridge.CONFIG.url + '/storage/v1/object/';
    return u.indexOf(b + 'sign/voice-docs/') === 0 || u.indexOf(b + 'public/locker/') === 0;
  }
  function editsLoad() { try { return JSON.parse(localStorage.getItem(EDIT_STORE) || '{}') || {}; } catch (e) { return {}; } }
  function editsSave(m) {
    try {
      var now = Date.now(), o = {};
      Object.keys(m).forEach(function (k) { if (m[k] && now - (m[k].ts || 0) < EDIT_KEEP_MS) o[k] = m[k]; });
      localStorage.setItem(EDIT_STORE, JSON.stringify(o));
    } catch (e) {}
  }
  function editKeyOf(t) { return (t && (t.key || ('n:' + t.name + ':' + (t.size || 0)))) || ''; }
  function editSessGet(t) { var j = editsLoad()[editKeyOf(t)]; return (j && Date.now() - (j.ts || 0) < EDIT_KEEP_MS) ? j : null; }
  function editSessPut(t, j) { var m = editsLoad(); j.ts = Date.now(); m[editKeyOf(t)] = j; editsSave(m); }
  function editSessDel(t) { var m = editsLoad(); delete m[editKeyOf(t)]; editsSave(m); }
  function editSrcOf(t) {
    if (!t) return null;
    var ext = t.ext || extOf(t.name);
    if (t.pcPath) return { pcPath: t.pcPath, name: t.name, ext: ext, how: 'PC에 있는 원본을 그대로 열어요' };
    if (t.srcFull && isServerFileUrl(t.srcFull)) return { url: t.srcFull, name: t.name, ext: ext, how: '사무소 서버에 있는 파일을 PC가 바로 받아요' };
    if (t.orig) return { file: t.orig, name: t.name, ext: ext, how: '폰에 있는 원본을 PC로 보내요(' + fmtSize(t.orig.size || 0) + ')' };
    return null;
  }
  function updateEditBtn() {
    if (!editBtn) return;
    var t = activeTab();
    var ok = !!(editOpts && viewerOpen() && t && liveTabId === t.id && editOn(t.ext || extOf(t.name)));
    editBtn.style.display = ok ? 'inline-flex' : 'none';
    if (ok) { var s = editSessGet(t); editBtn.classList.toggle('live', !!(s && s.phase && s.phase !== 'returned')); }
  }
  // ---- 시트 그리기: 단계 띠 ① PC로 보내기 ② PC에서 열기 ③ 원격으로 고치고 저장 ④ 다 됐어요 ----
  function editStepsHtml(step) {
    var names = ['PC로 보내기', 'PC에서 열기', '원격으로 고치고 저장', '다 됐어요'];
    return '<div class="dve-steps">' + names.map(function (n, i) {
      var s = i + 1;
      return '<span class="' + (s < step ? 'done' : (s === step ? 'on' : '')) + '"><b>' + (s < step ? '✓' : s) + '</b>' + esc(n) + '</span>';
    }).join('') + '</div>';
  }
  function editRender(v) {
    if (!editEl) return;
    var c = editCtx || {}, b = TYPE_BADGE[c.ext] || [String(c.ext || '').toUpperCase().slice(0, 4), 't-etc'];
    var h = '<div class="dvs-title">✏️ PC에서 편집하기</div>' +
      '<div class="dve-file"><span class="dv-tbadge big ' + b[1] + '">' + esc(b[0]) + '</span>' +
      '<span class="dve-fname">' + esc(c.name || '문서') + '</span></div>' + editStepsHtml(v.step || 1);
    h += '<div class="dve-status ' + (v.tone || '') + '">' +
      (v.icon ? '<span class="dve-ic">' + v.icon + '</span>' : (v.spin ? '<span class="dve-spin"></span>' : '')) +
      '<div class="dve-msg"><div class="dve-big">' + esc(v.msg || '') + '</div>' + (v.sub ? '<div class="dve-sub">' + esc(v.sub) + '</div>' : '') +
      (v.pct != null ? '<div class="dve-bar"><i style="width:' + Math.max(3, Math.min(100, v.pct)) + '%"></i></div>' : '') + '</div></div>';
    if (v.tip) h += '<div class="dve-tip">' + v.tip + '</div>';
    (v.btns || []).forEach(function (x) { h += '<button class="' + (x.cls || 'dvs-big') + '" type="button" data-eact="' + x.act + '">' + esc(x.label) + '</button>'; });
    h += '<button class="dvs-close" type="button" data-eact="close">' + esc(v.closeLabel || '닫기') + '</button>';
    $('dvePanel').innerHTML = h;
  }
  function remoteBtn(primary) { return { act: 'remote', label: isNativeApp() ? '🖥️ 원격 화면 열기' : '🖥️ 원격 데스크톱 열기', cls: primary ? 'dvs-big' : 'dvs-big dve-2nd' }; }
  function doneBtn(primary) { return { act: 'finish', label: '✅ 다 됐어요 (고친 문서 받기)', cls: primary ? 'dvs-big dve-ok' : 'dvs-big dve-ok dve-2nd' }; }
  function remoteTip() {
    var prog = esc(EDITABLE[(editCtx || {}).ext] || '프로그램');
    return isNativeApp()
      ? '원격 화면에서 고치신 뒤 <b>' + prog + '의 [저장](Ctrl+S)</b>을 꼭 누르고, 이 앱으로 돌아와 <b>[다 됐어요]</b>를 눌러 주세요.'
      : '지금 이 화면이 <b>24시간 PC</b>라면 ' + prog + ' 창이 이미 맨 앞에 떠 있어요. 다른 PC라면 [원격 데스크톱 열기]로 들어가세요. 고친 뒤 <b>[저장]</b> → <b>[다 됐어요]</b>.';
  }
  function editShowOpened(e) {
    var prog = e.program || EDITABLE[(editCtx || {}).ext] || '프로그램';
    var locked = e.window === 'locked' || e.state === 'opened_locked';
    var flash = e.window === 'flash';
    editRender({ step: 3, icon: locked ? '🔒' : '✓', tone: (locked || flash) ? 'warn' : 'ok',
      msg: locked ? 'PC에서 ' + prog + '로 열었어요 — PC 화면이 잠겨 있어요' : ('PC에서 ' + prog + '로 열었어요' + (e.reused ? ' (이미 열려 있던 창)' : '')),
      sub: locked ? '원격으로 들어가 잠금을 푸시면 ' + prog + ' 창이 맨 앞에 떠 있어요.'
         : (flash ? prog + ' 창을 맨 앞으로 올리지 못했어요. 원격 화면 아래 작업 표시줄에서 깜박이는 ' + prog + '를 눌러 주세요.'
                  : '창을 화면 가득 키워 맨 앞에 띄워 두었어요.'),
      tip: remoteTip(), btns: [remoteBtn(true), doneBtn(false)] });
  }
  function openEdit() {
    var t = activeTab();
    if (!editEl || !t || liveTabId !== t.id) { toast('문서가 다 열린 뒤에 눌러 주세요.'); return; }
    closeSheet(); closeAsk();
    editCtx = { tab: t, name: t.name, ext: t.ext || extOf(t.name), seq: ++editSeq };
    editEl.classList.add('on');
    var s = editSessGet(t);
    if (s && s.id && (s.phase === 'opened' || s.phase === 'finishing' || s.phase === 'not_saved' || s.phase === 'opening')) {
      editCtx.sess = s;
      if (s.phase === 'finishing' && s.fid) { editCtx.step = 4; editPoll(s.fid, s.tok, 'finish'); return; }
      if (s.phase === 'opening') { editPoll(s.id, s.tok, 'open'); return; }
      editShowOpened(s.edit || {}); return;
    }
    editShowStart();
  }
  function editShowStart() {
    var c = editCtx, prog = EDITABLE[c.ext], src = editSrcOf(c.tab);
    if (!src) {
      editRender({ step: 1, icon: '📁', tone: 'warn', msg: '이 문서의 원본 파일이 폰에 없어요',
        sub: '「최근 연 문서」에는 보기용 사본만 남아 있어요. 같은 파일을 한 번 더 골라 주시면 PC로 보내 ' + prog + '로 열어 드려요.',
        btns: [{ act: 'pick', label: '📁 원본 파일 고르기' }] });
      return;
    }
    editRender({ step: 1, icon: '🖥️', msg: 'PC의 ' + prog + '로 열어 드릴까요?',
      sub: src.how + '. 그다음 원격 화면으로 PC를 보면서 키보드·마우스로 고치시면 돼요.',
      tip: '고친 파일은 PC의 「SmartEdit」 폴더에 남고, 처음 원본도 1부 따로 보관해요.',
      btns: [{ act: 'start', label: '✏️ PC에서 ' + prog + '로 열기' }] });
  }
  function editFail(msg, sub, retryAct) {
    editRender({ step: (editCtx && editCtx.step) || 1, icon: '⚠️', tone: 'err', msg: msg, sub: sub || '',
      btns: retryAct ? [{ act: retryAct, label: '🔄 다시 시도' }] : [] });
  }
  function friendlyErr(e) {
    if (e && e.badpass) return ['연동 암호가 필요해요', '연동 암호를 넣으신 뒤 다시 눌러 주세요.'];
    if (e && e.notready) return ['PC 편집 기능이 서버에 아직 준비되지 않았어요', '소장에게 알려 주세요(서버 설정 한 가지가 남았어요).'];
    return ['PC로 보내지 못했어요', (e && (e.friendly || e.message)) || '인터넷 연결을 확인하고 다시 눌러 주세요.'];
  }
  function editStart() {
    var c = editCtx; if (!c || !global.OfficeBridge) return;
    var t = c.tab, src = editSrcOf(t); if (!src) { editShowStart(); return; }
    var seq = c.seq, id = OfficeBridge.uuid(), tok = OfficeBridge.token();
    c.step = 1;
    editRender({ step: 1, spin: true, msg: src.file ? 'PC로 보내는 중…' : 'PC에 요청하는 중…', sub: c.name, pct: src.file ? 2 : null });
    OfficeBridge.sendEditOpen({ id: id, token: tok, title: ('편집: ' + c.name).slice(0, 60) }, src, {
      onBytes: function (sent, total) {
        if (seq !== editSeq) return;
        var p = 100 * sent / (total || 1);
        editRender({ step: 1, spin: true, msg: 'PC로 보내는 중… ' + Math.floor(p) + '%', sub: fmtSize(sent) + ' / ' + fmtSize(total), pct: p });
      }
    }).then(function () {
      editSessPut(t, { id: id, tok: tok, phase: 'opening', name: c.name, ext: c.ext });
      if (seq === editSeq) editPoll(id, tok, 'open');
    }, function (e) {
      if (seq !== editSeq) return;
      var f = friendlyErr(e); editFail(f[0], f[1], 'start');
    });
  }
  function editFinish() {
    var c = editCtx; if (!c) return;
    var s = c.sess || editSessGet(c.tab); if (!s || !s.id) { editShowStart(); return; }
    var fid = OfficeBridge.uuid(), seq = c.seq;
    c.step = 4;
    editRender({ step: 4, spin: true, msg: 'PC에서 저장본을 확인하는 중…', sub: c.name });
    OfficeBridge.sendEditFinish({ id: fid, token: s.tok, title: ('다 됐어요: ' + c.name).slice(0, 60) }, s.id).then(function () {
      s.phase = 'finishing'; s.fid = fid; editSessPut(c.tab, s); c.sess = s;
      if (seq === editSeq) editPoll(fid, s.tok, 'finish');
    }, function (e) {
      if (seq !== editSeq) return;
      var f = friendlyErr(e); editFail(f[0], f[1], 'finish');
    });
  }
  // PC 응답 기다리기(2초마다). 3분 넘게 pending 이면 「PC가 응답하지 않아요」 + [다시 시도](같은 요청을 이어서 기다림).
  function editPoll(rid, tok, mode) {
    var c = editCtx, seq = c && c.seq, t0 = Date.now(), netFail = 0;
    if (editPollT) { clearTimeout(editPollT); editPollT = null; }
    (function loop() {
      if (!editCtx || seq !== editSeq || !editEl.classList.contains('on')) return;
      OfficeBridge.poll(rid, tok).then(function (res) {
        if (!editCtx || seq !== editSeq) return;
        netFail = 0;
        var st = res && res.status, w = Date.now() - t0;
        if (st === 'rejected') { editFail('PC가 요청을 거절했어요', '연동 암호 확인이 되지 않았어요. 연동 암호를 다시 넣고 시도해 주세요.', mode === 'open' ? 'start' : 'finish'); return; }
        if (st === 'done') { editDone(res, mode); return; }
        var pm = (res && res.progress_msg) || '';
        if (mode === 'open') {
          editRender({ step: 2, spin: true, msg: (pm || 'PC가 요청을 받는 중') + '…',
            sub: w > 30000 ? 'PC가 조금 늦어요. PC가 켜져 있는지 확인해 주세요. (' + fmtDur(w) + ')' : c.name });
        } else {
          editRender({ step: 4, spin: true, msg: (pm || 'PC에서 저장본을 확인하는 중') + '…', sub: c.name });
        }
        if (st !== 'processing' && w > 3 * 60 * 1000) {
          c.lastPoll = { rid: rid, tok: tok, mode: mode };
          editFail('PC가 3분 동안 응답하지 않아요', 'PC가 꺼져 있거나 편집 도우미가 멈췄을 수 있어요. 요청은 PC에 남아 있어요.', 'repoll');
          return;
        }
        editPollT = setTimeout(loop, 2000);
      }, function () {
        if (!editCtx || seq !== editSeq) return;
        if (!netFail) netFail = Date.now();
        if (Date.now() - netFail > 120000) {
          c.lastPoll = { rid: rid, tok: tok, mode: mode };
          editFail('인터넷 연결이 끊겨 PC 소식을 받지 못했어요', '연결을 확인한 뒤 [다시 시도]를 눌러 주세요.', 'repoll');
          return;
        }
        editPollT = setTimeout(loop, 3000);
      });
    })();
  }
  function editDone(res, mode) {
    var c = editCtx, t = c.tab, e = OfficeBridge.editResultFrom(res) || {};
    var s = editSessGet(t) || c.sess || {};
    if (mode === 'open') {
      if (e.state === 'opened' || e.state === 'opened_locked') {
        s.phase = 'opened'; s.edit = e; editSessPut(t, s); c.sess = s; c.step = 3;
        editShowOpened(e); updateEditBtn();
        if (e.window === 'locked' || e.window === 'flash') {   // 잠금이 풀려 PC가 창을 앞으로 올리면 글을 바꾼다(최대 15분)
          var seq = c.seq, n = 0;
          (function watch() {
            if (!editCtx || seq !== editSeq || !editEl.classList.contains('on') || ++n > 300) return;
            OfficeBridge.poll(s.id, s.tok).then(function (r2) {
              var e2 = OfficeBridge.editResultFrom(r2) || {};
              if (e2.window === 'front') { s.edit = e2; editSessPut(t, s); if (seq === editSeq && editCtx && editCtx.step === 3) editShowOpened(e2); return; }
              setTimeout(watch, 3000);
            }, function () { setTimeout(watch, 5000); });
          })();
        }
        return;
      }
      editSessDel(t); updateEditBtn();
      editFail('PC에서 열지 못했어요', e.msg || (res && res.error) || '', 'start');
      return;
    }
    if (e.state === 'returned') {
      var doc = (res.summary_json || {}).doc || null;
      s.phase = 'returned'; s.result = { file: e.file || null, doc: doc, chat: !!e.chat }; editSessPut(t, s); updateEditBtn();
      c.result = s.result; c.step = 5;
      editRender({ step: 5, icon: '🎉', tone: 'ok', msg: '고친 문서를 받았어요',
        sub: (e.msg ? e.msg + ' ' : '') + (e.pages ? e.pages + '쪽 · ' : '') + 'PC에도 저장본이 남아 있어요' + (e.chat ? ' · 채팅에도 보내 드렸어요' : '') + '.',
        btns: [].concat(doc && doc.pdf_url ? [{ act: 'viewret', label: '📄 고친 문서 보기' }] : [])
                .concat(e.file && e.file.url ? [{ act: 'dlret', label: '⬇ 파일 받기 (' + (e.file.name || '') + ')', cls: 'dvs-big dve-2nd' }] : [])
                .concat([{ act: 'again', label: '✏️ 이어서 더 고치기', cls: 'dvs-big dve-2nd' }]) });
      return;
    }
    if (e.state === 'not_saved') {
      s.phase = 'not_saved'; editSessPut(t, s); c.sess = s; c.step = 3;
      editRender({ step: 3, icon: '💾', tone: 'warn', msg: 'PC에서 아직 저장 안 했어요', sub: e.msg || '',
        tip: remoteTip(), btns: [remoteBtn(false), doneBtn(true)] });
      return;
    }
    if (e.state === 'no_session') { editSessDel(t); updateEditBtn(); editFail('PC에 이 편집 기록이 없어요', e.msg || '처음부터 다시 [PC에서 열기]를 눌러 주세요.', 'start'); return; }
    s.phase = 'opened'; editSessPut(t, s);
    editFail('고친 문서를 받지 못했어요', e.msg || (res && res.error) || '', 'finish');
  }
  function editOpenRemote() {
    if (!isNativeApp()) { try { global.open(CRD_WEB, '_blank', 'noopener'); } catch (e) { location.href = CRD_WEB; } return; }
    var EA = global.Capacitor.Plugins && global.Capacitor.Plugins.ExternalApp;
    if (!EA || typeof EA.launchApp !== 'function') { toast('앱을 새 버전으로 바꾸면 원격 화면을 바로 열 수 있어요. 지금은 「크롬 원격 데스크톱」 앱을 직접 열어 주세요.'); return; }
    EA.launchApp({ pkg: CRD_PKG }).then(function (r) {
      if (r && r.opened) return;
      if (r && r.reason === 'not_installed') {
        askThen('크롬 원격 데스크톱 앱이 없어요', '플레이 스토어에서 「Chrome 원격 데스크톱」(무료, 구글)을 설치해 주세요. 설치 후 대표님 구글 계정으로 로그인하면 24시간 PC가 목록에 보여요.', '스토어 열기', function () {
          EA.openStore({ pkg: CRD_PKG }).catch(function () {});
        }, { positive: true, icon: 'i-monitor' });
        return;
      }
      toast('원격 화면 앱을 열지 못했어요. 「크롬 원격 데스크톱」 앱을 직접 열어 주세요.');
    }, function () { toast('원격 화면 앱을 열지 못했어요.'); });
  }
  function editViewReturned() {
    var c = editCtx, r = c && c.result; if (!r || !r.doc || !r.doc.pdf_url) return;
    var nm = askBase(c.name) + ' (고친 문서).pdf';
    closeEdit();
    viewChatAttachment({ url: r.doc.pdf_url, name: nm, mime: 'application/pdf' });
  }
  function closeEdit() {
    if (editPollT) { clearTimeout(editPollT); editPollT = null; }
    editSeq++;
    if (editEl) editEl.classList.remove('on');
    editCtx = null;
  }
  function onEditAct(act) {
    var c = editCtx; if (!c) return;
    if (act === 'close') { closeEdit(); return; }
    if (act === 'start') { editStart(); return; }
    if (act === 'pick') { if (editPickInput) editPickInput.click(); return; }
    if (act === 'remote') { editOpenRemote(); return; }
    if (act === 'finish') { editFinish(); return; }
    if (act === 'repoll') { var lp = c.lastPoll; if (lp) editPoll(lp.rid, lp.tok, lp.mode); return; }
    if (act === 'viewret') { editViewReturned(); return; }
    if (act === 'dlret') { var f = c.result && c.result.file; if (f && editOpts && editOpts.download) editOpts.download(f.url, f.name); return; }
    if (act === 'again') {
      var s = editSessGet(c.tab);
      if (s && s.id) { s.phase = 'opened'; editSessPut(c.tab, s); c.sess = s; c.step = 3; editShowOpened(s.edit || {}); } else editShowStart();
    }
  }
  function initEdit() {
    editEl = $('dvEdit'); editBtn = $('dvEditBtn');
    if (editBtn) editBtn.onclick = openEdit;
    if (!editEl) return;
    editEl.addEventListener('click', function (e) {
      if (e.target === editEl) { closeEdit(); return; }
      var b = e.target.closest ? e.target.closest('[data-eact]') : null;
      if (b) onEditAct(b.getAttribute('data-eact'));
    });
    editPickInput = document.createElement('input'); editPickInput.type = 'file'; editPickInput.accept = '*/*'; editPickInput.style.display = 'none';
    document.body.appendChild(editPickInput);
    editPickInput.addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = '';
      var c = editCtx; if (!f || !c) return;
      var ext = extOf(f.name);
      if (!editOn(ext)) { toast(EDIT_ON_EXTS.length <= 2 ? '지금은 한글 파일(hwp·hwpx)만 PC에서 편집으로 열 수 있어요.' : '이 형식은 PC에서 편집으로 열 수 없어요.'); return; }
      c.tab.orig = f; c.tab.pcPath = null; c.tab.srcFull = null; c.tab.ext = ext; c.ext = ext; c.name = f.name;
      editShowStart();
    });
  }

  // ============ 진입점 ============
  function handleLocalFile(file) {
    if (!file) return;
    if (!isViewable(file.name, file.type)) {
      if (liveTabId) { toast('이 형식은 뷰어에서 열 수 없어요. (' + (extOf(file.name) || file.name) + ')'); return; }   // v8.0: 보던 문서는 그대로
      opToken++; showViewer(); setViewMode('pdf'); fnameLabel.textContent = file.name; showError('이 형식은 뷰어에서 열 수 없어요.', extOf(file.name) || file.name); return;
    }
    beginOpen(); opToken++;
    handleFile(file);
  }
  // 채팅·공유함 [뷰어로 보기]. v6.9: 같은 주소로 전에 연 문서면 내려받기조차 없이 저장본을 연다.
  function viewChatAttachment(att) {
    if (!att || !att.url) { toast('열 수 있는 파일이 아니에요.'); return; }
    beginOpen();                                                    // v8.0: 보던 문서는 탭으로 남긴다
    opToken++; var op = opToken; var name = att.name || '문서', src = srcBase(att.url);
    curOrig = null; curSrcFull = att.url; curPcPath = att.pc_path || null;   // O-0171: 편집하기 때 PC가 이 주소·경로에서 원본을 받는다
    showViewer(); setViewMode('pdf'); fnameLabel.textContent = name;
    showLoading('문서를 여는 중…', '문서를 불러오고 있어요.'); setProgress(15);
    DocStore.findBySrc(src).then(function (meta) {
      if (op !== opToken) return;
      if (meta) {
        var di = tabByKey(meta.key);
        if (di >= 0) { openIntent = null; hideOverlay(); showTab(di); return; }
        if (tabs.length >= MAX_TABS) { capToast(); abortOpen(); return; }
        curSrcUrl = src; openStored(meta, op, null); return;
      }
      fetch(att.url).then(function (r) { if (!r.ok) throw new Error('내려받기 실패(' + r.status + ')'); return r.blob(); })
        .then(function (blob) { if (op !== opToken) return; var f = new File([blob], name, { type: blob.type || att.mime || 'application/octet-stream' }); handleFile(f, { srcUrl: src, srcFull: att.url, pcPath: att.pc_path || null }); })
        .catch(function (e) { if (op === opToken) showError('문서를 여는 데 실패했어요.', (e && e.message) || String(e)); });
    });
  }

  // ============ v6.9 「최근 연 문서」 목록(문서 뷰어 첫 화면) ============
  var TYPE_BADGE = { hwp: ['HWP', 't-hwp'], hwpx: ['HWP', 't-hwp'], pdf: ['PDF', 't-pdf'], doc: ['DOC', 't-doc'], docx: ['DOC', 't-doc'],
                     rtf: ['DOC', 't-doc'], odt: ['DOC', 't-doc'], xls: ['XLS', 't-xls'], xlsx: ['XLS', 't-xls'], csv: ['CSV', 't-xls'],
                     ods: ['XLS', 't-xls'], ppt: ['PPT', 't-ppt'], pptx: ['PPT', 't-ppt'], odp: ['PPT', 't-ppt'] };
  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date(), hm = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= day0) return '오늘 ' + hm;
    if (ts >= day0 - 86400000) return '어제 ' + hm;
    return (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '. ' : '') + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  var recentSeq = 0;
  function renderRecent() {
    var wrap = $('docRecentWrap'), list = $('docRecentList');
    if (!wrap || !list) return;
    var seq = ++recentSeq;
    DocStore.computeLimit().then(DocStore.list).then(function (items) {
      if (seq !== recentSeq) return;
      if (!items.length) { wrap.style.display = 'none'; list.innerHTML = ''; return; }
      var total = 0; items.forEach(function (m) { total += (m.bytes || 0); });
      wrap.style.display = '';
      var info = $('docRecentInfo'); if (info) info.textContent = items.length + '개';
      var cap = $('docRecentCap');
      if (cap) cap.textContent = '이 기기에 ' + fmtSize(total) + ' 보관 · 최대 ' + fmtSize(DocStore.limit()) + '·' + DocStore.MAX_COUNT + '개, 넘치면 오래 안 연 것부터 자동 정리';
      list.innerHTML = items.map(function (m) {
        var b = TYPE_BADGE[m.ext || extOf(m.name)] || [String(m.ext || '문서').toUpperCase().slice(0, 4), 't-etc'];
        var bits = [fmtWhen(m.openedAt)];
        if (m.kind === 'excel') bits.push('표로 보기'); else if (m.pages) bits.push(m.pages + '쪽');
        if (m.size) bits.push(fmtSize(m.size));
        var last = (m.kind !== 'excel' && m.lastPage > 1) ? '<span class="dv-rlast">📖 ' + m.lastPage + '쪽까지 보셨어요</span>' : '';
        return '<div class="dv-ritem' + (m.fav ? ' fav' : '') + '" data-key="' + esc(m.key) + '">' +
          '<button class="dv-rmain" data-act="open" type="button">' +
            '<span class="dv-rbadge ' + b[1] + '">' + esc(b[0]) + '</span>' +
            '<span class="dv-rtx"><span class="dv-rname">' + esc(m.name) + '</span>' +
            '<span class="dv-rsub">' + esc(bits.join(' · ')) + '</span>' + last + '</span>' +
          '</button>' +
          '<button class="dv-ract dv-rfav' + (m.fav ? ' on' : '') + '" data-act="fav" type="button" aria-label="' + (m.fav ? '즐겨찾기 풀기' : '즐겨찾기(자동 정리 안 함)') + '">' + (m.fav ? '★' : '☆') + '</button>' +
          '<button class="dv-ract" data-act="del" type="button" aria-label="목록에서 지우기"><svg><use href="#i-trash"/></svg></button>' +
        '</div>';
      }).join('');
    });
  }
  function askThen(title, msg, label, fn, opts) {   // opts.positive: 지우기가 아닌 여는 동작 → 빨간 휴지통 대신 보통 버튼(v8.7)
    if (confirmFn) { try { confirmFn(title, msg, label, fn, opts); return; } catch (e) {} }
    fn();   // 확인 시트가 없으면(시험용 단독 화면) 바로 실행 — confirm() 은 쓰지 않는다
  }
  function onRecentClick(ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-act]') : null;
    var row = btn && btn.closest('.dv-ritem');
    if (!btn || !row) return;
    var key = row.getAttribute('data-key'), act = btn.getAttribute('data-act');
    if (act === 'open') {
      openRecentKey(key);
    } else if (act === 'fav') {
      DocStore.get(key).then(function (meta) {
        if (!meta) return;
        DocStore.touch(key, { fav: !meta.fav }).then(function () {
          renderRecent(); toast(meta.fav ? '즐겨찾기를 풀었어요.' : '즐겨찾기 했어요. 자동 정리에서 빠져요.');
        });
      });
    } else if (act === 'del') {
      DocStore.get(key).then(function (meta) {
        if (!meta) { renderRecent(); return; }
        askThen('이 문서를 목록에서 지울까요?', '「' + meta.name + '」 — 이 기기에 저장해 둔 사본(' + fmtSize(meta.bytes) + ')만 지워요. 원래 파일은 그대로예요.', '지우기', function () {
          DocStore.del(key).then(function () { renderRecent(); toast('목록에서 지웠어요.'); });
        });
      });
    }
  }
  function onRecentClear() {
    DocStore.usage().then(function (u) {
      if (!u.count) { renderRecent(); return; }
      askThen('최근 연 문서를 모두 비울까요?', u.count + '개(' + fmtSize(u.bytes) + ')를 이 기기에서 지워요. 즐겨찾기도 함께 지워지고, 원래 파일은 그대로예요.', '모두 비우기', function () {
        DocStore.clearAll().then(function () { renderRecent(); toast('최근 연 문서를 비웠어요.'); });
      });
    });
  }

  // ============ 초기화 ============
  function init(opts) {
    opts = opts || {};
    if (opts.toast) toast = opts.toast;
    if (opts.confirm) confirmFn = opts.confirm;          // v6.9: 앱 확인 시트(openSheet)
    rootEl = $('docRoot'); viewerEl = $('viewer'); overlay = $('docOverlay'); panel = $('docPanel'); fileInput = $('docFileInput');
    pagesEl = $('pages'); tableviewEl = $('tableview'); sheetBar = $('sheetBar'); sheetSel = $('sheetSel'); xlToggleBtn = $('dvXlToggle');
    pageNavGrp = $('pageNavGrp'); scroller = $('scroller'); pageBadge = $('dvBadge'); fnameLabel = $('dvFname');
    prevBtn = $('dvPrev'); nextBtn = $('dvNext'); darkBtn = $('dvDark'); rotateBtn = $('dvRotate'); slideshowBtn = $('dvSlideshow'); fullscreenBtn = $('dvFullscreen'); layoutBtn = $('layoutBtn');
    ssEl = $('slideshow'); ssStage = $('ssStage'); ssWrap = $('ssWrap'); ssCanvas = $('ssCanvas'); ssTitle = $('ssTitle'); ssBadge = $('ssBadge');
    ssExitBtn = $('ssExit'); ssPrevBtn = $('ssPrev'); ssNextBtn = $('ssNext'); ssPlayBtn = $('ssPlay'); ssLoopBtn = $('ssLoop'); ssRotateBtn = $('ssRotate'); ssIntervalSel = $('ssInterval');
    ssCtlShow = $('ssCtlShow'); ssCtlPage = $('ssCtlPage'); ssPrevPBtn = $('ssPrevP'); ssNextPBtn = $('ssNextP'); ssZoomInBtn = $('ssZoomIn'); ssZoomOutBtn = $('ssZoomOut'); ssFitBtn = $('ssFit'); ssFlipBtn = $('ssFlip'); flipStageEl = $('flipStage'); flipHintEl = $('flipHint');

    // v8.0(O-0153) 탭 띠·파일 더 열기 시트
    tabsEl = $('dvTabs'); tabListEl = $('dvTabList'); tabAddBtn = $('dvTabAdd'); sheetEl = $('dvSheet');
    initTabs();
    if (typeof opts.ask === 'function') askHandler = opts.ask;      // v8.1(O-0154) 케이에게 묻기 — 보내기는 app.js
    initAsk();
    if (opts.edit) editOpts = opts.edit;                            // O-0171 PC에서 편집하기 — {download(url,name)}
    initEdit();

    // 야간 초기화
    (function () { var on = false; try { on = localStorage.getItem(DARK_STORE) === '1'; } catch (e) {} applyDark(on); })();

    if ($('docPickBtn')) $('docPickBtn').addEventListener('click', function () { if (fileInput) fileInput.click(); });
    // v6.9: 최근 연 문서 목록
    if ($('docRecentList')) $('docRecentList').addEventListener('click', onRecentClick);
    if ($('docRecentClear')) $('docRecentClear').addEventListener('click', onRecentClear);
    DocStore.persist();
    renderRecent();
    if (fileInput) fileInput.addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) handleLocalFile(f); });

    $('dvBack').onclick = backAction;
    $('dvZoomIn').onclick = function () { if (viewMode === 'table') stepTableFont(1.15); else stepZoom(1.25); };
    $('dvZoomOut').onclick = function () { if (viewMode === 'table') stepTableFont(1 / 1.15); else stepZoom(0.8); };
    $('zoomFit').onclick = function () { if (viewMode === 'table') { tableFontPx = tableFontBase(); applyTableFont(); return; } userZoom = 1; applyZoom(); };
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
    showPick: backAction,                  // v8.0: 뒤로 = 시트 닫기 → 여는 중 취소 → 뷰어 닫기(뷰어가 닫혀 있으면 예전과 동일)
    handleLocalFile: handleLocalFile,
    viewChatAttachment: viewChatAttachment,
    isViewable: isViewable, extOf: extOf,
    isViewerOpen: function () { return !!(rootEl && rootEl.classList.contains('on')); },
    isFullscreen: function () { return ssOpen; },
    closeFullscreen: closeSlideshow,
    leave: function () { closeSlideshow(); leaveViewer(); },
    openRemote: editOpenRemote,            // v8.7(O-0173): 홈 「PC 화면」 — 크롬 원격 데스크톱 앱(없으면 스토어)·PC판은 원격 데스크톱 웹
    askContext: askContext,                // v8.1(O-0154) 점검용 — 보던 문서·쪽·보낼 파일
    checkRef: checkRef,                    // v8.1: PC 변환본이 서버에 아직 있나(있으면 다시 올리지 않음)
    setAskHandler: function (fn) { askHandler = (typeof fn === 'function') ? fn : null; updateAskBtn(); },
    editState: function () { return { ctx: editCtx ? { name: editCtx.name, ext: editCtx.ext, step: editCtx.step || 0 } : null, sessions: editsLoad() }; },   // O-0171 점검용
    openTabs: function () { return tabs.map(function (t) { return { name: t.name, kind: t.kind, active: t === activeTab(), live: t.id === liveTabId }; }); },   // v8.0 점검용
    renderRecent: renderRecent,            // v6.9: 최근 연 문서 목록 다시 그리기
    _store: DocStore                       // v6.9: 점검용(저장 개수·용량 확인) — 화면 기능과 무관
  };
})(window);
