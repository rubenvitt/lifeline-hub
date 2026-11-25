import HelferKern
import SwiftUI
import UIKit

// Farben und Schrift der Helfer-App aus den erzeugten Tokens (`HelferKern/Tokens.swift`, Generator
// scripts/design/tokens-nativ.mjs; nie Werte von Hand). Gemeinsam mit der Widget-Erweiterung.

extension UIColor {
    /// Farbe aus einem ARGB-Wert `0xAARRGGBB` der Tokens.
    convenience init(argb: UInt32) {
        self.init(
            red: CGFloat((argb >> 16) & 0xFF) / 255,
            green: CGFloat((argb >> 8) & 0xFF) / 255,
            blue: CGFloat(argb & 0xFF) / 255,
            alpha: CGFloat((argb >> 24) & 0xFF) / 255)
    }
}

extension Color {
    /// Ein Farbpaar der Tokens: `tag` im hellen, `nacht` im dunklen und unbestimmten Aussehen. Das
    /// Thema „Nacht“ ist die Vorgabe; die App folgt dem System.
    init(_ paar: Paar) {
        let tag = paar.tag
        let nacht = paar.nacht
        self.init(
            uiColor: UIColor { merkmale in
                UIColor(argb: merkmale.userInterfaceStyle == .light ? tag : nacht)
            })
    }
}

/// Die Rollenfarben, die die Helfer-App nutzt.
enum Farbe {
    static let grund = Color(LifelineFarbe.rolleGrund)
    static let flaeche = Color(LifelineFarbe.rolleFlaeche)
    static let flaeche2 = Color(LifelineFarbe.rolleFlaeche2)
    static let linie = Color(LifelineFarbe.rolleLinie)
    static let linieStark = Color(LifelineFarbe.rolleLinieStark)
    static let raster = Color(LifelineFarbe.rolleRasterLinie)
    static let text = Color(LifelineFarbe.rolleText)
    static let text2 = Color(LifelineFarbe.rolleText2)
    static let gedaempft = Color(LifelineFarbe.rolleGedaempft)
    static let bedien = Color(LifelineFarbe.rolleBedien)
    static let bedienText = Color(LifelineFarbe.rolleBedienText)
    static let aufBedien = Color(LifelineFarbe.rolleAufBedien)
    static let bedienFlaeche = Color(LifelineFarbe.rolleBedienFlaeche)
    static let normal = Color(LifelineFarbe.rolleNormal)
    static let normalText = Color(LifelineFarbe.rolleNormalText)
    static let normalFlaeche = Color(LifelineFarbe.rolleNormalFlaeche)
    static let achtung = Color(LifelineFarbe.rolleAchtung)
    static let achtungText = Color(LifelineFarbe.rolleAchtungText)
    static let achtungFlaeche = Color(LifelineFarbe.rolleAchtungFlaeche)
    static let alarm = Color(LifelineFarbe.rolleAlarm)
    static let alarmText = Color(LifelineFarbe.rolleAlarmText)
    static let alarmFlaeche = Color(LifelineFarbe.rolleAlarmFlaeche)
    static let marke = Color(LifelineFarbe.rolleMarke)
    /// Kopf-Schwarz und Linie der Bildmarke: immer dunkel, wie das App-Symbol.
    static let rahmenGrund = Color(LifelineFarbe.rahmenGrund)
    static let rahmenText = Color(LifelineFarbe.rahmenText)
}

/// Schriftstile der Helfer-App: die Familien der Tokens, Größen für eine App mit einer Aufgabe und
/// großer Schrift. Die Skala der Tokens ist für dichte Arbeitsplätze gedacht; hier gelten die
/// Familien und Gewichte, die Größen sind größer.
enum Stil {
    /// Große Zustandszeile („Ortung an“), schmale Display-Schrift.
    static let zustand = Schriftstil(
        familie: LifelineSchrift.familieDisplay, groesse: 44, zeilenhoehe: 1.05, gewicht: 600)
    /// Überschrift einer Seite.
    static let titel = Schriftstil(
        familie: LifelineSchrift.familieDisplay, groesse: 32, zeilenhoehe: 1.1,
        gewicht: LifelineSchrift.ueberschrift.gewicht)
    /// Titel einer Karte oder eines Knopfs.
    static let kartentitel = Schriftstil(
        familie: LifelineSchrift.familieText, groesse: 19, zeilenhoehe: 1.3,
        gewicht: LifelineSchrift.kartentitel.gewicht)
    /// Fließtext.
    static let text = Schriftstil(
        familie: LifelineSchrift.familieText, groesse: 17, zeilenhoehe: 1.4,
        gewicht: LifelineSchrift.text.gewicht)
    /// Kleiner Text unter einem Wert.
    static let klein = Schriftstil(
        familie: LifelineSchrift.familieText, groesse: 14, zeilenhoehe: 1.4,
        gewicht: LifelineSchrift.textKlein.gewicht)
    /// Augenbraue: Großbuchstaben über einem Abschnitt.
    static let augenbraue = Schriftstil(
        familie: LifelineSchrift.familieText, groesse: 13, zeilenhoehe: 1.3,
        gewicht: LifelineSchrift.augenbraue.gewicht)
    /// Werte (Zeit, Code), Ziffern gleich breit.
    static let wert = Schriftstil(
        familie: LifelineSchrift.familieZahl, groesse: 17, zeilenhoehe: 1.3,
        gewicht: LifelineSchrift.datenwert.gewicht)
}

extension Font.Weight {
    /// Gewicht aus dem CSS-Wert der Tokens.
    init(css: Int) {
        switch css {
        case ..<350: self = .light
        case ..<450: self = .regular
        case ..<550: self = .medium
        case ..<650: self = .semibold
        default: self = .bold
        }
    }
}

/// Schrift eines Stils in einer schon skalierten Größe. Ist die Familie gebündelt, gilt sie; sonst
/// die Systemschrift mit derselben Gestalt (schmal für Display, gleich breite Ziffern für Werte).
func lifelineFont(_ stil: Schriftstil, groesse: CGFloat) -> Font {
    let gewicht = Font.Weight(css: stil.gewicht)
    if UIFont(name: stil.familie, size: groesse) != nil {
        return .custom(stil.familie, fixedSize: groesse).weight(gewicht)
    }
    switch stil.familie {
    case LifelineSchrift.familieDisplay:
        return .system(size: groesse, weight: gewicht).width(.condensed)
    case LifelineSchrift.familieZahl:
        return .system(size: groesse, weight: gewicht, design: .monospaced)
    default:
        return .system(size: groesse, weight: gewicht)
    }
}

/// Setzt die Schrift eines Stils und skaliert sie mit Dynamic Type (`relativeTo`).
struct Schriftart: ViewModifier {
    let stil: Schriftstil
    @ScaledMetric private var groesse: CGFloat

    init(_ stil: Schriftstil, relativeTo textStyle: Font.TextStyle) {
        self.stil = stil
        _groesse = ScaledMetric(wrappedValue: CGFloat(stil.groesse), relativeTo: textStyle)
    }

    func body(content: Content) -> some View {
        content.font(lifelineFont(stil, groesse: groesse))
    }
}

extension View {
    /// Schrift eines Stils der Helfer-App, mit Dynamic Type skaliert.
    func schrift(_ stil: Schriftstil, relativeTo textStyle: Font.TextStyle = .body) -> some View {
        modifier(Schriftart(stil, relativeTo: textStyle))
    }
}
