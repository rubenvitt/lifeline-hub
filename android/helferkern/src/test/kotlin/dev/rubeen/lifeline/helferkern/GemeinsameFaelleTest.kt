package dev.rubeen.lifeline.helferkern

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable

/** QR, Deeplink, Antwortcodes, Takt, Wiederholung und Sendeplan gegen `src-tauri/faelle/helfer.json`. */
class GemeinsameFaelleTest {
    @Serializable
    private class Datei(
        val deute: List<DeuteFall>,
        val antwort: List<AntwortFall>,
        val takt: List<TaktFall>,
        val wiederholung: List<WiederholungFall>,
        val sendeplan: List<SendeplanFall>,
    )

    @Serializable
    private class Ergebnis(val server: String, val code: String)

    @Serializable
    private class DeuteFall(val beschreibung: String, val eingabe: String, val ergebnis: Ergebnis? = null)

    @Serializable
    private class AntwortFall(
        val beschreibung: String,
        val status: Int,
        val grund: String? = null,
        val entscheidung: String,
    )

    @Serializable
    private class TaktFall(
        val beschreibung: String,
        val seit_letzter_s: Double,
        val bewegt_m: Double,
        val senden: Boolean,
    )

    @Serializable
    private class WiederholungFall(val beschreibung: String, val fehler_in_folge: Int, val abstand_s: Int)

    @Serializable
    private class Schritt(
        val art: String,
        val um_s: Long,
        val gemessen_s: Long? = null,
        val nord_m: Double = 0.0,
        val antwort: String? = null,
        val sendet: Long? = null,
        val fordert_an: Boolean? = null,
    )

    @Serializable
    private class SendeplanFall(val beschreibung: String, val schritte: List<Schritt>)

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
            assertEquals(fall.entscheidung, entscheide(fall.status, fall.grund).kennwort, fall.beschreibung)
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

    @Test
    fun `jeder gemeinsame Fall von sendeplan gilt`() {
        val faelle = datei().sendeplan
        assertTrue(faelle.size >= 10)
        val start = Instant.ofEpochSecond(1_800_000_000)
        for (fall in faelle) {
            val plan = Sendeplan()
            for ((i, schritt) in fall.schritte.withIndex()) {
                val jetzt = start.plusSeconds(schritt.um_s)
                val wo = "${fall.beschreibung}, Schritt ${i + 1} (${schritt.art})"
                val gesendet = when (schritt.art) {
                    "messung" -> {
                        val gemessen = start.plusSeconds(schritt.gemessen_s ?: schritt.um_s)
                        val p = Position(50.0 + schritt.nord_m / 111_195.0, 8.6, 5.0, gemessen)
                        plan.messung(p, jetzt)
                    }
                    "antwort" -> {
                        val antwort = Antwort.entries.single { it.kennwort == schritt.antwort }
                        plan.antwort(antwort, jetzt)
                    }
                    "versuch" -> plan.versuch(jetzt)
                    "lebenszeichen" -> {
                        assertEquals(schritt.fordert_an, plan.lebenszeichen(jetzt), wo)
                        continue
                    }
                    else -> error("unbekannte Art ${schritt.art}")
                }
                val erwartet = schritt.sendet?.let { start.plusSeconds(it) }
                assertEquals(erwartet, gesendet?.recordedAt, wo)
            }
        }
    }

    /** Jede Entscheidung kommt in den Fällen vor; ein neuer Fall der Enum ohne JSON-Fall fiele sonst nicht auf. */
    @Test
    fun `die Faelle decken jede Entscheidung`() {
        val genannt = datei().antwort.map { it.entscheidung }.toSet()
        assertEquals(Antwort.entries.map { it.kennwort }.toSet(), genannt)
    }

}
