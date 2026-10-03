/* ============================================================================
 * today-card.js — 홈 「오늘 한눈에」 카드 (O-0129, 시안 단계 · 미배포)
 * ----------------------------------------------------------------------------
 * 홈 녹음/케이 오브 바로 아래 카드 한 장:
 *   ① 오늘 일정(시간순, 지금·다음 일정 강조)  ② 답할 메일(제목·보낸 사람 한 줄)  ③ 챙길 일(지시 대장 미완료)
 *   + [말로 일정 잡기] → 채팅 열고 음성 대화 시작(등록은 PC 케이가 확인 문구 한 번 뒤에만).
 * (O-0176) 홈 정리: ④ 「예약한 알림」 한 줄(가장 가까운 알림 + 외 N건, 누르면 목록·취소 화면)을 「챙길 일」 아래에 넣고,
 *   [말로 일정 잡기]와 예약한 알림 화면의 [케이에게 알림 부탁하기]를 [말로 맡기기 (일정·알림)] 하나로(같은 음성 대화).
 *   홈 「작업 현황」 카드가 빠졌으므로 「챙길 일」 아래 「작업 현황 보기」 링크는 건수와 무관하게 늘 보인다.
 *   예약한 알림은 연동 암호 RPC(reminder_list)를 읽기만 한다 — 요약과 같은 1분 간격, 실패하면 이 기기에 남은 개수로.
 * (O-0176 추가) 접기·펼치기: 머리줄(제목·▾ 버튼)을 누르면 접혀 한 줄 요약(「☁️ 19° · 일정 3 · 메일 2 · 챙길 일 3 · 알림 2」)만.
 *   상태는 이 기기에 기억(localStorage 'smart_today_fold', 실패해도 펼친 채로). 접혀 있어도 불러오기·숫자 갱신은 그대로.
 *
 * 데이터 경로(앱은 읽기만 한다):
 *   · ①② = 서버 사본 home_digest — PC(home_digest.py 예정)가 주기적으로 구글 캘린더·Gmail 을 「읽기 전용」으로
 *          요약해 올린 것. 조회는 연동 암호 게이트 RPC get_home_digest (OfficeBridge.getHomeDigest).
 *          서버가 아직 준비 안 됐으면(404) ①②는 조용히 숨기고 ③만 보인다.
 *   · ③   = 이미 있는 「작업 현황」 조회(list_office_orders) 결과를 그대로 받아 쓴다(추가 서버 호출 없음).
 *          app.js refreshOrders() 가 결과를 TodayCard.setOrders(rows) 로 넘겨 준다.
 *
 * (O-0133) 일정 옆 [길찾기] — 네이버 지도 「검색」으로 연다(키·비용 없음, 좌표 없음).
 *   · 네이버 대중교통 길찾기 스킴(nmap://route/public)은 도착지 좌표(dlat·dlng)가 「필수」라 장소 이름만으로는 못 쓴다.
 *     좌표를 AI 가 추측해 넣지 않는다 → nmap://search?query=장소 로 열고, 대표님이 네이버 지도에서 [도착] 한 번 더
 *     (출발지는 네이버 앱 기본값 = 현재 위치).
 *   · 폰(APK): 네이티브 ExternalApp.openUri(패키지 com.nhn.android.nmap) → 앱이 없으면 웹 지도(map.naver.com).
 *     PC판·옛 APK: 바로 웹 지도 검색.
 *   · 「3호관 301호」「대회의실」「본관 5층」처럼 건물 안 방 이름만 있으면 버튼을 숨긴다(검색해도 엉뚱한 곳).
 *     기관·주소 + 방 이름이면 방 부분만 떼고 검색(예: 「○○대학교 본관 2층 대회의실」 → 「○○대학교」).
 *     온라인 회의(Zoom·화상·온라인·주소 링크)도 숨긴다.
 * (v8.4 O-0162) 머리 아래 「출퇴근 날씨·우산」 한 줄 — PC(home_digest.py)가 Open-Meteo(키 없는 무료 날씨)를 파이썬으로 직접 읽어
 *   요약에 weather.slots(오늘 출근 07~09·퇴근 18~20, 내일 출근·퇴근 — 기온·체감·비 확률·우산 판정)를 넣는다. 서울 기준.
 *   지금 시각에 맞는 두 칸만 보인다(아침=오늘 출근·퇴근, 낮=오늘 퇴근·내일 출근, 밤=내일 출근·퇴근). 없으면 줄 자체를 숨긴다.
 * ⚠️ confirm() 금지(앱 함정) — 상세는 기존 확인 시트(SmartHome.sheet) 재사용.
 * ⚠️ 연동 암호가 없으면 카드 전체를 숨긴다(메일 제목 등이 암호 없이 보이면 안 됨).
 * ==========================================================================*/
