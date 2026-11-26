package dev.rubeen.lifeline.helferkern

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ordnung, Mitteilung und Texte der Aufträge über die gemeinsamen Fälle hinaus. */
class AuftraegeTest {
    private val berlin = ZoneId.of("Europe/Berlin")

    private fun auftrag(
        id: Long,
        issuedAt: String = "2026-11-25 10:00:00",
        cancelledAt: String? = null,
        recipients: List<HelperTaskRecipient> = listOf(zeile(100 + id)),
    ) = HelperTask(
        id = id,
        number = id,
        text = "Auftrag $id",
        priority = "normal",
        issuedAt = issuedAt,
        cancelledAt = cancelledAt,
        recipients = recipients,
    )

    private fun zeile(id: Long, kind: String = "unit", um: String? = null, von: String? = null) =
        HelperTaskRecipient(id, kind, "San-Trupp 2", um, von)

    @Test
    fun `ein Auftrag mit einer offenen von zwei Zeilen bleibt offen`() {
        val a = auftrag(1, recipients = listOf(zeile(1, um = "2026-11-25 10:01:00", von = "Max M."), zeile(2, kind = "person")))
        assertTrue(a.isOffen)
        val b = auftrag(2, issuedAt = "2026-11-25 10:05:00", recipients = listOf(zeile(3, um = "2026-11-25 10:06:00")))
        // Offen vor quittiert, obwohl älter.
        assertEquals(listOf(1L, 2L), Auftraege.ordnen(listOf(b, a)).map { it.id })
        assertEquals(1, Auftraege.offen(listOf(a, b)))
    }

    @Test
    fun `bei gleicher Zeit zuerst die hoehere Kennung`() {
        assertEquals(listOf(3L, 2L), Auftraege.ordnen(listOf(auftrag(2), auftrag(3))).map { it.id })
    }

    @Test
    fun `ohne lesbare Zeit keine Mitteilung`() {
        assertFalse(Auftraege.sollMitteilen(auftrag(1, issuedAt = "gestern"), emptySet(), 0))
    }

    @Test
    fun `der Quittungstext nennt den anderen, nicht sich selbst`() {
        // 10:01 UTC ist 11:01 in Berlin (Winterzeit).
        val stand = Quittungsstand.Quittiert("2026-11-25 10:01:00", "Max M.")
        assertEquals("Übernommen von Max M. um 11:01", Auftraege.quittungstext(stand, "Lisa K.", berlin))
        assertEquals("Übernommen um 11:01", Auftraege.quittungstext(stand, "Max M.", berlin))
        assertEquals("Übernommen um 11:01", Auftraege.quittungstext(Quittungsstand.Quittiert("2026-11-25 10:01:00", null), "Lisa K.", berlin))
        assertNull(Auftraege.quittungstext(Quittungsstand.Offen, "Lisa K.", berlin))
        assertNull(Auftraege.quittungstext(Quittungsstand.Aufgehoben, "Lisa K.", berlin))
    }

    @Test
    fun `eine Person als Empfaenger heisst an dich`() {
        assertEquals("an dich", Auftraege.empfaengertext(zeile(1, kind = "person")))
        assertEquals("San-Trupp 2", Auftraege.empfaengertext(zeile(1)))
    }

    @Test
    fun `die Liste liest den Body des Servers`() {
        val text = """{"tasks":[{"id":7,"number":3,"text":"Verletzte Person","location":"Zelt 3","location_lat":50.1,
            |"location_lon":8.6,"priority":"sofort","deadline_at":null,"issued_at":"2026-11-25 10:00:00","cancelled_at":null,
            |"recipients":[{"id":70,"kind":"vehicle","label":"72/83-1","acknowledged_at":null,"acknowledged_by":null}],
            |"neu":"egal"}]}""".trimMargin()
        val liste = Wire.auftraege(text)
        assertEquals(1, liste?.size)
        val a = liste!!.single()
        assertEquals("Zelt 3", a.location)
        assertEquals("sofort", a.priority)
        assertEquals("vehicle", a.recipients.single().kind)
        assertNull(Wire.auftraege("{\"kaputt\":1}"))
    }
}
