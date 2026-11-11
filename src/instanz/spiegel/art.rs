//! Welche Tabellen eines Einsatzes gespiegelt werden (design.md D1, D3, D10).
//!
//! Die Menge der Einsatztabellen kennt die Schwärzungs-Registry
//! ([`crate::einsatz::schwaerzung_registry::TABELLEN`]). Jede Tabelle dort steht hier genau
//! einmal: in [`GESPIEGELT`] mit ihrer Kategorie oder in [`AUSGENOMMEN`] mit Grund. Wie eine
//! Zeile ihren Einsatz findet, sagt das Scoping der Registry; ihren Schlüssel liest
//! [`schluessel`] aus dem Schema.
//!
//! Log- und Schutz-Trigger entstehen aus [`trigger_sql`]; die Migration enthält seine Ausgabe,
//! und der Test `trigger_passen_zur_beschreibung` vergleicht beides. Wer eine Einsatztabelle neu
//! anlegt oder neu baut, legt ihre Trigger in derselben Migration an (`src/AGENTS.md`,
//! Instanzkopplung).

use super::SpiegelKategorie as K;
use crate::einsatz::schwaerzung_registry::{self as registry, Scoping};
use sqlx::SqliteConnection;

/// Eine gespiegelte Tabelle.
#[derive(Debug, Clone, Copy)]
pub struct Gespiegelt {
    pub tabelle: &'static str,
    pub kategorie: K,
}

const fn g(tabelle: &'static str, kategorie: K) -> Gespiegelt {
    Gespiegelt { tabelle, kategorie }
}

