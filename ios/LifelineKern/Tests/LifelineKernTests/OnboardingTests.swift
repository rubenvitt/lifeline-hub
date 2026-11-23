import XCTest

@testable import LifelineKern

/// Onboarding als Zustandsfunktion (Spec `ios-huelle`, „Ohne Server zeigt die App nur das
/// Onboarding“): Adresse → Prüfung → gespeichert wird nur ein verträglicher Server.
final class OnboardingTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443")
    let info = ShellInfo(version: "1.0.0-alpha.300", shellContract: 2)

    func step(_ state: Onboarding.State, _ event: Onboarding.Event) -> Onboarding.Step {
        Onboarding.next(state, event)
    }

    func testDerStartIstEineLeereEingabe() {
        XCTAssertEqual(Onboarding.State.start, .eingabe(text: "", meldung: nil))
    }

    func testEineUngueltigeAdresseZeigtDieMeldungUndPrueftNicht() {
        let schritt = step(.eingabe(text: "http://elw.local", meldung: nil), .verbinden)
        XCTAssertEqual(
            schritt.state, .eingabe(text: "http://elw.local", meldung: AdressError.keinHttps.meldung))
        XCTAssertNil(schritt.effect)
    }

    func testTippenNimmtDieMeldungWeg() {
        let schritt = step(.eingabe(text: "http://", meldung: "x"), .textChanged("https://elw"))
        XCTAssertEqual(schritt.state, .eingabe(text: "https://elw", meldung: nil))
        XCTAssertNil(schritt.effect)
    }

    func testEineGueltigeAdresseWirdGeprueft() {
        let schritt = step(.eingabe(text: " https://ELW.local:8443 ", meldung: nil), .verbinden)
        XCTAssertEqual(schritt.state, .pruefung(elw))
        XCTAssertEqual(schritt.effect, .check(elw))
    }

    func testNurEinVertraeglicherServerWirdGespeichert() {
        let schritt = step(.pruefung(elw), .ergebnis(.vertraeglich(info), fuer: elw))
        XCTAssertEqual(schritt.state, .verbunden(elw, info))
        XCTAssertEqual(schritt.effect, .save(elw, info))
    }

    func testEinUnvertraeglicherOderUnerreichbarerServerWirdNichtGespeichert() {
        for ergebnis: Vertragsergebnis in [
            .nichtVertraeglich(.zuAlt, server: nil),
            .nichtVertraeglich(.zuNeu, server: ShellInfo(version: "2.0.0", shellContract: 3)),
            .nichtErreichbar(.zertifikat),
            .nichtErreichbar(.nichtErreichbar),
        ] {
            let schritt = step(.pruefung(elw), .ergebnis(ergebnis, fuer: elw))
            XCTAssertEqual(schritt.state, .abgelehnt(elw, ergebnis), "\(ergebnis)")
            XCTAssertNil(schritt.effect, "\(ergebnis)")
        }
    }

    func testNachEinerAblehnungLaesstSichErneutPruefenOderDieAdresseAendern() {
        let abgelehnt = Onboarding.State.abgelehnt(elw, .nichtErreichbar(.nichtErreichbar))
        XCTAssertEqual(step(abgelehnt, .verbinden).effect, .check(elw))
        XCTAssertEqual(
            step(abgelehnt, .textChanged("https://elw.local:9443")).state,
            .eingabe(text: "https://elw.local:9443", meldung: nil))
        XCTAssertEqual(
            step(abgelehnt, .zurueck).state, .eingabe(text: elw.text, meldung: nil))
    }

    /// QR-Code und Deeplink belegen nur vor: verbunden wird erst nach Bestätigung.
    func testVorbelegenSetztDieAdresseOhneZuPruefen() {
        let schritt = step(.start, .vorbelegen(elw))
        XCTAssertEqual(schritt.state, .eingabe(text: elw.text, meldung: nil))
        XCTAssertNil(schritt.effect)
    }

    /// Ein Ergebnis zu einer Prüfung, die nicht mehr läuft (die Person hat abgebrochen oder
    /// eine andere Adresse geprüft), ändert nichts.
    func testEinVeraltetesErgebnisBleibtWirkungslos() {
        let andere = try! ServerAdresse.parse("https://fuekw.local")
        let eingabe = Onboarding.State.eingabe(text: "abc", meldung: nil)
        XCTAssertEqual(step(eingabe, .ergebnis(.vertraeglich(info), fuer: elw)).state, eingabe)
        XCTAssertNil(step(eingabe, .ergebnis(.vertraeglich(info), fuer: elw)).effect)
        let schritt = step(.pruefung(andere), .ergebnis(.vertraeglich(info), fuer: elw))
        XCTAssertEqual(schritt.state, .pruefung(andere))
        XCTAssertNil(schritt.effect)
    }

    func testWaehrendDerPruefungFuehrtZurueckZurEingabe() {
        let schritt = step(.pruefung(elw), .zurueck)
        XCTAssertEqual(schritt.state, .eingabe(text: elw.text, meldung: nil))
        XCTAssertNil(schritt.effect)
    }
}
