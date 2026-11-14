/* so-xlsx-chart.js — S-Office 엑셀 차트(O-0861, v10.9): 고른 칸으로 차트 만들기 · 있는 차트 고치기(종류·데이터 범위·제목·범례·축 제목·숫자 표시·색) · 지우기 · 자리·크기 · 시트 위에 미리 그리기.
 * 파일 안에는 진짜 차트(xl/charts, xl/drawings)가 들어가고, 엑셀에서 칸 값을 고치면 차트가 따라 바뀐다. 폰 화면의 그림은 so-chart.js 의 자체 SVG 이며 파일에는 들어가지 않는다.
 * 3차원·콤보·보조 축·추세선이 든 차트는 고치지 않고 자리·크기·지우기만(고치기는 「수정 요청」 안내). 외부 부품 없음. 스위치 SO_CHART.
 */
(function (global) {
  'use strict';
  var ST = global.SOXlsxStruct, EMU = 9525;
  var NS = { xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', a: 'http://schemas.openxmlformats.org/drawingml/2006/main', c: 'http://schemas.openxmlformats.org/drawingml/2006/chart', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' };
  var RT = NS.r + '/';
  function Ch() { return global.SOChart; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function attrOf(tag, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function relsPath(p) { return p.replace(/([^\/]+)$/, '_rels/$1.rels'); }
  function resolvePath(base, tg) {
    if (/^[A-Za-z]+:/.test(tg)) return null; if (tg.charAt(0) === '/') return tg.slice(1);
    var parts = base.replace(/[^\/]+$/, '').split('/').filter(Boolean); tg.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); }); return parts.join('/');
  }
  function relTarget(from, to) { var a = from.replace(/[^\/]+$/, '').split('/').filter(Boolean), b = to.split('/'), i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++; var o = []; for (var k = a.length - i; k > 0; k--) o.push('..'); return o.concat(b.slice(i)).join('/'); }
  function emptyRels() { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'; }
  function parseRels(x) { return (x || '').match(/<Relationship\b[^>]*?\/?>/g) ? (x.match(/<Relationship\b[^>]*?\/?>/g)).map(function (t) { return { id: attrOf(t, 'Id'), type: (attrOf(t, 'Type') || '').replace(/^.*\//, ''), target: attrOf(t, 'Target') || '', mode: attrOf(t, 'TargetMode'), raw: t }; }) : []; }
  function nextRid(x) { var mx = 0; (x.match(/\sId="rId(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return 'rId' + (mx + 1); }
  function nextNum(pkg, dir, base, ext) { var mx = 0, re = new RegExp('^' + dir.replace(/[.\/]/g, '\\$&') + base + '(\\d+)\\.' + ext + '$'); pkg.list().forEach(function (p) { var m = re.exec(p); if (m) mx = Math.max(mx, +m[1]); }); return mx + 1; }
  function ctAdd(ct, part, type) { return ct.indexOf('PartName="' + part + '"') >= 0 ? ct : ct.replace('</Types>', '<Override PartName="' + part + '" ContentType="' + type + '"/></Types>'); }
  function ctDel(ct, part) { return ct.replace(new RegExp('<Override\\b[^>]*PartName="' + part.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''); }

  // ---------------- 시트의 그림 틀(drawing) 읽기 ----------------
  async function load(pkg, sheetName) {
    var info = await ST.wbInfo(pkg), tgt = null; if (!info) return { err: '문서 구조를 읽지 못했습니다.' };
    info.sheets.forEach(function (s) { if (s.name === sheetName) tgt = s; }); if (!tgt || !tgt.path) return { err: '이 시트에는 차트를 넣을 수 없습니다.' };
    var cx = { tgt: tgt, xml: await pkg.read(tgt.path), sRelsPath: relsPath(tgt.path) }; cx.sRels = await pkg.read(cx.sRelsPath);
    var dr = parseRels(cx.sRels).filter(function (r) { return r.type === 'drawing' && r.mode !== 'External'; })[0];
    if (dr) { cx.dRel = dr; cx.dPath = resolvePath(tgt.path, dr.target); cx.dXml = cx.dPath ? await pkg.read(cx.dPath) : null; cx.dRelsPath = cx.dPath ? relsPath(cx.dPath) : null; cx.dRels = cx.dRelsPath ? await pkg.read(cx.dRelsPath) : null; }
    return cx;
  }
  function blocks(dxml) { var re = /<((?:\w+:)?)(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/\1\2>/g, m, out = []; while ((m = re.exec(dxml))) out.push({ s: m.index, e: m.index + m[0].length, kind: m[2], pf: m[1], xml: m[0] }); return out; }
  function kid(n, name) { for (var c = n && n.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; }
  function numIn(n, name) { var k = kid(n, name); return k ? +k.textContent : 0; }
  function markerOf(n) { return n ? { c: numIn(n, 'col'), co: numIn(n, 'colOff'), r: numIn(n, 'row'), ro: numIn(n, 'rowOff') } : null; }
  function parseAnchor(b) {
    var d = new DOMParser().parseFromString('<w xmlns="' + NS.xdr + '" xmlns:xdr="' + NS.xdr + '" xmlns:a="' + NS.a + '" xmlns:c="' + NS.c + '" xmlns:r="' + NS.r + '">' + b.xml + '</w>', 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return null;
    var an = d.documentElement.firstElementChild, ch = an.getElementsByTagNameNS(NS.c, 'chart')[0], gf = kid(an, 'graphicFrame'), nm = gf ? kid(kid(gf, 'nvGraphicFramePr'), 'cNvPr') : null;
    var ext = kid(an, 'ext'), pos = kid(an, 'pos');
    return { kind: b.kind, from: markerOf(kid(an, 'from')), to: markerOf(kid(an, 'to')), ext: ext ? { cx: +ext.getAttribute('cx'), cy: +ext.getAttribute('cy') } : null, pos: pos ? { x: +pos.getAttribute('x'), y: +pos.getAttribute('y') } : null,
      rid: ch ? ch.getAttributeNS(NS.r, 'id') : null, name: nm ? nm.getAttribute('name') : '' };
  }
  async function listCharts(pkg, sheetName) {
    var cx = await load(pkg, sheetName); if (cx.err) return { err: cx.err, charts: [] };
    var out = []; if (!cx.dXml) return { charts: out };
    var rels = parseRels(cx.dRels), bl = blocks(cx.dXml);
    for (var i = 0; i < bl.length; i++) {
      var a = parseAnchor(bl[i]); if (!a || !a.rid) continue;
      var rl = rels.filter(function (r) { return r.id === a.rid; })[0]; if (!rl) continue;
      var cp = resolvePath(cx.dPath, rl.target), cxml = cp ? await pkg.read(cp) : null; if (!cxml) continue;
      var info = Ch().parse(cxml); out.push({ idx: out.length, anchor: a, chartPath: cp, info: info, name: a.name });
    }
    return { charts: out };
  }
  // ---------------- 만들기·고치기·지우기·옮기기 ----------------
  async function addChart(pkg, sheetName, spec, at) {
    var cx = await load(pkg, sheetName); if (cx.err) return cx; var C = Ch(), sp = C.clone(spec); sp.frame = true;
    if (cx.dXml && !/<(?:\w+:)?wsDr\b/.test(cx.dXml)) return { err: '이 시트의 그림 구조가 특이해서 차트를 넣을 수 없습니다.' };
    if (cx.dRel && !cx.dXml) return { err: '이 시트의 그림 틀을 찾지 못했습니다.' };
    var n = nextNum(pkg, 'xl/charts/', 'chart', 'xml'), cpath = 'xl/charts/chart' + n + '.xml', ct = await pkg.read('[Content_Types].xml');
    pkg.write(cpath, C.chartXml(sp, {})); ct = ctAdd(ct, '/' + cpath, C.CT_CHART);
    var dpath = cx.dPath, dxml = cx.dXml, drels = cx.dRels, creating = !dpath;
    if (creating) { var dn = nextNum(pkg, 'xl/drawings/', 'drawing', 'xml'); dpath = 'xl/drawings/drawing' + dn + '.xml'; dxml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="' + NS.xdr + '" xmlns:a="' + NS.a + '"></xdr:wsDr>'; drels = emptyRels(); }
    if (!drels) drels = emptyRels();
    var rid = nextRid(drels); drels = drels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT + 'chart" Target="' + relTarget(dpath, cpath) + '"/></Relationships>');
    var mx = 1; (dxml.match(/<(?:\w+:)?cNvPr\b[^>]*\sid="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/id="(\d+)"/.exec(s)[1]); });
    var id = mx + 1, w = at.cx || 4572000, h = at.cy || 2857500;
    var anchor = '<xdr:oneCellAnchor xmlns:xdr="' + NS.xdr + '" xmlns:a="' + NS.a + '"><xdr:from><xdr:col>' + at.c + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + at.r + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="' + w + '" cy="' + h + '"/>' +
      '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + id + '" name="차트 ' + (id - 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="' + NS.c + '"><c:chart xmlns:c="' + NS.c + '" xmlns:r="' + NS.r + '" r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';
    var rootM = /<((?:\w+:)?)wsDr\b[^>]*?(\/?)>/.exec(dxml);
    if (rootM[2] === '/') dxml = dxml.replace(/<((?:\w+:)?wsDr\b[^>]*?)\/>/, '<$1>' + anchor + '</' + rootM[1] + 'wsDr>'); else dxml = dxml.replace(new RegExp('</' + rootM[1] + 'wsDr>'), anchor + '</' + rootM[1] + 'wsDr>');
    pkg.write(dpath, dxml); pkg.write(relsPath(dpath), drels);
    if (creating) {
      var sr = cx.sRels || emptyRels(), sid = nextRid(sr);
      pkg.write(cx.sRelsPath, sr.replace('</Relationships>', '<Relationship Id="' + sid + '" Type="' + RT + 'drawing" Target="' + relTarget(cx.tgt.path, dpath) + '"/></Relationships>'));
      var xml = cx.xml; if (!/<worksheet\b[^>]*\sxmlns:r="/.test(xml)) xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="' + NS.r + '"');
      xml = ST.insertWsElement(xml, 'drawing', '<drawing r:id="' + sid + '"/>'); pkg.write(cx.tgt.path, xml);
      ct = ctAdd(ct, '/' + dpath, 'application/vnd.openxmlformats-officedocument.drawing+xml');
    }
    pkg.write('[Content_Types].xml', ct); return { ok: true, chartPath: cpath };
  }
  async function updateChart(pkg, sheetName, chartPath, spec) {
    var C = Ch(), old = C.parse(await pkg.read(chartPath)); if (!old.ok) return { err: old.why };
    var sp = C.clone(spec); sp.frame = true; pkg.write(chartPath, C.chartXml(sp, {})); return { ok: true };
  }
  async function removeChart(pkg, sheetName, chartPath) {
    var cx = await load(pkg, sheetName); if (cx.err) return cx; if (!cx.dXml) return { err: '지울 차트를 찾지 못했습니다.' };
    var rels = parseRels(cx.dRels), bl = blocks(cx.dXml), hit = null, hitRel = null;
    bl.forEach(function (b) { var a = parseAnchor(b); if (!a || !a.rid) return; var rl = rels.filter(function (r) { return r.id === a.rid; })[0]; if (rl && resolvePath(cx.dPath, rl.target) === chartPath) { hit = b; hitRel = rl; } });
    if (!hit) return { err: '지울 차트를 찾지 못했습니다.' };
    var dx = cx.dXml.slice(0, hit.s) + cx.dXml.slice(hit.e), nr = cx.dRels.replace(hitRel.raw, ''), ct = await pkg.read('[Content_Types].xml');
    var crp = relsPath(chartPath), crx = await pkg.read(crp);
    if (crx) parseRels(crx).forEach(function (r) { if (r.mode === 'External') return; var p = resolvePath(chartPath, r.target); if (p && /^xl\/(charts|embeddings)\//.test(p) && pkg.list().indexOf(p) >= 0) { pkg.remove(p); ct = ctDel(ct, '/' + p); } });
    pkg.remove(chartPath); pkg.remove(crp); ct = ctDel(ct, '/' + chartPath);
    var left = blocks(dx).length;
    if (!left && !/<(?:\w+:)?(sp|pic|grpSp|cxnSp|graphicFrame)\b/.test(dx)) {      // 그림 틀에 아무것도 안 남으면 틀도 걷어 낸다
      pkg.remove(cx.dPath); pkg.remove(cx.dRelsPath); ct = ctDel(ct, '/' + cx.dPath);
      var sr = cx.sRels.replace(cx.dRel.raw, ''); if (!/<Relationship\b/.test(sr)) pkg.remove(cx.sRelsPath); else pkg.write(cx.sRelsPath, sr);
      pkg.write(cx.tgt.path, cx.xml.replace(new RegExp('<drawing\\b[^>]*\\sr:id="' + cx.dRel.id + '"[^>]*/>'), ''));
    } else { pkg.write(cx.dPath, dx); pkg.write(cx.dRelsPath, nr); }
    pkg.write('[Content_Types].xml', ct); return { ok: true };
  }
  // d: { dc, dr(칸 수 이동), dw, dh(칸 수 크기), toC, toR(이 칸으로 옮기기) }
  async function moveChart(pkg, sheetName, chartPath, d) {
    var cx = await load(pkg, sheetName); if (cx.err || !cx.dXml) return cx.err ? cx : { err: '차트를 찾지 못했습니다.' };
    var rels = parseRels(cx.dRels), bl = blocks(cx.dXml), done = false, out = cx.dXml;
    for (var i = bl.length - 1; i >= 0; i--) {
      var a = parseAnchor(bl[i]); if (!a || !a.rid) continue; var rl = rels.filter(function (r) { return r.id === a.rid; })[0]; if (!rl || resolvePath(cx.dPath, rl.target) !== chartPath) continue;
      var x = bl[i].xml, P = bl[i].pf, dc = d.dc || 0, dr = d.dr || 0;
      if (d.toC != null && a.from) { dc = d.toC - a.from.c; dr = d.toR - a.from.r; }
      if (a.kind === 'absoluteAnchor') return { err: '이 차트는 자리를 칸으로 옮길 수 없는 방식입니다.' };
      x = shiftMarker(x, P, 'from', dc, dr);
      if (a.kind === 'twoCellAnchor') {
        x = shiftMarker(x, P, 'to', dc + (d.dw || 0), dr + (d.dh || 0));
        var f2 = parseAnchor({ kind: a.kind, xml: x });
        if (f2.to.c <= f2.from.c) x = setMarker(x, P, 'to', 'col', f2.from.c + 1, 'colOff', 0);
        if (f2.to.r <= f2.from.r) x = setMarker(x, P, 'to', 'row', f2.from.r + 1, 'rowOff', 0);
      } else if (a.ext && (d.dw || d.dh)) {
        x = x.replace(new RegExp('<' + P + 'ext\\b[^>]*/>'), '<' + P + 'ext cx="' + Math.max(1200000, a.ext.cx + (d.dw || 0) * 609600) + '" cy="' + Math.max(900000, a.ext.cy + (d.dh || 0) * 190500) + '"/>');
      }
      out = out.slice(0, bl[i].s) + x + out.slice(bl[i].e); done = true;
    }
    if (!done) return { err: '차트를 찾지 못했습니다.' }; pkg.write(cx.dPath, out); return { ok: true };
  }
  function shiftMarker(x, P, tag, dc, dr) {
    var re = new RegExp('(<' + P + tag + '>[\\s\\S]*?<' + P + 'col>)(\\d+)(</' + P + 'col>[\\s\\S]*?<' + P + 'row>)(\\d+)(</' + P + 'row>)');
    return x.replace(re, function (m, p1, c, p3, r, p5) { return p1 + Math.max(0, +c + dc) + p3 + Math.max(0, +r + dr) + p5; });
  }
  function setMarker(x, P, tag, k1, v1, k2, v2) {
    var m = new RegExp('<' + P + tag + '>[\\s\\S]*?</' + P + tag + '>').exec(x); if (!m) return x; var b = m[0];
    b = b.replace(new RegExp('(<' + P + k1 + '>)\\d+'), '$1' + v1).replace(new RegExp('(<' + P + k2 + '>)\\d+'), '$1' + v2);
    return x.slice(0, m.index) + b + x.slice(m.index + m[0].length);
  }

  // ---------------- 시트 칸 값 읽기(미리 그림·차트 데이터) ----------------
  function create(env) {
    var U = {}, lastKey = '', loading = 0, sel = -1;
    function S() { return env.S(); }
    function X() { return global.XLSX; }
    function toast(m, ms) { env.toast(m, ms || 2800); }
    function wsOf(name) { var wb = S().wb, ws = wb.Sheets[name]; if (ws) return ws; var lc = String(name).toLowerCase(); for (var k in wb.Sheets) if (k.toLowerCase() === lc) return wb.Sheets[k]; return null; }
    function cellAt(ws, r, c) { return ws[X().utils.encode_cell({ r: r, c: c })]; }
    function textOf(cell) { if (!cell) return ''; if (cell.w != null && cell.w !== '') return String(cell.w); return cell.v == null ? '' : String(cell.v); }
    function numOf(cell) { if (!cell) return null; if (typeof cell.v === 'number' && isFinite(cell.v)) return cell.v; return Ch().toNum(cell.v); }
    function rangeCells(ref) { var rg = Ch().parseRef(ref); if (!rg) return null; var ws = wsOf(rg.sheet); if (!ws) return null; var out = []; for (var r = rg.r0; r <= rg.r1; r++) for (var c = rg.c0; c <= rg.c1; c++) out.push(cellAt(ws, r, c)); return out; }
    // 차트 속 참조를 지금 칸 값으로 새로 읽는다(못 읽는 참조는 파일에 적힌 값을 그대로 둔다)
    function liveSpec(sp0) {
      var sp = Ch().clone(sp0), cats = null;
      sp.series.forEach(function (s, j) {
        var rf = s.refs || {}, nm = rf.name ? rangeCells(rf.name) : null, vs = rf.val ? rangeCells(rf.val) : null, cs = rf.cat ? rangeCells(rf.cat) : null;
        if (nm && nm.length) s.name = textOf(nm[0]);
        if (vs) s.vals = vs.map(numOf);
        if (cs && !cats) cats = cs.map(textOf);
      });
      if (cats) sp.cats = cats; var n = sp.cats.length;
      sp.series.forEach(function (s) { while (s.vals.length < n) s.vals.push(null); s.vals.length = Math.max(n, 0); });
      return sp;
    }
    function dataSig(sp) { return sp.cats.join('|') + '#' + sp.series.map(function (s) { return s.name + ':' + s.vals.join(','); }).join(';'); }
    // ---------------- 시트 위 겹쳐 그리기 ----------------
    function colPx(sh, c) { return c <= sh.nc ? sh.colX[c] : sh.colX[sh.nc] + (c - sh.nc) * 84; }
    function rowPx(sh, r) { return r <= sh.nr ? sh.rowY[r] : sh.rowY[sh.nr] + (r - sh.nr) * 30; }
    function box(ch) {
      var sh = S().sh, a = ch.anchor, x0 = colPx(sh, a.from.c) + a.from.co / EMU, y0 = rowPx(sh, a.from.r) + a.from.ro / EMU, x1, y1;
      if (a.kind === 'twoCellAnchor' && a.to) { x1 = colPx(sh, a.to.c) + a.to.co / EMU; y1 = rowPx(sh, a.to.r) + a.to.ro / EMU; } else if (a.ext) { x1 = x0 + a.ext.cx / EMU; y1 = y0 + a.ext.cy / EMU; } else { x1 = x0 + 480; y1 = y0 + 300; }
      return { x: x0, y: y0, w: Math.max(40, x1 - x0), h: Math.max(30, y1 - y0) };
    }
    U.reload = function () {
      var s = S(); if (!s || !s.el || !env.roPkg) return; s.charts = null; lastKey = ''; var my = ++loading, name = s.sh.name;
      load2().then(function () { return listCharts(env.roPkg(), name); }).then(function (r) { if (my !== loading || !S()) return; S().charts = r.charts || []; sel = -1; U.paint(true); }).catch(function () { if (my === loading && S()) S().charts = []; });
    };
    U.paint = function (force) {
      var s = S(); if (!s || !s.el || !s.charts) return;
      if (!s.charts.length) { if (s.el.chl) { s.el.chl.innerHTML = ''; } lastKey = ''; return; }
      var live = s.charts.map(function (ch) { return ch.info && ch.info.spec ? liveSpec(ch.info.spec) : null; });
      var key = s.sh.i + '|' + s.scale + '|' + sel + '|' + s.charts.map(function (ch, i) { return live[i] ? dataSig(live[i]) : 'x'; }).join('~');
      if (!force && key === lastKey) return; lastKey = key;
      var host = s.el.chl; if (!host || !host.isConnected) { host = s.el.chl = el('div', 'soc-xl'); s.el.spacer.appendChild(host); }
      host.innerHTML = ''; var k = s.scale, maxR = 0, maxB = 0;
      s.charts.forEach(function (ch, i) {
        var b = box(ch), d = el('div', 'soc-over' + (i === sel ? ' sel' : '')); d.style.left = Math.round(b.x * k) + 'px'; d.style.top = Math.round(b.y * k) + 'px'; d.style.width = Math.round(b.w * k) + 'px'; d.style.height = Math.round(b.h * k) + 'px';
        if (live[i]) d.innerHTML = Ch().svg(live[i], Math.round(b.w * k), Math.round(b.h * k), { bg: true });
        else d.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:12.5px;line-height:1.4;color:#667;text-align:center;padding:6px;box-sizing:border-box;background:#fff">' + (ch.info && ch.info.kind ? '차트(' + ch.info.kind + ') — 모양은 엑셀에서 보입니다' : '차트') + '</div>';
        d.setAttribute('role', 'button'); d.setAttribute('aria-label', (ch.name || '차트') + ' — 누르면 고치기·옮기기');
        d.addEventListener('click', function (e) { e.stopPropagation(); U.tap(i); });
        host.appendChild(d); maxR = Math.max(maxR, (b.x + b.w) * k + 30); maxB = Math.max(maxB, (b.y + b.h) * k + 30);
      });
      var sp = s.el.spacer; if (parseFloat(sp.style.width) < maxR) sp.style.width = Math.round(maxR) + 'px'; if (parseFloat(sp.style.height) < maxB) sp.style.height = Math.round(maxB) + 'px';
    };
    // ---------------- 고른 칸 → 차트 데이터 ----------------
    function regionAround(ws, r, c, nr, nc) {
      function has(rr, cc) { if (rr < 0 || cc < 0 || rr >= nr || cc >= nc) return false; var x = cellAt(ws, rr, cc); return !!(x && x.v != null && x.v !== ''); }
      var r0 = r, r1 = r, c0 = c, c1 = c, grew = true, guard = 0;
      while (grew && guard++ < 400) {
        grew = false; var i;
        for (i = c0; i <= c1; i++) { if (has(r0 - 1, i)) { r0--; grew = true; break; } }
        for (i = c0; i <= c1; i++) { if (has(r1 + 1, i)) { r1++; grew = true; break; } }
        for (i = r0; i <= r1; i++) { if (has(i, c0 - 1)) { c0--; grew = true; break; } }
        for (i = r0; i <= r1; i++) { if (has(i, c1 + 1)) { c1++; grew = true; break; } }
      }
      return { r0: r0, c0: c0, r1: r1, c1: c1 };
    }
    function targetRange() {
      var s = S(), rg = env.selRange(), single = rg.r0 === rg.r1 && rg.c0 === rg.c1;
      if (single) { var ws = wsOf(s.sh.name); if (!ws || !ws['!ref']) return null; var d = X().utils.decode_range(ws['!ref']); var reg = regionAround(ws, rg.r0, rg.c0, d.e.r + 1, d.e.c + 1); var x = cellAt(ws, rg.r0, rg.c0); if (!(x && x.v != null && x.v !== '')) return null; return reg; }
      return rg;
    }
    // o: {hdrRow, hdrCol, swap, auto} → { err } | { cats, series, text, hdrRow, hdrCol }
    function build(rg, o) {
      var s = S(), name = s.sh.name, ws = wsOf(name); if (!ws) return { err: '시트를 읽지 못했습니다.' };
      var nr = rg.r1 - rg.r0 + 1, nc = rg.c1 - rg.c0 + 1;
      function at(i, j) { return o.swap ? cellAt(ws, rg.r0 + j, rg.c0 + i) : cellAt(ws, rg.r0 + i, rg.c0 + j); }      // i = 줄(항목 방향), j = 칸(계열 방향)
      var R = o.swap ? nc : nr, Cn = o.swap ? nr : nc;
      function isStr(x) { return x && x.v != null && x.v !== '' && numOf(x) == null; }
      function isNumCell(x) { return numOf(x) != null && !(x.t === 's'); }
      var hdrRow = o.hdrRow, hdrCol = o.hdrCol, i, j;
      if (o.auto) {
        var ok = Cn >= 1 && R >= 2, anyStr = false; for (j = 0; j < Cn; j++) { var h = at(0, j); if (isNumCell(h)) { ok = false; } if (isStr(h)) anyStr = true; }
        hdrRow = ok && anyStr && (function () { for (var q = 1; q < Math.min(R, 3); q++) for (var w = 0; w < Cn; w++) if (isNumCell(at(q, w))) return true; return false; })();
        var colOk = Cn >= 2 && R >= 1, anyS = false; for (i = hdrRow ? 1 : 0; i < R; i++) { var fc = at(i, 0); if (isNumCell(fc)) colOk = false; if (isStr(fc)) anyS = true; }
        hdrCol = colOk && anyS;
        if (R === 1 && Cn >= 2 && isStr(at(0, 0))) hdrRow = false;
      }
      var i0 = hdrRow ? 1 : 0, j0 = hdrCol ? 1 : 0, nCats = R - i0, nSer = Cn - j0;
      if (nCats < 1 || nSer < 1) return { err: '차트로 만들 숫자 칸이 부족합니다. 항목 이름과 숫자가 함께 있는 칸 범위를 골라 주십시오.' };
      if (nCats > 100 || nSer > 12) return { err: '항목이 100개를 넘거나 계열이 12개를 넘으면 폰에서는 만들지 않습니다. 범위를 줄여 주십시오.' };
      var cats = [], series = [], hasNum = false;
      for (i = i0; i < R; i++) cats.push(hdrCol ? textOf(at(i, 0)) : String(i - i0 + 1));
      function ref(i1, j1, i2, j2) { var a = o.swap ? { r0: rg.r0 + j1, c0: rg.c0 + i1, r1: rg.r0 + j2, c1: rg.c0 + i2 } : { r0: rg.r0 + i1, c0: rg.c0 + j1, r1: rg.r0 + i2, c1: rg.c0 + j2 }; return Ch().absRef(name, a.r0, a.c0, a.r1, a.c1); }
      for (j = j0; j < Cn; j++) {
        var vals = []; for (i = i0; i < R; i++) { var v = numOf(at(i, j)); if (v != null) hasNum = true; vals.push(v); }
        series.push({ name: hdrRow ? (textOf(at(0, j)) || '계열 ' + (j - j0 + 1)) : '계열 ' + (j - j0 + 1), vals: vals, refs: { name: hdrRow ? ref(0, j, 0, j) : null, val: ref(i0, j, R - 1, j), cat: hdrCol ? ref(i0, 0, R - 1, 0) : null } });
      }
      if (!hasNum) return { err: '고른 칸에 숫자가 없습니다. 숫자가 든 칸을 포함해 골라 주십시오.' };
      var a1 = X().utils.encode_cell({ r: rg.r0, c: rg.c0 }), a2 = X().utils.encode_cell({ r: rg.r1, c: rg.c1 });
      return { cats: cats, series: series, text: name + '!' + a1 + ':' + a2, hdrRow: !!hdrRow, hdrCol: !!hdrCol, rg: rg, swap: !!o.swap };
    }
    // ---------------- 한 가지 고침 ----------------
    function fail(r) {
      var msg = (r && r.err) || '할 수 없습니다.', s = S();
      if (s.ctx.fixAvail && s.ctx.fixAvail()) s.ctx.confirm('폰에서는 하기 어렵습니다', msg + '\n\n엑셀로 고쳐야 하는 일이면 「수정 요청」으로 맡길 수 있습니다.', '수정 요청', function () { s.ctx.requestFix(); }, { cancelLabel: '닫기' });
      else toast(msg, 5200);
    }
    function run(label, mut, ok, after) { return env.pkgRun(label, mut, function (r) { if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 3000); if (after) after(r); }, fail); }
    function load2() { var s = S(); return s.ctx.loadScript('js/smartoffice/so-chart.js').then(function () { s.ctx.loadCss('js/smartoffice/so-chart.css'); return Ch(); }); }
    // 새 차트 자리: 데이터 오른쪽(한 칸 띄움). 그 자리에 다른 글이 있으면 쓴 칸 오른쪽 끝 다음으로
    function placeAt(rg) {
      var s = S(), ws = wsOf(s.sh.name), c = rg.c1 + 2, r = rg.r0; if (!ws || !ws['!ref']) return { c: c, r: r };
      var d = X().utils.decode_range(ws['!ref']), busy = false;
      for (var rr = r; rr < r + 15 && !busy; rr++) for (var cc = c; cc < c + 8; cc++) { var x = cellAt(ws, rr, cc); if (x && x.v != null && x.v !== '') { busy = true; break; } }
      return busy ? { c: Math.max(c, d.e.c + 2), r: r } : { c: c, r: r };
    }
    // ---------------- 새 차트 ----------------
    U.create = function () {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var rg = targetRange(); if (!rg) { toast('차트로 만들 칸을 먼저 골라 주십시오. 숫자가 든 칸 하나를 누르거나, 「범위」로 표를 고릅니다.', 4200); return; }
      load2().then(function (C) {
        var b = build(rg, { auto: true }); if (b.err) { toast(b.err, 4800); return; }
        var sp = C.sampleFor('col'); sp.title = ''; sp.legend = b.series.length > 1 ? 'b' : ''; sp.cats = b.cats; sp.series = b.series; sp.frame = true;
        var cur = { rg: rg, hdrRow: b.hdrRow, hdrCol: b.hdrCol, swap: false };
        var R = { text: b.text, opts: { hdrRow: b.hdrRow, hdrCol: b.hdrCol, swap: false }, resolve: function (opt) {
          var r2 = opt.fresh ? targetRange() : cur.rg; if (!r2) return { err: '먼저 시트에서 칸을 골라 주십시오.' };
          if (opt.fresh) { cur.hdrRow = opt.hdrRow; cur.hdrCol = opt.hdrCol; cur.swap = opt.swap; }
          var q = build(r2, { hdrRow: opt.hdrRow, hdrCol: opt.hdrCol, swap: opt.swap }); if (q.err) return q; cur.rg = r2; return q;
        } };
        C.openEditor({ ctx: s.ctx, title: '차트 만들기', spec: sp, mode: 'range', range: R, applyLabel: '차트 넣기',
          note: '고른 칸(' + b.text.replace(/^[^!]*!/, '') + ')으로 만든 그림입니다. 엑셀에서 칸 값을 고치면 차트도 따라 바뀝니다.',
          onApply: function (spec) {
            var at = placeAt(cur.rg), sx = Ch().clone(spec), fin = liveSpec(sx);
            run('차트 만들기', function (pkg) { return addChart(pkg, S().sh.name, fin, at); }, '차트를 넣었습니다(' + Ch().TYPE_NAME[fin.type] + ') — 눌러서 고치기·옮기기', function () { setTimeout(function () { var ss = S(); if (ss && ss.el) { var px = colPx(ss.sh, at.c) * ss.scale - 20, py = rowPx(ss.sh, at.r) * ss.scale - 20; ss.el.sc.scrollLeft = Math.max(0, px); ss.el.sc.scrollTop = Math.max(0, py); } }, 400); });
          } });
      }).catch(function (e) { toast('차트 부품을 불러오지 못했습니다: ' + ((e && e.message) || e), 4200); });
    };
    // ---------------- 있는 차트: 메뉴·고치기·옮기기·지우기 ----------------
    U.tap = function (i) {
      var s = S(); var ch = s.charts && s.charts[i]; if (!ch) return; sel = i; U.paint(true);
      if (!s.editing) { toast('차트입니다. 고치려면 먼저 「고치기」를 켜 주십시오.', 2800); return; }
      var body = el('div', 'sxu'), g = el('div', 'sxu-g');
      function add(t, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), t); b.type = 'button'; b.onclick = function () { s.ctx.closeSheet(); setTimeout(fn, 60); }; g.appendChild(b); }
      add('차트 고치기', function () { U.edit(i); }); add('자리·크기', function () { U.place(i); }); add('차트 지우기', function () { U.del(i); }, 'danger');
      body.appendChild(el('div', 'sxu-l', (ch.name || '차트') + ' — ' + (ch.info && ch.info.spec ? Ch().TYPE_NAME[ch.info.spec.type] : (ch.info && ch.info.kind) || '')));
      body.appendChild(g); body.appendChild(el('div', 'so-sheet-note', ch.info && ch.info.ok ? '차트를 고치면 종류·제목·범례·데이터 범위·색을 바꿀 수 있습니다.' : ch.info.why + ' 자리·크기와 지우기는 할 수 있습니다.'));
      s.ctx.sheet({ title: '차트', body: body, buttons: [{ label: '닫기', onClick: function () { sel = -1; U.paint(true); } }], wide: true, onClose: function () { sel = -1; U.paint(true); } });
    };
    U.edit = function (i) {
      var s = S(), ch = s.charts && s.charts[i]; if (!ch) return;
      if (!ch.info.ok) { fail({ err: ch.info.why }); return; }
      load2().then(function (C) {
        var sp = liveSpec(ch.info.spec), refsOk = sp.series.every(function (q) { var rf = q.refs || {}; return (!rf.val || C.parseRef(rf.val)) && (!rf.cat || C.parseRef(rf.cat)); });
        var cur = { rg: null, hdrRow: true, hdrCol: true, swap: false };
        var R = { text: null, locked: !refsOk, resolve: function (opt) {
          var r2 = targetRange(); if (!r2) return { err: '먼저 시트에서 칸을 골라 주십시오.' }; var q = build(r2, { hdrRow: opt.hdrRow, hdrCol: opt.hdrCol, swap: opt.swap }); if (q.err) return q; return q;
        } };
        function openIt() {
          C.openEditor({ ctx: s.ctx, title: '차트 고치기', spec: sp, mode: 'range', range: R, applyLabel: '적용',
            note: refsOk ? '' : '이 차트의 데이터 범위는 폰에서 바꿀 수 없는 방식이라 그대로 두고, 나머지만 고칩니다.',
            onDelete: function () { setTimeout(function () { U.del(i); }, 60); return true; },
            onApply: function (spec) { var fin = liveSpec(spec); run('차트 고치기', function (pkg) { return updateChart(pkg, S().sh.name, ch.chartPath, fin); }, '차트를 고쳤습니다'); } });
        }
        if (!ch.info.mine) s.ctx.confirm('차트를 고치기 전에', '이 차트는 이 앱에서 만든 것이 아니라서, 고치면 글꼴·그림자 같은 세부 서식이 기본 모양으로 정리될 수 있습니다. 숫자·제목·색·종류와 데이터 범위는 그대로 남습니다. 계속할까요?', '계속', openIt, { cancelLabel: '취소' });
        else openIt();
      }).catch(function (e) { toast('차트를 열지 못했습니다: ' + ((e && e.message) || e), 4200); });
    };
    U.del = function (i) {
      var s = S(), ch = s.charts && s.charts[i]; if (!ch) return;
      s.ctx.confirm('차트를 지울까요?', '이 차트를 지웁니다. 칸의 값은 그대로 남고, 지운 뒤에도 ↶ 로 되돌릴 수 있습니다.', '지우기', function () { run('차트 지우기', function (pkg) { return removeChart(pkg, S().sh.name, ch.chartPath); }, '차트를 지웠습니다(되돌리려면 ↶)'); }, { cancelLabel: '취소' });
    };
    U.place = function (i) {
      var s = S(), ch = s.charts && s.charts[i]; if (!ch) return;
      var body = el('div', 'sxu'), g = el('div', 'sxu-g');
      function mv(t, d) { var b = el('button', 'sxu-b', t); b.type = 'button'; b.onclick = function () { run('차트 자리·크기', function (pkg) { return moveChart(pkg, S().sh.name, ch.chartPath, d); }, null, function () { /* 시트를 열어 둔 채 이어서 */ }); }; g.appendChild(b); }
      mv('← 한 칸', { dc: -1 }); mv('→ 한 칸', { dc: 1 }); mv('↑ 한 칸', { dr: -1 }); mv('↓ 한 칸', { dr: 1 });
      mv('가로 넓게', { dw: 1 }); mv('가로 좁게', { dw: -1 }); mv('세로 길게', { dh: 1 }); mv('세로 짧게', { dh: -1 });
      var here = el('button', 'sxu-b big on', '고른 칸으로 옮기기'); here.type = 'button';
      here.onclick = function () { var r = env.selRange(); run('차트 자리', function (pkg) { return moveChart(pkg, S().sh.name, ch.chartPath, { toC: r.c0, toR: r.r0 }); }, '차트를 ' + env.addr(r.r0, r.c0) + ' 칸 쪽으로 옮겼습니다'); };
      body.appendChild(el('div', 'sxu-l', '자리·크기 — 한 번에 한 칸씩')); body.appendChild(g); body.appendChild(here);
      body.appendChild(el('div', 'so-sheet-note', '「고른 칸으로 옮기기」는 시트에서 칸을 먼저 눌러 둔 뒤 이 시트를 열어 누릅니다. 이 시트는 닫지 않고 이어서 누를 수 있습니다.'));
      s.ctx.sheet({ title: '차트 자리·크기', body: body, buttons: [{ label: '닫기' }], wide: true });
    };
    // 도구줄 「차트」: 새 차트 + 이 시트의 차트 목록
    U.menu = function () {
      var s = S(), body = el('div', 'sxu'), g = el('div', 'sxu-g'), list = s.charts || [];
      function add(t, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), t); b.type = 'button'; b.onclick = function () { s.ctx.closeSheet(); setTimeout(fn, 60); }; g.appendChild(b); }
      var rg = null; try { rg = targetRange(); } catch (e) {}
      add('고른 칸으로 새 차트 만들기', U.create, 'on');
      list.forEach(function (ch, i) { add((ch.name || '차트 ' + (i + 1)) + ' — ' + (ch.info && ch.info.spec ? Ch().TYPE_NAME[ch.info.spec.type] : '고칠 수 없는 차트'), function () { U.tap(i); }); });
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', (rg ? '지금 고른 곳: ' + env.addr(rg.r0, rg.c0) + (rg.r0 === rg.r1 && rg.c0 === rg.c1 ? '' : ':' + env.addr(rg.r1, rg.c1)) + '. ' : '') + '표의 칸 하나를 누르거나 「범위」로 표를 고른 뒤 「새 차트 만들기」를 누릅니다. 차트는 시트 위의 그림을 눌러도 고칠 수 있습니다.'));
      s.ctx.sheet({ title: '차트', body: body, buttons: [{ label: '닫기' }], wide: true });
    };
    return U;
  }
  global.SOXlsxChart = { create: create, listCharts: listCharts, addChart: addChart, updateChart: updateChart, removeChart: removeChart, moveChart: moveChart };
})(window);
