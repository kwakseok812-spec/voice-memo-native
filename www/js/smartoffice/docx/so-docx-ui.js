/* so-docx-ui.js — S-Office 워드 편집 도구줄·시트(O-0861, v10.6)
 * 고치기를 켰을 때 아래에 나오는 도구줄(문단·스타일·서식·목록·표·그림·머리·바꾸기·범위 + 더보기)과 그 시트들.
 * 실제 문서 고치기는 so-docx-struct.js, 화면 갈아 끼우기·되돌리기·선택은 so-docx.js(env). 한 줄 단추 수: 접은 폰 6 + 더보기 · 펼친 화면 10 · DeX 전부.
 */
(function (global) {
  'use strict';
  var ST = global.SODocxStruct;
  function J(w, j) { return global.SOffice && global.SOffice.josa ? global.SOffice.josa(w, j) : w + j; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var TXT = [['검정', '000000'], ['빨강', 'C00000'], ['파랑', '1C5FD6'], ['초록', '1B8A3A'], ['주황', 'EE7A00'], ['보라', '7A3FC4'], ['회색', '777777'], ['기본', null]];
  var HL = [['노랑', 'yellow'], ['연두', 'green'], ['하늘', 'cyan'], ['분홍', 'magenta'], ['없음', null]];
  var FONTS = ['맑은 고딕', '바탕', '돋움', '굴림', '궁서', 'Arial', 'Times New Roman'];
  var SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

  function create(env) {
    var U = { row: null, lab: null, bucket: 0 };
    function ctx() { return env.ctx(); }
    function S() { return env.S(); }
    function toast(m, ms) { env.note(m, ms || 3000); }
    function perRow() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }
    function rg() { return env.sel(); }
    function need() { var r = rg(); if (!r) { toast('먼저 문서에서 문단을 한 번 눌러 고르십시오(점선 문단은 한 번 더 누르면 글을 고칩니다).', 3800); return null; } return r; }
    function fail(msg) {
      if (ctx().fixAvail && ctx().fixAvail()) ctx().confirm('폰에서는 하기 어렵습니다', msg + '\n\n워드로 고쳐야 하는 일이면 「수정 요청」으로 맡길 수 있습니다.', '수정 요청', function () { ctx().requestFix(); }, { cancelLabel: '닫기' });
      else toast(msg, 5200);
    }
    // doc 고치기: fn(xml, pkg) → 새 xml | {xml,newA,newB,err}
    function op(label, fn, okMsg, keepSel) {
      return env.run(label, function (pkg) {
        return pkg.read('word/document.xml').then(function (x) { return Promise.resolve(fn(x, pkg)).then(function (r) { if (r && r.err) return r; var nx = typeof r === 'string' ? r : r.xml; pkg.write('word/document.xml', nx); return r && typeof r === 'object' ? r : {}; }); });
      }, function (r) {
        if (r && r.err) { fail(r.err); return; }
        if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 2600);
        if (r && r.newA != null) env.select(r.newA, r.newB); else if (!keepSel) env.select(null);
        setTimeout(refillSheet, 30);
      });
    }
    var X = null;
    function XM() { if (!X && global.SODocxUIMore) X = global.SODocxUIMore.create({ env: env, ST: ST, ctx: ctx, toast: toast, need: need, fail: fail, S: S, J: J, op: op }); return X; }
    function xcall(name) { return function () { var x = XM(); if (x && x[name]) x[name](); else toast('이 기능의 부품을 불러오지 못했습니다.', 3200); }; }
    var curSheet = null, keepMode = false;
    function sheet(title, build, noBtn, keep) {            // keep=true 면 항목을 눌러도 닫히지 않는다(「닫기」로 닫음) — 적용한 뒤 시트 안을 문서 상태에 맞게 다시 그린다
      var body = el('div', 'sdx'); keepMode = !!keep; build(body); keepMode = false;
      curSheet = keep ? { body: body, build: build } : null;
      ctx().sheet({ title: title, body: body, buttons: noBtn ? [] : [{ label: '닫기' }], wide: true, keep: !!keep }); return body;
    }
    function refillSheet() {
      if (!curSheet) return;
      var b = curSheet.body; if (!b.isConnected) { curSheet = null; return; }
      var sc = [], p = b.parentElement; while (p && p !== document.body) { if (p.scrollTop) sc.push([p, p.scrollTop]); p = p.parentElement; }
      keepMode = true; b.innerHTML = ''; try { curSheet.build(b); } catch (e) {} keepMode = false;
      sc.forEach(function (q) { q[0].scrollTop = q[1]; });
    }
    function group(body, label) { body.appendChild(el('div', 'sdx-l', label)); var r = el('div', 'sdx-r'); body.appendChild(r); return r; }
    function grid(body) { var g = el('div', 'sdx-g'); body.appendChild(g); return g; }
    function btn(row, text, fn, cls, color) {
      var b = el('button', 'sdx-b' + (cls ? ' ' + cls : ''), color === undefined ? text : ''); b.type = 'button';
      if (color !== undefined) { b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = '#' + color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); }
      var keep = keepMode;
      b.onclick = function () { if (keep) { fn(); return; } ctx().closeSheet(); setTimeout(fn, 60); }; row.appendChild(b); return b;
    }
    function range() { var r = need(); return r; }

    // ---------------- 복사·붙여넣기·복제(문단·표) ----------------
    var clip = null;
    function copySel(cut) {
      var r = need(); if (!r) return; var c;
      try { c = ST.copyParas(S().xml, r.a, r.b); } catch (e) { toast('복사하지 못했습니다: ' + ((e && e.message) || e), 4200); return; }
      if (c.err) { fail(c.err); return; }
      clip = c;
      if (cut) op('오려두기', function (x) { return ST.deleteParas(x, r.a, r.b); }, '문단 ' + c.n + '개를 오려 두었습니다 — 붙일 문단을 고르고 「붙여넣기」');
      else toast('문단 ' + c.n + '개를 복사했습니다 — 붙일 문단을 고르고 「붙여넣기」', 3400);
    }
    function copyTbl() {
      var r = need(); if (!r) return; var c = ST.copyTable(S().xml, r.a);
      if (c.err) { fail(c.err); return; } clip = c; toast('표를 복사했습니다 — 표 밖 문단을 고르고 「붙여넣기」', 3400);
    }
    function pasteClip() {
      var r = need(); if (!r) return;
      if (!clip) { toast('먼저 복사할 문단이나 표를 복사해 주십시오.', 3000); return; }
      var c = clip;
      op('붙여넣기', function (x) { var q = ST.pasteBlock(x, r.b, c); return q.err ? q : { xml: q.xml, newA: q.newA, newB: q.newB }; }, c.kind === 'table' ? '표를 붙였습니다(고른 문단 아래)' : '붙였습니다(고른 문단 아래)', true);
    }
    function dupSel() {
      var r = need(); if (!r) return;
      op('문단 복제', function (x) { var q = ST.dupParas(x, r.a, r.b); return q.err ? q : { xml: q.xml, newA: q.newA, newB: q.newB }; }, '복제했습니다(바로 아래에 들어갔습니다)', true);
    }
    function dupTbl() {
      var r = need(); if (!r) return;
      op('표 복제', function (x) { var q = ST.dupTable(x, r.a); return q.err ? q : { xml: q.xml, newA: q.newA, newB: q.newB }; }, '표를 복제했습니다(바로 아래에 들어갔습니다)', true);
    }
    U.copySel = copySel; U.pasteClip = pasteClip; U.dupSel = dupSel;
    // ---------------- 문단 ----------------
    function paraSheet() {
      var r = need(); if (!r) return;
      sheet('문단 ' + (r.a + 1) + (r.b > r.a ? '~' + (r.b + 1) : ''), function (body) {
        var g = grid(body);
        btn(g, '아래에 문단 넣기', function () { if (S().track) { env.trackInsert(r.b, true); return; } op('문단 넣기', function (x) { var y = ST.insertPara(x, r.b, '', true); return { xml: y, newA: r.b + 1, newB: r.b + 1 }; }, '문단을 하나 넣었습니다', true); }, 'big');
        btn(g, '위에 문단 넣기', function () { if (S().track) { env.trackInsert(r.a, false); return; } op('문단 넣기', function (x) { var y = ST.insertPara(x, r.a, '', false); return { xml: y, newA: r.a, newB: r.a }; }, '문단을 하나 넣었습니다', true); }, 'big');
        btn(g, '문단 지우기', function () { ctx().confirm('고른 문단 ' + (r.b - r.a + 1) + '개를 지우시겠습니까?', '지운 직후에는 ↶ 로 되돌릴 수 있습니다.', '지우기', function () { if (S().track) { env.trackDelete(r.a, r.b); return; } op('문단 지우기', function (x) { return ST.deleteParas(x, r.a, r.b); }, function (q) { return q.blanked ? '내용을 비웠습니다(칸·본문의 마지막 문단이라 남겼습니다)' : '지웠습니다(되돌리려면 ↶)'; }); }, { danger: true }); }, 'big danger');
        btn(g, '여기부터 쪽 설정 따로', function () { op('쪽 설정 따로', function (x) { return ST.sectionBreakAfter(x, r.b); }, '여기부터 쪽 설정을 따로 바꿀 수 있게 나눴습니다(처음엔 앞과 같은 설정)', true); }, 'big');
        btn(g, '링크', function () { linkSheet(r); }, 'big'); btn(g, '각주 넣기', function () { noteSheet('footnote', r); }, 'big'); btn(g, '미주 넣기', function () { noteSheet('endnote', r); }, 'big');
        btn(g, '쪽 나누기 넣기', function () { op('쪽 나누기', function (x) { return ST.pageBreakAfter(x, r.b); }, '쪽 나누기를 넣었습니다', true); }, 'big');
        btn(g, '위로 옮기기', function () { op('문단 옮기기', function (x) { return ST.moveParas(x, r.a, r.b, -1); }, '위로 옮겼습니다'); }, 'big');
        btn(g, '아래로 옮기기', function () { op('문단 옮기기', function (x) { return ST.moveParas(x, r.a, r.b, 1); }, '아래로 옮겼습니다'); }, 'big');
        btn(g, '복사', function () { copySel(false); }, 'big'); btn(g, '오려두기', function () { copySel(true); }, 'big'); btn(g, '붙여넣기', pasteClip, 'big'); btn(g, '문단 복제', dupSel, 'big');
        if (r.a === r.b) btn(g, '글 고치기', function () { env.editText(r.a); }, 'big');
        body.appendChild(el('div', 'sdx-l', '넣기')); var g2 = grid(body);
        btn(g2, '기호·날짜 넣기', symSheet, 'big'); btn(g2, '책갈피', bookmarkSheet, 'big'); btn(g2, '상호 참조', refSheet, 'big'); btn(g2, '그림·표 이름', captionSheet, 'big'); btn(g2, '목차 넣기·갱신', tocNow, 'big');
        btn(g2, '수식', xcall('mathSheet'), 'big'); btn(g2, '입력 칸(체크·목록·날짜)', xcall('controlSheet'), 'big'); btn(g2, '인용·참고문헌', xcall('citeSheet'), 'big'); btn(g2, '색인', xcall('indexSheet'), 'big');
        body.appendChild(el('div', 'so-sheet-note', '문서에서 문단을 눌러 고르면 맨 위에 「고른 문단」이 보입니다. 여러 문단은 「범위」로 고릅니다. 같은 문단을 한 번 더 누르면 글 고치기가 열립니다.'));
      });
    }
    // ---------------- 링크 · 각주 · 미주 · 쪽 설정 ----------------
    function linkSheet(r) {
      var body = el('div', 'sdx'), a = el('input', 'sdx-in'), b = el('input', 'sdx-in'); a.type = b.type = 'text'; a.placeholder = '링크로 보일 글'; b.placeholder = '주소 (https://…)'; a.setAttribute('aria-label', '링크로 보일 글'); b.setAttribute('aria-label', '링크 주소'); b.inputMode = 'url';
      body.appendChild(a); body.appendChild(b); body.appendChild(el('div', 'so-sheet-note', '고른 문단 맨 끝에 링크 글자가 붙습니다. 이미 있는 링크의 글자는 글 고치기에서 고칠 수 있습니다.'));
      ctx().sheet({ title: '링크', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '넣기', primary: true, onClick: function () {
        var t = a.value, u = b.value; env.run('링크', function (pkg) { return ST.addLink(pkg, r.b, t, u).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('링크를 넣었습니다', 2600); });
      } }] });
      setTimeout(function () { try { a.focus(); } catch (e) {} }, 300);
    }
    function noteSheet(kind, r) {
      var nm = kind === 'footnote' ? '각주' : '미주';
      env.readNotes(kind).then(function (list) {
        var body = el('div', 'sdx'), t = el('textarea', 'sdx-in'); t.rows = 3; t.placeholder = nm + ' 내용'; t.setAttribute('aria-label', nm + ' 내용');
        body.appendChild(el('div', 'sdx-l', '고른 문단 맨 끝에 ' + nm + ' 표시가 붙습니다')); body.appendChild(t);
        if (list.length) {
          body.appendChild(el('div', 'sdx-l', '이 문서의 ' + nm + ' ' + list.length + '개 — 누르면 고치거나 지웁니다'));
          var g = el('div', 'sdx-g'); body.appendChild(g);
          list.forEach(function (n, i) {
            var b = el('button', 'sdx-b big', (i + 1) + '. ' + (n.text.length > 22 ? n.text.slice(0, 22) + '…' : n.text || '(빈 ' + nm + ')')); b.type = 'button';
            b.onclick = function () { ctx().closeSheet(); setTimeout(function () { noteEdit(kind, n, i + 1); }, 60); }; g.appendChild(b);
          });
        }
        body.appendChild(el('div', 'so-sheet-note', nm + ' 번호는 문서 순서대로 자동으로 매겨집니다. ' + nm + ' 표시가 든 문단도 글 고치기로 고칠 수 있습니다(표시는 그대로 남습니다).'));
        ctx().sheet({ title: nm + ' 넣기', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '넣기', primary: true, onClick: function () {
          var tx = t.value; env.run(nm, function (pkg) { return ST.insertNote(pkg, r.b, tx, kind).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(nm + '를 넣었습니다', 2600); });
        } }] });
      });
    }
    function noteEdit(kind, n, no) {
      var nm = kind === 'footnote' ? '각주' : '미주', body = el('div', 'sdx'), t = el('textarea', 'sdx-in'); t.rows = 4; t.value = n.text; t.setAttribute('aria-label', nm + ' 내용');
      body.appendChild(el('div', 'sdx-l', nm + ' ' + no)); body.appendChild(t);
      ctx().sheet({ title: nm + ' ' + no + ' 고치기', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '지우기', onClick: function () {
        env.run(nm + ' 지우기', function (pkg) { return ST.deleteNote(pkg, n.id, kind).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(nm + '를 지웠습니다(되돌리려면 ↶)', 2800); });
      } }, { label: '저장', primary: true, onClick: function () {
        var tx = t.value; env.run(nm, function (pkg) { return ST.editNote(pkg, n.id, tx, kind).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(nm + '를 고쳤습니다', 2600); });
      } }] });
    }
    var PAGE_BG = [['없음', null], ['노랑', 'FFF2A8'], ['연두', 'D8F0C0'], ['하늘', 'CFE5FF'], ['분홍', 'FFD6E0'], ['회색', 'EDEDED']];
    function pageGroup(body) { pageGroup0(body); pageExtras(body); }
    function pageGroup0(body) {
      var pg = null; try { pg = ST.readPage(S().xml); } catch (e) {}
      function go(o, msg) { env.run('쪽 설정', function (pkg) { return ST.pageSetup(pkg, o).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(msg, 2800); }); }
      var g0 = group(body, '쪽 설정' + (pg ? ' — 지금 ' + (pg.name || '사용자 크기') + (pg.land ? ' 가로' : ' 세로') : ' (문서 전체)'));
      btn(g0, '세로', function () { go({ orient: 'portrait' }, '용지를 세로로 했습니다'); }, pg && !pg.land ? 'on' : ''); btn(g0, '가로', function () { go({ orient: 'landscape' }, '용지를 가로로 했습니다'); }, pg && pg.land ? 'on' : '');
      var g1 = group(body, '용지 크기'); ['A4', 'A3', 'A5', 'B5', 'Letter', 'Legal'].forEach(function (k) { btn(g1, k, function () { go({ size: k }, '용지 크기를 ' + k + '로 했습니다'); }, pg && pg.name === k ? 'on' : ''); });
      var g2 = group(body, '여백'); [['보통', 'normal'], ['좁게', 'narrow'], ['넓게', 'wide'], ['보통(좌우 좁게)', 'moderate']].forEach(function (m) { btn(g2, m[0], function () { go({ margin: m[1] }, '여백을 ' + m[0] + '으로 했습니다'); }); });
      var g3 = group(body, '쪽 배경색'); PAGE_BG.forEach(function (c) { btn(g3, c[0], function () { env.run('쪽 배경색', function (pkg) { return ST.pageColor(pkg, c[1]).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('쪽 배경색을 바꿨습니다(인쇄에는 설정에 따라 나오지 않을 수 있습니다)', 3200); }); }, 'sw', c[1] || ''); });
    }

    // ---------------- 스타일 ----------------
    function styleSheet() {
      var r = need(); if (!r) return;
      sheet('문단 스타일', function (body) {
        var g = grid(body), items = [['본문', 'normal'], ['제목 1', 'heading1'], ['제목 2', 'heading2'], ['제목 3', 'heading3'], ['문서 제목', 'title']];
        items.forEach(function (it) { btn(g, it[0], function () {
          env.run('스타일', function (pkg) { return (it[1] === 'normal' ? Promise.resolve(null) : ST.ensureStyle(pkg, it[1])).then(function (id) {
            if (it[1] !== 'normal' && !id) return { err: '이 문서에는 「' + it[0] + '」 스타일이 없어 폰에서는 적용할 수 없습니다.' };
            return pkg.read('word/document.xml').then(function (x) { pkg.write('word/document.xml', ST.setStyle(x, r.a, r.b, id)); return {}; });
          }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('「' + it[0] + '」로 바꿨습니다', 2400); });
        }, 'big'); });
        body.appendChild(el('div', 'so-sheet-note', '제목 스타일은 쪽·목차 이동의 「목차」에 나타납니다.'));
        var xm = XM(); if (xm) xm.styleExtras(body, r);
      });
    }
    // ---------------- 서식 ----------------
    function fmtNow() { var r = rg(), s = S(); if (!r || !s.xml) return {}; try { return ST.readFmt(s.xml, r.a); } catch (e) { return {}; } }
    function applyRun(f, msg) { var r = need(); if (!r) return; op('글자 서식', function (x) { return ST.setRunFmt(x, r.a, r.b, f); }, msg || '서식을 바꿨습니다', true); }
    function applyPara(f, msg) { var r = need(); if (!r) return; op('문단 서식', function (x) { return ST.setParaFmt(x, r.a, r.b, f); }, msg || '서식을 바꿨습니다', true); }
    function fmtSheet() {
      var r = need(); if (!r) return; var cur = fmtNow();
      sheet('서식 — 고른 문단 전체에 적용', function (body) {
        r = rg() || r; cur = fmtNow();
        var g1 = group(body, '글자');
        btn(g1, '굵게', function () { applyRun({ bold: !cur.bold }); }, 'bold' + (cur.bold ? ' on' : '')); btn(g1, '기울임', function () { applyRun({ italic: !cur.italic }); }, 'it' + (cur.italic ? ' on' : '')); btn(g1, '밑줄', function () { applyRun({ underline: !cur.underline }); }, 'ul' + (cur.underline ? ' on' : ''));
        var g2 = group(body, '글자 크기(' + (cur.size ? cur.size + 'pt' : '스타일 기본') + ')');
        btn(g2, '작게 −', function () { applyRun({ size: Math.max(6, (cur.size || 11) - 1) }); }); btn(g2, '크게 ＋', function () { applyRun({ size: Math.min(120, (cur.size || 11) + 1) }); });
        SIZES.forEach(function (z) { btn(g2, String(z), function () { applyRun({ size: z }); }, cur.size === z ? 'on' : ''); });
        var g3 = group(body, '글자 색'); TXT.forEach(function (c) { btn(g3, c[0], function () { applyRun({ color: c[1] }, '글자 색을 바꿨습니다'); }, 'sw', c[1] || ''); });
        var g4 = group(body, '형광펜'); HL.forEach(function (c) { btn(g4, c[0], function () { applyRun({ highlight: c[1] }, '형광펜을 바꿨습니다'); }, c[1] ? '' : ''); });
        var g5 = group(body, '글꼴'); FONTS.forEach(function (f) { btn(g5, f, function () { applyRun({ font: f }, '글꼴을 바꿨습니다'); }); });
        var g6 = group(body, '정렬'); [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right'], ['양쪽', 'both']].forEach(function (a) { btn(g6, a[0], function () { applyPara({ align: a[1] }); }, cur.align === a[1] ? 'on' : ''); });
        var g7 = group(body, '줄 간격'); [1, 1.15, 1.5, 2].forEach(function (v) { btn(g7, String(v), function () { applyPara({ line: v }, '줄 간격을 ' + J(String(v), '으로') + ' 바꿨습니다'); }); });
        var g7b = group(body, '글자 모양'); btn(g7b, '취소선', function () { applyRun({ strike: true }, '취소선을 넣었습니다'); }); btn(g7b, '위 첨자', function () { applyRun({ vert: 'superscript' }, '위 첨자로 했습니다'); }); btn(g7b, '아래 첨자', function () { applyRun({ vert: 'subscript' }, '아래 첨자로 했습니다'); }); btn(g7b, '첨자·취소선 풀기', function () { applyRun({ strike: false, vert: null }, '풀었습니다'); });
        var g7c = group(body, '글자 간격(pt)'); [[-1, '좁게 −1'], [0, '기본'], [1, '넓게 +1'], [2, '+2'], [3, '+3']].forEach(function (v) { btn(g7c, v[1], function () { applyRun({ track: v[0] }, '글자 간격을 바꿨습니다'); }); });
        var g7d = group(body, '문단 앞 간격(pt)'); [0, 6, 12, 18].forEach(function (v) { btn(g7d, String(v), function () { applyPara({ spBefore: v }, '문단 앞 간격을 바꿨습니다'); }); });
        var g7e = group(body, '문단 뒤 간격(pt)'); [0, 6, 12, 18].forEach(function (v) { btn(g7e, String(v), function () { applyPara({ spAfter: v }, '문단 뒤 간격을 바꿨습니다'); }); });
        var g7f = group(body, '문단 음영 · 테두리'); [['회색', 'D9D9D9'], ['노랑', 'FFF2A8'], ['하늘', 'CFE5FF'], ['없음', null]].forEach(function (c) { btn(g7f, c[0] === '없음' ? '음영 없음' : c[0] + ' 음영', function () { applyPara({ shade: c[1] }, '문단 음영을 바꿨습니다'); }); }); btn(g7f, '테두리 상자', function () { applyPara({ box: true }, '문단에 테두리를 넣었습니다'); }); btn(g7f, '테두리 없음', function () { applyPara({ box: null }, '문단 테두리를 없앴습니다'); });
        var g8 = group(body, '들여쓰기'); btn(g8, '← 내어쓰기', function () { applyPara({ indent: -1 }); }); btn(g8, '들여쓰기 →', function () { applyPara({ indent: 1 }); }); btn(g8, '초기화', function () { applyPara({ indent: 0 }); });
        fmtPaintGroup(body);
        body.appendChild(el('div', 'so-sheet-note', '글자 일부만 꾸미려면 문단을 한 번 더 눌러 「문단 고치기」를 열고, 글자를 끌어 고른 뒤 「고른 글자 꾸미기」 줄의 단추를 누릅니다. 이 시트는 고른 문단 전체에 적용됩니다.'));
      }, false, true);
    }
    // ---------------- 목록 ----------------
    function listSheet() {
      var r = need(); if (!r) return;
      sheet('목록', function (body) {
        var g = grid(body);
        function apply(kind, lvl) {
          env.run('목록', function (pkg) {
            return pkg.read('word/document.xml').then(function (x) {
              var reuse = r.a > 0 ? ST.numIdOf(x, r.a - 1) : null;
              return (kind ? ST.ensureList(pkg, kind, reuse) : Promise.resolve(null)).then(function (id) { pkg.write('word/document.xml', ST.setList(x, r.a, r.b, id, lvl || 0)); return {}; });
            });
          }, function () { toast(kind ? (kind === 'bullet' ? '글머리표를 넣었습니다' : '번호 목록을 만들었습니다') : '목록을 풀었습니다', 2400); });
        }
        btn(g, '글머리표(●)', function () { apply('bullet'); }, 'big'); btn(g, '번호 목록(1. 2. 3.)', function () { apply('decimal'); }, 'big'); btn(g, '목록 풀기', function () { apply(null); }, 'big');
        btn(g, '한 단계 안으로', function () { applyPara({ indent: 1 }); }, 'big');
        body.appendChild(el('div', 'so-sheet-note', '앞 문단이 같은 종류의 목록이면 번호가 이어집니다. 여러 문단은 「범위」로 고른 뒤 한꺼번에 적용하십시오.'));
      }, false, true);
    }
    // ---------------- 표 ----------------
    var BGS = [['없음', null], ['노랑', 'FFE066'], ['연두', 'B7E4A0'], ['하늘', '9CC9FF'], ['분홍', 'FFB3C7'], ['살구', 'FFC98A'], ['회색', 'D9D9D9'], ['파랑', '4472C4']];
    function tableSheet() {
      var r = rg();
      sheet('표', function (body) {
        r = rg();
        var g0 = group(body, '새 표 넣기(고른 문단 아래)');
        var rows = 3, cols = 3, lab = el('div', 'sdx-l', ''); function paint() { lab.textContent = '줄 ' + rows + ' × 칸 ' + cols; }
        var rr = el('div', 'sdx-r'); function step(t, f) { var b = el('button', 'sdx-b', t); b.type = 'button'; b.onclick = function () { f(); paint(); }; rr.appendChild(b); }
        body.appendChild(lab); body.appendChild(rr); step('줄 −', function () { rows = Math.max(1, rows - 1); }); step('줄 ＋', function () { rows = Math.min(20, rows + 1); }); step('칸 −', function () { cols = Math.max(1, cols - 1); }); step('칸 ＋', function () { cols = Math.min(8, cols + 1); }); paint();
        var ok = el('button', 'sdx-b big on', '표 넣기'); ok.type = 'button'; ok.onclick = function () {
          var q = need(); if (!q) return; ctx().closeSheet();
          env.run('표', function (pkg) { return ST.ensureStyle(pkg, 'tablegrid').then(function (sid) { return pkg.read('word/document.xml').then(function (x) { var t = ST.insertTable(x, q.b, rows, cols, null); if (t.err) return t; pkg.write('word/document.xml', t.xml); return {}; }); }); }, function (z) { if (z && z.err) { fail(z.err); return; } toast('표를 넣었습니다(' + rows + '×' + cols + '). 칸을 눌러 고른 뒤 한 번 더 눌러 글을 넣으십시오.', 3600); env.select(null); });
        }; body.appendChild(ok);
        var info = null; if (r) { try { info = ST.tableInfo(S().xml, r.a); } catch (e) {} }
        var g = grid(body); body.insertBefore(el('div', 'sdx-l', info ? '고른 칸이 든 표: ' + info.rows + '줄 × ' + info.cols + '칸' + (info.merged ? ' (합쳐진 칸 있음)' : '') : '표 안의 칸(문단)을 고르면 아래 단추가 쓰입니다'), g);
        function te(opn, msg) { return function () { var q = need(); if (!q) return; op('표 고치기', function (x) { var t = ST.tableEdit(x, q.a, opn); return t.err ? t : t.xml; }, msg, true); }; }
        btn(g, '위에 줄 추가', te('rowAbove', '줄을 넣었습니다'), 'big'); btn(g, '아래에 줄 추가', te('rowBelow', '줄을 넣었습니다'), 'big');
        btn(g, '줄 지우기', te('rowDel', '줄을 지웠습니다(되돌리려면 ↶)'), 'big danger'); btn(g, '칸 지우기(열)', te('colDel', '칸을 지웠습니다(되돌리려면 ↶)'), 'big danger');
        btn(g, '왼쪽에 칸 추가', te('colLeft', '칸을 넣었습니다'), 'big'); btn(g, '오른쪽에 칸 추가', te('colRight', '칸을 넣었습니다'), 'big');
        btn(g, '오른쪽 칸과 합치기', te('mergeRight', '칸을 합쳤습니다'), 'big'); btn(g, '아래 칸과 합치기', te('mergeDown', '칸을 합쳤습니다'), 'big'); btn(g, '가로 합치기 풀기', te('unmerge', '합친 칸을 풀었습니다'), 'big');
        btn(g, '표 복사', copyTbl, 'big'); btn(g, '표 복제', dupTbl, 'big'); btn(g, '붙여넣기', pasteClip, 'big');
        function shade(hex, scope, msg) { var q = need(); if (!q) return; op('표 서식', function (x) { var t = ST.setCellShade(x, q.a, hex, scope); return t.err ? t : t.xml; }, msg || '배경색을 바꿨습니다', true); }
        var gc = group(body, '고른 칸 배경색'); BGS.forEach(function (c) { btn(gc, c[0], function () { shade(c[1], 'cell'); }, 'sw', c[1] || ''); });
        var gr = group(body, '고른 줄 전체 배경색'); BGS.forEach(function (c) { btn(gr, c[0], function () { shade(c[1], 'row', '줄의 배경색을 바꿨습니다'); }, 'sw', c[1] || ''); });
        var gt = group(body, '표 전체 배경색'); BGS.forEach(function (c) { btn(gt, c[0], function () { shade(c[1], 'table', '표의 배경색을 바꿨습니다'); }, 'sw', c[1] || ''); });
        var gb = group(body, '표 테두리');
        function bord(o, msg) { var q = need(); if (!q) return; op('표 테두리', function (x) { var t = ST.setTableBorders(x, q.a, o); return t.err ? t : t.xml; }, msg, true); }
        btn(gb, '가는 선', function () { bord({ on: true, sz: 4, color: '808080' }, '테두리를 가는 선으로 했습니다'); }); btn(gb, '굵은 선', function () { bord({ on: true, sz: 12, color: '404040' }, '테두리를 굵은 선으로 했습니다'); }); btn(gb, '테두리 없음', function () { bord({ on: false }, '테두리를 없앴습니다'); });
        btn(gb, '첫 줄을 제목 줄로', function () { var q = need(); if (!q) return; op('표 제목 줄', function (x) { var t = ST.headerRow(x, q.a); return t.err ? t : t.xml; }, '첫 줄을 굵게·회색 배경으로 했습니다', true); }, 'wide');
        tableExtras(body);
        body.appendChild(el('div', 'so-sheet-note', '칸 폭은 표 전체 폭(종이 안)을 그대로 두고 나눕니다. 합쳐진 칸이 있는 표는 줄·칸 넣고 빼기를 막고 「수정 요청」을 안내합니다. 표를 붙일 때는 표 밖 문단을 먼저 고릅니다.'));
      }, false, true);
    }

    // ---------------- 차트(v10.9) ----------------
    function chartOn() { return !!(ctx().flag && ctx().flag('chart')); }
    function loadChart() { return ctx().loadScript('js/smartoffice/so-chart.js').then(function () { ctx().loadCss('js/smartoffice/so-chart.css'); return global.SOChart; }); }
    function chartNew() {
      var r = need(); if (!r) return;
      loadChart().then(function (C) {
        C.openEditor({ ctx: ctx(), title: '차트 넣기', spec: C.sampleFor('col'), mode: 'table', applyLabel: '차트 넣기',
          note: '숫자를 고쳐 적으면 위의 그림이 바로 바뀝니다. 고른 문단 아래에 글자처럼 들어가고, 워드에서 열어 「데이터 편집」으로도 고칠 수 있습니다.',
          onApply: function (sp) { env.run('차트', function (pkg) { return ST.addChart(pkg, r.b, sp); }, function (q) { if (q && q.err) { fail(q.err); return; } if (q && q.xi != null) env.select(q.xi, q.xi); toast('차트를 문단 아래에 넣었습니다 — 그 문단을 눌러 「그림」→「차트 고치기」', 3600); }); } });
      }).catch(function (e) { toast('차트 부품을 불러오지 못했습니다: ' + ((e && e.message) || e), 4200); });
    }
    function chartEdit() {
      var r = need(); if (!r) return;
      loadChart().then(function (C) { return env.peek(function (pkg) { return ST.readChart(pkg, r.a); }).then(function (x) { return { C: C, x: x }; }); }).then(function (z) {
        var C = z.C, x = z.x; if (x.err) { toast(x.err, 3600); return; }
        if (!x.info.ok) { fail(x.info.why); return; }
        function openIt() {
          C.openEditor({ ctx: ctx(), title: '차트 고치기', spec: x.info.spec, mode: 'table', applyLabel: '적용', note: '고치면 파일 안의 차트와 딸린 데이터가 함께 바뀝니다.',
            onDelete: function () { setTimeout(chartDel, 60); return true; },
            onApply: function (sp) { env.run('차트 고치기', function (pkg) { return ST.updateChart(pkg, r.a, sp); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('차트를 고쳤습니다', 2400); }); } });
        }
        if (!x.mine) ctx().confirm('차트를 고치기 전에', '이 차트는 이 앱에서 만든 것이 아니라서, 고치면 글꼴·그림자 같은 세부 서식이 기본 모양으로 정리될 수 있습니다. 숫자·제목·색·종류는 그대로 남습니다. 계속할까요?', '계속', openIt, { cancelLabel: '취소' });
        else openIt();
      }).catch(function (e) { toast('차트를 열지 못했습니다: ' + ((e && e.message) || e), 4200); });
    }
    function chartDel() {
      var r = need(); if (!r) return;
      env.run('차트 지우기', function (pkg) { return ST.removeChart(pkg, r.a); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('차트를 지웠습니다(되돌리려면 ↶)', 2600); });
    }
    // ---------------- 그림 ----------------
    function pickPicture() {
      var r = need(); if (!r) return;
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () { var f = inp.files && inp.files[0]; if (!f) return; prep(f).then(function (im) {
        env.run('그림', function (pkg) { return ST.addPicture(pkg, r.b, im.bytes, im.ext, im.w, im.h).then(function () { return {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('그림을 문단 아래에 글자처럼 넣었습니다', 3000); });
      }, function (e) { toast('그림을 읽지 못했습니다: ' + ((e && e.message) || e), 4200); }); };
      inp.click();
    }
    function prep(f) {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight, ty = (f.type || '').toLowerCase(), keep = /^image\/(png|jpeg|gif)$/.test(ty) && w <= 1600 && f.size < 3000000;
          if (keep) { f.arrayBuffer().then(function (ab) { URL.revokeObjectURL(url); res({ bytes: new Uint8Array(ab), ext: ty === 'image/png' ? 'png' : (ty === 'image/gif' ? 'gif' : 'jpg'), w: w, h: h }); }, rej); return; }
          var k = Math.min(1, 1600 / w), cw = Math.round(w * k), ch = Math.round(h * k), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function (b) { URL.revokeObjectURL(url); if (!b) { rej(new Error('그림을 줄이지 못함')); return; } b.arrayBuffer().then(function (ab) { res({ bytes: new Uint8Array(ab), ext: 'jpg', w: cw, h: ch }); }, rej); }, 'image/jpeg', 0.85);
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('이 그림 형식은 열 수 없습니다')); }; img.src = url;
      });
    }
    function picSheet() {
      sheet('그림', function (body) {
        var g = grid(body);
        btn(g, '그림 넣기(사진·파일)', pickPicture, 'big');
        if (chartOn()) { btn(g, '차트 넣기', chartNew, 'big'); btn(g, '차트 고치기', chartEdit, 'big'); btn(g, '차트 지우기', chartDel, 'big danger'); }
        btn(g, '도형 넣기·고치기', xcall('shapeSheet'), 'big');
        btn(g, '그림 지우기', function () { var r = need(); if (!r) return; op('그림 지우기', function (x) { return ST.removePicture(x, r.a); }, '그림을 지웠습니다(되돌리려면 ↶)', true); }, 'big danger');
        btn(g, '크게 ×1.25', function () { var r = need(); if (!r) return; op('그림 크기', function (x) { return ST.scalePicture(x, r.a, 1.25); }, '그림을 키웠습니다', true); }, 'big');
        btn(g, '작게 ×0.8', function () { var r = need(); if (!r) return; op('그림 크기', function (x) { return ST.scalePicture(x, r.a, 0.8); }, '그림을 줄였습니다', true); }, 'big');
        picExtras(body);
        body.appendChild(el('div', 'so-sheet-note', '그림은 고른 문단 아래에 「글자처럼」 들어갑니다(글을 가리지 않습니다). 크기·지우기는 그림이 든 문단을 고른 뒤 누릅니다. 글 위에 떠 있는 그림은 크기를 바꿀 수 없습니다.'));
      });
    }
    // ---------------- 머리글·바닥글 ----------------
    function hfSheet() {
      Promise.all([env.readHF('header'), env.readHF('footer')]).then(function (r) {
        var body = el('div', 'sdx'), th = el('textarea', 'sdx-in'), tf = el('textarea', 'sdx-in');
        function fill(t, h) { t.rows = 2; t.value = h.has ? h.paras.map(function (p) { return p.text; }).join('\n') : ''; }
        fill(th, r[0]); fill(tf, r[1]); th.setAttribute('aria-label', '머리글'); tf.setAttribute('aria-label', '바닥글'); th.placeholder = '머리글에 들어갈 글'; tf.placeholder = '바닥글에 들어갈 글';
        body.appendChild(el('div', 'sdx-l', '머리글')); body.appendChild(th); body.appendChild(el('div', 'sdx-l', '바닥글')); tf.value = tf.value; body.appendChild(tf);
        var pn = [];
        r.forEach(function (h) { if (h.has) h.paras.forEach(function (p) { if (p.hasField || p.hasPic) pn.push(1); }); });
        if (pn.length) body.appendChild(el('div', 'so-sheet-note', '쪽 번호·그림이 든 줄은 그대로 두고 글만 있는 줄만 바뀝니다.'));
        var g = grid(body), pb = el('button', 'sdx-b big', r[1].has && r[1].page ? '쪽 번호는 이미 있음' : '바닥글에 쪽 번호 넣기'); pb.type = 'button'; if (r[1].has && r[1].page) pb.disabled = true;
        pb.onclick = function () { ctx().closeSheet(); env.run('쪽 번호', function (pkg) { return ST.addPageNumber(pkg); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('바닥글 가운데에 쪽 번호를 넣었습니다', 3000); }); };
        g.appendChild(pb);
        pageGroup(body);
        ctx().sheet({ title: '머리글·바닥글·쪽 설정', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '글 저장', primary: true, onClick: function () {
          var hv = th.value, fv = tf.value;
          env.run('머리글·바닥글', function (pkg) {
            var jobs = Promise.resolve();
            if (hv !== th.defaultValue || !r[0].has && hv) jobs = jobs.then(function () { return ST.setHF(pkg, 'header', hv.split(/\r?\n/)); });
            if (fv !== tf.defaultValue || !r[1].has && fv) jobs = jobs.then(function () { return ST.setHF(pkg, 'footer', fv.split(/\r?\n/)); });
            return jobs.then(function () { return {}; });
          }, function (q) { if (q && q.err) { fail(q.err); return; } toast('머리글·바닥글을 저장했습니다', 2800); });
        } }] });
      });
    }
    // ---------------- 찾아 바꾸기 ----------------
    function replSheet() {
      var body = el('div', 'sdx'), a = el('input', 'sdx-in'), b = el('input', 'sdx-in'); a.type = b.type = 'text'; a.placeholder = '찾을 글'; b.placeholder = '바꿀 글(비우면 지웁니다)'; a.setAttribute('aria-label', '찾을 글'); b.setAttribute('aria-label', '바꿀 글');
      body.appendChild(a); body.appendChild(b); var out = el('div', 'so-sheet-note', '글만 있는 문단에서 바꿉니다. 표·그림·필드가 섞여 바꿀 수 없는 문단은 건너뛰고 몇 곳인지 알려 드립니다. 바꾼 뒤 「사본 저장」으로 저장합니다.'); body.appendChild(out);
      ctx().sheet({ title: '찾아 바꾸기', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '모두 바꾸기', primary: true, onClick: function () {
        if (!a.value) { toast('찾을 글을 적어 주십시오.', 2400); return false; }
        var r = env.replaceAll(a.value, b.value); toast(r.n ? r.n + '개 문단에서 바꿨습니다' + (r.skip ? ' (바꿀 수 없는 문단 ' + r.skip + '개는 건너뜀)' : '') : (r.skip ? '찾은 곳 ' + r.skip + '개는 그림·필드가 섞여 있어 폰에서 바꿀 수 없습니다.' : '찾는 글이 없습니다.'), 4200);
      } }] });
      setTimeout(function () { try { a.focus(); } catch (e) {} }, 300);
    }
    function rangeBtn() { env.toggleRange(); }

    // ---------------- v10.8(3회차): 기호·날짜 · 책갈피 · 그림·표 이름 · 목차 · 메모 · 변경 내용 ----------------
    var fclip = null;                                    // 「이 문단 서식 담기」로 담아 둔 서식
    function mm(tw) { return Math.round(tw / 56.7 * 10) / 10; }
    function symSheet() {
      var r = need(); if (!r) return;
      sheet('기호·날짜 넣기 — 고른 문단 끝에', function (body) {
        ST.SYMBOLS.forEach(function (g) {
          var row = group(body, g[0]); g[1].forEach(function (s) { btn(row, s, function () { op('기호', function (x) { return ST.appendText(x, r.b, s); }, J('「' + s + '」', '을') + ' 문단 끝에 넣었습니다', true); }); });
        });
        var gd = group(body, '날짜·시각(지금)'); ST.dateChoices().forEach(function (s) { btn(gd, s, function () { op('날짜', function (x) { return ST.appendText(x, r.b, s); }, J('「' + s + '」', '을') + ' 문단 끝에 넣었습니다', true); }); });
        body.appendChild(el('div', 'so-sheet-note', '고른 문단 맨 끝에 들어갑니다. 문장 가운데에 넣으려면 문단을 한 번 더 눌러 「문단 고치기」를 열고 「기호」 단추를 누르십시오.'));
      }, false, true);
    }
    function bookmarkSheet() {
      var r = need(); if (!r) return;
      var list = []; try { list = ST.listBookmarks(S().xml); } catch (e) {}
      var body = el('div', 'sdx'), a = el('input', 'sdx-in'); a.type = 'text'; a.placeholder = '책갈피 이름(예: 결과표)'; a.setAttribute('aria-label', '책갈피 이름');
      body.appendChild(el('div', 'sdx-l', '고른 문단에 책갈피 만들기')); body.appendChild(a);
      body.appendChild(el('div', 'so-sheet-note', '이름은 글자로 시작하고 글자·숫자·밑줄만 씁니다(띄어쓰기는 밑줄로 바뀝니다). 책갈피를 만든 뒤에는 아래 목록에서 책갈피를 눌러, 그 책갈피로 가는 링크를 문단 끝에 넣을 수 있습니다.'));
      if (list.length) {
        body.appendChild(el('div', 'sdx-l', '이 문서의 책갈피 ' + list.length + '개 — 누르면 링크 넣기·지우기'));
        var g = el('div', 'sdx-g'); body.appendChild(g);
        list.forEach(function (bm) { var b = el('button', 'sdx-b big', bm.name + ' (' + (bm.para + 1) + '번 문단)'); b.type = 'button'; b.onclick = function () { ctx().closeSheet(); setTimeout(function () { bookmarkItem(bm, r); }, 60); }; g.appendChild(b); });
      }
      ctx().sheet({ title: '책갈피', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '만들기', primary: true, onClick: function () {
        var nm = a.value; op('책갈피', function (x) { var q = ST.addBookmark(x, r.b, nm); return q.err ? q : { xml: q.xml }; }, '책갈피를 만들었습니다', true);
      } }] });
    }
    function bookmarkItem(bm, r) {
      var body = el('div', 'sdx'), a = el('input', 'sdx-in'); a.type = 'text'; a.placeholder = '링크로 보일 글'; a.value = bm.name; a.setAttribute('aria-label', '링크로 보일 글');
      body.appendChild(el('div', 'sdx-l', '「' + bm.name + '」로 가는 링크를 고른 문단 끝에 넣기')); body.appendChild(a);
      ctx().sheet({ title: '책갈피 「' + bm.name + '」', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '책갈피 지우기', onClick: function () {
        op('책갈피 지우기', function (x) { var q = ST.deleteBookmark(x, bm.name); return q.err ? q : { xml: q.xml }; }, '책갈피를 지웠습니다(되돌리려면 ↶)', true);
      } }, { label: '링크 넣기', primary: true, onClick: function () {
        var tx = a.value; op('책갈피 링크', function (x) { var q = ST.addAnchorLink(x, r.b, tx, bm.name); return q.err ? q : { xml: q.xml }; }, '문서 안 링크를 넣었습니다', true);
      } }] });
    }
    // ---- 상호 참조: 제목·그림/표 이름·책갈피를 가리키는 글(REF 필드)을 고른 문단 끝에 넣는다 ----
    function refSheet() {
      var r = need(); if (!r) return; var mode = 'all';
      env.peek(function (pkg) { return pkg.read('word/styles.xml'); }).then(function (sx) {
        var list = []; try { list = ST.refTargets(S().xml, sx || ''); } catch (e) {}
        var body = el('div', 'sdx');
        body.appendChild(el('div', 'sdx-l', '고른 문단 맨 끝에 넣을 참조 — 무엇을 가리킬까요?'));
        var gm = group(body, '넣을 모양'), bm = {};
        [['all', '글 전체(예: 제목·이름 글)'], ['num', '이름표와 번호만(예: 그림 1)'], ['page', '쪽 번호(예: 3)']].forEach(function (k) { var b = el('button', 'sdx-b', k[1]); b.type = 'button'; b.onclick = function () { mode = k[0]; paint(); }; gm.appendChild(b); bm[k[0]] = b; });
        function paint() { Object.keys(bm).forEach(function (k) { bm[k].classList.toggle('on', mode === k); }); } paint();
        if (!list.length) body.appendChild(el('div', 'so-sheet-note', '가리킬 것이 없습니다. 제목 스타일을 쓴 문단, 「그림·표 이름」을 넣은 문단, 책갈피가 있으면 여기에 나타납니다.'));
        var g = el('div', 'sdx-g'); body.appendChild(g);
        list.slice(0, 80).forEach(function (t) {
          var b = el('button', 'sdx-b big', t.label); b.type = 'button';
          b.onclick = function () { ctx().closeSheet(); setTimeout(function () {
            op('상호 참조', function (x) { var q = ST.addCrossRef(x, r.b, t, mode === 'page' ? 'page' : (t.kind === 'caption' ? mode : 'all'), mode === 'page' ? (env.pageOf(t.xi) || 1) : 0); return q.err ? q : { xml: q.xml }; }, '상호 참조를 넣었습니다(글이 바뀌면 워드에서 「필드 업데이트」로 따라 바뀝니다)', true);
          }, 60); };
          g.appendChild(b);
        });
        body.appendChild(el('div', 'so-sheet-note', '「쪽 번호」는 가리키는 곳이 있는 쪽 번호(폰 화면 기준)를 넣는 진짜 쪽 번호 참조입니다(워드에서 「필드 업데이트」로 맞춤). 넣은 글은 눌러 가는 링크(워드에서 Ctrl+누르기)이며, 가리키는 제목·이름의 글이 나중에 바뀌면 워드에서 「필드 업데이트」를 해 주십시오. 폰 화면에서는 넣을 때의 글이 보입니다. 이름표와 번호만은 「그림·표 이름」을 넣은 문단에서만 됩니다.'));
        ctx().sheet({ title: '상호 참조', body: body, wide: true, buttons: [{ label: '닫기' }] });
      });
    }
    function captionSheet() {
      var r = need(); if (!r) return; var lab = '그림', pos = 'below', touched = false;
      var body = el('div', 'sdx'), t = el('input', 'sdx-in'); t.type = 'text'; t.placeholder = '이름 글(예: 실험 장치 구성)'; t.setAttribute('aria-label', '이름 글');
      var gl = group(body, '이름표'), gp = group(body, '자리'), bl = {}, bp = {};
      function paint() { ['그림', '표'].forEach(function (k) { bl[k].classList.toggle('on', lab === k); }); ['above', 'below'].forEach(function (k) { bp[k].classList.toggle('on', pos === k); }); }
      ['그림', '표'].forEach(function (k) { var b = el('button', 'sdx-b', k); b.type = 'button'; b.onclick = function () { lab = k; if (!touched) pos = k === '표' ? 'above' : 'below'; paint(); }; gl.appendChild(b); bl[k] = b; });
      [['above', '고른 문단·표 위'], ['below', '고른 문단·표 아래']].forEach(function (k) { var b = el('button', 'sdx-b', k[1]); b.type = 'button'; b.onclick = function () { pos = k[0]; touched = true; paint(); }; gp.appendChild(b); bp[k[0]] = b; });
      body.appendChild(el('div', 'sdx-l', '이름 글')); body.appendChild(t);
      body.appendChild(el('div', 'so-sheet-note', '「그림 1」「표 1」처럼 번호가 자동으로 붙고, 중간에 하나를 넣으면 뒤 번호가 순서대로 다시 매겨집니다. 그림 이름은 보통 아래, 표 이름은 보통 위에 둡니다. 표 안의 칸을 고르면 표 전체의 위·아래에 들어갑니다.'));
      paint();
      ctx().sheet({ title: '그림·표 이름 넣기', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '넣기', primary: true, onClick: function () {
        var tx = t.value, lb = lab, ab = pos === 'above';
        env.run('이름 넣기', function (pkg) { return ST.addCaption(pkg, r.b, lb, tx, ab).then(function (q) { return q.err ? q : { newXi: q.newXi }; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('「' + lb + '」 이름을 넣었습니다', 2600); if (q && q.newXi != null) env.select(q.newXi, q.newXi); });
      } }] });
      setTimeout(function () { try { t.focus(); } catch (e) {} }, 300);
    }
    function tocNow() { var r = need(); if (!r) return; var has = false; try { has = !!ST.tocField(S().xml); } catch (e) {}
      if (has) { env.run('목차 갱신', function (pkg) { return ST.updateToc(pkg).then(function (q) { return q.err ? q : { n: q.n }; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('목차를 갱신했습니다(제목 ' + q.n + '개). 쪽 번호는 워드에서 열어 「필드 업데이트」를 하면 정확해집니다.', 5200); }); }
      else { env.run('목차 넣기', function (pkg) { return ST.insertToc(pkg, r.b).then(function (q) { return q.err ? q : { n: q.n }; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('고른 문단 아래에 목차를 넣었습니다(제목 ' + q.n + '개). 쪽 번호는 워드에서 열어 「필드 업데이트」를 하면 채워집니다.', 5200); }); }
    }
    // ---- 검토: 메모 · 변경 내용 ----
    function fmtDate(s) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return m ? m[1] + '.' + (+m[2]) + '.' + (+m[3]) + '.' : ''; }
    function reviewSheet() {
      env.peek(function (pkg) { return Promise.all([ST.readComments(pkg), pkg.read('word/document.xml'), ST.readTrack(pkg)]); }).then(function (res) {
        var cms = res[0], chs = ST.listChanges(res[1]), trk = res[2], body = el('div', 'sdx'), r = rg();
        body.appendChild(el('div', 'sdx-l', '메모(고른 문단에 달기)'));
        var t = el('textarea', 'sdx-in'); t.rows = 2; t.placeholder = '메모 내용'; t.setAttribute('aria-label', '메모 내용'); body.appendChild(t);
        var g0 = grid(body), add = el('button', 'sdx-b big on', '고른 문단에 메모 달기'); add.type = 'button';
        add.onclick = function () {
          var q = need(); if (!q) return; var tx = t.value; if (!tx.trim()) { toast('메모 내용을 적어 주십시오.', 2400); return; }
          env.run('메모', function (pkg) { return ST.addComment(pkg, q.b, tx).then(function (z) { return z.err ? z : {}; }); }, function (z) { if (z && z.err) { fail(z.err); return; } toast('메모를 달았습니다(워드·한컴에서 메모로 보입니다)', 2800); });
        };
        g0.appendChild(add);
        if (cms.length) {
          body.appendChild(el('div', 'sdx-l', '이 문서의 메모 ' + cms.length + '개 — 누르면 보고 고치거나 지웁니다'));
          var g = el('div', 'sdx-g'); body.appendChild(g);
          cms.forEach(function (c, i) { var b = el('button', 'sdx-b big', (i + 1) + '. ' + (c.text.length > 24 ? c.text.slice(0, 24) + '…' : c.text || '(빈 메모)') + (c.author ? ' — ' + c.author : '')); b.type = 'button'; b.onclick = function () { ctx().closeSheet(); setTimeout(function () { commentEdit(c, i + 1); }, 60); }; g.appendChild(b); });
        }
        body.appendChild(el('div', 'sdx-l', '변경 내용(변경 추적으로 고친 곳)'));
        var cnt = { ins: 0, del: 0, fmt: 0, move: 0, other: 0 }; chs.forEach(function (c) { cnt[c.kind]++; });
        body.appendChild(el('div', 'so-sheet-note', chs.length ? '변경 ' + chs.length + '곳 — 추가 ' + cnt.ins + ' · 삭제 ' + cnt.del + ' · 서식 ' + cnt.fmt + (cnt.move ? ' · 이동 ' + cnt.move : '') + (cnt.other ? ' · 기타 ' + cnt.other : '') + '. 변경이 든 문단은 폰에서 글을 직접 고칠 수 없고, 여기서 수락·거절한 뒤에 고칠 수 있습니다.' : '이 문서에는 변경 추적 기록이 없습니다.'));
        if (chs.length) {
          var g2 = grid(body);
          btn2(g2, '모두 수락', function () { resolveAll(true); }, 'big'); btn2(g2, '모두 거절', function () { resolveAll(false); }, 'big danger');
          btn2(g2, '하나씩 보기', function () { ctx().closeSheet(); setTimeout(function () { changeList(chs); }, 60); }, 'big wide');
        }
        var xm = XM(); body.appendChild(el('div', 'sdx-l', '점검·비교'));
        if (xm) { xm.reviewButtons(body); xm.trackGroup(body, trk); }
        else body.appendChild(el('div', 'so-sheet-note', '이 앱에서 직접 고친 내용은 변경 기록으로 남기지 않고 바로 반영합니다.'));
        ctx().sheet({ title: '메모·변경 내용', body: body, wide: true, buttons: [{ label: '닫기' }] });
      });
    }
    function btn2(row, text, fn, cls) { var b = el('button', 'sdx-b' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { ctx().closeSheet(); setTimeout(fn, 60); }; row.appendChild(b); return b; }
    function resolveAll(accept) {
      ctx().confirm(accept ? '변경 내용을 모두 수락하시겠습니까?' : '변경 내용을 모두 거절하시겠습니까?', (accept ? '추가된 글은 남고 삭제된 글은 사라집니다.' : '추가된 글은 사라지고 삭제된 글은 되살아납니다.') + '\n직후에는 ↶ 로 되돌릴 수 있습니다.', accept ? '모두 수락' : '모두 거절', function () {
        op('변경 처리', function (x) {
          var q = ST.resolveChanges(x, accept, null), nx = q.xml, extra = 0;
          if (!accept) { var f = ST.revertFormatChanges(nx); nx = f.xml; extra = f.n; }
          return { xml: nx, done: q.done, skipped: q.skipped - extra < 0 ? 0 : q.skipped - extra, extra: extra };
        }, function (q) { return (accept ? '수락' : '거절') + ' ' + (q.done + q.extra) + '곳' + (q.skipped ? ' — 폰에서 처리할 수 없는 ' + q.skipped + '곳(문단 합침·표 줄 변경 등)은 그대로 남았습니다. 워드에서 처리해 주십시오.' : ''); });
      });
    }
    function changeList(chs) {
      var KIND = { ins: '추가', del: '삭제', fmt: '서식', move: '이동', other: '기타' };
      var body = el('div', 'sdx'), shown = chs.slice(0, 80);
      body.appendChild(el('div', 'so-sheet-note', '변경 ' + chs.length + '곳' + (chs.length > shown.length ? ' 중 앞의 ' + shown.length + '곳' : '') + '. 하나씩 수락하거나 거절하면 목록이 새로 만들어집니다.'));
      shown.forEach(function (c) {
        var row = el('div', 'sdx-chg'), lab = el('div', 'sdx-chl'); lab.textContent = '[' + KIND[c.kind] + '] ' + (c.mark ? '문단 부호 변경' : (c.text ? (c.text.length > 40 ? c.text.slice(0, 40) + '…' : c.text) : (c.kind === 'fmt' ? '글자·문단 모양 바꿈' : '(내용 없음)'))) + ' · ' + (c.para >= 0 ? (c.para + 1) + '번 문단' : '') + (c.author ? ' · ' + c.author : '') + (c.date ? ' · ' + fmtDate(c.date) : '');
        row.appendChild(lab);
        var rr = el('div', 'sdx-r');
        [['수락', true], ['거절', false]].forEach(function (a) { var b = el('button', 'sdx-b' + (a[1] ? ' on' : ''), a[0]); b.type = 'button'; b.onclick = function () { ctx().closeSheet(); setTimeout(function () { resolveOne(c, a[1]); }, 60); }; rr.appendChild(b); });
        row.appendChild(rr); body.appendChild(row);
      });
      ctx().sheet({ title: '변경 내용 하나씩', body: body, wide: true, buttons: [{ label: '닫기' }] });
    }
    function resolveOne(c, accept) {
      env.run('변경 처리', function (pkg) { return pkg.read('word/document.xml').then(function (x) {
        var q = ST.resolveChanges(x, accept, c.ord); if (!q.done) return { err: q.skipped ? (c.kind === 'fmt' ? '서식 변경은 하나씩 거절할 수 없습니다. 「모두 거절」을 쓰거나 수락해 주십시오.' : '이 변경은 문단을 합치거나 표 줄을 바꾸는 것이라 폰에서는 처리할 수 없습니다. 워드에서 처리해 주십시오.') : '변경을 찾지 못했습니다.' };
        pkg.write('word/document.xml', q.xml); return {};
      }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast((accept ? '수락' : '거절') + '했습니다', 2200); setTimeout(reviewList2, 400); });
    }
    function reviewList2() { env.peek(function (pkg) { return pkg.read('word/document.xml'); }).then(function (x) { var chs = ST.listChanges(x); if (chs.length) changeList(chs); else toast('남은 변경 내용이 없습니다.', 2400); }); }
    function commentEdit(c, no) {
      var body = el('div', 'sdx'), t = el('textarea', 'sdx-in'); t.rows = 4; t.value = c.text; t.setAttribute('aria-label', '메모 내용');
      body.appendChild(el('div', 'sdx-l', '메모 ' + no + (c.author ? ' — ' + c.author : '') + (c.date ? ' · ' + fmtDate(c.date) : ''))); body.appendChild(t);
      ctx().sheet({ title: '메모 ' + no, body: body, wide: true, buttons: [{ label: '닫기' }, { label: '지우기', onClick: function () {
        env.run('메모 지우기', function (pkg) { return ST.deleteComment(pkg, c.id).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('메모를 지웠습니다(되돌리려면 ↶)', 2800); });
      } }, { label: '저장', primary: true, onClick: function () {
        var tx = t.value; env.run('메모', function (pkg) { return ST.editComment(pkg, c.id, tx).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('메모를 고쳤습니다', 2600); });
      } }] });
    }
    // ---- 표: 열 너비·줄 높이·맞춤·모양(표 시트 안에 얹는다) ----
    function tableExtras(body) {
      var q = rg(), gi = null; if (q) { try { gi = ST.tableGeomInfo(S().xml, q.a); } catch (e) {} }
      function te2(label, fn, msg) { return function () { var z = need(); if (!z) return; op(label, function (x) { var t = fn(x, z.a); return t.err ? t : { xml: t.xml }; }, msg, true); }; }
      var gw = group(body, '열 너비' + (gi ? ' — 고른 칸의 열 ' + (gi.colIdx + 1) + '번째: ' + mm(gi.widths[gi.colIdx]) + 'mm (표 전체 ' + mm(gi.total) + 'mm)' : ' (표 안의 칸을 먼저 고르십시오)'));
      [['− 10mm', -567], ['− 3mm', -170], ['＋ 3mm', 170], ['＋ 10mm', 567]].forEach(function (a) { btn(gw, a[0], te2('열 너비', function (x, xi) { return ST.setColWidth(x, xi, { delta: a[1] }); }, '열 너비를 바꿨습니다(옆 열이 그만큼 줄거나 늘었습니다)')); });
      btn(gw, '모든 열 같게', te2('열 너비', function (x, xi) { return ST.setColWidth(x, xi, { equal: true }); }, '모든 열을 같은 너비로 했습니다')); btn(gw, '본문 폭에 맞춤', te2('열 너비', function (x, xi) { return ST.setColWidth(x, xi, { fit: true }); }, '표 폭을 본문 폭에 맞췄습니다'));
      var rh = gi && gi.rowH ? (gi.rowH.rule === 'exact' ? '고정 ' : '최소 ') + mm(gi.rowH.val) + 'mm' : '자동';
      var gh = group(body, '고른 줄 높이 — 지금 ' + (gi ? rh : '(표 안의 칸을 먼저 고르십시오)'));
      [['자동', null], ['8mm 이상', 454], ['12mm 이상', 680], ['20mm 이상', 1134]].forEach(function (a) { btn(gh, a[0], te2('줄 높이', function (x, xi) { return ST.setRowHeight(x, xi, { twip: a[1], rule: 'atLeast' }); }, '줄 높이를 바꿨습니다')); });
      var ga = group(body, '표 전체 줄 높이');
      [['모두 자동', null], ['모두 8mm 이상', 454], ['모두 12mm 이상', 680]].forEach(function (a) { btn(ga, a[0], te2('줄 높이', function (x, xi) { return ST.setRowHeight(x, xi, { twip: a[1], rule: 'atLeast', all: true }); }, '표 전체 줄 높이를 바꿨습니다')); });
      var gg = group(body, '표 맞춤(쪽 안에서)');
      [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right']].forEach(function (a) { btn(gg, a[0], te2('표 맞춤', function (x, xi) { return ST.setTableAlign(x, xi, a[1]); }, '표를 ' + a[0] + '에 맞췄습니다')); });
      var gm = group(body, '표 모양');
      [['줄무늬 넣기', 'band', '짝수 줄에 연한 회색 줄무늬를 넣었습니다'], ['줄무늬 빼기', 'bandoff', '줄무늬를 뺐습니다'], ['가로선만(보고서 모양)', 'hlines', '가로선만 남겼습니다']].forEach(function (a) { btn(gm, a[0], te2('표 모양', function (x, xi) { return ST.tableLook(x, xi, a[1]); }, a[2])); });
    }
    // ---- 머리·바닥 시트 안에 얹는 것: 첫 쪽 다르게 · 배경 글자 · 칸 나누기 ----
    function pageExtras(body) {
      var tp = false, wmNow = null, cols = 1; try { tp = ST.readTitlePg(S().xml); cols = ST.readCols(S().xml); } catch (e) {}
      var g1 = group(body, '첫 쪽 다르게 — 지금 ' + (tp ? '켜짐' : '꺼짐'));
      btn(g1, tp ? '첫 쪽도 같게(끄기)' : '첫 쪽 머리글·바닥글 다르게', function () { env.run('첫 쪽', function (pkg) { return ST.setTitlePg(pkg, !tp).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(!tp ? '첫 쪽의 머리글·바닥글이 따로 갑니다(처음에는 비어 있습니다).' : '첫 쪽도 다른 쪽과 같은 머리글·바닥글을 씁니다.', 3600); }); }, tp ? 'on' : '');
      var gs0 = group(body, '문서 통계'); var st0 = null; try { st0 = ST.docStats(S().xml); } catch (e) {}
      if (st0) {
        var pg0 = S().pages || 0;
        [['쪽', pg0 ? pg0 + '쪽(화면 기준)' : '—'], ['글자(공백 포함)', st0.chars.toLocaleString('ko-KR') + '자'], ['글자(공백 뺌)', st0.noSpace.toLocaleString('ko-KR') + '자'], ['낱말', st0.words.toLocaleString('ko-KR') + '개'], ['문단', st0.paras.toLocaleString('ko-KR') + '개'], ['표 · 그림', st0.tables + '개 · ' + st0.pics + '개']].forEach(function (k) { var b = el('div', 'sdx-stat'); b.appendChild(el('span', null, k[0])); b.appendChild(el('b', null, k[1])); gs0.appendChild(b); });
      }
      body.appendChild(el('div', 'so-sheet-note', '쪽 수는 폰 화면에 그려진 기준이라 워드와 한두 쪽 다를 수 있습니다. 글자·낱말 수는 본문과 표 안의 글만 셉니다(각주·머리글 제외, 지운 것으로 표시된 글 제외).'));
      var gp0 = group(body, '읽기 전용 · 편집 제한(암호 없이)');
      env.peek(function (pkg) { return ST.readProt(pkg); }).then(function (pr) {
        if (!pr || !gp0.isConnected) return;
        function setP(kind, on, msg) { env.run('편집 제한', function (pkg) { return ST.setProt(pkg, kind, on).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(msg, 3600); }); }
        btn(gp0, pr.recommend ? '읽기 전용 권장 끄기' : '읽기 전용 권장 켜기', function () { setP('recommend', !pr.recommend, !pr.recommend ? '열 때 「읽기 전용으로 열까요?」 안내가 뜨도록 했습니다(워드)' : '읽기 전용 권장을 껐습니다'); }, pr.recommend ? 'on' : '');
        btn(gp0, pr.edit ? '편집 제한 풀기' : '편집 제한 걸기(읽기만 가능)', function () { setP('edit', !pr.edit, !pr.edit ? '편집을 제한했습니다. 워드에서는 「편집 제한」 창의 「보호 중지」로 풀 수 있습니다(암호 없음)' : '편집 제한을 풀었습니다'); }, pr.edit ? 'on' : '');
      });
      body.appendChild(el('div', 'so-sheet-note', '읽기 전용 권장은 워드에서 열 때 읽기 전용으로 열지 묻고, 편집 제한은 워드에서 글을 고치지 못하게 합니다(암호가 없어 「보호 중지」로 풀 수 있는 가벼운 잠금입니다). 이 앱은 암호를 입력하거나 걸지 않으며, 암호가 걸린 제한은 풀 수 없습니다.'));
      var gw = group(body, '배경 글자(초안·대외비)');
      var wi = el('input', 'sdx-in'); wi.type = 'text'; wi.placeholder = '직접 적기(예: 시험 문제)'; wi.setAttribute('aria-label', '배경 글자'); body.appendChild(wi);
      function setWm(txt, msg) { env.run('배경 글자', function (pkg) { return ST.setWatermark(pkg, txt).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast(msg, 3600); }); }
      ['초안', '대외비', '견본', '사본'].forEach(function (k) { btn(gw, k, function () { setWm(k, J('배경 글자 「' + k + '」', '을') + ' 넣었습니다(워드·PDF에서 보입니다)'); }); });
      btn(gw, '직접 적은 글 넣기', function () { var v = wi.value.trim(); if (!v) { toast('넣을 글을 적어 주십시오.', 2400); return; } setWm(v, '배경 글자를 넣었습니다(워드·PDF에서 보입니다)'); }, 'on'); btn(gw, '배경 글자 없애기', function () { setWm('', '배경 글자를 없앴습니다'); });
      body.appendChild(el('div', 'so-sheet-note', '큰 회색 글자가 쪽마다 비스듬히 깔립니다. 폰 화면의 미리보기에는 보이지 않고 워드·한컴·PDF로 열면 보입니다.'));
      var gc = group(body, '글을 신문처럼 칸 나누기 — 지금 ' + cols + '단');
      [1, 2, 3].forEach(function (n) { btn(gc, '문서 전체 ' + n + '단', function () { env.run('칸 나누기', function (pkg) { return ST.setColumnsWhole(pkg, n).then(function (q) { return q.err ? q : {}; }); }, function (q) { if (q && q.err) { fail(q.err); return; } toast('문서 전체를 ' + n + '단으로 했습니다', 2800); }); }, cols === n ? 'on' : ''); });
      [2, 3].forEach(function (n) { btn(gc, '고른 문단만 ' + n + '단', function () { var q = need(); if (!q) return; op('칸 나누기', function (x) { var t = ST.setColumnsRange(x, q.a, q.b, n); return t.err ? t : { xml: t.xml }; }, '고른 문단만 ' + n + '단으로 했습니다(앞뒤는 이어서 구역으로 나뉩니다)', true); }); });
    }
    // ---- 그림 시트 안에 얹는 것: 크기 · 배치 ----
    function picExtras(body) {
      var q = rg(), lay = null; if (q) { try { lay = ST.readPicLayout(S().xml, q.a); } catch (e) {} }
      var NAMES = { inline: '글자처럼', left: '글 옆(왼쪽)', right: '글 옆(오른쪽)', center: '위아래(가운데)', behind: '글 뒤로', other: '기타(글 감싸기)' };
      var gs = group(body, '그림 크기(본문 폭 대비)' + (lay ? ' — 지금 약 ' + lay.pct + '%' : ' (그림이 든 문단을 먼저 고르십시오)'));
      [25, 50, 75, 100].forEach(function (p) { btn(gs, p + '%', function () { var z = need(); if (!z) return; op('그림 크기', function (x) { var t = ST.setPicWidth(x, z.a, p); return t.err ? t : { xml: t.xml }; }, '그림 폭을 본문의 ' + p + '%로 했습니다', true); }); });
      var gl = group(body, '그림 배치' + (lay ? ' — 지금 ' + NAMES[lay.mode] : ''));
      [['글자처럼', 'inline'], ['글 옆(왼쪽)', 'left'], ['글 옆(오른쪽)', 'right'], ['위아래(가운데)', 'center'], ['글 뒤로', 'behind']].forEach(function (a) { btn(gl, a[0], function () { var z = need(); if (!z) return; op('그림 배치', function (x) { var t = ST.setPicLayout(x, z.a, a[1]); return t.err ? t : { xml: t.xml }; }, '그림을 ' + J('「' + a[0] + '」', '으로') + ' 놓았습니다', true); }, lay && lay.mode === a[1] ? 'on' : ''); });
      body.appendChild(el('div', 'so-sheet-note', '「글 옆」은 그림이 든 문단 바로 아래 글이 그림을 감싸 흐릅니다(워드·한컴에서 같은 모양). 폰 미리보기에서는 모양이 조금 다르게 보일 수 있습니다. 「글 뒤로」는 글 위에 겹치지 않고 글 뒤에 깔립니다.'));
    }
    function fmtPaintGroup(body) {
      var g9 = group(body, '서식 따라 하기' + (fclip ? ' — 담은 서식: 「' + (fclip.text || '빈 문단') + '」' : ''));
      btn(g9, '이 문단 서식 담기', function () { var q = need(); if (!q) return; try { fclip = ST.copyFormat(S().xml, q.a); } catch (e) { toast('서식을 읽지 못했습니다.', 3000); return; } toast('서식을 담았습니다 — 입힐 문단(범위)을 고르고 「서식 붙이기」를 누르십시오.', 4200); setTimeout(refillSheet, 30); });
      btn(g9, '서식 붙이기', function () { var q = need(); if (!q) return; if (!fclip) { toast('먼저 따라 할 문단을 골라 「이 문단 서식 담기」를 누르십시오.', 3600); return; } op('서식 붙이기', function (x) { return ST.pasteFormat(x, q.a, q.b, fclip); }, '서식을 입혔습니다(글 내용은 그대로입니다)', true); }, 'on');
    }
    // ---------------- 도구줄 ----------------
    var ITEMS = {
      para: { g: '¶', l: '문단', run: paraSheet }, style: { g: 'H', l: '스타일', run: styleSheet }, fmt: { g: 'Aa', l: '서식', run: fmtSheet }, list: { g: '≣', l: '목록', run: listSheet },
      table: { g: '▦', l: '표', run: tableSheet }, pic: { g: '▣', l: '그림', run: picSheet }, hf: { g: '▭', l: '머리·바닥', run: hfSheet }, repl: { g: '⇄', l: '바꾸기', run: replSheet }, review: { g: '✎', l: '검토', run: reviewSheet }, range: { g: '⬚', l: '범위', run: rangeBtn }
    };
    var ORDER = ['para', 'style', 'fmt', 'list', 'table', 'pic', 'hf', 'repl', 'review', 'range'];
    function mk(id, hostEl, inSheet) {
      var it = ITEMS[id], b = el('button', inSheet ? 'sdx-mb' : 'sdx-ob'); b.type = 'button'; b.setAttribute('aria-label', it.l); b.dataset.id = id;
      b.appendChild(el('span', 'g', it.g)); b.appendChild(el('span', 'l', it.l));
      b.onclick = function () { if (inSheet) ctx().closeSheet(); setTimeout(it.run, inSheet ? 60 : 0); }; hostEl.appendChild(b); return b;
    }
    function orderNow() { return S() && S().revOnly ? ['review'] : ORDER; }
    function renderRow() {
      var ORD = orderNow(), n = perRow(), shown = ORD.length > n ? ORD.slice(0, n) : ORD, rest = ORD.length > n ? ORD.slice(n) : [];
      U.row.innerHTML = ''; shown.forEach(function (id) { var b = mk(id, U.row, false); if (id === 'range') U.rangeB = b; });
      if (rest.length) { var mb = el('button', 'sdx-ob'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.appendChild(el('span', 'g', '⋯')); mb.appendChild(el('span', 'l', '더보기')); mb.onclick = function () { sheet('더보기', function (body) { var g = el('div', 'sdx-mg'); body.appendChild(g); rest.forEach(function (id) { mk(id, g, true); }); }); }; U.row.appendChild(mb); }
      U.bucket = n; U.revMode = !!(S() && S().revOnly);
    }
    U.mount = function (hostEl) {
      hostEl.innerHTML = ''; U.lab = el('div', 'sdx-lab'); U.row = el('div', 'sdx-row'); hostEl.appendChild(U.lab); hostEl.appendChild(U.row); renderRow(); U.refresh();
      global.addEventListener('resize', function () { if (U.row && U.bucket !== perRow()) { renderRow(); U.refresh(); } });
    };
    U.refresh = function () {
      if (!S()) return;                         // 문서를 닫은 뒤 화면 크기가 바뀌는 때 오는 호출
      if (U.row && U.revMode !== !!S().revOnly) renderRow();
      setTimeout(refillSheet, 0);
      if (!U.lab) return; var r = rg(), s = S();
      if (s && s.revOnly) { U.lab.textContent = '변경 추적 문서입니다 — 「검토」에서 변경 내용을 수락·거절한 뒤에 고칠 수 있습니다'; return; }
      U.lab.textContent = s && s.rangeMode ? '범위의 끝 문단을 눌러 주십시오…' : (r ? '고른 문단 ' + (r.a + 1) + (r.b > r.a ? '~' + (r.b + 1) + ' (' + (r.b - r.a + 1) + '개)' : '') + (r.b === r.a ? ' · 한 번 더 누르면 글 고치기' : '') : '문단을 한 번 누르면 고릅니다 · 점선 문단은 한 번 더 누르면 글을 고칩니다');
      if (s && s.track && !s.rangeMode) U.lab.textContent += ' · 변경 기록 켜짐(글·문단만 기록)';
      if (U.rangeB) { U.rangeB.classList.toggle('on', !!(s && s.rangeMode)); U.rangeB.querySelector('.l').textContent = s && s.rangeMode ? '범위 취소' : '범위'; }
    };
    return U;
  }
  global.SODocxUI = { create: create };
})(window);
