import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// Entfernen eines Servers in der App (tasks.md 8.11). Die Reihenfolge prüft der Kern
/// (`ServerentfernungTests`); hier, dass WebKit den Datenspeicher wirklich löscht und die App den
/// Webview vorher schließt.
@MainActor
final class ServerentfernungAppTests: XCTestCase {
    func testDerDatenspeicherIstNachDemLoeschenWeg() async throws {
        let id = UUID()
        let speicher = WKWebsiteDataStore(forIdentifier: id)
        let cookie = try XCTUnwrap(
            HTTPCookie(properties: [
                .domain: "elw.local", .path: "/", .name: "sitzung", .value: "1", .secure: "TRUE",
            ]))
        await speicher.httpCookieStore.setCookie(cookie)
        let vorher = await Datenspeicher.fetchIdentifiers()
        XCTAssertTrue(vorher.contains(id))
        try await Datenspeicher.remove(id)
        let nachher = await Datenspeicher.fetchIdentifiers()
        XCTAssertFalse(nachher.contains(id))
    }

    func testDasModellEntferntNurNichtAktiveServer() async throws {
        let modell = AppModell(argumente: ["App", "-LifelineTestzustand", "serverliste"], info: [:])
        let elw = try XCTUnwrap(modell.liste.aktiv)
        let lager = try XCTUnwrap(modell.liste.eintraege.first { $0.name == "Lager" })
        XCTAssertFalse(modell.isEntfernbar(elw))
        XCTAssertTrue(modell.isEntfernbar(lager))
        modell.entfernen(lager)
        XCTAssertFalse(modell.isEntfernbar(lager), "während des Entfernens noch einmal angeboten")
        for _ in 0..<100 where modell.inEntfernung != nil { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(modell.liste.eintraege.map(\.name), ["ELW 1"])
        XCTAssertNil(modell.entfernenFehler)
    }

    func testDerWebviewDesSpeichersWirdVorherGeschlossen() throws {
        let modell = AppModell(argumente: ["App", "-LifelineTestzustand", "web"], info: [:])
        let speicher = try XCTUnwrap(modell.webView?.configuration.websiteDataStore.identifier)
        modell.closeWebView(datenspeicher: UUID())
        XCTAssertNotNil(modell.webView)
        modell.closeWebView(datenspeicher: speicher)
        XCTAssertNil(modell.webView)
    }
}
