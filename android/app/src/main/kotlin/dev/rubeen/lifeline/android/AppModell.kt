package dev.rubeen.lifeline.android

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.EntfernungException
import dev.rubeen.lifeline.kern.Entfernungsdienste
import dev.rubeen.lifeline.kern.Fehlerklasse
import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Kanal
import dev.rubeen.lifeline.kern.ListException
import dev.rubeen.lifeline.kern.Onboarding
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverentfernung
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.Testzustand
import dev.rubeen.lifeline.kern.Updatestand
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Zustand der App als Compose-State (wie `ios/App/AppModell.swift`). Entscheidungen fallen im
 * Kern (`Ablauf`, `Onboarding`, `Serverentfernung`); das Modell hält ihr Ergebnis und führt die
 * Wirkungen aus. In einem [testzustand] fragt es kein Netz und speichert nichts.
 *
 * @param version volle Version der App (`versionName`), [build] ihr `versionCode`
 * @param einstellungen Ablage der Schalter (`SharedPreferences("lifeline")`); im Testzustand `null`
 */
class AppModell(
    val testzustand: Testzustand?,
    version: String,
    build: Int,
    private val einstellungen: SharedPreferences?,
    private val scope: CoroutineScope,
) : Entfernungsdienste {
    val appVersion: String = if (testzustand != null) BEISPIEL_VERSION else version
    val build: String = (if (testzustand != null) BEISPIEL_BUILD else build).toString()

    /** Kanal des Updaters aus der eigenen Version; gespeichert und geprüft wird er mit dem Updater. */
    val kanal: Kanal? = Kanal.fromVersion(appVersion)

    var seite: Ablauf.Seite by mutableStateOf(Ablauf.Seite.Onboarding)
        private set
    var onboarding: Onboarding.State by mutableStateOf(Onboarding.State.START)
        private set
    var liste: Serverliste by mutableStateOf(Serverliste())
        private set
    var updatestand: Updatestand by mutableStateOf(Updatestand.KEINS)
        private set

    // Native Seiten über der Seite des Ablaufs (auf iOS Blätter); Zurück schließt die oberste.
    var zeigtServerliste by mutableStateOf(false)
    var zeigtEinstellungen by mutableStateOf(false)
    var zeigtOnboarding by mutableStateOf(false)

    /** „Lifeline wird aktualisiert“ vor einer Installation beim Start (Entwurf D9). */
    var zeigtUpdate by mutableStateOf(false)
        private set

    var haptik: Boolean by mutableStateOf(einstellungen?.getBoolean(Haptik.SCHALTER_SCHLUESSEL, true) ?: true)
        private set

    /** Server, dessen Daten gerade gelöscht werden; zu ihm wechselt die App nicht. */
    var inEntfernung: String? by mutableStateOf(null)
        private set

    /** Meldung, wenn sich ein Server nicht entfernen ließ. */
    var entfernenFehler: String? by mutableStateOf(null)
        private set

    init {
        testzustand?.let(::zeige)
    }

    /** Liegt eine native Seite über der Seite des Ablaufs? Dann schließt Zurück sie. */
    val hatBlatt: Boolean
        get() = zeigtEinstellungen || zeigtOnboarding || zeigtServerliste

    /** Schließt die oberste native Seite (Einstellungen und Hinzufügen liegen über der Liste). */
    fun zurueck() {
        when {
            zeigtEinstellungen -> zeigtEinstellungen = false
            zeigtOnboarding -> zeigtOnboarding = false
            else -> zeigtServerliste = false
        }
    }

    /** Schritt des Onboardings; die Wirkungen (Prüfen, Speichern) kommen mit dem Vertragsabruf. */
    fun send(event: Onboarding.Event) {
        onboarding = Onboarding.next(onboarding, event).state
    }

    /** Schritt des Ablaufs; die Wirkungen (WebView, Prüfen, Zeitgeber) kommen mit dem WebView. */
    fun send(event: Ablauf.Event) {
        seite = Ablauf.next(seite, event).seite
    }

    // Serverliste

    /** Weiterer Server aus der Liste: Onboarding als Blatt, von vorn. */
    fun zeigeHinzufuegen() {
        onboarding = Onboarding.State.START
        zeigtOnboarding = true
    }

    /** Tipp auf den aktiven Server: lädt seine Startadresse neu. */
    fun zurOberflaeche() {
        zeigtServerliste = false
        send(Ablauf.Event.ZurOberflaeche)
    }

    fun wechseln(eintrag: ServerEintrag) {
        if (eintrag.id == inEntfernung) return
        zeigtServerliste = false
        liste = try {
            liste.activate(eintrag.id)
        } catch (_: ListException) {
            return
        }
        send(Ablauf.Event.Wechseln(liste.aktiv ?: eintrag))
    }

    /** „Erneut prüfen“ auf einer Status-Seite: prüft ihren Server sofort. */
    fun pruefeErneut() {
        seite.eintrag?.let { send(Ablauf.Event.Wechseln(aktuell(it))) }
    }

    fun umbenennen(eintrag: ServerEintrag, name: String) {
        liste = try {
            liste.rename(eintrag.id, name)
        } catch (_: ListException) {
            liste
        }
    }

    /** Nach der Rückfrage: Reihenfolge und Fehler entscheidet `Serverentfernung` im Kern. */
    fun entfernen(eintrag: ServerEintrag) {
        if (inEntfernung != null) return
        inEntfernung = eintrag.id
        scope.launch {
            try {
                Serverentfernung.run(eintrag.id, this@AppModell)
            } catch (e: EntfernungException) {
                entfernenFehler = e.fehler.meldung
            } finally {
                inEntfernung = null
            }
        }
    }

    fun fehlerGesehen() {
        entfernenFehler = null
    }

    /** Der aktuelle Stand eines Eintrags (Name nach Umbenennen, zuletzt verbunden). */
    fun aktuell(eintrag: ServerEintrag): ServerEintrag = liste.eintraege.firstOrNull { it.id == eintrag.id } ?: eintrag

    // Einstellungen

    fun schalteHaptik(an: Boolean) {
        haptik = an
        einstellungen?.edit()?.putBoolean(Haptik.SCHALTER_SCHLUESSEL, an)?.apply()
    }

    /**
     * „App aktualisieren“ führt direkt zum Updater (Entwurf D4): ein bereites Update installieren,
     * sonst suchen.
     */
    fun aktualisieren() {
        if (updatestand == Updatestand.BEREIT) installiereUpdate() else pruefeUpdate()
    }

    /** „Jetzt prüfen“: führt der Updater aus; ohne ihn bleibt der Stand, wie er ist. */
    fun pruefeUpdate() {}

    /** „Jetzt installieren“: führt der Updater aus; ohne ihn bleibt der Stand, wie er ist. */
    fun installiereUpdate() {}

    // Entfernungsdienste

    override val serverliste: Serverliste
        get() = liste

    /** Ohne WebView ist nichts zu schließen; den WebView je Server baut die App mit dem Vertragsabruf. */
    override fun closeWebView(profil: String) {}

    /** Ein WebView-Profil entsteht erst mit dem WebView des Servers (Entwurf D3); vorher gibt es keins. */
    override suspend fun removeProfil(profil: String) {}

    override fun removeEintrag(id: String) {
        liste = liste.remove(id)
    }

    // Testzustände der Bilder

    private fun zeige(testzustand: Testzustand) {
        liste = beispielliste()
        val elw = liste.aktiv ?: return
        val nichtErreichbar = Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar)
        when (testzustand) {
            Testzustand.ONBOARDING -> {
                liste = Serverliste()
                seite = Ablauf.Seite.Onboarding
                onboarding = Onboarding.State.Eingabe("https://elw.local:8443", null)
            }
            Testzustand.SERVERLISTE -> {
                seite = nichtErreichbar
                zeigtServerliste = true
            }
            Testzustand.EINSTELLUNGEN -> {
                seite = nichtErreichbar
                zeigtEinstellungen = true
            }
            Testzustand.ZERTIFIKAT -> seite = Ablauf.Seite.Status(elw, Statusseite.Zertifikat)
            Testzustand.NICHT_ERREICHBAR -> seite = nichtErreichbar
            Testzustand.ZU_ALT ->
                seite = Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, "1.0.0-alpha.200"))
            Testzustand.ZU_NEU ->
                seite = Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0"))
            Testzustand.WEBVIEW_VERALTET -> seite = Ablauf.Seite.WebviewVeraltet
            Testzustand.UPDATE_BEREIT -> {
                seite = nichtErreichbar
                updatestand = Updatestand.BEREIT
                zeigtEinstellungen = true
            }
            Testzustand.UPDATE_LAEUFT -> {
                updatestand = Updatestand.INSTALLIERT_GLEICH
                zeigtUpdate = true
            }
            Testzustand.WEB, Testzustand.FREMDE_SEITE -> seite = Ablauf.Seite.Web(elw, vertrag = 1)
        }
    }

    companion object {
        /** Version und Build der Bilder: eine Alpha, damit Kanal und Updater sichtbar sind. */
        const val BEISPIEL_VERSION = "1.0.0-alpha.7"
        const val BEISPIEL_BUILD = 469_044

        /** Beispielserver der Testzustände (wie auf iOS, dazu ein dritter). */
        fun beispielliste(): Serverliste {
            val ids = ArrayDeque(
                listOf(
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b01",
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b02",
                    "6f1c2a4e-0b7d-4c1e-9a53-2d8e4f0a1b03",
                ),
            )
            fun Serverliste.mit(adresse: String, name: String) =
                add(ServerAdresse.parse(adresse), name) { ids.removeFirst() }
            val (mitElw, elw) = Serverliste().mit("https://elw.local:8443", "ELW 1")
            val (mitLager, _) = mitElw.mit("https://lager.example", "Lager")
            val (alle, kv) = mitLager.mit("https://lifeline.kv.example", "Kreisverband")
            return alle
                .markVerbunden(elw.id, zeit = 1_800_000_000_000, vertrag = 1)
                .markVerbunden(kv.id, zeit = 1_799_400_000_000, vertrag = 1)
        }
    }
}
