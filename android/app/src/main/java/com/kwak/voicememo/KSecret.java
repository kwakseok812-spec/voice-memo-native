package com.kwak.voicememo;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * v8.2(O-0158) 연동 암호를 폰 안전 저장소에 보관한다(알림 [답장]이 연동 암호 확인 RPC 로 보내기 때문).
 *  · 암호화 키는 Android Keystore(하드웨어 보호, 앱 밖으로 꺼낼 수 없음)에서 만든 AES-256-GCM 키.
 *  · 저장되는 것은 암호문(iv:ciphertext, base64)뿐 — 평문은 디스크·로그 어디에도 남기지 않는다.
 *  · 앱을 지우면 키와 함께 사라진다. 백업으로 다른 폰에 옮겨져도 키가 없어 풀 수 없다(그때는 앱을 한 번 열면 다시 채워짐).
 *  · 별도 라이브러리(security-crypto) 없이 플랫폼 API 만 쓴다(minSdk 24 OK).
 */
final class KSecret {

    private static final String ALIAS = "k_sync_pass_v1";
    private static final String PREF_KEY = "pass_enc";

    private KSecret() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    /** 빈 값이면 지운다. 실패해도 예외를 밖으로 던지지 않는다. */
    static synchronized void putPass(Context c, String pass) {
        SharedPreferences sp = KBridgePlugin.prefs(c);
        if (pass == null || pass.length() == 0) { sp.edit().remove(PREF_KEY).apply(); return; }
        try {
            Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
            ci.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = ci.doFinal(pass.getBytes(StandardCharsets.UTF_8));
            String v = Base64.encodeToString(ci.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            sp.edit().putString(PREF_KEY, v).apply();
        } catch (Exception e) {
            sp.edit().remove(PREF_KEY).apply();   // 저장 실패 → 남은 옛 값도 지움(틀린 암호로 보내지 않게)
        }
    }

    /** 없거나 풀 수 없으면 "". */
    static synchronized String getPass(Context c) {
        String v = KBridgePlugin.prefs(c).getString(PREF_KEY, null);
        if (v == null) return "";
        try {
            int i = v.indexOf(':');
            if (i <= 0) return "";
            byte[] iv = Base64.decode(v.substring(0, i), Base64.NO_WRAP);
            byte[] ct = Base64.decode(v.substring(i + 1), Base64.NO_WRAP);
            Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
            ci.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(ci.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}
