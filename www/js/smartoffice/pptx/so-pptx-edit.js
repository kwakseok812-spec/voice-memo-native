/* so-pptx-edit.js — S-Office 파워포인트 글자 고치기(문서 구조 처리 부분). 출처: 이 앱에서 직접 작성. 외부 코드 없음.
 * JSZip(MIT)으로 .pptx(zip)를 열어 슬라이드 XML 의 문단(<a:p>) 글자(<a:t>)만 문자열 단위로 바꾼다.
 * 나머지 파트(이미지·레이아웃·차트·노트·애니메이션)와, 같은 슬라이드 파일 안의 고치지 않은 부분은 글자 그대로 둔다.
 * window.SOPptxEdit = { load, build, verify, scanSlide, rebuildSlide } */
(function (global) {
  'use strict';
  var P_RE = /<a:p(?:\s[^>]*[^>\/])?>[\s\S]*?<\/a:p>/g;                       // 비어 있는 <a:p/> 는 잡지 않는다(글자 없음)
  var ITEM_RE = /<a:r>[\s\S]*?<\/a:r>|<a:br(?:\s[^>]*)?\/>|<a:br(?:\s[^>]*)?>[\s\S]*?<\/a:br>|<a:fld[\s\S]*?<\/a:fld>/g;

  function dec(s) {
    return s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function enc(s) {
    return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function plainOf(inner) {
    var out = [], re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br/g, m;
    while ((m = re.exec(inner))) out.push(m[1] != null ? dec(m[1]) : '\n');
    return out.join('');
  }

  // 문단 해석. locked:true = 자동 필드·수식 등이 들어 있어 안전하게 못 고침
  function parseParagraph(xml) {
    var m = /^(<a:p(?:\s[^>]*[^>\/])?>)([\s\S]*)(<\/a:p>)$/.exec(xml); if (!m) return null;
    var open = m[1], inner = m[2], close = m[3];
    if (/<a:fld[\s>]|<m:oMath|<a14:m[\s>]/.test(inner)) return { locked: true, text: plainOf(inner) };
    var items = [], first = -1, last = -1, mm;
    ITEM_RE.lastIndex = 0;
    while ((mm = ITEM_RE.exec(inner))) {
      var raw = mm[0];
      if (first < 0) first = mm.index;
      last = mm.index + raw.length;
      if (raw.slice(0, 5) === '<a:br') items.push({ k: 'br', raw: raw });
      else {
        var rp = /^<a:r>(<a:rPr(?:\s[^>]*)?\/>|<a:rPr(?:\s[^>]*)?>[\s\S]*?<\/a:rPr>)?/.exec(raw);
        var pre = '<a:r>' + (rp && rp[1] ? rp[1] : '');
        var ts = raw.slice(pre.length);
        var tm = /^<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t><\/a:r>$/.exec(ts);
        var tmEmpty = /^<a:t(?:\s[^>]*)?\/><\/a:r>$/.test(ts);
        if (!tm && !tmEmpty) return { locked: true, text: plainOf(inner) };
        items.push({ k: 'r', pre: pre, text: tm ? dec(tm[1]) : '' });
      }
    }
    var prefix, suffix;
    if (first < 0) {                                       // 글자 없는 문단
      var ep = inner.indexOf('<a:endParaRPr');
      var at = ep >= 0 ? ep : inner.length;
      prefix = inner.slice(0, at); suffix = inner.slice(at);
    } else {
      var between = inner.slice(first, last).replace(ITEM_RE, '');
      if (between.trim() !== '') return { locked: true, text: plainOf(inner) };
      prefix = inner.slice(0, first); suffix = inner.slice(last);
    }
    var text = items.map(function (it) { return it.k === 'br' ? '\n' : it.text; }).join('');
    return { locked: false, open: open, close: close, prefix: prefix, suffix: suffix, items: items, text: text };
  }

  function fallbackPre(suffix) {
    var m = /<a:endParaRPr((?:\s[^>]*)?)(\/>|>[\s\S]*?<\/a:endParaRPr>)/.exec(suffix);
    if (!m) return '<a:r>';
    var attrs = m[1] || '';
    if (m[2] === '/>') return '<a:r><a:rPr' + attrs + '/>';
    return '<a:r><a:rPr' + attrs + '>' + m[2].slice(1, m[2].length - '</a:endParaRPr>'.length) + '</a:rPr>';
  }
  function itemXml(it) {
    if (it.k === 'br') return it.raw;
    return it.pre + '<a:t>' + enc(it.text) + '</a:t></a:r>';
  }

  // 바뀐 구간만 고치고 앞뒤 서식 단위(굵게·색 등)는 그대로 둔다
  function applyText(pp, newText) {
    var oldText = pp.text;
    var p = 0, minLen = Math.min(oldText.length, newText.length);
    while (p < minLen && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
    var s = 0;
    while (s < minLen - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
    var q = oldText.length - s, mid = newText.slice(p, newText.length - s);
    var pos = 0, laid = pp.items.map(function (it) {
      var len = it.k === 'br' ? 1 : it.text.length, o = { it: it, a: pos, b: pos + len }; pos += len; return o;
    });
    // 서식 후보: p 바로 앞 글자의 런 → 없으면 p 자리의 런 → 첫 런 → 문단 끝 서식
    var tmpl = null, i;
    for (i = 0; i < laid.length; i++) if (laid[i].it.k === 'r' && laid[i].a < p && p <= laid[i].b) { tmpl = laid[i].it; break; }
    if (!tmpl) for (i = 0; i < laid.length; i++) if (laid[i].it.k === 'r' && laid[i].a <= p && p < laid[i].b) { tmpl = laid[i].it; break; }
    if (!tmpl) for (i = 0; i < laid.length; i++) if (laid[i].it.k === 'r') { tmpl = laid[i].it; break; }
    var tpre = tmpl ? tmpl.pre : fallbackPre(pp.suffix);
    function insItems() {
      var arr = [];
      if (!mid) return arr;
      mid.split('\n').forEach(function (ln, idx) {
        if (idx > 0) { var rp = tpre.slice(5); arr.push({ k: 'br', raw: rp ? '<a:br>' + rp + '</a:br>' : '<a:br/>' }); }
        if (ln) arr.push({ k: 'r', pre: tpre, text: ln, ins: true });
      });
      return arr;
    }
    var out = [], done = false;
    function doIns() { if (done) return; done = true; insItems().forEach(function (x) { out.push(x); }); }
    laid.forEach(function (L) {
      var it = L.it;
      if (L.a >= p && !done) doIns();
      if (it.k === 'br') { if (!(L.a >= p && L.b <= q)) out.push(it); return; }
      if (L.b <= p || L.a >= q) { out.push(it); return; }       // 바뀌는 구간 밖
      var left = it.text.slice(0, Math.max(0, p - L.a)), right = it.text.slice(Math.max(0, q - L.a));
      if (left) out.push({ k: 'r', pre: it.pre, text: left });
      if (L.a < p && p < L.b || (L.a < p && p === L.b)) doIns();
      if (L.a < p && !done) doIns();
      if (right) out.push({ k: 'r', pre: it.pre, text: right });
    });
    if (!done) doIns();
    // 새로 넣은 글자와 서식이 같은 이웃 런은 합친다
    var merged = [];
    out.forEach(function (x) {
      var prev = merged[merged.length - 1];
      if (prev && prev.k === 'r' && x.k === 'r' && prev.pre === x.pre && (prev.ins || x.ins)) { prev.text += x.text; prev.ins = true; }
      else merged.push(x);
    });
    merged = merged.filter(function (x) { return x.k === 'br' || x.text !== ''; });
    return pp.open + pp.prefix + merged.map(itemXml).join('') + pp.suffix + pp.close;
  }

  function ranges(xml, tag) {
    var out = [], stack = [], re = new RegExp('<(\\/?)' + tag + '(?=[\\s>\\/])[^>]*?(\\/?)>', 'g'), m;
    while ((m = re.exec(xml))) {
      if (m[2] === '/' && !m[1]) continue;
      if (!m[1]) stack.push(m.index);
      else if (stack.length) { var st = stack.pop(); if (!stack.length) out.push([st, m.index + m[0].length]); }
    }
    return out;
  }
  function inAny(rs, at) { for (var i = 0; i < rs.length; i++) if (at >= rs[i][0] && at < rs[i][1]) return true; return false; }

  // 슬라이드 XML 에서 고칠 수 있는 문단 목록
  function scanSlide(xml) {
    var tbl = ranges(xml, 'a:tbl'), grp = ranges(xml, 'p:grpSp'), fb = ranges(xml, 'mc:Fallback');
    var names = [], nre = /<p:cNvPr\s[^>]*?name="([^"]*)"/g, nm;
    while ((nm = nre.exec(xml))) names.push({ at: nm.index, name: dec(nm[1]) });
    var res = [], m, ord = 0;
    P_RE.lastIndex = 0;
    while ((m = P_RE.exec(xml))) {
      var at = m.index, o = ord++;
      if (inAny(fb, at)) continue;
      var pp = parseParagraph(m[0]); if (!pp) continue;
      if (!pp.text.replace(/\s/g, '')) continue;            // 빈 문단은 목록에 올리지 않는다
      var nmv = ''; for (var i = names.length - 1; i >= 0; i--) if (names[i].at < at) { nmv = names[i].name; break; }
      res.push({ ord: o, text: pp.text, locked: !!pp.locked, kind: inAny(tbl, at) ? '표' : (inAny(grp, at) ? '그룹 도형' : '글 상자'), shape: nmv });
    }
    return res;
  }

  // 고친 문단만 바꿔 새 XML 만들기. edits = { 문단번호: 새 글자 }
  function rebuildSlide(xml, edits) {
    var ord = 0;
    return xml.replace(P_RE, function (whole) {
      var o = ord++;
      if (!Object.prototype.hasOwnProperty.call(edits, o)) return whole;
      var pp = parseParagraph(whole);
      if (!pp || pp.locked) return whole;
      return applyText(pp, edits[o]);
    });
  }

  function countOf(xml, re) { var m = xml.match(re); return m ? m.length : 0; }

  // 파일 열기 → { zip, slides:[{path, xml, paras, charts, smart, pics}] } (슬라이드 순서대로)
  function load(buf, JSZip) {
    return JSZip.loadAsync(buf).then(function (zip) {
      var info = { zip: zip, JSZip: JSZip, slides: [] };
      return Promise.all([
        zip.file('ppt/presentation.xml') ? zip.file('ppt/presentation.xml').async('string') : Promise.resolve(''),
        zip.file('ppt/_rels/presentation.xml.rels') ? zip.file('ppt/_rels/presentation.xml.rels').async('string') : Promise.resolve('')
      ]).then(function (pr) {
        var paths = [], rels = {}, rm, rre = /<Relationship\s[^>]*>/g;
        while ((rm = rre.exec(pr[1]))) {
          var id = /\bId="([^"]*)"/.exec(rm[0]), tg = /\bTarget="([^"]*)"/.exec(rm[0]);
          if (id && tg) rels[id[1]] = tg[1];
        }
        var sre = /<p:sldId\s[^>]*?r:id="([^"]*)"/g, sm;
        while ((sm = sre.exec(pr[0]))) {
          var t = rels[sm[1]]; if (!t) continue;
          t = t.replace(/^\//, ''); if (t.indexOf('ppt/') !== 0) t = 'ppt/' + t.replace(/^\.\//, '');
          if (zip.file(t)) paths.push(t);
        }
        if (!paths.length) zip.file(/^ppt\/slides\/slide\d+\.xml$/).forEach(function (f) { paths.push(f.name); });
        if (!paths.length) throw new Error('슬라이드를 찾지 못함');
        return Promise.all(paths.map(function (p) { return zip.file(p).async('string'); })).then(function (xmls) {
          paths.forEach(function (p, i) {
            var x = xmls[i];
            info.slides.push({
              path: p, xml: x, paras: scanSlide(x),
              charts: countOf(x, /<c:chart[\s>]/g), smart: countOf(x, /<dgm:relIds/g), pics: countOf(x, /<p:pic[\s>]/g)
            });
          });
          return info;
        });
      });
    });
  }

  // 사본 만들기: edits = [ {문단번호:새 글자}, ... ] (슬라이드별). → { bytes:Uint8Array, changed:[경로] }
  function build(info, edits) {
    var zip = info.zip, changed = {};
    info.slides.forEach(function (s, i) {
      var e = edits[i]; if (!e || !Object.keys(e).length) return;
      var nx = rebuildSlide(s.xml, e);
      if (nx !== s.xml) changed[s.path] = nx;
    });
    var out = new info.JSZip();
    Object.keys(zip.files).forEach(function (n) {
      var f = zip.files[n];
      if (f.dir) { out.file(n, '', { dir: true, date: f.date, createFolders: false }); return; }
      if (Object.prototype.hasOwnProperty.call(changed, n)) out.file(n, changed[n], { date: f.date, createFolders: false });
      else out.file(n, f.async('uint8array'), { date: f.date, binary: true, createFolders: false });
    });
    return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then(function (u8) {
      return { bytes: u8, changed: Object.keys(changed) };
    });
  }

  // 검사: 고친 파트는 XML 이 올바른지, 나머지 파트는 원본과 같은지
  function verify(origBuf, newBytes, changedPaths, JSZip) {
    return Promise.all([JSZip.loadAsync(origBuf), JSZip.loadAsync(newBytes)]).then(function (z) {
      var a = z[0], b = z[1];
      var an = Object.keys(a.files).filter(function (n) { return !a.files[n].dir; });
      var bn = Object.keys(b.files).filter(function (n) { return !b.files[n].dir; });
      if (an.length !== bn.length || an.some(function (n) { return !b.file(n); })) return { ok: false, why: '파일 목록이 달라졌어요' };
      var set = {}; changedPaths.forEach(function (p) { set[p] = 1; });
      return Promise.all(an.map(function (n) {
        if (set[n]) return b.file(n).async('string').then(function (s) {
          var d = new DOMParser().parseFromString(s, 'application/xml');
          return d.getElementsByTagName('parsererror').length ? n + ' XML 오류' : null;
        });
        return Promise.all([a.file(n).async('uint8array'), b.file(n).async('uint8array')]).then(function (p) {
          if (p[0].length !== p[1].length) return n + ' 달라짐';
          for (var i = 0; i < p[0].length; i++) if (p[0][i] !== p[1][i]) return n + ' 달라짐';
          return null;
        });
      })).then(function (errs) {
        var bad = errs.filter(Boolean);
        return bad.length ? { ok: false, why: bad[0] } : { ok: true, untouched: an.length - changedPaths.length, changed: changedPaths.length };
      });
    });
  }

  global.SOPptxEdit = { load: load, build: build, verify: verify, scanSlide: scanSlide, rebuildSlide: rebuildSlide, _parse: parseParagraph, _apply: applyText };
})(window);
