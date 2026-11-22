package dev.rubeen.lifeline.android

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import dev.rubeen.lifeline.android.ui.LifelineThema
import dev.rubeen.lifeline.kern.Testzustand

/**
 * Einzige Activity der Hülle: randlos auf Kopf-Schwarz mit hellen Symbolen in den Systemleisten
 * (Entwurf D6); der Inhalt hält sich an die Insets. Ein Testzustand im Intent
 * ([Testzustand.EXTRA]) zeigt seine Seite mit Beispieldaten.
 */
class MainActivity : ComponentActivity() {
    private lateinit var modell: AppModell

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dunkle Leisten: helle Symbole, unabhängig vom Systemmodus.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val testzustand = Testzustand.from(intent.getStringExtra(Testzustand.EXTRA))
        modell = AppModell(
            testzustand = testzustand,
            version = BuildConfig.VERSION_NAME,
            build = BuildConfig.VERSION_CODE,
            // Im Testzustand speichert die App nichts.
            einstellungen = if (testzustand == null) getSharedPreferences("lifeline", MODE_PRIVATE) else null,
            scope = lifecycleScope,
        )
        setContent {
            LifelineThema {
                Wurzel(modell)
            }
        }
    }
}
