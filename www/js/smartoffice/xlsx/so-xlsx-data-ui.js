/* so-xlsx-data-ui.js — S-Office 엑셀 데이터 도구 화면(O-0861, v10.9 5회차): 피벗 표 · 슬라이서 · 스파크라인 · 부분합 · 통합.
 * 새 도구줄 단추는 없다. 「더보기」→「데이터 정리」 시트 맨 아래의 「분석 도구」 단추들과, 시트 위에 그려지는 슬라이서·스파크라인 그림을 눌러서 쓴다.
 * 실제 문서 고치기는 so-xlsx-pivot.js(피벗·슬라이서)·so-xlsx-data.js(스파크라인·부분합·통합), 화면 갈아 끼우기는 so-xlsx.js(pkgRun). 스위치 SO_XLSX_DATA.
 */
(function (global) {
  'use strict';
  function PV() { return global.SOXlsxPivot; }
  function DT() { return global.SOXlsxData; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function J(w, j) { return global.SOffice && global.SOffice.josa ? global.SOffice.josa(w, j) : w + j; }
  var SPK_COLORS = [['파랑', '376092'], ['빨강', 'C00000'], ['초록', '2E8B57'], ['주황', 'ED7D31'], ['보라', '7030A0'], ['회색', '595959']];
  var NS_SVG = 'http://www.w3.org/2000/svg';

  function create(env) {
    var U = {}, loading = 0, lastKey = '';
    function S() { return env.S(); }
    function X() { return global.XLSX; }
    function toast(m, ms) { env.toast(m, ms || 3000); }
    function wsOf(name) { var wb = S().wb, ws = wb.Sheets[name]; if (ws) return ws; var lc = String(name).toLowerCase(); for (var k in wb.Sheets) if (k.toLowerCase() === lc) return wb.Sheets[k]; return null; }
    function cellAt(ws, r, c) { return ws[X().utils.encode_cell({ r: r, c: c })]; }
    function numOf(cell) { if (!cell) return null; if (typeof cell.v === 'number' && isFinite(cell.v)) return cell.v; if (cell.t === 'n') return null; return null; }
    function addr(r, c) { return env.addr(r, c); }
    function nameNow() { return S().sh.name; }
    function rangeOfSel() { return env.selRange(); }      // 0부터
    function fail(r) {
      var msg = (r && r.err) || '할 수 없습니다.', s = S();
      if (s.ctx.fixAvail && s.ctx.fixAvail()) s.ctx.confirm('폰에서는 하기 어렵습니다', msg + '\n\n엑셀로 고쳐야 하는 일이면 「수정 요청」으로 맡길 수 있습니다.', '수정 요청', function () { s.ctx.requestFix(); }, { cancelLabel: '닫기' });
      else toast(msg, 5200);
    }
    function run(label, mut, ok, after) { return env.pkgRun(label, mut, function (r) { if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 3200); if (after) after(r); }, fail); }
    function chips(body, label, list, get, set, multi) {
      if (label) body.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r'); body.appendChild(row);
      function paint() { [].slice.call(row.children).forEach(function (b, i) { b.classList.toggle('on', multi ? !!get(list[i][0]) : get() === list[i][0]); }); }
      list.forEach(function (o) { var b = el('button', 'sxu-b', o[1]); b.type = 'button'; b.onclick = function () { set(o[0]); paint(); }; row.appendChild(b); });
      paint(); return { row: row, paint: paint };
    }
    function bigBtn(parent, text, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = fn; if (cls === 'on') b.style.gridColumn = '1 / -1'; parent.appendChild(b); return b; }
    function sheetOf(title, body, buttons, extra) { var o = Object.assign({ title: title, body: body, buttons: buttons || [{ label: '닫기' }], wide: true }, extra || {}); S().ctx.sheet(o); }
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
    function targetRegion() {       // 고른 범위 또는 고른 칸 둘레의 표(0부터)
      var s = S(), rg = rangeOfSel(), single = rg.r0 === rg.r1 && rg.c0 === rg.c1;
      if (!single) return rg;
      var ws = wsOf(s.sh.name); if (!ws || !ws['!ref']) return null; var d = X().utils.decode_range(ws['!ref']);
      var x = cellAt(ws, rg.r0, rg.c0); if (!(x && x.v != null && x.v !== '')) return null;
      return regionAround(ws, rg.r0, rg.c0, d.e.r + 1, d.e.c + 1);
    }
    function a1(rg) { return addr(rg.r0, rg.c0) + ':' + addr(rg.r1, rg.c1); }

    // ============================== 분석 도구 단추(데이터 정리 시트 맨 아래) ==============================
    U.addButtons = function (body) {
      body.appendChild(el('div', 'sxu-l', '③ 분석 도구 — 표 요약·칸 속 그래프·소계·합치기'));
      var g = el('div', 'sxu-g');
      function add(t, fn) { var b = el('button', 'sxu-b big', t); b.type = 'button'; b.onclick = function () { S().ctx.closeSheet(); setTimeout(fn, 60); }; g.appendChild(b); }
      add('피벗 표', U.pivotMenu); add('스파크라인', U.sparkSheet); add('부분합', U.subtotalSheet); add('통합', U.consolidateSheet);
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '피벗 표는 표를 항목별로 요약해 새 시트에 보여 줍니다(진짜 엑셀 피벗 표입니다). 슬라이서는 피벗 표 시트의 「피벗 표」에서 만듭니다. 스파크라인은 고른 숫자 칸 옆에 작은 그래프를 넣습니다. 부분합은 같은 값끼리 소계 줄을 끼우고, 통합은 여러 범위를 항목 이름으로 합쳐 새 시트에 적습니다.'));
    };

    // ============================== 피벗 표 ==============================
    function pvPeek() { return PV().listPivots(env.roPkg()); }
    U.pivotMenu = function () {
      var body = el('div', 'sxu'), listBox = el('div', 'sxd-list');
      body.appendChild(listBox); listBox.appendChild(el('div', 'so-sheet-note', '문서 안의 피벗 표를 찾는 중…'));
      var g = el('div', 'sxu-g'); bigBtn(g, '고른 표로 새 피벗 표 만들기', function () { S().ctx.closeSheet(); setTimeout(function () { U.pivotNew(); }, 60); }, 'on'); body.appendChild(g);
      var rg = null; try { rg = targetRegion(); } catch (e) {}
      body.appendChild(el('div', 'so-sheet-note', (rg ? '지금 고른 곳: ' + a1(rg) + '. ' : '') + '표의 칸 하나를 누르거나 「범위」로 표를 고른 뒤 「새 피벗 표 만들기」를 누릅니다. 표의 맨 윗줄은 열 이름이어야 합니다. 피벗 표는 새 시트에 만들고, 원본 표는 건드리지 않습니다.'));
      sheetOf('피벗 표', body);
      pvPeek().then(function (list) {
        listBox.innerHTML = '';
        if (!list.length) { listBox.appendChild(el('div', 'so-sheet-note', '이 문서에는 아직 피벗 표가 없습니다.')); return; }
        var g2 = el('div', 'sxu-g');
        list.forEach(function (pv) { bigBtn(g2, pv.name + ' — ' + pv.sheet + ' 시트' + (pv.editable ? '' : ' (보기만)'), function () { S().ctx.closeSheet(); setTimeout(function () { U.pivotDetail(pv.name); }, 60); }); });
        listBox.appendChild(el('div', 'sxu-l', '이 문서의 피벗 표')); listBox.appendChild(g2);
      }).catch(function () { listBox.innerHTML = ''; });
    };
    function cfgText(pv, names) {
      var c = pv.cfg; if (!c) return pv.why.join(', ') + ' 피벗 표입니다.';
      function nm(i) { return names[i] || ('열' + (i + 1)); }
      return '원본: ' + c.source.sheet + '!' + c.source.ref + '\n행: ' + (c.rows.map(nm).join(', ') || '없음') + ' · 열: ' + (c.cols.map(nm).join(', ') || '없음') + ' · 필터: ' + (c.pages.map(nm).join(', ') || '없음') + '\n값: ' + c.data.map(function (d) { return (d.name || '') || (PV().FN_NAME[d.fn] + ' ' + nm(d.f)); }).join(', ');
    }
    U.pivotDetail = function (name) {
      pvPeek().then(function (list) {
        var pv = null; list.forEach(function (p) { if (p.name === name) pv = p; }); if (!pv) { toast('피벗 표를 찾지 못했습니다.', 3000); return; }
        var names = pv.cache ? pv.cache.fields.map(function (f) { return f.name; }) : [];
        var body = el('div', 'sxu'); body.appendChild(el('div', 'sxu-l', pv.name + ' — ' + pv.sheet + ' 시트(' + pv.t.ref + ')'));
        body.appendChild(el('div', 'so-sheet-note sxd-pre', cfgText(pv, names)));
        var g = el('div', 'sxu-g');
        function add(t, fn, cls) { bigBtn(g, t, function () { S().ctx.closeSheet(); setTimeout(fn, 60); }, cls); }
        if (pv.editable) {
          add('새로 고침', function () { run('피벗 새로 고침', function (pkg) { return PV().refreshPivot(pkg, pv.name); }, function (r) { return '피벗 표를 새로 고쳤습니다(자료 ' + r.nRec + '줄 중 ' + r.nVis + '줄 반영)'; }, function () { U.goto(pv.sheet); }); }, 'on');
          add('필드 고치기', function () { U.pivotEdit(pv); });
          add('슬라이서 만들기', function () { U.slicerNew(pv); });
        }
        add('피벗 표 시트로 가기', function () { U.goto(pv.sheet); });
        if (pv.editable) add('피벗 표 지우기', function () { S().ctx.confirm('피벗 표를 지울까요?', '「' + pv.name + '」와 이 피벗 표의 슬라이서를 지웁니다. 원본 표는 그대로 남고, 지운 뒤에도 ↶ 로 되돌릴 수 있습니다.', '지우기', function () { run('피벗 표 지우기', function (pkg) { return PV().deletePivot(pkg, pv.name); }, '피벗 표를 지웠습니다(되돌리려면 ↶)'); }, { cancelLabel: '취소' }); }, 'danger');
        body.appendChild(g);
        body.appendChild(el('div', 'so-sheet-note', pv.editable ? '새로 고침은 원본 표의 지금 값으로 피벗 숫자를 다시 계산합니다. 원본 칸을 고친 뒤에 누릅니다. 엑셀에서 열어도 열 때 한 번 더 새로 고쳐집니다.' : '이 피벗 표는 폰에서 고칠 수 없는 모양(' + pv.why.join(', ') + ')입니다. 보기와 칸 밖 내용 고치기는 되고, 피벗 숫자는 엑셀에서 열면 자동으로 새로 고쳐집니다.'));
        sheetOf('피벗 표', body);
      });
    };
    U.goto = function (name) { if (env.gotoSheet) env.gotoSheet(name); };
    // 새 피벗: 고른 표 → 편집 시트
    U.pivotNew = function () {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var rg = targetRegion(); if (!rg) { toast('피벗 표로 만들 표를 먼저 골라 주십시오. 표 안의 칸 하나를 누르거나 「범위」로 표를 고릅니다.', 4200); return; }
      if (rg.r1 - rg.r0 < 1) { toast('이름 줄과 자료 줄이 한 줄 이상 있는 범위를 골라 주십시오.', 3600); return; }
      var src = { sheet: s.sh.name, ref: DT().rangeText({ r0: rg.r0 + 1, c0: rg.c0 + 1, r1: rg.r1 + 1, c1: rg.c1 + 1 }) };
      pivotEditor({ mode: 'new', cfg: { source: src, rows: [], cols: [], pages: [], pageSel: {}, hidden: {}, data: [] } });
    };
    U.pivotEdit = function (pv) { pivotEditor({ mode: 'edit', name: pv.name, sheet: pv.sheet, cfg: JSON.parse(JSON.stringify(pv.cfg)) }); };
    function pivotEditor(o) {
      var cfg = o.cfg, FF = null, T = null, body = el('div', 'sxu sxd'), pre = el('div', 'sxd-prev'), secs = el('div'), busy = false;
      body.appendChild(el('div', 'sxu-l', o.mode === 'new' ? '새 피벗 표 — 원본 ' + cfg.source.sheet + '!' + cfg.source.ref : '피벗 표 고치기 — ' + o.name));
      body.appendChild(secs); body.appendChild(el('div', 'sxu-l', '미리 보기(앞부분)')); body.appendChild(pre);
      var nameInp = null;
      if (o.mode === 'new') { body.appendChild(el('div', 'sxu-l', '새 시트 이름')); nameInp = el('input', 'sxu-in wide'); nameInp.type = 'text'; nameInp.maxLength = 28; nameInp.value = uniqueSheet('피벗 표'); nameInp.setAttribute('aria-label', '새 시트 이름'); body.appendChild(nameInp); }
      function uniqueSheet(base) { var s = S(), nm = base, k = 1; while (s.names.some(function (n) { return n.toLowerCase() === nm.toLowerCase(); })) nm = base + ' ' + (++k); return nm; }
      function fnLabel(f) { return PV().FN_NAME[f]; }
      function role(f) { return cfg.rows.indexOf(f) >= 0 ? 'rows' : cfg.cols.indexOf(f) >= 0 ? 'cols' : cfg.pages.indexOf(f) >= 0 ? 'pages' : ''; }
      function limit(k) { return k === 'rows' ? 2 : k === 'cols' ? 1 : 2; }
      function toggleAxis(k, f) {
        var cur = role(f);
        ['rows', 'cols', 'pages'].forEach(function (q) { cfg[q] = cfg[q].filter(function (x) { return x !== f; }); });
        if (cur !== k) { if (cfg[k].length >= limit(k)) { toast((k === 'rows' ? '행' : k === 'cols' ? '열' : '필터') + ' 필드는 ' + limit(k) + '개까지 고를 수 있습니다.', 2800); if (cur) cfg[cur].push(f); return; } cfg[k].push(f); }
        delete cfg.hidden[f]; if (cfg.pageSel) delete cfg.pageSel[f]; refresh();
      }
      function toggleData(f) {
        var i = -1; cfg.data.forEach(function (d, k) { if (d.f === f) i = k; });
        if (i >= 0) cfg.data.splice(i, 1); else { if (cfg.data.length >= 4) { toast('값은 4개까지 고를 수 있습니다.', 2800); return; } cfg.data.push({ f: f, fn: FF.F[f].nNum > FF.F[f].nStr ? 'sum' : 'count' }); }
        refresh();
      }
      function paintSecs() {
        secs.innerHTML = ''; var F = FF.F;
        function section(label, k) {
          secs.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r');
          F.forEach(function (f) { var b = el('button', 'sxu-b' + (role(f.idx) === k ? ' on' : ''), f.name); b.type = 'button'; b.onclick = function () { toggleAxis(k, f.idx); }; row.appendChild(b); }); secs.appendChild(row);
        }
        section('행(왼쪽에 항목으로 늘어놓기 · 최대 2개)', 'rows'); section('열(위쪽에 항목으로 늘어놓기 · 최대 1개)', 'cols');
        secs.appendChild(el('div', 'sxu-l', '값(계산할 숫자 · 최대 4개)')); var vr = el('div', 'sxu-r');
        F.forEach(function (f) { var on = cfg.data.some(function (d) { return d.f === f.idx; }), b = el('button', 'sxu-b' + (on ? ' on' : ''), f.name); b.type = 'button'; b.onclick = function () { toggleData(f.idx); }; vr.appendChild(b); }); secs.appendChild(vr);
        cfg.data.forEach(function (d) {
          var row = el('div', 'sxu-r sxd-fn'); row.appendChild(el('span', 'sxd-fnn', F[d.f].name + ' →'));
          PV().FNS.forEach(function (fn) { var b = el('button', 'sxu-b' + (d.fn === fn[0] ? ' on' : ''), fn[1]); b.type = 'button'; b.onclick = function () { d.fn = fn[0]; d.name = ''; refresh(); }; row.appendChild(b); }); secs.appendChild(row);
        });
        section('필터(위쪽에 고르는 칸 · 최대 2개)', 'pages');
      }
      function refresh() {
        if (!FF) return; paintSecs(); pre.innerHTML = '';
        var bad = !cfg.rows.length ? '행으로 쓸 필드를 하나 이상 골라 주십시오.' : !cfg.data.length ? '값으로 계산할 필드를 하나 이상 골라 주십시오.' : '';
        if (bad) { pre.appendChild(el('div', 'so-sheet-note', bad)); return; }
        try {
          var M = PV().compute(cfg, FF), L = PV().layout(cfg, FF, M), tb = el('table', 'sxd-tbl'), maxR = Math.min(L.h, 10), maxC = Math.min(L.w, 7);
          for (var i = 0; i < maxR; i++) { var tr = el('tr'); for (var j = 0; j < maxC; j++) { var c = L.grid[i][j], td = el(i < L.fdr && c && c.k === 's' ? 'th' : 'td', c && c.k === 'n' ? 'n' : '', c ? (c.k === 'n' ? String(Math.round(c.v * 100) / 100) : c.v) : ''); tr.appendChild(td); } tb.appendChild(tr); }
          var sc = el('div', 'sxd-sc'); sc.appendChild(tb); pre.appendChild(sc);
          pre.appendChild(el('div', 'so-sheet-note', '결과 ' + L.h + '줄 × ' + L.w + '칸' + (L.h > maxR || L.w > maxC ? '(앞부분만 보입니다)' : '') + ' · 자료 ' + FF.nRec + '줄 중 ' + M.nVis + '줄 반영'));
        } catch (e) { pre.appendChild(el('div', 'so-sheet-note', '미리 보기를 만들지 못했습니다: ' + ((e && e.message) || e))); }
      }
      var pkg0 = env.roPkg();
      PV().readTable(pkg0, cfg.source.sheet, cfg.source.ref).then(function (t) {
        if (t.err) { toast(t.err, 5000); return; }
        T = t; FF = PV().buildFields(T); if (FF.err) { toast(FF.err, 5200); return; }
        if (o.mode === 'new') {      // 처음 모양 제안: 글자 열 하나를 행, 숫자 열 하나를 값
          var tx = -1, nu = -1; FF.F.forEach(function (f) { if (tx < 0 && f.nStr >= f.nNum && f.items.length <= 30) tx = f.idx; }); FF.F.forEach(function (f) { if (f.nNum > f.nStr && f.idx !== tx && (nu < 0 || f.items.length > FF.F[nu].items.length)) nu = f.idx; });
          if (tx >= 0) cfg.rows = [tx]; if (nu >= 0) cfg.data = [{ f: nu, fn: 'sum' }];
        }
        S().ctx.sheet({ title: o.mode === 'new' ? '새 피벗 표' : '피벗 표 고치기', body: body, wide: true, buttons: [{ label: '닫기' }, { label: o.mode === 'new' ? '피벗 표 만들기' : '적용', primary: true, onClick: function () { return apply(); } }] });
        refresh();
      }).catch(function (e) { toast('원본 표를 읽지 못했습니다: ' + ((e && e.message) || e), 4200); });
      function apply() {
        if (!cfg.rows.length || !cfg.data.length) { toast('행 필드와 값을 하나 이상 골라 주십시오.', 3000); return false; }
        var c = JSON.parse(JSON.stringify(cfg));
        if (o.mode === 'new') {
          c.newSheet = (nameInp && nameInp.value.trim()) || uniqueSheet('피벗 표'); c.name = 'PivotTable';
          run('피벗 표 만들기', function (pkg) { return PV().createPivot(pkg, c); }, function (r) { return '피벗 표를 만들었습니다(「' + c.newSheet + '」 시트, 자료 ' + r.nRec + '줄 반영)'; }, function (r) { U.goto(c.newSheet); });
        } else {
          run('피벗 표 고치기', function (pkg) { return PV().updatePivot(pkg, o.name, { rows: c.rows, cols: c.cols, pages: c.pages, data: c.data, hidden: c.hidden, pageSel: c.pageSel }); }, '피벗 표를 고쳤습니다', function () { U.goto(o.sheet); });
        }
        return true;
      }
    }

    // ============================== 슬라이서 ==============================
    U.slicerNew = function (pv) {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var c = pv.cache, body = el('div', 'sxu'), g = el('div', 'sxu-g'), box = parseBox(pv.t.ref);
      body.appendChild(el('div', 'sxu-l', '슬라이서로 쓸 필드를 고르십시오(항목이 눌러서 켜고 끄는 단추가 됩니다)'));
      c.fields.forEach(function (f, i) {
        if (!f.labels.length || f.labels.length > 60) return;
        bigBtn(g, f.name + ' (' + f.labels.length + '개)', function () {
          S().ctx.closeSheet();
          setTimeout(function () { run('슬라이서 만들기', function (pkg) { return PV().createSlicer(pkg, pv.name, i, { c: box.c1 + 1, r: Math.max(0, box.r0 - 1) }); }, '슬라이서를 만들었습니다 — 시트에서 항목을 눌러 걸러 보십시오', function () { U.goto(pv.sheet); }); }, 60);
        });
      });
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '슬라이서는 피벗 표 시트의 오른쪽에 생기고, 항목을 누르면 피벗 숫자가 그 항목만으로 다시 계산됩니다. 최소 하나는 켜 두어야 합니다. 엑셀에서도 같은 슬라이서로 보입니다.'));
      sheetOf('슬라이서 만들기', body);
    };
    function parseBox(ref) { var r = PV().parseRange(ref) || { r0: 1, c0: 1, r1: 1, c1: 1 }; return { r0: r.r0 - 1, c0: r.c0 - 1, r1: r.r1 - 1, c1: r.c1 - 1 }; }
    // ---- 시트 위 그림(슬라이서·스파크라인) ----
    function colPx(sh, c) { return c <= sh.nc ? sh.colX[c] : sh.colX[sh.nc] + (c - sh.nc) * 84; }
    function rowPx(sh, r) { return r <= sh.nr ? sh.rowY[r] : sh.rowY[sh.nr] + (r - sh.nr) * 30; }
    function mk(p) { return { c: p.c, r: p.r }; }
    function anchorsOf(pkg, hostPath) {      // 슬라이서 이름 → 그림 틀 자리(0부터)
      var out = {};
      return pkg.read(hostPath.replace(/([^\/]+)$/, '_rels/$1.rels')).then(function (rx) {
        var m = /<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*>/.exec(rx || ''); if (!m) return out;
        var tg = /Target="([^"]*)"/.exec(m[0])[1], parts = hostPath.replace(/[^\/]+$/, '').split('/').filter(Boolean); tg.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); });
        return pkg.read(parts.join('/')).then(function (dx) {
          (dx || '').replace(/<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/g, function (b) {
            var nm = /<sle:slicer\b[^>]*\sname="([^"]*)"/.exec(b); if (!nm) return b;
            function num(re) { var x = re.exec(b); return x ? +x[1] : 0; }
            var f = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(b), t = /<xdr:to>([\s\S]*?)<\/xdr:to>/.exec(b); if (!f || !t) return b;
            function pm(x, tag) { var m2 = new RegExp('<xdr:' + tag + '>(\\d+)</xdr:' + tag + '>').exec(x); return m2 ? +m2[1] : 0; }
            out[nm[1].replace(/&amp;/g, '&')] = { from: { c: pm(f[1], 'col'), co: pm(f[1], 'colOff') / 9525, r: pm(f[1], 'row'), ro: pm(f[1], 'rowOff') / 9525 }, to: { c: pm(t[1], 'col'), co: pm(t[1], 'colOff') / 9525, r: pm(t[1], 'row'), ro: pm(t[1], 'rowOff') / 9525 } };
            return b;
          });
          return out;
        });
      });
    }
    U.reload = function () {
      var s = S(); if (!s || !s.el || !env.roPkg) return; s.dxSl = null; s.dxSp = null; lastKey = ''; var my = ++loading, name = s.sh.name;
      var pkg = env.roPkg(), sl = [], sp = [];
      var p1 = PV() ? PV().listSlicers(pkg).then(function (list) {
        var mine = list.filter(function (x) { return x.hostSheet === name; }); if (!mine.length) return [];
        return anchorsOf(pkg, mine[0].hostSheetPath).then(function (an) { return mine.map(function (x) { return Object.assign({ anchor: an[x.name] || null }, x); }); });
      }) : Promise.resolve([]);
      var p2 = DT() ? DT().listSparklines(pkg, name) : Promise.resolve({ groups: [] });
      Promise.all([p1, p2]).then(function (a) { if (my !== loading || !S()) return; S().dxSl = a[0] || []; S().dxSp = (a[1] && a[1].groups) || []; U.paint(true); }).catch(function () { if (my === loading && S()) { S().dxSl = []; S().dxSp = []; } });
    };
    function sparkValues(rf) {       // 'Sheet!B2:E2' → 숫자 배열(빈 칸 null)
      var m = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(rf); if (!m) return [];
      var sh = m[1] != null ? m[1].replace(/''/g, "'") : m[2], ws = wsOf(sh); if (!ws) return [];
      var c0 = X().utils.decode_col(m[3]), r0 = +m[4] - 1, c1 = m[5] ? X().utils.decode_col(m[5]) : c0, r1 = m[6] ? +m[6] - 1 : r0, out = [], r, c;
      for (r = r0; r <= r1; r++) for (c = c0; c <= c1; c++) out.push(numOf(cellAt(ws, r, c)));
      return out;
    }
    function hex(c, d) { return '#' + ((c || d || '376092').length === 8 ? (c || d).slice(2) : (c || d || '376092')); }
    function sparkSvg(vals, g, w, h) {
      var nums = vals.filter(function (v) { return v != null; }), n = vals.length; if (!nums.length || n < 1) return '';
      var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums), pad = 3, W = Math.max(10, w), H = Math.max(10, h), col = hex(g.colors.series), out = '<svg xmlns="' + NS_SVG + '" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">';
      if (mx === mn) { mx = mn + 1; if (g.type === 'line') mn = mn - 1; }
      function X0(i) { return pad + (n === 1 ? (W - 2 * pad) / 2 : (W - 2 * pad) * i / (n - 1)); }
      function Y0(v) { return H - pad - (H - 2 * pad) * (v - mn) / (mx - mn); }
      var i, firstI = -1, lastI = -1, hiI = -1, loI = -1; vals.forEach(function (v, k) { if (v == null) return; if (firstI < 0) firstI = k; lastI = k; if (hiI < 0 || v > vals[hiI]) hiI = k; if (loI < 0 || v < vals[loI]) loI = k; });
      if (g.axis) { var zy = (mn <= 0 && mx >= 0) ? Y0(0) : null; if (zy != null) out += '<line x1="0" y1="' + zy + '" x2="' + W + '" y2="' + zy + '" stroke="#888" stroke-width="1"/>'; }
      if (g.type === 'line') {
        var d = '', pen = false; vals.forEach(function (v, k) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X0(k).toFixed(1) + ' ' + Y0(v).toFixed(1); pen = true; });
        out += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + Math.max(1.2, (g.lineWeight || 0.75) * 1.6) + '" stroke-linejoin="round"/>';
        vals.forEach(function (v, k) {
          if (v == null) return; var m = g.markers || (g.high && k === hiI) || (g.low && k === loI) || (g.first && k === firstI) || (g.last && k === lastI) || (g.negative && v < 0);
          if (m) out += '<circle cx="' + X0(k).toFixed(1) + '" cy="' + Y0(v).toFixed(1) + '" r="2.4" fill="' + (g.negative && v < 0 ? hex(g.colors.negative) : (g.high && k === hiI) ? hex(g.colors.high) : (g.low && k === loI) ? hex(g.colors.low) : (g.first && k === firstI) ? hex(g.colors.first) : (g.last && k === lastI) ? hex(g.colors.last) : hex(g.colors.markers)) + '"/>';
        });
      } else {
        var bw = Math.max(1.5, (W - 2 * pad) / n * 0.7), zero = g.type === 'stacked' ? H / 2 : Y0(Math.max(mn, Math.min(0, mx)));
        vals.forEach(function (v, k) {
          if (v == null) return; var x = pad + (W - 2 * pad) * (k + 0.5) / n - bw / 2, c2 = (g.negative && v < 0) ? hex(g.colors.negative) : (g.high && k === hiI) ? hex(g.colors.high) : (g.low && k === loI) ? hex(g.colors.low) : (g.first && k === firstI) ? hex(g.colors.first) : (g.last && k === lastI) ? hex(g.colors.last) : col;
          if (g.type === 'stacked') { var hh = (H - 2 * pad) / 2 * 0.9, y = v >= 0 ? H / 2 - hh : H / 2; out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + c2 + '"/>'; }
          else { var yv = Y0(v), y1 = Math.min(yv, zero), hh2 = Math.max(1, Math.abs(yv - zero)); out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh2.toFixed(1) + '" fill="' + c2 + '"/>'; }
        });
      }
      return out + '</svg>';
    }
    U.paint = function (force) {
      var s = S(); if (!s || !s.el || (s.dxSl == null && s.dxSp == null)) return;
      var sl = s.dxSl || [], sp = s.dxSp || [];
      var key = s.sh.i + '|' + s.scale + '|' + sl.map(function (x) { return x.name + ':' + x.items.map(function (i) { return i.sel ? 1 : 0; }).join(''); }).join(',') + '|' + sp.map(function (g) { return g.type + g.items.map(function (it) { return it.f + '>' + it.sqref + '=' + sparkValues(it.f).join(','); }).join(';'); }).join('~');
      if (!force && key === lastKey) return; lastKey = key;
      var host = s.el.dxl; if (!host || !host.isConnected) { host = s.el.dxl = el('div', 'sxd-xl'); s.el.spacer.appendChild(host); }
      host.innerHTML = ''; var k = s.scale, sh = s.sh, maxR = 0, maxB = 0;
      sp.forEach(function (g) {
        g.items.forEach(function (it) {
          var rg = PV().parseRange(it.sqref); if (!rg) return; var vals = sparkValues(it.f);
          var x0 = colPx(sh, rg.c0 - 1) * k, y0 = rowPx(sh, rg.r0 - 1) * k, x1 = colPx(sh, rg.c1) * k, y1 = rowPx(sh, rg.r1) * k;
          var d = el('div', 'sxd-spk'); d.style.left = Math.round(x0) + 'px'; d.style.top = Math.round(y0) + 'px'; d.style.width = Math.round(x1 - x0) + 'px'; d.style.height = Math.round(y1 - y0) + 'px';
          d.innerHTML = sparkSvg(vals, g, Math.round(x1 - x0), Math.round(y1 - y0)); host.appendChild(d);
        });
      });
      sl.forEach(function (x, idx) {
        if (!x.anchor) return; var a = x.anchor, bx = (colPx(sh, a.from.c) + a.from.co) * k, by = (rowPx(sh, a.from.r) + a.from.ro) * k, bw = Math.max(110, ((colPx(sh, a.to.c) + a.to.co) - (colPx(sh, a.from.c) + a.from.co)) * k), bh = Math.max(110, ((rowPx(sh, a.to.r) + a.to.ro) - (rowPx(sh, a.from.r) + a.from.ro)) * k);
        var d = el('div', 'sxd-sl'); d.style.left = Math.round(bx) + 'px'; d.style.top = Math.round(by) + 'px'; d.style.width = Math.round(bw) + 'px'; d.style.height = Math.round(bh) + 'px';
        var hd = el('button', 'sxd-slh', x.caption || x.name); hd.type = 'button'; hd.setAttribute('aria-label', (x.caption || x.name) + ' 슬라이서 메뉴'); hd.onclick = function (e) { e.stopPropagation(); U.slicerMenu(x); };
        d.appendChild(hd); var lst = el('div', 'sxd-sli');
        x.items.forEach(function (it) { var b = el('button', 'sxd-sib' + (it.sel ? ' on' : ''), it.label); b.type = 'button'; b.onclick = function (e) { e.stopPropagation(); U.slicerTap(x, it); }; lst.appendChild(b); });
        d.appendChild(lst); d.addEventListener('click', function (e) { e.stopPropagation(); }); host.appendChild(d);
        maxR = Math.max(maxR, bx + bw + 30); maxB = Math.max(maxB, by + bh + 30);
      });
      var spc = s.el.spacer; if (parseFloat(spc.style.width) < maxR) spc.style.width = Math.round(maxR) + 'px'; if (parseFloat(spc.style.height) < maxB) spc.style.height = Math.round(maxB) + 'px';
    };
    U.slicerTap = function (x, it) {
      var s = S(); if (!s.editing) { toast('슬라이서입니다. 항목을 걸러 보려면 먼저 「고치기」를 켜 주십시오.', 3000); return; }
      var sel = x.items.filter(function (i) { return i.sel; }).map(function (i) { return i.label; }), has = sel.indexOf(it.label) >= 0, next;
      if (has) { next = sel.filter(function (l) { return l !== it.label; }); if (!next.length) { toast('하나는 켜 두어야 합니다. 다른 항목을 먼저 켜 주십시오.', 3000); return; } }
      else next = sel.concat([it.label]);
      run('슬라이서', function (pkg) { return PV().setSlicerSelection(pkg, x.name, next); }, function (r) { return '「' + it.label + '」 항목을 ' + (has ? '껐' : '켰') + '습니다 — 피벗 숫자는 ' + r.shown + '줄로 다시 계산했습니다'; });
    };
    U.slicerMenu = function (x) {
      var s = S(), body = el('div', 'sxu'), g = el('div', 'sxu-g');
      body.appendChild(el('div', 'sxu-l', (x.caption || x.name) + ' 슬라이서 — ' + x.pivot + ' 피벗 표'));
      if (s.editing) {
        bigBtn(g, '모두 켜기', function () { S().ctx.closeSheet(); setTimeout(function () { run('슬라이서', function (pkg) { return PV().setSlicerSelection(pkg, x.name, x.items.map(function (i) { return i.label; })); }, '모든 항목을 켰습니다'); }, 60); }, 'on');
        bigBtn(g, '슬라이서 지우기', function () { S().ctx.closeSheet(); setTimeout(function () { S().ctx.confirm('슬라이서를 지울까요?', '이 슬라이서와 걸어 둔 걸러내기를 지웁니다(피벗 표는 모든 항목으로 돌아갑니다). ↶ 로 되돌릴 수 있습니다.', '지우기', function () { run('슬라이서 지우기', function (pkg) { return PV().deleteSlicer(pkg, x.name); }, '슬라이서를 지웠습니다(되돌리려면 ↶)'); }, { cancelLabel: '취소' }); }, 60); }, 'danger');
      }
      body.appendChild(g); body.appendChild(el('div', 'so-sheet-note', s.editing ? '항목 단추를 누르면 켜고 끕니다(켠 항목만 피벗 숫자에 들어갑니다).' : '고치기를 켜면 항목을 눌러 걸러 볼 수 있습니다.'));
      sheetOf('슬라이서', body);
    };

    // ============================== 스파크라인 ==============================
    function spkAtSel() {         // 고른 범위 안의 스파크라인 묶음
      var s = S(), rg = rangeOfSel(), out = []; (s.dxSp || []).forEach(function (g) { var hit = g.items.some(function (it) { var r = PV().parseRange(it.sqref); return r && !(r.r1 - 1 < rg.r0 || r.r0 - 1 > rg.r1 || r.c1 - 1 < rg.c0 || r.c0 - 1 > rg.c1); }); if (hit) out.push(g); });
      return out;
    }
    U.sparkSheet = function () {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var rg = rangeOfSel(), nm = nameNow(), single = rg.r0 === rg.r1 && rg.c0 === rg.c1, ex = spkAtSel();
      var st = { dir: (rg.c1 - rg.c0) >= (rg.r1 - rg.r0) ? 'row' : 'col', type: 'line', color: '376092', marks: {} }, body = el('div', 'sxu');
      if (ex.length) { st.type = ex[0].type; st.color = (ex[0].colors.series || 'FF376092').slice(2); ['high', 'low', 'first', 'last', 'negative', 'markers'].forEach(function (k) { st.marks[k] = !!ex[0][k]; }); }
      body.appendChild(el('div', 'sxu-l', ex.length ? '고른 칸의 스파크라인(' + ex.reduce(function (a, g) { return a + g.items.length; }, 0) + '개) 모양 바꾸기' : '고른 범위 ' + a1(rg) + (single ? ' — 두 칸 이상 골라 주십시오' : '') + ' 에 스파크라인 넣기'));
      chips(body, '종류', [['line', '꺾은선'], ['column', '막대'], ['stacked', '승패(+/−)']], function () { return st.type; }, function (v) { st.type = v; });
      if (!ex.length) chips(body, '그래프 하나가 되는 방향', [['row', '줄마다(오른쪽 칸에)'], ['col', '열마다(아래 칸에)']], function () { return st.dir; }, function (v) { st.dir = v; });
      chips(body, '색', SPK_COLORS.map(function (c) { return [c[1], c[0]]; }), function () { return st.color; }, function (v) { st.color = v; });
      chips(body, '강조할 점', [['high', '최고점'], ['low', '최저점'], ['first', '첫 점'], ['last', '끝 점'], ['negative', '음수'], ['markers', '모든 점']], function (k) { return !!st.marks[k]; }, function (k) { st.marks[k] = !st.marks[k]; }, true);
      var g = el('div', 'sxu-g');
      if (ex.length) {
        bigBtn(g, '모양 적용', function () { S().ctx.closeSheet(); setTimeout(function () { var cell = (function () { var r = PV().parseRange(ex[0].items[0].sqref); return DT() && r ? addr(r.r0 - 1, r.c0 - 1) : 'A1'; })(); run('스파크라인 모양', function (pkg) { return DT().setSparkGroup(pkg, nm, cell, { type: st.type, color: '#' + st.color, high: !!st.marks.high, low: !!st.marks.low, first: !!st.marks.first, last: !!st.marks.last, negative: !!st.marks.negative, markers: !!st.marks.markers }); }, '스파크라인 모양을 바꿨습니다'); }, 60); }, 'on');
        bigBtn(g, '고른 칸의 스파크라인 지우기', function () { S().ctx.closeSheet(); setTimeout(function () { var cells = []; for (var r = rg.r0; r <= Math.min(rg.r1, rg.r0 + 400); r++) for (var c = rg.c0; c <= Math.min(rg.c1, rg.c0 + 60); c++) cells.push(addr(r, c)); run('스파크라인 지우기', function (pkg) { return DT().removeSparklines(pkg, nm, [DT().rangeText({ r0: rg.r0 + 1, c0: rg.c0 + 1, r1: rg.r1 + 1, c1: rg.c1 + 1 })]); }, function (r) { return '스파크라인 ' + r.n + '개를 지웠습니다(되돌리려면 ↶)'; }); }, 60); }, 'danger');
      } else bigBtn(g, '스파크라인 넣기', function () {
        if (single) { toast('숫자가 든 칸을 두 칸 이상 「범위」로 골라 주십시오.', 3600); return; }
        var items = [], r, c, A = function (q) { return q; };
        if (st.dir === 'row') { for (r = rg.r0; r <= rg.r1; r++) items.push({ f: ref(nm, r, rg.c0, r, rg.c1), sqref: addr(r, rg.c1 + 1) }); }
        else { for (c = rg.c0; c <= rg.c1; c++) items.push({ f: ref(nm, rg.r0, c, rg.r1, c), sqref: addr(rg.r1 + 1, c) }); }
        if (items.length > 200) { toast('스파크라인이 200개를 넘습니다. 범위를 줄여 주십시오.', 3000); return; }
        var spec = { type: st.type, color: '#' + st.color, items: items, high: !!st.marks.high, low: !!st.marks.low, first: !!st.marks.first, last: !!st.marks.last, negative: !!st.marks.negative, markers: !!st.marks.markers };
        S().ctx.closeSheet(); setTimeout(function () { run('스파크라인', function (pkg) { return DT().addSparklines(pkg, nm, spec); }, function (x) { return '스파크라인 ' + x.n + '개를 넣었습니다(' + (st.dir === 'row' ? '범위 오른쪽' : '범위 아래') + ' 칸)'; }); }, 60);
      }, 'on');
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', ex.length ? '고른 칸에 있는 스파크라인의 종류·색·강조할 점을 바꿉니다.' : '고른 범위의 줄마다(또는 열마다) 작은 그래프 하나를 범위 오른쪽(또는 아래) 칸에 넣습니다. 그 칸에 이미 스파크라인이 있으면 새 것으로 바뀌고, 칸 속 글자는 그대로 남습니다. 엑셀에서도 같은 스파크라인으로 보입니다.'));
      sheetOf('스파크라인', body);
    };
    function ref(nm, r0, c0, r1, c1) { var q = /^[A-Za-z_][\w.]*$/.test(nm) && !/^[A-Za-z]{1,3}\d+$/.test(nm) ? nm : "'" + nm.replace(/'/g, "''") + "'"; return q + '!' + addr(r0, c0) + (r0 === r1 && c0 === c1 ? '' : ':' + addr(r1, c1)); }

    // ============================== 부분합 ==============================
    U.subtotalSheet = function () {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var reg = targetRegion(); if (!reg) { toast('표 안의 칸 하나를 누르거나 「범위」로 표를 고른 뒤 열어 주십시오.', 4000); return; }
      var sh = s.sh, ws = wsOf(sh.name), hdr = [], c, r;
      for (c = reg.c0; c <= reg.c1; c++) { var h = cellAt(ws, reg.r0, c); hdr.push([c, h && h.v != null && h.v !== '' ? String(h.v) : addr(0, c).replace(/\d+/, '') + '열']); }
      var numCols = hdr.filter(function (hh) { var n = 0, q; for (q = reg.r0 + 1; q <= reg.r1; q++) if (numOf(cellAt(ws, q, hh[0])) != null) n++; return n > 0; });
      var st = { group: hdr[0][0], fn: 'sum', cols: {} }; if (numCols.length) numCols.forEach(function (hh) { if (hh[0] !== st.group) st.cols[hh[0]] = true; });
      var body = el('div', 'sxu'); body.appendChild(el('div', 'sxu-l', '부분합 — 범위: ' + a1(reg) + '(맨 윗줄은 이름 줄)'));
      var gchips = chips(body, '묶는 기준 열(같은 값끼리 붙어 있어야 합니다)', hdr, function () { return st.group; }, function (v) { st.group = v; delete st.cols[v]; ccp.paint(); });
      var ccp = chips(body, '소계를 낼 열(눌러서 켜고 끕니다)', hdr, function (k) { return !!st.cols[k]; }, function (k) { if (k === st.group) { toast('묶는 기준 열은 소계 열로 쓸 수 없습니다.', 2600); return; } st.cols[k] = !st.cols[k]; }, true);
      chips(body, '계산', PV().FNS.map(function (f) { return [f[0], f[1]]; }), function () { return st.fn; }, function (v) { st.fn = v; });
      var g = el('div', 'sxu-g');
      bigBtn(g, '부분합 넣기', function () {
        var cols = Object.keys(st.cols).filter(function (k) { return st.cols[k]; }).map(Number); if (!cols.length) { toast('소계를 낼 열을 하나 이상 켜 주십시오.', 3000); return; }
        // 기준 열 정렬 확인
        var seen = {}, prev = null, bad = false; for (r = reg.r0 + 1; r <= reg.r1; r++) { var cv = cellAt(ws, r, st.group), k2 = cv && cv.v != null ? String(cv.v) : ''; if (k2 !== prev) { if (seen[k2]) bad = true; seen[k2] = 1; prev = k2; } }
        if (bad) { toast('기준 열의 같은 값이 떨어져 있습니다. 먼저 「정렬」에서 기준 열을 정렬해 주십시오.', 5200); return; }
        var spec = { rg: { r0: reg.r0 + 1, c0: reg.c0 + 1, r1: reg.r1 + 1, c1: reg.c1 + 1 }, groupCol: st.group + 1, fn: st.fn, cols: cols.map(function (q) { return q + 1; }), grand: true };
        S().ctx.closeSheet(); setTimeout(function () { run('부분합', function (pkg) { return DT().addSubtotals(pkg, nameNow(), spec); }, function (x) { return '부분합을 넣었습니다(그룹 ' + x.groups + '개 · 소계·총합계 ' + x.rows + '줄). 엑셀에서 열면 왼쪽 + − 단추로 소계만 접어 볼 수 있습니다(되돌리려면 ↶)'; }); }, 60);
      }, 'on');
      bigBtn(g, '이 범위의 부분합 지우기', function () {
        S().ctx.closeSheet(); setTimeout(function () { S().ctx.confirm('부분합을 지울까요?', '소계·총합계 줄(SUBTOTAL)을 지우고 묶기를 풉니다. 원래 자료 줄은 그대로 남고, ↶ 로 되돌릴 수 있습니다.', '지우기', function () { var rr = { r0: reg.r0 + 1, c0: reg.c0 + 1, r1: reg.r1 + 1, c1: reg.c1 + 1 }; run('부분합 지우기', function (pkg) { return DT().removeSubtotals(pkg, nameNow(), rr); }, function (x) { return '소계 ' + x.removed + '줄을 지웠습니다(되돌리려면 ↶)'; }); }, { cancelLabel: '취소' }); }, 60);
      }, 'danger');
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '기준 열의 값이 바뀔 때마다 그 아래에 「값 합계」 같은 소계 줄을 끼우고, 맨 아래에 총합계 줄을 붙입니다(진짜 SUBTOTAL 수식이라 엑셀에서도 소계로 인식됩니다). 이 범위 아래의 줄은 밀려 내려갑니다. 그림·차트·표가 든 시트에서는 줄을 끼울 수 없어 멈춥니다.'));
      sheetOf('부분합', body);
    };

    // ============================== 통합 ==============================
    U.consolidateSheet = function () {
      var s = S(); if (!s.editing) { toast('먼저 「고치기」를 켜 주십시오.', 2600); return; }
      var st = { srcs: [], fn: 'sum', top: true, left: true, dest: '통합' }, body = el('div', 'sxu'), list = el('div', 'sxd-srcs');
      var names = s.names.filter(function (n, i) { return s.vis.indexOf(i) >= 0; });
      body.appendChild(el('div', 'sxu-l', '합칠 범위(두 개 이상)')); body.appendChild(list);
      function paintList() {
        list.innerHTML = ''; if (!st.srcs.length) list.appendChild(el('div', 'so-sheet-note', '아직 고른 범위가 없습니다.'));
        st.srcs.forEach(function (x, i) { var row = el('div', 'sxd-src'); row.appendChild(el('span', '', x.sheet + '!' + x.ref)); var d = el('button', 'sxd-x', '✕'); d.type = 'button'; d.setAttribute('aria-label', '이 범위 빼기'); d.onclick = function () { st.srcs.splice(i, 1); paintList(); }; row.appendChild(d); list.appendChild(row); });
      }
      var g1 = el('div', 'sxu-g');
      bigBtn(g1, '지금 고른 범위 더하기', function () { var reg = targetRegion(); if (!reg) { toast('시트에서 표의 칸을 누르거나 「범위」를 고른 뒤 눌러 주십시오.', 3600); return; } st.srcs.push({ sheet: nameNow(), ref: a1(reg).replace(/\$/g, '') }); paintList(); });
      body.appendChild(g1);
      body.appendChild(el('div', 'sxu-l', '다른 시트의 범위 더하기')); var row = el('div', 'sxu-r'), sheetSel = names[0]; names.forEach(function (n) { var b = el('button', 'sxu-b' + (n === sheetSel ? ' on' : ''), n); b.type = 'button'; b.onclick = function () { sheetSel = n; [].slice.call(row.children).forEach(function (x) { x.classList.toggle('on', x === b); }); }; row.appendChild(b); }); body.appendChild(row);
      var inp = el('input', 'sxu-in wide'); inp.type = 'text'; inp.placeholder = '범위 직접 쓰기(예: A1:E9)'; inp.setAttribute('aria-label', '범위'); inp.maxLength = 24; body.appendChild(inp);
      var g2 = el('div', 'sxu-g'); bigBtn(g2, '위 시트의 이 범위 더하기', function () { var r = DT().parseRange(inp.value); if (!r) { toast('범위를 「A1:E9」처럼 써 주십시오.', 3000); return; } st.srcs.push({ sheet: sheetSel, ref: DT().rangeText(r) }); inp.value = ''; paintList(); }); body.appendChild(g2);
      chips(body, '계산', PV().FNS.map(function (f) { return [f[0], f[1]]; }), function () { return st.fn; }, function (v) { st.fn = v; });
      chips(body, '항목 이름 위치', [['top', '맨 윗줄'], ['left', '왼쪽 열']], function (k) { return !!st[k]; }, function (k) { st[k] = !st[k]; }, true);
      body.appendChild(el('div', 'sxu-l', '결과를 적을 새 시트 이름')); var di = el('input', 'sxu-in wide'); di.type = 'text'; di.value = '통합'; di.maxLength = 28; di.setAttribute('aria-label', '새 시트 이름'); body.appendChild(di);
      var g3 = el('div', 'sxu-g');
      bigBtn(g3, '합치기', function () {
        if (st.srcs.length < 2) { toast('합칠 범위를 두 개 이상 골라 주십시오.', 3000); return; }
        var nm = di.value.trim() || '통합', k = 1, base = nm; while (s.names.some(function (n) { return n.toLowerCase() === nm.toLowerCase(); })) nm = base + ' ' + (++k);
        S().ctx.closeSheet(); setTimeout(function () { run('통합', function (pkg) { return DT().consolidate(pkg, { sources: st.srcs, fn: st.fn, topRow: st.top, leftCol: st.left, destSheet: nm }); }, function (x) { return '「' + x.sheet + '」 시트에 ' + x.rows + '개 항목을 합쳐 적었습니다(값으로 적었습니다)'; }, function (x) { U.goto(nm); }); }, 60);
      }, 'on'); body.appendChild(g3);
      body.appendChild(el('div', 'so-sheet-note', '같은 이름의 줄·열 값을 골라 계산한 결과를 새 시트에 값으로 적습니다(원본이 바뀌어도 자동으로 바뀌지는 않으니 다시 합쳐 주십시오). 「맨 윗줄」·「왼쪽 열」을 켜면 그 글자를 항목 이름으로 맞춰 합치고, 끄면 같은 위치끼리 합칩니다.'));
      paintList(); sheetOf('통합', body);
    };
    return U;
  }
  global.SOXlsxDataUI = { create: create };
})(window);
