package com.kwak.voicememo;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
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
 *  - JS: Capacitor.Plugins.KSpeech
 *      available()                  → {available, onDevice, sdk}
 *      start({lang, partial, completeMs, possiblyMs}) → 바로 resolve, 이후 이벤트로 결과
 *      stop()  : 지금까지 들은 것으로 마무리(final 이벤트)     cancel(): 버림(아무 이벤트 없이 끝)
 *    이벤트(addListener): 'ready' · 'speech'(말 시작) · 'partial'{text} · 'end'(말 끝 감지) · 'final'{text, onDevice}
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
    private int session = 0;                       // 시작할 때마다 +1 — 앞 세션의 늦은 콜백을 버린다
    private static boolean onDeviceBroken = false; // 기기 내 한국어 모델이 없다고 한 번 확인되면 이번 실행 동안 일반 인식기
    private PluginCall pendingStart = null;

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
        final int completeMs = call.getInt("completeMs", 0);
        final int possiblyMs = call.getInt("possiblyMs", 0);
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                destroyRec();
                final int my = ++session;
                boolean dev = false;
                try {
                    if (Build.VERSION.SDK_INT >= 31 && !onDeviceBroken
                            && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
                        rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                        dev = true;
                    }
                } catch (Exception e) { rec = null; dev = false; }
                try {
                    if (rec == null) {
                        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                            call.reject("이 기기에서는 받아쓰기를 쓸 수 없어요.", "unavailable");
                            return;
                        }
                        rec = SpeechRecognizer.createSpeechRecognizer(getContext());
                        dev = false;
                    }
                } catch (Exception e) {
                    rec = null;
                    call.reject("받아쓰기를 시작하지 못했어요.", "unavailable");
                    return;
                }
                recOnDevice = dev;
                final boolean isDev = dev;
                rec.setRecognitionListener(new RecognitionListener() {
                    public void onReadyForSpeech(Bundle b) { if (my == session) notifyListeners("ready", new JSObject()); }
                    public void onBeginningOfSpeech() { if (my == session) notifyListeners("speech", new JSObject()); }
                    public void onRmsChanged(float db) { }
                    public void onBufferReceived(byte[] buf) { }
                    public void onEndOfSpeech() { if (my == session) notifyListeners("end", new JSObject()); }
                    public void onError(int code) {
                        if (my != session) return;
                        String reason = reasonOf(code);
                        if (isDev && "lang".equals(reason)) onDeviceBroken = true;   // 다음부터는 일반 인식기
                        JSObject o = new JSObject();
                        o.put("code", code); o.put("reason", reason); o.put("onDevice", isDev);
                        notifyListeners("error", o);
                        destroyRec();
                    }
                    public void onResults(Bundle b) {
                        if (my != session) return;
                        JSObject o = new JSObject();
                        o.put("text", best(b)); o.put("onDevice", isDev);
                        notifyListeners("final", o);
                        destroyRec();
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
                Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                it.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
                it.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                it.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);      // 일반 인식기도 기기 안 모델이 있으면 그걸로
                it.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                // 말 끝 판정 시간(인식기에 따라 무시될 수 있음 — 앱이 부분 결과로 따로 판정한다)
                if (completeMs > 0) it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, (long) completeMs);
                if (possiblyMs > 0) it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, (long) possiblyMs);
                try {
                    rec.startListening(it);
                } catch (Exception e) {
                    destroyRec();
                    call.reject("받아쓰기를 시작하지 못했어요.", "client");
                    return;
                }
                JSObject r = new JSObject(); r.put("onDevice", isDev);
                call.resolve(r);
            }
        });
    }

    /** 지금까지 들은 말로 마무리 → 'final' 이벤트가 온다(인식기가 결과를 정리하는 데 보통 0.1~0.5초). */
    @PluginMethod
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
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
                destroyRec();
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        try { session++; destroyRec(); } catch (Exception ignored) {}
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
