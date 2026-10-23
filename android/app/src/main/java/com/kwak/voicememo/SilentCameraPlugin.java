package com.kwak.voicememo;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.kwak.silentcam.Session;
import com.kwak.silentcam.SilentCameraActivity;

import org.json.JSONObject;

import java.io.File;

/**
 * 소리 없는 카메라 플러그인 (v9.29, 2026-10-23, 지시대장 O-0607).
 *  - 무엇: 문서·영수증 스캔과 홈 「카메라」 칸이 쓰는 촬영 화면(android/silentcam 모듈의 SilentCameraActivity)을 열고,
 *    찍은 사진의 «경로 목록»만 돌려준다. 사진 자체는 앱 안 임시 폴더에 JPEG 로 있고, 웹이 한 장씩 읽어 간다.
 *  - 권한: CAMERA 하나뿐(알림 접근·접근성·문자 권한 없음). 허락 창은 JS 가 케이 말투 안내를 보여 준 뒤에 requestPermission() 으로 연다.
 *  - 복구: 찍을 때마다 복구 목록(session.json)에 적는다. 앱이 정리됐다 돌아오면 pending() 으로 찾고, 담기가 끝난 쪽은 release(path) 로 한 쪽씩 지운다.
 *  - JS: Capacitor.Plugins.SilentCamera
 *      status()            → {available, perm:'granted'|'prompt'|'denied', freeBytes, sdk}
 *      requestPermission() → {granted}
 *      open({mode,from,multi,left,title,engine,resume,zoom:'on'|'off'}) → {action:'done'|'send'|'cancel'|'denied'|'error', mode, pages:[{path,q,w,h,size,shake,zoom}]}
 *      pending()           → {has, cameraOpen, mode, from, multi, updated, pages:[...]}
 *      release({path}) / discardAll() / sweep() / openAppSettings()
 */
@CapacitorPlugin(
        name = "SilentCamera",
        permissions = {
                @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
        }
)
public class SilentCameraPlugin extends Plugin {

    private boolean hasCameraFeature() {
        try { return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY); }
        catch (Exception e) { return false; }
    }

    private String permString() {
        PermissionState st = getPermissionState("camera");
        if (st == PermissionState.GRANTED) return "granted";
        if (st == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    @PluginMethod
    public void status(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", hasCameraFeature());
        ret.put("perm", permString());
        ret.put("freeBytes", Session.INSTANCE.freeBytes(getContext()));
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(final PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return;
        }
        requestPermissionForAlias("camera", call, "afterCameraPerm");
    }

    @PermissionCallback
    private void afterCameraPerm(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("camera") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void open(final PluginCall call) {
        if (SilentCameraActivity.Companion.isOpen()) {
            JSObject r = new JSObject(); r.put("action", "error"); r.put("reason", "already_open"); call.resolve(r); return;
        }
        try {
            Intent it = new Intent(getContext(), SilentCameraActivity.class);
            it.putExtra(SilentCameraActivity.X_MODE, call.getString("mode", "doc"));
            it.putExtra(SilentCameraActivity.X_FROM, call.getString("from", "tab"));
            it.putExtra(SilentCameraActivity.X_MULTI, call.getBoolean("multi", false));
            it.putExtra(SilentCameraActivity.X_LEFT, call.getInt("left", 100));
            String title = call.getString("title");
            if (title != null) it.putExtra(SilentCameraActivity.X_TITLE, title);
            it.putExtra(SilentCameraActivity.X_ENGINE, call.getString("engine", "auto"));
            it.putExtra(SilentCameraActivity.X_RESUME, call.getBoolean("resume", false));
            it.putExtra(SilentCameraActivity.X_ZOOM, call.getString("zoom", "on"));
            startActivityForResult(call, it, "onCameraResult");
        } catch (Exception e) {
            JSObject r = new JSObject(); r.put("action", "error"); r.put("reason", "open_failed"); call.resolve(r);
        }
    }

    @ActivityCallback
    private void onCameraResult(final PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        try {
            if (result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                String js = result.getData().getStringExtra(SilentCameraActivity.RESULT);
                if (js != null) { call.resolve(new JSObject(js)); return; }
            }
        } catch (Exception e) { /* 아래에서 취소로 돌려준다 */ }
        ret.put("action", "cancel");
        call.resolve(ret);
    }

    private JSArray pagesToJs(java.util.List<Session.Page> pages) throws Exception {
        JSArray arr = new JSArray();
        for (Session.Page p : pages) {
            JSObject o = new JSObject();
            o.put("path", p.getPath()); o.put("q", p.getQ()); o.put("w", p.getW()); o.put("h", p.getH()); o.put("size", p.getSize());
            arr.put(o);
        }
        return arr;
    }

    @PluginMethod
    public void pending(final PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Session.State st = Session.INSTANCE.read(getContext());
            boolean open = SilentCameraActivity.Companion.isOpen();
            ret.put("cameraOpen", open);
            if (st != null && !st.getPages().isEmpty()) {
                ret.put("has", true);
                ret.put("mode", st.getMode()); ret.put("from", st.getFrom()); ret.put("multi", st.getMulti()); ret.put("updated", st.getUpdated());
                ret.put("pages", pagesToJs(st.getPages()));
            } else {
                ret.put("has", false);
            }
        } catch (Exception e) { ret.put("has", false); }
        call.resolve(ret);
    }

    @PluginMethod
    public void release(final PluginCall call) {
        String path = call.getString("path");
        if (path != null) Session.INSTANCE.release(getContext(), path);
        call.resolve();
    }

    @PluginMethod
    public void discardAll(final PluginCall call) {
        if (!SilentCameraActivity.Companion.isOpen()) Session.INSTANCE.discardAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void sweep(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("removed", Session.INSTANCE.sweep(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(final PluginCall call) {
        try {
            Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(it);
        } catch (Exception e) { /* 못 열어도 안내 글은 그대로 */ }
        call.resolve();
    }
}
