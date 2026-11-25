import Foundation
import XCTest

@testable import HelferKern

/// Puffer ohne Netz: nur die letzte Position, höchstens 10 Minuten alt.
final class PufferTests: XCTestCase {
    let jetzt = Date(timeIntervalSince1970: 1_800_000_000)

    func position(vor sekunden: Double, lat: Double = 50.1) -> Position {
        Position(latitude: lat, longitude: 8.6, accuracy: 5, recordedAt: jetzt - sekunden)
    }

    func testEinePositionVor601SekundenIstNichtMehrFaellig() {
        var puffer = Puffer()
        puffer.merke(position(vor: 601))
        XCTAssertNil(puffer.faellig(jetzt: jetzt))
    }

    func testEinePositionJuengerAlsZehnMinutenIstFaellig() {
        var puffer = Puffer()
        let p = position(vor: 599)
        puffer.merke(p)
        XCTAssertEqual(puffer.faellig(jetzt: jetzt), p)
    }

    func testGenauZehnMinutenSindZuAlt() {
        var puffer = Puffer()
        puffer.merke(position(vor: 600))
        XCTAssertNil(puffer.faellig(jetzt: jetzt))
    }

    func testNurDieLetztePositionBleibt() {
        var puffer = Puffer()
        puffer.merke(position(vor: 90, lat: 50.1))
        puffer.merke(position(vor: 60, lat: 50.2))
        let letzte = position(vor: 30, lat: 50.3)
        puffer.merke(letzte)
        XCTAssertEqual(puffer.letzte, letzte)
        XCTAssertEqual(puffer.faellig(jetzt: jetzt), letzte)
    }

    func testEineAeltereMessungErsetztDieGemerkteNicht() {
        var puffer = Puffer()
        let neu = position(vor: 10)
        puffer.merke(neu)
        puffer.merke(position(vor: 40))
        XCTAssertEqual(puffer.letzte, neu)
    }

    func testLeereVergisstDiePosition() {
        var puffer = Puffer()
        puffer.merke(position(vor: 10))
        puffer.leere()
        XCTAssertNil(puffer.faellig(jetzt: jetzt))
        XCTAssertNil(puffer.letzte)
    }

    func testOhneGemerktePositionIstNichtsFaellig() {
        XCTAssertNil(Puffer().faellig(jetzt: jetzt))
    }
}
