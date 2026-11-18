import LifelineKern
import SwiftUI
import UserNotifications

/// Einstieg der iOS-Hülle (LLH-1978). Die Hülle lädt die Weboberfläche des gewählten Servers und
/// trägt keine Anwendungslogik (ADR-0066, ios/AGENTS.md). Welche Seite sie zeigt, entscheidet die
/// Zustandsfunktion `Ablauf` des Kerns; `AppModell` führt deren Wirkungen aus.
@main
struct LifelineHubApp: App {
    @State private var modell = AppModell()
    /// Meldungen erscheinen auch, während die App im Vordergrund ist (Spec `ios-huelle`, „Meldung
    /// und Badge bei laufender App“); `UNUserNotificationCenter.delegate` hält ihn nur schwach.
    private let meldungsdelegat = Meldungsdelegat()

    init() {
        UNUserNotificationCenter.current().delegate = meldungsdelegat
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(modell)
        }
    }
}

/// Zeigt Meldungen der Brücke auch bei offener App als Banner.
final class Meldungsdelegat: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
