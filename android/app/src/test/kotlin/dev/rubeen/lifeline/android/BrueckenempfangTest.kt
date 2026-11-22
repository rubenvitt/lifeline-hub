package dev.rubeen.lifeline.android

import android.content.Context
import android.net.Uri
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import androidx.webkit.JavaScriptExecutionException
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewOutcomeReceiver
import dev.rubeen.lifeline.android.web.Brueckenempfang
import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.Meldungsfreigabe
import dev.rubeen.lifeline.kern.ServerAdresse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

/**
 * Der Listener `lifeline` (Entwurf D4, Review Focus 1): nur Hauptframe und Origin des aktiven
 * Servers, und eine Antwort erreicht nie die Seite eines anderen Servers.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class BrueckenempfangTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private val kv = ServerAdresse.parse("https://lifeline.kv.example")

    private var aktiverServer: ServerAdresse = elw
    private val alt = WebView(context).apply { loadUrl("https://elw.local:8443/etb") }
    private var aktuell: WebView = alt

    private val dienste = Druckattrappe()
    private val empfang = Brueckenempfang(
        dienste = dienste,
        aktiverServer = { aktiverServer },
        isAktuell = { it === aktuell },
        scope = CoroutineScope(Dispatchers.Unconfined),
    )
    private val antworten = mutableListOf<String>()
    private val proxy = object : JavaScriptReplyProxy() {
        override fun postMessage(message: String) {
            antworten += message
        }

        override fun postMessage(arrayBuffer: ByteArray) = throw UnsupportedOperationException()

        override fun executeJavaScript(
            script: String,
            callback: WebViewOutcomeReceiver<String, JavaScriptExecutionException>?,
        ) = throw UnsupportedOperationException()
    }

    private fun drucke(origin: String = "https://elw.local:8443", hauptframe: Boolean = true) =
        empfang.onPostMessage(alt, WebMessageCompat("""{"cmd":"print","id":7}"""), Uri.parse(origin), hauptframe, proxy)

    @Test
    fun `eine Nachricht des aktiven Servers bekommt ihre Antwort`() {
        drucke()
        dienste.gedruckt.complete(true)

        assertEquals(listOf("""{"id":7,"fehler":null,"wert":true}"""), antworten)
    }

    @Test
    fun `nach einem Wechsel verfällt die Antwort für den alten Server`() {
        drucke()
        assertEquals(1, dienste.aufrufe)

        // Der Wechsel baut einen neuen WebView für einen anderen Server, während der Druck läuft.
        aktiverServer = kv
        aktuell = WebView(context).apply { loadUrl("https://lifeline.kv.example/") }
        dienste.gedruckt.complete(true)

        assertTrue(antworten.isEmpty())
    }

    @Test
    fun `Unterframes und fremde Origins bleiben ohne Wirkung`() {
        drucke(hauptframe = false)
        drucke(origin = "https://idp.example")
        drucke(origin = "http://elw.local:8443")

        assertEquals(0, dienste.aufrufe)
        assertTrue(antworten.isEmpty())
    }

    /** Druckt erst, wenn der Test es sagt; alles andere braucht die Brücke hier nicht. */
    private class Druckattrappe : Huellendienste {
        val gedruckt = CompletableDeferred<Boolean>()
        var aufrufe = 0

        override val isHaptikEnabled: Boolean = false

        override fun play(feedback: Haptik.Feedback) = Unit

        override suspend fun loadMeldungsfreigabe(): Meldungsfreigabe = Meldungsfreigabe.VERWEIGERT

        override suspend fun requestMeldungsfreigabe(): Boolean = false

        override suspend fun showNotification(title: String, body: String?) = Unit

        override suspend fun print(): Boolean {
            aufrufe += 1
            return gedruckt.await()
        }

        override fun startAnmeldung() = Unit

        override suspend fun saveDownload(name: String, bytes: ByteArray) = Unit
    }
}
