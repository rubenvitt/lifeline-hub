package dev.rubeen.lifeline.android

import android.content.Context
import android.content.Intent
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Netzfehler
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.ShellAbruf
import dev.rubeen.lifeline.kern.Testzustand
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel

/**
 * Das Modell führt aus, was `Ablauf` verlangt (Entwurf D3, D5, D6): ein WebView je Profil,
 * kein WebView ohne taugliches System, Zurück im WebView, sonst in den Hintergrund.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AppModellTest {
    @get:Rule
    val ordner = TemporaryFolder()

    private val context: Context = ApplicationProvider.getApplicationContext()

    // Beispielliste der Bilder: „ELW 1“ aktiv, „Lager“ nie verbunden, „Kreisverband“ verbunden.
    private val liste: Serverliste = AppModell.beispielliste()
    private val elw: ServerEintrag = liste.eintraege.first { it.name == "ELW 1" }
    private val lager: ServerEintrag = liste.eintraege.first { it.name == "Lager" }
    private val kv: ServerEintrag = liste.eintraege.first { it.name == "Kreisverband" }

    private val vertraeglich = ShellAbruf.Antwort(200, """{"version":"1.0.0","shell_contract":1}""", "application/json")
    private val ablage by lazy { Serverablage(ordner.root) }

    // Läuft im Testfaden; Zeitgeber (Wiederholen) enden mit dem Test.
    private val scope = CoroutineScope(Dispatchers.Unconfined + Job())

    @After
    fun beende() {
        scope.cancel()
    }

    /** Ein Modell mit gespeicherter Liste; der Abruf antwortet sofort, alles läuft im Testfaden. */
    private fun modell(
        fabrik: AttrappenFabrik,
        gespeichert: Serverliste = liste,
        abruf: ShellAbruf = vertraeglich,
    ): AppModell {
        ablage.save(gespeichert)
        return AppModell(
            testzustand = null,
            version = "1.0.0",
            build = 1,
            einstellungen = null,
            scope = scope,
            context = context,
            fabrik = fabrik,
            ablage = ablage,
            abrufen = { _: ServerAdresse -> abruf to null },
        )
    }

    @Test
    fun `Wechsel baut den WebView mit dem Profil des neuen Servers`() {
        val fabrik = AttrappenFabrik()
        val modell = modell(fabrik)

        modell.start()
        val erster = modell.webView!!
        assertEquals(listOf(elw.id), fabrik.profile)
        assertEquals(elw.adresse.text, shadowOf(erster).lastLoadedUrl)

        modell.wechseln(kv)

        assertEquals(listOf(elw.id, kv.id), fabrik.profile)
        val zweiter = modell.webView!!
        assertNotSame(erster, zweiter)
        assertTrue("der alte WebView ist zerstört", shadowOf(erster).wasDestroyCalled())
        assertEquals(kv.adresse.text, shadowOf(zweiter).lastLoadedUrl)
        assertEquals(kv.id, ablage.load().aktiv?.id)
    }

    @Test
    fun `ohne taugliches WebView kein WebView`() {
        val fabrik = AttrappenFabrik(tauglich = false)
        val modell = modell(fabrik)

        modell.start()

        assertEquals(Ablauf.Seite.WebviewVeraltet, modell.seite)
        assertNull(modell.webView)
        assertTrue(fabrik.profile.isEmpty())
    }

    @Test
    fun `ein beendeter Render-Prozess baut den WebView im selben Profil neu`() {
        val fabrik = AttrappenFabrik()
        val modell = modell(fabrik)
        modell.start()
        val erster = modell.webView!!

        val beendet = shadowOf(erster).webViewClient.onRenderProcessGone(erster, Abgestuerzt)

        assertTrue("der Rückruf meldet den Prozess als behandelt", beendet)
        assertTrue(shadowOf(erster).wasDestroyCalled())
        assertEquals(listOf(elw.id, elw.id), fabrik.profile)
        assertEquals(elw.adresse.text, shadowOf(modell.webView!!).lastLoadedUrl)
    }

    @Test
    fun `ohne Netz lädt ein schon geladener Server die Oberfläche aus seinem Profil`() {
        val fabrik = AttrappenFabrik()
        val geladen = liste.markGeladen(elw.id)
        val modell = modell(fabrik, gespeichert = geladen, abruf = ShellAbruf.Fehler(Netzfehler.VERBINDUNG))

        modell.start()

        val seite = modell.seite as Ablauf.Seite.Web
        assertTrue(seite.offline)
        assertEquals(elw.adresse.text, shadowOf(modell.webView!!).lastLoadedUrl)
    }

    @Test
    fun `die erste geladene Seite des Servers wird in der Ablage vermerkt`() {
        val modell = modell(AttrappenFabrik())
        modell.start()
        val webView = modell.webView!!

        shadowOf(webView).webViewClient.onPageCommitVisible(webView, "https://elw.local:8443/etb")

        assertTrue(ablage.load().eintraege.first { it.id == elw.id }.geladenImProfil)
    }

    @Test
    fun `Entfernen löscht das Profil und dann den Eintrag`() {
        val fabrik = AttrappenFabrik()
        val modell = modell(fabrik)
        modell.start()

        modell.entfernen(lager)

        assertEquals(listOf(lager.id), fabrik.geloescht)
        assertFalse(modell.liste.eintraege.any { it.id == lager.id })
        assertFalse(ablage.load().eintraege.any { it.id == lager.id })
        assertNull(modell.entfernenFehler)
    }

    @Test
    fun `Zurück geht im WebView zurück, sonst in den Hintergrund`() {
        ApplicationProvider.getApplicationContext<LifelineApp>().webviewFabrik = AttrappenFabrik()
        val intent = Intent(context, MainActivity::class.java).putExtra(Testzustand.EXTRA, Testzustand.WEB.wert)
        ActivityScenario.launch<MainActivity>(intent).use { szenario ->
            szenario.onActivity { activity ->
                val webView: WebView = activity.modell.webView!!
                // Zwei Seiten im Verlauf: einmal zurück geht im WebView, danach nicht mehr.
                shadowOf(webView).pushEntryToHistory("https://elw.local:8443/")
                shadowOf(webView).pushEntryToHistory("https://elw.local:8443/etb")

                activity.onBackPressedDispatcher.onBackPressed()

                assertEquals(1, shadowOf(webView).goBackInvocations)
                assertFalse(shadowOf(activity).isTaskMovedToBack)

                activity.onBackPressedDispatcher.onBackPressed()

                assertEquals(1, shadowOf(webView).goBackInvocations)
                assertTrue("die App geht in den Hintergrund", shadowOf(activity).isTaskMovedToBack)
                assertFalse("die App endet nicht", activity.isFinishing)
            }
        }
    }

    @Test
    fun `Zurück schließt zuerst die Serverliste`() {
        ApplicationProvider.getApplicationContext<LifelineApp>().webviewFabrik = AttrappenFabrik()
        val intent = Intent(context, MainActivity::class.java).putExtra(Testzustand.EXTRA, Testzustand.WEB.wert)
        ActivityScenario.launch<MainActivity>(intent).use { szenario ->
            szenario.onActivity { activity ->
                val webView: WebView = activity.modell.webView!!
                shadowOf(webView).pushEntryToHistory("https://elw.local:8443/")
                shadowOf(webView).pushEntryToHistory("https://elw.local:8443/etb")
                activity.modell.zeigtServerliste = true

                activity.onBackPressedDispatcher.onBackPressed()

                assertFalse(activity.modell.zeigtServerliste)
                assertEquals(0, shadowOf(webView).goBackInvocations)
                assertFalse(shadowOf(activity).isTaskMovedToBack)
            }
        }
    }

    @Suppress("DEPRECATION") // Den Rückruf ruft sonst nur der WebView selbst.
    private object Abgestuerzt : RenderProcessGoneDetail() {
        override fun didCrash(): Boolean = true

        override fun rendererPriorityAtExit(): Int = 0
    }
}
