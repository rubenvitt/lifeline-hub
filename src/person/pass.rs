//! PASS-Liste (LLH-1198, Entwurf `docs/superpowers/specs/2026-11-24-sco62ku3-pass-liste-design.md`):
//! die Betroffenen eines Einsatzes in der Reihenfolge der Personenauskunftsstelle, als fertige
//! Texte. Die Zuordnung der Felder steht nur hier; CSV und Druckansicht zeigen dieselben Zeilen,
//! der Client ordnet nichts zu. Vorläufiges Format nach den Feldern des PASS-Erlasses NRW, bis ein
//! Muster der GSL.net-Importdatei vorliegt.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use utoipa::ToSchema;

use super::{Geschlecht, PersonAnzeige, PersonStatus, Sichtungskategorie, VerbleibArt};

/// Art der Betroffenheit, abgeleitet aus Status, Sichtung, Versorgung und Verbleib. Ein reiner
/// Server-Wert: auf den Draht geht nur sein Wort (`PassZeile::affectedness`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassBetroffenheit {
    Verstorben,
    Vermisst,
    VerletztErkrankt,
    Untergebracht,
    Unverletzt,
}

impl PassBetroffenheit {
    pub fn wort(&self) -> &'static str {
        match self {
            PassBetroffenheit::Verstorben => "verstorben",
            PassBetroffenheit::Vermisst => "vermisst",
            PassBetroffenheit::VerletztErkrankt => "verletzt/erkrankt",
            PassBetroffenheit::Untergebracht => "untergebracht",
            PassBetroffenheit::Unverletzt => "unverletzt",
        }
    }
}

/// Was die PASS-Liste von einer Person liest; aus [`PersonAnzeige`] gebildet.
#[derive(Debug, Clone, Default)]
pub struct PassEingabe<'a> {
    pub id: i64,
    pub registrier_nr: i64,
    pub status: Option<PersonStatus>,
    pub name: Option<&'a str>,
    pub vorname: Option<&'a str>,
    pub geschlecht: Option<Geschlecht>,
    pub geburtsdatum: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub anschrift: Option<&'a str>,
    pub erfasst_at: &'a str,
    pub sichtung: Option<Sichtungskategorie>,
    pub verbleib: Option<&'a str>,
    pub verbleib_art: Option<VerbleibArt>,
    pub uhs_id: Option<i64>,
}

impl<'a> From<&'a PersonAnzeige> for PassEingabe<'a> {
    fn from(p: &'a PersonAnzeige) -> Self {
        PassEingabe {
            id: p.id,
            registrier_nr: p.registrier_nr,
            status: Some(p.status),
            name: p.name.as_deref(),
            vorname: p.vorname.as_deref(),
            geschlecht: p.geschlecht,
            geburtsdatum: p.geburtsdatum.as_deref(),
            alter_geschaetzt: p.alter_geschaetzt,
            anschrift: p.herkunft_adresse.as_deref(),
            erfasst_at: &p.erfasst_at,
            sichtung: p.aktuelle_sichtung,
            verbleib: p.aktueller_verbleib.as_deref(),
            verbleib_art: p.aktuelle_verbleib_art,
            uhs_id: p.aktuelle_uhs_id,
        }
    }
}

/// Eine Zeile der PASS-Liste: je Spalte der fertige Text, leer = keine Angabe. Reihenfolge der
/// Felder = Reihenfolge der CSV-Spalten ([`KOPF`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PassZeile {
    pub id_label: String,
    pub last_name: String,
    pub first_name: String,
    pub birth_date: String,
    pub age: String,
    pub sex: String,
    pub address: String,
    pub affectedness: String,
    pub whereabouts: String,
    pub recorded_at: String,
}

/// Was die Zeilen außer der Person brauchen: Zone für „Erfasst am“, Bezeichnungen der UHS des
/// Einsatzes, Personen mit nicht aufgehobener Maßnahme oder Verletzung.
pub struct PassKontext<'a> {
    pub zone: chrono_tz::Tz,
    pub uhs_namen: &'a HashMap<i64, String>,
    pub mit_versorgung: &'a HashSet<i64>,
}

