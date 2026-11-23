package dev.rubeen.lifeline.kern

import java.math.BigInteger
import java.net.URI
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** `android.json` eines Releases (Entwurf D9). Unbekannte Felder ignoriert die App. */
@Serializable
data class Updatemanifest(
    val version: String,
    @SerialName("version_code") val versionCode: Int,
    val url: String,
    val sha256: String,
) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** `null` für alles, was kein Manifest ist. */
        fun parse(json: String): Updatemanifest? =
            try {
                this.json.decodeFromString(serializer(), json)
            } catch (_: Exception) {
                null
            }
    }
}

/** SemVer 2.0 (semver.org): Vorrang nach §11, Build-Metadaten zählen nicht. */
object Semver {
    internal data class Version(val kern: List<BigInteger>, val vorab: List<String>?)

    private val regel = Regex(
        "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)" +
            "(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?" +
            "(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
    )

    internal fun parse(text: String): Version? {
        val treffer = regel.matchEntire(text) ?: return null
        val g = treffer.groupValues
        return Version(
            kern = listOf(g[1], g[2], g[3]).map(::BigInteger),
            vorab = g[4].takeIf { it.isNotEmpty() }?.split('.'),
        )
    }

    /** Negativ, null oder positiv wie `compareTo`; `null`, wenn eine der Versionen ungültig ist. */
    fun compare(a: String, b: String): Int? {
        val x = parse(a) ?: return null
        val y = parse(b) ?: return null
        for (i in 0..2) {
            val c = x.kern[i].compareTo(y.kern[i])
            if (c != 0) return c
        }
        val vx = x.vorab
        val vy = y.vorab
        return when {
            vx == null && vy == null -> 0
            // Eine Version ohne Vorab-Teil geht der mit Vorab-Teil vor.
            vx == null -> 1
            vy == null -> -1
            else -> vergleicheVorab(vx, vy)
        }
    }

    private fun vergleicheVorab(a: List<String>, b: List<String>): Int {
        for (i in 0 until minOf(a.size, b.size)) {
            val c = vergleicheKennung(a[i], b[i])
            if (c != 0) return c
        }
        return a.size.compareTo(b.size)
    }

    private fun vergleicheKennung(a: String, b: String): Int {
        val zahlA = a.all { it in '0'..'9' }
        val zahlB = b.all { it in '0'..'9' }
        return when {
            zahlA && zahlB -> BigInteger(a).compareTo(BigInteger(b))
            // Zahlen haben geringeren Vorrang als Text.
            zahlA -> -1
            zahlB -> 1
            else -> a.compareTo(b)
        }
    }
}

/** Reine Entscheidungen des Updaters (Entwurf D9); Netz, Ablage und Installation führt die App aus. */
object Updateentscheidung {
    /** Abstand der Prüfungen. */
    const val PRUEF_ABSTAND_MS = 4 * 60 * 60 * 1000L

    /** So lange muss die Oberfläche im Hintergrund sein, bevor der Updater installieren darf. */
    const val HINTERGRUND_MS = 15 * 60 * 1000L

    /** Hosts, von denen die App Manifest und APK lädt (Weiterleitungen eingeschlossen). */
    val ERLAUBTE_HOSTS = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")

    /** Ist eine Prüfung fällig? Ohne frühere Prüfung und bei zurückgestellter Uhr ja. */
    fun isFaellig(letztePruefung: Long?, jetzt: Long): Boolean =
        letztePruefung == null || jetzt < letztePruefung || jetzt - letztePruefung >= PRUEF_ABSTAND_MS

    /** Nur ein Release mit höherer Version und größerem `versionCode` ist ein Update. */
    fun isNeuer(eigeneVersion: String, eigenerCode: Int, manifest: Updatemanifest): Boolean {
        val vergleich = Semver.compare(manifest.version, eigeneVersion) ?: return false
        return vergleich > 0 && manifest.versionCode > eigenerCode
    }

    /** `https` auf einem erlaubten Host, ohne Zugangsdaten und nur auf dem Standardport. */
    fun isErlaubterDownload(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        return uri.scheme == "https" &&
            uri.rawUserInfo == null &&
            (uri.port == -1 || uri.port == 443) &&
            uri.host?.lowercase() in ERLAUBTE_HOSTS
    }

    /**
     * Antwortet die Adresse des Manifests so, trägt der Kanal (noch) keins: das Kanal-Release gibt
     * es noch nicht, oder `android.json` fehlt gerade. Dann gibt es kein Update, aber keinen Fehler.
     */
    fun isKanalLeer(httpStatus: Int): Boolean = httpStatus == 404

    /** 64 Hexziffern. */
    fun isSha256(text: String): Boolean =
        text.length == 64 && text.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
}

/** Wann der Updater installieren darf (Entwurf D9): nie unter der Hand der laufenden Oberfläche. */
object Installzeitpunkt {
    enum class Lage {
        /** Die App startet, die Oberfläche steht noch nicht. */
        START_VOR_OBERFLAECHE,

