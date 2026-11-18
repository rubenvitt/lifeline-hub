import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// Webview-Host im Simulator (tasks.md 8.4, 8.6, 8.7): Datenspeicher je Server, Init-Skript,
/// Brücke nur für Hauptframe und aktiven Server, Ladefehler als Fehlerklasse.
@MainActor
final class WebviewTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443")
    let lager = try! ServerAdresse.parse("https://lager.example")

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
        XCTAssertEqual(skripte.map(\.source), [skript, Huellenstil.skript])
        XCTAssertTrue(skripte.allSatisfy { $0.injectionTime == .atDocumentStart })
        XCTAssertTrue(skripte.allSatisfy(\.isForMainFrameOnly))
    }

    /// tasks.md 8.10: kein Nachfedern, kein Pull-to-Refresh, keine Linkvorschau, Ränder nur über
    /// die Safe Area der Ansicht.
    func testDerWebviewFuehltSichNativAn() {
        let web = Webviewfabrik.make(
            fuer: eintrag(elw), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }), navigation: nil)
        XCTAssertFalse(web.scrollView.bounces)
        XCTAssertFalse(web.scrollView.alwaysBounceVertical)
        XCTAssertNil(web.scrollView.refreshControl)
        XCTAssertEqual(web.scrollView.contentInsetAdjustmentBehavior, .never)
        XCTAssertFalse(web.allowsLinkPreview)
        XCTAssertFalse(web.isOpaque)
        XCTAssertEqual(web.underPageBackgroundColor, UIColor(named: "Kopfschwarz"))
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

    // MARK: Ladefehler

    func testEinUnerreichbarerServerMeldetSeineFehlerklasse() async throws {
        var gemeldet: [Ablauf.Event] = []
        let begleiter = Navigationsbegleiter(aktiverServer: { nil }) { _, event in gemeldet.append(event) }
        let ziel = try ServerAdresse.parse("https://127.0.0.1:9")
        let web = Webviewfabrik.make(
            fuer: eintrag(ziel), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }),
            navigation: begleiter)
        web.load(URLRequest(url: ziel.url))
        await warte(sekunden: 15) { !gemeldet.isEmpty }
        guard case .navigationFehlgeschlagen(let code, _)? = gemeldet.first else {
            return XCTFail("kein Ladefehler gemeldet: \(gemeldet)")
        }
        XCTAssertEqual(Ablauf.next(.web(eintrag(ziel), vertrag: 1), gemeldet[0]).seite.isNichtErreichbar, true, "\(code)")
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
        await warte { warter.fertig }
        XCTAssertTrue(warter.fertig, "Seite nicht geladen")
        return (web, dienste, zeiger)
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
}
