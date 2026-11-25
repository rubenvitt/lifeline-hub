import Foundation
import XCTest

@testable import HelferKern

/// Liest die gemeinsamen Fälle der Helfer-App (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“) wie
/// `ios/LifelineKern/Tests/LifelineKernTests/GemeinsameFaelle.swift`: eine Quelle, keine Kopie und
/// kein Symlink, gelesen über `#filePath` aus dem Repo.
enum GemeinsameFaelle {
    /// Pfad der Fälle relativ zur Repo-Wurzel; `scripts/bereiche.test.sh` sucht dieses Literal.
    static let verzeichnis = "src-tauri/faelle"

    static var wurzel: URL {
        // …/ios/HelferKern/Tests/HelferKernTests/GemeinsameFaelle.swift → Repo-Wurzel
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url.deleteLastPathComponent() }
        return url
    }

    static func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        let datei = wurzel.appendingPathComponent(verzeichnis).appendingPathComponent(name)
        let daten = try Data(contentsOf: datei)
        return try JSONDecoder().decode(T.self, from: daten)
    }
}

/// QR, Deeplink, Antwortcodes und Takt gegen `src-tauri/faelle/helfer.json`.
final class HelferFaelleTests: XCTestCase {
    struct Datei: Decodable {
        let deute: [DeuteFall]
        let antwort: [AntwortFall]
        let takt: [TaktFall]
    }

    struct Ergebnis: Decodable {
        let server: String
        let code: String
    }

    struct DeuteFall: Decodable {
        let beschreibung: String
        let eingabe: String
        let ergebnis: Ergebnis?
    }

    struct AntwortFall: Decodable {
        let beschreibung: String
        let status: Int
        let entscheidung: String
    }

    struct TaktFall: Decodable {
        let beschreibung: String
        let seit_letzter_s: Double
        let bewegt_m: Double
        let senden: Bool
    }

    func datei() throws -> Datei { try GemeinsameFaelle.load("helfer.json", as: Datei.self) }

    func testJederGemeinsameFallVonDeuteGilt() throws {
        let faelle = try datei().deute
        XCTAssertGreaterThanOrEqual(faelle.count, 20)
        for fall in faelle {
            let ziel = deuteHelferLink(fall.eingabe)
            XCTAssertEqual(ziel?.server.absoluteString, fall.ergebnis?.server, fall.beschreibung)
            XCTAssertEqual(ziel?.code, fall.ergebnis?.code, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonAntwortGilt() throws {
        let faelle = try datei().antwort
        XCTAssertGreaterThanOrEqual(faelle.count, 10)
        for fall in faelle {
            XCTAssertEqual(entscheide(status: fall.status).rawValue, fall.entscheidung, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonTaktGilt() throws {
        let faelle = try datei().takt
        XCTAssertGreaterThanOrEqual(faelle.count, 8)
        let takt = Takt()
        for fall in faelle {
            XCTAssertEqual(
                takt.soll(senden: fall.seit_letzter_s, bewegtM: fall.bewegt_m), fall.senden,
                fall.beschreibung)
        }
    }

    /// Jede Entscheidung kommt in den Fällen vor; ein neuer Fall der Enum ohne Fall in der JSON
    /// fiele sonst nicht auf.
    func testDieFaelleDeckenJedeEntscheidung() throws {
        let faelle = try datei().antwort
        let genannt = Set(faelle.map(\.entscheidung))
        XCTAssertEqual(genannt, Set(Antwort.allCases.map(\.rawValue)))
    }
}
