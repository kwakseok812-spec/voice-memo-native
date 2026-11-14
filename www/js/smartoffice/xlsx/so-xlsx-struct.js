/* so-xlsx-struct.js — S-Office 엑셀 편집 보강(O-0861, v10.4): 줄·칸 넣고 빼기 · 칸 서식 · 칸 합치기 · 줄 높이·칸 너비 · 시트 추가/이름/삭제/순서 · 정렬 · 채우기 · 새 엑셀 문서
 * ----------------------------------------------------------------------------
 * 원본 .xlsx(zip)의 XML 을 직접 고친다(SheetJS 로 다시 쓰지 않는다). 고치는 부분만 바뀌고, 그림·차트·피벗·매크로 같은 나머지는 그대로 둔다.
 * 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용). pkg = { read(path)→Promise<string|null>, write(path,str), remove(path), list()→[path] }.
 * 중간에 줄·칸을 넣고 빼는 일은 「안전 검사」를 통과한 문서에서만 한다 — 수식·병합·이름·차트가 가리키는 칸을 옮겨야 하는데, 옮길 수 없는 구조(공유 수식은 풀어서 처리,
 * 그림·차트·엑셀 표·메모가 든 시트, INDIRECT 같은 글자로 만든 참조 등)가 있으면 이유를 쉬운 말로 돌려주고 하지 않는다.
 */