/// Kopfzeile des CSV, wörtlich aus dem Entwurf.
pub const KOPF: &str = "Kennung;Name;Vorname;Geburtsdatum;Alter (geschätzt);Geschlecht;Anschrift;Art der Betroffenheit;Verbleib;Erfasst am";

/// Die erste passende Regel gewinnt (Entscheidung 24.11.2026).
pub fn betroffenheit(p: &PassEingabe, hat_offene_versorgung: bool) -> PassBetroffenheit {
    use Sichtungskategorie as Sk;
    if p.status == Some(PersonStatus::Verstorben)
        || p.verbleib_art == Some(VerbleibArt::Verstorben)
        || p.sichtung == Some(Sk::Tot)
    {
        return PassBetroffenheit::Verstorben;
    }
    if p.status == Some(PersonStatus::Vermisst) {
        return PassBetroffenheit::Vermisst;
    }
    if matches!(p.sichtung, Some(Sk::Sk1 | Sk::Sk2 | Sk::Sk3 | Sk::Sk4)) || hat_offene_versorgung {
        return PassBetroffenheit::VerletztErkrankt;
    }
    if p.verbleib_art == Some(VerbleibArt::Notunterkunft) {
        return PassBetroffenheit::Untergebracht;
    }
    PassBetroffenheit::Unverletzt
}

fn geschlecht_wort(g: Geschlecht) -> &'static str {
    match g {
        Geschlecht::Maennlich => "männlich",
        Geschlecht::Weiblich => "weiblich",
        Geschlecht::Divers => "divers",
        Geschlecht::Unbekannt => "unbekannt",
    }
}

/// Kalenderdatum `JJJJ-MM-TT` als `TT.MM.JJJJ`; Altbestand, der keins ist, roh.
fn geburtsdatum_text(roh: &str) -> String {
    chrono::NaiveDate::parse_from_str(roh, "%Y-%m-%d")
        .map(|d| d.format("%d.%m.%Y").to_string())
        .unwrap_or_else(|_| roh.to_string())
}

fn verbleib_text(p: &PassEingabe, uhs_namen: &HashMap<i64, String>) -> String {
    if let Some(v) = p.verbleib.filter(|v| !v.trim().is_empty()) {
        return v.to_string();
    }
    match p.uhs_id {
        None => String::new(),
        Some(id) => match uhs_namen.get(&id) {
            Some(n) if n.starts_with("UHS") => n.clone(),
            Some(n) => format!("UHS {n}"),
            None => "UHS".to_string(),
        },
    }
}

fn zeile(p: &PassEingabe, k: &PassKontext) -> PassZeile {
    let geburtsdatum = p.geburtsdatum.filter(|g| !g.trim().is_empty());
    PassZeile {
        id_label: super::registrier_anzeige(p.registrier_nr),
        last_name: p.name.unwrap_or_default().to_string(),
        first_name: p.vorname.unwrap_or_default().to_string(),
        birth_date: geburtsdatum.map(geburtsdatum_text).unwrap_or_default(),
        age: match geburtsdatum {
            Some(_) => String::new(),
            None => p
                .alter_geschaetzt
                .map(|a| a.to_string())
                .unwrap_or_default(),
        },
        sex: p
            .geschlecht
            .map(geschlecht_wort)
            .unwrap_or_default()
            .to_string(),
        address: p.anschrift.unwrap_or_default().to_string(),
        affectedness: betroffenheit(p, k.mit_versorgung.contains(&p.id))
            .wort()
            .to_string(),
        whereabouts: verbleib_text(p, k.uhs_namen),
        recorded_at: match crate::zeit::parse_utc(p.erfasst_at) {
            Some(t) => t
                .with_timezone(&k.zone)
                .format("%d.%m.%Y %H:%M")
                .to_string(),
            None => p.erfasst_at.to_string(),
        },
    }
}

