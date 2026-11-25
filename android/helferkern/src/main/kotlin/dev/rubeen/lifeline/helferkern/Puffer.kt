package dev.rubeen.lifeline.helferkern

import java.time.Duration
import java.time.Instant

/**
 * Eine gemessene Position, wie sie an `PUT /api/devices/me/position` geht (`lat`, `lon`,
 * `accuracy_m`, `recorded_at`).
 */
data class Position(
    val latitude: Double,
    val longitude: Double,
    /** Genauigkeit in Metern, falls das System sie meldet. */
    val accuracy: Double? = null,
    /** Zeitpunkt der Messung am Gerät. */
    val recordedAt: Instant,
)

/**
 * Puffer ohne Netz (Spec „Senden, Takt, ohne Netz“): nur die **letzte** Position, nur im Speicher,
 * ohne Datei. Kommt das Netz zurück, geht sie raus, wenn sie jünger als 10 Minuten ist; sonst gilt
 * sie als verworfen. Einen Verlauf gibt es nicht.
 */
class Puffer {
    var letzte: Position? = null
        private set

    /** Merkt eine Position; eine ältere ersetzt die gemerkte nicht. */
    fun merke(p: Position) {
        val bisher = letzte
        if (bisher != null && bisher.recordedAt.isAfter(p.recordedAt)) return
        letzte = p
    }

    /** Die gemerkte Position, wenn sie jünger als 600 s ist, sonst `null`. */
    fun faellig(jetzt: Instant): Position? {
        val p = letzte ?: return null
        return p.takeIf { Duration.between(it.recordedAt, jetzt).toMillis() < HOECHSTALTER_S * 1000 }
    }

    /** Vergisst die gemerkte Position, etwa nach einer erfolgreichen Sendung oder einem 422. */
    fun leere() {
        letzte = null
    }

    companion object {
        /** Höchstes Alter einer gepufferten Position in Sekunden. */
        const val HOECHSTALTER_S: Long = 600
    }
}
