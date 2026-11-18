import XCTest

@testable import LifelineKern

final class GeruestTests: XCTestCase {
    /// Platzhalter des Gerüsts (Aufgabe 6.1): das Modul baut und nennt seinen Hüllen-Vertrag.
    func testDasModulKenntDenErstenVertrag() {
        XCTAssertEqual(LifelineKern.bekannteVertraege, [1])
    }
}
