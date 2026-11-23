import Foundation

/// Was die Hülle für den Start ohne Server vorhält (LLH-1980, Entwurf
/// `docs/superpowers/specs/2026-11-22-ny0d22bl-ios-start-ohne-server-design.md`): Nach einem
/// verträglichen Online-Laden wärmt sie die Assets aus `GET /api/shell` im Webview vor und legt
/// erst danach die `index.html` ab; ohne Server lädt sie diese unter der Adresse des Servers.
public enum Vorrat {
    /// So lange wartet die Hülle nach dem Laden ohne Server, bis die Oberfläche hochgefahren ist.
    public static let startpruefungFrist: Duration = .seconds(10)
    /// Höchstens so viele Assets holt das Vorwärmen gleichzeitig.
    public static let gleichzeitig = 4

    /// Die vorzuwärmenden Assets; `nil`, wenn der Server keine nennt oder auch nur ein Pfad aus
    /// `assets/` herausführt (dann wärmt die Hülle nichts vor und speichert nichts).
    public static func offlineAssets(_ info: ShellInfo) -> [String]? {
        guard let assets = info.assets, !assets.isEmpty, assets.allSatisfy(isAssetPfad) else {
            return nil
        }
        return assets
    }

    /// `assets/` gefolgt von Segmenten aus `A–Z a–z 0–9 . _ -`, ohne `.`/`..`, ohne Doku-Bilder.
    static func isAssetPfad(_ pfad: String) -> Bool {
        let segmente = pfad.split(separator: "/", omittingEmptySubsequences: false)
        guard segmente.count >= 2, segmente[0] == "assets", segmente[1] != "doku" else {
            return false
        }
        let erlaubt = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        return segmente.dropFirst().allSatisfy { segment in
            !segment.isEmpty && segment != "." && segment != ".."
                && segment.allSatisfy { erlaubt.contains($0) }
        }
    }

    /// Gilt eine Antwort auf den Abruf der Startadresse als `index.html`? Nur eine 200 mit
    /// `text/html`; ein Captive Portal oder eine Fehlerseite eines Proxys kommt nicht in die Ablage.
    public static func isIndexAntwort(status: Int, contentType: String?) -> Bool {
        guard status == 200,
            let medientyp = contentType?.split(separator: ";", omittingEmptySubsequences: false).first
        else { return false }
        return medientyp.trimmingCharacters(in: .whitespaces).lowercased() == "text/html"
    }

    /// Was nach einem verträglichen Online-Laden zu tun ist. Eine Ablage einer anderen Version
    /// wird verworfen, bevor vorgewärmt wird: die neue Version kann die Datenbanken des Frontends
    /// schon umgebaut haben, auf die der alte Code dann träfe.
    public static func plan(gespeichert: String?, server: ShellInfo) -> Vorwaermplan {
        if gespeichert == server.version { return Vorwaermplan(verwerfen: false, assets: nil) }
        return Vorwaermplan(verwerfen: gespeichert != nil, assets: offlineAssets(server))
    }
}

/// Ergebnis von `Vorrat.plan`: erst verwerfen, dann (falls `assets`) vorwärmen und speichern.
public struct Vorwaermplan: Equatable, Sendable {
    public let verwerfen: Bool
    public let assets: [String]?

    public init(verwerfen: Bool, assets: [String]?) {
        self.verwerfen = verwerfen
        self.assets = assets
    }
}
