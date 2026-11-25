import Foundation
import LifelineKern
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

/// Nutzlast, Ordnung, Mitteilung und Quittungsstand der Aufträge gegen
/// `src-tauri/faelle/helfer-auftrag.json` (ADR-0104). Das Entschlüsseln selbst prüft
/// `ios/HelferTests` im Simulator (kein CryptoKit unter Linux); hier Umschlag und Klartext.
final class HelferAuftragFaelleTests: XCTestCase {
    struct Datei: Decodable {
        let zweck: String
        let nutzlast: [NutzlastFall]
        let ordnung: [OrdnungFall]
        let mitteilung: [MitteilungFall]
        let quittungsstand: [QuittungsstandFall]
    }

    struct NutzlastFall: Decodable {
        let beschreibung: String
        let kennung: String
        let schluessel: String
        let nonce: String
        let klartext: String
        let chiffrat: String
        let umschlag: String
    }

    struct OrdnungFall: Decodable {
        let beschreibung: String
        let auftraege: [HelferAuftrag]
        let erwartet: [Int64]
    }

    struct MitteilungFall: Decodable {
        let beschreibung: String
        let auftrag: HelferAuftrag
        /// `bereits_gemeldet` in der JSON (der Decoder übersetzt aus snake_case).
        let bereitsGemeldet: [Int64]
        let jetzt: String
        let erwartet: Bool
    }

    struct Stand: Decodable {
        let stand: String
        let um: String?
        let von: String?
    }

    struct QuittungsstandFall: Decodable {
        let beschreibung: String
        let auftrag: HelferAuftrag
        let erwartet: Stand
    }

    /// Der Klartext, wie der Server ihn schreibt (`PagerKlartext` in src/helfer/pager.rs).
    struct Klartext: Decodable {
        let v: Int
        let s: String
        let art: String
        let e: Int64
        let t: Int64
        let titel: String
        let text: String
    }

    /// Mit dem Decoder der App (snake_case), damit die Fälle auch die Wire-Namen prüfen.
    func datei() throws -> Datei {
        let url = GemeinsameFaelle.wurzel.appendingPathComponent(GemeinsameFaelle.verzeichnis)
            .appendingPathComponent("helfer-auftrag.json")
        return try HelferAuftrag.decoder.decode(Datei.self, from: Data(contentsOf: url))
    }

    func testJederGemeinsameFallVonNutzlastGilt() throws {
        let faelle = try datei().nutzlast
        XCTAssertGreaterThanOrEqual(faelle.count, 2)
        for fall in faelle {
            let umschlag = try XCTUnwrap(PagerNutzlast.umschlag(fall.umschlag), fall.beschreibung)
            XCTAssertEqual(umschlag.kennung, fall.kennung, fall.beschreibung)
            XCTAssertEqual(
                umschlag.nonce, try XCTUnwrap(Base64URL.decode(fall.nonce)), fall.beschreibung)
            XCTAssertEqual(
                umschlag.chiffrat, try XCTUnwrap(Base64URL.decode(fall.chiffrat)), fall.beschreibung)
            XCTAssertEqual(try XCTUnwrap(Base64URL.decode(fall.schluessel)).count, 32)

            let roh = Data(fall.klartext.utf8)
            let erwartet = try JSONDecoder().decode(Klartext.self, from: roh)
            XCTAssertEqual(erwartet.art, PagerNutzlast.art)
            let klartext = try XCTUnwrap(PagerNutzlast.klartext(roh), fall.beschreibung)
            XCTAssertEqual(klartext.version, erwartet.v, fall.beschreibung)
            XCTAssertEqual(klartext.server, erwartet.s, fall.beschreibung)
            XCTAssertEqual(klartext.einsatzId, erwartet.e, fall.beschreibung)
            XCTAssertEqual(klartext.auftragId, erwartet.t, fall.beschreibung)
            XCTAssertEqual(klartext.titel, erwartet.titel, fall.beschreibung)
            XCTAssertEqual(klartext.text, erwartet.text, fall.beschreibung)

            let meldung = try XCTUnwrap(PagerNutzlast.meldung(aus: roh), fall.beschreibung)
            XCTAssertEqual(meldung.titel, erwartet.titel, fall.beschreibung)
            XCTAssertEqual(meldung.text, erwartet.text, fall.beschreibung)
            XCTAssertEqual(meldung.auftragId, erwartet.t, fall.beschreibung)
            XCTAssertEqual(meldung.thread, "auftraege-\(erwartet.e)", fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonOrdnungGilt() throws {
        let faelle = try datei().ordnung
        XCTAssertFalse(faelle.isEmpty)
        for fall in faelle {
            XCTAssertEqual(
                Auftraege.ordnen(fall.auftraege).map(\.id), fall.erwartet, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonMitteilungGilt() throws {
        let faelle = try datei().mitteilung
        XCTAssertGreaterThanOrEqual(faelle.count, 6)
        for fall in faelle {
            let jetzt = try XCTUnwrap(Serverzeit.datum(fall.jetzt), fall.beschreibung)
            XCTAssertEqual(
                Auftraege.sollMitteilen(
                    fall.auftrag, bereitsGemeldet: Set(fall.bereitsGemeldet), jetzt: jetzt),
                fall.erwartet, fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonQuittungsstandGilt() throws {
        let faelle = try datei().quittungsstand
        XCTAssertGreaterThanOrEqual(faelle.count, 3)
        for fall in faelle {
            let erwartet: Quittungsstand
            switch fall.erwartet.stand {
            case "offen": erwartet = .offen
            case "aufgehoben": erwartet = .aufgehoben
            case "quittiert":
                let um = try XCTUnwrap(fall.erwartet.um.flatMap(Serverzeit.datum), fall.beschreibung)
                erwartet = .quittiert(um: um, von: fall.erwartet.von)
            default:
                XCTFail("unbekannter Stand \(fall.erwartet.stand)")
                continue
            }
            XCTAssertEqual(Quittungsstand.aus(fall.auftrag), erwartet, fall.beschreibung)
        }
    }
}