/// Bildet und sortiert die Zeilen: Name, Vorname, Registriernummer; ohne Namen ans Ende.
pub fn pass_zeilen(personen: &[PassEingabe], k: &PassKontext) -> Vec<PassZeile> {
    let schluessel = |p: &PassEingabe| {
        let name = p.name.map(str::trim).filter(|n| !n.is_empty());
        (
            name.is_none(),
            name.unwrap_or_default().to_lowercase(),
            p.vorname.unwrap_or_default().trim().to_lowercase(),
            p.registrier_nr,
        )
    };
    let mut sortiert: Vec<&PassEingabe> = personen.iter().collect();
    sortiert.sort_by_cached_key(|p| schluessel(p));
    sortiert.into_iter().map(|p| zeile(p, k)).collect()
}

/// CSV für Excel: UTF-8 mit BOM, `;`, CRLF, jedes Feld über [`csv_feld`].
pub fn pass_csv(zeilen: &[PassZeile]) -> String {
    let mut csv = format!("\u{FEFF}{KOPF}\r\n");
    for z in zeilen {
        let felder = [
            &z.id_label,
            &z.last_name,
            &z.first_name,
            &z.birth_date,
            &z.age,
            &z.sex,
            &z.address,
            &z.affectedness,
            &z.whereabouts,
            &z.recorded_at,
        ];
        let zeile: Vec<String> = felder.iter().map(|f| csv_feld(f)).collect();
        csv.push_str(&zeile.join(";"));
        csv.push_str("\r\n");
    }
    csv
}

