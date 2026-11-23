import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// Webview-Host im Simulator (tasks.md 8.4, 8.6, 8.7, 8.13): Datenspeicher je Server, Init-Skript,
/// Brücke nur für Hauptframe und aktiven Server, Dialoge der Seite, Ladefehler als Fehlerklasse.
@MainActor
final class WebviewTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443")
    let lager = try! ServerAdresse.parse("https://lager.example")
    let elwOrigin = SeitenOrigin(schema: "https", host: "elw.local", port: 8443)

    func eintrag(_ adresse: ServerAdresse) -> ServerEintrag {
        var liste = Serverliste()
        return liste.add(adresse)
    }

    func testJederServerBekommtSeinenEigenenDatenspeicher() {
        let a = eintrag(elw)
        let b = eintrag(lager)
        let empfang = Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil })
        let webA = Webviewfabrik.make(fuer: a, skript: "", empfang: empfang, navigation: nil)
        let webB = Webviewfabrik.make(fuer: b, skript: "", empfang: empfang, navigation: nil)
        XCTAssertEqual(webA.configuration.websiteDataStore.identifier, a.id)
        XCTAssertEqual(webB.configuration.websiteDataStore.identifier, b.id)
        XCTAssertTrue(webA.configuration.websiteDataStore.isPersistent)
    }

    func testDasInitSkriptLaeuftVorDerSeiteUndNurImHauptframe() throws {
        let version = try XCTUnwrap(AppVersion(info: Bundle.main.infoDictionary ?? [:]))
        let skript = Webviewfabrik.initskript(version: version.fullVersion)
        XCTAssertTrue(skript.contains("const rohVersion = '\(version.fullVersion)';"))
        let web = Webviewfabrik.make(
            fuer: eintrag(elw), skript: skript,
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }), navigation: nil)
        let skripte = web.configuration.userContentController.userScripts
        XCTAssertEqual(
            skripte.map(\.source), [skript, Huellenstil.skript, Webviewfabrik.unterframeSkript()])
        XCTAssertTrue(skripte.allSatisfy { $0.injectionTime == .atDocumentStart })
        // Nur die Sperre des Standorts läuft auch in Unterframes (LLH-2071).
        XCTAssertEqual(skripte.map(\.isForMainFrameOnly), [true, true, false])
    }

    /// tasks.md 8.10: kein Nachfedern, kein Pull-to-Refresh, keine Linkvorschau, Ränder nur über
    /// die Safe Area der Ansicht.
    func testDerWebviewFuehltSichNativAn() throws {
        let web = Webviewfabrik.make(
            fuer: eintrag(elw), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }), navigation: nil)
        XCTAssertFalse(web.scrollView.bounces)
        XCTAssertFalse(web.scrollView.alwaysBounceVertical)
        XCTAssertNil(web.scrollView.refreshControl)
        XCTAssertEqual(web.scrollView.contentInsetAdjustmentBehavior, .never)
        XCTAssertFalse(web.allowsLinkPreview)
        XCTAssertFalse(web.isOpaque)
        // WebKit gibt die Farbe als eigenes Objekt zurück: gleich ist sie in ihren Anteilen.
        let kopfschwarz = try XCTUnwrap(UIColor(named: "Kopfschwarz"))
        XCTAssertEqual(anteile(web.underPageBackgroundColor), anteile(kopfschwarz))
    }

    /// RGBA im erweiterten sRGB, auf drei Stellen gerundet.
    private func anteile(_ farbe: UIColor?) -> [Double] {
        guard let farbe else { return [] }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard farbe.getRed(&r, green: &g, blue: &b, alpha: &a) else { return [] }
        return [r, g, b, a].map { (Double($0) * 1000).rounded() / 1000 }
    }

    func testDerStilDerHuelleSperrtDieAuswahlNurAusserhalbVonEingaben() async throws {
        let (web, _, _) = try await lade(basis: elw.url, aktiv: elw, html: """
            <p id="text">Text</p><input id="eingabe" value="x">
            """)
        let stil = { (id: String) async throws -> String? in
            try await web.evaluateJavaScript(
                "getComputedStyle(document.getElementById('\(id)')).webkitUserSelect") as? String
        }
        let text = try await stil("text")
        let eingabe = try await stil("eingabe")
        XCTAssertEqual(text, "none")
        XCTAssertEqual(eingabe, "text")
    }

    // MARK: Brücke im echten Webview

    func testDieSeiteDesAktivenServersErreichtDieBrueckeUndBekommtAntwort() async throws {
        let (web, dienste, _) = try await lade(basis: elw.url, aktiv: elw, html: """
            <script>
            window.__LIFELINE_HUELLE__.setAppBadge(2).then(
              () => { document.title = 'erfuellt'; },
              (e) => { document.title = 'abgelehnt'; });
            </script>
            """)
        await warte { dienste.badges == [2] }
        XCTAssertEqual(dienste.badges, [2])
        await warte { await self.titel(web) == "erfuellt" }
        let titel = await titel(web)
        XCTAssertEqual(titel, "erfuellt")
        let plattform = try await web.evaluateJavaScript("window.__LIFELINE_HUELLE__.platform")
        XCTAssertEqual(plattform as? String, "ios")
    }

    func testEineFremdeOriginErreichtDieBrueckeNicht() async throws {
        let (_, dienste, _) = try await lade(basis: URL(string: "https://idp.example/")!, aktiv: elw, html: """
            <script>window.__LIFELINE_HUELLE__.setAppBadge(2);</script>
            """)
        try await Task.sleep(for: .seconds(1))
        XCTAssertEqual(dienste.badges, [])
    }

    func testEinUnterframeErreichtDieBrueckeNicht() async throws {
        let (_, dienste, _) = try await lade(basis: elw.url, aktiv: elw, html: """
            <iframe srcdoc="<script>window.webkit.messageHandlers.lifeline.postMessage({cmd: 'set_app_badge', id: 1, count: 4});</script>"></iframe>
            """)
        try await Task.sleep(for: .seconds(1))
        XCTAssertEqual(dienste.badges, [])
    }

    /// Standort über die Brücke (LLH-2071): die Seite des aktiven Servers fragt die Hülle, eine
    /// Verweigerung kommt als Code 1 der Web-API an.
    func testDerStandortGehtUeberDieBrueckeUndEineVerweigerungIstCode1() async throws {
        let (web, _, _) = try await lade(basis: elw.url, aktiv: elw, html: """
            <script>
            navigator.geolocation.getCurrentPosition(
              () => { document.title = 'position'; },
              (e) => { document.title = 'fehler ' + e.code; },
              { timeout: 5000 });
            </script>
            """)
        await warte { await self.titel(web) == "fehler 1" }
        let titel = await titel(web)
        XCTAssertEqual(titel, "fehler 1")
    }

    func testEinUnterframeBekommtKeinenStandort() async throws {
        let (web, _, _) = try await lade(basis: elw.url, aktiv: elw, html: """
            <iframe srcdoc="<script>navigator.geolocation.getCurrentPosition(() => { parent.document.title = 'position'; }, (e) => { parent.document.title = 'fehler ' + e.code; });</script>"></iframe>
            """)
        await warte { await self.titel(web) == "fehler 1" }
        let titel = await titel(web)
        XCTAssertEqual(titel, "fehler 1")
    }

    func testNachEinemServerwechselGiltDieAlteSeiteNichtMehr() async throws {
        let (web, dienste, zeiger) = try await lade(basis: elw.url, aktiv: elw, html: "<p>ELW</p>")
        _ = try await web.evaluateJavaScript("window.__LIFELINE_HUELLE__.setAppBadge(1); 0")
        await warte { dienste.badges == [1] }
        zeiger.adresse = lager
        _ = try await web.evaluateJavaScript("window.__LIFELINE_HUELLE__.setAppBadge(5); 0")
        try await Task.sleep(for: .seconds(1))
        XCTAssertEqual(dienste.badges, [1])
    }

    func testHapticsUndDruckenGehenUeberDieBruecke() async throws {
        let (web, dienste, _) = try await lade(basis: elw.url, aktiv: elw, html: "<p>ETB</p>")
        _ = try await web.evaluateJavaScript(
            "window.__LIFELINE_HUELLE__.haptics('success'); window.__LIFELINE_HUELLE__.haptics('boom'); window.print(); 0")
        await warte { dienste.gespielt == [.success] && dienste.drucke == 1 }
        XCTAssertEqual(dienste.gespielt, [.success])
        XCTAssertEqual(dienste.drucke, 1)
    }

    func testDieAnmeldungImBrowserGehtUeberDieBruecke() async throws {
        let (web, dienste, _) = try await lade(basis: URL(string: "https://elw.local:8443/login")!, aktiv: elw, html: "<p>Anmelden</p>")
        _ = try await web.evaluateJavaScript(
            "window.__LIFELINE_HUELLE__.anmeldungImBrowser().then(() => { document.title = 'gestartet'; }); 0")
        await warte { await self.titel(web) == "gestartet" }
        XCTAssertEqual(dienste.anmeldungen, 1)
    }

    func testEineMeldungFragtBeimErstenMalNachDerBerechtigung() async throws {
        let (web, dienste, _) = try await lade(basis: elw.url, aktiv: elw, html: "<p>Alarm</p>")
        dienste.freigabe = .offen
        _ = try await web.evaluateJavaScript(
            "window.__LIFELINE_HUELLE__.benachrichtigungZeigen('Alarm', 'ELW 1').then(() => { document.title = 'gezeigt'; }); 0")
        await warte { await self.titel(web) == "gezeigt" }
        XCTAssertEqual(dienste.anfragen, 1)
        XCTAssertEqual(dienste.meldungen, ["Alarm"])
    }

    // MARK: Dialoge der Seite (tasks.md 8.13)

    func testConfirmFragtNativUnterDemHostDesServers() async throws {
        let (web, dialoge) = try await dialogseite(basis: elw.url)
        dialoge.wahl = .ok(text: nil)
        let ja = try await web.evaluateJavaScript("String(confirm('Tier „Rex“ löschen?'))")
        XCTAssertEqual(ja as? String, "true")
        XCTAssertEqual(
            dialoge.gezeigt,
            [Seitendialog(art: .rueckfrage, nachricht: "Tier „Rex“ löschen?", origin: elwOrigin)])
        XCTAssertEqual(dialoge.gezeigt.first?.titel, "elw.local:8443")

        dialoge.wahl = .abgebrochen
        let nein = try await web.evaluateJavaScript("String(confirm('Nochmal?'))")
        XCTAssertEqual(nein as? String, "false")
    }

    func testOhneGezeigtenDialogLehntConfirmAb() async throws {
        let (web, dialoge) = try await dialogseite(basis: elw.url)
        dialoge.wahl = nil
        let wert = try await web.evaluateJavaScript("String(confirm('Löschen?'))")
        XCTAssertEqual(wert as? String, "false")
        XCTAssertEqual(dialoge.gezeigt.count, 1)
    }

    /// WebKit fragt per `respondsToSelector:`; antwortet der Begleiter nicht, übergeht WebKit den
    /// Dialog still (`alert` wie „OK“, `confirm` und `prompt` wie „Abbrechen“).
    func testDerBegleiterBeantwortetAlleDialogeDerSeite() {
        let begleiter = Navigationsbegleiter(aktiverServer: { nil }) { _, _ in }
        for selektor in [
            "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
        ] {
            XCTAssertTrue(begleiter.responds(to: NSSelectorFromString(selektor)), selektor)
        }
    }

    func testAlertWartetAufDieAntwort() async throws {
        let (web, dialoge) = try await dialogseite(basis: elw.url)
        dialoge.wahl = .ok(text: nil)
        let wert = try await web.evaluateJavaScript("alert('Gespeichert'); 'weiter'")
        XCTAssertEqual(wert as? String, "weiter")
        XCTAssertEqual(dialoge.gezeigt.map(\.art), [.hinweis])
        XCTAssertNil(dialoge.gezeigt.first?.abbrechenTitel)
    }

    func testPromptLiefertDenTextOderNull() async throws {
        let (web, dialoge) = try await dialogseite(basis: elw.url)
        dialoge.wahl = .ok(text: "Rex")
        let text = try await web.evaluateJavaScript("JSON.stringify(prompt('Name?', 'Hund'))")
        XCTAssertEqual(text as? String, "\"Rex\"")
        XCTAssertEqual(dialoge.gezeigt.first?.art, .eingabe(vorgabe: "Hund"))
        dialoge.wahl = .abgebrochen
        let nichts = try await web.evaluateJavaScript("JSON.stringify(prompt('Name?'))")
        XCTAssertEqual(nichts as? String, "null")
    }

    /// Eine fremde Origin (etwa der Identitätsanbieter) darf fragen, aber nur unter ihrem Namen.
    func testEineFremdeOriginFragtUnterIhremEigenenHost() async throws {
        let (web, dialoge) = try await dialogseite(basis: URL(string: "https://idp.example/login")!)
        dialoge.wahl = .ok(text: nil)
        _ = try await web.evaluateJavaScript("String(confirm('Weiter?'))")
        XCTAssertEqual(dialoge.gezeigt.map(\.titel), ["idp.example"])
    }

    /// Ohne Fenster kann kein Dialog erscheinen: die Antwort kommt sofort und genau einmal.
    func testOhneFensterAntwortenDieSystemdialogeSofortMitNichts() {
        var antworten: [Seitendialog.Ergebnis?] = []
        let dialog = Seitendialog(
            art: .rueckfrage, nachricht: "Löschen?", origin: elwOrigin)
        Systemdialoge().zeige(dialog, in: WKWebView()) { antworten.append($0) }
        XCTAssertEqual(antworten.count, 1)
        XCTAssertEqual(antworten.first, .some(nil))
    }

    func testDieAntwortGehtHoechstensEinmalAnWebKit() {
        var antworten: [Seitendialog.Ergebnis?] = []
        let einmal = EinmaligeAntwort { antworten.append($0) }
        einmal.call(.abgebrochen)
        einmal.call(.ok(text: nil))
        XCTAssertEqual(antworten, [.abgebrochen])
    }

    // MARK: Ladefehler

    func testEinUnerreichbarerServerMeldetSeineFehlerklasse() async throws {
        var gemeldet: [Ablauf.Event] = []
        let begleiter = Navigationsbegleiter(aktiverServer: { nil }) { _, event in gemeldet.append(event) }
        // Ein geschlossener Port, den WebKit nicht sperrt: auf 9 (discard, Fetch-Liste „bad
        // ports“) meldet WebKit keinen Ladefehler der URL-Schicht, der Webview blieb auf
        // `about:blank` (Lauf 44419406791).
        let ziel = try ServerAdresse.parse("https://127.0.0.1:2")
        let web = Webviewfabrik.make(
            fuer: eintrag(ziel), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }),
            navigation: begleiter)
        web.load(URLRequest(url: ziel.url))
        // Vor dem Fehler kann WebKit eine leere Seite übernehmen (`seiteGeladen(about:blank)`);
        // die lässt `Ablauf` auf einer fremden Adresse ohne Wirkung.
        await warte(sekunden: 15) { gemeldet.contains(where: \.isNavigationsfehler) }
        guard let ereignis = gemeldet.first(where: \.isNavigationsfehler),
            case .navigationFehlgeschlagen(let code, _) = ereignis
        else {
            return XCTFail("kein Ladefehler gemeldet: \(gemeldet)")
        }
        XCTAssertEqual(Ablauf.next(.web(eintrag(ziel), vertrag: 1), ereignis).seite.isNichtErreichbar, true, "\(code)")
    }

    // MARK: Hilfen

    private var halter: [AnyObject] = []

    private func lade(basis: URL, aktiv: ServerAdresse, html: String) async throws
        -> (WKWebView, Attrappe, Zeiger)
    {
        let dienste = Attrappe()
        let zeiger = Zeiger(aktiv)
        let empfang = Brueckenempfang(dienste: dienste, aktiverServer: { zeiger.adresse })
        let warter = Ladewarter()
        let skript = Webviewfabrik.initskript(version: "1.0.0-alpha.1")
        let web = Webviewfabrik.make(
            fuer: eintrag(aktiv), skript: skript, empfang: empfang, navigation: warter)
        halter += [empfang, warter, web]
        web.loadHTMLString("<!doctype html><html><head><title></title></head><body>\(html)</body></html>", baseURL: basis)
        // Großzügig: im CI laufen iPhone und iPad nebeneinander, eine Seite mit Unterframe braucht
        // dort mehr als fünf Sekunden.
        await warte(sekunden: 20) { warter.fertig }
        XCTAssertTrue(warter.fertig, "Seite nicht geladen")
        return (web, dienste, zeiger)
    }

    /// Eine Seite unter `basis`, deren Dialoge der Navigationsbegleiter an die Attrappe gibt.
    private func dialogseite(basis: URL) async throws -> (WKWebView, DialogAttrappe) {
        let (web, _, _) = try await lade(basis: basis, aktiv: elw, html: "<p>Tiere</p>")
        let dialoge = DialogAttrappe()
        let server = elw
        let begleiter = Navigationsbegleiter(aktiverServer: { server }, dialoge: dialoge) { _, _ in }
        web.uiDelegate = begleiter
        halter += [begleiter, dialoge]
        return (web, dialoge)
    }

    private func titel(_ web: WKWebView) async -> String {
        (try? await web.evaluateJavaScript("document.title")) as? String ?? ""
    }

    private func warte(sekunden: Double = 5, bis bedingung: () async -> Bool) async {
        let ende = Date().addingTimeInterval(sekunden)
        while !(await bedingung()), Date() < ende {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }
}

