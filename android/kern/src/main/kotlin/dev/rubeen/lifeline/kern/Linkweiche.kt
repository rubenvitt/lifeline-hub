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

/** Wohin ein Download geht: nur der Name ist Logik des Kerns, das Verzeichnis wählt die App. */
object Downloadablage {
    /** Nur der letzte Pfadteil, ohne Steuerzeichen, `:` und `\`, ohne führende Punkte. */
    fun dateiname(vorschlag: String): String {
        val letzter = vorschlag.split('/').lastOrNull { it.isNotEmpty() } ?: ""
        val sauber = letzter.map { if (it == ':' || it == '\\' || Character.isISOControl(it)) '_' else it }.joinToString("")
        val ohnePunkte = sauber.dropWhile { it == '.' }.trim { it.isWhitespace() }
        return ohnePunkte.ifEmpty { "Download" }
    }
}
