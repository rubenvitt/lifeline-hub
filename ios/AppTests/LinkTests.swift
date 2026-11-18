import LifelineKern
import WebKit
import XCTest

@testable import LifelineHub

/// Links, neue Fenster und Downloads im echten Webview (tasks.md 8.9; Spec `ios-huelle`, „Links,
/// Downloads und Druck laufen nicht ins Leere“). Die Regeln prüft der Kern (`LinkweicheTests`,
/// gemeinsame Fälle); hier geht es darum, dass die Rückrufe von WebKit dort ankommen.
@MainActor
final class LinkTests: XCTestCase {
    let elw = try! ServerAdresse.parse("https://elw.local:8443")

    private var geoeffnet: [URL] = []
    private var gemeldet: [Ablauf.Event] = []
    private var geteilt: [URL] = []
    private var halter: [AnyObject] = []

    func testEinFremderLinkInNeuemFensterOeffnetDasSystem() async throws {
        let web = try await lade("<a id='a' href='https://www.dwd.de/warnungen' target='_blank'>DWD</a>")
        _ = try await web.evaluateJavaScript("document.getElementById('a').click(); 0")
        await warte { !self.geoeffnet.isEmpty }
        XCTAssertEqual(geoeffnet, [URL(string: "https://www.dwd.de/warnungen")!])
        XCTAssertEqual(web.url, elw.url)
    }

    func testMailtoOeffnetDasSystem() async throws {
        let web = try await lade("<a id='a' href='mailto:leitstelle@example.org'>Mail</a>")
        _ = try await web.evaluateJavaScript("document.getElementById('a').click(); 0")
        await warte { !self.geoeffnet.isEmpty }
        XCTAssertEqual(geoeffnet, [URL(string: "mailto:leitstelle@example.org")!])
    }

    /// `window.open` der eigenen Origin lädt im selben Webview: die Navigation beginnt dort (und
    /// scheitert ohne Server im Test an der Adresse, was der Begleiter meldet).
    func testWindowOpenDerEigenenOriginLaedtImSelbenWebview() async throws {
        let web = try await lade("<p>ETB</p>")
        _ = try await web.evaluateJavaScript(
            "window.open('https://elw.local:8443/einsaetze/1/etb', '_blank'); 0")
        await warte(sekunden: 15) { !self.fehlschlaege.isEmpty }
        guard let url = fehlschlaege.first else {
            return XCTFail("keine Navigation im selben Webview: \(gemeldet)")
        }
        XCTAssertEqual(url?.path, "/einsaetze/1/etb")
        XCTAssertEqual(geoeffnet, [])
    }

    /// Jede übernommene Seite geht als `seiteGeladen` an den Ablauf; zurück auf der Origin des
    /// Servers nimmt er den Hinweis „Zur Oberfläche“ weg.
    func testEineGeladeneSeiteWirdGemeldet() async throws {
        _ = try await lade("<p>Lage</p>")
        guard case .seiteGeladen(let url)? = gemeldet.first else {
            return XCTFail("keine geladene Seite gemeldet: \(gemeldet)")
        }
        XCTAssertEqual(url, elw.url)
    }

    /// CSV-Export aus einem `blob:`: WKDownload legt die Datei ab, das Teilen-Blatt bekommt sie.
    func testEinBlobDownloadLandetImTeilenBlatt() async throws {
        let web = try await lade("<p>Export</p>")
        _ = try await web.evaluateJavaScript("""
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['Zeit;Text\\n12:00;Lage'], { type: 'text/csv' }));
            a.download = 'etb.csv';
            document.body.appendChild(a);
            a.click(); 0
            """)
        await warte(sekunden: 10) { !self.geteilt.isEmpty }
        let datei = try XCTUnwrap(geteilt.first)
        XCTAssertEqual(datei.lastPathComponent, "etb.csv")
        XCTAssertEqual(try String(contentsOf: datei, encoding: .utf8), "Zeit;Text\n12:00;Lage")
        XCTAssertTrue(datei.path.hasPrefix(Downloads.basis.path))
    }

    // MARK: Hilfen

    private func lade(_ html: String) async throws -> WKWebView {
        let adresse = elw
        let begleiter = Navigationsbegleiter(
            aktiverServer: { adresse },
            oeffne: { [weak self] url in self?.geoeffnet.append(url) },
            downloads: Downloads(zeige: { [weak self] datei, _ in self?.geteilt.append(datei) })
        ) { [weak self] _, event in self?.gemeldet.append(event) }
        var liste = Serverliste()
        let web = Webviewfabrik.make(
            fuer: liste.add(elw), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { adresse }),
            navigation: begleiter)
        halter += [begleiter, web]
        XCTAssertTrue(web.uiDelegate === begleiter)
        web.loadHTMLString(
            "<!doctype html><html><body>\(html)<span id='bereit'></span></body></html>", baseURL: elw.url)
        await warte {
            ((try? await web.evaluateJavaScript("document.getElementById('bereit') ? 1 : 0")) as? Int) == 1
        }
        return web
    }

    /// Adressen der gemeldeten Ladefehler, in Reihenfolge.
    private var fehlschlaege: [URL?] {
        gemeldet.compactMap { event -> URL?? in
            guard case .navigationFehlgeschlagen(_, let url) = event else { return nil }
            return .some(url)
        }
    }

    private func warte(sekunden: Double = 5, bis bedingung: () async -> Bool) async {
        let ende = Date().addingTimeInterval(sekunden)
        while !(await bedingung()), Date() < ende {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }
}