/// Die gespiegelten Tabellen (D3). Reihenfolge ohne Bedeutung; die Übernahme ordnet selbst.
pub const GESPIEGELT: &[Gespiegelt] = &[
    // Führung
    g("einsatz", K::Fuehrung),
    g("einsatz_mitgliedschaft", K::Fuehrung),
    g("einsatz_einstellungen", K::Fuehrung),
    g("einsatz_modul_override", K::Fuehrung),
    g("einsatz_fuehrungsstelle", K::Fuehrung),
    g("einsatz_fuehrungsstelle_sprechgruppe", K::Fuehrung),
    g("einsatz_fuehrungsstelle_fahrzeug", K::Fuehrung),
    g("einsatz_lagebesprechung", K::Fuehrung),
    g("einsatz_lagekennzahl_wahl", K::Fuehrung),
    g("einsatzabschnitt", K::Fuehrung),
    g("einsatzabschnitt_sprechgruppe", K::Fuehrung),
    g("erinnerung", K::Fuehrung),
    g("programmpunkt", K::Fuehrung),
    g("benachrichtigung_vorgabe", K::Fuehrung),
    // ETB
    g("etb_eintrag", K::Etb),
    g("etb_eintrag_einheit", K::Etb),
    // Lage
    g("lage_zone", K::Lage),
    g("gefahrengebiet", K::Lage),
    g("gefahr_bewertung", K::Lage),
    g("freies_zeichen", K::Lage),
    g("karte_hintergrundbild", K::Lage),
    g("karten_ansicht", K::Lage),
    g("lage_snapshot", K::Lage),
    g("einsatz_pegel", K::Lage),
    g("einsatz_schaden", K::Lage),
    g("einsatz_tier", K::Lage),
    // Kräfte
    g("einsatz_einheit", K::Kraefte),
    g("einsatz_einheit_letzte_besetzung", K::Kraefte),
    g("einsatz_einheit_sprechgruppe", K::Kraefte),
    g("einsatz_fahrzeug", K::Kraefte),
    g("einsatz_material", K::Kraefte),
    g("einsatz_personal", K::Kraefte),
    g("einsatz_abloesung", K::Kraefte),
    g("einsatz_abloesung_abloeser", K::Kraefte),
    g("einsatz_abloesung_br_buchung", K::Kraefte),
    g("einsatz_abloesung_besatzung", K::Kraefte),
    g("einsatz_abloesung_besatzung_plan", K::Kraefte),
    g("einsatz_abloesung_planung_vorher", K::Kraefte),
    g("einsatz_plan_helfer", K::Kraefte),
    g("einsatz_planschicht", K::Kraefte),
    g("einsatz_planschicht_person", K::Kraefte),
    g("einsatz_plan_wechsel", K::Kraefte),
    g("einsatz_plan_wechsel_person", K::Kraefte),
    g("einsatz_schichtmodell", K::Kraefte),
    g("einsatz_kraft_zeitachse", K::Kraefte),
    g("bereitstellungsraum", K::Kraefte),
    g("br_belegung", K::Kraefte),
    // Personen (Art. 9)
    g("einsatz_person", K::Personen),
    g("person_anlass", K::Personen),
    g("person_transport", K::Personen),
    g("person_sichtung", K::Personen),
    g("person_massnahme", K::Personen),
    g("person_verletzung", K::Personen),
    g("person_verlaufsnotiz", K::Personen),
    g("person_verbleib", K::Personen),
    g("person_uhs_belegung", K::Personen),
    g("person_abgleich", K::Personen),
    g("uhs", K::Personen),
    g("uhs_platz", K::Personen),
    // Betreuung
    g("evakuierungsbezirk", K::Betreuung),
    g("evakuierung_stand", K::Betreuung),
    g("haushalt", K::Betreuung),
    g("betreuungsstelle", K::Betreuung),
    g("betreuungsstelle_belegung", K::Betreuung),
    g("verpflegung_zeitfenster", K::Betreuung),
    g("verpflegungsstelle", K::Betreuung),
    g("verpflegung_zeitfenster_stelle", K::Betreuung),
    g("verpflegung_ausgabe", K::Betreuung),
    g("einsatz_unterkunft_richtwert", K::Betreuung),
    // Kommunikation und Fernmeldewesen
    g("meldung", K::Kommunikation),
    g("auftrag", K::Kommunikation),
    g("auftrag_empfaenger", K::Kommunikation),
    g("befehl", K::Kommunikation),
    g("befehl_verteiler", K::Kommunikation),
    g("lagebericht", K::Kommunikation),
    g("lagebericht_verteiler", K::Kommunikation),
    g("nachforderung", K::Kommunikation),
    g("infotelefon_anruf", K::Kommunikation),
    g("chat_kanal", K::Kommunikation),
    g("chat_nachricht", K::Kommunikation),
    g("chat_erwaehnung", K::Kommunikation),
    g("kommunikation_status", K::Kommunikation),
    g("kommunikation_zustellung", K::Kommunikation),
    g("sprechgruppe", K::Kommunikation),
    g("einsatz_verbindung", K::Kommunikation),
    g("einsatz_kommunikation_stelle", K::Kommunikation),
    g("einsatz_kommunikation_verbindung", K::Kommunikation),
    g(
        "einsatz_kommunikation_stelle_sprechgruppe",
        K::Kommunikation,
    ),
    g("fernmeldeskizze_komponente", K::Kommunikation),
    g("fernmeldeskizze_komponente_sprechgruppe", K::Kommunikation),
    g("fernmeldeskizze_verbindung", K::Kommunikation),
    g("fernmeldeskizze_bereich", K::Kommunikation),
    g("fernmeldeskizze_lage", K::Kommunikation),
    g("fernmeldeskizze_schriftfeld", K::Kommunikation),
    // Anhänge und ihre Verknüpfungen
    g("anhang", K::Anhaenge),
    g("karte_hintergrundbild_daten", K::Anhaenge),
    g("uhs_plan", K::Anhaenge),
    g("einsatz_dokument", K::Anhaenge),
    g("einsatz_schaden_anhang", K::Anhaenge),
    g("einsatz_tier_anhang", K::Anhaenge),
    g("uhs_anhang", K::Anhaenge),
    g("einsatz_person_anhang", K::Anhaenge),
    g("lagebericht_anlage", K::Anhaenge),
    g("befehl_anlage", K::Anhaenge),
    g("etb_eintrag_anhang", K::Anhaenge),
    g("chat_nachricht_anhang", K::Anhaenge),
];

