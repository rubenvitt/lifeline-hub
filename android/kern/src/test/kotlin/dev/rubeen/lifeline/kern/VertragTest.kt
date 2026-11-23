package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

/**
 * Vertragsprüfung gegen `GET /api/shell`: die App lädt nur einen verträglichen Server, und ein
 * Server ohne Vertrag gilt als zu alt.
 */
class VertragTest {
    private fun shell(vertrag: Int, version: String = "1.0.0-alpha.300") =
        ShellAbruf.Antwort(200, """{"version":"$version","shell_contract":$vertrag}""", "application/json")

    private fun antwort(status: Int, body: String = "", typ: String? = "text/html") = ShellAbruf.Antwort(status, body, typ)

    @Test
    fun `ShellInfo liest die Wire-Felder und ignoriert neue`() {
        val json = """{"version":"1.0.0-alpha.300","shell_contract":2,"assets":["a.js"]}"""
        val info = Json { ignoreUnknownKeys = true }.decodeFromString(ShellInfo.serializer(), json)
        assertEquals(ShellInfo("1.0.0-alpha.300", 2), info)
    }

    /** Vertrag 2 (LLH-1979): der Login-Pfad heißt `/api/auth/app-code/redeem`. */
    @Test
    fun `die App kennt genau den zweiten Vertrag`() {
        assertEquals(listOf(2), LifelineKern.bekannteVertraege)
    }

