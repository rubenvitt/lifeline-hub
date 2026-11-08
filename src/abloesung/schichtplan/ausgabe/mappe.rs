//! Die Excel-Mappe eines Schichtplans (design.md D4): fünf Blätter aus einem
//! [`AusgabePlan`](super::plan::AusgabePlan).
//!
//! - **Austausch** zuerst: das Format des Lesers (`uebernahme::datei`), eine Zeile je Person und
//!   Schicht, eine Schicht ohne Person als Zeile ohne Namen. Zeiten als Text ISO 8601 mit
//!   Versatz, Personen mit Bezug (design.md D6).
//! - **Übersicht**, **Je Posten**, **Je Person**, **Befunde** zum Lesen: Tag, Von und Bis als Text
//!   in der Zone des Einsatzes bzw. der Planung, Stunden als Zahl. Keine Datumszellen: Excel
//!   zeigte sie in der Zone des Rechners, der die Mappe öffnet.
//!
//! Kopfzeile fett und eingefroren, feste Spaltenbreiten, Autofilter auf den lesbaren Listen.
//! Texte gehen als Text in die Zellen, nie als Formel.

use rust_xlsxwriter::{Format, Workbook, Worksheet, XlsxError};

use super::plan::{
    bis_text, tag, uhr, zeitpunkt_text, zeitraum_text, AusgabePlan, AusgabePostenArt, Quelle,
};
use crate::error::AppError;

/// Medientyp der Antwort.
pub const MEDIENTYP: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/// Spalten des Austauschs in der Reihenfolge der Anwenderdoku (Kapitel Ablösung, „Format der
/// Schichtplan-Datei“).
pub const AUSTAUSCH_SPALTEN: [&str; 14] = [
    "Posten",
    "Abschnitt",
    "Posten-Art",
    "Beginn",
    "Ende",
    "Soll-Anzahl",
    "Soll-Qualifikationen",
    "Nachname",
    "Vorname",
    "Telefon",
    "Organisation",
    "Qualifikationen",
    "Kennung",
    "Herkunft",
];

fn fehler(e: XlsxError) -> AppError {
    AppError::Internal(format!("Excel-Mappe des Schichtplans: {e}"))
}

/// Eine Zelle: Text, Zahl oder leer.
enum Wert {
    Text(String),
    Zahl(f64),
    Leer,
}

impl From<String> for Wert {
    fn from(s: String) -> Self {
        if s.is_empty() {
            Wert::Leer
        } else {
            Wert::Text(s)
        }
    }
}

impl From<&str> for Wert {
    fn from(s: &str) -> Self {
        Wert::from(s.to_string())
    }
}

impl From<Option<String>> for Wert {
    fn from(s: Option<String>) -> Self {
        s.map_or(Wert::Leer, Wert::from)
    }
}

impl From<i64> for Wert {
    fn from(n: i64) -> Self {
        Wert::Zahl(n as f64)
    }
}

impl From<Option<i64>> for Wert {
    fn from(n: Option<i64>) -> Self {
        n.map_or(Wert::Leer, Wert::from)
    }
}

/// Ein Blatt mit Kopf, Breiten und Zeilen.
struct Blatt<'a> {
    name: &'static str,
    kopf: &'a [(&'a str, f64)],
    zeilen: Vec<Vec<Wert>>,
    filter: bool,
    /// Spalten mit Zahlformat „0.00“ (Stunden).
    dezimal: &'a [u16],
}

fn write_blatt(ws: &mut Worksheet, b: &Blatt<'_>) -> Result<(), XlsxError> {
    ws.set_name(b.name)?;
    let fett = Format::new().set_bold();
    let dezimal = Format::new().set_num_format("0.00");
    for (i, (titel, breite)) in b.kopf.iter().enumerate() {
        let c = i as u16;
        ws.write_string_with_format(0, c, *titel, &fett)?;
        ws.set_column_width(c, *breite)?;
    }
    for (r, zeile) in b.zeilen.iter().enumerate() {
        let r = r as u32 + 1;
        for (c, wert) in zeile.iter().enumerate() {
            let c = c as u16;
            match wert {
                Wert::Text(t) => {
                    ws.write_string(r, c, t)?;
                }
                Wert::Zahl(z) if b.dezimal.contains(&c) => {
                    ws.write_number_with_format(r, c, *z, &dezimal)?;
                }
                Wert::Zahl(z) => {
                    ws.write_number(r, c, *z)?;
                }
                Wert::Leer => {}
            }
        }
    }
    ws.set_freeze_panes(1, 0)?;
    if b.filter && !b.zeilen.is_empty() {
        ws.autofilter(0, 0, b.zeilen.len() as u32, b.kopf.len() as u16 - 1)?;
    }
    Ok(())
}

