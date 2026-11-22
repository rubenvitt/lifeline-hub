package dev.rubeen.lifeline.kern

import java.net.URI
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json
import kotlin.math.floor

/**
 * Origin einer Seite, wie sie der WebView meldet (`WebMessageListener`: `Uri` der Quelle). Der
 * Port `-1` heißt Standardport des Schemas.
 */
data class SeitenOrigin(val schema: String, val host: String, val port: Int) {
    companion object {
        /** Liest `https://host[:port]`; `null` für „null“ (opake Origin) und alles Unlesbare. */
        fun parse(origin: String): SeitenOrigin? {
            val uri = try {
                URI(origin.trim { it.isWhitespace() })
            } catch (_: Exception) {
                return null
            }
            val schema = uri.scheme ?: return null
            val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
            return SeitenOrigin(schema, host, uri.port)
        }
    }
}

/**
 * Die Brücke `lifeline` zwischen Seite und Hülle (Entwurf D4; Wire-Format im Kopf des
 * Init-Skripts): Nachrichten kommen als JSON-Text, Antworten gehen als JSON-Text zurück.
 */
object Bruecke {
    /** Name des Objekts, das `addWebMessageListener` der Seite bereitstellt (`window.lifeline`). */
    const val OBJEKT_NAME = "lifeline"

    /**
     * Nimmt die Hülle eine Nachricht an? Nur aus dem Hauptframe und nur von der Origin des
     * aktiven Servers. Die App fragt bei jeder Nachricht mit dem dann aktiven Server; nach einem
     * Wechsel gilt also sofort die neue Origin. Andere Frames, andere Origins und eine fehlende
     * Origin bleiben ohne Wirkung.
     */
    fun accepts(isMainFrame: Boolean, origin: SeitenOrigin?, aktiverServer: ServerAdresse?): Boolean {
        if (!isMainFrame || origin == null || aktiverServer == null) return false
        // Die Adresse ist geprüft: immer https, Host klein, Standardport weggelassen.
        if (origin.schema.lowercase() != "https") return false
        val port = if (origin.port <= 0) 443 else origin.port
        return origin.host.lowercase() == aktiverServer.host && port == (aktiverServer.port ?: 443)
    }

    /**
     * Die Origin-Regel für `addWebMessageListener`: Schema, Host und Port ohne Standardport.
     * Der Listener hängt nur an dieser Origin des aktiven Servers.
     */
    fun allowedOriginRule(server: ServerAdresse): String {
        val port = server.port
        return if (port == null || port == 443) "https://${server.host}" else "https://${server.host}:$port"
    }

    private val json = Json

    /**
     * Liest eine Nachricht der Seite (JSON-Text). `null`, wenn sie weder `haptics` ist noch eine
     * ganzzahlige `id` trägt: dann gibt es niemanden, dem die Hülle antworten könnte.
     */
    fun parse(nachricht: String): Brueckenbefehl? {
        // Erst die Länge, dann die teure Arbeit (Review W6): eine zu lange Nachricht wird nicht
        // geparst, nur ihr Kopf gelesen, damit die Seite eine Ablehnung bekommt.
        if (nachricht.length > MAX_NACHRICHT) return zuLang(nachricht)
        val objekt = try {
            json.parseToJsonElement(nachricht) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return null
        val cmd = text(objekt["cmd"]) ?: return null
        if (cmd == "haptics") return Brueckenbefehl.Haptics(text(objekt["kind"]) ?: "")
        val id = ganzzahl(objekt["id"]) ?: return null
        return when (cmd) {
            "show_notification" -> {
                val title = text(objekt["title"])
                    ?: return Brueckenbefehl.Ungueltig(id, "Der Meldung fehlt der Titel.")
                Brueckenbefehl.ShowNotification(id, title, text(objekt["body"]))
            }
            "print" -> Brueckenbefehl.Print(id)
            "sign_in_with_browser" -> Brueckenbefehl.SignInWithBrowser(id)
            "download_blob" -> {
                val daten = text(objekt["data"])
                    ?: return Brueckenbefehl.Ungueltig(id, "Dem Download fehlen die Daten.")
                if (daten.length > MAX_BASE64) return Brueckenbefehl.Ungueltig(id, DOWNLOAD_ZU_GROSS)
                val name = text(objekt["name"])?.takeIf { it.isNotBlank() } ?: "Download"
                Brueckenbefehl.DownloadBlob(id, name, daten)
            }
            // `set_app_badge` kennt Android nicht (Entwurf D4: kein `setAppBadge`).
            else -> Brueckenbefehl.Ungueltig(id, "Unbekannter Befehl der Hülle: $cmd")
        }
    }

    /**
     * Die Antwort als JSON-Text `{"id":…,"fehler":…|null,"wert":null|true|false}`; die App
     * reicht sie an die Seite (`WebMessagePort`/`JavaScriptReplyProxy.postMessage`).
     */
    fun replyJson(antwort: Brueckenantwort): String {
        val fehler = antwort.fehler?.let { JsonPrimitive(it).toString() } ?: "null"
        val wert = when (val w = antwort.wert) {
            Antwortwert.Null -> "null"
            is Antwortwert.Bool -> if (w.wert) "true" else "false"
        }
        return "{\"id\":${antwort.id},\"fehler\":$fehler,\"wert\":$wert}"
    }

    /** 50 MB Nutzdaten sind 66,7 Mio. Base64-Zeichen; die Grenze nimmt etwas Luft dazu. */
    private const val MAX_BASE64 = 70_000_000

    /** Längste Nachricht: der größte Download und Platz für Befehl, `id` und Dateinamen. */
    const val MAX_NACHRICHT = MAX_BASE64 + 64 * 1024

    private const val DOWNLOAD_ZU_GROSS = "Der Download ist größer als 50 MB."

    /** Kopf, wie ihn `huelle.js` schreibt (`JSON.stringify({ cmd, id, ... })`). */
    private val kopf = Regex("^\\{\"cmd\":\"([a-z_]{1,40})\",\"id\":(\\d{1,9})[,}]")

    /** Eine zu lange Nachricht: Ablehnung an die `id` aus dem Kopf, ohne lesbaren Kopf nichts. */
    private fun zuLang(nachricht: String): Brueckenbefehl? {
        val treffer = kopf.find(nachricht.take(80)) ?: return null
        val (cmd, id) = treffer.destructured
        return Brueckenbefehl.Ungueltig(id.toInt(), if (cmd == "download_blob") DOWNLOAD_ZU_GROSS else "Die Nachricht ist zu groß.")
    }

    private fun text(element: kotlinx.serialization.json.JsonElement?): String? =
        (element as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Ganze Zahl aus JS: eine JSON-Zahl, nie Text; `2.0` gilt, `1.5` nicht. */
    private fun ganzzahl(element: kotlinx.serialization.json.JsonElement?): Int? {
        val zahl = element as? JsonPrimitive ?: return null
        if (element is JsonNull || zahl.isString) return null
        zahl.content.toIntOrNull()?.let { return it }
        val d = zahl.content.toDoubleOrNull() ?: return null
        return if (d == floor(d) && d >= Int.MIN_VALUE && d <= Int.MAX_VALUE) d.toInt() else null
    }
}
