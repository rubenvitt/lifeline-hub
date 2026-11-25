package dev.rubeen.lifeline.kern

import java.net.URI

/**
 * Bildet die Rückrufe des WebViews auf die Linkregeln ab (`Linkweiche.swift`). Die App ruft
 * [navigation] aus `shouldOverrideUrlLoading` und aus `onCreateWindow` (dort mit `neuesFenster`).
 * Downloads, die nicht über eine Dateiroute laufen (`blob:`, Antworten ohne Darstellung), meldet
 * Android über den `DownloadListener`.
 */
object Linkweiche {
    sealed interface Entscheidung {
        /** Die Navigation läuft wie angefordert. */
        data object Erlauben : Entscheidung

        /** Nichts laden, nichts öffnen. */
        data object Abbrechen : Entscheidung

        /** Die Datei laden und zum Teilen anbieten. */
        data object Download : Entscheidung

        /** Ein neues Fenster der eigenen Origin: dieselbe Adresse im selben WebView. */
        data class ImWebviewLaden(val url: URI) : Entscheidung

        /** Das System öffnet die Adresse. */
        data class System(val url: URI) : Entscheidung
    }

    /**
     * @param neuesFenster `target=_blank` oder `window.open` (kein Zielframe).
     * @param seite die Adresse, die der WebView gerade zeigt (für die Aufrufer, die sie kennen).
     */
    @Suppress("UNUSED_PARAMETER")
    fun navigation(server: URI?, ziel: URI, isMainFrame: Boolean, neuesFenster: Boolean, seite: URI?): Entscheidung {
        if (neuesFenster) {
            return when (Linkregeln.neuesFenster(server, ziel)) {
                Linkregeln.Ziel.NEBENFENSTER, Linkregeln.Ziel.HUELLE -> Entscheidung.ImWebviewLaden(ziel)
                Linkregeln.Ziel.DOWNLOAD -> Entscheidung.Download
                Linkregeln.Ziel.SYSTEM -> Entscheidung.System(ziel)
                Linkregeln.Ziel.VERWERFEN -> Entscheidung.Abbrechen
            }
        }
        // Unterframes (Karten, eingebettete Inhalte) folgen nicht den Regeln des Fensters.
        if (!isMainFrame) return Entscheidung.Erlauben
        return when (Linkregeln.navigation(server, ziel)) {
            Linkregeln.Ziel.HUELLE -> Entscheidung.Erlauben
            Linkregeln.Ziel.DOWNLOAD -> Entscheidung.Download
            Linkregeln.Ziel.SYSTEM -> Entscheidung.System(ziel)
            Linkregeln.Ziel.NEBENFENSTER, Linkregeln.Ziel.VERWERFEN -> Entscheidung.Abbrechen
        }
    }
}

/** Wie die App eine abgelegte Datei übergibt: dem Ziel direkt zeigen oder im Teilen-Blatt anbieten. */
enum class Oeffnen { ANZEIGEN, TEILEN }

/** Wohin ein Download geht: nur der Name ist Logik des Kerns, das Verzeichnis wählt die App. */
object Downloadablage {
    /** Längster Dateiname in UTF-8-Bytes; Dateisysteme erlauben 255, etwas Luft bleibt. */
    const val MAX_NAME_BYTES = 200

    /** Größte Datei, die die App ablegt (Anhänge, Exporte, Archive); mehr ist keine Antwort des Servers. */
    const val MAX_BYTES = 1024L * 1024 * 1024

    /** Längste Endung, die beim Kürzen erhalten bleibt (`.xlsx`, `.tar.gz` nicht). */
    private const val MAX_ENDUNG = 16

    /**
     * Nur der letzte Pfadteil, ohne Steuerzeichen, `:` und `\`, ohne führende Punkte, höchstens
     * [MAX_NAME_BYTES] lang; gekürzt wird vor der Endung (Review K5).
     */
    fun dateiname(vorschlag: String): String {
        val letzter = vorschlag.split('/').lastOrNull { it.isNotEmpty() } ?: ""
        val sauber = letzter.map { if (it == ':' || it == '\\' || Character.isISOControl(it)) '_' else it }.joinToString("")
        val ohnePunkte = sauber.dropWhile { it == '.' }.trim { it.isWhitespace() }
        return kuerze(ohnePunkte.ifEmpty { "Download" })
    }

    /**
     * Kalenderdateien (`text/calendar` oder Endung `ics`) gehen per `ACTION_VIEW` an die
     * Kalender-App; Google Kalender nimmt sie nur so an. Alles andere geht ins Teilen-Blatt.
     */
    fun oeffnenAls(mimetyp: String, endung: String): Oeffnen {
        val typ = mimetyp.substringBefore(';').trim()
        return if (typ.equals("text/calendar", ignoreCase = true) || endung.equals("ics", ignoreCase = true)) {
            Oeffnen.ANZEIGEN
        } else {
            Oeffnen.TEILEN
        }
    }

    private fun kuerze(name: String): String {
        if (bytes(name) <= MAX_NAME_BYTES) return name
        val punkt = name.lastIndexOf('.')
        val endung = if (punkt > 0 && name.length - punkt <= MAX_ENDUNG) name.substring(punkt) else ""
        val stamm = name.removeSuffix(endung)
        return passend(stamm, MAX_NAME_BYTES - bytes(endung)).trimEnd() + endung
    }

    /** Der längste Anfang von [text] mit höchstens [grenze] Bytes, ohne ein Zeichen zu zerteilen. */
    private fun passend(text: String, grenze: Int): String {
        var laenge = 0
        var ende = 0
        while (ende < text.length) {
            val zeichen = text.codePointAt(ende)
            val breite = bytes(String(Character.toChars(zeichen)))
            if (laenge + breite > grenze) break
            laenge += breite
            ende += Character.charCount(zeichen)
        }
        return text.substring(0, ende)
    }

    private fun bytes(text: String): Int = text.toByteArray(Charsets.UTF_8).size
}
