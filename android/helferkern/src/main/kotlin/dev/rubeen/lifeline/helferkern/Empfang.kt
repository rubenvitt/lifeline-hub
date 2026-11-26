package dev.rubeen.lifeline.helferkern

/**
 * Wann der Helfer-Dienst den Live-Strom neu verbindet (ADR-0111, Entwurf „Empfang“): mit wachsendem
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
     * 4 s, … höchstens 60 s. Eine Verbindung, die Daten liefert, setzt die Zählung zurück
     * ([Wiederverbindung]).
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

/**
 * Abbrüche des Live-Stroms in Folge (ADR-0111): erst Daten, also die erste Zeile, setzen die Zählung
 * zurück, nicht schon der Verbindungsaufbau. Sonst wartete ein Server, der annimmt und sofort
 * schließt, nie länger als [Empfang.ANFANG_MS]. Nur aus einem Faden nutzen (die Schleife des
 * Empfangs).
 */
class Wiederverbindung {
    /** Abbrüche seit der letzten Verbindung, die Daten lieferte. */
    var abbrueche: Int = 0
        private set

    /** Eine Zeile kam an: die Verbindung trägt. */
    fun daten() {
        abbrueche = 0
    }

    /** Die Verbindung brach ab oder kam nicht zustande: Wartezeit bis zum nächsten Versuch. */
    fun abbruch(): Long {
        if (abbrueche < Int.MAX_VALUE) abbrueche += 1
        return Empfang.nachAbbruch(abbrueche)
    }
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
    ;

    companion object {
        /** Lage nach der [phase] und danach, ob der Dienst gerade wirklich ortet ([ortet]). */
        fun aus(phase: Phase, ortet: Boolean): Ortungslage = when {
            phase == Phase.Pausiert -> PAUSIERT
            phase is Phase.Ruht -> RUHT
            phase.ortet && ortet -> AN
            else -> AUS
        }
    }
}

/**
 * Typen des Helfer-Dienstes (ADR-0111): er startet beim Einlösen immer, mit `location` nur, wenn
 * die Phase orten lässt und das Standortrecht da ist; sonst allein mit `remoteMessaging`.
 */
enum class Dienstumfang {
    ORTUNG_UND_EMPFANG,
    NUR_EMPFANG,
    ;

    companion object {
        fun fuer(orten: Boolean, standortrecht: Boolean): Dienstumfang =
            if (orten && standortrecht) ORTUNG_UND_EMPFANG else NUR_EMPFANG
    }
}

/**
 * Ob der Dienst Aufträge empfängt: ab der Bestätigung (`aktiv`), solange die Kopplung besteht,
 * auch pausiert und ruhend (Pager-Empfänger im Entwurf).
 */
val Phase.empfaengt: Boolean
    get() = this == Phase.Aktiv || this == Phase.Pausiert || this is Phase.Ruht

/**
 * Text der einen Benachrichtigung des Helfer-Dienstes (Entwurf „Benachrichtigung des Dienstes“):
 * Ortung und Empfang, damit niemand sich für erreichbar hält, der es nicht ist.
 */
object Dienstanzeige {
    const val EMPFAENGT = "empfängt Aufträge"
    const val GETRENNT = "getrennt — verbinde neu"

    const val UNBESTAETIGT = "wartet auf Bestätigung"

    /** [bestaetigt] `false`: die Leitung hat noch nicht bestätigt, es gibt noch nichts zu empfangen. */
    fun zeile(ortung: Ortungslage, verbunden: Boolean, bestaetigt: Boolean = true): String {
        val empfang = when {
            !bestaetigt -> UNBESTAETIGT
            verbunden -> EMPFAENGT
            else -> GETRENNT
        }
        return "${ortung.text} · $empfang"
    }
}
