/* so-xlsx.js — S-Office 엑셀 모듈 (xlsx · xls · csv 보기, 간단한 값 고치기)
 * 출처·라이선스: 표 읽기·쓰기는 SheetJS Community Edition 0.18.5 (Apache-2.0, https://sheetjs.com, 앱 vendor/xlsx.full.min.js).
 * 화면(가상 스크롤 격자·입력줄·시트 탭)은 이 앱을 위해 새로 짠 것이며, 오픈소스(Apache-2.0) 엑셀 편집 부품은
 * 구조 참고만 했고 코드를 가져오지 않았다. AI 기능 없음, 새 권한 없음.
 * 저장 방식(xlsx): SheetJS 로 다시 쓰지 않는다. 원본 zip 을 JSZip(MIT)으로 열어 고친 셀만 해당 시트 XML 에 끼워 넣고(so-xlsx-patch.js),
 * 나머지 파일(서식·차트·그림·정의된 이름·조건부 서식)은 그대로 둔다. 피벗표·매크로가 있거나 보호·특수 구조인 파일/시트/칸은 고치기를 막는다.
 * 옛 xls 는 보기만, csv 는 예전 방식(글자 그대로 사본 저장).
 * v10.4(O-0861) 스위치 SO_XLSX_TOOLS: 줄·칸 넣고 빼기, 칸 서식, 칸 합치기, 줄 높이·칸 너비, 시트 추가·이름·삭제·순서, 찾아 바꾸기, 채우기, 정렬, 합계 바로 보이기(자체 계산기), 새 엑셀 문서.
 *   구조 편집은 so-xlsx-struct.js(XML 직접 편집), 계산은 so-xlsx-calc.js, 단추·시트는 so-xlsx-ui.js. 고친 뒤에는 만든 파일을 다시 읽어 화면을 갈아 끼운다(화면과 저장 파일이 늘 같은 내용).
 */
