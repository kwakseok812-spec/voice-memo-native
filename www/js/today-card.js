/* ============================================================================
 * today-card.js — 홈 「오늘 한눈에」 카드 (O-0129, 시안 단계 · 미배포)
 * ----------------------------------------------------------------------------
 * 홈 녹음/케이 오브 바로 아래 카드 한 장:
 *   ① 오늘 일정(시간순, 지금·다음 일정 강조)  ② 답할 메일(제목·보낸 사람 한 줄)  ③ 챙길 일(지시 대장 미완료)
 *   + [말로 일정 잡기] → 채팅 열고 음성 대화 시작(등록은 PC 케이가 확인 문구 한 번 뒤에만).
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

  var st = { digest: null, digestReady: null, orders: null, busy: false, lastFetch: 0 };

  function H() { return global.SmartHome || {}; }
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
  function sec(icon, title, count, body, more) {
    return '<div class="td-sec"><div class="td-sh"><svg><use href="#' + icon + '"/></svg><span>' + title + '</span>' +
      (count != null ? '<em>' + count + '</em>' : '') + (more ? '<small>' + more + '</small>' : '') + '</div>' + body + '</div>';
  }

  /* ---------- (v8.4) 출퇴근 날씨·우산 한 줄 ---------- */
  function wxPick(slots) {
    var by = {}; (slots || []).forEach(function (x) { if (x && x.key) by[x.key] = x; });
    var m = nowMin(), keys;
    if (m < 9 * 60 + 30) keys = ['am', 'pm'];                 // 아침: 오늘 출근 · 퇴근
    else if (m < 20 * 60 + 30) keys = ['pm', 'tmr_am'];     // 낮: 오늘 퇴근 · 내일 출근
    else keys = ['tmr_am', 'tmr_pm'];                        // 밤: 내일 출근 · 퇴근
    return keys.map(function (k) { return by[k]; }).filter(Boolean);
  }
  function wxSeg(x) {
    var feels = (x.feels != null && Math.abs(x.feels - x.temp) >= 3) ? '<i>(체감 ' + esc(x.feels) + '°)</i>' : '';
    return '<span class="wx-seg"><em>' + esc(x.label) + '</em> ' + esc(x.temp) + '°' + feels + ' · 비 ' + esc(x.prob) + '%</span>';
  }
  function wxRow(dg) {
    var w = dg && dg.weather; if (!w || !w.slots) return '';
    var pick = wxPick(w.slots); if (!pick.length) return '';
    var yes = pick.filter(function (x) { return x.umbrella === 'yes'; })[0], maybe = pick.filter(function (x) { return x.umbrella === 'maybe'; })[0];
    var snow = pick.some(function (x) { return x.snow; });
    var cls = 'ok', ic = '☀️', tip = '우산 필요 없어요';
    if (yes) { cls = 'rain'; ic = snow ? '❄️' : '☂️'; tip = (snow ? '눈 소식 — ' : '') + '우산 챙기세요' + (pick.length > 1 ? ' (' + yes.label + ')' : ''); }
    else if (maybe) { cls = 'maybe'; ic = '🌂'; tip = '작은 우산 있으면 좋아요' + (pick.length > 1 ? ' (' + maybe.label + ')' : ''); }
    return '<button type="button" class="td-wx ' + cls + '" data-td="wx"><span class="wx-ic" aria-hidden="true">' + ic + '</span>' +
      '<span class="td-main"><b>' + esc(tip) + '</b><small>' + pick.map(wxSeg).join('<span class="wx-sep"> · </span>') + '</small></span>' +
      '<svg class="td-chev"><use href="#i-chev-r"/></svg></button>';
  }
  function wxDetail(dg) {
    var w = dg && dg.weather; if (!w || !w.slots) return '';
    var um = { yes: '☂️ 우산 챙기세요', maybe: '🌂 작은 우산 있으면 좋아요', no: '우산 필요 없어요' };
    return w.slots.map(function (x) {
      return x.label + ' (' + x.from + '~' + x.to + '시)  ' + x.temp + '°' + (x.feels != null ? ' · 체감 ' + x.feels + '°' : '') +
        ' · 비 ' + x.prob + '%' + (x.mm ? ' · ' + x.mm + 'mm' : '') + (x.snow ? ' · 눈' : '') + '\n   → ' + (um[x.umbrella] || '');
    }).join('\n') + '\n\n' + (w.place || '서울') + ' 기준 · ' + hmOf(w.fetched_at) + ' 예보(Open-Meteo)';
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

    var h = '<div class="td-head"><div class="td-ttl"><b>오늘 한눈에</b><span>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')</span></div>' +
      '<div class="td-meta">' + hdrNote + '<button type="button" class="td-refresh" data-td="refresh" aria-label="새로 고침"><svg><use href="#i-refresh"/></svg></button></div></div>';

    if (showDigest && dg) h += wxRow(dg);                           // v8.4 출퇴근 날씨·우산(없으면 '')
    var nothing = !evs.length && !mails.length && !tasks.length;
    if (nothing && (dg || !showDigest) && st.orders) {
      h += '<div class="td-empty"><span class="td-empty-ic"><svg><use href="#i-check"/></svg></span>' +
        '<div><b>오늘은 챙길 게 없어요</b><small>일정·답할 메일·기다리는 일이 모두 비어 있어요.</small></div></div>';
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
          tasks.length ? tk.map(taskRow).join('') + (trest > 0 ? '<button type="button" class="td-more" data-td="tasks">외 ' + trest + '건 · 작업 현황 보기</button>' : '')
                       : '<div class="td-none">기다리는 일이 없어요</div>');
      }
    }
    h += '<button type="button" class="td-voice" data-td="voice"><span class="td-voice-ic"><svg><use href="#i-mic"/></svg></span>' +
      '<span><b>말로 일정 잡기</b><small>예) “내일 3시 회의 잡아 줘”</small></span></button>';
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
    OB.getHomeDigest(pass).then(function (dg) {
      st.busy = false; st.digestReady = true; st.digest = dg || {}; render();
    }).catch(function (e) {
      st.busy = false;
      if (e && e.notready) st.digestReady = false;                 // 서버 준비 전 → ①② 숨김, ③만
      render();
    });
  }

  /* ---------- 누르면 ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('#todayCard [data-td]') : null;
    if (!t) return;
    ev.preventDefault();
    var card = $('todayCard'), kind = t.getAttribute('data-td'), S = H();
    if (kind === 'refresh') { st.lastFetch = 0; refresh(false); if (S.refreshOrders) S.refreshOrders(); return; }
    if (kind === 'voice') { if (S.startVoiceSchedule) S.startVoiceSchedule(); return; }
    if (kind === 'wx') {                                           // v8.4: 출퇴근 날씨 자세히
      var dgw = st.digest; if (S.sheet && dgw && dgw.weather) S.sheet('출퇴근 날씨', wxDetail(dgw), '케이에게 묻기', 'i-chat', function () { if (S.draft) S.draft('오늘 날씨 관련해서 '); });
      return;
    }
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
    _setDigest: function (dg, ready) { st.digest = dg; st.digestReady = ready !== false; st.busy = false; render(); }   // 캡처·시험용
  };
})(window);
