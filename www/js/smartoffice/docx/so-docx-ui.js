/* so-docx-ui.js — S-Office 워드 편집 도구줄·시트(O-0861, v10.6)
 * 고치기를 켰을 때 아래에 나오는 도구줄(문단·스타일·서식·목록·표·그림·머리·바꾸기·범위 + 더보기)과 그 시트들.
 * 실제 문서 고치기는 so-docx-struct.js, 화면 갈아 끼우기·되돌리기·선택은 so-docx.js(env). 한 줄 단추 수: 접은 폰 6 + 더보기 · 펼친 화면 10 · DeX 전부.
 */
(function (global) {
  'use strict';
  var ST = global.SODocxStruct;
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
      });
    }
    function sheet(title, build, noBtn) { var body = el('div', 'sdx'); build(body); ctx().sheet({ title: title, body: body, buttons: noBtn ? [] : [{ label: '닫기' }], wide: true }); return body; }
    function group(body, label) { body.appendChild(el('div', 'sdx-l', label)); var r = el('div', 'sdx-r'); body.appendChild(r); return r; }
    function grid(body) { var g = el('div', 'sdx-g'); body.appendChild(g); return g; }
    function btn(row, text, fn, cls, color) {
      var b = el('button', 'sdx-b' + (cls ? ' ' + cls : ''), color === undefined ? text : ''); b.type = 'button';
      if (color !== undefined) { b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = '#' + color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); }
      b.onclick = function () { ctx().closeSheet(); setTimeout(fn, 60); }; row.appendChild(b); return b;
    }
    function range() { var r = need(); return r; }

    // ---------------- 문단 ----------------
    function paraSheet() {
      var r = need(); if (!r) return;
      sheet('문단 ' + (r.a + 1) + (r.b > r.a ? '~' + (r.b + 1) : ''), function (body) {
        var g = grid(body);
        btn(g, '아래에 문단 넣기', function () { op('문단 넣기', function (x) { var y = ST.insertPara(x, r.b, '', true); return { xml: y, newA: r.b + 1, newB: r.b + 1 }; }, '문단을 하나 넣었습니다', true); }, 'big');
        btn(g, '위에 문단 넣기', function () { op('문단 넣기', function (x) { var y = ST.insertPara(x, r.a, '', false); return { xml: y, newA: r.a, newB: r.a }; }, '문단을 하나 넣었습니다', true); }, 'big');
        btn(g, '문단 지우기', function () { ctx().confirm('고른 문단 ' + (r.b - r.a + 1) + '개를 지우시겠습니까?', '지운 직후에는 ↶ 로 되돌릴 수 있습니다.', '지우기', function () { op('문단 지우기', function (x) { return ST.deleteParas(x, r.a, r.b); }, function (q) { return q.blanked ? '내용을 비웠습니다(칸·본문의 마지막 문단이라 남겼습니다)' : '지웠습니다(되돌리려면 ↶)'; }); }, { danger: true }); }, 'big danger');
        btn(g, '쪽 나누기 넣기', function () { op('쪽 나누기', function (x) { return ST.pageBreakAfter(x, r.b); }, '쪽 나누기를 넣었습니다', true); }, 'big');
        btn(g, '위로 옮기기', function () { op('문단 옮기기', function (x) { return ST.moveParas(x, r.a, r.b, -1); }, '위로 옮겼습니다'); }, 'big');
        btn(g, '아래로 옮기기', function () { op('문단 옮기기', function (x) { return ST.moveParas(x, r.a, r.b, 1); }, '아래로 옮겼습니다'); }, 'big');
        if (r.a === r.b) btn(g, '글 고치기', function () { env.editText(r.a); }, 'big');
        body.appendChild(el('div', 'so-sheet-note', '문서에서 문단을 눌러 고르면 맨 위에 「고른 문단」이 보입니다. 여러 문단은 「범위」로 고릅니다. 같은 문단을 한 번 더 누르면 글 고치기가 열립니다.'));
      });
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
      });
    }
    // ---------------- 서식 ----------------
    function fmtNow() { var r = rg(), s = S(); if (!r || !s.xml) return {}; try { return ST.readFmt(s.xml, r.a); } catch (e) { return {}; } }
    function applyRun(f, msg) { var r = need(); if (!r) return; op('글자 서식', function (x) { return ST.setRunFmt(x, r.a, r.b, f); }, msg || '서식을 바꿨습니다', true); }
    function applyPara(f, msg) { var r = need(); if (!r) return; op('문단 서식', function (x) { return ST.setParaFmt(x, r.a, r.b, f); }, msg || '서식을 바꿨습니다', true); }
    function fmtSheet() {
      var r = need(); if (!r) return; var cur = fmtNow();
      sheet('서식 — 고른 문단 전체에 적용', function (body) {
        var g1 = group(body, '글자');
        btn(g1, '굵게', function () { applyRun({ bold: !cur.bold }); }, 'bold' + (cur.bold ? ' on' : '')); btn(g1, '기울임', function () { applyRun({ italic: !cur.italic }); }, 'it' + (cur.italic ? ' on' : '')); btn(g1, '밑줄', function () { applyRun({ underline: !cur.underline }); }, 'ul' + (cur.underline ? ' on' : ''));
        var g2 = group(body, '글자 크기(' + (cur.size ? cur.size + 'pt' : '스타일 기본') + ')');
        btn(g2, '작게 −', function () { applyRun({ size: Math.max(6, (cur.size || 11) - 1) }); }); btn(g2, '크게 ＋', function () { applyRun({ size: Math.min(120, (cur.size || 11) + 1) }); });
        SIZES.forEach(function (z) { btn(g2, String(z), function () { applyRun({ size: z }); }, cur.size === z ? 'on' : ''); });
        var g3 = group(body, '글자 색'); TXT.forEach(function (c) { btn(g3, c[0], function () { applyRun({ color: c[1] }, '글자 색을 바꿨습니다'); }, 'sw', c[1] || ''); });
        var g4 = group(body, '형광펜'); HL.forEach(function (c) { btn(g4, c[0], function () { applyRun({ highlight: c[1] }, '형광펜을 바꿨습니다'); }, c[1] ? '' : ''); });
        var g5 = group(body, '글꼴'); FONTS.forEach(function (f) { btn(g5, f, function () { applyRun({ font: f }, '글꼴을 바꿨습니다'); }); });
        var g6 = group(body, '정렬'); [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right'], ['양쪽', 'both']].forEach(function (a) { btn(g6, a[0], function () { applyPara({ align: a[1] }); }, cur.align === a[1] ? 'on' : ''); });
        var g7 = group(body, '줄 간격'); [1, 1.15, 1.5, 2].forEach(function (v) { btn(g7, String(v), function () { applyPara({ line: v }, '줄 간격을 ' + v + '로 바꿨습니다'); }); });
        var g8 = group(body, '들여쓰기'); btn(g8, '← 내어쓰기', function () { applyPara({ indent: -1 }); }); btn(g8, '들여쓰기 →', function () { applyPara({ indent: 1 }); }); btn(g8, '초기화', function () { applyPara({ indent: 0 }); });
        body.appendChild(el('div', 'so-sheet-note', '한 문단의 글자 일부만 다르게 꾸미는 것은 이번 판에서는 지원하지 않습니다(문단 전체에 적용). 필요하면 「수정 요청」으로 맡겨 주십시오.'));
      });
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
      });
    }
    // ---------------- 표 ----------------
    function tableSheet() {
      var r = rg();
      sheet('표', function (body) {
        var g0 = group(body, '새 표 넣기(고른 문단 아래)');
        var rows = 3, cols = 3, lab = el('div', 'sdx-l', ''); function paint() { lab.textContent = '줄 ' + rows + ' × 칸 ' + cols; }
        var rr = el('div', 'sdx-r'); function step(t, f) { var b = el('button', 'sdx-b', t); b.type = 'button'; b.onclick = function () { f(); paint(); }; rr.appendChild(b); }
        body.appendChild(lab); body.appendChild(rr); step('줄 −', function () { rows = Math.max(1, rows - 1); }); step('줄 ＋', function () { rows = Math.min(20, rows + 1); }); step('칸 −', function () { cols = Math.max(1, cols - 1); }); step('칸 ＋', function () { cols = Math.min(8, cols + 1); }); paint();
        var ok = el('button', 'sdx-b big on', '표 넣기'); ok.type = 'button'; ok.onclick = function () {
          var q = need(); if (!q) return; ctx().closeSheet();
          env.run('표', function (pkg) { return ST.ensureStyle(pkg, 'tablegrid').then(function (sid) { return pkg.read('word/document.xml').then(function (x) { var t = ST.insertTable(x, q.b, rows, cols, null); if (t.err) return t; pkg.write('word/document.xml', t.xml); return {}; }); }); }, function (z) { if (z && z.err) { fail(z.err); return; } toast('표를 넣었습니다(' + rows + '×' + cols + '). 칸을 눌러 고른 뒤 한 번 더 눌러 글을 넣으십시오.', 3600); env.select(null); });
        }; body.appendChild(ok);
        var info = null; if (r) { try { info = ST.tableInfo(S().xmlNow, r.a); } catch (e) {} }
        var g = grid(body); body.insertBefore(el('div', 'sdx-l', info ? '고른 칸이 든 표: ' + info.rows + '줄 × ' + info.cols + '칸' + (info.merged ? ' (합쳐진 칸 있음)' : '') : '표 안의 칸(문단)을 고르면 아래 단추가 쓰입니다'), g);
        function te(opn, msg) { return function () { var q = need(); if (!q) return; op('표 고치기', function (x) { var t = ST.tableEdit(x, q.a, opn); return t.err ? t : t.xml; }, msg, true); }; }
        btn(g, '위에 줄 추가', te('rowAbove', '줄을 넣었습니다'), 'big'); btn(g, '아래에 줄 추가', te('rowBelow', '줄을 넣었습니다'), 'big');
        btn(g, '줄 지우기', te('rowDel', '줄을 지웠습니다(되돌리려면 ↶)'), 'big danger'); btn(g, '칸 지우기(열)', te('colDel', '칸을 지웠습니다(되돌리려면 ↶)'), 'big danger');
        btn(g, '왼쪽에 칸 추가', te('colLeft', '칸을 넣었습니다'), 'big'); btn(g, '오른쪽에 칸 추가', te('colRight', '칸을 넣었습니다'), 'big');
        btn(g, '오른쪽 칸과 합치기', te('mergeRight', '칸을 합쳤습니다'), 'big'); btn(g, '아래 칸과 합치기', te('mergeDown', '칸을 합쳤습니다'), 'big'); btn(g, '가로 합치기 풀기', te('unmerge', '합친 칸을 풀었습니다'), 'big');
        body.appendChild(el('div', 'so-sheet-note', '칸 폭은 표 전체 폭(종이 안)을 그대로 두고 나눕니다. 합쳐진 칸이 있는 표는 줄·칸 넣고 빼기를 막고 「수정 요청」을 안내합니다.'));
      });
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
        btn(g, '그림 지우기', function () { var r = need(); if (!r) return; op('그림 지우기', function (x) { return ST.removePicture(x, r.a); }, '그림을 지웠습니다(되돌리려면 ↶)', true); }, 'big danger');
        btn(g, '크게 ×1.25', function () { var r = need(); if (!r) return; op('그림 크기', function (x) { return ST.scalePicture(x, r.a, 1.25); }, '그림을 키웠습니다', true); }, 'big');
        btn(g, '작게 ×0.8', function () { var r = need(); if (!r) return; op('그림 크기', function (x) { return ST.scalePicture(x, r.a, 0.8); }, '그림을 줄였습니다', true); }, 'big');
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
        ctx().sheet({ title: '머리글·바닥글', body: body, wide: true, buttons: [{ label: '닫기' }, { label: '글 저장', primary: true, onClick: function () {
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

    // ---------------- 도구줄 ----------------
    var ITEMS = {
      para: { g: '¶', l: '문단', run: paraSheet }, style: { g: 'H', l: '스타일', run: styleSheet }, fmt: { g: 'Aa', l: '서식', run: fmtSheet }, list: { g: '≣', l: '목록', run: listSheet },
      table: { g: '▦', l: '표', run: tableSheet }, pic: { g: '▣', l: '그림', run: picSheet }, hf: { g: '▭', l: '머리·바닥', run: hfSheet }, repl: { g: '⇄', l: '바꾸기', run: replSheet }, range: { g: '⬚', l: '범위', run: rangeBtn }
    };
    var ORDER = ['para', 'style', 'fmt', 'list', 'table', 'pic', 'hf', 'repl', 'range'];
    function mk(id, hostEl, inSheet) {
      var it = ITEMS[id], b = el('button', inSheet ? 'sdx-mb' : 'sdx-ob'); b.type = 'button'; b.setAttribute('aria-label', it.l); b.dataset.id = id;
      b.appendChild(el('span', 'g', it.g)); b.appendChild(el('span', 'l', it.l));
      b.onclick = function () { if (inSheet) ctx().closeSheet(); setTimeout(it.run, inSheet ? 60 : 0); }; hostEl.appendChild(b); return b;
    }
    function renderRow() {
      var n = perRow(), shown = ORDER.length > n ? ORDER.slice(0, n) : ORDER, rest = ORDER.length > n ? ORDER.slice(n) : [];
      U.row.innerHTML = ''; shown.forEach(function (id) { var b = mk(id, U.row, false); if (id === 'range') U.rangeB = b; });
      if (rest.length) { var mb = el('button', 'sdx-ob'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.appendChild(el('span', 'g', '⋯')); mb.appendChild(el('span', 'l', '더보기')); mb.onclick = function () { sheet('더보기', function (body) { var g = el('div', 'sdx-mg'); body.appendChild(g); rest.forEach(function (id) { mk(id, g, true); }); }); }; U.row.appendChild(mb); }
      U.bucket = n;
    }
    U.mount = function (hostEl) {
      hostEl.innerHTML = ''; U.lab = el('div', 'sdx-lab'); U.row = el('div', 'sdx-row'); hostEl.appendChild(U.lab); hostEl.appendChild(U.row); renderRow(); U.refresh();
      global.addEventListener('resize', function () { if (U.row && U.bucket !== perRow()) { renderRow(); U.refresh(); } });
    };
    U.refresh = function () {
      if (!U.lab) return; var r = rg(), s = S();
      U.lab.textContent = s && s.rangeMode ? '범위의 끝 문단을 눌러 주십시오…' : (r ? '고른 문단 ' + (r.a + 1) + (r.b > r.a ? '~' + (r.b + 1) + ' (' + (r.b - r.a + 1) + '개)' : '') + (r.b === r.a ? ' · 한 번 더 누르면 글 고치기' : '') : '문단을 한 번 누르면 고릅니다 · 점선 문단은 한 번 더 누르면 글을 고칩니다');
      if (U.rangeB) { U.rangeB.classList.toggle('on', !!(s && s.rangeMode)); U.rangeB.querySelector('.l').textContent = s && s.rangeMode ? '범위 취소' : '범위'; }
    };
    return U;
  }
  global.SODocxUI = { create: create };
})(window);
