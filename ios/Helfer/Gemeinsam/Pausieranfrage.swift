import AppIntents
import Foundation

/// App Group von App und Widget-Erweiterung (`com.apple.security.application-groups`).
enum HelferGruppe {
    static let kennung = "group.dev.rubeen.lifeline.helfer"
    /// Zeitpunkt (Sekunden seit 1970) einer Pausieranfrage, die die App noch nicht ausgeführt hat.
    static let pauseAngefordert = "pauseAngefordert"

    static var defaults: UserDefaults? { UserDefaults(suiteName: kennung) }
}

/// „Pausieren“ aus der Live-Aktivität. Ein `LiveActivityIntent` läuft im Prozess der App; dort hat
/// das Modell `ausfuehrung` gesetzt und pausiert sofort (Spec „Senden, Takt, ohne Netz“: einmal
/// `paused: true`, dann keine Ortung mehr). Ohne Modell bleibt die Anfrage in der App Group, und
/// die App führt sie aus, sobald sie läuft. „Fortsetzen“ gibt es nur in der geöffneten App, und
/// hier kein „Abmelden“.
enum Pausieranfrage {
    @MainActor static var ausfuehrung: (@MainActor () async -> Void)?

    @MainActor static func ausfuehren() async {
        if let ausfuehrung {
            await ausfuehrung()
        } else {
            HelferGruppe.defaults?.set(
                Date().timeIntervalSince1970, forKey: HelferGruppe.pauseAngefordert)
        }
    }

    /// Holt eine abgelegte Anfrage ab und löscht sie; `true`, wenn es eine gab.
    @MainActor static func abholen() -> Bool {
        guard let defaults = HelferGruppe.defaults,
            defaults.object(forKey: HelferGruppe.pauseAngefordert) != nil
        else { return false }
        defaults.removeObject(forKey: HelferGruppe.pauseAngefordert)
        return true
    }
}

struct PausierenIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Ortung pausieren"

    init() {}

    func perform() async throws -> some IntentResult {
        await Pausieranfrage.ausfuehren()
        return .result()
    }
}
