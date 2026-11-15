/* so-pdf-textedit.js — S-Office PDF 「글 직접 고치기」 엔진 (O-0861, v10.9 5회차)
 * ----------------------------------------------------------------------------
 * 쪽의 내용 스트림(글을 그리는 명령 Tj·TJ·'·")을 직접 읽어 글을 찾고, 고르면 그 명령의 글을 바꾸거나 파일에서 **진짜로 지운다**(가림 막대가 아니다).
 *  - 같은 글꼴에 새 글자가 이미 들어 있으면(이 문서의 같은 글꼴로 쓴 글자, 또는 글꼴이 파일에 안 들어 있는 표준 글꼴) 그 글꼴로 제자리 교체한다(글자 선택·검색 그대로).
 *  - 없으면 옛 글을 내용 스트림에서 지우고(뒤에 오는 글의 자리는 그대로 두는 간격 명령으로 대신), 새 글을 영문·숫자는 표준 글꼴로, 그 밖에는 그림으로 같은 자리에 얹는다.
 * 외부 부품 없음(pdf-lib 는 앱에 이미 있는 MIT 부품). 브라우저와 Node 양쪽에서 돈다(시험용, module.exports).
 * 한계(화면에 그대로 알림): 세로쓰기·미리 정해진 옛 글자표(CMap)·글자표 없는 기호 글꼴은 고치지 않고 이유를 알려 준다.
 */
