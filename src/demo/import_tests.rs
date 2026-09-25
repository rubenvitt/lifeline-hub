//! Repo-Tests des Imports `importieren_tx` (LFH-690, design.md D5, D6, D8, D9) gegen die voll
//! migrierte DB. Die HTTP-Route kommt in Block 5; bis dahin laufen die Prüfungen aus dem Brief
//! hier über `importieren_tx`, wie der Aufrufer sie fährt: in `write_retry!`.
//!
//! Der Importzeitpunkt ist fest ([`JETZT`]), damit Schrittzeiten als Literale vergleichbar sind.

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::SqlitePool;

use super::entfernen::entfernen_tx;
use super::import::{importieren_tx, ImportErgebnis};
use super::szenario::{self, EtbArt, Vorgang, DREHBUCH};
use super::test_hilfen::{
    admin_anlegen, anzahl, einsatz_anlegen, kataloge_seeden, org_anlegen, zeilen,
};
use super::{DemoBericht, DemoBerichtZeile, DemoStammdatenArt, DemoVorgang};
use crate::error::AppError;

// ---------------------------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------------------------

const JETZT: &str = "2026-09-25 12:00:00";
const ZEITFORMAT: &str = "%Y-%m-%d %H:%M:%S";

fn jetzt() -> NaiveDateTime {
    NaiveDateTime::parse_from_str(JETZT, ZEITFORMAT).unwrap()
}

fn zeit_vor(min: i64) -> String {
    (jetzt() - chrono::Duration::minutes(min))
        .format(ZEITFORMAT)
        .to_string()
}

struct Org {
    org: i64,
    admin: i64,
}

/// Org mit den Katalogen des Bootstraps und einem System-Admin, ohne Import.
async fn org_mit_admin(pool: &SqlitePool, org_id: i64) -> Org {
    org_anlegen(pool, org_id).await;
    kataloge_seeden(pool, org_id).await;
    let admin = admin_anlegen(pool, org_id).await;
    Org { org: org_id, admin }
}

/// Der Import so, wie die Route ihn fahren wird: eine `write_retry!`-Transaktion.
async fn importieren(
    pool: &SqlitePool,
    org: &Org,
    jetzt: NaiveDateTime,
) -> Result<ImportErgebnis, AppError> {
    crate::write_retry!(pool, |conn| {
        importieren_tx(conn, org.org, org.admin, jetzt).await
    })
}

/// Zeilenbild aller Tabellen, die ein Import beschreibt, instanzweit. `1 = ?` bindet den
/// einen Parameter, den `zeilen` verlangt.
async fn bild(pool: &SqlitePool) -> Vec<(&'static str, Vec<String>)> {
    let mut bild = Vec::new();
    for tabelle in [
        "einsatz",
        "einsatz_mitgliedschaft",
        "demo_import",
        "demo_herkunft",
        "fahrzeug",
        "personal",
        "personal_qualifikation",
        "material",
        "etb_eintrag",
        "einsatzabschnitt",
        "einsatz_einheit",
        "einsatz_fahrzeug",
        "einsatz_personal",
        "benutzer",
        // Block 4.3: die Module des vollständigen Drehbuchs.
        "einsatz_person",
        "person_sichtung",
        "person_uhs_belegung",
        "uhs",
        "uhs_platz",
        "bereitstellungsraum",
        "evakuierungsbezirk",
        "evakuierung_stand",
        "betreuungsstelle",
        "betreuungsstelle_belegung",
        "lage_zone",
        "gefahrengebiet",
        "gefahr_bewertung",
        "meldung",
        "auftrag",
        "auftrag_empfaenger",
        "kommunikation_status",
        "befehl",
        "lagebericht",
        "erinnerung",
    ] {
        bild.push((tabelle, zeilen(pool, tabelle, "1 = ?", 1).await));
    }
    bild
}

