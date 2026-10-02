//! Fotos und Dateien an einer betroffenen Person (LFH-757, Muster LFH-21).
//!
//! Die Bytes liegen in `anhang`; `einsatz_person_anhang` ist der fünfte Linker darauf und steht
//! im Register `anhang::repo::MODUL_LINKER`. Damit ist eine Personen-Datei nur über die
//! Personenroute erreichbar — und nur dort schreibt jeder Download eine Zeile ins
//! Zugriffsprotokoll (`routes::person_anhang::datei`, design.md D3). Generischer Download 404,
//! generischer DELETE 422, Chat 400, ETB 422, der Sweep hält sie.
//!
//! Ablegen und Entfernen laufen je in EINER Transaktion mit dem pseudonymen System-ETB-Eintrag:
//! Datei, Verknüpfung und Nachweis entstehen gemeinsam oder gar nicht. Der Nachweis nennt nur
//! Registriernummer und Art ([`etb_text`]), nie Dateinamen oder Namen.

use crate::anhang::{erfassung_art, Vorgang};
use crate::error::AppError;
use crate::person::{registrier_anzeige, repo as person_repo};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use utoipa::ToSchema;

/// Ein Anhang einer Person. `id` ist die **Linker-id** (`einsatz_person_anhang.id`), nicht
/// `anhang.id` — die Datei ist nur über die Personenroute ladbar (mit Lese-Audit); eine
/// `anhang_id` auf dem Wire wäre nur ein Anreiz, den gesperrten generischen Weg zu probieren.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct PersonAnhangAnzeige {
    pub id: i64,
    pub person_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    /// Anzeigename der ablegenden Person; fehlt, wenn das Konto nicht mehr existiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

/// Wortlaut des pseudonymen ETB-Nachweises (design.md D4): „Person R-007: Foto abgelegt“. Die
/// Art kommt aus dem serverseitig ermittelten MIME; kein Dateiname, kein Name, kein Freitext.
pub fn etb_text(registrier_nr: i64, mime: &str, vorgang: Vorgang) -> String {
    format!(
        "Person {}: {} {}",
        registrier_anzeige(registrier_nr),
        erfassung_art(mime),
        vorgang.wort()
    )
}

/// Lebende Anhänge je Person samt Anzeige-Joins.
const SELECT: &str = "SELECT l.id, l.person_id, a.dateiname, a.mime, a.groesse, \
        l.abgelegt_von_id, b.anzeigename AS abgelegt_von_name, l.abgelegt_at \
     FROM einsatz_person_anhang l \
     JOIN anhang a ON a.id = l.anhang_id \
     LEFT JOIN benutzer b ON b.id = l.abgelegt_von_id \
     WHERE l.einsatz_id = ? AND l.person_id = ? AND l.geloescht_at IS NULL";

/// Lebende Anhänge einer Person dieses Einsatzes, neueste zuerst. Eine Person eines anderen
/// Einsatzes → `NotFound`; eine stornierte bleibt lesbar. Schreibt bewusst KEIN Audit (Spec
/// „Liste ohne Protokolleintrag“).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<PersonAnhangAnzeige>, AppError> {
    person_repo::laden(pool, einsatz_id, person_id).await?;
    Ok(
        sqlx::query_as::<_, PersonAnhangAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT} ORDER BY l.abgelegt_at DESC, l.id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Ein lebender Anhang; fremd, unbekannt, andere Person oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
) -> Result<PersonAnhangAnzeige, AppError> {
    sqlx::query_as::<_, PersonAnhangAnzeige>(sqlx::AssertSqlSafe(format!("{SELECT} AND l.id = ?")))
        .bind(einsatz_id)
        .bind(person_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// `anhang_id` eines lebenden Anhangs für den Download. Der Lookup IST die Zugriffsprüfung
/// (Einsatz, Person, nicht entfernt); sonst `NotFound` — dann schreibt der Aufrufer kein Audit.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT anhang_id FROM einsatz_person_anhang \
         WHERE id = ? AND person_id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
    )
    .bind(id)
    .bind(person_id)
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

pub(crate) fn storniert() -> AppError {
    AppError::Conflict("Person ist storniert".into())
}

/// Legt Anhang, Linker und System-ETB-Eintrag in EINER Transaktion an. Person fremd oder
/// unbekannt → `NotFound`, storniert → `Conflict` (409), dann ohne jede Zeile. Der Status der
/// Person (vermisst, abgemeldet, verstorben) sperrt nichts. Liefert `(linker_id, etb_id)`; SSE
/// macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    crate::write_retry!(pool, |conn| {
        let person = person_repo::laden_tx(conn, einsatz_id, person_id).await?;
        if person.storniert_at.is_some() {
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
            "INSERT INTO einsatz_person_anhang \
               (einsatz_id, person_id, anhang_id, abgelegt_von_id) \
             VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(person_id)
        .bind(anhang_id)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        let text = etb_text(person.registrier_nr, ablage.mime, Vorgang::Abgelegt);
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text)
                .await?;
        Ok((id, etb_id))
    })
}

