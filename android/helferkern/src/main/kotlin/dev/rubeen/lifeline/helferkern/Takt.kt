package dev.rubeen.lifeline.helferkern

/**
 * Wann der Ortungsdienst eine neue Position sendet (Spec „Senden, Takt, ohne Netz“; gemeinsame
 * Fälle `src-tauri/faelle/helfer.json`, Abschnitt `takt`): höchstens alle 30 s und nur bei einer
 * Bewegung über 25 m; ohne Bewegung ein Lebenszeichen nach 300 s, damit die Karte nicht „veraltet“
 * zeigt.
 */
data class Takt(
    val mindestabstandS: Double = 30.0,
    val bewegungM: Double = 25.0,
    val lebenszeichenS: Double = 300.0,
) {
    /**
     * Ob gesendet wird, [seitLetzterS] Sekunden nach der letzten Sendung und [bewegtM] Meter von
     * ihrer Position entfernt. Vor der ersten Sendung ruft die App mit `Double.POSITIVE_INFINITY` auf.
     */
    fun soll(seitLetzterS: Double, bewegtM: Double): Boolean =
        (seitLetzterS >= mindestabstandS && bewegtM > bewegungM) || seitLetzterS >= lebenszeichenS
}
