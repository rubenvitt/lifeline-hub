package dev.rubeen.lifeline.helfer.dienste

import android.content.Context
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.HelperTask
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Aufträge dieser Kopplung und der Empfang, wie der Helfer-Dienst sie dem Modell meldet: nur im
 * Speicher des Prozesses (ADR-0105: Aufträge nie auf die Platte). Nach einem Ende des Prozesses ist
 * alles weg; die App lädt die Liste beim nächsten Öffnen neu.
 */
object Auftragsstand {
    /** Die Liste vom Server, geordnet (`Auftraege.ordnen`). */
    val liste = MutableStateFlow<List<HelperTask>>(emptyList())

    /** Ob die Live-Verbindung gerade steht. */
    val verbunden = MutableStateFlow(false)

    /** Aufträge, die schon eine Mitteilung bekamen (je Prozess, nur im Speicher). */
    val gemeldet: MutableSet<Long> = java.util.Collections.synchronizedSet(mutableSetOf())

    /**
     * Übernimmt eine frisch geladene Liste: geordnet, Mitteilungen für die neuen, offenen, jungen
     * Aufträge ([Auftraege.sollMitteilen]), Mitteilungen erledigter Aufträge weg. Von Dienst und
     * Modell gerufen, von jedem Faden.
     */
    fun uebernimm(context: Context, neu: List<HelperTask>) {
        val geordnet = Auftraege.ordnen(neu)
        liste.value = geordnet
        val jetzt = System.currentTimeMillis()
        for (a in geordnet) {
            if (!a.isOffen) {
                Mitteilungen.entferne(context, a.id)
            } else if (Auftraege.sollMitteilen(a, synchronized(gemeldet) { gemeldet.toSet() }, jetzt)) {
                // Auch ohne Mitteilungsrecht gemeldet: sonst kämen alte Aufträge nach dem Erlauben.
                gemeldet += a.id
                Mitteilungen.zeige(context, a)
            }
        }
    }

    /** Ersetzt einen Auftrag nach der Quittung (Antwort des Servers). */
    fun ersetze(context: Context, a: HelperTask) {
        uebernimm(context, liste.value.filter { it.id != a.id } + a)
    }

    /** Nach dem Ende einer Kopplung: nichts von ihr bleibt stehen. */
    fun vergessen() {
        liste.value = emptyList()
        verbunden.value = false
        gemeldet.clear()
    }
}