/// Einsatztabellen, die nicht gespiegelt werden, mit Grund (D3).
pub const AUSGENOMMEN: &[(&str, &str)] = &[
    (
        "person_zugriff_audit",
        "Zugriffsprotokoll: jede Instanz protokolliert ihre eigenen Zugriffe",
    ),
    (
        "anhang_zugriff_audit",
        "Zugriffsprotokoll: jede Instanz protokolliert ihre eigenen Zugriffe",
    ),
    ("etb_lesemarke", "Lesestand einer Person an dieser Instanz"),
    ("lagemonitor_freigabe", "Geräte hängen an einer Instanz"),
    (
        "benachrichtigung",
        "Zustellstand je Instanz: jede Instanz führt ihre eigenen Hinweise (Nachtrag 10.11.2026)",
    ),
    ("geraet_kopplung", "Geräte hängen an einer Instanz"),
    ("geraet_kopplungscode", "Geräte hängen an einer Instanz"),
    ("geraet_kopplung_ereignis", "Geräte hängen an einer Instanz"),
    ("session", "Sitzungen hängen an einer Instanz"),
    (
        "web_push_abo",
        "Push-Abos hängen an einer Sitzung dieser Instanz",
    ),
    ("demo_import", "Demo-Daten werden nicht gespiegelt (D6)"),
    ("demo_herkunft", "Demo-Daten werden nicht gespiegelt (D6)"),
    (
        "aufbewahrung_loeschprotokoll",
        "Löschprotokoll dieser Instanz; das Lebensende regelt LLH-1494",
    ),
    (
        "schwaerzung_antrag",
        "Löschersuchen wirkt beim Führer; die Schwärzung kommt über das Log",
    ),
    (
        "einsatz_aufbewahrung_kategorie",
        "Fristen gelten am Führer; das Lebensende des Spiegels regelt LLH-1494",
    ),
    ("einsatz_aenderung", "Verwaltung des Spiegels selbst"),
    ("einsatz_spiegel", "Verwaltung des Spiegels selbst"),
    ("spiegel_herkunft", "Verwaltung des Spiegels selbst"),
    ("spiegel_ziel", "Verwaltung des Spiegels selbst"),
    ("spiegel_anhang", "Verwaltung des Spiegels selbst"),
    (
        "spiegel_antrag",
        "Anträge gehen als Antrag zum Führer, nicht als Zeile",
    ),
    (
        "spiegel_anhang_teil",
        "Inhalt auf dem Weg; gilt erst in seiner Zeile",
    ),
];

/// Die Kategorie einer gespiegelten Tabelle.
pub fn kategorie(tabelle: &str) -> Option<K> {
    GESPIEGELT
        .iter()
        .find(|g| g.tabelle == tabelle)
        .map(|g| g.kategorie)
}

/// Wie eine Zeile der Tabelle ihren Einsatz findet (aus der Schwärzungs-Registry).
pub fn scoping(tabelle: &str) -> Scoping {
    registry::TABELLEN
        .iter()
        .find(|r| r.tabelle == tabelle)
        .map(|r| r.scoping)
        .unwrap_or_else(|| panic!("{tabelle} fehlt in der Schwärzungs-Registry"))
}

/// Wie eine Zeile ihrer Tabelle eindeutig heißt (D1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Schluessel {
    /// Eine Primärschlüsselspalte, als Text.
    Spalte(String),
    /// Mehrere Primärschlüsselspalten, als JSON-Array.
    Spalten(Vec<String>),
    /// Kein deklarierter Primärschlüssel: die `rowid`.
    Rowid,
}

