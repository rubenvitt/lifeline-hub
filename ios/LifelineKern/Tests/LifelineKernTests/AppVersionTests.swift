import XCTest

@testable import LifelineKern

/// Version der App aus der Info.plist (Spec `ios-auslieferung`, „Die Version der App kommt aus dem
/// Workspace“). Die Werte schreibt `scripts/ios/version.sh` in das xcconfig, die Info.plist liest
/// sie als Build-Einstellungen; fehlt das xcconfig, stünden die Platzhalter unersetzt da.
final class AppVersionTests: XCTestCase {
    private func info(
        marketing: Any? = "1.0.0", full: Any? = "1.0.0-beta.3", build: Any? = "202611181930"
    ) -> [String: Any] {
        var info: [String: Any] = [:]
        info["CFBundleShortVersionString"] = marketing
        info["LifelineVersion"] = full
        info["CFBundleVersion"] = build
        return info
    }

    func testEineBetaLiestSichMitVollerVersion() {
        let version = AppVersion(info: info())
        XCTAssertEqual(version?.marketingVersion, "1.0.0")
        XCTAssertEqual(version?.fullVersion, "1.0.0-beta.3")
        XCTAssertEqual(version?.buildNumber, "202611181930")
    }

    func testEineStabileVersionIstMarketingUndVollGleich() {
        let version = AppVersion(info: info(marketing: "1.2.0", full: "1.2.0"))
        XCTAssertEqual(version?.fullVersion, "1.2.0")
    }

    func testEinFehlenderSchluesselGibtKeineVersion() {
        XCTAssertNil(AppVersion(info: info(marketing: nil)))
        XCTAssertNil(AppVersion(info: info(full: nil)))
        XCTAssertNil(AppVersion(info: info(build: nil)))
        XCTAssertNil(AppVersion(info: [:]))
    }

    func testEinUnersetzterPlatzhalterGibtKeineVersion() {
        XCTAssertNil(AppVersion(info: info(full: "$(LIFELINE_VERSION)")))
        XCTAssertNil(AppVersion(info: info(marketing: "", full: "")))
    }

    func testDieVolleVersionMussZurMarketingVersionPassen() {
        XCTAssertNil(AppVersion(info: info(marketing: "1.0.1", full: "1.0.0-beta.3")))
        XCTAssertNil(AppVersion(info: info(marketing: "1.0.0", full: "1.0.01")))
        XCTAssertNil(AppVersion(info: info(marketing: "1.0", full: "1.0.0")))
    }

    func testDieBuildNummerIstEinZeitstempel() {
        XCTAssertNil(AppVersion(info: info(build: "1")))
        XCTAssertNil(AppVersion(info: info(build: "2026-11-18")))
    }

    func testFalscheTypenGebenKeineVersion() {
        XCTAssertNil(AppVersion(info: info(build: 202_611_181_930)))
    }
}
