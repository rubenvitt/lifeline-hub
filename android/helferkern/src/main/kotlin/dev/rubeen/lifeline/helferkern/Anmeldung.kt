package dev.rubeen.lifeline.helferkern

/**
 * Phase der einen Anmeldung dieses Geräts (Spec „Die Helfer-App“, „Logik im Kern“):
 * `Start` → `Anmelden` → `Unbestaetigt` → `Aktiv` ⇄ `Pausiert` → `Beendet`; `Aktiv` ⇄ `Ruht`,
 * solange die Kopplung besteht, aber nicht orten darf.
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

    /**
     * Bestätigt, aber ohne Ortung ([Ruhegrund]): Bildschirm „Angemeldet – Ortung ruht“. Der Dienst
     * ist aus, Kopplung und Sitzung bleiben; die App prüft alle [Ruhegrund.PRUEFABSTAND_S] Sekunden.
     */
    data class Ruht(val grund: Ruhegrund) : Phase

    /** Die Anmeldung ist vorbei: Bildschirm „Beendet“ mit Grund. */
    data class Beendet(val grund: Grund) : Phase

    /** Ob der Ortungsdienst läuft: ab dem Einlösen, solange die Kopplung besteht und nicht pausiert ist (ADR-0101). */
    val ortet: Boolean
        get() = this is Unbestaetigt || this is Aktiv

    /** Ob eine Kopplung am Server besteht (eingelöst und nicht beendet). */
    val gekoppelt: Boolean
        get() = this is Unbestaetigt || this is Aktiv || this is Pausiert || this is Ruht
}

/**
 * Was die Leitung dem Gerät beim Bestätigen gegeben hat (`is_tracker`, `person` aus
 * `GET /api/devices/me`): ohne beides sendet die App nichts (Entscheidung 7 der Spec).
 */
data class Rolle(val isTracker: Boolean, val personId: Long?) {
    val darfOrten: Boolean
        get() = isTracker || personId != null
}

/** Was der Anmeldung widerfährt; die App meldet es, der Automat entscheidet die neue Phase. */
sealed interface Ereignis {
    /** QR-Code gescannt, Deeplink geöffnet oder Code eingegeben. */
    data class Gescannt(val ziel: HelferZiel) : Ereignis

    /** `POST /api/devices/helpers/redeem` war erfolgreich. */
    data object Eingeloest : Ereignis

    /** Die Leitung hat bestätigt (Live-Ereignis). */
    data object Bestaetigt : Ereignis

    /** Antwort des Servers auf eine Sendung ([entscheide]) mit `reason` des Fehler-Bodys. */
    data class Antwortet(val antwort: Antwort, val grund: String? = null) : Ereignis

    /** Die Kraft hat pausiert. */
    data object Pausiert : Ereignis

    /** Die Kraft hat fortgesetzt (nur in der geöffneten App). */
    data object Fortgesetzt : Ereignis

    /** Die Kraft hat sich abgemeldet oder das Warten abgebrochen. */
    data object Abgemeldet : Ereignis

    /**
     * Eigener Zustand vom Server (`GET /api/devices/me` oder Live): [state] und [reason] als
     * Wire-Werte (`unbestaetigt`, `aktiv`, `abgelehnt`, `beendet`; [Grund.ausWire]) und die
     * [rolle] (`Zustand.rolle` in [Wire]).
     */
    data class Zustand(val state: String, val reason: String?, val rolle: Rolle) : Ereignis
}

/** Zustandsautomat der Anmeldung. Ein Ereignis, das in der Phase keinen Sinn hat, ändert nichts. */
class Anmeldung(phase: Phase = Phase.Start) {
    var phase: Phase = phase
        private set

    /** Zuletzt vom Server genannte Rolle. */
    private var rolle: Rolle? = null

    /**
     * Rolle, mit der [Ruhegrund.KEINE_ROLLE] gilt (beim Eintritt und jede spätere ohne Ortung):
     * erst eine andere Rolle, die orten darf, beendet die Ruhe. Sonst begänne die App bei einer
     * Person ohne Personenortung der Organisation nach jeder Abfrage neu zu senden und bekäme
     * wieder 403.
     */
    private var rolleBeimRuhen: Rolle? = null

    fun verarbeite(ereignis: Ereignis) {
        if (ereignis is Ereignis.Zustand) rolle = ereignis.rolle
        val vorher = phase
        folge(ereignis, vorher)?.let { phase = it }
        val ohneOrtung = ereignis is Ereignis.Zustand && !ereignis.rolle.darfOrten
        if (phase == Phase.Ruht(Ruhegrund.KEINE_ROLLE) && (vorher != phase || ohneOrtung)) rolleBeimRuhen = rolle
    }

