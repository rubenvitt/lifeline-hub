//! Lagekennzahlen am Einsatz (LFH-640) — welche lagebezogenen Plätze des Kennzahlenbands im
//! Lage-Dashboard belegt sind.
//!
//! Spec: `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`.
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
    }
}

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
///
/// Die Ausdrücke stehen in drei SQL-Literalen (Detail, Liste und [`lesen`]), nicht als geteilte
/// Konstante: `query_as` nimmt unter sqlx 0.9 nur `&'static str`, ein `format!` bräche den
/// Build. Dass Detail und Liste übereinstimmen, prüfen `tests/pegel.rs`
/// (`pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz`) und `tests/betreuung.rs`
/// (`bezirk_schaltet_die_lagekennzahl_am_einsatz`); dass [`lesen`] mitzieht, die
/// Umschalt-Tests in `tests/einsatz_live.rs`.
pub fn ableiten(pegel_festgelegt: bool, evakuierung_angeordnet: bool) -> Vec<Lagekennzahl> {
    let mut aktiv = Vec::new();
    if pegel_festgelegt {
        aktiv.push(Lagekennzahl::Pegel);
    }
    if evakuierung_angeordnet {
        aktiv.push(Lagekennzahl::Evakuiert);
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
    let (pegel_festgelegt, evakuierung_angeordnet): (bool, bool) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = ?), \
                EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = ? \
                        AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben')",
    )
    .bind(einsatz_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(ableiten(pegel_festgelegt, evakuierung_angeordnet))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_ausloeser_leer() {
        assert_eq!(ableiten(false, false), Vec::<Lagekennzahl>::new());
    }

    #[test]
    fn pegel_festgelegt_schaltet_pegel() {
        assert_eq!(ableiten(true, false), vec![Lagekennzahl::Pegel]);
    }

    #[test]
    fn evakuierung_angeordnet_schaltet_evakuiert() {
        assert_eq!(ableiten(false, true), vec![Lagekennzahl::Evakuiert]);
    }

    #[test]
    fn beide_in_enum_reihenfolge() {
        assert_eq!(
            ableiten(true, true),
            vec![Lagekennzahl::Pegel, Lagekennzahl::Evakuiert]
        );
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
