import XCTest

/// Smoke-Test und Bildschirmbilder der Helfer-App im Simulator. Jedes Bild geht als XCTAttachment
/// mit `.keepAlways` ins Ergebnisbündel; `scripts/ios/simulator-pruefung.sh` exportiert es, und
/// `ios-pruefung.yml` lädt es als Artefakt hoch. Die Seiten erreicht der Test über das
/// Startargument `-HelferTestzustand <seite>` (`Testzustand` in HelferModell.swift): Beispieldaten,
/// ohne Netz, Schlüsselbund, Ortung und Live-Aktivität.
final class StartTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Erster Start: „QR-Code scannen“, darunter „Code eingeben“.
    @MainActor
    func testStartZeigtQRCodeScannen() {
        let app = launch("start")
        XCTAssertTrue(app.buttons["scannen"].waitForExistence(timeout: 15))
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label == %@", "QR-Code scannen")).firstMatch
                .exists)
        XCTAssertTrue(app.buttons["code-eingeben"].exists)
        bild("helfer-start")
    }

    @MainActor
    func testCodeEingeben() {
        let app = launch("start")
        let knopf = app.buttons["code-eingeben"]
        XCTAssertTrue(knopf.waitForExistence(timeout: 15))
        knopf.tap()
        XCTAssertTrue(app.textFields["server"].waitForExistence(timeout: 5))
        bild("helfer-code-eingeben")
    }

    @MainActor
    func testAnmelden() {
        let app = launch("anmelden")
        XCTAssertTrue(app.buttons["anmelden"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["einwilligung"].exists)
        bild("helfer-anmelden")
    }

    @MainActor
    func testWartet() {
        let app = launch("wartet")
        XCTAssertTrue(element(app, "zustand").waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["abbrechen"].exists)
        bild("helfer-wartet")
    }

    @MainActor
    func testAngemeldet() {
        let app = launch("angemeldet")
        XCTAssertTrue(app.buttons["pausieren"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["abmelden"].exists)
        bild("helfer-angemeldet")
    }

    @MainActor
    func testPausiert() {
        let app = launch("pausiert")
        XCTAssertTrue(app.buttons["fortsetzen"].waitForExistence(timeout: 15))
        bild("helfer-pausiert")
    }

    @MainActor
    func testBeendet() {
        let app = launch("beendet")
        XCTAssertTrue(app.buttons["neu-anmelden"].waitForExistence(timeout: 15))
        bild("helfer-beendet")
    }

    /// Größte Schrift (AX3): der Start bleibt bedienbar.
    @MainActor
    func testStartMitGrosserSchrift() {
        let app = XCUIApplication()
        app.launchArguments += [
            "-HelferTestzustand", "start",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        let knopf = app.buttons["scannen"]
        XCTAssertTrue(knopf.waitForExistence(timeout: 15))
        bild("helfer-start-ax3")
    }

    // MARK: Hilfen

    @MainActor
    private func launch(_ testzustand: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-HelferTestzustand", testzustand]
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ kennung: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: kennung).firstMatch
    }

    @MainActor
    private func bild(_ name: String) {
        let anhang = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        anhang.name = name
        anhang.lifetime = .keepAlways
        add(anhang)
    }
}
