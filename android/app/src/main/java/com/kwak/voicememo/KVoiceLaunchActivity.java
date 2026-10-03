package com.kwak.voicememo;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * v8.3(O-0161) 앱 서랍의 두 번째 아이콘 「케이 음성」.
 *
 * 갤럭시 「설정 → 유용한 기능 → 측면 버튼 → 두 번 누르기 → 앱 열기」는 앱 목록(런처 아이콘)만 고를 수 있다.
 * 그래서 화면 없는 이 작은 입구를 런처 아이콘으로 내보이고, 눌리면 곧바로 MainActivity 를
 * v8.2 아이콘 길게 누르기 바로가기 「음성 대화」와 똑같은 인텐트(k_shortcut=voice)로 연 뒤 스스로 닫힌다.
 *
 * 왜 activity-alias 가 아니라 별도 입구인가:
 *   별칭으로 앱을 처음 연 뒤 다시 측면 버튼을 누르면, 안드로이드는 이미 있는 화면을 앞으로만 가져오고
 *   새 인텐트를 주지 않아 음성 대화가 다시 시작되지 않는다. 이 입구는 자기 작업(taskAffinity="")이라
 *   누를 때마다 새로 떠서 매번 MainActivity 로 「음성 대화」 신호를 보낸다.
 * 화면·권한·저장 없음. 웹 쪽 처리는 app.js runShortcut('voice') 그대로(채팅 열고 음성 대화 시작).
 */
public class KVoiceLaunchActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent i = new Intent(this, MainActivity.class);
            i.setAction("com.kwak.voicememo.action.SHORTCUT");
            i.putExtra("k_shortcut", "voice");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ignored) {
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
