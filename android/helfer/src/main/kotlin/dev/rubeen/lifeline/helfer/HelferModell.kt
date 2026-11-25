package dev.rubeen.lifeline.helfer

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.rubeen.lifeline.helfer.dienste.Dienste
import dev.rubeen.lifeline.helfer.dienste.Entscheidung
import dev.rubeen.lifeline.helfer.dienste.Ortungsstand
import dev.rubeen.lifeline.helfer.dienste.Rueckmeldung
import dev.rubeen.lifeline.helfer.dienste.Serververbindung
import dev.rubeen.lifeline.helfer.dienste.Sitzung
import dev.rubeen.lifeline.helferkern.Antwort
import dev.rubeen.lifeline.helferkern.Anmeldung
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Einloesung
import dev.rubeen.lifeline.helferkern.Ereignis
import dev.rubeen.lifeline.helferkern.Grund
import dev.rubeen.lifeline.helferkern.HelferZiel
import dev.rubeen.lifeline.helferkern.Phase
import dev.rubeen.lifeline.helferkern.Rolle
import dev.rubeen.lifeline.helferkern.Ruhegrund
import dev.rubeen.lifeline.helferkern.Testzustand
import dev.rubeen.lifeline.helferkern.Wire
import dev.rubeen.lifeline.helferkern.ZielOption
import dev.rubeen.lifeline.helferkern.Zielliste
import dev.rubeen.lifeline.helferkern.Zustand
import dev.rubeen.lifeline.helferkern.deuteHelferLink
import dev.rubeen.lifeline.kern.ServerAdresse
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Verbindung zum Server, wie die Seite „Angemeldet“ sie zeigt. */
enum class Verbindungsstand {
    /** Noch keine Antwort auf eine Sendung. */
    UNBEKANNT,

    /** Die letzte Sendung kam an. */
    VERBUNDEN,

    /** Kein Netz oder der Server antwortet nicht; nächster Versuch zu [HelferModell.naechsterVersuch]. */
    WIEDERHOLT,
}

/**
 * Das Modell der Helfer-App: hält die eine [Anmeldung] (Zustandsautomat im Kern) und führt ihre
 * Wirkungen aus: Server, Ablage, Ortung. Welche Phase gilt, entscheidet allein
 * [Anmeldung.verarbeite]; die Seiten zeigen nur [phase]. Gegenstück zu
 * `ios/Helfer/App/Modell/HelferModell.swift`, mit denselben Texten und Wegen.
 *
 * Ohne [dienste] (Tests und Testzustand) fragt es kein Netz, speichert nichts und ortet nicht.
 */
class HelferModell(private val dienste: Dienste?) : ViewModel() {
    private var anmeldung = Anmeldung()

    var phase: Phase by mutableStateOf(anmeldung.phase)
        private set

    /** Server und Code der gelesenen Einladung; nach einem Neustart der App unbekannt. */
    var einladung: HelferZiel? by mutableStateOf(null)
        private set
    var zielliste: Zielliste? by mutableStateOf(null)
        private set
    var zieleLaden by mutableStateOf(false)
        private set

    /** Eigener Zustand vom Server (Einsatz, Ziel, Person, Ablauf). */
    var zustand: Zustand? by mutableStateOf(null)
        private set
    var letzteSendung: Instant? by mutableStateOf(null)
        private set
    var verbindungsstand by mutableStateOf(Verbindungsstand.UNBEKANNT)
        private set
    var naechsterVersuch: Instant? by mutableStateOf(null)
        private set

    /** Eine Anfrage, auf die eine Seite wartet (Knöpfe gesperrt). */
    var beschaeftigt by mutableStateOf(false)
        private set

    /** Ob der Ortungsdienst gerade läuft. */
    var ortungLaeuft by mutableStateOf(false)
        private set
    var ortungVerweigert by mutableStateOf(false)
        private set

    /** Zählt jede Bestätigung durch die Leitung (Haptik der Seite). */
    var bestaetigungen by mutableIntStateOf(0)
        private set

    /** Uhr der Seite „Angemeldet“ (Alter der letzten Sendung); läuft nur im Vordergrund. */
    var jetzt: Instant by mutableStateOf(Instant.now())
        private set

    /** Fehlermeldung für die aktuelle Seite. */
    var meldung: String? by mutableStateOf(null)

