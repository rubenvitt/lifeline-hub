import XCTest

@testable import HelferKern

/// Wachsender Abstand der Wiederholung: 5, 10, 20, 40, dann höchstens jede Minute (ADR-0101).
final class WiederholungTests: XCTestCase {
    func testDerAbstandWaechstBisZurObergrenzeVon60Sekunden() {
        var w = Wiederholung()
        let abstaende = (0..<8).map { _ in w.naechsterAbstandS() }
        XCTAssertEqual(abstaende, [5, 10, 20, 40, 60, 60, 60, 60])
    }

    func testZuruecksetzenBeginntWiederBei5Sekunden() {
        var w = Wiederholung()
        for _ in 0..<4 { _ = w.naechsterAbstandS() }
        w.zuruecksetzen()
        XCTAssertEqual(w.naechsterAbstandS(), 5)
        XCTAssertEqual(w.naechsterAbstandS(), 10)
    }

    func testSehrVieleFehlerInFolgeLaufenNichtUeber() {
        var w = Wiederholung()
        for _ in 0..<10_000 { XCTAssertTrue((5...60).contains(w.naechsterAbstandS())) }
    }
}
