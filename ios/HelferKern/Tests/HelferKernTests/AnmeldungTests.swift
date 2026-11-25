import Foundation
import XCTest

@testable import HelferKern

/// Zustandsautomat der Anmeldung (Spec „Die Helfer-App“, „Logik im Kern“).
final class AnmeldungTests: XCTestCase {
    let ziel = HelferZiel(server: URL(string: "https://elw.local:8443/")!, code: "AB12CD34")

    func anmeldung(_ ereignisse: Ereignis...) -> Anmeldung {
        var anmeldung = Anmeldung()
        for ereignis in ereignisse { anmeldung.verarbeite(ereignis) }
        return anmeldung
    }

    func testDerRegelwegFuehrtVomScanBisZurAktivenOrtung() {
        var a = Anmeldung()
        XCTAssertEqual(a.phase, .start)
        a.verarbeite(.gescannt(ziel))
        XCTAssertEqual(a.phase, .anmelden(ziel))
        a.verarbeite(.eingeloest)
        XCTAssertEqual(a.phase, .unbestaetigt)
        XCTAssertTrue(a.phase.ortet, "die Ortung startet schon beim Einlösen")
        a.verarbeite(.bestaetigt)
        XCTAssertEqual(a.phase, .aktiv)
        a.verarbeite(.pausiert)
        XCTAssertEqual(a.phase, .pausiert)
        XCTAssertFalse(a.phase.ortet)
        a.verarbeite(.fortgesetzt)
        XCTAssertEqual(a.phase, .aktiv)
        a.verarbeite(.abgemeldet)
        XCTAssertEqual(a.phase, .beendet(.abgemeldet))
    }

    func testStoppenInAktivBeendetDieAnmeldung() {
        let a = anmeldung(.gescannt(ziel), .eingeloest, .bestaetigt, .antwort(.stoppen))
        XCTAssertEqual(a.phase, .beendet(.entfernt))
        XCTAssertFalse(a.phase.ortet)
    }

    func testStoppenInPausiertUndUnbestaetigtBeendetDieAnmeldung() {
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .bestaetigt, .pausiert, .antwort(.stoppen)).phase,
            .beendet(.entfernt))
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .antwort(.stoppen)).phase, .beendet(.entfernt))
    }

    func testWartenInUnbestaetigtBleibtUnbestaetigt() {
        let a = anmeldung(.gescannt(ziel), .eingeloest, .antwort(.warten))
        XCTAssertEqual(a.phase, .unbestaetigt)
        XCTAssertTrue(a.phase.ortet, "bei 409 läuft der Dienst weiter")
    }

    func testDieErsteAngenommenePositionBestaetigt() {
        XCTAssertEqual(anmeldung(.gescannt(ziel), .eingeloest, .antwort(.weiter)).phase, .aktiv)
    }

    func testWiederholenUndVerwerfenAendernNichts() {
        for antwort in [Antwort.wiederholen, .verwerfen] {
            XCTAssertEqual(
                anmeldung(.gescannt(ziel), .eingeloest, .antwort(antwort)).phase, .unbestaetigt)
            XCTAssertEqual(
                anmeldung(.gescannt(ziel), .eingeloest, .bestaetigt, .antwort(antwort)).phase, .aktiv)
        }
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .bestaetigt, .pausiert, .antwort(.weiter)).phase,
            .pausiert, "die Antwort auf das Pausieren setzt nicht fort")
    }

    func testOhneKopplungBewirktEineAntwortNichts() {
        XCTAssertEqual(anmeldung(.antwort(.stoppen)).phase, .start)
        XCTAssertEqual(anmeldung(.gescannt(ziel), .antwort(.weiter)).phase, .anmelden(ziel))
    }

    func testEinScanWaehrendEinerKopplungAendertNichts() {
        let anderes = HelferZiel(server: URL(string: "https://fremd.example/")!, code: "K7M2Q9XA")
        XCTAssertEqual(anmeldung(.gescannt(ziel), .eingeloest, .gescannt(anderes)).phase, .unbestaetigt)
        XCTAssertEqual(anmeldung(.gescannt(ziel), .gescannt(anderes)).phase, .anmelden(anderes))
    }

    func testNachDemEndeFuehrtNurEinNeuerScanWeiter() {
        let ende = anmeldung(.gescannt(ziel), .eingeloest, .abgemeldet)
        XCTAssertEqual(ende.phase, .beendet(.abgemeldet))
        var a = ende
        for ereignis in [Ereignis.eingeloest, .bestaetigt, .antwort(.weiter), .fortgesetzt,
            .zustand("aktiv", grund: nil)]
        {
            a.verarbeite(ereignis)
            XCTAssertEqual(a.phase, .beendet(.abgemeldet), "\(ereignis)")
        }
        a.verarbeite(.gescannt(ziel))
        XCTAssertEqual(a.phase, .anmelden(ziel))
    }

    func testAbbrechenVorDemEinloesenFuehrtZumStart() {
        XCTAssertEqual(anmeldung(.gescannt(ziel), .abgemeldet).phase, .start)
    }

    func testZustandVomServer() {
        let wartet = [Ereignis.gescannt(ziel), .eingeloest]
        var a = Anmeldung()
        for e in wartet { a.verarbeite(e) }
        a.verarbeite(.zustand("aktiv", grund: nil))
        XCTAssertEqual(a.phase, .aktiv)
        a.verarbeite(.pausiert)
        a.verarbeite(.zustand("aktiv", grund: nil))
        XCTAssertEqual(a.phase, .pausiert, "der Zustand `aktiv` hebt die eigene Pause nicht auf")
        a.verarbeite(.zustand("unbekannt", grund: nil))
        XCTAssertEqual(a.phase, .pausiert)
        a.verarbeite(.zustand("beendet", grund: "incident_closed"))
        XCTAssertEqual(a.phase, .beendet(.einsatzBeendet))

        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .zustand("abgelehnt", grund: "rejected")).phase,
            .beendet(.abgelehnt))
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .zustand("beendet", grund: nil)).phase,
            .beendet(.entfernt))
        XCTAssertEqual(
            anmeldung(.zustand("unbestaetigt", grund: nil)).phase, .unbestaetigt,
            "nach einem Neustart der App stellt der Zustand des Servers die Phase her")
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .zustand("aktiv", grund: nil)).phase, .anmelden(ziel))
    }

    func testJederWireGrundHatEinenGrund() {
        let wire = ["incident_closed", "revoked", "expired", "rejected", "signed_out"]
        XCTAssertEqual(Set(wire.compactMap(Grund.init(wire:))), Set(Grund.allCases))
        for grund in Grund.allCases {
            XCTAssertEqual(Grund(wire: grund.wire), grund)
            XCTAssertFalse(grund.titel.isEmpty)
            XCTAssertFalse(grund.text.isEmpty)
        }
        XCTAssertNil(Grund(wire: "tracking_off"))
    }
}
