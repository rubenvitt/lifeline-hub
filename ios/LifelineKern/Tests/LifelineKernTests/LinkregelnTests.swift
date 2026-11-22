import Foundation
import XCTest

@testable import LifelineKern

/// Linkregeln gegen die gemeinsamen Fälle (`src-tauri/faelle/links.json`).
final class LinkregelnTests: XCTestCase {
    struct Datei: Decodable {
        let neues_fenster: [ZielFall]
        let navigation: [ZielFall]
        let gehoert_zum_server: [ServerFall]
    }

    struct ZielFall: Decodable {
        let beschreibung: String
        let server: String?
        let ziel: String
        let erwartet: String
    }

    struct ServerFall: Decodable {
        let beschreibung: String
        let server: String
        let seite: String
        let erwartet: Bool
    }

    func url(_ text: String) throws -> URL {
        try XCTUnwrap(URL(string: text), "keine URL: \(text)")
    }

    func pruefe(_ faelle: [ZielFall], _ decide: (URL?, URL) -> Linkregeln.Ziel) throws {
        for fall in faelle {
            let server = try fall.server.map(url)
            XCTAssertEqual(
                decide(server, try url(fall.ziel)).rawValue, fall.erwartet, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallFuerNeueFensterGilt() throws {
        let faelle = try GemeinsameFaelle.load("links.json", as: Datei.self).neues_fenster
        XCTAssertGreaterThanOrEqual(faelle.count, 22)
        try pruefe(faelle, Linkregeln.neuesFenster(server:ziel:))
    }

    func testJederGemeinsameFallFuerDieNavigationGilt() throws {
        let faelle = try GemeinsameFaelle.load("links.json", as: Datei.self).navigation
        XCTAssertGreaterThanOrEqual(faelle.count, 17)
        try pruefe(faelle, Linkregeln.navigation(server:ziel:))
    }

    func testJederGemeinsameFallFuerDieZugehoerigkeitGilt() throws {
        let faelle = try GemeinsameFaelle.load("links.json", as: Datei.self).gehoert_zum_server
        XCTAssertGreaterThanOrEqual(faelle.count, 5)
        for fall in faelle {
            XCTAssertEqual(
                Linkregeln.belongsToServer(try url(fall.server), seite: try url(fall.seite)),
                fall.erwartet, fall.beschreibung)
        }
    }

    // MARK: Pfad aus einer Push-Meldung

    struct PushPfadDatei: Decodable {
        let push_pfad: [PushPfadFall]
    }

    struct PushPfadFall: Decodable {
        let beschreibung: String
        let server: String
        let pfad: String?
        let erwartet: String
    }

    func testJederGemeinsameFallFuerDenPushPfadGilt() throws {
        let faelle = try GemeinsameFaelle.load("deeplink.json", as: PushPfadDatei.self).push_pfad
        XCTAssertGreaterThanOrEqual(faelle.count, 20)
        for fall in faelle {
            XCTAssertEqual(
                Linkregeln.sichererPfad(fall.pfad, server: try url(fall.server)), fall.erwartet,
                fall.beschreibung)
        }
    }

    func testEinFremderPfadVerlaesstNieDieOriginDesServers() throws {
        let server = try url("https://elw.local:8443")
        let boese = [
            "https://evil.example", "//evil.example", "/\\evil.example", "///evil.example",
            "/\t/evil.example", "javascript:alert(1)", "\\\\evil.example", "@evil.example",
            "evil.example", " /x", "/x\u{0}",
        ]
        for pfad in boese {
            let sicher = Linkregeln.sichererPfad(pfad, server: server)
            let ziel = try XCTUnwrap(URL(string: sicher, relativeTo: server)?.absoluteURL)
            XCTAssertTrue(Linkregeln.belongsToServer(server, seite: ziel), pfad)
            XCTAssertEqual(sicher, "/", pfad)
        }
    }
}