(function (global) {
  'use strict';

  // ============================== 행렬 ==============================
  function mmul(A, B) { return [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]]; }
  function mapPt(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }
  var ID = [1, 0, 0, 1, 0, 0];

  // ============================== 내용 스트림 읽기(토큰) ==============================
  // 입력은 latin1 글자열(바이트 하나 = 글자 하나). 돌려주는 것: 최상위 항목 배열. 항목 = {t, v, s, e} (s,e = 글자열 안 위치)
  // t: num name str(바이트 글자열 v) hex(v=바이트 글자열) arr(items) dict(raw) op(v=명령 글자)
  var WS = { 0: 1, 9: 1, 10: 1, 12: 1, 13: 1, 32: 1 };
  var DELIM = '()<>[]{}/%';
  function isWs(c) { return WS[c] === 1; }
  function lex(src) {
    var i = 0, n = src.length;
    function skipWs() {
      while (i < n) {
        var c = src.charCodeAt(i);
        if (isWs(c)) i++;
        else if (c === 37) { while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++; }
        else break;
      }
    }
    function litStr() {                       // 「(」 뒤에서 시작
      var depth = 1, out = '', s = i;
      while (i < n) {
        var ch = src.charAt(i), c = src.charCodeAt(i);
        if (c === 92) {                       // 역슬래시
          var nx = src.charAt(i + 1);
          if (nx === 'n') out += '\n'; else if (nx === 'r') out += '\r'; else if (nx === 't') out += '\t'; else if (nx === 'b') out += '\b'; else if (nx === 'f') out += '\f';
          else if (nx === '(' || nx === ')' || nx === '\\') out += nx;
          else if (nx === '\r') { if (src.charAt(i + 2) === '\n') i++; }
          else if (nx === '\n') { /* 줄 잇기 */ }
          else if (nx >= '0' && nx <= '7') { var o = nx, k = 2; while (k-- > 0 && src.charAt(i + 1 + o.length) >= '0' && src.charAt(i + 1 + o.length) <= '7') o += src.charAt(i + 1 + o.length); out += String.fromCharCode(parseInt(o, 8) & 255); i += o.length - 1; }
          else out += nx;
          i += 2; continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) { i++; return out; } }
        out += ch; i++;
      }
      return out;
    }
    function parseObj(inArr) {
      skipWs();
      if (i >= n) return null;
      var s = i, c = src.charCodeAt(i), ch = src.charAt(i);
      if (ch === '(') { i++; var v = litStr(); return { t: 'str', v: v, s: s, e: i }; }
      if (ch === '<') {
        if (src.charAt(i + 1) === '<') {      // 사전 — 짝이 맞는 >> 까지 통째로 둔다(문자열 안의 괄호를 건너뛴다)
          var d = 1; i += 2;
          while (i < n && d > 0) {
            var c2 = src.charAt(i);
            if (c2 === '(') { i++; litStr(); continue; }
            if (c2 === '<' && src.charAt(i + 1) === '<') { d++; i += 2; continue; }
            if (c2 === '>' && src.charAt(i + 1) === '>') { d--; i += 2; continue; }
            i++;
          }
          return { t: 'dict', raw: src.slice(s, i), s: s, e: i };
        }
        i++; var h = '';
        while (i < n && src.charAt(i) !== '>') { var hc = src.charAt(i); if (/[0-9A-Fa-f]/.test(hc)) h += hc; i++; }
        i++; if (h.length % 2) h += '0';
        var b = ''; for (var k = 0; k < h.length; k += 2) b += String.fromCharCode(parseInt(h.substr(k, 2), 16));
        return { t: 'hex', v: b, s: s, e: i };
      }
      if (ch === '[') {
        i++; var items = [];
        for (;;) {
          skipWs(); if (i >= n) break;
          if (src.charAt(i) === ']') { i++; break; }
          var o = parseObj(true); if (!o) break; items.push(o);
        }
        return { t: 'arr', items: items, s: s, e: i };
      }
      if (ch === ']' || ch === ')' || ch === '>' || ch === '{' || ch === '}') { i++; return { t: 'op', v: ch, s: s, e: i }; }
      if (ch === '/') {
        i++; while (i < n && !isWs(src.charCodeAt(i)) && DELIM.indexOf(src.charAt(i)) < 0) i++;
        return { t: 'name', v: src.slice(s + 1, i), s: s, e: i };
      }
      while (i < n && !isWs(src.charCodeAt(i)) && DELIM.indexOf(src.charAt(i)) < 0) i++;
      var w = src.slice(s, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w), s: s, e: i };
      return { t: 'op', v: w, s: s, e: i };
    }
    var items = [];
    for (;;) {
      skipWs(); if (i >= n) break;
      var o = parseObj(false); if (!o) break;
      if (o.t === 'op' && o.v === 'BI') {       // 인라인 그림: ID 뒤 바이트는 읽지 않고 EI 까지 통째로
        var idm = /[\s]ID[\s]/g; idm.lastIndex = i; var m = idm.exec(src), startData = m ? m.index + m[0].length : i;
        var re = /[\s]EI(?=[\s]|$)/g; re.lastIndex = startData; var em = re.exec(src);
        var endI = em ? em.index + em[0].length : n; i = endI;
        o = { t: 'op', v: 'BI', s: o.s, e: endI, inline: true };
      }
      items.push(o);
    }
    return items;
  }

  // ============================== 글자표(ToUnicode) · 글꼴 ==============================
  function u16(s) { var out = ''; for (var i = 0; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1)); return s.length === 1 ? String.fromCharCode(s.charCodeAt(0)) : out; }
  function parseToUnicode(txt) {
    var map = {}, width = 0, m, re;
    re = /begincodespacerange([\s\S]*?)endcodespacerange/g;
    while ((m = re.exec(txt))) { var ps = m[1].match(/<([0-9A-Fa-f]+)>/g) || []; if (ps.length) width = Math.max(width, (ps[0].length - 2) / 2); }
    function hexv(h) { return parseInt(h, 16); }
    function hexs(h) { var b = ''; for (var k = 0; k + 1 < h.length; k += 2) b += String.fromCharCode(parseInt(h.substr(k, 2), 16)); return u16(b); }
    re = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = re.exec(txt))) {
      var r2 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, x;
      while ((x = r2.exec(m[1]))) { map[hexv(x[1])] = hexs(x[2]); if (!width) width = x[1].length / 2; }
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(txt))) {
      var r3 = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)/g, y;
      while ((y = r3.exec(m[1]))) {
        var a = hexv(y[1]), b2 = hexv(y[2]); if (!width) width = y[1].length / 2;
        if (b2 - a > 70000) continue;
        if (y[3].charAt(0) === '[') { var dest = y[3].match(/<([0-9A-Fa-f]+)>/g) || []; for (var q = 0; q <= b2 - a && q < dest.length; q++) map[a + q] = hexs(dest[q].slice(1, -1)); }
        else { var base = y[3].slice(1, -1), bs = hexs(base); for (var q2 = 0; q2 <= b2 - a; q2++) { var last = bs.charCodeAt(bs.length - 1) + q2; map[a + q2] = bs.slice(0, -1) + String.fromCharCode(last); } }
      }
    }
    return { map: map, width: width };
  }
  var AGL = { space: 32, exclam: 33, quotedbl: 34, numbersign: 35, dollar: 36, percent: 37, ampersand: 38, quotesingle: 39, parenleft: 40, parenright: 41, asterisk: 42, plus: 43, comma: 44, hyphen: 45, minus: 8722, period: 46, slash: 47, colon: 58, semicolon: 59, less: 60, equal: 61, greater: 62, question: 63, at: 64, bracketleft: 91, backslash: 92, bracketright: 93, asciicircum: 94, underscore: 95, grave: 96, braceleft: 123, bar: 124, braceright: 125, asciitilde: 126, bullet: 8226, endash: 8211, emdash: 8212, quoteleft: 8216, quoteright: 8217, quotedblleft: 8220, quotedblright: 8221, ellipsis: 8230, fi: 0xFB01, fl: 0xFB02, zero: 48, one: 49, two: 50, three: 51, four: 52, five: 53, six: 54, seven: 55, eight: 56, nine: 57, copyright: 169, registered: 174, degree: 176, multiply: 215, divide: 247, section: 167, nbspace: 160, nonbreakingspace: 160 };
  function glyphToChar(g) {
    if (!g) return '';
    if (AGL[g] != null) return String.fromCharCode(AGL[g]);
    if (/^[A-Za-z]$/.test(g)) return g;
    var m = /^uni([0-9A-Fa-f]{4})$/.exec(g); if (m) return String.fromCharCode(parseInt(m[1], 16));
    m = /^u([0-9A-Fa-f]{4,6})$/.exec(g); if (m) return String.fromCodePoint(parseInt(m[1], 16));
    return '';
  }
  var cp1252 = null;
  function baseEncChar(enc, code) {
    if (enc === 'WinAnsiEncoding' || !enc) {
      if (!cp1252) { cp1252 = []; try { var td = new TextDecoder('windows-1252'); for (var i = 0; i < 256; i++) cp1252[i] = i < 32 ? '' : td.decode(new Uint8Array([i])); } catch (e) { for (var j = 0; j < 256; j++) cp1252[j] = j < 32 ? '' : String.fromCharCode(j); } }
      return cp1252[code] || '';
    }
    if (enc === 'MacRomanEncoding') { try { return new TextDecoder('macintosh').decode(new Uint8Array([code])); } catch (e) { return code >= 32 && code < 127 ? String.fromCharCode(code) : ''; } }
    return code >= 32 && code < 127 ? String.fromCharCode(code) : (code >= 160 ? String.fromCharCode(code) : '');
  }

  var HELV_W = { 32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015, 73: 278, 74: 500, 105: 222, 106: 222, 108: 222, 102: 278, 116: 278, 114: 333, 109: 833, 119: 722, 77: 833, 87: 944 };

  function lookupDict(L, ctx, o) { return o instanceof L.PDFRef ? ctx.lookup(o) : o; }
  function dget(L, ctx, d, key) { if (!d || !d.get) return undefined; var v = d.get(L.PDFName.of(key)); return v instanceof L.PDFRef ? ctx.lookup(v) : v; }
  function streamText(L, ctx, st) {
    try {
      var bytes = L.decodePDFRawStream ? L.decodePDFRawStream(st).decode() : st.getContents();
      var s = ''; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s;
    } catch (e) { return null; }
  }
  // 글꼴 하나를 읽는다. 돌려주는 것: {name, kind:'simple'|'cid', bpc(코드 바이트 수), toUni(code)→글자, widthOf(code)→1000분율, approx, embedded, editable, why, used:{글자:코드}(나중에 채움)}
  function loadFont(L, doc, fdict, key) {
    var ctx = doc.context, N = L.PDFName.of, f = { key: key, kind: 'simple', bpc: 1, map: null, widths: null, first: 0, missing: 0, dw: 1000, cw: null, approx: false, embedded: false, editable: true, why: '', used: {}, enc: null, diffs: null, usedCodes: {} };
    var sub = dget(L, ctx, fdict, 'Subtype'), subN = sub && sub.asString ? sub.asString() : '';
    var bf = dget(L, ctx, fdict, 'BaseFont'); f.name = bf && bf.asString ? bf.asString().replace(/^\//, '') : '';
    var tu = dget(L, ctx, fdict, 'ToUnicode');
    if (tu && tu instanceof L.PDFRawStream) { var t = streamText(L, ctx, tu); if (t) { var p = parseToUnicode(t); f.map = p.map; f.tuWidth = p.width; } }
    var enc = dget(L, ctx, fdict, 'Encoding'), desc;
    if (subN === '/Type0') {
      f.kind = 'cid'; f.bpc = 2;
      var encName = enc && enc.asString ? enc.asString().replace(/^\//, '') : '';
      if (encName && encName !== 'Identity-H') { f.editable = false; f.why = '글꼴 방식(' + encName + ')을 고칠 수 없습니다'; }
      if (encName === 'Identity-V') f.vertical = true;
      if (!f.map && f.editable) { f.editable = false; f.why = '이 글꼴에는 글자표가 없어 글자를 알 수 없습니다'; }
      if (f.tuWidth === 1) f.bpc = 1;
      var df = dget(L, ctx, fdict, 'DescendantFonts'), d0 = df && df.get ? lookupDict(L, ctx, df.get(0)) : null;
      if (d0) {
        var dw = dget(L, ctx, d0, 'DW'); f.dw = dw && dw.asNumber ? dw.asNumber() : 1000;
        var w = dget(L, ctx, d0, 'W'); f.cw = {};
        if (w && w.size) {
          var idx = 0, sz = w.size();
          while (idx < sz) {
            var c1 = lookupDict(L, ctx, w.get(idx)), nx = lookupDict(L, ctx, w.get(idx + 1));
            if (!c1 || !nx) break;
            if (nx instanceof L.PDFArray) { for (var q = 0; q < nx.size(); q++) { var wv = lookupDict(L, ctx, nx.get(q)); f.cw[c1.asNumber() + q] = wv.asNumber(); } idx += 2; }
            else { var c2 = nx.asNumber(), wv2 = lookupDict(L, ctx, w.get(idx + 2)); if (!wv2) break; if (c2 - c1.asNumber() < 70000) for (var cc = c1.asNumber(); cc <= c2; cc++) f.cw[cc] = wv2.asNumber(); idx += 3; }
          }
        }
        desc = dget(L, ctx, d0, 'FontDescriptor');
      }
    } else {
      f.kind = 'simple'; f.bpc = 1;
      var fc = dget(L, ctx, fdict, 'FirstChar'); f.first = fc && fc.asNumber ? fc.asNumber() : 0;
      var ws = dget(L, ctx, fdict, 'Widths');
      if (ws && ws.size) { f.widths = []; for (var i = 0; i < ws.size(); i++) { var wv3 = lookupDict(L, ctx, ws.get(i)); f.widths.push(wv3 && wv3.asNumber ? wv3.asNumber() : 0); } }
      desc = dget(L, ctx, fdict, 'FontDescriptor');
      if (enc && enc.asString) f.enc = enc.asString().replace(/^\//, '');
      else if (enc && enc.get) {
        var be = dget(L, ctx, enc, 'BaseEncoding'); f.enc = be && be.asString ? be.asString().replace(/^\//, '') : null;
        var df2 = dget(L, ctx, enc, 'Differences');
        if (df2 && df2.size) { f.diffs = {}; var cur = 0; for (var j = 0; j < df2.size(); j++) { var it = lookupDict(L, ctx, df2.get(j)); if (it instanceof L.PDFNumber) cur = it.asNumber(); else if (it && it.asString) { f.diffs[cur] = it.asString().replace(/^\//, ''); cur++; } } }
      }
      if (!f.widths) f.approx = true;
    }
    if (desc && desc.get) {
      if (dget(L, ctx, desc, 'FontFile') || dget(L, ctx, desc, 'FontFile2') || dget(L, ctx, desc, 'FontFile3')) f.embedded = true;
      var mw = dget(L, ctx, desc, 'MissingWidth'); if (mw && mw.asNumber) f.missing = mw.asNumber();
    }
    if (f.kind === 'simple' && !f.map && !f.enc && !f.diffs && f.embedded && !/^[A-Z]{6}\+/.test(f.name) === false) { /* 부분 글꼴 + 글자표 없음 → 아래에서 판정 */ }
    if (f.kind === 'simple' && !f.map) {
      var symbolic = /Symbol|Dingbat|Wingding/i.test(f.name);
      if (symbolic) { f.editable = false; f.why = '기호 글꼴이라 글자를 알 수 없습니다'; }
      else if (f.embedded && !f.enc && !f.diffs && /^[A-Z]{6}\+/.test(f.name)) { f.editable = false; f.why = '글꼴에 글자표가 없어 글자를 알 수 없습니다'; }
    }
    return f;
  }
  function fontChar(f, code) {      // 코드 하나 → 글자(모르면 '')
    if (f.map && f.map[code] != null) return f.map[code];
    if (f.kind === 'cid') return '';
    if (f.diffs && f.diffs[code]) { var g = glyphToChar(f.diffs[code]); if (g) return g; }
    return baseEncChar(f.enc, code);
  }
  function fontWidth(f, code) {
    if (f.kind === 'cid') return f.cw && f.cw[code] != null ? f.cw[code] : f.dw;
    if (f.widths && code >= f.first && code - f.first < f.widths.length) return f.widths[code - f.first];
    if (f.widths) return f.missing || 0;
    return HELV_W[code] != null ? HELV_W[code] : 556;
  }
  function decodeStr(f, s) {         // 글자열(바이트) → {text, codes[], ok}
    var codes = [], text = '', ok = true, bpc = f.bpc;
    for (var i = 0; i + bpc <= s.length; i += bpc) {
      var code = bpc === 2 ? (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1) : s.charCodeAt(i);
      codes.push(code);
      var ch = fontChar(f, code); if (ch === '' && !(f.kind === 'simple' && code === 32)) ok = false;
      text += ch;
    }
    return { text: text, codes: codes, ok: ok };
  }

  // ============================== 내용 읽기: 글 명령 찾기 ==============================
  // units: [{key, stream|null(쪽), bytesStr, res(자원 사전), items}] . 반환 runs.
  function pageUnits(L, doc, page) {
    var ctx = doc.context, N = L.PDFName.of, c = page.node.get(N('Contents')), parts = [], bad = null;
    c = c instanceof L.PDFRef ? ctx.lookup(c) : c;
    var list = [];
    if (c instanceof L.PDFArray) { for (var i = 0; i < c.size(); i++) list.push(lookupDict(L, ctx, c.get(i))); }
    else if (c) list.push(c);
    list.forEach(function (st) { var t = (st && st.dict) ? streamText(L, ctx, st) : ''; if (t == null) bad = '내용을 읽을 수 없는 압축 방식입니다'; else parts.push(t); });
    if (bad) throw new Error(bad);
    return parts.join('\n');
  }
  function pageResources(L, doc, page) {
    var ctx = doc.context, N = L.PDFName.of, node = page.node, r;
    while (node) { r = node.get(N('Resources')); if (r) break; var p = node.get(N('Parent')); node = p ? ctx.lookup(p) : null; }
    return r instanceof L.PDFRef ? ctx.lookup(r) : r;
  }

  function readRuns(L, doc, pageIndex, opts) {
    opts = opts || {};
    var ctx = doc.context, N = L.PDFName.of, page = doc.getPage(pageIndex);
    var fontCache = opts.fontCache || {};
    var runs = [], diag = { skippedFonts: [], unitCount: 0, formDepthLimit: 0 };
    var visited = {};
    function parseUnit(src, res, ctm0, fill0, unitKey, depth, streamObj) {
      diag.unitCount++;
      var items = lex(src), operands = [], gs = { ctm: ctm0, tc: 0, tw: 0, th: 1, tl: 0, font: null, fsize: 0, ts: 0, tr: 0, fill: fill0 }, stack = [];
      var tm = ID.slice(), tlm = ID.slice(), fillSpace = 'DeviceGray', firstOperand = -1, tmBlockStart = 0, ops = [];
      function popN(k) { return operands.slice(Math.max(0, operands.length - k)).map(function (o) { return o.v; }); }
      function getFont(name) {
        var fr = res && dget(L, ctx, res, 'Font'), fd = fr && fr.get ? fr.get(N(name)) : null; if (!fd) return null;
        var ck = (fd instanceof L.PDFRef ? fd.toString() : unitKey + ':' + name);
        if (!fontCache[ck]) { try { fontCache[ck] = loadFont(L, doc, fd instanceof L.PDFRef ? ctx.lookup(fd) : fd, ck); } catch (e) { fontCache[ck] = { key: ck, editable: false, why: '글꼴을 읽지 못했습니다', kind: 'simple', bpc: 1, used: {}, usedCodes: {}, name: name }; } }
        return fontCache[ck];
      }
      function showText(strItems, opItem, kind, firstIdx, extra) {
        var f = gs.font; if (!f) return;
        var text = '', adv = 0, allOk = true, th = gs.th, fs = gs.fsize;
        function addStr(sv) {
          var d = decodeStr(f, sv); text += d.text; if (!d.ok) allOk = false;
          d.codes.forEach(function (cd) {
            var w = fontWidth(f, cd) / 1000 * fs + gs.tc + ((f.bpc === 1 && cd === 32) ? gs.tw : 0);
            adv += w * th; f.usedCodes[cd] = 1;
            var ch = fontChar(f, cd); if (ch && f.used[ch] == null) f.used[ch] = cd;
          });
        }
        strItems.forEach(function (it) { if (it.t === 'num') adv += -it.v / 1000 * fs * th; else addStr(it.v); });
        if (kind === '"' || kind === "'") { /* 줄 이동은 호출 쪽에서 처리 */ }
        var trm = mmul(tm, gs.ctm), run = { id: 0, unit: unitKey, kind: kind, s: firstIdx.s, e: opItem.e, strItems: strItems, font: f, fontName: f.name, fsize: fs, tm: tm.slice(), ctm: gs.ctm.slice(), trm: trm, th: th, tc: gs.tc, tw: gs.tw, ts: gs.ts, adv: adv, text: text, textOk: allOk, fill: gs.fill, tr: gs.tr, approx: !!f.approx, extra: extra };
        // 글자 상자(사용자 공간): 글자 높이는 크기의 -0.22 ~ 0.85
        var p = [mapPt(trm, 0, gs.ts - 0.22 * fs), mapPt(trm, adv, gs.ts - 0.22 * fs), mapPt(trm, adv, gs.ts + 0.85 * fs), mapPt(trm, 0, gs.ts + 0.85 * fs)];
        var xs = p.map(function (q) { return q[0]; }), ys = p.map(function (q) { return q[1]; });
        run.bbox = { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
        run.origin = mapPt(trm, 0, gs.ts);
        run.angle = Math.atan2(trm[1], trm[0]);
        run.scale = Math.sqrt(trm[0] * trm[0] + trm[1] * trm[1]);
        run.extra = extra || { s: firstIdx.s }; run.index = ops.length; ops.push(run);
        tm = mmul([1, 0, 0, 1, adv, 0], tm);
        return run;
      }
      var lastRun = null;
      items.forEach(function (it) {
        if (it.t !== 'op') { if (firstOperand < 0) firstOperand = it.s; operands.push(it); return; }
        var op = it.v, a;
        var fo = firstOperand < 0 ? it.s : firstOperand;
        switch (op) {
          case 'q': stack.push({ ctm: gs.ctm, tc: gs.tc, tw: gs.tw, th: gs.th, tl: gs.tl, font: gs.font, fsize: gs.fsize, ts: gs.ts, tr: gs.tr, fill: gs.fill }); break;
          case 'Q': if (stack.length) gs = stack.pop(); break;
          case 'cm': a = popN(6); if (a.length === 6) gs.ctm = mmul(a, gs.ctm); break;
          case 'BT': tm = ID.slice(); tlm = ID.slice(); break;
          case 'Tc': a = popN(1); gs.tc = a[0] || 0; break;
          case 'Tw': a = popN(1); gs.tw = a[0] || 0; break;
          case 'Tz': a = popN(1); gs.th = (a[0] == null ? 100 : a[0]) / 100; break;
          case 'TL': a = popN(1); gs.tl = a[0] || 0; break;
          case 'Ts': a = popN(1); gs.ts = a[0] || 0; break;
          case 'Tr': a = popN(1); gs.tr = a[0] || 0; break;
          case 'Tf': { var nm = operands.length >= 2 ? operands[operands.length - 2] : null, sz = operands.length ? operands[operands.length - 1].v : 0; if (nm && nm.t === 'name') { gs.font = getFont(nm.v); gs.fsize = sz; } break; }
          case 'Td': a = popN(2); tlm = mmul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm.slice(); break;
          case 'TD': a = popN(2); gs.tl = -(a[1] || 0); tlm = mmul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm.slice(); break;
          case 'Tm': a = popN(6); if (a.length === 6) { tm = a.slice(); tlm = a.slice(); } break;
          case 'T*': tlm = mmul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm.slice(); break;
          case 'g': a = popN(1); gs.fill = { sp: 'g', v: a }; fillSpace = 'DeviceGray'; break;
          case 'rg': a = popN(3); gs.fill = { sp: 'rgb', v: a }; fillSpace = 'DeviceRGB'; break;
          case 'k': a = popN(4); gs.fill = { sp: 'cmyk', v: a }; fillSpace = 'DeviceCMYK'; break;
          case 'cs': { var cn = operands.length ? operands[operands.length - 1].v : ''; fillSpace = cn; if (cn === 'DeviceGray' || cn === 'DeviceRGB' || cn === 'DeviceCMYK') { /* 곧 sc */ } else gs.fill = null; break; }
          case 'sc': case 'scn': { var nums = operands.filter(function (o) { return o.t === 'num'; }).map(function (o) { return o.v; }); if (fillSpace === 'DeviceGray' && nums.length === 1) gs.fill = { sp: 'g', v: nums }; else if (fillSpace === 'DeviceRGB' && nums.length === 3) gs.fill = { sp: 'rgb', v: nums }; else if (fillSpace === 'DeviceCMYK' && nums.length === 4) gs.fill = { sp: 'cmyk', v: nums }; else gs.fill = null; break; }
          case 'Tj': { var so = operands.length ? operands[operands.length - 1] : null; if (so && (so.t === 'str' || so.t === 'hex')) lastRun = showText([so], it, 'Tj', { s: so.s }); break; }
          case 'TJ': { var ar = operands.length ? operands[operands.length - 1] : null; if (ar && ar.t === 'arr') lastRun = showText(ar.items.filter(function (x) { return x.t === 'str' || x.t === 'hex' || x.t === 'num'; }), it, 'TJ', { s: ar.s }); break; }
          case "'": { var s2 = operands.length ? operands[operands.length - 1] : null; tlm = mmul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm.slice(); if (s2 && (s2.t === 'str' || s2.t === 'hex')) { var r1 = showText([s2], it, "'", { s: fo }, { strTok: s2 }); } break; }
          case '"': { var as = operands.slice(-3); if (as.length === 3) { gs.tw = as[0].v; gs.tc = as[1].v; tlm = mmul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm.slice(); if (as[2].t === 'str' || as[2].t === 'hex') showText([as[2]], it, '"', { s: fo }, { strTok: as[2] }); } break; }
          case 'Do': {
            var xn = operands.length ? operands[operands.length - 1] : null;
            if (xn && xn.t === 'name' && depth < 3 && res) {
              var xo = dget(L, ctx, res, 'XObject'), xr = xo && xo.get ? xo.get(N(xn.v)) : null, xs = xr instanceof L.PDFRef ? ctx.lookup(xr) : xr;
              if (xs && xs.dict && dget(L, ctx, xs.dict, 'Subtype') === N('Form')) {
                var xk = xr instanceof L.PDFRef ? xr.toString() : null;
                if (xk && visited[xk]) { diag.formShared = (diag.formShared || 0) + 1; break; }
                if (xk) visited[xk] = 1;
                var mat = dget(L, ctx, xs.dict, 'Matrix'), M = ID.slice();
                if (mat && mat.size && mat.size() === 6) { M = []; for (var mi = 0; mi < 6; mi++) M.push(lookupDict(L, ctx, mat.get(mi)).asNumber()); }
                var fres = dget(L, ctx, xs.dict, 'Resources') || res, ft = streamText(L, ctx, xs);
                if (ft != null) parseUnit(ft, fres, mmul(M, gs.ctm), gs.fill, 'F' + (xk || xn.v), depth + 1, { ref: xr, stream: xs });
                else diag.formBad = (diag.formBad || 0) + 1;
              }
            }
            break;
          }
        }
        operands = []; firstOperand = -1;
      });
      // 줄 앞에서 간격이 필요한지(뒤따르는 글 명령이 자리를 이어받는지) 판정
      var seq = [];            // 이 단위의 글 명령·위치 명령을 순서대로
      items.forEach(function (it) { if (it.t === 'op') { if (/^(Tj|TJ|'|")$/.test(it.v)) seq.push({ show: true, e: it.e }); else if (/^(Td|TD|Tm|T\*|BT|ET)$/.test(it.v)) seq.push({ show: false }); } });
      var bySeq = {}; ops.forEach(function (r) { bySeq[r.e] = r; });
      for (var si = 0; si < seq.length; si++) {
        if (!seq[si].show) continue;
        var rr = bySeq[seq[si].e]; if (!rr) continue;
        var nx2 = seq[si + 1];
        rr.needAdv = !!(nx2 && nx2.show);
      }
      var unitObj = { key: unitKey, src: src, items: items, stream: streamObj || null, runs: ops };
      units.push(unitObj);
      ops.forEach(function (r) { r.unitObj = unitObj; });
      ops.forEach(function (r) { runs.push(r); });
    }
    var units = [], res = pageResources(L, doc, page), src = pageUnits(L, doc, page);
    parseUnit(src, res, ID.slice(), null, 'P', 0, null);
    runs.forEach(function (r, i) { r.id = i; });
    // 고칠 수 있는지 판정
    runs.forEach(function (r) {
      var f = r.font, why = '';
      if (!f) why = '글꼴 정보가 없습니다';
      else if (f.editable === false) why = f.why;
      else if (f.vertical) why = '세로쓰기는 고칠 수 없습니다';
      else if (!r.textOk && !String(r.text).trim()) why = r.text ? '' : '글자를 알 수 없습니다';
      else if (!r.textOk) why = '일부 글자를 알 수 없습니다';
      if (!why && r.tr === 3) r.invisible = true;
      if (!why && r.needAdv && r.approx) why = '글자 너비를 알 수 없어 뒤 글의 자리가 틀어질 수 있습니다';
      r.why = why; r.editable = !why && !!String(r.text).length;
      r.blank = !String(r.text).trim();
    });
    return { runs: runs, units: units, units0: units, fontCache: fontCache, diag: diag };
  }

  // ============================== 글꼴이 가진 글자 ==============================
  // 같은 글꼴로 이 문서에서 이미 쓴 글자(=글꼴 부분 집합에 그림이 있는 글자) 표를 모든 쪽에서 모은다. 파일에 안 들어 있는 글꼴은 글자표(인코딩)의 모든 글자를 쓴다.
  function scanDocFonts(L, doc, fontCache, onlyPages) {
    var n = doc.getPageCount(), i;
    for (i = 0; i < n; i++) { if (onlyPages && onlyPages.indexOf(i) < 0) continue; try { readRuns(L, doc, i, { fontCache: fontCache }); } catch (e) { /* 이 쪽은 건너뜀 */ } }
    return fontCache;
  }
  function charCode(f, ch) {             // 이 글꼴로 ch 를 쓸 수 있으면 코드, 없으면 -1
    if (f.kind === 'cid') { var u = f.used[ch]; return u != null ? u : -1; }
    if (f.used[ch] != null) return f.used[ch];
    if (!f.embedded && f.enc !== null && !f.map) {          // 파일에 글꼴이 없음(표준 글꼴): 글자표 전체
      for (var c = 32; c < 256; c++) if (fontChar(f, c) === ch) return c;
    }
    return -1;
  }
  function encodeWith(f, text) {
    var out = '';
    for (var i = 0; i < text.length;) {
      var cp = text.codePointAt(i), ch = String.fromCodePoint(cp); i += ch.length;
      var code = charCode(f, ch); if (code < 0) return null;
      out += f.bpc === 2 ? String.fromCharCode(code >> 8, code & 255) : String.fromCharCode(code);
    }
    return out;
  }
  function hexOf(s) { var o = '<'; for (var i = 0; i < s.length; i++) o += (s.charCodeAt(i) < 16 ? '0' : '') + s.charCodeAt(i).toString(16); return o + '>'; }
  function num(v) { var s = (Math.round(v * 1000) / 1000).toString(); return s === '-0' ? '0' : s; }

  // ============================== 고치기 ==============================
  // edits: [{ ids:[runId...], text:'새 글' | '' (지우기) }] . ids[0] 이 자리를 잡고 나머지는 지운다.
  // opts: textImage(text,sizePt,colorHex)→Promise<{bytes,wpt,hpt}> (ASCII 밖 글자용), helv: 사용 안 함
  function applyEdits(L, doc, pageIndex, edits, opts) {
    opts = opts || {};
    var N = L.PDFName.of, ctx = doc.context, page = doc.getPage(pageIndex);
    var rr = readRuns(L, doc, pageIndex, { fontCache: opts.fontCache });
    var runs = rr.runs, byId = {}; runs.forEach(function (r) { byId[r.id] = r; });
    // 같은 글꼴의 쓸 수 있는 글자표를 문서 전체에서 모은다
    scanDocFonts(L, doc, rr.fontCache);
    var plans = [], report = { inplace: 0, redrawn: 0, deleted: 0, warnings: [], oldTexts: [] };
    edits.forEach(function (ed) {
      var group = ed.ids.map(function (id) { return byId[id]; }).filter(Boolean);
      if (!group.length) return;
      var head = group[0], newText = String(ed.text || '');
      group.forEach(function (r) { if (!r.editable && !(r.blank)) throw new Error('고칠 수 없는 글이 들어 있습니다 — ' + (r.why || '')); });
      group.forEach(function (r) { if (String(r.text).trim()) report.oldTexts.push(r.text); });
      var plan = { head: head, group: group, text: newText, mode: 'delete' };
      if (newText) {
        var enc = group.length === 1 ? encodeWith(head.font, newText) : null;
        if (enc != null && !head.invisible) plan.mode = 'inplace', plan.enc = enc;
        else plan.mode = 'redraw';
      }
      plans.push(plan);
    });
    // 한 단위(쪽·양식 개체)씩 새 내용 만들기
    var replaces = {};         // unitKey → [{s,e,text}]
    var draws = [];            // 쪽 위에 얹을 새 글
    function addRep(r, s, e, t) { (replaces[r.unit] = replaces[r.unit] || []).push({ s: s, e: e, t: t }); }
    function spacing(r) {      // 지운 글이 차지하던 너비를 간격 명령으로 대신(뒤 글이 자리를 이어받을 때만)
      if (!r.needAdv) return null;
      var d = r.fsize * r.th; if (!d) return null;
      return '[' + num(-r.adv * 1000 / d) + '] TJ';
    }
    function removeCode(r) {
      var sp = spacing(r), body;
      if (r.kind === 'Tj') body = sp || '[] TJ';
      else if (r.kind === 'TJ') body = sp || '[] TJ';
      else if (r.kind === "'") body = 'T* ' + (sp || '[] TJ');
      else body = num(r.tw) + ' Tw ' + num(r.tc) + ' Tc T* ' + (sp || '[] TJ');
      return body;
    }
    plans.forEach(function (p) {
      p.group.forEach(function (r, gi) {
        var s = r.s, e = r.e;
        if (gi === 0 && p.mode === 'inplace') {
          var strHex = hexOf(p.enc), comp = '';
          if (r.needAdv) {              // 뒤 글이 이어받는 자리: 너비 차이만큼 간격으로 맞춘다
            var na = 0, bpc = r.font.bpc; for (var ci = 0; ci + bpc <= p.enc.length; ci += bpc) { var cd = bpc === 2 ? (p.enc.charCodeAt(ci) << 8) | p.enc.charCodeAt(ci + 1) : p.enc.charCodeAt(ci); na += (fontWidth(r.font, cd) / 1000 * r.fsize + r.tc + ((bpc === 1 && cd === 32) ? r.tw : 0)) * r.th; }
            var dd = r.fsize * r.th; if (dd) comp = ' [' + num(-(r.adv - na) * 1000 / dd) + '] TJ';
          }
          if (r.kind === 'Tj') addRep(r, r.s, r.e, strHex + ' Tj' + comp);
          else if (r.kind === 'TJ') addRep(r, r.s, r.e, '[' + strHex + '] TJ' + comp);
          else addRep(r, r.extra.strTok.s, r.e, strHex + ' ' + r.kind + comp);
          report.inplace++;
        } else {
          addRep(r, r.s, r.e, removeCode(r));
          if (gi === 0 && p.mode === 'redraw') report.redrawn++; else if (gi === 0) report.deleted++;
        }
      });
      if (p.mode === 'redraw') draws.push(p);
    });
    // 쪽 단위·양식 단위별로 새 바이트
    var outUnits = [];
    rr.units.forEach(function (u) {
      var reps = replaces[u.key]; if (!reps || !reps.length) return;
      reps.sort(function (a, b) { return a.s - b.s; });
      var out = '', last = 0;
      reps.forEach(function (r) { out += u.src.slice(last, r.s) + r.t; last = r.e; });
      out += u.src.slice(last);
      // 지운 글을 그대로 베낀 ActualText 도 함께 비운다
      out = scrubActualText(out, report.oldTexts);
      outUnits.push({ u: u, src: out });
    });
    function toBytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
    outUnits.forEach(function (o) {
      var bytes = toBytes(o.src);
      if (o.u.key === 'P') {
        var st = ctx.flateStream(bytes), ref = ctx.register(st);
        page.node.set(N('Contents'), ref);
      } else {
        var old = o.u.stream.stream, plain = {};
        old.dict.entries().forEach(function (e) { var k = e[0].asString(); if (k !== '/Filter' && k !== '/DecodeParms' && k !== '/Length' && k !== '/DL') plain[k.slice(1)] = e[1]; });
        var ns = ctx.flateStream(bytes, plain);
        ctx.assign(o.u.stream.ref, ns);
      }
    });
    // 새 글 얹기
    var chain = Promise.resolve();
    if (draws.length) {
      chain = chain.then(function () { return doc.embedFont(L.StandardFonts.Helvetica); }).then(function (helv) {
        var seq = Promise.resolve();
        draws.forEach(function (p) {
          seq = seq.then(function () {
            var h = p.head, col = fillColor(L, h.fill), size = h.fsize * h.scale, ang = h.angle * 180 / Math.PI;
            if (/^[\x20-\x7E]*$/.test(p.text)) {
              page.drawText(p.text, { x: h.origin[0], y: h.origin[1], size: size, font: helv, color: col, rotate: L.degrees(ang) });
              return null;
            }
            if (!opts.textImage) throw new Error('한글 등을 그림으로 얹을 방법이 없습니다');
            return Promise.resolve(opts.textImage(p.text, size, colorHex(h.fill))).then(function (img) {
              return doc.embedPng(img.bytes).then(function (im) {
                var sa = Math.sin(h.angle), ca = Math.cos(h.angle), base = img.base != null ? img.base : (img.hpt / 2 - 0.32 * size);
                var bx = h.origin[0] + base * sa, by = h.origin[1] - base * ca;
                page.drawImage(im, { x: bx, y: by, width: img.wpt, height: img.hpt, rotate: L.degrees(ang) });
              });
            });
          });
        });
        return seq;
      });
    }
    return chain.then(function () { report.gcRemoved = gcUnreferenced(L, doc); report.plans = plans.map(function (p) { return { mode: p.mode, text: p.text, old: p.group.map(function (r) { return r.text; }) }; }); return report; });
  }
  function fillColor(L, f) {
    if (!f) return L.rgb(0, 0, 0);
    if (f.sp === 'g') return L.grayscale(f.v[0]);
    if (f.sp === 'rgb') return L.rgb(f.v[0], f.v[1], f.v[2]);
    if (f.sp === 'cmyk') return L.cmyk(f.v[0], f.v[1], f.v[2], f.v[3]);
    return L.rgb(0, 0, 0);
  }
  function colorHex(f) {
    var r = 0, g = 0, b = 0;
    if (f && f.sp === 'g') r = g = b = f.v[0]; else if (f && f.sp === 'rgb') { r = f.v[0]; g = f.v[1]; b = f.v[2]; }
    else if (f && f.sp === 'cmyk') { r = (1 - f.v[0]) * (1 - f.v[3]); g = (1 - f.v[1]) * (1 - f.v[3]); b = (1 - f.v[2]) * (1 - f.v[3]); }
    function h(x) { var s = Math.max(0, Math.min(255, Math.round(x * 255))).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + h(r) + h(g) + h(b);
  }
  function scrubActualText(src, olds) {
    if (!olds.length || src.indexOf('ActualText') < 0) return src;
    return src.replace(/\/ActualText\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/g, function (m, str) {
      var t = '';
      if (str.charAt(0) === '<') { var h = str.replace(/[<>\s]/g, ''); var b = ''; for (var i = 0; i + 1 < h.length; i += 2) b += String.fromCharCode(parseInt(h.substr(i, 2), 16)); t = b.charCodeAt(0) === 0xFE && b.charCodeAt(1) === 0xFF ? u16(b.slice(2)) : b; }
      else t = str.slice(1, -1);
      var hit = olds.some(function (o) { var k = String(o).trim(); return k && t.indexOf(k) >= 0; });
      return hit ? '' : m;
    });
  }


  // 어디서도 가리키지 않는 개체(바뀌기 전 옛 내용 스트림 등)를 파일에서 뺀다 — 안 빼면 지운 글이 파일 속에 그대로 남는다
  function gcUnreferenced(L, doc) {
    var c = doc.context, seen = {}, stack = [];
    ['Root', 'Info', 'Encrypt'].forEach(function (k) { var v = c.trailerInfo[k]; if (v) stack.push(v); });
    while (stack.length) {
      var o = stack.pop();
      if (o instanceof L.PDFRef) { var k2 = o.toString(); if (seen[k2]) continue; seen[k2] = 1; var t = c.lookup(o); if (t) stack.push(t); }
      else if (o instanceof L.PDFDict) { o.entries().forEach(function (e) { stack.push(e[1]); }); }
      else if (o instanceof L.PDFArray) { for (var i = 0; i < o.size(); i++) stack.push(o.get(i)); }
      else if (o instanceof L.PDFStream) { stack.push(o.dict); }
    }
    var n = 0;
    c.enumerateIndirectObjects().forEach(function (e) { if (!seen[e[0].toString()]) { c.delete(e[0]); n++; } });
    return n;
  }

  // ============================== 파일 안에 옛 글이 남았는지 훑기 ==============================
  function decodePdfString(L, s) {
    try { return s.decodeText(); } catch (e) { try { return s.asString(); } catch (e2) { return ''; } }
  }
  function scanLeaks(L, doc, oldTexts, pageIndex) {
    var needles = oldTexts.map(function (t) { return String(t).trim(); }).filter(function (t) { return t.length >= 2; });
    var found = [];
    if (!needles.length) return found;
    var ctx = doc.context, N = L.PDFName.of;
    function hit(t) { return needles.some(function (k) { return String(t).indexOf(k) >= 0; }); }
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var o = pair[1];
      if (o instanceof L.PDFRawStream && o.dict.get(N('Type')) === N('XRef')) return;
      var d = o instanceof L.PDFStream ? o.dict : o;
      if (d instanceof L.PDFDict) {
        d.entries().forEach(function (e) {
          var v = e[1]; if (v instanceof L.PDFRef) return;
          if (v instanceof L.PDFString || v instanceof L.PDFHexString) { var t = decodePdfString(L, v); if (t && hit(t)) found.push({ where: e[0].asString().replace(/^\//, ''), text: t.slice(0, 40) }); }
        });
      }
      // 글 명령 밖 글자열을 담은 배열(예: 책갈피 등)은 위 사전 항목으로 대부분 잡힌다. 내용 스트림은 아래에서 따로.
    });
    // 모든 스트림을 풀어 글자(영문·숫자는 그대로, UTF-16)가 통째로 남았는지
    ctx.enumerateIndirectObjects().forEach(function (pair) {
      var o = pair[1]; if (!(o instanceof L.PDFRawStream)) return;
      var sub = o.dict.get(N('Subtype')); if (sub === N('Image')) return;
      var bytes; try { bytes = L.decodePDFRawStream(o).decode(); } catch (e) { return; }
      if (!bytes || bytes.length > 8e6) return;
      var s = ''; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      needles.forEach(function (k) {
        var u = ''; for (var q = 0; q < k.length; q++) u += String.fromCharCode(k.charCodeAt(q) >> 8, k.charCodeAt(q) & 255);
        if (s.indexOf(k) >= 0 || s.indexOf(u) >= 0) found.push({ where: '파일 속 스트림 ' + pair[0].toString(), text: k.slice(0, 40) });
      });
    });
    // 쪽 내용(양식 개체 포함)에 글 명령으로 남았는지
    var pages = pageIndex == null ? doc.getPages().map(function (_, i) { return i; }) : [pageIndex];
    pages.forEach(function (i) {
      try { var rr = readRuns(L, doc, i); rr.runs.forEach(function (r) { if (hit(r.text)) found.push({ where: (i + 1) + '쪽 글', text: r.text.slice(0, 40) }); }); } catch (e) {}
    });
    return found;
  }

  var api = { gcUnreferenced: gcUnreferenced, lex: lex, loadFont: loadFont, readRuns: readRuns, applyEdits: applyEdits, scanLeaks: scanLeaks, scanDocFonts: scanDocFonts, encodeWith: encodeWith, parseToUnicode: parseToUnicode, scrubActualText: scrubActualText, colorHex: colorHex };
  global.SOPdfTextEdit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
