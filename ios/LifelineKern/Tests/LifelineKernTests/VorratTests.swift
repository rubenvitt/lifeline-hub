import Foundation
import XCTest

@testable import LifelineKern

/// Start ohne Server (LLH-1980, Entwurf `2026-11-22-ny0d22bl-ios-start-ohne-server-design.md`):
/// welche Assets die Hülle vorwärmt, wann sie die gespeicherte Oberfläche verwirft und welche
/// Antwort als `index.html` gilt.
final class VorratTests: XCTestCase {
    func info(_ version: String, _ assets: [String]?) -> ShellInfo {
        ShellInfo(version: version, shellContract: 1, assets: assets)
    }

    // MARK: Asset-Liste

    func testOhneAssetsGibtEsKeinenVorrat() {
        XCTAssertNil(Vorrat.offlineAssets(info("1.0", nil)))
        XCTAssertNil(Vorrat.offlineAssets(info("1.0", [])))
    }

    func testGueltigeAssetsBleibenUnveraendert() {
        let assets = ["assets/a.css", "assets/sub/b-1.js", "assets/index-Ab_9.js"]
        XCTAssertEqual(Vorrat.offlineAssets(info("1.0", assets)), assets)
    }

    /// Die Liste kommt vom Server; ein Pfad, der woandershin zeigt, macht die ganze Liste
    /// unbrauchbar, statt still einen Teil vorzuwärmen.
    func testEinBoeserPfadVerwirftDieGanzeListe() {
        for boese in [
            "assets/../x.js", "/assets/a.js", "https://evil.example/a.js", "//evil/a.js",
            "assets/doku/a.png", "index.html", "assets/a b.js", "assets/", "assets//a.js",
            "assets/./a.js",
        ] {
            XCTAssertNil(Vorrat.offlineAssets(info("1.0", ["assets/a.js", boese])), boese)
        }
    }

    // MARK: index.html

    func testIndexAntwortNurHtmlMit200() {
        XCTAssertTrue(Vorrat.isIndexAntwort(status: 200, contentType: "text/html; charset=utf-8"))
        XCTAssertTrue(Vorrat.isIndexAntwort(status: 200, contentType: "Text/HTML"))
        XCTAssertFalse(Vorrat.isIndexAntwort(status: 200, contentType: "application/json"))
        XCTAssertFalse(Vorrat.isIndexAntwort(status: 302, contentType: "text/html"))
        XCTAssertFalse(Vorrat.isIndexAntwort(status: 200, contentType: nil))
    }

    // MARK: Plan

    func testGleicheVersionPlantNichts() {
        XCTAssertEqual(
            Vorrat.plan(gespeichert: "1.0", server: info("1.0", ["assets/a.js"])),
            Vorwaermplan(verwerfen: false, assets: nil))
    }

    func testAndereVersionVerwirftZuerst() {
        XCTAssertEqual(
            Vorrat.plan(gespeichert: "1.0", server: info("1.1", ["assets/a.js"])),
            Vorwaermplan(verwerfen: true, assets: ["assets/a.js"]))
    }

    func testOhneAblageNurVorwaermen() {
        XCTAssertEqual(
            Vorrat.plan(gespeichert: nil, server: info("1.1", ["assets/a.js"])),
            Vorwaermplan(verwerfen: false, assets: ["assets/a.js"]))
    }

    /// Ein älterer Server ohne Liste: die Ablage einer anderen Version taugt trotzdem nicht mehr.
    func testAndereVersionOhneAssetsVerwirftTrotzdem() {
        XCTAssertEqual(
            Vorrat.plan(gespeichert: "1.0", server: info("1.1", nil)),
            Vorwaermplan(verwerfen: true, assets: nil))
    }
}
