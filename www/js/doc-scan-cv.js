/* doc-scan-cv.js — 오픈소스 OpenCV 로 독립 구현. 다른 앱의 코드·모델을 쓰지 않았다.
 * window.DocScanCV 하나만 노출: load / isReady / detect / warp / enhance / process. 화면 연결은 없다.
 * opencv.js(5.0.0, wasm 내장 단일 파일)는 load() 를 처음 부를 때만 <script> 로 주입한다(지연 로딩). */
(function (global) {
  'use strict';
  var DSCV_SRC = 'vendor/opencv.js';
  var DSCV_TIMEOUT_MS = 20000;
  var DSCV_WORK_SIDE = 600;       // 감지 작업 해상도(긴 변)
  var DSCV_MIN_AREA = 0.15;       // 후보 최소 면적 비율
  var DSCV_MIN_SCORE = 0.80;
  var DSCV_FULL_EDGE = 0.02;       // 「전체」판정: 가장자리 띠의 윤곽선 밀도 상한(배경 무늬가 있으면 전체가 아님)
  var DSCV_NONE_SCORE = 0.80;      // 이 미만이면 detect 가 how:'none'(DSCV_MIN_SCORE 와 같은 값)      // 이 값 미만이면 자르지 않는다(시험으로 정함 — REPORT_B1)
  var cv = null, loadP = null, failed = false, queue = Promise.resolve();

  function isReady() { return !!(cv && cv.Mat); }
  function hasFailed() { return !!failed; }

  function load(retry) {
    if (isReady()) return Promise.resolve(true);
    if (failed && !retry) return Promise.resolve(false);
    if (loadP && !retry) return loadP;
    failed = false;
    loadP = new Promise(function (resolve) {
      var done = false, timer = null, el = null;
      function fin(ok) {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        if (!ok) { failed = true; try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }   // 실패한 태그는 치워 재시도 때 중복되지 않게
        resolve(ok);
      }
      try {
        timer = setTimeout(function () { fin(false); }, DSCV_TIMEOUT_MS);
        var s = document.createElement('script'); el = s;
        s.charset = 'utf-8';                 // wasm 이 문자열로 들어 있어 인코딩 지정 필수
        s.async = true;
        s.src = DSCV_SRC;
        s.onerror = function () { fin(false); };
        s.onload = function () {
          try {
            var c = global.cv;
            if (!c) return fin(false);
            if (c.Mat) { cv = c; return fin(true); }
            if (typeof c.then === 'function') {   // 5.0 빌드: cv 가 thenable, 결과값이 실제 모듈
              c.then(function (m) {
                var mod = (m && m.Mat) ? m : (global.cv && global.cv.Mat ? global.cv : null);
                if (mod) { cv = mod; global.cv = mod; fin(true); } else fin(false);
              }, function () { fin(false); });
            } else {
              c.onRuntimeInitialized = function () { cv = global.cv; fin(!!(cv && cv.Mat)); };
            }
          } catch (e) { fin(false); }
        };
        document.head.appendChild(s);
      } catch (e) { fin(false); }
    });
    return loadP;
  }

  /* ───────── 공통 도우미 ───────── */
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function srcSize(src) { return { w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height }; }
  function toCanvas(src) {
    if (src && src.getContext && src.tagName === 'CANVAS') return src;
    var z = srcSize(src), c = mkCanvas(z.w, z.h);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }
  function fullCorners(w, h) { return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function polyArea(p) { var s = 0, i, j; for (i = 0; i < p.length; i++) { j = (i + 1) % p.length; s += p[i].x * p[j].y - p[j].x * p[i].y; } return Math.abs(s) / 2; }
  function order4(p) {   // 중심 기준 각도 정렬 → 시계방향(화면 좌표), x+y 가 가장 작은 점(좌상)부터
    var cx = 0, cy = 0, i; for (i = 0; i < 4; i++) { cx += p[i].x / 4; cy += p[i].y / 4; }
    var q = p.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    var k = 0; for (i = 1; i < 4; i++) if (q[i].x + q[i].y < q[k].x + q[k].y) k = i;
    return [q[k], q[(k + 1) % 4], q[(k + 2) % 4], q[(k + 3) % 4]];
  }
  function angleAt(a, b, c) {   // b 에서의 각도(도)
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d = (v1x * v2x + v1y * v2y) / ((Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }
  function isConvex(p) {
    var sg = 0, i, n = p.length;
    for (i = 0; i < n; i++) {
      var a = p[i], b = p[(i + 1) % n], c = p[(i + 2) % n];
      var z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (z !== 0) { if (sg === 0) sg = z > 0 ? 1 : -1; else if ((z > 0 ? 1 : -1) !== sg) return false; }
    }
    return true;
  }
  function distSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  /* 4각형 타당성: 볼록, 면적, 각도 50~130°, 대변 비율, 종횡비(긴/짧 ≤ 2.4). 원근 35° 기울임까지 허용하는 폭. */
  function quadOk(p, W, H) {
    if (!isConvex(p)) return false;
    var area = polyArea(p) / (W * H); if (area < DSCV_MIN_AREA) return false;
    var i; for (i = 0; i < 4; i++) { var an = angleAt(p[(i + 3) % 4], p[i], p[(i + 1) % 4]); if (an < 50 || an > 130) return false; }
    var t = dist(p[0], p[1]), r = dist(p[3], p[2]), l = dist(p[0], p[3]), rr = dist(p[1], p[2]);
    if (Math.min(t, r) < 1 || Math.min(l, rr) < 1) return false;
    if (Math.max(t, r) / Math.min(t, r) > 1.8 || Math.max(l, rr) / Math.min(l, rr) > 1.8) return false;
    var w = (t + r) / 2, h = (l + rr) / 2, asp = Math.max(w, h) / Math.min(w, h);
    return asp <= 2.4;
  }
  /* score(0~1) = 0.20 면적(클수록, 45% 이상이면 만점) + 0.15 각도(직각에서 벗어난 최대치 40° 이면 0)
   *            + 0.10 종횡비(1.1~1.7 만점, 1.0·2.4 에서 0) + 0.30 윤곽선 강도(네 변 위 표본점 근처에 실제 경계선이 있는 비율)
   *            + 0.25 직선도(후보 윤곽 점이 4각형 변에서 대각선의 2% 안에 있는 비율). 종이 분리 경로는 ×0.9. (실제 가중치는 코드의 마지막 return 식: 안팎 대비 항 추가) */
  function scoreQuad(p, W, H, edge, ew, eh, sc, contourPts, gd) {
    var diag = Math.hypot(W, H), i, k;
    var sArea = clamp01(polyArea(p) / (W * H) / 0.45);
    var dev = 0; for (i = 0; i < 4; i++) dev = Math.max(dev, Math.abs(angleAt(p[(i + 3) % 4], p[i], p[(i + 1) % 4]) - 90));
    var sAng = clamp01(1 - dev / 40);
    var w = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2, h = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2, asp = Math.max(w, h) / Math.min(w, h);
    var sAsp = asp < 1.1 ? clamp01((asp - 1) / 0.1) : (asp <= 1.7 ? 1 : clamp01(1 - (asp - 1.7) / 0.7));
    var hit = 0, tot = 0;
    for (i = 0; i < 4; i++) for (k = 0; k < 30; k++) {
      var t = (k + 0.5) / 30, a = p[i], b = p[(i + 1) % 4];
      var x = Math.round((a.x + (b.x - a.x) * t) * sc), y = Math.round((a.y + (b.y - a.y) * t) * sc);
      tot++;
      if (x < 0 || y < 0 || x >= ew || y >= eh) continue;
      if (edge[y * ew + x]) hit++;
    }
    var sEdge = hit / tot, sStr = 0.5, solF = 1;
    if (contourPts && contourPts.length) {
      var ok = 0; for (i = 0; i < contourPts.length; i++) {
        var d = Math.min(distSeg(contourPts[i], p[0], p[1]), distSeg(contourPts[i], p[1], p[2]), distSeg(contourPts[i], p[2], p[3]), distSeg(contourPts[i], p[3], p[0]));
        if (d <= 0.02 * diag) ok++;
      }
      sStr = ok / contourPts.length;
      var sol = polyArea(contourPts) / (polyArea(p) || 1);   // 윤곽이 4각형을 얼마나 채우나(두 장 겹침·귀퉁이 잘림은 낮다)
      solF = sol >= 0.92 ? 1 : clamp01((sol - 0.75) / 0.17);
    }
    // 안팎 밝기 대비: 변을 따라 안쪽 6px 과 바깥 6px 의 밝기 차가 8 이상인(글자를 지운 밝기) 표본 비율(문서 «안쪽» 표·그림 선은 안팎이 같아 걸러진다)
    var cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4, cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4, cOk = 0, cTot = 0;
    for (i = 0; i < 4; i++) {
      var A = p[i], B = p[(i + 1) % 4], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      if ((cx - A.x) * nx + (cy - A.y) * ny < 0) { nx = -nx; ny = -ny; }
      for (k = 0; k < 20; k++) {
        var tt = (k + 0.5) / 20, mx = A.x + dx * tt, my = A.y + dy * tt;
        var ix = Math.round(mx + 6 * nx), iy = Math.round(my + 6 * ny), ox = Math.round(mx - 6 * nx), oy = Math.round(my - 6 * ny);
        if (ix < 0 || iy < 0 || ix >= ew || iy >= eh) continue;
        cTot++;
        if (ox < 0 || oy < 0 || ox >= ew || oy >= eh) continue;   // 바깥이 화면 밖이면 «미충족»(공짜 점수 없음)
        if (Math.abs(gd[iy * ew + ix] - gd[oy * ew + ox]) >= 8) cOk++;
      }
    }
    var sCon = cTot ? cOk / cTot : 0;
    return solF * (0.15 * sArea + 0.10 * sAng + 0.08 * sAsp + 0.22 * sEdge + 0.20 * sStr + 0.25 * sCon);
  }

  /* ───────── 감지 ───────── */
  function contourPoints(cnt) {
    var d = cnt.data32S, a = [], i; for (i = 0; i + 1 < d.length; i += 2) a.push({ x: d[i], y: d[i + 1] }); return a;
  }
  function approx4(cnt, M) {   // 볼록 껍질 → approxPolyDP 오차를 키워가며 꼭짓점 4개를 찾는다
    var hull = M(new cv.Mat()); cv.convexHull(cnt, hull, false, true);
    var per = cv.arcLength(hull, true), ap = M(new cv.Mat()), e;
    for (e = 0.012; e <= 0.09; e += 0.004) {
      cv.approxPolyDP(hull, ap, e * per, true);
      if (ap.rows === 4) return contourPoints(ap);
    }
    return null;
  }
  function pickBest(cands) { var b = null, i; for (i = 0; i < cands.length; i++) if (!b || cands[i].score > b.score) b = cands[i]; return b; }

  function detectSync(canvas) {
    var mats = [];
    function M(m) { mats.push(m); return m; }
    try {
      var ow = canvas.width, oh = canvas.height;
      var s = Math.min(1, DSCV_WORK_SIDE / Math.max(ow, oh));
      var W = Math.max(8, Math.round(ow * s)), H = Math.max(8, Math.round(oh * s));
      var work = canvas;
      if (s < 1) { work = mkCanvas(W, H); var wx = work.getContext('2d'); wx.imageSmoothingQuality = 'high'; wx.drawImage(canvas, 0, 0, W, H); }
      var rgba = M(cv.imread(work)), gray = M(new cv.Mat()), blur = M(new cv.Mat());
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      // (a) 윤곽선: Canny(임계는 중앙값 기반) → 팽창·닫기 → 윤곽 → 4각형 후보
      var med = medianOf(blur.data), lo = Math.max(10, 0.66 * med * 0.6), hi = Math.max(lo + 20, Math.min(200, 1.33 * med * 0.6));
      var edges = M(new cv.Mat()); cv.Canny(blur, edges, lo, hi);
      var k3 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      var k5 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      var bgc = M(new cv.Mat()); cv.morphologyEx(blur, bgc, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9))));   // 글자·선을 지운 밝기(안팎 대비용)
      var ed = M(new cv.Mat()); cv.dilate(edges, ed, k5);            // 강도 확인용(경계선 ±2px)
      var cl = M(new cv.Mat()); cv.dilate(edges, cl, k3); cv.morphologyEx(cl, cl, cv.MORPH_CLOSE, k5);
      var cands = [];
      // 「전체」검사: 밝은 종이 영역이 화면 네 변 가장자리와 전체의 대부분을 덮으면 문서가 화면에 가득 찬 것
      var fm = M(new cv.Mat()); cv.threshold(blur, fm, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(fm, fm, cv.MORPH_CLOSE, M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15))));
      if (borderFill(fm, W, H) >= 0.7 && cv.countNonZero(fm) >= 0.85 * W * H && borderFill(edges, W, H, true) < DSCV_FULL_EDGE)
        return { corners: fullCorners(ow, oh), score: 0.9, how: 'edge', full: true };
      function paperFactor(q) {   // 안쪽이 무채색(종이)에 가까울수록 1. 하늘·천 같은 유채색 영역은 깎는다
        var mk = M(cv.Mat.zeros(H, W, cv.CV_8UC1)), pm = M(cv.matFromArray(4, 1, cv.CV_32SC2, [q[0].x, q[0].y, q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y].map(Math.round)));
        var pv = M(new cv.MatVector()); pv.push_back(pm); cv.fillPoly(mk, pv, new cv.Scalar(255));
        var m = cv.mean(rgba, mk), ch = Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]), br = (m[0] + m[1] + m[2]) / 3;
        var f = ch < 35 ? 1 : Math.max(0.45, 1 - (ch - 35) / 55);
        return br < 70 ? f * 0.8 : f;
      }
      function collect(binary, mode, mult, ext) {
        var cs = M(new cv.MatVector()), hier = M(new cv.Mat());
        cv.findContours(binary, cs, hier, ext ? cv.RETR_EXTERNAL : cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        var list = [], i; for (i = 0; i < cs.size(); i++) { var c = M(cs.get(i)); list.push({ c: c, a: cv.contourArea(c) }); }
        list.sort(function (p, q) { return q.a - p.a; });
        for (i = 0; i < list.length && i < 12; i++) {
          if (list[i].a < DSCV_MIN_AREA * W * H * 0.8) break;
          var q = approx4(list[i].c, M); if (!q) continue;
          q = order4(q); if (!quadOk(q, W, H)) continue;
          cands.push({ q: q, how: mode, score: mult * paperFactor(q) * scoreQuad(q, W, H, ed.data, ed.cols, ed.rows, 1, contourPoints(list[i].c), bgc.data) });
        }
      }
      collect(cl, 'edge', 1, false);
      var best = pickBest(cands);
      // (b) 종이(밝은 영역) 분리: Otsu → 닫기 → 가장 큰 연결 영역 → 근사 4각형 / minAreaRect
      if (!best || best.score < DSCV_MIN_SCORE) {
        var bw = M(new cv.Mat()); cv.threshold(blur, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        var k15 = M(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15)));
        cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, k15); cv.morphologyEx(bw, bw, cv.MORPH_OPEN, k5);
        var n0 = cands.length; collect(bw, 'paper', 0.9, true);
        if (cands.length === n0) {   // 근사 실패 → 가장 큰 영역의 최소 회전 사각형
          var cs2 = M(new cv.MatVector()), h2 = M(new cv.Mat()); cv.findContours(bw, cs2, h2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          var bi = -1, ba = 0, i2; for (i2 = 0; i2 < cs2.size(); i2++) { var ar = cv.contourArea(M(cs2.get(i2))); if (ar > ba) { ba = ar; bi = i2; } }
          if (bi >= 0 && ba >= DSCV_MIN_AREA * W * H) {
            var rr = cv.minAreaRect(M(cs2.get(bi))), v = cv.RotatedRect.points(rr);
            var q2 = order4([{ x: v[0].x, y: v[0].y }, { x: v[1].x, y: v[1].y }, { x: v[2].x, y: v[2].y }, { x: v[3].x, y: v[3].y }]);
            if (quadOk(q2, W, H)) cands.push({ q: q2, how: 'paper', score: 0.9 * paperFactor(q2) * scoreQuad(q2, W, H, ed.data, ed.cols, ed.rows, 1, contourPoints(M(cs2.get(bi))), bgc.data) });
          }
        }
        best = pickBest(cands);
      }
      var full = fullCorners(ow, oh);
      function scaled(q) { return q.map(function (p) { return { x: p.x * ow / W, y: p.y * oh / H }; }); }
      if (!best || best.score < DSCV_NONE_SCORE)   // 확신 낮음: 전체 모서리. 참고용으로 가장 나은 후보를 candidate 에 둔다
        return { corners: full, score: best ? best.score : 0, how: 'none', candidate: best ? { corners: scaled(best.q), score: best.score, how: best.how } : null };
      var q3 = best.q, i3, nearFull = true;
      for (i3 = 0; i3 < 4; i3++) if (Math.abs(q3[i3].x - (i3 === 1 || i3 === 2 ? W : 0)) > 0.025 * W || Math.abs(q3[i3].y - (i3 >= 2 ? H : 0)) > 0.025 * H) nearFull = false;
      if (nearFull) return { corners: full, score: Math.max(0.9, best.score), how: 'edge', full: true };   // 화면 가득 → 「전체」
      return { corners: scaled(q3), score: best.score, how: best.how };
    } finally { mats.forEach(function (m) { try { m.delete(); } catch (e) {} }); if (work && work !== canvas) shrinkCanvas(work); }
  }
  function borderFill(m, W, H, density) {   // 가장자리 띠(폭 4%)에서 마스크가 차지하는 비율의 최솟값(위·아래·왼·오른)
    var d = m.data, bx = Math.max(2, Math.round(W * 0.04)), by = Math.max(2, Math.round(H * 0.04)), x, y, t = 0, b = 0, l = 0, r = 0;
    for (y = 0; y < by; y++) for (x = 0; x < W; x++) { if (d[y * W + x]) t++; if (d[(H - 1 - y) * W + x]) b++; }
    for (x = 0; x < bx; x++) for (y = 0; y < H; y++) { if (d[y * W + x]) l++; if (d[y * W + W - 1 - x]) r++; }
    if (density) return (t + b + l + r) / (2 * by * W + 2 * bx * H);
    return Math.min(t / (by * W), b / (by * W), l / (bx * H), r / (bx * H));
  }
  function medianOf(d) {
    var h = new Array(256).fill(0), i, n = d.length, acc = 0; for (i = 0; i < n; i += 3) h[d[i]]++;
    for (i = 0; i < 256; i++) { acc += h[i]; if (acc >= n / 6) return i; }
    return 128;
  }

  /* ───────── 펴기 ───────── */
  /* 실제 종횡비(가로/세로) 추정 — Zhang·He 방식: 주점이 화면 중앙·정사각 화소라 가정하고 네 점에서 초점거리를 풀어 비를 구한다.
   * 풀리지 않거나(정면에 가까움) 변 길이 비와 1.25배 넘게 다르면 변 길이 평균의 비를 돌려준다. */
  function trueAspect(p, cx, cy) {
    function v(q) { return [q.x - cx, q.y - cy, 1]; }
    function cr(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dt(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    var rs = (dist(p[0], p[1]) + dist(p[3], p[2])) / ((dist(p[0], p[3]) + dist(p[1], p[2])) || 1);   // 변 길이 비(대체값)
    var m1 = v(p[0]), m2 = v(p[1]), m4 = v(p[2]), m3 = v(p[3]);   // m1 좌상, m2 우상, m3 좌하, m4 우하
    var c14 = cr(m1, m4), dn2 = dt(cr(m2, m4), m3), dn3 = dt(cr(m3, m4), m2);
    if (Math.abs(dn2) < 1e-9 || Math.abs(dn3) < 1e-9) return rs;
    var k2 = dt(c14, m3) / dn2, k3 = dt(c14, m2) / dn3;
    var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
    var den = n2[2] * n3[2]; if (Math.abs(den) < 1e-6) return rs;
    var f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / den; if (!(f2 > 0) || !isFinite(f2)) return rs;
    var a = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2], b = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
    if (!(a > 0) || !(b > 0)) return rs;
    var r = Math.sqrt(a / b);
    if (!isFinite(r) || r < 0.4 || r > 2.5 || r / rs > 1.25 || rs / r > 1.25) return rs;
    return r;
  }
  function warpSync(canvas, corners, opt) {
    var maxSide = (opt && opt.maxSide) || 2000, mats = [];
    function M(m) { mats.push(m); return m; }
    var p = corners, ii;
    for (ii = 0; ii < 4; ii++) if (!p[ii] || !isFinite(p[ii].x) || !isFinite(p[ii].y)) return canvas;   // 숫자가 아닌 모서리
    var top = dist(p[0], p[1]), bot = dist(p[3], p[2]), lf = dist(p[0], p[3]), rt = dist(p[1], p[2]);
    var w = Math.max(top, bot), h = Math.max(lf, rt);
    var ar = trueAspect(p, canvas.width / 2, canvas.height / 2);   // 원근을 반영한 실제 가로/세로 비
    if (ar) { w = Math.max(w, h * ar); h = w / ar; }
    if (Math.max(top, bot) / Math.max(1, Math.min(top, bot)) > 2 || Math.max(lf, rt) / Math.max(1, Math.min(lf, rt)) > 2) return canvas;  // 뒤틀림
    var sc = Math.min(1, maxSide / Math.max(w, h)); w = Math.round(w * sc); h = Math.round(h * sc);
    if (w < 200 || h < 200) return canvas;
    try {
      var src = M(cv.imread(canvas)), dst = M(new cv.Mat());
      var a = M(cv.matFromArray(4, 1, cv.CV_32FC2, [p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y]));
      var b = M(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]));
      var T = M(cv.getPerspectiveTransform(a, b));
      cv.warpPerspective(src, dst, T, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      var out = mkCanvas(w, h); cv.imshow(out, dst); return out;
    } finally { mats.forEach(function (m) { try { m.delete(); } catch (e) {} }); }
  }

  /* ───────── 보정 ───────── */
  function flatten(src, M) {   // 밝은 배경(종이·조명)을 추정해 나눈다. 1/N 크기에서 닫기(글자 지움) → 흐림 → 원래 크기
    var sm = M(new cv.Mat()), g = M(new cv.Mat()), long = Math.max(src.cols, src.rows), f = Math.min(1, 320 / long);
    var sz = new cv.Size(Math.max(8, Math.round(src.cols * f)), Math.max(8, Math.round(src.rows * f)));
    cv.cvtColor(src, g, src.channels() === 1 ? cv.COLOR_GRAY2RGB : cv.COLOR_RGBA2RGB);
    cv.resize(g, sm, sz, 0, 0, cv.INTER_AREA);
    var k = Math.max(7, Math.round(Math.max(sz.width, sz.height) / 22) | 1);
    var ker = M(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)));
    var bg = M(new cv.Mat()); cv.morphologyEx(sm, bg, cv.MORPH_CLOSE, ker);
    cv.GaussianBlur(bg, bg, new cv.Size(k | 1, k | 1), 0);
    var big = M(new cv.Mat()); cv.resize(bg, big, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
    var out = M(new cv.Mat()); cv.divide(g, big, out, 255, -1);
    return out;   // RGB 8비트
  }
  function enhanceSync(canvas, mode) {
    if (!mode || mode === 'orig') return canvas;
    var mats = [];
    function M(m) { mats.push(m); return m; }
    try {
      var src = M(cv.imread(canvas)), flat = flatten(src, M), out = M(new cv.Mat());
      if (mode === 'doc') {   // 색 유지 + 약한 대비(밝은 쪽을 흰색으로 모음) + 약한 선명도
        var adj = M(new cv.Mat()); flat.convertTo(adj, -1, 1.12, -22);
        var bl = M(new cv.Mat()); cv.GaussianBlur(adj, bl, new cv.Size(0, 0), 1.2);
        cv.addWeighted(adj, 1.35, bl, -0.35, 0, out);
      } else {
        var gr = M(new cv.Mat()); cv.cvtColor(flat, gr, cv.COLOR_RGB2GRAY);
        if (mode === 'bw') {
          var bs = Math.max(31, (Math.round(Math.max(gr.cols, gr.rows) / 45) | 1));
          cv.GaussianBlur(gr, gr, new cv.Size(3, 3), 0);
          cv.adaptiveThreshold(gr, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bs, 14);
        } else if (mode === 'gray') {
          gr.convertTo(out, -1, 1.12, -22);
        } else return canvas;
      }
      var oc = mkCanvas(canvas.width, canvas.height); cv.imshow(oc, out); return oc;
    } finally { mats.forEach(function (m) { try { m.delete(); } catch (e) {} }); }
  }

  /* ───────── 직렬 큐 · 공개 함수 ───────── */
  function enqueue(fn) {   // 한 번에 하나만 처리. 앞 작업이 실패해도 큐는 계속 간다.
    var p = queue.then(fn, fn); queue = p.then(function () {}, function () {}); return p;
  }
  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function shrinkCanvas(c) { try { if (c) { c.width = 0; c.height = 0; } } catch (e) {} }

  function detect(src) {
    return enqueue(function () {
      var t0 = now();
      return load().then(function (ok) {
        var c = null;
        try {
          c = toCanvas(src);
          if (!ok || !isReady()) return { corners: fullCorners(c.width, c.height), score: 0, how: 'none', ok: false, reason: 'cv_unavailable', ms: now() - t0 };
          var r = detectSync(c); r.ok = true; r.ms = now() - t0; return r;
        } catch (e) {
          var z = c ? { w: c.width, h: c.height } : { w: 1, h: 1 };
          return { corners: fullCorners(z.w, z.h), score: 0, how: 'none', ok: false, reason: String(e && e.message || e), ms: now() - t0 };
        }
      });
    });
  }
  function warp(canvas, corners, opt) {
    try { if (!isReady() || !corners || corners.length !== 4) return canvas; return warpSync(canvas, corners, opt); } catch (e) { return canvas; }
  }
  function enhance(canvas, mode) {
    try { if (!isReady()) return canvas; return enhanceSync(canvas, mode); } catch (e) { return canvas; }
  }
  function process(src, opt) {
    opt = opt || {};
    return enqueue(function () {
      var t0 = now(), c = null;
      function fail(reason) { return { ok: false, reason: reason, canvas: c || src, corners: c ? fullCorners(c.width, c.height) : [], score: 0, how: 'none', warped: false, ms: now() - t0 }; }
      return load().then(function (ok) {
        try {
          c = toCanvas(src);
          if (!ok || !isReady()) return fail('cv_unavailable');
          var corners, score, how, cropped = null;
          if (opt.corners && opt.corners.length === 4) { corners = opt.corners; score = 1; how = 'manual'; }
          else if (opt.auto === false) { corners = fullCorners(c.width, c.height); score = 0; how = 'none'; }
          else { var d = detectSync(c); corners = d.corners; score = d.score; how = d.how; if (d.full) how = 'edge'; if (d.full) score = Math.min(score, 1); }
          var cur = c, warped = false;
          if (score >= DSCV_MIN_SCORE && how !== 'none') {
            var w = warpSync(c, corners, { maxSide: opt.maxSide || 2000 });
            if (w !== c) { cur = w; warped = true; }
          }
          var e = enhanceSync(cur, opt.mode || 'doc');
          if (e !== cur) { if (cur !== c) shrinkCanvas(cur); cur = e; }
          return { ok: true, canvas: cur, corners: corners, score: score, how: how, warped: warped, ms: now() - t0, mode: opt.mode || 'doc' };
        } catch (err) { return fail(String(err && err.message || err)); }
      });
    });
  }

  /* ───────── 가운데 접힌 선 찾기 (O-0583 B2) ─────────
   * 입력: 펼친 책을 이미 편 그림(또는 사진). 출력: {pos: 0~1(가로 위치 비율), conf, how:'valley'|'line'|'center'}.
   * ① 열별 밝기 평균의 골짜기(접힌 곳 그림자) ② 세로로 길게 이어지는 경계선(열별 세로 경계 비율). 못 찾으면 가운데(0.5).
   * cv 없이 동작(캔버스 픽셀만 읽음). 예외를 던지지 않는다. */
  function findSpine(src) {
    try {
      var c = toCanvas(src), z = srcSize(c), W = Math.max(40, Math.min(400, z.w)), H = Math.max(40, Math.round(z.h * W / z.w));
      if (H > 600) { H = 600; }
      var t = mkCanvas(W, H), ctx = t.getContext('2d'); ctx.drawImage(c, 0, 0, W, H);
      var d = ctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H), i, x, y;
      for (i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      t.width = t.height = 0;
      var y0 = Math.round(H * 0.05), y1 = Math.round(H * 0.95), rows = Math.max(1, y1 - y0);
      var P = new Float32Array(W), E = new Float32Array(W);
      for (x = 0; x < W; x++) {
        var s = 0, e = 0;
        for (y = y0; y < y1; y++) { s += g[y * W + x]; if (x > 1 && x < W - 2) { var gx = Math.abs(g[y * W + x + 2] - g[y * W + x - 2]); if (gx > 24) e++; } }
        P[x] = s / rows; E[x] = e / rows;
      }
      function box(a, r) { var o = new Float32Array(W), k, acc, n; for (var q = 0; q < W; q++) { acc = 0; n = 0; for (k = q - r; k <= q + r; k++) if (k >= 0 && k < W) { acc += a[k]; n++; } o[q] = acc / n; } return o; }
      var rs = Math.max(2, Math.round(W * 0.012)), Ps = box(P, rs), Es = box(E, 2);
      var lo = Math.round(W * 0.36), hi = Math.round(W * 0.64), m = lo, bestV = 1e9;
      for (x = lo; x <= hi; x++) if (Ps[x] < bestV) { bestV = Ps[x]; m = x; }
      function maxIn(a, b) { var v = -1; a = Math.max(0, a); b = Math.min(W - 1, b); for (var q = a; q <= b; q++) if (Ps[q] > v) v = Ps[q]; return v; }
      var lr = maxIn(m - Math.round(W * 0.2), m - Math.round(W * 0.04)), rr = maxIn(m + Math.round(W * 0.04), m + Math.round(W * 0.2));
      var ref = Math.min(lr, rr), depth = ref > 1 ? (ref - bestV) / ref : 0;
      var lm = lo, bestE = -1;
      for (x = lo; x <= hi; x++) if (Es[x] > bestE) { bestE = Es[x]; lm = x; }
      var out;
      if (depth >= 0.04) {
        var px = m;
        if (bestE >= 0.5 && Math.abs(lm - m) <= W * 0.03) px = lm;   // 골짜기 바로 옆에 곧은 선이 있으면 선 위치로 다듬는다
        out = { pos: (px + 0.5) / W, conf: Math.min(1, depth * 5), how: 'valley' };
      } else if (bestE >= 0.55) out = { pos: (lm + 0.5) / W, conf: Math.min(1, bestE), how: 'line' };
      else out = { pos: 0.5, conf: 0, how: 'center' };
      return out;
    } catch (e) { return { pos: 0.5, conf: 0, how: 'center' }; }
  }

  global.DocScanCV = {
    load: load, isReady: isReady, hasFailed: hasFailed, detect: detect, warp: warp, enhance: enhance, process: process, findSpine: findSpine,
    DSCV_MIN_SCORE: 0.80, memSafe: true,
    _setMinScore: function (v) { DSCV_MIN_SCORE = v; DSCV_NONE_SCORE = v; }   // 시험용
  };
})(window);
