package io.github.kwakseok812.glassmap.core

import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Socket
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object NetUtil {
    const val PORT = 47800
    const val BEACON_PORT = 47801
    const val BEACON_PREFIX = "GMAP1"
    const val NSD_TYPE = "_glassmap._tcp"

    /**
     * Bluetooth serial (RFCOMM) service ids of the glasses app. The glasses listen on both:
     * the first asks for an authenticated, encrypted link (normal between paired devices),
     * the second is the fallback some devices need.
     */
    const val BT_UUID_SECURE = "6f1d0a52-7c3e-4b8a-9d41-5a0c9e2b7f10"
    const val BT_UUID_FALLBACK = "6f1d0a53-7c3e-4b8a-9d41-5a0c9e2b7f10"
    const val BT_SERVICE_NAME = "GlassMap"
    const val TCP_CONNECT_TIMEOUT_MS = 1500

    /** A Wi-Fi endpoint. Refuses anything that is not a literal local-network address. */
    fun tcpEndpoint(host: String, port: Int): Endpoint = Endpoint(host, host, Channel.KIND_WIFI, false) {
        if (!isLocalHostString(host)) throw java.io.IOException("not a local address")
        val s = Socket()
        try {
            s.connect(InetSocketAddress(InetAddress.getByName(host), port), TCP_CONNECT_TIMEOUT_MS)
            SocketChannel(s, host)
        } catch (e: Exception) {
            try {
                s.close()
            } catch (e2: Exception) {
            }
            throw e
        }
    }

    /** Optional log sink (the apps point this at the system log; null = silent). */
    @Volatile var logger: ((String) -> Unit)? = null

    fun log(msg: String) {
        try {
            logger?.invoke(msg)
        } catch (e: Exception) {
        }
    }

    /** Only addresses of the local network (Wi-Fi / hotspot) or this device itself are ever used. */
    fun isLocalAddress(a: InetAddress?): Boolean =
        a != null && (a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress)

    /** Accepts only literal local IPv4 addresses (no names -> no DNS lookups). */
    fun isLocalHostString(host: String): Boolean {
        val parts = host.trim().split(".")
        if (parts.size != 4) return false
        val n = parts.map { it.toIntOrNull() ?: return false }
        if (n.any { it < 0 || it > 255 }) return false
        return n[0] == 10 || n[0] == 127 ||
            (n[0] == 172 && n[1] in 16..31) ||
            (n[0] == 192 && n[1] == 168) ||
            (n[0] == 169 && n[1] == 254)
    }

    private fun interfaces(): List<NetworkInterface> = try {
        val e = NetworkInterface.getNetworkInterfaces()
        if (e == null) emptyList() else Collections.list(e)
    } catch (ex: Exception) {
        emptyList()
    }

    /** This device's own local IPv4 addresses (Wi-Fi, hotspot), without loopback. */
    fun localIPv4(): List<String> {
        val out = ArrayList<String>()
        for (ni in interfaces()) {
            try {
                if (!ni.isUp || ni.isLoopback) continue
                for (a in Collections.list(ni.inetAddresses)) {
                    if (a is Inet4Address && !a.isLoopbackAddress && (a.isSiteLocalAddress || a.isLinkLocalAddress)) {
                        val s = a.hostAddress
                        if (s != null && !out.contains(s)) out.add(s)
                    }
                }
            } catch (ex: Exception) {
            }
        }
        return out
    }

    fun broadcastAddresses(): List<InetAddress> {
        val out = ArrayList<InetAddress>()
        try {
            out.add(InetAddress.getByAddress(byteArrayOf(-1, -1, -1, -1)))
        } catch (ex: Exception) {
        }
        for (ni in interfaces()) {
            try {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val b = ia.broadcast
                    if (b != null && ia.address is Inet4Address && isLocalAddress(ia.address) && !out.contains(b)) out.add(b)
                }
            } catch (ex: Exception) {
            }
        }
        return out
    }

    fun beaconText(id: Int, port: Int): String = "$BEACON_PREFIX|$id|$port"

    /** Send one "glasses are here" beacon to the local network. */
    fun sendBeacon(id: Int, port: Int) {
        val data = beaconText(id, port).toByteArray(Charsets.US_ASCII)
        try {
            DatagramSocket().use { s ->
                s.broadcast = true
                for (a in broadcastAddresses()) {
                    try {
                        s.send(DatagramPacket(data, data.size, a, BEACON_PORT))
                    } catch (ex: Exception) {
                    }
                }
            }
        } catch (ex: Exception) {
        }
    }

    /** Parses a beacon; returns glasses id and port, or null. */
    fun parseBeacon(text: String): IntArray? {
        val p = text.trim().split("|")
        if (p.size != 3 || p[0] != BEACON_PREFIX) return null
        val id = p[1].toIntOrNull() ?: return null
        val port = p[2].toIntOrNull() ?: return null
        return intArrayOf(id, port)
    }

    /**
     * Last resort when neither service discovery nor beacons worked: knock on every
     * address of this device's own /24 networks and keep those that answer with the
     * glass-map hello. Local addresses only.
     */
    fun scanSubnets(port: Int, timeoutMs: Int): List<String> {
        val own = localIPv4()
        val targets = ArrayList<String>()
        for (ip in own) {
            val i = ip.lastIndexOf('.')
            if (i <= 0) continue
            val base = ip.substring(0, i + 1)
            for (h in 1..254) {
                val t = base + h
                if (t != ip && !targets.contains(t)) targets.add(t)
            }
        }
        if (targets.isEmpty()) return emptyList()
        val found = Collections.synchronizedList(ArrayList<String>())
        val pool = Executors.newFixedThreadPool(48)
        for (t in targets) {
            pool.execute {
                try {
                    Socket().use { s ->
                        s.connect(InetSocketAddress(InetAddress.getByName(t), port), timeoutMs)
                        s.soTimeout = timeoutMs * 2
                        val hello = Protocol.readHello(DataInputStream(s.getInputStream()))
                        if (hello.role == Protocol.ROLE_GLASSES) found.add(t)
                    }
                } catch (ex: Exception) {
                }
            }
        }
        pool.shutdown()
        try {
            pool.awaitTermination(20, TimeUnit.SECONDS)
        } catch (ex: InterruptedException) {
        }
        pool.shutdownNow()
        return ArrayList(found)
    }
}
