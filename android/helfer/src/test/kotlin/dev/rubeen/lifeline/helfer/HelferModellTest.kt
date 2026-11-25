package dev.rubeen.lifeline.helfer

import android.os.Looper
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Grund
import dev.rubeen.lifeline.helferkern.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Das Modell führt aus, was die `Anmeldung` im Kern entscheidet (Spec „Ablauf“): Scan → Anmelden
 * → Wartet. Ohne Dienste fragt es kein Netz und ortet nicht.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HelferModellTest {
    private val modell = HelferModell(dienste = null)
    private val link = "https://elw.local:8443/helfer#ab12cd34"

    private fun warte() = shadowOf(Looper.getMainLooper()).idle()

    @Test
    fun `ein Scan fuehrt zum Anmelden mit Server, Code und Zielliste`() {
        assertTrue(modell.gescannt(link))
        warte()
        val phase = modell.phase
        assertTrue(phase is Phase.Anmelden)
        phase as Phase.Anmelden
        assertEquals("AB12CD34", phase.ziel.code)
        assertEquals("elw.local", modell.servername)
        assertEquals(Beispiel.zielliste, modell.zielliste)
        assertNull(modell.meldung)
    }

    @Test
    fun `ein fremder QR-Code bleibt auf dem Start mit Hinweis`() {
        assertFalse(modell.gescannt("https://example.org/koppeln#X"))
        assertEquals(Phase.Start, modell.phase)
        assertEquals(Anzeige.KEINE_EINLADUNG, modell.meldung)
    }

    @Test
    fun `der Deeplink fuehrt ebenso zum Anmelden`() {
        modell.oeffne("lifeline-helfer://anmelden?server=https%3A%2F%2Felw.local%3A8443#AB12CD34")
        assertTrue(modell.phase is Phase.Anmelden)
    }

    @Test
    fun `anmelden braucht Namen und Ziel und fuehrt dann zum Warten`() {
        modell.gescannt(link)
        warte()
        assertFalse(modell.kannAnmelden)
        modell.anzeigename = "Max M."
        assertFalse("ohne Ziel", modell.kannAnmelden)
        modell.gewaehltesZiel = Beispiel.zielliste.targets.first()
        assertTrue(modell.kannAnmelden)
        modell.anmelden()
        warte()
        assertEquals(Phase.Unbestaetigt, modell.phase)
    }

    @Test
    fun `Code eingeben ohne https ergibt dieselbe Einladung`() {
        assertTrue(modell.eingegeben(" elw.local:8443/ ", "ab12 cd34"))
        assertEquals("AB12CD34", (modell.phase as Phase.Anmelden).ziel.code)
        assertFalse(modell.eingegeben("http://elw.local", "X"))
        assertEquals(Anzeige.EINGABE_UNGUELTIG, modell.meldung)
    }

    @Test
    fun `Abbrechen vor dem Einloesen fuehrt zurueck zum Start`() {
        modell.gescannt(link)
        modell.abmelden()
        warte()
        assertEquals(Phase.Start, modell.phase)
        assertNull(modell.einladung)
    }

    @Test
    fun `ein neuer Scan waehrend einer Anmeldung fragt erst`() {
        modell.gescannt(link)
        modell.anzeigename = "Max M."
        modell.gewaehltesZiel = Beispiel.zielliste.targets.first()
        modell.anmelden()
        warte()
        assertTrue(modell.gescannt("https://anderer.example/helfer#ZZ"))
        assertNotNull(modell.ausstehenderScan)
        assertEquals(Phase.Unbestaetigt, modell.phase)
        modell.bestaetigeNeuenScan(true)
        warte()
        assertNull(modell.ausstehenderScan)
        assertEquals("ZZ", (modell.phase as Phase.Anmelden).ziel.code)
    }

    @Test
    fun `der Testzustand beendet zeigt den Grund und Neu anmelden fuehrt zum Start`() {
        val beendet = HelferModell.start(dev.rubeen.lifeline.helferkern.Testzustand.BEENDET) { error("keine Dienste im Test") }
        assertEquals(Phase.Beendet(Grund.EINSATZ_BEENDET), beendet.phase)
        beendet.neuAnmelden()
        assertEquals(Phase.Start, beendet.phase)
    }
}
