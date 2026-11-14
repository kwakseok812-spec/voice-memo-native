/* ============================================================================
 * so-hwp-tools.js — S-Office 한글 편집 보강(O-0861, v10.3): 표 만들기 · 줄/칸 지우기와 줄 넣기 · 그림 넣기 · 글자 색 · 문단 넣기 · 맥락 도구줄
 * ----------------------------------------------------------------------------
 * so-hwp.js 가 스위치(SO_HWP_TOOLS)가 켜졌을 때만 불러온다. 외부 부품 없음 — 이미 들어 있는 한글 편집 화면(rhwp 스튜디오)의 명령을 폰용 단추·시트로 대신 누른다.
 *   · 표 만들기: 스튜디오의 표 만들기 팝업(칸 16px)과 「표 만들기…」 숫자 상자를 코드가 대신 눌러 줄·칸 수를 넣는다(화면에는 안 보이게).
 *   · 그림 넣기: 폰의 사진 고르기 → 1600px 안으로 줄임 → 스튜디오의 그림 넣기 명령에 파일을 대신 건네고 「자리 한 번 누르기」 → 곧바로 「글자처럼 취급」으로 바꿔 글을 가리지 않게 한다.
 *   · 칸(열) 추가: 엔진의 「칸 추가」는 표를 종이 밖으로 내보내므로, 편집 화면이 허용하는 확장 명령(ext: 접두사, rhwpStudio.automation.registerCommand)을 이 파일이 직접 등록해
 *     「칸 추가 → 표 전체 폭을 쪽 본문 폭에 맞춰 각 칸을 비례 축소」를 한 번의 되돌리기 단위로 한다. 같은 방식으로 칸 합치기(폰에서 첫 칸·끝 칸을 눌러 고르기),
 *     문단 위·아래 넣기·문단 지우기, 쪽 번호·머리말(엔진의 머리말·꼬리말 마당)을 넣는다. 외부 코드는 들이지 않는다.
 * 한 줄 단추 수(숫자): 접은 폰(<640px) 6 + 더보기 · 펼친 화면(<900px) 10 + 더보기 · DeX(≥900px) 12 + 더보기. 가로 밀기는 쓰지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // 「로/으로」: 마지막 글자에 받침이 없거나 ㄹ 받침이면 「로」, 그 밖의 받침은 「으로」 (보라→로, 검정→으로, 초록→으로)
  function roJosa(word) {
    var c = String(word || '').slice(-1).charCodeAt(0) - 0xAC00;
    if (!(c >= 0 && c < 11172)) return '으로';
    var jong = c % 28; return (jong === 0 || jong === 8) ? '로' : '으로';
  }

  // 맥락별 단추 순서(쓰는 빈도 순). 앞에서부터 한 줄에 들어가는 만큼 보이고 나머지는 「더보기」 시트로 간다.
  var ORDER = {
    text: ['undo', 'bold', 'sizeUp', 'color', 'table', 'pic', 'redo', 'italic', 'underline', 'sizeDown', 'alignL', 'alignC', 'alignR', 'alignJ', 'paraBelow', 'paraAbove', 'paraDel', 'hf', 'zoomOut', 'zoomIn', 'zoomFit', 'find'],
    table: ['undo', 'rowBelow', 'colRight', 'rowDel', 'colDel', 'cellMerge', 'bold', 'color', 'rowAbove', 'colLeft', 'cellSplit', 'tableDel', 'redo', 'italic', 'underline', 'sizeUp', 'sizeDown', 'alignL', 'alignC', 'alignR', 'alignJ', 'pic', 'zoomOut', 'zoomIn', 'zoomFit', 'find'],
    pic: ['undo', 'picDel', 'redo', 'zoomOut', 'zoomIn', 'zoomFit']
  };
  var COLORS = [['검정', '#000000'], ['빨강', '#e02020'], ['파랑', '#1c5fd6'], ['초록', '#1b8a3a'], ['주황', '#ee7a00'], ['보라', '#7a3fc4'], ['회색', '#777777']];

  // ============ 편집 화면 안에서 도는 확장 명령 ============
  // 아래 함수들은 편집 화면(rhwp 스튜디오)의 「확장 명령」으로 등록돼 그 안에서 실행된다. a = 스튜디오 서비스(a.wasm = 문서 엔진, a.getInputHandler() = 커서·되돌리기).
  // 문서를 바꾸는 일은 모두 executeOperation({kind:'snapshot'}) 한 번에 담아 「취소」 한 번으로 되돌아간다.
  function inCell(t) { return t.parentParaIndex !== undefined && t.controlIndex !== undefined && t.cellIndex !== undefined; }
  var EXT = {
    // 칸 추가 + 표 폭을 쪽 본문 폭에 맞춤. args.side = 'left' | 'right'
    colAdd: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false, why: 'nohandler' };
      var t = h.getCursorPosition(); if (!inCell(t)) return { ok: false, why: 'notable' };
      var d = a.wasm, S = t.sectionIndex, P = t.parentParaIndex, C = t.controlIndex;
      var info = d.getCellInfo(S, P, C, t.cellIndex), pd = d.getPageDef(S), avail = pd.width - pd.marginLeft - pd.marginRight - (pd.marginGutter || 0);
      var res = { ok: true, avail: avail, cols: 0, fit: false, minW: 0, over: false };
      h.executeOperation({ kind: 'snapshot', operationType: 'insertTableColumn', operation: function (i) {
        i.insertTableColumn(S, P, C, info.col, args.side === 'right');
        var tw = i.getTableProperties(S, P, C).tableWidth; res.cols = i.getTableDimensions(S, P, C).colCount; res.before = tw;
        if (tw > avail + 20) {
          var bb = i.getTableCellBboxes(S, P, C), k = avail / tw, ups = [], seen = {}, min = 1e9;
          bb.forEach(function (b) {
            if (seen[b.cellIdx]) return; seen[b.cellIdx] = 1;
            var w = i.getCellProperties(S, P, C, b.cellIdx).width, nw = Math.floor(w * k);
            ups.push({ cellIdx: b.cellIdx, widthDelta: nw - w }); if (b.colSpan === 1 && nw < min) min = nw;
          });
          try { i.resizeTableCells(S, P, C, ups); res.fit = true; } catch (e) { res.fitErr = String((e && e.message) || e); }
          res.minW = min === 1e9 ? 0 : min;
        }
        res.after = i.getTableProperties(S, P, C).tableWidth; res.over = res.after > avail + 40;
        return t;
      } });
      return res;
    },
    // 커서가 있는 칸의 자리(칸 합치기용)
    cellPos: function (a) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (!inCell(t)) return { ok: false };
      var i = a.wasm.getCellInfo(t.sectionIndex, t.parentParaIndex, t.controlIndex, t.cellIndex);
      return { ok: true, tbl: t.sectionIndex + ':' + t.parentParaIndex + ':' + t.controlIndex, row: i.row, col: i.col, rs: i.rowSpan || 1, cs: i.colSpan || 1 };
    },
    // 처음 칸(args.a)과 지금 칸 사이를 한 칸으로 합침
    cellMerge: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (!inCell(t)) return { ok: false, why: 'notable' };
      var S = t.sectionIndex, P = t.parentParaIndex, C = t.controlIndex, A = args.a, i0 = a.wasm.getCellInfo(S, P, C, t.cellIndex);
      if (A.tbl !== S + ':' + P + ':' + C) return { ok: false, why: 'othertable' };
      var r0 = Math.min(A.row, i0.row), c0 = Math.min(A.col, i0.col), r1 = Math.max(A.row + A.rs - 1, i0.row + (i0.rowSpan || 1) - 1), c1 = Math.max(A.col + A.cs - 1, i0.col + (i0.colSpan || 1) - 1);
      h.executeOperation({ kind: 'snapshot', operationType: 'mergeTableCells', operation: function (i) { i.mergeTableCells(S, P, C, r0, c0, r1, c1); return h.getCursorPosition(); } });
      return { ok: true, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
    },
    // 문단 넣기: args.where = 'below' | 'above' (글 본문에서만)
    paraAdd: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var S = t.sectionIndex, P = t.paragraphIndex, d = a.wasm, below = args.where !== 'above';
      var at = below ? d.getParagraphLength(S, P) : 0, np = below ? P + 1 : P;
      h.executeOperation({ kind: 'snapshot', operationType: 'splitParagraph', operation: function (i) { i.splitParagraph(S, P, at); return { sectionIndex: S, paragraphIndex: np, charOffset: 0 }; } });
      return { ok: true };
    },
    // 문단 지우기: 표·그림 같은 개체가 든 문단은 글만 비운다(개체를 잃지 않게)
    paraDel: function (a) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var S = t.sectionIndex, P = t.paragraphIndex, d = a.wasm, n = d.getParagraphCount(S), len = d.getParagraphLength(S, P);
      var ctl = 0; try { ctl = (d.getControlTextPositions(S, P) || []).length; } catch (e) { ctl = 1; }
      var res = { ok: true, cleared: false };
      if (ctl > 0 || n <= 1) {
        if (len === 0) return { ok: false, why: ctl > 0 ? 'hasobj' : 'only' };
        h.executeOperation({ kind: 'snapshot', operationType: 'deleteText', operation: function (i) { i.deleteText(S, P, 0, len); return { sectionIndex: S, paragraphIndex: P, charOffset: 0 }; } });
        res.cleared = true; res.why = ctl > 0 ? 'hasobj' : 'only'; return res;
      }
      h.executeOperation({ kind: 'snapshot', operationType: 'deleteParagraph', operation: function (i) {
        if (len > 0) i.deleteText(S, P, 0, len);
        if (P > 0) { var pl = i.getParagraphLength(S, P - 1); i.mergeParagraph(S, P); return { sectionIndex: S, paragraphIndex: P - 1, charOffset: pl }; }
        i.mergeParagraph(S, P + 1); return { sectionIndex: S, paragraphIndex: 0, charOffset: 0 };
      } });
      return res;
    },
    // 지금의 쪽 번호·머리말 상태
    hfInfo: function (a) {
      var d = a.wasm, S = a.getInputHandler().getCursorPosition().sectionIndex, out = { ok: true, header: '', hasHeader: false, hasFooter: false };
      try { var hh = d.getHeaderFooter(S, true, 0); hh = typeof hh === 'string' ? JSON.parse(hh) : hh; if (hh && hh.exists) { out.hasHeader = true; out.header = hh.text || ''; } } catch (e) {}
      try { var ff = d.getHeaderFooter(S, false, 0); ff = typeof ff === 'string' ? JSON.parse(ff) : ff; if (ff && ff.exists) out.hasFooter = true; } catch (e) {}
      return out;
    },
    // 쪽 번호(아래쪽 꼬리말 마당): args.pos = 'none' | 'left' | 'center' | 'right'
    hfPageNum: function (a, args) {
      var h = a.getInputHandler(), d = a.wasm, pos0 = h.getCursorPosition(), n = d.getSectionCount(), map = { left: 1, center: 2, right: 3 };
      h.executeOperation({ kind: 'snapshot', operationType: 'applyHfTemplate', operation: function (i) {
        for (var s = 0; s < n; s++) {
          if (args.pos === 'none') { try { i.deleteHeaderFooter(s, false, 0); } catch (e) {} } else i.applyHfTemplate(s, false, 0, map[args.pos] || 2);
        }
        return pos0;
      } });
      return { ok: true };
    },
    // 머리말 글(위쪽): args.text 가 비면 머리말을 없앰. args.align = 'left' | 'center' | 'right'
    hfHeader: function (a, args) {
      var h = a.getInputHandler(), d = a.wasm, pos0 = h.getCursorPosition(), n = d.getSectionCount(), text = String(args.text || '').replace(/\s+/g, ' ').trim();
      h.executeOperation({ kind: 'snapshot', operationType: 'headerText', operation: function (i) {
        for (var s = 0; s < n; s++) {
          try { i.deleteHeaderFooter(s, true, 0); } catch (e) {}
          if (!text) continue;
          i.createHeaderFooter(s, true, 0); i.insertTextInHeaderFooter(s, true, 0, 0, 0, text);
          i.applyParaFormatInHf(s, true, 0, 0, JSON.stringify({ alignment: args.align === 'left' || args.align === 'right' ? args.align : 'center' }));
        }
        return pos0;
      } });
      return { ok: true, cleared: !text };
    }
  };

  function create(env) {
    var T = { mode: 'text', info: {}, perRow: 0, busyAuto: false, picWait: false, extRes: null };
    var ST = function () { return env.st(); };
    var ed = function () { return ST() && ST().editor; };
    var doc = function () { return env.doc(); };
    var win = function () { var d = doc(); return d && d.defaultView; };
    var toast = function (m, ms) { env.ctx.toast(m, ms || 2600); };

    // ---- 스튜디오 화면 손대기 ----
    function setV(i, v) {
      var w = win(), s = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
      s.call(i, String(v)); i.dispatchEvent(new w.Event('input', { bubbles: true })); i.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    function hide(on) { var d = doc(); if (d && d.body) d.body.classList.toggle('so-auto', !!on); }      // 스튜디오가 잠깐 띄우는 PC용 팝업·상자를 가린다(so-hwp.js 가 CSS를 넣어 둔다)
    function waitFor(fn, ms, step) {
      return new Promise(function (res) {
        var t0 = Date.now();
        (function tick() { var v; try { v = fn(); } catch (e) { v = null; } if (v) return res(v); if (Date.now() - t0 > ms) return res(null); setTimeout(tick, step || 80); })();
      });
    }
    function modal() { var d = doc(); return d && d.querySelector('.modal-overlay'); }
    function closeModal() { var m = modal(); if (!m) return; var b = [].slice.call(m.querySelectorAll('button')).filter(function (x) { return /^(취소|닫기|×)$/.test(x.textContent.trim()); })[0]; if (b) b.click(); }
    function ctxInfo() { return ed().commands.context().catch(function () { return {}; }); }

    // ---- 편집 화면 확장 명령 부르기 ----
    function ensureExt() {
      var w = win(), au = w && w.rhwpStudio && w.rhwpStudio.automation; if (!au) return false;
      if (T.extFor === au) return true;
      Object.keys(EXT).forEach(function (k) {
        var id = 'ext:so-' + k; try { au.unregisterCommand(id); } catch (e) {}
        au.registerCommand({ id: id, label: k, canExecute: function () { return true; }, execute: function (a, args) { try { T.extRes = EXT[k](a, args || {}); } catch (e) { T.extRes = { ok: false, why: 'error', msg: String((e && e.message) || e) }; } } });
      });
      T.extFor = au; return true;
    }
    function runExt(k, args) {
      if (!ensureExt()) return Promise.resolve({ ok: false, why: 'noext' });
      T.extRes = null;
      return ed().commands.execute('ext:so-' + k, args || {}).then(function () { var r = T.extRes; T.extRes = null; return r || { ok: false, why: 'empty' }; }, function () { return { ok: false, why: 'rejected' }; });
    }

    // ---- 표 만들기 ----
    function createTable(rows, cols) {
      if (T.busyAuto) return Promise.resolve(false);
      T.busyAuto = true; hide(true);
      var d = doc(), failed = false;
      return ctxInfo().then(function (c) {
        if (c.inTable) { failed = '이미 표 안입니다. 표 밖(글을 쓰는 곳)을 눌러 주십시오.'; return null; }
        ed().commands.execute('table:create', {}, { allowDialog: true }).catch(function () {});
        return waitFor(function () {      // 칸 고르기 팝업: 몸통 맨 끝의 떠 있는 상자, 세 번째 줄이 「표 만들기…」
          var k = d.body.children, p = k[k.length - 1];
          return p && p.children && p.children.length >= 3 && /표 만들기/.test(p.children[2].textContent) ? p : null;
        }, 3000);
      }).then(function (pop) {
        if (failed) return null;
        if (!pop) { failed = '표 만들기를 열지 못했습니다.'; return null; }
        pop.children[2].click();
        return waitFor(function () { var m = modal(); return m && m.querySelectorAll('input.dialog-input').length >= 2 && [].slice.call(m.querySelectorAll('button')).some(function (b) { return b.textContent === '만들기'; }) ? m : null; }, 3000);
      }).then(function (m) {
        if (failed) return null;
        if (!m) { failed = '표 만들기 상자를 열지 못했습니다.'; return null; }
        var ins = m.querySelectorAll('input.dialog-input'); setV(ins[0], rows); setV(ins[1], cols);
        [].slice.call(m.querySelectorAll('button')).filter(function (b) { return b.textContent === '만들기'; })[0].click();
        return waitFor(function () { return !modal(); }, 3000).then(function () { return sleep(250); }).then(ctxInfo);
      }).then(function (c) {
        if (!failed && !(c && c.inTable)) failed = '표가 만들어졌는지 확인하지 못했습니다.';
      }).catch(function (e) { failed = (e && e.message) || '알 수 없는 오류'; }).then(function () {
        if (failed) { try { closeModal(); var k = d.body.children, p = k[k.length - 1]; if (p && p.firstChild && /취소/.test(p.firstChild.textContent)) p.firstChild.querySelector('button').click(); } catch (e) {} }
        hide(false); T.busyAuto = false;
        if (failed) { toast('표를 만들지 못했습니다 — ' + failed, 4200); return false; }
        env.markDirty(); toast('표를 만들었습니다(' + rows + '×' + cols + ')', 2600); T.sync(true); return true;
      });
    }
    function tableSheet() {
      if (T.info.inTable) { toast('이미 표 안입니다. 표 밖(글을 쓰는 곳)을 눌러 주십시오.', 3200); return; }
      var rows = 3, cols = 3, body = el('div'), prev = el('div', 'so-tbl-prev');
      function stepper(label, get, set, min, max) {
        var row = el('div', 'so-step'); row.appendChild(el('span', 'so-step-l', label));
        var minus = el('button', 'so-step-b', '－'), val = el('b', 'so-step-v'), plus = el('button', 'so-step-b', '＋');
        minus.type = plus.type = 'button'; minus.setAttribute('aria-label', label + ' 줄이기'); plus.setAttribute('aria-label', label + ' 늘리기');
        function draw() { val.textContent = get(); minus.disabled = get() <= min; plus.disabled = get() >= max; drawPrev(); }
        minus.onclick = function () { set(get() - 1); draw(); }; plus.onclick = function () { set(get() + 1); draw(); };
        row.appendChild(minus); row.appendChild(val); row.appendChild(plus); draw(); return row;
      }
      function drawPrev() {
        prev.innerHTML = ''; prev.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)';
        var n = Math.min(rows, 8) * cols; for (var i = 0; i < n; i++) prev.appendChild(el('i'));
        if (rows > 8) prev.appendChild(el('s', '', '… ' + rows + '줄'));
      }
      body.appendChild(stepper('줄', function () { return rows; }, function (v) { rows = v; }, 1, 40));
      body.appendChild(stepper('칸', function () { return cols; }, function (v) { cols = v; }, 1, 12));
      body.appendChild(prev); drawPrev();
      body.appendChild(el('div', 'so-sheet-note', '글을 쓰던 자리에 표가 들어갑니다. 칸 너비는 종이 폭에 맞춰집니다.'));
      env.ctx.sheet({
        title: '표 만들기', body: body,
        buttons: [{ label: '취소' }, { label: '표 만들기', primary: true, onClick: function () { setTimeout(function () { createTable(rows, cols); }, 60); return true; } }]
      });
    }

    // ---- 글자 색 ----
    function colorSheet() {
      var body = el('div', 'so-clr'), sel = T.info.hasSelection;
      COLORS.forEach(function (c) {
        var b = el('button', 'so-clr-b'); b.type = 'button'; b.setAttribute('aria-label', c[0]);
        var dot = el('i'); dot.style.background = c[1]; b.appendChild(dot); b.appendChild(el('span', '', c[0]));
        b.onclick = function () { env.ctx.closeSheet(); setTimeout(function () { applyColor(c[1], c[0]); }, 60); };
        body.appendChild(b);
      });
      body.appendChild(el('div', 'so-sheet-note', sel ? '고른 글자의 색이 바뀝니다.' : '먼저 바꿀 글자를 길게 눌러 고른 뒤 색을 눌러 주십시오.'));
      env.ctx.sheet({ title: '글자 색', body: body, buttons: [{ label: '닫기' }] });
    }
    function applyColor(hex, name) {
      var d = doc(); ctxInfo().then(function (c) {
        if (!c.hasSelection) { toast('먼저 바꿀 글자를 길게 눌러 고른 뒤 색을 눌러 주십시오.', 3600); return; }
        var pk = d.getElementById('text-color-picker'); if (!pk) { toast('글자 색을 바꾸지 못했습니다.', 3000); return; }
        setV(pk, hex); env.markDirty(); toast('글자 색을 ' + name + roJosa(name) + ' 바꿨습니다', 2200);
      });
    }

    // ---- 그림 넣기 ----
    function shrinkImage(file) {
      return new Promise(function (res) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () {
          var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h));
          if (k >= 1 && file.size <= 700 * 1024) { URL.revokeObjectURL(url); res(file); return; }
          var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { URL.revokeObjectURL(url); cv.width = cv.height = 0; res(b ? new File([b], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
        };
        im.onerror = function () { URL.revokeObjectURL(url); res(null); };
        im.src = url;
      });
    }
    function pickPicture() {
      if (T.picWait || T.busyAuto) return;
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp'; inp.style.display = 'none';
      inp.onchange = function () { var f = inp.files && inp.files[0]; if (inp.parentNode) inp.parentNode.removeChild(inp); if (f) insertPicture(f); };
      document.body.appendChild(inp); inp.click();
      setTimeout(function () { if (inp.parentNode && !inp.files.length) { try { inp.parentNode.removeChild(inp); } catch (e) {} } }, 120000);
    }
    function banner(msg, onCancel) {
      var st = ST(); if (!st || !st.wrap) return null;
      var b = el('div', 'so-hwp-banner'); b.appendChild(el('span', '', msg));
      if (onCancel) { var x = el('button', '', '취소'); x.type = 'button'; x.onclick = onCancel; b.appendChild(x); }
      st.wrap.appendChild(b); return b;
    }
    // 스튜디오가 띄우는 PC용 안내 글(「클릭하거나 드래그하세요」)은 우리 안내 띠와 겹치므로 가린다
    function quietToast() {
      var d = doc(), n = 0, iv = setInterval(function () {
        n++; try { [].slice.call(d.body.children).concat([].slice.call(d.querySelectorAll('body div'))).forEach(function (e) { if (e.children.length < 4 && /^그림을 넣을 위치/.test((e.textContent || '').trim()) && (e.textContent || '').length < 120) e.style.display = 'none'; }); } catch (e) {}
        if (n > 40 || !ST()) clearInterval(iv);
      }, 100);
    }
    // 사용자가 쪽을 한 번 누를 때까지 기다린다. 누른 자리에서 그림을 골라(선택) 「글자처럼」으로 바꿀 수 있게 한다. 반환: 'placed' | 'cancel' | 'timeout'
    function waitPlaced(isCancelled) {
      var d = doc(), w = win();
      return new Promise(function (res) {
        var t0 = Date.now(), down = null, up = null, busy = false;
        function onDown(e) { down = { x: e.clientX, y: e.clientY }; }
        function onUp(e) { up = { x: e.clientX, y: e.clientY, t: Date.now() }; }
        ['mousedown', 'pointerdown'].forEach(function (t) { d.addEventListener(t, onDown, true); });
        ['mouseup', 'pointerup'].forEach(function (t) { d.addEventListener(t, onUp, true); });
        function finish(v) { ['mousedown', 'pointerdown'].forEach(function (t) { d.removeEventListener(t, onDown, true); }); ['mouseup', 'pointerup'].forEach(function (t) { d.removeEventListener(t, onUp, true); }); res(v); }
        function clickAt(x, y) {
          var tg = d.elementFromPoint(x, y); if (!tg) return;
          ['mousedown', 'mouseup', 'click'].forEach(function (t) { tg.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w, clientX: x, clientY: y, button: 0 })); });
        }
        function trySelect(from) {            // 놓인 그림 위를 눌러 선택한다(놓인 직후엔 선택 표시가 없다)
          var pts = [];
          [down, from].forEach(function (b) { if (b) [[10, 10], [30, 24], [60, 40]].forEach(function (o) { pts.push([b.x + o[0], b.y + o[1]]); }); });
          var i = 0;
          return (function next() {
            if (i >= pts.length) return Promise.resolve(false);
            var q = pts[i++]; clickAt(q[0], q[1]);
            return sleep(350).then(ctxInfo).then(function (c) { return c.inPictureObjectSelection ? true : next(); });
          })();
        }
        (function tick() {
          if (isCancelled() || !ST()) return finish('cancel');
          if (up && !busy && Date.now() - up.t > 700) {
            busy = true; var u = up; up = null;
            trySelect(u).then(function (ok) { busy = false; if (ok) finish('placed'); else setTimeout(tick, 200); });
            return;
          }
          if (Date.now() - t0 > 120000) return finish('timeout');
          setTimeout(tick, 150);
        })();
      });
    }
    function insertPicture(file) {
      T.picWait = true; var d = doc(), w = win(), bn = null, cancelled = false, failed = false;
      env.ctx.busy('사진을 줄이는 중…');
      shrinkImage(file).then(function (small) {
        env.ctx.busy(null);
        if (!small) { failed = '사진을 읽지 못했습니다.'; return null; }
        var proto = w.HTMLInputElement.prototype, orig = proto.click, got = false;
        proto.click = function () {         // 스튜디오가 만드는 파일 고르기 상자를 대신해, 고른 사진을 곧바로 건넨다
          if (this.type === 'file') { got = true; var dt = new w.DataTransfer(); dt.items.add(new w.File([small], small.name, { type: small.type })); this.files = dt.files; this.dispatchEvent(new w.Event('change', { bubbles: true })); return; }
          return orig.call(this);
        };
        return ctxInfo().then(function (c0) {
          return ed().commands.execute('insert:image', {}).then(function () { proto.click = orig; return got; }, function (e) { proto.click = orig; throw e; }).then(function (ok) {
            if (!ok) { failed = '사진을 건네지 못했습니다.'; return null; }
            bn = banner('그림을 넣을 자리를 한 번 눌러 주십시오(빈 줄이 가장 깔끔합니다)', function () { cancelled = true; });
            quietToast();
            return waitPlaced(function () { return cancelled; });
          });
        });
      }).then(function (r) {
        if (bn && bn.parentNode) bn.parentNode.removeChild(bn);
        if (failed || r === 'timeout' || r === 'cancel') {
          if (r === 'cancel' || r === 'timeout') { try { var k = d.activeElement || d.body; k.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })); } catch (e) {} }
          if (r === 'cancel') { toast('그림 넣기를 멈췄습니다', 2200); return false; }
          if (r === 'timeout') { toast('자리를 누르지 않아 그림 넣기를 멈췄습니다', 3200); return false; }
          toast('그림을 넣지 못했습니다 — ' + failed, 4200); return false;
        }
        if (r !== 'placed') return false;
        return asChar().then(function (ok) {
          env.markDirty();
          toast(ok ? '그림을 넣었습니다(글자처럼 붙였습니다)' : '그림은 넣었지만 글자처럼 붙이지 못했습니다. 글을 가리면 「취소」 단추로 되돌려 주십시오.', ok ? 2800 : 5200);
          return ok;
        });
      }).catch(function (e) { env.ctx.busy(null); if (bn && bn.parentNode) bn.parentNode.removeChild(bn); toast('그림을 넣지 못했습니다 — ' + ((e && e.message) || e), 4200); return false; })
        .then(function (v) { T.picWait = false; T.sync(true); return v; });
    }
    // 넣은 그림은 글 위에 떠서 글을 가리므로, 곧바로 「글자처럼 취급」으로 바꾼다(개체 속성 상자를 코드가 대신 눌러 확인)
    function asChar() {
      T.busyAuto = true; hide(true);
      var d = doc(), okv = false;
      ed().commands.execute('insert:picture-props', {}, { allowDialog: true }).catch(function () {});
      return waitFor(function () { var m = modal(); return m && [].slice.call(m.querySelectorAll('label')).some(function (l) { return /글자처럼/.test(l.textContent); }) ? m : null; }, 3000).then(function (m) {
        if (!m) return;
        var l = [].slice.call(m.querySelectorAll('label')).filter(function (x) { return /글자처럼/.test(x.textContent); })[0], cb = l.querySelector('input');
        if (!cb.checked) cb.click();
        okv = !!cb.checked;
        var ok = [].slice.call(m.querySelectorAll('button')).filter(function (b) { return /^(확인|설정)/.test(b.textContent.trim()); })[0];
        if (ok) ok.click(); else okv = false;
        return waitFor(function () { return !modal(); }, 3000);
      }).catch(function () { okv = false; }).then(function () { if (modal()) { closeModal(); okv = false; } hide(false); T.busyAuto = false; return okv; });
    }

    // ---- 문단 넣기(위·아래) · 문단 지우기 ----
    function paraAdd(where) {
      runExt('paraAdd', { where: where }).then(function (r) {
        if (r && r.ok) { env.markDirty(); toast(where === 'above' ? '위에 빈 문단을 하나 넣었습니다' : '아래에 빈 문단을 하나 넣었습니다', 2000); T.sync(true); return; }
        toast(r && r.why === 'intable' ? '표 안에서는 쓸 수 없습니다. 표 칸 안에서는 키보드의 Enter 키로 문단을 나누십시오.' : '지금은 쓸 수 없습니다.', 3200);
      });
    }
    function paraDel() {
      env.ctx.confirm('이 문단을 지우시겠습니까?', '커서가 있는 문단의 글이 지워집니다. 지운 직후에는 「취소」 단추로 되돌릴 수 있습니다.', '문단 지우기', function () {
        runExt('paraDel').then(function (r) {
          if (r && r.ok) {
            env.markDirty(); T.sync(true);
            toast(r.cleared ? (r.why === 'hasobj' ? '이 문단에는 표나 그림이 들어 있어 글만 비웠습니다' : '문서의 마지막 한 문단이라 글만 비웠습니다') : '문단을 지웠습니다(되돌리려면 취소 단추)', 3200); return;
          }
          toast(r && r.why === 'intable' ? '표 안에서는 쓸 수 없습니다. 칸의 글을 고른 뒤 지우십시오.' : (r && r.why === 'hasobj' ? '이 문단에는 표나 그림만 있어 지울 글이 없습니다. 「표 지우기」나 「그림 지움」을 쓰십시오.' : (r && r.why === 'only' ? '문서의 마지막 한 문단은 지울 수 없습니다.' : '지금은 쓸 수 없습니다.')), 3600);
        });
      }, { danger: true });
    }

    // ---- 칸(열) 추가: 표 폭을 종이 폭에 맞춰 준다 ----
    function addCol(side) {
      if (T.busyAuto) return; T.busyAuto = true;
      runExt('colAdd', { side: side }).then(function (r) {
        T.busyAuto = false;
        if (!r || !r.ok) { toast(r && r.why === 'notable' ? '표 안의 칸을 먼저 눌러 주십시오.' : '칸을 넣지 못했습니다.', 3000); return; }
        env.markDirty(); T.sync(true);
        if (r.over) {         // 폭을 맞추지 못해 표가 종이 밖으로 나간 경우: 바로 알리고 되돌릴 수 있게 한다
          env.ctx.confirm('표가 종이 밖으로 나갑니다', '칸을 넣었지만 표 폭을 종이에 맞추지 못했습니다. 이대로 두면 오른쪽 칸이 잘려 보일 수 있습니다.', '되돌리기', function () {
            ed().commands.execute('edit:undo', {}).then(function () { T.sync(true); toast('칸 추가를 되돌렸습니다', 2200); }, function () { toast('되돌리지 못했습니다. 「취소」 단추를 눌러 주십시오.', 3200); });
          }, { danger: true, cancelLabel: '그대로 두기' });
          return;
        }
        toast(r.fit ? ('칸을 ' + (side === 'right' ? '오른쪽' : '왼쪽') + '에 넣고 표 폭을 종이에 맞췄습니다(' + r.cols + '칸)') : ('칸을 ' + (side === 'right' ? '오른쪽' : '왼쪽') + '에 넣었습니다(' + r.cols + '칸)'), 2800);
        if (r.fit && r.minW && r.minW < 2200) setTimeout(function () { toast('칸 너비가 많이 좁아졌습니다. 칸을 줄이거나 글자를 작게 하십시오.', 3600); }, 2900);
      });
    }

    // ---- 칸 합치기: 끌어서 고른 칸이 있으면 그대로, 없으면 「첫 칸 누르고 → 끝 칸 누르기」 ----
    function endMergeWait() {
      T.mergeWait = false; if (T.mergeTimer) { clearInterval(T.mergeTimer); T.mergeTimer = 0; }
      if (T.mergeBanner && T.mergeBanner.parentNode) T.mergeBanner.parentNode.removeChild(T.mergeBanner); T.mergeBanner = null;
    }
    function cellMerge() {
      if (T.mergeWait) { endMergeWait(); toast('칸 합치기를 멈췄습니다', 1800); return; }
      if (T.info.hasMultiCellSelection) { run('table:cell-merge', '칸을 합쳤습니다')(); return; }
      runExt('cellPos').then(function (a) {
        if (!a || !a.ok) { toast('합칠 첫 칸을 먼저 눌러 주십시오.', 3000); return; }
        T.mergeWait = true; T.mergeBusy = false;
        T.mergeBanner = banner('합칠 마지막 칸을 눌러 주십시오(지금 칸부터 그 칸까지 한 칸이 됩니다)', function () { endMergeWait(); toast('칸 합치기를 멈췄습니다', 1800); });
        T.mergeTimer = setInterval(function () {
          if (!ST() || !T.mergeWait) { endMergeWait(); return; }
          if (T.mergeBusy) return; T.mergeBusy = true;
          runExt('cellPos').then(function (p) {
            T.mergeBusy = false;
            if (!T.mergeWait || !p || !p.ok || p.tbl !== a.tbl || (p.row === a.row && p.col === a.col)) return;
            endMergeWait();
            return runExt('cellMerge', { a: a }).then(function (r) {
              if (r && r.ok) { env.markDirty(); T.sync(true); toast('칸을 합쳤습니다(' + r.rows + '줄×' + r.cols + '칸 → 한 칸)', 2600); }
              else toast('칸을 합치지 못했습니다.', 3000);
            });
          });
        }, 320);
      });
    }

    // ---- 쪽 번호 · 머리말 ----
    function hfSheet() {
      var body = el('div'), pos = 'keep', align = 'center', alignTouched = false, initial = null, inp = el('input', 'sp-ta'); inp.type = 'text'; inp.maxLength = 60; inp.placeholder = '머리말에 넣을 글(비우면 머리말 없음)';
      function chips(label, list, get, set) {
        var wrap = el('div', 'so-opt'); wrap.appendChild(el('div', 'so-opt-l', label));
        var row = el('div', 'so-opt-r');
        list.forEach(function (o) {
          var b = el('button', 'so-opt-b' + (get() === o[0] ? ' on' : ''), o[1]); b.type = 'button';
          b.onclick = function () { set(o[0]); [].slice.call(row.children).forEach(function (x) { x.classList.toggle('on', x === b); }); };
          row.appendChild(b);
        });
        wrap.appendChild(row); return wrap;
      }
      body.appendChild(chips('쪽 번호(아래쪽)', [['none', '없음'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], function () { return pos; }, function (v) { pos = v; }));
      body.appendChild(el('div', 'so-opt-l', '머리말(위쪽 글)')); body.appendChild(inp);
      body.appendChild(chips('머리말 위치', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], function () { return align; }, function (v) { align = v; alignTouched = true; }));
      body.appendChild(el('div', 'so-sheet-note', '고르지 않은 칸은 그대로 둡니다. 모든 쪽에 같이 들어가며, 이미 있던 쪽 번호·머리말은 새로 넣는 내용으로 바뀝니다. 한컴 한글에서 열어 한 번 확인해 주십시오.'));
      runExt('hfInfo').then(function (r) { if (r && r.ok) { initial = r.header || ''; if (!inp.value) inp.value = initial; } });
      env.ctx.sheet({
        title: '쪽 번호·머리말', body: body, wide: true,
        buttons: [{ label: '취소' }, { label: '넣기', primary: true, onClick: function () {
          var text = inp.value;
          setTimeout(function () {
            var chain = Promise.resolve();
            if (pos !== 'keep') chain = chain.then(function () { return runExt('hfPageNum', { pos: pos }); });
            var headerSame = initial !== null && text === initial && !alignTouched || (initial === null && !text);
            chain.then(function () { return headerSame ? { ok: true } : runExt('hfHeader', { text: text, align: align }); }).then(function (r) {
              if (r && r.ok) { env.markDirty(); T.sync(true); toast('쪽 번호·머리말을 반영했습니다. 폰 화면에서는 쪽 위아래 여백에 보입니다.', 3400); } else toast('쪽 번호·머리말을 넣지 못했습니다.', 3200);
            });
          }, 60); return true; } }]
      });
    }

    // ---- 단추 목록 ----
    function run(id, okMsg, danger) {
      return function () {
        var go = function () {
          ed().commands.execute(id, {}).then(function () { env.markDirty(); if (okMsg) toast(okMsg, 2400); T.sync(true); }, function () { toast('지금은 쓸 수 없습니다.', 2000); });
        };
        if (danger) env.ctx.confirm(danger.title, danger.msg, danger.label, go, { danger: true }); else go();
      };
    }
    var ITEMS = {
      undo: { g: '↶', l: '취소', sel: '[data-cmd="edit:undo"]', mark: true },
      redo: { g: '↷', l: '다시', sel: '[data-cmd="edit:redo"]', mark: true },
      bold: { g: 'B', l: '굵게', sel: '#btn-bold', state: true },
      italic: { g: 'I', cls: 'it', l: '기울임', sel: '#btn-italic', state: true },
      underline: { g: 'U', cls: 'ul', l: '밑줄', sel: '#btn-underline', state: true },
      sizeDown: { g: '가－', l: '작게', sel: '[data-cmd="format:font-size-decrease"]', mark: true },
      sizeUp: { g: '가＋', l: '크게', sel: '[data-cmd="format:font-size-increase"]', mark: true },
      alignL: { g: '좌', l: '왼쪽', sel: '[data-cmd="format:align-left"]', ss: '#btn-align-left', state: true },
      alignC: { g: '중', l: '가운데', sel: '[data-cmd="format:align-center"]', ss: '#btn-align-center', state: true },
      alignR: { g: '우', l: '오른쪽', sel: '[data-cmd="format:align-right"]', ss: '#btn-align-right', state: true },
      alignJ: { g: '양', l: '양쪽', sel: '[data-cmd="format:align-justify"]', ss: '#btn-align-justify', state: true },
      zoomOut: { g: '－', l: '축소', sel: '#sb-zoom-out' }, zoomIn: { g: '＋', l: '확대', sel: '#sb-zoom-in' }, zoomFit: { g: '폭', l: '폭 맞춤', sel: '#sb-zoom-fit-width' },
      find: { g: '🔍', l: '찾기', sel: '[data-cmd="edit:find"]' },
      color: { g: 'A', cls: 'clr', l: '글자색', run: colorSheet },
      table: { g: '▦', l: '표', run: tableSheet },
      pic: { g: '🖼', l: '그림', run: pickPicture },
      paraBelow: { g: '↵↓', l: '아래 문단', run: function () { paraAdd('below'); } },
      paraAbove: { g: '↑↵', l: '위 문단', run: function () { paraAdd('above'); } },
      paraDel: { g: '문단✕', l: '문단 지우기', run: paraDel },
      hf: { g: '쪽', l: '쪽번호·머리말', run: hfSheet },
      rowBelow: { g: '＋줄', l: '줄 추가', run: run('table:insert-row-below', '줄을 하나 더 넣었습니다') },
      rowAbove: { g: '↑줄', l: '위에 추가', run: run('table:insert-row-above', '위에 줄을 하나 넣었습니다') },
      rowDel: { g: '－줄', l: '줄 지우기', run: run('table:delete-row', '줄을 지웠습니다(되돌리려면 취소 단추)') },
      colDel: { g: '－칸', l: '칸 지우기', run: run('table:delete-col', '칸을 지웠습니다(되돌리려면 취소 단추)') },
      cellMerge: { g: '합침', l: '칸 합치기', run: cellMerge },
      colRight: { g: '＋칸', l: '칸 추가', run: function () { addCol('right'); } },
      colLeft: { g: '←칸', l: '왼쪽 칸', run: function () { addCol('left'); } },
      cellSplit: { g: '나눔', l: '칸 나누기', run: run('table:cell-split', null) },
      tableDel: { g: '표✕', l: '표 지우기', run: run('table:delete', '표를 지웠습니다(되돌리려면 취소 단추)', { title: '표를 지우시겠습니까?', msg: '표와 표 안의 글이 모두 지워집니다. 지운 직후에는 「취소」 단추로 되돌릴 수 있습니다.', label: '표 지우기' }) },
      picDel: { g: '🗑', l: '그림 지우기', run: run('insert:picture-delete', '그림을 지웠습니다(되돌리려면 취소 단추)') }
    };

    function perRow() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }
    function makeBtn(it, host, inSheet) {
      var b = el('button', (inSheet ? 'so-hwp-mb ' : '') + (it.cls || '')); b.type = 'button'; b.setAttribute('aria-label', it.l); b.title = it.l;
      b.appendChild(el('span', 't-g', it.g)); b.appendChild(el('span', 't-l', it.l));
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });       // 글자 칸의 포커스(키보드)를 빼앗지 않는다
      b.addEventListener('click', function () {
        if (inSheet) env.ctx.closeSheet();
        if (it.run) { it.run(); return; }
        if (!env.clickIn(it.sel)) toast('지금은 쓸 수 없습니다.', 1800); else if (it.state || it.mark) env.markDirty();
      });
      host.appendChild(b);
      if (it.state) T.btns.push({ b: b, sel: it.ss || it.sel });
      if (it.sel && /edit:undo/.test(it.sel)) T.undoB = b;
      return b;
    }
    function render() {
      var st = ST(); if (!st) return;
      var tb = st.tb, ids = ORDER[T.mode] || ORDER.text, n = perRow(), main = ids, rest = [];
      if (ids.length > n) { main = ids.slice(0, n); rest = ids.slice(n); }     // 맨 끝 한 칸은 「더보기」 자리 — 넘치면 n칸 + 더보기
      tb.innerHTML = ''; T.btns = []; T.undoB = null; T.rest = rest;
      main.forEach(function (id) { makeBtn(ITEMS[id], tb); });
      if (rest.length || T.mode === 'table') {
        var mb = el('button', 'more'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.appendChild(el('span', 't-g', '⋯')); mb.appendChild(el('span', 't-l', '더보기'));
        mb.addEventListener('pointerdown', function (e) { e.preventDefault(); }); mb.addEventListener('click', moreSheet); tb.appendChild(mb);
      }
      T.perRow = n; T.renderedMode = T.mode; T.renderedFor = ids.length;
    }
    function moreSheet() {
      var body = el('div'), grid = el('div', 'so-hwp-mgrid');
      (T.rest || []).forEach(function (id) { makeBtn(ITEMS[id], grid, true); });
      if (!T.rest.length) grid.appendChild(el('div', 'so-sheet-note', '더 넣을 도구가 없습니다.'));
      body.appendChild(grid);
      if (T.mode === 'table') body.appendChild(el('div', 'so-sheet-note', '칸을 합치려면 첫 칸을 누르고 「칸 합치기」를 누른 뒤 마지막 칸을 누르십시오(끌어서 고른 칸이 있으면 바로 합칩니다). 칸을 넣으면 표 폭이 종이에 맞춰집니다.'));
      var btns = [{ label: '닫기' }];
      if (env.ctx.fixAvail()) btns.unshift({ label: '수정 요청', onClick: function () { setTimeout(function () { env.ctx.requestFix(); }, 80); return true; } });
      env.ctx.sheet({ title: '더보기', body: body, buttons: btns, wide: true });
    }
    T.render = render; T.insertPicture = insertPicture; T.createTable = createTable;
    // 400ms마다: 지금 어디에 있나(표 안·그림 선택·글)에 따라 도구줄을 바꾸고 취소 단추를 켜고 끈다
    T.sync = function (force) {
      if (!ST() || !ST().editing || !ed()) return;
      var e = ed(); if (T.syncing && !force) return; T.syncing = true;
      ctxInfo().then(function (c) {
        T.syncing = false; if (!ST()) return;
        T.info = c || {};
        var mode = c.inPictureObjectSelection ? 'pic' : (c.inTable ? 'table' : 'text');
        if (mode !== T.mode || perRow() !== T.perRow) { T.mode = mode; render(); }
        if (T.undoB) T.undoB.disabled = c.canUndo === false;
      }, function () { T.syncing = false; });
    };
    T.stateBtns = function () { return T.btns || []; };
    return T;
  }

  global.SOHwpTools = { create: create };
})(window);
