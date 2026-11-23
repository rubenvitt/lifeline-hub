package dev.rubeen.lifeline.kern

import java.io.ByteArrayOutputStream

/**
 * Deeplink `lifeline://verbinden?server=<https-Adresse>` (wie `src-tauri/src/deeplink.rs` und
 * `Deeplink.swift`).
 *
 * Zwei reine Schritte: [parse] liest den Link, [decide] legt fest, was er gegenüber dem
 * gespeicherten Server bewirken darf. Ein Link lenkt nie still auf einen anderen Server: sonst
 * könnte jede Webseite die App auf einen fremden Server lenken, der die Anmeldung abgreift.
 */
object Deeplink {
    /** Schema, das die App registriert (Manifest, Intent-Filter). */
    const val SCHEMA = "lifeline"

    sealed interface Aktion {
        /** Das Onboarding zeigt die Adresse; verbunden wird erst nach Bestätigung. */
        data class Vorbelegen(val adresse: ServerAdresse) : Aktion

        /** Wechsel auf einen anderen Server erst nach Rückfrage. */
        data class Bestaetigen(val adresse: ServerAdresse) : Aktion

        /** Der Link nennt den aktiven Server. */
        data object Nichts : Aktion

        /** Kennwort in den gemeinsamen Fällen (`src-tauri/faelle/deeplink.json`). */
        val kennwort: String
            get() = when (this) {
                is Vorbelegen -> "vorbelegen"
                is Bestaetigen -> "bestaetigen"
                Nichts -> "nichts"
            }
    }

    /**
     * Liest einen Deeplink. `null` für alles außer `lifeline://verbinden?server=<gültige Adresse>`,
     * auch für den Rücksprung der Anmeldung: den nimmt nur die laufende Anmeldesitzung an.
     *
     * Der Link wird von Hand zerlegt statt mit `java.net.URI`: der wirft bei Zeichen, die ein
     * Scanner oder eine Webseite durchaus liefert, und soll dann nicht den Link verwerfen, sondern
     * nur die Prüfung der Adresse entscheiden lassen.
     */
    fun parse(link: String): ServerAdresse? {
        val doppelpunkt = link.indexOf(':')
        if (doppelpunkt <= 0 || !link.substring(0, doppelpunkt).equals(SCHEMA, ignoreCase = true)) return null
        val rest = link.substring(doppelpunkt + 1)
        if (!rest.startsWith("//")) return null
        val ohneFragment = rest.substring(2).substringBefore('#')
        val query = if ('?' in ohneFragment) ohneFragment.substringAfter('?') else return null
        val vorQuery = ohneFragment.substringBefore('?')
        val host = vorQuery.substringBefore('/')
        val pfad = vorQuery.substring(host.length)
        if (host != "verbinden" || pfad !in listOf("", "/")) return null
        val ziel = query.split('&')
            .map { it.substringBefore('=') to if ('=' in it) it.substringAfter('=') else null }
            .firstOrNull { (name, _) -> prozentDekodiert(name) == "server" }
            ?.second
            ?.let(::prozentDekodiert)
            ?: return null
        return try {
            ServerAdresse.parse(ziel)
        } catch (_: AdressException) {
            null
        }
    }

    /** Was ein gültiger Deeplink gegenüber der gespeicherten Adresse bewirkt (gemeinsame Fälle). */
    fun decide(gespeichert: ServerAdresse?, neu: ServerAdresse): Aktion = when {
        gespeichert == null -> Aktion.Vorbelegen(neu)
        gespeichert == neu -> Aktion.Nichts
        else -> Aktion.Bestaetigen(neu)
    }

    /**
     * Dasselbe mit der Serverliste der App: ein Server, der nicht in der Liste steht, wird nicht
     * gewechselt, sondern im Onboarding vorbelegt (geprüft und gespeichert wird er dort).
     */
    fun decide(aktiv: ServerAdresse?, bekannt: List<ServerAdresse>, neu: ServerAdresse): Aktion =
        when (val aktion = decide(aktiv, neu)) {
            is Aktion.Bestaetigen -> if (aktion.adresse in bekannt) aktion else Aktion.Vorbelegen(aktion.adresse)
            else -> aktion
        }

    /**
     * Inhalt eines gescannten QR-Codes: ein Deeplink `lifeline://verbinden?server=…` oder eine
     * https-Adresse. Alles andere (WLAN-Codes, fremde Links) ergibt nichts.
     */
    fun adresseAusQrCode(inhalt: String): ServerAdresse? {
        val roh = inhalt.trim { it.isWhitespace() }
        if (roh.lowercase().startsWith("$SCHEMA:")) return parse(roh)
        return try {
            ServerAdresse.parse(roh)
        } catch (_: AdressException) {
            null
        }
    }

    /** Prozentkodierung auflösen (UTF-8); ungültige Folgen bleiben stehen, `+` bleibt `+`. */
    private fun prozentDekodiert(text: String): String {
        if ('%' !in text) return text
        val bytes = ByteArrayOutputStream()
        var i = 0
        while (i < text.length) {
            val c = text[i]
            val hex = if (c == '%' && i + 2 < text.length) text.substring(i + 1, i + 3) else null
            val wert = hex?.toIntOrNull(16)
            if (wert != null && hex.all { it.isLetterOrDigit() }) {
                bytes.write(wert)
                i += 3
            } else {
                bytes.write(c.toString().toByteArray(Charsets.UTF_8))
                i += 1
            }
        }
        return bytes.toString(Charsets.UTF_8)
    }
}
