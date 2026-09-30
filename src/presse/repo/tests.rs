//! Repo-Tests des Presse-Logs (LFH-554), je Spec-Szenario mindestens ein Test. Die
//! Schreibpfade laufen wie in der Route in `write_retry!`.

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
         VALUES (1, 'Pressestelle', 'presse', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let e = einsatz(&pool, "Hochwasser").await;
    let e2 = einsatz(&pool, "Anderer Einsatz").await;
    Welt { pool, b, e, e2 }
}

async fn einsatz(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn eingabe(art: MedienkontaktArt) -> KontaktEingabe {
    KontaktEingabe {
        art,
        medium: "NDR 1 Niedersachsen".into(),
        thema: "Zahl der Evakuierten".into(),
        kontakt_name: Some("M. Beispiel".into()),
        kontakt_erreichbarkeit: Some("+49 511 000000".into()),
        eingang_at: "2026-09-30 12:00:00".into(),
    }
}

fn wechsel(ziel: MedienkontaktStatus, antwort: Option<&str>) -> StatusWechsel {
    StatusWechsel {
        ziel,
        antwort: antwort.map(str::to_string),
        freigabe_durch: None,
        pressemitteilung_id: None,
    }
}

async fn anlegen(w: &Welt, e: i64, k: KontaktEingabe) -> Result<i64, AppError> {
    write_retry!(&w.pool, |conn| { anlegen_tx(conn, e, w.b, &k).await })
}

async fn status(w: &Welt, e: i64, id: i64, s: StatusWechsel) -> Result<(), AppError> {
    write_retry!(&w.pool, |conn| { status_tx(conn, e, id, w.b, &s).await })
}

fn code(r: Result<impl std::fmt::Debug, AppError>) -> StatusCode {
    r.unwrap_err().status()
}

async fn mitteilung(w: &Welt, e: i64, status: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO pressemitteilung (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, \
            ersteller_id) VALUES (?, 'freitext', 'PM', '2026-09-30 12:00:00', ?, '[]', ?) \
         RETURNING id",
    )
    .bind(e)
    .bind(status)
    .bind(w.b)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn anfrage_erfassen_beginnt_offen() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let k = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(k.status, MedienkontaktStatus::Offen);
    assert_eq!(k.medium, "NDR 1 Niedersachsen");
    assert_eq!(k.kontakt_name.as_deref(), Some("M. Beispiel"));
    assert_eq!(k.eingang_at, "2026-09-30 12:00:00");
}

