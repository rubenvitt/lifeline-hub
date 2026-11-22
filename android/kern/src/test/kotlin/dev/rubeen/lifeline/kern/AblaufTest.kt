package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Welche Seite die App zeigt (wie `AblaufTests.swift`, dazu Entwurf D3 und D5: Start ohne
 * Server, WebView zu alt, Offline-Oberfläche).
 */
class AblaufTest {
    private val neueId: () -> String = run {
        var zaehler = 0
        { "id-${++zaehler}" }
    }
    private val elw: ServerEintrag
    private val lager: ServerEintrag
    private val info = ShellInfo(version = "1.0.0-alpha.320", shellContract = 1)
    private val eigen = URI("https://elw.local:8443/einsatz/3")
    private val idp = URI("https://idp.example/realms/drk/login")

    init {
        val (liste, e) = Serverliste().add(ServerAdresse.parse("https://elw.local:8443"), neueId = neueId)
        val (_, l) = liste.add(ServerAdresse.parse("https://lager.example"), neueId = neueId)
        elw = e
        lager = l
    }

    private fun step(seite: Ablauf.Seite, event: Ablauf.Event) = Ablauf.next(seite, event)

    private fun web(e: ServerEintrag = elw, offline: Boolean = false) = Ablauf.Seite.Web(e, 1, offline)

    private fun ergebnis(
        ergebnis: Vertragsergebnis,
        fuer: ServerEintrag = elw,
        healthVersion: String? = null,
    ) = Ablauf.Event.Ergebnis(ergebnis, healthVersion, fuer.id)

