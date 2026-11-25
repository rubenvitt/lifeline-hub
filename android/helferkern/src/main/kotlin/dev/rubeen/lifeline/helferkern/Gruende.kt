package dev.rubeen.lifeline.helferkern

/** Warum eine Anmeldung endete; die App zeigt den Text auf dem Bildschirm „Beendet“ (Spec „Die Helfer-App“, Bildschirm 5). */
enum class Grund(val wire: String, val titel: String, val text: String) {
    EINSATZ_BEENDET("incident_closed", "Einsatz beendet", "Der Einsatz ist beendet. Die Ortung ist aus."),
    ENTFERNT(
        "revoked", "Abgemeldet durch die Einsatzleitung",
        "Die Einsatzleitung hat dich entfernt. Die Ortung ist aus.",
    ),
    ABGELAUFEN("expired", "Anmeldung abgelaufen", "Die Anmeldung ist abgelaufen. Die Ortung ist aus."),
    ABGELEHNT(
        "rejected", "Anmeldung abgelehnt",
        "Die Einsatzleitung hat die Anmeldung abgelehnt. Die Ortung ist aus.",
    ),
    ABGEMELDET("signed_out", "Abgemeldet", "Du hast dich abgemeldet. Die Ortung ist aus.");

    companion object {
        /** Grund aus `reason` des Servers (`HelferEndeGrund` in `src/helfer/anmeldung.rs`); `null` für einen unbekannten Wert. */
        fun ausWire(wire: String): Grund? = entries.firstOrNull { it.wire == wire }
    }
}
