import XCTest

@testable import HelferKern

/// Feste Texte für abgewiesene Anfragen; gleich wie `AnzeigeTest.kt` in `android/helferkern`.
final class AnzeigeTests: XCTestCase {
    func testAbgewieseneAnfragenBekommenEinenSatz() {
        XCTAssertEqual(
            Anzeige.meldung(status: 0),
            "Der Server ist nicht erreichbar. Prüfe die Verbindung und versuche es erneut.")
        XCTAssertEqual(
            Anzeige.meldung(status: 401),
            "Der Code ist ungültig oder abgelaufen. Bitte den QR-Code neu scannen.")
        XCTAssertEqual(
            Anzeige.meldung(status: 403, grund: "tracking_off"),
            "Die Ortung ist für diese Organisation ausgeschaltet.")
        XCTAssertEqual(
            Anzeige.meldung(status: 403), "Das ist mit dieser Anmeldung nicht erlaubt.",
            "ein 403 ohne Grund ist nicht „Ortung aus“")
        XCTAssertEqual(
            Anzeige.meldung(status: 403, grund: "no_role"),
            "Dieses Gerät ortet weder ein Ziel noch eine Person.")
        XCTAssertEqual(
            Anzeige.meldung(status: 403, grund: "target_removed"), "Das Ziel gibt es nicht mehr.")
        XCTAssertEqual(
            Anzeige.meldung(status: 409, grund: "person_session"),
            "Auf diesem Gerät ist eine persönliche Anmeldung aktiv.")
        XCTAssertEqual(
            Anzeige.meldung(status: 409), "Das geht im aktuellen Zustand der Anmeldung nicht.")
        XCTAssertEqual(
            Anzeige.meldung(status: 422, grund: "invitation_exhausted", fehlertext: "ausgeschöpft"),
            "Diese Einladung ist ausgeschöpft. Bitte die Einsatzleitung um einen neuen QR-Code.")
        XCTAssertEqual(Anzeige.meldung(status: 422, fehlertext: "Name zu lang"), "Name zu lang")
        XCTAssertEqual(Anzeige.meldung(status: 400, fehlertext: "Name leer"), "Name leer")
        XCTAssertEqual(Anzeige.meldung(status: 422), "Die Angaben passen nicht. Bitte prüfen.")
        XCTAssertEqual(Anzeige.meldung(status: 429), "Zu viele Versuche. Bitte kurz warten.")
        XCTAssertEqual(
            Anzeige.meldung(status: 500), "Unerwartete Antwort des Servers (500).")
    }
}
