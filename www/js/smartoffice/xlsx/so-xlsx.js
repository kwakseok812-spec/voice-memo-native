/* so-xlsx.js — S-Office 엑셀 모듈 (xlsx · xls · csv 보기, 간단한 값 고치기)
 * 출처·라이선스: 표 읽기·쓰기는 SheetJS Community Edition 0.18.5 (Apache-2.0, https://sheetjs.com, 앱 vendor/xlsx.full.min.js).
 * 화면(가상 스크롤 격자·입력줄·시트 탭)은 이 앱을 위해 새로 짠 것이며, 이음오피스(IeumOffice, Apache-2.0)의
 * 엑셀 부품은 구조 참고만 했고 코드를 가져오지 않았다. AI 기능 없음, 새 권한 없음.
 * 저장 방식(xlsx): SheetJS 로 다시 쓰지 않는다. 원본 zip 을 JSZip(MIT)으로 열어 고친 셀만 해당 시트 XML 에 끼워 넣고(so-xlsx-patch.js),
 * 나머지 파일(서식·차트·그림·정의된 이름·조건부 서식)은 그대로 둔다. 피벗표·매크로가 있거나 보호·특수 구조인 파일/시트/칸은 고치기를 막는다.
 * 옛 xls 는 보기만, csv 는 예전 방식(글자 그대로 사본 저장).
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
    if (ext === 'xls') return '옛 엑셀 파일(xls)은 보기만 할 수 있어요. 고치면 차트·그림이 사라질 수 있어서 막아 뒀어요.';
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
    return { i: i, name: name, ws: ws, nr: nr, nc: nc, colX: colX, rowY: rowY, merges: merges };
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

  function cellDiv(sh, r, c, x, y, w, h, extraCls, lh) {
    var cell = cellOf(sh, r, c), txt = display(cell);
    var sel = (S.sel.r === r && S.sel.c === c) ? ' sel' : '';
    var ed = S.edits[sh.i + '|' + r + '|' + c] ? ' ed' : '';
    var st = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;line-height:' + (lh - 1) + 'px;font-size:' + Math.round(14 * S.scale * 10) / 10 + 'px;';
    if (cell && cell.t === 'n') st += 'text-align:right;'; else if (cell && (cell.t === 'b' || cell.t === 'e')) st += 'text-align:center;';
    var fill = fillOf(cell); if (fill) st += 'background-color:' + fill + ';color:#111;';
    return '<div class="sx-c' + (extraCls || '') + sel + ed + '" style="' + st + '">' + (txt ? esc(txt) : '') + '</div>';
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
  function select(r, c, noRender) {
    var sh = S.sh, m = mergeAt(sh, r, c);
    if (m) { r = m.s.r; c = m.s.c; }
    S.sel = { r: r, c: c };
    var cell = cellOf(sh, r, c);
    S.el.addr.textContent = addr(r, c);
    S.el.inp.value = barText(cell); S.barOrig = S.el.inp.value;
    S.el.inp.readOnly = !(S.editable && S.editing);
    S.el.ok.disabled = !(S.editable && S.editing);
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
    var same = (S.sel.r === tr && S.sel.c === tc);
    // 한글을 치던 중 다른 칸을 누르면, 치던 내용을 먼저 그 칸에 넣어 둔다(값이 사라지지 않게)
    if (!same && S.editable && S.editing && el.inp.value !== S.barOrig) { if (!commit(true)) return false; }
    select(r, c);
    return { same: same };
  }
  function onTap(e) {
    if (S.lp) { S.lp = false; return; }                 // 길게 눌러 상세를 연 뒤의 손 뗌은 무시
    var res = pickAt(e.clientX, e.clientY, e.target);
    if (!res) return;
    // 고치기 중이면 칸을 누르는 즉시 입력줄이 키보드 위로 올라온다
    if (S.editable && S.editing) { try { S.el.inp.focus({ preventScroll: true }); } catch (x2) {} }
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
      if (!S || S.mode !== 'patch') return { err: '이 파일 형식에서는 수식 입력을 지원하지 않아요.' };
      var fx = t.slice(1).trim(), q = 0, dp = 0, i2;
      for (i2 = 0; i2 < fx.length; i2++) { var ch = fx.charAt(i2); if (ch === '"') q ^= 1; else if (!q) { if (ch === '(') dp++; else if (ch === ')') dp--; if (dp < 0) break; } }
      if (!fx || q || dp !== 0) return { err: '수식의 괄호나 따옴표가 맞지 않아요.' };
      var outside = fx.replace(/"[^"]*"/g, '""');
      if (/[;；，（）]/.test(outside) || /[+\-*\/^&,=<>]$/.test(outside) || /,\s*\)|\(\s*,/.test(outside)) return { err: '수식 모양이 이상해요. 쉼표(,)로 구분하고 영어 함수 이름을 써 주세요. 예: =SUM(B2:B5)' };
      var fnr = /([^\s(+\-*\/^&,=<>:!]+)\(/g, fm2;
      while ((fm2 = fnr.exec(outside))) if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(fm2[1]) && !/^'.*'$/.test(fm2[1])) return { err: '함수 이름은 영어로 써 주세요. (예: SUM, AVERAGE, IF)' };
      return { formula: fx };
    }
    if (ext !== 'csv' && old && old.t === 'n' && old.z && XLSX.SSF.is_date(old.z)) {
      var ds = parseDate(t);
      if (ds == null) return { err: '날짜 칸이에요. 「2026-10-09」, 「2026/10/09」, 「10/09/26」(월/일/연), 「2026-10-09 14:30」처럼 적어 주세요.' };
      var dc = { t: 'n', v: ds, z: old.z }; return { cell: dc };
    }
    if (ext !== 'csv' && old && old.t === 's') return { cell: { t: 's', v: txt } };      // 글자 칸은 글자로 둔다(앞자리 0·큰 수 보호)
    var digits = t.replace(/^[-+]/, '');
    if (ext !== 'csv' && /^\d+$/.test(digits)) {
      if (/^0\d/.test(digits) && !(old && old.t === 'n')) return { cell: { t: 's', v: txt } };
      if (digits.length > 15) {
        if (old && old.t === 'n') return { err: '16자리 이상 숫자는 숫자 칸에 정확히 넣을 수 없어요. (글자 칸에는 넣을 수 있어요)' };
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
  // stay=true 이면 아래 칸으로 옮기지 않는다. 넣었거나 바꿀 게 없으면 true, 못 넣었으면 false
  function commit(stay) {
    if (!S.editable || !S.editing) return true;
    var inp = S.el.inp, txt = inp.value;
    if (txt === S.barOrig) return true;
    var sh = S.sh, r = S.sel.r, c = S.sel.c, a = addr(r, c), old = sh.ws[a];
    var res = parseInput(txt, old, S.ext);
    if (res.err) { S.ctx.toast(res.err, 3200); return false; }
    var XLSX = global.XLSX;
    var hadFormula = !!(old && old.f);
    if (S.mode === 'patch') {
      var psh = S.an.sheets[sh.name];
      if (!psh || psh.readOnly) { S.ctx.toast((psh && psh.why) || '이 시트는 고칠 수 없어요.', 3600); return false; }
      var blk = global.SOXlsxPatch.cellBlock(psh, a);
      if (blk) { S.ctx.toast(blk, 4200); return false; }
      var spec = res.formula != null ? { kind: 'f', f: res.formula } : res.empty ? { kind: 'empty' } :
        res.cell.t === 'n' ? { kind: 'n', v: res.cell.v } : res.cell.t === 'b' ? { kind: 'b', v: res.cell.v } : { kind: 's', v: res.cell.v };
      var pr = global.SOXlsxPatch.patchCell(psh.xml, a, spec);
      if (pr.err) { S.ctx.toast(pr.err, 4200); return false; }
      psh.xml = pr.xml; S.patched[sh.name] = 1;
    }
    if (res.formula != null) {
      var fcell = { t: 's', v: '', f: res.formula, w: '⟳' };
      if (old && old.s) fcell.s = old.s;
      sh.ws[a] = fcell;
      var rgf = sh.ws['!ref'] ? XLSX.utils.decode_range(sh.ws['!ref']) : { s: { r: r, c: c }, e: { r: r, c: c } };
      if (r > rgf.e.r) rgf.e.r = r; if (c > rgf.e.c) rgf.e.c = c; if (r < rgf.s.r) rgf.s.r = r; if (c < rgf.s.c) rgf.s.c = c;
      sh.ws['!ref'] = XLSX.utils.encode_range(rgf);
    }
    else if (res.empty) delete sh.ws[a];
    else {
      var cell = res.cell;
      if (cell.t === 'n') cell.w = (cell.z && cell.z !== 'General') ? XLSX.SSF.format(cell.z, cell.v) : String(cell.v);
      else if (cell.t === 's') cell.w = cell.v;
      if (old && old.s) cell.s = old.s;
      sh.ws[a] = cell;
      var rg = sh.ws['!ref'] ? XLSX.utils.decode_range(sh.ws['!ref']) : { s: { r: r, c: c }, e: { r: r, c: c } };
      if (r > rg.e.r) rg.e.r = r; if (c > rg.e.c) rg.e.c = c; if (r < rg.s.r) rg.s.r = r; if (c < rg.s.c) rg.s.c = c;
      sh.ws['!ref'] = XLSX.utils.encode_range(rg);
    }
    S.edits[sh.i + '|' + r + '|' + c] = 1;
    if (!S.dirty) { S.dirty = true; S.ctx.setDirty(true); refreshActions(); }
    if (res.formula != null) S.ctx.toast('수식을 넣었어요. 계산 결과는 엑셀에서 열면 나와요.', 3600);
    else if (hadFormula) S.ctx.toast('수식이 있던 칸이라, 이제 값만 남았어요.', 2600);
    else if (S.ext !== 'csv' && !S.calcToasted) { S.calcToasted = true; S.ctx.toast('이 칸을 쓰는 다른 수식의 결과는 엑셀에서 열면 다시 계산돼요.', 3200); }
    if (!stay && r + 1 < sh.nr) { select(r + 1, c, true); ensureVisible(); }
    else S.barOrig = S.el.inp.value;
    render(true);
    return true;
  }
  function saveCopyNow() {
    var ctx = S.ctx, XLSX = global.XLSX, base = (ctx.name || 'sheet').replace(/\.[^.]+$/, '');
    try {
      if (S.ext === 'csv') {
        var csv = XLSX.utils.sheet_to_csv(S.wb.Sheets[S.names[0]]);
        ctx.saveCopy(new Blob(['﻿' + csv], { type: 'text/csv' }), base + '_수정.csv');
      } else {
        ctx.busy('새 파일 만드는 중…');
        global.SOXlsxPatch.finalize(S.zip, S.an, Object.keys(S.patched)).then(function () {
          return S.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        }).then(function (out) {
          ctx.busy(null);
          if (!S) return;
          ctx.saveCopy(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '_수정.xlsx');
          S.dirty = false; ctx.setDirty(false); refreshActions();
          ctx.toast('새 파일로 저장했어요. 원래 파일은 그대로예요.', 3000);
        }).catch(function (e) { ctx.busy(null); ctx.toast('저장하지 못했어요: ' + ((e && e.message) || e), 4000); });
        return;
      }
      S.dirty = false; ctx.setDirty(false); refreshActions();
      ctx.toast('새 파일로 저장했어요. 원래 파일은 그대로예요.', 3000);
    } catch (e) { ctx.busy(null); ctx.toast('저장하지 못했어요: ' + ((e && e.message) || e), 4000); }
  }
  function askSave() {
    if (!S.editable || !S.editing || !S.dirty) return;
    var msg = S.ext === 'csv'
      ? '고친 값을 새 CSV 파일(원래이름_수정.csv)로 저장해요. 원래 파일은 그대로예요.'
      : '고친 칸 ' + Object.keys(S.edits).length + '개만 바꿔서 새 파일(원래이름_수정.xlsx)로 저장해요. 글꼴·색·차트·그림은 그대로예요. ' +
        '고친 칸을 쓰는 다른 수식의 결과는 엑셀에서 열면 다시 계산돼요. 원래 파일은 그대로예요.';
    S.ctx.confirmCopy('새 파일로 저장할까요?', msg, '저장하기', saveCopyNow);
  }
  function startEdit() {
    if (!S || !S.editable) return;
    S.editing = true; refreshActions(); select(S.sel.r, S.sel.c);
    S.ctx.toast('고치기를 켰어요. 고칠 칸을 누르고 내용을 바꾼 뒤 ✓를 누르세요.', 3600);
  }
  function refreshActions() {
    var list = [];
    if (S.editable && !S.editing) list.push({ label: '고치기', onClick: startEdit });
    else if (S.editable) list.push({ label: '저장', primary: S.dirty, disabled: !S.dirty, onClick: askSave });
    else list.push({ label: '보기 전용', disabled: true, onClick: function () {} });
    S.ctx.setActions(list);
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
    select(0, 0, true); render(true);
  }
  function build(ctx) {
    var root = document.createElement('div'); root.className = 'sx-root';
    var note = S.noteText ? '<div class="sx-note">' + esc(S.noteText) + '</div>' : '';
    root.innerHTML = note +
      '<div class="sx-fbar"><div class="sx-addr">A1</div><input class="sx-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="칸 내용"><button type="button" class="sx-exp" aria-label="칸 내용 크게 보기">⤢</button><button type="button" class="sx-ok" aria-label="입력 확정">✓</button></div>' +
      '<div class="sx-gridwrap">' +
        '<div class="sx-corner"></div><div class="sx-hcol"></div><div class="sx-hrow"></div>' +
        '<div class="sx-scroll"><div class="sx-spacer"><div class="sx-layer"></div></div></div>' +
        '<div class="sx-fz sx-fr" style="display:none"></div><div class="sx-fz sx-fc" style="display:none"></div><div class="sx-fz sx-fx" style="display:none"></div>' +
      '</div>' +
      '<div class="sx-bottom"><div class="sx-tools sx-tabrow"><div class="sx-tabs"></div></div>' +
      '<div class="sx-tools sx-toolrow"><button type="button" class="sx-chip sx-zoom" data-z="-" aria-label="축소">−</button><span class="sx-pct">100%</span><button type="button" class="sx-chip sx-zoom" data-z="+" aria-label="확대">＋</button>' +
        '<button type="button" class="sx-chip" data-f="fit">화면에 맞춤</button>' +
        '<button type="button" class="sx-chip' + (S.showHdr ? ' on' : '') + '" data-f="hdr" aria-pressed="' + S.showHdr + '">머리글 표시</button>' +
        '<button type="button" class="sx-chip" data-f="row">첫 행 고정</button><button type="button" class="sx-chip" data-f="col">첫 열 고정</button></div></div>';
    ctx.body.appendChild(root);
    var q = function (s) { return root.querySelector(s); };
    S.el = { root: root, addr: q('.sx-addr'), inp: q('.sx-input'), ok: q('.sx-ok'), wrap: q('.sx-gridwrap'), corner: q('.sx-corner'), hcol: q('.sx-hcol'), hrow: q('.sx-hrow'),
      sc: q('.sx-scroll'), spacer: q('.sx-spacer'), layer: q('.sx-layer'), fr: q('.sx-fr'), fc: q('.sx-fc'), fx: q('.sx-fx'), tabs: q('.sx-tabs'), pct: q('.sx-pct') };
    S.el.tabs.innerHTML = S.vis.map(function (i) { return '<button type="button" class="sx-tab" data-i="' + i + '">' + esc(S.names[i]) + '</button>'; }).join('');
    S.el.tabs.addEventListener('click', function (e) { var b = e.target.closest('.sx-tab'); if (b) showSheet(+b.getAttribute('data-i')); });
    root.addEventListener('click', function (e) {
      var z = e.target.closest('[data-z]'), f = e.target.closest('[data-f]');
      if (z) setScale(S.scale * (z.getAttribute('data-z') === '+' ? 1.25 : 0.8));
      else if (f) {
        var k = f.getAttribute('data-f');
        if (k === 'fit') setScale(fitScale());
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
    S.el.ok.onclick = function () { commit(); };
    S.el.exp = q('.sx-exp'); S.el.exp.onclick = openDetail;
    // 단추를 눌러도 입력줄의 키보드가 내려가지 않게(한글을 치다가 끊기지 않게)
    [S.el.ok, S.el.exp].forEach(function (b) { b.addEventListener('pointerdown', function (e) { if (document.activeElement === S.el.inp) e.preventDefault(); }); });
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

  // ---------------- 등록 ----------------
  global.SOffice.register({
    id: 'xlsx', label: '엑셀', editable: true,
    credits: [{ name: 'SheetJS Community Edition 0.18.5', license: 'Apache-2.0', note: '엑셀·CSV 읽기 (https://sheetjs.com)' }, { name: 'JSZip', license: 'MIT', note: '엑셀 파일(zip) 열기·사본 저장 (https://stuk.github.io/jszip/)' }],
    canOpen: function (ext) { return ext === 'xlsx' || ext === 'xls' || ext === 'csv'; },
    open: function (ctx) {
      if (ctx.file && ctx.file.size > MAX_BYTES) { ctx.fallback('파일이 너무 커서(40MB 초과) 변환해서 보여 드려요.'); return; }
      ctx.loadCss('js/smartoffice/xlsx/so-xlsx.css');
      var isX = ctx.ext === 'xlsx';
      var need = global.XLSX ? Promise.resolve() : ctx.loadScript('vendor/xlsx.full.min.js');
      if (isX) need = need.then(function () { return ctx.loadScript('js/smartoffice/xlsx/so-xlsx-patch.js'); })
        .then(function () { return global.JSZip ? null : ctx.loadScript('vendor/so/docx/jszip.min.js'); });
      return need.then(function () { return ctx.file.arrayBuffer(); }).then(function (buf) {
        var res = readWorkbook(ctx, buf), wb = res.wb;
        if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error('시트를 찾지 못했어요');
        var an = isX ? global.JSZip.loadAsync(buf, { createFolders: false }).then(function (z) { return global.SOXlsxPatch.analyze(z).then(function (a) { return { zip: z, an: a }; }); })
          .catch(function () { return { zip: null, an: { ok: false, reason: '파일 구조를 알아볼 수 없어요.' } }; }) : Promise.resolve(null);
        return an.then(function (pk) {
          var reason = lossReason(ctx.ext), mode = '';
          if (isX) {
            if (pk.an.ok) mode = 'patch';
            else reason = pk.an.reason + ' 고쳐서 저장하면 내용이 달라질 수 있어서, 보기만 할 수 있어요.';
          }
          S = { ctx: ctx, ext: ctx.ext, wb: wb, names: wb.SheetNames, vis: visibleSheets(wb), scale: 1, frz: { row: false, col: false },
            showHdr: hdrPref(), hw: 0, hh: 0, lp: false, lk: null, edits: {}, dirty: false, editing: false, sel: { r: 0, c: 0 }, editable: !reason, noteText: reason, mode: mode,
            zip: pk && pk.zip, an: pk && pk.an, patched: {} };
          S.hw = S.showHdr ? HDR_W : 0; S.hh = S.showHdr ? HDR_H : 0;
          build(ctx);
          ctx.onBack(function () { if (S && S.el && S.el.det) { closeDetail(); return true; } return false; });
          refreshActions();
          showSheet(S.vis[0]);
        });
      });
    },
    close: function () {
      if (!S) return;
      try { if (S.ro) S.ro.disconnect(); } catch (e) {}
      try { unbindKeyboard(); } catch (e) {}
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      S = null;
    }
  });
})(window);
