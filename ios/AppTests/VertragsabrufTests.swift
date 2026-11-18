import LifelineKern
import XCTest

@testable import LifelineHub

/// Adressen der Vertragsprüfung (Entwurf D4): die API liegt an der Wurzel des Servers.
final class VertragsabrufTests: XCTestCase {
    func testShellUndHealthLiegenAnDerWurzel() throws {
        for eingabe in ["https://elw.local:8443", "https://elw.local:8443/einsatz/3"] {
            let adresse = try ServerAdresse.parse(eingabe)
            XCTAssertEqual(
                Vertragsabruf.endpoint("/api/shell", adresse).absoluteString,
                "https://elw.local:8443/api/shell")
            XCTAssertEqual(
                Vertragsabruf.endpoint("/api/health", adresse).absoluteString,
                "https://elw.local:8443/api/health")
        }
    }

    /// Ohne Server antwortet niemand: die Prüfung ergibt „nicht erreichbar“, nie „verträglich“.
    func testEinUnerreichbarerServerIstNichtErreichbar() async throws {
        let adresse = try ServerAdresse.parse("https://127.0.0.1:9")
        let (ergebnis, health) = await Vertragsabruf.check(adresse, letzterVertrag: nil)
        XCTAssertEqual(ergebnis, .nichtErreichbar(.nichtErreichbar))
        XCTAssertNil(health)
    }
}