    private val nichtErreichbar = Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR)
    private val zertifikat = Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT)
    private val vertraeglich = Vertragsergebnis.Vertraeglich(info)

    private fun vordergrund(antwortet: Boolean, adresse: URI?, anmeldung: Boolean = false) =
        Ablauf.Event.Vordergrund(antwortet, adresse, anmeldung)

    // Start, Wechsel, Onboarding

    @Test
    fun `ohne Server zeigt die App nur das Onboarding`() {
        val schritt = step(Ablauf.Seite.Onboarding, Ablauf.Event.Start(null, true))
        assertEquals(Ablauf.Seite.Onboarding, schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `beim Start prüft die App den Vertrag vor dem Laden`() {
        val schritt = step(Ablauf.Seite.Onboarding, Ablauf.Event.Start(elw, true))
        assertEquals(Ablauf.Seite.Pruefung(elw), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
    }

    @Test
    fun `ohne taugliches WebView zeigt der Start nur die Seite WebView veraltet`() {
        val schritt = step(Ablauf.Seite.Onboarding, Ablauf.Event.Start(elw, false))
        assertEquals(Ablauf.Seite.WebviewVeraltet, schritt.seite)
        assertEquals(emptyList(), schritt.effects)
        val ohneServer = step(Ablauf.Seite.Onboarding, Ablauf.Event.Start(null, false))
        assertEquals(Ablauf.Seite.WebviewVeraltet, ohneServer.seite)
        assertEquals(emptyList(), ohneServer.effects)
    }

    @Test
    fun `auf der Seite WebView veraltet ändert nichts ohne neuen Start`() {
        for (event in listOf(
            Ablauf.Event.Wechseln(elw),
            Ablauf.Event.Verbunden(elw, info),
            Ablauf.Event.ZurOberflaeche,
            Ablauf.Event.Wiederholen,
            vordergrund(true, eigen),
        )) {
            val schritt = step(Ablauf.Seite.WebviewVeraltet, event)
            assertEquals(Ablauf.Seite.WebviewVeraltet, schritt.seite, "$event")
            assertEquals(emptyList(), schritt.effects, "$event")
        }
        assertEquals(
            Ablauf.Seite.Pruefung(elw),
            step(Ablauf.Seite.WebviewVeraltet, Ablauf.Event.Start(elw, true)).seite,
        )
    }

    @Test
    fun `ein verträglicher Server wird geladen und vermerkt`() {
        val schritt = step(Ablauf.Seite.Pruefung(elw), ergebnis(vertraeglich))
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.MarkVerbunden(elw.id, 1), Ablauf.Effect.Load(elw)), schritt.effects)
    }

    @Test
    fun `beim Wechsel prüft die App den neuen Server`() {
        for (vorher in listOf(web(), Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar), Ablauf.Seite.Pruefung(elw))) {
            val schritt = step(vorher, Ablauf.Event.Wechseln(lager))
            assertEquals(Ablauf.Seite.Pruefung(lager), schritt.seite)
            assertEquals(listOf(Ablauf.Effect.Check(lager)), schritt.effects)
        }
    }

    @Test
    fun `ein Ergebnis für den vorherigen Server wird verworfen`() {
        val schritt = step(Ablauf.Seite.Pruefung(lager), ergebnis(vertraeglich, fuer = elw))
        assertEquals(Ablauf.Seite.Pruefung(lager), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `nach dem Onboarding lädt die App ohne zweite Prüfung`() {
        val schritt = step(Ablauf.Seite.Onboarding, Ablauf.Event.Verbunden(elw, info))
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.MarkVerbunden(elw.id, 1), Ablauf.Effect.Load(elw)), schritt.effects)
    }

    // Status-Seiten

    @Test
    fun `ein unbekannter Vertrag zeigt die Richtung und lädt nicht`() {
        val neu = ShellInfo("2.0.0", 2)
        val schritt = step(
            Ablauf.Seite.Pruefung(elw),
            ergebnis(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, neu)),
        )
        assertEquals(
            Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0")),
            schritt.seite,
        )
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `ein Server ohne Vertrag nennt die Version aus Health`() {
        val schritt = step(
            Ablauf.Seite.Pruefung(elw),
            ergebnis(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null), healthVersion = "1.0.0-alpha.200"),
        )
        assertEquals(
            Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, "1.0.0-alpha.200")),
            schritt.seite,
        )
    }

    @Test
    fun `ein Zertifikatsfehler hat seine eigene Seite ohne Wiederholung`() {
        val schritt = step(Ablauf.Seite.Pruefung(elw), ergebnis(zertifikat))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.Zertifikat), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `nicht erreichbar prüft regelmäßig und lädt von selbst`() {
        val a = step(Ablauf.Seite.Pruefung(elw), ergebnis(nichtErreichbar))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar), a.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), a.effects)
        val b = step(a.seite, Ablauf.Event.Wiederholen)
        assertEquals(a.seite, b.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elw)), b.effects)
        val c = step(b.seite, ergebnis(nichtErreichbar))
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), c.effects)
        val d = step(c.seite, ergebnis(vertraeglich))
        assertEquals(web(), d.seite)
        assertEquals(listOf(Ablauf.Effect.MarkVerbunden(elw.id, 1), Ablauf.Effect.Load(elw)), d.effects)
    }

    @Test
    fun `Wiederholen gilt nur auf der Seite nicht erreichbar und im Offline-Web`() {
        for (seite in listOf(
            Ablauf.Seite.Onboarding,
            Ablauf.Seite.Pruefung(elw),
            web(),
            Ablauf.Seite.Status(elw, Statusseite.Zertifikat),
            Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, null)),
            Ablauf.Seite.WebviewVeraltet,
        )) {
            val schritt = step(seite, Ablauf.Event.Wiederholen)
            assertEquals(seite, schritt.seite)
            assertEquals(emptyList(), schritt.effects, "$seite")
        }
    }

    // Ohne Netz (Entwurf D5)

    private val elwGeladen = elw.copy(geladenImProfil = true, bestaetigterVertrag = 1)
    private val elwNieGeladen = elw.copy(geladenImProfil = false, bestaetigterVertrag = null)

    @Test
    fun `ohne Netz lädt ein schon geladener Server offline`() {
        val schritt = step(Ablauf.Seite.Pruefung(elwGeladen), ergebnis(nichtErreichbar, elwGeladen))
        assertEquals(Ablauf.Seite.Web(elwGeladen, 1, offline = true), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Load(elwGeladen), Ablauf.Effect.ScheduleRetry), schritt.effects)
    }

    @Test
    fun `ohne Netz zeigt ein nie geladener Server nicht erreichbar`() {
        val schritt = step(Ablauf.Seite.Pruefung(elwNieGeladen), ergebnis(nichtErreichbar, elwNieGeladen))
        assertEquals(Ablauf.Seite.Status(elwNieGeladen, Statusseite.NichtErreichbar), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), schritt.effects)
    }

    @Test
    fun `Zertifikatsfehler lädt nie offline`() {
        val schritt = step(Ablauf.Seite.Pruefung(elwGeladen), ergebnis(zertifikat, elwGeladen))
        assertEquals(Ablauf.Seite.Status(elwGeladen, Statusseite.Zertifikat), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `ein Zertifikatsfehler auf der offline geladenen Oberfläche zeigt die Anleitung`() {
        val schritt = step(web(elwGeladen, offline = true), ergebnis(zertifikat, elwGeladen))
        assertEquals(Ablauf.Seite.Status(elwGeladen, Statusseite.Zertifikat), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `offline geladen und Hauptnavigation scheitert zeigt nicht erreichbar`() {
        val schritt = step(
            web(elwGeladen, offline = true),
            Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.VERBINDUNG, elwGeladen.let { URI(it.adresse.text) }),
        )
        assertEquals(Ablauf.Seite.Status(elwGeladen, Statusseite.NichtErreichbar), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), schritt.effects)
    }

    @Test
    fun `offline geladen prüft weiter und lädt bei Rückkehr des Servers nicht neu`() {
        val offline = web(elwGeladen, offline = true)
        val a = step(offline, Ablauf.Event.Wiederholen)
        assertEquals(offline, a.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elwGeladen)), a.effects)
        val b = step(a.seite, ergebnis(vertraeglich, elwGeladen))
        assertEquals(web(elwGeladen, offline = false), b.seite)
        assertEquals(listOf(Ablauf.Effect.MarkVerbunden(elwGeladen.id, 1)), b.effects)
        val c = step(a.seite, ergebnis(nichtErreichbar, elwGeladen))
        assertEquals(offline, c.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), c.effects)
    }

    @Test
    fun `ein jetzt unverträglicher Server führt aus der Offline-Oberfläche auf die Status-Seite`() {
        val neu = ShellInfo("2.0.0", 2)
        val schritt = step(
            web(elwGeladen, offline = true),
            ergebnis(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, neu), elwGeladen),
        )
        assertEquals(
            Ablauf.Seite.Status(elwGeladen, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0")),
            schritt.seite,
        )
    }

    @Test
    fun `auf der Status-Seite lädt ein geladener Server nicht erneut offline`() {
        val status = Ablauf.Seite.Status(elwGeladen, Statusseite.NichtErreichbar)
        val schritt = step(status, ergebnis(nichtErreichbar, elwGeladen))
        assertEquals(status, schritt.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), schritt.effects)
    }

    @Test
    fun `nach dem ersten geladenen Commit merkt sich die App das Profil`() {
        val schritt = step(web(elw), Ablauf.Event.SeiteGeladen(eigen))
        assertTrue(Ablauf.Effect.MarkGeladen(elw.id) in schritt.effects)
        val schonGemerkt = step(web(elwGeladen), Ablauf.Event.SeiteGeladen(eigen))
        assertFalse(schonGemerkt.effects.any { it is Ablauf.Effect.MarkGeladen })
        // Eine fremde Seite und eine leere Seite machen den Server nicht zum geladenen.
        assertEquals(emptyList(), step(web(elw), Ablauf.Event.SeiteGeladen(idp)).effects)
        assertEquals(emptyList(), step(web(elw), Ablauf.Event.SeiteGeladen(URI("about:blank"))).effects)
    }

    // Vordergrund

    @Test
    fun `Rückkehr mit lebender Seite prüft ohne Neuzuladen`() {
        val schritt = step(web(), vordergrund(true, eigen))
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
        val ok = step(schritt.seite, ergebnis(vertraeglich))
        assertEquals(web(), ok.seite)
        assertEquals(listOf(Ablauf.Effect.MarkVerbunden(elw.id, 1)), ok.effects)
    }

    @Test
    fun `Rückkehr ohne Netz lässt die geladene Seite stehen`() {
        val schritt = step(web(), ergebnis(nichtErreichbar))
        assertEquals(web(), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `Rückkehr mit Zertifikatsfehler zeigt die Anleitung auch bei geladener Seite`() {
        val schritt = step(web(), ergebnis(zertifikat))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.Zertifikat), schritt.seite)
        assertEquals(emptyList(), schritt.effects)
    }

    @Test
    fun `Rückkehr zu einem gehobenen Server zeigt App aktualisieren`() {
        val neu = ShellInfo("2.0.0", 2)
        val schritt = step(web(), ergebnis(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, neu)))
        assertEquals(
            Ablauf.Seite.Status(elw, Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0")),
            schritt.seite,
        )
    }

    @Test
    fun `Rückkehr mit toter Seite prüft und lädt neu`() {
        val schritt = step(web(), vordergrund(false, null))
        assertEquals(Ablauf.Seite.Pruefung(elw), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
    }

    @Test
    fun `Rückkehr auf einer Status-Seite prüft erneut`() {
        for (status in listOf(
            Statusseite.Zertifikat,
            Statusseite.NichtErreichbar,
            Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, null),
        )) {
            val schritt = step(Ablauf.Seite.Status(elw, status), vordergrund(false, null))
            assertEquals(Ablauf.Seite.Status(elw, status), schritt.seite)
            assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
        }
        assertEquals(emptyList(), step(Ablauf.Seite.Onboarding, vordergrund(false, null)).effects)
        assertEquals(emptyList(), step(Ablauf.Seite.Pruefung(elw), vordergrund(false, null)).effects)
    }

    // Zur Oberfläche

    @Test
    fun `Zur Oberfläche lädt die Startadresse des aktiven Servers neu`() {
        val schritt = step(web(), Ablauf.Event.ZurOberflaeche)
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.HideZurOberflaeche, Ablauf.Effect.Load(elw)), schritt.effects)
    }

    @Test
    fun `Zur Oberfläche auf einer Status-Seite prüft erneut`() {
        for (status in listOf(
            Statusseite.Zertifikat,
            Statusseite.NichtErreichbar,
            Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, null),
        )) {
            val schritt = step(Ablauf.Seite.Status(elw, status), Ablauf.Event.ZurOberflaeche)
            assertEquals(Ablauf.Seite.Pruefung(elw), schritt.seite)
            assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
        }
    }

    @Test
    fun `Zur Oberfläche ohne Server oder während der Prüfung tut nichts`() {
        for (seite in listOf(Ablauf.Seite.Onboarding, Ablauf.Seite.Pruefung(elw))) {
            val schritt = step(seite, Ablauf.Event.ZurOberflaeche)
            assertEquals(seite, schritt.seite)
            assertEquals(emptyList(), schritt.effects, "$seite")
        }
    }

    @Test
    fun `die Serverliste bietet Zur Oberfläche nur mit Serverseite`() {
        assertTrue(Ablauf.bietetZurOberflaeche(web()))
        assertTrue(Ablauf.bietetZurOberflaeche(Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar)))
        assertFalse(Ablauf.bietetZurOberflaeche(Ablauf.Seite.Pruefung(elw)))
        assertFalse(Ablauf.bietetZurOberflaeche(Ablauf.Seite.Onboarding))
        assertFalse(Ablauf.bietetZurOberflaeche(Ablauf.Seite.WebviewVeraltet))
    }

    @Test
    fun `Rückkehr auf einer fremden Seite bietet den Weg zurück`() {
        val schritt = step(web(), vordergrund(true, idp))
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Check(elw), Ablauf.Effect.ShowZurOberflaeche), schritt.effects)
    }

    @Test
    fun `Rückkehr während einer Anmeldung bietet nichts an`() {
        val schritt = step(web(), vordergrund(true, idp, anmeldung = true))
        assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects)
    }

    @Test
    fun `Rückkehr auf der Seite des Servers bietet nichts an`() {
        for (adresse in listOf(eigen, URI("https://ELW.local:8443/login"), null)) {
            val schritt = step(web(), vordergrund(true, adresse))
            assertEquals(listOf(Ablauf.Effect.Check(elw)), schritt.effects, "$adresse")
        }
        // Eine andere Origin desselben Hosts ist fremd.
        val anderePort = step(web(), vordergrund(true, URI("https://elw.local/")))
        assertEquals(listOf(Ablauf.Effect.Check(elw), Ablauf.Effect.ShowZurOberflaeche), anderePort.effects)
    }

    @Test
    fun `die Seite des Servers nimmt den Hinweis zurück`() {
        val zurueck = step(web(elwGeladen), Ablauf.Event.SeiteGeladen(eigen))
        assertEquals(web(elwGeladen), zurueck.seite)
        assertEquals(listOf(Ablauf.Effect.HideZurOberflaeche), zurueck.effects)
        assertEquals(emptyList(), step(web(), Ablauf.Event.SeiteGeladen(idp)).effects)
        assertEquals(emptyList(), step(web(), Ablauf.Event.SeiteGeladen(null)).effects)
        assertEquals(emptyList(), step(Ablauf.Seite.Pruefung(elw), Ablauf.Event.SeiteGeladen(eigen)).effects)
    }

    @Test
    fun `eine leere Seite vor dem Ladefehler bleibt ohne Wirkung`() {
        val leer = step(web(), Ablauf.Event.SeiteGeladen(URI("about:blank")))
        assertEquals(web(), leer.seite)
        assertEquals(emptyList(), leer.effects)
        val danach = step(leer.seite, Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.VERBINDUNG, eigen))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar), danach.seite)
    }

    // WebView

    @Test
    fun `nach dem Ende des Web-Prozesses lädt die App neu`() {
        val schritt = step(web(), Ablauf.Event.WebProzessBeendet)
        assertEquals(web(), schritt.seite)
        assertEquals(listOf(Ablauf.Effect.Reload), schritt.effects)
        assertEquals(emptyList(), step(Ablauf.Seite.Status(elw, Statusseite.Zertifikat), Ablauf.Event.WebProzessBeendet).effects)
    }

    @Test
    fun `ein Navigationsfehler des Servers zeigt seine Fehlerklasse`() {
        val zert = step(web(), Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.ZERTIFIKAT, eigen))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.Zertifikat), zert.seite)
        assertEquals(emptyList(), zert.effects)
        val weg = step(web(), Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.VERBINDUNG, null))
        assertEquals(Ablauf.Seite.Status(elw, Statusseite.NichtErreichbar), weg.seite)
        assertEquals(listOf(Ablauf.Effect.ScheduleRetry), weg.effects)
    }

    @Test
    fun `ein abgebrochener oder fremder Ladevorgang bleibt ohne Wirkung`() {
        val a = step(web(), Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.ABGEBROCHEN, eigen))
        assertEquals(web(), a.seite)
        // Der Identitätsanbieter ist nicht der Server; die Seite des WebViews meldet den Fehler.
        val b = step(web(), Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.VERBINDUNG, URI("https://idp.example/login")))
        assertEquals(web(), b.seite)
        assertEquals(emptyList(), b.effects)
    }

    // Status-Seite aus dem Ergebnis

    @Test
    fun `Statusseite aus dem Ergebnis`() {
        assertNull(Statusseite.from(vertraeglich, null))
        assertEquals(Statusseite.Zertifikat, Statusseite.from(zertifikat, null))
        assertEquals(Statusseite.NichtErreichbar, Statusseite.from(nichtErreichbar, null))
    }

    @Test
    fun `das Intervall der Wiederholung ist kurz`() {
        assertEquals(5_000L, Ablauf.WIEDERHOL_INTERVALL_MS)
    }
}
