package com.kwak.voicememo;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * 폰에서 바로 받아쓰기 플러그인 (O-0177, 2026-10-03 — 음성 대화 속도 개선 ②).
 *  - 왜: 지금 음성 대화는 「폰 녹음 → 서버 업로드 → PC whisper 전사」라 말이 끝난 뒤 업로드·내려받기·전사(약 2.5~3.5초)가 든다.
 *    안드로이드 SpeechRecognizer 로 말하는 동안 글자를 받으면 말이 끝나는 즉시 글자를 보낼 수 있다.
 *  - 기기 내 인식 우선: Android 12+ 이고 기기 내 인식기가 있으면 createOnDeviceSpeechRecognizer(서버로 소리를 보내지 않음, 보통 삑 소리 없음).
 *    기기 내 한국어 모델이 없다(LANGUAGE_NOT_SUPPORTED/UNAVAILABLE)고 하면 이번 실행 동안은 일반 인식기 + EXTRA_PREFER_OFFLINE 으로.
 *
 *  ▶ O-0189(2026-10-03 긴급, v8.9) 「말하고 있는데 끊고 보내 버린다」 고침 — 이어 듣기(continuous)
 *    안드로이드 인식기는 잠깐 쉬면 스스로 「끝」을 내고 결과(onResults)를 준다. v8.8 은 그 결과를 곧바로 보냈다.
 *    이제 continuous=true 면 인식기가 스스로 끝내도(결과·말 없음·맞는 말 없음) **보내지 않고 그 자리에서 다시 듣기**를 시작한다.
 *    그때까지의 글자는 'segment' 이벤트로 넘기고, 언제 보낼지는 앱(JS)이 「실제로 조용한 시간」으로 정한다.
 *    앱이 stop() 을 부른 뒤에 오는 결과만 'final' 이다. 다시 듣기 사이 공백은 같은 인식기 객체로 즉시 startListening(보통 0.1초 안팎).
 *    다시 들을 때 삑 소리: 기기 내 인식기는 보통 없음. 일반 인식기(구글 앱)는 날 수 있어 muteRestart=true 면 다시 듣는 0.7초 동안만
 *    미디어·시스템 소리를 잠깐 끈다(끝나면 반드시 되돌림 — 화면 나감·플러그인 종료 때도).
 *
 *  ▶ O-0223(2026-10-04) 「듣는 동안 띠링 소리가 크고 불편하다」 — 효과음 줄이기(sfx)
 *    삑·띠링 소리는 앱이 내는 소리가 아니라 안드로이드 받아쓰기(SpeechRecognizer)가 듣기 시작·끝낼 때 스스로 내는 소리다.
 *    인식기에는 「소리 끄기」 옵션이 없어서, 듣는 동안만 그 소리가 나가는 길(미디어·시스템 소리)을 줄이거나 끈다.
 *      sfx='on'   : 예전 그대로(일반 인식기가 다시 들을 때만 0.7초 끔 — muteRestart).
 *      sfx='soft' : (기본) 첫 「듣기 시작」 삑만 작게(지금 음량의 30%) 남기고, 그 뒤 다시 듣기·끝 띠링은 끈다.
 *      sfx='off'  : 듣는 동안 처음부터 끝까지 끈다(시작 삑도 없음).
 *    듣기가 끝나면(final·error·cancel, 끝 띠링이 지나가도록 0.4~0.6초 뒤) 원래 음량·음소거 상태·벨소리 모드로 반드시 되돌린다.
 *    화면을 나가거나(일시정지)·플러그인이 끝나면 즉시 되돌린다. 앱이 강제 종료돼 되돌리지 못했으면
 *    다음에 앱이 켜질 때(load) 저장해 둔 원래 값으로 되돌린다(SharedPreferences 'ksfx').
 *    ⚠️ 부작용: 듣는 그 몇 초 동안은 다른 앱의 음악·시스템 소리도 같이 작아지거나 꺼진다(케이 목소리는 듣는 동안 나오지 않으므로 영향 없음).
 *       대표님이 이미 꺼 둔 소리는 건드리지 않는다. 음량 고정 기기(isVolumeFixed)는 아무것도 하지 않는다.
 *
 *  - JS: Capacitor.Plugins.KSpeech
 *      available()                  → {available, onDevice, sdk}
 *      start({lang, partial, continuous, muteRestart, sfx, completeMs, possiblyMs, minMs}) → 바로 resolve, 이후 이벤트로 결과
 *      stop()  : 지금까지 들은 것으로 마무리(final 이벤트)     cancel(): 버림(아무 이벤트 없이 끝)
 *    이벤트(addListener): 'ready' · 'speech'(소리 시작 감지) · 'partial'{text} · 'end'(인식기가 말 끝이라고 봄)
 *                        · 'segment'{text, why}(이어 듣기 중 인식기가 스스로 끝낸 한 토막 — 곧바로 다시 듣는 중)
 *                        · 'rms'{db}(소리 크기, 0.15초에 한 번) · 'final'{text, onDevice}
 *                        · 'error'{code, reason, onDevice}  (reason: nospeech|nomatch|permission|busy|network|lang|client|server|other)
 *  - 모든 SpeechRecognizer 호출은 메인 스레드에서(안드로이드 규칙).
 *  - 실패해도 앱이 기존 녹음→PC 전사 경로로 자동으로 돌아간다(JS 쪽). 이 플러그인은 소리 파일을 만들지도, 어디로 보내지도 않는다.
 */
