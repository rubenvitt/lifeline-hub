import Foundation
import XCTest

@testable import LifelineKern

/// Entfernen eines Servers (tasks.md 8.11; Entwurf D3; Spec `ios-huelle`, „Mehrere Server lassen
/// sich verwalten“, „Jeder Server hat seinen eigenen Datenspeicher“): erst den Webview des
/// Speichers schließen, dann den Speicher löschen, erst danach den Eintrag; ein Fehler bleibt
/// sichtbar, und der Eintrag bleibt stehen.
@MainActor
final class ServerentfernungTests: XCTestCase {
    var liste = Serverliste()
    var elw: ServerEintrag!
    var lager: ServerEintrag!

    override func setUp() async throws {
        liste = Serverliste()
        elw = liste.add(try ServerAdresse.parse("https://elw.local:8443"))
        lager = liste.add(try ServerAdresse.parse("https://lager.example"), name: "Lager")
    }

    func testDieReihenfolgeIstWebviewSpeicherEintrag() async throws {
        let dienste = Dienste(liste: liste)
        try await Serverentfernung.run(lager.id, dienste: dienste)
        XCTAssertEqual(
            dienste.schritte,
            [.closeWebView(lager.id), .removeDatenspeicher(lager.id), .removeEintrag(lager.id)])
        XCTAssertEqual(dienste.liste.eintraege.map(\.id), [elw.id])
    }

    func testDerAktiveServerLaesstSichNichtEntfernen() async {
        let dienste = Dienste(liste: liste)
        await XCTAssertThrows(.aktiv) { try await Serverentfernung.run(self.elw.id, dienste: dienste) }
        XCTAssertEqual(dienste.schritte, [])
        XCTAssertFalse(Serverentfernung.isEntfernbar(elw.id, in: liste))
        XCTAssertTrue(Serverentfernung.isEntfernbar(lager.id, in: liste))
    }

    func testEinUnbekannterServerAendertNichts() async {
        let dienste = Dienste(liste: liste)
        await XCTAssertThrows(.unbekannt) { try await Serverentfernung.run(UUID(), dienste: dienste) }
        XCTAssertEqual(dienste.schritte, [])
    }

    /// Scheitert das Löschen des Speichers, bleibt der Eintrag: die Person sieht den Fehler und
    /// kann es erneut versuchen, und kein Speicher bleibt ohne Eintrag zurück.
    func testScheitertDasLoeschenBleibtDerEintragUndDerFehlerWirdGemeldet() async {
        let dienste = Dienste(liste: liste)
        dienste.speicherFehler = "in Benutzung"
        await XCTAssertThrows(.datenspeicher(name: "Lager", grund: "in Benutzung")) {
            try await Serverentfernung.run(self.lager.id, dienste: dienste)
        }
        XCTAssertEqual(dienste.schritte, [.closeWebView(lager.id), .removeDatenspeicher(lager.id)])
        XCTAssertEqual(dienste.liste.eintraege.count, 2)
        XCTAssertEqual(
            Serverentfernung.Fehler.datenspeicher(name: "Lager", grund: "in Benutzung").errorDescription,
            "Die Daten von „Lager“ ließen sich nicht löschen (in Benutzung). Der Server bleibt in der Liste; bitte später erneut entfernen.")
    }

    /// Wird der Server während des Löschens aktiv, bleibt er stehen (die Liste wirft).
    func testWirdDerServerUnterwegsAktivBleibtErStehen() async {
        let dienste = Dienste(liste: liste)
        let id = lager.id
        dienste.waehrendDesLoeschens = { try? $0.liste.activate(id) }
        await XCTAssertThrows(.aktiv) { try await Serverentfernung.run(self.lager.id, dienste: dienste) }
        XCTAssertEqual(dienste.liste.eintraege.count, 2)
    }

    func testDieRueckfrageNenntDieNichtUebertragenenEintraege() {
        XCTAssertEqual(Serverentfernung.rueckfrageTitel(lager), "„Lager“ entfernen?")
        XCTAssertTrue(Serverentfernung.hinweis.contains("noch nicht übertragen"), Serverentfernung.hinweis)
        XCTAssertTrue(Serverentfernung.hinweis.contains("Anmeldung"), Serverentfernung.hinweis)
    }

    private func XCTAssertThrows(
        _ erwartet: Serverentfernung.Fehler, _ arbeit: () async throws -> Void,
        file: StaticString = #filePath, line: UInt = #line
    ) async {
        do {
            try await arbeit()
            XCTFail("kein Fehler", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? Serverentfernung.Fehler, erwartet, file: file, line: line)
        }
    }
}

@MainActor
private final class Dienste: Entfernungsdienste {
    enum Schritt: Equatable {
        case closeWebView(UUID)
        case removeDatenspeicher(UUID)
        case removeEintrag(UUID)
    }

    struct Fehler: LocalizedError {
        let errorDescription: String?
    }

    var liste: Serverliste
    var schritte: [Schritt] = []
    var speicherFehler: String?
    var waehrendDesLoeschens: ((Dienste) -> Void)?

    init(liste: Serverliste) { self.liste = liste }

    var serverliste: Serverliste { liste }

    func closeWebView(datenspeicher id: UUID) { schritte.append(.closeWebView(id)) }

    func removeDatenspeicher(_ id: UUID) async throws {
        schritte.append(.removeDatenspeicher(id))
        waehrendDesLoeschens?(self)
        if let speicherFehler { throw Fehler(errorDescription: speicherFehler) }
    }

    func removeEintrag(_ id: UUID) throws(Serverliste.ListError) {
        try liste.remove(id)
        schritte.append(.removeEintrag(id))
    }
}
