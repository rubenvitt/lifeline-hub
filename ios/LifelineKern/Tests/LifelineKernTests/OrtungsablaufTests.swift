import XCTest

@testable import LifelineKern

/// Was der Standortdienst bei Ereignissen des `CLLocationManager` tut (LLH-2082).
final class OrtungsablaufTests: XCTestCase {
    func testNochKeinStandortBeendetBeiLaufenderOrtungNiemanden() {
        XCTAssertEqual(
            Ortungsablauf.fehler(.locationUnknown, beobachtet: true, einmalWartend: true), .keine)
        XCTAssertEqual(
            Ortungsablauf.fehler(.locationUnknown, beobachtet: true, einmalWartend: false), .keine)
    }

    func testNochKeinStandortOhneOrtungBeendetDieEinzelabfrage() {
        XCTAssertEqual(
            Ortungsablauf.fehler(.locationUnknown, beobachtet: false, einmalWartend: true),
            Ortungsfolge(einmal: .unavailable, beobachtung: nil))
    }

    func testEineVerweigerungBeendetAlles() {
        XCTAssertEqual(
            Ortungsablauf.fehler(.denied, beobachtet: true, einmalWartend: true),
            Ortungsfolge(einmal: .denied, beobachtung: .denied))
        XCTAssertEqual(
            Ortungsablauf.fehler(.denied, beobachtet: false, einmalWartend: true),
            Ortungsfolge(einmal: .denied, beobachtung: nil))
    }

    func testAndereFehlerSindUnavailable() {
        XCTAssertEqual(
            Ortungsablauf.fehler(.andere, beobachtet: true, einmalWartend: true),
            Ortungsfolge(einmal: .unavailable, beobachtung: .unavailable))
        XCTAssertEqual(Ortungsablauf.fehler(.andere, beobachtet: false, einmalWartend: false), .keine)
    }

    func testFaelltDieFreigabeWegEndetDieLaufendeOrtungMitDenied() {
        XCTAssertEqual(
            Ortungsablauf.freigabe(erlaubt: false, beobachtet: true, einmalWartend: false),
            Ortungsfolge(einmal: nil, beobachtung: .denied))
        XCTAssertEqual(
            Ortungsablauf.freigabe(erlaubt: false, beobachtet: true, einmalWartend: true),
            Ortungsfolge(einmal: .denied, beobachtung: .denied))
    }

    func testEineErteilteFreigabeOderNiemandWartendTutNichts() {
        XCTAssertEqual(
            Ortungsablauf.freigabe(erlaubt: true, beobachtet: true, einmalWartend: true), .keine)
        XCTAssertEqual(
            Ortungsablauf.freigabe(erlaubt: false, beobachtet: false, einmalWartend: false), .keine)
    }

    func testNachDemStoppHoltDieAppDieWartendeEinzelabfrageSelbst() {
        XCTAssertTrue(Ortungsablauf.isRequestNachStopp(einmalWartend: true))
        XCTAssertFalse(Ortungsablauf.isRequestNachStopp(einmalWartend: false))
    }
}
