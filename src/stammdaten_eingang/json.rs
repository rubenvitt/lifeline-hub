//! JSON → [`StammdatenPaket`] (Vertrag „Stammdaten-Abruf“, `docs/schnittstellen/stammdaten-abruf.md`).
//!
//! Das JSON-Gegenstück der Stammdaten-Datei (LLH-1194): ein Objekt mit den Listen `fahrzeuge`,
//! `personal` und `qualifikationen`. Ein mangelhafter Eintrag fehlt im Paket und kommt als Meldung,
//! wie eine Zeile der Datei; nur eine Antwort, die als Ganzes nicht passt, ist ein [`JsonFehler`].
//! Felder, die der Vertrag nicht kennt, werden nur mit ihrem Namen gemeldet, nie mit Werten.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::abloesung::schichtplan::uebernahme::{MeldungStufe, HERKUNFT_MAX, KENNUNG_MAX};
use crate::einlesen::tabelle::ZEILEN_MAX;

use super::{
    DateiMeldung, FahrzeugAngabe, Herkunftsangabe, PersonalAngabe, QualifikationAngabe,
    StammdatenArt, StammdatenPaket,
};

/// Höchstgröße des Körpers, wie bei der Datei.
pub const KOERPER_MAX: usize = 2 * 1024 * 1024;

/// Eine Antwort, die als Ganzes nicht passt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonFehler {
    KeinJson,
    KeinObjekt,
    ZuGross,
    ZuVieleEintraege { art: StammdatenArt },
}

type Gelesen = (StammdatenPaket, Vec<DateiMeldung>, Vec<String>);

fn schluessel(art: StammdatenArt) -> &'static str {
    match art {
        StammdatenArt::Fahrzeug => "fahrzeuge",
        StammdatenArt::Personal => "personal",
        StammdatenArt::Qualifikation => "qualifikationen",
    }
}

fn bekannt(art: StammdatenArt) -> &'static [&'static str] {
    match art {
        StammdatenArt::Fahrzeug => &[
            "kennung",
            "herkunft",
            "funkrufname",
            "kennzeichen",
            "opta",
            "issi",
            "typ",
            "standort",
        ],
        StammdatenArt::Personal => &[
            "kennung",
            "herkunft",
            "name",
            "personalnummer",
            "telefon",
            "traegerorganisation",
            "qualifikationen",
        ],
        StammdatenArt::Qualifikation => &["kennung", "herkunft", "bezeichnung"],
    }
}

fn pflicht(art: StammdatenArt) -> &'static str {
    match art {
        StammdatenArt::Fahrzeug => "funkrufname",
        StammdatenArt::Personal => "name",
        StammdatenArt::Qualifikation => "bezeichnung",
    }
}

/// Ein Textfeld: getrimmt, leer = keine Angabe. Zahlen gelten als Text (OPTA, ISSI);
/// alles andere ist ein Formfehler des Eintrags.
fn text(o: &Map<String, Value>, feld: &str) -> Result<Option<String>, String> {
    match o.get(feld) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let t = s.trim();
            Ok((!t.is_empty()).then(|| t.to_string()))
        }
        Some(Value::Number(n)) => Ok(Some(n.to_string())),
        Some(_) => Err(format!("Das Feld „{feld}“ ist kein Text")),
    }
}

fn liste(o: &Map<String, Value>, feld: &str) -> Result<Vec<String>, String> {
    let roh = match o.get(feld) {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(a)) => a,
        Some(_) => return Err(format!("Das Feld „{feld}“ ist keine Liste")),
    };
    let mut aus: Vec<String> = Vec::new();
    for w in roh {
        let Value::String(s) = w else {
            return Err(format!("Das Feld „{feld}“ enthält etwas anderes als Text"));
        };
        let t = s.trim();
        if !t.is_empty() && !aus.iter().any(|a| a.eq_ignore_ascii_case(t)) {
            aus.push(t.to_string());
        }
    }
    Ok(aus)
}

