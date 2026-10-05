package io.github.kwakseok812.glassmap.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TransformTest {

    private fun rgb(r: Int, g: Int, b: Int): Int = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    private fun at(g: ByteArray, w: Int, x: Int, y: Int): Int = g[y * w + x].toInt() and 255

    /** A whole phone screen with a marker in each corner and one in the middle, on a light page. */
    private fun screenWithCorners(sw: Int, sh: Int): IntArray {
        val px = IntArray(sw * sh) { rgb(250, 250, 250) }
        fun block(x0: Int, y0: Int) {
            for (y in y0 until y0 + 60) for (x in x0 until x0 + 60) px[y * sw + x] = rgb(10, 10, 10)
        }
        block(0, 0)
        block(sw - 60, 0)
        block(0, sh - 60)
        block(sw - 60, sh - 60)
        block(sw / 2 - 30, sh / 2 - 30)
        return px
    }

    private fun bright(g: ByteArray, x: Int, y: Int): Boolean = (g[y * Layout.W + x].toInt() and 255) > 150

    @Test
    fun showAll_wholeScreen_nothingIsCut_andBorderStaysBlack() {
        val sw = 1248
        val sh = 1972
        val b = FrameBuilder.buildFromScreen(
            screenWithCorners(sw, sh), sw, sh, Scaler.wholeScreen(sw, sh),
            Transform.MODE_DARK, ViewConfig(), FrameBuilder.FIT_CONTAIN
        )
        assertEquals(Layout.W * Layout.H, b.gray.size)
        // 1248 x 1972 keeps its shape: 405 x 640, centred
        assertEquals(405, b.drawnW)
        assertEquals(640, b.drawnH)
        assertEquals((Layout.W - 405) / 2, b.drawnX)
        assertEquals(0, b.drawnY)
        val x0 = b.drawnX
        val x1 = b.drawnX + b.drawnW - 1
        // all four corner markers and the middle one are there (dark view: dark marker -> bright)
        assertTrue(bright(b.gray, x0 + 8, 8), "top-left corner of the phone screen is missing")
        assertTrue(bright(b.gray, x1 - 8, 8), "top-right corner is missing")
        assertTrue(bright(b.gray, x0 + 8, Layout.H - 9), "bottom-left corner is missing")
        assertTrue(bright(b.gray, x1 - 8, Layout.H - 9), "bottom-right corner is missing")
        assertTrue(bright(b.gray, Layout.W / 2, Layout.H / 2), "middle marker is missing")
        // the light page itself became dark, and the unused border is pure black (see-through)
        assertTrue((b.gray[300 * Layout.W + Layout.W / 2].toInt() and 255) < 40)
        for (y in 0 until Layout.H) {
            for (x in 0 until x0) assertEquals(0, b.gray[y * Layout.W + x].toInt(), "left border must be black")
            for (x in x1 + 1 until Layout.W) assertEquals(0, b.gray[y * Layout.W + x].toInt(), "right border must be black")
        }
        // the same in the as-on-the-phone view: the page is bright, the border still black
        val p = FrameBuilder.buildFromScreen(
            screenWithCorners(sw, sh), sw, sh, Scaler.wholeScreen(sw, sh),
            Transform.MODE_PLAIN, ViewConfig(), FrameBuilder.FIT_CONTAIN
        )
        assertTrue(bright(p.gray, Layout.W / 2, 300))
        assertEquals(0, p.gray[300 * Layout.W + 5].toInt())
    }

    @Test
    fun fill_trimsEqually_neverStretches_andARegionKeepsItsShape() {
        val sw = 1248
        val sh = 1972
        val screen = screenWithCorners(sw, sh)
        // "fill" with the whole screen: top and bottom are trimmed equally, the middle stays in the middle
        val f = FrameBuilder.buildFromScreen(screen, sw, sh, Scaler.wholeScreen(sw, sh), Transform.MODE_DARK, ViewConfig(), FrameBuilder.FIT_COVER)
        assertEquals(Layout.W, f.drawnW)
        assertEquals(Layout.H, f.drawnH)
        assertTrue(bright(f.gray, Layout.W / 2, Layout.H / 2), "middle marker must stay centred")
        assertFalse(bright(f.gray, 8, 8), "with fill the corners of a taller screen are outside")
        val c = FrameBuilder.coverCrop(sw, sh, Layout.W, Layout.H)
        assertEquals(0, c[0])
        assertEquals(sw, c[2])
        assertEquals((sh - c[3]) / 2, c[1])
        assertTrue(kotlin.math.abs(c[2] * Layout.H - c[3] * Layout.W) <= Layout.H, "trimmed part has the lens shape")
        // an area that already has the lens shape is used as it is
        assertEquals(listOf(0, 0, 480, 640), FrameBuilder.coverCrop(480, 640, Layout.W, Layout.H).toList())

        // a wide region with "show all": full width, black above and below
        val wide = intArrayOf(0, 900, 1248, 400)
        val w = FrameBuilder.buildFromScreen(screen, sw, sh, wide, Transform.MODE_PLAIN, ViewConfig(), FrameBuilder.FIT_CONTAIN)
        assertEquals(480, w.drawnW)
        assertEquals(154, w.drawnH)
        assertEquals((Layout.H - 154) / 2, w.drawnY)
        assertEquals(0, w.gray[5 * Layout.W + 240].toInt(), "above the region: black")
        // a region reaching outside the screen is pulled back in instead of failing
        val odd = FrameBuilder.buildFromScreen(screen, sw, sh, intArrayOf(1000, 1800, 900, 900), Transform.MODE_PLAIN, ViewConfig(), FrameBuilder.FIT_COVER)
        assertEquals(Layout.W * Layout.H, odd.gray.size)

        // sizes: wide, tall, tiny, extreme
        assertEquals(listOf(480, 270), FrameBuilder.containSize(1920, 1080, 480, 640).toList())
        assertEquals(listOf(274, 640), FrameBuilder.containSize(1080, 2520, 480, 640).toList())
        assertEquals(listOf(480, 640), FrameBuilder.containSize(3, 4, 480, 640).toList())
        assertEquals(listOf(480, 1), FrameBuilder.containSize(5000, 2, 480, 640).toList())
    }

    @Test
    fun twoViews_darkInvertsLightScreensOnly_plainKeepsBrightness_keysGoBackAndForth() {
        val w = 200
        val h = 200
        val page = IntArray(w * h) { rgb(255, 255, 255) }
        for (y in 80 until 100) for (x in 40 until 160) page[y * w + x] = rgb(20, 20, 20)       // dark letters
        val dark = Transform.render(page, w, h, Transform.MODE_DARK, ViewConfig())
        assertTrue(dark.light)
        assertTrue(at(dark.gray, w, 100, 90) > 200, "letters bright")
        assertEquals(0, at(dark.gray, w, 10, 10), "white page black")
        val plain = Transform.render(page, w, h, Transform.MODE_PLAIN, ViewConfig())
        assertTrue(at(plain.gray, w, 10, 10) > 200, "as on the phone: a white page stays white")
        assertTrue(at(plain.gray, w, 100, 90) < 60, "as on the phone: dark letters stay dark")
        // a screen that is dark already is not inverted by the dark view
        val night = IntArray(w * h) { rgb(18, 18, 18) }
        for (y in 80 until 100) for (x in 40 until 160) night[y * w + x] = rgb(240, 240, 240)
        val t2 = Transform.render(night, w, h, Transform.MODE_DARK, ViewConfig())
        assertFalse(t2.light)
        assertTrue(at(t2.gray, w, 100, 90) > 200)
        assertEquals(0, at(t2.gray, w, 10, 10))

        // exactly two views; the default is "as on the phone"; a key goes back and forth
        assertEquals(listOf(Transform.MODE_PLAIN, Transform.MODE_DARK), Transform.VIEWS.toList())
        assertEquals(Transform.MODE_DARK, Transform.nextView(Transform.MODE_PLAIN))
        assertEquals(Transform.MODE_PLAIN, Transform.nextView(Transform.MODE_DARK))
        // values kept by earlier versions (2 = map view, 3 = roads only) end up on a valid view
        assertEquals(Transform.MODE_PLAIN, Transform.normalize(3))
        assertEquals(Transform.MODE_PLAIN, Transform.normalize(2))
        assertEquals(Transform.MODE_PLAIN, Transform.normalize(0))
        assertEquals(Transform.MODE_DARK, Transform.normalize(4))
    }

    @Test
    fun plainView_keepsOrder_pullsNearShadesApart_andDims() {
        // a light map: ground 248, roofs 218, roads 255, a blue line, dark text
        val w = 480
        val h = 480
        val px = IntArray(w * h) { rgb(248, 248, 248) }
        for (y in 0 until 150) for (x in 0 until w) px[y * w + x] = rgb(218, 218, 218)
        for (y in 300 until 420) for (x in 0 until w) px[y * w + x] = rgb(255, 255, 255)
        for (y in 200 until 210) for (x in 40 until 440) px[y * w + x] = rgb(7, 108, 242)
        for (y in 20 until 40) for (x in 40 until 200) px[y * w + x] = rgb(30, 30, 30)
        val cfg = ViewConfig()
        val r = Transform.render(px, w, h, Transform.MODE_PLAIN, cfg)
        val roof = at(r.gray, w, 300, 100)
        val ground = at(r.gray, w, 300, 250)
        val road = at(r.gray, w, 300, 350)
        val line = at(r.gray, w, 240, 205)
        val text = at(r.gray, w, 100, 30)
        assertTrue(text < line && line < roof && roof < ground && ground < road, "order as on the phone: $text $line $roof $ground $road")
        assertTrue(road - ground >= 30, "ground (248) and road (255) must be clearly apart, got $ground vs $road")
        assertEquals(255, road)
        assertTrue(ground > 150, "not inverted: a light picture stays light")
        // brightness buttons
        cfg.plainDim = 0.35
        val d = Transform.render(px, w, h, Transform.MODE_PLAIN, cfg)
        assertTrue(at(d.gray, w, 300, 350) in 80..95, "35 % brightness")
        // the dark view is not affected by the brightness buttons
        val dk = Transform.render(px, w, h, Transform.MODE_DARK, cfg)
        assertTrue(at(dk.gray, w, 100, 30) > 200)

        // nearly one-shade screens keep their real brightness in the as-on-the-phone view:
        // an almost empty white page is bright, an almost black screen stays black (no glow)
        val white = IntArray(w * h) { rgb(250, 250, 250) }
        for (y in 10 until 16) for (x in 10 until 60) white[y * w + x] = rgb(20, 20, 20)
        val wr = Transform.render(white, w, h, Transform.MODE_PLAIN, ViewConfig())
        assertTrue(at(wr.gray, w, 240, 240) > 230, "white page: " + at(wr.gray, w, 240, 240))
        assertTrue(at(wr.gray, w, 30, 12) < 30)
        val black = IntArray(w * h) { rgb(18, 18, 18) }
        for (y in 10 until 16) for (x in 10 until 60) black[y * w + x] = rgb(235, 235, 235)
        val br = Transform.render(black, w, h, Transform.MODE_PLAIN, ViewConfig())
        assertEquals(0, at(br.gray, w, 240, 240), "black screen must not glow")
        assertTrue(at(br.gray, w, 30, 12) > 230)
        val flat = IntArray(w * h) { rgb(128, 128, 128) }
        val fr = Transform.render(flat, w, h, Transform.MODE_PLAIN, ViewConfig())
        assertTrue(at(fr.gray, w, 240, 240) in 100..170, "a flat mid grey stays a mid grey: " + at(fr.gray, w, 240, 240))
    }

    @Test
    fun config_textRoundTrip_andUnknownOrBrokenLinesIgnored() {
        val c = ViewConfig()
        c.theme = "dark"
        c.darkGamma = 0.8
        c.plainEqualize = 0.5
        val t = c.toText()
        val d = ViewConfig.fromText(t)
        assertEquals(t, d.toText())
        assertEquals("dark", d.theme)
        // keys of earlier versions (colours, roads, band) and nonsense are simply skipped
        val e = ViewConfig.fromText("theme=purple\nlight.route=20,112,240,25\nroad.show=on\nband.lo=90\n# comment\nnonsense\ndark.levels=abc\nplain.levels=8\n")
        assertEquals("auto", e.theme)
        assertEquals(ViewConfig().darkLevels, e.darkLevels)
        assertEquals(8, e.plainLevels)
    }

    @Test
    fun scaler_boxAverage_andClamp() {
        val src = IntArray(4 * 4) { i -> if ((i % 4) < 2) rgb(0, 0, 0) else rgb(200, 100, 50) }
        val dst = IntArray(2 * 2)
        Scaler.scale(src, 4, 4, dst, 2, 2)
        assertEquals(rgb(0, 0, 0), dst[0])
        assertEquals(rgb(200, 100, 50), dst[1])
        val one = IntArray(1)
        Scaler.scale(src, 4, 4, one, 1, 1)
        assertEquals(rgb(100, 50, 25), one[0])
        assertEquals(listOf(0, 0, 1248, 1972), Scaler.wholeScreen(1248, 1972).toList())
        assertEquals(listOf(348, 1072, 900, 900), Scaler.clampCrop(intArrayOf(1000, 1800, 900, 900), 1248, 1972).toList())
        assertEquals(listOf(0, 0, 1248, 1972), Scaler.clampCrop(intArrayOf(-5, -5, 5000, 5000), 1248, 1972).toList())
    }

    @Test
    fun quality_levels_andGovernor() {
        val w = Layout.W
        val h = Layout.H
        val g = ByteArray(w * h) { i -> ((i % w) * 255 / (w - 1)).toByte() }       // left-to-right ramp
        val q0 = Quality.apply(g, w, h, 0)
        assertTrue(q0.gray === g)
        val q1 = Quality.apply(g, w, h, 1)
        assertEquals(w, q1.w)
        assertEquals(8, q1.gray.map { it.toInt() and 255 }.toSet().size)
        assertEquals(0, q1.gray[0].toInt() and 255)
        assertEquals(255, q1.gray[w - 1].toInt() and 255)
        val q2 = Quality.apply(g, w, h, 2)
        assertEquals(360, q2.w)
        assertEquals(480, q2.h)
        assertEquals(360 * 480, q2.gray.size)
        val q3 = Quality.apply(g, w, h, 3)
        assertEquals(240, q3.w)
        assertEquals(320, q3.h)
        assertTrue((q3.gray[160 * 240 + 239].toInt() and 255) > 240)
        assertTrue((q3.gray[160 * 240].toInt() and 255) < 15)

        val gov = QualityGovernor()
        // fast link: stays at full detail
        repeat(30) { gov.onDelivered(40) }
        assertEquals(0, gov.level)
        // slow link (1.2 s per picture): steps down, but never below the last level
        repeat(40) { gov.onDelivered(1200) }
        assertEquals(Quality.MAX, gov.level)
        // in between: holds
        gov.reset()
        repeat(6) { gov.onDelivered(900) }
        val held = gov.level
        assertTrue(held in 1..2)
        repeat(40) { gov.onDelivered(300) }
        assertEquals(held, gov.level)
        // clearly fast again: climbs back to full detail
        repeat(60) { gov.onDelivered(50) }
        assertEquals(0, gov.level)
    }
}
