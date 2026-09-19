package com.kwak.voicememo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 네이티브 녹음 플러그인 등록(포그라운드 서비스 기반 백그라운드 녹음)
        registerPlugin(NativeRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
