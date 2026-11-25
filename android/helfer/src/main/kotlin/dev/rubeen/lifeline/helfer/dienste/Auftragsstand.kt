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
            } else if (merke(a, jetzt)) {
                Mitteilungen.zeige(context, a)
            }
        }
    }

    /**
     * Prüft und merkt in einem Schritt, ob [a] eine Mitteilung bekommt: Dienst und Modell laden
     * gleichzeitig, sonst zeigten beide denselben Auftrag. Auch ohne Mitteilungsrecht gemerkt: sonst
     * kämen alte Aufträge nach dem Erlauben.
     */
    private fun merke(a: HelperTask, jetzt: Long): Boolean = synchronized(gemeldet) {
        if (!Auftraege.sollMitteilen(a, gemeldet, jetzt)) return@synchronized false
        gemeldet += a.id
        true
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
