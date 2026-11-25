/// Bildmarke „Lebenslinie“ (LFH-837) für die Helfer-App: dieselbe Geometrie wie
/// `frontend/src/marke/bildmarkeGeometrie.ts` und das App-Symbol (`scripts/marke/symbol.svg`).
/// `frontend/src/marke/marke.guard.test.ts` hält die Werte wörtlich gleich. Kein Kreuz: die Marke
/// ist die Pulslinie mit dem Quadrat in `marke`.
public enum Bildmarke {
    /// Punkte der Pulslinie im lokalen Raster (Grundlinie y = 0): `M0 0H86L136-110L198 110L248 0H324`.
    public static let linie: [(x: Double, y: Double)] = [
        (0, 0), (86, 0), (136, -110), (198, 110), (248, 0), (324, 0),
    ]
    public static let linienStaerke: Double = 54
    public static let gehrungsgrenze: Double = 10
    /// Das Quadrat in `marke`; die Linie endet stumpf an seiner linken Kante.
    public static let quadrat = (x: 324.0, y: -36.0, kante: 72.0)
    /// Kachel wie das App-Symbol: Kante 512, die Marke mittig um x = 198 (Spitze der Zacke).
    public static let kachel: Double = 512
    public static let mitteX: Double = 198
}
