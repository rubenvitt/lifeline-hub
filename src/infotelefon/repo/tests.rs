//! Repo-Tests des Informationstelefons (LFH-554), je Spec-Szenario mindestens ein Test.

use super::*;
use crate::write_retry;
use axum::http::StatusCode;

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
    e2: i64,
}

async fn welt() -> Welt {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Telefon 1', 'tel1', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut ids = Vec::new();
    for name in ["Hochwasser", "Anderer Einsatz"] {
        ids.push(
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap(),
        );
    }
    Welt {
        pool,
        b,
        e: ids[0],
        e2: ids[1],
    }
}

fn anruf(anliegen: InfotelefonAnliegen, rueckruf: Option<&str>, noetig: bool) -> AnrufEingabe {
    AnrufEingabe {
        anliegen,
        notiz: Some("Frage nach Sperrung B 3".into()),
        anrufer_name: Some("A. Anrufer".into()),
        rueckruf: rueckruf.map(str::to_string),
        rueckruf_noetig: noetig,
        eingang_at: "2026-09-30 12:00:00".into(),
    }
}

async fn anlegen(w: &Welt, e: i64, a: AnrufEingabe) -> Result<i64, AppError> {
    write_retry!(&w.pool, |conn| { anlegen_tx(conn, e, w.b, &a).await })
}

async fn setze(w: &Welt, e: i64, id: i64, ziel: InfotelefonStatus) -> Result<(), AppError> {
    write_retry!(&w.pool, |conn| { status_tx(conn, e, id, w.b, ziel).await })
}

fn code(r: Result<impl std::fmt::Debug, AppError>) -> StatusCode {
    r.unwrap_err().status()
}

#[tokio::test]
async fn auskunft_ohne_rueckruf_ist_erledigt() {
    let w = welt().await;
    let id = anlegen(
        &w,
        w.e,
        anruf(InfotelefonAnliegen::AuskunftLage, None, false),
    )
    .await
    .unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Erledigt);
    assert_eq!(a.eingang_at, "2026-09-30 12:00:00");
    assert_eq!(a.notiz.as_deref(), Some("Frage nach Sperrung B 3"));
}

#[tokio::test]
async fn rueckruf_ohne_nummer_ist_422_und_legt_nichts_an() {
    let w = welt().await;
    for nummer in [None, Some("  ")] {
        let r = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, nummer, true)).await;
        assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
    }
    assert!(liste(&w.pool, w.e).await.unwrap().is_empty());
}

#[tokio::test]
async fn rueckruf_erledigen_und_wieder_oeffnen() {
    let w = welt().await;
    let id = anlegen(
        &w,
        w.e,
        anruf(
            InfotelefonAnliegen::Vermisstensuche,
            Some("0171 000000"),
            true,
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        laden(&w.pool, w.e, id).await.unwrap().status,
        InfotelefonStatus::Offen
    );
    setze(&w, w.e, id, InfotelefonStatus::Erledigt)
        .await
        .unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Erledigt);
    assert_eq!(a.erledigt_von_name.as_deref(), Some("Telefon 1"));
    assert!(a.erledigt_at.is_some());
    assert_eq!(
        code(setze(&w, w.e, id, InfotelefonStatus::Erledigt).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    setze(&w, w.e, id, InfotelefonStatus::Offen).await.unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Offen);
    assert_eq!(a.erledigt_at, None);
}

#[tokio::test]
async fn oeffnen_ohne_nummer_ist_422() {
    let w = welt().await;
    let id = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Sonstiges, None, false))
        .await
        .unwrap();
    assert_eq!(
        code(setze(&w, w.e, id, InfotelefonStatus::Offen).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn fremder_anruf_ist_404() {
    let w = welt().await;
    let id = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Presse, Some("1"), true))
        .await
        .unwrap();
    assert_eq!(code(laden(&w.pool, w.e2, id).await), StatusCode::NOT_FOUND);
    assert_eq!(
        code(setze(&w, w.e2, id, InfotelefonStatus::Erledigt).await),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn liste_juengste_zuerst_und_nur_eigener_einsatz() {
    let w = welt().await;
    let mut frueh = anruf(InfotelefonAnliegen::Hinweis, None, false);
    frueh.eingang_at = "2026-09-30 08:00:00".into();
    let frueh = anlegen(&w, w.e, frueh).await.unwrap();
    let spaet = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    anlegen(&w, w.e2, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    let ids: Vec<i64> = liste(&w.pool, w.e)
        .await
        .unwrap()
        .iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, vec![spaet, frueh]);
}