/// ETB des Einsatzes nach `lfd_nr`: (lfd_nr, typ, inhalt, ereigniszeit, received_at).
async fn etb(pool: &SqlitePool, einsatz_id: i64) -> Vec<(i64, String, String, String, String)> {
    sqlx::query_as(
        "SELECT lfd_nr, typ, inhalt, ereigniszeit, received_at FROM etb_eintrag \
         WHERE einsatz_id = ? ORDER BY lfd_nr",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn erwarte_status(ergebnis: Result<ImportErgebnis, AppError>, status: u16, enthaelt: &str) {
    match ergebnis {
        Err(e) => {
            assert_eq!(e.status().as_u16(), status, "{e:?}");
            assert!(
                e.to_string().contains(enthaelt),
                "Meldung „{e}“ nennt nicht „{enthaelt}“"
            );
        }
        Ok(erg) => panic!("erwartet {status}, bekommen Ok({erg:?})"),
    }
}

/// Die ETB-Einträge, die das Drehbuch erzeugen muss, in Zeitfolge: (typ, inhalt, Schrittzeit).
/// Nachgerechnet aus den Daten und den Katalog-Startlisten, mit denselben Textfunktionen wie
/// Handler und Import; die Zahl und einzelne Wortlaute pinnt der Test daneben als Literal.
fn erwartete_etb() -> Vec<(String, String, String)> {
    let funkruf = |schluessel: &str| {
        szenario::FAHRZEUGE
            .iter()
            .find(|f| f.schluessel == schluessel)
            .unwrap()
            .funkrufname
    };
    let fms_label = |anker: i64| {
        crate::fahrzeug::STATUS_STARTLISTE
            .iter()
            .find(|(_, _, a, _)| *a == anker)
            .unwrap()
            .0
    };
    let erster_gebunden = crate::fahrzeug::STATUS_STARTLISTE
        .iter()
        .filter(|(_, k, _, _)| *k == crate::katalog::KATEGORIE_GEBUNDEN)
        .min_by_key(|(_, _, _, sortier)| *sortier)
        .unwrap()
        .0;
    let quali_sortier = |label: &str| {
        crate::personal::QUALIFIKATION_STARTLISTE
            .iter()
            .find(|(l, _)| *l == label)
            .unwrap()
            .1
    };

    let personal_name = |schluessel: &str| {
        szenario::PERSONAL
            .iter()
            .find(|p| p.schluessel == schluessel)
            .unwrap()
            .name
    };
    // Befehl und Lagebericht: Skelett der Vorlage, befüllt aus dem Szenario.
    let befuellt = |schluessel: &[&str], d: &szenario::DokumentVorlage| -> Vec<(String, String)> {
        schluessel
            .iter()
            .map(|k| {
                let text = d
                    .abschnitte
                    .iter()
                    .find(|(s, _)| s == k)
                    .map(|(_, t)| t.to_string())
                    .unwrap_or_default();
                (k.to_string(), text)
            })
            .collect()
    };

    let mut einheiten = BTreeMap::new();
    let mut status: BTreeMap<&str, &str> = BTreeMap::new();
    let mut uhs = BTreeMap::new();
    let mut registrier_nr = 0;
    // Bezirk: (Bezeichnung, Plangröße, letzter Stand); Stelle: (Bezeichnung, Kapazität,
    // letzte Belegung).
    let mut bezirke: BTreeMap<&str, (&str, i64, Option<i64>)> = BTreeMap::new();
    let mut stellen: BTreeMap<&str, (&str, i64, Option<i64>)> = BTreeMap::new();
    let mut erwartet = Vec::new();
    for schritt in DREHBUCH {
        let zeit = zeit_vor(schritt.vor_min);
        let mut eintrag =
            |typ: &str, inhalt: String| erwartet.push((typ.to_string(), inhalt, zeit.clone()));
        match schritt.vorgang {
            Vorgang::PersonalZuEinheit { personal, einheit } => eintrag(
                "system",
                crate::einheit::etb_text_personal_zugeordnet(
                    einheiten[einheit],
                    personal_name(personal),
                ),
            ),
            Vorgang::Gefahrengebiet(v) => {
                eintrag(
                    "system",
                    crate::lage_zone::etb_text("gefahrengebiet", Some(v.label), "eingerichtet"),
                );
                eintrag(
                    "system",
                    crate::gefahr::etb_text_bewertung(
                        v.gefahrentyp,
                        v.schutzobjekt,
                        Some(v.label),
                        0,
                        v.warnstufe,
                    ),
                );
            }
            Vorgang::Uhs(v) => {
                uhs.insert(v.schluessel, v.bezeichnung);
                eintrag(
                    "system",
                    crate::uhs::etb_text_status(v.bezeichnung, v.typ, "aktiv").unwrap(),
                );
            }
            Vorgang::Bereitstellungsraum(v) => eintrag(
                "system",
                crate::bereitstellungsraum::etb_text_status(v.bezeichnung, "aktiv").unwrap(),
            ),
            Vorgang::Person(v) => {
                registrier_nr += 1;
                eintrag("system", crate::person::etb_text_erfasst(registrier_nr));
                if let Some(k) = v.sichtung {
                    eintrag("system", crate::person::etb_text_sichtung(registrier_nr, k));
                }
                if let Some(u) = v.uhs {
                    eintrag(
                        "system",
                        crate::person::etb_text_uhs_aufnahme(registrier_nr, uhs[u]),
                    );
                }
            }
            Vorgang::Bezirk(v) => {
                bezirke.insert(v.schluessel, (v.bezeichnung, v.plan_personen, None));
                eintrag(
                    "entscheidung",
                    crate::betreuung::etb_text::bezirk_angelegt(
                        v.bezeichnung,
                        v.plan_personen,
                        v.plan_erhebung,
                    ),
                );
            }
            Vorgang::Stand {
                bezirk,
                evakuiert,
                erhebung,
            } => {
                let (bez, plan, vorher) = bezirke[bezirk];
                eintrag(
                    "meldung",
                    crate::betreuung::etb_text::stand_gemeldet(
                        bez, evakuiert, erhebung, vorher, plan,
                    ),
                );
                bezirke.insert(bezirk, (bez, plan, Some(evakuiert)));
            }
            Vorgang::Stelle(v) => {
                stellen.insert(v.schluessel, (v.bezeichnung, v.kapazitaet, None));
                eintrag(
                    "system",
                    crate::betreuung::etb_text::stelle_angelegt(
                        v.bezeichnung,
                        v.art,
                        Some(v.kapazitaet),
                    ),
                );
            }
            Vorgang::StelleInBetrieb { stelle, .. } => eintrag(
                "system",
                crate::betreuung::etb_text::stelle_status(
                    stellen[stelle].0,
                    crate::betreuung::BetreuungsstelleStatus::InBetrieb,
                    crate::betreuung::BetreuungsstelleStatus::Vorbereitet,
                ),
            ),
            Vorgang::Belegung { stelle, belegt } => {
                let (bez, kap, vorher) = stellen[stelle];
                eintrag(
                    "meldung",
                    crate::betreuung::etb_text::belegung_gemeldet(bez, belegt, vorher, Some(kap)),
                );
                stellen.insert(stelle, (bez, kap, Some(belegt)));
            }
            Vorgang::Meldung(v) => eintrag("meldung", v.inhalt.to_string()),
            Vorgang::Auftrag(v) => eintrag("anordnung", v.text.to_string()),
            Vorgang::AuftragVollzug { meldung, .. } => eintrag("meldung", meldung.to_string()),
            Vorgang::Befehl(d) => {
                let v = crate::befehl::vorlage(d.vorlage).unwrap();
                let schluessel: Vec<&str> = v.abschnitte.iter().map(|a| a.schluessel).collect();
                let abschnitte: Vec<crate::befehl::Abschnitt> = befuellt(&schluessel, &d)
                    .into_iter()
                    .map(|(schluessel, text)| crate::befehl::Abschnitt { schluessel, text })
                    .collect();
                eintrag(
                    "anordnung",
                    crate::befehl::render_snapshot(v, d.titel, &zeit, &abschnitte),
                );
            }
            Vorgang::Lagebericht(d) => {
                let v = crate::lagebericht::vorlage(d.vorlage).unwrap();
                let schluessel: Vec<&str> = v.abschnitte.iter().map(|a| a.schluessel).collect();
                let abschnitte: Vec<crate::lagebericht::Abschnitt> = befuellt(&schluessel, &d)
                    .into_iter()
                    .map(|(schluessel, text)| crate::lagebericht::Abschnitt { schluessel, text })
                    .collect();
                eintrag(
                    "lage",
                    crate::lagebericht::render_snapshot(v, d.titel, &zeit, &abschnitte),
                );
            }
            Vorgang::Erinnerung(_) | Vorgang::ErinnerungErledigt { .. } => {}
            Vorgang::Abschnitt(v) => eintrag(
                "system",
                crate::einsatzabschnitt::etb_text_angelegt(v.name, v.lagezustand),
            ),
            Vorgang::Einheit(v) => {
                einheiten.insert(v.schluessel, v.name);
                eintrag("system", crate::einheit::etb_text_gebildet(v.name));
            }
            Vorgang::FahrzeugDisponieren { fahrzeug } => {
                status.insert(fahrzeug, erster_gebunden);
                eintrag(
                    "system",
                    crate::fahrzeug::etb_text_disponiert(funkruf(fahrzeug)),
                );
            }
            Vorgang::FahrzeugZuEinheit { fahrzeug, einheit } => eintrag(
                "system",
                crate::einheit::etb_text_fahrzeug_zugeordnet(einheiten[einheit], funkruf(fahrzeug)),
            ),
            Vorgang::FmsStatus { fahrzeug, fms } => {
                let alt = status[fahrzeug];
                let neu = fms_label(fms);
                if alt != neu {
                    eintrag(
                        "system",
                        crate::fahrzeug::etb_text_status_wechsel(
                            funkruf(fahrzeug),
                            Some(alt),
                            Some(neu),
                        ),
                    );
                }
                status.insert(fahrzeug, neu);
            }
            Vorgang::PersonalDisponieren { personal } => {
                let p = szenario::PERSONAL
                    .iter()
                    .find(|p| p.schluessel == personal)
                    .unwrap();
                let mut qualis = p.qualifikationen.to_vec();
                qualis.sort_by_key(|q| quali_sortier(q));
                let funktion = qualis.join(", ");
                eintrag(
                    "system",
                    crate::personal::etb_text_disponiert(p.name, Some(&funktion)),
                );
            }
            Vorgang::Etb { art, inhalt, .. } => eintrag(art.typ(), inhalt.to_string()),
        }
    }
    erwartet
}

// ---------------------------------------------------------------------------------------------
// Einsatz, Kopf, Bericht
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn import_legt_den_uebungseinsatz_samt_kopf_und_bericht_an() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let (org, bezeichnung, einsatzart, stichwort, begonnen, status): (
        i64,
        String,
        String,
        Option<String>,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT org_id, bezeichnung, einsatzart, stichwort, begonnen_at, status \
         FROM einsatz WHERE id = ?",
    )
    .bind(erg.einsatz_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(org, o.org);
    assert!(bezeichnung.starts_with("ÜBUNG – "), "{bezeichnung}");
    assert_eq!(bezeichnung, "ÜBUNG – Starkregen Musterstadt");
    assert_eq!(einsatzart, "uebung");
    assert_eq!(stichwort.as_deref(), Some("Unwetter – Starkregen"));
    assert_eq!(begonnen, "2026-09-25 07:00:00", "Beginn T−5 h");
    assert_eq!(status, "aktiv");

    let (kopf_org, kopf_einsatz, von, at, entfernt, json): (
        i64,
        i64,
        Option<i64>,
        String,
        Option<String>,
        String,
    ) = sqlx::query_as(
        "SELECT org_id, einsatz_id, importiert_von, importiert_at, entfernt_at, bericht \
         FROM demo_import WHERE id = ?",
    )
    .bind(erg.import_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kopf_org, o.org);
    assert_eq!(kopf_einsatz, erg.einsatz_id);
    assert_eq!(von, Some(o.admin));
    assert_eq!(at, JETZT);
    assert_eq!(entfernt, None);

    let zeile = |art, angelegt| DemoBerichtZeile {
        art,
        angelegt,
        mitbenutzt: 0,
        entfernt: 0,
        behalten: 0,
    };
    let erwartet = DemoBericht {
        vorgang: DemoVorgang::Importiert,
        zeitpunkt: JETZT.into(),
        je_art: vec![
            zeile(DemoStammdatenArt::Fahrzeug, 8),
            zeile(DemoStammdatenArt::Personal, 12),
            zeile(DemoStammdatenArt::Material, 4),
        ],
    };
    assert_eq!(erg.bericht, erwartet);
    assert_eq!(
        serde_json::from_str::<DemoBericht>(&json).unwrap(),
        erwartet,
        "gespeicherter Bericht == Rückgabe"
    );
}

/// Einzige Mitgliedschaft ist der Admin als Einsatzleitung; der Import legt kein
/// Benutzerkonto an und ändert keins.
#[tokio::test]
async fn einzige_mitgliedschaft_ist_der_admin_und_benutzer_bleiben_zeilengleich() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    // Ein weiteres Konto derselben Org: es darf nicht Mitglied werden.
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'Weitere Person', 'weitere', 'x')",
    )
    .bind(o.org)
    .execute(&pool)
    .await
    .unwrap();
    let vorher = zeilen(&pool, "benutzer", "1 = ?", 1).await;
    assert_eq!(vorher.len(), 2, "Vorbedingung: zwei Konten");

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let mitglieder: Vec<(i64, String)> = sqlx::query_as(
        "SELECT benutzer_id, einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = ?",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        mitglieder,
        vec![(o.admin, crate::einsatz::EINSATZ_ROLLE_LEITUNG.to_string())]
    );
    assert_eq!(zeilen(&pool, "benutzer", "1 = ?", 1).await, vorher);
}