fn eintrag(
    art: StammdatenArt,
    zeile: u32,
    o: &Map<String, Value>,
    paket: &mut StammdatenPaket,
) -> Result<(), String> {
    let quelle = Herkunftsangabe {
        kennung: text(o, "kennung")?,
        herkunft: text(o, "herkunft")?,
    };
    if quelle
        .kennung
        .as_ref()
        .is_some_and(|k| k.chars().count() > KENNUNG_MAX)
    {
        return Err(format!("Die Kennung ist länger als {KENNUNG_MAX} Zeichen"));
    }
    if quelle
        .herkunft
        .as_ref()
        .is_some_and(|h| h.chars().count() > HERKUNFT_MAX)
    {
        return Err(format!(
            "Die Herkunft ist länger als {HERKUNFT_MAX} Zeichen"
        ));
    }
    let Some(pflichtwert) = text(o, pflicht(art))? else {
        return Err(format!("Das Feld „{}“ fehlt oder ist leer", pflicht(art)));
    };
    match art {
        StammdatenArt::Fahrzeug => paket.fahrzeuge.push(FahrzeugAngabe {
            zeile,
            quelle,
            funkrufname: pflichtwert,
            kennzeichen: text(o, "kennzeichen")?,
            opta: text(o, "opta")?,
            issi: text(o, "issi")?,
            typ: text(o, "typ")?,
            standort: text(o, "standort")?,
        }),
        StammdatenArt::Personal => paket.personal.push(PersonalAngabe {
            zeile,
            quelle,
            name: pflichtwert,
            personalnummer: text(o, "personalnummer")?,
            telefon: text(o, "telefon")?,
            traegerorganisation: text(o, "traegerorganisation")?,
            qualifikationen: liste(o, "qualifikationen")?,
        }),
        StammdatenArt::Qualifikation => paket.qualifikationen.push(QualifikationAngabe {
            zeile,
            quelle,
            bezeichnung: pflichtwert,
        }),
    }
    Ok(())
}

fn merke(nicht: &mut Vec<String>, name: &str) {
    if !nicht.iter().any(|n| n == name) {
        nicht.push(name.to_string());
    }
}

/// Liest den Körper eines Abrufs zu einem Paket. `zeile` ist die laufende Nummer im Array (ab 1).
/// Dritter Teil: Feldnamen, die der Vertrag nicht kennt (nie Werte).
pub fn lies_paket(koerper: &[u8]) -> Result<Gelesen, JsonFehler> {
    if koerper.len() > KOERPER_MAX {
        return Err(JsonFehler::ZuGross);
    }
    let wert: Value = serde_json::from_slice(koerper).map_err(|_| JsonFehler::KeinJson)?;
    let Value::Object(wurzel) = wert else {
        return Err(JsonFehler::KeinObjekt);
    };
    let arten = [
        StammdatenArt::Fahrzeug,
        StammdatenArt::Personal,
        StammdatenArt::Qualifikation,
    ];
    let mut paket = StammdatenPaket::default();
    let mut meldungen = Vec::new();
    let mut nicht = Vec::new();
    for k in wurzel.keys() {
        if !arten.iter().any(|a| schluessel(*a) == k) {
            merke(&mut nicht, k);
        }
    }
    for art in arten {
        let eintraege = match wurzel.get(schluessel(art)) {
            None | Some(Value::Null) => continue,
            Some(Value::Array(a)) => a,
            Some(_) => return Err(JsonFehler::KeinObjekt),
        };
        if eintraege.len() > ZEILEN_MAX {
            return Err(JsonFehler::ZuVieleEintraege { art });
        }
        for (i, e) in eintraege.iter().enumerate() {
            let zeile = (i + 1) as u32;
            let fehler = |text: String| DateiMeldung {
                art: Some(art),
                zeile: Some(zeile),
                stufe: MeldungStufe::Fehler,
                text: format!("{text}; der Eintrag wurde nicht gelesen"),
            };
            let Value::Object(o) = e else {
                meldungen.push(fehler("Der Eintrag ist kein Objekt".into()));
                continue;
            };
            for f in o.keys() {
                if !bekannt(art).contains(&f.as_str()) {
                    merke(&mut nicht, f);
                }
            }
            if let Err(t) = eintrag(art, zeile, o, &mut paket) {
                meldungen.push(fehler(t));
            }
        }
    }
    Ok((paket, meldungen, nicht))
}