@CapacitorPlugin(
        name = "KSpeech",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
        }
)
public class KSpeechPlugin extends Plugin {

    private SpeechRecognizer rec = null;
    private boolean recOnDevice = false;
    private int session = 0;                       // start() 할 때마다 +1 — 앞 세션의 늦은 콜백을 버린다
    private static boolean onDeviceBroken = false; // 기기 내 한국어 모델이 없다고 한 번 확인되면 이번 실행 동안 일반 인식기

    // O-0189 이어 듣기 상태(메인 스레드에서만 만짐)
    private boolean continuous = false;
    private boolean stopping = false;              // 앱이 stop() 을 불렀다 → 다음 결과는 final, 다시 듣지 않음
    private boolean muteRestart = false;
    private Intent lastIntent = null;
    private long listenAt = 0L;                    // 마지막으로 듣기를 시작한 때
    private int quickFails = 0;                    // 시작하자마자(0.4초 안) 끝난 횟수 — 3번 연속이면 그만두고 오류로
    private int restarts = 0;
    private long lastRmsAt = 0L;
    private static final int MAX_RESTARTS = 60;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean muted = false;
    private final Runnable unmuteTask = new Runnable() { public void run() { unmute(); } };

    // O-0223 효과음 줄이기 상태(메인 스레드에서만 만짐)
    private static final float SFX_SOFT_FRAC = 0.3f;           // 「작게」 = 지금 음량의 30%
    private static final int SFX_SOFT_HOLD_MS = 500;           // 「작게」: 준비됨 뒤 이만큼(시작 삑이 지나간 뒤) 끈다
    private static final int[] SFX_STREAMS = { AudioManager.STREAM_MUSIC, AudioManager.STREAM_SYSTEM };
    private static final String SFX_PREFS = "ksfx";
    private String sfx = "on";
    private boolean sfxActive = false;                          // 지금 음량을 바꿔 둔 상태인가
    private boolean sfxQuieted = false;                         // 「작게」에서 시작 삑 뒤 끄기를 이미 했나
    private int[] sfxOrig = new int[SFX_STREAMS.length];       // 바꾸기 전 음량(-1 = 건드리지 않음)
    private int[] sfxSet = new int[SFX_STREAMS.length];        // 우리가 낮춘 음량(되돌릴 때 대표님이 그새 바꿨는지 보려고)
    private boolean[] sfxMuted = new boolean[SFX_STREAMS.length];
    private int sfxRinger = -1;
    private final Runnable sfxRestoreTask = new Runnable() { public void run() { sfxRestore(); } };
    private final Runnable sfxQuietTask = new Runnable() { public void run() { sfxQuiet(); } };

