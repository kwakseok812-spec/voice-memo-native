/* so-docx-track.js — S-Office 워드 변경 기록(O-0861, v10.9): 글을 고칠 때 「삽입·삭제」 변경 내용으로 남기기 · 문단 넣기·지우기 기록 · 두 문서 비교(고른 문서와 다른 곳을 변경 내용으로 표시)
 * 워드의 「변경 내용 추적」과 같은 표시(<w:ins>·<w:del>)를 직접 쓴다. 글이 아닌 것(서식·표 구조·그림)은 비교·기록하지 않는다.
 * 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용). SODocxStruct(so-docx-struct.js)가 먼저 불러와져 있어야 한다.
 */
(function (global) {
  'use strict';
  var AUTHOR = 'S-Office';
  function ST() { return global.SODocxStruct; }
  function H() { return ST().H; }
  function nowIso() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  function nextRevId(xml) { var mx = 0; (xml.match(/\sw:id="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return mx + 1; }
  function mark(kind, id, date) { return '<w:' + kind + ' w:id="' + id + '" w:author="' + AUTHOR + '" w:date="' + date + '"'; }
  function runContent(text, del) {
    var tg = del ? 'w:delText' : 'w:t', out = '', buf = '';
    function flush() { if (buf) { out += '<' + tg + ' xml:space="preserve">' + H().esc(buf) + '</' + tg + '>'; buf = ''; } }
    for (var i = 0; i < text.length; i++) { var ch = text.charAt(i); if (ch === '\t') { flush(); out += '<w:tab/>'; } else if (ch === '\n') { flush(); out += '<w:br/>'; } else buf += ch; }
    flush(); return out;
  }
  var PARA_OK = { 'w:pPr': 1, 'w:r': 1, 'w:bookmarkStart': 1, 'w:bookmarkEnd': 1, 'w:proofErr': 1, 'w:permStart': 1, 'w:permEnd': 1, 'w:commentRangeStart': 1, 'w:commentRangeEnd': 1 };
  var RUN_SIMPLE = /^<w:r\b[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?(?:<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:t\b[^>]*\/>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>|<w:lastRenderedPageBreak\s*\/>)*<\/w:r>$/;
  // 문단 하나(원문 조각)를 살핀다 → { self, complex, runs:[{s,e,open,rpr,text,simple}], text, headEnd }
  function paraInfo(pStr) {
    var head = /^<w:p\b[^>]*?>/.exec(pStr)[0], self = /\/>$/.test(head);
    if (self) return { self: true, complex: false, runs: [], text: '', headEnd: head.length };
    var kids = H().kidsOf(pStr, head.length, pStr.length - 6), runs = [], complex = false, ST_ = ST();
    kids.forEach(function (k) {
      if (!PARA_OK[k.name]) { complex = true; return; }
      if (k.name !== 'w:r') return;
      var rs = pStr.slice(k.s, k.e), simple = RUN_SIMPLE.test(rs), open = /^<w:r\b[^>]*>/.exec(rs)[0], rp = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(rs);
      var text = simple ? ST_.pText(rs) : (/<w:t[\s>]/.test(rs) ? null : '');
      runs.push({ s: k.s, e: k.e, open: open, rpr: simple && rp ? rp[0] : '', text: text, simple: simple });
    });
    var bad = runs.some(function (r) { return r.text === null; });
    var tr = runs.filter(function (r) { return r.text; });
    return { self: false, complex: complex || bad, runs: tr, allRuns: runs, text: tr.map(function (r) { return r.text; }).join(''), headEnd: head.length };
  }

  // ---------------------------------------------------------------- 낱말 단위 차이(앞뒤 공통 부분을 뺀 뒤 낱말 조각 LCS). [{p(옛 글 위치), del(지울 글자 수), ins(넣을 글)}]
  function tokens(s) { return s.match(/\s+|[A-Za-z0-9_]+|[가-힣]+|[^\sA-Za-z0-9_가-힣]/gu) || []; }
  function diffHunks(a, b) {
    if (a === b) return [];
    var A = tokens(a), B = tokens(b), n = A.length, m = B.length, i, j;
    var pre = 0; while (pre < n && pre < m && A[pre] === B[pre]) pre++;
    var suf = 0; while (suf < n - pre && suf < m - pre && A[n - 1 - suf] === B[m - 1 - suf]) suf++;
    var a2 = A.slice(pre, n - suf), b2 = B.slice(pre, m - suf), na = a2.length, nb = b2.length, off = 0;
    for (i = 0; i < pre; i++) off += A[i].length;
    var ops = [];                                      // 조각 단위 {t:'=',s}/{t:'-',s}/{t:'+',s}
    if (na * nb > 3000000 || !na || !nb) { if (na) ops.push({ t: '-', s: a2.join('') }); if (nb) ops.push({ t: '+', s: b2.join('') }); }
    else {
      var w = nb + 1, dp = new Uint16Array((na + 1) * w);
      for (i = na - 1; i >= 0; i--) for (j = nb - 1; j >= 0; j--) dp[i * w + j] = a2[i] === b2[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      i = 0; j = 0;
      while (i < na || j < nb) {
        if (i < na && j < nb && a2[i] === b2[j]) { ops.push({ t: '=', s: a2[i] }); i++; j++; }
        else if (j < nb && (i >= na || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) { ops.push({ t: '+', s: b2[j] }); j++; }
        else { ops.push({ t: '-', s: a2[i] }); i++; }
      }
    }
    var hs = [], cur = null, pos = off;
    ops.forEach(function (o) {
      if (o.t === '=') { if (cur) { hs.push(cur); cur = null; } pos += o.s.length; return; }
      if (!cur) cur = { p: pos, del: 0, ins: '' };
      if (o.t === '-') { cur.del += o.s.length; pos += o.s.length; } else cur.ins += o.s;
    });
    if (cur) hs.push(cur);
    // 사이가 공백 하나뿐인 조각은 하나로 합친다(자잘하게 쪼개지지 않게)
    var out = [];
    hs.forEach(function (h) { var prev = out[out.length - 1]; if (prev && h.p - (prev.p + prev.del) <= 1) { var gap = a.slice(prev.p + prev.del, h.p); prev.del += gap.length + h.del; prev.ins += gap + h.ins; } else out.push({ p: h.p, del: h.del, ins: h.ins }); });
    return out;
  }

  // ---------------------------------------------------------------- 글 고치기를 변경 내용으로 남긴다. 반환 { p: 새 문단 원문, nid } | { err }
  function trackText(pStr, newText, id0, date) {
    newText = String(newText).replace(/\r\n?/g, '\n');
    var info = paraInfo(pStr); if (info.complex) return { err: '링크·필드·수식 같은 특수한 것이 든 문단은 변경 기록으로 고칠 수 없습니다.' };
    var old = info.text; if (old === newText) return { p: pStr, nid: id0 };
    var id = id0;
    function ins(rOpen, rpr, t) { return mark('ins', id++, date) + '><w:r' + rOpen.replace(/^<w:r/, '').replace(/>$/, '') + '>' + rpr + runContent(t, false) + '</w:r></w:ins>'; }
    function del(rOpen, rpr, t) { return mark('del', id++, date) + '><w:r' + rOpen.replace(/^<w:r/, '').replace(/>$/, '') + '>' + rpr + runContent(t, true) + '</w:r></w:del>'; }
    function keep(rOpen, rpr, t) { return rOpen + rpr + runContent(t, false) + '</w:r>'; }
    if (!info.runs.length) {                                 // 글이 한 글자도 없던 문단 → 끝에 삽입 하나
      var pm = /<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/.exec(pStr), rp0 = pm ? pm[1].replace(/<w:(ins|del)\b[^>]*\/>/g, '') : '';
      var mk = ins('<w:r>', rp0, newText);
      if (info.self) return { p: pStr.replace(/\s*\/>\s*$/, '>') + mk + '</w:p>', nid: id };
      var ci = pStr.lastIndexOf('</w:p>'); return { p: pStr.slice(0, ci) + mk + pStr.slice(ci), nid: id };
    }
    var hs = diffHunks(old, newText), runs = info.runs, off = 0;
    runs.forEach(function (r) { r.a = off; off += r.text.length; r.b = off; r.ev = []; });
    hs.forEach(function (h) {
      var end = h.p + h.del, target = -1, i;
      for (i = 0; i < runs.length; i++) if (h.p >= runs[i].a && h.p < runs[i].b) { target = i; break; }
      if (target < 0) target = runs.length - 1;
      else if (h.del === 0 && runs[target].a === h.p && target > 0) target = target - 1;      // 끼워 넣기만 하면 앞 글자의 모양을 따른다
      var insDone = false;
      for (i = 0; i < runs.length; i++) {
        var r = runs[i], ca = Math.max(r.a, h.p), cb = Math.min(r.b, end);
        if (cb > ca) { var e = { pos: ca - r.a, len: cb - ca, ins: '' }; if (i === target && !insDone) { e.ins = h.ins; insDone = true; } r.ev.push(e); }
      }
      if (!insDone && h.ins) { var tr = runs[target], at = h.p <= tr.a ? 0 : Math.min(tr.text.length, h.p - tr.a); if (h.p >= tr.b) at = tr.text.length; tr.ev.push({ pos: at, len: 0, ins: h.ins }); }
    });
    var rep = [];                                            // 런별 바꿔 넣을 조각
    runs.forEach(function (r) {
      if (!r.ev.length) return;
      r.ev.sort(function (x, y) { return x.pos - y.pos; });
      var out = '', cur = 0, t = r.text;
      r.ev.forEach(function (e) {
        if (e.pos > cur) out += keep(r.open, r.rpr, t.slice(cur, e.pos));
        if (e.len) out += del(r.open, r.rpr, t.slice(e.pos, e.pos + e.len));
        if (e.ins) out += ins(r.open, r.rpr, e.ins);
        cur = Math.max(cur, e.pos + e.len);
      });
      if (cur < t.length) out += keep(r.open, r.rpr, t.slice(cur));
      rep.push({ s: r.s, e: r.e, x: out });
    });
    var res = pStr; rep.sort(function (a, b) { return b.s - a.s; }).forEach(function (q) { res = res.slice(0, q.s) + q.x + res.slice(q.e); });
    return { p: res, nid: id };
  }
  // xi 번 문단의 글을 새 글로(변경 기록)
  function trackParaText(xml, xi, newText) {
    var ps = ST().paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    var r = trackText(xml.slice(p.s, p.e), newText, nextRevId(xml), nowIso()); if (r.err) return r;
    return { xml: xml.slice(0, p.s) + r.p + xml.slice(p.e) };
  }
  // 여러 문단 한꺼번에: edits = { xi: 새 글 }
  function trackParaTexts(xml, edits) {
    var ps = ST().paras(xml), id = nextRevId(xml), date = nowIso(), out = xml, done = 0, skipped = 0;
    Object.keys(edits).map(Number).sort(function (a, b) { return b - a; }).forEach(function (xi) {
      var p = ps[xi]; if (!p) return; var r = trackText(xml.slice(p.s, p.e), edits[xi], id, date);
      if (r.err) { skipped++; return; } id = r.nid; out = out.slice(0, p.s) + r.p + out.slice(p.e); done++;
    });
    return { xml: out, done: done, skipped: skipped };
  }

  // ---------------------------------------------------------------- 문단 표시 바꾸기(문단 부호의 삽입·삭제 표시)
  function markParaMark(pStr, kind, id, date) {
    var tag = mark(kind, id, date) + '/>';
    if (/^<w:p\b[^>]*\/>$/.test(pStr)) pStr = pStr.replace(/\s*\/>$/, '></w:p>');
    var pp = H().pPrOf(pStr);
    if (!pp.xml) return pStr.slice(0, pp.s) + '<w:pPr><w:rPr>' + tag + '</w:rPr></w:pPr>' + pStr.slice(pp.s);
    var ppr = pp.xml, nx = /<w:rPr>/.test(ppr) ? ppr.replace(/<w:rPr>/, '<w:rPr>' + tag) : (H().setProp(ppr, 'w:pPr', H().PPR_ORDER, 'rPr', '<w:rPr>' + tag + '</w:rPr>') || ppr);
    return pStr.slice(0, pp.s) + nx + pStr.slice(pp.e);
  }
  // 문단 a..b 를 지운 것으로 표시(글이 아니라 「삭제」 변경으로 남김). 표 안 문단은 칸이 비어 버리므로 글만 지운 것으로 표시한다
  function trackDeleteParas(xml, a, b) {
    var ps = ST().paras(xml), id = nextRevId(xml), date = nowIso(), out = xml, i, partial = 0, none = 0;
    for (i = b; i >= a; i--) {
      var p = ps[i]; if (!p) continue; var pStr = xml.slice(p.s, p.e), info = paraInfo(pStr);
      if (info.complex) return { err: '링크·필드·수식 같은 특수한 것이 든 문단은 변경 기록으로 지울 수 없습니다.' };
      var inCell = p.anc.indexOf('w:tc') >= 0;
      if (info.self) { if (inCell) { none++; continue; } out = out.slice(0, p.s) + markParaMark(pStr, 'del', id++, date) + out.slice(p.e); continue; }
      var res = pStr, runs = (info.allRuns || []).slice().sort(function (x, y) { return y.s - x.s; });
      runs.forEach(function (r) {
        var rs = res.slice(r.s, r.e).replace(/<w:t(\s[^>]*)?>/g, function (m0, at) { return '<w:delText' + (at || '') + '>'; }).replace(/<\/w:t>/g, '</w:delText>').replace(/<w:t(\s[^>]*)?\/>/g, '<w:delText xml:space="preserve"/>');
        res = res.slice(0, r.s) + mark('del', id++, date) + '>' + rs + '</w:del>' + res.slice(r.e);
      });
      if (!inCell) res = markParaMark(res, 'del', id++, date); else partial++;
      out = out.slice(0, p.s) + res + out.slice(p.e);
    }
    return { xml: out, partial: partial };
  }
  // xi 번 문단 위·아래에 「삽입」으로 표시한 새 문단(글이 있으면 글까지)
  function trackInsertPara(xml, xi, text, after) {
    var ps = ST().paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    var id = nextRevId(xml), date = nowIso(), np = '<w:p>', ins = text ? mark('ins', id + 1, date) + '><w:r>' + runContent(text, false) + '</w:r></w:ins>' : '';
    np = markParaMark('<w:p></w:p>', 'ins', id, date).replace('</w:p>', ins + '</w:p>');
    var at = after ? p.e : p.s;
    return { xml: xml.slice(0, at) + np + xml.slice(at), newXi: after ? xi + 1 : xi };
  }

  // ---------------------------------------------------------------- 두 문서 비교 — baseXml 위에 otherXml 과 다른 곳을 변경 내용으로 표시한다(글만)
  function plainText(xml, p) { return ST().pText(xml.slice(p.s, p.e).replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')); }
  function normKey(t) { return t.replace(/\s+/g, ' ').trim(); }
  function compare(baseXml, otherXml, opt) {
    opt = opt || {};
    if (/<w:(ins|del|moveFrom|moveTo)[\s>\/]/.test(baseXml)) return { err: '이 문서에는 아직 처리하지 않은 변경 내용이 있습니다. 「검토」에서 모두 수락하거나 거절한 뒤에 비교해 주십시오.' };
    if (/<w:(ins|del|moveFrom|moveTo)[\s>\/]/.test(otherXml)) return { err: '고른 문서에 처리하지 않은 변경 내용이 있습니다. 워드에서 변경 내용을 모두 처리한 파일을 골라 주십시오.' };
    var pa = ST().paras(baseXml), pb = ST().paras(otherXml), A = [], B = [];
    pa.forEach(function (p, i) { if (p.anc.indexOf('w:txbxContent') >= 0) return; var k = normKey(plainText(baseXml, p)); if (k) A.push({ i: i, k: k }); });
    pb.forEach(function (p, j) { if (p.anc.indexOf('w:txbxContent') >= 0) return; var k = normKey(plainText(otherXml, p)); if (k) B.push({ j: j, k: k }); });
    var n = A.length, m = B.length, i, j;
    if (n * m > 25000000) return { err: '문서가 너무 길어 폰에서 비교하지 못합니다(문단 ' + n + '개 × ' + m + '개).' };
    // 문단 LCS
    var w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i * w + j] = A[i].k === B[j].k ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    var pairs = [], ai = 0, bj = 0;                          // 같은 문단 짝
    while (ai < n && bj < m) { if (A[ai].k === B[bj].k) { pairs.push([ai, bj]); ai++; bj++; } else if (dp[(ai + 1) * w + bj] >= dp[ai * w + bj + 1]) ai++; else bj++; }
    pairs.push([n, m]);
    var changes = [], dels = [], inss = [], lastA = -1, lastB = -1;
    pairs.forEach(function (pr) {
      var D = [], I = [], x, y; for (x = lastA + 1; x < pr[0]; x++) D.push(x); for (y = lastB + 1; y < pr[1]; y++) I.push(y);
      var k = Math.min(D.length, I.length);
      for (x = 0; x < k; x++) changes.push({ bi: A[D[x]].i, oj: B[I[x]].j });
      for (x = k; x < D.length; x++) dels.push(A[D[x]].i);
      if (I.length > k) inss.push({ after: lastA >= 0 ? A[lastA].i : -1, js: I.slice(k).map(function (q) { return B[q].j; }) });
      lastA = pr[0]; lastB = pr[1];
    });
    var stats = { changed: 0, deleted: 0, inserted: 0, skipped: [] }, id = nextRevId(baseXml), date = nowIso(), ops = [];
    changes.forEach(function (c) { ops.push({ at: c.bi, kind: 'chg', c: c }); });
    dels.forEach(function (d) { ops.push({ at: d, kind: 'del' }); });
    inss.forEach(function (q) { ops.push({ at: q.after + 0.5, kind: 'ins', q: q }); });
    ops.sort(function (x, y) { return y.at - x.at; });
    var out = baseXml, styleIds = opt.styleIds || null;
    ops.forEach(function (o) {
      var ps = ST().paras(out);                              // 뒤쪽 문단부터 고치므로 앞쪽 번호는 그대로지만, 위치(s·e)는 새로 얻는다
      if (o.kind === 'chg') {
        var p = ps[o.at], t = plainText(otherXml, pb[o.c.oj]), r = trackText(out.slice(p.s, p.e), t.replace(/\r?\n/g, '\n'), id, date);
        if (r.err) { stats.skipped.push('문단 ' + (o.at + 1) + ': ' + r.err); return; } id = r.nid; out = out.slice(0, p.s) + r.p + out.slice(p.e); stats.changed++;
      } else if (o.kind === 'del') {
        var p2 = ps[o.at], pstr = out.slice(p2.s, p2.e), inf = paraInfo(pstr);
        if (inf.complex) { stats.skipped.push('문단 ' + (o.at + 1) + '(지운 문단): 링크·필드 등이 든 문단이라 표시하지 못함'); return; }
        var inCell = p2.anc.indexOf('w:tc') >= 0, rr = inCell ? trackText(pstr, '', id, date) : null, res;
        if (inCell) { if (rr.err) { stats.skipped.push('문단 ' + (o.at + 1) + ': ' + rr.err); return; } id = rr.nid; res = rr.p; }
        else { var dd = trackDeleteParas(out, o.at, o.at); if (dd.err) { stats.skipped.push('문단 ' + (o.at + 1) + ': ' + dd.err); return; } out = dd.xml; id = nextRevId(out); stats.deleted++; return; }
        out = out.slice(0, p2.s) + res + out.slice(p2.e); stats.deleted++;
      } else {
        var after = o.q.after, anchor = after >= 0 ? ps[after] : ps[0];
        if (!anchor) { stats.skipped.push('새 문단 ' + o.q.js.length + '개: 붙일 자리를 찾지 못함'); return; }
        if (anchor.anc.indexOf('w:tc') >= 0) { stats.skipped.push('표 안쪽 다음에 있는 새 문단 ' + o.q.js.length + '개는 표시하지 못함'); return; }
        var xmlIns = '';
        o.q.js.forEach(function (j) {
          var txt = plainText(otherXml, pb[j]).replace(/\r?\n/g, '\n'), sty = (/<w:pStyle\s+w:val="([^"]*)"/.exec(otherXml.slice(pb[j].s, pb[j].e)) || [])[1], np = markParaMark('<w:p></w:p>', 'ins', id++, date);
          if (sty && styleIds && styleIds[sty]) np = np.replace('<w:pPr>', '<w:pPr><w:pStyle w:val="' + sty + '"/>');
          xmlIns += np.replace('</w:p>', mark('ins', id++, date) + '><w:r>' + runContent(txt, false) + '</w:r></w:ins></w:p>'); stats.inserted++;
        });
        var at = after >= 0 ? anchor.e : anchor.s; out = out.slice(0, at) + xmlIns + out.slice(at);
      }
    });
    return { xml: out, stats: stats };
  }

  global.SODocxTrack = { AUTHOR: AUTHOR, diffHunks: diffHunks, trackText: trackText, trackParaText: trackParaText, trackParaTexts: trackParaTexts, trackDeleteParas: trackDeleteParas, trackInsertPara: trackInsertPara, compare: compare, paraInfo: paraInfo, nextRevId: nextRevId };
})(typeof window !== 'undefined' ? window : globalThis);
