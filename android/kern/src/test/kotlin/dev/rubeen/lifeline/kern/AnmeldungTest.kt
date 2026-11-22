package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * „Im Browser anmelden“ in der Android-Hülle (Entwurf D7; Vorbild `AnmeldungTests.swift`,
 * `src-tauri/src/pkce.rs` und `src-tauri/src/anmeldung.rs`, deren Testvektoren hier wiederkehren).
 */
class AnmeldungTest {
    private val code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    private val server = ServerAdresse.parse("https://elw.local:8443")

    // PKCE

    @Test
    fun `Challenge nach RFC 7636 Anhang B`() {
        // Der Verifier steht im RFC so (Anhang B), die Challenge ist die dortige S256-Ableitung.
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            PKCE.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun `der Verifier hat 43 base64url-Zeichen und ist jedes Mal neu`() {
        val a = PKCE.neuerVerifier()
        val b = PKCE.neuerVerifier()
        assertEquals(43, a.length)
        assertTrue(a.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' || it == '_' }, a)
        assertNotEquals(a, b)
        assertEquals(43, PKCE.challenge(a).length)
    }

    // Adressen

    @Test
    fun `die Bestätigung liegt auf der Origin des Servers`() {
        assertEquals(
            URI("https://elw.local:8443/app-anmeldung?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),
            Anmeldung.bestaetigungUrl(server, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),
        )
        assertEquals(
            URI("https://lager.example/app-anmeldung?challenge=x"),
            Anmeldung.bestaetigungUrl(ServerAdresse.parse("https://lager.example"), "x"),
        )
    }

    @Test
    fun `Code nur aus dem Anmelde-Rücksprung`() {
        assertEquals(code, Anmeldung.code("lifeline://anmeldung?code=$code"))
        assertEquals(code, Anmeldung.code("LIFELINE://anmeldung/?code=$code"))
        for (fremd in listOf(
            "lifeline://verbinden?code=$code",
            "andere://anmeldung?code=$code",
            "lifeline://anmeldung/x?code=$code",
            "lifeline://anmeldung?code=abc",
            "lifeline://anmeldung?code=${code.uppercase()}",
            "lifeline://anmeldung",
            "kein link",
        )) {
            assertNull(Anmeldung.code(fremd), fremd)
        }
    }

    /**
     * Ein `lifeline://anmeldung?code=…` von außen (Intent-Filter) ist kein Deeplink: die App
     * verbindet nichts und löst nichts ein (Entwurf D7: Untergeschobener Rücksprung).
     */
    @Test
    fun `ein Rücksprung von außen ist kein Deeplink`() {
        assertNull(Deeplink.parse("lifeline://anmeldung?code=$code"))
        assertNull(Deeplink.parse("lifeline://anmeldung?code=$code&server=https://elw.local:8443"))
    }

    // Ende der Sitzung

    @Test
    fun `Folge nach dem Ende der Sitzung`() {
        val seite = URI("https://elw.local:8443/login")
        val fremd = URI("https://id.rubeen.dev/login")
        val andereSeite = URI("https://elw.local:8443/einsaetze")
        val ruecksprung = Anmeldung.Ende.Ruecksprung("lifeline://anmeldung?code=$code")

        assertEquals(Anmeldung.Folge.Einloesen(code), Anmeldung.folge(ruecksprung, seite, server))
        assertEquals(Anmeldung.Folge.Nichts, Anmeldung.folge(ruecksprung, fremd, server))
        assertEquals(Anmeldung.Folge.Nichts, Anmeldung.folge(ruecksprung, null, server))
        // Eingelöst wird nur auf der Anmeldeseite.
        assertEquals(Anmeldung.Folge.Nichts, Anmeldung.folge(ruecksprung, andereSeite, server))
        assertEquals(Anmeldung.Folge.Nichts, Anmeldung.folge(Anmeldung.Ende.Abgebrochen, fremd, server))
        assertEquals(Anmeldung.Folge.Nichts, Anmeldung.folge(Anmeldung.Ende.Fehler, null, server))
        assertEquals(
            Anmeldung.Folge.Melden(Anmeldung.Ergebnis.FEHLER),
            Anmeldung.folge(Anmeldung.Ende.Ruecksprung("lifeline://anmeldung?code=kaputt"), seite, server),
        )
        assertEquals(
            Anmeldung.Folge.Melden(Anmeldung.Ergebnis.ABGEBROCHEN),
            Anmeldung.folge(Anmeldung.Ende.Abgebrochen, seite, server),
        )
        assertEquals(
            Anmeldung.Folge.Melden(Anmeldung.Ergebnis.FEHLER),
            Anmeldung.folge(Anmeldung.Ende.Fehler, andereSeite, server),
        )
    }

    @Test
    fun `Ergebnisse tragen die Kennwörter der Seite`() {
        // frontend/src/huelle/faehigkeiten.ts, `AppAnmeldungErgebnis`
        assertEquals(
            listOf("angemeldet", "abgelehnt", "fehler", "abgebrochen"),
            Anmeldung.Ergebnis.entries.map { it.kennwort },
        )
        assertEquals("lifeline:app-anmeldung", Anmeldung.EREIGNIS)
        assertEquals("/login", Anmeldung.ANMELDESEITE)
        assertEquals("/app-anmeldung", Anmeldung.BESTAETIGUNG)
        assertEquals("anmeldung", Anmeldung.RUECKSPRUNG_HOST)
    }

    // Skripte

    @Test
    fun `das Einlöse-Skript kodiert und prüft die Origin`() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val skript = Anmeldung.einloeseSkript(server, code, verifier)
        assertTrue("""window.location.origin !== "https:\/\/elw.local:8443"""" in skript, skript)
        assertTrue("'/api/auth/app-code/einloesen'" in skript, skript)
        assertTrue("""code: "$code"""" in skript, skript)
        assertTrue("""verifier: "$verifier"""" in skript, skript)
        assertEquals(1, skript.split(code).size - 1)
        assertEquals(1, skript.split(verifier).size - 1)
        assertTrue(""""lifeline:app-anmeldung"""" in skript, skript)
        assertFalse("\n" in skript, skript)
        // Endet auf einem Wert: `evaluateJavascript` liefert bei einem Promise sonst Unbrauchbares.
        assertTrue(skript.endsWith("0;"), skript)
    }

    @Test
    fun `Literale brechen nicht aus`() {
        val skript = Anmeldung.einloeseSkript(server, "a\"b'c\\d", "x\"); alert(1); (\"")
        assertTrue("""code: "a\"b'c\\d"""" in skript, skript)
        assertFalse("""x"); alert""" in skript, skript)
    }

    @Test
    fun `die Meldung trägt nur das Ergebnis`() {
        val skript = Anmeldung.meldungSkript(Anmeldung.Ergebnis.ABGEBROCHEN)
        assertTrue(""""lifeline:app-anmeldung"""" in skript, skript)
        assertTrue("""ergebnis: "abgebrochen"""" in skript, skript)
        assertFalse("fetch" in skript)
    }

    // Lauf

    @Test
    fun `ein alter Handler beendet die neue Sitzung nicht`() {
        val lauf = Anmeldelauf<String>()
        val alt = lauf.naechste()
        lauf.merke(alt, "alt")
        assertEquals("alt", lauf.nimm())
        val neu = lauf.naechste()
        lauf.merke(neu, "neu")
        assertNull(lauf.beende(alt))
        assertEquals("neu", lauf.beende(neu))
        assertNull(lauf.beende(neu))
    }

    @Test
    fun `laufend gilt vom Merken bis zum Ende`() {
        val lauf = Anmeldelauf<String>()
        assertFalse(lauf.isLaufend)
        val generation = lauf.naechste()
        assertFalse(lauf.isLaufend)
        lauf.merke(generation, "a")
        assertTrue(lauf.isLaufend)
        lauf.beende(generation)
        assertFalse(lauf.isLaufend)
        lauf.merke(lauf.naechste(), "b")
        lauf.nimm()
        assertFalse(lauf.isLaufend)
    }

    @Test
    fun `ein Rücksprung ohne laufende Anmeldung bleibt wirkungslos`() {
        // Die App wertet einen Rücksprung nur aus, wenn `nimm()` die Sitzung herausgibt (Entwurf D7).
        val lauf = Anmeldelauf<String>()
        assertNull(lauf.nimm())
        assertNull(lauf.beende(lauf.naechste()))
        assertFalse(lauf.isLaufend)
    }
}
