package dev.rubeen.lifeline.helfer.dienste

import android.util.Log
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
import kotlin.concurrent.thread

/** Antwort des Servers; [status] `0` heißt Netzfehler ohne Antwort (wie [entscheide]). */
data class Rueckmeldung(val status: Int, val text: String) {
    /** Entscheidung nach Status und `reason` (ein 403 mit `Ruhegrund` ruht, statt zu stoppen). */
    val antwort: Antwort get() = entscheide(status, grund)
    val isErfolg: Boolean get() = status in 200..299

    /** Fehler-Body `{error, reason?}`. */
    val fehler: Fehler get() = Wire.fehler(text)

    /** `reason` des Fehler-Bodys; `null` bei Erfolg oder ohne Grund. */
    val grund: String? get() = if (isErfolg) null else fehler.reason

    /** Satz für die Seite, wenn die Anfrage abgewiesen wurde. */
    val meldung: String get() = fehler.let { Anzeige.meldung(status, it.reason, it.error) }

    companion object {
        val NETZFEHLER = Rueckmeldung(0, "")
    }
}

/**
 * Verbindung zum Server der einen Kopplung (ADR-0101: nur an diesen Server und nur mit der Sitzung
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

    // Der Code steht im Body, nie in der Adresse: sonst hielten ihn Zugriffsprotokolle fest.
    fun ziele(code: String): Rueckmeldung = anfrage("POST", "api/devices/helpers/targets", Wire.zielanfrage(code))

    fun einloesen(einloesung: Einloesung): Rueckmeldung = anfrage("POST", "api/devices/helpers/redeem", Wire.einloesung(einloesung))

    fun zustand(): Rueckmeldung = anfrage("GET", "api/devices/me")

    fun zielAendern(ziel: ZielEingabe): Rueckmeldung = anfrage("PUT", "api/devices/me", Wire.zielaenderung(ziel))

    fun sende(position: Position): Rueckmeldung = anfrage("PUT", "api/devices/me/position", Wire.position(position))

    fun pausiere(pausiert: Boolean): Rueckmeldung = anfrage("PUT", "api/devices/me/position", Wire.pause(pausiert))

    fun abmelden(): Rueckmeldung = anfrage("POST", "api/auth/logout").also { cookie = null }

    // Aufträge (ADR-0111, src/routes/helfer.rs).

    fun auftraege(): Rueckmeldung = anfrage("GET", "api/devices/me/tasks")

    fun quittiere(auftragId: Long, empfaengerId: Long): Rueckmeldung =
        anfrage("POST", "api/devices/me/tasks/$auftragId/recipients/$empfaengerId/acknowledge")

    /** Die gerade offene Live-Verbindung; [trenneLive] bricht ein blockiertes Lesen ab. */
    @Volatile
    private var liveVerbindung: HttpURLConnection? = null

    /**
     * Hält `GET /api/incidents/{id}/live` offen und gibt jede Zeile an [zeile] (ohne Zeilenende);
     * [offen] läuft einmal, sobald der Strom steht. Blockiert bis zum Ende des Stroms, einem
     * Netzfehler oder [trenneLive]. Liefert den Status des Aufbaus (`0` ohne Antwort); wie die
     * anderen Anfragen ohne Weiterleitung und nur mit dem Cookie dieser Kopplung.
     */
    fun live(einsatzId: Long, offen: () -> Unit, zeile: (String) -> Unit): Int {
        val verbindung = try {
            URL(server.text.trimEnd('/') + "/api/incidents/$einsatzId/live").openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return 0
        }
        liveVerbindung = verbindung
        return try {
            verbindung.requestMethod = "GET"
            verbindung.connectTimeout = 15_000
            // Der Server sendet regelmäßig ein Lebenszeichen; bleibt es so lange aus, ist die Leitung tot.
            verbindung.readTimeout = LIVE_STILLE_MS
            verbindung.instanceFollowRedirects = false
            verbindung.useCaches = false
            verbindung.setRequestProperty("Accept", "text/event-stream")
            verbindung.setRequestProperty("User-Agent", kennung)
            cookie?.let { verbindung.setRequestProperty("Cookie", "$COOKIE_NAME=$it") }
            val status = verbindung.responseCode
            uebernimmCookie(verbindung.headerFields)
            if (status !in 200..299) return status
            offen()
            verbindung.inputStream.bufferedReader(Charsets.UTF_8).use { leser ->
                while (true) {
                    val z = leser.readLine() ?: break
                    zeile(z)
                }
            }
            status
        } catch (_: IOException) {
            0
        } finally {
            liveVerbindung = null
            verbindung.disconnect()
        }
    }

    /**
     * Beendet die Live-Verbindung von außen (Dienst endet, Empfang aus). Die offene Verbindung wird
     * hier gegriffen, damit ein gleich danach geöffneter Strom bleibt; `disconnect` schließt den
     * Socket (bei TLS mit einem Schreiben) und läuft deshalb auf einem eigenen Faden, nie auf dem
     * Hauptfaden.
     */
    fun trenneLive() {
        val offen = liveVerbindung ?: return
        thread(name = "helfer-live-trennen", isDaemon = true) { offen.disconnect() }
    }

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
            if (status in 300..399) {
                // Nicht gefolgt (ADR-0101); gilt wie ein Serverfehler ([entscheide]: wiederholen).
                // Ohne Ziel und ohne Cookie im Protokoll.
                Log.w(TAG, "Weiterleitung $status auf $methode /$pfad nicht gefolgt")
            }
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

        private const val TAG = "LifelineHelfer"

        /** Längste Stille im Live-Strom, bevor die App neu verbindet (Lebenszeichen alle 15 s, src/live/strom.rs). */
        private const val LIVE_STILLE_MS = 45_000
    }
}
