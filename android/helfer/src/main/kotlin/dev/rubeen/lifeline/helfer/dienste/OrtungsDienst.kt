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
import android.os.CancellationSignal
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import dev.rubeen.lifeline.helfer.MainActivity
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helferkern.Antwort
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Dienstanzeige
import dev.rubeen.lifeline.helferkern.Dienstumfang
import dev.rubeen.lifeline.helferkern.Empfang
import dev.rubeen.lifeline.helferkern.LiveEreignis
import dev.rubeen.lifeline.helferkern.Ortungslage
import dev.rubeen.lifeline.helferkern.Position
import dev.rubeen.lifeline.helferkern.Sendeplan
import dev.rubeen.lifeline.helferkern.SseLeser
import dev.rubeen.lifeline.helferkern.Wiederverbindung
import dev.rubeen.lifeline.helferkern.Wire
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Was die App dem Helfer-Dienst vorgibt (aus der Phase der `Anmeldung`): ob er orten soll, ob er
 * Aufträge empfängt und wie die Ortung steht. Ob `location` wirklich dazukommt, entscheiden Recht
 * und System ([Dienstumfang]).
 */
data class Dienstvorgabe(
    val einsatzId: Long,
    val einsatz: String,
    val ziel: String,
    val orten: Boolean,
    val empfangen: Boolean,
    val lage: Ortungslage,
    val imVordergrund: Boolean,
)

/**
 * Der Helfer-Dienst (ADR-0101, ADR-0105): ortet und empfängt Aufträge, mit **einer**
 * Benachrichtigung; die einzige Stelle, die im Hintergrund sendet und empfängt.
 *
 * - Ein Vordergrund-Dienst vom Typ `location|remoteMessaging`, gestartet nur aus der geöffneten App
 *   ([starte]), beim Einlösen immer: ohne Ortung (Recht fehlt, Pause, Ruhe, keine Rolle) allein mit
 *   `remoteMessaging`. `location` nimmt er nur auf, wo Android es zulässt; sonst sagt die
 *   Benachrichtigung „Ortung wartet — App öffnen“. `START_NOT_STICKY`, nach dem Ende des Prozesses
 *   startet er nicht von selbst wieder; kein FCM.
 * - Empfang ab `aktiv`: hält `GET /api/incidents/{id}/live` auf IO offen; Zeilen liest der
 *   [SseLeser], wann neu verbunden wird, entscheidet [Empfang]. Auf `helfer_auftrag` und nach jedem
 *   Verbinden lädt er die Liste; Mitteilungen nach `Auftraege.sollMitteilen` ([Auftragsstand]).
 * - Positionen vom `LocationManager` des Systems (der Fused Provider des Systems, wo es ihn gibt,
 *   sonst GPS und Netz, bei nur ungefährem Standort allein das Netz), weil die App ohne
 *   Play-Dienste verteilt wird: höchstens alle 30 s, ab 25 m Bewegung, dazu jede halbe Minute die
 *   Prüfung, ob ein Lebenszeichen fällig ist (dann eine frische Messung, nie eine alte neu datiert).
 * - Was gesendet wird und wann, entscheidet der [Sendeplan] im Kern; hier stehen nur Uhr, Netz und
 *   System. Kein Verlauf: nur die letzte Position, nur im Speicher; Aufträge nie auf die Platte.
 */
class OrtungsDienst : Service() {
    private val hauptfaden = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val plan = Sendeplan()

    @Volatile
    private var verbindung: Serververbindung? = null

    /** Die Sitzung (Server und Cookie), mit der der Dienst gerade sendet und empfängt. */
    private var aktiveSitzung: Sitzung? = null

    @Volatile
    private var einsatz = ""

    @Volatile
    private var ziel = ""

    @Volatile
    private var ortet = false

    @Volatile
    private var lage = Ortungslage.AUS

    /** Ob die Leitung bestätigt hat; vorher fragt der Empfang nur den Zustand ab. */
    @Volatile
    private var bestaetigt = false

    /** Vom Hauptfaden gesetzt, von der Schleife des Empfangs (IO) gelesen. */
    @Volatile
    private var einsatzId = 0L
    private var empfang: Job? = null

