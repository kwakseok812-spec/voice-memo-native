/* ============================================================================
 * so-hwp-obj.js — S-Office 한글 6회차(O-0861, v10.9): 도형·글상자·수식 넣기 · 개체(그림·도형·수식) 고치기(그림 효과·캡션 포함) · 스타일 · 문단 번호 모양 · 쪽 번호 새로 시작
 * ----------------------------------------------------------------------------
 * so-hwp-tools.js(맥락 도구줄)가 스위치 SO_HWP_OBJ 가 켜졌을 때만 불러온다. 새 외부 부품 없음 — 이미 들어 있는 한글 엔진(rhwp)의 함수를 폰 시트로 연결한다.
 *   · 엔진이 끌어서 놓는 방식으로만 쓰던 개체 넣기(createShapeControl·insertEquation)를 크기·색·글을 값으로 받아 «커서 자리에» 넣는다(끌기 없음).
 *   · 넣은 개체는 눌러서 고르면(그림 고르기와 같은 방식) 「개체 고치기」에서 크기·색·선·회전·놓는 방식·캡션·그림 효과·수식 글을 고친다.
 *   · 모든 고침은 executeOperation 한 번(= 「취소」 한 번)으로 되돌아간다. 표 안·머리말·각주 안 개체는 건드리지 않는다(안내).
 * 단위: 엔진은 HWP 단위(1mm ≈ 283.46). 색은 COLORREF(0xBBGGRR).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var HU = 283.465;
  function mm2hu(mm) { return Math.max(1, Math.round(Number(mm) * HU)); }
  function hu2mm(hu) { return Math.round(Number(hu) / HU * 10) / 10; }
  function cref(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return 0; var n = parseInt(m[1], 16); return ((n & 255) << 16) | (n & 0xff00) | (n >> 16 & 255); }
  function hex(c) { c = Number(c) || 0; var r = c & 255, g = c >> 8 & 255, b = c >> 16 & 255; return '#' + [r, g, b].map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function J(x) { return typeof x === 'string' ? JSON.parse(x) : x; }
  function inCell(t) { return t.parentParaIndex !== undefined && t.controlIndex !== undefined && t.cellIndex !== undefined; }
  function msgOf(e) { return String((e && e.message) || e); }

  // 눌러서 고른 개체(본문 개체만). 반환 { ok, ref:{sec,ppi,ci,type} } 또는 { ok:false, why }
  function selRef(h) {
    var r = null; try { r = h.getSelectedPictureRef(); } catch (e) {}
    if (!r) return { ok: false, why: 'nosel' };
    if (r.cellPath || r.cellIdx !== undefined && r.cellIdx !== null && r.cellIdx >= 0 || r.noteRef || r.headerFooter) return { ok: false, why: 'nested' };
    return { ok: true, ref: r };
  }
  function kindOf(t) { t = String(t || ''); if (t === 'equation') return 'eq'; if (t === 'image' || t === 'picture') return 'pic'; if (t === 'shape' || t === 'line' || t === 'textbox') return 'shape'; return 'other:' + t; }
  function selectAfter(h, S, P, C, type) {      // 방금 넣은 개체를 골라 둔 상태로(스튜디오가 그림을 넣은 뒤 하는 일과 같은 순서)
    try { h.cursor.enterPictureObjectSelectionDirect(S, P, C, type); if (h.caret && h.caret.hide) h.caret.hide(); if (h.selectionRenderer && h.selectionRenderer.clear) h.selectionRenderer.clear(); if (h.renderPictureObjectSelection) h.renderPictureObjectSelection(); if (h.eventBus && h.eventBus.emit) h.eventBus.emit('picture-object-selection-changed', true); return true; } catch (e) { return false; }
  }

  // 도형 종류별 꼴(HWP 단위 폭×높이 안의 좌표)
  function poly(kind, w, h) {
    if (kind === 'tri') return [{ x: Math.round(w / 2), y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: Math.round(w / 2), y: 0 }];
    if (kind === 'diamond') return [{ x: Math.round(w / 2), y: 0 }, { x: w, y: Math.round(h / 2) }, { x: Math.round(w / 2), y: h }, { x: 0, y: Math.round(h / 2) }, { x: Math.round(w / 2), y: 0 }];
    return null;
  }
  var WRAP = { char: null, top: 'TopAndBottom', front: 'InFrontOfText', behind: 'BehindText', square: 'Square' };

  var EXT = {
    // 개체 넣기. args = { kind: textbox|rect|round|ellipse|tri|diamond|line|arrow, wmm, hmm, text, fill:'none'|'#rrggbb', stroke:'#rrggbb', strokeW:0.1~2(mm), place: char|top|front|behind }
    objAdd: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var S = t.sectionIndex, P = t.paragraphIndex, at = t.charOffset || 0, kind = String(args.kind || 'rect'), w = mm2hu(args.wmm || 50), hh = kind === 'line' || kind === 'arrow' ? 0 : mm2hu(args.hmm || 30);
      var type = kind === 'textbox' ? 'textbox' : (kind === 'ellipse' ? 'ellipse' : (kind === 'line' || kind === 'arrow' ? 'line' : (poly(kind, 1, 1) ? 'polygon' : 'rectangle')));
      var res = { ok: true, kind: kind }, place = args.place || 'char', text = String(args.text || '').replace(/[\r\n\t]+/g, ' ').trim();
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'createShapeControl', operation: function (i) {
          var req = { sectionIdx: S, paraIdx: P, charOffset: at, width: w, height: hh, horzOffset: 0, vertOffset: 0, shapeType: type, treatAsChar: place === 'char' };
          if (place !== 'char') req.textWrap = WRAP[place] || 'Square';
          var pts = poly(kind, w, hh); if (pts) req.polygonPoints = pts;
          var r = J(i.createShapeControl(req)); if (!r || !r.ok) throw new Error('shape');
          res.para = r.paraIdx; res.ci = r.controlIdx; res.type = type;
          var props = {};
          if (args.fill === 'none') props.fillType = 'none'; else if (args.fill) { props.fillType = 'solid'; props.fillBgColor = cref(args.fill); }
          if (args.stroke) props.borderColor = cref(args.stroke);
          if (args.strokeW) props.borderWidth = Math.max(1, Math.round(Number(args.strokeW) * 100 / 3.5));      // 엔진 선 굵기 단위(0.1mm ≈ 3.5)로 어림
          if (kind === 'round') props.roundRate = 25;
          if (kind === 'arrow') props.arrowEnd = 1;
          if (Object.keys(props).length) i.setShapeProperties(S, r.paraIdx, r.controlIdx, props);
          if (text) { try { i.insertTextInCell(S, r.paraIdx, r.controlIdx, 0, 0, 0, text); res.text = true; } catch (e) { res.textFail = msgOf(e); } }
          return t;
        } });
      } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      res.selected = selectAfter(h, S, res.para, res.ci, type === 'line' ? 'line' : 'shape');
      return res;
    },
    // 수식 넣기. args = { script, sizePt, color }
    eqAdd: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var script = String(args.script || '').replace(/[\r\n]+/g, ' ').trim(); if (!script) return { ok: false, why: 'noscript' };
      var res = { ok: true };
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'insertEquation', operation: function (i) {
          var r = J(i.insertEquation(t.sectionIndex, t.paragraphIndex, t.charOffset || 0, script, Math.round((args.sizePt || 10) * 100), cref(args.color || '#000000')));
          if (!r || !r.ok) throw new Error('eq'); res.para = r.paraIdx; res.ci = r.controlIdx; return t;
        } });
      } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      res.selected = selectAfter(h, t.sectionIndex, res.para, res.ci, 'equation');
      return res;
    },
    // 고른 개체의 속성(시트 채우기용)
    objInfo: function (a) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var s = selRef(h); if (!s.ok) return s; var r = s.ref, k = kindOf(r.type), d = a.wasm, p;
      try {
        if (k === 'pic') p = J(d.getPictureProperties(r.sec, r.ppi, r.ci));
        else if (k === 'shape') p = J(d.getShapeProperties(r.sec, r.ppi, r.ci));
        else if (k === 'eq') p = J(d.getEquationProperties(r.sec, r.ppi, r.ci, -1, -1));
        else return { ok: false, why: 'unsupported', type: r.type };
      } catch (e) { return { ok: false, why: 'engine', msg: msgOf(e) }; }
      var o = { ok: true, kind: k, type: r.type, wmm: hu2mm(p.width), hmm: hu2mm(p.height), asChar: !!p.treatAsChar, wrap: p.textWrap, rot: p.rotationAngle || 0, hflip: !!p.horzFlip, vflip: !!p.vertFlip,
        cap: !!p.hasCaption, capDir: p.captionDirection || 'Bottom', desc: p.description || '' };
      if (k === 'shape') { o.fill = p.fillType === 'solid' ? hex(p.fillBgColor) : null; o.stroke = hex(p.borderColor); o.strokeW = p.borderWidth; o.round = p.roundRate || 0; o.shadow = !!p.shadowType; }
      if (k === 'pic') { o.effect = p.effect; o.bright = p.brightness || 0; o.contrast = p.contrast || 0; o.alpha = p.transparency || 0; }
      if (k === 'eq') { o.script = p.script; o.size = Math.round((p.fontSize || 1000) / 100); o.color = hex(p.color); }
      return o;
    },
    // 고른 개체 고치기. args = { props:{...엔진 속성}, script?, sizePt? } — 속성은 개체 종류에 맞는 것만 넘긴다(시트가 정함)
    objSet: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var s = selRef(h); if (!s.ok) return s; var r = s.ref, k = kindOf(r.type), props = Object.assign({}, args.props || {});
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'setObjectProperties', operation: function (i) {
          if (k === 'pic') i.setPictureProperties(r.sec, r.ppi, r.ci, props);
          else if (k === 'shape') i.setShapeProperties(r.sec, r.ppi, r.ci, props);
          else if (k === 'eq') { if (args.script != null) props.script = String(args.script); i.setEquationProperties(r.sec, r.ppi, r.ci, -1, -1, props); }
          else throw new Error('unsupported');
          return { sectionIndex: r.sec, paragraphIndex: r.ppi, charOffset: 0 };
        } });
      } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      selectAfter(h, r.sec, r.ppi, r.ci, r.type);
      return { ok: true };
    },
    // 스타일 목록 + 지금 문단의 스타일
    styList: function (a) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(), d = a.wasm, cur = null;
      try { cur = J(d.getStyleAt(t.sectionIndex, t.paragraphIndex)); } catch (e) {}
      var list = J(d.getStyleList()) || [];
      return { ok: true, cur: cur && cur.id != null ? cur.id : (typeof cur === 'number' ? cur : null), list: list.map(function (s) { return { id: s.id, name: s.name, type: s.type }; }) };
    },
    // 스타일 적용(커서가 든 문단, 또는 고른 글의 문단들)
    styApply: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      try { h.executeOperation({ kind: 'snapshot', operationType: 'applyStyle', operation: function (i) { i.applyStyle(t.sectionIndex, t.paragraphIndex, Number(args.id)); return t; } }); } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      return { ok: true };
    },
    // 새 스타일 만들기: 이름 + (글자·문단 모양은 값으로). args = { name, type:0|1, mods:{char:{...},para:{...}} }
    styAdd: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var name = String(args.name || '').trim().replace(/[\r\n\t]+/g, ' '); if (!name) return { ok: false, why: 'noname' };
      var res = { ok: true };
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'createStyle', operation: function (i) {
          var list = J(i.getStyleList()) || []; if (list.some(function (s) { return s.name === name; })) throw new Error('dup');
          var id = i.createStyle(JSON.stringify({ name: name, englishName: name, type: args.type ? 1 : 0, nextStyleId: 0 }));
          if (typeof id !== 'number' || id < 0) throw new Error('create');
          res.id = id; var m = args.mods || {};
          i.updateStyleShapes(id, JSON.stringify(m.char || {}), JSON.stringify(m.para || {}));
          return h.getCursorPosition();
        } });
      } catch (err) { return { ok: false, why: String(msgOf(err)) === 'dup' ? 'dup' : 'engine', msg: msgOf(err) }; }
      return res;
    },
    // 스타일 모양 고치기 / 이름 바꾸기 / 지우기. args = { id, name?, mods?, del? }
    styEdit: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var id = Number(args.id);
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'updateStyle', operation: function (i) {
          if (args.del) { if (!i.deleteStyle(id)) throw new Error('del'); }
          else {
            if (args.name) i.updateStyle(id, JSON.stringify({ name: String(args.name).trim() }));
            if (args.mods) i.updateStyleShapes(id, JSON.stringify(args.mods.char || {}), JSON.stringify(args.mods.para || {}));
          }
          return h.getCursorPosition();
        } });
      } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      return { ok: true };
    },
    // 스타일 현재 값(고치기 시트용)
    styDetail: function (a, args) {
      try { var d = J(a.wasm.getStyleDetail(Number(args.id))); return { ok: true, c: d.charProps || {}, p: d.paraProps || {} }; } catch (e) { return { ok: false, msg: msgOf(e) }; }
    },
    // 문단 번호 모양 만들어 이 문단에 적용. args = { fmt: 'dot'|'paren'|'hanja'|'circle'|'alpha'|'roman'|'bullet', start }
    numApply: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var F = {
        dot: { lv: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], nf: [0, 0, 0, 0, 0, 0, 0] },
        paren: { lv: ['^1)', '^2)', '^3)', '^4)', '(^5)', '(^6)', '^7'], nf: [0, 0, 0, 0, 0, 0, 0] },
        hanja: { lv: ['^1', '^2', '^3', '^4', '^5', '^6', '^7'], nf: [0, 0, 0, 0, 0, 0, 0] },
        circle: { lv: ['^1', '^2', '^3', '^4', '^5', '^6', '^7'], nf: [1, 1, 1, 1, 1, 1, 1] },
        alpha: { lv: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], nf: [8, 8, 8, 8, 8, 8, 8] },
        roman: { lv: ['^1.', '^2.', '^3.', '^4.', '^5.', '^6.', '^7.'], nf: [4, 4, 4, 4, 4, 4, 4] }
      };
      var f = F[args.fmt] || F.dot, res = { ok: true };
      try {
        h.executeOperation({ kind: 'snapshot', operationType: 'createNumbering', operation: function (i) {
          var id = i.createNumbering(JSON.stringify({ levelFormats: f.lv, numberFormats: f.nf, startNumber: Math.max(1, Number(args.start) || 1) }));
          if (typeof id !== 'number' || id <= 0) throw new Error('numbering'); res.id = id;
          return t;
        } });
        h.applyParaFormat({ headType: 'Number', numberingId: res.id, paraLevel: 0 });
      } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      return res;
    },
    // 쪽 번호 새로 시작(커서 자리에 「새 번호」). args = { n }
    pageNewNum: function (a, args) {
      var h = a.getInputHandler(); if (!h) return { ok: false };
      var t = h.getCursorPosition(); if (inCell(t)) return { ok: false, why: 'intable' };
      var n = Math.max(1, Math.min(9999, Math.round(Number(args.n) || 1)));
      try { h.executeOperation({ kind: 'snapshot', operationType: 'insertNewNumber', operation: function (i) { var r = J(i.insertNewNumber(t.sectionIndex, t.paragraphIndex, t.charOffset || 0, n)); if (r && r.ok === false) throw new Error('nn'); return t; } }); } catch (err) { return { ok: false, why: 'engine', msg: msgOf(err) }; }
      return { ok: true, n: n };
    }
  };

  // ============================================================ 화면(시트) — so-hwp-tools.js 의 create() 안에서 부른다
  // H = { env, T, runExt, el, toast, act, go, chipsRow, textIn }
  var COL = [['없음', 'none'], ['흰색', '#ffffff'], ['연노랑', '#fff7cc'], ['연하늘', '#e3f0ff'], ['연두', '#e5f5d8'], ['분홍', '#ffe3ea'], ['회색', '#d9d9d9'], ['진파랑', '#1c5fd6'], ['빨강', '#e02020']];
  var LINE = [['검정', '#000000'], ['파랑', '#1c5fd6'], ['빨강', '#e02020'], ['초록', '#1b8a3a'], ['회색', '#777777']];
  var KINDS = [['textbox', '글상자'], ['rect', '사각형'], ['round', '둥근 사각형'], ['ellipse', '타원'], ['tri', '삼각형'], ['diamond', '마름모'], ['line', '선'], ['arrow', '화살표']];
  var SIZES = [['작게', 30, 20], ['보통', 50, 30], ['크게', 80, 50], ['폭 가득', 150, 40]];
  var EQ_TPL = [['분수', '{a} over {b}'], ['제곱', 'x^{2}'], ['아래 첨자', 'x_{i}'], ['제곱근', 'sqrt {x}'], ['합', 'sum from {i=1} to {n} a_{i}'], ['적분', 'int from {a} to {b} f(x) dx'], ['극한', 'lim from {x -> 0} {sin x} over {x}'], ['괄호 분수', 'left ( {a} over {b} right )'], ['행렬', 'matrix {a # b ## c # d}'], ['그리스', 'alpha beta gamma theta pi'], ['≤ ≥ ≠', 'a <= b >= c != d'], ['곱', 'prod from {i=1} to {n} x_{i}']];

  function sheets(H) {
    var el = H.el, env = H.env, toast = H.toast, runExt = H.runExt;
    function numIn(body, label, val, min, max, step) {
      body.appendChild(el('div', 'so-opt-l', label)); var i = el('input', 'sp-ta'); i.type = 'number'; i.inputMode = 'decimal'; i.min = min; i.max = max; i.step = step || 1; i.value = val; body.appendChild(i); return i;
    }
    function colorRow(body, label, list, st, key, cur) {
      var row = H.chipsRow(body, label, list.map(function (c) { return [c[1], c[0]]; }), st, key, true);
      if (cur != null) [].slice.call(row.children).forEach(function (b, k) { if (list[k][1] === cur) b.classList.add('on'); });
      return row;
    }
    function why(r, what) {
      if (r && r.why === 'intable') return '표 안에서는 쓸 수 없습니다. 표 밖 글 위에 커서를 두십시오.';
      if (r && r.why === 'nosel') return '먼저 고칠 개체(도형·그림·수식)를 눌러 고른 뒤 눌러 주십시오.';
      if (r && r.why === 'nested') return '표·머리말·각주 안의 개체는 여기서 고칠 수 없습니다. 표 밖 본문의 개체만 됩니다.';
      if (r && r.why === 'unsupported') return '이 종류의 개체는 아직 고칠 수 없습니다(그림·도형·글상자·수식만 됩니다).';
      if (r && r.why === 'noscript') return '수식을 적어 주십시오.';
      if (r && r.why === 'noname') return '이름을 적어 주십시오.';
      if (r && r.why === 'dup') return '같은 이름의 스타일이 이미 있습니다.';
      return what + '을 하지 못했습니다.' + (r && r.msg ? ' (' + r.msg + ')' : '');
    }
    function doAct(name, args, okMsg, what, after) {
      runExt(name, args).then(function (r) { if (r && r.ok) { env.markDirty(); H.T.sync(true); toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 3400); if (after) after(r); } else toast(why(r, what), 4200); });
    }

    // ---------------- 도형·글상자 넣기
    function shapeSheet() {
      var body = el('div'), st = { kind: 'rect', size: 1, fill: '#e3f0ff', stroke: '#000000', place: 'char' };
      var kr = H.chipsRow(body, '무엇을 넣을까요', KINDS, st, 'kind', true); kr.children[1].classList.add('on');
      var sr = el('div', 'so-opt'); sr.appendChild(el('div', 'so-opt-l', '크기')); var srow = el('div', 'so-opt-r wrap');
      SIZES.forEach(function (s, k) { var b = el('button', 'so-opt-b' + (k === 1 ? ' on' : ''), s[0] + ' ' + s[1] + '×' + s[2] + 'mm'); b.type = 'button'; b.onclick = function () { st.size = k; wi.value = s[1]; hi.value = s[2]; [].slice.call(srow.children).forEach(function (x) { x.classList.toggle('on', x === b); }); }; srow.appendChild(b); });
      sr.appendChild(srow); body.appendChild(sr);
      var wi = numIn(body, '가로(mm)', 50, 5, 180, 1), hi = numIn(body, '세로(mm, 선·화살표는 안 씀)', 30, 5, 250, 1);
      colorRow(body, '안 색', COL, st, 'fill', '#e3f0ff'); colorRow(body, '선 색', LINE, st, 'stroke', '#000000');
      H.chipsRow(body, '놓는 방식', [['char', '글자처럼'], ['top', '글 위아래'], ['front', '글 앞'], ['behind', '글 뒤']], st, 'place').children[0].classList.add('on');
      var tx = H.textIn(body, '안에 넣을 글(글상자에만 들어갑니다. 비워도 됩니다)', '예: 신청 기간', 120);
      body.appendChild(el('div', 'so-sheet-note', '커서가 있는 자리에 들어갑니다. 넣은 뒤 도형을 한 번 누르면 「개체 고치기」로 색·크기를 다시 바꿀 수 있습니다. 표 안에는 넣지 않습니다. 한컴 한글에서 열어 한 번 확인해 주십시오.'));
      env.ctx.sheet({ title: '도형·글상자 넣기', body: body, wide: true, buttons: [{ label: '취소' }, { label: '넣기', primary: true, onClick: function () {
        var w = parseFloat(wi.value), h = parseFloat(hi.value);
        if (!(w >= 5 && w <= 180)) { toast('가로는 5~180mm 로 적어 주십시오.', 2600); return false; }
        if (st.kind !== 'line' && st.kind !== 'arrow' && !(h >= 5 && h <= 250)) { toast('세로는 5~250mm 로 적어 주십시오.', 2600); return false; }
        var a = { kind: st.kind, wmm: w, hmm: h, text: tx.value, fill: st.fill, stroke: st.stroke, place: st.place };
        function put() { doAct('objAdd', a, function (r) { var nm; return (KINDS.filter(function (k) { return k[0] === r.kind; })[0] || ['', '개체'])[1] + (/[가-힣]$/.test(nm = (KINDS.filter(function (k) { return k[0] === r.kind; })[0] || ['', '개체'])[1]) && ((nm.charCodeAt(nm.length - 1) - 0xAC00) % 28) ? '을' : '를') + ' 넣었습니다' + (r.textFail ? '(이 도형에는 글을 넣지 못했습니다 — 글상자를 쓰십시오)' : '') + '. 누르면 고칠 수 있습니다.'; }, '도형 넣기'); }
        if (st.kind === 'textbox' && env.ctx.ext !== 'hwpx') {      // .hwp(옛 형식)로 저장한 글상자는 한컴 한글이 열지 못했다(시험) — 막지 않고 .hwpx 사본으로 가는 길을 준다
          setTimeout(function () { env.ctx.confirm('글상자는 .hwpx 사본으로 저장해야 합니다', '글상자가 든 문서를 .hwp(옛 형식)로 저장하면 한컴 한글이 열지 못했습니다(시험 확인). 이 문서를 .hwpx 형식의 사본으로 저장하도록 바꾼 뒤 글상자를 넣을까요? 원본 파일은 그대로이고, .hwpx 는 한컴 한글 2014 이상에서 열립니다. 글상자 말고 사각형·타원 같은 도형이나 수식만 넣으려면 「취소」를 누르십시오(그것들은 .hwp 로도 열립니다).', '.hwpx로 바꾸고 넣기', function () { env.ctx.ext = 'hwpx'; put(); }, { cancelLabel: '취소' }); }, 80);
          return true;
        }
        setTimeout(put, 60); return true; } }] });
    }

    // ---------------- 수식 넣기
    function eqSheet(editing) {
      var body = el('div'), st = { tpl: null }, ta = el('textarea', 'sp-ta'); ta.rows = 3; ta.placeholder = '예: {a+b} over {c}'; ta.style.cssText = 'width:100%;box-sizing:border-box;font:15px/1.5 monospace';
      var prev = el('div', 'so-sheet-note'); prev.style.cssText = 'min-height:44px;text-align:center;background:#fff;color:#000;border-radius:8px;padding:6px';
      body.appendChild(el('div', 'so-opt-l', '틀(누르면 아래 식에 붙습니다)')); var tr = el('div', 'so-opt-r wrap');
      EQ_TPL.forEach(function (t) { var b = el('button', 'so-opt-b', t[0]); b.type = 'button'; b.onclick = function () { ta.value = (ta.value ? ta.value + ' ' : '') + t[1]; ta.dispatchEvent(new Event('input')); }; tr.appendChild(b); });
      body.appendChild(tr); body.appendChild(el('div', 'so-opt-l', '식(한글 수식 글)')); body.appendChild(ta);
      var sz = numIn(body, '글자 크기(pt)', 10, 6, 40, 1); body.appendChild(el('div', 'so-opt-l', '미리 보기')); body.appendChild(prev);
      body.appendChild(el('div', 'so-sheet-note', '한글의 수식 글을 씁니다. 분수 「a over b」, 제곱 「x^2」, 아래 첨자 「x_i」, 제곱근 「sqrt x」, 묶음은 중괄호 「{ }」. 위 틀을 누르면 틀이 들어갑니다. 한컴 한글에서 열어 한 번 확인해 주십시오.'));
      var tmr = null;
      ta.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { runExt('eqPrev', { script: ta.value, sizePt: parseFloat(sz.value) || 10 }).then(function (r) { if (r && r.ok && r.svg) { prev.innerHTML = ''; var im = document.createElement('div'); im.innerHTML = r.svg; prev.appendChild(im); } else if (r && r.ok) prev.textContent = '(미리 보기 없음)'; }); }, 350); });
      var title = editing ? '수식 고치기' : '수식 넣기';
      if (editing) runExt('objInfo').then(function (r) { if (r && r.ok && r.kind === 'eq') { ta.value = r.script; sz.value = r.size; ta.dispatchEvent(new Event('input')); } });
      env.ctx.sheet({ title: title, body: body, wide: true, buttons: [{ label: '취소' }, { label: editing ? '고치기' : '넣기', primary: true, onClick: function () {
        if (!ta.value.trim()) { toast('수식을 적어 주십시오.', 2400); return false; }
        var script = ta.value, size = parseFloat(sz.value) || 10;
        setTimeout(function () { if (editing) doAct('objSet', { script: script, props: { fontSize: Math.round(size * 100) } }, '수식을 고쳤습니다', '수식 고치기'); else doAct('eqAdd', { script: script, sizePt: size }, '수식을 넣었습니다. 누르면 고칠 수 있습니다.', '수식 넣기'); }, 60); return true; } }] });
    }

    // ---------------- 개체 고치기(고른 그림·도형·글상자·수식)
    function objSheet() {
      runExt('objInfo').then(function (r) {
        if (!r || !r.ok) { toast(why(r, '개체 불러오기'), 4200); return; }
        if (r.kind === 'eq') { eqSheet(true); return; }
        var body = el('div'), st = {}, pr = {}, isShape = r.kind === 'shape', isPic = r.kind === 'pic';
        body.appendChild(el('div', 'so-sheet-note', (isPic ? '그림' : (r.type === 'line' ? '선' : '도형·글상자')) + ' — 지금 ' + r.wmm + '×' + r.hmm + 'mm. 바꾸지 않은 칸은 그대로 둡니다.'));
        var wi = numIn(body, '가로(mm)', r.wmm, 3, 400, 0.5), hi = r.type === 'line' ? null : numIn(body, '세로(mm)', r.hmm, 3, 400, 0.5);
        if (isShape && r.type !== 'line') { colorRow(body, '안 색', COL, st, 'fill', r.fill === null ? 'none' : r.fill); }
        if (isShape) { colorRow(body, r.type === 'line' ? '선 색' : '테두리 색', LINE, st, 'stroke', r.stroke); H.chipsRow(body, '그림자', [['0', '없음'], ['1', '있음']], st, 'shadow').children[r.shadow ? 1 : 0].classList.add('on'); }
        if (isPic) {
          H.chipsRow(body, '그림 효과', [['RealPic', '원래대로'], ['GrayScale', '회색조'], ['BlackWhite', '흑백']], st, 'effect').children[Math.max(0, ['RealPic', 'GrayScale', 'BlackWhite'].indexOf(r.effect))].classList.add('on');
          var bi = numIn(body, '밝기(-50 ~ 50)', r.bright, -50, 50, 5), ci = numIn(body, '대비(-50 ~ 50)', r.contrast, -50, 50, 5), ai = numIn(body, '투명도(0 ~ 80 %)', r.alpha, 0, 80, 5);
        }
        var ro = numIn(body, '돌리기(도, 시계 방향)', r.rot, 0, 359, 15);
        H.chipsRow(body, '뒤집기', [['none', '그대로'], ['h', '좌우'], ['v', '위아래'], ['hv', '둘 다']], st, 'flip').children[(r.hflip ? 1 : 0) + (r.vflip ? 2 : 0) === 0 ? 0 : ((r.hflip && r.vflip) ? 3 : (r.hflip ? 1 : 2))].classList.add('on');
        H.chipsRow(body, '놓는 방식', [['keep', '그대로'], ['char', '글자처럼'], ['top', '글 위아래'], ['front', '글 앞'], ['behind', '글 뒤']], st, 'place').children[0].classList.add('on');
        H.chipsRow(body, '캡션(그림·도형 이름 붙이기)', [['keep', '그대로'], ['off', '없음'], ['Bottom', '아래'], ['Top', '위'], ['Left', '왼쪽'], ['Right', '오른쪽']], st, 'cap').children[0].classList.add('on');
        body.appendChild(el('div', 'so-sheet-note', '캡션은 「그림 1」「표 1」처럼 번호가 자동으로 붙습니다. 캡션 글을 바꾸려면 문서에서 그 글을 눌러 고치십시오(한컴 한글에서도 됩니다). 대체 글(그림 설명)은 아래에서 고칩니다.'));
        var di = H.textIn(body, '대체 글(눈이 불편한 분께 읽어 주는 그림 설명)', '', 120); di.value = r.desc || '';
        env.ctx.sheet({ title: '개체 고치기', body: body, wide: true, buttons: [{ label: '취소' }, { label: '적용', primary: true, onClick: function () {
          var p = {}, w = parseFloat(wi.value), hh = hi ? parseFloat(hi.value) : null;
          if (w > 0 && Math.abs(w - r.wmm) > 0.05) p.width = mm2hu(w);
          if (hi && hh > 0 && Math.abs(hh - r.hmm) > 0.05) p.height = mm2hu(hh);
          if (isShape && st.fill !== undefined) { if (st.fill === 'none') p.fillType = 'none'; else { p.fillType = 'solid'; p.fillBgColor = cref(st.fill); } }
          if (isShape && st.stroke) p.borderColor = cref(st.stroke);
          if (isShape && st.shadow !== undefined) { p.shadowType = st.shadow === '1' ? 1 : 0; if (st.shadow === '1') { p.shadowColor = cref('#808080'); p.shadowOffsetX = 280; p.shadowOffsetY = 280; } }
          if (isPic) { if (st.effect) p.effect = st.effect; var b = parseInt(bi.value, 10), c = parseInt(ci.value, 10), al = parseInt(ai.value, 10); if (!isNaN(b) && b !== r.bright) p.brightness = Math.max(-50, Math.min(50, b)); if (!isNaN(c) && c !== r.contrast) p.contrast = Math.max(-50, Math.min(50, c)); if (!isNaN(al) && al !== r.alpha) p.transparency = Math.max(0, Math.min(80, al)); }
          var rot = parseInt(ro.value, 10); if (!isNaN(rot) && rot !== r.rot) p.rotationAngle = ((rot % 360) + 360) % 360;
          if (st.flip) { p.horzFlip = st.flip === 'h' || st.flip === 'hv'; p.vertFlip = st.flip === 'v' || st.flip === 'hv'; }
          if (st.place && st.place !== 'keep') { p.treatAsChar = st.place === 'char'; if (st.place !== 'char') p.textWrap = WRAP[st.place]; }
          if (st.cap && st.cap !== 'keep') { if (st.cap === 'off') p.hasCaption = false; else { p.hasCaption = true; p.captionDirection = st.cap; p.captionVertAlign = 'Top'; p.captionWidth = (st.cap === 'Left' || st.cap === 'Right') ? mm2hu(25) : 0; p.captionSpacing = 850; } }
          if (di.value !== (r.desc || '')) p.description = di.value;
          if (!Object.keys(p).length) { toast('바꾼 것이 없습니다.', 2400); return false; }
          setTimeout(function () { doAct('objSet', { props: p }, '개체를 고쳤습니다(되돌리려면 취소 단추). 한컴 한글에서 열어 한 번 확인해 주십시오.', '개체 고치기'); }, 60); return true; } }] });
      });
    }

    // ---------------- 스타일 · 문단 번호 모양 · 쪽 번호 새로 시작
    function styleSheet() {
      var body = el('div'), listBox = el('div', 'so-hwp-mgrid'), st = { fmt: 'dot' };
      body.appendChild(el('div', 'so-sheet-note', '커서가 있는 문단에 스타일을 입힙니다(글자 크기·굵기·줄 간격이 한꺼번에 바뀝니다). 「개요 1~3」은 제목 줄에 쓰는 스타일입니다.'));
      body.appendChild(listBox);
      function fillList() {
        listBox.innerHTML = '';
        runExt('styList').then(function (r) {
          if (!r || !r.ok) { listBox.appendChild(el('div', 'so-sheet-note', '스타일 목록을 불러오지 못했습니다.')); return; }
          r.list.filter(function (s) { return s.type === 0 && !/^(머리말|각주|미주|메모|차례|캡션)/.test(s.name) || s.id > 21; }).forEach(function (s) {
            var b = el('button', 'so-hwp-mb' + (s.id === r.cur ? ' on' : '')); b.type = 'button'; b.appendChild(el('span', 't-g', s.id === r.cur ? '✓' : 'Aa')); b.appendChild(el('span', 't-l', s.name));
            b.onclick = function () { env.ctx.closeSheet(); setTimeout(function () { doAct('styApply', { id: s.id }, '「' + s.name + '」 스타일을 입혔습니다', '스타일 입히기'); }, 60); };
            listBox.appendChild(b);
          });
        });
      }
      fillList();
      body.appendChild(el('div', 'so-opt-l', '새 스타일 만들기')); var nm = H.textIn(body, '스타일 이름', '예: 강조 제목', 30);
      var si = numIn(body, '글자 크기(pt)', 12, 6, 60, 1); var bold = { v: false }, ls = numIn(body, '줄 간격(%)', 160, 100, 300, 10);
      H.chipsRow(body, '굵기', [['n', '보통'], ['b', '굵게']], st, 'bold').children[0].classList.add('on');
      H.chipsRow(body, '정렬', [['justify', '양쪽'], ['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], st, 'align').children[0].classList.add('on');
      body.appendChild(el('div', 'so-opt-l', '문단 번호 모양(커서 문단에 적용)')); colorRow(body, '', [['1.', 'dot'], ['1)', 'paren'], ['①', 'circle'], ['가.', 'hanja'], ['A.', 'alpha'], ['I.', 'roman']], st, 'fmt', 'dot');
      var ns = numIn(body, '번호 시작 값', 1, 1, 9999, 1);
      body.appendChild(el('div', 'so-sheet-note', '「번호 모양 적용」은 커서 문단을 번호 문단으로 바꿉니다(한컴 한글에서 번호 모양이 보입니다). 아래 「쪽 번호 새로 시작」은 커서 자리부터 쪽 번호를 다시 셉니다.'));
      var pn = numIn(body, '쪽 번호 새로 시작(커서 자리부터, 번호)', 1, 1, 9999, 1);
      var btns = [{ label: '닫기' },
        { label: '쪽 번호 새로', onClick: function () { var n = parseInt(pn.value, 10) || 1; setTimeout(function () { doAct('pageNewNum', { n: n }, function (r) { return '이 자리부터 쪽 번호를 ' + r.n + '번으로 다시 셉니다(한컴 한글에서 확인하십시오)'; }, '쪽 번호 새로 시작'); }, 60); return true; } },
        { label: '번호 모양 적용', onClick: function () { var a = { fmt: st.fmt, start: parseInt(ns.value, 10) || 1 }; setTimeout(function () { doAct('numApply', a, '문단 번호 모양을 적용했습니다', '번호 모양 적용'); }, 60); return true; } },
        { label: '스타일 만들기', primary: true, onClick: function () {
          var name = nm.value.trim(); if (!name) { toast('스타일 이름을 적어 주십시오.', 2400); return false; }
          var size = parseFloat(si.value), line = parseInt(ls.value, 10);
          var mods = { char: { fontSize: Math.round((size > 0 ? size : 12) * 100), bold: st.bold === 'b' }, para: { alignment: st.align || 'justify', lineSpacing: line > 0 ? line : 160, lineSpacingType: 'Percent' } };
          setTimeout(function () { doAct('styAdd', { name: name, mods: mods }, '스타일 「' + name + '」을 만들었습니다. 위 목록에서 눌러 입히십시오.', '스타일 만들기'); }, 60); return true; } }];
      env.ctx.sheet({ title: '스타일·문단 번호', body: body, wide: true, buttons: btns });
    }

    return { shapeSheet: shapeSheet, eqSheet: function () { eqSheet(false); }, objSheet: objSheet, styleSheet: styleSheet };
  }

  // 수식 미리 보기(엔진이 그려 주는 그림) — 편집 화면 안에서 돈다
  EXT.eqPrev = function (a, args) {
    try { var svg = a.wasm.renderEquationPreview(String(args.script || ''), Math.round((args.sizePt || 10) * 100), 0); return { ok: true, svg: typeof svg === 'string' ? svg : '' }; } catch (e) { return { ok: false, msg: msgOf(e) }; }
  };

  global.SOHwpObj = { EXT: EXT, sheets: sheets, _util: { mm2hu: mm2hu, hu2mm: hu2mm, cref: cref, hex: hex } };
})(window);
