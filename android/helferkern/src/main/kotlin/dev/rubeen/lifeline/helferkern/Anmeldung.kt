package dev.rubeen.lifeline.helferkern

/**
 * Phase der einen Anmeldung dieses Geräts (Spec „Die Helfer-App“, „Logik im Kern“):
 * `Start` → `Anmelden` → `Unbestaetigt` → `Aktiv` ⇄ `Pausiert` → `Beendet`.
 */
sealed interface Phase {
    /** Keine Anmeldung: Bildschirm „Start“ (scannen oder Code eingeben). */
    data object Start : Phase

    /** Einladung gelesen, noch nicht eingelöst: Bildschirm „Anmelden“. */
    data class Anmelden(val ziel: HelferZiel) : Phase

    /** Eingelöst, die Leitung hat noch nicht bestätigt (Wire `unbestaetigt`): Bildschirm „Wartet“. */
    data object Unbestaetigt : Phase

    /** Bestätigt: Bildschirm „Angemeldet“, die Ortung läuft. */
    data object Aktiv : Phase

    /** Die Kraft hat die Ortung pausiert. */
    data object Pausiert : Phase

    /** Die Anmeldung ist vorbei: Bildschirm „Beendet“ mit Grund. */
    data class Beendet(val grund: Grund) : Phase

    /** Ob der Ortungsdienst läuft: ab dem Einlösen, solange die Kopplung besteht und nicht pausiert ist (ADR-0098). */
    val ortet: Boolean
        get() = this is Unbestaetigt || this is Aktiv

    /** Ob eine Kopplung am Server besteht (eingelöst und nicht beendet). */
    val gekoppelt: Boolean
        get() = this is Unbestaetigt || this is Aktiv || this is Pausiert
}

/** Was der Anmeldung widerfährt; die App meldet es, der Automat entscheidet die neue Phase. */
sealed interface Ereignis {
    /** QR-Code gescannt, Deeplink geöffnet oder Code eingegeben. */
    data class Gescannt(val ziel: HelferZiel) : Ereignis

    /** `POST /api/devices/helpers/redeem` war erfolgreich. */
    data object Eingeloest : Ereignis

    /** Die Leitung hat bestätigt (Live-Ereignis). */
    data object Bestaetigt : Ereignis

    /** Antwort des Servers auf eine Sendung ([entscheide]). */
    data class Antwortet(val antwort: Antwort) : Ereignis

    /** Die Kraft hat pausiert. */
    data object Pausiert : Ereignis

    /** Die Kraft hat fortgesetzt (nur in der geöffneten App). */
    data object Fortgesetzt : Ereignis

    /** Die Kraft hat sich abgemeldet oder das Warten abgebrochen. */
    data object Abgemeldet : Ereignis

    /**
     * Eigener Zustand vom Server (`GET /api/devices/me` oder Live): [state] und [reason] als
     * Wire-Werte (`unbestaetigt`, `aktiv`, `abgelehnt`, `beendet`; [Grund.ausWire]).
     */
    data class Zustand(val state: String, val reason: String?) : Ereignis
}

/** Zustandsautomat der Anmeldung. Ein Ereignis, das in der Phase keinen Sinn hat, ändert nichts. */
class Anmeldung(phase: Phase = Phase.Start) {
    var phase: Phase = phase
        private set

    fun verarbeite(ereignis: Ereignis) {
        folge(ereignis, phase)?.let { phase = it }
    }

    /** Neue Phase oder `null`, wenn das Ereignis in dieser Phase nichts bewirkt. */
    private fun folge(ereignis: Ereignis, phase: Phase): Phase? = when {
        // Ein neuer Scan gilt nur ohne Kopplung; während einer Anmeldung fragt die App erst, ob die
        // alte beendet werden soll, und meldet dann `Abgemeldet`.
        ereignis is Ereignis.Gescannt && (phase is Phase.Start || phase is Phase.Anmelden || phase is Phase.Beendet) ->
            Phase.Anmelden(ereignis.ziel)
        ereignis is Ereignis.Eingeloest && phase is Phase.Anmelden -> Phase.Unbestaetigt
        ereignis is Ereignis.Bestaetigt && phase is Phase.Unbestaetigt -> Phase.Aktiv
        ereignis is Ereignis.Antwortet && phase.gekoppelt -> folgeAufAntwort(ereignis.antwort, phase)
        ereignis is Ereignis.Pausiert && phase is Phase.Aktiv -> Phase.Pausiert
        ereignis is Ereignis.Fortgesetzt && phase is Phase.Pausiert -> Phase.Aktiv
        ereignis is Ereignis.Abgemeldet && phase is Phase.Anmelden -> Phase.Start
        ereignis is Ereignis.Abgemeldet && phase.gekoppelt -> Phase.Beendet(Grund.ABGEMELDET)
        ereignis is Ereignis.Zustand -> folgeAufZustand(ereignis.state, ereignis.reason, phase)
        else -> null
    }

    private fun folgeAufAntwort(antwort: Antwort, phase: Phase): Phase? = when (antwort) {
        // Die Sitzung ist weg; den genauen Grund kennt das Gerät aus der Antwort nicht.
        Antwort.STOPPEN -> Phase.Beendet(Grund.ENTFERNT)
        // Die erste angenommene Position heißt: die Leitung hat bestätigt.
        Antwort.WEITER -> if (phase == Phase.Unbestaetigt) Phase.Aktiv else null
        Antwort.WARTEN, Antwort.WIEDERHOLEN, Antwort.VERWERFEN -> null
    }

    /**
     * Eigener Zustand vom Server. Vor dem Einlösen gibt es keinen; nach dem Ende bleibt es beim
     * Ende. Ein unbekannter Wert ändert nichts.
     */
    private fun folgeAufZustand(state: String, reason: String?, phase: Phase): Phase? {
        if (phase is Phase.Anmelden || phase is Phase.Beendet) return null
        return when (state) {
            "unbestaetigt" -> if (phase == Phase.Unbestaetigt) null else Phase.Unbestaetigt
            "aktiv" -> if (phase == Phase.Aktiv || phase == Phase.Pausiert) null else Phase.Aktiv
            "abgelehnt" -> Phase.Beendet(Grund.ABGELEHNT)
            "beendet" -> Phase.Beendet(reason?.let(Grund::ausWire) ?: Grund.ENTFERNT)
            else -> null
        }
    }
}
