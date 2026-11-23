package dev.rubeen.lifeline.kern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Testzustände der Bilder (Intent-Extra `lifeline.testzustand`): nur in Debug-Bauten (Review W3). */
class TestzustandTest {
    @Test
    fun `ein Debug-Bau liest den Testzustand aus dem Start`() {
        assertEquals(Testzustand.UPDATE_LAEUFT, Testzustand.fromStart("update-laeuft", isDebug = true))
        assertNull(Testzustand.fromStart("unbekannt", isDebug = true))
        assertNull(Testzustand.fromStart(null, isDebug = true))
    }

    @Test
    fun `ein Release-Bau übergeht den Testzustand`() {
        for (zustand in Testzustand.entries) {
            assertNull(Testzustand.fromStart(zustand.wert, isDebug = false), zustand.wert)
        }
    }
}
