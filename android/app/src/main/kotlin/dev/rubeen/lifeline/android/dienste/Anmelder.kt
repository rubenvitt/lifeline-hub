package dev.rubeen.lifeline.android.dienste

import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import dev.rubeen.lifeline.android.web.uri
import dev.rubeen.lifeline.kern.Anmeldelauf
import dev.rubeen.lifeline.kern.Anmeldung
import dev.rubeen.lifeline.kern.Deeplink
import dev.rubeen.lifeline.kern.PKCE
import dev.rubeen.lifeline.kern.ServerAdresse
import java.lang.ref.WeakReference
import java.net.URI

/** Wie der Browser die Anmeldung zurückgibt. */
enum class Anmeldeweg {
    /** Auth Tab: der Rücksprung kommt als Ergebnis der Activity ([Anmelder.authTabErgebnis]). */
    AUTH_TAB,

    /** Custom Tab: der Rücksprung kommt als Intent `lifeline://anmeldung` ([Anmelder.ruecksprung]). */
    CUSTOM_TAB,
}

/**
 * „Im Browser anmelden“ (Entwurf D7; wie `ios/App/Anmelder.swift`). Öffnet die Bestätigungsseite
 * des aktiven Servers — nie eine Adresse der Seite — im Auth Tab, wo der Browser ihn kann, sonst
 * im Custom Tab. Der `verifier` bleibt in der App und verlässt sie nur im Einlöse-Skript gegen
 * dieselbe Origin. Ein Rücksprung zählt nur, solange die Sitzung offen ist, die ihn erwartet;
 * was am Ende geschieht, entscheidet `Anmeldung.folge` im Kern.
 *
 * @param oeffne öffnet die Bestätigungsseite ([Anmeldebrowser.open]); wirft, wenn kein Browser sie öffnet
 */
