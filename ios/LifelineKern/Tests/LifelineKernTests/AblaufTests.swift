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
    let info = ShellInfo(version: "1.0.0-alpha.320", shellContract: 1)
    let eigen = URL(string: "https://elw.local:8443/einsatz/3")
    let idp = URL(string: "https://idp.example/realms/drk/login")

    override func setUp() {
        elw = liste.add(try! ServerAdresse.parse("https://elw.local:8443"))
        lager = liste.add(try! ServerAdresse.parse("https://lager.example"))
    }

    func step(_ seite: Ablauf.Seite, _ event: Ablauf.Event, vorrat: String? = nil) -> Ablauf.Step {
        Ablauf.next(seite, event, vorrat: vorrat)
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
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 1), .load(elw), .vorwaermen(elw, info)])
    }

    func testBeimWechselPrueftDieAppDenNeuenServer() {
        for vorher: Ablauf.Seite in [.web(elw, vertrag: 1), .status(elw, .nichtErreichbar), .pruefung(elw)] {
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
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 1), .load(elw), .vorwaermen(elw, info)])
    }

    // MARK: Status-Seiten

    func testEinUnbekannterVertragZeigtDieRichtungUndLaedtNicht() {
        let neu = ShellInfo(version: "2.0.0", shellContract: 2)
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
        XCTAssertEqual(d.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(d.effects, [.markVerbunden(elw.id, vertrag: 1), .load(elw), .vorwaermen(elw, info)])
    }

    func testWiederholenGiltNurAufDerSeiteNichtErreichbar() {
        for seite: Ablauf.Seite in [
            .onboarding, .pruefung(elw), .web(elw, vertrag: 1), .status(elw, .zertifikat),
            .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: nil)),
        ] {
            let schritt = step(seite, .wiederholen)
            XCTAssertEqual(schritt.seite, seite)
            XCTAssertEqual(schritt.effects, [], "\(seite)")
        }
    }

    // MARK: Vordergrund

    func testRueckkehrMitLebenderSeitePrueftOhneNeuzuladen() {
        let schritt = step(.web(elw, vertrag: 1), .vordergrund(seiteAntwortet: true, adresse: eigen, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.check(elw)])
        let ok = step(schritt.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(ok.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(ok.effects, [.markVerbunden(elw.id, vertrag: 1), .vorwaermen(elw, info)])
    }

    func testRueckkehrOhneNetzLaesstDieGeladeneSeiteStehen() {
        // Die Oberfläche arbeitet ohne Netz weiter (Schreib-Queue); eine Status-Seite verdrängte sie.
        let schritt = step(
            .web(elw, vertrag: 1), .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [])
    }

    /// Ohne Vertrauen ins Zertifikat arbeitet die Oberfläche nicht weiter; die Anleitung zum
    /// CA-Profil geht vor, auch wenn sie schon geladen war.
    func testRueckkehrMitZertifikatsfehlerZeigtDieAnleitungAuchBeiGeladenerSeite() {
        let schritt = step(
            .web(elw, vertrag: 1), .ergebnis(.nichtErreichbar(.zertifikat), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .zertifikat))
        XCTAssertEqual(schritt.effects, [])
    }

    func testRueckkehrZuEinemGehobenenServerZeigtAppAktualisieren() {
        let neu = ShellInfo(version: "2.0.0", shellContract: 2)
        let schritt = step(
            .web(elw, vertrag: 1), .ergebnis(.nichtVertraeglich(.zuNeu, server: neu), healthVersion: nil, fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: "2.0.0")))
    }

    func testRueckkehrMitToterSeitePrueftUndLaedtNeu() {
        let schritt = step(.web(elw, vertrag: 1), .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false))
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
        let schritt = step(.web(elw, vertrag: 1), .zurOberflaeche)
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
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
        XCTAssertTrue(Ablauf.bietetZurOberflaeche(.web(elw, vertrag: 1)))
        XCTAssertTrue(Ablauf.bietetZurOberflaeche(.status(elw, .nichtErreichbar)))
        XCTAssertFalse(Ablauf.bietetZurOberflaeche(.pruefung(elw)))
        XCTAssertFalse(Ablauf.bietetZurOberflaeche(.onboarding))
    }

    /// Kein Zwang: die fremde Seite bleibt stehen, aber der Weg zurück wird angeboten.
    func testRueckkehrAufEinerFremdenSeiteBietetDenWegZurueck() {
        let schritt = step(
            .web(elw, vertrag: 1), .vordergrund(seiteAntwortet: true, adresse: idp, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.check(elw), .showZurOberflaeche])
    }

    /// Während „Im Browser anmelden“ läuft, gehört der Umweg zur Anmeldung.
    func testRueckkehrWaehrendEinerAnmeldungBietetNichtsAn() {
        let schritt = step(
            .web(elw, vertrag: 1), .vordergrund(seiteAntwortet: true, adresse: idp, anmeldungLaeuft: true))
        XCTAssertEqual(schritt.effects, [.check(elw)])
    }

    func testRueckkehrAufDerSeiteDesServersBietetNichtsAn() {
        for adresse in [eigen, URL(string: "https://ELW.local:8443/login"), nil] {
            let schritt = step(
                .web(elw, vertrag: 1), .vordergrund(seiteAntwortet: true, adresse: adresse, anmeldungLaeuft: false))
            XCTAssertEqual(schritt.effects, [.check(elw)], "\(String(describing: adresse))")
        }
        // Eine andere Origin desselben Hosts ist fremd.
        let anderePort = step(
            .web(elw, vertrag: 1),
            .vordergrund(seiteAntwortet: true, adresse: URL(string: "https://elw.local/"), anmeldungLaeuft: false))
        XCTAssertEqual(anderePort.effects, [.check(elw), .showZurOberflaeche])
    }

    func testDieSeiteDesServersNimmtDenHinweisZurueck() {
        let zurueck = step(.web(elw, vertrag: 1), .seiteGeladen(url: eigen))
        XCTAssertEqual(zurueck.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(zurueck.effects, [.hideZurOberflaeche, .check(elw)])
        XCTAssertEqual(step(.web(elw, vertrag: 1), .seiteGeladen(url: idp)).effects, [])
        XCTAssertEqual(step(.web(elw, vertrag: 1), .seiteGeladen(url: nil)).effects, [])
        XCTAssertEqual(step(.pruefung(elw), .seiteGeladen(url: eigen)).effects, [])
    }

    /// Vor einem Ladefehler kann WebKit eine leere Seite übernehmen; sie ändert nichts, der Fehler
    /// danach führt wie sonst zur Seite „nicht erreichbar“.
    func testEineLeereSeiteVorDemLadefehlerBleibtOhneWirkung() {
        let leer = step(.web(elw, vertrag: 1), .seiteGeladen(url: URL(string: "about:blank")))
        XCTAssertEqual(leer.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(leer.effects, [])
        let danach = step(leer.seite, .navigationFehlgeschlagen(.cannotConnectToHost, url: eigen))
        XCTAssertEqual(danach.seite, .status(elw, .nichtErreichbar))
    }

    // MARK: Webview

    func testNachDemEndeDesWebProzessesLaedtDieAppNeu() {
        let schritt = step(.web(elw, vertrag: 1), .webProzessBeendet)
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.reload])
        XCTAssertEqual(step(.status(elw, .zertifikat), .webProzessBeendet).effects, [])
    }

    func testEinNavigationsfehlerDesServersZeigtSeineFehlerklasse() {
        let url = URL(string: "https://elw.local:8443/einsatz/3")
        let zert = step(.web(elw, vertrag: 1), .navigationFehlgeschlagen(.serverCertificateUntrusted, url: url))
        XCTAssertEqual(zert.seite, .status(elw, .zertifikat))
        XCTAssertEqual(zert.effects, [])
        let weg = step(.web(elw, vertrag: 1), .navigationFehlgeschlagen(.cannotConnectToHost, url: nil))
        XCTAssertEqual(weg.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(weg.effects, [.scheduleRetry])
    }

    func testEinAbgebrochenerOderFremderLadevorgangBleibtOhneWirkung() {
        let eigen = URL(string: "https://elw.local:8443/")
        let a = step(.web(elw, vertrag: 1), .navigationFehlgeschlagen(.cancelled, url: eigen))
        XCTAssertEqual(a.seite, .web(elw, vertrag: 1))
        // Der Identitätsanbieter ist nicht der Server; die Seite des Webviews meldet den Fehler.
        let b = step(
            .web(elw, vertrag: 1),
            .navigationFehlgeschlagen(.cannotFindHost, url: URL(string: "https://idp.example/login")))
        XCTAssertEqual(b.seite, .web(elw, vertrag: 1))
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
            Statusseite(.nichtVertraeglich(.zuAlt, server: ShellInfo(version: "0.9", shellContract: 0)), healthVersion: "x"),
            .nichtVertraeglich(.zuAlt, serverVersion: "0.9"))
    }

    func testDasIntervallDerWiederholungIstKurz() {
        XCTAssertEqual(Ablauf.wiederholIntervall, .seconds(5))
    }

    // MARK: Tippen auf eine Meldung (LLH-2012)

    func testTippenAufAktivenServerLaedtDenPfad() {
        let schritt = step(.web(elw, vertrag: 1), .meldungAngetippt(elw, pfad: "/einsaetze/7"))
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.ladePfad(elw, "/einsaetze/7")])
    }

    func testTippenAufAnderenServerWechseltSichtbarUndLaedtDanachDenPfad() {
        let tipp = step(.web(elw, vertrag: 1), .meldungAngetippt(lager, pfad: "/einsaetze/7"))
        XCTAssertEqual(tipp.seite, .pruefung(lager, pfad: "/einsaetze/7"))
        XCTAssertEqual(tipp.effects, [.check(lager)])
        let ergebnis = step(
            tipp.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: lager.id))
        XCTAssertEqual(ergebnis.seite, .web(lager, vertrag: 1))
        XCTAssertEqual(
            ergebnis.effects,
            [.markVerbunden(lager.id, vertrag: 1), .ladePfad(lager, "/einsaetze/7"), .vorwaermen(lager, info)])
    }

    func testTippenOhnePfadOeffnetDieStartseiteDesServers() {
        let schritt = step(.web(elw, vertrag: 1), .meldungAngetippt(elw, pfad: nil))
        XCTAssertEqual(schritt.effects, [.ladePfad(elw, "/")])
    }

    func testTippenImOnboardingOderAufEinerStatusseitePrueftErstDenServer() {
        for vorher: Ablauf.Seite in [.onboarding, .status(elw, .nichtErreichbar), .pruefung(elw)] {
            let schritt = step(vorher, .meldungAngetippt(elw, pfad: "/lage"))
            XCTAssertEqual(schritt.seite, .pruefung(elw, pfad: "/lage"))
            XCTAssertEqual(schritt.effects, [.check(elw)])
        }
    }

    func testUnbekannteKennungAendertNichts() {
        for vorher: Ablauf.Seite in [.onboarding, .web(elw, vertrag: 1), .pruefung(lager)] {
            let schritt = step(vorher, .meldungAngetippt(nil, pfad: "/einsaetze/7"))
            XCTAssertEqual(schritt.seite, vorher)
            XCTAssertEqual(schritt.effects, [])
        }
    }

    func testFremderPfadOeffnetDieStartseite() throws {
        let faelle = try GemeinsameFaelle.load("deeplink.json", as: LinkregelnTests.PushPfadDatei.self)
            .push_pfad
        for fall in faelle {
            let aktiv = step(.web(elw, vertrag: 1), .meldungAngetippt(elw, pfad: fall.pfad))
            XCTAssertEqual(aktiv.effects, [.ladePfad(elw, fall.erwartet)], fall.beschreibung)
            let anderer = step(.web(elw, vertrag: 1), .meldungAngetippt(lager, pfad: fall.pfad))
            XCTAssertEqual(
                anderer.seite, .pruefung(lager, pfad: fall.erwartet), fall.beschreibung)
        }
    }

    func testEinFehlschlagenderServerVerwirftDenGemerktenPfad() {
        let schritt = step(
            .pruefung(lager, pfad: "/lage"),
            .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: lager.id))
        XCTAssertEqual(schritt.seite, .status(lager, .nichtErreichbar))
        XCTAssertEqual(step(schritt.seite, .zurOberflaeche).seite, .pruefung(lager))
    }

    func testEinWechselVerwirftDenGemerktenPfad() {
        let schritt = step(.pruefung(lager, pfad: "/lage"), .wechseln(elw))
        XCTAssertEqual(schritt.seite, .pruefung(elw))
    }

    // MARK: Tippen auf eine Meldung ohne Server (LLH-2012 mit LLH-1980)

    /// Die gespeicherte Oberfläche hat keinen Server, der den Pfad liefern könnte; die Meldung kam
    /// eben über ihn. Wie auf jeder Seite ohne Server-Oberfläche: erst prüfen, den Pfad merken.
    func testTippenAufDerGespeichertenOberflaechePrueftErstDenServer() {
        let seite = Ablauf.Seite.ohneServer(elw, version: info.version)
        let tipp = step(seite, .meldungAngetippt(elw, pfad: "/lage"), vorrat: info.version)
        XCTAssertEqual(tipp.seite, .pruefung(elw, pfad: "/lage"))
        XCTAssertEqual(tipp.effects, [.check(elw)])
    }

    /// Auch bei gleicher Version lädt die App den Pfad: der Tipp will eine andere Seite, das
    /// Weiterarbeiten ohne Neuladen gilt nur für die Rückkehr des Servers ohne Tipp.
    func testNachDemTippAufDerGespeichertenOberflaecheLaedtDieAppDenPfad() {
        let tipp = step(.ohneServer(elw, version: info.version), .meldungAngetippt(elw, pfad: "/lage"))
        let ergebnis = step(
            tipp.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id), vorrat: info.version)
        XCTAssertEqual(ergebnis.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(
            ergebnis.effects, [.markVerbunden(elw.id, vertrag: 1), .ladePfad(elw, "/lage"), .vorwaermen(elw, info)])
    }

    func testTippAufAnderenServerVonDerGespeichertenOberflaecheWechseltSichtbar() {
        let tipp = step(.ohneServer(elw, version: "1.0"), .meldungAngetippt(lager, pfad: "/einsaetze/7"))
        XCTAssertEqual(tipp.seite, .pruefung(lager, pfad: "/einsaetze/7"))
        XCTAssertEqual(tipp.effects, [.check(lager)])
    }

    func testUnbekannteKennungLaesstDieGespeicherteOberflaecheStehen() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let schritt = step(seite, .meldungAngetippt(nil, pfad: "/lage"), vorrat: "1.0")
        XCTAssertEqual(schritt.seite, seite)
        XCTAssertEqual(schritt.effects, [])
    }

    /// Antwortet der Server nach dem Tipp nicht, startet die gespeicherte Oberfläche ohne den
    /// Pfad, wie die Status-Seite ihn verwirft.
    func testOhneServerNachDemTippStartetDieGespeicherteOberflaecheOhnePfad() {
        let schritt = step(.pruefung(elw, pfad: "/lage"), nichtErreichbar(elw), vorrat: "1.0")
        XCTAssertEqual(schritt.seite, .ohneServer(elw, version: "1.0"))
        XCTAssertEqual(schritt.effects, [.loadVorrat(elw), .scheduleRetry])
        let zurueck = step(
            schritt.seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id), vorrat: "1.0")
        XCTAssertFalse(zurueck.effects.contains { if case .ladePfad = $0 { true } else { false } })
    }

    /// Ein verspätetes „nicht hochgefahren“ der verlassenen gespeicherten Oberfläche nimmt der
    /// Prüfung den Pfad nicht.
    func testGescheiterterVorratNachDemTippBehaeltDenPfad() {
        let seite = Ablauf.Seite.pruefung(elw, pfad: "/lage")
        let schritt = step(seite, .vorratGescheitert(fuer: elw.id), vorrat: "1.0")
        XCTAssertEqual(schritt.seite, seite)
        XCTAssertEqual(schritt.effects, [])
    }

    // MARK: Start ohne Server (LLH-1980)

    func nichtErreichbar(_ e: ServerEintrag) -> Ablauf.Event {
        .ergebnis(.nichtErreichbar(.nichtErreichbar), healthVersion: nil, fuer: e.id)
    }

    func testOhneServerMitVorratStartetDieGespeicherteOberflaeche() {
        let schritt = step(.pruefung(elw), nichtErreichbar(elw), vorrat: "1.0")
        XCTAssertEqual(schritt.seite, .ohneServer(elw, version: "1.0"))
        XCTAssertEqual(schritt.effects, [.loadVorrat(elw), .scheduleRetry])
    }

    func testOhneVorratBleibtEsBeiNichtErreichbar() {
        let schritt = step(.pruefung(elw), nichtErreichbar(elw), vorrat: nil)
        XCTAssertEqual(schritt.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(schritt.effects, [.scheduleRetry])
    }

    /// Ein Zertifikat, dem das Gerät nicht traut, kann auch ein Angreifer im Netz sein.
    func testZertifikatsfehlerStartetNieOhneServer() {
        let schritt = step(
            .pruefung(elw), .ergebnis(.nichtErreichbar(.zertifikat), healthVersion: nil, fuer: elw.id),
            vorrat: "1.0")
        XCTAssertEqual(schritt.seite, .status(elw, .zertifikat))
    }

    func testNichtVertraeglichStartetNieOhneServer() {
        let schritt = step(
            .pruefung(elw), .ergebnis(.nichtVertraeglich(.zuAlt, server: nil), healthVersion: nil, fuer: elw.id),
            vorrat: "1.0")
        XCTAssertEqual(schritt.seite, .status(elw, .nichtVertraeglich(.zuAlt, serverVersion: nil)))
    }

    func testAusNichtErreichbarGehtEsZurGespeichertenOberflaeche() {
        let schritt = step(.status(elw, .nichtErreichbar), nichtErreichbar(elw), vorrat: "1.0")
        XCTAssertEqual(schritt.seite, .ohneServer(elw, version: "1.0"))
        XCTAssertEqual(schritt.effects, [.loadVorrat(elw), .scheduleRetry])
    }

    func testOhneServerPrueftWeiter() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        XCTAssertEqual(step(seite, .wiederholen).effects, [.check(elw)])
        let vordergrund = step(seite, .vordergrund(seiteAntwortet: true, adresse: eigen, anmeldungLaeuft: false))
        XCTAssertEqual(vordergrund.seite, seite)
        XCTAssertEqual(vordergrund.effects, [.check(elw)])
        let weiter = step(seite, nichtErreichbar(elw), vorrat: "1.0")
        XCTAssertEqual(weiter.seite, seite)
        XCTAssertEqual(weiter.effects, [.scheduleRetry])
    }

    /// Entscheidung Ruben (22.11.2026): offene Eingaben gehen bei gleicher Version nicht verloren.
    func testServerZurueckMitGleicherVersionLaedtNichtNeu() {
        let schritt = step(
            .ohneServer(elw, version: info.version), .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id),
            vorrat: info.version)
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 1), .vorwaermen(elw, info)])
    }

    func testServerZurueckMitAndererVersionLaedtVomServer() {
        let schritt = step(
            .ohneServer(elw, version: "0.9"), .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: elw.id),
            vorrat: "0.9")
        XCTAssertEqual(schritt.seite, .web(elw, vertrag: 1))
        XCTAssertEqual(schritt.effects, [.markVerbunden(elw.id, vertrag: 1), .load(elw), .vorwaermen(elw, info)])
    }

    func testOhneServerZertifikatOderUnvertraeglichZeigtDieStatusSeite() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let zert = step(seite, .ergebnis(.nichtErreichbar(.zertifikat), healthVersion: nil, fuer: elw.id), vorrat: "1.0")
        XCTAssertEqual(zert.seite, .status(elw, .zertifikat))
        let alt = step(
            seite, .ergebnis(.nichtVertraeglich(.zuNeu, server: nil), healthVersion: nil, fuer: elw.id), vorrat: "1.0")
        XCTAssertEqual(alt.seite, .status(elw, .nichtVertraeglich(.zuNeu, serverVersion: nil)))
    }

    /// `reload()` ginge ans Netz; ohne Server lädt die App die gespeicherte Oberfläche erneut.
    func testWebProzessEndeOhneServerLaedtDieGespeicherteOberflaeche() {
        let schritt = step(.ohneServer(elw, version: "1.0"), .webProzessBeendet)
        XCTAssertEqual(schritt.seite, .ohneServer(elw, version: "1.0"))
        XCTAssertEqual(schritt.effects, [.loadVorrat(elw)])
    }

    func testGescheiterteNavigationOhneServerLaedtDieGespeicherteOberflaeche() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let eigene = step(seite, .navigationFehlgeschlagen(.notConnectedToInternet, url: eigen))
        XCTAssertEqual(eigene.seite, seite)
        XCTAssertEqual(eigene.effects, [.loadVorrat(elw)])
        XCTAssertEqual(step(seite, .navigationFehlgeschlagen(.cannotFindHost, url: idp)).effects, [])
        XCTAssertEqual(step(seite, .navigationFehlgeschlagen(.cancelled, url: eigen)).effects, [])
    }

    func testGescheiterterStartFaelltAufNichtErreichbar() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let schritt = step(seite, .vorratGescheitert(fuer: elw.id))
        XCTAssertEqual(schritt.seite, .status(elw, .nichtErreichbar))
        XCTAssertEqual(schritt.effects, [.scheduleRetry])
        let fremd = step(seite, .vorratGescheitert(fuer: lager.id))
        XCTAssertEqual(fremd.seite, seite)
        XCTAssertEqual(fremd.effects, [])
    }

    func testZurOberflaecheOhneServerLaedtDieGespeicherteOberflaeche() {
        let schritt = step(.ohneServer(elw, version: "1.0"), .zurOberflaeche)
        XCTAssertEqual(schritt.seite, .ohneServer(elw, version: "1.0"))
        XCTAssertEqual(schritt.effects, [.hideZurOberflaeche, .loadVorrat(elw)])
        XCTAssertTrue(Ablauf.bietetZurOberflaeche(.ohneServer(elw, version: "1.0")))
    }

    func testDieSeiteDesServersNimmtDenHinweisOhneServerZurueck() {
        let schritt = step(.ohneServer(elw, version: "1.0"), .seiteGeladen(url: eigen))
        XCTAssertEqual(schritt.effects, [.hideZurOberflaeche])
    }

    func testErgebnisEinesAnderenServersAendertOhneServerNicht() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let schritt = step(seite, .ergebnis(.vertraeglich(info), healthVersion: nil, fuer: lager.id))
        XCTAssertEqual(schritt.seite, seite)
        XCTAssertEqual(schritt.effects, [])
    }

    func testZeigtWebviewUndWiederholt() {
        let faelle: [(Ablauf.Seite, zeigtWebview: Bool, wiederholt: Bool)] = [
            (.onboarding, false, false),
            (.pruefung(elw), false, false),
            (.web(elw, vertrag: 1), true, false),
            (.ohneServer(elw, version: "1.0"), true, true),
            (.status(elw, .nichtErreichbar), false, true),
            (.status(elw, .zertifikat), false, false),
            (.status(elw, .nichtVertraeglich(.zuAlt, serverVersion: nil)), false, false),
        ]
        for (seite, webview, wiederholt) in faelle {
            XCTAssertEqual(seite.zeigtWebview, webview, "\(seite)")
            XCTAssertEqual(seite.wiederholt, wiederholt, "\(seite)")
        }
    }

    // MARK: Nach dem Review (LLH-1980)

    /// Eine neu geladene Seite des Servers (Neu laden nach einem Update) kann eine neue Version
    /// sein, die die Datenbanken des Frontends hebt: die App prüft und rechnet das Vorwärmen neu.
    func testEineNeuGeladeneSeiteDesServersPrueftDenVertrag() {
        let schritt = step(.web(elw, vertrag: 1), .seiteGeladen(url: eigen))
        XCTAssertTrue(schritt.effects.contains(.check(elw)), "\(schritt.effects)")
        XCTAssertEqual(step(.web(elw, vertrag: 1), .seiteGeladen(url: idp)).effects, [])
    }

    /// Ohne Server lädt die App eine tote oder hängende Seite bei der Rückkehr neu.
    func testRueckkehrOhneServerMitToterSeiteLaedtDieGespeicherteOberflaeche() {
        let seite = Ablauf.Seite.ohneServer(elw, version: "1.0")
        let schritt = step(seite, .vordergrund(seiteAntwortet: false, adresse: nil, anmeldungLaeuft: false))
        XCTAssertEqual(schritt.seite, seite)
        XCTAssertEqual(schritt.effects, [.check(elw), .loadVorrat(elw)])
    }
}
