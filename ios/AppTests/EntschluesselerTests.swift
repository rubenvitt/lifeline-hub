import LifelineKern
import XCTest

@testable import LifelineHub

/// Entschlüsseln der Push-Nutzlast und Nachweis zum Abmelden (`ios/Gemeinsam/Entschluesseler.swift`,
/// in App und Extension) gegen den gemeinsamen Testvektor des Servers (`src/ios_push/krypto.rs`).
/// Die Datei liest der Test über `#filePath` aus dem Repo wie `GemeinsameFaelle` im Kern: der
/// Simulator sieht das Dateisystem des Macs; auf einem echten Gerät läuft dieser Test nicht.
final class EntschluesselerTests: XCTestCase {
    private struct Datei: Decodable {
        let faelle: [Fall]
    }

    private struct Fall: Decodable {
        let beschreibung: String
        let kennung: String
        let klartext: String
        let nachweis: String
        let schluessel: String
        let umschlag: String
    }

    private func faelle() throws -> [Fall] {
        // …/ios/AppTests/EntschluesselerTests.swift → Repo-Wurzel
        var wurzel = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { wurzel.deleteLastPathComponent() }
        let datei = wurzel.appendingPathComponent("src-tauri/faelle")
            .appendingPathComponent("push-nutzlast.json")
        let faelle = try JSONDecoder().decode(Datei.self, from: Data(contentsOf: datei)).faelle
        XCTAssertFalse(faelle.isEmpty)
        return faelle
    }

    func testGemeinsamerTestvektor() throws {
        for fall in try faelle() {
            let umschlag = try XCTUnwrap(PushNutzlast.umschlag(fall.umschlag), fall.beschreibung)
            XCTAssertEqual(umschlag.kennung, fall.kennung, fall.beschreibung)
            let schluessel = try XCTUnwrap(Base64URL.decode(fall.schluessel), fall.beschreibung)
            let klartext = try XCTUnwrap(
                Entschluesseler.oeffnen(umschlag, schluessel: schluessel), fall.beschreibung)
            XCTAssertEqual(String(decoding: klartext, as: UTF8.self), fall.klartext, fall.beschreibung)
        }
    }

    /// Ein anderer Schlüssel oder eine andere Kennung (AAD) öffnet nichts; die Extension zeigt dann
    /// den Rückfall.
    func testFalscherSchluesselOderFremdeKennungOeffnetNichts() throws {
        let fall = try XCTUnwrap(try faelle().first)
        let umschlag = try XCTUnwrap(PushNutzlast.umschlag(fall.umschlag))
        let schluessel = try XCTUnwrap(Base64URL.decode(fall.schluessel))
        XCTAssertNil(Entschluesseler.oeffnen(umschlag, schluessel: Data(repeating: 0, count: 32)))
        XCTAssertNil(Entschluesseler.oeffnen(umschlag, schluessel: schluessel.prefix(16)))

        let json = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: try XCTUnwrap(Base64URL.decode(fall.umschlag)))
                as? [String: Any])
        var fremd = json
        fremd["k"] = UUID().uuidString.lowercased()
        let fremderUmschlag = try XCTUnwrap(
            PushNutzlast.umschlag(Base64URL.encode(try JSONSerialization.data(withJSONObject: fremd))))
        XCTAssertNil(Entschluesseler.oeffnen(fremderUmschlag, schluessel: schluessel))
    }

    /// `POST /api/ios-push/abmelden` prüft `nachweis` wie `src/ios_push/krypto.rs::nachweis`.
    func testNachweisWieDerServer() throws {
        for fall in try faelle() {
            let schluessel = try XCTUnwrap(Base64URL.decode(fall.schluessel), fall.beschreibung)
            XCTAssertEqual(
                Entschluesseler.nachweis(kennung: fall.kennung, schluessel: schluessel), fall.nachweis,
                fall.beschreibung)
        }
    }

    func testEinNeuerSchluesselHat32ZufaelligeByte() {
        let a = Entschluesseler.neuerSchluessel()
        let b = Entschluesseler.neuerSchluessel()
        XCTAssertEqual(a.count, 32)
        XCTAssertEqual(b.count, 32)
        XCTAssertNotEqual(a, b)
    }
}
