import XCTest

/// Bildschirmbilder der nativen Seiten im Simulator (Spec `ios-auslieferung`, „Ein PR mit
/// iOS-Änderungen baut die App im Simulator“). Jedes Bild geht als XCTAttachment mit
/// `.keepAlways` ins Ergebnisbündel; `scripts/ios/simulator-pruefung.sh` exportiert es, und
/// `ios-pruefung.yml` lädt es als Artefakt hoch. Eine neue native Seite bekommt hier ihr Bild.
///
/// Die Seiten erreicht der Test über das Startargument `-LifelineTestzustand <name>`
/// (`LifelineKern.Testzustand`): die App zeigt sie dann mit Beispieldaten, ohne Netz und ohne die
/// gespeicherte Serverliste.
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Erster Start ohne Server: nur das Onboarding, mit der Version der App.
    @MainActor
    func testErsterStartZeigtDasOnboarding() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(element(app, "onboarding").waitForExistence(timeout: 15))
        let version = app.staticTexts["version"]
        XCTAssertTrue(version.waitForExistence(timeout: 5))
        XCTAssertNotEqual(version.label, "Version unbekannt")
        XCTAssertFalse(app.webViews.firstMatch.exists)
        attachScreenshot(named: "start")
    }

    @MainActor
    func testOnboarding() {
        let app = launch("onboarding")
        XCTAssertTrue(element(app, "onboarding").waitForExistence(timeout: 15))
        XCTAssertTrue(app.textFields["adresse"].exists)
        attachScreenshot(named: "onboarding")
    }

    @MainActor
    func testOnboardingZeigtDieMeldungDerAdresspruefung() {
        let app = launch("onboarding")
        let feld = app.textFields["adresse"]
        XCTAssertTrue(feld.waitForExistence(timeout: 15))
        // Rechts ins Feld tippen setzt die Schreibmarke hinter die Vorbelegung.
        feld.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        feld.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        feld.typeText("http://elw.local:8443")
        app.buttons["verbinden"].tap()
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Nur https-Adressen'"))
                .firstMatch.waitForExistence(timeout: 5))
        attachScreenshot(named: "onboarding-meldung")
    }

    @MainActor
    func testServerliste() {
        let app = launch("serverliste")
        XCTAssertTrue(element(app, "serverliste").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["ELW 1"].exists)
        XCTAssertTrue(app.staticTexts["Lager"].exists)
        XCTAssertTrue(app.buttons["zur-oberflaeche"].exists, "kein Weg zur Oberfläche")
        attachScreenshot(named: "serverliste")
    }

    /// Fremde Seite im Hauptframe (etwa ohne Rücklink nach dem Identitätsanbieter): der Hinweis
    /// bietet den Weg zurück, ohne die Seite wegzunehmen; „Zur Oberfläche“ nimmt ihn weg (das
    /// Neuladen selbst prüft `AblaufTests`, im Testzustand lädt die App nichts).
    @MainActor
    func testEineFremdeSeiteBietetDenWegZurOberflaeche() {
        let app = launch("fremde-seite")
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        let hinweis = element(app, "hinweis-fremde-seite")
        XCTAssertTrue(hinweis.waitForExistence(timeout: 10))
        let knopf = app.buttons["hinweis-zur-oberflaeche"]
        XCTAssertTrue(knopf.exists)
        attachScreenshot(named: "fremde-seite")
        knopf.tap()
        XCTAssertTrue(hinweis.waitForNonExistence(timeout: 5))
    }

    /// tasks.md 8.11: Entfernen nur für einen nicht aktiven Server, erst nach der Rückfrage mit dem
    /// Hinweis auf nicht übertragene Einträge.
    @MainActor
    func testServerEntfernenFragtVorher() {
        let app = launch("serverliste")
        XCTAssertTrue(element(app, "serverliste").waitForExistence(timeout: 15))
        app.staticTexts["ELW 1"].swipeLeft()
        XCTAssertFalse(app.buttons["Entfernen"].waitForExistence(timeout: 2), "aktiver Server entfernbar")
        app.staticTexts["ELW 1"].swipeRight()

        app.staticTexts["Lager"].swipeLeft()
        let entfernen = app.buttons["Entfernen"]
        XCTAssertTrue(entfernen.waitForExistence(timeout: 5))
        entfernen.tap()
        let bestaetigen = app.buttons["entfernen-bestaetigen"]
        XCTAssertTrue(bestaetigen.waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'noch nicht übertragen'"))
                .firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Lager"].exists, "vor der Bestätigung schon entfernt")
        attachScreenshot(named: "server-entfernen")
        bestaetigen.tap()
        XCTAssertTrue(app.staticTexts["Lager"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["ELW 1"].exists)
    }

    @MainActor
    func testEinstellungen() {
        let app = launch("einstellungen")
        XCTAssertTrue(element(app, "einstellungen").waitForExistence(timeout: 15))
        XCTAssertTrue(app.switches["schalter-haptik"].exists)
        attachScreenshot(named: "einstellungen")
    }

    @MainActor
    func testStatusZertifikat() {
        let app = launch("zertifikat")
        XCTAssertTrue(element(app, "status-zertifikat").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Zertifikat nicht vertrauenswürdig"].exists)
        XCTAssertTrue(app.buttons["status-serverliste"].exists)
        attachScreenshot(named: "status-zertifikat")
    }

    @MainActor
    func testStatusNichtErreichbar() {
        let app = launch("nicht-erreichbar")
        XCTAssertTrue(element(app, "status-nicht-erreichbar").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Server nicht erreichbar"].exists)
        XCTAssertTrue(app.buttons["status-serverliste"].exists)
        attachScreenshot(named: "status-nicht-erreichbar")
    }

    @MainActor
    func testStatusZuAlt() {
        let app = launch("zu-alt")
        XCTAssertTrue(element(app, "status-zu-alt").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Server ist zu alt für diese App"].exists)
        attachScreenshot(named: "status-zu-alt")
    }

    @MainActor
    func testStatusZuNeu() {
        let app = launch("zu-neu")
        XCTAssertTrue(element(app, "status-zu-neu").waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["App aktualisieren"].exists)
        attachScreenshot(named: "status-zu-neu")
    }

    /// Von einer Status-Seite führt der Weg zur Serverliste (Spec `ios-huelle`).
    @MainActor
    func testVonDerStatusSeiteZurServerliste() {
        let app = launch("nicht-erreichbar")
        let knopf = app.buttons["status-serverliste"]
        XCTAssertTrue(knopf.waitForExistence(timeout: 15))
        knopf.tap()
        XCTAssertTrue(element(app, "serverliste").waitForExistence(timeout: 5))
    }

    /// Hintergrund und zurück: die App zeigt danach wieder eine Seite, keine leere Fläche
    /// (tasks.md 8.6; die Prüfung selbst steht in `AblaufTests` des Kerns).
    @MainActor
    func testNachDerRueckkehrInDenVordergrundStehtDieSeite() {
        let app = launch("nicht-erreichbar")
        XCTAssertTrue(element(app, "status-nicht-erreichbar").waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(element(app, "status-nicht-erreichbar").waitForExistence(timeout: 5))
    }

    /// Natives Gefühl (tasks.md 8.10; Spec `ios-huelle`, „Die Oberfläche fühlt sich nativ an“):
    /// Webview in der Safe Area, kein Nachfedern und kein Neuladen beim Ziehen, keine Lupe und kein
    /// Textmenü bei langer Berührung außerhalb von Eingaben. Die Seite ist
    /// `Testzustand.beispielseite`, geladen ohne Netz.
    @MainActor
    func testDieWebansichtFuehltSichNativAn() {
        let app = launch("web")
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let text = web.staticTexts["Lange Berührung auf diesem Text zeigt weder Lupe noch Textmenü."]
        XCTAssertTrue(text.waitForExistence(timeout: 10))
        // Safe Area: der Webview beginnt unter der Statusleiste, nicht am oberen Bildschirmrand.
        XCTAssertGreaterThan(web.frame.minY, 0)
        attachScreenshot(named: "web")

        let vorher = text.frame
        web.swipeDown(velocity: .fast)
        XCTAssertEqual(text.frame.minY, vorher.minY, accuracy: 1, "die Seite federt nach")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "Ziehen lädt neu")

        text.press(forDuration: 1.5)
        XCTAssertFalse(app.menuItems.firstMatch.waitForExistence(timeout: 2), "Textmenü erscheint")
        for befehl in ["Copy", "Kopieren", "Look Up", "Nachschlagen"] {
            XCTAssertFalse(app.buttons[befehl].exists, befehl)
        }
        attachScreenshot(named: "web-lange-beruehrung")
    }

    /// Dialoge der Seite (tasks.md 8.13): `confirm` erscheint als nativer Dialog mit dem Host des
    /// Servers als Titel, und „OK“ kommt bei der Seite als Zustimmung an. Der Knopf steht auf
    /// `Testzustand.beispielseite`.
    @MainActor
    func testEineRueckfrageDerSeiteErscheintNativ() {
        let app = launch("web")
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let knopf = web.buttons["Eintrag löschen"]
        XCTAssertTrue(knopf.waitForExistence(timeout: 10))
        knopf.tap()
        let dialog = app.alerts["elw.local:8443"]
        XCTAssertTrue(dialog.waitForExistence(timeout: 5), "kein nativer Dialog")
        XCTAssertTrue(dialog.staticTexts["Eintrag wirklich löschen?"].exists)
        XCTAssertTrue(dialog.buttons["Abbrechen"].exists)
        attachScreenshot(named: "dialog-confirm")
        dialog.buttons["OK"].tap()
        XCTAssertTrue(web.staticTexts["Bestätigt"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func launch(_ testzustand: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-LifelineTestzustand", testzustand]
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ kennung: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: kennung).firstMatch
    }

    @MainActor
    private func attachScreenshot(named name: String) {
        let anhang = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        anhang.name = name
        anhang.lifetime = .keepAlways
        add(anhang)
    }
}
