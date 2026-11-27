package dev.rubeen.lifeline.helfer

import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.rubeen.lifeline.helfer.dienste.Mitteilungen
import dev.rubeen.lifeline.helferkern.Auftraege
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Vollbild des Pagers (LLH-2157): „Neuer Auftrag“ bzw. die Erinnerung und „Ansehen“, ohne Inhalt,
 * hell und dunkel als Bild nach `android/helfer/build/bilder/pager-<art>-<modus>.png`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class PagerBilderTest(private val erinnerung: Int, private val modus: BilderTest.Modus) {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun `das Vollbild zeigt nur den Kopf und Ansehen`() {
        RuntimeEnvironment.setQualifiers(modus.qualifiers)
        val intent = Intent(ApplicationProvider.getApplicationContext(), PagerActivity::class.java)
            .putExtra(Mitteilungen.EXTRA_AUFTRAG, 7L)
            .putExtra(PagerActivity.EXTRA_ERINNERUNG, erinnerung)
        ActivityScenario.launch<PagerActivity>(intent).use {
            compose.waitForIdle()
            val titel = if (erinnerung > 0) Auftraege.ERINNERUNG_OEFFENTLICH else Auftraege.MITTEILUNG_OEFFENTLICH
            compose.onNodeWithTag("pager-titel").assertTextEquals(titel)
            compose.onNodeWithTag("pager-ansehen").assertIsDisplayed()
            val art = if (erinnerung > 0) "erinnerung" else "neu"
            compose.onRoot().captureRoboImage("build/bilder/pager-$art-${modus.kennung}.png")
        }
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun faelle(): List<Array<Any>> = listOf(0, 1).flatMap { e -> BilderTest.Modus.entries.map { arrayOf(e, it) } }
    }
}
