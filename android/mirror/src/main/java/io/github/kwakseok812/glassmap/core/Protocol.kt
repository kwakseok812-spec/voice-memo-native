package io.github.kwakseok812.glassmap.core

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * Wire format between the phone app (sender) and the glasses app (receiver).
 * The same bytes travel over either pipe (see Channel): the Bluetooth serial link between
 * the paired phone and glasses (main route since v0.2), or a TCP socket inside the local
 * network. Nothing here depends on which one carries it.
 *
 *   hello   : "GMAP" + version(1 byte) + role(1 byte) + id(int)      (each side sends one)
 *   message : type(1 byte) + length(int) + payload
 */
object Protocol {
    const val VERSION = 1
    const val ROLE_PHONE = 1
    const val ROLE_GLASSES = 2

    const val T_FRAME = 1      // phone -> glasses : picture
    const val T_PING = 2       // phone -> glasses : "still here" (not answered one by one)
    const val T_PONG = 3       // glasses -> phone : heartbeat on a clock of its own
    const val T_INPUT = 4      // glasses -> phone : a key / tap happened (and "please switch mode")
    const val T_SETTINGS = 5   // phone -> glasses : show key codes on the lens or not
    const val T_NOTICE = 6     // phone -> glasses : why no picture is coming (one byte, NOTICE_*)

    const val T_ACK = 7        // glasses -> phone : picture number <int> arrived and is on the lens
    const val T_QUIT = 8       // phone -> glasses : close the glasses app (the user asked for it on the phone)

    const val NOTICE_NONE = 0
    const val NOTICE_SCREEN_OFF = 1     // the phone screen is off: pictures pause until it is on again
    const val NOTICE_SHARE_ENDED = 2    // the system ended the screen share: "start" must be pressed again

    const val KIND_KEY = 0
    const val KIND_TOUCH = 1
    const val KIND_MOTION = 2

    const val MAX_PAYLOAD = 2 * 1024 * 1024
    private val MAGIC = byteArrayOf('G'.code.toByte(), 'M'.code.toByte(), 'A'.code.toByte(), 'P'.code.toByte())
    val EMPTY = ByteArray(0)

    class Hello(val role: Int, val id: Int)

    class Frame(val mode: Int, val seq: Int, val w: Int, val h: Int, val gray: ByteArray)

    class Input(val code: Int, val kind: Int, val toggle: Boolean)

    fun writeHello(out: DataOutputStream, role: Int, id: Int) {
        out.write(MAGIC)
        out.writeByte(VERSION)
        out.writeByte(role)
        out.writeInt(id)
        out.flush()
    }

    fun readHello(inp: DataInputStream): Hello {
        val m = ByteArray(4)
        inp.readFully(m)
        if (!m.contentEquals(MAGIC)) throw IOException("not a glass-map peer")
        val ver = inp.readUnsignedByte()
        if (ver != VERSION) throw IOException("version mismatch: $ver")
        val role = inp.readUnsignedByte()
        val id = inp.readInt()
        return Hello(role, id)
    }

    fun writeMessage(out: DataOutputStream, type: Int, payload: ByteArray) {
        out.writeByte(type)
        out.writeInt(payload.size)
        out.write(payload)
        out.flush()
    }

    /** Reads one message; returns type and payload. */
    fun readMessage(inp: DataInputStream): Pair<Int, ByteArray> {
        val type = inp.readUnsignedByte()
        val len = inp.readInt()
        if (len < 0 || len > MAX_PAYLOAD) throw IOException("bad length $len")
        val p = ByteArray(len)
        inp.readFully(p)
        return Pair(type, p)
    }

    fun encodeFrame(f: Frame): ByteArray {
        if (f.gray.size != f.w * f.h) throw IllegalArgumentException("size mismatch")
        val def = Deflater(Deflater.BEST_SPEED)
        def.setInput(f.gray)
        def.finish()
        val bos = ByteArrayOutputStream(16384)
        bos.write(f.mode)
        bos.write(f.seq ushr 24)
        bos.write(f.seq ushr 16)
        bos.write(f.seq ushr 8)
        bos.write(f.seq)
        bos.write(f.w ushr 8)
        bos.write(f.w)
        bos.write(f.h ushr 8)
        bos.write(f.h)
        val buf = ByteArray(16384)
        while (!def.finished()) {
            val n = def.deflate(buf)
            bos.write(buf, 0, n)
        }
        def.end()
        return bos.toByteArray()
    }

    fun decodeFrame(p: ByteArray): Frame {
        if (p.size < 9) throw IOException("short frame")
        val mode = p[0].toInt() and 255
        val seq = ((p[1].toInt() and 255) shl 24) or ((p[2].toInt() and 255) shl 16) or
            ((p[3].toInt() and 255) shl 8) or (p[4].toInt() and 255)
        val w = ((p[5].toInt() and 255) shl 8) or (p[6].toInt() and 255)
        val h = ((p[7].toInt() and 255) shl 8) or (p[8].toInt() and 255)
        if (w <= 0 || h <= 0 || w > 2048 || h > 2048) throw IOException("bad frame size ${w}x$h")
        val gray = ByteArray(w * h)
        val inf = Inflater()
        try {
            inf.setInput(p, 9, p.size - 9)
            var off = 0
            while (off < gray.size) {
                val n = inf.inflate(gray, off, gray.size - off)
                if (n == 0) {
                    if (inf.finished() || inf.needsInput() || inf.needsDictionary()) break
                }
                off += n
            }
            if (off != gray.size) throw IOException("frame data too short")
        } catch (e: java.util.zip.DataFormatException) {
            throw IOException("broken frame data")
        } finally {
            inf.end()
        }
        return Frame(mode, seq, w, h, gray)
    }

    fun encodeInt(v: Int): ByteArray =
        byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())

    fun decodeInt(p: ByteArray): Int {
        if (p.size < 4) throw IOException("short int")
        return ((p[0].toInt() and 255) shl 24) or ((p[1].toInt() and 255) shl 16) or
            ((p[2].toInt() and 255) shl 8) or (p[3].toInt() and 255)
    }

    fun encodeInput(i: Input): ByteArray = byteArrayOf(
        (i.code ushr 24).toByte(), (i.code ushr 16).toByte(), (i.code ushr 8).toByte(), i.code.toByte(),
        i.kind.toByte(), (if (i.toggle) 1 else 0).toByte()
    )

    fun decodeInput(p: ByteArray): Input {
        if (p.size < 6) throw IOException("short input")
        val code = ((p[0].toInt() and 255) shl 24) or ((p[1].toInt() and 255) shl 16) or
            ((p[2].toInt() and 255) shl 8) or (p[3].toInt() and 255)
        return Input(code, p[4].toInt() and 255, p[5].toInt() != 0)
    }
}
