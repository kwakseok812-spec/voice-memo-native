/* promotion-xlsx.js — 「승진」 점수·항목을 엑셀(.xlsx) 한 파일로 (v9.68, O-0696 후속)
 * 왜: v9.67 의 「백업 내려받기」는 JSON 파일 하나였다. JSON 은 컴퓨터용 형식이라 폰에서 열어 봐도 읽을 수 없었다(대표님 말씀: 「읽을 수도 없는 파일」).
 *     그래서 내려받기의 기본 결과물을 사람이 읽고 여는 엑셀로 바꾼다(JSON 은 「컴퓨터용 백업」으로 남긴다 — promotion-edit.js).
 * 어떻게: 앱에 이미 들어 있는 SheetJS(vendor/xlsx.full.min.js)의 쓰기 기능만 쓴다. 새 라이브러리 · 외부 주소 호출 없음.
 *     점수 · 부문 이름 · 판정은 화면이 이미 계산해 보여 주는 값(PromoCalc.computeAll 결과, 서버 규칙표)을 그대로 옮긴다 — 점수표 숫자는 이 파일에 없다.
 *     저자 이름 · 연동 암호 · 메모는 담지 않는다(항목 제목 · 종류 · 날짜 · 점수만).
 * 구조(다음 단계 「엑셀 한꺼번에 올리기」의 양식 만들기도 같이 쓸 수 있게 나눠 두었다):
 *     model(opts)            → { sheets:[{ name, rows:[[셀…]…], widths:[열너비…], filter:'A1:H53'|null }] }   (SheetJS 없이도 돈다 = 순수 시험 가능)
 *     toWorkbook(XLSX, m)    → SheetJS 통합문서
 *     toFile(XLSX, m, name)  → File(.xlsx)   (폰 저장 길 savePhoneFile 에 그대로 넘긴다)
 *     셀: 글자 · 숫자 · { v, z }(숫자+표시 서식) · '' (빈칸)
 * 시험용 전역: PromoXlsx.
 */
