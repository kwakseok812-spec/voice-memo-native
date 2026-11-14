/* so-pptx-struct.js — S-Office 파워포인트 편집 보강(O-0861, v10.5): 슬라이드 추가·복제·삭제·순서·숨기기 · 글 상자·도형·그림·표 · 글자 서식 · 발표자 노트 · 새 PPT 문서
 * ----------------------------------------------------------------------------
 * 원본 .pptx(zip)의 XML 을 직접 고친다(다시 쓰지 않음). 고치는 파트만 바뀌고 나머지(차트·SmartArt·동영상·전환·애니메이션)는 그대로 둔다.
 * 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용). pkg = { read(path)→Promise<string|null>, write(path,str), writeBin(path,Uint8Array), remove(path), list()→[path] }.
 * 슬라이드 안 도형 고치기는 문자열 함수(xml → xml)라 따로도 시험된다.
 */
(function (global) {
  'use strict';

  var NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  var T_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
  var T_NOTES = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var EMU = 12700;                                           // 1pt

  // ============================== 기본 도우미 ==============================
  function escX(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unescX(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function attrOf(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function setAttr(tag, name, val) {
    var re = new RegExp('(\\s' + name + '=")[^"]*(")');
    if (re.test(tag)) return tag.replace(re, function (m, a, b) { return a + val + b; });
    return tag.replace(/\s*(\/?>)$/, ' ' + name + '="' + val + '"$1');
  }
  function delAttr(tag, name) { return tag.replace(new RegExp('\\s' + name + '="[^"]*"'), ''); }
  function relsPathOf(p) { var i = p.lastIndexOf('/'); return p.slice(0, i + 1) + '_rels/' + p.slice(i + 1) + '.rels'; }
  function dirOf(p) { return p.slice(0, p.lastIndexOf('/') + 1); }
  function resolvePath(base, target) {
    if (/^[a-z]+:/i.test(target)) return null;
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = dirOf(base).split('/').filter(Boolean);
    target.split('/').forEach(function (s) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); });
    return parts.join('/');
  }
  function relTarget(from, to) {                              // from 파트 기준 상대 경로
    var a = dirOf(from).split('/').filter(Boolean), b = to.split('/'), i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    var up = a.length - i, out = []; for (var k = 0; k < up; k++) out.push('..');
    return out.concat(b.slice(i)).join('/');
  }
  function parseRels(xml) {
    var out = [], re = /<Relationship\b[^>]*?\/?>/g, m;
    while ((m = re.exec(xml || ''))) {
      var t = m[0];
      out.push({ id: attrOf(t, 'Id'), type: attrOf(t, 'Type') || '', target: attrOf(t, 'Target') || '', mode: attrOf(t, 'TargetMode'), raw: t });
    }
    return out;
  }
  function relKind(t) { return t.replace(/^.*\//, ''); }
  function nextRid(relsXml) { var mx = 0; (relsXml.match(/\bId="rId(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return 'rId' + (mx + 1); }
  function addRel(relsXml, type, target) {
    var id = nextRid(relsXml), tag = '<Relationship Id="' + id + '" Type="' + type + '" Target="' + escX(target) + '"/>';
    return { id: id, xml: relsXml.replace('</Relationships>', tag + '</Relationships>') };
  }
  function emptyRels() { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'; }
  function ctAdd(ct, part, type) { if (ct.indexOf('PartName="' + part + '"') >= 0) return ct; return ct.replace('</Types>', '<Override PartName="' + part + '" ContentType="' + type + '"/></Types>'); }
  function ctDel(ct, part) { return ct.replace(new RegExp('<Override\\b[^>]*PartName="' + part.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''); }
  function ctDefault(ct, ext, type) { if (new RegExp('<Default\\b[^>]*Extension="' + ext + '"', 'i').test(ct)) return ct; return ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="' + ext + '" ContentType="' + type + '"/>'); }
  async function must(pkg, p) { var s = await pkg.read(p); if (s == null) throw new Error('문서 안에 ' + p + ' 이(가) 없습니다'); return s; }

  var TAG_SRC = '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|<(\\/?)([^\\s\\/>]+)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(\\/?)>';
  // 한 요소(여는 곳 s 부터 짝 닫는 곳까지)의 끝 위치
  function elemEnd(xml, s) {
    var re = new RegExp(TAG_SRC, 'g'), m, depth = 0; re.lastIndex = s;
    while ((m = re.exec(xml))) {
      if (!m[2]) continue;
      if (m[1]) { depth--; if (depth === 0) return re.lastIndex; }
      else if (m[4]) { if (depth === 0) return re.lastIndex; }
      else depth++;
    }
    return -1;
  }
  // 어떤 요소 안(자식들)의 맨 위 단계 요소 목록 [{name,s,e}] — xml 은 부모 요소 전체 문자열, from = 부모 여는 태그 끝
  function childrenOf(xml, from, to) {
    var re = new RegExp(TAG_SRC, 'g'), m, depth = 0, out = [], cur = null; re.lastIndex = from;
    while ((m = re.exec(xml)) && m.index < to) {
      if (!m[2]) continue;
      if (m[1]) { depth--; if (depth === 0 && cur) { cur.e = re.lastIndex; out.push(cur); cur = null; } }
      else if (m[4]) { if (depth === 0) out.push({ name: m[2], s: m.index, e: re.lastIndex }); }
      else { if (depth === 0) cur = { name: m[2], s: m.index, e: -1 }; depth++; }
    }
    return out;
  }

  // ============================== 슬라이드 목록 ==============================
  async function readDeck(pkg) {
    var pres = await must(pkg, 'ppt/presentation.xml'), rels = await must(pkg, 'ppt/_rels/presentation.xml.rels');
    var rl = parseRels(rels), byId = {}; rl.forEach(function (r) { byId[r.id] = r; });
    var sz = /<p:sldSz\b[^>]*>/.exec(pres), W = sz ? +attrOf(sz[0], 'cx') : 9144000, H = sz ? +attrOf(sz[0], 'cy') : 6858000;
    var slides = [], re = /<p:sldId\b[^>]*?\/?>/g, m;
    while ((m = re.exec(pres))) {
      var rid = attrOf(m[0], 'r:id'), rel = byId[rid]; if (!rel) continue;
      var path = resolvePath('ppt/presentation.xml', rel.target); if (!path) continue;
      slides.push({ idTag: m[0], id: +attrOf(m[0], 'id'), rid: rid, path: path });
    }
    return { pres: pres, rels: rels, rl: rl, slides: slides, W: W, H: H };
  }
  // 슬라이드마다 숨김 여부·글 제목 같은 가벼운 정보
  async function listSlides(pkg) {
    var d = await readDeck(pkg), out = [];
    for (var i = 0; i < d.slides.length; i++) {
      var x = await pkg.read(d.slides[i].path) || '', root = /<p:sld\b[^>]*>/.exec(x);
      var sr = parseRels(await pkg.read(relsPathOf(d.slides[i].path)) || '');
      out.push({ path: d.slides[i].path, id: d.slides[i].id, hidden: !!(root && attrOf(root[0], 'show') === '0'),
        hasNotes: sr.some(function (r) { return relKind(r.type) === 'notesSlide'; }) });
    }
    return { slides: out, W: d.W, H: d.H };
  }
  function nextNum(pkg, dir, base, ext) {
    var mx = 0, re = new RegExp('^' + dir.replace(/[.\/]/g, '\\$&') + base + '(\\d+)\\.' + ext + '$');
    pkg.list().forEach(function (p) { var m = re.exec(p); if (m) mx = Math.max(mx, +m[1]); });
    return mx + 1;
  }
  function sectionInsert(pres, afterId, newId) {
    if (pres.indexOf('<p14:sectionLst') < 0) return pres;
    var tag = '<p14:sldId id="' + newId + '"/>';
    if (afterId != null) {
      var re = new RegExp('<p14:sldId id="' + afterId + '"\\s*/>');
      if (re.test(pres)) return pres.replace(re, function (m) { return m + tag; });
    }
    return pres.replace(/<p14:sldIdLst>/, '<p14:sldIdLst>' + tag);       // 맨 앞(첫 구역)
  }
  function sectionRemove(pres, id) { return pres.replace(new RegExp('<p14:sldId id="' + id + '"\\s*/>', 'g'), ''); }
  function placeSldId(pres, idx, newId, rid) {                // idx 자리(0부터)에 sldId 넣기
    var tag = '<p:sldId id="' + newId + '" r:id="' + rid + '"/>';
    var tags = pres.match(/<p:sldId\b[^>]*?\/?>/g) || [];
    if (!tags.length) return pres.replace(/<p:sldIdLst\s*\/>/, '<p:sldIdLst>' + tag + '</p:sldIdLst>');
    if (idx >= tags.length) { var last = tags[tags.length - 1]; return pres.replace(last, last + tag); }
    return pres.replace(tags[idx], tag + tags[idx]);
  }
  function maxSldId(pres) { var mx = 255; (pres.match(/<p:sldId\b[^>]*?\sid="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/id="(\d+)"/.exec(s)[1]); }); return mx; }

  // ---------- 배치(레이아웃) 목록 ----------
  var LAYOUT_KO = { 'Title Slide': '제목 슬라이드', 'Title and Content': '제목 및 내용', 'Section Header': '구역 머리글', 'Two Content': '내용 두 개', 'Comparison': '비교', 'Title Only': '제목만', 'Blank': '빈 화면', 'Content with Caption': '설명이 있는 내용', 'Picture with Caption': '설명이 있는 그림', 'Title and Vertical Text': '제목 및 세로 글', 'Vertical Title and Text': '세로 제목과 글' };
  async function listLayouts(pkg) {
    var out = [];
    pkg.list().filter(function (p) { return /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p); }).sort(function (a, b) { return +/(\d+)\.xml$/.exec(a)[1] - +/(\d+)\.xml$/.exec(b)[1]; }).forEach(function (p) { out.push({ path: p }); });
    for (var i = 0; i < out.length; i++) {
      var x = await pkg.read(out[i].path) || '', m = /<p:cSld\b[^>]*\sname="([^"]*)"/.exec(x);
      out[i].name = m ? (LAYOUT_KO[unescX(m[1])] || unescX(m[1])) : ('배치 ' + (i + 1));
    }
    return out;
  }
  function layoutPlaceholders(layoutXml) {                    // 슬라이드에 만들 자리표시자(제목·본문·부제목·내용). 날짜·바닥글·쪽 번호는 만들지 않는다
    var out = [], re = /<p:sp>[\s\S]*?<\/p:sp>/g, m;
    while ((m = re.exec(layoutXml))) {
      var ph = /<p:ph\b[^>]*?\/?>/.exec(m[0]); if (!ph) continue;
      var ty = attrOf(ph[0], 'type');
      if (ty === 'dt' || ty === 'ftr' || ty === 'sldNum' || ty === 'hdr') continue;
      var nm = /<p:cNvPr\b[^>]*\sname="([^"]*)"/.exec(m[0]);
      out.push({ ph: ph[0], name: nm ? nm[1] : 'Placeholder' });
    }
    return out;
  }
  function newSlideXml(phs) {
    var id = 1, sps = phs.map(function (p) {
      id++;
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + p.name.replace(/\s*\d+$/, '') + ' ' + (id - 1) + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + p.ph + '</p:nvPr></p:nvSpPr><p:spPr/>' +
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" altLang="en-US"/></a:p></p:txBody></p:sp>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ' + NS + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + sps + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  async function registerSlide(pkg, d, pos, path, afterIdForSection) {     // 목록에 올리기(관계·sldId·형식·구역)
    var rel = relTarget('ppt/presentation.xml', path), ar = addRel(d.rels, R + 'slide', rel);
    var nid = maxSldId(d.pres) + 1;
    var pres = placeSldId(d.pres, pos, nid, ar.id);
    pres = sectionInsert(pres, afterIdForSection, nid);
    pkg.write('ppt/presentation.xml', pres); pkg.write('ppt/_rels/presentation.xml.rels', ar.xml);
    pkg.write('[Content_Types].xml', ctAdd(await must(pkg, '[Content_Types].xml'), '/' + path, T_SLIDE));
    return nid;
  }
  // 슬라이드 추가. layoutPath 없으면 앞 슬라이드와 같은 배치(없으면 첫 배치). 반환: {index}
  async function addSlide(pkg, atIndex, layoutPath) {
    var d = await readDeck(pkg), n = d.slides.length;
    atIndex = Math.max(0, Math.min(n, atIndex));
    var lay = layoutPath;
    if (!lay) {
      var ref = d.slides[Math.max(0, Math.min(n - 1, atIndex - 1))];
      if (ref) { var rr = parseRels(await pkg.read(relsPathOf(ref.path)) || ''); var lr = rr.filter(function (r) { return relKind(r.type) === 'slideLayout'; })[0]; if (lr) lay = resolvePath(ref.path, lr.target); }
      if (!lay) { var ls = await listLayouts(pkg); if (ls.length) lay = ls[0].path; }
    }
    if (!lay) throw new Error('이 문서에는 슬라이드 배치가 없어 새 슬라이드를 만들 수 없습니다');
    var lx = await must(pkg, lay), num = nextNum(pkg, 'ppt/slides/', 'slide', 'xml'), path = 'ppt/slides/slide' + num + '.xml';
    pkg.write(path, newSlideXml(layoutPlaceholders(lx)));
    var rels = emptyRels(), a = addRel(rels, R + 'slideLayout', relTarget(path, lay));
    pkg.write(relsPathOf(path), a.xml);
    await registerSlide(pkg, d, atIndex, path, atIndex > 0 ? d.slides[atIndex - 1].id : null);
    return { index: atIndex, path: path };
  }
  // 복제를 막는 내용(삽입 개체·새 형식 차트)이 있으면 이유를 돌려준다. 차트·SmartArt·동영상·소리는 복제할 수 있다(O-0861 v10.8: 차트·SmartArt 부품을 따로 복사)
  function dupBlock(xml, rels) {
    if (/<p:oleObj[\s>]/.test(xml)) return '삽입된 개체(표·문서)';
    for (var i = 0; i < rels.length; i++) { var k = relKind(rels[i].type); if (k === 'chartEx') return '새 형식 차트'; if (/^(oleObject|package|vmlDrawing)$/.test(k)) return k === 'vmlDrawing' ? '옛 형식 개체' : '삽입된 개체(표·문서)'; }
    return null;
  }
  // 복제할 때 새 슬라이드가 따로 가져야 하는 부품(차트·SmartArt와 그 딸린 부품)
  var OWNED_KIND = /^(chart|chartUserShapes|diagramData|diagramLayout|diagramQuickStyle|diagramColors|diagramDrawing|chartStyle|chartColorStyle|themeOverride)$/;
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
  function freeName(pkg, p) {                                // 같은 폴더·같은 이름 뒤 번호만 올려 빈 이름을 찾는다
    var m = /^(.*\/)([^\/]*?)(\d*)(\.[^.\/]+)$/.exec(p); if (!m) return p + '_2';
    var re = new RegExp('^' + reEsc(m[1] + m[2]) + '(\\d*)' + reEsc(m[4]) + '$'), mx = 0;
    pkg.list().forEach(function (q) { var mm = re.exec(q); if (mm) mx = Math.max(mx, mm[1] ? +mm[1] : 0); });
    return m[1] + m[2] + (mx + 1) + m[4];
  }
  // 부품 하나를 새 이름으로 복사하고 그 부품이 가진 관계(rels)도 따라 복사한다. 반환: 새 경로. ctx.ct 는 [Content_Types].xml 문자열(복사하며 갱신)
  async function clonePart(pkg, src, done, ctx) {
    if (done[src]) return done[src];
    var dst = freeName(pkg, src); done[src] = dst;
    var isText = /\.(xml|rels|vml)$/i.test(src), data;
    if (isText) data = await pkg.read(src); else { if (!pkg.readBin) throw new Error('이 환경에서는 ' + src + ' 를 복사할 수 없습니다'); data = await pkg.readBin(src); }
    if (data == null) throw new Error('문서 안에 ' + src + ' 이(가) 없습니다');
    if (isText) pkg.write(dst, data); else pkg.writeBin(dst, data);
    var cm = new RegExp('<Override\\b[^>]*PartName="/' + reEsc(src) + '"[^>]*>').exec(ctx.ct);
    if (cm) { var ty = attrOf(cm[0], 'ContentType'); ctx.ct = ctAdd(ctx.ct, '/' + dst, ty); }
    var rp = relsPathOf(src), rx = await pkg.read(rp);
    if (rx != null) {
      var nx = rx, rls = parseRels(rx);
      for (var i = 0; i < rls.length; i++) {
        var r = rls[i]; if (r.mode === 'External') continue;
        var abs = resolvePath(src, r.target); if (!abs) continue;
        var kind = relKind(r.type), nd = (OWNED_KIND.test(kind) || kind === 'package') ? await clonePart(pkg, abs, done, ctx) : abs;
        nx = nx.replace(r.raw, r.raw.replace(/Target="[^"]*"/, 'Target="' + escX(relTarget(dst, nd)) + '"'));
      }
      pkg.write(relsPathOf(dst), nx);
    }
    return dst;
  }
  async function duplicateSlide(pkg, idx) {
    var d = await readDeck(pkg), src = d.slides[idx]; if (!src) throw new Error('슬라이드를 찾지 못했습니다');
    var xml = await must(pkg, src.path), rels = await pkg.read(relsPathOf(src.path)) || emptyRels(), rl = parseRels(rels);
    var why = dupBlock(xml, rl); if (why) return { err: '이 슬라이드에는 ' + (global.SOffice && global.SOffice.josa ? global.SOffice.josa(why, '이') : why + '이(가)') + ' 있어서 폰에서는 복제할 수 없습니다. 순서 바꾸기와 지우기는 할 수 있습니다.' };
    var num = nextNum(pkg, 'ppt/slides/', 'slide', 'xml'), path = 'ppt/slides/slide' + num + '.xml';
    var notesRel = rl.filter(function (r) { return relKind(r.type) === 'notesSlide'; })[0];
    var newRels = rels;
    if (notesRel) newRels = newRels.replace(notesRel.raw, '');                // 노트는 아래에서 새로 만들어 이어 붙인다
    // 차트·SmartArt 는 슬라이드마다 자기 부품이 있어야 하므로 따로 복사하고 새 슬라이드가 그것을 가리키게 한다(동영상·그림은 같은 파일을 함께 쓴다)
    var own = rl.filter(function (r) { return r.mode !== 'External' && OWNED_KIND.test(relKind(r.type)); });
    if (own.length) {
      var cx = { ct: await must(pkg, '[Content_Types].xml') }, done = {};
      for (var i = 0; i < own.length; i++) {
        var abs = resolvePath(src.path, own[i].target), nd = await clonePart(pkg, abs, done, cx);
        newRels = newRels.replace(own[i].raw, own[i].raw.replace(/Target="[^"]*"/, 'Target="' + escX(relTarget(path, nd)) + '"'));
      }
      pkg.write('[Content_Types].xml', cx.ct);
    }
    pkg.write(path, xml); pkg.write(relsPathOf(path), newRels);
    if (notesRel) {
      var np = resolvePath(src.path, notesRel.target), nx = await pkg.read(np);
      if (nx != null) {
        var nn = nextNum(pkg, 'ppt/notesSlides/', 'notesSlide', 'xml'), npath = 'ppt/notesSlides/notesSlide' + nn + '.xml';
        var nrels = await pkg.read(relsPathOf(np)) || emptyRels(), nrl = parseRels(nrels).filter(function (r) { return relKind(r.type) === 'slide'; })[0];
        if (nrl) nrels = nrels.replace(nrl.raw, nrl.raw.replace(/Target="[^"]*"/, 'Target="' + relTarget(npath, path) + '"'));
        pkg.write(npath, nx); pkg.write(relsPathOf(npath), nrels);
        var cur = await pkg.read(relsPathOf(path)), a = addRel(cur, R + 'notesSlide', relTarget(path, npath)); pkg.write(relsPathOf(path), a.xml);
        pkg.write('[Content_Types].xml', ctAdd(await must(pkg, '[Content_Types].xml'), '/' + npath, T_NOTES));
      }
    }
    var d2 = await readDeck(pkg);                                              // 위에서 content types 가 바뀌었으니 관계·본문은 다시 읽는다(presentation 은 그대로)
    await registerSlide(pkg, d2, idx + 1, path, src.id);
    return { index: idx + 1, path: path };
  }
  async function deleteSlide(pkg, idx) {
    var d = await readDeck(pkg); if (d.slides.length <= 1) return { err: '슬라이드가 하나뿐이라 지울 수 없습니다.' };
    var s = d.slides[idx]; if (!s) throw new Error('슬라이드를 찾지 못했습니다');
    var pres = d.pres.replace(s.idTag, ''); pres = sectionRemove(pres, s.id);
    pres = pres.replace(new RegExp('<p:sldId\\s+r:id="' + s.rid + '"\\s*/>', 'g'), '');      // 쇼 목록(custShow)에서도
    pkg.write('ppt/presentation.xml', pres);
    pkg.write('ppt/_rels/presentation.xml.rels', d.rels.replace((d.rl.filter(function (r) { return r.id === s.rid; })[0] || {}).raw || '', ''));
    var ct = await must(pkg, '[Content_Types].xml'), rels = parseRels(await pkg.read(relsPathOf(s.path)) || '');
    rels.forEach(function (r) {
      if (relKind(r.type) !== 'notesSlide') return;
      var np = resolvePath(s.path, r.target); if (!np) return;
      pkg.remove(np); pkg.remove(relsPathOf(np)); ct = ctDel(ct, '/' + np);
    });
    pkg.remove(s.path); pkg.remove(relsPathOf(s.path)); ct = ctDel(ct, '/' + s.path);
    pkg.write('[Content_Types].xml', ct);
    // 지운 슬라이드로 가던 다른 슬라이드의 링크 정리
    for (var i = 0; i < d.slides.length; i++) {
      if (i === idx) continue;
      var rp = relsPathOf(d.slides[i].path), rx = await pkg.read(rp); if (!rx) continue;
      var bad = parseRels(rx).filter(function (r) { return relKind(r.type) === 'slide' && resolvePath(d.slides[i].path, r.target) === s.path; });
      if (!bad.length) continue;
      var sx = await must(pkg, d.slides[i].path);
      bad.forEach(function (b) {
        rx = rx.replace(b.raw, '');
        sx = sx.replace(new RegExp('<a:hlink(?:Click|MouseOver)\\b[^>]*\\sr:id="' + b.id + '"[^>]*?(?:/>|>[\\s\\S]*?</a:hlink(?:Click|MouseOver)>)', 'g'), '');
      });
      pkg.write(rp, rx); pkg.write(d.slides[i].path, sx);
    }
    return { ok: true };
  }
  async function moveSlide(pkg, from, to) {
    var d = await readDeck(pkg), n = d.slides.length;
    if (from < 0 || from >= n || to < 0 || to >= n) throw new Error('자리를 찾지 못했습니다');
    if (from === to) return { ok: true };
    var s = d.slides[from], pres = d.pres.replace(s.idTag, '');
    var tags = pres.match(/<p:sldId\b[^>]*?\/?>/g) || [];
    pres = to >= tags.length ? pres.replace(tags[tags.length - 1], tags[tags.length - 1] + s.idTag) : pres.replace(tags[to], s.idTag + tags[to]);
    if (pres.indexOf('<p14:sectionLst') >= 0) {                                   // 구역: 옮긴 자리의 이웃 구역으로 옮긴다
      pres = sectionRemove(pres, s.id);
      var order = pres.match(/<p:sldId\b[^>]*?\/?>/g).map(function (t) { return +attrOf(t, 'id'); }), at = order.indexOf(s.id);
      var prev = at > 0 ? order[at - 1] : null;
      pres = sectionInsert(pres, prev, s.id);
    }
    pkg.write('ppt/presentation.xml', pres);
    return { ok: true };
  }
  async function hideSlide(pkg, idx, hide) {
    var d = await readDeck(pkg), s = d.slides[idx]; if (!s) throw new Error('슬라이드를 찾지 못했습니다');
    var x = await must(pkg, s.path);
    x = x.replace(/<p:sld\b[^>]*>/, function (t) { return hide ? setAttr(t, 'show', '0') : delAttr(t, 'show'); });
    pkg.write(s.path, x); return { ok: true };
  }

  // ============================== 슬라이드 안 도형 ==============================
  var XF_RE = /<(a|p):xfrm\b([^>]*)>\s*<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/;
  function spTreeRange(xml) {
    var s = xml.indexOf('<p:spTree>'); if (s < 0) { var m = /<p:spTree\b[^>]*>/.exec(xml); if (!m) return null; s = m.index; }
    var open = /<p:spTree\b[^>]*>/.exec(xml.slice(s)), from = s + open[0].length, e = xml.indexOf('</p:spTree>', from);
    return e < 0 ? null : { from: from, to: e };
  }
  function topShapes(xml) {                                   // 맨 위 단계 도형(그림·표·도형·그룹·선·대체 콘텐츠)
    var r = spTreeRange(xml); if (!r) return [];
    return childrenOf(xml, r.from, r.to).filter(function (c) { return /^p:(sp|pic|graphicFrame|grpSp|cxnSp)$|^mc:AlternateContent$/.test(c.name); }).map(function (c) { c.xml = xml.slice(c.s, c.e); return c; });
  }
  function shapeId(x) { var m = /<p:cNvPr\b[^>]*?\sid="(\d+)"/.exec(x); return m ? +m[1] : 0; }
  function shapeName(x) { var m = /<p:cNvPr\b[^>]*?\sname="([^"]*)"/.exec(x); return m ? unescX(m[1]) : ''; }
  function kindOf(c) {
    var x = c.xml;
    if (c.name === 'mc:AlternateContent') return 'other';
    if (c.name === 'p:pic') return 'pic';
    if (c.name === 'p:cxnSp') return 'line';
    if (c.name === 'p:grpSp') return 'group';
    if (c.name === 'p:graphicFrame') { if (/<a:tbl[\s>]/.test(x)) return 'table'; if (/<c:chart[\s>]/.test(x)) return 'chart'; if (/<dgm:relIds/.test(x)) return 'smart'; if (/<p:oleObj[\s>]/.test(x)) return 'ole'; return 'other'; }
    if (/<p:cNvSpPr\b[^>]*\stxBox="1"/.test(x)) return 'text';
    if (/<p:ph\b/.test(x)) return 'ph';
    return /<p:txBody>/.test(x) && /<a:t[\s>]/.test(x) ? 'text' : 'shape';
  }
  function xfOf(x, name) {
    var scope = x;
    if (name === 'p:grpSp') { var g = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(x); scope = g ? g[0] : ''; }
    else if (name === 'p:graphicFrame') { var f = /<p:xfrm\b[\s\S]*?<\/p:xfrm>/.exec(x); scope = f ? f[0] : ''; }
    else { var sp = /<p:spPr\b[^>]*?\/>|<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/.exec(x); scope = sp ? sp[0] : ''; }
    var m = XF_RE.exec(scope); return m ? { x: +m[3], y: +m[4], w: +m[5], h: +m[6] } : null;
  }
  // 슬라이드 속 도형 목록. phGeom(phTag) → {x,y,w,h}|null (배치·마스터에서 위치를 물려받는 자리표시자용)
  function listShapes(xml, phGeom) {
    return topShapes(xml).map(function (c) {
      var k = kindOf(c), g = xfOf(c.xml, c.name), ph = /<p:ph\b[^>]*?\/?>/.exec(c.xml), inherited = false;
      if (!g && ph && phGeom) { g = phGeom(ph[0]); inherited = !!g; }
      var text = ''; (c.xml.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || []).forEach(function (t) { text += unescX(t.replace(/<[^>]+>/g, '')) + ' '; });
      var ed = !(k === 'chart' || k === 'smart' || k === 'ole' || k === 'other');
      return { id: shapeId(c.xml), name: shapeName(c.xml), label: friendlyName(shapeName(c.xml), k, ph ? ph[0] : ''), canLine: k === 'text' || k === 'ph' || k === 'shape' || k === 'line', kind: k, name_: c.name, g: g, inherited: inherited, text: text.trim(), isPh: !!ph, phTag: ph ? ph[0] : '', canMove: ed && !!g, canText: k === 'text' || k === 'ph' || k === 'shape' || k === 'table', canFill: k === 'text' || k === 'ph' || k === 'shape' };
    }).filter(function (s) { return s.id; });
  }
  function findShape(xml, id) { var t = topShapes(xml); for (var i = 0; i < t.length; i++) if (shapeId(t[i].xml) === id) return t[i]; return null; }
  function maxId(xml) { var mx = 1; (xml.match(/<p:cNvPr\b[^>]*?\sid="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/id="(\d+)"/.exec(s)[1]); }); return mx; }
  function insertShape(xml, shapeXml) {                       // 맨 위(앞쪽 그림 위)에 쌓는다 — spTree 맨 끝
    var r = spTreeRange(xml); return xml.slice(0, r.to) + shapeXml + xml.slice(r.to);
  }
  function removeShape(xml, id) { var s = findShape(xml, id); if (!s) throw new Error('도형을 찾지 못했습니다'); return xml.slice(0, s.s) + xml.slice(s.e); }
  function clampGeom(g, W, H) {
    var w = Math.max(91440, Math.round(g.w)), h = Math.max(91440, Math.round(g.h));
    return { x: Math.round(g.x), y: Math.round(g.y), w: Math.min(w, W * 3), h: Math.min(h, H * 3) };
  }
  function setGeom(xml, id, g) {
    var s = findShape(xml, id); if (!s) throw new Error('도형을 찾지 못했습니다');
    var x = s.xml, name = s.name, f = '<a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/>';
    var nx;
    if (name === 'p:graphicFrame') {
      nx = /<p:xfrm\b[\s\S]*?<\/p:xfrm>/.test(x) ? x.replace(/(<p:xfrm\b[^>]*>)\s*<a:off[^>]*\/>\s*<a:ext[^>]*\/>/, '$1' + f) : x.replace(/(<\/p:nvGraphicFramePr>)/, '$1<p:xfrm>' + f + '</p:xfrm>');
    } else if (name === 'p:grpSp') {
      nx = x.replace(/(<p:grpSpPr\b[^>]*>\s*<a:xfrm\b[^>]*>)\s*<a:off[^>]*\/>\s*<a:ext[^>]*\/>/, '$1' + f);
    } else if (XF_RE.test(/<p:spPr\b[^>]*?\/>|<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/.exec(x) ? /<p:spPr\b[^>]*?\/>|<p:spPr\b[^>]*>[\s\S]*?<\/p:spPr>/.exec(x)[0] : '')) {
      nx = x.replace(/(<p:spPr\b[^>]*>\s*<a:xfrm\b[^>]*>)\s*<a:off[^>]*\/>\s*<a:ext[^>]*\/>/, '$1' + f);
    } else if (/<p:spPr\s*\/>/.test(x)) nx = x.replace(/<p:spPr\s*\/>/, '<p:spPr><a:xfrm>' + f + '</a:xfrm></p:spPr>');
    else nx = x.replace(/(<p:spPr\b[^>]*>)/, '$1<a:xfrm>' + f + '</a:xfrm>');
    if (nx === x) throw new Error('이 도형의 위치를 바꿀 수 없습니다');
    return xml.slice(0, s.s) + nx + xml.slice(s.e);
  }
  function nvBlock(id, name, extra) { return '<p:nvSpPr><p:cNvPr id="' + id + '" name="' + escX(name) + '"/><p:cNvSpPr' + (extra || '') + '/><p:nvPr/></p:nvSpPr>'; }
  function para(text, rpr) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    return lines.map(function (ln) { return ln ? '<a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"' + (rpr || '') + ' dirty="0"/><a:t>' + escX(ln) + '</a:t></a:r></a:p>' : '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/></a:p>'; }).join('');
  }
  function addTextBox(xml, g, text) {
    var id = maxId(xml) + 1;
    var sp = '<p:sp>' + nvBlock(id, '글 상자 ' + (id - 1), ' txBox="1"') + '<p:spPr><a:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' + para(text || '여기에 글을 씁니다', ' sz="2000"') + '</p:txBody></p:sp>';
    return { xml: insertShape(xml, sp), id: id };
  }
  var SHAPES = { rect: '네모', roundRect: '둥근 네모', ellipse: '동그라미', triangle: '삼각형', rightArrow: '오른쪽 화살표', star5: '별', diamond: '마름모' };
  function addAutoShape(xml, prst, g, fillHex, text) {
    var id = maxId(xml) + 1, fill = fillHex || '4472C4';
    var sp = '<p:sp>' + nvBlock(id, (SHAPES[prst] || '도형') + ' ' + (id - 1)) + '<p:spPr><a:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/></a:xfrm><a:prstGeom prst="' + prst + '"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + fill + '"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="2F528F"/></a:solidFill></a:ln></p:spPr>' +
      '<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>' + (text ? '<a:r><a:rPr lang="ko-KR" altLang="en-US" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>' + escX(text) + '</a:t></a:r>' : '<a:endParaRPr lang="ko-KR" altLang="en-US" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:endParaRPr>') + '</a:p></p:txBody></p:sp>';
    return { xml: insertShape(xml, sp), id: id };
  }
  function addLine(xml, g, arrow) {
    var id = maxId(xml) + 1;
    var sp = '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + (arrow ? '화살표 ' : '선 ') + (id - 1) + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/></a:xfrm><a:prstGeom prst="' + (arrow ? 'straightConnector1' : 'line') + '"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="404040"/></a:solidFill>' + (arrow ? '<a:tailEnd type="triangle"/>' : '') + '</a:ln></p:spPr></p:cxnSp>';
    return { xml: insertShape(xml, sp), id: id };
  }
  function addPictureXml(xml, rid, g, name) {
    var id = maxId(xml) + 1;
    var sp = '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + escX(name || '그림') + ' ' + (id - 1) + '" descr=""/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    return { xml: insertShape(xml, sp), id: id };
  }
  // 그림 파일을 문서에 넣고(관계·형식 등록) 슬라이드에 올린다. bytes: Uint8Array, ext: png|jpg|jpeg|gif
  async function addPicture(pkg, slidePath, bytes, ext, pxW, pxH) {
    ext = String(ext || 'png').toLowerCase().replace('jpeg', 'jpg');
    var mime = ext === 'jpg' ? 'image/jpeg' : (ext === 'gif' ? 'image/gif' : 'image/png');
    var n = nextNum(pkg, 'ppt/media/', 'image', ext), mp = 'ppt/media/image' + n + '.' + ext;
    pkg.writeBin(mp, bytes);
    pkg.write('[Content_Types].xml', ctDefault(await must(pkg, '[Content_Types].xml'), ext, mime));
    var rp = relsPathOf(slidePath), ar = addRel(await pkg.read(rp) || emptyRels(), R + 'image', relTarget(slidePath, mp));
    pkg.write(rp, ar.xml);
    var d = await readDeck(pkg), maxW = d.W * 0.6, maxH = d.H * 0.6, k = Math.min(maxW / (pxW || 1), maxH / (pxH || 1)), w = Math.round((pxW || 1) * k), h = Math.round((pxH || 1) * k);
    var x = await must(pkg, slidePath), r = addPictureXml(x, ar.id, { x: Math.round((d.W - w) / 2), y: Math.round((d.H - h) / 2), w: w, h: h }, '그림');
    pkg.write(slidePath, r.xml); return { id: r.id };
  }
  function tcXml(text, w) {
    var b = ['L', 'R', 'T', 'B'].map(function (s) { return '<a:ln' + s + ' w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="808080"/></a:solidFill><a:prstDash val="solid"/></a:ln' + s + '>'; }).join('');
    return '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + (text ? para(text, ' sz="1600"') : '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" sz="1600" dirty="0"/></a:p>') + '</a:txBody><a:tcPr>' + b + '</a:tcPr></a:tc>';
  }
  function addTable(xml, rows, cols, g) {
    var id = maxId(xml) + 1, cw = Math.floor(g.w / cols), rh = 370840, grid = '', trs = '', i, j;
    for (j = 0; j < cols; j++) grid += '<a:gridCol w="' + cw + '"/>';
    for (i = 0; i < rows; i++) { var tcs = ''; for (j = 0; j < cols; j++) tcs += tcXml('', cw); trs += '<a:tr h="' + rh + '">' + tcs + '</a:tr>'; }
    var gf = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="표 ' + (id - 1) + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + (cw * cols) + '" cy="' + (rh * rows) + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>' + grid + '</a:tblGrid>' + trs + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
    return { xml: insertShape(xml, gf), id: id };
  }
  // ---- 채우기·테두리 색 ----
  var FILL_RE = /<a:(?:noFill|solidFill|gradFill|blipFill|pattFill|grpFill)\b(?:\/>|[^>]*>[\s\S]*?<\/a:(?:noFill|solidFill|gradFill|blipFill|pattFill|grpFill)>)/;
  function spPrRange(x) { var m = /<p:spPr\b[^>]*?(\/>|>)/.exec(x); if (!m) return null; var s = m.index; if (m[1] === '/>') return { s: s, e: s + m[0].length, self: true }; var e = x.indexOf('</p:spPr>', s); return e < 0 ? null : { s: s, e: e + 9, self: false }; }
  function setFill(xml, id, hex) {                             // hex = 'RRGGBB' | null(채우기 없음)
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, r = spPrRange(x); if (!r) throw new Error('이 도형에는 색을 넣을 수 없습니다');
    var sp = x.slice(r.s, r.e), fill = hex ? '<a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill>' : '<a:noFill/>';
    if (r.self) sp = sp.replace(/<p:spPr\s*\/>/, '<p:spPr>' + fill + '</p:spPr>');
    else {
      var open = /^<p:spPr\b[^>]*>/.exec(sp)[0], body = sp.slice(open.length, sp.length - 9), lnKeep = [];
      body = body.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/, function (m) { lnKeep.push(m); return '\u0001'; });
      if (FILL_RE.test(body)) body = body.replace(FILL_RE, fill);
      else {
        var geom = /<a:(?:prstGeom|custGeom)\b[\s\S]*?<\/a:(?:prstGeom|custGeom)>/.exec(body), xf = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(body);
        var at = geom ? geom.index + geom[0].length : (xf ? xf.index + xf[0].length : 0);
        body = body.slice(0, at) + fill + body.slice(at);
      }
      sp = open + body.replace('\u0001', lnKeep[0] || '') + '</p:spPr>';
    }
    return xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e);
  }
  function setLineColor(xml, id, hex) {                        // hex = 'RRGGBB' | null(선 없음)
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, r = spPrRange(x); if (!r) throw new Error('이 도형에는 선 색을 넣을 수 없습니다');
    var sp = x.slice(r.s, r.e), ln = hex ? '<a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill>' : '<a:noFill/>';
    if (/<a:ln\b/.test(sp)) {
      sp = sp.replace(/<a:ln\b([^>]*?)(\/>|>[\s\S]*?<\/a:ln>)/, function (m, at, rest) {
        if (rest === '/>') return '<a:ln' + at + '>' + ln + '</a:ln>';
        var inner = rest.slice(1, rest.length - 7).replace(FILL_RE, '');
        return '<a:ln' + at + '>' + ln + inner + '</a:ln>';
      });
    } else {
      var lnx = '<a:ln w="12700">' + ln + '</a:ln>';
      sp = r.self ? sp.replace(/<p:spPr\s*\/>/, '<p:spPr>' + lnx + '</p:spPr>') : sp.replace(/<\/p:spPr>$/, lnx + '</p:spPr>');
    }
    return xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e);
  }

  // ============================== 글자 서식 ==============================
  var RPR_AFTER_FILL = '(?:effectLst|effectDag|highlight|uLnTx|uLn|uFillTx|uFill|latin|ea|cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)';
  function editRPr(rpr, tag, f) {                              // rpr: 기존 rPr/endParaRPr 전체 문자열 또는 null, tag: 'a:rPr'|'a:endParaRPr'
    var open, inner = '', self = true;
    if (rpr) {
      var m = new RegExp('^<' + tag + '\\b([^>]*?)(\\/?)>').exec(rpr); open = '<' + tag + m[1]; self = m[2] === '/';
      if (!self) inner = rpr.slice(m[0].length, rpr.length - ('</' + tag + '>').length);
      open += '>';
    } else open = '<' + tag + ' lang="ko-KR" altLang="en-US" dirty="0">';
    var t = open.replace(/>$/, '');
    function A(n, v) { t = new RegExp('\\s' + n + '="').test(t) ? t.replace(new RegExp('(\\s' + n + '=")[^"]*"'), '$1' + v + '"') : t + ' ' + n + '="' + v + '"'; }
    if (f.bold != null) A('b', f.bold ? '1' : '0');
    if (f.italic != null) A('i', f.italic ? '1' : '0');
    if (f.underline != null) A('u', f.underline ? 'sng' : 'none');
    if (f.size != null) A('sz', Math.round(Math.max(6, Math.min(200, f.size)) * 100));
    if (f.color) {
      var fillX = '<a:solidFill><a:srgbClr val="' + f.color + '"/></a:solidFill>';
      if (/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>|<a:gradFill[\s\S]*?<\/a:gradFill>/.test(inner.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, ''))) {
        var lnKeep = /<a:ln\b[\s\S]*?<\/a:ln>/.exec(inner); var tmp = inner.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, '\u0001');
        tmp = tmp.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>|<a:gradFill[\s\S]*?<\/a:gradFill>/, fillX); inner = tmp.replace('\u0001', lnKeep ? lnKeep[0] : '');
      } else {
        var after = new RegExp('<a:' + RPR_AFTER_FILL + '\\b').exec(inner);
        inner = after ? inner.slice(0, after.index) + fillX + inner.slice(after.index) : inner + fillX;
      }
    }
    if (f.font) {
      inner = inner.replace(/<a:(?:latin|ea|cs)\b[^>]*?\/>/g, '');
      var fx = '<a:latin typeface="' + escX(f.font) + '"/><a:ea typeface="' + escX(f.font) + '"/>', at2 = /<a:(?:sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/.exec(inner);
      inner = at2 ? inner.slice(0, at2.index) + fx + inner.slice(at2.index) : inner + fx;
    }
    return t + (inner ? '>' + inner + '</' + tag + '>' : '/>');
  }
  var PPR_BU_ORDER = '(?:tabLst|defRPr|extLst)';
  function editPPr(ppr, f) {                                   // ppr: <a:pPr ...> 전체(없으면 null) → 새 pPr 문자열
    var open = '<a:pPr', inner = '', self = true;
    if (ppr) { var m = /^<a:pPr\b([^>]*?)(\/?)>/.exec(ppr); open = '<a:pPr' + m[1]; self = m[2] === '/'; if (!self) inner = ppr.slice(m[0].length, ppr.length - 8); }
    function A(n, v) { open = new RegExp('\\s' + n + '="').test(open) ? open.replace(new RegExp('(\\s' + n + '=")[^"]*"'), '$1' + v + '"') : open + ' ' + n + '="' + v + '"'; }
    if (f.align) A('algn', f.align);
    if (f.bullet != null) {
      inner = inner.replace(/<a:bu(?:None|AutoNum|Char|Blip)\b[^>]*?(?:\/>|>[\s\S]*?<\/a:bu(?:AutoNum|Char|Blip)>)/g, '');
      var bu = f.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : '<a:buNone/>';
      if (f.bullet) { inner = inner.replace(/<a:buFont\b[^>]*\/>/g, ''); if (!/\smarL="/.test(open)) A('marL', '342900'); if (!/\sindent="/.test(open)) A('indent', '-342900'); }
      else { if (/\smarL="/.test(open) && !f.keepIndent) { /* 글머리 해제 시 들여쓰기는 그대로 둔다 */ } }
      var at = new RegExp('<a:' + PPR_BU_ORDER + '\\b').exec(inner);
      inner = at ? inner.slice(0, at.index) + bu + inner.slice(at.index) : inner + bu;
    }
    return open + (inner ? '>' + inner + '</a:pPr>' : '/>');
  }
  // 한 구간(도형 전체 또는 표 칸 하나)의 문단들에 서식 적용
  function fmtRange(seg, f) {
    return seg.replace(/<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g, function (p) {
      var m = /^(<a:p(?:\s[^>]*[^>\/])?>)([\s\S]*)(<\/a:p>)$/.exec(p), inner = m[2];
      var pm = /^<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(inner);
      if (f.align || f.bullet != null) {
        var np = editPPr(pm ? pm[0] : null, f);
        inner = pm ? np + inner.slice(pm[0].length) : np + inner;
      }
      if (f.bold != null || f.italic != null || f.underline != null || f.size != null || f.color || f.font) {
        inner = inner.replace(/<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?/g, function (mm, rp) { return '<a:r>' + editRPr(rp || null, 'a:rPr', f); });
        inner = inner.replace(/<a:endParaRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/g, function (e) { return editRPr(e, 'a:endParaRPr', f); });
        if (!/<a:endParaRPr\b/.test(inner) && !/<a:r>/.test(inner)) inner += editRPr(null, 'a:endParaRPr', f);
      }
      return m[1] + inner + m[3];
    });
  }
  function cellRange(shapeXml, r, c) {                         // 표 칸 하나의 위치(셀 번호는 0부터)
    var tr = /<a:tr\b[\s\S]*?<\/a:tr>/g, m, i = 0;
    while ((m = tr.exec(shapeXml))) {
      if (i++ !== r) continue;
      var tc = /<a:tc\b[\s\S]*?<\/a:tc>/g, mm, j = 0;
      while ((mm = tc.exec(m[0]))) { if (j++ === c) return { s: m.index + mm.index, e: m.index + mm.index + mm[0].length }; }
    }
    return null;
  }
  // 도형(또는 표 칸)의 글자 서식. f = { bold, italic, underline, size(pt), color('RRGGBB'), align('l'|'ctr'|'r'|'just'), bullet(true|false) } — 안 준 것은 그대로
  function formatText(xml, id, f, cell) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, s = 0, e = x.length;
    if (cell) { var cr = cellRange(x, cell.r, cell.c); if (!cr) throw new Error('칸을 찾지 못했습니다'); s = cr.s; e = cr.e; }
    if (!/<a:p[\s>]/.test(x.slice(s, e))) throw new Error('이 도형에는 글이 들어갈 수 없습니다');
    return xml.slice(0, sh.s) + x.slice(0, s) + fmtRange(x.slice(s, e), f) + x.slice(e) + xml.slice(sh.e);
  }
  // 첫 글자 조각의 서식(화면 표시용). 못 찾은 항목은 null
  function readFormat(xml, id, cell) {
    var sh = findShape(xml, id); if (!sh) return null;
    var x = sh.xml; if (cell) { var cr = cellRange(x, cell.r, cell.c); if (!cr) return null; x = x.slice(cr.s, cr.e); }
    var rm = /<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))/.exec(x) || /(<a:endParaRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:endParaRPr>))/.exec(x), rp = rm ? rm[1] : '';
    var pm = /<a:pPr\b([^>]*)>/.exec(x), col = /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(rp);
    var szm = /\ssz="(\d+)"/.exec(rp);
    var fm = /<a:latin\b[^>]*?\stypeface="([^"]*)"/.exec(rp);
    return { font: fm ? unescX(fm[1]) : null, bold: /\sb="1"/.test(rp), italic: /\si="1"/.test(rp), underline: /\su="(?!none)/.test(rp), size: szm ? +szm[1] / 100 : null, color: col ? col[1].toUpperCase() : null, align: pm && /\salgn="(\w+)"/.exec(pm[1]) ? /\salgn="(\w+)"/.exec(pm[1])[1] : null, bullet: /<a:buChar\b/.test(x) };
  }
  // 줄(문단) 하나 더하기: 마지막 문단 서식을 이어받는다. cell 이 있으면 그 칸 안에
  function addParagraph(xml, id, text, cell) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, s = 0, e = x.length;
    if (cell) { var cr = cellRange(x, cell.r, cell.c); if (!cr) throw new Error('칸을 찾지 못했습니다'); s = cr.s; e = cr.e; }
    var seg = x.slice(s, e), ps = seg.match(/<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g);
    if (!ps) throw new Error('이 도형에는 줄을 넣을 수 없습니다');
    var last = ps[ps.length - 1], pm = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(last);
    var rp = /<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))/.exec(last) || null, ep = /<a:endParaRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/.exec(last);
    var rprs = rp ? rp[1] : (ep ? ep[0].replace(/^<a:endParaRPr/, '<a:rPr').replace(/<\/a:endParaRPr>$/, '</a:rPr>') : '<a:rPr lang="ko-KR" altLang="en-US" dirty="0"/>');
    var endp = ep ? ep[0] : '';
    var np = '<a:p>' + (pm ? pm[0] : '') + (text ? '<a:r>' + rprs + '<a:t>' + escX(text) + '</a:t></a:r>' : '') + (endp || (text ? '' : '<a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/>')) + '</a:p>';
    var at = seg.lastIndexOf(last) + last.length;
    return xml.slice(0, sh.s) + x.slice(0, s) + seg.slice(0, at) + np + seg.slice(at) + x.slice(e) + xml.slice(sh.e);
  }
  // 슬라이드 전체에서 n 번째 문단(편집기의 문단 번호 ord)을 지운다. 칸·상자의 마지막 문단이면 비운다
  function removeParagraph(xml, ord) {
    var re = /<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g, m, i = 0;
    while ((m = re.exec(xml))) {
      if (i++ !== ord) continue;
      var before = xml.slice(0, m.index), after = xml.slice(m.index + m[0].length);
      var siblingBefore = /<\/a:p>\s*$/.test(before), siblingAfter = /^\s*<a:p[\s>]/.test(after);
      var rep = (siblingBefore || siblingAfter) ? '' : '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/></a:p>';
      return before + rep + after;
    }
    throw new Error('줄을 찾지 못했습니다');
  }

  // 도형을 맨 앞(맨 위)·맨 뒤(맨 아래)로
  function reorderShape(xml, id, toFront) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var rest = xml.slice(0, sh.s) + xml.slice(sh.e), r = spTreeRange(rest);
    if (toFront) return rest.slice(0, r.to) + sh.xml + rest.slice(r.to);
    var first = topShapes(rest)[0], at = first ? first.s : r.to;
    return rest.slice(0, at) + sh.xml + rest.slice(at);
  }
  // 슬라이드 안 문단 번호(편집기의 ord) 범위: 이 도형(또는 표 칸)의 문단은 몇 번부터 몇 개인가
  function paraRange(xml, id, cell) {
    var sh = findShape(xml, id); if (!sh) return null;
    var x = sh.xml, s0 = 0, e0 = x.length;
    if (cell) { var cr = cellRange(x, cell.r, cell.c); if (!cr) return null; s0 = cr.s; e0 = cr.e; }
    var re = /<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g, before = (xml.slice(0, sh.s).match(re) || []).length;
    var pre = (x.slice(0, s0).match(re) || []).length, n = (x.slice(s0, e0).match(re) || []).length;
    return { from: before + pre, count: n };
  }

  // ============================== 표 줄·칸 ==============================
  function tblBlock(shapeXml) {
    var tbl = /<a:tbl>[\s\S]*<\/a:tbl>/.exec(shapeXml); if (!tbl) return null;
    if (/\s(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(tbl[0])) return { err: '이 표에는 합쳐진 칸이 있어서 줄·칸 넣고 빼기가 어렵습니다. 「표」 시트의 「합치기 풀기」로 먼저 풀거나, 「수정 요청」으로 맡겨 주십시오.' };
    return { tbl: tbl[0], at: tbl.index };
  }
  function blankCell(tc) {
    var tx = /<a:txBody>([\s\S]*)<\/a:txBody>/.exec(tc), head = /^<a:bodyPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:bodyPr>)\s*(?:<a:lstStyle\s*\/>|<a:lstStyle>[\s\S]*?<\/a:lstStyle>)?/.exec(tx ? tx[1] : '');
    var first = tx ? /<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/.exec(tx[1]) : null, ppr = first ? /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(first[0]) : null;
    var rp = first ? (/<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))/.exec(first[0]) || [null, null])[1] : null, ep = first ? /<a:endParaRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/.exec(first[0]) : null;
    var end = ep ? ep[0] : (rp ? rp.replace(/^<a:rPr/, '<a:endParaRPr').replace(/<\/a:rPr>$/, '</a:endParaRPr>') : '<a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/>');
    var np = '<a:p>' + (ppr ? ppr[0] : '') + end + '</a:p>';
    return tc.replace(/<a:txBody>[\s\S]*<\/a:txBody>/, '<a:txBody>' + (head ? head[0] : '<a:bodyPr/><a:lstStyle/>') + np + '</a:txBody>');
  }
  function stripExt(s) { return s.replace(/<a:extLst>[\s\S]*?<\/a:extLst>/g, ''); }
  function tableEdit(xml, id, op, r, c) {                      // op: rowAfter|rowBefore|rowDel|colAfter|colBefore|colDel — 반환 {xml}|{err}
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var tb = tblBlock(sh.xml); if (!tb) throw new Error('표가 아닙니다'); if (tb.err) return { err: tb.err };
    var tbl = tb.tbl, grid = /<a:tblGrid>([\s\S]*?)<\/a:tblGrid>/.exec(tbl), cols = grid[1].match(/<a:gridCol\b[^>]*?(?:\/>|>[\s\S]*?<\/a:gridCol>)/g) || [];
    var rows = tbl.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || [];
    var head = tbl.slice(0, tbl.indexOf(rows[0])), tailAt = tbl.lastIndexOf('</a:tr>') + 7, tail = tbl.slice(tailAt);
    function rowCells(row) { return row.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || []; }
    var newTbl, gfDelta = 0, frame = sh.xml;
    if (op.indexOf('row') === 0) {
      if (op === 'rowDel') { if (rows.length <= 1) return { err: '마지막 줄은 지울 수 없습니다.' }; var hh = +(attrOf(rows[r].match(/^<a:tr\b[^>]*>/)[0], 'h') || 0); rows.splice(r, 1); gfDelta = -hh; }
      else {
        var src = rows[r], hh2 = +(attrOf(src.match(/^<a:tr\b[^>]*>/)[0], 'h') || 370840), cells = rowCells(src);
        var nr = src.replace(/<a:tc\b[\s\S]*<\/a:tc>/, cells.map(function (tc) { return blankCell(stripExt(tc)); }).join('')); nr = stripExt(nr);
        rows.splice(op === 'rowAfter' ? r + 1 : r, 0, nr); gfDelta = hh2;
      }
      newTbl = head + rows.join('') + tail;
    } else {
      var total = cols.reduce(function (a, g) { return a + +attrOf(g.match(/^<a:gridCol\b[^>]*>/)[0], 'w'); }, 0), n = cols.length, widths = cols.map(function (g) { return +attrOf(g.match(/^<a:gridCol\b[^>]*>/)[0], 'w'); });
      if (op === 'colDel') {
        if (n <= 1) return { err: '마지막 칸(열)은 지울 수 없습니다.' };
        widths.splice(c, 1); rows = rows.map(function (row) { var cs = rowCells(row); return row.replace(cs[c], ''); });
        var sum = widths.reduce(function (a, b) { return a + b; }, 0); widths = widths.map(function (w) { return Math.round(w * total / sum); });
      } else {
        var pos = op === 'colAfter' ? c + 1 : c, nw = Math.round(total / (n + 1));
        widths = widths.map(function (w) { return Math.round(w * n / (n + 1)); }); widths.splice(pos, 0, nw);
        rows = rows.map(function (row) {
          var cs = rowCells(row), ref = cs[Math.min(c, cs.length - 1)], a0 = row.indexOf(cs[0]), z = row.lastIndexOf(cs[cs.length - 1]) + cs[cs.length - 1].length;
          cs.splice(pos, 0, blankCell(stripExt(ref))); return row.slice(0, a0) + cs.join('') + row.slice(z);
        });
      }
      var gridXml = '<a:tblGrid>' + widths.map(function (w, i2) { return '<a:gridCol w="' + w + '"/>'; }).join('') + '</a:tblGrid>';
      newTbl = head.replace(/<a:tblGrid>[\s\S]*?<\/a:tblGrid>/, gridXml) + rows.join('') + tail;
    }
    frame = frame.slice(0, tb.at) + newTbl + frame.slice(tb.at + tbl.length);
    if (gfDelta) frame = frame.replace(/(<p:xfrm\b[^>]*>\s*<a:off[^>]*\/>\s*<a:ext\s+cx="\d+"\s+cy=")(\d+)(")/, function (m, a, b2, d) { return a + Math.max(0, +b2 + gfDelta) + d; });
    return { xml: xml.slice(0, sh.s) + frame + xml.slice(sh.e) };
  }

  // ============================== 발표자 노트 ==============================
  async function slideNotes(pkg, slidePath) {
    var rl = parseRels(await pkg.read(relsPathOf(slidePath)) || ''), r = rl.filter(function (x) { return relKind(x.type) === 'notesSlide'; })[0];
    if (!r) return { has: false, text: '' };
    var np = resolvePath(slidePath, r.target), nx = await pkg.read(np); if (nx == null) return { has: false, text: '' };
    var sps = nx.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [], body = sps.filter(function (s) { return /<p:ph\b[^>]*\stype="body"/.test(s); })[0];
    if (!body) return { has: true, text: '', path: np, noBody: true };
    var lines = (body.match(/<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g) || []).map(function (p) { var o = ''; (p.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:br/g) || []).forEach(function (t) { o += t === '<a:br' ? '\n' : unescX(t.replace(/<[^>]+>/g, '')); }); return o; });
    return { has: true, text: lines.join('\n'), path: np };
  }
  async function setNotes(pkg, slidePath, text) {
    var cur = await slideNotes(pkg, slidePath), paras = String(text).split(/\r?\n/).map(function (ln) { return ln ? '<a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" dirty="0"/><a:t>' + escX(ln) + '</a:t></a:r></a:p>' : '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/></a:p>'; }).join('');
    if (cur.has && cur.noBody) return { err: '이 슬라이드의 노트 칸을 찾지 못해 폰에서는 고칠 수 없습니다.' };
    if (cur.has) {
      var nx = await must(pkg, cur.path);
      nx = nx.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, function (sp) {
        if (!/<p:ph\b[^>]*\stype="body"/.test(sp)) return sp;
        var head = /<p:txBody>\s*(<a:bodyPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:bodyPr>))\s*(<a:lstStyle\s*\/>|<a:lstStyle>[\s\S]*?<\/a:lstStyle>)?/.exec(sp);
        if (!head) return sp.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, '<p:txBody><a:bodyPr/><a:lstStyle/>' + paras + '</p:txBody>');
        return sp.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, '<p:txBody>' + head[1] + (head[2] || '<a:lstStyle/>') + paras + '</p:txBody>');
      });
      pkg.write(cur.path, nx); return { ok: true };
    }
    var master = pkg.list().filter(function (p) { return /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(p); })[0];
    if (!master) return { err: '이 문서에는 노트 틀이 없어서 폰에서는 새 노트를 만들 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var nn = nextNum(pkg, 'ppt/notesSlides/', 'notesSlide', 'xml'), npath = 'ppt/notesSlides/notesSlide' + nn + '.xml';
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes ' + NS + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' + paras + '</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
    pkg.write(npath, xml);
    var a1 = addRel(emptyRels(), R + 'notesMaster', relTarget(npath, master)); var a2 = addRel(a1.xml, R + 'slide', relTarget(npath, slidePath)); pkg.write(relsPathOf(npath), a2.xml);
    var rp = relsPathOf(slidePath), a3 = addRel(await pkg.read(rp) || emptyRels(), R + 'notesSlide', relTarget(slidePath, npath)); pkg.write(rp, a3.xml);
    pkg.write('[Content_Types].xml', ctAdd(await must(pkg, '[Content_Types].xml'), '/' + npath, T_NOTES));
    return { ok: true };
  }

  // ============================== 자리표시자 위치 물려받기(화면용) ==============================
  async function phResolver(pkg, slidePath) {
    var rl = parseRels(await pkg.read(relsPathOf(slidePath)) || ''), lr = rl.filter(function (r) { return relKind(r.type) === 'slideLayout'; })[0];
    var lay = lr ? resolvePath(slidePath, lr.target) : null, lx = lay ? await pkg.read(lay) : null, mx = null;
    if (lay) { var lrl = parseRels(await pkg.read(relsPathOf(lay)) || ''), mr = lrl.filter(function (r) { return relKind(r.type) === 'slideMaster'; })[0]; if (mr) mx = await pkg.read(resolvePath(lay, mr.target)); }
    function same(a, b) { return a === b || (a === 'ctrTitle' && b === 'title') || (a === 'title' && b === 'ctrTitle'); }
    function match(xml, ph) {
      if (!xml) return null;
      var idx = attrOf(ph, 'idx'), ty = attrOf(ph, 'type'), sps = topShapes(xml), pick = null;
      sps.forEach(function (s) {
        var p = /<p:ph\b[^>]*?\/?>/.exec(s.xml); if (!p) return;
        var i2 = attrOf(p[0], 'idx'), t2 = attrOf(p[0], 'type');
        if (idx != null && idx !== '0') { if (i2 === idx) pick = pick || s; }
        else if (ty && same(t2, ty) && (i2 == null || i2 === '0')) pick = pick || s;
      });
      if (!pick && ty) sps.forEach(function (s) { var p = /<p:ph\b[^>]*?\/?>/.exec(s.xml); if (p && same(attrOf(p[0], 'type'), ty)) pick = pick || s; });
      return pick;
    }
    return function (ph) {
      var ls = match(lx, ph), g = ls ? xfOf(ls.xml, ls.name) : null; if (g) return g;
      var ty = attrOf(ph, 'type') || (ls && attrOf(/<p:ph\b[^>]*?\/?>/.exec(ls.xml)[0], 'type')) || 'body';
      if (ty === 'subTitle' || ty === 'obj') ty = 'body';
      var ms = match(mx, '<p:ph type="' + ty + '"/>'); return ms ? xfOf(ms.xml, ms.name) : null;
    };
  }
  async function readSlide(pkg, slidePath) {
    var xml = await must(pkg, slidePath), res = await phResolver(pkg, slidePath);
    return { xml: xml, shapes: listShapes(xml, res) };
  }
  // 도형 움직이기·크기 바꾸기를 위해 위치가 물려받은 것이면 먼저 슬라이드에 명시
  function setGeomAuto(xml, id, g) { return setGeom(xml, id, g); }

  // ============================== 새 PPT 문서 ==============================
  function newPresentationFiles() {
    var A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', Rn = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    var H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', f = {};
    var RELNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    function rels(list) { return H + '<Relationships xmlns="' + RELNS + '">' + list.map(function (r, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + R + r[0] + '" Target="' + r[1] + '"/>'; }).join('') + '</Relationships>'; }
    f['[Content_Types].xml'] = H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      [1, 2, 3, 4].map(function (i) { return '<Override PartName="/ppt/slideLayouts/slideLayout' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'; }).join('') +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="' + T_SLIDE + '"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>' +
      '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>' +
      '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/></Types>';
    f['_rels/.rels'] = rels([['officeDocument', 'ppt/presentation.xml']]);
    f['ppt/presentation.xml'] = H + '<p:presentation ' + A + ' ' + Rn + ' ' + P + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '<p:defaultTextStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr>' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<a:lvl' + i + 'pPr marL="' + ((i - 1) * 457200) + '" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl' + i + 'pPr>'; }).join('') + '</p:defaultTextStyle></p:presentation>';
    f['ppt/_rels/presentation.xml.rels'] = rels([['slideMaster', 'slideMasters/slideMaster1.xml'], ['slide', 'slides/slide1.xml'], ['presProps', 'presProps.xml'], ['viewProps', 'viewProps.xml'], ['theme', 'theme/theme1.xml'], ['tableStyles', 'tableStyles.xml']]);
    f['ppt/presProps.xml'] = H + '<p:presentationPr ' + A + ' ' + Rn + ' ' + P + '/>';
    f['ppt/viewProps.xml'] = H + '<p:viewPr ' + A + ' ' + Rn + ' ' + P + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>';
    f['ppt/tableStyles.xml'] = H + '<a:tblStyleLst ' + A + ' def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';
    var clr = function (n, v) { return '<a:' + n + '><a:srgbClr val="' + v + '"/></a:' + n + '>'; };
    f['ppt/theme/theme1.xml'] = H + '<a:theme ' + A + ' name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' + clr('dk2', '44546A') + clr('lt2', 'E7E6E6') + clr('accent1', '4472C4') + clr('accent2', 'ED7D31') + clr('accent3', 'A5A5A5') + clr('accent4', 'FFC000') + clr('accent5', '5B9BD5') + clr('accent6', '70AD47') + clr('hlink', '0563C1') + clr('folHlink', '954F72') + '</a:clrScheme>' +
      '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="맑은 고딕"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="맑은 고딕"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
    function spTreeHead() { return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'; }
    function phSp(id, name, ph, geom, body) { return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr><p:spPr>' + (geom ? '<a:xfrm><a:off x="' + geom[0] + '" y="' + geom[1] + '"/><a:ext cx="' + geom[2] + '" cy="' + geom[3] + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' : '') + '</p:spPr>' + (body || '') + '</p:sp>'; }
    var lvl = function (sz, mar, ind, bu) { var s = ''; for (var i = 1; i <= 5; i++) s += '<a:lvl' + i + 'pPr marL="' + (mar * (i - 1)) + '" indent="' + (bu ? ind : 0) + '" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' + (bu ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : '<a:buNone/>') + '<a:defRPr sz="' + Math.max(1400, sz - (i - 1) * 400) + '" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl' + i + 'pPr>'; return s; };
    f['ppt/slideMasters/slideMaster1.xml'] = H + '<p:sldMaster ' + A + ' ' + Rn + ' ' + P + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + spTreeHead() +
      phSp(2, 'Title Placeholder 1', '<p:ph type="title"/>', [838200, 365125, 10515600, 1325563], '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목</a:t></a:r></a:p></p:txBody>') +
      phSp(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', [838200, 1825625, 10515600, 4351338], '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>내용</a:t></a:r></a:p></p:txBody>') +
      '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst>' + [1, 2, 3, 4].map(function (i) { return '<p:sldLayoutId id="' + (2147483648 + i) + '" r:id="rId' + i + '"/>'; }).join('') + '</p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle>' + lvl(2800, 457200, -228600, true) + '</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr>' + lvl(1800, 457200, 0, false) + '</p:otherStyle></p:txStyles></p:sldMaster>';
    f['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([['slideLayout', '../slideLayouts/slideLayout1.xml'], ['slideLayout', '../slideLayouts/slideLayout2.xml'], ['slideLayout', '../slideLayouts/slideLayout3.xml'], ['slideLayout', '../slideLayouts/slideLayout4.xml'], ['theme', '../theme/theme1.xml']]);
    var tpl = function (name, type, shapes) { return H + '<p:sldLayout ' + A + ' ' + Rn + ' ' + P + ' type="' + type + '" preserve="1"><p:cSld name="' + name + '"><p:spTree>' + spTreeHead() + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'; };
    var emptyTx = function (sz) { return '<p:txBody><a:bodyPr/><a:lstStyle>' + (sz ? '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="' + sz + '"/></a:lvl1pPr>' : '') + '</a:lstStyle><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>여기에 씁니다</a:t></a:r></a:p></p:txBody>'; };
    f['ppt/slideLayouts/slideLayout1.xml'] = tpl('제목 슬라이드', 'title', phSp(2, 'Title 1', '<p:ph type="ctrTitle"/>', [1524000, 1122363, 9144000, 2387600], '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 씁니다</a:t></a:r></a:p></p:txBody>') + phSp(3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', [1524000, 3602038, 9144000, 1655762], emptyTx(2400)));
    f['ppt/slideLayouts/slideLayout2.xml'] = tpl('제목 및 내용', 'obj', phSp(2, 'Title 1', '<p:ph type="title"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 씁니다</a:t></a:r></a:p></p:txBody>') + phSp(3, 'Content Placeholder 2', '<p:ph idx="1"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>내용을 씁니다</a:t></a:r></a:p></p:txBody>'));
    f['ppt/slideLayouts/slideLayout3.xml'] = tpl('제목만', 'titleOnly', phSp(2, 'Title 1', '<p:ph type="title"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 씁니다</a:t></a:r></a:p></p:txBody>'));
    f['ppt/slideLayouts/slideLayout4.xml'] = tpl('빈 화면', 'blank', '');
    [1, 2, 3, 4].forEach(function (i) { f['ppt/slideLayouts/_rels/slideLayout' + i + '.xml.rels'] = rels([['slideMaster', '../slideMasters/slideMaster1.xml']]); });
    f['ppt/slides/slide1.xml'] = newSlideXml([{ ph: '<p:ph type="ctrTitle"/>', name: 'Title' }, { ph: '<p:ph type="subTitle" idx="1"/>', name: 'Subtitle' }]);
    f['ppt/slides/_rels/slide1.xml.rels'] = rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]);
    return f;
  }

  // ============================== 쉬운 이름 · 글자 일부 서식 · 선 모양 · 복사·붙여넣기 · 표 칸 합치기 (v10.7) ==============================
  var PH_NAME = { title: '제목', ctrTitle: '제목', subTitle: '부제목', body: '본문', obj: '본문', pic: '그림 자리', dt: '날짜', ftr: '바닥글', sldNum: '쪽 번호', chart: '차트 자리', tbl: '표 자리', media: '동영상 자리', clipArt: '그림 자리', dgm: 'SmartArt 자리' };
  var KIND_NAME = { text: '글 상자', ph: '본문', shape: '도형', pic: '그림', table: '표', line: '선', group: '묶음 도형', chart: '차트', smart: 'SmartArt', ole: '삽입 개체', other: '개체' };
  function friendlyName(name, kind, phTag) {                   // 문서 안의 영어 기본 이름(Content Placeholder 2 …)을 쉬운 우리말로
    name = String(name || ''); var num = /(\d+)\s*$/.exec(name), n = num ? ' ' + num[1] : '';
    if (/[가-힣]/.test(name)) return name;
    if (phTag) { var ty = attrOf(phTag, 'type'); return (ty ? (PH_NAME[ty] || '본문') : '본문') + n; }
    var m = [[/^(?:ctr\s*)?title/i, '제목'], [/^sub\s*title/i, '부제목'], [/(?:content|text|object)\s*placeholder/i, '본문'], [/picture\s*placeholder/i, '그림 자리'], [/date\s*placeholder/i, '날짜'], [/footer\s*placeholder/i, '바닥글'], [/slide\s*number/i, '쪽 번호'],
      [/connector|line\b|arrow\s*line/i, '선'], [/text\s*box|textbox/i, '글 상자'], [/table/i, '표'], [/picture|image|photo|graphic/i, '그림'], [/group/i, '묶음 도형'], [/chart/i, '차트'], [/diagram|smart/i, 'SmartArt'], [/\bobject|\bole\b/i, '삽입 개체'],
      [/rectangle|oval|ellipse|triangle|diamond|arrow|star|shape|flowchart|callout|rounded|pentagon|hexagon|heart|cloud|rect\b/i, '도형']];
    for (var i = 0; i < m.length; i++) if (m[i][0].test(name)) return m[i][1] + n;
    return (KIND_NAME[kind] || '개체') + n;
  }
  function setNumAttr(at, name, v) { var re = new RegExp('(\\s' + name + '=")[^"]*(")'); if (re.test(at)) return at.replace(re, function (m, a, b) { return a + v + b; }); return /\/?>$/.test(at) ? at.replace(/\s*(\/?>)$/, ' ' + name + '="' + v + '"$1') : at + ' ' + name + '="' + v + '"'; }

  // ---- 글자 일부만 서식: ord 번째 문단의 [from,to) 글자(줄바꿈도 한 글자)에만 적용. 앞뒤 글자의 서식은 그대로 ----
  function formatRun(xml, ord, from, to, f) {
    var re = /<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g, m, i = 0, SE = global.SOPptxEdit;
    if (!SE || !SE._parse) throw new Error('글자 고치기 부품을 찾지 못했습니다');
    while ((m = re.exec(xml))) {
      if (i++ !== ord) continue;
      var pp = SE._parse(m[0]);
      if (!pp) throw new Error('이 문단은 일부 글자만 꾸밀 수 없습니다');
      if (pp.locked) throw new Error('자동 숫자·수식이 든 문단은 일부 글자만 꾸밀 수 없습니다(문단 전체는 「서식」에서 바꿉니다)');
      if (!(to > from)) throw new Error('먼저 꾸밀 글자를 고르십시오');
      var pos = 0, out = [];
      pp.items.forEach(function (it) {
        if (it.k === 'br') { out.push(it); pos += 1; return; }
        var a = pos, b = pos + it.text.length; pos = b;
        if (b <= from || a >= to || a === b) { out.push(it); return; }
        var s1 = Math.max(from, a) - a, e1 = Math.min(to, b) - a;
        if (s1 > 0) out.push({ k: 'r', pre: it.pre, text: it.text.slice(0, s1) });
        out.push({ k: 'r', pre: '<a:r>' + editRPr(it.pre.slice(5) || null, 'a:rPr', f), text: it.text.slice(s1, e1) });
        if (e1 < it.text.length) out.push({ k: 'r', pre: it.pre, text: it.text.slice(e1) });
      });
      var merged = []; out.forEach(function (x) { var pv = merged[merged.length - 1]; if (pv && pv.k === 'r' && x.k === 'r' && pv.pre === x.pre) pv.text += x.text; else merged.push({ k: x.k, pre: x.pre, text: x.text, raw: x.raw }); });
      var inner = merged.map(function (it) { return it.k === 'br' ? it.raw : it.pre + '<a:t>' + escX(it.text) + '</a:t></a:r>'; }).join('');
      return xml.slice(0, m.index) + pp.open + pp.prefix + inner + pp.suffix + pp.close + xml.slice(m.index + m[0].length);
    }
    throw new Error('문단을 찾지 못했습니다');
  }

  // ---- 테두리 굵기·모양: o = { w: pt, dash: 'solid'|'dash'|'sysDot'|'dashDot' } ----
  function setLineStyle(xml, id, o) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, r = spPrRange(x); if (!r) throw new Error('이 개체에는 테두리를 줄 수 없습니다');
    var sp = x.slice(r.s, r.e), wEmu = o.w != null ? Math.round(o.w * 12700) : null;
    if (/<a:ln\b/.test(sp)) {
      sp = sp.replace(/<a:ln\b([^>]*?)(\/>|>[\s\S]*?<\/a:ln>)/, function (mm, at, rest) {
        if (wEmu != null) at = setNumAttr(at, 'w', wEmu);
        var inner = rest === '/>' ? '' : rest.slice(1, rest.length - 7);
        if (/^\s*<a:noFill\/>/.test(inner) || !FILL_RE.test(inner)) inner = inner.replace(/^\s*<a:noFill\/>/, '') .replace(/^/, '<a:solidFill><a:srgbClr val="404040"/></a:solidFill>');
        if (o.dash) {
          inner = inner.replace(/<a:prstDash\b[^>]*\/>|<a:custDash>[\s\S]*?<\/a:custDash>/g, '');
          var d = '<a:prstDash val="' + o.dash + '"/>', fm = FILL_RE.exec(inner);
          inner = fm ? inner.slice(0, fm.index + fm[0].length) + d + inner.slice(fm.index + fm[0].length) : d + inner;
        }
        return '<a:ln' + at + '>' + inner + '</a:ln>';
      });
    } else {
      var lnx = '<a:ln w="' + (wEmu != null ? wEmu : 12700) + '"><a:solidFill><a:srgbClr val="404040"/></a:solidFill>' + (o.dash ? '<a:prstDash val="' + o.dash + '"/>' : '') + '</a:ln>';
      if (r.self) sp = sp.replace(/<p:spPr\s*\/>/, '<p:spPr>' + lnx + '</p:spPr>');
      else { var eff = /<a:(?:effectLst|effectDag|scene3d|sp3d|extLst)\b/.exec(sp); sp = eff ? sp.slice(0, eff.index) + lnx + sp.slice(eff.index) : sp.replace(/<\/p:spPr>$/, lnx + '</p:spPr>'); }
    }
    return xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e);
  }

  // ---- 복사·붙여넣기: 개체를 담아 두었다가(clip) 같은 장·다른 장에 붙인다. 그림·링크는 붙이는 장에 관계를 새로 만든다 ----
  async function copyShape(pkg, slidePath, id, geom) {
    var xml = await must(pkg, slidePath), sh = findShape(xml, id); if (!sh) throw new Error('개체를 찾지 못했습니다');
    var k = kindOf(sh);
    if (k === 'chart' || k === 'smart' || k === 'ole' || k === 'other') return { err: '이 개체(' + (KIND_NAME[k] || '개체') + ')는 폰에서 복사할 수 없습니다. 지우기·순서 바꾸기는 됩니다.' };
    var rels = parseRels(await pkg.read(relsPathOf(slidePath)) || ''), used = {}, list = [], m, rr = /\br:(?:embed|link|id)="([^"]+)"/g;
    while ((m = rr.exec(sh.xml))) used[m[1]] = 1;
    Object.keys(used).forEach(function (rid) {
      var rl = rels.filter(function (q) { return q.id === rid; })[0]; if (!rl) return;
      list.push({ id: rid, type: rl.type, external: rl.mode === 'External', target: rl.mode === 'External' ? rl.target : resolvePath(slidePath, rl.target) });
    });
    for (var i = 0; i < list.length; i++) if (!list[i].external && /\/(chart|diagram\w*|oleObject|package|video|audio|media|slide|notesSlide)$/.test(list[i].type)) return { err: '동영상·소리·삽입 개체나 다른 슬라이드로 가는 링크가 든 개체는 폰에서 복사할 수 없습니다.' };
    return { xml: sh.xml, kind: k, name: friendlyName(shapeName(sh.xml), k, (/<p:ph\b[^>]*?\/?>/.exec(sh.xml) || [''])[0]), rels: list, slide: slidePath, geom: geom || null };
  }
  async function pasteShape(pkg, slidePath, clip, off) {
    var xml = await must(pkg, slidePath), x = clip.xml, top = maxId(xml), n = 0, rp = relsPathOf(slidePath), rx = await pkg.read(rp) || emptyRels(), map = {};
    x = x.replace(/(<p:cNvPr\b[^>]*?\sid=")(\d+)(")/g, function (mm, a, v, b) { n++; return a + (top + n) + b; });
    var newId = top + 1;
    clip.rels.forEach(function (rl) {
      var ex = null, existing = parseRels(rx);
      existing.forEach(function (q) { if (q.type === rl.type && !ex) { var same = rl.external ? (q.mode === 'External' && q.target === rl.target) : (q.mode !== 'External' && resolvePath(slidePath, q.target) === rl.target); if (same) ex = q; } });
      if (ex) { map[rl.id] = ex.id; return; }
      var rid = nextRid(rx), tag = '<Relationship Id="' + rid + '" Type="' + rl.type + '" Target="' + escX(rl.external ? rl.target : relTarget(slidePath, rl.target)) + '"' + (rl.external ? ' TargetMode="External"' : '') + '/>';
      rx = rx.replace('</Relationships>', tag + '</Relationships>'); map[rl.id] = rid;
    });
    x = x.replace(/\b(r:(?:embed|link|id)=")([^"]+)(")/g, function (mm, a, v, b) { return map[v] ? a + map[v] + b : mm; });
    if (off && (off.dx || off.dy)) { x = x.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/, function (mm, ox, oy) { return '<a:off x="' + (+ox + off.dx) + '" y="' + (+oy + off.dy) + '"/>'; }); }
    pkg.write(rp, rx);
    var nx = insertShape(xml, x);
    if (!/<a:off\s/.test(x) && clip.geom) nx = setGeom(nx, newId, { x: Math.round(clip.geom.x + (off ? off.dx : 0)), y: Math.round(clip.geom.y + (off ? off.dy : 0)), w: Math.round(clip.geom.w), h: Math.round(clip.geom.h) });   // 위치를 배치에서 물려받는 개체(제목·본문 자리)는 위치를 적어 줘야 겹치지 않는다
    pkg.write(slidePath, nx);
    return { id: newId };
  }

  // ---- 표 칸 합치기·나누기 (r, c = 0부터, 합쳐져 덮인 칸도 한 칸으로 센다) ----
  function tableMerge(xml, id, op, r, c) {                     // op: right | down | splitH | splitV — 반환 {xml}|{err}
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, tm = /<a:tbl>[\s\S]*<\/a:tbl>/.exec(x); if (!tm) throw new Error('표가 아닙니다');
    var rowRe = /<a:tr\b[\s\S]*?<\/a:tr>/g, rows = [], mm;
    while ((mm = rowRe.exec(tm[0]))) rows.push({ s: mm.index, e: mm.index + mm[0].length, x: mm[0] });
    function cellsOf(row) { var out = [], q, cr = /<a:tc\b[\s\S]*?<\/a:tc>/g; while ((q = cr.exec(row.x))) out.push({ s: q.index, e: q.index + q[0].length, x: q[0] }); return out; }
    var grid = rows.map(cellsOf);
    if (!grid[r] || !grid[r][c]) return { err: '칸을 찾지 못했습니다.' };
    function open(t) { return /^<a:tc\b[^>]*>/.exec(t)[0]; }
    function plain(t) { return !/\s(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(open(t)); }
    function paras(t) { return t.match(/<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g) || []; }
    function withText(p) { return /<a:t(?:\s[^>]*)?>[^<]*\S[^<]*<\/a:t>/.test(p); }
    function moveText(a, b) {                                   // b 의 글을 a 로 옮기고 b 는 비운다 → [a', b']
      var pb = paras(b).filter(withText), na = a;
      if (pb.length) {
        var body = paras(a).filter(withText).concat(pb).join('');
        var first = /<a:txBody>(<a:bodyPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:bodyPr>)\s*(?:<a:lstStyle\s*\/>|<a:lstStyle>[\s\S]*?<\/a:lstStyle>)?)/.exec(a);
        na = a.replace(/<a:txBody>[\s\S]*<\/a:txBody>/, '<a:txBody>' + (first ? first[1] : '<a:bodyPr/><a:lstStyle/>') + body + '</a:txBody>');
      }
      return [na, blankCell(b)];
    }
    function setOpen(t, fn) { var o = open(t); return fn(o) + t.slice(o.length); }
    var edit = {}, a = grid[r][c].x;
    if (op === 'right' || op === 'down') {
      var br = op === 'right' ? r : r + 1, bc = op === 'right' ? c + 1 : c;
      if (!grid[br] || !grid[br][bc]) return { err: op === 'right' ? '오른쪽에 합칠 칸이 없습니다.' : '아래에 합칠 칸이 없습니다.' };
      var b = grid[br][bc].x;
      if (!plain(a) || !plain(b)) return { err: '이미 합쳐진 칸이 걸려 있어 폰에서는 더 합칠 수 없습니다. 먼저 「합치기 풀기」로 풀거나 「수정 요청」으로 맡겨 주십시오.' };
      var mt = moveText(a, b); a = mt[0]; b = mt[1];
      a = setOpen(a, function (o) { return op === 'right' ? setNumAttr(o, 'gridSpan', 2) : setNumAttr(o, 'rowSpan', 2); });
      b = setOpen(b, function (o) { return op === 'right' ? setNumAttr(o, 'hMerge', 1) : setNumAttr(o, 'vMerge', 1); });
      edit[r + ',' + c] = a; edit[br + ',' + bc] = b;
    } else {
      var o0 = open(a), gs = +(attrOf(o0, 'gridSpan') || 1), rs = +(attrOf(o0, 'rowSpan') || 1);
      if (/\s(?:hMerge|vMerge)="/.test(o0)) return { err: '합쳐진 칸의 왼쪽 위 칸을 골라 주십시오.' };
      if ((op === 'splitH' && gs < 2) || (op === 'splitV' && rs < 2)) return { err: op === 'splitH' ? '가로로 합쳐진 칸이 아닙니다.' : '세로로 합쳐진 칸이 아닙니다.' };
      var i, j;
      for (i = 0; i < (op === 'splitV' ? rs : 1); i++) for (j = 0; j < (op === 'splitH' ? gs : 1); j++) {
        if (!i && !j) continue; var rr2 = r + i, cc2 = c + j; if (!grid[rr2] || !grid[rr2][cc2]) continue;
        edit[rr2 + ',' + cc2] = setOpen(grid[rr2][cc2].x, function (o) { return o.replace(/\s(?:hMerge|vMerge)="[^"]*"/g, ''); });
      }
      edit[r + ',' + c] = setOpen(a, function (o) { return op === 'splitH' ? o.replace(/\sgridSpan="[^"]*"/, '') : o.replace(/\srowSpan="[^"]*"/, ''); });
    }
    var out = '', last = 0;
    rows.forEach(function (row, ri) {
      var rx = row.x, acc = '', lc = 0;
      grid[ri].forEach(function (cell, ci) { var k = ri + ',' + ci; if (edit[k] != null) { acc += rx.slice(lc, cell.s) + edit[k]; lc = cell.e; } });
      acc += rx.slice(lc); out += tm[0].slice(last, row.s) + acc; last = row.e;
    });
    out += tm[0].slice(last);
    return { xml: xml.slice(0, sh.s) + x.slice(0, tm.index) + out + x.slice(tm.index + tm[0].length) + xml.slice(sh.e) };
  }
  function cellSpans(xml, id) {                                  // 화면용: 표의 칸마다 합침 상태
    var sh = findShape(xml, id); if (!sh) return null;
    return (sh.xml.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || []).map(function (row) { return (row.match(/<a:tc\b[^>]*>/g) || []).map(function (o) { return { gs: +(attrOf(o, 'gridSpan') || 1), rs: +(attrOf(o, 'rowSpan') || 1), cov: /\s(?:hMerge|vMerge)="(?:1|true)"/.test(o) }; }); });
  }

  // ---- 글 세로 맞춤: anchor = 't' | 'ctr' | 'b' (도형 안 글, 표는 고른 칸 또는 표 전체) ----
  function setAnchor(xml, id, anchor, cell) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, nx;
    if (/<a:tbl>/.test(x)) {
      var s = 0, e = x.length;
      if (cell) { var cr = cellRange(x, cell.r, cell.c); if (!cr) throw new Error('칸을 찾지 못했습니다'); s = cr.s; e = cr.e; }
      var seg = x.slice(s, e).replace(/<a:tc\b[\s\S]*?<\/a:tc>/g, function (tc) {
        if (/<a:tcPr\b/.test(tc)) return tc.replace(/<a:tcPr\b([^>]*?)(\/?)>/, function (m, at, sl) { return '<a:tcPr' + setNumAttr(at, 'anchor', anchor) + sl + '>'; });
        return tc.replace(/<\/a:tc>$/, '<a:tcPr anchor="' + anchor + '"/></a:tc>');
      });
      nx = x.slice(0, s) + seg + x.slice(e);
    } else {
      if (!/<a:bodyPr\b/.test(x)) throw new Error('이 개체에는 글을 넣을 수 없습니다');
      nx = x.replace(/<a:bodyPr\b([^>]*?)(\/?)>/, function (m, at, sl) { return '<a:bodyPr' + setNumAttr(at, 'anchor', anchor) + sl + '>'; });
    }
    return xml.slice(0, sh.s) + nx + xml.slice(sh.e);
  }


  // ============================== v10.8: 슬라이드 배경색 · 도형 회전 · 배치 바꾸기 ==============================
  // 배경색(hex 'RRGGBB' | null = 배치의 배경으로 되돌림): 슬라이드 XML 맨 앞(<p:cSld> 첫 자식)에 <p:bg>
  function setSlideBg(xml, hex) {
    var m = /<p:cSld\b[^>]*?(\/?)>/.exec(xml); if (!m || m[1] === '/') throw new Error('슬라이드의 내용을 찾지 못했습니다');
    var x = xml.replace(/<p:bg\b[^>]*?(?:\/>|>[\s\S]*?<\/p:bg>)/, ''), at = m.index + m[0].length;
    if (!hex) return x;
    return x.slice(0, at) + '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' + x.slice(at);
  }
  function readSlideBg(xml) { var m = /<p:bg\b[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(xml); return m ? m[1] : null; }
  // 회전: deg = 절대 각도(0~359). 그림·도형·글 상자·선(위치가 직접 적힌 것)에만
  function setRotation(xml, id, deg) {
    var sh = findShape(xml, id); if (!sh) throw new Error('도형을 찾지 못했습니다');
    var x = sh.xml, r = spPrRange(x);
    if (sh.name === 'p:graphicFrame' || sh.name === 'p:grpSp') throw new Error('표·차트·묶음 도형은 폰에서 돌릴 수 없습니다.');
    if (!r) throw new Error('이 도형은 돌릴 수 없습니다');
    var sp = x.slice(r.s, r.e), xm = /<a:xfrm\b[^>]*>/.exec(sp);
    if (!xm) throw new Error('이 도형은 위치가 배치에서 이어받는 것이라 먼저 끌어서 한 번 옮긴 뒤 돌려 주십시오.');
    var v = ((Math.round(deg) % 360) + 360) % 360, open = xm[0].replace(/\srot="[^"]*"/, '');
    if (v) open = open.replace(/^<a:xfrm/, '<a:xfrm rot="' + v * 60000 + '"');
    sp = sp.replace(xm[0], open);
    return xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e);
  }
  function readRotation(xml, id) { var sh = findShape(xml, id); if (!sh) return 0; var m = /<a:xfrm\b[^>]*\srot="(-?\d+)"/.exec(sh.xml); return m ? ((Math.round(+m[1] / 60000) % 360) + 360) % 360 : 0; }
  // 배치 바꾸기: 슬라이드가 쓰는 배치(slideLayout)만 다른 것으로 바꾼다(슬라이드 안의 내용은 그대로)
  async function changeLayout(pkg, slidePath, layoutPath) {
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp); if (rx == null) return { err: '이 슬라이드의 연결 정보를 찾지 못했습니다.' };
    if (!pkg.list().some(function (p) { return p === layoutPath; })) return { err: '고른 배치를 찾지 못했습니다.' };
    var m = /<Relationship\b[^>]*\/slideLayout"[^>]*\/>/.exec(rx); if (!m) return { err: '이 슬라이드의 배치 연결을 찾지 못했습니다.' };
    var rel = m[0].replace(/Target="[^"]*"/, 'Target="../slideLayouts/' + layoutPath.replace(/^.*\//, '') + '"');
    pkg.write(rp, rx.replace(m[0], rel)); return { ok: true };
  }

  // ============================== v10.8 (3회차): 표 열 너비·줄 높이 · 묶기·풀기 · 그림 자르기 · 그림자·그러데이션 · 순서 한 칸 · 정렬·간격 · 쪽 번호·날짜·바닥글 · 슬라이드 크기 · 링크 · 화면 전환 ==============================
  var FIRST_OFFEXT = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/;
  // ---- 표 열 너비 · 줄 높이 ----
  function tblShape(xml, id) { var sh = findShape(xml, id); if (!sh || sh.name !== 'p:graphicFrame' || !/<a:tbl[\s>]/.test(sh.xml)) return null; return sh; }
  function tableGeom(xml, id) {
    var sh = tblShape(xml, id); if (!sh) return null;
    var cols = (sh.xml.match(/<a:gridCol\b[^>]*>/g) || []).map(function (g) { return +(attrOf(g, 'w') || 0); }), rows = (sh.xml.match(/<a:tr\b[^>]*>/g) || []).map(function (g) { return +(attrOf(g, 'h') || 0); });
    return { cols: cols, rows: rows, frame: xfOf(sh.xml, 'p:graphicFrame') };
  }
  function writeTable(xml, id, cols, rows) {
    var sh = tblShape(xml, id), x = sh.xml, ci = 0, ri = 0;
    if (cols) x = x.replace(/<a:gridCol\b([^>]*?)(\/?)>/g, function (m, at, sl) { var w = cols[ci++]; return '<a:gridCol' + (w == null ? at : setNumAttr(at, 'w', w)) + sl + '>'; });
    if (rows) x = x.replace(/<a:tr\b([^>]*?)>/g, function (m, at) { var h = rows[ri++]; return '<a:tr' + (h == null ? at : setNumAttr(at, 'h', h)) + '>'; });
    var out = xml.slice(0, sh.s) + x + xml.slice(sh.e), g = xfOf(x, 'p:graphicFrame');
    if (g) {
      var nw = cols ? cols.reduce(function (a, c) { return a + c; }, 0) : g.w, nh = rows ? rows.reduce(function (a, c) { return a + c; }, 0) : g.h;
      if (nw !== g.w || nh !== g.h) out = setGeom(out, id, { x: g.x, y: g.y, w: nw, h: nh });
    }
    return out;
  }
  // o = {col:0부터 번호, delta:EMU}(고른 열을 넓히거나 좁힘. 옆 열이 대신 줄어 표 전체 폭은 그대로) · {equal:true} · {fit:W}(표 폭을 W 로)
  function setTableCols(xml, id, o) {
    var g = tableGeom(xml, id); if (!g) return { err: '표를 찾지 못했습니다.' };
    var cols = g.cols.slice(), n = cols.length, MIN = 300000, tot = cols.reduce(function (a, c) { return a + c; }, 0), i;
    if (!n) return { err: '표의 열 정보를 읽지 못했습니다.' };
    if (o.equal) { var each = Math.floor(tot / n); for (i = 0; i < n; i++) cols[i] = each; cols[n - 1] += tot - each * n; }
    else if (o.fit) { var k = o.fit / tot, s = 0; for (i = 0; i < n; i++) { cols[i] = Math.round(cols[i] * k); s += cols[i]; } cols[n - 1] += o.fit - s; }
    else {
      if (n < 2) return { err: '열이 하나뿐인 표는 폭을 나눌 수 없습니다.' };
      var ci = Math.max(0, Math.min(n - 1, o.col || 0)), ni = ci + 1 < n ? ci + 1 : ci - 1, d = Math.round(o.delta || 0);
      if (cols[ci] + d < MIN) d = MIN - cols[ci]; if (cols[ni] - d < MIN) d = cols[ni] - MIN;
      if (!d) return { err: '더 이상 ' + (o.delta > 0 ? '넓힐' : '좁힐') + ' 수 없습니다(옆 열이 너무 좁아집니다).' };
      cols[ci] += d; cols[ni] -= d;
    }
    return { xml: writeTable(xml, id, cols, null) };
  }
  // o = {row:0부터, h:EMU(최소 높이)} · {all:true, h}
  function setTableRows(xml, id, o) {
    var g = tableGeom(xml, id); if (!g) return { err: '표를 찾지 못했습니다.' };
    var rows = g.rows.slice(), h = Math.max(91440, Math.round(o.h || 91440)), i;
    if (o.all) for (i = 0; i < rows.length; i++) rows[i] = h; else { var r = Math.max(0, Math.min(rows.length - 1, o.row || 0)); rows[r] = h; }
    return { xml: writeTable(xml, id, null, rows) };
  }

  // ---- 묶기 · 풀기 ----
  function groupable(sh) { return /^p:(sp|pic|cxnSp|grpSp)$/.test(sh.name) && !/<p:ph\b/.test(sh.xml) && !!xfOf(sh.xml, sh.name); }
  function groupShapes(xml, ids) {
    var uniq = {}, items = []; ids.forEach(function (i) { if (!uniq[i]) { uniq[i] = 1; var s = findShape(xml, i); if (s) items.push(s); } });
    if (items.length < 2) return { err: '묶으려면 도형을 두 개 이상 고르십시오.' };
    for (var k = 0; k < items.length; k++) if (!groupable(items[k])) return { err: '자리표시자(제목·본문 칸), 표, 차트 같은 개체는 묶을 수 없습니다. 도형·글 상자·그림·선만 묶을 수 있습니다.' };
    items.sort(function (a, b) { return a.s - b.s; });
    var x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
    items.forEach(function (it) { var g = xfOf(it.xml, it.name); x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h); });
    var gid = maxId(xml) + 1, w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    var gx = '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + gid + '" name="Group ' + gid + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="' + x0 + '" y="' + y0 + '"/><a:ext cx="' + w + '" cy="' + h + '"/><a:chOff x="' + x0 + '" y="' + y0 + '"/><a:chExt cx="' + w + '" cy="' + h + '"/></a:xfrm></p:grpSpPr>' + items.map(function (it) { return it.xml; }).join('') + '</p:grpSp>';
    var out = '', cur = 0;
    items.forEach(function (it, i) { out += xml.slice(cur, it.s); if (i === items.length - 1) out += gx; cur = it.e; });
    return { xml: out + xml.slice(cur), id: gid };
  }
  function ungroupShape(xml, id) {
    var sh = findShape(xml, id); if (!sh || sh.name !== 'p:grpSp') return { err: '묶인 도형을 먼저 고르십시오.' };
    var gp = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(sh.xml); if (!gp) return { err: '묶음의 위치 정보를 읽지 못했습니다.' };
    var xf = /<a:xfrm\b([^>]*)>\s*<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>\s*<a:chOff\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:chExt\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/.exec(gp[0]);
    if (!xf) return { err: '이 묶음은 위치 정보가 특수해 폰에서는 풀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    if (/\srot="|\sflipH="|\sflipV="/.test(xf[1])) return { err: '돌리거나 뒤집은 묶음은 폰에서 풀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var ox = +xf[2], oy = +xf[3], ex = +xf[4], ey = +xf[5], cx0 = +xf[6], cy0 = +xf[7], cex = +xf[8] || ex, cey = +xf[9] || ey, sx = ex / cex, sy = ey / cey;
    var from = sh.xml.indexOf('</p:grpSpPr>') + 12, to = sh.xml.lastIndexOf('</p:grpSp>'), kids = childrenOf(sh.xml, from, to).filter(function (c) { return /^p:(sp|pic|graphicFrame|grpSp|cxnSp)$|^mc:AlternateContent$/.test(c.name); });
    if (!kids.length) return { err: '묶음 안에 도형이 없습니다.' };
    var ids = [];
    var out = kids.map(function (c) {
      var kx = sh.xml.slice(c.s, c.e); ids.push(shapeId(kx));
      return kx.replace(FIRST_OFFEXT, function (m, x, y, cx, cy) { return '<a:off x="' + Math.round(ox + (+x - cx0) * sx) + '" y="' + Math.round(oy + (+y - cy0) * sy) + '"/><a:ext cx="' + Math.round(cx * sx) + '" cy="' + Math.round(cy * sy) + '"/>'; });
    }).join('');
    return { xml: xml.slice(0, sh.s) + out + xml.slice(sh.e), ids: ids };
  }

  // ---- 그림 자르기(비율 본보기): mode = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | 'orig'(원래 비율로) ----
  function cropPicture(xml, id, mode) {
    var sh = findShape(xml, id); if (!sh || sh.name !== 'p:pic') return { err: '그림을 먼저 고르십시오.' };
    var g = xfOf(sh.xml, 'p:pic'); if (!g) return { err: '이 그림의 크기를 읽지 못했습니다.' };
    var bf = /<p:blipFill\b[\s\S]*?<\/p:blipFill>/.exec(sh.xml); if (!bf) return { err: '이 그림의 그림 정보를 읽지 못했습니다.' };
    var sr = /<a:srcRect\b[^>]*\/>/.exec(bf[0]), l = 0, t = 0, r = 0, b = 0;
    if (sr) { l = +(attrOf(sr[0], 'l') || 0); t = +(attrOf(sr[0], 't') || 0); r = +(attrOf(sr[0], 'r') || 0); b = +(attrOf(sr[0], 'b') || 0); }
    var vw = 1 - (l + r) / 100000, vh = 1 - (t + b) / 100000; if (vw <= 0.02 || vh <= 0.02) return { err: '이 그림은 이미 많이 잘려 있어 더 자를 수 없습니다. 먼저 「원래 비율로」를 누르십시오.' };
    var nx = g.x, ny = g.y, nw = g.w, nh = g.h, nl = 0, nt = 0, nr = 0, nb = 0;
    if (mode === 'orig') { var af = (g.w / g.h) * (vh / vw); nh = Math.round(g.w / af); ny = Math.round(g.y + (g.h - nh) / 2); }
    else {
      var m = /^(\d+):(\d+)$/.exec(mode); if (!m) return { err: '알 수 없는 비율입니다.' };
      var A = +m[1] / +m[2], ac = g.w / g.h;
      if (A < ac) { nw = Math.round(g.h * A); nx = Math.round(g.x + (g.w - nw) / 2); } else { nh = Math.round(g.w / A); ny = Math.round(g.y + (g.h - nh) / 2); }
      var dvw = vw * (nw / g.w), dvh = vh * (nh / g.h), ex = (vw - dvw) / 2, ey = (vh - dvh) / 2;
      nl = Math.round(l + ex * 100000); nr = Math.round(r + ex * 100000); nt = Math.round(t + ey * 100000); nb = Math.round(b + ey * 100000);
    }
    var tag = (nl || nt || nr || nb) ? '<a:srcRect' + (nl ? ' l="' + nl + '"' : '') + (nt ? ' t="' + nt + '"' : '') + (nr ? ' r="' + nr + '"' : '') + (nb ? ' b="' + nb + '"' : '') + '/>' : '';
    var nbf = bf[0].replace(/<a:srcRect\b[^>]*\/>/, '');
    nbf = tag ? nbf.replace(/(<a:blip\b[^>]*?(?:\/>|>[\s\S]*?<\/a:blip>))/, '$1' + tag) : nbf;
    var x2 = sh.xml.replace(bf[0], nbf), out = xml.slice(0, sh.s) + x2 + xml.slice(sh.e);
    return { xml: setGeom(out, id, { x: nx, y: ny, w: nw, h: nh }) };
  }
  function readCrop(xml, id) { var sh = findShape(xml, id); if (!sh || sh.name !== 'p:pic') return null; return /<a:srcRect\b[^>]*\/>/.test(sh.xml); }

  // ---- 그림자 · 그러데이션 ----
  function effectInsertPos(sp) { var m = /<a:(?:effectDag|scene3d|sp3d|extLst)\b/.exec(sp); return m ? m.index : sp.lastIndexOf('</p:spPr>'); }
  function setShadow(xml, id, kind) {                          // kind = 'none' | 'soft' | 'hard'
    var sh = findShape(xml, id); if (!sh) return { err: '도형을 찾지 못했습니다.' };
    if (sh.name === 'p:graphicFrame' || sh.name === 'p:grpSp') return { err: '표·차트·묶음 도형에는 그림자를 줄 수 없습니다. 안의 도형에 주십시오.' };
    var x = sh.xml, r = spPrRange(x); if (!r) return { err: '이 도형에는 그림자를 줄 수 없습니다.' };
    var sp = x.slice(r.s, r.e); if (r.self) sp = sp.replace(/<p:spPr\s*\/>/, '<p:spPr></p:spPr>');
    sp = sp.replace(/<a:effectLst\b[\s\S]*?<\/a:effectLst>|<a:effectLst\s*\/>/, '');
    var eff = null;
    if (kind === 'soft') eff = '<a:effectLst><a:outerShdw blurRad="63500" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>';
    else if (kind === 'hard') eff = '<a:effectLst><a:outerShdw blurRad="0" dist="50800" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>';
    else if (/<a:effectRef\s+idx="[1-9]/.test(x)) eff = '<a:effectLst/>';               // 도형 스타일이 주는 그림자를 끈다
    if (eff) { var at = effectInsertPos(sp); sp = sp.slice(0, at) + eff + sp.slice(at); }
    if (!/<a:|\S/.test(sp.replace(/<\/?p:spPr>/g, ''))) sp = '<p:spPr/>';
    return { xml: xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e) };
  }
  function readShadow(xml, id) { var sh = findShape(xml, id); if (!sh) return null; var m = /<a:effectLst>[\s\S]*?<a:outerShdw\b([^>]*)>/.exec(sh.xml); return m ? (/blurRad="0"/.test(m[1]) ? 'hard' : 'soft') : null; }
  function setFillXml(xml, id, fill) {
    var sh = findShape(xml, id); if (!sh) return { err: '도형을 찾지 못했습니다.' };
    if (sh.name === 'p:graphicFrame' || sh.name === 'p:grpSp') return { err: '이 개체에는 색을 입힐 수 없습니다.' };
    var x = sh.xml, r = spPrRange(x); if (!r) return { err: '이 도형에는 색을 넣을 수 없습니다.' };
    var sp = x.slice(r.s, r.e);
    if (r.self) sp = sp.replace(/<p:spPr\s*\/>/, '<p:spPr>' + fill + '</p:spPr>');
    else {
      var open = /^<p:spPr\b[^>]*>/.exec(sp)[0], body = sp.slice(open.length, sp.length - 9), lnKeep = [];
      body = body.replace(/<a:ln\b[\s\S]*?<\/a:ln>|<a:ln\b[^>]*\/>/, function (m) { lnKeep.push(m); return '\u0001'; });
      if (FILL_RE.test(body)) body = body.replace(FILL_RE, fill);
      else { var geom = /<a:(?:prstGeom|custGeom)\b[\s\S]*?<\/a:(?:prstGeom|custGeom)>/.exec(body), xf = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(body), at = geom ? geom.index + geom[0].length : (xf ? xf.index + xf[0].length : 0); body = body.slice(0, at) + fill + body.slice(at); }
      sp = open + body.replace('\u0001', lnKeep[0] || '') + '</p:spPr>';
    }
    return { xml: xml.slice(0, sh.s) + x.slice(0, r.s) + sp + x.slice(r.e) + xml.slice(sh.e) };
  }
  // 두 색이 위→아래(ang 90)·왼→오른쪽(ang 0)·대각(ang 45)으로 이어지는 채우기
  function setGradient(xml, id, c1, c2, ang) {
    var g = '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="' + c1 + '"/></a:gs><a:gs pos="100000"><a:srgbClr val="' + c2 + '"/></a:gs></a:gsLst><a:lin ang="' + Math.round((ang || 0) * 60000) + '" scaled="0"/></a:gradFill>';
    return setFillXml(xml, id, g);
  }
  function readFillKind(xml, id) { var sh = findShape(xml, id); if (!sh) return null; var r = spPrRange(sh.xml); if (!r) return null; var sp = sh.xml.slice(r.s, r.e); return /<a:gradFill\b/.test(sp) ? 'grad' : (/<a:solidFill\b/.test(sp.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, '')) ? 'solid' : null); }

  // ---- 앞으로·뒤로 한 칸 ----
  function stepShape(xml, id, dir) {
    var tops = topShapes(xml), i = -1; tops.forEach(function (t, k) { if (shapeId(t.xml) === id) i = k; });
    if (i < 0) return { err: '도형을 찾지 못했습니다.' };
    var j = i + dir; if (j < 0 || j >= tops.length) return { err: dir > 0 ? '이미 맨 앞입니다.' : '이미 맨 뒤입니다.' };
    var A = tops[Math.min(i, j)], B = tops[Math.max(i, j)];
    return { xml: xml.slice(0, A.s) + B.xml + xml.slice(A.e, B.s) + A.xml + xml.slice(B.e) };
  }

  // ---- 정렬 · 간격 맞춤 (items = [{id, g:{x,y,w,h}}]) ----
  function alignShapes(xml, items, mode) {
    var its = items.filter(function (i) { return i.g; }); if (its.length < 2) return { err: '두 개 이상 골라 주십시오.' };
    var x0 = Math.min.apply(null, its.map(function (i) { return i.g.x; })), x1 = Math.max.apply(null, its.map(function (i) { return i.g.x + i.g.w; })), y0 = Math.min.apply(null, its.map(function (i) { return i.g.y; })), y1 = Math.max.apply(null, its.map(function (i) { return i.g.y + i.g.h; }));
    var out = xml;
    its.forEach(function (i) {
      var g = { x: i.g.x, y: i.g.y, w: i.g.w, h: i.g.h };
      if (mode === 'left') g.x = x0; else if (mode === 'right') g.x = x1 - g.w; else if (mode === 'hcenter') g.x = Math.round((x0 + x1) / 2 - g.w / 2);
      else if (mode === 'top') g.y = y0; else if (mode === 'bottom') g.y = y1 - g.h; else if (mode === 'vcenter') g.y = Math.round((y0 + y1) / 2 - g.h / 2);
      var ng = { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) };
      if (ng.x !== i.g.x || ng.y !== i.g.y || ng.w !== i.g.w || ng.h !== i.g.h) out = setGeom(out, i.id, ng);
    });
    return { xml: out };
  }
  function distributeShapes(xml, items, axis) {                // axis = 'h' | 'v' — 첫·끝 도형은 두고 사이 간격을 같게
    var its = items.filter(function (i) { return i.g; }); if (its.length < 3) return { err: '간격을 같게 하려면 세 개 이상 골라 주십시오.' };
    var key = axis === 'h' ? 'x' : 'y', len = axis === 'h' ? 'w' : 'h';
    its.sort(function (a, b) { return a.g[key] - b.g[key]; });
    var first = its[0].g[key], last = its[its.length - 1].g[key] + its[its.length - 1].g[len], sum = 0; its.forEach(function (i) { sum += i.g[len]; });
    var gap = (last - first - sum) / (its.length - 1), pos = first, out = xml;
    its.forEach(function (i) { var g = { x: i.g.x, y: i.g.y, w: i.g.w, h: i.g.h }; g[key] = Math.round(pos); pos += i.g[len] + gap; var ng = { x: g.x, y: g.y, w: Math.round(g.w), h: Math.round(g.h) }; if (ng.x !== i.g.x || ng.y !== i.g.y) out = setGeom(out, i.id, ng); });
    return { xml: out };
  }

  // ---- 슬라이드 번호 · 날짜 · 바닥글 ----
  var GUID_NUM = '{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}', GUID_DT = '{5A1E4B1D-6C0A-4E3B-9E55-7B2B8B1B8F10}';
  function footerContent(kind, spec) {
    var rp = '<a:rPr lang="ko-KR" altLang="en-US"/>';
    if (kind === 'sldNum') return '<a:fld id="' + GUID_NUM + '" type="slidenum">' + rp + '<a:t>‹#›</a:t></a:fld><a:endParaRPr lang="ko-KR" altLang="en-US"/>';
    if (kind === 'dt') return spec && spec.auto ? '<a:fld id="' + GUID_DT + '" type="datetime1">' + rp + '<a:t>' + escX(spec.text || '') + '</a:t></a:fld><a:endParaRPr lang="ko-KR" altLang="en-US"/>' : '<a:r>' + rp + '<a:t>' + escX((spec && spec.text) || '') + '</a:t></a:r><a:endParaRPr lang="ko-KR" altLang="en-US"/>';
    return '<a:r>' + rp + '<a:t>' + escX(spec || '') + '</a:t></a:r><a:endParaRPr lang="ko-KR" altLang="en-US"/>';
  }
  var FOOT_NAME = { sldNum: '슬라이드 번호 ', dt: '날짜 ', ftr: '바닥글 ' };
  // o = {num: true|false|undefined(그대로), date: false|{auto:bool,text}|undefined, footer: false|'글'|undefined, skipFirst: bool, only: 슬라이드 번호(0부터)|undefined(전체)}
  async function setFooters(pkg, o) {
    var d = await readDeck(pkg), done = 0, noLayout = 0;
    for (var si = 0; si < d.slides.length; si++) {
      if (o.only != null && o.only !== si) continue;
      var path = d.slides[si].path, xml = await must(pkg, path), rels = parseRels(await pkg.read(relsPathOf(path)) || ''), lr = rels.filter(function (r) { return relKind(r.type) === 'slideLayout'; })[0];
      var lx = lr ? await pkg.read(resolvePath(path, lr.target)) : null, kinds = [['sldNum', o.num === undefined ? undefined : (o.num ? true : false)], ['dt', o.date], ['ftr', o.footer]], changed = false;
      for (var ki = 0; ki < kinds.length; ki++) {
        var kind = kinds[ki][0], spec = kinds[ki][1]; if (spec === undefined) continue;
        var want = !!spec && !(si === 0 && o.skipFirst), tops = listShapesRaw(xml), ex = tops.filter(function (t) { var m = /<p:ph\b[^>]*?\/?>/.exec(t.xml); return m && attrOf(m[0], 'type') === kind; });
        if (!want) { ex.slice().sort(function (a, b) { return b.s - a.s; }).forEach(function (t) { xml = xml.slice(0, t.s) + xml.slice(t.e); changed = true; }); continue; }
        if (ex.length) {                                      // 이미 있으면 글만 바꾼다
          if (kind === 'sldNum') continue;
          var t0 = ex[0], nx = t0.xml.replace(/(<p:txBody>[\s\S]*?<a:lstStyle\s*\/?>(?:[\s\S]*?<\/a:lstStyle>)?)[\s\S]*?(<\/p:txBody>)/, function (m, a, b) { return a + '<a:p>' + footerContent(kind, spec) + '</a:p>' + b; });
          xml = xml.slice(0, t0.s) + nx + xml.slice(t0.e); changed = true; continue;
        }
        var lph = null; if (lx) { var re = /<p:sp>[\s\S]*?<\/p:sp>/g, mm; while ((mm = re.exec(lx))) { var ph = /<p:ph\b[^>]*?\/?>/.exec(mm[0]); if (ph && attrOf(ph[0], 'type') === kind) { lph = ph[0]; break; } } }
        if (!lph) { noLayout++; continue; }
        var nid = maxId(xml) + 1, sp = '<p:sp><p:nvSpPr><p:cNvPr id="' + nid + '" name="' + FOOT_NAME[kind] + nid + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + lph + '</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>' + footerContent(kind, spec) + '</a:p></p:txBody></p:sp>';
        xml = insertShape(xml, sp); changed = true;
      }
      if (changed) { pkg.write(path, xml); done++; }
    }
    return { ok: true, slides: done, noLayout: noLayout };
  }
  function listShapesRaw(xml) { return topShapes(xml).filter(function (t) { return t.name === 'p:sp'; }); }
  async function readFooters(pkg, idx) {
    var d = await readDeck(pkg), s = d.slides[idx]; if (!s) return {};
    var xml = await must(pkg, s.path), out = { num: false, date: false, footer: '' };
    listShapesRaw(xml).forEach(function (t) { var m = /<p:ph\b[^>]*?\/?>/.exec(t.xml); if (!m) return; var ty = attrOf(m[0], 'type'); if (ty === 'sldNum') out.num = true; else if (ty === 'dt') out.date = true; else if (ty === 'ftr') out.footer = unescX((t.xml.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || []).map(function (q) { return q.replace(/<[^>]+>/g, ''); }).join('')); });
    return out;
  }

  // ---- 슬라이드 크기(내용을 같은 비율로 줄이거나 늘리고 가운데에 놓는다) ----
  var SLIDE_SIZES = { wide: { cx: 12192000, cy: 6858000, name: '와이드 16:9', type: null }, std: { cx: 9144000, cy: 6858000, name: '표준 4:3', type: 'screen4x3' }, a4: { cx: 10692000, cy: 7560000, name: 'A4 가로', type: 'A4' } };
  function scaleTopXfrm(xml, s, ox, oy) {
    var tops = topShapes(xml).slice().sort(function (a, b) { return b.s - a.s; }), out = xml;
    tops.forEach(function (t) {
      var x = t.xml;
      if (t.name === 'mc:AlternateContent') return;
      x = x.replace(FIRST_OFFEXT, function (m, X, Y, CX, CY) { return '<a:off x="' + Math.round(+X * s + ox) + '" y="' + Math.round(+Y * s + oy) + '"/><a:ext cx="' + Math.round(CX * s) + '" cy="' + Math.round(CY * s) + '"/>'; });
      if (t.name === 'p:graphicFrame' && /<a:tbl[\s>]/.test(x)) { x = x.replace(/<a:gridCol\b([^>]*?)>/g, function (m, at) { var w = attrOf('<a:gridCol' + at + '>', 'w'); return '<a:gridCol' + (w ? setNumAttr(at, 'w', Math.round(+w * s)) : at) + '>'; }).replace(/<a:tr\b([^>]*?)>/g, function (m, at) { var h = attrOf('<a:tr' + at + '>', 'h'); return '<a:tr' + (h ? setNumAttr(at, 'h', Math.round(+h * s)) : at) + '>'; }); }
      out = out.slice(0, t.s) + x + out.slice(t.e);
    });
    return out;
  }
  function scaleFonts(xml, s) { return s === 1 ? xml : xml.replace(/(<a:(?:rPr|defRPr|endParaRPr|lvl\dpPr|pPr)\b[^>]*?\ssz=")(\d+)(")/g, function (m, a, v, b) { return a + Math.max(100, Math.round(+v * s / 100) * 100) + b; }); }
  async function setSlideSize(pkg, key) {
    var sz = SLIDE_SIZES[key]; if (!sz) return { err: '알 수 없는 크기입니다.' };
    var pres = await must(pkg, 'ppt/presentation.xml'), m = /<p:sldSz\b[^>]*?\/>/.exec(pres); if (!m) return { err: '슬라이드 크기 정보를 읽지 못했습니다.' };
    var W = +attrOf(m[0], 'cx'), H = +attrOf(m[0], 'cy'); if (W === sz.cx && H === sz.cy) return { err: '지금 이미 이 크기입니다.' };
    var s = Math.min(sz.cx / W, sz.cy / H), ox = (sz.cx - s * W) / 2, oy = (sz.cy - s * H) / 2, parts = pkg.list().filter(function (p) { return /^ppt\/(slides\/slide|slideLayouts\/slideLayout|slideMasters\/slideMaster)\d+\.xml$/.test(p); });
    for (var i = 0; i < parts.length; i++) { var x = await pkg.read(parts[i]); if (x == null) continue; x = scaleFonts(scaleTopXfrm(x, s, ox, oy), s); pkg.write(parts[i], x); }
    pkg.write('ppt/presentation.xml', pres.replace(m[0], '<p:sldSz cx="' + sz.cx + '" cy="' + sz.cy + '"' + (sz.type ? ' type="' + sz.type + '"' : '') + '/>'));
    return { ok: true, scale: Math.round(s * 100), from: [W, H], to: [sz.cx, sz.cy] };
  }
  async function readSlideSize(pkg) { var pres = await must(pkg, 'ppt/presentation.xml'), m = /<p:sldSz\b[^>]*?\/>/.exec(pres); if (!m) return null; var W = +attrOf(m[0], 'cx'), H = +attrOf(m[0], 'cy'), name = null; Object.keys(SLIDE_SIZES).forEach(function (k) { if (SLIDE_SIZES[k].cx === W && SLIDE_SIZES[k].cy === H) name = SLIDE_SIZES[k].name; }); return { W: W, H: H, name: name }; }

  // ---- 링크 ----
  var RT_HL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
  function cleanUrl(u) { u = String(u || '').trim(); if (!/^(https?:\/\/|mailto:|tel:)/i.test(u)) { if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) u = 'https://' + u; else return null; } return u; }
  function stripLinks(x) { return x.replace(/<a:hlinkClick\b[^>]*?(?:\/>|>[\s\S]*?<\/a:hlinkClick>)/g, ''); }
  function addHlinkToRPr(rpr, tag) {
    if (/\/>$/.test(rpr)) return rpr.replace(/\s*\/>$/, '>') + tag + '</a:rPr>';
    var at = /<a:(?:rtl|extLst)\b/.exec(rpr); return at ? rpr.slice(0, at.index) + tag + rpr.slice(at.index) : rpr.replace(/<\/a:rPr>$/, tag + '</a:rPr>');
  }
  // spec = {url} | {slide:0부터 번호} | {jump:'next'|'prev'|'first'|'last'} | {remove:true} ; mode = 'text'(도형 안 글 전체) | 'shape'(도형 자체를 누르면)
  async function setLink(pkg, slidePath, id, spec, mode) {
    var xml = await must(pkg, slidePath), sh = findShape(xml, id); if (!sh) return { err: '도형을 찾지 못했습니다.' };
    if (sh.name === 'p:graphicFrame' || sh.name === 'mc:AlternateContent') return { err: '표·차트는 폰에서 링크를 걸 수 없습니다. 도형이나 글 상자에 걸어 주십시오.' };
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp) || emptyRels(), tag = '', x = stripLinks(sh.xml);
    if (!spec.remove) {
      if (spec.url != null) {
        var u = cleanUrl(spec.url); if (!u) return { err: '주소는 https:// 로 시작하게 적어 주십시오.' };
        var ex = parseRels(rx).filter(function (q) { return q.type === RT_HL && q.mode === 'External' && q.target === u; })[0], rid;
        if (ex) rid = ex.id; else { rid = nextRid(rx); rx = rx.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT_HL + '" Target="' + escX(u) + '" TargetMode="External"/></Relationships>'); }
        tag = '<a:hlinkClick r:id="' + rid + '"/>';
      } else if (spec.slide != null) {
        var d = await readDeck(pkg), tg = d.slides[spec.slide]; if (!tg) return { err: '가려는 슬라이드를 찾지 못했습니다.' };
        var rel = relTarget(slidePath, tg.path), ex2 = parseRels(rx).filter(function (q) { return relKind(q.type) === 'slide' && q.target === rel; })[0], rid2;
        if (ex2) rid2 = ex2.id; else { rid2 = nextRid(rx); rx = rx.replace('</Relationships>', '<Relationship Id="' + rid2 + '" Type="' + R + 'slide" Target="' + escX(rel) + '"/></Relationships>'); }
        tag = '<a:hlinkClick r:id="' + rid2 + '" action="ppaction://hlinksldjump"/>';
      } else if (spec.jump) tag = '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=' + ({ next: 'nextslide', prev: 'previousslide', first: 'firstslide', last: 'lastslide' }[spec.jump] || 'nextslide') + '"/>';
      else return { err: '링크 내용이 없습니다.' };
      if (mode === 'shape') {
        var cm = /<p:cNvPr\b[^>]*?(\/?)>/.exec(x); if (!cm) return { err: '도형의 정보를 읽지 못했습니다.' };
        x = cm[1] === '/' ? x.replace(cm[0], cm[0].replace(/\s*\/>$/, '>') + tag + '</p:cNvPr>') : x.replace(cm[0], cm[0] + tag);
      } else {
        var n = 0;
        x = x.replace(/<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))?/g, function (m, rpr) { n++; return '<a:r>' + addHlinkToRPr(rpr || '<a:rPr lang="ko-KR" altLang="en-US"/>', tag); });
        if (!n) return { err: '이 도형에는 글이 없어 글에 링크를 걸 수 없습니다. 「도형 전체」에 걸거나 글을 먼저 넣어 주십시오.' };
      }
    }
    pkg.write(rp, rx); pkg.write(slidePath, xml.slice(0, sh.s) + x + xml.slice(sh.e)); return { ok: true };
  }
  async function readLink(pkg, slidePath, id) {
    var xml = await must(pkg, slidePath), sh = findShape(xml, id); if (!sh) return null;
    var m = /<a:hlinkClick\b[^>]*?\/?>/.exec(sh.xml); if (!m) return null;
    var rid = attrOf(m[0], 'r:id'), act = attrOf(m[0], 'action') || '', rels = parseRels(await pkg.read(relsPathOf(slidePath)) || ''), rl = rels.filter(function (q) { return q.id === rid; })[0];
    if (/hlinkshowjump/.test(act)) return { jump: /jump=(\w+)/.exec(act)[1] };
    if (/hlinksldjump/.test(act) && rl) { var d = await readDeck(pkg), tp = resolvePath(slidePath, rl.target), k = -1; d.slides.forEach(function (q, i) { if (q.path === tp) k = i; }); return { slide: k }; }
    return rl ? { url: rl.target } : null;
  }

  // ---- 화면 전환 ----
  var TR_KINDS = { fade: '<p:fade/>', push: '<p:push dir="{d}"/>', wipe: '<p:wipe dir="{d}"/>', cover: '<p:cover dir="{d}"/>', pull: '<p:pull dir="{d}"/>', split: '<p:split orient="horz" dir="out"/>', zoom: '<p:zoom dir="in"/>', randomBar: '<p:randomBar dir="horz"/>' };
  function setTransitionXml(xml, t) {
    var x = xml.replace(/<mc:AlternateContent\b[^>]*>(?:(?!<\/mc:AlternateContent>)[\s\S])*?<p:transition\b[\s\S]*?<\/mc:AlternateContent>/g, '').replace(/<p:transition\b[^>]*?(?:\/>|>[\s\S]*?<\/p:transition>)/g, '');
    var el = null;
    if (t && t.kind && t.kind !== 'none' && TR_KINDS[t.kind]) el = TR_KINDS[t.kind].replace('{d}', t.dir || 'l');
    var adv = t && t.advTm ? Math.round(t.advTm) : null;
    if (!el && !adv) return x;
    var tr = '<p:transition' + (t && t.spd ? ' spd="' + t.spd + '"' : '') + (t && t.advClick === false ? ' advClick="0"' : '') + (adv ? ' advTm="' + adv + '"' : '') + (el ? '>' + el + '</p:transition>' : '/>');
    var at = x.indexOf('</p:clrMapOvr>'); if (at >= 0) at += 14; else { at = x.indexOf('</p:cSld>'); if (at < 0) throw new Error('슬라이드 구조를 읽지 못했습니다'); at += 9; var cm = /^<p:clrMapOvr\b[^>]*?\/>/.exec(x.slice(at)); if (cm) at += cm[0].length; }
    return x.slice(0, at) + tr + x.slice(at);
  }
  function readTransitionXml(xml) {
    var x = xml.replace(/<mc:AlternateContent\b[^>]*>[\s\S]*?<\/mc:AlternateContent>/g, function (a) { var f = /<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/.exec(a); return /<p:transition\b/.test(a) ? (f ? f[1] : '') : a; });
    var m = /<p:transition\b([^>]*?)(\/?)>/.exec(x); if (!m) return { kind: 'none', spd: null, advTm: null };
    var inner = m[2] === '/' ? '' : x.slice(m.index + m[0].length, Math.max(m.index + m[0].length, x.indexOf('</p:transition>', m.index))), k = (/<p:(\w+)\b/.exec(inner) || [])[1], tag = '<x' + m[1] + '>';
    return { kind: TR_KINDS[k] ? k : (k ? 'other' : 'none'), spd: attrOf(tag, 'spd'), advTm: attrOf(tag, 'advTm') ? +attrOf(tag, 'advTm') : null };
  }
  // which = 슬라이드 번호(0부터) | 'all'
  async function setTransition(pkg, which, t) {
    var d = await readDeck(pkg), n = 0;
    for (var i = 0; i < d.slides.length; i++) { if (which !== 'all' && which !== i) continue; var x = await must(pkg, d.slides[i].path); pkg.write(d.slides[i].path, setTransitionXml(x, t)); n++; }
    return { ok: true, n: n };
  }

  global.SOPptxStruct = {
    tableGeom: tableGeom, setTableCols: setTableCols, setTableRows: setTableRows, groupShapes: groupShapes, ungroupShape: ungroupShape, cropPicture: cropPicture, readCrop: readCrop,
    setShadow: setShadow, readShadow: readShadow, setGradient: setGradient, readFillKind: readFillKind, stepShape: stepShape, alignShapes: alignShapes, distributeShapes: distributeShapes,
    setFooters: setFooters, readFooters: readFooters, SLIDE_SIZES: SLIDE_SIZES, setSlideSize: setSlideSize, readSlideSize: readSlideSize, setLink: setLink, readLink: readLink,
    setTransition: setTransition, readTransitionXml: readTransitionXml, setTransitionXml: setTransitionXml, groupable: groupable,
    readDeck: readDeck, listSlides: listSlides, listLayouts: listLayouts, addSlide: addSlide, duplicateSlide: duplicateSlide, deleteSlide: deleteSlide, moveSlide: moveSlide, hideSlide: hideSlide,
    readSlide: readSlide, listShapes: listShapes, removeShape: removeShape, setGeom: setGeom, clampGeom: clampGeom, addTextBox: addTextBox, addAutoShape: addAutoShape, addLine: addLine,
    addPicture: addPicture, addTable: addTable, setFill: setFill, setLineColor: setLineColor, formatText: formatText, readFormat: readFormat, addParagraph: addParagraph, removeParagraph: removeParagraph,
    tableEdit: tableEdit, reorderShape: reorderShape, paraRange: paraRange, slideNotes: slideNotes, setNotes: setNotes, newPresentationFiles: newPresentationFiles, SHAPES: SHAPES, EMU: EMU,
    setAnchor: setAnchor, friendlyName: friendlyName, formatRun: formatRun, setLineStyle: setLineStyle, copyShape: copyShape, pasteShape: pasteShape, tableMerge: tableMerge, cellSpans: cellSpans,
    setSlideBg: setSlideBg, readSlideBg: readSlideBg, setRotation: setRotation, readRotation: readRotation, changeLayout: changeLayout,
    _topShapes: topShapes, _dupBlock: dupBlock
  };
})(typeof window !== 'undefined' ? window : globalThis);