/// „1 Rettungssanitäter, 2 Sanitäter“, wie der Leser das Soll liest.
fn quali_soll_text(q: &[super::plan::AusgabeQuali]) -> String {
    q.iter()
        .map(|e| format!("{} {}", e.anzahl, e.label))
        .collect::<Vec<_>>()
        .join(", ")
}

fn iso(t: chrono::DateTime<chrono::Utc>, zone: chrono_tz::Tz) -> String {
    t.with_timezone(&zone)
        .format("%Y-%m-%dT%H:%M%:z")
        .to_string()
}

fn austausch(plan: &AusgabePlan) -> Vec<Vec<Wert>> {
    let zone = plan.kopf.zone;
    let mut zeilen = Vec::new();
    for s in &plan.schichten {
        let Some(p) = plan.posten_von(&s.posten) else {
            continue;
        };
        let pause = p.art == AusgabePostenArt::Pause;
        let kopf = || -> Vec<Wert> {
            vec![
                Wert::from(p.name.as_str()),
                Wert::from(p.abschnitt.clone()),
                Wert::from(p.art.wort()),
                Wert::from(iso(s.von, zone)),
                Wert::from(iso(s.bis, zone)),
                if pause {
                    Wert::Leer
                } else {
                    Wert::from(s.soll_anzahl)
                },
                if pause {
                    Wert::Leer
                } else {
                    Wert::from(quali_soll_text(&s.quali_soll))
                },
            ]
        };
        let personen = plan.eingeteilt(s);
        if personen.is_empty() {
            zeilen.push(kopf());
            continue;
        }
        for person in personen {
            let (kennung, herkunft) = person.bezug();
            let helfer = person.is_helfer();
            let mut z = kopf();
            z.extend([
                // Ein Name in einem Feld: unzerlegt als Nachname (design.md D4).
                Wert::from(person.name.as_str()),
                Wert::Leer,
                Wert::from(person.telefon.clone().filter(|_| helfer)),
                Wert::from(person.organisation.clone().filter(|_| helfer)),
                if helfer {
                    Wert::from(person.qualifikationen.join(", "))
                } else {
                    Wert::Leer
                },
                Wert::from(kennung),
                Wert::from(herkunft),
            ]);
            zeilen.push(z);
        }
    }
    zeilen
}

fn uebersicht(plan: &AusgabePlan) -> Vec<Vec<Wert>> {
    let k = &plan.kopf;
    let zone = k.zone;
    let (ist, soll, offen) = plan.besetzung();
    let befunde = plan.befunde().count() as i64;
    let mut zeilen: Vec<Vec<Wert>> = vec![vec![
        Wert::from(match k.quelle {
            Quelle::Einsatz => "Einsatz",
            Quelle::Planung => "Planung",
        }),
        Wert::from(k.titel.as_str()),
    ]];
    zeilen.push(vec![Wert::from("Ort"), Wert::from(k.ort.clone())]);
    zeilen.push(vec![
        Wert::from("Zeitraum"),
        Wert::from(
            plan.zeitraum()
                .map(|(a, b)| format!("{} – {}", zeitpunkt_text(a, zone), zeitpunkt_text(b, zone)))
                .unwrap_or_default(),
        ),
    ]);
    zeilen.push(vec![Wert::from("Zeitzone"), Wert::from(zone.name())]);
    zeilen.push(vec![
        Wert::from("Schichten"),
        Wert::from(plan.schichten.len() as i64),
    ]);
    zeilen.push(vec![
        Wert::from("Personen"),
        Wert::from(plan.personen.len() as i64),
    ]);
    zeilen.push(vec![
        Wert::from("Besetzung"),
        Wert::from(format!("{ist} von {soll} Plätzen")),
    ]);
    zeilen.push(vec![Wert::from("Offene Plätze"), Wert::from(offen)]);
    zeilen.push(vec![Wert::from("Befunde"), Wert::from(befunde)]);
    zeilen.push(vec![
        Wert::from("Stand"),
        Wert::from(zeitpunkt_text(k.stand, zone)),
    ]);
    zeilen
}

