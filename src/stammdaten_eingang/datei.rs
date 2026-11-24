//! Datei → [`StammdatenPaket`] (Vertrag „Stammdaten-Datei“).
//!
//! Spaltenköpfe: getrimmt, klein, Leerzeichen, `_` und `-` entfallen. Eine leere Zelle heißt
//! „keine Angabe“. Spalten, die der Vertrag nicht kennt, werden nur mit ihrem Kopf gemeldet.

use crate::abloesung::schichtplan::uebernahme::{
    ImportMeldung, MeldungStufe, HERKUNFT_MAX, KENNUNG_MAX,
};
use crate::einlesen::tabelle::{lies_blaetter, Tabelle, Zelle, ZEILEN_MAX};
use crate::error::AppError;

use super::{
    DateiMeldung, FahrzeugAngabe, Herkunftsangabe, PersonalAngabe, QualifikationAngabe,
    StammdatenArt, StammdatenPaket,
};

fn kopf_norm(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

/// Bekannte Spalten einer Art (normalisiert).
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

fn art_vom_blatt(name: &str) -> Option<StammdatenArt> {
    match kopf_norm(name).as_str() {
        "fahrzeuge" => Some(StammdatenArt::Fahrzeug),
        "personal" => Some(StammdatenArt::Personal),
        "qualifikationen" => Some(StammdatenArt::Qualifikation),
        _ => None,
    }
}

fn art_von_kopf(kopf: &[String]) -> Result<StammdatenArt, AppError> {
    let hat = |n: &str| kopf.iter().any(|k| kopf_norm(k) == n);
    match (hat("funkrufname"), hat("name"), hat("bezeichnung")) {
        (true, true, _) => Err(AppError::Validation(
            "Die Art der Datei ist nicht eindeutig: Spalten „Funkrufname“ und „Name“ stehen beide im Kopf"
                .into(),
        )),
        (true, false, _) => Ok(StammdatenArt::Fahrzeug),
        (false, true, _) => Ok(StammdatenArt::Personal),
        (false, false, true) => Ok(StammdatenArt::Qualifikation),
        _ => Err(AppError::Validation(
            "Die Art der Datei ist nicht erkennbar: Der Kopf braucht „Funkrufname“ (Fahrzeuge), „Name“ (Personal) oder „Bezeichnung“ (Qualifikationen)"
                .into(),
        )),
    }
}

fn meldung(art: StammdatenArt, m: ImportMeldung) -> DateiMeldung {
    DateiMeldung {
        art: Some(art),
        zeile: m.zeile,
        stufe: m.stufe,
        text: m.text,
    }
}

/// Eine Zeile mit Zugriff auf Zellen nach normalisiertem Spaltennamen.
struct Zeile<'a> {
    spalten: &'a [(String, usize)],
    zellen: &'a [Zelle],
}

impl Zeile<'_> {
    fn wert(&self, name: &str) -> Option<String> {
        let (_, i) = self.spalten.iter().find(|(n, _)| n == name)?;
        self.zellen.get(*i).and_then(Zelle::text)
    }
}

fn qualifikationsliste(roh: Option<String>) -> Vec<String> {
    let mut aus: Vec<String> = Vec::new();
    for teil in roh.unwrap_or_default().split(';') {
        let t = teil.trim();
        if !t.is_empty() && !aus.iter().any(|a| a.eq_ignore_ascii_case(t)) {
            aus.push(t.to_string());
        }
    }
    aus
}

