package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Annahme der Brücke `lifeline` (Entwurf D4): nur Hauptframe, nur die Origin des aktiven Servers. */
class BrueckeTest {
    private val elw = ServerAdresse.parse("https://elw.local:8443/")
    private val zweiter = ServerAdresse.parse("https://lager.example/")

    private fun origin(schema: String, host: String, port: Int) = SeitenOrigin(schema, host, port)

    @Test
    fun `der Hauptframe des aktiven Servers wird angenommen`() {
        assertTrue(Bruecke.accepts(true, origin("https", "elw.local", 8443), elw))
    }

    @Test
    fun `ein Unterframe des aktiven Servers wird abgelehnt`() {
        assertFalse(Bruecke.accepts(false, origin("https", "elw.local", 8443), elw))
    }

    @Test
    fun `eine fremde Origin wird abgelehnt`() {
        val fremde = listOf(
            origin("https", "idp.example", 443),
            origin("https", "elw.local", 443),
            origin("https", "elw.local", -1),
            origin("http", "elw.local", 8443),
            origin("https", "elw.local.evil.example", 8443),
            origin("file", "", -1),
            origin("blob", "elw.local", 8443),
        )
        for (seite in fremde) assertFalse(Bruecke.accepts(true, seite, elw), "$seite")
    }

    @Test
    fun `ohne aktiven Server nimmt die Brücke nichts an`() {
        assertFalse(Bruecke.accepts(true, origin("https", "elw.local", 8443), null))
    }

    @Test
    fun `ohne Origin nimmt die Brücke nichts an`() {
        assertFalse(Bruecke.accepts(true, null, elw))
        assertFalse(Bruecke.accepts(true, SeitenOrigin.parse("null"), elw))
    }

    @Test
    fun `Port minus eins ist der Standardport des Schemas`() {
        assertTrue(Bruecke.accepts(true, origin("https", "lager.example", -1), zweiter))
        assertTrue(Bruecke.accepts(true, origin("https", "lager.example", 443), zweiter))
    }

    /** LLH-2070: der WebView meldet einen Host mit Umlaut als Punycode; die Brücke bleibt nicht stumm. */
    @Test
    fun `ein Server mit Umlaut im Host passt zur Punycode-Origin des WebViews`() {
        val lueneburg = ServerAdresse.parse("https://einsatz-lüneburg.de/")
        assertTrue(Bruecke.accepts(true, SeitenOrigin.parse("https://xn--einsatz-lneburg-7vb.de"), lueneburg))
        assertEquals("https://xn--einsatz-lneburg-7vb.de", Bruecke.allowedOriginRule(lueneburg))
    }

    @Test
    fun `Großschreibung im Host zählt nicht`() {
        assertTrue(Bruecke.accepts(true, origin("HTTPS", "ELW.local", 8443), elw))
    }

    @Test
    fun `nach einem Wechsel nimmt die Brücke die alte Origin nicht mehr an`() {
        val alteSeite = origin("https", "elw.local", 8443)
        val neueSeite = origin("https", "lager.example", -1)
        assertTrue(Bruecke.accepts(true, alteSeite, elw))
        // Wechsel: die alte Seite (ein noch nicht abgebauter WebView) verliert die Brücke.
        assertFalse(Bruecke.accepts(true, alteSeite, zweiter))
        assertTrue(Bruecke.accepts(true, neueSeite, zweiter))
    }

    @Test
    fun `allowedOriginRule nennt Schema, Host und Port ohne Standardport`() {
        assertEquals("https://elw.local:8443", Bruecke.allowedOriginRule(ServerAdresse.parse("https://elw.local:8443/")))
        assertEquals("https://elw.local", Bruecke.allowedOriginRule(ServerAdresse.parse("https://elw.local/")))
        assertEquals("https://elw.local", Bruecke.allowedOriginRule(ServerAdresse.parse("https://elw.local:443/x")))
    }

    @Test
    fun `der Objektname ist lifeline`() {
        assertEquals("lifeline", Bruecke.OBJEKT_NAME)
    }

    @Test
    fun `die Origin als Text wird gelesen`() {
        assertEquals(SeitenOrigin("https", "elw.local", 8443), SeitenOrigin.parse("https://elw.local:8443"))
        assertEquals(SeitenOrigin("https", "elw.local", -1), SeitenOrigin.parse("https://elw.local"))
        assertNull(SeitenOrigin.parse("null"))
        assertNull(SeitenOrigin.parse(""))
        assertNull(SeitenOrigin.parse("https://"))
        assertNull(SeitenOrigin.parse("kein url ::"))
    }
}
