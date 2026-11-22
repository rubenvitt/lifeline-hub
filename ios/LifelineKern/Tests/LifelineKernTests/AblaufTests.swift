import Foundation
import XCTest

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@testable import LifelineKern

/// Welche Seite die App zeigt (Spec `ios-huelle`, „Die App lädt nur einen verträglichen Server“,
/// „Zertifikatsfehler und Unerreichbarkeit haben eigene Seiten“, „Nach einem Abbruch des
/// Web-Prozesses lädt die App neu“; Entwurf D4, D6).
final class AblaufTests: XCTestCase {
    var liste = Serverliste()
    var elw: ServerEintrag!
    var lager: ServerEintrag!
    let info = ShellInfo(version: "1.0.0-alpha.320", shellContract: 2)
    let eigen = URL(string: "https://elw.local:8443/einsatz/3")
    let idp = URL(string: "https://idp.example/realms/drk/login")

    override func setUp() {
        elw = liste.add(try! ServerAdresse.parse("https://elw.local:8443"))
        lager = liste.add(try! ServerAdresse.parse("https://lager.example"))
    }

    func step(_ seite: Ablauf.Seite, _ event: Ablauf.Event) -> Ablauf.Step {
        Ablauf.next(seite, event)
    }

    // MARK: Start, Wechsel, Onboarding

    func testOhneServerZeigtDieAppNurDasOnboarding() {
        let schritt = step(.onboarding, .start(aktiv: nil))
        XCTAssertEqual(schritt.seite, .onboarding)
        XCTAssertEqual(schritt.effects, [])
    }

    func testBeimStartPrueftDieAppDenVertragVorDemLaden() {
        let schritt = step(.onboarding, .start(aktiv: elw))
        XCTAssertEqual(schritt.seite, .pruefung(elw))
        XCTAssertEqual(schritt.effects, [.check(elw)])
    }

