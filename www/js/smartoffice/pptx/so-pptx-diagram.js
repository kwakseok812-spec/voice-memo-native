/* so-pptx-diagram.js — S-Office 파워포인트 「도식」 만들기(스마트아트 모양의 묶은 도형) (O-0861, v10.9 3회차)
 * ----------------------------------------------------------------------------
 * 진짜 SmartArt 는 만들지 않는다: SmartArt 는 종류마다 마이크로소프트가 만든 배치 정의 파일(layoutDef 수백 줄)이 있어야 하고,
 * 그 파일은 이 앱에 넣을 수도(재배포), 직접 쓸 수도(파워포인트가 열 때 검증) 없다. 대신 같은 모양을 파워포인트의 「그룹으로 묶은 일반 도형」으로 그린다.
 *   · 파워포인트에서 그룹 안의 도형을 눌러 글·색·크기를 마음대로 고칠 수 있고, 테마 색(accent)을 따라 색 조합을 바꾸면 같이 바뀐다.
 *   · 이 앱에서는 「도식 고치기」로 종류·항목 글을 바꿔 다시 그린다(그룹의 설명(descr)에 종류·색 방식을 적어 두어 다시 알아본다).
 * 종류 8가지: 가로 목록 · 세로 목록 · 기본 프로세스 · 화살표 프로세스 · 주기 · 계층 구조 · 피라미드 · 벤 다이어그램.
 * 새 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var ST = global.SOPptxStruct; if (!ST || !ST._h) return;
  var H = ST._h, escX = H.escX, findShape = H.findShape, maxId = H.maxId, insertShape = H.insertShape, shapeId = H.shapeId;

  var KINDS = {
    listh:   { name: '가로 목록', min: 2, max: 8, hint: '항목이 나란히 놓입니다' },
    listv:   { name: '세로 목록', min: 2, max: 8, hint: '항목이 위에서 아래로 쌓입니다' },
    process: { name: '기본 프로세스', min: 2, max: 6, hint: '항목 사이에 화살표가 놓입니다' },
    chevron: { name: '화살표 프로세스', min: 2, max: 6, hint: '이어지는 화살표 모양 단계' },
    cycle:   { name: '주기', min: 3, max: 8, hint: '항목이 원을 따라 돌고 화살표로 이어집니다' },
    tree:    { name: '계층 구조', min: 2, max: 9, hint: '첫 항목이 위(상위), 나머지가 아래 줄에 놓입니다' },
    pyramid: { name: '피라미드', min: 2, max: 6, hint: '첫 항목이 맨 위(좁은 곳)입니다' },
    venn:    { name: '벤 다이어그램', min: 2, max: 4, hint: '겹치는 동그라미' }
  };
  var KEYS = Object.keys(KINDS);
  var TAG = 'S-Office 도식';
  function R(v) { return Math.round(v); }
  function clamp(a, lo, hi) { return Math.max(lo, Math.min(hi, a)); }

  // 글꼴 크기(pt): 상자 크기와 글 길이로 어림
  function fit(text, wEmu, hEmu, lo, hi) {
    var wpt = wEmu / 12700, hpt = hEmu / 12700, len = Math.max(4, String(text || '').length);
    return clamp(Math.sqrt(wpt * hpt * 0.34 / len), lo || 10, hi || 28);
  }
  function fillXml(color, alpha) {
    if (!color) return '<a:noFill/>';
    var base = /^[0-9A-F]{6}$/i.test(color) ? '<a:srgbClr val="' + color + '"' : '<a:schemeClr val="' + color + '"';
    return '<a:solidFill>' + base + (alpha ? '><a:alpha val="' + alpha + '"/></' + (base.indexOf('srgb') > 0 ? 'a:srgbClr' : 'a:schemeClr') + '>' : '/>') + '</a:solidFill>';
  }
  // 도형 하나. o: { prst, adj:{name:val}, color, alpha, txt, sz, txtColor, ins:[l,t,r,b](EMU), name, anchor }
  function shp(id, name, x, y, w, h, o) {
    var av = '<a:avLst>' + Object.keys(o.adj || {}).map(function (k) { return '<a:gd name="' + k + '" fmla="val ' + R(o.adj[k]) + '"/>'; }).join('') + '</a:avLst>';
    var ins = o.ins || [91440, 45720, 91440, 45720];
    var sz = R((o.sz || fit(o.txt, w, h)) * 100), tc = o.txtColor || 'bg1';
    var body = '<p:txBody><a:bodyPr wrap="square" lIns="' + R(ins[0]) + '" tIns="' + R(ins[1]) + '" rIns="' + R(ins[2]) + '" bIns="' + R(ins[3]) + '" rtlCol="0" anchor="' + (o.anchor || 'ctr') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/>' +
      (o.txt ? '<a:r><a:rPr lang="ko-KR" altLang="en-US" sz="' + sz + '" dirty="0">' + fillXml(tc) + '</a:rPr><a:t>' + escX(o.txt) + '</a:t></a:r>' : '<a:endParaRPr lang="ko-KR" altLang="en-US" sz="' + sz + '" dirty="0"/>') + '</a:p></p:txBody>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + escX(name) + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + R(x) + '" y="' + R(y) + '"/><a:ext cx="' + Math.max(1, R(w)) + '" cy="' + Math.max(1, R(h)) + '"/></a:xfrm><a:prstGeom prst="' + o.prst + '">' + av + '</a:prstGeom>' +
      fillXml(o.color, o.alpha) + '<a:ln w="12700">' + (o.line ? fillXml(o.line) : '<a:noFill/>') + '</a:ln></p:spPr>' + body + '</p:sp>';
  }
  function line(id, name, x1, y1, x2, y2, arrow) {
    var x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1), fl = (x2 < x1 ? ' flipH="1"' : '') + (y2 < y1 ? ' flipV="1"' : '');
    return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + escX(name) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm' + fl + '><a:off x="' + R(x) + '" y="' + R(y) + '"/><a:ext cx="' + R(w) + '" cy="' + R(h) + '"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill>' + (arrow ? '<a:tailEnd type="triangle" w="med" len="med"/>' : '') + '</a:ln></p:spPr></p:cxnSp>';
  }
  function colorOf(spec, i) { return spec.palette === 'multi' ? 'accent' + ((i % 6) + 1) : 'accent1'; }

  // 종류별 배치 → 자식 도형 XML 문자열 목록(ids 는 nextId 부터)
  function layout(spec, g) {
    var items = spec.items, n = items.length, x0 = g.x, y0 = g.y, W = g.w, Hh = g.h, id = spec._id, out = [];
    function nid() { return id++; }
    var k = spec.kind, i;
    if (k === 'listh') {
      var gap = W * 0.03, bw = (W - gap * (n - 1)) / n, bh = Math.min(Hh, Math.max(bw * 0.9, Hh * 0.4));
      for (i = 0; i < n; i++) out.push(shp(nid(), '항목 ' + (i + 1), x0 + i * (bw + gap), y0 + (Hh - bh) / 2, bw, bh, { prst: 'roundRect', adj: { adj: 12000 }, color: colorOf(spec, i), txt: items[i] }));
    } else if (k === 'listv') {
      var gv = Hh * 0.04, bhv = Math.min(Hh * 0.28, (Hh - gv * (n - 1)) / n), tot = bhv * n + gv * (n - 1), yy = y0 + (Hh - tot) / 2;
      for (i = 0; i < n; i++) out.push(shp(nid(), '항목 ' + (i + 1), x0, yy + i * (bhv + gv), W, bhv, { prst: 'roundRect', adj: { adj: 16000 }, color: colorOf(spec, i), txt: items[i] }));
    } else if (k === 'process') {
      var gw = 0.42, bwp = W / (n + gw * (n - 1)), gp = bwp * gw, bhp = Math.min(Hh, Math.max(bwp * 0.85, Hh * 0.35)), yp = y0 + (Hh - bhp) / 2;
      for (i = 0; i < n; i++) {
        out.push(shp(nid(), '항목 ' + (i + 1), x0 + i * (bwp + gp), yp, bwp, bhp, { prst: 'roundRect', adj: { adj: 12000 }, color: colorOf(spec, i), txt: items[i] }));
        if (i < n - 1) out.push(shp(nid(), '화살표 ' + (i + 1), x0 + i * (bwp + gp) + bwp + gp * 0.1, yp + bhp / 2 - Math.min(bhp * 0.18, gp * 0.4), gp * 0.8, Math.min(bhp * 0.36, gp * 0.8), { prst: 'rightArrow', color: '7F7F7F', txt: '' }));
      }
    } else if (k === 'chevron') {
      var ch = Math.min(Hh * 0.6, W / n * 0.75), d = ch * 0.5, gc = ch * 0.04, cw = (W + (n - 1) * (d - gc)) / n, yc = y0 + (Hh - ch) / 2;
      for (i = 0; i < n; i++) out.push(shp(nid(), '항목 ' + (i + 1), x0 + i * (cw - d + gc), yc, cw, ch, { prst: i === 0 ? 'homePlate' : 'chevron', adj: { adj: 50000 }, color: colorOf(spec, i), txt: items[i] }));
    } else if (k === 'cycle') {
      var ns = Math.min(W, Hh) * (n <= 4 ? 0.3 : n <= 6 ? 0.25 : 0.21), a = ns * 0.65, b = ns * 0.5, cx = x0 + W / 2, cy = y0 + Hh / 2, rx = W / 2 - a - ns * 0.1, ry = Hh / 2 - b - ns * 0.1, rr = Math.min(rx, ry), cs = [];
      for (i = 0; i < n; i++) { var t = -Math.PI / 2 + i * 2 * Math.PI / n; cs.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) }); }
      for (i = 0; i < n; i++) out.push(shp(nid(), '항목 ' + (i + 1), cs[i].x - a, cs[i].y - b, a * 2, b * 2, { prst: 'ellipse', color: colorOf(spec, i), txt: items[i], ins: [45720, 22860, 45720, 22860] }));
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n, dx = cs[j].x - cs[i].x, dy = cs[j].y - cs[i].y, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
        function rad(ux_, uy_) { return 1 / Math.sqrt((ux_ * ux_) / (a * a) + (uy_ * uy_) / (b * b)); }
        var r1 = rad(ux, uy) + ns * 0.06, r2 = rad(ux, uy) + ns * 0.1;
        if (L > r1 + r2 + ns * 0.1) out.push(line(nid(), '연결 ' + (i + 1), cs[i].x + ux * r1, cs[i].y + uy * r1, cs[j].x - ux * r2, cs[j].y - uy * r2, true));
      }
    } else if (k === 'tree') {
      var m = n - 1, rw = Math.min(W * 0.4, W * 0.9), rh = Hh * 0.2, rootX = x0 + (W - rw) / 2;
      var perRow = Math.min(m, 5), rows = Math.ceil(m / perRow), gcx = W * 0.025, cw2 = Math.min(W * 0.3, (W - gcx * (perRow - 1)) / perRow), chh = Math.min(Hh * 0.2, (Hh * 0.55 - (rows - 1) * Hh * 0.05) / rows), midY = y0 + rh + Hh * 0.1, y1 = y0 + Hh * 0.45;
      out.push(shp(nid(), '항목 1', rootX, y0, rw, rh, { prst: 'roundRect', adj: { adj: 12000 }, color: colorOf(spec, 0), txt: items[0] }));
      var kids = [], kidX = [];
      for (i = 0; i < m; i++) {
        var row = Math.floor(i / perRow), col = i % perRow, cntRow = Math.min(perRow, m - row * perRow), rowW = cw2 * cntRow + gcx * (cntRow - 1), sx = x0 + (W - rowW) / 2 + col * (cw2 + gcx), sy = y1 + row * (chh + Hh * 0.05);
        kids.push(shp(nid(), '항목 ' + (i + 2), sx, sy, cw2, chh, { prst: 'roundRect', adj: { adj: 12000 }, color: colorOf(spec, spec.palette === 'multi' ? i + 1 : 1), txt: items[i + 1] }));
        if (row === 0) kidX.push(sx + cw2 / 2);
      }
      if (m > 0) {
        var rcx = x0 + W / 2, rbot = y0 + rh;
        out.push(line(nid(), '연결 1', rcx, rbot, rcx, midY, false));
        if (kidX.length > 1) out.push(line(nid(), '연결 2', kidX[0], midY, kidX[kidX.length - 1], midY, false));
        kidX.forEach(function (kx, q) { out.push(line(nid(), '연결 ' + (q + 3), kx, midY, kx, y1, false)); });
        // 둘째 줄 이하 항목은 윗줄 항목 바로 아래 줄에 있으므로 짧은 세로선으로 잇는다
        for (i = perRow; i < m; i++) { var rw2 = Math.floor(i / perRow), c2 = i % perRow, cnt2 = Math.min(perRow, m - rw2 * perRow), rowW2 = cw2 * cnt2 + gcx * (cnt2 - 1), kx2 = x0 + (W - rowW2) / 2 + c2 * (cw2 + gcx) + cw2 / 2, topY = y1 + (rw2 - 1) * (chh + Hh * 0.05) + chh; out.push(line(nid(), '연결 ' + (i + 3), kx2, topY, kx2, y1 + rw2 * (chh + Hh * 0.05), false)); }
      }
      out = out.slice(0, 1).concat(kids, out.slice(1));
    } else if (k === 'pyramid') {
      var ph = Hh, pw = Math.min(W, Hh * 1.6), px = x0 + (W - pw) / 2, lh = ph / n;
      for (i = 0; i < n; i++) {
        var topW = pw * (i * lh) / ph, botW = pw * ((i + 1) * lh) / ph, xx = x0 + (W - botW) / 2, yy2 = y0 + i * lh;
        if (i === 0) out.push(shp(nid(), '항목 1', xx, yy2, botW, lh, { prst: 'triangle', color: colorOf(spec, 0), txt: items[0], anchor: 'b', ins: [0, 0, 0, 20000], sz: fit(items[0], botW * 0.5, lh * 0.5, 9, 22) }));
        else { var inset = (botW - topW) / 2, ss = Math.min(botW, lh), adj = ss ? clamp(inset / ss * 100000, 0, 50000 * botW / ss) : 0; out.push(shp(nid(), '항목 ' + (i + 1), xx, yy2, botW, lh, { prst: 'trapezoid', adj: { adj: adj }, color: colorOf(spec, i), txt: items[i], ins: [inset, 20000, inset, 20000], sz: fit(items[i], (topW + botW) / 2, lh, 9, 22) })); }
      }
    } else if (k === 'venn') {
      var dd = Math.min(Hh, W / (n === 2 ? 1.5 : 1.25)) * (n === 2 ? 1 : n === 3 ? 0.62 : 0.56), cxv = x0 + W / 2, cyv = y0 + Hh / 2, pos = [];
      if (n === 2) { var o2 = dd * 0.32; pos = [[-o2, 0, -1, 0], [o2, 0, 1, 0]]; dd = Math.min(Hh, W / 1.64) * 1.0; }
      else if (n === 3) { var o3 = dd * 0.3; pos = [[0, -o3, 0, -1], [-o3 * 1.05, o3 * 0.7, -1, 0.5], [o3 * 1.05, o3 * 0.7, 1, 0.5]]; dd = Math.min(Hh / 1.5, W / 1.6); }
      else { var o4 = dd * 0.3; pos = [[-o4, 0, -1, 0], [o4, 0, 1, 0], [0, -o4, 0, -1], [0, o4, 0, 1]]; dd = Math.min(Hh / 1.55, W / 1.55); }
      for (i = 0; i < n; i++) {
        var p = pos[i], kk = dd * 0.34;
        // 겹치는 가운데 쪽(= 바깥 방향의 반대쪽)을 비워 글이 바깥쪽에 놓이게 한다
        var ins = [Math.max(0, p[2]) * kk * 1.2, Math.max(0, p[3]) * kk * 1.2, Math.max(0, -p[2]) * kk * 1.2, Math.max(0, -p[3]) * kk * 1.2];
        out.push(shp(nid(), '항목 ' + (i + 1), cxv + p[0] - dd / 2, cyv + p[1] - dd / 2, dd, dd, { prst: 'ellipse', color: colorOf(spec, i), alpha: 55000, txt: items[i], txtColor: 'tx1', ins: ins, sz: fit(items[i], dd * 0.5, dd * 0.4, 10, 22) }));
      }
    }
    return out;
  }

  function normSpec(spec) {
    var K = KINDS[spec.kind]; if (!K) return { err: '모르는 도식 종류입니다.' };
    var items = (spec.items || []).map(function (t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 60); });
    while (items.length > K.min && !items[items.length - 1]) items.pop();           // 끝의 빈 항목은 버린다(최소 개수까지)
    items = items.map(function (t, i) { return t || (i + 1) + '번 항목'; });
    if (items.length < K.min) return { err: '「' + K.name + '」은 항목이 ' + K.min + '개 이상 필요합니다.' };
    if (items.length > K.max) return { err: '「' + K.name + '」은 항목이 ' + K.max + '개까지입니다.' };
    return { spec: { kind: spec.kind, palette: spec.palette === 'one' ? 'one' : 'multi', items: items } };
  }
  function groupXml(id, spec, g, kids) {
    var name = KINDS[spec.kind].name + ' 도식';
    return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + id + '" name="' + escX(name) + '" descr="' + TAG + ':' + spec.kind + ':' + spec.palette + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="' + R(g.x) + '" y="' + R(g.y) + '"/><a:ext cx="' + R(g.w) + '" cy="' + R(g.h) + '"/><a:chOff x="' + R(g.x) + '" y="' + R(g.y) + '"/><a:chExt cx="' + R(g.w) + '" cy="' + R(g.h) + '"/></a:xfrm></p:grpSpPr>' + kids.join('') + '</p:grpSp>';
  }
  function build(xml, spec, g, groupId) {
    var nz = normSpec(spec); if (nz.err) return nz;
    var sp = nz.spec, gid = groupId || maxId(xml) + 1, start = Math.max(maxId(xml), gid) + 1;
    var kids = layout({ kind: sp.kind, palette: sp.palette, items: sp.items, _id: start }, g);
    return { xml: groupXml(gid, sp, g, kids), id: gid };
  }
  function addDiagram(xml, spec, g) {
    var r = build(xml, spec, g); if (r.err) return r;
    return { xml: insertShape(xml, r.xml), id: r.id };
  }
  // 이 앱이 만든 도식인지 읽기 → { kind, palette, items } | null
  function readDiagram(xml, id) {
    var sh = findShape(xml, id); if (!sh || sh.name !== 'p:grpSp') return null;
    var m = new RegExp('descr="' + TAG + ':(\\w+):(\\w+)"').exec(sh.xml.slice(0, 600)); if (!m || !KINDS[m[1]]) return null;
    var items = [], re = /<p:sp>[\s\S]*?<\/p:sp>/g, q;
    while ((q = re.exec(sh.xml))) { if (!/name="항목 \d+"/.test(q[0])) continue; var t = ''; (q[0].match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || []).forEach(function (a) { t += H.unescX(a.replace(/<[^>]+>/g, '')); }); items.push(t); }
    return { kind: m[1], palette: m[2], items: items };
  }
  function groupGeom(xml, id) { var sh = findShape(xml, id); return sh ? H.xfOf(sh.xml, sh.name) : null; }
  // 도식 다시 그리기(종류·항목·색 방식을 바꿔서). 같은 자리·같은 번호(움직임 효과 연결 유지)
  function replaceDiagram(xml, id, spec) {
    var sh = findShape(xml, id); if (!sh) return { err: '도식을 찾지 못했습니다.' };
    var g = H.xfOf(sh.xml, sh.name); if (!g) return { err: '도식의 위치를 읽지 못했습니다.' };
    var without = xml.slice(0, sh.s) + xml.slice(sh.e), r = build(without, spec, g, id); if (r.err) return r;
    return { xml: xml.slice(0, sh.s) + r.xml + xml.slice(sh.e), id: id };
  }
  function defaultItems(kind) {
    var K = KINDS[kind], base = { listh: ['첫째', '둘째', '셋째'], listv: ['첫째', '둘째', '셋째'], process: ['계획', '실행', '평가'], chevron: ['준비', '진행', '마무리'], cycle: ['계획', '실행', '점검', '개선'], tree: ['대표', '팀 1', '팀 2', '팀 3'], pyramid: ['목표', '전략', '실행'], venn: ['A', 'B', 'C'] };
    return (base[kind] || ['첫째', '둘째', '셋째']).slice(0, K.max);
  }

  ST.DIAGRAM_KINDS = KINDS; ST.DIAGRAM_KEYS = KEYS; ST.addDiagram = addDiagram; ST.readDiagram = readDiagram; ST.replaceDiagram = replaceDiagram; ST.diagramDefaults = defaultItems; ST.diagramGeom = groupGeom;
})(typeof window !== 'undefined' ? window : globalThis);
