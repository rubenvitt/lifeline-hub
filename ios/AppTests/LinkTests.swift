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

    /// Der erste Webview-Test fing sonst den Kaltstart von WebKit ab (`WebkitVorlauf`).
    override func setUp() async throws {
        await WebkitVorlauf.sicherstellen()
    }

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
    /// scheitert ohne Server im Test an der Adresse, was der Begleiter meldet). Der Server liegt
    /// auf einem geschlossenen Port: die Verbindung scheitert sofort, während die Auflösung von
    /// `elw.local` im CI länger dauert, als der Test wartet. Port 2, nicht 9: 9 (discard) sperrt
    /// WebKit wie jeden Port der Fetch-Liste „bad ports“, ohne Ladefehler der URL-Schicht; der
    /// Webview blieb dann auf `about:blank` (Lauf 44419406791).
    func testWindowOpenDerEigenenOriginLaedtImSelbenWebview() async throws {
        let web = try await lade("<p>ETB</p>", server: try ServerAdresse.parse("https://127.0.0.1:2"))
        _ = try await web.evaluateJavaScript(
            "window.open('https://127.0.0.1:2/einsaetze/1/etb', '_blank'); 0")
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
        // 30 s: der erste Webinhalt im frisch gestarteten Simulator kam im CI erst nach über 80 s
        // (Lauf 44427089802, iPhone und iPad nebeneinander); geprüft wird, dass die Datei ankommt.
        await warte(sekunden: 30) { !self.geteilt.isEmpty }
        let datei = try XCTUnwrap(geteilt.first, "kein Download im Teilen-Blatt; \(downloadstand())")
        XCTAssertEqual(datei.lastPathComponent, "etb.csv")
        XCTAssertEqual(try String(contentsOf: datei, encoding: .utf8), "Zeit;Text\n12:00;Lage")
        XCTAssertTrue(datei.path.hasPrefix(Downloads.basis.path))
    }

    // MARK: Hilfen

    private func lade(_ html: String, server: ServerAdresse? = nil) async throws -> WKWebView {
        let adresse = server ?? elw
        let begleiter = Navigationsbegleiter(
            aktiverServer: { adresse },
            oeffne: { [weak self] url in self?.geoeffnet.append(url) },
            downloads: Downloads(zeige: { [weak self] datei, _ in self?.geteilt.append(datei) })
        ) { [weak self] _, event in self?.gemeldet.append(event) }
        var liste = Serverliste()
        let web = Webviewfabrik.make(
            fuer: liste.add(adresse), skript: "",
            empfang: Brueckenempfang(dienste: Attrappe(), aktiverServer: { adresse }),
            navigation: begleiter)
        halter += [begleiter, web]
        XCTAssertTrue(web.uiDelegate === begleiter)
        web.loadHTMLString(
            "<!doctype html><html><body>\(html)<span id='bereit'></span></body></html>", baseURL: adresse.url)
        // Ohne geladene Seite liefe jeder Klick ins Leere; das soll als Grund dastehen, nicht als
        // fehlende Wirkung danach.
        let bereit = await warte(sekunden: 30) {
            ((try? await web.evaluateJavaScript("document.getElementById('bereit') ? 1 : 0")) as? Int) == 1
        }
        XCTAssertTrue(bereit, "Testseite nach 30 s nicht im Webview geladen")
        return web
    }

    /// Für die Meldung eines roten Download-Tests: wie weit kam der Download? Eine Datei unter
    /// `Downloads.basis` heißt, WebKit hat ihn begonnen und ein Ziel bekommen, aber nicht beendet;
    /// keine Datei heißt, er begann nicht (LLH-2073).
    private func downloadstand() -> String {
        let dateien = FileManager.default.enumerator(at: Downloads.basis, includingPropertiesForKeys: nil)?
            .compactMap { ($0 as? URL)?.lastPathComponent } ?? []
        let ziele = dateien.isEmpty ? "keine" : dateien.joined(separator: ", ")
        return "Dateien unter Downloads: \(ziele); gemeldet: \(gemeldet); geöffnet: \(geoeffnet)"
    }

    /// Adressen der gemeldeten Ladefehler, in Reihenfolge.
    private var fehlschlaege: [URL?] {
        gemeldet.compactMap { event -> URL?? in
            guard case .navigationFehlgeschlagen(_, let url) = event else { return nil }
            return .some(url)
        }
    }

    /// Wartet, bis `bedingung` gilt, höchstens `sekunden`; liefert, ob sie gilt.
    @discardableResult
    private func warte(sekunden: Double = 5, bis bedingung: () async -> Bool) async -> Bool {
        let ende = Date().addingTimeInterval(sekunden)
        while Date() < ende {
            if await bedingung() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return await bedingung()
    }
}