    func testEinVertraeglicherServerWirdGeladenUndVermerkt() {
        let schritt = step(.pruefung(elw), .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 2), .load(elw)])
    }

    func testBeimWechselPrueftDieAppDenNeuenServer() {
        for vorher: Ablauf.Seite in [.web(elw, vertrag: 2), .status(elw, .nichtErreichbar), .pruefung(elw)] {
            let schritt = step(vorher, .wechseln(lager))
            XCTAssertEqual(schritt.seite, .pruefung(lager))
            XCTAssertEqual(schritt.effects, [.check(lager)])
        }
    }

    func testEinErgebnisFuerDenVorherigenServerWirdVerworfen() {
        let schritt = step(.pruefung(lager), .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .pruefung(lager))
        XCTAssertEqual(schritt.effects, [])
    }

    func testNachDemOnboardingLaedtDieAppOhneZweitePruefung() {
        let schritt = step(.onboarding, .verbunden(elw, info))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 2), .load(elw)])
    }

    // MARK: Status-Seiten

    func testEinUnbekannterVertragZeigtDieRichtungUndLaedtNicht() {
        let neu = ShellInfo(version: "2.0.0", shellContract: 3)
        let schritt = step(
            .pruefung(elw), .ergebnis(.nichtVertraeglich(.zuNeu, server: neu), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: "2.0.0")))
        XCTAssertEqual(schritt.effects, [])
    }

    func testEinServerOhneVertragNenntDieVersionAusHealth() {
        let schritt = step(
            .pruefung(elw),
            .ergebnis(.nichtVertraeglich(.zuAlt, server: nil), healthVersion: "1.0.0-alpha.200", fuer: elw.id))
        XCTAssertEqual(
            schritt.seite, .status(elw, .nichtVertraeglich(.zuAlt, serverVersion: "1.0.0-alpha.200")))
    }

    func testEinZertifikatsfehlerHatSeineEigeneSeiteOhneWiederholung() {
        let schritt = step(.pruefung(elw), .ergebnis(.nichtErreichbar(.zertifikat), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .zertifikat))
        XCTAssertEqual(schritt.effects, [])
    }

    func testNichtErreichbarPrueftRegelmaessigUndLaedtVonSelbst() {
        let a = step(.pruefung(elw), .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(a.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(a.effects, [.scheduleRetry])
        let b = step(a.seite, .wiederholen)
        XCTAssertEqual(b.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(b.effects, [.check(elw)])
        let c = step(b.seite, .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(c.effects, [.scheduleRetry])
        let d = step(c.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(d.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(d.effects, [.markVerbunden(elw.id, vertrag: 2), .load(elw)])
    }

    func testWiederholenGiltNurAufDerSeiteNichtErreichbar() {
        for seite: Ablauf.Seite in [
            .onboarding, .pruefung(elw), .web(elw, vertrag: 2), .status(elw, .zertifikat),
            .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: nil)),
        ] {
            let schritt = step(seite, .wiederholen)
            XCTAssertEqual(schritt.seite, seite)
            XCTAssertEqual(schritt.effects, [], "\(seite)")
        }
    }

    // MARK: Vordergrund

    func testRueckkehrMitLebenderSeitePrueftOhneNeuzuladen() {
        let schritt = step(.web(elw, vertrag: 2), .vordergrund(seiteAntwortet: true, adresse: eigen, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.check(elw)])
        let ok = step(schritt.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(ok.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(ok.effects, [.markVerbunden(elw.id, vertrag: 2)])
    }

    func testRueckkehrOhneNetzLaesstDieGeladeneSeiteStehen() {
        // Die Oberfläche arbeitet ohne Netz weiter (Schreib-Queue); eine Status-Seite verdrängte sie.
        let schritt = step(
            .web(elw, vertrag: 2), .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [])
    }

    /// Ohne Vertrauen ins Zertifikat arbeitet die Oberfläche nicht weiter; die Anleitung zum
    /// CA-Profil geht vor, auch wenn sie schon geladen war.
    func testRueckkehrMitZertifikatsfehlerZeigtDieAnleitungAuchBeiGeladenerSeite() {
        let schritt = step(
            .web(elw, vertrag: 2), .ergebnis(.nichtErreichbar(.zertifikat), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .zertifikat))
        XCTAssertEqual(schritt.effects, [])
    }

    func testRueckkehrZuEinemGehobenenServerZeigtAppAktualisieren() {
        let neu = ShellInfo(version: "2.0.0", shellContract: 3)
        let schritt = step(
            .web(elw, vertrag: 2), .ergebnis(.nichtVertraeglich(.zuNeu, server: neu), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: "2.0.0")))
    }

    func testRueckkehrMitToterSeitePrueftUndLaedtNeu() {
        let schritt = step(.web(elw, vertrag: 2), .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, .pruefung(elw))
        XCTAssertEqual(schritt.effects, [.check(elw)])
    }

    func testRueckkehrAufEinerStatusSeitePrueftErneut() {
        for status: Statusseite in [.zertifikat, .nichtErreichbar, .nichtVertraeglich(.zuNeu, serverVersion: nil)] {
            let schritt = step(.status(elw, status), .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false))
            XCTAssertEqual(schritt.seite, .status(elw, status))
            XCTAssertEqual(schritt.effects, [.check(elw)])
        }
        XCTAssertEqual(step(.onboarding, .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false)).effects, [])
        XCTAssertEqual(step(.pruefung(elw), .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false)).effects, [])
    }

    // MARK: Zur Oberfläche (fremde Seite im Hauptframe)

    /// Die Linkregel lässt fremde Seiten im Hauptframe zu (Identitätsanbieter); ohne Weg zurück
    /// wäre eine fremde Seite ohne Rücklink eine Sackgasse.
    func testZurOberflaecheLaedtDieStartadresseDesAktivenServersNeu() {
        let schritt = step(.web(elw, vertrag: 2), .zurOberflaeche)
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.hideZurOberflaeche, .load(elw)])
    }

    func testZurOberflaecheAufEinerStatusSeitePrueftErneut() {
        for status: Statusseite in [.zertifikat, .nichtErreichbar, .nichtVertraeglich(.zuAlt, serverVersion: nil)] {
            let schritt = step(.status(elw, status), .zurOberflaeche)
            XCTAssertEqual(schritt.seite, .pruefung(elw))
            XCTAssertEqual(schritt.effects, [.check(elw)])
        }
    }

    func testZurOberflaecheOhneServerOderWaehrendDerPruefungTutNichts() {
        for seite: Ablauf.Seite in [.onboarding, .pruefung(elw)] {
            let schritt = step(seite, .zurOberflaeche)
            XCTAssertEqual(schritt.seite, seite)
            XCTAssertEqual(schritt.effects, [], "\(seite)")
        }
    }

    func testDieServerlisteBietetZurOberflaecheNurMitServerseite() {
        XCTAssertTrue(Ablauf.bietetZurOberflaeche(.web(elw, vertrag: 2)))
        XCTAssertTrue(Ablauf.bietetZurOberflaeche(.status(elw, .nichtErreichbar)))
        XCTAssertFalse(Ablauf.bietetZurOberflaeche(.pruefung(elw)))
        XCTAssertFalse(Ablauf.bietetZurOberflaeche(.onboarding))
    }

    /// Kein Zwang: die fremde Seite bleibt stehen, aber der Weg zurück wird angeboten.
    func testRueckkehrAufEinerFremdenSeiteBietetDenWegZurueck() {
        let schritt = step(
            .web(elw, vertrag: 2), .vordergrund(seiteAntwortet: true, adresse: idp, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.check(elw), .showZurOberflaeche])
    }

    /// Während „Im Browser anmelden“ läuft, gehört der Umweg zur Anmeldung.
    func testRueckkehrWaehrendEinerAnmeldungBietetNichtsAn() {
        let schritt = step(
            .web(elw, vertrag: 2), .vordergrund(seiteAntwortet: true, adresse: idp, anmeldungLaeuft: true))
        XCTAssertEqual(schritt.effects, [.check(elw)])
    }

    func testRueckkehrAufDerSeiteDesServersBietetNichtsAn() {
        for adresse in [eigen, URL(string: "https://ELW.local:8443/login"), nil] {
            let schritt = step(
                .web(elw, vertrag: 2), .vordergrund(seiteAntwortet: true, adresse: adresse, anmeldungLaeuft: false))
            XCTAssertEqual(schritt.effects, [.check(elw)], "\(String(describing: adresse))")
        }
        // Eine andere Origin desselben Hosts ist fremd.
        let anderePort = step(
            .web(elw, vertrag: 2),
            .vordergrund(seiteAntwortet: true, adresse: URL(string: "https://elw.local/"), anmeldungLaeuft: false))
        XCTAssertEqual(anderePort.effects, [.check(elw), .showZurOberflaeche])
    }

    func testDieSeiteDesServersNimmtDenHinweisZurueck() {
        let zurueck = step(.web(elw, vertrag: 2), .seiteGeladen(url: eigen))
        XCTAssertEqual(zurueck.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(zurueck.effects, [.hideZurOberflaeche])
        XCTAssertEqual(step(.web(elw, vertrag: 2), .seiteGeladen(url: idp)).effects, [])
        XCTAssertEqual(step(.web(elw, vertrag: 2), .seiteGeladen(url: nil)).effects, [])
        XCTAssertEqual(step(.pruefung(elw), .seiteGeladen(url: eigen)).effects, [])
    }

    /// Vor einem Ladefehler kann WebKit eine leere Seite übernehmen; sie ändert nichts, der Fehler
    /// danach führt wie sonst zur Seite „nicht erreichbar“.
    func testEineLeereSeiteVorDemLadefehlerBleibtOhneWirkung() {
        let leer = step(.web(elw, vertrag: 2), .seiteGeladen(url: URL(string: "about:blank")))
        XCTAssertEqual(leer.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(leer.effects, [])
        let danach = step(leer.seite, .navigationFehlgeschlagen(.cannotConnectToHost, url: eigen))
        XCTAssertEqual(danach.seite, .status(elw, .nichtErreichbar))
    }

    // MARK: Webview

    func testNachDemEndeDesWebProzessesLaedtDieAppNeu() {
        let schritt = step(.web(elw, vertrag: 2), .webProzessBeendet)
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(schritt.effects, [.reload])
        XCTAssertEqual(step(.status(elw, .zertifikat), .webProzessBeendet).effects, [])
    }

    func testEinNavigationsfehlerDesServersZeigtSeineFehlerklasse() {
        let url = URL(string: "https://elw.local:8443/einsatz/3")
        let zert = step(.web(elw, vertrag: 2), .navigationFehlgeschlagen(.serverCertificateUntrusted, url: url))
        XCTAssertEqual(zert.seite, .status(elw, .zertifikat))
        XCTAssertEqual(zert.effects, [])
        let weg = step(.web(elw, vertrag: 2), .navigationFehlgeschlagen(.cannotConnectToHost, url: nil))
        XCTAssertEqual(weg.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(weg.effects, [.scheduleRetry])
    }

    func testEinAbgebrochenerOderFremderLadevorgangBleibtOhneWirkung() {
        let eigen = URL(string: "https://elw.local:8443/")
        let a = step(.web(elw, vertrag: 2), .navigationFehlgeschlagen(.cancelled, url: eigen))
        XCTAssertEqual(a.seite, .web(elw, vertrag: 2))
        // Der Identitätsanbieter ist nicht der Server; die Seite des Webviews meldet den Fehler.
        let b = step(
            .web(elw, vertrag: 2),
            .navigationFehlgeschlagen(.cannotFindHost, url: URL(string: "https://idp.example/login")))
        XCTAssertEqual(b.seite, .web(elw, vertrag: 2))
        XCTAssertEqual(b.effects, [])
    }

    // MARK: Status-Seite aus dem Ergebnis

    func testStatusseiteAusDemErgebnis() {
        XCTAssertNil(Statusseite(.vertraeglich(info), healthVersion: nil))
        XCTAssertEqual(Statusseite(.nichtErreichbar(.zertifikat), healthVersion: nil), .zertifikat)
        XCTAssertEqual(Statusseite(.nichtErreichbar(.nichtErreichbar), healthVersion: nil), .nichtErreichbar)
        XCTAssertEqual(
            Statusseite(.nichtVertraeglich(.zuAlt, server: nil), healthVersion: nil),
            .nichtVertraeglich(.zuAlt, serverVersion: nil))
        // Die Version des Vertrags geht vor der aus /api/health.
        XCTAssertEqual(
            Statusseite(.nichtVertraeglich(.zuAlt, server: ShellInfo(version: "0.9", shellContract: 1)), healthVersion: "x"),
            .nichtVertraeglich(.zuAlt, serverVersion: "0.9"))
    }

    func testDasIntervallDerWiederholungIstKurz() {
        XCTAssertEqual(Ablauf.wiederholIntervall, .seconds(5))
    }
}
