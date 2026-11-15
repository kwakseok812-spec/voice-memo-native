/* so-docx-ui-more.js — S-Office 워드 편집 보강 4회차 화면(O-0861, v10.9): 수식 · 도형 · 스타일 만들기 · 입력 칸 · 인용·참고문헌 · 색인 · 맞춤법 · 문서 비교 · 변경 기록
 * 새 도구줄 단추는 만들지 않고 기존 시트(문단·그림·스타일·검토)에 단추를 얹는다. 실제 문서 고치기는 so-docx-math/track/more.js, 화면 틀은 so-docx-ui.js.
 */
(function (global) {
  'use strict';
  var FILLS = [['파랑', '4472C4'], ['초록', '70AD47'], ['주황', 'ED7D31'], ['노랑', 'FFC000'], ['하늘', '5B9BD5'], ['연노랑', 'FFF2CC'], ['회색', 'A5A5A5'], ['흰색', 'FFFFFF'], ['없음', null]];
  var LINES = [['검정', '000000'], ['회색', '7F7F7F'], ['파랑', '2F528F'], ['빨강', 'C00000'], ['없음', null]];
  var TXTC = [['검정', '000000'], ['흰색', 'FFFFFF'], ['빨강', 'C00000'], ['파랑', '1C5FD6']];
  var FONTS = ['맑은 고딕', '바탕', '돋움', '굴림', '궁서', 'Arial', 'Times New Roman'];
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function create(h) {
    var env = h.env, ST = h.ST, ctx = h.ctx, toast = h.toast, need = h.need, fail = h.fail, S = h.S, J = h.J;
    var M = function () { return global.SODocxMath; }, TR = function () { return global.SODocxTrack; }, MO = function () { return global.SODocxMore; }, SP = function () { return global.SODocxSpell; };
    var X = {};
    function sheetOf(title, body, buttons) { return ctx().sheet({ title: title, body: body, wide: true, buttons: buttons }); }
    function row(body, label) { if (label) body.appendChild(el('div', 'sdx-l', label)); var r = el('div', 'sdx-r'); body.appendChild(r); return r; }
    function note(body, text, cls) { var n = el('div', 'so-sheet-note' + (cls ? ' ' + cls : ''), text); body.appendChild(n); return n; }
    function chip(rw, text, on, fn, cls) { var b = el('button', 'sdx-b' + (cls ? ' ' + cls : '') + (on ? ' on' : ''), text); b.type = 'button'; b.onclick = fn; rw.appendChild(b); return b; }
    function swatch(rw, text, color, on, fn) { var b = el('button', 'sdx-b sw' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = '#' + color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); b.onclick = fn; rw.appendChild(b); return b; }
    function input(body, ph, val, type) { var i = el('input', 'sdx-in'); i.type = type || 'text'; i.placeholder = ph; i.setAttribute('aria-label', ph); if (val != null) i.value = val; body.appendChild(i); return i; }
    function area(body, ph, val, rows) { var t = el('textarea', 'sdx-in'); t.rows = rows || 2; t.placeholder = ph; t.setAttribute('aria-label', ph); if (val != null) t.value = val; body.appendChild(t); return t; }
    function stepper(body, label, get, set, min, max, step, unit) {
      var rw = row(body, ''), lab = el('div', 'sdx-l', ''); rw.parentNode.insertBefore(lab, rw);
      function paint() { lab.textContent = label + ' — ' + get() + (unit || ''); }
      [['− ' + step * 3, -step * 3], ['− ' + step, -step], ['＋ ' + step, step], ['＋ ' + step * 3, step * 3]].forEach(function (a) { chip(rw, a[0], false, function () { var v = Math.round((get() + a[1]) * 10) / 10; set(Math.max(min, Math.min(max, v))); paint(); if (rw._after) rw._after(); }); });
      paint(); return rw;
    }
    function showErr(n, msg) { n.textContent = msg || ''; n.style.color = msg ? '#c0392b' : ''; }
    function opx(label, fn, ok, keep) { return h.op(label, fn, ok, keep); }

    // ================================================================ 수식
    X.mathSheet = function () {
      var r = need(); if (!r) return; if (!M()) { toast('수식 부품을 불러오지 못했습니다.', 3200); return; }
      env.peek(function (pkg) { return pkg.read('word/document.xml'); }).then(function (x) {
        var list = []; try { list = M().listMath(x, ST); } catch (e) {}
        var st = { ord: null, display: true, readonly: false }, body = el('div', 'sdx'), sh;
        if (list.length) {
          var gl = row(body, '이 문서의 수식 ' + list.length + '개 — 누르면 고치기');
          list.slice(0, 16).forEach(function (m) { chip(gl, (m.ord + 1) + '. ' + (m.tex == null ? '(폰에서 못 고치는 식)' : (m.tex.length > 14 ? m.tex.slice(0, 14) + '…' : m.tex)), false, function () {
            st.ord = m.ord; st.display = m.display; st.readonly = m.tex == null; ta.value = m.tex || ''; ta.disabled = m.tex == null; dsp.paint(); upd(); sync();
          }); });
        }
        body.appendChild(el('div', 'sdx-l', '식 글(LaTeX 모양) — 아래 틀을 눌러 끼워 넣습니다'));
        var ta = area(body, '예: \\frac{a}{b}   x^{2}   \\sqrt{x}   \\sum_{i=1}^{n} i', '', 3); ta.style.fontFamily = '"Cascadia Mono",Consolas,"Roboto Mono","Noto Sans Mono",Menlo,monospace'; ta.spellcheck = false; ta.autocapitalize = 'off';
        var msg = note(body, ''), prev = el('div', 'sdx-mathprev'); prev.setAttribute('aria-label', '수식 미리 보기'); body.appendChild(prev);
        var dsp = (function () { var rw = row(body, '넣는 모양'), a = chip(rw, '가운데 줄에 따로', true, function () { st.display = true; dsp.paint(); }), b = chip(rw, '문단 글 사이에(작게)', false, function () { st.display = false; dsp.paint(); }); return { paint: function () { a.classList.toggle('on', st.display); b.classList.toggle('on', !st.display); } }; })();
        function upd() {
          var v = ta.value.trim(); prev.innerHTML = ''; if (!v) { showErr(msg, ''); return; }
          try { var b = M().build(v, st.display); prev.innerHTML = b.mathml; showErr(msg, ''); }
          catch (e) { showErr(msg, (e && e.mathErr ? e.message : '식을 읽지 못했습니다') + (e && e.pos != null ? ' (' + (e.pos + 1) + '번째 글자 근처)' : '')); }
        }
        ta.addEventListener('input', upd);
        function ins(text) { var s0 = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e0 = ta.selectionEnd == null ? s0 : ta.selectionEnd; ta.value = ta.value.slice(0, s0) + text + ta.value.slice(e0); var c = text.indexOf('{}'); var pos = c >= 0 ? s0 + c + 1 : s0 + text.length; try { ta.focus(); ta.setSelectionRange(pos, pos); } catch (e) {} upd(); }
        var gt = row(body, '틀'); M().TEMPLATES.forEach(function (t) { chip(gt, t[0], false, function () { if (st.readonly) return; ins(t[2]); }); });
        M().SYMBOLS.forEach(function (g) { var gs = row(body, g[0]); g[1].forEach(function (c) { chip(gs, c, false, function () { if (st.readonly) return; ins(g[2](c) + ' '); }, 'sym'); }); });
        note(body, '식 글은 중괄호로 묶어 적습니다(분수 \\frac{위}{아래}, 첨자 x^{2} x_{i}, 제곱근 \\sqrt{x}). 틀을 누르면 빈 중괄호 안에 커서가 갑니다. 폰 화면에서는 단순한 모양으로, 워드에서는 진짜 워드 수식으로 보입니다. 글자(한글)는 \\text{…} 안에 적습니다.');
        function sync() { if (!sh) return; var bs = sh.buttons.children; if (bs[1]) bs[1].disabled = st.ord == null; if (bs[2]) bs[2].disabled = st.ord == null || st.readonly; }
        function put(fn) { var v = ta.value.trim(); if (!v) { toast('식을 적어 주십시오.', 2400); return false; } try { M().build(v, st.display); } catch (e) { toast((e && e.message) || '식을 읽지 못했습니다', 3600); return false; } fn(v); return true; }
        sh = sheetOf('수식', body, [{ label: '닫기' }, { label: '수식 지우기', danger: true, onClick: function () { if (st.ord == null) return false; opx('수식 지우기', function (xx) { return M().removeMath(xx, ST, st.ord); }, '수식을 지웠습니다(되돌리려면 ↶)', true); return true; } },
          { label: '고치기', onClick: function () { if (st.ord == null) return false; return put(function (v) { opx('수식 고치기', function (xx) { return M().setMath(xx, ST, st.ord, v); }, '수식을 고쳤습니다', true); }); } },
          { label: '새로 넣기', primary: true, onClick: function () { return put(function (v) { opx('수식', function (xx) { var q = M().addMath(xx, ST, r.b, v, st.display); return q.err ? q : { xml: q.xml, newA: q.newA, newB: q.newA }; }, '수식을 넣었습니다(워드에서는 진짜 수식으로 보입니다)', true); }); } }]);
        sync(); setTimeout(function () { try { ta.focus(); } catch (e) {} }, 300);
      });
    };

    // ================================================================ 도형
    function shapeHtmlOf(sp, k) { return MO().shapeHtml ? MO().shapeHtml(sp, k) : ''; }
    X.shapeSheet = function () {
      var r = need(); if (!r) return; if (!MO()) { toast('도형 부품을 불러오지 못했습니다.', 3200); return; }
      env.peek(function (pkg) { return pkg.read('word/document.xml'); }).then(function (x) {
        var list = []; try { list = MO().listShapes(x); } catch (e) {}
        var sp = MO().shapeSpecOf('rect'); sp.layout = 'inline'; sp.text = ''; var st = { ord: null, kind: 'rect' }, body = el('div', 'sdx'), sh, repaints = [];
        function repaint() { repaints.forEach(function (f) { f(); }); drawPrev(); }
        var prev = el('div', 'sdx-shape-prev');
        function drawPrev() { prev.innerHTML = shapeHtmlOf(sp, Math.min(3.7795, 300 / Math.max(10, sp.w || 40))); }
        if (list.length) {
          var gl = row(body, '이 문서의 도형 ' + list.length + '개 — 누르면 고치기');
          list.slice(0, 16).forEach(function (s) { chip(gl, (s.ord + 1) + '. ' + (kindName(s.spec) + (s.spec.text ? ' · ' + s.spec.text.slice(0, 6) : '')), false, function () { st.ord = s.ord; sp = JSON.parse(JSON.stringify(s.spec)); st.kind = kindKey(sp); repaint(); sync(); }); });
        }
        body.appendChild(prev);
        var gk = row(body, '모양'); MO().SHAPES.forEach(function (d) { var b = chip(gk, d.l, d.k === st.kind, function () { var keep = { text: sp.text, layout: sp.layout, align: sp.align, textColor: sp.textColor, fontSize: sp.fontSize }; if (st.ord == null) { sp = MO().shapeSpecOf(d.k); Object.keys(keep).forEach(function (q) { if (keep[q] != null) sp[q] = keep[q]; }); } else { var n = MO().shapeSpecOf(d.k); sp.prst = n.prst; sp.tail = !!n.tail; sp.textbox = !!n.textbox; if (n.fill == null) sp.fill = null; else if (!sp.fill) sp.fill = n.fill; if (n.line == null) sp.line = null; else if (!sp.line) sp.line = n.line; } st.kind = d.k; repaint(); }); repaints.push(function () { b.classList.toggle('on', st.kind === d.k); }); });
        var rw1 = stepper(body, '너비', function () { return sp.w; }, function (v) { sp.w = v; }, 5, 170, 5, 'mm'); rw1._after = drawPrev;
        var rw2 = stepper(body, '높이', function () { return sp.h; }, function (v) { sp.h = v; }, 0, 240, 5, 'mm'); rw2._after = drawPrev;
        var gf = row(body, '채우기'); FILLS.forEach(function (c) { var b = swatch(gf, c[0], c[1], false, function () { sp.fill = c[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.fill || null) === c[1]); }); });
        var gn = row(body, '선 색'); LINES.forEach(function (c) { var b = swatch(gn, c[0], c[1], false, function () { sp.line = c[1]; if (c[1] && !sp.lineW) sp.lineW = 1; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.line || null) === c[1]); }); });
        var gw = row(body, '선 굵기(pt)'); [0.5, 1, 1.5, 2, 3, 4.5].forEach(function (v) { var b = chip(gw, String(v), false, function () { sp.lineW = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.lineW || 1) === v); }); });
        body.appendChild(el('div', 'sdx-l', '도형 안에 넣을 글(없으면 비워 두기)')); var tx = area(body, '도형 안의 글', sp.text, 2); tx.addEventListener('input', function () { sp.text = tx.value; drawPrev(); });
        repaints.push(function () { if (document.activeElement !== tx) tx.value = sp.text || ''; });
        var gs = row(body, '글자 크기(pt)'); [10, 12, 14, 18, 24].forEach(function (v) { var b = chip(gs, String(v), false, function () { sp.fontSize = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.fontSize || 11) === v); }); });
        var gc = row(body, '글자 색'); TXTC.forEach(function (c) { var b = swatch(gc, c[0], c[1], false, function () { sp.textColor = c[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.textColor || '') === c[1]); }); });
        var gy = row(body, '배치'); Object.keys(MO().LAYOUTS).forEach(function (k) { var b = chip(gy, MO().LAYOUTS[k], false, function () { sp.layout = k; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.layout || 'inline') === k); }); });
        var ga = row(body, '자리(글자처럼이 아닐 때)'); [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right']].forEach(function (a) { var b = chip(ga, a[0], false, function () { sp.align = a[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', (sp.align || 'center') === a[1]); }); });
        note(body, '도형은 고른 문단에 붙습니다. 「글자처럼」은 글 사이에 한 글자처럼, 그 밖은 글 옆·위아래·뒤·앞에 떠 있는 도형입니다. 폰 화면의 미리 그림은 대략의 모양이라 글 옆·앞뒤 배치도 문단 아래에 놓아 보여 주고, 워드·한컴에서는 정확한 자리에 보입니다.');
        function kindKey(s) { var m = MO().SHAPES.filter(function (d) { return d.prst === s.prst && (!!d.textbox) === !!s.textbox; })[0] || MO().SHAPES.filter(function (d) { return d.prst === s.prst; })[0]; return m ? m.k : 'rect'; }
        function kindName(s) { var m = MO().SHAPES.filter(function (d) { return d.k === kindKey(s); })[0]; return m ? m.l : '도형'; }
        function sync() { if (!sh) return; var bs = sh.buttons.children; if (bs[1]) bs[1].disabled = st.ord == null; if (bs[2]) bs[2].disabled = st.ord == null; }
        sh = sheetOf('도형', body, [{ label: '닫기' }, { label: '도형 지우기', danger: true, onClick: function () { if (st.ord == null) return false; opx('도형 지우기', function (xx) { return MO().removeShape(xx, st.ord); }, '도형을 지웠습니다(되돌리려면 ↶)', true); return true; } },
          { label: '고치기', onClick: function () { if (st.ord == null) return false; opx('도형 고치기', function (xx) { return MO().setShape(xx, st.ord, JSON.parse(JSON.stringify(sp))); }, '도형을 고쳤습니다', true); return true; } },
          { label: '새로 넣기', primary: true, onClick: function () { var c = JSON.parse(JSON.stringify(sp)); opx('도형', function (xx) { var q = MO().addShape(xx, r.b, c); return q.err ? q : { xml: q.xml, newA: r.b, newB: r.b }; }, '도형을 넣었습니다', true); return true; } }]);
        repaint(); sync();
      });
    };

    // ================================================================ 스타일 목록·만들기·고치기
    X.styleExtras = function (body, r) {
      var holder = el('div'); body.appendChild(holder);
      env.peek(function (pkg) { return MO().listStyles(pkg); }).then(function (ls) {
        if (!holder.isConnected) return;
        var BUILT = { 'normal': 1, 'title': 1, 'heading 1': 1, 'heading 2': 1, 'heading 3': 1 }, pls = ls.filter(function (s) { return s.type === 'paragraph' && !BUILT[s.name.toLowerCase()]; }), cls = ls.filter(function (s) { return s.type === 'character'; });
        var g1 = row(holder, '이 문서의 문단 스타일 ' + pls.length + '개 — 누르면 고른 문단에 입힘');
        pls.slice(0, 60).forEach(function (s) { var b = chip(g1, s.name, false, function () { h.ctx().closeSheet(); setTimeout(function () { applyPara(r, s); }, 60); }, s.custom ? 'bold' : ''); });
        if (cls.length) { var g2 = row(holder, '글자 스타일 — 고른 문단의 글 전체에'); cls.slice(0, 30).forEach(function (s) { chip(g2, s.name, false, function () { h.ctx().closeSheet(); setTimeout(function () { var q = need(); if (!q) return; opx('글자 스타일', function (x) { return MO().applyCharStyle(x, q.a, q.b, s.id); }, J('「' + s.name + '」', '을') + ' 입혔습니다', true); }, 60); }); }); chip(g2, '글자 스타일 풀기', false, function () { h.ctx().closeSheet(); setTimeout(function () { var q = need(); if (!q) return; opx('글자 스타일', function (x) { return MO().applyCharStyle(x, q.a, q.b, null); }, '글자 스타일을 풀었습니다', true); }, 60); }, 'danger'); }
        var g3 = row(holder, '스타일 만들기·고치기'); chip(g3, '스타일 만들기·고치기', false, function () { h.ctx().closeSheet(); setTimeout(function () { X.styleForm(null); }, 60); }, 'big on');
        note(holder, '직접 만든 스타일은 목록에서 굵게 보이고, 만든 뒤 워드에서도 같은 이름의 스타일로 쓸 수 있습니다.');
      });
    };
    function applyPara(r, s) {
      var q = need() || r; if (!q) return;
      env.run('스타일', function (pkg) { return pkg.read('word/document.xml').then(function (x) { pkg.write('word/document.xml', ST.setStyle(x, q.a, q.b, s.id)); return {}; }); }, function (z) { if (z && z.err) { fail(z.err); return; } toast('「' + s.name + '」로 바꿨습니다', 2400); });
    }
    X.styleForm = function (editId) {
      var r = need(); if (!r) return;
      env.peek(function (pkg) { return MO().listStyles(pkg); }).then(function (ls) {
        var f = { name: '', type: 'paragraph', font: null, size: 11, bold: false, italic: false, color: null, align: 'left', spBefore: 0, spAfter: 6, line: 1.15 }, st = { id: null, custom: false }, body = el('div', 'sdx'), sh, repaints = [];
        function repaint() { repaints.forEach(function (fn) { fn(); }); }
        var pls = ls.filter(function (s) { return s.custom; });
        if (ls.length) { var gl = row(body, '고칠 스타일 고르기(고르지 않으면 새로 만듭니다)'); ls.filter(function (s) { return s.type === 'paragraph'; }).slice(0, 40).forEach(function (s) { chip(gl, s.name + (s.custom ? '' : ' (기본)'), false, function () { st.id = s.id; st.custom = s.custom; f.name = s.name; f.type = s.type; var q = s.fmt; f.font = q.font || null; f.size = q.size || 11; f.bold = !!q.bold; f.italic = !!q.italic; f.color = q.color || null; f.align = q.align || 'left'; f.spBefore = q.spBefore != null ? q.spBefore : 0; f.spAfter = q.spAfter != null ? q.spAfter : 6; f.line = q.line || 1.15; nm.value = f.name; nm.disabled = !s.custom; repaint(); sync(); }); }); }
        var nm = input(body, '스타일 이름(새로 만들 때)', ''); nm.addEventListener('input', function () { f.name = nm.value; });
        var gt = row(body, '종류(새로 만들 때)'); [['문단 스타일', 'paragraph'], ['글자 스타일', 'character']].forEach(function (a) { var b = chip(gt, a[0], false, function () { if (st.id) return; f.type = a[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.type === a[1]); }); });
        var gp = row(body, ''); chip(gp, '고른 문단의 모양 가져오기', false, function () { var q = ST.readFmt(S().xml, r.a); f.font = q.font || f.font; f.size = q.size || f.size; f.bold = !!q.bold; f.italic = !!q.italic; f.color = q.color || null; if (q.align) f.align = q.align; repaint(); toast('고른 문단의 글자 모양을 가져왔습니다', 2200); }, 'big');
        var gf = row(body, '글꼴'); FONTS.forEach(function (n) { var b = chip(gf, n, false, function () { f.font = n; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.font === n); }); });
        var gs = row(body, '글자 크기(pt)'); [9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36].forEach(function (v) { var b = chip(gs, String(v), false, function () { f.size = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.size === v); }); });
        var gb = row(body, '글자 모양'); var bb = chip(gb, '굵게', false, function () { f.bold = !f.bold; repaint(); }, 'bold'), bi = chip(gb, '기울임', false, function () { f.italic = !f.italic; repaint(); }, 'it'); repaints.push(function () { bb.classList.toggle('on', !!f.bold); bi.classList.toggle('on', !!f.italic); });
        var gc = row(body, '글자 색'); [['검정', '000000'], ['빨강', 'C00000'], ['파랑', '1C5FD6'], ['초록', '1B8A3A'], ['주황', 'EE7A00'], ['보라', '7A3FC4'], ['회색', '777777']].forEach(function (c) { var b = swatch(gc, c[0], c[1], false, function () { f.color = c[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.color === c[1]); }); });
        var ga = row(body, '정렬(문단 스타일)'); [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right'], ['양쪽', 'both']].forEach(function (a) { var b = chip(ga, a[0], false, function () { f.align = a[1]; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.align === a[1]); }); });
        var g1 = row(body, '문단 앞 간격(pt)'); [0, 6, 12, 18].forEach(function (v) { var b = chip(g1, String(v), false, function () { f.spBefore = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.spBefore === v); }); });
        var g2 = row(body, '문단 뒤 간격(pt)'); [0, 6, 12, 18].forEach(function (v) { var b = chip(g2, String(v), false, function () { f.spAfter = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.spAfter === v); }); });
        var g3 = row(body, '줄 간격'); [1, 1.15, 1.5, 2].forEach(function (v) { var b = chip(g3, String(v), false, function () { f.line = v; repaint(); }); repaints.push(function () { b.classList.toggle('on', f.line === v); }); });
        note(body, '「만들기」는 새 스타일을 만들어 고른 문단(글자 스타일이면 그 문단의 글)에 바로 입힙니다. 기본 스타일을 고쳐 문서 전체의 모양을 바꿀 수도 있습니다(되돌리기 ↶ 가능). 만든 스타일은 직접 만든 것만 지울 수 있고, 문서에서 쓰는 중이면 지울 수 없습니다.');
        function spec() { return { id: st.id, name: f.name, type: f.type, font: f.font, size: f.size, bold: f.bold, italic: f.italic, color: f.color == null ? undefined : f.color, align: f.type === 'paragraph' ? f.align : null, spBefore: f.type === 'paragraph' ? f.spBefore : undefined, spAfter: f.type === 'paragraph' ? f.spAfter : undefined, line: f.type === 'paragraph' ? f.line : undefined }; }
        function sync() { if (!sh) return; var bs = sh.buttons.children; if (bs[1]) bs[1].disabled = !st.id || !st.custom; if (bs[2]) bs[2].disabled = !st.id; if (bs[3]) bs[3].disabled = !!st.id; }
        sh = sheetOf('스타일 만들기·고치기', body, [{ label: '닫기' }, { label: '스타일 지우기', danger: true, onClick: function () { var id = st.id; env.run('스타일 지우기', function (pkg) { return MO().deleteStyle(pkg, id).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('스타일을 지웠습니다(되돌리려면 ↶)', 2800); }); return true; } },
          { label: '고친 값 저장', onClick: function () { var sp0 = spec(); env.run('스타일 고치기', function (pkg) { return MO().saveStyle(pkg, sp0).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('스타일을 고쳤습니다(이 스타일을 쓴 문단이 모두 바뀝니다)', 3200); }); return true; } },
          { label: '만들기', primary: true, onClick: function () { var sp0 = spec(); if (!sp0.name.trim()) { toast('스타일 이름을 적어 주십시오.', 2400); return false; }
            env.run('스타일 만들기', function (pkg) { return MO().saveStyle(pkg, sp0).then(function (q) { if (q.err) return q; return pkg.read('word/document.xml').then(function (x) { pkg.write('word/document.xml', sp0.type === 'character' ? MO().applyCharStyle(x, r.a, r.b, q.id) : ST.setStyle(x, r.a, r.b, q.id)); return {}; }); }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('「' + sp0.name.trim() + '」 스타일을 만들어 고른 문단에 입혔습니다', 3200); }); return true; } }]);
        repaint(); sync();
      });
    };

    // ================================================================ 입력 칸(콘텐츠 컨트롤)
    X.controlSheet = function () {
      var r = need(); if (!r) return; if (!MO()) return;
      var body = el('div', 'sdx'), sh = null, kind = 'check', fmt = 'yyyy-MM-dd';
      function render() {
        env.peek(function (pkg) { return pkg.read('word/document.xml'); }).then(function (x) {
          body.innerHTML = ''; var list = MO().listControls(x);
          var gk = row(body, '고른 문단 끝에 넣을 입력 칸'); [['체크 칸 ☐', 'check'], ['목록에서 고르기', 'drop'], ['날짜 고르기', 'date'], ['글 입력 칸', 'text']].forEach(function (a) { chip(gk, a[0], kind === a[1], function () { kind = a[1]; render(); }); });
          var ti = input(body, '칸 제목(예: 동의, 부서, 날짜)'); var items = null;
          if (kind === 'drop') items = area(body, '고를 항목을 한 줄에 하나씩', '개발\n영업\n인사', 4);
          if (kind === 'date') { var gd = row(body, '날짜 모양'); ['yyyy-MM-dd', 'yyyy.MM.dd', 'yyyy년 M월 d일'].forEach(function (f) { chip(gd, f, fmt === f, function () { fmt = f; render(); }); }); }
          var ga = row(body, ''); chip(ga, '입력 칸 넣기', false, function () {
            var o = { label: ti.value.trim(), items: items ? items.value.split(/\r?\n/) : null, format: fmt };
            h.ctx().closeSheet(); setTimeout(function () { opx('입력 칸', function (xx) { var q = MO().addControl(xx, r.b, kind, o); return q.err ? q : { xml: q.xml }; }, '입력 칸을 넣었습니다(워드에서도 같은 칸으로 보입니다)', true); }, 60);
          }, 'big on');
          if (list.length) {
            body.appendChild(el('div', 'sdx-l', '이 문서의 입력 칸 ' + list.length + '개 — 채우기'));
            list.slice(0, 40).forEach(function (c) { fillRow(c); });
          } else note(body, '아직 입력 칸이 없습니다. 위에서 종류를 고르고 「입력 칸 넣기」를 누르면 고른 문단 끝에 들어갑니다.');
          note(body, '입력 칸은 양식 문서(신청서·동의서)에서 체크하거나 고르거나 날짜를 넣는 칸입니다. 폰에서 채운 값은 사본에 그대로 저장됩니다.');
        });
      }
      function fillRow(c) {
        var rw = el('div', 'sdx-chg'), lab = el('div', 'sdx-chl'); var tn = { check: '체크', drop: '목록', combo: '목록(직접 입력도 가능)', date: '날짜', text: '글', other: '기타' }[c.type];
        lab.textContent = (c.ord + 1) + '. [' + tn + '] ' + (c.alias || '(제목 없음)') + ' — ' + (c.type === 'check' ? (c.checked ? '체크함' : '체크 안 함') : (c.value || '(비어 있음)')); rw.appendChild(lab);
        var br = el('div', 'sdx-r');
        function put(v, msg) { h.ctx().closeSheet(); setTimeout(function () { opx('입력 칸 채우기', function (xx) { var q = MO().setControl(xx, c.ord, v); return q.err ? q : { xml: q.xml }; }, msg || '채웠습니다', true); setTimeout(X.controlSheetAgain, 700); }, 60); }
        if (c.block || c.type === 'other' || c.type === 'combo') br.appendChild(el('span', 'so-sheet-note', '폰에서 채울 수 없는 칸입니다(워드에서).'));
        else if (c.type === 'check') chip(br, c.checked ? '체크 풀기' : '체크하기', false, function () { put(!c.checked, c.checked ? '체크를 풀었습니다' : '체크했습니다'); }, 'on');
        else if (c.type === 'drop') (c.items || []).forEach(function (it) { chip(br, it, c.value === it, function () { put(it, '「' + it + '」로 골랐습니다'); }); });
        else if (c.type === 'date') { var di = input(br, '날짜', '', 'date'); chip(br, '이 날짜로', false, function () { if (!di.value) { toast('날짜를 골라 주십시오.', 2200); return; } put(di.value, '날짜를 넣었습니다'); }, 'on'); }
        else { var ti2 = input(br, '넣을 글', c.value); chip(br, '적용', false, function () { put(ti2.value, '글을 넣었습니다'); }, 'on'); }
        if (!c.block && c.type !== 'other') chip(br, '칸 지우기', false, function () { h.ctx().closeSheet(); setTimeout(function () { opx('입력 칸 지우기', function (xx) { return MO().removeControl(xx, c.ord, true); }, '입력 칸을 지웠습니다(글은 남김)', true); }, 60); }, 'danger');
        rw.appendChild(br); body.appendChild(rw);
      }
      X.controlSheetAgain = function () { if (h.curSheetOpen && h.curSheetOpen()) return; X.controlSheet(); };
      sh = sheetOf('입력 칸(체크·목록·날짜·글)', body, [{ label: '닫기' }]); render();
    };

    // ================================================================ 인용·참고문헌
    X.citeSheet = function () {
      var r = need(); if (!r) return; if (!MO()) return;
      var body = el('div', 'sdx'), type = 'Book', fields = {};
      function render() {
        env.peek(function (pkg) { return MO().listSources(pkg); }).then(function (srcs) {
          body.innerHTML = '';
          if (srcs.length) {
            body.appendChild(el('div', 'sdx-l', '참고 자료 ' + srcs.length + '개 — 누르면 고른 문단 끝에 인용을 넣습니다'));
            srcs.forEach(function (s) {
              var rw = el('div', 'sdx-chg'); rw.appendChild(el('div', 'sdx-chl', '(' + s.author + (s.year ? ', ' + s.year : '') + ') ' + s.title)); var br = el('div', 'sdx-r');
              chip(br, '인용 넣기', false, function () { h.ctx().closeSheet(); setTimeout(function () { env.run('인용', function (pkg) { return MO().addCitation(pkg, r.b, s.tag).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('인용 ' + J('「' + s.author + '」', '을') + ' 넣었습니다', 2600); }); }, 60); }, 'on');
              chip(br, '자료 지우기', false, function () { env.run('참고 자료 지우기', function (pkg) { return MO().removeSource(pkg, s.tag).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('참고 자료를 지웠습니다', 2200); setTimeout(X.citeAgain, 600); }); h.ctx().closeSheet(); }, 'danger');
              rw.appendChild(br); body.appendChild(rw);
            });
            var gb = row(body, ''); chip(gb, '참고문헌 목록 넣기·갱신', false, function () { h.ctx().closeSheet(); setTimeout(function () { env.run('참고문헌', function (pkg) { return MO().putBibliography(pkg, r.b).then(function (q) { return q.err ? q : { n: q.n, updated: q.updated }; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('참고문헌 ' + q.n + '개를 ' + (q.updated ? '갱신했습니다' : '고른 문단 아래에 넣었습니다') + '(워드에서 「필드 업데이트」를 하면 글꼴·모양이 워드 규칙대로 다시 만들어집니다)', 4200); }); }, 60); }, 'big');
          } else note(body, '아직 참고 자료가 없습니다. 아래에서 자료를 추가한 뒤 본문에 인용을 넣습니다.');
          body.appendChild(el('div', 'sdx-l', '참고 자료 추가'));
          var gt = row(body, ''); [['책', 'Book'], ['논문(학술지)', 'JournalArticle'], ['웹 페이지', 'InternetSite']].forEach(function (a) { chip(gt, a[0], type === a[1], function () { type = a[1]; collect(); render(); }); });
          fields.author = input(body, '저자(예: 김철수 · 단체 이름도 가능)', fields._a); fields.title = input(body, type === 'InternetSite' ? '페이지 제목' : '제목', fields._t); fields.year = input(body, '연도(예: 2024)', fields._y);
          fields.pub = input(body, type === 'Book' ? '출판사' : (type === 'JournalArticle' ? '학술지 이름' : '주소(https://…)'), fields._p);
          var ga = row(body, ''); chip(ga, '참고 자료 추가', false, function () { var sp = { type: type, author: fields.author.value, title: fields.title.value, year: fields.year.value.trim(), pub: fields.pub.value.trim() };
            env.run('참고 자료', function (pkg) { return MO().addSource(pkg, sp).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { toast(q.err, 3600); return; } toast('참고 자료를 추가했습니다', 2200); fields._a = fields._t = fields._y = fields._p = ''; setTimeout(X.citeAgain, 600); }); h.ctx().closeSheet(); }, 'big on');
          note(body, '인용은 (저자, 연도) 모양으로 들어가는 진짜 워드 인용이고, 자료는 문서 안에 저장되어 워드의 「참고 문헌 관리」에도 나타납니다. 한글 저자는 이름 전체를 한 칸에 적습니다.');
        });
      }
      function collect() { fields._a = fields.author && fields.author.value; fields._t = fields.title && fields.title.value; fields._y = fields.year && fields.year.value; fields._p = fields.pub && fields.pub.value; }
      X.citeAgain = function () { X.citeSheet(); };
      sheetOf('인용·참고문헌', body, [{ label: '닫기' }]); render();
    };

    // ================================================================ 색인
    X.indexSheet = function () {
      var r = need(); if (!r) return; if (!MO()) return;
      var body = el('div', 'sdx');
      function render() {
        env.peek(function (pkg) { return pkg.read('word/document.xml'); }).then(function (x) {
          body.innerHTML = ''; var ent = MO().listIndexEntries(x);
          body.appendChild(el('div', 'sdx-l', '고른 문단을 색인에 올릴 낱말')); var ti = input(body, '낱말(예: 광합성)');
          var ga = row(body, ''); chip(ga, '색인에 올리기', false, function () { var t = ti.value; h.ctx().closeSheet(); setTimeout(function () { opx('색인 표시', function (xx) { return MO().addIndexEntry(xx, r.b, t); }, J('「' + t.trim() + '」', '을') + ' 색인에 올렸습니다(화면에는 보이지 않는 표시입니다)', true); setTimeout(X.indexAgain, 700); }, 60); }, 'big on');
          if (ent.length) {
            body.appendChild(el('div', 'sdx-l', '색인에 올린 낱말 ' + ent.length + '개'));
            ent.slice(0, 40).forEach(function (e) { var rw = el('div', 'sdx-chg'); rw.appendChild(el('div', 'sdx-chl', e.term + ' — 문단 ' + (e.xi + 1))); var br = el('div', 'sdx-r'); chip(br, '표시 지우기', false, function () { h.ctx().closeSheet(); setTimeout(function () { opx('색인 표시 지우기', function (xx) { return MO().removeIndexEntry(xx, e.xi, e.term); }, '색인 표시를 지웠습니다', true); setTimeout(X.indexAgain, 700); }, 60); }, 'danger'); rw.appendChild(br); body.appendChild(rw); });
            var gb = row(body, ''); chip(gb, '색인 목록 넣기·갱신', false, function () { h.ctx().closeSheet(); setTimeout(function () { opx('색인', function (xx) { var q = MO().putIndex(xx, r.b, function (xi) { return env.pageOf(xi); }); return q.err ? q : { xml: q.xml, n: q.n, updated: q.updated }; }, function (q) { return '색인 ' + q.n + '개를 ' + (q.updated ? '갱신했습니다' : '고른 문단 아래에 넣었습니다') + '(쪽 번호는 폰 화면 기준이니 워드에서 「필드 업데이트」를 해 주십시오)'; }, true); }, 60); }, 'big');
          } else note(body, '아직 색인에 올린 낱말이 없습니다. 문단을 고르고 낱말을 적어 「색인에 올리기」를 누릅니다. 낱말을 모두 표시한 뒤 「색인 목록 넣기」를 누르면 가나다순 목록이 만들어집니다.');
          note(body, '색인 표시는 문단 끝에 숨은 표시로 들어가고, 목록은 워드의 진짜 색인(필드)입니다. 쪽 번호는 폰 화면 기준이라 워드에서 「필드 업데이트」로 맞춥니다.');
        });
      }
      X.indexAgain = function () { X.indexSheet(); };
      sheetOf('색인', body, [{ label: '닫기' }]); render();
    };

    // ================================================================ 맞춤법
    var ignored = {};
    X.spellSheet = function () {
      if (!SP()) { toast('맞춤법 사전을 불러오지 못했습니다.', 3200); return; }
      var s = S(); if (!s || !s.doc) { toast('문서를 다 불러온 뒤에 눌러 주십시오.', 2600); return; }
      var items = [], total = 0, noFix = 0;
      s.doc.paras.forEach(function (p, i) {
        var t = env.paraText(i); if (t == null) return;
        SP().check(t).forEach(function (hit) { var key = hit.wrong + '@' + t.slice(Math.max(0, hit.s - 6), hit.e + 6); if (ignored[key]) return; total++; items.push({ xi: i, hit: hit, text: t, key: key, editable: !!p.editable }); });
      });
      var body = el('div', 'sdx');
      note(body, '폰 안의 사전(' + SP().plainCount + '개 낱말 + ' + SP().ruleCount + '개 규칙)으로 자주 틀리는 표기와 띄어쓰기를 짚습니다. 문서의 글은 폰 밖으로 나가지 않습니다. 사전에 없는 오류는 못 찾고, 뜻에 따라 맞을 수도 있는 것은 설명에 적었으니 눌러 보고 고르십시오.');
      if (!items.length) { body.appendChild(el('div', 'sdx-l', '짚은 곳이 없습니다.')); note(body, '사전에 있는 틀린 표기는 찾지 못했습니다. 문장 전체의 문법이나 사전에 없는 표현은 점검하지 못합니다.'); }
      else {
        body.appendChild(el('div', 'sdx-l', '의심되는 곳 ' + total + '개' + (total > 60 ? ' 중 앞의 60개' : '')));
        var fixable = items.filter(function (q) { return q.editable; });
        var ga = row(body, '');
        if (fixable.length) chip(ga, '고칠 수 있는 ' + fixable.length + '곳 모두 바꾸기', false, function () {
          var map = {}; fixable.forEach(function (q) { (map[q.xi] = map[q.xi] || { text: q.text, hits: [] }).hits.push(q.hit); });
          var out = {}; Object.keys(map).forEach(function (k) { out[k] = SP().apply(map[k].text, map[k].hits); });
          ctx().confirm('모두 바꿀까요?', fixable.length + '곳을 사전의 제안대로 바꿉니다. 뜻에 따라 맞는 표기가 섞여 있을 수 있으니 목록을 먼저 훑어보셨습니까? 바꾼 직후에는 ↶ 로 되돌릴 수 있습니다.', '모두 바꾸기', function () { h.ctx().closeSheet(); var q = env.applyTexts(out); toast(q.n + '개 문단을 바꿨습니다', 3000); });
        }, 'big on');
        items.slice(0, 60).forEach(function (q) {
          var rw = el('div', 'sdx-chg'), a = q.text.slice(Math.max(0, q.hit.s - 7), q.hit.s), b = q.text.slice(q.hit.e, q.hit.e + 7), lab = el('div', 'sdx-chl');
          lab.appendChild(document.createTextNode('문단 ' + (q.xi + 1) + ' · …' + a)); var w = el('b', '', q.hit.wrong); w.style.cssText = 'color:#c0392b;text-decoration:line-through'; lab.appendChild(w); lab.appendChild(document.createTextNode(' → ')); var rr = el('b', '', q.hit.right); rr.style.color = '#1b8a3a'; lab.appendChild(rr); lab.appendChild(document.createTextNode(b + '…'));
          rw.appendChild(lab); if (q.hit.why) rw.appendChild(el('div', 'so-sheet-note', q.hit.why));
          var br = el('div', 'sdx-r');
          if (q.editable) chip(br, '바꾸기', false, function () { var nt = q.text.slice(0, q.hit.s) + q.hit.right + q.text.slice(q.hit.e), m = {}; m[q.xi] = nt; h.ctx().closeSheet(); env.applyTexts(m); toast('바꿨습니다', 1800); setTimeout(X.spellAgain, S().track ? 1200 : 300); }, 'on');
          else br.appendChild(el('span', 'so-sheet-note', '이 문단은 폰에서 고칠 수 없습니다(그림·필드·링크 등이 섞임). 워드에서 고쳐 주십시오.'));
          chip(br, '그대로 두기', false, function () { ignored[q.key] = 1; h.ctx().closeSheet(); setTimeout(X.spellAgain, 150); });
          chip(br, '이 문단 보기', false, function () { h.ctx().closeSheet(); env.select(q.xi, q.xi); });
          rw.appendChild(br); body.appendChild(rw);
        });
      }
      sheetOf('맞춤법 점검', body, [{ label: '닫기' }]);
    };
    X.spellAgain = function () { X.spellSheet(); };

    // ================================================================ 문서 비교
    X.compareSheet = function () {
      if (!TR()) { toast('비교 부품을 불러오지 못했습니다.', 3200); return; }
      var body = el('div', 'sdx'), file = null;
      note(body, '지금 열린 문서(옛 것)와 고른 워드 문서(새 것)를 문단마다 견줘, 다른 곳을 변경 내용(삽입·삭제 표시)으로 지금 문서에 표시합니다. 표시 뒤 「검토」에서 하나씩 수락·거절할 수 있고, 「사본 저장」으로 저장하면 원본 파일은 그대로입니다. 글만 비교하며 서식·그림·표 모양의 차이는 보지 않습니다.');
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'; inp.style.cssText = 'width:100%;margin:8px 0';
      var lab = el('div', 'sdx-chl', '고른 파일: 없음'); body.appendChild(inp); body.appendChild(lab);
      inp.onchange = function () { file = inp.files && inp.files[0]; lab.textContent = '고른 파일: ' + (file ? file.name + ' (' + Math.round(file.size / 1024) + 'KB)' : '없음'); };
      sheetOf('문서 비교', body, [{ label: '닫기' }, { label: '비교하기', primary: true, onClick: function () {
        if (!file) { toast('비교할 새 문서(.docx)를 먼저 골라 주십시오.', 2800); return false; }
        var f = file; f.arrayBuffer().then(function (ab) { return global.JSZip.loadAsync(ab); }).then(function (oz) {
          var dz = oz.file('word/document.xml'); if (!dz) throw new Error('고른 파일이 워드(.docx) 문서가 아닙니다.');
          return Promise.all([dz.async('string'), oz.file('word/styles.xml') ? oz.file('word/styles.xml').async('string') : Promise.resolve('')]);
        }).then(function (pair) {
          env.run('문서 비교', function (pkg) { return Promise.all([pkg.read('word/document.xml'), pkg.read('word/styles.xml')]).then(function (cur) {
            var ids = {}; (cur[1] || '').replace(/<w:style\b[^>]*w:styleId="([^"]*)"/g, function (m, id) { ids[id] = 1; return m; });
            var q = TR().compare(cur[0], pair[0], { styleIds: ids }); if (q.err) return q; pkg.write('word/document.xml', q.xml); return { stats: q.stats };
          }); }, function (q) { if (q && q.err) { fail(q.err); return; } var st = q.stats; toast('다른 곳을 변경 내용으로 표시했습니다 — 바뀐 문단 ' + st.changed + ' · 지운 문단 ' + st.deleted + ' · 새 문단 ' + st.inserted + (st.skipped.length ? ' · 표시하지 못한 곳 ' + st.skipped.length : ''), 6000); if (st.skipped.length) setTimeout(function () { ctx().confirm('표시하지 못한 곳 ' + st.skipped.length + '개', st.skipped.slice(0, 8).join('\n') + (st.skipped.length > 8 ? '\n…' : '') + '\n\n이런 곳은 워드의 「비교」 기능으로 확인해 주십시오.', '확인', function () {}); }, 600); });
        }).catch(function (e) { toast('비교하지 못했습니다: ' + ((e && e.message) || e), 4600); });
        return true;
      } }]);
    };

    // ================================================================ 변경 기록(검토 시트 안)
    X.trackGroup = function (body, trk, reviewAgain) {
      body.appendChild(el('div', 'sdx-l', '변경 기록'));
      var g3 = el('div', 'sdx-g'); body.appendChild(g3);
      function setT(on) { env.run('변경 기록', function (pkg) { return ST.setTrack(pkg, on).then(function (z) { return z.err ? z : {}; }); }, function (z) { if (z && z.err) { fail(z.err); return; } toast(on ? '변경 기록을 켰습니다. 이제 글 고치기·문단 넣기·지우기가 삽입·삭제 표시로 남습니다.' : '변경 기록을 껐습니다. 이미 남은 변경 내용은 위에서 수락·거절합니다.', 4600); }); }
      var tb = el('button', 'sdx-b big' + (trk ? '' : ' on'), trk ? '변경 기록 끄기' : '변경 기록 켜기'); tb.type = 'button'; tb.onclick = function () { h.ctx().closeSheet(); setTimeout(function () { setT(!trk); }, 60); }; g3.appendChild(tb);
      body.appendChild(el('div', 'so-sheet-note', trk ? '변경 기록이 켜져 있습니다. 글 고치기와 문단 넣기·지우기는 삽입·삭제 표시로 남습니다(워드에서 변경 내용으로 보입니다). 서식·표·그림·머리글을 고친 것은 변경 기록에 남지 않고 바로 반영됩니다.' : '변경 기록을 켜면 글을 고친 곳이 삽입·삭제 표시로 남아, 워드에서 누가 무엇을 바꿨는지 볼 수 있습니다. 서식·표·그림 고침은 기록하지 않습니다. 켜지 않으면 고친 내용이 기록 없이 바로 반영됩니다.'));
    };
    X.reviewButtons = function (body) {
      var g = el('div', 'sdx-g'); body.appendChild(g);
      function b2(t, fn) { var b = el('button', 'sdx-b big', t); b.type = 'button'; b.onclick = function () { h.ctx().closeSheet(); setTimeout(fn, 60); }; g.appendChild(b); }
      b2('맞춤법 점검', X.spellSheet); b2('문서 비교', X.compareSheet);
    };
    return X;
  }
  global.SODocxUIMore = { create: create };
})(window);
