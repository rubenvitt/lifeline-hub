package dev.rubeen.lifeline.kern

/**
 * Das Init-Skript der Hülle. Die App liest es aus ihren Ressourcen, setzt ihre Version ein und
 * spielt es vor dem ersten Skript der Seite und nur im Hauptframe des aktiven Servers ein.
 */
object Initskript {
    /** Platzhalter im Skript; steht er nach dem Einspielen noch da, meldet das Skript keine Version. */
    const val PLATZHALTER = "__LIFELINE_VERSION__"

    /**
     * Setzt [version] für den Platzhalter ein. Die Version landet in einem JS-String: Zeichen
     * außerhalb von ASCII-Ziffern, -Buchstaben, `.`, `-` und `+` lassen den Platzhalter stehen
     * (dann lieber keine Version als ein kaputtes Skript).
     */
    fun render(vorlage: String, version: String?): String {
        if (version == null || !isSafe(version)) return vorlage
        return vorlage.replace(PLATZHALTER, version)
    }

    private fun isSafe(version: String): Boolean =
        version.isNotEmpty() && version.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in ".-+" }
}
