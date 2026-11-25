package dev.rubeen.lifeline.helfer.dienste

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import dev.rubeen.lifeline.helfer.MainActivity
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helferkern.Antwort
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Position
import dev.rubeen.lifeline.helferkern.Sendeplan
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Die Helfer-Ortung (ADR-0098, Spec „Ortung im Hintergrund“ und „Senden, Takt, ohne Netz“): die
 * einzige Stelle, die im Hintergrund sendet.
 *
 * - Ein Vordergrund-Dienst vom Typ `location`, gestartet nur aus der geöffneten App ([starte]);
 *   `START_NOT_STICKY`, nach dem Ende des Prozesses startet er nicht von selbst wieder.
 * - Sichtbar durch die dauerhafte Benachrichtigung „Lifeline ortet dich für Einsatz …“ mit
 *   „Pausieren“; Tippen öffnet die App. Ab Android 16 bittet sie um ein Live-Update.
 * - Positionen vom `LocationManager` des Systems (der Fused Provider des Systems, wo es ihn gibt,
 *   sonst GPS und Netz), weil die App ohne Play-Dienste verteilt wird: höchstens alle 30 s, ab
 *   25 m Bewegung, dazu jede halbe Minute die Prüfung auf ein Lebenszeichen.
 * - Was gesendet wird und wann, entscheidet der [Sendeplan] im Kern; hier stehen nur Uhr, Netz und
 *   System. Kein Verlauf: nur die letzte Position, nur im Speicher.
 */
class OrtungsDienst : Service() {
    private val hauptfaden = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val plan = Sendeplan()
    private var verbindung: Serververbindung? = null
    private var einsatz = ""
    private var ziel = ""
    private var ortet = false

