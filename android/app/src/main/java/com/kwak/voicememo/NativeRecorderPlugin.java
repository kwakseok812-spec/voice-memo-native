package com.kwak.voicememo;

import android.Manifest;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 네이티브 백그라운드 녹음 플러그인.
 *  - 녹음은 RecordingService(포그라운드 서비스, type=microphone) 안의 MediaRecorder 가 한다.
 *  - JS(WebView)는 시작/정지만 호출하고, 정지 시 네이티브가 만든 오디오 파일 경로를 돌려받는다.
 *  - WebView 가 화면 꺼짐으로 얼어붙어도, 녹음은 서비스에서 계속된다.
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
            call.reject("마이크 권한이 필요해요. 설정에서 허용해 주세요.");
        }
    }

    private void doStart(final PluginCall call) {
        try {
            Intent i = new Intent(getContext(), RecordingService.class);
            i.setAction(RecordingService.ACTION_START);
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
                    call.reject("녹음을 시작하지 못했어요. 마이크가 다른 앱에서 쓰이고 있는지 확인하고 다시 시작해 주세요.");
                }
            }
        }).start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JSObject ret = new JSObject();
        RecordingService svc = RecordingService.instance;
        if (svc != null) {
            String path = svc.stopAndFinalize();
            long durationMs = (path != null) ? svc.getRecordedDurationMs(path) : 0;
            ret.put("uri", path != null ? ("file://" + path) : null);
            ret.put("durationMs", durationMs);
        } else {
            ret.put("uri", (String) null);
            ret.put("durationMs", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void isRecording(PluginCall call) {
        JSObject o = new JSObject();
        RecordingService svc = RecordingService.instance;
        o.put("value", svc != null && svc.isRecording());
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
