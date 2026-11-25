import HelferKern
import LifelineKern
import XCTest

@testable import LifelineHelfer

/// Entschlüsseln der Auftrags-Nutzlast (`ios/Gemeinsam/Entschluesseler.swift`, in App und
/// Mitteilungsdienst) gegen den gemeinsamen Testvektor des Servers
/// (`src-tauri/faelle/helfer-auftrag.json`, Abschnitt `nutzlast`; ADR-0105). Gelesen über
/// `#filePath` wie `ios/AppTests/EntschluesselerTests.swift`: der Simulator sieht das Dateisystem
/// des Macs.
final class PagerEntschluesselnTests: XCTestCase {
    private struct Datei: Decodable {
        let nutzlast: [Fall]
    }

    private struct Fall: Decodable {
        let beschreibung: String
        let kennung: String
        let schluessel: String
        let klartext: String
        let umschlag: String
    }

    private func faelle() throws -> [Fall] {
        // …/ios/HelferTests/PagerEntschluesselnTests.swift → Repo-Wurzel
        var wurzel = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { wurzel.deleteLastPathComponent() }
        let datei = wurzel.appendingPathComponent("src-tauri/faelle")
            .appendingPathComponent("helfer-auftrag.json")
        let faelle = try JSONDecoder().decode(Datei.self, from: Data(contentsOf: datei)).nutzlast
        XCTAssertFalse(faelle.isEmpty)
        return faelle
    }

    func testGemeinsamerTestvektor() throws {
        for fall in try faelle() {
            let umschlag = try XCTUnwrap(PagerNutzlast.umschlag(fall.umschlag), fall.beschreibung)
            XCTAssertEqual(umschlag.kennung, fall.kennung, fall.beschreibung)
            let schluessel = try XCTUnwrap(Base64URL.decode(fall.schluessel), fall.beschreibung)
            let klartext = try XCTUnwrap(
                Entschluesseler.oeffnen(umschlag, schluessel: schluessel), fall.beschreibung)
            XCTAssertEqual(String(decoding: klartext, as: UTF8.self), fall.klartext, fall.beschreibung)
            XCTAssertNotNil(PagerNutzlast.meldung(aus: klartext), fall.beschreibung)
        }
    }

    /// Ein anderer Schlüssel öffnet nichts; der Mitteilungsdienst zeigt dann den Rückfall.
    func testFalscherSchluesselOeffnetNichts() throws {
        let fall = try XCTUnwrap(try faelle().first)
        let umschlag = try XCTUnwrap(PagerNutzlast.umschlag(fall.umschlag))
        XCTAssertNil(Entschluesseler.oeffnen(umschlag, schluessel: Data(repeating: 0, count: 32)))
    }
}
