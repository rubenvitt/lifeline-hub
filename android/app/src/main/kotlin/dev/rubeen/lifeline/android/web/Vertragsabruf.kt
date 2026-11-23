package dev.rubeen.lifeline.android.web

import dev.rubeen.lifeline.kern.Netzfehler
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.ShellAbruf
import dev.rubeen.lifeline.kern.Vertragspruefung
import dev.rubeen.lifeline.kern.healthVersion
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fragt `GET /api/shell` (bei 404 dazu `GET /api/health`) wie `ios/App/Vertragsabruf.swift`
 * (Entwurf D4); bewertet wird mit `Vertragspruefung` im Kern. Zertifikate prüft das System nach
 * der `networkSecurityConfig`, ohne Ausnahmen (Entwurf D2a). Weiterleitungen folgt der Abruf nur
 * auf derselben Origin (`Vertragspruefung.followsRedirect`); eine fremde (Captive Portal,
 * Auth-Proxy) kommt als 3xx an und gilt im Kern wie ohne Verbindung.
 *
 * @param basis Adresse, unter der der Abruf den Server fragt; die App fragt immer die
 *   `https`-Adresse des Eintrags, nur die Tests setzen ihren `http`-Testserver ein
 */
class Vertragsabruf internal constructor(private val basis: (ServerAdresse) -> URI) {
    constructor() : this({ URI(it.text) })

    /** Die Antwort von `/api/shell` und, nur bei 404, die Version aus `/api/health`. */
    suspend fun abrufen(server: ServerAdresse): Pair<ShellAbruf, String?> = withContext(Dispatchers.IO) {
        val wurzel = basis(server)
        val abruf = fetch(wurzel.resolve("/api/shell"))
        if (abruf !is ShellAbruf.Antwort || abruf.status != 404) return@withContext abruf to null
        val health = fetch(wurzel.resolve("/api/health"))
        abruf to (health as? ShellAbruf.Antwort)?.takeIf { it.status == 200 }?.let { healthVersion(it.body) }
    }

    private fun fetch(url: URI): ShellAbruf {
        var ziel = url
        var weiterleitungen = 0
        while (true) {
            val verbindung = try {
                ziel.toURL().openConnection() as HttpURLConnection
            } catch (e: IOException) {
                return ShellAbruf.Fehler(Fehlerzuordnung.netzfehler(e))
            } catch (_: IllegalArgumentException) {
                return ShellAbruf.Fehler(Netzfehler.VERBINDUNG)
            }
            try {
                verbindung.instanceFollowRedirects = false
                verbindung.connectTimeout = ZEITLIMIT_MS
                verbindung.readTimeout = ZEITLIMIT_MS
                verbindung.useCaches = false
                verbindung.setRequestProperty("Accept", "application/json")
                val status = verbindung.responseCode
                val contentType = verbindung.getHeaderField("Content-Type")
                if (status !in 300..399) {
                    val strom = if (status >= 400) verbindung.errorStream else verbindung.inputStream
                    return ShellAbruf.Antwort(status, strom?.use(::lies) ?: "", contentType)
                }
                val nach = verbindung.getHeaderField("Location")?.let { ort ->
                    try {
                        ziel.resolve(ort)
                    } catch (_: IllegalArgumentException) {
                        null
                    }
                }
                // Wie iOS: maßgeblich ist die Origin der ersten Anfrage. Zu viele Weiterleitungen
                // auf derselben Origin kommen wie eine fremde als 3xx an.
                if (nach == null || weiterleitungen >= MAX_WEITERLEITUNGEN || !Vertragspruefung.followsRedirect(url, nach)) {
                    return ShellAbruf.Antwort(status, "", contentType)
                }
                ziel = nach
                weiterleitungen += 1
            } catch (e: IOException) {
                return ShellAbruf.Fehler(Fehlerzuordnung.netzfehler(e))
            } finally {
                verbindung.disconnect()
            }
        }
    }

    /** Liest höchstens [MAX_BYTES]; mehr braucht weder `/api/shell` noch `/api/health`. */
    private fun lies(strom: InputStream): String {
        val puffer = ByteArrayOutputStream()
        val block = ByteArray(8 * 1024)
        while (puffer.size() < MAX_BYTES) {
            val gelesen = strom.read(block, 0, minOf(block.size, MAX_BYTES - puffer.size()))
            if (gelesen < 0) break
            puffer.write(block, 0, gelesen)
        }
        return puffer.toString(Charsets.UTF_8.name())
    }

    private companion object {
        const val ZEITLIMIT_MS = 10_000
        const val MAX_WEITERLEITUNGEN = 5
        const val MAX_BYTES = 1 shl 20
    }
}
