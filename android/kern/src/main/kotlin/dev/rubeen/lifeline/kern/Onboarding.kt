package dev.rubeen.lifeline.kern

/**
 * Ablauf des Onboardings als reine Zustandsfunktion (wie `Onboarding.swift`): Adresse eingeben
 * oder vorbelegen, prüfen, nur ein verträglicher Server wird gespeichert. Die App führt die
 * Wirkungen aus (`Check`: `GET /api/shell` und [Vertragspruefung], `Save`: Serverliste) und
 * meldet das Ergebnis als Ereignis zurück.
 */
object Onboarding {
    sealed interface State {
        /** Eingabefeld mit Text und gegebenenfalls der Meldung der Adressprüfung. */
        data class Eingabe(val text: String, val meldung: String?) : State

        /** `GET /api/shell` läuft. */
        data class Pruefung(val adresse: ServerAdresse) : State

        /** Gespeichert; die App lädt die Oberfläche. */
        data class Verbunden(val adresse: ServerAdresse, val info: ShellInfo) : State

        /** Nicht gespeichert; die native Seite zeigt die Fehlerklasse des Ergebnisses. */
        data class Abgelehnt(val adresse: ServerAdresse, val ergebnis: Vertragsergebnis) : State

        companion object {
            val START: State = Eingabe("", null)
        }
    }

    sealed interface Event {
        data class TextChanged(val text: String) : Event

        /** QR-Code oder Deeplink: die Adresse steht im Feld, geprüft wird erst nach „Verbinden“. */
        data class Vorbelegen(val adresse: ServerAdresse) : Event

        data object Verbinden : Event

        data object Zurueck : Event

        data class Ergebnis(val ergebnis: Vertragsergebnis, val fuer: ServerAdresse) : Event
    }

    sealed interface Effect {
        data class Check(val adresse: ServerAdresse) : Effect

        data class Save(val adresse: ServerAdresse, val info: ShellInfo) : Effect
    }

    data class Step(val state: State, val effect: Effect? = null)

    fun next(state: State, event: Event): Step {
        if (state is State.Verbunden) return Step(state)
        return when (event) {
            is Event.TextChanged ->
                if (state is State.Pruefung) Step(state) else Step(State.Eingabe(event.text, null))
            is Event.Vorbelegen ->
                if (state is State.Pruefung) Step(state) else Step(State.Eingabe(event.adresse.text, null))
            Event.Verbinden -> when (state) {
                is State.Eingabe -> try {
                    val adresse = ServerAdresse.parse(state.text)
                    Step(State.Pruefung(adresse), Effect.Check(adresse))
                } catch (e: AdressException) {
                    Step(State.Eingabe(state.text, e.error.meldung))
                }
                is State.Abgelehnt -> Step(State.Pruefung(state.adresse), Effect.Check(state.adresse))
                else -> Step(state)
            }
            Event.Zurueck -> when (state) {
                is State.Pruefung -> Step(State.Eingabe(state.adresse.text, null))
                is State.Abgelehnt -> Step(State.Eingabe(state.adresse.text, null))
                else -> Step(state)
            }
            is Event.Ergebnis ->
                if (state is State.Pruefung && event.fuer == state.adresse) {
                    val ergebnis = event.ergebnis
                    if (ergebnis is Vertragsergebnis.Vertraeglich) {
                        Step(State.Verbunden(state.adresse, ergebnis.info), Effect.Save(state.adresse, ergebnis.info))
                    } else {
                        Step(State.Abgelehnt(state.adresse, ergebnis))
                    }
                } else {
                    Step(state)
                }
        }
    }
}