    /** Ein Server mit Vertrag 1 kennt nur `/api/auth/app-code/einloesen`: für die App zu alt. */
    @Test
    fun `ein Server mit Vertrag 1 ist zu alt`() {
        assertEquals(
            Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, ShellInfo("1.0.0-alpha.300", 1)),
            Vertragspruefung.evaluate(shell(1), null),
        )
    }

    @Test
    fun `ein bekannter Vertrag ist verträglich`() {
        assertEquals(
            Vertragsergebnis.Vertraeglich(ShellInfo("1.0.0-alpha.300", 2)),
            Vertragspruefung.evaluate(shell(2), null),
        )
    }

    @Test
    fun `ein größerer Vertrag heißt App aktualisieren`() {
        assertEquals(
            Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, ShellInfo("2.0.0", 3)),
            Vertragspruefung.evaluate(shell(3, "2.0.0"), 2),
        )
        assertEquals(Fehlerklasse.ZU_NEU, Vertragspruefung.evaluate(shell(3), 2).fehlerklasse)
    }

    @Test
    fun `ein kleinerer Vertrag heißt Server zu alt`() {
        assertEquals(Fehlerklasse.ZU_ALT, Vertragspruefung.evaluate(shell(1), null, listOf(2, 3)).fehlerklasse)
    }

    @Test
    fun `ohne Endpunkt ist der Server zu alt`() {
        assertEquals(
            Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null),
            Vertragspruefung.evaluate(antwort(404, typ = "text/plain"), 2),
        )
        // JSON ohne lesbaren Vertrag nennt keinen Vertrag.
        for (typ in listOf("application/json", "application/json; charset=utf-8", "Application/JSON")) {
            assertEquals(
                Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_ALT, null),
                Vertragspruefung.evaluate(antwort(200, """{"status":"ok"}""", typ), 2),
                typ,
            )
        }
    }

    @Test
    fun `der Vertrag gilt auch mit Zeichensatz im ContentType`() {
        val abruf = antwort(200, """{"version":"1.0.0","shell_contract":2}""", "application/json; charset=utf-8")
        assertEquals(Vertragsergebnis.Vertraeglich(ShellInfo("1.0.0", 2)), Vertragspruefung.evaluate(abruf, null))
    }

    /** Ein Captive Portal antwortet mit 200 und HTML: das ist nicht der Server. */
    @Test
    fun `eine 200 ohne JSON ist nicht der Server`() {
        val portal = "<!doctype html><title>WLAN-Anmeldung</title>"
        for (typ in listOf("text/html", "text/html; charset=utf-8", "text/plain", null)) {
            val abruf = antwort(200, portal, typ)
            assertEquals(
                Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
                Vertragspruefung.evaluate(abruf, 2),
                "$typ",
            )
            assertEquals(
                Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
                Vertragspruefung.evaluate(abruf, null),
                "$typ",
            )
            assertEquals(
                Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, null),
                Vertragspruefung.evaluate(abruf, 3),
                "$typ",
            )
        }
        assertEquals(
            Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
            Vertragspruefung.evaluate(antwort(200, """{"version":"9","shell_contract":2}""", "text/html"), null),
        )
    }

    @Test
    fun `eine Weiterleitung ist wie ohne Verbindung`() {
        for (status in listOf(301, 302, 303, 307, 308)) {
            assertEquals(
                Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
                Vertragspruefung.evaluate(antwort(status), 2),
                "$status",
            )
        }
    }

    @Test
    fun `nur Weiterleitungen auf derselben Origin werden verfolgt`() {
        val shell = URI.create("https://elw.local:8443/api/shell")
        assertTrue(Vertragspruefung.followsRedirect(shell, URI.create("https://ELW.local:8443/api/shell/")))
        for (ziel in listOf(
            "https://portal.example/login",
            "https://elw.local/api/shell",
            "http://elw.local:8443/api/shell",
            "https://elw.local:8444/api/shell",
        )) {
            assertFalse(Vertragspruefung.followsRedirect(shell, URI.create(ziel)), ziel)
        }
        assertFalse(Vertragspruefung.followsRedirect(null, shell))
        assertFalse(Vertragspruefung.followsRedirect(shell, null))
    }

    @Test
    fun `JSON erkennt den Medientyp`() {
        for (typ in listOf("application/json", " application/json ; charset=utf-8", "APPLICATION/JSON")) {
            assertTrue(ShellAbruf.isJson(typ), typ)
        }
        for (typ in listOf("text/html", "application/jsonp", "text/json-ish", "", null)) {
            assertFalse(ShellAbruf.isJson(typ), typ ?: "null")
        }
    }

    @Test
    fun `die Version eines zu alten Servers kommt aus Health`() {
        assertEquals("1.0.0-alpha.12", healthVersion("""{"status":"degraded","version":"1.0.0-alpha.12","db":false}"""))
        assertNull(healthVersion("kein json"))
        assertNull(healthVersion("""{"status":"ok"}"""))
    }

    /** Ohne Netz gilt der zuletzt bestätigte Vertrag: „nicht erreichbar“, nicht „nicht verträglich“. */
    @Test
    fun `ohne Netz gilt der zuletzt bestätigte Vertrag`() {
        val fehler = ShellAbruf.Fehler(Netzfehler.VERBINDUNG)
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR), Vertragspruefung.evaluate(fehler, 2))
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR), Vertragspruefung.evaluate(fehler, null))
        assertEquals(Vertragsergebnis.NichtVertraeglich(Fehlerklasse.ZU_NEU, null), Vertragspruefung.evaluate(fehler, 3))
        assertEquals(
            Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR),
            Vertragspruefung.evaluate(antwort(502), 2),
        )
    }

    @Test
    fun `ein Zertifikatsfehler ist kein Nicht-erreichbar`() {
        val fehler = ShellAbruf.Fehler(Netzfehler.ZERTIFIKAT)
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT), Vertragspruefung.evaluate(fehler, 2))
        // Auch ein zuletzt unverträglicher Server zeigt zuerst die Anleitung zum Zertifikat:
        // ohne Vertrauen erfährt die App den heutigen Vertrag nicht.
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT), Vertragspruefung.evaluate(fehler, 3))
    }

    @Test
    fun `ein abgebrochener Abruf ist kein Fehler der Seite`() {
        val ergebnis = Vertragspruefung.evaluate(ShellAbruf.Fehler(Netzfehler.ABGEBROCHEN), 2)
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.NICHT_ERREICHBAR), ergebnis)
    }

    @Test
    fun `die Richtung eines unbekannten Vertrags`() {
        assertNull(Vertragspruefung.richtung(1, listOf(1)))
        assertEquals(Fehlerklasse.ZU_NEU, Vertragspruefung.richtung(2, listOf(1)))
        assertEquals(Fehlerklasse.ZU_ALT, Vertragspruefung.richtung(0, listOf(1)))
    }
}
