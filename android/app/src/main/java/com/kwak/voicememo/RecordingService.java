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

import androidx.core.app.NotificationCompat;

import java.io.File;

/**
 * 녹음을 "소유"하는 포그라운드 서비스(type=microphone).
 *  - MediaRecorder 가 이 서비스 안에서 동작하므로 화면이 꺼지거나 다른 앱을 써도
 *    안드로이드가 마이크 접근을 유지한다(백그라운드 마이크 제약 회피).
 *  - WebView/JS 나 액티비티 가시성과 무관하게 파일로 계속 녹음한다.
 */
public class RecordingService extends Service {

    public static final String ACTION_START = "com.kwak.voicememo.START";
    private static final String CHANNEL_ID = "voice_memo_recording";
    private static final int NOTIF_ID = 4321;

    public static RecordingService instance;   // 같은 프로세스의 플러그인이 접근

    private MediaRecorder recorder;
    private String outputPath;
    private long startedAtMs;
    private boolean recording = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
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
        startRecordingInternal();
        return START_STICKY;
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
            recorder.prepare();
            recorder.start();
            startedAtMs = System.currentTimeMillis();
            recording = true;
        } catch (Exception e) {
            outputPath = null;
            recording = false;
        }
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
    public long getElapsedMs() { return startedAtMs > 0 ? System.currentTimeMillis() - startedAtMs : 0; }

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

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("음성 메모 녹음 중")
                .setContentText("화면을 꺼도 녹음이 계속돼요. 앱에서 정지를 누르세요.")
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pi)
                .build();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        try { if (recorder != null) { recorder.release(); } } catch (Exception e) {}
        recorder = null;
        recording = false;
        instance = null;
        super.onDestroy();
    }
}