private extension Ablauf.Event {
    var isNavigationsfehler: Bool {
        if case .navigationFehlgeschlagen = self { return true }
        return false
    }
}

private extension Ablauf.Seite {
    var isNichtErreichbar: Bool {
        if case .status(_, .nichtErreichbar) = self { return true }
        return false
    }
}

@MainActor
private final class Zeiger {
    var adresse: ServerAdresse?
    init(_ adresse: ServerAdresse?) { self.adresse = adresse }
}

/// Merkt sich jeden Dialog und antwortet, wie ein Mensch es täte, erst nach dem Aufruf.
@MainActor
private final class DialogAttrappe: Dialogzeiger {
    var gezeigt: [Seitendialog] = []
    var wahl: Seitendialog.Ergebnis?

    func zeige(
        _ dialog: Seitendialog, in webView: WKWebView,
        antwort: @escaping @MainActor (Seitendialog.Ergebnis?) -> Void
    ) {
        gezeigt.append(dialog)
        let wahl = self.wahl
        Task { @MainActor in antwort(wahl) }
    }
}

@MainActor
private final class Ladewarter: NSObject, WKNavigationDelegate {
    var fertig = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { fertig = true }
}

@MainActor
final class Attrappe: Huellendienste {
    var isHaptikEnabled = true
    var freigabe = Meldungsfreigabe.erlaubt
    var gespielt: [Haptik.Feedback] = []
    var anfragen = 0
    var meldungen: [String] = []
    var badges: [Int] = []
    var drucke = 0

