import Foundation
import XCTest

@testable import LifelineKern

/// Ablage der gespeicherten Oberfläche je Server (LLH-1980).
final class VorratsablageTests: XCTestCase {
    var verzeichnis: URL!
    var ablage: Vorratsablage!
    let elw = UUID()
    let lager = UUID()

    override func setUpWithError() throws {
        verzeichnis = FileManager.default.temporaryDirectory
            .appendingPathComponent("vorrat-\(UUID().uuidString)")
            .appendingPathComponent("Oberflaechen")
        ablage = Vorratsablage(verzeichnis: verzeichnis)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: verzeichnis.deletingLastPathComponent())
    }

    func oberflaeche(_ version: String) -> GespeicherteOberflaeche {
        GespeicherteOberflaeche(
            version: version, html: "<!doctype html><div id=\"root\"></div>",
            gespeichertAm: Date(timeIntervalSince1970: 1_790_000_000))
    }

    func testSpeichernUndLesen() throws {
        try ablage.save(oberflaeche("1.0"), fuer: elw)
        XCTAssertEqual(ablage.load(elw), oberflaeche("1.0"))
    }

    func testJederServerHatSeineEigene() throws {
        try ablage.save(oberflaeche("1.0"), fuer: elw)
        try ablage.save(oberflaeche("2.0"), fuer: lager)
        XCTAssertEqual(ablage.load(elw)?.version, "1.0")
        XCTAssertEqual(ablage.load(lager)?.version, "2.0")
    }

    func testOhneAblageNil() {
        XCTAssertNil(ablage.load(elw))
    }

    func testRemoveLoeschtNurDenEinen() throws {
        try ablage.save(oberflaeche("1.0"), fuer: elw)
        try ablage.save(oberflaeche("2.0"), fuer: lager)
        ablage.remove(elw)
        XCTAssertNil(ablage.load(elw))
        XCTAssertEqual(ablage.load(lager)?.version, "2.0")
    }

    func testRemoveOhneAblageIstKeinFehler() {
        ablage.remove(elw)
        XCTAssertNil(ablage.load(elw))
    }

    func testUnlesbareAblageGiltAlsLeer() throws {
        try ablage.save(oberflaeche("1.0"), fuer: elw)
        let datei = verzeichnis.appendingPathComponent("\(elw.uuidString).json")
        try Data("kaputt".utf8).write(to: datei)
        XCTAssertNil(ablage.load(elw))
    }
}
