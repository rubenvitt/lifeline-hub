//! Lese-Audit je Datei-Abruf (LFH-758, Tabelle `anhang_zugriff_audit`, Migration 0138).
//!
//! Heute schreibt nur der Download einer UHS-Datei (`routes::uhs_anhang::datei`), VOR der
//! Antwort und fail-closed: scheitert [`anlegen`], liefert die Route nichts aus. **Append-only**
//! — dieses Repo bietet bewusst kein UPDATE/DELETE. Die Einsicht ([`liste_je_besitzer`]) liest
//! über den Linker einer Erfassungs-Ablage, auch für entfernte Anhänge, und ist der
//! Einsatzleitung vorbehalten (Route); sie wird selbst nicht protokolliert.

use crate::anhang::erfassung::ErfassungsAblage;
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Welche Fassung abgerufen wurde. Wire = DB-CHECK `fassung IN ('bereinigt','original')`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ZugriffFassung {
    Bereinigt,
    Original,
}

impl ZugriffFassung {
    fn als_str(self) -> &'static str {
        match self {
            ZugriffFassung::Bereinigt => "bereinigt",
            ZugriffFassung::Original => "original",
        }
    }
}

/// Ein Protokolleintrag für die Einsicht. `anhang_id` ist die **Linker-id** (wie auf dem Wire
/// der Anhangliste), damit die Oberfläche die Zeile der Datei zuordnen kann.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AnhangZugriffAnzeige {
    pub id: i64,
    pub anhang_id: i64,
    pub dateiname: String,
    pub benutzer_id: i64,
    pub benutzer_name: String,
    #[schema(value_type = ZugriffFassung)]
    pub fassung: String,
    pub zugriff_at: String,
}

