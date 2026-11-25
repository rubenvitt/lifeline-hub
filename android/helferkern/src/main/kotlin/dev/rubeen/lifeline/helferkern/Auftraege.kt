package dev.rubeen.lifeline.helferkern

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Stand einer eigenen Empfängerzeile, wie die App ihn zeigt. */
sealed interface Quittungsstand {
    /** Noch nicht übernommen: Knopf „Übernommen“. */
    data object Offen : Quittungsstand

    /** Übernommen um [um] (Serverzeit, UTC) von [von] (Anzeigename), auch von einem anderen Helfer. */
    data class Quittiert(val um: String, val von: String?) : Quittungsstand

    /** Die Leitung hat den Auftrag aufgehoben: durchgestrichen, kein Knopf. Geht jeder Quittung vor. */
    data object Aufgehoben : Quittungsstand
}

/**
 * Entscheidungen zur Auftragsliste der Helfer-App (ADR-0105; gemeinsame Fälle
 * `src-tauri/faelle/helfer-auftrag.json`, Abschnitte `ordnung`, `mitteilung`, `quittungsstand`).
 */
object Auftraege {
    /** Eine Mitteilung bekommt nur ein Auftrag, der höchstens so alt ist (Entwurf: „jünger als 10 Minuten“). */
    const val MITTEILUNG_FENSTER_MS = 10 * 60 * 1_000L

    /** Offen vor quittiert vor aufgehoben, in jeder Gruppe der neueste zuerst. */
    fun ordnen(l: List<HelperTask>): List<HelperTask> =
        l.sortedWith(
            compareBy<HelperTask> { gruppe(it) }
                .thenByDescending { Wire.serverzeit(it.issuedAt) ?: Instant.MIN }
                .thenByDescending { it.id },
        )

    /**
     * Ob die App für [a] eine Mitteilung zeigt: offen, nicht aufgehoben, noch nicht gemeldet und
     * erteilt höchstens [MITTEILUNG_FENSTER_MS] vor [jetztMs]. Ein älterer Auftrag (verpasst
     * während einer Unterbrechung) steht nur in der Liste.
     */
    fun sollMitteilen(a: HelperTask, bereitsGemeldet: Set<Long>, jetztMs: Long): Boolean {
        if (!a.isOffen || a.id in bereitsGemeldet) return false
        val erteilt = Wire.serverzeit(a.issuedAt) ?: return false
        return jetztMs - erteilt.toEpochMilli() <= MITTEILUNG_FENSTER_MS
    }

    /** Stand einer Empfängerzeile, ohne Angabe der ersten des Auftrags; aufgehoben geht vor. */
    fun stand(a: HelperTask, empfaenger: HelperTaskRecipient? = a.recipients.firstOrNull()): Quittungsstand {
        if (a.isAufgehoben) return Quittungsstand.Aufgehoben
        val um = empfaenger?.acknowledgedAt ?: return Quittungsstand.Offen
        return Quittungsstand.Quittiert(um, empfaenger.acknowledgedBy)
    }

    /** Zahl der offenen Aufträge (Kopf des Bereichs „Aufträge“). */
    fun offen(l: List<HelperTask>): Int = l.count { it.isOffen }

    /**
     * Text nach der Quittung: „Übernommen um 14:32“, oder mit Namen, wenn ein anderer schneller war
     * ([eigenerName] ist der Anzeigename dieses Geräts); `null`, solange offen oder aufgehoben.
     */
    fun quittungstext(stand: Quittungsstand, eigenerName: String?, zone: ZoneId): String? {
        val q = stand as? Quittungsstand.Quittiert ?: return null
        val uhr = uhrzeit(q.um, zone) ?: q.um
        val von = q.von
        return if (von.isNullOrBlank() || von == eigenerName) "Übernommen um $uhr" else "Übernommen von $von um $uhr"
    }

    /** Serverzeit als Uhrzeit `HH:mm` in [zone]; `null`, wenn unlesbar. */
    fun uhrzeit(serverzeit: String, zone: ZoneId): String? =
        Wire.serverzeit(serverzeit)?.atZone(zone)?.format(UHRZEIT)

    /** Empfänger als Text: „an dich“ für die Person, sonst die Anzeige der Einheit oder des Fahrzeugs. */
    fun empfaengertext(r: HelperTaskRecipient): String = if (r.kind == "person") "an dich" else r.label

    /** Priorität als Text der Oberfläche. */
    fun prioritaet(wert: String): String = when (wert) {
        "sofort" -> "Sofort"
        "dringend" -> "Dringend"
        else -> "Normal"
    }

    private fun gruppe(a: HelperTask): Int = when (stand(a)) {
        Quittungsstand.Offen -> 0
        is Quittungsstand.Quittiert -> if (a.isOffen) 0 else 1
        Quittungsstand.Aufgehoben -> 2
    }

    private val UHRZEIT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    // Feste Texte (Entwurf „Oberfläche der App“; gleich wie in `ios/Helfer/App`).
    const val UEBERNEHMEN = "Übernommen"
    const val LEER = "Keine Aufträge. Neue Aufträge kommen als Mitteilung."
    const val MITTEILUNGEN_AUS = "Mitteilungen aus — du bekommst Aufträge nur bei offener App"
    const val QUITTUNG_FEHLGESCHLAGEN = "Bitte über Funk bestätigen"
    const val AUFGEHOBEN = "aufgehoben"
    const val MITTEILUNG_OEFFENTLICH = "Neuer Auftrag"
    const val KANAL = "Aufträge"
}
