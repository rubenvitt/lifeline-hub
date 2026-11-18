import XCTest

@testable import LifelineKern

/// Annahme der Brücke `lifeline` (Spec `ios-huelle`, „Die Brücke gilt nur für den aktiven
/// Server“; Entwurf D6): nur Hauptframe, nur die Origin des aktiven Servers.
final class BrueckeTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443/")
    let zweiter = try! ServerAdresse.parse("https://lager.example/")

    func origin(_ schema: String, _ host: String, _ port: Int) -> SeitenOrigin {
        SeitenOrigin(schema: schema, host: host, port: port)
    }

    func testDerHauptframeDesAktivenServersWirdAngenommen() {
        XCTAssertTrue(
            Bruecke.accepts(
                isMainFrame: true, origin: origin("https", "elw.local", 8443), aktiverServer: elw))
    }

    func testEinUnterframeDesAktivenServersWirdAbgelehnt() {
        XCTAssertFalse(
            Bruecke.accepts(
                isMainFrame: false, origin: origin("https", "elw.local", 8443), aktiverServer: elw))
    }

    func testEineFremdeOriginWirdAbgelehnt() {
        let fremde = [
            origin("https", "idp.example", 443),
            origin("https", "elw.local", 443),
            origin("https", "elw.local", 0),
            origin("http", "elw.local", 8443),
            origin("https", "elw.local.evil.example", 8443),
            origin("file", "", 0),
            origin("blob", "elw.local", 8443),
        ]
        for seite in fremde {
            XCTAssertFalse(
                Bruecke.accepts(isMainFrame: true, origin: seite, aktiverServer: elw), "\(seite)")
        }
    }

    func testOhneAktivenServerNimmtDieBrueckeNichtsAn() {
        XCTAssertFalse(
            Bruecke.accepts(
                isMainFrame: true, origin: origin("https", "elw.local", 8443), aktiverServer: nil))
    }

    func testPortNullIstDerStandardportDesSchemas() {
        // WKSecurityOrigin meldet den Standardport als 0.
        XCTAssertTrue(
            Bruecke.accepts(
                isMainFrame: true, origin: origin("https", "lager.example", 0),
                aktiverServer: zweiter))
        XCTAssertTrue(
            Bruecke.accepts(
                isMainFrame: true, origin: origin("https", "lager.example", 443),
                aktiverServer: zweiter))
    }

    func testGrossschreibungImHostZaehltNicht() {
        XCTAssertTrue(
            Bruecke.accepts(
                isMainFrame: true, origin: origin("HTTPS", "ELW.local", 8443), aktiverServer: elw))
    }

    func testNachEinemServerwechselGiltSofortDieNeueOrigin() {
        let alteSeite = origin("https", "elw.local", 8443)
        let neueSeite = origin("https", "lager.example", 0)
        XCTAssertTrue(Bruecke.accepts(isMainFrame: true, origin: alteSeite, aktiverServer: elw))
        // Wechsel: die alte Seite (etwa ein noch nicht abgebauter Webview) verliert die Brücke.
        XCTAssertFalse(Bruecke.accepts(isMainFrame: true, origin: alteSeite, aktiverServer: zweiter))
        XCTAssertTrue(Bruecke.accepts(isMainFrame: true, origin: neueSeite, aktiverServer: zweiter))
    }

    func testDerHandlerHeisstLifeline() {
        XCTAssertEqual(Bruecke.handlerName, "lifeline")
    }
}
