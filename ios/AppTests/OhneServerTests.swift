import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// Start ohne Server im Simulator (LLH-1980; Entwurf
/// `docs/superpowers/specs/2026-11-22-ny0d22bl-ios-start-ohne-server-design.md`): ein echter
/// https-Server im Testprozess, ein echter Webview mit eigenem Datenspeicher. Gemessen wird,
/// ob die vorgewärmten Assets nach dem Anhalten des Servers aus dem HTTP-Cache des Datenspeichers
/// kommen, auch ein nie geladener Chunk.
@MainActor
final class OhneServerTests: XCTestCase {
    private var server: Testserver!
    private var verzeichnis: URL!
    private var vorrat: Vorratsdienst!
    private var eintrag: ServerEintrag!
    private var halter: [AnyObject] = []

    static let immutable = "public, max-age=31536000, immutable"

    static func routen(index: String = indexHtml) -> [String: Testserver.Antwort] {
        [
            "/": .init(status: 200, contentType: "text/html; charset=utf-8", cacheControl: "no-cache", koerper: Data(index.utf8)),
            "/assets/haupt-1.js": .init(
                status: 200, contentType: "text/javascript; charset=utf-8", cacheControl: immutable,
                koerper: Data("""
                    document.getElementById('root').innerHTML = '<p id="haupt">da</p>';
                    window.__ladeSpaet = () => import('/assets/spaet-1.js');
                    """.utf8)),
            "/assets/spaet-1.js": .init(
                status: 200, contentType: "text/javascript; charset=utf-8", cacheControl: immutable,
                koerper: Data("window.__spaet = true;\nexport {};\n".utf8)),
        ]
    }

    static let indexHtml = """
        <!doctype html><html><head><script type="module" src="/assets/haupt-1.js"></script></head>
        <body><div id="root"></div></body></html>
        """

    static let assets = ["assets/haupt-1.js", "assets/spaet-1.js"]

    override func setUp() async throws {
        await WebkitVorlauf.sicherstellen()
        server = Testserver(routen: Self.routen())
        let port = try await server.start()
        var liste = Serverliste()
        eintrag = liste.add(try ServerAdresse.parse("https://\(Testserver.host):\(port)"))
        verzeichnis = FileManager.default.temporaryDirectory
            .appendingPathComponent("ohne-server-\(UUID().uuidString)")
        vorrat = Vorratsdienst(
            ablage: Vorratsablage(verzeichnis: verzeichnis),
            skript: Vorratsdienst.vorwaermskript(bundle: Bundle(for: AppModell.self)))
    }

    override func tearDown() async throws {
        server?.stop()
        halter.compactMap { $0 as? WKWebView }.forEach(Webviewfabrik.close)
        halter = []
        try? FileManager.default.removeItem(at: verzeichnis)
        if let eintrag { try? await WKWebsiteDataStore.remove(forIdentifier: eintrag.id) }
    }

    func testDieGespeicherteOberflaecheStartetOhneServerAuchMitNieGeladenemChunk() async throws {
        let online = try await ladeOnline()
        await vorrat.vorwaermen(eintrag, info: info("1.0"), in: online)
        XCTAssertEqual(vorrat.ablage.load(eintrag.id)?.version, "1.0", "nichts abgelegt")
        XCTAssertEqual(server.abrufe["/assets/spaet-1.js"], 1, "Chunk nicht vorgewärmt")

        server.stop()
        Webviewfabrik.close(online)
        let beobachter = Ladebeobachter()
        halter.append(beobachter)
        let ohne = webview(navigation: beobachter)
        XCTAssertTrue(vorrat.loadVorrat(eintrag, in: ohne))
        // Wie beim Laden vom Server: erst das Ende des Ladens, dann die Startprüfung (s. `warteAufLadeende`).
        let geladen = await warteAufLadeende(beobachter)
        XCTAssertTrue(geladen, "gespeicherte Oberfläche nicht geladen: \(beobachter.beschreibung)")
        let gestartet = await vorrat.isGestartet(ohne)
        XCTAssertTrue(gestartet, "gespeicherte Oberfläche ohne Server nicht hochgefahren")
        let spaet = try await ohne.callAsyncJavaScript(
            "await window.__ladeSpaet(); return window.__spaet === true;", contentWorld: .page)
        XCTAssertEqual(spaet as? Bool, true, "nie geladener Chunk ohne Server nicht aus dem Cache")
        XCTAssertEqual(ohne.url, eintrag.adresse.url)
    }

