import Foundation

/// Das Init-Skript der Hülle (`ios/App/Huelle/huelle.js`, Spec `huellen-vertrag`). Die App liest
/// es aus ihren Ressourcen, setzt ihre Version ein und spielt es als `WKUserScript` vor dem ersten
/// Skript der Seite und nur im Hauptframe ein.
public enum Initskript {
    /// Platzhalter im Skript; steht er nach dem Einspielen noch da, meldet das Skript keine
    /// Version.
    public static let platzhalter = "__LIFELINE_VERSION__"

    /// Setzt `version` für den Platzhalter ein. Die Version landet in einem JS-String: Zeichen
    /// außerhalb von Ziffern, Buchstaben, `.`, `-` und `+` lassen den Platzhalter stehen (dann
    /// lieber keine Version als ein kaputtes Skript).
    public static func render(vorlage: String, version: String?) -> String {
        guard let version, isSafe(version) else { return vorlage }
        return vorlage.replacingOccurrences(of: platzhalter, with: version)
    }

    private static func isSafe(_ version: String) -> Bool {
        !version.isEmpty
            && version.unicodeScalars.allSatisfy {
                $0.isASCII
                    && ($0.properties.isAlphabetic || ("0"..."9").contains($0)
                        || ".-+".unicodeScalars.contains($0))
            }
    }
}
