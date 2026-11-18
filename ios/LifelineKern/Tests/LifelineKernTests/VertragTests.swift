import Foundation
import XCTest

@testable import LifelineKern

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Vertragsprüfung gegen `GET /api/shell` (Spec `ios-huelle`, „Die App lädt nur einen
/// verträglichen Server“ und „Server ohne Vertrag gelten als zu alt“).
final class VertragTests: XCTestCase {
    func shell(_ vertrag: Int, version: String = "1.0.0-alpha.300") -> ShellAbruf {
        .antwort(
            status: 200,
            body: Data(#"{"version":"\#(version)","shell_contract":\#(vertrag)}"#.utf8))
    }

    func testShellInfoLiestDieWireFelderUndIgnoriertNeue() throws {
        let json = #"{"version":"1.0.0-alpha.300","shell_contract":1,"assets":["a.js"]}"#
        let info = try JSONDecoder().decode(ShellInfo.self, from: Data(json.utf8))
        XCTAssertEqual(info, ShellInfo(version: "1.0.0-alpha.300", shellContract: 1))
    }

    func testDieAppKenntGenauDenErstenVertrag() {
        XCTAssertEqual(LifelineKern.bekannteVertraege, [1])
    }

    func testEinBekannterVertragIstVertraeglich() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(1), letzterVertrag: nil),
            .vertraeglich(ShellInfo(version: "1.0.0-alpha.300", shellContract: 1)))
    }

    func testEinGroessererVertragHeisstAppAktualisieren() {
        let info = ShellInfo(version: "2.0.0", shellContract: 2)
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(2, version: "2.0.0"), letzterVertrag: 1),
            .nichtVertraeglich(.zuNeu, server: info))
        XCTAssertEqual(Vertragspruefung.evaluate(shell(2), letzterVertrag: 1).fehlerklasse, .zuNeu)
    }

    func testEinKleinererVertragHeisstServerZuAlt() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(1), letzterVertrag: nil, bekannt: [2, 3]).fehlerklasse,
            .zuAlt)
    }

    func testOhneEndpunktIstDerServerZuAlt() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(.antwort(status: 404, body: Data()), letzterVertrag: 1),
            .nichtVertraeglich(.zuAlt, server: nil))
        // Eine 200 ohne Vertrag (etwa die Oberfläche statt JSON) nennt keinen Vertrag.
        XCTAssertEqual(
            Vertragspruefung.evaluate(
                .antwort(status: 200, body: Data("<!doctype html>".utf8)), letzterVertrag: nil),
            .nichtVertraeglich(.zuAlt, server: nil))
    }

    func testDieVersionEinesZuAltenServersKommtAusHealth() throws {
        let json = #"{"status":"degraded","version":"1.0.0-alpha.12","db":false}"#
        XCTAssertEqual(try HealthInfo(json: Data(json.utf8)).version, "1.0.0-alpha.12")
    }

    /// Ohne Netz gilt der zuletzt bestätigte Vertrag: die App zeigt „nicht erreichbar“, nicht
    /// „nicht verträglich“.
    func testOhneNetzGiltDerZuletztBestaetigteVertrag() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.notConnectedToInternet), letzterVertrag: 1),
            .nichtErreichbar(.nichtErreichbar))
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.timedOut), letzterVertrag: nil),
            .nichtErreichbar(.nichtErreichbar))
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.cannotConnectToHost), letzterVertrag: 2),
            .nichtVertraeglich(.zuNeu, server: nil))
        XCTAssertEqual(
            Vertragspruefung.evaluate(.antwort(status: 502, body: Data()), letzterVertrag: 1),
            .nichtErreichbar(.nichtErreichbar))
    }

    func testEinZertifikatsfehlerIstKeinNichtErreichbar() {
        for code: URLError.Code in [
            .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
            .serverCertificateHasBadDate, .serverCertificateNotYetValid,
        ] {
            XCTAssertEqual(Fehlerklasse(code), .zertifikat, "\(code)")
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 1),
                .nichtErreichbar(.zertifikat))
            // Auch ein zuletzt unverträglicher Server zeigt zuerst die Anleitung zum Zertifikat:
            // ohne Vertrauen erfährt die App den heutigen Vertrag nicht.
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 2),
                .nichtErreichbar(.zertifikat))
        }
        for code: URLError.Code in [
            .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .timedOut,
            .networkConnectionLost, .dnsLookupFailed,
        ] {
            XCTAssertEqual(Fehlerklasse(code), .nichtErreichbar, "\(code)")
        }
    }
}
