package dev.rubeen.lifeline.helferkern

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Puffer ohne Netz: nur die letzte Position, höchstens 10 Minuten alt. */
class PufferTest {
    private val jetzt = Instant.ofEpochSecond(1_800_000_000)

    private fun position(vor: Long, lat: Double = 50.1) =
        Position(latitude = lat, longitude = 8.6, accuracy = 5.0, recordedAt = jetzt.minusSeconds(vor))

    @Test
    fun `eine Position vor 601 Sekunden ist nicht mehr faellig`() {
        val puffer = Puffer().apply { merke(position(601)) }
        assertNull(puffer.faellig(jetzt))
    }

    @Test
    fun `eine Position juenger als zehn Minuten ist faellig`() {
        val p = position(599)
        val puffer = Puffer().apply { merke(p) }
        assertEquals(p, puffer.faellig(jetzt))
    }

    @Test
    fun `genau zehn Minuten sind zu alt`() {
        val puffer = Puffer().apply { merke(position(600)) }
        assertNull(puffer.faellig(jetzt))
    }

    @Test
    fun `nur die letzte Position bleibt`() {
        val puffer = Puffer()
        puffer.merke(position(90, 50.1))
        puffer.merke(position(60, 50.2))
        val letzte = position(30, 50.3)
        puffer.merke(letzte)
        assertEquals(letzte, puffer.letzte)
        assertEquals(letzte, puffer.faellig(jetzt))
    }

    @Test
    fun `eine aeltere Messung ersetzt die gemerkte nicht`() {
        val puffer = Puffer()
        val neu = position(10)
        puffer.merke(neu)
        puffer.merke(position(40))
        assertEquals(neu, puffer.letzte)
    }

    @Test
    fun `leere vergisst die Position`() {
        val puffer = Puffer().apply { merke(position(10)) }
        puffer.leere()
        assertNull(puffer.faellig(jetzt))
        assertNull(puffer.letzte)
    }

    @Test
    fun `ohne gemerkte Position ist nichts faellig`() {
        assertNull(Puffer().faellig(jetzt))
    }
}
