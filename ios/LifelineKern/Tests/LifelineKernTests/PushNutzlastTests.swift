import XCTest

@testable import LifelineKern

/// Umschlag und Klartext der Push-Nutzlast (Entwurf „iOS-Alarme über APNs“). Die Entschlüsselung
/// selbst gehört nicht in den Kern (kein CryptoKit unter Linux).
final class PushNutzlastTests: XCTestCase {
    private struct Fall: Decodable {
        let beschreibung: String
        let kennung: String
        let nonce: String
        let chiffrat: String
        let umschlag: String
    }

    private struct Faelle: Decodable { let faelle: [Fall] }

    func testUmschlagLiestKennungNonceChiffrat() throws {
        let faelle = try GemeinsameFaelle.load("push-nutzlast.json", as: Faelle.self).faelle
        XCTAssertFalse(faelle.isEmpty)
        for fall in faelle {
            let umschlag = try XCTUnwrap(PushNutzlast.umschlag(fall.umschlag), fall.beschreibung)
            XCTAssertEqual(umschlag.kennung, fall.kennung, fall.beschreibung)
            XCTAssertEqual(umschlag.nonce, try XCTUnwrap(Base64URL.decode(fall.nonce)), fall.beschreibung)
            XCTAssertEqual(umschlag.nonce.count, 12)
            XCTAssertEqual(
                umschlag.chiffrat, try XCTUnwrap(Base64URL.decode(fall.chiffrat)), fall.beschreibung)
        }
    }

    func testKaputterUmschlagGibtNil() {
        for l in ["", "!!!", "e30", "eyJrIjoiYSJ9", Base64URL.encode(Data("kein json".utf8))] {
            XCTAssertNil(PushNutzlast.umschlag(l), l)
        }
    }

    private func klartext(_ felder: [String: Any]) -> Data {
        // Fester Rahmen wie `ios_push::inhalt::Klartext`.
        var alle: [String: Any] = ["v": 1, "s": "Kreis Nord", "e": 42, "b": 7, "stufe": "alarm"]
        alle.merge(felder) { _, neu in neu }
        return try! JSONSerialization.data(withJSONObject: alle)
    }

    func testMeldungOhneAbsenderTraegtTitelDetailUndPfad() throws {
        let m = try XCTUnwrap(
            PushNutzlast.meldung(
                aus: klartext(["titel": "Alarm", "detail": "ELW 1", "pfad": "/einsaetze/42"]),
                serverAnzahl: 1))
        XCTAssertEqual(m.titel, "Alarm")
        XCTAssertEqual(m.text, "ELW 1")
        XCTAssertEqual(m.pfad, "/einsaetze/42")
        XCTAssertEqual(m.einsatzId, 42)
        XCTAssertNil(m.untertitel)
    }

    func testMeldungTraegtAbsenderImTitel() throws {
        let m = try XCTUnwrap(
            PushNutzlast.meldung(
                aus: klartext([
                    "titel": "Sofortmeldung", "detail": "Detail", "absender": "Funk 3",
                    "wortlaut": "Person vermisst",
                ]), serverAnzahl: 1))
        XCTAssertEqual(m.titel, "Sofortmeldung · Funk 3")
        // Der Wortlaut geht vor dem Detail.
        XCTAssertEqual(m.text, "Person vermisst")
    }

    func testLeereFelderZaehlenAlsFehlend() throws {
        let m = try XCTUnwrap(
            PushNutzlast.meldung(
                aus: klartext(["titel": "Hinweis", "absender": "  ", "wortlaut": "", "detail": " "]),
                serverAnzahl: 1))
        XCTAssertEqual(m.titel, "Hinweis")
        XCTAssertNil(m.text)
    }

    func testUntertitelNurBeiMehrerenServern() throws {
        let daten = klartext(["titel": "Alarm"])
        XCTAssertNil(PushNutzlast.meldung(aus: daten, serverAnzahl: 1)?.untertitel)
        XCTAssertEqual(PushNutzlast.meldung(aus: daten, serverAnzahl: 2)?.untertitel, "Kreis Nord")
    }

    func testThreadTraegtKennungUndEinsatz() throws {
        let daten = klartext(["titel": "Alarm"])
        XCTAssertEqual(
            PushNutzlast.meldung(aus: daten, serverAnzahl: 1, kennung: "k-1")?.thread, "k-1-42")
    }

    func testFehlenderPfadFaelltAufDenEinsatzZurueck() throws {
        let m = try XCTUnwrap(PushNutzlast.meldung(aus: klartext(["titel": "Alarm"]), serverAnzahl: 1))
        XCTAssertEqual(m.pfad, "/einsaetze/42")
    }

    func testKaputterKlartextGibtNil() {
        XCTAssertNil(PushNutzlast.meldung(aus: Data("kein json".utf8), serverAnzahl: 1))
        XCTAssertNil(PushNutzlast.meldung(aus: Data("[1]".utf8), serverAnzahl: 1))
        XCTAssertNil(PushNutzlast.meldung(aus: Data("{\"titel\":\"x\"}".utf8), serverAnzahl: 1))
        XCTAssertNil(PushNutzlast.meldung(aus: Data("{\"e\":1}".utf8), serverAnzahl: 1))
    }
}
