package dev.rubeen.lifeline.helferkern

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Was der Live-Strom `GET /api/incidents/{id}/live` der Helfer-App sagt (ADR-0104; gemeinsame
 * Fälle `src-tauri/faelle/helfer-auftrag.json`, Abschnitt `sse`).
 */
sealed interface LiveEreignis {
    /** `event: helfer_auftrag` mit `data: {"task_id": n}`: neuer, geänderter oder quittierter Auftrag. */
    data class Auftrag(val taskId: Long) : LiveEreignis

    /** `event: heartbeat`: die Verbindung lebt. */
    data object Lebenszeichen : LiveEreignis

    /** Ein anderes Ereignis oder kaputte Daten: übergehen. */
    data object Unbekannt : LiveEreignis
}

/**
 * Liest den Live-Strom Zeile für Zeile (Server-Sent Events): ein Rahmen endet mit einer Leerzeile;
 * `data`-Zeilen eines Rahmens werden mit Zeilenumbruch verbunden, ein `\r` am Zeilenende fällt weg
 * (CRLF). Kommentare (`:` am Anfang) und Rahmen ohne `event` und ohne `data` (etwa nur `retry`)
 * ergeben nichts. Ein Leser gehört zu einer Verbindung; nach einem Abbruch [zuruecksetzen].
 */
class SseLeser {
    private var event: String? = null
    private val daten = StringBuilder()
    private var hatDaten = false

    /** Eine Zeile ohne Zeilenende (wie `BufferedReader.readLine`); ein Ereignis am Ende eines Rahmens. */
    fun zeile(z: String): LiveEreignis? {
        val zeile = z.removeSuffix("\r")
        if (zeile.isEmpty()) return rahmenEnde()
        if (zeile.startsWith(":")) return null
        val doppelpunkt = zeile.indexOf(':')
        val feld = if (doppelpunkt < 0) zeile else zeile.substring(0, doppelpunkt)
        val wert = if (doppelpunkt < 0) "" else zeile.substring(doppelpunkt + 1).removePrefix(" ")
        when (feld) {
            "event" -> event = wert
            "data" -> {
                if (hatDaten) daten.append('\n')
                daten.append(wert)
                hatDaten = true
            }
            // `id`, `retry` und Unbekanntes braucht die App nicht.
            else -> Unit
        }
        return null
    }

    /**
     * Ein ganzer Text, etwa aus den gemeinsamen Fällen: jede mit `\n` beendete Zeile geht an
     * [zeile]; ein Rest ohne Zeilenende ist eine abgeschnittene Zeile und ergibt nichts.
     */
    fun text(t: String): List<LiveEreignis> = t.split('\n').dropLast(1).mapNotNull(::zeile)

    /** Vergisst einen angefangenen Rahmen (neue Verbindung). */
    fun zuruecksetzen() {
        event = null
        daten.setLength(0)
        hatDaten = false
    }

    private fun rahmenEnde(): LiveEreignis? {
        val name = event
        val inhalt = daten.toString()
        val mitDaten = hatDaten
        zuruecksetzen()
        if (name == null && !mitDaten) return null
        return when (name) {
            EREIGNIS_AUFTRAG -> auftrag(inhalt) ?: LiveEreignis.Unbekannt
            EREIGNIS_LEBENSZEICHEN -> LiveEreignis.Lebenszeichen
            else -> LiveEreignis.Unbekannt
        }
    }

    private fun auftrag(inhalt: String): LiveEreignis.Auftrag? = try {
        val objekt = json.parseToJsonElement(inhalt) as? JsonObject
        objekt?.get("task_id")?.jsonPrimitive?.longOrNull?.let { LiveEreignis.Auftrag(it) }
    } catch (_: IllegalArgumentException) {
        // Auch `SerializationException` (kaputtes JSON) und ein `task_id`, das kein Wert ist.
        null
    }

    companion object {
        /** Wire-Namen des Servers (src/routes/live.rs, `helfer_auftraege`; `strom::mit_heartbeat`). */
        const val EREIGNIS_AUFTRAG = "helfer_auftrag"
        const val EREIGNIS_LEBENSZEICHEN = "heartbeat"

        private val json = Json
    }
}