    /** Ein neuer Scan während einer Anmeldung; die Seite fragt, ob die alte enden soll. */
    var ausstehenderScan: HelferZiel? by mutableStateOf(null)

    /** Anzeigename, vorbelegt mit dem zuletzt genutzten. */
    var anzeigename by mutableStateOf(dienste?.anzeigename.orEmpty())
    var gewaehltesZiel: ZielOption? by mutableStateOf(null)
    var personOrten by mutableStateOf(false)

    /** Ob das Modell echte Dienste hat (sonst Test oder Testzustand). */
    val isEcht: Boolean get() = dienste != null

    private var verbindung: Serververbindung? = null
    private var abfrage: Job? = null
    private var uhr: Job? = null

    /** Prüfung während [Phase.Ruht], alle [Ruhegrund.PRUEFABSTAND_S] Sekunden. */
    private var ruhePruefung: Job? = null

    /** Ob die Activity sichtbar ist: die Ortung startet nur aus dem Vordergrund (ADR-0098). */
    private var imVordergrund = false

    /** Die Ruhe endete im Hintergrund; die Ortung startet beim nächsten Öffnen. */
    private var startNachRuhe = false

    init {
        if (dienste != null) verbindeDienste(dienste)
    }

    private fun verbindeDienste(dienste: Dienste) {
        viewModelScope.launch { Ortungsstand.laeuft.collect { ortungLaeuft = it } }
        viewModelScope.launch { Ortungsstand.letzteSendung.collect { if (it != null) letzteSendung = it } }
        viewModelScope.launch {
            Ortungsstand.naechsterVersuch.collect { zeit ->
                naechsterVersuch = zeit
                if (zeit != null) {
                    verbindungsstand = Verbindungsstand.WIEDERHOLT
                } else if (verbindungsstand == Verbindungsstand.WIEDERHOLT) {
                    verbindungsstand = Verbindungsstand.VERBUNDEN
                }
            }
        }
        viewModelScope.launch { Ortungsstand.antworten.collect { verarbeite(it) } }
        // Pausiert in der Benachrichtigung: der Dienst hat es dem Server schon gemeldet.
        viewModelScope.launch { Ortungsstand.pausiert.collect { if (phase == Phase.Aktiv) ereignis(Ereignis.Pausiert) } }
        val sitzung = dienste.lesen() ?: return
        verbindung = dienste.verbindung(sitzung.server, sitzung.cookie)
        viewModelScope.launch { aktualisiereZustand() }
    }

