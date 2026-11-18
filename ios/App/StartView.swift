import LifelineKern
import SwiftUI

/// Platzhalter, bis das Onboarding steht (tasks.md 8.5): Kopf-Schwarz wie der Startbildschirm,
/// dazu die Version der App, damit ein Bild aus dem Simulator den gebauten Stand zeigt.
struct StartView: View {
    private let version = AppVersion(info: Bundle.main.infoDictionary ?? [:])

    var body: some View {
        ZStack {
            Color("Kopfschwarz")
                .ignoresSafeArea()
            VStack(spacing: 12) {
                Text("Lifeline")
                    .font(.largeTitle.weight(.semibold))
                Text(version?.fullVersion ?? "Version unbekannt")
                    .font(.footnote.monospaced())
                    .accessibilityIdentifier("version")
            }
            .foregroundStyle(Color(white: 0.91))
        }
        .accessibilityIdentifier("start")
    }
}

#Preview {
    StartView()
}
