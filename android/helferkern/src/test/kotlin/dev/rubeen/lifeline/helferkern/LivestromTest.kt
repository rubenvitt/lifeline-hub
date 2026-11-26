package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** SSE-Leser Zeile für Zeile, wie der Dienst ihn mit `readLine` füttert (die Rahmen: gemeinsame Fälle). */
class LivestromTest {
    @Test
    fun `ein Ereignis entsteht erst an der Leerzeile`() {
        val leser = SseLeser()
        assertNull(leser.zeile("event: helfer_auftrag"))
        assertNull(leser.zeile("data: {\"task_id\":7}"))
        assertEquals(LiveEreignis.Auftrag(7), leser.zeile(""))
        // Danach ist der Rahmen vergessen: eine weitere Leerzeile ergibt nichts.
        assertNull(leser.zeile(""))
    }

    @Test
    fun `zuruecksetzen vergisst einen abgebrochenen Rahmen`() {
        val leser = SseLeser()
        leser.zeile("event: helfer_auftrag")
        leser.zeile("data: {\"task_id\":9}")
        leser.zuruecksetzen()
        assertNull(leser.zeile(""))
    }

    @Test
    fun `data ohne Leerzeichen und eine task_id als Text sind Auftrag bzw unbekannt`() {
        assertEquals(listOf(LiveEreignis.Auftrag(4)), SseLeser().text("event:helfer_auftrag\ndata:{\"task_id\":4}\n\n"))
        assertEquals(listOf(LiveEreignis.Unbekannt), SseLeser().text("event: helfer_auftrag\ndata: {\"task_id\":\"x\"}\n\n"))
        assertEquals(listOf(LiveEreignis.Unbekannt), SseLeser().text("event: helfer_auftrag\ndata: [1]\n\n"))
    }

    @Test
    fun `data ohne event ist unbekannt, id allein ergibt nichts`() {
        assertEquals(listOf(LiveEreignis.Unbekannt), SseLeser().text("data: {}\n\n"))
        assertEquals(emptyList(), SseLeser().text("id: 17\n\n"))
    }
}
