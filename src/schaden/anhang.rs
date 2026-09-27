//! Fotos und Dateien an einem Schaden (LFH-21).
//!
//! Die Bytes liegen in `anhang`; `einsatz_schaden_anhang` ist der vierte Linker darauf und
//! steht im Register `anhang::repo::MODUL_LINKER`. Damit ist eine Schaden-Datei nur über die
//! Schadensroute erreichbar: generischer Download 404, generischer DELETE 422, Chat 400,
//! ETB 422, der Sweep hält sie.
//!
//! Ablegen und Entfernen laufen je in EINER Transaktion mit dem pseudonymen System-ETB-
//! Eintrag (Pattern B): Datei, Verknüpfung und Nachweis entstehen gemeinsam oder gar nicht,
//! eine Schaden-Datei ist nie ungebunden (design.md D4). Der Nachweis nennt nur
//! Registriernummer und Art, nie den Dateinamen ([`etb_text`], D6).

use crate::error::AppError;
use crate::schaden::{registrier_anzeige, repo as schaden_repo};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use utoipa::ToSchema;

/// Ein Anhang eines Schadens. `id` ist die **Linker-id** (`einsatz_schaden_anhang.id`),
/// nicht `anhang.id` — die Datei ist ohnehin nur über die Schadensroute ladbar, eine
/// `anhang_id` auf dem Wire wäre nur ein Anreiz, den gesperrten generischen Weg zu probieren.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
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

/// Vorgang für den ETB-Nachweis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vorgang {
    Abgelegt,
    Entfernt,
}

/// Wortlaut des pseudonymen ETB-Nachweises (design.md D6): „Schaden S-003: Foto abgelegt“.
/// Die Art kommt aus dem **serverseitig ermittelten** MIME, nie aus einer Eingabe; kein
/// Dateiname, kein Ort, keine Beschreibung.
pub fn etb_text(registrier_nr: i64, mime: &str, vorgang: Vorgang) -> String {
    let art = if mime == "application/pdf" {
        "PDF"
    } else if mime.starts_with("image/") {
        "Foto"
    } else {
        // Die Erfassungs-Allowlist lässt nur Bilder und PDF zu; der Zweig hält den Text auch
        // dann pseudonym, wenn sie einmal wächst.
        "Datei"
    };
    let tat = match vorgang {
        Vorgang::Abgelegt => "abgelegt",
        Vorgang::Entfernt => "entfernt",
    };
    format!("Schaden {}: {art} {tat}", registrier_anzeige(registrier_nr))
}

/// Lebende Anhänge je Schaden samt Anzeige-Joins.
const SELECT: &str = "SELECT l.id, l.schaden_id, a.dateiname, a.mime, a.groesse, \
        l.abgelegt_von_id, b.anzeigename AS abgelegt_von_name, l.abgelegt_at \
     FROM einsatz_schaden_anhang l \
     JOIN anhang a ON a.id = l.anhang_id \
     LEFT JOIN benutzer b ON b.id = l.abgelegt_von_id \
     WHERE l.einsatz_id = ? AND l.schaden_id = ? AND l.geloescht_at IS NULL";

/// Prüft, dass der Schaden zu diesem Einsatz gehört (sonst 404) — auch storniert.
async fn fordere_schaden(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<(), AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz_schaden WHERE id = ? AND einsatz_id = ?")
            .bind(schaden_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    treffer.map(|_| ()).ok_or(AppError::NotFound)
}

/// Lebende Anhänge eines Schadens dieses Einsatzes, neueste zuerst. Ein Schaden eines
/// anderen Einsatzes → `NotFound`; ein stornierter bleibt lesbar.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
) -> Result<Vec<SchadenAnhangAnzeige>, AppError> {
    fordere_schaden(pool, einsatz_id, schaden_id).await?;
    Ok(
        sqlx::query_as::<_, SchadenAnhangAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT} ORDER BY l.abgelegt_at DESC, l.id DESC"
        )))
        .bind(einsatz_id)
        .bind(schaden_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Ein lebender Anhang; fremd, unbekannt, anderer Schaden oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    id: i64,
) -> Result<SchadenAnhangAnzeige, AppError> {
    sqlx::query_as::<_, SchadenAnhangAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT} AND l.id = ?")))
        .bind(einsatz_id)
        .bind(schaden_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// `anhang_id` eines lebenden Anhangs für den Download. Der Lookup IST die Zugriffsprüfung
/// (Einsatz, Schaden, nicht entfernt); sonst `NotFound`.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT anhang_id FROM einsatz_schaden_anhang \
         WHERE id = ? AND schaden_id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
    )
    .bind(id)
    .bind(schaden_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Eingabe für [`ablegen`] — vom Handler geprüft (Typ, Größe, Scan).
pub struct Ablage<'a> {
    pub dateiname: &'a str,
    pub mime: &'a str,
    pub daten: &'a [u8],
}

fn storniert() -> AppError {
    AppError::Conflict("Schaden ist storniert".into())
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
        let schaden = schaden_repo::laden_tx(conn, einsatz_id, schaden_id).await?;
        if schaden.storniert_at.is_some() {
            return Err(storniert());
        }
        let anhang_id = crate::anhang::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            ablage.dateiname,
            ablage.mime,
            ablage.daten,
        )
        .await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_schaden_anhang \
               (einsatz_id, schaden_id, anhang_id, abgelegt_von_id) \
             VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(schaden_id)
        .bind(anhang_id)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        let text = etb_text(schaden.registrier_nr, ablage.mime, Vorgang::Abgelegt);
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text)
                .await?;
        Ok((id, etb_id))
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
        let mime: String = sqlx::query_scalar(
            "SELECT a.mime FROM einsatz_schaden_anhang l JOIN anhang a ON a.id = l.anhang_id \
             WHERE l.id = ? AND l.schaden_id = ? AND l.einsatz_id = ? \
               AND l.geloescht_at IS NULL",
        )
        .bind(id)
        .bind(schaden_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let schaden = schaden_repo::laden_tx(conn, einsatz_id, schaden_id).await?;
        if schaden.storniert_at.is_some() {
            return Err(storniert());
        }
        sqlx::query(
            "UPDATE einsatz_schaden_anhang \
             SET geloescht_at = datetime('now'), geloescht_von_id = ? WHERE id = ?",
        )
        .bind(benutzer_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let text = etb_text(schaden.registrier_nr, &mime, Vorgang::Entfernt);
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text).await
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
        schaden_repo::storniere(&st.pool, st.einsatz, sid, st.benutzer)
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
