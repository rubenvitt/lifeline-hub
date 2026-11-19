import XCTest

@testable import LifelineKern

/// Texte der nativen Status-Seiten (Spec `ios-huelle`; Entwurf D2a, D4).
final class StatustextTests: XCTestCase {
    func testZuNeuHeisstAppAktualisierenMitBeidenVersionen() {
        let text = Statusseite.nichtVertraeglich(.zuNeu, serverVersion: "2.0.0").text(
            servername: "ELW 1", appVersion: "1.0.0-alpha.320")
        XCTAssertEqual(text.titel, "App aktualisieren")
        XCTAssertTrue(text.text.contains("2.0.0"), text.text)
        XCTAssertTrue(text.text.contains("1.0.0-alpha.320"), text.text)
        XCTAssertTrue(text.text.contains("ELW 1"), text.text)
    }

    func testZuAltHeisstServerIstZuAlt() {
        let text = Statusseite.nichtVertraeglich(.zuAlt, serverVersion: "1.0.0-alpha.200").text(
            servername: "ELW 1", appVersion: "1.0.0-alpha.320")
        XCTAssertEqual(text.titel, "Server ist zu alt für diese App")
        XCTAssertTrue(text.text.contains("1.0.0-alpha.200"), text.text)
        XCTAssertTrue(text.text.contains("1.0.0-alpha.320"), text.text)
    }

    func testOhneVersionenSagtDerTextDas() {
        let text = Statusseite.nichtVertraeglich(.zuAlt, serverVersion: nil).text(
            servername: "ELW 1", appVersion: nil)
        XCTAssertTrue(text.text.contains("unbekannt"), text.text)
    }

    func testZertifikatNenntDieSchritteZumCaProfil() {
        let text = Statusseite.zertifikat.text(servername: "elw.local", appVersion: nil)
        XCTAssertEqual(text.titel, "Zertifikat nicht vertrauenswürdig")
        XCTAssertEqual(text.schritte.count, 3)
        XCTAssertTrue(text.schritte.joined().contains("Zertifikatsvertrauenseinstellungen"))
        XCTAssertTrue(text.schritte.joined().contains("VPN und Geräteverwaltung"))
    }

    func testNichtErreichbarVersprichtDasAutomatischeLaden() {
        let text = Statusseite.nichtErreichbar.text(servername: "elw.local", appVersion: nil)
        XCTAssertEqual(text.titel, "Server nicht erreichbar")
        XCTAssertTrue(text.text.contains("elw.local"))
        XCTAssertTrue(text.text.contains("sobald"))
        XCTAssertEqual(text.schritte, [])
    }
}
