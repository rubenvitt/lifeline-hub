package dev.rubeen.lifeline.helferkern

/**
 * Wann der Helfer-Dienst den Live-Strom neu verbindet (ADR-0104, Entwurf „Empfang“): mit wachsendem
 * Abstand wie die Sendung, höchstens jede Minute; 401, 403 und 404 beenden die Kopplung wie bei der
 * Ortung.
 */
object Empfang {
    enum class Entscheidung {
        /** Der Strom ist offen: lesen. */
        VERBINDEN,

        /** Netzfehler, Überlast oder Serverfehler: nach [nachAbbruch] erneut verbinden. */
        WARTEN,

        /** Sitzung oder Kopplung weg (401, 403, 404): nicht mehr verbinden, die Kopplung endet. */
        ENDEN,
    }

    const val ANFANG_MS = 1_000L
    const val OBERGRENZE_MS = 60_000L

    /**
     * Wartezeit vor dem nächsten Verbinden nach [versuch] Abbrüchen in Folge (ab 1): 1 s, 2 s,
     * 4 s, … höchstens 60 s. Eine Verbindung, die Daten liefert, setzt die Zählung zurück.
     */
    fun nachAbbruch(versuch: Int): Long {
        val schritt = (versuch - 1).coerceIn(0, MAX_SCHRITTE)
        return minOf(ANFANG_MS shl schritt, OBERGRENZE_MS)
    }

    /**
     * Entscheidung nach dem HTTP-Status des Verbindungsaufbaus; `0` ist ein Netzfehler. Eine
     * Weiterleitung (3xx) folgt die App nie (ADR-0101); sie gilt wie jeder andere Fehler als
     * vorübergehend, damit ein Neustart des Servers den Empfang nicht beendet.
     */
    fun nachAntwort(status: Int): Entscheidung = when (status) {
        in 200..299 -> Entscheidung.VERBINDEN
        401, 403, 404 -> Entscheidung.ENDEN
        else -> Entscheidung.WARTEN
    }

    /** 2^6 s = 64 s liegt schon über der Obergrenze. */
    private const val MAX_SCHRITTE = 6
}

/** Wie die Ortung im Helfer-Dienst gerade steht (Zeile der Benachrichtigung). */
enum class Ortungslage(val text: String) {
    AN("Ortung an"),
    PAUSIERT("Ortung pausiert"),
    RUHT("Ortung ruht"),

    /** Die Ortung dürfte weitergehen, aber Android lässt `location` nur aus dem Vordergrund zu. */
    WARTET("Ortung wartet — App öffnen"),

    /** Kein Standortrecht oder keine Rolle, die ortet: nur Empfang. */
    AUS("Ortung aus"),
}

/**
 * Text der einen Benachrichtigung des Helfer-Dienstes (Entwurf „Benachrichtigung des Dienstes“):
 * Ortung und Empfang, damit niemand sich für erreichbar hält, der es nicht ist.
 */
object Dienstanzeige {
    const val EMPFAENGT = "empfängt Aufträge"
    const val GETRENNT = "getrennt — verbinde neu"

    fun zeile(ortung: Ortungslage, verbunden: Boolean): String =
        "${ortung.text} · ${if (verbunden) EMPFAENGT else GETRENNT}"
}
