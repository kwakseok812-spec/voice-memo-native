/* ============================================================================
 * so-xlsx-pdf.js — S-Office 엑셀 → PDF 내보내기 (O-0861, v10.8 4회차)
 * ----------------------------------------------------------------------------
 * 워드 PDF 내보내기와 같은 「그림 방식」: 시트의 칸(값·글자 모양·바탕색·테두리·가로 맞춤·줄바꿈·합친 칸)을 쪽 크기 캔버스에 그려
 * 쪽마다 한 장의 그림으로 PDF(A4)에 담는다. 새 부품 없음 — 이미 들어 있는 pdf-lib 만 쓴다.
 *   · 글자는 그림이라 PDF 에서 글자를 고르거나 검색할 수 없다.
 *   · 보이는 시트(숨긴 시트 제외)를 차례로 담는다. 가로가 넓은 시트는 한 쪽 폭에 맞춰 줄이고(가로 방향 용지 사용), 세로로는 쪽을 나눈다.
 *   · 엑셀의 인쇄 설정(용지·여백·머리글/바닥글·반복 제목)은 반영하지 않는다 — 폰 화면 모양 기준이다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FAMILY = '"Malgun Gothic","Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo",Arial,sans-serif';
  var PX = 2;                               // 캔버스 픽셀 / pt
  var MAX_PAGES = 80;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 한 시트의 그릴 범위(내용·바탕색·테두리가 있는 끝 칸까지)
  function extent(env, sh) {
    var maxR = -1, maxC = -1, r, c, cell, st;
    var nr = Math.min(sh.usedR || 0, sh.nr), nc = Math.min(sh.usedC || 0, sh.nc);
    for (r = 0; r < nr; r++) {
      if (sh.rowY[r + 1] - sh.rowY[r] <= 0) continue;
      for (c = 0; c < nc; c++) {
        if (sh.colX[c + 1] - sh.colX[c] <= 0) continue;
        cell = env.cellOf(sh, r, c); st = env.styleAt(sh, r, c);
        if ((cell && env.display(cell) !== '') || (st && (st.bg || st.bl || st.br || st.bt || st.bb))) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
      }
    }
    (sh.merges || []).forEach(function (m) { if (m.s.r <= maxR && m.s.c <= maxC) { maxR = Math.max(maxR, Math.min(m.e.r, sh.nr - 1)); maxC = Math.max(maxC, Math.min(m.e.c, sh.nc - 1)); } });   // 합친 칸은 시작 칸이 범위 안일 때 끝까지
    return maxR < 0 ? null : { r1: maxR, c1: maxC };
  }

  function wrapLines(g, text, maxw) {
    var out = [];
    String(text).split('\n').forEach(function (par) {
      var line = '';
      for (var i = 0; i < par.length; i++) {
        var t = line + par.charAt(i);
        if (g.measureText(t).width > maxw && line) { out.push(line); line = par.charAt(i); } else line = t;
      }
      out.push(line);
    });
    return out;
  }

  // 한 쪽(행 r0..r1, 시트 가로 전체)을 캔버스에 그린다. k = 시트 픽셀 → 캔버스 픽셀 배율
  function drawPage(env, sh, ext, r0, r1, k, pageW, pageH, mx, my, merges, skip) {
    var cv = document.createElement('canvas'); cv.width = Math.round(pageW * PX); cv.height = Math.round(pageH * PX);
    var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    var ox = mx * PX, oy = my * PX, y0 = sh.rowY[r0];
    function X(c) { return ox + sh.colX[c] * k; }
    function Y(r) { return oy + (sh.rowY[r] - y0) * k; }
    function drawCell(r, c, rr1, cc1, cell) {
      var x = X(c), y = Y(r), w = X(cc1 + 1) - x, h = Y(rr1 + 1) - y; if (w <= 0.5 || h <= 0.5) return;
      var st = env.styleAt(sh, r, c), bg = (st && st.bg) || '';
      if (!bg && cell && cell.s && cell.s.patternType === 'solid' && cell.s.fgColor && /^[0-9A-Fa-f]{6}$/.test(cell.s.fgColor.rgb || '')) bg = '#' + cell.s.fgColor.rgb;
      if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      g.strokeStyle = '#d4d4d4'; g.lineWidth = Math.max(1, PX * 0.5); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);           // 칸 줄(화면과 같이 옅은 회색)
      var txt = cell ? env.display(cell) : '';
      if (txt !== '') {
        var fs = ((st && st.fs) ? st.fs * 4 / 3 : 14) * k, font = ((st && st.i) ? 'italic ' : '') + ((st && st.b) ? '700 ' : '400 ') + fs + 'px ' + ((st && st.fn) ? '"' + String(st.fn).replace(/["\\]/g, '') + '",' : '') + FAMILY;
        g.font = font; g.fillStyle = (st && st.color) || '#111'; g.textBaseline = 'middle';
        var al = (st && st.h) || (cell && cell.t === 'n' ? 'right' : (cell && (cell.t === 'b' || cell.t === 'e') ? 'center' : 'left')), pad = 4 * k;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        if (st && st.wrap) {
          var lines = wrapLines(g, txt, Math.max(4, w - 2 * pad)), lh = fs * 1.25, ty = y + Math.max(0, (h - lines.length * lh) / 2) + lh / 2;
          lines.forEach(function (ln, i) { var lw = g.measureText(ln).width, tx = al === 'right' ? x + w - pad - lw : (al === 'center' ? x + (w - lw) / 2 : x + pad); g.fillText(ln, tx, ty + i * lh); if (st.u) g.fillRect(tx, ty + i * lh + fs * 0.45, lw, Math.max(1, fs / 14)); });
        } else {
          var tw = g.measureText(txt).width, tx = al === 'right' ? x + w - pad - tw : (al === 'center' ? x + (w - tw) / 2 : x + pad), ty2 = y + h / 2;
          g.fillText(txt, tx, ty2);
          if (st && st.u) g.fillRect(tx, ty2 + fs * 0.45, tw, Math.max(1, fs / 14));
          if (st && st.st) g.fillRect(tx, ty2, tw, Math.max(1, fs / 14));
        }
        g.restore();
      }
      if (st) {
        g.strokeStyle = '#222'; g.lineWidth = Math.max(1, PX * 0.7);
        if (st.bl) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.stroke(); }
        if (st.br) { g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.stroke(); }
        if (st.bt) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
        if (st.bb) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke(); }
      }
    }
    var r, c;
    for (r = r0; r <= r1; r++) {
      if (sh.rowY[r + 1] - sh.rowY[r] <= 0) continue;
      for (c = 0; c <= ext.c1; c++) {
        if (sh.colX[c + 1] - sh.colX[c] <= 0 || skip[r + '|' + c]) continue;
        drawCell(r, c, r, c, env.cellOf(sh, r, c));
      }
    }
    merges.forEach(function (m) { if (m.s.r >= r0 && m.s.r <= r1) drawCell(m.s.r, m.s.c, Math.min(m.e.r, r1), Math.min(m.e.c, ext.c1), env.cellOf(sh, m.s.r, m.s.c)); });
    return cv;
  }

  // 시트 하나를 쪽 그림들로
  function sheetPages(env, i) {
    var sh = env.prep(i), ext = extent(env, sh); if (!ext) return { name: sh.name, pages: [], empty: true };
    var totalW = (sh.colX[ext.c1 + 1] || 0) * 0.75, portrait = [595.28, 841.89], land = [841.89, 595.28];
    var useLand = totalW > (portrait[0] - 56), P = useLand ? land : portrait, mx = 28, my = 28, cw = P[0] - 2 * mx, ch = P[1] - 2 * my;
    var scale = Math.min(1, cw / Math.max(1, totalW)), k = scale * 0.75 * PX;           // 시트 픽셀 → 캔버스 픽셀
    var merges = (sh.merges || []).filter(function (m) { return m.s.r <= ext.r1 && m.s.c <= ext.c1; }), skip = {};
    merges.forEach(function (m) { for (var r = m.s.r; r <= Math.min(m.e.r, ext.r1); r++) for (var c = m.s.c; c <= Math.min(m.e.c, ext.c1); c++) skip[r + '|' + c] = 1; });
    var rows = [], r0 = 0, r, lim = ch / (scale * 0.75);           // 한 쪽에 들어가는 시트 높이(px)
    r = 0;
    while (r <= ext.r1) {
      var start = r; r0 = sh.rowY[start];
      while (r <= ext.r1 && (sh.rowY[r + 1] - r0 <= lim || r === start)) r++;
      rows.push([start, r - 1]);
    }
    return { name: sh.name, sh: sh, ext: ext, P: P, mx: mx, my: my, k: k, merges: merges, skip: skip, rows: rows, scale: scale, pages: rows };
  }

  function run(env) {
    var ctx = env.ctx, list = env.vis.slice(), plans = [];
    ctx.busy('시트를 확인하는 중…');
    return sleep(30).then(function () {
      list.forEach(function (i) { plans.push(sheetPages(env, i)); });
      var n = 0; plans.forEach(function (p) { n += p.pages.length; });
      ctx.busy(null);
      if (!n) { ctx.toast('내보낼 내용이 있는 시트가 없습니다.', 3200); return; }
      if (n > MAX_PAGES) { ctx.toast('쪽이 너무 많아(' + n + '쪽) 폰에서는 내보내지 못합니다(' + MAX_PAGES + '쪽까지). 쪽 수를 줄이려면 시트를 나눠 저장하십시오.', 5200); return; }
      var shNames = plans.filter(function (p) { return p.pages.length; }).map(function (p) { return p.name; });
      ctx.confirm('PDF로 내보낼까요?', '보이는 시트 ' + shNames.length + '개(' + shNames.slice(0, 4).join(', ') + (shNames.length > 4 ? ' 외' : '') + ')를 지금 화면 모양대로 A4 ' + n + '쪽짜리 PDF 사본으로 만듭니다(원본 문서는 바뀌지 않습니다).\n\n· 글자가 그림으로 담겨서 PDF에서 글자를 고르거나 검색할 수 없습니다.\n· 가로가 넓은 시트는 한 쪽 폭에 맞춰 줄이고, 세로는 쪽을 나눕니다.\n· 엑셀의 인쇄 설정(용지·여백·머리글·반복 제목)은 반영되지 않습니다.', '내보내기', function () { build(env, plans, n); }, { cancelLabel: '취소' });
    });
  }

  function build(env, plans, total) {
    var ctx = env.ctx, done = 0, pdfPages = [], chain = Promise.resolve();
    ctx.busy('PDF 만드는 중… (0/' + total + ')');
    return ctx.loadScript('vendor/so/pdf/pdf-lib.min.js').then(function () {
      plans.forEach(function (p) {
        p.pages.forEach(function (rg) {
          chain = chain.then(function () { return sleep(0); }).then(function () {
            ctx.busy('PDF 만드는 중… (' + (done + 1) + '/' + total + ')');
            var cv = drawPage(env, p.sh, p.ext, rg[0], rg[1], p.k, p.P[0], p.P[1], p.mx, p.my, p.merges, p.skip);
            return new Promise(function (res, rej) { cv.toBlob(function (b) { if (!b) { rej(new Error('쪽 그림을 저장하지 못했습니다')); return; } b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, 'image/jpeg', 0.86); }).then(function (bytes) { cv.width = cv.height = 0; pdfPages.push({ bytes: bytes, w: p.P[0], h: p.P[1] }); done++; });
          });
        });
      });
      return chain;
    }).then(function () {
      var PL = global.PDFLib; return PL.PDFDocument.create().then(function (doc) {
        var seq = Promise.resolve();
        pdfPages.forEach(function (p) { seq = seq.then(function () { return doc.embedJpg(p.bytes).then(function (im) { var pg = doc.addPage([p.w, p.h]); pg.drawImage(im, { x: 0, y: 0, width: p.w, height: p.h }); }); }); });
        return seq.then(function () { return doc.save(); });
      });
    }).then(function (u8) {
      ctx.busy(null);
      var base = String(ctx.name || 'sheet').replace(/\.[^.]+$/, '');
      return Promise.resolve(ctx.saveCopy(new Blob([u8], { type: 'application/pdf' }), base + '.pdf', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('PDF 사본을 저장했습니다(' + done + '쪽). 원래 문서는 그대로입니다.', 3600); });
    }).catch(function (e) { ctx.busy(null); ctx.explainFail('PDF를 만들지 못했습니다(원본은 그대로입니다)', e, 5200); });
  }

  global.SOXlsxPdf = { run: run, _t: { extent: extent, sheetPages: sheetPages, drawPage: drawPage } };
})(window);
