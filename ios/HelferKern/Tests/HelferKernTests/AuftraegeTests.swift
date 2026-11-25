import Foundation
import XCTest

@testable import HelferKern

/// Aufträge über die gemeinsamen Fälle hinaus (ADR-0106): Wire-Format, mehrere Zeilen, Stand
/// während der Quittung, Texte.
final class AuftraegeTests: XCTestCase {
    private func auftrag(
        id: Int64 = 1, erteilt: String = "2026-11-25 10:00:00", aufgehoben: String? = nil,
        zeilen: [HelferAuftrag.Empfaenger] = [.init(id: 101, kind: "unit", label: "San-Trupp 2")]
    ) -> HelferAuftrag {
        HelferAuftrag(
            id: id, number: id, text: "Auftrag \(id)", issuedAt: erteilt, cancelledAt: aufgehoben,
            recipients: zeilen)
    }

    func testDieListeKommtAusDerAntwortDesServers() throws {
        let json = #"""
            {"tasks":[{"id":7,"number":3,"text":"Verletzte Person, Zelt 3","location":"Zelt 3",
            "location_lat":50.1,"location_lon":8.6,"priority":"sofort",
            "deadline_at":"2026-11-25 10:30:00","issued_at":"2026-11-25 10:00:00",
            "cancelled_at":null,"recipients":[{"id":101,"kind":"unit","label":"San-Trupp 2",
            "acknowledged_at":null,"acknowledged_by":null}]}]}
            """#
        let liste = try XCTUnwrap(Auftraege.liste(aus: Data(json.utf8)))
        XCTAssertEqual(liste.count, 1)
        let a = liste[0]
        XCTAssertEqual(a.id, 7)
        XCTAssertEqual(a.number, 3)
        XCTAssertEqual(a.locationLat, 50.1)
        XCTAssertEqual(a.prioritaet, .sofort)
        XCTAssertEqual(a.frist, Serverzeit.datum("2026-11-25 10:30:00"))
        XCTAssertEqual(a.recipients.first?.label, "San-Trupp 2")
        XCTAssertTrue(a.isOffen)
        XCTAssertNil(Auftraege.liste(aus: Data("kein json".utf8)))
    }

    /// Einheit und Person derselben Kopplung: offen, solange eine Zeile offen ist.
    func testMitZweiZeilenBleibtDerAuftragOffenBisBeideQuittiertSind() {
        let teils = auftrag(zeilen: [
            .init(id: 1, kind: "unit", label: "San-Trupp 2", acknowledgedAt: "2026-11-25 10:01:00",
                acknowledgedBy: "Max M."),
            .init(id: 2, kind: "person", label: "Max Mustermann"),
        ])
        XCTAssertTrue(teils.isOffen)
        XCTAssertEqual(Auftraege.offene([teils]), 1)
        let beide = auftrag(zeilen: [
            .init(id: 1, kind: "unit", label: "San-Trupp 2", acknowledgedAt: "2026-11-25 10:01:00"),
            .init(id: 2, kind: "person", label: "Max", acknowledgedAt: "2026-11-25 10:02:00"),
        ])
        XCTAssertFalse(beide.isOffen)
        XCTAssertEqual(Auftraege.offene([beide]), 0)
    }

    func testDerStandWaehrendDerQuittung() {
        let a = auftrag()
        let zeile = a.recipients[0]
        XCTAssertEqual(Quittungsstand.aus(a, empfaenger: zeile, sendet: true, fehler: nil), .sendet)
        XCTAssertEqual(
            Quittungsstand.aus(a, empfaenger: zeile, sendet: false, fehler: "x"), .fehler("x"))
        XCTAssertTrue(Quittungsstand.fehler("x").kannQuittieren)
        XCTAssertFalse(Quittungsstand.sendet.kannQuittieren)
        // Was der Server kennt, geht vor: aufgehoben bleibt aufgehoben, auch mit Fehler.
        let weg = auftrag(aufgehoben: "2026-11-25 10:05:00")
        XCTAssertEqual(
            Quittungsstand.aus(weg, empfaenger: weg.recipients[0], sendet: false, fehler: "x"),
            .aufgehoben)
        XCTAssertFalse(Quittungsstand.aufgehoben.kannQuittieren)
    }

    func testOhneZeileGiltDerAuftragSelbst() {
        XCTAssertEqual(Quittungsstand.aus(auftrag(zeilen: [])), .offen)
        XCTAssertEqual(
            Quittungsstand.aus(auftrag(aufgehoben: "2026-11-25 10:05:00", zeilen: [])), .aufgehoben)
    }

    func testDieTexteDerQuittung() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let um = try XCTUnwrap(Serverzeit.datum("2026-11-25 14:32:00"))
        XCTAssertEqual(
            AuftragAnzeige.quittiert(um: um, von: "Max M.", eigenerName: "Max M.", zeitzone: utc),
            "Übernommen um 14:32")
        XCTAssertEqual(
            AuftragAnzeige.quittiert(um: um, von: "Lisa K.", eigenerName: "Max M.", zeitzone: utc),
            "Übernommen von Lisa K. um 14:32")
        XCTAssertEqual(
            AuftragAnzeige.quittiert(um: nil, von: nil, eigenerName: nil, zeitzone: utc),
            "Übernommen")
        let offen = HelferAuftrag.Empfaenger(id: 1, kind: "unit", label: "San-Trupp 2")
        XCTAssertNil(AuftragAnzeige.quittungstext(offen, eigenerName: "Max M.", zeitzone: utc))
        let berlin = try XCTUnwrap(TimeZone(identifier: "Europe/Berlin"))
        XCTAssertEqual(AuftragAnzeige.uhrzeit(um, zeitzone: berlin), "15:32")
    }

    func testFesteTexte() {
        XCTAssertEqual(AuftragAnzeige.leer, "Keine Aufträge. Neue Aufträge kommen als Mitteilung.")
        XCTAssertEqual(
            AuftragAnzeige.mitteilungenAus,
            "Mitteilungen aus — du bekommst Aufträge nur bei offener App")
        XCTAssertEqual(AuftragAnzeige.quittungFehlgeschlagen, "Bitte über Funk bestätigen")
        XCTAssertEqual(AuftragAnzeige.knopf, "Übernommen")
        XCTAssertEqual(
            AuftragAnzeige.empfaenger(.init(id: 1, kind: "person", label: "Max")), "an dich")
        XCTAssertEqual(
            AuftragAnzeige.empfaenger(.init(id: 1, kind: "vehicle", label: "RTW 1")), "RTW 1")
        XCTAssertEqual(AuftragAnzeige.kurz(auftrag(aufgehoben: "2026-11-25 10:05:00")), "aufgehoben")
    }

    func testAuftraegeGibtEsNurBestaetigt() {
        XCTAssertTrue(Phase.aktiv.zeigtAuftraege)
        XCTAssertTrue(Phase.pausiert.zeigtAuftraege)
        XCTAssertTrue(Phase.ruht(.keineRolle).zeigtAuftraege)
        XCTAssertFalse(Phase.unbestaetigt.zeigtAuftraege)
        XCTAssertFalse(Phase.start.zeigtAuftraege)
        XCTAssertFalse(Phase.beendet(.abgemeldet).zeigtAuftraege)
    }

    /// Kaltstart: das Tippen kommt vor dem Zustand vom Server und wartet, bis die Phase steht.
    func testEinTippenWartetBisDiePhaseBekanntIst() {
        XCTAssertEqual(Phase.start.meldungstipp, .warten)
        XCTAssertEqual(Phase.aktiv.meldungstipp, .oeffnen)
        XCTAssertEqual(Phase.pausiert.meldungstipp, .oeffnen)
        XCTAssertEqual(Phase.ruht(.keineRolle).meldungstipp, .oeffnen)
        XCTAssertEqual(Phase.unbestaetigt.meldungstipp, .verwerfen)
        XCTAssertEqual(Phase.anmelden.meldungstipp, .verwerfen)
        XCTAssertEqual(Phase.beendet(.abgemeldet).meldungstipp, .verwerfen)
    }

    /// Nur eine quittierte Zeile mit dem eigenen Namen (oder ohne Namen) ist eine eigene.
    func testEineFremdeQuittungIstNichtDieEigene() {
        let lisa = HelferAuftrag.Empfaenger(
            id: 1, kind: "unit", label: "San-Trupp 2", acknowledgedAt: "2026-11-25 10:01:00",
            acknowledgedBy: "Lisa K.")
        XCTAssertFalse(Auftraege.istEigeneQuittung(lisa, eigenerName: "Max M."))
        XCTAssertTrue(Auftraege.istEigeneQuittung(lisa, eigenerName: " Lisa K. "))
        let offen = HelferAuftrag.Empfaenger(id: 2, kind: "person", label: "Max")
        XCTAssertFalse(Auftraege.istEigeneQuittung(offen, eigenerName: "Max M."))
    }

    func testEinUnbekannterKlartextIstKeinAuftrag() {
        let falsch = [
            #"{"v":2,"art":"auftrag","e":1,"t":1,"titel":"x"}"#,
            #"{"v":1,"art":"alarm","e":1,"t":1,"titel":"x"}"#,
            #"{"v":1,"art":"auftrag","e":1,"titel":"x"}"#,
            #"{"v":1,"art":"auftrag","e":1,"t":1,"titel":"  "}"#,
            #"{"v":1,"art":"auftrag","e":"1","t":1,"titel":"x"}"#,
            "kein json",
        ]
        for text in falsch {
            XCTAssertNil(PagerNutzlast.klartext(Data(text.utf8)), text)
        }
        // Einsatz 1 und Auftrag 0 bleiben Zahlen (kein Brücken zu Bool).
        let k = PagerNutzlast.klartext(
            Data(#"{"v":1,"art":"auftrag","e":1,"t":0,"titel":"x"}"#.utf8))
        XCTAssertEqual(k?.einsatzId, 1)
        XCTAssertEqual(k?.auftragId, 0)
        XCTAssertNil(k?.text)
    }
}
