import LifelineKern
import XCTest

/// Prüft die gebaute App im Simulator gegen `ios/project.yml` (LLH-1978, tasks.md 8.1): Version
/// aus `scripts/ios/version.sh`, Schlüssel der Info.plist und das Init-Skript als Ressource. Der
/// Test läuft in der App (Testhost), `Bundle.main` ist also das App-Bündel.
final class InfoPlistTests: XCTestCase {
    private var info: [String: Any] { Bundle.main.infoDictionary ?? [:] }

    func testDieVersionKommtAusDemVersionsskript() throws {
        let version = try XCTUnwrap(AppVersion(info: info), "Version.xcconfig fehlt oder ist falsch")
        XCTAssertFalse(version.fullVersion.isEmpty)
    }

    func testDasSchemaLifelineIstAngemeldet() {
        let typen = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
        let schemata = typen.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        XCTAssertEqual(schemata, ["lifeline"])
    }

    func testDieAppMeldetKeineVerschluesselungNachExportrecht() {
        XCTAssertEqual(info["ITSAppUsesNonExemptEncryption"] as? Bool, false)
    }

    func testKameraUndLokalesNetzSindBegruendet() {
        for schluessel in ["NSCameraUsageDescription", "NSLocalNetworkUsageDescription"] {
            let text = info[schluessel] as? String ?? ""
            XCTAssertFalse(text.isEmpty, schluessel)
        }
    }

    func testDieAppKennzeichnetSichAlsLifelineIos() {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "dev.rubeen.lifeline.ios")
    }

    func testDasInitSkriptLiegtAlsRessourceInDerApp() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "huelle", withExtension: "js"))
        let skript = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(skript.contains("__LIFELINE_HUELLE__"))
        XCTAssertTrue(skript.contains("__LIFELINE_VERSION__"))
    }
}
