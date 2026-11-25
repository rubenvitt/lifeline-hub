import HelferKern
import SwiftUI

/// Lifeline Helfer (ADR-0101, Regeln `ios/Helfer/AGENTS.md`): eine App mit genau einer Aufgabe,
/// am Einsatz anmelden und die Position senden. Welche Seite gilt, entscheidet die Phase der
/// `Anmeldung` im Kern.
@main
struct HelferApp: App {
    @State private var modell = HelferModell.start(argumente: ProcessInfo.processInfo.arguments)
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Hauptansicht(modell: modell)
                .onOpenURL { modell.oeffne($0) }
                .onChange(of: scenePhase, initial: true) { _, neu in
                    modell.szene(aktiv: neu == .active)
                }
        }
    }
}

/// Wählt die Seite nach der Phase; Wechsel sind sanft animiert.
struct Hauptansicht: View {
    @Bindable var modell: HelferModell

    var body: some View {
        NavigationStack {
            seite
                .toolbar(.hidden, for: .navigationBar)
                .animation(.smooth(duration: 0.35), value: modell.phase)
        }
        .tint(Farbe.bedien)
        .dynamicTypeSize(...DynamicTypeSize.accessibility3)
        // Haptik bei der Bestätigung durch die Leitung und beim Ende.
        .sensoryFeedback(.success, trigger: modell.bestaetigungen)
        .confirmationDialog(
            "Neue Einladung",
            isPresented: Binding(
                get: { modell.ausstehenderScan != nil },
                set: { if !$0 { modell.ausstehenderScan = nil } }),
            titleVisibility: .visible
        ) {
            Button("Alte Anmeldung beenden und neu anmelden", role: .destructive) {
                Task { await modell.bestaetigeNeuenScan(true) }
            }
            Button("Abbrechen", role: .cancel) {
                Task { await modell.bestaetigeNeuenScan(false) }
            }
        } message: {
            Text("Du bist schon an „\(modell.einsatzname)“ angemeldet. Je Gerät gibt es eine Anmeldung.")
        }
    }

    @ViewBuilder
    private var seite: some View {
        switch modell.phase {
        case .start:
            StartSeite(modell: modell).transition(.opacity)
        case .anmelden:
            AnmeldenSeite(modell: modell).transition(.move(edge: .trailing).combined(with: .opacity))
        case .unbestaetigt:
            WartetSeite(modell: modell).transition(.opacity)
        case .aktiv, .pausiert, .ruht:
            AngemeldetSeite(modell: modell).transition(.opacity)
        case .beendet(let grund):
            BeendetSeite(modell: modell, grund: grund).transition(.opacity)
        }
    }
}
