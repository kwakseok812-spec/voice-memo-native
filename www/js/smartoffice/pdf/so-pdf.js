/* so-pdf.js — S-Office PDF 모듈 (스마트비서)
 * 출처·라이선스: 보기 = PDF.js 3.11.174 (Apache-2.0, Mozilla — 앱에 이미 있는 vendor/pdf.min.js 재사용),
 *   고치기 = pdf-lib 1.17.1 (MIT, Andrew Dillon, https://github.com/Hopding/pdf-lib — vendor/so/pdf/pdf-lib.min.js).
 * 이 파일의 코드는 자체 작성(다른 프로그램의 소스 복사 없음). AI 기능 없음. 원본은 덮어쓰지 않고 「원래이름_수정.pdf」 사본만 저장.
 * 하는 일: 세로 연속 쪽 보기(보이는 쪽 근처만 그림) · 핀치/버튼 확대 · 쪽 이동 · 형광펜 · 글 얹기 · 메모 · 손글씨 서명.
 * 하지 않는 일: PDF 본문 글 직접 수정.
 * v10.8(O-0861) 4회차: 영역 가리기·머리글/바닥글·문서 정보·쪽 크기 맞추기·용량 줄이기·암호 걸기(so-pdf-tools.js, 꾸미기 시트) · 암호 걸린 PDF 열기(암호 입력→암호 없는 사본으로 열기, 스위치 SO_PDF_QPDF) · 책갈피(목차) 보기(쪽 이동 창) · 사진 「모든 쪽에도」.
 * v10.3(O-0861) 스위치 SO_PDF_PAGES: 쪽 정리·합치기·나누기·양식 칸 채우기(so-pdf-pages.js, 켜져 있을 때만 불러옴) · 도구줄 6칸+더보기.
 */
