import XCTest

@testable import LifelineKern

/// Haptik-Abbildung (Spec `ios-huelle`, „Haptik nur auf Wunsch der Seite und abschaltbar“;
/// Spec `huellen-vertrag`, „Haptik kennt fünf Arten und wirft nie“).
final class HaptikTests: XCTestCase {
    func testJedeArtHatIhreRueckmeldung() {
        let soll: [String: Haptik.Feedback] = [
            "success": .success,
            "warning": .warning,
            "error": .error,
            "selection": .selection,
            "tap": .lightImpact,
        ]
        for (kind, feedback) in soll {
            XCTAssertEqual(Haptik.feedback(kind: kind, isEnabled: true), feedback, kind)
        }
        XCTAssertEqual(Set(Haptik.Feedback.allCases), Set(soll.values))
    }

    func testEineUnbekannteArtTutNichts() {
        for kind in ["unknown", "", "Success", " tap", "impact"] {
            XCTAssertNil(Haptik.feedback(kind: kind, isEnabled: true), kind)
        }
    }

    func testAusgeschaltetTutHaptikNichts() {
        for kind in ["success", "warning", "error", "selection", "tap"] {
            XCTAssertNil(Haptik.feedback(kind: kind, isEnabled: false), kind)
        }
    }
}