#[tokio::test]
async fn leeres_thema_oder_medium_ist_400() {
    let w = welt().await;
    let mut k = eingabe(MedienkontaktArt::Anfrage);
    k.thema = "   ".into();
    assert_eq!(code(anlegen(&w, w.e, k).await), StatusCode::BAD_REQUEST);
    let mut k = eingabe(MedienkontaktArt::Anfrage);
    k.medium = String::new();
    assert_eq!(code(anlegen(&w, w.e, k).await), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anfrage_beantworten_mit_freigabeangabe() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let mut s = wechsel(
        MedienkontaktStatus::Beantwortet,
        Some("Derzeit 240 Personen in der Notunterkunft"),
    );
    s.freigabe_durch = Some("EL".into());
    status(&w, w.e, id, s).await.unwrap();
    let k = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(k.status, MedienkontaktStatus::Beantwortet);
    assert_eq!(
        k.antwort.as_deref(),
        Some("Derzeit 240 Personen in der Notunterkunft")
    );
    assert_eq!(k.freigabe_durch.as_deref(), Some("EL"));
    assert_eq!(k.bearbeitet_von_id, Some(w.b));
    assert_eq!(k.bearbeitet_von_name.as_deref(), Some("Pressestelle"));
    assert!(k.bearbeitet_at.is_some());
}

#[tokio::test]
async fn beantworten_ohne_antwort_ist_422_und_bleibt_offen() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    for leer in [None, Some("  ")] {
        let r = status(&w, w.e, id, wechsel(MedienkontaktStatus::Beantwortet, leer)).await;
        assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let k = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(k.status, MedienkontaktStatus::Offen);
}

#[tokio::test]
async fn ziel_muss_zur_art_passen() {
    let w = welt().await;
    let termin = anlegen(&w, w.e, eingabe(MedienkontaktArt::Termin))
        .await
        .unwrap();
    let r = status(
        &w,
        w.e,
        termin,
        wechsel(MedienkontaktStatus::Beantwortet, Some("x")),
    )
    .await;
    assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
    let anfrage = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let r = status(
        &w,
        w.e,
        anfrage,
        wechsel(MedienkontaktStatus::Erledigt, None),
    )
    .await;
    assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
    // Gegenprobe: der passende Übergang gelingt.
    status(
        &w,
        w.e,
        termin,
        wechsel(MedienkontaktStatus::Erledigt, None),
    )
    .await
    .unwrap();
    status(
        &w,
        w.e,
        anfrage,
        wechsel(MedienkontaktStatus::Abgelehnt, None),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn ruecknahme_laesst_die_antwort_stehen() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    status(
        &w,
        w.e,
        id,
        wechsel(MedienkontaktStatus::Beantwortet, Some("240 Personen")),
    )
    .await
    .unwrap();
    status(&w, w.e, id, wechsel(MedienkontaktStatus::Offen, None))
        .await
        .unwrap();
    let k = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(k.status, MedienkontaktStatus::Offen);
    assert_eq!(k.antwort.as_deref(), Some("240 Personen"));
    // Von einem Zielstatus direkt in einen anderen geht es nicht, nur über `offen`.
    status(&w, w.e, id, wechsel(MedienkontaktStatus::Abgelehnt, None))
        .await
        .unwrap();
    let r = status(
        &w,
        w.e,
        id,
        wechsel(MedienkontaktStatus::Beantwortet, Some("neu")),
    )
    .await;
    assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn bezug_nur_auf_freigegebene_mitteilung_des_einsatzes() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let entwurf = mitteilung(&w, w.e, "entwurf").await;
    let fremd = mitteilung(&w, w.e2, "freigegeben").await;
    let eigen = mitteilung(&w, w.e, "freigegeben").await;
    for pm in [entwurf, fremd] {
        let mut s = wechsel(MedienkontaktStatus::Beantwortet, Some("siehe PM"));
        s.pressemitteilung_id = Some(pm);
        assert_eq!(
            code(status(&w, w.e, id, s).await),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut s = wechsel(MedienkontaktStatus::Beantwortet, Some("siehe PM"));
    s.pressemitteilung_id = Some(eigen);
    status(&w, w.e, id, s).await.unwrap();
    assert_eq!(
        laden(&w.pool, w.e, id).await.unwrap().pressemitteilung_id,
        Some(eigen)
    );
}

#[tokio::test]
async fn fremder_kontakt_ist_404() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    assert_eq!(code(laden(&w.pool, w.e2, id).await), StatusCode::NOT_FOUND);
    let r = status(&w, w.e2, id, wechsel(MedienkontaktStatus::Abgelehnt, None)).await;
    assert_eq!(code(r), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn liste_zeigt_offene_zuerst_dann_juengste() {
    let w = welt().await;
    let mut alt = eingabe(MedienkontaktArt::Anfrage);
    alt.eingang_at = "2026-09-30 08:00:00".into();
    let alt = anlegen(&w, w.e, alt).await.unwrap();
    let mut neu = eingabe(MedienkontaktArt::Termin);
    neu.eingang_at = "2026-09-30 10:00:00".into();
    let neu = anlegen(&w, w.e, neu).await.unwrap();
    let mut erledigt = eingabe(MedienkontaktArt::Abstimmung);
    erledigt.eingang_at = "2026-09-30 11:00:00".into();
    let erledigt = anlegen(&w, w.e, erledigt).await.unwrap();
    status(
        &w,
        w.e,
        erledigt,
        wechsel(MedienkontaktStatus::Erledigt, None),
    )
    .await
    .unwrap();
    anlegen(&w, w.e2, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let ids: Vec<i64> = liste(&w.pool, w.e)
        .await
        .unwrap()
        .iter()
        .map(|k| k.id)
        .collect();
    assert_eq!(ids, vec![neu, alt, erledigt]);
}

#[tokio::test]
async fn aendern_leert_kontaktangaben_und_prueft_pflicht() {
    let w = welt().await;
    let id = anlegen(&w, w.e, eingabe(MedienkontaktArt::Anfrage))
        .await
        .unwrap();
    let a = KontaktAenderung {
        thema: Some("Sperrung B 3".into()),
        kontakt_name: Some(None),
        ..KontaktAenderung::default()
    };
    write_retry!(&w.pool, |conn| { aendern_tx(conn, w.e, id, &a).await }).unwrap();
    let k = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(k.thema, "Sperrung B 3");
    assert_eq!(k.kontakt_name, None);
    assert_eq!(k.kontakt_erreichbarkeit.as_deref(), Some("+49 511 000000"));
    let leer = KontaktAenderung {
        medium: Some(" ".into()),
        ..KontaktAenderung::default()
    };
    let r = write_retry!(&w.pool, |conn| { aendern_tx(conn, w.e, id, &leer).await });
    assert_eq!(code(r), StatusCode::BAD_REQUEST);
}

/// Die Nachtrag-Anweisung aus `0129_presse.sql`: ein offener Lagevortrag-Entwurf von vor der
/// Vorlagenerweiterung bekommt „Medienlage“ leer nachgetragen und lässt sich wieder freigeben;
/// ein freigegebener Bericht und ein Entwurf, der den Abschnitt schon trägt, bleiben unberührt.
#[tokio::test]
async fn migration_traegt_medienlage_in_offene_entwuerfe_nach() {
    let w = welt().await;
    let alt =
        r#"[{"schluessel":"auftrag","text":"A"},{"schluessel":"zusammenfassung","text":"Z"}]"#;
    let mit = r#"[{"schluessel":"medienlage","text":"M"}]"#;
    let mut ids = Vec::new();
    for (status, abschnitte) in [("entwurf", alt), ("freigegeben", alt), ("entwurf", mit)] {
        ids.push(
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO lagebericht (einsatz_id, vorlage, titel, zeitstand, status, \
                    abschnitte, ersteller_id) \
                 VALUES (?, 'lagebericht', 'Lage', '2026-09-30 12:00:00', ?, ?, ?) RETURNING id",
            )
            .bind(w.e)
            .bind(status)
            .bind(abschnitte)
            .bind(w.b)
            .fetch_one(&w.pool)
            .await
            .unwrap(),
        );
    }
    let migration = include_str!("../../../migrations/0129_presse.sql");
    let update = &migration[migration.find("UPDATE lagebericht").unwrap()..];
    sqlx::raw_sql(sqlx::AssertSqlSafe(update))
        .execute(&w.pool)
        .await
        .unwrap();

    let schluessel = |id: i64| {
        let pool = w.pool.clone();
        async move {
            sqlx::query_scalar::<_, String>(
                "SELECT json_extract(value, '$.schluessel') || '=' || json_extract(value, '$.text') \
                 FROM lagebericht, json_each(lagebericht.abschnitte) WHERE lagebericht.id = ?",
            )
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(
        schluessel(ids[0]).await,
        ["auftrag=A", "zusammenfassung=Z", "medienlage="]
    );
    assert_eq!(schluessel(ids[1]).await, ["auftrag=A", "zusammenfassung=Z"]);
    assert_eq!(schluessel(ids[2]).await, ["medienlage=M"]);
}
