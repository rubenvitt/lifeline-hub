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
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
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

    /** Führt sofort aus und merkt sich, dass es gebraucht wurde. */
    private val rechnen = object : CoroutineDispatcher() {
        var benutzt = 0

        override fun dispatch(context: CoroutineContext, block: Runnable) {
            benutzt += 1
            block.run()
        }
    }
    private val empfang = Brueckenempfang(
        dienste = dienste,
        aktiverServer = { aktiverServer },
        isAktuell = { it === aktuell },
        scope = CoroutineScope(Dispatchers.Unconfined),
        rechnen = rechnen,
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

    /** Review K7: derselbe WebView und derselbe Server, aber die Seite steht inzwischen beim IdP. */
    @Test
    fun `steht derselbe WebView inzwischen auf einer fremden Seite, verfällt die Antwort`() {
        drucke()
        alt.loadUrl("https://idp.example/realms/drk/login")
        dienste.gedruckt.complete(true)

        assertTrue(antworten.isEmpty())
    }

    /** Review K7: derselbe Server, aber die App hat den WebView neu gebaut (Render-Prozess beendet). */
    @Test
    fun `ist der WebView nicht mehr der aktuelle, verfällt die Antwort`() {
        drucke()
        aktuell = WebView(context).apply { loadUrl("https://elw.local:8443/etb") }
        dienste.gedruckt.complete(true)

        assertTrue(antworten.isEmpty())
    }

    /** Review W6: eine lange Nachricht liest die App außerhalb des Hauptfadens, eine kurze sofort. */
    @Test
    fun `lange Nachrichten werden außerhalb des Hauptfadens gelesen`() {
        drucke()
        assertEquals(0, rechnen.benutzt)

        val lang = "A".repeat(100_000)
        empfang.onPostMessage(alt, WebMessageCompat("""{"cmd":"gibt_es_nicht","id":3,"x":"$lang"}"""), Uri.parse("https://elw.local:8443"), true, proxy)

        assertEquals(1, rechnen.benutzt)
        assertEquals(listOf("""{"id":3,"fehler":"Unbekannter Befehl der Hülle: gibt_es_nicht","wert":null}"""), antworten)
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
