package dev.rubeen.lifeline.android

import android.content.Context
import android.net.Uri
import android.os.Looper
import android.webkit.ValueCallback
import android.webkit.WebView
import androidx.browser.auth.AuthTabIntent
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.android.dienste.Anmelder
import dev.rubeen.lifeline.android.dienste.Anmeldeweg
import dev.rubeen.lifeline.kern.Anmeldung
import dev.rubeen.lifeline.kern.ServerAdresse
import java.net.URI
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * „Im Browser anmelden“ (Entwurf D7): ein Rücksprung zählt nur, solange die App eine Anmeldung
 * offen hat; Abbruch und Ergebnis gehen nur an den WebView, in dem sie begann.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AnmelderTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private val code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    private val ruecksprung = "lifeline://anmeldung?code=$code"

    /** Merkt sich jedes Skript, statt es auszuführen. */
    private class MitschnittWebView(context: Context) : WebView(context) {
        val skripte = mutableListOf<String>()

        override fun evaluateJavascript(script: String, resultCallback: ValueCallback<String>?) {
            skripte += script
        }
    }

    private var webView: WebView? = MitschnittWebView(context).apply { loadUrl("https://elw.local:8443/login") }
    private val skripte get() = (webView as MitschnittWebView).skripte
    private var server: ServerAdresse? = elw
    private var weg = Anmeldeweg.CUSTOM_TAB
    private val geoeffnet = mutableListOf<URI>()
    private val anmelder = Anmelder(
        webView = { webView },
        aktiverServer = { server },
        oeffne = { ziel ->
            geoeffnet += ziel
            weg
        },
    )

    private fun warteFrist() = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(Anmelder.RUECKKEHR_FRIST_MS + 100))

    @Test
    fun `ein Rücksprung ohne laufende Anmeldung bleibt wirkungslos`() {
        anmelder.ruecksprung(ruecksprung)

        assertTrue(skripte.isEmpty())
        assertFalse(anmelder.isLaufend)

        // Auch nach einer beendeten Sitzung: der zweite Rücksprung findet keine mehr.
        anmelder.start()
        anmelder.ruecksprung(ruecksprung)
        anmelder.ruecksprung(ruecksprung)

        assertEquals(1, skripte.size)
    }

    @Test
    fun `Abbruch meldet abgebrochen`() {
        weg = Anmeldeweg.AUTH_TAB
        anmelder.start()

        anmelder.authTabErgebnis(AuthTabIntent.RESULT_CANCELED, null)

        assertEquals(listOf(Anmeldung.meldungSkript(Anmeldung.Ergebnis.ABGEBROCHEN)), skripte)
        assertFalse(anmelder.isLaufend)
    }

    @Test
    fun `Rückkehr aus dem Custom Tab ohne Rücksprung meldet nach der Frist abgebrochen`() {
        anmelder.start()
        anmelder.verlassen()
        anmelder.rueckkehr()

        assertTrue("erst nach der Frist", skripte.isEmpty())
        assertTrue(anmelder.isLaufend)

        warteFrist()

        assertEquals(listOf(Anmeldung.meldungSkript(Anmeldung.Ergebnis.ABGEBROCHEN)), skripte)
        assertFalse(anmelder.isLaufend)
    }

    @Test
    fun `der Rücksprung innerhalb der Frist löst den Code ein und ist kein Abbruch`() {
        anmelder.start()
        anmelder.verlassen()
        anmelder.rueckkehr()

        anmelder.ruecksprung(ruecksprung)
        warteFrist()

        assertEquals(1, skripte.size)
        assertTrue(skripte.single().contains("/api/auth/app-code/einloesen"))
        assertTrue(skripte.single().contains(code))
    }

    @Test
    fun `eine Rückkehr vor dem Verlassen bricht nichts ab`() {
        anmelder.start()
        anmelder.rueckkehr()
        warteFrist()

        assertTrue(skripte.isEmpty())
        assertTrue(anmelder.isLaufend)
    }

    @Test
    fun `der Auth Tab liefert den Rücksprung, ein Intent zählt dann nicht`() {
        weg = Anmeldeweg.AUTH_TAB
        anmelder.start()

        anmelder.ruecksprung(ruecksprung)
        assertTrue(skripte.isEmpty())
        assertTrue(anmelder.isLaufend)

        anmelder.authTabErgebnis(AuthTabIntent.RESULT_OK, Uri.parse(ruecksprung))

        assertTrue(skripte.single().contains(code))
        assertFalse(anmelder.isLaufend)
    }

    @Test
    fun `ein gescheiterter Auth Tab meldet einen Fehler`() {
        weg = Anmeldeweg.AUTH_TAB
        anmelder.start()

        anmelder.authTabErgebnis(AuthTabIntent.RESULT_VERIFICATION_FAILED, null)

        assertEquals(listOf(Anmeldung.meldungSkript(Anmeldung.Ergebnis.FEHLER)), skripte)
    }

    @Test
    fun `die Bestätigungsseite des aktiven Servers öffnet mit der challenge`() {
        anmelder.start()

        val ziel = geoeffnet.single().toString()
        assertTrue(ziel, ziel.startsWith("https://elw.local:8443/app-anmeldung?challenge="))
        assertEquals(43, ziel.substringAfter("challenge=").length)
    }

    @Test
    fun `nach einem Serverwechsel geht das Ergebnis an keinen WebView`() {
        anmelder.start()
        val alt = skripte
        webView = MitschnittWebView(context).apply { loadUrl("https://lifeline.kv.example/login") }

        anmelder.ruecksprung(ruecksprung)

        assertTrue(alt.isEmpty())
        assertTrue(skripte.isEmpty())
    }

    @Test
    fun `ohne Server beginnt keine Sitzung`() {
        server = null

        val fehler = assertThrows(IllegalStateException::class.java) { anmelder.start() }

        assertEquals("Es ist kein Server verbunden.", fehler.message)
        assertTrue(geoeffnet.isEmpty())
        assertFalse(anmelder.isLaufend)
    }
}
