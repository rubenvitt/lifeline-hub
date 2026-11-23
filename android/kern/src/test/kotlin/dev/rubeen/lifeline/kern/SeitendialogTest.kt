package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Dialoge der Seite (`alert`, `confirm`, `prompt`) als native Dialoge. */
class SeitendialogTest {
    private val elw = SeitenOrigin("https", "elw.local", 8443)

    @Test
    fun `die Art folgt dem Aufruf`() {
        assertEquals(Seitendialog.Art.Hinweis, Seitendialog(Seitendialog.Art.Hinweis, "Gespeichert", elw).art)
        assertEquals(Seitendialog.Art.Rueckfrage, Seitendialog(Seitendialog.Art.Rueckfrage, "Löschen?", elw).art)
        assertEquals(
            Seitendialog.Art.Eingabe("ELW"),
            Seitendialog(Seitendialog.Art.Eingabe("ELW"), "Name?", elw).art,
        )
    }

    @Test
    fun `die Nachricht bleibt wie die Seite sie schickt`() {
        val dialog = Seitendialog(Seitendialog.Art.Rueckfrage, "Tier „Rex“ löschen?\nNicht rückgängig.", elw)
        assertEquals("Tier „Rex“ löschen?\nNicht rückgängig.", dialog.nachricht)
    }

    @Test
    fun `eine überlange Nachricht wird gekürzt`() {
        val lang = "a".repeat(Seitendialog.MAX_ZEICHEN + 50)
        val dialog = Seitendialog(Seitendialog.Art.Hinweis, lang, elw)
        assertEquals(Seitendialog.MAX_ZEICHEN + 1, dialog.nachricht.length)
        assertTrue(dialog.nachricht.endsWith("…"))
        val genau = "b".repeat(Seitendialog.MAX_ZEICHEN)
        assertEquals(genau, Seitendialog(Seitendialog.Art.Hinweis, genau, elw).nachricht)
        // Ein Emoji zählt als ein Zeichen und wird nicht mittendrin zerschnitten.
        val emoji = "😀".repeat(Seitendialog.MAX_ZEICHEN + 1)
        val gekuerzt = Seitendialog(Seitendialog.Art.Hinweis, emoji, elw).nachricht
        assertEquals("😀".repeat(Seitendialog.MAX_ZEICHEN) + "…", gekuerzt)
    }

    @Test
    fun `der Titel ist der Host des Frames`() {
        val faelle = listOf(
            elw to "elw.local:8443",
            SeitenOrigin("https", "lager.example", -1) to "lager.example",
            SeitenOrigin("https", "lager.example", 0) to "lager.example",
            SeitenOrigin("https", "lager.example", 443) to "lager.example",
            SeitenOrigin("https", "IdP.Example", -1) to "idp.example",
            SeitenOrigin("http", "idp.example", 80) to "http://idp.example",
            SeitenOrigin("http", "idp.example", 8080) to "http://idp.example:8080",
        )
        for ((origin, titel) in faelle) {
            assertEquals(titel, Seitendialog.titel(origin), "$origin")
            assertEquals(titel, Seitendialog(Seitendialog.Art.Hinweis, "x", origin).titel, "$origin")
        }
    }

    @Test
    fun `ohne Host heißt der Titel Diese Seite`() {
        for (origin in listOf(SeitenOrigin("file", "", -1), SeitenOrigin("", "", -1), SeitenOrigin("about", "  ", -1))) {
            assertEquals(Seitendialog.OHNE_HOST, Seitendialog.titel(origin), "$origin")
        }
        assertEquals("Diese Seite", Seitendialog.OHNE_HOST)
    }

    @Test
    fun `nur der Hinweis hat keinen Abbrechen-Knopf`() {
        assertNull(Seitendialog(Seitendialog.Art.Hinweis, "x", elw).abbrechenTitel)
        assertEquals("Abbrechen", Seitendialog(Seitendialog.Art.Rueckfrage, "x", elw).abbrechenTitel)
        assertEquals("Abbrechen", Seitendialog(Seitendialog.Art.Eingabe(null), "x", elw).abbrechenTitel)
        assertEquals("OK", Seitendialog.OK_TITEL)
    }

    @Test
    fun `nur die Eingabe hat ein Feld mit Vorgabe`() {
        assertFalse(Seitendialog(Seitendialog.Art.Hinweis, "x", elw).hasFeld)
        assertFalse(Seitendialog(Seitendialog.Art.Rueckfrage, "x", elw).hasFeld)
        assertNull(Seitendialog(Seitendialog.Art.Rueckfrage, "x", elw).feldVorgabe)
        val eingabe = Seitendialog(Seitendialog.Art.Eingabe("ELW 1"), "x", elw)
        assertTrue(eingabe.hasFeld)
        assertEquals("ELW 1", eingabe.feldVorgabe)
        assertEquals("", Seitendialog(Seitendialog.Art.Eingabe(null), "x", elw).feldVorgabe)
    }

    @Test
    fun `confirm ist nur nach OK wahr`() {
        assertTrue(Seitendialog.confirmWert(Seitendialog.Ergebnis.Ok(null)))
        assertTrue(Seitendialog.confirmWert(Seitendialog.Ergebnis.Ok("egal")))
        assertFalse(Seitendialog.confirmWert(Seitendialog.Ergebnis.Abgebrochen))
        assertFalse(Seitendialog.confirmWert(null))
    }

    @Test
    fun `prompt liefert den Text oder nichts`() {
        assertEquals("Rex", Seitendialog.promptWert(Seitendialog.Ergebnis.Ok("Rex")))
        assertEquals("", Seitendialog.promptWert(Seitendialog.Ergebnis.Ok("")))
        // Ein leeres Feld ohne Text gibt wie im Browser die leere Zeichenkette, nicht null.
        assertEquals("", Seitendialog.promptWert(Seitendialog.Ergebnis.Ok(null)))
        assertNull(Seitendialog.promptWert(Seitendialog.Ergebnis.Abgebrochen))
        assertNull(Seitendialog.promptWert(null))
    }

    @Test
    fun `die Beispielseite der Oberflächentests löst eine Rückfrage aus`() {
        val seite = Testzustand.BEISPIELSEITE
        assertTrue("id=\"rueckfrage\"" in seite)
        assertTrue("confirm(" in seite)
        assertTrue("id=\"antwort\"" in seite)
    }
}
