package com.kwak.voicememo;

import android.Manifest;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.res.Resources;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.media.AudioRecordingConfiguration;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
import java.util.Collections;
import java.util.List;

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
 *    인식기에는 「소리 끄기」 옵션이 없어서, 듣는 동안만 그 소리가 나가는 길을 줄이거나 끈다.
 *    (v9.1 은 그 길을 미디어·시스템 소리로 잡았으나 틀렸다 → O-0233 에서 「알림 소리」로 바꿨다. 아래 부작용 설명도 O-0233 것이 맞다.)
 *      sfx='on'   : 예전 그대로(일반 인식기가 다시 들을 때만 0.7초 끔 — muteRestart).
 *      sfx='soft' : (기본) 첫 「듣기 시작」 삑만 작게(지금 음량의 30%) 남기고, 그 뒤 다시 듣기·끝 띠링은 끈다.
 *      sfx='off'  : 듣는 동안 처음부터 끝까지 끈다(시작 삑도 없음).
 *    듣기가 끝나면(final·error·cancel, 끝 띠링이 지나가도록 0.4~0.6초 뒤) 원래 음량·음소거 상태로 반드시 되돌린다.
 *    화면을 나가거나(일시정지)·플러그인이 끝나면 즉시 되돌린다. 앱이 강제 종료돼 되돌리지 못했으면
 *    다음에 앱이 켜질 때(load) 저장해 둔 원래 값으로 되돌린다(SharedPreferences 'ksfx').
 *    대표님이 이미 꺼 둔 소리는 건드리지 않는다. 음량 고정 기기(isVolumeFixed)는 아무것도 하지 않는다.
 *
 *  ▶ O-0233(2026-10-05) 「끔으로 해도 삑 소리가 난다」 — 줄이는 통로를 「알림 소리」로 바꿈 + 진단 값
 *    v9.1(O-0223)은 미디어·시스템 소리를 줄였는데 대표님 폰(갤럭시 폴드8)에서는 「끔」에서도 삑 소리가 그대로 났다.
 *    대표님이 폰 음량 막대(시스템·알림·AI 어시스턴트·벨소리·미디어) 가운데 「알림」을 끄니 소리가 사라졌다
 *    → 이 폰의 받아쓰기 신호음은 알림 통로(STREAM_NOTIFICATION)로 난다.
 *    ① 듣는 동안 줄이거나 끄는 통로 = 알림 소리 하나. 미디어·시스템은 더 이상 건드리지 않는다
 *       (이 폰에서는 효과가 없었고, 미디어를 끄면 그 순간 다른 앱 음악·블루투스 기기 음량까지 건드리게 된다).
 *    ② 벨소리(전화 오는 소리)는 절대 줄이지 않는다. 알림과 벨소리가 한 묶음인 폰에서는 알림을 줄이면 벨소리도 같이 바뀌므로,
 *       바꾼 직후 벨소리 음량·음소거·벨소리 모드를 다시 읽어 달라졌으면 그 자리에서 되돌리고 그 폰에서는 다시 시도하지 않는다.
 *    ③ 벨소리 모드가 「소리」이고 방해 금지가 꺼져 있을 때만 건드린다. 진동·무음·방해 금지 중에는 알림 소리가 이미 나지 않고,
 *       그때 음량을 만지면 벨소리 모드가 바뀌거나 권한 오류가 날 수 있다. 듣는 도중에 진동·무음으로 바꾸셨으면
 *       되돌리기를 미뤄 두었다가 「소리」 모드로 돌아오는 순간(또는 다음 듣기·다음 앱 실행 때) 원래 음량으로 되돌린다.
 *    ④ 음량을 바꿀 때 플래그는 0(화면에 음량 막대가 뜨지 않음).
 *    ⑤ 진단 값(diag): 폰에서 실제로 무슨 일이 일어나는지 PC 로그로 보려고, 듣기 시작·준비·끝마다 통로별 음량·음소거 여부,
 *       줄이기·끄기 호출의 결과(성공·안 먹힘·예외 이름 — 예외를 삼키지 않고 남긴다), 소리 출력 기기 종류, 실제로 쓴 인식기,
 *       듣는 동안 새로 소리를 낸 재생기의 쓰임새(usage)·통로, 앞 턴을 제대로 되돌렸는지를 모은다.
 *       앱(JS)이 음성 턴의 meta.vend.dg 에 실어 보낸다. 글 내용·소리·개인정보는 없다(숫자와 시스템 부품 이름뿐).
 *    ⚠️ 부작용: 듣는 그 몇 초 동안은 카카오톡 같은 다른 앱의 알림 소리도 같이 작아지거나 나지 않는다(알림 자체는 온다).
 *
 *  - JS: Capacitor.Plugins.KSpeech
 *      available()                  → {available, onDevice, sdk}
 *      start({lang, partial, continuous, muteRestart, sfx, completeMs, possiblyMs, minMs}) → 바로 resolve, 이후 이벤트로 결과
 *      stop()  : 지금까지 들은 것으로 마무리(final 이벤트)     cancel(): 버림(아무 이벤트 없이 끝)
 *    이벤트(addListener): 'ready' · 'speech'(소리 시작 감지) · 'partial'{text} · 'end'(인식기가 말 끝이라고 봄)
 *                        · 'segment'{text, why}(이어 듣기 중 인식기가 스스로 끝낸 한 토막 — 곧바로 다시 듣는 중)
 *                        · 'rms'{db}(소리 크기, 0.15초에 한 번) · 'final'{text, onDevice}
 *                        · 'error'{code, reason, onDevice}  (reason: nospeech|nomatch|permission|busy|network|lang|client|server|other)
 *                        · 'diag'{k:'s'|'r', ...}(O-0233 진단 — s=듣기 시작 직후, r=준비됨 0.35초 뒤). final·error 에는 diag{k:'e',...} 칸이 붙는다.
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

    // O-0223·O-0233 효과음 줄이기 상태(메인 스레드에서만 만짐)
    private static final float SFX_SOFT_FRAC = 0.3f;           // 「작게」 = 지금 음량의 30%
    private static final int SFX_SOFT_HOLD_MS = 500;           // 「작게」: 준비됨 뒤 이만큼(시작 삑이 지나간 뒤) 끈다
    // O-0233: 대표님 폰에서 받아쓰기 신호음이 나는 통로 = 알림 소리. ⛔ 벨소리(STREAM_RING)는 넣지 않는다.
    private static final int[] SFX_STREAMS = { AudioManager.STREAM_NOTIFICATION };
    private static final String SFX_PREFS = "ksfx";
    private String sfx = "on";
    private boolean sfxActive = false;                          // 지금 음량을 바꿔 둔 상태인가
    private boolean sfxQuieted = false;                         // 「작게」에서 시작 삑 뒤 끄기를 이미 했나
    private boolean sfxPending = false;                         // 되돌리기를 미뤄 둔 상태(진동·무음·방해 금지 중이라 지금 건드리면 안 됨)
    private int[] sfxOrig = new int[SFX_STREAMS.length];       // 바꾸기 전 음량(-1 = 건드리지 않음)
    private int[] sfxSet = new int[SFX_STREAMS.length];        // 우리가 낮춘 음량(되돌릴 때 대표님이 그새 바꿨는지 보려고)
    private boolean[] sfxMuted = new boolean[SFX_STREAMS.length];
    private static String sfxUnsafe = null;                     // 이 폰은 알림을 줄이면 벨소리 쪽이 같이 바뀐다 → 쓰지 않음(이유). 파일에도 남김
    private BroadcastReceiver sfxModeRx = null;                 // 미뤄 둔 되돌리기: 「소리」 모드로 돌아오는 순간을 기다림
    private final Runnable sfxRestoreTask = new Runnable() { public void run() { sfxRestore(); } };
    private final Runnable sfxQuietTask = new Runnable() { public void run() { sfxQuiet(); } };

    // O-0233 진단 상태(메인 스레드에서만 만짐). 글 내용·소리는 담지 않는다.
    private static final int[] DG_STREAMS = { 5, 2, 1, 3, 11 };          // 알림·벨소리·시스템·미디어·AI 어시스턴트(11) — 읽기만
    private static final int DG_PB_MAX = 10;
    private static final int DG_LATE_MS = 1500;                // 되돌린 뒤 이만큼 더 지켜본다(늦게 난 끝 소리를 잡으려고)
    private static String dgStatic = null;                      // 기기·인식기 부품 이름 등 바뀌지 않는 값(한 번만 구함)
    private long dgStartAt = 0L;                                // 이번 듣기를 시작한 때
    private long dgLateAt = 0L;                                 // 되돌린 때
    private int dgReadyMs = -1;                                 // 시작 → 인식기 「준비됨」까지 걸린 ms
    private boolean dgReadySent = false;
    private String dgAct = "";                                  // 통로별로 한 일과 결과(예: 5:mute.ok)
    private String dgQuiet = "";                                // 「작게」 2단계(끄기) 결과
    private final StringBuilder dgErr = new StringBuilder();    // 인식기가 스스로 끝낸 이유(오류 코드)
    private final ArrayList<String> dgPb = new ArrayList<String>();          // 듣는 동안 재생 목록이 바뀐 기록("ms:쓰임새…")
    private final ArrayList<String> dgPrevLate = new ArrayList<String>();    // 앞 턴: 되돌린 뒤에 난 소리
    private String dgPbLast = "";
    private Object dgPbCb = null;                               // AudioManager.AudioPlaybackCallback(API 26+)
    private boolean dgLateOn = false;                           // 되돌린 뒤 지켜보는 중
    private String dgPrevRestore = "";                          // 앞 턴: 되돌린 결과
    private final Runnable dgLateEndTask = new Runnable() { public void run() { dgPbStop(); } };
    private final Runnable dgReadyTask = new Runnable() { public void run() { dgEmitReady(); } };

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
                String dgBefore = "";
                try {
                    if (sfxActive || sfxPending) sfxRestore();   // 앞 턴 되돌리기가 남아 있으면(0.4~0.6초 대기 중·미뤄 둠) 먼저 끝냄
                    dgBegin();                                   // O-0233: 이번 듣기의 진단 값 모으기 시작(읽기만)
                    dgBefore = dgStreams(am(), true);
                } catch (Throwable ignored) {}
                sfxBegin();                        // O-0223·O-0233: 듣기 시작 삑이 나기 전에 알림 소리를 줄이거나 끔(sfx='on' 이면 아무것도 안 함)
                try {
                    listenAt = System.currentTimeMillis();
                    rec.startListening(it);
                } catch (Exception e) {
                    destroyRec();
                    sfxRestore();
                    dgStopSoon();
                    call.reject("받아쓰기를 시작하지 못했어요.", "client");
                    return;
                }
                JSObject r = new JSObject(); r.put("onDevice", recOnDevice);
                call.resolve(r);
                try { notifyListeners("diag", dgStartObj(dgBefore)); } catch (Throwable ignored) {}   // O-0233: 시작 직후 상태
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
                if (!dgReadySent) {                                                    // O-0233: 준비됨 0.35초 뒤(시작 삑이 난 직후) 한 번
                    dgReadySent = true; dgReadyMs = (int) (System.currentTimeMillis() - dgStartAt);
                    main.removeCallbacks(dgReadyTask); main.postDelayed(dgReadyTask, 350);
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
                if (dgErr.length() < 40) dgErr.append(dgErr.length() > 0 ? "," : "").append(code);   // O-0233 진단
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
        try { o.put("diag", dgEndObj()); } catch (Throwable ignored) {}      // O-0233: 끝 상태(되돌리기 전)
        notifyListeners("final", o);
        destroyRec();
        dgStopSoon();
        sfxRestoreLater(600);                      // O-0223: 끝 띠링이 지나간 뒤 원래 음량으로
    }

    private void emitError(int code, String reason, boolean isDev) {
        JSObject o = new JSObject();
        o.put("code", code); o.put("reason", reason); o.put("onDevice", isDev);
        try { o.put("diag", dgEndObj()); } catch (Throwable ignored) {}      // O-0233
        notifyListeners("error", o);
        destroyRec();
        dgStopSoon();
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
                dgStopSoon();
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
        try { main.removeCallbacks(dgReadyTask); dgPbStop(); sfxWatchMode(false); } catch (Throwable ignored) {}
        super.handleOnDestroy();
    }

    // ── O-0223·O-0233 효과음 줄이기(sfx='soft'|'off') — 알림 소리만 ─────────────────────────
    private AudioManager am() {
        try { return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE); } catch (Exception e) { return null; }
    }

    private static String exName(Throwable t) { return t == null ? "?" : t.getClass().getSimpleName(); }

    /** 지금 소리 통로를 건드려도 되는가: 벨소리 모드가 「소리」이고 방해 금지가 꺼져 있을 때만. 안 되면 이유(진단용), 되면 null. */
    private String sfxBlocked(AudioManager a) {
        try {
            int rm = a.getRingerMode();
            if (rm != AudioManager.RINGER_MODE_NORMAL) return "ringer" + rm;      // 0=무음 1=진동
        } catch (Throwable t) { return "ringer.ex"; }
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                int f = nm.getCurrentInterruptionFilter();
                if (f != NotificationManager.INTERRUPTION_FILTER_ALL && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return "zen" + f;
            }
        } catch (Throwable ignored) {}                                           // 못 읽으면 막지 않음
        return null;
    }

    /** 벨소리 쪽 상태 {벨소리 모드, 벨소리 음량, 벨소리 음소거} — 우리가 한 일로 이것이 바뀌면 안 된다. */
    private int[] ringState(AudioManager a) {
        int[] r = { -9, -9, -9 };
        try { r[0] = a.getRingerMode(); } catch (Throwable ignored) {}
        try { r[1] = a.getStreamVolume(AudioManager.STREAM_RING); } catch (Throwable ignored) {}
        try { r[2] = a.isStreamMute(AudioManager.STREAM_RING) ? 1 : 0; } catch (Throwable ignored) {}
        return r;
    }

    private boolean ringChanged(AudioManager a, int[] before) {
        int[] now = ringState(a);
        return now[0] != before[0] || now[1] != before[1] || now[2] != before[2];
    }

    /** 벨소리 모드가 우리 때문에 바뀌었으면 되돌린다(음량·음소거는 방금 한 일을 취소하면 따라 돌아온다). */
    private String ringFix(AudioManager a, int[] before) {
        try {
            if (before[0] >= 0 && a.getRingerMode() != before[0]) a.setRingerMode(before[0]);
        } catch (Throwable t) { return ".ringfix.ex:" + exName(t); }
        return ringChanged(a, before) ? ".ring.still" : "";
    }

    /** 이 앱의 판 번호(versionCode). 「벨소리가 같이 바뀌는 폰」 표시는 같은 판에서만 유효하게 하려고(새 판을 깔면 한 번 다시 확인). */
    private int appVer() {
        try { return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionCode; } catch (Throwable t) { return 0; }
    }

    private void sfxSetUnsafe(String why) {
        sfxUnsafe = why;
        try {
            getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE).edit()
                    .putString("unsafe", why).putInt("unsafeVer", appVer()).apply();
        } catch (Throwable ignored) {}
    }

    /** 「작게」 1단계: 통로 하나의 음량을 30%로. 결과(진단용): v9>3.ok | v1.keep | …no4 | ….undo.ring | ….ex:이름 */
    private String sfxLowerOne(AudioManager a, int i) {
        int s = SFX_STREAMS[i];
        int v = Math.max(1, Math.round(sfxOrig[i] * SFX_SOFT_FRAC));
        if (v >= sfxOrig[i]) return "v" + sfxOrig[i] + ".keep";                 // 이미 가장 작은 음량
        String tag = "v" + sfxOrig[i] + ">" + v;
        int[] ring = ringState(a);
        try {
            a.setStreamVolume(s, v, 0);                                          // 플래그 0 = 음량 막대를 띄우지 않음
            if (ringChanged(a, ring)) {                                          // 벨소리가 같이 바뀌는 폰 → 즉시 취소, 다시는 안 함
                try { a.setStreamVolume(s, sfxOrig[i], 0); } catch (Throwable ignored) {}
                String fix = ringFix(a, ring);
                sfxSetUnsafe("vol");
                return tag + ".undo.ring" + fix;
            }
            int now = a.getStreamVolume(s);
            if (now == v) { sfxSet[i] = v; return tag + ".ok"; }
            if (now != sfxOrig[i]) sfxSet[i] = now;                              // 다른 값으로 바뀌었으면 그 값을 기억(되돌릴 때 비교)
            return tag + ".no" + now;
        } catch (Throwable t) {
            return tag + ".ex:" + exName(t);
        }
    }

    /** 통로 하나를 끈다. 결과(진단용): ok | no>vol0.ok | no>vol0.no | undo.ring | ex:이름 */
    private String sfxMuteOne(AudioManager a, int i) {
        int s = SFX_STREAMS[i];
        int[] ring = ringState(a);
        try {
            a.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, 0);                // 플래그 0 = 음량 막대를 띄우지 않음
            boolean m = a.isStreamMute(s);
            if (ringChanged(a, ring)) {                                          // 벨소리가 같이 꺼지는 폰 → 즉시 취소, 다시는 안 함
                try { a.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, 0); } catch (Throwable ignored) {}
                String fix = ringFix(a, ring);
                sfxSetUnsafe("mute");
                return "undo.ring" + fix;
            }
            if (m) { sfxMuted[i] = true; return "ok"; }
            // 끄기 호출이 받아들여지지 않았다 → 음량을 0으로(대표님이 음량 막대를 0으로 내린 것과 같은 방법)
            int back = sfxSet[i] >= 0 ? sfxSet[i] : sfxOrig[i];
            a.setStreamVolume(s, 0, 0);
            if (ringChanged(a, ring)) {
                try { a.setStreamVolume(s, back, 0); } catch (Throwable ignored) {}
                String fix = ringFix(a, ring);
                sfxSetUnsafe("vol0");
                return "no>vol0.undo.ring" + fix;
            }
            if (a.getStreamVolume(s) == 0) { sfxSet[i] = 0; return "no>vol0.ok"; }
            return "no>vol0.no";
        } catch (Throwable t) {
            return "ex:" + exName(t);
        }
    }

    /** 듣기 시작 직전. 원래 값을 저장(강제 종료 대비 파일에도)하고 「작게」면 30%로, 「끔」이면 음소거. 메인 스레드. */
    private void sfxBegin() {
        main.removeCallbacks(sfxQuietTask);
        dgAct = ""; dgQuiet = "";
        if (sfxActive || sfxPending) sfxRestore();     // 앞 턴 되돌리기가 남아 있으면 먼저 끝냄
        if ("on".equals(sfx)) { dgAct = "on"; return; }
        AudioManager a = am();
        if (a == null) { dgAct = "skip.noam"; return; }
        if (sfxPending) { dgAct = "skip.pending"; return; }                      // 아직 못 되돌린 값이 있다(진동·무음 중) → 새로 건드리지 않음
        if (sfxUnsafe != null) { dgAct = "skip.unsafe." + sfxUnsafe; return; }   // 벨소리가 같이 바뀌는 폰
        try { if (a.isVolumeFixed()) { dgAct = "skip.fixed"; return; } } catch (Throwable ignored) {}
        String blocked = sfxBlocked(a);
        if (blocked != null) { dgAct = "skip." + blocked; return; }              // 진동·무음·방해 금지 중: 알림 소리가 이미 안 남 → 건드리지 않음
        StringBuilder act = new StringBuilder();
        boolean any = false;
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            int s = SFX_STREAMS[i];
            sfxOrig[i] = -1; sfxSet[i] = -1; sfxMuted[i] = false;
            try {
                if (a.isStreamMute(s)) { act.append(s).append(":skip.muted "); continue; }   // 대표님이 이미 꺼 둔 소리는 건드리지 않음
                int cur = a.getStreamVolume(s);
                if (cur <= 0) { act.append(s).append(":skip.0 "); continue; }
                sfxOrig[i] = cur;
                any = true;
            } catch (Throwable t) { act.append(s).append(":read.ex:").append(exName(t)).append(' '); }
        }
        if (!any) { dgAct = act.toString().trim(); return; }
        sfxActive = true; sfxQuieted = false;
        sfxSave();
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            if (sfxOrig[i] < 0) continue;
            String res = "soft".equals(sfx) ? sfxLowerOne(a, i) : ("mute." + sfxMuteOne(a, i));
            act.append(SFX_STREAMS[i]).append(':').append(res).append(' ');
        }
        sfxSave();
        dgAct = act.toString().trim();
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
        if (sfxUnsafe != null) { dgQuiet = "skip.unsafe"; return; }
        String blocked = sfxBlocked(a);
        if (blocked != null) { dgQuiet = "skip." + blocked; return; }            // 그새 진동·무음으로 바꾸셨다 → 건드리지 않음
        StringBuilder q = new StringBuilder();
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            if (sfxOrig[i] < 0 || sfxMuted[i] || sfxSet[i] == 0) continue;
            q.append(SFX_STREAMS[i]).append(':').append(sfxMuteOne(a, i)).append(' ');
        }
        dgQuiet = q.toString().trim();
        sfxSave();
    }

    private void sfxRestoreLater(int ms) {
        main.removeCallbacks(sfxQuietTask);
        if (!sfxActive) return;
        main.removeCallbacks(sfxRestoreTask);
        main.postDelayed(sfxRestoreTask, ms);
    }

    /** 원래대로: 음소거 풀기 → 낮춘 음량 되돌리기(그새 대표님이 직접 바꿨으면 그 값 존중).
     *  진동·무음·방해 금지 중이면 지금 건드리지 않고 미뤄 둔다(sfxPending) — 「소리」 모드로 돌아오면 그때 되돌린다. */
    private void sfxRestore() {
        main.removeCallbacks(sfxRestoreTask);
        main.removeCallbacks(sfxQuietTask);
        if (!sfxActive && !sfxPending) return;
        sfxActive = false;
        AudioManager a = am();
        if (a == null) { sfxPending = true; dgPrevRestore = "wait.noam"; return; }
        String blocked = sfxBlocked(a);
        if (blocked != null) {
            sfxPending = true;                         // 저장해 둔 값(파일)은 지우지 않는다 — 앱이 꺼져도 다음에 켤 때 이어서
            dgPrevRestore = "wait." + blocked;
            sfxWatchMode(true);
            return;
        }
        StringBuilder r = new StringBuilder();
        for (int i = 0; i < SFX_STREAMS.length; i++) {
            int s = SFX_STREAMS[i];
            if (sfxOrig[i] >= 0) {
                String res;
                try {
                    if (sfxMuted[i] && a.isStreamMute(s)) a.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, 0);
                    if (sfxSet[i] >= 0 && a.getStreamVolume(s) == sfxSet[i]) a.setStreamVolume(s, sfxOrig[i], 0);
                    int cur = a.getStreamVolume(s);
                    boolean m = a.isStreamMute(s);
                    res = (cur == sfxOrig[i] && !m) ? "ok" : ("diff" + cur + (m ? "m" : "") + "/" + sfxOrig[i]);   // diff = 원래 값과 다름(대표님이 그새 바꾸셨거나 되돌리기 실패)
                } catch (Throwable t) { res = "ex:" + exName(t); }
                r.append(s).append(':').append(res).append(' ');
            }
            sfxMuted[i] = false; sfxSet[i] = -1; sfxOrig[i] = -1;
        }
        sfxPending = false;
        sfxWatchMode(false);
        dgPrevRestore = r.toString().trim();
        sfxClearSaved();
        dgLateBegin();                                 // 되돌린 뒤에 난 소리(늦게 난 끝 띠링)를 1.5초 지켜봄
    }

    /** 미뤄 둔 되돌리기가 있을 때만: 벨소리 모드·방해 금지가 바뀌는 순간을 듣는다. */
    private void sfxWatchMode(boolean on) {
        Context c;
        try { c = getContext().getApplicationContext(); } catch (Throwable t) { return; }
        if (!on) {
            BroadcastReceiver rx = sfxModeRx; sfxModeRx = null;
            if (rx != null) { try { c.unregisterReceiver(rx); } catch (Throwable ignored) {} }
            return;
        }
        if (sfxModeRx != null) return;
        try {
            BroadcastReceiver rx = new BroadcastReceiver() {
                @Override public void onReceive(Context context, Intent intent) {
                    main.post(new Runnable() { public void run() { if (sfxPending) sfxRestore(); } });
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(AudioManager.RINGER_MODE_CHANGED_ACTION);
            f.addAction(NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) c.registerReceiver(rx, f, Context.RECEIVER_NOT_EXPORTED);   // 시스템이 보내는 방송만 받음
            else c.registerReceiver(rx, f);
            sfxModeRx = rx;
        } catch (Throwable ignored) {}
    }

    private void sfxSave() {
        try {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < SFX_STREAMS.length; i++) {
                b.append(SFX_STREAMS[i]).append(':').append(sfxOrig[i]).append(':').append(sfxSet[i]).append(':').append(sfxMuted[i] ? 1 : 0).append(';');
            }
            getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE).edit().putString("st2", b.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void sfxClearSaved() {
        try { getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE).edit().remove("st2").remove("st").remove("ringer").apply(); } catch (Exception ignored) {}
    }

    /** 앱이 켜질 때: 지난번에 되돌리지 못한 값이 남아 있으면 되돌린다. */
    private void sfxRecover() {
        SharedPreferences p;
        try { p = getContext().getSharedPreferences(SFX_PREFS, Context.MODE_PRIVATE); } catch (Exception e) { return; }
        try {
            String u = p.getString("unsafe", null);
            sfxUnsafe = (u != null && p.getInt("unsafeVer", -1) == appVer()) ? u : null;   // 다른 판에서 남긴 표시는 버림
        } catch (Exception ignored) {}
        try { sfxRecoverV91(p); } catch (Exception ignored) {}
        try {
            String st = p.getString("st2", null);
            if (st == null || st.length() == 0) return;
            for (int i = 0; i < SFX_STREAMS.length; i++) { sfxOrig[i] = -1; sfxSet[i] = -1; sfxMuted[i] = false; }
            boolean any = false;
            for (String part : st.split(";")) {
                String[] f = part.split(":");
                if (f.length < 4) continue;
                int s = Integer.parseInt(f[0]);
                for (int i = 0; i < SFX_STREAMS.length; i++) {
                    if (SFX_STREAMS[i] != s) continue;
                    sfxOrig[i] = Integer.parseInt(f[1]); sfxSet[i] = Integer.parseInt(f[2]); sfxMuted[i] = "1".equals(f[3]);
                    if (sfxOrig[i] >= 0) any = true;
                }
            }
            if (!any) { sfxClearSaved(); return; }
            sfxPending = true;
            sfxRestore();                              // 진동·무음 중이면 미뤄 두고 「소리」 모드를 기다린다
        } catch (Exception e) {
            sfxClearSaved();
        }
    }

    /** v9.1 이 남긴 값(미디어·시스템, 칸 순서 고정)이 있으면 v9.1 과 같은 방법으로 되돌린다 — 새 판을 덮어 설치한 직후 한 번만 해당. */
    private void sfxRecoverV91(SharedPreferences p) {
        String st = p.getString("st", null);
        if (st == null || st.length() == 0) return;
        int ringer = p.getInt("ringer", -1);
        final int[] old = { AudioManager.STREAM_MUSIC, AudioManager.STREAM_SYSTEM };
        AudioManager a = am();
        if (a != null) {
            String[] parts = st.split(";");
            for (int i = 0; i < old.length && i < parts.length; i++) {
                String[] f = parts[i].split(",");
                if (f.length < 3) continue;
                int orig, set;
                try { orig = Integer.parseInt(f[0]); set = Integer.parseInt(f[1]); } catch (Exception e) { continue; }
                if ("1".equals(f[2])) { try { a.adjustStreamVolume(old[i], AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {} }
                if (orig >= 0 && set >= 0) {
                    try { if (a.getStreamVolume(old[i]) == set) a.setStreamVolume(old[i], orig, 0); } catch (Exception ignored) {}
                }
            }
            try { if (ringer >= 0 && a.getRingerMode() != ringer) a.setRingerMode(ringer); } catch (Exception ignored) {}
        }
        try { p.edit().remove("st").remove("ringer").apply(); } catch (Exception ignored) {}
    }

    // ── O-0233 진단 값(읽기만 — 아무것도 바꾸지 않는다) ─────────────────────────────────────
    /** 통로별 음량. 예) "5=9/15 2=11/15 1=7/15 3=10/15m 11=8/15" (m = 음소거, withMax=false 면 "/최대" 생략) */
    private String dgStreams(AudioManager a, boolean withMax) {
        if (a == null) return "";
        StringBuilder b = new StringBuilder();
        for (int s : DG_STREAMS) {
            if (b.length() > 0) b.append(' ');
            b.append(s).append('=');
            try {
                b.append(a.getStreamVolume(s));
                if (withMax) b.append('/').append(a.getStreamMaxVolume(s));
                if (a.isStreamMute(s)) b.append('m');
            } catch (Throwable t) { b.append('x'); }
        }
        return b.toString();
    }

    /** 바뀌지 않는 값: 안드로이드 판·기종·기기 내 인식기 부품·기본 인식기 부품(시스템 부품 이름일 뿐 개인정보 아님). */
    private String dgStaticInfo() {
        if (dgStatic != null) return dgStatic;
        StringBuilder b = new StringBuilder();
        b.append("sdk").append(Build.VERSION.SDK_INT).append(' ').append(Build.MODEL);
        try {
            int id = Resources.getSystem().getIdentifier("config_defaultOnDeviceSpeechRecognitionService", "string", "android");
            b.append(" od=").append(id != 0 ? dgShort(Resources.getSystem().getString(id)) : "-");
        } catch (Throwable t) { b.append(" od=x"); }
        try {
            b.append(" vr=").append(dgShort(Settings.Secure.getString(getContext().getContentResolver(), "voice_recognition_service")));
        } catch (Throwable t) { b.append(" vr=x"); }
        dgStatic = b.toString();
        return dgStatic;
    }

    private static String dgShort(String v) {
        if (v == null || v.length() == 0) return "-";
        v = v.replace(' ', '_');
        return v.length() > 90 ? v.substring(0, 90) : v;
    }

    private static String dgTypes(List<AudioDeviceInfo> l) {
        if (l == null || l.isEmpty()) return "-";
        StringBuilder b = new StringBuilder();
        for (AudioDeviceInfo d : l) { if (b.length() > 0) b.append(','); b.append(d.getType()); }
        return b.toString();
    }

    /** 소리가 어디로 나가는가. out=연결된 출력 기기 종류(2=폰 스피커 1=수화기 8=블루투스 미디어 7=블루투스 통화 26·27=LE 오디오 3·4=유선 22=USB),
     *  rt=쓰임새별 실제 길(API 33+: 1=미디어 5=알림 13=효과음 16=어시스턴트), mode=통화 상태(0=보통 3=통화형), sco=블루투스 통화 길 켜짐. */
    private void dgRoutes(AudioManager a, JSObject o) {
        if (a == null) return;
        try { o.put("mode", a.getMode()); } catch (Throwable ignored) {}
        try { o.put("sco", a.isBluetoothScoOn() ? 1 : 0); } catch (Throwable ignored) {}
        try { o.put("ma", a.isMusicActive() ? 1 : 0); } catch (Throwable ignored) {}
        try {
            StringBuilder b = new StringBuilder();
            for (AudioDeviceInfo d : a.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) { if (b.length() > 0) b.append(','); b.append(d.getType()); }
            o.put("out", b.toString());
        } catch (Throwable ignored) {}
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                int[] us = { AudioAttributes.USAGE_MEDIA, AudioAttributes.USAGE_NOTIFICATION,
                             AudioAttributes.USAGE_ASSISTANCE_SONIFICATION, AudioAttributes.USAGE_ASSISTANT };
                StringBuilder b = new StringBuilder();
                for (int u : us) {
                    if (b.length() > 0) b.append(' ');
                    b.append(u).append('>').append(dgTypes(a.getAudioDevicesForAttributes(new AudioAttributes.Builder().setUsage(u).build())));
                }
                o.put("rt", b.toString());
            } catch (Throwable ignored) {}
        }
    }

    /** 지금 마이크를 쓰는 녹음: "소리원@입력기기종류" (6=음성 인식 1=마이크 7=통화, 기기 15=폰 마이크 7=블루투스 통화 마이크). */
    private String dgRec(AudioManager a) {
        if (a == null) return "";
        try {
            StringBuilder b = new StringBuilder();
            for (AudioRecordingConfiguration c : a.getActiveRecordingConfigurations()) {
                if (b.length() > 0) b.append(',');
                AudioDeviceInfo d = c.getAudioDevice();
                b.append(c.getClientAudioSource()).append('@').append(d != null ? String.valueOf(d.getType()) : "-");
            }
            return b.toString();
        } catch (Throwable t) { return "x"; }
    }

    private void dgBegin() {
        main.removeCallbacks(dgReadyTask);
        main.removeCallbacks(dgLateEndTask);
        dgLateOn = false;                              // 앞 턴 「되돌린 뒤 지켜보기」는 여기서 끝(본 것은 dgPrevLate 에 남아 있음)
        dgStartAt = System.currentTimeMillis();
        dgReadyMs = -1; dgReadySent = false;
        dgErr.setLength(0);
        dgPb.clear();
        dgPbStart();
    }

    /** 듣기가 끝났다 → 재생 감시를 곧 멈춘다(되돌리기가 있으면 그 뒤 1.5초까지 더 본다 — dgLateBegin 이 시간을 다시 잡음). */
    private void dgStopSoon() {
        main.removeCallbacks(dgReadyTask);
        main.removeCallbacks(dgLateEndTask);
        main.postDelayed(dgLateEndTask, 2500);
    }

    private void dgLateBegin() {
        if (dgPbCb == null) return;
        dgLateOn = true; dgLateAt = System.currentTimeMillis();
        dgPrevLate.clear();
        main.removeCallbacks(dgLateEndTask);
        main.postDelayed(dgLateEndTask, DG_LATE_MS);
    }

    /** 다른 앱·시스템이 내는 소리의 「쓰임새」만 본다(안드로이드가 일반 앱에 알려 주는 범위 — 어느 앱인지·무슨 소리인지는 알 수 없다). */
    private void dgPbStart() {
        if (Build.VERSION.SDK_INT < 26) return;
        AudioManager a = am();
        if (a == null) return;
        try {
            dgPbLast = dgPbKey(a.getActivePlaybackConfigurations());
            if (dgPbCb == null) {
                AudioManager.AudioPlaybackCallback cb = new AudioManager.AudioPlaybackCallback() {
                    @Override public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) { dgPbSeen(configs); }
                };
                a.registerAudioPlaybackCallback(cb, main);
                dgPbCb = cb;
            }
        } catch (Throwable ignored) {}
    }

    private void dgPbStop() {
        main.removeCallbacks(dgLateEndTask);
        dgLateOn = false;
        Object cb = dgPbCb; dgPbCb = null;
        if (cb == null || Build.VERSION.SDK_INT < 26) return;
        try {
            AudioManager a = am();
            if (a != null) a.unregisterAudioPlaybackCallback((AudioManager.AudioPlaybackCallback) cb);
        } catch (Throwable ignored) {}
    }

    private void dgPbSeen(List<AudioPlaybackConfiguration> configs) {
        String key = dgPbKey(configs);
        if (key.equals(dgPbLast)) return;
        dgPbLast = key;
        ArrayList<String> to = dgLateOn ? dgPrevLate : dgPb;
        if (to.size() >= DG_PB_MAX) return;
        long base = dgLateOn ? dgLateAt : dgStartAt;
        to.add((System.currentTimeMillis() - base) + ":" + (key.length() == 0 ? "-" : key));
    }

    /** 지금 소리를 내는 재생기들: "u5c4f0s5" = 쓰임새 5(알림)·내용 4(효과음)·플래그 0·음량 통로 5(알림). 여럿이면 + 로 이음. */
    private static String dgPbKey(List<AudioPlaybackConfiguration> l) {
        if (l == null || l.isEmpty()) return "";
        ArrayList<String> k = new ArrayList<String>();
        for (AudioPlaybackConfiguration c : l) {
            try {
                AudioAttributes aa = c.getAudioAttributes();
                k.add("u" + aa.getUsage() + "c" + aa.getContentType() + "f" + aa.getFlags() + "s" + aa.getVolumeControlStream());
            } catch (Throwable t) { k.add("?"); }
        }
        Collections.sort(k);
        StringBuilder b = new StringBuilder();
        for (String x : k) { if (b.length() > 0) b.append('+'); b.append(x); }
        return b.length() > 120 ? b.substring(0, 120) : b.toString();
    }

    private static String dgJoin(ArrayList<String> l) {
        StringBuilder b = new StringBuilder();
        for (String x : l) { if (b.length() > 0) b.append(' '); b.append(x); }
        return b.toString();
    }

    /** 듣기 시작 직후: 적용한 값·줄이기 전후 음량·한 일의 결과·소리 길·앞 턴 되돌린 결과. */
    private JSObject dgStartObj(String before) {
        JSObject o = new JSObject();
        AudioManager a = am();
        o.put("k", "s");
        o.put("m", sfx);
        o.put("od", recOnDevice ? 1 : 0);
        o.put("odb", onDeviceBroken ? 1 : 0);
        o.put("st", dgStaticInfo());
        o.put("b", before == null ? "" : before);
        o.put("a", dgStreams(a, false));
        o.put("act", dgAct);
        try { if (a != null) o.put("rm", a.getRingerMode()); } catch (Throwable ignored) {}
        dgRoutes(a, o);
        o.put("pr", dgPrevRestore);
        o.put("pl", dgJoin(dgPrevLate));
        return o;
    }

    private void dgEmitReady() {
        try {
            JSObject o = new JSObject();
            AudioManager a = am();
            o.put("k", "r");
            o.put("rdy", dgReadyMs);
            o.put("v", dgStreams(a, false));
            o.put("rec", dgRec(a));
            try { if (a != null) { o.put("mode", a.getMode()); o.put("sco", a.isBluetoothScoOn() ? 1 : 0); } } catch (Throwable ignored) {}
            o.put("pb", dgJoin(dgPb));
            notifyListeners("diag", o);
        } catch (Throwable ignored) {}
    }

    /** 듣기 끝(되돌리기 전): 그때 음량·「작게」 2단계 결과·다시 들은 횟수·인식기 오류 코드·듣는 동안 난 소리. */
    private JSObject dgEndObj() {
        JSObject o = new JSObject();
        AudioManager a = am();
        o.put("k", "e");
        o.put("ms", (int) (System.currentTimeMillis() - dgStartAt));
        o.put("v", dgStreams(a, false));
        o.put("q", dgQuiet);
        o.put("rs", restarts);
        o.put("er", dgErr.toString());
        try { if (a != null) { o.put("rm", a.getRingerMode()); o.put("mode", a.getMode()); o.put("sco", a.isBluetoothScoOn() ? 1 : 0); } } catch (Throwable ignored) {}
        o.put("pb", dgJoin(dgPb));
        return o;
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