// ---------------------------------------------------------------------------------------------
// Drehbuch
// ---------------------------------------------------------------------------------------------

/// Abschnitte nach D9: vier, EA 1.1 unter EA 1, Lagezustand gemischt, Fortschritt teils leer.
/// Einheiten mit Typ aus dem Katalog, je einem Abschnitt zugeordnet.
#[tokio::test]
async fn abschnitte_und_einheiten_nach_dem_drehbuch() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let abschnitte: Vec<(String, String, Option<String>, Option<String>, Option<i64>)> =
        sqlx::query_as(
            "SELECT a.kurzbezeichnung, a.name, u.kurzbezeichnung, a.lagezustand, a.fortschritt \
             FROM einsatzabschnitt a LEFT JOIN einsatzabschnitt u ON u.id = a.ueber_abschnitt_id \
             WHERE a.einsatz_id = ? ORDER BY a.id",
        )
        .bind(erg.einsatz_id)
        .fetch_all(&pool)
        .await
        .unwrap();
    let s = |x: &str| x.to_string();
    assert_eq!(
        abschnitte,
        vec![
            (
                s("EA 1"),
                s("Sanitätsdienst"),
                None,
                Some(s("angespannt")),
                Some(40)
            ),
            (
                s("EA 2"),
                s("Betreuung"),
                None,
                Some(s("planmaessig")),
                None
            ),
            (
                s("EA 3"),
                s("Logistik"),
                None,
                Some(s("planmaessig")),
                Some(70)
            ),
            (
                s("EA 1.1"),
                s("UHS Turnhalle"),
                Some(s("EA 1")),
                Some(s("kritisch")),
                Some(25)
            ),
        ]
    );

    let einheiten: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT e.name, t.label, a.kurzbezeichnung, t.org_id FROM einsatz_einheit e \
         JOIN einheit_typ t ON t.id = e.typ_id JOIN einsatzabschnitt a ON a.id = e.abschnitt_id \
         WHERE e.einsatz_id = ? ORDER BY e.id",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        einheiten,
        vec![
            (s("Sanitätszug Musterstadt"), s("Zug"), s("EA 1"), o.org),
            (s("Rettungsstaffel"), s("Staffel"), s("EA 1"), o.org),
            (s("Betreuungsgruppe"), s("Gruppe"), s("EA 2"), o.org),
            (s("Logistiktrupp"), s("Trupp"), s("EA 3"), o.org),
            (s("Sanitätsgruppe UHS"), s("Gruppe"), s("EA 1.1"), o.org),
        ]
    );
}

