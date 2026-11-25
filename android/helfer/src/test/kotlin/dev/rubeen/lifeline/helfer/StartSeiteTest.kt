package dev.rubeen.lifeline.helfer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.rubeen.lifeline.helfer.seiten.StartSeite
import dev.rubeen.lifeline.helfer.ui.HelferThema
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Bildschirm 1 „Start“: QR-Code scannen, darunter Code eingeben (Spec „Bildschirme“). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class StartSeiteTest {
    @get:Rule
    val compose = createComposeRule()

    private val modell = HelferModell(dienste = null)
    private var scans = 0

    private fun zeige() {
        compose.setContent {
            HelferThema {
                StartSeite(modell, onScannen = { scans += 1 })
            }
        }
    }

    @Test
    fun `der Start zeigt QR-Code scannen und Code eingeben`() {
        zeige()
        compose.onNodeWithText("QR-Code scannen").assertIsDisplayed()
        compose.onNodeWithText("Code eingeben").assertIsDisplayed()
    }

    @Test
    fun `QR-Code scannen oeffnet den Scanner und loescht die alte Meldung`() {
        modell.meldung = "alt"
        zeige()
        compose.onNodeWithTag("scannen").performClick()
        assertEquals(1, scans)
        assertEquals(null, modell.meldung)
    }

    @Test
    fun `Code eingeben oeffnet die Eingabe von Server und Code`() {
        zeige()
        compose.onNodeWithTag("code-eingeben").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Server und Code stehen unter dem QR-Code der Einsatzleitung.").assertExists()
    }
}
