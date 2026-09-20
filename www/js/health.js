/* ============================================================================
 * health.js — 건강 탭 (당뇨 관리 자가기록)  [덜 귀찮게가 최우선]
 * ----------------------------------------------------------------------------
 * - 오늘 기록: 공복혈당·체중·수면(스텝퍼+숫자) / 식단(프리셋 칩+직접입력) /
 *              간식 / 당뇨약(아침·저녁)·영양제(원탭 토글). 한 항목 바꿀 때마다 자동 저장.
 * - 기록 보기: 날짜별 리스트 + 공복혈당·체중 추세 그래프(순수 SVG, 외부 라이브러리 X).
 * - 저장: Supabase public.health_logs 에 날짜(log_date) 기준 upsert(merge-duplicates).
 *         쓰는 키는 공개(publishable) 키뿐(OfficeBridge.CONFIG). RLS: anon INSERT/UPDATE/SELECT.
 * - 앱 텔레그램 건강 문진(건강일지.md)과는 완전히 별개 경로. 서로 건드리지 않는다.
 *
 * app.js 연결: window 이벤트/버튼으로 화면을 열면 HealthTab.open() 이 렌더한다.
 *   HealthTab.init({toast}) 로 토스트만 주입받는다(결합 최소화).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function cfg() { return (global.OfficeBridge && OfficeBridge.CONFIG) || null; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var _toast = function () {};

  /* ---------- 날짜 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dstr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayStr() { return dstr(new Date()); }
  function fmtDayLabel(s) {
    // 'YYYY-MM-DD' → 'M월 D일 (요일)' + 오늘/어제 표시
    var p = (s || '').split('-'); if (p.length !== 3) return s;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((t - d) / 86400000);
    var rel = diff === 0 ? ' · 오늘' : diff === 1 ? ' · 어제' : diff === 2 ? ' · 그제' : '';
    return (+p[1]) + '월 ' + (+p[2]) + '일 (' + wd + ')' + rel;
  }

  /* ---------- 상태 ---------- */
  var FIELDS = ['fasting_glucose', 'weight', 'sleep_hours', 'breakfast', 'lunch', 'dinner', 'snack', 'med_morning', 'med_evening', 'supplement'];
  var MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
  var today = null;           // 현재 편집 중인 오늘 레코드
  var saveTimer = null;
  var inited = false;

  function blankRecord(dateStr) {
    var r = { log_date: dateStr };
    FIELDS.forEach(function (k) { r[k] = null; });
    return r;
  }
  function isSet(v) { return !(v === null || v === undefined || v === ''); }
  function recordedCount() {
    var n = 0; FIELDS.forEach(function (k) { if (isSet(today[k])) n++; }); return n;
  }

  /* ---------- localStorage: 오늘값 캐시 + 음식 프리셋 학습 ---------- */
  function cacheKey(dateStr) { return 'smart_health_day_' + dateStr; }
  function cacheGet(dateStr) {
    try { var s = localStorage.getItem(cacheKey(dateStr)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function cachePut() { try { localStorage.setItem(cacheKey(today.log_date), JSON.stringify(today)); } catch (e) {} }

  var BASE_FOODS = ['양배추', '현미밥', '계란', '두부', '닭가슴살', '김치', '나물', '생선', '샐러드', '사과', '견과류', '우유', '블랙커피'];
  var FOODS_KEY = 'smart_health_foods';
  function foodsGet() { try { return JSON.parse(localStorage.getItem(FOODS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function foodsPut(m) { try { localStorage.setItem(FOODS_KEY, JSON.stringify(m)); } catch (e) {} }
  function foodBump(name) {
    name = (name || '').trim(); if (!name) return;
    var m = foodsGet(); m[name] = (m[name] || 0) + 1; foodsPut(m);
  }
  // 표시용 프리셋: 기본 + 학습분 합쳐 빈도순(자주 고른 게 위). 상한 24개.
  function presetFoods() {
    var counts = foodsGet(), order = {};
    BASE_FOODS.forEach(function (f, i) { order[f] = i; if (!(f in counts)) counts[f] = 0; });
    var arr = Object.keys(counts);
    arr.sort(function (a, b) {
      if ((counts[b] || 0) !== (counts[a] || 0)) return (counts[b] || 0) - (counts[a] || 0);
      var oa = (a in order) ? order[a] : 999, ob = (b in order) ? order[b] : 999;
      if (oa !== ob) return oa - ob;
      return a < b ? -1 : 1;
    });
    return arr.slice(0, 24);
  }
  function mealTokens(v) {
    return (v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ---------- 네트워크(Supabase, publishable 키) ---------- */
  function upsertToday() {
    var c = cfg(); if (!c) return Promise.resolve(false);
    var body = { log_date: today.log_date, updated_at: new Date().toISOString() };
    FIELDS.forEach(function (k) { body[k] = isSet(today[k]) ? today[k] : null; });
    return fetch(c.url + '/rest/v1/health_logs', {
      method: 'POST',
      headers: {
        'apikey': c.key, 'Authorization': 'Bearer ' + c.key,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(body)
    }).then(function (r) { return r.ok; });
  }
  function fetchRange(fromStr, toStr) {
    var c = cfg(); if (!c) return Promise.resolve([]);
    var q = '?select=*&log_date=gte.' + fromStr + '&log_date=lte.' + toStr + '&order=log_date.desc';
    return fetch(c.url + '/rest/v1/health_logs' + q, {
      headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key }
    }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
  }
  function fetchOne(dateStr) {
    return fetchRange(dateStr, dateStr).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function scheduleSave() {
    cachePut();
    setSaveState('saving');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      upsertToday().then(function (ok) {
        setSaveState(ok ? 'saved' : 'err');
      }).catch(function () { setSaveState('err'); });
    }, 500);
  }
  function setSaveState(s) {
    var el = $('hSaveState'); if (!el) return;
    if (s === 'saving') { el.textContent = '저장 중…'; el.className = 'hsave work'; }
    else if (s === 'saved') { el.textContent = '자동 저장됨'; el.className = 'hsave ok'; }
    else { el.textContent = '저장 대기(연결 확인)'; el.className = 'hsave err'; }
  }

  /* ============================ 오늘 기록 렌더 ============================ */
  function numRow(k, label, unit, step) {
    var v = isSet(today[k]) ? today[k] : '';
    return '<div class="hitem hnum" data-k="' + k + '" data-step="' + step + '">' +
      '<div class="hitem-top"><span class="hlab">' + label + ' <small>' + unit + '</small></span>' + chk(k) + '</div>' +
      '<div class="hstep">' +
      '<button type="button" class="hstepbtn" data-d="-1" aria-label="줄이기">−</button>' +
      '<input class="hval" inputmode="decimal" value="' + esc(v) + '" placeholder="—">' +
      '<button type="button" class="hstepbtn" data-d="1" aria-label="늘리기">＋</button>' +
      '</div></div>';
  }
  function chk(k) {
    return '<i class="hchk' + (isSet(today[k]) ? ' on' : '') + '"><svg><use href="#i-check"/></svg></i>';
  }
  function mealBlock(k, label, withNone) {
    var sel = mealTokens(today[k]);
    var selSet = {}; sel.forEach(function (t) { selSet[t] = 1; });
    var presets = presetFoods();
    if (withNone) presets = ['없음'].concat(presets.filter(function (f) { return f !== '없음'; }));
    var chips = presets.map(function (f) {
      return '<button type="button" class="chip hchip' + (selSet[f] ? ' on' : '') + '" data-food="' + esc(f) + '">' + esc(f) + '</button>';
    }).join('');
    // 직접입력: 프리셋에 없는 선택 토큰만 표시
    var presetSet = {}; presets.forEach(function (f) { presetSet[f] = 1; });
    var custom = sel.filter(function (t) { return !presetSet[t]; }).join(', ');
    return '<div class="hitem hmeal" data-k="' + k + '">' +
      '<div class="hitem-top"><span class="hlab">' + label + '</span>' + chk(k) + '</div>' +
      '<div class="chips hchips">' + chips + '</div>' +
      '<div class="input filled hcustom"><input class="hcustomin" value="' + esc(custom) + '" placeholder="직접 입력 (쉼표로 여러 개)"></div>' +
      '</div>';
  }
  function togBlock(k, label) {
    return '<div class="hitem htog" data-k="' + k + '">' +
      '<span class="hlab">' + label + '</span>' +
      '<button type="button" class="htogbtn ' + togCls(today[k]) + '" data-k="' + k + '">' + togTxt(today[k]) + '</button>' +
      '</div>';
  }
  function togCls(v) { return v === true ? 'on' : v === false ? 'off' : ''; }
  function togTxt(v) { return v === true ? '복용함 ✓' : v === false ? '미복용' : '탭하여 기록'; }

  function renderToday() {
    var host = $('hToday'); if (!host) return;
    host.innerHTML =
      '<div class="hhead"><div class="hdate">' + esc(fmtDayLabel(today.log_date)) + '</div>' +
      '<span id="hSaveState" class="hsave"></span></div>' +
      '<div class="hprog"><b id="hProgN">' + recordedCount() + '</b> / ' + FIELDS.length + ' 기록됨 · <span class="hprog-sub">탭·토글로 빠르게</span></div>' +

      '<div class="hgroup">' +
      numRow('fasting_glucose', '공복혈당', 'mg/dL', 1) +
      numRow('weight', '체중', 'kg', 0.1) +
      numRow('sleep_hours', '수면시간', '시간', 0.5) +
      '</div>' +

      '<div class="hsec">식단</div>' +
      '<div class="hgroup">' +
      mealBlock('breakfast', '아침', false) +
      mealBlock('lunch', '점심', false) +
      mealBlock('dinner', '저녁', false) +
      mealBlock('snack', '간식', true) +
      '</div>' +

      '<div class="hsec">복약 · 영양제</div>' +
      '<div class="hgroup">' +
      togBlock('med_morning', '당뇨약 (아침)') +
      togBlock('med_evening', '당뇨약 (저녁)') +
      togBlock('supplement', '영양제') +
      '</div>';

    bindToday();
    setSaveState('saved');
  }

  function refreshChk(k) {
    var host = $('hToday'); if (!host) return;
    var item = host.querySelector('.hitem[data-k="' + k + '"]');
    if (item) { var c = item.querySelector('.hchk'); if (c) c.className = 'hchk' + (isSet(today[k]) ? ' on' : ''); }
    var n = $('hProgN'); if (n) n.textContent = recordedCount();
  }

  function bindToday() {
    var host = $('hToday'); if (!host) return;

    // 숫자 스텝퍼 + 직접 입력
    Array.prototype.forEach.call(host.querySelectorAll('.hnum'), function (row) {
      var k = row.getAttribute('data-k');
      var step = parseFloat(row.getAttribute('data-step')) || 1;
      var input = row.querySelector('.hval');
      function commit(save) {
        var raw = (input.value || '').trim();
        if (raw === '') { today[k] = null; }
        else {
          var num = parseFloat(raw); if (isNaN(num)) { today[k] = null; }
          else { today[k] = (k === 'fasting_glucose') ? Math.round(num) : Math.round(num * 10) / 10; }
        }
        input.value = isSet(today[k]) ? today[k] : '';
        refreshChk(k); if (save) scheduleSave();
      }
      Array.prototype.forEach.call(row.querySelectorAll('.hstepbtn'), function (b) {
        b.addEventListener('click', function () {
          var d = parseFloat(b.getAttribute('data-d')) || 1;
          var cur = isSet(today[k]) ? parseFloat(today[k]) : defaultFor(k);
          var nv = cur + d * step;
          if (nv < 0) nv = 0;
          today[k] = (k === 'fasting_glucose') ? Math.round(nv) : Math.round(nv * 10) / 10;
          input.value = today[k]; refreshChk(k); scheduleSave();
        });
      });
      input.addEventListener('change', function () { commit(true); });
      input.addEventListener('blur', function () { commit(true); });
    });

    // 식단 칩 + 직접입력
    Array.prototype.forEach.call(host.querySelectorAll('.hmeal'), function (block) {
      var k = block.getAttribute('data-k');
      Array.prototype.forEach.call(block.querySelectorAll('.hchip'), function (chip) {
        chip.addEventListener('click', function () {
          var food = chip.getAttribute('data-food');
          if (k === 'snack' && food === '없음') {
            // '없음'은 배타 선택
            var turningOn = !chip.classList.contains('on');
            Array.prototype.forEach.call(block.querySelectorAll('.hchip'), function (c) { c.classList.remove('on'); });
            if (turningOn) chip.classList.add('on');
          } else {
            var noneChip = block.querySelector('.hchip[data-food="없음"]');
            if (noneChip) noneChip.classList.remove('on');
            chip.classList.toggle('on');
            if (chip.classList.contains('on')) foodBump(food);
          }
          recombineMeal(block, k);
        });
      });
      var ci = block.querySelector('.hcustomin');
      if (ci) {
        ci.addEventListener('change', function () {
          mealTokens(ci.value).forEach(function (t) { foodBump(t); });
          recombineMeal(block, k);
        });
        ci.addEventListener('blur', function () { recombineMeal(block, k); });
      }
    });

    // 복약·영양제 원탭 토글 (null → 복용 → 미복용 → 복용 …)
    Array.prototype.forEach.call(host.querySelectorAll('.htogbtn'), function (btn) {
      var k = btn.getAttribute('data-k');
      btn.addEventListener('click', function () {
        var v = today[k];
        today[k] = (v === null || v === undefined) ? true : (v === true ? false : true);
        btn.className = 'htogbtn ' + togCls(today[k]);
        btn.textContent = togTxt(today[k]);
        refreshChk(k); scheduleSave();
      });
    });
  }
  function defaultFor(k) {
    if (k === 'fasting_glucose') return 100;   // 스텝 시작점(비어 있을 때)
    if (k === 'weight') return 70;
    if (k === 'sleep_hours') return 7;
    return 0;
  }
  function recombineMeal(block, k) {
    var chips = block.querySelectorAll('.hchip.on');
    var sel = [];
    Array.prototype.forEach.call(chips, function (c) { sel.push(c.getAttribute('data-food')); });
    var ci = block.querySelector('.hcustomin');
    if (ci) mealTokens(ci.value).forEach(function (t) { if (sel.indexOf(t) < 0) sel.push(t); });
    today[k] = sel.join(', ') || null;
    refreshChk(k); scheduleSave();
  }

  /* ============================ 기록 보기 ============================ */
  function renderHistory() {
    var host = $('hHistory'); if (!host) return;
    host.innerHTML = '<div class="empty-note">불러오는 중…</div>';
    var to = new Date(), from = new Date(); from.setDate(from.getDate() - 29);
    fetchRange(dstr(from), dstr(to)).then(function (rows) {
      rows = rows || [];
      if (!rows.length) { host.innerHTML = '<div class="empty-note">아직 기록이 없어요.<br>‘오늘 기록’에서 몇 가지만 눌러 보세요.</div>'; return; }
      // rows: 최신순. 그래프는 과거→현재(오름차순)로.
      var asc = rows.slice().sort(function (a, b) { return a.log_date < b.log_date ? -1 : 1; });
      var gluc = asc.filter(function (r) { return isSet(r.fasting_glucose); }).map(function (r) { return { d: r.log_date, v: +r.fasting_glucose }; });
      var wt = asc.filter(function (r) { return isSet(r.weight); }).map(function (r) { return { d: r.log_date, v: +r.weight }; });

      var html = '';
      html += chartCard('공복혈당', 'mg/dL', gluc, '#22D3EE', [70, 140]);
      html += chartCard('체중', 'kg', wt, '#8B5CF6', null, 4);   // 최소 y축 폭 4kg: 미세 변동이 절벽처럼 과장되지 않게
      html += '<div class="hsec">날짜별 기록</div><div class="list hlist">';
      rows.forEach(function (r) { html += dayRow(r); });
      html += '</div>';
      host.innerHTML = html;
    });
  }
  function dayRow(r) {
    var bits = [];
    if (isSet(r.fasting_glucose)) bits.push('<span class="hb glu">혈당 ' + esc(r.fasting_glucose) + '</span>');
    if (isSet(r.weight)) bits.push('<span class="hb wt">체중 ' + esc(r.weight) + '</span>');
    if (isSet(r.sleep_hours)) bits.push('<span class="hb">수면 ' + esc(r.sleep_hours) + 'h</span>');
    var med = [];
    if (r.med_morning === true) med.push('아침'); if (r.med_evening === true) med.push('저녁');
    if (med.length) bits.push('<span class="hb ok">약 ' + med.join('·') + '</span>');
    if (r.supplement === true) bits.push('<span class="hb ok">영양제</span>');
    var meals = [r.breakfast, r.lunch, r.dinner, r.snack].filter(function (m) { return isSet(m); });
    var mealLine = meals.length ? '<div class="hday-meal">' + esc(meals.join(' / ')) + '</div>' : '';
    return '<div class="card hday">' +
      '<div class="hday-top"><b>' + esc(fmtDayLabel(r.log_date)) + '</b></div>' +
      (bits.length ? '<div class="hbadges">' + bits.join('') + '</div>' : '<div class="hday-meal" style="color:var(--dim)">기록 일부만</div>') +
      mealLine + '</div>';
  }
  // 순수 SVG 라인 차트(외부 라이브러리 없음). pts: [{d,v}], fixRange: [min,max] 또는 null(자동).
  function chartCard(title, unit, pts, color, fixRange, minSpan) {
    var head = '<div class="hchart-h"><span>' + title + ' <small>' + unit + '</small></span>';
    if (!pts.length) return '<div class="card hchart">' + head + '</div><div class="hchart-empty">아직 ' + title + ' 기록이 없어요.</div></div>';
    var last = pts[pts.length - 1];
    head += '<b class="hchart-last">' + last.v + '<small> ' + unit + '</small></b></div>';
    var W = 320, H = 120, PADL = 34, PADR = 8, PADT = 12, PADB = 20;
    var vals = pts.map(function (p) { return p.v; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (fixRange) { mn = Math.min(mn, fixRange[0]); mx = Math.max(mx, fixRange[1]); }
    if (mn === mx) { mn -= 1; mx += 1; }
    // 최소 y축 폭 확보: 데이터 변동이 아주 작아도 절벽처럼 과장돼 보이지 않게(2026-09-20)
    if (minSpan && (mx - mn) < minSpan) { var mid = (mn + mx) / 2; mn = mid - minSpan / 2; mx = mid + minSpan / 2; }
    var pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    var n = pts.length;
    function X(i) { return PADL + (n === 1 ? (W - PADL - PADR) / 2 : (i * (W - PADL - PADR) / (n - 1))); }
    function Y(v) { return PADT + (mx - v) / (mx - mn) * (H - PADT - PADB); }
    var d = '', dots = '';
    pts.forEach(function (p, i) {
      d += (i === 0 ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
      dots += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    });
    // y축 눈금 2개(최소/최대 근사)
    var yTop = Math.round(mx), yBot = Math.round(mn);
    var grid =
      '<line x1="' + PADL + '" y1="' + PADT + '" x2="' + (W - PADR) + '" y2="' + PADT + '" class="hgrid"/>' +
      '<line x1="' + PADL + '" y1="' + (H - PADB) + '" x2="' + (W - PADR) + '" y2="' + (H - PADB) + '" class="hgrid"/>' +
      '<text x="4" y="' + (PADT + 4) + '" class="hax">' + yTop + '</text>' +
      '<text x="4" y="' + (H - PADB + 4) + '" class="hax">' + yBot + '</text>';
    var area = 'M' + X(0).toFixed(1) + ' ' + (H - PADB) + ' ' +
      pts.map(function (p, i) { return 'L' + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ') +
      ' L' + X(n - 1).toFixed(1) + ' ' + (H - PADB) + ' Z';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="hsvg" preserveAspectRatio="none">' +
      grid +
      '<path d="' + area + '" fill="' + color + '" opacity="0.10"/>' +
      '<path d="' + d.trim() + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + '</svg>';
    return '<div class="card hchart">' + head + svg +
      '<div class="hchart-foot">최근 ' + n + '일 · ' + fmtDayLabel(pts[0].d).replace(/ · .*/, '') + ' → ' + fmtDayLabel(last.d).replace(/ · .*/, '') + '</div></div>';
  }

  /* ============================ 탭 전환 / 진입 ============================ */
  function switchTab(which) {
    var tT = $('hTabToday'), tH = $('hTabHistory'), pT = $('hToday'), pH = $('hHistory');
    if (which === 'history') {
      tH && tH.classList.add('on'); tT && tT.classList.remove('on');
      if (pT) pT.style.display = 'none'; if (pH) pH.style.display = '';
      renderHistory();
    } else {
      tT && tT.classList.add('on'); tH && tH.classList.remove('on');
      if (pH) pH.style.display = 'none'; if (pT) pT.style.display = '';
    }
  }

  function init(opts) {
    if (opts && opts.toast) _toast = opts.toast;
    if (inited) return;
    inited = true;
    if ($('hTabToday')) $('hTabToday').addEventListener('click', function () { switchTab('today'); });
    if ($('hTabHistory')) $('hTabHistory').addEventListener('click', function () { switchTab('history'); });
  }

  // 화면이 열릴 때 호출: 캐시로 즉시 렌더 → 서버값으로 보정
  function open() {
    var ds = todayStr();
    var cached = cacheGet(ds);
    today = cached && cached.log_date === ds ? cached : blankRecord(ds);
    // 필드 보정(옛 캐시 호환)
    FIELDS.forEach(function (k) { if (!(k in today)) today[k] = null; });
    switchTab('today');
    renderToday();
    // 서버 최신값으로 보정(다른 기기/문진 반영). 편집 중 충돌 최소화 위해 열자마자 1회.
    fetchOne(ds).then(function (row) {
      if (!row) return;
      var changed = false;
      FIELDS.forEach(function (k) {
        var sv = isSet(row[k]) ? row[k] : null;
        if (sv !== null && !isSet(today[k])) { today[k] = sv; changed = true; }   // 비어있던 칸만 서버값으로 채움(내가 방금 넣은 값 보호)
      });
      if (changed) { cachePut(); renderToday(); }
    }).catch(function () {});
  }

  global.HealthTab = { init: init, open: open };
})(window);
