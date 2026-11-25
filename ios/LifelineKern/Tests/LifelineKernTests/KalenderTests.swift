import Foundation
import XCTest

@testable import LifelineKern

/// Kalenderdateien gegen die gemeinsamen Fälle (`src-tauri/faelle/kalender.json`, LLH-2127).
final class KalenderTests: XCTestCase {
    struct Datei: Decodable {
        let oeffnen_als: [OeffnenFall]
        let termin: TerminFall
        let lesen: [Lesefall]
    }

    struct Erwartet: Decodable {
        let titel: String
        let beginn: String
        let ende: String
        let erinnerung_minuten: Int?
    }

    struct TerminFall: Decodable {
        let beschreibung: String
        let ics: String
        let erwartet: Erwartet
    }

    struct Lesefall: Decodable {
        let beschreibung: String
        let ics: String
        let erwartet: Erwartet?
    }

    func termin(_ erwartet: Erwartet) throws -> IcsTermin {
        let format = ISO8601DateFormatter()
        return IcsTermin(
            titel: erwartet.titel,
            beginn: try XCTUnwrap(format.date(from: erwartet.beginn)),
            ende: try XCTUnwrap(format.date(from: erwartet.ende)),
            erinnerung: erwartet.erinnerung_minuten.map { TimeInterval($0 * 60) })
    }

    struct OeffnenFall: Decodable {
        let beschreibung: String
        let mimetyp: String
        let endung: String
        let erwartet: String
    }

    func testJederGemeinsameFallFuerOeffnenAlsGilt() throws {
        let faelle = try GemeinsameFaelle.load("kalender.json", as: Datei.self).oeffnen_als
        XCTAssertFalse(faelle.isEmpty)
        for fall in faelle {
            XCTAssertEqual(
                Downloadablage.oeffnenAls(mimetyp: fall.mimetyp, endung: fall.endung).rawValue,
                fall.erwartet, fall.beschreibung)
        }
    }

    /// Was der Server erzeugt, liest der Kern; `src/lagebesprechung/ics.rs` hält die Datei fest.
    func testDerServerFallWirdGelesen() throws {
        let fall = try GemeinsameFaelle.load("kalender.json", as: Datei.self).termin
        XCTAssertEqual(IcsTermin.lies(fall.ics), try termin(fall.erwartet), fall.beschreibung)
    }

    func testJederLesefallGilt() throws {
        let faelle = try GemeinsameFaelle.load("kalender.json", as: Datei.self).lesen
        XCTAssertFalse(faelle.isEmpty)
        for fall in faelle {
            XCTAssertEqual(IcsTermin.lies(fall.ics), try fall.erwartet.map(termin), fall.beschreibung)
        }
    }

    func testEineRiesigeErinnerungLaeuftNichtUeber() {
        XCTAssertEqual(IcsTermin.vorlauf("-PT9223372036854775807H"), TimeInterval(Int.max) * 3600)
        XCTAssertNil(IcsTermin.vorlauf("-PT99999999999999999999H"))
        XCTAssertNil(IcsTermin.vorlauf("PT10M"))
        XCTAssertNil(IcsTermin.vorlauf("-PTM"))
    }
}