/// Liest ein Blatt einer Art; Zeilen mit Mangel fehlen im Paket und kommen als Meldung.
fn lies_art(
    art: StammdatenArt,
    tabelle: Tabelle,
    paket: &mut StammdatenPaket,
    meldungen: &mut Vec<DateiMeldung>,
    nicht_uebernommen: &mut Vec<String>,
) -> Result<(), AppError> {
    meldungen.extend(tabelle.meldungen.into_iter().map(|m| meldung(art, m)));
    let mut spalten: Vec<(String, usize)> = Vec::new();
    for (i, kopf) in tabelle.kopf.iter().enumerate() {
        let n = kopf_norm(kopf);
        if n.is_empty() {
            continue;
        }
        if bekannt(art).contains(&n.as_str()) {
            if !spalten.iter().any(|(s, _)| *s == n) {
                spalten.push((n, i));
            }
        } else {
            let k = kopf.trim().to_string();
            if !nicht_uebernommen.contains(&k) {
                nicht_uebernommen.push(k);
            }
        }
    }
    if !spalten.iter().any(|(n, _)| n == pflicht(art)) {
        return Err(AppError::Validation(format!(
            "Der Kopf der Tabelle braucht die Spalte „{}“",
            pflicht(art)
        )));
    }
    for (nr, zellen) in &tabelle.zeilen {
        let z = Zeile {
            spalten: &spalten,
            zellen,
        };
        if zellen.iter().all(|c| c.text().is_none()) {
            continue;
        }
        let fehler = |text: String| DateiMeldung {
            art: Some(art),
            zeile: Some(*nr),
            stufe: MeldungStufe::Fehler,
            text,
        };
        let quelle = Herkunftsangabe {
            kennung: z.wert("kennung"),
            herkunft: z.wert("herkunft"),
        };
        if quelle
            .kennung
            .as_ref()
            .is_some_and(|k| k.chars().count() > KENNUNG_MAX)
        {
            meldungen.push(fehler(format!(
                "Die Kennung ist länger als {KENNUNG_MAX} Zeichen; die Zeile wurde nicht gelesen"
            )));
            continue;
        }
        if quelle
            .herkunft
            .as_ref()
            .is_some_and(|h| h.chars().count() > HERKUNFT_MAX)
        {
            meldungen.push(fehler(format!(
                "Die Herkunft ist länger als {HERKUNFT_MAX} Zeichen; die Zeile wurde nicht gelesen"
            )));
            continue;
        }
        let Some(pflichtwert) = z.wert(pflicht(art)) else {
            meldungen.push(fehler(format!(
                "Die Spalte „{}“ ist leer; die Zeile wurde nicht gelesen",
                pflicht(art)
            )));
            continue;
        };
        match art {
            StammdatenArt::Fahrzeug => paket.fahrzeuge.push(FahrzeugAngabe {
                zeile: *nr,
                quelle,
                funkrufname: pflichtwert,
                kennzeichen: z.wert("kennzeichen"),
                opta: z.wert("opta"),
                issi: z.wert("issi"),
                typ: z.wert("typ"),
                standort: z.wert("standort"),
            }),
            StammdatenArt::Personal => paket.personal.push(PersonalAngabe {
                zeile: *nr,
                quelle,
                name: pflichtwert,
                personalnummer: z.wert("personalnummer"),
                telefon: z.wert("telefon"),
                traegerorganisation: z.wert("traegerorganisation"),
                qualifikationen: qualifikationsliste(z.wert("qualifikationen")),
            }),
            StammdatenArt::Qualifikation => paket.qualifikationen.push(QualifikationAngabe {
                zeile: *nr,
                quelle,
                bezeichnung: pflichtwert,
            }),
        }
    }
    Ok(())
}

