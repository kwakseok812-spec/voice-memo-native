package io.github.kwakseok812.glassmap.core

/**
 * The numbers behind the two views. The conversion code reads only this object, so a
 * value can be tried out (PC tool: --config file with "key=value" lines) without
 * touching the code. The phone app uses the defaults.
 */
class ViewConfig {
    /** auto | light | dark : whether the dark view inverts. auto = by the mean brightness of the picture */
    var theme: String = "auto"

    /** auto: mean brightness (0..255) at or above this = a light screen */
    var autoLightThreshold: Int = 110

    // ---- dark view: light screens inverted, the darkest 60 % cut to black, letters kept solid
    var darkLoPct: Double = 60.0
    var darkHiPct: Double = 99.8
    var darkGamma: Double = 0.62
    var darkLevels: Int = 16

    // ---- "as on the phone" view: brightness as it is, the darkest / brightest 1 % clipped, shades pulled apart a little
    var plainLoPct: Double = 1.0
    var plainHiPct: Double = 99.0
    var plainGamma: Double = 1.0
    var plainLevels: Int = 16
    var plainEqualize: Double = 0.35

    /** black is never placed above this brightness, white never below that one (nearly one-shade screens keep their real brightness) */
    var plainMaxBlack: Int = 64
    var plainMinWhite: Int = 192

    /** brightness of the "as on the phone" view (1 = full). Set by the app from its brightness buttons; not part of the text. */
    @Volatile var plainDim: Double = 1.0

    fun toText(): String {
        val sb = StringBuilder()
        fun line(k: String, v: Any) { sb.append(k).append('=').append(v.toString()).append('\n') }
        line("theme", theme)
        line("auto.lightThreshold", autoLightThreshold)
        line("dark.loPct", darkLoPct)
        line("dark.hiPct", darkHiPct)
        line("dark.gamma", darkGamma)
        line("dark.levels", darkLevels)
        line("plain.loPct", plainLoPct)
        line("plain.hiPct", plainHiPct)
        line("plain.gamma", plainGamma)
        line("plain.levels", plainLevels)
        line("plain.equalize", plainEqualize)
        line("plain.maxBlack", plainMaxBlack)
        line("plain.minWhite", plainMinWhite)
        return sb.toString()
    }

    companion object {
        /** Unknown keys and broken values are ignored (the default stays). Lines starting with # are comments. */
        fun fromText(text: String): ViewConfig {
            val c = ViewConfig()
            for (raw in text.split("\n")) {
                val ln = raw.trim()
                if (ln.isEmpty() || ln.startsWith("#")) continue
                val i = ln.indexOf('=')
                if (i <= 0) continue
                val k = ln.substring(0, i).trim()
                val v = ln.substring(i + 1).trim()
                val iv = v.toIntOrNull()
                val dv = v.toDoubleOrNull()
                when (k) {
                    "theme" -> if (v == "auto" || v == "light" || v == "dark") c.theme = v
                    "auto.lightThreshold" -> iv?.let { c.autoLightThreshold = it.coerceIn(0, 255) }
                    "dark.loPct" -> dv?.let { c.darkLoPct = it.coerceIn(0.0, 100.0) }
                    "dark.hiPct" -> dv?.let { c.darkHiPct = it.coerceIn(0.0, 100.0) }
                    "dark.gamma" -> dv?.let { c.darkGamma = it.coerceIn(0.1, 5.0) }
                    "dark.levels" -> iv?.let { c.darkLevels = it.coerceIn(2, 256) }
                    "plain.loPct" -> dv?.let { c.plainLoPct = it.coerceIn(0.0, 100.0) }
                    "plain.hiPct" -> dv?.let { c.plainHiPct = it.coerceIn(0.0, 100.0) }
                    "plain.gamma" -> dv?.let { c.plainGamma = it.coerceIn(0.1, 5.0) }
                    "plain.levels" -> iv?.let { c.plainLevels = it.coerceIn(2, 256) }
                    "plain.equalize" -> dv?.let { c.plainEqualize = it.coerceIn(0.0, 1.0) }
                    "plain.maxBlack" -> iv?.let { c.plainMaxBlack = it.coerceIn(0, 255) }
                    "plain.minWhite" -> iv?.let { c.plainMinWhite = it.coerceIn(0, 255) }
                }
            }
            return c
        }
    }
}
