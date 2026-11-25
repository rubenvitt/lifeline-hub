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

/// QR, Deeplink, Antwortcodes, Takt, Wiederholung und Sendeplan gegen
/// `src-tauri/faelle/helfer.json`.
final class HelferFaelleTests: XCTestCase {
    struct Datei: Decodable {
        let deute: [DeuteFall]
        let antwort: [AntwortFall]
        let takt: [TaktFall]
        let wiederholung: [WiederholungFall]
        let sendeplan: [SendeplanFall]
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
        let grund: String?
        let entscheidung: String
    }

    struct TaktFall: Decodable {
        let beschreibung: String
        let seit_letzter_s: Double
        let bewegt_m: Double
        let senden: Bool
    }

    struct WiederholungFall: Decodable {
        let beschreibung: String
        let fehler_in_folge: Int
        let abstand_s: Int
    }

    struct Schritt: Decodable {
        let art: String
        let um_s: Double
        let gemessen_s: Double?
        let nord_m: Double?
        let antwort: String?
        let sendet: Double?
        let fordert_an: Bool?
    }

    struct SendeplanFall: Decodable {
        let beschreibung: String
        let schritte: [Schritt]
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
            XCTAssertEqual(
                entscheide(status: fall.status, grund: fall.grund).rawValue, fall.entscheidung,
                fall.beschreibung)
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

    func testJederGemeinsameFallVonWiederholungGilt() throws {
        let faelle = try datei().wiederholung
        XCTAssertGreaterThanOrEqual(faelle.count, 5)
        for fall in faelle {
            var w = Wiederholung()
            var abstand = 0
            for _ in 0..<fall.fehler_in_folge { abstand = w.naechsterAbstandS() }
            XCTAssertEqual(abstand, fall.abstand_s, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonSendeplanGilt() throws {
        let faelle = try datei().sendeplan
        XCTAssertGreaterThanOrEqual(faelle.count, 10)
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        for fall in faelle {
            var plan = Sendeplan()
            for (i, schritt) in fall.schritte.enumerated() {
                let jetzt = start.addingTimeInterval(schritt.um_s)
                let wo = "\(fall.beschreibung), Schritt \(i + 1) (\(schritt.art))"
                let gesendet: Position?
                switch schritt.art {
                case "messung":
                    let gemessen = start.addingTimeInterval(schritt.gemessen_s ?? schritt.um_s)
                    let p = Position(
                        latitude: 50 + (schritt.nord_m ?? 0) / 111_195, longitude: 8.6, accuracy: 5,
                        recordedAt: gemessen)
                    gesendet = plan.messung(p, jetzt: jetzt)
                case "antwort":
                    let antwort = try XCTUnwrap(Antwort(rawValue: schritt.antwort ?? ""), wo)
                    gesendet = plan.antwort(antwort, jetzt: jetzt)
                case "versuch":
                    gesendet = plan.versuch(jetzt: jetzt)
                case "lebenszeichen":
                    let fordert = plan.lebenszeichen(jetzt: jetzt)
                    XCTAssertEqual(fordert, schritt.fordert_an, wo)
                    continue
                default:
                    XCTFail("unbekannte Art \(schritt.art)")
                    continue
                }
                XCTAssertEqual(
                    gesendet?.recordedAt, schritt.sendet.map { start.addingTimeInterval($0) }, wo)
            }
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
