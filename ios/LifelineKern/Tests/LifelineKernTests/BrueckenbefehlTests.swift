import XCTest

@testable import LifelineKern

/// Befehle der Brücke (Wire-Format im Kopf von `ios/App/Huelle/huelle.js`) und ihre Ausführung
/// gegen die Systemdienste der App (Spec `ios-huelle`, „Haptik nur auf Wunsch der Seite und
/// abschaltbar“, „Meldung und Badge bei laufender App“).
final class BrueckenbefehlTests: XCTestCase {
    // MARK: Lesen

    func testHapticsWirdGelesen() {
        XCTAssertEqual(Bruecke.parse(["cmd": "haptics", "kind": "success"]), .haptics(kind: "success"))
        XCTAssertEqual(Bruecke.parse(["cmd": "haptics"]), .haptics(kind: ""))
    }

    func testShowNotificationWirdGelesen() {
        XCTAssertEqual(
            Bruecke.parse(["cmd": "show_notification", "id": 3, "title": "Alarm", "body": "ELW 1"]),
            .showNotification(id: 3, title: "Alarm", body: "ELW 1"))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "show_notification", "id": 4, "title": "Alarm", "body": NSNull()]),
            .showNotification(id: 4, title: "Alarm", body: nil))
    }

    func testSetAppBadgeWirdGelesen() {
        XCTAssertEqual(Bruecke.parse(["cmd": "set_app_badge", "id": 1, "count": 5]), .setAppBadge(id: 1, count: 5))
        // JS-Zahlen kommen auch als Gleitkomma.
        XCTAssertEqual(
            Bruecke.parse(["cmd": "set_app_badge", "id": 2.0, "count": 0.0]), .setAppBadge(id: 2, count: 0))
    }

    func testPrintUndAnmeldungWerdenGelesen() {
        XCTAssertEqual(Bruecke.parse(["cmd": "print", "id": 7]), .print(id: 7))
        XCTAssertEqual(Bruecke.parse(["cmd": "sign_in_with_browser", "id": 8]), .signInWithBrowser(id: 8))
    }

    func testFehlerhafteNachrichtenMitIdBekommenEineAblehnung() {
        let faelle: [[String: Any]] = [
            ["cmd": "show_notification", "id": 1],
            ["cmd": "show_notification", "id": 1, "title": 5],
            ["cmd": "set_app_badge", "id": 1, "count": -1],
            ["cmd": "set_app_badge", "id": 1, "count": 1.5],
            ["cmd": "set_app_badge", "id": 1, "count": "3"],
            ["cmd": "set_app_badge", "id": 1],
            ["cmd": "open_settings", "id": 1],
        ]
        for nachricht in faelle {
            guard case .ungueltig(id: 1, _)? = Bruecke.parse(nachricht) else {
                return XCTFail("\(nachricht)")
            }
        }
    }

    func testOhneLesbareIdBleibtEineNachrichtOhneWirkung() {
        let faelle: [Any] = [
            "haptics", 5, ["kind": "success"], ["cmd": "print"], ["cmd": "print", "id": "1"],
            ["cmd": "print", "id": 1.5], ["cmd": "unknown"],
        ]
        for nachricht in faelle {
            XCTAssertNil(Bruecke.parse(nachricht), "\(nachricht)")
        }
    }

    // MARK: Antwort an die Seite

    func testDieAntwortRuftLifelineReplyAuf() {
        XCTAssertEqual(
            Bruecke.replyScript(Brueckenantwort(id: 4, fehler: nil, wert: .bool(true))),
            "window.__LIFELINE_REPLY__?.(4, null, true);")
        XCTAssertEqual(
            Bruecke.replyScript(Brueckenantwort(id: 5, fehler: nil, wert: .null)),
            "window.__LIFELINE_REPLY__?.(5, null, null);")
    }

    func testFehlertexteWerdenAlsJsStringMaskiert() {
        let skript = Bruecke.replyScript(
            Brueckenantwort(id: 6, fehler: "a\"b'c\n</script>\\", wert: .null))
        XCTAssertEqual(skript, #"window.__LIFELINE_REPLY__?.(6, "a\"b'c\n<\/script>\\", null);"#)
    }

    // MARK: Ausführung

    @MainActor
    func testHapticsSpieltDieAbgebildeteRueckmeldungOhneAntwort() async {
        let dienste = Dienste()
        let antwort = await Brueckenausfuehrung.run(.haptics(kind: "tap"), dienste: dienste)
        XCTAssertNil(antwort)
        XCTAssertEqual(dienste.gespielt, [.lightImpact])
    }

    @MainActor
    func testHapticsBeachtetDenSchalter() async {
        let dienste = Dienste()
        dienste.isHaptikEnabled = false
        _ = await Brueckenausfuehrung.run(.haptics(kind: "success"), dienste: dienste)
        _ = await Brueckenausfuehrung.run(.haptics(kind: "boom"), dienste: dienste)
        XCTAssertEqual(dienste.gespielt, [])
    }

    @MainActor
    func testDieErsteMeldungFragtNachDerBerechtigung() async {
        let dienste = Dienste()
        dienste.freigabe = .offen
        dienste.erteilt = true
        let antwort = await Brueckenausfuehrung.run(
            .showNotification(id: 1, title: "Alarm", body: nil), dienste: dienste)
        XCTAssertEqual(dienste.anfragen, 1)
        XCTAssertEqual(dienste.meldungen.map(\.0), ["Alarm"])
        XCTAssertEqual(antwort, Brueckenantwort(id: 1, fehler: nil, wert: .null))
    }

    @MainActor
    func testErlaubteMeldungenFragenNichtErneut() async {
        let dienste = Dienste()
        dienste.freigabe = .erlaubt
        _ = await Brueckenausfuehrung.run(
            .showNotification(id: 1, title: "A", body: "B"), dienste: dienste)
        XCTAssertEqual(dienste.anfragen, 0)
        XCTAssertEqual(dienste.meldungen.first?.1, "B")
    }

    @MainActor
    func testOhneBerechtigungLehntDieHuelleAbUndZeigtNichts() async {
        for (freigabe, erteilt) in [(Meldungsfreigabe.verweigert, false), (.offen, false)] {
            let dienste = Dienste()
            dienste.freigabe = freigabe
            dienste.erteilt = erteilt
            let antwort = await Brueckenausfuehrung.run(
                .showNotification(id: 2, title: "Alarm", body: nil), dienste: dienste)
            XCTAssertEqual(dienste.meldungen.count, 0)
            XCTAssertEqual(antwort?.id, 2)
            XCTAssertNotNil(antwort?.fehler)
        }
    }

    @MainActor
    func testDasBadgeWirdGesetztUndNullNimmtEsWeg() async {
        let dienste = Dienste()
        let a = await Brueckenausfuehrung.run(.setAppBadge(id: 1, count: 3), dienste: dienste)
        let b = await Brueckenausfuehrung.run(.setAppBadge(id: 2, count: 0), dienste: dienste)
        XCTAssertEqual(dienste.badges, [3, 0])
        XCTAssertEqual(a, Brueckenantwort(id: 1, fehler: nil, wert: .null))
        XCTAssertEqual(b?.fehler, nil)
    }

    @MainActor
    func testEinFehlerDesSystemsGehtAlsAblehnungAnDieSeite() async {
        let dienste = Dienste()
        dienste.wirft = true
        let antwort = await Brueckenausfuehrung.run(.setAppBadge(id: 9, count: 1), dienste: dienste)
        XCTAssertEqual(antwort?.id, 9)
        XCTAssertEqual(antwort?.fehler, "kaputt")
    }

    @MainActor
    func testDruckenMeldetObGedrucktWurde() async {
        let dienste = Dienste()
        dienste.gedruckt = false
        let antwort = await Brueckenausfuehrung.run(.print(id: 3), dienste: dienste)
        XCTAssertEqual(antwort, Brueckenantwort(id: 3, fehler: nil, wert: .bool(false)))
        XCTAssertEqual(dienste.drucke, 1)
    }

    @MainActor
    func testUngueltigeBefehleWerdenAbgelehnt() async {
        let dienste = Dienste()
        let a = await Brueckenausfuehrung.run(.ungueltig(id: 4, grund: "x"), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 4, fehler: "x", wert: .null))
    }

    /// Die Antwort sagt nur, ob die Sitzung begonnen hat; das Ergebnis kommt später als Ereignis
    /// `lifeline:app-anmeldung` (wie in der Desktop-Hülle).
    @MainActor
    func testDieAnmeldungImBrowserStartetDieSitzung() async {
        let dienste = Dienste()
        let a = await Brueckenausfuehrung.run(.signInWithBrowser(id: 5), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 5, fehler: nil, wert: .null))
        XCTAssertEqual(dienste.anmeldungen, 1)
        dienste.wirft = true
        let b = await Brueckenausfuehrung.run(.signInWithBrowser(id: 6), dienste: dienste)
        XCTAssertEqual(b, Brueckenantwort(id: 6, fehler: "kaputt", wert: .null))
    }
}

