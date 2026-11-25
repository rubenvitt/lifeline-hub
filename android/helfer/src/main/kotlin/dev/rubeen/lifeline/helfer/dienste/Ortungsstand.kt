package dev.rubeen.lifeline.helfer.dienste

import dev.rubeen.lifeline.helferkern.Antwort
import java.time.Instant
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Was der [OrtungsDienst] dem Modell meldet, im Speicher des Prozesses (kein Verlauf, keine Datei).
 * Der Dienst läuft auch ohne geöffnete App; öffnet sie sich wieder, liest das Modell hier, ob er
 * läuft und wann die letzte Sendung ankam.
 */
object Ortungsstand {
    /** Ob der Dienst gerade ortet. */
    val laeuft = MutableStateFlow(false)

    /** Uhrzeit des Geräts, zu der die letzte Sendung angenommen wurde. */
    val letzteSendung = MutableStateFlow<Instant?>(null)

    /** Nächster Versuch nach einem Fehler; `null`, solange die Sendungen ankommen. */
    val naechsterVersuch = MutableStateFlow<Instant?>(null)

    /** Jede Entscheidung zu einer Antwort des Servers ([dev.rubeen.lifeline.helferkern.entscheide]). */
    val antworten = MutableSharedFlow<Antwort>(extraBufferCapacity = 16)

    /** Die Kraft hat in der Benachrichtigung pausiert; der Dienst hat es dem Server schon gemeldet. */
    val pausiert = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Nach dem Ende einer Kopplung: nichts von ihr bleibt stehen. */
    fun vergessen() {
        laeuft.value = false
        letzteSendung.value = null
        naechsterVersuch.value = null
    }
}
