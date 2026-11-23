import Foundation
import XCTest

@testable import LifelineKern

/// „Im Browser anmelden“ in der iOS-Hülle (Spec `ios-huelle`, „Die App meldet sich im
/// Systembrowser an“; Vorbild `src-tauri/src/pkce.rs` und `src-tauri/src/anmeldung.rs`, deren
/// Testvektoren hier wiederkehren).
final class AnmeldungTests: XCTestCase {
    let code = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    let server = try! ServerAdresse.parse("https://elw.local:8443")

    // MARK: PKCE

    func testChallengeNachRfc7636AnhangB() {
        XCTAssertEqual(
            PKCE.challenge(aus: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testSha256NachDenNistVektoren() {
        let hex = { (daten: [UInt8]) in daten.map { String(format: "%02x", $0) }.joined() }
        XCTAssertEqual(
            hex(SHA256.hash(Array("".utf8))),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(
            hex(SHA256.hash(Array("abc".utf8))),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        // Zwei Blöcke (56 Byte: die Länge passt nicht mehr in den ersten Block).
        XCTAssertEqual(
            hex(SHA256.hash(Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8))),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        XCTAssertEqual(
            hex(SHA256.hash(Array(repeating: UInt8(ascii: "a"), count: 1_000))),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3")
    }

    func testVerifierHat43Base64urlZeichenUndIstJedesMalNeu() {
        let a = PKCE.neuerVerifier()
        let b = PKCE.neuerVerifier()
        XCTAssertEqual(a.count, 43)
        XCTAssertTrue(a.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }, a)
        XCTAssertNotEqual(a, b)
        XCTAssertEqual(PKCE.challenge(aus: a).count, 43)
    }

    func testBase64urlOhneAuffuellung() {
        XCTAssertEqual(PKCE.base64url([0xfb, 0xff]), "-_8")
        XCTAssertEqual(PKCE.base64url([]), "")
    }

    // MARK: Adressen

    func testBestaetigungLiegtAufDerOriginDesServers() {
        XCTAssertEqual(
            Anmeldung.bestaetigungURL(
                server: server, challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
            ).absoluteString,
            "https://elw.local:8443/app-anmeldung?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let ohnePort = try! ServerAdresse.parse("https://lager.example")
        XCTAssertEqual(
            Anmeldung.bestaetigungURL(server: ohnePort, challenge: "x").absoluteString,
            "https://lager.example/app-anmeldung?challenge=x")
    }

    func testCodeNurAusDemAnmeldeRuecksprung() {
        XCTAssertEqual(Anmeldung.code(ausRuecksprung: "lifeline://anmeldung?code=\(code)"), code)
        for fremd in [
            "lifeline://verbinden?code=\(code)",
            "andere://anmeldung?code=\(code)",
            "lifeline://anmeldung/x?code=\(code)",
            "lifeline://anmeldung?code=abc",
            "lifeline://anmeldung?code=\(code.uppercased())",
            "lifeline://anmeldung",
            "kein link",
        ] {
            XCTAssertNil(Anmeldung.code(ausRuecksprung: fremd), fremd)
        }
    }

    /// Ein `lifeline://anmeldung?code=…` von außen (`onOpenURL`) ist kein Deeplink: die App
    /// verbindet nichts und löst nichts ein (Spec: „Untergeschobener Rücksprung“).
    func testRuecksprungVonAussenIstKeinDeeplink() {
        XCTAssertNil(Deeplink.parse("lifeline://anmeldung?code=\(code)"))
        XCTAssertNil(Deeplink.parse("lifeline://anmeldung?code=\(code)&server=https://elw.local:8443"))
    }

    // MARK: Ende der Sitzung

    func testFolgeNachDemEndeDerSitzung() {
        let seite = URL(string: "https://elw.local:8443/login")!
        let fremd = URL(string: "https://id.rubeen.dev/login")!
        let andereSeite = URL(string: "https://elw.local:8443/einsaetze")!
        let ruecksprung = "lifeline://anmeldung?code=\(code)"

        XCTAssertEqual(Anmeldung.folge(.ruecksprung(ruecksprung), seite: seite, server: server), .einloesen(code))
        XCTAssertEqual(Anmeldung.folge(.ruecksprung(ruecksprung), seite: fremd, server: server), .nichts)
        XCTAssertEqual(Anmeldung.folge(.ruecksprung(ruecksprung), seite: nil, server: server), .nichts)
        // Eingelöst wird nur auf der Anmeldeseite.
        XCTAssertEqual(Anmeldung.folge(.ruecksprung(ruecksprung), seite: andereSeite, server: server), .nichts)
        XCTAssertEqual(Anmeldung.folge(.abgebrochen, seite: fremd, server: server), .nichts)
        XCTAssertEqual(Anmeldung.folge(.fehler, seite: nil, server: server), .nichts)
        XCTAssertEqual(
            Anmeldung.folge(.ruecksprung("lifeline://anmeldung?code=kaputt"), seite: seite, server: server),
            .melden(.fehler))
        XCTAssertEqual(Anmeldung.folge(.abgebrochen, seite: seite, server: server), .melden(.abgebrochen))
        XCTAssertEqual(Anmeldung.folge(.fehler, seite: andereSeite, server: server), .melden(.fehler))
    }

    func testErgebnisseTragenDieKennwoerterDerSeite() {
        // frontend/src/huelle/faehigkeiten.ts, `AppAnmeldungErgebnis`
        XCTAssertEqual(
            Anmeldung.Ergebnis.allCases.map(\.rawValue), ["angemeldet", "abgelehnt", "fehler", "abgebrochen"])
        XCTAssertEqual(Anmeldung.ereignis, "lifeline:app-anmeldung")
    }

    // MARK: Skripte

    func testEinloeseSkriptKodiertUndPrueftDieOrigin() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let skript = Anmeldung.einloeseSkript(server: server, code: code, verifier: verifier)
        XCTAssertTrue(skript.contains(#"window.location.origin !== "https:\/\/elw.local:8443""#), skript)
        XCTAssertTrue(skript.contains("'/api/auth/app-code/redeem'"), skript)
        XCTAssertTrue(skript.contains(#"code: "\#(code)""#), skript)
        XCTAssertTrue(skript.contains(#"verifier: "\#(verifier)""#), skript)
        XCTAssertEqual(skript.components(separatedBy: code).count - 1, 1)
        XCTAssertEqual(skript.components(separatedBy: verifier).count - 1, 1)
        XCTAssertTrue(skript.contains(#""lifeline:app-anmeldung""#), skript)
        XCTAssertFalse(skript.contains("\n"), skript)
        // Endet auf einem Wert: `evaluateJavaScript` wirft bei einem Promise-Ergebnis.
        XCTAssertTrue(skript.hasSuffix("0;"), skript)
    }

    func testLiteraleBrechenNichtAus() {
        let skript = Anmeldung.einloeseSkript(server: server, code: "a\"b'c\\d", verifier: "x\"); alert(1); (\"")
        XCTAssertTrue(skript.contains(#"code: "a\"b'c\\d""#), skript)
        XCTAssertFalse(skript.contains(#"x"); alert"#), skript)
    }

    func testMeldungTraegtNurDasErgebnis() {
        let skript = Anmeldung.meldungSkript(.abgebrochen)
        XCTAssertTrue(skript.contains(#""lifeline:app-anmeldung""#), skript)
        XCTAssertTrue(skript.contains(#"ergebnis: "abgebrochen""#), skript)
        XCTAssertFalse(skript.contains("fetch"))
    }

    // MARK: Lauf

    func testEinAlterHandlerBeendetDieNeueSitzungNicht() {
        var lauf = Anmeldelauf<String>()
        let alt = lauf.naechste()
        lauf.merke(alt, "alt")
        XCTAssertEqual(lauf.nimm(), "alt")
        let neu = lauf.naechste()
        lauf.merke(neu, "neu")
        XCTAssertNil(lauf.beende(alt))
        XCTAssertEqual(lauf.beende(neu), "neu")
        XCTAssertNil(lauf.beende(neu))
    }

    /// Ob eine Sitzung läuft, fragt der Ablauf bei der Rückkehr in den Vordergrund.
    func testLaufendGiltVomMerkenBisZumEnde() {
        var lauf = Anmeldelauf<String>()
        XCTAssertFalse(lauf.isLaufend)
        let generation = lauf.naechste()
        XCTAssertFalse(lauf.isLaufend)
        lauf.merke(generation, "a")
        XCTAssertTrue(lauf.isLaufend)
        _ = lauf.beende(generation)
        XCTAssertFalse(lauf.isLaufend)
        lauf.merke(lauf.naechste(), "b")
        _ = lauf.nimm()
        XCTAssertFalse(lauf.isLaufend)
    }
}
