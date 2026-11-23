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
import dev.rubeen.lifeline.android.dienste.Activityzugriffe
import dev.rubeen.lifeline.android.dienste.Anmeldebrowser
import dev.rubeen.lifeline.android.dienste.Anmelder
import dev.rubeen.lifeline.android.dienste.Downloads
import dev.rubeen.lifeline.android.dienste.Systemdienste
import dev.rubeen.lifeline.android.ui.LifelineThema
import dev.rubeen.lifeline.android.update.UpdatePruefung
import dev.rubeen.lifeline.kern.Rueckkehr
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.Testzustand
import java.io.File
import java.net.URI

/**
 * Einzige Activity der Hülle: randlos auf Kopf-Schwarz mit hellen Symbolen in den Systemleisten
 * (Entwurf D6); der Inhalt hält sich an die Insets. Ein Testzustand im Intent
 * ([Testzustand.EXTRA]) zeigt nur in einem Debug-Bau seine Seite mit Beispieldaten.
 * `singleTask`: Deeplinks und der Rücksprung der Anmeldung kommen als neues Intent in dieselbe
 * Activity ([AppModell.open]).
 */
class MainActivity : ComponentActivity() {
    internal lateinit var modell: AppModell
        private set
    private lateinit var anmelder: Anmelder

    override fun onCreate(savedInstanceState: Bundle?) {
        // Dunkle Leisten: helle Symbole, unabhängig vom Systemmodus.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val testzustand = testzustand(intent)
        val app = application as LifelineApp
        val fabrik = app.webviewFabrik
        // Im Testzustand sucht die App keine Updates; der Updater setzt beim Bau den Kanal.
        val updater = if (testzustand == null) app.updater else null
        val mitUpdates = updater?.kanal != null
        val einstellungen = getSharedPreferences("lifeline", MODE_PRIVATE)
        // Die Dienste lesen das Modell erst beim Aufruf; ihre Activity-Ergebnisse melden sie hier
        // an, vor dem Start der Activity.
        val browser = Anmeldebrowser(this) { code, adresse -> anmelder.authTabErgebnis(code, adresse) }
        val zugriffe = Activityzugriffe(this)
        anmelder = Anmelder(
            webView = { modell.webView },
            aktiverServer = { modell.liste.aktiv?.adresse },
            oeffne = browser::open,
        )
        val downloads = Downloads(this, lifecycleScope, aktiverServer = { modell.liste.aktiv?.adresse }, cookie = fabrik::cookie)
        val dienste = Systemdienste(this, webView = { modell.webView }, anmelder, downloads, einstellungen)
        modell = AppModell(
            testzustand = testzustand,
            version = BuildConfig.VERSION_NAME,
            build = BuildConfig.VERSION_CODE,
            // Im Testzustand speichert die App nichts.
            einstellungen = if (testzustand == null) einstellungen else null,
            scope = lifecycleScope,
            context = this,
            fabrik = fabrik,
            ablage = if (testzustand == null) Serverablage(File(filesDir, "lifeline")) else null,
            dienste = dienste,
            oeffne = ::oeffne,
            downloads = downloads,
            anmelder = anmelder,
            updater = updater,
            zugriffe = zugriffe,
        )
        if (mitUpdates) UpdatePruefung.planen(this)
        // Zurück (Entwurf D6): native Seite schließen, im WebView zurück, sonst in den Hintergrund;
        // die App endet nicht und führt nicht ins Onboarding. Der QR-Scanner hängt sich davor.
        onBackPressedDispatcher.addCallback(this) {
            if (!modell.zurueckTaste()) moveTaskToBack(true)
        }
        lifecycle.addObserver(
            LifecycleEventObserver { _, ereignis ->
                when (ereignis) {
                    // Zurück im Vordergrund: keine Installation unter der Hand, Prüfung, wenn fällig.
                    Lifecycle.Event.ON_START -> {
                        app.imVordergrund = true
                        if (mitUpdates) {
                            UpdatePruefung.rueckkehr(this)
                            modell.imVordergrund()
                        }
                    }
                    Lifecycle.Event.ON_RESUME -> {
                        modell.phase(Rueckkehr.Phase.ACTIVE)
                        anmelder.rueckkehr()
                    }
                    Lifecycle.Event.ON_PAUSE -> modell.phase(Rueckkehr.Phase.INACTIVE)
                    Lifecycle.Event.ON_STOP -> {
                        app.imVordergrund = false
                        modell.phase(Rueckkehr.Phase.BACKGROUND)
                        anmelder.verlassen()
                        // Nach 15 Minuten im Hintergrund darf der Updater installieren (Entwurf D9, Fall b).
                        if (mitUpdates) UpdatePruefung.verlassen(this, System.currentTimeMillis())
                    }
                    else -> Unit
                }
            },
        )
        setContent {
            LifelineThema {
                Wurzel(modell)
            }
        }
        modell.start(neubau = savedInstanceState != null)
        // Nach einem Neubau der Activity ist das Intent schon ausgewertet.
        if (savedInstanceState == null) open(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        open(intent)
    }

    /** Ein Link von außen (`lifeline://verbinden`, `lifeline://anmeldung`). */
    private fun open(intent: Intent) {
        if (intent.action != Intent.ACTION_VIEW) return
        intent.dataString?.let(modell::open)
    }

    override fun onDestroy() {
        anmelder.abbrechen()
        modell.beenden()
        super.onDestroy()
    }

    companion object {
        /** Testzustand des Starts; die Release-App übergeht das Extra (`Testzustand.fromStart`). */
        internal fun testzustand(intent: Intent?, isDebug: Boolean = BuildConfig.DEBUG): Testzustand? =
            Testzustand.fromStart(intent?.getStringExtra(Testzustand.EXTRA), isDebug)
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
