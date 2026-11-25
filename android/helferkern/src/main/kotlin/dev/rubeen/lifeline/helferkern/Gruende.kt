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

/**
 * Warum eine bestätigte Kopplung gerade nicht ortet (403 einer Sendung mit `reason`,
 * `src/routes/helfer.rs`, `position_senden`): die Kopplung und die Sitzung bleiben, die App zeigt
 * „Angemeldet – Ortung ruht“ mit [text] und prüft alle [PRUEFABSTAND_S] Sekunden, ob sie weiter
 * orten darf ([Phase.Ruht]).
 */
enum class Ruhegrund(val wire: String, val text: String) {
    /** Weder Ortungsgerät des Ziels noch eine Person mit Personenortung. */
    KEINE_ROLLE(
        "no_role",
        "Die Einsatzleitung hat dich ohne Ortung angemeldet: dieses Gerät ortet weder deine Einheit " +
            "oder dein Fahrzeug noch dich als Person. Ändert sie das, ortet die App von selbst weiter.",
    ),

    /** „Ortung im Einsatz“ der Organisation ist aus. */
    ORTUNG_AUS(
        "tracking_off",
        "Die Ortung ist für diese Organisation gerade ausgeschaltet. Wird sie wieder eingeschaltet, " +
            "ortet die App von selbst weiter.",
    );

    /**
     * Ob die App in der Ruhe mit `{paused: false}` prüft, ob sie wieder orten darf: `GET
     * /api/devices/me` nennt die Einstellung der Organisation nicht, das Fortsetzen antwortet 403
     * `tracking_off`, solange sie aus ist, und braucht keine Position.
     */
    val pruefeMitFortsetzen: Boolean
        get() = this == ORTUNG_AUS

    companion object {
        /** Überschrift der Seite „Angemeldet“ während der Ruhe. */
        const val TITEL = "Angemeldet – Ortung ruht"

        /** Abstand der Prüfung während der Ruhe. */
        const val PRUEFABSTAND_S = 60L

        /** Grund aus `reason` eines 403; `null` für jeden anderen Wert. */
        fun ausWire(wire: String?): Ruhegrund? = entries.firstOrNull { it.wire == wire }
    }
}
