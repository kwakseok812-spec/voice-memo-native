/* so-pptx-ui-ext.js — S-Office 파워포인트 편집 화면 보강(O-0861, v10.9 3회차)
 * 새 도구줄 단추 없이 기존 시트(「슬라이드」「넣기」)와 고른 도형의 맥락 줄에 얹는다.
 *   · 움직임 효과(애니메이션) 넣기·바꾸기·순서·시작·시간·지연·지우기   (so-pptx-anim.js)
 *   · 슬라이드 쇼에서 움직임 효과를 클릭 순서대로 재생
 *   · 차트 미리 그림을 슬라이드 목록 썸네일·쇼에도 얹기(v10.9 이월)
 * 화면의 나머지(디자인·도식·동영상·소리)는 같은 파일 아래쪽에 이어서 붙는다.
 * 새 외부 부품 없음.
 * ==========================================================================*/
(function (global) {
  'use strict';
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var ST = function () { return global.SOPptxStruct; };
  function fontLabel(f) { f = String(f || ''); if (f.charAt(0) !== '+') return f; return /^\+mj/.test(f) ? '테마의 제목 글꼴' : (/^\+mn/.test(f) ? '테마의 본문 글꼴' : '테마 글꼴'); }   // 내부 글꼴 코드(+mj-lt 등)는 쉬운 말로
  var X = { api: null };

  // ======================= 움직임 효과 시트 =======================
  var NODE_SHORT = { clickEffect: '클릭할 때', withEffect: '앞 효과와 함께', afterEffect: '앞 효과 다음에' };
  var DURS = [[0.25, '0.25초'], [0.5, '0.5초'], [1, '1초'], [2, '2초'], [3, '3초'], [5, '5초']];
  var DELAYS = [[0, '없음'], [0.5, '0.5초'], [1, '1초'], [2, '2초'], [3, '3초']];
  X.mount = function (api) {
    X.api = api;
    var s = api.s, st = api.st, ctx = api.ctx, env = api.env, ST_ = ST();
    var pick = null;                                          // 효과를 걸 도형 id(시트 안에서 고름)
    function dispName(sh) {                                  // 같은 이름이 여럿이면 번호·안의 글을 덧붙여 구별한다
      var base = api.nameOf(sh), same = st.shapes.filter(function (q) { return api.nameOf(q) === base; }), n = same.indexOf(sh) + 1, t = (sh.text || '').replace(/\s+/g, ' ').trim();
      return base + (same.length > 1 ? ' ' + n : '') + (t ? '「' + (t.length > 8 ? t.slice(0, 8) + '…' : t) + '」' : '');
    }
    function shName(id) { var sh = st.shapes.filter(function (q) { return q.id === id; })[0]; return sh ? dispName(sh) : '도형(지워짐)'; }
    function animOp(op, msg, then) {
      return api.op('움직임 효과', function (x) { var r = ST_.editAnims(x, op); return r.err ? r : { xml: r.xml }; }, msg, true);
    }
    function animSheet() {
      if (!pick || !st.shapes.some(function (q) { return q.id === pick; })) pick = st.sel != null ? st.sel : null;
      api.sheet('움직임 효과 — 슬라이드 ' + (s.idx + 1), function (body) {
        var rd = ST_.readAnims(st.xml);
        if (!rd.ok) { body.appendChild(el('div', 'so-sheet-note', '이 슬라이드의 움직임 설정은 구조가 특수해 폰에서 고칠 수 없습니다. (' + rd.err + ') 「수정 요청」으로 맡겨 주십시오.')); return; }
        var list = rd.effects;
        body.appendChild(el('div', 'so-sheet-note', list.length ? '쇼에서 화면을 누를 때마다 효과가 위에서부터 순서대로 일어납니다(「앞 효과와 함께」「앞 효과 다음에」인 것은 누르지 않아도 이어서 일어납니다).' : '아직 움직임 효과가 없습니다. 아래에서 도형을 고르고 효과를 눌러 넣으십시오.'));
        list.forEach(function (e) {
          var row = el('div', 'spx-r'), cap = el('button', 'spx-b big', (e.i + 1) + '. ' + shName(e.spid) + ' — ' + ST_.animLabel(e) + ' · ' + NODE_SHORT[e.node] + (e.known ? ' · ' + (e.dur >= 1000 ? (e.dur / 1000) + '초' : e.dur + 'ms') : '') + (e.delay ? ' · 지연 ' + (e.delay / 1000) + '초' : ''));
          cap.type = 'button'; cap.style.flex = '1'; cap.style.justifyContent = 'flex-start'; cap.style.textAlign = 'left'; cap.onclick = function () { editSheet(e.i); }; row.appendChild(cap);
          [['▲', '위로', e.i > 0 ? function () { animOp({ kind: 'move', i: e.i, to: e.i - 1 }, '순서를 올렸습니다'); } : null], ['▼', '아래로', e.i < list.length - 1 ? function () { animOp({ kind: 'move', i: e.i, to: e.i + 1 }, '순서를 내렸습니다'); } : null], ['✕', '지우기', function () { animOp({ kind: 'remove', i: e.i }, '효과를 지웠습니다(되돌리려면 ↶)'); }]].forEach(function (a) {
            var b = el('button', 'spx-b', a[0]); b.type = 'button'; b.setAttribute('aria-label', a[1] + ' ' + (e.i + 1) + '번'); if (!a[2]) b.disabled = true; else b.onclick = a[2]; row.appendChild(b);
          });
          body.appendChild(row);
        });
        // 도형 고르기
        body.appendChild(el('div', 'spx-l', '효과를 걸 도형' + (pick ? ' — 지금: ' + shName(pick) : ' — 아래에서 고르십시오')));
        var gp = el('div', 'spx-r'); body.appendChild(gp);
        st.shapes.filter(function (q) { return q.g && q.kind !== 'smart' && q.kind !== 'ole' && q.kind !== 'other'; }).forEach(function (q) {
          var b = el('button', 'spx-b' + (q.id === pick ? ' on' : ''), dispName(q)); b.type = 'button'; b.onclick = function () { pick = q.id; api.refill(); }; gp.appendChild(b);
        });
        if (!st.shapes.length) gp.appendChild(el('div', 'so-sheet-note', '이 슬라이드에는 효과를 걸 도형이 없습니다.'));
        var cats = [['나타내기(화면에 나타남)', 'entr'], ['강조(눈에 띄게)', 'emph'], ['끝내기(화면에서 사라짐)', 'exit']];
        cats.forEach(function (c) {
          var g = api.group(body, c[0]);
          ST_.ANIM_KEYS.filter(function (k) { return ST_.PRESETS[k].cls === c[1]; }).forEach(function (k) {
            api.btn(g, ST_.PRESETS[k].label, function () {
              if (!pick) { api.toast('먼저 위에서 효과를 걸 도형을 고르십시오.', 3000); return; }
              animOp({ kind: 'add', spid: pick, key: k }, ST_.PRESETS[k].label + ' 효과를 넣었습니다(「클릭할 때」 시작 — 위 목록의 줄을 눌러 고칩니다)');
            }, '', undefined, true);
          });
        });
        body.appendChild(el('div', 'so-sheet-note', '제목·본문 칸, 도형, 그림, 표, 차트, 묶음에 걸 수 있습니다. 파워포인트에서는 설정한 그대로 일어나고, 폰의 쇼 보기에서는 나타나기·사라지기·서서히·날아오기·확대 같은 간단한 동작으로 보여 줍니다. 묶음 안의 낱개 도형에는 걸 수 없습니다. 지운 직후에는 ↶ 로 되돌립니다.'));
      }, false, true);
    }
    function editSheet(i) {
      api.sheet('효과 고치기', function (body) {
        var rd = ST_.readAnims(st.xml), e = rd.ok ? rd.effects[i] : null;
        if (!e) { body.appendChild(el('div', 'so-sheet-note', '효과를 찾지 못했습니다. 목록으로 돌아가십시오.')); return; }
        body.appendChild(el('div', 'so-sheet-note', (i + 1) + '번 · ' + shName(e.spid) + ' — ' + ST_.animLabel(e)));
        var gs = api.group(body, '시작 방식');
        Object.keys(NODE_SHORT).forEach(function (n) { api.btn(gs, NODE_SHORT[n], function () { animOp({ kind: 'change', i: i, node: n }, '시작 방식을 바꿨습니다'); }, e.node === n ? 'on' : '', undefined, true); });
        var gd = api.group(body, '지연(시작 전에 기다림)');
        DELAYS.forEach(function (d) { api.btn(gd, d[1], function () { animOp({ kind: 'change', i: i, delay: Math.round(d[0] * 1000) }, '지연을 바꿨습니다'); }, e.delay === Math.round(d[0] * 1000) ? 'on' : '', undefined, true); });
        if (e.known) {
          var P = ST_.PRESETS[e.key];
          if (P.dirs) { var gr = api.group(body, '방향'); P.dirs.forEach(function (d) { api.btn(gr, d[1], function () { animOp({ kind: 'change', i: i, sub: d[0] }, '방향을 바꿨습니다'); }, e.sub === d[0] ? 'on' : '', undefined, true); }); }
          if (e.key !== 'appear' && e.key !== 'xdisappear' && e.key !== 'transp') {
            var gt = api.group(body, '걸리는 시간'); DURS.forEach(function (d) { api.btn(gt, d[1], function () { animOp({ kind: 'change', i: i, dur: Math.round(d[0] * 1000) }, '시간을 바꿨습니다'); }, e.dur === Math.round(d[0] * 1000) ? 'on' : '', undefined, true); });
          }
          [['나타내기', 'entr'], ['강조', 'emph'], ['끝내기', 'exit']].forEach(function (c) {
            var g = api.group(body, '종류 바꾸기 — ' + c[0]);
            ST_.ANIM_KEYS.filter(function (k) { return ST_.PRESETS[k].cls === c[1]; }).forEach(function (k) { api.btn(g, ST_.PRESETS[k].label, function () { animOp({ kind: 'change', i: i, key: k }, '효과 종류를 바꿨습니다'); }, e.key === k ? 'on' : '', undefined, true); });
          });
        } else body.appendChild(el('div', 'so-sheet-note', '이 효과는 파워포인트에서 만든 고급 효과(경로·문단별·여러 동작 등)라서 폰에서는 종류와 시간을 바꿀 수 없습니다. 시작 방식·지연·순서·지우기는 됩니다.'));
        var gx = api.group(body, ''); api.btn(gx, '이 효과 지우기', function () { ctx.closeSheet(); setTimeout(function () { animOp({ kind: 'remove', i: i }, '효과를 지웠습니다(되돌리려면 ↶)'); setTimeout(animSheet, 500); }, 60); }, 'danger', undefined, false);
        api.btn(gx, '목록으로', function () { ctx.closeSheet(); setTimeout(animSheet, 60); }, 'on', undefined, false);
      }, false, true);
    }
    // ======================= 디자인(색·글꼴 조합 · 마스터 · 다른 파일에서 가져오기) =======================
    var D_FONTS = ['맑은 고딕', '바탕', '돋움', '굴림', '궁서', 'Arial', 'Times New Roman'];
    var D_COLORS = [['검정', '000000'], ['남색', '1F3864'], ['파랑', '1C5FD6'], ['초록', '1B8A3A'], ['빨강', 'C0392B'], ['보라', '5B3FA6'], ['회색', '555555'], ['흰색', 'FFFFFF']];
    var D_BG = [['흰색', 'FFFFFF'], ['연한 회색', 'F2F2F2'], ['연한 노랑', 'FFF8D6'], ['연한 하늘', 'E3F0FF'], ['연한 연두', 'E6F5DC'], ['연한 분홍', 'FDE6EC'], ['연한 보라', 'EEE9F5'], ['남색', '1F3864'], ['검정', '1A1A1A']];
    var D_TSIZES = [28, 32, 36, 40, 44, 54], D_BSIZES = [18, 20, 24, 28, 32];
    var mOpts = { allLayouts: false };
    function rop() { return env.roPkg(s.info.zip); }
    function runOp(label, mut, msg) {
      env.run(label, mut, function (r) { if (r && r.err) { api.fail(r.err); return; } if (msg) api.toast(msg, 3000); api.U.refreshAll(); });
    }
    function dots(cols) { var w = el('span', 'sox-dots'); cols.forEach(function (c) { var i = el('i'); i.style.cssText = 'display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:2px;border:1px solid rgba(0,0,0,.2);background:#' + c; w.appendChild(i); }); return w; }
    function designSheet() {
      var D = null, stamp = '';
      function load() {
        return Promise.all([ST_.readTheme(rop()), ST_.readMaster(rop())]).then(function (r) {
          var sg = JSON.stringify(r); if (sg !== stamp) { stamp = sg; D = { theme: r[0], master: r[1] }; if (opened) api.refill(); }
        });
      }
      var opened = false;
      function build(body) {
        if (!D || D.theme.err) { body.appendChild(el('div', 'so-sheet-note', D && D.theme.err ? D.theme.err : '불러오는 중…')); setTimeout(load, 0); return; }
        var T = D.theme, M = D.master;
        body.appendChild(el('div', 'so-sheet-note', '지금 색 조합: ' + (T.colorName || '(이름 없음)') + ' · 제목 글꼴: ' + (T.fonts.major[1] || T.fonts.major[0]) + ' · 본문 글꼴: ' + (T.fonts.minor[1] || T.fonts.minor[0]) + (T.count > 1 ? ' · 마스터 ' + T.count + '개에 함께 적용' : '')));
        // 색 조합
        body.appendChild(el('div', 'spx-l', '색 조합(도형·표·차트의 테마 색이 바뀝니다)'));
        var gc = el('div', 'spx-r'); body.appendChild(gc);
        ST_.COLOR_SETS.forEach(function (c) {
          var b = el('button', 'spx-b' + (T.colorKey === c.key ? ' on' : '')); b.type = 'button'; b.appendChild(dots(c.c.slice(2, 8))); b.appendChild(el('span', '', ' ' + c.name));
          b.onclick = function () { runOp('색 조합', function (pkg) { return ST_.setThemeColors(pkg, c.key); }, '색 조합을 「' + c.name + '」으로 바꿨습니다(↶ 로 되돌립니다)'); }; gc.appendChild(b);
        });
        // 글꼴 조합
        body.appendChild(el('div', 'spx-l', '글꼴 조합(제목·본문 글꼴이 바뀝니다)'));
        var gf = el('div', 'spx-r'); body.appendChild(gf);
        ST_.FONT_SETS.forEach(function (f) {
          var b = el('button', 'spx-b' + (T.fontKey === f.key ? ' on' : ''), f.name); b.type = 'button';
          b.onclick = function () { runOp('글꼴 조합', function (pkg) { return ST_.setThemeFonts(pkg, f.key); }, '글꼴 조합을 「' + f.name + '」으로 바꿨습니다'); }; gf.appendChild(b);
        });
        body.appendChild(el('div', 'so-sheet-note', '색이나 글꼴을 도형에 직접 정해 둔 곳은 조합을 바꿔도 그대로 남습니다. 폰 화면 미리보기는 글꼴을 PC와 다르게 보여 줄 수 있습니다.'));
        // 마스터
        body.appendChild(el('div', 'spx-l', '마스터(모든 슬라이드의 바탕 설계)'));
        var tg = el('div', 'spx-r'); body.appendChild(tg);
        var allB = el('button', 'spx-b' + (mOpts.allLayouts ? ' on' : ''), '배경을 모든 배치에도 적용: ' + (mOpts.allLayouts ? '켜짐' : '꺼짐')); allB.type = 'button'; allB.onclick = function () { mOpts.allLayouts = !mOpts.allLayouts; api.refill(); }; tg.appendChild(allB);
        function mset(o, msg) { runOp('마스터', function (pkg) { return ST_.setMaster(pkg, o); }, msg); }
        var gb = api.group(body, '배경색' + (M.bg ? ' — 지금 ' + (/^[0-9A-F]{6}$/.test(M.bg) ? '#' + M.bg : '기본') : ''));
        api.btn(gb, '기본으로', function () { var o = { bg: '', allLayouts: mOpts.allLayouts }; mset(o, '마스터 배경을 기본으로 되돌렸습니다'); }, '', undefined, true);
        D_BG.forEach(function (c) { api.btn(gb, c[0], function () { mset({ bg: c[1], allLayouts: mOpts.allLayouts }, '마스터 배경색을 바꿨습니다'); }, M.bg === c[1] ? 'on' : '', c[1], true); });
        var gt = api.group(body, '제목 글꼴' + (M.title && M.title.font ? ' — 지금 ' + fontLabel(M.title.font) : ''));
        D_FONTS.forEach(function (f) { api.btn(gt, f, function () { mset({ titleFont: f }, '제목 글꼴을 바꿨습니다'); }, M.title && M.title.font === f ? 'on' : '', undefined, true); });
        var gts = api.group(body, '제목 크기(pt)' + (M.title && M.title.size ? ' — 지금 ' + M.title.size : ''));
        D_TSIZES.forEach(function (z) { api.btn(gts, String(z), function () { mset({ titleSize: z }, '제목 크기를 바꿨습니다'); }, M.title && M.title.size === z ? 'on' : '', undefined, true); });
        var gtb = api.group(body, '제목 굵기'); api.btn(gtb, '굵게', function () { mset({ titleBold: true }, '제목을 굵게 했습니다'); }, M.title && M.title.bold === true ? 'on' : '', undefined, true); api.btn(gtb, '보통', function () { mset({ titleBold: false }, '제목을 보통 굵기로 했습니다'); }, M.title && M.title.bold === false ? 'on' : '', undefined, true);
        var gtc = api.group(body, '제목 색'); D_COLORS.forEach(function (c) { api.btn(gtc, c[0], function () { mset({ titleColor: c[1] }, '제목 색을 바꿨습니다'); }, M.title && M.title.color === c[1] ? 'on' : '', c[1], true); });
        var gbf = api.group(body, '본문 글꼴' + (M.body && M.body.font ? ' — 지금 ' + fontLabel(M.body.font) : ''));
        D_FONTS.forEach(function (f) { api.btn(gbf, f, function () { mset({ bodyFont: f }, '본문 글꼴을 바꿨습니다'); }, M.body && M.body.font === f ? 'on' : '', undefined, true); });
        var gbs = api.group(body, '본문 첫 단계 크기(pt, 아랫 단계는 비율대로)' + (M.body && M.body.size ? ' — 지금 ' + M.body.size : ''));
        D_BSIZES.forEach(function (z) { api.btn(gbs, String(z), function () { mset({ bodySize: z }, '본문 크기를 바꿨습니다'); }, M.body && M.body.size === z ? 'on' : '', undefined, true); });
        var gbc = api.group(body, '본문 색'); D_COLORS.forEach(function (c) { api.btn(gbc, c[0], function () { mset({ bodyColor: c[1] }, '본문 색을 바꿨습니다'); }, M.body && M.body.color === c[1] ? 'on' : '', c[1], true); });
        body.appendChild(el('div', 'so-sheet-note', '마스터를 바꾸면 그 모양을 따르는 모든 슬라이드가 함께 바뀝니다. 슬라이드에서 글자 크기·글꼴을 직접 정한 곳은 그대로입니다. 제목·본문 칸의 위치나 새 칸 만들기는 폰에서 하지 않고, 파워포인트의 「슬라이드 마스터」에서 합니다.'));
        // 배치별 배경
        body.appendChild(el('div', 'spx-l', '배치(레이아웃)별 배경색'));
        var gl = el('div', 'spx-r'); body.appendChild(gl);
        M.layouts.forEach(function (l) { var b = el('button', 'spx-b', l.name + (l.bg ? (/^[0-9A-F]{6}$/.test(l.bg) ? ' · #' + l.bg : ' · 따로 지정') : '')); b.type = 'button'; b.onclick = function () { layoutSheet(l); }; gl.appendChild(b); });
        // 다른 파일에서
        body.appendChild(el('div', 'spx-l', '다른 파워포인트 파일의 디자인 가져오기'));
        var gi = el('div', 'spx-r'); body.appendChild(gi);
        var pb = el('button', 'spx-b big', '파일에서 색·글꼴 조합 가져오기'); pb.type = 'button'; pb.onclick = importPick; gi.appendChild(pb);
        body.appendChild(el('div', 'so-sheet-note', '가져오는 것은 그 파일의 색 조합과 글꼴 조합뿐입니다(슬라이드 모양·배경 그림·도형은 가져오지 않아 이 문서가 깨질 일이 없습니다). 가져오기 전에 무엇이 들어오는지 먼저 보여 드립니다.'));
        setTimeout(load, 0);
      }
      load().then(function () { opened = true; api.sheet('디자인 — 색·글꼴·마스터', build, false, true); });
    }
    function layoutSheet(l) {
      api.sheet('배치 배경 — ' + l.name, function (body) {
        var g = api.group(body, '이 배치의 배경색' + (l.bg ? ' — 지금 ' + (/^[0-9A-F]{6}$/.test(l.bg) ? '#' + l.bg : '따로 지정') : ' — 지금 마스터를 따름'));
        api.btn(g, '마스터를 따르기', function () { runOp('배치 배경', function (pkg) { return ST_.setLayoutBg(pkg, l.path, null); }, '이 배치의 배경을 마스터에 맡겼습니다'); }, 'on', undefined, false);
        D_BG.forEach(function (c) { api.btn(g, c[0], function () { runOp('배치 배경', function (pkg) { return ST_.setLayoutBg(pkg, l.path, c[1]); }, '이 배치의 배경색을 바꿨습니다'); }, '', c[1], false); });
      }, false, false);
    }
    function importPick() {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation';
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        if (f.size > 60 * 1024 * 1024) { api.toast('파일이 너무 큽니다(60MB까지).', 3600); return; }
        f.arrayBuffer().then(function (ab) { return s.JSZip.loadAsync(ab); }).then(function (z) {
          var pk = { read: function (p) { var q = z.file(p); return q ? q.async('string') : Promise.resolve(null); }, list: function () { return Object.keys(z.files); } };
          return ST_.extractThemeFromPkg(pk);
        }).then(function (ex) {
          if (!ex) { api.toast('이 파일에서 색·글꼴 조합을 찾지 못했습니다.', 4000); return; }
          api.sheet('가져올 디자인 확인', function (body) {
            body.appendChild(el('div', 'so-sheet-note', '파일: ' + f.name));
            if (ex.colors) { var r1 = el('div', 'spx-r'), c = ex.colors.c, k = ['dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(function (t) { return c[t] || 'CCCCCC'; }); r1.appendChild(dots(k)); r1.appendChild(el('span', 'so-sheet-note', '색 조합: ' + ex.colors.name)); body.appendChild(r1); }
            if (ex.fonts) body.appendChild(el('div', 'so-sheet-note', '글꼴 조합: ' + ex.fonts.name + ' — 제목 ' + (ex.fonts.f.major[1] || ex.fonts.f.major[0]) + ' · 본문 ' + (ex.fonts.f.minor[1] || ex.fonts.f.minor[0])));
            var g = api.group(body, '무엇을 가져올까');
            function go(what, msg) { return function () { runOp('디자인 가져오기', function (pkg) { return ST_.importThemeScheme(pkg, ex, what); }, msg); }; }
            if (ex.colors) api.btn(g, '색 조합만', go('colors', '색 조합을 가져왔습니다'), '', undefined, false);
            if (ex.fonts) api.btn(g, '글꼴 조합만', go('fonts', '글꼴 조합을 가져왔습니다'), '', undefined, false);
            if (ex.colors && ex.fonts) api.btn(g, '둘 다', go('both', '색·글꼴 조합을 가져왔습니다'), 'on', undefined, false);
          }, false, false);
        }).catch(function (e) { api.toast('파일을 읽지 못했습니다: ' + ((e && e.message) || e), 4200); });
      };
      inp.click();
    }
    // ======================= 도식(스마트아트 모양의 묶은 도형) =======================
    var SA_MAP = { listh: 'list', process: 'process', tree: 'hier' };       // 도식 종류 → 진짜 SmartArt 종류
    function saOk() { return !!(ST_.addSmartArt && api.ctx.flag && api.ctx.flag('pptxsa')); }
    function diagramSheet(editId) {
      var cur = editId != null ? ST_.readDiagram(st.xml, editId) : null;
      if (editId != null && !cur) { api.toast('이 앱에서 만든 도식만 고칠 수 있습니다.', 3200); return; }
      var spec = cur ? { kind: cur.kind, palette: cur.palette, items: cur.items.slice() } : { kind: 'process', palette: 'multi', items: ST_.diagramDefaults('process'), sa: saOk() };
      var body = el('div', 'spx'), kindBox = el('div'), listBox = el('div'), note = el('div', 'so-sheet-note'), lastKind = spec.kind;
      function fitCount() { var K = ST_.DIAGRAM_KINDS[spec.kind]; while (spec.items.length < K.min) spec.items.push(''); if (spec.items.length > K.max) spec.items.length = K.max; }
      function render() {
        var K = ST_.DIAGRAM_KINDS[spec.kind];
        kindBox.innerHTML = '';
        var gk = el('div', 'spx-r'); kindBox.appendChild(el('div', 'spx-l', '종류')); kindBox.appendChild(gk);
        ST_.DIAGRAM_KEYS.forEach(function (k) { var b = el('button', 'spx-b' + (spec.kind === k ? ' on' : ''), ST_.DIAGRAM_KINDS[k].name); b.type = 'button'; b.onclick = function () { if (!cur && spec.items.join('|') === ST_.diagramDefaults(lastKind).join('|')) spec.items = ST_.diagramDefaults(k); lastKind = k; spec.kind = k; fitCount(); render(); }; gk.appendChild(b); });
        var gp = el('div', 'spx-r'); kindBox.appendChild(el('div', 'spx-l', '색')); kindBox.appendChild(gp);
        [['여러 색', 'multi'], ['한 가지 색', 'one']].forEach(function (a) { var b = el('button', 'spx-b' + (spec.palette === a[1] ? ' on' : ''), a[0]); b.type = 'button'; b.onclick = function () { spec.palette = a[1]; render(); }; gp.appendChild(b); });
        if (!cur && saOk()) {
          var can = !!SA_MAP[spec.kind]; if (spec.wantSa === undefined) spec.wantSa = true; spec.sa = can && spec.wantSa;
          kindBox.appendChild(el('div', 'spx-l', '파일에 넣는 방식'));
          var gm = el('div', 'spx-r'); kindBox.appendChild(gm);
          [['진짜 SmartArt', true], ['묶은 도형', false]].forEach(function (a) { var b = el('button', 'spx-b' + (!!spec.sa === a[1] ? ' on' : ''), a[0]); b.type = 'button'; if (a[1] && !can) b.disabled = true; b.onclick = function () { spec.wantSa = a[1]; render(); }; gm.appendChild(b); });
          if (!can) kindBox.appendChild(el('div', 'so-sheet-note', '이 종류는 진짜 SmartArt 로는 넣을 수 없어 묶은 도형으로 들어갑니다(SmartArt 는 가로 목록·기본 프로세스·계층 구조).'));
          else if (spec.sa) kindBox.appendChild(el('div', 'so-sheet-note', '파워포인트에서 SmartArt 도구 탭이 뜨고 항목을 더하거나 모양·색을 바꿀 수 있습니다. 색은 테마의 강조색을 따르고 위의 「색」 고르기는 쓰지 않습니다.' + (spec.kind === 'tree' ? ' 항목 앞에 「-」를 붙이면 바로 위 항목의 아래 단계가 됩니다.' : '')));
        }
        listBox.innerHTML = ''; listBox.appendChild(el('div', 'spx-l', '항목 글(' + spec.items.length + '개 · ' + K.min + '~' + K.max + '개) — ' + K.hint));
        spec.items.forEach(function (t, i) {
          var row = el('div', 'spx-r'), inp = el('input', 'spx-in'); inp.type = 'text'; inp.value = t; inp.placeholder = (i + 1) + '번 항목'; inp.setAttribute('aria-label', (i + 1) + '번 항목 글'); inp.style.flex = '1'; inp.maxLength = 60;
          inp.addEventListener('input', function () { spec.items[i] = inp.value; });
          row.appendChild(inp);
          var rm = el('button', 'spx-b', '−'); rm.type = 'button'; rm.setAttribute('aria-label', (i + 1) + '번 항목 빼기'); if (spec.items.length <= K.min) rm.disabled = true; rm.onclick = function () { spec.items.splice(i, 1); render(); }; row.appendChild(rm);
          listBox.appendChild(row);
        });
        var ad = el('button', 'spx-b big', '＋ 항목 추가'); ad.type = 'button'; if (spec.items.length >= K.max) ad.disabled = true; ad.onclick = function () { spec.items.push(''); render(); setTimeout(function () { var ins = listBox.querySelectorAll('input'); try { ins[ins.length - 1].focus(); } catch (e) {} }, 40); }; listBox.appendChild(ad);
      }
      note.textContent = '「묶은 도형」을 고르면 파일에 파워포인트의 묶은 일반 도형으로 들어갑니다(SmartArt 가 아니라 같은 모양의 도형 묶음). 파워포인트에서 도형 하나하나의 글·색·크기를 마음대로 고칠 수 있고, 색 조합을 바꾸면 색이 같이 바뀝니다. 이 앱의 「도식 고치기」로 다시 그리면 직접 고친 모양은 새로 그린 모양으로 바뀝니다.';
      body.appendChild(kindBox); body.appendChild(listBox); body.appendChild(note); fitCount(); render();
      api.ctx.sheet({ title: cur ? '도식 고치기' : '도식 넣기', body: body, wide: true, buttons: [{ label: '취소' }, { label: cur ? '다시 그리기' : '넣기', primary: true, onClick: function () {
        var sp = { kind: spec.kind, palette: spec.palette, items: spec.items.slice() };
        if (cur) api.op('도식 고치기', function (x) { var r = ST_.replaceDiagram(x, editId, sp); return r.err ? r : { xml: r.xml, id: editId }; }, '도식을 다시 그렸습니다(↶ 로 되돌립니다)');
        else if (spec.sa && SA_MAP[spec.kind] && saOk()) {
          var g2 = { x: Math.round(st.W * 0.08), y: Math.round(st.H * 0.23), w: Math.round(st.W * 0.84), h: Math.round(st.H * 0.66) };
          api.env.run('SmartArt 넣기', function (pkg) { return ST_.addSmartArt(pkg, st.path, { kind: SA_MAP[spec.kind], items: sp.items }, g2).then(function (r) { return r.err ? r : { sel: r.id }; }); }, function (r) { if (r && r.err) { api.fail(r.err); return; } st.sel = r.sel; api.toast('SmartArt 를 넣었습니다 — 눌러서 「SmartArt 글 고치기」, 파워포인트에서는 SmartArt 도구로 모양을 바꿉니다', 4200); api.U.refreshAll(); });
        }
        else { var gg = { x: Math.round(st.W * 0.08), y: Math.round(st.H * 0.23), w: Math.round(st.W * 0.84), h: Math.round(st.H * 0.66) }; api.op('도식 넣기', function (x) { var r = ST_.addDiagram(x, sp, gg); return r.err ? r : { xml: r.xml, id: r.id }; }, '도식을 넣었습니다 — 눌러서 「도식 고치기」, 끌어서 옮기기'); }
      } }] });
    }
    // ======================= SmartArt 글 고치기 =======================
    function smartTextSheet(sh) {
      ST_.readSmartArt(api.env.roPkg(s.info.zip), st.path, sh.id).then(function (r) {
        if (r.err) { api.toast(r.err, 3600); return; }
        if (!r.nodes.length) { api.toast('고칠 항목 글을 찾지 못했습니다. 파워포인트에서 고쳐 주십시오.', 3600); return; }
        var body = el('div', 'spx'), vals = r.nodes.map(function (n) { return n.text; }), box = el('div');
        body.appendChild(el('div', 'so-sheet-note', (r.mine ? '이 앱이 만든 SmartArt 입니다.' : '파워포인트가 만든 SmartArt 입니다.') + ' 항목 글만 고칩니다(항목을 더하거나 빼고 모양을 바꾸는 일은 파워포인트의 SmartArt 도구로). 글 길이가 크게 달라지면 파워포인트가 열 때 다시 배치합니다.'));
        r.nodes.forEach(function (n, i) { var row = el('div', 'spx-r'), inp = el('input', 'spx-in'); inp.type = 'text'; inp.value = n.text; inp.maxLength = 200; inp.style.flex = '1'; inp.style.marginLeft = (n.lv * 14) + 'px'; inp.setAttribute('aria-label', (i + 1) + '번 항목 글'); inp.addEventListener('input', function () { vals[i] = inp.value; }); row.appendChild(inp); box.appendChild(row); });
        body.appendChild(box);
        api.ctx.sheet({ title: 'SmartArt 글 고치기', body: body, wide: true, buttons: [{ label: '취소' }, { label: '적용', primary: true, onClick: function () {
          var texts = vals.slice();
          api.env.run('SmartArt 글 고치기', function (pkg) { return ST_.setSmartArtTexts(pkg, st.path, sh.id, texts).then(function (q) { return q.err ? q : { sel: sh.id, changed: q.changed }; }); }, function (q) { if (q && q.err) { api.fail(q.err); return; } st.sel = sh.id; api.toast(q.changed ? 'SmartArt 글을 고쳤습니다(↶ 로 되돌립니다)' : '바뀐 글이 없습니다', 3000); api.U.refreshAll(); });
        } }] });
      }).catch(function (e) { api.toast('SmartArt 를 읽지 못했습니다 — ' + ((e && e.message) || e), 3600); });
    }
    // ======================= 동영상·소리 =======================
    function canvasPng(cv) { return new Promise(function (res, rej) { cv.toBlob(function (bl) { if (!bl) { rej(new Error('표지 그림을 만들지 못했습니다')); return; } bl.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, 'image/png'); }); }
    function placeholderPoster(kind, w, h) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var c = cv.getContext('2d');
      var gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, kind === 'video' ? '#3a3f4b' : '#1f6f78'); gr.addColorStop(1, kind === 'video' ? '#1d2027' : '#134a52'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.92)';
      if (kind === 'video') { var s = Math.min(w, h) * 0.22; c.beginPath(); c.moveTo(w / 2 - s * 0.55, h / 2 - s); c.lineTo(w / 2 + s * 0.95, h / 2); c.lineTo(w / 2 - s * 0.55, h / 2 + s); c.closePath(); c.fill(); }
      else { var u = w / 10, cx = w / 2, cy = h / 2; c.beginPath(); c.moveTo(cx - 2.8 * u, cy - 1.1 * u); c.lineTo(cx - 1.3 * u, cy - 1.1 * u); c.lineTo(cx + 0.4 * u, cy - 2.6 * u); c.lineTo(cx + 0.4 * u, cy + 2.6 * u); c.lineTo(cx - 1.3 * u, cy + 1.1 * u); c.lineTo(cx - 2.8 * u, cy + 1.1 * u); c.closePath(); c.fill(); c.lineWidth = u * 0.5; c.strokeStyle = 'rgba(255,255,255,.92)'; c.lineCap = 'round'; [1.2, 2.2].forEach(function (r) { c.beginPath(); c.arc(cx + 0.4 * u, cy, r * u, -0.9, 0.9); c.stroke(); }); }
      return cv;
    }
    // 동영상 → { poster(png), w, h(원래 가로·세로), real(진짜 장면인지) }
    function videoInfo(file) {
      return new Promise(function (res) {
        var url = URL.createObjectURL(file), v = document.createElement('video'), done = false;
        function fin(o) { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e) {} res(o); }
        function fallback() { var cv = placeholderPoster('video', 640, 360); canvasPng(cv).then(function (p) { fin({ poster: p, w: 16, h: 9, real: false }); }, function () { fin({ poster: null, w: 16, h: 9, real: false }); }); }
        var tm = setTimeout(fallback, 7000);
        v.muted = true; v.preload = 'auto'; v.playsInline = true;
        v.onerror = function () { clearTimeout(tm); fallback(); };
        v.onloadedmetadata = function () { try { v.currentTime = Math.min(0.5, (v.duration || 1) * 0.1); } catch (e) { clearTimeout(tm); fallback(); } };
        v.onseeked = function () {
          clearTimeout(tm);
          try {
            var vw = v.videoWidth || 640, vh = v.videoHeight || 360, k = Math.min(1, 800 / Math.max(vw, vh)), cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(vw * k)); cv.height = Math.max(2, Math.round(vh * k));
            cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); canvasPng(cv).then(function (p) { fin({ poster: p, w: vw, h: vh, real: true }); }, fallback);
          } catch (e) { fallback(); }
        };
        v.src = url;
      });
    }
    function mediaPick(kind) {
      var inp = document.createElement('input'); inp.type = 'file';
      inp.accept = kind === 'video' ? 'video/mp4,video/x-m4v,video/quicktime,.mp4,.m4v,.mov' : 'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,.mp3,.m4a,.wav';
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        if (ST_.mediaKindOfName(f.name) !== kind) { api.toast(kind === 'video' ? '동영상은 mp4·m4v·mov 파일만 넣을 수 있습니다.' : '소리는 mp3·m4a·wav 파일만 넣을 수 있습니다.', 4200); return; }
        if (f.size > ST_.MEDIA_MAX) { api.toast('파일이 너무 큽니다(' + Math.round(f.size / 1048576) + 'MB). 폰에서는 ' + Math.round(ST_.MEDIA_MAX / 1048576) + 'MB까지 넣을 수 있습니다. 파일을 줄여서 다시 시도해 주십시오.', 6000); return; }
        function go() {
          api.ctx.busy('파일을 읽는 중…');
          Promise.all([f.arrayBuffer(), kind === 'video' ? videoInfo(f) : canvasPng(placeholderPoster('audio', 256, 256)).then(function (p) { return { poster: p, w: 1, h: 1, real: false }; })]).then(function (r) {
            api.ctx.busy(null);
            var info = r[1], W = st.W, H = st.H, g;
            if (kind === 'video') { var ar = info.w / info.h, mw = W * 0.62, mh = H * 0.56, w = mw, h = w / ar; if (h > mh) { h = mh; w = h * ar; } g = { x: Math.round((W - w) / 2), y: Math.round(H * 0.25 + (H * 0.68 - h) / 2), w: Math.round(w), h: Math.round(h) }; }
            else { var sz = Math.round(Math.max(457200, W * 0.07)); g = { x: Math.round((W - sz) / 2), y: Math.round(H * 0.82), w: sz, h: sz }; }
            if (!info.poster) { api.toast('표지 그림을 만들지 못했습니다.', 3600); return; }
            api.env.run(kind === 'video' ? '동영상 넣기' : '소리 넣기', function (pkg) { return ST_.addMedia(pkg, st.path, { name: f.name, bytes: new Uint8Array(r[0]), poster: info.poster, g: g }).then(function (q) { return q.err ? q : { sel: q.id, real: info.real }; }); }, function (q) {
              if (q && q.err) { api.fail(q.err); return; } st.sel = q.sel;
              api.toast((kind === 'video' ? '동영상을' : '소리를') + ' 넣었습니다' + (kind === 'video' && !q.real ? '(이 폰에서 첫 장면을 뽑지 못해 기본 표지 그림으로 넣었습니다 — 「표지 그림 바꾸기」로 바꿀 수 있습니다)' : '') + ' — 쇼에서 눌러 재생합니다', 5200); api.U.refreshAll();
            });
          }, function (e) { api.ctx.busy(null); api.toast('파일을 읽지 못했습니다: ' + ((e && e.message) || e), 4200); });
        }
        if (f.size > ST_.MEDIA_WARN) api.ctx.confirm('큰 파일입니다', '이 파일은 ' + (f.size / 1048576).toFixed(1) + 'MB 입니다. 폰이 느려지거나 멈출 수 있고, 되돌리기 기억은 줄어듭니다. 그래도 넣을까요?', '넣기', go, { cancelLabel: '취소' });
        else go();
      };
      inp.click();
    }
    var playUrl = null;
    function playSheet(sh) {
      ST_.readMedia(rop(), st.path, sh.id).then(function (m) {
        if (m.err) { api.fail(m.err); return; }
        if (m.external || !m.path) { api.toast('이 개체는 파일 안에 들어 있지 않고 인터넷·다른 폴더의 파일을 가리켜 폰에서 미리 재생할 수 없습니다.', 4800); return; }
        return rop().readBin(m.path).then(function (bytes) {
          if (!bytes) { api.toast('파일 안에서 미디어를 찾지 못했습니다.', 3600); return; }
          if (playUrl) { try { URL.revokeObjectURL(playUrl); } catch (e) {} }
          playUrl = URL.createObjectURL(new Blob([bytes], { type: m.mime }));
          var body = el('div', 'spx'), v = document.createElement(m.kind === 'video' ? 'video' : 'audio'); v.src = playUrl; v.controls = true; v.playsInline = true; v.style.cssText = 'width:100%;max-height:60vh;background:#000;border-radius:10px';
          body.appendChild(v); body.appendChild(el('div', 'so-sheet-note', (m.kind === 'video' ? '동영상' : '소리') + ' 파일 ' + (bytes.length / 1048576 >= 1 ? (bytes.length / 1048576).toFixed(1) + 'MB' : Math.round(bytes.length / 1024) + 'KB') + ' · 이 폰이 재생하지 못하는 형식이면 소리·화면이 안 나올 수 있습니다(파워포인트에서는 따로 재생됩니다).'));
          api.ctx.sheet({ title: '미리 재생', body: body, wide: true, buttons: [{ label: '닫기' }], onClose: function () { try { v.pause(); } catch (e) {} if (playUrl) { try { URL.revokeObjectURL(playUrl); } catch (e) {} playUrl = null; } } });
        });
      }).catch(function (e) { api.toast('재생 준비에 실패했습니다: ' + ((e && e.message) || e), 4200); });
    }
    function posterPick(sh) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        var url = URL.createObjectURL(f), im = new Image();
        im.onload = function () {
          var k = Math.min(1, 1000 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(im.naturalWidth * k)); cv.height = Math.max(2, Math.round(im.naturalHeight * k)); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
          canvasPng(cv).then(function (png) { api.env.run('표지 그림', function (pkg) { return ST_.setMediaPoster(pkg, st.path, sh.id, png).then(function (q) { return q.err ? q : { sel: sh.id }; }); }, function (q) { if (q && q.err) { api.fail(q.err); return; } st.sel = sh.id; api.toast('표지 그림을 바꿨습니다', 2600); api.U.refreshAll(); }); }, function (e) { api.toast('그림을 읽지 못했습니다: ' + ((e && e.message) || e), 4200); });
        };
        im.onerror = function () { URL.revokeObjectURL(url); api.toast('이 그림 형식은 열 수 없습니다', 3600); };
        im.src = url;
      };
      inp.click();
    }
    X.delMedia = function (sh) {
      api.env.run('동영상·소리 지우기', function (pkg) { return ST_.removeMedia(pkg, st.path, sh.id); }, function (r) { if (r && r.err) { api.fail(r.err); return; } st.sel = null; st.cell = null; api.toast((sh.media === 'audio' ? '소리를' : '동영상을') + ' 지웠습니다(되돌리려면 ↶)', 2600); api.U.refreshAll(); });
    };
    X.slideButtons = function (g) {
      api.btn(g, '움직임 효과', animSheet, 'big');
      api.btn(g, '디자인(색·글꼴·마스터)', designSheet, 'big');
    };
    X.insertButtons = function (g) {
      api.btn(g, '도식·SmartArt', function () { diagramSheet(null); }, 'big');
      api.btn(g, '동영상', function () { mediaPick('video'); }, 'big'); api.btn(g, '소리', function () { mediaPick('audio'); }, 'big');
    };
    X.ctxButtons = function (b, sh) {
      if (sh.kind === 'group' && ST_.readDiagram(st.xml, sh.id)) { var db = el('button', 'spx-cb', '도식 고치기'); db.type = 'button'; db.onclick = function () { diagramSheet(sh.id); }; b.appendChild(db); }
      if (sh.kind === 'smart' && saOk() && ST_.readSmartArt) { var sb = el('button', 'spx-cb', 'SmartArt 글 고치기'); sb.type = 'button'; sb.onclick = function () { smartTextSheet(sh); }; b.appendChild(sb); }
      if (sh.media) {
        var pb = el('button', 'spx-cb', '미리 재생'); pb.type = 'button'; pb.onclick = function () { playSheet(sh); }; b.appendChild(pb);
        var cb = el('button', 'spx-cb', '표지 그림'); cb.type = 'button'; cb.onclick = function () { posterPick(sh); }; b.appendChild(cb);
      }
    };
    X.animSheet = animSheet; X.designSheet = designSheet; X.diagramSheet = diagramSheet;
    return X;
  };

  // ======================= 차트 미리 그림(썸네일·쇼·PDF) — 슬라이드 위 차트 자리에 우리가 그린 그림을 얹는다 =======================
  function loadChartLib(ctx) { return ctx.loadScript('js/smartoffice/so-chart.js').then(function () { if (ctx.loadCss) ctx.loadCss('js/smartoffice/so-chart.css'); return global.SOChart; }); }
  // 슬라이드 idx 의 차트 목록 → Promise<[{ id, g(EMU), info }]>  (차트가 없으면 빈 목록, 읽기 실패는 info.why 로)
  X.chartsFor = function (ctx, roPkg, idx, cache) {
    var S = ST();
    return S.listSlides(roPkg).then(function (m) {
      var meta = m.slides[idx]; if (!meta) return { list: [] };
      if (cache && cache[meta.path] !== undefined) return cache[meta.path];
      return roPkg.read(meta.path).then(function (xml) {
        if (!xml || !/<c:chart\b/.test(xml)) { var e0 = { list: [] }; if (cache) cache[meta.path] = e0; return e0; }
        return Promise.all([S.readSlide(roPkg, meta.path), loadChartLib(ctx)]).then(function (r) {
          var charts = r[0].shapes.filter(function (q) { return q.kind === 'chart' && q.g; });
          return Promise.all(charts.map(function (q) {
            return S.readChart(roPkg, meta.path, q.id).then(function (c) { return { id: q.id, g: q.g, info: c.info || { why: 'x', kind: '' } }; }, function () { return { id: q.id, g: q.g, info: { why: 'x', kind: '' } }; });
          })).then(function (list) { var o = { list: list, path: meta.path }; if (cache) cache[meta.path] = o; return o; });
        });
      });
    });
  };
  // container 안에 차트 그림을 얹는다. kx = (container 의 한 변 px) / (슬라이드 EMU)
  X.paintCharts = function (container, list, kx) {
    var out = {};
    list.forEach(function (c) {
      var d = el('div', 'soc-over'), w = Math.max(6, c.g.w * kx), h = Math.max(6, c.g.h * kx);
      d.style.position = 'absolute'; d.style.overflow = 'hidden'; d.style.background = '#fff'; d.style.lineHeight = '0'; d.style.left = (c.g.x * kx) + 'px'; d.style.top = (c.g.y * kx) + 'px'; d.style.width = w + 'px'; d.style.height = h + 'px';
      var info = c.info;
      if (info && info.spec && global.SOChart) d.innerHTML = global.SOChart.svg(info.spec, w, h, { bg: true });
      else d.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:' + Math.max(7, Math.min(12, w / 14)) + 'px;line-height:1.3;color:#667;text-align:center;padding:2px;box-sizing:border-box;border:1px dashed #99a">차트</div>';
      container.appendChild(d); out[c.id] = d;
    });
    return out;
  };

  // ======================= 쇼: 움직임 효과 재생 =======================
  function pxv(v) { return parseFloat(v) || 0; }
  // 복제된 슬라이드 그림 속 도형 덩어리를 도형 id 에 짝짓는다(위치·크기가 가장 가까운 것). 미리보기 부품은 도형을 pt(=EMU/12700) 단위 px 로 놓는다.
  function mapDom(clone, shapes) {
    var sw = clone.querySelector('.slide-wrapper'); if (!sw) return {};
    var k = 1 / 12700, kids = [].slice.call(sw.children), used = {}, map = {};
    shapes.forEach(function (sh) {
      if (!sh.g || sh.kind === 'chart') return;
      var best = -1, bd = 1e12;
      kids.forEach(function (d, i) {
        if (used[i]) return;
        var dist = Math.abs(pxv(d.style.left) - sh.g.x * k) + Math.abs(pxv(d.style.top) - sh.g.y * k);
        if (d.style.width && d.style.height) dist += Math.abs(pxv(d.style.width) - sh.g.w * k) + Math.abs(pxv(d.style.height) - sh.g.h * k);
        if (dist < bd) { bd = dist; best = i; }
      });
      if (best >= 0 && bd <= 10) { used[best] = 1; map[sh.id] = kids[best]; }
    });
    return map;
  }
  var SLIDE_FROM = { 4: ['0 100%', '0 0'], 1: ['0 -100%', '0 0'], 8: ['-100% 0', '0 0'], 2: ['100% 0', '0 0'] };
  var WIPE_FROM = { 4: 'inset(100% 0 0 0)', 1: 'inset(0 0 100% 0)', 8: 'inset(0 100% 0 0)', 2: 'inset(0 0 0 100%)' };
  var REDUCE = function () { try { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  function runFx(node, e) {
    // 한 효과를 한 요소에 재생한다. 끝난 뒤의 모습(보임·숨김)은 곧바로 확정하고, 움직임은 웹 애니메이션으로 덧입힌다.
    var dur = Math.max(120, Math.min(2000, e.dur || 400)), anim = function (frames, o) { try { if (REDUCE() || !node.animate) return; node.animate(frames, Object.assign({ duration: dur, easing: 'ease-out' }, o || {})); } catch (x) {} };
    var key = e.key || '';
    if (e.cls === 'entr') {
      node.style.visibility = 'visible';
      if (key === 'fly') { var f = SLIDE_FROM[e.sub] || SLIDE_FROM[4]; anim([{ translate: f[0] }, { translate: f[1] }]); }
      else if (key === 'wipe') anim([{ clipPath: WIPE_FROM[e.sub] || WIPE_FROM[4] }, { clipPath: 'inset(0 0 0 0)' }]);
      else if (key === 'zoom') anim([{ scale: '0' }, { scale: '1' }]);
      else if (key === 'float') anim([{ opacity: 0, translate: '0 12%' }, { opacity: 1, translate: '0 0' }]);
      else if (key === 'appear') { /* 곧바로 */ }
      else anim([{ opacity: 0 }, { opacity: 1 }]);
    } else if (e.cls === 'exit') {
      if (key === 'xfly') { var g = SLIDE_FROM[e.sub] || SLIDE_FROM[4]; anim([{ translate: g[1] }, { translate: g[0] }]); setTimeout(function () { node.style.visibility = 'hidden'; }, REDUCE() ? 0 : dur - 10); }
      else if (key === 'xwipe') { anim([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: WIPE_FROM[e.sub] || WIPE_FROM[4] }]); setTimeout(function () { node.style.visibility = 'hidden'; }, REDUCE() ? 0 : dur - 10); }
      else if (key === 'xdisappear') node.style.visibility = 'hidden';
      else { anim([{ opacity: 1 }, { opacity: 0 }]); setTimeout(function () { node.style.visibility = 'hidden'; }, REDUCE() ? 0 : dur - 10); }
    } else if (e.cls === 'emph') {
      if (key === 'spin') anim([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: Math.min(dur, 1200) });
      else if (key === 'transp') node.style.opacity = '0.5';
      else anim([{ scale: '1' }, { scale: '1.4' }, { scale: '1' }], { duration: Math.min(dur, 900) });   // 커졌다 작아지기·고급 강조는 한 번 두근거리게
    }
  }
  function endState(node, e) { if (e.cls === 'entr') node.style.visibility = 'visible'; else if (e.cls === 'exit') node.style.visibility = 'hidden'; else if (e.key === 'transp') node.style.opacity = '0.5'; }
  // 쇼에서 슬라이드 한 장을 그린 뒤 부른다. o: { ctx, roPkg, index, clone, baseW(그림 가로 px, 확대 전), pxW(화면에 보이는 가로 px), wrap(차트를 얹을 상자), cache } → Promise<제어기|null>
  //   제어기: pending() 남은 클릭 단계가 있는지 · step() 다음 단계 재생 · finish() 끝 모습으로 바로
  X.showPrepare = function (o) {
    var S = ST(), pkg = o.roPkg, chartsP = o.wrap && o.ctx.flag && o.ctx.flag('chart') ? X.chartsFor(o.ctx, pkg, o.index, o.cache) : Promise.resolve({ list: [] });
    return Promise.all([S.listSlides(pkg), S.readDeck(pkg), chartsP]).then(function (r) {
      var meta = r[0].slides[o.index], W = r[1].W; if (!meta) return null;
      var ov = r[2].list.length ? X.paintCharts(o.wrap, r[2].list, o.pxW / W) : {};
      return S.readSlide(pkg, meta.path).then(function (rs) {
        var plan = S.animPlan(rs.xml); if (!plan.steps.length) return null;
        var map = mapDom(o.clone, rs.shapes); Object.keys(ov).forEach(function (id) { map[id] = ov[id]; });
        var played = 0, timers = [];
        Object.keys(plan.initialHidden).forEach(function (id) { if (map[id]) map[id].style.visibility = 'hidden'; });
        function playStep(i, instant) {
          plan.steps[i].list.forEach(function (e) {
            var n = map[e.spid]; if (!n) return;
            if (instant) { endState(n, e); return; }
            var t = setTimeout(function () { runFx(n, e); }, e.at); timers.push(t);
          });
        }
        var ctrl = {
          pending: function () { return played < plan.steps.length; },
          step: function () { if (played < plan.steps.length) playStep(played++, false); },
          finish: function () { timers.forEach(clearTimeout); while (played < plan.steps.length) playStep(played++, true); },
          stop: function () { timers.forEach(clearTimeout); }
        };
        if (!plan.steps[0].click) setTimeout(function () { if (played === 0) ctrl.step(); }, 350);       // 클릭 없이 시작하는 첫 효과
        return ctrl;
      });
    }).catch(function (e) { try { console.warn('쇼 효과 준비 실패', e); } catch (x) {} return null; });
  };

  // ======================= 슬라이드 줄 썸네일의 차트 =======================
  X.thumbCharts = function (ctx, roPkg, strip, n, tw, W, cache) {
    if (!(ctx.flag && ctx.flag('chart')) || n > 80) return;
    for (var i = 0; i < n; i++) (function (i) {
      X.chartsFor(ctx, roPkg, i, cache).then(function (r) {
        if (!r.list.length) return;
        var v = strip.querySelectorAll('.spx-thv')[i]; if (!v || !v.isConnected) return;
        v.style.position = 'relative'; if (v.querySelector('.soc-over')) return;
        X.paintCharts(v, r.list, tw / W);
      }, function () {});
    })(i);
  };

  global.SOPptxUIExt = X;
})(window);