        /** Die Oberfläche ist im Vordergrund. */
        VORDERGRUND,

        /** Die App ist im Hintergrund. */
        HINTERGRUND,
    }

    enum class Weg {
        INSTALLIEREN,

        /** Die Person bekommt einen Hinweis und entscheidet. */
        HINWEIS,
        WARTEN,
    }

    /**
     * @param imHintergrundSeit Zeitpunkt des Wechsels in den Hintergrund
     * @param brauchtRueckfrage das System würde vor der Installation nachfragen
     */
    fun decide(lage: Lage, imHintergrundSeit: Long?, jetzt: Long, brauchtRueckfrage: Boolean): Weg = when (lage) {
        Lage.START_VOR_OBERFLAECHE -> Weg.INSTALLIEREN
        Lage.VORDERGRUND -> Weg.HINWEIS
        Lage.HINTERGRUND ->
            if (imHintergrundSeit == null || jetzt - imHintergrundSeit < Updateentscheidung.HINTERGRUND_MS) Weg.WARTEN
            else if (brauchtRueckfrage) Weg.HINWEIS
            else Weg.INSTALLIEREN
    }

    /**
     * Lage beim Aufbau der Activity: nur der erste Aufbau ist der Start vor der Oberfläche (D9,
     * Fall a). Ein Neubau (Schriftgröße geändert, vom System verworfen und wiederhergestellt) folgt
     * auf Arbeit Sekunden vorher und zählt als Vordergrund (Review K2).
     */
    fun lageBeimAufbau(neubau: Boolean): Lage = if (neubau) Lage.VORDERGRUND else Lage.START_VOR_OBERFLAECHE

    /**
     * Fragt das System vor der Installation nach (Entwurf D9, Fakt 6)? Ohne Rückfrage nur ab
     * Android 12 (API 31) und nur, wenn die App selbst die installierende App der laufenden
     * Fassung ist; das erste Update nach einer Installation aus Browser oder Dateien fragt immer.
     *
     * @param installateur installierende App der laufenden Fassung (`InstallSourceInfo`), `null` unbekannt
     * @param paket eigener Paketname
     */
    fun brauchtRueckfrage(sdk: Int, installateur: String?, paket: String): Boolean =
        !(sdk >= ANDROID_12 && installateur == paket)

    private const val ANDROID_12 = 31
}

/**
 * Installation mit der Seite „Lifeline wird aktualisiert“ (Entwurf D9, Fall a): ein Tablet darf
 * im Einsatz nie auf dieser Seite hängen. Kommt kein Ergebnis des Systems, gibt die App die
 * Installation auf (das Update bleibt bereit) und lädt die Oberfläche: [GESAMT_FRIST_MS] nach dem
 * Beginn oder [RUECKKEHR_FRIST_MS] nach der Rückkehr, wenn etwas die App verdeckt hatte (die
 * Rückfrage des Systems, ein Wechsel der App). Zeiten monoton in Millisekunden.
 */
object Startinstallation {
    const val RUECKKEHR_FRIST_MS = 3_000L
    const val GESAMT_FRIST_MS = 60_000L

    /** @param zurueckSeit Rückkehr nach einer Verdeckung, solange noch kein Ergebnis da ist */
    data class State(val begonnen: Long, val verdeckt: Boolean = false, val zurueckSeit: Long? = null)

    sealed interface Event {
        /** `ON_PAUSE`: etwas liegt über der App, etwa die Rückfrage des Systems. */
        data object Verdeckt : Event

        /** `ON_RESUME`. */
        data class Zurueck(val jetzt: Long) : Event
    }

    fun begin(jetzt: Long): State = State(begonnen = jetzt)

    fun next(state: State, event: Event): State = when (event) {
        Event.Verdeckt -> state.copy(verdeckt = true, zurueckSeit = null)
        // Ein ON_RESUME ohne vorherige Verdeckung (der Start selbst) ändert nichts.
        is Event.Zurueck -> if (state.verdeckt) state.copy(verdeckt = false, zurueckSeit = event.jetzt) else state
    }

    /** Zeitpunkt, zu dem die App ohne Ergebnis aufgibt. */
    fun frist(state: State): Long =
        minOf(state.begonnen + GESAMT_FRIST_MS, state.zurueckSeit?.plus(RUECKKEHR_FRIST_MS) ?: Long.MAX_VALUE)

    fun isAufgegeben(state: State, jetzt: Long): Boolean = jetzt >= frist(state)
}

/** Stand des Updaters für Einstellungen und Hinweis. */
enum class Updatestand {
    KEINS,
    LAEDT,
    BEREIT,
    INSTALLIERT_GLEICH,
    BLOCKIERT,
    ERLAUBNIS_FEHLT,
    FEHLER;

    /**
     * Ein Update wartet auf die Person (installieren, Erlaubnis erteilen, Sperre lösen): Punkt am
     * Knopf zur Serverliste (Entwurf D9).
     */
    val isHinweis: Boolean
        get() = this == BEREIT || this == ERLAUBNIS_FEHLT || this == BLOCKIERT
}
