import XCTest

/// Bildschirmbilder der nativen Seiten im Simulator (Spec `ios-auslieferung`, „Ein PR mit
/// iOS-Änderungen baut die App im Simulator“). Jedes Bild geht als XCTAttachment mit
/// `.keepAlways` ins Ergebnisbündel; `scripts/ios/simulator-pruefung.sh` exportiert es, und
/// `ios-pruefung.yml` lädt es als Artefakt hoch. Eine neue native Seite bekommt hier ihr Bild.
final class ScreenshotTests: XCTestCase {
    @MainActor
    func testStartseite() {
        let app = XCUIApplication()
        app.launch()
        let version = app.staticTexts["version"]
        XCTAssertTrue(version.waitForExistence(timeout: 15))
        XCTAssertNotEqual(version.label, "Version unbekannt")
        attachScreenshot(named: "start")
    }

    @MainActor
    private func attachScreenshot(named name: String) {
        let anhang = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        anhang.name = name
        anhang.lifetime = .keepAlways
        add(anhang)
    }
}
