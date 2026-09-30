//! Gemeinsames Fixture der Zählregeln (LFH-550): `tests/fixtures/verdichtung/regeln.json`.
//!
//! Dieselbe Datei liest `frontend/src/lage/verdichtungFixture.test.ts`. Wer eine Regel nur auf
//! einer Seite ändert, macht eine der beiden Suiten rot — das ersetzt die frühere Absprache per
//! Kommentar („wer eine ändert, ändert beide").

use lifeline_hub::auftrag::AuftragBearbeitungsstatus;
use lifeline_hub::einheit::repo::kumuliere;
use lifeline_hub::einsatz::zaehler::{
    zaehle_auftraege, zaehle_meldungen, AuftragsMerkmale, AuftragsZaehler, MeldungsMerkmale,
    MeldungsZaehler,
};
use lifeline_hub::meldung::MeldungStatus;
use lifeline_hub::staerke::Staerke;
use serde_json::Value;
use std::collections::HashMap;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/verdichtung/regeln.json"))
        .expect("regeln.json ist gültiges JSON")
}

fn zahl(v: &Value) -> i64 {
    v.as_i64().expect("Zahl")
}

fn flag(v: &Value, feld: &str) -> bool {
    v[feld]
        .as_bool()
        .unwrap_or_else(|| panic!("Flag {feld} fehlt: {v}"))
}

fn staerke(v: &Value) -> Staerke {
    let t: Vec<u16> = v
        .as_array()
        .expect("Stärke als [F, UF, M]")
        .iter()
        .map(|x| u16::try_from(zahl(x)).expect("u16"))
        .collect();
    Staerke::neu(t[0], t[1], t[2])
}

fn auftrag(f: &Value) -> AuftragsMerkmale {
    AuftragsMerkmale {
        bearbeitungsstatus: AuftragBearbeitungsstatus::parse(
            f["bearbeitungsstatus"].as_str().unwrap(),
        )
        .expect("bekannter Bearbeitungsstatus"),
        ist_ueberfaellig: flag(f, "ist_ueberfaellig"),
    }
}

fn meldung(f: &Value) -> MeldungsMerkmale {
    MeldungsMerkmale {
        status: MeldungStatus::parse(f["status"].as_str().unwrap()).expect("bekannter Status"),
        ist_offen: flag(f, "ist_offen"),
        bestaetigung_pflicht: flag(f, "bestaetigung_pflicht"),
        ist_bestaetigt: flag(f, "ist_bestaetigt"),
        ist_ueberfaellig: flag(f, "ist_ueberfaellig"),
        eskaliert: flag(f, "eskaliert"),
    }
}

#[test]
fn auftraege_zaehlen_wie_das_fixture() {
    let fx = fixture();
    let faelle = fx["auftraege"]["faelle"].as_array().unwrap();

    // Je Fall: allein gezählt, trägt er genau seine erwarteten Flags bei.
    for f in faelle {
        let z = zaehle_auftraege(&[auftrag(f)]);
        let name = f["name"].as_str().unwrap();
        assert_eq!(z.offen == 1, flag(f, "offen"), "offen: {name}");
        assert_eq!(
            z.ueberfaellig == 1,
            flag(f, "ueberfaellig"),
            "überfällig: {name}"
        );
    }

    let merkmale: Vec<_> = faelle.iter().map(auftrag).collect();
    let e = &fx["auftraege"]["erwartet"];
    assert_eq!(
        zaehle_auftraege(&merkmale),
        AuftragsZaehler {
            offen: zahl(&e["offen"]),
            in_arbeit: zahl(&e["in_arbeit"]),
            ueberfaellig: zahl(&e["ueberfaellig"]),
        }
    );
}

#[test]
fn meldungen_zaehlen_wie_das_fixture() {
    let fx = fixture();
    let faelle = fx["meldungen"]["faelle"].as_array().unwrap();

    for f in faelle {
        let z = zaehle_meldungen(&[meldung(f)]);
        let name = f["name"].as_str().unwrap();
        assert_eq!(
            z.bestaetigung_ueberfaellig == 1,
            flag(f, "bestaetigung_ueberfaellig"),
            "Bestätigung überfällig: {name}"
        );
    }

    let merkmale: Vec<_> = faelle.iter().map(meldung).collect();
    let e = &fx["meldungen"]["erwartet"];
    assert_eq!(
        zaehle_meldungen(&merkmale),
        MeldungsZaehler {
            offen: zahl(&e["offen"]),
            ungesehen: zahl(&e["ungesehen"]),
            bestaetigung_ueberfaellig: zahl(&e["bestaetigung_ueberfaellig"]),
        }
    );
}

#[test]
fn ist_kumuliert_wie_das_fixture() {
    let fx = fixture();
    let s = &fx["staerke"];
    let mut eigene = HashMap::new();
    let mut kinder: HashMap<i64, Vec<i64>> = HashMap::new();
    for e in s["einheiten"].as_array().unwrap() {
        let id = zahl(&e["id"]);
        eigene.insert(id, staerke(&e["eigene"]));
        if let Some(vater) = e["ueber_einheit_id"].as_i64() {
            kinder.entry(vater).or_default().push(id);
        }
    }
    let erwartet = s["erwartet_ist_kumuliert"].as_object().unwrap();
    assert_eq!(
        erwartet.len(),
        eigene.len(),
        "jede Einheit hat eine Erwartung"
    );
    for (id, soll) in erwartet {
        let id: i64 = id.parse().unwrap();
        assert_eq!(
            kumuliere(&eigene, &kinder, id),
            staerke(soll),
            "ist_kumuliert der Einheit {id}"
        );
    }
}
