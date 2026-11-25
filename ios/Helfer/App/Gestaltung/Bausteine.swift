import HelferKern
import SwiftUI

// Bausteine der Seiten im Lifeline Design System: eckige Flächen (Radius 0 aus den Tokens),
// feine Linien, Augenbrauen in Großbuchstaben, Werte in gleich breiten Ziffern. Ab iOS 26 tragen
// Knöpfe das Systemaussehen (Liquid Glass), davor flache Flächen in den Rollenfarben.

/// Eckige Form der Tokens (`radiusFlaeche`, `radiusSteuer`).
var eckig: RoundedRectangle {
    RoundedRectangle(cornerRadius: LifelineRadius.radiusSteuer, style: .continuous)
}

/// Rolle eines Knopfs: Farbe nach der Bedeutung.
enum Knopfrolle {
    case bedien, normal, alarm, neutral

    var fuellung: Color {
        switch self {
        case .bedien: Farbe.bedien
        case .normal: Farbe.normal
        case .alarm: Farbe.alarm
        case .neutral: Farbe.flaeche2
        }
    }

    var schrift: Color {
        switch self {
        case .bedien, .normal, .alarm: Farbe.aufBedien
        case .neutral: Farbe.text
        }
    }
}

/// Großer Hauptknopf über die ganze Breite, mindestens so hoch wie die Steuerhöhe „Handschuh“
/// der Tokens wäre zu viel für eine Hand; hier die Komfort-Höhe plus Luft.
struct Hauptknopfstil: ButtonStyle {
    var rolle: Knopfrolle = .bedien
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .schrift(Stil.kartentitel, relativeTo: .headline)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: LifelineGroesse.steuerhoeheKomfortabel + 12)
            .padding(.horizontal, LifelineAbstand.abstandKomfortabelMd)
            .foregroundStyle(rolle.schrift)
            .hintergrund(rolle: rolle, gedrueckt: configuration.isPressed)
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(eckig)
    }
}

/// Zweiter Knopf: nur Linie, für „Abmelden“, „Abbrechen“ und „Code eingeben“.
struct Nebenknopfstil: ButtonStyle {
    var farbe: Color = Farbe.text
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .schrift(Stil.kartentitel, relativeTo: .headline)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: LifelineGroesse.steuerhoeheKomfortabel + 4)
            .padding(.horizontal, LifelineAbstand.abstandKomfortabelMd)
            .foregroundStyle(farbe)
            .background(configuration.isPressed ? Farbe.flaeche2 : Color.clear, in: eckig)
            .overlay(eckig.strokeBorder(Farbe.linieStark, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(eckig)
    }
}

extension View {
    /// Fläche eines Hauptknopfs: ab iOS 26 Liquid Glass in der Rollenfarbe, davor flach.
    @ViewBuilder
    fileprivate func hintergrund(rolle: Knopfrolle, gedrueckt: Bool) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.tint(rolle.fuellung).interactive(), in: eckig)
        } else {
            self.background(rolle.fuellung.opacity(gedrueckt ? 0.8 : 1), in: eckig)
        }
    }

    /// Karte: Fläche mit feiner Linie; ab iOS 26 als Glas über dem Raster.
    @ViewBuilder
    func karte() -> some View {
        let innen = self.padding(LifelineAbstand.abstandKomfortabelMd)
            .frame(maxWidth: .infinity, alignment: .leading)
        if #available(iOS 26.0, *) {
            innen.glassEffect(.regular.tint(Farbe.flaeche.opacity(0.6)), in: eckig)
                .overlay(eckig.strokeBorder(Farbe.linie, lineWidth: 1))
        } else {
            innen.background(Farbe.flaeche, in: eckig)
                .overlay(eckig.strokeBorder(Farbe.linie, lineWidth: 1))
        }
    }

    /// Grund jeder Seite: Grundfarbe mit dem feinen Raster des Design Systems.
    func seitengrund() -> some View {
        background { Raster().ignoresSafeArea() }
    }
}

/// Feines Raster aus `rolleRasterLinie` auf der Grundfarbe.
struct Raster: View {
    var weite: CGFloat = 24

    var body: some View {
        Canvas { kontext, groesse in
            var pfad = Path()
            var x: CGFloat = 0
            while x <= groesse.width {
                pfad.move(to: CGPoint(x: x, y: 0))
                pfad.addLine(to: CGPoint(x: x, y: groesse.height))
                x += weite
            }
            var y: CGFloat = 0
            while y <= groesse.height {
                pfad.move(to: CGPoint(x: 0, y: y))
                pfad.addLine(to: CGPoint(x: groesse.width, y: y))
                y += weite
            }
            kontext.stroke(pfad, with: .color(Farbe.raster), lineWidth: 1)
        }
        .background(Farbe.grund)
        .accessibilityHidden(true)
    }
}

/// Augenbraue: kleine Großbuchstaben über einem Abschnitt.
struct Augenbraue: View {
    let text: String
    var farbe: Color = Farbe.gedaempft

