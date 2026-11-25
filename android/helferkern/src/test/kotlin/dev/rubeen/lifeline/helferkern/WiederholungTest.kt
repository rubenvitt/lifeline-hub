package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals

/** Wachsender Abstand der Wiederholung: 5, 10, 20, 40, dann höchstens jede Minute (ADR-0098). */
class WiederholungTest {
    @Test
    fun `der Abstand waechst bis zur Obergrenze von 60 Sekunden`() {
        val w = Wiederholung()
        assertEquals(listOf(5, 10, 20, 40, 60, 60, 60, 60), List(8) { w.naechsterAbstandS() })
    }

    @Test
    fun `zuruecksetzen beginnt wieder bei 5 Sekunden`() {
        val w = Wiederholung()
        repeat(4) { w.naechsterAbstandS() }
        w.zuruecksetzen()
        assertEquals(5, w.naechsterAbstandS())
        assertEquals(10, w.naechsterAbstandS())
    }

    @Test
    fun `sehr viele Fehler in Folge laufen nicht ueber`() {
        val w = Wiederholung()
        repeat(10_000) { assertEquals(true, w.naechsterAbstandS() in 5..60) }
    }
}
