package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Testzustände der Bilder (Intent-Extra `lifeline.helfer.testzustand`): nur in Debug-Bauten. */
class TestzustandTest {
    @Test
    fun `ein Debug-Bau liest den Testzustand aus dem Start`() {
        assertEquals(Testzustand.ANGEMELDET, Testzustand.fromStart("angemeldet", isDebug = true))
        assertNull(Testzustand.fromStart("unbekannt", isDebug = true))
        assertNull(Testzustand.fromStart(null, isDebug = true))
    }

    @Test
    fun `ein Release-Bau uebergeht den Testzustand`() {
        for (zustand in Testzustand.entries) {
            assertNull(Testzustand.fromStart(zustand.wert, isDebug = false), zustand.wert)
        }
    }

    @Test
    fun `die Werte sind die der iOS-App`() {
        assertEquals(
            listOf("start", "anmelden", "wartet", "angemeldet", "pausiert", "beendet"),
            Testzustand.entries.map { it.wert },
        )
    }
}