/// Soft-Delete mit System-ETB-Nachweis in EINER Transaktion. Kein lebender Anhang dieser Person
/// in diesem Einsatz → `NotFound`; Person storniert → `Conflict`. Die Datei bleibt gespeichert
/// bis zur Schwärzung. Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
) -> Result<i64, AppError> {
    crate::write_retry!(pool, |conn| {
        let mime: String = sqlx::query_scalar(
            "SELECT a.mime FROM einsatz_person_anhang l JOIN anhang a ON a.id = l.anhang_id \
             WHERE l.id = ? AND l.person_id = ? AND l.einsatz_id = ? \
               AND l.geloescht_at IS NULL",
        )
        .bind(id)
        .bind(person_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let person = person_repo::laden_tx(conn, einsatz_id, person_id).await?;
        if person.storniert_at.is_some() {
            return Err(storniert());
        }
        sqlx::query(
            "UPDATE einsatz_person_anhang \
             SET geloescht_at = datetime('now'), geloescht_von_id = ? WHERE id = ?",
        )
        .bind(benutzer_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let text = etb_text(person.registrier_nr, &mime, Vorgang::Entfernt);
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text).await
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// Legt eine Person mit Status `status` an; liefert `(id, registrier_nr)`.
    async fn person(pool: &SqlitePool, einsatz: i64, von: i64, status: &str) -> (i64, i64) {
        sqlx::query_as(
            "INSERT INTO einsatz_person \
               (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, (SELECT COALESCE(MAX(registrier_nr), 0) + 1 FROM einsatz_person \
                         WHERE einsatz_id = ?), ?, ?, ?) \
             RETURNING id, registrier_nr",
        )
        .bind(einsatz)
        .bind(einsatz)
        .bind(status)
        .bind(von)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn ablage(
        st: &Stand,
        person_id: i64,
        name: &str,
        mime: &str,
    ) -> Result<(i64, i64), AppError> {
        ablegen(
            &st.pool,
            st.einsatz,
            person_id,
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

    const ANHAENGE: &str = "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?";
    const LINKER: &str = "SELECT COUNT(*) FROM einsatz_person_anhang WHERE einsatz_id = ?";
    const ETB: &str = "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?";

    #[test]
    fn etb_text_nennt_nur_nummer_und_art() {
        assert_eq!(
            etb_text(7, "image/jpeg", Vorgang::Abgelegt),
            "Person R-007: Foto abgelegt"
        );
        assert_eq!(
            etb_text(7, "image/heic", Vorgang::Entfernt),
            "Person R-007: Foto entfernt"
        );
        assert_eq!(
            etb_text(12, "application/pdf", Vorgang::Abgelegt),
            "Person R-012: PDF abgelegt"
        );
        assert_eq!(
            etb_text(12, "application/pdf", Vorgang::Entfernt),
            "Person R-012: PDF entfernt"
        );
    }

    #[tokio::test]
    async fn ablegen_liefert_anzeige_und_liste_neueste_zuerst_ohne_entfernte() {
        let st = setup().await;
        let (pid, _) = person(&st.pool, st.einsatz, st.benutzer, "betroffen").await;
        let (erst, _) = ablage(&st, pid, "verletzung.jpg", "image/jpeg")
            .await
            .unwrap();
        let (zweit, _) = ablage(&st, pid, "protokoll.pdf", "application/pdf")
            .await
            .unwrap();
        let (dritt, _) = ablage(&st, pid, "rest.png", "image/png").await.unwrap();

        let a = laden(&st.pool, st.einsatz, pid, erst).await.unwrap();
        assert_eq!(a.dateiname, "verletzung.jpg");
        assert_eq!(a.mime, "image/jpeg");
        assert_eq!(a.groesse, 4);
        assert_eq!(a.person_id, pid);
        assert_eq!(a.abgelegt_von_id, st.benutzer);
        assert_eq!(a.abgelegt_von_name.as_deref(), Some("Leitung"));

        entfernen(&st.pool, st.einsatz, pid, dritt, st.benutzer, st.startwert)
            .await
            .unwrap();
        let ids: Vec<i64> = liste(&st.pool, st.einsatz, pid)
            .await
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(ids, vec![zweit, erst], "neueste zuerst, entfernte nicht");
    }

    #[tokio::test]
    async fn person_linker_und_anhang_tragen_denselben_einsatz() {
        let st = setup().await;
        let (pid, _) = person(&st.pool, st.einsatz, st.benutzer, "erfasst").await;
        let (id, _) = ablage(&st, pid, "foto.jpg", "image/jpeg").await.unwrap();
        let (p, l, a): (i64, i64, i64) = sqlx::query_as(
            "SELECT p.einsatz_id, l.einsatz_id, a.einsatz_id FROM einsatz_person_anhang l \
             JOIN einsatz_person p ON p.id = l.person_id JOIN anhang a ON a.id = l.anhang_id \
             WHERE l.id = ?",
        )
        .bind(id)
        .fetch_one(&st.pool)
        .await
        .unwrap();
        assert_eq!((p, l, a), (st.einsatz, st.einsatz, st.einsatz));
    }

    #[tokio::test]
    async fn fremde_person_und_anhang_einer_anderen_person_sind_404() {
        let st = setup().await;
        let (pid, _) = person(&st.pool, st.einsatz, st.benutzer, "betroffen").await;
        let (andere, _) = person(&st.pool, st.einsatz, st.benutzer, "betroffen").await;
        let fremder_einsatz = einsatz_anlegen(&st.pool).await;
        let (fremd, _) = person(&st.pool, fremder_einsatz, st.benutzer, "betroffen").await;
        let (id, _) = ablage(&st, pid, "foto.jpg", "image/jpeg").await.unwrap();

        assert!(matches!(
            liste(&st.pool, st.einsatz, fremd).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            ablage(&st, fremd, "x.jpg", "image/jpeg").await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            laden(&st.pool, st.einsatz, andere, id).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            anhang_id_fuer_download(&st.pool, st.einsatz, andere, id)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, andere, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert!(
            laden(&st.pool, st.einsatz, pid, id).await.is_ok(),
            "unverändert"
        );
    }

    #[tokio::test]
    async fn status_der_person_sperrt_nichts() {
        let st = setup().await;
        for status in [
            "erfasst",
            "vermisst",
            "betroffen",
            "verstorben",
            "abgemeldet",
        ] {
            let (pid, _) = person(&st.pool, st.einsatz, st.benutzer, status).await;
            let (id, _) = ablage(&st, pid, "foto.jpg", "image/jpeg")
                .await
                .unwrap_or_else(|e| panic!("{status}: {e:?}"));
            entfernen(&st.pool, st.einsatz, pid, id, st.benutzer, st.startwert)
                .await
                .unwrap_or_else(|e| panic!("{status}: {e:?}"));
        }
    }

    #[tokio::test]
    async fn storniert_ist_409_ohne_jede_zeile_und_bleibt_lesbar() {
        let st = setup().await;
        let (pid, _) = person(&st.pool, st.einsatz, st.benutzer, "betroffen").await;
        let (id, _) = ablage(&st, pid, "foto.jpg", "image/jpeg").await.unwrap();
        person_repo::storniere(&st.pool, st.einsatz, pid, st.benutzer)
            .await
            .unwrap();
        let anhaenge = zaehle(&st.pool, ANHAENGE, st.einsatz).await;
        let linker = zaehle(&st.pool, LINKER, st.einsatz).await;
        let etb = zaehle(&st.pool, ETB, st.einsatz).await;

        assert!(matches!(
            ablage(&st, pid, "neu.jpg", "image/jpeg").await.unwrap_err(),
            AppError::Conflict(_)
        ));
        assert!(matches!(
            entfernen(&st.pool, st.einsatz, pid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
        assert_eq!(zaehle(&st.pool, ANHAENGE, st.einsatz).await, anhaenge);
        assert_eq!(zaehle(&st.pool, LINKER, st.einsatz).await, linker);
        assert_eq!(zaehle(&st.pool, ETB, st.einsatz).await, etb);
        // Lesen bleibt.
        assert_eq!(liste(&st.pool, st.einsatz, pid).await.unwrap().len(), 1);
        assert!(anhang_id_fuer_download(&st.pool, st.einsatz, pid, id)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn doppeltes_entfernen_ist_404_ohne_zweiten_etb_eintrag() {
        let st = setup().await;
        let (pid, nr) = person(&st.pool, st.einsatz, st.benutzer, "betroffen").await;
        let (id, _) = ablage(&st, pid, "protokoll.pdf", "application/pdf")
            .await
            .unwrap();
        let etb_id = entfernen(&st.pool, st.einsatz, pid, id, st.benutzer, st.startwert)
            .await
            .unwrap();
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(inhalt, etb_text(nr, "application/pdf", Vorgang::Entfernt));
        let etb = zaehle(&st.pool, ETB, st.einsatz).await;

        assert!(matches!(
            entfernen(&st.pool, st.einsatz, pid, id, st.benutzer, st.startwert)
                .await
                .unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(zaehle(&st.pool, ETB, st.einsatz).await, etb);
        assert!(
            anhang_id_fuer_download(&st.pool, st.einsatz, pid, id)
                .await
                .is_err(),
            "entfernt ist nicht mehr ladbar"
        );
        assert_eq!(
            zaehle(&st.pool, ANHAENGE, st.einsatz).await,
            1,
            "die Datei bleibt als Beweis bis zur Schwärzung"
        );
    }
}
