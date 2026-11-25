import HelferKern
import SwiftUI

// Bildmarke „Lebenslinie“ als Kachel, wie das App-Symbol: Kopf-Schwarz, Pulslinie, Quadrat in
// `marke`. Geometrie nur aus `HelferKern/Bildmarke.swift`. Gemeinsam mit der Widget-Erweiterung,
// darum aus Formen statt `Canvas`.

/// Die Pulslinie, skaliert auf eine quadratische Kachel.
private struct Lebenslinie: Shape {
    func path(in rect: CGRect) -> Path {
        var pfad = Path()
        for (index, punkt) in Bildmarke.linie.enumerated() {
            let p = Markenkachel.punkt(punkt.x, punkt.y, in: rect)
            if index == 0 { pfad.move(to: p) } else { pfad.addLine(to: p) }
        }
        return pfad
    }
}

/// Das Quadrat am Ende der Linie.
private struct Endquadrat: Shape {
    func path(in rect: CGRect) -> Path {
        let q = Bildmarke.quadrat
        let ecke = Markenkachel.punkt(q.x, q.y, in: rect)
        let kante = q.kante * Markenkachel.massstab(rect)
        return Path(CGRect(x: ecke.x, y: ecke.y, width: kante, height: kante))
    }
}

/// Bildmarke auf Kopf-Schwarz, eckig (Radius 0); reine Dekoration.
struct Markenkachel: View {
    var body: some View {
        GeometryReader { geo in
            let s = Markenkachel.massstab(CGRect(origin: .zero, size: geo.size))
            ZStack {
                Farbe.rahmenGrund
                Lebenslinie()
                    .stroke(
                        Farbe.rahmenText,
                        style: StrokeStyle(
                            lineWidth: Bildmarke.linienStaerke * s, lineCap: .butt,
                            lineJoin: .miter, miterLimit: Bildmarke.gehrungsgrenze))
                Endquadrat().fill(Farbe.marke)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    static func massstab(_ rect: CGRect) -> CGFloat {
        min(rect.width, rect.height) / Bildmarke.kachel
    }

    /// Punkt des lokalen Rasters in der Kachel: Marke mittig, Grundlinie auf halber Höhe.
    static func punkt(_ x: Double, _ y: Double, in rect: CGRect) -> CGPoint {
        let s = massstab(rect)
        return CGPoint(x: rect.midX + (x - Bildmarke.mitteX) * s, y: rect.midY + y * s)
    }
}
