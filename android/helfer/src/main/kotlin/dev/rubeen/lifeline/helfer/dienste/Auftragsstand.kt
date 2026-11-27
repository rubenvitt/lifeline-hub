package dev.rubeen.lifeline.helfer.dienste

import android.content.Context
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.HelperTask
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Aufträge dieser Kopplung und der Empfang, wie der Helfer-Dienst sie dem Modell meldet: nur im
 * Speicher des Prozesses (ADR-0111: Aufträge nie auf die Platte). Nach einem Ende des Prozesses ist
 * alles weg; die App lädt die Liste beim nächsten Öffnen neu.
 */
object Auftragsstand {
    /** Die Liste vom Server, geordnet (`Auftraege.ordnen`). */
    val liste = MutableStateFlow<List<HelperTask>>(emptyList())

    /** Ob die Live-Verbindung gerade steht. */
    val verbunden = MutableStateFlow(false)

    /** Aufträge, die schon eine Mitteilung bekamen (je Prozess, nur im Speicher). */
    val gemeldet: MutableSet<Long> = java.util.Collections.synchronizedSet(mutableSetOf())

    /** Die zuletzt gemeldete Stufe der Erinnerung je Auftrag (LLH-2157), unter `gemeldet` gesperrt. */
    private val stufen: MutableMap<Long, Int> = mutableMapOf()

    /** Die zuletzt gemeldete Stufe zu [auftragId] (0: erste Mitteilung). */
    fun erinnerungsstufe(auftragId: Long): Int = synchronized(gemeldet) { stufen[auftragId] ?: 0 }

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
        // Kommt die erste Mitteilung spät, zählen schon vergangene Stufen als gemeldet.
        stufen[a.id] = Auftraege.erinnerungsstufe(a, jetzt)
        true
    }

    /**
     * Erinnert an offene Aufträge, die schon eine Mitteilung bekamen, sobald der Kern eine neue
     * Stufe nennt ([Auftraege.erinnerungFaellig]); vom Dienst alle paar Sekunden gerufen.
     */
    fun erinnere(context: Context, jetzt: Long = System.currentTimeMillis()) {
        val faellig = synchronized(gemeldet) {
            liste.value.mapNotNull { a ->
                if (a.id !in gemeldet) return@mapNotNull null
                val stufe = Auftraege.erinnerungFaellig(a, stufen[a.id] ?: 0, jetzt) ?: return@mapNotNull null
                stufen[a.id] = stufe
                a to stufe
            }
        }
        for ((a, stufe) in faellig) Mitteilungen.zeige(context, a, erinnerung = stufe)
    }

    /** Ersetzt einen Auftrag nach der Quittung (Antwort des Servers). */
    fun ersetze(context: Context, a: HelperTask) {
        uebernimm(context, liste.value.filter { it.id != a.id } + a)
    }

    /** Nach dem Ende einer Kopplung: nichts von ihr bleibt stehen. */
    fun vergessen() {
        liste.value = emptyList()
        verbunden.value = false
        synchronized(gemeldet) {
            gemeldet.clear()
            stufen.clear()
        }
    }
}
