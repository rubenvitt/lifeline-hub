package dev.rubeen.lifeline.android.web

import android.webkit.WebViewClient
import dev.rubeen.lifeline.kern.Netzfehler
import java.io.IOException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * Ordnet Ausnahmen des Vertragsabrufs und Fehlercodes des WebViews den Netzfehlern des Kerns zu
 * (Entwurf D2a): was das Zertifikat betrifft, führt auf „Zertifikat nicht vertrauenswürdig“,
 * alles andere auf „nicht erreichbar“.
 */
object Fehlerzuordnung {
    fun netzfehler(e: IOException): Netzfehler =
        if (ursachen(e).any(::isZertifikatsfehler)) Netzfehler.ZERTIFIKAT else Netzfehler.VERBINDUNG

    fun netzfehler(webViewErrorCode: Int): Netzfehler =
        if (webViewErrorCode == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE) Netzfehler.ZERTIFIKAT else Netzfehler.VERBINDUNG

    /**
     * Wie [netzfehler] mit dem Code, dazu die Beschreibung des WebViews: eine abgebrochene
     * Navigation (`net::ERR_ABORTED`, etwa ein schneller zweiter Tipp) meldet Android als
     * `ERROR_UNKNOWN`; sie ist kein Fehler der Seite (wie `cancelled` auf iOS).
     */
    fun netzfehler(webViewErrorCode: Int, beschreibung: CharSequence?): Netzfehler =
        if (beschreibung?.contains(ABGEBROCHEN) == true) Netzfehler.ABGEBROCHEN else netzfehler(webViewErrorCode)

    private fun isZertifikatsfehler(fehler: Throwable): Boolean =
        fehler is SSLHandshakeException ||
            fehler is SSLPeerUnverifiedException ||
            fehler is CertPathValidatorException ||
            fehler is CertificateException

    /** Die Ausnahme und ihre Ursachen, ohne in einer Schleife hängen zu bleiben. */
    private fun ursachen(e: Throwable): Sequence<Throwable> =
        generateSequence(e) { it.cause?.takeIf { ursache -> ursache !== it } }.take(MAX_TIEFE)

    private const val MAX_TIEFE = 10
    private const val ABGEBROCHEN = "net::ERR_ABORTED"
}
