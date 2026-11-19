/// Version der App, gelesen aus der Info.plist (LLH-1978, design.md D1).
///
/// `scripts/ios/version.sh` schreibt die drei Werte als Build-Einstellungen in ein xcconfig;
/// `ios/project.yml` trägt sie in die Info.plist ein: `CFBundleShortVersionString` (Workspace-
/// Version ohne Vorab-Suffix), `LifelineVersion` (volle Workspace-Version, die die Hülle der Seite
/// als `version` meldet) und `CFBundleVersion` (Zeitstempel `JJJJMMTTHHMM`). Ein fehlender oder
/// unersetzter Wert gibt `nil`: dann meldet die Hülle lieber keine Version als eine falsche.
public struct AppVersion: Equatable, Sendable {
    public let marketingVersion: String
    public let fullVersion: String
    public let buildNumber: String

    public init?(info: [String: Any]) {
        guard
            let marketing = info["CFBundleShortVersionString"] as? String,
            let full = info["LifelineVersion"] as? String,
            let build = info["CFBundleVersion"] as? String,
            Self.isCore(marketing),
            full == marketing || full.hasPrefix(marketing + "-"),
            build.count == 12, build.allSatisfy(\.isASCIIDigit)
        else { return nil }
        marketingVersion = marketing
        fullVersion = full
        buildNumber = build
    }

    /// `MAJOR.MINOR.PATCH` aus Ziffern, wie Apple die Marketing-Version annimmt.
    private static func isCore(_ text: String) -> Bool {
        let teile = text.split(separator: ".", omittingEmptySubsequences: false)
        return teile.count == 3 && teile.allSatisfy { !$0.isEmpty && $0.allSatisfy(\.isASCIIDigit) }
    }
}

extension Character {
    fileprivate var isASCIIDigit: Bool { isASCII && isNumber }
}
