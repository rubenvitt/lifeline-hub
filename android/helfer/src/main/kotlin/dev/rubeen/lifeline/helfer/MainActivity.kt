package dev.rubeen.lifeline.helfer

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModelProvider
import dev.rubeen.lifeline.helfer.dienste.Mitteilungen
import dev.rubeen.lifeline.helfer.dienste.Systemdienste
import dev.rubeen.lifeline.helfer.ui.HelferThema
import dev.rubeen.lifeline.helferkern.Testzustand

/**
 * Einzige Activity von Lifeline Helfer (ADR-0101): von Rand zu Rand, die Systemleisten folgen dem
 * Systemmodus, Zurück mit vorausschauender Geste (`enableOnBackInvokedCallback` im Manifest,
 * `BackHandler` in den Seiten). `singleTask`: ein Deeplink `lifeline-helfer://anmelden` kommt als
 * neues Intent in dieselbe Activity. Ein Testzustand im Intent ([Testzustand.EXTRA]) zeigt nur in
 * einem Debug-Bau seine Seite mit Beispieldaten, ohne Netz, Ablage und Ortung.
 */
class MainActivity : ComponentActivity() {
    internal lateinit var modell: HelferModell
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val testzustand = testzustand(intent)
        val fabrik = HelferModell.Fabrik(testzustand) { Systemdienste(applicationContext) }
        modell = ViewModelProvider(this, fabrik).get(HelferModell::class.java)
        lifecycle.addObserver(
            LifecycleEventObserver { _, ereignis ->
                when (ereignis) {
                    Lifecycle.Event.ON_START -> modell.szene(aktiv = true)
                    Lifecycle.Event.ON_STOP -> modell.szene(aktiv = false)
                    else -> Unit
                }
            },
        )
        setContent {
            HelferThema {
                Wurzel(modell, onEinstellungen = ::oeffneEinstellungen)
            }
        }
        // Nach einem Neubau der Activity ist das Intent schon ausgewertet.
        if (savedInstanceState == null) oeffne(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        oeffne(intent)
    }

    /**
     * Ein Deeplink von außen (`lifeline-helfer://anmelden?server=…#CODE`) oder das Tippen auf die
     * Mitteilung eines Auftrags (öffnet sein Detail).
     */
    private fun oeffne(intent: Intent?) {
        val auftrag = intent?.getLongExtra(Mitteilungen.EXTRA_AUFTRAG, -1L) ?: -1L
        if (auftrag >= 0) modell.zeigeAuftrag(auftrag)
        val link = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString ?: return
        modell.oeffne(link)
    }

    /** Die Seite der App in den Einstellungen des Systems (Standort, Kamera, Benachrichtigungen). */
    private fun oeffneEinstellungen() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        } catch (_: ActivityNotFoundException) {
            // Ohne Einstellungen bleibt der Hinweis stehen.
        }
    }

    companion object {
        /** Testzustand des Starts; die Release-App übergeht das Extra (`Testzustand.fromStart`). */
        internal fun testzustand(intent: Intent?, isDebug: Boolean = BuildConfig.DEBUG): Testzustand? =
            Testzustand.fromStart(intent?.getStringExtra(Testzustand.EXTRA), isDebug)
    }
}
