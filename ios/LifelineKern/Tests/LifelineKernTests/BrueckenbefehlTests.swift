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

    func testParseKenntDiePushBefehle() {
        XCTAssertEqual(Bruecke.parse(["cmd": "push_register", "id": 1]), .pushRegister(id: 1))
        XCTAssertEqual(Bruecke.parse(["cmd": "push_unregister", "id": 2]), .pushUnregister(id: 2))
        XCTAssertEqual(Bruecke.parse(["cmd": "push_state", "id": 3]), .pushState(id: 3))
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

    /// Ohne vorherige Meldung fragt das erste Badge nach der Berechtigung, wie eine Meldung.
    @MainActor
    func testDasErsteBadgeFragtNachDerBerechtigung() async {
        let dienste = Dienste()
        dienste.freigabe = .offen
        dienste.erteilt = true
        let antwort = await Brueckenausfuehrung.run(.setAppBadge(id: 1, count: 4), dienste: dienste)
        XCTAssertEqual(dienste.anfragen, 1)
        XCTAssertEqual(dienste.badges, [4])
        XCTAssertEqual(antwort, Brueckenantwort(id: 1, fehler: nil, wert: .null))
    }

    @MainActor
    func testOhneBerechtigungSetztDieHuelleKeinBadge() async {
        for (freigabe, erteilt) in [(Meldungsfreigabe.verweigert, false), (.offen, false)] {
            let dienste = Dienste()
            dienste.freigabe = freigabe
            dienste.erteilt = erteilt
            let antwort = await Brueckenausfuehrung.run(.setAppBadge(id: 2, count: 1), dienste: dienste)
            XCTAssertEqual(dienste.badges, [], "\(freigabe)")
            XCTAssertEqual(antwort, Brueckenantwort(id: 2, fehler: Brueckenausfuehrung.meldungenAus, wert: .null))
        }
    }

    /// Wegnehmen fragt nie: ohne Berechtigung gibt es keine Zahl am Symbol, und eine Rückfrage beim
    /// Laden der Seite hätte keinen Anlass, den die Person versteht.
    @MainActor
    func testNullFragtNieUndGelingtOhneBerechtigungOhneWirkung() async {
        for freigabe in [Meldungsfreigabe.offen, .verweigert] {
            let dienste = Dienste()
            dienste.freigabe = freigabe
            dienste.erteilt = true
            let antwort = await Brueckenausfuehrung.run(.setAppBadge(id: 3, count: 0), dienste: dienste)
            XCTAssertEqual(dienste.anfragen, 0, "\(freigabe)")
            XCTAssertEqual(dienste.badges, [], "\(freigabe)")
            XCTAssertEqual(antwort, Brueckenantwort(id: 3, fehler: nil, wert: .null))
        }
    }

    @MainActor
    func testPushRegisterLiefertKennungTokenUmgebungSchluessel() async {
        let dienste = Dienste()
        let antwort = await Brueckenausfuehrung.run(.pushRegister(id: 5), dienste: dienste)
        XCTAssertEqual(
            antwort,
            Brueckenantwort(
                id: 5, fehler: nil,
                wert: .objekt([
                    "registration_id": "kennung-1", "token": "abcd", "environment": "sandbox",
                    "key": "schluessel-1",
                ])))
        XCTAssertEqual(dienste.registrierungen, 1)
    }

    @MainActor
    func testPushRegisterVerweigertMeldetDenied() async {
        let dienste = Dienste()
        dienste.registrierungFehler = .denied
        let a = await Brueckenausfuehrung.run(.pushRegister(id: 6), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 6, fehler: "denied", wert: .null))
        dienste.registrierungFehler = .unavailable
        let b = await Brueckenausfuehrung.run(.pushRegister(id: 7), dienste: dienste)
        XCTAssertEqual(b, Brueckenantwort(id: 7, fehler: "unavailable", wert: .null))
    }

    @MainActor
    func testPushUnregisterUndPushStateAntworten() async {
        let dienste = Dienste()
        dienste.freigabe = .erlaubt
        dienste.kennung = "kennung-1"
        let a = await Brueckenausfuehrung.run(.pushUnregister(id: 1), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 1, fehler: nil, wert: .null))
        XCTAssertEqual(dienste.abmeldungen, 1)
        let b = await Brueckenausfuehrung.run(.pushState(id: 2), dienste: dienste)
        XCTAssertEqual(
            b,
            Brueckenantwort(
                id: 2, fehler: nil,
                wert: .objekt(["permission": "granted", "registration_id": "kennung-1"])))
        dienste.freigabe = .offen
        dienste.kennung = nil
        let c = await Brueckenausfuehrung.run(.pushState(id: 3), dienste: dienste)
        XCTAssertEqual(
            c, Brueckenantwort(id: 3, fehler: nil, wert: .objekt(["permission": "undetermined"])))
        dienste.freigabe = .verweigert
        let d = await Brueckenausfuehrung.run(.pushState(id: 4), dienste: dienste)
        XCTAssertEqual(
            d, Brueckenantwort(id: 4, fehler: nil, wert: .objekt(["permission": "denied"])))
    }

    @MainActor
    func testDieAntwortMitObjektIstEinJsObjekt() {
        XCTAssertEqual(
            Bruecke.replyScript(
                Brueckenantwort(id: 1, fehler: nil, wert: .objekt(["b": "x\"y", "a": "1"]))),
            #"window.__LIFELINE_REPLY__?.(1, null, {"a":"1","b":"x\"y"});"#)
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
    var registrierungen = 0
    var abmeldungen = 0
    var kennung: String?
    var registrierungFehler: PushFehler?

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

    func registerPush() async throws -> PushRegistrierung {
        if let fehler = registrierungFehler { throw fehler }
        registrierungen += 1
        return PushRegistrierung(
            kennung: "kennung-1", token: "abcd", umgebung: "sandbox", schluessel: "schluessel-1")
    }

    func unregisterPush() async throws { abmeldungen += 1 }

    func pushState() async -> (Meldungsfreigabe, kennung: String?) { (freigabe, kennung) }
}