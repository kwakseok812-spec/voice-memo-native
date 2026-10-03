package com.kwak.voicememo;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
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
 *  - JS: Capacitor.Plugins.KSpeech
 *      available()                  → {available, onDevice, sdk}
 *      start({lang, partial, continuous, muteRestart, completeMs, possiblyMs, minMs}) → 바로 resolve, 이후 이벤트로 결과
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
        final int completeMs = call.getInt("completeMs", 0);
        final int possiblyMs = call.getInt("possiblyMs", 0);
        final int minMs = call.getInt("minMs", 0);
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                destroyRec();
                session++;
                continuous = cont; stopping = false; muteRestart = mute;
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
                try {
                    listenAt = System.currentTimeMillis();
                    rec.startListening(it);
                } catch (Exception e) {
                    destroyRec();
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
    }

    private void emitError(int code, String reason, boolean isDev) {
        JSObject o = new JSObject();
        o.put("code", code); o.put("reason", reason); o.put("onDevice", isDev);
        notifyListeners("error", o);
        destroyRec();
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
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnPause() {
        try { unmute(); } catch (Exception ignored) {}
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        try { session++; unmute(); destroyRec(); } catch (Exception ignored) {}
        super.handleOnDestroy();
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
