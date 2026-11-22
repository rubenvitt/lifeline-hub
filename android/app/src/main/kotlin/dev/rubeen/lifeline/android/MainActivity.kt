package dev.rubeen.lifeline.android

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
        modell = AppModell(Testzustand.from(intent.getStringExtra(Testzustand.EXTRA)))
        setContent {
            LifelineThema {
                Wurzel()
            }
        }
    }
}

@Composable
private fun Wurzel() {
    // Die Fläche setzt Grund und Textfarbe des Themas für alles darunter.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Platzhalter, bis die nativen Seiten stehen: jede Seite zeigt vorerst den Kopf des
            // Onboardings.
            Text("Kein Server eingerichtet", style = MaterialTheme.typography.titleLarge)
            Text(
                "Lifeline zeigt die Oberfläche deines Einsatzservers. Gib seine Adresse ein oder " +
                    "scanne einen QR-Code mit der Adresse.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
