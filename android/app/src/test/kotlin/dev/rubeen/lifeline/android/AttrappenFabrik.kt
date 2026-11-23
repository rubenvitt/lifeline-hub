package dev.rubeen.lifeline.android

import android.content.Context
import android.view.ViewGroup
import android.webkit.WebView
import dev.rubeen.lifeline.android.web.WebviewFabrik
import dev.rubeen.lifeline.android.web.Webviewbegleitung
import dev.rubeen.lifeline.android.web.configureWebview
import dev.rubeen.lifeline.kern.ServerEintrag

/**
 * WebView-Fabrik der Tests: Robolectric kennt weder Profile noch Start-Skripte noch den Listener
 * der Brücke. Sie baut einen einfachen WebView mit den Rückrufen der App und merkt sich, für
 * welches Profil sie ihn gebaut hat.
 */
class AttrappenFabrik(private val tauglich: Boolean = true) : WebviewFabrik {
    /** Profilnamen in der Reihenfolge der gebauten WebViews. */
    val profile = mutableListOf<String>()

    /** Gelöschte Profile. */
    val geloescht = mutableListOf<String>()

    override fun isTauglich(): Boolean = tauglich

    override fun build(context: Context, eintrag: ServerEintrag, begleitung: Webviewbegleitung): WebView {
        check(tauglich) { "Ohne tauglichen WebView baut die App keinen" }
        profile += eintrag.id
        return WebView(context).also { configureWebview(it, begleitung) }
    }

    override fun close(webView: WebView) {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    override fun deleteProfil(name: String) {
        geloescht += name
    }

    override fun cookie(webView: WebView, url: String): String? = null
}