    /**
     * Ein Zuhörer je Anbieter: das System ersetzt die Anmeldung eines Zuhörers, der schon für einen
     * anderen Anbieter angemeldet ist. Ohne Messung (Anbieter aus, Recht entzogen) geht nichts raus.
     */
    private fun neuerZuhoerer(): LocationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) = messung(location)

        // Bis Android 10 sind diese Methoden abstrakt; ohne sie bräche der Aufruf des Systems ab.
        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit

        @Deprecated("Vom System bis Android 10 gerufen.")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    /** Laufende Anforderungen im Takt (je Anbieter ein Zuhörer). */
    private val zuhoerer = mutableListOf<LocationListener>()

    /** Die Anforderung einer frischen Messung für das Lebenszeichen: ab API 30 abbrechbar, davor Zuhörer. */
    private val einzelAbbrueche = mutableListOf<CancellationSignal>()
    private val einzelZuhoerer = mutableListOf<LocationListener>()
    private val einzelEnde = Runnable { beendeEinzelanforderung() }

    /**
     * Lebenszeichen ([Sendeplan.lebenszeichen]): ist eines fällig, fordert der Dienst **eine** frische
     * Messung an; sie geht mit ihrer eigenen Zeit über [messung] raus. Eine alte Position mit neuer
     * Zeit sendet er nie: kommt keine Messung, zeigt die Karte die Position ehrlich als veraltet.
     */
    private val lebenszeichen = object : Runnable {
        override fun run() {
            if (plan.lebenszeichen(Instant.now())) fordereMessungAn()
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
            // Ohne Auftrag (etwa ein Neustart durch das System) läuft der Dienst nicht.
            else -> beenden()
        }
        return Service.START_NOT_STICKY
    }

    override fun onDestroy() {
        stoppeOrtung()
        stoppeEmpfang()
        Ortungsstand.dienstLaeuft.value = false
        scope.cancel()
        super.onDestroy()
    }

    // Start, Typwechsel und Stopp

    private fun starte(intent: Intent) {
        einsatz = intent.getStringExtra(EXTRA_EINSATZ).orEmpty()
        ziel = intent.getStringExtra(EXTRA_ZIEL).orEmpty()
        val orten = intent.getBooleanExtra(EXTRA_ORTEN, false)
        val empfangen = intent.getBooleanExtra(EXTRA_EMPFANGEN, false)
        val neueEinsatzId = intent.getLongExtra(EXTRA_EINSATZ_ID, 0L)
        val vorgabe = intent.getStringExtra(EXTRA_LAGE)?.let { name -> Ortungslage.entries.firstOrNull { it.name == name } }
        lage = vorgabe ?: Ortungslage.AUS
        legeKanalAn()
        // Erst in den Vordergrund (das System verlangt es binnen Sekunden nach dem Start), dann prüfen.
        val umfang = Dienstumfang.fuer(orten, isStandortErlaubt())
        if (!inDenVordergrund(umfang)) {
            if (umfang == Dienstumfang.NUR_EMPFANG || !inDenVordergrund(Dienstumfang.NUR_EMPFANG)) {
                // Das System lässt den Dienst gar nicht zu (etwa aus dem Hintergrund).
                beenden()
                return
            }
            // `location` nicht erlaubt (aus dem Hintergrund): weiter empfangen, Ortung wartet auf die App.
            stoppeOrtung()
            lage = Ortungslage.WARTET
            aktualisiereBenachrichtigung()
        }
        Ortungsstand.dienstLaeuft.value = true
        val sitzung = Sitzungsablage(this).lesen()
        if (sitzung == null) {
            beenden()
            return
        }
        if (sitzung != aktiveSitzung) {
            // Inzwischen neu eingelöst: nie mit dem alten Cookie weiter senden oder empfangen.
            stoppeOrtung()
            stoppeEmpfang()
            bestaetigt = false
            aktiveSitzung = sitzung
            verbindung = Serververbindung(sitzung.server, sitzung.cookie, kennung(this))
        }
        if (umfang == Dienstumfang.ORTUNG_UND_EMPFANG && lage != Ortungslage.WARTET) {
            if (!ortet) {
                if (fordereOrteAn()) {
                    ortet = true
                    Ortungsstand.laeuft.value = true
                    hauptfaden.postDelayed(lebenszeichen, PRUEFUNG_MS)
                } else {
                    // Kein Anbieter oder das Recht fehlt doch: nur empfangen.
                    lage = Ortungslage.AUS
                    inDenVordergrund(Dienstumfang.NUR_EMPFANG)
                }
            }
        } else {
            stoppeOrtung()
        }
        if (orten && ortet) lage = Ortungslage.AN
        if (!ortet && lage == Ortungslage.AN) lage = Ortungslage.AUS
        if (empfangen) bestaetigt = true
        if (neueEinsatzId != 0L && neueEinsatzId != einsatzId) {
            stoppeEmpfang()
            einsatzId = neueEinsatzId
        }
        starteEmpfang()
        aktualisiereBenachrichtigung()
    }

    /**
     * Setzt die Typen des Vordergrund-Dienstes; ein laufender Dienst wechselt sie mit einem
     * erneuten `startForeground`. `false`, wenn das System den Typ nicht zulässt (`location` aus dem
     * Hintergrund, kein Standortrecht).
     */
    @SuppressLint("InlinedApi") // `REMOTE_MESSAGING` ist eine Konstante; ältere Systeme kennen den Typ nur aus dem Manifest.
    private fun inDenVordergrund(umfang: Dienstumfang): Boolean {
        val typen = when (umfang) {
            Dienstumfang.ORTUNG_UND_EMPFANG ->
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            Dienstumfang.NUR_EMPFANG -> ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
        }
        return try {
            startForeground(BENACHRICHTIGUNG, benachrichtigung(), typen)
            true
        } catch (e: RuntimeException) {
            // Auch `SecurityException` und `ForegroundServiceStartNotAllowedException`.
            Log.w(TAG, "Vordergrund-Dienst mit $umfang abgelehnt", e)
            false
        }
    }

    private fun isStandortErlaubt(): Boolean =
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }


    /**
     * Anbieter, die das Recht hergibt: der Fused Provider des Systems (ab Android 12, nimmt auch nur
     * „ungefähr“), sonst GPS und Netz bei genauem Standort, bei nur ungefährem allein das Netz (GPS
     * würfe dort eine `SecurityException`). Leer ohne Recht.
     */
    private fun anbieter(manager: LocationManager): List<String> {
        val fein = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val grob = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fein && !grob) return emptyList()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.hasProvider(LocationManager.FUSED_PROVIDER)) {
            return listOf(LocationManager.FUSED_PROVIDER)
        }
        val moeglich = if (fein) {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        } else {
            listOf(LocationManager.NETWORK_PROVIDER)
        }
        return moeglich.filter { it in manager.allProviders }
    }

    /** Fordert Positionen an; `false` ohne Recht, ohne Anbieter oder wenn das System ablehnt. */
    @SuppressLint("MissingPermission")
    private fun fordereOrteAn(): Boolean {
        val manager = getSystemService(LocationManager::class.java) ?: return false
        for (name in anbieter(manager)) {
            val z = neuerZuhoerer()
            try {
                manager.requestLocationUpdates(name, MINDESTABSTAND_MS, BEWEGUNG_M, z, Looper.getMainLooper())
                zuhoerer += z
            } catch (e: SecurityException) {
                Log.w(TAG, "Anbieter $name ohne Recht", e)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Anbieter $name fehlt", e)
            }
        }
        return zuhoerer.isNotEmpty()
    }

    /**
     * Eine frische Messung für das Lebenszeichen: ab Android 11 `getCurrentLocation`, davor
     * `requestSingleUpdate`; nach [Sendeplan.LEBENSZEICHEN_FRIST_S] bricht der Dienst ab.
     */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION") // `requestSingleUpdate` vor Android 11, dort ohne Nachfolger.
    private fun fordereMessungAn() {
        val manager = getSystemService(LocationManager::class.java) ?: return
        beendeEinzelanforderung()
        for (name in anbieter(manager)) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // Je Anforderung ein eigenes Signal: ein Signal hält nur einen Abbruch.
                    val abbruch = CancellationSignal()
                    manager.getCurrentLocation(name, abbruch, mainExecutor) { location ->
                        if (location != null) messung(location)
                    }
                    einzelAbbrueche += abbruch
                } else {
                    val z = neuerZuhoerer()
                    manager.requestSingleUpdate(name, z, Looper.getMainLooper())
                    einzelZuhoerer += z
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "Lebenszeichen: Anbieter $name ohne Recht", e)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Lebenszeichen: Anbieter $name fehlt", e)
            }
        }
        hauptfaden.postDelayed(einzelEnde, (Sendeplan.LEBENSZEICHEN_FRIST_S * 1_000).toLong())
    }

    private fun beendeEinzelanforderung() {
        hauptfaden.removeCallbacks(einzelEnde)
        einzelAbbrueche.forEach { it.cancel() }
        einzelAbbrueche.clear()
        val manager = getSystemService(LocationManager::class.java)
        einzelZuhoerer.forEach { manager?.removeUpdates(it) }
        einzelZuhoerer.clear()
    }


    /** Ortung aus; der Dienst selbst läuft weiter, solange er empfängt. */
    private fun stoppeOrtung() {
        val manager = getSystemService(LocationManager::class.java)
        zuhoerer.forEach { manager?.removeUpdates(it) }
        zuhoerer.clear()
        beendeEinzelanforderung()
        hauptfaden.removeCallbacks(lebenszeichen)
        hauptfaden.removeCallbacks(versuch)
        plan.stoppe()
        ortet = false
        Ortungsstand.laeuft.value = false
        Ortungsstand.naechsterVersuch.value = null
    }

    /**
     * Ortung aus und weiter empfangen (Pause, Ruhe): nur noch mit dem Typ `remoteMessaging`, die
     * Benachrichtigung sagt es.
     */
    private fun nurEmpfangen(neueLage: Ortungslage) {
        stoppeOrtung()
        lage = neueLage
        if (!inDenVordergrund(Dienstumfang.NUR_EMPFANG)) aktualisiereBenachrichtigung()
    }

    /** Ortung und Empfang aus, Benachrichtigung weg, Dienst zu (Ende der Kopplung, Abmelden). */
    private fun beenden() {
        stoppeOrtung()
        stoppeEmpfang()
        Ortungsstand.dienstLaeuft.value = false
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * „Pausieren“ aus der Benachrichtigung: die Ortung hört sofort auf, der Server erfährt es mit
     * `paused: true`; der Empfang läuft weiter. Erreicht den Server die Pause nicht, holt die App es
     * bei der nächsten Abfrage nach.
     */
    private fun pausieren() {
        val v = verbindung
        nurEmpfangen(Ortungslage.PAUSIERT)
        Ortungsstand.pausiert.tryEmit(Unit)
        if (v == null) {
            beenden()
            return
        }
        scope.launch { withContext(Dispatchers.IO) { v.pausiere(true) } }
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
            if (ortet) verarbeite(rueckmeldung.antwort, rueckmeldung.grund)
        }
    }

    private fun verarbeite(antwort: Antwort, grund: String?) {
        val jetzt = Instant.now()
        val naechste = plan.antwort(antwort, jetzt)
        when (antwort) {
            Antwort.WEITER -> {
                Ortungsstand.letzteSendung.value = jetzt
                Ortungsstand.naechsterVersuch.value = null
                // Eine angenommene Sendung heißt: die Leitung hat bestätigt.
                if (!bestaetigt) {
                    bestaetigt = true
                    starteEmpfang()
                }
            }
            Antwort.WARTEN -> Ortungsstand.naechsterVersuch.value = null
            Antwort.WIEDERHOLEN -> plan.naechsterVersuch?.let { zeit ->
                Ortungsstand.naechsterVersuch.value = zeit
                hauptfaden.removeCallbacks(versuch)
                hauptfaden.postDelayed(versuch, maxOf(0L, Duration.between(jetzt, zeit).toMillis()))
            }
            Antwort.VERWERFEN, Antwort.STOPPEN, Antwort.RUHEN -> Unit
        }
        // Das Modell entscheidet mit dem Grund, ob die Kopplung endet oder ruht (`Anmeldung`).
        Ortungsstand.antworten.tryEmit(Entscheidung(antwort, grund))
        when (antwort) {
            Antwort.STOPPEN -> {
                beenden()
                return
            }
            // Ruhen: die Ortung ruht, die Kopplung besteht, der Empfang läuft weiter.
            Antwort.RUHEN -> {
                nurEmpfangen(Ortungslage.RUHT)
                return
            }
            else -> Unit
        }
        aktualisiereBenachrichtigung()
        naechste?.let(::sende)
    }

    // Empfang (Livestrom und Empfang im Kern)

    /**
     * Hält den Live-Strom offen, auf IO: vor der Bestätigung prüft er nur den Zustand; danach
     * verbindet er, lädt nach jedem Verbinden einmal die Liste und auf jedes `helfer_auftrag`
     * erneut. Nach einem Abbruch wartet er nach [Empfang.nachAbbruch]; 401, 403 und 404 beenden die
     * Kopplung.
     */
    private fun starteEmpfang() {
        if (empfang?.isActive == true) return
        val v = verbindung ?: return
        empfang = scope.launch(Dispatchers.IO) {
            val folge = Wiederverbindung()
            while (isActive) {
                if (!bestaetigt) {
                    if (!pruefeBestaetigung(v)) {
                        delay(PRUEFUNG_UNBESTAETIGT_MS)
                        continue
                    }
                }
                val id = einsatzId
                if (id == 0L) {
                    // Ohne Einsatz kein Strom; die App nennt ihn mit dem nächsten Start.
                    delay(PRUEFUNG_UNBESTAETIGT_MS)
                    continue
                }
                val leser = SseLeser()
                val status = v.live(
                    id,
                    offen = {
                        setzeVerbunden(true)
                        ladeAuftraege(v)
                    },
                ) { zeile ->
                    // Erst eine Zeile zeigt, dass die Verbindung trägt (`Wiederverbindung`).
                    folge.daten()
                    if (leser.zeile(zeile) is LiveEreignis.Auftrag) ladeAuftraege(v)
                }
                setzeVerbunden(false)
                if (!isActive) break
                if (Empfang.nachAntwort(status) == Empfang.Entscheidung.ENDEN) {
                    withContext(Dispatchers.Main) {
                        Ortungsstand.antworten.tryEmit(Entscheidung(Antwort.STOPPEN, null))
                        beenden()
                    }
                    break
                }
                delay(folge.abbruch())
            }
        }
    }

    private fun stoppeEmpfang() {
        empfang?.cancel()
        empfang = null
        verbindung?.trenneLive()
        setzeVerbunden(false)
    }

    /**
     * Vor der Bestätigung: der eigene Zustand. `true` ab `aktiv`; endet die Kopplung (401, 403, 404,
     * `beendet`, `abgelehnt`), endet der Dienst, und das Modell erfährt es.
     */
    private suspend fun pruefeBestaetigung(v: Serververbindung): Boolean {
        val rueckmeldung = v.zustand()
        val zustand = if (rueckmeldung.isErfolg) Wire.zustand(rueckmeldung.text) else null
        if (zustand == null) {
            if (rueckmeldung.antwort == Antwort.STOPPEN) {
                withContext(Dispatchers.Main) {
                    Ortungsstand.antworten.tryEmit(Entscheidung(Antwort.STOPPEN, rueckmeldung.grund))
                    beenden()
                }
            }
            return false
        }
        if (zustand.state == "beendet" || zustand.state == "abgelehnt") {
            withContext(Dispatchers.Main) { beenden() }
            return false
        }
        if (zustand.state != "aktiv") return false
        bestaetigt = true
        if (einsatzId == 0L) einsatzId = zustand.incident.id
        aktualisiereBenachrichtigung()
        return true
    }

    /** Liste laden und Mitteilungen zeigen; blockiert (auf IO). */
    private fun ladeAuftraege(v: Serververbindung) {
        val rueckmeldung = v.auftraege()
        val liste = if (rueckmeldung.isErfolg) Wire.auftraege(rueckmeldung.text) else null
        liste?.let { Auftragsstand.uebernimm(this, it) }
    }

    private fun setzeVerbunden(verbunden: Boolean) {
        if (Auftragsstand.verbunden.value == verbunden) return
        Auftragsstand.verbunden.value = verbunden
        if (Ortungsstand.dienstLaeuft.value) aktualisiereBenachrichtigung()
    }

    // Benachrichtigung

    private fun legeKanalAn() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val kanal = NotificationChannel(KANAL, "Ortung und Empfang", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Zeigt, solange Lifeline Helfer Aufträge empfängt und deine Position an die Einsatzleitung sendet."
            setShowBadge(false)
        }
        manager.createNotificationChannel(kanal)
        Mitteilungen.legeKanalAn(this)
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
        val titel = when {
            ortet && einsatz.isNotEmpty() -> "Lifeline ortet dich für Einsatz $einsatz"
            ortet -> "Lifeline ortet dich"
            einsatz.isNotEmpty() -> "Lifeline Helfer für Einsatz $einsatz"
            else -> "Lifeline Helfer"
        }
        val zeile = buildList {
            add(Dienstanzeige.zeile(lage, Auftragsstand.verbunden.value, bestaetigt))
            if (ziel.isNotEmpty()) add("Ziel: $ziel")
            if (ortet) {
                val versuch = Ortungsstand.naechsterVersuch.value
                val letzte = Ortungsstand.letzteSendung.value
                when {
                    versuch != null -> add("ohne Netz, neuer Versuch gleich")
                    letzte != null -> add("gesendet ${Anzeige.alter(Duration.between(letzte, Instant.now()).seconds)}")
                }
            }
        }.joinToString(" · ")
        val builder = Notification.Builder(this, KANAL)
            .setSmallIcon(if (ortet) R.drawable.symbol_ortung else R.drawable.symbol_auftrag)
            .setContentTitle(titel)
            .setContentText(zeile)
            .setStyle(Notification.BigTextStyle().bigText(zeile))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(oeffnen)
        if (ortet) {
            val pausieren = PendingIntent.getService(
                this, 1,
                Intent(this, OrtungsDienst::class.java).setAction(AKTION_PAUSIEREN),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(
                Notification.Action.Builder(Icon.createWithResource(this, R.drawable.symbol_pause), "Pausieren", pausieren)
                    .build(),
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            builder.setCategory(if (ortet) Notification.CATEGORY_LOCATION_SHARING else Notification.CATEGORY_SERVICE)
        }
        // Ab Android 16: als Live-Update in Statusleiste und Sperrbildschirm (Spec „Gestalt“).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            builder.setRequestPromotedOngoing(true)
            builder.setShortCriticalText(if (ortet) "Ortung" else "Empfang")
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
        private const val EXTRA_EINSATZ_ID = "einsatz_id"
        private const val EXTRA_ZIEL = "ziel"
        private const val EXTRA_ORTEN = "orten"
        private const val EXTRA_EMPFANGEN = "empfangen"
        private const val EXTRA_LAGE = "lage"

        /** Takt des Systems: höchstens alle 30 s, ab 25 m (die Entscheidung trifft der Sendeplan). */
        private const val MINDESTABSTAND_MS = 30_000L
        private const val BEWEGUNG_M = 25f

        /** Prüfung auf ein Lebenszeichen jede halbe Minute (fällig nach 300 s, `Takt`). */
        private const val PRUEFUNG_MS = 30_000L

        /** Vor der Bestätigung fragt der Empfang alle 30 s den Zustand ab. */
        private const val PRUEFUNG_UNBESTAETIGT_MS = 30_000L

        /**
         * Startet den Dienst oder gibt dem laufenden eine neue [vorgabe]. Gestartet wird er nur aus
         * der geöffneten App (ADR-0101, ADR-0105); aus dem Hintergrund erreicht die Vorgabe nur einen
         * Dienst, der schon läuft. `false`, wenn das System den Dienst nicht zulässt.
         */
        fun starte(context: Context, vorgabe: Dienstvorgabe): Boolean {
            if (!vorgabe.imVordergrund && !Ortungsstand.dienstLaeuft.value) return false
            val intent = Intent(context, OrtungsDienst::class.java)
                .setAction(AKTION_START)
                .putExtra(EXTRA_EINSATZ, vorgabe.einsatz)
                .putExtra(EXTRA_EINSATZ_ID, vorgabe.einsatzId)
                .putExtra(EXTRA_ZIEL, vorgabe.ziel)
                .putExtra(EXTRA_ORTEN, vorgabe.orten)
                .putExtra(EXTRA_EMPFANGEN, vorgabe.empfangen)
                .putExtra(EXTRA_LAGE, vorgabe.lage.name)
            return try {
                if (vorgabe.imVordergrund) context.startForegroundService(intent) else context.startService(intent)
                Ortungsstand.dienstLaeuft.value = true
                true
            } catch (e: RuntimeException) {
                Log.w(TAG, "Helfer-Dienst nicht gestartet", e)
                false
            }
        }

        /** Beendet Ortung und Empfang (Abmelden, Ende der Kopplung). */
        fun stoppe(context: Context) {
            context.stopService(Intent(context, OrtungsDienst::class.java))
            Ortungsstand.dienstLaeuft.value = false
            Ortungsstand.laeuft.value = false
            Ortungsstand.naechsterVersuch.value = null
            Auftragsstand.verbunden.value = false
        }

        /** Eigene Kennung und Version, damit der Server die Helfer-App erkennt. */
        fun kennung(context: Context): String {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            return "LifelineHelfer/${info.versionName ?: "0"} (${info.longVersionCode}; Android)"
        }
    }
}
