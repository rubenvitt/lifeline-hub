import Foundation

/// Warum eine eingegebene Serveradresse nicht taugt. Die Rohwerte sind die Kennwörter der
/// gemeinsamen Fälle (`src-tauri/faelle/adresse.json`), die Meldungen gleichen denen der
/// Desktop-Hülle (`src-tauri/src/adresse.rs`, `AdressFehler`) Wort für Wort.
public enum AdressError: String, Error, CaseIterable, Sendable {
    case leer
    case unlesbar
    case keinHttps = "kein_https"
    case ohneHost = "ohne_host"
    case mitZugangsdaten = "mit_zugangsdaten"

    public var meldung: String {
        switch self {
        case .leer: "Bitte die Adresse des Einsatzservers eingeben."
        case .unlesbar: "Das ist keine gültige Adresse. Beispiel: https://elw.local:8443"
        case .keinHttps:
            "Nur https-Adressen sind möglich: Offline-Betrieb und Passkey brauchen eine gesicherte Verbindung."
        case .ohneHost: "Der Adresse fehlt der Hostname, z. B. elw.local."
        case .mitZugangsdaten: "Die Adresse darf keinen Namen und kein Passwort vor „@“ enthalten."
        }
    }
}

/// Eine geprüfte https-Adresse eines Servers in der Form, die auch die Desktop-Hülle vergleicht
/// (WHATWG-URL wie das Rust-Crate `url`): Schema und Host klein, Standardport weggelassen, Pfad
/// mindestens `/`. Zwei Adressen sind gleich, wenn ihr `text` gleich ist.
public struct ServerAdresse: Hashable, Sendable, Codable, CustomStringConvertible {
    public let text: String
    public let host: String

    public var url: URL { URL(string: text)! }
    public var description: String { text }

    /// Schemata, bei denen der URL-Standard einen Host verlangt (`https://` ohne Host scheitert
    /// dort schon beim Lesen, wie in `adresse.rs`).
    private static let schemataMitHost: Set<String> = ["http", "https", "ws", "wss", "ftp"]

    /// Prüft eine eingegebene Adresse Regel für Regel wie `pruefe_adresse` der Desktop-Hülle.
    /// Leerraum an den Rändern zählt nicht.
    public static func parse(_ eingabe: String) throws(AdressError) -> ServerAdresse {
        let eingabe = eingabe.trimmingCharacters(in: .whitespacesAndNewlines)
        if eingabe.isEmpty { throw .leer }
        guard let teile = URLComponents(string: eingabe), let schema = teile.scheme?.lowercased()
        else { throw .unlesbar }
        let host = (teile.percentEncodedHost ?? "").lowercased()
        // Wer drei Schrägstriche tippt, hat den Hostnamen vergessen; der URL-Standard machte aus
        // `https:///einsatz` still den Host `einsatz`.
        let nachSchema = eingabe[eingabe.index(after: eingabe.firstIndex(of: ":")!)...]
        let dreiSchraegstriche = nachSchema.hasPrefix("///")
        if schemataMitHost.contains(schema), host.isEmpty, !dreiSchraegstriche {
            throw .ohneHost
        }
        guard schema == "https" else { throw .keinHttps }
        if dreiSchraegstriche || host.isEmpty { throw .ohneHost }
        // `https://elw.local:8443@evil.example` hat den Host `evil.example`; im Bestätigungsdialog
        // läse sich der vorn stehende Name wie der vertraute Server.
        if !(teile.percentEncodedUser ?? "").isEmpty || teile.percentEncodedPassword != nil {
            throw .mitZugangsdaten
        }
        var text = "https://" + host
        if let port = teile.port, port != 443 { text += ":\(port)" }
        text += teile.percentEncodedPath.isEmpty ? "/" : teile.percentEncodedPath
        if let query = teile.percentEncodedQuery { text += "?" + query }
        if let fragment = teile.percentEncodedFragment { text += "#" + fragment }
        return ServerAdresse(text: text, host: host)
    }

    public init(from decoder: Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        do {
            self = try ServerAdresse.parse(text)
        } catch {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: error.meldung))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(text)
    }

    private init(text: String, host: String) {
        self.text = text
        self.host = host
    }
}
