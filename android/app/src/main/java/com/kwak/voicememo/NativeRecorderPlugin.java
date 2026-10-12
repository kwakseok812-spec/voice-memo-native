package com.kwak.voicememo;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 네이티브 백그라운드 녹음 플러그인.
 *  - 녹음은 RecordingService(포그라운드 서비스, type=microphone) 안의 MediaRecorder 가 한다.
 *  - JS(WebView)는 시작/정지만 호출하고, 정지 시 네이티브가 만든 오디오 파일 경로를 돌려받는다.
 *  - WebView 가 화면 꺼짐으로 얼어붙어도, 녹음은 서비스에서 계속된다.
 *
 * v9.8(O-0442)
 *  - start({kind}) : 녹음의 종류(meeting 회의 · chat 음성 대화 한 마디 · idea 아이디어). 서비스는 하나뿐이라,
 *    다른 종류의 녹음이 이미 돌고 있으면 시작을 거절한다(code "busy"). 예전에는 조용히 그 녹음을 넘겨받아,
 *    회의 녹음이 음성 대화 한 마디로 끝나 버릴 수 있었다. 같은 종류(또는 종류를 안 준 옛 호출)는 예전 그대로.
 *  - isRecording() : value 에 더해 elapsedMs · startedAt · kind · failed · failWhat · bytes 를 돌려준다.
 *    화면이 다시 만들어졌을 때 「녹음 중」을 되찾고, 녹음기가 오류를 알렸는지 화면이 알 수 있게.
 *
 * v9.10(O-0449) 끊긴 녹음 찾기 — 있는 부름(start · stop · isRecording)의 응답은 그대로 두고 덧붙였다.
 *  - start({kind, find, group}) : find=true 면 회의 녹음의 일지를 적는다. group 은 「이어서 녹음」할 때 앞 녹음의 묶음 번호.
 *  - stop({drop}) : 응답에 sid(녹음 번호) · gid(묶음 번호)를 더한다. 이어 녹음이었다면 앞부분과 한 파일로 이어 담아 그 파일을 준다
 *    (joined · gaps · parts). 이어 담기가 실패하면 뒷부분만 준다 — 앞부분은 끊긴 녹음으로 남는다.
 *  - recLost · recOpen · recMark · recSpace · recDiag · recNotice : 아래 각 부름의 설명 참고. 어느 것도 녹음 파일을 지우지 않는다.
 */
