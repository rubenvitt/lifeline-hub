//! Fotos, Unterlagen und Pläne an einer Unfallhilfsstelle (LFH-758, Spec `uhs-anhaenge`).
//!
//! `uhs_anhang` ist ein modulgebundener Linker auf `anhang` (Register
//! `anhang::repo::MODUL_LINKER`); Liste, Ablage und Soft-Delete stehen im Kern
//! `anhang::erfassung`. Hier bleiben Deskriptor, Wire-DTO und das Laden der UHS in der
//! Transaktion. Der ETB-Nachweis nennt nur die Bezeichnung („UHS BHP 50: Foto abgelegt“), die
//! die Schwärzung ohnehin behält — nie Dateiname, Standort oder Notiz. Jeder Abruf einer Datei
//! steht im Lese-Audit (`anhang::audit_repo`, Route `routes::uhs_anhang::datei`).

use crate::anhang::erfassung::{
    self as kern, Ablage, BesitzerKopf, ErfassungsAblage, ErfassungsAnhangZeile,
};
use crate::error::AppError;
use crate::uhs::repo as uhs_repo;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Deskriptor des UHS-Linkers für den Kern.
pub const UHS_ABLAGE: ErfassungsAblage = ErfassungsAblage {
    linker: "uhs_anhang",
    besitzer_spalte: "uhs_id",
    besitzer_tabelle: "uhs",
    storniert_meldung: "Unfallhilfsstelle ist storniert",
};

/// Ein Anhang einer UHS. `id` ist die **Linker-id** (`uhs_anhang.id`), nicht `anhang.id`: die
/// Datei ist nur über die UHS-Route ladbar.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UhsAnhangAnzeige {
    pub id: i64,
    pub uhs_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    /// Anzeigename der ablegenden Person; fehlt, wenn das Konto nicht mehr existiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

impl From<ErfassungsAnhangZeile> for UhsAnhangAnzeige {
    fn from(z: ErfassungsAnhangZeile) -> Self {
        Self {
            id: z.id,
            uhs_id: z.besitzer_id,
            dateiname: z.dateiname,
            mime: z.mime,
            groesse: z.groesse,
            abgelegt_von_id: z.abgelegt_von_id,
            abgelegt_von_name: z.abgelegt_von_name,
            abgelegt_at: z.abgelegt_at,
        }
    }
}

/// Name der UHS im ETB-Nachweis, im Vermerk eines Original-Abrufs und im Lese-Audit:
/// „UHS BHP 50“. Das Präfix macht Bezeichnungen wie „PA 1“ ohne Kontext lesbar.
pub fn ablage_name(bezeichnung: &str) -> String {
    format!("UHS {bezeichnung}")
}

/// Lebende Anhänge einer UHS dieses Einsatzes, neueste zuerst. Eine UHS eines anderen
/// Einsatzes → `NotFound`; eine stornierte bleibt lesbar.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<Vec<UhsAnhangAnzeige>, AppError> {
    Ok(kern::liste(pool, &UHS_ABLAGE, einsatz_id, uhs_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Ein lebender Anhang; fremd, unbekannt, andere UHS oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    id: i64,
) -> Result<UhsAnhangAnzeige, AppError> {
    Ok(kern::laden(pool, &UHS_ABLAGE, einsatz_id, uhs_id, id)
        .await?
        .into())
}

/// `anhang_id` eines lebenden Anhangs für den Download; der Lookup IST die Zugriffsprüfung.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    kern::anhang_id_fuer_download(pool, &UHS_ABLAGE, einsatz_id, uhs_id, id).await
}

/// Lädt die UHS in der offenen Transaktion (fremd/unbekannt → `NotFound`).
async fn kopf(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<BesitzerKopf, AppError> {
    let uhs = uhs_repo::laden_tx(conn, einsatz_id, uhs_id).await?;
    Ok(BesitzerKopf {
        storniert: uhs.storniert_at.is_some(),
        etb_name: ablage_name(&uhs.bezeichnung),
    })
}

/// Legt Anhang, Linker und System-ETB-Eintrag in EINER Transaktion an. UHS fremd oder
/// unbekannt → `NotFound`, storniert → `Conflict` ohne jede Zeile. Liefert
/// `(linker_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    crate::write_retry!(pool, |conn| {
        let kopf = kopf(conn, einsatz_id, uhs_id).await?;
        kern::ablegen_tx(
            conn,
            &UHS_ABLAGE,
            einsatz_id,
            uhs_id,
            benutzer_id,
            etb_startwert,
            &kopf,
            ablage,
        )
        .await
    })
}

