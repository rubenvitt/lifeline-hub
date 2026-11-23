package dev.rubeen.lifeline.kern

/**
 * Haptik auf Wunsch der Seite (`haptics(kind)`, Entwurf D6). Reine Abbildung; die App ordnet die
 * Rückmeldung den `HapticFeedbackConstants` der Android-Version zu und tut auf Geräten ohne
 * Vibrationsmotor nichts.
 */
object Haptik {
    /** Schlüssel des Schalters „Haptik“ in den Einstellungen (Vorgabe an). */
    const val SCHALTER_SCHLUESSEL = "haptik"

    /** Was die App abspielt; Zuordnung zu `HapticFeedbackConstants` macht die App. */
    enum class Feedback { CONFIRM, REJECT, WARNING, SELECTION, TAP }

    /**
     * [kind] kommt ungeprüft aus der Seite. Eine unbekannte Art und der ausgeschaltete Schalter
     * ergeben nichts, nie einen Fehler.
     */
    fun feedback(kind: String, isEnabled: Boolean): Feedback? {
        if (!isEnabled) return null
        return when (kind) {
            "success" -> Feedback.CONFIRM
            "warning" -> Feedback.WARNING
            "error" -> Feedback.REJECT
            "selection" -> Feedback.SELECTION
            "tap" -> Feedback.TAP
            else -> null
        }
    }

    fun isEnabled(gespeichert: Boolean?): Boolean = gespeichert ?: true
}
