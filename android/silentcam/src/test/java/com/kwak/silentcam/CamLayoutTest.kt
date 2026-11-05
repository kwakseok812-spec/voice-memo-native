package com.kwak.silentcam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 카메라 화면 모양 규칙 시험(v9.74, 설계안 v2). 폰·카메라 없이 계산만 확인한다.
 *  ① 저장된 값이 이상하면 «크게 보기»로 ② 길쭉한 비율은 «크게 보기»+영수증·일반 사진+긴 화면일 때만 ③ 문서는 언제나 지금 비율
 *  ④ 보이는 범위 ≠ 찍히는 범위면 지금 비율로 후퇴 ⑤ 미리보기 칸·안내선 계산 ⑥ 단추 묶음 높이(시안과 같은 값)
 */
class CamLayoutTest {
    private val long = CamLayout.LONG_ASPECT
    private val base = CamLayout.BASE_ASPECT

    @Test fun normalize_unknownFallsBackToBig() {
        assertEquals(CamLayout.BIG, CamLayout.normalize(null))
        assertEquals(CamLayout.BIG, CamLayout.normalize("엉뚱한값"))
        assertEquals(CamLayout.BIG, CamLayout.normalize("big"))
        assertEquals(CamLayout.SMALL, CamLayout.normalize("small"))
        assertEquals(CamLayout.CLASSIC, CamLayout.normalize("classic"))
    }

    @Test fun aspect_longOnlyForBigNonDocOnTallScreens() {
        assertEquals(long, CamLayout.aspect(CamLayout.BIG, "receipt", 844f, 390f), 0.0001f)     // 폰
        assertEquals(long, CamLayout.aspect(CamLayout.BIG, "photo", 910f, 390f), 0.0001f)       // 접은 폴드
        assertEquals(base, CamLayout.aspect(CamLayout.BIG, "doc", 844f, 390f), 0.0001f)         // 문서는 그대로
        assertEquals(base, CamLayout.aspect(CamLayout.BIG, "doc", 910f, 390f), 0.0001f)
        assertEquals(base, CamLayout.aspect(CamLayout.BIG, "receipt", 832f, 750f), 0.0001f)     // 펼친 폴드(네모에 가까움)
        assertEquals(base, CamLayout.aspect(CamLayout.BIG, "receipt", 680f, 400f), 0.0001f)     // 1.7 < 1.8
        assertEquals(long, CamLayout.aspect(CamLayout.BIG, "receipt", 760f, 400f), 0.0001f)     // 1.9 ≥ 1.8
        assertEquals(base, CamLayout.aspect(CamLayout.SMALL, "receipt", 844f, 390f), 0.0001f)   // 단추만 작게
        assertEquals(base, CamLayout.aspect(CamLayout.CLASSIC, "photo", 844f, 390f), 0.0001f)   // 예전 화면
        assertEquals(base, CamLayout.aspect(CamLayout.BIG, "receipt", 844f, 0f), 0.0001f)       // 화면 크기를 모르면 그대로
    }

    @Test fun agrees_unknownCountsAsAgree() {
        assertTrue(CamLayout.agrees(long, null))
        assertTrue(CamLayout.agrees(long, 0.5625f))
        assertTrue(CamLayout.agrees(long, 0.56f))
        assertFalse(CamLayout.agrees(long, 0.75f))
    }

    @Test fun shortOverLong_basic() {
        assertEquals(0.5625f, CamLayout.shortOverLong(2160, 3840)!!, 0.0001f)
        assertEquals(0.5625f, CamLayout.shortOverLong(3840, 2160)!!, 0.0001f)
        assertEquals(0.75f, CamLayout.shortOverLong(3000, 4000)!!, 0.0001f)
        assertNull(CamLayout.shortOverLong(0, 10))
    }

    @Test fun retreat_whenPreviewOrCaptureDisagree() {
        assertFalse(CamLayout.mustRetreat(long, 0.5625f, 0.5625f))   // 둘 다 같음 → 그대로
        assertTrue(CamLayout.mustRetreat(long, 0.75f, 0.5625f))      // 미리보기만 다름
        assertTrue(CamLayout.mustRetreat(long, 0.5625f, 0.75f))      // 사진만 다름
        assertTrue(CamLayout.mustRetreat(long, null, 0.75f))
        assertFalse(CamLayout.mustRetreat(long, null, null))         // 아직 모름 → 후퇴하지 않음
        assertFalse(CamLayout.mustRetreat(base, 0.5625f, 0.5625f))   // 지금 비율을 원했다면 물러날 곳이 없음
    }

    @Test fun fit_centersPreview() {
        val a = CamLayout.fit(390f, 844f, long)
        assertEquals(390f, a.w, 0.5f); assertEquals(693.3f, a.h, 0.5f); assertEquals(75.3f, a.y, 0.5f); assertEquals(0f, a.x, 0.5f)
        val b = CamLayout.fit(390f, 844f, base)
        assertEquals(520f, b.h, 0.5f); assertEquals(162f, b.y, 0.5f)
        val c = CamLayout.fit(750f, 832f, base)                       // 펼친 폴드: 높이에 맞춰짐
        assertEquals(624f, c.w, 0.5f); assertEquals(832f, c.h, 0.5f); assertEquals(63f, c.x, 0.5f)
        val d = CamLayout.fit(844f, 390f, base)                       // 가로로 돌린 폰: 비율을 뒤집어 놓음
        assertEquals(520f, d.w, 0.5f); assertEquals(390f, d.h, 0.5f)
    }

    @Test fun guide_staysInsidePreviewAndAvoidsButtons() {
        // 폰 390×844, 영수증(길쭉): 위 단추 줄 끝 88, 아래 단추 줄(확대 포함) 시작 690
        val pv = CamLayout.fit(390f, 844f, long)
        val g = CamLayout.guide(pv, 88f, 690f, 8f)
        assertNotNull(g)
        assertEquals(103.1f, g!!.y, 0.5f); assertEquals(682f, g.y + g.h, 0.5f)
        assertEquals(23.4f, g.x, 0.5f); assertEquals(343.2f, g.w, 0.5f)
        // 문서(지금 비율), 이어 찍기 전: 위 122, 아래 690 → 안내선 높이 약 478
        val pd = CamLayout.fit(390f, 844f, base)
        val gd = CamLayout.guide(pd, 122f, 690f, 8f)
        assertNotNull(gd)
        assertEquals(478.4f, gd!!.h, 0.5f)
        // 화면이 너무 낮으면 null(예전 규칙으로)
        assertNull(CamLayout.guide(CamLayout.Box(0f, 0f, 100f, 100f), 0f, 20f, 8f))
    }

    @Test fun barHeights_matchMockup() {
        assertEquals(82, CamLayout.topDp(tab = true, doc = true, notice = false))     // 윗줄 48 + 이어 찍기 줄 34
        assertEquals(48, CamLayout.topDp(tab = true, doc = false, notice = false))
        assertEquals(78, CamLayout.topDp(tab = true, doc = false, notice = true))     // 일반 사진: 알림 띠 30
        assertEquals(48, CamLayout.topDp(tab = false, doc = true, notice = false))    // 스캔 화면에서 열림
        assertEquals(82, CamLayout.bottomDp(false))
        assertEquals(154, CamLayout.bottomDp(true))                                    // 썸네일 줄 72(그대로)
        assertTrue(CamLayout.TOUCH_DP >= 48)
        assertTrue(CamLayout.ZOOM_ROW_DP >= 48 && CamLayout.BAR_DP >= 48)
        assertTrue(CamLayout.HINT_FADE_MS >= 5000L)
    }
}