/// Liest CSV oder XLSX zu einem Paket. Dritter Teil: Spaltenköpfe, die der Vertrag nicht kennt
/// (nur die Köpfe, nie Werte).
pub fn lies_paket(
    bytes: &[u8],
) -> Result<(StammdatenPaket, Vec<DateiMeldung>, Vec<String>), AppError> {
    let blaetter = lies_blaetter(bytes, ZEILEN_MAX)?;
    let mut paket = StammdatenPaket::default();
    let mut meldungen = Vec::new();
    let mut nicht = Vec::new();
    let mut gelesen: Vec<StammdatenArt> = Vec::new();
    for (name, tabelle) in blaetter {
        if name.is_empty() {
            // CSV: eine Art je Datei, erkannt am Kopf.
            let art = art_von_kopf(&tabelle.kopf)?;
            lies_art(art, tabelle, &mut paket, &mut meldungen, &mut nicht)?;
            gelesen.push(art);
            continue;
        }
        match art_vom_blatt(&name) {
            Some(art) if !gelesen.contains(&art) => {
                lies_art(art, tabelle, &mut paket, &mut meldungen, &mut nicht).map_err(
                    |e| match e {
                        AppError::Validation(t) => {
                            AppError::Validation(format!("Blatt „{name}“: {t}"))
                        }
                        e => e,
                    },
                )?;
                gelesen.push(art);
            }
            _ => meldungen.push(DateiMeldung {
                art: None,
                zeile: None,
                stufe: MeldungStufe::Hinweis,
                text: format!("Blatt nicht gelesen: „{name}“"),
            }),
        }
    }
    if gelesen.is_empty() {
        return Err(AppError::Validation(
            "Die Datei enthält kein Blatt „Fahrzeuge“, „Personal“ oder „Qualifikationen“".into(),
        ));
    }
    Ok((paket, meldungen, nicht))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abloesung::schichtplan::uebernahme::MeldungStufe;
    use rust_xlsxwriter::Workbook;

    fn mappe(blaetter: &[(&str, &[&[&str]])]) -> Vec<u8> {
        let mut wb = Workbook::new();
        for (name, zeilen) in blaetter {
            let ws = wb.add_worksheet();
            ws.set_name(*name).unwrap();
            for (r, zeile) in zeilen.iter().enumerate() {
                for (c, text) in zeile.iter().enumerate() {
                    ws.write_string(r as u32, c as u16, *text).unwrap();
                }
            }
        }
        wb.save_to_buffer().unwrap()
    }

    #[test]
    fn csv_fahrzeuge_erkannt() {
        let csv = "Funkrufname;OPTA;ISSI;Kennung\nRK Berlin 1/83-1;4-83-1;1234567;fz-1\n";
        let (paket, meldungen, nicht) = lies_paket(csv.as_bytes()).unwrap();
        assert!(meldungen.is_empty(), "{meldungen:?}");
        assert!(nicht.is_empty());
        assert_eq!(paket.fahrzeuge.len(), 1);
        let f = &paket.fahrzeuge[0];
        assert_eq!(f.zeile, 2);
        assert_eq!(f.funkrufname, "RK Berlin 1/83-1");
        assert_eq!(f.opta.as_deref(), Some("4-83-1"));
        assert_eq!(f.issi.as_deref(), Some("1234567"));
        assert_eq!(f.quelle.kennung.as_deref(), Some("fz-1"));
        assert_eq!(f.quelle.herkunft, None);
        assert!(paket.personal.is_empty() && paket.qualifikationen.is_empty());
    }

    #[test]
    fn csv_art_mehrdeutig_400() {
        let csv = "Kennung;Telefon\nx;1\n";
        assert!(matches!(
            lies_paket(csv.as_bytes()),
            Err(AppError::Validation(_))
        ));
        let beide = "Funkrufname;Name\nx;y\n";
        assert!(matches!(
            lies_paket(beide.as_bytes()),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn csv_name_vor_bezeichnung() {
        let csv = "Name;Bezeichnung\nMuster, Max;x\n";
        let (paket, _, nicht) = lies_paket(csv.as_bytes()).unwrap();
        assert_eq!(paket.personal.len(), 1);
        assert_eq!(nicht, ["Bezeichnung"]);
    }

    #[test]
    fn xlsx_blaetter_nach_namen() {
        let bytes = mappe(&[
            ("fahrzeuge", &[&["Funkrufname"], &["RK 1"]]),
            ("Personal", &[&["Name"], &["Muster, Max"]]),
            ("Sonstiges", &[&["A"], &["1"]]),
        ]);
        let (paket, meldungen, _) = lies_paket(&bytes).unwrap();
        assert_eq!(paket.fahrzeuge.len(), 1);
        assert_eq!(paket.personal.len(), 1);
        assert!(paket.qualifikationen.is_empty());
        assert_eq!(meldungen.len(), 1);
        assert!(meldungen[0].text.contains("Blatt nicht gelesen"));
        assert!(meldungen[0].text.contains("Sonstiges"));
        assert_eq!(meldungen[0].stufe, MeldungStufe::Hinweis);
    }

    #[test]
    fn unbekannte_spalten_nur_kopf() {
        let csv = "Name;IBAN;Geburtsdatum\nMuster;DE0012345;01.02.1990\n";
        let (paket, _, nicht) = lies_paket(csv.as_bytes()).unwrap();
        assert_eq!(nicht, ["IBAN", "Geburtsdatum"]);
        let dbg = format!("{paket:?}");
        assert!(!dbg.contains("DE0012345") && !dbg.contains("1990"));
    }

    #[test]
    fn qualifikationen_liste() {
        // Semikolon ist Trenner der CSV: die Liste kommt in Anführungszeichen.
        let csv = "Name;Qualifikationen\nMuster;\"San-A; SanH ;;\"\n";
        let (paket, _, _) = lies_paket(csv.as_bytes()).unwrap();
        assert_eq!(paket.personal[0].qualifikationen, ["San-A", "SanH"]);
    }

    #[test]
    fn pflichtspalte_leer_meldung() {
        let csv = "Funkrufname;OPTA\nRK 1;a\n;b\n";
        let (paket, meldungen, _) = lies_paket(csv.as_bytes()).unwrap();
        assert_eq!(paket.fahrzeuge.len(), 1);
        assert_eq!(meldungen.len(), 1);
        assert_eq!(meldungen[0].zeile, Some(3));
        assert_eq!(meldungen[0].stufe, MeldungStufe::Fehler);
        assert_eq!(
            meldungen[0].art,
            Some(super::super::StammdatenArt::Fahrzeug)
        );
    }

    #[test]
    fn kennung_zu_lang_meldung() {
        let lang = "k".repeat(101);
        let csv = format!("Funkrufname;Kennung\nRK 1;{lang}\n");
        let (paket, meldungen, _) = lies_paket(csv.as_bytes()).unwrap();
        assert!(paket.fahrzeuge.is_empty());
        assert_eq!(meldungen.len(), 1);
        assert_eq!(meldungen[0].zeile, Some(2));
    }

    #[test]
    fn kopf_schreibweise_egal() {
        let csv = "Träger_Organisation;Name\nx;Muster\n";
        let (_, _, nicht) = lies_paket(csv.as_bytes()).unwrap();
        assert_eq!(nicht, ["Träger_Organisation"]);
        let csv = "Name;Personal-Nummer;Traeger Organisation\nMuster;7;DRK\n";
        let (paket, _, nicht) = lies_paket(csv.as_bytes()).unwrap();
        assert!(nicht.is_empty());
        assert_eq!(paket.personal[0].personalnummer.as_deref(), Some("7"));
        assert_eq!(
            paket.personal[0].traegerorganisation.as_deref(),
            Some("DRK")
        );
    }
}
