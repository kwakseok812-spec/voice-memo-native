package com.kwak.voicememo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadataRetriever;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import java.io.File;

/**
 * 녹음을 "소유"하는 포그라운드 서비스(type=microphone).
 *  - MediaRecorder 가 이 서비스 안에서 동작하므로 화면이 꺼지거나 다른 앱을 써도
 *    안드로이드가 마이크 접근을 유지한다(백그라운드 마이크 제약 회피).
 *  - WebView/JS 나 액티비티 가시성과 무관하게 파일로 계속 녹음한다.
 *
 * v9.8(O-0442) — 녹음 방식(마이크·형식·파일 하나·정지 때 마무리)은 그대로 두고 둘레만 덧붙였다.
 *  - 종류(kind): 회의(meeting)·음성 대화 한 마디(chat)·아이디어(idea)가 이 서비스 하나를 같이 쓴다.
 *    지금 도는 녹음이 어느 것인지 기억해, 다른 종류가 끼어들어 가져가지 못하게 한다(플러그인이 거절).
 *  - 녹음기 오류 감시: 녹음기가 오류를 알리면 failed 로 표시하고 알림 글을 바꾸고 한 번 진동한다.
 *    녹음기는 건드리지 않는다(스스로 끊지 않는다) — 실제로는 계속 적히고 있을 수도 있으므로, 확인하고 정지하는 것은 사람이 한다.
 *    예전에는 오류가 나도 아무 표시 없이 「녹음 중」으로 남았다.
 *  - 시스템이 서비스를 되살릴 때(프로세스가 죽은 뒤) 녹음을 새 파일로 몰래 다시 시작하지 않는다.
 *    되살아난 녹음은 앞부분이 없는 다른 녹음인데, 화면이 그것을 「계속되던 녹음」으로 잘못 알 수 있다.
 *  - 회의 녹음 알림: 지난 시간을 보여 주고, 누르면 녹음 화면으로 간다(k_rec).
 */
public class RecordingService extends Service {

    public static final String ACTION_START = "com.kwak.voicememo.START";
    public static final String EXTRA_KIND = "kind";
    public static final String KIND_MEETING = "meeting";
    private static final String CHANNEL_ID = "voice_memo_recording";
    private static final int NOTIF_ID = 4321;

    public static RecordingService instance;   // 같은 프로세스의 플러그인이 접근

