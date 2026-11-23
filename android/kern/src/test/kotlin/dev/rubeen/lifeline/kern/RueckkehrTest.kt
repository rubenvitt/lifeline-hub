package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Rückkehr in den Vordergrund und Testzustände. */
class RueckkehrTest {
    @Test
    fun `aktiv nach Hintergrund ist eine Rückkehr`() {
        val r = Rueckkehr()
        assertFalse(r.melde(Rueckkehr.Phase.ACTIVE))
        assertFalse(r.melde(Rueckkehr.Phase.BACKGROUND))
        assertTrue(r.melde(Rueckkehr.Phase.ACTIVE))
        assertFalse(r.melde(Rueckkehr.Phase.ACTIVE))
    }

    @Test
    fun `ein kurzes inaktiv zählt nicht`() {
        val r = Rueckkehr()
        assertFalse(r.melde(Rueckkehr.Phase.INACTIVE))
        assertFalse(r.melde(Rueckkehr.Phase.ACTIVE))
        r.melde(Rueckkehr.Phase.BACKGROUND)
        assertFalse(r.melde(Rueckkehr.Phase.INACTIVE))
        assertTrue(r.melde(Rueckkehr.Phase.ACTIVE))
    }

    @Test
    fun `Testzustände werden am Wert erkannt`() {
        assertEquals("lifeline.testzustand", Testzustand.EXTRA)
        for (zustand in Testzustand.entries) assertEquals(zustand, Testzustand.from(zustand.wert))
        assertEquals(Testzustand.NICHT_ERREICHBAR, Testzustand.from("nicht-erreichbar"))
        assertEquals(Testzustand.WEBVIEW_VERALTET, Testzustand.from("webview-veraltet"))
        assertNull(Testzustand.from("gibt-es-nicht"))
        assertNull(Testzustand.from(null))
    }

    @Test
    fun `die Beispielseite hat Kopf Eingabe und Rückfrage`() {
        for (teil in listOf("id=\"kopf\"", "id=\"eingabe\"", "confirm(")) {
            assertTrue(teil in Testzustand.BEISPIELSEITE, teil)
        }
    }
}
