package dev.rubeen.lifeline.helferkern

/**
 * Bildmarke „Lebenslinie“ (LFH-837) für die Helfer-App: dieselbe Geometrie wie
 * `frontend/src/marke/bildmarkeGeometrie.ts` und das App-Symbol (`scripts/marke/symbol.svg`).
 * `frontend/src/marke/marke.guard.test.ts` hält die Werte wörtlich gleich. Kein Kreuz: die Marke
 * ist die Pulslinie mit dem Quadrat in `marke`.
 */
object Bildmarke {
    /** Punkte der Pulslinie im lokalen Raster (Grundlinie y = 0): `M0 0H86L136-110L198 110L248 0H324`. */
    val linie: List<Pair<Float, Float>> = listOf(
        0f to 0f, 86f to 0f, 136f to -110f, 198f to 110f, 248f to 0f, 324f to 0f,
    )
    const val LINIEN_STAERKE = 54f
    const val GEHRUNGSGRENZE = 10f

    /** Das Quadrat in `marke`; die Linie endet stumpf an seiner linken Kante. */
    const val QUADRAT_X = 324f
    const val QUADRAT_Y = -36f
    const val QUADRAT_KANTE = 72f

    /** Kachel wie das App-Symbol: Kante 512, die Marke mittig um x = 198 (Spitze der Zacke). */
    const val KACHEL = 512f
    const val MITTE_X = 198f
}
