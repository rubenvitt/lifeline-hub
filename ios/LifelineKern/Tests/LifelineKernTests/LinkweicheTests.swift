import Foundation
import XCTest

@testable import LifelineKern

/// Was der Webview mit einer Navigation tut (tasks.md 8.9; Spec `ios-huelle`, „Links, Downloads
/// und Druck laufen nicht ins Leere“). Die Regeln selbst prüft `LinkregelnTests` gegen die
/// gemeinsamen Fälle; hier steht, wie die App sie auf die Rückrufe von WebKit abbildet.
final class LinkweicheTests: XCTestCase {
    let server = URL(string: "https://elw.local:8443/")!
    let seite = URL(string: "https://elw.local:8443/einsaetze/1/etb")!

    func navigation(
        _ ziel: String, isMainFrame: Bool = true, neuesFenster: Bool = false,
        shouldPerformDownload: Bool = false, seite: URL? = nil
    ) -> Linkweiche.Entscheidung {
        Linkweiche.navigation(
            server: server, ziel: URL(string: ziel)!, isMainFrame: isMainFrame,
            neuesFenster: neuesFenster, shouldPerformDownload: shouldPerformDownload,
            seite: seite ?? self.seite)
    }

    func testEigeneSeitenBleibenImWebview() {
        XCTAssertEqual(navigation("https://elw.local:8443/einsaetze"), .erlauben)
        XCTAssertEqual(navigation("https://elw.local:8443/api/auth/oidc/start"), .erlauben)
    }

    func testDieAnmeldungBeimIdentitaetsanbieterLaeuftImWebview() {
        XCTAssertEqual(navigation("https://id.rubeen.dev/authorize?x=1"), .erlauben)
    }

    func testDateiroutenWerdenHeruntergeladen() {
        XCTAssertEqual(navigation("https://elw.local:8443/api/einsaetze/1/export.csv"), .download)
        XCTAssertEqual(
            navigation("https://elw.local:8443/api/einsaetze/1/export.csv", neuesFenster: true), .download)
    }

    func testMailUndTelefonOeffnetDasSystem() {
        XCTAssertEqual(navigation("mailto:leitstelle@example.org"), .system(URL(string: "mailto:leitstelle@example.org")!))
        XCTAssertEqual(navigation("tel:+49112"), .system(URL(string: "tel:+49112")!))
    }

    /// `target=_blank` und `window.open` der eigenen Origin laden im selben Webview.
    func testNeueFensterDerEigenenOriginLadenImSelbenWebview() {
        let ziel = "https://elw.local:8443/einsaetze/1/etb?eintrag=4"
        XCTAssertEqual(navigation(ziel, neuesFenster: true), .imWebviewLaden(URL(string: ziel)!))
    }

    func testFremdeSeitenInNeuemFensterOeffnetDasSystem() {
        let ziel = "https://www.dwd.de/warnungen"
        XCTAssertEqual(navigation(ziel, neuesFenster: true), .system(URL(string: ziel)!))
        XCTAssertEqual(navigation("javascript:alert(1)", neuesFenster: true), .abbrechen)
        XCTAssertEqual(navigation("file:///etc/passwd", neuesFenster: true), .abbrechen)
    }

    /// `<a download>` und `blob:` des CSV-Exports: WebKit meldet `shouldPerformDownload`.
    func testDownloadsDerEigenenSeiteAuchAusBlob() {
        XCTAssertEqual(
            navigation("blob:https://elw.local:8443/3f1c", shouldPerformDownload: true), .download)
        XCTAssertEqual(
            navigation("blob:https://elw.local:8443/3f1c", neuesFenster: true, shouldPerformDownload: true),
            .download)
    }

    func testFremdeSeitenLadenNichtsHerunter() {
        XCTAssertEqual(
            navigation(
                "blob:https://id.rubeen.dev/1", shouldPerformDownload: true,
                seite: URL(string: "https://id.rubeen.dev/login")!),
            .abbrechen)
        XCTAssertEqual(
            Linkweiche.navigation(
                server: nil, ziel: URL(string: "blob:https://elw.local:8443/1")!, isMainFrame: true,
                neuesFenster: false, shouldPerformDownload: true, seite: seite),
            .abbrechen)
    }

    func testUnterframesLadenUnveraendert() {
        XCTAssertEqual(navigation("https://karten.example/tile", isMainFrame: false), .erlauben)
        XCTAssertEqual(navigation("https://elw.local:8443/api/x", isMainFrame: false), .erlauben)
    }

    func testEineAntwortOhneDarstellungWirdZumDownload() {
        XCTAssertEqual(Linkweiche.antwort(canShowMIMEType: false, isForMainFrame: true), .download)
        XCTAssertEqual(Linkweiche.antwort(canShowMIMEType: true, isForMainFrame: true), .erlauben)
        XCTAssertEqual(Linkweiche.antwort(canShowMIMEType: false, isForMainFrame: false), .erlauben)
    }

    // MARK: Ablage

    func testDownloadsLiegenJeEinzelnImTemporaerenVerzeichnis() {
        let basis = URL(fileURLWithPath: "/tmp/Downloads", isDirectory: true)
        let kennung = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        XCTAssertEqual(
            Downloadablage.ziel(basis: basis, vorschlag: "ETB 2026-11-18.csv", kennung: kennung).path,
            "/tmp/Downloads/11111111-2222-3333-4444-555555555555/ETB 2026-11-18.csv")
    }

    func testDerVorgeschlageneNameVerlaesstSeinVerzeichnisNie() {
        let basis = URL(fileURLWithPath: "/tmp/Downloads", isDirectory: true)
        let kennung = UUID()
        for (vorschlag, erwartet) in [
            ("../../etc/passwd", "passwd"),
            ("..", "Download"),
            ("", "Download"),
            ("  ", "Download"),
            (".versteckt", "versteckt"),
            ("a:b\u{0}c.txt", "a_b_c.txt"),
            ("ordner/datei.pdf", "datei.pdf"),
        ] {
            let ziel = Downloadablage.ziel(basis: basis, vorschlag: vorschlag, kennung: kennung)
            XCTAssertEqual(ziel.lastPathComponent, erwartet, vorschlag)
            XCTAssertEqual(ziel.deletingLastPathComponent().lastPathComponent, kennung.uuidString, vorschlag)
        }
    }
}
