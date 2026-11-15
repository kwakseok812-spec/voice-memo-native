/* so-pptx-anim.js — S-Office 파워포인트 움직임 효과(애니메이션) 고치기 (O-0861, v10.9 3회차)
 * ----------------------------------------------------------------------------
 * 슬라이드 XML 의 <p:timing> 속 「주 순서(mainSeq)」만 고친다. 효과 한 개 = 도형 하나에 나타내기·강조·끝내기 한 가지.
 *   · 이 앱이 아는 17가지(나타내기 9·강조 4·끝내기 4)는 효과 XML 을 새로 만들어 넣고(바꾸기·시간 고치기도 같은 방식),
 *   · 그 밖의 효과(경로·문단별·소리·미디어 재생 등)는 원래 XML 덩어리를 그대로 두고 순서·시작 방식·지연·지우기만 다룬다.
 *   · 주 순서 밖의 것(동영상 재생 단추용 순서, 소리 노드 등)은 손대지 않는다.
 * 새 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다. pkg = so-pptx-struct.js 와 같은 모양.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var ST = global.SOPptxStruct; if (!ST || !ST._h) return;
  var H = ST._h, escX = H.escX, elemEnd = H.elemEnd, childrenOf = H.childrenOf, must = H.must;

  var CLS = { entr: '나타내기', emph: '강조', exit: '끝내기' };
  var DIRS4 = [[4, '아래에서'], [1, '위에서'], [8, '왼쪽에서'], [2, '오른쪽에서']];
  // key → { cls, id, label, dirs:[[subtype,label]], sub(기본), dur(기본 ms) }
  var PRESETS = {
    appear:   { cls: 'entr', id: 1,  label: '나타나기', sub: 0, dur: 1 },
    fade:     { cls: 'entr', id: 10, label: '서서히 나타나기', sub: 0, dur: 500 },
    fly:      { cls: 'entr', id: 2,  label: '날아오기', dirs: DIRS4, sub: 4, dur: 500 },
    wipe:     { cls: 'entr', id: 22, label: '닦아내기', dirs: DIRS4, sub: 4, dur: 500 },
    zoom:     { cls: 'entr', id: 23, label: '확대하며 나타나기', sub: 16, dur: 500 },
    split:    { cls: 'entr', id: 16, label: '나누기', dirs: [[21, '세로로'], [26, '가로로']], sub: 21, dur: 500 },
    blinds:   { cls: 'entr', id: 3,  label: '블라인드', dirs: [[10, '가로'], [5, '세로']], sub: 10, dur: 500 },
    box:      { cls: 'entr', id: 4,  label: '상자', dirs: [[16, '안쪽으로'], [32, '바깥쪽으로']], sub: 16, dur: 2000 },
    float:    { cls: 'entr', id: 42, label: '떠오르기', sub: 0, dur: 500 },
    grow:     { cls: 'emph', id: 6,  label: '커졌다 작아지기', sub: 0, dur: 2000 },
    spin:     { cls: 'emph', id: 8,  label: '돌기', sub: 0, dur: 2000 },
    transp:   { cls: 'emph', id: 9,  label: '반투명', sub: 0, dur: 500 },
    xdisappear: { cls: 'exit', id: 1,  label: '사라지기', sub: 0, dur: 1, key: 'xdisappear' },
    xfade:    { cls: 'exit', id: 10, label: '서서히 사라지기', sub: 0, dur: 500 },
    xfly:     { cls: 'exit', id: 2,  label: '날아가기', dirs: DIRS4, sub: 4, dur: 500 },
    xwipe:    { cls: 'exit', id: 22, label: '닦아내며 사라지기', dirs: DIRS4, sub: 4, dur: 500 }
  };
  var KEYS = Object.keys(PRESETS);
  var NODES = { clickEffect: '클릭할 때', withEffect: '이전 효과와 함께', afterEffect: '이전 효과 다음에' };
  var WIPE_F = { 4: 'wipe(down)', 1: 'wipe(up)', 8: 'wipe(left)', 2: 'wipe(right)' };

  function keyOf(cls, id, sub) {
    var hit = null;
    KEYS.forEach(function (k) { var p = PRESETS[k]; if (p.cls === cls && p.id === id) { if (!hit) hit = k; if (p.dirs && p.dirs.some(function (d) { return d[0] === sub; })) hit = k; } });
    return hit;
  }

  // ---------- 효과 XML 만들기 ----------
  var cid = 0;
  function T(attrs, inner) { cid++; return '<p:cTn id="' + cid + '"' + (attrs || '') + (inner ? '>' + inner + '</p:cTn>' : '/>'); }
  function tgt(spid) { return '<p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl>'; }
  function setVis(spid, v, delay) { return '<p:set><p:cBhvr>' + T(' dur="1" fill="hold"', '<p:stCondLst><p:cond delay="' + (delay || 0) + '"/></p:stCondLst>') + tgt(spid) + '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="' + v + '"/></p:to></p:set>'; }
  function aeff(spid, filter, dur, trans) { return '<p:animEffect transition="' + trans + '" filter="' + filter + '"><p:cBhvr>' + T(' dur="' + dur + '"') + tgt(spid) + '</p:cBhvr></p:animEffect>'; }
  function anim(spid, attr, from, to, dur, extra, nofill) {
    return '<p:anim calcmode="lin" valueType="num"><p:cBhvr' + (extra || '') + '>' + T(' dur="' + dur + '"' + (nofill ? '' : ' fill="hold"')) + tgt(spid) + '<p:attrNameLst><p:attrName>' + attr + '</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val>' + from + '</p:val></p:tav><p:tav tm="100000"><p:val>' + to + '</p:val></p:tav></p:tavLst></p:anim>';
  }
  function sv(s) { return '<p:strVal val="' + s + '"/>'; }
  function fv(n) { return '<p:fltVal val="' + n + '"/>'; }
  // spec: { key, spid, node, delay, dur, sub, grp(true 면 grpId="0") }
  function effectXml(e) {
    var p = PRESETS[e.key], sp = e.spid, d = e.dur != null ? e.dur : p.dur, sub = e.sub != null ? e.sub : p.sub, inner = '';
    var isExit = p.cls === 'exit';
    if (e.key === 'appear') inner = setVis(sp, 'visible');
    else if (e.key === 'fade') inner = setVis(sp, 'visible') + aeff(sp, 'fade', d, 'in');
    else if (e.key === 'fly') {
      var fx = sub === 8 ? '0-#ppt_w/2' : sub === 2 ? '1+#ppt_w/2' : '#ppt_x', fy = sub === 4 ? '1+#ppt_h/2' : sub === 1 ? '0-#ppt_h/2' : '#ppt_y';
      inner = setVis(sp, 'visible') + anim(sp, 'ppt_x', sv(fx), sv('#ppt_x'), d, ' additive="base"') + anim(sp, 'ppt_y', sv(fy), sv('#ppt_y'), d, ' additive="base"');
    } else if (e.key === 'wipe') inner = setVis(sp, 'visible') + aeff(sp, WIPE_F[sub] || 'wipe(down)', d, 'in');
    else if (e.key === 'zoom') inner = setVis(sp, 'visible') + anim(sp, 'ppt_w', fv(0), sv('#ppt_w'), d) + anim(sp, 'ppt_h', fv(0), sv('#ppt_h'), d);
    else if (e.key === 'split') inner = setVis(sp, 'visible') + aeff(sp, sub === 26 ? 'barn(inHorizontal)' : 'barn(inVertical)', d, 'in');
    else if (e.key === 'blinds') inner = setVis(sp, 'visible') + aeff(sp, sub === 5 ? 'blinds(vertical)' : 'blinds(horizontal)', d, 'in');
    else if (e.key === 'box') inner = setVis(sp, 'visible') + aeff(sp, sub === 32 ? 'box(out)' : 'box(in)', d, 'in');
    else if (e.key === 'float') inner = setVis(sp, 'visible') + anim(sp, 'ppt_y', sv('#ppt_y+.1'), sv('#ppt_y'), d) + aeff(sp, 'fade', d, 'in');
    else if (e.key === 'grow') inner = '<p:animScale><p:cBhvr>' + T(' dur="' + d + '" fill="hold"') + tgt(sp) + '</p:cBhvr><p:by x="150000" y="150000"/></p:animScale>';
    else if (e.key === 'spin') inner = '<p:animRot by="21600000"><p:cBhvr>' + T(' dur="' + d + '" fill="hold"') + tgt(sp) + '<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>';
    else if (e.key === 'transp') inner = '<p:set><p:cBhvr>' + T(' dur="indefinite"') + tgt(sp) + '<p:attrNameLst><p:attrName>style.opacity</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="0.5"/></p:to></p:set><p:animEffect filter="image" prLst="opacity: 0.5"><p:cBhvr rctx="IE">' + T(' dur="indefinite"') + tgt(sp) + '</p:cBhvr></p:animEffect>';
    else if (e.key === 'xdisappear') inner = setVis(sp, 'hidden');
    else if (e.key === 'xfade') inner = aeff(sp, 'fade', d, 'out') + setVis(sp, 'hidden', Math.max(1, d - 1));
    else if (e.key === 'xfly') {
      var gx = sub === 8 ? '0-#ppt_w/2' : sub === 2 ? '1+#ppt_w/2' : '#ppt_x', gy = sub === 4 ? '1+#ppt_h/2' : sub === 1 ? '0-#ppt_h/2' : '#ppt_y';
      inner = anim(sp, 'ppt_x', sv('ppt_x'), sv(gx.replace('#', '')), d, ' additive="base"', true) + anim(sp, 'ppt_y', sv('ppt_y'), sv(gy.replace('#', '')), d, ' additive="base"', true) + setVis(sp, 'hidden', Math.max(1, d - 1));
    } else if (e.key === 'xwipe') inner = aeff(sp, WIPE_F[sub] || 'wipe(down)', d, 'out') + setVis(sp, 'hidden', Math.max(1, d - 1));
    else throw new Error('모르는 효과: ' + e.key);
    var at = ' presetID="' + p.id + '" presetClass="' + p.cls + '" presetSubtype="' + (p.dirs || e.key === 'zoom' || e.key === 'split' || e.key === 'blinds' || e.key === 'box' ? sub : 0) + '"' + (e.key === 'transp' ? '' : ' fill="hold"') + (e.grp != null ? ' grpId="' + e.grp + '"' : '') + ' nodeType="' + (e.node || 'clickEffect') + '"';
    // 안쪽 cTn 번호는 나중에 한꺼번에 다시 매기므로 여기서는 자리만 채운다. 효과 자신의 cTn 은 안쪽보다 먼저 와야 하므로 자리 번호를 미리 뽑는다.
    var me = (cid++, cid);
    return '<p:par><p:cTn id="' + me + '"' + at + '><p:stCondLst><p:cond delay="' + (e.delay || 0) + '"/></p:stCondLst><p:childTnLst>' + inner + '</p:childTnLst></p:cTn></p:par>';
  }

  // ---------- 읽기 ----------
  function timingRange(xml) {
    var m = /<p:timing\b[^>]*?(\/?)>/.exec(xml); if (!m) return null;
    if (m[1] === '/') return { s: m.index, e: m.index + m[0].length, xml: m[0] };
    var e = elemEnd(xml, m.index); return e < 0 ? null : { s: m.index, e: e, xml: xml.slice(m.index, e) };
  }
  function openEnd(x, s) { var m = /^<[^>]*>/.exec(x.slice(s)); return s + m[0].length; }
  function kid(x, parent, name) { var ks = childrenOf(x, openEnd(x, parent.s), parent.e - (parent.name.length + 3)); for (var i = 0; i < ks.length; i++) if (ks[i].name === name) return ks[i]; return null; }
  function kids(x, parent) { return childrenOf(x, openEnd(x, parent.s), parent.e - (parent.name.length + 3)); }
  function nodeAt(x, s) { var e = elemEnd(x, s); var m = /^<([^\s\/>]+)/.exec(x.slice(s)); return { name: m[1], s: s, e: e }; }

  // 타이밍 속 주 순서 위치: { root:{childTnLst 안쪽 from,to}, seq:{s,e}, list:{from,to}(mainSeq 의 childTnLst 안쪽), }
  function locate(T) {
    var root = null, m = /<p:tnLst>\s*<p:par>/.exec(T); if (!m) return { err: '구조를 읽지 못했습니다' };
    var rootPar = nodeAt(T, T.indexOf('<p:par>', m.index));
    var rootCTn = kid(T, rootPar, 'p:cTn'); if (!rootCTn) return { err: '구조를 읽지 못했습니다' };
    var rootList = kid(T, rootCTn, 'p:childTnLst');
    if (!rootList) return { err: '구조를 읽지 못했습니다' };
    var lf = openEnd(T, rootList.s), lt = rootList.e - '</p:childTnLst>'.length;
    var out = { rootList: { from: lf, to: lt }, seq: null, list: null, others: [] };
    childrenOf(T, lf, lt).forEach(function (c) {
      var isMain = false;
      if (c.name === 'p:seq') { var cc = kid(T, c, 'p:cTn'); if (cc) { var op = /^<p:cTn\b[^>]*>/.exec(T.slice(cc.s)); isMain = !!op && /\snodeType="mainSeq"/.test(op[0]); if (isMain) out.mainId = (/\sid="(\d+)"/.exec(op[0]) || [])[1]; } }
      if (isMain) out.seq = c; else out.others.push(c);
    });
    if (out.seq) {
      var sc = kid(T, out.seq, 'p:cTn'), cl = sc ? kid(T, sc, 'p:childTnLst') : null;
      if (cl) out.list = { from: openEnd(T, cl.s), to: cl.e - '</p:childTnLst>'.length };
    }
    return out;
  }
  function numDur(raw) {
    var mx = 0, re = /<p:cTn\b[^>]*?\sdur="(\d+)"/g, q; while ((q = re.exec(raw))) { var v = +q[1]; if (v > 1 && v > mx) mx = v; }
    if (!mx && /<p:cTn\b[^>]*?\sdur="1"/.test(raw)) mx = 1;
    return mx || 500;
  }
  function parseEffect(raw) {
    var open = /^<p:par>\s*<p:cTn\b([^>]*)>/.exec(raw); if (!open) return null;
    var at = ' ' + open[1], g = function (n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(at); return m ? m[1] : null; };
    var cls = g('presetClass'), id = g('presetID'), node = g('nodeType');
    var sp = /\sspid="(\d+)"/.exec(raw), dl = /^<p:par>\s*<p:cTn\b[^>]*>\s*<p:stCondLst>\s*<p:cond\b[^>]*?\sdelay="(\d+|indefinite)"/.exec(raw);
    var spids = {}; (raw.match(/\sspid="\d+"/g) || []).forEach(function (q) { spids[q.replace(/\D/g, '')] = 1; });
    var opaque = !cls || !id || !sp || Object.keys(spids).length > 1 || /<p:txEl\b|<p:iterate\b|<p:cmd\b|<p:audio\b|<p:video\b/.test(raw) || /<p:cTn\b[^>]*\srepeatCount=/.test(raw);
    var e = { raw: raw, spid: sp ? +sp[1] : 0, cls: cls, pid: id ? +id : 0, sub: g('presetSubtype') != null ? +g('presetSubtype') : 0, node: node || 'clickEffect', delay: dl && dl[1] !== 'indefinite' ? +dl[1] : 0, dur: numDur(raw), grp: g('grpId') != null ? +g('grpId') : null };
    e.key = !opaque && CLS[cls] ? keyOf(cls, e.pid, e.sub) : null;
    if (e.key) {                                   // 아는 종류라도 속 모양이 우리가 만드는 것과 다르면(여러 개 번갈아 등) 덩어리 그대로 둔다
      var want = effectXml({ key: e.key, spid: e.spid, node: e.node, delay: e.delay, dur: e.dur, sub: e.sub, grp: e.grp });
      var a = want.replace(/<p:cTn id="\d+"/g, '<p:cTn id="0"').replace(/\s+/g, ''), b = raw.replace(/<p:cTn id="\d+"/g, '<p:cTn id="0"').replace(/\s+/g, '');
      if (a !== b) e.key = null;
    }
    return e;
  }
  // → { ok, effects:[...], loc, T, range } | { err }
  function parseTiming(xml) {
    var rg = timingRange(xml); if (!rg) return { ok: true, effects: [], none: true };
    if (!rg.xml || /\/>$/.test(rg.xml)) return { ok: true, effects: [], none: true, range: rg };
    var T = rg.xml, loc = locate(T); if (loc.err) return { err: loc.err, range: rg };
    if (!loc.seq) return { ok: true, effects: [], T: T, loc: loc, range: rg, noSeq: true };
    var eff = [];
    if (loc.list) {
      var outer = childrenOf(T, loc.list.from, loc.list.to).filter(function (c) { return c.name === 'p:par'; });
      for (var i = 0; i < outer.length; i++) {
        var oc = kid(T, outer[i], 'p:cTn'); if (!oc) return { err: '효과 묶음의 구조를 읽지 못했습니다' };
        var ol = kid(T, oc, 'p:childTnLst'); if (!ol) { continue; }
        var inners = kids(T, ol).filter(function (c) { return c.name === 'p:par'; });
        for (var j = 0; j < inners.length; j++) {
          var ic = kid(T, inners[j], 'p:cTn'), il = ic ? kid(T, ic, 'p:childTnLst') : null; if (!il) return { err: '효과 묶음의 구조를 읽지 못했습니다' };
          var effs = kids(T, il).filter(function (c) { return c.name === 'p:par'; });
          for (var k = 0; k < effs.length; k++) { var e = parseEffect(T.slice(effs[k].s, effs[k].e)); if (!e) return { err: '효과의 구조를 읽지 못했습니다' }; eff.push(e); }
        }
      }
    }
    return { ok: true, effects: eff, T: T, loc: loc, range: rg };
  }

  // ---------- 쓰기 ----------
  function groupsOf(effects) {                    // → steps:[{click:bool, groups:[[e..],..]}]
    var steps = [], step = null, grp = null;
    effects.forEach(function (e, i) {
      if (!step || e.node === 'clickEffect') { step = { click: e.node === 'clickEffect', groups: [] }; steps.push(step); grp = null; }
      if (!grp || e.node === 'afterEffect') { grp = []; step.groups.push(grp); }
      grp.push(e);
    });
    return steps;
  }
  function stepsXml(effects, mainId) {
    var steps = groupsOf(effects), out = '';
    steps.forEach(function (st, si) {
      var acc = 0, inner = '';
      st.groups.forEach(function (g) {
        var mx = 0; g.forEach(function (e) { mx = Math.max(mx, (e.delay || 0) + (e.dur || 0)); });
        inner += '<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="' + acc + '"/></p:stCondLst><p:childTnLst>' + g.map(function (e) { return e.xml; }).join('') + '</p:childTnLst></p:cTn></p:par>';
        acc += mx;
      });
      var conds = '<p:cond delay="indefinite"/>' + (st.click ? '' : '<p:cond evt="onBegin" delay="0"><p:tn val="' + mainId + '"/></p:cond>');
      out += '<p:par><p:cTn id="0" fill="hold"><p:stCondLst>' + conds + '</p:stCondLst><p:childTnLst>' + inner + '</p:childTnLst></p:cTn></p:par>';
    });
    return out;
  }
  function renumber(T) {
    var map = {}, n = 0;
    T = T.replace(/<p:cTn\b([^>]*?)\sid="(\d+)"/g, function (m, a, id) { n++; if (!(id in map)) map[id] = n; return '<p:cTn' + a + ' id="' + n + '"'; });
    // 위의 치환은 같은 번호가 두 번 나와도 새 번호를 따로 주므로, 번호가 겹치지 않게 쓰는 쪽(여기서는 우리가 만든 0·자리 번호)만 믿는다.
    return T.replace(/<p:tn\b([^>]*?)\sval="(\d+)"/g, function (m, a, v) { return '<p:tn' + a + ' val="' + (map[v] || v) + '"'; });
  }
  function ensureNs(xml) { return xml; }
  function buildTiming(parsed, effects, bldKeep, bldAdd) {
    // 효과마다 XML 덩어리 확정
    cid = 0;
    var list = effects.map(function (e) {
      var x = e.key && !e.keep ? effectXml(e) : e.raw;
      if (!e.key || e.keep) {                      // 덩어리 그대로: 시작 방식·지연만 바꾼다
        x = x.replace(/^(<p:par>\s*<p:cTn\b[^>]*?)\snodeType="[^"]*"/, '$1 nodeType="' + e.node + '"');
        if (e.delay !== e.delay0) x = x.replace(/^(<p:par>\s*<p:cTn\b[^>]*>\s*<p:stCondLst>\s*<p:cond\b[^>]*?\sdelay=")\d+(")/, '$1' + (e.delay || 0) + '$2');
      }
      return { xml: x, node: e.node, delay: e.delay || 0, dur: e.dur || 0 };
    });
    var T = parsed && parsed.T ? parsed.T : null, mainId = (T && parsed.loc && parsed.loc.mainId) || '99999';
    var inner = list.length ? stepsXml(list, mainId) : '';
    var seqNew = '<p:seq concurrent="1" nextAc="seek"><p:cTn id="' + mainId + '" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' + inner + '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>';
    var bld = '';
    var keep = bldKeep || [], add = bldAdd || [];
    if (keep.length || add.length) bld = '<p:bldLst>' + keep.join('') + add.join('') + '</p:bldLst>';
    if (!T) {
      if (!list.length) return null;
      return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' + seqNew + '</p:childTnLst></p:cTn></p:par></p:tnLst>' + bld + '</p:timing>';
    }
    var loc = parsed.loc, out;
    if (loc.seq) {
      if (list.length) {
        // mainSeq 의 childTnLst 속만 갈아 끼운다(prev/next 조건 등은 그대로)
        if (loc.list) out = T.slice(0, loc.list.from) + inner + T.slice(loc.list.to);
        else { var sq = T.slice(loc.seq.s, loc.seq.e), sx = sq.replace(/(<p:cTn\b[^>]*?)\/>/, '$1><p:childTnLst>' + inner + '</p:childTnLst></p:cTn>'); out = T.slice(0, loc.seq.s) + sx + T.slice(loc.seq.e); }
      } else out = T.slice(0, loc.seq.s) + T.slice(loc.seq.e);
    } else {
      out = list.length ? T.slice(0, loc.rootList.from) + seqNew + T.slice(loc.rootList.from) : T;
    }
    // 빌드 목록 갈아 끼우기
    out = out.replace(/<p:bldLst>[\s\S]*?<\/p:bldLst>|<p:bldLst\s*\/>/, '');
    out = out.replace('</p:timing>', bld + '</p:timing>');
    // 남은 알맹이가 없으면(주 순서도 없고 다른 순서·미디어 노드도 없음) 타이밍 전체를 뺀다
    var l2 = locate(out); if (!l2.err && !l2.seq && !l2.others.length) return null;
    return renumber(out);
  }

  function putTiming(xml, parsed, newT) {
    var rg = parsed && parsed.range;
    if (rg) return xml.slice(0, rg.s) + (newT || '') + xml.slice(rg.e);
    if (!newT) return xml;
    // 새로 넣을 자리: 슬라이드 맨 끝 확장 목록 앞(없으면 </p:sld> 앞)
    var tail = xml.lastIndexOf('</p:sld>'), ex = xml.lastIndexOf('<p:extLst>', tail), cs = xml.indexOf('</p:cSld>');
    var at = (ex > cs && cs >= 0 && ex >= 0) ? ex : tail;
    return xml.slice(0, at) + newT + xml.slice(at);
  }

  function bldLists(parsed, effects, slideXml, extraSpids) {
    var used = {}, usedG = {};
    effects.forEach(function (e) { used[e.spid] = 1; if (e.grp != null) usedG[e.spid + ':' + e.grp] = 1; });
    var keep = [], have = {};
    if (parsed && parsed.T) {
      var m = /<p:bldLst>([\s\S]*?)<\/p:bldLst>/.exec(parsed.T);
      if (m) { var W = '<x>' + m[1] + '</x>'; childrenOf(W, 3, W.length - 4).forEach(function (c) {
        var raw = W.slice(c.s, c.e), id = /\sspid="(\d+)"/.exec(raw), gi = /\sgrpId="(\d+)"/.exec(raw);
        if (!id || !used[id[1]]) return;
        if (gi && !usedG[id[1] + ':' + gi[1]] && /^<p:bldP\b/.test(raw)) return;      // 그 효과가 없어졌으면 빌드 줄도 뺀다
        keep.push(raw); have[id[1] + ':' + (gi ? gi[1] : '')] = 1;
      }); }
    }
    var add = [];
    effects.forEach(function (e) {
      if (e.grp == null || have[e.spid + ':' + e.grp]) return;
      var sh = H.findShape(slideXml, e.spid); if (!sh || sh.name !== 'p:sp') return;
      var bg = !/<p:cNvSpPr\b[^>]*\stxBox="1"/.test(sh.xml) && !/<p:ph\b/.test(sh.xml);
      add.push('<p:bldP spid="' + e.spid + '" grpId="' + e.grp + '"' + (bg ? ' animBg="1"' : '') + '/>'); have[e.spid + ':' + e.grp] = 1;
    });
    return { keep: keep, add: add };
  }

  // ---------- 공개 함수(문자열 단위: xml → xml) ----------
  function readAnims(xml) {
    var p = parseTiming(xml); if (p.err) return { ok: false, err: p.err };
    return { ok: true, effects: p.effects.map(function (e, i) { return { i: i, spid: e.spid, cls: e.cls, key: e.key, pid: e.pid, sub: e.sub, node: e.node, delay: e.delay, dur: e.dur, label: e.key ? PRESETS[e.key].label : ((CLS[e.cls] || '기타') + ' 효과(고급)'), known: !!e.key }; }) };
  }
  function labelOf(e) {
    var p = e.key ? PRESETS[e.key] : null; if (!p) return (CLS[e.cls] || '기타') + ' · 고급 효과';
    var d = (p.dirs || []).filter(function (q) { return q[0] === e.sub; })[0];
    return CLS[p.cls] + ' · ' + p.label + (d ? '(' + d[1] + ')' : '');
  }
  // op: {kind:'add', spid, key, sub, node, dur, delay, at} | {kind:'remove', i} | {kind:'change', i, key, sub, node, dur, delay} | {kind:'move', i, to}
  function editAnims(xml, op) {
    var p = parseTiming(xml); if (p.err) return { err: '이 슬라이드의 움직임 설정 구조를 폰에서는 읽지 못합니다. (' + p.err + ')' };
    var eff = p.effects.map(function (e) { e.delay0 = e.delay; return e; });
    if (op.kind === 'add') {
      var sh = H.findShape(xml, op.spid); if (!sh) return { err: '도형을 찾지 못했습니다' };
      var pr = PRESETS[op.key]; if (!pr) return { err: '모르는 효과입니다' };
      var grp = null; if (sh.name === 'p:sp') { grp = 0; eff.forEach(function (q) { if (q.spid === op.spid && q.grp != null) grp = Math.max(grp, q.grp + 1); }); }
      var ne = { key: op.key, spid: op.spid, cls: pr.cls, pid: pr.id, sub: op.sub != null ? op.sub : pr.sub, node: op.node || 'clickEffect', delay: op.delay || 0, dur: op.dur != null ? op.dur : pr.dur, grp: grp, delay0: op.delay || 0 };
      var at = op.at == null ? eff.length : Math.max(0, Math.min(eff.length, op.at)); eff.splice(at, 0, ne);
    } else if (op.kind === 'remove') {
      if (!eff[op.i]) return { err: '효과를 찾지 못했습니다' }; eff.splice(op.i, 1);
    } else if (op.kind === 'change') {
      var e = eff[op.i]; if (!e) return { err: '효과를 찾지 못했습니다' };
      if (op.key && op.key !== e.key) {
        var np = PRESETS[op.key]; if (!np) return { err: '모르는 효과입니다' };
        e.key = op.key; e.cls = np.cls; e.pid = np.id; e.sub = op.sub != null ? op.sub : np.sub; e.dur = op.dur != null ? op.dur : np.dur; e.keep = false; if (e.grp == null) { var fs_ = H.findShape(xml, e.spid); if (fs_ && fs_.name === 'p:sp') { e.grp = 0; eff.forEach(function (q) { if (q !== e && q.spid === e.spid && q.grp != null) e.grp = Math.max(e.grp, q.grp + 1); }); } }
      } else if (e.key) { if (op.sub != null) e.sub = op.sub; if (op.dur != null) e.dur = op.dur; }
      else if (op.dur != null || op.sub != null || op.key) return { err: '이 효과는 고급 효과라 폰에서는 종류·시간을 바꿀 수 없습니다. 시작 방식·지연·순서·지우기만 됩니다.' };
      if (op.node) e.node = op.node; if (op.delay != null) e.delay = op.delay;
    } else if (op.kind === 'move') {
      if (!eff[op.i]) return { err: '효과를 찾지 못했습니다' };
      var to = Math.max(0, Math.min(eff.length - 1, op.to)); var x = eff.splice(op.i, 1)[0]; eff.splice(to, 0, x);
      if (eff[0] && eff[0].node === 'withEffect' && false) eff[0].node = 'clickEffect';
    } else if (op.kind === 'dropShape') {
      eff = eff.filter(function (e) { return e.spid !== op.spid; });
    } else return { err: '알 수 없는 작업입니다' };
    var bl = bldLists(p, eff, xml), nt = buildTiming(p.T ? p : null, eff, bl.keep, bl.add);
    if (op.kind === 'dropShape' && p.T && nt) {                // 도형이 사라질 때: 주 순서 밖(미디어 재생용 순서·소리 노드)에서도 그 도형을 가리키는 덩어리를 뺀다
      var T2 = nt, l2 = locate(T2);
      if (!l2.err) {
        l2.others.filter(function (c) { return new RegExp('\\sspid="' + op.spid + '"').test(T2.slice(c.s, c.e)); }).sort(function (a, b) { return b.s - a.s; }).forEach(function (c) { T2 = T2.slice(0, c.s) + T2.slice(c.e); });
        l2 = locate(T2); nt = (!l2.seq && !l2.others.length) ? null : renumber(T2);
      }
    }
    return { xml: putTiming(xml, p, nt), count: eff.length };
  }
  // 도형이 지워지거나 묶일 때 그 도형을 가리키는 효과를 정리(없으면 그대로)
  function dropShape(xml, spid) {
    if (!/<p:timing\b/.test(xml)) return xml;
    if (!new RegExp('\\sspid="' + spid + '"').test(xml.slice(xml.indexOf('<p:timing')))) return xml;
    var r = editAnims(xml, { kind: 'dropShape', spid: spid });
    return r.err ? xml : r.xml;
  }
  // 쇼용: 클릭 단계 → { click, list:[{ spid, cls, key, sub, node, at(ms: 단계 시작 기준), dur }] }. 맨 처음 단계가 클릭이 아니면 슬라이드가 열리자마자 저절로 재생된다.
  function playPlan(xml) {
    var p = parseTiming(xml); if (p.err || !p.effects.length) return { steps: [], initialHidden: {} };
    var steps = groupsOf(p.effects).map(function (st) {
      var acc = 0, list = [];
      st.groups.forEach(function (g) {
        var mx = 0; g.forEach(function (e) { list.push({ spid: e.spid, cls: e.cls, key: e.key, sub: e.sub, node: e.node, at: acc + (e.delay || 0), dur: e.dur || 0 }); mx = Math.max(mx, (e.delay || 0) + (e.dur || 0)); });
        acc += mx;
      });
      return { click: st.click, list: list };
    });
    var firstSeen = {}, hidden = {};
    p.effects.forEach(function (e) { if (!(e.spid in firstSeen)) { firstSeen[e.spid] = e.cls; if (e.cls === 'entr') hidden[e.spid] = 1; } });
    return { steps: steps, initialHidden: hidden };
  }

  // 타이밍의 맨 위 목록 끝에 덩어리(재생 순서·미디어 노드 등)를 덧붙인다. 번호는 한꺼번에 다시 매긴다. (so-pptx-media.js 가 쓴다)
  function addRootNodes(xml, raw) {
    var p = parseTiming(xml); if (p.err) throw new Error('이 슬라이드의 움직임 설정 구조를 읽지 못했습니다. (' + p.err + ')');
    if (!p.T) return putTiming(xml, p, renumber('<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' + raw + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'));
    return putTiming(xml, p, renumber(p.T.slice(0, p.loc.rootList.to) + raw + p.T.slice(p.loc.rootList.to)));
  }
  ST._tm = { addRootNodes: addRootNodes, parse: parseTiming };
  ST.PRESETS = PRESETS; ST.ANIM_KEYS = KEYS; ST.ANIM_NODES = NODES; ST.ANIM_CLS = CLS;
  ST.animLabel = labelOf; ST.readAnims = readAnims; ST.editAnims = editAnims; ST.animDropShape = dropShape; ST.animPlan = playPlan;
  ST._dropTiming = dropShape;
})(typeof window !== 'undefined' ? window : globalThis);