fn je_posten(plan: &AusgabePlan) -> Vec<Vec<Wert>> {
    let zone = plan.kopf.zone;
    plan.schichten
        .iter()
        .filter_map(|s| {
            let p = plan.posten_von(&s.posten)?;
            let pause = p.art == AusgabePostenArt::Pause;
            let name = if p.aufgeloest {
                format!("{} (aufgelöst)", p.name)
            } else {
                p.name.clone()
            };
            let eingeteilt: Vec<String> = plan
                .eingeteilt(s)
                .iter()
                .map(|x| x.mit_organisation())
                .collect();
            Some(vec![
                Wert::from(p.abschnitt.clone()),
                Wert::from(name),
                Wert::from(tag(s.von, zone)),
                Wert::from(uhr(s.von, zone)),
                Wert::from(bis_text(s.von, s.bis, zone)),
                if pause {
                    Wert::Leer
                } else {
                    Wert::from(s.soll_anzahl)
                },
                Wert::from(quali_soll_text(&s.quali_soll)),
                Wert::from(s.personen.len() as i64),
                if pause {
                    Wert::Leer
                } else {
                    Wert::from(s.offen)
                },
                Wert::from(eingeteilt.join(", ")),
            ])
        })
        .collect()
}

fn je_person(plan: &AusgabePlan) -> Vec<Vec<Wert>> {
    let zone = plan.kopf.zone;
    let mut zeilen = Vec::new();
    for person in &plan.personen {
        let helfer = person.is_helfer();
        let mut schichten: Vec<_> = plan
            .schichten
            .iter()
            .filter(|s| s.personen.contains(&person.schluessel))
            .collect();
        schichten.sort_by_key(|s| (s.von, s.bis, s.id));
        for s in schichten {
            let Some(p) = plan.posten_von(&s.posten) else {
                continue;
            };
            let pause = p.art == AusgabePostenArt::Pause;
            zeilen.push(vec![
                Wert::from(person.name.as_str()),
                Wert::from(person.organisation.clone().filter(|_| helfer)),
                Wert::from(person.telefon.clone().filter(|_| helfer)),
                Wert::from(p.name.as_str()),
                Wert::from(p.abschnitt.clone()),
                Wert::from(tag(s.von, zone)),
                Wert::from(uhr(s.von, zone)),
                Wert::from(bis_text(s.von, s.bis, zone)),
                if pause {
                    Wert::Leer
                } else {
                    Wert::Zahl((s.minuten() as f64 / 60.0 * 100.0).round() / 100.0)
                },
            ]);
        }
    }
    zeilen
}

fn befunde(plan: &AusgabePlan) -> Vec<Vec<Wert>> {
    let zone = plan.kopf.zone;
    plan.befunde()
        .map(|(s, b)| {
            vec![
                Wert::from(super::plan::befund_wort(b.art)),
                Wert::from(
                    plan.posten_von(&s.posten)
                        .map(|p| p.name.clone())
                        .unwrap_or_default(),
                ),
                Wert::from(zeitraum_text(s.von, s.bis, zone)),
                Wert::from(
                    b.person
                        .as_deref()
                        .and_then(|k| plan.person_von(k))
                        .map(|p| p.name.clone()),
                ),
                Wert::from(b.text.as_str()),
            ]
        })
        .collect()
}

