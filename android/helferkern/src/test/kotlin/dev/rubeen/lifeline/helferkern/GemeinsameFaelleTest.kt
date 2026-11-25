package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable

/** QR, Deeplink, Antwortcodes, Takt und Wiederholung gegen `src-tauri/faelle/helfer.json`. */
class GemeinsameFaelleTest {
    @Serializable
    private class Datei(
        val deute: List<DeuteFall>,
        val antwort: List<AntwortFall>,
        val takt: List<TaktFall>,
        val wiederholung: List<WiederholungFall>,
    )

    @Serializable
    private class Ergebnis(val server: String, val code: String)

    @Serializable
    private class DeuteFall(val beschreibung: String, val eingabe: String, val ergebnis: Ergebnis? = null)

    @Serializable
    private class AntwortFall(val beschreibung: String, val status: Int, val entscheidung: String)

    @Serializable
    private class TaktFall(
        val beschreibung: String,
        val seit_letzter_s: Double,
        val bewegt_m: Double,
        val senden: Boolean,
    )

    @Serializable
    private class WiederholungFall(val beschreibung: String, val fehler_in_folge: Int, val abstand_s: Int)

    private fun datei() = GemeinsameFaelle.load("helfer.json", Datei.serializer())

    @Test
    fun `jeder gemeinsame Fall von deute gilt`() {
        val faelle = datei().deute
        assertTrue(faelle.size >= 20)
        for (fall in faelle) {
            val ziel = deuteHelferLink(fall.eingabe)
            assertEquals(fall.ergebnis?.server, ziel?.server?.text, fall.beschreibung)
            assertEquals(fall.ergebnis?.code, ziel?.code, fall.beschreibung)
        }
    }

    @Test
    fun `jeder gemeinsame Fall von antwort gilt`() {
        val faelle = datei().antwort
        assertTrue(faelle.size >= 10)
        for (fall in faelle) {
            assertEquals(fall.entscheidung, entscheide(fall.status).kennwort, fall.beschreibung)
        }
    }

    @Test
    fun `jeder gemeinsame Fall von takt gilt`() {
        val faelle = datei().takt
        assertTrue(faelle.size >= 8)
        val takt = Takt()
        for (fall in faelle) {
            assertEquals(fall.senden, takt.soll(fall.seit_letzter_s, fall.bewegt_m), fall.beschreibung)
        }
    }

    @Test
    fun `jeder gemeinsame Fall von wiederholung gilt`() {
        val faelle = datei().wiederholung
        assertTrue(faelle.size >= 7)
        for (fall in faelle) {
            val wiederholung = Wiederholung()
            var abstand = 0
            repeat(fall.fehler_in_folge) { abstand = wiederholung.naechsterAbstandS() }
            assertEquals(fall.abstand_s, abstand, fall.beschreibung)
        }
    }

    /** Jede Entscheidung kommt in den Fällen vor; ein neuer Fall der Enum ohne JSON-Fall fiele sonst nicht auf. */
    @Test
    fun `die Faelle decken jede Entscheidung`() {
        val genannt = datei().antwort.map { it.entscheidung }.toSet()
        assertEquals(Antwort.entries.map { it.kennwort }.toSet(), genannt)
    }

}
