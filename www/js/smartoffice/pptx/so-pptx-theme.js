/* so-pptx-theme.js — S-Office 파워포인트 디자인(테마) 고치기 (O-0861, v10.9 3회차)
 * ----------------------------------------------------------------------------
 *   · 색 조합 바꾸기 / 글꼴 조합 바꾸기 — 슬라이드 마스터가 쓰는 테마 파일(ppt/theme/themeN.xml)의 색 조합(clrScheme)·글꼴 조합(fontScheme)만 갈아 끼운다.
 *     (도형에 색을 직접 지정한 것은 테마를 따르지 않으므로 그대로 남는다.)
 *   · 마스터 보기(간단): 슬라이드 마스터의 배경색·제목 글꼴/크기/굵기/색·본문 글꼴/크기/색, 배치(레이아웃)별 배경색
 *   · 다른 파워포인트 파일의 색·글꼴 조합 가져오기(그 파일의 테마 XML 에서 조합만 복사)
 * 새 외부 부품 없음. pkg = so-pptx-struct.js 와 같은 모양.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var ST = global.SOPptxStruct; if (!ST || !ST._h) return;
  var H = ST._h, escX = H.escX, must = H.must, parseRels = H.parseRels, relKind = H.relKind, resolvePath = H.resolvePath, relsPathOf = H.relsPathOf, childrenOf = H.childrenOf;

  // ---- 내장 색 조합 10가지 (dk2·lt2·강조 6·링크·방문한 링크). 글자 기본색(dk1)·바탕색(lt1)은 검정·흰색으로 둔다 ----
  var COLOR_SETS = [
    { key: 'base',  name: '기본 파랑·주황', c: ['44546A', 'E7E6E6', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'] },
    { key: 'sea',   name: '바다 파랑', c: ['1F3A5F', 'E6EEF5', '1F6FB2', '2BA3C4', '6CC5C0', '2E4B8F', '8DB6DE', '3A8F85', '0563C1', '6B4E9B'] },
    { key: 'forest', name: '숲 초록', c: ['2D4A2B', 'EAF0E4', '3B7D3A', '8DB546', 'C9A227', '6B8E23', '2F5F4F', 'A47148', '2E7D32', '7B5E3B'] },
    { key: 'sunset', name: '노을 주황·빨강', c: ['5B2A2A', 'F7ECE4', 'D9534F', 'F0883E', 'F2C14E', 'B03A48', '8E4A6B', 'E07B91', 'C0392B', '8E4A6B'] },
    { key: 'violet', name: '보라', c: ['3B2A5B', 'EEE9F5', '6C4BB5', 'A06CD5', 'D16BA5', '4B3A9B', '8E7CC3', 'C084D6', '5B3FA6', '8E4A8E'] },
    { key: 'gray',  name: '흑백(회색)', c: ['333333', 'EDEDED', '404040', '7F7F7F', 'A6A6A6', '595959', 'BFBFBF', '262626', '1F4E79', '7F7F7F'] },
    { key: 'pastel', name: '연한 파스텔', c: ['5E6B7A', 'F4F6F8', '7FB2E5', 'F4A6A6', 'A8D5A2', 'F5D77F', 'C3A6E0', '9AD0D6', '4A86C5', '9B7FC0'] },
    { key: 'univ',  name: '남색과 금색', c: ['1B2A4A', 'EEF1F6', '1F3C88', 'C8A951', '3E6FB0', '8A9BB8', 'A33B3B', '4F7F6F', '1F3C88', '6B4E71'] },
    { key: 'brown', name: '따뜻한 갈색', c: ['4A3626', 'F3ECE3', '8B5E3C', 'C98B4A', 'D8B77A', '6E4B35', 'A8744F', 'B9A27A', '7B4B2A', '6E5A44'] },
    { key: 'vivid', name: '선명한 색', c: ['222222', 'F2F2F2', '0057B8', 'E4002B', 'FFB000', '00875A', '6A00A8', '00A3E0', '0057B8', '6A00A8'] }
  ];
  // ---- 내장 글꼴 조합 8가지 (제목·본문 각각 영문 글꼴·한글 글꼴) ----
  var FONT_SETS = [
    { key: 'malgun', name: '맑은 고딕(모두)', major: ['Malgun Gothic', '맑은 고딕'], minor: ['Malgun Gothic', '맑은 고딕'] },
    { key: 'batmal', name: '제목 바탕 · 본문 맑은 고딕', major: ['Batang', '바탕'], minor: ['Malgun Gothic', '맑은 고딕'] },
    { key: 'batang', name: '바탕체(모두, 문서 느낌)', major: ['Batang', '바탕'], minor: ['Batang', '바탕'] },
    { key: 'dotum',  name: '돋움(모두)', major: ['Dotum', '돋움'], minor: ['Dotum', '돋움'] },
    { key: 'gulim',  name: '굴림(모두)', major: ['Gulim', '굴림'], minor: ['Gulim', '굴림'] },
    { key: 'arial',  name: '영문 Arial · 한글 맑은 고딕', major: ['Arial', '맑은 고딕'], minor: ['Arial', '맑은 고딕'] },
    { key: 'times',  name: '영문 Times · 한글 바탕', major: ['Times New Roman', '바탕'], minor: ['Times New Roman', '바탕'] },
    { key: 'calibri', name: '영문 Calibri · 한글 맑은 고딕', major: ['Calibri', '맑은 고딕'], minor: ['Calibri', '맑은 고딕'] }
  ];

  var C_TAGS = ['dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  function clrXml(set) {
    var x = '<a:clrScheme name="' + escX(set.name) + '"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>';
    C_TAGS.forEach(function (t, i) { x += '<a:' + t + '><a:srgbClr val="' + set.c[i] + '"/></a:' + t + '>'; });
    return x + '</a:clrScheme>';
  }

  // ---- 테마 부품 찾기: 슬라이드 마스터가 가리키는 테마(노트·유인물 마스터의 것은 건드리지 않는다) ----
  async function themeParts(pkg) {
    var rels = parseRels(await must(pkg, 'ppt/_rels/presentation.xml.rels')), out = [], masters = [];
    rels.forEach(function (r) { if (relKind(r.type) === 'slideMaster') masters.push(resolvePath('ppt/presentation.xml', r.target)); });
    for (var i = 0; i < masters.length; i++) {
      var mr = parseRels(await pkg.read(relsPathOf(masters[i])) || '');
      mr.forEach(function (r) { if (relKind(r.type) === 'theme') { var p = resolvePath(masters[i], r.target); if (out.indexOf(p) < 0) out.push(p); } });
    }
    return { themes: out, masters: masters };
  }
  function cut(xml, tag) { var m = new RegExp('<a:' + tag + '\\b[\\s\\S]*?</a:' + tag + '>').exec(xml); return m ? m[0] : null; }
  function nameOf(frag) { var m = /^<a:\w+\s[^>]*?\bname="([^"]*)"/.exec(frag || ''); return m ? H.unescX(m[1]) : ''; }
  function colorsOf(frag) {
    var o = {}; ['dk1', 'lt1'].concat(C_TAGS).forEach(function (t) { var m = new RegExp('<a:' + t + '>([\\s\\S]*?)</a:' + t + '>').exec(frag || ''); if (m) { var v = /(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"/.exec(m[1]); o[t] = v ? v[1].toUpperCase() : null; } });
    return o;
  }
  function fontsOf(frag) {
    function one(t) { var m = new RegExp('<a:' + t + '>([\\s\\S]*?)</a:' + t + '>').exec(frag || ''); if (!m) return ['', '']; var la = /<a:latin\b[^>]*?\stypeface="([^"]*)"/.exec(m[1]), ea = /<a:ea\b[^>]*?\stypeface="([^"]*)"/.exec(m[1]), hg = /<a:font\b[^>]*?\sscript="Hang"[^>]*?\stypeface="([^"]*)"/.exec(m[1]); return [la ? H.unescX(la[1]) : '', (ea && ea[1]) ? H.unescX(ea[1]) : (hg ? H.unescX(hg[1]) : '')]; }
    return { major: one('majorFont'), minor: one('minorFont') };
  }
  // 지금 문서의 테마 상태(첫 마스터의 테마 기준)
  async function readTheme(pkg) {
    var tp = await themeParts(pkg); if (!tp.themes.length) return { err: '이 문서에서 테마를 찾지 못했습니다.' };
    var x = await must(pkg, tp.themes[0]), cs = cut(x, 'clrScheme'), fs = cut(x, 'fontScheme');
    var cn = nameOf(cs), set = null; COLOR_SETS.forEach(function (c) { if (c.name === cn) set = c.key; });
    var fo = fontsOf(fs), fset = null; FONT_SETS.forEach(function (f) { if (f.major[1] === fo.major[1] && f.minor[1] === fo.minor[1] && f.major[0] === fo.major[0] && f.minor[0] === fo.minor[0]) fset = f.key; });
    return { count: tp.themes.length, colors: colorsOf(cs), colorName: cn, colorKey: set, fonts: fo, fontName: nameOf(fs), fontKey: fset };
  }
  async function setColors(pkg, key) {
    var set = typeof key === 'string' ? COLOR_SETS.filter(function (c) { return c.key === key; })[0] : key;
    if (!set) return { err: '모르는 색 조합입니다.' };
    var tp = await themeParts(pkg); if (!tp.themes.length) return { err: '이 문서에서 테마를 찾지 못했습니다.' };
    var n = 0;
    for (var i = 0; i < tp.themes.length; i++) {
      var x = await must(pkg, tp.themes[i]), old = cut(x, 'clrScheme'); if (!old) continue;
      pkg.write(tp.themes[i], x.replace(old, function () { return set.raw || clrXml(set); })); n++;
    }
    return n ? { ok: true, n: n } : { err: '이 문서의 테마에는 색 조합이 없습니다.' };
  }
  function fontPart(tag, pair) {                           // 기존 글꼴 묶음(majorFont/minorFont)의 영문·한글만 바꾼다
    return function (frag) {
      var out = frag.replace(/<a:latin\b[^>]*?\/>/, '<a:latin typeface="' + escX(pair[0]) + '"/>');
      if (/<a:ea\b[^>]*?\/>/.test(out)) out = out.replace(/<a:ea\b[^>]*?\/>/, '<a:ea typeface=""/>');
      out = out.replace(/(<a:font\b[^>]*?\sscript="Hang"[^>]*?\stypeface=")[^"]*(")/, function (m, a, b) { return a + escX(pair[1]) + b; });
      if (!/<a:font\b[^>]*?\sscript="Hang"/.test(out)) out = out.replace(/<a:ea\b[^>]*?\/>/, '<a:ea typeface="' + escX(pair[1]) + '"/>');
      return out;
    };
  }
  async function setFonts(pkg, key) {
    var set = typeof key === 'string' ? FONT_SETS.filter(function (f) { return f.key === key; })[0] : key;
    if (!set) return { err: '모르는 글꼴 조합입니다.' };
    var tp = await themeParts(pkg); if (!tp.themes.length) return { err: '이 문서에서 테마를 찾지 못했습니다.' };
    var n = 0;
    for (var i = 0; i < tp.themes.length; i++) {
      var x = await must(pkg, tp.themes[i]), fs = cut(x, 'fontScheme'); if (!fs) continue;
      var nf;
      if (set.raw) nf = set.raw;
      else {
        nf = fs.replace(/<a:majorFont>[\s\S]*?<\/a:majorFont>/, function (m) { return fontPart('majorFont', set.major)(m); }).replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, function (m) { return fontPart('minorFont', set.minor)(m); })
          .replace(/^(<a:fontScheme\b[^>]*?\sname=")[^"]*(")/, function (m, a, b) { return a + escX(set.name) + b; });
      }
      pkg.write(tp.themes[i], x.replace(fs, function () { return nf; })); n++;
    }
    return n ? { ok: true, n: n } : { err: '이 문서의 테마에는 글꼴 조합이 없습니다.' };
  }
  // 다른 파워포인트 파일(zip 읽는 함수 쪽에서 문자열을 넘김)의 테마 XML 에서 조합 뽑기
  function extractFromTheme(themeXml) {
    var cs = cut(themeXml, 'clrScheme'), fs = cut(themeXml, 'fontScheme'); if (!cs && !fs) return null;
    return { colors: cs ? { name: nameOf(cs) || '가져온 색 조합', raw: cs, c: colorsOf(cs) } : null, fonts: fs ? { name: nameOf(fs) || '가져온 글꼴 조합', raw: fs, f: fontsOf(fs) } : null };
  }
  async function extractFromPkg(pkg) {
    var tp = await themeParts(pkg); if (!tp.themes.length) return null;
    var x = await pkg.read(tp.themes[0]); return x ? extractFromTheme(x) : null;
  }
  async function importScheme(pkg, ex, what) {
    var res = { colors: false, fonts: false };
    if (ex.colors && (what === 'both' || what === 'colors')) { var r = await setColors(pkg, { name: ex.colors.name, raw: ex.colors.raw, c: [] }); if (r.err) return r; res.colors = true; }
    if (ex.fonts && (what === 'both' || what === 'fonts')) { var f = await setFonts(pkg, { name: ex.fonts.name, raw: ex.fonts.raw }); if (f.err) return f; res.fonts = true; }
    return { ok: true, res: res };
  }

  // ======================= 마스터 보기(간단) =======================
  function defRPrOf(styleXml, lvl) {                       // <a:lvlNpPr> 안의 defRPr 위치
    var m = new RegExp('<a:lvl' + lvl + 'pPr\\b[\\s\\S]*?</a:lvl' + lvl + 'pPr>').exec(styleXml); if (!m) return null;
    var d = /<a:defRPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:defRPr>)/.exec(m[0]); if (!d) return null;
    return { lvl: m, s: m.index + d.index, e: m.index + d.index + d[0].length, x: d[0] };
  }
  function editDefRPr(x, o) {                              // o: { size(pt), bold, color(hex), font }
    var m = /^<a:defRPr\b([^>]*?)(\/?)>/.exec(x), at = m[1], inner = m[2] === '/' ? '' : x.slice(m[0].length, x.lastIndexOf('</a:defRPr>'));
    function A(n, v) { var re = new RegExp('\\s' + n + '="[^"]*"'); at = re.test(at) ? at.replace(re, ' ' + n + '="' + v + '"') : at + ' ' + n + '="' + v + '"'; }
    if (o.size != null) A('sz', Math.round(o.size * 100));
    if (o.bold != null) A('b', o.bold ? '1' : '0');
    if (o.color) { var fill = '<a:solidFill><a:srgbClr val="' + o.color + '"/></a:solidFill>'; if (/<a:solidFill>[\s\S]*?<\/a:solidFill>/.test(inner)) inner = inner.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, fill); else { var ln = /<a:ln\b[\s\S]*?<\/a:ln>/.exec(inner); inner = ln ? inner.slice(0, ln.index + ln[0].length) + fill + inner.slice(ln.index + ln[0].length) : fill + inner; } }
    if (o.font) {
      var fe = escX(o.font), lat = '<a:latin typeface="' + fe + '"/>', ea = '<a:ea typeface="' + fe + '"/>';
      inner = /<a:latin\b[^>]*?\/>/.test(inner) ? inner.replace(/<a:latin\b[^>]*?\/>/, lat) : inner;
      inner = /<a:ea\b[^>]*?\/>/.test(inner) ? inner.replace(/<a:ea\b[^>]*?\/>/, ea) : inner;
      if (!/<a:latin\b/.test(inner)) { var at2 = inner.search(/<a:(?:cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/); at2 = at2 < 0 ? inner.length : at2; inner = inner.slice(0, at2) + lat + (/<a:ea\b/.test(inner) ? '' : ea) + inner.slice(at2); }
      else if (!/<a:ea\b/.test(inner)) inner = inner.replace(lat, lat + ea);
    }
    return '<a:defRPr' + at + (inner ? '>' + inner + '</a:defRPr>' : '/>');
  }
  function readDef(styleXml, lvl) {
    var d = defRPrOf(styleXml, lvl); if (!d) return null;
    var sz = /\ssz="(\d+)"/.exec(d.x), b = /\sb="(\d)"/.exec(d.x), col = /<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(d.x), sch = /<a:solidFill>\s*<a:schemeClr val="(\w+)"/.exec(d.x), la = /<a:latin\b[^>]*?\stypeface="([^"]*)"/.exec(d.x);
    return { size: sz ? +sz[1] / 100 : null, bold: b ? b[1] === '1' : null, color: col ? col[1].toUpperCase() : null, scheme: sch ? sch[1] : null, font: la ? H.unescX(la[1]) : null };
  }
  function styleRange(xml, tag) { var m = new RegExp('<p:' + tag + '>[\\s\\S]*?</p:' + tag + '>').exec(xml); return m ? { s: m.index, e: m.index + m[0].length, x: m[0] } : null; }
  function bgOf(xml) {
    var m = /<p:bg>([\s\S]*?)<\/p:bg>/.exec(xml); if (!m) return null;
    var c = /<p:bgPr>\s*<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(m[1]); if (c) return c[1].toUpperCase();
    var sc = /<a:solidFill>\s*<a:schemeClr val="(\w+)"/.exec(m[1]) || /<p:bgRef\b[^>]*>\s*<a:schemeClr val="(\w+)"/.exec(m[1]); return sc ? ('scheme:' + sc[1]) : 'other';
  }
  function setBgXml(xml, hex) {                            // hex = 'RRGGBB' | null(마스터는 기본, 배치는 마스터를 따름)
    var has = /<p:bg>[\s\S]*?<\/p:bg>/.test(xml);
    var bg = hex ? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' : null;
    if (has) return xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, function () { return bg || ''; });
    if (!bg) return xml;
    var m = /<p:cSld\b[^>]*?(\/?)>/.exec(xml); if (!m || m[1] === '/') throw new Error('배경을 넣을 자리를 찾지 못했습니다');
    return xml.slice(0, m.index + m[0].length) + bg + xml.slice(m.index + m[0].length);
  }
  async function masterPaths(pkg) { return (await themeParts(pkg)).masters; }
  async function readMaster(pkg) {
    var mp = await masterPaths(pkg); if (!mp.length) return { err: '슬라이드 마스터를 찾지 못했습니다.' };
    var x = await must(pkg, mp[0]), ts = styleRange(x, 'titleStyle'), bs = styleRange(x, 'bodyStyle');
    var layouts = await ST.listLayouts(pkg), out = [];
    for (var i = 0; i < layouts.length; i++) { var lx = await pkg.read(layouts[i].path); out.push({ path: layouts[i].path, name: layouts[i].name, bg: lx ? bgOf(lx) : null }); }
    return { path: mp[0], masters: mp.length, bg: bgOf(x), title: ts ? readDef(ts.x, 1) : null, body: bs ? readDef(bs.x, 1) : null, layouts: out };
  }
  // o: { bg: 'RRGGBB'|'' (기본으로), allLayouts: bool, titleFont, titleSize, titleBold, titleColor, bodyFont, bodySize, bodyColor }
  async function setMaster(pkg, o) {
    var mp = await masterPaths(pkg); if (!mp.length) return { err: '슬라이드 마스터를 찾지 못했습니다.' };
    var lays = o.bg !== undefined && o.allLayouts ? await ST.listLayouts(pkg) : [];
    for (var m = 0; m < mp.length; m++) {
      var x = await must(pkg, mp[m]);
      if (o.bg !== undefined) {
        if (o.bg) x = setBgXml(x, o.bg); else x = x.replace(/<p:bg>[\s\S]*?<\/p:bg>/, '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>');
      }
      var to = {}; if (o.titleFont) to.font = o.titleFont; if (o.titleSize) to.size = o.titleSize; if (o.titleBold != null) to.bold = o.titleBold; if (o.titleColor) to.color = o.titleColor;
      if (Object.keys(to).length) {
        var ts = styleRange(x, 'titleStyle'); if (!ts) return { err: '이 마스터에는 제목 서식이 없습니다.' };
        var d = defRPrOf(ts.x, 1); if (!d) return { err: '이 마스터의 제목 서식을 읽지 못했습니다.' };
        var nt = ts.x.slice(0, d.s) + editDefRPr(d.x, to) + ts.x.slice(d.e); x = x.slice(0, ts.s) + nt + x.slice(ts.e);
      }
      if (o.bodyFont || o.bodySize || o.bodyColor) {
        var bs = styleRange(x, 'bodyStyle'); if (!bs) return { err: '이 마스터에는 본문 서식이 없습니다.' };
        var bx = bs.x, d1 = defRPrOf(bx, 1), old1 = d1 ? readDef(bx, 1).size : null, ratio = o.bodySize && old1 ? o.bodySize / old1 : 1;
        for (var lv = 9; lv >= 1; lv--) {                 // 뒤 단계부터 고쳐야 앞 위치가 어긋나지 않는다
          var dd = defRPrOf(bx, lv); if (!dd) continue; var so = {};
          if (o.bodyFont) so.font = o.bodyFont; if (o.bodyColor) so.color = o.bodyColor;
          if (o.bodySize) { var cur = /\ssz="(\d+)"/.exec(dd.x); so.size = Math.max(8, Math.round(((cur ? +cur[1] / 100 : o.bodySize) * ratio) * 2) / 2); }
          bx = bx.slice(0, dd.s) + editDefRPr(dd.x, so) + bx.slice(dd.e);
        }
        x = x.slice(0, bs.s) + bx + x.slice(bs.e);
      }
      pkg.write(mp[m], x);
    }
    for (var i = 0; i < lays.length; i++) { var lx = await must(pkg, lays[i].path); pkg.write(lays[i].path, o.bg ? setBgXml(lx, o.bg) : lx.replace(/<p:bg>[\s\S]*?<\/p:bg>/, '')); }
    return { ok: true };
  }
  async function setLayoutBg(pkg, layoutPath, hex) {
    var x = await pkg.read(layoutPath); if (x == null) return { err: '배치를 찾지 못했습니다.' };
    pkg.write(layoutPath, setBgXml(x, hex || null)); return { ok: true };
  }

  ST.COLOR_SETS = COLOR_SETS; ST.FONT_SETS = FONT_SETS;
  ST.readTheme = readTheme; ST.setThemeColors = setColors; ST.setThemeFonts = setFonts; ST.extractThemeFrom = extractFromTheme; ST.extractThemeFromPkg = extractFromPkg; ST.importThemeScheme = importScheme;
  ST.readMaster = readMaster; ST.setMaster = setMaster; ST.setLayoutBg = setLayoutBg;
})(typeof window !== 'undefined' ? window : globalThis);