(function (global) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var MAX_EV = 3, MAX_MAIL = 2, MAX_TASK = 2;   // 카드가 폰 한 화면을 넘지 않게(지난 일정은 접어 한 줄)
  var STALE_MIN = 180;                    // 요약이 3시간보다 오래되면 「오래된 정보」 표시
  var OPEN_ST = { '접수': 1, '진행': 1, '보류': 1, '실패': 1 };

  var st = { digest: null, digestReady: null, orders: null, busy: false, lastFetch: 0, wxLive: null, wxBusy: false, wxAt: 0, rems: null };

  function H() { return global.SmartHome || {}; }
  var FOLD_KEY = 'smart_today_fold';
  function isFolded() { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; } }
  function setFolded(v) { try { if (v) localStorage.setItem(FOLD_KEY, '1'); else localStorage.removeItem(FOLD_KEY); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function hm2min(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function hmOf(iso) { try { var d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); } catch (e) { return ''; } }

  /* ---------- (O-0133) 길찾기: 장소 문자열 → 네이버 지도 검색어 ('' 이면 버튼 없음) ---------- */
  var NMAP_PKG = 'com.nhn.android.nmap', NMAP_APPNAME = 'com.kwak.voicememo';
  var ONLINE_RE = /(zoom|줌|온라인|화상|비대면|webex|teams|팀즈|google\s*meet|구글\s*미트|https?:|www\.)/i;
  var ROOM_TOKEN = [
    /^(지하|B)?\d+(층|F)$/i,                  // 2층, B1층, 3F
    /^B\d+$/i,                                // B1
    /^[A-Za-z]?\d+(-\d+)*(호|호실)?$/,        // 301, 301호, A102, 3-301
    /^제?\d+(호관|관|동|강의동|공학관)$/,       // 3호관, 2관, 302동 (캠퍼스 안 건물 번호)
    /(실|룸|room)[A-Za-z0-9]*$/i,             // 회의실·대회의실·강의실·실험실·세미나실·교수실·처장실·회의실A
    /^(본관|신관|별관|구관|학생회관|도서관|로비|라운지|강당|대강당|소강당)$/   // 어느 기관 건물인지 알 수 없는 일반 명칭
  ];
  function routeQuery(place) {
    var p = String(place || '').trim();
    if (!p || ONLINE_RE.test(p)) return '';
    p = p.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ');            // 괄호 안 보충(층·호실 등)은 뺀다
    var toks = p.split(/[\s,·\/|]+/).filter(Boolean);
    var keep = toks.filter(function (t, i) {
      // 주소의 번지는 지우지 않는다: 「세종대로 110」「겸재로29길 27」「역삼동 123-4」
      if (/^\d+(-\d+)?$/.test(t) && i > 0 && /((로|길)|[^\d](동|리|가))$/.test(toks[i - 1])) return true;
      return !ROOM_TOKEN.some(function (re) { return re.test(t); });
    });
    var q = keep.join(' ').trim();
    if (q.replace(/[\d\s\-]/g, '').length < 2) return '';                 // 남은 게 숫자뿐이거나 한 글자면 숨김
    return q.slice(0, 60);
  }
  function openWebMap(q, why) {
    var url = q ? 'https://map.naver.com/p/search/' + encodeURIComponent(q) : 'https://map.naver.com/';   // q 없음 = 홈 「길찾기」 카드(지도만)
    var w = null;
    try { w = global.open(url, '_blank'); } catch (e) {}
    var S = H();
    if (!w) { if (S.toast) S.toast('지도를 열지 못했어요 — 다시 눌러 주세요.', 3000); return; }
    if (why === 'noapp' && S.toast) S.toast('네이버 지도 앱이 없어 웹 지도로 열었어요.', 3500);
  }
  function openNaverMap(q) {
    if (!q) return;
    var C = global.Capacitor;
    var native = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    var EA = native && C.Plugins && C.Plugins.ExternalApp;
    if (!EA || !EA.openUri) { openWebMap(q); return; }                // PC판·옛 APK → 웹 지도
    EA.openUri({ uri: 'nmap://search?query=' + encodeURIComponent(q) + '&appname=' + NMAP_APPNAME, pkg: NMAP_PKG })
      .then(function (r) { if (!r || !r.opened) openWebMap(q, 'noapp'); })
      .catch(function () { openWebMap(q, 'noapp'); });
  }

  /* v7.8 홈 「길찾기」 카드 — 검색어 없이 네이버 지도만 연다. 공식 URL Scheme 의 지도 화면(nmap://map, 좌표·줌은 선택).
   *   일정 [길찾기]와 같은 통로(ExternalApp.openUri → 앱 없으면 웹 지도). PC판·옛 APK 는 바로 웹 지도. */
  function openMapHome() {
    var C = global.Capacitor;
    var native = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
    var EA = native && C.Plugins && C.Plugins.ExternalApp;
    if (!EA || !EA.openUri) { openWebMap(''); return; }
    EA.openUri({ uri: 'nmap://map?appname=' + NMAP_APPNAME, pkg: NMAP_PKG })
      .then(function (r) { if (!r || !r.opened) openWebMap('', 'noapp'); })
      .catch(function () { openWebMap('', 'noapp'); });
  }

  /* ---------- 일정: 지금/다음 판정 ---------- */
  function markEvents(evs) {
    var now = nowMin(), nextDone = false;
    return (evs || []).map(function (e) {
      var s = e.all_day ? null : hm2min(e.start), en = e.all_day ? null : hm2min(e.end);
      var o = { e: e, state: '' };
      if (e.all_day) o.state = 'allday';
      else if (s != null && en != null && s <= now && now < en) o.state = 'now';
      else if (s != null && (en != null ? en <= now : s < now)) o.state = 'past';
      else if (!nextDone) { o.state = 'next'; nextDone = true; }
      if (o.state === 'now') nextDone = true;      // 진행 중 일정이 있으면 그게 강조(다음은 표시 안 함)
      return o;
    });
  }
  function evRow(o, i) {
    var e = o.e, time = e.all_day ? '종일' : esc(e.start || '') + (e.end ? '<small>~' + esc(e.end) + '</small>' : '');
    var tag = o.state === 'now' ? '<span class="td-tag now">지금</span>' : (o.state === 'next' ? '<span class="td-tag next">다음</span>' : '');
    var rq = routeQuery(e.place);
    // (O-0133) 줄 전체(상세 시트)와 [길찾기]를 서로 다른 버튼으로(버튼 안에 버튼 금지) — 상태 배경은 바깥 줄(div)이 가진다
    return '<div class="td-row ev ' + o.state + (rq ? ' has-route' : '') + '">' +
      '<button type="button" class="td-evbtn" data-td="ev" data-i="' + i + '">' +
      '<span class="td-time">' + time + '</span>' +
      '<span class="td-main"><b>' + esc(e.title || '(제목 없음)') + '</b>' + (e.place ? '<small>' + esc(e.place) + '</small>' : '') + '</span>' +
      tag + '</button>' +
      (rq ? '<button type="button" class="td-route" data-td="route" data-i="' + i + '" aria-label="' + esc(rq) + ' 길찾기 — 네이버 지도">' +
            '<svg><use href="#i-route"/></svg><span>길찾기</span></button>' : '') +
      '</div>';
  }
  function mailRow(m, i) {
    return '<button type="button" class="td-row mail" data-td="mail" data-i="' + i + '">' +
      '<span class="td-dot"></span>' +
      '<span class="td-main"><b>' + esc(m.subject || '(제목 없음)') + '</b><small>' + esc(m.from || '') + (m.why ? ' · ' + esc(m.why) : '') + '</small></span>' +
      '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
  }
  function taskChip(o) {
    if (o.job_status === 'need_approval') return '<span class="td-tag warn">확인 필요</span>';
    if (o.status === '보류') return '<span class="td-tag warn">보류</span>';
    if (o.status === '실패') return '<span class="td-tag bad">실패</span>';
    if (o.status === '진행') return '<span class="td-tag next">진행</span>';
    return '<span class="td-tag">접수</span>';
  }
  function taskRank(o) {                  // 대표님 손이 필요한 것 먼저
    if (o.job_status === 'need_approval') return 0;
    if (o.status === '보류' || o.status === '실패') return 1;
    if (o.status === '진행') return 2;
    return 3;
  }
  function openTasks() {
    return (st.orders || []).filter(function (o) { return OPEN_ST[o.status]; })
      .sort(function (a, b) { return taskRank(a) - taskRank(b) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  }
  function taskRow(o) {
    return '<button type="button" class="td-row task" data-td="task" data-oid="' + esc(o.id) + '">' +
      taskChip(o) +
      '<span class="td-main"><b>' + esc(o.summary || '(요지 없음)') + '</b><small>' + esc(o.id) + (o.channel ? ' · ' + esc(o.channel) : '') + '</small></span>' +
      '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
  }
  /* ---------- (O-0176) 접힌 카드 한 줄 요약 ---------- */
  function foldLine(dg, showDigest, evs, mails, tasks) {
    var parts = [];
    var w = showDigest ? wxData(dg) : null, n = wxNow(w);
    if (n) parts.push(wxCond(n.code, n.night)[0] + ' ' + esc(n.temp) + '°');
    if (showDigest && dg) {
      parts.push('일정 ' + evs.length);                             // 펼친 카드의 「오늘 일정 N」과 같은 수(오늘 전체)
      parts.push('메일 ' + mails.length);
    }
    if (st.orders) parts.push('챙길 일 ' + tasks.length);
    var rn = st.rems ? st.rems.length : remCountCached();
    parts.push('알림 ' + rn);
    return '<button type="button" class="td-foldline" data-td="fold" aria-label="오늘 한눈에 펼치기">' +
      '<span>' + parts.join('<i> · </i>') + '</span><small>펼치기</small></button>';
  }

  /* ---------- (O-0176) 예약한 알림 한 줄 ---------- */
  var REM_ACTIVE = { active: 1, sending: 1 };
  function remDay(iso) {                                           // 「오늘」「내일」「10/5」(한국 날짜)
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var a = kst(t), n = kst(Date.now()), n1 = kst(Date.now() + 86400000);
    if (a.date === n.date) return '오늘';
    if (a.date === n1.date) return '내일';
    return (+a.date.slice(5, 7)) + '/' + (+a.date.slice(8, 10));
  }
  function remCountCached() { try { return parseInt(localStorage.getItem('smart_rem_count') || '0', 10) || 0; } catch (e) { return 0; } }
  function remSec() {
    var list = st.rems, n = list ? list.length : remCountCached();
    var body;
    if (list && list.length) {
      var r = list[0];
      body = '<button type="button" class="td-row task" data-td="rems">' +
        '<span class="td-tag next">' + esc(remDay(r.fire_at) || '예약') + '</span>' +
        '<span class="td-main"><b>' + esc(kstHM(r.fire_at)) + '  ' + esc(r.body || '(내용 없음)') + '</b>' +
        '<small>' + (list.length > 1 ? '외 ' + (list.length - 1) + '건 · ' : '') + '누르면 목록·취소</small></span>' +
        '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
    } else if (!list && n > 0) {
      body = '<button type="button" class="td-more" data-td="rems">' + n + '건 예약돼 있어요 · 목록·취소 보기</button>';
    } else {
      body = '<button type="button" class="td-more" data-td="rems">예약한 알림이 없어요 · 지난 알림 보기</button>';
    }
    return sec('i-alarm', '예약한 알림', n || null, body);
  }
  function sec(icon, title, count, body, more) {
    return '<div class="td-sec"><div class="td-sh"><svg><use href="#' + icon + '"/></svg><span>' + title + '</span>' +
      (count != null ? '<em>' + count + '</em>' : '') + (more ? '<small>' + more + '</small>' : '') + '</div>' + body + '</div>';
  }

  /* ---------- (v8.4) 출퇴근 날씨·우산 한 줄 → (v8.5 O-0169) 맨 앞에 「지금 날씨」, 누르면 오늘 1시간 단위 ---------- */
  /* (O-0169) 「지금」을 신선하게: 앱이 Open-Meteo(키·가입·비용 없는 무료 날씨)를 직접 읽는다.
   *   · PC 요약(home_digest.py)은 07~21시 매시라 「지금」이 최대 1시간 묵고 밤·새벽엔 비어 있다 → 앱이 직접 받으면 15분 단위 관측값.
   *   · 보내는 것은 서울 시청 좌표뿐(PC 와 같은 값) — 대표님 위치·개인정보는 나가지 않는다(위치 권한도 쓰지 않음).
   *   · 홈이 보이는 동안 10분에 한 번, 날씨를 눌러 열 때 3분보다 묵었으면 한 번 더. 실패하면 PC 요약 값으로(「16시 예보」라고 표시).
   *   · PC 요약에 weather 가 있을 때만(= PC 스위치 v84_switch.json "weather" 가 켜져 있을 때만) 부른다 — 끄는 곳은 여전히 한 곳.
   *   · 시각은 기기 시간대와 무관하게 한국시간(+9)으로 맞춘다. */
  var WX_LAT = 37.5665, WX_LON = 126.9780, WX_TTL = 10 * 60000, WX_SHEET_TTL = 3 * 60000;
  var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + WX_LAT + '&longitude=' + WX_LON +
    '&current=temperature_2m,apparent_temperature,precipitation,weather_code,is_day' +
    '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code' +
    '&timezone=Asia%2FSeoul&forecast_days=2';
  var UM_PROB = 50, UM_MAYBE = 30;                                 // home_digest.py 와 같은 우산 기준(비 확률 %)
  var SNOW_CODES = [71, 73, 75, 77, 85, 86];
  function kst(ms) {                                               // 한국시간 {date:'YYYY-MM-DD', hour, min}
    var d = new Date((ms == null ? Date.now() : ms) + 9 * 3600000);
    return { date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()), hour: d.getUTCHours(), min: d.getUTCMinutes() };
  }
  function kstHM(iso) { var t = Date.parse(iso || ''); if (isNaN(t)) return ''; var k = kst(t); return pad(k.hour) + ':' + pad(k.min); }
  function wxCond(code, night) {                                   // WMO 날씨 코드 → [그림, 말]
    var c = code == null ? -1 : +code;
    if (c === 0) return night ? ['🌙', '맑음'] : ['☀️', '맑음'];
    if (c === 1) return night ? ['🌙', '대체로 맑음'] : ['🌤️', '대체로 맑음'];
    if (c === 2) return ['⛅', '구름 조금'];
    if (c === 3) return ['☁️', '흐림'];
    if (c === 45 || c === 48) return ['🌫️', '안개'];
    if (c >= 51 && c <= 57) return [night ? '🌧️' : '🌦️', '이슬비'];
    if (c >= 61 && c <= 67) return ['🌧️', '비'];
    if (c >= 71 && c <= 77) return ['🌨️', '눈'];
    if (c >= 80 && c <= 82) return [night ? '🌧️' : '🌦️', '소나기'];
    if (c === 85 || c === 86) return ['🌨️', '눈 소나기'];
    if (c >= 95) return ['⛈️', '뇌우'];
    return ['🌡️', ''];
  }
  function isNight(h) { return h < 6 || h >= 19; }
  function umOf(prob, mm) { return (prob >= UM_PROB || mm >= 1) ? 'yes' : ((prob >= UM_MAYBE || mm >= 0.2) ? 'maybe' : 'no'); }

  /* Open-Meteo 응답 → home_digest 와 같은 모양(slots·today_hourly) + cur(지금 관측값) + tmr_hourly */
  function wxFromApi(d) {
    var h = d && d.hourly, c = d && d.current; if (!h || !h.time || !c) return null;
    var k = kst(), tmrDate = kst(Date.now() + 86400000).date, rows = {};
    h.time.forEach(function (t, i) {
      var day = t.slice(0, 10), hr = +t.slice(11, 13), tp = h.temperature_2m[i]; if (tp == null) return;
      (rows[day] = rows[day] || []).push({ hour: hr, temp: Math.round(tp),
        feels: h.apparent_temperature[i] == null ? null : Math.round(h.apparent_temperature[i]),
        prob: Math.round(h.precipitation_probability[i] || 0), mm: Math.round((h.precipitation[i] || 0) * 10) / 10,
        snow: SNOW_CODES.indexOf(h.weather_code[i]) !== -1, code: h.weather_code[i] });
    });
    if (!rows[k.date]) return null;
    function win(day, h0, h1) {                                    // home_digest._wx_window 와 같은 셈(평균 기온·최저 체감·최대 확률·합계 mm)
      var xs = (rows[day] || []).filter(function (x) { return x.hour >= h0 && x.hour <= h1; }); if (!xs.length) return null;
      var ft = xs.map(function (x) { return x.feels; }).filter(function (v) { return v != null; });
      var prob = Math.max.apply(null, xs.map(function (x) { return x.prob; }));
      var mm = Math.round(xs.reduce(function (s, x) { return s + x.mm; }, 0) * 10) / 10;
      var raw = xs.map(function (x) { return h.temperature_2m[h.time.indexOf(day + 'T' + pad(x.hour) + ':00')]; });
      return { temp: Math.round(raw.reduce(function (s, v) { return s + v; }, 0) / raw.length), feels: ft.length ? Math.min.apply(null, ft) : null,
        prob: prob, mm: mm, snow: xs.some(function (x) { return x.snow; }), umbrella: umOf(prob, mm) };
    }
    var slots = [];
    [[k.date, ''], [tmrDate, 'tmr_']].forEach(function (dd) {
      [['am', '출근', 7, 9], ['pm', '퇴근', 18, 20]].forEach(function (c2) {
        var w = win(dd[0], c2[2], c2[3]); if (!w) return;
        w.key = dd[1] + c2[0]; w.label = (dd[1] ? '내일 ' : '') + c2[1]; w.date = dd[0]; w.from = c2[2]; w.to = c2[3]; slots.push(w);
      });
    });
    var curHr = rows[k.date].filter(function (x) { return x.hour === k.hour; })[0];
    return { place: '서울', source: 'Open-Meteo', live: true, fetched_at: new Date().toISOString(), slots: slots,
      today_hourly: rows[k.date], hourly_date: k.date, tmr_hourly: rows[tmrDate] || [],
      cur: { at: String(c.time || '').slice(11, 16), temp: Math.round(c.temperature_2m),
        feels: c.apparent_temperature == null ? null : Math.round(c.apparent_temperature),
        mm: Math.round((c.precipitation || 0) * 10) / 10, code: c.weather_code, night: c.is_day === 0,
        prob: curHr ? curHr.prob : null } };
  }
  function wxOn() { return !!(st.digest && st.digest.weather); }   // PC 날씨 스위치가 켜져 있을 때만 앱도 직접 읽는다
  function wxLiveFetch(force) {
    if (st.wxBusy || !wxOn() || typeof fetch !== 'function') return;
    if (!force && Date.now() - (st.wxAt || 0) < WX_TTL) return;
    st.wxBusy = true; st.wxAt = Date.now();
    var ctl = null, tm = null;
    try { ctl = new AbortController(); tm = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 8000); } catch (e) {}
    fetch(WX_URL, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { var w = wxFromApi(d); if (w) st.wxLive = w; })
      .catch(function () {})                                       // 실패해도 조용히 PC 요약 값으로(카드는 그대로)
      .then(function () { if (tm) clearTimeout(tm); st.wxBusy = false; render(); if (wxSheet) wxSheetFill(); });
  }
  /* 지금 쓸 날씨 묶음 — 오늘 것인 앱 직접값 > 오늘 PC 요약. 둘 다 없으면 null */
  function wxData(dg) {
    var k = kst();
    if (st.wxLive && st.wxLive.hourly_date === k.date) return st.wxLive;
    var w = dg && dg.weather; if (!w || !w.slots) return null;
    if (w.today_hourly && w.hourly_date && w.hourly_date !== k.date) { w = Object.assign({}, w); delete w.today_hourly; }
    return w;
  }
  /* 「지금」 값 — 앱 직접값이면 관측(live), 아니면 PC 요약에서 이번 시각 예보. 시간값이 없는 옛 요약이면 null */
  function wxNow(w) {
    if (!w) return null;
    var k = kst();
    if (w.live && w.cur) return { temp: w.cur.temp, feels: w.cur.feels, prob: w.cur.prob, mm: w.cur.mm, code: w.cur.code, night: w.cur.night, live: true, at: w.cur.at || kstHM(w.fetched_at) };
    var hl = w.today_hourly || [], x = null;
    for (var i = 0; i < hl.length; i++) if (hl[i] && hl[i].hour === k.hour) { x = hl[i]; break; }
    if (!x) return null;
    return { temp: x.temp, feels: x.feels, prob: x.prob, mm: x.mm, code: x.code, night: isNight(k.hour), live: false, at: pad(k.hour) + ':00' };
  }
  function wxPick(slots) {
    var by = {}; (slots || []).forEach(function (x) { if (x && x.key) by[x.key] = x; });
    var k = kst(), m = k.hour * 60 + k.min, keys;
    if (m < 9 * 60 + 30) keys = ['am', 'pm'];                 // 아침: 오늘 출근 · 퇴근
    else if (m < 20 * 60 + 30) keys = ['pm', 'tmr_am'];     // 낮: 오늘 퇴근 · 내일 출근
    else keys = ['tmr_am', 'tmr_pm'];                        // 밤: 내일 출근 · 퇴근
    return keys.map(function (k2) { return by[k2]; }).filter(Boolean);
  }
  function wxSeg(x) {
    var feels = (x.feels != null && Math.abs(x.feels - x.temp) >= 3) ? '<i>(체감 ' + esc(x.feels) + '°)</i>' : '';
    return '<span class="wx-seg"><em>' + esc(x.label) + '</em> ' + esc(x.temp) + '°' + feels + ' · 비 ' + esc(x.prob) + '%</span>';
  }
  function wxRow(dg) {
    var w = wxData(dg); if (!w) return '';
    var pick = wxPick(w.slots);
    var yes = pick.filter(function (x) { return x.umbrella === 'yes'; })[0], maybe = pick.filter(function (x) { return x.umbrella === 'maybe'; })[0];
    var snow = pick.some(function (x) { return x.snow; });
    var cls = 'ok', ic = '☀️', tip = '우산 필요 없어요';
    if (yes) { cls = 'rain'; ic = snow ? '❄️' : '☂️'; tip = (snow ? '눈 소식 — ' : '') + '우산 챙기세요' + (pick.length > 1 ? ' (' + yes.label + ')' : ''); }
    else if (maybe) { cls = 'maybe'; ic = '🌂'; tip = '작은 우산 있으면 좋아요' + (pick.length > 1 ? ' (' + maybe.label + ')' : ''); }
    var n = wxNow(w), sep = '<span class="wx-sep"> · </span>';
    if (!n) {                                                      // 옛 요약(시간값 없음) → v8.4 모양 그대로
      if (!pick.length) return '';
      return '<button type="button" class="td-wx ' + cls + '" data-td="wx"><span class="wx-ic" aria-hidden="true">' + ic + '</span>' +
        '<span class="td-main"><b>' + esc(tip) + '</b><small>' + pick.map(wxSeg).join(sep) + '</small></span>' +
        '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
    }
    // (O-0169) 굵은 줄 = 지금 날씨(그림·기온·하늘·체감), 아래 줄 = 우산 판정 + 출퇴근 두 칸
    var cd = wxCond(n.code, n.night), fl = (n.feels != null && Math.abs(n.feels - n.temp) >= 3) ? ' <i>체감 ' + esc(n.feels) + '°</i>' : '';
    return '<button type="button" class="td-wx now ' + cls + '" data-td="wx" aria-label="' + (n.live ? '지금' : esc(n.at.slice(0, 2)) + '시 예보') + ' ' + esc(n.temp) + '도 ' + esc(cd[1]) + ', ' + esc(tip) + ' — 1시간 단위 보기">' +
      '<span class="wx-ic" aria-hidden="true">' + cd[0] + '</span>' +
      '<span class="td-main"><b><span class="wx-now">' + (n.live ? '지금' : esc(n.at.slice(0, 2)) + '시') + '</span> ' + esc(n.temp) + '°' +
        (cd[1] ? ' <span class="wx-cond">' + esc(cd[1]) + '</span>' : '') + fl + '</b>' +
      '<small><span class="wx-seg wx-tip">' + (cls !== 'ok' ? ic + ' ' : '') + esc(tip) + '</span>' + (pick.length ? sep + pick.map(wxSeg).join(sep) : '') + '</small></span>' +
      '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
  }

  /* ---------- (O-0169) 날씨 자세히 — 전용 시트: 지금(크게) + 1시간 단위 가로 줄(지금 시각이 맨 왼쪽) ---------- */
  var wxSheet = null;
  function wxSheetClose() { if (wxSheet) { try { wxSheet.remove(); } catch (e) {} wxSheet = null; } }
  function wxCell(x, k, isTmr, n) {
    var cur = !isTmr && x.hour === k.hour, past = !isTmr && x.hour < k.hour;
    if (cur && n && n.live) x = Object.assign({}, x, { temp: n.temp, code: n.code });   // 「지금」 칸 = 위 큰 숫자와 같은 값(시간 예보와 1~2° 어긋나 보이지 않게)
    var rain = (x.prob >= UM_PROB || x.mm >= 1) ? ' wet' : ((x.prob >= UM_MAYBE || x.mm >= 0.2) ? ' damp' : '');
    var icon = x.code == null ? (x.snow ? '🌨️' : (x.prob >= UM_PROB ? '🌧️' : '')) : wxCond(x.code, isNight(x.hour))[0];
    return '<div class="wx-h' + (cur ? ' cur' : '') + (past ? ' past' : '') + rain + '" role="listitem"' + (cur ? ' data-cur="1"' : '') + '>' +
      '<span class="wx-hh">' + (cur ? '지금' : x.hour + '시') + '</span>' +
      '<span class="wx-hi" aria-hidden="true">' + (icon || '&nbsp;') + '</span>' +
      '<b class="wx-ht">' + esc(x.temp) + '°</b>' +
      '<span class="wx-hp">' + (x.prob > 0 ? '💧' + esc(x.prob) + '%' : '<i>0%</i>') + '</span>' +
      (x.mm ? '<span class="wx-hm">' + esc(x.mm) + 'mm</span>' : '') + '</div>';
  }
  function wxSheetBody() {
    var dg = st.digest && st.digest.date === todayKey() ? st.digest : null, w = wxData(dg);
    if (!w) return '<div class="wx-empty">날씨를 아직 못 받았어요. 잠시 뒤 다시 열어 주세요.</div>';
    var k = kst(), n = wxNow(w), um = { yes: '☂️ 우산 챙기세요', maybe: '🌂 작은 우산 있으면 좋아요', no: '우산 필요 없어요' };
    var hl = (w.today_hourly || []).filter(function (x) { return x && x.hour != null && x.temp != null; }), h = '';
    if (n) {
      var cd = wxCond(n.code, n.night), sub = [];
      if (n.feels != null) sub.push('체감 ' + esc(n.feels) + '°');
      if (n.prob != null) sub.push('비 ' + esc(n.prob) + '%');
      if (n.mm) sub.push(esc(n.mm) + 'mm');
      h += '<div class="wx-nowbox"><span class="wx-big-ic" aria-hidden="true">' + cd[0] + '</span>' +
        '<div class="wx-nowtx"><div class="wx-big"><b>' + esc(n.temp) + '°</b><span>' + esc(cd[1] || '') + '</span></div>' +
        '<small>' + sub.join(' · ') + '</small>' +
        '<small class="wx-at">' + (n.live ? esc(n.at) + ' 기준 · 앱이 바로 받은 값' : esc(n.at) + ' 예보 (PC 요약 ' + esc(kstHM(w.fetched_at)) + ')') + '</small></div></div>';
    }
    if (hl.length) {
      var next = hl.filter(function (x) { return x.hour >= k.hour; }), tt = hl.map(function (x) { return x.temp; });
      if (next.length) {
        var mx = Math.max.apply(null, next.map(function (x) { return x.prob; })), mm = next.reduce(function (s, x) { return s + (x.mm || 0); }, 0), u = umOf(mx, mm);
        h += '<div class="wx-sum ' + u + '">남은 하루 · ' + um[u] + ' <i>(비 최대 ' + mx + '%)</i></div>';
      }
      h += '<div class="wx-lab"><b>오늘 1시간 단위</b><span>최저 ' + Math.min.apply(null, tt) + '° · 최고 ' + Math.max.apply(null, tt) + '°</span></div>';
      var cells = hl.map(function (x) { return wxCell(x, k, false, n); }).join('');
      if (k.hour >= 18 && w.tmr_hourly && w.tmr_hourly.length) {    // 저녁엔 내일 아침(0~9시)까지 이어서
        cells += '<div class="wx-day" aria-hidden="true">내일</div>' + w.tmr_hourly.filter(function (x) { return x.hour <= 9; }).map(function (x) { return wxCell(x, k, true, null); }).join('');
      }
      h += '<div class="wx-hours" role="list" aria-label="1시간 단위 날씨 — 옆으로 밀어 보기">' + cells + '</div>' +
        '<div class="wx-swipe" aria-hidden="true">← 옆으로 밀어 지난 시간·남은 시간 보기 →</div>';
    }
    var tmr = (w.slots || []).filter(function (x) { return x.key === 'tmr_am' || x.key === 'tmr_pm'; });
    var tod = (w.slots || []).filter(function (x) { return (x.key === 'am' && k.hour < 10) || (x.key === 'pm' && k.hour < 21); });
    var show = hl.length ? (k.hour >= 17 ? tmr : tod) : (w.slots || []);   // 옛 요약 → 출퇴근 칸 전부
    if (show.length) {
      h += '<div class="wx-lab"><b>' + (hl.length && k.hour >= 17 ? '내일 출퇴근' : '출퇴근') + '</b></div><div class="wx-com">' +
        show.map(function (x) {
          return '<div><em>' + esc(x.label) + '</em><span>' + x.from + '~' + x.to + '시</span><b>' + esc(x.temp) + '°</b><span>비 ' + esc(x.prob) + '%</span><small>' + esc(um[x.umbrella] || '') + '</small></div>';
        }).join('') + '</div>';
    }
    h += '<div class="wx-src">' + esc(w.place || '서울') + '(시청) 기준 · Open-Meteo · ' + (w.live ? esc(kstHM(w.fetched_at)) + ' 받음' : 'PC 요약 ' + esc(kstHM(w.fetched_at))) + '</div>';
    return h;
  }
  function wxSheetFill() {
    if (!wxSheet) return;
    var body = wxSheet.querySelector('.wx-body'), sc0 = body.querySelector('.wx-hours'), keep = sc0 ? sc0.scrollLeft : null;
    body.innerHTML = wxSheetBody();
    var sc = body.querySelector('.wx-hours'); if (!sc) return;
    var cur = sc.querySelector('[data-cur]');
    if (keep != null) sc.scrollLeft = keep;                        // 새 값이 와도 보던 자리 유지
    else if (cur) sc.scrollLeft = Math.max(0, cur.offsetLeft - sc.offsetLeft - 4);   // 처음 열 때 = 지금 시각이 맨 왼쪽
  }
  function wxSheetOpen() {
    wxSheetClose();
    wxSheet = document.createElement('div');
    wxSheet.className = 'sheet wx-sheet';
    wxSheet.innerHTML = '<div class="sheet-box" role="dialog" aria-label="오늘 날씨"><div class="sheet-head">오늘 날씨</div><div class="wx-body"></div>' +
      '<button type="button" class="sheet-btn" data-wx="ask"><svg><use href="#i-chat"/></svg><span>케이에게 묻기</span></button>' +
      '<button type="button" class="sheet-btn" data-wx="close">닫기</button></div>';
    wxSheet.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-wx]') : null;
      if (b && b.getAttribute('data-wx') === 'ask') { wxSheetClose(); var S = H(); if (S.draft) S.draft('오늘 날씨 관련해서 '); return; }
      if (ev.target === wxSheet || b) wxSheetClose();
    });
    document.body.appendChild(wxSheet);
    wxSheet.style.display = 'flex';
    wxSheetFill();
    if (Date.now() - (st.wxAt || 0) > WX_SHEET_TTL) wxLiveFetch(true);   // 열 때 3분보다 묵었으면 한 번 더 받아 고쳐 그림
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var card = $('todayCard'); if (!card) return;
    var pass = H().getSyncPass ? H().getSyncPass() : '';
    if (!pass) { card.style.display = 'none'; return; }            // 암호 없으면 카드 자체를 안 보인다
    var d = new Date();
    var dg = st.digest && st.digest.date === todayKey(d) ? st.digest : null;   // 어제 요약이면 일정·메일은 쓰지 않음
    var showDigest = st.digestReady !== false;                     // 서버 미준비(404)면 ①② 숨김
    var tasks = openTasks();
    var evs = dg ? markEvents(dg.events || []) : [];
    var mails = dg ? (dg.mails || []) : [];

    var hdrNote = '';
    if (showDigest && dg && dg.generated_at) {
      var age = (Date.now() - new Date(dg.generated_at).getTime()) / 60000;
      hdrNote = (age > STALE_MIN ? '<span class="td-stale">' : '<span>') + esc(hmOf(dg.generated_at)) + ' 기준</span>';
    } else if (showDigest && st.digest === null && st.busy) hdrNote = '<span>불러오는 중…</span>';

    var folded = isFolded();
    var h = '<div class="td-head"><button type="button" class="td-ttl" data-td="fold" aria-expanded="' + (folded ? 'false' : 'true') + '"><b>오늘 한눈에</b><span>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')</span></button>' +
      '<div class="td-meta">' + hdrNote + '<button type="button" class="td-refresh" data-td="refresh" aria-label="새로 고침"><svg><use href="#i-refresh"/></svg></button>' +
      '<button type="button" class="td-foldbtn' + (folded ? ' on' : '') + '" data-td="fold" aria-label="' + (folded ? '펼치기' : '접기') + '"><svg><use href="#i-chev-r"/></svg></button></div></div>';
    if (folded) {                                                  // (O-0176) 접힘 — 한 줄 요약만(숫자는 매번 새로 셈)
      if (showDigest) wxLiveFetch(false);
      card.innerHTML = h + foldLine(dg, showDigest, evs, mails, tasks);
      card.style.display = '';
      card.classList.add('folded');
      card._evs = evs; card._mails = mails;
      return;
    }
    card.classList.remove('folded');

    if (showDigest && (dg || (st.wxLive && wxOn()))) h += wxRow(dg);   // v8.4 출퇴근 날씨 → v8.5(O-0169) 지금 날씨(없으면 '')
    if (showDigest) wxLiveFetch(false);                            // (O-0169) 10분에 한 번 앱이 직접 「지금」 날씨를 받는다
    var nothing = !evs.length && !mails.length && !tasks.length;
    if (nothing && (dg || !showDigest) && st.orders) {
      h += '<div class="td-empty"><span class="td-empty-ic"><svg><use href="#i-check"/></svg></span>' +
        '<div><b>오늘은 챙길 게 없어요</b><small>일정·답할 메일·기다리는 일이 모두 비어 있어요.</small></div></div>' +
        '<button type="button" class="td-more" data-td="tasks">작업 현황 보기 (끝난 일 포함)</button>';   // (O-0176) 홈 카드 대신
    } else {
      if (showDigest) {
        if (dg && dg.cal_ok === false) h += sec('i-flag', '오늘 일정', null, '<div class="td-none warn">일정을 못 불러왔어요 · PC가 다시 시도해요</div>');
        else if (dg) {
          // 지난 일정은 접고(한 줄), 지금·앞으로 일정만 최대 MAX_EV 건. 종일 일정은 맨 앞.
          var live = [], pastN = 0;
          evs.forEach(function (o, i) { if (o.state === 'past') pastN++; else live.push([o, i]); });
          var ev = live.slice(0, MAX_EV), rest = live.length - ev.length;
          var moreTxt = [];
          if (rest > 0) moreTxt.push('외 ' + rest + '건');
          if (pastN > 0) moreTxt.push('지난 일정 ' + pastN + '건');
          h += sec('i-flag', '오늘 일정', evs.length || null,
            evs.length ? (ev.length ? ev.map(function (x) { return evRow(x[0], x[1]); }).join('') : '<div class="td-none">남은 일정이 없어요</div>') +
                         (moreTxt.length ? '<button type="button" class="td-more" data-td="evmore">' + moreTxt.join(' · ') + ' — 전체 보기</button>' : '')
                       : '<div class="td-none">오늘 등록된 일정이 없어요</div>');
        }
        if (dg && dg.mail_ok === false) h += sec('i-mail', '답할 메일', null, '<div class="td-none warn">메일을 못 불러왔어요 · PC가 다시 시도해요</div>');
        else if (dg) {
          h += sec('i-mail', '답할 메일', mails.length || null,
            mails.length ? mails.slice(0, MAX_MAIL).map(mailRow).join('') : '<div class="td-none">답이 필요해 보이는 메일이 없어요</div>');
        }
      }
      if (st.orders) {
        var tk = tasks.slice(0, MAX_TASK), trest = tasks.length - tk.length;
        h += sec('i-tasks', '챙길 일', tasks.length || null,
          (tasks.length ? tk.map(taskRow).join('') : '<div class="td-none">기다리는 일이 없어요</div>') +
          '<button type="button" class="td-more" data-td="tasks">' + (trest > 0 ? '외 ' + trest + '건 · ' : '') + '작업 현황 보기</button>');   // (O-0176) 늘 보임
      }
    }
    h += remSec();                                                 // (O-0176) 예약한 알림 한 줄(홈 카드 대신)
    h += '<button type="button" class="td-voice" data-td="voice"><span class="td-voice-ic"><svg><use href="#i-mic"/></svg></span>' +
      '<span><b>말로 맡기기 (일정·알림)</b><small>예) “내일 3시 회의 잡아 줘” · “8시에 우산 알려 줘”</small></span></button>';
    card.innerHTML = h;
    card.style.display = '';
    card._evs = evs; card._mails = mails;
  }

  /* ---------- 불러오기 ---------- */
  function refresh(silent) {
    var pass = H().getSyncPass ? H().getSyncPass() : '';
    if (!pass) { render(); return; }
    var OB = global.OfficeBridge;
    if (!OB || !OB.getHomeDigest) { st.digestReady = false; render(); return; }
    if (st.busy) return;
    if (silent && Date.now() - st.lastFetch < 60000) { render(); return; }   // 홈 왕복마다 부르지 않게(1분)
    st.busy = true; st.lastFetch = Date.now(); render();
    if (OB.listReminders) {                                        // (O-0176) 예약한 알림 한 줄 — 읽기만, 실패는 조용히(이 기기 개수로)
      OB.listReminders(pass).then(function (rows) { setRems(rows); }).catch(function () {});
    }
    OB.getHomeDigest(pass).then(function (dg) {
      st.busy = false; st.digestReady = true; st.digest = dg || {}; render();
    }).catch(function (e) {
      st.busy = false;
      if (e && e.notready) st.digestReady = false;                 // 서버 준비 전 → ①② 숨김, ③만
      render();
    });
  }

  function setRems(rows) {                                         // 서버 행 전체 → 예약 중인 것만 가까운 순
    st.rems = (Array.isArray(rows) ? rows : []).filter(function (r) { return REM_ACTIVE[r.status]; })
      .sort(function (a, b) { return (Date.parse(a.fire_at) || 0) - (Date.parse(b.fire_at) || 0); });
    try { localStorage.setItem('smart_rem_count', String(st.rems.length)); } catch (e) {}
    render();
  }

  /* ---------- 누르면 ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('#todayCard [data-td]') : null;
    if (!t) return;
    ev.preventDefault();
    var card = $('todayCard'), kind = t.getAttribute('data-td'), S = H();
    if (kind === 'fold') { setFolded(!isFolded()); render(); return; }   // (O-0176) 접기·펼치기
    if (kind === 'refresh') { st.lastFetch = 0; refresh(false); wxLiveFetch(true); if (S.refreshOrders) S.refreshOrders(); return; }
    if (kind === 'voice') { if (S.startVoiceSchedule) S.startVoiceSchedule(); return; }
    if (kind === 'rems') { if (S.openReminders) S.openReminders(); return; }   // (O-0176) 예약한 알림 목록·취소
    if (kind === 'wx') { wxSheetOpen(); return; }                 // v8.5(O-0169): 지금 + 1시간 단위 시트
    if (kind === 'tasks' || kind === 'evmore') {
      if (kind === 'tasks' && S.openOrders) S.openOrders();
      if (kind === 'evmore') { var all = (card._evs || []).map(function (o) { var e = o.e; return (e.all_day ? '종일' : (e.start || '') + (e.end ? '~' + e.end : '')) + '  ' + (e.title || ''); }).join('\n'); if (S.sheet) S.sheet('오늘 일정 전체', all, '케이에게 묻기', 'i-chat', function () { if (S.draft) S.draft('오늘 일정 중에서 '); }); }
      return;
    }
    if (kind === 'task') { if (S.openOrders) S.openOrders(t.getAttribute('data-oid')); return; }
    var i = +t.getAttribute('data-i');
    if (kind === 'route') {
      var re = ((card._evs || [])[i] || {}).e; if (!re) return;
      openNaverMap(routeQuery(re.place));
      return;
    }
    if (kind === 'ev') {
      var e = ((card._evs || [])[i] || {}).e; if (!e) return;
      var when = e.all_day ? '종일' : (e.start || '') + (e.end ? ' ~ ' + e.end : '');
      if (S.sheet) S.sheet(e.title || '일정', when + (e.place ? '\n장소: ' + e.place : '') + (e.memo ? '\n' + e.memo : ''),
        '케이에게 묻기', 'i-chat', function () { if (S.draft) S.draft('「' + (e.title || '') + '」(' + when + ') 일정 관련해서 '); });
    } else if (kind === 'mail') {
      var m = (card._mails || [])[i]; if (!m) return;
      if (S.sheet) S.sheet(m.subject || '메일', '보낸 사람: ' + (m.from || '') + (m.why ? '\n' + m.why : '') + (m.received_at ? '\n받은 때: ' + hmOf(m.received_at) : ''),
        '답장 초안 부탁', 'i-chat', function () { if (S.draft) S.draft('「' + (m.subject || '') + '」(' + (m.from || '') + ') 메일, 답장 초안 써 줘'); });
    }
  });
  // 자정을 넘기거나 시간이 흘러 「지금/다음」이 바뀌도록 1분마다 다시 그림(홈이 보일 때만)
  setInterval(function () { var c = $('todayCard'); if (c && c.offsetParent) render(); }, 60000);

  global.TodayCard = {
    refresh: refresh,
    render: render,
    openMap: openMapHome,                  // v7.8 홈 「길찾기」 카드
    routeQuery: routeQuery,                // (O-0133) 시험용: 장소 → 네이버 검색어('' = 버튼 없음)
    setOrders: function (rows) { st.orders = Array.isArray(rows) ? rows : []; render(); },
    setReminders: setRems,                 // (O-0176) 예약한 알림 화면에서 새로 받거나 취소한 뒤 한 줄도 맞춤
    closeWeather: function () { if (!wxSheet) return false; wxSheetClose(); return true; },   // (O-0169) 뒤로가기(app.js goBack)
    _setWxLive: function (d) { st.wxLive = d ? wxFromApi(d) : null; st.wxAt = Date.now(); render(); if (wxSheet) wxSheetFill(); },   // 캡처·시험용(Open-Meteo 응답 그대로)
    _setDigest: function (dg, ready) { st.digest = dg; st.digestReady = ready !== false; st.busy = false; render(); }   // 캡처·시험용
  };
})(window);
