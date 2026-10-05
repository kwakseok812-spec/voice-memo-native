package io.github.kwakseok812.glassmap.phone

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import io.github.kwakseok812.glassmap.core.NetUtil
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import kotlin.concurrent.thread

/**
 * Finds the glasses app inside the local network, three ways:
 *  1) service discovery (the glasses announce "_glassmap._tcp")
 *  2) small broadcast beacons the glasses send while they wait
 *  3) last resort: knocking on the addresses of the phone's own Wi-Fi / hotspot network
 * Nothing leaves the local network.
 */
class Discovery(private val ctx: Context, private val needScan: () -> Boolean) {

    companion object {
        private const val TAG = "GlassMap"
        private const val SCAN_INTERVAL_MS = 9000L
    }

    private val hosts = LinkedHashMap<String, Long>()
    @Volatile private var running = false
    private var nsd: NsdManager? = null
    private var nsdListener: NsdManager.DiscoveryListener? = null
    private var beaconSocket: DatagramSocket? = null

    /** Addresses seen recently, newest first. */
    fun found(): List<String> = synchronized(hosts) {
        hosts.entries.sortedByDescending { it.value }.map { it.key }
    }

    private fun add(host: String?, how: String) {
        if (host == null || !NetUtil.isLocalHostString(host)) return
        val isNew = synchronized(hosts) {
            val n = !hosts.containsKey(host)
            hosts[host] = System.currentTimeMillis()
            n
        }
        if (isNew) Log.i(TAG, "glasses candidate $host via $how")
    }

    fun start() {
        if (running) return
        running = true
        startNsd()
        thread(name = "gm-beacon-listen", isDaemon = true) { beaconLoop() }
        thread(name = "gm-scan", isDaemon = true) { scanLoop() }
    }

    fun stop() {
        running = false
        try {
            val l = nsdListener
            if (l != null) nsd?.stopServiceDiscovery(l)
        } catch (e: Exception) {
        }
        nsdListener = null
        try {
            beaconSocket?.close()
        } catch (e: Exception) {
        }
    }

    private fun startNsd() {
        try {
            val mgr = ctx.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
            val l = object : NsdManager.DiscoveryListener {
                override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                    Log.w(TAG, "nsd discovery failed $errorCode")
                }
                override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {}
                override fun onDiscoveryStarted(serviceType: String?) {}
                override fun onDiscoveryStopped(serviceType: String?) {}
                override fun onServiceLost(serviceInfo: NsdServiceInfo?) {}
                override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
                    if (serviceInfo == null) return
                    try {
                        @Suppress("DEPRECATION")
                        mgr.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                            override fun onResolveFailed(si: NsdServiceInfo?, errorCode: Int) {}
                            override fun onServiceResolved(si: NsdServiceInfo?) {
                                @Suppress("DEPRECATION")
                                add(si?.host?.hostAddress, "nsd")
                            }
                        })
                    } catch (e: Exception) {
                    }
                }
            }
            mgr.discoverServices(NetUtil.NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, l)
            nsd = mgr
            nsdListener = l
        } catch (e: Exception) {
            Log.w(TAG, "nsd not available: $e")
        }
    }

    private fun beaconLoop() {
        val buf = ByteArray(256)
        while (running) {
            try {
                val s = DatagramSocket(null)
                s.reuseAddress = true
                s.broadcast = true
                s.bind(InetSocketAddress(NetUtil.BEACON_PORT))
                s.soTimeout = 3000
                beaconSocket = s
                while (running) {
                    val p = DatagramPacket(buf, buf.size)
                    try {
                        s.receive(p)
                    } catch (e: java.net.SocketTimeoutException) {
                        continue
                    }
                    val text = String(p.data, 0, p.length, Charsets.US_ASCII)
                    if (NetUtil.parseBeacon(text) != null && NetUtil.isLocalAddress(p.address)) {
                        add(p.address.hostAddress, "beacon")
                    }
                }
            } catch (e: Exception) {
                try {
                    beaconSocket?.close()
                } catch (e2: Exception) {
                }
                if (running) sleepQuiet(2000)
            }
        }
    }

    private fun scanLoop() {
        sleepQuiet(5000)   // give the two quiet ways a head start
        while (running) {
            if (needScan()) {
                try {
                    for (h in NetUtil.scanSubnets(NetUtil.PORT, 350)) add(h, "scan")
                } catch (e: Exception) {
                }
            }
            sleepQuiet(SCAN_INTERVAL_MS)
        }
    }

    private fun sleepQuiet(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (e: InterruptedException) {
        }
    }
}
