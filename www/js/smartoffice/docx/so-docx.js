/* so-docx.js — S-Office 워드(.docx) 보기 + 글자 고치기.
 * 출처: docx-preview 0.4.1 (Apache-2.0, https://github.com/VolodymyrBaydalka/docxjs, Volodymyr Baydalka) — 보기
 *      JSZip 3.10.2 (MIT 선택, https://github.com/Stuk/jszip) — 압축 풀기·묶기
 *      고치는 방식(고친 문단만 원본 XML 에 끼워 넣고 나머지는 그대로 둔다)의 철학은 오픈소스 이음오피스 docx-engine(Apache-2.0)에서 배웠고,
 *      코드는 이 앱에서 새로 썼다(소스를 복사하지 않음).
 * 고치기: 본문·표 칸 안의 "글자만 있는" 문단의 글을 고친다. 고친 글자 조각만 해당 <w:t> 에 넣고 나머지 XML·그림·스타일·번호·머리글·바닥글·각주는 그대로 둔다.
 *         그림/도형/텍스트상자/필드/링크/각주 표시/변경 추적이 든 문단과 암호·보호 문서는 보기만 된다. .doc(옛 형식)는 열 수 없어 ①로 보낸다. */
(function () {
  'use strict';

  // ============================================================ 순수 XML 도구 (화면과 무관)
  var TAG_SRC = '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|<(\\/?)([^\\s\\/>]+)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(\\/?)>';
  function tagRe() { return new RegExp(TAG_SRC, 'g'); }

  function unesc(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'";
      var n = g.charAt(1) === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (e) { return ''; }
    });
  }
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function norm(s) { return String(s || '').replace(/[\s​ ﻿]/g, ''); }

  // document.xml 에서 맨 바깥 <w:p> 의 위치 목록 {s,e,anc}. (텍스트상자 안 문단은 바깥 문단 안에 있으므로 따로 세지 않는다)
  function scanParagraphs(xml) {
    var re = tagRe(), m, stack = [], paras = [];
    while ((m = re.exec(xml))) {
      if (!m[2]) continue;
      var name = m[2], isClose = !!m[1], isSelf = !!m[4];
      if (isClose) { var top = stack.pop(); if (top && top.para) top.para.e = re.lastIndex; continue; }
      var node = { name: name };
      if (name === 'w:p') {
        var outer = false; for (var i = 0; i < stack.length; i++) if (stack[i].name === 'w:p') { outer = true; break; }
        if (!outer) {
          var para = { s: m.index, e: isSelf ? re.lastIndex : null, anc: stack.map(function (n) { return n.name; }) };
          paras.push(para); if (!isSelf) node.para = para;
        }
      }
      if (!isSelf) stack.push(node);
    }
    return paras;
  }

  var OK_ANC = { 'w:document': 1, 'w:body': 1, 'w:tbl': 1, 'w:tr': 1, 'w:tc': 1 };
  var PIC = { 'w:drawing': 1, 'w:pict': 1, 'w:object': 1, 'mc:AlternateContent': 1, 'w:txbxContent': 1, 'v:shape': 1, 'wp:anchor': 1, 'wp:inline': 1 };
  var FLD = { 'w:fldChar': 1, 'w:instrText': 1, 'w:fldSimple': 1, 'w:delInstrText': 1 };
  var REV = { 'w:ins': 1, 'w:del': 1, 'w:moveFrom': 1, 'w:moveTo': 1 };
  var NOTE = { 'w:footnoteReference': 1, 'w:endnoteReference': 1, 'w:commentReference': 1, 'w:annotationRef': 1 };
  var P_OK = { 'w:pPr': 1, 'w:r': 1, 'w:bookmarkStart': 1, 'w:bookmarkEnd': 1, 'w:proofErr': 1, 'w:permStart': 1, 'w:permEnd': 1, 'w:commentRangeStart': 1, 'w:commentRangeEnd': 1 };
  var R_OK = { 'w:rPr': 1, 'w:t': 1, 'w:tab': 1, 'w:br': 1, 'w:cr': 1, 'w:lastRenderedPageBreak': 1 };
  var REASON = {
    pic: '그림·도형·텍스트상자가 들어 있어 보기만 됩니다.',
    fld: '쪽 번호·목차 같은 자동 필드가 들어 있어 보기만 됩니다.',
    link: '링크가 들어 있어 보기만 됩니다.',
    rev: '변경 추적(고친 흔적)이 들어 있어 보기만 됩니다.',
    note: '각주·주석 표시가 들어 있어 보기만 됩니다.',
    struct: '이 위치의 문단(콘텐츠 컨트롤 등)은 보기만 됩니다.',
    other: '특수 요소가 들어 있어 보기만 됩니다.',
    dup: '같은 글이 여러 곳에 있어 어느 문단인지 확실하지 않아 보기만 됩니다.',
    nomatch: '화면에 그려진 문단과 짝을 확실히 맞추지 못해 보기만 됩니다.'
  };

  // 문단 하나(원문 조각)를 분석 → { ok, reason, text, runs:[{s,e,open,rpr,text}] }
  function analyze(pStr) {
    var re = tagRe(), m, stack = [], runs = [], cur = null, reason = null;
    var skipDepth = -1, tOpen = null;
    function bad(r) { if (!reason) reason = r; }
    while ((m = re.exec(pStr))) {
      if (!m[2]) continue;
      var name = m[2], isClose = !!m[1], isSelf = !!m[4], depth = stack.length;   // 문단 자체가 depth 0 에서 열린 뒤 자식은 depth 1
      if (PIC[name]) bad('pic'); else if (FLD[name]) bad('fld'); else if (REV[name]) bad('rev'); else if (NOTE[name]) bad('note');
      if (isClose) {
        var top = stack.pop();
        if (skipDepth >= 0 && stack.length === skipDepth) skipDepth = -1;
        if (name === 'w:t' && tOpen && cur) { cur.items.push({ t: unesc(pStr.slice(tOpen, m.index)) }); tOpen = null; }
        if (name === 'w:r' && cur && top && top.run) { cur.e = re.lastIndex; cur = null; }
        continue;
      }
      if (skipDepth >= 0) { if (!isSelf) stack.push({ name: name }); continue; }
      if (depth === 0) {                        // <w:p>
        if (!isSelf) stack.push({ name: name });
        continue;
      }
      if (depth === 1) {                        // p 의 자식
        if (name === 'w:hyperlink') bad('link');
        else if (!P_OK[name] && !PIC[name] && !FLD[name] && !REV[name]) bad(name === 'w:sdt' ? 'struct' : 'other');
        if (name === 'w:pPr' || name === 'w:rPr') { if (!isSelf) { skipDepth = depth; stack.push({ name: name }); } continue; }
        if (name === 'w:r') {
          var run = { s: m.index, e: null, open: m[0], openEnd: re.lastIndex, rprS: -1, rprE: -1, items: [], text: '' };
          if (isSelf) { run.e = re.lastIndex; } else { cur = run; runs.push(run); stack.push({ name: name, run: run }); }
          continue;
        }
        if (!isSelf) stack.push({ name: name });
        continue;
      }
      if (depth === 2 && cur && stack[1] && stack[1].run === cur) {   // 런의 자식
        if (!R_OK[name] && !PIC[name] && !FLD[name] && !NOTE[name]) bad('other');
        if (name === 'w:rPr') { cur.rprS = m.index; if (!isSelf) { skipDepth = depth; stack.push({ name: name, rpr: true }); } else { cur.rprE = re.lastIndex; } continue; }
        if (name === 'w:t') { if (isSelf) cur.items.push({ t: '' }); else { tOpen = re.lastIndex; stack.push({ name: name }); } continue; }
        if (name === 'w:tab') { cur.items.push({ t: '\t' }); }
        else if (name === 'w:br') { if (/w:type\s*=\s*["'](page|column)["']/.test(m[3])) bad('other'); cur.items.push({ t: '\n' }); }
        else if (name === 'w:cr') { cur.items.push({ t: '\n' }); }
        if (!isSelf) stack.push({ name: name });
        continue;
      }
      if (!isSelf) stack.push({ name: name });
    }
    runs.forEach(function (r) {
      if (r.rprS >= 0 && r.rprE < 0) { var cl = pStr.indexOf('</w:rPr>', r.rprS); r.rprE = cl < 0 ? -1 : cl + 8; }
      r.rpr = r.rprS >= 0 && r.rprE > 0 ? pStr.slice(r.rprS, r.rprE) : '';
      r.text = r.items.map(function (x) { return x.t; }).join('');
    });
    var tr = runs.filter(function (r) { return r.items.length > 0; });
    return { ok: !reason, reason: reason, runs: tr, text: tr.map(function (r) { return r.text; }).join(''), self: /\/>\s*$/.test(pStr.slice(0, pStr.indexOf('>') + 1)) };
  }

  function runContent(text) {
    var out = '', buf = '';
    function flush() { if (buf) { out += '<w:t xml:space="preserve">' + esc(buf) + '</w:t>'; buf = ''; } }
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '\t') { flush(); out += '<w:tab/>'; } else if (ch === '\n') { flush(); out += '<w:br/>'; } else buf += ch;
    }
    flush(); return out;
  }

  // 옛 글 → 새 글의 바뀐 조각 목록 [{p(옛 글 위치), del(지울 글자 수), ins(넣을 글)}]. 글자 단위 LCS, 너무 길면 앞뒤 공통부분만 빼고 한 조각.
  function diffHunks(a, b) {
    var minL = Math.min(a.length, b.length), pre = 0, suf = 0, i, j;
    while (pre < minL && a.charAt(pre) === b.charAt(pre)) pre++;
    while (suf < minL - pre && a.charAt(a.length - 1 - suf) === b.charAt(b.length - 1 - suf)) suf++;
    if (pre > 0 && /[\uD800-\uDBFF]/.test(a.charAt(pre - 1))) pre--;
    if (suf > 0 && /[\uDC00-\uDFFF]/.test(a.charAt(a.length - suf))) suf--;
    var A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf), n = A.length, m = B.length;
    if (!n && !m) return [];
    if (!n || !m || n * m > 4000000) return [{ p: pre, del: n, ins: B }];
    var w = m + 1, dp = new Uint16Array((n + 1) * w);
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i * w + j] = A.charAt(i) === B.charAt(j) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    var hs = [], cur = null; i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A.charAt(i) === B.charAt(j)) { if (cur) { hs.push(cur); cur = null; } i++; j++; }
      else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) { if (!cur) cur = { p: pre + i, del: 0, ins: '' }; cur.ins += B.charAt(j); j++; }
      else { if (!cur) cur = { p: pre + i, del: 0, ins: '' }; cur.del++; i++; }
    }
    if (cur) hs.push(cur);
    var out = [];
    hs.forEach(function (h) {                 // 사이가 2글자 이하인 조각은 하나로 합친다(자잘하게 쪼개지지 않게)
      var prev = out[out.length - 1];
      if (prev && h.p - (prev.p + prev.del) <= 2) { var gap = a.slice(prev.p + prev.del, h.p); prev.del += gap.length + h.del; prev.ins += gap + h.ins; }
      else out.push({ p: h.p, del: h.del, ins: h.ins });
    });
    return out;
  }

  // 문단 원문 조각 + 새 글 → 고친 문단 조각. 바뀐 글자 조각만 해당 런에 넣고 다른 런은 그대로 둔다.
  function rebuildParagraph(pStr, a, newText) {
    newText = String(newText).replace(/\r\n?/g, '\n');
    var oldText = a.text;
    if (oldText === newText) return pStr;
    if (!a.runs.length) {                     // 글자가 한 개도 없던 문단 → 끝에 런 하나를 넣는다
      var pm = /<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/.exec(pStr);
      var mk = '<w:r>' + (pm ? pm[1] : '') + runContent(newText) + '</w:r>';
      if (a.self) return pStr.replace(/\s*\/>\s*$/, '>') + mk + '</w:p>';
      var ci = pStr.lastIndexOf('</w:p>');
      return pStr.slice(0, ci) + mk + pStr.slice(ci);
    }
    var texts = a.runs.map(function (r) { return r.text; }), i, hs = diffHunks(oldText, newText);
    for (var h = hs.length - 1; h >= 0; h--) {          // 뒤쪽 조각부터 적용하면 앞쪽 위치가 변하지 않는다
      var p = hs[h].p, delEnd = p + hs[h].del, ins = hs[h].ins;
      var off = 0, ranges = texts.map(function (t) { var o = { a: off, b: off + t.length }; off = o.b; return o; });
      var target = -1;
      for (i = 0; i < ranges.length; i++) if (p >= ranges[i].a && p < ranges[i].b) { target = i; break; }
      if (target < 0 || (delEnd === p && ranges[target].a === p && target > 0)) {   // 끼워 넣기만 하는 경우 앞 런의 모양을 따른다
        if (target > 0) target = target - 1; else if (target < 0) target = ranges.length - 1;
      }
      for (i = 0; i < texts.length; i++) {
        var ra = ranges[i], t = texts[i];
        var cutA = Math.max(ra.a, p), cutB = Math.min(ra.b, delEnd);
        if (cutB > cutA) t = t.slice(0, cutA - ra.a) + t.slice(cutB - ra.a);
        if (i === target) { var at = Math.max(0, Math.min(t.length, p - ra.a)); t = t.slice(0, at) + ins + t.slice(at); }
        texts[i] = t;
      }
    }
    var changed = {}, news = texts;
    news.forEach(function (t, idx) { if (t !== a.runs[idx].text) changed[idx] = true; });
    // 뒤에서부터 바뀐 런만 갈아 끼운다
    var out = pStr;
    for (i = a.runs.length - 1; i >= 0; i--) {
      if (!changed[i]) continue;
      var r = a.runs[i];
      var rep = r.open + (r.rpr || '') + runContent(news[i]) + '</w:r>';
      out = out.slice(0, r.s) + rep + out.slice(r.e);
    }
    return out;
  }

  // document.xml 문자열 전체를 분석: { paras:[{s,e,a,editable,reason,text}], global: 사유|null }
  function analyzeDoc(xml, settingsXml) {
    var g = null;
    if (/<w:(ins|del|moveFrom|moveTo)[\s>\/]/.test(xml) || (settingsXml && /<w:trackRevisions[\s\/>]/.test(settingsXml))) g = '변경 추적(고친 흔적)이 있는 문서라 보기만 됩니다.';
    else if (settingsXml && /<w:documentProtection[^>]*w:enforcement\s*=\s*["'](1|true|on)["']/.test(settingsXml)) g = '편집이 제한(보호)된 문서라 보기만 됩니다.';
    else if (/<w:altChunk[\s\/>]/.test(xml)) g = '다른 문서가 끼워진(altChunk) 문서라 보기만 됩니다.';
    var raw = scanParagraphs(xml), paras = [];
    raw.forEach(function (p) {
      if (p.e == null) return;
      var str = xml.slice(p.s, p.e), a = analyze(str), reason = a.reason;
      var struct = p.anc.some(function (n) { return !OK_ANC[n]; });
      if (!reason && struct) reason = 'struct';
      paras.push({ s: p.s, e: p.e, a: a, text: a.text, norm: norm(a.text), reason: reason, editable: !reason, mixed: mixedFormat(a) });
    });
    return { paras: paras, global: g };
  }
  function mixedFormat(a) { var seen = {}, n = 0; a.runs.forEach(function (r) { if (r.text && !seen[r.rpr]) { seen[r.rpr] = 1; n++; } }); return n > 1; }

  // 화면에 그려진 문단(R)과 XML 문단(X)을 짝짓는다. 반환: X 인덱스 → R 인덱스(-1 = 짝 없음)
  function align(X, Rnorm) {
    var map = [], i, j, lock = X.length === Rnorm.length;
    if (lock) for (i = 0; i < X.length; i++) if (X[i].editable && X[i].norm !== Rnorm[i]) { lock = false; break; }   // 못 고치는 문단은 글이 일부만 읽혀 달라도 된다
    if (lock) { for (i = 0; i < X.length; i++) map.push(i); return { map: map, exact: true }; }
    j = 0;
    for (i = 0; i < X.length; i++) {
      map.push(-1);
      if (!X[i].norm) continue;
      for (var k = j; k < Math.min(Rnorm.length, j + 12); k++) if (Rnorm[k] === X[i].norm) { map[i] = k; j = k + 1; break; }
    }
    return { map: map, exact: false };
  }

  // 편집 목록을 document.xml 에 적용
  function applyEdits(xml, doc, edits) {   // edits: { xIndex: newText }
    var idx = Object.keys(edits).map(Number).sort(function (a, b) { return b - a; });
    var out = xml;
    idx.forEach(function (i) {
      var p = doc.paras[i], str = xml.slice(p.s, p.e);
      out = out.slice(0, p.s) + rebuildParagraph(str, p.a, edits[i]) + out.slice(p.e);
    });
    return out;
  }

  // ============================================================ 화면
  var wrap = null, scale = 1, fit = 1, pageW = 794, ctxRef = null, cleanup = [];
  var S = null;   // 고치기 상태

  function applyScale() {
    scale = Math.max(0.3, Math.min(4, scale));
    if (wrap) wrap.style.zoom = String(scale);
    var lab = document.getElementById('soDocxZoomLab'); if (lab) lab.textContent = Math.round(scale * 100) + '%';
  }
  function measure(host) {
    var pg = wrap && wrap.querySelector('section.docx');
    pageW = pg ? pg.getBoundingClientRect().width / (wrap.style.zoom ? Number(wrap.style.zoom) || 1 : 1) : 794;
    if (!pageW || pageW < 100) pageW = 794;
    fit = Math.max(0.3, (host.clientWidth - 8) / pageW);
  }
  function setupPinch(host) {
    var d0 = 0, s0 = 1;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    function ts(e) { if (e.touches.length === 2) { d0 = dist(e.touches); s0 = scale; } }
    function tm(e) { if (e.touches.length === 2 && d0) { e.preventDefault(); scale = s0 * dist(e.touches) / d0; applyScale(); } }
    function te(e) { if (e.touches.length < 2) d0 = 0; }
    host.addEventListener('touchstart', ts, { passive: true });
    host.addEventListener('touchmove', tm, { passive: false });
    host.addEventListener('touchend', te, { passive: true });
    cleanup.push(function () { host.removeEventListener('touchstart', ts); host.removeEventListener('touchmove', tm); host.removeEventListener('touchend', te); });
  }

  function editCount() { return S ? Object.keys(S.edits).length : 0; }
  function setTip() {
    if (!S || !S.tip) return;
    var z = '<span id="soDocxZoomLab">' + Math.round(scale * 100) + '%</span> · ' + S.pages + '쪽 · ';
    var t;
    if (S.mode === 'edit') t = '고칠 문단을 누르세요 (점선 문단) · 고친 문단 ' + editCount() + '개';
    else if (S.disabled) t = '보기 전용 — ' + S.disabled;
    else t = '보기 · 글을 고칠 수 있는 문단 ' + S.nEdit + '개 (두 손가락으로 확대)';
    S.tip.innerHTML = z + t; S.tip.classList.remove('hide');
    clearTimeout(S.tipTimer);
    if (S.mode !== 'edit') S.tipTimer = setTimeout(function () { if (S && S.tip) S.tip.classList.add('hide'); }, 4500);
  }
  function setActions() {
    var ctx = ctxRef; if (!ctx || !S) return;
    var host = ctx.body;
    if (S.mode === 'edit') {
      var n = editCount();
      ctx.setActions([
        { label: '보기로', onClick: function () { exitEdit(); } },
        { label: '사본 저장', primary: true, disabled: n === 0, onClick: function () { saveEdits(); } }
      ]);
    } else {
      ctx.setActions([
        { label: '−', onClick: function () { scale *= 0.8; applyScale(); } },
        { label: '맞춤', onClick: function () { scale = fit; applyScale(); host.scrollLeft = 0; } },
        { label: '＋', onClick: function () { scale *= 1.25; applyScale(); } },
        { label: '고치기', primary: true, disabled: !S.ready || !!S.disabled || S.nEdit === 0, onClick: function () { enterEdit(); } }
      ]);
    }
  }

  function enterEdit() {
    if (!S || S.disabled) return;
    S.mode = 'edit'; wrap.classList.add('so-docx-editing');
    setActions(); setTip();
    ctxRef.toast('고칠 문단(점선)을 눌러 글을 고치세요. 그림·표 모양은 그대로 유지됩니다.', 3400);
  }
  function exitEdit() {
    if (!S) return; closeSheet();
    S.mode = 'view'; wrap.classList.remove('so-docx-editing');
    setActions(); setTip();
  }

  // ---- 문단 고치는 시트 (textarea: 폰 한글 조합 입력이 가장 안정적. contenteditable 은 docx-preview 가 만든 DOM·CSS zoom 위에서 커서·조합이 흔들려 쓰지 않음)
  var sheet = null;
  function closeSheet() { if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); sheet = null; if (S) S.sheetOpen = false; }
  function openSheet(pEl, xi) {
    closeSheet();
    var para = S.doc.paras[xi], cur = (xi in S.edits) ? S.edits[xi] : para.text;
    sheet = document.createElement('div'); sheet.className = 'so-docx-sheet';
    sheet.innerHTML =
      '<div class="so-docx-sh-t">문단 고치기' + (xi in S.edits ? ' · 고친 문단' : '') + '</div>' +
      '<div class="so-docx-sh-n"></div>' +
      '<textarea class="so-docx-ta" rows="5" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>' +
      '<div class="so-docx-sh-b"><button type="button" data-a="cancel">취소</button><button type="button" data-a="revert"' + ((xi in S.edits) ? '' : ' disabled') + '>원래 글로</button><button type="button" data-a="ok" class="primary">적용</button></div>';
    var note = [];
    if (para.mixed) note.push('한 문단에 글자 모양이 섞여 있어요. 바꾼 부분만 그 자리의 글자 모양으로 들어가고 나머지 글자는 그대로예요.');
    note.push('줄을 바꾸면 줄 나눔으로 들어가요.');
    sheet.querySelector('.so-docx-sh-n').textContent = note.join(' ');
    var ta = sheet.querySelector('textarea'); ta.value = cur;
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-a]') : null; if (!b || b.disabled) return;
      var a = b.getAttribute('data-a');
      if (a === 'cancel') { closeSheet(); return; }
      if (a === 'revert') { delete S.edits[xi]; setRendered(pEl, null); afterChange(); closeSheet(); return; }
      var v = ta.value.replace(/\r\n?/g, '\n');
      if (v === para.text) delete S.edits[xi]; else S.edits[xi] = v;
      setRendered(pEl, (xi in S.edits) ? v : null);
      afterChange(); closeSheet();
    });
    var root = ctxRef.body.parentNode || document.body; root.appendChild(sheet);
    S.sheetOpen = true;
    setTimeout(function () { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }, 60);
  }
  function setRendered(p, text) {
    if (text == null) { if (p._soOrig != null) { p.innerHTML = p._soOrig; } p.classList.remove('so-docx-edited'); return; }
    if (p._soOrig == null) p._soOrig = p.innerHTML;
    var w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = w.nextNode())) nodes.push(n);
    if (!nodes.length) { p.appendChild(document.createTextNode(text)); }
    else { nodes[0].nodeValue = text; for (var i = 1; i < nodes.length; i++) nodes[i].nodeValue = ''; }
    p.classList.add('so-docx-edited');
  }
  function afterChange() {
    ctxRef.setDirty(editCount() > 0);
    setActions(); setTip();
  }

  // ---- 저장: 고친 문단만 끼워 넣고, 다시 열어 스스로 검사한다
  function saveEdits() {
    if (!S || !editCount()) return;
    var ctx = ctxRef, n = editCount();
    var base = String(ctx.name || 'document').replace(/\.docx$/i, '');
    var outName = base + '_수정.docx';
    ctx.confirmCopy('사본으로 저장', n + '개 문단을 고친 사본을 「' + outName + '」로 저장합니다.\n그림·표·번호·머리글 같은 나머지는 원본 그대로 두고, 원본 파일은 바꾸지 않습니다.', '사본 저장', function () {
      ctx.busy('사본 만드는 중…');
      buildCopy().then(function (blob) {
        ctx.busy(null);
        ctx.saveCopy(blob, outName);
        ctx.setDirty(false);
        ctx.toast('사본을 저장했어요: ' + outName, 3600);
      }).catch(function (e) {
        ctx.busy(null);
        ctx.toast('저장하지 못했어요 — 원본은 그대로예요. (' + ((e && e.message) || e) + ')', 5200);
      });
    });
  }
  function buildCopy() {
    var JS = window.JSZip, orig = S.zip, doc = S.doc, xml = S.xml;
    var newXml = applyEdits(xml, doc, S.edits);
    // 검사 1: XML 이 깨지지 않았나, 문단 수·글이 기대와 같은가
    var parsed = new DOMParser().parseFromString(newXml, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length) return Promise.reject(new Error('고친 문서의 XML 검사 실패'));
    var doc2 = analyzeDoc(newXml, S.settings);
    if (doc2.paras.length !== doc.paras.length) return Promise.reject(new Error('문단 수 검사 실패'));
    for (var i = 0; i < doc.paras.length; i++) {
      var want = (i in S.edits) ? S.edits[i].replace(/\r\n?/g, '\n') : doc.paras[i].text;
      if (doc2.paras[i].text !== want) return Promise.reject(new Error('문단 ' + (i + 1) + ' 글 검사 실패'));
      if (!(i in S.edits) && newXml.slice(doc2.paras[i].s, doc2.paras[i].e) !== xml.slice(doc.paras[i].s, doc.paras[i].e)) return Promise.reject(new Error('고치지 않은 문단 ' + (i + 1) + ' 이 달라짐'));
    }
    var outXml = (S.bom ? '﻿' : '') + newXml, back = (S.bom ? '﻿' : '') + xml;
    orig.file('word/document.xml', outXml, { createFolders: false });
    return orig.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' }).then(function (blob) {
      // 검사 2: 다시 열어 document.xml 외 부분이 원본과 바이트까지 같은지
      return JS.loadAsync(blob).then(function (z2) {
        var names = Object.keys(S.origNames), chain = Promise.resolve();
        names.forEach(function (nm) {
          if (nm === 'word/document.xml' || S.origNames[nm].dir) return;
          chain = chain.then(function () {
            var f2 = z2.file(nm); if (!f2) throw new Error('파일 빠짐: ' + nm);
            return Promise.all([f2.async('uint8array'), S.origBytes(nm)]).then(function (r) {
              var a = r[0], b = r[1]; if (a.length !== b.length) throw new Error('내용 달라짐: ' + nm);
              for (var k = 0; k < a.length; k++) if (a[k] !== b[k]) throw new Error('내용 달라짐: ' + nm);
            });
          });
        });
        return chain.then(function () {
          var extra = Object.keys(z2.files).filter(function (k) { return !(k in S.origNames); });
          if (extra.length) throw new Error('낯선 파일: ' + extra[0]);
          return z2.file('word/document.xml').async('string');
        }).then(function (x2) {
          if (x2 !== outXml) throw new Error('document.xml 불일치');
          return blob;
        });
      });
    }).then(function (b) { orig.file('word/document.xml', back, { createFolders: false }); return b; }, function (e) { orig.file('word/document.xml', back, { createFolders: false }); throw e; });
  }

  // ---- 열 때: 압축 안 document.xml 을 읽어 화면의 문단과 짝짓기
  function prepareEdit(box) {
    var JS = window.JSZip;
    return JS.loadAsync(ctxRef.file).then(function (zip) {
      var names = {}; Object.keys(zip.files).forEach(function (k) { names[k] = { dir: zip.files[k].dir }; });
      var df = zip.file('word/document.xml'); if (!df) throw new Error('document.xml 없음');
      return Promise.all([df.async('string'), zip.file('word/settings.xml') ? zip.file('word/settings.xml').async('string') : Promise.resolve('')]).then(function (r) {
        var xml = r[0], settings = r[1];
        if (xml.charCodeAt(0) === 0xFEFF) { xml = xml.slice(1); S.bom = true; }
        var doc = analyzeDoc(xml, settings);
        var chk = new DOMParser().parseFromString(xml, 'application/xml');
        if (chk.getElementsByTagName('parsererror').length) throw new Error('원본 XML 해석 불가');
        S.zip = zip; S.xml = xml; S.settings = settings; S.doc = doc; S.origNames = names;
        var cached = null;
        S.origBytes = function (nm) { cached = cached || JS.loadAsync(ctxRef.file); return cached.then(function (z) { return z.file(nm).async('uint8array'); }); };
        var Rs = Array.prototype.slice.call(box.querySelectorAll('section.docx > article p'));
        S.Rs = Rs;
        var al = align(doc.paras, Rs.map(function (p) { return norm(p.textContent); }));
        var counts = {};
        doc.paras.forEach(function (p) { if (p.norm) counts[p.norm] = (counts[p.norm] || 0) + 1; });
        var nEdit = 0;
        doc.paras.forEach(function (p, i) {
          p.r = al.map[i] >= 0 ? Rs[al.map[i]] : null;
          if (p.editable) {
            if (!al.exact && p.norm && counts[p.norm] > 1) { p.editable = false; p.reason = 'dup'; }
            else if (!p.r) { p.editable = false; p.reason = 'nomatch'; }
            else if (!al.exact && !p.norm) { p.editable = false; p.reason = 'nomatch'; }
          }
          if (p.r) { p.r._soX = i; if (p.editable) { p.r.classList.add('so-docx-ok'); nEdit++; } }
        });
        S.nEdit = nEdit; S.exact = al.exact;
        if (doc.global) S.disabled = doc.global;
        else if (!nEdit) S.disabled = '글을 고칠 수 있는 문단이 없어요.';
        S.ready = true;
      });
    });
  }

  SOffice.register({
    id: 'docx', label: '워드', editable: true,
    credits: [
      { name: 'docx-preview', license: 'Apache-2.0', note: '워드 보기 (Volodymyr Baydalka)' },
      { name: 'JSZip', license: 'MIT', note: '압축 풀기·묶기' }
    ],
    canOpen: function (ext) { return ext === 'docx'; },
    open: function (ctx) {
      ctxRef = ctx;
      S = { mode: 'view', edits: {}, ready: false, disabled: null, nEdit: 0, pages: 0, tip: null };
      ctx.loadCss('js/smartoffice/docx/so-docx.css');
      return Promise.all([ctx.loadScript('vendor/so/docx/jszip.min.js')]).then(function () {
        return ctx.loadScript('vendor/so/docx/docx-preview.min.js');
      }).then(function () {
        if (!window.docx || !window.docx.renderAsync) throw new Error('워드 부품을 찾지 못함');
        var host = ctx.body;
        host.classList.add('so-docx-host');
        var box = document.createElement('div'); box.className = 'so-docx-box';
        var styleBox = document.createElement('div'); styleBox.style.display = 'none';
        host.appendChild(styleBox); host.appendChild(box);
        wrap = box;
        return window.docx.renderAsync(ctx.file, box, styleBox, {
          className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
          breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true,
          renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false
        }).then(function () {
          var pages = box.querySelectorAll('section.docx').length;
          if (!pages) throw new Error('쪽을 그리지 못함');
          S.pages = pages;
          measure(host); scale = Math.min(1, fit); applyScale();
          setupPinch(host);
          var tip = document.createElement('div'); tip.className = 'so-docx-tip'; S.tip = tip; host.appendChild(tip);
          S.disabled = '고칠 수 있는지 확인하는 중…';
          setActions(); setTip();
          var onR = function () { measure(host); };
          window.addEventListener('resize', onR); cleanup.push(function () { window.removeEventListener('resize', onR); });
          // 눌러서 고치기
          var onClick = function (e) {
            if (!S || S.mode !== 'edit' || S.sheetOpen) return;
            var p = e.target.closest ? e.target.closest('section.docx > article p') : null; if (!p) return;
            var xi = p._soX; var para = xi != null ? S.doc.paras[xi] : null;
            if (!para) { ctx.toast(REASON.nomatch, 3200); return; }
            if (!para.editable) { ctx.toast(REASON[para.reason] || REASON.other, 3600); return; }
            openSheet(p, xi);
          };
          box.addEventListener('click', onClick); cleanup.push(function () { box.removeEventListener('click', onClick); });
          ctx.onBack(function () { if (sheet) { closeSheet(); return true; } if (S && S.mode === 'edit' && editCount() === 0) { exitEdit(); return true; } return false; });
          // 짝짓기는 보기를 막지 않게 뒤에서 한다. 실패해도 보기는 그대로.
          return prepareEdit(box).then(function () { if (S) { if (S.disabled === '고칠 수 있는지 확인하는 중…') S.disabled = null; setActions(); setTip(); } }, function (e) {
            try { console.warn('[S-Office/docx] 고치기 준비 실패', e); } catch (x) {}
            if (S) { S.disabled = '이 문서는 고칠 준비를 하지 못해 보기만 됩니다.'; S.ready = false; setActions(); setTip(); }
          });
        });
      });
    },
    close: function () {
      cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = [];
      closeSheet(); if (S && S.tipTimer) clearTimeout(S.tipTimer);
      wrap = null; ctxRef = null; S = null;
    },
    _t: { diffHunks: diffHunks, analyze: analyze, analyzeDoc: analyzeDoc, rebuildParagraph: rebuildParagraph, applyEdits: applyEdits, align: align, scanParagraphs: scanParagraphs, norm: norm }
  });
})();
