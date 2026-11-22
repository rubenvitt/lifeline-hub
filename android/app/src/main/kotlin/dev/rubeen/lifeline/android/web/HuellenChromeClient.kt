package dev.rubeen.lifeline.android.web

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Bitmap
import android.os.Message
import android.text.InputType
import android.util.TypedValue
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.rubeen.lifeline.kern.SeitenOrigin
import dev.rubeen.lifeline.kern.Seitendialog
import java.net.URI

/**
 * Rückrufe des Browsers im WebView. Neue Fenster (`target=_blank`, `window.open`) gehen an
 * `Linkweiche` mit `neuesFenster` (Entwurf D8); ein zweiter WebView für die Seite entsteht nie.
 * `alert`, `confirm` und `prompt` zeigt die App als nativen Dialog (`Seitendialog`).
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

    override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        frage(view, url, Seitendialog.Art.Hinweis, message) { result.confirm() }
        return true
    }

    override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
        frage(view, url, Seitendialog.Art.Rueckfrage, message) { ergebnis ->
            if (Seitendialog.confirmWert(ergebnis)) result.confirm() else result.cancel()
        }
        return true
    }

    override fun onJsPrompt(view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult): Boolean {
        frage(view, url, Seitendialog.Art.Eingabe(defaultValue), message) { ergebnis ->
            Seitendialog.promptWert(ergebnis)?.let(result::confirm) ?: result.cancel()
        }
        return true
    }

    /** [url] ist die Adresse des fragenden Frames; ohne lesbare Origin heißt der Titel „Diese Seite“. */
    private fun frage(view: WebView, url: String?, art: Seitendialog.Art, nachricht: String?, fertig: (Seitendialog.Ergebnis?) -> Unit) {
        val origin = url?.let(SeitenOrigin::parse) ?: SeitenOrigin("", "", -1)
        zeigeSeitendialog(view.context, Seitendialog(art, nachricht ?: "", origin), fertig)
    }
}

/** Kennung des Textfeldes im Dialog `prompt` (Tests). */
internal const val SEITENDIALOG_FELD = "seitendialog-feld"

/**
 * Zeigt [dialog] als `AlertDialog` und meldet das Ergebnis genau einmal: „OK“ (bei der Eingabe mit
 * dem Text des Feldes), „Abbrechen“ oder Wegtippen. Ohne laufende Activity zeigt die App nichts
 * und meldet `null`; dann lehnt die Seite ab.
 */
internal fun zeigeSeitendialog(context: Context, dialog: Seitendialog, fertig: (Seitendialog.Ergebnis?) -> Unit) {
    val activity = context as? Activity
    if (activity == null || activity.isFinishing || activity.isDestroyed) {
        fertig(null)
        return
    }
    var gemeldet = false
    fun melde(ergebnis: Seitendialog.Ergebnis) {
        if (gemeldet) return
        gemeldet = true
        fertig(ergebnis)
    }
    val feld = if (dialog.hasFeld) {
        EditText(activity).apply {
            setText(dialog.feldVorgabe)
            setSelection(text.length)
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT
            tag = SEITENDIALOG_FELD
        }
    } else {
        null
    }
    val builder = AlertDialog.Builder(activity)
        .setTitle(dialog.titel)
        .setMessage(dialog.nachricht)
        .setPositiveButton(Seitendialog.OK_TITEL) { _, _ -> melde(Seitendialog.Ergebnis.Ok(feld?.text?.toString())) }
        .setOnDismissListener { melde(Seitendialog.Ergebnis.Abgebrochen) }
    dialog.abbrechenTitel?.let { builder.setNegativeButton(it) { _, _ -> melde(Seitendialog.Ergebnis.Abgebrochen) } }
    feld?.let {
        val rand = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20f, activity.resources.displayMetrics).toInt()
        builder.setView(FrameLayout(activity).apply { setPadding(rand, 0, rand, 0); addView(it) })
    }
    builder.show()
}
