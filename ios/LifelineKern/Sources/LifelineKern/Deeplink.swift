import Foundation

/// Deeplink `lifeline://verbinden?server=<https-Adresse>` (wie `src-tauri/src/deeplink.rs`).
///
/// Zwei reine Schritte: `parse` liest den Link (dort `deute`), `decide` legt fest, was er
/// gegenüber dem gespeicherten Server bewirken darf (dort `entscheide`). Ein Link lenkt nie still
/// auf einen anderen Server: sonst könnte jede Webseite die App auf einen fremden Server lenken,
/// der die Anmeldung abgreift.
public enum Deeplink {
    /// Schema, das die App registriert (Info.plist, `CFBundleURLSchemes`).
    public static let schema = "lifeline"

    public enum Aktion: Equatable, Sendable {
        /// Das Onboarding zeigt die Adresse; verbunden wird erst nach Bestätigung.
        case vorbelegen(ServerAdresse)
        /// Wechsel auf einen anderen Server erst nach Rückfrage.
        case bestaetigen(ServerAdresse)
        /// Der Link nennt den aktiven Server.
        case nichts

        /// Kennwort in den gemeinsamen Fällen (`src-tauri/faelle/deeplink.json`).
        public var kennwort: String {
            switch self {
            case .vorbelegen: "vorbelegen"
            case .bestaetigen: "bestaetigen"
            case .nichts: "nichts"
            }
        }
    }

    /// Liest einen Deeplink. `nil` für alles außer `lifeline://verbinden?server=<gültige Adresse>`,
    /// auch für den Rücksprung der Anmeldung: den nimmt nur die laufende Anmeldesitzung an.
    public static func parse(_ link: String) -> ServerAdresse? {
        guard let teile = URLComponents(string: link),
            teile.scheme?.lowercased() == schema,
            teile.percentEncodedHost == "verbinden",
            ["", "/"].contains(teile.percentEncodedPath),
            let ziel = teile.queryItems?.first(where: { $0.name == "server" })?.value
        else { return nil }
        return try? ServerAdresse.parse(ziel)
    }

    /// Was ein gültiger Deeplink gegenüber der gespeicherten Adresse bewirkt (gemeinsame Fälle).
    public static func decide(gespeichert: ServerAdresse?, neu: ServerAdresse) -> Aktion {
        guard let gespeichert else { return .vorbelegen(neu) }
        return gespeichert == neu ? .nichts : .bestaetigen(neu)
    }

    /// Dasselbe mit der Serverliste der iOS-App: ein Server, der nicht in der Liste steht, wird
    /// nicht gewechselt, sondern im Onboarding vorbelegt (geprüft und gespeichert wird er dort).
    public static func decide(
        aktiv: ServerAdresse?, bekannt: [ServerAdresse], neu: ServerAdresse
    ) -> Aktion {
        switch decide(gespeichert: aktiv, neu: neu) {
        case .bestaetigen(let ziel) where !bekannt.contains(ziel): .vorbelegen(ziel)
        case let aktion: aktion
        }
    }
}