    private fun ereignis(e: Ereignis) {
        anmeldung.verarbeite(e)
        phase = anmeldung.phase
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    // Lebenszyklus

    /**
     * Die Activity ist sichtbar oder nicht mehr: im Vordergrund fragt die App alle 15 s ihren
     * Zustand ab (statt des Live-Kanals), im Hintergrund erfährt der Dienst ihn aus der nächsten
     * Sendung.
     */
    fun szene(aktiv: Boolean) {
        abfrage?.cancel()
        abfrage = null
        uhr?.cancel()
        uhr = null
        imVordergrund = aktiv
        if (!aktiv || dienste == null) return
        uhr = viewModelScope.launch {
            while (isActive) {
                jetzt = Instant.now()
                delay(1_000)
            }
        }
        // Zurück aus den Einstellungen mit erteiltem Standortrecht: die Ortung startet jetzt.
        if (ortungVerweigert && dienste.isOrtungErlaubt) starteOrtung()
        if (startNachRuhe) {
            startNachRuhe = false
            starteOrtung()
        }
        abfrage = viewModelScope.launch {
            while (isActive) {
                aktualisiereZustand()
                delay(ABFRAGE_MS)
            }
        }
    }

    // Einladung lesen

    /** QR-Inhalt, Deeplink oder eingegebener Link; `false`, wenn es keine Helfer-Einladung ist. */
    fun gescannt(text: String): Boolean {
        val ziel = deuteHelferLink(text)
        if (ziel == null) {
            meldung = Anzeige.KEINE_EINLADUNG
            return false
        }
        if (phase.gekoppelt) {
            ausstehenderScan = ziel
            return true
        }
        uebernimm(ziel)
        return true
    }

    /** Server und Code aus „Code eingeben“; der Server ohne `https://` ist erlaubt. */
    fun eingegeben(server: String, code: String): Boolean {
        val link = Anzeige.eingabeLink(server, code)
        if (link == null || !gescannt(link)) {
            meldung = Anzeige.EINGABE_UNGUELTIG
            return false
        }
        return true
    }

    /** Ein Deeplink `lifeline-helfer://anmelden?server=…#CODE`. */
    fun oeffne(link: String) {
        gescannt(link)
    }

    /** Antwort auf die Rückfrage nach einem neuen Scan während einer Anmeldung. */
    fun bestaetigeNeuenScan(ja: Boolean) {
        val neu = ausstehenderScan ?: return
        ausstehenderScan = null
        if (!ja) return
        viewModelScope.launch {
            abmeldenUndWarten()
            uebernimm(neu)
        }
    }

    private fun uebernimm(ziel: HelferZiel) {
        ereignis(Ereignis.Gescannt(ziel))
        einladung = ziel
        zielliste = null
        gewaehltesZiel = null
        personOrten = false
        meldung = null
        ladeZiele()
    }

    fun ladeZiele() {
        val einladung = einladung ?: return
        val dienste = dienste
        if (dienste == null) {
            zielliste = Beispiel.zielliste
            return
        }
        zieleLaden = true
        viewModelScope.launch {
            try {
                val rueckmeldung = io { dienste.verbindung(einladung.server, null).ziele(einladung.code) }
                val liste = if (rueckmeldung.isErfolg) Wire.zielliste(rueckmeldung.text) else null
                if (liste != null) {
                    zielliste = liste
                    meldung = null
                } else {
                    meldung = rueckmeldung.meldung
                }
            } finally {
                zieleLaden = false
            }
        }
    }

    // Anmelden

    val kannAnmelden: Boolean
        get() = phase is Phase.Anmelden && gewaehltesZiel != null && !beschaeftigt && anzeigename.isNotBlank()

    /**
     * „Anmelden und Ortung erlauben“: die Seite hat schon nach dem Standort gefragt; die App löst
     * die Einladung ein und startet sofort die Ortung (Spec „Ablauf“, Schritt 5: schon beim
     * Einlösen).
     */
    fun anmelden() {
        val ziel = (phase as? Phase.Anmelden)?.ziel ?: return
        val gewaehlt = gewaehltesZiel ?: return
        if (!kannAnmelden) return
        val name = anzeigename.trim()
        meldung = null
        val dienste = dienste
        if (dienste == null) {
            ereignis(Ereignis.Eingeloest)
            return
        }
        ortungVerweigert = !dienste.isOrtungErlaubt
        beschaeftigt = true
        viewModelScope.launch {
            try {
                val neu = dienste.verbindung(ziel.server, null)
                val einloesung = Einloesung(
                    code = ziel.code,
                    displayName = name,
                    target = gewaehlt.eingabe,
                    trackPerson = personOrten && zielliste?.personTrackingAllowed == true,
                )
                val rueckmeldung = io { neu.einloesen(einloesung) }
                val cookie = neu.cookie
                if (rueckmeldung.status != 201 || cookie == null) {
                    meldung = rueckmeldung.meldung
                    return@launch
                }
                dienste.anzeigename = name
                dienste.speichern(Sitzung(ziel.server, cookie))
                verbindung = neu
                zustand = Wire.zustand(rueckmeldung.text)
                val vorher = phase
                ereignis(Ereignis.Eingeloest)
                zustand?.let { ereignis(Ereignis.Zustand(it.state, it.reason, it.rolle)) }
                // Ohne Rolle, die orten darf, ruht die Kopplung gleich: dann startet keine Ortung.
                nachWechsel(vorher)
                starteOrtung()
            } finally {
                beschaeftigt = false
            }
        }
    }

    /**
     * Startet die Ortung, solange die Phase sie verlangt; nur aus dem Vordergrund (Einlösen,
     * Fortsetzen oder „Ortung wieder starten“). Ohne Standortrecht bleibt sie aus, die Seite zeigt
     * den Weg in die Einstellungen.
     */
    fun starteOrtung() {
        if (!phase.ortet) return
        val dienste = dienste ?: return
        ortungVerweigert = !dienste.isOrtungErlaubt
        if (ortungVerweigert) return
        if (dienste.starteOrtung(einsatzname, zielname)) {
            ortungLaeuft = true
        } else {
            meldung = ORTUNG_NICHT_GESTARTET
        }
    }

    private fun stoppeOrtung() {
        dienste?.stoppeOrtung()
        ortungLaeuft = false
    }

    // Ziel ändern (nur unbestätigt)

    /** Ob die Kraft das Ziel noch ändern kann: nur unbestätigt und nur, solange die App den Code kennt. */
    val kannZielAendern: Boolean
        get() = phase == Phase.Unbestaetigt && einladung != null

    fun zielAendern(option: ZielOption) {
        if (!kannZielAendern) return
        val v = verbindung
        if (v == null) {
            if (dienste == null) gewaehltesZiel = option
            return
        }
        beschaeftigt = true
        viewModelScope.launch {
            try {
                val rueckmeldung = io { v.zielAendern(option.eingabe) }
                val neu = if (rueckmeldung.isErfolg) Wire.zustand(rueckmeldung.text) else null
                if (neu != null) {
                    zustand = neu
                    gewaehltesZiel = option
                    // Die Benachrichtigung nennt das neue Ziel.
                    if (ortungLaeuft) dienste?.starteOrtung(einsatzname, zielname)
                } else {
                    meldung = rueckmeldung.meldung
                    reagiere(rueckmeldung)
                }
            } finally {
                beschaeftigt = false
            }
        }
    }

    // Pausieren und Fortsetzen

    /**
     * Pausieren in der App: die Ortung hört sofort auf; der Server erfährt es mit `paused: true`.
     * Erreicht ihn das nicht, holt die nächste Abfrage es nach.
     */
    fun pausieren() {
        if (phase != Phase.Aktiv) return
        ereignis(Ereignis.Pausiert)
        stoppeOrtung()
        val v = verbindung ?: return
        viewModelScope.launch { reagiere(io { v.pausiere(true) }) }
    }

    /** „Fortsetzen“ geht nur in der geöffneten App und nur, wenn der Server zustimmt. */
    fun fortsetzen() {
        if (phase != Phase.Pausiert) return
        val v = verbindung
        if (v == null) {
            if (dienste == null) ereignis(Ereignis.Fortgesetzt)
            return
        }
        beschaeftigt = true
        viewModelScope.launch {
            try {
                val rueckmeldung = io { v.pausiere(false) }
                if (rueckmeldung.isErfolg) {
                    ereignis(Ereignis.Fortgesetzt)
                    starteOrtung()
                } else {
                    meldung = rueckmeldung.meldung
                    reagiere(rueckmeldung)
                }
            } finally {
                beschaeftigt = false
            }
        }
    }

    // Abmelden und Ende

    /**
     * „Abmelden“ oder „Abbrechen“: vor dem Einlösen zurück zum Start, danach
     * `POST /api/auth/logout` und Ende mit Grund „abgemeldet“. Die Ortung hört in jedem Fall auf.
     */
    fun abmelden() {
        viewModelScope.launch { abmeldenUndWarten() }
    }

    private suspend fun abmeldenUndWarten() {
        if (phase is Phase.Anmelden) {
            ereignis(Ereignis.Abgemeldet)
            einladung = null
            return
        }
        if (!phase.gekoppelt) return
        beschaeftigt = true
        try {
            val vorher = phase
            stoppeOrtung()
            verbindung?.let { v -> io { v.abmelden() } }
            ereignis(Ereignis.Abgemeldet)
            nachWechsel(vorher)
        } finally {
            beschaeftigt = false
        }
    }

    /** „Neu anmelden“ auf der Seite „Beendet“. */
    fun neuAnmelden() {
        anmeldung = Anmeldung()
        phase = anmeldung.phase
        einladung = null
        zielliste = null
        zustand = null
        letzteSendung = null
        verbindungsstand = Verbindungsstand.UNBEKANNT
        naechsterVersuch = null
        gewaehltesZiel = null
        meldung = null
    }

    // Antworten

    /** Antwort des Servers auf eine Sendung des Ortungsdienstes, mit `reason` des Fehler-Bodys. */
    private fun verarbeite(entscheidung: Entscheidung) {
        when (entscheidung.antwort) {
            Antwort.WEITER, Antwort.WARTEN -> verbindungsstand = Verbindungsstand.VERBUNDEN
            Antwort.WIEDERHOLEN -> verbindungsstand = Verbindungsstand.WIEDERHOLT
            Antwort.VERWERFEN, Antwort.STOPPEN, Antwort.RUHEN -> Unit
        }
        val vorher = phase
        ereignis(Ereignis.Antwortet(entscheidung.antwort, entscheidung.grund))
        nachWechsel(vorher)
    }

    /**
     * Eine Antwort außerhalb der Sendungen: 401, 403 und 404 beenden die Kopplung, ein 403 mit
     * `Ruhegrund` lässt sie ruhen (die Wirkung trägt [nachWechsel]).
     */
    private fun reagiere(rueckmeldung: Rueckmeldung) {
        val antwort = rueckmeldung.antwort
        if ((antwort != Antwort.STOPPEN && antwort != Antwort.RUHEN) || !phase.gekoppelt) return
        val vorher = phase
        ereignis(Ereignis.Antwortet(antwort, rueckmeldung.grund))
        nachWechsel(vorher)
    }

    /**
     * Während der Ruhe: alle [Ruhegrund.PRUEFABSTAND_S] Sekunden den eigenen Zustand holen (eine
     * neue Rolle beendet [Ruhegrund.KEINE_ROLLE]), bei [Ruhegrund.pruefeMitFortsetzen] dazu
     * fortsetzen ohne Position (`{paused: false}`); erst ein angenommenes Fortsetzen beendet die Ruhe.
     */
    private fun starteRuhePruefung() {
        ruhePruefung?.cancel()
        ruhePruefung = null
        if (dienste == null) return
        ruhePruefung = viewModelScope.launch {
            while (isActive) {
                delay(Ruhegrund.PRUEFABSTAND_S * 1_000)
                pruefeRuhe()
            }
        }
    }

    private suspend fun pruefeRuhe() {
        aktualisiereZustand()
        val grund = (phase as? Phase.Ruht)?.grund ?: return
        if (!grund.pruefeMitFortsetzen) return
        val v = verbindung ?: return
        val rueckmeldung = io { v.pausiere(false) }
        if (phase !is Phase.Ruht) return
        when (rueckmeldung.antwort) {
            Antwort.WEITER, Antwort.WARTEN, Antwort.RUHEN, Antwort.STOPPEN -> {
                val vorher = phase
                ereignis(Ereignis.Antwortet(rueckmeldung.antwort, rueckmeldung.grund))
                nachWechsel(vorher)
            }
            Antwort.WIEDERHOLEN, Antwort.VERWERFEN -> Unit
        }
    }

    /** Eigener Zustand vom Server (Abfrage im Vordergrund und nach dem Start der App). */
    suspend fun aktualisiereZustand() {
        val dienste = dienste ?: return
        val v = verbindung ?: return
        val rueckmeldung = io { v.zustand() }
        val neu = if (rueckmeldung.isErfolg) Wire.zustand(rueckmeldung.text) else null
        if (neu == null) {
            if (rueckmeldung.antwort == Antwort.STOPPEN) {
                if (phase.gekoppelt) {
                    reagiere(rueckmeldung)
                } else {
                    // Gespeicherte Sitzung beim Start ungültig: vergessen.
                    dienste.loeschen()
                    verbindung = null
                }
            }
            return
        }
        zustand = neu
        val vorher = phase
        // Nach einem Neustart der App führt der Zustand vom Start in die bestehende Kopplung.
        ereignis(Ereignis.Zustand(neu.state, neu.reason, neu.rolle))
        if (neu.paused && phase == Phase.Aktiv) {
            // Pausiert in der Benachrichtigung, während die App nicht lief.
            ereignis(Ereignis.Pausiert)
            stoppeOrtung()
        } else if (!neu.paused && phase == Phase.Pausiert) {
            // Die Pause erreichte den Server nicht: nachholen.
            io { v.pausiere(true) }
        }
        nachWechsel(vorher)
    }

    /**
     * Wirkungen eines Phasenwechsels: Bestätigung melden, Ruhe beginnen und beenden, am Ende alles
     * abräumen. In der Ruhe ist der Dienst aus (Benachrichtigung weg), Kopplung und Sitzung
     * bleiben; endet sie, startet die Ortung nur aus dem Vordergrund, sonst beim nächsten Öffnen.
     */
    private fun nachWechsel(vorher: Phase) {
        if (phase == vorher) return
        if (vorher == Phase.Unbestaetigt && phase == Phase.Aktiv) bestaetigungen += 1
        val ruhteVorher = vorher is Phase.Ruht
        if (phase is Phase.Ruht) {
            stoppeOrtung()
            if (!ruhteVorher) starteRuhePruefung()
        } else if (ruhteVorher) {
            ruhePruefung?.cancel()
            ruhePruefung = null
            if (phase.ortet) {
                if (imVordergrund) starteOrtung() else startNachRuhe = true
            }
        }
        if (phase is Phase.Beendet) raeumeAb()
    }

    private fun raeumeAb() {
        stoppeOrtung()
        abfrage?.cancel()
        abfrage = null
        ruhePruefung?.cancel()
        ruhePruefung = null
        startNachRuhe = false
        dienste?.loeschen()
        verbindung = null
        Ortungsstand.vergessen()
    }

    // Anzeige

    val einsatzname: String get() = zustand?.incident?.name ?: "Einsatz"
    val zielname: String get() = zustand?.target?.name ?: gewaehltesZiel?.name ?: "Ohne Ziel"
    val servername: String get() = (einladung?.server ?: verbindung?.server)?.host.orEmpty()

    // Testzustand

    private fun zeige(testzustand: Testzustand) {
        val einladung = Beispiel.einladung
        anzeigename = "Max M., San-Trupp 2"
        if (testzustand == Testzustand.START) return
        ereignis(Ereignis.Gescannt(einladung))
        this.einladung = einladung
        zielliste = Beispiel.zielliste
        gewaehltesZiel = Beispiel.zielliste.targets.first()
        if (testzustand == Testzustand.ANMELDEN) return
        ereignis(Ereignis.Eingeloest)
        zustand = Beispiel.zustand("unbestaetigt")
        ortungLaeuft = true
        if (testzustand == Testzustand.WARTET) return
        ereignis(Ereignis.Bestaetigt)
        zustand = Beispiel.zustand("aktiv")
        letzteSendung = Instant.now().minusSeconds(12)
        verbindungsstand = Verbindungsstand.VERBUNDEN
        when (testzustand) {
            Testzustand.PAUSIERT -> {
                ereignis(Ereignis.Pausiert)
                ortungLaeuft = false
            }
            Testzustand.RUHT -> {
                // Bestätigt ohne Ortungsgerät und ohne Person (Entscheidung 7 der Spec).
                ereignis(Ereignis.Zustand("aktiv", null, Rolle(isTracker = false, personId = null)))
                ortungLaeuft = false
            }
            Testzustand.BEENDET -> {
                ereignis(Ereignis.Zustand("beendet", Grund.EINSATZ_BEENDET.wire, Beispiel.zustand("aktiv").rolle))
                ortungLaeuft = false
            }
            else -> Unit
        }
    }

    /** Baut das Modell für die Activity: echt, oder mit Beispieldaten im Testzustand. */
    class Fabrik(private val testzustand: Testzustand?, private val dienste: () -> Dienste) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = start(testzustand, dienste) as T
    }

