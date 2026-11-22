import Foundation
import XCTest

@testable import LifelineKern

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Vertragsprüfung gegen `GET /api/shell` (Spec `ios-huelle`, „Die App lädt nur einen
/// verträglichen Server“ und „Server ohne Vertrag gelten als zu alt“). Bewertung und
/// Weiterleitungsregel prüfen die gemeinsamen Fälle (`src-tauri/faelle/vertrag.json`); hier
/// stehen nur, was allein die iOS-Hülle kennt: Zertifikatsfehler, `HealthInfo`, fehlende URLs.
final class VertragTests: XCTestCase {
    struct Datei: Decodable {
        let bekannt: [Int]
        let bewerte: [BewerteFall]
        let weiterleitung: [WeiterleitungFall]
    }

    struct BewerteFall: Decodable {
        let beschreibung: String
        let abruf: Abruf
        let letzterVertrag: Int?
        let bekannt: [Int]?
        let ergebnis: String
        let serverVersion: String?
        let shellContract: Int?

        enum CodingKeys: String, CodingKey {
            case beschreibung, abruf, bekannt, ergebnis
            case letzterVertrag = "letzter_vertrag"
            case serverVersion = "server_version"
            case shellContract = "shell_contract"
        }
    }

    struct Abruf: Decodable {
        let fehler: Bool?
        let status: Int?
        let contentType: String?
        let koerper: String?

        enum CodingKeys: String, CodingKey {
            case fehler, status, koerper
            case contentType = "content_type"
        }

        /// Keine Antwort heißt hier keine Verbindung; Zertifikatsfehler prüfen eigene Tests.
        var shellAbruf: ShellAbruf {
            guard fehler != true, let status else { return .fehler(.notConnectedToInternet) }
            return .antwort(status: status, body: Data((koerper ?? "").utf8), contentType: contentType)
        }
    }

    struct WeiterleitungFall: Decodable {
        let beschreibung: String
        let von: String
        let nach: String
        let folgt: Bool
    }

    func datei() throws -> Datei { try GemeinsameFaelle.load("vertrag.json", as: Datei.self) }

    /// Das Ergebnis in der Form der Fälle. Die iOS-Hülle trägt bei „nicht verträglich“ den ganzen
    /// `ShellInfo` des Servers; die Fälle nennen davon die Version (wie die Desktop-Hülle).
    struct Erwartung: Equatable {
        let ergebnis: String
        let serverVersion: String?
        let shellContract: Int?

        init(_ fall: BewerteFall) {
            ergebnis = fall.ergebnis
            serverVersion = fall.serverVersion
            shellContract = fall.shellContract
        }

        init(_ ist: Vertragsergebnis) {
            switch ist {
            case .vertraeglich(let info):
                (ergebnis, serverVersion, shellContract) = ("vertraeglich", info.version, info.shellContract)
            case .nichtVertraeglich(let klasse, let server):
                ergebnis = klasse == .zuNeu ? "zu_neu" : klasse == .zuAlt ? "zu_alt" : "\(klasse)"
                (serverVersion, shellContract) = (server?.version, nil)
            case .nichtErreichbar(let klasse):
                ergebnis = klasse == .nichtErreichbar ? "nicht_erreichbar" : "\(klasse)"
                (serverVersion, shellContract) = (nil, nil)
            }
        }
    }

    func testJederGemeinsameFallVonBewerteGilt() throws {
        let datei = try datei()
        XCTAssertGreaterThanOrEqual(datei.bewerte.count, 20)
        for fall in datei.bewerte {
            let ist = Vertragspruefung.evaluate(
                fall.abruf.shellAbruf, letzterVertrag: fall.letzterVertrag,
                bekannt: fall.bekannt ?? datei.bekannt)
            XCTAssertEqual(Erwartung(ist), Erwartung(fall), fall.beschreibung)
        }
    }

    func testJederGemeinsameFallVonWeiterleitungGilt() throws {
        let faelle = try datei().weiterleitung
        XCTAssertGreaterThanOrEqual(faelle.count, 5)
        for fall in faelle {
            XCTAssertEqual(
                Vertragspruefung.followsRedirect(von: URL(string: fall.von), nach: URL(string: fall.nach)),
                fall.folgt, fall.beschreibung)
        }
    }

    /// Die Liste der gemeinsamen Fälle ist die der App; ohne `bekannt` prüft `evaluate` gegen sie.
    func testDieAppKenntDieVertraegeDerGemeinsamenFaelle() throws {
        XCTAssertEqual(LifelineKern.bekannteVertraege, try datei().bekannt)
        let abruf = ShellAbruf.antwort(
            status: 200, body: Data(#"{"version":"2.0.0","shell_contract":2}"#.utf8),
            contentType: "application/json")
        XCTAssertEqual(
            Vertragspruefung.evaluate(abruf, letzterVertrag: nil),
            Vertragspruefung.evaluate(abruf, letzterVertrag: nil, bekannt: LifelineKern.bekannteVertraege))
    }

    /// Ohne URL folgt der Abruf keiner Weiterleitung (Optionals gibt es nur in der iOS-Hülle).
    func testOhneUrlWirdKeinerWeiterleitungGefolgt() {
        let shell = URL(string: "https://elw.local:8443/api/shell")
        XCTAssertFalse(Vertragspruefung.followsRedirect(von: nil, nach: shell))
        XCTAssertFalse(Vertragspruefung.followsRedirect(von: shell, nach: nil))
    }

    func testDieVersionEinesZuAltenServersKommtAusHealth() throws {
        let json = #"{"status":"degraded","version":"1.0.0-alpha.12","db":false}"#
        XCTAssertEqual(try HealthInfo(json: Data(json.utf8)).version, "1.0.0-alpha.12")
    }

    /// Jeder Verbindungsfehler bewertet sich wie „ohne Verbindung“ der gemeinsamen Fälle.
    func testJederVerbindungsfehlerGiltWieOhneVerbindung() {
        for code: URLError.Code in [.notConnectedToInternet, .timedOut, .cannotConnectToHost] {
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 1),
                .nichtErreichbar(.nichtErreichbar), "\(code)")
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 2),
                .nichtVertraeglich(.zuNeu, server: nil), "\(code)")
        }
    }

    func testEinZertifikatsfehlerIstKeinNichtErreichbar() {
        for code: URLError.Code in [
            .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
            .serverCertificateHasBadDate, .serverCertificateNotYetValid,
        ] {
            XCTAssertEqual(Fehlerklasse(code), .zertifikat, "\(code)")
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 1),
                .nichtErreichbar(.zertifikat))
            // Auch ein zuletzt unverträglicher Server zeigt zuerst die Anleitung zum Zertifikat:
            // ohne Vertrauen erfährt die App den heutigen Vertrag nicht.
            XCTAssertEqual(
                Vertragspruefung.evaluate(.fehler(code), letzterVertrag: 2),
                .nichtErreichbar(.zertifikat))
        }
        for code: URLError.Code in [
            .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .timedOut,
            .networkConnectionLost, .dnsLookupFailed,
        ] {
            XCTAssertEqual(Fehlerklasse(code), .nichtErreichbar, "\(code)")
        }
    }
}