(function (global) {
  'use strict';
  var DEF_W = 84, DEF_H = 30, HDR_W = 40, HDR_H = 30, LONGPRESS_MS = 550, MAX_R = 1048576, MAX_C = 16384, MAX_BYTES = 40 * 1024 * 1024;
  var S = null;   // 열려 있는 문서 상태
  var raf = 0;

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function hdrPref() { try { return localStorage.getItem('so_xlsx_hdr') !== '0'; } catch (e) { return true; } }
  function colName(c) { var s = ''; c++; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
  function addr(r, c) { return colName(c) + (r + 1); }
  function lowerIdx(arr, y) { var lo = 0, hi = arr.length - 2; if (hi < 0) return 0; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (arr[m] <= y) lo = m; else hi = m - 1; } return lo; }

  // ---------------- 파일 읽기 ----------------
  function readWorkbook(ctx, buf) {
    var XLSX = global.XLSX, ext = ctx.ext;
    if (ext === 'csv') {
      var bytes = new Uint8Array(buf), text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (e) { try { text = new TextDecoder('euc-kr').decode(bytes); } catch (e2) { text = new TextDecoder('utf-8').decode(bytes); } }
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      // raw:true = 글자를 숫자로 바꾸지 않는다(00123 이 123 이 되는 것을 막는다)
      return { wb: XLSX.read(text, { type: 'string', raw: true }) };
    }
    return { wb: XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: true, cellNF: true }) };
  }
  function lossReason(ext) {
    if (ext === 'xls') return '옛 엑셀 파일(xls)은 보기만 할 수 있습니다. 고치면 차트·그림이 사라질 수 있어서 막아 뒀습니다.';
    return '';
  }

  // ---------------- 시트 준비 ----------------
  function prepSheet(i) {
    var XLSX = global.XLSX, name = S.names[i], ws = S.wb.Sheets[name];
    if (!ws) ws = S.wb.Sheets[name] = {};
    var nr = 0, nc = 0;
    if (ws['!ref']) { var rg = XLSX.utils.decode_range(ws['!ref']); nr = rg.e.r + 1; nc = rg.e.c + 1; }
    var merges = (ws['!merges'] || []).slice(0, 20000);
    merges.forEach(function (m) { if (m.e.r + 1 > nr) nr = m.e.r + 1; if (m.e.c + 1 > nc) nc = m.e.c + 1; });
    nr = Math.min(Math.max(nr, 30), MAX_R); nc = Math.min(Math.max(nc, 12), MAX_C);
    var cols = ws['!cols'] || [], rows = ws['!rows'] || [];
    var colX = new Float64Array(nc + 1), rowY = new Float64Array(nr + 1), k;
    for (k = 0; k < nc; k++) {
      var ci = cols[k], w = DEF_W;
      if (ci) { if (ci.hidden) w = 0; else if (ci.wpx) w = ci.wpx; else if (ci.wch) w = ci.wch * 7 + 5; else if (ci.width) w = ci.width * 7 + 5; }
      colX[k + 1] = colX[k] + Math.max(0, Math.round(w));
    }
    for (k = 0; k < nr; k++) {
      var ri = rows[k], h = DEF_H;
      if (ri) { if (ri.hidden) h = 0; else if (ri.hpx) h = ri.hpx; else if (ri.hpt) h = ri.hpt * 4 / 3; }
      if (h > 0) h = Math.max(h, 22);
      rowY[k + 1] = rowY[k] + Math.round(h);
    }
    var usedR = 0, usedC = 0; if (ws['!ref']) { var ur = XLSX.utils.decode_range(ws['!ref']); usedR = ur.e.r + 1; usedC = ur.e.c + 1; }
    return { i: i, name: name, ws: ws, nr: nr, nc: nc, colX: colX, rowY: rowY, merges: merges, usedR: usedR, usedC: usedC };
  }
  function visibleSheets(wb) {
    var meta = (wb.Workbook && wb.Workbook.Sheets) || [], out = [];
    wb.SheetNames.forEach(function (n, i) { var h = meta[i] && meta[i].Hidden; if (!h) out.push(i); });
    return out.length ? out : [0];
  }

  // ---------------- 셀 표시 ----------------
  function cellOf(sh, r, c) { return sh.ws[addr(r, c)]; }
  function display(cell) {
    if (!cell) return '';
    if (cell.t === 'z' && cell.f) return '';
    if (cell.w != null) return String(cell.w);
    if (cell.v == null) return '';
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    try { return global.XLSX.utils.format_cell(cell); } catch (e) { return String(cell.v); }
  }
  function fillOf(cell) {
    var s = cell && cell.s;
    if (s && s.patternType === 'solid' && s.fgColor && /^[0-9A-Fa-f]{6}$/.test(s.fgColor.rgb || '')) return '#' + s.fgColor.rgb;
    return '';
  }
  function barText(cell) {
    if (!cell) return '';
    if (cell.f) return '=' + cell.f;
    if (cell.t === 'n' && cell.z && global.XLSX.SSF.is_date(cell.z) && cell.w) return String(cell.w);
    if (cell.v == null) return '';
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    return String(cell.v);
  }
  function mergeAt(sh, r, c) {
    for (var i = 0; i < sh.merges.length; i++) { var m = sh.merges[i]; if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return m; }
    return null;
  }

  // ---------------- 그리기 ----------------
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (S) render(); }); }

  function fltOf(sh) {                       // 이 시트에 걸린 자동 필터(머리줄 ▽ 표시용). 시트 글이 바뀔 때만 다시 읽는다
    var xml = S.an && S.an.sheets && S.an.sheets[sh.name] && S.an.sheets[sh.name].xml;
    if (!xml || !global.SOXlsxStruct || !global.SOXlsxStruct.readFilter) return null;
    if (sh._fx !== xml) { sh._fx = xml; try { sh._fl = global.SOXlsxStruct.readFilter(xml); } catch (e) { sh._fl = null; } }
    return sh._fl;
  }
  function cellDiv(sh, r, c, x, y, w, h, extraCls, lh) {
    var cell = cellOf(sh, r, c), txt = display(cell);
    var sel = (S.sel.r === r && S.sel.c === c) ? ' sel' : '';
    var ed = S.edits[sh.i + '|' + r + '|' + c] ? ' ed' : '';
    var st = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;line-height:' + (lh - 1) + 'px;font-size:' + Math.round(14 * S.scale * 10) / 10 + 'px;';
    if (cell && cell.t === 'n') st += 'text-align:right;'; else if (cell && (cell.t === 'b' || cell.t === 'e')) st += 'text-align:center;';
    var fill = fillOf(cell); if (fill) st += 'background-color:' + fill + ';color:#111;';
    var sty = styleAt(sh, r, c);
    if (sty) {
      if (sty.fs) st += 'font-size:' + Math.round(sty.fs * 4 / 3 * S.scale * 10) / 10 + 'px;'; if (sty.fn) st += 'font-family:"' + String(sty.fn).replace(/["\\]/g, '') + '",sans-serif;'; if (sty.b) st += 'font-weight:800;'; if (sty.i) st += 'font-style:italic;'; if (sty.u || sty.st) st += 'text-decoration:' + (sty.u ? 'underline' : '') + (sty.u && sty.st ? ' ' : '') + (sty.st ? 'line-through' : '') + ';';
      if (sty.bg) st += 'background-color:' + sty.bg + ';color:' + (sty.color || '#111') + ';'; else if (sty.color) st += 'color:' + sty.color + ';';
      if (sty.h) st += 'text-align:' + sty.h + ';'; if (sty.wrap) st += 'white-space:pre-wrap;line-height:1.25;';
      if (sty.bl) st += 'border-left:1px solid #222;'; if (sty.br) st += 'border-right:1px solid #222;'; if (sty.bt) st += 'border-top:1px solid #222;'; if (sty.bb) st += 'border-bottom:1px solid #222;';
    }
    var rgc = (S.rg && r >= S.rg.r0 && r <= S.rg.r1 && c >= S.rg.c0 && c <= S.rg.c1) ? ' rg' : '';
    var fl = fltOf(sh), fmk = '';
    if (fl && r === fl.ref.r0 - 1 && c >= fl.ref.c0 - 1 && c <= fl.ref.c1 - 1) { var fk = c - (fl.ref.c0 - 1), fon = fl.criteria[fk] !== undefined; fmk = '<span class="sx-fv' + (fon ? ' on' : '') + '" data-fc="' + fk + '" aria-label="' + (fon ? '필터가 걸린 열' : '필터') + '">' + (fon ? '▼' : '▽') + '</span>'; }
    return '<div class="sx-c' + (extraCls || '') + sel + rgc + ed + (fmk ? ' sx-fh' : '') + '" style="' + st + '">' + (txt ? esc(txt) : '') + fmk + '</div>';
  }
  // 한 구역(rows r0..r1, cols c0..c1)을 HTML 로. ox,oy = 구역 원점 좌표(스크롤 보정)
  function cellsHTML(sh, r0, r1, c0, c1, ox, oy) {
    var s = S.scale, out = [], skip = {}, r, c, i, m, near = [];
    for (i = 0; i < sh.merges.length; i++) {
      m = sh.merges[i];
      if (m.e.r < r0 || m.s.r > r1 || m.e.c < c0 || m.s.c > c1) continue;
      near.push(m);
      var rr0 = Math.max(m.s.r, r0), rr1 = Math.min(m.e.r, r1), cc0 = Math.max(m.s.c, c0), cc1 = Math.min(m.e.c, c1);
      for (r = rr0; r <= rr1; r++) for (c = cc0; c <= cc1; c++) skip[r * MAX_C + c] = 1;
    }
    for (r = r0; r <= r1; r++) {
      var h = (sh.rowY[r + 1] - sh.rowY[r]) * s; if (h <= 0) continue;
      var y = sh.rowY[r] * s - oy;
      for (c = c0; c <= c1; c++) {
        if (skip[r * MAX_C + c]) continue;
        var w = (sh.colX[c + 1] - sh.colX[c]) * s; if (w <= 0) continue;
        out.push(cellDiv(sh, r, c, sh.colX[c] * s - ox, y, w, h, '', h));
      }
    }
    near.forEach(function (mm) {
      var x = sh.colX[mm.s.c] * s - ox, y = sh.rowY[mm.s.r] * s - oy;
      var w = (sh.colX[Math.min(mm.e.c + 1, sh.nc)] - sh.colX[mm.s.c]) * s, h = (sh.rowY[Math.min(mm.e.r + 1, sh.nr)] - sh.rowY[mm.s.r]) * s;
      if (w <= 0 || h <= 0) return;
      out.push(cellDiv(sh, mm.s.r, mm.s.c, x, y, w, h, ' m', (sh.rowY[mm.s.r + 1] - sh.rowY[mm.s.r]) * s));
    });
    return out.join('');
  }
  function render(force) {
    var sh = S.sh, el = S.el, s = S.scale, HDR_W = S.hw, HDR_H = S.hh;
    var sc = el.sc, st = sc.scrollTop, sl = sc.scrollLeft, vh = sc.clientHeight, vw = sc.clientWidth;
    var r0 = Math.max(0, lowerIdx(sh.rowY, st / s) - 8), r1 = Math.min(sh.nr - 1, lowerIdx(sh.rowY, (st + vh) / s) + 8);
    var c0 = Math.max(0, lowerIdx(sh.colX, sl / s) - 2), c1 = Math.min(sh.nc - 1, lowerIdx(sh.colX, (sl + vw) / s) + 2);
    // 눈에 보이는 범위가 그대로면 칸을 다시 그리지 않는다(큰 표를 훑을 때 버벅임을 줄임)
    var lkey = r0 + '|' + r1 + '|' + c0 + '|' + c1 + '|' + s + '|' + S.sh.i;
    if (force || lkey !== S.lk) { el.layer.innerHTML = cellsHTML(sh, r0, r1, c0, c1, 0, 0); S.lk = lkey; }
    var i, hs = [];
    for (i = c0; i <= c1; i++) {
      var w = (sh.colX[i + 1] - sh.colX[i]) * s; if (w <= 0) continue;
      hs.push('<div class="sx-h' + (S.sel.c === i ? ' sel' : '') + '" style="left:' + (sh.colX[i] * s - sl) + 'px;top:0;width:' + w + 'px;height:' + HDR_H + 'px;line-height:' + (HDR_H - 1) + 'px">' + colName(i) + '</div>');
    }
    if (HDR_H && S.frz.col && (sh.colX[1] - sh.colX[0]) > 0) hs.push('<div class="sx-h fz' + (S.sel.c === 0 ? ' sel' : '') + '" style="left:0;top:0;width:' + (sh.colX[1] - sh.colX[0]) * s + 'px;height:' + HDR_H + 'px;line-height:' + (HDR_H - 1) + 'px">A</div>');
    el.hcol.innerHTML = HDR_H ? hs.join('') : '';
    hs = [];
    for (i = r0; i <= r1; i++) {
      var h = (sh.rowY[i + 1] - sh.rowY[i]) * s; if (h <= 0) continue;
      hs.push('<div class="sx-h' + (S.sel.r === i ? ' sel' : '') + '" style="top:' + (sh.rowY[i] * s - st) + 'px;left:0;width:' + HDR_W + 'px;height:' + h + 'px;line-height:' + (h - 1) + 'px">' + (i + 1) + '</div>');
    }
    var fh0 = (sh.rowY[1] - sh.rowY[0]) * s, fw0 = (sh.colX[1] - sh.colX[0]) * s;
    if (HDR_W && S.frz.row && fh0 > 0) hs.push('<div class="sx-h fz' + (S.sel.r === 0 ? ' sel' : '') + '" style="top:0;left:0;width:' + HDR_W + 'px;height:' + fh0 + 'px;line-height:' + (fh0 - 1) + 'px">1</div>');
    el.hrow.innerHTML = HDR_W ? hs.join('') : '';
    // 고정 첫 행/열
    var sbw = sc.offsetWidth - sc.clientWidth, sbh = sc.offsetHeight - sc.clientHeight;
    var fh = (sh.rowY[1] - sh.rowY[0]) * s, fw = (sh.colX[1] - sh.colX[0]) * s;
    if (S.frz.row && fh > 0) {
      el.fr.style.cssText = 'display:block;left:' + HDR_W + 'px;top:' + HDR_H + 'px;right:' + sbw + 'px;height:' + fh + 'px';
      el.fr.innerHTML = cellsHTML(sh, 0, 0, c0, c1, sl, 0);
    } else el.fr.style.display = 'none';
    if (S.frz.col && fw > 0) {
      el.fc.style.cssText = 'display:block;left:' + HDR_W + 'px;top:' + HDR_H + 'px;bottom:' + sbh + 'px;width:' + fw + 'px';
      el.fc.innerHTML = cellsHTML(sh, r0, r1, 0, 0, 0, st);
    } else el.fc.style.display = 'none';
    if (S.frz.row && S.frz.col && fh > 0 && fw > 0) {
      el.fx.style.cssText = 'display:block;left:' + HDR_W + 'px;top:' + HDR_H + 'px;width:' + fw + 'px;height:' + fh + 'px';
      el.fx.innerHTML = cellsHTML(sh, 0, 0, 0, 0, 0, 0);
    } else el.fx.style.display = 'none';
    if (S.chartUi) S.chartUi.paint();
    if (S.dataUi) S.dataUi.paint();
  }
  function layoutSize() {
    var sh = S.sh, s = S.scale, el = S.el;
    el.spacer.style.width = sh.colX[sh.nc] * s + 'px'; el.spacer.style.height = sh.rowY[sh.nr] * s + 'px';
  }
  function placeGrid() {
    var el = S.el, HDR_W = S.hw, HDR_H = S.hh;
    el.corner.style.display = el.hcol.style.display = el.hrow.style.display = (HDR_W && HDR_H) ? '' : 'none';
    el.sc.style.cssText = 'left:' + HDR_W + 'px;top:' + HDR_H + 'px;right:0;bottom:0';
    el.hcol.style.left = HDR_W + 'px'; el.hcol.style.height = HDR_H + 'px';
    el.hrow.style.top = HDR_H + 'px'; el.hrow.style.width = HDR_W + 'px';
    el.corner.style.width = HDR_W + 'px'; el.corner.style.height = HDR_H + 'px';
  }

  // ---------------- 선택·입력줄 ----------------
  function select(r, c, noRender, keepRg) {
    var sh = S.sh, m = mergeAt(sh, r, c);
    if (m) { r = m.s.r; c = m.s.c; }
    S.sel = { r: r, c: c }; if (!keepRg) { S.rg = null; S.rangeMode = false; S.rgAnchor = null; }
    var cell = cellOf(sh, r, c);
    S.el.addr.textContent = addr(r, c);
    S.el.inp.value = barText(cell); S.barOrig = S.el.inp.value;
    S.el.inp.readOnly = !(S.editable && S.editing);
    S.el.ok.disabled = !(S.editable && S.editing);
    if (S.ui) S.ui.refresh();
    if (!noRender) render(true);
  }
  function ensureVisible() {
    var sh = S.sh, s = S.scale, sc = S.el.sc, r = S.sel.r, c = S.sel.c;
    var top = sh.rowY[r] * s, bot = sh.rowY[r + 1] * s, left = sh.colX[c] * s, right = sh.colX[c + 1] * s;
    if (top < sc.scrollTop) sc.scrollTop = top; else if (bot > sc.scrollTop + sc.clientHeight) sc.scrollTop = bot - sc.clientHeight;
    if (left < sc.scrollLeft) sc.scrollLeft = left; else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth;
  }
  function pickAt(cx, cy, t) {
    var sh = S.sh, s = S.scale, el = S.el, sc = el.sc, rect = sc.getBoundingClientRect();
    var inFr = t.closest('.sx-fr'), inFc = t.closest('.sx-fc'), inFx = t.closest('.sx-fx');
    var x = (cx - rect.left + sc.scrollLeft) / s, y = (cy - rect.top + sc.scrollTop) / s;
    if (inFx) { x = 0; y = 0; } else if (inFr) y = 0; else if (inFc) x = 0;
    if (x < 0 || y < 0) return false;
    var r = Math.min(sh.nr - 1, lowerIdx(sh.rowY, y)), c = Math.min(sh.nc - 1, lowerIdx(sh.colX, x));
    var m = mergeAt(sh, r, c), tr = m ? m.s.r : r, tc = m ? m.s.c : c;
    if (S.rangeMode && S.editing) {            // 범위의 끝 칸: 처음 칸(앵커)부터 이 칸까지
      var an0 = S.rgAnchor || S.sel;
      S.rg = { r0: Math.min(an0.r, tr), r1: Math.max(an0.r, tr), c0: Math.min(an0.c, tc), c1: Math.max(an0.c, tc) };
      S.rangeMode = false; S.rgAnchor = null; render(true); if (S.ui) S.ui.refresh();
      S.ctx.toast('범위를 골랐습니다(' + addr(S.rg.r0, S.rg.c0) + ':' + addr(S.rg.r1, S.rg.c1) + ')', 2200);
      return { same: false, range: true };
    }
    var same = (S.sel.r === tr && S.sel.c === tc);
    // 한글을 치던 중 다른 칸을 누르면, 치던 내용을 먼저 그 칸에 넣어 둔다(값이 사라지지 않게)
    if (!same && S.editable && S.editing && el.inp.value !== S.barOrig) { if (!commit(true)) return false; }
    select(r, c);
    return { same: same };
  }
  function onTap(e) {
    if (S.lp) { S.lp = false; return; }                 // 길게 눌러 상세를 연 뒤의 손 뗌은 무시
    var fvEl = e.target && e.target.closest ? e.target.closest('.sx-fv') : null;
    if (!fvEl && e.target && e.target.closest) { var fhc = e.target.closest('.sx-fh'); if (fhc && e.clientX >= fhc.getBoundingClientRect().right - Math.min(44, fhc.getBoundingClientRect().width * 0.4)) fvEl = fhc.querySelector('.sx-fv'); }      // v10.7 다듬기: ▽ 는 눈에 보이는 크기(22px)는 그대로 두고, 누르는 자리는 칸 오른쪽 44px 로 넓힌다(손가락용)
    var res = pickAt(e.clientX, e.clientY, e.target);
    if (!res) return;
    if (fvEl && S.editing && S.ui && S.ui.filterCol) { S.ui.filterCol(Number(fvEl.getAttribute('data-fc'))); return; }      // 머리줄 ▽ → 그 열 필터
    // 고치기 중이면 칸을 누르는 즉시 입력줄이 키보드 위로 올라온다
    // v10.4: 아래 도구줄이 있을 때는 첫 번째 누름 = 칸 고르기(키보드 안 올림), 같은 칸을 한 번 더 누르면 입력 시작(키보드가 올라오면 도구줄이 가려지므로)
    if (S.editable && S.editing && (!plusOn() || res.same)) { try { S.el.inp.focus({ preventScroll: true }); } catch (x2) {} }
  }
  // 길게 누르면 칸의 전체 내용(긴 글)을 큰 창으로 보여 준다
  function bindLongPress(wrap) {
    var tm = 0, sx = 0, sy = 0, tgt = null;
    function clr() { if (tm) { clearTimeout(tm); tm = 0; } }
    wrap.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (!(e.target.closest('.sx-fz') || e.target.closest('.sx-scroll'))) return;
      clr(); S.lp = false; sx = e.clientX; sy = e.clientY; tgt = e.target;
      tm = setTimeout(function () {
        tm = 0; if (!S) return;
        if (pickAt(sx, sy, tgt)) { S.lp = true; openDetail(); }
      }, LONGPRESS_MS);
    });
    wrap.addEventListener('pointermove', function (e) { if (tm && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) clr(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { wrap.addEventListener(n, clr); });
    S.el.sc.addEventListener('scroll', clr, { passive: true });
    wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function closeDetail() { if (S && S.el.det) { S.el.det.parentNode && S.el.det.parentNode.removeChild(S.el.det); S.el.det = null; kbUpdate(); } }
  function openDetail() {
    closeDetail();
    var sh = S.sh, cell = cellOf(sh, S.sel.r, S.sel.c), canEdit = !!(S.editable && S.editing);
    var det = document.createElement('div'); det.className = 'sx-det';
    var box = document.createElement('div'); box.className = 'sx-detbox';
    var ttl = document.createElement('div'); ttl.className = 'sx-dett'; ttl.textContent = addr(S.sel.r, S.sel.c) + ' 칸 내용';
    var ta = document.createElement('textarea'); ta.className = 'sx-detta'; ta.spellcheck = false; ta.autocapitalize = 'off';
    ta.value = canEdit ? barText(cell) : (display(cell) || barText(cell)); ta.readOnly = !canEdit;
    var bar = document.createElement('div'); bar.className = 'sx-detb';
    var b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'sx-detbtn'; b1.textContent = canEdit ? '취소' : '닫기'; b1.onclick = closeDetail;
    bar.appendChild(b1);
    if (canEdit) {
      var b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'sx-detbtn primary'; b2.textContent = '넣기';
      b2.onclick = function () { S.el.inp.value = ta.value; if (commit(true)) closeDetail(); };
      bar.appendChild(b2);
    }
    box.appendChild(ttl); box.appendChild(ta); box.appendChild(bar); det.appendChild(box);
    det.addEventListener('pointerdown', function (e) { if (e.target === det) closeDetail(); });
    S.el.root.appendChild(det); S.el.det = det;
    if (canEdit) setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (x) {} kbUpdate(); }, 60);
  }

  // ---------------- 키보드가 올라올 때 ----------------
  // 입력줄에 글을 치는 동안: 입력줄을 키보드 바로 위로 옮기고, 고르는 칸이 가려지지 않게 표를 위로 올린다.
  function kbUpdate() {
    if (!S || !S.el) return;
    var el = S.el, root = el.root, ae = document.activeElement;
    var inInp = ae === el.inp;
    var inDet = !!(el.det && ae && ae.tagName === 'TEXTAREA' && el.det.contains(ae));
    var vv = global.visualViewport, inset = 0;
    if ((inInp || inDet) && vv) inset = Math.max(0, Math.round(root.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)));
    root.classList.toggle('kb', inInp);
    root.style.setProperty('--sx-kb', inset + 'px');
    if (el.det) el.det.style.bottom = inset + 'px';
    if (inInp) requestAnimationFrame(function () { if (S) { ensureVisible(); render(); } });
  }
  function bindKeyboard() {
    var vv = global.visualViewport, inp = S.el.inp;
    var f = function () { kbUpdate(); };
    S.kbFn = f;
    inp.addEventListener('focus', f); inp.addEventListener('blur', function () { setTimeout(f, 80); });
    if (vv) { vv.addEventListener('resize', f); vv.addEventListener('scroll', f); }
    global.addEventListener('resize', f);
  }
  function unbindKeyboard() {
    var vv = global.visualViewport;
    if (S && S.kbFn) { if (vv) { vv.removeEventListener('resize', S.kbFn); vv.removeEventListener('scroll', S.kbFn); } global.removeEventListener('resize', S.kbFn); }
  }

  // ---------------- 줌 ----------------
  function setScale(ns, cx, cy) {
    var sh = S.sh, sc = S.el.sc, old = S.scale;
    var maxByH = 30000000 / Math.max(1, sh.rowY[sh.nr]), maxByW = 30000000 / Math.max(1, sh.colX[sh.nc]);
    ns = Math.max(0.5, Math.min(3, ns, maxByH, maxByW));
    if (cx == null) { cx = sc.clientWidth / 2; cy = sc.clientHeight / 2; }
    var px = (sc.scrollLeft + cx) / old, py = (sc.scrollTop + cy) / old;
    S.scale = ns; layoutSize();
    sc.scrollLeft = px * ns - cx; sc.scrollTop = py * ns - cy;
    S.el.pct.textContent = Math.round(ns * 100) + '%';
    render(true);
  }
  function bindPinch(sc) {
    var p = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    sc.addEventListener('touchstart', function (e) { if (e.touches.length === 2) p = { d: dist(e.touches), s: S.scale }; }, { passive: true });
    sc.addEventListener('touchmove', function (e) {
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      var rect = sc.getBoundingClientRect(), cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      setScale(p.s * dist(e.touches) / p.d, cx, cy);
    }, { passive: false });
    sc.addEventListener('touchend', function (e) { if (e.touches.length < 2) p = null; }, { passive: true });
  }

  // ---------------- 고치기 ----------------
  // 날짜(+시간) 글자를 엑셀 날짜 번호로. 못 읽으면 null
  function parseDate(t) {
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
      if (!m) return null;
      mo = +m[1]; d = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000;
    }
    var hh = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
    if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || ss > 59) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    var days = Math.round((dt.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    return days + (hh * 3600 + mi * 60 + ss) / 86400;
  }
  function parseInput(txt, old, ext) {
    var XLSX = global.XLSX, t = txt.trim();
    if (t === '') return { empty: true };
    if (t.charAt(0) === '=') {
      if (!S || S.mode !== 'patch') return { err: '이 파일 형식에서는 수식 입력을 지원하지 않습니다.' };
      var fx = t.slice(1).trim(), q = 0, dp = 0, i2;
      for (i2 = 0; i2 < fx.length; i2++) { var ch = fx.charAt(i2); if (ch === '"') q ^= 1; else if (!q) { if (ch === '(') dp++; else if (ch === ')') dp--; if (dp < 0) break; } }
      if (!fx || q || dp !== 0) return { err: '수식의 괄호나 따옴표가 맞지 않습니다.' };
      var outside = fx.replace(/"[^"]*"/g, '""');
      if (/[;；，（）]/.test(outside) || /[+\-*\/^&,=<>]$/.test(outside) || /,\s*\)|\(\s*,/.test(outside)) return { err: '수식 모양이 이상합니다. 쉼표(,)로 구분하고 영어 함수 이름을 써 주십시오. 예: =SUM(B2:B5)' };
      var fnr = /([^\s(+\-*\/^&,=<>:!]+)\(/g, fm2;
      while ((fm2 = fnr.exec(outside))) if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(fm2[1]) && !/^'.*'$/.test(fm2[1])) return { err: '함수 이름은 영어로 써 주십시오. (예: SUM, AVERAGE, IF)' };
      return { formula: fx };
    }
    if (ext !== 'csv' && old && old.t === 'n' && old.z && XLSX.SSF.is_date(old.z)) {
      var ds = parseDate(t);
      if (ds == null) return { err: '날짜 칸입니다. 「2026-10-09」, 「2026/10/09」, 「10/09/26」(월/일/연), 「2026-10-09 14:30」처럼 적어 주십시오.' };
      var dc = { t: 'n', v: ds, z: old.z }; return { cell: dc };
    }
    if (ext !== 'csv' && old && old.t === 's') return { cell: { t: 's', v: txt } };      // 글자 칸은 글자로 둔다(앞자리 0·큰 수 보호)
    var digits = t.replace(/^[-+]/, '');
    if (ext !== 'csv' && /^\d+$/.test(digits)) {
      if (/^0\d/.test(digits) && !(old && old.t === 'n')) return { cell: { t: 's', v: txt } };
      if (digits.length > 15) {
        if (old && old.t === 'n') return { err: '16자리 이상 숫자는 숫자 칸에 정확히 넣을 수 없습니다. (글자 칸에는 넣을 수 있습니다)' };
        return { cell: { t: 's', v: txt } };
      }
    }
    var n = t.replace(/,/g, '');
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n) && !(ext === 'csv')) {
      var cell = { t: 'n', v: parseFloat(n) }; if (old && old.t === 'n' && old.z && old.z !== 'General') cell.z = old.z; return { cell: cell };
    }
    var pc = /^([-+]?\d+(\.\d+)?)%$/.exec(t);
    if (pc && ext !== 'csv') { var pz = (old && old.z && old.z !== 'General') ? old.z : (S && S.mode === 'patch' ? '' : '0%'); var pcell = { t: 'n', v: parseFloat(pc[1]) / 100 }; if (pz) pcell.z = pz; return { cell: pcell }; }
    if (/^(true|false)$/i.test(t) && ext !== 'csv') return { cell: { t: 'b', v: /^true$/i.test(t) } };
    return { cell: { t: 's', v: txt } };    // CSV 는 읽을 때도 전부 글자이므로 글자로 둔다
  }
  // ---- 수식이 이 칸을 쓰는지(저장 안내·토스트에 쓴다) ----
  var REF_RE = /(?<![A-Za-z0-9_.$])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(?:(\$?[A-Z]{1,3})\$?(\d+)(?::(\$?[A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])|(\$?[A-Z]{1,3}):(\$?[A-Z]{1,3})(?![A-Za-z0-9_(]))/g;
  function colIdx(s) { s = s.replace('$', ''); var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  function parseRefs(f, ownSheet) {
    var out = [], txt = String(f).replace(/"[^"]*"/g, '""'), m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(txt))) {
      var sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] || ownSheet);
      if (m[3]) { var c0 = colIdx(m[3]), r0 = +m[4] - 1, c1 = m[5] ? colIdx(m[5]) : c0, r1 = m[6] ? +m[6] - 1 : r0; out.push({ s: sheet, r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: Math.min(c0, c1), c1: Math.max(c0, c1) }); }
      else if (m[7]) { var a = colIdx(m[7]), b = colIdx(m[8]); out.push({ s: sheet, r0: 0, r1: MAX_R, c0: Math.min(a, b), c1: Math.max(a, b) }); }
    }
    return out;
  }
  function fmapSet(name, a, f) { if (!S.fmap) return; var k = name + '|' + a; if (f) S.fmap[k] = { s: name, a: a, refs: parseRefs(f, name) }; else delete S.fmap[k]; }
  function fmapBuild() {
    if (S.fmap) return; S.fmap = {};
    S.names.forEach(function (nm) {
      var ws = S.wb.Sheets[nm]; if (!ws) return;
      for (var k in ws) { if (k.charAt(0) === '!' || !Object.prototype.hasOwnProperty.call(ws, k)) continue; var cl = ws[k]; if (cl && cl.f) fmapSet(nm, k, cl.f); }
    });
  }
  function affects(name, r, c) {            // 다른 칸의 수식이 (name 시트의 r,c) 칸을 쓰면 true
    fmapBuild();
    var ka = name + '|' + addr(r, c);
    for (var k in S.fmap) {
      if (k === ka) continue;
      var rs = S.fmap[k].refs;
      for (var i = 0; i < rs.length; i++) { var x = rs[i]; if (x.s === name && r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1) return true; }
    }
    return false;
  }
  function anyAffected() {
    var ks = Object.keys(S.edits);
    for (var i = 0; i < ks.length; i++) { var e = S.edits[ks[i]]; if (e.res && e.res.formula != null) return true; if (affects(e.name, e.r, e.c)) return true; }
    return false;
  }

  // ---- 칸 하나를 바꾸고 되돌리기 기록을 남긴다 ----
  var UNDO_MAX = 60;
  function capture(name, r, c) {            // 이 칸·이 시트의 지금 상태를 통째로 적어 둔다
    var ws = S.wb.Sheets[name], a = addr(r, c), psh = S.an && S.an.sheets[name], k = S.names.indexOf(name) + '|' + r + '|' + c;
    return { name: name, r: r, c: c, a: a, k: k, has: !!ws && Object.prototype.hasOwnProperty.call(ws, a), cell: ws && ws[a] ? Object.assign({}, ws[a]) : null,
      hasRef: !!ws && Object.prototype.hasOwnProperty.call(ws, '!ref'), ref: ws ? ws['!ref'] : undefined, xml: psh ? psh.xml : null, edit: S.edits[k] || null, patched: !!S.patched[name] };
  }
  function reinstate(st) {
    var ws = S.wb.Sheets[st.name] || (S.wb.Sheets[st.name] = {}), psh = S.an && S.an.sheets[st.name];
    if (st.has && st.cell) ws[st.a] = Object.assign({}, st.cell); else delete ws[st.a];
    if (st.hasRef) ws['!ref'] = st.ref; else delete ws['!ref'];
    if (psh && st.xml != null) psh.xml = st.xml;
    if (st.edit) S.edits[st.k] = st.edit; else delete S.edits[st.k];
    if (st.patched) S.patched[st.name] = 1; else delete S.patched[st.name];
    fmapSet(st.name, st.a, st.cell && st.cell.f ? st.cell.f : null);
  }
  function noteOrig(name, r, c) {           // 처음 고치기 전 모양을 기억(모두 되돌리기용)
    var ws = S.wb.Sheets[name], a = addr(r, c), k = S.names.indexOf(name) + '|' + r + '|' + c;
    if (!(k in S.orig)) S.orig[k] = { name: name, a: a, cell: ws && ws[a] ? Object.assign({}, ws[a]) : null };
    if (!(name in S.origRef)) S.origRef[name] = { has: !!ws && Object.prototype.hasOwnProperty.call(ws, '!ref'), ref: ws ? ws['!ref'] : undefined };
  }
  // 칸 (r,c) 를 res(parseInput 결과)대로 바꾼다. 못 하면 { err }, 되면 { hadFormula }
  function applyRes(name, r, c, res) {
    var XLSX = global.XLSX, ws = S.wb.Sheets[name] || (S.wb.Sheets[name] = {}), a = addr(r, c), old = ws[a], hadFormula = !!(old && old.f), key = S.names.indexOf(name) + '|' + r + '|' + c;
    var before = capture(name, r, c);
    if (S.mode === 'patch') {
      var psh = S.an.sheets[name];
      if (!psh || psh.readOnly) return { err: (psh && psh.why) || '이 시트는 고칠 수 없습니다.' };
      var blk = global.SOXlsxPatch.cellBlock(psh, a);
      if (blk) return { err: blk };
      var spec = res.formula != null ? { kind: 'f', f: res.formula } : res.empty ? { kind: 'empty' } :
        res.cell.t === 'n' ? { kind: 'n', v: res.cell.v } : res.cell.t === 'b' ? { kind: 'b', v: res.cell.v } : { kind: 's', v: res.cell.v };
      var pr = global.SOXlsxPatch.patchCell(psh.xml, a, spec);
      if (pr.err) return { err: pr.err };
      noteOrig(name, r, c);
      psh.xml = pr.xml; S.patched[name] = 1;
    } else noteOrig(name, r, c);
    function widen() {
      var rg = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: r, c: c }, e: { r: r, c: c } };
      if (r > rg.e.r) rg.e.r = r; if (c > rg.e.c) rg.e.c = c; if (r < rg.s.r) rg.s.r = r; if (c < rg.s.c) rg.s.c = c;
      ws['!ref'] = XLSX.utils.encode_range(rg);
    }
    if (res.formula != null) {
      var fcell = { t: 's', v: '', f: res.formula, w: '⟳' };
      if (old && old.s) fcell.s = old.s;
      ws[a] = fcell; widen();
    } else if (res.empty) delete ws[a];
    else {
      var cell = Object.assign({}, res.cell);
      if (cell.t === 'n') cell.w = (cell.z && cell.z !== 'General') ? XLSX.SSF.format(cell.z, cell.v) : String(cell.v);
      else if (cell.t === 's') cell.w = cell.v;
      if (old && old.s) cell.s = old.s;
      ws[a] = cell; widen();
    }
    fmapSet(name, a, res.formula != null ? res.formula : null);
    S.edits[key] = { name: name, r: r, c: c, res: res };
    S.undo.push(before); if (S.undo.length > UNDO_MAX) S.undo.shift();
    S.redo = [];
    return { hadFormula: hadFormula };
  }
  function syncDirty() {
    var d = Object.keys(S.edits).length > 0 || !!S.pkgOps || !!(S.ctx.cryptTouched && S.ctx.cryptTouched());
    if (d !== S.dirty) { S.dirty = d; S.ctx.setDirty(d); }
    refreshActions();
  }
  // stay=true 이면 아래 칸으로 옮기지 않는다. 넣었거나 바꿀 게 없으면 true, 못 넣었으면 false
  function commit(stay) {
    if (!S.editable || !S.editing) return true;
    var inp = S.el.inp, txt = inp.value;
    if (txt === S.barOrig) return true;
    var sh = S.sh, r = S.sel.r, c = S.sel.c, a = addr(r, c), old = sh.ws[a];
    var res = parseInput(txt, old, S.ext);
    if (res.err) { S.ctx.toast(res.err, 3200); return false; }
    var willAffect = res.formula == null && S.ext !== 'csv' && !S.calcToasted && affects(sh.name, r, c);
    var ap = applyRes(sh.name, r, c, res);
    if (ap.err) { S.ctx.toast(ap.err, 4200); return false; }
    syncDirty();
    var calcWas = !!(S.calc && S.calc.on), calcOk = calcWas ? calcRefresh() : false;
    if (res.formula != null) S.ctx.toast(calcOk ? '수식을 넣었습니다. 계산한 값을 바로 보여 드립니다.' : (calcWas ? '이 수식은 폰에서 계산하지 못해 「합계 바로 보이기」를 껐습니다. 계산 결과는 엑셀에서 열면 나옵니다.' : '수식을 넣었습니다. 계산 결과는 엑셀에서 열면 나옵니다.'), 3800);
    else if (ap.hadFormula) S.ctx.toast('수식이 있던 칸이라, 이제 값만 남았습니다.', 2600);
    else if (calcWas && !calcOk) S.ctx.toast('계산을 하지 못해 「합계 바로 보이기」를 껐습니다. 합계 값은 엑셀에서 열면 다시 계산됩니다.', 3800);
    else if (willAffect && !calcOk) { S.calcToasted = true; S.ctx.toast('이 칸을 쓰는 다른 수식의 결과는 엑셀에서 열면 다시 계산됩니다.', 3200); }
    if (!stay && r + 1 < sh.nr) { select(r + 1, c, true); ensureVisible(); }
    else S.barOrig = S.el.inp.value;
    render(true); refreshEd();
    return true;
  }
  // ---- 되돌리기 · 다시하기 · 모두 되돌리기 ----
  function jumpTo(name, r, c) {
    var i = S.names.indexOf(name);
    if (i >= 0 && S.sh.i !== i) { if (S.vis.indexOf(i) < 0) return; showSheet(i); }
    select(r, c, true); ensureVisible(); render(true);
  }
  function stepHistory(from, to, doneMsg) {
    if (!S || !S.editing || !from.length) return;
    S.el.inp.blur();
    var st = from.pop();
    if (st.pkg) {                                  // 줄·칸·서식·시트 같은 큰 고침: 그 전 문서로 통째로 돌린다
      S.ctx.busy('되돌리는 중…');
      currentBytes().then(function (cur) { to.push({ pkg: true, bytes: cur, label: st.label }); return loadBytes(st.bytes); }).then(adopt).then(function () {
        S.pkgOps = Math.max(0, (S.pkgOps || 0) + (from === S.undo ? -1 : 1)); S.ctx.busy(null); syncDirty(); S.ctx.toast(doneMsg + ' (' + st.label + ')', 2000);
      }).catch(function (e) { S.ctx.busy(null); from.push(st); S.ctx.explainFail('되돌리지 못했습니다', e, 4200); });
      return;
    }
    to.push(capture(st.name, st.r, st.c));
    reinstate(st);
    if (S.calc && S.calc.on) calcRefresh();
    syncDirty(); jumpTo(st.name, st.r, st.c); refreshEd();
    S.ctx.toast(doneMsg + ' (' + st.a + ')', 1800);
  }
  function undoEdit() { stepHistory(S.undo, S.redo, '되돌렸습니다'); }
  function redoEdit() { stepHistory(S.redo, S.undo, '다시 했습니다'); }
  function resetAll() {
    if (!S || !S.editing) return;
    var n = Object.keys(S.edits).length;
    if (!n && !S.pkgOps) { S.ctx.toast('고친 칸이 없습니다.', 1800); return; }
    if (S.pkgOps && S.origBuf) {
      S.ctx.confirm('모두 되돌릴까요?', '지금까지 고친 내용(줄·칸·서식·시트 포함)을 모두 처음 모양으로 돌립니다. 이미 저장한 사본 파일은 그대로입니다.', '모두 되돌리기', function () {
        if (!S) return; S.ctx.busy('되돌리는 중…');
        loadBytes(new Uint8Array(S.origBuf)).then(adopt).then(function () {
          S.edits = {}; S.patched = {}; Object.keys((S.an && S.an.sheets) || {}).forEach(function (nm) { S.patched[nm] = 1; }); S.undo = []; S.redo = []; S.orig = {}; S.origRef = {}; S.calcToasted = false; S.pkgOps = 0;
          S.ctx.busy(null); syncDirty(); S.ctx.toast('고친 내용을 모두 되돌렸습니다.', 2400);
        }).catch(function (e) { S.ctx.busy(null); S.ctx.explainFail('되돌리지 못했습니다', e, 4200); });
      }, { danger: true });
      return;
    }
    S.ctx.confirm('모두 되돌릴까요?', '지금까지 고친 ' + n + '칸을 모두 처음 모양으로 돌립니다. 이미 저장한 사본 파일은 그대로입니다.', '모두 되돌리기', function () {
      if (!S) return;
      Object.keys(S.orig).forEach(function (k) {
        var o = S.orig[k], ws = S.wb.Sheets[o.name]; if (!ws) return;
        if (o.cell) ws[o.a] = Object.assign({}, o.cell); else delete ws[o.a];
        fmapSet(o.name, o.a, o.cell && o.cell.f ? o.cell.f : null);
      });
      Object.keys(S.origRef).forEach(function (nm) { var o = S.origRef[nm], ws = S.wb.Sheets[nm]; if (!ws) return; if (o.has) ws['!ref'] = o.ref; else delete ws['!ref']; });
      if (S.an && S.an.sheets) Object.keys(S.patched).forEach(function (nm) { var p = S.an.sheets[nm]; if (p && p.orig != null) p.xml = p.orig; });
      S.edits = {}; S.patched = {}; S.undo = []; S.redo = []; S.orig = {}; S.origRef = {}; S.calcToasted = false;
      syncDirty(); select(S.sel.r, S.sel.c, true); render(true); refreshEd();
      S.ctx.toast('고친 내용을 모두 되돌렸습니다.', 2400);
    }, { danger: true });
  }
  function refreshEd() {
    if (!S || !S.el || !S.el.ed) return;
    S.el.ed.style.display = (S.editable && S.editing) ? '' : 'none';
    S.el.undoB.disabled = !S.undo.length; S.el.redoB.disabled = !S.redo.length; S.el.allB.disabled = !Object.keys(S.edits).length && !S.pkgOps;
    if (S.el.calcB) S.el.calcB.textContent = !plusOn() ? '' : (S.calc && S.calc.on ? '합계 계산 켜짐' : (S.calc && S.calc.has ? '합계는 엑셀에서 계산' : ''));
    if (S.el.repl) S.el.repl.style.display = (S.el.find.style.display !== 'none' && S.editing && plusOn()) ? '' : 'none';
  }
  function leaveEdit() {
    if (!S || !S.editing) return;
    if (!commit(true)) return;
    S.el.inp.blur(); S.editing = false; refreshActions(); select(S.sel.r, S.sel.c, true); render(true); refreshEd();
    S.ctx.toast(S.dirty ? '보기로 돌아왔습니다. 고친 내용은 그대로 있습니다.' : '보기로 돌아왔습니다.', 2400);
  }

  // ---- 찾기(시트 전체 칸 값 검색 → 칸으로 이동. 바꾸기는 없다) ----
  var FIND_MAX = 2000;
  function findAll(q) {
    var out = [], needle = q.toLowerCase(), XLSX = global.XLSX;
    S.vis.forEach(function (si) {
      var nm = S.names[si], ws = S.wb.Sheets[nm]; if (!ws) return;
      var hits = [];
      for (var k in ws) {
        if (k.charAt(0) === '!' || !Object.prototype.hasOwnProperty.call(ws, k) || out.length + hits.length >= FIND_MAX) continue;
        var cl = ws[k]; if (!cl) continue;
        var t = display(cl); if (!t && cl.v != null) t = String(cl.v);
        if (t && t.toLowerCase().indexOf(needle) >= 0) { var p = XLSX.utils.decode_cell(k); hits.push({ si: si, r: p.r, c: p.c }); }
      }
      hits.sort(function (x, y) { return x.r - y.r || x.c - y.c; });
      out = out.concat(hits);
    });
    return out;
  }
  function toggleFind() {
    var f = S.el.find;
    if (f.style.display === 'none') { f.style.display = ''; S.el.fq.focus(); }
    else { f.style.display = 'none'; S.finds = null; }
    refreshEd();
  }
  function runFind() {
    var q = S.el.fq.value.trim();
    if (!q) { S.finds = null; S.el.fcnt.textContent = ''; return; }
    S.finds = { q: q, list: findAll(q), i: -1 };
    if (!S.finds.list.length) { S.el.fcnt.textContent = '없음'; S.ctx.toast('「' + q + '」을 찾지 못했습니다.', 2000); return; }
    stepFind(1);
  }
  function stepFind(d) {
    if (!S.finds || !S.finds.list.length) { runFind(); return; }
    var n = S.finds.list.length; S.finds.i = (S.finds.i + d + n) % n;
    var h = S.finds.list[S.finds.i];
    S.el.fcnt.textContent = (S.finds.i + 1) + ' / ' + n + (n >= FIND_MAX ? '+' : '');
    if (S.editing && S.el.inp.value !== S.barOrig) { if (!commit(true)) return; }
    S.el.fq.blur();
    jumpTo(S.names[h.si], h.r, h.c);
  }

  function saveBase() { return (S.ctx.name || 'sheet').replace(/\.[^.]+$/, ''); }
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function buildXlsx() { return currentBytes(); }
  function doSave(silent) {                  // 사본 저장. silent = 확인 시트 없이(「수정 요청」으로 넘어가기 전 저장). Promise<true|false>
    var ctx = S.ctx, XLSX = global.XLSX, base = saveBase();
    if (S.ext === 'csv') {
      var csv = XLSX.utils.sheet_to_csv(S.wb.Sheets[S.names[0]]);
      return Promise.resolve(ctx.saveCopy(new Blob(['﻿' + csv], { type: 'text/csv' }), base + '_수정.csv')).then(function (ok) {
        if (ok === false || !S) return false;   // 저장 실패는 틀이 안내한다 — 성공이 확인된 뒤에만 성공 안내·고침 해제
        S.dirty = false; ctx.setDirty(false); refreshActions(); if (!silent) ctx.toast('사본으로 저장했습니다. 원래 파일은 그대로입니다.', 3000); return true;
      });
    }
    ctx.busy('사본 만드는 중…');
    return buildXlsx().then(function (out) {
      ctx.busy(null);
      if (!S) return false;
      return Promise.resolve(ctx.saveCopy(new Blob([out], { type: XLSX_MIME }), base + '_수정.xlsx')).then(function (ok) {
        if (ok === false || !S) return false;   // 저장 실패는 틀이 안내한다 — 성공이 확인된 뒤에만 성공 안내·고침 해제
        S.dirty = false; ctx.setDirty(false); refreshActions(); if (!silent) ctx.toast('사본으로 저장했습니다. 원래 파일은 그대로입니다.', 3000); return true;
      });
    }).catch(function (e) { ctx.busy(null); ctx.explainFail('저장하지 못했습니다', e, 4800); return false; });
  }
  function saveCopyNow() { doSave(false); }
  function askSave() {
    if (!S.editable || !S.dirty) return;
    if (S.editing && !commit(true)) return;
    var base = saveBase(), plus = plusOn(), nm = (plus && S.ctx.copyName) ? S.ctx.copyName(S.ext === 'csv' ? 'csv' : 'xlsx') : base + '_수정.' + (S.ext === 'csv' ? 'csv' : 'xlsx');
    var msg;
    if (S.ext === 'csv') msg = '고친 값을 새 CSV 파일(' + nm + ')로 저장합니다. 원래 파일은 그대로입니다.';
    else if (S.ctx.isNew) msg = '새 엑셀 문서를 「' + nm + '」 파일로 저장합니다.';
    else if (!S.pkgOps && !Object.keys(S.edits).length) msg = '문서 내용은 그대로 두고, 암호 설정만 바꿔 새 파일(' + nm + ')로 저장합니다. 원래 파일은 그대로입니다.';
    else if (S.pkgOps) msg = '고친 내용(줄·칸·서식·시트 포함)을 담아 새 파일(' + nm + ')로 저장합니다. 그림·차트는 그대로 둡니다. 원래 파일은 그대로입니다.';
    else msg = '고친 칸 ' + Object.keys(S.edits).length + '개만 바꿔서 새 파일(' + nm + ')로 저장합니다. 글꼴·색·차트·그림은 그대로입니다. ' +
        (anyAffected() && !(S.calc && S.calc.on) ? '고친 칸을 쓰는 다른 수식의 결과는 엑셀에서 열면 다시 계산됩니다. 합계처럼 값이 바뀌는 칸은 앱 화면과 다른 간이 보기 프로그램에서는 옛 값으로 보일 수 있습니다. ' : '') +
        '원래 파일은 그대로입니다.';
    if (plus && S.ext !== 'csv' && S.calc && !S.calc.on && S.calc.has) msg += '\n합계 같은 수식 값은 폰에서 다시 계산하지 않았습니다. 엑셀(또는 한셀)에서 열면 계산됩니다.';
    S.ctx.confirmCopy('사본으로 저장할까요?', msg, '사본 저장', saveCopyNow, plus && S.ext !== 'csv' ? { emph: '엑셀(또는 한셀)에서 열어 한 번 확인해 주십시오.' } : undefined);
  }
  function startEdit() {
    if (!S || !S.editable) return;
    S.editing = true; refreshActions(); select(S.sel.r, S.sel.c); refreshEd();
    if (S.ui) S.ui.refresh();
    S.ctx.toast(plusOn() ? '고치기를 켰습니다. 칸을 한 번 누르면 고르고, 같은 칸을 한 번 더 누르면 글·숫자를 입력합니다. 입력한 뒤 ✓를 누르십시오. 줄·칸·서식 도구는 아래에 있습니다.' : '고치기를 켰습니다. 고칠 칸을 누르고 내용을 바꾼 뒤 ✓를 누르십시오.', 3600);
  }
  function refreshActions() {
    var list = [];
    if (S.editable && !S.editing) {
      list.push({ label: '고치기', onClick: startEdit });
      if (S.dirty) list.push({ label: '사본 저장', primary: true, onClick: askSave });
    } else if (S.editable) list.push({ label: '사본 저장', primary: S.dirty, onClick: function () { if (!S.dirty) { S.ctx.toast('아직 고친 곳이 없어 저장할 것이 없습니다. 칸을 고치면 「사본 저장」이 켜집니다.', 3200); return; } askSave(); } });
    else list.push({ label: '보기 전용', disabled: true, onClick: function () {} });
    S.ctx.setActions(list);
  }

  // ---- 임시 보관(snapshot) · 되살리기(restore) ----
  function snapshot() {
    if (!S || !S.editable) return null;
    if (S.pkgOps) return currentBytes().then(function (b) { return { v: 3, ext: S.ext, bytes: new Blob([b], { type: XLSX_MIME }) }; });     // 줄·칸·서식·시트까지 고쳤으면 고친 문서를 통째로 보관
    var out = [];
    Object.keys(S.edits).forEach(function (k) {
      var e = S.edits[k], rs = e.res, o = { s: e.name, a: addr(e.r, e.c) };
      if (rs.empty) o.k = 'e';
      else if (rs.formula != null) { o.k = 'f'; o.f = rs.formula; }
      else { o.k = rs.cell.t; o.v = rs.cell.v; if (rs.cell.z) o.z = rs.cell.z; }
      out.push(o);
    });
    return out.length ? { v: 1, ext: S.ext, names: S.names.slice(), edits: out } : null;
  }
  function restore(data) {
    var rep = { applied: 0, skipped: 0 };
    if (S && S.editable && data && data.v === 3 && data.bytes instanceof Blob && plusOn()) {
      return data.bytes.arrayBuffer().then(function (b) { return loadBytes(new Uint8Array(b)); }).then(adopt).then(function () {
        S.pkgOps = 1; S.editing = true; syncDirty(); refreshActions(); refreshEd(); if (S.ui) S.ui.refresh();
        S.ctx.toast('이어서 고치던 내용을 되살렸습니다.', 3600); return { applied: 1, skipped: 0 };
      }).catch(function () { S.ctx.toast('이어서 고치던 내용을 되살리지 못했습니다.', 3200); return rep; });
    }
    if (!S || !S.editable || !data || !Array.isArray(data.edits)) return rep;
    if (Array.isArray(data.names) && (data.names.length !== S.names.length || data.names.some(function (n, i) { return n !== S.names[i]; }))) {   // 시트 구성(수·이름)이 달라졌으면 적용하지 않는다
      rep.skipped = data.edits.length; S.ctx.toast('문서의 시트 구성이 달라져 이어서 고치던 내용을 되살리지 않았습니다.', 4200); return rep;
    }
    var XLSX = global.XLSX;
    data.edits.forEach(function (e) {
      try {
        var si = e && typeof e.s === 'string' ? S.names.indexOf(e.s) : -1, p = e && typeof e.a === 'string' && /^[A-Z]{1,3}[0-9]{1,7}$/.test(e.a) ? XLSX.utils.decode_cell(e.a) : null;
        if (si < 0 || !p || p.r >= MAX_R || p.c >= MAX_C) { rep.skipped++; return; }
        var res;
        if (e.k === 'e') res = { empty: true };
        else if (e.k === 'f' && typeof e.f === 'string' && S.mode === 'patch') res = { formula: e.f };
        else if (e.k === 'n' && typeof e.v === 'number' && isFinite(e.v)) { res = { cell: { t: 'n', v: e.v } }; if (typeof e.z === 'string') res.cell.z = e.z; }
        else if (e.k === 's' && typeof e.v === 'string') res = { cell: { t: 's', v: e.v } };
        else if (e.k === 'b' && typeof e.v === 'boolean') res = { cell: { t: 'b', v: e.v } };
        else { rep.skipped++; return; }
        var ap = applyRes(e.s, p.r, p.c, res);
        if (ap.err) rep.skipped++; else rep.applied++;
      } catch (x) { rep.skipped++; }
    });
    if (rep.applied) {
      S.editing = true; syncDirty(); select(S.sel.r, S.sel.c, true); render(true); refreshEd();
      S.ctx.toast('이어서 고치던 ' + rep.applied + '칸을 되살렸습니다.' + (rep.skipped ? ' (' + rep.skipped + '칸은 맞는 칸이 없어 건너뛰었습니다)' : ''), 4200);
    } else if (rep.skipped) S.ctx.toast('이어서 고치던 내용을 되살리지 못했습니다.', 3200);
    return rep;
  }

  // 처음 열 때: 좁은 화면은 5열쯤, 펼친 화면(넓음)은 10열쯤이 한눈에 보이게 배율을 맞춘다(키우지는 않는다)
  function fitScale() {
    var sh = S.sh, avail = S.el.sc.clientWidth || 360, K = avail >= 560 ? 10 : 5, n = Math.min(K, sh.nc), w = sh.colX[n] || 1;
    return Math.max(0.5, Math.min(1, avail / w));
  }
  // ---------------- 시트 바꾸기·화면 조립 ----------------
  function showSheet(i) {
    S.sh = prepSheet(i); S.sel = { r: 0, c: 0 };
    var sc = S.el.sc; sc.scrollTop = 0; sc.scrollLeft = 0;
    S.lk = null; S.scale = 1; S.el.pct.textContent = '100%'; placeGrid();
    S.scale = Math.round(fitScale() * 100) / 100; S.el.pct.textContent = Math.round(S.scale * 100) + '%'; layoutSize();
    var tabs = S.el.tabs.querySelectorAll('.sx-tab');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('on', +tabs[k].getAttribute('data-i') === i);
    select(0, 0, true); render(true); if (S.chartUi) S.chartUi.reload(); if (S.dataUi) S.dataUi.reload();
  }
  function build(ctx) {
    var root = document.createElement('div'); root.className = 'sx-root';
    var note = S.noteText ? '<div class="sx-note">' + esc(S.noteText) + '</div>' : '';
    root.innerHTML = note +
      '<div class="sx-edbar" style="display:none"><button type="button" class="sx-eb sx-undo" aria-label="되돌리기">↶</button><button type="button" class="sx-eb sx-redo" aria-label="다시하기">↷</button>' +
        '<button type="button" class="sx-eb sx-eall">모두 되돌리기</button><span class="sx-edsp"></span><span class="sx-calc"></span><button type="button" class="sx-eb sx-eview">보기로</button></div>' +
      '<div class="sx-find" style="display:none"><input class="sx-fq" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" placeholder="칸 값 찾기" aria-label="찾을 말"><span class="sx-fcnt"></span>' +
        '<button type="button" class="sx-eb sx-fprev" aria-label="이전">▲</button><button type="button" class="sx-eb sx-fnext" aria-label="다음">▼</button><button type="button" class="sx-eb sx-fx" aria-label="찾기 닫기">✕</button></div>' +
      '<div class="sx-find sx-repl" style="display:none"><input class="sx-rq" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="바꿀 말" aria-label="바꿀 말"><button type="button" class="sx-eb sx-rone">바꾸기</button><button type="button" class="sx-eb sx-rall">모두 바꾸기</button></div>' +
      '<div class="sx-fbar"><div class="sx-addr">A1</div><input class="sx-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="칸 내용"><button type="button" class="sx-exp" aria-label="칸 내용 크게 보기">⤢</button><button type="button" class="sx-ok" aria-label="입력 확정">✓</button></div>' +
      '<div class="sx-gridwrap">' +
        '<div class="sx-corner"></div><div class="sx-hcol"></div><div class="sx-hrow"></div>' +
        '<div class="sx-scroll"><div class="sx-spacer"><div class="sx-layer"></div></div></div>' +
        '<div class="sx-fz sx-fr" style="display:none"></div><div class="sx-fz sx-fc" style="display:none"></div><div class="sx-fz sx-fx" style="display:none"></div>' +
      '</div>' +
      '<div class="sx-bottom"><div class="sx-ops so-clear" style="display:none"></div><div class="sx-tools sx-tabrow so-clear"><div class="sx-tabs"></div></div>' +
      '<div class="sx-tools sx-toolrow"><button type="button" class="sx-chip sx-zoom" data-z="-" aria-label="축소">−</button><span class="sx-pct">100%</span><button type="button" class="sx-chip sx-zoom" data-z="+" aria-label="확대">＋</button>' +
        '<button type="button" class="sx-chip" data-f="find">찾기</button><button type="button" class="sx-chip" data-f="fit">화면에 맞춤</button>' +
        '<button type="button" class="sx-chip' + (S.showHdr ? ' on' : '') + '" data-f="hdr" aria-pressed="' + S.showHdr + '">머리글 표시</button>' +
        '<button type="button" class="sx-chip" data-f="row">첫 행 고정</button><button type="button" class="sx-chip" data-f="col">첫 열 고정</button></div></div>';
    ctx.body.appendChild(root);
    var q = function (s) { return root.querySelector(s); };
    S.el = { root: root, addr: q('.sx-addr'), inp: q('.sx-input'), ok: q('.sx-ok'), wrap: q('.sx-gridwrap'), corner: q('.sx-corner'), hcol: q('.sx-hcol'), hrow: q('.sx-hrow'),
      sc: q('.sx-scroll'), spacer: q('.sx-spacer'), layer: q('.sx-layer'), fr: q('.sx-fr'), fc: q('.sx-fc'), fx: q('.sx-fx'), tabs: q('.sx-tabs'), pct: q('.sx-pct'),
      ed: q('.sx-edbar'), undoB: q('.sx-undo'), redoB: q('.sx-redo'), allB: q('.sx-eall'), viewB: q('.sx-eview'), find: q('.sx-find:not(.sx-repl)'), fq: q('.sx-fq'), fcnt: q('.sx-fcnt'),
      ops: q('.sx-ops'), calcB: q('.sx-calc'), repl: q('.sx-repl'), rq: q('.sx-rq') };
    q('.sx-rone').onclick = replaceCurrent; q('.sx-rall').onclick = replaceAll;
    S.el.hcol.addEventListener('click', function (e) { if (!S.editing || !plusOn()) return; var rc = S.el.hcol.getBoundingClientRect(); selectLine('col', Math.min(S.sh.nc - 1, lowerIdx(S.sh.colX, (e.clientX - rc.left + S.el.sc.scrollLeft) / S.scale))); });
    S.el.hrow.addEventListener('click', function (e) { if (!S.editing || !plusOn()) return; var rc = S.el.hrow.getBoundingClientRect(); selectLine('row', Math.min(S.sh.nr - 1, lowerIdx(S.sh.rowY, (e.clientY - rc.top + S.el.sc.scrollTop) / S.scale))); });
    if (plusOn()) { if (global.SOXlsxChart && ctx.flag('chart')) S.chartUi = global.SOXlsxChart.create(envForUI()); if (global.SOXlsxDataUI && global.SOXlsxPivot && global.SOXlsxData && ctx.flag('xlsxdata')) S.dataUi = global.SOXlsxDataUI.create(envForUI()); S.ui = global.SOXlsxUI.create(envForUI()); S.ui.mount(S.el.ops); }
    S.el.tabs.innerHTML = S.vis.map(function (i) { return '<button type="button" class="sx-tab" data-i="' + i + '">' + esc(S.names[i]) + '</button>'; }).join('');
    S.el.tabs.addEventListener('click', function (e) { var b = e.target.closest('.sx-tab'); if (b) showSheet(+b.getAttribute('data-i')); });
    root.addEventListener('click', function (e) {
      var z = e.target.closest('[data-z]'), f = e.target.closest('[data-f]');
      if (z) setScale(S.scale * (z.getAttribute('data-z') === '+' ? 1.25 : 0.8));
      else if (f) {
        var k = f.getAttribute('data-f');
        if (k === 'fit') setScale(fitScale());
        else if (k === 'find') toggleFind();
        else if (k === 'hdr') {
          S.showHdr = !S.showHdr; S.hw = S.showHdr ? HDR_W : 0; S.hh = S.showHdr ? HDR_H : 0;
          f.classList.toggle('on', S.showHdr); f.setAttribute('aria-pressed', S.showHdr);
          try { localStorage.setItem('so_xlsx_hdr', S.showHdr ? '1' : '0'); } catch (x) {}
          placeGrid(); render(true);
        } else { S.frz[k] = !S.frz[k]; f.classList.toggle('on', S.frz[k]); f.setAttribute('aria-pressed', S.frz[k]); render(); }
      }
    });
    S.el.sc.addEventListener('scroll', schedule, { passive: true });
    S.el.wrap.addEventListener('click', function (e) { if (e.target.closest('.sx-fz') || e.target.closest('.sx-scroll')) onTap(e); });
    S.el.ok.onclick = function () { var done = commit(); if (done !== false) { try { S.el.inp.blur(); } catch (e) {} } };      // ✓ 를 누르면 입력창을 내려 키보드가 닫히고 아래 도구줄이 다시 보인다
    S.el.undoB.onclick = undoEdit; S.el.redoB.onclick = redoEdit; S.el.allB.onclick = resetAll; S.el.viewB.onclick = leaveEdit;
    q('.sx-fprev').onclick = function () { stepFind(-1); }; q('.sx-fnext').onclick = function () { stepFind(1); };
    q('.sx-fx').onclick = function () { toggleFind(); };
    S.el.fq.addEventListener('keydown', function (e) { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); if (S.finds && S.finds.q === S.el.fq.value.trim()) stepFind(e.shiftKey ? -1 : 1); else runFind(); } });
    S.el.fq.addEventListener('input', function () { S.finds = null; S.el.fcnt.textContent = ''; });
    S.el.exp = q('.sx-exp'); S.el.exp.onclick = openDetail;
    // 단추를 눌러도 입력줄의 키보드가 내려가지 않게(한글을 치다가 끊기지 않게)
    [S.el.ok, S.el.exp, S.el.undoB, S.el.redoB, S.el.allB, S.el.viewB].forEach(function (b) { b.addEventListener('pointerdown', function (e) { if (document.activeElement === S.el.inp) e.preventDefault(); }); });
    S.el.inp.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;       // 한글 글자를 만드는 중의 Enter 는 글자 확정용이다
      if (e.key === 'Enter') { e.preventDefault(); commit(); S.el.inp.blur(); }
      else if (e.key === 'Escape') { S.el.inp.value = S.barOrig; S.el.inp.blur(); }
    });
    S.ro = global.ResizeObserver ? new ResizeObserver(function () { if (S) schedule(); }) : null;
    if (S.ro) S.ro.observe(S.el.wrap);
    bindPinch(S.el.sc);
    bindLongPress(S.el.wrap);
    bindKeyboard();
  }


  // ============ O-0861(v10.4) 편집 보강: 꾸러미 편집 · 화면 갈아 끼우기 · 계산 · 서식 읽기 ============
  function plusOn() { return !!(S && S.mode === 'patch' && S.ctx.flag && S.ctx.flag('xlsx') && global.SOXlsxStruct && global.SOXlsxUI); }
  function zipPkg(zip) {
    var cache = {};
    return {
      read: function (p) { if (p in cache) return Promise.resolve(cache[p]); var f = zip.file(p); if (!f) return Promise.resolve(null); return f.async('string').then(function (s) { cache[p] = s; return s; }); },
      write: function (p, s) { cache[p] = s; zip.file(p, s, { createFolders: false }); },
      remove: function (p) { delete cache[p]; zip.remove(p); },
      list: function () { return Object.keys(zip.files).filter(function (k) { return !zip.files[k].dir; }); }
    };
  }
  function currentBytes() {
    return global.SOXlsxPatch.finalize(S.zip, S.an, Object.keys(S.patched)).then(function () {
      return S.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    });
  }
  function loadBytes(bytes) {
    var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    var wb = readWorkbook({ ext: 'xlsx' }, buf).wb;
    return global.JSZip.loadAsync(buf, { createFolders: false }).then(function (z) { return global.SOXlsxPatch.analyze(z).then(function (a) { return { wb: wb, zip: z, an: a }; }); });
  }
  function drawTabs(cur) {
    S.el.tabs.innerHTML = S.vis.map(function (i) { return '<button type="button" class="sx-tab' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' + esc(S.names[i]) + '</button>'; }).join('');
  }
  // 새로 읽은 문서로 갈아 끼운다(보던 시트·칸·위치는 그대로)
  function adopt(m) {
    var keepName = S.keepSheet || (S.sh && S.sh.name); S.keepSheet = null; var sc = S.el.sc, st = sc.scrollTop, sl = sc.scrollLeft, sel = { r: S.sel.r, c: S.sel.c }, calcWas = !!(S.calc && S.calc.on);
    S.wb = m.wb; S.names = m.wb.SheetNames; S.vis = visibleSheets(m.wb); S.zip = m.zip; S.an = m.an;
    S.patched = {}; Object.keys((m.an && m.an.sheets) || {}).forEach(function (nm) { S.patched[nm] = 1; });     // 다음 저장 때 시트 XML 을 다시 쓰게(내용은 같다)
    S.fmap = null; S.smap = {}; S.rg = null; S.rangeMode = false; S.finds = null;
    var i = S.names.indexOf(keepName); if (i < 0 || S.vis.indexOf(i) < 0) { i = S.vis[0]; sel = { r: 0, c: 0 }; st = 0; sl = 0; }
    S.sh = prepSheet(i); drawTabs(i); layoutSize();
    S.sel = { r: Math.min(sel.r, S.sh.nr - 1), c: Math.min(sel.c, S.sh.nc - 1) };
    return loadStyles().then(function () {
      if (calcWas) { if (!calcRefresh()) S.calc.on = false; } else calcInit();
      sc.scrollTop = st; sc.scrollLeft = sl; S.lk = null;
      select(S.sel.r, S.sel.c, true); render(true); refreshEd(); if (S.ui) S.ui.refresh(); if (S.chartUi) S.chartUi.reload(); if (S.dataUi) S.dataUi.reload();
    });
  }
  // 문서를 고치는 일 한 번(줄·칸·서식·시트…). mut(pkg) → Promise<{ok}|{err}> — 복사본에서 먼저 해 보고, 되면 화면을 갈아 끼운다.
  function pkgRun(label, mut, onDone, onFail, opts) {
    if (!plusOn() || !S.editing) { S.ctx.toast('먼저 「고치기」를 켜 주십시오.', 2400); return Promise.resolve(false); }
    if (S.el.inp.value !== S.barOrig && !commit(true)) return Promise.resolve(false);
    var cps = S.an && S.an.sheets && S.an.sheets[S.sh.name];
    if (cps && cps.readOnly && !(opts && opts.allowProtected && cps.prot === 'nopw')) { S.ctx.toast(cps.why || '이 시트는 고칠 수 없습니다.', 4200); return Promise.resolve(false); }      // 보호된 시트 등은 보기만
    if (S.busyPkg) return Promise.resolve(false);
    S.busyPkg = true; S.ctx.busy('고치는 중…');
    var before, done = function () { S.busyPkg = false; S.ctx.busy(null); };
    return currentBytes().then(function (b) { before = b; return global.JSZip.loadAsync(b.slice(), { createFolders: false }); }).then(function (z2) {
      return Promise.resolve(mut(zipPkg(z2), z2)).then(function (r) { return { r: r, z: z2 }; });
    }).then(function (x) {
      if (!x.r || x.r.err || x.r.ok === false) { done(); if (onFail) onFail(x.r); else S.ctx.toast((x.r && x.r.err) || '할 수 없습니다.', 5200); return false; }
      return x.z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then(loadBytes).then(function (m) {
        S.undo.push({ pkg: true, bytes: before, label: label }); S.redo = [];
        var pk = 0; for (var k = S.undo.length - 1; k >= 0; k--) if (S.undo[k].pkg && ++pk > 10) { S.undo.splice(0, k + 1); break; }      // 통째 보관은 10번까지만
        if (S.undo.length > UNDO_MAX + 10) S.undo.splice(0, S.undo.length - UNDO_MAX - 10);
        S.pkgOps = (S.pkgOps || 0) + 1;
        return adopt(m).then(function () { done(); syncDirty(); if (onDone) onDone(x.r); return true; });
      });
    }).catch(function (e) { done(); S.ctx.explainFail('고치지 못했습니다', e, 5200); return false; });
  }
  // ---- 서식(styles.xml)을 읽어 그리기에 쓴다 ----
  function loadStyles() {
    S.styles = null; S.smap = {};
    var f = S.zip && S.zip.file('xl/styles.xml'); if (!f || !global.SOXlsxStruct) return Promise.resolve();
    return f.async('string').then(function (x) { var st = new global.SOXlsxStruct.Styles(x); S.styles = st.hasAll ? st : null; }).catch(function () { S.styles = null; });
  }
  function smapOf(name) {
    var psh = S.an && S.an.sheets && S.an.sheets[name]; if (!psh || psh.xml == null) return null;
    var c = S.smap && S.smap[name]; if (c && c.x === psh.xml) return c.m;
    var m = {}, tags = psh.xml.match(/<c\b[^>]*>/g) || [];
    for (var i = 0; i < tags.length; i++) { var r = /\sr="([A-Z]+\d+)"/.exec(tags[i]), s = /\ss="(\d+)"/.exec(tags[i]); if (r && s && s[1] !== '0') m[r[1]] = +s[1]; }
    if (!S.smap) S.smap = {}; S.smap[name] = { x: psh.xml, m: m }; return m;
  }
  function styleAt(sh, r, c) {
    if (!S.styles) return null;
    var m = smapOf(sh.name), s = m && m[addr(r, c)]; return s ? S.styles.resolve(s) : null;
  }
  // ---- 자체 계산기(합계 바로 보이기) ----
  function calcModel() {
    var XLSX = global.XLSX;
    var nm = null; function names() { if (nm) return nm; nm = {}; ((S.wb.Workbook && S.wb.Workbook.Names) || []).forEach(function (x) { if (x && x.Name && x.Sheet == null && !(x.Name in nm)) nm[x.Name] = x.Ref; }); return nm; }
    var now = new Date(), today = Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000) + 25569;     // 오늘 날짜(엑셀 날짜 번호) — TODAY() 계산용
    return { today: today, name: function (n) { return names()[n] || null; }, has: function (n) { return !!S.wb.Sheets[n]; }, cell: function (sh, r, c) { var ws = S.wb.Sheets[sh]; return ws ? ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })] : undefined; } };
  }
  function formulaCells() {
    var out = [], XLSX = global.XLSX;
    S.names.forEach(function (nm) {
      var ws = S.wb.Sheets[nm]; if (!ws) return;
      for (var k in ws) { if (k.charAt(0) === '!' || !Object.prototype.hasOwnProperty.call(ws, k)) continue; var cl = ws[k]; if (cl && cl.f) { var p = XLSX.utils.decode_cell(k); out.push({ sheet: nm, r: p.r + 1, c: p.c + 1 }); } }
    });
    return out;
  }
  function calcInit() {
    S.calc = { on: false, why: '', has: false };
    if (!plusOn() || !global.SOXlsxCalc) return;
    var list = formulaCells(); S.calc.has = list.length > 0;
    if (!list.length) { S.calc.on = true; return; }
    var res = global.SOXlsxCalc.check(calcModel(), list);
    S.calc.on = !!res.ok; S.calc.why = res.ok ? '' : res.why;
  }
  // 모든 수식을 다시 계산해 바뀐 값만 화면과 파일(<v>)에 적는다. 못 하는 수식이 있으면 끄고 false.
  function calcRefresh() {
    if (!S.calc || !S.calc.on) return false;
    var XLSX = global.XLSX, m = calcModel(), list = formulaCells(), upd = {}, i, any = false;
    for (i = 0; i < list.length; i++) {
      var f = list[i], res = global.SOXlsxCalc.run(m, f.sheet, f.r, f.c);
      if (!res || res.t === 'e') { S.calc.on = false; S.calc.why = 'unsupported'; return false; }
      var ws = S.wb.Sheets[f.sheet], a = XLSX.utils.encode_cell({ r: f.r - 1, c: f.c - 1 }), cl = ws[a];
      if (global.SOXlsxCalc.same(res, cl) && cl.w !== '⟳') continue;
      cl.t = res.t; cl.v = res.v;
      cl.w = res.t === 'n' ? XLSX.SSF.format(cl.z && cl.z !== 'General' ? cl.z : 'General', res.v) : res.t === 'b' ? (res.v ? 'TRUE' : 'FALSE') : String(res.v);
      (upd[f.sheet] = upd[f.sheet] || {})[a] = { t: res.t, v: res.v }; any = true;
    }
    if (any && S.an && S.an.sheets) Object.keys(upd).forEach(function (nm) {
      var psh = S.an.sheets[nm]; if (!psh || psh.xml == null) return;
      var r = global.SOXlsxStruct.setCachedValues(psh.xml, upd[nm]); psh.xml = r.xml; S.patched[nm] = 1;
    });
    return true;
  }
  // ---- 범위 ----
  function selRange() { return S.rg ? { r0: S.rg.r0, c0: S.rg.c0, r1: S.rg.r1, c1: S.rg.c1 } : { r0: S.sel.r, c0: S.sel.c, r1: S.sel.r, c1: S.sel.c }; }
  function selectLine(kind, i) {           // 줄 번호·열 글자를 누르면 그 줄/열 전체(쓴 범위까지)를 고른다
    if (!S.editing || !plusOn()) return;
    var sh = S.sh;
    if (kind === 'col') { S.sel = { r: 0, c: i }; S.rg = { r0: 0, r1: Math.max(0, (sh.usedR || 1) - 1), c0: i, c1: i }; }
    else { S.sel = { r: i, c: 0 }; S.rg = { r0: i, r1: i, c0: 0, c1: Math.max(0, (sh.usedC || 1) - 1) }; }
    select(S.sel.r, S.sel.c, true, true); render(true); if (S.ui) S.ui.refresh();
  }
  function startRange() {
    if (!S.editing) return; S.rangeMode = true; S.rgAnchor = { r: S.sel.r, c: S.sel.c };
    S.ctx.toast('범위의 끝 칸을 눌러 주십시오(지금 칸부터 그 칸까지). 줄 번호나 열 글자를 누르면 그 줄·열이 골라집니다.', 3600);
    if (S.ui) S.ui.refresh();
  }
  function clearRange() { S.rg = null; S.rangeMode = false; S.rgAnchor = null; render(true); if (S.ui) S.ui.refresh(); }
  // ---- 찾아 바꾸기 ----
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function replaceOne(h, q, rp) {
    var nm = S.names[h.si], ws = S.wb.Sheets[nm], a = addr(h.r, h.c), cl = ws && ws[a];
    if (!cl || cl.f) return 'skip';
    var cur = barText(cl), nx = cur.replace(new RegExp(escRe(q), 'gi'), function () { return rp; });
    if (nx === cur) return 'skip';
    var res = parseInput(nx, cl, S.ext); if (res.err || res.formula != null) return 'skip';
    var ap = applyRes(nm, h.r, h.c, res); return ap.err ? 'skip' : 'ok';
  }
  function replaceCurrent() {
    if (!S.editing || !S.finds || !S.finds.list.length) { S.ctx.toast('먼저 찾을 말을 쓰고 찾아 주십시오.', 2400); return; }
    var h = S.finds.list[Math.max(0, S.finds.i)], r = replaceOne(h, S.finds.q, S.el.rq.value);
    if (r === 'ok') { syncDirty(); if (S.calc && S.calc.on) calcRefresh(); render(true); refreshEd(); S.ctx.toast('바꿨습니다', 1600); stepFind(1); }
    else S.ctx.toast('이 칸은 바꿀 수 없습니다(수식 칸이거나 바뀌는 것이 없습니다).', 3000);
  }
  function replaceAll() {
    if (!S.editing || !S.finds || !S.finds.list.length) { S.ctx.toast('먼저 찾을 말을 쓰고 찾아 주십시오.', 2400); return; }
    var n = 0, skip = 0, rp = S.el.rq.value, q = S.finds.q;
    S.finds.list.forEach(function (h) { var r = replaceOne(h, q, rp); if (r === 'ok') n++; else skip++; });
    syncDirty(); if (S.calc && S.calc.on) calcRefresh(); S.finds = null; S.el.fcnt.textContent = ''; render(true); refreshEd();
    S.ctx.toast(n + '칸을 바꿨습니다.' + (skip ? ' (' + skip + '칸은 수식이거나 바뀌지 않아 건너뛰었습니다)' : '') + (n > UNDO_MAX ? ' 되돌리기는 마지막 ' + UNDO_MAX + '칸까지입니다.' : ''), 4200);
  }
  function envForUI() {
    return {
      S: function () { return S; }, ctx: S.ctx, toast: function (m, ms) { S.ctx.toast(m, ms); }, addr: addr, colName: colName, esc: esc,
      ensureVisible: ensureVisible, selRange: selRange, startRange: startRange, clearRange: clearRange, pkgRun: pkgRun, commit: commit, select: select, render: render, applyRes: applyRes, parseInput: parseInput,
      syncDirty: syncDirty, refreshEd: refreshEd, calcRefresh: calcRefresh, undoEdit: undoEdit, redoEdit: redoEdit, resetAll: resetAll, leaveEdit: leaveEdit, toggleFind: toggleFind,
      barText: barText, display: display, cellOf: cellOf, plusOn: plusOn, styleAt: styleAt, chartUi: function () { return S && S.chartUi; }, dataUi: function () { return S && S.dataUi; }, gotoSheet: function (n) { var i = S.names.indexOf(n); if (i >= 0 && S.vis.indexOf(i) >= 0 && S.sh.i !== i) showSheet(i); }, roPkg: function () { return zipPkg(S.zip); },
      pkgPeek: function (fn) { return currentBytes().then(function (b) { return global.JSZip.loadAsync(b.slice(), { createFolders: false }); }).then(function (z) { return fn(zipPkg(z)); }); }
    };
  }

  // ---------------- 등록 ----------------
  global.SOffice.register({
    id: 'xlsx', label: '엑셀', editable: true,
    credits: [{ name: 'SheetJS Community Edition 0.18.5', license: 'Apache-2.0', note: '엑셀·CSV 읽기 (https://sheetjs.com)' }, { name: 'JSZip', license: 'MIT', note: '엑셀 파일(zip) 열기·사본 저장 (https://stuk.github.io/jszip/)' }],
    canOpen: function (ext) { return ext === 'xlsx' || ext === 'xls' || ext === 'csv'; },
    open: function (ctx) {
      if (ctx.file && ctx.file.size > MAX_BYTES) { ctx.fallback('파일이 너무 커서(40MB 초과) 변환해서 보여 드립니다.'); return; }
      ctx.loadCss('js/smartoffice/xlsx/so-xlsx.css');
      var isX = ctx.ext === 'xlsx';
      var need = global.XLSX ? Promise.resolve() : ctx.loadScript('vendor/xlsx.full.min.js');
      if (isX) need = need.then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-patch.js'); })
        .then(function () { return global.JSZip ? null : ctx.loadScript('vendor/so/docx/jszip.min.js'); });
      if (isX && ctx.flag && ctx.flag('xlsx')) need = need.then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-struct.js'); }).then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-calc.js'); })
        .then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-ui.js'); }).then(function () { return ctx.flag('chart') ? ctx.loadScript('js/smartoffice/xlsx/so-xlsx-chart.js').catch(function () {}) : null; })
        .then(function () { return ctx.flag('xlsxdata') ? ctx.loadScript('js/smartoffice/xlsx/so-xlsx-pivot.js').then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-data.js'); }).then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-data-ui.js'); }).catch(function () {}) : null; }).catch(function () { /* 못 불러오면 예전 화면으로 연다 */ });
      return need.then(function () { return ctx.file.arrayBuffer(); }).then(function (buf) {
        var res = readWorkbook(ctx, buf), wb = res.wb;
        if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error('시트를 찾지 못했습니다');
        var an = isX ? global.JSZip.loadAsync(buf, { createFolders: false }).then(function (z) { return global.SOXlsxPatch.analyze(z).then(function (a) { return { zip: z, an: a }; }); })
          .catch(function () { return { zip: null, an: { ok: false, reason: '파일 구조를 알아볼 수 없습니다.' } }; }) : Promise.resolve(null);
        return an.then(function (pk) {
          // 스위치 SO_XLSX_DATA 가 꺼져 있으면 피벗·슬라이서가 든 문서는 예전처럼 보기만
          if (isX && pk.an && pk.an.ok && pk.zip && !(ctx.flag && ctx.flag('xlsxdata')) && Object.keys(pk.zip.files).some(function (k) { return /^xl\/(pivotTables|pivotCache|slicers|slicerCaches)\//.test(k); })) pk.an = { ok: false, reason: '피벗표(또는 슬라이서)가 들어 있는 파일입니다.' };
          var reason = lossReason(ctx.ext), mode = '';
          if (isX) {
            if (pk.an.ok) mode = 'patch';
            else reason = pk.an.reason + ' 고쳐서 저장하면 내용이 달라질 수 있어서, 보기만 할 수 있습니다.';
          }
          S = { ctx: ctx, ext: ctx.ext, wb: wb, names: wb.SheetNames, vis: visibleSheets(wb), scale: 1, frz: { row: false, col: false },
            showHdr: hdrPref(), hw: 0, hh: 0, lp: false, lk: null, edits: {}, dirty: false, editing: false, sel: { r: 0, c: 0 }, editable: !reason, noteText: reason, mode: mode,
            zip: pk && pk.zip, an: pk && pk.an, patched: {}, undo: [], redo: [], orig: {}, origRef: {}, fmap: null, finds: null, origBuf: buf, pkgOps: 0, smap: {}, styles: null, calc: { on: false, why: '', has: false } };
          S.hw = S.showHdr ? HDR_W : 0; S.hh = S.showHdr ? HDR_H : 0;
          if (isX && pk.an && pk.an.sheets && !S.noteText && Object.keys(pk.an.sheets).some(function (n) { var q = pk.an.sheets[n]; return q && q.pv && q.pv.length; }))      // v10.9 5회차: 피벗 표가 든 문서도 고칠 수 있게 연다 — 안내 한 줄
            S.noteText = '피벗 표가 든 문서입니다. 피벗 표가 차지한 칸은 직접 고칠 수 없고(「더보기」→「데이터 정리」→「피벗 표」에서 고칩니다), 원본 칸을 고치면 저장한 파일을 엑셀에서 열 때 피벗 숫자가 새로 계산됩니다.';
          build(ctx);
          ctx.onBack(function () { if (S && S.el && S.el.det) { closeDetail(); return true; } return false; });
          refreshActions();
          showSheet(S.vis[0]); refreshEd();
          var after = Promise.resolve();
          if (plusOn()) {
            after = loadStyles().then(function () {
              calcInit(); S.lk = null; render(true); refreshEd(); if (S.ui) S.ui.refresh();
              if (ctx.onSave) { ctx.onSave(function () { if (S && S.editing) askSave(); }); ctx.setSaver(function () { return doSave(true); }); }
              if (ctx.opts && ctx.opts.startEdit && S.editable) startEdit();
            });
          }
          return after;
        });
      });
    },
    cryptChanged: function () { if (S) syncDirty(); },   // 암호만 걸거나 풀어도 「사본 저장」이 켜지게
    exportPdf: function () {                           // v10.8 4회차: 「⋯」→ PDF로 내보내기(워드와 같은 그림 방식, so-xlsx-pdf.js)
      if (!S) return; var ctx = S.ctx;
      ctx.loadScript('js/smartoffice/xlsx/so-xlsx-pdf.js').then(function () {
        if (!global.SOXlsxPdf || !S) throw new Error('PDF 내보내기 부품을 불러오지 못함');
        return global.SOXlsxPdf.run({ ctx: ctx, vis: S.vis, prep: prepSheet, display: display, cellOf: cellOf, styleAt: styleAt, roPkg: function () { return zipPkg(S.zip); }, charts: function (sh) { return S.chartUi && S.chartUi.exportCharts ? S.chartUi.exportCharts(sh) : Promise.resolve([]); } });
      }).catch(function (e) { ctx.toast('PDF 내보내기를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    },
    snapshot: snapshot,
    restore: restore,
    reveal: function (topY) {                           // v10.7 다듬기: 서식 시트를 열어 둔 동안 고른 칸·범위가 시트 밑에 깔리면 화면에 그려진 칸의 실제 위치를 재서 시트 위로 올려 준다
      if (!S || !S.el || !S.sel) return;
      if (!topY) { S.el.sc.style.paddingBottom = ''; return; }      // 시트를 닫으면 덧댄 아래 여백을 되돌린다
      S.el.sc.style.paddingBottom = Math.max(0, Math.round(S.el.sc.getBoundingClientRect().bottom - topY + 10)) + 'px';      // 마지막 줄 근처 칸도 시트 위로 올릴 수 있게 아래 여백을 시트 높이만큼 덧댄다
      var cells = S.el.layer.querySelectorAll('.sx-c.sel,.sx-c.rg'), k, lo = 1e9, hi = -1e9, q, gt = S.el.sc.getBoundingClientRect().top;
      for (k = 0; k < cells.length; k++) { q = cells[k].getBoundingClientRect(); if (q.height > 0) { lo = Math.min(lo, q.top); hi = Math.max(hi, q.bottom); } }
      if (hi < 0) return;
      var d = hi - (topY - 8); if (d <= 0) return;
      d = Math.min(d, Math.max(0, lo - gt - 2));
      if (d > 0) S.el.sc.scrollTop += d;
    },
    _state: function () { return S; },                  // 점검용(시험에서 상태를 들여다본다)
    close: function () {
      if (!S) return;
      try { if (S.ro) S.ro.disconnect(); } catch (e) {}
      try { unbindKeyboard(); } catch (e) {}
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      S = null;
    }
  });
})(window);