    func play(_ feedback: Haptik.Feedback) { gespielt.append(feedback) }
    func loadMeldungsfreigabe() async -> Meldungsfreigabe { freigabe }
    func requestMeldungsfreigabe() async -> Bool {
        anfragen += 1
        return true
    }
    func showNotification(title: String, body: String?) async throws { meldungen.append(title) }
    func setBadge(_ count: Int) async throws { badges.append(count) }
    func print() async throws -> Bool {
        drucke += 1
        return true
    }
    var anmeldungen = 0
    func startAnmeldung() throws { anmeldungen += 1 }
    var registrierungen = 0
    var abmeldungen = 0
    func registerPush() async throws -> PushRegistrierung {
        registrierungen += 1
        return PushRegistrierung(kennung: "k", token: "t", umgebung: "sandbox", schluessel: "s")
    }
    func unregisterPush() async throws { abmeldungen += 1 }
    func pushState() async -> (Meldungsfreigabe, kennung: String?) { (freigabe, nil) }
    var standortfreigabe = Standortfreigabe.verweigert
    func loadStandortfreigabe() async -> Standortfreigabe { standortfreigabe }
    func requestStandortfreigabe() async -> Bool { false }
    func currentPosition(highAccuracy: Bool, timeout: Duration?) async throws -> Standortposition {
        throw Standortfehler.unavailable
    }
}