@CapacitorPlugin(
        name = "NativeRecorder",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class NativeRecorderPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String kind = call.getString("kind", "");
        if (kind == null) kind = "";
        RecordingService cur = RecordingService.instance;
        if (cur != null && cur.isRecording() && !kind.equals(cur.getKind())) {
            call.reject("다른 녹음이 진행 중입니다. 그 녹음을 먼저 마쳐 주십시오.", "busy");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[]{ "microphone", "notifications" }, call, "afterPerm");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void afterPerm(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStart(call);
        } else {
            call.reject("마이크 권한이 필요합니다. 설정에서 허용해 주세요.");
        }
    }

    private void doStart(final PluginCall call) {
        try {
            Intent i = new Intent(getContext(), RecordingService.class);
            i.setAction(RecordingService.ACTION_START);
            String kind = call.getString("kind", "");
            i.putExtra(RecordingService.EXTRA_KIND, kind == null ? "" : kind);
            // v9.10: 끊긴 녹음 찾기(일지) · 이어 녹음의 묶음 번호 — 녹음 방식에는 닿지 않는다
            i.putExtra(RecordingService.EXTRA_FIND, Boolean.TRUE.equals(call.getBoolean("find", false)));
            String group = call.getString("group", "");
            i.putExtra(RecordingService.EXTRA_GROUP, group == null ? "" : group);
            ContextCompat.startForegroundService(getContext(), i);
        } catch (Exception e) {
            call.reject("녹음 시작 실패: " + e.getMessage());
            return;
        }
        // startForegroundService 는 비동기다. 바로 resolve 하면 서비스 안 startRecordingInternal 의
        // 실패(마이크 점유·MediaRecorder 준비 실패 등)를 조용히 삼켜 "녹음 중"으로 보이지만 실제론
        // 아무것도 안 담기는 사고가 난다(튜터링 다 하고 빈손). → 서비스가 실제로 녹음을 시작했는지
        // 최대 ~2.5초 확인한 뒤 resolve/reject 한다. 확인은 별도 스레드에서(메인 스레드 ANR 방지).
        final long deadlineMs = System.currentTimeMillis() + 2500;
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean started = false;
                while (System.currentTimeMillis() < deadlineMs) {
                    RecordingService svc = RecordingService.instance;
                    if (svc != null && svc.isRecording()) { started = true; break; }
                    try { Thread.sleep(120); } catch (InterruptedException ignored) {}
                }
                if (started) {
                    call.resolve();
                } else {
                    // 서비스는 떴지만 녹음이 시작 못한 경우 → 좀비 포그라운드 서비스 정리 후 명확히 실패 통보.
                    try {
                        RecordingService svc = RecordingService.instance;
                        if (svc != null && !svc.isRecording()) svc.stopAndFinalize();
                    } catch (Exception ignored) {}
                    call.reject("녹음을 시작하지 못했습니다. 마이크가 다른 앱에서 쓰이고 있는지 확인하고 다시 시작해 주세요.");
                }
            }
        }).start();
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        final JSObject ret = new JSObject();
        RecordingService svc = RecordingService.instance;
        if (svc != null) {
            // v9.10: 정지하기 전에 일지에 쓸 값만 읽어 둔다(정지 자체는 아래 한 줄 — 예전 그대로)
            final boolean journal = svc.isFind() && svc.isRecording() && RecordingService.KIND_MEETING.equals(svc.getKind());
            final long startedAt = svc.getStartedAtMs();
            final String kind = svc.getKind(), group = svc.getGroup(), fileName = svc.getFileName();
            String path = svc.stopAndFinalize();
            final long durationMs = (path != null) ? svc.getRecordedDurationMs(path) : 0;
            ret.put("uri", path != null ? ("file://" + path) : null);
            ret.put("durationMs", durationMs);
            if (journal && path != null) {
                final Context app = getContext().getApplicationContext();
                final boolean drop = Boolean.TRUE.equals(call.getBoolean("drop", false));
                long bytes = 0;
                try { bytes = new java.io.File(path).length(); } catch (Throwable ignored) {}
                try { RecNotice.clear(app); } catch (Throwable ignored) {}
                RecJournal.stopped(app, startedAt, fileName, kind, group, durationMs, bytes, drop);   // 녹음기가 정지한 뒤 · 실패해도 삼킨다
                ret.put("sid", RecJournal.sidOf(startedAt));
                ret.put("gid", group.length() > 0 ? group : RecJournal.sidOf(startedAt));
                ret.put("startedAt", startedAt);
                if (group.length() > 0 && !drop) {
                    // 이어 녹음이었다 → 앞부분과 한 파일로(시간이 걸릴 수 있어 다른 스레드에서). 실패하면 뒷부분만 — uri 는 위 그대로.
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            try { fillAssembled(ret, RecJournal.assemble(app, group, null)); } catch (Throwable ignored) {}
                            call.resolve(ret);
                        }
                    }).start();
                    return;
                }
            }
        } else {
            ret.put("uri", (String) null);
            ret.put("durationMs", 0);
        }
        call.resolve(ret);
    }

    /** 이어 담기 결과를 응답에 옮긴다. 성공했을 때만 uri · durationMs 를 바꾼다(실패면 방금 정지한 뒷부분 그대로). */
    private static void fillAssembled(JSObject ret, JSONObject a) {
        try {
            if (a == null) return;
            ret.put("joined", a.optBoolean("joined", false));
            ret.put("parts", a.optInt("parts", 1));
            ret.put("skipped", a.optInt("skipped", 0));
            ret.put("joinMs", a.optLong("joinMs", 0));
            if (a.optString("code", "").length() > 0) ret.put("code", a.optString("code", ""));
            if (!a.optBoolean("ok", false)) return;
            ret.put("gid", a.optString("gid", ret.optString("gid", "")));
            if (a.optBoolean("joined", false)) {
                ret.put("uri", "file://" + a.optString("path", ""));
                ret.put("durationMs", a.optLong("durMs", 0));
                ret.put("startedAt", a.optLong("startedAt", 0));
                JSONArray g = a.optJSONArray("gaps");
                ret.put("gaps", g != null ? g : new JSONArray());
            }
        } catch (Throwable ignored) {}
    }

    private String liveFile() {
        RecordingService svc = RecordingService.instance;
        return (svc != null && svc.isRecording()) ? svc.getFileName() : null;
    }

    /**
     * v9.10: 끊긴 녹음 · 보내지 않은 녹음 목록(묶음 단위).
     * sessAt = 예전 판(v9.8 · v9.9)의 화면이 남겨 둔 「녹음 시작 시각」 표식 — 있으면 그 시각의 파일을 일지에 올린 뒤 찾는다.
     */
    @PluginMethod
    public void recLost(final PluginCall call) {
        final Context app = getContext().getApplicationContext();
        final String live = liveFile();
        long sa = 0;
        try { sa = call.getData().optLong("sessAt", 0); } catch (Throwable ignored) {}   // 시각(ms)은 정수 범위를 넘는다 — 수 종류와 무관하게 읽는다
        final long sessAt = sa;
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject o = new JSObject();
                try {
                    if (sessAt > 0) RecJournal.adoptLegacy(app, sessAt, live);
                    o.put("items", RecJournal.lost(app, live));
                    o.put("now", System.currentTimeMillis());
                } catch (Throwable e) {
                    try { o.put("items", new JSONArray()); } catch (Throwable ignored) {}
                }
                call.resolve(o);
            }
        }).start();
    }

    /** v9.10: 묶음의 녹음을 한 파일로 연다(「여기까지 저장」). 여러 부분이면 이어 담는다. 못 열면 ok=false · code. */
    @PluginMethod
    public void recOpen(final PluginCall call) {
        final Context app = getContext().getApplicationContext();
        final String gid = call.getString("gid", "");
        final String live = liveFile();
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject o = new JSObject();
                try {
                    JSONObject a = (gid == null || gid.length() == 0) ? null : RecJournal.assemble(app, gid, live);
                    boolean ok = a != null && a.optBoolean("ok", false);
                    o.put("ok", ok);
                    if (a != null) {
                        o.put("code", a.optString("code", ""));
                        o.put("skipped", a.optInt("skipped", 0));
                    }
                    if (ok) {
                        o.put("uri", "file://" + a.optString("path", ""));
                        o.put("durationMs", a.optLong("durMs", 0));
                        o.put("startedAt", a.optLong("startedAt", 0));
                        o.put("endedAt", a.optLong("endedAt", 0));
                        o.put("joined", a.optBoolean("joined", false));
                        o.put("parts", a.optInt("parts", 1));
                        o.put("gid", a.optString("gid", gid));
                        JSONArray g = a.optJSONArray("gaps");
                        o.put("gaps", g != null ? g : new JSONArray());
                    }
                } catch (Throwable e) {
                    try { o.put("ok", false); o.put("code", "error"); } catch (Throwable ignored) {}
                }
                call.resolve(o);
            }
        }).start();
    }

    /**
     * v9.10: 묶음에 표시를 남긴다. state = handed(임시저장 · 보내기로 넘김) | dropped(버림 · 목록에서 뺌) | asked(한 번 여쭘 — 상태는 그대로).
     * 파일은 어느 경우에도 지우지 않는다.
     */
    @PluginMethod
    public void recMark(PluginCall call) {
        JSObject o = new JSObject();
        boolean ok = false;
        try {
            Context app = getContext().getApplicationContext();
            String gid = call.getString("gid", "");
            String state = call.getString("state", "");
            String how = call.getString("how", "");
            if (gid != null && gid.length() > 0 && state != null) {
                if ("asked".equals(state)) { RecJournal.flagGroup(app, gid, "asked", "1"); ok = true; }
                else if (RecJournal.ST_HANDED.equals(state) || RecJournal.ST_DROPPED.equals(state)) ok = RecJournal.markGroup(app, gid, state, how);
            }
        } catch (Throwable ignored) {}
        o.put("ok", ok);
        call.resolve(o);
    }

    /** v9.10: 남은 저장 공간(MB) — 읽기만 한다. 모르면 -1. */
    @PluginMethod
    public void recSpace(PluginCall call) {
        JSObject o = new JSObject();
        long mb = -1;
        try { mb = RecJournal.freeMb(getContext().getApplicationContext()); } catch (Throwable ignored) {}
        o.put("freeMb", mb);
        call.resolve(o);
    }

    /** v9.10: 진단 값 — 폰 상태 · 앱이 지난번에 끝난 사유 · 일지 요약 · 옛 원본 수. 소리 내용 · 제목은 들어가지 않는다. */
    @PluginMethod
    public void recDiag(final PluginCall call) {
        final Context app = getContext().getApplicationContext();
        final String sid = call.getString("sid", "");
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject o = new JSObject();
                try {
                    o.put("sdk", Build.VERSION.SDK_INT);
                    o.put("model", Build.MODEL == null ? "" : Build.MODEL);
                    o.put("now", RecJournal.snap(app));
                    o.put("exits", RecJournal.exits(app));
                    o.put("j", RecJournal.counts(app));
                    o.put("old", RecJournal.legacyStats(app));
                    if (sid != null && sid.length() > 0) {
                        JSONObject e = RecJournal.get(app, sid);
                        if (e != null) {
                            JSONObject cur = new JSONObject();
                            cur.put("s0", e.optJSONObject("s0"));
                            cur.put("s1", e.optJSONObject("s1"));
                            cur.put("at", e.optLong("startedAt", 0));
                            cur.put("end", e.optLong("stoppedAt", 0));
                            cur.put("ms", e.optLong("durMs", 0));
                            cur.put("kb", e.optLong("bytes", 0) / 1024L);
                            o.put("cur", cur);
                        }
                    }
                } catch (Throwable ignored) {}
                call.resolve(o);
            }
        }).start();
    }

    /** v9.10: 「녹음이 끊겼습니다」 알림 한 번(화면이 「서비스가 사라졌다」를 알아챈 경우). 같은 녹음에는 되풀이하지 않는다. */
    @PluginMethod
    public void recNotice(PluginCall call) {
        JSObject o = new JSObject();
        boolean posted = false;
        try {
            long sa = call.getData().optLong("startedAt", 0);
            posted = RecNotice.post(getContext().getApplicationContext(), sa);
        } catch (Throwable ignored) {}
        o.put("posted", posted);
        call.resolve(o);
    }

    @PluginMethod
    public void isRecording(PluginCall call) {
        JSObject o = new JSObject();
        RecordingService svc = RecordingService.instance;
        boolean on = svc != null && svc.isRecording();
        o.put("value", on);
        o.put("elapsedMs", on ? svc.getElapsedMs() : 0);
        o.put("startedAt", on ? svc.getStartedAtMs() : 0);
        o.put("kind", svc != null ? svc.getKind() : "");
        o.put("failed", svc != null && svc.isFailed());
        o.put("failWhat", svc != null ? svc.getFailWhat() : 0);
        o.put("bytes", on ? svc.getBytes() : 0);
        call.resolve(o);
    }

    /** 현재 녹음의 최대 진폭(0~32767) — 무음 자동 감지(핸즈프리)용. 녹음 중 아니면 0. */
    @PluginMethod
    public void getAmplitude(PluginCall call) {
        JSObject o = new JSObject();
        RecordingService svc = RecordingService.instance;
        o.put("value", svc != null ? svc.getMaxAmplitude() : 0);
        call.resolve(o);
    }
}
