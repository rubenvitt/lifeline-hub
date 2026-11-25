package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals

/** Neu verbinden, warten oder enden (ADR-0105, Entwurf „Empfang“). */
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
        assertEquals("Ortung aus · wartet auf Bestätigung", Dienstanzeige.zeile(Ortungslage.AUS, verbunden = false, bestaetigt = false))
    }

    @Test
    fun `der Dienst ortet nur mit Phase und Recht, empfangen tut er immer`() {
        assertEquals(Dienstumfang.ORTUNG_UND_EMPFANG, Dienstumfang.fuer(orten = true, standortrecht = true))
        assertEquals(Dienstumfang.NUR_EMPFANG, Dienstumfang.fuer(orten = true, standortrecht = false))
        assertEquals(Dienstumfang.NUR_EMPFANG, Dienstumfang.fuer(orten = false, standortrecht = true))
        assertEquals(Dienstumfang.NUR_EMPFANG, Dienstumfang.fuer(orten = false, standortrecht = false))
    }

    @Test
    fun `empfangen ab aktiv, auch pausiert und ruhend, nie vorher oder danach`() {
        assertEquals(false, Phase.Start.empfaengt)
        assertEquals(false, Phase.Unbestaetigt.empfaengt)
        assertEquals(true, Phase.Aktiv.empfaengt)
        assertEquals(true, Phase.Pausiert.empfaengt)
        assertEquals(true, Phase.Ruht(Ruhegrund.KEINE_ROLLE).empfaengt)
        assertEquals(false, Phase.Beendet(Grund.EINSATZ_BEENDET).empfaengt)
    }

    @Test
    fun `die Lage folgt Phase und laufender Ortung`() {
        assertEquals(Ortungslage.AN, Ortungslage.aus(Phase.Aktiv, ortet = true))
        assertEquals(Ortungslage.AUS, Ortungslage.aus(Phase.Aktiv, ortet = false))
        assertEquals(Ortungslage.PAUSIERT, Ortungslage.aus(Phase.Pausiert, ortet = false))
        assertEquals(Ortungslage.RUHT, Ortungslage.aus(Phase.Ruht(Ruhegrund.KEINE_ROLLE), ortet = false))
    }

    @Test
    fun `erst Daten setzen den Abstand zurueck, ein blosses Oeffnen nicht`() {
        val w = Wiederverbindung()
        // Der Server nimmt an und schließt sofort, ohne eine Zeile: der Abstand wächst.
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L), (1..4).map { w.abbruch() })
        // Eine Zeile kam an: der nächste Abbruch beginnt wieder bei einer Sekunde.
        w.daten()
        assertEquals(0, w.abbrueche)
        assertEquals(1_000L, w.abbruch())
        assertEquals(2_000L, w.abbruch())
    }
}
