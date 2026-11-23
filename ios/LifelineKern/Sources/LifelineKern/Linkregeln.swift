import Foundation

/// Was mit einer URL geschieht, die ein neues Fenster verlangt oder den Webview wegnavigiert
/// (wie `src-tauri/src/links.rs`, gemeinsame Fälle `src-tauri/faelle/links.json`).
///
/// Dateirouten erkennt die Hülle am Pfad `/api/`, nicht an der Antwort; einzige Ausnahme sind die
/// Anmelderouten `/api/auth/` (OIDC-Start und -Rücksprung laufen im Webview). Ein `blob:` der
/// Serverseite (CSV-Export) wird nie verworfen: `WKDownload` lädt ihn.
public enum Linkregeln {
    /// Die Rohwerte sind die Kennwörter der gemeinsamen Fälle.
    public enum Ziel: String, Sendable, CaseIterable {
        /// Die Navigation läuft im Webview wie angefordert.
        case huelle
        /// Desktop: ein weiteres Fenster. iOS: dieselbe Adresse im selben Webview
        /// (`createWebViewWith` lädt sie dort, ein zweiter Webview entsteht nicht).
        case nebenfenster
        /// Die Datei wird geladen und im Teilen-Blatt angeboten; die Seite bleibt.
        case download
        /// Das System öffnet sie (Safari, Mail, Telefon).
        case system
        /// Nichts öffnen.
        case verwerfen
    }

    /// `window.open` bzw. `target="_blank"`.
    public static func neuesFenster(server: URL?, ziel: URL) -> Ziel {
        if isEigeneOrigin(server: server, ziel: ziel) {
            return isDateiroute(ziel) ? .download : .nebenfenster
        }
        switch ziel.scheme?.lowercased() {
        case "http", "https", "mailto", "tel": return .system
        default: return .verwerfen
        }
    }

    /// Navigation im Webview. Fremde `http(s)`-Ziele bleiben erlaubt: die Anmeldung beim
    /// Identitätsanbieter läuft dort, und die Hülle kennt den Anbieter nicht.
    public static func navigation(server: URL?, ziel: URL) -> Ziel {
        if isEigeneOrigin(server: server, ziel: ziel), isDateiroute(ziel) { return .download }
        switch ziel.scheme?.lowercased() {
        case "mailto", "tel": return .system
        default: return .huelle
        }
    }

    /// Zeigt `seite` noch den Server `server`?
    public static func belongsToServer(_ server: URL, seite: URL) -> Bool {
        isEigeneOrigin(server: server, ziel: seite)
    }

    /// Der Pfad einer Push-Meldung, den die Hülle auf dem Server laden darf; sonst die Startseite
    /// `/` (gemeinsame Fälle `src-tauri/faelle/deeplink.json`, Abschnitt `push_pfad`). Die
    /// Nutzlast ist nur durch den Schlüssel der Anmeldung geschützt; ein Pfad, der den Webview
    /// auf eine fremde Adresse lenkt, wäre ein Weg zum Abgreifen der Anmeldung. Erlaubt ist nur ein
    /// Pfad mit genau einem führenden `/`: kein Schema, kein `//host`, kein `\` (Browser lesen
    /// `/\host` wie `//host`), keine Steuer- und Leerzeichen (Browser entfernen Tabulator und
    /// Zeilenumbruch und machen aus `/⇥/host` ein `//host`). Zuletzt muss die aufgelöste Adresse
    /// auf der Origin des Servers liegen.
    public static func sichererPfad(_ pfad: String?, server: URL) -> String {
        let startseite = "/"
        guard let pfad, pfad.hasPrefix("/"), !pfad.hasPrefix("//"),
            !pfad.unicodeScalars.contains(where: { $0.value <= 0x20 || $0.value == 0x7f || $0 == "\\" }),
            let ziel = URL(string: pfad, relativeTo: server)?.absoluteURL,
            isEigeneOrigin(server: server, ziel: ziel)
        else { return startseite }
        return pfad
    }

    /// Gleiche Origin wie der Server. Das Schema wird eigens verlangt: `blob:` erbt die Origin der
    /// Seite, die ihn erzeugt hat, ist aber keine Adresse, die ein Webview laden kann.
    static func isEigeneOrigin(server: URL?, ziel: URL) -> Bool {
        guard let server, let a = Origin(server), let b = Origin(ziel) else { return false }
        return a == b
    }

    static func isDateiroute(_ ziel: URL) -> Bool {
        let pfad = URLComponents(url: ziel, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? ""
        return pfad.hasPrefix("/api/") && !pfad.hasPrefix("/api/auth/")
    }

    /// Schema, Host und Port einer `http(s)`-Adresse, der Port mit seinem Standardwert.
    struct Origin: Equatable {
        let schema: String
        let host: String
        let port: Int

        init?(_ url: URL) {
            guard let schema = url.scheme?.lowercased(), ["http", "https"].contains(schema),
                let host = url.host?.lowercased(), !host.isEmpty
            else { return nil }
            self.schema = schema
            self.host = host
            self.port = url.port ?? (schema == "https" ? 443 : 80)
        }
    }
}