(function (global) {
  'use strict';
  var MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var Z2 = '#,##0.00', ZP = '#,##0.00_)_)';       // ZP: 오른쪽에 글자 두 칸 여백(점수 열이 다음 열 글자에 붙어 보이지 않게)
  var SW = { pass: '통과', fail: '부족', unknown: '확인 전', wait: '기다리는 중' };      // 점수판 판정 낱말(promotion.js 의 SW 와 같다)
  var TAGS = { excluded: '기본 점수 제외', before: '현 직급 이전', partial: '부분 인정' };   // 부문 화면 꼬리표(promotion.js 의 TAGS 와 같다)
  var SHEET_SUM = '점수 요약', SHEET_ITEMS = '항목 목록', SHEET_GUIDE = '안내';

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function pad2(n) { return ('0' + n).slice(-2); }
  function dayText(d) { return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate(); }                  // 2026.11.1
  function dayIso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }         // 2026-11-01 (파일 이름 · 폰의 날짜 기준)
  function timeText(d) { return dayText(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fileName(d) { return 'promotion_scores_' + dayIso(d || new Date()) + '.xlsx'; }
  function fx(n, z) { return { v: n, z: z || Z2 }; }                                                                        // 점수 칸: 숫자 + 소수 둘째 자리 서식
  function fmt(n) { return (Number(n) || 0).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ymText(cut) { return cut ? (cut[0] + '.' + cut[1]) : ''; }

  /* 날짜 글자: 「2025.3」 식(월 · 일이 없으면 있는 데까지). 값 이름은 항목 입력 칸(promotion-edit.js)과 같다. */
  function ymd(v, p, level) {
    var y = v[p + 'Year'], m = v[p + 'Month'], d = v[p + 'Day'];
    if (!has(y)) return '';
    var s = String(y);
    if (level >= 2 && has(m)) s += '.' + m;
    if (level >= 3 && has(m) && has(d)) s += '.' + d;
    return s;
  }
  function range(a, b) { return a && b ? a + ' ~ ' + b : (a ? a + ' ~' : (b ? '~ ' + b : '')); }
  function dateOf(it) {
    var v = isObj(it.value) ? it.value : {}, ay = it.academic_year, s;
    if (has(v.startYear) || has(v.endYear)) {
      var lv = it.item_code === '3-1' ? 2 : 3;
      s = range(ymd(v, 'start', lv), ymd(v, 'end', lv)); if (s) return s;
    }
    if (has(v.completionYear)) return ymd(v, 'completion', 3);
    if (has(v.pubYear)) return String(v.pubYear) + (has(v.pubMonth) ? '.' + v.pubMonth : '');
    if (has(ay)) {
      s = /^\d{4}$/.test(String(ay)) ? ay + '학년도' : String(ay);
      if (has(v.semester)) s += ' ' + v.semester + '학기';
      return s;
    }
    return '';
  }

  /* 부문 화면(promotion.js renderSection)이 항목 밑에 보여 주는 설명과 같은 말: 점수에서 빠졌거나 부분 인정이면 이유, 보직(3-1)이면 인정 개월 */
  function noteOf(r) {
    var rs = r.reasons || [];
    if (rs.length && r.status !== 'in') return rs.join(' · ');
    if (r.code === '3-1') return '재임 ' + r.months + '개월 인정' + (r.monthsRaw !== r.months ? ' (입력 ' + r.monthsRaw + '개월)' : '') + (rs.length ? ' · ' + rs.join(' · ') : '');
    return '';
  }
  function subNameOf(R, code, sub) { var m = R.sub_names && R.sub_names[code]; return (m && sub && m[sub]) || ''; }
  function kindText(R, it) { var n = (R.names && R.names[it.item_code]) || '', sn = subNameOf(R, it.item_code, it.sub_type); return it.item_code + (n ? ' ' + n : '') + (sn ? ' · ' + sn : ''); }
  function sectionText(R, s) { return s + ' ' + ((R.sections && R.sections[s]) || ''); }

  /* ---------- 시트 1: 점수 요약 ---------- */
  function summaryRows(o, A, R, now) {
    var T = A.T, c = A.checks, ten = A.tenure, i, rows = [], CN = global.PromoCalc.CHECK_NAMES;
    var expLabel = A.expCut ? '신청 마감(' + ymText(A.expCut) + ')까지 예상' : '임기 끝까지 예상';
    rows.push([T.label + ' 점수 요약 (참고용)']);
    rows.push(['만든 날짜', dayText(now)]);
    rows.push(['규정판', o.rulesVer || R.ver || '']);
    rows.push([]);
    rows.push(['구분', '오늘 기준(바닥값)', expLabel, '합격선']);
    rows.push(['총점', fx(A.today.total), fx(A.expected.total), fx(T.total)]);
    if (A.bonus) rows.push(['총장 가점(총점에만 들어갑니다)', fx(A.bonus), fx(A.bonus), '']);
    rows.push(['대학발전(부문 3)', fx(A.today.sec3), fx(A.expected.sec3), fx(T.sec3)]);
    rows.push([]);
    rows.push(['부문', '오늘 기준 인정 점수', expLabel + ' 인정 점수', '인정 한도', '항목 점수 합계(한도 적용 전)', '항목 수']);
    var cnt = {}; A.today.rows.forEach(function (r) { var s = parseInt(r.code.charAt(0), 10); cnt[s] = (cnt[s] || 0) + 1; });
    for (i = 1; i <= 5; i++) {
      var sc = A.today.sections[i], se = A.expected.sections[i];
      rows.push([sectionText(R, i), fx(sc.used), fx(se.used), sc.max ? fx(sc.max) : '없음', fx(sc.raw), cnt[i] || 0]);
    }
    rows.push([]);
    rows.push(['필수 요건', '판정', '현재', '기준', '설명']);
    /* 총점 */
    rows.push([CN.total, SW[c.total.s], fx(c.total.value), fx(c.total.need), c.total.s === 'pass'
      ? '오늘 기준(바닥값)으로도 합격선보다 ' + fmt(c.total.value - c.total.need) + '점 많습니다. ' + expLabel + '은 ' + fmt(A.expected.total) + '점입니다.'
      : '합격선까지 ' + fmt(c.total.need - c.total.value) + '점이 모자랍니다.']);
    /* 대학발전 */
    rows.push([CN.sec3, SW[c.sec3.s], fx(c.sec3.value), fx(c.sec3.need), '보직·TFT·정책연구 점수입니다. 오늘 기준은 보직을 지금까지 재임한 개월만 셉니다. ' + expLabel + '은 ' + fmt(A.expected.sec3) + '점입니다.']);
    /* 책임저자 */
    var nl = c.lead.papers.length;
    var minL = num(R.qual && R.qual.min_lead_papers);
    rows.push([CN.lead, SW[c.lead.s], nl, minL, 'SCI·등재급 책임저자(제1저자 또는 교신저자) 논문이 ' + nl + '편입니다. ' + minL + '편 이상이면 통과입니다.' + (c.lead.manual ? ' 직접 확인으로 통과 처리돼 있습니다.' : '')]);
    /* 교수업적 순위 */
    var evTxt;
    if (c.eval.s === 'unknown') evTxt = '판정할 학년도 값이 없습니다' + (c.eval.exYears.length ? '(부처장 재임 학년도는 평가에서 빠집니다)' : '') + '. 교수업적 순위가 입력되면 판정합니다.';
    else evTxt = c.eval.used.map(function (e) { return e.ay + '학년도 상위 ' + e.pct + '%'; }).join(', ') + ' 기준입니다. 평균이 상위 ' + c.eval.max + '% 이내(값이 작을수록 좋습니다)면 통과입니다.';
    rows.push([CN.eval, SW[c.eval.s], c.eval.avg === null || c.eval.avg === undefined ? '' : fx(c.eval.avg), num(c.eval.max), evTxt]);
    /* 재직 */
    var tt;
    if (ten.state === 'unknown') tt = '현 직급 시작일(부교수 임용일)이 입력 전이라 승진임용 가능일을 계산하지 못했습니다.';
    else tt = '현 직급 시작일 ' + global.PromoCalc.fmtDay(ten.start) + ' → 승진임용 가능일 ' + global.PromoCalc.fmtDay(ten.eligible) + '(' + num(R.tenure_years) + '년 이상 재직 뒤 첫 ' + num(R.promo_month) + '월 ' + num(R.promo_day) + '일자)' + (ten.state === 'pass' ? '이 지났습니다.' : '입니다.');
    rows.push([CN.tenure, SW[ten.state], '', num(R.tenure_years), tt + ' 기준은 ' + num(R.tenure_years) + '년입니다.']);
    rows.push([]);
    rows.push(['한 줄 요약', A.say]);
    rows.push(['참고 계산이며 공식 판정이 아닙니다.']);
    return rows;
  }

  /* ---------- 시트 2: 항목 목록 ---------- */
  var ITEM_HEAD = ['부문', '종류', '제목·내용', '일자', '점수', '확인', '점수 상태', '실적 탭 연결', '휴지통에 있음'];
  function itemRows(o, A, R, PC) {
    var byId = {}; A.today.rows.forEach(function (r) { byId[r.id] = r; });
    var list = (o.items || []).filter(function (it) { return !!it; });
    list.sort(function (a, b) {
      var ta = a.deleted_at ? 1 : 0, tb = b.deleted_at ? 1 : 0; if (ta !== tb) return ta - tb;
      if (a.item_code !== b.item_code) return a.item_code < b.item_code ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return list.map(function (it) {
      var r = byId[it.id], fl = isObj(it.flags) ? it.flags : {}, trashed = !!it.deleted_at, tags = [], sc;
      if (trashed) tags.push('휴지통');
      else if (r) {
        if (r.status !== 'in' && TAGS[r.status]) tags.push(TAGS[r.status]);
        if (fl.dup_suspect) tags.push('중복 의심');
        var nt = noteOf(r); if (nt) tags.push(nt);
      }
      if (trashed || !r) sc = '';
      else if (r.status === 'excluded' || r.status === 'before') sc = fx(0, ZP);
      else sc = fx(it.item_code === '1-1' && r.part !== null && r.part !== undefined ? r.part : r.score, ZP);        // 부문 화면에 보이는 값과 같다
      var sec = parseInt(String(it.item_code).charAt(0), 10);
      return [sectionText(R, sec), kindText(R, it), PC.rowLabel(it, R), dateOf(it), sc, fl.unverified ? '확인 전' : '확인됨', tags.join(' · '), it.ach_id ? '연결됨' : '연결 안 됨', trashed ? '예' : '아니오'];
    });
  }

  /* ---------- 시트 3: 안내 ---------- */
  function guideRows(o, R, now, nItems, nTrash) {
    return [
      ['승진 점수 내보내기 파일'],
      ['스마트비서 「승진」 점수판의 점수와 항목을 엑셀로 옮긴 사본입니다. 참고용이며 공식 판정이 아닙니다.'],
      ['만든 시각', timeText(now)],
      ['규정판', o.rulesVer || R.ver || ''],
      [],
      ['시트', '들어 있는 것'],
      [SHEET_SUM, '오늘 기준·임기 끝까지 예상 점수, 부문별 점수와 인정 한도, 필수 요건 판정'],
      [SHEET_ITEMS, '입력한 승진 항목 ' + nItems + '건을 한 줄씩. 휴지통에 있는 항목(지금 ' + nTrash + '건)도 맨 아래에 함께 보이고 점수에는 안 들어갑니다.'],
      [],
      ['알아 두십시오', '항목 점수를 모두 더해도 총점과 다를 수 있습니다. 강의평가는 평균으로 계산하고, 일부 부문에는 인정 한도가 있기 때문입니다.'],
      ['', '이 파일을 고쳐도 앱의 승진 자료는 바뀌지 않습니다.'],
      ['', '연동 암호와 저자 이름은 들어 있지 않습니다.'],
      ['', '서식은 단순합니다(굵은 글씨·색 없음). 맨 윗줄이 머리글이고, 항목 목록의 머리글 칸에서 걸러 볼 수 있습니다.']
    ];
  }

  /* ---------- 전체 ---------- */
  /* opts: { A: PromoCalc.computeAll 결과, items: 승진 항목 전부(휴지통 포함), rules, rulesVer, now: Date } */
  function model(o) {
    var PC = global.PromoCalc, A = o && o.A, R = (o && o.rules) || {};
    if (!A || A.error) throw new Error('점수를 계산하지 못해 엑셀을 만들 수 없습니다');
    var now = o.now || new Date(), items = o.items || [];
    var iRows = itemRows(o, A, R, PC), trashN = items.filter(function (x) { return x && x.deleted_at; }).length;
    var head = ITEM_HEAD, all = [head].concat(iRows);
    var sums = summaryRows(o, A, R, now), guide = guideRows(o, R, now, items.length, trashN);
    return { fileName: fileName(now), sheets: [
      { name: SHEET_SUM, rows: sums, widths: widths(sums, 10, 46, 40), filter: null },
      { name: SHEET_ITEMS, rows: all, widths: widths(all, 8, 70, 0, [24, 60, 110, 28, 14, 12, 100, 16, 16]), filter: 'A1:' + colName(head.length - 1) + all.length },
      { name: SHEET_GUIDE, rows: guide, widths: widths(guide, 10, 60), filter: null }
    ] };
  }

  /* ---------- 열 너비(한글은 두 칸으로 센다) ---------- */
  function cellText(c) { if (c === null || c === undefined) return ''; if (isObj(c)) return c.z ? fmt(c.v) : String(c.v); return String(c); }
  function dispLen(s) { var n = 0, i; s = String(s); for (i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e80 ? 2 : 1; return n; }
  function widths(rows, min, max, ovf, maxes) {      // ovf: 둘째 칸부터 이 길이를 넘는 긴 글은 옆 칸(비어 있음)으로 흘러가게 두고 열 너비에 넣지 않는다
    var w = [];
    rows.forEach(function (r) {
      if (r.length === 1 && rows.length > 1) return;                       // 제목 · 한 줄 문장은 옆 칸으로 흘러가니 열 너비에 넣지 않는다
      r.forEach(function (c, i) { var l = dispLen(cellText(c)) + 2; if (ovf && i >= 1 && typeof c === 'string' && l > ovf) return; if (!w[i] || l > w[i]) w[i] = l; });
    });
    return w.map(function (x, i) { return Math.max(min, Math.min((maxes && maxes[i]) || max, x || min)); });
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  /* ---------- SheetJS 로 옮기기 ---------- */
  function sheetOf(XLSX, sh) {
    var ws = {}, maxC = 0, r, c;
    for (r = 0; r < sh.rows.length; r++) {
      for (c = 0; c < sh.rows[r].length; c++) {
        var cell = sh.rows[r][c];
        if (cell === '' || cell === null || cell === undefined) continue;
        var ref = XLSX.utils.encode_cell({ r: r, c: c }), o;
        if (isObj(cell)) o = { t: 'n', v: cell.v, z: cell.z };
        else if (typeof cell === 'number') o = { t: 'n', v: cell };
        else o = { t: 's', v: String(cell) };
        ws[ref] = o; if (c + 1 > maxC) maxC = c + 1;
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, sh.rows.length - 1), c: Math.max(0, maxC - 1) } });
    ws['!cols'] = sh.widths.map(function (w) { return { wch: w }; });
    if (sh.filter) ws['!autofilter'] = { ref: sh.filter };
    return ws;
  }
  function toWorkbook(XLSX, m) {
    var wb = XLSX.utils.book_new();
    m.sheets.forEach(function (sh) { XLSX.utils.book_append_sheet(wb, sheetOf(XLSX, sh), sh.name); });
    wb.Props = { Title: '승진 점수 요약', Author: '스마트비서', CreatedDate: new Date() };
    return wb;
  }
  function toBytes(XLSX, m) { return XLSX.write(toWorkbook(XLSX, m), { type: 'array', bookType: 'xlsx' }); }
  function toFile(XLSX, m, name) { return new File([toBytes(XLSX, m)], name || m.fileName, { type: MIME }); }

  global.PromoXlsx = { model: model, toWorkbook: toWorkbook, toBytes: toBytes, toFile: toFile, fileName: fileName, dayIso: dayIso, dayText: dayText, MIME: MIME, widths: widths, colName: colName, sheetOf: sheetOf };
})(typeof window !== 'undefined' ? window : globalThis);