    func testOhneVorgewaermtenChunkStartetSieNicht() async throws {
        server.stop()
        let html = Self.indexHtml.replacingOccurrences(of: "haupt-1.js", with: "fehlt-1.js")
        try vorrat.ablage.save(
            GespeicherteOberflaeche(version: "1.0", html: html, gespeichertAm: .now), fuer: eintrag.id)
        let ohne = webview()
        XCTAssertTrue(vorrat.loadVorrat(eintrag, in: ohne))
        let gestartet = await vorrat.isGestartet(ohne)
        XCTAssertFalse(gestartet)
    }

    func testEinFehlendesAssetVerhindertDasSpeichern() async throws {
        let online = try await ladeOnline()
        await vorrat.vorwaermen(eintrag, info: info("1.0", assets: Self.assets + ["assets/fehlt-1.js"]), in: online)
        XCTAssertNil(vorrat.ablage.load(eintrag.id))
    }

    func testAndereVersionVerwirftDieAlteAblageVorDemVorwaermen() async throws {
        try vorrat.ablage.save(
            GespeicherteOberflaeche(version: "0.9", html: Self.indexHtml, gespeichertAm: .now), fuer: eintrag.id)
        let online = try await ladeOnline()
        await vorrat.vorwaermen(eintrag, info: info("1.0", assets: ["assets/fehlt-1.js"]), in: online)
        XCTAssertNil(vorrat.ablage.load(eintrag.id))
    }

    /// `holeIndex` fragt jedes Mal den Server (`/`); einmal lädt der Webview, einmal das Ablegen.
    func testGleicheVersionWaermtNichtErneutVor() async throws {
        let online = try await ladeOnline()
        await vorrat.vorwaermen(eintrag, info: info("1.0"), in: online)
        await vorrat.vorwaermen(eintrag, info: info("1.0"), in: online)
        XCTAssertEqual(server.abrufe["/"], 2)
    }

    // MARK: Nach dem Review

    /// Die alte Ablage verschwindet sofort, nicht erst nach dem Laden der neuen Version.
    func testVerwirfVeralteteLoeschtNurEineAndereVersion() throws {
        try vorrat.ablage.save(
            GespeicherteOberflaeche(version: "0.9", html: Self.indexHtml, gespeichertAm: .now), fuer: eintrag.id)
        vorrat.verwirfVeraltete(eintrag, version: "0.9")
        XCTAssertNotNil(vorrat.ablage.load(eintrag.id))
        vorrat.verwirfVeraltete(eintrag, version: "1.0")
        XCTAssertNil(vorrat.ablage.load(eintrag.id))
    }

    /// Steht der Webview beim Identitätsanbieter, holte `fetch('/assets/…')` dort.
    func testAufEinerFremdenSeiteWirdNichtVorgewaermt() async throws {
        let fremd = webview()
        fremd.loadHTMLString("<div id='root'><p>Anmeldung</p></div>", baseURL: URL(string: "https://idp.example/"))
        let geladen = await vorrat.isGestartet(fremd)
        XCTAssertTrue(geladen)
        await vorrat.vorwaermen(eintrag, info: info("1.0"), in: fremd)
        XCTAssertNil(vorrat.ablage.load(eintrag.id))
        XCTAssertNil(server.abrufe["/"])
    }

