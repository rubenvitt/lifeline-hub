package dev.rubeen.lifeline.android.web

import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Linkweiche
import dev.rubeen.lifeline.kern.Netzfehler
import dev.rubeen.lifeline.kern.ServerAdresse
import java.net.URI

/**
 * Begleitet die Navigation des WebViews (Entwurf D2a, D6, D8; wie `Navigationsbegleiter` in
 * `ios/App/Webview.swift`): was mit einem Link geschieht, entscheidet `Linkweiche` im Kern;
 * Ladefehler, Commits und das Ende des Render-Prozesses gehen als Ereignis an das Modell.
 *
 * @param melde reicht ein Ereignis an `Ablauf`; das Modell verwirft Meldungen eines schon
 *   verworfenen WebViews
 * @param oeffne öffnet eine Adresse im System (Browser, Telefon, Mail)
 * @param herunterladen lädt eine Dateiroute des Servers mit der Sitzung des Profils
 */
class HuellenClient(
    private val aktiverServer: () -> ServerAdresse?,
    private val melde: (WebView, Ablauf.Event) -> Unit,
    private val oeffne: (URI) -> Unit,
    private val herunterladen: (WebView, URI) -> Unit,
) : WebViewClient() {
    private val server: URI?
        get() = aktiverServer()?.let { uri(it.text) }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Was sich nicht lesen lässt, lädt der WebView selbst; die Brücke gilt dort ohnehin nicht.
        val ziel = uri(request.url.toString()) ?: return false
        val entscheidung = Linkweiche.navigation(
            server = server,
            ziel = ziel,
            isMainFrame = request.isForMainFrame,
            neuesFenster = false,
            seite = view.url?.let(::uri),
        )
        return when (entscheidung) {
            Linkweiche.Entscheidung.Erlauben -> false
            Linkweiche.Entscheidung.Abbrechen -> true
            Linkweiche.Entscheidung.Download -> {
                herunterladen(view, ziel)
                true
            }
            is Linkweiche.Entscheidung.ImWebviewLaden -> {
                view.loadUrl(entscheidung.url.toString())
                true
            }
            is Linkweiche.Entscheidung.System -> {
                oeffne(entscheidung.url)
                true
            }
        }
    }

    /**
     * `target=_blank` und `window.open` (aus `HuellenChromeClient.onCreateWindow`): ein zweiter
     * WebView entsteht nie. Die eigene Origin lädt im selben WebView, eine Dateiroute wird
     * heruntergeladen, Fremdes öffnet das System.
     */
    fun neuesFenster(view: WebView, ziel: URI) {
        val entscheidung = Linkweiche.navigation(
            server = server,
            ziel = ziel,
            isMainFrame = true,
            neuesFenster = true,
            seite = view.url?.let(::uri),
        )
        when (entscheidung) {
            is Linkweiche.Entscheidung.ImWebviewLaden -> view.loadUrl(entscheidung.url.toString())
            Linkweiche.Entscheidung.Download -> herunterladen(view, ziel)
            is Linkweiche.Entscheidung.System -> oeffne(entscheidung.url)
            Linkweiche.Entscheidung.Erlauben, Linkweiche.Entscheidung.Abbrechen -> Unit
        }
    }

    /** Vertrauen nur nach dem System (Entwurf D2a): ein Zertifikatsfehler bricht immer ab. */
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        melde(view, Ablauf.Event.NavigationFehlgeschlagen(Netzfehler.ZERTIFIKAT, error.url?.let(::uri)))
    }

    /** Nur die Hauptnavigation; Fehler einzelner Bilder oder Skripte zeigt die Seite selbst. */
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        melde(
            view,
            Ablauf.Event.NavigationFehlgeschlagen(
                Fehlerzuordnung.netzfehler(error.errorCode, error.description),
                uri(request.url.toString()),
            ),
        )
    }

    /** Zurück auf einer Seite des Servers nimmt `Ablauf` den Hinweis „Zur Oberfläche“ weg. */
    override fun onPageCommitVisible(view: WebView, url: String?) {
        melde(view, Ablauf.Event.SeiteGeladen(url?.let(::uri)))
    }

    /**
     * Der Render-Prozess endete (Absturz oder vom System beendet). Der WebView ist danach nicht
     * mehr zu gebrauchen; das Modell baut ihn neu (Entwurf D6). `true`: die App lebt weiter.
     */
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        melde(view, Ablauf.Event.WebProzessBeendet)
        return true
    }
}

/** Eine Adresse des WebViews als `URI`; `null`, wenn `java.net.URI` sie nicht lesen kann. */
internal fun uri(text: String): URI? =
    try {
        URI(text)
    } catch (_: Exception) {
        null
    }