/// Alle acht Stamm-Fahrzeuge disponiert und einer Einheit zugeordnet, FMS gemischt 2 · 3 · 4
/// · 6; alle zwölf Personen disponiert mit einem `gebunden`-Status.
#[tokio::test]
async fn fahrzeuge_und_personal_disponiert_fms_gemischt() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let fahrzeuge: Vec<(String, Option<i64>, String, i64)> = sqlx::query_as(
        "SELECT ef.snap_funkrufname, s.fms_anker, e.name, s.org_id FROM einsatz_fahrzeug ef \
         JOIN fahrzeug_status s ON s.id = ef.status_id \
         JOIN einsatz_einheit e ON e.id = ef.einheit_id \
         JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.einsatz_id = ? ORDER BY f.id",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let s = |x: &str| x.to_string();
    assert_eq!(
        fahrzeuge,
        vec![
            (
                s("Musterstadt 11-1"),
                Some(4),
                s("Sanitätszug Musterstadt"),
                o.org
            ),
            (s("Musterstadt 83-1"), Some(4), s("Rettungsstaffel"), o.org),
            (s("Musterstadt 83-2"), Some(3), s("Rettungsstaffel"), o.org),
            (
                s("Musterstadt 85-1"),
                Some(2),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (
                s("Musterstadt 85-2"),
                Some(6),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (
                s("Musterstadt 64-1"),
                Some(4),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (s("Musterstadt 19-1"), Some(4), s("Betreuungsgruppe"), o.org),
            (s("Musterstadt 93-1"), Some(3), s("Logistiktrupp"), o.org),
        ]
    );

    let personal: Vec<(String, String)> = sqlx::query_as(
        "SELECT ep.snap_name, s.kategorie FROM einsatz_personal ep \
         JOIN personal_status s ON s.id = ep.status_id \
         JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einsatz_id = ? AND p.org_id = ? ORDER BY p.id",
    )
    .bind(erg.einsatz_id)
    .bind(o.org)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        personal.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
        szenario::PERSONAL
            .iter()
            .map(|p| p.name)
            .collect::<Vec<_>>()
    );
    assert!(
        personal.iter().all(|(_, k)| k == "gebunden"),
        "{personal:?}"
    );
}

/// Der ETB folgt dem Drehbuch Eintrag für Eintrag: Typ, Wortlaut und Schrittzeit, in der
/// Reihenfolge der laufenden Nummer. Das pinnt die System-Einträge je Vorgangsart (D5) und
/// die Zeitfolge zugleich.
#[tokio::test]
async fn etb_folgt_dem_drehbuch_mit_system_eintraegen_je_vorgang() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let ist = etb(&pool, erg.einsatz_id).await;
    let erwartet = erwartete_etb();
    assert_eq!(ist.len(), 131, "Zahl der ETB-Einträge des Drehbuchs");
    assert_eq!(
        ist.iter()
            .map(|(_, typ, inhalt, zeit, _)| (typ.clone(), inhalt.clone(), zeit.clone()))
            .collect::<Vec<_>>(),
        erwartet
    );
    assert_eq!(
        ist.iter().map(|e| e.0).collect::<Vec<_>>(),
        (1..=ist.len() as i64).collect::<Vec<i64>>(),
        "laufende Nummer ab dem Startwert 1, lückenlos"
    );

    let je_typ = |typ: &str| ist.iter().filter(|e| e.1 == typ).count();
    // Alle fünf Pflicht-Typen der Spec: Lage 5 + Lagebericht; Entscheidung 5 + Bezirk
    // angeordnet; Meldung 8 Meldungen + 3 Vollzüge + 2 Stand- + 2 Belegungsmeldungen;
    // Anordnung 5 Aufträge + Befehl; System aus den Vorgängen.
    assert_eq!(je_typ("lage"), 6);
    assert_eq!(je_typ("entscheidung"), 6);
    assert_eq!(je_typ("meldung"), 15);
    assert_eq!(je_typ("anordnung"), 6);
    assert_eq!(je_typ("system"), 98);

    // Einzelne Wortlaute als Literal, unabhängig von den Textfunktionen.
    let inhalte: Vec<&str> = ist.iter().map(|e| e.2.as_str()).collect();
    for literal in [
        "Abschnitt «Sanitätsdienst» angelegt (Lage: angespannt)",
        "Abschnitt «UHS Turnhalle» angelegt (Lage: kritisch)",
        "Einheit «Sanitätsgruppe UHS» gebildet",
        "Fahrzeug «Musterstadt 85-2» disponiert",
        "Einheit «Rettungsstaffel»: Fahrzeug «Musterstadt 83-2» zugeordnet",
        "Fahrzeug «Musterstadt 85-2»: Status «4 – Am Einsatzort» → «6 – Nicht einsatzbereit»",
        "Person «Max Mustermann (Zugführer, Sprechfunker)» disponiert",
        "Einheit «Rettungsstaffel»: «Anna Probe» zugeordnet",
        "Gefahrengebiet «Überflutung Unterstadt» eingerichtet",
        "Gefahr «Ertrinken» für «Menschen» in «Überflutung Unterstadt» auf Warnstufe «hoch» gesetzt.",
        "Gefahr «Einsturz» für «Sachwerte» in «Hangrutsch Kirchberg» auf Warnstufe «mittel» gesetzt.",
        "Bereitstellungsraum Parkplatz Stadion Nord in Betrieb genommen",
        "Person R-009: Sichtung SK I",
        "Person R-001: Aufnahme in Turnhalle Musterstadt (Inbox)",
        "Person R-012 erfasst",
    ] {
        assert!(inhalte.contains(&literal), "fehlt: {literal}");
    }
    // Der Bezirk schreibt seine Entscheidung ohne fachliches Zeitfeld; der Import stellt sie
    // auf die Schrittzeit T−228 min (Nachtrag D9), nicht auf `datetime('now')`.
    let bezirk: Vec<&(i64, String, String, String, String)> = ist
        .iter()
        .filter(|e| e.1 == "entscheidung" && e.2.starts_with("Evakuierung Bezirk"))
        .collect();
    assert_eq!(bezirk.len(), 1);
    assert_eq!(bezirk[0].3, "2026-09-25 08:12:00");
}

/// Szenariouhr (D9): jeder Eintrag trägt als Eingangszeit seine Ereigniszeit, die
/// Ereigniszeiten steigen mit der laufenden Nummer, der erste liegt beim Einsatzbeginn, der
/// jüngste vor dem Importzeitpunkt.
#[tokio::test]
async fn etb_chronologie_und_eingangszeit_gleich_ereigniszeit() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let ist = etb(&pool, erg.einsatz_id).await;
    assert!(!ist.is_empty());
    for (lfd, _, inhalt, ereignis, eingang) in &ist {
        assert_eq!(
            eingang, ereignis,
            "Nr. {lfd} «{inhalt}»: keine Nachtrag-Marke"
        );
    }
    for paar in ist.windows(2) {
        assert!(
            paar[0].3 <= paar[1].3,
            "Ereigniszeit fällt: Nr. {} {} → Nr. {} {}",
            paar[0].0,
            paar[0].3,
            paar[1].0,
            paar[1].3
        );
    }
    assert_eq!(
        ist[0].3, "2026-09-25 07:00:00",
        "erster Eintrag beim Einsatzbeginn"
    );
    assert!(
        ist[ist.len() - 1].3.as_str() < JETZT,
        "jüngster vor dem Import"
    );
}

