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

    func testStandortbefehleWerdenGelesen() {
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 3, "high_accuracy": true, "timeout": 15000]),
            .locationCurrent(id: 3, highAccuracy: true, timeout: .milliseconds(15000)))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 4]),
            .locationCurrent(id: 4, highAccuracy: false, timeout: nil))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 5, "high_accuracy": false, "timeout": NSNull()]),
            .locationCurrent(id: 5, highAccuracy: false, timeout: nil))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_watch", "id": 6, "high_accuracy": true, "timeout": 2500.0]),
            .locationWatch(id: 6, highAccuracy: true, timeout: .milliseconds(2500)))
        XCTAssertEqual(Bruecke.parse(["cmd": "location_clear", "watch": 6]), .locationClear(watch: 6))
    }

    /// Unter Darwin gelingt der Cast von `NSNumber(0)`/`NSNumber(1)` nach `Bool`; eine Frist von
    /// 0 oder 1 ms ist trotzdem eine Zahl, nur ein echter Wahrheitswert nicht (LLH-2082).
    func testEineFristVon0Oder1MsIstEineZahlKeinWahrheitswert() {
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 1, "timeout": NSNumber(value: 0)]),
            .locationCurrent(id: 1, highAccuracy: false, timeout: .milliseconds(0)))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_watch", "id": 2, "timeout": NSNumber(value: 1)]),
            .locationWatch(id: 2, highAccuracy: false, timeout: .milliseconds(1)))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 3, "timeout": NSNumber(value: 2.5)]),
            .locationCurrent(id: 3, highAccuracy: false, timeout: .milliseconds(3)))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 4, "timeout": true]),
            .ungueltig(id: 4, grund: "Die Frist muss eine Zahl ab 0 sein."))
        #if canImport(Darwin)
            // So kommt ein JS-Wahrheitswert aus dem WKWebView an (`CFBoolean`).
            XCTAssertEqual(
                Bruecke.parse(["cmd": "location_current", "id": 5, "timeout": NSNumber(value: false)]),
                .ungueltig(id: 5, grund: "Die Frist muss eine Zahl ab 0 sein."))
        #endif
    }

    func testFehlerhafteStandortbefehle() {
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_current", "id": 1, "timeout": -1]),
            .ungueltig(id: 1, grund: "Die Frist muss eine Zahl ab 0 sein."))
        XCTAssertEqual(
            Bruecke.parse(["cmd": "location_watch", "id": 2, "timeout": "15000"]),
            .ungueltig(id: 2, grund: "Die Frist muss eine Zahl ab 0 sein."))
        // Ohne Beobachtung oder ohne id gibt es niemanden, dem die Hülle antworten könnte.
        XCTAssertNil(Bruecke.parse(["cmd": "location_clear"]))
        XCTAssertNil(Bruecke.parse(["cmd": "location_watch"]))
    }

    func testDieStandortmeldungRuftLifelineLocationAuf() {
        let position = Standortposition(
            latitude: 52.1, longitude: 9.9, accuracy: 12, altitude: nil, altitudeAccuracy: nil,
            heading: nil, speed: 1.5, timestamp: 1_700_000_000_000)
        let objekt =
            #"{"accuracy":12.0,"altitude":null,"altitude_accuracy":null,"heading":null,"#
            + #""latitude":52.1,"longitude":9.9,"speed":1.5,"timestamp":1700000000000}"#
        XCTAssertEqual(
            Bruecke.locationScript(id: 7, fehler: nil, position: position),
            "window.__LIFELINE_LOCATION__?.(7, null, \(objekt));")
        XCTAssertEqual(
            Bruecke.locationScript(id: 7, fehler: .denied, position: nil),
            #"window.__LIFELINE_LOCATION__?.(7, "denied", null);"#)
        XCTAssertEqual(
            Bruecke.replyScript(Brueckenantwort(id: 2, fehler: nil, wert: .position(position))),
            "window.__LIFELINE_REPLY__?.(2, null, \(objekt));")
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

    // MARK: Standort (LLH-2071)

    @MainActor
    func testDerErsteStandortFragtErstUndHoltDannDiePosition() async {
        let dienste = Dienste()
        dienste.standortfreigabe = .offen
        dienste.standortErteilt = true
        let antwort = await Brueckenausfuehrung.run(
            .locationCurrent(id: 1, highAccuracy: true, timeout: .seconds(15)), dienste: dienste)
        XCTAssertEqual(antwort, Brueckenantwort(id: 1, fehler: nil, wert: .position(Dienste.position)))
        // Die Frist zählt erst nach der Freigabe: die Position wird erst danach geholt.
        XCTAssertEqual(dienste.standortprotokoll, ["frage", "position(true, \(Duration.seconds(15)))"])
    }

    @MainActor
    func testVerweigerterStandortMeldetDeniedOhnePosition() async {
        let dienste = Dienste()
        dienste.standortfreigabe = .offen
        dienste.standortErteilt = false
        let a = await Brueckenausfuehrung.run(
            .locationCurrent(id: 2, highAccuracy: false, timeout: nil), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 2, fehler: "denied", wert: .null))
        dienste.standortfreigabe = .verweigert
        let b = await Brueckenausfuehrung.run(
            .locationCurrent(id: 3, highAccuracy: false, timeout: nil), dienste: dienste)
        XCTAssertEqual(b, Brueckenantwort(id: 3, fehler: "denied", wert: .null))
        XCTAssertEqual(dienste.standortprotokoll, ["frage"])
    }

    @MainActor
    func testOhneOrtungsdienstMeldetDieHuelleUnavailable() async {
        let dienste = Dienste()
        dienste.standortfreigabe = .aus
        let a = await Brueckenausfuehrung.run(
            .locationCurrent(id: 4, highAccuracy: false, timeout: nil), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 4, fehler: "unavailable", wert: .null))
        XCTAssertEqual(dienste.standortprotokoll, [])
    }

    @MainActor
    func testEinFehlerDerOrtungGehtMitSeinemCodeAnDieSeite() async {
        let dienste = Dienste()
        dienste.positionsfehler = .timeout
        let a = await Brueckenausfuehrung.run(
            .locationCurrent(id: 5, highAccuracy: false, timeout: .seconds(1)), dienste: dienste)
        XCTAssertEqual(a, Brueckenantwort(id: 5, fehler: "timeout", wert: .null))
    }

    @MainActor
    func testBeobachtungenAntwortenNichtUeberDieBruecke() async {
        let dienste = Dienste()
        let a = await Brueckenausfuehrung.run(
            .locationWatch(id: 6, highAccuracy: false, timeout: nil), dienste: dienste)
        let b = await Brueckenausfuehrung.run(.locationClear(watch: 6), dienste: dienste)
        XCTAssertNil(a)
        XCTAssertNil(b)
        XCTAssertEqual(dienste.standortprotokoll, [])
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
    var standortfreigabe = Standortfreigabe.erlaubt
    var standortErteilt = true
    var positionsfehler: Standortfehler?
    var standortprotokoll: [String] = []

    static let position = Standortposition(
        latitude: 52.1, longitude: 9.9, accuracy: 12, altitude: nil, altitudeAccuracy: nil,
        heading: nil, speed: nil, timestamp: 1_700_000_000_000)

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

    func loadStandortfreigabe() async -> Standortfreigabe { standortfreigabe }

    func requestStandortfreigabe() async -> Bool {
        standortprotokoll.append("frage")
        return standortErteilt
    }

    func currentPosition(highAccuracy: Bool, timeout: Duration?) async throws -> Standortposition {
        standortprotokoll.append("position(\(highAccuracy), \(timeout.map { "\($0)" } ?? "nil"))")
        if let positionsfehler { throw positionsfehler }
        return Self.position
    }
}