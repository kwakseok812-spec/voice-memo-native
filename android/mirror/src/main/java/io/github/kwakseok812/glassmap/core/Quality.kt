package io.github.kwakseok812.glassmap.core

/**
 * How detailed a picture is sent. On a slow link (Bluetooth with a busy picture) a smaller
 * picture that arrives soon is worth more than a detailed one that arrives late.
 *
 *   level 0 : 480 x 640, brightness steps as produced
 *   level 1 : 480 x 640, 8 brightness steps
 *   level 2 : 360 x 480, 8 steps
 *   level 3 : 240 x 320, 8 steps
 *
 * The glasses app scales whatever size arrives to the lens, so no setting is needed there.
 */
object Quality {
    const val MAX = 3

    class Out(val gray: ByteArray, val w: Int, val h: Int)

    fun apply(gray: ByteArray, w: Int, h: Int, level: Int): Out {
        if (level <= 0) return Out(gray, w, h)
        var g = gray
        var ow = w
        var oh = h
        if (level >= 2) {
            ow = if (level == 2) w * 3 / 4 else w / 2
            oh = if (level == 2) h * 3 / 4 else h / 2
            g = shrink(gray, w, h, ow, oh)
        }
        return Out(steps(g, 8), ow, oh)
    }

    /** Reduce to n evenly spaced brightness steps (black stays black, full stays full). */
    fun steps(gray: ByteArray, n: Int): ByteArray {
        val lut = ByteArray(256)
        for (v in 0..255) {
            val q = (v * (n - 1) * 2 + 255) / 510          // round(v * (n-1) / 255)
            lut[v] = (q * 255 / (n - 1)).toByte()
        }
        val out = ByteArray(gray.size)
        for (i in gray.indices) out[i] = lut[gray[i].toInt() and 255]
        return out
    }

    /** Box average, same idea as Scaler.scale but for one byte per pixel. */
    fun shrink(src: ByteArray, sw: Int, sh: Int, dw: Int, dh: Int): ByteArray {
        val out = ByteArray(dw * dh)
        for (dy in 0 until dh) {
            val y0 = (dy.toLong() * sh / dh).toInt()
            var y1 = ((dy + 1).toLong() * sh / dh).toInt()
            if (y1 <= y0) y1 = y0 + 1
            if (y1 > sh) y1 = sh
            for (dx in 0 until dw) {
                val x0 = (dx.toLong() * sw / dw).toInt()
                var x1 = ((dx + 1).toLong() * sw / dw).toInt()
                if (x1 <= x0) x1 = x0 + 1
                if (x1 > sw) x1 = sw
                var sum = 0
                var y = y0
                while (y < y1) {
                    var i = y * sw + x0
                    val end = y * sw + x1
                    while (i < end) {
                        sum += src[i].toInt() and 255
                        i++
                    }
                    y++
                }
                out[dy * dw + dx] = (sum / ((x1 - x0) * (y1 - y0))).toByte()
            }
        }
        return out
    }
}

/**
 * Picks the quality level from how long pictures take to reach the glasses.
 * Slower than about two pictures a second -> one level down. Clearly fast for a while ->
 * one level up again; if that turns out too much it waits longer before the next try.
 */
class QualityGovernor {
    companion object {
        const val SLOW_MS = 450.0
        const val FAST_MS = 160.0
    }

    @Volatile var level = 0
        private set
    private var ema = -1.0
    private var sinceChange = 0
    private var good = 0
    private var upNeed = 6
    private var lastWasUp = false

    @Synchronized
    fun reset() {
        level = 0
        ema = -1.0
        sinceChange = 0
        good = 0
        upNeed = 6
        lastWasUp = false
    }

    /** Call for every confirmed picture. Returns the level to use from now on. */
    @Synchronized
    fun onDelivered(ms: Long): Int {
        ema = if (ema < 0) ms.toDouble() else ema * 0.6 + ms * 0.4
        sinceChange++
        if (sinceChange < 3) return level
        if (ema > SLOW_MS && level < Quality.MAX) {
            // going up did not hold: ask for a longer good run next time
            if (lastWasUp && sinceChange <= 6) upNeed = if (upNeed >= 48) 48 else upNeed * 2
            level++
            lastWasUp = false
            changed()
        } else if (ema < FAST_MS && level > 0) {
            good++
            if (good >= upNeed) {
                level--
                lastWasUp = true
                changed()
            }
        } else {
            good = 0
        }
        return level
    }

    private fun changed() {
        ema = -1.0
        sinceChange = 0
        good = 0
    }
}
