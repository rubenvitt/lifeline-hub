package dev.rubeen.lifeline.android.web

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.ui.graphics.toArgb
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.rubeen.lifeline.android.ui.Farben
import dev.rubeen.lifeline.kern.Bruecke
import dev.rubeen.lifeline.kern.Huellenstil
import dev.rubeen.lifeline.kern.ServerEintrag

/**
 * Was ein WebView der App mitbekommt: das Init-Skript (mit eingesetzter Version), die Rückrufe der
 * Navigation und des Browsers und den Listener der Brücke.
 */
class Webviewbegleitung(
    val initskript: String,
    val client: WebViewClient,
    val chromeClient: WebChromeClient,
    val empfang: WebViewCompat.WebMessageListener,
)

/**
 * Baut den WebView eines Servers (Entwurf D3, D4, D6; wie `Webviewfabrik` in
 * `ios/App/Webview.swift`). Eine Schnittstelle, weil Robolectric weder Profile noch Start-Skripte
 * kennt: die Tests setzen eine Attrappe ein.
 */
interface WebviewFabrik {
    /**
     * Kann der System-WebView getrennte Profile, die Brücke und Start-Skripte? Ohne eins davon
     * lädt die App keine Oberfläche (Entwurf D3) und fällt nie auf ein gemeinsames Profil zurück.
     */
    fun isTauglich(): Boolean

    /** Ein WebView im Profil [eintrag]`.id`, mit Start-Skripten und Brücke nur für seine Origin. */
    fun build(context: Context, eintrag: ServerEintrag, begleitung: Webviewbegleitung): WebView

    /** Vor dem Verwerfen: nichts lädt weiter, die Brücke ist abgebaut, der WebView zerstört. */
    fun close(webView: WebView)

    /** Löscht das Profil [name] (Entwurf D3); wirft, solange ein WebView es benutzt. */
    fun deleteProfil(name: String)
}

/** Die Fabrik des System-WebViews (`androidx.webkit`). */
object SystemWebviewFabrik : WebviewFabrik {
    override fun isTauglich(): Boolean =
        WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    override fun build(context: Context, eintrag: ServerEintrag, begleitung: Webviewbegleitung): WebView {
        check(isTauglich()) { "Der System-WebView kann keine getrennten Profile" }
        val webView = WebView(context)
        // Das Profil zuerst, vor jeder anderen Nutzung des WebViews (androidx.webkit verlangt es).
        ProfileStore.getInstance().getOrCreateProfile(eintrag.id)
        WebViewCompat.setProfile(webView, eintrag.id)
        configureWebview(webView, begleitung)
        // Start-Skripte und Brücke nur für die Origin des Servers; Start-Skripte laufen nur im
        // Hauptframe, der Listener prüft das bei jeder Nachricht selbst (`Brueckenempfang`).
        val regel = setOf(Bruecke.allowedOriginRule(eintrag.adresse))
        WebViewCompat.addDocumentStartJavaScript(webView, begleitung.initskript, regel)
        WebViewCompat.addDocumentStartJavaScript(webView, Huellenstil.skript, regel)
        WebViewCompat.addWebMessageListener(webView, Bruecke.OBJEKT_NAME, regel, begleitung.empfang)
        return webView
    }

    override fun close(webView: WebView) {
        webView.stopLoading()
        WebViewCompat.removeWebMessageListener(webView, Bruecke.OBJEKT_NAME)
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    override fun deleteProfil(name: String) {
        // Ohne Profile gibt es keins zu löschen; ein nie benutztes Profil meldet `false`.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) return
        ProfileStore.getInstance().deleteProfile(name)
    }
}

/**
 * Natives Gefühl (Entwurf D6): JavaScript und DOM-Speicher an, kein Zugriff auf Dateien und
 * Inhaltsanbieter, keine gemischten Inhalte, kein Nachfedern, Hintergrund in Kopf-Schwarz, damit
 * vor dem ersten Bild nichts weiß aufblitzt. Die Systemränder hält der Rahmen des WebViews frei
 * (`Wurzel`); der WebView selbst bekommt keine Insets, damit die Seite sie nicht noch einmal
 * abzieht. Neue Fenster laufen über `onCreateWindow` (`HuellenChromeClient`).
 */
@SuppressLint("SetJavaScriptEnabled")
fun configureWebview(webView: WebView, begleitung: Webviewbegleitung) {
    with(webView.settings) {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        setSupportMultipleWindows(true)
    }
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    webView.setBackgroundColor(Farben.kopfSchwarz.toArgb())
    webView.webViewClient = begleitung.client
    webView.webChromeClient = begleitung.chromeClient
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, _ -> WindowInsetsCompat.CONSUMED }
}
