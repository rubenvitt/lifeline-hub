package dev.rubeen.lifeline.helferkern

/** Texte der Seiten, die ohne Oberfläche feststehen; gleich wie in `ios/Helfer/App`. */
object Anzeige {
    /** Relatives Alter der letzten Sendung („vor 12 s“). */
    fun alter(sekunden: Long): String {
        val s = maxOf(0L, sekunden)
        return when {
            s < 60 -> "vor $s s"
            s < 3600 -> "vor ${s / 60} min"
            else -> "vor ${s / 3600} h"
        }
    }

    /**
     * Satz für eine abgewiesene Anfrage: [status] `0` ist ein Netzfehler, [reason] und [error]
     * stammen aus dem Fehler-Body (`{error, reason?}`).
     */
    fun meldung(status: Int, reason: String? = null, error: String? = null): String = when {
        status == 0 -> "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut."
        status == 401 -> "Der Code ist ungültig oder abgelaufen. Bitte den QR-Code neu scannen."
        status == 403 && (reason == null || reason == "tracking_off") -> "Die Ortung ist für diese Organisation ausgeschaltet."
        status == 409 && reason == "person_session" -> "Auf diesem Gerät ist eine persönliche Anmeldung aktiv."
        status == 409 -> "Das geht im aktuellen Zustand der Anmeldung nicht."
        status == 422 -> error ?: "Die Angaben passen nicht. Bitte prüfen."
        status == 429 -> "Zu viele Versuche. Bitte kurz warten."
        else -> error ?: "Unerwartete Antwort des Servers ($status)."
    }

    /** Hinweis, wenn ein gescannter Text keine Einladung ist. */
    const val KEINE_EINLADUNG = "Das ist kein QR-Code einer Helfer-Einladung."

    /** Hinweis, wenn „Code eingeben“ keine gültige Einladung ergibt. */
    const val EINGABE_UNGUELTIG = "Server oder Code passen nicht. Der Server braucht eine https-Adresse."

    /**
     * Link des QR-Codes aus „Code eingeben“: der Server auch ohne `https://` und mit `/` am Ende,
     * der Code ohne Leerzeichen. `null` ohne Code; ob der Link gilt, entscheidet [deuteHelferLink].
     */
    fun eingabeLink(server: String, code: String): String? {
        var adresse = server.trim().trimEnd('/')
        if (!adresse.lowercase().startsWith("https://")) adresse = "https://$adresse"
        val ohneLeer = code.trim().replace(" ", "")
        if (ohneLeer.isEmpty()) return null
        return "$adresse${HelferLink.PFAD}#$ohneLeer"
    }

    /** Taktisches Zeichen als Text: Organisation · Fachaufgabe; `null` ohne beides. */
    fun zeichen(organisation: String?, funktion: String?): String? =
        listOfNotNull(organisation, funktion).filter { it.isNotEmpty() }.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