    companion object {
        private const val ABFRAGE_MS = 15_000L
        const val ORTUNG_NICHT_GESTARTET = "Die Ortung ließ sich nicht starten. Öffne die App und versuche es erneut."

        /** Modell für den Start: im Testzustand ohne Dienste und mit Beispieldaten. */
        fun start(testzustand: Testzustand?, dienste: () -> Dienste): HelferModell =
            if (testzustand != null) HelferModell(null).also { it.zeige(testzustand) } else HelferModell(dienste())
    }
}

/** Beispieldaten für Tests und Bildschirmbilder (gleich wie in der iOS-App). */
object Beispiel {
    val einladung = HelferZiel(ServerAdresse.parse("https://elw.local:8443/"), "AB12CD34")

    val zielliste = Zielliste(
        targets = listOf(
            ZielOption("unit", 1, "San-Trupp 2", "Rotkreuz Musterstadt 72/2", "Sanitätsdienst", "DRK"),
            ZielOption("vehicle", 7, "Rotkreuz Musterstadt 72/83-1", null, "Krankentransport", "DRK"),
            ZielOption("unit", 3, "Betreuungsgruppe", null, "Betreuung", "DRK"),
        ),
        personTrackingAllowed = true,
    )

    fun zustand(state: String) = Zustand(
        state = state,
        reason = null,
        incident = Zustand.Einsatz(42, "Stadtfest Musterstadt"),
        target = Zustand.Ziel("unit", 1, "San-Trupp 2"),
        person = if (state == "aktiv") Zustand.Person(5, "Max Mustermann") else null,
        isTracker = true,
        paused = false,
        expiresAt = "2026-11-25 22:00:00",
        serverTime = "2026-11-25 14:00:00",
    )
}