/// Die PASS-Zeilen eines Einsatzes: alle nicht stornierten Personen (`repo::liste`), die
/// Bezeichnungen seiner UHS, die Personen mit nicht aufgehobener Maßnahme oder Verletzung und
/// die Zone der Servertexte (`zeitdarstellung::zeitstil_laden`). Protokolliert nicht: das tut,
/// wer die Daten ausliefert, und zwar vorher.
pub async fn pass_liste(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<PassZeile>, crate::error::AppError> {
    let personen = super::repo::liste(pool, einsatz_id, None).await?;
    let zone = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id)
        .await?
        .zone;
    let uhs_namen: HashMap<i64, String> =
        sqlx::query_as::<_, (i64, String)>("SELECT id, bezeichnung FROM uhs WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect();
    let mit_versorgung: HashSet<i64> = sqlx::query_scalar::<_, i64>(
        "SELECT person_id FROM person_massnahme \
          WHERE einsatz_id = ? AND aufgehoben_at IS NULL \
         UNION \
         SELECT person_id FROM person_verletzung \
          WHERE einsatz_id = ? AND aufgehoben_at IS NULL",
    )
    .bind(einsatz_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    let eingaben: Vec<PassEingabe> = personen.iter().map(PassEingabe::from).collect();
    let k = PassKontext {
        zone,
        uhs_namen: &uhs_namen,
        mit_versorgung: &mit_versorgung,
    };
    Ok(pass_zeilen(&eingaben, &k))
}

/// Einfaches CSV-Feld-Quoting (RFC 4180): in Anführungszeichen, innere `"` verdoppelt.
/// Entschärft zusätzlich Formel-Injektion (Excel/LibreOffice): Felder, die mit
/// =,+,-,@,Tab oder CR beginnen, werden mit einem führenden Apostroph neutralisiert.
pub fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn person() -> PassEingabe<'static> {
        PassEingabe {
            id: 1,
            registrier_nr: 1,
            status: Some(PersonStatus::Betroffen),
            erfasst_at: "2026-11-24 13:05:00",
            ..Default::default()
        }
    }

    fn zeile(p: PassEingabe, uhs: &HashMap<i64, String>) -> PassZeile {
        let leer = HashSet::new();
        let k = PassKontext {
            zone: chrono_tz::Europe::Berlin,
            uhs_namen: uhs,
            mit_versorgung: &leer,
        };
        pass_zeilen(&[p], &k).remove(0)
    }

    #[test]
    fn sichtung_tot_gilt_als_verstorben() {
        let p = PassEingabe {
            sichtung: Some(Sichtungskategorie::Tot),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Verstorben);
    }

    #[test]
    fn status_verstorben_vor_vermisst() {
        let p = PassEingabe {
            status: Some(PersonStatus::Verstorben),
            ..person()
        };
        assert_eq!(betroffenheit(&p, true), PassBetroffenheit::Verstorben);
    }

    #[test]
    fn verbleib_verstorben_gilt_als_verstorben() {
        let p = PassEingabe {
            verbleib_art: Some(VerbleibArt::Verstorben),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Verstorben);
    }

    #[test]
    fn vermisst_vor_verletzt() {
        let p = PassEingabe {
            status: Some(PersonStatus::Vermisst),
            sichtung: Some(Sichtungskategorie::Sk1),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Vermisst);
    }

    #[test]
    fn sk1_bis_sk4_gelten_als_verletzt() {
        for sk in [
            Sichtungskategorie::Sk1,
            Sichtungskategorie::Sk2,
            Sichtungskategorie::Sk3,
            Sichtungskategorie::Sk4,
        ] {
            let p = PassEingabe {
                sichtung: Some(sk),
                ..person()
            };
            assert_eq!(
                betroffenheit(&p, false),
                PassBetroffenheit::VerletztErkrankt,
                "{sk:?}"
            );
        }
    }

    #[test]
    fn sichtung_unverletzt_bleibt_unverletzt() {
        let p = PassEingabe {
            sichtung: Some(Sichtungskategorie::Unverletzt),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Unverletzt);
    }

    #[test]
    fn offene_versorgung_ohne_sichtung_gilt_als_verletzt() {
        assert_eq!(
            betroffenheit(&person(), true),
            PassBetroffenheit::VerletztErkrankt
        );
    }

    #[test]
    fn notunterkunft_gilt_als_untergebracht() {
        let p = PassEingabe {
            verbleib_art: Some(VerbleibArt::Notunterkunft),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Untergebracht);
    }

    #[test]
    fn abgemeldet_ohne_weiteres_ist_unverletzt() {
        let p = PassEingabe {
            status: Some(PersonStatus::Abgemeldet),
            ..person()
        };
        assert_eq!(betroffenheit(&p, false), PassBetroffenheit::Unverletzt);
    }

    #[test]
    fn geburtsdatum_wird_deutsch_und_alter_entfaellt() {
        let p = PassEingabe {
            geburtsdatum: Some("1950-03-07"),
            alter_geschaetzt: Some(70),
            ..person()
        };
        let z = zeile(p, &HashMap::new());
        assert_eq!(z.birth_date, "07.03.1950");
        assert_eq!(z.age, "");
    }

    #[test]
    fn geburtsdatum_altbestand_bleibt_roh() {
        let p = PassEingabe {
            geburtsdatum: Some("ca. 1950"),
            ..person()
        };
        assert_eq!(zeile(p, &HashMap::new()).birth_date, "ca. 1950");
    }

    #[test]
    fn ohne_geburtsdatum_steht_alter() {
        let p = PassEingabe {
            alter_geschaetzt: Some(40),
            ..person()
        };
        assert_eq!(zeile(p, &HashMap::new()).age, "40");
    }

    #[test]
    fn felder_kommen_als_fertige_texte() {
        let p = PassEingabe {
            registrier_nr: 7,
            name: Some("Muster"),
            vorname: Some("Erika"),
            geschlecht: Some(Geschlecht::Weiblich),
            anschrift: Some("Hauptstr. 1, Köln"),
            sichtung: Some(Sichtungskategorie::Sk2),
            ..person()
        };
        let z = zeile(p, &HashMap::new());
        assert_eq!(z.id_label, "R-007");
        assert_eq!(z.last_name, "Muster");
        assert_eq!(z.first_name, "Erika");
        assert_eq!(z.sex, "weiblich");
        assert_eq!(z.address, "Hauptstr. 1, Köln");
        assert_eq!(z.affectedness, "verletzt/erkrankt");
    }

    #[test]
    fn verbleib_uhs_ohne_verbleib() {
        let uhs = |n: &str| HashMap::from([(3, n.to_string())]);
        let p = || PassEingabe {
            uhs_id: Some(3),
            ..person()
        };
        assert_eq!(zeile(p(), &uhs("Halle 2")).whereabouts, "UHS Halle 2");
        assert_eq!(zeile(p(), &uhs("UHS Nord")).whereabouts, "UHS Nord");
        assert_eq!(zeile(p(), &HashMap::new()).whereabouts, "UHS");
    }

    #[test]
    fn verbleib_geht_vor_uhs() {
        let p = PassEingabe {
            verbleib: Some("Transport → KH Mitte"),
            uhs_id: Some(3),
            ..person()
        };
        let uhs = HashMap::from([(3, "Halle 2".to_string())]);
        assert_eq!(zeile(p, &uhs).whereabouts, "Transport → KH Mitte");
    }

    #[test]
    fn erfasst_at_in_ortszeit() {
        assert_eq!(
            zeile(person(), &HashMap::new()).recorded_at,
            "24.11.2026 14:05"
        );
    }

    #[test]
    fn sortiert_nach_name_vorname_kennung_namenlose_zuletzt() {
        let leer = HashSet::new();
        let uhs = HashMap::new();
        let k = PassKontext {
            zone: chrono_tz::Europe::Berlin,
            uhs_namen: &uhs,
            mit_versorgung: &leer,
        };
        let p = |nr: i64, name: Option<&'static str>, vorname: Option<&'static str>| PassEingabe {
            id: nr,
            registrier_nr: nr,
            name,
            vorname,
            ..person()
        };
        let zeilen = pass_zeilen(
            &[
                p(1, None, None),
                p(2, Some("meier"), Some("Udo")),
                p(3, Some("Adam"), Some("Zoe")),
                p(4, Some("Adam"), Some("anna")),
                p(5, Some("Meier"), Some("Udo")),
            ],
            &k,
        );
        let kennungen: Vec<_> = zeilen.iter().map(|z| z.id_label.as_str()).collect();
        assert_eq!(kennungen, ["R-004", "R-003", "R-002", "R-005", "R-001"]);
    }

    #[test]
    fn offene_versorgung_kommt_aus_dem_kontext() {
        let mit = HashSet::from([1]);
        let uhs = HashMap::new();
        let k = PassKontext {
            zone: chrono_tz::Europe::Berlin,
            uhs_namen: &uhs,
            mit_versorgung: &mit,
        };
        let zeilen = pass_zeilen(
            &[
                person(),
                PassEingabe {
                    id: 2,
                    registrier_nr: 2,
                    ..person()
                },
            ],
            &k,
        );
        assert_eq!(zeilen[0].affectedness, "verletzt/erkrankt");
        assert_eq!(zeilen[1].affectedness, "unverletzt");
    }

    #[test]
    fn csv_hat_bom_kopf_und_crlf() {
        let csv = pass_csv(&[zeile(person(), &HashMap::new())]);
        assert!(csv.starts_with(
            "\u{FEFF}Kennung;Name;Vorname;Geburtsdatum;Alter (geschätzt);Geschlecht;Anschrift;Art der Betroffenheit;Verbleib;Erfasst am\r\n"
        ));
        assert!(csv.ends_with("\r\n"));
        assert_eq!(csv.matches("\r\n").count(), 2);
        assert!(!csv.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn csv_entschaerft_formel() {
        let p = PassEingabe {
            name: Some("=SUM(A1)"),
            ..person()
        };
        let csv = pass_csv(&[zeile(p, &HashMap::new())]);
        assert!(csv.contains("\"'=SUM(A1)\""), "{csv}");
    }
}
