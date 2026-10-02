//! Fotos und Dateien an einem Tier (LFH-758, Spec `tier-anhaenge`).
//!
//! `einsatz_tier_anhang` ist ein modulgebundener Linker auf `anhang` (Register
//! `anhang::repo::MODUL_LINKER`); Liste, Ablage und Soft-Delete stehen im Kern
//! `anhang::erfassung`. Hier bleiben Deskriptor, Wire-DTO und das Laden des Tieres in der
//! Transaktion. Der ETB-Nachweis nennt nur die Registriernummer („Tier T-007: Foto abgelegt“),
//! nie Dateiname, Kennzeichnung oder Halter. Kein Lese-Audit — wie Tiere insgesamt (`0031`).

use crate::anhang::erfassung::{
    self as kern, Ablage, BesitzerKopf, ErfassungsAblage, ErfassungsAnhangZeile,
};
use crate::error::AppError;
use crate::tier::{registrier_anzeige, repo as tier_repo};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Deskriptor des Tier-Linkers für den Kern.
pub const TIER_ABLAGE: ErfassungsAblage = ErfassungsAblage {
    linker: "einsatz_tier_anhang",
    besitzer_spalte: "tier_id",
    besitzer_tabelle: "einsatz_tier",
    storniert_meldung: "Tier ist storniert",
};

/// Ein Anhang eines Tieres. `id` ist die **Linker-id** (`einsatz_tier_anhang.id`), nicht
/// `anhang.id`: die Datei ist nur über die Tier-Route ladbar.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TierAnhangAnzeige {
    pub id: i64,
    pub tier_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    /// Anzeigename der ablegenden Person; fehlt, wenn das Konto nicht mehr existiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

impl From<ErfassungsAnhangZeile> for TierAnhangAnzeige {
    fn from(z: ErfassungsAnhangZeile) -> Self {
        Self {
            id: z.id,
            tier_id: z.besitzer_id,
            dateiname: z.dateiname,
            mime: z.mime,
            groesse: z.groesse,
            abgelegt_von_id: z.abgelegt_von_id,
            abgelegt_von_name: z.abgelegt_von_name,
            abgelegt_at: z.abgelegt_at,
        }
    }
}

/// Name des Tieres im ETB-Nachweis und im Vermerk eines Original-Abrufs: „Tier T-007“.
pub fn ablage_name(registrier_nr: i64) -> String {
    format!("Tier {}", registrier_anzeige(registrier_nr))
}

/// Lebende Anhänge eines Tieres dieses Einsatzes, neueste zuerst. Ein Tier eines anderen
/// Einsatzes → `NotFound`; ein storniertes bleibt lesbar.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
) -> Result<Vec<TierAnhangAnzeige>, AppError> {
    Ok(kern::liste(pool, &TIER_ABLAGE, einsatz_id, tier_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Ein lebender Anhang; fremd, unbekannt, anderes Tier oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    id: i64,
) -> Result<TierAnhangAnzeige, AppError> {
    Ok(kern::laden(pool, &TIER_ABLAGE, einsatz_id, tier_id, id)
        .await?
        .into())
}

/// `anhang_id` eines lebenden Anhangs für den Download; der Lookup IST die Zugriffsprüfung.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    kern::anhang_id_fuer_download(pool, &TIER_ABLAGE, einsatz_id, tier_id, id).await
}

/// Lädt das Tier in der offenen Transaktion (fremd/unbekannt → `NotFound`).
async fn kopf(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    tier_id: i64,
) -> Result<BesitzerKopf, AppError> {
    let tier = tier_repo::laden_tx(conn, einsatz_id, tier_id).await?;
    Ok(BesitzerKopf {
        storniert: tier.storniert_at.is_some(),
        etb_name: ablage_name(tier.registrier_nr),
    })
}

/// Legt Anhang, Linker und System-ETB-Eintrag in EINER Transaktion an. Tier fremd oder
/// unbekannt → `NotFound`, storniert → `Conflict` ohne jede Zeile. Liefert
/// `(linker_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    crate::write_retry!(pool, |conn| {
        let kopf = kopf(conn, einsatz_id, tier_id).await?;
        kern::ablegen_tx(
            conn,
            &TIER_ABLAGE,
            einsatz_id,
            tier_id,
            benutzer_id,
            etb_startwert,
            &kopf,
            ablage,
        )
        .await
    })
}

