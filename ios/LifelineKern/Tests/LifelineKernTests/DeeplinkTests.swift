import XCTest

@testable import LifelineKern

/// Deeplink `lifeline://verbinden?server=…` gegen die gemeinsamen Fälle
/// (`src-tauri/faelle/deeplink.json`).
final class DeeplinkTests: XCTestCase {
    struct Datei: Decodable {
        let deute: [DeuteFall]
        let entscheide: [EntscheideFall]
    }

    struct DeuteFall: Decodable {
        let beschreibung: String
        let link: String
        let ziel: String?
    }

    struct EntscheideFall: Decodable {
        let beschreibung: String
        let gespeichert: String?
        let neu: String
        let aktion: String
    }

    func adresse(_ text: String) throws -> ServerAdresse { try ServerAdresse.parse(text) }

    func testJederGemeinsameFallVonDeuteGilt() throws {
        let faelle = try GemeinsameFaelle.load("deeplink.json", as: Datei.self).deute
        XCTAssertGreaterThanOrEqual(faelle.count, 10)
        for fall in faelle {
            XCTAssertEqual(Deeplink.parse(fall.link)?.text, fall.ziel, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonEntscheideGilt() throws {
        let faelle = try GemeinsameFaelle.load("deeplink.json", as: Datei.self).entscheide
        XCTAssertGreaterThanOrEqual(faelle.count, 5)
        for fall in faelle {
            let neu = try adresse(fall.neu)
            let gespeichert = try fall.gespeichert.map(adresse)
            XCTAssertEqual(
                Deeplink.decide(gespeichert: gespeichert, neu: neu).kennwort, fall.aktion,
                fall.beschreibung)
        }
    }

    /// Die iOS-Hülle kennt mehrere Server (Spec `ios-huelle`, „Ein Deeplink lenkt nie still auf
    /// einen anderen Server“): ein unbekannter Server belegt das Onboarding vor, ein bekannter
    /// anderer wird erst nach Bestätigung aktiv, der aktive bleibt.
    func testMitServerlisteBelegtEinUnbekannterServerDasOnboardingVor() throws {
        let aktiv = try adresse("https://elw.local:8443")
        let bekannt = try adresse("https://fuekw.local:8443")
        let fremd = try adresse("https://fremd.example")
        let liste = [aktiv, bekannt]
        XCTAssertEqual(Deeplink.decide(aktiv: aktiv, bekannt: liste, neu: fremd), .vorbelegen(fremd))
        XCTAssertEqual(
            Deeplink.decide(aktiv: aktiv, bekannt: liste, neu: bekannt), .bestaetigen(bekannt))
        XCTAssertEqual(
            Deeplink.decide(aktiv: aktiv, bekannt: liste, neu: try adresse("https://ELW.local:8443/")),
            .nichts)
        XCTAssertEqual(Deeplink.decide(aktiv: nil, bekannt: [], neu: fremd), .vorbelegen(fremd))
    }
}
