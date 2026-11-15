/* so-pptx-media.js — S-Office 파워포인트 동영상·소리 넣기·지우기·표지 그림 바꾸기 (O-0861, v10.9 3회차)
 * ----------------------------------------------------------------------------
 * 파워포인트가 만드는 것과 같은 모양으로 넣는다: 슬라이드의 그림 개체(p:pic)에 a:videoFile/a:audioFile 링크 + p14:media(내장) + 표지 그림,
 * 슬라이드 관계 3개(링크 · 내장 · 표지), 클릭하면 재생/멈춤하는 순서(interactiveSeq) + 미디어 노드(p:video/p:audio).
 *   · 동영상: mp4 · m4v · mov — 소리: mp3 · m4a · wav
 *   · 지우기는 슬라이드의 개체·재생 순서·관계·미디어 파일(다른 곳이 쓰지 않을 때)·표지 그림까지 함께 정리한다.
 * 새 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var ST = global.SOPptxStruct; if (!ST || !ST._h || !ST._tm) return;
  var H = ST._h, escX = H.escX, must = H.must, parseRels = H.parseRels, relKind = H.relKind, relsPathOf = H.relsPathOf, resolvePath = H.resolvePath, relTarget = H.relTarget, findShape = H.findShape, maxId = H.maxId, insertShape = H.insertShape;
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var R_MS_MEDIA = 'http://schemas.microsoft.com/office/2007/relationships/media';
  var TYPES = {
    mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'],
    mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], wav: ['audio', 'audio/wav']
  };
  var MAX_BYTES = 150 * 1024 * 1024, WARN_BYTES = 25 * 1024 * 1024;

  function extOf(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function kindFromName(name) { var t = TYPES[extOf(name)]; return t ? t[0] : null; }

  // 슬라이드 개체 하나가 미디어면 연결 정보를 읽는다
  async function mediaParts(pkg, slidePath, id) {
    var x = await must(pkg, slidePath), sh = findShape(x, id); if (!sh || sh.name !== 'p:pic') return { err: '동영상·소리 개체가 아닙니다.' };
    var kind = /<a:videoFile\b/.test(sh.xml) ? 'video' : /<a:audioFile\b/.test(sh.xml) ? 'audio' : null; if (!kind) return { err: '동영상·소리 개체가 아닙니다.' };
    var link = (new RegExp('<a:' + kind + 'File\\b[^>]*?\\sr:link="([^"]+)"').exec(sh.xml) || [])[1], emb = (/<p14:media\b[^>]*?\sr:embed="([^"]+)"/.exec(sh.xml) || [])[1], blip = (/<a:blip\b[^>]*?\sr:embed="([^"]+)"/.exec(sh.xml) || [])[1];
    var rels = parseRels(await pkg.read(relsPathOf(slidePath)) || ''), get = function (rid) { return rid ? rels.filter(function (r) { return r.id === rid; })[0] : null; };
    var rl = get(link), re = get(emb), ri = get(blip);
    return { kind: kind, shape: sh, xml: x, rels: rels, link: rl, embed: re, poster: ri, mediaPath: (re || rl) && !((re || rl).mode === 'External') ? resolvePath(slidePath, (re || rl).target) : null, posterPath: ri ? resolvePath(slidePath, ri.target) : null };
  }

  // 슬라이드 개체 목록에서 쓰는 요약
  async function readMedia(pkg, slidePath, id) {
    var p = await mediaParts(pkg, slidePath, id); if (p.err) return p;
    var ext = extOf(p.mediaPath || ''), size = null;
    return { kind: p.kind, path: p.mediaPath, ext: ext, mime: (TYPES[ext] || [])[1] || (p.kind === 'video' ? 'video/mp4' : 'audio/mpeg'), external: !!(p.link && p.link.mode === 'External') && !p.embed };
  }
  async function readMediaBytes(pkg, path) { return pkg.readBin ? await pkg.readBin(path) : null; }

  var ID_BASE = 90001;
  function interactiveSeq(spid, kind) {
    var i = ID_BASE;
    return '<p:seq concurrent="1" nextAc="seek"><p:cTn id="' + (i++) + '" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl></p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst><p:par><p:cTn id="' + (i++) + '" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="' + (i++) + '" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="' + (i++) + '" presetID="2" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="togglePause"><p:cBhvr><p:cTn id="' + (i++) + '" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
      '<p:' + kind + '><p:cMediaNode vol="80000"><p:cTn id="' + (i++) + '" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl></p:cMediaNode></p:' + kind + '>';
  }
  function picXml(id, name, kind, g, ridLink, ridEmb, ridImg) {
    var tag = kind === 'video' ? 'videoFile' : 'audioFile';
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="' + escX(name) + '"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:' + tag + ' r:link="' + ridLink + '"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="' + ridEmb + '"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="' + ridImg + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + g.x + '" y="' + g.y + '"/><a:ext cx="' + g.w + '" cy="' + g.h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  }
  // o: { name(파일 이름), bytes(Uint8Array), poster(Uint8Array png), g({x,y,w,h} EMU) }
  async function addMedia(pkg, slidePath, o) {
    var ext = extOf(o.name), t = TYPES[ext]; if (!t) return { err: '이 형식(' + (ext || '알 수 없음') + ')은 넣을 수 없습니다. 동영상은 mp4·m4v·mov, 소리는 mp3·m4a·wav 입니다.' };
    if (!o.bytes || !o.bytes.length) return { err: '파일 내용이 비어 있습니다.' };
    if (o.bytes.length > MAX_BYTES) return { err: '파일이 너무 큽니다(' + Math.round(o.bytes.length / 1048576) + 'MB). 폰에서는 ' + Math.round(MAX_BYTES / 1048576) + 'MB까지 넣을 수 있습니다.' };
    var kind = t[0], mp = 'ppt/media/media' + H.nextNum(pkg, 'ppt/media/', 'media', ext) + '.' + ext, ip = 'ppt/media/image' + H.nextNum(pkg, 'ppt/media/', 'image', 'png') + '.png';
    pkg.writeBin(mp, o.bytes, { compression: 'STORE' }); pkg.writeBin(ip, o.poster);
    var ct = await must(pkg, '[Content_Types].xml'); ct = H.ctDefault(ct, ext, t[1]); ct = H.ctDefault(ct, 'png', 'image/png'); pkg.write('[Content_Types].xml', ct);
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp) || H.emptyRels();
    var a1 = H.addRel(rx, R + kind, relTarget(slidePath, mp)); rx = a1.xml; var a2 = H.addRel(rx, R_MS_MEDIA, relTarget(slidePath, mp)); rx = a2.xml; var a3 = H.addRel(rx, R + 'image', relTarget(slidePath, ip)); rx = a3.xml; pkg.write(rp, rx);
    var x = await must(pkg, slidePath), id = maxId(x) + 1, label = kind === 'video' ? '동영상' : '소리';
    x = insertShape(x, picXml(id, label + ' ' + (id - 1), kind, o.g, a1.id, a2.id, a3.id));
    x = ST._tm.addRootNodes(x, interactiveSeq(id, kind));
    pkg.write(slidePath, x);
    return { id: id, kind: kind };
  }
  function usedBy(pkg, targetPath, exceptRels) {          // 같은 파일을 가리키는 다른 관계가 있는지
    var list = pkg.list(), found = [];
    return Promise.all(list.filter(function (q) { return /\.rels$/.test(q) && q !== exceptRels; }).map(async function (q) {
      var t = await pkg.read(q); if (!t) return;
      parseRels(t).forEach(function (r) { if (r.mode !== 'External') { var base = q.replace('_rels/', '').replace(/\.rels$/, ''); if (resolvePath(base, r.target) === targetPath) found.push(q); } });
    })).then(function () { return found.length; });
  }
  async function dropRel(pkg, slidePath, rel, partToo) {
    if (!rel) return;
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp); if (rx) pkg.write(rp, rx.replace(rel.raw, ''));
    if (partToo && rel.mode !== 'External') {
      var path = resolvePath(slidePath, rel.target), still = await usedBy(pkg, path, null);
      var rx2 = await pkg.read(rp) || ''; var same = parseRels(rx2).some(function (r) { return r.mode !== 'External' && resolvePath(slidePath, r.target) === path; });
      if (!still && !same && (await pkg.read(path)) != null) pkg.remove(path);
      else if (!still && !same && pkg.readBin) { try { pkg.remove(path); } catch (e) {} }
    }
  }
  async function removeMedia(pkg, slidePath, id) {
    var p = await mediaParts(pkg, slidePath, id); if (p.err) return p;
    var nx = ST.removeShape(p.xml, id); pkg.write(slidePath, nx);
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp) || '';
    // 같은 슬라이드의 다른 개체가 같은 관계 번호를 쓰고 있으면 그대로 둔다
    var inUse = function (rid) { return rid && new RegExp('r:(?:link|embed)="' + rid + '"').test(nx); };
    [p.link, p.embed, p.poster].forEach(function (r) { if (r && !inUse(r.id)) rx = rx.replace(r.raw, ''); });
    pkg.write(rp, rx);
    for (var q of [p.link, p.embed, p.poster]) {
      if (!q || q.mode === 'External' || inUse(q.id)) continue;
      var path = resolvePath(slidePath, q.target), cur = await pkg.read(rp) || '';
      var same = parseRels(cur).some(function (r) { return r.mode !== 'External' && resolvePath(slidePath, r.target) === path; });
      if (same) continue;
      var others = await usedBy(pkg, path, rp); if (!others) { try { pkg.remove(path); } catch (e) {} }
    }
    return { ok: true };
  }
  // 표지 그림 바꾸기(png 바이트)
  async function setPoster(pkg, slidePath, id, png) {
    var p = await mediaParts(pkg, slidePath, id); if (p.err) return p;
    if (!p.poster) return { err: '표지 그림 연결을 찾지 못했습니다.' };
    var ip = 'ppt/media/image' + H.nextNum(pkg, 'ppt/media/', 'image', 'png') + '.png'; pkg.writeBin(ip, png);
    var ct = await must(pkg, '[Content_Types].xml'); pkg.write('[Content_Types].xml', H.ctDefault(ct, 'png', 'image/png'));
    var rp = relsPathOf(slidePath), rx = await pkg.read(rp), np = '<Relationship Id="' + p.poster.id + '" Type="' + p.poster.type + '" Target="' + escX(relTarget(slidePath, ip)) + '"/>';
    pkg.write(rp, rx.replace(p.poster.raw, np));
    var old = p.posterPath; var others = old ? await usedBy(pkg, old, rp) : 1;
    var nowRels = parseRels(await pkg.read(rp));
    var same = nowRels.some(function (r) { return r.mode !== 'External' && resolvePath(slidePath, r.target) === old; });
    if (old && !others && !same) { try { pkg.remove(old); } catch (e) {} }
    return { ok: true };
  }

  ST.MEDIA_TYPES = TYPES; ST.MEDIA_MAX = MAX_BYTES; ST.MEDIA_WARN = WARN_BYTES; ST.mediaKindOfName = kindFromName;
  ST.addMedia = addMedia; ST.removeMedia = removeMedia; ST.readMedia = readMedia; ST.setMediaPoster = setPoster;
})(typeof window !== 'undefined' ? window : globalThis);
