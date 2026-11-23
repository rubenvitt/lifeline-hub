package dev.rubeen.lifeline.kern

import java.net.URI

/**
 * Was mit einer URL geschieht, die ein neues Fenster verlangt oder den WebView wegnavigiert
 * (wie `src-tauri/src/links.rs` und `Linkregeln.swift`, gemeinsame Fälle
 * `src-tauri/faelle/links.json`).
 *
 * Dateirouten erkennt die Hülle am Pfad `/api/`, nicht an der Antwort; einzige Ausnahme sind die
 * Anmelderouten `/api/auth/` (OIDC-Start und -Rücksprung laufen im WebView). Ein `blob:` der
 * Serverseite (CSV-Export) wird nie verworfen: der `DownloadListener` des WebViews lädt ihn.
 */
object Linkregeln {
    /** Die Kennwörter sind die der gemeinsamen Fälle. */
    enum class Ziel(val kennwort: String) {
        /** Die Navigation läuft im WebView wie angefordert. */
        HUELLE("huelle"),

        /** Desktop: ein weiteres Fenster. Android: dieselbe Adresse im selben WebView. */
        NEBENFENSTER("nebenfenster"),

        /** Die Datei wird geladen und zum Teilen angeboten; die Seite bleibt. */
        DOWNLOAD("download"),

        /** Das System öffnet sie (Browser, Mail, Telefon). */
        SYSTEM("system"),

        /** Nichts öffnen. */
        VERWERFEN("verwerfen"),
    }

    /** `window.open` bzw. `target="_blank"`. */
    fun neuesFenster(server: URI?, ziel: URI): Ziel {
        if (isEigeneOrigin(server, ziel)) {
            return if (isDateiroute(ziel)) Ziel.DOWNLOAD else Ziel.NEBENFENSTER
        }
        return when (ziel.scheme?.lowercase()) {
            "http", "https", "mailto", "tel" -> Ziel.SYSTEM
            else -> Ziel.VERWERFEN
        }
    }

    /**
     * Navigation im WebView. Fremde `http(s)`-Ziele bleiben erlaubt: die Anmeldung beim
     * Identitätsanbieter läuft dort, und die Hülle kennt den Anbieter nicht.
     */
    fun navigation(server: URI?, ziel: URI): Ziel {
        if (isEigeneOrigin(server, ziel) && isDateiroute(ziel)) return Ziel.DOWNLOAD
        return when (ziel.scheme?.lowercase()) {
            "mailto", "tel" -> Ziel.SYSTEM
            else -> Ziel.HUELLE
        }
    }

    /** Zeigt [seite] noch den Server [server]? */
    fun belongsToServer(server: URI, seite: URI): Boolean = isEigeneOrigin(server, seite)

    /**
     * Gleiche Origin wie der Server. Das Schema wird eigens verlangt: `blob:` erbt die Origin der
     * Seite, die ihn erzeugt hat, ist aber keine Adresse, die ein WebView laden kann.
     */
    internal fun isEigeneOrigin(server: URI?, ziel: URI): Boolean {
        val a = server?.let(Origin::von) ?: return false
        val b = Origin.von(ziel) ?: return false
        return a == b
    }

    private fun isDateiroute(ziel: URI): Boolean {
        val pfad = ziel.rawPath ?: ""
        return pfad.startsWith("/api/") && !pfad.startsWith("/api/auth/")
    }

    /** Schema, Host und Port einer `http(s)`-Adresse, der Port mit seinem Standardwert. */
    private data class Origin(val schema: String, val host: String, val port: Int) {
        companion object {
            fun von(url: URI): Origin? {
                val schema = url.scheme?.lowercase() ?: return null
                if (schema != "http" && schema != "https") return null
                val host = url.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
                val port = if (url.port >= 0) url.port else if (schema == "https") 443 else 80
                return Origin(schema, host, port)
            }
        }
    }
}