@MainActor
private final class Dienste: Huellendienste {
    struct Kaputt: LocalizedError {
        var errorDescription: String? { "kaputt" }
    }

    var isHaptikEnabled = true
    var freigabe = Meldungsfreigabe.erlaubt
    var erteilt = false
    var wirft = false
    var gedruckt = true
    var gespielt: [Haptik.Feedback] = []
    var anfragen = 0
    var meldungen: [(String, String?)] = []
    var badges: [Int] = []
    var drucke = 0
    var anmeldungen = 0

    func play(_ feedback: Haptik.Feedback) { gespielt.append(feedback) }

    func loadMeldungsfreigabe() async -> Meldungsfreigabe { freigabe }

    func requestMeldungsfreigabe() async -> Bool {
        anfragen += 1
        return erteilt
    }

    func showNotification(title: String, body: String?) async throws {
        if wirft { throw Kaputt() }
        meldungen.append((title, body))
    }

    func setBadge(_ count: Int) async throws {
        if wirft { throw Kaputt() }
        badges.append(count)
    }

    func print() async throws -> Bool {
        if wirft { throw Kaputt() }
        drucke += 1
        return gedruckt
    }

    func startAnmeldung() throws {
        if wirft { throw Kaputt() }
        anmeldungen += 1
    }
}
