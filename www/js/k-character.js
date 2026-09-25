/* ============================================================================
 * k-character.js — 소장 「케이」 캐릭터(얼굴·표정·움직임·옷장·목소리) v6.0 1차
 * ----------------------------------------------------------------------------
 * 데이터 기반: 옷 목록은 assets/k/wardrobe.json 한 파일만 읽는다.
 *   옷을 늘리려면 에셋 폴더(assets/k/<옷id>/)와 wardrobe.json 만 바꾸면 되고 코드는 그대로다.
 *   (에셋 생성 도구: Claude Code\apps\k-character\tools\build_app_assets.py)
 *
 * 화면 곳곳의 케이 얼굴은 <span class="kface" data-kface="head|home|profile|wardrobe"> 자리표시.
 *   KChar.mount() 가 안에 [정지 사진 <img>] + [반복 영상 <video muted loop playsinline>] 을 채운다.
 *   - 평소: idle 반복영상(실패·저전력·움직임 끔 → 정지 사진)
 *   - 케이 목소리 재생 중: talk 영상(없으면 사진이 살짝 움직이는 CSS)
 *   - 새 답장 도착: 그 답의 표정 사진을 잠깐(약 7초) 보여 준 뒤 idle 로 복귀
 *
 * ⭐ 표정 규칙은 아래 EXPR_RULES 한 곳에만 있다(위에서부터 먼저 걸리는 것 적용). 고칠 땐 여기만.
 *
 * (O-0040) 머리 스타일 + 서버 카탈로그
 *   - 번들(assets/k/wardrobe.json) = 옷 10벌 × 기본머리(h01). 표정 5종·idle/talk 영상은 이것만 있다.
 *   - 서버 카탈로그(Supabase 공개 버킷 kchar/catalog.json) = 머리 목록 + 머리×옷 조합 사진 + (앞으로) 새 옷.
 *     읽기 실패·오프라인이면 번들만으로 지금과 똑같이 동작한다(머리는 「기본 단발」 하나만 보임).
 *   - 기본머리가 아닐 때는 조합 「정지 사진」 한 장을 쓴다: 표정 변화·idle/talk 영상 없음,
 *     목소리 재생 중엔 사진이 살짝 끄덕이는 CSS(kf-talkstill). 조합 사진이 없거나 못 읽으면 기본머리 사진으로 대신 보인다.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------------- 표정 규칙(여기만 고치면 됨) ---------------- */
  // 띄어쓰기는 무시하고 비교한다("진행중"=“진행 중”). 위에서부터 첫 번째로 걸린 표정을 쓴다.
  // 부정 표현이 '완료' 계열보다 먼저 걸리게 둔다: "완료하지 못해 죄송합니다" → concern, "완료했습니다" → cheer
  var EXPR_RULES = [
    // '못'은 넓게 걸려("잘못 보내셨네요"·"못지않게") 동사형으로만 좁혔다
    { expr: 'concern',  words: ['못 했', '못했', '못해', '못하', '못 하', '실패', '오류', '죄송', '문제', '지연', '보류'] },
    { expr: 'cheer',    words: ['완료', '끝났', '축하'] },
    { expr: 'thinking', words: ['진행 중', '작업 중', '확인 중', '맡겼'] },
    { expr: 'smile',    words: ['좋은', '됐습니다', '반갑'] }
  ];
  var DEFAULT_EXPR = 'neutral';
  function exprFor(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (!t) return DEFAULT_EXPR;
    for (var i = 0; i < EXPR_RULES.length; i++) {
      var r = EXPR_RULES[i];
      for (var j = 0; j < r.words.length; j++) {
        if (t.indexOf(r.words[j].replace(/\s+/g, '')) !== -1) return r.expr;
      }
    }
    return DEFAULT_EXPR;
  }

  /* ---------------- 옷장 데이터 ---------------- */
  var BASE = 'assets/k/';
  var OUTFIT_KEY = 'smart_k_outfit';
  var MOTION_KEY = 'smart_k_motion';     // '0' = 움직임 끔(정지 사진만)
  var VOICE_KEY = 'smart_k_voice';       // '' = 케이 기본 목소리(PC 생성 · 선희) / 그 외 = 기기 음성 이름
  // wardrobe.json 을 못 읽어도(오프라인·오류) 앱이 깨지지 않게 최소 기본값
  var FALLBACK = { version: 1, default: 'burgundy_suit', outfits: [{ id: 'burgundy_suit', name: '버건디 정장',
    expr: { neutral: 'expr_neutral.jpg' }, avatar: { neutral: 'av_neutral.jpg' }, thumb: 'thumb.jpg', idle: 'idle.mp4', talk: 'talk.mp4' }] };
  var data = { default: FALLBACK.default, outfits: FALLBACK.outfits.map(function (o) { return normOutfit(o); }) };
  var curId = '', listeners = [];
  var bundled = [];                        // 번들(wardrobe.json) 옷 — 서버 카탈로그를 다시 적용해도 중복되지 않게 따로 둔다

  /* ---- 머리 + 서버 카탈로그 ---- */
  var HAIR_KEY = 'smart_k_hair';
  var CAT_CACHE_KEY = 'smart_k_catalog_cache';     // 마지막으로 읽은 카탈로그(JSON) — 다음 실행 때 먼저 적용
  var CAT_URL_KEY = 'smart_k_catalog_url';         // 시험용 덮어쓰기(비우면 기본 주소, 'off' 면 서버 안 읽음)
  var CATALOG_URL = 'https://nasizwclypmaojvwfxnn.supabase.co/storage/v1/object/public/kchar/catalog.json';
  var DEFAULT_HAIR = 'h01';
  var BUNDLED_HAIRS = [{ id: DEFAULT_HAIR, name: '기본 단발', desc: '앞머리 있는 단발 · 표정·움직임 전부 지원', thumb: '' }];
  var hairsList = BUNDLED_HAIRS.slice();
  var combos = {};                         // 'h02|burgundy_suit' → {img, av, thumb, crop}
  var broken = {};                         // 못 읽은 서버 사진 → 기본머리/기본옷으로 대신
  var urlIndex = {};                       // 서버 사진 주소 → broken 키(이미지 오류 때 찾기)
  var curHair = lsGet(HAIR_KEY) || DEFAULT_HAIR;
  var catState = { source: 'bundle', url: '', error: '', at: 0 };
  var lastExpr = DEFAULT_EXPR, flashTimer = null, flashing = '', talking = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  function normOutfit(o, base) {
    // wardrobe.json 이 '원본 규격'(base.png·avatar.png·expr_*_1024.png·loop_*_small.mp4)이어도 읽히게 기본 파일명을 채운다
    if (!o || !o.id) return null;
    var n = { id: String(o.id), name: o.name || o.name_ko || o.label || o.id, desc: o.desc || '', category: o.category || '', crop: o.crop || null, expr: {}, avatar: {},
      base: base || (BASE + encodeURIComponent(String(o.id)) + '/'), remote: !!base };
    var ex = o.expr || o.expressions || null;
    if (ex && !Array.isArray(ex)) n.expr = ex;
    else {
      var keys = Array.isArray(ex) ? ex : ['neutral'];
      keys.forEach(function (e) { n.expr[e] = 'expr_' + e + '_1024.png'; });
      if (!n.expr.neutral) n.expr.neutral = o.base || 'base.png';
    }
    n.avatar = o.avatar && typeof o.avatar === 'object' ? o.avatar : {};
    if (typeof o.avatar === 'string') n.avatar = { neutral: o.avatar };
    if (!n.avatar.neutral && !(o.expr && !Array.isArray(o.expr))) n.avatar.neutral = 'avatar.png';
    n.thumb = o.thumb || (o.expr && !Array.isArray(o.expr) ? n.expr.neutral : 'thumb.png');
    n.idle = o.idle === undefined ? (o.expr && !Array.isArray(o.expr) ? '' : 'loop_idle_small.mp4') : (o.idle || '');
    n.talk = o.talk === undefined ? (o.expr && !Array.isArray(o.expr) ? '' : 'loop_talk_small.mp4') : (o.talk || '');
    return n;
  }
  function setData(d) {
    var arr = Array.isArray(d) ? d : (d && d.outfits) || [];
    var outs = arr.map(function (o) { return normOutfit(o); }).filter(Boolean);
    if (!outs.length) return;
    bundled = outs;
    data = { default: (d && d.default) || outs[0].id, outfits: outs.slice() };
    resolveCur();
  }
  // 저장된 옷이 (아직) 목록에 없으면 기본 옷을 입히되 저장값은 지우지 않는다 — 서버 옷은 카탈로그를 읽은 뒤 찾아진다
  function resolveCur() {
    var saved = lsGet(OUTFIT_KEY);
    curId = findOutfit(saved) ? saved : (findOutfit(data.default) ? data.default : data.outfits[0].id);
  }
  function findOutfit(id) {
    for (var i = 0; i < data.outfits.length; i++) if (data.outfits[i].id === id && !broken['o|' + id]) return data.outfits[i];
    return null;
  }
  function outfit() { return findOutfit(curId) || findOutfit(data.default) || data.outfits[0]; }
  function isAbs(f) { return /^(https?:|data:|blob:)/i.test(f); }
  function url(o, file) { return file ? (isAbs(file) ? file : o.base + file) : ''; }
  function comboFor(hairId, outfitId) {
    if (!hairId || hairId === DEFAULT_HAIR) return null;
    var k = hairId + '|' + outfitId, c = combos[k];
    return (c && !broken[k]) ? c : null;
  }
  // 지금 보이는 조합 사진(기본머리이거나 조합이 없으면 null → 기존 옷 사진·표정·영상)
  function activeCombo() { return comboFor(curHair, outfit().id); }
  function isCur(o) { return !o || o.id === outfit().id; }
  function exprUrl(e, o) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return cb.img;
    o = o || outfit(); return url(o, o.expr[e] || o.expr.neutral);
  }
  // 작은 원형 얼굴용: 얼굴 쪽으로 자른 사진(av_*). 없으면 전체 사진(CSS 로 확대)
  function avatarUrl(e, o) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return cb.av || cb.img;
    o = o || outfit();
    var f = o.avatar[e] || o.avatar.neutral;
    return f ? url(o, f) : exprUrl(e, o);
  }
  function hasCrop(o, e) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return !!cb.av;
    o = o || outfit(); return !!(o.avatar[e] || o.avatar.neutral);
  }
  // 옷장 썸네일: 지금 머리로 입은 모습(조합 사진이 있으면), 없으면 기본머리 사진
  function thumbUrl(o) {
    o = o || outfit();
    var cb = comboFor(curHair, o.id);
    if (cb) return cb.thumb || cb.img;
    return url(o, o.thumb || o.expr.neutral);
  }

  /* ---- 머리 ---- */
  function findHair(id) { for (var i = 0; i < hairsList.length; i++) if (hairsList[i].id === id) return hairsList[i]; return null; }
  // 저장된 머리가 (아직) 목록에 없으면 기본머리로 보이되 저장값은 지우지 않는다
  function hair() { return findHair(curHair) || hairsList[0]; }
  // 머리 목록 썸네일: 지금 옷으로 한 모습 → 없으면 그 머리 대표 사진 → 기본머리면 지금 옷 사진
  function hairThumbUrl(h) {
    h = h || hair();
    var cb = comboFor(h.id, outfit().id);
    if (cb) return cb.thumb || cb.img;
    if (h.id === DEFAULT_HAIR || !h.thumb || broken['h|' + h.id]) {
      var o = outfit(); return url(o, o.thumb || o.expr.neutral);
    }
    return h.thumb;
  }
  function hasLook(hairId, outfitId) { return hairId === DEFAULT_HAIR || !!comboFor(hairId, outfitId || outfit().id); }
  function setHair(id) {
    if (!findHair(id) || id === hair().id) return false;
    curHair = id; lsSet(HAIR_KEY, id === DEFAULT_HAIR ? null : id);
    refreshAll(true); notify();
    return true;
  }
  function stillMode() { return !!activeCombo(); }

  /* ---- 서버 카탈로그 ----
   * catalog.json 형식(voice-memo-collector\kchar_publish.py 가 만든다, 경로는 catalog.json 기준 상대):
   *   { version, updated, hairs:[{id,name,desc,thumb}], outfits:[{id,name,category,dir,thumb,expr,avatar,crop}],
   *     combos:[{hair,outfit,img,av,thumb}] }
   *   - outfits 에는 번들에 없는 「새 옷」만 넣는다(번들 옷과 id 가 같으면 번들이 이긴다 — 영상·표정이 있으므로). */
  function catalogUrl() {
    var o = lsGet(CAT_URL_KEY);
    if (o === 'off') return '';
    return o || CATALOG_URL;
  }
  function applyCatalog(cat, catUrl) {
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) return false;
    var baseUrl = String(catUrl).replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    function abs(p) { return !p ? '' : (isAbs(String(p)) ? String(p) : baseUrl + String(p).replace(/^\/+/, '')); }
    var nHairs = BUNDLED_HAIRS.map(function (h) { return { id: h.id, name: h.name, desc: h.desc, thumb: '' }; });
    var seen = {}, nIndex = {};
    (Array.isArray(cat.hairs) ? cat.hairs : []).forEach(function (h) {
      if (!h || !h.id) return;
      var id = String(h.id);
      if (id === DEFAULT_HAIR) {                 // 기본머리는 이름·설명만 서버 값으로 바꿀 수 있다
        if (h.name) nHairs[0].name = String(h.name);
        if (h.desc) nHairs[0].desc = String(h.desc);
        return;
      }
      if (seen[id]) return; seen[id] = 1;
      var t = abs(h.thumb); if (t) nIndex[t] = 'h|' + id;
      nHairs.push({ id: id, name: String(h.name || id), desc: String(h.desc || ''), thumb: t });
    });
    var ids = {}; bundled.forEach(function (o) { ids[o.id] = 1; });
    var remote = [];
    (Array.isArray(cat.outfits) ? cat.outfits : []).forEach(function (o) {
      if (!o || !o.id || ids[o.id]) return;
      var dir = abs(o.dir || ('outfits/' + encodeURIComponent(String(o.id)) + '/'));
      if (dir.slice(-1) !== '/') dir += '/';
      var n = normOutfit(o, dir);
      if (!n) return;
      n.idle = ''; n.talk = '';                  // 서버 옷은 정지 사진만(영상은 번들 옷에만)
      [url(n, n.thumb), url(n, n.expr.neutral), url(n, n.avatar.neutral)].forEach(function (u) { if (u) nIndex[u] = 'o|' + n.id; });
      ids[n.id] = 1; remote.push(n);
    });
    var nCombos = {};
    (Array.isArray(cat.combos) ? cat.combos : []).forEach(function (c) {
      if (!c || !c.hair || !c.outfit || !c.img || String(c.hair) === DEFAULT_HAIR) return;
      var k = String(c.hair) + '|' + String(c.outfit);
      var e = { img: abs(c.img), av: abs(c.av), thumb: abs(c.thumb), crop: c.crop || null,
                idle: abs(c.idle) };               // (O-0042/O-0043) 조합 idle 영상 — 있는 조합만(지금은 h02 긴생머리 × 옷 10벌). 없으면 정지 사진
      [e.img, e.av, e.thumb].forEach(function (u) { if (u) nIndex[u] = k; });
      nCombos[k] = e;
    });
    hairsList = nHairs; combos = nCombos; urlIndex = nIndex;
    data = { default: data.default, outfits: bundled.concat(remote) };
    resolveCur();
    return true;
  }
  function loadCatalog() {
    var cu = catalogUrl();
    if (!cu) { catState = { source: 'bundle', url: '', error: '서버 목록 끔', at: Date.now() }; return Promise.resolve(false); }
    // 1) 지난번에 읽어 둔 카탈로그를 먼저(빠른 첫 화면) 2) 서버에서 새로 읽어 덮어쓴다
    try {
      var c = JSON.parse(lsGet(CAT_CACHE_KEY) || 'null');
      if (c && c.url === cu && c.cat && applyCatalog(c.cat, cu)) {
        catState = { source: 'cache', url: cu, error: '', at: c.at || 0 };
        refreshAll(true); notify();
      }
    } catch (e) {}
    var timer = null;
    var to = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error('시간 초과')); }, 8000); });
    return Promise.race([fetch(cu, { cache: 'no-store' }), to])
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (cat) {
        clearTimeout(timer);
        if (!applyCatalog(cat, cu)) throw new Error('형식 오류');
        catState = { source: 'server', url: cu, error: '', at: Date.now() };
        lsSet(CAT_CACHE_KEY, JSON.stringify({ url: cu, at: Date.now(), cat: cat }));
        refreshAll(true); notify();
        return true;
      })
      .catch(function (e) {
        clearTimeout(timer);
        var msg = String((e && e.message) || e);
        if (catState.source === 'cache') catState.error = msg;
        else catState = { source: 'bundle', url: cu, error: msg, at: Date.now() };
        console.warn('[케이] 서버 옷장 목록 읽기 실패 — 앱에 든 옷장으로:', e);
        return false;
      });
  }
  // 서버 사진이 안 열리면(오프라인·삭제) 그 조합/머리/옷을 「못 읽음」으로 두고 기본 사진으로 다시 그린다
  document.addEventListener('error', function (ev) {
    var t = ev.target;
    if (!t || t.tagName !== 'IMG') return;
    var k = urlIndex[t.getAttribute('src') || ''];
    if (!k || broken[k]) return;
    broken[k] = true;
    refreshAll(true); notify();
  }, true);

  var ready = fetch(BASE + 'wardrobe.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) { setData(d); })
    .catch(function (e) { console.warn('[케이] wardrobe.json 읽기 실패 — 기본 옷으로:', e); setData(FALLBACK); })
    .then(function () { refreshAll(); notify(); });
  var catalogReady = ready.then(loadCatalog);

  function setOutfit(id) {
    if (!findOutfit(id) || id === outfit().id) return false;
    curId = id; lsSet(OUTFIT_KEY, id);
    refreshAll(true); notify();
    return true;
  }
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { try { fn(outfit()); } catch (e) {} }); }

  /* ---------------- 움직임(저전력·실패 시 정지 사진) ---------------- */
  var lowPower = false;
  try {
    if (navigator.connection && navigator.connection.saveData) lowPower = true;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) lowPower = true;
    if (navigator.getBattery) navigator.getBattery().then(function (b) {
      function chk() { var lp = (!b.charging && b.level <= 0.15); if (lp !== batLow) { batLow = lp; refreshAll(); } }
      chk(); b.addEventListener('levelchange', chk); b.addEventListener('chargingchange', chk);
    }).catch(function () {});
  } catch (e) {}
  var batLow = false;
  function motionPref() { return lsGet(MOTION_KEY) !== '0'; }
  function setMotionPref(on) { lsSet(MOTION_KEY, on ? null : '0'); refreshAll(); }
  function motionOn() { return motionPref() && !lowPower && !batLow; }
  function motionBlockReason() {
    if (!motionPref()) return '움직임 꺼 둠';
    if (lowPower) return '절전·데이터 절약 모드';
    if (batLow) return '배터리 부족(15% 이하)';
    return '';
  }

  /* ---------------- 얼굴 자리표시 채우기 ---------------- */
  var io = null;
  try {
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { en.target._kVisible = en.isIntersecting; syncVideo(en.target); });
    });
  } catch (e) { io = null; }

  function build(el) {
    if (el._kBuilt) return;
    el._kBuilt = true;
    var img = document.createElement('img');
    img.className = 'kf-img'; img.alt = '케이'; img.decoding = 'async'; img.draggable = false;
    var vid = document.createElement('video');
    vid.className = 'kf-vid'; vid.muted = true; vid.defaultMuted = true; vid.loop = true;
    vid.setAttribute('muted', ''); vid.setAttribute('playsinline', ''); vid.setAttribute('webkit-playsinline', '');
    vid.setAttribute('disablepictureinpicture', ''); vid.preload = 'auto';
    vid.addEventListener('playing', function () { el.classList.add('vid-on'); });
    vid.addEventListener('error', function () { markFail(el, vid.getAttribute('data-kind')); });
    el.appendChild(img); el.appendChild(vid);
    el._kVisible = true;
    if (io) io.observe(el);
  }
  function markFail(el, kind) {
    el._kFail = el._kFail || {};
    if (kind) el._kFail[kind + '|' + curId + (activeCombo() ? '|' + curHair : '')] = true;
    el.classList.remove('vid-on');
    syncVideo(el);
  }
  function wideFace(el) { return el.getAttribute('data-kface') === 'profile' || el.getAttribute('data-kface') === 'wardrobe'; }
  function paint(el) {
    build(el);
    var o = outfit(), e = flashing || lastExpr;
    if (wideFace(el)) e = flashing || DEFAULT_EXPR;
    var img = el.querySelector('.kf-img'), vid = el.querySelector('.kf-vid');
    var src = wideFace(el) ? exprUrl(e) : avatarUrl(e);
    el.classList.toggle('kf-crop', !wideFace(el) && !hasCrop(o, e));   // 잘린 얼굴사진이 없으면 전체사진을 CSS로 확대
    // 옷마다 원형 구도가 다를 수 있다(예: 오프숄더는 아래로 넓게) → 영상 확대 비율·중심도 그 옷 값으로
    var cb = activeCombo();
    var c = (cb && cb.crop) || o.crop || {};
    el.classList.toggle('kf-still', !!cb);                            // 기본머리 외: 조합 정지 사진 고정(표정·영상 없음)
    el.style.setProperty('--kscale', String(c.scale || 1.35));
    el.style.setProperty('--kox', (c.ox != null ? c.ox : 50) + '%');
    el.style.setProperty('--koy', (c.oy != null ? c.oy : 49) + '%');
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    var poster = exprUrl(DEFAULT_EXPR);
    if (vid.getAttribute('poster') !== poster) vid.setAttribute('poster', poster);
    syncVideo(el);
  }
  function syncVideo(el) {
    var vid = el.querySelector && el.querySelector('.kf-vid'); if (!vid) return;
    var o = outfit(), cb = activeCombo(), still = !!cb;
    var kind = talking ? 'talk' : 'idle';
    var file = still ? '' : o[kind];                                  // 기본머리 외 조합 = 영상 없음(정지 사진)
    // (O-0042) 조합에 idle 영상이 있으면 평소엔 그것을 반복 재생. 말하는 중엔 기존대로 정지 사진 + 끄덕임 CSS
    if (still && !talking && cb.idle) file = cb.idle;
    if (talking && !file && !still) { kind = 'idle'; file = o.idle; } // talk 영상 없는 옷 → idle + CSS 입 모양 효과
    el.classList.toggle('kf-talk', talking);
    el.classList.toggle('kf-talkstill', talking && (still || !o.talk));
    var fkey = kind + '|' + curId + (still ? '|' + curHair : '');
    var failed = el._kFail && el._kFail[fkey];
    var want = !!file && !failed && !el._kHold && motionOn() && !flashing && el._kVisible !== false && !document.hidden;
    if (!want) {
      el.classList.remove('vid-on');
      if (!vid.paused) try { vid.pause(); } catch (e) {}
      return;
    }
    var src = still ? file : url(o, file);
    if (vid.getAttribute('src') !== src) {
      el.classList.remove('vid-on');
      vid.setAttribute('data-kind', kind);
      vid.setAttribute('src', src);
      try { vid.load(); } catch (e) {}
    }
    if (vid.paused) {
      var p; try { p = vid.play(); } catch (e) { markFail(el, kind); return; }
      if (p && p.catch) p.catch(function (err) {
        // 자동재생 거부(제스처 필요 등)면 정지 사진 유지. 네트워크 오류는 error 이벤트에서 처리.
        if (err && err.name === 'NotAllowedError') el.classList.remove('vid-on');
      });
    } else if (vid.readyState >= 2) el.classList.add('vid-on');
  }
  function faces() { return Array.prototype.slice.call(document.querySelectorAll('.kface[data-kface]')); }
  function refreshAll(outfitChanged) {
    faces().forEach(function (el) {
      if (outfitChanged) { el._kFail = null; }
      paint(el);
    });
    if (outfitChanged) {                        // 채팅 말풍선 아바타도 새 옷으로
      Array.prototype.forEach.call(document.querySelectorAll('img.kav[data-kexpr]'), function (im) {
        im.setAttribute('src', avatarUrl(im.getAttribute('data-kexpr')));
      });
    }
  }
  document.addEventListener('visibilitychange', function () { faces().forEach(syncVideo); });

  /* ---------------- 표정·말하기 상태 ---------------- */
  // 마지막 케이 답의 표정. flash=true 면 새 답장 → 표정 사진을 잠깐 보여 준 뒤 idle 영상으로 복귀.
  function setExpr(e, flash) {
    e = e || DEFAULT_EXPR;
    lastExpr = e;
    if (flash && e !== DEFAULT_EXPR && !talking) {
      flashing = e;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { flashing = ''; flashTimer = null; faces().forEach(paint); }, 7000);
    }
    faces().forEach(paint);
  }
  function setTalking(on) {
    on = !!on;
    if (on === talking) return;
    talking = on;
    if (on && flashing) { flashing = ''; if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; } }
    faces().forEach(paint);
  }

  /* ---------------- 목소리(무료) ----------------
   * 기본 = 「케이 기본 목소리」: PC(chat_responder)가 무료 edge-tts 한국어 여성 뉴럴(ko-KR-SunHiNeural)로 mp3 생성.
   * 선택 = 이 기기에 깔린 한국어 음성(브라우저/OS 내장 · 무료). 한국어 여성 음성을 목록 맨 위에 올린다.
   *   ⚠️ 안드로이드 앱(WebView)은 기기 음성(speechSynthesis)을 지원하지 않는 경우가 많다 → 그때는 기본만 보인다. */
  var synth = null; try { synth = window.speechSynthesis || null; } catch (e) { synth = null; }
  var FEMALE_HINTS = /(female|woman|여성|여자|sunhi|sun-hi|seoyeon|yuna|heami|jimin|seohyeon|soonbok|yujin|google 한국의|ko-kr-standard-a|ko-kr-wavenet-a)/i;
  var MALE_HINTS = /(male|man|남성|남자|injoon|hyunsu|bongjin|gookmin)/i;
  function deviceVoices() {
    if (!synth || !synth.getVoices) return [];
    var vs = [];
    try { vs = synth.getVoices() || []; } catch (e) { vs = []; }
    vs = vs.filter(function (v) { return /^ko/i.test(v.lang || '') || /korean|한국/i.test(v.name || ''); });
    function score(v) {
      var n = v.name || '', s = 0;
      if (FEMALE_HINTS.test(n) && !/\bmale\b/i.test(n.replace(/female/ig, ''))) s -= 2;
      if (MALE_HINTS.test(n.replace(/female/ig, '').replace(/woman/ig, ''))) s += 2;
      if (v.localService) s -= 0.5;
      return s;
    }
    return vs.slice().sort(function (a, b) { return score(a) - score(b); });
  }
  function voicePref() { return lsGet(VOICE_KEY) || ''; }
  function setVoicePref(name) { lsSet(VOICE_KEY, name || null); }
  function deviceVoiceByName(name) {
    if (!name) return null;
    var vs = deviceVoices();
    for (var i = 0; i < vs.length; i++) if (vs[i].name === name) return vs[i];
    return null;
  }
  // 기기 음성을 쓸 수 있으면 그 음성 객체, 아니면 null(→ 케이 기본 목소리로)
  function activeDeviceVoice() { return deviceVoiceByName(voicePref()); }
  var curUtter = null;
  function speakDevice(text, voice, cb) {
    cb = cb || {};
    if (!synth || !voice) { if (cb.onerror) cb.onerror(); return false; }
    try {
      synth.cancel();
      var u = new SpeechSynthesisUtterance(String(text || '').replace(/\*\*/g, '').slice(0, 1500));
      u.voice = voice; u.lang = voice.lang || 'ko-KR'; u.rate = 1.0; u.pitch = 1.0;
      u.onstart = function () { setTalking(true); if (cb.onstart) cb.onstart(); };
      u.onend = function () { if (curUtter === u) curUtter = null; setTalking(false); if (cb.onend) cb.onend(); };
      u.onerror = function () { if (curUtter === u) curUtter = null; setTalking(false); if (cb.onerror) cb.onerror(); };
      curUtter = u;
      synth.speak(u);
      return true;
    } catch (e) { setTalking(false); if (cb.onerror) cb.onerror(); return false; }
  }
  function stopDevice() { try { if (synth) synth.cancel(); } catch (e) {} curUtter = null; setTalking(false); }
  function deviceSpeaking() { return !!curUtter; }
  if (synth && synth.addEventListener) { try { synth.addEventListener('voiceschanged', function () { notifyVoices(); }); } catch (e) {} }
  var voiceListeners = [];
  function onVoices(fn) { voiceListeners.push(fn); }
  function notifyVoices() { voiceListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // 프로필 카드처럼 '열 때' 보이는 얼굴: 정지 사진(기본 표정)을 먼저 보이고, 영상은 0초부터 잠시 뒤 시작
  //   (반복영상 중간 프레임 = 눈 깜빡임 순간이 카드 첫 화면에 걸리지 않게)
  function restartFace(el, delayMs) {
    if (!el) return;
    build(el);
    var vid = el.querySelector('.kf-vid');
    el.classList.remove('vid-on');
    el._kHold = true;
    try { vid.pause(); vid.currentTime = 0; } catch (e) {}
    paint(el);
    setTimeout(function () { el._kHold = false; try { vid.currentTime = 0; } catch (e) {} syncVideo(el); }, delayMs == null ? 450 : delayMs);
  }

  window.KChar = {
    ready: ready,
    exprFor: exprFor, rules: EXPR_RULES,
    outfit: outfit, outfits: function () { return data.outfits.slice(); }, setOutfit: setOutfit, onChange: onChange,
    // (O-0040) 머리 스타일 · 서버 카탈로그
    catalogReady: catalogReady, reloadCatalog: loadCatalog, catalogState: function () { return { source: catState.source, url: catState.url, error: catState.error, at: catState.at }; },
    defaultHair: DEFAULT_HAIR, hair: hair, hairs: function () { return hairsList.slice(); }, setHair: setHair,
    hairThumbUrl: hairThumbUrl, hasLook: hasLook, stillMode: stillMode,
    // 지금 「보이는」 모습 이름(조합 사진이 없어 기본머리로 보일 땐 옷 이름만 — 안내는 머리 탭 아래 문구가 맡는다)
    lookName: function () { return outfit().name + (activeCombo() ? ' · ' + hair().name : ''); },
    avatarUrl: avatarUrl, exprUrl: exprUrl, thumbUrl: thumbUrl,
    mount: function () { faces().forEach(paint); },
    restartFace: restartFace,
    setExpr: setExpr, lastExpr: function () { return lastExpr; },
    setTalking: setTalking, isTalking: function () { return talking; },
    motionOn: motionOn, motionPref: motionPref, setMotionPref: setMotionPref, motionBlockReason: motionBlockReason,
    voice: {
      supported: function () { return !!(synth && window.SpeechSynthesisUtterance); },
      list: deviceVoices, pref: voicePref, setPref: setVoicePref, active: activeDeviceVoice,
      speak: speakDevice, stop: stopDevice, speaking: deviceSpeaking, onVoices: onVoices,
      isFemaleGuess: function (v) { return !!(v && FEMALE_HINTS.test(v.name || '')); }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.KChar.mount(); });
  else window.KChar.mount();
})();
