//! Lagekennzahlen am Einsatz (LFH-640) — welche lagebezogenen Plätze des Kennzahlenbands im
//! Lage-Dashboard belegt sind.
//!
//! Spec: `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`.
//!
//! Zwei Arten von Auslösern: abgeleitete (Pegel festgelegt, Evakuierung angeordnet — die
//! Entscheidung fällt im Fachmodul) und **gewählte** (LLH-1371, Tabelle
//! `einsatz_lagekennzahl_wahl`, Schreibweg [`waehlen`]): „Nachforderungen offen“ hat im Modul
//! keinen Entscheidungs-Datensatz, also ist die Wahl selbst die Entscheidung. Herleitung
//! `/mnt/project-files/llh-1021/llh-1371/design.md`.
//!
//! Eine Lagekennzahl ist aktiv, wenn eine **bewusste Entscheidung** dafür als Datensatz
//! vorliegt — nie durch einen Messwert, der sich während der Lage ändert. Sonst würde die
//! Reihe mit den Werten flackern (Prüfliste Kriterium 9). Das Feld steht am Einsatz statt an
//! den Fachabfragen: der Einsatz ist die Abfrage, die als erste da ist, und die Belegung der
//! Plätze darf beim Laden nicht wechseln.

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqliteConnection;
use utoipa::ToSchema;

wire_enum! {
    /// Eine aktive lagebezogene Kennzahl. Wire == `as_str()`.
    ///
    /// Die Plätze und Füllkennzahlen stehen im Frontend (`pages/lage-dashboard/lagebild.ts`);
    /// hier steht nur, welche Auslöser gesetzt sind. Die Reihenfolge der Varianten ist die
    /// Reihenfolge der Ausgabe von [`ableiten`].
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum Lagekennzahl {
        /// Mindestens ein maßgeblicher Pegel ist festgelegt (`einsatz_pegel`, LFH-606).
        Pegel => "pegel",
        /// Mindestens ein aktiver Evakuierungsbezirk (LFH-607): nicht storniert, Räumung nicht
        /// `aufgehoben`. Das Anlegen eines Bezirks IST die Anordnung samt Plangröße (CHECK
        /// `plan_personen >= 1`); Aufheben oder Stornieren des letzten nimmt sie zurück.
        Evakuiert => "evakuiert",
        /// „Nachforderungen offen“ ist gewählt (LLH-1371, `einsatz_lagekennzahl_wahl`). Der
        /// Auslöser ist die Wahl, nie die Zahl der offenen Nachforderungen.
        Nachforderungen => "nachforderungen",
    }
}

impl Lagekennzahl {
    /// Ob die Kennzahl per Wahl am Einsatz gesetzt wird ([`waehlen`]). Pegel und Evakuiert
    /// entstehen aus ihren Fachentscheidungen und sind nicht wählbar. Muss zum CHECK von
    /// `einsatz_lagekennzahl_wahl` (Migration 0245) passen.
    pub const fn ist_waehlbar(self) -> bool {
        match self {
            Lagekennzahl::Pegel | Lagekennzahl::Evakuiert => false,
            Lagekennzahl::Nachforderungen => true,
        }
    }
}

/// Höchstzahl der Einträge im Body der Wahl, gezählt vor dem Entdoppeln (`src/AGENTS.md`,
/// Eingabegrenzen: Listen von außen).
pub const WAHL_MAX: usize = 8;

/// Die aktiven Lagekennzahlen aus den Auslösern — EINE Ableitung für beide Stellen, an denen
/// `EinsatzAnzeige` entsteht (`Einsatz::anzeige`, `repo::liste_fuer`). Rein.
///
/// Beide Auslöser liefern beide Abfragen als `EXISTS`-Spalte:
///
/// - `pegel_festgelegt`: `EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id)`
/// - `evakuierung_angeordnet`: `EXISTS` über `evakuierungsbezirk` mit `storniert_at IS NULL`
///   und `raeumung <> 'aufgehoben'`. Das Prädikat ist wortgleich zu `istAktiverBezirk` im
///   Frontend (`betreuung/evakuierungKennzahl.ts`) — laufen die beiden auseinander, steht
///   „Evakuiert" auf dem Platz, aber die Kennzahl daneben ist leer.
/// - `nachforderungen_gewaehlt`: `EXISTS` über `einsatz_lagekennzahl_wahl` mit
///   `kennzahl = 'nachforderungen'` (LLH-1371).
///
/// Die Ausdrücke stehen in drei SQL-Literalen (Detail, Liste und [`lesen`]), nicht als geteilte
/// Konstante: `query_as` nimmt unter sqlx 0.9 nur `&'static str`, ein `format!` bräche den
/// Build. Dass Detail und Liste übereinstimmen, prüfen `tests/pegel.rs`
/// (`pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz`) und `tests/betreuung.rs`
/// (`bezirk_schaltet_die_lagekennzahl_am_einsatz`); dass [`lesen`] mitzieht, die
/// Umschalt-Tests in `tests/einsatz_live.rs`.
pub fn ableiten(
    pegel_festgelegt: bool,
    evakuierung_angeordnet: bool,
    nachforderungen_gewaehlt: bool,
) -> Vec<Lagekennzahl> {
    let mut aktiv = Vec::new();
    if pegel_festgelegt {
        aktiv.push(Lagekennzahl::Pegel);
    }
    if evakuierung_angeordnet {
        aktiv.push(Lagekennzahl::Evakuiert);
    }
    if nachforderungen_gewaehlt {
        aktiv.push(Lagekennzahl::Nachforderungen);
    }
    aktiv
}

