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
            body: Data(#"{"version":"\#(version)","shell_contract":\#(vertrag)}"#.utf8),
            contentType: "application/json")
    }

    func testShellInfoLiestDieWireFelderUndIgnoriertNeue() throws {
        let json = #"{"version":"1.0.0-alpha.300","shell_contract":2,"assets":["a.js"]}"#
        let info = try JSONDecoder().decode(ShellInfo.self, from: Data(json.utf8))
        XCTAssertEqual(info, ShellInfo(version: "1.0.0-alpha.300", shellContract: 2))
    }

    /// Vertrag 2 (LLH-1979): der Login-Pfad heißt `/api/auth/app-code/redeem`.
    func testDieAppKenntGenauDenZweitenVertrag() {
        XCTAssertEqual(LifelineKern.bekannteVertraege, [2])
    }

    /// Ein Server mit Vertrag 1 kennt nur `/api/auth/app-code/einloesen`: für die App zu alt.
    func testEinServerMitVertragEinsIstZuAlt() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(1), letzterVertrag: nil).fehlerklasse, .zuAlt)
    }

    func testEinBekannterVertragIstVertraeglich() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(2), letzterVertrag: nil),
            .vertraeglich(ShellInfo(version: "1.0.0-alpha.300", shellContract: 2)))
    }

    func testEinGroessererVertragHeisstAppAktualisieren() {
        let info = ShellInfo(version: "2.0.0", shellContract: 3)
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(3, version: "2.0.0"), letzterVertrag: 2),
            .nichtVertraeglich(.zuNeu, server: info))
        XCTAssertEqual(Vertragspruefung.evaluate(shell(3), letzterVertrag: 2).fehlerklasse, .zuNeu)
    }

    func testEinKleinererVertragHeisstServerZuAlt() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(shell(2), letzterVertrag: nil, bekannt: [3, 4]).fehlerklasse,
            .zuAlt)
    }

    func testOhneEndpunktIstDerServerZuAlt() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(
                .antwort(status: 404, body: Data(), contentType: "text/plain"), letzterVertrag: 2),
            .nichtVertraeglich(.zuAlt, server: nil))
        // JSON ohne lesbaren Vertrag nennt keinen Vertrag.
        for typ in ["application/json", "application/json; charset=utf-8", "Application/JSON"] {
            XCTAssertEqual(
                Vertragspruefung.evaluate(
                    .antwort(status: 200, body: Data(#"{"status":"ok"}"#.utf8), contentType: typ),
                    letzterVertrag: 2),
                .nichtVertraeglich(.zuAlt, server: nil), typ)
        }
    }

    func testDerVertragGiltAuchMitZeichensatzImContentType() {
        let abruf = ShellAbruf.antwort(
            status: 200, body: Data(#"{"version":"1.0.0","shell_contract":2}"#.utf8),
            contentType: "application/json; charset=utf-8")
        XCTAssertEqual(
            Vertragspruefung.evaluate(abruf, letzterVertrag: nil),
            .vertraeglich(ShellInfo(version: "1.0.0", shellContract: 2)))
    }

    /// Ein Captive Portal oder Auth-Proxy antwortet mit 200 und HTML (oder ohne Content-Type):
    /// das ist nicht der Server, also gilt wie ohne Verbindung der zuletzt bestätigte Vertrag.
    func testEine200OhneJsonIstNichtDerServer() {
        let portal = Data("<!doctype html><title>WLAN-Anmeldung</title>".utf8)
        for typ in ["text/html", "text/html; charset=utf-8", "text/plain", nil] as [String?] {
            XCTAssertEqual(
                Vertragspruefung.evaluate(
                    .antwort(status: 200, body: portal, contentType: typ), letzterVertrag: 2),
                .nichtErreichbar(.nichtErreichbar), "\(typ ?? "ohne")")
            XCTAssertEqual(
                Vertragspruefung.evaluate(
                    .antwort(status: 200, body: portal, contentType: typ), letzterVertrag: nil),
                .nichtErreichbar(.nichtErreichbar), "\(typ ?? "ohne")")
            XCTAssertEqual(
                Vertragspruefung.evaluate(
                    .antwort(status: 200, body: portal, contentType: typ), letzterVertrag: 3),
                .nichtVertraeglich(.zuNeu, server: nil), "\(typ ?? "ohne")")
        }
        // Auch ein Portal, das JSON-ähnlichen Text als HTML schickt, nennt keinen Vertrag.
        XCTAssertEqual(
            Vertragspruefung.evaluate(
                .antwort(
                    status: 200, body: Data(#"{"version":"9","shell_contract":2}"#.utf8),
                    contentType: "text/html"),
                letzterVertrag: nil),
            .nichtErreichbar(.nichtErreichbar))
    }

    /// Eine nicht verfolgte Weiterleitung auf eine fremde Origin (Vertragsabruf) kommt als 3xx an.
    func testEineWeiterleitungIstWieOhneVerbindung() {
        for status in [301, 302, 303, 307, 308] {
            XCTAssertEqual(
                Vertragspruefung.evaluate(
                    .antwort(status: status, body: Data(), contentType: "text/html"), letzterVertrag: 2),
                .nichtErreichbar(.nichtErreichbar), "\(status)")
        }
    }

    /// Der Abruf folgt nur Weiterleitungen auf derselben Origin; eine fremde (Captive Portal,
    /// Auth-Proxy) bleibt stehen und kommt als 3xx in die Prüfung.
    func testNurWeiterleitungenAufDerselbenOriginWerdenVerfolgt() {
        let shell = URL(string: "https://elw.local:8443/api/shell")
        XCTAssertTrue(
            Vertragspruefung.followsRedirect(von: shell, nach: URL(string: "https://ELW.local:8443/api/shell/")))
        for ziel in [
            "https://portal.example/login", "https://elw.local/api/shell", "http://elw.local:8443/api/shell",
            "https://elw.local:8444/api/shell",
        ] {
            XCTAssertFalse(Vertragspruefung.followsRedirect(von: shell, nach: URL(string: ziel)), ziel)
        }
        XCTAssertFalse(Vertragspruefung.followsRedirect(von: nil, nach: shell))
        XCTAssertFalse(Vertragspruefung.followsRedirect(von: shell, nach: nil))
    }

    func testJsonErkenntDenMedientyp() {
        for typ in ["application/json", " application/json ; charset=utf-8", "APPLICATION/JSON"] {
            XCTAssertTrue(ShellAbruf.isJson(typ), typ)
        }
        for typ in ["text/html", "application/jsonp", "text/json-ish", "", nil] as [String?] {
            XCTAssertFalse(ShellAbruf.isJson(typ), typ ?? "nil")
        }
    }

    func testDieVersionEinesZuAltenServersKommtAusHealth() throws {
        let json = #"{"status":"degraded","version":"1.0.0-alpha.12","db":false}"#
        XCTAssertEqual(try HealthInfo(json: Data(json.utf8)).version, "1.0.0-alpha.12")
    }

    /// Ohne Netz gilt der zuletzt bestätigte Vertrag: die App zeigt „nicht erreichbar“, nicht
    /// „nicht verträglich“.
    func testOhneNetzGiltDerZuletztBestaetigteVertrag() {
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.notConnectedToInternet), letzterVertrag: 2),
            .nichtErreichbar(.nichtErreichbar))
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.timedOut), letzterVertrag: nil),
            .nichtErreichbar(.nichtErreichbar))
        XCTAssertEqual(
            Vertragspruefung.evaluate(.fehler(.cannotConnectToHost), letzterVertrag: 3),
            .nichtVertraeglich(.zuNeu, server: nil))
        XCTAssertEqual(
            Vertragspruefung.evaluate(
                .antwort(status: 502, body: Data(), contentType: "text/html"), letzterVertrag: 2),
            .nichtErreichbar(.nichtErreichbar))
    }

    func testEinZertifikatsfehlerIstKeinNichtErreichbar() {
        for code: URLError.Code in [
            .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
            .serverCertificateHasBadDate, .serverCertificateNotYetValid,
        ] {
            XCTAssertEqual(Fehlerklasse(code), .zertifikat, "\(code)")
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 2),
                .nichtErreichbar(.zertifikat))
            // Auch ein zuletzt unverträglicher Server zeigt zuerst die Anleitung zum Zertifikat:
            // ohne Vertrauen erfährt die App den heutigen Vertrag nicht.
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 3),
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
