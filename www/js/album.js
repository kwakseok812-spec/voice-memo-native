/* ============================================================================
 * album.js — 「사진첩」 (v9.69, O-0720 · v9.77 「♥」 앨범)  유치원~대학원·교수 시절·가족 사진과 족보를 심심할 때 넘겨 보는 화면
 * ----------------------------------------------------------------------------
 * 화면: 단계 칩 · 격자(24장씩, 끝에 닿으면 자동으로 더) · 한 장 크게 보기(좌우로 밀기 · 두 손가락/더블탭 확대 · 원본 비율) · 아무거나 보기 · 고치기 · 휴지통 · 「이 단계 확인함」
 * 저장: 스마트비서 서버의 album_photos 표와 album_* 함수(RPC) — 표 직접 접근은 막혀 있고 건강·실적 탭과 같은 「연동 암호」(localStorage smart_sync_pass)를 모든 호출에 붙인다.
 *       사진 파일은 비공개 저장소 album-files. 앱은 파일 경로를 모르고 사진 번호만 보낸다 — 서버 함수 album-file 이 암호를 확인한 뒤 짧게(60분) 유효한 주소를 준다.
 * 규칙: · 못 불러왔으면 「0장」이 아니라 「불러오지 못했어요」. 오류는 암호 틀림·서버 표 없음·서버 오류·인터넷 끊김을 구분한다.
 *       · 저장은 서버 응답 {ok:true} 를 받은 뒤에만 「저장했어요」. 입력 내용은 실패해도 지우지 않는다.
 *       · 날짜는 지어내지 않는다 — 모르면 「날짜 모름」, 불확실하면 「날짜 불확실」. 날짜순 정렬은 없다(앨범 순서 ord).
 *       · 삭제는 휴지통(8초 되돌리기). 영구 삭제는 휴지통 안에서 한 번 더 눌러야 하고, 저장소 파일을 먼저 지운 뒤에만 표에서 지운다.
 *       · v9.70(O-0723): 큰 보기(족보 포함)의 「내려받기」 단추 하나 — 원본 JPEG 를 폰 「다운로드」 폴더에 album_<단계영문>_<번호>.jpg(족보는 genealogy.jpg)로 저장. 끝난 뒤에만 「저장했어요」, 실패하면 「못 했어요 — 이유」.
 *         공유 단추·여러 장 한꺼번에 내려받기는 없다. 스위치 ALBUM_DL(app.js) 'off' 면 단추가 없어 v9.69 와 같다. 앱 안 잠금도 없다(건강·실적 탭과 같음).
 *       · v9.77(♥ 앨범): 단계 칩 맨 끝에 하트(♥) 칩 하나 — 분류 이름 '♥' 인 사진만 모아 보는 따로 앨범. 「전체」·「아무거나 보기」에는 섞이지 않는다(족보와 같은 방식). 날짜가 사진 파일의 촬영 기록(date_src 'exif')이면 「(촬영 기록 기준)」으로 표시.
 *         스위치 ALBUM_HEART(app.js) 'off' 면 하트 칩이 없고 ♥ 사진도 어디에도 보이지 않는다(서버 무관).
 * 스위치: app.js 의 ALBUM_TAB ('on' | 'off') — 'off' 면 홈 칸이 보이지 않아 v9.68 과 같다.
 * app.js 연결: AlbumTab.init({toast, save}) · AlbumTab.open() · AlbumTab.back() (goBack 이 먼저 물어본다).
 * 시험: AlbumPure(순수 함수 묶음 — 날짜 표기·고치기 행·확대 계산·일괄 확인 대상·섞기 …)는 화면 없이 시험할 수 있게 밖으로 내놓았다.
 * 서버 호출 부품은 achievements.js 의 AchPure.makeRpc 를 그대로 쓴다(그쪽 코드는 고치지 않음).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 순수 함수
   * ===================================================================*/
  var STAGES = ['유치원', '초등학교', '중학교', '고등학교', '대학교', '대학원', '교수 시절', '가족'];
  var TREE = '족보';
  var HEART = '♥';             /* ♥ — v9.77 하트 앨범의 분류 이름(서버 표 stage 값과 같다) */
  var HEART_ON = true;             /* 스위치 ALBUM_HEART — init 의 heart:false 로 끈다 */
  var PAGE = 24, THUMB_BATCH = 50, AHEAD = 3, BEHIND = 1, BIG_KEEP = 150, MAX_ZOOM = 5, DBL_ZOOM = 2.5;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 'YYYY' · 'YYYY-MM' · 'YYYY-MM-DD' → {y,m,d} (m·d 는 모르면 0). 달력에 없는 날짜는 null */
  function parseDate(s) {
    var m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(s == null ? '' : s));
    if (!m) return null;
    var y = +m[1], mo = m[2] ? +m[2] : 0, d = m[3] ? +m[3] : 0;
    if (y < 1900 || y > 2100) return null;
    if (m[2] && (mo < 1 || mo > 12)) return null;
    if (m[3]) { var dt = new Date(y, mo - 1, d); if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; }
    return { y: y, m: mo, d: d };
  }
  function dateLong(s) { var p = parseDate(s); if (!p) return ''; return p.y + '년' + (p.m ? ' ' + p.m + '월' : '') + (p.d ? ' ' + p.d + '일' : ''); }
  function dateShort(s) { var p = parseDate(s); if (!p) return ''; return String(p.y) + (p.m ? '.' + p.m : '') + (p.d ? '.' + p.d : ''); }
  /* 손으로 친 날짜 → 서버에 보낼 글자. '' 는 「날짜 지움」. 1993.2.22 · 1993-2-22 · 1993/02/22 도 받는다. 달력에 없으면 ok:false */
  function normDateInput(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return { ok: true, val: '' };
    var m = /^(\d{4})(?:\s*[-./년]\s*(\d{1,2})(?:\s*[-./월]\s*(\d{1,2}))?\s*[일]?)?\s*(?:년|월|일)?$/.exec(t);
    if (!m) return { ok: false };
    var s = m[1] + (m[2] ? '-' + ('0' + m[2]).slice(-2) : '') + (m[3] ? '-' + ('0' + m[3]).slice(-2) : '');
    return parseDate(s) ? { ok: true, val: s } : { ok: false };
  }
  /* 화면에 보일 날짜 설명. src: print(사진에 찍힌 글자) · exif(사진 파일의 촬영 기록, v9.77) · uncertain(날짜 불확실) · user(직접 적은 날짜) · 없음 */
  function dateInfo(x) {
    var t = x && x.date_text, long = dateLong(t), src = x && x.date_src ? x.date_src : '';
    var unc = src === 'uncertain';
    return { has: !!long, long: long, short: dateShort(t), unc: unc, user: src === 'user', exif: src === 'exif', none: !long && !unc, src: src };
  }

  function isLive(x) { return !!x && !x.deleted_at; }
  function byOrd(a, b) { return (a.ord || 0) - (b.ord || 0) || String(a.id).localeCompare(String(b.id)); }
  /* tab: 'all'(족보·♥ 빼고 전부) · 단계 이름 · 족보 · ♥ */
  function listFor(items, tab) {
    return items.filter(function (x) { return isLive(x) && (tab === 'all' ? (x.stage !== TREE && x.stage !== HEART) : x.stage === tab) && (HEART_ON || x.stage !== HEART); }).sort(byOrd);
  }
  function verifyTargets(list) { return list.filter(function (x) { return isLive(x) && !x.verified; }).map(function (x) { return x.id; }); }
  /* 앞뒤 몇 장 — 큰 보기에서 미리 받을 순서(지금 → 다음 → 이전 → 그다음 …) */
  function neighbors(idx, len, behind, ahead) {
    var out = [], i;
    if (idx >= 0 && idx < len) out.push(idx);
    for (i = 1; i <= ahead; i++) if (idx + i < len) out.push(idx + i);
    for (i = 1; i <= behind; i++) if (idx - i >= 0) out.push(idx - i);
    return out;
  }
  function shuffle(arr, rnd) {
    var a = arr.slice(), r = rnd || Math.random, i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* 고치기 저장 행 — 바뀐 칸만 보낸다(서버는 받은 칸만 바꾸고 모르는 data 칸은 그대로 둔다) */
  function buildSaveRow(base, v) {
    var row = { id: base.id, base_rev: base.rev };
    if (v.caption !== undefined && String(v.caption).trim() !== base.caption) row.caption = String(v.caption).trim();
    if (v.date_text !== undefined && (v.date_text || '') !== (base.date_text || '')) row.date_text = v.date_text || '';
    if (v.stage !== undefined && v.stage !== base.stage) row.stage = v.stage;
    if (v.verified !== undefined) row.verified = !!v.verified;
    return row;
  }
  function applyRow(item, row) { if (isObj(row)) for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) item[k] = row[k]; return item; }
  /* 확대 계산 — 이미지 중심 기준 좌표. 점 (cx,cy) 가 제자리에 있도록 */
  function panLimit(s, w, h) { return { x: Math.max(0, (s - 1) * w / 2), y: Math.max(0, (s - 1) * h / 2) }; }
  function zoomAt(z, ns, cx, cy, w, h) {
    ns = clamp(ns, 1, MAX_ZOOM);
    var k = ns / z.s, x = cx - (cx - z.x) * k, y = cy - (cy - z.y) * k;
    if (ns <= 1.001) return { s: 1, x: 0, y: 0 };
    var lim = panLimit(ns, w, h);
    return { s: ns, x: clamp(x, -lim.x, lim.x), y: clamp(y, -lim.y, lim.y) };
  }
  function panTo(z, x, y, w, h) { var lim = panLimit(z.s, w, h); return { s: z.s, x: clamp(x, -lim.x, lim.x), y: clamp(y, -lim.y, lim.y) }; }
  function toggleZoom(z, cx, cy, w, h) { return z.s > 1.02 ? { s: 1, x: 0, y: 0 } : zoomAt(z, DBL_ZOOM, cx, cy, w, h); }

  /* 내려받는 파일 이름 — 영문·숫자만(한글 금지). 단계 → 영문, 번호 = 앨범 순서(ord, 4자리). 족보는 genealogy.jpg */
  var STAGE_EN = { '유치원': 'kindergarten', '초등학교': 'elementary', '중학교': 'middle', '고등학교': 'high', '대학교': 'university', '대학원': 'graduate', '교수 시절': 'professor', '가족': 'family', '♥': 'heart' };
  function padNo(n) { var t = String(n); while (t.length < 4) t = '0' + t; return t; }
  function dlName(x) {
    if (!x) return 'album_photo.jpg';
    if (x.stage === TREE) return 'genealogy.jpg';
    var en = STAGE_EN[x.stage] || 'photo', n = +x.ord, no = (isFinite(n) && n > 0) ? padNo(Math.floor(n)) : String(x.id || '').replace(/[^0-9a-z]/gi, '').slice(0, 8).toLowerCase();
    if (!no) no = '0000';
    return 'album_' + en + '_' + no + '.jpg';
  }
  /* 앱 저장 실패 사유(합니다체 문장) → 사진첩 말투(해요체) */
  function softenWhy(t) {
    return String(t == null ? '' : t).replace(/않습니다/g, '않아요').replace(/합니다/g, '해요').replace(/습니다/g, '어요').replace(/됩니다/g, '돼요');
  }

  function classifyFileErr(code) { return ({ bad_pass: 'badpass', no_file: 'nofile', gone: 'gone' })[code] || 'server'; }
  function mkErr(msg, kind) { var e = new Error(msg); e.alb = true; e.kind = kind; return e; }
  function makeFileApi(dep) {
    return function fileApi(body) {
      var c = dep.cfg();
      if (!c) return Promise.reject(mkErr('NO_CONFIG', 'server'));
      var pass = dep.pass();
      if (!pass) { dep.needPass('PC 연동 암호를 입력해 주세요.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
      var b = {}, k; for (k in (body || {})) b[k] = body[k]; b.pass = pass;
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, dep.timeout || 20000) : null;
      var f = dep.fetch || global.fetch;
      return f(c.url + '/functions/v1/album-file', {
        method: 'POST', headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(b), signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (tm) clearTimeout(tm);
        if (!r.ok) throw mkErr('HTTP_' + r.status, 'server');
        return r.json().then(function (j) {
          if (j && j.ok === true) return j;
          var kind = classifyFileErr(j && j.error);
          if (kind === 'badpass') dep.needPass('연동 암호가 맞지 않아요. 다시 입력해 주세요.');
          throw mkErr('FILE_' + (j && j.error), kind);
        }, function () { throw mkErr('BAD_JSON', 'server'); });
      }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });
    };
  }

  global.AlbumPure = {
    STAGES: STAGES, TREE: TREE, HEART: HEART, setHeart: function (v) { HEART_ON = !!v; }, PAGE: PAGE, MAX_ZOOM: MAX_ZOOM, DBL_ZOOM: DBL_ZOOM, parseDate: parseDate, dateLong: dateLong, dateShort: dateShort, normDateInput: normDateInput, dateInfo: dateInfo,
    listFor: listFor, verifyTargets: verifyTargets, neighbors: neighbors, shuffle: shuffle, buildSaveRow: buildSaveRow, applyRow: applyRow,
    panLimit: panLimit, zoomAt: zoomAt, panTo: panTo, toggleZoom: toggleZoom, makeFileApi: makeFileApi, classifyFileErr: classifyFileErr, dlName: dlName, softenWhy: softenWhy
  };

  /* =====================================================================
   * 2. 상태·서버
   * ===================================================================*/
  var S = { items: [], loaded: false, loading: null, err: null, offline: false, cachedAt: null, tab: 'all', shown: PAGE, list: [], lastLoadAt: 0, host: null,
    v: { open: false, list: [], idx: 0, random: false, tok: 0 }, sheet: false, hint: true, save: null };
  var CKEY = 'smart_album_cache_v1', HKEY = 'smart_album_hint_v1';
  var _toast = function () {}, dlBusy = {}, built = false, toastTimer = null, io = null, loadingMore = false;
  function $(id) { return document.getElementById(id); }
  function cfg() { return (global.OfficeBridge && global.OfficeBridge.CONFIG) || null; }
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function needPass(msg) { try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {} }
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  var rpc = function () { return Promise.reject(mkErr('NO_ACH', 'server')); }, fileApi = makeFileApi({ cfg: cfg, pass: syncPass, needPass: needPass, fetch: function () { return global.fetch.apply(global, arguments); } });
  function toast(msg, ms) { try { _toast(msg, ms); } catch (e) {} }
  function fmtDay(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function itemById(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function view() { return $('albumBody'); }
  function shown() { var v = $('albumView'); return !!v && v.style.display !== 'none'; }

  function saveCache(items) { try { localStorage.setItem(CKEY, JSON.stringify({ at: Date.now(), items: items })); } catch (e) {} }
  function readCache() { try { var c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (c && Array.isArray(c.items)) return c; } catch (e) {} return null; }

  function errText(e) {
    if (!e) return '';
    if (e.kind === 'badpass') return '연동 암호가 맞지 않아요. 암호를 다시 입력해 주세요.';
    if (e.kind === 'notready') return '서버에 사진첩 표가 아직 준비되지 않았어요.';
    if (e.kind === 'net') return '인터넷에 연결되지 않았어요.';
    if (e.kind === 'nofile') return '이 사진 파일이 서버에 없어요.';
    if (e.kind === 'gone') return '이 사진은 휴지통에 있거나 지워졌어요.';
    return '서버가 응답하지 않았어요. 잠시 뒤 다시 시도해 주세요.';
  }

  function load(quiet) {
    if (S.loading) return S.loading;
    var p = rpc('album_list', {}).then(function (d) {
      if (!isObj(d) || !Array.isArray(d.items)) throw mkErr('BAD_SHAPE', 'server');
      S.items = d.items; S.loaded = true; S.offline = false; S.err = null; S.lastLoadAt = Date.now();
      saveCache(d.items);
    }).catch(function (e) {
      S.err = e;
      if (!S.loaded) { var c = readCache(); if (c) { S.items = c.items; S.loaded = true; S.offline = true; S.cachedAt = c.at; } }
      else S.offline = false;
    }).then(function () { S.loading = null; renderAll(); });
    S.loading = p;
    if (!quiet && !S.loaded) { S.err = null; renderAll(); }
    return p;
  }

  /* =====================================================================
   * 3. 그림 받기 (작은 그림은 폰에 저장 → 인터넷 없이도 격자가 보임 · 큰 사진은 최근 150장만)
   * ===================================================================*/
  var SMALL_CACHE = 'album-thumbs-v1', BIG_CACHE = 'album-photos-v1', BASE = 'https://album-img.invalid/';
  var IMG = { mem: {}, bigOrder: [], fly: {} };
  function cacheOf(kind) { return kind === 'p' ? BIG_CACHE : SMALL_CACHE; }
  function imgGet(kind, name) {
    var k = kind + ':' + name;
    if (IMG.mem[k]) return Promise.resolve(IMG.mem[k]);
    try {
      if (!global.caches) return Promise.resolve(null);
      return caches.open(cacheOf(kind)).then(function (c) { return c.match(BASE + name); }).then(function (r) { return r ? r.blob() : null; })
        .then(function (b) { return b && b.size ? remember(kind, name, b) : null; }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function remember(kind, name, blob) {
    var k = kind + ':' + name;
    if (IMG.mem[k]) return IMG.mem[k];
    IMG.mem[k] = URL.createObjectURL(blob);
    if (kind === 'p') {                    // 메모리에는 큰 사진을 12장까지만(오래된 것부터 놓아 줌)
      IMG.bigOrder.push(k);
      while (IMG.bigOrder.length > 12) { var old = IMG.bigOrder.shift(); try { URL.revokeObjectURL(IMG.mem[old]); } catch (e) {} delete IMG.mem[old]; }
    }
    return IMG.mem[k];
  }
  function imgPut(kind, name, blob) {
    var u = remember(kind, name, blob);
    try {
      if (global.caches) caches.open(cacheOf(kind)).then(function (c) {
        return c.put(BASE + name, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })).then(function () {
          if (kind !== 'p') return null;
          return c.keys().then(function (ks) { var extra = ks.length - BIG_KEEP; return extra > 0 ? Promise.all(ks.slice(0, extra).map(function (r) { return c.delete(r); })) : null; });   // 오래 전에 본 것부터 지움
        });
      }).catch(function () {});
    } catch (e) {}
    return u;
  }
  function imgFetch(kind, name, url) {
    var k = kind + ':' + name;
    if (IMG.fly[k]) return IMG.fly[k];
    var p = global.fetch(url).then(function (r) { if (!r.ok) throw mkErr('IMG_' + r.status, 'server'); return r.blob(); })
      .then(function (b) { if (!b || !b.size) throw mkErr('IMG_EMPTY', 'server'); return imgPut(kind, name, b); }, function (e) { throw e && e.alb ? e : mkErr('NETWORK', 'net'); });
    IMG.fly[k] = p; var done = function () { delete IMG.fly[k]; }; p.then(done, done);
    return p;
  }
  /* 사진 번호 목록 → {번호: 주소}. 한 번에 50개씩 나눠 물음(서버 함수는 60개까지) */
  function signMany(ids, size) {
    var parts = [], i; for (i = 0; i < ids.length; i += THUMB_BATCH) parts.push(ids.slice(i, i + THUMB_BATCH));
    return Promise.all(parts.map(function (p) { return fileApi({ a: 'sign_thumbs', ids: p, size: size }); })).then(function (rs) {
      var o = {}; rs.forEach(function (r) { var u = r && r.urls || {}; for (var k in u) o[k] = u[k]; }); return o;
    });
  }
  function thFail(el, e) { if (!el || !el.isConnected) return; el.classList.add('fail'); el.setAttribute('data-err', e && e.kind === 'net' ? '인터넷이 필요해요' : '그림을 못 받았어요'); }
  function thShow(el, url) { if (!el || !el.isConnected) return; var im = el.querySelector('img'); if (!im) { im = document.createElement('img'); im.alt = ''; el.insertBefore(im, el.firstChild); } im.src = url; el.classList.add('ok'); el.classList.remove('fail'); }
  /* 격자 칸의 작은 그림 채우기: 폰에 저장된 것 먼저, 없는 것만 서버에 한 번에 물음 */
  function hydrate(root) {
    if (!root) return;
    var els = [].slice.call(root.querySelectorAll('.alb-tile[data-h]'));
    els.forEach(function (e) { e.removeAttribute('data-h'); });
    Promise.all(els.map(function (el) {
      var x = itemById(el.getAttribute('data-id')); if (!x || !x.obj_s) return Promise.resolve(null);
      return imgGet('s', x.obj_s).then(function (u) { if (u) { thShow(el, u); return null; } return { el: el, x: x }; });
    })).then(function (miss) {
      miss = miss.filter(Boolean); if (!miss.length) return;
      if (S.offline || !online()) { miss.forEach(function (m) { thFail(m.el, mkErr('NETWORK', 'net')); }); return; }
      signMany(miss.map(function (m) { return m.x.id; }), 's').then(function (urls) {
        miss.forEach(function (m) {
          var u = urls[m.x.id]; if (!u) { thFail(m.el, mkErr('NO_THUMB', 'nofile')); return; }
          imgFetch('s', m.x.obj_s, u).then(function (bu) { thShow(m.el, bu); }, function (e) { thFail(m.el, e); });
        });
      }).catch(function (e) { miss.forEach(function (m) { thFail(m.el, e); }); });
    });
  }

  /* =====================================================================
   * 4. 화면 그리기
   * ===================================================================*/
  function build() {
    if (built) return; built = true;
    var b = view(); if (!b) return;
    b.innerHTML = '<div class="alb-chips" id="albChips" role="tablist"></div><div id="albMain"></div>';
    var layer = document.createElement('div');
    layer.id = 'albumLayer';
    layer.innerHTML =
      '<div class="alb-fab" id="albFab"><button type="button" class="alb-shuf" data-act="shuffle"><svg aria-hidden="true"><use href="#i-refresh"/></svg>아무거나 보기</button></div>' +
      '<div class="alb-sheet" id="albSheet"><div class="alb-box" id="albBox" role="dialog" aria-modal="true"></div></div>' +
      '<div class="alb-toast" id="albToast" role="status" aria-live="polite"></div>' +
      '<div class="alb-vw" id="albVw" role="dialog" aria-label="사진 크게 보기">' +
        '<div class="alb-vtop"><button type="button" class="alb-vb" data-act="vclose"><svg aria-hidden="true"><use href="#i-x"/></svg>닫기</button><span class="alb-pos" id="albPos"></span><span class="alb-vr">' + (S.save ? '<button type="button" class="alb-vb" id="albDl" data-act="vdl" aria-label="이 사진을 폰에 내려받기"><svg aria-hidden="true"><use href="#i-download"/></svg><span id="albDlT">내려받기</span></button>' : '') + '<button type="button" class="alb-vb sq" data-act="vmenu" aria-label="더 보기"><svg aria-hidden="true"><use href="#i-more"/></svg></button></span></div>' +
        '<div class="alb-menu" id="albMenu"><button type="button" data-act="vok">맞아요 (확인함)</button><button type="button" data-act="vedit">날짜·설명 고치기</button><button type="button" data-act="vtrash">휴지통으로 옮기기</button></div>' +
        '<div class="alb-vst" id="albVst"><button type="button" class="alb-arr l" data-act="prev" aria-label="이전 사진"><svg aria-hidden="true"><use href="#i-chev-l"/></svg></button>' +
          '<div class="alb-vw2" id="albVw2"><img id="albImg" alt="" draggable="false"></div>' +
          '<button type="button" class="alb-arr r" data-act="next" aria-label="다음 사진"><svg aria-hidden="true"><use href="#i-chev-r"/></svg></button>' +
          '<div class="alb-zb"><button type="button" data-act="zout" aria-label="축소">−</button><button type="button" data-act="zin" aria-label="확대">＋</button></div>' +
          '<div class="alb-spin" id="albSpin" role="status"></div></div>' +
        '<div class="alb-cap"><div class="d" id="albD"></div><div class="m" id="albM"></div><div class="h" id="albH"></div></div>' +
      '</div>';
    document.body.appendChild(layer);
    try { S.hint = localStorage.getItem(HKEY) !== '1'; } catch (e) {}
    $('albumView').addEventListener('click', onClick);
    layer.addEventListener('click', onClick);
    $('albSheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
    var gear = $('albumGear'); if (gear) gear.addEventListener('click', openSettings);
    wireZoom();
    try { new MutationObserver(function () { if (!shown()) { hideSheetNow(); closeViewer(true); updateFab(); } }).observe($('albumView'), { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
    document.addEventListener('visibilitychange', function () { if (!document.hidden && shown() && Date.now() - S.lastLoadAt > 60000 && !S.sheet && !S.v.open) load(true); });
    document.addEventListener('keydown', function (e) { if (!S.v.open) return; if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') closeViewer(); });
  }
  function renderAll() { if (!built) return; renderChips(); renderMain(); updateFab(); }
  function countOf(tab) { return listFor(S.items, tab).length; }
  function renderChips() {
    var box = $('albChips'); if (!box) return;
    var left = box.scrollLeft, h = '<button type="button" class="alb-chip' + (S.tab === 'all' ? ' on' : '') + '" data-act="tab" data-t="all" role="tab">전체' + (S.loaded ? ' <small>' + countOf('all') + '</small>' : '') + '</button>';
    STAGES.forEach(function (s) { h += '<button type="button" class="alb-chip' + (S.tab === s ? ' on' : '') + '" data-act="tab" data-t="' + esc(s) + '" role="tab">' + esc(s) + (S.loaded ? ' <small>' + countOf(s) + '</small>' : '') + '</button>'; });
    h += '<button type="button" class="alb-chip' + (S.tab === TREE ? ' on' : '') + '" data-act="tab" data-t="' + TREE + '" role="tab">' + TREE + '</button>';
    if (HEART_ON) h += '<button type="button" class="alb-chip heart' + (S.tab === HEART ? ' on' : '') + '" data-act="tab" data-t="' + HEART + '" role="tab" aria-label="하트 앨범"><span class="hg" aria-hidden="true">' + HEART + '</span>' + (S.loaded ? ' <small>' + countOf(HEART) + '</small>' : '') + '</button>';
    box.innerHTML = h; box.scrollLeft = left;
    var on = box.querySelector('.alb-chip.on'); if (on && !S.chipShown) { S.chipShown = true; box.scrollLeft = Math.max(0, on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2); }
  }
  function tileHtml(x, i) {
    var d = dateInfo(x), lab = d.has ? '<span class="dt">' + esc(d.short) + (d.unc ? ' ?' : '') + '</span>' : (d.unc ? '<span class="dt">?</span>' : '');
    return '<button type="button" class="alb-tile' + (d.unc ? ' unc' : '') + '" data-act="open" data-id="' + esc(x.id) + '" data-i="' + i + '" data-h="1" style="animation-delay:' + ((i % PAGE) * 12) + 'ms" aria-label="' + esc(x.caption) + '"><span class="ph"></span>' + lab + '</button>';
  }
  function lineHtml(list) {
    var n = verifyTargets(list).length, t = S.tab, h = '<span>' + list.length + '장' + (t !== 'all' && t !== TREE && n ? ' · 확인 전 ' + n + '장' : '') + '</span>';
    h += (t !== 'all' && n && !S.offline) ? '<button type="button" class="alb-vfy" data-act="vfy">이 단계 확인함</button>' : '<span></span>';
    return '<div class="alb-line" id="albLine">' + h + '</div>';
  }
  function renderMain() {
    var m = $('albMain'); if (!m) return;
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
    var vw = $('albumView'); if (vw) vw.classList.toggle('alb-calm', calm());
    if (!S.loaded) {
      if (S.loading) { m.innerHTML = '<div class="alb-empty">불러오는 중이에요…</div>'; return; }
      m.innerHTML = '<div class="alb-empty"><b>불러오지 못했어요</b>' + esc(errText(S.err) || '') + '<br><span class="alb-note">저장된 사진은 그대로예요. 0장이라는 뜻이 아니에요.</span><button type="button" class="alb-btn" data-act="reload">다시 시도</button></div>';
      return;
    }
    var list = listFor(S.items, S.tab); S.list = list;
    var h = '';
    if (S.offline) h += '<div class="alb-banner"><span>오프라인 사본 · ' + (S.cachedAt ? fmtDay(S.cachedAt) + ' 기준' : '이전에 불러온 내용') + ' — 이미 본 사진만 보여요. ' + esc(errText(S.err)) + '</span><button type="button" data-act="reload">다시 불러오기</button></div>';
    else if (S.err) h += '<div class="alb-banner"><span>최신으로 못 불러왔어요 — ' + esc(errText(S.err)) + '</span><button type="button" data-act="reload">다시 시도</button></div>';
    h += lineHtml(list);
    if (!list.length) {
      h += '<div class="alb-empty"><b>' + (S.tab === 'all' ? '아직 사진이 없어요' : '이 단계에는 사진이 없어요') + '</b>' + (S.tab === 'all' ? 'PC에서 사진을 올리면 여기에 나타나요.' : '') + '</div>';
      m.innerHTML = h; return;
    }
    var n = Math.min(S.shown, list.length), g = '';
    for (var i = 0; i < n; i++) g += tileHtml(list[i], i);
    h += '<div class="alb-grid" id="albGrid">' + g + '</div><div id="albSentinel" class="alb-sent"></div><div class="alb-end" id="albEnd">' + endText(list, n) + '</div>';
    m.innerHTML = h;
    hydrate(m); watch();
  }
  function endText(list, n) { return n >= list.length ? '끝까지 봤어요 · ' + list.length + '장' : ''; }
  /* 끝에 닿으면 24장 더 — 보이지 않는 표식이 화면 가까이 오면 붙인다 */
  function more() {
    var list = S.list; if (loadingMore || S.shown >= list.length || !$('albGrid')) return;
    loadingMore = true;
    var from = S.shown; S.shown = Math.min(list.length, S.shown + PAGE);
    var h = ''; for (var i = from; i < S.shown; i++) h += tileHtml(list[i], i);
    $('albGrid').insertAdjacentHTML('beforeend', h);
    var e = $('albEnd'); if (e) e.textContent = endText(list, S.shown);
    hydrate($('albGrid'));
    loadingMore = false;
    if (S.shown < list.length) setTimeout(checkSentinel, 60);
  }
  function checkSentinel() { var s = $('albSentinel'); if (!s || !shown()) return; var r = s.getBoundingClientRect(); if (r.top < (global.innerHeight || 800) + 300) more(); }
  function watch() {
    var s = $('albSentinel'); if (!s) return;
    if (typeof IntersectionObserver === 'undefined') { global.addEventListener('scroll', checkSentinel, { passive: true }); setTimeout(checkSentinel, 60); return; }
    io = new IntersectionObserver(function (es) { for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) more(); }, { rootMargin: '300px' });
    io.observe(s);
  }
  function updateFab() {
    var f = $('albFab'); if (!f) return;
    f.classList.toggle('show', shown() && S.loaded && !S.sheet && !S.v.open && countOf('all') > 0);
  }
  function setLine() { var l = $('albLine'); if (l) l.outerHTML = lineHtml(S.list); renderChips(); }

  /* =====================================================================
   * 5. 한 장 크게 보기 (원본 비율 · 좌우 넘기기 · 확대)
   * ===================================================================*/
  var Z = { s: 1, x: 0, y: 0 }, pts = {}, pinch = null, pan = null, swipe = null, lastTap = { t: 0, x: 0, y: 0 };
  function curItem() { return S.v.list[S.v.idx] || null; }
  function openViewer(list, idx, random) {
    if (!list.length) return;
    S.v = { open: true, list: list, idx: idx, random: !!random, tok: S.v.tok + 1 };
    $('albVw').classList.add('show'); $('albMenu').classList.remove('show'); updateFab();
    showPhoto(0);
  }
  function closeViewer(silent) {
    if (!S.v.open) return;
    S.v.open = false; S.v.tok++; $('albVw').classList.remove('show'); $('albMenu').classList.remove('show'); pts = {}; resetZoom(false);
    if (!silent) { renderAll(); }
    updateFab();
  }
  function captionHtml(x) {
    var d = dateInfo(x), parts = [esc(x.stage)];
    if (d.has) parts.push(esc(d.long) + ' <span class="sub">' + (d.user ? '(직접 적은 날짜)' : (d.exif ? '(촬영 기록 기준)' : (d.unc ? '' : '(사진에 찍힌 글자 기준)'))) + '</span>');
    var tags = '';
    if (d.unc) tags += '<span class="tag warn">날짜 불확실</span>';
    else if (d.none) tags += '<span class="tag warn">날짜 모름</span>';
    if (!x.verified) tags += '<span class="tag">확인 전</span>';
    return parts.join(' · ') + tags;
  }
  function showPhoto(dir) {
    var x = curItem(); if (!x) { closeViewer(); return; }
    var box = $('albVw2'), tok = S.v.tok, anim = dir && !calm();
    function paint() {
      if (tok !== S.v.tok) return;
      resetZoom(false);
      $('albD').textContent = x.caption; $('albM').innerHTML = captionHtml(x);
      var d = dateInfo(x), hint = '';
      if (d.unc) hint = '인화 글자 기준이라 실제 촬영일과 다를 수 있어요';
      else if (S.hint) hint = '두 손가락으로 벌리거나 두 번 톡톡 누르면 확대돼요';
      $('albH').textContent = hint;
      $('albPos').textContent = S.v.random ? '무작위 · ' + (S.v.idx + 1) + '번째' : (S.v.idx + 1) + ' / ' + S.v.list.length;
      $('albVw').classList.toggle('first', S.v.idx === 0 && !S.v.random); $('albVw').classList.toggle('last', S.v.idx >= S.v.list.length - 1 && !S.v.random);
      syncDl(); loadBig(x, tok);
    }
    if (anim) { box.classList.add(dir > 0 ? 'out-l' : 'out-r'); setTimeout(function () { box.classList.remove('out-l', 'out-r'); paint(); }, 110); } else paint();
  }
  function setSpin(msg) { var s = $('albSpin'); if (!s) return; s.textContent = msg || ''; s.classList.toggle('show', !!msg); }
  function showBigUrl(u, tok) {
    if (tok !== S.v.tok) return;
    var im = $('albImg'); im.onload = function () { if (tok === S.v.tok) setSpin(''); }; im.onerror = function () { if (tok === S.v.tok) setSpin('사진을 열지 못했어요'); };
    im.src = u; im.classList.add('on');
  }
  /* 지금 사진 + 앞뒤 몇 장의 큰 사진 주소를 한 번에 받아 두고, 지금 것을 먼저 보여 준다 */
  function loadBig(x, tok) {
    var im = $('albImg'); im.classList.remove('on'); im.removeAttribute('src'); setSpin('불러오는 중…');
    var idxs = neighbors(S.v.idx, S.v.list.length, BEHIND, AHEAD), want = idxs.map(function (i) { return S.v.list[i]; });
    if (S.v.random && S.v.list.length - S.v.idx <= AHEAD + 1) extendRandom();
    imgGet('p', x.obj_p).then(function (u) {
      if (tok !== S.v.tok) return;
      if (u) { showBigUrl(u, tok); prefetch(want.slice(1)); return; }
      if (S.offline || !online()) { setSpin('인터넷에 연결되면 이 사진을 볼 수 있어요'); return; }
      Promise.all(want.map(function (w) { return imgGet('p', w.obj_p).then(function (g) { return g ? null : w; }); })).then(function (miss) {
        miss = miss.filter(Boolean); if (!miss.some(function (m) { return m.id === x.id; })) miss.unshift(x);
        return signMany(miss.map(function (m) { return m.id; }), 'p').then(function (urls) {
          if (tok !== S.v.tok) return;
          var u0 = urls[x.id]; if (!u0) throw mkErr('NO_PHOTO', 'nofile');
          imgFetch('p', x.obj_p, u0).then(function (bu) { showBigUrl(bu, tok); }, function (e) { if (tok === S.v.tok) setSpin(errText(e)); });
          miss.forEach(function (m) { if (m.id !== x.id && urls[m.id]) imgFetch('p', m.obj_p, urls[m.id]).catch(function () {}); });
        });
      }).catch(function (e) { if (tok === S.v.tok) setSpin(errText(e)); });
    });
  }
  function prefetch(items) {
    if (S.offline || !online() || !items.length) return;
    Promise.all(items.map(function (w) { return imgGet('p', w.obj_p).then(function (g) { return g ? null : w; }); })).then(function (miss) {
      miss = miss.filter(Boolean); if (!miss.length) return;
      signMany(miss.map(function (m) { return m.id; }), 'p').then(function (urls) { miss.forEach(function (m) { if (urls[m.id]) imgFetch('p', m.obj_p, urls[m.id]).catch(function () {}); }); }).catch(function () {});
    });
  }
  function extendRandom() { var more1 = shuffle(listFor(S.items, 'all')).slice(0, 200); S.v.list = S.v.list.concat(more1); }
  function go(d) {
    if (!S.v.open || Z.s > 1.02) return;
    var n = S.v.idx + d;
    if (n < 0) { toast('맨 앞 사진이에요'); return; }
    if (n >= S.v.list.length) { if (S.v.random) extendRandom(); else { toast('마지막 사진이에요'); return; } }
    S.v.idx = n; $('albMenu').classList.remove('show'); showPhoto(d);
  }
  function shuffleOpen() {
    var all = listFor(S.items, 'all'); if (!all.length) return;
    openViewer(shuffle(all).slice(0, 200), 0, true);
  }

  /* ---- 확대: 두 손가락 · 더블탭 · 끌기 · 마우스 휠 · ＋/－ ---- */
  function imgSize() { var im = $('albImg'); return { w: im.clientWidth || 1, h: im.clientHeight || 1 }; }
  function applyZoom(anim) { var im = $('albImg'); im.classList.toggle('anim', !!anim && !calm()); im.style.transform = 'translate(' + Z.x + 'px,' + Z.y + 'px) scale(' + Z.s + ')'; $('albVw').classList.toggle('zoomed', Z.s > 1.02); }
  function resetZoom(anim) { Z = { s: 1, x: 0, y: 0 }; applyZoom(anim); }
  function setZoom(z, anim) { Z = z; applyZoom(anim); if (Z.s > 1.02 && S.hint) { S.hint = false; try { localStorage.setItem(HKEY, '1'); } catch (e) {} var h = $('albH'); if (h && !dateInfo(curItem() || {}).unc) h.textContent = ''; } }
  function relPoint(e) { var r = $('albVst').getBoundingClientRect(); return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }; }
  function ptCount() { return Object.keys(pts).length; }
  function ptDist() { var k = Object.keys(pts); if (k.length < 2) return 0; var a = pts[k[0]], b = pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
  function ptMid() { var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function tapEnd(e) {
    var p = relPoint(e), now = Date.now(), sz = imgSize();
    if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) { setZoom(toggleZoom(Z, p.x, p.y, sz.w, sz.h), true); lastTap.t = 0; }
    else { lastTap = { t: now, x: p.x, y: p.y }; }
  }
  function wireZoom() {
    var st = $('albVst');
    st.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      try { st.setPointerCapture(e.pointerId); } catch (x) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = ptCount();
      if (n === 2) { pinch = { d: ptDist(), s: Z.s }; swipe = null; pan = null; }
      else if (n === 1) { if (Z.s > 1.02) pan = { x: e.clientX, y: e.clientY, ox: Z.x, oy: Z.y }; else swipe = { x: e.clientX }; }
    });
    st.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return; pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var sz = imgSize();
      if (ptCount() >= 2 && pinch && pinch.d) {
        var m = ptMid(), r = st.getBoundingClientRect();
        setZoom(zoomAt({ s: Z.s, x: Z.x, y: Z.y }, pinch.s * ptDist() / pinch.d, m.x - r.left - r.width / 2, m.y - r.top - r.height / 2, sz.w, sz.h), false);
      } else if (pan) { setZoom(panTo(Z, pan.ox + (e.clientX - pan.x), pan.oy + (e.clientY - pan.y), sz.w, sz.h), false); }
    });
    function end(e) {
      if (!pts[e.pointerId]) return; delete pts[e.pointerId];
      var n = ptCount(); if (n < 2) pinch = null;
      if (n === 0) {
        if (swipe) {
          var dx = e.clientX - swipe.x;
          if (Math.abs(dx) > 60 && Z.s <= 1.02) go(dx < 0 ? 1 : -1);
          else if (Math.abs(dx) < 8) tapEnd(e);
        } else if (pan && Math.abs(e.clientX - pan.x) < 8 && Math.abs(e.clientY - pan.y) < 8) tapEnd(e);
        swipe = null; pan = null;
        if (Z.s <= 1.02) resetZoom(true);
      }
    }
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
    st.addEventListener('wheel', function (e) { e.preventDefault(); var p = relPoint(e), sz = imgSize(); setZoom(zoomAt(Z, Z.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), p.x, p.y, sz.w, sz.h), false); }, { passive: false });
  }
  function zoomBtn(f) { var sz = imgSize(); setZoom(zoomAt(Z, Z.s * f, 0, 0, sz.w, sz.h), true); }

  /* =====================================================================
   * 6. 창(바닥 시트) · 안내 띠
   * ===================================================================*/
  function openSheet(html) { S.sheet = true; $('albBox').innerHTML = html; $('albSheet').classList.add('show'); var bx = $('albBox'); bx.scrollTop = 0; updateFab(); }
  function hideSheetNow() { S.sheet = false; var s = $('albSheet'); if (s) s.classList.remove('show'); }
  function closeSheet() { hideSheetNow(); updateFab(); }
  function undoToast(msg, ms, onUndo) {
    var t = $('albToast'); ms = ms || 8000;
    t.innerHTML = '<div class="tr"><span>' + esc(msg) + '</span><u id="albUndo" role="button" tabindex="0">되돌리기</u></div><div class="pg" id="albPg"></div>';
    t.classList.add('show');
    var pg = $('albPg'); pg.style.transition = calm() ? 'none' : 'transform ' + ms + 'ms linear';
    setTimeout(function () { pg.style.transform = 'scaleX(0)'; }, 30);
    $('albUndo').onclick = function () { clearTimeout(toastTimer); t.classList.remove('show'); onUndo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms);
  }
  function guardWrite() { if (S.offline) { toast('지금은 오프라인 사본이라 고칠 수 없어요. 인터넷이 되면 다시 해 주세요.'); return false; } return true; }

  /* ---- 고치기 ---- */
  function openEdit(id) {
    var x = itemById(id); if (!x || !guardWrite()) return;
    var opts = STAGES.concat([TREE]).concat(HEART_ON ? [HEART] : []).map(function (s) { return '<option value="' + esc(s) + '"' + (s === x.stage ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    var d = dateInfo(x);
    openSheet('<h2>날짜·설명 고치기</h2><div class="alb-note">날짜를 모르면 비워 두세요. 지어내지 않아요.</div>' +
      '<label class="alb-lbl" for="albFC">설명</label><textarea id="albFC" rows="3" maxlength="300">' + esc(x.caption) + '</textarea>' +
      '<label class="alb-lbl" for="albFD">날짜 <small>(예: 1993, 1993-02, 1993-02-22)</small></label><input id="albFD" type="text" inputmode="numeric" autocomplete="off" value="' + esc(x.date_text || '') + '" placeholder="모르면 비워 두기">' +
      '<div class="alb-err" id="albFErr" role="alert"></div>' +
      '<label class="alb-lbl" for="albFS">단계</label><select id="albFS">' + opts + '</select>' +
      (d.unc ? '<div class="alb-note">지금은 「날짜 불확실」로 표시돼 있어요. 날짜를 적으면 「직접 적은 날짜」로 바뀌어요.</div>' : '') +
      '<div class="alb-actions"><button type="button" class="alb-btn" data-act="save" data-id="' + esc(x.id) + '" id="albSave">저장</button><button type="button" class="alb-btn ghost" data-act="sclose">닫기</button></div>');
  }
  function saveEdit(id) {
    var x = itemById(id); if (!x) return;
    var cap = $('albFC').value.trim(), dv = normDateInput($('albFD').value), st = $('albFS').value, er = $('albFErr');
    if (!cap) { er.textContent = '설명을 비워 둘 수는 없어요.'; return; }
    if (!dv.ok) { er.textContent = '날짜 모양이 맞지 않아요. 예: 1993, 1993-02, 1993-02-22'; return; }
    er.textContent = '';
    var row = buildSaveRow(x, { caption: cap, date_text: dv.val, stage: st, verified: true }), btn = $('albSave');
    btn.classList.add('busy');
    rpc('album_save', { p_row: row }).then(function (res) {
      btn.classList.remove('busy');
      if (isObj(res) && res.ok === true) {
        applyRow(x, res.row); saveCache(S.items); closeSheet(); renderAll(); if (S.v.open) { var cur = curItem(); if (cur && cur.id === x.id && cur.stage !== S.tab && S.tab !== 'all') { /* 단계를 옮겼으면 이 목록에서 빠짐 */ } showPhoto(0); }
        toast('저장했어요');
      } else if (isObj(res) && res.err === 'CONFLICT') { closeSheet(); toast('다른 곳에서 먼저 바뀌었어요. 다시 불러왔으니 한 번 더 고쳐 주세요.', 4200); load(true); }
      else { er.textContent = '저장하지 못했어요 — 입력한 값이 받아들여지지 않았어요. 내용을 확인해 주세요. (입력한 내용은 그대로 있어요)'; }
    }).catch(function (e) { btn.classList.remove('busy'); er.textContent = '저장하지 못했어요 — ' + errText(e) + ' (입력한 내용은 그대로 있어요)'; });
  }
  function markOk(id) {
    var x = itemById(id); if (!x || !guardWrite()) return;
    rpc('album_save', { p_row: { id: x.id, base_rev: x.rev, verified: true } }).then(function (res) {
      if (isObj(res) && res.ok === true) { applyRow(x, res.row); saveCache(S.items); if (S.v.open) showPhoto(0); toast('확인함으로 표시했어요'); }
      else { toast('표시하지 못했어요 — 다시 불러온 뒤 해 주세요.'); load(true); }
    }).catch(function (e) { toast('표시하지 못했어요 — ' + errText(e)); });
  }

  /* ---- 내려받기 (v9.70, O-0723) ----
   *   큰 사진(원본 JPEG)의 짧게 유효한 서명 주소를 서버 함수 album-file 에서 받아 → app.js 가 준 save(주소, 파일이름)으로 폰에 저장한다.
   *   폰은 안드로이드 DownloadManager(FileDownload 플러그인)로 「다운로드」 폴더에 둔다 — 실적 PDF·승진 백업과 같은 길. 저장이 끝난 뒤에만 「저장했어요」. */
  function syncDl() {
    var b = $('albDl'), t = $('albDlT'), x = curItem(); if (!b || !t) return;
    var busy = !!(x && dlBusy[x.id]);
    b.classList.toggle('busy', busy); b.disabled = busy; t.textContent = busy ? '받는 중…' : '내려받기';
  }
  function dlWhy(e) {
    if (e && e.alb) return errText(e);
    if (e && e.dlWhy) return softenWhy(e.dlWhy) + '.';
    return '폰에 저장하지 못했어요.';
  }
  function downloadCurrent() {
    var x = curItem(); if (!x || !S.save) return;
    if (dlBusy[x.id]) { toast('이미 받고 있어요'); return; }
    if (!online()) { toast('못 했어요 — ' + errText(mkErr('NETWORK', 'net')), 4200); return; }
    var name = dlName(x); dlBusy[x.id] = 1; syncDl();
    toast('내려받는 중이에요…', 2500);
    function done() { delete dlBusy[x.id]; syncDl(); }
    signMany([x.id], 'p').then(function (urls) {
      var u = urls[x.id]; if (!u) throw mkErr('NO_PHOTO', 'nofile');
      return S.save(u, name);
    }).then(function (r) {
      done(); var where = (r && r.where) || '다운로드 폴더', nm = (r && r.name) || name;
      toast('저장했어요 (' + where + ' · ' + nm + ')', 5200);
    }, function (e) { done(); toast('못 했어요 — ' + dlWhy(e), 5200); });
  }

  /* ---- 휴지통 ---- */
  function trashItem(id) {
    var x = itemById(id); if (!x || !guardWrite()) return;
    rpc('album_trash', { p_id: id, p_restore: false }).then(function (ok) {
      if (ok !== true) { toast('옮기지 못했어요 — 다시 불러온 뒤 해 주세요.'); load(true); return; }
      x.deleted_at = new Date().toISOString(); x.rev = (x.rev || 1) + 1; saveCache(S.items);
      if (S.v.open) { var i = S.v.idx; S.v.list.splice(i, 1); if (!S.v.list.length) closeViewer(); else { if (i >= S.v.list.length) S.v.idx = S.v.list.length - 1; showPhoto(0); } }
      renderAll();
      undoToast('휴지통으로 옮겼습니다', 8000, function () { restoreItem(id, true); });
    }).catch(function (e) { toast('옮기지 못했어요 — ' + errText(e)); });
  }
  function restoreItem(id, fromUndo) {
    var x = itemById(id); if (!x) return;
    rpc('album_trash', { p_id: id, p_restore: true }).then(function (ok) {
      if (ok !== true) { toast('되돌리지 못했어요 — 다시 불러올게요.'); load(true); return; }
      x.deleted_at = null; x.rev = (x.rev || 1) + 1; saveCache(S.items); renderAll(); toast(fromUndo ? '되돌렸어요' : '되살렸어요');
      if ($('albBox') && S.sheet && !fromUndo) openTrash();
    }).catch(function (e) { toast('되돌리지 못했어요 — ' + errText(e)); });
  }
  function openTrash() {
    var l = S.items.filter(function (x) { return !!x.deleted_at; }).sort(byOrd), h = '<h2>휴지통</h2><div class="alb-note">여기서 지우면 사진 파일까지 영구히 사라져요. 되돌릴 수 없어요.</div>';
    if (!l.length) h += '<div class="alb-empty sm">휴지통이 비어 있어요</div>';
    l.forEach(function (x) { h += '<div class="alb-trow"><div class="c"><b>' + esc(x.caption) + '</b><small>' + esc(x.stage) + (x.date_text ? ' · ' + esc(dateLong(x.date_text)) : '') + (x.data && x.data.purged_at ? ' · 파일은 이미 지워졌어요' : '') + '</small></div><button type="button" class="alb-btn sm ghost" data-act="restore" data-id="' + esc(x.id) + '">되살리기</button><button type="button" class="alb-btn sm danger" data-act="purge1" data-id="' + esc(x.id) + '">영구 삭제…</button></div>'; });
    h += '<div class="alb-actions"><button type="button" class="alb-btn ghost" data-act="settings">뒤로</button></div>';
    openSheet(h);
  }
  function purgeItem(id, btn) {
    if (!guardWrite()) return;
    if (btn.getAttribute('data-sure') !== '1') { btn.setAttribute('data-sure', '1'); btn.textContent = '정말 영구 삭제'; setTimeout(function () { if (btn.isConnected) { btn.removeAttribute('data-sure'); btn.textContent = '영구 삭제…'; } }, 5000); return; }
    btn.classList.add('busy');
    fileApi({ a: 'purge', id: id }).then(function () {       // 저장소 파일을 먼저 지운다 — 실패하면 여기서 멈춤(표에서 지우지 않음)
      return rpc('album_purge', { p_id: id });
    }).then(function (ok) {
      if (ok === true) { S.items = S.items.filter(function (x) { return x.id !== id; }); saveCache(S.items); renderAll(); toast('영구히 지웠어요'); openTrash(); }
      else { btn.classList.remove('busy'); toast('사진 파일은 지웠지만 목록에서 지우지 못했어요. 다시 눌러 주세요.'); }
    }).catch(function (e) { btn.classList.remove('busy'); toast('영구 삭제를 하지 못했어요 — ' + errText(e) + ' (사진은 휴지통에 그대로 있어요)', 4200); });
  }

  /* ---- 「이 단계 확인함」 ---- */
  function askVerify() {
    if (!guardWrite()) return;
    var ids = verifyTargets(S.list); if (!ids.length) return;
    var name = S.tab;
    openSheet('<h2>' + esc(name) + ' ' + ids.length + '장을 모두 확인한 것으로 표시할까요?</h2><div class="alb-note">설명이 틀린 사진은 나중에 고치면 돼요. 사진을 한 장씩 확인하지 않아도 됩니다.</div>' +
      '<div class="alb-actions"><button type="button" class="alb-btn" data-act="vfyyes" id="albVfyYes">표시하기</button><button type="button" class="alb-btn ghost" data-act="sclose">취소</button></div>');
  }
  function setVerified(ids, val, done) {
    rpc('album_set_verified', { p_ids: ids, p_value: val }).then(function (res) {
      if (isObj(res) && res.ok === true) { var set = {}; ids.forEach(function (i) { set[i] = 1; }); S.items.forEach(function (x) { if (set[x.id] && !x.deleted_at) { x.verified = val; x.rev = (x.rev || 1) + 1; } }); saveCache(S.items); renderAll(); done(null, res); }
      else done(new Error('bad'));
    }).catch(function (e) { done(e); });
  }
  function doVerify() {
    var ids = verifyTargets(S.list); if (!ids.length) { closeSheet(); return; }
    var b = $('albVfyYes'); if (b) b.classList.add('busy');
    setVerified(ids, true, function (err) {
      closeSheet();
      if (err) { toast('표시하지 못했어요 — ' + (err.alb ? errText(err) : '다시 시도해 주세요.')); return; }
      undoToast(ids.length + '장을 확인함으로 표시했어요', 8000, function () { setVerified(ids, false, function (e2) { toast(e2 ? '되돌리지 못했어요 — 다시 시도해 주세요.' : '되돌렸어요'); }); });
    });
  }

  function openSettings() {
    var n = S.items.filter(function (x) { return !!x.deleted_at; }).length, tot = S.items.filter(isLive).length;
    openSheet('<h2>사진첩 설정</h2><div class="alb-note">사진 ' + tot + '장이 비공개 서버에 있어요. ' + (S.save ? '내려받기는 큰 보기의 내려받기 단추로 합니다(카톡 공유 단추는 없어요).' : '사진 내려받기·공유 단추는 없고, 원본은 PC에 있어요.') + '</div>' +
      '<button type="button" class="alb-setrow" data-act="trash"><span>휴지통</span><small>' + n + '장 · 되살리거나 영구히 지우기</small></button>' +
      '<div class="alb-actions"><button type="button" class="alb-btn ghost" data-act="sclose">닫기</button></div>');
  }

  /* =====================================================================
   * 7. 누름 처리
   * ===================================================================*/
  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null; if (!t) return;
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    switch (a) {
      case 'tab': S.tab = t.getAttribute('data-t'); S.shown = PAGE; S.chipShown = false; renderAll(); try { global.scrollTo(0, 0); } catch (x) {} break;
      case 'open': var i = +t.getAttribute('data-i'); openViewer(S.list.slice(), i, false); break;
      case 'shuffle': shuffleOpen(); break;
      case 'reload': load(false); break;
      case 'vfy': askVerify(); break;
      case 'vfyyes': doVerify(); break;
      case 'vclose': closeViewer(); break;
      case 'vdl': $('albMenu').classList.remove('show'); downloadCurrent(); break;
      case 'vmenu': $('albMenu').classList.toggle('show'); break;
      case 'prev': go(-1); break;
      case 'next': go(1); break;
      case 'zin': zoomBtn(1.5); break;
      case 'zout': zoomBtn(1 / 1.5); break;
      case 'vok': $('albMenu').classList.remove('show'); if (curItem()) markOk(curItem().id); break;
      case 'vedit': $('albMenu').classList.remove('show'); if (curItem()) openEdit(curItem().id); break;
      case 'vtrash': $('albMenu').classList.remove('show'); if (curItem()) trashItem(curItem().id); break;
      case 'save': saveEdit(id); break;
      case 'sclose': closeSheet(); break;
      case 'settings': openSettings(); break;
      case 'trash': openTrash(); break;
      case 'restore': restoreItem(id, false); break;
      case 'purge1': purgeItem(id, t); break;
    }
  }

  /* =====================================================================
   * 8. app.js 와 만나는 곳
   * ===================================================================*/
  function init(o) {
    if (o && o.toast) _toast = o.toast;
    HEART_ON = !(o && o.heart === false);                              // v9.77: 스위치 ALBUM_HEART 'off' → heart:false
    S.save = (o && typeof o.save === 'function') ? o.save : null;      // v9.70: 없으면(스위치 ALBUM_DL 'off'·옛 연결) 내려받기 단추가 없다 — v9.69 와 같음
    if (global.AchPure && AchPure.makeRpc) rpc = AchPure.makeRpc({ cfg: cfg, pass: syncPass, needPass: needPass, fetch: function () { return global.fetch.apply(global, arguments); } });
    build();
  }
  function open() {
    build(); S.tab = 'all'; S.shown = PAGE; S.chipShown = false;
    renderAll(); load(S.loaded);
  }
  /* 뒤로 가기: 큰 보기·창이 열려 있으면 그것부터 닫는다. true = 여기서 처리함 */
  function back() {
    if (S.sheet) { closeSheet(); return true; }
    if (S.v.open) { if ($('albMenu').classList.contains('show')) { $('albMenu').classList.remove('show'); return true; } closeViewer(); return true; }
    return false;
  }
  global.AlbumTab = { init: init, open: open, back: back };
})(typeof window !== 'undefined' ? window : globalThis);