impl Schluessel {
    /// Ausdruck für den Schlüssel der Zeile `zeile` (`NEW`, `OLD` oder ein Alias).
    pub fn ausdruck(&self, zeile: &str) -> String {
        match self {
            Schluessel::Spalte(s) => format!("CAST({zeile}.{s} AS TEXT)"),
            Schluessel::Spalten(s) => {
                let teile: Vec<String> = s.iter().map(|s| format!("{zeile}.{s}")).collect();
                format!("json_array({})", teile.join(", "))
            }
            Schluessel::Rowid => format!("CAST({zeile}.rowid AS TEXT)"),
        }
    }

    /// Bedingung „Zeile hat diesen Schlüssel“ mit genau einem `?` (der Schlüssel als Text). Eine
    /// Spalte und die rowid vergleicht sie direkt, damit SQLite den Index nimmt (ein `CAST` liest
    /// die ganze Tabelle); der Text wird dabei nach der Affinität der Spalte gewandelt.
    pub fn gleich(&self, zeile: &str) -> String {
        match self {
            Schluessel::Spalte(s) => format!("{zeile}.{s} = ?"),
            Schluessel::Rowid => format!("{zeile}.rowid = ?"),
            Schluessel::Spalten(_) => format!("{} = ?", self.ausdruck(zeile)),
        }
    }
}

/// Liest den Primärschlüssel einer Tabelle aus dem Schema.
pub async fn schluessel(
    conn: &mut SqliteConnection,
    tabelle: &str,
) -> Result<Schluessel, sqlx::Error> {
    let mut pk: Vec<(i64, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT pk, name FROM pragma_table_info('{tabelle}') WHERE pk > 0"
    )))
    .fetch_all(conn)
    .await?;
    pk.sort();
    Ok(match pk.len() {
        0 => Schluessel::Rowid,
        1 => Schluessel::Spalte(pk.remove(0).1),
        _ => Schluessel::Spalten(pk.into_iter().map(|(_, n)| n).collect()),
    })
}

/// Ausdruck für die `einsatz_id` der Zeile `zeile` nach dem Scoping der Tabelle.
pub fn einsatz_ausdruck(scoping: Scoping, zeile: &str) -> String {
    match scoping {
        Scoping::SelbstId => format!("{zeile}.id"),
        Scoping::EinsatzId => format!("{zeile}.einsatz_id"),
        Scoping::UeberParent { fk, parent } => {
            format!("(SELECT einsatz_id FROM {parent} WHERE id = {zeile}.{fk})")
        }
    }
}

