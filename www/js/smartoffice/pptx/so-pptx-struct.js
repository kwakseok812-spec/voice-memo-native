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
  async function listLayouts(pkg) {
    var out = [];
    pkg.list().filter(function (p) { return /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(p); }).sort(function (a, b) { return +/(\d+)\.xml$/.exec(a)[1] - +/(\d+)\.xml$/.exec(b)[1]; }).forEach(function (p) { out.push({ path: p }); });
    for (var i = 0; i < out.length; i++) {
      var x = await pkg.read(out[i].path) || '', m = /<p:cSld\b[^>]*\sname="([^"]*)"/.exec(x);
      out[i].name = m ? unescX(m[1]) : ('배치 ' + (i + 1));
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
  // 복제를 막는 내용(차트·SmartArt·개체 삽입·동영상·소리)이 있으면 이유를 돌려준다
  function dupBlock(xml, rels) {
    if (/<c:chart[\s>]/.test(xml)) return '차트';
    if (/<dgm:relIds/.test(xml)) return 'SmartArt';
    if (/<p:oleObj[\s>]/.test(xml)) return '삽입된 개체(표·문서)';
    if (/<a:videoFile|<a:audioFile|<p14:media|<p:movie/.test(xml)) return '동영상·소리';
    for (var i = 0; i < rels.length; i++) { var k = relKind(rels[i].type); if (/^(chart|chartEx|diagramData|diagramLayout|diagramColors|diagramQuickStyle|oleObject|package|video|audio|media|vmlDrawing|tags)$/.test(k) && k !== 'tags') return k === 'vmlDrawing' ? '옛 형식 개체' : '차트·개체'; }
    return null;
  }
  async function duplicateSlide(pkg, idx) {
    var d = await readDeck(pkg), src = d.slides[idx]; if (!src) throw new Error('슬라이드를 찾지 못했습니다');
    var xml = await must(pkg, src.path), rels = await pkg.read(relsPathOf(src.path)) || emptyRels(), rl = parseRels(rels);
    var why = dupBlock(xml, rl); if (why) return { err: '이 슬라이드에는 ' + why + '이(가) 있어서 폰에서는 복제할 수 없습니다. 순서 바꾸기와 지우기는 할 수 있습니다.' };
    var num = nextNum(pkg, 'ppt/slides/', 'slide', 'xml'), path = 'ppt/slides/slide' + num + '.xml';
    var notesRel = rl.filter(function (r) { return relKind(r.type) === 'notesSlide'; })[0];
    var newRels = rels;
    if (notesRel) newRels = newRels.replace(notesRel.raw, '');                // 노트는 아래에서 새로 만들어 이어 붙인다
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
      return { id: shapeId(c.xml), name: shapeName(c.xml), kind: k, name_: c.name, g: g, inherited: inherited, text: text.trim(), isPh: !!ph, phTag: ph ? ph[0] : '', canMove: ed && !!g, canText: k === 'text' || k === 'ph' || k === 'shape' || k === 'table', canFill: k === 'text' || k === 'ph' || k === 'shape' };
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
      '<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' + para(text || '글을 입력하세요', ' sz="2000"') + '</p:txBody></p:sp>';
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
      if (f.bold != null || f.italic != null || f.underline != null || f.size != null || f.color) {
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
    return { bold: /\sb="1"/.test(rp), italic: /\si="1"/.test(rp), underline: /\su="(?!none)/.test(rp), size: szm ? +szm[1] / 100 : null, color: col ? col[1].toUpperCase() : null, align: pm && /\salgn="(\w+)"/.exec(pm[1]) ? /\salgn="(\w+)"/.exec(pm[1])[1] : null, bullet: /<a:buChar\b/.test(x) };
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
    if (/\s(?:gridSpan|rowSpan|hMerge|vMerge)="/.test(tbl[0])) return { err: '이 표에는 합쳐진 칸이 있어서 폰에서는 줄·칸을 바꾸기 어렵습니다. 「수정 요청」으로 맡겨 주십시오.' };
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
    var emptyTx = function (sz) { return '<p:txBody><a:bodyPr/><a:lstStyle>' + (sz ? '<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="' + sz + '"/></a:lvl1pPr>' : '') + '</a:lstStyle><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>클릭하여 입력</a:t></a:r></a:p></p:txBody>'; };
    f['ppt/slideLayouts/slideLayout1.xml'] = tpl('제목 슬라이드', 'title', phSp(2, 'Title 1', '<p:ph type="ctrTitle"/>', [1524000, 1122363, 9144000, 2387600], '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 입력하세요</a:t></a:r></a:p></p:txBody>') + phSp(3, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', [1524000, 3602038, 9144000, 1655762], emptyTx(2400)));
    f['ppt/slideLayouts/slideLayout2.xml'] = tpl('제목 및 내용', 'obj', phSp(2, 'Title 1', '<p:ph type="title"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 입력하세요</a:t></a:r></a:p></p:txBody>') + phSp(3, 'Content Placeholder 2', '<p:ph idx="1"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>내용을 입력하세요</a:t></a:r></a:p></p:txBody>'));
    f['ppt/slideLayouts/slideLayout3.xml'] = tpl('제목만', 'titleOnly', phSp(2, 'Title 1', '<p:ph type="title"/>', null, '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>제목을 입력하세요</a:t></a:r></a:p></p:txBody>'));
    f['ppt/slideLayouts/slideLayout4.xml'] = tpl('빈 화면', 'blank', '');
    [1, 2, 3, 4].forEach(function (i) { f['ppt/slideLayouts/_rels/slideLayout' + i + '.xml.rels'] = rels([['slideMaster', '../slideMasters/slideMaster1.xml']]); });
    f['ppt/slides/slide1.xml'] = newSlideXml([{ ph: '<p:ph type="ctrTitle"/>', name: 'Title' }, { ph: '<p:ph type="subTitle" idx="1"/>', name: 'Subtitle' }]);
    f['ppt/slides/_rels/slide1.xml.rels'] = rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]);
    return f;
  }

  global.SOPptxStruct = {
    readDeck: readDeck, listSlides: listSlides, listLayouts: listLayouts, addSlide: addSlide, duplicateSlide: duplicateSlide, deleteSlide: deleteSlide, moveSlide: moveSlide, hideSlide: hideSlide,
    readSlide: readSlide, listShapes: listShapes, removeShape: removeShape, setGeom: setGeom, clampGeom: clampGeom, addTextBox: addTextBox, addAutoShape: addAutoShape, addLine: addLine,
    addPicture: addPicture, addTable: addTable, setFill: setFill, setLineColor: setLineColor, formatText: formatText, readFormat: readFormat, addParagraph: addParagraph, removeParagraph: removeParagraph,
    tableEdit: tableEdit, reorderShape: reorderShape, paraRange: paraRange, slideNotes: slideNotes, setNotes: setNotes, newPresentationFiles: newPresentationFiles, SHAPES: SHAPES, EMU: EMU,
    _topShapes: topShapes, _dupBlock: dupBlock
  };
})(typeof window !== 'undefined' ? window : globalThis);
