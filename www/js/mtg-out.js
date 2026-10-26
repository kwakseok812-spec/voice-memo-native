/* ============================================================================
 * mtg-out.js — 회의록 상세 「맞춤 정리본 받기」 (O-0626, 1단계 앱 쪽)
 * ----------------------------------------------------------------------------
 * 회의록 상세의 [복사][이름 변경][삭제] 줄 바로 다음에 접이식 칸을 붙인다.
 *   · 정리 방식 타일 6개(한 쪽 요약이 맨 앞) + 형식(워드·PPT·한글) + 한 줄 요청 + [말로 요청]
 *   · 요청은 채팅 행 한 개(meta.meeting_out)로 PC에 보낸다 — 앱이 회의 내용을 보내지 않는다(회의 id·형식·한 줄 요청만).
 *   · 진행 점(요청됨 → 만드는 중 → 도착)은 작업 카드와 같은 서버 목록(list_office_orders_by_source)을 읽는다 — 새 서버 칸·SQL 없음.
 *   · 도착한 파일은 채팅에 이미 오는 첨부 말풍선이다. 이 칸은 파일 이름에 든 회의 번호(앞 8자)·방식·버전으로 「이 회의의 정리본」을 찾아 보여 준다.
 *       파일 이름 규칙(PC 와 맞춘 것): …_<회의id 앞8자>_<방식>_v<번호>.<docx|pptx|hwpx>   예) mtg_261021_cc468732_onepage_v1.docx
 *   · 이 폰이 보낸 요청은 이 폰에만(localStorage) 적어 둔다. 읽기에 실패해도 화면은 정상(요청 기록만 비어 보인다).
 * 스위치: app.js 의 MTG_OUT_ON ('on' | 'off'). 'off' 면 이 칸·칩·채팅 표시가 전부 사라진다(v9.44 와 같은 화면).
 * host(app.js 가 setHost 로 준다): send(p)→Promise{rid} · cancel(rid)→Promise · status(rids)→Promise{rid:{status,job_status,job_seq}}
 *   chatFiles()→[{name,url,mime,size,ts}] · toast(t) · pass()→연동 암호 여부 · goChat() · openFile(att) · pullPushes() · memoById(id8)
 * ==========================================================================*/