(function (global) {
  'use strict';

  // ============================== 기본 도우미 ==============================
  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unescX(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function attrOf(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function setAttr(tag, name, val) {
    var re = new RegExp('(\\s' + name + '=")[^"]*(")');
    if (re.test(tag)) return tag.replace(re, function (m, a, b) { return a + val + b; });
    return tag.replace(/\s*(\/?>)$/, ' ' + name + '="' + val + '"$1');
  }
  function delAttr(tag, name) { return tag.replace(new RegExp('\\s' + name + '="[^"]*"'), ''); }
  function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function quoteSheet(n) { return /^[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^R\d*C\d*$/i.test(n) ? n : "'" + n.replace(/'/g, "''") + "'"; }
  var MAXR = 1048576, MAXC = 16384;

  // ============================== 수식 속 참조 옮기기 ==============================
  // 글자(") 안은 건너뛰고, 「시트!A1」「A1:B5」 꼴 참조만 찾는다. 열만(A:A)·줄만(3:3) 참조는 따로 찾아 막는다.
  var REF_SRC = "\"(?:[^\"]|\"\")*\"|(?<![\\w.$'])(?:(?:'((?:[^']|'')+)'|([A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*))!)?(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Z]{1,3})(\\$?)(\\d+))?(?![\\w(.])";
  function mapRefs(f, ownSheet, cb) {          // cb({sheet, a:{ca,c,ra,r}, b:{...}|null}) → 새 {a,b} 또는 null(그대로) 또는 {err}
    var re = new RegExp(REF_SRC, 'g'), out = '', last = 0, m, err = null;
    while ((m = re.exec(f))) {
      if (m[0].charAt(0) === '"') continue;
      var sheet = m[1] != null ? m[1].replace(/''/g, "'") : (m[2] != null ? m[2] : ownSheet);
      var A = { ca: m[3], c: colNum(m[4]), ra: m[5], r: +m[6] }, B = m[10] != null ? { ca: m[7], c: colNum(m[8]), ra: m[9], r: +m[10] } : null;
      var res = cb({ sheet: sheet, a: A, b: B, q: m[1] != null || m[2] != null });
      if (res && res.err) { err = res.err; break; }
      if (!res) continue;
      var pre = m[0].slice(0, m[0].length - (m[3] + m[4] + m[5] + m[6] + (m[10] != null ? ':' + m[7] + m[8] + m[9] + m[10] : '')).length);
      function one(p) { return p.ca + colName(p.c) + p.ra + p.r; }
      out += f.slice(last, m.index) + pre + one(res.a) + (res.b ? ':' + one(res.b) : '');
      last = m.index + m[0].length;
    }
    if (err) return { err: err };
    return { f: out + f.slice(last) };
  }
  function hasDynamic(f) { return /\b(INDIRECT|OFFSET|ADDRESS)\s*\(/i.test(f.replace(/"(?:[^"]|"")*"/g, '""')); }
  function hasWholeLine(f, axis) {
    var t = f.replace(/"(?:[^"]|"")*"/g, '""');
    return axis === 'row' ? /(?<![\w.$])\$?\d+:\$?\d+(?![\w(.])/.test(t) : /(?<![\w.$])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?![\w(.$\d])/.test(t);
  }
  // 한 줄/칸 번호 v 를 넣기·지우기에 맞춰 옮긴다. 돌려주는 값: 새 번호 | 0(지워짐)
  function shiftN(v, at, n, mode) {
    if (mode === 'ins') return v >= at ? v + n : v;
    if (v < at) return v; if (v >= at + n) return v - n; return 0;
  }
  // 범위(s..e)를 옮긴다 → [s2,e2] | null(통째로 지워짐)
  function shiftSpan(s, e, at, n, mode) {
    if (mode === 'ins') return [s >= at ? s + n : s, e >= at ? e + n : e];
    if (e < at) return [s, e];
    if (s >= at + n) return [s - n, e - n];
    if (s >= at && e <= at + n - 1) return null;
    return [s < at ? s : at, e >= at + n ? e - n : at - 1];
  }
  function shiftRefsInFormula(f, ownSheet, tgt, axis, at, n, mode) {
    if (hasDynamic(f)) return { err: 'dyn' };
    if (hasWholeLine(f, axis)) return { err: 'wholeline' };
    return mapRefs(f, ownSheet, function (r) {
      if (!sameName(r.sheet, tgt)) return null;
      var a = r.a, b = r.b || r.a, key = axis === 'row' ? 'r' : 'c';
      var sp = shiftSpan(Math.min(a[key], b[key]), Math.max(a[key], b[key]), at, n, mode);
      if (!sp) return { err: 'deleted' };
      if (!r.b && mode === 'del' && sp[0] > sp[1]) return { err: 'deleted' };
      if (sp[0] > sp[1]) return { err: 'deleted' };
      var na = Object.assign({}, a), nb = r.b ? Object.assign({}, r.b) : null;
      if (nb) { var lo = a[key] <= b[key]; na[key] = lo ? sp[0] : sp[1]; nb[key] = lo ? sp[1] : sp[0]; } else na[key] = sp[0];
      return { a: na, b: nb };
    });
  }
  // 채우기·공유 수식 풀기: 「$」가 없는 참조만 (dr,dc) 만큼 옮긴다
  function translateFormula(f, ownSheet, dr, dc) {
    return mapRefs(f, ownSheet, function (r) {
      function mv(p) { return { ca: p.ca, c: p.ca ? p.c : p.c + dc, ra: p.ra, r: p.ra ? p.r : p.r + dr }; }
      var na = mv(r.a), nb = r.b ? mv(r.b) : null;
      if (na.r < 1 || na.c < 1 || na.r > MAXR || na.c > MAXC || (nb && (nb.r < 1 || nb.c < 1 || nb.r > MAXR || nb.c > MAXC))) return { err: 'range' };
      return { a: na, b: nb };
    });
  }
  function renameInFormula(f, ownSheet, oldN, newN) {         // 시트 이름을 바꿀 때 「옛이름!」 → 「새이름!」
    var re = new RegExp(REF_SRC, 'g'), out = '', last = 0, m;
    while ((m = re.exec(f))) {
      if (m[0].charAt(0) === '"') continue;
      if (m[1] == null && m[2] == null) continue;
      var sh = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
      if (!sameName(sh, oldN)) continue;
      var qLen = (m[1] != null ? m[1].length + 2 : m[2].length) + 1;
      out += f.slice(last, m.index) + quoteSheet(newN) + '!' + m[0].slice(qLen); last = m.index + m[0].length;
    }
    return out + f.slice(last);
  }
  function refsSheet(f, ownSheet, tgt) { var hit = false; mapRefs(f, ownSheet, function (r) { if (sameName(r.sheet, tgt)) hit = true; return null; }); return hit; }

  // 범위 글자(「A1」「A1:C3」)·여러 범위(공백으로 구분)를 옮긴다 → 글자 | null(전부 지워짐)
  function shiftRangeText(txt, axis, at, n, mode) {
    var parts = String(txt).split(/\s+/).filter(Boolean), outp = [];
    parts.forEach(function (p) {
      var m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(p); if (!m) { outp.push(p); return; }
      var c0 = colNum(m[1]), r0 = +m[2], c1 = m[3] ? colNum(m[3]) : c0, r1 = m[4] ? +m[4] : r0;
      var sp = axis === 'row' ? shiftSpan(r0, r1, at, n, mode) : shiftSpan(c0, c1, at, n, mode);
      if (!sp || sp[0] > sp[1]) return;
      if (axis === 'row') { r0 = sp[0]; r1 = sp[1]; } else { c0 = sp[0]; c1 = sp[1]; }
      outp.push(colName(c0) + r0 + (c0 === c1 && r0 === r1 ? '' : ':' + colName(c1) + r1));
    });
    return outp.length ? outp.join(' ') : null;
  }

  // ============================== 시트 XML 읽기·쓰기(줄·칸 단위) ==============================
  function parseSheet(xml) {
    var m = /<sheetData\b[^>]*?(\/?)>/.exec(xml); if (!m) return null;
    var self = m[1] === '/', bodyStart = m.index + m[0].length, end = self ? bodyStart : xml.indexOf('</sheetData>', bodyStart); if (end < 0) return null;
    var sd = { head: xml.slice(0, m.index), open: self ? m[0].replace(/\/>$/, '>') : m[0], tail: xml.slice(self ? bodyStart : end + 12), rows: [] };
    var body = self ? '' : xml.slice(bodyStart, end), rr = /<row\b[^>]*?(\/?)>/g, rm;
    while ((rm = rr.exec(body))) {
      var open = rm[0], rowSelf = rm[1] === '/', inner = '';
      if (rowSelf) open = open.replace(/\s*\/>$/, '>');
      else { var ce = body.indexOf('</row>', rm.index + rm[0].length); if (ce < 0) return null; inner = body.slice(rm.index + rm[0].length, ce); rr.lastIndex = ce + 6; }
      var row = { r: +attrOf(open, 'r'), open: open, cells: [] };
      if (!row.r) return null;
      var cr = /<c\b[^>]*?(\/?)>/g, cm;
      while ((cm = cr.exec(inner))) {
        var raw = cm[0];
        if (cm[1] !== '/') { var e = inner.indexOf('</c>', cm.index + cm[0].length); if (e < 0) return null; raw = inner.slice(cm.index, e + 4); cr.lastIndex = e + 4; }
        var ref = /\sr="([A-Z]+)(\d+)"/.exec(raw); if (!ref) return null;
        row.cells.push({ c: colNum(ref[1]), raw: raw });
      }
      sd.rows.push(row);
    }
    return sd;
  }
  function serializeSheet(sd) {
    var out = [sd.head, sd.open];
    sd.rows.forEach(function (row) { out.push(row.open, row.cells.map(function (c) { return c.raw; }).join(''), '</row>'); });
    out.push('</sheetData>', sd.tail); return out.join('');
  }
  function getRow(sd, r, create) {
    var lo = 0, hi = sd.rows.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (sd.rows[mid].r < r) lo = mid + 1; else hi = mid; }
    if (lo < sd.rows.length && sd.rows[lo].r === r) return sd.rows[lo];
    if (!create) return null;
    var row = { r: r, open: '<row r="' + r + '">', cells: [] }; sd.rows.splice(lo, 0, row); return row;
  }
  function openTagOfCell(raw) { return /^<c\b[^>]*>/.exec(raw)[0]; }
  function cellStyleOf(raw) { var s = attrOf(openTagOfCell(raw), 's'); return s == null ? 0 : +s; }
  function setCellAttr(cell, name, val) { var ot = openTagOfCell(cell.raw); cell.raw = setAttr(ot, name, val) + cell.raw.slice(ot.length); }
  function getCell(row, c, create, ref) {
    var lo = 0, hi = row.cells.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (row.cells[mid].c < c) lo = mid + 1; else hi = mid; }
    if (lo < row.cells.length && row.cells[lo].c === c) return row.cells[lo];
    if (!create) return null;
    var cell = { c: c, raw: '<c r="' + colName(c) + row.r + '"/>' }; row.cells.splice(lo, 0, cell); return cell;
  }
  function renumberCell(cell, newRow, newCol) {
    cell.raw = cell.raw.replace(/^(<c\b[^>]*?\sr=")([A-Z]+)(\d+)(")/, function (m, a, col, row, d) { return a + (newCol ? colName(newCol) : col) + (newRow || row) + d; });
    if (newCol) cell.c = newCol;
  }
  function renumberRow(row, newR) {
    row.r = newR; row.open = setAttr(row.open, 'r', String(newR));
    row.cells.forEach(function (c) { renumberCell(c, newR, 0); });
  }
  function dimensionOf(sd) {
    var r0 = 0, r1 = 0, c0 = 0, c1 = 0;
    sd.rows.forEach(function (row) { row.cells.forEach(function (c) { if (!r0 || row.r < r0) r0 = row.r; if (row.r > r1) r1 = row.r; if (!c0 || c.c < c0) c0 = c.c; if (c.c > c1) c1 = c.c; }); });
    if (!r1) return 'A1';
    var s = colName(c0) + r0, e = colName(c1) + r1; return s === e ? s : s + ':' + e;
  }
  function setDimension(xml, dim) {
    if (/<dimension\b/.test(xml)) return xml.replace(/<dimension\s+ref="[^"]*"\s*\/>/, '<dimension ref="' + dim + '"/>');
    return xml.replace(/(<worksheet\b[^>]*>(?:<sheetPr\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetPr>))?)/, '$1<dimension ref="' + dim + '"/>');
  }
  // 워크시트 자식 순서표 — 새 요소를 끼워 넣을 자리를 정한다
  var WS_ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
  function elemEnd(xml, name, from) {
    var re = new RegExp('<' + name + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + name + '>)', 'g'), last = null, m; re.lastIndex = from || 0;
    while ((m = re.exec(xml))) last = m; return last;
  }
  function insertWsElement(xml, name, elemXml) {
    var idx = WS_ORDER.indexOf(name), pos = -1, i;
    for (i = idx - 1; i >= 0 && pos < 0; i--) { var m = elemEnd(xml, WS_ORDER[i]); if (m) pos = m.index + m[0].length; }
    if (pos < 0) { var wm = /<worksheet\b[^>]*>/.exec(xml); pos = wm.index + wm[0].length; }
    return xml.slice(0, pos) + elemXml + xml.slice(pos);
  }

  // ============================== 꾸러미(pkg) 도우미 ==============================
  function wbInfo(pkg) {
    return Promise.all([pkg.read('xl/workbook.xml'), pkg.read('xl/_rels/workbook.xml.rels'), pkg.read('[Content_Types].xml')]).then(function (a) {
      var wb = a[0], rels = a[1], ct = a[2]; if (!wb || !rels) return null;
      var rel = {};
      (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) {
        var id = attrOf(t, 'Id'), tg = attrOf(t, 'Target'); if (!id || tg == null) return;
        var p = tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg, parts = [];
        p.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x); });
        rel[id] = { path: parts.join('/'), type: attrOf(t, 'Type') || '' };
      });
      var sheets = [];
      (wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t, i) {
        var rid = (/\s(?:\w+:)id="([^"]+)"/.exec(t) || [])[1], rr = rid && rel[rid];
        sheets.push({ name: unescX(attrOf(t, 'name') || ''), tag: t, rid: rid, path: rr && /\/worksheet$/.test(rr.type) ? rr.path : null, idx: i, state: attrOf(t, 'state') });
      });
      return { wb: wb, rels: rels, ct: ct, rel: rel, sheets: sheets };
    });
  }
  function readSheets(pkg, info) {     // 모든 워크시트 XML 을 읽어 info.sheets[i].xml 에 둔다
    return Promise.all(info.sheets.map(function (s) { return s.path ? pkg.read(s.path).then(function (x) { s.xml = x; }) : null; }));
  }
  function relTypesOf(pkg, path) {
    var rp = path.replace(/([^\/]+)$/, '_rels/$1.rels');
    return pkg.read(rp).then(function (x) { return x ? (x.match(/<Relationship\b[^>]*>/g) || []).map(function (t) { return (attrOf(t, 'Type') || '').replace(/^.*\//, ''); }) : []; });
  }
  // 수식 글자들을 모두 훑는다: cb(text, ownSheetName) → 새 글자 | {err} | undefined(그대로)
  function eachFormula(xml, ownSheet, cb) {
    var err = null, out = xml.replace(/<f\b([^>]*)>([^<]*)<\/f>/g, function (all, at, txt) {
      if (err) return all;
      var r = cb(unescX(txt), ownSheet, at); if (r == null) return all;
      if (typeof r === 'object') { err = r.err; return all; }
      return '<f' + at + '>' + escX(r) + '</f>';
    });
    return err ? { err: err } : { xml: out };
  }
  function expandShared(xml, ownSheet) {            // 공유 수식을 칸마다 적은 수식으로 푼다
    if (!/t="shared"/.test(xml)) return { xml: xml };
    var masters = {}, re = /<c\b[^>]*\sr="([A-Z]+)(\d+)"[^>]*>(?:(?!<\/c>)[\s\S])*?<f\b[^>]*?t="shared"[^>]*?>([^<]+)<\/f>/g, m;
    while ((m = re.exec(xml))) { var ft = /<f\b[^>]*>/.exec(m[0])[0], si = attrOf(ft, 'si'); if (si != null) masters[si] = { col: colNum(m[1]), row: +m[2], f: unescX(m[3]) }; }
    var err = null;
    var out = xml.replace(/<c\b([^>]*?)\sr="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g, function (all, a1, col, row, a2, inner) {
      if (err || inner.indexOf('t="shared"') < 0) return all;
      var fm = /<f\b([^>]*?)(\/?)>(?:([^<]*)<\/f>)?/.exec(inner); if (!fm || attrOf(' ' + fm[1], 't') !== 'shared') return all;
      var si = attrOf(' ' + fm[1], 'si'), ms = masters[si]; if (!ms) { err = 'shared'; return all; }
      var tr = translateFormula(ms.f, ownSheet, +row - ms.row, colNum(col) - ms.col);
      if (tr.err) { err = 'shared'; return all; }
      var nf = '<f>' + escX(tr.f) + '</f>';
      return '<c' + a1 + ' r="' + col + row + '"' + a2 + '>' + inner.replace(fm[0], nf) + '</c>';
    });
    return err ? { err: err } : { xml: out };
  }

  // ============================== 줄·칸 넣고 빼기 ==============================
  var WHY = {
    obj: '이 시트에는 그림·차트·엑셀 표·메모 같은 개체가 있어서, 중간에 줄이나 칸을 넣고 빼면 그 개체가 어긋날 수 있습니다.',
    chart: '차트가 이 시트의 칸을 가리키고 있어서, 중간에 줄이나 칸을 넣고 빼면 차트가 어긋날 수 있습니다.',
    dyn: '칸 주소를 글자로 조합해서 찾아가는 수식(주소를 문자로 만들어 쓰는 함수)이 있어서, 중간에 줄이나 칸을 넣고 빼면 숫자가 어긋날 수 있습니다.',
    wholeline: '줄 전체나 칸 전체를 가리키는 수식이 있어서 중간에 넣고 빼기가 어렵습니다.',
    deleted: '수식이 지우려는 칸을 직접 쓰고 있어서, 지우면 계산이 깨집니다. 수식을 먼저 고쳐 주십시오.',
    shared: '수식 구조가 특이해서 중간에 줄이나 칸을 넣고 빼기가 어렵습니다.',
    cf: '조건부 서식이나 입력 제한이 칸 주소를 쓰고 있어서, 중간에 줄이나 칸을 넣고 빼면 어긋날 수 있습니다.',
    breaks: '쪽 나누기 표시가 있어서 중간에 줄이나 칸을 넣고 빼기가 어렵습니다.',
    sheet: '이 시트를 찾지 못했습니다.',
    range: '수식 계산 중 범위를 벗어나는 칸이 생겨서 할 수 없습니다.'
  };
  function lineEdit(pkg, sheetName, axis, at, n, mode) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var tgt = null; info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return readSheets(pkg, info).then(function () { return relTypesOf(pkg, tgt.path); }).then(function (rt) {
        if (rt.some(function (t) { return t !== 'hyperlink' && t !== 'printerSettings'; })) return { err: WHY.obj, why: 'obj' };
        // 이 시트의 칸을 가리키는 차트가 있으면 막는다
        var chartP = pkg.list().filter(function (p) { return /^xl\/charts\/chart[^\/]*\.xml$/.test(p); });
        return Promise.all(chartP.map(function (p) { return pkg.read(p); })).then(function (cs) {
          for (var i = 0; i < cs.length; i++) { var fs = (cs[i] || '').match(/<c:f>[^<]*<\/c:f>/g) || []; if (fs.some(function (t) { return refsSheet(unescX(t.replace(/<\/?c:f>/g, '')), '', tgt.name); })) return { err: WHY.chart, why: 'chart' }; }
          return null;
        });
      }).then(function (blk) {
        if (blk) return blk;
        // 수식 풀기·옮기기(모든 시트)
        var plan = [], i, s;
        for (i = 0; i < info.sheets.length; i++) {
          s = info.sheets[i]; if (!s.path || s.xml == null) continue;
          var ex = expandShared(s.xml, s.name); if (ex.err) return { err: WHY.shared, why: 'shared' };
          if (s === tgt && mode === 'del') {        // 지워질 줄·칸 안의 수식은 어차피 사라지므로, 먼저 걷어 낸 뒤 남는 수식만 검사한다
            var d0 = parseSheet(ex.xml); if (!d0) return { err: WHY.sheet };
            if (axis === 'row') d0.rows = d0.rows.filter(function (row) { return row.r < at || row.r >= at + n; });
            else d0.rows.forEach(function (row) { row.cells = row.cells.filter(function (c) { return c.c < at || c.c >= at + n; }); });
            ex = { xml: serializeSheet(d0) };
          }
          if (/t="(array|dataTable)"/.test(ex.xml)) return { err: WHY.shared, why: 'shared' };
          var ed = eachFormula(ex.xml, s.name, function (t, own) { var r = shiftRefsInFormula(t, own, tgt.name, axis, at, n, mode); return r.err ? { err: r.err } : (r.f === t ? null : r.f); });
          if (ed.err) return { err: WHY[ed.err] || WHY.shared, why: ed.err };
          plan.push({ s: s, xml: ed.xml });
        }
        // 이름 정의(범위 이름 · 인쇄 영역)
        var wbx = info.wb, nerr = null;
        wbx = wbx.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, function (all, o, txt, c) {
          if (nerr) return all;
          var r = shiftRefsInFormula(unescX(txt), '', tgt.name, axis, at, n, mode); if (r.err) { nerr = r.err; return all; }
          return o + escX(r.f) + c;
        });
        if (nerr) return { err: WHY[nerr] || WHY.shared, why: nerr };
        // 대상 시트 본문
        var tp = null; plan.forEach(function (p) { if (p.s === tgt) tp = p; });
        var xml = tp.xml, sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        if (new RegExp('<' + (axis === 'row' ? 'rowBreaks' : 'colBreaks') + '\\b').test(xml)) return { err: WHY.breaks, why: 'breaks' };
        var cfok = true;
        (xml.match(/<(?:formula|formula1|formula2)>[^<]*<\/(?:formula|formula1|formula2)>/g) || []).forEach(function (t) { var tx = unescX(t.replace(/<\/?formula\d?>/g, '')); if (mapRefsHit(tx)) cfok = false; });
        if (!cfok) return { err: WHY.cf, why: 'cf' };
        // 줄·칸 옮기기
        var k;
        if (axis === 'row') {
          var rows = [];
          sd.rows.forEach(function (row) {
            if (mode === 'ins') { if (row.r >= at) renumberRow(row, row.r + n); rows.push(row); }
            else if (row.r < at) rows.push(row); else if (row.r >= at + n) { renumberRow(row, row.r - n); rows.push(row); }
          });
          if (mode === 'ins') {
            // 넣은 줄은 위 줄의 칸 서식을 이어받는다(값은 비움)
            var above = null; rows.forEach(function (r) { if (r.r === at - 1) above = r; });
            for (k = 0; k < n; k++) {
              var nr = { r: at + k, open: '<row r="' + (at + k) + '"' + (above ? above.open.replace(/^<row\b/, '').replace(/\sr="\d+"/, '').replace(/\sspans="[^"]*"/, '').replace(/>$/, '') : '') + '>', cells: [] };
              if (above) above.cells.forEach(function (c) { var s0 = cellStyleOf(c.raw); if (s0) nr.cells.push({ c: c.c, raw: '<c r="' + colName(c.c) + (at + k) + '" s="' + s0 + '"/>' }); });
              rows.push(nr);
            }
            rows.sort(function (a, b) { return a.r - b.r; });
          }
          sd.rows = rows;
        } else {
          sd.rows.forEach(function (row) {
            var cells = [];
            row.cells.forEach(function (c) {
              if (mode === 'ins') { if (c.c >= at) renumberCell(c, 0, c.c + n); cells.push(c); }
              else if (c.c < at) cells.push(c); else if (c.c >= at + n) { renumberCell(c, 0, c.c - n); cells.push(c); }
            });
            row.cells = cells; row.open = delAttr(row.open, 'spans');
          });
        }
        xml = serializeSheet(sd);
        // 병합·하이퍼링크·자동 필터·조건부 서식 범위·입력 제한 범위·칸 너비 정의
        xml = xml.replace(/<mergeCell\b[^>]*?\sref="([^"]*)"[^>]*\/>/g, function (all, ref) { var r = shiftRangeText(ref, axis, at, n, mode); return r && r.indexOf(':') > 0 ? all.replace(ref, r) : ''; });
        xml = xml.replace(/<mergeCells\b[^>]*>\s*<\/mergeCells>/, '').replace(/<mergeCells\b([^>]*?)\scount="\d+"/, function (all, a) { var c = (xml.match(/<mergeCell\b/g) || []).length; return '<mergeCells' + a + ' count="' + c + '"'; });
        xml = xml.replace(/(<(?:hyperlink|autoFilter)\b[^>]*?\sref=")([^"]*)(")/g, function (all, a, ref, c) { var r = shiftRangeText(ref, axis, at, n, mode); return r ? a + r + c : a + ref + c; });
        xml = xml.replace(/(<(?:conditionalFormatting|dataValidation)\b[^>]*?\ssqref=")([^"]*)(")/g, function (all, a, ref, c) { var r = shiftRangeText(ref, axis, at, n, mode); return r ? a + r + c : a + ref + c; });
        if (axis === 'col' && /<cols\b/.test(xml)) {
          xml = xml.replace(/<col\b[^>]*\/>/g, function (t) {
            var mn = +attrOf(t, 'min'), mx = +attrOf(t, 'max'), sp = shiftSpan(mn, mx, at, n, mode);
            if (!sp || sp[0] > sp[1]) return '';
            return setAttr(setAttr(t, 'min', String(sp[0])), 'max', String(sp[1]));
          });
          xml = xml.replace(/<cols\b[^>]*>\s*<\/cols>/, '');
        }
        xml = setDimension(xml, dimensionOf(parseSheet(xml)));
        tp.xml = xml;
        plan.forEach(function (p) { pkg.write(p.s.path, p.xml); });
        pkg.write('xl/workbook.xml', wbx);
        return { ok: true };
      });
    });
    function mapRefsHit(t) { return new RegExp(REF_SRC).test(t.replace(/"(?:[^"]|"")*"/g, '""')); }
  }
  // 맨 끝에 줄 붙이기: 참조를 옮길 일이 없어 언제나 된다. 마지막 줄의 칸 서식을 이어받는다.
  function appendRows(pkg, sheetName, n) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var last = sd.rows.length ? sd.rows[sd.rows.length - 1] : null, base = last ? last.r : 0;
        if (base + n > MAXR) return { err: '더 이상 줄을 넣을 수 없습니다.' };
        for (var k = 1; k <= n; k++) {
          var nr = { r: base + k, open: '<row r="' + (base + k) + '"' + (last ? last.open.replace(/^<row\b/, '').replace(/\sr="\d+"/, '').replace(/\sspans="[^"]*"/, '').replace(/>$/, '') : '') + '>', cells: [] };
          if (last) last.cells.forEach(function (c) { var s0 = cellStyleOf(c.raw); if (s0) nr.cells.push({ c: c.c, raw: '<c r="' + colName(c.c) + (base + k) + '" s="' + s0 + '"/>' }); });
          sd.rows.push(nr);
        }
        var out = serializeSheet(sd); out = setDimension(out, dimensionOf(parseSheet(out))); pkg.write(tgt.path, out);
        return { ok: true, firstRow: base + 1 };
      });
    });
  }

  // ============================== 칸 서식(styles.xml) ==============================
  function Styles(xml) {
    this.xml = xml; this.cache = {};
    function sect(name) { var m = new RegExp('<' + name + '\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + name + '>)').exec(xml); return m ? { whole: m[0], inner: m[1] || '' } : null; }
    function items(inner, tag) { var re = new RegExp('<' + tag + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + tag + '>)', 'g'); return inner.match(re) || []; }
    var f = sect('fonts'), fl = sect('fills'), b = sect('borders'), cx = sect('cellXfs'), nf = sect('numFmts');
    this.hasAll = !!(f && fl && b && cx);
    if (!this.hasAll) return;
    this.sec = { fonts: f, fills: fl, borders: b, cellXfs: cx, numFmts: nf };
    this.fonts = items(f.inner, 'font'); this.fills = items(fl.inner, 'fill'); this.borders = items(b.inner, 'border'); this.xfs = items(cx.inner, 'xf');
    this.nfs = nf ? items(nf.inner, 'numFmt') : [];
    this.base = { fonts: this.fonts.length, fills: this.fills.length, borders: this.borders.length, xfs: this.xfs.length, nfs: this.nfs.length };
  }
  Styles.prototype.add = function (listName, s) { var l = this[listName], i = l.indexOf(s); if (i < 0) { l.push(s); i = l.length - 1; } return i; };
  Styles.prototype.nfId = function (code) {
    var B = { 'General': 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
    if (B[code] != null) return B[code];
    for (var i = 0; i < this.nfs.length; i++) if (unescX(attrOf(this.nfs[i], 'formatCode') || '') === code) return +attrOf(this.nfs[i], 'numFmtId');
    var mx = 163; this.nfs.forEach(function (t) { mx = Math.max(mx, +attrOf(t, 'numFmtId')); });
    this.nfs.push('<numFmt numFmtId="' + (mx + 1) + '" formatCode="' + escX(code) + '"/>'); return mx + 1;
  };
  function fontKids(f) { var inner = /^<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)$/.exec(f), kids = {}; if (inner && inner[1]) (inner[1].match(/<(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g) || []).forEach(function (k) { kids[/^<(\w+)/.exec(k)[1]] = k; }); return kids; }
  var FONT_ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme'];
  function buildFont(kids) { var s = '<font>'; FONT_ORDER.forEach(function (k) { if (kids[k]) s += kids[k]; }); Object.keys(kids).forEach(function (k) { if (FONT_ORDER.indexOf(k) < 0) s += kids[k]; }); return s + '</font>'; }
  function argb(hex) { return 'FF' + hex.replace('#', '').toUpperCase(); }
  function borderFor(sides) {      // sides: {l,r,t,b} 참/거짓
    function s(n, on) { return on ? '<' + n + ' style="thin"><color auto="1"/></' + n + '>' : '<' + n + '/>'; }
    return '<border>' + s('left', sides.l) + s('right', sides.r) + s('top', sides.t) + s('bottom', sides.b) + '<diagonal/></border>';
  }
  // 칸 서식 번호 s 에 바꿈(ch)을 얹은 새 서식 번호. ch = {bold, italic, color, bg, align, nf, wrap, border:{l,r,t,b}}
  Styles.prototype.derive = function (s, ch) {
    var key = s + '|' + JSON.stringify(ch); if (this.cache[key] != null) return this.cache[key];
    var xf = this.xfs[s] || this.xfs[0], open = /^<xf\b[^>]*>/.exec(xf)[0].replace(/\/>$/, '>'), body = /^<xf\b[^>]*?(?:\/>|>([\s\S]*?)<\/xf>)$/.exec(xf)[1] || '';
    var fontId = +(attrOf(open, 'fontId') || 0), fillId = +(attrOf(open, 'fillId') || 0), borderId = +(attrOf(open, 'borderId') || 0), nfId = +(attrOf(open, 'numFmtId') || 0);
    if (ch.bold != null || ch.italic != null || ch.color !== undefined || ch.fontName || ch.fontSize) {
      var kids = fontKids(this.fonts[fontId] || '<font/>');
      if (ch.bold != null) { if (ch.bold) kids.b = '<b/>'; else delete kids.b; }
      if (ch.italic != null) { if (ch.italic) kids.i = '<i/>'; else delete kids.i; }
      if (ch.color !== undefined) { if (ch.color) kids.color = '<color rgb="' + argb(ch.color) + '"/>'; else delete kids.color; }
      if (ch.fontName) { kids.name = '<name val="' + escX(ch.fontName) + '"/>'; delete kids.scheme; delete kids.charset; }
      if (ch.fontSize) kids.sz = '<sz val="' + ch.fontSize + '"/>';
      fontId = this.add('fonts', buildFont(kids)); open = setAttr(open, 'applyFont', '1');
    }
    if (ch.bg !== undefined) {
      fillId = ch.bg ? this.add('fills', '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(ch.bg) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
      open = setAttr(open, 'applyFill', '1');
    }
    if (ch.border) { borderId = this.add('borders', borderFor(ch.border)); open = setAttr(open, 'applyBorder', '1'); }
    if (ch.nf != null) { nfId = this.nfId(ch.nf); open = setAttr(open, 'applyNumberFormat', '1'); }
    if (ch.align !== undefined || ch.wrap != null) {
      var am = /<alignment\b[^>]*?\/>/.exec(body) || /<alignment\b[^>]*>[\s\S]*?<\/alignment>/.exec(body), al = am ? /^<alignment\b[^>]*?>/.exec(am[0])[0].replace(/\/>$/, '/>') : '<alignment/>';
      if (ch.align !== undefined) al = ch.align ? setAttr(al, 'horizontal', ch.align) : delAttr(al, 'horizontal');
      if (ch.wrap != null) al = ch.wrap ? setAttr(al, 'wrapText', '1') : delAttr(al, 'wrapText');
      body = am ? body.replace(am[0], al) : al + body; open = setAttr(open, 'applyAlignment', '1');
    }
    open = setAttr(setAttr(setAttr(setAttr(open, 'fontId', String(fontId)), 'fillId', String(fillId)), 'borderId', String(borderId)), 'numFmtId', String(nfId));
    var nx = body ? open + body + '</xf>' : open.replace(/>$/, '/>');
    var idx = this.add('xfs', nx); this.cache[key] = idx; return idx;
  };
  Styles.prototype.serialize = function () {
    if (!this.hasAll) return this.xml;
    var x = this.xml, S = this.sec, B = this.base, self = this;
    function rep(name, list, o) { var m = S[name]; if (!m) return; x = x.replace(m.whole, '<' + name + ' count="' + list.length + '"' + (/^<\w+\b([^>]*?)>/.exec(m.whole)[1].replace(/\scount="\d+"/, '').replace(/\/$/, '')) + '>' + list.join('') + '</' + name + '>'); }
    rep('fonts', this.fonts); rep('fills', this.fills); rep('borders', this.borders); rep('cellXfs', this.xfs);
    if (S.numFmts) rep('numFmts', this.nfs);
    else if (this.nfs.length) x = x.replace(/(<styleSheet\b[^>]*>)/, '$1<numFmts count="' + this.nfs.length + '">' + this.nfs.join('') + '</numFmts>');
    return x;
  };
  // 서식 읽기(그리기용): 칸 서식 번호 → { b, i, color, bg, h, wrap, bl, br, bt, bb }
  Styles.prototype.resolve = function (s) {
    if (!this.hasAll) return null;
    var xf = this.xfs[s]; if (!xf) return null;
    var open = /^<xf\b[^>]*>/.exec(xf)[0], o = {};
    var kids = fontKids(this.fonts[+(attrOf(open, 'fontId') || 0)] || '<font/>');
    if (kids.b) o.b = true; if (kids.i) o.i = true; if (kids.u) o.u = true;
    var szm = kids.sz && /\sval="([\d.]+)"/.exec(kids.sz); if (szm) o.fs = +szm[1]; var fnm = kids.name && /\sval="([^"]*)"/.exec(kids.name); if (fnm) o.fn = unescX(fnm[1]);
    var cm = kids.color && /\srgb="([0-9A-Fa-f]{8})"/.exec(kids.color); if (cm) o.color = '#' + cm[1].slice(2);
    var fill = this.fills[+(attrOf(open, 'fillId') || 0)] || '', fm = /<patternFill\b[^>]*patternType="solid"[^>]*>\s*<fgColor\b[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(fill); if (fm) o.bg = '#' + fm[1].slice(2);
    var am = /<alignment\b[^>]*>/.exec(xf); if (am) { var h = attrOf(am[0], 'horizontal'); if (h === 'center' || h === 'left' || h === 'right' || h === 'centerContinuous') o.h = h === 'centerContinuous' ? 'center' : h; if (/wrapText="(1|true)"/.test(am[0])) o.wrap = true; }
    var bd = this.borders[+(attrOf(open, 'borderId') || 0)] || '';
    ['left', 'right', 'top', 'bottom'].forEach(function (side, i) { if (new RegExp('<' + side + '\\b[^>]*\\sstyle="(?!none)').test(bd)) o['b' + 'lrtb'.charAt(i)] = true; });
    return o;
  };

  // 범위 안 모든 칸에 서식 바꿈을 적용한다. rng = {r0,c0,r1,c1}(1부터)
  function applyStyle(pkg, sheetName, rng, ch) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return Promise.all([pkg.read(tgt.path), pkg.read('xl/styles.xml')]).then(function (a) {
        var sd = parseSheet(a[0]); if (!sd) return { err: WHY.sheet };
        if (!a[1]) return { err: '서식 정보를 찾지 못했습니다.' };
        var st = new Styles(a[1]); if (!st.hasAll) return { err: '이 문서의 서식 정보가 특이해서 폰에서는 서식을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        var area = (rng.r1 - rng.r0 + 1) * (rng.c1 - rng.c0 + 1); if (area > 200000) return { err: '한 번에 서식을 바꿀 수 있는 칸은 20만 칸까지입니다.' };
        for (var r = rng.r0; r <= rng.r1; r++) {
          var row = getRow(sd, r, true);
          for (var c = rng.c0; c <= rng.c1; c++) {
            var cell = getCell(row, c, true), c2 = ch;
            if (ch.borderMode) {
              var m = ch.borderMode, all = m === 'all', outer = m === 'outer';
              c2 = Object.assign({}, ch); delete c2.borderMode;
              c2.border = m === 'none' ? { l: 0, r: 0, t: 0, b: 0 } : { l: all || (outer && c === rng.c0), r: all || (outer && c === rng.c1), t: all || (outer && r === rng.r0), b: all || (outer && r === rng.r1) };
              if (outer) { var cur = st.resolve(cellStyleOf(cell.raw)); if (cur) { c2.border = { l: c2.border.l || !!cur.bl, r: c2.border.r || !!cur.br, t: c2.border.t || !!cur.bt, b: c2.border.b || !!cur.bb }; } }
            }
            setCellAttr(cell, 's', String(st.derive(cellStyleOf(cell.raw), c2)));
          }
        }
        var out = serializeSheet(sd); out = setDimension(out, dimensionOf(parseSheet(out)));
        pkg.write(tgt.path, out); pkg.write('xl/styles.xml', st.serialize());
        return { ok: true };
      });
    });
  }

  // ============================== 칸 합치기 · 줄 높이 · 칸 너비 ==============================
  function mergeCellsOp(pkg, sheetName, rng, unmerge) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var list = (xml.match(/<mergeCell\b[^>]*?\sref="[^"]*"[^>]*\/>/g) || []).map(function (t) { return attrOf(t, 'ref'); }), keep = [], removed = 0;
        function parse(ref) { var m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref); return { c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3]), r1: +m[4] }; }
        list.forEach(function (ref) {
          var m = parse(ref), hit = !(m.r1 < rng.r0 || m.r0 > rng.r1 || m.c1 < rng.c0 || m.c0 > rng.c1);
          if (hit) removed++; else keep.push(ref);
        });
        if (unmerge) { if (!removed) return { err: '합쳐진 칸이 아닙니다.' }; }
        else {
          if (rng.r0 === rng.r1 && rng.c0 === rng.c1) return { err: '합칠 칸을 두 칸 이상 골라 주십시오.' };
          keep.push(colName(rng.c0) + rng.r0 + ':' + colName(rng.c1) + rng.r1);
        }
        xml = xml.replace(/<mergeCells\b[^>]*?(?:\/>|>[\s\S]*?<\/mergeCells>)/, '');
        if (keep.length) xml = insertWsElement(xml, 'mergeCells', '<mergeCells count="' + keep.length + '">' + keep.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') + '</mergeCells>');
        if (!unmerge) {       // 왼쪽 위 칸 값만 남긴다(나머지 칸의 값은 지우고 서식만 둔다)
          var sd = parseSheet(xml), lost = 0;
          for (var r = rng.r0; r <= rng.r1; r++) { var row = getRow(sd, r, false); if (!row) continue; row.cells.forEach(function (c) {
            if (c.c < rng.c0 || c.c > rng.c1 || (r === rng.r0 && c.c === rng.c0)) return;
            if (!/\/>$/.test(c.raw)) { lost++; var s0 = cellStyleOf(c.raw); c.raw = '<c r="' + colName(c.c) + r + '"' + (s0 ? ' s="' + s0 + '"' : '') + '/>'; }
          }); }
          xml = serializeSheet(sd);
          pkg.write(tgt.path, xml); return { ok: true, lost: lost };
        }
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  function setRowHeight(pkg, sheetName, r0, r1, pt) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        for (var r = r0; r <= r1; r++) { var row = getRow(sd, r, true); row.open = pt ? setAttr(setAttr(row.open, 'ht', String(pt)), 'customHeight', '1') : delAttr(delAttr(row.open, 'ht'), 'customHeight'); }
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true };
      });
    });
  }
  function setColWidth(pkg, sheetName, c0, c1, ch) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var cols = (xml.match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attrOf(t, 'min'), max: +attrOf(t, 'max'), tag: t }; }), out = [];
        cols.forEach(function (cl) {            // 겹치는 정의를 잘라 낸다
          if (cl.max < c0 || cl.min > c1) { out.push(cl); return; }
          if (cl.min < c0) out.push({ min: cl.min, max: c0 - 1, tag: setAttr(setAttr(cl.tag, 'min', String(cl.min)), 'max', String(c0 - 1)) });
          if (cl.max > c1) out.push({ min: c1 + 1, max: cl.max, tag: setAttr(setAttr(cl.tag, 'min', String(c1 + 1)), 'max', String(cl.max)) });
        });
        if (ch) out.push({ min: c0, max: c1, tag: '<col min="' + c0 + '" max="' + c1 + '" width="' + ch + '" customWidth="1"/>' });
        out.sort(function (a, b) { return a.min - b.min; });
        xml = xml.replace(/<cols\b[^>]*?(?:\/>|>[\s\S]*?<\/cols>)/, '');
        if (out.length) xml = insertWsElement(xml, 'cols', '<cols>' + out.map(function (x) { return x.tag; }).join('') + '</cols>');
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }

  // ============================== 정렬 · 채우기 ==============================
  // order = 새 위치 순서대로 늘어놓은 옛 줄 번호들(rng.r0.. 순서). 줄이 옮겨 가면 수식 속 상대 참조도 따라간다. 합쳐진 칸이 든 범위는 하지 않는다.
  function sortRows(pkg, sheetName, rng, order) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var xml = ex.xml, sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var i, j, row, ferr = false;
        if ((xml.match(/<mergeCell\b[^>]*?\sref="[^"]*"/g) || []).some(function (t) { var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(attrOf(t, 'ref')); var c0 = colNum(m[1]), r0 = +m[2], c1 = m[3] ? colNum(m[3]) : c0, r1 = m[4] ? +m[4] : r0; return !(r1 < rng.r0 || r0 > rng.r1 || c1 < rng.c0 || c0 > rng.c1); })) return { err: '정렬할 범위에 합쳐진 칸이 있어서 정렬할 수 없습니다. 도구줄 「칸 합치기」의 「합치기 풀기」로 먼저 푼 뒤 정렬하십시오. 합친 채로 정렬해야 하면 「수정 요청」으로 맡겨 주십시오.' };
        var moved = {};
        for (i = rng.r0; i <= rng.r1; i++) {
          row = getRow(sd, i, false); moved[i] = [];
          if (row) { var keep = []; row.cells.forEach(function (c) { if (c.c >= rng.c0 && c.c <= rng.c1) moved[i].push(c); else keep.push(c); }); row.cells = keep; }
        }
        for (i = 0; i < order.length; i++) {
          var nr = rng.r0 + i, tr = getRow(sd, nr, true), src = moved[order[i]] || [];
          src.forEach(function (c) {
            if (/<f\b/.test(c.raw)) c.raw = c.raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at0, txt) {      // 줄이 옮겨 간 만큼 수식 속 상대 참조도 따라간다(엑셀과 같은 방식)
              var tr2 = translateFormula(unescX(txt), tgt.name, nr - order[i], 0); if (tr2.err) { ferr = true; return all; } return '<f' + at0 + '>' + escX(tr2.f) + '</f>';
            });
            renumberCell(c, nr, 0); var at = 0; while (at < tr.cells.length && tr.cells[at].c < c.c) at++; tr.cells.splice(at, 0, c);
          });
        }
        if (ferr) return { err: WHY.range };
        pkg.write(tgt.path, serializeSheet(sd)); return { ok: true };
      });
    });
  }
  // 범위의 첫 줄을 아래 줄들에 채운다(수식은 참조를 줄 수만큼 옮김). 서식도 함께 옮긴다.
  function fillDown(pkg, sheetName, rng) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var srow = getRow(sd, rng.r0, false), err = null, n = 0;
        for (var r = rng.r0 + 1; r <= rng.r1 && !err; r++) {
          var row = getRow(sd, r, true), dr = r - rng.r0;
          for (var c = rng.c0; c <= rng.c1 && !err; c++) {
            var src = srow && getCell(srow, c, false), cell = getCell(row, c, false);
            if (!src) { if (cell) { var i0 = row.cells.indexOf(cell); row.cells.splice(i0, 1); } continue; }
            var raw = src.raw;
            raw = raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at, txt) {
              var tr = translateFormula(unescX(txt), tgt.name, dr, 0); if (tr.err) { err = WHY.range; return all; }
              return '<f' + at + '>' + escX(tr.f) + '</f>';
            }).replace(/<v>[^<]*<\/v>/, function (v) { return /<f\b/.test(raw) ? '' : v; });
            if (/<f\b/.test(raw)) raw = raw.replace(/\st="[^"]*"/, '');
            var nc = { c: c, raw: raw }; renumberCell(nc, r, 0);
            if (cell) row.cells[row.cells.indexOf(cell)] = nc; else { var at2 = 0; while (at2 < row.cells.length && row.cells[at2].c < c) at2++; row.cells.splice(at2, 0, nc); }
            n++;
          }
        }
        if (err) return { err: err };
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n };
      });
    });
  }

  // ============================== 시트 추가 · 이름 · 삭제 · 순서 ==============================
  function checkSheetName(info, name, except) {
    if (!name || !name.trim()) return '시트 이름을 적어 주십시오.';
    if (name.length > 31) return '시트 이름은 31자까지입니다.';
    if (/[\[\]:*?\/\\]/.test(name)) return '시트 이름에는 [ ] : * ? / \\ 글자를 쓸 수 없습니다.';
    if (/^'|'$/.test(name)) return '시트 이름은 작은따옴표(\')로 시작하거나 끝날 수 없습니다.';
    for (var i = 0; i < info.sheets.length; i++) if (info.sheets[i] !== except && sameName(info.sheets[i].name, name)) return '같은 이름의 시트가 이미 있습니다.';
    return '';
  }
  function addSheet(pkg, name) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var bad = checkSheetName(info, name, null); if (bad) return { err: bad };
      var mx = 0; pkg.list().forEach(function (p) { var m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p); if (m) mx = Math.max(mx, +m[1]); });
      var path = 'xl/worksheets/sheet' + (mx + 1) + '.xml', rid = 'rId' + (Object.keys(info.rel).length + 100), sid = 0;
      (info.wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t) { sid = Math.max(sid, +(attrOf(t, 'sheetId') || 0)); });
      var rattr = /\s((?:\w+:)?id)="/.exec((info.sheets[0] && info.sheets[0].tag) || '') ; var ra = rattr ? rattr[1] : 'r:id';
      pkg.write(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
      pkg.write('xl/_rels/workbook.xml.rels', info.rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (mx + 1) + '.xml"/></Relationships>'));
      pkg.write('[Content_Types].xml', info.ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
      pkg.write('xl/workbook.xml', info.wb.replace('</sheets>', '<sheet name="' + escX(name) + '" sheetId="' + (sid + 1) + '" ' + ra + '="' + rid + '"/></sheets>'));
      return { ok: true };
    });
  }
  function renameSheet(pkg, oldN, newN) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, oldN)) tgt = s; });
      if (!tgt) return { err: WHY.sheet };
      var bad = checkSheetName(info, newN, tgt); if (bad) return { err: bad };
      return readSheets(pkg, info).then(function () {
        info.sheets.forEach(function (s) {
          if (!s.path || s.xml == null) return;
          var ed = eachFormula(s.xml, s.name, function (t, own) { var r = renameInFormula(t, own, oldN, newN); return r === t ? null : r; });
          pkg.write(s.path, ed.xml);
        });
        var wbx = info.wb.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, function (all, o, t, c) { return o + escX(renameInFormula(unescX(t), '', oldN, newN)) + c; });
        wbx = wbx.replace(tgt.tag, setAttr(tgt.tag, 'name', escX(newN)));
        pkg.write('xl/workbook.xml', wbx);
        var cp = pkg.list().filter(function (p) { return /^xl\/charts\/chart[^\/]*\.xml$/.test(p); });
        return Promise.all(cp.map(function (p) { return pkg.read(p).then(function (x) { if (x) pkg.write(p, x.replace(/(<c:f>)([^<]*)(<\/c:f>)/g, function (a, o, t, c) { return o + escX(renameInFormula(unescX(t), '', oldN, newN)) + c; })); }); })).then(function () { return { ok: true }; });
      });
    });
  }
  function deleteSheet(pkg, name) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, name)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      if (info.sheets.filter(function (s) { return s.state !== 'hidden' && s.state !== 'veryHidden'; }).length <= 1) return { err: '시트는 하나 이상 있어야 합니다.' };
      return Promise.all([readSheets(pkg, info), relTypesOf(pkg, tgt.path)]).then(function (a) {
        if (a[1].some(function (t) { return t !== 'printerSettings'; })) return { err: '이 시트에는 그림·차트·표·메모·링크 같은 개체가 있어서 폰에서는 지울 수 없습니다.' };
        var used = false;
        info.sheets.forEach(function (s) { if (s === tgt || !s.xml) return; var ed = eachFormula(s.xml, s.name, function (t, own) { if (refsSheet(t, own, tgt.name)) used = true; return null; }); });
        (info.wb.match(/<definedName\b[^>]*>[^<]*<\/definedName>/g) || []).forEach(function (t) { var tx = unescX(t.replace(/<[^>]*>/g, '')); if (refsSheet(tx, '', tgt.name) && !new RegExp('localSheetId="' + tgt.idx + '"').test(t)) used = true; });
        if (used) return { err: '다른 시트의 수식이나 이름이 이 시트를 쓰고 있어서 지울 수 없습니다.' };
        var wbx = info.wb.replace(tgt.tag, '');
        wbx = wbx.replace(/<definedName\b[^>]*?\slocalSheetId="(\d+)"[^>]*>[^<]*<\/definedName>/g, function (all, id) { return +id === tgt.idx ? '' : all.replace('localSheetId="' + id + '"', 'localSheetId="' + (+id > tgt.idx ? +id - 1 : +id) + '"'); });
        wbx = wbx.replace(/\sactiveTab="(\d+)"/, function (m, v) { var n = +v > tgt.idx ? +v - 1 : (+v === tgt.idx ? 0 : +v); return n ? ' activeTab="' + n + '"' : ''; }).replace(/\sfirstSheet="\d+"/, '');
        pkg.write('xl/workbook.xml', wbx);
        pkg.write('xl/_rels/workbook.xml.rels', info.rels.replace(new RegExp('<Relationship\\b[^>]*\\sId="' + tgt.rid + '"[^>]*/>'), ''));
        pkg.write('[Content_Types].xml', info.ct.replace(new RegExp('<Override\\b[^>]*PartName="/' + tgt.path.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''));
        pkg.remove(tgt.path); var rp = tgt.path.replace(/([^\/]+)$/, '_rels/$1.rels'); pkg.remove(rp);
        return { ok: true };
      });
    });
  }
  function moveSheet(pkg, name, dir) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, name)) tgt = s; });
      if (!tgt) return { err: WHY.sheet };
      var to = tgt.idx + dir; if (to < 0 || to >= info.sheets.length) return { err: dir < 0 ? '이미 맨 앞입니다.' : '이미 맨 뒤입니다.' };
      var tags = info.sheets.map(function (s) { return s.tag; }), t = tags[tgt.idx]; tags.splice(tgt.idx, 1); tags.splice(to, 0, t);
      var perm = {}; info.sheets.forEach(function (s, i) { perm[i] = i; }); // 옛 번호 → 새 번호
      var order = info.sheets.map(function (s, i) { return i; }); order.splice(tgt.idx, 1); order.splice(to, 0, tgt.idx); order.forEach(function (oldI, newI) { perm[oldI] = newI; });
      var wbx = info.wb.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets>' + tags.join('') + '</sheets>');
      wbx = wbx.replace(/(<definedName\b[^>]*?\slocalSheetId=")(\d+)(")/g, function (m, a, id, c) { return a + (perm[+id] != null ? perm[+id] : id) + c; });
      wbx = wbx.replace(/(\sactiveTab=")(\d+)(")/, function (m, a, id, c) { return a + (perm[+id] != null ? perm[+id] : id) + c; });
      pkg.write('xl/workbook.xml', wbx); return { ok: true };
    });
  }

  // ============================== 안전 검사(중간 넣기·빼기를 해도 되나?) ==============================
  function checkMiddle(pkg, sheetName, axis, at, n, mode) {      // 실제로 하지 않고 같은 검사를 돌려 본다
    var tmp = { read: function (p) { return pkg.read(p); }, write: function () {}, remove: function () {}, list: function () { return pkg.list(); } };
    return lineEdit(tmp, sheetName, axis, at, n, mode).then(function (r) { return r.ok ? { ok: true } : { ok: false, err: r.err, why: r.why }; });
  }

  // ============================== 새 엑셀 문서 ==============================
  function newWorkbookFiles(sheetName) {
    var hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var f = {};
    f['[Content_Types].xml'] = hdr + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    f['_rels/.rels'] = hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    f['xl/workbook.xml'] = hdr + '<workbook xmlns="' + NS + '" xmlns:r="' + RN + '"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="10000"/></bookViews><sheets><sheet name="' + escX(sheetName) + '" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>';
    f['xl/_rels/workbook.xml.rels'] = hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    f['xl/worksheets/sheet1.xml'] = hdr + '<worksheet xmlns="' + NS + '"><dimension ref="A1"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols><col min="1" max="12" width="12" customWidth="1"/></cols><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    f['xl/styles.xml'] = hdr + '<styleSheet xmlns="' + NS + '"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';
    return f;
  }

  // 수식 칸의 저장된 값(<v>)만 바꾼다(계산기가 낸 값을 파일에 적어 두는 용도). updates = { 'B7': { t:'n'|'s'|'b', v } } → { xml, n }
  function setCachedValues(xml, updates) {
    var sd = parseSheet(xml); if (!sd) return { xml: xml, n: 0 };
    var n = 0;
    sd.rows.forEach(function (row) {
      row.cells.forEach(function (c) {
        var ref = /\sr="([A-Z]+\d+)"/.exec(c.raw)[1], u = updates[ref]; if (!u || !/<f\b/.test(c.raw)) return;
        var ot = openTagOfCell(c.raw), body = c.raw.slice(ot.length), self = /\/>$/.test(ot);
        if (self) return;
        body = body.replace(/<v>[^<]*<\/v>|<v\/>/, '').replace(/<\/c>$/, '');
        var tt = delAttr(ot, 't'); if (u.t === 's') tt = setAttr(tt, 't', 'str'); else if (u.t === 'b') tt = setAttr(tt, 't', 'b');
        var vs = u.t === 'b' ? (u.v ? '1' : '0') : u.t === 's' ? escX(u.v) : String(u.v);
        c.raw = tt + body + '<v>' + vs + '</v></c>'; n++;
      });
    });
    return { xml: serializeSheet(sd), n: n };
  }

  // ============================== 줄·열 숨기기 · 자동 필터 ==============================
  function sheetTarget(pkg, sheetName) {
    return wbInfo(pkg).then(function (info) { var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; }); return tgt && tgt.path ? tgt : null; });
  }
  function setRowsHidden(pkg, sheetName, r0, r1, hide) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        for (var r = r0; r <= r1; r++) { var row = getRow(sd, r, !!hide); if (!row) continue; row.open = hide ? setAttr(row.open, 'hidden', '1') : delAttr(row.open, 'hidden'); }
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true };
      });
    });
  }
  function setColsHidden(pkg, sheetName, c0, c1, hide) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var cols = (xml.match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attrOf(t, 'min'), max: +attrOf(t, 'max'), tag: t }; }), out = [], covered = {};
        cols.forEach(function (cl) {
          var lo = Math.max(cl.min, c0), hi = Math.min(cl.max, c1);
          if (hi < lo) { out.push(cl); return; }
          if (cl.min < lo) out.push({ min: cl.min, max: lo - 1, tag: setAttr(setAttr(cl.tag, 'min', String(cl.min)), 'max', String(lo - 1)) });
          var mid = setAttr(setAttr(cl.tag, 'min', String(lo)), 'max', String(hi)); mid = hide ? setAttr(mid, 'hidden', '1') : delAttr(mid, 'hidden');
          out.push({ min: lo, max: hi, tag: mid }); for (var k = lo; k <= hi; k++) covered[k] = 1;
          if (cl.max > hi) out.push({ min: hi + 1, max: cl.max, tag: setAttr(setAttr(cl.tag, 'min', String(hi + 1)), 'max', String(cl.max)) });
        });
        if (hide) { var k = c0; while (k <= c1) { if (covered[k]) { k++; continue; } var e = k; while (e + 1 <= c1 && !covered[e + 1]) e++; out.push({ min: k, max: e, tag: '<col min="' + k + '" max="' + e + '" width="9.140625" hidden="1" customWidth="1"/>' }); k = e + 1; } }
        out.sort(function (a, b) { return a.min - b.min; });
        xml = xml.replace(/<cols\b[^>]*?(?:\/>|>[\s\S]*?<\/cols>)/, '');
        if (out.length) xml = insertWsElement(xml, 'cols', '<cols>' + out.map(function (x) { return x.tag; }).join('') + '</cols>');
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  function showAllHidden(pkg, sheetName) {            // 시트의 숨긴 줄·열을 모두 보이게
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        xml = xml.replace(/<col\b[^>]*\/>/g, function (t) { return delAttr(t, 'hidden'); }).replace(/<row\b[^>]*>/g, function (t) { return delAttr(t, 'hidden'); });
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  // 자동 필터: rng = {r0,c0,r1,c1}(1부터)|null(끄기). criteria = { 열번호(rng.c0 기준 0부터): [표시 글자…] }, hiddenRows = 필터로 숨길 줄 번호 목록(1부터)
  function setFilter(pkg, sheetName, rng, criteria, hiddenRows) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var old = /<autoFilter\b([^>]*?)(?:\/>|>[\s\S]*?<\/autoFilter>)/.exec(xml), oref = old ? attrOf(old[0].match(/^<autoFilter\b[^>]*>/)[0], 'ref') : null;
        if (/<tableParts\b/.test(xml)) return { err: '이 시트에는 엑셀 표(자동 필터가 따로 달린 표)가 있어서 폰에서는 필터를 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        xml = xml.replace(/<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/, '');
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var m = oref && /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(oref);
        if (m) for (var r = +m[2] + 1; r <= +m[4]; r++) { var row = getRow(sd, r, false); if (row) row.open = delAttr(row.open, 'hidden'); }     // 옛 필터가 숨긴 줄은 먼저 모두 보이게
        var out = serializeSheet(sd);
        if (rng) {
          var OPN = { ge: 'greaterThanOrEqual', le: 'lessThanOrEqual', gt: 'greaterThan', lt: 'lessThan', eq: '' };
          var cs = Object.keys(criteria || {}).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
            var c = criteria[k];
            if (c && c.cond) {                           // 조건 필터: 숫자 비교·글자 포함
              return '<filterColumn colId="' + k + '"><customFilters' + (c.cond.length > 1 && c.and !== false ? ' and="1"' : '') + '>' + c.cond.map(function (x) {
                if (x.op === 'contains') return '<customFilter val="*' + escX(x.s) + '*"/>';
                return '<customFilter' + (OPN[x.op] ? ' operator="' + OPN[x.op] + '"' : '') + ' val="' + escX(String(x.n)) + '"/>';
              }).join('') + '</customFilters></filterColumn>';
            }
            return '<filterColumn colId="' + k + '"><filters>' + c.map(function (v) { return '<filter val="' + escX(v) + '"/>'; }).join('') + '</filters></filterColumn>';
          }).join('');
          var ref = colName(rng.c0) + rng.r0 + ':' + colName(rng.c1) + rng.r1;
          out = insertWsElement(out, 'autoFilter', '<autoFilter ref="' + ref + '"' + (cs ? '>' + cs + '</autoFilter>' : '/>'));
          var sd2 = parseSheet(out); (hiddenRows || []).forEach(function (r) { var row = getRow(sd2, r, false); if (row) row.open = setAttr(row.open, 'hidden', '1'); }); out = serializeSheet(sd2);
        }
        pkg.write(tgt.path, out); return { ok: true };
      });
    });
  }
  function readFilter(xml) {                          // 시트 XML 에서 지금 걸린 자동 필터: {ref:{r0,c0,r1,c1}, criteria:{열:[글자]}}|null
    var m = /<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/.exec(xml || ''); if (!m) return null;
    var open = m[0].match(/^<autoFilter\b[^>]*>/)[0], rm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(attrOf(open, 'ref') || ''); if (!rm) return null;
    var crit = {}; (m[0].match(/<filterColumn\b[\s\S]*?<\/filterColumn>/g) || []).forEach(function (fc) {
      var id = +attrOf(fc.match(/^<filterColumn\b[^>]*>/)[0], 'colId');
      if (/<customFilters\b/.test(fc) && !/<(top10|dynamicFilter|colorFilter|iconFilter|filters)\b/.test(fc)) {
        var cf = fc.match(/<customFilter\b[^>]*\/?>/g) || [], conds = [], okc = cf.length > 0 && cf.length <= 2, andv = /<customFilters\b[^>]*\sand="(?:1|true)"/.test(fc);
        var OPR = { greaterThanOrEqual: 'ge', lessThanOrEqual: 'le', greaterThan: 'gt', lessThan: 'lt' };
        cf.forEach(function (t) {
          var op = attrOf(t, 'operator') || 'equal', v = unescX(attrOf(t, 'val') || '');
          if (op === 'equal' && /^\*[^*?]+\*$/.test(v)) conds.push({ op: 'contains', s: v.slice(1, -1) });
          else if (OPR[op] && v !== '' && !isNaN(parseFloat(v))) conds.push({ op: OPR[op], n: parseFloat(v) });
          else if (op === 'equal' && v !== '' && !isNaN(parseFloat(v)) && /^-?[\d.]+$/.test(v)) conds.push({ op: 'eq', n: parseFloat(v) });
          else okc = false;
        });
        crit[id] = okc ? { cond: conds, and: andv } : null; return;
      }
      if (/<(customFilters|top10|dynamicFilter|colorFilter|iconFilter)\b/.test(fc)) crit[id] = null; else crit[id] = (fc.match(/<filter\b[^>]*\sval="[^"]*"/g) || []).map(function (t) { return unescX(attrOf(t, 'val')); });
    });
    return { ref: { c0: colNum(rm[1]), r0: +rm[2], c1: colNum(rm[3]), r1: +rm[4] }, criteria: crit };
  }
  // ============================== 칸·범위 복사 붙여넣기 (v10.7) ==============================
  // src = {r0,c0,r1,c1}(1부터) → 붙일 왼쪽 위 (dstR0,dstC0)(1부터). mode: 'all'(값·수식·서식) | 'values'(값만, 붙는 자리의 서식은 그대로). cut=true 면 원래 칸은 비운다(다른 칸의 수식이 원래 칸을 쓰면 하지 않는다)
  function mergesOf(xml) { var out = [], m, re = /<mergeCell\b[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g; while ((m = re.exec(xml))) out.push({ c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3]), r1: +m[4] }); return out; }
  function hitMerge(ms, r0, c0, r1, c1) { return ms.some(function (m) { return !(m.r1 < r0 || m.r0 > r1 || m.c1 < c0 || m.c0 > c1); }); }
  function copyRange(pkg, sheetName, src, dstR0, dstC0, mode, cut) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var nr = src.r1 - src.r0 + 1, nc = src.c1 - src.c0 + 1, dr = dstR0 - src.r0, dc = dstC0 - src.c0;
        if (dstR0 + nr - 1 > MAXR || dstC0 + nc - 1 > MAXC) return { err: '붙일 자리가 시트의 끝을 넘습니다.' };
        var ms = mergesOf(ex.xml);
        if (hitMerge(ms, src.r0, src.c0, src.r1, src.c1) || hitMerge(ms, dstR0, dstC0, dstR0 + nr - 1, dstC0 + nc - 1)) return { err: '합쳐진 칸이 걸려 있어 폰에서는 복사·붙여넣기를 할 수 없습니다. 먼저 합치기를 풀거나 「수정 요청」으로 맡겨 주십시오.' };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var snap = [], i, j, err = null;
        for (i = 0; i < nr; i++) { var srow = getRow(sd, src.r0 + i, false); snap.push([]); for (j = 0; j < nc; j++) { var sc = srow && getCell(srow, src.c0 + j, false); snap[i].push(sc ? sc.raw : null); } }
        for (i = 0; i < nr && !err; i++) for (j = 0; j < nc; j++) if (snap[i][j] && /<f\b[^>]*\st="(?:array|dataTable)"|\scm="|\svm="/.test(snap[i][j])) { err = '배열 수식이나 특수한 칸이 들어 있어 복사할 수 없습니다. 엑셀에서 해 주십시오.'; break; }
        if (err) return { err: err };
        if (cut && snap.some(function (rw) { return rw.some(function (q) { return q && /<f\b/.test(q); }); })) return { err: '수식이 든 칸은 오려두기를 할 수 없습니다(엑셀은 수식이 가리키는 곳을 따로 계산해 옮깁니다). 「복사」로 붙인 뒤 원래 칸을 지워 주십시오.' };
        if (cut) {                                   // 다른 칸의 수식이 원래 칸을 쓰면 오려두기를 막는다
          var bad = false, sheets = info.sheets.filter(function (s) { return s.path; });
          return Promise.all(sheets.map(function (s) { return pkg.read(s.path).then(function (x) { return { s: s, x: x || '' }; }); })).then(function (all) {
            all.forEach(function (a) {
              (a.x.match(/<f\b[^>]*>[^<]*<\/f>/g) || []).forEach(function (ft) {
                var txt = unescX(ft.replace(/<[^>]+>/g, ''));
                mapRefs(txt, a.s.name, function (r) {
                  if (!sameName(r.sheet, tgt.name)) return null;
                  var b = r.b || r.a, rr0 = Math.min(r.a.r, b.r), rr1 = Math.max(r.a.r, b.r), cc0 = Math.min(r.a.c, b.c), cc1 = Math.max(r.a.c, b.c);
                  if (!(rr1 < src.r0 || rr0 > src.r1 || cc1 < src.c0 || cc0 > src.c1)) bad = true; return null;
                });
              });
            });
            if (bad) return { err: '다른 칸의 수식이 옮기려는 칸을 쓰고 있어 오려두기는 할 수 없습니다(수식이 어긋납니다). 「복사」로 붙인 뒤 원래 칸을 지워 주십시오.' };
            return doPaste();
          });
        }
        return doPaste();
        function doPaste() {
          var n = 0;
          for (i = 0; i < nr && !err; i++) {
            var row = getRow(sd, dstR0 + i, true);
            for (j = 0; j < nc && !err; j++) {
              var raw = snap[i][j], dcol = dstC0 + j, old = getCell(row, dcol, false), oldS = old ? attrOf(openTagOfCell(old.raw), 's') : null;
              if (!raw) {                               // 빈 칸을 붙이면 붙는 자리를 비운다
                if (old) { var k0 = row.cells.indexOf(old); if (mode === 'values' && oldS != null) row.cells[k0] = { c: dcol, raw: '<c r="' + colName(dcol) + row.r + '" s="' + oldS + '"/>' }; else row.cells.splice(k0, 1); }
                continue;
              }
              var f = /<f\b([^>]*)>([^<]*)<\/f>/.exec(raw), nraw = raw;
              if (mode === 'values') {
                nraw = nraw.replace(/<f\b[^>]*>[^<]*<\/f>|<f\b[^>]*\/>/g, '');
                if (/\st="str"/.test(nraw)) nraw = nraw.replace(/\st="str"/, ' t="inlineStr"').replace(/<v>([^<]*)<\/v>/, '<is><t xml:space="preserve">$1</t></is>');
                var ot = openTagOfCell(nraw), ot2 = oldS != null ? setAttr(ot, 's', oldS) : delAttr(ot, 's'); nraw = ot2 + nraw.slice(ot.length);
              } else if (f) {
                var tr = translateFormula(unescX(f[2]), tgt.name, dr, dc); if (tr.err) { err = '붙일 자리가 시트 밖으로 나가는 수식이 있습니다.'; break; }
                nraw = nraw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at) { return '<f' + at + '>' + escX(tr.f) + '</f>'; }).replace(/<v>[^<]*<\/v>/, '').replace(/\st="[^"]*"/, '');
              }
              var nc2 = { c: dcol, raw: nraw }; renumberCell(nc2, row.r, dcol);
              if (old) row.cells[row.cells.indexOf(old)] = nc2; else { var at2 = 0; while (at2 < row.cells.length && row.cells[at2].c < dcol) at2++; row.cells.splice(at2, 0, nc2); }
              n++;
            }
          }
          if (err) return { err: err };
          if (cut) {
            for (i = 0; i < nr; i++) { var srow2 = getRow(sd, src.r0 + i, false); if (!srow2) continue; for (j = 0; j < nc; j++) { var rr = src.r0 + i, cc = src.c0 + j; if (rr >= dstR0 && rr < dstR0 + nr && cc >= dstC0 && cc < dstC0 + nc) continue; var sc2 = getCell(srow2, cc, false); if (sc2) srow2.cells.splice(srow2.cells.indexOf(sc2), 1); } }
          }
          var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n, nr: nr, nc: nc };
        }
      });
    });
  }

  var api = {
    setRowsHidden: setRowsHidden, setColsHidden: setColsHidden, showAllHidden: showAllHidden, setFilter: setFilter, readFilter: readFilter, copyRange: copyRange,
    setCachedValues: setCachedValues,
    colNum: colNum, colName: colName, escX: escX, unescX: unescX, WHY: WHY,
    parseSheet: parseSheet, serializeSheet: serializeSheet, getRow: getRow, getCell: getCell, setDimension: setDimension, dimensionOf: dimensionOf,
    shiftRefsInFormula: shiftRefsInFormula, translateFormula: translateFormula, expandShared: expandShared, shiftRangeText: shiftRangeText, mapRefs: mapRefs,
    lineEdit: lineEdit, appendRows: appendRows, checkMiddle: checkMiddle, Styles: Styles, applyStyle: applyStyle,
    mergeCellsOp: mergeCellsOp, setRowHeight: setRowHeight, setColWidth: setColWidth, sortRows: sortRows, fillDown: fillDown,
    addSheet: addSheet, renameSheet: renameSheet, deleteSheet: deleteSheet, moveSheet: moveSheet, checkSheetName: checkSheetName, wbInfo: wbInfo, newWorkbookFiles: newWorkbookFiles
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxStruct = api;
})(typeof window !== 'undefined' ? window : globalThis);
