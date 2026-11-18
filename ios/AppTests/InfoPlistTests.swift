import LifelineKern
import UIKit
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

    func testDasAppSymbolIstEingebunden() {
        let symbole = info["CFBundleIcons"] as? [String: Any]
        let haupt = symbole?["CFBundlePrimaryIcon"] as? [String: Any]
        XCTAssertEqual(haupt?["CFBundleIconName"] as? String, "AppIcon")
    }

    func testDerStartbildschirmIstKopfSchwarz() throws {
        let start = info["UILaunchScreen"] as? [String: Any]
        XCTAssertEqual(start?["UIColorName"] as? String, "Kopfschwarz")
        let farbe = try XCTUnwrap(UIColor(named: "Kopfschwarz", in: .main, compatibleWith: nil))
        var rot: CGFloat = 0, gruen: CGFloat = 0, blau: CGFloat = 0, alpha: CGFloat = 0
        XCTAssertTrue(farbe.getRed(&rot, green: &gruen, blue: &blau, alpha: &alpha))
        // #0c0e11, wie das Kopf-Schwarz der Bildmarke (frontend/src/marke/marke.guard.test.ts).
        XCTAssertEqual(Int((rot * 255).rounded()), 0x0C)
        XCTAssertEqual(Int((gruen * 255).rounded()), 0x0E)
        XCTAssertEqual(Int((blau * 255).rounded()), 0x11)
        XCTAssertEqual(alpha, 1)
    }

    /// App Store: Required-Reason-APIs stehen mit Grund im Privacy-Manifest; die Hülle verfolgt
    /// niemanden und erhebt selbst keine Daten.
    func testDasPrivacyManifestLiegtImBuendel() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let daten = try Data(contentsOf: url)
        let manifest = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: daten, format: nil) as? [String: Any])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        XCTAssertEqual((manifest["NSPrivacyTrackingDomains"] as? [String])?.count, 0)
        XCTAssertEqual((manifest["NSPrivacyCollectedDataTypes"] as? [Any])?.count, 0)
        let apis = manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]] ?? []
        let gruende = Dictionary(
            uniqueKeysWithValues: apis.compactMap { eintrag -> (String, [String])? in
                guard let typ = eintrag["NSPrivacyAccessedAPIType"] as? String else { return nil }
                return (typ, eintrag["NSPrivacyAccessedAPITypeReasons"] as? [String] ?? [])
            })
        XCTAssertEqual(gruende, ["NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1"]])
    }

    func testDasInitSkriptLiegtAlsRessourceInDerApp() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "huelle", withExtension: "js"))
        let skript = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(skript.contains("__LIFELINE_HUELLE__"))
        XCTAssertTrue(skript.contains("__LIFELINE_VERSION__"))
    }
}
