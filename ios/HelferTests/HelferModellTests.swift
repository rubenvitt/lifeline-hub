import HelferKern
import XCTest

@testable import LifelineHelfer

/// Modell der Helfer-App ohne Systemdienste (`Umgebung.test`): welche Phase gilt, entscheidet der
/// Kern; das Modell reicht Scan und Eingabe richtig durch.
@MainActor
final class HelferModellTests: XCTestCase {
    let einladung = HelferZiel(server: URL(string: "https://elw.local:8443/")!, code: "AB12CD34")

    func testEinScanFuehrtZurPhaseAnmelden() {
        let modell = HelferModell(umgebung: .test)
        XCTAssertEqual(modell.phase, .start)
        XCTAssertTrue(modell.gescannt("https://elw.local:8443/helfer#ab12cd34"))
        XCTAssertEqual(modell.phase, .anmelden(einladung))
        XCTAssertEqual(modell.einladung, einladung)
        XCTAssertNil(modell.meldung)
    }

    func testEinFremderQRCodeBleibtAufDemStartMitMeldung() {
        let modell = HelferModell(umgebung: .test)
        XCTAssertFalse(modell.gescannt("https://elw.local:8443/koppeln#AB12CD34"))
        XCTAssertEqual(modell.phase, .start)
        XCTAssertNotNil(modell.meldung)
    }

    func testCodeEingebenOhneSchemaGiltAlsHttps() {
        let modell = HelferModell(umgebung: .test)
        XCTAssertTrue(modell.eingegeben(server: "elw.local:8443/", code: " ab12cd34 "))
        XCTAssertEqual(modell.phase, .anmelden(einladung))
    }

    func testEinDeeplinkFuehrtZurPhaseAnmelden() {
        let modell = HelferModell(umgebung: .test)
        modell.oeffne(URL(string: "lifeline-helfer://anmelden?server=https://elw.local:8443#AB12CD34")!)
        XCTAssertEqual(modell.phase, .anmelden(einladung))
    }

    func testEinNeuerScanWaehrendDerAnmeldungFragtErst() {
        let modell = HelferModell.start(argumente: ["-HelferTestzustand", "angemeldet"])
        XCTAssertEqual(modell.phase, .aktiv)
        XCTAssertTrue(modell.gescannt("https://anderer.example.org/helfer#ZZ99"))
        XCTAssertEqual(modell.phase, .aktiv, "die alte Anmeldung bleibt, bis die Kraft zustimmt")
        XCTAssertEqual(modell.ausstehenderScan?.code, "ZZ99")
    }

    func testJederTestzustandZeigtSeinePhase() {
        let erwartet: [Testzustand: Phase] = [
            .start: .start,
            .anmelden: .anmelden(Beispiel.einladung),
            .wartet: .unbestaetigt,
            .angemeldet: .aktiv,
            .pausiert: .pausiert,
            .ruht: .ruht(.keineRolle),
            .beendet: .beendet(.einsatzBeendet),
            .auftraege: .aktiv,
            .mitteilungenAus: .aktiv,
            .auftragOffen: .aktiv,
            .auftragUebernommen: .aktiv,
            .auftragAufgehoben: .aktiv,
            .quittungFehler: .aktiv,
        ]
        for zustand in Testzustand.allCases {
            let modell = HelferModell.start(argumente: ["-HelferTestzustand", zustand.rawValue])
            XCTAssertEqual(modell.phase, erwartet[zustand], zustand.rawValue)
        }
    }

