import XCTest

@testable import LifelineKern

/// Adressprüfung gegen die gemeinsamen Fälle (`src-tauri/faelle/adresse.json`).
final class AdresseTests: XCTestCase {
    struct Datei: Decodable {
        let meldungen: [String: String]
        let gesperrte_ports: [Int]
        let faelle: [Fall]
    }

    struct Fall: Decodable {
        let beschreibung: String
        let eingabe: String
        let adresse: String?
        let fehler: String?
    }

    func testJederGemeinsameFallGilt() throws {
        let datei = try GemeinsameFaelle.load("adresse.json", as: Datei.self)
        XCTAssertGreaterThanOrEqual(datei.faelle.count, 16)
        for fall in datei.faelle {
            switch (fall.adresse, fall.fehler) {
            case (let adresse?, nil):
                XCTAssertEqual(
                    try? ServerAdresse.parse(fall.eingabe).text, adresse, fall.beschreibung)
            case (nil, let fehler?):
                XCTAssertThrowsError(try ServerAdresse.parse(fall.eingabe), fall.beschreibung) {
                    XCTAssertEqual(($0 as? AdressError)?.rawValue, fehler, fall.beschreibung)
                }
            default:
                XCTFail("\(fall.beschreibung): genau eins von „adresse“ und „fehler“")
            }
        }
    }

    func testMeldungenSindWortgleichMitDerDesktopHuelle() throws {
        let datei = try GemeinsameFaelle.load("adresse.json", as: Datei.self)
        XCTAssertEqual(Set(datei.meldungen.keys), Set(AdressError.allCases.map(\.rawValue)))
        for fehler in AdressError.allCases {
            XCTAssertEqual(fehler.meldung, datei.meldungen[fehler.rawValue], "\(fehler)")
        }
    }

    func testGesperrtePortsGleichenDenFaellen() throws {
        let datei = try GemeinsameFaelle.load("adresse.json", as: Datei.self)
        XCTAssertEqual(ServerAdresse.gesperrtePorts.sorted(), datei.gesperrte_ports)
        XCTAssertEqual(ServerAdresse.gesperrtePorts.count, datei.gesperrte_ports.count)
        for port in datei.gesperrte_ports {
            XCTAssertThrowsError(try ServerAdresse.parse("https://elw.local:\(port)"), "Port \(port)") {
                XCTAssertEqual($0 as? AdressError, .gesperrterPort, "Port \(port)")
            }
        }
    }

    func testDieAdresseLaesstSichSpeichernUndWiederLesen() throws {
        let adresse = try ServerAdresse.parse("https://ELW.local:8443")
        let daten = try JSONEncoder().encode(adresse)
        XCTAssertEqual(
            try JSONDecoder().decode(String.self, from: daten), "https://elw.local:8443/")
        XCTAssertEqual(try JSONDecoder().decode(ServerAdresse.self, from: daten), adresse)
        XCTAssertThrowsError(
            try JSONDecoder().decode(ServerAdresse.self, from: Data(#""http://elw.local""#.utf8)))
    }

    func testDerHostnameIstDerVorgabename() throws {
        XCTAssertEqual(try ServerAdresse.parse("https://elw.local:8443/").host, "elw.local")
    }
}
