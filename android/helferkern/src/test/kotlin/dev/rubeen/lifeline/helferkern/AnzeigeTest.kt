package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Texte der Seiten, die ohne Oberfläche feststehen (gleich wie in `ios/Helfer/App`). */
class AnzeigeTest {
    @Test
    fun `das Alter der letzten Sendung in Sekunden, Minuten und Stunden`() {
        assertEquals("vor 0 s", Anzeige.alter(-3))
        assertEquals("vor 59 s", Anzeige.alter(59))
        assertEquals("vor 1 min", Anzeige.alter(60))
        assertEquals("vor 59 min", Anzeige.alter(3599))
        assertEquals("vor 2 h", Anzeige.alter(7200))
    }

    @Test
    fun `abgewiesene Anfragen bekommen einen Satz`() {
        assertEquals(
            "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut.",
            Anzeige.meldung(0),
        )
        assertEquals("Der Code ist ungültig oder abgelaufen. Bitte den QR-Code neu scannen.", Anzeige.meldung(401))
        assertEquals("Die Ortung ist für diese Organisation ausgeschaltet.", Anzeige.meldung(403, reason = "tracking_off"))
        assertEquals("Die Ortung ist für diese Organisation ausgeschaltet.", Anzeige.meldung(403))
        assertEquals("Auf diesem Gerät ist eine persönliche Anmeldung aktiv.", Anzeige.meldung(409, reason = "person_session"))
        assertEquals("Das geht im aktuellen Zustand der Anmeldung nicht.", Anzeige.meldung(409))
        assertEquals("Name zu lang", Anzeige.meldung(422, error = "Name zu lang"))
        assertEquals("Die Angaben passen nicht. Bitte prüfen.", Anzeige.meldung(422))
        assertEquals("Zu viele Versuche. Bitte kurz warten.", Anzeige.meldung(429))
        assertEquals("Unerwartete Antwort des Servers (500).", Anzeige.meldung(500))
    }

    @Test
    fun `Code eingeben ergibt den Link des QR-Codes`() {
        assertEquals("https://elw.local:8443/helfer#AB12CD34", Anzeige.eingabeLink(" elw.local:8443/ ", "AB12 CD34"))
        assertEquals("https://elw.example.org/helfer#X", Anzeige.eingabeLink("https://elw.example.org", "X"))
        assertEquals("HTTPS://a.b/helfer#X", Anzeige.eingabeLink("HTTPS://a.b//", "X"))
        assertNull(Anzeige.eingabeLink("elw.local", "  "))
    }

    @Test
    fun `eingegebene Links deutet der Kern wie einen QR-Code`() {
        val link = Anzeige.eingabeLink("elw.local:8443", "ab12cd34")!!
        assertEquals("AB12CD34", deuteHelferLink(link)?.code)
        assertNull(Anzeige.eingabeLink("http://elw.local", "X")?.let(::deuteHelferLink))
    }

    @Test
    fun `das taktische Zeichen als Text aus Organisation und Fachaufgabe`() {
        assertEquals("DRK · Sanitätsdienst", Anzeige.zeichen("DRK", "Sanitätsdienst"))
        assertEquals("Betreuung", Anzeige.zeichen(null, "Betreuung"))
        assertNull(Anzeige.zeichen("", null))
    }
}
