/* ============================================================================
 * so-xlsx-pdf.js — S-Office 엑셀 → PDF 내보내기 (O-0861, v10.8 4회차 · v10.9 3회차 보강)
 * ----------------------------------------------------------------------------
 * 워드 PDF 내보내기와 같은 「그림 방식」: 시트의 칸(값·글자 모양·바탕색·테두리·가로 맞춤·줄바꿈·합친 칸)을 쪽 크기 캔버스에 그려
 * 쪽마다 한 장의 그림으로 PDF 에 담는다. 새 부품 없음 — 이미 들어 있는 pdf-lib 만 쓴다.
 *   · 글자는 그림이라 PDF 에서 글자를 고르거나 검색할 수 없다.
 *   · 보이는 시트(숨긴 시트 제외)를 차례로 담는다.
 *   · v10.9: 엑셀의 인쇄 설정을 따른다 — 용지 크기(A3·A4·A5·B4·B5·Letter·Legal 등)·방향·여백·배율/한 쪽에 맞춤·인쇄 영역(여러 개 가능)·반복 제목(줄·열)·쪽 나누기·가운데 맞춤·눈금선·머리글/바닥글(&P &N &D &T &A &F).
 *     인쇄 설정이 하나도 없는 시트는 예전처럼 한 쪽 폭에 맞춰 줄이고(가로가 넓으면 가로 용지) 세로로 쪽을 나눈다.
 *   · v10.9: 시트 위 차트(폰 화면의 자체 그림)를 같은 자리에 담는다. 3차원·콤보 등은 자리표시.
 *   · 쪽 번호는 시트마다 1쪽부터 센다. 머리글/바닥글의 그림·첫 쪽 다름·짝수 쪽 다름은 반영하지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FAMILY = '"Malgun Gothic","Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo",Arial,sans-serif';
  var PX = 2;                               // 캔버스 픽셀 / pt
  var MAX_PAGES = 80;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 한 시트의 그릴 범위(내용·바탕색·테두리가 있는 끝 칸까지)
  function extent(env, sh) {
    var maxR = -1, maxC = -1, r, c, cell, st;
    var nr = Math.min(sh.usedR || 0, sh.nr), nc = Math.min(sh.usedC || 0, sh.nc);
    for (r = 0; r < nr; r++) {
      if (sh.rowY[r + 1] - sh.rowY[r] <= 0) continue;
      for (c = 0; c < nc; c++) {
        if (sh.colX[c + 1] - sh.colX[c] <= 0) continue;
        cell = env.cellOf(sh, r, c); st = env.styleAt(sh, r, c);
        if ((cell && env.display(cell) !== '') || (st && (st.bg || st.bl || st.br || st.bt || st.bb))) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
      }
    }
    (sh.merges || []).forEach(function (m) { if (m.s.r <= maxR && m.s.c <= maxC) { maxR = Math.max(maxR, Math.min(m.e.r, sh.nr - 1)); maxC = Math.max(maxC, Math.min(m.e.c, sh.nc - 1)); } });   // 합친 칸은 시작 칸이 범위 안일 때 끝까지
    return maxR < 0 ? null : { r1: maxR, c1: maxC };
  }

  function wrapLines(g, text, maxw) {
    var out = [];
    String(text).split('\n').forEach(function (par) {
      var line = '';
      for (var i = 0; i < par.length; i++) {
        var t = line + par.charAt(i);
        if (g.measureText(t).width > maxw && line) { out.push(line); line = par.charAt(i); } else line = t;
      }
      out.push(line);
    });
    return out;
  }

  // ===================== v10.9 3회차: 엑셀 인쇄 설정 반영 + 차트 =====================
  var PAPER_PT = { 1: [612, 792], 3: [792, 1224], 5: [612, 1008], 7: [521.86, 756], 8: [841.89, 1190.55], 9: [595.28, 841.89], 11: [419.53, 595.28], 12: [728.5, 1031.8], 13: [515.9, 728.5] };
  var PAPER_NAME = { 1: 'Letter', 3: 'Tabloid', 5: 'Legal', 7: 'Executive', 8: 'A3', 9: 'A4', 11: 'A5', 12: 'B4', 13: 'B5' };
  var UPX = 0.75;                                   // 시트 픽셀 1개 = 0.75pt (100% 배율)
  function unesc(t) { return String(t == null ? '' : t).replace(/&#x([0-9A-Fa-f]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(+d); }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function at(tag, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(tag || ''); return m ? m[1] : null; }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  function splitTop(t) { var out = [], cur = '', q = false; for (var i = 0; i < t.length; i++) { var ch = t.charAt(i); if (ch === "'") q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
  function afterBang(p) { var i = p.lastIndexOf('!'); return i >= 0 ? p.slice(i + 1) : p; }
  // 인쇄 영역 글(예: Sheet1!$A$1:$D$10,Sheet1!$F$1:$G$5) → [{r0,c0,r1,c1}]
  function parseAreas(text) {
    var out = [];
    splitTop(text || '').forEach(function (p) {
      var m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(afterBang(p.trim())); if (!m) return;
      out.push({ r0: +m[2] - 1, c0: colNum(m[1]), r1: m[4] ? +m[4] - 1 : +m[2] - 1, c1: m[3] ? colNum(m[3]) : colNum(m[1]) });
    });
    return out;
  }
  // 반복 제목 글(예: Sheet1!$A:$B,Sheet1!$1:$2) → { rows:{r0,r1}|null, cols:{c0,c1}|null }
  function parseTitles(text) {
    var o = { rows: null, cols: null };
    splitTop(text || '').forEach(function (p) {
      var a = afterBang(p.trim()), m = /^\$(\d+):\$(\d+)$/.exec(a); if (m) { o.rows = { r0: +m[1] - 1, r1: +m[2] - 1 }; return; }
      m = /^\$([A-Z]{1,3}):\$([A-Z]{1,3})$/.exec(a); if (m) o.cols = { c0: colNum(m[1]), c1: colNum(m[2]) };
    });
    return o;
  }
  // 머리글·바닥글 글(&L &C &R &P &N &D &T &A &F …) → { L, C, R }
  function hfParse(str, c) {
    var out = { L: '', C: '', R: '' }, cur = 'C', i = 0, s = unesc(str || '');
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch !== '&') { out[cur] += ch; i++; continue; }
      var nx = s.charAt(i + 1);
      if (nx === 'L' || nx === 'C' || nx === 'R') { cur = nx; i += 2; }
      else if (nx === 'P') { out[cur] += c.page; i += 2; } else if (nx === 'N') { out[cur] += c.pages; i += 2; }
      else if (nx === 'D') { out[cur] += c.date; i += 2; } else if (nx === 'T') { out[cur] += c.time; i += 2; }
      else if (nx === 'A') { out[cur] += c.sheet; i += 2; } else if (nx === 'F') { out[cur] += c.file; i += 2; } else if (nx === 'Z') { i += 2; }
      else if (nx === '&') { out[cur] += '&'; i += 2; }
      else if (nx === '"') { var e = s.indexOf('"', i + 2); i = e < 0 ? s.length : e + 1; }
      else if (/\d/.test(nx)) { i++; while (i < s.length && /\d/.test(s.charAt(i))) i++; }
      else if (nx === 'K') i += 8; else i += 2;                        // &B &I &U &S &X &Y 같은 글꼴 꾸밈은 무시
    }
    return out;
  }
  // 시트 XML(+ 이름표)에서 인쇄 설정 읽기. names = { area, titles }. 인쇄 설정이 하나도 없으면 legacy(예전처럼 폭 맞춤)
  function readSetupXml(xml, names) {
    var ps = /<pageSetup\b[^>]*?\/>/.exec(xml || ''), pm = /<pageMargins\b[^>]*?\/>/.exec(xml || ''), po = /<printOptions\b[^>]*?\/>/.exec(xml || ''), sp = /<pageSetUpPr\b[^>]*?\/>/.exec(xml || ''), hf = /<headerFooter\b[\s\S]*?(?:<\/headerFooter>|\/>)/.exec(xml || '');
    var o = { legacy: !(ps || pm || po || (names && (names.area || names.titles)) || hf), paperId: 9, landscape: null, scale: 1, fit: null, order: 'down', m: { l: 28, t: 28, r: 28, b: 28, hd: 0, ft: 0 }, grid: o_grid(po), hC: false, vC: false, areas: null, tRows: null, tCols: null, hdr: null, ftr: null, rb: {}, cb: {}, notes: [] };
    function o_grid(p) { return !!(p && /\sgridLines="(1|true)"/.test(p[0])); }
    if (o.legacy) { o.grid = true; return o; }
    if (ps) {
      var pid = at(ps[0], 'paperSize'); if (pid != null) { o.paperId = +pid; if (!PAPER_PT[o.paperId]) { o.notes.push('용지 번호 ' + pid + '는 A4로 대신했습니다'); o.paperId = 9; } }
      var ori = at(ps[0], 'orientation'); if (ori === 'landscape') o.landscape = true; else if (ori === 'portrait') o.landscape = false;
      var sc = at(ps[0], 'scale'); if (sc) o.scale = Math.max(0.1, Math.min(4, +sc / 100));
      if (sp && /fitToPage="(1|true)"/.test(sp[0])) { var fw = at(ps[0], 'fitToWidth'), fh = at(ps[0], 'fitToHeight'); o.fit = { w: fw == null ? 1 : +fw, h: fh == null ? 1 : +fh }; }
      if (at(ps[0], 'pageOrder') === 'overThenDown') o.order = 'over';
    }
    if (o.landscape == null) o.landscape = false;
    if (pm) { var mm = function (n, d) { var v = at(pm[0], n); return (v == null ? d : +v) * 72; }; o.m = { l: mm('left', 0.7), r: mm('right', 0.7), t: mm('top', 0.75), b: mm('bottom', 0.75), hd: mm('header', 0.3), ft: mm('footer', 0.3) }; }
    else o.m = { l: 0.7 * 72, r: 0.7 * 72, t: 0.75 * 72, b: 0.75 * 72, hd: 0.3 * 72, ft: 0.3 * 72 };
    if (po) { o.hC = /\shorizontalCentered="(1|true)"/.test(po[0]); o.vC = /\sverticalCentered="(1|true)"/.test(po[0]); }
    if (names) { if (names.area) { var ar = parseAreas(names.area); if (ar.length) o.areas = ar; } if (names.titles) { var t = parseTitles(names.titles); o.tRows = t.rows; o.tCols = t.cols; } }
    if (hf) { var g = function (n) { var m = new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>').exec(hf[0]); return m ? m[1] : ''; }; o.hdr = g('oddHeader') || null; o.ftr = g('oddFooter') || null; }
    var normal = Math.abs(o.m.l - 50.4) < 2 && Math.abs(o.m.r - 50.4) < 2 && Math.abs(o.m.t - 54) < 2 && Math.abs(o.m.b - 54) < 2;
    var defaults = !o.areas && !o.tRows && !o.tCols && !o.hdr && !o.ftr && !o.fit && o.scale === 1 && o.landscape === false && o.paperId === 9 && normal && !o.grid && !o.hC && !o.vC && !/<rowBreaks\b|<colBreaks\b/.test(xml || '');
    if (defaults) { o.legacy = true; o.grid = true; o.landscape = null; o.m = { l: 28, t: 28, r: 28, b: 28, hd: 0, ft: 0 }; return o; }          // 엑셀이 기본값으로 적어 둔 설정뿐이면 폰용으로 한 쪽 폭에 맞춘다
    (xml.match(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/) || [''])[0].replace(/<brk\b[^>]*?\sid="(\d+)"/g, function (m, id) { o.rb[+id] = 1; return m; });
    (xml.match(/<colBreaks\b[\s\S]*?<\/colBreaks>/) || [''])[0].replace(/<brk\b[^>]*?\sid="(\d+)"/g, function (m, id) { o.cb[+id] = 1; return m; });
    return o;
  }
  // 여러 쪽으로 나누기. 반환: { P:[w,h], m, k(캔버스px/시트px), s(배율), pages:[{ rows:[], cols:[], r0,r1,c0,c1 }] }
  function paginate(env, sh, reg, op, merges) {
    var colW = function (c) { return sh.colX[c + 1] - sh.colX[c]; }, rowH = function (r) { return sh.rowY[r + 1] - sh.rowY[r]; };
    var totalW = 0, totalH = 0, c, r; for (c = reg.c0; c <= reg.c1; c++) totalW += colW(c); for (r = reg.r0; r <= reg.r1; r++) totalH += rowH(r);
    var base = PAPER_PT[op.paperId] || PAPER_PT[9], land = op.landscape, m = op.m;
    if (land == null) land = totalW * UPX > base[0] - m.l - m.r;            // 인쇄 설정이 없으면 가로가 넓은 시트는 가로 방향 용지
    var P = land ? [base[1], base[0]] : base.slice(), cw = P[0] - m.l - m.r, ch = P[1] - m.t - m.b;
    if (cw < 80 || ch < 80) { m = { l: 28, t: 28, r: 28, b: 28, hd: m.hd, ft: m.ft }; cw = P[0] - 56; ch = P[1] - 56; }
    var s;
    if (op.legacy) s = Math.min(1, cw / Math.max(1, totalW * UPX));
    else if (op.fit) { s = Math.min(1, cw * Math.max(1, op.fit.w) / Math.max(1, totalW * UPX)); if (op.fit.h > 0) s = Math.min(s, ch * op.fit.h / Math.max(1, totalH * UPX)); }
    else s = op.scale || 1;
    s = Math.max(0.05, s);
    var availW = cw / (UPX * s), availH = ch / (UPX * s);                    // 한 쪽에 들어가는 시트 px
    var tc = op.tCols, tr = op.tRows;
    function chunk(lo, hi, size, avail, breaks, tLo, tHi, hasTitle) {       // lo..hi 를 쪽으로 자른다(처음 쪽 외에는 반복 제목을 위에 얹는다)
      var out = [], i = lo;
      while (i <= hi) {
        var start = i, used = 0, titleList = [];
        if (hasTitle && start > tHi && !(op.fit && false)) { for (var q = tLo; q <= tHi; q++) { used += size(q); titleList.push(q); } }
        var list = [];
        while (i <= hi) {
          var w = size(i);
          if (list.length && (used + w > avail + 0.01 || (breaks && breaks[i]))) break;
          used += w; list.push(i); i++;
        }
        out.push({ lo: start, hi: i - 1, list: titleList.concat(list), main: list });
      }
      return out;
    }
    var colPages = chunk(reg.c0, reg.c1, colW, availW, op.cb, tc ? tc.c0 : 0, tc ? tc.c1 : -1, !!tc);
    var rowPages = chunk(reg.r0, reg.r1, rowH, availH - ((op.hdr || op.ftr) ? 0 : 0), op.rb, tr ? tr.r0 : 0, tr ? tr.r1 : -1, !!tr);
    var pages = [];
    if (op.order === 'over') rowPages.forEach(function (rp) { colPages.forEach(function (cp) { pages.push({ rows: rp.list, cols: cp.list, rMain: rp.main, cMain: cp.main }); }); });
    else colPages.forEach(function (cp) { rowPages.forEach(function (rp) { pages.push({ rows: rp.list, cols: cp.list, rMain: rp.main, cMain: cp.main }); }); });
    return { P: P, m: m, s: s, k: s * UPX * PX, pages: pages, totalW: totalW, totalH: totalH };
  }
  function hasContent(env, sh, pg, charts) {
    for (var i = 0; i < pg.rMain.length; i++) for (var j = 0; j < pg.cMain.length; j++) {
      var r = pg.rMain[i], c = pg.cMain[j], cell = env.cellOf(sh, r, c), st = env.styleAt(sh, r, c);
      if ((cell && env.display(cell) !== '') || (st && (st.bg || st.bl || st.br || st.bt || st.bb))) return true;
    }
    var x0 = sh.colX[pg.cMain[0]], x1 = sh.colX[pg.cMain[pg.cMain.length - 1] + 1], y0 = sh.rowY[pg.rMain[0]], y1 = sh.rowY[pg.rMain[pg.rMain.length - 1] + 1];
    return (charts || []).some(function (ch) { return ch.box.x < x1 && ch.box.x + ch.box.w > x0 && ch.box.y < y1 && ch.box.y + ch.box.h > y0; });
  }
  // 시트 하나의 계획: 인쇄 영역마다 → 쪽들
  function planSheet(env, i, op, charts) {
    var sh = env.prep(i), regs = [];
    if (op.areas) op.areas.forEach(function (a) { var r1 = Math.min(a.r1, sh.nr - 1), c1 = Math.min(a.c1, sh.nc - 1); if (a.r0 <= r1 && a.c0 <= c1) regs.push({ r0: a.r0, c0: a.c0, r1: r1, c1: c1 }); });
    else {
      var ext = extent(env, sh), r1 = ext ? ext.r1 : -1, c1 = ext ? ext.c1 : -1;
      (charts || []).forEach(function (ch) { var yb = ch.box.y + ch.box.h, xb = ch.box.x + ch.box.w, rr = 0, cc = 0; while (rr < sh.nr - 1 && sh.rowY[rr + 1] < yb) rr++; while (cc < sh.nc - 1 && sh.colX[cc + 1] < xb) cc++; if (rr > r1) r1 = rr; if (cc > c1) c1 = cc; });
      if (r1 >= 0 && c1 >= 0) regs.push({ r0: 0, c0: 0, r1: r1, c1: c1 });
    }
    var merges = (sh.merges || []).filter(function (m) { return true; }), skip = {};
    merges.forEach(function (m) { for (var r = m.s.r; r <= Math.min(m.e.r, sh.nr - 1); r++) for (var c = m.s.c; c <= Math.min(m.e.c, sh.nc - 1); c++) skip[r + '|' + c] = 1; });
    var pages = [], info = [];
    regs.forEach(function (rg) {
      var pg = paginate(env, sh, rg, op, merges);
      pg.pages.forEach(function (p) { if (hasContent(env, sh, p, charts)) pages.push({ page: p, pg: pg }); });
      info.push(pg);
    });
    return { name: sh.name, sh: sh, op: op, merges: merges, skip: skip, pages: pages, charts: charts || [], notes: op.notes || [], paper: PAPER_NAME[op.paperId] || 'A4', legacy: op.legacy };
  }
  // 차트 그림 미리 만들기(쪽 크기 배율로 또렷하게)
  function loadChartImages(plan) {
    var jobs = (plan.charts || []).map(function (ch) {
      if (!plan.pages.length || !ch.spec || !global.SOChart) return Promise.resolve();
      var k = plan.pages[0].pg.k, w = Math.max(20, Math.round(ch.box.w * k)), h = Math.max(20, Math.round(ch.box.h * k));
      return new Promise(function (res) {
        var im = new Image(); im.onload = function () { ch.img = im; res(); }; im.onerror = function () { res(); };
        try { im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(global.SOChart.svg(ch.spec, w, h, { bg: true })); } catch (e) { res(); }
      });
    });
    return Promise.all(jobs);
  }
  var FILE_NAME = '', NOW = null;
  function drawPrint(env, plan, pi) {
    var sh = plan.sh, op = plan.op, ent = plan.pages[pi], pg = ent.pg, P = pg.P, m = pg.m, k = pg.k, page = ent.page;
    var cv = document.createElement('canvas'); cv.width = Math.round(P[0] * PX); cv.height = Math.round(P[1] * PX);
    var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    var colW = function (c) { return sh.colX[c + 1] - sh.colX[c]; }, rowH = function (r) { return sh.rowY[r + 1] - sh.rowY[r]; };
    var xo = {}, yo = {}, tw = 0, th = 0, i;
    page.cols.forEach(function (c) { xo[c] = tw; tw += colW(c); }); page.rows.forEach(function (r) { yo[r] = th; th += rowH(r); });
    var ox = m.l * PX, oy = m.t * PX;
    if (!op.legacy) { if (op.hC) ox += Math.max(0, (P[0] - m.l - m.r - tw * UPX * pg.s) / 2) * PX; if (op.vC) oy += Math.max(0, (P[1] - m.t - m.b - th * UPX * pg.s) / 2) * PX; }
    function X(c) { return ox + xo[c] * k; } function Y(r) { return oy + yo[r] * k; }
    var showGrid = op.legacy || op.grid;
    function drawCell(r, c, w0, h0, cell) {
      var x = X(c), y = Y(r), w = w0 * k, h = h0 * k; if (w <= 0.5 || h <= 0.5) return;
      var st = env.styleAt(sh, r, c), bg = (st && st.bg) || '';
      if (!bg && cell && cell.s && cell.s.patternType === 'solid' && cell.s.fgColor && /^[0-9A-Fa-f]{6}$/.test(cell.s.fgColor.rgb || '')) bg = '#' + cell.s.fgColor.rgb;
      if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      if (showGrid) { g.strokeStyle = '#d4d4d4'; g.lineWidth = Math.max(1, PX * 0.5); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
      var txt = cell ? env.display(cell) : '';
      if (txt !== '') {
        var fs = ((st && st.fs) ? st.fs * 4 / 3 : 14) * k, font = ((st && st.i) ? 'italic ' : '') + ((st && st.b) ? '700 ' : '400 ') + fs + 'px ' + ((st && st.fn) ? '"' + String(st.fn).replace(/["\\]/g, '') + '",' : '') + FAMILY;
        g.font = font; g.fillStyle = (st && st.color) || '#111'; g.textBaseline = 'middle';
        var al = (st && st.h) || (cell && cell.t === 'n' ? 'right' : (cell && (cell.t === 'b' || cell.t === 'e') ? 'center' : 'left')), pad = 4 * k;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        if (st && st.wrap) {
          var lines = wrapLines(g, txt, Math.max(4, w - 2 * pad)), lh = fs * 1.25, ty = y + Math.max(0, (h - lines.length * lh) / 2) + lh / 2;
          lines.forEach(function (ln, q) { var lw = g.measureText(ln).width, tx = al === 'right' ? x + w - pad - lw : (al === 'center' ? x + (w - lw) / 2 : x + pad); g.fillText(ln, tx, ty + q * lh); if (st.u) g.fillRect(tx, ty + q * lh + fs * 0.45, lw, Math.max(1, fs / 14)); });
        } else {
          var tw2 = g.measureText(txt).width, tx2 = al === 'right' ? x + w - pad - tw2 : (al === 'center' ? x + (w - tw2) / 2 : x + pad), ty2 = y + h / 2;
          g.fillText(txt, tx2, ty2);
          if (st && st.u) g.fillRect(tx2, ty2 + fs * 0.45, tw2, Math.max(1, fs / 14));
          if (st && st.st) g.fillRect(tx2, ty2, tw2, Math.max(1, fs / 14));
        }
        g.restore();
      }
      if (st) {
        g.strokeStyle = '#222'; g.lineWidth = Math.max(1, PX * 0.7);
        if (st.bl) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.stroke(); }
        if (st.br) { g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.stroke(); }
        if (st.bt) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
        if (st.bb) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke(); }
      }
    }
    page.rows.forEach(function (r) {
      if (rowH(r) <= 0) return;
      page.cols.forEach(function (c) { if (colW(c) <= 0 || plan.skip[r + '|' + c]) return; drawCell(r, c, colW(c), rowH(r), env.cellOf(sh, r, c)); });
    });
    plan.merges.forEach(function (mg) {
      if (xo[mg.s.c] == null || yo[mg.s.r] == null) return;
      var w = 0, h = 0, c, r;
      for (c = mg.s.c; c <= mg.e.c; c++) if (xo[c] != null) w += colW(c); for (r = mg.s.r; r <= mg.e.r; r++) if (yo[r] != null) h += rowH(r);
      drawCell(mg.s.r, mg.s.c, w, h, env.cellOf(sh, mg.s.r, mg.s.c));
    });
    // 차트: 이 쪽의 본문 칸 범위와 겹치는 부분만(반복 제목 영역은 건드리지 않음)
    if (plan.charts.length && page.cMain.length && page.rMain.length) {
      var bx0 = sh.colX[page.cMain[0]], bx1 = sh.colX[page.cMain[page.cMain.length - 1] + 1], by0 = sh.rowY[page.rMain[0]], by1 = sh.rowY[page.rMain[page.rMain.length - 1] + 1];
      var baseX = ox + (xo[page.cMain[0]]) * k, baseY = oy + (yo[page.rMain[0]]) * k;
      plan.charts.forEach(function (ch) {
        if (!(ch.box.x < bx1 && ch.box.x + ch.box.w > bx0 && ch.box.y < by1 && ch.box.y + ch.box.h > by0)) return;
        var dx = baseX + (ch.box.x - bx0) * k, dy = baseY + (ch.box.y - by0) * k, dw = ch.box.w * k, dh = ch.box.h * k;
        g.save(); g.beginPath(); g.rect(baseX, baseY, (bx1 - bx0) * k, (by1 - by0) * k); g.clip();
        if (ch.img) g.drawImage(ch.img, dx, dy, dw, dh);
        else { g.fillStyle = '#fff'; g.fillRect(dx, dy, dw, dh); g.strokeStyle = '#99a'; g.setLineDash([6, 4]); g.strokeRect(dx + 1, dy + 1, dw - 2, dh - 2); g.setLineDash([]); g.fillStyle = '#667'; g.font = (11 * PX) + 'px ' + FAMILY; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText('차트 — 모양은 엑셀에서 보입니다', dx + dw / 2, dy + dh / 2); g.textAlign = 'left'; }
        g.restore();
      });
    }
    // 머리글·바닥글
    if (!op.legacy && (op.hdr || op.ftr)) {
      var now = NOW || new Date(), c0 = { page: pi + 1, pages: plan.pages.length, date: now.getFullYear() + '. ' + (now.getMonth() + 1) + '. ' + now.getDate() + '.', time: ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2), sheet: sh.name, file: FILE_NAME };
      g.fillStyle = '#222'; g.font = (9 * PX) + 'px ' + FAMILY; g.textBaseline = 'alphabetic';
      var line = function (str, yBase) {
        var t = hfParse(str, c0), x0 = m.l * PX, x1 = (P[0] - m.r) * PX;
        if (t.L) { g.textAlign = 'left'; g.fillText(t.L, x0, yBase); } if (t.C) { g.textAlign = 'center'; g.fillText(t.C, (x0 + x1) / 2, yBase); } if (t.R) { g.textAlign = 'right'; g.fillText(t.R, x1, yBase); } g.textAlign = 'left';
      };
      if (op.hdr) line(op.hdr, (Math.max(m.hd, 8) + 9) * PX); if (op.ftr) line(op.ftr, (P[1] - Math.max(m.ft, 8)) * PX);
    }
    return cv;
  }

  function run(env) {
    var ctx = env.ctx, list = env.vis.slice(), plans = [];
    ctx.busy('시트와 인쇄 설정을 확인하는 중…');
    var SX = global.SOXlsxStruct, pkg = env.roPkg ? env.roPkg() : null;
    FILE_NAME = String(ctx.name || '').replace(/\.[^.]+$/, ''); NOW = new Date();
    var infoP = SX && pkg ? SX.wbInfo(pkg) : Promise.resolve(null);
    return infoP.then(function (info) {
      var chain = Promise.resolve();
      list.forEach(function (i) {
        chain = chain.then(function () {
          var sh0 = env.prep(i), name = sh0.name, ent = info ? info.sheets.filter(function (s) { return s.name === name; })[0] : null;
          var xmlP = ent && ent.path ? pkg.read(ent.path) : Promise.resolve(''), names = ent && info ? SX.readPrintNames(info, ent.idx) : null;
          return Promise.all([xmlP, env.charts ? env.charts(sh0).catch(function () { return []; }) : Promise.resolve([])]).then(function (r) {
            var op = readSetupXml(r[0] || '', names), plan = planSheet(env, i, op, r[1] || []);
            plans.push(plan); return loadChartImages(plan);
          });
        });
      });
      return chain;
    }).then(function () {
      var n = 0; plans.forEach(function (p) { n += p.pages.length; });
      ctx.busy(null);
      if (!n) { ctx.toast('내보낼 내용이 있는 시트가 없습니다.', 3200); return; }
      if (n > MAX_PAGES) { ctx.toast('쪽이 너무 많아(' + n + '쪽) 폰에서는 내보내지 못합니다(' + MAX_PAGES + '쪽까지). 쪽 수를 줄이려면 인쇄 영역을 정하거나 시트를 나눠 저장하십시오.', 5200); return; }
      var named = plans.filter(function (p) { return p.pages.length; }), shNames = named.map(function (p) { return p.name; });
      var withSetup = named.filter(function (p) { return !p.legacy; }).length, charts = 0; named.forEach(function (p) { charts += p.charts.length; });
      var notes = []; named.forEach(function (p) { p.notes.forEach(function (t) { if (notes.indexOf(t) < 0) notes.push(t); }); });
      ctx.confirm('PDF로 내보낼까요?', '보이는 시트 ' + shNames.length + '개(' + shNames.slice(0, 4).join(', ') + (shNames.length > 4 ? ' 외' : '') + ')를 ' + n + '쪽짜리 PDF 사본으로 만듭니다(원본 문서는 바뀌지 않습니다).\n\n· ' +
        (withSetup ? '엑셀의 인쇄 설정(용지 크기·방향·여백·배율/맞춤·인쇄 영역·반복 제목·쪽 나누기·머리글/바닥글)을 따릅니다. 인쇄 설정이 없는 시트는 한 쪽 폭에 맞춥니다.' : '이 문서에는 인쇄 설정이 없어 시트를 한 쪽 폭에 맞춰 A4로 나눕니다.') + '\n' +
        (charts ? '· 차트 ' + charts + '개는 폰 화면의 그림 모양으로 담깁니다(3차원·콤보 차트는 자리표시).\n' : '') + (notes.length ? '· ' + notes.join(' · ') + '\n' : '') +
        '· 글자가 그림으로 담겨서 PDF에서 글자를 고르거나 검색할 수 없습니다.', '내보내기', function () { build(env, plans, n); }, { cancelLabel: '취소' });
    }).catch(function (e) { ctx.busy(null); ctx.explainFail('PDF 준비에 실패했습니다', e, 5200); });
  }

  function build(env, plans, total) {
    var ctx = env.ctx, done = 0, pdfPages = [], chain = Promise.resolve();
    ctx.busy('PDF 만드는 중… (0/' + total + ')');
    return ctx.loadScript('vendor/so/pdf/pdf-lib.min.js').then(function () {
      plans.forEach(function (p) {
        p.pages.forEach(function (ent, pi) {
          chain = chain.then(function () { return sleep(0); }).then(function () {
            ctx.busy('PDF 만드는 중… (' + (done + 1) + '/' + total + ')');
            var cv = drawPrint(env, p, pi);
            return new Promise(function (res, rej) { cv.toBlob(function (b) { if (!b) { rej(new Error('쪽 그림을 저장하지 못했습니다')); return; } b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, 'image/jpeg', 0.86); }).then(function (bytes) { cv.width = cv.height = 0; pdfPages.push({ bytes: bytes, w: ent.pg.P[0], h: ent.pg.P[1] }); done++; });
          });
        });
      });
      return chain;
    }).then(function () {
      var PL = global.PDFLib; return PL.PDFDocument.create().then(function (doc) {
        var seq = Promise.resolve();
        pdfPages.forEach(function (p) { seq = seq.then(function () { return doc.embedJpg(p.bytes).then(function (im) { var pg = doc.addPage([p.w, p.h]); pg.drawImage(im, { x: 0, y: 0, width: p.w, height: p.h }); }); }); });
        return seq.then(function () { return doc.save(); });
      });
    }).then(function (u8) {
      ctx.busy(null);
      var base = String(ctx.name || 'sheet').replace(/\.[^.]+$/, '');
      return Promise.resolve(ctx.saveCopy(new Blob([u8], { type: 'application/pdf' }), base + '.pdf', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('PDF 사본을 저장했습니다(' + done + '쪽). 원래 문서는 그대로입니다.', 3600); });
    }).catch(function (e) { ctx.busy(null); ctx.explainFail('PDF를 만들지 못했습니다(원본은 그대로입니다)', e, 5200); });
  }

  global.SOXlsxPdf = { run: run, _t: { extent: extent, readSetupXml: readSetupXml, parseAreas: parseAreas, parseTitles: parseTitles, hfParse: hfParse, paginate: paginate, planSheet: planSheet, drawPrint: drawPrint, PAPER_PT: PAPER_PT } };
})(window);
