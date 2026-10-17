/* ============================================================================
 * markup.js — O-0544 문서 뷰어 「수정 요청」(v9.15)
 *   문서 위에 동그라미·밑줄로 고칠 곳을 표시하고 메모(글·말)를 남겨 [PC로 보내기] → PC가 원본의 사본을 고쳐 채팅으로.
 *   · 뷰어(docviewer.js)가 SmartMarkup.open({pdfDoc, doc, page})로 연다. 표시 화면은 뷰어 위에 겹치는 자체 화면(#mkRoot):
 *     위 붉은 띠 + [? 사용법] + [펜|손] / 쪽 그림(자체 렌더) + 표시층(SVG) / 아래 [수정 요청 N건][PC로 보내기][끝내기].
 *   · 좌표는 PDF 단위(scale 1, 왼쪽 위 원점) — 확대·폭과 상관없다. 글자는 PDF.js getTextContent, 표 칸은 그 쪽의 선(그리기 명령)으로 짐작.
 *   · 보관: 이 기기 IndexedDB(문서 키별, 7일). 보내기·취소·상태는 app.js 가 준 host(send·cancel·status·openChat).
 *   · 되돌리기: MARKUP_ON = 'off' → [고치기]에 「표시해서 요청하기」가 안 보이고 길게 누르기도 꺼짐(지금의 [편집하기]와 같아짐).
 * ==========================================================================*/