    /// Zwei Anstöße kurz nacheinander (Laden und Prüfen danach) wärmen nur einmal vor.
    func testGleichzeitigesVorwaermenLaeuftNurEinmal() async throws {
        let online = try await ladeOnline()
        // Nur Sendable-Werte in die Tasks: die Testklasse selbst ist es nicht.
        let dienst: Vorratsdienst = vorrat
        let ziel: ServerEintrag = eintrag
        let neu = info("1.0")
        let erstes = Task { @MainActor in await dienst.vorwaermen(ziel, info: neu, in: online) }
        let zweites = Task { @MainActor in await dienst.vorwaermen(ziel, info: neu, in: online) }
        await erstes.value
        await zweites.value
        XCTAssertEqual(server.abrufe["/"], 2)
        XCTAssertEqual(vorrat.ablage.load(eintrag.id)?.version, "1.0")
    }

    // MARK: Hilfen

    private func info(_ version: String, assets: [String] = OhneServerTests.assets) -> ShellInfo {
        ShellInfo(version: version, shellContract: 1, assets: assets)
    }

    private func webview(navigation: WKNavigationDelegate? = nil) -> WKWebView {
        let web = Webviewfabrik.make(
            fuer: eintrag, skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }), navigation: navigation)
        halter.append(web)
        return web
    }

    /// Lädt die Oberfläche vom Testserver und wartet, bis sie steht. Scheitert das, nennt die
    /// Meldung den Ladefehler des Webviews, was beim Server ankam und ob das System dem Zertifikat
    /// vertraut: so ist aus dem Protokoll des Laufs zu sehen, ob Verbindung, TLS oder Test-CA fehlt.
    private func ladeOnline() async throws -> WKWebView {
        let beobachter = Ladebeobachter()
        halter.append(beobachter)
        let web = webview(navigation: beobachter)
        web.load(URLRequest(url: eintrag.adresse.url))
        let geladen = await warteAufLadeende(beobachter)
        let gestartet = geladen ? await vorrat.isGestartet(web) : false
        if !gestartet {
            let vertrauen = Testserver.vertrauensfehler() ?? "vertraut"
            XCTFail(
                "Oberfläche vom Testserver nicht \(geladen ? "hochgefahren" : "geladen"). "
                    + "Webview: \(beobachter.beschreibung); \(server.bericht); Zertifikat: \(vertrauen)")
        }
        return web
    }

    /// Wartet, bis der Webview sein Laden beendet hat oder es scheiterte, höchstens 60 s; `true`
    /// nach einem beendeten Laden.
    ///
    /// Erst danach fragt der Test `isGestartet`, wie die App, die online erst nach dem Laden
    /// vorwärmt (LLH-2073). Dessen Frist (`Vorrat.startpruefungFrist`, 10 s) zählt ab dem Aufruf;
    /// riefe der Test es gleich nach `load`, zählte der Kaltstart des Webprozesses mit. Der dauerte
    /// im CI 9,6 s, und die Seite kam 0,4 s nach Ablauf der Frist an (Lauf 45203095862, iPad).
    private func warteAufLadeende(_ beobachter: Ladebeobachter) async -> Bool {
        let beginn = ContinuousClock.now
        while ContinuousClock.now - beginn < .seconds(60) {
            if beobachter.isBeendet { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return beobachter.isFertig
    }
}

/// Hält fest, ob der Webview fertig geladen hat, und den letzten Ladefehler, für das Warten und
/// die Meldung roter Tests. Ohne eigene Antwort auf Anmeldeanfragen: die Zertifikatsprüfung bleibt
/// die des Systems.
@MainActor
private final class Ladebeobachter: NSObject, WKNavigationDelegate {
    private var fehler: Error?
    /// Das Laden der Hauptseite ist beendet (`didFinish`).
    private(set) var isFertig = false

    /// Beendet oder gescheitert.
    var isBeendet: Bool { isFertig || fehler != nil }

    var beschreibung: String {
        guard let fehler else { return isFertig ? "geladen, kein Ladefehler" : "Laden nicht beendet, kein Ladefehler" }
        let ns = fehler as NSError
        var text = "\(ns.domain) \(ns.code)"
        if let darunter = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            text += ", darunter \(darunter.domain) \(darunter.code)"
        }
        return text
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) {
        fehler = error
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fehler = error
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isFertig = true
    }
}
