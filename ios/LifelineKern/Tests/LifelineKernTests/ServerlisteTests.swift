import Foundation
import XCTest

@testable import LifelineKern

/// Serverliste der iOS-App (Spec `ios-huelle`, „Mehrere Server lassen sich verwalten“).
final class ServerlisteTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443")
    let fuekw = try! ServerAdresse.parse("https://fuekw.local")

    func testDerErsteServerWirdAktivUndHeisstWieSeinHost() {
        var liste = Serverliste()
        let eintrag = liste.add(elw)
        XCTAssertEqual(eintrag.name, "elw.local")
        XCTAssertEqual(eintrag.adresse, elw)
        XCTAssertNil(eintrag.zuletztVerbunden)
        XCTAssertNil(eintrag.bestaetigterVertrag)
        XCTAssertEqual(liste.aktiv, eintrag)
        XCTAssertEqual(liste.eintraege, [eintrag])
    }

    func testEinWeitererServerLaesstDenAktivenAktiv() {
        var liste = Serverliste()
        let erster = liste.add(elw)
        let zweiter = liste.add(fuekw, name: "FüKW")
        XCTAssertEqual(zweiter.name, "FüKW")
        XCTAssertEqual(liste.aktiv?.id, erster.id)
        XCTAssertEqual(liste.eintraege.map(\.id), [erster.id, zweiter.id])
    }

    func testDieselbeAdresseZweimalGibtKeinenZweitenEintrag() throws {
        var liste = Serverliste()
        let erster = liste.add(elw)
        let nochmal = liste.add(try ServerAdresse.parse("https://ELW.local:8443/"))
        XCTAssertEqual(nochmal.id, erster.id)
        XCTAssertEqual(liste.eintraege.count, 1)
        XCTAssertEqual(liste.eintrag(fuer: elw)?.id, erster.id)
        XCTAssertNil(liste.eintrag(fuer: fuekw))
    }

    func testUmbenennenUndLeererNameFaelltAufDenHostZurueck() throws {
        var liste = Serverliste()
        let eintrag = liste.add(elw)
        try liste.rename(eintrag.id, to: "  ELW 1  ")
        XCTAssertEqual(liste.aktiv?.name, "ELW 1")
        try liste.rename(eintrag.id, to: "   ")
        XCTAssertEqual(liste.aktiv?.name, "elw.local")
        XCTAssertThrowsError(try liste.rename(UUID(), to: "x")) {
            XCTAssertEqual($0 as? Serverliste.ListError, .unbekannt)
        }
    }

    func testWechselnMachtDenGewaehltenAktiv() throws {
        var liste = Serverliste()
        liste.add(elw)
        let zweiter = liste.add(fuekw)
        try liste.activate(zweiter.id)
        XCTAssertEqual(liste.aktiv?.id, zweiter.id)
        XCTAssertThrowsError(try liste.activate(UUID()))
    }

    func testDerAktiveServerLaesstSichErstNachEinemWechselEntfernen() throws {
        var liste = Serverliste()
        let erster = liste.add(elw)
        let zweiter = liste.add(fuekw)
        XCTAssertThrowsError(try liste.remove(erster.id)) {
            XCTAssertEqual($0 as? Serverliste.ListError, .aktivNichtEntfernbar)
        }
        XCTAssertEqual(liste.eintraege.count, 2)
        try liste.activate(zweiter.id)
        try liste.remove(erster.id)
        XCTAssertEqual(liste.eintraege.map(\.id), [zweiter.id])
        XCTAssertThrowsError(try liste.remove(erster.id)) {
            XCTAssertEqual($0 as? Serverliste.ListError, .unbekannt)
        }
    }

    func testVerbundenMerktZeitpunktUndBestaetigtenVertrag() throws {
        var liste = Serverliste()
        let eintrag = liste.add(elw)
        let zeit = Date(timeIntervalSince1970: 1_800_000_000)
        try liste.markVerbunden(eintrag.id, am: zeit, vertrag: 1)
        XCTAssertEqual(liste.aktiv?.zuletztVerbunden, zeit)
        XCTAssertEqual(liste.aktiv?.bestaetigterVertrag, 1)
    }

    func testDieListeLaesstSichSpeichernUndWiederLesen() throws {
        var liste = Serverliste()
        let erster = liste.add(elw)
        liste.add(fuekw, name: "FüKW")
        try liste.markVerbunden(erster.id, am: Date(timeIntervalSince1970: 1_800_000_000), vertrag: 1)
        let daten = try JSONEncoder().encode(liste)
        XCTAssertEqual(try JSONDecoder().decode(Serverliste.self, from: daten), liste)
    }

    /// Eine von Hand verfälschte Datei mit einem aktiven Server, den es nicht gibt, darf die App
    /// nicht auf einen Geisterserver setzen.
    func testEinAktiverOhneEintragGiltAlsKeiner() throws {
        let json = #"{"eintraege":[],"aktivID":"6F1C2A9E-8D3B-4E7A-9C55-0B1D2E3F4A5B"}"#
        let liste = try JSONDecoder().decode(Serverliste.self, from: Data(json.utf8))
        XCTAssertNil(liste.aktiv)
    }
}