/// Log- und Schutz-Trigger einer gespiegelten Tabelle (D1, D10), so wie sie in der Migration
/// stehen. Der Schutz greift erst mit der Tabelle `einsatz_spiegel`; deshalb liefert
/// `mit_schutz = false` nur die Log-Trigger.
pub fn trigger_sql(tabelle: &str, sc: Scoping, k: &Schluessel, mit_schutz: bool) -> String {
    let t = tabelle;
    let (en, eo) = (einsatz_ausdruck(sc, "NEW"), einsatz_ausdruck(sc, "OLD"));
    let (kn, ko) = (k.ausdruck("NEW"), k.ausdruck("OLD"));
    let gibt = |e: &str| format!("EXISTS (SELECT 1 FROM einsatz WHERE id = {e})");
    let mut sql = String::new();
    // Das Log ist je Einsatz eindeutig: eine Kennung, die SQLite nach dem Löschen neu vergibt,
    // verdrängt die Löschung in einem anderen Einsatz nicht.
    sql.push_str(&format!(
        "CREATE TRIGGER {t}_spiegellog_i AFTER INSERT ON {t} WHEN {gn} BEGIN\n    \
         DELETE FROM einsatz_aenderung WHERE einsatz_id = {en} AND art = '{t}' AND schluessel = {kn};\n    \
         INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES ({en}, '{t}', {kn});\nEND;\n",
        gn = gibt(&en)
    ));
    sql.push_str(&format!(
        "CREATE TRIGGER {t}_spiegellog_u AFTER UPDATE ON {t} BEGIN\n    \
         DELETE FROM einsatz_aenderung WHERE art = '{t}' AND ((einsatz_id = {eo} AND schluessel = {ko}) \
         OR (einsatz_id = {en} AND schluessel = {kn}));\n    \
         INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT {eo}, '{t}', {ko} \
         WHERE ({ko} IS NOT {kn} OR {eo} IS NOT {en}) AND {go};\n    \
         INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT {en}, '{t}', {kn} \
         WHERE {gn};\nEND;\n",
        go = gibt(&eo),
        gn = gibt(&en)
    ));
    if sc == Scoping::SelbstId {
        // Mit dem Einsatz gehen seine Logzeilen; die Kinder, die per CASCADE folgen, finden
        // ihren Einsatz nicht mehr und schreiben nichts.
        sql.push_str(&format!(
            "CREATE TRIGGER {t}_spiegellog_d AFTER DELETE ON {t} BEGIN\n    \
             DELETE FROM einsatz_aenderung WHERE einsatz_id = OLD.id;\nEND;\n"
        ));
    } else {
        // Folgt ein Kind seinem Elternteil per CASCADE, ist das Elternteil schon fort: dann
        // nennt dessen eben geschriebene Löschung im Log den Einsatz.
        let eo = match sc {
            Scoping::UeberParent { fk, parent } => format!(
                "COALESCE({eo}, (SELECT einsatz_id FROM einsatz_aenderung WHERE art = '{parent}' \
                 AND schluessel = CAST(OLD.{fk} AS TEXT) ORDER BY stand DESC LIMIT 1))"
            ),
            _ => eo.clone(),
        };
        sql.push_str(&format!(
            "CREATE TRIGGER {t}_spiegellog_d AFTER DELETE ON {t} BEGIN\n    \
             DELETE FROM einsatz_aenderung WHERE einsatz_id = {eo} AND art = '{t}' AND schluessel = {ko};\n    \
             INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT {eo}, '{t}', {ko} \
             WHERE {go};\nEND;\n",
            go = gibt(&eo)
        ));
    }
    if mit_schutz {
        let frei = "NOT EXISTS (SELECT 1 FROM spiegel_uebernahme)";
        let spiegel =
            |e: &str| format!("EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = {e})");
        let abbruch = format!(
            "BEGIN SELECT RAISE(ABORT, '{}'); END;\n",
            super::SCHUTZ_NACHRICHT
        );
        sql.push_str(&format!(
            "CREATE TRIGGER {t}_spiegelschutz_i BEFORE INSERT ON {t} WHEN {frei} AND {sn} {abbruch}",
            sn = spiegel(&en)
        ));
        sql.push_str(&format!(
            "CREATE TRIGGER {t}_spiegelschutz_u BEFORE UPDATE ON {t} WHEN {frei} AND ({so} OR {sn}) {abbruch}",
            so = spiegel(&eo),
            sn = spiegel(&en)
        ));
        sql.push_str(&format!(
            "CREATE TRIGGER {t}_spiegelschutz_d BEFORE DELETE ON {t} WHEN {frei} AND {so} {abbruch}",
            so = spiegel(&eo)
        ));
    }
    sql
}

/// Grundstock (D1): trägt jede bestehende Zeile der Tabelle einmal ins Log ein.
pub fn grundstock_sql(tabelle: &str, sc: Scoping, k: &Schluessel) -> String {
    let e = einsatz_ausdruck(sc, "z");
    format!(
        "INSERT OR IGNORE INTO einsatz_aenderung (einsatz_id, art, schluessel) SELECT {e}, '{tabelle}', {k} \
         FROM {tabelle} AS z WHERE EXISTS (SELECT 1 FROM einsatz WHERE id = {e});\n",
        k = k.ausdruck("z")
    )
}

