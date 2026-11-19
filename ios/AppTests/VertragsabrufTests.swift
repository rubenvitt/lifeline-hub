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

    /// Captive Portal oder Auth-Proxy: eine Weiterleitung auf eine fremde Origin verfolgt der
    /// Abruf nicht, eine auf derselben Origin schon.
    func testDerAbrufFolgtKeinerWeiterleitungAufEineFremdeOrigin() async throws {
        let shell = try XCTUnwrap(URL(string: "https://elw.local:8443/api/shell"))
        let aufgabe = URLSession(configuration: .ephemeral).dataTask(with: shell)
        defer { aufgabe.cancel() }
        let sperre = Umleitungssperre()
        func weiter(_ ziel: String) async throws -> URLRequest? {
            let url = try XCTUnwrap(URL(string: ziel))
            let antwort = try XCTUnwrap(
                HTTPURLResponse(
                    url: shell, statusCode: 302, httpVersion: "HTTP/1.1",
                    headerFields: ["Location": ziel]))
            return await sperre.urlSession(
                URLSession.shared, task: aufgabe, willPerformHTTPRedirection: antwort,
                newRequest: URLRequest(url: url))
        }
        let fremd = try await weiter("https://portal.example/login?ziel=elw")
        XCTAssertNil(fremd)
        let eigen = try await weiter("https://elw.local:8443/api/shell/")
        XCTAssertEqual(eigen?.url?.absoluteString, "https://elw.local:8443/api/shell/")
    }

    /// Ohne Server antwortet niemand: die Prüfung ergibt „nicht erreichbar“, nie „verträglich“.
    func testEinUnerreichbarerServerIstNichtErreichbar() async throws {
        let adresse = try ServerAdresse.parse("https://127.0.0.1:9")
        let (ergebnis, health) = await Vertragsabruf.check(adresse, letzterVertrag: nil)
        XCTAssertEqual(ergebnis, .nichtErreichbar(.nichtErreichbar))
        XCTAssertNil(health)
    }
}