    private val zuhoerer = object : LocationListener {
        override fun onLocationChanged(location: Location) = messung(location)

        // Bis Android 10 sind diese Methoden abstrakt; ohne sie bräche der Aufruf des Systems ab.
        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit

        @Deprecated("Vom System bis Android 10 gerufen.")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    private val lebenszeichen = object : Runnable {
        override fun run() {
            plan.lebenszeichen(Instant.now())?.let(::sende)
            hauptfaden.postDelayed(this, PRUEFUNG_MS)
        }
    }

    private val versuch = Runnable { plan.versuch(Instant.now())?.let(::sende) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val aktion = intent?.action
        when {
            aktion == AKTION_PAUSIEREN -> pausieren()
            intent != null && aktion == AKTION_START -> starte(intent)
            // Ohne Auftrag (etwa ein Neustart durch das System) ortet der Dienst nicht.
            else -> beenden()
        }
        return Service.START_NOT_STICKY
    }

    override fun onDestroy() {
        stoppeOrtung()
        scope.cancel()
        super.onDestroy()
    }

    // Start und Stopp

    private fun starte(intent: Intent) {
        einsatz = intent.getStringExtra(EXTRA_EINSATZ).orEmpty()
        ziel = intent.getStringExtra(EXTRA_ZIEL).orEmpty()
        // Erst in den Vordergrund (das System verlangt es binnen Sekunden nach dem Start), dann prüfen.
        legeKanalAn()
        try {
            startForeground(BENACHRICHTIGUNG, benachrichtigung(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: RuntimeException) {
            // Ohne Standortrecht oder aus dem Hintergrund lässt das System den Dienst nicht zu.
            Log.w(TAG, "Vordergrund-Dienst abgelehnt", e)
            beenden()
            return
        }
        val sitzung = Sitzungsablage(this).lesen()
        if (sitzung == null) {
            beenden()
            return
        }
        if (ortet && verbindung?.server == sitzung.server) return
        verbindung = Serververbindung(sitzung.server, sitzung.cookie, kennung(this))
        if (!fordereOrteAn()) {
            beenden()
            return
        }
        ortet = true
        Ortungsstand.laeuft.value = true
        hauptfaden.postDelayed(lebenszeichen, PRUEFUNG_MS)
    }

    /** Fordert Positionen an; `false` ohne Recht oder ohne Anbieter. */
    @SuppressLint("MissingPermission")
    private fun fordereOrteAn(): Boolean {
        val erlaubt = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        if (!erlaubt) return false
        val manager = getSystemService(LocationManager::class.java) ?: return false
        val anbieter = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER)) {
            listOf(LocationManager.FUSED_PROVIDER)
        } else {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { it in manager.allProviders }
        }
        if (anbieter.isEmpty()) return false
        for (name in anbieter) {
            manager.requestLocationUpdates(name, MINDESTABSTAND_MS, BEWEGUNG_M, zuhoerer, Looper.getMainLooper())
        }
        return true
    }

    private fun stoppeOrtung() {
        if (ortet) getSystemService(LocationManager::class.java)?.removeUpdates(zuhoerer)
        hauptfaden.removeCallbacks(lebenszeichen)
        hauptfaden.removeCallbacks(versuch)
        plan.stoppe()
        ortet = false
        Ortungsstand.laeuft.value = false
        Ortungsstand.naechsterVersuch.value = null
    }

    /** Ortung aus, Benachrichtigung weg, Dienst zu. */
    private fun beenden() {
        stoppeOrtung()
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * „Pausieren“ aus der Benachrichtigung: die Ortung hört sofort auf, der Server erfährt es mit
     * `paused: true`. Erreicht ihn das nicht, holt die App es bei der nächsten Abfrage nach.
     */
    private fun pausieren() {
        val v = verbindung
        stoppeOrtung()
        Ortungsstand.pausiert.tryEmit(Unit)
        if (v == null) {
            beenden()
            return
        }
        scope.launch {
            withContext(Dispatchers.IO) { v.pausiere(true) }
            beenden()
        }
    }

    // Takt und Senden (Sendeplan im Kern)

    private fun messung(location: Location) {
        if (!ortet) return
        val position = Position(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            recordedAt = Instant.ofEpochMilli(location.time),
        )
        plan.messung(position, Instant.now())?.let(::sende)
    }

    private fun sende(position: Position) {
        val v = verbindung ?: return
        scope.launch {
            val rueckmeldung = withContext(Dispatchers.IO) { v.sende(position) }
            if (ortet) verarbeite(rueckmeldung.antwort)
        }
    }

    private fun verarbeite(antwort: Antwort) {
        val jetzt = Instant.now()
        val naechste = plan.antwort(antwort, jetzt)
        when (antwort) {
            Antwort.WEITER -> {
                Ortungsstand.letzteSendung.value = jetzt
                Ortungsstand.naechsterVersuch.value = null
            }
            Antwort.WARTEN -> Ortungsstand.naechsterVersuch.value = null
            Antwort.WIEDERHOLEN -> plan.naechsterVersuch?.let { zeit ->
                Ortungsstand.naechsterVersuch.value = zeit
                hauptfaden.removeCallbacks(versuch)
                hauptfaden.postDelayed(versuch, maxOf(0L, Duration.between(jetzt, zeit).toMillis()))
            }
            Antwort.VERWERFEN -> Unit
            Antwort.STOPPEN -> Unit
        }
        Ortungsstand.antworten.tryEmit(antwort)
        if (antwort == Antwort.STOPPEN) {
            beenden()
            return
        }
        aktualisiereBenachrichtigung()
        naechste?.let(::sende)
    }

    // Benachrichtigung

    private fun legeKanalAn() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val kanal = NotificationChannel(KANAL, "Ortung", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Zeigt, solange Lifeline Helfer deine Position an die Einsatzleitung sendet."
            setShowBadge(false)
        }
        manager.createNotificationChannel(kanal)
    }

    private fun aktualisiereBenachrichtigung() {
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        ) {
            return
        }
        getSystemService(NotificationManager::class.java)?.notify(BENACHRICHTIGUNG, benachrichtigung())
    }