    @Override
    public void load() {
        super.load();
        sfxRecover();                                          // 지난번 강제 종료로 못 되돌린 음량이 있으면 되돌림
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        boolean any = false, dev = false;
        try { any = SpeechRecognizer.isRecognitionAvailable(getContext()); } catch (Exception ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 31) dev = SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()) && !onDeviceBroken;
        } catch (Exception ignored) {}
        o.put("available", any || dev);
        o.put("onDevice", dev);
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "afterPerm");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void afterPerm(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) doStart(call);
        else call.reject("마이크 권한이 필요해요.", "permission");
    }

    private void doStart(final PluginCall call) {
        final String lang = call.getString("lang", "ko-KR");
        final boolean partial = call.getBoolean("partial", true);
        final boolean cont = call.getBoolean("continuous", false);
        final boolean mute = call.getBoolean("muteRestart", false);
        final String sfxOpt = call.getString("sfx", "on");
        final int completeMs = call.getInt("completeMs", 0);
        final int possiblyMs = call.getInt("possiblyMs", 0);
        final int minMs = call.getInt("minMs", 0);
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                destroyRec();
                session++;
                sfx = ("soft".equals(sfxOpt) || "off".equals(sfxOpt)) ? sfxOpt : "on";
                continuous = cont; stopping = false; muteRestart = mute && "on".equals(sfx);   // 줄이기를 쓰면 예전 0.7초 끄기는 안 씀(겹치지 않게)
                quickFails = 0; restarts = 0;
                Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                it.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
                it.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                it.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);      // 일반 인식기도 기기 안 모델이 있으면 그걸로
                it.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                // 말 끝 판정 시간을 넉넉히(인식기에 따라 무시될 수 있음 — 그래서 이어 듣기가 본체다)
                if (completeMs > 0) it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, (long) completeMs);
                if (possiblyMs > 0) it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, (long) possiblyMs);
                if (minMs > 0) it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, (long) minMs);
                lastIntent = it;
                if (!createRec()) { call.reject("이 기기에서는 받아쓰기를 쓸 수 없어요.", "unavailable"); return; }
                sfxBegin();                        // O-0223: 듣기 시작 삑이 나기 전에 줄이거나 끔(sfx='on' 이면 아무것도 안 함)
                try {
                    listenAt = System.currentTimeMillis();
                    rec.startListening(it);
                } catch (Exception e) {
                    destroyRec();
                    sfxRestore();
                    call.reject("받아쓰기를 시작하지 못했어요.", "client");
                    return;
                }
                JSObject r = new JSObject(); r.put("onDevice", recOnDevice);
                call.resolve(r);
            }
        });
    }

    /** 인식기를 만든다(기기 내 우선). 성공하면 true. 메인 스레드에서만. */
    private boolean createRec() {
        boolean dev = false;
        rec = null;
        try {
            if (Build.VERSION.SDK_INT >= 31 && !onDeviceBroken
                    && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
                rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                dev = true;
            }
        } catch (Exception e) { rec = null; dev = false; }
        try {
            if (rec == null) {
                if (!SpeechRecognizer.isRecognitionAvailable(getContext())) return false;
                rec = SpeechRecognizer.createSpeechRecognizer(getContext());
                dev = false;
            }
        } catch (Exception e) { rec = null; return false; }
        recOnDevice = dev;
        final boolean isDev = dev;
        final int my = session;
        rec.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) {
                if (my != session) return;
                main.removeCallbacks(unmuteTask); main.postDelayed(unmuteTask, 250);   // 삑 소리가 지나간 뒤 소리 되돌림
                if (sfxActive && "soft".equals(sfx) && !sfxQuieted) {                 // O-0223 「작게」: 시작 삑이 지나간 뒤부터는 끔
                    main.removeCallbacks(sfxQuietTask); main.postDelayed(sfxQuietTask, SFX_SOFT_HOLD_MS);
                }
                notifyListeners("ready", new JSObject());
            }
            public void onBeginningOfSpeech() { if (my == session) notifyListeners("speech", new JSObject()); }
            public void onRmsChanged(float db) {
                if (my != session) return;
                long now = System.currentTimeMillis();
                if (now - lastRmsAt < 150) return;
                lastRmsAt = now;
                JSObject o = new JSObject(); o.put("db", (double) db);
                notifyListeners("rms", o);
            }
            public void onBufferReceived(byte[] buf) { }
            public void onEndOfSpeech() { if (my == session) notifyListeners("end", new JSObject()); }
            public void onError(int code) {
                if (my != session) return;
                String reason = reasonOf(code);
                if (isDev && "lang".equals(reason)) onDeviceBroken = true;   // 다음부터는 일반 인식기
                boolean soft = "nospeech".equals(reason) || "nomatch".equals(reason);
                if (stopping) {                    // 마무리 중이었다 → 더 들은 말 없음으로 마무리
                    if (soft || "client".equals(reason)) { emitFinal("", isDev); return; }
                }
                if (continuous && !stopping && (soft || "client".equals(reason) || "busy".equals(reason))) {
                    // O-0189: 말이 잠깐 없었다고 끝내지 않는다 → 그 자리에서 다시 듣기
                    if (tooQuick() || restarts >= MAX_RESTARTS) { emitError(code, reason, isDev); return; }
                    segment("", reason);
                    restartListening(!soft);       // client·busy 는 인식기를 새로 만들어서
                    return;
                }
                emitError(code, reason, isDev);
            }
            public void onResults(Bundle b) {
                if (my != session) return;
                String t = best(b);
                if (continuous && !stopping && restarts < MAX_RESTARTS) {
                    // O-0189: 인식기가 스스로 끝냈다(잠깐 쉼) → 보내지 않고 이 토막만 넘긴 뒤 곧바로 다시 듣기
                    quickFails = 0;
                    segment(t, "results");
                    restartListening(false);
                    return;
                }
                emitFinal(t, isDev);
            }
            public void onPartialResults(Bundle b) {
                if (my != session) return;
                String t = best(b);
                if (t.length() == 0) return;
                JSObject o = new JSObject(); o.put("text", t);
                notifyListeners("partial", o);
            }
            public void onEvent(int type, Bundle b) { }
        });
        return true;
    }

    private boolean tooQuick() {
        if (System.currentTimeMillis() - listenAt < 400) quickFails++; else quickFails = 0;
        return quickFails >= 3;
    }

    private void segment(String text, String why) {
        JSObject o = new JSObject(); o.put("text", text == null ? "" : text); o.put("why", why);
        notifyListeners("segment", o);
    }

    private void emitFinal(String text, boolean isDev) {
        JSObject o = new JSObject();
        o.put("text", text == null ? "" : text); o.put("onDevice", isDev);
        notifyListeners("final", o);
        destroyRec();
        sfxRestoreLater(600);                      // O-0223: 끝 띠링이 지나간 뒤 원래 음량으로
    }

    private void emitError(int code, String reason, boolean isDev) {
        JSObject o = new JSObject();
        o.put("code", code); o.put("reason", reason); o.put("onDevice", isDev);
        notifyListeners("error", o);
        destroyRec();
        sfxRestoreLater(400);
    }

    /** 이어 듣기: 같은 세션으로 다시 듣는다. recreate=true 면 인식기를 새로 만든다(바쁨·클라이언트 오류 뒤). 메인 스레드. */
    private void restartListening(boolean recreate) {
        restarts++;
        if (muteRestart && !recOnDevice) muteBriefly();
        final int my = session;
        Runnable go = new Runnable() {
            public void run() {
                if (my != session || stopping) return;
                try {
                    if (rec == null) { if (!createRec()) { emitError(5, "client", recOnDevice); return; } }
                    listenAt = System.currentTimeMillis();
                    rec.startListening(lastIntent);
                } catch (Exception e) {
                    emitError(5, "client", recOnDevice);
                }
            }
        };
        if (recreate) {
            SpeechRecognizer r = rec; rec = null;
            if (r != null) { try { r.cancel(); } catch (Exception ignored) {} try { r.destroy(); } catch (Exception ignored) {} }
            main.postDelayed(go, 120);
        } else {
            go.run();                              // 같은 인식기로 즉시(공백 최소)
        }
    }

    // ── 다시 들을 때 삑 소리 잠깐 끄기(일반 인식기에서만, 앱이 요청했을 때만) ──
    private void muteBriefly() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (!muted) {
                try { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0); } catch (Exception ignored) {}
                try { am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0); } catch (Exception ignored) {}
                muted = true;
            }
            main.removeCallbacks(unmuteTask);
            main.postDelayed(unmuteTask, 700);     // 인식기가 준비됐다고 알려 오면 더 일찍(0.25초 뒤) 되돌린다
        } catch (Exception ignored) {}
    }

    private void unmute() {
        main.removeCallbacks(unmuteTask);
        if (!muted) return;
        muted = false;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            try { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
            try { am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    /** 지금까지 들은 말로 마무리 → 'final' 이벤트가 온다(인식기가 결과를 정리하는 데 보통 0.1~0.5초). */
    @PluginMethod
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                stopping = true;
                unmute();
                try { if (rec != null) rec.stopListening(); } catch (Exception ignored) {}
                call.resolve();
            }
        });
    }

    /** 버린다(결과 이벤트 없음). 대화 끝내기·화면 나감·폴백 전환 때. */
    @PluginMethod
    public void cancel(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                session++;
                stopping = true;
                unmute();
                destroyRec();
                sfxRestoreLater(400);
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnPause() {
        try { unmute(); } catch (Exception ignored) {}
        try { sfxRestore(); } catch (Exception ignored) {}      // O-0223: 화면을 나가면 즉시 원래 음량
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        try { session++; unmute(); destroyRec(); } catch (Exception ignored) {}
        try { sfxRestore(); } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    // ── O-0223 효과음 줄이기(sfx='soft'|'off') ─────────────────────────────────────────────
    private AudioManager am() {
        try { return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE); } catch (Exception e) { return null; }
    }

    /** 듣기 시작 직전. 원래 값을 저장(강제 종료 대비 파일에도)하고 「작게」면 30%로, 「끔」이면 음소거. 메인 스레드. */
    private void sfxBegin() {
        main.removeCallbacks(sfxQuietTask);
        if (sfxActive) sfxRestore();       // 앞 턴 되돌리기가 남아 있으면(0.4~0.6초 대기 중) 먼저 끝냄
        if ("on".equals(sfx)) return;
        AudioManager a = am();
        if (a == null) return;
        try { if (a.isVolumeFixed()) return; } catch (Exception ignored) {}
        boolean any = false;
        try { sfxRinger = a.getRingerMode(); } catch (Exception e) { sfxRinger = -1; }
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            int s = SFX_STREAMS[i];
            sfxOrig[i] = -1; sfxSet[i] = -1; sfxMuted[i] = false;
            try {
                if (a.isStreamMute(s)) continue;               // 대표님이 이미 꺼 둔 소리는 건드리지 않음
                int cur = a.getStreamVolume(s);
                if (cur <= 0) continue;
                sfxOrig[i] = cur;
                any = true;
            } catch (Exception ignored) {}
        }
        if (!any) return;
        sfxActive = true; sfxQuieted = false;
        sfxSave();
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            if (sfxOrig[i] < 0) continue;
            int s = SFX_STREAMS[i];
            try {
                if ("soft".equals(sfx)) {
                    int v = Math.max(1, Math.round(sfxOrig[i] * SFX_SOFT_FRAC));
                    if (v < sfxOrig[i]) { a.setStreamVolume(s, v, 0); sfxSet[i] = v; }
                } else {
                    a.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, 0); sfxMuted[i] = true;
                }
            } catch (Exception ignored) {}
        }
        sfxSave();
        if ("soft".equals(sfx)) {
            // 인식기가 「준비됨」을 안 알려 오는 기기 대비: 1.5초 뒤엔 어쨌든 끔(시작 삑은 그 전에 남)
            main.postDelayed(sfxQuietTask, 1500);
        }
    }

    /** 「작게」: 시작 삑이 지나간 뒤 — 이번 듣기의 나머지(다시 듣기 삑·끝 띠링)는 끔. */
    private void sfxQuiet() {
        main.removeCallbacks(sfxQuietTask);
        if (!sfxActive || sfxQuieted) return;
        sfxQuieted = true;
        AudioManager a = am();
        if (a == null) return;
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            if (sfxOrig[i] < 0 || sfxMuted[i]) continue;
            try { a.adjustStreamVolume(SFX_STREAMS[i], AudioManager.ADJUST_MUTE, 0); sfxMuted[i] = true; } catch (Exception ignored) {}
        }
        sfxSave();
    }

    private void sfxRestoreLater(int ms) {
        main.removeCallbacks(sfxQuietTask);
        if (!sfxActive) return;
        main.removeCallbacks(sfxRestoreTask);
        main.postDelayed(sfxRestoreTask, ms);
    }

    /** 원래대로: 음소거 풀기 → 낮춘 음량 되돌리기(그새 대표님이 직접 바꿨으면 그 값 존중) → 벨소리 모드가 바뀌었으면 되돌리기. */
    private void sfxRestore() {
        main.removeCallbacks(sfxRestoreTask);
        main.removeCallbacks(sfxQuietTask);
        if (!sfxActive) return;
        sfxActive = false;
        AudioManager a = am();
        if (a != null) {
            for (int i = 0; i < SFX_STREAMS.length; i++) {
                int s = SFX_STREAMS[i];
                if (sfxMuted[i]) { try { a.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {} }
                if (sfxOrig[i] >= 0 && sfxSet[i] >= 0) {
                    try { if (a.getStreamVolume(s) == sfxSet[i]) a.setStreamVolume(s, sfxOrig[i], 0); } catch (Exception ignored) {}
                }
                sfxMuted[i] = false; sfxSet[i] = -1; sfxOrig[i] = -1;
            }
            // 시스템 소리가 벨소리와 묶인 폰에서 음소거가 진동 모드로 바꿨을 수 있다 → 원래 모드로
            try { if (sfxRinger >= 0 && a.getRingerMode() != sfxRinger) a.setRingerMode(sfxRinger); } catch (Exception ignored) {}
        }
        sfxRinger = -1;
        sfxClearSaved();
    }

    private void sfxSave() {
        try {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < SFX_STREAMS.length; i++) {
                b.append(sfxOrig[i]).append(',').append(sfxSet[i]).append(',').append(sfxMuted[i] ? 1 : 0).append(';');
            }
            getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE).edit()
                    .putString("st", b.toString()).putInt("ringer", sfxRinger).apply();
        } catch (Exception ignored) {}
    }

    private void sfxClearSaved() {
        try { getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE).edit().clear().apply(); } catch (Exception ignored) {}
    }

    /** 앱이 켜질 때: 지난번에 되돌리지 못한 값이 남아 있으면 되돌린다. */
    private void sfxRecover() {
        try {
            SharedPreferences p = getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE);
            String st = p.getString("st", null);
            if (st == null || st.length() == 0) return;
            String[] parts = st.split(";");
            for (int i = 0; i < SFX_STREAMS.length && i < parts.length; i++) {
                String[] f = parts[i].split(",");
                if (f.length < 3) continue;
                sfxOrig[i] = Integer.parseInt(f[0]); sfxSet[i] = Integer.parseInt(f[1]); sfxMuted[i] = "1".equals(f[2]);
            }
            sfxRinger = p.getInt("ringer", -1);
            sfxActive = true;
            sfxRestore();
        } catch (Exception e) {
            sfxClearSaved();
        }
    }

    private void destroyRec() {
        SpeechRecognizer r = rec;
        rec = null;
        if (r == null) return;
        try { r.cancel(); } catch (Exception ignored) {}
        try { r.destroy(); } catch (Exception ignored) {}
    }

    private static String best(Bundle b) {
        try {
            ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (l != null && l.size() > 0 && l.get(0) != null) return l.get(0).trim();
        } catch (Exception ignored) {}
        return "";
    }

    private static String reasonOf(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "nospeech";          // 6
            case SpeechRecognizer.ERROR_NO_MATCH: return "nomatch";                 // 7
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission"; // 9
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";             // 8
            case SpeechRecognizer.ERROR_NETWORK:                                    // 2
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";          // 1
            case SpeechRecognizer.ERROR_CLIENT: return "client";                    // 5
            case SpeechRecognizer.ERROR_SERVER: return "server";                    // 4
            case 10: return "busy";      // ERROR_TOO_MANY_REQUESTS (API 31)
            case 11: return "server";    // ERROR_SERVER_DISCONNECTED (API 31)
            case 12:                     // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: return "lang";      // ERROR_LANGUAGE_UNAVAILABLE (API 31)
            default: return "other";
        }
    }
}
