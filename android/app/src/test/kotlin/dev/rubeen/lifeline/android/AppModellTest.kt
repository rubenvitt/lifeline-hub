package dev.rubeen.lifeline.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.http.SslCertificate
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
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
import dev.rubeen.lifeline.kern.Statusseite
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
import org.robolectric.shadows.ShadowToast
import org.robolectric.util.ReflectionHelpers
import kotlinx.coroutines.CompletableDeferred
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

    /**
     * Review W2: erste Sitzung nach dem Onboarding, Oberfläche geladen, dann Rückkehr mit toter
     * Seite ohne Netz. Die App lädt aus dem Profil (Entwurf D5) statt „nicht erreichbar“.
     */
    @Test
    fun `ohne Netz lädt ein eben verbundener Server in derselben Sitzung offline`() {
        val fabrik = AttrappenFabrik()
        var abruf: ShellAbruf = vertraeglich
        ablage.save(Serverliste())
        val modell = AppModell(
            testzustand = null, version = "1.0.0", build = 1, einstellungen = null, scope = scope,
            context = context, fabrik = fabrik, ablage = ablage,
            abrufen = { _: ServerAdresse -> abruf to null }, dienste = Dienstattrappe(),
        )
        modell.start()
        modell.send(Onboarding.Event.TextChanged("https://elw.local:8443"))
        modell.send(Onboarding.Event.Verbinden)
        val webView = modell.webView!!
        shadowOf(webView).webViewClient.onPageCommitVisible(webView, "https://elw.local:8443/etb")

        abruf = ShellAbruf.Fehler(Netzfehler.VERBINDUNG)
        modell.send(Ablauf.Event.Vordergrund(seiteAntwortet = false, adresse = null, anmeldungLaeuft = false))

        val seite = modell.seite as Ablauf.Seite.Web
        assertTrue("aus dem Profil, ohne Netz", seite.offline)
        assertEquals("https://elw.local:8443/", shadowOf(modell.webView!!).lastLoadedUrl)
    }

    /** Review K6: ein Zertifikatsfehler einer Kachel mit für `java.net.URI` unlesbarer Adresse. */
    @Test
    fun `ein Zertifikatsfehler eines fremden Bildes lässt die Oberfläche stehen`() {
        val modell = modell(AttrappenFabrik())
        modell.start()
        val webView = modell.webView!!
        val client = shadowOf(webView).webViewClient
        val handler = ReflectionHelpers.callConstructor(SslErrorHandler::class.java)
        @Suppress("DEPRECATION")
        val zertifikat = SslCertificate("kacheln.example", "Unbekannte CA", java.util.Date(), java.util.Date())

        client.onReceivedSslError(webView, handler, SslError(SslError.SSL_UNTRUSTED, zertifikat, "https://kacheln.example/{z}|1.png"))
        assertTrue(modell.seite is Ablauf.Seite.Web)

        client.onReceivedSslError(webView, handler, SslError(SslError.SSL_UNTRUSTED, zertifikat, "https://elw.local:8443/{z}|1.png"))
        assertEquals(Ablauf.Seite.Status(elw.copy(bestaetigterVertrag = 1), Statusseite.Zertifikat), modell.seite)
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

    /** Review K10: ein Modell, dessen Ablage nicht schreiben kann (Speicher voll). */
    private fun modellOhneSpeicher(fabrik: AttrappenFabrik, gespeichert: Serverliste): AppModell {
        val verzeichnis = ordner.newFolder("liste")
        val kaputt = Serverablage(verzeichnis).also { it.save(gespeichert) }
        return AppModell(
            testzustand = null, version = "1.0.0", build = 1, einstellungen = null, scope = scope,
            context = context, fabrik = fabrik, ablage = kaputt,
            abrufen = { _: ServerAdresse -> vertraeglich to null }, dienste = Dienstattrappe(),
        ).also {
            // Gelesen ist die Liste; ab jetzt ist das Verzeichnis eine Datei und Schreiben scheitert.
            verzeichnis.deleteRecursively()
            verzeichnis.writeText("kein Verzeichnis")
        }
    }

    @Test
    fun `scheitert das Speichern beim Entfernen, zeigt die App den Fehler`() {
        val fabrik = AttrappenFabrik()
        val modell = modellOhneSpeicher(fabrik, liste)
        modell.start()

        modell.entfernen(lager)

        assertEquals(listOf(lager.id), fabrik.geloescht)
        assertTrue(modell.entfernenFehler!!.startsWith("Die Serverliste ließ sich nicht speichern"))
    }

    @Test
    fun `scheitert das Speichern beim Hinzufügen, sagt die App es`() {
        val modell = modellOhneSpeicher(AttrappenFabrik(), Serverliste())
        modell.start()

        modell.send(Onboarding.Event.TextChanged("https://elw.local:8443"))
        modell.send(Onboarding.Event.Verbinden)

        assertTrue("der Server wirkt bis zum Neustart", modell.seite is Ablauf.Seite.Web)
        assertEquals(AppModell.SPEICHERN_FEHLGESCHLAGEN, ShadowToast.getTextOfLatestToast())
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

    /**
     * Review W1: wer „Server hinzufügen“ während der Prüfung schließt (Zurück-Taste oder Pfeil im
     * Kopf), dem wechselt ein spätes verträgliches Ergebnis nicht still den Server.
     */
    @Test
    fun `Schließen des Blatts während der Prüfung speichert und wechselt nichts`() {
        for (schliessen in listOf<(AppModell) -> Unit>({ assertTrue(it.zurueckTaste()) }, { it.schliesseHinzufuegen() })) {
            val fabrik = AttrappenFabrik()
            val antwort = CompletableDeferred<ShellAbruf>()
            ablage.save(liste)
            val modell = AppModell(
                testzustand = null, version = "1.0.0", build = 1, einstellungen = null, scope = scope,
                context = context, fabrik = fabrik, ablage = ablage,
                abrufen = { adresse: ServerAdresse -> (if (adresse == elw.adresse) vertraeglich else antwort.await()) to null },
                dienste = Dienstattrappe(),
            )
            modell.start()
            val webView = modell.webView
            modell.zeigtServerliste = true
            modell.zeigeHinzufuegen()
            modell.send(Onboarding.Event.TextChanged("https://neu.example"))
            modell.send(Onboarding.Event.Verbinden)
            assertTrue(modell.onboarding is Onboarding.State.Pruefung)

            schliessen(modell)
            assertFalse(modell.zeigtOnboarding)
            antwort.complete(vertraeglich)

            assertEquals(elw.id, modell.liste.aktiv?.id)
            assertNull(modell.liste.eintragFuer(ServerAdresse.parse("https://neu.example")))
            assertEquals(liste.eintraege.map { it.id }, ablage.load().eintraege.map { it.id })
            assertSame("die Oberfläche von ELW 1 bleibt", webView, modell.webView)
            assertEquals(listOf(elw.id), fabrik.profile)
        }
    }

    /** Review W3: nur ein Debug-Bau zeigt Testzustände; die Release-App übergeht das Extra. */
    @Test
    fun `der Testzustand im Intent gilt nur in einem Debug-Bau`() {
        val intent = Intent(context, MainActivity::class.java).putExtra(Testzustand.EXTRA, Testzustand.UPDATE_LAEUFT.wert)

        assertEquals(Testzustand.UPDATE_LAEUFT, MainActivity.testzustand(intent, isDebug = true))
        assertNull(MainActivity.testzustand(intent, isDebug = false))
        assertEquals("die Tests laufen als Debug-Bau", Testzustand.UPDATE_LAEUFT, MainActivity.testzustand(intent))
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