/// Fingerabdruck eines Pakets (SHA-256, hex) über seine kanonische Form: je Art nach Kennung und
/// Hauptmerkmal sortiert, Qualifikationen je Person sortiert, ohne `zeile`. Dieselben Daten in
/// anderer Reihenfolge ergeben denselben Abdruck; jede inhaltliche Änderung einen anderen.
pub fn fingerabdruck(paket: &StammdatenPaket) -> String {
    fn q(h: &Herkunftsangabe) -> Value {
        serde_json::json!([h.kennung, h.herkunft])
    }
    let mut fz: Vec<Value> = paket
        .fahrzeuge
        .iter()
        .map(|f| {
            serde_json::json!([
                q(&f.quelle),
                f.funkrufname,
                f.kennzeichen,
                f.opta,
                f.issi,
                f.typ,
                f.standort
            ])
        })
        .collect();
    let mut p: Vec<Value> = paket
        .personal
        .iter()
        .map(|p| {
            let mut qs = p.qualifikationen.clone();
            qs.sort();
            serde_json::json!([
                q(&p.quelle),
                p.name,
                p.personalnummer,
                p.telefon,
                p.traegerorganisation,
                qs
            ])
        })
        .collect();
    let mut ql: Vec<Value> = paket
        .qualifikationen
        .iter()
        .map(|x| serde_json::json!([q(&x.quelle), x.bezeichnung]))
        .collect();
    for v in [&mut fz, &mut p, &mut ql] {
        v.sort_by_key(|x| x.to_string());
    }
    let kanonisch = serde_json::json!([fz, p, ql]).to_string();
    Sha256::digest(kanonisch.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BEISPIEL: &str =
        include_str!("../../docs/schnittstellen/beispiele/stammdaten-abruf.json");

    #[test]
    fn beispiel_ergibt_zwei_personen_mit_laufender_nummer() {
        let (paket, meldungen, nicht) = lies_paket(BEISPIEL.as_bytes()).unwrap();
        assert!(meldungen.is_empty(), "{meldungen:?}");
        assert!(nicht.is_empty(), "{nicht:?}");
        assert_eq!(paket.personal.len(), 2);
        assert_eq!(paket.personal[0].zeile, 1);
        assert_eq!(paket.personal[1].zeile, 2);
        assert_eq!(paket.personal[0].name, "Albers, Jana");
        assert_eq!(
            paket.personal[0].qualifikationen,
            vec!["Sanitätshelfer".to_string(), "Sprechfunker".to_string()]
        );
        assert_eq!(paket.personal[0].quelle.herkunft, None);
    }

    #[test]
    fn mangelhafter_eintrag_wird_meldung_nicht_fehler() {
        let lang = "k".repeat(101);
        let k = format!(
            r#"{{"personal":[{{"kennung":"a"}},{{"kennung":"{lang}","name":"X"}},{{"kennung":"c","name":"Y","qualifikationen":[1]}},{{"kennung":"d","name":"Z"}}]}}"#
        );
        let (paket, meldungen, _) = lies_paket(k.as_bytes()).unwrap();
        assert_eq!(paket.personal.len(), 1);
        assert_eq!(paket.personal[0].zeile, 4);
        assert_eq!(
            meldungen.iter().map(|m| m.zeile).collect::<Vec<_>>(),
            vec![Some(1), Some(2), Some(3)]
        );
        assert!(meldungen.iter().all(|m| m.stufe == MeldungStufe::Fehler));
    }

    #[test]
    fn unbekannte_felder_nur_mit_namen() {
        let k = r#"{"personal":[{"name":"X","iban":"DE00 1234"}],"extra":1}"#;
        let (paket, _, nicht) = lies_paket(k.as_bytes()).unwrap();
        assert_eq!(paket.personal.len(), 1);
        assert_eq!(nicht, vec!["extra".to_string(), "iban".to_string()]);
        assert!(!format!("{nicht:?}").contains("DE00"));
    }

    #[test]
    fn ganze_antwort_unpassend() {
        let gross = vec![b' '; KOERPER_MAX + 1];
        assert_eq!(lies_paket(&gross).unwrap_err(), JsonFehler::ZuGross);
        assert_eq!(lies_paket(b"x").unwrap_err(), JsonFehler::KeinJson);
        assert_eq!(lies_paket(b"[]").unwrap_err(), JsonFehler::KeinObjekt);
        let viele = format!(
            r#"{{"personal":[{}]}}"#,
            vec![r#"{"name":"X"}"#; ZEILEN_MAX + 1].join(",")
        );
        assert_eq!(
            lies_paket(viele.as_bytes()).unwrap_err(),
            JsonFehler::ZuVieleEintraege {
                art: StammdatenArt::Personal
            }
        );
    }

    #[test]
    fn fingerabdruck_ohne_reihenfolge_mit_inhalt() {
        let a = r#"{"personal":[{"kennung":"1","name":"A","qualifikationen":["x","y"]},{"kennung":"2","name":"B"}]}"#;
        let b = r#"{"personal":[{"kennung":"2","name":"B"},{"kennung":"1","name":"A","qualifikationen":["y","x"]}]}"#;
        let c = r#"{"personal":[{"kennung":"2","name":"B"},{"kennung":"1","name":"A","qualifikationen":["y","z"]}]}"#;
        let fa = fingerabdruck(&lies_paket(a.as_bytes()).unwrap().0);
        assert_eq!(fa, fingerabdruck(&lies_paket(b.as_bytes()).unwrap().0));
        assert_ne!(fa, fingerabdruck(&lies_paket(c.as_bytes()).unwrap().0));
        assert_eq!(fa.len(), 64);
    }
}
