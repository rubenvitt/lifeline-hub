import XCTest

@testable import LifelineKern

/// Dialoge der Seite (`alert`, `confirm`, `prompt`) als native Dialoge (tasks.md 8.13): Art,
/// Titel aus der Origin des auslösenden Frames, Antwortwerte an die Seite.
final class SeitendialogTests: XCTestCase {
    let elw = SeitenOrigin(schema: "https", host: "elw.local", port: 8443)

    func testDieArtFolgtDemAufruf() {
        XCTAssertEqual(Seitendialog(art: .hinweis, nachricht: "Gespeichert", origin: elw).art, .hinweis)
        XCTAssertEqual(
            Seitendialog(art: .rueckfrage, nachricht: "Löschen?", origin: elw).art, .rueckfrage)
        XCTAssertEqual(
            Seitendialog(art: .eingabe(vorgabe: "ELW"), nachricht: "Name?", origin: elw).art,
            .eingabe(vorgabe: "ELW"))
    }

    func testDieNachrichtBleibtWieDieSeiteSieSchickt() {
        let dialog = Seitendialog(art: .rueckfrage, nachricht: "Tier „Rex“ löschen?\nNicht rückgängig.", origin: elw)
        XCTAssertEqual(dialog.nachricht, "Tier „Rex“ löschen?\nNicht rückgängig.")
    }

    func testEineUeberlangeNachrichtWirdGekuerzt() {
        let lang = String(repeating: "a", count: Seitendialog.maxZeichen + 50)
        let dialog = Seitendialog(art: .hinweis, nachricht: lang, origin: elw)
        XCTAssertEqual(dialog.nachricht.count, Seitendialog.maxZeichen + 1)
        XCTAssertTrue(dialog.nachricht.hasSuffix("…"))
        let genau = String(repeating: "b", count: Seitendialog.maxZeichen)
        XCTAssertEqual(Seitendialog(art: .hinweis, nachricht: genau, origin: elw).nachricht, genau)
    }

    // MARK: Titel

    /// Der Titel nennt, wer fragt: der Host des auslösenden Frames, mit Port, wenn er nicht der
    /// Standardport ist. Ein Identitätsanbieter oder ein eingebetteter Fremdinhalt fragt also
    /// unter seinem eigenen Namen, nie unter dem des Servers.
    func testDerTitelIstDerHostDesFrames() {
        let faelle: [(SeitenOrigin, String)] = [
            (elw, "elw.local:8443"),
            (SeitenOrigin(schema: "https", host: "lager.example", port: 0), "lager.example"),
            (SeitenOrigin(schema: "https", host: "lager.example", port: 443), "lager.example"),
            (SeitenOrigin(schema: "https", host: "IdP.Example", port: 0), "idp.example"),
            (SeitenOrigin(schema: "http", host: "idp.example", port: 80), "http://idp.example"),
            (SeitenOrigin(schema: "http", host: "idp.example", port: 8080), "http://idp.example:8080"),
        ]
        for (origin, titel) in faelle {
            XCTAssertEqual(Seitendialog.titel(origin: origin), titel, "\(origin)")
            XCTAssertEqual(
                Seitendialog(art: .hinweis, nachricht: "x", origin: origin).titel, titel, "\(origin)")
        }
    }

    func testOhneHostHeisstDerTitelDieseSeite() {
        for origin in [
            SeitenOrigin(schema: "file", host: "", port: 0),
            SeitenOrigin(schema: "", host: "", port: 0),
            SeitenOrigin(schema: "about", host: "  ", port: 0),
        ] {
            XCTAssertEqual(Seitendialog.titel(origin: origin), Seitendialog.ohneHost, "\(origin)")
        }
    }

    // MARK: Knöpfe und Feld

    func testNurDerHinweisHatKeinenAbbrechenKnopf() {
        XCTAssertNil(Seitendialog(art: .hinweis, nachricht: "x", origin: elw).abbrechenTitel)
        XCTAssertEqual(
            Seitendialog(art: .rueckfrage, nachricht: "x", origin: elw).abbrechenTitel, "Abbrechen")
        XCTAssertEqual(
            Seitendialog(art: .eingabe(vorgabe: nil), nachricht: "x", origin: elw).abbrechenTitel,
            "Abbrechen")
        XCTAssertEqual(Seitendialog.okTitel, "OK")
    }

    func testNurDieEingabeHatEinFeldMitVorgabe() {
        XCTAssertFalse(Seitendialog(art: .hinweis, nachricht: "x", origin: elw).hasFeld)
        XCTAssertFalse(Seitendialog(art: .rueckfrage, nachricht: "x", origin: elw).hasFeld)
        let eingabe = Seitendialog(art: .eingabe(vorgabe: "ELW 1"), nachricht: "x", origin: elw)
        XCTAssertTrue(eingabe.hasFeld)
        XCTAssertEqual(eingabe.feldVorgabe, "ELW 1")
        XCTAssertEqual(Seitendialog(art: .eingabe(vorgabe: nil), nachricht: "x", origin: elw).feldVorgabe, "")
    }

    // MARK: Antworten an die Seite

    /// `nil` heißt: kein Dialog gezeigt (kein Fenster, schon ein Dialog offen). Dann lehnt die
    /// Seite ab, wie bei „Abbrechen“.
    func testConfirmIstNurNachOkWahr() {
        XCTAssertTrue(Seitendialog.confirmWert(.ok(text: nil)))
        XCTAssertTrue(Seitendialog.confirmWert(.ok(text: "egal")))
        XCTAssertFalse(Seitendialog.confirmWert(.abgebrochen))
        XCTAssertFalse(Seitendialog.confirmWert(nil))
    }

    func testPromptLiefertDenTextOderNichts() {
        XCTAssertEqual(Seitendialog.promptWert(.ok(text: "Rex")), "Rex")
        XCTAssertEqual(Seitendialog.promptWert(.ok(text: "")), "")
        // Ein leeres Feld ohne Text gibt wie im Browser die leere Zeichenkette, nicht `null`.
        XCTAssertEqual(Seitendialog.promptWert(.ok(text: nil)), "")
        XCTAssertNil(Seitendialog.promptWert(.abgebrochen))
        XCTAssertNil(Seitendialog.promptWert(nil))
    }

    func testDieBeispielseiteDerUiTestsLoestEineRueckfrageAus() {
        let seite = Testzustand.beispielseite
        XCTAssertTrue(seite.contains("id=\"rueckfrage\""), seite)
        XCTAssertTrue(seite.contains("confirm("), seite)
        XCTAssertTrue(seite.contains("id=\"antwort\""), seite)
    }
}