/// Schreibt die Mappe.
pub fn write_mappe(plan: &AusgabePlan) -> Result<Vec<u8>, AppError> {
    let austausch_kopf: Vec<(&str, f64)> = AUSTAUSCH_SPALTEN
        .iter()
        .zip([
            24.0, 18.0, 10.0, 22.0, 22.0, 11.0, 28.0, 26.0, 10.0, 16.0, 22.0, 28.0, 18.0, 14.0,
        ])
        .map(|(t, b)| (*t, b))
        .collect();
    let blaetter = [
        Blatt {
            name: "Austausch",
            kopf: &austausch_kopf,
            zeilen: austausch(plan),
            filter: false,
            dezimal: &[],
        },
        Blatt {
            name: "Übersicht",
            kopf: &[("Angabe", 18.0), ("Wert", 48.0)],
            zeilen: uebersicht(plan),
            filter: false,
            dezimal: &[],
        },
        Blatt {
            name: "Je Posten",
            kopf: &[
                ("Abschnitt", 18.0),
                ("Posten", 24.0),
                ("Tag", 11.0),
                ("Von", 7.0),
                ("Bis", 16.0),
                ("Soll", 6.0),
                ("Soll-Qualifikationen", 28.0),
                ("Ist", 6.0),
                ("Offen", 7.0),
                ("Eingeteilt", 60.0),
            ],
            zeilen: je_posten(plan),
            filter: true,
            dezimal: &[],
        },
        Blatt {
            name: "Je Person",
            kopf: &[
                ("Name", 26.0),
                ("Organisation", 22.0),
                ("Telefon", 16.0),
                ("Posten", 24.0),
                ("Abschnitt", 18.0),
                ("Tag", 11.0),
                ("Von", 7.0),
                ("Bis", 16.0),
                ("Stunden", 9.0),
            ],
            zeilen: je_person(plan),
            filter: true,
            dezimal: &[8],
        },
        Blatt {
            name: "Befunde",
            kopf: &[
                ("Art", 20.0),
                ("Posten", 24.0),
                ("Zeit", 26.0),
                ("Person", 26.0),
                ("Beschreibung", 48.0),
            ],
            zeilen: befunde(plan),
            filter: true,
            dezimal: &[],
        },
    ];
    let mut mappe = Workbook::new();
    for b in &blaetter {
        write_blatt(mappe.add_worksheet(), b).map_err(fehler)?;
    }
    mappe.save_to_buffer().map_err(fehler)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abloesung::schichtplan::ausgabe::plan::tests::{einsatz_plan, BERLIN};
    use crate::abloesung::schichtplan::uebernahme::datei::{lies_paket, lies_tabelle};
    use crate::abloesung::schichtplan::uebernahme::{MeldungStufe, PaketPerson, PaketPostenArt};
    use calamine::{Data, Reader, Xlsx};

    fn blatt(bytes: &[u8], name: &str) -> Vec<Vec<String>> {
        let mut m: Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(bytes)).unwrap();
        let r = m.worksheet_range(name).unwrap();
        r.rows()
            .map(|z| {
                z.iter()
                    .map(|c| match c {
                        Data::Empty => String::new(),
                        Data::Float(f) => f.to_string(),
                        Data::Int(i) => i.to_string(),
                        andere => andere.to_string(),
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn fuenf_blaetter_austausch_zuerst() {
        let bytes = write_mappe(&einsatz_plan()).unwrap();
        let m: Xlsx<_> = calamine::open_workbook_from_rs(std::io::Cursor::new(&bytes[..])).unwrap();
        assert_eq!(
            m.sheet_names(),
            vec![
                "Austausch",
                "Übersicht",
                "Je Posten",
                "Je Person",
                "Befunde"
            ]
        );
        let a = blatt(&bytes, "Austausch");
        assert_eq!(a[0], AUSTAUSCH_SPALTEN.map(String::from).to_vec());
        // Streife 1 ohne Person, Streife 1 mit zwei, UHS mit einer, Pause mit einer.
        assert_eq!(a.len(), 1 + 1 + 2 + 1 + 1);
        assert_eq!(
            a[1][..7],
            [
                "Streife 1",
                "Bühne",
                "Einheit",
                "2026-08-15T12:00+02:00",
                "2026-08-15T14:00+02:00",
                "",
                ""
            ]
        );
        assert_eq!(
            a[2][..8],
            [
                "Streife 1",
                "Bühne",
                "Einheit",
                "2026-08-15T14:00+02:00",
                "2026-08-15T16:00+02:00",
                "3",
                "1 Sanitäter",
                "Jonas Fiktiv"
            ]
        );
        assert_eq!(
            a[2][9..],
            [
                "0170 1",
                "DRK Nachbarstadt",
                "Sanitäter",
                "10231",
                "Helferplanung"
            ]
        );
        assert_eq!(a[3][7], "Sophie Vorlage");
        assert_eq!(a[3][9..], ["", "", "", "personal-7", "Lifeline Hub"]);
        assert_eq!(a[4][..3], ["UHS Markt", "", "UHS"]);
        assert_eq!(a[4][12..], ["einsatzkraft-30", "Lifeline Hub"]);
        assert_eq!(a[5][..3], ["Pause", "", "Pause"]);
    }

    #[test]
    fn lesbare_blaetter_in_der_zone() {
        let bytes = write_mappe(&einsatz_plan()).unwrap();
        let u = blatt(&bytes, "Übersicht");
        let wert = |k: &str| u.iter().find(|z| z[0] == k).unwrap()[1].clone();
        assert_eq!(wert("Einsatz"), "Stadtfest");
        assert_eq!(wert("Besetzung"), "2 von 3 Plätzen");
        assert_eq!(wert("Zeitraum"), "15.08.2026 12:00 – 16.08.2026 04:00");
        assert_eq!(wert("Befunde"), "1");
        let p = blatt(&bytes, "Je Posten");
        assert_eq!(
            p[2],
            [
                "Bühne",
                "Streife 1",
                "15.08.2026",
                "14:00",
                "16:00",
                "3",
                "1 Sanitäter",
                "2",
                "1",
                "Jonas Fiktiv (DRK Nachbarstadt), Sophie Vorlage"
            ]
        );
        // Die UHS läuft über Mitternacht.
        assert_eq!(p[3][2..5], ["16.08.2026", "00:00", "04:00"]);
        let j = blatt(&bytes, "Je Person");
        let sophie: Vec<&Vec<String>> = j.iter().filter(|z| z[0] == "Sophie Vorlage").collect();
        assert_eq!(sophie.len(), 2);
        assert_eq!(sophie[0][3], "Streife 1");
        assert_eq!(sophie[0][8], "2");
        assert_eq!(sophie[1][3], "Pause");
        assert_eq!(sophie[1][8], "", "Pause ohne Stunden");
        let b = blatt(&bytes, "Befunde");
        assert_eq!(
            b[1],
            [
                "doppelt verplant",
                "Streife 1",
                "15.08.2026 14:00–16:00",
                "Sophie Vorlage",
                "auch in Pause 15.08.2026 15:00–15:30"
            ]
        );
    }

    #[test]
    fn der_leser_nimmt_den_austausch_wie_er_ist() {
        let bytes = write_mappe(&einsatz_plan()).unwrap();
        let t = lies_tabelle(&bytes).unwrap();
        assert!(t.meldungen.is_empty(), "{:?}", t.meldungen);
        let (paket, meldungen) = lies_paket(&bytes, BERLIN).unwrap();
        assert!(
            meldungen.iter().all(|m| m.stufe != MeldungStufe::Fehler),
            "{meldungen:?}"
        );
        assert!(
            meldungen.is_empty(),
            "keine Ortszeit, keine unbekannte Spalte: {meldungen:?}"
        );
        assert_eq!(paket.bloecke.len(), 4);
        assert_eq!(
            paket.posten.iter().map(|p| p.art).collect::<Vec<_>>(),
            vec![
                PaketPostenArt::Einheit,
                PaketPostenArt::Uhs,
                PaketPostenArt::Pause
            ]
        );
        let streife = &paket.bloecke[1];
        assert_eq!(streife.soll_anzahl, Some(3));
        assert_eq!(streife.von, "2026-08-15 12:00:00");
        let sophie = paket
            .personen
            .iter()
            .find_map(|p| match p {
                PaketPerson::Angabe(a) if a.nachname == "Sophie Vorlage" => Some(a),
                _ => None,
            })
            .unwrap();
        assert_eq!(sophie.vorname, None);
        assert_eq!(sophie.kennung.as_deref(), Some("personal-7"));
        assert_eq!(sophie.zeilen.len(), 2, "Streife und Pause: eine Person");
    }

    #[test]
    fn text_bleibt_text() {
        let mut plan = einsatz_plan();
        plan.posten[0].name = "=HYPERLINK(\"x\")".into();
        let bytes = write_mappe(&plan).unwrap();
        let a = blatt(&bytes, "Austausch");
        assert_eq!(a[1][0], "=HYPERLINK(\"x\")");
    }
}
