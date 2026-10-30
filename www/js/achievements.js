/* ============================================================================
 * achievements.js — 「실적」 탭 (v9.59, O-0684)  교수님의 논문·학위논문 기록을 모아 보고 찾는 화면
 * ----------------------------------------------------------------------------
 * 화면: 요약(첫 화면) · 논문 목록(역할 칩·걸러내기·정렬) · 학위논문 목록 · 상세 · 추가/고치기 · 휴지통 · ⚙ 설정(내 이름 표기·내보내기·종류 관리·스위치 2개)
 * 저장: 스마트비서 서버(Supabase)의 ach_cats / ach_items 표. 표 직접 접근은 막혀 있고 ach_* 함수(RPC)로만 읽고 쓴다 —
 *       건강 탭과 같은 「연동 암호」(localStorage smart_sync_pass)를 모든 호출에 붙인다.
 *       오류는 구분한다: 암호 틀림(BAD_PASSCODE/28000만) · 서버 표 없음(404) · 서버 오류 · 인터넷 끊김. HTTP 400 을 전부 「암호 틀림」으로 읽지 않는다.
 * 규칙: · 제1저자/공저는 사람이 고르지 않는다 — 순번·총 저자수·공동제1·교신 네 칸에서 derive() 가 계산한다(역할 칸을 따로 저장하지 않음).
 *       · 큰 숫자는 「게재 N편」(published 만). 게재확정·심사중·작성중·원고본·상태 미입력은 작은 글씨.
 *       · 못 불러왔으면 「0편」이 아니라 「불러오지 못했어요」(오프라인 사본이 있으면 읽기 전용으로).
 *       · 저장은 서버 응답 {ok:true} 를 받은 뒤에만 「저장했어요」. 입력 내용은 실패해도 지우지 않는다.
 *       · 고칠 때 화면이 모르는 data 칸을 지우지 않는다 — buildSaveRow(기준 행 ⊕ 화면이 아는 칸).
 *       · 삭제는 휴지통(8초 되돌리기). 영구 삭제는 휴지통 안에서 한 번 더 눌러야 한다.
 * 스위치: app.js 의 ACHIEVE_TAB ('on' | 'off') — 'off' 면 홈 칸이 보이지 않아 v9.58 과 같다.
 * app.js 연결: AchTab.init({toast}) · AchTab.open() · AchTab.back() (goBack 이 먼저 물어본다).
 * 시험: AchPure(순수 함수 묶음 — derive·summarize·findDup·isMe·buildSaveRow·makeRpc …)는 화면 없이 시험할 수 있게 밖으로 내놓았다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 순수 함수 (화면·서버와 무관)
   * ===================================================================*/
  var STATUS_LABEL = { published: '게재', accepted: '게재확정', under_review: '심사중', in_prep: '작성중', manuscript: '원고본 (게재 불명)' };
  var STATUS_ORDER = ['published', 'accepted', 'under_review', 'in_prep', 'manuscript'];
  var GRADES = ['SCI급', '그 밖의 국제학술지', '한국연구재단 등재', '등재후보', '기타 국내', '교내'];
  var BN = { pure: '제1저자', cofirst: '공동제1', corr: '교신', both: '제1+교신', co: '공저', none: '역할 미입력' };
  var IN_HOUSE_RE = /산업기술연구소\s*논문집|교수학습\s*연구지/;
  /* 화면이 아는 data 칸 — 저장할 때 이 칸만 화면 값으로 바꾸고 나머지(가져올 때 남긴 출처 메모·앞으로 생길 칸)는 건드리지 않는다 */
  var KNOWN_DATA = ['author_pos', 'author_total', 'co_first', 'corresponding', 'in_house', 'volume', 'issue', 'pages', 'article_no', 'doi', 'journal_grade'];
  /* 교수님 본인 이름을 찾는 기본 규칙(7-4절): 한글 이름(글자 사이 띄움 허용) · 영문은 성(Kwak)과 이름 쪽(Ho Seok / Hoseok / H.S. / HS)이 함께 있을 때만.
   *   성(Kwak)만으로는 찾지 않는다. 더 필요한 표기는 ⚙ 「내 이름 표기」에서 더한다(폰에 저장). */
  var ME_KO = '곽호석';
  var ME_GIVEN = ['hoseok', 'hs'];

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function dataOf(x) { return x && isObj(x.data) ? x.data : {}; }
  function toInt(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isPub(x) { return x && x.status === 'published'; }
  function inHouse(x) { return dataOf(x).in_house === true; }

  /* 역할 자동 계산 (설계안 5-3절) — o.cofirst: 「공동 제1저자를 제1저자로 세기」 (기본 켬) */
  function derive(x, o) {
    var d = dataOf(x), pos = toInt(d.author_pos), cof = !(o && o.cofirst === false);
    if (pos == null) return { b: 'none', text: '', resp: false, first: false, corr: false, co: false };
    var co = d.co_first === true, corr = d.corresponding === true;
    var first = (pos === 1 && !co) || (co && cof);
    var b = !first && !corr ? 'co' : (first && corr ? 'both' : (first && co ? 'cofirst' : (first ? 'pure' : 'corr')));
    var parts = [];
    if (first) parts.push(co ? '공동제1' : '제1저자');
    if (corr) parts.push('교신');
    var text = parts.join('+');
    if (!text) text = co ? '공동제1(세지 않음)' : '공저';
    return { b: b, text: text, resp: first || corr, first: first, corr: corr, co: co };
  }
  function inReq(x, o) { return derive(x, o).resp && isPub(x) && ((o && o.inhouseReq === true) || !inHouse(x)); }

  function countBuckets(list, o) {
    var bk = { pure: 0, cofirst: 0, corr: 0, both: 0, co: 0, none: 0 };
    list.forEach(function (x) { bk[derive(x, o).b]++; });
    bk.resp = bk.pure + bk.cofirst + bk.corr + bk.both;
    return bk;
  }
  /* 요약 숫자 — papers = 휴지통 아닌 논문 전부 */
  function summarize(papers, o) {
    var pub = papers.filter(isPub), st = { accepted: 0, under_review: 0, in_prep: 0, manuscript: 0, none: 0 };
    papers.forEach(function (x) { if (!isPub(x)) st[Object.prototype.hasOwnProperty.call(st, x.status) && x.status ? x.status : 'none']++; });
    var bk = countBuckets(pub, o), ext = pub.filter(function (x) { return !inHouse(x); });
    return {
      total: papers.length, pub: pub.length, st: st, bk: bk, respAll: bk.resp,
      req: papers.filter(function (x) { return inReq(x, o); }).length,
      gradeDone: ext.filter(function (x) { return String(dataOf(x).journal_grade || '').trim(); }).length, gradeOf: ext.length,
      inhouse: papers.filter(inHouse).length
    };
  }
  /* 연도별 막대 — 게재 논문, 데이터에서 계산한 최근 12년 + 「이전」 「연도 없음」 */
  function yearBars(pub, maxYearHint) {
    var ys = pub.map(function (x) { return toInt(x.year); }).filter(Boolean);
    if (!ys.length) return null;
    var max = Math.max.apply(null, ys.concat([maxYearHint || 0])), min = Math.max(Math.min.apply(null, ys), max - 11), m = {}, older = 0, y;
    pub.forEach(function (x) { var yy = toInt(x.year); if (!yy) return; if (yy < min) older++; else m[yy] = (m[yy] || 0) + 1; });
    var peak = 1, years = [];
    for (y = min; y <= max; y++) { peak = Math.max(peak, m[y] || 0); years.push({ y: y, n: m[y] || 0 }); }
    return { min: min, max: max, years: years, peak: peak, older: older, nil: pub.length - ys.length };
  }

  /* 검색 — 띄어쓰기로 나눈 낱말이 모두 들어 있어야 한다(제목·저자·학술지·연도·DOI) */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^0-9a-z가-힣]/g, ''); }
  function hayOf(x) {
    var d = dataOf(x), names = Array.isArray(x.people) ? x.people.map(function (p) { return p && p.name; }).join(' ') : '';
    return norm([x.title, names, x.venue, x.year, d.doi].join(' '));
  }
  function matchItem(x, q) {
    var terms = String(q || '').toLowerCase().split(/\s+/).map(norm).filter(Boolean);
    if (!terms.length) return true;
    var h = hayOf(x);
    return terms.every(function (t) { return h.indexOf(t) >= 0; });
  }

  /* 중복 판정 (5-9절) — 같은 DOI 이거나 비슷한 제목(두 글자 조각 겹침 85% 이상, 6글자 이하는 비교 안 함). 휴지통 속 항목도 본다 */
  function grams(s) { var a = {}, n = norm(s); for (var i = 0; i < n.length - 1; i++) a[n.substr(i, 2)] = 1; return a; }
  function sim(a, b) {
    var A = grams(a), B = grams(b), i = 0, u = 0, k;
    for (k in A) { u++; if (B[k]) i++; }
    for (k in B) if (!A[k]) u++;
    return u ? i / u : 0;
  }
  function cleanDoi(s) { return String(s || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, ''); }
  function findDup(all, title, doi, selfId, kindId) {
    var d = norm(cleanDoi(doi)), t = String(title || '').trim();
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      if (!x || x.id === selfId || (kindId && x.kind_id !== kindId)) continue;
      if (d && norm(cleanDoi(dataOf(x).doi)) === d) return { x: x, why: '같은 DOI' };
      if (norm(t).length > 6 && sim(t, x.title) >= 0.85) return { x: x, why: '비슷한 제목' };
    }
    return null;
  }

  /* 저자 칸 · 내 이름 찾기 */
  function parseAuthors(text) { return String(text || '').split(/[,，;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function nameKey(s) { return String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, ''); }
  function isMe(name, aliases) {
    var s = String(name || '');
    if (!s) return false;
    if (s.replace(/\s+/g, '').indexOf(ME_KO) >= 0) return true;
    var toks = s.toLowerCase().split(/[^a-z]+/).filter(Boolean), ki = toks.indexOf('kwak');
    if (ki >= 0) {
      var rest = toks.filter(function (t, i) { return i !== ki; }).join('');
      if (ME_GIVEN.indexOf(rest) >= 0) return true;
    }
    var k = nameKey(s);
    if (k && aliases) for (var i = 0; i < aliases.length; i++) if (nameKey(aliases[i]) === k) return true;
    return false;
  }
  function findMe(names, aliases) {
    for (var i = 0; i < names.length; i++) if (isMe(names[i], aliases)) return i + 1;
    return 0;
  }

  /* 저장 행 만들기 (5-8절 ①) — 기준 행(서버에서 받은 전체)에 화면이 아는 칸의 값만 덮는다.
   *   v 의 각 칸은 undefined 면 「건드리지 않음」, null/빈 값이면 「비움」. data 는 화면이 아는 칸(KNOWN_DATA)만 바꾸고, 모르는 칸은 기준 행 그대로 실어 보낸다. */
  var GENERAL = ['title', 'year', 'item_date', 'status', 'venue', 'note', 'cat_id', 'verified', 'people'];
  function blankToNull(v) { return v === undefined ? undefined : (v === null || v === '' ? null : v); }
  function buildSaveRow(base, v) {
    var row = {}, i, k;
    if (base) { row.id = base.id; row.base_rev = base.rev; row.kind_id = base.kind_id; }
    else { row.id = v.id; row.kind_id = v.kind_id; }
    for (i = 0; i < GENERAL.length; i++) {
      k = GENERAL[i];
      if (v[k] === undefined) continue;
      row[k] = (k === 'people' || k === 'verified') ? v[k] : blankToNull(v[k]);
    }
    var data = base && isObj(base.data) ? clone(base.data) : {}, vd = v.data || {};
    for (i = 0; i < KNOWN_DATA.length; i++) {
      k = KNOWN_DATA[i];
      if (vd[k] === undefined) continue;
      var val = blankToNull(vd[k]);
      if (val === null) { if (Object.prototype.hasOwnProperty.call(data, k)) data[k] = null; }   // 비운 칸만 null(서버가 지움)
      else data[k] = val;
    }
    row.data = data;
    return row;
  }
  /* 서버가 하는 합치기와 같은 방식으로 폰의 사본을 갱신(저장 직후 화면에 바로 반영) */
  function applyRowToItem(base, row, rev, nowIso) {
    var it = base ? clone(base) : { id: row.id, kind_id: row.kind_id, cat_id: null, title: '', year: null, item_date: null, status: null, venue: null, people: [], data: {}, note: null, src_path: null, has_source: false, verified: false, ext_key: null, rev: 1, deleted_at: null, created_at: nowIso };
    GENERAL.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(row, k)) it[k] = row[k]; });
    var data = isObj(it.data) ? it.data : {}, rd = isObj(row.data) ? row.data : {};
    Object.keys(rd).forEach(function (k) { if (rd[k] === null) delete data[k]; else data[k] = rd[k]; });
    it.data = data; it.rev = rev; it.updated_at = nowIso;
    return it;
  }

  /* 서버 오류 구분 (4절) — 암호 틀림은 응답 본문에 BAD_PASSCODE 또는 코드 28000 이 있을 때만 */
  function classifyHttp(status, text) {
    var t = String(text || '');
    if (/BAD_PASSCODE/.test(t) || /"code"\s*:\s*"28000"/.test(t)) return 'badpass';
    if (status === 404 || /PGRST202/.test(t) || /Could not find the function/i.test(t)) return 'notready';
    return 'server';
  }
  /* 서버 호출 만들기 — 시험에서는 가짜 fetch·가짜 설정을 끼워 넣는다 */
  function makeRpc(dep) {
    return function rpc(name, body) {
      var c = dep.cfg();
      if (!c) return Promise.reject(mkErr('NO_CONFIG', 'server'));
      var pass = dep.pass();
      if (!pass) { dep.needPass('실적을 저장·조회하려면 PC 연동 암호를 입력해 주세요.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
      body = body || {}; body.p_pass = pass;
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, dep.timeout || 20000) : null;
      var f = dep.fetch || global.fetch;
      return f(c.url + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (tm) clearTimeout(tm);
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var kind = classifyHttp(r.status, t), e = mkErr(kind === 'badpass' ? 'BAD_PASSCODE' : (kind === 'notready' ? 'NOT_READY' : 'HTTP_' + r.status), kind);
          if (kind === 'badpass') dep.needPass('연동 암호가 맞지 않아 실적을 저장·조회하지 못했습니다. 다시 입력해 주세요.');
          throw e;
        });
      }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });   // 인터넷 끊김·시간 초과
    };
  }
  function mkErr(msg, kind) { var e = new Error(msg); e.ach = true; e.kind = kind; return e; }

  function sortItems(list, key) {
    var l = list.slice();
    l.sort(function (a, b) {
      if (key === 'upd') return String(b.updated_at || '') < String(a.updated_at || '') ? -1 : 1;
      var ya = toInt(a.year), yb = toInt(b.year);
      if (key === 'old') { if (ya !== yb) return (ya || 9999) - (yb || 9999); }
      else if (ya !== yb) return (yb || 0) - (ya || 0);
      return String(b.updated_at || '') < String(a.updated_at || '') ? -1 : 1;
    });
    return l;
  }
  function rolePasses(x, st, o) {          // 목록 걸러내기 (논문)
    var d = derive(x, o);
    if (st.role === 'resp' && !d.resp) return false;
    if (st.role === 'resp' && st.sub !== 'all' && d.b !== st.sub) return false;
    if (st.role === 'co' && d.b !== 'co') return false;
    if (st.role === 'none' && d.b !== 'none') return false;
    if (st.fInh && !inHouse(x)) return false;
    if (st.fWait && isPub(x)) return false;
    return true;
  }

  global.AchPure = {
    derive: derive, inReq: inReq, countBuckets: countBuckets, summarize: summarize, yearBars: yearBars, norm: norm, matchItem: matchItem,
    sim: sim, findDup: findDup, cleanDoi: cleanDoi, parseAuthors: parseAuthors, isMe: isMe, findMe: findMe, buildSaveRow: buildSaveRow,
    applyRowToItem: applyRowToItem, classifyHttp: classifyHttp, makeRpc: makeRpc, sortItems: sortItems, rolePasses: rolePasses,
    KNOWN_DATA: KNOWN_DATA, GRADES: GRADES
  };

  if (typeof document === 'undefined') return;   // 시험(node)에서는 화면 부분을 만들지 않는다

  /* =====================================================================
   * 2. 상태 · 저장소(폰)
   * ===================================================================*/
  var SKEY = 'smart_ach_settings_v1', CKEY = 'smart_ach_cache_v1';
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    loaded: false, loading: null, err: null, offline: false, stale: false, cachedAt: null,
    cats: [], items: [], settings: loadSettings(),
    tab: 'sum', role: 'all', sub: 'all', fInh: false, fWait: false, fCat: 'all', sortKey: 'new', q: '',
    sheet: false, sheetBack: null, noScrim: false, lastLoadAt: 0
  };
  var _toast = function () {}, toastTimer = null, E = null, built = false;

  function loadSettings() {
    var s = { cofirst: true, inhouseReq: false, names: [] };
    try { var r = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (isObj(r)) { if (r.cofirst === false) s.cofirst = false; if (r.inhouseReq === true) s.inhouseReq = true; if (Array.isArray(r.names)) s.names = r.names.filter(function (n) { return typeof n === 'string' && n.trim(); }); } } catch (e) {}
    return s;
  }
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S.settings)); } catch (e) {} }
  function saveCache(d) { try { localStorage.setItem(CKEY, JSON.stringify({ at: Date.now(), cats: d.cats, items: d.items })); } catch (e) {} }
  function readCache() { try { var c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (c && Array.isArray(c.cats) && Array.isArray(c.items)) return c; } catch (e) {} return null; }
  function opts() { return { cofirst: S.settings.cofirst, inhouseReq: S.settings.inhouseReq }; }
  function cfg() { return (global.OfficeBridge && global.OfficeBridge.CONFIG) || null; }
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function needPass(msg) { try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {} }
  var rpc = makeRpc({ cfg: cfg, pass: syncPass, needPass: needPass, fetch: function () { return global.fetch.apply(global, arguments); } });
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function uuid() {
    try { if (global.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function nowIso() { return new Date().toISOString(); }
  function fmtDay(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }

  /* ---------- 자료 보기 도우미 ---------- */
  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0) || String(a.created_at || '') .localeCompare(String(b.created_at || '')); }
  function kindsList() { return S.cats.filter(function (c) { return !c.parent_id && !c.deleted_at; }).sort(bySort); }
  function subCats(kid) { return S.cats.filter(function (c) { return c.parent_id === kid && !c.deleted_at; }).sort(bySort); }
  function catById(id) { for (var i = 0; i < S.cats.length; i++) if (S.cats[i].id === id) return S.cats[i]; return null; }
  function live() { return S.items.filter(function (x) { return !x.deleted_at; }); }
  function trashed() { return S.items.filter(function (x) { return !!x.deleted_at; }); }
  function ofKind(kid) { return live().filter(function (x) { return x.kind_id === kid; }); }
  function itemById(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function isPaperKind(k) { return !!k && k.kind_type === 'paper'; }
  function kindUnit(k) { return isPaperKind(k) ? '편' : '건'; }
  function peopleNames(x) { return Array.isArray(x.people) ? x.people.map(function (p) { return p && p.name ? String(p.name) : ''; }).filter(Boolean) : []; }
  function view() { return $('achBody'); }
  function shown() { var v = $('achView'); return !!v && v.style.display !== 'none'; }

  /* =====================================================================
   * 3. 불러오기
   * ===================================================================*/
  function load(quiet) {
    if (S.loading) return S.loading;
    var p = rpc('ach_list', {}).then(function (d) {
      if (!isObj(d) || !Array.isArray(d.cats) || !Array.isArray(d.items)) throw mkErr('BAD_SHAPE', 'server');
      S.cats = d.cats; S.items = d.items; S.loaded = true; S.offline = false; S.stale = false; S.err = null; S.lastLoadAt = Date.now();
      saveCache(d);
    }).catch(function (e) {
      S.err = e;
      if (S.loaded && !S.offline) { S.stale = true; }                       // 한 번 잘 불러온 뒤의 새로고침 실패 — 가진 내용은 그대로, 안내만
      else if (!S.loaded) {
        var c = readCache();
        if (c) { S.cats = c.cats; S.items = c.items; S.loaded = true; S.offline = true; S.cachedAt = c.at; }
      }
    }).then(function () { S.loading = null; renderAll(); });
    S.loading = p;
    if (!quiet && !S.loaded) { S.err = null; renderAll(); }          // 「불러오는 중이에요…」
    return p;
  }
  function errText(e) {
    if (!e) return '';
    if (e.kind === 'badpass') return '연동 암호가 맞지 않아요. 암호를 다시 입력해 주세요.';
    if (e.kind === 'notready') return '서버에 실적 표가 아직 준비되지 않았어요.';
    if (e.kind === 'net') return '인터넷에 연결되지 않았어요.';
    return '서버가 응답하지 않았어요. 잠시 뒤 다시 시도해 주세요.';
  }

  /* =====================================================================
   * 4. 화면 그리기
   * ===================================================================*/
  function build() {
    if (built) return; built = true;
    var b = view(); if (!b) return;
    b.innerHTML = '<div class="ach-search" id="achSearch"><span aria-hidden="true">🔍</span><input id="achQ" type="search" enterkeyhint="search" autocomplete="off" placeholder="제목·저자·학술지·연도로 찾기"><button type="button" class="ach-x" id="achQx" aria-label="검색어 지우기">✕</button></div>' +
      '<div class="ach-tabs" id="achTabs" role="tablist"></div><div id="achMain"></div>';
    var layer = document.createElement('div');
    layer.id = 'achLayer';
    layer.innerHTML = '<div class="ach-fab" id="achFab"><button type="button" class="ach-btn" data-act="add" id="achAdd"></button></div>' +
      '<div class="ach-sheet" id="achSheet"><div class="ach-box" id="achBox" role="dialog" aria-modal="true"></div></div><div class="ach-toast" id="achToast" role="status" aria-live="polite"></div>';
    document.body.appendChild(layer);
    var q = $('achQ'), tmr = null;
    q.addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(function () { S.q = q.value.trim(); $('achSearch').classList.toggle('has', !!q.value); renderMain(); updateFab(); }, 120); });
    $('achQx').addEventListener('click', function () { q.value = ''; S.q = ''; $('achSearch').classList.remove('has'); renderMain(); updateFab(); q.focus(); });
    $('achView').addEventListener('click', onClick);
    layer.addEventListener('click', onClick);
    $('achSheet').addEventListener('click', function (e) { if (e.target === this && !S.noScrim) sheetBackOrClose(); });
    var gear = $('achGear'); if (gear) gear.addEventListener('click', openSettings);
    // 화면이 다른 길(알림·홈 단추)로 닫히면 열려 있던 창·추가 단추도 함께 치운다
    try { new MutationObserver(function () { if (!shown()) { hideSheetNow(); updateFab(); } }).observe($('achView'), { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
    document.addEventListener('visibilitychange', function () { if (!document.hidden && shown() && Date.now() - S.lastLoadAt > 20000 && !S.sheet) load(true); });
  }
  function renderAll() { if (!built) return; renderTabs(); renderMain(); updateFab(); }

  function renderTabs() {
    var ks = kindsList(), h = '<button type="button" class="ach-tab' + (S.tab === 'sum' ? ' on' : '') + '" data-act="tab" data-t="sum" role="tab">요약</button>';
    ks.forEach(function (k) { h += '<button type="button" class="ach-tab' + (S.tab === k.id ? ' on' : '') + '" data-act="tab" data-t="' + esc(k.id) + '" role="tab">' + esc(k.name) + (S.loaded ? ' ' + ofKind(k.id).length : '') + '</button>'; });
    $('achTabs').innerHTML = h;
  }
  function banner() {
    var h = '';
    if (S.offline) h += '<div class="ach-banner"><span>오프라인 사본 · ' + (S.cachedAt ? fmtDay(S.cachedAt) + ' 기준' : '이전에 불러온 내용') + ' — 지금은 읽기만 돼요. ' + esc(errText(S.err)) + '</span><button type="button" data-act="reload">다시 불러오기</button></div>';
    else if (S.stale) h += '<div class="ach-banner"><span>새로 불러오지 못해서 마지막으로 불러온 내용이에요. ' + esc(errText(S.err)) + '</span><button type="button" data-act="reload">다시 불러오기</button></div>';
    return h;
  }
  function renderMain() {
    var m = $('achMain'); if (!m) return;
    if (!S.loaded) {
      if (S.loading) { m.innerHTML = '<div class="ach-empty">불러오는 중이에요…</div>'; return; }
      m.innerHTML = '<div class="ach-empty"><b>불러오지 못했어요</b>' + esc(errText(S.err) || '') + '<br><span class="ach-note">저장된 기록은 그대로예요. 숫자를 0으로 보여 드리지 않아요.</span><button type="button" class="ach-btn" data-act="reload">다시 시도</button></div>';
      return;
    }
    var h = banner();
    if (S.q) h += searchHtml();
    else if (S.tab === 'sum') h += summaryHtml();
    else { var k = catById(S.tab); h += k && !k.parent_id && !k.deleted_at ? listHtml(k) : summaryHtml(); if (!k || k.parent_id || k.deleted_at) S.tab = 'sum'; }
    m.innerHTML = h;
    afterRender(m);
  }
  function afterRender(m) {
    var vw = $('achView'), cm = calm();
    vw.classList.toggle('ach-calm', cm); $('achLayer').classList.toggle('ach-calm', cm);
    var ns = m.querySelectorAll('[data-n]'), i;
    for (i = 0; i < ns.length; i++) {
      if (cm) { ns[i].textContent = ns[i].getAttribute('data-n'); continue; }
      (function (el) { var n = +el.getAttribute('data-n'), s = performance.now(); (function f(t) { var p = Math.min(1, (t - s) / 450); el.textContent = Math.round(n * p); if (p < 1) requestAnimationFrame(f); })(s); })(ns[i]);
    }
    var bs = m.querySelectorAll('.ach-bar i');
    for (i = 0; i < bs.length; i++) {
      if (cm) { bs[i].style.height = bs[i].getAttribute('data-h') + 'px'; continue; }
      (function (el, d) { setTimeout(function () { el.style.height = el.getAttribute('data-h') + 'px'; }, 30 + d * 25); })(bs[i], i);
    }
  }

  /* ----- 요약 ----- */
  function summaryHtml() {
    var h = '', ks = kindsList(), o = opts(), any = false;
    ks.forEach(function (k) {
      var list = ofKind(k.id);
      if (isPaperKind(k)) {
        any = true;
        var sm = summarize(list, o), parts = [];
        if (sm.st.accepted) parts.push('게재확정 ' + sm.st.accepted);
        if (sm.st.under_review) parts.push('심사중 ' + sm.st.under_review);
        if (sm.st.in_prep) parts.push('작성중 ' + sm.st.in_prep);
        if (sm.st.none) parts.push('상태 미입력 ' + sm.st.none);
        var small = (parts.length ? parts.join(' · ') + (sm.st.manuscript ? ' · ' : '') : '') + (sm.st.manuscript ? '<b>원고본 ' + sm.st.manuscript + '</b> (게재 불명)' : '');
        h += '<div class="ach-card click" data-act="tab" data-t="' + esc(k.id) + '"><div class="ach-big"><span class="n" data-n="' + sm.pub + '">' + sm.pub + '</span><span class="u">편</span><span class="l">' + esc(k.name) + ' · 게재</span></div>' +
          '<div class="ach-small">전체 ' + sm.total + '편 중 게재된 것만 큰 숫자로 셉니다' + (small ? '<br>' + small : '') + '</div></div>';
        if (sm.pub) {
          h += '<div class="ach-card"><div class="ach-big"><span class="n s" data-n="' + sm.respAll + '">' + sm.respAll + '</span><span class="u">편</span><span class="l">책임저자 (게재 기준)</span></div>' +
            '<div class="ach-split"><span>제1저자 ' + sm.bk.pure + '</span><span>공동제1 ' + sm.bk.cofirst + '</span><span>교신 ' + sm.bk.corr + '</span><span>겸임 ' + sm.bk.both + '</span><span class="dim">공저 ' + sm.bk.co + '</span>' + (sm.bk.none ? '<span class="dim">역할 미입력 ' + sm.bk.none + '</span>' : '') + '</div>' +
            '<div class="ach-pair"><div><div class="n2">' + sm.respAll + '</div><div class="t2">전체 (교내 논문집 포함)</div></div><div><div class="n2">' + sm.req + '</div><div class="t2">승진 요건용 (' + (o.inhouseReq ? '교외·교내' : '교외') + '만)</div></div></div>' +
            '<div class="ach-small">규정 판정이 아닌 참고 숫자예요. 승진 요건용은 등재·SCI급 등급이 확인돼야 정확해져요. 지금은 등급 입력 ' + sm.gradeDone + '/' + sm.gradeOf + '건이라 「교외·게재」 기준 근사값입니다.</div></div>';
        }
      } else {
        any = true;
        var cs = subCats(k.id), split = cs.map(function (c) { return esc(c.name) + ' ' + list.filter(function (x) { return x.cat_id === c.id; }).length; }).join(' · ');
        h += '<div class="ach-card click" data-act="tab" data-t="' + esc(k.id) + '"><div class="ach-big"><span class="n s" data-n="' + list.length + '">' + list.length + '</span><span class="u">' + kindUnit(k) + '</span><span class="l">' + esc(k.name) + '</span></div>' +
          '<div class="ach-small">' + (split ? split + ' · ' : '') + '학술지 논문 숫자에 섞이지 않아요</div></div>';
      }
    });
    if (!any) return h + '<div class="ach-empty"><b>아직 종류가 없어요</b>서버의 실적 종류가 비어 있어요. ⚙ 설정에서 종류를 만들 수 있어요.</div>';
    var paperKind = ks.filter(isPaperKind)[0];
    if (paperKind) {
      var pubs = ofKind(paperKind.id).filter(isPub), yb = yearBars(pubs, new Date().getFullYear());
      if (yb) {
        h += '<div class="ach-h3">연도별 게재 논문 <em>' + yb.min + '~' + yb.max + (yb.older ? ' · 이전 ' + yb.older + '편' : '') + (yb.nil ? ' · 연도 없음 ' + yb.nil + '편' : '') + '</em></div><div class="ach-bars">';
        yb.years.forEach(function (y) { h += '<div class="ach-bar"><em>' + (y.n || '') + '</em><i data-h="' + Math.round(y.n / yb.peak * 78) + '"></i>' + String(y.y).slice(2) + '</div>'; });
        h += '</div>';
      }
    }
    var rec = live().slice().sort(function (a, b) { return String(b.updated_at || '') < String(a.updated_at || '') ? -1 : 1; }).slice(0, 3);
    if (rec.length) h += '<div class="ach-h3">최근 변경 <em>추가·고친 순</em></div>' + rec.map(function (x) { return rowHtml(x, (x.rev || 1) > 1 ? '고침' : '추가', false); }).join('');
    else h += '<div class="ach-empty"><b>아직 기록이 없어요</b>아래 탭에서 논문을 추가해 보세요.</div>';
    return h;
  }

  /* ----- 목록 ----- */
  function tagsHtml(x) {
    var k = catById(x.kind_id), h = '';
    if (isPaperKind(k)) {
      var d = derive(x, opts()), dd = dataOf(x);
      if (d.text) h += '<span class="ach-tag' + (d.co ? ' co' : '') + '">' + esc(d.text) + (toInt(dd.author_pos) ? ' ' + toInt(dd.author_pos) + (toInt(dd.author_total) ? '/' + toInt(dd.author_total) : '') : '') + '</span>';
      if (inHouse(x)) h += '<span class="ach-tag in">교내</span>';
      if (x.status === 'manuscript') h += '<span class="ach-tag wait">원고본·게재 불명</span>';
      else if (x.status && x.status !== 'published') h += '<span class="ach-tag wait">' + esc(STATUS_LABEL[x.status] || x.status) + '</span>';
      else if (!x.status) h += '<span class="ach-tag wait">상태 미입력</span>';
    } else if (x.cat_id) { var c = catById(x.cat_id); if (c) h += '<span class="ach-tag">' + esc(c.name) + '</span>'; }
    return h;
  }
  function rowHtml(x, mark, showKind) {
    var unc = dataOf(x).uncertain === true, dot = x.verified ? '' : '<span class="ach-dot' + (unc ? ' warn' : '') + '" title="' + (unc ? '확인 필요' : '확인 전') + '"></span>', k = catById(x.kind_id);
    return '<button type="button" class="ach-row" data-act="open" data-id="' + esc(x.id) + '"><div class="a">' + esc(x.title) + '</div><div class="b">' +
      (mark ? '<span class="ach-tag gray">' + mark + '</span>' : '') + (showKind && k ? '<span class="ach-tag gray">' + esc(k.name) + '</span>' : '') + tagsHtml(x) + esc(x.venue || '') + (x.venue ? ' · ' : '') + (toInt(x.year) || '연도 없음') + dot + '</div></button>';
  }
  function searchHtml() {
    var res = sortItems(live().filter(function (x) { return matchItem(x, S.q); }), S.sortKey);
    return '<div class="ach-sortline"><span>검색 결과 ' + res.length + '건</span><span></span></div>' + (res.map(function (x) { return rowHtml(x, '', kindsList().length > 1); }).join('') || '<div class="ach-empty"><b>찾는 기록이 없어요</b>다른 낱말로 찾아 보세요.</div>');
  }
  function chipsHtml(k, list) {
    var o = opts(), bk = countBuckets(list, o), tot = list.length, h = '';
    if (isPaperKind(k)) {
      var ok1 = (bk.resp + bk.co + bk.none === tot), ok2 = (bk.pure + bk.cofirst + bk.corr + bk.both === bk.resp);
      h += '<div class="ach-chips"><button type="button" class="ach-chip' + (S.role === 'all' ? ' on' : '') + '" data-act="role" data-r="all">전체 ' + tot + '</button><button type="button" class="ach-chip' + (S.role === 'resp' ? ' on' : '') + '" data-act="role" data-r="resp">책임저자 ' + bk.resp + '</button><button type="button" class="ach-chip' + (S.role === 'co' ? ' on' : '') + '" data-act="role" data-r="co">공저 ' + bk.co + '</button>' +
        (bk.none ? '<button type="button" class="ach-chip' + (S.role === 'none' ? ' on' : '') + '" data-act="role" data-r="none">역할 미입력 ' + bk.none + '</button>' : '') + '</div>';
      if (S.role === 'resp') {
        h += '<div class="ach-chips">';
        ['all', 'pure', 'cofirst', 'corr', 'both'].forEach(function (b) { h += '<button type="button" class="ach-chip sm' + (S.sub === b ? ' on' : '') + '" data-act="sub" data-s="' + b + '">' + (b === 'all' ? '책임저자 전체' : BN[b]) + ' ' + (b === 'all' ? bk.resp : bk[b]) + '</button>'; });
        h += '</div>';
      }
      h += '<div class="ach-chips"><button type="button" class="ach-chip sm' + (S.fInh ? ' on' : '') + '" data-act="fil" data-f="inh">교내 ' + list.filter(inHouse).length + '</button><button type="button" class="ach-chip sm' + (S.fWait ? ' on' : '') + '" data-act="fil" data-f="wait">게재 아님 ' + list.filter(function (x) { return !isPub(x); }).length + '</button></div>';
      h += '<div class="ach-chk">' + (ok1 ? '<i>✓</i> 책임저자 ' + bk.resp + ' + 공저 ' + bk.co + (bk.none ? ' + 미입력 ' + bk.none : '') + ' = 전체 ' + tot : '<span class="bad">합이 안 맞아요</span>') +
        (bk.resp ? '<br>' + (ok2 ? '<i>✓</i> ' : '<span class="bad">합이 안 맞아요 </span>') + '제1저자 ' + bk.pure + ' + 공동제1 ' + bk.cofirst + ' + 교신 ' + bk.corr + ' + 겸임 ' + bk.both + ' = 책임저자 ' + bk.resp : '') + '</div>';
    }
    var cs = subCats(k.id);
    if (cs.length) {
      var sum = 0, none = list.filter(function (x) { return !x.cat_id || !cs.some(function (c) { return c.id === x.cat_id; }); }).length;
      h += '<div class="ach-chips"><button type="button" class="ach-chip sm' + (S.fCat === 'all' ? ' on' : '') + '" data-act="cat" data-c="all">분류 전체 ' + tot + '</button>';
      cs.forEach(function (c) { var n = list.filter(function (x) { return x.cat_id === c.id; }).length; sum += n; h += '<button type="button" class="ach-chip sm' + (S.fCat === c.id ? ' on' : '') + '" data-act="cat" data-c="' + esc(c.id) + '">' + esc(c.name) + ' ' + n + '</button>'; });
      if (none) h += '<button type="button" class="ach-chip sm' + (S.fCat === 'none' ? ' on' : '') + '" data-act="cat" data-c="none">미분류 ' + none + '</button>';
      h += '</div><div class="ach-chk">' + (sum + none === tot ? '<i>✓</i> 분류 ' + sum + ' + 미분류 ' + none + ' = 전체 ' + tot : '<span class="bad">합이 안 맞아요</span>') + '</div>';
    }
    return h;
  }
  function listHtml(k) {
    var all = ofKind(k.id), o = opts(), cs = subCats(k.id), paper = isPaperKind(k);
    var list = all.filter(function (x) {
      if (paper && !rolePasses(x, S, o)) return false;
      if (S.fCat !== 'all') { var inCat = x.cat_id && cs.some(function (c) { return c.id === x.cat_id; }); if (S.fCat === 'none' ? inCat : x.cat_id !== S.fCat) return false; }
      return true;
    });
    list = sortItems(list, S.sortKey);
    var sortLabel = ({ new: '연도 최신순', old: '연도 오래된순', upd: '최근 변경순' })[S.sortKey];
    var h = chipsHtml(k, all) + '<div class="ach-sortline"><span>' + list.length + '건</span><button type="button" data-act="sort">' + sortLabel + ' ▾</button></div>';
    h += list.map(function (x) { return rowHtml(x, '', false); }).join('') || (all.length ? '<div class="ach-note">조건에 맞는 항목이 없습니다.</div>' : '<div class="ach-empty"><b>아직 기록이 없어요</b>' + (S.offline ? '' : '<button type="button" class="ach-btn" data-act="add">＋ ' + esc(k.name) + ' 추가</button>') + '</div>');
    return h;
  }
  function updateFab() {
    var f = $('achFab'), b = $('achAdd'); if (!f) return;
    var k = S.tab !== 'sum' ? catById(S.tab) : null, on = shown() && S.loaded && !S.offline && !S.q && !S.sheet && k && !k.parent_id;
    f.classList.toggle('show', !!on);
    if (on) b.textContent = '＋ ' + k.name + ' 추가';
  }

  /* =====================================================================
   * 5. 창(바닥 시트) · 토스트
   * ===================================================================*/
  function openSheet(html, back, noScrim) {
    var box = $('achBox'); box.innerHTML = html; box.scrollTop = 0;
    S.sheet = true; S.sheetBack = back || null; S.noScrim = !!noScrim;
    $('achSheet').classList.add('show'); updateFab();
  }
  function closeSheet() { hideSheetNow(); renderAll(); }
  function hideSheetNow() { S.sheet = false; S.sheetBack = null; S.noScrim = false; E = null; var s = $('achSheet'); if (s) s.classList.remove('show'); }
  function sheetBackOrClose() { if (S.sheetBack) S.sheetBack(); else closeSheet(); }
  function toast(msg) { try { _toast(msg); } catch (e) {} }
  function undoToast(msg, ms, onUndo) {
    var t = $('achToast'); ms = ms || 8000;
    t.innerHTML = '<div class="tr"><span>' + esc(msg) + '</span><u id="achUndo" role="button" tabindex="0">되돌리기</u></div><div class="pg" id="achPg"></div>';
    t.classList.add('show');
    var pg = $('achPg'); pg.style.transition = calm() ? 'none' : 'transform ' + ms + 'ms linear';
    setTimeout(function () { pg.style.transform = 'scaleX(0)'; }, 30);
    $('achUndo').onclick = function () { clearTimeout(toastTimer); t.classList.remove('show'); onUndo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms);
  }
  function guardWrite() {
    if (S.offline) { toast('지금은 읽기만 돼요 — 연결된 뒤 다시 시도해 주세요.'); return false; }
    return true;
  }

  /* ---------- 상세 ---------- */
  function swHtml(id, label, sub, on) {
    return '<div class="ach-sw"><div>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</div><button type="button" class="tg' + (on ? ' on' : '') + '" id="' + id + '" role="switch" aria-checked="' + (!!on) + '" aria-label="' + esc(label.replace(/<[^>]+>/g, '')) + '"></button></div>';
  }
  function openDetail(id) {
    var x = itemById(id); if (!x) return;
    var k = catById(x.kind_id), paper = isPaperKind(k), d = dataOf(x), dv = derive(x, opts()), names = peopleNames(x), pos = toInt(d.author_pos), au = '';
    if (paper && names.length) {
      var meIdx = pos || findMe(names, S.settings.names), max = 8;
      names.forEach(function (n, i) { if (i < max || S.expand === x.id) au += '<b class="' + (i + 1 === meIdx ? 'me' : '') + '">' + esc(n) + (i + 1 === meIdx ? ' (나)' : '') + '</b>'; });
      if (names.length > max && S.expand !== x.id) au += '<button type="button" data-act="expand" data-id="' + esc(x.id) + '">…외 ' + (names.length - max) + '명 보기</button>';
    }
    var vol = d.volume ? esc(d.volume) + (d.issue ? '(' + esc(d.issue) + ')' : '') : '', pg = d.pages ? esc(d.pages) + '쪽' : (d.article_no ? '논문번호 ' + esc(d.article_no) : '');
    var kv = '';
    if (paper) {
      kv += '<span>내 위치</span><b>' + (pos ? pos + (toInt(d.author_total) ? '/' + toInt(d.author_total) : '') + '번째 · ' + esc(dv.text) + (dv.resp ? ' (책임저자)' : '') : '아직 입력 안 함') + '</b>';
      kv += '<span>학술지</span><b>' + esc(x.venue || '-') + (inHouse(x) ? ' · 교내' : (x.venue ? ' · 교외' : '')) + '</b>';
      if (vol || pg) kv += '<span>권(호)·쪽</span><b>' + [vol, pg].filter(Boolean).join(' · ') + '</b>';
    } else { kv += '<span>기관</span><b>' + esc(x.venue || '-') + '</b>'; if (x.cat_id && catById(x.cat_id)) kv += '<span>분류</span><b>' + esc(catById(x.cat_id).name) + '</b>'; }
    kv += '<span>연도</span><b>' + (toInt(x.year) || '-') + '</b>';
    if (paper) kv += '<span>상태</span><b>' + esc(x.status ? (STATUS_LABEL[x.status] || x.status) : '아직 입력 안 함') + '</b><span>DOI</span><b>' + esc(d.doi || '-') + '</b><span>등급</span><b>' + esc(d.journal_grade || '아직 입력 안 함') + '</b>';
    kv += '<span>확인</span><b>' + (x.verified ? '맞게 확인함' : (d.uncertain === true ? '확인 필요 (추정 값 있음)' : '확인 전 (정리한 값)')) + '</b><span>원본</span><b>' + (x.has_source ? 'PC 자료 폴더에 있음' : '-') + '</b>';
    var memo = [];
    if (x.note) memo.push('<div class="ach-note"><b>메모</b> ' + esc(x.note) + '</div>');
    var imp = [d.role_note, d.ledger_note].filter(Boolean);
    if (imp.length) memo.push('<details class="ach-note"><summary>정리 메모 (가져올 때)</summary>' + imp.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + '</details>');
    openSheet('<div class="ach-bh"><h2>' + esc(x.title) + '</h2><button type="button" class="ach-more" data-act="menu" aria-label="더보기">⋯</button></div>' +
      '<div class="ach-menu" id="achMenu">' + (x.verified ? '' : '<button type="button" data-act="verify" data-id="' + esc(x.id) + '" style="color:var(--text)">맞게 확인했어요로 표시</button>') + '<button type="button" data-act="trash" data-id="' + esc(x.id) + '">휴지통으로 옮기기</button></div>' +
      (au ? '<div class="ach-auth">' + au + '</div>' : '') + '<div class="ach-kv">' + kv + '</div>' + memo.join('') +
      (S.offline ? '<div class="ach-note">오프라인 사본이라 지금은 고칠 수 없어요.</div>' : '<button type="button" class="ach-btn" data-act="edit" data-id="' + esc(x.id) + '">고치기</button>'), null, false);
  }

  /* ---------- 추가 / 고치기 ---------- */
  function openEdit(base, kind) {
    if (!guardWrite()) return;
    var k = kind || catById(base.kind_id), paper = isPaperKind(k), d = base ? dataOf(base) : {}, names = base ? peopleNames(base) : [], cs = subCats(k.id);
    E = { base: base, kind: k, id: base ? base.id : uuid(), busy: false, authText: names.join(', '), inTouched: false, coTouched: false, crTouched: false, dupAck: false };
    var status = base ? (base.status || '') : 'published', inH = base ? d.in_house === true : false;
    var more = '<label class="ach-lbl" for="achFV">' + (paper ? '학술지' : '학교·기관') + '</label><input class="ach-f" id="achFV" value="' + esc(base ? base.venue : '') + '" autocomplete="off">';
    if (paper) {
      more += swHtml('achFIn', '교내 학술지예요', '산업기술연구소논문집·교수학습연구지 등', inH) +
        '<div class="ach-two"><div><label class="ach-lbl" for="achFVo">권</label><input class="ach-f" id="achFVo" value="' + esc(d.volume || '') + '"></div><div><label class="ach-lbl" for="achFIs">호</label><input class="ach-f" id="achFIs" value="' + esc(d.issue || '') + '"></div></div>' +
        '<div class="ach-two"><div><label class="ach-lbl" for="achFPg">쪽</label><input class="ach-f" id="achFPg" value="' + esc(d.pages || '') + '" placeholder="예: 101-110"></div><div><label class="ach-lbl" for="achFAn">논문번호</label><input class="ach-f" id="achFAn" value="' + esc(d.article_no || '') + '"></div></div>' +
        '<label class="ach-lbl" for="achFD">DOI</label><input class="ach-f" id="achFD" value="' + esc(d.doi || '') + '" placeholder="10.xxxx/…" autocomplete="off">' +
        '<label class="ach-lbl" for="achFG">등급 (모르면 비워 두세요)</label><select class="ach-f" id="achFG"><option value="">입력 안 함</option>' + GRADES.map(function (g) { return '<option' + (d.journal_grade === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select>' +
        '<label class="ach-lbl" for="achFS">상태</label><select class="ach-f" id="achFS">' + STATUS_ORDER.map(function (s) { return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + esc(STATUS_LABEL[s]) + '</option>'; }).join('') + '<option value=""' + (status === '' ? ' selected' : '') + '>입력 안 함</option></select>';
    } else {
      if (cs.length) more += '<label class="ach-lbl" for="achFC">분류</label><select class="ach-f" id="achFC"><option value="">분류 없음</option>' + cs.map(function (c) { return '<option value="' + esc(c.id) + '"' + (base && base.cat_id === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
    }
    more += '<label class="ach-lbl" for="achFN">메모</label><textarea class="ach-f" id="achFN" rows="2">' + esc(base ? base.note : '') + '</textarea>' + swHtml('achFVf', '맞게 확인했어요', '가져온 값을 직접 확인한 항목에 켜 두세요', base ? base.verified === true : false);
    openSheet('<div class="ach-hd"><h2>' + (base ? '고치기' : '새로 추가') + ' · ' + esc(k.name) + '</h2><button type="button" class="ach-back" data-act="editclose">닫기</button></div>' +
      '<label class="ach-lbl" for="achFT">제목 *</label><input class="ach-f" id="achFT" value="' + esc(base ? base.title : '') + '" autocomplete="off"><div id="achDup"></div>' +
      '<label class="ach-lbl" for="achFY">연도' + (paper ? ' *' : '') + '</label><input class="ach-f" id="achFY" inputmode="numeric" value="' + esc(base ? (toInt(base.year) || '') : (paper ? new Date().getFullYear() : '')) + '">' +
      (paper ? '<label class="ach-lbl" for="achFA">저자 (쉼표로 붙여넣기 → 순서대로 나뉘고, 내 이름을 찾아 순번을 미리 채워요)</label><textarea class="ach-f" id="achFA" rows="2" placeholder="예: 홍길동, 김철수, …">' + esc(E.authText) + '</textarea>' +
        '<div class="ach-me"><div class="ach-two"><div><label class="ach-lbl" for="achFP">내 순번</label><input class="ach-f" id="achFP" inputmode="numeric" value="' + esc(d.author_pos || '') + '"></div><div><label class="ach-lbl" for="achFTt">총 저자수</label><input class="ach-f" id="achFTt" inputmode="numeric" value="' + esc(d.author_total || '') + '"></div></div>' +
        swHtml('achFCo', '공동 제1저자 표시가 있어요', '논문에 * † 로 같이 기여했다고 적힌 경우', d.co_first === true) + swHtml('achFCr', '교신저자예요', '논문에 교신저자(*) 표시가 내 이름에 있는 경우', d.corresponding === true) + '<div class="ach-preview" id="achPv"></div><div class="ach-note" id="achCnt"></div></div>' : '') +
      '<button type="button" class="ach-exp" id="achEx" data-act="more">▾ 더 입력 (' + (paper ? '학술지 · 교내 · 권/호/쪽 · DOI · 등급 · 상태 · ' : '') + '메모)' + (paper && !base ? ' — 지금 상태: 게재' : '') + '</button><div class="ach-more-in" id="achMi">' + more + '</div>' +
      '<div id="achErr"></div><div style="height:16px"></div><button type="button" class="ach-btn" id="achSave" data-act="save">저장</button>', null, true);
    wireEdit(paper);
  }
  function readSw(id) { var e = $(id); return !!(e && e.classList.contains('on')); }
  function updatePreview() {
    var pv = $('achPv'); if (!pv) return;
    var pos = toInt($('achFP').value), d = derive({ data: { author_pos: pos, co_first: readSw('achFCo'), corresponding: readSw('achFCr') } }, opts());
    pv.textContent = pos ? '→ ' + (d.text || '공저') + (d.resp ? ' · 책임저자로 셉니다' : ' · 책임저자 아님') : '순번을 넣으면 역할이 자동으로 계산돼요';
    var tot = toInt($('achFTt').value), names = parseAuthors($('achFA').value), n = $('achCnt'), msg = '';
    if (pos && tot && pos > tot) msg = '내 순번이 총 저자수보다 커요.';
    else if (names.length && tot && names.length !== tot) msg = '저자 이름은 ' + names.length + '명인데 총 저자수는 ' + tot + '명이에요. 맞는지 확인해 주세요.';
    n.textContent = msg;
  }
  function checkDup() {
    var out = $('achDup'); if (!out || !E) return;
    var title = $('achFT').value.trim(), doi = $('achFD') ? $('achFD').value : '';
    var dp = isPaperKind(E.kind) ? findDup(S.items, title, doi, E.id, E.kind.id) : null;
    if (!dp || E.dupAck) { out.innerHTML = E.dupAck ? '<div class="ach-note">그래도 추가하기로 했어요.</div>' : ''; return; }
    out.innerHTML = '<div class="ach-warn">이미 있는 논문과 같아 보여요 (' + dp.why + ')<br>「' + esc(dp.x.title) + '」' + (dp.x.deleted_at ? ' — 휴지통에 있어요' : '') + '<div class="acts"><button type="button" data-act="dupgo">그래도 추가</button><button type="button" data-act="dupopen" data-id="' + esc(dp.x.id) + '">열어 보기</button></div></div>';
  }
  function wireEdit(paper) {
    var box = $('achBox');
    ['achFIn', 'achFCo', 'achFCr', 'achFVf'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.onclick = function () {
        this.classList.toggle('on'); this.setAttribute('aria-checked', this.classList.contains('on'));
        if (id === 'achFIn') E.inTouched = true; if (id === 'achFCo') E.coTouched = true; if (id === 'achFCr') E.crTouched = true;
        if (paper) updatePreview();
      };
    });
    $('achFT').oninput = function () { E.dupAck = false; checkDup(); };
    if (paper) {
      $('achFD').oninput = function () { E.dupAck = false; checkDup(); };
      $('achFP').oninput = updatePreview; $('achFTt').oninput = updatePreview;
      $('achFA').oninput = function () {
        var names = parseAuthors(this.value); if (!names.length) { updatePreview(); return; }
        $('achFTt').value = names.length;
        var me = findMe(names, S.settings.names); if (me) $('achFP').value = me;
        updatePreview();
      };
      $('achFV').oninput = function () { if (!E.inTouched) { var on = IN_HOUSE_RE.test(this.value), sw = $('achFIn'); sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on); } };
      updatePreview();
    }
    box.scrollTop = 0;
  }
  function readForm() {
    var k = E.kind, paper = isPaperKind(k), base = E.base, v = { id: E.id, kind_id: k.id, data: {} };
    v.title = $('achFT').value.trim();
    var ys = $('achFY').value.trim(); v.year = ys === '' ? null : toInt(ys);
    v.yearRaw = ys;
    v.venue = $('achFV').value.trim(); v.note = $('achFN').value.trim();
    v.verified = readSw('achFVf');
    if (paper) {
      var st = $('achFS').value; v.status = st === '' ? null : st;
      var text = $('achFA').value.trim();
      if (text !== E.authText.trim() && (text || E.authText)) v.people = parseAuthors(text).map(function (n) { return { name: n }; });
      var d = v.data, pos = toInt($('achFP').value), tot = toInt($('achFTt').value);
      d.author_pos = pos; d.author_total = tot;
      var bd = base ? dataOf(base) : {};
      if (E.coTouched || !base) { if (readSw('achFCo') || pos) d.co_first = readSw('achFCo'); }
      if (E.crTouched || !base) { if (readSw('achFCr') || pos) d.corresponding = readSw('achFCr'); }
      var venueChanged = base && (v.venue !== String(base.venue || ''));
      if (E.inTouched || venueChanged || !base) { var inh = readSw('achFIn'); if (inh || bd.in_house !== undefined) d.in_house = inh; }
      d.volume = $('achFVo').value.trim(); d.issue = $('achFIs').value.trim(); d.pages = $('achFPg').value.trim(); d.article_no = $('achFAn').value.trim();
      d.doi = cleanDoi($('achFD').value); d.journal_grade = $('achFG').value;
    } else {
      var c = $('achFC'); if (c) v.cat_id = c.value || null;
    }
    return v;
  }
  function inlineErr(msg) { $('achErr').innerHTML = msg ? '<div class="ach-err">' + esc(msg) + '</div>' : ''; }
  function doSave(forceBaseRev) {
    if (!E || E.busy) return;
    var paper = isPaperKind(E.kind), v = readForm(), bad = false;
    ['achFT', 'achFY'].forEach(function (id) { $(id).classList.remove('bad'); });
    if (!v.title) { $('achFT').classList.add('bad'); bad = true; }
    if (paper && !v.year) { $('achFY').classList.add('bad'); bad = true; }
    if (v.yearRaw !== '' && (!v.year || v.year < 1950 || v.year > 2100)) { $('achFY').classList.add('bad'); bad = true; }
    if (bad) { inlineErr(paper ? '제목과 연도(1950~2100)를 확인해 주세요.' : '제목을 확인해 주세요(연도를 적었다면 1950~2100).'); return; }
    var pp = v.data.author_pos, tt = v.data.author_total;
    if (paper && pp && tt && pp > tt) { inlineErr('내 순번이 총 저자수보다 커요. 확인해 주세요.'); return; }
    if (!guardWrite()) return;
    delete v.yearRaw;
    var base = E.base; if (base && forceBaseRev) base = Object.assign({}, base, { rev: forceBaseRev });
    var row = buildSaveRow(base, v);
    E.busy = true; inlineErr('');
    var btn = $('achSave'); btn.disabled = true; btn.textContent = '저장 중…';
    rpc('ach_save_item', { p_row: row }).then(function (res) {
      if (isObj(res) && res.ok === true) {
        var rev = toInt(res.rev) || ((base ? base.rev : 0) + 1), it = applyRowToItem(E.base ? itemById(E.base.id) || E.base : null, row, rev, nowIso());
        var at = -1; S.items.forEach(function (x, i) { if (x.id === it.id) at = i; });
        if (at >= 0) S.items[at] = it; else S.items.push(it);
        saveCache({ cats: S.cats, items: S.items });
        btn.innerHTML = '<span class="ach-pop">✓</span>&nbsp;저장했어요';
        setTimeout(function () { hideSheetNow(); renderAll(); toast('저장했어요'); load(true); }, calm() ? 50 : 420);
        return;
      }
      E.busy = false; btn.disabled = false; btn.textContent = '저장';
      var err = isObj(res) ? res.err : '';
      if (err === 'CONFLICT' && isObj(res.row)) {
        if (!E.base && res.row.id === E.id) {   // 새 항목인데 이미 서버에 있음 = 앞선 저장이 서버에는 반영된 경우(응답만 못 받음)
          var at2 = -1; S.items.forEach(function (x, i) { if (x.id === res.row.id) at2 = i; }); if (at2 >= 0) S.items[at2] = res.row; else S.items.push(res.row);
          hideSheetNow(); renderAll(); toast('이미 저장돼 있어요'); return;
        }
        showConflict(res.row, v); return;
      }
      inlineErr(({ BAD_ROW: '저장 못 함 — 입력한 값을 서버가 받아들이지 않았어요. 제목·연도·숫자를 확인해 주세요.', BAD_KIND: '저장 못 함 — 이 종류가 서버에서 바뀌었어요. 화면을 닫고 다시 불러와 주세요.', BAD_CAT: '저장 못 함 — 이 분류가 서버에서 바뀌었어요. 화면을 닫고 다시 불러와 주세요.' })[err] || '저장 못 함 — 서버가 받아들이지 않았어요. 다시 시도해 주세요.');
    }).catch(function (e) {
      E.busy = false; btn.disabled = false; btn.textContent = '저장';
      inlineErr('저장 못 함 — ' + (e && e.kind === 'net' ? '인터넷 연결을 확인하고 다시 눌러 주세요.' : (e && e.kind === 'badpass' ? '연동 암호를 확인해 주세요.' : errText(e))) + ' 입력한 내용은 그대로 두었어요.');
    });
  }
  function showConflict(serverRow, mine) {
    E.conflict = { row: serverRow, mine: mine };
    $('achErr').innerHTML = '<div class="ach-warn">다른 기기에서 먼저 고쳤어요.<br>「' + esc(serverRow.title) + '」 (서버 값)<div class="acts"><button type="button" data-act="useserver">서버 값으로 바꾸기</button><button type="button" data-act="usemine">내 값으로 덮어쓰기</button></div></div>';
  }

  /* ---------- 삭제 · 휴지통 ---------- */
  function trashItem(id) {
    if (!guardWrite()) return;
    var x = itemById(id); if (!x) return;
    hideSheetNow(); renderAll();
    var r = document.querySelector('.ach-row[data-id="' + id + '"]');
    if (r && !calm()) r.classList.add('gone');
    rpc('ach_trash_item', { p_id: id, p_restore: false }).then(function (ok) {
      if (ok === true || (isObj(ok) && ok.ok)) {
        x.deleted_at = nowIso(); x.rev = (x.rev || 1) + 1; saveCache({ cats: S.cats, items: S.items });
        setTimeout(function () { renderAll(); undoToast('휴지통으로 옮겼습니다', 8000, function () { restoreItem(id, true); }); }, calm() ? 0 : 230);
      } else { renderAll(); toast('옮기지 못했어요 — 이미 없는 항목이에요.'); load(true); }
    }).catch(function (e) { renderAll(); toast('휴지통으로 옮기지 못했어요 — ' + errText(e)); });
  }
  function restoreItem(id, fromUndo) {
    rpc('ach_trash_item', { p_id: id, p_restore: true }).then(function () {
      var x = itemById(id); if (x) { x.deleted_at = null; x.rev = (x.rev || 1) + 1; saveCache({ cats: S.cats, items: S.items }); }
      renderAll(); if (S.sheet && !fromUndo) openTrash(); toast(fromUndo ? '되돌렸습니다' : '되살렸습니다');
    }).catch(function (e) { toast('되살리지 못했어요 — ' + errText(e)); });
  }
  function purgeItem(id) {
    rpc('ach_purge_item', { p_id: id }).then(function (ok) {
      if (ok !== true && !(isObj(ok) && ok.ok)) { toast('영구 삭제하지 못했어요.'); return; }
      S.items = S.items.filter(function (x) { return x.id !== id; }); saveCache({ cats: S.cats, items: S.items });
      renderAll(); openTrash(); toast('영구 삭제했습니다');
    }).catch(function (e) { toast('영구 삭제하지 못했어요 — ' + errText(e)); });
  }
  function openTrash() {
    var tr = trashed(), h = '<div class="ach-hd"><button type="button" class="ach-back" data-act="settings">‹ 설정</button><h2>휴지통</h2></div>';
    h += tr.length ? tr.map(function (x) { return '<div class="ach-card" style="padding:12px"><div style="font-weight:800;font-size:14.5px;line-height:1.4">' + esc(x.title) + '</div><div class="ach-two" style="margin-top:10px"><button type="button" class="ach-btn sm ghost" data-act="restore" data-id="' + esc(x.id) + '">되살리기</button><button type="button" class="ach-btn sm ghost danger" data-act="purge" data-id="' + esc(x.id) + '">영구 삭제…</button></div></div>'; }).join('') : '<div class="ach-note">휴지통이 비어 있어요. 지운 항목은 여기서 되살릴 수 있어요.</div>';
    openSheet(h + '<div class="ach-note">영구 삭제는 되돌릴 수 없어서 한 번 더 확인해요.</div>', openSettings, false);
  }

  /* ---------- 설정 ---------- */
  function openSettings() {
    build();
    var tr = trashed().length;
    openSheet('<h2>실적 설정</h2>' +
      '<button type="button" class="ach-setrow" data-act="trashlist">휴지통 <small>' + tr + '건 ›</small></button>' +
      '<button type="button" class="ach-setrow" data-act="names">내 이름 표기 <small>' + (S.settings.names.length ? '내가 더한 ' + S.settings.names.length + '개 ›' : '자동 찾기 ›') + '</small></button>' +
      '<button type="button" class="ach-setrow" data-act="export">내보내기 <small>JSON ›</small></button>' +
      '<button type="button" class="ach-setrow" data-act="kinds">종류 관리 <small>' + kindsList().map(function (k) { return esc(k.name); }).join(' · ') + ' ›</small></button>' +
      '<div style="height:10px"></div>' + swHtml('achSwCf', '공동 제1저자를 제1저자로 세기', '끄면 책임저자 숫자가 줄어요 (규정에 문구가 없어 확인 전까지 바꿔 볼 수 있게)', S.settings.cofirst) +
      swHtml('achSwIh', '교내 논문집도 승진 요건용에 넣기', '기본은 끔 — 규정이 SCI·등재급 이상으로 읽히기 때문', S.settings.inhouseReq) +
      '<div class="ach-note">스위치를 바꾼 뒤 창을 닫으면 숫자가 바로 바뀌어요.</div>', closeSheet, false);
    $('achSwCf').onclick = function () { S.settings.cofirst = !S.settings.cofirst; saveSettings(); this.classList.toggle('on', S.settings.cofirst); this.setAttribute('aria-checked', S.settings.cofirst); renderAll(); };
    $('achSwIh').onclick = function () { S.settings.inhouseReq = !S.settings.inhouseReq; saveSettings(); this.classList.toggle('on', S.settings.inhouseReq); this.setAttribute('aria-checked', S.settings.inhouseReq); renderAll(); };
  }
  function openNames() {
    openSheet('<div class="ach-hd"><button type="button" class="ach-back" data-act="settings">‹ 설정</button><h2>내 이름 표기</h2></div>' +
      '<div class="ach-note">저자 칸에 붙여넣으면 내 이름을 찾아 순번을 미리 채워요. 한글 이름과 영문 이름(Ho Seok Kwak · Kwak Ho Seok · H.S. Kwak · Hoseok Kwak 같은 변형)은 자동으로 찾아요. 성(Kwak)만 같은 다른 사람은 찾지 않아요.</div>' +
      '<label class="ach-lbl" for="achFNm">그 밖에 더 찾을 표기 (한 줄에 하나)</label><textarea class="ach-f" id="achFNm" rows="4">' + esc(S.settings.names.join('\n')) + '</textarea><div style="height:14px"></div><button type="button" class="ach-btn" data-act="savenames">저장</button>', openSettings, false);
  }
  function exportJson() {
    var payload = JSON.stringify({ schema_ver: 2, exported_at: nowIso(), cats: S.cats, items: S.items }, null, 1), name = 'achievements_' + nowIso().slice(0, 10) + '.json';
    function copyFallback() {
      try { navigator.clipboard.writeText(payload).then(function () { toast('내보낼 내용을 복사했어요 (' + S.items.length + '건)'); }, showBox); } catch (e) { showBox(); }
    }
    function showBox() {
      openSheet('<div class="ach-hd"><button type="button" class="ach-back" data-act="settings">‹ 설정</button><h2>내보내기</h2></div><div class="ach-note">아래 내용을 길게 눌러 복사하세요.</div><textarea class="ach-f" rows="10" readonly id="achExp">' + esc(payload) + '</textarea>', openSettings, false);
      var t = $('achExp'); if (t) { t.focus(); t.select(); }
    }
    try {
      var f = new File([payload], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: '실적 내보내기' }).catch(copyFallback); return; }
    } catch (e) {}
    copyFallback();
  }

  /* ---------- 종류·분류 관리 ---------- */
  function openKinds(note) {
    var h = '<div class="ach-hd"><button type="button" class="ach-back" data-act="settings">‹ 설정</button><h2>종류 관리</h2></div>' + (note ? '<div class="ach-warn">' + esc(note) + '</div>' : '');
    kindsList().forEach(function (k, i, arr) {
      var cs = subCats(k.id);
      h += '<div class="ach-kindrow"><div class="nm"><span>' + esc(k.name) + ' <small style="color:var(--ad);font-weight:600">' + ofKindAll(k.id) + '개</small></span>' + miniBtns(k.id, i, arr.length) + '</div>';
      cs.forEach(function (c, j) { h += '<div class="ach-kindrow sub"><div class="nm"><span>' + esc(c.name) + ' <small style="color:var(--ad);font-weight:600">' + S.items.filter(function (x) { return x.cat_id === c.id; }).length + '개</small></span>' + miniBtns(c.id, j, cs.length) + '</div></div>'; });
      h += '<button type="button" class="ach-mini" style="margin:8px 0 2px" data-act="catadd" data-p="' + esc(k.id) + '">＋ 분류 추가</button></div>';
    });
    h += '<button type="button" class="ach-btn ghost sm" data-act="catadd" data-p="">＋ 종류 추가</button><div class="ach-note">지울 때 안에 항목(휴지통 속 포함)이 있으면 막아요. 다른 곳으로 옮긴 뒤 지울 수 있어요.</div>';
    openSheet(h, openSettings, false);
  }
  function ofKindAll(kid) { return S.items.filter(function (x) { return x.kind_id === kid; }).length; }
  function miniBtns(id, i, n) {
    return '<button type="button" class="ach-mini" data-act="catren" data-id="' + esc(id) + '" aria-label="이름 고치기">이름</button>' + (i > 0 ? '<button type="button" class="ach-mini" data-act="catmv" data-id="' + esc(id) + '" data-d="-1" aria-label="위로">↑</button>' : '') + (i < n - 1 ? '<button type="button" class="ach-mini" data-act="catmv" data-id="' + esc(id) + '" data-d="1" aria-label="아래로">↓</button>' : '') + '<button type="button" class="ach-mini danger" data-act="catdel" data-id="' + esc(id) + '" aria-label="삭제">삭제</button>';
  }
  function openCatName(c, parentId) {
    openSheet('<div class="ach-hd"><button type="button" class="ach-back" data-act="kinds">‹ 종류 관리</button><h2>' + (c ? '이름 고치기' : (parentId ? '분류 추가' : '종류 추가')) + '</h2></div><label class="ach-lbl" for="achFCn">이름 (40자 이내)</label><input class="ach-f" id="achFCn" maxlength="40" value="' + esc(c ? c.name : '') + '" autocomplete="off"><div id="achErr"></div><div style="height:14px"></div><button type="button" class="ach-btn" data-act="catsave" data-id="' + esc(c ? c.id : '') + '" data-p="' + esc(parentId || '') + '">저장</button>', openKinds, false);
  }
  function catErrText(res) {
    var err = isObj(res) ? res.err : '';
    if (err === 'NOT_EMPTY') return '항목 ' + (res.count || '') + '개가 있어요 — 다른 분류로 옮긴 뒤 지울 수 있어요.';
    if (err === 'HAS_CHILD') return '안에 분류가 있어요 — 분류를 먼저 지워 주세요.';
    if (err === 'CONFLICT') return '다른 기기에서 먼저 바뀌었어요. 다시 불러왔으니 한 번 더 해 주세요.';
    return '서버가 받아들이지 않았어요.';
  }
  function saveCat(id, parentId) {
    var name = $('achFCn').value.trim(); if (!name) { $('achErr').innerHTML = '<div class="ach-err">이름을 적어 주세요.</div>'; return; }
    if (!guardWrite()) return;
    var cur = id ? catById(id) : null, sib = cur ? (cur.parent_id ? subCats(cur.parent_id) : kindsList()) : (parentId ? subCats(parentId) : kindsList());
    var row = cur ? { id: cur.id, parent_id: cur.parent_id, kind_type: cur.kind_type, name: name, sort: cur.sort, base_rev: cur.rev } : { id: uuid(), parent_id: parentId || null, kind_type: 'generic', name: name, sort: sib.length + 1 };
    rpc('ach_save_cat', { p_row: row }).then(function (res) {
      if (isObj(res) && res.ok === true) { load(true).then(function () { openKinds(); }); return; }
      if (isObj(res) && res.err === 'CONFLICT') load(true);
      $('achErr').innerHTML = '<div class="ach-err">' + esc(catErrText(res)) + '</div>';
    }).catch(function (e) { $('achErr').innerHTML = '<div class="ach-err">저장 못 함 — ' + esc(errText(e)) + '</div>'; });
  }
  function moveCat(id, d) {
    var c = catById(id); if (!c || !guardWrite()) return;
    var sib = c.parent_id ? subCats(c.parent_id) : kindsList(), i = sib.indexOf(c), j = i + d;
    if (i < 0 || j < 0 || j >= sib.length) return;
    sib.splice(j, 0, sib.splice(i, 1)[0]);
    var jobs = [];
    sib.forEach(function (x, idx) { if ((x.sort || 0) !== idx + 1) jobs.push({ id: x.id, parent_id: x.parent_id, kind_type: x.kind_type, name: x.name, sort: idx + 1, base_rev: x.rev }); });
    jobs.reduce(function (p, row) { return p.then(function () { return rpc('ach_save_cat', { p_row: row }).then(function (res) { if (!(isObj(res) && res.ok === true)) throw mkErr('SAVE_CAT', 'server'); }); }); }, Promise.resolve())
      .then(function () { return load(true); }).then(function () { openKinds(); })
      .catch(function (e) { load(true).then(function () { openKinds('순서를 바꾸지 못했어요 — ' + errText(e)); }); });
  }
  function delCat(id) {
    if (!guardWrite()) return;
    rpc('ach_trash_cat', { p_id: id }).then(function (res) {
      if (isObj(res) && res.ok === true) { load(true).then(function () { openKinds('지웠어요.'); }); return; }
      openKinds(catErrText(res));
    }).catch(function (e) { openKinds('지우지 못했어요 — ' + errText(e)); });
  }

  /* =====================================================================
   * 6. 눌림 처리 (한 곳에서 받아 나눈다)
   * ===================================================================*/
  var purgeArm = null;
  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var a = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (a) {
      case 'tab': S.tab = el.getAttribute('data-t'); S.role = 'all'; S.sub = 'all'; S.fInh = false; S.fWait = false; S.fCat = 'all'; $('achQ').value = ''; S.q = ''; $('achSearch').classList.remove('has'); renderAll(); break;
      case 'role': S.role = el.getAttribute('data-r'); S.sub = 'all'; renderAll(); break;
      case 'sub': S.sub = el.getAttribute('data-s'); renderAll(); break;
      case 'fil': if (el.getAttribute('data-f') === 'inh') S.fInh = !S.fInh; else S.fWait = !S.fWait; renderAll(); break;
      case 'cat': S.fCat = el.getAttribute('data-c'); renderAll(); break;
      case 'sort': S.sortKey = S.sortKey === 'new' ? 'old' : (S.sortKey === 'old' ? 'upd' : 'new'); renderAll(); break;
      case 'reload': load(false); break;
      case 'open': openDetail(id); break;
      case 'expand': S.expand = id; openDetail(id); break;
      case 'menu': $('achMenu').classList.toggle('show'); break;
      case 'add': var kd = S.tab !== 'sum' ? catById(S.tab) : null; if (kd) openEdit(null, kd); break;
      case 'edit': openEdit(itemById(id)); break;
      case 'editclose': hideSheetNow(); renderAll(); break;
      case 'more': $('achMi').classList.toggle('show'); break;
      case 'save': doSave(); break;
      case 'dupgo': E.dupAck = true; checkDup(); break;
      case 'dupopen': var dx = itemById(id); if (dx) { hideSheetNow(); openDetail(dx.id); } break;
      case 'useserver': { var sr = E && E.conflict && E.conflict.row; if (sr) { var at = -1; S.items.forEach(function (x, i) { if (x.id === sr.id) at = i; }); if (at >= 0) S.items[at] = sr; hideSheetNow(); renderAll(); toast('서버 값으로 바꿨어요'); } break; }
      case 'usemine': { var cr = E && E.conflict && E.conflict.row; if (cr) { E.base = cr; $('achErr').innerHTML = ''; doSave(cr.rev); } break; }
      case 'verify': verifyItem(id); break;
      case 'trash': trashItem(id); break;
      case 'settings': openSettings(); break;
      case 'trashlist': openTrash(); break;
      case 'restore': restoreItem(id, false); break;
      case 'purge': if (purgeArm === id) { purgeArm = null; purgeItem(id); } else { purgeArm = id; el.textContent = '정말 영구 삭제'; setTimeout(function () { if (purgeArm === id) { purgeArm = null; if (el.isConnected) el.textContent = '영구 삭제…'; } }, 4000); } break;
      case 'names': openNames(); break;
      case 'savenames': S.settings.names = ($('achFNm').value || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean); saveSettings(); toast('저장했어요'); openSettings(); break;
      case 'export': exportJson(); break;
      case 'kinds': openKinds(); break;
      case 'catadd': openCatName(null, el.getAttribute('data-p')); break;
      case 'catren': openCatName(catById(id), ''); break;
      case 'catsave': saveCat(id, el.getAttribute('data-p')); break;
      case 'catmv': moveCat(id, +el.getAttribute('data-d')); break;
      case 'catdel': delCat(id); break;
    }
  }
  function verifyItem(id) {
    var x = itemById(id); if (!x || !guardWrite()) return;
    rpc('ach_save_item', { p_row: { id: x.id, base_rev: x.rev, verified: true } }).then(function (res) {
      if (isObj(res) && res.ok === true) { x.verified = true; x.rev = toInt(res.rev) || x.rev + 1; saveCache({ cats: S.cats, items: S.items }); renderAll(); openDetail(id); toast('확인한 항목으로 표시했어요'); }
      else { toast('표시하지 못했어요 — 다시 불러온 뒤 해 주세요.'); load(true); }
    }).catch(function (e) { toast('표시하지 못했어요 — ' + errText(e)); });
  }

  /* =====================================================================
   * 7. app.js 와 만나는 곳
   * ===================================================================*/
  function init(o) { if (o && o.toast) _toast = o.toast; build(); }
  function open() {
    build(); S.q = ''; var q = $('achQ'); if (q) q.value = ''; var sb = $('achSearch'); if (sb) sb.classList.remove('has');
    renderAll(); load(S.loaded);
  }
  /* 뒤로 가기: 창이 열려 있으면 창부터 닫는다. true = 여기서 처리함 */
  var editWarnAt = 0;
  function back() {
    if (S.sheet) {
      if (E && !E.busy && S.noScrim) {      // 입력 중인 창 — 실수로 닫아 내용이 사라지지 않게 한 번 더 누르면 닫는다
        var t = $('achFT'); var dirty = t && (t.value.trim() !== String(E.base ? E.base.title : '') || (E.base == null && ($('achFA') && $('achFA').value.trim())));
        if (dirty && Date.now() - editWarnAt > 3000) { editWarnAt = Date.now(); toast('한 번 더 누르면 닫혀요 (입력한 내용이 사라져요)'); return true; }
      }
      sheetBackOrClose(); return true;
    }
    if (S.q) { $('achQ').value = ''; S.q = ''; $('achSearch').classList.remove('has'); renderAll(); return true; }
    return false;
  }
  global.AchTab = { init: init, open: open, back: back };
})(typeof window !== 'undefined' ? window : globalThis);