class Anmelder(
    private val webView: () -> WebView?,
    private val aktiverServer: () -> ServerAdresse?,
    private val oeffne: (URI) -> Anmeldeweg,
) {
    private class Laufend(
        val generation: Long,
        val verifier: String,
        val server: ServerAdresse,
        val webView: WeakReference<WebView>,
        val weg: Anmeldeweg,
    ) {
        /** Die App lag im Hintergrund, während der Custom Tab offen war. */
        var verlassen = false
    }

    private val lauf = Anmeldelauf<Laufend>()

    /** Die zuletzt begonnene Sitzung; ob sie noch läuft, weiß [lauf]. */
    private var zuletzt: Laufend? = null
    private val handler = Handler(Looper.getMainLooper())
    private var abbruch: Runnable? = null

    /** Läuft gerade „Im Browser anmelden“? Dann gehört eine fremde Seite zur Anmeldung. */
    val isLaufend: Boolean get() = lauf.isLaufend

    /** Startet eine Sitzung; eine laufende wird vorher abgebrochen. Wirft, wenn keine beginnt. */
    fun start() {
        val server = aktiverServer() ?: throw IllegalStateException(KEIN_SERVER)
        val webView = webView() ?: throw IllegalStateException(KEIN_SERVER)
        abbrechen()
        val verifier = PKCE.neuerVerifier()
        val ziel = Anmeldung.bestaetigungUrl(server, PKCE.challenge(verifier))
        val generation = lauf.naechste()
        val weg = try {
            oeffne(ziel)
        } catch (e: ActivityNotFoundException) {
            throw IllegalStateException("Die Anmeldung im Browser ließ sich nicht starten.", e)
        }
        val laufend = Laufend(generation, verifier, server, WeakReference(webView), weg)
        zuletzt = laufend
        lauf.merke(generation, laufend)
    }

    /**
     * Bricht eine laufende Sitzung ab; ihr Rücksprung findet danach keine Sitzung mehr. Den Tab
     * im Browser kann die App nicht schließen.
     */
    fun abbrechen() {
        lauf.nimm()
        zuletzt = null
        abbruch?.let(handler::removeCallbacks)
        abbruch = null
    }

    /**
     * Ein Intent `lifeline://anmeldung?…` (Manifest). Zählt nur, solange eine Sitzung im Custom
     * Tab offen ist; der Auth Tab gibt den Rücksprung selbst zurück. Sonst bleibt er wirkungslos.
     */
    fun ruecksprung(link: String) {
        val laufend = zuletzt ?: return
        if (!lauf.isLaufend || laufend.weg != Anmeldeweg.CUSTOM_TAB) return
        beende(laufend.generation, Anmeldung.Ende.Ruecksprung(link))
    }

    /** Ergebnis des Auth Tabs (`AuthTabIntent.AuthResult`). */
    fun authTabErgebnis(resultCode: Int, resultUri: Uri?) {
        val laufend = zuletzt ?: return
        if (laufend.weg != Anmeldeweg.AUTH_TAB) return
        val ende = when (resultCode) {
            AuthTabIntent.RESULT_OK -> resultUri?.let { Anmeldung.Ende.Ruecksprung(it.toString()) } ?: Anmeldung.Ende.Fehler
            AuthTabIntent.RESULT_CANCELED -> Anmeldung.Ende.Abgebrochen
            else -> Anmeldung.Ende.Fehler
        }
        beende(laufend.generation, ende)
    }

    /** Die App geht in den Hintergrund (`ON_STOP`), etwa weil der Custom Tab sie überdeckt. */
    fun verlassen() {
        val laufend = zuletzt ?: return
        if (lauf.isLaufend && laufend.weg == Anmeldeweg.CUSTOM_TAB) laufend.verlassen = true
    }

    /**
     * Die App ist wieder vorn (`ON_RESUME`). Hat die Person den Custom Tab ohne Rücksprung
     * geschlossen, kommt kein Intent mehr: nach [RUECKKEHR_FRIST_MS] gilt die Sitzung als
     * abgebrochen. Ein Rücksprung kommt vor `onResume` (`onNewIntent`); die Frist fängt eine
     * späte Zustellung ab.
     */
    fun rueckkehr() {
        val laufend = zuletzt ?: return
        if (!lauf.isLaufend || laufend.weg != Anmeldeweg.CUSTOM_TAB || !laufend.verlassen) return
        abbruch?.let(handler::removeCallbacks)
        val generation = laufend.generation
        abbruch = Runnable { beende(generation, Anmeldung.Ende.Abgebrochen) }.also {
            handler.postDelayed(it, RUECKKEHR_FRIST_MS)
        }
    }

    /**
     * Nur die eigene Sitzung, nur im WebView, in dem sie begann, und nur, solange er noch der
     * WebView der App ist (nach einem Serverwechsel ist er es nicht mehr).
     */
    private fun beende(generation: Long, ende: Anmeldung.Ende) {
        val laufend = lauf.beende(generation) ?: return
        abbruch?.let(handler::removeCallbacks)
        abbruch = null
        val webView = laufend.webView.get()?.takeIf { it === webView() }
        val skript = when (val folge = Anmeldung.folge(ende, webView?.url?.let(::uri), laufend.server)) {
            is Anmeldung.Folge.Einloesen -> Anmeldung.einloeseSkript(laufend.server, folge.code, laufend.verifier)
            is Anmeldung.Folge.Melden -> Anmeldung.meldungSkript(folge.ergebnis)
            Anmeldung.Folge.Nichts -> {
                Log.w(TAG, "Anmeldung nicht eingelöst: der WebView zeigt keine Anmeldeseite des Servers")
                return
            }
        }
        webView?.evaluateJavascript(skript, null)
    }

    companion object {
        private const val TAG = "Lifeline"
        private const val KEIN_SERVER = "Es ist kein Server verbunden."

        /** Wie lange die App nach der Rückkehr aus dem Custom Tab auf den Rücksprung wartet. */
        const val RUECKKEHR_FRIST_MS = 1_000L
    }
}

/**
 * Der Browser der Anmeldung (`androidx.browser`): Auth Tab, wo der Browser ihn kann, mit dem
 * Rücksprung-Schema `lifeline`; sonst ein Custom Tab, dessen Rücksprung als Intent kommt. Beide
 * teilen die Sitzung des Browsers (Passkeys, Anmeldung beim Identitätsanbieter), wie die
 * `ASWebAuthenticationSession` auf iOS. Muss in `onCreate` entstehen (Activity-Ergebnis).
 */
class Anmeldebrowser(private val activity: ComponentActivity, ergebnis: (Int, Uri?) -> Unit) {
    private val authTab = AuthTabIntent.registerActivityResultLauncher(activity) { ergebnis(it.resultCode, it.resultUri) }

    fun open(ziel: URI): Anmeldeweg {
        val adresse = Uri.parse(ziel.toString())
        val paket = CustomTabsClient.getPackageName(activity, null)
        if (paket != null && CustomTabsClient.isAuthTabSupported(activity, paket)) {
            val intent = AuthTabIntent.Builder().build()
            intent.intent.setPackage(paket)
            intent.launch(authTab, adresse, Deeplink.SCHEMA)
            return Anmeldeweg.AUTH_TAB
        }
        val tab = CustomTabsIntent.Builder().build()
        paket?.let(tab.intent::setPackage)
        tab.launchUrl(activity, adresse)
        return Anmeldeweg.CUSTOM_TAB
    }
}