/// Die Szenariouhr ist an den Demo-Einsatz gebunden: ein vorher angelegter Nachbar-Einsatz mit
/// nachgetragenem Fach- und einem System-Eintrag behält beide Zeitstempel zeilengleich.
#[tokio::test]
async fn nachbar_einsatz_behaelt_seine_etb_zeiten() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let nachbar = einsatz_anlegen(&pool, o.admin, "Echter Einsatz").await;
    for (lfd, typ, ereignis, eingang) in [
        (1, "lage", "2026-09-25 08:00:00", "2026-09-25 09:30:00"),
        (2, "system", "2026-09-25 09:00:00", "2026-09-25 09:00:05"),
    ] {
        sqlx::query(
            "INSERT INTO etb_eintrag \
                (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, received_at) \
             VALUES (?, ?, ?, 'Nachbar', ?, ?, ?)",
        )
        .bind(nachbar)
        .bind(lfd)
        .bind(typ)
        .bind(o.admin)
        .bind(ereignis)
        .bind(eingang)
        .execute(&pool)
        .await
        .unwrap();
    }
    let vorher = zeilen(&pool, "etb_eintrag", "einsatz_id = ?", nachbar).await;
    assert_eq!(vorher.len(), 2);

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    assert!(erg.einsatz_id > nachbar);
    assert_eq!(
        zeilen(&pool, "etb_eintrag", "einsatz_id = ?", nachbar).await,
        vorher
    );
}

// ---------------------------------------------------------------------------------------------
// Szenario: Lage, Betroffene und Module (Block 4.3)
// ---------------------------------------------------------------------------------------------

/// Spec „Überblick zeigt die Lage“: der Einsatz meldet die Lagekennzahl `evakuiert`, aber keine
/// `pegel`. Gelesen über `einsatz::repo::laden` und `lagekennzahl::ableiten`, dieselbe Ableitung
/// wie die Einsatzanzeige. Dazu die Abwesenheit selbst: kein maßgeblicher Pegel (Spec: „Einen
/// maßgeblichen Pegel MUST NOT der Import festlegen“).
#[tokio::test]
async fn ueberblick_zeigt_evakuiert_und_keinen_pegel() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let e = crate::einsatz::repo::laden(&pool, erg.einsatz_id)
        .await
        .unwrap();
    let kennzahlen =
        crate::einsatz::lagekennzahl::ableiten(e.pegel_festgelegt, e.evakuierung_angeordnet);
    assert_eq!(
        kennzahlen,
        vec![crate::einsatz::lagekennzahl::Lagekennzahl::Evakuiert]
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz_pegel WHERE einsatz_id = ?",
            erg.einsatz_id
        )
        .await,
        0,
        "kein maßgeblicher Pegel"
    );
}

/// Spec „Sichtung nach BBK“: jede Kategorie SK I–IV kommt vor, verteilt nach D9 (I ×1, II ×3,
/// III ×6, IV ×1), dazu eine Person ohne Sichtung. Zwölf Betroffene mit fiktiven Namen.
#[tokio::test]
async fn sichtung_nach_bbk() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let je_kategorie: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT aktuelle_sichtung, COUNT(*) FROM einsatz_person WHERE einsatz_id = ? \
         GROUP BY aktuelle_sichtung ORDER BY aktuelle_sichtung",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let s = |x: &str| Some(x.to_string());
    assert_eq!(
        je_kategorie,
        vec![
            (None, 1),
            (s("sk1"), 1),
            (s("sk2"), 3),
            (s("sk3"), 6),
            (s("sk4"), 1)
        ]
    );
    // Die Sichtungskette trägt dieselben Kategorien (Erst-Sichtung beim Anlegen).
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM person_sichtung WHERE einsatz_id = ?",
            erg.einsatz_id
        )
        .await,
        11
    );
    // Registriernummern über den Betriebsweg: 1…12 lückenlos.
    let nummern: Vec<i64> = sqlx::query_scalar(
        "SELECT registrier_nr FROM einsatz_person WHERE einsatz_id = ? ORDER BY registrier_nr",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(nummern, (1..=12).collect::<Vec<i64>>());
    // Gesichtete sind `betroffen`, die ungesichtete bleibt `erfasst`.
    let status: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*) FROM einsatz_person WHERE einsatz_id = ? \
         GROUP BY status ORDER BY status",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        status,
        vec![("betroffen".to_string(), 11), ("erfasst".to_string(), 1)]
    );
}

