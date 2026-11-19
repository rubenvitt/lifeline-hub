import XCTest

@testable import LifelineKern

/// Natives Gefühl im Webview (tasks.md 8.10; Entwurf D6; Spec `ios-huelle`, „Die Oberfläche
/// fühlt sich nativ an“): keine Lupe und kein Textmenü außerhalb von Eingaben, über einen
/// eingespielten Stil der Hülle, nicht über das Frontend-CSS.
final class HuellenstilTests: XCTestCase {
    func testAusserhalbVonEingabenKeineLupeUndKeinTextmenue() {
        let css = Huellenstil.css
        XCTAssertTrue(css.contains("-webkit-touch-callout: none"), css)
        XCTAssertTrue(css.contains("-webkit-user-select: none"), css)
    }

    func testEingabenBleibenAuswaehlbar() {
        let css = Huellenstil.css
        for selektor in ["input", "textarea", "[contenteditable]"] {
            XCTAssertTrue(css.contains(selektor), selektor)
        }
        XCTAssertTrue(css.contains("-webkit-user-select: text"), css)
        XCTAssertTrue(css.contains("-webkit-touch-callout: default"), css)
    }

    func testDasSkriptHaengtDenStilEinmalAnUndBrichtNichtAus() {
        let skript = Huellenstil.skript
        XCTAssertTrue(skript.contains(Huellenstil.kennung), skript)
        XCTAssertTrue(skript.contains("getElementById"), skript)
        XCTAssertTrue(skript.contains("DOMContentLoaded"), skript)
        // Das CSS steht als JSON-Literal darin, nicht als Vorlage mit Backticks.
        XCTAssertFalse(skript.contains("`"), skript)
    }

    func testDieBeispielseiteDerUiTestsHatTextUndEingabe() {
        XCTAssertTrue(Testzustand.beispielseite.contains("id=\"text\""))
        XCTAssertTrue(Testzustand.beispielseite.contains("<input"))
    }
}
