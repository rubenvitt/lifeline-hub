package dev.rubeen.lifeline.kern

/**
 * Testbare Logik der Android-Hülle ohne Android-Klassen (LLH-1989). Keine Fachlogik: die Hülle
 * lädt die Weboberfläche des Servers (Entwurf `y1dsr5i9-android-huelle`, D1).
 */
object LifelineKern {
    /**
     * Die Hüllen-Verträge (`shell_contract` aus `GET /api/shell`), mit denen diese App arbeitet.
     * Ein neuer Wert kommt erst hinzu, wenn die App den Bruch des Servers mitgeht.
     */
    val bekannteVertraege: List<Int> = listOf(1)
}
