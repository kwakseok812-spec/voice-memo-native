package io.github.kwakseok812.glassmap.phone

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import io.github.kwakseok812.glassmap.core.Channel
import io.github.kwakseok812.glassmap.core.Endpoint
import io.github.kwakseok812.glassmap.core.NetUtil
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Reaches the glasses app over Bluetooth serial (RFCOMM). The glasses are already paired
 * with this phone (Hi Rokid did that; it is also how sound gets there), so there is nothing
 * to scan for and nothing to type: we go through the phone's list of paired devices and
 * call the one that answers with the glass-map service.
 *
 * Only paired devices are ever contacted. No scanning, no new pairing, no location.
 */
object BtDialer {
    private const val TAG = "GlassMap"

    const val ST_OK = 0
    const val ST_NO_ADAPTER = 1
    const val ST_OFF = 2
    const val ST_NO_PERMISSION = 3
    const val ST_NO_PAIRED = 4

    private const val CONNECT_TIMEOUT_MS = 7000L

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 31 ||
            ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun adapter(ctx: Context): BluetoothAdapter? = try {
        (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    } catch (e: Exception) {
        null
    }

    @SuppressLint("MissingPermission")
    private fun paired(ctx: Context): List<BluetoothDevice> {
        val a = adapter(ctx) ?: return emptyList()
        return try {
            a.bondedDevices?.toList() ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }

    @SuppressLint("MissingPermission")
    fun status(ctx: Context): Int {
        val a = adapter(ctx) ?: return ST_NO_ADAPTER
        if (!hasPermission(ctx)) return ST_NO_PERMISSION
        val on = try {
            a.isEnabled
        } catch (e: Exception) {
            false
        }
        if (!on) return ST_OFF
        if (paired(ctx).isEmpty()) return ST_NO_PAIRED
        return ST_OK
    }

    @SuppressLint("MissingPermission")
    private fun nameOf(d: BluetoothDevice): String = try {
        d.name ?: d.address
    } catch (e: Exception) {
        d.address
    }

    /** Smaller = try earlier. */
    @SuppressLint("MissingPermission")
    private fun rank(d: BluetoothDevice, remembered: String): Int {
        if (d.address == remembered) return 0
        val n = nameOf(d).lowercase()
        if (n.contains("rokid") || n.contains("glass") || n.contains("rv10")) return 1
        // devices the phone is talking to right now come before ones that are switched off
        val connected = try {
            d.javaClass.getMethod("isConnected").invoke(d) as? Boolean ?: false
        } catch (e: Throwable) {
            false
        }
        val major = try {
            d.bluetoothClass?.majorDeviceClass ?: -1
        } catch (e: Exception) {
            -1
        }
        val likely = major == BluetoothClass.Device.Major.AUDIO_VIDEO || major == BluetoothClass.Device.Major.WEARABLE
        return when {
            connected && likely -> 2
            connected -> 3
            likely -> 4
            else -> 5
        }
    }

    private var round = 0

    /**
     * Paired devices as endpoints, the most likely glasses first. Empty when Bluetooth cannot be used.
     * The device that worked before and devices named like the glasses are tried every round.
     * Other paired devices (earbuds, a watch, a car) are tried only now and then, so that they
     * are not disturbed by a call every second while the glasses app is simply not open yet.
     */
    @Synchronized
    fun endpoints(ctx: Context): List<Endpoint> {
        if (status(ctx) != ST_OK) return emptyList()
        val remembered = Prefs.btAddress(ctx)
        val a = adapter(ctx) ?: return emptyList()
        val ranked = paired(ctx).map { Pair(rank(it, remembered), it) }.sortedBy { it.first }
        val likely = ranked.count { it.first <= 1 }
        round++
        val withOthers = if (likely == 0) (round % 3 == 1) else (round % 8 == 1)
        return ranked.filter { it.first <= 1 || withOthers }.map { it.second }.map { d ->
            val name = nameOf(d)
            Endpoint(name, d.address, Channel.KIND_BLUETOOTH, true) { open(a, d, name) }
        }
    }

    private class BtChannel(private val socket: BluetoothSocket, override val label: String) : Channel {
        override val input: InputStream = socket.inputStream
        override val output: OutputStream = socket.outputStream
        override val kind: Int = Channel.KIND_BLUETOOTH
        override fun close() {
            try {
                socket.close()
            } catch (e: Exception) {
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun open(adapter: BluetoothAdapter, d: BluetoothDevice, name: String): Channel {
        var lastError: Exception? = null
        for (secure in booleanArrayOf(true, false)) {
            val t0 = SystemClock.elapsedRealtime()
            var sock: BluetoothSocket? = null
            val done = AtomicBoolean(false)
            try {
                val s = if (secure) {
                    d.createRfcommSocketToServiceRecord(UUID.fromString(NetUtil.BT_UUID_SECURE))
                } else {
                    d.createInsecureRfcommSocketToServiceRecord(UUID.fromString(NetUtil.BT_UUID_FALLBACK))
                }
                sock = s
                // connect() has no timeout of its own
                thread(name = "gm-bt-connect-guard", isDaemon = true) {
                    val end = SystemClock.elapsedRealtime() + CONNECT_TIMEOUT_MS
                    while (!done.get() && SystemClock.elapsedRealtime() < end) {
                        try {
                            Thread.sleep(200)
                        } catch (e: InterruptedException) {
                        }
                    }
                    if (!done.get()) {
                        try {
                            s.close()
                        } catch (e: Exception) {
                        }
                    }
                }
                s.connect()
                done.set(true)
                Log.i(TAG, "bt connected to paired device (secure=$secure)")
                return BtChannel(s, name)
            } catch (e: Exception) {
                done.set(true)
                try {
                    sock?.close()
                } catch (e2: Exception) {
                }
                lastError = e
                val took = SystemClock.elapsedRealtime() - t0
                // A slow failure means the device is not around at all: the fallback would only cost more time.
                if (took > 4000) break
            }
        }
        throw IOException("bluetooth: no glass-map service on this device (${lastError?.javaClass?.simpleName})")
    }
}