    private fun benachrichtigung(): Notification {
        val oeffnen = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val pausieren = PendingIntent.getService(
            this, 1,
            Intent(this, OrtungsDienst::class.java).setAction(AKTION_PAUSIEREN),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val titel = if (einsatz.isEmpty()) "Lifeline ortet dich" else "Lifeline ortet dich für Einsatz $einsatz"
        val zeile = buildList {
            if (ziel.isNotEmpty()) add("Ziel: $ziel")
            val versuch = Ortungsstand.naechsterVersuch.value
            val letzte = Ortungsstand.letzteSendung.value
            when {
                versuch != null -> add("ohne Netz, neuer Versuch gleich")
                letzte != null -> add("gesendet ${Anzeige.alter(Duration.between(letzte, Instant.now()).seconds)}")
            }
        }.joinToString(" · ")
        val builder = Notification.Builder(this, KANAL)
            .setSmallIcon(R.drawable.symbol_ortung)
            .setContentTitle(titel)
            .setContentText(zeile)
            .setStyle(Notification.BigTextStyle().bigText(zeile))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(oeffnen)
            .addAction(
                Notification.Action.Builder(Icon.createWithResource(this, R.drawable.symbol_pause), "Pausieren", pausieren)
                    .build(),
            )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            builder.setCategory(Notification.CATEGORY_LOCATION_SHARING)
        }
        // Ab Android 16: als Live-Update in Statusleiste und Sperrbildschirm (Spec „Gestalt“).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            builder.setRequestPromotedOngoing(true)
            builder.setShortCriticalText("Ortung")
        }
        return builder.build()
    }

    companion object {
        private const val TAG = "LifelineHelfer"
        private const val KANAL = "ortung"
        private const val BENACHRICHTIGUNG = 1
        private const val AKTION_START = "dev.rubeen.lifeline.helfer.ORTUNG_STARTEN"
        private const val AKTION_PAUSIEREN = "dev.rubeen.lifeline.helfer.ORTUNG_PAUSIEREN"
        private const val EXTRA_EINSATZ = "einsatz"
        private const val EXTRA_ZIEL = "ziel"

        /** Takt des Systems: höchstens alle 30 s, ab 25 m (die Entscheidung trifft der Sendeplan). */
        private const val MINDESTABSTAND_MS = 30_000L
        private const val BEWEGUNG_M = 25f

        /** Prüfung auf ein Lebenszeichen jede halbe Minute (fällig nach 300 s, `Takt`). */
        private const val PRUEFUNG_MS = 30_000L

        /**
         * Startet die Ortung; nur aus der geöffneten App (ADR-0098). `false`, wenn das System den
         * Dienst nicht zulässt.
         */
        fun starte(context: Context, einsatz: String, ziel: String): Boolean = try {
            context.startForegroundService(
                Intent(context, OrtungsDienst::class.java)
                    .setAction(AKTION_START)
                    .putExtra(EXTRA_EINSATZ, einsatz)
                    .putExtra(EXTRA_ZIEL, ziel),
            )
            // Sofort sichtbar; lässt das System den Dienst doch nicht zu, setzt er es zurück.
            Ortungsstand.laeuft.value = true
            true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Ortungsdienst nicht gestartet", e)
            false
        }

        /** Stoppt die Ortung (Abmelden, Pausieren in der App, Ende der Kopplung). */
        fun stoppe(context: Context) {
            context.stopService(Intent(context, OrtungsDienst::class.java))
            Ortungsstand.laeuft.value = false
            Ortungsstand.naechsterVersuch.value = null
        }

        /** Eigene Kennung und Version, damit der Server die Helfer-App erkennt. */
        fun kennung(context: Context): String {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            return "LifelineHelfer/${info.versionName ?: "0"} (${info.longVersionCode}; Android)"
        }
    }
}