/// Je Modul der Zustand aus D9, auf Zeilenebene: UHS aktiv mit Plätzen und Belegten, BR aktiv,
/// Betreuungsstelle in Betrieb mit zwei Belegungsmeldungen, Bezirk mit Plangröße und zwei
/// Standmeldungen, zwei Gefahrengebiete mit Warnstufe, acht Meldungen, fünf Aufträge, Befehl
/// und Lagebericht freigegeben, drei Erinnerungen, alles Personal einer Einheit zugeordnet.
#[tokio::test]
async fn module_nach_dem_drehbuch() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");
    let e = erg.einsatz_id;
    let zahl = |sql: &'static str| {
        let pool = pool.clone();
        async move { anzahl(&pool, sql, e).await }
    };

    // UHS
    let uhs: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT u.bezeichnung, u.status, a.kurzbezeichnung FROM uhs u \
         JOIN einsatzabschnitt a ON a.id = u.abschnitt_id WHERE u.einsatz_id = ?",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        uhs,
        vec![(
            "Turnhalle Musterstadt".to_string(),
            "aktiv".to_string(),
            "EA 1.1".to_string()
        )]
    );
    assert_eq!(
        zahl(
            "SELECT COUNT(*) FROM uhs_platz p JOIN uhs u ON u.id = p.uhs_id WHERE u.einsatz_id = ?"
        )
        .await,
        6
    );
    assert_eq!(
        zahl("SELECT COUNT(*) FROM person_uhs_belegung WHERE einsatz_id = ? AND art = 'eintritt'")
            .await,
        8
    );

    // Bereitstellungsraum: aktiv, ohne Belegung (siehe Report 4.3).
    let br: Vec<(String, String)> =
        sqlx::query_as("SELECT bezeichnung, status FROM bereitstellungsraum WHERE einsatz_id = ?")
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        br,
        vec![("Parkplatz Stadion Nord".to_string(), "aktiv".to_string())]
    );

    // Betreuung
    let stelle: Vec<(String, String, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT s.bezeichnung, s.status, s.kapazitaet_personen, b.belegt \
         FROM betreuungsstelle s LEFT JOIN betreuungsstelle_belegung b ON b.id = s.belegung_id \
         WHERE s.einsatz_id = ?",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        stelle,
        vec![(
            "Gesamtschule".to_string(),
            "in_betrieb".to_string(),
            Some(150),
            Some(71)
        )]
    );
    assert_eq!(
        zahl("SELECT COUNT(*) FROM betreuungsstelle_belegung WHERE einsatz_id = ?").await,
        2
    );
    let bezirk: Vec<(String, String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT b.bezeichnung, b.raeumung, b.plan_personen, s.evakuiert \
         FROM evakuierungsbezirk b LEFT JOIN evakuierung_stand s ON s.id = b.stand_id \
         WHERE b.einsatz_id = ?",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        bezirk,
        vec![(
            "Mühlbachweg 1–40".to_string(),
            "angeordnet".to_string(),
            120,
            Some(96)
        )]
    );
    assert_eq!(
        zahl("SELECT COUNT(*) FROM evakuierung_stand WHERE einsatz_id = ?").await,
        2
    );

    // Gefahrengebiete mit Warnstufe, Geometrie als Polygon.
    let gebiete: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT z.label, z.geometrie_typ, b.gefahrentyp, b.schutzobjekt, b.warnstufe \
         FROM lage_zone z JOIN gefahr_bewertung b ON b.gefahrengebiet_id = z.gefahrengebiet_id \
         WHERE z.einsatz_id = ? AND z.typ = 'gefahrengebiet' ORDER BY z.id",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    let s = |x: &str| x.to_string();
    assert_eq!(
        gebiete,
        vec![
            (
                s("Überflutung Unterstadt"),
                s("Polygon"),
                s("ertrinken"),
                s("menschen"),
                s("hoch")
            ),
            (
                s("Hangrutsch Kirchberg"),
                s("Polygon"),
                s("einsturz"),
                s("sachwerte"),
                s("mittel")
            ),
        ]
    );

    // Meldungen: acht, davon fünf Rückmeldungen mit Einheit, eine Sofortmeldung bestätigt.
    assert_eq!(
        zahl("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?").await,
        8
    );
    assert_eq!(
        zahl("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ? AND einheit_id IS NOT NULL").await,
        5
    );
    assert_eq!(
        zahl(
            "SELECT COUNT(*) FROM meldung m JOIN kommunikation_status k \
             ON k.objekt_typ = 'meldung' AND k.objekt_id = m.id \
             WHERE m.einsatz_id = ? AND m.meldungsart = 'sofortmeldung' \
             AND m.bestaetigung_pflicht = 1 AND k.quittiert_at IS NOT NULL"
        )
        .await,
        1,
        "die Sofortmeldung ist bestätigt"
    );

    // Nummernkreise über den Betriebsweg (Spec „Demo-Einsatz“): lückenlos ab dem Startwert 1.
    let meldung_nr: Vec<i64> =
        sqlx::query_scalar("SELECT lfd_nr FROM meldung WHERE einsatz_id = ? ORDER BY lfd_nr")
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(meldung_nr, (1..=8).collect::<Vec<i64>>());
    let auftrag_nr: Vec<i64> =
        sqlx::query_scalar("SELECT lfd_nr FROM auftrag WHERE einsatz_id = ? ORDER BY lfd_nr")
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(auftrag_nr, (1..=5).collect::<Vec<i64>>());

    // Aufträge: fünf, drei vollzogen, keiner mit Frist.
    assert_eq!(
        zahl("SELECT COUNT(*) FROM auftrag WHERE einsatz_id = ?").await,
        5
    );
    assert_eq!(
        zahl(
            "SELECT COUNT(*) FROM kommunikation_status WHERE einsatz_id = ? \
             AND objekt_typ = 'auftrag' AND vollzug_status = 'vollzogen'"
        )
        .await,
        3
    );
    assert_eq!(
        zahl("SELECT COUNT(*) FROM auftrag WHERE einsatz_id = ? AND frist_at IS NOT NULL").await,
        0
    );

    // Befehl und Lagebericht freigegeben; der Lagebericht steht auf T−1 h.
    let befehl: Vec<(String, Option<i64>)> =
        sqlx::query_as("SELECT status, etb_eintrag_id FROM befehl WHERE einsatz_id = ?")
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(befehl.len(), 1);
    assert_eq!(befehl[0].0, "freigegeben");
    assert!(befehl[0].1.is_some());
    let bericht: Vec<(String, String)> =
        sqlx::query_as("SELECT status, zeitstand FROM lagebericht WHERE einsatz_id = ?")
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(bericht, vec![("freigegeben".to_string(), zeit_vor(60))]);

    // Erinnerungen: zwei vergangene erledigt, eine in +20 min offen.
    let erinnerungen: Vec<(String, String)> = sqlx::query_as(
        "SELECT status, faellig_at FROM erinnerung WHERE einsatz_id = ? ORDER BY faellig_at",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        erinnerungen,
        vec![
            (s("erledigt"), zeit_vor(120)),
            (s("erledigt"), zeit_vor(45)),
            (s("offen"), zeit_vor(-20)),
        ]
    );

    // Personal: alle zwölf Kräfte einer Einheit zugeordnet (Ist-Stärke im Meldebild).
    assert_eq!(
        zahl("SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ? AND einheit_id IS NULL")
            .await,
        0
    );
}

// ---------------------------------------------------------------------------------------------
// Konflikt, Katalog, Mandant
// ---------------------------------------------------------------------------------------------

/// Zweiter Import bei aktivem Kopf: 409, nichts angelegt. Einmal wie im Betrieb in
/// `write_retry!`, einmal im Autocommit: dort hielte keine Rücknahme einen späten Abbruch
/// verdeckt, die Prüfung muss also vor dem ersten Schreiben stehen.
#[tokio::test]
async fn zweiter_import_ist_409_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    importieren(&pool, &o, jetzt())
        .await
        .expect("erster Import");
    let vorher = bild(&pool).await;

    erwarte_status(importieren(&pool, &o, jetzt()).await, 409, "bereits");
    assert_eq!(bild(&pool).await, vorher);

    let mut conn = pool.acquire().await.unwrap();
    let autocommit = importieren_tx(&mut conn, o.org, o.admin, jetzt()).await;
    drop(conn);
    erwarte_status(autocommit, 409, "bereits");
    assert_eq!(
        bild(&pool).await,
        vorher,
        "im Autocommit nichts geschrieben"
    );
}

