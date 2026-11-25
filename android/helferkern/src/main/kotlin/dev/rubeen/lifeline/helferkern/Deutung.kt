package dev.rubeen.lifeline.helferkern

import dev.rubeen.lifeline.kern.AdressException
import dev.rubeen.lifeline.kern.ServerAdresse
import java.net.URLDecoder

/**
 * Server und Code einer Helfer-Einladung, gelesen aus QR-Code oder Deeplink.
 *
 * [server] ist die geprüfte Herkunft des Servers in der Normalform von [ServerAdresse]: `https`,
 * Host klein, Standardport weggelassen, Pfad `/`. Den Code reicht die App groß geschrieben und
 * sonst unverändert durch; Normalform und Prüfung macht der Server.
 */
data class HelferZiel(val server: ServerAdresse, val code: String)

/** Formen der Einladung (Spec „Ablauf“, Schritt 2): QR `https://<server>/helfer#<CODE>`, Deeplink `lifeline-helfer://anmelden?server=<url>#<CODE>`. */
object HelferLink {
    /** Schema, das die Helfer-App registriert (Manifest, Intent-Filter). */
    const val SCHEMA = "lifeline-helfer"

    /** Host des Deeplinks. */
    const val BEFEHL = "anmelden"

    /** Pfad des QR-Codes auf dem Server (`/koppeln` gehört der Geräte-Kopplung). */
    const val PFAD = "/helfer"
}

/**
 * Liest QR-Inhalt oder Deeplink einer Helfer-Einladung; `null` für alles andere (gemeinsame Fälle
 * `src-tauri/faelle/helfer.json`, Abschnitt `deute`).
 *
 * Die Serveradresse prüft [ServerAdresse.parse] wie in `adresse.json`: nur `https`, keine
 * Zugangsdaten, kein gesperrter Port. Eine `http`-Adresse gilt nie, auch nicht für `localhost`
 * oder `*.local`. Der Server im Deeplink muss eine Herkunft ohne Pfad und Abfrage sein.
 */
fun deuteHelferLink(text: String): HelferZiel? {
    val eingabe = text.trim { it.isWhitespace() }
    val schemaEnde = eingabe.indexOf(':')
    if (schemaEnde <= 0) return null
    val schema = eingabe.substring(0, schemaEnde).lowercase()
    val ohneSchema = eingabe.substring(schemaEnde + 1)
    if (!ohneSchema.startsWith("//")) return null
    val fragmentAt = ohneSchema.indexOf('#')
    if (fragmentAt < 0) return null
    val code = ohneSchema.substring(fragmentAt + 1)
    if (code.isEmpty()) return null
    val vorFragment = ohneSchema.substring(2, fragmentAt)
    val autoritaetEnde = vorFragment.indexOfFirst { it == '/' || it == '?' }.let { if (it < 0) vorFragment.length else it }
    val autoritaet = vorFragment.substring(0, autoritaetEnde)
    val rest = vorFragment.substring(autoritaetEnde)
    val pfad = rest.substringBefore('?')
    val abfrage = if ('?' in rest) rest.substringAfter('?') else null

    val server = when (schema) {
        "https" -> {
            if (pfad != HelferLink.PFAD && pfad != HelferLink.PFAD + "/") return null
            herkunft("https://$autoritaet")
        }
        HelferLink.SCHEMA -> {
            if (!autoritaet.equals(HelferLink.BEFEHL, ignoreCase = true)) return null
            if (pfad != "" && pfad != "/") return null
            val ziel = abfrage?.split('&')
                ?.map { it.substringBefore('=') to if ('=' in it) it.substringAfter('=') else null }
                ?.firstOrNull { (name, _) -> prozentDekodiert(name) == "server" }
                ?.second
                ?.let(::prozentDekodiert)
                ?: return null
            val adresse = adresse(ziel) ?: return null
            // Ein Pfad oder eine Abfrage im Server wäre still abgeschnitten worden: lieber verwerfen.
            herkunft(adresse.text)?.takeIf { it == adresse }
        }
        else -> return null
    } ?: return null
    return HelferZiel(server, code.uppercase())
}

private fun adresse(text: String): ServerAdresse? =
    try {
        ServerAdresse.parse(text)
    } catch (_: AdressException) {
        null
    }

/** Herkunft (`https://host[:port]/`) einer Adresse, geprüft wie in `adresse.json`. */
private fun herkunft(text: String): ServerAdresse? {
    val adresse = adresse(text) ?: return null
    // Normalform `https://<host>[:<port>]<pfad>…`: die Herkunft endet vor dem ersten `/` nach dem Schema.
    val nachSchema = adresse.text.removePrefix("https://")
    return adresse("https://" + nachSchema.substringBefore('/'))
}

/** Prozentkodierung auflösen (UTF-8); `+` bleibt `+`, ungültige Folgen lassen den Text unverändert. */
private fun prozentDekodiert(text: String): String =
    if ('%' !in text) text
    else try {
        // Die Form mit Zeichensatz-Namen: `decode(String, Charset)` gibt es unter Android erst ab
        // API 33, die Helfer-App läuft ab API 29.
        URLDecoder.decode(text.replace("+", "%2B"), "UTF-8")
    } catch (_: IllegalArgumentException) {
        text
    }
