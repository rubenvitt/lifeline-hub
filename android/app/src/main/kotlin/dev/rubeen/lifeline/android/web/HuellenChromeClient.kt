package dev.rubeen.lifeline.android.web

import android.graphics.Bitmap
import android.os.Message
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.net.URI

/**
 * Rückrufe des Browsers im WebView. Neue Fenster (`target=_blank`, `window.open`) gehen an
 * `Linkweiche` mit `neuesFenster` (Entwurf D8); ein zweiter WebView für die Seite entsteht nie.
 *
 * @param neuesFenster entscheidet über das Ziel (`HuellenClient.neuesFenster`)
 */
class HuellenChromeClient(private val neuesFenster: (WebView, URI) -> Unit) : WebChromeClient() {
    /**
     * Android nennt hier das Ziel nicht. Ein kurzlebiger WebView im selben Profil nimmt das
     * Fenster an, fängt seine erste Adresse ab und wird sofort zerstört; die Adresse geht an die
     * Linkweiche wie auf iOS.
     */
    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val fenster = WebView(view.context)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            WebViewCompat.setProfile(fenster, WebViewCompat.getProfile(view).name)
        }
        var erledigt = false
        fun nimm(adresse: String?) {
            if (erledigt) return
            erledigt = true
            fenster.stopLoading()
            // Nicht im eigenen Rückruf zerstören.
            fenster.post { fenster.destroy() }
            adresse?.let(::uri)?.let { neuesFenster(view, it) }
        }
        fenster.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(fensterView: WebView, request: WebResourceRequest): Boolean {
                nimm(request.url.toString())
                return true
            }

            override fun onPageStarted(fensterView: WebView, url: String?, favicon: Bitmap?) {
                nimm(url)
            }
        }
        transport.webView = fenster
        resultMsg.sendToTarget()
        return true
    }
}
