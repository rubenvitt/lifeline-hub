//! Gemeinsames Fixture der Zählregeln (LFH-550): `tests/fixtures/verdichtung/regeln.json`.
//!
//! Dieselbe Datei liest `frontend/src/lage/verdichtungFixture.test.ts`. Wer eine Regel nur auf
//! einer Seite ändert, macht eine der beiden Suiten rot — das ersetzt die frühere Absprache per
//! Kommentar („wer eine ändert, ändert beide").

use lifeline_hub::auftrag::AuftragBearbeitungsstatus;
use lifeline_hub::einheit::repo::kumuliere;
use lifeline_hub::einsatz::ausfall::{
    einheiten_mit_ausfall, AusfallEingabe, EinheitMerkmale, FahrzeugMerkmale, MaterialMerkmale,
    MittelMerkmale,
};
use lifeline_hub::einsatz::zaehler::{
    count_kraefte, zaehle_auftraege, zaehle_meldungen, zaehle_nachforderungen, AuftragsMerkmale,
    AuftragsZaehler, KraefteZaehler, KraftMerkmale, MeldungsMerkmale, MeldungsZaehler,
    NachforderungsMerkmale, NachforderungsZaehler,
};
use lifeline_hub::entlassung::BeendetAls;
use lifeline_hub::katalog::StatusKategorie;
use lifeline_hub::kommunikation::Prioritaet;
use lifeline_hub::material::{ort::MaterialOrt, MaterialArt, MaterialStatus};
use lifeline_hub::meldung::{ist_sofort, MeldungStatus, Meldungsart};
use lifeline_hub::nachforderung::NachforderungStatus;
use lifeline_hub::person::{
    versorgung_von, zaehle_lage_sichtung, PersonStatus, Sichtungskategorie, TransportDurch,
    VerbleibArt, VerbleibStatus, Versorgung,
};
use lifeline_hub::staerke::{Staerke, StaerkePosition};
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
        ist_sofort: ist_sofort(
            Meldungsart::parse(f["meldungsart"].as_str().unwrap()).expect("bekannte Art"),
            Prioritaet::parse(f["prioritaet"].as_str().unwrap()).expect("bekannte Priorität"),
        ),
        ist_dringend: f["prioritaet"] == "dringend",
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
        assert_eq!(
            z.sofort_offen == 1,
            flag(f, "sofort_offen"),
            "Sofort offen: {name}"
        );
        assert_eq!(
            z.dringend_offen == 1,
            flag(f, "dringend_offen"),
            "Dringend offen: {name}"
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
            sofort_offen: zahl(&e["sofort_offen"]),
            dringend_offen: zahl(&e["dringend_offen"]),
            sofort_aelteste_at: None,
        }
    );
}

