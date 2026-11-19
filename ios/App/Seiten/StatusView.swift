import LifelineKern
import SwiftUI

/// Native Status-Seiten (Spec `ios-huelle`, „Zertifikatsfehler und Unerreichbarkeit haben eigene
/// Seiten“, „Die App lädt nur einen verträglichen Server“). Texte aus `Statusseite.text` im Kern.
struct StatusView: View {
    @Environment(AppModell.self) private var modell
    let eintrag: ServerEintrag
    let status: Statusseite

    var body: some View {
        let text = status.text(servername: eintrag.name, appVersion: modell.appVersion?.fullVersion)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Image(systemName: status.symbol)
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(status == .nichtErreichbar ? Color.orange : Color.red)
                    .accessibilityHidden(true)
                Text(text.titel)
                    .font(.title.weight(.semibold))
                Text(text.text)
                Text(eintrag.adresse.text)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Color(white: 0.6))
                if !text.schritte.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(text.schritte.enumerated()), id: \.offset) { nummer, schritt in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text("\(nummer + 1).").monospacedDigit().bold()
                                Text(schritt)
                            }
                        }
                    }
                }
                if status == .nichtErreichbar {
                    HStack(spacing: 10) {
                        ProgressView().tint(.white)
                        Text("Prüft weiter …").foregroundStyle(Color(white: 0.7))
                    }
                }
                VStack(spacing: 12) {
                    if status != .nichtErreichbar {
                        Button("Erneut prüfen") { modell.pruefeErneut() }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                    }
                    Button("Serverliste") { modell.zeigtServerliste = true }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("status-serverliste")
                }
                .padding(.top, 8)
            }
            .foregroundStyle(Color(white: 0.91))
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("status-" + status.kennung)
    }
}

extension Statusseite {
    /// SF Symbol der Seite.
    var symbol: String {
        switch self {
        case .zertifikat: "lock.trianglebadge.exclamationmark"
        case .nichtErreichbar: "wifi.exclamationmark"
        case .nichtVertraeglich(.zuNeu, _): "arrow.down.app"
        case .nichtVertraeglich: "clock.badge.exclamationmark"
        }
    }

    /// Kennung für die UI-Tests, gleich dem Namen des Testzustands.
    var kennung: String {
        switch self {
        case .zertifikat: Testzustand.zertifikat.rawValue
        case .nichtErreichbar: Testzustand.nichtErreichbar.rawValue
        case .nichtVertraeglich(.zuNeu, _): Testzustand.zuNeu.rawValue
        case .nichtVertraeglich: Testzustand.zuAlt.rawValue
        }
    }
}
