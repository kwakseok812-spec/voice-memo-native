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
    return '<button type="button" class="td-row ev ' + o.state + '" data-td="ev" data-i="' + i + '">' +
      '<span class="td-time">' + time + '</span>' +
      '<span class="td-main"><b>' + esc(e.title || '(제목 없음)') + '</b>' + (e.place ? '<small>' + esc(e.place) + '</small>' : '') + '</span>' +
      tag + '</button>';
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
    if (kind === 'tasks' || kind === 'evmore') {
      if (kind === 'tasks' && S.openOrders) S.openOrders();
      if (kind === 'evmore') { var all = (card._evs || []).map(function (o) { var e = o.e; return (e.all_day ? '종일' : (e.start || '') + (e.end ? '~' + e.end : '')) + '  ' + (e.title || ''); }).join('\n'); if (S.sheet) S.sheet('오늘 일정 전체', all, '케이에게 묻기', 'i-chat', function () { if (S.draft) S.draft('오늘 일정 중에서 '); }); }
      return;
    }
    if (kind === 'task') { if (S.openOrders) S.openOrders(t.getAttribute('data-oid')); return; }
    var i = +t.getAttribute('data-i');
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
    setOrders: function (rows) { st.orders = Array.isArray(rows) ? rows : []; render(); },
    _setDigest: function (dg, ready) { st.digest = dg; st.digestReady = ready !== false; st.busy = false; render(); }   // 캡처·시험용
  };
})(window);