    /// Aufträge (ADR-0106): Ordnung aus dem Kern, Detail aus dem Testzustand, „Übernommen“ ohne
    /// Netz im Testzustand.
    func testDieAuftraegeKommenGeordnetUndDerKnopfQuittiert() async throws {
        let modell = HelferModell.start(argumente: ["-HelferTestzustand", "auftrag-offen"])
        XCTAssertEqual(modell.auftraege.map(\.id), [7, 6, 5])
        XCTAssertEqual(modell.geoeffneterAuftrag, Beispiel.offenerAuftrag)
        let auftrag = try XCTUnwrap(modell.auftrag(Beispiel.offenerAuftrag))
        let zeile = try XCTUnwrap(auftrag.recipients.first)
        XCTAssertEqual(modell.stand(auftrag, empfaenger: zeile), .offen)
        await modell.quittiere(auftrag, empfaenger: zeile)
        let neu = try XCTUnwrap(modell.auftrag(Beispiel.offenerAuftrag))
        // Die Zeile aus dem neuen Stand: der Stand liest die Quittung aus der Zeile selbst.
        let neueZeile = try XCTUnwrap(neu.recipients.first { $0.id == zeile.id })
        guard case .quittiert(let um, let von) = modell.stand(neu, empfaenger: neueZeile) else {
            return XCTFail("nicht quittiert")
        }
        XCTAssertTrue(
            modell.quittungstext(zeile, um: um, von: von).hasPrefix("Übernommen um "),
            "die eigene Quittung nennt keinen Namen")
        XCTAssertTrue(modell.eigeneQuittungen.contains(zeile.id), "nur die eigene gibt Haptik")
    }

    func testEinAndererHatUebernommenUndAufgehobenGehtVor() throws {
        let modell = HelferModell.start(argumente: ["-HelferTestzustand", "auftrag-uebernommen"])
        let anderer = try XCTUnwrap(modell.auftrag(Beispiel.uebernommenerAuftrag))
        let zeile = try XCTUnwrap(anderer.recipients.first)
        guard case .quittiert(let um, let von) = modell.stand(anderer, empfaenger: zeile) else {
            return XCTFail("nicht quittiert")
        }
        XCTAssertTrue(modell.quittungstext(zeile, um: um, von: von).hasPrefix("Übernommen von Lisa K. um "))
        let weg = try XCTUnwrap(modell.auftrag(Beispiel.aufgehobenerAuftrag))
        XCTAssertEqual(modell.stand(weg, empfaenger: weg.recipients[0]), .aufgehoben)
    }

    func testEineGescheiterteQuittungBittetUmFunk() throws {
        let modell = HelferModell.start(argumente: ["-HelferTestzustand", "quittung-fehler"])
        let auftrag = try XCTUnwrap(modell.auftrag(Beispiel.offenerAuftrag))
        XCTAssertEqual(
            modell.stand(auftrag, empfaenger: auftrag.recipients[0]),
            .fehler(AuftragAnzeige.quittungFehlgeschlagen))
        XCTAssertTrue(HelferModell.start(argumente: ["-HelferTestzustand", "mitteilungen-aus"]).mitteilungenAus)
    }

    func testAbgewieseneAnfragenNutzenDieTexteDesKerns() {
        let rueckmeldung = Rueckmeldung(status: 403, daten: Data(#"{"reason":"no_role"}"#.utf8))
        XCTAssertEqual(HelferModell.text(fuer: rueckmeldung), Anzeige.meldung(status: 403, grund: "no_role"))
        XCTAssertEqual(rueckmeldung.antwort, .ruhen, "der Grund aus dem Body geht in die Entscheidung")
        XCTAssertEqual(Rueckmeldung(status: 403, daten: Data()).antwort, .stoppen)
        XCTAssertEqual(Rueckmeldung(status: 302, daten: Data()).antwort, .wiederholen)
    }

    func testDerAblaufRechnetMitDerUhrDesServers() throws {
        let zustand = Beispiel.zustand(state: "aktiv")
        let ablauf = try XCTUnwrap(zustand.ablauf)
        // Beispiel: Ablauf 8 h nach der Serverzeit.
        XCTAssertEqual(ablauf.timeIntervalSinceNow, 8 * 3600, accuracy: 5)
    }
}
