package dev.rubeen.lifeline.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.android.dienste.Anmelder
import dev.rubeen.lifeline.android.dienste.Anmeldeweg
import dev.rubeen.lifeline.android.dienste.Downloads
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Netzfehler
import dev.rubeen.lifeline.kern.Onboarding
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverablage
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.ShellAbruf
import dev.rubeen.lifeline.kern.Testzustand
import java.net.URI
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
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
        anmelder: Anmelder? = null,
        downloads: Downloads? = null,
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
            dienste = Dienstattrappe(),
            anmelder = anmelder,
            downloads = downloads,
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

    // Deeplink `lifeline://verbinden` (Entwurf D2, gemeinsame Fälle) und Rücksprung der Anmeldung

    @Test
    fun `ein Deeplink auf einen unbekannten Server belegt das Hinzufügen vor`() {
        val modell = modell(AttrappenFabrik())
        modell.start()
        val seite = modell.seite
        val gestartet = modell.liste

        modell.open("lifeline://verbinden?server=https%3A%2F%2Fneu.example")

        assertTrue(modell.zeigtOnboarding)
        assertEquals(Onboarding.State.Eingabe(ServerAdresse.parse("https://neu.example").text, null), modell.onboarding)
        assertEquals(seite, modell.seite)
        assertEquals(gestartet, modell.liste)
        assertNull(modell.wechselRueckfrage)
    }

    @Test
    fun `ohne Server belegt ein Deeplink das Onboarding vor`() {
        val modell = modell(AttrappenFabrik(), gespeichert = Serverliste())
        modell.start()

        modell.open("lifeline://verbinden?server=https://neu.example")

        assertEquals(Ablauf.Seite.Onboarding, modell.seite)
        assertFalse("die Seite selbst ist das Onboarding", modell.zeigtOnboarding)
        assertEquals(Onboarding.State.Eingabe(ServerAdresse.parse("https://neu.example").text, null), modell.onboarding)
    }

    @Test
    fun `ein Deeplink auf einen gespeicherten Server wechselt erst nach Rückfrage`() {
        val fabrik = AttrappenFabrik()
        val modell = modell(fabrik)
        modell.start()

        modell.open("lifeline://verbinden?server=https://lager.example")

        assertEquals(lager.id, modell.wechselRueckfrage?.id)
        assertEquals(listOf(elw.id), fabrik.profile)
        assertEquals(elw.id, modell.liste.aktiv?.id)

        modell.wechseln(modell.wechselRueckfrage!!)

        assertNull(modell.wechselRueckfrage)
        assertEquals(listOf(elw.id, lager.id), fabrik.profile)
        assertEquals(lager.id, ablage.load().aktiv?.id)
    }

    @Test
    fun `ein Deeplink auf den aktiven Server oder ein ungültiger Link ändert nichts`() {
        val fabrik = AttrappenFabrik()
        val modell = modell(fabrik)
        modell.start()
        val seite = modell.seite

        modell.open("lifeline://verbinden?server=https://elw.local:8443")
        modell.open("lifeline://verbinden?server=http://lager.example")
        modell.open("lifeline://verbinden")
        modell.open("https://lager.example")

        assertEquals(seite, modell.seite)
        assertFalse(modell.zeigtOnboarding)
        assertNull(modell.wechselRueckfrage)
        assertEquals(listOf(elw.id), fabrik.profile)
    }

    @Test
    fun `ein Rücksprung der Anmeldung ohne laufende Anmeldung bleibt wirkungslos`() {
        lateinit var modell: AppModell
        val geoeffnet = mutableListOf<URI>()
        val anmelder = Anmelder(
            webView = { modell.webView },
            aktiverServer = { modell.liste.aktiv?.adresse },
            oeffne = {
                geoeffnet += it
                Anmeldeweg.CUSTOM_TAB
            },
        )
        modell = modell(AttrappenFabrik(), anmelder = anmelder)
        modell.start()
        val webView = modell.webView!!
        val seite = modell.seite
        val gestartet = modell.liste
        val code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        modell.open("lifeline://anmeldung?code=$code")
        modell.open("lifeline://anmeldung?code=$code&server=https://lager.example")

        assertEquals(seite, modell.seite)
        assertSame(webView, modell.webView)
        assertNull(shadowOf(webView).lastEvaluatedJavascript)
        assertEquals(Onboarding.State.START, modell.onboarding)
        assertEquals(gestartet, modell.liste)
        assertFalse(modell.zeigtOnboarding)
        assertNull(modell.wechselRueckfrage)
        assertTrue(geoeffnet.isEmpty())
        assertFalse(anmelder.isLaufend)
    }

    @Test
    fun `während der Anmeldung im Custom Tab geht der Rücksprung an den Anmelder`() {
        lateinit var modell: AppModell
        val anmelder = Anmelder(
            webView = { modell.webView },
            aktiverServer = { modell.liste.aktiv?.adresse },
            oeffne = { Anmeldeweg.CUSTOM_TAB },
        )
        modell = modell(AttrappenFabrik(), anmelder = anmelder)
        modell.start()
        val webView = modell.webView!!
        webView.loadUrl("https://elw.local:8443/login")
        val code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        anmelder.start()
        modell.open("lifeline://anmeldung?code=$code")

        assertTrue(shadowOf(webView).lastEvaluatedJavascript.contains(code))
        assertFalse(anmelder.isLaufend)
    }

    @Test
    fun `die Activity wertet den Deeplink beim Start und als neues Intent aus`() {
        ApplicationProvider.getApplicationContext<LifelineApp>().webviewFabrik = AttrappenFabrik()
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("lifeline://verbinden?server=https://elw.local:8443"))
        val steuerung = Robolectric.buildActivity(MainActivity::class.java, link).setup()
        val modell = steuerung.get().modell

        assertEquals(Onboarding.State.Eingabe(elw.adresse.text, null), modell.onboarding)

        steuerung.newIntent(Intent(Intent.ACTION_VIEW, Uri.parse("lifeline://verbinden?server=https://lager.example")))

        assertEquals(Onboarding.State.Eingabe(lager.adresse.text, null), modell.onboarding)
        steuerung.pause().stop().destroy()
    }

    @Test
    fun `jeder WebView meldet Downloads an die App`() {
        val downloads = Downloads(context, scope, aktiverServer = { elw.adresse }, cookie = { _, _ -> null })
        val modell = modell(AttrappenFabrik(), downloads = downloads)
        modell.start()

        assertNotNull(shadowOf(modell.webView!!).downloadListener)
    }

    @Suppress("DEPRECATION") // Den Rückruf ruft sonst nur der WebView selbst.
    private object Abgestuerzt : RenderProcessGoneDetail() {
        override fun didCrash(): Boolean = true

        override fun rendererPriorityAtExit(): Int = 0
    }
}
