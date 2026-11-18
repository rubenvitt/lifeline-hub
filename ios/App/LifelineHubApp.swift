import SwiftUI

/// Einstieg der iOS-Hülle (LLH-1978). Die Hülle lädt die Weboberfläche des gewählten Servers und
/// trägt keine Anwendungslogik (ADR-0065, ios/AGENTS.md); testbare Logik liegt im Swift-Paket
/// `LifelineKern`. Bis Webview, Onboarding und Serverliste stehen (tasks.md 8.4 ff.), zeigt die
/// App nur den Platzhalter `StartView`.
@main
struct LifelineHubApp: App {
    var body: some Scene {
        WindowGroup {
            StartView()
        }
    }
}
