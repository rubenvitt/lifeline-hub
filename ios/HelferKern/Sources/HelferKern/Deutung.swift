import Foundation
import LifelineKern

/// Server und Code einer Helfer-Einladung, gelesen aus QR-Code oder Deeplink.
///
/// `server` ist die geprüfte Herkunft des Servers in der Normalform von `ServerAdresse`
/// (`LifelineKern`): `https`, Host klein, Standardport weggelassen, Pfad `/`. Den Code reicht die
/// App groß geschrieben und sonst unverändert durch; Normalform und Prüfung macht der Server.
public struct HelferZiel: Equatable, Sendable {
    public let server: URL
    public let code: String

    public init(server: URL, code: String) {
        self.server = server
        self.code = code
    }
}

/// Formen der Einladung (Spec „Ablauf“, Schritt 2): QR `https://<server>/helfer#<CODE>` und
/// Deeplink `lifeline-helfer://anmelden?server=<url>#<CODE>`. Der Code steht immer im Fragment.
public enum HelferLink {
    /// Schema, das die Helfer-App registriert (Info.plist, `CFBundleURLSchemes`).
    public static let schema = "lifeline-helfer"
    /// Host des Deeplinks.
    public static let befehl = "anmelden"
    /// Pfad des QR-Codes auf dem Server (`/koppeln` gehört der Geräte-Kopplung).
    public static let pfad = "/helfer"
}

/// Liest QR-Inhalt oder Deeplink einer Helfer-Einladung; `nil` für alles andere (gemeinsame Fälle
/// `src-tauri/faelle/helfer.json`, Abschnitt `deute`).
///
/// Die Serveradresse prüft `ServerAdresse.parse` wie in `adresse.json`: nur `https`, keine
/// Zugangsdaten, kein gesperrter Port. Eine `http`-Adresse gilt nie, auch nicht für `localhost`
/// oder `*.local`. Der Server im Deeplink muss eine Herkunft ohne Pfad sein.
public func deuteHelferLink(_ text: String) -> HelferZiel? {
    let eingabe = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let teile = URLComponents(string: eingabe),
        let schema = teile.scheme?.lowercased(),
        let code = teile.fragment, !code.isEmpty
    else { return nil }
    let server: ServerAdresse?
    switch schema {
    case "https":
        guard [HelferLink.pfad, HelferLink.pfad + "/"].contains(teile.percentEncodedPath)
        else { return nil }
        server = herkunft(eingabe)
    case HelferLink.schema:
        guard teile.percentEncodedHost?.lowercased() == HelferLink.befehl,
            ["", "/"].contains(teile.percentEncodedPath),
            let ziel = teile.queryItems?.first(where: { $0.name == "server" })?.value,
            let adresse = try? ServerAdresse.parse(ziel)
        else { return nil }
        // Ein Pfad oder eine Abfrage im Server wäre still abgeschnitten worden: lieber verwerfen.
        server = herkunft(adresse.text).flatMap { $0 == adresse ? $0 : nil }
    default:
        return nil
    }
    guard let server else { return nil }
    return HelferZiel(server: server.url, code: code.uppercased())
}

/// Herkunft (`https://host[:port]/`) einer Adresse, geprüft wie in `adresse.json`.
private func herkunft(_ text: String) -> ServerAdresse? {
    guard let adresse = try? ServerAdresse.parse(text) else { return nil }
    // Normalform `https://<host>[:<port>]<pfad>…`: die Herkunft endet vor dem ersten `/` nach
    // dem Schema.
    let nachSchema = adresse.text.dropFirst("https://".count)
    let ende = nachSchema.firstIndex(of: "/") ?? nachSchema.endIndex
    return try? ServerAdresse.parse("https://" + nachSchema[..<ende])
}