/// Alle Trigger und der Grundstock als Text der Migration, für [`GESPIEGELT`] in dieser
/// Reihenfolge. Nur für den Generator-Test und das Erzeugen der Migration.
pub async fn migration_sql(
    conn: &mut SqliteConnection,
    mit_schutz: bool,
) -> Result<String, sqlx::Error> {
    let mut sql = String::new();
    let mut grundstock = String::new();
    for g in GESPIEGELT {
        let k = schluessel(conn, g.tabelle).await?;
        sql.push_str(&format!("-- {}\n", g.tabelle));
        sql.push_str(&trigger_sql(g.tabelle, scoping(g.tabelle), &k, mit_schutz));
        grundstock.push_str(&grundstock_sql(g.tabelle, scoping(g.tabelle), &k));
    }
    sql.push_str("\n-- Grundstock (D1): jede bestehende Zeile einmal als geändert.\n");
    sql.push_str(&grundstock);
    Ok(sql)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn jede_einsatztabelle_ist_eingeordnet() {
        let registry: HashSet<&str> = registry::TABELLEN.iter().map(|r| r.tabelle).collect();
        let mut gesehen = HashSet::new();
        for t in GESPIEGELT
            .iter()
            .map(|g| g.tabelle)
            .chain(AUSGENOMMEN.iter().map(|(t, _)| *t))
        {
            assert!(gesehen.insert(t), "{t} steht doppelt");
            assert!(
                registry.contains(t),
                "{t} kennt die Schwärzungs-Registry nicht"
            );
        }
        for t in &registry {
            assert!(
                gesehen.contains(t),
                "{t} ist weder gespiegelt noch ausgenommen (spiegel::art)"
            );
        }
    }

    #[test]
    fn eine_eltern_tabelle_wird_mitgespiegelt() {
        for g in GESPIEGELT {
            if let Scoping::UeberParent { parent, .. } = scoping(g.tabelle) {
                assert!(
                    kategorie(parent).is_some(),
                    "{} hängt an {parent}, das nicht gespiegelt wird",
                    g.tabelle
                );
            }
        }
    }

    /// Org 1, ein Konto, ein Einsatz mit einer UHS und einem Platz (Kind über die Elternzeile).
    async fn einsatz_mit_uhs(pool: &sqlx::SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Org')")
            .execute(pool)
            .await
            .unwrap();
        let konto: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
             aktiv, erstellt_at, org_rolle) VALUES (1, 'A', 'a' || abs(random()), 'x', 'keiner', 1, \
             '2026-11-10 00:00:00', 'keine') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'sonstige', 'UHS 1', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(konto)
        .bind(konto)
        .fetch_one(pool)
        .await
        .unwrap();
        let platz: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'Bett 1') RETURNING id",
        )
        .bind(uhs)
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, uhs, platz)
    }

    /// Markiert einen Einsatz als Spiegel, wie es nur die Übernahme tut: unter dem Merker.
    async fn als_spiegel(pool: &sqlx::SqlitePool, einsatz: i64) {
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
            .execute(&mut *tx)
            .await
            .unwrap();
        let fehler = sqlx::query(
            "INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES (?, 'x/' || ?)",
        )
        .bind(einsatz)
        .bind(einsatz)
        .execute(&mut *tx)
        .await;
        fehler.unwrap();
        sqlx::query("DELETE FROM spiegel_uebernahme")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    async fn stand(pool: &sqlx::SqlitePool, art: &str, schluessel: i64) -> Option<(i64, i64)> {
        sqlx::query_as(
            "SELECT stand, einsatz_id FROM einsatz_aenderung WHERE art = ? AND schluessel = ?",
        )
        .bind(art)
        .bind(schluessel.to_string())
        .fetch_optional(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn jede_aenderung_erhoeht_den_stand_und_haelt_eine_zeile() {
        let pool = crate::db::test_pool().await;
        let (einsatz, uhs, platz) = einsatz_mit_uhs(&pool).await;
        let (s1, e) = stand(&pool, "uhs_platz", platz)
            .await
            .expect("Anlegen loggt");
        assert_eq!(
            e, einsatz,
            "Kind findet seinen Einsatz über die Elternzeile"
        );
        sqlx::query("UPDATE uhs_platz SET bezeichnung = 'Bett 2' WHERE id = ?")
            .bind(platz)
            .execute(&pool)
            .await
            .unwrap();
        let (s2, _) = stand(&pool, "uhs_platz", platz).await.unwrap();
        assert!(s2 > s1, "Ändern erhöht den Stand");
        // Schwärzen ist ein UPDATE wie jedes andere.
        sqlx::query("UPDATE einsatz SET sachverhalt = NULL WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        assert!(stand(&pool, "einsatz", einsatz).await.unwrap().0 > s2);
        let zeilen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_aenderung WHERE art = 'uhs_platz' AND schluessel = ?",
        )
        .bind(platz.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(zeilen, 1, "je Zeile genau eine Logzeile");
        sqlx::query("DELETE FROM uhs_platz WHERE id = ?")
            .bind(platz)
            .execute(&pool)
            .await
            .unwrap();
        let (s3, _) = stand(&pool, "uhs_platz", platz)
            .await
            .expect("Löschen loggt");
        assert!(s3 > s2, "hartes Löschen erhöht den Stand");
        // Löschen der Elternzeile nimmt die Kinder per CASCADE mit, ohne Fehler.
        sqlx::query("INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'B')")
            .bind(uhs)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM uhs WHERE id = ?")
            .bind(uhs)
            .execute(&pool)
            .await
            .unwrap();
        assert!(stand(&pool, "uhs", uhs).await.is_some());
        // Mit dem Einsatz gehen seine Logzeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rest, 0);
    }

    /// Review LLH-1492: SQLite vergibt die Kennung einer gelöschten Zeile neu. Das Log ist je
    /// Einsatz eindeutig, damit die Löschung im einen Einsatz nicht verschwindet, und ein Kind,
    /// das seinem Elternteil per CASCADE folgt, loggt seine Löschung über dessen Logzeile.
    #[tokio::test]
    async fn neu_vergebene_kennung_verdraengt_keine_loeschung_und_kinder_folgen_dem_elternteil() {
        let pool = crate::db::test_pool().await;
        let (a, uhs_a, platz) = einsatz_mit_uhs(&pool).await;
        let (b, uhs_b, _) = einsatz_mit_uhs(&pool).await;
        let log = |einsatz: i64, art: &'static str, schluessel: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = ? AND art = ? \
                     AND schluessel = ?",
                )
                .bind(einsatz)
                .bind(art)
                .bind(schluessel.to_string())
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        sqlx::query("DELETE FROM uhs_platz WHERE id = ?")
            .bind(platz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO uhs_platz (id, uhs_id, typ, bezeichnung) VALUES (?, ?, 'bett', 'N')",
        )
        .bind(platz)
        .bind(uhs_b)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(log(a, "uhs_platz", platz).await, 1, "Löschung in A bleibt");
        assert_eq!(log(b, "uhs_platz", platz).await, 1, "neue Zeile in B");

        let kind: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'K') RETURNING id",
        )
        .bind(uhs_a)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM uhs WHERE id = ?")
            .bind(uhs_a)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            log(a, "uhs_platz", kind).await,
            1,
            "das Kind loggt seine Löschung beim Einsatz des Elternteils"
        );
    }

    #[tokio::test]
    async fn ein_spiegel_ist_nur_unter_dem_merker_schreibbar() {
        let pool = crate::db::test_pool().await;
        let (einsatz, uhs, platz) = einsatz_mit_uhs(&pool).await;
        als_spiegel(&pool, einsatz).await;
        let spiegel: i64 = sqlx::query_scalar("SELECT spiegel FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            spiegel, 1,
            "einsatz.spiegel folgt der Zeile in einsatz_spiegel"
        );
        let fehler = |r: Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error>| {
            let e = r.expect_err("am Spiegel gesperrt");
            assert!(
                e.to_string()
                    .contains(crate::instanz::spiegel::SCHUTZ_NACHRICHT),
                "{e}"
            );
        };
        fehler(
            sqlx::query("UPDATE uhs_platz SET bezeichnung = 'X' WHERE id = ?")
                .bind(platz)
                .execute(&pool)
                .await,
        );
        fehler(
            sqlx::query("INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'B')")
                .bind(uhs)
                .execute(&pool)
                .await,
        );
        fehler(
            sqlx::query("DELETE FROM uhs WHERE id = ?")
                .bind(uhs)
                .execute(&pool)
                .await,
        );
        fehler(
            sqlx::query("UPDATE einsatz SET bezeichnung = 'X' WHERE id = ?")
                .bind(einsatz)
                .execute(&pool)
                .await,
        );
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("UPDATE uhs_platz SET bezeichnung = 'X' WHERE id = ?")
            .bind(platz)
            .execute(&mut *tx)
            .await
            .expect("unter dem Merker schreibbar");
        sqlx::query("DELETE FROM spiegel_uebernahme")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        // Ein anderer Einsatz bleibt frei.
        let (_, _, frei) = einsatz_mit_uhs(&pool).await;
        sqlx::query("UPDATE uhs_platz SET bezeichnung = 'Y' WHERE id = ?")
            .bind(frei)
            .execute(&pool)
            .await
            .expect("eigener Einsatz schreibbar");
    }

    /// Erzeugt den Trigger-Teil der Migration (nur von Hand):
    /// `SPIEGEL_SQL=<pfad> cargo test --lib spiegel::art::tests::erzeuge_migration -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn erzeuge_migration() {
        let pfad = std::env::var("SPIEGEL_SQL").expect("SPIEGEL_SQL setzen");
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        std::fs::write(pfad, migration_sql(&mut conn, true).await.unwrap()).unwrap();
    }

    /// Leerraum vereinheitlicht; `sqlite_master` speichert den Trigger ohne das letzte `;`.
    fn normal(sql: &str) -> String {
        let s = sql.split_whitespace().collect::<Vec<_>>().join(" ");
        s.trim_end_matches(';').to_string()
    }

    /// Jede gespiegelte Tabelle hat genau die Trigger, die der Generator erzeugt (ein Neubau einer
    /// Tabelle verliert sie still), und kein anderer Trigger schreibt ins Log.
    #[tokio::test]
    async fn trigger_passen_zur_beschreibung() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let trigger: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' \
             AND (name LIKE '%\\_spiegellog\\__' ESCAPE '\\' OR name LIKE '%\\_spiegelschutz\\__' ESCAPE '\\')",
        )
        .fetch_all(&mut *conn)
        .await
        .unwrap();
        let mut erwartet = Vec::new();
        for g in GESPIEGELT {
            let k = schluessel(&mut conn, g.tabelle).await.unwrap();
            for teil in
                trigger_sql(g.tabelle, scoping(g.tabelle), &k, true).split("CREATE TRIGGER ")
            {
                if teil.trim().is_empty() {
                    continue;
                }
                let name = teil.split_whitespace().next().unwrap().to_string();
                erwartet.push((name, normal(&format!("CREATE TRIGGER {teil}"))));
            }
        }
        for (name, sql) in &erwartet {
            let ist = trigger.iter().find(|(n, _, _)| n == name);
            let Some((_, _, ist)) = ist else {
                panic!(
                    "Trigger {name} fehlt; Migration mit `spiegel::art::trigger_sql` nachziehen"
                );
            };
            assert_eq!(&normal(ist), sql, "Trigger {name} weicht vom Generator ab");
        }
        for (name, tbl, _) in &trigger {
            assert!(
                erwartet.iter().any(|(n, _)| n == name),
                "{name} an {tbl} gehört zu keiner gespiegelten Tabelle"
            );
        }
    }
}
