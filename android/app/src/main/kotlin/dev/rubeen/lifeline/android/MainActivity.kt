package dev.rubeen.lifeline.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.lifecycleScope
import dev.rubeen.lifeline.android.ui.LifelineThema
import dev.rubeen.lifeline.kern.Rueckkehr
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.Testzustand
import java.io.File
import java.net.URI

/**
 * Einzige Activity der Hülle: randlos auf Kopf-Schwarz mit hellen Symbolen in den Systemleisten
 * (Entwurf D6); der Inhalt hält sich an die Insets. Ein Testzustand im Intent
 * ([Testzustand.EXTRA]) zeigt seine Seite mit Beispieldaten.
 */
class MainActivity : ComponentActivity() {
    internal lateinit var modell: AppModell
        private set

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
            context = this,
            fabrik = (application as LifelineApp).webviewFabrik,
            ablage = if (testzustand == null) Serverablage(File(filesDir, "lifeline")) else null,
            oeffne = ::oeffne,
        )
        // Zurück (Entwurf D6): native Seite schließen, im WebView zurück, sonst in den Hintergrund;
        // die App endet nicht und führt nicht ins Onboarding. Der QR-Scanner hängt sich davor.
        onBackPressedDispatcher.addCallback(this) {
            if (!modell.zurueckTaste()) moveTaskToBack(true)
        }
        lifecycle.addObserver(
            LifecycleEventObserver { _, ereignis ->
                when (ereignis) {
                    Lifecycle.Event.ON_RESUME -> modell.phase(Rueckkehr.Phase.ACTIVE)
                    Lifecycle.Event.ON_PAUSE -> modell.phase(Rueckkehr.Phase.INACTIVE)
                    Lifecycle.Event.ON_STOP -> modell.phase(Rueckkehr.Phase.BACKGROUND)
                    else -> Unit
                }
            },
        )
        setContent {
            LifelineThema {
                Wurzel(modell)
            }
        }
        modell.start()
    }

    override fun onDestroy() {
        modell.beenden()
        super.onDestroy()
    }

    /** Ein Ziel für das System (Browser, Telefon, Mail); ohne passende App geschieht nichts. */
    private fun oeffne(adresse: URI) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(adresse.toString())).addCategory(Intent.CATEGORY_BROWSABLE)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w("Lifeline", "Keine App öffnet ${adresse.scheme}-Adressen", e)
        }
    }
}