/// Modulzähler `nachforderungen` (LLH-1078, „überfällig“ LLH-1145): dieselben Fälle zählt das
/// Board im Browser (`nachforderungen/nachforderungStufen.ts:zaehleNachforderungen`). Das Flag
/// `ist_ueberfaellig` liefert im Server das SQL-Fragment (`tests/modul_zaehler.rs` prüft es gegen
/// die Liste); der Browser rechnet es aus `eintreffen_erwartet_at` und `jetzt` nach.
#[test]
fn nachforderungen_zaehlen_wie_das_fixture() {
    let fx = fixture();
    let faelle = fx["nachforderungen"]["faelle"].as_array().unwrap();
    let merkmale = |f: &Value| NachforderungsMerkmale {
        status: NachforderungStatus::parse(f["status"].as_str().unwrap())
            .expect("bekannter Status"),
        ist_ueberfaellig: flag(f, "ist_ueberfaellig"),
    };

    // Je Fall: allein gezählt, ist er genau dann offen, wenn das Fixture es sagt.
    for f in faelle {
        let z = zaehle_nachforderungen(&[merkmale(f)]);
        let name = f["name"].as_str().unwrap();
        assert_eq!(z.offen == 1, flag(f, "offen"), "offen: {name}");
        assert_eq!(
            merkmale(f).status.ist_offen(),
            flag(f, "offen"),
            "ist_offen: {name}"
        );
        assert_eq!(
            z.ueberfaellig == 1,
            flag(f, "ist_ueberfaellig"),
            "überfällig: {name}"
        );
    }

    let alle: Vec<_> = faelle.iter().map(merkmale).collect();
    let e = &fx["nachforderungen"]["erwartet"];
    assert_eq!(
        zaehle_nachforderungen(&alle),
        NachforderungsZaehler {
            offen: zahl(&e["offen"]),
            angefordert: zahl(&e["angefordert"]),
            zugesagt: zahl(&e["zugesagt"]),
            unterwegs: zahl(&e["unterwegs"]),
            ueberfaellig: zahl(&e["ueberfaellig"]),
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

#[test]
fn kraefte_zaehlen_nur_aktive_wie_das_fixture() {
    let fx = fixture();
    let k = &fx["kraefte"];
    let merkmale: Vec<KraftMerkmale> = k["personal"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| KraftMerkmale {
            staerke_position: p["staerke_position"]
                .as_str()
                .map(|s| StaerkePosition::parse(s).expect("bekannte Position")),
            beendet: p["beendet_als"].as_str().is_some_and(|s| {
                BeendetAls::parse(s).expect("bekannter Endzustand");
                true
            }),
        })
        .collect();
    let e = &k["erwartet"];
    assert_eq!(
        count_kraefte(&merkmale),
        KraefteZaehler {
            personal: zahl(&e["personal"]),
            staerke: staerke(&e["staerke"]),
        }
    );
}

#[test]
fn versorgung_und_lagesichtung_wie_das_fixture() {
    let fx = fixture();
    let v = &fx["versorgung"];
    let mut zeilen = Vec::new();
    for f in v["faelle"].as_array().unwrap() {
        let art = f["art"]
            .as_str()
            .map(|s| VerbleibArt::parse(s).expect("bekannte Art"));
        let status = f["status"]
            .as_str()
            .map(|s| VerbleibStatus::parse(s).expect("bekannter Status"));
        let durch = f["durch"]
            .as_str()
            .map(|s| TransportDurch::parse(s).expect("bekannte Fahrer-Angabe"));
        let person = PersonStatus::parse(f["person_status"].as_str().unwrap_or("betroffen"))
            .expect("bekannter Personenstatus");
        let versorgung = versorgung_von(person, art, status, durch);
        assert_eq!(
            versorgung.as_str(),
            f["versorgung"].as_str().unwrap(),
            "Versorgung im Fall „{}“",
            f["name"]
        );
        let sichtung = f["sichtung"]
            .as_str()
            .map(|s| Sichtungskategorie::parse(s).expect("bekannte Sichtung"));
        zeilen.push((sichtung, versorgung));
    }
    let e = &v["erwartet"];
    let je = |z: Versorgung| zeilen.iter().filter(|(_, v)| *v == z).count() as i64;
    assert_eq!(je(Versorgung::Offen), zahl(&e["offen"]));
    assert_eq!(je(Versorgung::Unterwegs), zahl(&e["unterwegs"]));
    assert_eq!(je(Versorgung::Abgeschlossen), zahl(&e["abgeschlossen"]));
    let lage = zaehle_lage_sichtung(zeilen);
    assert_eq!(lage.patienten(), zahl(&e["patienten"]));
    assert_eq!(
        [lage.sk1, lage.sk2, lage.sk3, lage.sk4],
        [
            zahl(&e["sk1"]),
            zahl(&e["sk2"]),
            zahl(&e["sk3"]),
            zahl(&e["sk4"])
        ]
    );
}

fn kategorie(v: &Value) -> Option<StatusKategorie> {
    v["status_kategorie"]
        .as_str()
        .map(|s| StatusKategorie::parse(s).expect("bekannte Statuskategorie"))
}

fn id(v: &Value, feld: &str) -> Option<i64> {
    v[feld].as_i64()
}

/// Ausfall je Einheit (LLH-1929): dieselben Einheiten in derselben Folge wie der Browser
/// (`einheitenMitAusfall` über die Tönung des Meldebilds).
#[test]
fn ausfall_je_einheit_wie_das_fixture() {
    let fx = fixture();
    let faelle = fx["ausfall"]["faelle"].as_array().expect("Fälle");
    for a in faelle {
        ausfall_fall(a);
    }
}

fn ausfall_fall(a: &Value) {
    let liste = |feld: &str| a[feld].as_array().expect("Liste").clone();
    let eingabe = AusfallEingabe {
        einheiten: liste("einheiten")
            .iter()
            .map(|e| EinheitMerkmale {
                id: zahl(&e["id"]),
                name: e["name"].as_str().unwrap().to_string(),
                sortier: zahl(&e["sortier"]),
                aufgeloest: flag(e, "aufgeloest"),
                status_kategorie: kategorie(e),
            })
            .collect(),
        personal: liste("personal")
            .iter()
            .map(|p| MittelMerkmale {
                einheit_id: id(p, "einheit_id"),
                status_kategorie: kategorie(p),
                beendet: flag(p, "beendet"),
            })
            .collect(),
        fahrzeuge: liste("fahrzeuge")
            .iter()
            .map(|f| FahrzeugMerkmale {
                id: zahl(&f["id"]),
                mittel: MittelMerkmale {
                    einheit_id: id(f, "einheit_id"),
                    status_kategorie: kategorie(f),
                    beendet: flag(f, "beendet"),
                },
            })
            .collect(),
        material: liste("material")
            .iter()
            .map(|m| MaterialMerkmale {
                ort: MaterialOrt::aus_spalten(
                    id(m, "einheit_id"),
                    id(m, "einsatz_fahrzeug_id"),
                    id(m, "uhs_id"),
                    id(m, "br_id"),
                ),
                status: MaterialStatus::parse(m["status"].as_str().unwrap())
                    .expect("bekannter Materialstatus"),
                art: MaterialArt::parse(m["art"].as_str().unwrap()).expect("bekannte Materialart"),
                menge: zahl(&m["menge"]),
                ausgegeben: zahl(&m["ausgegeben"]),
                beendet: flag(m, "beendet"),
            })
            .collect(),
    };
    let erwartet: Vec<String> = a["erwartet"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        einheiten_mit_ausfall(&eingabe),
        erwartet,
        "Fall „{}“",
        a["name"]
    );
}
