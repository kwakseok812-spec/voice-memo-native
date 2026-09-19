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

    private void doStart(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), RecordingService.class);
            i.setAction(RecordingService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("녹음 시작 실패: " + e.getMessage());
        }
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
}
