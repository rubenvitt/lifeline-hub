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
        // CA92.1: Schalter der App; 1C8F.1: Zahl der Server in der App Group für die Extension.
        XCTAssertEqual(gruende, ["NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1", "1C8F.1"]])
    }

    func testDasInitSkriptLiegtAlsRessourceInDerApp() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "huelle", withExtension: "js"))
        let skript = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(skript.contains("__LIFELINE_HUELLE__"))
        XCTAssertTrue(skript.contains("__LIFELINE_VERSION__"))
    }

    // MARK: Push über APNs (Entwurf „iOS-Alarme über APNs“)

    /// Die Notification Service Extension liegt im Bündel, dient Meldungen und trägt die Version
    /// der App (App Store Connect lehnt abweichende Versionen ab).
    func testDieExtensionLiegtImBuendelUndEntschluesseltMeldungen() throws {
        let dienst = try XCTUnwrap(Self.dienst, "Benachrichtigungsdienst.appex fehlt im Bündel")
        XCTAssertEqual(dienst.bundleIdentifier, "dev.rubeen.lifeline.ios.benachrichtigung")
        let erweiterung = dienst.infoDictionary?["NSExtension"] as? [String: Any]
        XCTAssertEqual(
            erweiterung?["NSExtensionPointIdentifier"] as? String, "com.apple.usernotifications.service")
        XCTAssertEqual(
            erweiterung?["NSExtensionPrincipalClass"] as? String, "Benachrichtigungsdienst.Dienst")
        for schluessel in ["CFBundleShortVersionString", "CFBundleVersion"] {
            let version = info[schluessel] as? String
            XCTAssertNotNil(version, schluessel)
            XCTAssertEqual(dienst.infoDictionary?[schluessel] as? String, version, schluessel)
        }
    }

    /// App und Extension finden die Schlüssel im selben Schlüsselbund. Im Simulator ohne Signatur
    /// ist `$(AppIdentifierPrefix)` leer; es zählt der Teil nach dem Team.
    func testAppUndExtensionNennenDenselbenSchluesselbund() throws {
        let dienst = try XCTUnwrap(Self.dienst)
        let app = try XCTUnwrap(info["LifelineSchluesselbundGruppe"] as? String)
        XCTAssertTrue(app.hasSuffix("dev.rubeen.lifeline.ios.gemeinsam"), app)
        XCTAssertEqual(dienst.infoDictionary?["LifelineSchluesselbundGruppe"] as? String, app)
    }

    /// Die Berechtigungen stehen in den Dateien, die `ios/project.yml` als `CODE_SIGN_ENTITLEMENTS`
    /// nennt. Eine gebaute App ohne Signatur trägt sie nicht; deshalb liest der Test die Dateien
    /// über `#filePath` aus dem Repo (wie `EntschluesselerTests`).
    func testDieBerechtigungenTragenPushGruppeUndSchluesselbund() throws {
        let app = try Self.berechtigungen("App/LifelineHub.entitlements")
        XCTAssertEqual(app["aps-environment"] as? String, "development")
        XCTAssertEqual(app["com.apple.developer.usernotifications.time-sensitive"] as? Bool, true)
        let dienst = try Self.berechtigungen(
            "Benachrichtigungsdienst/Benachrichtigungsdienst.entitlements")
        XCTAssertNil(dienst["aps-environment"], "Push empfängt nur die App")
        for (name, datei) in [("App", app), ("Extension", dienst)] {
            XCTAssertEqual(
                datei["com.apple.security.application-groups"] as? [String],
                ["group.dev.rubeen.lifeline.ios"], name)
            XCTAssertEqual(
                datei["keychain-access-groups"] as? [String],
                ["$(AppIdentifierPrefix)dev.rubeen.lifeline.ios.gemeinsam"], name)
        }
    }

    /// Die Extension liest die Zahl der Server aus der App Group: eigener Grund im eigenen Manifest.
    func testDieExtensionHatEinPrivacyManifest() throws {
        let dienst = try XCTUnwrap(Self.dienst)
        let url = try XCTUnwrap(dienst.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        let manifest = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: try Data(contentsOf: url), format: nil)
                as? [String: Any])
        XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false)
        let apis = manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]] ?? []
        XCTAssertEqual(apis.count, 1)
        XCTAssertEqual(
            apis.first?["NSPrivacyAccessedAPIType"] as? String, "NSPrivacyAccessedAPICategoryUserDefaults")
        XCTAssertEqual(apis.first?["NSPrivacyAccessedAPITypeReasons"] as? [String], ["1C8F.1"])
    }

    private static var dienst: Bundle? {
        Bundle.main.builtInPlugInsURL.flatMap {
            Bundle(url: $0.appendingPathComponent("Benachrichtigungsdienst.appex"))
        }
    }

    private static func berechtigungen(_ pfad: String) throws -> [String: Any] {
        // …/ios/AppTests/InfoPlistTests.swift → ios/
        var ios = URL(fileURLWithPath: #filePath)
        for _ in 0..<2 { ios.deleteLastPathComponent() }
        let daten = try Data(contentsOf: ios.appendingPathComponent(pfad))
        return try XCTUnwrap(
            PropertyListSerialization.propertyList(from: daten, format: nil) as? [String: Any], pfad)
    }
}
