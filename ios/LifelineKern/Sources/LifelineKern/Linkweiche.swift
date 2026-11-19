import Foundation

/// Bildet die Rückrufe von WebKit auf die Linkregeln ab (Entwurf D8; tasks.md 8.9). Die App ruft
/// `navigation` aus `decidePolicyFor navigationAction` und aus `createWebViewWith` (dort mit
/// `neuesFenster`), `antwort` aus `decidePolicyFor navigationResponse`.
public enum Linkweiche {
    public enum Entscheidung: Equatable, Sendable {
        /// Die Navigation läuft wie angefordert.
        case erlauben
        /// Nichts laden, nichts öffnen.
        case abbrechen
        /// `WKDownload` mit dem Datenspeicher des Servers, danach das Teilen-Blatt.
        case download
        /// Ein neues Fenster der eigenen Origin: dieselbe Adresse im selben Webview.
        case imWebviewLaden(URL)
        /// Das System öffnet die Adresse (`UIApplication.open`).
        case system(URL)
    }

    /// - Parameters:
    ///   - neuesFenster: `target=_blank` oder `window.open` (kein Zielframe).
    ///   - shouldPerformDownload: WebKit will herunterladen (`<a download>`, auch aus `blob:`).
    ///   - seite: die Adresse, die der Webview gerade zeigt.
    public static func navigation(
        server: URL?, ziel: URL, isMainFrame: Bool, neuesFenster: Bool,
        shouldPerformDownload: Bool, seite: URL?
    ) -> Entscheidung {
        if shouldPerformDownload {
            // Nur die Seite des Servers lädt herunter: ein `blob:` erbt ihre Origin, und WKDownload
            // nimmt die Cookies ihres Datenspeichers mit.
            guard let server, let seite, Linkregeln.belongsToServer(server, seite: seite) else {
                return .abbrechen
            }
            return .download
        }
        if neuesFenster {
            switch Linkregeln.neuesFenster(server: server, ziel: ziel) {
            case .nebenfenster, .huelle: return .imWebviewLaden(ziel)
            case .download: return .download
            case .system: return .system(ziel)
            case .verwerfen: return .abbrechen
            }
        }
        // Unterframes (Karten, eingebettete Inhalte) folgen nicht den Regeln des Fensters.
        guard isMainFrame else { return .erlauben }
        switch Linkregeln.navigation(server: server, ziel: ziel) {
        case .huelle: return .erlauben
        case .download: return .download
        case .system: return .system(ziel)
        case .nebenfenster, .verwerfen: return .abbrechen
        }
    }

    /// Eine Antwort im Hauptframe, die der Webview nicht darstellen kann (etwa eine Datei ohne
    /// `/api/`-Pfad), wird heruntergeladen statt verworfen.
    public static func antwort(canShowMIMEType: Bool, isForMainFrame: Bool) -> Entscheidung {
        isForMainFrame && !canShowMIMEType ? .download : .erlauben
    }
}

/// Wohin ein Download geht: je Download ein eigenes Verzeichnis unter `basis` (die App nimmt das
/// temporäre Verzeichnis), damit zwei Dateien gleichen Namens sich nicht überschreiben und das
/// Teilen-Blatt den Namen des Servers zeigt.
public enum Downloadablage {
    public static func ziel(basis: URL, vorschlag: String, kennung: UUID) -> URL {
        basis.appendingPathComponent(kennung.uuidString, isDirectory: true)
            .appendingPathComponent(dateiname(vorschlag), isDirectory: false)
    }

    /// Nur der letzte Pfadteil, ohne Steuerzeichen und `:`, ohne führende Punkte.
    static func dateiname(_ vorschlag: String) -> String {
        let letzter = vorschlag.split(separator: "/", omittingEmptySubsequences: true).last.map(String.init) ?? ""
        let sauber = String(
            letzter.unicodeScalars.map { skalar -> Character in
                skalar == ":" || skalar == "\\" || CharacterSet.controlCharacters.contains(skalar)
                    ? "_" : Character(skalar)
            })
        let ohnePunkte = sauber.drop { $0 == "." }.trimmingCharacters(in: .whitespacesAndNewlines)
        return ohnePunkte.isEmpty ? "Download" : ohnePunkte
    }
}
