/* so-xlsx-pivot.js — S-Office 엑셀 피벗 표·슬라이서(O-0861, v10.9 5회차): 만들기 · 필드 고치기 · 새로 고침 · 지우기 · 슬라이서(만들기·고르기·지우기).
 * 파일 안에는 진짜 피벗 표(xl/pivotTables · xl/pivotCache)와 진짜 슬라이서(xl/slicers · xl/slicerCaches)가 들어간다. 계산 결과 칸은 이 코드가 직접 계산해 시트에 적고,
 * 엑셀은 열 때 한 번 더 새로 고친다(refreshOnLoad). 원본 .xlsx(zip)의 XML 을 직접 고치며 새 외부 부품이 없다. 브라우저와 Node(시험) 양쪽에서 돈다.
 * pkg = { read(path)→Promise<string|null>, write(path,str), remove(path), list()→[path] } (so-xlsx-struct.js 와 같다).
 * 폰에서 고칠 수 있는 피벗: 행 필드 1~2개 · 열 필드 0~1개 · 필터 필드 0~2개 · 값 1~4개(합계·개수·평균·최대·최소) 의 기본 모양(압축형). 그 밖의 모양(계산 필드·그룹·표 모양 등)은 보기·새로 고침 안내만 한다.
 */
(function (global) {
  'use strict';
  function ST() { return global.SOXlsxStruct; }
  function XX() { return ST().x; }
  var NSM = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', RT = NSR + '/';
  var X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', RT_SLC = 'http://schemas.microsoft.com/office/2007/relationships/slicerCache', RT_SL = 'http://schemas.microsoft.com/office/2007/relationships/slicer';
  var CT = { def: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml', rec: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml', tbl: 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml',
    slc: 'application/vnd.ms-excel.slicerCache+xml', sl: 'application/vnd.ms-excel.slicer+xml', drw: 'application/vnd.openxmlformats-officedocument.drawing+xml' };
  var MARK = '<!--S-Office pivot v1-->', BLANK = '(비어 있음)';
  var FNS = [['sum', '합계'], ['count', '개수'], ['average', '평균'], ['max', '최대'], ['min', '최소']], FN_NAME = {}; FNS.forEach(function (f) { FN_NAME[f[0]] = f[1]; });
  var MAX_REC = 30000, MAX_ITEMS = 500;

  // ---------------- 도우미 ----------------
  function esc(s) { return XX().escX(String(s)); }
  function un(s) { return XX().unescX(String(s)); }
  function attr(tag, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function colName(n) { return XX().colName(n); }
  function colNum(s) { return XX().colNum(s); }
  function relsPath(p) { return p.replace(/([^\/]+)$/, '_rels/$1.rels'); }
  function resolvePath(base, tg) {
    if (/^[A-Za-z]+:/.test(tg)) return null; if (tg.charAt(0) === '/') return tg.slice(1);
    var parts = base.replace(/[^\/]+$/, '').split('/').filter(Boolean); tg.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); }); return parts.join('/');
  }
  function relTarget(from, to) { var a = from.replace(/[^\/]+$/, '').split('/').filter(Boolean), b = to.split('/'), i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++; var o = []; for (var k = a.length - i; k > 0; k--) o.push('..'); return o.concat(b.slice(i)).join('/'); }
  function emptyRels() { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'; }
  function parseRels(x) { return ((x || '').match(/<Relationship\b[^>]*?\/?>/g) || []).map(function (t) { return { id: attr(t, 'Id'), type: (attr(t, 'Type') || '').replace(/^.*\//, ''), target: attr(t, 'Target') || '', mode: attr(t, 'TargetMode'), raw: t }; }); }
  function nextRid(x) { var mx = 0; (x.match(/\sId="rId(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return 'rId' + (mx + 1); }
  function nextNum(pkg, dir, base, ext) { var mx = 0, re = new RegExp('^' + dir.replace(/[.\/]/g, '\\$&') + base + '(\\d+)\\.' + ext + '$'); pkg.list().forEach(function (p) { var m = re.exec(p); if (m) mx = Math.max(mx, +m[1]); }); return mx + 1; }
  function ctAdd(ct, part, type) { return ct.indexOf('PartName="' + part + '"') >= 0 ? ct : ct.replace('</Types>', '<Override PartName="' + part + '" ContentType="' + type + '"/></Types>'); }
  function ctDel(ct, part) { return ct.replace(new RegExp('<Override\\b[^>]*PartName="' + part.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''); }
  function parseRange(t) {
    var m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(String(t || '').trim()); if (!m) return null;
    var r = { c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3] || m[1]), r1: +(m[4] || m[2]) };
    if (r.c1 < r.c0) { var q = r.c0; r.c0 = r.c1; r.c1 = q; } if (r.r1 < r.r0) { var w = r.r0; r.r0 = r.r1; r.r1 = w; } return r;
  }
  function rangeText(r) { return colName(r.c0) + r.r0 + ':' + colName(r.c1) + r.r1; }
  function numStr(v) { return String(v); }
  var coll = null; function cmpStr(a, b) { try { coll = coll || new Intl.Collator('ko'); return coll.compare(a, b); } catch (e) { return a < b ? -1 : a > b ? 1 : 0; } }
  function isInt(v) { return Math.floor(v) === v && Math.abs(v) < 1e15; }

  // ---------------- 원본 표 읽기 ----------------
  // 돌려주는 값: { vals: [줄][칸] = {k:'n'|'s'|'b'|'e'|'z', v}, rg } | { err }
  function readTable(pkg, sheet, ref) {
    var rg = parseRange(ref); if (!rg) return Promise.resolve({ err: '원본 범위를 알아볼 수 없습니다.' });
    if (rg.r1 - rg.r0 < 1) return Promise.resolve({ err: '원본 범위에는 이름 줄과 자료 줄이 한 줄 이상 있어야 합니다.' });
    if (rg.r1 - rg.r0 > MAX_REC) return Promise.resolve({ err: '자료가 ' + MAX_REC + '줄을 넘으면 폰에서는 피벗 표를 만들지 않습니다.' });
    if (rg.c1 - rg.c0 > 60) return Promise.resolve({ err: '칸(열)이 60개를 넘는 범위는 피벗 표로 만들지 않습니다.' });
    return ST().readSst(pkg).then(function (sst) {
      return XX().withSheet(pkg, sheet, function (xml) {
        var sd = XX().parseSheet(xml); if (!sd) return { err: '원본 시트 구조가 특이해서 읽을 수 없습니다.' };
        var vals = [], r, c;
        for (r = rg.r0; r <= rg.r1; r++) { var row = XX().getRow(sd, r, false), line = []; for (c = rg.c0; c <= rg.c1; c++) line.push(ST().cellVal(row && XX().getCell(row, c, false), sst)); vals.push(line); }
        return { vals: vals, rg: rg };
      });
    });
  }
  function norm(cv) {          // 칸 값 → { t:'n'|'s'|'m', v }
    if (!cv || cv.k === 'z' || cv.v == null || cv.v === '') return { t: 'm' };
    if (cv.k === 'n') return { t: 'n', v: cv.v };
    if (cv.k === 'b') return { t: 's', v: cv.v ? 'TRUE' : 'FALSE' };
    return { t: 's', v: String(cv.v) };
  }
  function labelOf(it) { return it.t === 'm' ? BLANK : it.t === 'n' ? numStr(it.v) : it.v; }
  function itemCmp(a, b) {
    if (a.t === 'm') return b.t === 'm' ? 0 : 1; if (b.t === 'm') return -1;
    if (a.t === 'n' && b.t === 'n') return a.v - b.v; if (a.t === 'n') return -1; if (b.t === 'n') return 1; return cmpStr(a.v, b.v);
  }
  var LISTS = [['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'], ['일', '월', '화', '수', '목', '금', '토'], ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']];
  function customRank(items) {
    var strs = items.filter(function (it) { return it.t !== 'm'; }); if (!strs.length || strs.some(function (it) { return it.t !== 's'; })) return null;
    for (var q = 0; q < LISTS.length; q++) {
      var L = LISTS[q]; if (strs.every(function (it) { return L.indexOf(it.v.trim().toLowerCase()) >= 0; })) return function (it) { return it.t === 'm' ? 1e6 : L.indexOf(it.v.trim().toLowerCase()); };
    }
    return null;
  }
  // T(읽은 표) → 필드 목록. 이름이 비었거나 겹치면 { err }
  function buildFields(T) {
    var hdr = T.vals[0], seen = {}, F = [], j, i;
    for (j = 0; j < hdr.length; j++) {
      var nm = hdr[j] && hdr[j].v != null ? String(hdr[j].v).trim() : '';
      if (!nm) return { err: '맨 윗줄(이름 줄)의 ' + colName(T.rg.c0 + j) + '열이 비어 있습니다. 모든 열에 이름이 있어야 피벗 표로 만들 수 있습니다.' };
      if (seen[nm.toLowerCase()]) return { err: '맨 윗줄에 같은 이름(' + nm + ')이 두 번 있습니다. 열 이름은 서로 달라야 합니다.' };
      seen[nm.toLowerCase()] = 1;
      F.push({ idx: j, name: nm, items: [], map: {}, raw: [], rec: [], nNum: 0, nStr: 0, nBlank: 0, allInt: true, mn: Infinity, mx: -Infinity });
    }
    for (i = 1; i < T.vals.length; i++) {
      for (j = 0; j < F.length; j++) {
        var f = F[j], it = norm(T.vals[i][j]), key = it.t === 'm' ? 'm' : it.t + ':' + it.v;
        if (!(key in f.map)) { f.map[key] = f.items.length; f.items.push(it); if (f.items.length > MAX_ITEMS * 20) return { err: '항목 종류가 너무 많습니다(' + f.name + ').' }; }
        f.rec.push(f.map[key]); f.raw.push(it);
        if (it.t === 'n') { f.nNum++; if (!isInt(it.v)) f.allInt = false; if (it.v < f.mn) f.mn = it.v; if (it.v > f.mx) f.mx = it.v; } else if (it.t === 's') f.nStr++; else f.nBlank++;
      }
    }
    F.forEach(function (f) {
      var rk = customRank(f.items);      // 엑셀은 월·요일 이름이 모두 이 목록에 있으면 목록 순서로 늘어놓는다
      f.order = f.items.map(function (_, k) { return k; }).sort(function (a, b) { return rk ? (rk(f.items[a]) - rk(f.items[b])) || itemCmp(f.items[a], f.items[b]) : itemCmp(f.items[a], f.items[b]); });      // 위치 → 공유 항목 번호(오름차순)
      f.pos = {}; f.order.forEach(function (idx, p) { f.pos[idx] = p; });
      f.label = f.items.map(labelOf);
    });
    return { F: F, nRec: T.vals.length - 1 };
  }

  // ---------------- 계산 ----------------
  function aggregate(F, recs, d) {
    if (!recs.length) return null;
    var f = F[d.f], fn = d.fn || 'sum', i, s = 0, n = 0, cnt = 0, mx = -Infinity, mn = Infinity;
    for (i = 0; i < recs.length; i++) { var it = f.raw[recs[i]]; if (it.t !== 'm') cnt++; if (it.t === 'n') { n++; s += it.v; if (it.v > mx) mx = it.v; if (it.v < mn) mn = it.v; } }
    if (fn === 'count') return cnt;
    if (fn === 'sum') return (!n && !cnt) ? null : s;          // 빈 칸뿐인 묶음은 엑셀처럼 빈 칸으로
    if (!n) return null;
    if (fn === 'average') return s / n; if (fn === 'max') return mx; if (fn === 'min') return mn;
    return s;
  }
  function dataName(F, d) { return d.name || (FN_NAME[d.fn || 'sum'] + ' ' + F[d.f].name); }
  // cfg: { rows:[f], cols:[f], pages:[f], pageSel:{f:라벨}, data:[{f,fn,name}], hidden:{f:[라벨]} } → 계산 결과
  function compute(cfg, FF) {
    var F = FF.F, n = FF.nRec, ok = [], i;
    var hid = {}; Object.keys(cfg.hidden || {}).forEach(function (k) { var o = {}; (cfg.hidden[k] || []).forEach(function (l) { o[l] = 1; }); hid[k] = o; });
    for (i = 0; i < n; i++) {
      var pass = true;
      Object.keys(hid).forEach(function (k) { var f = F[+k]; if (f && hid[k][f.label[f.rec[i]]]) pass = false; });
      (cfg.pages || []).forEach(function (pf) { var sel = (cfg.pageSel || {})[pf]; if (sel != null && sel !== '' && F[pf].label[F[pf].rec[i]] !== sel) pass = false; });
      if (pass) ok.push(i);
    }
    function groups(f, recs) {          // 레코드를 이 필드의 항목별로 묶어 위치 순서로
      var g = {}, ks = [];
      recs.forEach(function (r) { var k = f.rec[r]; if (!g[k]) { g[k] = []; ks.push(k); } g[k].push(r); });
      ks.sort(function (a, b) { return f.pos[a] - f.pos[b]; });
      return ks.map(function (k) { return { idx: k, pos: f.pos[k], label: f.label[k], recs: g[k] }; });
    }
    var rowNodes = groups(F[cfg.rows[0]], ok);
    if (cfg.rows.length > 1) rowNodes.forEach(function (nd) { nd.kids = groups(F[cfg.rows[1]], nd.recs); });
    var colNodes = cfg.cols.length ? groups(F[cfg.cols[0]], ok) : null;
    function byCol(recs) { if (!colNodes) return null; var cf = F[cfg.cols[0]], m = {}; recs.forEach(function (r) { var k = cf.rec[r]; (m[k] = m[k] || []).push(r); }); return m; }
    function vals(recs) {                // 이 줄의 값들: 열 항목별 × 값 개수, 그리고 총합계 열
      var out = [], bc = byCol(recs);
      if (colNodes) { colNodes.forEach(function (cn) { cfg.data.forEach(function (d) { out.push(aggregate(F, (bc[cn.idx] || []), d)); }); }); }
      cfg.data.forEach(function (d) { out.push(aggregate(F, recs, d)); });
      return out;
    }
    rowNodes.forEach(function (nd) { nd.v = vals(nd.recs); if (nd.kids) nd.kids.forEach(function (k) { k.v = vals(k.recs); }); });
    return { ok: ok, rowNodes: rowNodes, colNodes: colNodes, grand: vals(ok), nVis: ok.length };
  }

  // ---------------- 모양(칸 배치) ----------------
  // 돌려주는 값: { grid:[줄][칸]={k,v}|null, w, h, fhr, fdr, fdc, hdrRows, dataStart }
  function layout(cfg, FF, M) {
    var F = FF.F, D = cfg.data, nD = D.length, hasCol = !!(M.colNodes), grid = [], i, j;
    function S(v) { return v == null ? null : { k: 's', v: v }; }
    function N(v) { return v == null ? null : { k: 'n', v: v }; }
    var dn = D.map(function (d) { return dataName(F, d); }), head, fhr = 1, fdr;
    if (!hasCol && nD === 1) { head = [[S('행 레이블'), S(dn[0])]]; fdr = 1; }
    else if (!hasCol) { head = [[null, S('값')], [S('행 레이블')].concat(dn.map(S))]; fdr = 2; }
    else if (nD === 1) { head = [[S(dn[0]), S('열 레이블')], [S('행 레이블')].concat(M.colNodes.map(function (c) { return S(c.label); })).concat([S('총합계')])]; fdr = 2; }
    else {
      var r2 = [null]; M.colNodes.forEach(function (c) { r2.push(S(c.label)); for (j = 1; j < nD; j++) r2.push(null); }); dn.forEach(function (x) { r2.push(S('전체 ' + x)); });
      var r3 = [S('행 레이블')]; M.colNodes.forEach(function () { dn.forEach(function (x) { r3.push(S(x)); }); });
      head = [[null, S('열 레이블')], r2, r3]; fdr = 3;
    }
    head.forEach(function (h) { grid.push(h); });
    function rowOf(label, v) { return [S(label)].concat(v.map(N)); }
    M.rowNodes.forEach(function (nd) { grid.push(rowOf(nd.label, nd.v)); if (nd.kids) nd.kids.forEach(function (k) { grid.push(rowOf(k.label, k.v)); }); });
    grid.push(rowOf('총합계', M.grand));
    var w = 0; grid.forEach(function (r) { w = Math.max(w, r.length); });
    return { grid: grid, w: w, h: grid.length, fhr: fhr, fdr: fdr, fdc: 1 };
  }

  // ---------------- 캐시·피벗 XML ----------------
  function xv(v) { return v ? '<x v="' + v + '"/>' : '<x/>'; }
  function shareField(f, cfg) {          // 이 필드를 공유 항목으로 적을지
    if (f.nStr > 0) return true;
    var used = cfg.rows.indexOf(f.idx) >= 0 || cfg.cols.indexOf(f.idx) >= 0 || cfg.pages.indexOf(f.idx) >= 0 || ((cfg.hidden || {})[f.idx] || []).length > 0;
    return used;
  }
  function sharedXml(f, cfg) {
    var sh = shareField(f, cfg), a = '', body = '';
    var num = f.nNum > 0, str = f.nStr > 0, blank = f.nBlank > 0;
    if (num && !str) { a = (blank ? ' containsString="0" containsBlank="1" containsNumber="1"' : ' containsSemiMixedTypes="0" containsString="0" containsNumber="1"') + (f.allInt ? ' containsInteger="1"' : '') + ' minValue="' + numStr(f.mn) + '" maxValue="' + numStr(f.mx) + '"'; }
    else if (num && str) { a = ' containsMixedTypes="1" containsNumber="1"' + (f.allInt ? ' containsInteger="1"' : '') + (blank ? ' containsBlank="1"' : '') + ' minValue="' + numStr(f.mn) + '" maxValue="' + numStr(f.mx) + '"'; }
    else if (blank) a = str ? ' containsBlank="1"' : ' containsString="0" containsBlank="1"';
    if (!sh) return '<sharedItems' + a + '/>';
    f.items.forEach(function (it) { body += it.t === 'm' ? '<m/>' : it.t === 'n' ? '<n v="' + numStr(it.v) + '"/>' : '<s v="' + esc(it.v) + '"/>'; });
    return '<sharedItems' + a + ' count="' + f.items.length + '">' + body + '</sharedItems>';
  }
  function cacheDefXml(cfg, FF, extra) {
    var F = FF.F, x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="' + NSM + '" xmlns:r="' + NSR + '" r:id="' + extra.rid + '" refreshOnLoad="1" refreshedBy="S-Office" refreshedDate="' + (Math.floor(Date.now() / 86400000) + 25569) + '" createdVersion="3" refreshedVersion="7" minRefreshableVersion="3" recordCount="' + FF.nRec + '">' +
      '<cacheSource type="worksheet"><worksheetSource ref="' + esc(cfg.source.ref) + '" sheet="' + esc(cfg.source.sheet) + '"/></cacheSource><cacheFields count="' + F.length + '">';
    F.forEach(function (f) { x += '<cacheField name="' + esc(f.name) + '" numFmtId="0">' + sharedXml(f, cfg) + '</cacheField>'; });
    x += '</cacheFields><extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="' + X14 + '"><x14:pivotCacheDefinition pivotCacheId="' + extra.x14 + '"/></ext></extLst></pivotCacheDefinition>';
    return x;
  }
  function cacheRecXml(cfg, FF) {
    var F = FF.F, x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="' + NSM + '" xmlns:r="' + NSR + '" count="' + FF.nRec + '">', i, j, sh = F.map(function (f) { return shareField(f, cfg); });
    for (i = 0; i < FF.nRec; i++) {
      x += '<r>';
      for (j = 0; j < F.length; j++) { var f = F[j]; if (sh[j]) x += '<x v="' + f.rec[i] + '"/>'; else { var it = f.raw[i]; x += it.t === 'm' ? '<m/>' : '<n v="' + numStr(it.v) + '"/>'; } }
      x += '</r>';
    }
    return x + '</pivotCacheRecords>';
  }
  function tableXml(cfg, FF, M, L, ids) {
    var F = FF.F, D = cfg.data, nD = D.length, hasCol = cfg.cols.length === 1, r0 = ids.r0, c0 = ids.c0, nPg = cfg.pages.length, i, j;
    var ref = colName(c0) + r0 + ':' + colName(c0 + L.w - 1) + (r0 + L.h - 1);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + MARK + '<pivotTableDefinition xmlns="' + NSM + '" name="' + esc(cfg.name) + '" cacheId="' + ids.cacheId + '" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="값" updatedVersion="7" minRefreshableVersion="3" showCalcMbrs="0" useAutoFormatting="1" itemPrintTitles="1" createdVersion="3" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">';
    x += '<location ref="' + ref + '" firstHeaderRow="' + L.fhr + '" firstDataRow="' + L.fdr + '" firstDataCol="' + L.fdc + '"' + (nPg ? ' rowPageCount="' + nPg + '" colPageCount="1"' : '') + '/>';
    x += '<pivotFields count="' + F.length + '">';
    F.forEach(function (f) {
      var ax = cfg.rows.indexOf(f.idx) >= 0 ? 'axisRow' : cfg.cols.indexOf(f.idx) >= 0 ? 'axisCol' : cfg.pages.indexOf(f.idx) >= 0 ? 'axisPage' : '', isData = D.some(function (d) { return d.f === f.idx; });
      var hid = {}; ((cfg.hidden || {})[f.idx] || []).forEach(function (l) { hid[l] = 1; });
      var needItems = ax || Object.keys(hid).length || (cfg.listed || []).indexOf(f.idx) >= 0;
      var a = (ax ? ' axis="' + ax + '"' : '') + (isData ? ' dataField="1"' : '') + (ax === 'axisPage' && Object.keys(hid).length ? ' multipleItemSelectionAllowed="1"' : '') + ' showAll="0"';
      if (!needItems) { x += '<pivotField' + a + '/>'; return; }
      x += '<pivotField' + a + '><items count="' + (f.order.length + 1) + '">';
      f.order.forEach(function (idx) { x += '<item' + (hid[f.label[idx]] ? ' h="1"' : '') + ' x="' + idx + '"/>'; });
      x += '<item t="default"/></items></pivotField>';
    });
    x += '</pivotFields>';
    x += '<rowFields count="' + cfg.rows.length + '">' + cfg.rows.map(function (f) { return '<field x="' + f + '"/>'; }).join('') + '</rowFields>';
    var ri = [];
    M.rowNodes.forEach(function (nd) { ri.push('<i>' + xv(nd.pos) + '</i>'); if (nd.kids) nd.kids.forEach(function (k) { ri.push('<i r="1">' + xv(k.pos) + '</i>'); }); });
    ri.push('<i t="grand"><x/></i>');
    x += '<rowItems count="' + ri.length + '">' + ri.join('') + '</rowItems>';
    var ci = [];
    if (hasCol) {
      x += '<colFields count="' + (nD >= 2 ? 2 : 1) + '"><field x="' + cfg.cols[0] + '"/>' + (nD >= 2 ? '<field x="-2"/>' : '') + '</colFields>';
      M.colNodes.forEach(function (cn) { if (nD === 1) ci.push('<i>' + xv(cn.pos) + '</i>'); else for (j = 0; j < nD; j++) ci.push(j === 0 ? '<i>' + xv(cn.pos) + '<x/></i>' : '<i r="1" i="' + j + '"><x v="' + j + '"/></i>'); });
      if (nD === 1) ci.push('<i t="grand"><x/></i>'); else for (j = 0; j < nD; j++) ci.push('<i t="grand"' + (j ? ' i="' + j + '"' : '') + '><x/></i>');
    } else if (nD >= 2) { x += '<colFields count="1"><field x="-2"/></colFields>'; for (j = 0; j < nD; j++) ci.push(j === 0 ? '<i><x/></i>' : '<i i="' + j + '"><x v="' + j + '"/></i>'); }
    else ci.push('<i/>');
    x += '<colItems count="' + ci.length + '">' + ci.join('') + '</colItems>';
    if (nPg) x += '<pageFields count="' + nPg + '">' + cfg.pages.map(function (f) {
      var sel = (cfg.pageSel || {})[f], p = F[f].label.indexOf(sel); return '<pageField fld="' + f + '"' + (sel != null && sel !== '' && p >= 0 ? ' item="' + F[f].pos[p] + '"' : '') + ' hier="-1"/>'; }).join('') + '</pageFields>';
    x += '<dataFields count="' + nD + '">' + D.map(function (d) { return '<dataField name="' + esc(dataName(F, d)) + '" fld="' + d.f + '"' + (d.fn && d.fn !== 'sum' ? ' subtotal="' + d.fn + '"' : '') + ' baseField="0" baseItem="0"' + (d.numFmtId ? ' numFmtId="' + d.numFmtId + '"' : '') + '/>'; }).join('') + '</dataFields>';
    x += '<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>';
    return x;
  }

  // ---------------- 시트 칸 쓰기 ----------------
  function pageCells(cfg, FF, r0) {      // 필터 필드 칸(A·B 열)
    var out = [], n = cfg.pages.length; cfg.pages.forEach(function (f, k) {
      var sel = (cfg.pageSel || {})[f], hid = ((cfg.hidden || {})[f] || []).length; out.push({ r: r0 - 1 - n + k, label: FF.F[f].name, val: hid ? '(여러 항목)' : (sel != null && sel !== '' ? sel : '(모두)') });
    });
    return out;
  }
  function startRow(cfg) { return Math.max(3, cfg.pages.length + 2); }
  // 시트에 결과를 쓴다. old = 지울 자리 {r0,c0,r1,c1}|null. 돌려주는 값 { ok } | { err }
  function writeCells(pkg, sheet, cfg, FF, L, at, old, dataStyle) {
    return XX().withSheet(pkg, sheet, function (xml, tgt) {
      var sd = XX().parseSheet(xml); if (!sd) return { err: '피벗 표를 놓을 시트 구조가 특이해서 쓸 수 없습니다.' };
      var pg = pageCells(cfg, FF, at.r0), box = { r0: pg.length ? pg[0].r : at.r0, c0: at.c0, r1: at.r0 + L.h - 1, c1: at.c0 + L.w - 1 };
      function inOld(r, c) { return old && r >= old.r0 && r <= old.r1 && c >= old.c0 && c <= old.c1; }
      // 옛 자리 지우기
      if (old) sd.rows.forEach(function (row) { if (row.r >= old.r0 && row.r <= old.r1) row.cells = row.cells.filter(function (c) { return c.c < old.c0 || c.c > old.c1; }); });
      // 새 자리에 다른 내용이 있으면 멈춘다
      for (var q = 0; q < sd.rows.length; q++) {
        var row = sd.rows[q]; if (row.r < box.r0 || row.r > box.r1) continue;
        for (var z = 0; z < row.cells.length; z++) { var cl = row.cells[z]; if (cl.c >= box.c0 && cl.c <= box.c1 && !inOld(row.r, cl.c) && !/^<c\b[^>]*\/>$/.test(cl.raw) && /<v>|<is>|<f\b/.test(cl.raw)) return { err: '피벗 표가 놓일 자리(' + colName(box.c0) + box.r0 + ' 근처)에 다른 내용이 있어서 쓸 수 없습니다. 새 시트에 만들거나 자리를 비워 주십시오.' }; }
      }
      pg.forEach(function (p) { XX().putCell(sd, p.r, at.c0, function (ref) { return XX().mkCellXml(ref, null, { k: 's', v: p.label }); }); XX().putCell(sd, p.r, at.c0 + 1, function (ref) { return XX().mkCellXml(ref, null, { k: 's', v: p.val }); }); });
      L.grid.forEach(function (line, i) {
        line.forEach(function (cv, j) {
          if (!cv) return; var isData = cv.k === 'n', st = isData && dataStyle != null ? dataStyle : null;
          XX().putCell(sd, at.r0 + i, at.c0 + j, function (ref) { return XX().mkCellXml(ref, st, cv); });
        });
      });
      var out = XX().serializeSheet(sd); pkg.write(tgt.path, XX().setDimension(out, XX().dimensionOf(XX().parseSheet(out)))); return { ok: true, box: box };
    });
  }
  function clearCells(pkg, sheet, box) {
    return XX().withSheet(pkg, sheet, function (xml, tgt) {
      var sd = XX().parseSheet(xml); if (!sd) return { ok: true };
      sd.rows.forEach(function (row) { if (row.r >= box.r0 && row.r <= box.r1) row.cells = row.cells.filter(function (c) { return c.c < box.c0 || c.c > box.c1; }); });
      sd.rows = sd.rows.filter(function (row) { return row.cells.length || /\s(ht|customHeight|s|customFormat)=/.test(row.open); });
      var out = XX().serializeSheet(sd); pkg.write(tgt.path, XX().setDimension(out, XX().dimensionOf(XX().parseSheet(out)))); return { ok: true };
    });
  }

  // ---------------- 읽기: 문서 안의 피벗 목록 ----------------
  function parseCacheDef(cx) {
    var o = { fields: [], unsupported: [] }, ws = /<worksheetSource\b[^>]*>/.exec(cx), head = (/<pivotCacheDefinition\b[^>]*>/.exec(cx) || [''])[0];
    var src = /<cacheSource\b[^>]*>/.exec(cx); o.srcType = src ? attr(src[0], 'type') : null;
    if (ws) { o.sheet = un(attr(ws[0], 'sheet') || ''); o.ref = attr(ws[0], 'ref'); o.name = attr(ws[0], 'name'); }
    (cx.match(/<cacheField\b[^>]*?(?:\/>|>[\s\S]*?<\/cacheField>)/g) || []).forEach(function (cf) {
      var h = /<cacheField\b[^>]*>/.exec(cf)[0], labels = [];
      (cf.match(/<(s|n|m|b|e|d)\b[^>]*?\/>/g) || []).forEach(function (it) { var tg = /^<(\w)/.exec(it)[1], v = attr(it, 'v'); labels.push(tg === 'm' ? BLANK : tg === 'n' ? numStr(+v) : un(v == null ? '' : v)); });
      o.fields.push({ name: un(attr(h, 'name') || ''), labels: labels, grouped: /<fieldGroup\b/.test(cf), calc: /\sformula="/.test(h) });
    });
    o.x14 = (/<x14:pivotCacheDefinition\b[^>]*\spivotCacheId="(\d+)"/.exec(cx) || [])[1] || null;
    o.refreshOnLoad = /\srefreshOnLoad="(1|true)"/.test(head);
    return o;
  }
  function parsePivotTable(tx) {
    var head = /<pivotTableDefinition\b[^>]*>/.exec(tx)[0], loc = (/<location\b[^>]*>/.exec(tx) || [''])[0], o = { name: un(attr(head, 'name') || ''), cacheId: attr(head, 'cacheId'), why: [] };
    o.ref = attr(loc, 'ref'); o.fhr = +(attr(loc, 'firstHeaderRow') || 0); o.fdr = +(attr(loc, 'firstDataRow') || 0); o.fdc = +(attr(loc, 'firstDataCol') || 0); o.pageN = +(attr(loc, 'rowPageCount') || 0);
    o.ours = tx.indexOf(MARK) >= 0;
    o.pf = (tx.match(/<pivotField\b[^>]*?(?:\/>|>[\s\S]*?<\/pivotField>)/g) || []).map(function (p) {
      var h = /<pivotField\b[^>]*>/.exec(p)[0];
      return { axis: attr(h, 'axis'), isData: attr(h, 'dataField') === '1', items: (p.match(/<item\b[^>]*?\/>/g) || []).map(function (it) { return { x: attr(it, 'x') == null ? null : +attr(it, 'x'), t: attr(it, 't'), h: attr(it, 'h') === '1' }; }),
        odd: /\s(defaultSubtotal="0"|compact="0"|outline="0"|sortType="descending"|subtotalTop="0"|insertBlankRow="1"|topAutoShow="1"|showAll="1")/.test(h) };
    });
    function fl(tag) { var m = new RegExp('<' + tag + '\\b[\\s\\S]*?</' + tag + '>').exec(tx); return m ? (m[0].match(/<field\b[^>]*>/g) || []).map(function (f) { return +attr(f, 'x'); }) : []; }
    o.rowF = fl('rowFields'); o.colF = fl('colFields');
    o.pageF = (tx.match(/<pageField\b[^>]*?\/>/g) || []).map(function (p) { return { f: +attr(p, 'fld'), item: attr(p, 'item') == null ? null : +attr(p, 'item') }; });
    o.dataF = (tx.match(/<dataField\b[^>]*?\/>/g) || []).map(function (p) { return { f: +attr(p, 'fld'), fn: attr(p, 'subtotal') || 'sum', name: un(attr(p, 'name') || ''), numFmtId: attr(p, 'numFmtId') }; });
    var bad = (/<(calculatedItems|formats|conditionalFormats|filters|chartFormats|pivotHierarchies|rowHierarchiesUsage|colHierarchiesUsage|autoSortScope)\b/.exec(tx) || [])[1];
    if (bad) o.why.push(bad === 'filters' ? '값·레이블 필터가 걸린' : bad === 'formats' || bad === 'conditionalFormats' ? '칸 서식을 따로 정한' : bad === 'calculatedItems' ? '계산 항목이 든' : '특수한');
    if (/\sdataOnRows="(1|true)"/.test(head)) o.why.push('값이 줄 방향으로 놓인');
    if (/\scompact="0"/.test(head) || /\soutline="0"/.test(head) || !/\soutline="1"/.test(head)) o.why.push('압축형이 아닌 표 모양의');
    if (/\s(rowGrandTotals|colGrandTotals)="(0|false)"/.test(head)) o.why.push('총합계를 숨긴');
    if (o.pf.some(function (p) { return p.odd; })) o.why.push('필드를 따로 정렬·표시한');
    if (o.rowF.filter(function (x) { return x >= 0; }).length > 2) o.why.push('행 필드가 3개 이상인');
    if (o.colF.filter(function (x) { return x >= 0; }).length > 1) o.why.push('열 필드가 2개 이상인');
    if (o.pageF.length > 2) o.why.push('필터 필드가 3개 이상인');
    if (!o.rowF.filter(function (x) { return x >= 0; }).length) o.why.push('행 필드가 없는');
    if (o.dataF.length < 1 || o.dataF.length > 4) o.why.push('값이 없거나 5개 이상인');
    if (o.dataF.some(function (d) { return ['sum', 'count', 'average', 'max', 'min'].indexOf(d.fn) < 0; })) o.why.push('합계·개수·평균·최대·최소 말고 다른 계산(표준편차 등)을 쓰는');
    return o;
  }
  // 문서 안 모든 피벗: [{ name, sheet, tablePath, cachePath, recPath, cache(parseCacheDef), t(parsePivotTable), cfg|null, why:[…] }]
  function listPivots(pkg) {
    return ST().wbInfo(pkg).then(function (info) {
      if (!info) return [];
      var out = [], chain = Promise.resolve();
      info.sheets.forEach(function (sh) {
        if (!sh.path) return;
        chain = chain.then(function () { return pkg.read(relsPath(sh.path)); }).then(function (rx) {
          var ts = parseRels(rx).filter(function (r) { return r.type === 'pivotTable' && r.mode !== 'External'; }), p2 = Promise.resolve();
          ts.forEach(function (tr) {
            p2 = p2.then(function () {
              var tp = resolvePath(sh.path, tr.target); return pkg.read(tp).then(function (tx) {
                if (!tx) return; var t = parsePivotTable(tx);
                return pkg.read(relsPath(tp)).then(function (trx) {
                  var cr = parseRels(trx).filter(function (r) { return r.type === 'pivotCacheDefinition'; })[0], cp = cr ? resolvePath(tp, cr.target) : null;
                  return (cp ? pkg.read(cp) : Promise.resolve(null)).then(function (cx) {
                    return (cp ? pkg.read(relsPath(cp)) : Promise.resolve(null)).then(function (crx) {
                      var rr = crx ? parseRels(crx).filter(function (r) { return r.type === 'pivotCacheRecords'; })[0] : null;
                      var cache = cx ? parseCacheDef(cx) : null, pv = { name: t.name, sheet: sh.name, sheetPath: sh.path, tablePath: tp, cachePath: cp, recPath: rr && cp ? resolvePath(cp, rr.target) : null, cache: cache, t: t, why: t.why.slice(), ours: t.ours };
                      if (!cache) pv.why.push('원본 정보를 읽을 수 없는');
                      else {
                        if (cache.srcType !== 'worksheet') pv.why.push('시트 밖(외부 자료)을 원본으로 하는');
                        else if (!cache.ref || !cache.sheet) pv.why.push('이름이나 표로 원본을 가리키는');
                        if (cache.fields.some(function (f) { return f.grouped; })) pv.why.push('그룹(날짜·숫자 묶음)을 쓴');
                        if (cache.fields.some(function (f) { return f.calc; })) pv.why.push('계산 필드가 든');
                      }
                      out.push(pv);
                    });
                  });
                });
              });
            });
          });
          return p2;
        });
      });
      return chain.then(function () {
        // 같은 캐시를 두 피벗이 쓰면 고치기를 막는다
        var cnt = {}; out.forEach(function (p) { cnt[p.cachePath] = (cnt[p.cachePath] || 0) + 1; });
        out.forEach(function (p) {
          if (cnt[p.cachePath] > 1) p.why.push('같은 원본 정보를 다른 피벗과 함께 쓰는');
          p.editable = !p.why.length;
          if (p.editable) p.cfg = cfgFromParsed(p);
        });
        return out;
      });
    });
  }
  function cfgFromParsed(pv) {
    var t = pv.t, c = pv.cache, loc = parseRange(t.ref), cfg = { name: t.name, sheet: pv.sheet, source: { sheet: c.sheet, ref: c.ref }, rows: t.rowF.filter(function (x) { return x >= 0; }), cols: t.colF.filter(function (x) { return x >= 0; }), pages: t.pageF.map(function (p) { return p.f; }), pageSel: {}, hidden: {}, data: t.dataF.map(function (d) { return { f: d.f, fn: d.fn, name: d.name, numFmtId: d.numFmtId }; }), r0: loc ? loc.r0 : 3, c0: loc ? loc.c0 : 1 };
    t.pf.forEach(function (p, j) {
      var lab = (c.fields[j] && c.fields[j].labels) || [], hid = p.items.filter(function (it) { return it.h && it.x != null; }).map(function (it) { return lab[it.x]; }).filter(function (l) { return l != null; });
      if (hid.length) cfg.hidden[j] = hid;
    });
    cfg.listed = []; t.pf.forEach(function (p, j) { if (!p.axis && p.items.length) cfg.listed.push(j); });
    t.pageF.forEach(function (p) { if (p.item != null) { var it = t.pf[p.f] && t.pf[p.f].items[p.item]; var lab = (c.fields[p.f] && c.fields[p.f].labels) || []; if (it && it.x != null && lab[it.x] != null) cfg.pageSel[p.f] = lab[it.x]; } });
    return cfg;
  }

  // ---------------- 쓰기: 만들기 · 다시 쓰기 ----------------
  // pkg 에 피벗(캐시·레코드·피벗 정의·시트 칸)을 쓴다. place = { sheetPath, tablePath, cachePath, recPath, cacheId, rid, x14, new }
  function buildAll(pkg, cfg, place, oldBox, dataStyle) {
    return readTable(pkg, cfg.source.sheet, cfg.source.ref).then(function (T) {
      if (T.err) return T;
      var FF = buildFields(T); if (FF.err) return FF;
      var F = FF.F, bad = null;
      cfg.rows.concat(cfg.cols, cfg.pages, cfg.data.map(function (d) { return d.f; })).forEach(function (f) { if (!F[f]) bad = '필드 번호가 원본과 맞지 않습니다.'; });
      if (bad) return { err: bad };
      F.forEach(function (f) { if (f.items.length > MAX_ITEMS && (cfg.rows.indexOf(f.idx) >= 0 || cfg.cols.indexOf(f.idx) >= 0 || cfg.pages.indexOf(f.idx) >= 0)) bad = '「' + f.name + '」의 항목 종류가 ' + MAX_ITEMS + '개를 넘어서 폰에서는 행·열·필터로 쓸 수 없습니다.'; });
      if (bad) return { err: bad };
      var M = compute(cfg, FF), L = layout(cfg, FF, M);
      if (L.w > 80 || L.h > 5000) return { err: '피벗 표가 너무 커집니다(' + L.h + '줄 × ' + L.w + '칸). 열 필드를 빼거나 항목을 줄여 주십시오.' };
      var at = { r0: place.r0 || startRow(cfg), c0: place.c0 || 1 };
      return writeCells(pkg, cfg.sheet, cfg, FF, L, at, oldBox, dataStyle).then(function (w) {
        if (w.err) return w;
        pkg.write(place.cachePath, cacheDefXml(cfg, FF, { rid: 'rId1', x14: place.x14 }));
        pkg.write(relsPath(place.cachePath), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + RT + 'pivotCacheRecords" Target="' + relTarget(place.cachePath, place.recPath) + '"/></Relationships>');
        pkg.write(place.recPath, cacheRecXml(cfg, FF));
        pkg.write(place.tablePath, tableXml(cfg, FF, M, L, { cacheId: place.cacheId, r0: at.r0, c0: at.c0 }));
        return { ok: true, FF: FF, M: M, L: L, at: at, box: w.box, nRec: FF.nRec, nVis: M.nVis };
      });
    });
  }
  // 새 피벗. cfg.sheet = 놓을 시트(없으면 새로 만든다 → cfg.newSheet 이름)
  function createPivot(pkg, cfg0) {
    var cfg = JSON.parse(JSON.stringify(cfg0)); cfg.hidden = cfg.hidden || {}; cfg.pageSel = cfg.pageSel || {}; cfg.pages = cfg.pages || []; cfg.cols = cfg.cols || [];
    if (!cfg.rows || !cfg.rows.length || cfg.rows.length > 2) return Promise.resolve({ err: '행으로 쓸 필드를 1~2개 골라 주십시오.' });
    if (cfg.cols.length > 1 || cfg.pages.length > 2) return Promise.resolve({ err: '열 필드는 1개, 필터 필드는 2개까지입니다.' });
    if (!cfg.data || !cfg.data.length || cfg.data.length > 4) return Promise.resolve({ err: '값으로 계산할 필드를 1~4개 골라 주십시오.' });
    var used = {}; var dup = false; cfg.rows.concat(cfg.cols, cfg.pages).forEach(function (f) { if (used[f]) dup = true; used[f] = 1; });
    if (dup) return Promise.resolve({ err: '같은 필드를 행·열·필터에 겹쳐 쓸 수 없습니다.' });
    var chain = Promise.resolve();
    if (!cfg.sheet) chain = ST().addSheet(pkg, cfg.newSheet).then(function (r) { if (r.err) return r; cfg.sheet = cfg.newSheet; return null; });
    return chain.then(function (e) {
      if (e && e.err) return e;
      return ST().wbInfo(pkg).then(function (info) {
        var sh = null; info.sheets.forEach(function (s) { if (XX().sameName(s.name, cfg.sheet)) sh = s; }); if (!sh || !sh.path) return { err: '피벗을 놓을 시트를 찾지 못했습니다.' };
        var nTable = nextNum(pkg, 'xl/pivotTables/', 'pivotTable', 'xml'), nCache = nextNum(pkg, 'xl/pivotCache/', 'pivotCacheDefinition', 'xml'), nRec = nextNum(pkg, 'xl/pivotCache/', 'pivotCacheRecords', 'xml');
        var wbx = info.wb, mx = 0; (wbx.match(/<pivotCache\b[^>]*>/g) || []).forEach(function (t) { mx = Math.max(mx, +(attr(t, 'cacheId') || 0)); });
        var names = {}; return listPivots(pkg).then(function (ex) {
          ex.forEach(function (p) { names[p.name.toLowerCase()] = 1; });
          var base = cfg.name || 'PivotTable', nm = base, k = 1; while (names[nm.toLowerCase()]) nm = base + (++k); cfg.name = nm;
          var place = { tablePath: 'xl/pivotTables/pivotTable' + nTable + '.xml', cachePath: 'xl/pivotCache/pivotCacheDefinition' + nCache + '.xml', recPath: 'xl/pivotCache/pivotCacheRecords' + nRec + '.xml', cacheId: mx + 1, x14: String(100000000 + Math.floor(Math.random() * 800000000)), r0: cfg.r0, c0: cfg.c0 };
          return buildAll(pkg, cfg, place, null, null).then(function (res) {
            if (res.err) return res;
            // 연결: 시트 rels · 피벗 rels · 통합 문서 · 형식 등록
            var sRelsP = relsPath(sh.path);
            return pkg.read(sRelsP).then(function (srx) {
              srx = srx || emptyRels(); var sid = nextRid(srx);
              pkg.write(sRelsP, srx.replace('</Relationships>', '<Relationship Id="' + sid + '" Type="' + RT + 'pivotTable" Target="' + relTarget(sh.path, place.tablePath) + '"/></Relationships>'));
              pkg.write(relsPath(place.tablePath), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + RT + 'pivotCacheDefinition" Target="' + relTarget(place.tablePath, place.cachePath) + '"/></Relationships>');
              var wrels = info.rels, wid = nextRid(wrels);
              pkg.write('xl/_rels/workbook.xml.rels', wrels.replace('</Relationships>', '<Relationship Id="' + wid + '" Type="' + RT + 'pivotCacheDefinition" Target="' + relTarget('xl/workbook.xml', place.cachePath) + '"/></Relationships>'));
              var w2 = info.wb, pc = '<pivotCache cacheId="' + place.cacheId + '" r:id="' + wid + '"/>';
              if (/<pivotCaches\b/.test(w2)) w2 = w2.replace('</pivotCaches>', pc + '</pivotCaches>');
              else { var nxt = /<(smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b/.exec(w2), at = nxt ? nxt.index : w2.lastIndexOf('</workbook>'); w2 = w2.slice(0, at) + '<pivotCaches>' + pc + '</pivotCaches>' + w2.slice(at); }
              if (!/<workbook\b[^>]*\sxmlns:r=/.test(w2)) w2 = w2.replace(/<workbook\b/, '<workbook xmlns:r="' + NSR + '"');
              pkg.write('xl/workbook.xml', w2);
              var ct = ctAdd(ctAdd(ctAdd(info.ct, '/' + place.cachePath, CT.def), '/' + place.recPath, CT.rec), '/' + place.tablePath, CT.tbl); pkg.write('[Content_Types].xml', ct);
              // 새 시트면 열 너비를 읽기 좋게
              return (cfg.newSheet ? widen(pkg, sh.path, res.L.w) : Promise.resolve()).then(function () { return { ok: true, name: cfg.name, sheet: cfg.sheet, nRec: res.nRec, nVis: res.nVis, box: res.box, cfg: cfg }; });
            });
          });
        });
      });
    });
  }
  function widen(pkg, path, w) {
    return pkg.read(path).then(function (xml) {
      if (!xml || /<cols\b/.test(xml)) return;
      var cols = '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="' + Math.max(2, Math.min(w, 60)) + '" width="13" customWidth="1"/></cols>';
      pkg.write(path, ST().insertWsElement(xml, 'cols', cols));
    });
  }
  function findPivot(list, name) { var r = null; list.forEach(function (p) { if (p.name === name) r = p; }); return r; }
  // 피벗 하나를 새 설정으로 다시 쓴다(새로 고침·필드 고치기·슬라이서). cfg 를 주지 않으면 지금 설정 그대로(새로 고침)
  function rewritePivot(pkg, name, mut) {
    return listPivots(pkg).then(function (list) {
      var pv = findPivot(list, name); if (!pv) return { err: '피벗 표를 찾지 못했습니다.' };
      if (!pv.editable) return { err: '이 피벗은 폰에서 고치거나 새로 고칠 수 없는 모양입니다(' + pv.why.join(', ') + '). 엑셀에서 열면 자동으로 새로 고쳐집니다.' };
      var cfg = JSON.parse(JSON.stringify(pv.cfg)); if (mut) { var e = mut(cfg, pv); if (e && e.err) return e; }
      var old = parseRange(pv.t.ref), oldBox = old ? { r0: pv.t.pageN ? Math.max(1, old.r0 - pv.t.pageN - 1) : old.r0, c0: old.c0, r1: old.r1, c1: old.c1 } : null;
      // 데이터 칸 서식(첫 값 칸의 s)을 이어 쓴다
      return pkg.read(pv.sheetPath).then(function (sx) {
        var dataStyle = null; if (old && sx) { var sd = XX().parseSheet(sx); if (sd) { var row = XX().getRow(sd, old.r0 + pv.t.fdr, false), cl = row && XX().getCell(row, old.c0 + pv.t.fdc, false); if (cl) { var s = attr(XX().openTagOfCell(cl.raw), 's'); dataStyle = s == null ? null : +s; } } }
        cfg.sheet = pv.sheet;
        var place = { tablePath: pv.tablePath, cachePath: pv.cachePath, recPath: pv.recPath || pv.cachePath.replace('pivotCacheDefinition', 'pivotCacheRecords'), cacheId: +pv.t.cacheId, x14: pv.cache.x14 || String(100000000 + Math.floor(Math.random() * 800000000)), r0: old ? (pv.t.pageN ? old.r0 : old.r0) : null, c0: old ? old.c0 : 1 };
        if (place.r0 != null && cfg.pages.length !== pv.t.pageN) { place.r0 = Math.max(place.r0, startRow(cfg)); }
        var hadRec = !!pv.recPath;
        return buildAll(pkg, cfg, place, oldBox, dataStyle).then(function (res) {
          if (res.err) return res;
          if (!hadRec) {         // 레코드 파트가 없던 피벗이면 연결을 새로 만든다
            return pkg.read('[Content_Types].xml').then(function (ct) { pkg.write('[Content_Types].xml', ctAdd(ct, '/' + place.recPath, CT.rec)); return res; });
          }
          return res;
        }).then(function (res) { if (res.err) return res; return { ok: true, name: cfg.name, nRec: res.nRec, nVis: res.nVis, box: res.box, cfg: cfg }; });
      });
    });
  }
  function refreshPivot(pkg, name) { return rewritePivot(pkg, name, null); }
  function updatePivot(pkg, name, patch) {
    return rewritePivot(pkg, name, function (cfg) {
      ['rows', 'cols', 'pages', 'data', 'hidden', 'pageSel'].forEach(function (k) { if (patch[k] !== undefined) cfg[k] = JSON.parse(JSON.stringify(patch[k])); });
      if (!cfg.rows.length || cfg.rows.length > 2) return { err: '행으로 쓸 필드를 1~2개 골라 주십시오.' };
      if (cfg.cols.length > 1 || cfg.pages.length > 2) return { err: '열 필드는 1개, 필터 필드는 2개까지입니다.' };
      if (!cfg.data.length || cfg.data.length > 4) return { err: '값으로 계산할 필드를 1~4개 골라 주십시오.' };
      var used = {}, dup = false; cfg.rows.concat(cfg.cols, cfg.pages).forEach(function (f) { if (used[f]) dup = true; used[f] = 1; }); if (dup) return { err: '같은 필드를 행·열·필터에 겹쳐 쓸 수 없습니다.' };
      // 바뀐 필드에 맞춰 옛 숨김 목록 정리(축에서 빠진 필드의 숨김은 슬라이서가 쓰는 것이므로 그대로 둔다)
      return null;
    });
  }
  function deletePivot(pkg, name) {
    return listPivots(pkg).then(function (list) {
      var pv = findPivot(list, name); if (!pv) return { err: '피벗 표를 찾지 못했습니다.' };
      return listSlicers(pkg).then(function (sls) {
        var chain = Promise.resolve(); sls.filter(function (s) { return s.pivot === name; }).forEach(function (s) { chain = chain.then(function () { return deleteSlicer(pkg, s.name, true); }); });
        return chain;
      }).then(function () {
        return ST().wbInfo(pkg).then(function (info) {
          var old = parseRange(pv.t.ref), box = old ? { r0: pv.t.pageN ? Math.max(1, old.r0 - pv.t.pageN - 1) : old.r0, c0: old.c0, r1: old.r1, c1: old.c1 } : null;
          return (box ? clearCells(pkg, pv.sheet, box) : Promise.resolve()).then(function () {
            return pkg.read(relsPath(pv.sheetPath)).then(function (srx) {
              var rr = parseRels(srx).filter(function (r) { return r.type === 'pivotTable' && resolvePath(pv.sheetPath, r.target) === pv.tablePath; })[0];
              if (rr) { var n = srx.replace(rr.raw, ''); if (!/<Relationship\b/.test(n)) pkg.remove(relsPath(pv.sheetPath)); else pkg.write(relsPath(pv.sheetPath), n); }
              var ct = info.ct; pkg.remove(pv.tablePath); pkg.remove(relsPath(pv.tablePath)); ct = ctDel(ct, '/' + pv.tablePath);
              var shared = list.some(function (p) { return p !== pv && p.cachePath === pv.cachePath; });
              if (!shared && pv.cachePath) {
                if (pv.recPath) { pkg.remove(pv.recPath); ct = ctDel(ct, '/' + pv.recPath); }
                pkg.remove(pv.cachePath); pkg.remove(relsPath(pv.cachePath)); ct = ctDel(ct, '/' + pv.cachePath);
                var wrels = info.rels, rel = parseRels(wrels).filter(function (r) { return r.type === 'pivotCacheDefinition' && resolvePath('xl/workbook.xml', r.target) === pv.cachePath; })[0], w2 = info.wb;
                if (rel) { wrels = wrels.replace(rel.raw, ''); w2 = w2.replace(new RegExp('<pivotCache\\b[^>]*\\sr:id="' + rel.id + '"[^>]*/>'), '').replace(/<pivotCaches>\s*<\/pivotCaches>/, ''); pkg.write('xl/_rels/workbook.xml.rels', wrels); pkg.write('xl/workbook.xml', w2); }
              }
              pkg.write('[Content_Types].xml', ct); return { ok: true };
            });
          });
        });
      });
    });
  }

  // ---------------- 슬라이서 ----------------
  function slicerCacheName(field, taken) {
    var base = '슬라이서_' + String(field).replace(/[^0-9A-Za-z_À-￿]+/g, '_'), nm = base, k = 1; while (taken[nm.toLowerCase()]) nm = base + (++k); return nm;
  }
  // 문서 안 슬라이서: [{ name, cache, pivot, sheet, field, fieldIdx, items:[{label,sel}], caption, cachePath, slicerPath }]
  function listSlicers(pkg) {
    return ST().wbInfo(pkg).then(function (info) {
      if (!info) return [];
      var caches = parseRels(info.rels).filter(function (r) { return r.type === 'slicerCache'; });
      return listPivots(pkg).then(function (pvs) {
        var out = [], chain = Promise.resolve();
        caches.forEach(function (cr) {
          var cp = resolvePath('xl/workbook.xml', cr.target); chain = chain.then(function () { return pkg.read(cp); }).then(function (cx) {
            if (!cx) return; var head = /<slicerCacheDefinition\b[^>]*>/.exec(cx); if (!head) return;
            var piv = /<pivotTable\b[^>]*>/.exec(cx), tab = /<tabular\b[^>]*>/.exec(cx); if (!piv || !tab) return;     // 표 모양 슬라이서만(타임라인·OLAP 제외)
            var pn = un(attr(piv[0], 'name') || ''), pv = findPivot(pvs, pn), src = un(attr(head[0], 'sourceName') || ''), fi = pv && pv.cache ? pv.cache.fields.map(function (f) { return f.name; }).indexOf(src) : -1;
            var items = (cx.match(/<i\b[^>]*?\/>/g) || []).map(function (i) { return { x: +attr(i, 'x'), sel: attr(i, 's') === '1' }; });
            var labs = pv && pv.cache && fi >= 0 ? pv.cache.fields[fi].labels : [];
            var o = { cache: un(attr(head[0], 'name') || ''), cachePath: cp, cacheRid: cr.id, pivot: pn, field: src, fieldIdx: fi, sheet: pv ? pv.sheet : null, items: items.map(function (i) { return { x: i.x, label: labs[i.x] != null ? labs[i.x] : String(i.x), sel: i.sel }; }), name: null, caption: null, slicerPath: null };
            out.push(o);
          });
        });
        return chain.then(function () {
          // 시트별 slicers 파트에서 슬라이서 이름·표시 이름
          var c2 = Promise.resolve();
          info.sheets.forEach(function (sh) {
            if (!sh.path) return; c2 = c2.then(function () { return pkg.read(relsPath(sh.path)); }).then(function (rx) {
              var p3 = Promise.resolve(); parseRels(rx).filter(function (r) { return r.type === 'slicer'; }).forEach(function (r) {
                var sp = resolvePath(sh.path, r.target); p3 = p3.then(function () { return pkg.read(sp); }).then(function (sx) {
                  (sx || '').replace(/<slicer\b[^>]*?\/>/g, function (t) { var cache = un(attr(t, 'cache') || ''); out.forEach(function (o) { if (o.cache === cache) { o.name = un(attr(t, 'name') || ''); o.caption = un(attr(t, 'caption') || ''); o.slicerPath = sp; o.hostSheet = sh.name; o.hostSheetPath = sh.path; } }); return t; });
                });
              }); return p3;
            });
          });
          return c2;
        }).then(function () { return out.filter(function (o) { return o.name; }); });
      });
    });
  }
  // 슬라이서 만들기: 피벗 pivotName 의 필드 fieldIdx 로. at = { c, r }(그림 자리, 0부터)
  function createSlicer(pkg, pivotName, fieldIdx, at) {
    return listPivots(pkg).then(function (pvs) {
      var pv = findPivot(pvs, pivotName); if (!pv) return { err: '피벗 표를 찾지 못했습니다.' };
      if (!pv.cache || !pv.cache.fields[fieldIdx]) return { err: '필드를 찾지 못했습니다.' };
      if (!pv.editable) return { err: '이 피벗은 폰에서 고칠 수 없는 모양이라 슬라이서를 만들 수 없습니다(' + pv.why.join(', ') + ').' };
      if (!pv.cache.fields[fieldIdx].labels.length) return { err: '이 필드는 항목 목록이 없어(숫자 필드 등) 슬라이서로 만들 수 없습니다. 먼저 피벗을 새로 고쳐 주십시오.' };
      return listSlicers(pkg).then(function (sls) {
        var taken = {}; sls.forEach(function (s) { taken[s.cache.toLowerCase()] = 1; });
        return ST().wbInfo(pkg).then(function (info) {
          (info.wb.match(/<definedName\b[^>]*\sname="[^"]*"/g) || []).forEach(function (t) { taken[un(attr(t, 'name')).toLowerCase()] = 1; });
          var cname = slicerCacheName(pv.cache.fields[fieldIdx].name, taken), field = pv.cache.fields[fieldIdx];
          var shn = info.sheets.filter(function (s) { return s.name === pv.sheet; })[0]; var sheetId = +(attr(shn.tag, 'sheetId') || 0);
          var x14 = pv.cache.x14, items = '';
          // 캐시 정의에 x14 번호가 없으면 넣는다
          return pkg.read(pv.cachePath).then(function (cx) {
            if (!x14) { x14 = String(100000000 + Math.floor(Math.random() * 800000000)); var ext = '<extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="' + X14 + '"><x14:pivotCacheDefinition pivotCacheId="' + x14 + '"/></ext></extLst>'; cx = /<extLst>/.test(cx) ? cx.replace('<extLst>', '<extLst>' + ext.replace(/^<extLst>|<\/extLst>$/g, '')) : cx.replace('</pivotCacheDefinition>', ext + '</pivotCacheDefinition>'); pkg.write(pv.cachePath, cx); }
            var hid = ((pv.cfg && pv.cfg.hidden && pv.cfg.hidden[fieldIdx]) || []);
            items = field.labels.map(function (l, i) { return '<i x="' + i + '"' + (hid.indexOf(l) < 0 ? ' s="1"' : '') + '/>'; }).join('');
            var nS = nextNum(pkg, 'xl/slicers/', 'slicer', 'xml'), nC = nextNum(pkg, 'xl/slicerCaches/', 'slicerCache', 'xml'), spath = 'xl/slicers/slicer' + nS + '.xml', cpath = 'xl/slicerCaches/slicerCache' + nC + '.xml';
            var capt = field.name, sname = capt, k = 1, usedN = {}; sls.forEach(function (s) { usedN[s.name.toLowerCase()] = 1; }); while (usedN[sname.toLowerCase()]) sname = capt + (++k);
            pkg.write(cpath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="' + X14 + '" xmlns:x="' + NSM + '" name="' + esc(cname) + '" sourceName="' + esc(field.name) + '"><pivotTables><pivotTable tabId="' + sheetId + '" name="' + esc(pivotName) + '"/></pivotTables><data><tabular pivotCacheId="' + x14 + '"><items count="' + field.labels.length + '">' + items + '</items></tabular></data></slicerCacheDefinition>');
            pkg.write(spath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="' + X14 + '" xmlns:x="' + NSM + '"><slicer name="' + esc(sname) + '" cache="' + esc(cname) + '" caption="' + esc(capt) + '" rowHeight="241300"/></slicers>');
            // 통합 문서: 이름 · 관계 · 확장 목록
            var wrels = info.rels, wid = nextRid(wrels); pkg.write('xl/_rels/workbook.xml.rels', wrels.replace('</Relationships>', '<Relationship Id="' + wid + '" Type="' + RT_SLC + '" Target="' + relTarget('xl/workbook.xml', cpath) + '"/></Relationships>'));
            var w2 = info.wb, dn = '<definedName name="' + esc(cname) + '">#N/A</definedName>';
            if (/<definedNames\s*\/>/.test(w2)) w2 = w2.replace(/<definedNames\s*\/>/, '<definedNames>' + dn + '</definedNames>'); else if (/<definedNames>/.test(w2)) w2 = w2.replace('</definedNames>', dn + '</definedNames>'); else { var nx = /<(calcPr|oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b/.exec(w2), at0 = nx ? nx.index : w2.lastIndexOf('</workbook>'); w2 = w2.slice(0, at0) + '<definedNames>' + dn + '</definedNames>' + w2.slice(at0); }
            var sc = '<x14:slicerCache r:id="' + wid + '"/>';
            if (/<x14:slicerCaches>/.test(w2)) w2 = w2.replace('</x14:slicerCaches>', sc + '</x14:slicerCaches>');
            else { var ext2 = '<ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="' + X14 + '"><x14:slicerCaches>' + sc + '</x14:slicerCaches></ext>'; if (/<extLst>/.test(w2)) w2 = w2.replace('<extLst>', '<extLst>' + ext2); else w2 = w2.replace('</workbook>', '<extLst>' + ext2 + '</extLst></workbook>'); }
            if (!/<workbook\b[^>]*\sxmlns:r=/.test(w2)) w2 = w2.replace(/<workbook\b/, '<workbook xmlns:r="' + NSR + '"');
            pkg.write('xl/workbook.xml', w2);
            var ct = ctAdd(ctAdd(info.ct, '/' + cpath, CT.slc), '/' + spath, CT.sl);
            // 피벗이 있는 시트: 그림 틀(drawing) + slicer 관계 + 확장 목록
            return pkg.read(pv.sheetPath).then(function (sxml) {
              return pkg.read(relsPath(pv.sheetPath)).then(function (srx) {
                srx = srx || emptyRels(); var drel = parseRels(srx).filter(function (r) { return r.type === 'drawing' && r.mode !== 'External'; })[0], dpath = drel ? resolvePath(pv.sheetPath, drel.target) : null, creating = !dpath;
                return (dpath ? pkg.read(dpath) : Promise.resolve(null)).then(function (dx) {
                  var drs = dpath ? pkg.read(relsPath(dpath)) : Promise.resolve(null);
                  return drs.then(function (drx) {
                    if (creating) { var dn2 = nextNum(pkg, 'xl/drawings/', 'drawing', 'xml'); dpath = 'xl/drawings/drawing' + dn2 + '.xml'; dx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></xdr:wsDr>'; }
                    else if (!/<(?:\w+:)?wsDr\b/.test(dx)) return { err: '이 시트의 그림 구조가 특이해서 슬라이서를 넣을 수 없습니다.' };
                    var mxid = 1; (dx.match(/<(?:\w+:)?cNvPr\b[^>]*\sid="(\d+)"/g) || []).forEach(function (s) { mxid = Math.max(mxid, +/id="(\d+)"/.exec(s)[1]); });
                    var id = mxid + 1, c0 = at.c, r0 = at.r;
                    var anchor = '<xdr:twoCellAnchor editAs="oneCell" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:from><xdr:col>' + c0 + '</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>' + r0 + '</xdr:row><xdr:rowOff>44450</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + (c0 + 2) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + (r0 + 9) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
                      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="' + esc(sname) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer"><sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="' + esc(sname) + '"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>' +
                      '<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="3810000" y="254000"/><a:ext cx="1524000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="1100"/><a:t>이 도형은 슬라이서를 나타냅니다. 슬라이서는 Excel 2010 이상에서 지원됩니다.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>';
                    var rm = /<((?:\w+:)?)wsDr\b[^>]*?(\/?)>/.exec(dx);
                    if (rm[2] === '/') dx = dx.replace(/<((?:\w+:)?wsDr\b[^>]*?)\/>/, '<$1>' + anchor + '</' + rm[1] + 'wsDr>'); else dx = dx.replace(new RegExp('</' + rm[1] + 'wsDr>'), anchor + '</' + rm[1] + 'wsDr>');
                    pkg.write(dpath, dx); if (!drx) drx = emptyRels(); pkg.write(relsPath(dpath), drx);
                    var sid = nextRid(srx), n2 = srx;
                    if (creating) { var did = sid; n2 = n2.replace('</Relationships>', '<Relationship Id="' + did + '" Type="' + RT + 'drawing" Target="' + relTarget(pv.sheetPath, dpath) + '"/></Relationships>'); sid = nextRid(n2); ct = ctAdd(ct, '/' + dpath, CT.drw); sxml = sxml.replace(/<worksheet\b/, function (m) { return /<worksheet\b[^>]*\sxmlns:r=/.test(sxml) ? m : '<worksheet xmlns:r="' + NSR + '"'; }); sxml = ST().insertWsElement(sxml, 'drawing', '<drawing r:id="' + did + '"/>'); }
                    n2 = n2.replace('</Relationships>', '<Relationship Id="' + sid + '" Type="' + RT_SL + '" Target="' + relTarget(pv.sheetPath, spath) + '"/></Relationships>'); pkg.write(relsPath(pv.sheetPath), n2);
                    var sl = '<x14:slicer r:id="' + sid + '"/>';
                    if (/<x14:slicerList>/.test(sxml)) sxml = sxml.replace('</x14:slicerList>', sl + '</x14:slicerList>');
                    else { var ext3 = '<ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="' + X14 + '"><x14:slicerList>' + sl + '</x14:slicerList></ext>'; sxml = /<extLst>/.test(sxml) ? sxml.replace('<extLst>', '<extLst>' + ext3) : sxml.replace('</worksheet>', '<extLst>' + ext3 + '</extLst></worksheet>'); }
                    if (!/<worksheet\b[^>]*\sxmlns:r=/.test(sxml)) sxml = sxml.replace(/<worksheet\b/, '<worksheet xmlns:r="' + NSR + '"');
                    pkg.write(pv.sheetPath, sxml); pkg.write('[Content_Types].xml', ct);
                    return rewritePivot(pkg, pivotName, function (cfg) { cfg.listed = (cfg.listed || []).filter(function (q) { return q !== fieldIdx; }).concat([fieldIdx]); }).then(function (rr) { return rr.err ? rr : { ok: true, name: sname, cache: cname }; });
                  });
                });
              });
            });
          });
        });
      });
    });
  }
  // 슬라이서에서 고른 항목(라벨 목록)을 피벗과 슬라이서 캐시에 반영한다
  function setSlicerSelection(pkg, slicerName, selected) {
    return listSlicers(pkg).then(function (sls) {
      var sl = null; sls.forEach(function (s) { if (s.name === slicerName) sl = s; }); if (!sl) return { err: '슬라이서를 찾지 못했습니다.' };
      if (!selected.length) return { err: '항목을 하나 이상 고르거나 「모두」를 누르십시오(슬라이서는 빈 선택을 두지 않습니다).' };
      var all = sl.items.map(function (i) { return i.label; }), hid = all.filter(function (l) { return selected.indexOf(l) < 0; });
      return rewritePivot(pkg, sl.pivot, function (cfg) { if (hid.length) cfg.hidden[sl.fieldIdx] = hid; else delete cfg.hidden[sl.fieldIdx]; if (cfg.pages.indexOf(sl.fieldIdx) >= 0 && cfg.pageSel) delete cfg.pageSel[sl.fieldIdx]; }).then(function (r) {
        if (r.err) return r;
        return pkg.read(sl.cachePath).then(function (cx) {
          cx = cx.replace(/<i\b[^>]*?\/>/g, function (t) { var x = +attr(t, 'x'); return '<i x="' + x + '"' + (hid.indexOf(sl.items.filter(function (i) { return i.x === x; })[0].label) < 0 ? ' s="1"' : '') + '/>'; });
          pkg.write(sl.cachePath, cx); return { ok: true, shown: r.nVis };
        });
      });
    });
  }
  function deleteSlicer(pkg, slicerName, keepFilter) {
    return listSlicers(pkg).then(function (sls) {
      var sl = null; sls.forEach(function (s) { if (s.name === slicerName) sl = s; }); if (!sl) return { err: '슬라이서를 찾지 못했습니다.' };
      return ST().wbInfo(pkg).then(function (info) {
        var ct = info.ct; pkg.remove(sl.cachePath); ct = ctDel(ct, '/' + sl.cachePath);
        var wrels = info.rels, w2 = info.wb; wrels = wrels.replace(new RegExp('<Relationship\\b[^>]*\\sId="' + sl.cacheRid + '"[^>]*/>'), '');
        w2 = w2.replace(new RegExp('<x14:slicerCache\\b[^>]*\\sr:id="' + sl.cacheRid + '"[^>]*/>'), '').replace(/<x14:slicerCaches>\s*<\/x14:slicerCaches>/, '').replace(/<ext\b[^>]*uri="\{BBE1A952-AA13-448e-AADC-164F8A28A991\}"[^>]*>\s*<\/ext>/, '').replace(/<extLst>\s*<\/extLst>/, '');
        w2 = w2.replace(new RegExp('<definedName\\b[^>]*\\sname="' + sl.cache.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[^<]*</definedName>'), '').replace(/<definedNames>\s*<\/definedNames>/, '');
        pkg.write('xl/_rels/workbook.xml.rels', wrels); pkg.write('xl/workbook.xml', w2);
        // 슬라이서 파트와 시트 연결, 그림 틀의 그림
        return pkg.read(sl.slicerPath).then(function (sx) {
          var left = (sx || '').replace(new RegExp('<slicer\\b[^>]*\\sname="' + sl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*?/>'), '');
          return pkg.read(relsPath(sl.hostSheetPath)).then(function (srx) {
            var rel = parseRels(srx).filter(function (r) { return r.type === 'slicer' && resolvePath(sl.hostSheetPath, r.target) === sl.slicerPath; })[0];
            return pkg.read(sl.hostSheetPath).then(function (sxml) {
              if (/<slicer\b/.test(left)) pkg.write(sl.slicerPath, left);
              else { pkg.remove(sl.slicerPath); ct = ctDel(ct, '/' + sl.slicerPath); if (rel) { srx = srx.replace(rel.raw, ''); sxml = sxml.replace(new RegExp('<x14:slicer\\b[^>]*\\sr:id="' + rel.id + '"[^>]*/>'), '').replace(/<x14:slicerList>\s*<\/x14:slicerList>/, '').replace(/<ext\b[^>]*uri="\{A8765BA9-456A-4dab-B4F3-ACF838C121DE\}"[^>]*>\s*<\/ext>/, '').replace(/<extLst>\s*<\/extLst>/, ''); } }
              pkg.write(relsPath(sl.hostSheetPath), srx); pkg.write(sl.hostSheetPath, sxml); var sxml2 = sxml;
              var dr = parseRels(srx).filter(function (r) { return r.type === 'drawing'; })[0], dpath = dr ? resolvePath(sl.hostSheetPath, dr.target) : null;
              return (dpath ? pkg.read(dpath) : Promise.resolve(null)).then(function (dx) {
                if (dx) {
                  var re = /<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>|<xdr:oneCellAnchor\b[\s\S]*?<\/xdr:oneCellAnchor>|<xdr:absoluteAnchor\b[\s\S]*?<\/xdr:absoluteAnchor>/g;
                  dx = dx.replace(re, function (b) { return b.indexOf('sle:slicer') >= 0 && new RegExp('<sle:slicer\\b[^>]*\\sname="' + sl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(b) ? '' : b; });
                  if (!/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b/.test(dx)) {         // 그림 틀에 아무것도 안 남으면 틀도 걷어 낸다
                    var dr2 = parseRels(srx).filter(function (r) { return r.type === 'drawing'; })[0];
                    pkg.remove(dpath); pkg.remove(relsPath(dpath)); ct = ctDel(ct, '/' + dpath);
                    if (dr2) { srx = srx.replace(dr2.raw, ''); sxml2 = sxml2.replace(new RegExp('<drawing\\b[^>]*\\sr:id="' + dr2.id + '"[^>]*/>'), ''); if (!/<Relationship\b/.test(srx)) { pkg.remove(relsPath(sl.hostSheetPath)); } else pkg.write(relsPath(sl.hostSheetPath), srx); pkg.write(sl.hostSheetPath, sxml2); }
                  } else pkg.write(dpath, dx);
                }
                pkg.write('[Content_Types].xml', ct);
                if (keepFilter) return { ok: true };
                // 슬라이서를 지우면 걸어 둔 걸러내기도 풀어 준다(보이는 모습이 그대로 남는 것이 오히려 혼란스럽다)
                return rewritePivot(pkg, sl.pivot, function (cfg) { delete cfg.hidden[sl.fieldIdx]; }).then(function (r) { return r.err ? { ok: true, note: r.err } : { ok: true }; });
              });
            });
          });
        });
      });
    });
  }

  var api = { FNS: FNS, FN_NAME: FN_NAME, MARK: MARK, BLANK: BLANK, readTable: readTable, buildFields: buildFields, compute: compute, layout: layout, dataName: dataName, parseRange: parseRange, rangeText: rangeText,
    listPivots: listPivots, createPivot: createPivot, refreshPivot: refreshPivot, updatePivot: updatePivot, deletePivot: deletePivot, listSlicers: listSlicers, createSlicer: createSlicer, setSlicerSelection: setSlicerSelection, deleteSlicer: deleteSlicer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxPivot = api;
})(typeof window !== 'undefined' ? window : globalThis);
