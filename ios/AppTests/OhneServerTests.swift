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
        server = Testserver(routen: Self.routen())
        let port = try await server.start()
        var liste = Serverliste()
        eintrag = liste.add(try ServerAdresse.parse("https://localhost:\(port)"))
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
        let ohne = webview()
        XCTAssertTrue(vorrat.loadVorrat(eintrag, in: ohne))
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
        async let erstes: Void = vorrat.vorwaermen(eintrag, info: info("1.0"), in: online)
        async let zweites: Void = vorrat.vorwaermen(eintrag, info: info("1.0"), in: online)
        _ = await (erstes, zweites)
        XCTAssertEqual(server.abrufe["/"], 2)
        XCTAssertEqual(vorrat.ablage.load(eintrag.id)?.version, "1.0")
    }

    // MARK: Hilfen

    private func info(_ version: String, assets: [String] = OhneServerTests.assets) -> ShellInfo {
        ShellInfo(version: version, shellContract: 1, assets: assets)
    }

    private func webview() -> WKWebView {
        let web = Webviewfabrik.make(
            fuer: eintrag, skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { nil }), navigation: nil)
        halter.append(web)
        return web
    }

    /// Lädt die Oberfläche vom Testserver und wartet, bis sie steht.
    private func ladeOnline() async throws -> WKWebView {
        let web = webview()
        web.load(URLRequest(url: eintrag.adresse.url))
        let gestartet = await vorrat.isGestartet(web)
        XCTAssertTrue(gestartet, "Oberfläche vom Testserver nicht geladen (Test-CA im Simulator?)")
        while web.isLoading { try await Task.sleep(for: .milliseconds(100)) }
        return web
    }
}
