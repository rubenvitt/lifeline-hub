package dev.rubeen.lifeline.helfer.dienste

import dev.rubeen.lifeline.helferkern.Antwort
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Einloesung
import dev.rubeen.lifeline.helferkern.Fehler
import dev.rubeen.lifeline.helferkern.Position
import dev.rubeen.lifeline.helferkern.Wire
import dev.rubeen.lifeline.helferkern.ZielEingabe
import dev.rubeen.lifeline.helferkern.entscheide
import dev.rubeen.lifeline.kern.ServerAdresse
import java.io.IOException
import java.net.HttpCookie
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Antwort des Servers; [status] `0` heißt Netzfehler ohne Antwort (wie [entscheide]). */
data class Rueckmeldung(val status: Int, val text: String) {
    val antwort: Antwort get() = entscheide(status)
    val isErfolg: Boolean get() = status in 200..299

    /** Fehler-Body `{error, reason?}`. */
    val fehler: Fehler get() = Wire.fehler(text)

    /** Satz für die Seite, wenn die Anfrage abgewiesen wurde. */
    val meldung: String get() = fehler.let { Anzeige.meldung(status, it.reason, it.error) }

    companion object {
        val NETZFEHLER = Rueckmeldung(0, "")
    }
}

/**
 * Verbindung zum Server der einen Kopplung (ADR-0098: nur an diesen Server und nur mit der Sitzung
 * dieser Kopplung). `HttpURLConnection` ohne gemeinsamen Cookie-Speicher und ohne Weiterleitungen:
 * das Cookie `lifeline_sid` nimmt die Verbindung aus `Set-Cookie` selbst an und schickt es selbst
 * mit; abgelegt wird es verschlüsselt in der [Sitzungsablage]. Jede Anfrage blockiert; Aufrufer
 * rufen sie außerhalb des Hauptfadens.
 */
class Serververbindung(val server: ServerAdresse, cookie: String?, private val kennung: String) {
    @Volatile
    var cookie: String? = cookie
        private set

    // Routen (src/app.rs).

    // `URLEncoder.encode(String, Charset)` gibt es erst ab API 33; minSdk ist 29.
    fun ziele(code: String): Rueckmeldung =
        anfrage("GET", "api/devices/helpers/targets?code=" + URLEncoder.encode(code, "UTF-8"))

    fun einloesen(einloesung: Einloesung): Rueckmeldung = anfrage("POST", "api/devices/helpers/redeem", Wire.einloesung(einloesung))

    fun zustand(): Rueckmeldung = anfrage("GET", "api/devices/me")

    fun zielAendern(ziel: ZielEingabe): Rueckmeldung = anfrage("PUT", "api/devices/me", Wire.zielaenderung(ziel))

    fun sende(position: Position): Rueckmeldung = anfrage("PUT", "api/devices/me/position", Wire.position(position))

    fun pausiere(pausiert: Boolean): Rueckmeldung = anfrage("PUT", "api/devices/me/position", Wire.pause(pausiert))

    fun abmelden(): Rueckmeldung = anfrage("POST", "api/auth/logout").also { cookie = null }

    private fun anfrage(methode: String, pfad: String, body: String? = null): Rueckmeldung {
        val verbindung = try {
            URL(server.text.trimEnd('/') + "/" + pfad).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return Rueckmeldung.NETZFEHLER
        }
        return try {
            verbindung.requestMethod = methode
            verbindung.connectTimeout = 15_000
            verbindung.readTimeout = 20_000
            // Nie an einen anderen Server, auch nicht über eine Weiterleitung.
            verbindung.instanceFollowRedirects = false
            verbindung.useCaches = false
            verbindung.setRequestProperty("Accept", "application/json")
            verbindung.setRequestProperty("User-Agent", kennung)
            cookie?.let { verbindung.setRequestProperty("Cookie", "$COOKIE_NAME=$it") }
            if (body != null) {
                val daten = body.toByteArray(Charsets.UTF_8)
                verbindung.doOutput = true
                verbindung.setRequestProperty("Content-Type", "application/json")
                verbindung.setFixedLengthStreamingMode(daten.size)
                verbindung.outputStream.use { it.write(daten) }
            }
            val status = verbindung.responseCode
            val strom = if (status >= 400) verbindung.errorStream else verbindung.inputStream
            val text = strom?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            uebernimmCookie(verbindung.headerFields)
            Rueckmeldung(status, text)
        } catch (_: IOException) {
            Rueckmeldung.NETZFEHLER
        } finally {
            verbindung.disconnect()
        }
    }

    /** Nimmt ein neues `lifeline_sid` aus `Set-Cookie` an; ein leeres oder abgelaufenes löscht es. */
    private fun uebernimmCookie(koepfe: Map<String?, List<String>>) {
        val zeilen = koepfe.entries.filter { it.key.equals("Set-Cookie", ignoreCase = true) }.flatMap { it.value }
        for (zeile in zeilen) {
            val neu = try {
                HttpCookie.parse(zeile).firstOrNull { it.name == COOKIE_NAME }
            } catch (_: IllegalArgumentException) {
                null
            } ?: continue
            cookie = if (neu.value.isNullOrEmpty() || neu.hasExpired()) null else neu.value
        }
    }

    companion object {
        /** `SESSION_COOKIE` in src/auth/session.rs. */
        const val COOKIE_NAME = "lifeline_sid"
    }
}