/// Ein aktiver Import einer fremden Organisation sperrt die eigene nicht (Spec
/// „Import je Organisation“).
#[tokio::test]
async fn aktiver_import_einer_fremden_org_sperrt_nicht() {
    let pool = crate::db::test_pool().await;
    let a = org_mit_admin(&pool, 1).await;
    let b = org_mit_admin(&pool, 2).await;
    let erg_b = importieren(&pool, &b, jetzt()).await.expect("Import B");

    let erg_a = importieren(&pool, &a, jetzt()).await.expect("Import A");

    assert_ne!(erg_a.einsatz_id, erg_b.einsatz_id);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE entfernt_at IS NULL AND org_id >= ?",
            0
        )
        .await,
        2
    );
}

/// Review-Punkt (a) aus 4.1, Ende zu Ende: ein deaktivierter Einheitstyp ist 422, die Meldung
/// nennt ihn, und die Datenbank ist danach zeilengleich — kein Einsatz, kein Kopf, keine
/// Stammdaten. Dazu die Autocommit-Probe: die Kataloge werden vor dem ersten Schreiben
/// aufgelöst.
#[tokio::test]
async fn deaktivierter_einheitstyp_ist_422_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let n = sqlx::query("UPDATE einheit_typ SET aktiv = 0 WHERE org_id = ? AND label = 'Gruppe'")
        .bind(o.org)
        .execute(&pool)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 1);
    let vorher = bild(&pool).await;

    erwarte_status(
        importieren(&pool, &o, jetzt()).await,
        422,
        "Katalogeintrag fehlt: Einheitstyp «Gruppe»",
    );
    assert_eq!(bild(&pool).await, vorher);

    let mut conn = pool.acquire().await.unwrap();
    let autocommit = importieren_tx(&mut conn, o.org, o.admin, jetzt()).await;
    drop(conn);
    erwarte_status(autocommit, 422, "Einheitstyp «Gruppe»");
    assert_eq!(
        bild(&pool).await,
        vorher,
        "im Autocommit nichts geschrieben"
    );
}

/// Task 4.5 (Atomarität, Spec „Import ist atomar“/Scenario „Abbruch mitten im Import“): ein
/// Fehler, der erst NACH etlichen Schreibungen entsteht, rollt den gesamten Import zurück.
/// Ein deaktivierter Katalogeintrag (Vorschlag aus dem Brief) taugt dafür nicht — der scheitert
/// schon in `katalog::aufloesen_tx`, bevor überhaupt geschrieben wurde (siehe
/// `deaktivierter_einheitstyp_ist_422_und_schreibt_nichts` oben). Stattdessen ein
/// `TEMP TRIGGER` auf `lagebericht`, dem Muster von
/// `entfernen_tests::anderer_fehler_bricht_den_ganzen_vorgang_ab` folgend: Der Lagebericht
/// (`s(60, Vorgang::Lagebericht(LAGEBERICHT))`) ist die einzige Stelle im Drehbuch, die dort
/// schreibt, und liegt bei T−60 von T−292 (frühester Schritt) bis T−10 (letzter Schritt) —
/// also spät, NACHDEM Einsatz, Kopf, alle Stammdaten, beide Gefahrengebiete, UHS, BR, Betreuung,
/// der Befehl, mehrere Meldungen/Aufträge und zwei Erinnerungen längst geschrieben sind. Der
/// Nachweis, dass der Fehler wirklich aus diesem späten Schritt stammt (und nicht aus einem viel
/// früheren gleichnamigen Trigger-Text), ist der Meldungswortlaut selbst — ein
/// Autocommit-freier Beleg, wie im Brief vorgesehen. `test_pool()` hält genau eine Verbindung
/// (`max_connections(1)`), auf der auch `write_retry!` seine Transaktion öffnet: das TEMP
/// TRIGGER der vorbereitenden `execute(&pool)`-Anweisung bleibt für die Dauer des Tests auf
/// derselben Verbindung sichtbar (wie im entfernen_tests-Vorbild).
#[tokio::test]
async fn fehler_spaet_im_drehbuch_bricht_den_import_atomar_ab() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    sqlx::query(
        "CREATE TEMP TRIGGER lagebericht_nicht_anlegen BEFORE INSERT ON lagebericht \
         BEGIN SELECT RAISE(ABORT, 'Testfehler: Lagebericht'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let vorher = bild(&pool).await;

    let ergebnis = importieren(&pool, &o, jetzt()).await;
    match &ergebnis {
        Err(AppError::Database(e)) => assert!(
            e.to_string().contains("Testfehler: Lagebericht"),
            "Fehler stammt nicht aus dem späten Schritt: {e}"
        ),
        andere => {
            panic!("erwartet: Datenbankfehler aus dem Lagebericht-Trigger, bekommen: {andere:?}")
        }
    }

    assert_eq!(
        bild(&pool).await,
        vorher,
        "nach dem Abbruch: kein Demo-Einsatz, keine Demo-Stammdaten, kein Kopf"
    );
}

/// Der Admin muss zur Organisation gehören, in die importiert wird: sonst landete der Einsatz
/// in seiner Org, Kopf und Stammdaten in der anderen.
#[tokio::test]
async fn admin_einer_fremden_org_ist_internal_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let a = org_mit_admin(&pool, 1).await;
    let b = org_mit_admin(&pool, 2).await;
    let vorher = bild(&pool).await;

    let fremd = Org {
        org: a.org,
        admin: b.admin,
    };
    erwarte_status(importieren(&pool, &fremd, jetzt()).await, 500, "Org");
    assert_eq!(bild(&pool).await, vorher);
}

/// Mit dem echten `bootstrap_admin` hat eine frische Org alles, was der Import braucht.
#[tokio::test]
async fn import_in_frisch_gebootstrappter_org() {
    let pool = crate::db::test_pool().await;
    crate::auth::bootstrap::bootstrap_admin(&pool, "Musterstadt", "admin", Some("pw12"))
        .await
        .unwrap();
    let (org, admin): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let erg = importieren(&pool, &Org { org, admin }, jetzt())
        .await
        .expect("Import in der gebootstrappten Org");
    assert_eq!(
        etb(&pool, erg.einsatz_id).await.len(),
        erwartete_etb().len()
    );
}

// ---------------------------------------------------------------------------------------------
// Rundlauf
// ---------------------------------------------------------------------------------------------

