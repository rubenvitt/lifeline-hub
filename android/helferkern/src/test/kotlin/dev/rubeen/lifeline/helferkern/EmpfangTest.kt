package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals

/** Neu verbinden, warten oder enden (ADR-0104, Entwurf „Empfang“). */
class EmpfangTest {
    @Test
    fun `der Abstand waechst von einer Sekunde bis hoechstens einer Minute`() {
        assertEquals(
            listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L, 60_000L),
            (1..9).map(Empfang::nachAbbruch),
        )
        assertEquals(60_000L, Empfang.nachAbbruch(Int.MAX_VALUE))
        // Ohne Abbruch (0 oder weniger) gilt der erste Abstand.
        assertEquals(1_000L, Empfang.nachAbbruch(0))
        assertEquals(1_000L, Empfang.nachAbbruch(-3))
    }

    @Test
    fun `je Status verbinden warten oder enden`() {
        val tabelle = mapOf(
            200 to Empfang.Entscheidung.VERBINDEN,
            204 to Empfang.Entscheidung.VERBINDEN,
            401 to Empfang.Entscheidung.ENDEN,
            403 to Empfang.Entscheidung.ENDEN,
            404 to Empfang.Entscheidung.ENDEN,
            0 to Empfang.Entscheidung.WARTEN,
            302 to Empfang.Entscheidung.WARTEN,
            408 to Empfang.Entscheidung.WARTEN,
            429 to Empfang.Entscheidung.WARTEN,
            500 to Empfang.Entscheidung.WARTEN,
            502 to Empfang.Entscheidung.WARTEN,
            503 to Empfang.Entscheidung.WARTEN,
        )
        for ((status, erwartet) in tabelle) {
            assertEquals(erwartet, Empfang.nachAntwort(status), "Status $status")
        }
    }

    @Test
    fun `die Benachrichtigung zeigt Ortung und Empfang`() {
        assertEquals("Ortung an · empfängt Aufträge", Dienstanzeige.zeile(Ortungslage.AN, verbunden = true))
        assertEquals("Ortung pausiert · empfängt Aufträge", Dienstanzeige.zeile(Ortungslage.PAUSIERT, verbunden = true))
        assertEquals("Ortung wartet — App öffnen · empfängt Aufträge", Dienstanzeige.zeile(Ortungslage.WARTET, verbunden = true))
        assertEquals("Ortung an · getrennt — verbinde neu", Dienstanzeige.zeile(Ortungslage.AN, verbunden = false))
    }
}
