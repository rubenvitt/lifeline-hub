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
    case gesperrterPort = "gesperrter_port"

    public var meldung: String {
        switch self {
        case .leer: "Bitte die Adresse des Einsatzservers eingeben."
        case .unlesbar: "Das ist keine gültige Adresse. Beispiel: https://elw.local:8443"
        case .keinHttps:
            "Nur https-Adressen sind möglich: Offline-Betrieb und Passkey brauchen eine gesicherte Verbindung."
        case .ohneHost: "Der Adresse fehlt der Hostname, z. B. elw.local."
        case .mitZugangsdaten: "Die Adresse darf keinen Namen und kein Passwort vor „@“ enthalten."
        case .gesperrterPort:
            "Diesen Port sperrt der Webview. Bitte den Server auf einem anderen Port betreiben, z. B. 8443."
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

    /// Ports, auf die WKWebView nicht navigiert (WebKit `portAllowed`: die „bad ports“ der
    /// Fetch-Spezifikation und Port 0). Die Seite bliebe leer, ohne Ladefehler (LLH-1987).
    /// Dieselbe Liste wie `GESPERRTE_PORTS` in `adresse.rs`; die Tests prüfen beide gegen
    /// `gesperrte_ports` der gemeinsamen Fälle.
    public static let gesperrtePorts: Set<Int> = [
        0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101,
        102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389,
        427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
        989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
        6666, 6667, 6668, 6669, 6679, 6697, 10080,
    ]

    /// Prüft eine eingegebene Adresse Regel für Regel wie `pruefe_adresse` der Desktop-Hülle.
    /// Leerraum an den Rändern zählt nicht.
    public static func parse(_ eingabe: String) throws(AdressError) -> ServerAdresse {
        let eingabe = eingabe.trimmingCharacters(in: .whitespacesAndNewlines)
        if eingabe.isEmpty { throw .leer }
        guard let teile = URLComponents(string: eingabe), let schema = teile.scheme?.lowercased()
        else { throw .unlesbar }
        // `URLComponents` liest auch Port 65536; der URL-Standard (und `adresse.rs`) nicht.
        if let port = teile.port, !(0...65535).contains(port) { throw .unlesbar }
        // Ein Host mit Umlauten gilt in der Form, die WebKit als Origin meldet (LLH-2070):
        // `encodedHost` liefert ihn in Punycode wie `adresse.rs` (UTS 46 nicht-transitional; einen
        // unbrauchbaren, etwa mit Zero-Width-Joiner, liest `URLComponents` schon nicht).
        // `percentEncodedHost` dekodierte selbst einen eingegebenen `xn--`-Host zu `%c3%bc…`, und
        // die Brücke bliebe stumm.
        let host = (teile.encodedHost ?? "").lowercased()
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
        if let port = teile.port, port != 443, gesperrtePorts.contains(port) {
            throw .gesperrterPort
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
