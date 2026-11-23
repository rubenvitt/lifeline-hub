package dev.rubeen.lifeline.kern

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Vertragsprüfung gegen `GET /api/shell`: die App lädt nur einen verträglichen Server, und ein
 * Server ohne Vertrag gilt als zu alt. Bewertung und Weiterleitungsregel prüfen die gemeinsamen
 * Fälle (`vertrag.json`, LLH-2062); hier steht nur, was allein die mobilen Hüllen kennen:
 * Zertifikatsfehler, Abbruch durch die App, `/api/health`, fehlende URIs.
 */
class VertragTest {
    @Serializable
    private class Datei(val bekannt: List<Int>, val bewerte: List<BewerteFall>, val weiterleitung: List<WeiterleitungFall>)

    @Serializable
    private class BewerteFall(
        val beschreibung: String,
        val abruf: Abruf,
        @SerialName("letzter_vertrag") val letzterVertrag: Int? = null,
        val bekannt: List<Int>? = null,
        val ergebnis: String,
        @SerialName("server_version") val serverVersion: String? = null,
        @SerialName("shell_contract") val shellContract: Int? = null,
    )

    /** Eine Antwort (`status`, `content_type`, `koerper`) oder `fehler`: keine Antwort. */
    @Serializable
    private class Abruf(
        val status: Int? = null,
        @SerialName("content_type") val contentType: String? = null,
        val koerper: String? = null,
        val fehler: Boolean = false,
    ) {
        fun shellAbruf(): ShellAbruf =
            if (fehler) {
                ShellAbruf.Fehler(Netzfehler.VERBINDUNG)
            } else {
                ShellAbruf.Antwort(requireNotNull(status), requireNotNull(koerper), contentType)
            }
    }

    @Serializable
    private class WeiterleitungFall(val beschreibung: String, val von: String, val nach: String, val folgt: Boolean)

    /**
     * Das Ergebnis in der Form der Fälle. Die App trägt bei „nicht verträglich“ den ganzen
     * [ShellInfo] des Servers; die Fälle nennen davon die Version (wie die anderen Hüllen).
     */
    private data class Erwartung(val ergebnis: String, val serverVersion: String?, val shellContract: Int?) {
        constructor(fall: BewerteFall) : this(fall.ergebnis, fall.serverVersion, fall.shellContract)

        constructor(ist: Vertragsergebnis) : this(
            when (ist.fehlerklasse) {
                null -> "vertraeglich"
                else -> ist.fehlerklasse.toString().lowercase()
            },
            when (ist) {
                is Vertragsergebnis.Vertraeglich -> ist.info.version
                is Vertragsergebnis.NichtVertraeglich -> ist.server?.version
                is Vertragsergebnis.NichtErreichbar -> null
            },
            (ist as? Vertragsergebnis.Vertraeglich)?.info?.shellContract,
        )
    }

    private fun datei() = GemeinsameFaelle.load("vertrag.json", Datei.serializer())

    @Test
    fun `jeder gemeinsame Fall von bewerte gilt`() {
        val datei = datei()
        assertTrue(datei.bewerte.size >= 20)
        for (fall in datei.bewerte) {
            val ist = Vertragspruefung.evaluate(fall.abruf.shellAbruf(), fall.letzterVertrag, fall.bekannt ?: datei.bekannt)
            assertEquals(Erwartung(fall), Erwartung(ist), fall.beschreibung)
        }
    }

    @Test
    fun `jeder gemeinsame Fall von weiterleitung gilt`() {
        val datei = datei()
        assertTrue(datei.weiterleitung.size >= 5)
        for (fall in datei.weiterleitung) {
            assertEquals(
                fall.folgt,
                Vertragspruefung.followsRedirect(URI.create(fall.von), URI.create(fall.nach)),
                fall.beschreibung,
            )
        }
    }

    /** Die Fälle setzen voraus, dass die App genau die Verträge der Datei kennt. */
    @Test
    fun `die App kennt die Verträge der gemeinsamen Fälle`() {
        assertEquals(datei().bekannt, LifelineKern.bekannteVertraege)
    }

    @Test
    fun `ohne URI wird keiner Weiterleitung gefolgt`() {
        val shell = URI.create("https://elw.local:8443/api/shell")
        assertFalse(Vertragspruefung.followsRedirect(null, shell))
        assertFalse(Vertragspruefung.followsRedirect(shell, null))
    }

    @Test
    fun `die Version eines zu alten Servers kommt aus Health`() {
        assertEquals("1.0.0-alpha.12", healthVersion("""{"status":"degraded","version":"1.0.0-alpha.12","db":false}"""))
        assertNull(healthVersion("kein json"))
        assertNull(healthVersion("""{"status":"ok"}"""))
    }

    @Test
    fun `ein Zertifikatsfehler ist kein Nicht-erreichbar`() {
        val fehler = ShellAbruf.Fehler(Netzfehler.ZERTIFIKAT)
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT), Vertragspruefung.evaluate(fehler, 1))
        // Auch ein zuletzt unverträglicher Server zeigt zuerst die Anleitung zum Zertifikat:
        // ohne Vertrauen erfährt die App den heutigen Vertrag nicht.
        assertEquals(Vertragsergebnis.NichtErreichbar(Fehlerklasse.ZERTIFIKAT), Vertragspruefung.evaluate(fehler, 2))
    }

    /** Ein Abbruch durch die App gilt wie jeder Verbindungsfehler, samt gemerktem Vertrag. */
    @Test
    fun `ein abgebrochener Abruf gilt wie ohne Verbindung`() {
        for (letzter in listOf(null, 1, 2)) {
            assertEquals(
                Vertragspruefung.evaluate(ShellAbruf.Fehler(Netzfehler.VERBINDUNG), letzter),
                Vertragspruefung.evaluate(ShellAbruf.Fehler(Netzfehler.ABGEBROCHEN), letzter),
                "$letzter",
            )
        }
    }
}
