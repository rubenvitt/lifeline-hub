package dev.rubeen.lifeline.android

import android.content.Intent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.rubeen.lifeline.kern.Testzustand
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bildlauf (Entwurf D10): jede native Seite über ihren Testzustand, ohne Netz und ohne Ablage,
 * als Bild nach `android/app/build/bilder/<name>.png`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w411dp-h891dp-xxhdpi")
class BilderTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private fun bild(zustand: Testzustand, name: String) {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(Testzustand.EXTRA, zustand.wert)
        ActivityScenario.launch<MainActivity>(intent).use {
            compose.waitForIdle()
            compose.onRoot().captureRoboImage("build/bilder/$name.png")
        }
    }

    @Test
    fun `Onboarding als Bild`() = bild(Testzustand.ONBOARDING, "onboarding")
}
