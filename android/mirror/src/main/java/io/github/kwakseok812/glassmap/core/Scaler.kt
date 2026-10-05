package io.github.kwakseok812.glassmap.core

/** Size of the picture sent to the glasses (portrait 480 x 640). */
object Layout {
    const val W = 480
    const val H = 640
}

object Scaler {

    /** The whole screen. */
    fun wholeScreen(sw: Int, sh: Int): IntArray = intArrayOf(0, 0, sw, sh)

    /** Keep a rectangle inside the picture. */
    fun clampCrop(c: IntArray, w: Int, h: Int): IntArray {
        val cw = c[2].coerceIn(16.coerceAtMost(w), w)
        val ch = c[3].coerceIn(16.coerceAtMost(h), h)
        val cx = c[0].coerceIn(0, w - cw)
        val cy = c[1].coerceIn(0, h - ch)
        return intArrayOf(cx, cy, cw, ch)
    }

    /** Copy a rectangle out of a bigger picture. */
    fun crop(src: IntArray, sw: Int, c: IntArray): IntArray {
        val out = IntArray(c[2] * c[3])
        for (y in 0 until c[3]) {
            System.arraycopy(src, (c[1] + y) * sw + c[0], out, y * c[2], c[2])
        }
        return out
    }

    /**
     * Scale src (sw x sh, 0xAARRGGBB) to dst (dw x dh) by averaging the source
     * pixels that fall under each destination pixel (box filter). src is made to fill
     * dst exactly, so the caller must pass a dst of the same shape (FrameBuilder works
     * out that shape: "show all" keeps the shape of the area, "fill" trims it first).
     */
    fun scale(src: IntArray, sw: Int, sh: Int, dst: IntArray, dw: Int, dh: Int) {
        val x0s = IntArray(dw)
        val x1s = IntArray(dw)
        for (dx in 0 until dw) {
            var a = (dx.toLong() * sw / dw).toInt()
            var b = ((dx + 1).toLong() * sw / dw).toInt()
            if (a >= sw) a = sw - 1
            if (b <= a) b = a + 1
            if (b > sw) b = sw
            x0s[dx] = a
            x1s[dx] = b
        }
        for (dy in 0 until dh) {
            var y0 = (dy.toLong() * sh / dh).toInt()
            var y1 = ((dy + 1).toLong() * sh / dh).toInt()
            if (y0 >= sh) y0 = sh - 1
            if (y1 <= y0) y1 = y0 + 1
            if (y1 > sh) y1 = sh
            val o = dy * dw
            for (dx in 0 until dw) {
                val x0 = x0s[dx]
                val x1 = x1s[dx]
                var r = 0
                var g = 0
                var b = 0
                var y = y0
                while (y < y1) {
                    var i = y * sw + x0
                    val end = y * sw + x1
                    while (i < end) {
                        val p = src[i]
                        r += (p shr 16) and 255
                        g += (p shr 8) and 255
                        b += p and 255
                        i++
                    }
                    y++
                }
                val n = (x1 - x0) * (y1 - y0)
                dst[o + dx] = (0xFF shl 24) or ((r / n) shl 16) or ((g / n) shl 8) or (b / n)
            }
        }
    }
}
