/* ============================================================================
 * k-character.js — 소장 「케이」 캐릭터(얼굴·표정·움직임·옷장·목소리) v6.0 1차
 * ----------------------------------------------------------------------------
 * 데이터 기반: 옷 목록은 assets/k/wardrobe.json 한 파일만 읽는다.
 *   (v9.5) 옷 13벌. 기본 옷(버건디)만 영상·자세 그림까지 앱 안에 있고, 나머지 옷의 영상·자세 그림과 앞으로의 새 옷은
 *          서버에서 받아 기기에 저장해 쓴다(아래 「v9.5 서버 자산」 · js/k-store.js). 연동 암호가 있는 기기만 받는다.
 *   (v9.4) 새 옷은 idle/talk 영상이 없어 정지 사진으로 보인다(말하는 중엔 사진이 끄덕이는 효과).
 *          expr_hd = 큰 자리용 선명한 사진, poses = 일하는 자세 그림(배경 없는 WebP — 지금은 기본 옷만), bow = 전신 인사 영상(6벌 — 버건디·네이비·니트·한복·청바지 셔츠·맨투맨. bow_cue = 자막 시점, bow_len = 길이: 영상을 재서 넣은 값).
 *   옷을 늘리려면 에셋 폴더(assets/k/<옷id>/)와 wardrobe.json 만 바꾸면 되고 코드는 그대로다.
 *   (에셋 생성 도구: Claude Code\apps\k-character\tools\build_app_assets.py)
 *
 * 화면 곳곳의 케이 얼굴은 <span class="kface" data-kface="head|home|profile|wardrobe|convo"> 자리표시.
 *   KChar.mount() 가 안에 [정지 사진 <img>] + [반복 영상 <video muted loop playsinline>] 을 채운다.
 *   - 평소: idle 반복영상(실패·저전력·움직임 끔 → 정지 사진)
 *   - 케이 목소리 재생 중: talk 영상(없으면 사진이 살짝 움직이는 CSS)
 *   - 새 답장 도착: 그 답의 표정 사진을 잠깐(미소·활짝 웃음 약 15초, 걱정·생각 중 약 7초) 보여 준 뒤 idle 로 복귀
 *   - (O-0226) 정지 사진이 「그대로 보이는」 자리의 기본 얼굴은 미소(REST_EXPR). 움직이는 영상(idle·talk)은 그대로 둔다.
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
    // (O-0117) '문제' 단독은 "시험 문제 5개 만들었습니다"까지 걸려 → 탈이 났다는 문맥일 때만
    { expr: 'concern',  words: ['못 했', '못했', '못해', '못하', '못 하', '실패', '오류', '죄송', '지연', '보류',
                                '문제가 생', '문제가 있', '문제가 발생', '문제를 발견', '문제가 발견', '문제로 인해', '문제가 됐', '문제가 되었'] },
    { expr: 'cheer',    words: ['완료', '끝났', '축하'] },
    { expr: 'thinking', words: ['진행 중', '작업 중', '확인 중', '맡겼'] },
    // (O-0226, 2026-10-05) 대표님 「웃는 모습을 보일 수가 없네」 — 미소 낱말이 3개뿐이고 순서도 꼴찌라 실제 답의 4%만 미소였다.
    //   일상 답(감사·드릴게요·알겠습니다 등)과 「네,」「대표님,」으로 시작하는 답도 미소로. 순서는 그대로 꼴찌 →
    //   걱정 낱말(죄송·보류·지연…)·완료·진행 중이 하나라도 있으면 그쪽이 먼저 걸린다(걱정할 때 웃지 않는다).
    //   starts = 글 맨 앞이 이 말로 시작할 때만(띄어쓰기 무시). 「네」가 문장 중간에 든 말("그러네, …")까지 걸리지 않게.
    { expr: 'smile',    words: ['좋은', '됐습니다', '반갑',
                                '감사', '고맙', '드릴게요', '드리겠습니다', '좋아요', '좋습니다', '좋네요', '알겠습니다', '안녕', '수고하셨', '다행'],
                        starts: ['네,', '네.', '네!', '대표님,'] }
  ];
  var DEFAULT_EXPR = 'neutral';          // 규칙에 아무것도 안 걸린 답 = 「특별한 표정 없음」(깜짝 표정을 띄우지 않는다)
  /* (O-0226) 기본 얼굴을 미소로 — 「정지 사진」에만 적용한다.
   *   · 정지 사진이 그대로 보이는 자리(채팅 말풍선 옆 동그란 얼굴, 프로필 카드 첫 사진, 움직임 끔·절전·영상 실패·잠시 멈춤)에서
   *     「평소(neutral)」 자리에 미소 사진을 쓴다. 걱정·생각 중·활짝 웃음은 그대로 그 사진.
   *   · 움직이는 영상(idle·talk)은 손대지 않는다. 영상 속 얼굴은 평소 표정이라, 곧 영상이 덮을 자리의 밑 사진까지 미소로 바꾸면
   *     화면을 열 때마다 「미소 사진 → 평소 영상」으로 표정이 튄다. 그래서 그 자리는 예전처럼 평소 사진을 밑에 깐다(paintStill).
   *   · 옷에 미소 사진이 없으면(서버에서 온 새 옷 등) 예전처럼 평소 사진으로 보인다. 기본 단발이 아닌 머리는 사진 한 장 그대로. */
  var REST_EXPR = 'smile';
  var FLASH_MS = { smile: 15000, cheer: 15000 };   // 웃는 얼굴은 15초(예전 7초 — 금방 사라져 못 보셨다)
  var FLASH_MS_BASE = 7000;                         // 걱정·생각 중은 예전 그대로 7초
  function restExpr(e) { return (!e || e === DEFAULT_EXPR) ? REST_EXPR : e; }
  function exprFor(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (!t) return DEFAULT_EXPR;
    for (var i = 0; i < EXPR_RULES.length; i++) {
      var r = EXPR_RULES[i], j;
      for (j = 0; j < r.words.length; j++) {
        if (t.indexOf(r.words[j].replace(/\s+/g, '')) !== -1) return r.expr;
      }
      if (r.starts) for (j = 0; j < r.starts.length; j++) {
        if (t.indexOf(r.starts[j].replace(/\s+/g, '')) === 0) return r.expr;
      }
    }
    return DEFAULT_EXPR;
  }

  /* ---------------- (O-0117) 홈 말풍선 「무슨 소식인가」 판정 ----------------
   * 표정은 위 EXPR_RULES 가 먼저 정한다 → 말 종류도 그 결과를 그대로 따른다(얼굴과 말이 어긋나지 않게).
   *   concern → problem(문제) · cheer → done(완료)
   * 그 밖에만 아래 두 규칙을 본다(띄어쓰기 무시, 위에서부터).
   *   done 추가어: 표정 규칙엔 없지만 「일 끝남」으로 볼 말(배포 완료 등) → 표정도 cheer 로 맞춘다.
   *   ask: 대표님 확인·승인·결정이 필요한 말 → 표정은 EXPR_RULES 결과 그대로. */
  var MOOD_EXTRA = [
    { kind: 'done', expr: 'cheer', words: ['배포했', '배포됐', '배포 마쳤', '마쳤습니다', '다 됐', '올려 두었', '보내 드렸', '보내드렸'] },
    { kind: 'ask',  expr: '',      words: ['확인해 주', '확인 부탁', '확인해주', '승인', '여쭙', '여쭤', '결정해 주', '골라 주', '정해 주', '답해 주', '말씀해 주', '어떻게 할까', '할까요', '괜찮을까요', '괜찮으실까요'] }
  ];
  function moodFor(text) {
    var expr = exprFor(text);
    if (expr === 'concern') return { kind: 'problem', expr: expr };
    if (expr === 'cheer') return { kind: 'done', expr: expr };
    var t = String(text || '').replace(/\s+/g, '');
    for (var i = 0; i < MOOD_EXTRA.length; i++) {
      var r = MOOD_EXTRA[i];
      for (var j = 0; j < r.words.length; j++) {
        if (t.indexOf(r.words[j].replace(/\s+/g, '')) !== -1) return { kind: r.kind, expr: r.expr || expr };
      }
    }
    return { kind: 'news', expr: expr };
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
  /* v9.6 머리 고정(대표님 2026-10-10 「머리 모양은 빼자. 지금 머리 스타일로 고정」) — 고르는 화면을 없애고 케이의 머리를 아래 하나로 고정한다.
   *   ★ 고정할 머리를 바꾸려면 이 값만 바꾼다(서버 카탈로그의 머리 id: h01 기본 단발 · h02 긴 생머리 … h10). 기본 머리(h01)가 아니면
   *     그 머리 × 옷 조합 사진(서버 카탈로그 combos)을 쓰고, 조합 사진이 없는 옷은 기본 머리 사진으로 보인다(표정·움직임·자세 그림·인사 영상은 기본 머리에만 있다).
   *   예전에 폰에 골라 둔 머리(localStorage smart_k_hair)는 더 쓰지 않으므로 지운다 — 어느 기기에서나 같은 머리로 보인다. */
  var FIXED_HAIR = DEFAULT_HAIR;
  var BUNDLED_HAIRS = [{ id: DEFAULT_HAIR, name: '기본 단발', desc: '앞머리 있는 단발 · 표정·움직임 전부 지원', thumb: '' }];
  var hairsList = BUNDLED_HAIRS.slice();
  var combos = {};                         // 'h02|burgundy_suit' → {img, av, thumb, crop}
  var broken = {};                         // 못 읽은 서버 사진 → 기본머리/기본옷으로 대신
  var urlIndex = {};                       // 서버 사진 주소 → broken 키(이미지 오류 때 찾기)
  var curHair = FIXED_HAIR;
  try { if (lsGet(HAIR_KEY) != null) lsSet(HAIR_KEY, null); } catch (e) {}
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
    // (O-0116/O-0118) 전신 사진 = 옷 10벌 모두 · 인사 영상 = 버건디 정장만. 없으면 '' → 꾸미기 화면은 상반신만
    n.fullbody = o.fullbody || ''; n.bow = o.bow || ''; n.bowPoster = o.bow_poster || o.bowPoster || '';
    // v9.4: 큰 자리용 선명한 사진(expr_hd — 지금은 웃는 상반신 1080 한 장) · 일하는 자세 그림(poses — 배경 없는 그림, 있는 옷만)
    n.exprHd = (o.expr_hd && typeof o.expr_hd === 'object') ? o.expr_hd : {};
    n.poses = (o.poses && typeof o.poses === 'object') ? o.poses : {};
    // v9.5: 인사 영상의 자막 시점·길이(영상을 재서 넣은 값) · 자세 영상 자리(앞으로 — 있으면 재생, 없으면 그림)
    n.bowCue = (typeof o.bow_cue === 'number') ? o.bow_cue : null; n.bowLen = (typeof o.bow_len === 'number') ? o.bow_len : null;
    // v9.6: 인사 영상을 한 옷에 여러 개(깊은 인사 + 가벼운 목례 등) — bow 가 첫째, bow_alt[] 가 그다음. 포스터·자막 시점·길이는 같은 차례의 bow_alt_poster[] · bow_alt_cue[] · bow_alt_len[]
    n.bowAlt = bowAltList(o.bow_alt, o.bow_alt_poster, o.bow_alt_cue, o.bow_alt_len, function (x) { return x || ''; });
    n.poseVideos = (o.pose_videos && typeof o.pose_videos === 'object') ? o.pose_videos : {};
    // v9.6: 음성 대화 전체 화면용 세로 영상(720×1280 · 소리 없음) — call: { listen, think, talk:[…], poster }. 없으면 빈 것(→ k-call.js 가 대체 그림)
    n.call = (o.call && typeof o.call === 'object') ? o.call : {};
    return n;
  }
  function bowAltList(vs, ps, cues, lens, wrap) {
    return (Array.isArray(vs) ? vs : (vs ? [vs] : [])).map(function (v, i) {
      if (!v || typeof v !== 'string') return null;
      var po = Array.isArray(ps) ? ps[i] : (i === 0 ? ps : ''), c = Array.isArray(cues) ? cues[i] : null, l = Array.isArray(lens) ? lens[i] : null;
      return { video: wrap(v), poster: (po && typeof po === 'string') ? wrap(po) : '', cue: (typeof c === 'number') ? c : null, len: (typeof l === 'number') ? l : null };
    }).filter(Boolean);
  }
  function setData(d) {
    var arr = Array.isArray(d) ? d : (d && d.outfits) || [];
    var outs = arr.map(function (o) { return normOutfit(o); }).filter(Boolean);
    if (!outs.length) return;
    bundled = outs;
    data = { default: (d && d.default) || outs[0].id, outfits: outs.slice() };
    compose();
  }
  // 저장된 옷이 (아직) 목록에 없으면 기본 옷을 입히되 저장값은 지우지 않는다 — 서버 옷은 카탈로그를 읽은 뒤 찾아진다
  function resolveCur() {
    var saved = lsGet(OUTFIT_KEY), so = findOutfit(saved);
    // (v9.5) 서버에서 받는 옷은 사진을 다 받은 뒤에만 입힌다(pending). 빠진 옷(옛 버전에 있던 옷)·아직 못 받은 옷이면 기본 옷.
    curId = (so && !so.pending) ? saved : (findOutfit(data.default) ? data.default : data.outfits[0].id);
  }
  function findOutfit(id) {
    for (var i = 0; i < data.outfits.length; i++) if (data.outfits[i].id === id && !broken['o|' + id]) return data.outfits[i];
    return null;
  }
  function outfit() { return findOutfit(curId) || findOutfit(data.default) || data.outfits[0]; }
  function isAbs(f) { return /^(https?:|data:|blob:)/i.test(f); }
  // (v9.5) 'ks:<이름>' = 서버에서 받아 기기에 저장해 둔 파일(KStore). 아직 못 받았으면 '' → 부르는 쪽이 대체 규칙을 쓴다.
  function isKs(f) { return typeof f === 'string' && f.slice(0, 3) === 'ks:'; }
  function url(o, file) {
    if (!file) return '';
    if (isKs(file)) return window.KStore ? KStore.url(file.slice(3)) : '';
    return isAbs(file) ? file : o.base + file;
  }
  function comboFor(hairId, outfitId) {
    if (!hairId || hairId === DEFAULT_HAIR) return null;
    var k = hairId + '|' + outfitId, c = combos[k];
    return (c && !broken[k]) ? c : null;
  }
  // 지금 보이는 조합 사진(기본머리이거나 조합이 없으면 null → 기존 옷 사진·표정·영상)
  function activeCombo() { return comboFor(curHair, outfit().id); }
  function isCur(o) { return !o || o.id === outfit().id; }
  // (O-0226) raw 를 주지 않으면 「평소」 자리에 미소 사진(REST_EXPR)을 돌려준다. raw=true 는 영상 밑 사진·영상 첫 장면용(진짜 평소 사진).
  //   hd=true 면 그 표정의 선명한 사진(있을 때만 — 홈 큰 카드처럼 크게 보이는 정지 사진 자리).
  function exprUrl(e, o, raw, hd) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return cb.img;
    if (!raw) e = restExpr(e);
    o = o || outfit();
    if (hd && o.exprHd && o.exprHd[e]) { var hu = url(o, o.exprHd[e]); if (hu) return hu; }
    return url(o, o.expr[e] || o.expr.neutral);
  }
  // v9.4 일하는 자세 그림(배경 없는 그림): 기본 머리 + 그 자세 그림이 있는 옷일 때만 주소, 아니면 ''(→ 부르는 쪽이 표정 사진으로 대신)
  function poseUrl(name, o) {
    if (isCur(o) && activeCombo()) return '';          // 다른 머리 조합 사진이 보이는 중 → 자세 그림(기본 머리)은 쓰지 않는다
    o = o || outfit();
    return (o.poses && o.poses[name]) ? url(o, o.poses[name]) : '';
  }
  // 작은 원형 얼굴용: 얼굴 쪽으로 자른 사진(av_*). 없으면 전체 사진(CSS 로 확대)
  function avatarUrl(e, o, raw) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return cb.av || cb.img;
    if (!raw) e = restExpr(e);
    o = o || outfit();
    var f = o.avatar[e] || o.avatar.neutral;
    return f ? url(o, f) : exprUrl(e, o, true);
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

  // (O-0116) 전신 사진: 기본머리면 옷의 fullbody, 다른 머리면 그 조합의 fullbody(없으면 '' → 상반신만)
  //   조합 사진이 없어 기본머리 사진으로 보이는 경우엔 전신도 기본머리 전신으로(상반신과 같은 모습)
  function fullbodyUrl(o) {
    var cb = isCur(o) ? activeCombo() : null;
    if (cb) return cb.fullbody || '';
    o = o || outfit(); return url(o, o.fullbody);
  }
  // 인사 영상은 기본머리 + 그 옷에 bow 가 있을 때만(다른 머리 조합 영상은 아직 없음)
  // v9.6: 한 옷에 인사 영상이 여러 개일 수 있다 — 틀 수 있는(다 받아 둔) 것만 차례대로 [{video, poster, cue}]
  function bowList(o) {
    if (isCur(o) && activeCombo()) return [];
    o = o || outfit();
    var all = (o.bow ? [{ video: o.bow, poster: o.bowPoster, cue: o.bowCue }] : []).concat(o.bowAlt || []), out = [];
    all.forEach(function (b) { var u = url(o, b.video); if (u) out.push({ video: u, f: b.video, poster: b.poster, cue: b.cue }); });
    return out;
  }
  function bowUrl(o) { var l = bowList(o); return l.length ? l[0].video : ''; }     // 인사 영상이 있나(첫째 것) — 예전과 같은 뜻
  var bowTurn = {};
  function bowPick(o) {                     // 누를 때마다 번갈아(하나뿐이면 늘 그것)
    o = o || outfit(); var l = bowList(o); if (!l.length) return '';
    var i = (bowTurn[o.id] == null ? 0 : (bowTurn[o.id] + 1)) % l.length; bowTurn[o.id] = i;
    return l[i].video;
  }

  /* ---- 머리 ---- */
  function findHair(id) { for (var i = 0; i < hairsList.length; i++) if (hairsList[i].id === id) return hairsList[i]; return null; }
  function hair() { return findHair(curHair) || hairsList[0]; }
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
      if (id !== FIXED_HAIR) return;             // v9.6: 고정 머리 말고는 목록에 넣지 않는다(다른 머리의 사진·영상은 받지 않는다)
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
      if (!c || !c.hair || !c.outfit || !c.img || String(c.hair) === DEFAULT_HAIR || String(c.hair) !== FIXED_HAIR) return;   // v9.6: 고정 머리의 조합만
      var k = String(c.hair) + '|' + String(c.outfit);
      var e = { img: abs(c.img), av: abs(c.av), thumb: abs(c.thumb), crop: c.crop || null,
                idle: abs(c.idle),
                fullbody: abs(c.fullbody) };        // (O-0116) 조합 전신 사진 — 있는 조합만(아직 없음)               // (O-0042/O-0043) 조합 idle 영상 — 있는 조합만(지금은 h02 긴생머리 × 옷 10벌). 없으면 정지 사진
      [e.img, e.av, e.thumb].forEach(function (u) { if (u) nIndex[u] = k; });
      nCombos[k] = e;
    });
    hairsList = nHairs; combos = nCombos; urlIndex = nIndex;
    catRemote = remote;
    compose();
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

  /* ====================== v9.5 서버 자산(옷별 묶음을 서버에서 받아 기기에 저장) ======================
   * 기본 옷(버건디)은 전부 앱 안에 있다. 그 밖의 옷은 사진까지만 앱에 있고, 영상(평소·말하기·전신 인사)과 일하는 자세 그림은
   * 서버 목록(get_k_assets — 연동 암호 필요)에 적힌 파일을 받아 KStore(IndexedDB)에 넣어 두고 쓴다. 앞으로 추가되는 새 옷은 사진까지 전부 서버.
   *   · 합치는 규칙: 앱 안에 있는 파일이 우선. 목록은 앱에 없는 것만 보탠다.
   *   · 받는 순서: 지금 입은 옷의 사진(서버 옷일 때) → 그 옷의 자세 그림 → 그 옷의 영상(입혔을 때만 · 데이터 절약 모드면 전신을 직접 누를 때만).
   *                옷장 사진(서버 옷)은 꾸미기 화면을 열 때.
   *   · 바뀐 것만: 파일 이름이 곧 내용이라, 이름이 없는 것만 받는다. 옷별로 새 파일을 다 받은 뒤에 새 묶음으로 바꾸고 옛 파일을 지운다.
   *   · 암호가 없거나 · 서버에 함수가 아직 없거나 · 인터넷이 없으면: 앱 안 자산 + 이미 받아 둔 것만으로 동작한다(대체 규칙 그대로).
   *   · 시작 인사(k-intro.js)는 여기서 적어 두는 한 줄(smart_k_intro_plan)을 보고 그 옷의 영상/사진을 고른다. */
  var KA_KEY = 'smart_k_assets', KA_PLAN_KEY = 'smart_k_intro_plan';
  var catRemote = [];
  var ka = { m: null, eff: {}, state: 'none', want: '', busy: {}, lastFetch: 0, fetching: null };
  function kaSave() { try { lsSet(KA_KEY, JSON.stringify({ m: ka.m, eff: ka.eff })); } catch (e) {} }
  function kaNames(e, kind) {              // 묶음 e 의 파일 이름들. kind: 'core'(옷장·표정·전신·1080) | 'thumb' | 'pose' | 'video' | 'bow' | 없음=전부
    var f = (e && e.files) || {}, out = [];
    function add(v) { if (!v) return; if (typeof v === 'string') out.push(v); else Object.keys(v).forEach(function (k) { if (v[k]) out.push(v[k]); }); }
    if (!kind || kind === 'core') { add(f.expr); add(f.avatar); add(f.thumb); add(f.fullbody); add(f.expr_hd); }
    if (kind === 'thumb') add(f.thumb);
    if (!kind || kind === 'pose') add(f.poses);
    if (!kind || kind === 'video') { add(f.idle); add(f.talk); add(f.pose_videos); add(f.call_poster); add(f.call_listen); add(f.call_think); add(f.call_talk); }   // 받는 순서이기도 하다: 통화 포스터(작다)를 통화 영상보다 먼저 — 통화 중에 받게 되면 포스터부터 보이게
    if (!kind || kind === 'video' || kind === 'bow') { add(f.bow); add(f.bow_poster); add(f.bow_alt); add(f.bow_alt_poster); }
    return out;
  }
  function kaHas(names) { var S = window.KStore; return !!S && names.every(function (n) { return S.has(n); }); }
  function kaReady(names) { var S = window.KStore; return !!S && names.every(function (n) { return !!S.url(n); }); }
  function ks(n) { return n ? 'ks:' + n : ''; }
  function ksMap(m) { var o = {}; Object.keys(m || {}).forEach(function (k) { if (m[k]) o[k] = ks(m[k]); }); return o; }
  function ksCall(f) {                    // 서버 묶음의 세로 영상 자리 → 옷의 call
    var c = {};
    if (f.call_listen) c.listen = ks(f.call_listen);
    if (f.call_think) c.think = ks(f.call_think);
    if (f.call_talk) c.talk = (Array.isArray(f.call_talk) ? f.call_talk : [f.call_talk]).filter(Boolean).map(ks);
    if (f.call_poster) c.poster = ks(f.call_poster);
    return c;
  }
  function saveData() { try { return !!(navigator.connection && navigator.connection.saveData); } catch (e) { return false; } }
  // 앱 안 옷 + 서버 카탈로그 옷 + 서버 자산을 합쳐 지금의 옷 목록을 만든다
  function compose() {
    var have = {};
    var outs = bundled.map(function (o) {
      have[o.id] = 1;
      var e = ka.eff[o.id]; if (!e || !e.files) return o;
      var f = e.files, n = {}; Object.keys(o).forEach(function (k) { n[k] = o[k]; });
      if (!n.idle && f.idle) n.idle = ks(f.idle);
      if (!n.talk && f.talk) n.talk = ks(f.talk);
      if (!n.bow && f.bow) { n.bow = ks(f.bow); n.bowPoster = ks(f.bow_poster); n.bowCue = e.bow_cue; n.bowLen = e.bow_len; }
      if (!(n.bowAlt || []).length && f.bow_alt) n.bowAlt = bowAltList(f.bow_alt, f.bow_alt_poster, e.bow_alt_cue, e.bow_alt_len, ks);
      if (!Object.keys(n.poses || {}).length && f.poses) n.poses = ksMap(f.poses);
      if (!Object.keys(n.poseVideos || {}).length && f.pose_videos) n.poseVideos = ksMap(f.pose_videos);
      if (!Object.keys(n.exprHd || {}).length && f.expr_hd) n.exprHd = ksMap(f.expr_hd);
      if (!Object.keys(n.call || {}).length) n.call = ksCall(f);
      n.srv = true;
      return n;
    });
    catRemote.forEach(function (o) { if (!have[o.id]) { have[o.id] = 1; outs.push(o); } });
    // 앱에 없는 서버 옷: 옷장 사진을 받은 것만 목록에(사진을 다 받기 전에는 pending). 순서 = 서버 목록에 적힌 순서(올리는 도구가 meta.json 의 order 로 정한다)
    var srvIds = [];
    if (ka.m && Array.isArray(ka.m.outfits)) ka.m.outfits.forEach(function (e) { if (e && e.id && ka.eff[e.id] && srvIds.indexOf(e.id) < 0) srvIds.push(e.id); });
    Object.keys(ka.eff).forEach(function (id) { if (srvIds.indexOf(id) < 0) srvIds.push(id); });
    srvIds.forEach(function (id) {
      var e = ka.eff[id], f = e && e.files;
      if (have[id] || !f || !f.expr || !f.thumb || !kaReady([f.thumb])) return;
      var n = { id: id, name: e.name || id, desc: e.desc || '', category: e.category || '새 옷', crop: e.crop || null, base: '', remote: true, srv: true, server: true,
        expr: ksMap(f.expr), avatar: ksMap(f.avatar), thumb: ks(f.thumb), fullbody: ks(f.fullbody), exprHd: ksMap(f.expr_hd),
        idle: ks(f.idle), talk: ks(f.talk), bow: ks(f.bow), bowPoster: ks(f.bow_poster), bowCue: e.bow_cue, bowLen: e.bow_len,
        bowAlt: bowAltList(f.bow_alt, f.bow_alt_poster, e.bow_alt_cue, e.bow_alt_len, ks),
        poses: ksMap(f.poses), poseVideos: ksMap(f.pose_videos), call: ksCall(f) };
      n.pending = !kaReady(kaNames(e, 'core'));
      outs.push(n);
    });
    data = { default: data.default, outfits: outs };
    resolveCur();
  }
  // 받아 둔 파일을 화면에 걸 수 있게 읽어 둔다(지금 쓰는 묶음들 전부 — 주소만 만든다)
  function kaLoadStored() {
    var S = window.KStore; if (!S) return Promise.resolve();
    var names = [];
    Object.keys(ka.eff).forEach(function (id) { kaNames(ka.eff[id]).forEach(function (n) { if (S.has(n)) names.push(n); }); });
    return S.load(names);
  }
  function kaRepaint() { compose(); refreshAll(true); notify(); writePlan(); }
  var KA_LIST_MS = 8000, KA_FILE_MS = 45000;      // 시간 제한: 목록 8초 · 파일 45초(느린 연결의 0.7MB 영상 기준). 넘으면 그만두고 다음 기회에 다시
  // 시간 제한이 있는 받기(멈춘 연결 때문에 영영 끝나지 않는 일이 없게). 넘으면 요청을 끊고 실패로 돌려준다.
  function kaTimed(url, opt, ms) {
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null, done = false;
    opt = opt || {}; if (ac) opt.signal = ac.signal;
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { if (done) return; done = true; try { if (ac) ac.abort(); } catch (e) {} rej(new Error('시간 초과')); }, ms);
      fetch(url, opt).then(function (r) { if (done) return; res({ r: r, end: function () { done = true; clearTimeout(t); } }); },
                           function (e) { if (done) return; done = true; clearTimeout(t); rej(e); });
    });
  }
  /* 받은 것이 정말 그 파일인가 — 공용 와이파이 로그인 화면처럼 「200 인데 다른 것」이나 받다가 끊긴 것을 저장하지 않으려고 본다.
   *   ① 크기가 목록(bytes)에 적힌 값과 같은가 ② 파일 머리가 그 형식인가(JPEG FF D8 FF · WebP RIFF…WEBP · MP4 ….ftyp).
   *   이름이 곧 내용이라 한 번 저장하면 다시 받지 않는다 → 틀린 것을 저장하면 영영 남는다. 그래서 저장 전에 확인한다. */
  function kaLooksRight(name, blob) {
    var want = ka.m && ka.m.bytes && ka.m.bytes[name];
    if (!blob || !blob.size) return Promise.resolve(false);
    if (typeof want === 'number' && blob.size !== want) return Promise.resolve(false);
    return new Promise(function (res) {
      try {
        var fr = new FileReader();
        fr.onerror = function () { res(false); };
        fr.onload = function () {
          var b = new Uint8Array(fr.result), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
          function at(i, str) { for (var k = 0; k < str.length; k++) if (b[i + k] !== str.charCodeAt(k)) return false; return true; }
          if (ext === 'jpg') return res(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF);
          if (ext === 'webp') return res(at(0, 'RIFF') && at(8, 'WEBP'));
          if (ext === 'mp4') return res(at(4, 'ftyp'));
          res(false);
        };
        fr.readAsArrayBuffer(blob.slice(0, 16));
      } catch (e) { res(false); }
    });
  }
  function kaFetchFile(name) {
    var S = window.KStore; if (!S || !ka.m || !ka.m.base) return Promise.resolve(false);
    if (S.has(name)) return S.load([name]).then(function (r) { return r.length > 0; });
    if (ka.busy[name]) return ka.busy[name];
    var p = kaTimed(ka.m.base + name, {}, KA_FILE_MS)
      .then(function (x) { if (!x.r.ok) { x.end(); throw new Error('HTTP ' + x.r.status); } return x.r.blob().then(function (b) { x.end(); return b; }); })
      .then(function (b) { return kaLooksRight(name, b).then(function (ok) { if (!ok) throw new Error('다른 파일'); return S.put(name, b); }); })
      .then(function () { delete ka.busy[name]; return true; }, function () { delete ka.busy[name]; return false; });
    ka.busy[name] = p;
    return p;
  }
  // 이미 저장해 둔 것 중 크기가 목록과 다른 것(예전에 잘못 저장된 것)은 지운다 → 다음에 다시 받는다
  function kaDropWrong() {
    var S = window.KStore, by = ka.m && ka.m.bytes;
    if (!S || !S.sizes || !by) return Promise.resolve();
    var names = S.names().filter(function (n) { return typeof by[n] === 'number'; });
    return S.sizes(names).then(function (sz) {
      var bad = names.filter(function (n) { return typeof sz[n] === 'number' && sz[n] !== by[n]; });
      return bad.length ? S.del(bad) : null;
    }, function () {});
  }
  function kaFetchAll(names, onEach) {     // 차례로 받는다(한 번에 하나 — 느린 연결에서 화면이 먼저다). 전부 됐으면 true. onEach = 하나 받을 때마다
    var ok = true;
    return names.reduce(function (pr, n) { return pr.then(function () { return kaFetchFile(n); }).then(function (r) { if (!r) ok = false; else if (onEach) onEach(n); }); }, Promise.resolve()).then(function () { return ok; });
  }
  /* 그 옷의 자산을 받는다. opt.bow = 인사 영상을 꼭 받는다(전신을 직접 누름 — 데이터 절약 모드여도).
   *   새 목록의 묶음(next)이 지금 쓰는 묶음(eff)과 다르면 새 파일을 다 받은 뒤에 바꾼다. */
  function ensureOutfit(id, opt) {
    opt = opt || {};
    if (!ka.m || !window.KStore) return Promise.resolve(false);
    var next = null; (ka.m.outfits || []).forEach(function (e) { if (e && e.id === id) next = e; });
    if (!next) return Promise.resolve(false);
    var cur = ka.eff[id] || next;
    var lite = saveData();                                // 데이터 절약 모드: 영상은 받지 않는다(전신을 직접 누른 경우의 인사 영상만 예외)
    function vidsOf(e) { return lite ? (opt.bow ? kaNames(e, 'bow') : []) : kaNames(e, 'video'); }
    function wanted(e) {
      return kaNames(e, 'core').concat(kaNames(e, 'pose')).concat(vidsOf(e)).filter(function (n, i, a) { return a.indexOf(n) === i; });
    }
    var step = 0;
    function paintSome() { step++; kaRepaint(); }
    // 먼저 지금 쓰는 묶음에서 빠진 것(사진 → 자세 그림 → 영상 순)
    var order = kaNames(cur, 'core').concat(kaNames(cur, 'pose'));
    var vids = vidsOf(cur);
    return kaFetchAll(order.filter(function (n) { return !KStore.has(n) || !KStore.url(n); })).then(function () { paintSome(); return kaFetchAll(vids.filter(function (n) { return !KStore.has(n) || !KStore.url(n); }), paintSome); })   // 영상은 하나 받을 때마다 바로 쓴다(평소 영상이 인사 영상을 기다리지 않게)
      .then(function () {
        if (cur === next || JSON.stringify(cur) === JSON.stringify(next)) { paintSome(); return true; }
        return kaFetchAll(wanted(next).filter(function (n) { return !KStore.has(n) || !KStore.url(n); })).then(function (ok) {
          if (ok) { ka.eff[id] = next; kaSave(); kaGc(); }
          paintSome();
          return ok;
        });
      });
  }
  // 어느 묶음에서도 쓰지 않는 저장 파일을 지운다(새 목록을 받은 뒤에만 부른다)
  function kaGc() {
    var S = window.KStore; if (!S || !ka.m) return;
    var keep = {};
    Object.keys(ka.eff).forEach(function (id) { kaNames(ka.eff[id]).forEach(function (n) { keep[n] = 1; }); });
    (ka.m.outfits || []).forEach(function (e) { kaNames(e).forEach(function (n) { keep[n] = 1; }); });
    var drop = S.names().filter(function (n) { return !keep[n]; });
    if (drop.length) S.del(drop);
  }
  // 새 목록을 받아들인다: 처음 보는 옷은 바로 새 묶음, 이미 쓰던 옷은 그대로 두고(입었을 때 새 파일을 다 받으면 바뀐다) 없어진 옷은 뺀다
  function kaAdopt(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.outfits) || typeof m.base !== 'string' || !m.base) return false;
    // 옷이 하나도 없거나 쓸 수 있는 묶음이 하나도 없는 목록은 받아들이지 않는다(서버 실수 한 번으로 폰에 받아 둔 자산이 다 지워지지 않게).
    var usable = m.outfits.filter(function (e) { return e && e.id && /^[a-z0-9_]+$/i.test(e.id) && e.files && typeof e.files === 'object' && kaNames(e).length > 0; });
    if (!usable.length) return false;
    ka.m = m;
    var seen = {};
    m.outfits.forEach(function (e) {
      if (!e || !e.id || !/^[a-z0-9_]+$/i.test(e.id)) return;
      seen[e.id] = 1;
      if (!ka.eff[e.id]) ka.eff[e.id] = e;
      else if (JSON.stringify(ka.eff[e.id]) !== JSON.stringify(e)) {
        // 파일은 그대로이고 설명 값만 바뀐 경우(이름·자막 시점 등)는 바로 새 것으로
        if (kaNames(e).every(function (n) { return kaNames(ka.eff[e.id]).indexOf(n) >= 0; })) ka.eff[e.id] = e;
      }
    });
    Object.keys(ka.eff).forEach(function (id) { if (!seen[id]) delete ka.eff[id]; });
    kaSave();
    return true;
  }
  function kaFetchManifest(force) {
    var C = window.OfficeBridge && OfficeBridge.CONFIG, pass = lsGet('smart_sync_pass') || '';
    if (!C || !pass) { ka.state = pass ? 'none' : 'nopass'; return Promise.resolve(false); }
    if (ka.fetching) return ka.fetching;
    if (!force && Date.now() - ka.lastFetch < 60000) return Promise.resolve(false);
    ka.lastFetch = Date.now();
    ka.fetching = kaTimed(C.url + '/rest/v1/rpc/get_k_assets', { method: 'POST',
      headers: { 'apikey': C.key, 'Authorization': 'Bearer ' + C.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_pass: pass }) }, KA_LIST_MS)
      .then(function (x) { if (!x.r.ok) { x.end(); var e = new Error('HTTP ' + x.r.status); e.status = x.r.status; throw e; } return x.r.json().then(function (m) { x.end(); return m; }); })
      .then(function (m) {
        ka.fetching = null;
        if (!m) { ka.state = 'empty'; return false; }            // 서버에 아직 목록이 없다 → 아무것도 바꾸지 않는다
        if (!kaAdopt(m)) { ka.state = 'bad'; return false; }     // 비었거나 형식이 이상한 목록 → 받아들이지 않고, 받아 둔 파일도 지우지 않는다
        ka.state = 'ok';
        return kaDropWrong().then(kaLoadStored).then(function () { kaRepaint(); kaGc(); return ensureOutfit(outfit().id); }).then(function () { return true; });
      }, function (e) { ka.fetching = null; ka.state = (e && e.status === 404) ? 'noserver' : (e && (e.status === 403 || e.status === 401 || e.status === 400)) ? 'badpass' : 'offline'; return false; });
    return ka.fetching;
  }
  function assetsInit() {
    try { var sv = JSON.parse(lsGet(KA_KEY) || 'null'); if (sv && sv.eff) { ka.m = sv.m || null; ka.eff = sv.eff || {}; } } catch (e) {}
    var S = window.KStore;
    var first = S ? S.ready.then(kaLoadStored).then(function () { kaRepaint(); }) : Promise.resolve();
    first = first.then(function () {
      // 저장된 옷이 어디에도 없으면(이번 버전에서 뺀 옷 등 — 앱 안에도, 받아 둔 서버 목록에도, 서버 카탈로그에도 없음) 기본 옷으로 되돌려 적는다
      var saved = lsGet(OUTFIT_KEY);
      if (saved && !findOutfit(saved) && !ka.eff[saved]) { lsSet(OUTFIT_KEY, null); kaRepaint(); }
    });
    return first.then(function () { return kaFetchManifest(true); }).then(function () { writePlan(); });
  }
  // 꾸미기 화면을 열 때: 서버 옷의 옷장 사진을 받는다(목록도 한 번 새로 본다)
  //   v9.6.1: 새 목록에서 옷장 사진이 바뀐 서버 옷은 그 사진 한 장을 받아 바로 바꾼다. 예전에는 묶음이 바뀐 옷은 「입었을 때」만 새 묶음으로 넘어가서,
  //   서버에서 옷장 사진을 바꿔도 입어 보지 않은 옷은 목록에 옛 사진이 그대로 남았다. 바꾸는 것은 옷장 사진 자리 하나뿐 — 나머지 파일은 예전처럼 입었을 때 넘어간다.
  function ensureThumbs() {
    return kaFetchManifest(false).then(function () {
      if (!ka.m) return false;
      var need = [], swap = [];
      Object.keys(ka.eff).forEach(function (id) { var f = ka.eff[id].files || {}; if (f.expr && f.thumb && !KStore.url(f.thumb)) need.push(f.thumb); });
      (ka.m.outfits || []).forEach(function (e) {
        var c = e && e.id ? ka.eff[e.id] : null, nt = e && e.files ? e.files.thumb : '';
        if (c && c.files && c.files.expr && c.files.thumb && typeof nt === 'string' && nt && nt !== c.files.thumb) { swap.push({ id: e.id, thumb: nt }); if (need.indexOf(nt) < 0 && !KStore.url(nt)) need.push(nt); }
      });
      var again = ensureOutfit(outfit().id);                    // 지난번에 못 받은 것이 있으면 이때 다시 받는다
      if (!need.length && !swap.length) return again;
      return kaFetchAll(need).then(function () {
        var changed = false;
        swap.forEach(function (w) {
          var c = ka.eff[w.id];
          if (!c || !c.files || c.files.thumb === w.thumb || !kaReady([w.thumb])) return;      // 못 받았으면 옛 사진 그대로(다음에 열 때 다시)
          var n = JSON.parse(JSON.stringify(c)); n.files.thumb = w.thumb; ka.eff[w.id] = n; changed = true;
        });
        if (changed) kaSave();
        kaRepaint();
        if (changed) kaGc();                                    // 새 사진으로 다시 그린 뒤에 옛 사진을 지운다
        return true;
      });
    });
  }
  // (v9.6) 지금 모습의 세로 영상 묶음: 실제로 틀 수 있는 것만 { listen, think, talk:[…], poster }. 다른 머리 조합이 보이는 중이면 없음(기본 머리 영상이라).
  function callSet(o) {
    if (isCur(o) && activeCombo()) return null;
    o = o || outfit();
    var c = o.call || {}, out = { talk: [] }, any = false;
    ['listen', 'think', 'poster'].forEach(function (k) { var u = url(o, c[k]); if (u) { out[k] = u; any = true; } });
    (Array.isArray(c.talk) ? c.talk : (c.talk ? [c.talk] : [])).forEach(function (f) { var u = url(o, f); if (u) { out.talk.push(u); any = true; } });
    return any ? out : null;
  }
  // 인사 영상 상태: 'ready' 틀 수 있음 · 'pending' 목록에는 있는데 아직 못 받음 · 'none' 그 옷에는 인사 영상이 없음
  function bowState(o) {
    o = o || outfit();
    if (isCur(o) && activeCombo()) return 'none';
    if (!o.bow && !(o.bowAlt || []).length) return 'none';
    return bowList(o).length ? 'ready' : 'pending';
  }
  // 시작 인사가 볼 한 줄: 지금 옷의 인사 영상(다 받아 둔 것만) 또는 전신 사진
  function writePlan() {
    try {
      var o = outfit(), plan = { v: 1, outfit: o.id };
      function ref(f) { if (!f) return null; if (isKs(f)) { var n = f.slice(3); return (window.KStore && KStore.has(n)) ? { s: n } : null; } return { b: isAbs(f) ? f : o.base + f }; }
      var vid = ref(o.bow), pos = ref(o.bowPoster);
      if (vid && pos) { plan.video = vid; plan.poster = pos; if (typeof o.bowCue === 'number') plan.cue = o.bowCue; }
      // v9.6: 인사 영상이 더 있으면(다 받아 둔 것만) 함께 적는다 — 시작 인사가 번갈아 고른다
      var alts = [];
      (o.bowAlt || []).forEach(function (b) { var v2 = ref(b.video), p2 = ref(b.poster); if (v2 && p2) { var a = { video: v2, poster: p2 }; if (typeof b.cue === 'number') a.cue = b.cue; alts.push(a); } });
      if (alts.length) plan.alts = alts;
      var fb = ref(o.fullbody); if (fb) plan.still = fb;
      lsSet(KA_PLAN_KEY, JSON.stringify(plan));
    } catch (e) {}
  }

  var ready = fetch(BASE + 'wardrobe.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) { setData(d); })
    .catch(function (e) { console.warn('[케이] wardrobe.json 읽기 실패 — 기본 옷으로:', e); setData(FALLBACK); })
    .then(function () { refreshAll(); notify(); });
  var catalogReady = ready.then(loadCatalog);
  var assetsReady = ready.then(assetsInit);

  function setOutfit(id) {
    var so = findOutfit(id);
    if (!so || id === outfit().id) return false;
    if (so.pending) {                                   // (v9.5) 서버 옷: 사진을 다 받은 뒤에 입힌다. 'pending' 을 돌려준다(앱이 「받고 있습니다」 안내)
      ka.want = id;
      ensureOutfit(id).then(function () { var o2 = findOutfit(id); if (ka.want === id && o2 && !o2.pending) { ka.want = ''; setOutfit(id); } });
      return 'pending';
    }
    ka.want = '';
    curId = id; lsSet(OUTFIT_KEY, id);
    refreshAll(true); notify(); writePlan();
    ensureOutfit(id);                                   // (v9.5) 입혔을 때 그 옷의 자세 그림·영상을 받는다
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
    vid.addEventListener('playing', function () { el._kBlocked = false; el.classList.add('vid-on'); });
    vid.addEventListener('error', function () { markFail(el, vid.getAttribute('data-kind')); });
    el.appendChild(img); el.appendChild(vid);
    el._kVisible = true;
    if (io) io.observe(el);
  }
  function markFail(el, kind) {
    el._kFail = el._kFail || {};
    if (kind) el._kFail[kind + '|' + curId + (activeCombo() ? '|' + curHair : '')] = true;
    el.classList.remove('vid-on');
    paint(el);                                   // (O-0226) 영상을 못 쓰게 됐으니 밑 사진도 다시 고른다(정지 사진 자리 = 미소)
  }
  // (O-0124) 넓은 사진 자리: 프로필·꾸미기·음성 대화 무대(convo). class="kface wide" 도 넓은 자리로 본다.
  function wideFace(el) { var k = el.getAttribute('data-kface'); return k === 'profile' || k === 'wardrobe' || k === 'convo' || el.classList.contains('wide'); }
  /* (O-0226) 이 자리에서 지금 영상을 틀 수 있는가(화면에 보이는지는 따지지 않는다 — 그건 syncVideo 가 본다).
   *   영상 종류·파일을 고르는 규칙은 예전 syncVideo 안에 있던 것을 그대로 옮긴 것이다(동작 같음). */
  function videoPlan(el) {
    var o = outfit(), cb = activeCombo(), still = !!cb;
    var kind = talking ? 'talk' : 'idle';
    var file = still ? '' : o[kind];                                  // 기본머리 외 조합 = 영상 없음(정지 사진)
    // (O-0042) 조합에 idle 영상이 있으면 평소엔 그것을 반복 재생. 말하는 중엔 기존대로 정지 사진 + 끄덕임 CSS
    if (still && !talking && cb.idle) file = cb.idle;
    if (file && !still && !url(o, file)) file = '';                   // (v9.5) 서버에서 받을 영상을 아직 못 받음 → 정지 사진
    if (talking && !file && !still) { kind = 'idle'; file = (o.idle && url(o, o.idle)) ? o.idle : ''; } // talk 영상 없는 옷 → idle + CSS 입 모양 효과
    var fkey = kind + '|' + curId + (still ? '|' + curHair : '');
    var failed = !!(el._kFail && el._kFail[fkey]);
    return { o: o, cb: cb, still: still, kind: kind, file: file,
             can: !!file && !failed && !el._kHold && motionOn() && !flashing && !el.hasAttribute('data-kstill') };   // v9.4 data-kstill = 정지 사진만 쓰는 자리(홈 큰 카드)
  }
  // 밑에 까는 정지 사진만 고른다(영상은 건드리지 않음).
  function paintStill(el) {
    var e = flashing || lastExpr;
    if (wideFace(el)) e = flashing || DEFAULT_EXPR;
    // 곧 영상이 덮을 자리 = 영상 첫 장면과 같은 평소 사진(raw). 정지 사진이 그대로 보이는 자리 = 미소가 기본.
    var raw = videoPlan(el).can && !el._kBlocked;
    // v9.4: 그 자리에만 잠깐 보이는 표정(faceFlash — 홈 카드의 아침 인사). 새 답의 표정(flashing)이 뜨는 동안은 그쪽이 먼저.
    //   lastExpr·flashing 을 건드리지 않으므로 다른 자리·채팅 얼굴의 표정은 바뀌지 않는다.
    if (el._kTemp && !flashing) { e = el._kTemp; raw = false; }
    var src = wideFace(el) ? exprUrl(e, null, raw, el.hasAttribute('data-khd')) : avatarUrl(e, null, raw);
    var img = el.querySelector('.kf-img');
    if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
  }
  function paint(el) {
    build(el);
    var o = outfit(), e = flashing || lastExpr;
    if (wideFace(el)) e = flashing || DEFAULT_EXPR;
    var vid = el.querySelector('.kf-vid');
    el.classList.toggle('kf-crop', !wideFace(el) && !hasCrop(o, e));   // 잘린 얼굴사진이 없으면 전체사진을 CSS로 확대
    // 옷마다 원형 구도가 다를 수 있다(예: 오프숄더는 아래로 넓게) → 영상 확대 비율·중심도 그 옷 값으로
    var cb = activeCombo();
    var c = (cb && cb.crop) || o.crop || {};
    el.classList.toggle('kf-still', !!cb);                            // 기본머리 외: 조합 정지 사진 고정(표정·영상 없음)
    el.style.setProperty('--kscale', String(c.scale || 1.35));
    el.style.setProperty('--kox', (c.ox != null ? c.ox : 50) + '%');
    el.style.setProperty('--koy', (c.oy != null ? c.oy : 49) + '%');
    paintStill(el);
    var poster = exprUrl(DEFAULT_EXPR, null, true);                   // 영상 첫 장면 자리 = 진짜 평소 사진(영상과 같은 표정)
    if (vid.getAttribute('poster') !== poster) vid.setAttribute('poster', poster);
    syncVideo(el);
  }
  function syncVideo(el) {
    var vid = el.querySelector && el.querySelector('.kf-vid'); if (!vid) return;
    var pl = videoPlan(el), o = pl.o, still = pl.still, kind = pl.kind, file = pl.file;   // (O-0226) 고르는 규칙은 videoPlan 한 곳
    el.classList.toggle('kf-talk', talking);
    // (O-0124) talk 영상을 못 읽었을 때도(네트워크·코덱) 정지 사진 + 끄덕임으로 '말하는 중'을 보여 준다
    var talkFailed = !!(el._kFail && el._kFail['talk|' + curId]);
    el.classList.toggle('kf-talkstill', talking && (still || !o.talk || talkFailed));
    var want = pl.can && el._kVisible !== false && !document.hidden;
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
        if (err && err.name === 'NotAllowedError') {
          el.classList.remove('vid-on');
          if (!el._kBlocked) { el._kBlocked = true; paintStill(el); }   // (O-0226) 영상이 안 도는 자리 → 정지 사진(미소 기본). 재생은 계속 다시 시도한다
        }
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
        im.setAttribute('src', avatarUrl(im.getAttribute('data-kexpr'), null, im.hasAttribute('data-kraw')));   // (O-0226) data-kraw = 웃지 않는 자리(진짜 평소 사진)
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
      flashTimer = setTimeout(function () { flashing = ''; flashTimer = null; faces().forEach(paint); }, FLASH_MS[e] || FLASH_MS_BASE);   // (O-0226) 웃는 얼굴 15초, 그 밖 7초
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

  // (O-0124) 한 자리의 반복 영상만 잠시 멈춰 두기(정지 사진 유지). 음성 대화 무대가 켜진 동안 채팅 헤더의
  //   작은 얼굴 영상을 멈춰 영상 두 개가 동시에 돌지 않게(배터리) 쓴다. on=false 면 원래대로.
  function hold(el, on) {
    if (!el) return;
    build(el);
    el._kHold = !!on;
    if (on) el.classList.remove('vid-on');
    paint(el);                                   // (O-0226) 멈춘 동안은 정지 사진 자리(미소 기본), 풀리면 다시 영상 밑 사진으로
  }

  // v9.4: 한 자리(el)에만 ms 동안 그 표정 사진을 보인다(정지 사진 자리용). 채팅 얼굴 등 다른 자리는 그대로.
  function faceFlash(el, expr, ms) {
    if (!el || !expr) return;
    build(el);
    el._kTemp = expr; paintStill(el);
    clearTimeout(el._kTempT);
    el._kTempT = setTimeout(function () { el._kTemp = ''; paintStill(el); }, ms || 8000);
  }

  window.KChar = {
    ready: ready,
    exprFor: exprFor, rules: EXPR_RULES, moodFor: moodFor,
    restExpr: REST_EXPR, flashMs: function (e) { return FLASH_MS[e] || FLASH_MS_BASE; },   // (O-0226) 시험·확인용
    outfit: outfit, outfits: function () { return data.outfits.slice(); }, setOutfit: setOutfit, onChange: onChange,
    // (O-0040) 머리 스타일 · 서버 카탈로그
    catalogReady: catalogReady, reloadCatalog: loadCatalog, catalogState: function () { return { source: catState.source, url: catState.url, error: catState.error, at: catState.at }; },
    defaultHair: DEFAULT_HAIR, fixedHair: FIXED_HAIR, hair: hair, stillMode: stillMode,   // v9.6: 머리 고르기(setHair·hairs·hairThumbUrl·hasLook)는 없앴다
    // 지금 「보이는」 모습 이름(조합 사진이 없어 기본머리로 보일 땐 옷 이름만)
    lookName: function () { return outfit().name + (activeCombo() ? ' · ' + hair().name : ''); },
    avatarUrl: avatarUrl, exprUrl: exprUrl, thumbUrl: thumbUrl,
    fullbodyUrl: fullbodyUrl, bowUrl: bowUrl, bowPick: bowPick, bowList: bowList,        // (O-0116) · v9.6 인사 영상 여러 개
    poseUrl: poseUrl,                                // v9.4 일하는 자세 그림
    // v9.5 서버 자산
    assetsReady: assetsReady, bowState: bowState, callSet: callSet,
    assets: { state: function () { return ka.state; }, refresh: function () { return kaFetchManifest(true); }, ensureOutfit: ensureOutfit, ensureThumbs: ensureThumbs,
              wanting: function () { return ka.want; }, saveData: saveData },
    mount: function () { faces().forEach(paint); },
    restartFace: restartFace, hold: hold, faceFlash: faceFlash,
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
  // 시험 환경(로컬 시험 서버 127.0.0.1 + 가짜 통신)에서만: 받은 자산 상태를 들여다보는 창. 배포본(폰 앱 · PC판)에는 없다.
  if (location.hostname === '127.0.0.1' && window.__mock) {
    window.KChar.assets.info = function () { return { state: ka.state, outfits: Object.keys(ka.eff), stored: window.KStore ? KStore.names().length : 0, updated: ka.m && ka.m.updated }; };
    try { if (window.__kaTimeouts) { KA_LIST_MS = window.__kaTimeouts[0] || KA_LIST_MS; KA_FILE_MS = window.__kaTimeouts[1] || KA_FILE_MS; } } catch (e) {}   // 시험에서 시간 제한을 짧게
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.KChar.mount(); });
  else window.KChar.mount();
})();
