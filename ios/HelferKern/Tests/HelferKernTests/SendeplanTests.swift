import Foundation
import XCTest

@testable import HelferKern

/// Was der Ortungsdienst wann sendet (Spec „Senden, Takt, ohne Netz“): Takt, Puffer und
/// Wiederholung zusammen; Gegenstück `SendeplanTest.kt` in `android/helferkern`.
final class SendeplanTests: XCTestCase {
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    func um(_ s: Double) -> Date { start.addingTimeInterval(s) }

    /// Position `nordM` Meter nördlich des Startpunkts, gemessen bei `s` Sekunden.
    func position(_ s: Double, nordM: Double = 0) -> Position {
        Position(latitude: 50 + nordM / 111_195, longitude: 8.6, accuracy: 5, recordedAt: um(s))
    }

    func testDieErsteMessungGehtSofortRaus() {
        var plan = Sendeplan()
        let p = position(0)
        XCTAssertEqual(plan.messung(p, jetzt: um(0)), p)
    }

    func testOhneBewegungGehtVorDemLebenszeichenNichtsRaus() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.weiter, jetzt: um(1))
        XCTAssertNil(plan.messung(position(40, nordM: 5), jetzt: um(40)))
        XCTAssertFalse(plan.lebenszeichen(jetzt: um(200)))
    }

    func testDasLebenszeichenFordertEineFrischeMessungAnUndSendetNieDieAlteMitNeuerZeit() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.weiter, jetzt: um(0))
        XCTAssertNil(plan.messung(position(100, nordM: 3), jetzt: um(100)))
        XCTAssertTrue(plan.lebenszeichen(jetzt: um(300)))
        XCTAssertFalse(plan.lebenszeichen(jetzt: um(310)), "die Anforderung läuft noch")
        XCTAssertNil(plan.versuch(jetzt: um(320)), "ohne frische Messung geht nichts raus")
        let zeichen = plan.messung(position(325, nordM: 2), jetzt: um(326))
        XCTAssertEqual(zeichen?.recordedAt, um(325), "die Zeit der Messung, nicht die der Uhr")
    }

    func testEineZwischengespeicherteMessungGehtNichtNochEinmalRaus() {
        var plan = Sendeplan()
        let p = position(0)
        _ = plan.messung(p, jetzt: um(0))
        _ = plan.antwort(.weiter, jetzt: um(1))
        XCTAssertTrue(plan.lebenszeichen(jetzt: um(301)))
        XCTAssertNil(plan.messung(p, jetzt: um(302)))
        XCTAssertNil(plan.messung(position(0, nordM: 50), jetzt: um(303)), "gleich alt ist nicht neuer")
    }

    func testWaehrendEinerSendungFordertDasLebenszeichenNichtsAn() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.weiter, jetzt: um(0))
        _ = plan.messung(position(400, nordM: 1), jetzt: um(400))
        XCTAssertFalse(plan.lebenszeichen(jetzt: um(401)))
    }

    func testBewegungUeber25MeterNach30SekundenGehtRaus() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.weiter, jetzt: um(0))
        XCTAssertNil(plan.messung(position(20, nordM: 40), jetzt: um(20)), "zu früh")
        let p = position(31, nordM: 40)
        XCTAssertEqual(plan.messung(p, jetzt: um(31)), p)
    }

    func testWaehrendEinerSendungGehtKeineZweiteRausDieNeuereFolgtNachDerAntwort() {
        var plan = Sendeplan(takt: Takt(mindestabstandS: 0, bewegungM: 0))
        _ = plan.messung(position(0), jetzt: um(0))
        let neuer = position(1, nordM: 50)
        XCTAssertNil(plan.messung(neuer, jetzt: um(1)))
        XCTAssertEqual(plan.antwort(.weiter, jetzt: um(2)), neuer)
    }

    func testEinFehlerPlantDenNaechstenVersuchMitWachsendemAbstand() {
        var plan = Sendeplan()
        let p = position(0)
        _ = plan.messung(p, jetzt: um(0))
        XCTAssertNil(plan.antwort(.wiederholen, jetzt: um(0)))
        XCTAssertEqual(plan.naechsterVersuch, um(5))
        XCTAssertNil(plan.versuch(jetzt: um(4)), "noch nicht dran")
        XCTAssertEqual(plan.versuch(jetzt: um(5)), p)
        _ = plan.antwort(.wiederholen, jetzt: um(5))
        XCTAssertEqual(plan.naechsterVersuch, um(15))
    }

    func testNachZehnMinutenOhneNetzVerfaelltDieGepuffertePosition() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.wiederholen, jetzt: um(0))
        XCTAssertNil(plan.versuch(jetzt: um(601)))
        XCTAssertNil(plan.naechsterVersuch)
    }

    func testEinErfolgSetztDenAbstandZurueck() {
        var plan = Sendeplan(takt: Takt(mindestabstandS: 0, bewegungM: 0))
        _ = plan.messung(position(0), jetzt: um(0))
        _ = plan.antwort(.wiederholen, jetzt: um(0))
        _ = plan.versuch(jetzt: um(5))
        _ = plan.antwort(.weiter, jetzt: um(6))
        _ = plan.messung(position(7, nordM: 10), jetzt: um(7))
        _ = plan.antwort(.wiederholen, jetzt: um(7))
        XCTAssertEqual(plan.naechsterVersuch, um(12))
    }

    func testVerwerfenVergisstNurDiesePosition() {
        var plan = Sendeplan()
        _ = plan.messung(position(0), jetzt: um(0))
        XCTAssertNil(plan.antwort(.verwerfen, jetzt: um(1)))
        XCTAssertNil(plan.naechsterVersuch)
        XCTAssertNotNil(plan.messung(position(2), jetzt: um(2)))
    }

    func testStoppenUndRuhenVergessenAlles() {
        for antwort in [Antwort.stoppen, .ruhen] {
            var plan = Sendeplan()
            _ = plan.messung(position(0), jetzt: um(0))
            XCTAssertNil(plan.antwort(antwort, jetzt: um(1)))
            XCTAssertFalse(plan.lebenszeichen(jetzt: um(1000)), "\(antwort)")
            XCTAssertNil(plan.naechsterVersuch)
            XCTAssertNotNil(plan.messung(position(1001), jetzt: um(1001)), "\(antwort)")
        }
    }

    func testDerAbstandRechnetAufDerKugel() {
        let a = Position(latitude: 50, longitude: 8.6, recordedAt: start)
        let b = Position(latitude: 51, longitude: 8.6, recordedAt: start)
        let m = abstandM(a, b)
        XCTAssertTrue((111_100...111_300).contains(m), "ein Breitengrad sind rund 111,2 km, gemessen \(m)")
        XCTAssertEqual(abstandM(a, a), 0)
    }
}
