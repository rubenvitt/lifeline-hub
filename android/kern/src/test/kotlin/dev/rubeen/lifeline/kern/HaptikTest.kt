package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Haptik-Abbildung (Entwurf D6): fünf Arten, unbekannte tun nichts, der Schalter gilt. */
class HaptikTest {
    @Test
    fun `jede Art hat ihre Rückmeldung`() {
        val soll = mapOf(
            "success" to Haptik.Feedback.CONFIRM,
            "warning" to Haptik.Feedback.WARNING,
            "error" to Haptik.Feedback.REJECT,
            "selection" to Haptik.Feedback.SELECTION,
            "tap" to Haptik.Feedback.TAP,
        )
        for ((kind, feedback) in soll) assertEquals(feedback, Haptik.feedback(kind, true), kind)
        assertEquals(soll.values.toSet(), Haptik.Feedback.entries.toSet())
    }

    @Test
    fun `Haptik bildet tap auf TAP und unbekanntes auf nichts ab`() {
        assertEquals(Haptik.Feedback.TAP, Haptik.feedback("tap", true))
        for (kind in listOf("unknown", "", "Success", " tap", "impact", "lightImpact")) {
            assertNull(Haptik.feedback(kind, true), kind)
        }
    }

    @Test
    fun `ausgeschaltet tut Haptik nichts`() {
        for (kind in listOf("success", "warning", "error", "selection", "tap")) {
            assertNull(Haptik.feedback(kind, false), kind)
        }
    }

    @Test
    fun `der Schalter ist standardmäßig an`() {
        assertEquals("haptik", Haptik.SCHALTER_SCHLUESSEL)
        assertTrue(Haptik.isEnabled(null))
        assertTrue(Haptik.isEnabled(true))
        assertFalse(Haptik.isEnabled(false))
    }
}