(function (global) {
  'use strict';

  var FAMILY = 'Helvetica, Arial, "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
  var PAD = 10, GAP = 10, Z_MIN = 0.6, Z_MAX = 6, MAXPX = 4e6;
  var HL_COLORS = ['#ffeb3b', '#8bd36b', '#ff8fc0', '#6ec6ff'];
  var TX_COLORS = ['#111111', '#d32f2f', '#1565c0', '#2e7d32'];
  var S = null;                         // 열려 있는 문서 상태

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rgbOf(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  var mc = null;
  function measure(text, size) { if (!mc) mc = document.createElement('canvas').getContext('2d'); mc.font = size + 'px ' + FAMILY; return mc.measureText(text).width; }

  // ---------------------------------------------------------------- 상태
  function newState(ctx) {
    return { ctx: ctx, dead: false, pdf: null, bytes: null, n: 0, pages: [], maxW: 1, z: 1, s: 1, fit: 1, mode: 'hand',
      bigDoc: false, hlColor: HL_COLORS[0], hlStyle: 'hl', ulColor: TX_COLORS[1], txColor: TX_COLORS[0], size: 14, sig: null, anns: [], hist: [[]], rev: 0, savedRev: 0, sel: null,
      rendering: false, pinch: null, dlg: null, idc: 0, curPage: 1, io: null, ro: null, failedToasted: false, cache: null,
      bytes: null, workStack: [], savedWork: 0, form: null, pagesBack: null, bucket: 0 };
  }

  // ---------------------------------------------------------------- 화면 만들기
  function buildUI() {
    var ctx = S.ctx, body = ctx.body;
    body.innerHTML = '';
    var root = el('div', 'sp-root'); root.setAttribute('data-mode', 'hand'); body.appendChild(root);
    var sc = el('div', 'sp-scroll'); var inner = el('div', 'sp-inner'); sc.appendChild(inner); root.appendChild(sc);
    S.root = root; S.sc = sc; S.inner = inner;

    // 선택된 주석 막대
    var selbar = el('div', 'sp-selbar'); selbar.style.display = 'none'; root.appendChild(selbar); S.selbar = selbar;

    // 쪽 표시/확대 알약
    var pill = el('div', 'sp-pill');
    var bm = el('button', 'sp-pbtn', '−'); bm.setAttribute('aria-label', '축소');
    var bp = el('button', 'sp-pbtn', '+'); bp.setAttribute('aria-label', '확대');
    var pg = el('button', 'sp-pg', '1 / ' + S.n); pg.setAttribute('aria-label', '쪽 이동');
    pill.appendChild(bm); pill.appendChild(pg); pill.appendChild(bp); root.appendChild(pill);
    S.pgBtn = pg; S.pill = pill;
    bm.onclick = function () { zoomTo(S.z / 1.25); };
    bp.onclick = function () { zoomTo(S.z * 1.25); };
    pg.onclick = jumpDialog;
    pill.addEventListener('pointerdown', pillWake);

    // 아래 도구줄
    var tb = el('div', 'sp-tools'); root.appendChild(tb); S.tb = tb;
    S.opt = el('div', 'sp-opt'); tb.appendChild(S.opt);
    var row = el('div', 'sp-row'); tb.appendChild(row); S.row = row;
    renderToolRow();
    setMode('hand'); refreshUndo();

    // 확대 손동작(두 손가락) · 컴퓨터 ctrl+휠
    sc.addEventListener('touchstart', onTouchStart, { passive: true });
    sc.addEventListener('touchmove', onTouchMove, { passive: false });
    sc.addEventListener('touchend', onTouchEnd, { passive: true });
    sc.addEventListener('touchcancel', onTouchEnd, { passive: true });
    sc.addEventListener('wheel', function (e) { if (e.ctrlKey) { e.preventDefault(); zoomTo(S.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); } }, { passive: false });
    var raf = 0;
    sc.addEventListener('scroll', function () { pillWake(); if (raf) return; raf = requestAnimationFrame(function () { raf = 0; if (!S || S.dead) return; updateCurPage(); }); }, { passive: true });
    if (global.ResizeObserver) { S.ro = new ResizeObserver(function () { if (S && !S.dead && S.pages.length) { layout(); pump(); if (plus() && S.bucket !== perRowN()) { renderToolRow(); setMode(S.mode); refreshUndo(); } } }); S.ro.observe(sc); }
    sc.addEventListener('pointerdown', function (e) { if (e.target === sc || e.target === inner) select(null); });
    pillWake();
  }

  // 쪽 알약은 만지거나 넘길 때만 또렷하고, 잠시 뒤 옅어져 글을 덜 가린다
  function pillWake() {
    if (!S || !S.pill) return;
    S.pill.classList.remove('dim');
    clearTimeout(S.pillT); S.pillT = setTimeout(function () { if (S && S.pill) S.pill.classList.add('dim'); }, 2600);
  }
  function isLocked() { if (S && S.locked) { S.ctx.toast('이 문서는 편집이 제한되어 보기만 됩니다. 고치려면 다시 열어 소유자 암호를 입력하십시오.', 4200); return true; } return false; }
  function setMode(m) {
    if (m !== 'hand' && isLocked()) m = 'hand';
    S.mode = m; S.root.setAttribute('data-mode', m); select(null);
    Object.keys(S.modeBtns).forEach(function (k) { S.modeBtns[k].classList.toggle('on', k === m); });
    if (S.moreBtn) S.moreBtn.classList.toggle('on', !S.modeBtns[m]);
    renderOpt();
    var hint = { hl: '글 위를 손가락으로 쓸어 칠하십시오(형광·밑줄·취소선은 아래에서 고릅니다). 화면을 넘기려면 「보기」를 누르십시오.', text: '글을 넣을 자리를 한 번 누르십시오.', memo: '메모를 붙일 자리를 한 번 누르십시오.', sig: '서명을 넣을 자리를 한 번 누르십시오.' }[m];
    if (hint) S.ctx.toast(hint, 2400);
  }
  function renderOpt() {
    var o = S.opt; o.innerHTML = '';
    var m = S.mode;
    if (m === 'hl' || m === 'text') {
      if (m === 'hl' && plus()) {          // 형광펜 · 밑줄 · 취소선 (같은 도구에서 고른다 — 새 단추 없음)
        [['hl', '형광'], ['ul', '밑줄'], ['st', '취소선']].forEach(function (d) {
          var sb = el('button', 'sp-link' + (S.hlStyle === d[0] ? ' on' : ''), d[1]); sb.type = 'button'; sb.style.fontWeight = S.hlStyle === d[0] ? '700' : '400';
          sb.onclick = function () { S.hlStyle = d[0]; renderOpt(); }; o.appendChild(sb);
        });
      }
      var cols = m === 'hl' ? (S.hlStyle === 'hl' ? HL_COLORS : TX_COLORS.slice(1)) : TX_COLORS, cur = m === 'hl' ? (S.hlStyle === 'hl' ? S.hlColor : S.ulColor) : S.txColor;
      cols.forEach(function (c) {
        var b = el('button', 'sp-chip' + (c === cur ? ' on' : '')); b.type = 'button'; b.style.backgroundColor = c; b.setAttribute('aria-label', '색');
        b.onclick = function () { if (m === 'hl') { if (S.hlStyle === 'hl') S.hlColor = c; else S.ulColor = c; } else S.txColor = c; renderOpt(); };
        o.appendChild(b);
      });
    }
    if (m === 'sig') {
      var rb = el('button', 'sp-link', S.sig ? '서명 다시 그리기' : '서명 그리기'); rb.type = 'button';
      rb.onclick = function () { sigDialog(null); };
      o.appendChild(rb);
    }
    o.style.display = o.childNodes.length ? '' : 'none';
    if (S.root && S.tb) S.root.style.setProperty('--sp-tools-h', S.tb.offsetHeight + 'px');
  }

  // ---------------------------------------------------------------- 쪽 배치 · 그리기
  function initPages() {
    var inner = S.inner;
    for (var i = 0; i < S.n; i++) {
      var P = S.pages[i];
      var d = el('div', 'sp-page'); d.setAttribute('data-n', i + 1);
      var ov = el('div', 'sp-ov'); d.appendChild(ov);
      P.el = d; P.ov = ov; P.vis = false; P.key = null; P.canvas = null;
      bindOverlay(P);
      inner.appendChild(d);
    }
    S.io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { S.pages[+en.target.getAttribute('data-n') - 1].vis = en.isIntersecting; });
      pump();
    }, { root: S.sc, rootMargin: (S.n > 80 || S.bigDoc ? '45%' : '80%') + ' 0px ' + (S.n > 80 || S.bigDoc ? '45%' : '80%') + ' 0px' });
    S.pages.forEach(function (P) { S.io.observe(P.el); });
  }
  function layout() {
    var sc = S.sc, w = sc.clientWidth || 360;
    S.fit = w - 2 * PAD; S.s = S.fit * S.z;            // 쪽마다 가로 맞춤 × 배율
    S.inner.style.width = Math.max(w, S.s + 2 * PAD) + 'px';
    S.pages.forEach(function (P) {
      P.s = S.s / P.w; P.el.style.width = S.s + 'px'; P.el.style.height = P.h * P.s + 'px';
      P.ov.style.width = P.w + 'px'; P.ov.style.height = P.h + 'px'; P.ov.style.transform = 'scale(' + P.s + ')';
    });
  }
  function keyFor(P) { return Math.round(P.s * 1000) + 'x' + (global.devicePixelRatio || 1); }
  function release(P) {
    if (P.task) { try { P.task.cancel(); } catch (e) {} P.task = null; }
    if (P.canvas) { P.canvas.width = 0; P.canvas.height = 0; if (P.canvas.parentNode) P.canvas.parentNode.removeChild(P.canvas); P.canvas = null; }
    P.key = null;
  }
  function pump() {
    if (!S || S.dead) return Promise.resolve();
    var mid = S.sc.scrollTop + S.sc.clientHeight / 2, best = null, bd = 1e12;
    S.pages.forEach(function (P) {
      if (!P.vis) { if (P.canvas && !(S.rendering && S.rendering === P)) release(P); return; }
      if (P.key === keyFor(P) || P.failed === keyFor(P)) return;
      var dd = Math.abs(P.el.offsetTop + P.el.offsetHeight / 2 - mid);
      if (dd < bd) { bd = dd; best = P; }
    });
    if (!best || S.rendering) return Promise.resolve();
    return renderPage(best).then(function () { return pump(); });
  }
  function renderPage(P) {
    var key = keyFor(P), s = P.s;
    S.rendering = P;
    return S.pdf.getPage(P.n).then(function (page) {
      if (S.dead) return;
      var dpr = Math.min(global.devicePixelRatio || 1, (S.bigDoc || S.n > 80) ? 2 : 2.5), r = s * dpr, vp0 = page.getViewport({ scale: 1 });
      var lim = (S.bigDoc || S.n > 80) ? MAXPX * 0.6 : MAXPX;
      var px = vp0.width * r * vp0.height * r; if (px > lim) r *= Math.sqrt(lim / px);
      var vp = page.getViewport({ scale: r });
      var cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      cv.className = 'sp-cv';
      var task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
      P.task = task;
      return task.promise.then(function () {
        P.task = null;
        if (S.dead) return;
        if (!P.vis && !isNear(P)) { cv.width = 0; return; }
        if (P.canvas) { P.canvas.width = 0; if (P.canvas.parentNode) P.canvas.parentNode.removeChild(P.canvas); }
        P.el.insertBefore(cv, P.ov); P.canvas = cv; P.key = key; P.failed = null;
        try { page.cleanup(); } catch (e) {}
      });
    }).catch(function (e) {
      P.task = null;
      if (e && e.name === 'RenderingCancelledException') return;
      P.failed = key;
      try { console.warn('[S-Office PDF] 쪽 그리기 실패', P.n, e); } catch (x) {}
      if (!S.failedToasted) { S.failedToasted = true; S.ctx.toast('일부 쪽을 그리지 못했습니다.', 3000); }
    }).then(function () { S.rendering = false; });
  }
  function isNear(P) { return P.vis; }

  function updateCurPage() {
    var sc = S.sc, mid = sc.scrollTop + sc.clientHeight * 0.4, cur = 1;
    for (var i = 0; i < S.pages.length; i++) { if (S.pages[i].el.offsetTop <= mid) cur = i + 1; else break; }
    if (cur !== S.curPage || !S.pgBtn.textContent) { S.curPage = cur; }
    S.pgBtn.textContent = S.curPage + ' / ' + S.n;
  }
  function goPage(n) {
    n = clamp(Math.round(n) || 1, 1, S.n);
    S.sc.scrollTop = S.pages[n - 1].el.offsetTop - PAD;
    updateCurPage();
  }

  // ---------------------------------------------------------------- 확대/축소
  function zoomTo(nz, cx, cy) {
    nz = clamp(nz, Z_MIN, Z_MAX);
    if (Math.abs(nz - S.z) < 0.001) return;
    var sc = S.sc, r = sc.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    var fx = sc.scrollLeft + cx - r.left, fy = sc.scrollTop + cy - r.top, ratio = nz / S.z;
    S.z = nz; layout();
    sc.scrollLeft = fx * ratio - (cx - r.left); sc.scrollTop = fy * ratio - (cy - r.top);
    updateCurPage(); pump();
  }
  function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      var r = S.sc.getBoundingClientRect(), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      S.pinch = { d0: dist(e.touches), z0: S.z, cx: cx, cy: cy, fx: S.sc.scrollLeft + cx - r.left, fy: S.sc.scrollTop + cy - r.top, ratio: 1 };
      S.inner.style.transformOrigin = S.pinch.fx + 'px ' + S.pinch.fy + 'px';
      S.sc.style.overflow = 'hidden';                    // 두 손가락 확대 중에는 스크롤이 끼어들지 않게
      if (S.draw) { S.draw.cancel(); }
    }
  }
  function onTouchMove(e) {
    var p = S.pinch; if (!p || e.touches.length < 2) return;
    e.preventDefault();
    p.ratio = clamp(p.z0 * dist(e.touches) / p.d0, Z_MIN, Z_MAX) / p.z0;
    S.inner.style.transform = 'scale(' + p.ratio + ')';
  }
  function onTouchEnd(e) {
    var p = S.pinch; if (!p || e.touches.length >= 2) return;
    S.pinch = null; S.sc.style.overflow = '';
    S.inner.style.transform = ''; S.inner.style.transformOrigin = '';
    var tz = p.z0 * p.ratio;
    S.z = p.z0;                            // zoomTo 가 비교할 기준
    if (Math.abs(p.ratio - 1) > 0.01) {
      var nz = clamp(tz, Z_MIN, Z_MAX), r = S.sc.getBoundingClientRect(), ratio = nz / S.z;
      S.z = nz; layout();
      S.sc.scrollLeft = p.fx * ratio - (p.cx - r.left); S.sc.scrollTop = p.fy * ratio - (p.cy - r.top);
      updateCurPage(); pump();
    }
  }

  // ---------------------------------------------------------------- 주석(고치기)
  function commit() {
    S.hist.push(S.anns.map(function (a) { return Object.assign({}, a); }));
    if (S.hist.length > 60) S.hist.shift();
    S.rev++; updateDirty(); refreshUndo();
  }
  function refreshUndo() { if (S.undoBtn) S.undoBtn.disabled = S.hist.length < 2 && !S.workStack.length; }
  function updateDirty() { S.ctx.setDirty(S.rev !== S.savedRev || S.workStack.length !== S.savedWork); }
  function undo() {
    if (S.hist.length < 2) { if (S.workStack.length) undoWork(); return; }
    S.hist.pop(); S.anns = S.hist[S.hist.length - 1].map(function (a) { return Object.assign({}, a); });
    S.rev++; updateDirty();
    select(null); remountAll(); refreshUndo();
  }
  function remountAll() {
    S.pages.forEach(function (P) { var k = P.ov.querySelectorAll('.sp-ann'); for (var i = 0; i < k.length; i++) k[i].parentNode.removeChild(k[i]); });
    S.anns.forEach(mount);
  }
  function findAnn(id) { for (var i = 0; i < S.anns.length; i++) if (S.anns[i].id === id) return S.anns[i]; return null; }

  function wrapLines(text, size, maxw) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (!para) { out.push(''); return; }
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var t = line + para.charAt(i);
        if (line && measure(t, size) > maxw) { out.push(line); line = para.charAt(i); } else line = t;
      }
      out.push(line);
    });
    return out;
  }
  function layoutText(a) {          // 글/메모 상자 크기 계산
    var pad = a.type === 'memo' ? 5 : 1;
    a.lines = wrapLines(a.text, a.size, a.maxw);
    var w = 0; a.lines.forEach(function (l) { w = Math.max(w, measure(l, a.size)); });
    a.pad = pad; a.lh = a.size * 1.3;
    a.w = Math.ceil(w) + pad * 2 + 2; a.h = Math.ceil(a.lines.length * a.lh) + pad * 2;
  }

  function mount(a) {
    var P = S.pages[a.page - 1], e;
    if (a.type === 'hl') {
      e = el('div', 'sp-ann sp-hl' + (a.style ? ' sp-ln' : '')); e.style.background = a.color;
      if (a.style === 'ul') { e.style.background = 'none'; e.style.borderBottom = '2px solid ' + a.color; e.style.boxSizing = 'border-box'; }
      else if (a.style === 'st') e.style.background = 'linear-gradient(transparent calc(50% - 1px), ' + a.color + ' calc(50% - 1px), ' + a.color + ' calc(50% + 1px), transparent calc(50% + 1px))';
    } else if (a.type === 'stamp') {
      e = el('img', 'sp-ann sp-stamp'); e.src = a.img; e.draggable = false;
    } else {
      e = el('div', 'sp-ann sp-tx' + (a.type === 'memo' ? ' memo' : ''));
      e.style.fontSize = a.size + 'px'; e.style.lineHeight = a.lh + 'px'; e.style.padding = a.pad + 'px'; e.style.color = a.color;
      e.textContent = a.lines.join('\n');
    }
    e.setAttribute('data-id', a.id);
    place(e, a);
    bindDrag(e, a);
    P.ov.appendChild(e);
  }
  function place(e, a) { e.style.left = a.x + 'px'; e.style.top = a.y + 'px'; e.style.width = a.w + 'px'; e.style.height = a.h + 'px'; }
  function nodeOf(a) { return S.pages[a.page - 1].ov.querySelector('[data-id="' + a.id + '"]'); }

  function addAnn(a) {
    a.id = ++S.idc; S.anns.push(a); mount(a); commit(); select(a.id);
  }
  function remount(a) { var n = nodeOf(a); if (n) n.parentNode.removeChild(n); mount(a); if (S.sel === a.id) positionSel(); }

  function bindDrag(e, a) {
    e.addEventListener('pointerdown', function (ev) {
      if (S.pinch || !ev.isPrimary) return;
      if (S.mode === 'hl' && a.type === 'hl') return;
      ev.stopPropagation(); select(a.id);
      if (a.fill) return;                  // 양식 칸에 박은 글은 제자리(옮기지 않는다)
      var P = S.pages[a.page - 1], sx = ev.clientX, sy = ev.clientY, ox = a.x, oy = a.y, moved = false;
      try { e.setPointerCapture(ev.pointerId); } catch (x) {}
      function mv(m) {
        var dx = (m.clientX - sx) / P.s, dy = (m.clientY - sy) / P.s;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / P.s) return;
        moved = true; m.preventDefault();
        a.x = clamp(ox + dx, 0, Math.max(0, P.w - a.w)); a.y = clamp(oy + dy, 0, Math.max(0, P.h - a.h));
        e.style.left = a.x + 'px'; e.style.top = a.y + 'px'; positionSel();
      }
      function up() {
        e.removeEventListener('pointermove', mv); e.removeEventListener('pointerup', up); e.removeEventListener('pointercancel', up);
        if (moved) commit();
      }
      e.addEventListener('pointermove', mv); e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
    });
  }

  // 선택 막대
  function select(id) {
    S.sel = id;
    var all = S.inner.querySelectorAll('.sp-ann.sel'); for (var i = 0; i < all.length; i++) all[i].classList.remove('sel');
    var bar = S.selbar; bar.innerHTML = '';
    if (id == null) { bar.style.display = 'none'; return; }
    var a = findAnn(id); if (!a) { S.sel = null; bar.style.display = 'none'; return; }
    var n = nodeOf(a); if (n) n.classList.add('sel');
    function btn(label, fn, cls) { var b = el('button', 'sp-sbtn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.onclick = fn; bar.appendChild(b); }
    if (a.type === 'text' || a.type === 'memo') {
      btn('수정', function () { textDialog(a.type, a, null); });
      btn('글자 키우기', function () { a.size = Math.min(60, a.size * 1.2); layoutText(a); remount(a); commit(); });
      btn('줄이기', function () { a.size = Math.max(6, a.size / 1.2); layoutText(a); remount(a); commit(); });
    } else if (a.type === 'stamp' && a.fill) {
      if (a.fill.text != null && S.form) btn('수정', function () { var w = S.form.list.filter(function (x) { return x.id === a.fill.wid; })[0]; if (w) S.form.cb(w, a); });
    } else if (a.type === 'stamp') {
      btn('키우기', function () { scaleStamp(a, 1.2); });
      btn('줄이기', function () { scaleStamp(a, 1 / 1.2); });
      if (plus() && S.n > 1 && S.n <= 40) btn('모든 쪽에도', function () { stampAll(a); });
    }
    btn('지우기', function () {
      S.anns = S.anns.filter(function (x) { return x.id !== a.id; });
      var nn = nodeOf(a); if (nn) nn.parentNode.removeChild(nn);
      commit(); select(null);
    }, 'del');
    btn('✕', function () { select(null); }, 'x');
    bar.style.display = '';
  }
  // 고른 사진·서명을 다른 모든 쪽에도 같은 자리(쪽 크기에 비례)로 넣는다 — 로고·도장을 모든 쪽에 찍을 때
  function stampAll(a) {
    var P0 = S.pages[a.page - 1];
    S.ctx.confirm('모든 쪽에 같은 자리로 넣을까요?', '이 사진을 다른 ' + (S.n - 1) + '쪽에도 같은 자리·같은 크기(쪽 크기에 비례)로 넣습니다. 쪽마다 따로 옮기거나 지울 수 있고, 되돌리려면 ↶ 를 쓰십시오.', '모든 쪽에 넣기', function () {
      for (var n = 1; n <= S.n; n++) {
        if (n === a.page || a.fill) continue;
        var P = S.pages[n - 1], w = a.w / P0.w * P.w, h = w * (a.h / a.w);
        var b = { type: 'stamp', page: n, img: a.img, x: clamp(a.x / P0.w * P.w, 0, Math.max(0, P.w - w)), y: clamp(a.y / P0.h * P.h, 0, Math.max(0, P.h - h)), w: w, h: h };
        b.id = ++S.idc; S.anns.push(b); mount(b);
      }
      commit(); select(a.id); S.ctx.toast('모든 쪽에 넣었습니다.', 2200);
    }, { cancelLabel: '취소' });
  }
  function positionSel() { /* 막대는 화면 위쪽 고정 — 따로 옮길 필요 없음 */ }
  function scaleStamp(a, f) {
    var P = S.pages[a.page - 1], w = clamp(a.w * f, 24, P.w), h = a.h * (w / a.w);
    a.w = w; a.h = h; a.x = clamp(a.x, 0, Math.max(0, P.w - w)); a.y = clamp(a.y, 0, Math.max(0, P.h - h));
    var n = nodeOf(a); if (n) place(n, a); commit();
  }

  // 쪽 위 누르기/칠하기
  function bindOverlay(P) {
    var d = P.el;
    d.addEventListener('pointerdown', function (ev) {
      if (S.pinch || !ev.isPrimary || ev.target.closest && ev.target.closest('.sp-ann,.sp-wg')) return;
      var m = S.mode;
      if (m === 'hand') { if (S.sel != null) select(null); return; }
      var rect = d.getBoundingClientRect();
      var px = function (e) { return { x: clamp((e.clientX - rect.left) / P.s, 0, P.w), y: clamp((e.clientY - rect.top) / P.s, 0, P.h) }; };
      var st = px(ev), sx = ev.clientX, sy = ev.clientY, moved = false, box = null, done = false;
      if (m === 'hl') {
        ev.preventDefault();
        box = el('div', 'sp-hl sp-ghost'); box.style.background = S.hlStyle === 'hl' ? S.hlColor : S.ulColor; if (S.hlStyle !== 'hl') box.style.opacity = '.25'; P.ov.appendChild(box);
        try { d.setPointerCapture(ev.pointerId); } catch (x) {}
      }
      function end() { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', cx); S.draw = null; }
      function rectOf(e) { var c = px(e); return { x: Math.min(st.x, c.x), y: Math.min(st.y, c.y), w: Math.abs(c.x - st.x), h: Math.abs(c.y - st.y) }; }
      function mv(e) {
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 8) moved = true;
        if (box) { var r = rectOf(e); box.style.left = r.x + 'px'; box.style.top = r.y + 'px'; box.style.width = r.w + 'px'; box.style.height = Math.max(r.h, 14) + 'px'; if (r.h < 14) box.style.top = (r.y - (14 - r.h) / 2) + 'px'; }
      }
      function up(e) {
        if (done) return; done = true; end();
        if (box) {
          box.parentNode && box.parentNode.removeChild(box);
          var r = rectOf(e);
          if (r.w < 6 && r.h < 6) return;
          if (r.h < 14) { r.y = r.y - (14 - r.h) / 2; r.h = 14; }
          r.y = clamp(r.y, 0, Math.max(0, P.h - r.h));
          var ls = S.hlStyle === 'ul' || S.hlStyle === 'st' ? S.hlStyle : null;
          if (ls && r.h > 34) { r.y = r.y + (r.h - 22) / 2; r.h = 22; }      // 밑줄·취소선은 글 한 줄 높이로만
          addAnn({ type: 'hl', page: P.n, x: r.x, y: r.y, w: r.w, h: r.h, color: ls ? S.ulColor : S.hlColor, style: ls || undefined });
          return;
        }
        if (moved) return;                 // 스크롤이었음
        if (m === 'text' || m === 'memo') textDialog(m, null, { page: P.n, x: st.x, y: st.y });
        else if (m === 'sig') placeSig(P, st);
      }
      function cx() { if (done) return; done = true; end(); if (box && box.parentNode) box.parentNode.removeChild(box); }
      S.draw = { cancel: cx };
      d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', cx);
    });
  }

  // ---------------------------------------------------------------- 대화상자
  function closeDlg() { if (S.dlg) { S.dlg.parentNode && S.dlg.parentNode.removeChild(S.dlg); S.dlg = null; } }
  function onVvChange() { dlgFit(); }
  function dlgFit() {
    if (!S || !S.dlg) return;
    var vv = global.visualViewport, inset = 0;
    if (vv) inset = Math.max(0, Math.round(S.root.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)));
    S.dlg.style.paddingBottom = (inset + 12) + 'px';
  }
  function dialog(title, content, buttons, opts) {
    closeDlg();
    opts = opts || {};
    var back = el('div', 'sp-dlg'), box = el('div', 'sp-dbox' + (opts.wide ? ' wide' : ''));
    box.appendChild(el('div', 'sp-dt', title)); box.appendChild(content);
    var bs = el('div', 'sp-db');
    buttons.forEach(function (b) {
      var x = el('button', 'sp-dbtn' + (b.primary ? ' primary' : ''), b.label); x.type = 'button';
      x.onclick = function () { var r = b.onClick ? b.onClick() : true; if (r !== false) closeDlg(); };
      bs.appendChild(x);
    });
    box.appendChild(bs); back.appendChild(box); S.root.appendChild(back); S.dlg = back;
    back.addEventListener('pointerdown', function (e) { if (e.target === back && !(opts.keep && opts.keep())) closeDlg(); });
    dlgFit();
    return box;
  }
  function textDialog(type, existing, at) {
    var wrap = el('div');
    var ta = el('textarea', 'sp-ta'); ta.rows = 4; ta.value = existing ? existing.text : '';
    ta.placeholder = type === 'memo' ? '메모 내용' : '넣을 글';
    wrap.appendChild(ta);
    var asciiNote = el('div', 'sp-note', '영어·숫자는 글자로, 한글은 그림으로 들어갑니다(복사는 안 됩니다).');
    wrap.appendChild(asciiNote);
    var size = existing ? existing.size : S.size;
    if (!existing) {
      var sz = el('div', 'sp-sizes');
      [['작게', 11], ['보통', 14], ['크게', 20]].forEach(function (d) {
        var b = el('button', 'sp-sz' + (d[1] === size ? ' on' : ''), d[0]); b.type = 'button';
        b.onclick = function () { size = d[1]; S.size = size; var k = sz.children; for (var i = 0; i < k.length; i++) k[i].classList.toggle('on', k[i] === b); };
        sz.appendChild(b);
      });
      wrap.appendChild(sz);
    }
    dialog(type === 'memo' ? '메모' : '글 얹기', wrap, [
      { label: '취소' },
      { label: '확인', primary: true, onClick: function () {
        var t = ta.value.replace(/\s+$/, '');
        if (!t) { S.ctx.toast('내용을 먼저 적어 주십시오.', 1800); return false; }
        if (existing) {
          existing.text = t; layoutText(existing); remount(existing); commit(); select(existing.id);
        } else {
          var P = S.pages[at.page - 1];
          var a = { type: type, page: at.page, x: at.x, y: at.y, text: t, size: size, color: type === 'memo' ? '#111111' : S.txColor, maxw: Math.max(60, Math.min(P.w * 0.8, P.w - at.x - 8)) };
          layoutText(a); a.x = clamp(a.x, 0, Math.max(0, P.w - a.w)); a.y = clamp(a.y, 0, Math.max(0, P.h - a.h));
          addAnn(a);
        }
      } }
    ], { keep: function () { return ta.value.replace(/\s+$/, '') !== (existing ? existing.text : ''); } });   // 적던 내용이 있으면 바깥을 눌러도 닫지 않는다
    setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function jumpDialog() {
    var wrap = el('div'); var inp = el('input', 'sp-ta sp-num'); inp.type = 'number'; inp.min = 1; inp.max = S.n; inp.value = S.curPage; inp.inputMode = 'numeric';
    wrap.appendChild(inp); wrap.appendChild(el('div', 'sp-note', '1 ~ ' + S.n + '쪽'));
    var quick = el('div', 'sp-sizes');
    [['맨 처음', 1], ['맨 끝', S.n]].forEach(function (d) {
      var b = el('button', 'sp-sz', d[0]); b.type = 'button';
      b.onclick = function () { goPage(d[1]); closeDlg(); };
      quick.appendChild(b);
    });
    wrap.appendChild(quick);
    if (plus() && S.pdf && S.pdf.getOutline) {      // 책갈피(목차) 보기·만들기·고치기 (없어도 새로 만들 수 있다)
      var cur = S;
      toolsMod().then(function (T) {
        if (S !== cur || !quick.parentNode) return;
        var ob = el('button', 'sp-sz', '책갈피(목차)'); ob.type = 'button';
        ob.onclick = function () { closeDlg(); T.outlineSheet(pagesApi(), goPage); };
        quick.appendChild(ob);
      }).catch(function () {});
    }
    dialog('쪽 이동', wrap, [{ label: '취소' }, { label: '이동', primary: true, onClick: function () { goPage(+inp.value); } }]);
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 60);
  }
  function sigDialog(placeAfter) {
    var wrap = el('div'); var cv = el('canvas', 'sp-pad'); var W = 600, H = 450, dpr = 2;
    cv.width = W * dpr; cv.height = H * dpr; wrap.appendChild(cv);
    var g = cv.getContext('2d'); g.scale(dpr, dpr); g.lineWidth = 4.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
    var drawing = false, last = null, any = false;
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
    cv.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); any = true; try { cv.setPointerCapture(e.pointerId); } catch (x) {} g.beginPath(); g.arc(last.x, last.y, 2.2, 0, 7); g.fillStyle = '#111'; g.fill(); e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); last = p; e.preventDefault(); });
    function stop() { drawing = false; } cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
    wrap.appendChild(el('div', 'sp-note', '위 칸에 손가락으로 서명하십시오. 이 서명은 이 문서를 보는 동안만 기억합니다.'));
    dialog('서명 그리기', wrap, [
      { label: '지우기', onClick: function () { g.clearRect(0, 0, W, H); any = false; return false; } },
      { label: '취소' },
      { label: '완료', primary: true, onClick: function () {
        if (!any) { S.ctx.toast('서명을 먼저 그려 주십시오.', 1800); return false; }
        var url = trimPad(cv);
        if (!url) { S.ctx.toast('서명이 비어 있습니다.', 1800); return false; }
        S.sig = url; renderOpt();
        if (placeAfter) placeSig(placeAfter.P, placeAfter.at); else S.ctx.toast('서명을 만들었습니다. 넣을 자리를 한 번 누르십시오.', 2400);
      } }
    ], { wide: true, keep: function () { return any; } });     // 그리던 서명은 바깥을 잘못 눌러도 지워지지 않게
  }
  function trimPad(cv) {
    var g = cv.getContext('2d'), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) return null;
    var m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    var o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
  function placeSig(P, at) {
    if (!S.sig) { sigDialog({ P: P, at: at }); return; }
    var im = new Image();
    im.onload = function () {
      var w = Math.min(120, P.w * 0.5), h = w * im.height / im.width;
      addAnn({ type: 'stamp', page: P.n, img: S.sig, x: clamp(at.x - w / 2, 0, Math.max(0, P.w - w)), y: clamp(at.y - h / 2, 0, Math.max(0, P.h - h)), w: w, h: h });
    };
    im.src = S.sig;
  }

  // ---------------------------------------------------------------- 저장 (pdf-lib)
  function loadLib() { return S.ctx.loadScript('vendor/so/pdf/pdf-lib.min.js').then(function () { if (!global.PDFLib) throw new Error('pdf-lib 없음'); return global.PDFLib; }); }
  function isAscii(t) { return /^[\x20-\x7E\n]*$/.test(t); }
  function textPng(a, k) {
    var cv = document.createElement('canvas'); cv.width = Math.ceil(a.w * k); cv.height = Math.ceil(a.h * k);
    var g = cv.getContext('2d'); g.scale(k, k); g.font = a.size + 'px ' + FAMILY; g.fillStyle = a.color; g.textBaseline = 'middle';
    a.lines.forEach(function (l, i) { g.fillText(l, a.pad, a.pad + i * a.lh + a.lh / 2); });
    return cv.toDataURL('image/png');
  }
  function dataBytes(url) { var b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  function getBytes() {
    if (S.bytes) return Promise.resolve(S.bytes);
    return S.ctx.file.arrayBuffer().then(function (b) { S.bytes = new Uint8Array(b); return S.bytes; });
  }
  // 지금 문서(쪽 정리 결과 포함) 위에 넣은 형광펜·글·메모·서명·양식 글을 그려 넣은 새 파일 바이트. 넣은 것이 없으면 지금 문서를 그대로 준다.
  function buildOutput() {
    var cur = S, L, doc, font, byPage = {};
    if (!S.anns.length) return getBytes().then(function (b) { return b.slice(); });
    S.anns.forEach(function (a) { (byPage[a.page] = byPage[a.page] || []).push(a); });
    var nums = Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; });
    return loadLib().then(function (lib) {
      L = lib; return getBytes();
    }).then(function (buf) {
      return L.PDFDocument.load(new Uint8Array(buf), { updateMetadata: false });
    }).then(function (d) {
      doc = d; return doc.embedFont(L.StandardFonts.Helvetica);
    }).then(function (f) {
      font = f;
      var chain = Promise.resolve();
      nums.forEach(function (n) {
        chain = chain.then(function () { return cur.pdf.getPage(n); }).then(function (pg) {
          var vp = pg.getViewport({ scale: 1 }), page = doc.getPage(n - 1), seq = Promise.resolve();
          byPage[n].forEach(function (a) { seq = seq.then(function () { return drawAnn(L, doc, page, vp, font, a); }); });
          return seq;
        });
      });
      return chain;
    }).then(function () { return doc.save(); });
  }
  // 반환: Promise<true|false>(저장 성공 여부) — 「수정 요청」으로 넘어가기 전 저장이 이 값을 본다
  // 도형·손그림 같은 작업 화면이 열려 있고 아직 「넣기」를 안 눌렀으면, 그 그림이 저장에서 빠진다고 먼저 알린다
  function save() {
    var st = S && S.root && S.root.querySelector ? S.root.querySelector('.spp') : null, okb = st && st.querySelector('.spp-hb.ok');
    if (okb && !okb.disabled && S.ctx && typeof S.ctx.confirm === 'function') {
      var nm = okb.textContent || '넣기';
      S.ctx.confirm('아직 넣지 않은 작업이 있습니다', '지금 그린 것은 「' + nm + '」를 눌러 문서에 넣어야 저장됩니다. 그냥 저장하면 이 작업은 빠집니다. 먼저 「' + nm + '」를 눌러 주십시오.', '빼고 저장', function () { save0(); }, { danger: true });
      return Promise.resolve(false);
    }
    return save0();
  }
  function save0() {
    var ctx = S.ctx, cur = S;
    if (S.locked) { isLocked(); return Promise.resolve(false); }
    if (!S.anns.length && !S.workStack.length && !S.decrypted) { ctx.toast('아직 고친 것이 없습니다. 형광펜·글·메모·서명·쪽 정리를 한 뒤 저장해 주십시오.', 3000); return Promise.resolve(false); }
    select(null);
    ctx.busy('새 파일 만드는 중…');
    return buildOutput().then(function (out) {
      if (S !== cur || S.dead) return false;
      var base = (ctx.name || 'document').replace(/\.pdf$/i, '');
      var name = base + '_수정.pdf';
      ctx.busy(null);
      var mySt = S;
      return Promise.resolve(ctx.saveCopy(new Blob([out], { type: 'application/pdf' }), name)).then(function (ok) {
        if (ok === false || S !== mySt) return false;   // 저장 실패는 틀이 안내한다 — 성공이 확인된 뒤에만 성공 안내·고침 해제
        S.savedRev = S.rev; S.savedWork = S.workStack.length; ctx.setDirty(false);
        ctx.toast('사본으로 저장했습니다. 원래 파일은 그대로입니다.', 4200);
        return true;
      });
    }).catch(function (e) {
      if (S !== cur || S.dead) return false;
      ctx.busy(null);
      try { console.warn('[S-Office PDF] 저장 실패', e); } catch (x) {}
      ctx.explainFail('저장하지 못했습니다', e, 5000);
      return false;
    });
  }
  function toPdf(vp, x, y) { var p = vp.convertToPdfPoint(x, y); return { x: p[0], y: p[1] }; }
  function drawAnn(L, doc, page, vp, font, a) {
    var ang = (function () { var p0 = toPdf(vp, 0, 0), p1 = toPdf(vp, 1, 0); return Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI; })();
    function boxRect() {
      var p1 = toPdf(vp, a.x, a.y), p2 = toPdf(vp, a.x + a.w, a.y + a.h);
      return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
    }
    if (a.type === 'hl' && (a.style === 'ul' || a.style === 'st')) {
      var lc = rgbOf(a.color), yy = a.style === 'ul' ? a.y + a.h - 1 : a.y + a.h / 2, q1 = toPdf(vp, a.x, yy), q2 = toPdf(vp, a.x + a.w, yy);
      page.drawLine({ start: { x: q1.x, y: q1.y }, end: { x: q2.x, y: q2.y }, thickness: 1.3, color: L.rgb(lc[0], lc[1], lc[2]) });
      return;
    }
    if (a.type === 'hl') {
      var c = rgbOf(a.color), r = boxRect();
      page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, color: L.rgb(c[0], c[1], c[2]), opacity: 0.45, blendMode: L.BlendMode.Multiply });
      return;
    }
    if (a.type === 'stamp') {
      return (/^data:image\/jpe?g/.test(a.img) ? doc.embedJpg(dataBytes(a.img)) : doc.embedPng(dataBytes(a.img))).then(function (im) {
        var p = toPdf(vp, a.x, a.y + a.h);
        page.drawImage(im, { x: p.x, y: p.y, width: a.w, height: a.h, rotate: L.degrees(ang) });
      });
    }
    // 글 / 메모
    if (a.type === 'memo') {
      var r2 = boxRect();
      page.drawRectangle({ x: r2.x, y: r2.y, width: r2.width, height: r2.height, color: L.rgb(1, 0.95, 0.55), borderColor: L.rgb(0.85, 0.7, 0.1), borderWidth: 0.8 });
    }
    if (isAscii(a.text)) {
      var col = rgbOf(a.color);
      a.lines.forEach(function (ln, i) {
        if (!ln) return;
        var by = a.y + a.pad + i * a.lh + a.lh / 2 + a.size * 0.29;
        var p = toPdf(vp, a.x + a.pad, by);
        page.drawText(ln, { x: p.x, y: p.y, size: a.size, font: font, color: L.rgb(col[0], col[1], col[2]), rotate: L.degrees(ang) });
      });
      return;
    }
    return doc.embedPng(dataBytes(textPng(a, 3))).then(function (im) {
      var p = toPdf(vp, a.x, a.y + a.h);
      page.drawImage(im, { x: p.x, y: p.y, width: a.w, height: a.h, rotate: L.degrees(ang) });
    });
  }

  // ---------------------------------------------------------------- 임시 보관(snapshot) · 되살리기(restore)
  // 넣은 형광펜·글·메모·서명의 목록을 JSON 으로(없으면 null). 서명 그림은 데이터 주소로 담는다.
  function snapshot() {
    if (!S || S.dead || S.decrypted || (!S.anns.length && !S.workStack.length)) return null;   // 암호를 풀어 연 문서는 암호 없는 사본이 앱 안에 남지 않게 임시 보관하지 않는다
    var list = S.anns.map(function (a) {
      var o = { t: a.type, p: a.page, x: a.x, y: a.y };
      if (a.type === 'hl') { o.w = a.w; o.h = a.h; o.c = a.color; if (a.style) o.s = a.style; }
      else if (a.type === 'stamp') { o.w = a.w; o.h = a.h; o.img = a.img; if (a.fill) o.fill = a.fill; }
      else { o.text = a.text; o.size = a.size; o.c = a.color; o.maxw = a.maxw; }
      return o;
    });
    return { v: 2, n: S.n, anns: list, work: (S.workStack.length && S.bytes) ? new Blob([S.bytes], { type: 'application/pdf' }) : null };
  }
  function restore(data) {
    if (data && data.work instanceof Blob && S && !S.dead) {           // 쪽 정리를 한 문서였다면 그 결과 문서부터 되살린다
      return data.work.arrayBuffer().then(function (b) { return applyBytes(new Uint8Array(b), '이어서', false); }).then(function () { var r = restoreAnns(data); r.applied += 1; return r; });
    }
    return restoreAnns(data);
  }
  function restoreAnns(data) {
    var rep = { applied: 0, skipped: 0 };
    if (!S || S.dead || !S.pages.length || !data || !Array.isArray(data.anns)) return rep;
    if (typeof data.n === 'number' && data.n !== S.n) {   // 저장해 둔 쪽 수와 지금 문서가 다르면 적용하지 않는다
      rep.skipped = data.anns.length; S.ctx.toast('문서의 쪽 수가 달라져(저장 ' + data.n + '쪽, 지금 ' + S.n + '쪽) 이어서 넣던 내용을 되살리지 않았습니다.', 4200); return rep;
    }
    var num = function (v) { return typeof v === 'number' && isFinite(v); }, hex = /^#[0-9a-fA-F]{6}$/, png = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/;
    data.anns.forEach(function (o) {
      try {
        var P = o && num(o.p) ? S.pages[Math.round(o.p) - 1] : null;
        if (!P || !num(o.x) || !num(o.y) || (o.t !== 'hl' && o.t !== 'stamp' && o.t !== 'text' && o.t !== 'memo')) { rep.skipped++; return; }
        var a = { type: o.t, page: P.n, x: o.x, y: o.y };
        if (o.t === 'hl') {
          if (!num(o.w) || !num(o.h) || !hex.test(o.c || '')) { rep.skipped++; return; }
          a.w = clamp(o.w, 1, P.w); a.h = clamp(o.h, 1, P.h); a.color = o.c; if (o.s === 'ul' || o.s === 'st') a.style = o.s;
        } else if (o.t === 'stamp') {
          if (!num(o.w) || !num(o.h) || typeof o.img !== 'string' || !png.test(o.img)) { rep.skipped++; return; }
          a.w = clamp(o.w, 8, P.w); a.h = clamp(o.h, 8, P.h); a.img = o.img;
          if (o.fill && typeof o.fill === 'object') a.fill = { wid: String(o.fill.wid || ''), text: typeof o.fill.text === 'string' ? o.fill.text.slice(0, 2000) : undefined, check: !!o.fill.check };
        } else {
          if (typeof o.text !== 'string' || !o.text || !num(o.size) || !num(o.maxw) || !hex.test(o.c || '')) { rep.skipped++; return; }
          a.text = o.text.slice(0, 5000); a.size = clamp(o.size, 6, 60); a.color = o.c; a.maxw = clamp(o.maxw, 40, P.w);
          layoutText(a);
        }
        a.x = clamp(a.x, 0, Math.max(0, P.w - a.w)); a.y = clamp(a.y, 0, Math.max(0, P.h - a.h));
        a.id = ++S.idc; S.anns.push(a); mount(a); rep.applied++;
      } catch (e) { rep.skipped++; }
    });
    if (rep.applied) {
      commit();
      S.ctx.toast('이어서 넣던 ' + rep.applied + '개를 되살렸습니다.' + (rep.skipped ? ' (' + rep.skipped + '개는 건너뛰었습니다)' : ''), 3600);
    } else if (rep.skipped) S.ctx.toast('이어서 넣던 내용을 되살리지 못했습니다.', 3200);
    return rep;
  }


  // ---------------------------------------------------------------- O-0861(v10.3) 사진 넣기 — 서명과 같은 「그림 주석」으로 쪽 위에 올린다(끌어서 옮기고 키우기·줄이기)
  function readPhoto(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h)), keepPng = /png/i.test(file.type);
        var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext('2d'); if (!keepPng) { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); }
        g.drawImage(im, 0, 0, cv.width, cv.height);
        var out = { url: cv.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85), w: cv.width, h: cv.height };
        URL.revokeObjectURL(url); cv.width = cv.height = 0; res(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했습니다.')); };
      im.src = url;
    });
  }
  function addPhoto() {
    if (!S || S.dead || isLocked()) return;
    setMode('hand');
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif'; inp.style.display = 'none';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (inp.parentNode) inp.parentNode.removeChild(inp); if (!f || !S || S.dead) return;
      S.ctx.busy('사진을 줄이는 중…');
      readPhoto(f).then(function (ph) {
        S.ctx.busy(null); if (!S || S.dead) return;
        var P = S.pages[Math.max(0, S.curPage - 1)] || S.pages[0], r = ph.h / ph.w;
        var w = Math.min(P.w * 0.55, 320), h = w * r; if (h > P.h * 0.7) { h = P.h * 0.7; w = h / r; }
        var sr = S.sc.getBoundingClientRect(), pr = P.el.getBoundingClientRect(), cy = ((sr.top + sr.height / 2) - pr.top) / P.s;   // 지금 보이는 가운데 높이
        addAnn({ type: 'stamp', page: P.n, img: ph.url, x: Math.max(0, (P.w - w) / 2), y: clamp(cy - h / 2, 0, Math.max(0, P.h - h)), w: w, h: h });
        S.ctx.toast('사진을 넣었습니다. 손가락으로 끌어 옮기고 「키우기」「줄이기」로 크기를 맞추십시오.', 4200);
      }).catch(function (e) { S.ctx.busy(null); S.ctx.toast('사진을 넣지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    };
    document.body.appendChild(inp); inp.click();
  }

  // ---------------------------------------------------------------- O-0861(v10.3) 쪽 정리 · 양식 채우기 연결
  function plus() { return !!(S && S.ctx.flag && S.ctx.flag('pdf')); }
  function perRowN() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }
  function toolsMod() { return S.ctx.loadScript('js/smartoffice/pdf/so-pdf-tools.js').then(function () { if (!global.SOPdfTools) throw new Error('PDF 도구 부품을 불러오지 못함'); return global.SOPdfTools; }); }
  function pagesMod() { return S.ctx.loadScript('js/smartoffice/pdf/so-pdf-pages.js').then(function () { if (!global.SOPdfPages) throw new Error('쪽 정리 부품을 불러오지 못함'); return global.SOPdfPages; }); }
  function openPagesScreen() {
    if (isLocked()) return;
    if (S.form) formStop();
    setMode('hand');
    pagesMod().then(function (M) { M.openPages(pagesApi()); }).catch(function (e) { S.ctx.toast('쪽 정리를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); });
  }
  function openDecorate() { if (isLocked()) return; if (S.form) formStop(); setMode('hand'); pagesMod().then(function (M) { M.decorate(pagesApi()); }).catch(function (e) { S.ctx.toast('꾸미기를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); }); }
  function toggleForm() { if (isLocked()) return; pagesMod().then(function (M) { M.formMode(pagesApi()); }).catch(function (e) { S.ctx.toast('양식 채우기를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); }); }
  function pagesApi() {
    return {
      ctx: S.ctx, root: S.root, pdfjs: global.pdfjsLib, loadLib: loadLib, getBytes: getBytes,
      hasAnns: function () { return S.anns.length > 0; },
      flattenAnns: function () { return buildOutput().then(function (out) { return applyBytes(out, '반영'); }); },
      applyBytes: function (b, label) { return applyBytes(b, label); },
      pageCount: function () { return S.n; }, curPage: function () { return S.curPage || 1; }, pdfDoc: function () { return S.pdf; }, goPage: goPage,
      PDFName: function (n) { return global.PDFLib.PDFName.of(n); },
      onPagesBack: function (fn) { S.pagesBack = fn; }, pagesClosed: function () { S.pagesBack = null; },
      formOn: function () { return !!S.form; }, formStop: formStop, formStart: formStart,
      addFill: addFill, removeFill: removeFill
    };
  }
  // 아래 도구줄: 접은 폰 6칸+더보기 · 펼침 10칸 · DeX 12칸. 가로로 밀지 않는다. (스위치가 꺼지면 예전 6칸 그대로)
  function renderToolRow() {
    var row = S.row; row.innerHTML = ''; S.modeBtns = {}; S.moreBtn = null; S.undoBtn = null; S.formBtn = null;
    var D = {
      hand: { i: '✋', l: '보기', mode: 'hand' }, hl: { i: '🖍', l: '형광펜', mode: 'hl' }, text: { i: 'T', l: '글', mode: 'text' }, memo: { i: '📝', l: '메모', mode: 'memo' }, sig: { i: '✍', l: '서명', mode: 'sig' },
      undo: { i: '↶', l: '되돌리기', run: undo, undo: true }, pages: { i: '▦', l: '쪽 정리', run: openPagesScreen }, form: { i: '✎', l: '양식 채우기', run: toggleForm, form: true }, deco: { i: '✦', l: '꾸미기', run: openDecorate }, pic: { i: '🖼', l: '사진', run: addPhoto }
    };
    var list = plus() ? ['hand', 'hl', 'text', 'memo', 'sig', 'undo', 'pages', 'pic', 'form', 'deco'] : ['hand', 'hl', 'text', 'memo', 'sig', 'undo'];   // 접은 폰 6칸은 예전 그대로(메모 한 번), 새 도구는 더보기
    var n = plus() ? perRowN() : 99, shown = list.length > n ? list.slice(0, n) : list, rest = list.length > n ? list.slice(n) : [];
    S.bucket = perRowN();
    function mk(id, host, inSheet) {
      var d = D[id], b = el('button', inSheet ? 'sp-mb' : 'sp-tool'); b.type = 'button';
      b.innerHTML = '<i></i><span></span>'; b.firstChild.textContent = d.i; b.lastChild.textContent = d.l;
      b.onclick = function () { if (inSheet) S.ctx.closeSheet(); if (d.mode) setMode(d.mode); else d.run(); };
      host.appendChild(b);
      if (d.mode && !inSheet) S.modeBtns[d.mode] = b;
      if (d.undo && !inSheet) S.undoBtn = b;
      if (d.form && !inSheet) S.formBtn = b;
      return b;
    }
    shown.forEach(function (id) { mk(id, row, false); });
    if (rest.length) {
      var mb = el('button', 'sp-tool'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.innerHTML = '<i>⋯</i><span>더보기</span>';
      mb.onclick = function () {
        var body = el('div', 'sp-mgrid'); rest.forEach(function (id) { mk(id, body, true); });
        S.ctx.sheet({ title: '더보기', body: body, buttons: [{ label: '닫기' }], wide: true });
      };
      row.appendChild(mb); S.moreBtn = mb;
    }
    if (S.formBtn) S.formBtn.classList.toggle('on', !!S.form);
    refreshUndo();
  }
  // ---- 쪽 정리 결과를 문서로 받아들이기(쪽 수가 바뀌므로 쪽 칸을 새로 만든다) ----
  function gatherSizes(doc) {
    var sizes = [], chain = Promise.resolve();
    for (var i = 1; i <= doc.numPages; i++) (function (i) {
      chain = chain.then(function () { return doc.getPage(i); }).then(function (p) { var v = p.getViewport({ scale: 1 }); try { p.cleanup(); } catch (e) {} sizes[i - 1] = [v.width, v.height]; });
    })(i);
    return chain.then(function () { return sizes; });
  }
  function applyBytes(bytes, label, noPush) {
    var cur = S, old = S.pdf, prevBytes = S.bytes;
    return global.pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise.then(function (doc) {
      return gatherSizes(doc).then(function (sizes) {
        if (S !== cur || S.dead) { try { doc.destroy(); } catch (e) {} return; }
        if (S.form) formStop();
        try { if (S.io) S.io.disconnect(); } catch (e) {}
        S.pages.forEach(function (P) { release(P); });
        S.inner.innerHTML = '';
        try { if (old) old.destroy(); } catch (e) {}
        S.pdf = doc; S.n = doc.numPages; S.pages = []; S.maxW = 1;
        for (var i = 0; i < S.n; i++) { var z = sizes[i]; S.pages.push({ n: i + 1, w: z[0], h: z[1] }); S.maxW = Math.max(S.maxW, z[0]); }
        if (!noPush) S.workStack.push({ bytes: prevBytes, label: label || '' });
        S.bytes = bytes; S.anns = []; S.hist = [[]]; S.sel = null; S.rev++;
        select(null); initPages(); layout(); S.sc.scrollTop = 0; updateCurPage(); pump(); refreshUndo(); updateDirty();
      });
    });
  }
  function undoWork() {
    var w = S.workStack[S.workStack.length - 1]; if (!w) return;
    S.ctx.busy('이전 상태로 되돌리는 중…');
    (w.bytes ? Promise.resolve(w.bytes) : S.ctx.file.arrayBuffer().then(function (b) { return new Uint8Array(b); })).then(function (bytes) {
      S.workStack.pop(); return applyBytes(bytes, '되돌림', true).then(function () { S.ctx.busy(null); S.ctx.toast('되돌렸습니다' + (w.label && w.label !== '되돌림' ? ' — ' + w.label : ''), 2200); });
    }).catch(function (e) { S.ctx.busy(null); S.ctx.toast('되돌리지 못했습니다 — ' + ((e && e.message) || e), 4200); });
  }
  // ---- 양식 칸(입력 칸) 표시 · 채움 ----
  function fillOf(w) { for (var i = 0; i < S.anns.length; i++) if (S.anns[i].fill && S.anns[i].fill.wid === w.id) return S.anns[i]; return null; }
  function formStart(list, cb) {
    formStop(); S.form = { list: list, cb: cb }; setMode('hand'); S.root.setAttribute('data-form', '1');
    list.forEach(function (w) {
      var P = S.pages[w.page - 1]; if (!P) return;
      var b = el('button', 'sp-wg sp-wg-' + w.kind); b.type = 'button'; b.setAttribute('aria-label', '입력 칸');
      b.style.left = w.x + 'px'; b.style.top = w.y + 'px'; b.style.width = w.w + 'px'; b.style.height = w.h + 'px';
      b.onclick = function (ev) { ev.stopPropagation(); cb(w, fillOf(w)); };
      P.ov.appendChild(b); w.node = b;
    });
    if (S.formBtn) S.formBtn.classList.add('on');
  }
  function formStop() {
    if (!S || !S.form) return;
    S.form.list.forEach(function (w) { if (w.node && w.node.parentNode) w.node.parentNode.removeChild(w.node); });
    S.form = null; if (S.root) S.root.removeAttribute('data-form'); if (S.formBtn) S.formBtn.classList.remove('on');
  }
  function addFill(w, url, fill) { addAnn({ type: 'stamp', page: w.page, x: w.x, y: w.y, w: w.w, h: w.h, img: url, fill: Object.assign({ wid: w.id }, fill) }); }
  function removeFill(a, quiet) {
    S.anns = S.anns.filter(function (x) { return x.id !== a.id; });
    var nn = nodeOf(a); if (nn) nn.parentNode.removeChild(nn);
    if (!quiet) commit(); select(null);
  }

  // ---------------------------------------------------------------- 모듈 등록
  function openDoc(ctx) {
    teardown();
    S = newState(ctx);
    var cur = S;
    ctx.loadCss('js/smartoffice/pdf/so-pdf.css');
    if (global.visualViewport) { global.visualViewport.addEventListener('resize', onVvChange); cur.vvOn = true; }
    if (!global.pdfjsLib) return Promise.reject(new Error('PDF 보기 엔진을 찾지 못함'));
    try { if (!global.pdfjsLib.GlobalWorkerOptions.workerSrc) global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; } catch (e) {}
    if (ctx.flag && ctx.flag('pdf')) {       // DeX·키보드: Ctrl+Z = 되돌리기(글 입력 칸에 커서가 있을 때는 건드리지 않는다)
      cur.keyUndo = function (e) {
        if (!S || S !== cur || !(e.ctrlKey || e.metaKey) || e.altKey || String(e.key).toLowerCase() !== 'z') return;
        var t = e.target && e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || S.dlg || document.querySelector('.so-sheet-back') || (S.root && S.root.querySelector('.spp'))) return;
        e.preventDefault(); undo();
      };
      document.addEventListener('keydown', cur.keyUndo);
    }
    ctx.onBack(function () {
      if (!S) return false;
      if (S.pagesBack && S.root && S.root.querySelector('.spp')) return S.pagesBack();
      if (S.form && !S.dlg) { formStop(); return true; }
      if (S.dlg) { closeDlg(); return true; }
      if (S.sel != null) { select(null); return true; }
      return false;
    });
    return ctx.file.arrayBuffer().then(function (buf) {
      cur.bigDoc = buf.byteLength > 25 * 1024 * 1024;       // 큰 파일은 한 쪽에 쓰는 메모리를 더 줄인다
      return global.pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise.catch(function (e) {
        if (e && e.name === 'PasswordException' && ctx.flag && ctx.flag('pdfqpdf') && S === cur) {      // 암호가 걸린 PDF: 암호를 받아 암호 없는 사본으로 연다(스위치 SO_PDF_QPDF)
          return toolsMod().then(function (T) { return T.openWithPassword(ctx, buf); }).then(function (bytes) {
            if (!bytes || S !== cur) throw e;
            cur.bytes = new Uint8Array(bytes); cur.decrypted = true;
            return global.pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false }).promise;
          });
        }
        throw e;
      });
    }).then(function (doc) {
      if (S !== cur) { try { doc.destroy(); } catch (e) {} return; }
      if (cur.decrypted || !(ctx.flag && ctx.flag('pdfedit') && ctx.flag('pdfqpdf'))) return doc;
      // v10.9 5회차: 열 때 암호는 없지만 암호화된(권한이 걸린) 문서 — 편집이 제한됐으면 소유자 암호를 받아 푼 사본으로 열고, 아니면 보기만
      return doc.getPermissions().then(function (perms) {
        if (!perms) return doc;
        return ctx.file.arrayBuffer().then(function (b) { return toolsMod().then(function (T) { return T.unlockOpen(ctx, b, perms); }); }).then(function (r) {
          if (S !== cur) return doc;
          if (r && r.bytes) {
            cur.bytes = new Uint8Array(r.bytes); cur.decrypted = true; cur.unlockedNote = r.restricted ? '편집 제한을 풀어 열었습니다. 「사본 저장」으로 저장하면 제한 없는 사본이 됩니다(원래 파일은 그대로).' : '암호화된 문서라 사본으로 열었습니다. 「사본 저장」으로 저장하면 암호화 없는 사본이 됩니다(원래 파일은 그대로).';
            try { doc.destroy(); } catch (e) {}
            return global.pdfjsLib.getDocument({ data: new Uint8Array(r.bytes).slice(), isEvalSupported: false }).promise;
          }
          if (r && r.view) cur.locked = true;
          return doc;
        });
      });
    }).then(function (doc) {
      if (S !== cur) { try { doc.destroy(); } catch (e) {} return; }
      cur.pdf = doc; cur.n = doc.numPages;
      ctx.busy('쪽 크기 확인 중…');
      var sizes = [];
      function getSize(i) { return doc.getPage(i).then(function (p) { var v = p.getViewport({ scale: 1 }); try { p.cleanup(); } catch (e) {} sizes[i - 1] = [v.width, v.height]; }); }
      var chain = getSize(1);
      var lim = Math.min(cur.n, 400);
      for (var i = 2; i <= cur.n; i++) (function (i) {
        chain = chain.then(function () { if (i <= lim) return getSize(i); sizes[i - 1] = sizes[0]; });
      })(i);
      return chain.then(function () { return sizes; });
    }, function (e) {
      if (e && e.name === 'PasswordException') { ctx.fallback('암호가 걸린 PDF는 S-Office가 열 수 없어서 변환해서 보여 드립니다.'); return null; }
      throw e;
    }).then(function (sizes) {
      if (!sizes || S !== cur) return;
      for (var i = 0; i < cur.n; i++) { var z = sizes[i] || sizes[0]; cur.pages.push({ n: i + 1, w: z[0], h: z[1] }); cur.maxW = Math.max(cur.maxW, z[0]); }
      ctx.setActions([{ label: '사본 저장', primary: true, onClick: function () { S.ctx.noticeThen(save); } }]);
      if (ctx.onSave) { ctx.onSave(function () { S.ctx.noticeThen(save); }); ctx.setSaver(function () { return save(); }); }
      buildUI(); initPages(); layout(); updateCurPage();
      if (cur.decrypted) ctx.toast(cur.unlockedNote || '암호를 풀어 열었습니다. 「사본 저장」으로 저장하면 암호 없는 파일이 됩니다(원래 파일은 그대로).', 5200);
      else if (cur.locked) ctx.toast('이 문서는 편집이 제한되어 보기만 됩니다. 고치려면 다시 열어 소유자 암호를 입력하십시오.', 5200);
      return waitFirst(cur).then(function () { if (ctx.opts && ctx.opts.openPages && plus() && S === cur) setTimeout(openPagesScreen, 150); });   // 스캔 완료 화면의 「쪽 더 정리하기」
    });
  }
  function waitFirst(cur) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function chk() {
        if (S !== cur || S.dead) return res();
        var P = cur.pages[0];
        if ((P.canvas && P.key) || P.failed || Date.now() - t0 > 6000) return res();
        pump(); setTimeout(chk, 80);
      })();
    });
  }
  function teardown() {
    if (!S) return;
    var o = S; S = null; o.dead = true;
    try { if (o.vvOn && global.visualViewport) global.visualViewport.removeEventListener('resize', onVvChange); clearTimeout(o.pillT); } catch (e) {}
    try { if (o.io) o.io.disconnect(); if (o.ro) o.ro.disconnect(); } catch (e) {}
    o.pages.forEach(function (P) { if (P.task) { try { P.task.cancel(); } catch (e) {} } if (P.canvas) { P.canvas.width = 0; P.canvas.height = 0; } });
    try { if (o.pdf) o.pdf.destroy(); } catch (e) {}
    try { if (o.keyUndo) document.removeEventListener('keydown', o.keyUndo); } catch (e) {}
    o.sig = null; o.anns = []; o.hist = []; o.bytes = null; o.workStack = []; o.form = null;
  }

  global.SOffice.register({
    id: 'pdf', label: 'PDF', editable: true,
    credits: [
      { name: 'pdf-lib', license: 'MIT', note: 'PDF에 형광펜·글·메모·서명·꾸미기 넣기 (사본 저장)' },
      { name: 'qpdf (Jay Berkenbilt 외)', license: 'Apache-2.0', note: 'PDF 암호 걸기·풀기·구조 압축 — qpdf.wasm(이음오피스 배포본의 파일을 수정 없이 사용, vendor/so/pdf/qpdf/)' },
      { name: 'qpdf-wasm (WebAssembly 빌드·연결부)', license: 'ISC', note: 'qpdf 를 브라우저에서 돌리는 부품' },
      { name: 'pdf-lib · PDF.js (글 고치기·도형·첨부·정밀 보기)', license: 'MIT · Apache-2.0', note: '글 직접 고치기 엔진(so-pdf-textedit.js)·워드 변환(so-pdf-docx.js)은 이 앱이 직접 만든 코드이며 새 외부 부품은 없습니다' },
      { name: 'Google ML Kit 한국어 글자 인식 (폰 앱 전용)', license: '구글 ML Kit 약관(오픈소스 아님)', note: 'PDF 글자 인식(OCR) — 인식 모형이 앱 안에 들어 있어 문서가 기기 밖으로 나가지 않습니다. 글 층을 얹는 코드(so-pdf-ocr.js)는 이 앱이 직접 만든 코드입니다' },
      { name: 'libjpeg-turbo · zlib', license: 'IJG · BSD-3-Clause · zlib', note: 'qpdf.wasm 안에 들어 있음' }
    ],
    canOpen: function (ext) { return ext === 'pdf'; },
    open: openDoc,
    snapshot: snapshot,
    restore: restore,
    exportMd: function () { if (!S || S.dead || !plus()) return; toolsMod().then(function (T) { T.exportMarkdown(pagesApi(), S.ctx.name); }).catch(function (e) { S.ctx.toast('글 뽑기를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); }); },
    close: teardown
  });
})(window);
