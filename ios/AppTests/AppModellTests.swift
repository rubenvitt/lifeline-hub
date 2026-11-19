import LifelineKern
import XCTest

@testable import LifelineHub

/// Das Modell entsteht mit der App, bevor UIKit läuft (`LifelineHubApp`, `@State`). Ein Webview
/// aus dieser Zeit bringt seine Gesten nie in die Gestenumgebung des Fensters, und die erste
/// Berührung beendet die App („Invalid parameter not satisfying: targetNode“); deshalb baut erst
/// `start()` beim Erscheinen der Oberfläche einen Webview, auch in den Testzuständen.
@MainActor
final class AppModellTests: XCTestCase {
    func testDerWebviewEntstehtErstBeimStart() {
        for zustand in ["web", "fremde-seite"] {
            let modell = AppModell(argumente: ["App", "-LifelineTestzustand", zustand], info: [:])
            XCTAssertNil(modell.webView, zustand)
            guard case .web = modell.seite else { return XCTFail("keine Webseite: \(zustand)") }
            modell.start()
            XCTAssertNotNil(modell.webView, zustand)
        }
    }

    func testOhneWebseiteEntstehtAuchBeimStartKeinWebview() {
        let modell = AppModell(argumente: ["App", "-LifelineTestzustand", "nicht-erreichbar"], info: [:])
        modell.start()
        XCTAssertNil(modell.webView)
    }
}
