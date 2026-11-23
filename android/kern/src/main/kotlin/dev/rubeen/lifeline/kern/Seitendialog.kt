package dev.rubeen.lifeline.kern

/**
 * Ein Dialog der Seite (`alert`, `confirm`, `prompt`) als nativer Dialog. Ohne ihn liefert
 * `confirm` im WebView still `false`. Die App ruft ihn aus `WebChromeClient.onJsAlert`,
 * `onJsConfirm` und `onJsPrompt`.
 *
 * Jeder Frame darf fragen, auch eine fremde Origin (Identitätsanbieter, eingebettete Inhalte);
 * der Titel nennt aber immer den Host des auslösenden Frames, nie den des Servers. So kann eine
 * fremde Seite nicht im Namen des Servers fragen.
 */
@ConsistentCopyVisibility
data class Seitendialog private constructor(val art: Art, val titel: String, val nachricht: String) {
    sealed interface Art {
        /** `alert`: nur „OK“. */
        data object Hinweis : Art

        /** `confirm`: „OK“ und „Abbrechen“. */
        data object Rueckfrage : Art

        /** `prompt`: Textfeld mit Vorgabe, „OK“ und „Abbrechen“. */
        data class Eingabe(val vorgabe: String?) : Art
    }

    /** Was der Mensch gewählt hat. */
    sealed interface Ergebnis {
        /** „OK“, bei der Eingabe mit dem Text des Feldes. */
        data class Ok(val text: String?) : Ergebnis

        data object Abgebrochen : Ergebnis
    }

    val abbrechenTitel: String? get() = if (art == Art.Hinweis) null else "Abbrechen"

    val hasFeld: Boolean get() = art is Art.Eingabe

    /** Vorbelegung des Textfeldes; leer, wenn die Seite keine nennt. */
    val feldVorgabe: String? get() = (art as? Art.Eingabe)?.let { it.vorgabe ?: "" }

    companion object {
        /** Längere Nachrichten schneidet die Hülle ab, damit „OK“ erreichbar bleibt. */
        const val MAX_ZEICHEN = 1000
        const val OK_TITEL = "OK"
        const val OHNE_HOST = "Diese Seite"

        operator fun invoke(art: Art, nachricht: String, origin: SeitenOrigin): Seitendialog =
            Seitendialog(art, titel(origin), kuerzen(nachricht))

        /** Zählt Unicode-Zeichen, nicht UTF-16-Einheiten: ein Emoji wird nicht zerschnitten. */
        private fun kuerzen(nachricht: String): String {
            if (nachricht.codePointCount(0, nachricht.length) <= MAX_ZEICHEN) return nachricht
            return nachricht.substring(0, nachricht.offsetByCodePoints(0, MAX_ZEICHEN)) + "…"
        }

        /**
         * Host des Frames, klein; Port nur, wenn er nicht der Standardport des Schemas ist (-1 und
         * 0 heißen Standardport); ein anderes Schema als https steht davor.
         */
        fun titel(origin: SeitenOrigin): String {
            val host = origin.host.trim { it.isWhitespace() }.lowercase()
            if (host.isEmpty()) return OHNE_HOST
            val schema = origin.schema.lowercase()
            val standardport = if (schema == "http") 80 else 443
            val port = if (origin.port <= 0 || origin.port == standardport) "" else ":${origin.port}"
            val vorsatz = if (schema == "https") "" else "$schema://"
            return vorsatz + host + port
        }

        /** Antwort für `confirm`. `null` heißt: kein Dialog gezeigt; dann lehnt die Seite ab. */
        fun confirmWert(ergebnis: Ergebnis?): Boolean = ergebnis is Ergebnis.Ok

        /** Antwort für `prompt`: der Text nach „OK“ (leer statt `null`), sonst `null`. */
        fun promptWert(ergebnis: Ergebnis?): String? = (ergebnis as? Ergebnis.Ok)?.let { it.text ?: "" }
    }
}