    init(_ text: String, farbe: Color = Farbe.gedaempft) {
        self.text = text
        self.farbe = farbe
    }

    var body: some View {
        Text(text.uppercased())
            .schrift(Stil.augenbraue, relativeTo: .caption)
            .tracking(1.2)
            .foregroundStyle(farbe)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Zeile „Bezeichnung — Wert“ in einer Karte.
struct Wertzeile: View {
    let bezeichnung: String
    let wert: String
    var symbol: String?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                beschriftung
                Spacer(minLength: LifelineAbstand.abstandKomfortabelSm)
                wertText.multilineTextAlignment(.trailing)
            }
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelXs) {
                beschriftung
                wertText
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var beschriftung: some View {
        Label {
            Text(bezeichnung).schrift(Stil.klein, relativeTo: .subheadline)
        } icon: {
            if let symbol { Image(systemName: symbol) }
        }
        .foregroundStyle(Farbe.gedaempft)
    }

    private var wertText: some View {
        Text(wert)
            .schrift(Stil.text, relativeTo: .body)
            .foregroundStyle(Farbe.text)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Markenzeichen: rotes Quadrat mit Kreuz (Rolle `marke`).
struct Markenzeichen: View {
    @ScaledMetric(relativeTo: .title) private var groesse: CGFloat = 40

    var body: some View {
        Image(systemName: "cross.fill")
            .font(.system(size: groesse * 0.5, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: groesse, height: groesse)
            .background(Farbe.marke, in: eckig)
            .accessibilityHidden(true)
    }
}

/// Kopf jeder Seite: Markenzeichen, App-Name und optional der Server.
struct Seitenkopf: View {
    var untertitel: String?

    var body: some View {
        HStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
            Markenzeichen()
            VStack(alignment: .leading, spacing: 0) {
                Text("Lifeline Helfer")
                    .schrift(Stil.kartentitel, relativeTo: .headline)
                    .foregroundStyle(Farbe.text)
                if let untertitel, !untertitel.isEmpty {
                    Text(untertitel)
                        .schrift(Stil.klein, relativeTo: .subheadline)
                        .foregroundStyle(Farbe.gedaempft)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Pulsierender Punkt für „Ortung an“ und „wartet“; ruhig, ohne Bewegung bei reduzierter
/// Bewegung.
struct Statuspunkt: View {
    let farbe: Color
    var pulsiert = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var aussen = false
    @ScaledMetric(relativeTo: .title) private var groesse: CGFloat = 14

    var body: some View {
        ZStack {
            if pulsiert && !reduceMotion {
                Circle()
                    .fill(farbe.opacity(0.35))
                    .frame(width: groesse * 2.6, height: groesse * 2.6)
                    .scaleEffect(aussen ? 1 : 0.4)
                    .opacity(aussen ? 0 : 1)
            }
            Circle().fill(farbe).frame(width: groesse, height: groesse)
        }
        .frame(width: groesse * 2.6, height: groesse * 2.6)
        .onAppear {
            guard pulsiert, !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) {
                aussen = true
            }
        }
        .accessibilityHidden(true)
    }
}

/// Meldung unter einem Formular (Fehler oder Hinweis).
struct Hinweis: View {
    let text: String
    var symbol = "exclamationmark.triangle.fill"
    var farbe: Color = Farbe.achtungText
    var flaeche: Color = Farbe.achtungFlaeche

    var body: some View {
        Label {
            Text(text)
                .schrift(Stil.klein, relativeTo: .subheadline)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol)
        }
        .foregroundStyle(farbe)
        .padding(LifelineAbstand.abstandKomfortabelSm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(flaeche, in: eckig)
        .overlay(alignment: .leading) { Rectangle().fill(farbe).frame(width: 3) }
        .accessibilityIdentifier("hinweis")
    }
}

/// Inhalt einer Seite: scrollbar, damit große Schrift (bis AX3) nichts abschneidet.
struct Seite<Inhalt: View>: View {
    @ViewBuilder let inhalt: Inhalt

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelLg) {
                inhalt
            }
            .padding(.horizontal, LifelineAbstand.seitenrinneBreit)
            .padding(.vertical, LifelineAbstand.abstandKomfortabelLg)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .seitengrund()
    }
}

/// Relatives Alter einer Sendung („vor 12 s“), jede Sekunde neu.
struct Alter: View {
    let seit: Date?

    var body: some View {
        if let seit {
            TimelineView(.periodic(from: .now, by: 1)) { kontext in
                Text(Self.text(seit, jetzt: kontext.date))
                    .monospacedDigit()
            }
        } else {
            Text("noch keine")
        }
    }

    static func text(_ seit: Date, jetzt: Date) -> String {
        let sekunden = max(0, Int(jetzt.timeIntervalSince(seit)))
        switch sekunden {
        case ..<60: return "vor \(sekunden) s"
        case ..<3600: return "vor \(sekunden / 60) min"
        default: return "vor \(sekunden / 3600) h"
        }
    }
}