/// Schreibt einen append-only Protokolleintrag. `anhang_id` ist `anhang.id` (aus dem
/// Linker-Lookup derselben Anfrage), `ablage` der lesbare Ort („UHS BHP 50“).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    anhang_id: i64,
    ablage: &str,
    benutzer_id: i64,
    fassung: ZugriffFassung,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO anhang_zugriff_audit (einsatz_id, anhang_id, ablage, benutzer_id, fassung) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(anhang_id)
    .bind(ablage)
    .bind(benutzer_id)
    .bind(fassung.als_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Protokoll aller Anhänge eines Besitzers der Ablage `d` (auch entfernter), neueste zuerst.
/// Der JOIN über den Linker mit `einsatz_id` und Besitzer trennt Einsätze und Besitzer.
pub async fn liste_je_besitzer(
    pool: &SqlitePool,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
) -> Result<Vec<AnhangZugriffAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, AnhangZugriffAnzeige>(sqlx::AssertSqlSafe(format!(
            "SELECT z.id, l.id AS anhang_id, a.dateiname, z.benutzer_id, \
                    b.anzeigename AS benutzer_name, z.fassung, z.zugriff_at \
             FROM anhang_zugriff_audit z \
             JOIN {t} l ON l.anhang_id = z.anhang_id AND l.einsatz_id = z.einsatz_id \
             JOIN anhang a ON a.id = z.anhang_id \
             JOIN benutzer b ON b.id = z.benutzer_id \
             WHERE z.einsatz_id = ? AND l.{b} = ? \
             ORDER BY z.zugriff_at DESC, z.id DESC",
            t = d.linker,
            b = d.besitzer_spalte,
        )))
        .bind(einsatz_id)
        .bind(besitzer_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anhang::erfassung::Ablage;
    use crate::uhs::anhang::{self as ua, UHS_ABLAGE};

    struct Stand {
        pool: SqlitePool,
        leit: i64,
        einsatz: i64,
        startwert: i64,
    }

    async fn setup() -> Stand {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let leit = benutzer(&pool, "leit", "Leitung").await;
        let einsatz = einsatz(&pool).await;
        let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz)
            .await
            .unwrap()
            .etb_startwert();
        Stand {
            pool,
            leit,
            einsatz,
            startwert,
        }
    }

    async fn benutzer(pool: &SqlitePool, name: &str, anzeige: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h') RETURNING id",
        )
        .bind(anzeige)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn uhs(pool: &SqlitePool, einsatz: i64, von: i64, bezeichnung: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', ?, ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(bezeichnung)
        .bind(von)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Legt eine Datei ab; liefert (linker_id, anhang_id).
    async fn datei(st: &Stand, uhs_id: i64, name: &str) -> (i64, i64) {
        let (lid, _) = ua::ablegen(
            &st.pool,
            st.einsatz,
            uhs_id,
            st.leit,
            st.startwert,
            &Ablage {
                dateiname: name,
                mime: "application/pdf",
                daten: b"%PDF",
            },
        )
        .await
        .unwrap();
        let aid = ua::anhang_id_fuer_download(&st.pool, st.einsatz, uhs_id, lid)
            .await
            .unwrap();
        (lid, aid)
    }

    #[tokio::test]
    async fn liste_trennt_uhs_und_einsaetze_und_haelt_entfernte_neueste_zuerst() {
        let st = setup().await;
        let leser = benutzer(&st.pool, "frieda", "Frieda").await;
        let bhp = uhs(&st.pool, st.einsatz, st.leit, "BHP 50").await;
        let pa = uhs(&st.pool, st.einsatz, st.leit, "PA 1").await;
        let (l1, a1) = datei(&st, bhp, "plan.pdf").await;
        let (_, a2) = datei(&st, pa, "liste.pdf").await;

        anlegen(
            &st.pool,
            st.einsatz,
            a1,
            "UHS BHP 50",
            leser,
            ZugriffFassung::Bereinigt,
        )
        .await
        .unwrap();
        anlegen(
            &st.pool,
            st.einsatz,
            a2,
            "UHS PA 1",
            leser,
            ZugriffFassung::Bereinigt,
        )
        .await
        .unwrap();
        anlegen(
            &st.pool,
            st.einsatz,
            a1,
            "UHS BHP 50",
            st.leit,
            ZugriffFassung::Original,
        )
        .await
        .unwrap();
        // Dieselbe anhang_id in einem fremden Einsatz zählt nicht zu dieser UHS.
        let fremd = einsatz(&st.pool).await;
        anlegen(
            &st.pool,
            fremd,
            a1,
            "UHS X",
            leser,
            ZugriffFassung::Bereinigt,
        )
        .await
        .unwrap();

        ua::entfernen(&st.pool, st.einsatz, bhp, l1, st.leit, st.startwert)
            .await
            .unwrap();

        let z = liste_je_besitzer(&st.pool, &UHS_ABLAGE, st.einsatz, bhp)
            .await
            .unwrap();
        let kurz: Vec<(i64, &str, &str, &str)> = z
            .iter()
            .map(|e| {
                (
                    e.anhang_id,
                    e.dateiname.as_str(),
                    e.benutzer_name.as_str(),
                    e.fassung.as_str(),
                )
            })
            .collect();
        assert_eq!(
            kurz,
            vec![
                (l1, "plan.pdf", "Leitung", "original"),
                (l1, "plan.pdf", "Frieda", "bereinigt"),
            ],
            "nur BHP 50, nur dieser Einsatz, auch nach dem Entfernen, neueste zuerst"
        );
        assert_eq!(
            liste_je_besitzer(&st.pool, &UHS_ABLAGE, st.einsatz, pa)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn fassung_steht_als_wire_wert_in_der_tabelle() {
        let st = setup().await;
        anlegen(
            &st.pool,
            st.einsatz,
            99,
            "UHS BHP 50",
            st.leit,
            ZugriffFassung::Original,
        )
        .await
        .unwrap();
        let (fassung, ablage): (String, String) =
            sqlx::query_as("SELECT fassung, ablage FROM anhang_zugriff_audit")
                .fetch_one(&st.pool)
                .await
                .unwrap();
        assert_eq!(
            (fassung.as_str(), ablage.as_str()),
            ("original", "UHS BHP 50")
        );
        assert_eq!(
            serde_json::to_value(ZugriffFassung::Bereinigt).unwrap(),
            "bereinigt"
        );
    }
}
