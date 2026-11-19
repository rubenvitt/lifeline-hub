import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// „Im Browser anmelden“ in der App (tasks.md 8.8; Spec `ios-huelle`, „Die App meldet sich im
/// Systembrowser an“). Die Sitzung selbst braucht eine Person; geprüft wird, was ohne sie geht.
@MainActor
final class AppAnmeldungTests: XCTestCase {
    let code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    /// Szenario „Untergeschobener Rücksprung“: eine andere App öffnet
    /// `lifeline://anmeldung?code=…`. Die App wechselt nichts, belegt nichts vor und löst nichts ein.
    func testEinRuecksprungVonAussenBleibtWirkungslos() throws {
        for zustand in ["onboarding", "nicht-erreichbar"] {
            let modell = AppModell(argumente: ["App", "-LifelineTestzustand", zustand], info: [:])
            let seite = modell.seite
            let onboarding = modell.onboarding
            let liste = modell.liste
            modell.open(try XCTUnwrap(URL(string: "lifeline://anmeldung?code=\(code)")))
            modell.open(
                try XCTUnwrap(URL(string: "lifeline://anmeldung?code=\(code)&server=https://lager.example")))
            XCTAssertEqual(modell.seite, seite, zustand)
            XCTAssertEqual(modell.onboarding, onboarding, zustand)
            XCTAssertEqual(modell.liste, liste, zustand)
            XCTAssertFalse(modell.zeigtOnboarding, zustand)
            XCTAssertNil(modell.wechselRueckfrage, zustand)
            XCTAssertNil(modell.webView, zustand)
        }
    }

    /// Gegenprobe: `lifeline://verbinden` wirkt weiter (Deeplink-Entscheidung des Kerns).
    func testVerbindenGehtInDieDeeplinkEntscheidung() throws {
        let modell = AppModell(argumente: ["App", "-LifelineTestzustand", "nicht-erreichbar"], info: [:])
        modell.open(try XCTUnwrap(URL(string: "lifeline://verbinden?server=https://lager.example")))
        XCTAssertEqual(modell.wechselRueckfrage?.name, "Lager")
        modell.wechselRueckfrage = nil
        modell.open(try XCTUnwrap(URL(string: "lifeline://verbinden?server=https://neu.example")))
        XCTAssertTrue(modell.zeigtOnboarding)
    }

    func testOhneServerBeginntKeineSitzung() {
        let anmelder = Anmelder(webView: { nil }, aktiverServer: { nil })
        XCTAssertThrowsError(try anmelder.start()) { fehler in
            XCTAssertEqual(fehler.localizedDescription, "Es ist kein Server verbunden.")
        }
    }
}
