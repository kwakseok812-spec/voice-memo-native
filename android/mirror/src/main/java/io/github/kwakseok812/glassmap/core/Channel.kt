package io.github.kwakseok812.glassmap.core

import java.io.FilterInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket

/**
 * One open two-way byte pipe between the phone app and the glasses app.
 * The protocol does not care what carries it: a TCP socket inside the local
 * network, or a Bluetooth serial link between the already-paired phone and glasses.
 */
interface Channel {
    val input: InputStream
    val output: OutputStream

    /** shown to the user: an address or a device name */
    val label: String
    val kind: Int

    /** Must be safe to call twice and from another thread (it unblocks pending reads/writes). */
    fun close()

    companion object {
        const val KIND_WIFI = 1
        const val KIND_BLUETOOTH = 2
    }
}

class SocketChannel(private val socket: Socket, override val label: String) : Channel {
    init {
        try {
            socket.tcpNoDelay = true
        } catch (e: Exception) {
        }
    }

    override val input: InputStream = socket.getInputStream()
    override val output: OutputStream = socket.getOutputStream()
    override val kind: Int = Channel.KIND_WIFI

    override fun close() {
        try {
            socket.close()
        } catch (e: Exception) {
        }
    }
}

/**
 * A place the phone can try to reach the glasses app at.
 * @param key   stable id (IP address or Bluetooth address) used to remember what worked
 * @param paired true = the user already paired this device with the phone (Bluetooth), no extra confirmation needed
 * @param open  opens the pipe or throws
 */
class Endpoint(
    val label: String,
    val key: String,
    val kind: Int,
    val paired: Boolean,
    val open: () -> Channel
)

/** Tells a watchdog every time bytes arrive, so "silent for too long" can be detected on any kind of pipe. */
class WatchedInput(inner: InputStream, private val onBytes: () -> Unit) : FilterInputStream(inner) {
    override fun read(): Int {
        val v = super.read()
        if (v >= 0) onBytes()
        return v
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        val n = super.read(b, off, len)
        if (n > 0) onBytes()
        return n
    }
}
