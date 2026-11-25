package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Was der WebView mit einer Navigation tut. Die Regeln selbst prüft [LinkregelnTest]; hier steht,
 * wie die App sie auf die Rückrufe des WebViews abbildet. Downloads meldet Android über den
 * `DownloadListener`, nicht über die Navigation.
 */
class LinkweicheTest {
    private val server = URI.create("https://elw.local:8443/")
    private val seite = URI.create("https://elw.local:8443/einsaetze/1/etb")

    private fun navigation(ziel: String, isMainFrame: Boolean = true, neuesFenster: Boolean = false) =
        Linkweiche.navigation(server, URI.create(ziel), isMainFrame, neuesFenster, seite)

    @Test
    fun `eigene Seiten bleiben im WebView`() {
        assertEquals(Linkweiche.Entscheidung.Erlauben, navigation("https://elw.local:8443/einsaetze"))
        assertEquals(Linkweiche.Entscheidung.Erlauben, navigation("https://elw.local:8443/api/auth/oidc/start"))
    }

    @Test
    fun `die Anmeldung beim Identitätsanbieter läuft im WebView`() {
        assertEquals(Linkweiche.Entscheidung.Erlauben, navigation("https://id.rubeen.dev/authorize?x=1"))
    }

    @Test
    fun `Dateirouten werden heruntergeladen`() {
        assertEquals(Linkweiche.Entscheidung.Download, navigation("https://elw.local:8443/api/incidents/1/export.csv"))
        assertEquals(
            Linkweiche.Entscheidung.Download,
            navigation("https://elw.local:8443/api/incidents/1/export.csv", neuesFenster = true),
        )
    }

    @Test
    fun `Mail und Telefon öffnet das System`() {
        assertEquals(
            Linkweiche.Entscheidung.System(URI.create("mailto:leitstelle@example.org")),
            navigation("mailto:leitstelle@example.org"),
        )
        assertEquals(Linkweiche.Entscheidung.System(URI.create("tel:+49112")), navigation("tel:+49112"))
    }

    @Test
    fun `neue Fenster der eigenen Origin laden im selben WebView`() {
        val ziel = "https://elw.local:8443/einsaetze/1/etb?eintrag=4"
        assertEquals(Linkweiche.Entscheidung.ImWebviewLaden(URI.create(ziel)), navigation(ziel, neuesFenster = true))
    }

    @Test
    fun `fremde Seiten in neuem Fenster öffnet das System`() {
        val ziel = "https://www.dwd.de/warnungen"
        assertEquals(Linkweiche.Entscheidung.System(URI.create(ziel)), navigation(ziel, neuesFenster = true))
        assertEquals(Linkweiche.Entscheidung.Abbrechen, navigation("javascript:alert(1)", neuesFenster = true))
        assertEquals(Linkweiche.Entscheidung.Abbrechen, navigation("file:///etc/passwd", neuesFenster = true))
    }

    @Test
    fun `Unterframes laden unverändert`() {
        assertEquals(Linkweiche.Entscheidung.Erlauben, navigation("https://karten.example/tile", isMainFrame = false))
        assertEquals(Linkweiche.Entscheidung.Erlauben, navigation("https://elw.local:8443/api/x", isMainFrame = false))
    }

    @Test
    fun `der vorgeschlagene Dateiname verlässt sein Verzeichnis nie`() {
        for ((vorschlag, erwartet) in listOf(
            "../../etc/passwd" to "passwd",
            ".." to "Download",
            "..." to "Download",
            "" to "Download",
            "  " to "Download",
            ".versteckt" to "versteckt",
            "a:b\u0000c.txt" to "a_b_c.txt",
            "ordner/datei.pdf" to "datei.pdf",
            "../a/b:c.csv" to "b_c.csv",
            "a\\b.txt" to "a_b.txt",
        )) {
            assertEquals(erwartet, Downloadablage.dateiname(vorschlag), vorschlag)
        }
    }

    /** Review K5: Dateisysteme erlauben 255 Byte je Name; die Endung bleibt, Umlaute bleiben ganz. */
    @Test
    fun `ein langer Dateiname wird gekürzt, die Endung bleibt`() {
        val lang = Downloadablage.dateiname("Übergabeprotokoll Abschnitt Süd ".repeat(10) + ".pdf")
        assertTrue(lang.toByteArray(Charsets.UTF_8).size <= Downloadablage.MAX_NAME_BYTES, lang)
        assertTrue(lang.endsWith(".pdf"), lang)
        assertTrue(lang.startsWith("Übergabeprotokoll Abschnitt Süd"), lang)
        assertFalse('\uFFFD' in lang, lang)

        val ohneEndung = Downloadablage.dateiname("ä".repeat(300))
        assertEquals("ä".repeat(Downloadablage.MAX_NAME_BYTES / 2), ohneEndung)

        // Eine überlange „Endung“ ist keine: dann wird einfach gekürzt.
        val komisch = Downloadablage.dateiname("a." + "b".repeat(300))
        assertEquals(Downloadablage.MAX_NAME_BYTES, komisch.toByteArray(Charsets.UTF_8).size)
        assertEquals("kurz.pdf", Downloadablage.dateiname("kurz.pdf"))
    }
}
