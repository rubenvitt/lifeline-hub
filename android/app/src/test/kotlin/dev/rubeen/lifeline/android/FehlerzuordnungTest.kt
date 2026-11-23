package dev.rubeen.lifeline.android

import android.webkit.WebViewClient
import dev.rubeen.lifeline.android.web.Fehlerzuordnung
import dev.rubeen.lifeline.kern.Netzfehler
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/** Ausnahmen und Fehlercodes des WebViews auf die Netzfehler des Kerns (Entwurf D2a). */
class FehlerzuordnungTest {
    @Test
    fun `ein gescheiterter TLS-Handschlag ist ein Zertifikatsfehler`() {
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(SSLHandshakeException("unbekannte CA")))
    }

    @Test
    fun `eine nicht prüfbare Zertifikatskette ist ein Zertifikatsfehler, auch als Ursache`() {
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(IOException(CertPathValidatorException("Kette"))))
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(IOException(CertificateException("abgelaufen"))))
    }

    @Test
    fun `ein Zertifikat für einen anderen Host ist ein Zertifikatsfehler`() {
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(SSLPeerUnverifiedException("Hostname nicht geprüft")))
    }

    @Test
    fun `ohne Verbindung, Namensauflösung oder Antwort ist es ein Verbindungsfehler`() {
        for (fehler in listOf(ConnectException(), UnknownHostException(), SocketTimeoutException(), IOException("weg"))) {
            assertEquals(fehler.toString(), Netzfehler.VERBINDUNG, Fehlerzuordnung.netzfehler(fehler))
        }
    }

    @Test
    fun `der WebView meldet einen gescheiterten TLS-Handschlag als Zertifikatsfehler`() {
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE))
    }

    @Test
    fun `jeder andere Code des WebViews ist ein Verbindungsfehler`() {
        val codes = listOf(
            WebViewClient.ERROR_HOST_LOOKUP,
            WebViewClient.ERROR_CONNECT,
            WebViewClient.ERROR_TIMEOUT,
            WebViewClient.ERROR_UNKNOWN,
        )
        for (code in codes) {
            assertEquals("Code $code", Netzfehler.VERBINDUNG, Fehlerzuordnung.netzfehler(code))
        }
    }

    @Test
    fun `eine abgebrochene Navigation ist kein Fehler der Seite`() {
        assertEquals(Netzfehler.ABGEBROCHEN, Fehlerzuordnung.netzfehler(WebViewClient.ERROR_UNKNOWN, "net::ERR_ABORTED"))
        assertEquals(Netzfehler.VERBINDUNG, Fehlerzuordnung.netzfehler(WebViewClient.ERROR_UNKNOWN, "net::ERR_ADDRESS_UNREACHABLE"))
        assertEquals(Netzfehler.ZERTIFIKAT, Fehlerzuordnung.netzfehler(WebViewClient.ERROR_FAILED_SSL_HANDSHAKE, null))
    }
}
