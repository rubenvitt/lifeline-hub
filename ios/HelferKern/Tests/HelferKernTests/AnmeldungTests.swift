import Foundation
import XCTest

@testable import HelferKern

/// Zustandsautomat der Anmeldung (Spec „Die Helfer-App“, „Logik im Kern“).
final class AnmeldungTests: XCTestCase {
    let ziel = HelferZiel(server: URL(string: "https://elw.local:8443/")!, code: "AB12CD34")
    let tracker = Rolle(isTracker: true, personId: nil)
    let ohneRolle = Rolle(isTracker: false, personId: nil)
    let nurPerson = Rolle(isTracker: false, personId: 5)

    func aktiv(_ rolle: Rolle) -> Ereignis { .zustand("aktiv", grund: nil, rolle: rolle) }

    func bestaetigt() -> Anmeldung { anmeldung(.gescannt(ziel), .eingeloest, aktiv(tracker)) }

    func ruht(_ grund: String) -> Ereignis { .antwort(.ruhen, grund: grund) }

    func nach(_ a: Anmeldung, _ ereignisse: Ereignis...) -> Phase {
        var a = a
        for ereignis in ereignisse { a.verarbeite(ereignis) }
        return a.phase
    }

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
            .zustand("aktiv", grund: nil, rolle: tracker)]
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
        a.verarbeite(.zustand("aktiv", grund: nil, rolle: tracker))
        XCTAssertEqual(a.phase, .aktiv)
        a.verarbeite(.pausiert)
        a.verarbeite(.zustand("aktiv", grund: nil, rolle: tracker))
        XCTAssertEqual(a.phase, .pausiert, "der Zustand `aktiv` hebt die eigene Pause nicht auf")
        a.verarbeite(.zustand("unbekannt", grund: nil, rolle: tracker))
        XCTAssertEqual(a.phase, .pausiert)
        a.verarbeite(.zustand("beendet", grund: "incident_closed", rolle: tracker))
        XCTAssertEqual(a.phase, .beendet(.einsatzBeendet))

        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .zustand("abgelehnt", grund: "rejected", rolle: tracker)).phase,
            .beendet(.abgelehnt))
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .zustand("beendet", grund: nil, rolle: tracker)).phase,
            .beendet(.entfernt))
        XCTAssertEqual(
            anmeldung(.zustand("unbestaetigt", grund: nil, rolle: tracker)).phase, .unbestaetigt,
            "nach einem Neustart der App stellt der Zustand des Servers die Phase her")
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .zustand("aktiv", grund: nil, rolle: tracker)).phase, .anmelden(ziel))
    }

    func test403NoRoleNachDerBestaetigungRuhtStattZuBeenden() {
        var a = bestaetigt()
        a.verarbeite(ruht("no_role"))
        XCTAssertEqual(a.phase, .ruht(.keineRolle))
        XCTAssertFalse(a.phase.ortet, "der Dienst ist aus")
        XCTAssertTrue(a.phase.gekoppelt, "Kopplung und Sitzung bleiben, Abmelden geht weiter")
        a.verarbeite(.abgemeldet)
        XCTAssertEqual(a.phase, .beendet(.abgemeldet))
    }

    func test403TrackingOffRuhtInJederOrtendenPhaseEinePauseBleibtPause() {
        XCTAssertEqual(nach(bestaetigt(), ruht("tracking_off")), .ruht(.ortungAus))
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, ruht("tracking_off")).phase, .ruht(.ortungAus))
        XCTAssertEqual(
            anmeldung(.gescannt(ziel), .eingeloest, .bestaetigt, .pausiert, ruht("tracking_off")).phase,
            .pausiert)
    }

    func testOhneOrtungsgeraetUndPersonRuhtDieAnmeldungSchonBeimBestaetigen() {
        var a = anmeldung(.gescannt(ziel), .eingeloest, aktiv(ohneRolle))
        XCTAssertEqual(a.phase, .ruht(.keineRolle))
        a.verarbeite(aktiv(ohneRolle))
        XCTAssertEqual(a.phase, .ruht(.keineRolle))
        a.verarbeite(aktiv(tracker))
        XCTAssertEqual(a.phase, .aktiv, "die Leitung macht das Gerät zum Ortungsgerät: es ortet weiter")
        XCTAssertTrue(a.phase.ortet)
    }

    func testDieRuheOhneRolleEndetErstMitEinerAnderenRolle() {
        // Person zugeordnet, aber die Organisation ortet keine Personen: 403 no_role.
        var a = anmeldung(.gescannt(ziel), .eingeloest, aktiv(nurPerson))
        XCTAssertEqual(a.phase, .aktiv)
        a.verarbeite(ruht("no_role"))
        a.verarbeite(aktiv(nurPerson))
        XCTAssertEqual(a.phase, .ruht(.keineRolle), "dieselbe Rolle sendete nur wieder in den 403")
        a.verarbeite(aktiv(tracker))
        XCTAssertEqual(a.phase, .aktiv)
    }

    func testEineVeralteteRolleBeimRuhenHaeltDieRuheNichtFest() {
        XCTAssertEqual(
            nach(bestaetigt(), ruht("no_role"), aktiv(ohneRolle), aktiv(tracker)), .aktiv,
            "erst ohne Rolle, dann wieder Ortungsgerät")
    }

    func testDieRuheBeiOrtungAusEndetNurMitEinemAngenommenenFortsetzen() {
        var a = bestaetigt()
        a.verarbeite(ruht("tracking_off"))
        a.verarbeite(aktiv(tracker))
        XCTAssertEqual(
            a.phase, .ruht(.ortungAus), "der Zustand nennt die Einstellung der Organisation nicht")
        a.verarbeite(.zustand("unbestaetigt", grund: nil, rolle: ohneRolle))
        XCTAssertEqual(a.phase, .ruht(.ortungAus))
        a.verarbeite(ruht("tracking_off"))
        XCTAssertEqual(a.phase, .ruht(.ortungAus))
        a.verarbeite(.antwort(.weiter))
        XCTAssertEqual(a.phase, .aktiv)
        XCTAssertTrue(Ruhegrund.ortungAus.pruefeMitFortsetzen)
        XCTAssertFalse(Ruhegrund.keineRolle.pruefeMitFortsetzen)
    }

    func testAusDerRuheBeenden401404UndDerZustandDesServers() {
        XCTAssertEqual(nach(bestaetigt(), ruht("no_role"), .antwort(.stoppen)), .beendet(.entfernt))
        XCTAssertEqual(
            nach(
                bestaetigt(), ruht("tracking_off"),
                .zustand("beendet", grund: "incident_closed", rolle: tracker)),
            .beendet(.einsatzBeendet))
        XCTAssertEqual(
            nach(bestaetigt(), ruht("tracking_off"), .antwort(.warten)), .unbestaetigt,
            "ein Fortsetzen mit 409: die Leitung hat noch nicht bestätigt")
    }

    func test403OhneBekanntenGrundBeendetWeiter() {
        XCTAssertEqual(
            nach(bestaetigt(), .antwort(entscheide(status: 403, grund: "target_removed"))),
            .beendet(.entfernt))
        XCTAssertEqual(entscheide(status: 403, grund: "no_role"), .ruhen)
        XCTAssertEqual(entscheide(status: 403), .stoppen)
        XCTAssertEqual(entscheide(status: 302), .wiederholen, "einer Weiterleitung folgt die App nicht")
        XCTAssertEqual(
            Set(["no_role", "tracking_off"].compactMap { Ruhegrund(wire: $0) }), Set(Ruhegrund.allCases))
        XCTAssertNil(Ruhegrund(wire: nil))
        for grund in Ruhegrund.allCases {
            XCTAssertEqual(Ruhegrund(wire: grund.wire), grund)
            XCTAssertFalse(grund.text.isEmpty)
        }
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
