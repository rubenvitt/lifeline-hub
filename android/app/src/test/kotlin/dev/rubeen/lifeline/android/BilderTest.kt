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
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bildlauf (Entwurf D10): jede native Seite über ihren Testzustand, ohne Netz und ohne Ablage,
 * im Hochformat eines Handys und im Querformat eines Tablets, als Bild nach
 * `android/app/build/bilder/<zustand>-<format>.png`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class BilderTest(private val zustand: Testzustand, private val format: Format) {
    enum class Format(val kennung: String, val qualifiers: String) {
        HANDY("handy", "w411dp-h891dp-port-xhdpi"),
        TABLET("tablet", "w1280dp-h800dp-land-mdpi"),
    }

    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun `die Seite des Testzustands wird als Bild aufgenommen`() {
        RuntimeEnvironment.setQualifiers(format.qualifiers)
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(Testzustand.EXTRA, zustand.wert)
        ActivityScenario.launch<MainActivity>(intent).use {
            compose.waitForIdle()
            compose.onRoot().captureRoboImage("build/bilder/${zustand.wert}-${format.kennung}.png")
        }
    }

    companion object {
        /** Die nativen Seiten; `web` und `fremde-seite` zeigen den WebView (eigener Lauf). */
        private val SEITEN = listOf(
            Testzustand.ONBOARDING,
            Testzustand.SERVERLISTE,
            Testzustand.EINSTELLUNGEN,
            Testzustand.ZERTIFIKAT,
            Testzustand.NICHT_ERREICHBAR,
            Testzustand.ZU_ALT,
            Testzustand.ZU_NEU,
            Testzustand.WEBVIEW_VERALTET,
            Testzustand.UPDATE_BEREIT,
            Testzustand.UPDATE_LAEUFT,
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun faelle(): List<Array<Any>> = SEITEN.flatMap { zustand -> Format.entries.map { arrayOf(zustand, it) } }
    }
}
