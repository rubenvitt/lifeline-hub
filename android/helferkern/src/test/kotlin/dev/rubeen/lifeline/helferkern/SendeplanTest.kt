package dev.rubeen.lifeline.helferkern

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Was der Ortungsdienst wann sendet (Spec „Senden, Takt, ohne Netz“): Takt, Puffer und Wiederholung zusammen. */
class SendeplanTest {
    private val start = Instant.ofEpochSecond(1_800_000_000)

    private fun um(s: Long) = start.plusSeconds(s)

    /** Position [nordM] Meter nördlich des Startpunkts, gemessen bei [s] Sekunden. */
    private fun position(s: Long, nordM: Double = 0.0) =
        Position(latitude = 50.0 + nordM / 111_195.0, longitude = 8.6, accuracy = 5.0, recordedAt = um(s))

    @Test
    fun `die erste Messung geht sofort raus`() {
        val plan = Sendeplan()
        val p = position(0)
        assertEquals(p, plan.messung(p, um(0)))
    }

    @Test
    fun `ohne Bewegung geht vor dem Lebenszeichen nichts raus`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WEITER, um(1))
        assertNull(plan.messung(position(40, nordM = 5.0), um(40)))
        assertFalse(plan.lebenszeichen(um(200)))
    }

    @Test
    fun `das Lebenszeichen fordert eine frische Messung an und sendet nie die alte mit neuer Zeit`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WEITER, um(0))
        assertNull(plan.messung(position(100, nordM = 3.0), um(100)))
        assertTrue(plan.lebenszeichen(um(300)))
        assertFalse(plan.lebenszeichen(um(310)), "die Anforderung läuft noch")
        assertNull(plan.versuch(um(320)), "ohne frische Messung geht nichts raus")
        val frisch = position(325, nordM = 2.0)
        val zeichen = assertNotNull(plan.messung(frisch, um(326)))
        assertEquals(um(325), zeichen.recordedAt, "die Zeit der Messung, nicht die der Uhr")
    }

    @Test
    fun `eine zwischengespeicherte Messung geht nicht noch einmal raus`() {
        val plan = Sendeplan()
        val p = position(0)
        plan.messung(p, um(0))
        plan.antwort(Antwort.WEITER, um(1))
        assertTrue(plan.lebenszeichen(um(301)))
        assertNull(plan.messung(p, um(302)))
        assertNull(plan.messung(position(0, nordM = 50.0), um(303)), "gleich alt ist nicht neuer")
    }

    @Test
    fun `waehrend einer Sendung fordert das Lebenszeichen nichts an`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WEITER, um(0))
        plan.messung(position(400, nordM = 1.0), um(400))
        assertFalse(plan.lebenszeichen(um(401)))
    }

    @Test
    fun `ruhen haelt den Plan an wie stoppen`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        assertNull(plan.antwort(Antwort.RUHEN, um(1)))
        assertFalse(plan.lebenszeichen(um(1000)))
        assertNull(plan.naechsterVersuch)
        assertNotNull(plan.messung(position(1001), um(1001)), "nach dem Neustart geht die erste Messung raus")
    }

    @Test
    fun `Bewegung ueber 25 Meter nach 30 Sekunden geht raus`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WEITER, um(0))
        assertNull(plan.messung(position(20, nordM = 40.0), um(20)), "zu früh")
        val p = position(31, nordM = 40.0)
        assertEquals(p, plan.messung(p, um(31)))
    }

    @Test
    fun `waehrend einer Sendung geht keine zweite raus, die neuere folgt nach der Antwort`() {
        val plan = Sendeplan(Takt(mindestabstandS = 0.0, bewegungM = 0.0))
        plan.messung(position(0), um(0))
        val neuer = position(1, nordM = 50.0)
        assertNull(plan.messung(neuer, um(1)))
        assertEquals(neuer, plan.antwort(Antwort.WEITER, um(2)))
    }

    @Test
    fun `ein Fehler plant den naechsten Versuch mit wachsendem Abstand`() {
        val plan = Sendeplan()
        val p = position(0)
        plan.messung(p, um(0))
        assertNull(plan.antwort(Antwort.WIEDERHOLEN, um(0)))
        assertEquals(um(5), plan.naechsterVersuch)
        assertNull(plan.versuch(um(4)), "noch nicht dran")
        assertEquals(p, plan.versuch(um(5)))
        plan.antwort(Antwort.WIEDERHOLEN, um(5))
        assertEquals(um(15), plan.naechsterVersuch)
    }

    @Test
    fun `nach zehn Minuten ohne Netz verfaellt die gepufferte Position`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WIEDERHOLEN, um(0))
        assertNull(plan.versuch(um(601)))
        assertNull(plan.naechsterVersuch)
    }

    @Test
    fun `ein Erfolg setzt den Abstand zurueck`() {
        val plan = Sendeplan(Takt(mindestabstandS = 0.0, bewegungM = 0.0))
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.WIEDERHOLEN, um(0))
        plan.versuch(um(5))
        plan.antwort(Antwort.WEITER, um(6))
        plan.messung(position(7, nordM = 10.0), um(7))
        plan.antwort(Antwort.WIEDERHOLEN, um(7))
        assertEquals(um(12), plan.naechsterVersuch)
    }

    @Test
    fun `verwerfen vergisst nur diese Position`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        assertNull(plan.antwort(Antwort.VERWERFEN, um(1)))
        assertNull(plan.naechsterVersuch)
        // Ohne angenommene Sendung geht die nächste Messung sofort raus.
        assertNotNull(plan.messung(position(2), um(2)))
    }

    @Test
    fun `stoppen vergisst alles`() {
        val plan = Sendeplan()
        plan.messung(position(0), um(0))
        plan.antwort(Antwort.STOPPEN, um(1))
        assertFalse(plan.lebenszeichen(um(1000)))
        assertNull(plan.naechsterVersuch)
    }

    @Test
    fun `der Abstand rechnet auf der Kugel`() {
        val a = Position(50.0, 8.6, recordedAt = start)
        val b = Position(51.0, 8.6, recordedAt = start)
        val m = abstandM(a, b)
        assertTrue(m in 111_100.0..111_300.0, "ein Breitengrad sind rund 111,2 km, gemessen $m")
        assertEquals(0.0, abstandM(a, a))
    }
}