/// Soft-Delete mit System-ETB-Nachweis in EINER Transaktion. Kein lebender Anhang dieser
/// UHS → `NotFound`; UHS storniert → `Conflict`. Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
) -> Result<i64, AppError> {
    crate::write_retry!(pool, |conn| {
        let mime = kern::lebender_mime_tx(conn, &UHS_ABLAGE, einsatz_id, uhs_id, id).await?;
        let kopf = kopf(conn, einsatz_id, uhs_id).await?;
        kern::entfernen_tx(
            conn,
            &UHS_ABLAGE,
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
    use crate::uhs::repo::NeueDaten;

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
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
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

    async fn uhs(st: &Stand, bezeichnung: &str) -> i64 {
        uhs_repo::anlegen(
            &st.pool,
            st.einsatz,
            st.benutzer,
            NeueDaten {
                typ: "behandlungsplatz",
                bezeichnung,
                abschnitt_id: None,
                standort: Some("Turnhalle Nord"),
                notiz: None,
            },
        )
        .await
        .unwrap()
        .id
    }

    async fn ablage(
        st: &Stand,
        uhs_id: i64,
        name: &str,
        mime: &str,
    ) -> Result<(i64, i64), AppError> {
        ablegen(
            &st.pool,
            st.einsatz,
            uhs_id,
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
    async fn ablegen_nennt_nur_die_bezeichnung_und_traegt_einen_einsatz() {
        let st = setup().await;
        let uid = uhs(&st, "BHP 50").await;
        let (id, etb) = ablage(&st, uid, "Patient_Mueller_Liege3.jpg", "image/jpeg")
            .await
            .unwrap();
        assert_eq!(etb_inhalt(&st.pool, etb).await, "UHS BHP 50: Foto abgelegt");
        assert_eq!(
            laden(&st.pool, st.einsatz, uid, id).await.unwrap().uhs_id,
            uid
        );

        let (u, l, an): (i64, i64, i64) = sqlx::query_as(
            "SELECT u.einsatz_id, l.einsatz_id, a.einsatz_id FROM uhs_anhang l \
             JOIN uhs u ON u.id = l.uhs_id JOIN anhang a ON a.id = l.anhang_id WHERE l.id = ?",
        )
        .bind(id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!((u, l, an), (st.einsatz, st.einsatz, st.einsatz));
    }

    #[tokio::test]
    async fn aufgeloeste_uhs_nimmt_an_stornierte_nicht() {
        let st = setup().await;
        let aufgeloest = uhs(&st, "PA 1").await;
        sqlx::query("UPDATE uhs SET status = 'aufgeloest' WHERE id = ?")
            .bind(aufgeloest)
            .execute(&st.pool)
            .await
            .unwrap();
        assert!(ablage(&st, aufgeloest, "geraeumt.jpg", "image/jpeg")
            .await
            .is_ok());

        let uid = uhs(&st, "BHP 50").await;
        let (id, _) = ablage(&st, uid, "plan.pdf", "application/pdf")
            .await
            .unwrap();
        uhs_repo::storniere(&st.pool, st.einsatz, uid, st.benutzer)
            .await
            .unwrap();
        assert!(matches!(
            ablage(&st, uid, "neu.jpg", "image/jpeg").await.unwrap_err(),
            AppError::Conflict(ref m) if m == "Unfallhilfsstelle ist storniert"
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, uid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        let liste = liste(&st.pool, st.einsatz, uid).await.unwrap();
        assert_eq!(liste.len(), 1, "der Anhang bleibt");
    }

    #[tokio::test]
    async fn entfernen_schreibt_nachweis() {
        let st = setup().await;
        let uid = uhs(&st, "BHP 50").await;
        let (id, _) = ablage(&st, uid, "plan.pdf", "application/pdf")
            .await
            .unwrap();
        let etb = entfernen(&st.pool, st.einsatz, uid, id, st.benutzer, st.startwert)
            .await
            .unwrap();
        assert_eq!(etb_inhalt(&st.pool, etb).await, "UHS BHP 50: PDF entfernt");
        assert!(liste(&st.pool, st.einsatz, uid).await.unwrap().is_empty());
    }
}
