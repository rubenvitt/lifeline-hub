//! Fotos und Dateien an einem Schaden (LFH-21).
//!
//! Die Bytes liegen in `anhang`; `einsatz_schaden_anhang` ist ein modulgebundener Linker darauf
//! und steht im Register `anhang::repo::MODUL_LINKER`. Damit ist eine Schaden-Datei nur über die
//! Schadensroute erreichbar: generischer Download 404, generischer DELETE 422, Chat 400,
//! ETB 422, der Sweep hält sie.
//!
//! Liste, Ablage und Soft-Delete stehen im gemeinsamen Kern `anhang::erfassung` (LFH-758); hier
//! bleiben der Deskriptor [`SCHADEN_ABLAGE`], das Wire-DTO und das Laden des Schadens in der
//! Transaktion. Datei, Verknüpfung und ETB-Nachweis entstehen gemeinsam oder gar nicht; der
//! Nachweis nennt nur Registriernummer und Art, nie den Dateinamen (LFH-21 D4, D6).

use crate::anhang::erfassung::{
    self as kern, BesitzerKopf, ErfassungsAblage, ErfassungsAnhangZeile,
};
pub use crate::anhang::erfassung::{Ablage, Vorgang};
use crate::error::AppError;
use crate::schaden::{registrier_anzeige, repo as schaden_repo};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Deskriptor des Schaden-Linkers für den Kern.
pub const SCHADEN_ABLAGE: ErfassungsAblage = ErfassungsAblage {
    linker: "einsatz_schaden_anhang",
    besitzer_spalte: "schaden_id",
    besitzer_tabelle: "einsatz_schaden",
    storniert_meldung: "Schaden ist storniert",
};

/// Ein Anhang eines Schadens. `id` ist die **Linker-id** (`einsatz_schaden_anhang.id`),
/// nicht `anhang.id` — die Datei ist ohnehin nur über die Schadensroute ladbar, eine
/// `anhang_id` auf dem Wire wäre nur ein Anreiz, den gesperrten generischen Weg zu probieren.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SchadenAnhangAnzeige {
    pub id: i64,
    pub schaden_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    /// Anzeigename der ablegenden Person; fehlt, wenn das Konto nicht mehr existiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

impl From<ErfassungsAnhangZeile> for SchadenAnhangAnzeige {
    fn from(z: ErfassungsAnhangZeile) -> Self {
        Self {
            id: z.id,
            schaden_id: z.besitzer_id,
            dateiname: z.dateiname,
            mime: z.mime,
            groesse: z.groesse,
            abgelegt_von_id: z.abgelegt_von_id,
            abgelegt_von_name: z.abgelegt_von_name,
            abgelegt_at: z.abgelegt_at,
        }
    }
}

/// Wortlaut des pseudonymen ETB-Nachweises: „Schaden S-003: Foto abgelegt“.
pub fn etb_text(registrier_nr: i64, mime: &str, vorgang: Vorgang) -> String {
    kern::etb_text(&etb_name(registrier_nr), mime, vorgang)
}

fn etb_name(registrier_nr: i64) -> String {
    format!("Schaden {}", registrier_anzeige(registrier_nr))
}

/// Lebende Anhänge eines Schadens dieses Einsatzes, neueste zuerst. Ein Schaden eines
/// anderen Einsatzes → `NotFound`; ein stornierter bleibt lesbar.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<Vec<SchadenAnhangAnzeige>, AppError> {
    Ok(kern::liste(pool, &SCHADEN_ABLAGE, einsatz_id, schaden_id)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

/// Ein lebender Anhang; fremd, unbekannt, anderer Schaden oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    id: i64,
) -> Result<SchadenAnhangAnzeige, AppError> {
    Ok(
        kern::laden(pool, &SCHADEN_ABLAGE, einsatz_id, schaden_id, id)
            .await?
            .into(),
    )
}

/// `anhang_id` eines lebenden Anhangs für den Download. Der Lookup IST die Zugriffsprüfung
/// (Einsatz, Schaden, nicht entfernt); sonst `NotFound`.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    kern::anhang_id_fuer_download(pool, &SCHADEN_ABLAGE, einsatz_id, schaden_id, id).await
}

