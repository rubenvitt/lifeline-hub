package dev.rubeen.lifeline.helfer

import android.content.Intent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.rubeen.lifeline.helferkern.Testzustand
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bildlauf der Helfer-App: jede Seite über ihren Testzustand, ohne Netz, Ablage und Ortung, hell
 * und dunkel, als Bild nach `android/helfer/build/bilder/<zustand>-<modus>.png` (Bilder der Änderung).
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class BilderTest(private val zustand: Testzustand, private val modus: Modus) {
    enum class Modus(val kennung: String, val qualifiers: String) {
        HELL("hell", "w411dp-h891dp-port-notnight-xhdpi"),
        DUNKEL("dunkel", "w411dp-h891dp-port-night-xhdpi"),
    }

    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun `die Seite des Testzustands wird als Bild aufgenommen`() {
        RuntimeEnvironment.setQualifiers(modus.qualifiers)
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(Testzustand.EXTRA, zustand.wert)
        ActivityScenario.launch<MainActivity>(intent).use {
            compose.waitForIdle()
            compose.onRoot().captureRoboImage("build/bilder/${zustand.wert}-${modus.kennung}.png")
        }
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun faelle(): List<Array<Any>> = Testzustand.entries.flatMap { zustand -> Modus.entries.map { arrayOf(zustand, it) } }
    }
}