/// Importieren → Entfernen → Importieren gegen das aktuelle Schema: alle drei gelingen, der
/// zweite Bericht ist gleich dem ersten, und der neue Einsatz liegt über der gesperrten ID
/// des entfernten (D6).
#[tokio::test]
async fn rundlauf_import_entfernen_import() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;

    let erster = importieren(&pool, &o, jetzt())
        .await
        .expect("erster Import");
    let entfernt =
        crate::write_retry!(&pool, |conn| { entfernen_tx(conn, o.org).await }).expect("entfernen");
    assert_eq!(entfernt.vorgang, DemoVorgang::Entfernt);
    let zweiter = importieren(&pool, &o, jetzt())
        .await
        .expect("zweiter Import");

    assert_eq!(zweiter.bericht, erster.bericht);
    assert!(zweiter.einsatz_id > erster.einsatz_id, "ID-Sperre (D6)");
    assert_ne!(zweiter.import_id, erster.import_id);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL",
            o.org
        )
        .await,
        1
    );
    assert_eq!(
        etb(&pool, zweiter.einsatz_id).await.len(),
        erwartete_etb().len()
    );
    assert!(etb(&pool, erster.einsatz_id).await.is_empty());
}

// ---------------------------------------------------------------------------------------------
// Alarmbudget (Task 4.4, D10)
// ---------------------------------------------------------------------------------------------

/// Task 4.4 (D10, Spec „Zeitachse relativ zum Importzeitpunkt“/Scenario „Kein Alarm nach dem
/// Import“): Der erste Takt des Erinnerungs-Schedulers nach dem Import darf nichts auslösen —
/// weder eine Erinnerung, noch eine Meldungs-Eskalation, noch einen Ablösungsalarm — und ein
/// Live-Abonnent des Demo-Einsatzes bekommt kein Ereignis der drei Alarm-Tags (`erinnerung`,
/// `sofortmeldung`, `abloesung`). Belegt als Repo-Test in `src/demo/` statt als
/// Integrationstest: `erinnerung::scheduler::tick_einmal` und `live::LiveHub` sind crate-interne
/// Bausteine ohne HTTP-Route (die kommt erst in Block 5), und die vorhandenen
/// Scheduler-Repo-Tests (`erinnerung/scheduler.rs`) rufen sie genauso direkt — ein
/// Integrationstest müsste denselben Weg über `lifeline_hub::` nachbauen, ohne einen echten
/// Endpunkt zusätzlich zu prüfen.
///
/// `jetzt` ist nahe an der echten Uhr (wie `tests/demo_daten.rs::demo_importieren`), nicht das
/// feste Test-`JETZT` dieser Datei: Der Test bildet damit genau das Risiko nach, gegen das D10
/// gebaut ist — Import und erster Scheduler-Takt kurz hintereinander im echten Betrieb.
///
/// Der zweite Takt (`jetzt + 25 min`) zeigt, dass der Test den Scheduler wirklich treffen kann:
/// Von den drei Erinnerungen (`lagebesprechung` T−120 erledigt, `abloesung` T−45 erledigt,
/// `naechste_lagebesprechung` T+20 offen, siehe `block-4.3-report.md`) wird danach genau die
/// eine künftige fällig und ausgelöst.
///
/// Mutationsprobe (nicht committet): eine der beiden vergangenen Erinnerungen nach dem Import
/// per `UPDATE erinnerung SET status = 'offen' WHERE titel = 'Lagebesprechung vorbereiten'`
/// wieder auf offen gesetzt → `ausgeloest` beim ersten Takt wird 1 statt 0, der Test schlägt rot
/// fehl.
#[tokio::test]
async fn scheduler_takt_nach_import_loest_nichts_aus() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let jetzt_uhr = chrono::Utc::now().naive_utc();
    let erg = importieren(&pool, &o, jetzt_uhr).await.expect("Import");

    let live = crate::live::LiveHub::new();
    let mut rx = live.abonniere(erg.einsatz_id);

    // Erster Takt, praktisch im selben Moment wie der Import: null Auslösungen.
    let ausgeloest =
        crate::erinnerung::scheduler::tick_einmal(&pool, &live, jetzt_uhr.and_utc()).await;
    assert_eq!(ausgeloest, 0, "kein Alarm auf Vorrat (D10)");

    // Null Eskalationen: keine Meldung des Demo-Einsatzes trägt eskaliert = 1.
    let eskalierte: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ? AND eskaliert = 1")
            .bind(erg.einsatz_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(eskalierte, 0, "keine Eskalation");

    // Null Ablösungsalarme: keine Erinnerung mit Ablösungs-Bezug (das Drehbuch legt ohnehin
    // keine Ablösungsschicht an — der Test prüft es trotzdem eigens, statt sich nur auf
    // `ausgeloest == 0` zu verlassen).
    let abloesungsfristen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM erinnerung WHERE einsatz_id = ? AND bezug_typ IN (?, ?)",
    )
    .bind(erg.einsatz_id)
    .bind(crate::kommunikation::OBJEKT_ABLOESUNG)
    .bind(crate::kommunikation::OBJEKT_ABLOESUNG_VORWARNUNG)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(abloesungsfristen, 0, "keine Ablösungsfrist im Szenario");

    // Kein empfangenes Live-Ereignis, gleich welchen Tags.
    let mut empfangen = Vec::new();
    while let Ok(n) = rx.try_recv() {
        empfangen.push(n.event.as_str().to_string());
    }
    assert!(
        empfangen.is_empty(),
        "unerwartete Live-Ereignisse: {empfangen:?}"
    );

    // Zweiter Takt: der Test kann den Scheduler wirklich treffen — genau die eine künftige
    // Erinnerung (T+20) löst jetzt aus.
    let spaeter = jetzt_uhr + chrono::Duration::minutes(25);
    let ausgeloest =
        crate::erinnerung::scheduler::tick_einmal(&pool, &live, spaeter.and_utc()).await;
    assert_eq!(ausgeloest, 1, "die eine künftige Erinnerung (T+20)");
    let n = rx.recv().await.unwrap();
    assert_eq!(n.event.as_str(), "erinnerung");
    assert!(
        rx.try_recv().is_err(),
        "kein zweites Ereignis auf demselben Takt"
    );
}

/// Die fachlichen ETB-Typen des Rumpfs kommen beide vor (Pflicht-Typen der Spec).
#[test]
fn drehbuch_traegt_lage_und_entscheidung() {
    let arten: Vec<EtbArt> = DREHBUCH
        .iter()
        .filter_map(|s| match s.vorgang {
            Vorgang::Etb { art, .. } => Some(art),
            _ => None,
        })
        .collect();
    assert!(arten.contains(&EtbArt::Lage));
    assert!(arten.contains(&EtbArt::Entscheidung));
}