/// Die aktiven Lagekennzahlen eines Einsatzes, gelesen in der offenen Transaktion (LFH-855).
///
/// Die Schreibwege der Auslöser (Pegel festlegen, Bezirk anlegen/ändern/stornieren) rufen sie
/// vor und nach ihrer Änderung: nur wenn sich die Menge unterscheidet, melden sie den Kopf
/// (`einsatz`, `routes::einsatz::kopf_geaendert`). Unter `BEGIN IMMEDIATE` schreibt niemand
/// dazwischen, der Vergleich ist exakt — dieselbe Technik wie beim Termin der Lagebesprechung
/// (LFH-555 D3). Herleitung:
/// `openspec/changes/archive/2026-10-04-lfh-855-lagekennzahl-umschalten-live/design.md` D1.
pub async fn lesen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<Lagekennzahl>, AppError> {
    let (pegel_festgelegt, evakuierung_angeordnet, nachforderungen_gewaehlt): (bool, bool, bool) =
        sqlx::query_as(
            "SELECT EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = ?), \
                    EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = ? \
                            AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben'), \
                    EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl w WHERE w.einsatz_id = ? \
                            AND w.kennzahl = 'nachforderungen')",
        )
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(ableiten(
        pegel_festgelegt,
        evakuierung_angeordnet,
        nachforderungen_gewaehlt,
    ))
}

/// Ergebnis von [`waehlen`]: die gespeicherte Wahl und ob sich die aktiven Lagekennzahlen
/// dadurch geändert haben (dann meldet die Route den Einsatzkopf, LFH-855).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WahlErgebnis {
    pub gewaehlt: Vec<Lagekennzahl>,
    pub umgeschaltet: bool,
}

