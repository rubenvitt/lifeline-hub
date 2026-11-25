package dev.rubeen.lifeline.helferkern

/**
 * Was der Ortungsdienst auf die Antwort des Servers auf eine Sendung tut (Spec „Ablauf“, Schritt 6;
 * gemeinsame Fälle `src-tauri/faelle/helfer.json`, Abschnitt `antwort`). Die [kennwort]e sind die
 * der Fälle.
 */
enum class Antwort(val kennwort: String) {
    /** Gesendet: weiter im Takt. */
    WEITER("weiter"),

    /** Netzfehler, 408, 429 oder 5xx: die letzte Position behalten und später erneut senden. */
    WIEDERHOLEN("wiederholen"),

    /** Inhalt unbrauchbar (422, auch jeder andere 4xx): diese eine Position verwerfen. */
    VERWERFEN("verwerfen"),

    /** Kopplung noch unbestätigt (409): der Dienst läuft weiter, der Server speichert nichts. */
    WARTEN("warten"),

    /** Sitzung weg, nicht berechtigt oder Kopplung weg (401, 403, 404): der Dienst stoppt. */
    STOPPEN("stoppen"),
}

/**
 * Entscheidung je HTTP-Status; `0` steht für einen Netzfehler ohne Antwort.
 *
 * Nur 401, 403 und 404 stoppen den Dienst, damit ein Neustart des Servers nicht die Ortung aller
 * Helfer stilllegt. Ein anderer 4xx außer 408 und 429 ist ein Fehler dieser Sendung und wird wie
 * 422 verworfen.
 */
fun entscheide(status: Int): Antwort = when (status) {
    in 200..299 -> Antwort.WEITER
    409 -> Antwort.WARTEN
    401, 403, 404 -> Antwort.STOPPEN
    408, 429 -> Antwort.WIEDERHOLEN
    in 400..499 -> Antwort.VERWERFEN
    else -> Antwort.WIEDERHOLEN
}

/**
 * Abstand bis zur nächsten Wiederholung nach Fehlern in Folge (ADR-0098: wachsender Abstand,
 * höchstens jede Minute): 5, 10, 20, 40, 60, 60, … Sekunden. Ein `weiter` setzt zurück.
 */
class Wiederholung {
    private var fehlerInFolge = 0

    /** Abstand in Sekunden nach dem nächsten Fehler; zählt den Fehler mit. */
    fun naechsterAbstandS(): Int {
        val abstand = ANFANG_S shl minOf(fehlerInFolge, MAX_SCHRITTE)
        if (fehlerInFolge < MAX_SCHRITTE) fehlerInFolge += 1
        return minOf(abstand, OBERGRENZE_S)
    }

    /** Nach einer erfolgreichen Sendung beginnt der Abstand wieder bei 5 Sekunden. */
    fun zuruecksetzen() {
        fehlerInFolge = 0
    }

    private companion object {
        const val ANFANG_S = 5
        const val OBERGRENZE_S = 60

        /** 5 · 2^4 = 80 liegt schon über der Obergrenze; mehr Schritte zählt niemand. */
        const val MAX_SCHRITTE = 4
    }
}
