import Foundation
import XCTest

@testable import LifelineKern

/// Laufende Beobachtungen des Standorts (LLH-2071): Positionen gehen nur an die Seite des Servers,
/// für den die Beobachtung begann, solange er aktiv ist; Navigation, Wechsel und Ende räumen auf.
final class StandortTests: XCTestCase {
    private let elw = try! ServerAdresse.parse("https://elw.local:8443")
    private let lager = try! ServerAdresse.parse("https://lager.example")
    private var seite: URL { URL(string: "https://elw.local:8443/einsaetze/1/lagekarte")! }

    func testDieErsteBeobachtungStartetUndDieGenauesteGilt() {
        var b = Standortbeobachtung()
        XCTAssertTrue(b.isLeer)
        XCTAssertEqual(b.start(id: 1, highAccuracy: false, timeout: nil, server: elw, jetzt: 0), .starte(highAccuracy: false))
        XCTAssertEqual(b.start(id: 2, highAccuracy: true, timeout: nil, server: elw, jetzt: 0), .starte(highAccuracy: true))
        XCTAssertEqual(b.start(id: 3, highAccuracy: false, timeout: nil, server: elw, jetzt: 0), .keine)
        XCTAssertFalse(b.isLeer)
    }

    func testClearDerLetztenStopptUndDieGenauigkeitSinkt() {
        var b = Standortbeobachtung()
        _ = b.start(id: 1, highAccuracy: false, timeout: nil, server: elw, jetzt: 0)
        _ = b.start(id: 2, highAccuracy: true, timeout: nil, server: elw, jetzt: 0)
        XCTAssertEqual(b.clear(watch: 2), .starte(highAccuracy: false))
        XCTAssertEqual(b.clear(watch: 99), .keine)
        XCTAssertEqual(b.clear(watch: 1), .stoppe)
        XCTAssertTrue(b.isLeer)
    }

    func testPositionenGehenNurAnDenAktivenServerUndSeineSeite() {
        var b = Standortbeobachtung()
        _ = b.start(id: 2, highAccuracy: false, timeout: nil, server: elw, jetzt: 0)
        _ = b.start(id: 1, highAccuracy: false, timeout: nil, server: elw, jetzt: 0)
        let ok = b.zustellen(aktiverServer: elw, seite: seite, jetzt: 1)
        XCTAssertEqual(ok.ids, [1, 2])
        XCTAssertEqual(ok.wirkung, .keine)
    }

    func testNachEinemServerwechselGehtNichtsMehrRaus() {
        var b = Standortbeobachtung()
        _ = b.start(id: 1, highAccuracy: false, timeout: nil, server: elw, jetzt: 0)
        let r = b.zustellen(aktiverServer: lager, seite: URL(string: "https://lager.example/")!, jetzt: 1)
        XCTAssertEqual(r.ids, [])
        XCTAssertEqual(r.wirkung, .stoppe)
        XCTAssertTrue(b.isLeer)
    }

    func testEineFremdeSeiteOderKeinServerBekommtNichts() {
        let faelle: [(ServerAdresse?, URL?)] = [
            (elw, URL(string: "https://idp.example/login")),
            (elw, nil),
            (nil, seite),
        ]
        for (aktiv, seite) in faelle {
            var b = Standortbeobachtung()
            _ = b.start(id: 1, highAccuracy: false, timeout: nil, server: elw, jetzt: 0)
            let r = b.zustellen(aktiverServer: aktiv, seite: seite, jetzt: 1)
            XCTAssertEqual(r.ids, [])
            XCTAssertEqual(r.wirkung, .stoppe)
            XCTAssertTrue(b.isLeer)
        }
    }

    func testResetRaeumtAllesAuf() {
        var b = Standortbeobachtung()
        XCTAssertEqual(b.reset(), .keine)
        _ = b.start(id: 1, highAccuracy: true, timeout: nil, server: elw, jetzt: 0)
        XCTAssertEqual(b.reset(), .stoppe)
        XCTAssertTrue(b.isLeer)
    }

    func testEineBeobachtungFuerEinenAnderenServerErsetztDieAlten() {
        var b = Standortbeobachtung()
        _ = b.start(id: 1, highAccuracy: true, timeout: nil, server: elw, jetzt: 0)
        XCTAssertEqual(b.start(id: 2, highAccuracy: false, timeout: nil, server: lager, jetzt: 0), .starte(highAccuracy: false))
        let r = b.zustellen(aktiverServer: lager, seite: URL(string: "https://lager.example/")!, jetzt: 1)
        XCTAssertEqual(r.ids, [2])
    }

    func testDieFristLaeuftEinmalJeWartenAb() {
        var b = Standortbeobachtung()
        _ = b.start(id: 1, highAccuracy: false, timeout: .seconds(15), server: elw, jetzt: 100)
        _ = b.start(id: 2, highAccuracy: false, timeout: nil, server: elw, jetzt: 100)
        XCTAssertEqual(b.abgelaufen(jetzt: 114.9), [])
        XCTAssertEqual(b.abgelaufen(jetzt: 115), [1])
        XCTAssertEqual(b.abgelaufen(jetzt: 200), [], "nur einmal je Warten")
        // Eine Position beginnt das Warten neu.
        _ = b.zustellen(aktiverServer: elw, seite: seite, jetzt: 200)
        XCTAssertEqual(b.abgelaufen(jetzt: 214), [])
        XCTAssertEqual(b.abgelaufen(jetzt: 215.5), [1])
    }
}
