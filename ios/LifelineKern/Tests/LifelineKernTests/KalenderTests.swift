import Foundation
import XCTest

@testable import LifelineKern

/// Kalenderdateien gegen die gemeinsamen Fälle (`src-tauri/faelle/kalender.json`, LLH-2127).
final class KalenderTests: XCTestCase {
    struct Datei: Decodable {
        let oeffnen_als: [OeffnenFall]
    }

    struct OeffnenFall: Decodable {
        let beschreibung: String
        let mimetyp: String
        let endung: String
        let erwartet: String
    }

    func testJederGemeinsameFallFuerOeffnenAlsGilt() throws {
        let faelle = try GemeinsameFaelle.load("kalender.json", as: Datei.self).oeffnen_als
        XCTAssertFalse(faelle.isEmpty)
        for fall in faelle {
            XCTAssertEqual(
                Downloadablage.oeffnenAls(mimetyp: fall.mimetyp, endung: fall.endung).rawValue,
                fall.erwartet, fall.beschreibung)
        }
    }
}
