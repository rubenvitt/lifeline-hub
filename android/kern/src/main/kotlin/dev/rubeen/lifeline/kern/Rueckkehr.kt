package dev.rubeen.lifeline.kern

/**
 * Erkennt die Rückkehr in den Vordergrund aus den Phasen der Activity: `ACTIVE` nach
 * `BACKGROUND`. Ein kurzes `INACTIVE` (Systemleiste, Dialog) zählt nicht.
 */
class Rueckkehr {
    enum class Phase { ACTIVE, INACTIVE, BACKGROUND }

    private var warImHintergrund = false

    /** `true`, wenn die App gerade aus dem Hintergrund zurückkehrt. */
    fun melde(phase: Phase): Boolean = when (phase) {
        Phase.BACKGROUND -> {
            warImHintergrund = true
            false
        }
        Phase.INACTIVE -> false
        Phase.ACTIVE -> warImHintergrund.also { warImHintergrund = false }
    }
}
