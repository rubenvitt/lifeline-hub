package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Texte der nativen Status-Seiten. */
class StatustextTest {
    @Test
    fun `zu neu heißt App aktualisieren mit beiden Versionen`() {
        val text = Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0").text("ELW 1", "1.0.0-alpha.320")
        assertEquals("App aktualisieren", text.titel)
        assertTrue("2.0.0" in text.text, text.text)
        assertTrue("1.0.0-alpha.320" in text.text, text.text)
        assertTrue("ELW 1" in text.text, text.text)
    }

    @Test
    fun `App aktualisieren verweist auf das Update der App`() {
        val text = Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0").text("ELW 1", "1.0.0")
        assertTrue(text.text.endsWith("Bitte die App aktualisieren."), text.text)
        assertTrue("TestFlight" !in text.text)
    }

    @Test
    fun `zu alt heißt Server ist zu alt`() {
        val text = Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, "1.0.0-alpha.200").text("ELW 1", "1.0.0-alpha.320")
        assertEquals("Server ist zu alt für diese App", text.titel)
        assertTrue("1.0.0-alpha.200" in text.text, text.text)
        assertTrue("1.0.0-alpha.320" in text.text, text.text)
    }

    @Test
    fun `ohne Versionen sagt der Text das`() {
        val text = Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, null).text("ELW 1", null)
        assertTrue("unbekannt" in text.text, text.text)
    }

    @Test
    fun `Zertifikat nennt den Android-Weg`() {
        val text = Statusseite.Zertifikat.text("elw.local", null)
        assertEquals("Zertifikat nicht vertrauenswürdig", text.titel)
        assertEquals(
            listOf(
                "CA-Zertifikat auf das Gerät laden.",
                "Unter Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Zertifikat installieren → CA-Zertifikat die Datei des Zertifikats auswählen (der Menüpfad heißt je nach Hersteller etwas anders).",
                "Zurück in die App wechseln oder „Erneut prüfen“ tippen.",
            ),
            text.schritte,
        )
        assertEquals(
            "Dieses Gerät vertraut dem Zertifikat von „elw.local“ nicht. Ein Server im Einsatz-LAN braucht das CA-Zertifikat (mkcert oder eigene CA) auf diesem Gerät.",
            text.text,
        )
    }

    @Test
    fun `nicht erreichbar verspricht das automatische Laden`() {
        val text = Statusseite.NichtErreichbar.text("elw.local", null)
        assertEquals("Server nicht erreichbar", text.titel)
        assertTrue("elw.local" in text.text)
        assertTrue("sobald" in text.text)
        assertEquals(emptyList(), text.schritte)
    }

    @Test
    fun `veralteter System-WebView hat eine eigene Seite`() {
        val text = Statusseite.WebviewVeraltet.text(null, null)
        assertEquals("System-WebView aktualisieren", text.titel)
        assertEquals(
            "Diese App braucht einen aktuellen System-WebView, damit jeder Server seine eigenen Daten hat. Bitte „Android System WebView“ über Google Play aktualisieren.",
            text.text,
        )
        assertEquals(emptyList(), text.schritte)
    }

    @Test
    fun `die Seite folgt dem Vertragsergebnis`() {
        val info = ShellInfo("1.0.0", 1)
        assertNull(Statusseite.from(Vertragsergebnis.Vertraeglich(info), null))
        assertEquals(Statusseite.Zertifikat, Statusseite.from(Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT), null))
        assertEquals(Statusseite.NichtErreichbar, Statusseite.from(Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR), null))
        // Die Version aus /api/shell geht vor der aus /api/health.
        assertEquals(
            Statusseite.NichtVertraeglich(Fehlerklasse.ZU_NEU, "2.0.0"),
            Statusseite.from(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, ShellInfo("2.0.0", 2)), "9.9.9"),
        )
        assertEquals(
            Statusseite.NichtVertraeglich(Fehlerklasse.ZU_ALT, "1.0.0-alpha.12"),
            Statusseite.from(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null), "1.0.0-alpha.12"),
        )
    }
}