/// Ersetzt die gewählten Lagekennzahlen eines Einsatzes (Vollersatz, LLH-1371 D4). `gewaehlt`
/// ist von der Route geprüft (nur wählbare) und entdoppelt. Eine bleibende Wahl behält
/// `gewaehlt_von_id` und `gewaehlt_at`.
pub async fn waehlen(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    gewaehlt: &[Lagekennzahl],
) -> Result<WahlErgebnis, AppError> {
    let wire = serde_json::to_string(&gewaehlt.iter().map(|k| k.as_str()).collect::<Vec<_>>())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    crate::write_retry!(pool, |conn| {
        let vorher = lesen(conn, einsatz_id).await?;
        sqlx::query(
            "DELETE FROM einsatz_lagekennzahl_wahl WHERE einsatz_id = ? \
             AND kennzahl NOT IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(&wire)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO einsatz_lagekennzahl_wahl (einsatz_id, kennzahl, gewaehlt_von_id) \
             SELECT ?, value, ? FROM json_each(?) WHERE true \
             ON CONFLICT(einsatz_id, kennzahl) DO NOTHING",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(&wire)
        .execute(&mut *conn)
        .await?;
        let nachher = lesen(conn, einsatz_id).await?;
        Ok(WahlErgebnis {
            gewaehlt: nachher
                .iter()
                .copied()
                .filter(|k| k.ist_waehlbar())
                .collect(),
            umgeschaltet: nachher != vorher,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_ausloeser_leer() {
        assert_eq!(ableiten(false, false, false), Vec::<Lagekennzahl>::new());
    }

    #[test]
    fn pegel_festgelegt_schaltet_pegel() {
        assert_eq!(ableiten(true, false, false), vec![Lagekennzahl::Pegel]);
    }

    #[test]
    fn evakuierung_angeordnet_schaltet_evakuiert() {
        assert_eq!(ableiten(false, true, false), vec![Lagekennzahl::Evakuiert]);
    }

    #[test]
    fn beide_in_enum_reihenfolge() {
        assert_eq!(
            ableiten(true, true, false),
            vec![Lagekennzahl::Pegel, Lagekennzahl::Evakuiert]
        );
    }

    #[test]
    fn gewaehlte_nachforderungen_stehen_hinter_den_abgeleiteten() {
        assert_eq!(
            ableiten(false, false, true),
            vec![Lagekennzahl::Nachforderungen]
        );
        assert_eq!(
            ableiten(true, true, true),
            vec![
                Lagekennzahl::Pegel,
                Lagekennzahl::Evakuiert,
                Lagekennzahl::Nachforderungen
            ]
        );
    }

    #[test]
    fn nur_nachforderungen_ist_waehlbar() {
        let waehlbar: Vec<_> = Lagekennzahl::ALLE
            .into_iter()
            .filter(|k| k.ist_waehlbar())
            .collect();
        assert_eq!(waehlbar, vec![Lagekennzahl::Nachforderungen]);
        assert_eq!(Lagekennzahl::Nachforderungen.as_str(), "nachforderungen");
    }

    #[test]
    fn wire_evakuiert() {
        assert_eq!(Lagekennzahl::Evakuiert.as_str(), "evakuiert");
    }

    // ── lesen: dieselben Auslöser wie `einsatz::repo::laden` ──

    async fn einsatz_mit_benutzer(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
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
        (einsatz, benutzer)
    }

    async fn bezirk(pool: &sqlx::SqlitePool, einsatz: i64, von: i64, bezeichnung: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO evakuierungsbezirk \
                (einsatz_id, bezeichnung, plan_personen, plan_erhebung, angelegt_von_id) \
             VALUES (?, ?, 100, 'geschaetzt', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bezeichnung)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn gelesen(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<Lagekennzahl> {
        let mut conn = pool.acquire().await.unwrap();
        lesen(&mut conn, einsatz).await.unwrap()
    }

    #[tokio::test]
    async fn lesen_ohne_ausloeser_leer() {
        let pool = crate::db::test_pool().await;
        let (einsatz, _) = einsatz_mit_benutzer(&pool).await;
        assert_eq!(gelesen(&pool, einsatz).await, Vec::<Lagekennzahl>::new());
    }

    #[tokio::test]
    async fn lesen_sieht_pegel_und_aktiven_bezirk() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = einsatz_mit_benutzer(&pool).await;
        sqlx::query(
            "INSERT INTO einsatz_pegel \
             (einsatz_id, station_uuid, name, reihenfolge, gesetzt_von_id) \
             VALUES (?, 'a1b2c3d4-0000-0000-0000-000000000001', 'Pegel', 0, ?)",
        )
        .bind(einsatz)
        .bind(von)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(gelesen(&pool, einsatz).await, vec![Lagekennzahl::Pegel]);
        bezirk(&pool, einsatz, von, "Uferstraße").await;
        assert_eq!(
            gelesen(&pool, einsatz).await,
            vec![Lagekennzahl::Pegel, Lagekennzahl::Evakuiert]
        );
    }

    #[tokio::test]
    async fn lesen_zaehlt_stornierte_und_aufgehobene_bezirke_nicht() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = einsatz_mit_benutzer(&pool).await;
        let storniert = bezirk(&pool, einsatz, von, "Fehlanlage").await;
        sqlx::query("UPDATE evakuierungsbezirk SET storniert_at = datetime('now') WHERE id = ?")
            .bind(storniert)
            .execute(&pool)
            .await
            .unwrap();
        let aufgehoben = bezirk(&pool, einsatz, von, "Altstadt").await;
        sqlx::query("UPDATE evakuierungsbezirk SET raeumung = 'aufgehoben' WHERE id = ?")
            .bind(aufgehoben)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(gelesen(&pool, einsatz).await, Vec::<Lagekennzahl>::new());
    }

    #[tokio::test]
    async fn waehlen_ersetzt_die_wahl_und_meldet_nur_ein_umschalten() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = einsatz_mit_benutzer(&pool).await;
        let n = [Lagekennzahl::Nachforderungen];

        let leer = waehlen(&pool, einsatz, von, &[]).await.unwrap();
        assert_eq!(
            leer,
            WahlErgebnis {
                gewaehlt: vec![],
                umgeschaltet: false
            }
        );
        let an = waehlen(&pool, einsatz, von, &n).await.unwrap();
        assert_eq!(
            an,
            WahlErgebnis {
                gewaehlt: n.to_vec(),
                umgeschaltet: true
            }
        );
        assert_eq!(gelesen(&pool, einsatz).await, n.to_vec());
        let nochmal = waehlen(&pool, einsatz, von, &n).await.unwrap();
        assert!(!nochmal.umgeschaltet);
        let aus = waehlen(&pool, einsatz, von, &[]).await.unwrap();
        assert!(aus.umgeschaltet);
        assert_eq!(gelesen(&pool, einsatz).await, Vec::<Lagekennzahl>::new());
    }

    #[tokio::test]
    async fn die_db_nimmt_keine_nicht_waehlbare_kennzahl_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = einsatz_mit_benutzer(&pool).await;
        let fehler = sqlx::query(
            "INSERT INTO einsatz_lagekennzahl_wahl (einsatz_id, kennzahl, gewaehlt_von_id) \
             VALUES (?, 'pegel', ?)",
        )
        .bind(einsatz)
        .bind(von)
        .execute(&pool)
        .await;
        assert!(fehler.is_err(), "CHECK lässt nur wählbare Kennzahlen zu");
    }

    #[tokio::test]
    async fn lesen_gilt_nur_fuer_den_eigenen_einsatz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = einsatz_mit_benutzer(&pool).await;
        let anderer: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Andere') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        bezirk(&pool, anderer, von, "Uferstraße").await;
        assert_eq!(gelesen(&pool, einsatz).await, Vec::<Lagekennzahl>::new());
    }
}
