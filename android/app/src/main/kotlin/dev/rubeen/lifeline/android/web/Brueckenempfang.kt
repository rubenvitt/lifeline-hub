package dev.rubeen.lifeline.android.web

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import dev.rubeen.lifeline.kern.Bruecke
import dev.rubeen.lifeline.kern.Brueckenausfuehrung
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.SeitenOrigin
import dev.rubeen.lifeline.kern.ServerAdresse
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Der Listener `lifeline` (Entwurf D4; wie `Brueckenempfang` in `ios/App/Webview.swift`). Ob eine
 * Nachricht wirkt, entscheidet `Bruecke.accepts` mit dem in diesem Moment aktiven Server. Die
 * Antwort geht nur zurück, wenn der WebView, der gefragt hat, noch der aktuelle ist und noch eine
 * Seite dieses Servers zeigt; nach einem Wechsel verfällt sie (Review Focus 1).
 *
 * @param isAktuell ist dieser WebView noch der, den die App zeigt?
 * @param scope Hauptfaden der App; die Dienste laufen dort, die Antwort auch
 * @param rechnen liest lange Nachrichten (`download_blob`) außerhalb des Hauptfadens
 */
class Brueckenempfang(
    private val dienste: Huellendienste,
    private val aktiverServer: () -> ServerAdresse?,
    private val isAktuell: (WebView) -> Boolean,
    private val scope: CoroutineScope,
    private val rechnen: CoroutineContext = Dispatchers.Default,
) : WebViewCompat.WebMessageListener {
    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isAktuell(view)) return
        if (!Bruecke.accepts(isMainFrame, SeitenOrigin.parse(sourceOrigin.toString()), aktiverServer())) return
        val text = (if (message.type == WebMessageCompat.TYPE_STRING) message.data else null) ?: return
        scope.launch {
            // Kurze Befehle sofort (Reihenfolge, Haptik); ein Download mit bis zu 70 Mio. Zeichen
            // nicht im Hauptfaden (Review W6). Die Länge prüft `Bruecke.parse` vor dem Parsen.
            val befehl = (if (text.length > SOFORT_BIS) withContext(rechnen) { Bruecke.parse(text) } else Bruecke.parse(text))
                ?: return@launch
            val antwort = Brueckenausfuehrung.run(befehl, dienste) ?: return@launch
            // Inzwischen kann die App den Server gewechselt oder die Seite verlassen haben.
            if (!isAktuell(view)) return@launch
            val seite = view.url?.let(SeitenOrigin::parse)
            if (!Bruecke.accepts(true, seite, aktiverServer())) return@launch
            replyProxy.postMessage(Bruecke.replyJson(antwort))
        }
    }

    private companion object {
        /** Bis zu dieser Länge liest der Hauptfaden selbst. */
        const val SOFORT_BIS = 64 * 1024
    }
}
