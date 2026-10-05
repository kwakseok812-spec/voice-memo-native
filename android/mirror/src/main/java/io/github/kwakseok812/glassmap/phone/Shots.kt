package io.github.kwakseok812.glassmap.phone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri

/**
 * The one screen picture the "set the area" screen works on. It is either the last frame
 * of the running screen share or a capture the user picked.
 * Kept in memory only, never written to storage.
 */
object Shots {
    @Volatile var current: Bitmap? = null

    /** Take the last frame of another app from the running screen share. */
    fun fromService(): Boolean {
        val b = AppState.service?.snapshot() ?: return false
        current = b
        return true
    }

    /** Load a capture the user picked in the system picker (read once, not copied anywhere). */
    fun fromUri(c: Context, uri: Uri): Boolean {
        return try {
            val b = c.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: return false
            current = if (b.config == Bitmap.Config.ARGB_8888) b else b.copy(Bitmap.Config.ARGB_8888, false)
            true
        } catch (e: Throwable) {
            false
        }
    }
}
