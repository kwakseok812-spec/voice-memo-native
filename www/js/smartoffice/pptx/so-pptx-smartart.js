/* so-pptx-smartart.js — S-Office 파워포인트 「진짜 SmartArt」 만들기·글 고치기 (O-0861, v10.9 6회차, 스위치 SO_PPTX_SMARTART)
 * ----------------------------------------------------------------------------
 * 파워포인트가 SmartArt(SmartArt 도구 탭이 뜨는 그 개체)로 알아보는 부품 다섯 개를 직접 쓴다:
 *   diagrams/data(항목·글) · layout(배치 정의) · quickStyle(모양 정의) · colors(색 정의) · drawing(미리 그려 둔 도형 — 파워포인트가 새로 그리기 전에 쓰는 그림)
 * 배치 정의(layout)·모양(quickStyle)·색(colors)은 마이크로소프트가 만든 내장 정의 파일을 가져오지 않고, 표준 문서(ECMA-376 「DrawingML 다이어그램」) 형식에 맞춰
 * 이 앱이 직접 쓴 것이다(고유 이름 urn:soffice.phone/…). 그래서 파워포인트에서 「SmartArt 디자인」의 갤러리 모양과는 이름이 다를 수 있다.
 * 종류 3가지(만들기): 목록 · 프로세스 · 계층(위 1개 + 아래 여러 개, 아래에 한 단계 더 가능). 이미 있는 SmartArt(파워포인트가 만든 것 포함)는 항목 글을 고친다.
 * 브라우저와 Node 양쪽에서 돈다(새 외부 부품 없음).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var NS_DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram', NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS_DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
  var ID_LAYOUT = { list: 'urn:soffice.phone/layout/list1', process: 'urn:soffice.phone/layout/process1', hier: 'urn:soffice.phone/layout/hier1' };
  var ID_QS = 'urn:soffice.phone/quickstyle/simple1', ID_CS = 'urn:soffice.phone/colors/accent1';
  var CT = { data: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml', layout: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml', qs: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml', cs: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml', drawing: 'application/vnd.ms-office.drawingml.diagramDrawing+xml' };
  var REL = { data: NS_R + '/diagramData', layout: NS_R + '/diagramLayout', qs: NS_R + '/diagramQuickStyle', cs: NS_R + '/diagramColors', drawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing' };
  var KINDS = {
    list: { name: '목록', min: 2, max: 8, hint: '항목이 나란히(많으면 두 줄로) 놓입니다' },
    process: { name: '프로세스', min: 2, max: 6, hint: '항목 사이에 화살표가 놓입니다' },
    hier: { name: '계층 구조', min: 2, max: 9, hint: '첫 항목이 위, 나머지가 아래 줄. 항목 앞에 「-」를 붙이면 바로 위 항목의 아래 단계가 됩니다' }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&'); }
  var seed = 0;
  function guid() { var h = '0123456789ABCDEF', s = ''; for (var i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)]; seed++; return '{' + s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-A' + s.slice(17, 20) + '-' + s.slice(20, 32) + '}'; }
  function R(v) { return Math.round(v); }
  function clamp(a, lo, hi) { return Math.max(lo, Math.min(hi, a)); }

  // ---------------------------------------------------------------- 배치 정의 (직접 씀)
  function head(tag, id, extra) { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:' + tag + ' xmlns:dgm="' + NS_DGM + '" xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" uniqueId="' + id + '">' + (extra || ''); }
  function txNode(name, lbl, shape, axis, hRatio) {
    return '<dgm:layoutNode name="' + name + '"' + (lbl ? ' styleLbl="' + lbl + '"' : '') + '><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/><dgm:shape type="' + shape + '" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="' + (axis || 'desOrSelf') + '" ptType="node"/>' +
      '<dgm:constrLst>' + (hRatio ? '<dgm:constr type="h" refType="w" fact="' + hRatio + '"/>' : '') + '<dgm:constr type="lMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="rMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="tMarg" refType="primFontSz" fact="0.3"/><dgm:constr type="bMarg" refType="primFontSz" fact="0.3"/></dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5" fact="NaN" max="NaN"/></dgm:ruleLst></dgm:layoutNode>';
  }
  function layoutList() {
    return head('layoutDef', ID_LAYOUT.list, '<dgm:title val="목록"/><dgm:desc val="항목을 나란히 늘어놓는 배치"/><dgm:catLst><dgm:cat type="list" pri="1000"/></dgm:catLst>') +
      '<dgm:layoutNode name="diagram"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>' +
      '<dgm:choose name="c1"><dgm:if name="c1a" func="var" arg="dir" op="equ" val="norm"><dgm:alg type="snake"><dgm:param type="grDir" val="tL"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg></dgm:if>' +
      '<dgm:else name="c1b"><dgm:alg type="snake"><dgm:param type="grDir" val="tR"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg></dgm:else></dgm:choose>' +
      '<dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/>' +
      '<dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="h" for="ch" forName="node" refType="w" refFor="ch" refForName="node" fact="0.55"/><dgm:constr type="w" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.12"/><dgm:constr type="sp" refType="w" refFor="ch" refForName="sibTrans"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/>' +
      '<dgm:forEach name="f1" axis="ch" ptType="node">' + txNode('node', '', 'roundRect') +
      '<dgm:forEach name="f2" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="sibTrans"><dgm:alg type="sp"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>';
  }
  function layoutProcess() {
    return head('layoutDef', ID_LAYOUT.process, '<dgm:title val="프로세스"/><dgm:desc val="항목을 화살표로 이어 놓는 배치"/><dgm:catLst><dgm:cat type="process" pri="1000"/></dgm:catLst>') +
      '<dgm:layoutNode name="diagram"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>' +
      '<dgm:choose name="c1"><dgm:if name="c1a" func="var" arg="dir" op="equ" val="norm"><dgm:alg type="lin"/></dgm:if><dgm:else name="c1b"><dgm:alg type="lin"><dgm:param type="linDir" val="fromR"/></dgm:alg></dgm:else></dgm:choose>' +
      '<dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/>' +
      '<dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="h" for="ch" forName="node" op="equ"/><dgm:constr type="w" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.4"/><dgm:constr type="h" for="ch" forName="sibTrans" refType="w" refFor="ch" refForName="node" fact="0.16"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/>' +
      '<dgm:forEach name="f1" axis="ch" ptType="node">' + txNode('node', '', 'roundRect', null, '0.7') +
      '<dgm:forEach name="f2" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="sibTrans" styleLbl="sibTrans2D1"><dgm:alg type="sp"/><dgm:shape type="rightArrow" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst/><dgm:ruleLst/></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>';
  }
  function hierNode(level) {      // level 1..3: 한 칸(글 상자) + 아래 단계를 담는 hierChild
    var n = String(level), nx = level < 3 ? hierLevel(level + 1) : '';
    return '<dgm:layoutNode name="hierRoot' + n + '"><dgm:alg type="hierRoot"/><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst><dgm:constr type="bendDist" for="des" ptType="parTrans" refType="sp" fact="0.5"/></dgm:constrLst><dgm:ruleLst/>' +
      txNode('box' + n, level === 1 ? 'node1' : (level === 2 ? 'node2' : 'node3'), 'roundRect', 'self') + nx + '</dgm:layoutNode>';
  }
  function hierLevel(level) {     // 아래 단계 묶음: 이음선 + 자식 칸들
    var n = String(level);
    return '<dgm:layoutNode name="hierChild' + n + '"><dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>' +
      '<dgm:forEach name="h' + n + 'a" axis="ch"><dgm:forEach name="h' + n + 'b" axis="self" ptType="parTrans" cnt="1"><dgm:layoutNode name="line' + n + '" styleLbl="parChTrans1D' + (level === 2 ? 2 : 3) + '"><dgm:alg type="conn"><dgm:param type="dim" val="1D"/><dgm:param type="endSty" val="noArr"/><dgm:param type="connRout" val="bend"/><dgm:param type="bendPt" val="end"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="tCtr"/><dgm:param type="srcNode" val="box' + (level - 1) + '"/><dgm:param type="dstNode" val="box' + level + '"/></dgm:alg><dgm:shape type="conn" r:blip="" zOrderOff="-999"><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="begPad"/><dgm:constr type="endPad"/></dgm:constrLst><dgm:ruleLst/></dgm:layoutNode></dgm:forEach>' +
      '<dgm:forEach name="h' + n + 'c" axis="self" ptType="node">' + hierNode(level) + '</dgm:forEach></dgm:forEach></dgm:layoutNode>';
  }
  function layoutHier() {
    return head('layoutDef', ID_LAYOUT.hier, '<dgm:title val="계층 구조"/><dgm:desc val="위 항목 아래에 아래 항목들이 이어지는 배치"/><dgm:catLst><dgm:cat type="hierarchy" pri="1000"/></dgm:catLst>') +
      '<dgm:layoutNode name="diagram"><dgm:varLst><dgm:chPref val="1"/><dgm:dir/><dgm:animOne val="branch"/><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg><dgm:shape r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf/>' +
      '<dgm:constrLst><dgm:constr type="primFontSz" for="des" ptType="node" op="equ" val="65"/><dgm:constr type="w" for="des" forName="box1" refType="w"/><dgm:constr type="h" for="des" forName="box1" refType="w" refFor="des" refForName="box1" fact="0.5"/>' +
      '<dgm:constr type="w" for="des" forName="box2" refType="w" refFor="des" refForName="box1"/><dgm:constr type="h" for="des" forName="box2" refType="h" refFor="des" refForName="box1"/><dgm:constr type="w" for="des" forName="box3" refType="w" refFor="des" refForName="box1"/><dgm:constr type="h" for="des" forName="box3" refType="h" refFor="des" refForName="box1"/>' +
      '<dgm:constr type="sibSp" refType="w" refFor="des" refForName="box1" fact="0.12"/><dgm:constr type="sibSp" for="des" forName="hierChild2" refType="sibSp"/><dgm:constr type="sibSp" for="des" forName="hierChild3" refType="sibSp"/>' +
      '<dgm:constr type="sp" for="des" forName="hierRoot1" refType="h" refFor="des" refForName="box1" fact="0.4"/><dgm:constr type="sp" for="des" forName="hierRoot2" refType="sp" refFor="des" refForName="hierRoot1"/><dgm:constr type="sp" for="des" forName="hierRoot3" refType="sp" refFor="des" refForName="hierRoot1"/></dgm:constrLst><dgm:ruleLst/>' +
      '<dgm:forEach name="r1" axis="ch"><dgm:forEach name="r2" axis="self" ptType="node">' + hierNode(1) + '</dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>';
  }
  var LBLS = ['node0', 'node1', 'node2', 'node3', 'sibTrans2D1', 'parChTrans1D1', 'parChTrans1D2', 'parChTrans1D3'];
  function colorsDef() {
    function lbl(n) {
      var fill = n === 'node2' ? 'accent2' : (n === 'node3' ? 'accent3' : 'accent1'), isLine = /^parChTrans/.test(n);
      var f = isLine ? '<dgm:fillClrLst meth="repeat"><a:schemeClr val="' + fill + '"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="' + (n === 'parChTrans1D3' ? 'accent3' : (n === 'parChTrans1D2' ? 'accent2' : 'accent1')) + '"/></dgm:linClrLst>'
        : (n === 'sibTrans2D1' ? '<dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"><a:tint val="60000"/></a:schemeClr></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="accent1"><a:tint val="60000"/></a:schemeClr></dgm:linClrLst>'
          : '<dgm:fillClrLst meth="repeat"><a:schemeClr val="' + fill + '"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst>');
      return '<dgm:styleLbl name="' + n + '">' + f + '<dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst/><dgm:txEffectClrLst/></dgm:styleLbl>';
    }
    return head('colorsDef', ID_CS, '<dgm:title val="강조 1"/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst>') + LBLS.map(lbl).join('') + '</dgm:colorsDef>';
  }
  function quickStyle() {
    function lbl(n) {
      var line = /^parChTrans/.test(n) ? 2 : (n === 'sibTrans2D1' ? 0 : 2);
      return '<dgm:styleLbl name="' + n + '"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="' + line + '"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="' + (/^parChTrans/.test(n) ? 0 : 1) + '"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="' + (/^parChTrans/.test(n) ? 'tx1' : 'lt1') + '"/></a:fontRef></dgm:style></dgm:styleLbl>';
    }
    return head('styleDef', ID_QS, '<dgm:title val="단순형"/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>') + LBLS.map(lbl).join('') + '</dgm:styleDef>';
  }

  // ---------------------------------------------------------------- 항목 글 정리
  // spec: { kind, items:[ '글' | '-글'(hier 아래 단계) ] } → nodes:[{t, lv(0=위, 1, 2), par(부모 노드 번호|-1)}]
  function nodesOf(spec) {
    var out = [], items = spec.items || [];
    if (spec.kind === 'hier') {
      var last1 = -1;
      items.forEach(function (raw, i) {
        var m = /^(-*)\s*([\s\S]*)$/.exec(String(raw)), lv = i === 0 ? 0 : (m[1].length ? 2 : 1), par = lv === 0 ? -1 : (lv === 1 ? 0 : last1);
        if (lv === 2 && last1 < 0) { lv = 1; par = 0; }
        out.push({ t: m[2], lv: lv, par: par }); if (lv === 1) last1 = out.length - 1;
      });
      return out;
    }
    items.forEach(function (t) { out.push({ t: String(t), lv: 0, par: -1 }); });
    return out;
  }

  // ---------------------------------------------------------------- 자료(data) — 항목·글·연결 (+ 그려진 도형과 이어지는 prs 점)
  function runsXml(t) { return '<a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>' + esc(t) + '</a:t></a:r>'; }
  function dataXml(spec, nodes, drawingRid) {
    var kind = spec.kind, docId = guid(), lay = ID_LAYOUT[kind];
    var ids = nodes.map(function () { return { n: guid(), pt: guid(), st: guid(), cx: guid() }; });
    var pts = '<dgm:pt modelId="' + docId + '" type="doc"><dgm:prSet loTypeId="' + lay + '" loCatId="' + (kind === 'hier' ? 'hierarchy' : kind) + '" qsTypeId="' + ID_QS + '" qsCatId="simple" csTypeId="' + ID_CS + '" csCatId="accent1" phldr="0"/><dgm:spPr/></dgm:pt>';
    nodes.forEach(function (nd, i) {
      pts += '<dgm:pt modelId="' + ids[i].n + '"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p>' + runsXml(nd.t) + '<a:endParaRPr lang="ko-KR" altLang="en-US"/></a:p></dgm:t></dgm:pt>';
      pts += '<dgm:pt modelId="' + ids[i].pt + '" type="parTrans" cxnId="' + ids[i].cx + '"><dgm:prSet/><dgm:spPr/></dgm:pt>';
      pts += '<dgm:pt modelId="' + ids[i].st + '" type="sibTrans" cxnId="' + ids[i].cx + '"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" altLang="en-US"/></a:p></dgm:t></dgm:pt>';
    });
    var cx = '', order = {};
    nodes.forEach(function (nd, i) {
      var src = nd.par < 0 ? docId : ids[nd.par].n, ord = order[src] || 0; order[src] = ord + 1;
      cx += '<dgm:cxn modelId="' + ids[i].cx + '" srcId="' + src + '" destId="' + ids[i].n + '" srcOrd="' + ord + '" destOrd="0" parTransId="' + ids[i].pt + '" sibTransId="' + ids[i].st + '"/>';
    });
    return { xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:dataModel xmlns:dgm="' + NS_DGM + '" xmlns:a="' + NS_A + '"><dgm:ptLst>' + pts + '</dgm:ptLst><dgm:cxnLst>' + cx + '</dgm:cxnLst><dgm:bg/><dgm:whole/>' + (drawingRid ? '<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="' + NS_DSP + '" relId="' + drawingRid + '" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>' : '') + '</dgm:dataModel>', ids: ids, docId: docId };
  }

  // ---------------------------------------------------------------- 미리 그려 둔 도형(drawing) — 파워포인트가 새로 배치하기 전에 보여 주는 그림
  function fit(text, w, h) { var wpt = w / 12700, hpt = h / 12700, len = Math.max(3, String(text || '').length); return clamp(Math.sqrt(wpt * hpt * 0.3 / len), 9, 30); }
  function spXml(modelId, prst, adj, x, y, w, h, fillXml, lnXml, text, sz, tx) {
    var body = text == null ? '<a:p><a:pPr marL="0" lvl="0" indent="0" algn="ctr"><a:buNone/></a:pPr><a:endParaRPr lang="ko-KR" altLang="en-US"/></a:p>' :
      '<a:p><a:pPr marL="0" lvl="0" indent="0" algn="ctr"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:spcAft><a:spcPct val="35000"/></a:spcAft><a:buNone/></a:pPr><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="' + R(sz * 100) + '" kern="1200"/><a:t>' + esc(text) + '</a:t></a:r></a:p>';
    var ins = text == null ? 0 : R(sz * 12700 * 0.3);
    return '<dsp:sp modelId="' + modelId + '"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="' + R(x) + '" y="' + R(y) + '"/><a:ext cx="' + R(w) + '" cy="' + R(h) + '"/></a:xfrm><a:prstGeom prst="' + prst + '"><a:avLst>' + (adj || '') + '</a:avLst></a:prstGeom>' + fillXml + lnXml + '<a:effectLst/></dsp:spPr>' +
      '<dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style>' +
      '<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="' + ins + '" tIns="' + ins + '" rIns="' + ins + '" bIns="' + ins + '" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + body + '</dsp:txBody>' +
      '<dsp:txXfrm><a:off x="' + R(x + (tx ? 0 : w * 0.03)) + '" y="' + R(y + h * 0.03) + '"/><a:ext cx="' + R(w * (tx ? 1 : 0.94)) + '" cy="' + R(h * 0.94) + '"/></dsp:txXfrm></dsp:sp>';
  }
  function fillOf(clr, tint) { return '<a:solidFill><a:schemeClr val="' + clr + '">' + (tint ? '<a:tint val="' + tint + '"/>' : '') + '</a:schemeClr></a:solidFill>'; }
  var LN = '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>';
  function line(clr) { return '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="' + clr + '"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'; }
  function drawingXml(spec, nodes, ids, W, H) {
    var kind = spec.kind, n = nodes.length, sh = '', i;
    if (kind === 'list') {
      var cols = n <= 3 ? n : Math.ceil(n / 2), rows = Math.ceil(n / cols), gap = 0.12;
      var w = Math.min(W / (cols + (cols - 1) * gap), (H / (rows + (rows - 1) * gap)) / 0.55), h = w * 0.55, totW = cols * w + (cols - 1) * w * gap, totH = rows * h + (rows - 1) * w * gap, ox = (W - totW) / 2, oy = (H - totH) / 2;
      for (i = 0; i < n; i++) { var c = i % cols, r = Math.floor(i / cols), rowCnt = Math.min(cols, n - r * cols), rowOx = (W - (rowCnt * w + (rowCnt - 1) * w * gap)) / 2; sh += spXml(ids[i].pt, 'roundRect', '<a:gd name="adj" fmla="val 10000"/>', rowOx + c * w * (1 + gap), oy + r * (h + w * gap), w, h, fillOf('accent1'), LN, nodes[i].t, fit(nodes[i].t, w, h)); }
    } else if (kind === 'process') {
      var gp = 0.4, w2 = Math.min(W / (n + (n - 1) * gp), H / 0.6), h2 = w2 * 0.6, tot = n * w2 + (n - 1) * w2 * gp, ox2 = (W - tot) / 2, oy2 = (H - h2) / 2;
      for (i = 0; i < n; i++) {
        sh += spXml(ids[i].pt, 'roundRect', '<a:gd name="adj" fmla="val 10000"/>', ox2 + i * w2 * (1 + gp), oy2, w2, h2, fillOf('accent1'), LN, nodes[i].t, fit(nodes[i].t, w2, h2));
        if (i < n - 1) { var aw = w2 * gp * 0.62, ah = h2 * 0.3; sh += spXml(ids[i].st, 'rightArrow', '<a:gd name="adj1" fmla="val 60000"/><a:gd name="adj2" fmla="val 50000"/>', ox2 + i * w2 * (1 + gp) + w2 + (w2 * gp - aw) / 2, oy2 + (h2 - ah) / 2, aw, ah, fillOf('accent1', 60000), '<a:ln><a:noFill/></a:ln>', null, 12, true); }
      }
    } else {
      // 계층: 단계별 줄. 같은 부모 아래 형제는 가로로, 부모는 자식들의 가운데
      var levels = [[], [], []]; nodes.forEach(function (nd, k) { levels[nd.lv].push(k); });
      var maxLv = levels[2].length ? 2 : (levels[1].length ? 1 : 0), maxW = Math.max(levels[0].length, levels[1].length, levels[2].length, 1), bw = Math.min(W / (maxW + (maxW - 1) * 0.12), (H / (maxLv + 1 + maxLv * 0.5)) / 0.5, W * 0.4), bh = bw * 0.5;
      var vgap = (H - (maxLv + 1) * bh) / Math.max(1, maxLv), pos = {}, kids = {};
      nodes.forEach(function (nd, k) { if (nd.par >= 0) (kids[nd.par] = kids[nd.par] || []).push(k); });
      var cursor = [0, 0, 0];
      function place(k, depth) {
        var ch = kids[k] || [], x;
        if (ch.length) { ch.forEach(function (c) { place(c, depth + 1); }); x = (pos[ch[0]].x + pos[ch[ch.length - 1]].x) / 2; }
        else { x = cursor[0]; cursor[0] += bw * 1.12; }
        pos[k] = { x: x, y: depth * (bh + vgap) };
      }
      place(0, 0);
      var minX = 1e18, maxX = -1e18; Object.keys(pos).forEach(function (k) { minX = Math.min(minX, pos[k].x); maxX = Math.max(maxX, pos[k].x + bw); });
      var sx = (W - (maxX - minX)) / 2 - minX;
      nodes.forEach(function (nd, k) {     // 이음선 먼저(가는 사각형 세 조각 — 파워포인트가 낯선 곡선 도형을 받아들이지 않아 가장 단순한 도형으로)
        if (nd.par < 0) return; var p = pos[nd.par], c = pos[k], x1 = p.x + bw / 2 + sx, y1 = p.y + bh, x2 = c.x + bw / 2 + sx, y2 = c.y, ym = (y1 + y2) / 2, lw = 19050, clr = nd.lv === 1 ? 'accent2' : 'accent3', nf = '<a:ln><a:noFill/></a:ln>', fl = fillOf(clr);
        sh += spXml(ids[k].st, 'rect', '', x1 - lw / 2, y1, lw, ym - y1 + lw / 2, fl, nf, null, 10, true);
        if (Math.abs(x2 - x1) > 1) sh += spXml(guid(), 'rect', '', Math.min(x1, x2) - lw / 2, ym - lw / 2, Math.abs(x2 - x1) + lw, lw, fl, nf, null, 10, true);
        sh += spXml(guid(), 'rect', '', x2 - lw / 2, ym - lw / 2, lw, y2 - ym + lw / 2, fl, nf, null, 10, true);
      });
      nodes.forEach(function (nd, k) { var clr = nd.lv === 0 ? 'accent1' : (nd.lv === 1 ? 'accent2' : 'accent3'); sh += spXml(ids[k].pt, 'roundRect', '<a:gd name="adj" fmla="val 10000"/>', pos[k].x + sx, pos[k].y, bw, bh, fillOf(clr), LN, nd.t, fit(nd.t, bw, bh)); });
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="' + NS_DGM + '" xmlns:dsp="' + NS_DSP + '" xmlns:a="' + NS_A + '"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>' + sh + '</dsp:spTree></dsp:drawing>';
  }

  // 다섯 부품(문자열)과 슬라이드 위 틀(graphicFrame) 만들기
  function build(spec, frameEmu, drawingRid) {
    var K = KINDS[spec.kind]; if (!K) return { err: '모르는 SmartArt 종류입니다.' };
    var items = (spec.items || []).map(function (t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, 60); });
    while (items.length > K.min && !items[items.length - 1]) items.pop();
    items = items.map(function (t, i) { var m = /^(-*)\s*(.*)$/.exec(t); return m[1] + (m[2] || (i + 1) + '번 항목'); });
    if (items.length < K.min) return { err: '「' + K.name + '」은 항목이 ' + K.min + '개 이상 필요합니다.' };
    if (items.length > K.max) return { err: '「' + K.name + '」은 항목이 ' + K.max + '개까지입니다.' };
    var sp = { kind: spec.kind, items: items }, nodes = nodesOf(sp), d = dataXml(sp, nodes, drawingRid);
    return { spec: sp, nodes: nodes, parts: { data: d.xml, layout: spec.kind === 'list' ? layoutList() : (spec.kind === 'process' ? layoutProcess() : layoutHier()), qs: quickStyle(), cs: colorsDef(), drawing: drawingXml(sp, nodes, d.ids, frameEmu.w, frameEmu.h) } };
  }

  // ---------------------------------------------------------------- 읽기·글 고치기 (이 앱이 만든 것 + 파워포인트가 만든 것)
  // data 에서 항목(node) 점 목록: [{id, text}] — 순서는 doc 에서 내려가는 연결 순서
  function readNodes(dataStr) {
    var pts = {}, re = /<dgm:pt\b([^>]*?)(\/>|>([\s\S]*?)<\/dgm:pt>)/g, m;
    while ((m = re.exec(dataStr))) {
      var attrs = m[1], id = (/modelId="([^"]+)"/.exec(attrs) || [])[1], type = (/\btype="([^"]+)"/.exec(attrs) || [, 'node'])[1];
      if (!id) continue; var t = ''; (String(m[3] || '').match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:t\/>/g) || []).forEach(function (a) { t += unesc(a.replace(/<[^>]+>/g, '')); });
      pts[id] = { id: id, type: type, text: t, hasT: /<dgm:t>/.test(m[3] || '') };
    }
    var cx = [], re2 = /<dgm:cxn\b([^>]*?)\/>/g;
    while ((m = re2.exec(dataStr))) { var a = m[1]; if (/\btype="/.test(a) && !/\btype="parOf"/.test(a)) continue; cx.push({ src: (/srcId="([^"]+)"/.exec(a) || [])[1], dst: (/destId="([^"]+)"/.exec(a) || [])[1], ord: +((/srcOrd="(\d+)"/.exec(a) || [, 0])[1]) }); }
    var doc = Object.keys(pts).filter(function (k) { return pts[k].type === 'doc'; })[0], out = [];
    function walk(pid, lv) { cx.filter(function (c) { return c.src === pid && pts[c.dst] && pts[c.dst].type === 'node'; }).sort(function (a, b) { return a.ord - b.ord; }).forEach(function (c) { out.push({ id: c.dst, text: pts[c.dst].text, lv: lv }); walk(c.dst, lv + 1); }); }
    if (doc) walk(doc, 0);
    return out;
  }
  // 항목 글 바꾸기: texts = { 점id: '새 글' } → 새 data 문자열 (글자 모양은 첫 글 조각의 것을 이어 쓴다)
  function setNodeTexts(dataStr, texts) {
    return dataStr.replace(/<dgm:pt\b([^>]*?)>([\s\S]*?)<\/dgm:pt>/g, function (all, attrs, inner) {
      var id = (/modelId="([^"]+)"/.exec(attrs) || [])[1]; if (!id || !Object.prototype.hasOwnProperty.call(texts, id)) return all;
      if (/\btype="(?!node")/.test(attrs)) return all;
      var rpr = (/<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))/.exec(inner) || [])[1] || '<a:rPr lang="ko-KR" altLang="en-US"/>';
      var p = /(<a:p>)(<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>))?/.exec(inner), ppr = p && p[2] ? p[2] : '', t = String(texts[id]);
      var tx = '<dgm:t><a:bodyPr/><a:lstStyle/><a:p>' + ppr + (t ? '<a:r>' + rpr + '<a:t>' + esc(t) + '</a:t></a:r>' : '') + '<a:endParaRPr lang="ko-KR" altLang="en-US"/></a:p></dgm:t>';
      if (/<dgm:t>[\s\S]*<\/dgm:t>/.test(inner)) return '<dgm:pt' + attrs + '>' + inner.replace(/<dgm:t>[\s\S]*<\/dgm:t>/, tx) + '</dgm:pt>';
      return '<dgm:pt' + attrs + '>' + inner.replace('</dgm:pt>', '') + tx + '</dgm:pt>';
    });
  }
  // 그려 둔 도형(drawing)의 글도 같이 바꾼다: 점 id → (presOf 연결로 이어진 pres 점 id) → dsp:sp 의 글. 못 찾으면 false
  function setDrawingTexts(drawingStr, dataStr, texts) {
    var pres = {}, re = /<dgm:pt\b([^>]*?)>[\s\S]*?<\/dgm:pt>/g, m;
    while ((m = re.exec(dataStr))) { if (!/type="pres"/.test(m[1])) continue; var id = /modelId="([^"]+)"/.exec(m[1])[1], as = /presAssocID="([^"]+)"/.exec(m[0]); if (as) pres[id] = as[1]; }
    // pres 점이 없는 자료(이 앱이 만든 것)는 그려 둔 도형의 modelId 가 곧 node 의 parTrans 점이므로 그 점을 통해 찾는다
    var assoc = {}; Object.keys(pres).forEach(function (pid) { assoc[pres[pid]] = assoc[pres[pid]] || []; assoc[pres[pid]].push(pid); });
    var parOf = {}, re3 = /<dgm:cxn\b([^>]*?)\/>/g; while ((m = re3.exec(dataStr))) { if (/\btype="/.test(m[1]) && !/type="parOf"/.test(m[1])) continue; var d = /destId="([^"]+)"/.exec(m[1]), pt = /parTransId="([^"]+)"/.exec(m[1]); if (d && pt) parOf[d[1]] = pt[1]; }
    var done = 0, out = drawingStr.replace(/<dsp:sp\b([^>]*)>([\s\S]*?)<\/dsp:sp>/g, function (all, attrs, inner) {
      var mid = (/modelId="([^"]+)"/.exec(attrs) || [])[1], target = null;
      Object.keys(texts).forEach(function (nid) { if (target !== null) return; if (mid === nid || mid === parOf[nid] || (assoc[nid] || []).indexOf(mid) >= 0) target = nid; });
      if (target === null) return all;
      var t = String(texts[target]), hasR = /<a:r>/.test(inner);
      var rpr = (/<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))/.exec(inner) || [])[1];
      if (hasR) { var first = true; inner = inner.replace(/<a:r>[\s\S]*?<\/a:r>/g, function (r) { if (!first) return ''; first = false; return r.replace(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:t\/>/, '<a:t>' + esc(t) + '</a:t>'); }); }
      else return all;      // 글이 없던 도형(배경 등)에는 글을 넣지 않는다
      done++; return '<dsp:sp' + attrs + '>' + inner + '</dsp:sp>';
    });
    return { xml: out, n: done };
  }

  // ---------------------------------------------------------------- 엔진 연결(so-pptx-struct.js 의 압축 꾸러미 pkg 위에서)
  var ST = global.SOPptxStruct;
  if (ST && ST._h) {
    var H = ST._h;
    ST.SMARTART_KINDS = KINDS;
    ST.addSmartArt = async function (pkg, slidePath, spec, g) {
      var N = 1; ['data', 'layout', 'quickStyle', 'colors', 'drawing'].forEach(function (b) { N = Math.max(N, H.nextNum(pkg, 'ppt/diagrams/', b, 'xml')); });
      var path = { data: 'ppt/diagrams/data' + N + '.xml', layout: 'ppt/diagrams/layout' + N + '.xml', qs: 'ppt/diagrams/quickStyle' + N + '.xml', cs: 'ppt/diagrams/colors' + N + '.xml', drawing: 'ppt/diagrams/drawing' + N + '.xml' };
      var rp = H.relsPathOf(slidePath), rx = (await pkg.read(rp)) || H.emptyRels(), rid = {}, k;
      var order = ['drawing', 'data', 'layout', 'qs', 'cs'];
      for (var i = 0; i < order.length; i++) { k = order[i]; var ar = H.addRel(rx, REL[k], H.relTarget(slidePath, path[k])); rx = ar.xml; rid[k] = ar.id; }
      var b = build(spec, { w: g.w, h: g.h }, rid.drawing); if (b.err) return b;
      var ct = await H.must(pkg, '[Content_Types].xml');
      ['data', 'layout', 'qs', 'cs', 'drawing'].forEach(function (key) { pkg.write(path[key], b.parts[key]); ct = H.ctAdd(ct, '/' + path[key], CT[key]); });
      pkg.write('[Content_Types].xml', ct); pkg.write(rp, rx);
      var x = await H.must(pkg, slidePath), id = H.maxId(x) + 1;
      var frame = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="SmartArt ' + (id - 1) + '" descr="' + esc(KINDS[b.spec.kind].name + ' SmartArt') + '"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + R(g.x) + '" y="' + R(g.y) + '"/><a:ext cx="' + R(g.w) + '" cy="' + R(g.h) + '"/></p:xfrm><a:graphic><a:graphicData uri="' + NS_DGM + '"><dgm:relIds xmlns:dgm="' + NS_DGM + '" xmlns:r="' + NS_R + '" r:dm="' + rid.data + '" r:lo="' + rid.layout + '" r:qs="' + rid.qs + '" r:cs="' + rid.cs + '"/></a:graphicData></a:graphic></p:graphicFrame>';
      pkg.write(slidePath, H.insertShape(x, frame));
      return { id: id };
    };
    // 슬라이드의 SmartArt 한 개 → { nodes:[{id,text,lv}], dataPath, drawingPath|null, layoutId, mine, ... }
    async function parts(pkg, slidePath, id) {
      var x = await H.must(pkg, slidePath), sh = H.findShape(x, id); if (!sh) return { err: 'SmartArt 를 찾지 못했습니다.' };
      var m = /<dgm:relIds\b([^>]*)>/.exec(sh.xml); if (!m) return { err: '이 개체는 SmartArt 가 아닙니다.' };
      var at = function (n) { return (new RegExp('r:' + n + '="([^"]+)"').exec(m[1]) || [])[1]; };
      var rels = H.parseRels((await pkg.read(H.relsPathOf(slidePath))) || ''), byId = {}; rels.forEach(function (r) { byId[r.id] = r; });
      function pth(rid) { var r = byId[rid]; return r ? H.resolvePath(slidePath, r.target) : null; }
      var dataPath = pth(at('dm')), loPath = pth(at('lo')); if (!dataPath || (await pkg.read(dataPath)) == null) return { err: 'SmartArt 자료 파일을 찾지 못했습니다.' };
      var data = await pkg.read(dataPath), dr = (/<dsp:dataModelExt\b[^>]*\brelId="([^"]+)"/.exec(data) || [])[1], drawingPath = dr ? pth(dr) : null;
      if (drawingPath && (await pkg.read(drawingPath)) == null) drawingPath = null;
      var lo = loPath ? await pkg.read(loPath) : '', lid = (/uniqueId="([^"]+)"/.exec(lo || '') || [])[1] || '';
      return { data: data, dataPath: dataPath, drawingPath: drawingPath, layoutId: lid, mine: /^urn:soffice\.phone\//.test(lid), nodes: readNodes(data), rels: [at('dm'), at('lo'), at('qs'), at('cs'), dr].filter(Boolean), paths: [dataPath, loPath, pth(at('qs')), pth(at('cs')), drawingPath].filter(Boolean) };
    }
    ST.readSmartArt = async function (pkg, slidePath, id) { var p = await parts(pkg, slidePath, id); if (p.err) return p; return { nodes: p.nodes, layoutId: p.layoutId, mine: p.mine, hasDrawing: !!p.drawingPath }; };
    // 항목 글 고치기: list = [새 글…](readSmartArt 의 nodes 순서) — 자료와 그려 둔 도형의 글을 같이 바꾼다
    ST.setSmartArtTexts = async function (pkg, slidePath, id, list) {
      var p = await parts(pkg, slidePath, id); if (p.err) return p;
      if (list.length !== p.nodes.length) return { err: '항목 수가 달라졌습니다. 다시 열어 고쳐 주십시오.' };
      var map = {}, changed = 0; p.nodes.forEach(function (n, i) { var t = String(list[i] == null ? '' : list[i]).replace(/\s+/g, ' ').trim().slice(0, 200); if (t !== n.text) { map[n.id] = t; changed++; } });
      if (!changed) return { ok: true, changed: 0 };
      var nd = setNodeTexts(p.data, map);
      var want = p.nodes.map(function (n) { return Object.prototype.hasOwnProperty.call(map, n.id) ? map[n.id] : n.text; }).join('\u0001');
      if (readNodes(nd).map(function (n) { return n.text; }).join('\u0001') !== want) return { err: '글을 바꾼 뒤 다시 읽어 보니 맞지 않아 멈췄습니다(문서는 바뀌지 않았습니다).' };
      pkg.write(p.dataPath, nd);
      var drawn = 0;
      if (p.drawingPath) { var dr = setDrawingTexts(await pkg.read(p.drawingPath), nd, map); pkg.write(p.drawingPath, dr.xml); drawn = dr.n; }
      return { ok: true, changed: changed, drawn: drawn };
    };
    ST.removeSmartArt = async function (pkg, slidePath, id) {
      var p = await parts(pkg, slidePath, id); if (p.err) return p;
      var x = await H.must(pkg, slidePath); pkg.write(slidePath, ST.removeShape(x, id));
      var rp = H.relsPathOf(slidePath), rx = await pkg.read(rp);
      H.parseRels(rx).forEach(function (r) { if (p.rels.indexOf(r.id) >= 0 && r.raw) rx = rx.replace(r.raw, ''); });
      pkg.write(rp, rx);
      var ct = await H.must(pkg, '[Content_Types].xml'), all = pkg.list();
      for (var i = 0; i < p.paths.length; i++) {
        var path = p.paths[i], used = false, base = path.split('/').pop();
        for (var j = 0; j < all.length && !used; j++) { if (/\.rels$/.test(all[j])) { var t = await pkg.read(all[j]); if (t && t.indexOf('/' + base) >= 0 && /diagrams\//.test(t)) used = true; } }
        if (!used) { pkg.remove(path); ct = H.ctDel(ct, '/' + path); }
      }
      pkg.write('[Content_Types].xml', ct);
      return { ok: true };
    };
  }

  global.SOSmartArt = { KINDS: KINDS, build: build, readNodes: readNodes, setNodeTexts: setNodeTexts, setDrawingTexts: setDrawingTexts, CT: CT, REL: REL, _nodesOf: nodesOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SOSmartArt;
})(typeof window !== 'undefined' ? window : globalThis);