    /** Neue Phase oder `null`, wenn das Ereignis in dieser Phase nichts bewirkt. */
    private fun folge(ereignis: Ereignis, phase: Phase): Phase? = when {
        // Ein neuer Scan gilt nur ohne Kopplung; während einer Anmeldung fragt die App erst, ob die
        // alte beendet werden soll, und meldet dann `Abgemeldet`.
        ereignis is Ereignis.Gescannt && (phase is Phase.Start || phase is Phase.Anmelden || phase is Phase.Beendet) ->
            Phase.Anmelden(ereignis.ziel)
        ereignis is Ereignis.Eingeloest && phase is Phase.Anmelden -> Phase.Unbestaetigt
        ereignis is Ereignis.Bestaetigt && phase is Phase.Unbestaetigt -> Phase.Aktiv
        ereignis is Ereignis.Antwortet && phase.gekoppelt -> folgeAufAntwort(ereignis.antwort, ereignis.grund, phase)
        ereignis is Ereignis.Pausiert && phase is Phase.Aktiv -> Phase.Pausiert
        ereignis is Ereignis.Fortgesetzt && phase is Phase.Pausiert -> Phase.Aktiv
        ereignis is Ereignis.Abgemeldet && phase is Phase.Anmelden -> Phase.Start
        ereignis is Ereignis.Abgemeldet && phase.gekoppelt -> Phase.Beendet(Grund.ABGEMELDET)
        ereignis is Ereignis.Zustand -> folgeAufZustand(ereignis.state, ereignis.reason, ereignis.rolle, phase)
        else -> null
    }

    private fun folgeAufAntwort(antwort: Antwort, grund: String?, phase: Phase): Phase? = when (antwort) {
        // Die Sitzung ist weg; den genauen Grund kennt das Gerät aus der Antwort nicht.
        Antwort.STOPPEN -> Phase.Beendet(Grund.ENTFERNT)
        // Die Kopplung bleibt; eine eigene Pause bleibt Pause.
        Antwort.RUHEN -> if (phase == Phase.Pausiert) null else Ruhegrund.ausWire(grund)?.let(Phase::Ruht)
        // Die erste angenommene Position heißt: die Leitung hat bestätigt. Aus der Ruhe heißt ein
        // angenommenes Fortsetzen: die Ortung ist wieder an.
        Antwort.WEITER -> if (phase == Phase.Unbestaetigt || phase is Phase.Ruht) Phase.Aktiv else null
        Antwort.WARTEN -> if (phase is Phase.Ruht) Phase.Unbestaetigt else null
        Antwort.WIEDERHOLEN, Antwort.VERWERFEN -> null
    }

    /**
     * Eigener Zustand vom Server. Vor dem Einlösen gibt es keinen; nach dem Ende bleibt es beim
     * Ende. Ein unbekannter Wert ändert nichts.
     *
     * `aktiv` ohne Rolle, die orten darf, ruht ([Ruhegrund.KEINE_ROLLE]). Aus der Ruhe
     * [Ruhegrund.ORTUNG_AUS] führt der Zustand nicht: er nennt die Einstellung der Organisation
     * nicht, das entscheidet die Antwort auf das Fortsetzen ([Ruhegrund.pruefeMitFortsetzen]).
     */
    private fun folgeAufZustand(state: String, reason: String?, rolle: Rolle, phase: Phase): Phase? {
        if (phase is Phase.Anmelden || phase is Phase.Beendet) return null
        val ortAus = phase == Phase.Ruht(Ruhegrund.ORTUNG_AUS)
        return when (state) {
            "unbestaetigt" -> if (phase == Phase.Unbestaetigt || ortAus) null else Phase.Unbestaetigt
            "aktiv" -> when {
                phase == Phase.Pausiert || ortAus -> null
                !rolle.darfOrten -> Phase.Ruht(Ruhegrund.KEINE_ROLLE)
                phase == Phase.Ruht(Ruhegrund.KEINE_ROLLE) -> if (rolle == rolleBeimRuhen) null else Phase.Aktiv
                phase == Phase.Aktiv -> null
                else -> Phase.Aktiv
            }
            "abgelehnt" -> Phase.Beendet(Grund.ABGELEHNT)
            "beendet" -> Phase.Beendet(reason?.let(Grund::ausWire) ?: Grund.ENTFERNT)
            else -> null
        }
    }
}
