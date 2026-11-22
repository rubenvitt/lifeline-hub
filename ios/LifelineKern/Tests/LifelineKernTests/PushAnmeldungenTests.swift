import XCTest

@testable import LifelineKern

/// Anmeldungen am Push-Kanal je Server (`PushAnmeldungen`): eine stabile Kennung je Server, die
/// Zuordnung zurück und das Entfernen mit allen betroffenen Kennungen.
final class PushAnmeldungenTests: XCTestCase {
    func testKennungIstJeServerStabil() {
        var anmeldungen = PushAnmeldungen()
        let a = UUID()
        let b = UUID()
        let kennungA = anmeldungen.kennung(fuer: a)
        XCTAssertEqual(anmeldungen.kennung(fuer: a), kennungA)
        XCTAssertNotEqual(anmeldungen.kennung(fuer: b), kennungA)
        XCTAssertNotNil(UUID(uuidString: kennungA))
        XCTAssertEqual(anmeldungen.server(zu: kennungA), a)
        XCTAssertNil(anmeldungen.server(zu: UUID().uuidString))
    }

    /// `push_state` fragt nur nach und darf dabei keine Kennung anlegen.
    func testVorhandeneKennungLegtKeineAn() {
        var anmeldungen = PushAnmeldungen()
        let server = UUID()
        XCTAssertNil(anmeldungen.vorhandeneKennung(fuer: server))
        XCTAssertEqual(anmeldungen, PushAnmeldungen())
        let kennung = anmeldungen.kennung(fuer: server)
        XCTAssertEqual(anmeldungen.vorhandeneKennung(fuer: server), kennung)
        anmeldungen.entfernen(server: server)
        XCTAssertNil(anmeldungen.vorhandeneKennung(fuer: server))
    }

    func testEntfernenLiefertDieKennungenDesServers() {
        var anmeldungen = PushAnmeldungen()
        let a = UUID()
        let b = UUID()
        let kennungA = anmeldungen.kennung(fuer: a)
        let kennungB = anmeldungen.kennung(fuer: b)
        XCTAssertEqual(anmeldungen.entfernen(server: a), [kennungA])
        XCTAssertNil(anmeldungen.server(zu: kennungA))
        XCTAssertEqual(anmeldungen.server(zu: kennungB), b)
        XCTAssertEqual(anmeldungen.entfernen(server: a), [])
        // Nach dem Entfernen entsteht eine neue Kennung, nie die alte.
        XCTAssertNotEqual(anmeldungen.kennung(fuer: a), kennungA)
    }

    func testDieAnmeldungenUeberstehenSpeichernUndLaden() throws {
        let verzeichnis = FileManager.default.temporaryDirectory
            .appendingPathComponent("push-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: verzeichnis) }
        let ablage = Pushablage(verzeichnis: verzeichnis)
        XCTAssertEqual(try ablage.load(), PushAnmeldungen())
        var anmeldungen = PushAnmeldungen()
        let server = UUID()
        let kennung = anmeldungen.kennung(fuer: server)
        try ablage.save(anmeldungen)
        let gelesen = try ablage.load()
        XCTAssertEqual(gelesen, anmeldungen)
        XCTAssertEqual(gelesen.server(zu: kennung), server)
        XCTAssertEqual(ablage.datei.lastPathComponent, "push.json")
    }
}