(function (global) {
  'use strict';
  var MARKUP_ON = 'on';
  var LP_KEY = 'smart_markup_longpress', HELP_KEY = 'smart_markup_help_seen_v1', KEEP_MS = 7 * 24 * 3600 * 1000;
  var NS = 'http://www.w3.org/2000/svg';
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function circ(n) { return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : '(' + n + ')'; }
  function reduce() { try { return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function isNative() { try { return !!(global.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (e) { return false; } }
  function vibrate() { try { if (isNative() && Capacitor.Plugins && Capacitor.Plugins.Haptics) { Capacitor.Plugins.Haptics.vibrate({ duration: 30 }); return; } if (navigator.vibrate) navigator.vibrate(30); } catch (e) {} }

  var host = {};          // app.js: send(payload)→Promise{rid}, cancel(rid)→Promise, status(rids)→Promise{rid:{status,job_status}}, openChat()
  var R = null;           // 화면 요소 묶음
  var S = { zoom: 1, on: false, tool: 'pen', items: [], sent: [], sel: null, pages: [], pdf: null, d: null, memo: null, lp: null };

  /* ---------------- 보관(IndexedDB) ---------------- */
  var DB = (function () {
    var p = null;
    function open() {
      if (p) return p;
      p = new Promise(function (res, rej) {
        try {
          var rq = indexedDB.open('smart_markup', 1);
          rq.onupgradeneeded = function () { rq.result.createObjectStore('docs', { keyPath: 'key' }); };
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        } catch (e) { rej(e); }
      });
      return p;
    }
    function tx(mode, fn) { return open().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('docs', mode); var st = t.objectStore('docs'); var r = fn(st); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
    return {
      get: function (key) { return tx('readonly', function (st) { return st.get(key); }).then(function (v) { return (v && Date.now() - (v.ts || 0) < KEEP_MS) ? v : null; }).catch(function () { return null; }); },
      put: function (v) { v.ts = Date.now(); return tx('readwrite', function (st) { return st.put(v); }).catch(function () {}); },
      del: function (key) { return tx('readwrite', function (st) { return st.delete(key); }).catch(function () {}); }
    };
  })();
  function persist() {
    if (!S.d || !S.d.key) return;
    DB.put({ key: S.d.key, name: S.d.name, items: S.items.map(function (x) { var o = {}; for (var k in x) if (x.hasOwnProperty(k)) o[k] = x[k]; return o; }), sent: S.sent });
    renderViewerStrip();
  }

  /* ---------------- 화면 만들기 ---------------- */
  var HTML =
    '<div class="mk-top"><button class="mk-tbtn" data-a="end" aria-label="끝내기">‹</button><div class="mk-fname" id="mkName"></div><button class="mk-tbtn mk-z" data-a="zout" aria-label="작게 보기">－</button><button class="mk-tbtn mk-z" data-a="zin" aria-label="크게 보기">＋</button><div class="mk-pgno" id="mkPg"></div><button class="mk-tbtn mk-chatbtn" data-a="gochat" aria-label="채팅으로 가기" title="채팅으로">💬</button></div>' +
    '<div class="mk-band"><div class="mk-band-row"><div class="mk-band-title">✏️ 수정 요청</div>' +
    '<button class="mk-help" data-a="help" aria-label="사용법">? 사용법</button>' +
    '<div class="mk-seg" id="mkSeg" role="group" aria-label="펜 손 바꾸기"><div class="mk-knob"></div><button id="mkPen" class="on" aria-pressed="true">펜</button><button id="mkHand" aria-pressed="false">손</button></div></div>' +
    '<div class="mk-band-hint"><span class="mk-state" id="mkState">펜 · 그리는 중</span> — <span id="mkHint">고칠 곳에 동그라미를 치거나 밑줄을 그어 주세요</span></div></div>' +
    '<div class="mk-strip mk-sent" id="mkSent"><span class="mk-grow" id="mkSentTxt"></span><button class="mk-job" data-a="jobs">작업 현황</button><button data-a="cancelreq">요청 취소</button></div>' +
    '<div class="mk-strip mk-done" id="mkDone"><span class="mk-grow" id="mkDoneTxt"></span><button data-a="chat">채팅 보기</button><button data-a="cleardone">목록 비우기</button></div>' +
    '<div class="mk-main"><div class="mk-area" id="mkArea">' +
    '<div class="mk-chips" id="mkChips"><div class="mk-lab" id="mkChipLab"></div><div class="mk-chiprow">' +
    '<button class="mk-chip on" data-pick="cells">잡힌 칸만</button><button class="mk-chip" data-pick="row">이 행 전체</button><button class="mk-chip" data-pick="col">이 열 전체</button><button class="mk-chip" data-pick="table">표 전체</button></div></div>' +
    '<div class="mk-scroll" id="mkScroll"></div><div class="mk-flash" id="mkFlash"></div>' +
    '<div class="mk-k hidden" id="mkK"><img id="mkKImg" alt=""><div class="mk-kbub" id="mkKBub" role="status"></div></div>' +
    '</div><aside class="mk-side" id="mkSide"><div class="mk-sh">수정 요청 <b id="mkSideN">0</b></div><div class="mk-slist" id="mkSideList"></div><div class="mk-smemo" id="mkSideMemo"></div>' +
    '<div class="mk-sfoot"><button class="mk-big" style="width:100%" data-a="send" id="mkSideSend">PC로 보내기</button></div></aside></div>' +
    '<div class="mk-dock"><button class="mk-dbtn count" data-a="list" id="mkCount">수정 요청 <b id="mkN">0</b>건 ▾</button><button class="mk-dbtn send" data-a="send">PC로 보내기</button><button class="mk-dbtn end" data-a="end">끝내기</button></div>' +
    '<div class="mk-sheet" id="mkMemoSheet"><div class="mk-panel" id="mkMemoPanel"></div></div>' +
    '<div class="mk-sheet" id="mkListSheet"><div class="mk-panel"><div class="mk-ptitle"><span class="mk-grow">수정 요청 <span id="mkListN">0</span>건</span></div><div id="mkListBody" style="display:flex;flex-direction:column;gap:8px"></div>' +
    '<button class="mk-big" data-a="send" id="mkListSend">PC로 보내기</button><button class="mk-close" data-close>닫기</button></div></div>' +
    '<div class="mk-sheet" id="mkAskSheet"><div class="mk-panel" id="mkAskPanel"></div></div>' +
    '<div class="mk-sheet" id="mkHelp"><div class="mk-panel" style="max-width:440px"><div class="mk-ptitle"><span class="mk-grow">수정 요청 사용법</span><span class="mk-pnote" id="mkHCount"></span></div>' +
    '<div class="mk-hstage" id="mkHStage"><div class="mk-htrack" id="mkHTrack"></div></div><div class="mk-hdots" id="mkHDots"></div>' +
    '<div class="mk-row2"><button class="mk-close" id="mkHPrev">‹ 앞</button><button class="mk-big" id="mkHNext">다음 ›</button></div><button class="mk-close" id="mkHClose">닫기</button></div></div>' +
    '<div class="mk-toast" id="mkToast"><span id="mkToastTxt"></span><button id="mkToastBtn" style="display:none"></button></div>';

  function build() {
    if (R) return;
    var dr = $('docRoot'); if (!dr) return;
    var el = doc.createElement('div'); el.id = 'mkRoot'; el.innerHTML = HTML; dr.appendChild(el);
    R = { root: el, scroll: $('mkScroll'), area: $('mkArea') };
    el.addEventListener('click', onClick);
    $('mkPen').onclick = function () { setTool('pen'); };
    $('mkHand').onclick = function () { setTool('hand'); };
    Array.prototype.forEach.call(el.querySelectorAll('.mk-chip'), function (b) { b.onclick = function () { pickChip(b.getAttribute('data-pick')); }; });
    Array.prototype.forEach.call(el.querySelectorAll('.mk-sheet'), function (s) {
      s.addEventListener('click', function (e) {
        if (e.target === s || (e.target.hasAttribute && e.target.hasAttribute('data-close'))) {
          if (s.id === 'mkHelp') { closeHelp(); return; }
          s.classList.remove('on');
          if (s.id === 'mkMemoSheet') { stopMic(true); S.memo = null; if (S.sel) showPop(); }
        }
      });
    });
    bindInput();
    buildHelp();
    $('mkHPrev').onclick = function () { showHelp(hIdx - 1); };
    $('mkHNext').onclick = function () { if (hIdx === HELP.length - 1) closeHelp(); else showHelp(hIdx + 1); };
    $('mkHClose').onclick = closeHelp;
    (function () { var st = $('mkHStage'), x0 = null; st.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
      st.addEventListener('pointerup', function (e) { if (x0 === null) return; var dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) showHelp(hIdx + (dx < 0 ? 1 : -1)); }); })();
    R.scroll.addEventListener('scroll', function () { updPg(); }, { passive: true });
    var rT = null;
    if (global.ResizeObserver) new ResizeObserver(function () { clearTimeout(rT); rT = setTimeout(layout, 120); }).observe(R.scroll);
  }
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-a]') : null; if (!b || !R.root.contains(b)) return;
    var a = b.getAttribute('data-a');
    if (a === 'end') close();
    else if (a === 'zin') setZoom(S.zoom * 1.4);
    else if (a === 'zout') setZoom(S.zoom / 1.4);
    else if (a === 'help') help(0);
    else if (a === 'list') { renderAll(); openSheet('mkListSheet'); }
    else if (a === 'send') trySend();
    else if (a === 'cancelreq') askCancel();
    else if (a === 'jobs' || a === 'chat' || a === 'gochat') goChat();
    else if (a === 'cleardone') { S.items = S.items.filter(function (x) { return x.status !== 'done'; }); S.sent = S.sent.filter(function (s) { return s.state !== 'done'; }); persist(); renderAll(); toast('끝난 요청을 목록에서 뺐습니다'); }
  }

  /* ---------------- 알림·케이 ---------------- */
  var toastT = null;
  function toast(msg, btnLabel, btnFn, ms) {
    if (!R) return;
    $('mkToastTxt').textContent = msg; var b = $('mkToastBtn');
    if (btnLabel) { b.style.display = ''; b.textContent = btnLabel; b.onclick = function () { hideToast(); if (btnFn) btnFn(); }; } else b.style.display = 'none';
    $('mkToast').classList.add('on'); clearTimeout(toastT); toastT = setTimeout(hideToast, ms || 2600);
  }
  function hideToast() { if (R) $('mkToast').classList.remove('on'); }
  function kImg(pose) {
    var K = global.KChar; if (!K) return { src: '', cut: false };
    var u = K.poseUrl ? K.poseUrl(pose) : ''; if (u) return { src: u, cut: true };
    var map = { note: 'neutral', report: 'smile', guide: 'smile' };
    return { src: K.exprUrl ? K.exprUrl(map[pose] || 'smile') : '', cut: false };
  }
  function kSay(text, pose, state) {
    if (!R) return;
    var f = $('mkK'), b = $('mkKBub'), im = $('mkKImg'), k = kImg(pose || 'note');
    if (k.src && im.getAttribute('src') !== k.src) im.setAttribute('src', k.src);
    f.classList.toggle('photo', !k.cut); im.style.display = k.src ? '' : 'none';
    b.textContent = text; b.classList.remove('say'); void b.offsetWidth; if (!reduce()) b.classList.add('say');
    f.classList.remove('hidden', 'aside'); if (state) f.classList.add(state);
  }
  function kAside() { if (R) $('mkK').classList.add('aside'); }
  function kHide() { if (R) $('mkK').classList.add('hidden'); }

  /* ---------------- 열기·닫기 ---------------- */
  // opts: {pdfDoc, doc:{name,ext,key,pages,src,srcHow,orig}, page, how:'sheet'|'long', lp:{x,y,id}}
  function open(opts) {
    if (MARKUP_ON !== 'on' || !opts || !opts.pdfDoc) return false;
    build(); if (!R) return false;
    var rs = opts.restore || null;            // O-0548: 채팅에 다녀왔을 때 — 같은 쪽 · 같은 확대 · 같은 펜/손 · 적던 메모
    S.pdf = opts.pdfDoc; S.d = opts.doc || {}; S.on = true; S.sel = null; S.memo = null; S.zoom = (rs && rs.zoom) || 1;
    $('mkName').textContent = S.d.name || '문서';
    R.root.classList.add('on');
    setTool((rs && rs.tool) || 'pen', true);
    buildPages(opts.page || 1, opts.anchor || (rs ? { ptTop: rs.off || 0, left: rs.left || 0 } : null));
    return DB.get(S.d.key).then(function (v) {
      S.items = (v && v.items) || []; S.sent = (v && v.sent) || [];
      renderAll(); refreshStatus();
      if (!reduce()) { var f = $('mkFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
      var pend = S.items.filter(notSent).length;
      if (!rs) kSay(pend ? '이어서 적어 주세요. 적어 둔 ' + pend + '건은 그대로 있습니다' : '어디를 고칠까요? 동그라미 쳐 주세요', 'note');
      if (opts.how === 'long') { vibrate(); toast('수정 요청을 켰습니다', '끄기', close, 3000); }
      if (rs && rs.memo && rs.memo.item) setTimeout(function () {          // 적던 메모 다시 펼치기 — 고치던 것이면 보관된 그 항목에(사본 말고)
        if (!S.on) return;
        var real = rs.memo.isNew ? null : S.items.filter(function (x) { return x.n === rs.memo.item.n && !x.status; })[0];
        openMemo(real || rs.memo.item, { text: rs.memo.text, isNew: !real });
      }, 300);
      if (!rs && lsGet(HELP_KEY, '') !== '1') { lsSet(HELP_KEY, '1'); if (opts.how === 'long') S.helpPending = true; else setTimeout(function () { help(0); }, 250); }
      if (statusT) clearInterval(statusT);
      statusT = setInterval(refreshStatus, 20000);
      return true;
    });
  }
  var statusT = null;
  function close(o) {
    if (!R || !S.on) return;
    var quiet = !!(o && o.quiet);
    var n = S.items.filter(notSent).length;
    stopMic(true); clearSel(); closeSheets(); kHide();
    S.on = false; R.root.classList.remove('on');
    if (statusT) { clearInterval(statusT); statusT = null; }
    if (io) { io.disconnect(); io = null; }
    R.scroll.innerHTML = ''; S.pages = [];
    renderViewerStrip();
    if (n && host.toast && !quiet) host.toast('적어 둔 수정 요청 ' + n + '건은 남겨 두겠습니다');
  }
  // O-0548 채팅으로 가기 — 뷰어가 지금 자리(쪽 · 확대 · 이 화면이면 펜/손 · 적던 메모)를 적어 두고 채팅을 연다. 돌아오면 그대로.
  function goChat() { stopMic(true); if (host.goChat) host.goChat(); }
  function snap() {
    if (!S.on || !S.pages.length) return null;
    var sc = R.scroll, top = sc.scrollTop + 1, P = S.pages[0];
    S.pages.forEach(function (Q) { if (Q.el.offsetTop <= top) P = Q; });
    var m = null;
    if (S.memo && S.memo.item && $('mkMemoTxt')) {
      var it = {}; for (var k in S.memo.item) if (S.memo.item.hasOwnProperty(k)) it[k] = S.memo.item[k];
      m = { item: it, text: $('mkMemoTxt').value, isNew: !S.memo.edit };
    }
    return { page: P.n, off: (sc.scrollTop - P.el.offsetTop) / (P.scale || 1), left: sc.scrollLeft, zoom: S.zoom || 1, tool: S.tool, memo: m };
  }
  function back() {
    if (!R || !S.on) return false;
    if ($('mkHelp').classList.contains('on')) { closeHelp(); return true; }
    if (S.memo && S.memo.side) { closeMemo(); if (S.sel) showPop(); return true; }
    var o = R.root.querySelector('.mk-sheet.on'); if (o) { o.classList.remove('on'); if (o.id === 'mkMemoSheet') { stopMic(true); S.memo = null; if (S.sel) showPop(); } return true; }
    if (S.sel) { clearSel(); return true; }
    close(); return true;
  }
  function setTool(t, quiet) {
    S.tool = t; var seg = $('mkSeg');
    seg.classList.toggle('hand', t === 'hand'); $('mkPen').classList.toggle('on', t === 'pen'); $('mkHand').classList.toggle('on', t === 'hand');
    $('mkPen').setAttribute('aria-pressed', t === 'pen'); $('mkHand').setAttribute('aria-pressed', t === 'hand');
    $('mkState').textContent = t === 'pen' ? '펜 · 그리는 중' : '손 · 넘겨 보는 중'; $('mkState').classList.toggle('hand', t === 'hand');
    $('mkHint').textContent = t === 'pen' ? '고칠 곳에 동그라미를 치거나 밑줄을 그어 주세요' : '한 손가락으로 넘겨 보세요. 그리려면 [펜]';
    R.scroll.classList.toggle('pen', S.on && t === 'pen');
    if (S.on && !quiet) kSay(t === 'pen' ? '어디를 고칠까요? 동그라미 쳐 주세요' : '넘겨 보시다가 [펜]을 누르고 표시해 주세요', 'note');
  }
  function notSent(x) { return !x.status; }

  /* ---------------- 쪽 그리기(자체 렌더 · 지연) ---------------- */
  var io = null;
  function buildPages(startPage, anchor) {
    R.scroll.innerHTML = ''; S.pages = [];
    if (io) io.disconnect();
    io = new IntersectionObserver(function (ents) { ents.forEach(function (en) { var P = S.pages[+en.target.dataset.n - 1]; if (!P) return; if (en.isIntersecting) renderPage(P); else unrender(P); }); },
      { root: R.scroll, rootMargin: '900px 0px' });
    var n = S.pdf.numPages;
    S.pdf.getPage(1).then(function (p1) {
      var vp1 = p1.getViewport({ scale: 1 });
      for (var i = 1; i <= n; i++) {
        var el = doc.createElement('div'); el.className = 'mk-pg'; el.dataset.n = i;
        var svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mk-ov'); svg.setAttribute('preserveAspectRatio', 'none');
        el.appendChild(svg); R.scroll.appendChild(el);
        var P = { n: i, el: el, svg: svg, w: vp1.width, h: vp1.height, scale: 0, page: null, chars: null, charsP: null, segsP: null, rendered: false };
        svg.setAttribute('viewBox', '0 0 ' + P.w + ' ' + P.h);
        S.pages.push(P);
      }
      layout();
      S.pages.forEach(function (P) { io.observe(P.el); });
      var P0 = S.pages[Math.max(0, Math.min(n, startPage) - 1)];
      if (P0) requestAnimationFrame(function () {
        var y = P0.el.offsetTop - 10;
        if (anchor && anchor.ptTop != null) { y = P0.el.offsetTop + anchor.ptTop * P0.scale; R.scroll.scrollLeft = anchor.left || 0; }   // O-0548 채팅에서 돌아옴
        else if (anchor && anchor.ptY != null && anchor.clientY != null) {   // 길게 누른 자리가 손가락 밑에 오게
          var r = R.scroll.getBoundingClientRect();
          y = P0.el.offsetTop + anchor.ptY * P0.scale - (anchor.clientY - r.top);
        }
        R.scroll.scrollTop = Math.max(0, y); updPg();
      });
      renderAll();
    });
  }
  function layout() {
    if (!S.on || !S.pages.length) return;
    var avail = R.scroll.clientWidth - 16;
    S.pages.forEach(function (P) {
      var wcss = Math.min(avail, 1100) * (S.zoom || 1), sc = wcss / P.w;
      P.el.style.width = wcss + 'px'; P.el.style.height = (P.h * sc) + 'px';
      if (Math.abs(sc - P.scale) > 0.01) { P.scale = sc; if (P.rendered) { unrender(P); renderPage(P); } }
    });
    if (S.items.length) renderAll();
    if (S.sel) drawSel();
    placePop();
  }
  // 크게 · 작게(1~3배). 화면 가운데 보던 자리를 그대로 두고 다시 그린다. 펜 좌표는 PDF 단위라 그대로 맞는다.
  function setZoom(z, ax, ay) {          // ax·ay: 고정할 화면 점(핀치 가운데 · 두 번 톡 한 곳). 없으면 화면 가운데
    z = Math.max(1, Math.min(3, Math.round(z * 100) / 100)); if (Math.abs(z - (S.zoom || 1)) < 0.01 || !S.on) return;
    var sc = R.scroll, rc = sc.getBoundingClientRect();
    var ox = (ax == null ? sc.clientWidth / 2 : ax - rc.left), oy = (ay == null ? sc.clientHeight / 2 : ay - rc.top);
    var ry = (sc.scrollTop + oy) / Math.max(1, sc.scrollHeight), rx = (sc.scrollLeft + ox) / Math.max(1, sc.scrollWidth);
    S.zoom = z; layout();
    sc.scrollTop = ry * sc.scrollHeight - oy; sc.scrollLeft = rx * sc.scrollWidth - ox;
    toast(z <= 1.01 ? '폭에 맞췄습니다' : Math.round(z * 100) + '%로 보고 있습니다', null, null, 1200);
  }
  function getPage(P) { if (P.page) return Promise.resolve(P.page); return S.pdf.getPage(P.n).then(function (pg) { P.page = pg; var vp = pg.getViewport({ scale: 1 }); if (Math.abs(vp.width - P.w) > 0.5 || Math.abs(vp.height - P.h) > 0.5) { P.w = vp.width; P.h = vp.height; P.svg.setAttribute('viewBox', '0 0 ' + P.w + ' ' + P.h); layout(); } return pg; }); }
  function renderPage(P) {
    if (P.rendered || P.rendering) return;
    P.rendering = true;
    getPage(P).then(function (pg) {
      var dpr = Math.min(global.devicePixelRatio || 1, 2.5, 4 / (S.zoom || 1)), vp = pg.getViewport({ scale: P.scale * dpr });
      var cv = doc.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      P.el.insertBefore(cv, P.svg); P.cv = cv;
      return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { P.rendered = true; P.rendering = false; });
    }).catch(function () { P.rendering = false; });
  }
  function unrender(P) { if (P.cv) { try { P.cv.remove(); } catch (e) {} P.cv = null; } P.rendered = false; P.rendering = false; }
  function updPg() {
    if (!S.on) return;
    var mid = R.scroll.scrollTop + R.scroll.clientHeight / 3, n = 1;
    S.pages.forEach(function (P) { if (P.el.offsetTop <= mid) n = P.n; });
    $('mkPg').textContent = n + ' / ' + S.pages.length;
  }

  /* ---------------- 글자·표 칸 ---------------- */
  function loadChars(P) {
    if (P.charsP) return P.charsP;
    P.charsP = getPage(P).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
      var vp = P.page.getViewport({ scale: 1 }), chars = [], prev = null, word = -1, line = -1;
      tc.items.forEach(function (it) {
        if (!it.str) return;
        var tx = global.pdfjsLib.Util.transform(vp.transform, it.transform);
        var fh = Math.hypot(tx[2], tx[3]) || 10, x = tx[4], yb = tx[5], n = it.str.length, cw = (it.width || fh * n * 0.9) / n;
        for (var i = 0; i < n; i++) {
          var ch = it.str[i], x0 = x + i * cw;
          if (/\s/.test(ch)) { if (prev) prev.brk = true; continue; }
          var c = { c: ch, x0: x0, x1: x0 + cw, y0: yb - fh * 0.88, y1: yb + fh * 0.18, yb: yb, fh: fh };
          var nl = !prev || Math.abs(prev.yb - yb) > fh * 0.5 || x0 < prev.x0 - fh * 2;
          if (nl) line++;
          if (!prev || nl || prev.brk || (x0 - prev.x1) > fh * 0.32) word++;
          c.w = word; c.l = line; c.i = chars.length; chars.push(c); prev = c;
        }
      });
      var s = '', pos = [];
      chars.forEach(function (c, i) { if (i && chars[i - 1].w !== c.w) s += ' '; pos.push(s.length); s += c.c; });
      P.chars = chars; P.text = s; P.pos = pos;
      P.textRight = chars.reduce(function (m, c) { return Math.max(m, c.x1); }, 0);
      P.lineH = chars.length ? chars[0].y1 - chars[0].y0 : 10;
      return chars;
    }).catch(function () { P.chars = []; P.text = ''; P.pos = []; return []; });
    return P.charsP;
  }
  // 표 칸: 그 쪽 그리기 명령의 가로·세로 선을 모아 「점을 둘러싼 칸」을 찾는다(PDF 에는 표 구조가 없어 짐작 — PC가 원본 표에서 확정)
  function loadSegs(P) {
    if (P.segsP) return P.segsP;
    P.segsP = getPage(P).then(function (pg) { return pg.getOperatorList(); }).then(function (ol) {
      var OPS = global.pdfjsLib.OPS, vp = P.page.getViewport({ scale: 1 }), H = [], V = [];
      var ctm = [1, 0, 0, 1, 0, 0], stack = [];
      function mul(m1, m2) { return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]]; }
      function pt(x, y) { var a = global.pdfjsLib.Util.applyTransform([x, y], ctm); return global.pdfjsLib.Util.applyTransform(a, vp.transform); }
      function seg(a, b) {
        var dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
        if (dy < 1.2 && dx > 3) H.push([(a[1] + b[1]) / 2, Math.min(a[0], b[0]), Math.max(a[0], b[0])]);
        else if (dx < 1.2 && dy > 3) V.push([(a[0] + b[0]) / 2, Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
      }
      for (var i = 0; i < ol.fnArray.length && i < 60000; i++) {
        var fn = ol.fnArray[i], args = ol.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = mul(ctm, args);
        else if (fn === OPS.constructPath) {
          var ops = args[0], c = args[1], k = 0, cur = null, start = null;
          for (var j = 0; j < ops.length; j++) {
            var o = ops[j];
            if (o === OPS.moveTo) { cur = start = pt(c[k], c[k + 1]); k += 2; }
            else if (o === OPS.lineTo) { var nx = pt(c[k], c[k + 1]); k += 2; if (cur) seg(cur, nx); cur = nx; }
            else if (o === OPS.rectangle) {
              var x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
              var p1 = pt(x, y), p2 = pt(x + w, y), p3 = pt(x + w, y + h), p4 = pt(x, y + h);
              var bw = Math.abs(p1[0] - p3[0]), bh = Math.abs(p1[1] - p3[1]);
              if (bh < 2.5 && bw > 3) H.push([(p1[1] + p3[1]) / 2, Math.min(p1[0], p3[0]), Math.max(p1[0], p3[0])]);
              else if (bw < 2.5 && bh > 3) V.push([(p1[0] + p3[0]) / 2, Math.min(p1[1], p3[1]), Math.max(p1[1], p3[1])]);
              else { seg(p1, p2); seg(p2, p3); seg(p3, p4); seg(p4, p1); }
            }
            else if (o === OPS.curveTo) { k += 6; } else if (o === OPS.curveTo2 || o === OPS.curveTo3) { k += 4; }
            else if (o === OPS.closePath) { if (cur && start) seg(cur, start); cur = start; }
          }
        }
      }
      P.H = H; P.V = V;
      return true;
    }).catch(function () { P.H = []; P.V = []; return false; });
    return P.segsP;
  }
  function cellAt(P, x, y) {
    if (!P.H || !P.V || !P.H.length || !P.V.length) return null;
    var L = -1, Rr = 1e9, T = -1, B = 1e9, tol = 1.5;
    P.V.forEach(function (v) { if (v[1] - tol <= y && y <= v[2] + tol) { if (v[0] < x && v[0] > L) L = v[0]; if (v[0] > x && v[0] < Rr) Rr = v[0]; } });
    P.H.forEach(function (h) { if (h[1] - tol <= x && x <= h[2] + tol) { if (h[0] < y && h[0] > T) T = h[0]; if (h[0] > y && h[0] < B) B = h[0]; } });
    if (L < 0 || T < 0 || Rr > 1e8 || B > 1e8) return null;
    if (Rr - L > P.w * 0.96 || B - T > P.h * 0.6 || Rr - L < 4 || B - T < 4) return null;
    return { b: [L, T, Rr, B], key: Math.round(L) + ',' + Math.round(T) + ',' + Math.round(Rr) + ',' + Math.round(B) };
  }
  function cellOfChar(P, c) { return cellAt(P, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2); }
  function neighbors(P, k) {
    var b = k.b, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return [cellAt(P, b[0] - 2.5, cy), cellAt(P, b[2] + 2.5, cy), cellAt(P, cx, b[1] - 2.5), cellAt(P, cx, b[3] + 2.5)].filter(Boolean);
  }
  function walk(P, base, dirs) {           // dirs: 'row' | 'col' | 'all'
    var seen = {}, out = [], q = [base]; seen[base.key] = 1;
    while (q.length && out.length < 400) {
      var k = q.shift(); out.push(k);
      var b = k.b, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, nb = [];
      if (dirs !== 'col') { nb.push(cellAt(P, b[0] - 2.5, cy)); nb.push(cellAt(P, b[2] + 2.5, cy)); }
      if (dirs !== 'row') { nb.push(cellAt(P, cx, b[1] - 2.5)); nb.push(cellAt(P, cx, b[3] + 2.5)); }
      nb.forEach(function (n) { if (n && !seen[n.key]) { seen[n.key] = 1; q.push(n); } });
    }
    return out;
  }

  /* ---------------- 손가락 입력 ---------------- */
  var ptrs = {}, stroke = null, pan = null, LP_MS = 500, TOL = 8;
  function pageAt(x, y) { var el = doc.elementFromPoint(x, y); el = el && el.closest && el.closest('.mk-pg'); return el ? S.pages[+el.dataset.n - 1] : null; }
  function toPt(P, x, y) { var r = P.svg.getBoundingClientRect(); return [(x - r.left) / r.width * P.w, (y - r.top) / r.height * P.h]; }
  function px(P, v) { return +(v / (P.scale || 1)).toFixed(2); }
  function sv(tag, attrs, parent) { var e = doc.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function clearLayer(P, cls) { Array.prototype.slice.call(P.svg.querySelectorAll('.' + cls)).forEach(function (e) { e.remove(); }); }
  function bindInput() {
    var sc = R.scroll;
    sc.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    sc.addEventListener('pointerdown', function (ev) {
      if (ev.button && ev.button !== 0) return;
      if (S.memo && S.memo.side) { ev.preventDefault(); closeMemo(); if (S.sel) showPop(); return; }
      if (ev.target.closest && (ev.target.closest('.mk-pop') || ev.target.closest('.mk-pin') || ev.target.closest('.mk-hit'))) return;
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var n = Object.keys(ptrs).length, P = pageAt(ev.clientX, ev.clientY);
      S.lp = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, P: P, t: setTimeout(onLong, LP_MS) };
      if (S.tool === 'pen') {
        if (n >= 2) { cancelStroke(); pan = { y: avgY(), x: avgX() }; cancelLP(); return; }
        if (!P) return;
        ev.preventDefault();
        try { sc.setPointerCapture(ev.pointerId); } catch (e) {}
        startStroke(P, ev.clientX, ev.clientY, ev.pointerId);
      }
    });
    sc.addEventListener('pointermove', function (ev) {
      if (!ptrs[ev.pointerId]) return;
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (S.lp && S.lp.id === ev.pointerId && Math.hypot(ev.clientX - S.lp.x, ev.clientY - S.lp.y) > TOL) cancelLP();
      if (pan) { var y = avgY(), x = avgX(); sc.scrollTop -= (y - pan.y); sc.scrollLeft -= (x - pan.x); pan.y = y; pan.x = x; return; }
      if (stroke && stroke.id === ev.pointerId) addPoint(ev.clientX, ev.clientY);
    });
    function end(ev) {
      delete ptrs[ev.pointerId];
      if (S.lp && S.lp.id === ev.pointerId) cancelLP();
      if (pan) { if (!Object.keys(ptrs).length) pan = null; return; }
      if (stroke && stroke.id === ev.pointerId) finishStroke(ev.type === 'pointercancel');
      if (S.helpPending && !Object.keys(ptrs).length) { S.helpPending = false; setTimeout(function () { help(0); }, 700); }
    }
    sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
    sc.addEventListener('touchmove', function (e) { if (S.on && S.tool === 'pen' && e.touches.length === 1) e.preventDefault(); }, { passive: false });
    // 두 손가락 벌리기·오므리기 = 크게·작게(펜·손 둘 다). 움직이는 동안은 그림만 늘였다 줄이고, 손을 떼면 그 배율로 다시 그린다.
    var pinch = null;
    function tdist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    sc.addEventListener('touchstart', function (e) {
      if (!S.on || e.touches.length !== 2) return;
      var rc = sc.getBoundingClientRect(), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinch = { d0: tdist(e.touches), z0: S.zoom || 1, cx: cx, cy: cy, k: 1 };
      sc.style.transformOrigin = (cx - rc.left) + 'px ' + (cy - rc.top) + 'px';
    }, { passive: true });
    sc.addEventListener('touchmove', function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var k = tdist(e.touches) / Math.max(1, pinch.d0), z = Math.max(1, Math.min(3, pinch.z0 * k));
      pinch.k = z / pinch.z0;
      if (Math.abs(pinch.k - 1) > 0.04) { pan = null; sc.style.transform = 'scale(' + pinch.k.toFixed(3) + ')'; }
    }, { passive: false });
    function pinchEnd(e) {
      if (!pinch || (e.touches && e.touches.length >= 2)) return;
      var p = pinch; pinch = null; sc.style.transform = ''; sc.style.transformOrigin = '';
      if (Math.abs(p.k - 1) > 0.04) setZoom(p.z0 * p.k, p.cx, p.cy);
    }
    sc.addEventListener('touchend', pinchEnd); sc.addEventListener('touchcancel', pinchEnd);
    // 손 상태에서 두 번 톡 = 크게(2배) ↔ 폭 맞춤. 펜 상태에서는 꺼 둔다(실수 방지).
    var lastTap = null;
    sc.addEventListener('pointerup', function (ev) {
      if (!S.on || S.tool !== 'hand' || ev.pointerType === 'mouse') return;
      var now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 28) {
        lastTap = null; setZoom((S.zoom || 1) > 1.2 ? 1 : 2, ev.clientX, ev.clientY); return;
      }
      lastTap = { t: now, x: ev.clientX, y: ev.clientY };
    });
  }
  function avgX() { var k = Object.keys(ptrs), s = 0; k.forEach(function (i) { s += ptrs[i].x; }); return s / Math.max(1, k.length); }
  function avgY() { var k = Object.keys(ptrs), s = 0; k.forEach(function (i) { s += ptrs[i].y; }); return s / Math.max(1, k.length); }
  function cancelLP() { if (S.lp) { clearTimeout(S.lp.t); S.lp = null; } }
  function onLong() {
    var lp = S.lp; S.lp = null; if (!lp || !lp.P) return;
    cancelStroke(); vibrate();
    var P = lp.P, pt = toPt(P, lp.x, lp.y);
    loadChars(P).then(function () {
      var c = nearestChar(P, pt); if (!c) return;
      makeTextSel(P, P.chars.filter(function (x) { return x.l === c.l; }).map(function (x) { return x.i; }));
    });
  }
  function startStroke(P, x, y, id) {
    clearSel(); kAside();
    var p = toPt(P, x, y);
    stroke = { id: id, P: P, pts: [p], el: sv('path', { 'class': 'mk-stroke', 'stroke-width': px(P, 3.4), d: 'M' + p[0] + ' ' + p[1] }, P.svg) };
    loadChars(P); loadSegs(P);
  }
  function addPoint(x, y) {
    var p = toPt(stroke.P, x, y), l = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 1.2) return;
    stroke.pts.push(p); stroke.el.setAttribute('d', stroke.el.getAttribute('d') + ' L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1));
  }
  function cancelStroke() { if (stroke) { stroke.el.remove(); stroke = null; } }
  function finishStroke(cancelled) {
    var st = stroke; stroke = null; if (!st) return;
    if (cancelled) { st.el.remove(); return; }
    var pts = st.pts, len = 0;
    for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < 6) { st.el.remove(); kSay(S.items.length ? '다른 곳도 동그라미 쳐 주세요' : '어디를 고칠까요? 동그라미 쳐 주세요', 'note'); return; }
    var a = pts[0], b = pts[pts.length - 1], closed = len > 50 && Math.hypot(a[0] - b[0], a[1] - b[1]) < Math.max(26, len * 0.22);
    var P = st.P;
    Promise.all([loadChars(P), loadSegs(P)]).then(function () {
      var ok = closed ? selectLoop(P, pts) : selectLine(P, a, b);
      st.el.classList.add('fade'); setTimeout(function () { st.el.remove(); }, 260);
      if (!ok) kSay('글자가 없는 곳입니다. 글자 위에 그려 주세요', 'note');
    });
  }
  function inPoly(x, y, pts) { var ins = false; for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) { var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
  function nearestChar(P, pt) { var best = null, bd = 1e9; (P.chars || []).forEach(function (c) { var dx = Math.max(c.x0 - pt[0], 0, pt[0] - c.x1), dy = Math.max(c.y0 - pt[1], 0, pt[1] - c.y1), d = dx * dx + dy * dy * 2.2; if (d < bd) { bd = d; best = c; } }); return bd < 900 ? best : null; }
  function wordRange(P, a, b) { var ch = P.chars, lo = Math.min(a, b), hi = Math.max(a, b); while (lo > 0 && ch[lo - 1].w === ch[lo].w) lo--; while (hi < ch.length - 1 && ch[hi + 1].w === ch[hi].w) hi++; var r = []; for (var i = lo; i <= hi; i++) r.push(i); return r; }
  function uniqCells(P, chars) { var s = {}, out = []; chars.forEach(function (c) { var k = cellOfChar(P, c); if (k && !s[k.key]) { s[k.key] = 1; out.push(k); } }); return out; }
  function selectLoop(P, pts) {
    var hit = P.chars.filter(function (c) { return inPoly((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, pts); });
    var inTab = hit.filter(function (c) { return cellOfChar(P, c); });
    var cells = uniqCells(P, inTab);
    if (hit.length && inTab.length >= hit.length * 0.6 && cells.length >= 1 && (cells.length > 1 || inTab.length === hit.length)) {
      // 고리 안에 가운데가 든 칸만(글자가 걸친 칸 중)
      var inside = cells.filter(function (k) { var b = k.b; return inPoly((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, pts); });
      makeTableSel(P, inside.length ? inside : cells); return true;
    }
    if (!hit.length) return false;
    var words = {}; hit.forEach(function (c) { words[c.w] = 1; });
    makeTextSel(P, P.chars.filter(function (c) { return words[c.w]; }).map(function (c) { return c.i; })); return true;
  }
  function selectLine(P, a, b) {
    var ca = nearestChar(P, a), cb = nearestChar(P, b); if (!ca || !cb) return false;
    var idx = wordRange(P, ca.i, cb.i);
    var inTab = idx.map(function (i) { return P.chars[i]; }).filter(function (c) { return cellOfChar(P, c); });
    var cells = uniqCells(P, inTab);
    if (inTab.length === idx.length && cells.length > 1) { makeTableSel(P, cells); return true; }
    makeTextSel(P, idx); return true;
  }

  /* ---------------- 선택 표시·손잡이·표 칩 ---------------- */
  function clearSel() { if (S.sel) clearLayer(S.sel.P, 'sel'); S.sel = null; var p = R && R.root.querySelector('.mk-pop'); if (p) p.remove(); if (R) $('mkChips').classList.remove('on'); }
  function lineRects(P, idx) { var by = {}; idx.forEach(function (i) { var c = P.chars[i]; if (c) (by[c.l] = by[c.l] || []).push(c); });
    return Object.keys(by).map(function (l) { var cs = by[l]; return [Math.min.apply(0, cs.map(function (c) { return c.x0; })) - 1, Math.min.apply(0, cs.map(function (c) { return c.y0; })) - 1, Math.max.apply(0, cs.map(function (c) { return c.x1; })) + 1, Math.max.apply(0, cs.map(function (c) { return c.y1; })) + 1]; }); }
  function makeTextSel(P, idx) { clearSel(); idx.sort(function (a, b) { return a - b; }); S.sel = { P: P, kind: 'text', idx: idx }; drawSel(); showPop(); kAside(); }
  function makeTableSel(P, cells) { clearSel(); S.sel = { P: P, kind: 'table', base: cells.slice(), cells: cells, pick: 'cells' }; drawSel(); showPop(); kAside(); updChips(); }
  function cellsBox(cells) { return [Math.min.apply(0, cells.map(function (k) { return k.b[0]; })), Math.min.apply(0, cells.map(function (k) { return k.b[1]; })), Math.max.apply(0, cells.map(function (k) { return k.b[2]; })), Math.max.apply(0, cells.map(function (k) { return k.b[3]; }))]; }
  function drawSel() {
    var s = S.sel, P = s.P; clearLayer(P, 'sel');
    if (s.kind === 'text') {
      lineRects(P, s.idx).forEach(function (r) { sv('rect', { 'class': 'mk-hl sel', x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], rx: 1.5 }, P.svg); });
      var c0 = P.chars[s.idx[0]], c1 = P.chars[s.idx[s.idx.length - 1]];
      handle(P, c0.x0 - 1, c0.y0, c0.y1, 'a'); handle(P, c1.x1 + 1, c1.y0, c1.y1, 'b');
    } else {
      s.cells.forEach(function (k) { var b = k.b; sv('rect', { 'class': 'mk-cellbox sel', x: b[0] + .6, y: b[1] + .6, width: b[2] - b[0] - 1.2, height: b[3] - b[1] - 1.2, rx: 1 }, P.svg); });
      var bb = cellsBox(s.cells); handle(P, bb[0], bb[1], bb[1], 'a', true); handle(P, bb[2], bb[3], bb[3], 'b', true);
    }
  }
  function handle(P, x, y0, y1, which, corner) {
    var g = sv('g', { 'class': 'sel' }, P.svg), hr = px(P, 9);
    if (!corner) sv('line', { 'class': 'mk-stem', 'stroke-width': px(P, 2), x1: x, y1: y0, x2: x, y2: y1 + 2 }, g);
    var cy = corner ? y0 : (which === 'a' ? y0 - hr : y1 + hr);
    sv('circle', { 'class': 'mk-handle', 'stroke-width': px(P, 2.5), cx: x, cy: cy, r: hr }, g);
    var hit = sv('circle', { 'class': 'mk-hit', cx: x, cy: cy, r: px(P, 24), fill: 'transparent' }, g);
    hit.addEventListener('pointerdown', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      var pid = ev.pointerId, p = R.root.querySelector('.mk-pop'); if (p) p.remove();
      var mv = function (e2) { if (e2.pointerId === pid) { e2.preventDefault(); dragHandle(which, toPt(P, e2.clientX, e2.clientY)); } };
      var up = function (e2) { if (e2.pointerId !== pid) return; global.removeEventListener('pointermove', mv); global.removeEventListener('pointerup', up); global.removeEventListener('pointercancel', up); if (S.sel) { drawSel(); showPop(); } };
      global.addEventListener('pointermove', mv); global.addEventListener('pointerup', up); global.addEventListener('pointercancel', up);
    });
  }
  function dragHandle(which, pt) {
    var s = S.sel; if (!s) return; var P = s.P;
    if (s.kind === 'text') {
      var c = nearestChar(P, pt); if (!c) return;
      var a = s.idx[0], b = s.idx[s.idx.length - 1]; if (which === 'a') a = c.i; else b = c.i;
      s.idx = wordRange(P, a, b);
    } else {
      var near = cellAt(P, pt[0], pt[1]); if (!near) return;
      var bb = cellsBox(s.cells), other = which === 'a' ? [bb[2] - 1, bb[3] - 1] : [bb[0] + 1, bb[1] + 1];
      var x0 = Math.min(near.b[0] + 1, other[0]), x1 = Math.max(near.b[2] - 1, other[0]), y0 = Math.min(near.b[1] + 1, other[1]), y1 = Math.max(near.b[3] - 1, other[1]);
      var all = walk(P, near, 'all');
      var got = all.filter(function (k) { var cx = (k.b[0] + k.b[2]) / 2, cy = (k.b[1] + k.b[3]) / 2; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; });
      s.cells = got.length ? got : [near]; s.pick = 'cells'; s.base = s.cells.slice(); updChips();
    }
    drawSel();
  }
  var PICKNAME = { cells: '잡힌 칸만', row: '이 행 전체', col: '이 열 전체', table: '표 전체' };
  function rowsOf(cells) { var r = {}; cells.forEach(function (k) { r[Math.round(k.b[1])] = 1; }); return Object.keys(r).length; }
  function updChips() {
    var s = S.sel; if (!s || s.kind !== 'table') { $('mkChips').classList.remove('on'); return; }
    $('mkChips').classList.add('on');
    Array.prototype.forEach.call(R.root.querySelectorAll('.mk-chip'), function (b) { b.classList.toggle('on', b.getAttribute('data-pick') === s.pick); });
    $('mkChipLab').textContent = '표 · ' + PICKNAME[s.pick] + ' · ' + rowsOf(s.cells) + '행 ' + s.cells.length + '칸 (추정)';
  }
  function pickChip(pick) {
    var s = S.sel; if (!s || s.kind !== 'table') return; var P = s.P;
    s.pick = pick;
    if (pick === 'cells') s.cells = s.base.slice();
    else {
      var acc = {}, out = [];
      s.base.forEach(function (k) { walk(P, k, pick === 'table' ? 'all' : pick).forEach(function (c) { if (!acc[c.key]) { acc[c.key] = 1; out.push(c); } }); });
      s.cells = out;
    }
    drawSel(); updChips(); showPop();
  }
  function selBox() { var s = S.sel, P = s.P; if (s.kind === 'table') return cellsBox(s.cells); var r = lineRects(P, s.idx);
    return [Math.min.apply(0, r.map(function (x) { return x[0]; })), Math.min.apply(0, r.map(function (x) { return x[1]; })), Math.max.apply(0, r.map(function (x) { return x[2]; })), Math.max.apply(0, r.map(function (x) { return x[3]; }))]; }
  function showPop() {
    var p = R.root.querySelector('.mk-pop'); if (p) p.remove(); if (!S.sel) return;
    p = doc.createElement('div'); p.className = 'mk-pop';
    p.innerHTML = '<button class="go">수정 요청</button><button class="again">다시 그리기</button>';
    S.sel.P.el.appendChild(p);
    p.querySelector('.go').onclick = function () { openMemo(); };
    p.querySelector('.again').onclick = function () { clearSel(); kSay('다시 동그라미 쳐 주세요', 'note'); };
    placePop();
  }
  function placePop() {
    var p = R && R.root.querySelector('.mk-pop'); if (!p || !S.sel) return; var P = S.sel.P, bb = selBox(), sc = P.scale;
    var pw = p.offsetWidth || 220, x = Math.max(4, Math.min(bb[0] * sc, P.w * sc - pw - 4)), y = bb[3] * sc + 10;
    if (y + 60 > P.h * sc) y = bb[1] * sc - 58;
    p.style.left = x + 'px'; p.style.top = y + 'px';
  }

  /* ---------------- 메모 ---------------- */
  function cellText(P, k) { return P.chars.filter(function (c) { var cl = cellOfChar(P, c); return cl && cl.key === k.key; }).map(function (c, i, arr) { return (i && arr[i - 1].w !== c.w ? ' ' : '') + c.c; }).join(''); }
  function selPayload() {
    var s = S.sel, P = s.P;
    if (s.kind === 'text') {
      var a = s.idx[0], b = s.idx[s.idx.length - 1], sa = P.pos[a], sb = P.pos[b] + 1;
      var text = s.idx.map(function (i, k) { return (k && P.chars[i].w !== P.chars[s.idx[k - 1]].w ? ' ' : '') + P.chars[i].c; }).join('');
      return { kind: 'text', page: P.n, idx: s.idx.slice(), text: text, before: P.text.slice(Math.max(0, sa - 40), sa), after: P.text.slice(sb, sb + 40), box: selBox() };
    }
    // 표: 칸을 행으로 묶어 칸 글 표로
    var rows = {}; s.cells.forEach(function (k) { var y = Math.round(k.b[1]); (rows[y] = rows[y] || []).push(k); });
    var ys = Object.keys(rows).map(Number).sort(function (x, y) { return x - y; });
    var ct = ys.map(function (y) { return rows[y].sort(function (p, q) { return p.b[0] - q.b[0]; }).map(function (k) { return cellText(P, k); }); });
    var flat = [].concat.apply([], ct).filter(Boolean);
    var bb = selBox();
    var first = flat[0] || '';
    return { kind: 'table', page: P.n, cells: s.cells.map(function (k) { return k.b.map(function (v) { return +v.toFixed(1); }); }), pick: s.pick,
             table: { pick: s.pick, rows: ys.length, cols: Math.max.apply(0, ct.map(function (r) { return r.length; })), cells_text: ct },
             text: '표 · ' + PICKNAME[s.pick] + ' · ' + ys.length + '행 ' + s.cells.length + '칸 (추정): ' + flat.slice(0, 4).join(' | ') + (flat.length > 4 ? ' …' : ''),
             before: '', after: '', box: bb, first: first };
  }
  function snapshot(P, box) {
    try {
      if (!P.cv) return '';
      var sc = P.cv.width / P.w, pad = 8, x = Math.max(0, (box[0] - pad) * sc), y = Math.max(0, (box[1] - pad) * sc);
      var w = Math.min(P.cv.width - x, (box[2] - box[0] + pad * 2) * sc), h = Math.min(P.cv.height - y, (box[3] - box[1] + pad * 2) * sc);
      var c = doc.createElement('canvas'), k = Math.min(1, 360 / w); c.width = Math.max(1, w * k); c.height = Math.max(1, h * k);
      c.getContext('2d').drawImage(P.cv, x, y, w, h, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.75);
    } catch (e) { return ''; }
  }
  var CHIPS = ['틀린 글자 고치기', '지우기', '이렇게 바꾸기: ', '문장 다듬기', '숫자 맞는지 확인', '여기에 넣기: '];
  function openMemo(item, draft) {          // draft: O-0548 채팅에 다녀온 뒤 적던 메모를 다시 펼침 {text, isNew}
    var wide = global.innerWidth >= 720;
    var it = item || selPayload(); if (!item) it.shot = snapshot(S.sel.P, it.box);
    var isNew = !item || !!(draft && draft.isNew);
    S.memo = { item: it, edit: !isNew };
    var pop = R.root.querySelector('.mk-pop'); if (pop) pop.remove();
    var n = isNew ? nextNum() : item.n;
    var q = it.kind === 'text' ? '…' + esc(it.before.slice(-14)) + '<mark>' + esc(it.text) + '</mark>' + esc(it.after.slice(0, 14)) + '…' : esc(it.text);
    var h = '<div class="mk-ptitle"><span class="mk-grow">수정 요청 ' + circ(n) + '</span><span class="mk-pnote">' + it.page + '쪽</span></div>' +
      '<div class="mk-quote">' + (it.shot ? '<img alt="짚은 곳" src="' + it.shot + '">' : '') + '<div style="min-width:0"><div class="qm">짚은 글</div><div class="qt">' + q + '</div></div></div>' +
      '<div class="mk-qchips">' + CHIPS.map(function (c) { return '<button data-q="' + esc(c) + '">' + esc(c.replace(/: $/, '…')) + '</button>'; }).join('') + '</div>' +
      '<div class="mk-memo"><textarea id="mkMemoTxt" placeholder="어떻게 고칠지 적어 주세요">' + esc(draft ? (draft.text || '') : (item ? item.note : '')) + '</textarea></div>' +
      '<button class="mk-mic" id="mkMic"><span class="dot"></span><span id="mkMicTxt">🎤 말로 적기</span></button>' +
      '<div class="mk-row2"><button class="mk-big gray" id="mkMemoCancel">취소</button><button class="mk-big red" id="mkMemoSave">저장</button></div>' +
      (!isNew ? '<button class="mk-del" id="mkMemoDel">이 수정 요청 빼기</button>' : '');
    var hostEl;
    if (wide) { hostEl = $('mkSideMemo'); hostEl.innerHTML = '<div class="mk-panel" style="box-shadow:none;padding:4px 2px;max-height:none;animation:none">' + h + '</div>'; $('mkSide').classList.add('memo-open'); S.memo.side = true; }
    else { hostEl = $('mkMemoPanel'); hostEl.innerHTML = h; openSheet('mkMemoSheet'); }
    Array.prototype.forEach.call(hostEl.querySelectorAll('[data-q]'), function (b) { b.onclick = function () { var ta = $('mkMemoTxt'), v = b.getAttribute('data-q'); ta.value = v + (v.slice(-2) === ': ' ? '' : (ta.value ? ' ' + ta.value : '')); ta.focus(); }; });
    $('mkMic').onclick = toggleMic;
    $('mkMemoSave').onclick = saveMemo;
    $('mkMemoCancel').onclick = function () { stopMic(true); closeMemo(); if (S.sel) showPop(); };
    if ($('mkMemoDel')) $('mkMemoDel').onclick = function () { var t = S.memo.item; stopMic(true); closeMemo(); askRemove(t); };
    if (!wide) setTimeout(function () { try { $('mkMemoTxt').focus({ preventScroll: true }); } catch (e) {} }, 260);
    kSay('어떻게 고칠까요? 글로 적거나 🎤로 말씀해 주세요', 'note');
  }
  function closeMemo() { stopMic(true); closeSheets(); if (R) { $('mkSideMemo').innerHTML = ''; $('mkSide').classList.remove('memo-open'); } S.memo = null; }
  // 🎤 받아쓰기: 폰 앱(KSpeech 네이티브)만. PC판·옛 APK 는 글로.
  //   O-0547: 채팅 받아쓰기와 같은 길로 켠다 — 이어 듣기(continuous) · 효과음 설정(sfx) 그대로, 글은 토막(segment)+지금 말(partial)을 이어 붙인다.
  //   멈춤: 말(소리)이 시작된 뒤 2초 조용하면 / 준비된 뒤 8초 동안 말이 없으면 / 다시 누르면. 멈출 때는 인식기에 「마무리」를 시키고 마지막 글(final)까지 받아 넣는다.
  //   꺼지면 이유를 화면에 짧게(권한 없음 · 회의 녹음 중 · 음성 대화 중 · 잘 못 들음 등) — 조용히 꺼지지 않는다.
  var mic = null, MIC_QUIET_MS = 2000, MIC_NOSPEECH_MS = 8000, MIC_FINAL_WAIT_MS = 2500, MIC_READY_MS = 10000;
  var MIC_WHY = { permission: '마이크 권한이 없습니다. 폰 설정 → 애플리케이션 → 스마트비서 → 권한에서 마이크를 허용해 주세요',
                  nospeech: '말씀이 들리지 않아 멈췄습니다. 다시 누르고 말씀해 주세요', nomatch: '잘 알아듣지 못했습니다. 다시 누르고 또박또박 말씀해 주세요',
                  busy: '다른 곳에서 마이크를 쓰고 있습니다. 잠시 뒤 다시 눌러 주세요', network: '인터넷 연결이 불안정해 받아쓰기가 멈췄습니다',
                  lang: '이 폰에서 한국어 받아쓰기를 쓸 수 없습니다', recording: '회의 녹음 중에는 받아쓰기를 쓸 수 없습니다' };
  function micLabel(t) { if (R && $('mkMicTxt')) $('mkMicTxt').textContent = t; }
  function toggleMic() {
    if (mic) { stopMic(false, 'tap'); return; }
    var KS = null; try { if (isNative() && Capacitor.Plugins) KS = Capacitor.Plugins.KSpeech || null; } catch (e) {}
    if (!KS) { toast('이 기기에서는 글로 적어 주세요'); return; }
    if (host.sttBusy && host.sttBusy()) { toast('음성 대화 중이라 받아쓰기를 켤 수 없습니다. 음성 대화를 끄거나 글로 적어 주세요', null, null, 3500); return; }
    var ta = $('mkMemoTxt');
    var m = mic = { KS: KS, hs: [], ta: ta, base: ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '', acc: '', cur: '', heard: false,
                    quietT: null, noSpT: null, finT: null, readyT: null, ready: false, stopping: false };
    $('mkMic').classList.add('on'); micLabel('준비 중… 잠시만요');
    function show() { var t = (m.acc + (m.acc && m.cur ? ' ' : '') + m.cur).trim(); m.ta.value = m.base + t; if (t) m.heard = true; }
    function quiet() { clearTimeout(m.quietT); m.quietT = setTimeout(function () { if (mic === m) stopMic(false, 'quiet'); }, MIC_QUIET_MS); }
    function on(ev, fn) { try { var h = KS.addListener(ev, function (e) { if (!m.ended && (mic === m || m.stopping)) fn(e || {}); }); if (h && h.then) h.then(function (x) { m.hs.push(x); }); else if (h) m.hs.push(h); } catch (e) {} }
    // 「말 없음 8초」는 인식기가 준비된(ready) 뒤부터 센다 — 처음 쓰는 폰에서 권한 창이 떠 있는 동안 먼저 끝나 인식기가 혼자 돌지 않게.
    on('ready', function () {
      m.ready = true; clearTimeout(m.readyT);
      if (m.stopping) return;
      micLabel('듣는 중… 말씀이 끝나고 2초 조용하면 멈춰요');
      if (!m.heard) { clearTimeout(m.noSpT); m.noSpT = setTimeout(function () { if (mic === m && !m.heard) stopMic(false, 'nospeech'); }, MIC_NOSPEECH_MS); }
    });
    on('speech', function () { clearTimeout(m.noSpT); if (!m.stopping) quiet(); });   // 소리는 났는데 글이 아직 없어도 2초 멈춤 시계를 켠다
    on('partial', function (e) { m.cur = e.text || ''; show(); clearTimeout(m.noSpT); if (!m.stopping) quiet(); });
    on('segment', function (e) { if (e.text) { m.acc = (m.acc ? m.acc + ' ' : '') + e.text; } m.cur = ''; show(); if (!m.stopping && m.heard) quiet(); });
    on('final', function (e) { if (e.text) { m.cur = e.text; } show(); m.acc = (m.acc + ' ' + m.cur).trim(); m.cur = ''; micEnd(m, null); });
    on('error', function (e) { micEnd(m, m.stopping && /nospeech|nomatch|client/.test(e.reason || '') ? null : (e.reason || 'other')); });
    try {
      var opt = { lang: 'ko-KR', partial: true, continuous: true, muteRestart: false, sfx: (host.sfx && host.sfx()) || 'soft' };
      var pr = KS.start(opt);
      // 시작이 받아들여졌는데(권한 통과) 10초가 지나도 준비(ready)가 안 오면 사유를 보이고 끝낸다(조용히 꺼지지 않게)
      if (pr && pr.then) pr.then(function () { if (!m.ended && !m.ready) m.readyT = setTimeout(function () { if (mic === m && !m.ready) micEnd(m, 'start', '인식기가 준비되지 않음'); }, MIC_READY_MS); }, function () {});   // ready 가 응답보다 먼저 와도 잘못 끝내지 않게
      if (pr && pr.catch) pr.catch(function (err) {
        var code = (err && (err.code || err.errorCode)) || '';
        micEnd(m, code === 'recording' ? 'recording' : (code === 'permission' || /권한|permission/i.test(String(err && err.message)) ? 'permission' : 'start'), err && err.message);
      });
    } catch (e) { micEnd(m, 'start', e && e.message); }
  }
  // 멈추기. hard=true(저장·닫기·화면 끝내기)면 버리고 바로 끝, 아니면 마무리(final)를 기다린다.
  function stopMic(hard, why) {
    var m = mic; if (!m) return;
    if (hard || m.stopping) { micEnd(m, null, null, true); return; }
    m.stopping = true; clearTimeout(m.quietT); clearTimeout(m.noSpT); clearTimeout(m.readyT);
    micLabel('정리하는 중…');
    try { m.KS.stop(); } catch (e) {}
    m.finT = setTimeout(function () { micEnd(m, why === 'nospeech' && !m.heard ? 'nospeech' : null); }, MIC_FINAL_WAIT_MS);
    if (why === 'nospeech' && !m.heard) { clearTimeout(m.finT); micEnd(m, 'nospeech'); }
  }
  function micEnd(m, reason, detail, cancel) {
    if (m.ended) return; m.ended = true;
    clearTimeout(m.quietT); clearTimeout(m.noSpT); clearTimeout(m.finT); clearTimeout(m.readyT);
    if (cancel || reason) { try { m.KS.cancel(); } catch (e) {} }
    setTimeout(function () { m.hs.forEach(function (h) { try { h.remove(); } catch (e) {} }); }, 300);
    if (mic === m) mic = null;
    if (m.heard && S.memo) S.memo.via = 'voice';          // 실제로 받아 적은 글이 있을 때만 「말로 적음」
    if (R && $('mkMic')) { $('mkMic').classList.remove('on'); micLabel('🎤 말로 적기'); }
    if (reason && !cancel) toast(MIC_WHY[reason] || ('받아쓰기가 멈췄습니다' + (detail ? '(' + String(detail).slice(0, 40) + ')' : '') + '. 다시 누르거나 글로 적어 주세요'), null, null, 4000);
    else if (!cancel && !m.heard) toast('받아 적은 말이 없습니다. 다시 누르고 말씀해 주세요', null, null, 3000);
  }
  function nextNum() { var m = 0; S.items.forEach(function (x) { if (x.n > m) m = x.n; }); return m + 1; }
  function saveMemo() {
    var note = $('mkMemoTxt').value.trim();
    if (!note) { $('mkMemoTxt').focus(); toast('어떻게 고칠지 한 줄만 적어 주세요'); return; }
    stopMic(true);
    var it = S.memo.item;
    if (S.memo.edit) { it.note = note; if (S.memo.via) it.via = 'voice'; persist(); renderAll(); closeMemo(); kSay(circ(it.n) + '번 메모를 바꿨습니다', 'note'); return; }
    it.n = nextNum(); it.note = note; it.via = S.memo.via || 'typed'; it.ts = Date.now();
    S.items.push(it); persist(); closeMemo(); clearSel(); renderAll(it.n);
    var cb = $('mkCount'); cb.classList.remove('bump'); void cb.offsetWidth; if (!reduce()) cb.classList.add('bump');
    kSay(circ(it.n) + '번 적어 두었습니다. 다른 곳도 표시해 주세요', 'note');
  }

  /* ---------------- 핀·목록 ---------------- */
  function renderAll(dropN) {
    if (!R) return;
    S.pages.forEach(function (P) { clearLayer(P, 'mk'); P._pins = []; });
    S.items.forEach(function (it) {
      var P = S.pages[it.page - 1]; if (!P) return;
      if (it.kind === 'text') {
        if (!P.chars) { loadChars(P).then(function () { renderAll(); }); return; }
        lineRects(P, it.idx || []).forEach(function (r) { sv('rect', { 'class': 'mk-hl done mk', x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], rx: 1.5 }, P.svg); });
      } else (it.cells || []).forEach(function (b) { sv('rect', { 'class': 'mk-hl done mk', x: b[0] + .6, y: b[1] + .6, width: b[2] - b[0] - 1.2, height: b[3] - b[1] - 1.2 }, P.svg); });
      var g = sv('g', { 'class': 'mk-pin mk' + (it.status === 'sent' ? ' sent' : it.status === 'done' ? ' done' : '') + (dropN === it.n ? ' drop' : ''), 'data-n': it.n }, P.svg);
      var pr = px(P, 12), x = Math.min(P.w - pr - 1, (P.textRight || it.box[2]) + pr + px(P, 3)), y = Math.max(pr + 1, it.box[1] + (P.lineH || 10) / 2);
      while (P._pins.some(function (py) { return Math.abs(py - y) < pr * 2.1; })) y += pr * 2.2;
      P._pins.push(y);
      sv('circle', { cx: x, cy: y, r: pr, 'stroke-width': px(P, 2) }, g); var t = sv('text', { x: x, y: y + px(P, .5), 'font-size': px(P, 13) }, g); t.textContent = it.n;
      g.style.transformBox = 'fill-box'; g.style.transformOrigin = 'center';
      g.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      g.addEventListener('click', function (e) { e.stopPropagation(); if (!it.status) openMemo(it); else toast(circ(it.n) + (it.status === 'sent' ? '번은 PC가 고치는 중입니다' : '번은 PC 작업이 끝났습니다. 결과는 채팅에서 확인하십시오')); });
    });
    var pend = S.items.filter(notSent).length;
    $('mkN').textContent = pend; $('mkSideN').textContent = pend; $('mkListN').textContent = pend;
    $('mkSideSend').textContent = pend ? 'PC로 보내기 (' + pend + '건)' : 'PC로 보내기'; $('mkListSend').textContent = $('mkSideSend').textContent;
    var html = S.items.length ? S.items.map(itemHtml).join('') : '<div class="mk-empty">아직 적은 수정 요청이 없습니다.<br>고칠 곳에 동그라미를 쳐 보세요.</div>';
    $('mkListBody').innerHTML = html; $('mkSideList').innerHTML = html;
    [$('mkListBody'), $('mkSideList')].forEach(bindItems);
    var sent = S.items.filter(function (x) { return x.status === 'sent'; }).length, done = S.items.filter(function (x) { return x.status === 'done'; }).length;
    $('mkSent').classList.toggle('on', !!sent); $('mkSentTxt').textContent = 'PC가 고치는 중 · ' + sent + '건';
    $('mkDone').classList.toggle('on', !!done && !sent); $('mkDoneTxt').textContent = 'PC 작업이 끝났습니다 · ' + done + '건 — 결과는 채팅에서 보세요';
  }
  function itemHtml(it) {
    var st = it.status === 'sent' ? '<span class="st">보냄 · PC가 고치는 중</span>' : it.status === 'done' ? '<span class="st">PC 작업 끝 · 결과는 채팅에</span>' : '';
    return '<div class="mk-item' + (it.status ? ' ' + it.status : '') + '" data-n="' + it.n + '"><div class="ih"><span class="num">' + it.n + '</span>' + it.page + '쪽 · ' + (it.kind === 'table' ? '표' : '글') + (it.via === 'voice' ? ' · 🎤' : '') + st + '</div>' +
      '<div class="iq">「' + esc(it.text) + '」</div><div class="im">' + esc(it.note) + '</div>' +
      (it.status ? '' : '<div class="ib"><button data-act="edit">메모 바꾸기</button><button data-act="del">빼기</button></div>') + '</div>';
  }
  function bindItems(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.mk-item'), function (row) {
      var it = S.items.filter(function (x) { return String(x.n) === row.getAttribute('data-n'); })[0];
      row.onclick = function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-act');
        if (a === 'edit') { closeSheets(); openMemo(it); return; }
        if (a === 'del') { askRemove(it); return; }
        closeSheets(); goToItem(it); };
    });
  }
  function goToItem(it) {
    var P = S.pages[it.page - 1]; if (!P) return; var y = P.el.offsetTop + it.box[1] * P.scale - R.scroll.clientHeight * 0.3;
    R.scroll.scrollTo({ top: Math.max(0, y), behavior: reduce() ? 'auto' : 'smooth' });
    setTimeout(function () { var g = P.svg.querySelector('.mk-pin[data-n="' + it.n + '"]'); if (g) { g.classList.remove('blink'); void g.getBoundingClientRect(); g.classList.add('blink'); } }, reduce() ? 0 : 380);
  }
  function askRemove(it) {
    ask('<div class="mk-ptitle">' + circ(it.n) + '번 수정 요청을 뺄까요?</div><div class="mk-pnote">「' + esc(cut(it.text, 40)) + '」 · ' + esc(it.note) + '</div>',
      [{ label: '빼기', cls: 'mk-big red', fn: function () { S.items = S.items.filter(function (x) { return x !== it; }); persist(); renderAll(); toast(circ(it.n) + '번을 뺐습니다');
        var left = S.items.filter(notSent).length; kSay(circ(it.n) + '번을 뺐습니다. ' + (left ? '남은 건 ' + left + '건입니다' : '다시 표시해 주세요'), 'note'); } }]);
  }

  /* ---------------- 보내기·취소·상태 ---------------- */
  function srcLine() {
    var s = S.d.src || {};
    if (s.pcPath) return '💻 PC에 있는 원본으로 사본을 만들어 고칩니다';
    if (s.url) return '☁️ 서버에 있는 파일을 씁니다';
    if (s.file) return '📱 폰에 있는 원본을 PC로 보냅니다(' + fmtSize((s.file && s.file.size) || 0) + ')';
    return '';
  }
  function fmtSize(n) { return (global.OfficeBridge && OfficeBridge.fmtSize) ? OfficeBridge.fmtSize(n) : Math.round(n / 1048576) + 'MB'; }
  var EDIT_EXTS = ['hwp', 'hwpx', 'doc', 'docx', 'pdf'];
  function trySend() {
    var pend = S.items.filter(notSent);
    if (!pend.length) { toast('먼저 고칠 곳을 표시해 주세요'); return; }
    closeSheets(); if (S.memo && S.memo.side) closeMemo();
    var s = S.d.src || {};
    if (!s.pcPath && !s.url && !s.file) {
      ask('<div class="mk-ptitle">이 문서의 원본 파일이 폰에 없습니다</div><div class="mk-pnote">「최근 연 문서」에는 보기용 사본만 남아 있습니다. 같은 파일을 한 번 더 골라 주시면 그 원본으로 보내겠습니다.</div>',
        [{ label: '📁 원본 파일 고르기', cls: 'mk-big', fn: pickOriginal }]); return;
    }
    var working = S.items.filter(function (x) { return x.status === 'sent'; });
    if (working.length) {
      var prevRid = lastSentRid();          // 시트를 연 때의 앞 요청(누르는 사이에 끝나도 그 결과 위에 이어서)
      ask('<div class="mk-ptitle">이 문서는 앞 요청(' + working.length + '건)을 PC가 고치는 중입니다</div><div class="mk-pnote">새로 적은 ' + pend.length + '건을 어떻게 보낼까요?</div>',
        [{ label: '이어서 고치기로 보내기', cls: 'mk-big', fn: function () { doSend(S.items.filter(notSent), prevRid); } },
         { label: '앞 요청 취소하고 함께 보내기', cls: 'mk-big gray', fn: function () { cancelSent(true).then(function () { doSend(S.items.filter(notSent), null); }); } }]);
      return;
    }
    var ext = String(S.d.ext || '').toLowerCase();
    ask('<div class="mk-ptitle">수정 요청 ' + pend.length + '건을 PC로 보낼까요?</div>' +
      '<div class="mk-pnote">' + pend.slice(0, 3).map(function (x) { return circ(x.n) + ' ' + x.page + '쪽 「' + esc(cut(x.kind === 'table' ? (x.first || x.text) : x.text, 18)) + '」 → ' + esc(cut(x.note, 24)); }).join('<br>') + (pend.length > 3 ? '<br>…' : '') + '</div>' +
      '<div class="mk-pnote">' + srcLine() + '. PC는 원본 대신 사본(_rev1)을 고쳐요.</div>' +
      (EDIT_EXTS.indexOf(ext) < 0 ? '<div class="mk-pnote">이 형식(' + esc(ext) + ')은 아직 PC가 직접 고치지 못합니다. 고칠 곳을 정리한 교정 표시 PDF로 돌려드리겠습니다.</div>' : ''),
      [{ label: 'PC로 보내기 (' + pend.length + '건)', cls: 'mk-big', fn: function () { doSend(pend, null); } }]);
  }
  function pickOriginal() {
    var inp = doc.createElement('input'); inp.type = 'file'; inp.accept = '*/*'; inp.style.display = 'none'; doc.body.appendChild(inp);
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); if (!f) return; S.d.src = { file: f, name: f.name }; if (host.setOrig) host.setOrig(f); trySend(); };
    inp.click();
  }
  function lastSentRid() { var s = S.sent.filter(function (x) { return x.state === 'sent'; }); return s.length ? s[s.length - 1].rid : null; }
  function doSend(list, afterRid) {
    if (!host.send) { toast('보내기 준비가 되지 않았습니다'); return; }
    var payload = { doc: { name: S.d.name, ext: S.d.ext, key: S.d.key, pages: S.pdf ? S.pdf.numPages : S.d.pages, src: S.d.src || {}, after_rid: afterRid || null },
                    marks: list.map(function (x) { return { n: x.n, page: x.page, kind: x.kind, rect: x.box.map(function (v) { return +v.toFixed(1); }), text: x.kind === 'table' ? (x.first || '') : x.text,
                      label: x.text, before: x.before || '', after: x.after || '', table: x.table || null, note: x.note, via: x.via || 'typed', ts: x.ts, shot: x.shot || '' }; }) };
    kSay(list.length + '건, PC에서 고쳐서 채팅으로 보내 드리겠습니다', 'report');
    toast('보내는 중입니다…', null, null, 8000);
    host.send(payload).then(function (r) {
      list.forEach(function (x) { x.status = 'sent'; x.rid = r.rid; });
      S.sent.push({ rid: r.rid, n: list.map(function (x) { return x.n; }), at: Date.now(), state: 'sent' });
      persist(); renderAll(); hideToast();
      toast(afterRid ? '앞 요청이 끝나면 이어서 고치겠습니다' : 'PC로 보냈습니다', '작업 현황에서 보기', goChat, 4200);
      setTimeout(function () { if (S.on) kSay('다른 곳도 더 적으실 수 있습니다', 'note', 'aside'); }, 1600);
    }).catch(function (e) {
      hideToast();
      kSay('보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요', 'note');
      toast('보내지 못했습니다: ' + ((e && (e.friendly || e.message)) || '알 수 없는 오류'), null, null, 4500);
    });
  }
  function askCancel() {
    var n = S.items.filter(function (x) { return x.status === 'sent'; }).length;
    ask('<div class="mk-ptitle">보낸 수정 요청 ' + n + '건을 취소할까요?</div><div class="mk-pnote">원본은 처음부터 그대로입니다. 취소한 요청은 목록에 남아 고쳐서 다시 보내실 수 있습니다.</div>',
      [{ label: '취소하기', cls: 'mk-big red', fn: function () { cancelSent(false); } }]);
  }
  function cancelSent(silent) {
    var rids = S.sent.filter(function (x) { return x.state === 'sent'; }).map(function (x) { return x.rid; });
    var work = rids.map(function (rid) { return host.cancel ? host.cancel(rid) : Promise.resolve(); });
    return Promise.all(work).then(function () {
      S.items.forEach(function (x) { if (x.status === 'sent') { x.status = null; delete x.rid; } });
      S.sent.forEach(function (s) { if (s.state === 'sent') s.state = 'cancelled'; });
      persist(); renderAll();
      if (!silent) { toast('취소했습니다. 적은 요청은 그대로 남아 있습니다'); kSay('요청을 멈췄습니다. 고쳐서 다시 보내실 수 있습니다', 'note'); }
    }).catch(function () { toast('취소를 보내지 못했습니다. 채팅에 「#번호 취소」라고 하셔도 됩니다'); });
  }
  function refreshStatus() {
    var rids = S.sent.filter(function (x) { return x.state === 'sent'; }).map(function (x) { return x.rid; });
    if (!rids.length || !host.status) return;
    host.status(rids).then(function (m) {
      var changed = false;
      S.sent.forEach(function (s) {
        var st = (m || {})[s.rid]; if (!st || s.state !== 'sent') return;
        var js = st.job_status || '';
        if (js === 'done' || js === 'need_approval' || st.status === '완료') { s.state = 'done'; S.items.forEach(function (x) { if (x.rid === s.rid) x.status = 'done'; }); changed = true; }
        else if (js === 'failed' || js === 'cancelled' || st.status === '실패' || st.status === '취소') {
          s.state = js || 'failed'; S.items.forEach(function (x) { if (x.rid === s.rid) { x.status = null; delete x.rid; } }); changed = true;
          if (S.on) toast(js === 'cancelled' ? '보낸 요청이 취소되었습니다' : 'PC가 끝내지 못했습니다. 채팅의 이유를 보고 다시 보내 주세요');
        }
      });
      if (changed) { persist(); renderAll(); }
    }).catch(function () {});
  }

  /* ---------------- 시트 공용 ---------------- */
  function openSheet(id) { closeSheets(); hideToast(); $(id).classList.add('on'); }
  function closeSheets() { if (!R) return; Array.prototype.forEach.call(R.root.querySelectorAll('.mk-sheet.on'), function (s) { s.classList.remove('on'); }); }
  function ask(html, btns) {
    var p = $('mkAskPanel'); p.innerHTML = html + btns.map(function (b, i) { return '<button class="' + b.cls + '" data-i="' + i + '">' + esc(b.label) + '</button>'; }).join('') + '<button class="mk-close" data-close>닫기</button>';
    Array.prototype.forEach.call(p.querySelectorAll('[data-i]'), function (el) { el.onclick = function () { closeSheets(); btns[+el.getAttribute('data-i')].fn(); }; });
    openSheet('mkAskSheet');
  }

  /* ---------------- 사용법(사용 안내서 「수정 요청」 문구에 맞춤) ---------------- */
  var HELP = [
    { t: '켜기', h: '[✏️ 고치기] → 「표시해서 요청하기」', d: '두 갈래 중 아래 「PC 화면으로 직접 고치기」는 지금 쓰시는 원격 편집 그대로입니다. 문서를 0.5초 꾹 눌러도 바로 켜지고, 켜지면 위에 붉은 띠가 내려옵니다.', svg:
      '<rect x="20" y="10" width="140" height="150" rx="8" fill="var(--card)" stroke="var(--line)" stroke-width="2"/><g fill="var(--line)"><rect x="34" y="28" width="110" height="7" rx="3"/><rect x="34" y="44" width="90" height="7" rx="3"/><rect x="34" y="60" width="100" height="7" rx="3"/></g>' +
      '<rect x="26" y="126" width="72" height="24" rx="12" fill="var(--card)" stroke="var(--line)" stroke-width="2"/><text x="62" y="142" font-size="11" font-weight="800" text-anchor="middle" fill="var(--ink)">✏️ 고치기</text>' +
      '<circle class="mk-tap" cx="62" cy="138" r="3" fill="none" stroke="var(--mk-red)" stroke-width="2.5"/><rect x="176" y="40" width="104" height="70" rx="10" fill="var(--mk-red-bg)" stroke="var(--mk-red)" stroke-width="2"/><text x="228" y="70" font-size="12" font-weight="900" text-anchor="middle" fill="var(--mk-red)">표시해서</text><text x="228" y="88" font-size="12" font-weight="900" text-anchor="middle" fill="var(--mk-red)">요청하기</text>' },
    { t: '펜과 손', h: '펜: 한 손가락으로 그립니다 · 손: 넘겨 봅니다', d: '위 띠의 [펜 | 손]으로 바꿉니다. 펜일 때 넘기려면 두 손가락으로 미십시오. 두 손가락을 벌리면 크게, 위 [＋ －]로도 바꿀 수 있습니다.', svg:
      '<rect x="60" y="40" width="180" height="70" rx="16" fill="var(--card)" stroke="var(--mk-red-line)" stroke-width="3"/><rect x="66" y="46" width="82" height="58" rx="12" fill="var(--mk-red)"/><text x="107" y="82" font-size="20" font-weight="900" text-anchor="middle" fill="#fff">펜</text><text x="194" y="82" font-size="20" font-weight="900" text-anchor="middle" fill="var(--sub)">손</text>' +
      '<text x="150" y="140" font-size="12" font-weight="800" text-anchor="middle" fill="var(--sub)">지금 상태가 늘 글씨로 보여요</text>' },
    { t: '표시하기', h: '동그라미 · 밑줄 · 꾹 누르기', d: '동그라미는 그 안의 낱말, 밑줄은 시작~끝 글자, 0.5초 꾹 누르면 그 줄 전체. 표 칸을 감싸면 파란 칸과 칩이 나와요.', svg:
      '<g fill="var(--line)"><rect x="30" y="30" width="240" height="8" rx="4"/><rect x="30" y="56" width="60" height="8" rx="4"/><rect x="162" y="56" width="108" height="8" rx="4"/><rect x="30" y="82" width="200" height="8" rx="4"/><rect x="30" y="108" width="230" height="8" rx="4"/></g>' +
      '<rect x="96" y="51" width="60" height="18" rx="4" fill="var(--mk-hl)"/><text x="126" y="64" font-size="12" font-weight="900" text-anchor="middle" fill="var(--ink)">취금</text>' +
      '<ellipse class="mk-draw" style="--len:240" cx="126" cy="60" rx="44" ry="20" fill="none" stroke="var(--mk-red)" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="mk-draw" style="--len:120" d="M30 98 L140 98" stroke="var(--mk-red)" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<rect x="28" y="104" width="234" height="16" rx="4" fill="var(--mk-hl)"/><circle class="mk-tap" cx="200" cy="112" r="3" fill="none" stroke="var(--mk-red)" stroke-width="2.5"/>' +
      '<text x="214" y="148" font-size="11" font-weight="900" fill="var(--mk-red)">꾹 = 한 줄</text>' },
    { t: '범위 고치기', h: '양 끝 동그란 손잡이를 끌어 넓히고 좁힙니다', d: '낱말 단위로 늘고 줄어듭니다. 표에서는 화면 위쪽 칩으로 「잡힌 칸만 · 이 행 전체 · 이 열 전체 · 표 전체」를 고를 수 있습니다.', svg:
      '<g font-size="10" font-weight="800"><rect x="30" y="4" width="62" height="20" rx="10" fill="var(--mk-cell)" stroke="var(--mk-cell-line)"/><text x="61" y="18" text-anchor="middle" fill="var(--brand)">잡힌 칸만</text>' +
      '<rect x="98" y="4" width="46" height="20" rx="10" fill="var(--bg)" stroke="var(--line)"/><text x="121" y="18" text-anchor="middle" fill="var(--ink)">이 행</text>' +
      '<rect x="150" y="4" width="46" height="20" rx="10" fill="var(--bg)" stroke="var(--line)"/><text x="173" y="18" text-anchor="middle" fill="var(--ink)">이 열</text>' +
      '<rect x="202" y="4" width="58" height="20" rx="10" fill="var(--bg)" stroke="var(--line)"/><text x="231" y="18" text-anchor="middle" fill="var(--ink)">표 전체</text></g>' +
      '<g stroke="var(--line)" stroke-width="2" fill="none"><rect x="30" y="36" width="240" height="120" rx="4"/><path d="M30 76H270M30 116H270M110 36V156M190 36V156"/></g>' +
      '<rect x="111" y="77" width="158" height="38" fill="var(--mk-cell)" stroke="var(--mk-cell-line)" stroke-width="2"/><circle cx="111" cy="77" r="6" fill="var(--brand)" stroke="#fff" stroke-width="2"/><circle cx="269" cy="115" r="6" fill="var(--brand)" stroke="#fff" stroke-width="2"/>' },
    { t: '메모 남기기', h: '[수정 요청] → 글이나 🎤 말로 메모', d: '빠른 칩을 누르면 문장 앞머리가 들어갑니다. [저장]하면 붉은 번호 핀이 꽂힙니다. 여러 곳에 달 수 있습니다.', svg:
      '<rect x="30" y="20" width="240" height="40" rx="10" fill="var(--bg)" stroke="var(--line)" stroke-width="2"/><text x="44" y="45" font-size="12" font-weight="800" fill="var(--ink)">「취금」 → 취급으로 고쳐 줘</text>' +
      '<rect x="30" y="72" width="150" height="36" rx="10" fill="var(--card)" stroke="var(--line)" stroke-width="2"/><text x="105" y="95" font-size="13" font-weight="900" text-anchor="middle" fill="var(--ink)">🎤 말로 적기</text>' +
      '<rect x="190" y="72" width="80" height="36" rx="10" fill="var(--mk-red)"/><text x="230" y="95" font-size="13" font-weight="900" text-anchor="middle" fill="#fff">저장</text>' +
      '<g transform="translate(150 140)"><circle r="12" fill="var(--mk-red)" stroke="#fff" stroke-width="2"/><text y="5" font-size="13" font-weight="900" text-anchor="middle" fill="#fff">1</text></g>' },
    { t: 'PC로 보내기', h: '「수정 요청 N건」 목록 → [PC로 보내기]', d: '목록에서 [메모 바꾸기]·[빼기]. 앱을 껐다 켜도 남습니다(7일). 보내면 PC가 원본의 사본(_rev1)을 고칩니다. 원본은 그대로입니다.', svg:
      '<rect x="20" y="40" width="70" height="110" rx="12" fill="var(--card)" stroke="var(--line)" stroke-width="2"/><rect x="200" y="40" width="90" height="70" rx="8" fill="var(--card)" stroke="var(--line)" stroke-width="2"/><rect x="230" y="110" width="30" height="16" fill="var(--line)"/>' +
      '<path class="mk-draw" style="--len:120" d="M96 95 C130 60 160 60 194 75" fill="none" stroke="var(--brand)" stroke-width="3" stroke-dasharray="6 5"/>' +
      '<text x="245" y="80" font-size="12" font-weight="900" text-anchor="middle" fill="var(--ink)">_rev1</text><text x="55" y="100" font-size="20" text-anchor="middle">📍</text>' },
    { t: '채팅으로 받기', h: '고친 사본 + 고친 곳 표시 PDF가 채팅으로', d: '보통 10~25분(예상). 「확인 필요」에는 채팅으로 그냥 답하시면 rev2로 다시 만들어 드립니다. 보낸 뒤에도 [요청 취소]로 멈출 수 있습니다.', svg:
      '<rect x="30" y="16" width="240" height="132" rx="14" fill="var(--bg)" stroke="var(--line)" stroke-width="2"/><text x="46" y="42" font-size="12" font-weight="900" fill="var(--ink)">3건 중 3건 고쳤습니다</text>' +
      '<rect x="46" y="56" width="208" height="30" rx="8" fill="var(--card)" stroke="var(--line)"/><text x="58" y="76" font-size="11.5" font-weight="800" fill="var(--ink)">📎 계획서_rev1.hwp</text>' +
      '<rect x="46" y="94" width="208" height="30" rx="8" fill="var(--card)" stroke="var(--line)"/><text x="58" y="114" font-size="11.5" font-weight="800" fill="var(--ink)">📎 계획서_rev1_표시.pdf</text>' }
  ];
  var hIdx = 0, helpFrom = null;
  function buildHelp() {
    $('mkHTrack').innerHTML = HELP.map(function (h, i) { return '<div class="mk-hcard"><svg viewBox="0 0 300 175" aria-hidden="true">' + h.svg + '</svg><div class="hn">' + (i + 1) + '. ' + esc(h.t) + '</div><div class="ht">' + esc(h.h) + '</div><div class="hl1">' + esc(h.d) + '</div></div>'; }).join('');
    $('mkHDots').innerHTML = HELP.map(function () { return '<i></i>'; }).join('');
  }
  function showHelp(i) {
    hIdx = Math.max(0, Math.min(HELP.length - 1, i));
    $('mkHTrack').style.transform = 'translateX(' + (-100 * hIdx) + '%)';
    Array.prototype.forEach.call($('mkHTrack').children, function (c, k) { c.classList.toggle('cur', k === hIdx); });
    Array.prototype.forEach.call($('mkHDots').children, function (d, k) { d.classList.toggle('on', k === hIdx); });
    $('mkHCount').textContent = (hIdx + 1) + ' / ' + HELP.length;
    $('mkHPrev').disabled = hIdx === 0;
    $('mkHNext').textContent = hIdx === HELP.length - 1 ? (S.on ? '시작하기' : '다 봤어요') : '다음 ›';
    $('mkHClose').style.display = hIdx === HELP.length - 1 ? 'none' : '';
  }
  // from: 'fix' = [✏️ 고치기] 시트에서 연 사용법(닫으면 그 시트로) · 없으면 수정 요청 띠
  function help(i, from) {
    build(); if (!R) return;
    helpFrom = from || null;
    if (!S.on) { R.root.classList.add('on', 'help-only'); }
    var cur = R.root.querySelector('.mk-sheet.on'); if (cur && cur.id !== 'mkHelp') cur.classList.remove('on');
    $('mkHelp').classList.add('on'); showHelp(i || 0);
  }
  function closeHelp() {
    $('mkHelp').classList.remove('on');
    if (!S.on) { R.root.classList.remove('on', 'help-only'); if (helpFrom && host.reopenFix) host.reopenFix(); helpFrom = null; return; }
    kSay(S.tool === 'pen' ? '어디를 고칠까요? 동그라미 쳐 주세요' : '넘겨 보시다가 [펜]을 누르고 표시해 주세요', 'note');
  }

  /* ---------------- 뷰어 띠(적어 둔 요청·보낸 요청) ---------------- */
  var vStrip = null, vDoc = null;
  function viewerDoc(d, stripEl, onResume) {
    vDoc = d; vStrip = stripEl || vStrip; renderViewerStrip.onResume = onResume || renderViewerStrip.onResume;
    renderViewerStrip();
  }
  function renderViewerStrip() {
    var el = vStrip; if (!el) return;
    if (MARKUP_ON !== 'on' || !vDoc || !vDoc.key || S.on) { el.style.display = 'none'; return; }
    DB.get(vDoc.key).then(function (v) {
      if (!vDoc || S.on) { el.style.display = 'none'; return; }
      var items = (v && v.items) || [], pend = items.filter(notSent).length, sent = items.filter(function (x) { return x.status === 'sent'; }).length;
      if (!pend && !sent) { el.style.display = 'none'; return; }
      el.className = 'mk-strip on ' + (sent ? 'mk-sent' : 'mk-resume');
      el.innerHTML = sent ? '<span class="mk-grow">PC가 고치는 중 · ' + sent + '건</span><button data-v="open">보기</button><button data-v="cancel">요청 취소</button>'
                          : '<span class="mk-grow">적어 둔 수정 요청 ' + pend + '건이 있습니다</span><button data-v="open">이어서</button><button data-v="clear">모두 빼기</button>';
      el.style.display = 'flex';
      el.onclick = function (e) {
        var a = e.target.getAttribute && e.target.getAttribute('data-v'); if (!a) return;
        if (a === 'open' && renderViewerStrip.onResume) renderViewerStrip.onResume();
        else if (a === 'clear') {                // 한 번 더 눌러야 뺀다(실수로 지우지 않게 · confirm() 창 대신)
          var bt = e.target;
          if (!bt.classList.contains('again')) { bt.classList.add('again'); bt.textContent = '한 번 더 누르면 빼요'; setTimeout(function () { if (bt.isConnected) { bt.classList.remove('again'); bt.textContent = '모두 빼기'; } }, 3000); return; }
          DB.put({ key: vDoc.key, name: vDoc.name, items: items.filter(function (x) { return x.status; }), sent: (v && v.sent) || [] }).then(renderViewerStrip);
        }
        else if (a === 'cancel' && renderViewerStrip.onResume) { renderViewerStrip.onResume(function () { askCancel(); }); }
      };
    });
  }

  /* ---------------- 뷰어에서 길게 눌러 켜기 ---------------- */
  // ctxFn(clientX, clientY) → {pdfDoc, doc, page, ptY} | null (뷰어가 PDF 를 보여 줄 때만)
  // 길게 눌러 켠 그 손가락의 움직임 → 표시 화면의 선 긋기로 이어 준다(터치는 처음 누른 요소에 묶여 있어 창에서 받는다)
  var lpDrag = null;
  global.addEventListener('pointermove', function (ev) {
    var d = lpDrag; if (!d || ev.pointerId !== d.id || !S.on) return;
    if (!d.on) {
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < TOL) return;
      if (S.tool !== 'pen') { lpDrag = null; return; }
      var P = pageAt(d.x, d.y) || pageAt(ev.clientX, ev.clientY); if (!P) return;
      d.on = true; startStroke(P, d.x, d.y, 'lp' + d.id);
    }
    if (stroke && stroke.id === 'lp' + d.id) addPoint(ev.clientX, ev.clientY);
  });
  function lpEnd(ev) {
    var d = lpDrag; if (!d || ev.pointerId !== d.id) return;
    lpDrag = null;
    if (d.on && stroke && stroke.id === 'lp' + d.id) finishStroke(ev.type === 'pointercancel');
    if (S.helpPending) { S.helpPending = false; setTimeout(function () { help(0); }, 700); }
  }
  global.addEventListener('pointerup', lpEnd); global.addEventListener('pointercancel', lpEnd);
  doc.addEventListener('touchmove', function (e) { if (lpDrag && S.on) e.preventDefault(); }, { passive: false });   // 뷰어가 끌려 넘어가지 않게
  function bindLongPress(el, ctxFn) {
    var t = null, st = null;
    function clear() { if (t) { clearTimeout(t); t = null; } st = null; }
    el.addEventListener('pointerdown', function (ev) {
      if (MARKUP_ON !== 'on' || S.on || lsGet(LP_KEY, '1') !== '1') return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (ev.isPrimary === false) { clear(); return; }
      st = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      t = setTimeout(function () {
        var c = st && ctxFn(st.x, st.y); var s0 = st; clear(); if (!c) return;
        var r = open({ pdfDoc: c.pdfDoc, doc: c.doc, page: c.page, how: 'long', anchor: { ptY: c.ptY, clientY: s0.y } });
        if (r) lpDrag = { id: s0.id, x: s0.x, y: s0.y, on: false };   // 손을 떼지 않고 그대로 그으면 바로 표시(안내서 ⑪)
      }, LP_MS);
    });
    el.addEventListener('pointermove', function (ev) { if (st && ev.pointerId === st.id && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > TOL) clear(); });
    el.addEventListener('pointerup', clear); el.addEventListener('pointercancel', clear);
    el.addEventListener('contextmenu', function (e) { if (MARKUP_ON === 'on' && lsGet(LP_KEY, '1') === '1') e.preventDefault(); });
  }

  global.SmartMarkup = {
    enabled: function () { return MARKUP_ON === 'on'; },
    setHost: function (h) { host = h || {}; },
    open: open, close: close, back: back, snap: snap, isOpen: function () { return !!S.on; },
    help: help, viewerDoc: viewerDoc, bindLongPress: bindLongPress,
    micOn: function () { return !!mic; },     // 메모 받아쓰기 중(app.js 가 채팅 받아쓰기를 켜지 않게)
    longPressOn: function () { return lsGet(LP_KEY, '1') === '1'; },
    setLongPress: function (on) { lsSet(LP_KEY, on ? '1' : '0'); },
    _dbg: function () { return S; },   // 점검용(시험에서 내부 상태 확인)
    _state: function () { return { on: S.on, tool: S.tool, items: S.items.length, sent: S.sent.length, sel: S.sel ? S.sel.kind : null }; }   // 점검용
  };
})(window);