/// Soft-Delete mit System-ETB-Nachweis in EINER Transaktion. Kein lebender Anhang dieses
/// Tieres → `NotFound`; Tier storniert → `Conflict`. Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
) -> Result<i64, AppError> {
    crate::write_retry!(pool, |conn| {
        let mime = kern::lebender_mime_tx(conn, &TIER_ABLAGE, einsatz_id, tier_id, id).await?;
        let kopf = kopf(conn, einsatz_id, tier_id).await?;
        kern::entfernen_tx(
            conn,
            &TIER_ABLAGE,
            id,
            &mime,
            benutzer_id,
            etb_startwert,
            &kopf,
            einsatz_id,
        )
        .await
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tier::repo::NeueDaten;

    struct Stand {
        pool: SqlitePool,
        benutzer: i64,
        einsatz: i64,
        startwert: i64,
    }

    async fn setup() -> Stand {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz = einsatz_anlegen(&pool).await;
        let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz)
            .await
            .unwrap()
            .etb_startwert();
        Stand {
            pool,
            benutzer,
            einsatz,
            startwert,
        }
    }

    async fn einsatz_anlegen(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn tier(pool: &SqlitePool, einsatz: i64, von: i64, status: &str) -> i64 {
        tier_repo::anlegen(
            pool,
            einsatz,
            von,
            status,
            NeueDaten {
                spezies: "hund",
                rasse_beschreibung: None,
                rufname: Some("Bello"),
                geschlecht: None,
                alter_geschaetzt: None,
                farbe_beschreibung: None,
                kennzeichnung: Some("276098106543210"),
                groesse_gewicht: None,
                halter_person_id: None,
                halter_kontakt: Some("Müller, 0171 1234567"),
                antreff_ort: None,
                notiz: None,
            },
        )
        .await
        .unwrap()
        .id
    }

    async fn ablage(
        st: &Stand,
        tier_id: i64,
        name: &str,
        mime: &str,
    ) -> Result<(i64, i64), AppError> {
        ablegen(
            &st.pool,
            st.einsatz,
            tier_id,
            st.benutzer,
            st.startwert,
            &Ablage {
                dateiname: name,
                mime,
                daten: b"BILD",
            },
        )
        .await
    }

    async fn etb_inhalt(pool: &SqlitePool, etb_id: i64) -> String {
        sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn ablegen_nennt_nur_die_registriernummer_und_traegt_einen_einsatz() {
        let st = setup().await;
        let tid = tier(&st.pool, st.einsatz, st.benutzer, "aktiv").await;
        let (id, etb) = ablage(&st, tid, "Müller_Bello.jpg", "image/jpeg")
            .await
            .unwrap();

        let a = laden(&st.pool, st.einsatz, tid, id).await.unwrap();
        assert_eq!((a.tier_id, a.dateiname.as_str()), (tid, "Müller_Bello.jpg"));
        assert_eq!(etb_inhalt(&st.pool, etb).await, "Tier T-001: Foto abgelegt");

        let (t, l, an): (i64, i64, i64) = sqlx::query_as(
            "SELECT t.einsatz_id, l.einsatz_id, a.einsatz_id FROM einsatz_tier_anhang l \
             JOIN einsatz_tier t ON t.id = l.tier_id JOIN anhang a ON a.id = l.anhang_id \
             WHERE l.id = ?",
        )
        .bind(id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!((t, l, an), (st.einsatz, st.einsatz, st.einsatz));
    }

    #[tokio::test]
    async fn vermisstes_und_abgeschlossenes_tier_nehmen_an_storniertes_nicht() {
        let st = setup().await;
        let vermisst = tier(&st.pool, st.einsatz, st.benutzer, "vermisst").await;
        assert!(ablage(&st, vermisst, "a.jpg", "image/jpeg").await.is_ok());

        let tid = tier(&st.pool, st.einsatz, st.benutzer, "aktiv").await;
        let (id, _) = ablage(&st, tid, "a.pdf", "application/pdf").await.unwrap();
        tier_repo::storniere_tx(
            &mut st.pool.acquire().await.unwrap(),
            st.einsatz,
            tid,
            st.benutzer,
        )
        .await
        .unwrap();
        let vorher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert!(matches!(
            ablage(&st, tid, "neu.jpg", "image/jpeg").await.unwrap_err(),
            AppError::Conflict(ref m) if m == "Tier ist storniert"
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, tid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        let nachher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(vorher, nachher);
        assert_eq!(liste(&st.pool, st.einsatz, tid).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn entfernen_schreibt_nachweis_und_doppelt_ist_404() {
        let st = setup().await;
        let tid = tier(&st.pool, st.einsatz, st.benutzer, "aktiv").await;
        let fremd = tier(
            &st.pool,
            einsatz_anlegen(&st.pool).await,
            st.benutzer,
            "aktiv",
        )
        .await;
        let (id, _) = ablage(&st, tid, "a.pdf", "application/pdf").await.unwrap();
        assert!(matches!(
            liste(&st.pool, st.einsatz, fremd).await.unwrap_err(),
            AppError::NotFound
        ));

        let etb = entfernen(&st.pool, st.einsatz, tid, id, st.benutzer, st.startwert)
            .await
            .unwrap();
        assert_eq!(etb_inhalt(&st.pool, etb).await, "Tier T-001: PDF entfernt");
        assert!(liste(&st.pool, st.einsatz, tid).await.unwrap().is_empty());
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, tid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
    }
}
