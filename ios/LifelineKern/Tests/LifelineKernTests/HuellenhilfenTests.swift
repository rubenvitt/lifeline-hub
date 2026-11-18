import Foundation
import XCTest

@testable import LifelineKern

/// Kleine Bausteine der App: Rückkehr in den Vordergrund, Testzustände der UI-Tests, QR-Code,
/// Ablage der Serverliste.
final class HuellenhilfenTests: XCTestCase {
    // MARK: Rückkehr in den Vordergrund (scenePhase)

    func testErstNachDemHintergrundZaehltAktivAlsRueckkehr() {
        var rueckkehr = Rueckkehr()
        XCTAssertFalse(rueckkehr.melde(.active))
        XCTAssertFalse(rueckkehr.melde(.inactive))
        XCTAssertFalse(rueckkehr.melde(.active))
        XCTAssertFalse(rueckkehr.melde(.inactive))
        XCTAssertFalse(rueckkehr.melde(.background))
        XCTAssertFalse(rueckkehr.melde(.inactive))
        XCTAssertTrue(rueckkehr.melde(.active))
        XCTAssertFalse(rueckkehr.melde(.active))
    }

    // MARK: Testzustände

    func testTestzustandKommtAusDenStartargumenten() {
        XCTAssertEqual(Testzustand(argumente: ["App", "-LifelineTestzustand", "zu-neu"]), .zuNeu)
        XCTAssertEqual(Testzustand(argumente: ["App", "-LifelineTestzustand", "onboarding"]), .onboarding)
        XCTAssertNil(Testzustand(argumente: ["App"]))
        XCTAssertNil(Testzustand(argumente: ["App", "-LifelineTestzustand"]))
        XCTAssertNil(Testzustand(argumente: ["App", "-LifelineTestzustand", "kaputt"]))
    }

    func testJedeNativeSeiteHatEinenTestzustand() {
        XCTAssertEqual(
            Set(Testzustand.allCases.map(\.rawValue)),
            [
                "onboarding", "serverliste", "einstellungen", "zertifikat", "nicht-erreichbar", "zu-alt",
                "zu-neu", "web",
            ])
    }

    // MARK: QR-Code

    func testDerQrCodeTraegtEinenDeeplinkOderEineAdresse() throws {
        let elw = try ServerAdresse.parse("https://elw.local:8443")
        XCTAssertEqual(Deeplink.adresse(ausQRCode: "lifeline://verbinden?server=https://elw.local:8443"), elw)
        XCTAssertEqual(Deeplink.adresse(ausQRCode: " https://elw.local:8443 "), elw)
        XCTAssertNil(Deeplink.adresse(ausQRCode: "lifeline://verbinden?server=http://elw.local"))
        XCTAssertNil(Deeplink.adresse(ausQRCode: "lifeline://anmeldung?code=abc"))
        XCTAssertNil(Deeplink.adresse(ausQRCode: "WIFI:S:elw;T:WPA;P:geheim;;"))
        XCTAssertNil(Deeplink.adresse(ausQRCode: "http://elw.local"))
    }

    // MARK: Ablage der Serverliste

    func temporaeresVerzeichnis() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testOhneDateiIstDieListeLeer() throws {
        let ablage = Serverablage(verzeichnis: try temporaeresVerzeichnis())
        XCTAssertEqual(try ablage.load(), Serverliste())
    }

    func testDieListeUeberstehtSpeichernUndLaden() throws {
        let ablage = Serverablage(verzeichnis: try temporaeresVerzeichnis())
        var liste = Serverliste()
        let elw = liste.add(try ServerAdresse.parse("https://elw.local:8443"))
        let lager = liste.add(try ServerAdresse.parse("https://lager.example"), name: "Lager")
        try liste.activate(lager.id)
        try liste.markVerbunden(elw.id, am: Date(timeIntervalSince1970: 1_800_000_000), vertrag: 1)
        try ablage.save(liste)
        let gelesen = try ablage.load()
        XCTAssertEqual(gelesen, liste)
        XCTAssertEqual(gelesen.aktiv?.id, lager.id)
    }

    func testEineKaputteDateiWirdBeiseitegelegtStattUeberschrieben() throws {
        let verzeichnis = try temporaeresVerzeichnis()
        let ablage = Serverablage(verzeichnis: verzeichnis)
        try FileManager.default.createDirectory(at: verzeichnis, withIntermediateDirectories: true)
        try Data("{kaputt".utf8).write(to: ablage.datei)
        XCTAssertThrowsError(try ablage.load())
        XCTAssertEqual(ablage.loadOrRecover(), Serverliste())
        let beiseite = verzeichnis.appendingPathComponent("server.defekt.json")
        XCTAssertEqual(try Data(contentsOf: beiseite), Data("{kaputt".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: ablage.datei.path))
    }

    func testDieDateiHeisstServerJson() throws {
        let verzeichnis = try temporaeresVerzeichnis()
        XCTAssertEqual(Serverablage(verzeichnis: verzeichnis).datei.lastPathComponent, "server.json")
    }

    // MARK: Schalter Haptik

    func testDerSchalterHaptikIstVorgabemaessigAn() {
        XCTAssertEqual(Haptik.schalterSchluessel, "haptik")
        XCTAssertTrue(Haptik.isEnabled(gespeichert: nil))
        XCTAssertFalse(Haptik.isEnabled(gespeichert: false))
        XCTAssertTrue(Haptik.isEnabled(gespeichert: true))
    }
}
