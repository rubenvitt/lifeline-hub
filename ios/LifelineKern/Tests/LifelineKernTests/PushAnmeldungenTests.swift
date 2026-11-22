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

    /// Entfernt die App einen Server, bleibt seine Abmeldung liegen, bis der Server sie
    /// bestätigt: sonst pusht er weiter, und die Meldungen ließen sich nicht mehr abstellen.
    func testEntfernenMitAbmeldungLegtSieAbBisSieErledigtIst() throws {
        var anmeldungen = PushAnmeldungen()
        let a = UUID()
        let b = UUID()
        let adresse = try ServerAdresse.parse("https://elw.example")
        let kennungA = anmeldungen.kennung(fuer: a)
        let kennungB = anmeldungen.kennung(fuer: b)
        XCTAssertEqual(anmeldungen.ausstehend, [])
        XCTAssertEqual(anmeldungen.entfernen(server: a, abmeldenBei: adresse), [kennungA])
        XCTAssertEqual(
            anmeldungen.ausstehend, [AusstehendeAbmeldung(kennung: kennungA, adresse: adresse)])
        // Die Extension kennt den Server nicht mehr und zeigt den Rückfall.
        XCTAssertNil(anmeldungen.server(zu: kennungA))
        XCTAssertNil(anmeldungen.vorhandeneKennung(fuer: a))
        XCTAssertEqual(anmeldungen.entfernen(server: a, abmeldenBei: adresse), [])
        XCTAssertEqual(anmeldungen.ausstehend.count, 1, "ohne Kennung nichts Neues")
        anmeldungen.abgemeldet(kennung: UUID().uuidString)
        XCTAssertEqual(anmeldungen.ausstehend.count, 1)
        anmeldungen.abgemeldet(kennung: kennungA)
        XCTAssertEqual(anmeldungen.ausstehend, [])
        XCTAssertEqual(anmeldungen.server(zu: kennungB), b)
    }

    /// `push_unregister` der Seite: dort hat die Oberfläche schon abgemeldet; nichts bleibt
    /// liegen.
    func testEntfernenOhneAbmeldungLegtNichtsAb() {
        var anmeldungen = PushAnmeldungen()
        let a = UUID()
        let kennung = anmeldungen.kennung(fuer: a)
        XCTAssertEqual(anmeldungen.entfernen(server: a), [kennung])
        XCTAssertEqual(anmeldungen.ausstehend, [])
    }

    /// Erledigt ist eine Abmeldung, wenn der Server antwortet und ein neuer Versuch nichts ändern
    /// würde (2xx; 4xx wie 404 ohne iOS-Push oder 403); ohne Antwort, bei 5xx, 408 und 429 bleibt
    /// sie für den nächsten Anlass liegen.
    func testErledigtNachDerAntwortDesServers() {
        for status in [200, 204, 400, 403, 404, 410, 422] {
            XCTAssertTrue(AusstehendeAbmeldung.isErledigt(status: status), "\(status)")
        }
        for status: Int? in [nil, 301, 408, 429, 500, 502, 503] {
            XCTAssertFalse(
                AusstehendeAbmeldung.isErledigt(status: status), "\(String(describing: status))")
        }
    }

    func testAusstehendeAbmeldungenUeberstehenSpeichernUndLaden() throws {
        let verzeichnis = FileManager.default.temporaryDirectory
            .appendingPathComponent("push-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: verzeichnis) }
        let ablage = Pushablage(verzeichnis: verzeichnis)
        var anmeldungen = PushAnmeldungen()
        let server = UUID()
        _ = anmeldungen.kennung(fuer: UUID())
        _ = anmeldungen.kennung(fuer: server)
        let adresse = try ServerAdresse.parse("https://elw.example")
        anmeldungen.entfernen(server: server, abmeldenBei: adresse)
        try ablage.save(anmeldungen)
        XCTAssertEqual(try ablage.load(), anmeldungen)
        XCTAssertEqual(try ablage.load().ausstehend.count, 1)
    }

    /// Eine `push.json` von vor den ausstehenden Abmeldungen bleibt lesbar.
    func testAlteAblageOhneAusstehendeBleibtLesbar() throws {
        let verzeichnis = FileManager.default.temporaryDirectory
            .appendingPathComponent("push-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: verzeichnis) }
        let ablage = Pushablage(verzeichnis: verzeichnis)
        var anmeldungen = PushAnmeldungen()
        let server = UUID()
        let kennung = anmeldungen.kennung(fuer: server)
        try ablage.save(anmeldungen)
        var json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: ablage.datei)) as? [String: Any])
        json.removeValue(forKey: "ausstehend")
        XCTAssertEqual(Set(json.keys), ["kennungen"])
        try JSONSerialization.data(withJSONObject: json).write(to: ablage.datei)
        let gelesen = try ablage.load()
        XCTAssertEqual(gelesen.server(zu: kennung), server)
        XCTAssertEqual(gelesen.ausstehend, [])
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
