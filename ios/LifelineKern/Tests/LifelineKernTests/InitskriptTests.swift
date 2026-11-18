import XCTest

@testable import LifelineKern

/// Init-Skript der Hülle (`ios/App/Huelle/huelle.js`): die App ersetzt den Platzhalter
/// `__LIFELINE_VERSION__` durch ihre volle Version, bevor sie es als `WKUserScript` einspielt.
final class InitskriptTests: XCTestCase {
    let vorlage = """
        const rohVersion = '__LIFELINE_VERSION__';
        const version = rohVersion === '__LIFELINE_' + 'VERSION__' ? undefined : rohVersion;
        """

    func testDieVersionErsetztDenPlatzhalter() {
        let skript = Initskript.render(vorlage: vorlage, version: "1.0.0-alpha.312")
        XCTAssertTrue(skript.contains("const rohVersion = '1.0.0-alpha.312';"))
        // Der zusammengesetzte Vergleich bleibt stehen, sonst meldete das Skript nie eine Version.
        XCTAssertTrue(skript.contains("'__LIFELINE_' + 'VERSION__'"))
        XCTAssertFalse(skript.contains("'__LIFELINE_VERSION__'"))
    }

    func testOhneVersionBleibtDerPlatzhalterStehen() {
        XCTAssertEqual(Initskript.render(vorlage: vorlage, version: nil), vorlage)
    }

    func testEineVersionMitFremdenZeichenWirdNichtEingesetzt() {
        // Die Version landet in einem JS-String; Anführungszeichen o. Ä. dürfen nie hinein.
        for version in ["1.0.0'; alert(1); '", "1.0.0\n", "", "1.0.0 beta", "1.0.0\\"] {
            XCTAssertEqual(Initskript.render(vorlage: vorlage, version: version), vorlage, version)
        }
    }

    func testDasEchteSkriptTraegtDenPlatzhalter() throws {
        let datei = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("App/Huelle/huelle.js")
        let skript = try String(contentsOf: datei, encoding: .utf8)
        XCTAssertTrue(skript.contains("'__LIFELINE_VERSION__'"))
        let ersetzt = Initskript.render(vorlage: skript, version: "1.0.0-alpha.1")
        XCTAssertTrue(ersetzt.contains("const rohVersion = '1.0.0-alpha.1';"))
    }
}