(function (global) {
  'use strict';
  var STORE_KEY = 'smart_mtgout_reqs';
  var KEEP_MS = 30 * 86400000;            // 요청 기록 보관 30일
  var SIGN_MS = 7 * 86400000;             // 파일 주소 유효 7일(PC 보관함 서명 주소)
  var POLL_MS = 9000;
  var STALE_MS = 3 * 60000;               // 보낸 지 3분이 넘도록 PC 소식이 없으면 정직하게 알린다
  var GIVEUP_MS = 90 * 60000;             // 90분 넘게 끝나지 않으면 조회를 멈추고 「채팅에서 확인」으로 돌린다
  var host = {};

  var OUT_LABEL = { docx: '워드', pptx: 'PPT', hwpx: '한글' };
  var OUT_EXT = { docx: '.docx', pptx: '.pptx', hwpx: '.hwpx' };
  // 타일 순서 = 화면 순서. outs 의 첫 값이 기본 형식. 한글(.hwpx)은 한 쪽 요약·워드 정리본부터.
  var FM = [
    { id: 'onepage', name: '한 쪽 요약', sub: 'A4 1쪽', icon: 'i-onepage', outs: ['docx', 'hwpx'],
      d1: '폰으로 훑거나 인쇄할 1쪽. 3쪽짜리 워드 정리본보다 훨씬 짧아요.', d2: '한 줄 결론 · 핵심 · 해야 할 일 · 기한' },
    { id: 'minutes', name: '워드 정리본', sub: 'A4 3쪽 내외', icon: 'i-doc', outs: ['docx', 'hwpx'],
      d1: '빠진 것 없이 3쪽 안에 정리한 본문. 한 쪽 요약보다 자세해요.', d2: '결정·할 일·기한은 빼지 않고, 넘치면 덜 중요한 내용을 줄여요' },
    { id: 'pptx', name: 'PPT 요약', sub: '6~8장', icon: 'i-image', outs: ['pptx'],
      d1: '화면으로 보여 주는 6~8장.', d2: '큰 글자 위주 · PPT는 폰에서 직접 고치기보다 말로 요청해 새 버전을 받는 쪽이 쉬워요' },
    { id: 'todo', name: '할 일 표', sub: '담당·기한', icon: 'i-tasks', outs: ['docx'],
      d1: '챙길 일만 표로(구분·내용·담당·기한·근거).', d2: '담당·기한이 녹음에서 분명하지 않으면 「미정」으로 둡니다' },
    { id: 'share', name: '참석자 전달용', sub: 'A4 1쪽', icon: 'i-send', outs: ['docx'],
      d1: '참석하신 분들께 전할 1쪽. 결정·할 일·일정만.', d2: '파일만 만들어 드려요. 보내는 일은 직접 해 주세요' },
    { id: 'report', name: '보고용(~함 체)', sub: '1~2쪽', icon: 'i-flag', outs: ['docx'],
      d1: '상급자 보고·공문 첨부용. ~함/~임 말투.', d2: '배경 – 현황 – 조치 계획 순서' }
  ];
  var FM_FREE = { id: 'free', name: '말로 요청', sub: '', icon: 'i-mic', outs: ['docx', 'pptx', 'hwpx'] };
  var FM_BY = {}; FM.concat([FM_FREE]).forEach(function (f) { FM_BY[f.id] = f; });
  var FILE_RE = /(?:^|[_\-. ])([0-9a-f]{8})_(onepage|minutes|pptx|todo|share|report|free)_v(\d+)\.(docx|pptx|hwpx)$/i;

  function $(s, root) { return (root || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(t) { try { if (host.toast) host.toast(t); } catch (e) {} }
  function reduce() {
    try {
      if (global.KChar && KChar.motionOn && !KChar.motionOn()) return true;
      return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* ---------------- 이 폰의 요청 기록 ---------------- */
  var mem = null;
  function load() {
    if (mem) return mem;
    var a = [];
    try { var raw = localStorage.getItem(STORE_KEY); if (raw) a = JSON.parse(raw) || []; } catch (e) { a = []; }
    var now = Date.now();
    mem = (Array.isArray(a) ? a : []).filter(function (r) { return r && r.rid && r.memo && (now - (r.ts || 0)) < KEEP_MS; });
    return mem;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(load().slice(-80))); } catch (e) {} }
  function id8(id) { return String(id || '').replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase(); }
  function parseName(name) {
    var m = FILE_RE.exec(String(name || '')); if (!m) return null;
    return { id8: m[1].toLowerCase(), fmt: m[2].toLowerCase(), ver: parseInt(m[3], 10) || 1, ext: m[4].toLowerCase() };
  }
  function isOpenState(s) { return s === 'sent' || s === 'making'; }
  // 보낸 지 3분이 넘도록 대장에 행이 안 생긴 요청 = PC 가 받지 못한 것으로 본다(타일 잠금을 풀어 다시 누를 수 있게)
  function isLost(r) { return r.state === 'sent' && !r.acked && (Date.now() - r.ts) > STALE_MS; }
  function reqsOf(memoId) { return load().filter(function (r) { return r.memo === memoId; }); }

  function filesOf(memoId) {
    var p8 = id8(memoId), out = {}, list = [];
    var cf = [];
    try { cf = (host.chatFiles && host.chatFiles()) || []; } catch (e) { cf = []; }
    cf.forEach(function (f) {
      var pn = parseName(f.name); if (!pn || pn.id8 !== p8) return;
      var key = pn.fmt + '|' + pn.ver;
      var cur = out[key];
      if (!cur || (f.ts || 0) > (cur.ts || 0)) out[key] = { key: key, fmt: pn.fmt, ver: pn.ver, ext: pn.ext, name: f.name, url: f.url, mime: f.mime || '', size: f.size || 0, ts: f.ts || 0 };
    });
    Object.keys(out).forEach(function (k) { list.push(out[k]); });
    // 요청은 끝났다는데 이 폰의 채팅에서는 파일을 못 찾은 것(채팅 기록이 오래돼 지워졌거나 아직 안 받음) — 그래도 센다
    reqsOf(memoId).forEach(function (r) {
      if (r.kind !== 'make' || r.state !== 'done') return;
      var key = r.fmt + '|' + r.ver;
      if (out[key]) return;
      // PC 가 앱이 정한 번호와 다른 번호로 올렸을 수 있다 — 같은 방식·같은 형식의 실제 파일이 요청 뒤에 도착해 있으면 그것과 같은 정리본으로 본다
      var dupe = list.some(function (f) { return !f.pseudo && f.fmt === r.fmt && f.ext === r.out && (f.ts || 0) >= (r.ts || 0) - 60000; });
      if (dupe) return;
      out[key] = { key: key, fmt: r.fmt, ver: r.ver, ext: r.out, name: '', url: '', ts: r.doneAt || r.ts, pseudo: true };
      list.push(out[key]);
    });
    list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return list;
  }
  function count(memoId) { if (!memoId) return 0; try { return filesOf(memoId).length; } catch (e) { return 0; } }
  function nextVer(memoId, fmt) {
    var mx = 0;
    filesOf(memoId).forEach(function (f) { if (f.fmt === fmt && f.ver > mx) mx = f.ver; });
    reqsOf(memoId).forEach(function (r) { if (r.kind === 'make' && r.fmt === fmt && r.ver > mx && r.state !== 'failed' && r.state !== 'cancelled' && !isLost(r)) mx = r.ver; });
    return mx + 1;
  }

  /* ---------------- 진행 확인 ---------------- */
  var pollT = null, polling = false, cur = null;                  // cur = { el, memo(row), ui }
  function applyStatus(r, st) {
    var js = st.job_status || '', s = st.status || '', was = r.state;
    r.acked = true; r.seq = st.job_seq || r.seq || 0;
    if (st.result) r.why = String(st.result).replace(/\s+/g, ' ').trim().slice(0, 200);
    // PC 가 쓰는 값: 대장 「진행」 + job_status queued(받음·대기) / running(만드는 중). 「진행」이어도 queued 면 아직 대기다.
    if (js === 'done' || js === 'need_approval' || s === '완료') r.state = 'done';
    else if (js === 'failed' || s === '실패') r.state = 'failed';
    else if (js === 'cancelled' || s === '취소') r.state = 'cancelled';
    else if (js === 'running' || js === 'working' || js === 'processing') r.state = 'making';
    else if (js === 'queued') r.state = 'sent';
    else if (s === '진행' && !js) r.state = 'making';          // job_status 를 모르는 옛 값만
    else r.state = 'sent';
    if (r.state !== was && r.state === 'done') r.doneAt = Date.now();
    return r.state !== was;
  }
  function pollOnce() {
    if (polling || !host.status || !(host.pass && host.pass())) return;
    var now = Date.now(), open = load().filter(function (r) { return isOpenState(r.state); });
    open.forEach(function (r) { if (now - r.ts > GIVEUP_MS) { r.state = 'stale'; save(); } });
    open = open.filter(function (r) { return isOpenState(r.state); });
    if (!open.length) { stopPoll(); refresh(true); return; }
    polling = true;
    host.status(open.map(function (r) { return r.rid; })).then(function (m) {
      polling = false;
      var changed = false, arrived = [];
      open.forEach(function (r) {
        var st = (m || {})[r.rid];
        if (!st) return;
        if (applyStatus(r, st)) { changed = true; if (r.state === 'done') arrived.push(r); }
      });
      if (changed) save();
      if (arrived.length) {
        try { if (host.pullPushes) host.pullPushes(); } catch (e) {}
        arrived.forEach(function (r) { r.popped = true; });
        try { if (navigator.vibrate && !reduce()) navigator.vibrate(30); } catch (e) {}
        toast('정리본이 도착했습니다. 채팅에서도 받으실 수 있어요.');
        setTimeout(function () { arrived.forEach(function (r) { r.popped = false; }); refresh(true); }, 450);
        setTimeout(function () { refresh(true); }, 2500);          // 채팅에 파일 말풍선이 들어온 뒤 목록을 한 번 더 맞춘다
      }
      refresh(false);
      if (!load().some(function (r) { return isOpenState(r.state); })) stopPoll();
    }, function () { polling = false; refresh(false); });
  }
  function startPoll() { if (pollT) return; pollT = setInterval(function () { if (!(global.document && document.hidden)) pollOnce(); }, POLL_MS); setTimeout(pollOnce, 1500); }
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }

  /* ---------------- 보내기 · 취소 · 다시 받기 ---------------- */
  function fmtLabel(fmt, out) { var f = FM_BY[fmt]; return (f ? f.name : fmt) + (out && out !== 'docx' && fmt !== 'pptx' ? '(' + OUT_LABEL[out] + ')' : ''); }
  function newRec(kind, p, res) {
    var r = { rid: res.rid, kind: kind, memo: p.memo_id, title: p.memo_title || '', fmt: p.fmt, out: p.out, ver: p.ver, note: p.note || '', ts: Date.now(), state: 'sent', acked: false };
    load().push(r); save(); return r;
  }
  function doMake(memo, fmt, out, note) {
    if (!(host.pass && host.pass())) { toast('연동 암호를 넣으신 뒤 다시 눌러 주세요.'); try { window.dispatchEvent(new CustomEvent('smartBadPass', { detail: { need: true } })); } catch (e) {} return Promise.resolve(null); }
    var prevVer = nextVer(memo.id, fmt) - 1;
    var p = { action: 'make', memo_id: memo.id, memo_title: memo.title || '', fmt: fmt, out: out, ver: prevVer + 1, redo_of: prevVer > 0 ? prevVer : null, note: note || '' };
    return host.send(p).then(function (res) { newRec('make', p, res); startPoll(); return res; });
  }
  function doResend(entry, memo) {
    if (!(host.pass && host.pass())) { toast('연동 암호를 넣으신 뒤 다시 눌러 주세요.'); return Promise.resolve(null); }
    var p = { action: 'resend', memo_id: (memo && memo.id) || entry.memoId || '', id8: entry.id8, memo_title: (memo && memo.title) || '', fmt: entry.fmt, out: entry.ext, ver: entry.ver, name: entry.name || '', note: '' };
    return host.send(p).then(function (res) { newRec('resend', p, res); startPoll(); return res; });
  }
  function doCancel(rid) {
    var r = load().filter(function (x) { return x.rid === rid; })[0]; if (!r) return Promise.resolve();
    return host.cancel(rid).then(function () { r.cancelAt = Date.now(); save(); startPoll(); });
  }

  /* ---------------- 화면 ---------------- */
  var ICON = function (id) { return '<svg><use href="#' + id + '"/></svg>'; };
  function kFace() {
    var K = global.KChar, u = '';
    try { if (K) u = (K.poseUrl && K.poseUrl('note')) || (K.exprUrl && K.exprUrl('smile')) || ''; } catch (e) {}
    return u ? '<img class="mo-kimg" src="' + esc(u) + '" alt="">' : '';
  }
  function whenKo(ts) {
    if (!ts) return '';
    var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function stepRow(r) {
    var idx = r.state === 'making' ? 1 : (r.state === 'done' ? 2 : 0);
    var names = ['요청됨', '만드는 중', '도착'];
    var dots = names.map(function (n, i) {
      return '<span class="mo-st' + (i < idx ? ' ok' : '') + (i === idx ? (r.state === 'done' ? ' ok on' : ' on') : '') + '"><i></i><em>' + n + '</em></span>';
    }).join('<b class="mo-bar' + '"></b>');
    return '<div class="mo-steps" role="status">' + dots + '</div>';
  }
  function reqLine(r, waitN) {
    var f = FM_BY[r.fmt] || {}, nm = fmtLabel(r.fmt, r.out) + (r.kind === 'resend' ? ' · 다시 받기' : ' · v' + r.ver);
    var sub = '';
    if (r.state === 'sent') {
      if (!r.acked) sub = isLost(r) ? 'PC에서 아직 받지 못했어요. PC가 꺼져 있거나 쉬고 있을 수 있어요. 같은 모양을 다시 누르면 새로 보낼 수 있어요.' : 'PC로 보냈어요. PC가 꺼져 있으면 늦을 수 있어요.';
      else sub = 'PC가 받았어요' + (r.seq ? ' (작업 #' + r.seq + ')' : '') + (waitN ? ' · 대기 ' + waitN + '번째' : '') + '. 한 번에 2개씩 만들어요.';
    } else if (r.state === 'making') sub = '만들고 있어요. 보통 5~15분 걸려요(예상).';
    else if (r.state === 'done') sub = r.kind === 'resend' ? '새 주소로 다시 보냈어요. 채팅에도 있어요.' : '도착했어요. 아래 「만든 정리본」과 채팅에서 받으실 수 있어요.';
    var act = '';
    if (isOpenState(r.state)) act = r.cancelAt ? '<span class="mo-sm">취소를 요청했어요</span>' : '<button type="button" class="mo-link" data-mo="cancel" data-rid="' + esc(r.rid) + '">요청 취소</button>';
    else if (r.state === 'done') act = '<button type="button" class="mo-link" data-mo="chat">채팅에서 보기</button>';
    return '<div class="mo-req ' + esc(r.state) + (r.popped ? ' pop' : '') + '" data-rid="' + esc(r.rid) + '"><div class="mo-rh"><b>' + esc(nm) + '</b>' + act + '</div>' + stepRow(r) + '<p class="mo-sm">' + esc(sub) + '</p></div>';
  }
  function failLine(r) {
    var nm = fmtLabel(r.fmt, r.out) + (r.kind === 'resend' ? ' · 다시 받기' : ' · v' + r.ver);
    var why = r.state === 'cancelled' ? '요청이 취소됐어요.' : r.state === 'stale' ? '아직 끝났다는 소식이 없어요. 채팅에 답이 왔는지 확인해 주세요. PC가 꺼져 있을 수 있어요.' : '못 만들었어요. 이유는 채팅에도 적어 두었어요.';
    if (r.why && r.state === 'cancelled') why = r.why;      // PC 가 이유를 적어 준 취소(설명회 할 일 표·같은 요청 진행 중 등)는 「요청이 취소됐어요」 머리 없이 그 이유만
    else if (r.why && r.state === 'failed') why += ' ' + r.why;
    return '<div class="mo-req fail"><div class="mo-rh"><b>' + esc(nm) + '</b><button type="button" class="mo-link" data-mo="chat">채팅 보기</button></div><p class="mo-sm">' + esc(why) + '</p></div>';
  }
  function dismissOld(memoId) {
    // 끝난 요청 줄은 10분이 지나면 진행 칸에서 내린다(「만든 정리본」에는 그대로 남는다). 실패·취소는 1시간.
    var now = Date.now();
    return reqsOf(memoId).filter(function (r) {
      if (isOpenState(r.state)) return true;
      if (r.state === 'done') return now - (r.doneAt || r.ts) < 600000;
      if (r.state === 'failed' || r.state === 'cancelled') return now - r.ts < 3600000 && !r.hide;
      if (r.state === 'stale') return now - r.ts < 3 * 3600000;
      return false;
    });
  }
  function renderBody(c) {
    var memo = c.memo, ui = c.ui, h = '';
    var rows = dismissOld(memo.id);
    var allOpen = load().filter(function (r) { return isOpenState(r.state) && !isLost(r); });
    // 1) 안내 — 여러 건을 한꺼번에 누른 경우
    if (allOpen.length >= 2)
      h += '<div class="mo-note">한 번에 2개씩 만들어서 나머지는 차례를 기다려요. 하나당 5~15분쯤 걸리니 다른 일 보셔도 됩니다. 도착하면 알려 드릴게요.</div>';
    // 2) 진행 줄
    if (rows.length) {
      var makingN = allOpen.filter(function (r) { return r.state === 'making'; }).length, freeSlots = Math.max(0, 2 - makingN);
      var queued = allOpen.filter(function (r) { return r.state === 'sent' && r.acked; }).sort(function (a, b) { return (a.seq || a.ts) - (b.seq || b.ts); });
      h += '<div class="mo-prog">';
      if (ui.kline && rows.some(function (r) { return isOpenState(r.state); }))
        h += '<div class="mo-k">' + kFace() + '<div class="mo-kb">' + esc(ui.kline) + '</div></div>';
      rows.forEach(function (r) {
        if (r.state === 'failed' || r.state === 'cancelled' || r.state === 'stale') { h += failLine(r); return; }
        var qi = queued.indexOf(r), waitN = (qi >= 0 && qi - freeSlots + 1 > 0) ? (qi - freeSlots + 1) : 0;
        h += reqLine(r, waitN);
      });
      h += '</div>';
    }
    // 3) 만든 정리본
    var files = filesOf(memo.id);
    if (files.length) {
      var now = Date.now();
      h += '<div class="mo-sec">만든 정리본 <span>' + files.length + '</span></div><div class="mo-made">';
      files.forEach(function (f) {
        var nm = fmtLabel(f.fmt, f.ext) + ' v' + f.ver, expired = !f.pseudo && f.ts && (now - f.ts) > SIGN_MS - 3600000;
        var btns;
        if (f.pseudo) btns = '<button type="button" class="mo-link" data-mo="chat">채팅에서 보기</button>';
        else if (expired) btns = '<button type="button" class="mo-btn pri" data-mo="reget" data-key="' + esc(f.key) + '">다시 받기</button>';
        else btns = '<button type="button" class="mo-btn" data-mo="open" data-key="' + esc(f.key) + '">열기</button><button type="button" class="mo-btn" data-mo="reget" data-key="' + esc(f.key) + '">다시 받기</button>';
        h += '<div class="mo-file"><span class="mo-fi">' + ICON(f.ext === 'pptx' ? 'i-image' : 'i-doc') + '</span><span class="mo-ft"><b>' + esc(nm) + '</b><small>' + esc(OUT_LABEL[f.ext] || '') + ' · ' + esc(whenKo(f.ts)) + (expired ? ' · 주소가 만료됐어요' : '') + '</small></span><span class="mo-fb">' + btns + '</span></div>';
      });
      h += '<p class="mo-sm">열어서 보다가 <b>[✏️ 고치기]</b>로 고칠 곳을 짚으면 PC가 고친 사본을 보내 줘요. 고치기에는 파일 주소가 필요해서 7일이 지나면 먼저 [다시 받기]를 눌러 주세요.</p></div>';
    }
    // 4) 타일
    var openFmt = {}; rows.forEach(function (r) { if (isOpenState(r.state) && !r.cancelAt && !isLost(r) && r.kind === 'make') openFmt[r.fmt] = r; });
    h += '<div class="mo-sec">어떤 모양으로 받을까요?</div><div class="tools mo-tiles">';
    FM.forEach(function (f, i) {
      var busy = !!openFmt[f.id];
      h += '<button type="button" class="tool mo-tile' + (ui.sel === f.id ? ' sel' : '') + (busy ? ' busy' : '') + '" data-mo="tile" data-fmt="' + f.id + '">' +
           '<span class="ic ' + (i % 2 ? 'cyan' : 'blue') + '">' + ICON(f.icon) + '</span><b>' + esc(f.name) + '</b><small>' + (busy ? '만드는 중…' : esc(f.sub)) + '</small></button>';
    });
    h += '</div>';
    h += '<button type="button" class="tool wide mo-freebtn' + (ui.sel === 'free' ? ' sel' : '') + '" data-mo="tile" data-fmt="free"><span class="ic cyan">' + ICON('i-mic') + '</span><span class="tw"><b>말로 요청하기</b><small>원하는 모양을 직접 적어서 받아요</small></span></button>';
    // 5) 고른 타일의 설명 패널
    if (ui.sel) h += renderPanel(c, openFmt);
    return h;
  }
  function renderPanel(c, openFmt) {
    var ui = c.ui, memo = c.memo, f = FM_BY[ui.sel]; if (!f) return '';
    var isFree = f.id === 'free', busyReq = openFmt[f.id];
    var out = ui.out[f.id] || f.outs[0];
    var ver = nextVer(memo.id, f.id), redo = !isFree && ver > 1;
    var h = '<div class="mo-panel" data-fmt="' + f.id + '">';
    h += '<div class="mo-ph"><b>' + esc(f.name) + '</b>' + (f.sub ? '<small>' + esc(f.sub) + '</small>' : '') + '</div>';
    if (isFree) {
      h += '<p class="mo-d1">원하는 모양을 직접 적어 주세요. 예) 「교수님이 챙길 일만 5줄로」, 「부서별로 나눠서 표로」</p>';
    } else {
      h += '<p class="mo-d1">' + esc(f.d1) + '</p><p class="mo-d2">' + esc(f.d2) + '</p>';
    }
    if (busyReq) {
      h += '<p class="mo-d2">같은 방식이 지금 만들어지는 중이에요. 끝나면 새 버전을 받으실 수 있어요.</p>';
      h += '</div>'; return h;
    }
    if (f.outs.length > 1) {
      h += '<div class="mo-outs" role="radiogroup" aria-label="파일 형식">' + f.outs.map(function (o) {
        return '<button type="button" role="radio" aria-checked="' + (o === out) + '" class="mo-out' + (o === out ? ' on' : '') + '" data-mo="out" data-out="' + o + '">' + OUT_LABEL[o] + ' <small>' + OUT_EXT[o] + '</small></button>';
      }).join('') + '</div>';
    } else if (!isFree) {
      h += '<p class="mo-d2">' + OUT_LABEL[f.outs[0]] + ' 파일 1개 · 보통 5~15분(예상)</p>';
    }
    if (f.outs.length > 1 && !isFree) h += '<p class="mo-d2">파일 1개 · 보통 5~15분(예상)</p>';
    if (redo) h += '<p class="mo-d2 mo-redo">이미 만든 적이 있어서 <b>새 버전(v' + ver + ')</b>으로 쌓여요. 이전 파일은 그대로 남아요. 뷰어에서 고친 내용은 새 버전에 따라가지 않아요.</p>';
    h += '<textarea class="mo-nt" id="moNote" rows="' + (isFree ? 3 : 1) + '" maxlength="200" placeholder="' + (isFree ? '어떤 모양으로 받고 싶으세요?' : '더 바라는 점이 있으면 한 줄로…') + '">' + esc(ui.note || '') + '</textarea>';
    h += '<button type="button" class="btn primary mo-go' + (ui.justSent ? ' sent' : '') + '" data-mo="go"' + (ui.sending || ui.justSent ? ' disabled' : '') + '>' +
         (ui.justSent ? '✓ 보냈습니다' : ui.sending ? '보내는 중…' : (redo ? '고쳐서 다시 만들기 (v' + ver + ')' : 'PC로 보내 만들기')) + '</button>';
    h += '<p class="mo-sm">PC가 꺼져 있거나 쉬고 있으면 늦어질 수 있어요. 회의 내용은 앱이 보내지 않고, PC에 저장된 원문으로 만들어요.</p>';
    h += '</div>';
    return h;
  }
  function renderAll(c) {
    var n = count(c.memo.id), open = c.ui.open;
    var h = '<button type="button" class="mo-head" data-mo="toggle" aria-expanded="' + open + '">' +
            '<span class="ic">' + ICON('i-doc') + '</span><span class="mo-t"><b>맞춤 정리본 받기</b><small>용도에 맞게 다시 써 드려요</small></span>' +
            (n ? '<span class="mo-n' + (c.ui.pop ? ' pop' : '') + '">정리본 ' + n + '</span>' : '') +
            '<svg class="chev"><use href="#i-chev-r"/></svg></button>' +
            '<div class="mo-body"><div class="mo-in">' + (open ? renderBody(c) : '') + '</div></div>';
    return h;
  }
  function sig(c) {
    return JSON.stringify([c.ui.open, c.ui.sel, c.ui.out, c.ui.sending, c.ui.justSent, c.ui.kline, load().map(function (r) { return [r.rid, r.state, r.acked, r.seq, r.cancelAt, r.popped, r.hide]; }),
      filesOf(c.memo.id).map(function (f) { return f.key + (f.url ? '1' : '0'); }), Math.floor(Date.now() / 60000)]);
  }
  function paint(c, keepFocus) {
    var el = c.el; if (!el || !el.isConnected) return;
    var box = el.querySelector('.mo'); if (!box) return;
    var nt = el.querySelector('#moNote'), hadFocus = nt && document.activeElement === nt;
    if (nt) { c.ui.note = nt.value; }
    var sel = hadFocus ? [nt.selectionStart, nt.selectionEnd] : null;
    box.setAttribute('data-open', c.ui.open ? '1' : '0');
    box.innerHTML = renderAll(c);
    c.sig = sig(c);
    if (hadFocus) { var n2 = el.querySelector('#moNote'); if (n2) { try { n2.focus(); n2.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  }
  function refresh(force) {
    if (!cur || !cur.el || !cur.el.isConnected) return;
    var s = sig(cur);
    if (!force && s === cur.sig) return;
    // 닫혀 있고 머리의 개수·뱃지만 바뀐 경우도 여기서 다시 그린다
    paint(cur);
  }

  /* ---------------- 누르기 ---------------- */
  function onClick(ev) {
    var c = cur; if (!c) return;
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-mo]') : null; if (!t) return;
    var a = t.getAttribute('data-mo'), ui = c.ui;
    if (a === 'toggle') { ui.open = !ui.open; paint(c); return; }
    if (a === 'tile') {
      var fm = t.getAttribute('data-fmt'); ui.sel = (ui.sel === fm) ? null : fm; ui.justSent = false; ui.sending = false;
      paint(c);
      var pn = c.el.querySelector('.mo-panel'); if (pn && !reduce()) { pn.classList.add('in'); }
      if (ui.sel && pn) { try { pn.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' }); } catch (e) {} }
      return;
    }
    if (a === 'out') { var f0 = FM_BY[ui.sel]; if (f0) { var nt0 = c.el.querySelector('#moNote'); if (nt0) ui.note = nt0.value; ui.out[f0.id] = t.getAttribute('data-out'); paint(c); } return; }
    if (a === 'chat') { try { if (host.goChat) host.goChat(); } catch (e) {} return; }
    if (a === 'cancel') {
      var rid = t.getAttribute('data-rid');
      doCancel(rid).then(function () { toast('취소를 PC에 보냈습니다. 멈추면 알려 드릴게요.'); paint(c); }, function () { toast('취소를 보내지 못했습니다. 인터넷 연결을 확인해 주세요.'); });
      return;
    }
    if (a === 'open') {
      var fo = filesOf(c.memo.id).filter(function (x) { return x.key === t.getAttribute('data-key'); })[0];
      if (fo && fo.url && host.openFile) host.openFile({ url: fo.url, name: fo.name, mime: fo.mime, kind: 'document' }, c.memo);
      return;
    }
    if (a === 'reget') {
      var fr = filesOf(c.memo.id).filter(function (x) { return x.key === t.getAttribute('data-key'); })[0]; if (!fr) return;
      t.disabled = true;
      doResend({ fmt: fr.fmt, ext: fr.ext, ver: fr.ver, name: fr.name, id8: id8(c.memo.id) }, c.memo).then(function (res) {
        if (res) { c.ui.kline = '새 주소로 다시 받아 오겠습니다.'; toast('PC로 보냈습니다. 약 20초 뒤 채팅으로 와요.'); }
        paint(c);
      }, function (e) { toast('보내지 못했습니다(' + ((e && (e.friendly || e.message)) || '알 수 없는 오류') + ').'); paint(c); });
      return;
    }
    if (a === 'go') {
      var f = FM_BY[ui.sel]; if (!f || ui.sending || ui.justSent) return;
      var nt1 = c.el.querySelector('#moNote'), note = (nt1 && nt1.value || '').replace(/\s+/g, ' ').trim(); ui.note = note;
      if (f.id === 'free' && note.length < 2) { toast('원하는 모양을 적어 주세요.'); if (nt1) nt1.focus(); return; }
      var out = ui.out[f.id] || f.outs[0];
      ui.sending = true; paint(c);
      doMake(c.memo, f.id, out, note).then(function (res) {
        ui.sending = false;
        if (!res) { paint(c); return; }
        ui.justSent = true; ui.note = ''; ui.kline = '받았습니다. 정리해 오겠습니다.';
        paint(c);
        setTimeout(function () { ui.justSent = false; ui.sel = null; if (cur === c) paint(c); }, reduce() ? 600 : 1100);
      }, function (e) {
        ui.sending = false; paint(c);
        toast('PC로 보내지 못했습니다(' + ((e && (e.friendly || e.message)) || '알 수 없는 오류') + '). 적어 두신 요청은 그대로 남아 있어요.');
      });
      return;
    }
  }

  function mount(el, memo) {
    if (!el || !memo || !memo.id) return;
    unmount();
    var hasOpen = reqsOf(memo.id).some(function (r) { return isOpenState(r.state); });
    var ui = { open: hasOpen, sel: null, out: {}, note: '', sending: false, justSent: false, kline: '' };
    el.innerHTML = '<div class="mo" data-open="' + (ui.open ? 1 : 0) + '"></div>';
    cur = { el: el, memo: memo, ui: ui, sig: '' };
    el.onclick = onClick;
    paint(cur);
    if (load().some(function (r) { return isOpenState(r.state); })) startPoll();
  }
  function unmount() { if (cur && cur.el) { try { cur.el.onclick = null; } catch (e) {} } cur = null; }

  /* ---------------- app.js 가 쓰는 보조 ---------------- */
  // 채팅 첨부 말풍선 표시용: 이 파일이 맞춤 정리본이면 이름표 글을 돌려준다(아니면 '')
  function tagFor(name) {
    var pn = parseName(name); if (!pn) return '';
    var f = FM_BY[pn.fmt]; return '맞춤 정리본 · ' + (f ? f.name : pn.fmt) + ' v' + pn.ver + (pn.ext === 'hwpx' ? ' · 한글' : '');
  }
  function infoFor(name) { var pn = parseName(name); return pn ? { id8: pn.id8, fmt: pn.fmt, ver: pn.ver, ext: pn.ext } : null; }
  function resendFor(att, memo) {          // 채팅/뷰어에서 주소가 만료됐을 때 [다시 받기]
    var pn = parseName(att && att.name); if (!pn) return Promise.resolve(null);
    return doResend({ fmt: pn.fmt, ext: pn.ext, ver: pn.ver, name: att.name, id8: pn.id8 }, memo || (host.memoById && host.memoById(pn.id8)) || null);
  }

  global.MtgOut = {
    setHost: function (h) { host = h || {}; },
    mount: mount, unmount: unmount, count: count, label: fmtLabel, tagFor: tagFor, infoFor: infoFor, resendFor: resendFor,
    isMtgName: function (n) { return !!parseName(n); },
    refresh: function () { refresh(true); },
    _reqs: load, _fm: FM, _files: filesOf, _poll: pollOnce, _parse: parseName
  };
})(window);