    private MediaRecorder recorder;
    private String outputPath;
    private long startedAtMs;
    // volatile: 녹음 시작 확인(플러그인 doStart)이 별도 스레드에서 isRecording() 을 읽으므로
    //   메인 스레드의 갱신이 즉시 보이도록 한다(시작 성공/실패를 놓치지 않게).
    private volatile boolean recording = false;
    private volatile String kind = "";         // 지금(또는 방금 멈춘) 녹음의 종류
    private volatile boolean failed = false;   // 녹음기가 오류를 알렸다(정지를 누르기 전까지 유지)
    private volatile int failWhat = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 시스템이 되살린 경우(intent 없음)나 모르는 요청에는 녹음을 시작하지 않는다.
        if (intent == null || !ACTION_START.equals(intent.getAction())) {
            if (!recording) stopSelf();
            return START_NOT_STICKY;
        }
        if (!recording) {
            String k = intent.getStringExtra(EXTRA_KIND);
            kind = (k == null) ? "" : k;
            failed = false; failWhat = 0;
        }
        createChannel();
        Notification n = buildNotification();
        // Android 14+(34): 반드시 서비스 타입 microphone 으로 startForeground
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean was = recording;
        startRecordingInternal();
        if (!was && recording) refreshNotification();   // 시작 시각이 정해진 뒤 지난 시간이 보이게 한 번 더 그린다
        return START_NOT_STICKY;
    }

    private void startRecordingInternal() {
        if (recording) return;
        try {
            File out = new File(getFilesDir(), "memo_" + System.currentTimeMillis() + ".m4a");
            outputPath = out.getAbsolutePath();
            recorder = (Build.VERSION.SDK_INT >= 31) ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(128000);
            recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(outputPath);
            // v9.8: 녹음기가 오류를 알리는 경우를 알아챈다(설정·형식은 위 그대로, 녹음기 동작은 바꾸지 않는다).
            recorder.setOnErrorListener(new MediaRecorder.OnErrorListener() {
                @Override
                public void onError(MediaRecorder mr, int what, int extra) { onRecorderTrouble(what); }
            });
            recorder.prepare();
            recorder.start();
            startedAtMs = System.currentTimeMillis();
            recording = true;
        } catch (Exception e) {
            outputPath = null;
            recording = false;
        }
    }

    /** 녹음기가 오류를 알렸다. 표시만 바꾼다 — 녹음기·파일은 그대로 두고, 정지(마무리)는 사람이 누를 때 한다. */
    private void onRecorderTrouble(int what) {
        if (!recording || failed) return;
        failed = true;
        failWhat = what;
        refreshNotification();
        vibrateOnce();
    }

    /** 플러그인이 호출: 녹음 정지 + 파일 경로 반환 + 서비스 종료. */
    public String stopAndFinalize() {
        try {
            if (recorder != null) {
                recorder.stop();
                recorder.release();
            }
        } catch (Exception e) {
            // stop 직후 파일이 손상될 수 있으나 outputPath 는 반환
        }
        recorder = null;
        recording = false;
        failed = false;
        String path = outputPath;
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception e) {}
        stopSelf();
        return path;
    }

    /** 녹음된 파일의 실제 길이(밀리초) — "몇 초가 담겼나" 진단용. */
    public long getRecordedDurationMs(String path) {
        try {
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            r.setDataSource(path);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            r.release();
            return d != null ? Long.parseLong(d) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public boolean isRecording() { return recording; }
    public boolean isFailed() { return failed; }
    public int getFailWhat() { return failWhat; }
    public String getKind() { return kind == null ? "" : kind; }
    public long getStartedAtMs() { return startedAtMs; }
    public long getElapsedMs() { return startedAtMs > 0 ? System.currentTimeMillis() - startedAtMs : 0; }
    /** 지금까지 파일에 적힌 크기(바이트) — 진단용. */
    public long getBytes() {
        try { return outputPath != null ? new File(outputPath).length() : 0; } catch (Exception e) { return 0; }
    }

    /**
     * 현재 녹음 중인 MediaRecorder 의 "직전 호출 이후 최대 진폭"(0~32767).
     * 무음 자동 감지(핸즈프리 음성 대화)에 쓴다. 이미 녹음 중인 같은 recorder 에서 읽으므로
     * 두 번째 마이크 접근(경합) 없이 안전하다. 녹음 중이 아니면 0.
     */
    public int getMaxAmplitude() {
        try {
            if (recorder != null && recording) return recorder.getMaxAmplitude();
        } catch (Exception e) {}
        return 0;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "음성 메모 녹음", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("녹음 중일 때 표시됩니다");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void refreshNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification());
        } catch (Exception ignored) {}
    }

    private Notification buildNotification() {
        boolean meeting = KIND_MEETING.equals(kind);
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (meeting) {
            // 회의 녹음 알림을 누르면 녹음 화면으로(MainActivity 가 k_rec 를 웹에 넘긴다). 케이 답장 알림의 k_open 길과는 따로다.
            open.setAction("com.kwak.voicememo.action.OPEN_REC");
            open.putExtra("k_rec", "1");
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, meeting ? NOTIF_ID : 0, open, flags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pi);
        if (failed) {
            b.setContentTitle("녹음에 문제가 생긴 것 같습니다")
             .setContentText("눌러서 앱을 열고 확인해 주십시오.");
        } else if (meeting) {
            b.setContentTitle("케이가 녹음하고 있습니다")
             .setContentText("앱 화면을 닫아도 녹음은 계속됩니다. 누르면 녹음 화면으로 갑니다.");
            if (recording && startedAtMs > 0) {
                b.setWhen(startedAtMs).setShowWhen(true).setUsesChronometer(true);   // 지난 시간
            }
        } else {
            b.setContentTitle("케이가 녹음하고 있습니다")
             .setContentText("화면을 꺼도 녹음이 계속됩니다. 앱에서 정지를 누르세요.");
        }
        return b.build();
    }

    private void vibrateOnce() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            long[] pattern = new long[]{ 0, 300, 150, 300 };
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            else v.vibrate(pattern, -1);
        } catch (Exception ignored) {}
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 최근 앱에서 화면을 밀어 닫아도 녹음은 멈추지 않는다 — 여기서 아무것도 끄지 않는다.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        try { if (recorder != null) { recorder.release(); } } catch (Exception e) {}
        recorder = null;
        recording = false;
        instance = null;
        super.onDestroy();
    }
}
