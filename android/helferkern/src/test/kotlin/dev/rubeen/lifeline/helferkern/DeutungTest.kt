package dev.rubeen.lifeline.helferkern

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Randfälle der Einladung, die über die gemeinsamen Fälle hinausgehen (Gleichlauf mit Swift). */
class DeutungTest {
    @Test
    fun `ein Deeplink mit Pfad im Server wird verworfen`() {
        assertNull(deuteHelferLink("lifeline-helfer://anmelden?server=https://elw.local:8443/pfad#AB12CD34"))
    }

    @Test
    fun `ein Deeplink mit Abfrage im Server wird verworfen`() {
        assertNull(deuteHelferLink("lifeline-helfer://anmelden?server=https://elw.local:8443/?x=1#AB12CD34"))
    }

    @Test
    fun `Schema und Befehl sind unabhaengig von der Schreibweise`() {
        val ziel = deuteHelferLink("LIFELINE-HELFER://Anmelden?server=https://ELW.local:8443#ab12")
        assertEquals("https://elw.local:8443/", ziel?.server?.text)
        assertEquals("AB12", ziel?.code)
    }

    @Test
    fun `ein QR mit Zugangsdaten wird verworfen`() {
        assertNull(deuteHelferLink("https://nutzer@elw.local:8443/helfer#AB12CD34"))
    }

    @Test
    fun `ein QR mit abschliessendem Schraegstrich wird gelesen`() {
        assertEquals("AB12CD34", deuteHelferLink("https://elw.local/helfer/#AB12CD34")?.code)
    }
}