/// Lädt den Schaden in der offenen Transaktion (fremd/unbekannt → `NotFound`).
async fn kopf(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<BesitzerKopf, AppError> {
    let schaden = schaden_repo::laden_tx(conn, einsatz_id, schaden_id).await?;
    Ok(BesitzerKopf {
        storniert: schaden.storniert_at.is_some(),
        etb_name: etb_name(schaden.registrier_nr),
    })
}

/// Legt Anhang, Linker und System-ETB-Eintrag in EINER Transaktion an. Schaden fremd oder
/// unbekannt → `NotFound`, storniert → `Conflict` (409), dann ohne jede Zeile. Liefert
/// `(linker_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    crate::write_retry!(pool, |conn| {
        let kopf = kopf(conn, einsatz_id, schaden_id).await?;
        kern::ablegen_tx(
            conn,
            &SCHADEN_ABLAGE,
            einsatz_id,
            schaden_id,
            benutzer_id,
            etb_startwert,
            &kopf,
            ablage,
        )
        .await
    })
}

/// Soft-Delete mit System-ETB-Nachweis in EINER Transaktion. Kein lebender Anhang dieses
/// Schadens in diesem Einsatz → `NotFound`; Schaden storniert → `Conflict`. Die Datei bleibt
/// gespeichert bis zur Schwärzung. Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
) -> Result<i64, AppError> {
    crate::write_retry!(pool, |conn| {
        let mime =
            kern::lebender_mime_tx(conn, &SCHADEN_ABLAGE, einsatz_id, schaden_id, id).await?;
        let kopf = kopf(conn, einsatz_id, schaden_id).await?;
        kern::entfernen_tx(
            conn,
            &SCHADEN_ABLAGE,
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
    use crate::schaden::repo::NeueDaten;

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

    async fn schaden(pool: &SqlitePool, einsatz: i64, von: i64) -> (i64, i64) {
        let s = schaden_repo::anlegen(
            pool,
            einsatz,
            von,
            NeueDaten {
                typ: "sachschaden",
                ausmass: "gering",
                ort: "Hauptstr. 1",
                beschreibung: None,
                lat: None,
                lon: None,
                geschaedigt_person_id: None,
                geschaedigt_kontakt: None,
                geschaedigt_personal_id: None,
                geschaedigt_organisation_id: None,
            },
        )
        .await
        .unwrap();
        (s.id, s.registrier_nr)
    }

    async fn ablage(
        st: &Stand,
        schaden_id: i64,
        name: &str,
        mime: &str,
    ) -> Result<(i64, i64), AppError> {
        ablegen(
            &st.pool,
            st.einsatz,
            schaden_id,
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

    async fn zaehle(pool: &SqlitePool, sql: &'static str, id: i64) -> i64 {
        sqlx::query_scalar(sql)
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn etb_text_nennt_nur_nummer_und_art() {
        assert_eq!(
            etb_text(3, "image/jpeg", Vorgang::Abgelegt),
            "Schaden S-003: Foto abgelegt"
        );
        assert_eq!(
            etb_text(3, "image/heic", Vorgang::Entfernt),
            "Schaden S-003: Foto entfernt"
        );
        assert_eq!(
            etb_text(12, "application/pdf", Vorgang::Abgelegt),
            "Schaden S-012: PDF abgelegt"
        );
        assert_eq!(
            etb_text(12, "application/pdf", Vorgang::Entfernt),
            "Schaden S-012: PDF entfernt"
        );
    }

    #[tokio::test]
    async fn ablegen_liefert_anzeige_und_liste_neueste_zuerst_ohne_entfernte() {
        let st = setup().await;
        let (sid, _) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let (erst, _) = ablage(&st, sid, "dach.jpg", "image/jpeg").await.unwrap();
        let (zweit, _) = ablage(&st, sid, "gutachten.pdf", "application/pdf")
            .await
            .unwrap();
        let (dritt, _) = ablage(&st, sid, "rest.png", "image/png").await.unwrap();

        let a = laden(&st.pool, st.einsatz, sid, erst).await.unwrap();
        assert_eq!(a.dateiname, "dach.jpg");
        assert_eq!(a.mime, "image/jpeg");
        assert_eq!(a.groesse, 4);
        assert_eq!(a.schaden_id, sid);
        assert_eq!(a.abgelegt_von_id, st.benutzer);
        assert_eq!(a.abgelegt_von_name.as_deref(), Some("Leitung"));

        entfernen(&st.pool, st.einsatz, sid, dritt, st.benutzer, st.startwert)
            .await
            .unwrap();
        let ids: Vec<i64> = liste(&st.pool, st.einsatz, sid)
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(ids, vec![zweit, erst], "neueste zuerst, entfernte nicht");
    }

    #[tokio::test]
    async fn schaden_linker_und_anhang_tragen_denselben_einsatz() {
        let st = setup().await;
        let (sid, _) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let (id, _) = ablage(&st, sid, "dach.jpg", "image/jpeg").await.unwrap();
        let (s, l, a): (i64, i64, i64) = sqlx::query_as(
            "SELECT s.einsatz_id, l.einsatz_id, a.einsatz_id FROM einsatz_schaden_anhang l \
             JOIN einsatz_schaden s ON s.id = l.schaden_id JOIN anhang a ON a.id = l.anhang_id \
             WHERE l.id = ?",
        )
        .bind(id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!((s, l, a), (st.einsatz, st.einsatz, st.einsatz));
    }

    #[tokio::test]
    async fn fremder_schaden_und_anhang_eines_anderen_schadens_sind_404() {
        let st = setup().await;
        let (sid, _) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let (anderer, _) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let fremder_einsatz = einsatz_anlegen(&st.pool).await;
        let (fremd, _) = schaden(&st.pool, fremder_einsatz, st.benutzer).await;
        let (id, _) = ablage(&st, sid, "dach.jpg", "image/jpeg").await.unwrap();

        // Schaden eines anderen Einsatzes über die Adresse dieses Einsatzes.
        assert!(matches!(
            liste(&st.pool, st.einsatz, fremd).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            ablage(&st, fremd, "x.jpg", "image/jpeg").await.unwrap_err(),
            AppError::NotFound
        ));
        // Anhang über die Adresse eines anderen Schadens im selben Einsatz.
        assert!(matches!(
            laden(&st.pool, st.einsatz, anderer, id).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            anhang_id_fuer_download(&st.pool, st.einsatz, anderer, id)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, anderer, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert!(
            laden(&st.pool, st.einsatz, sid, id).await.is_ok(),
            "unverändert"
        );
    }

    #[tokio::test]
    async fn storniert_ist_409_ohne_jede_zeile_und_bleibt_lesbar() {
        let st = setup().await;
        let (sid, _) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let (id, _) = ablage(&st, sid, "dach.jpg", "image/jpeg").await.unwrap();
        schaden_repo::storniere_tx(
            &mut *st.pool.acquire().await.unwrap(),
            st.einsatz,
            sid,
            st.benutzer,
        )
        .await
        .unwrap();
        let anhaenge = zaehle(
            &st.pool,
            "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
            st.einsatz,
        )
        .await;
        let linker = zaehle(
            &st.pool,
            "SELECT COUNT(*) FROM einsatz_schaden_anhang WHERE einsatz_id = ?",
            st.einsatz,
        )
        .await;
        let etb = zaehle(
            &st.pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            st.einsatz,
        )
        .await;

        assert!(matches!(
            ablage(&st, sid, "neu.jpg", "image/jpeg").await.unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, sid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert_eq!(
            zaehle(
                &st.pool,
                "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
                st.einsatz
            )
            .await,
            anhaenge
        );
        assert_eq!(
            zaehle(
                &st.pool,
                "SELECT COUNT(*) FROM einsatz_schaden_anhang WHERE einsatz_id = ?",
                st.einsatz
            )
            .await,
            linker
        );
        assert_eq!(
            zaehle(
                &st.pool,
                "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
                st.einsatz
            )
            .await,
            etb
        );
        // Lesen bleibt.
        assert_eq!(liste(&st.pool, st.einsatz, sid).await.unwrap().len(), 1);
        assert!(anhang_id_fuer_download(&st.pool, st.einsatz, sid, id)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn doppeltes_entfernen_ist_404_ohne_zweiten_etb_eintrag() {
        let st = setup().await;
        let (sid, nr) = schaden(&st.pool, st.einsatz, st.benutzer).await;
        let (id, _) = ablage(&st, sid, "gutachten.pdf", "application/pdf")
            .await
            .unwrap();
        let etb_id = entfernen(&st.pool, st.einsatz, sid, id, st.benutzer, st.startwert)
            .await
            .unwrap();
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(inhalt, etb_text(nr, "application/pdf", Vorgang::Entfernt));
        let etb = zaehle(
            &st.pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            st.einsatz,
        )
        .await;

        assert!(matches!(
            entfernen(&st.pool, st.einsatz, sid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(
            zaehle(
                &st.pool,
                "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
                st.einsatz
            )
            .await,
            etb
        );
        assert!(
            anhang_id_fuer_download(&st.pool, st.einsatz, sid, id)
                .await
                .is_err(),
            "entfernt ist nicht mehr ladbar"
        );
        assert_eq!(
            zaehle(
                &st.pool,
                "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
                st.einsatz
            )
            .await,
            1,
            "die Datei bleibt als Beweis bis zur Schwärzung"
        );
    }
}
