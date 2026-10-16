//! Repo-Tests des Verpflegungsplans (LLH-1058, tasks.md 2.2): je Regel mindestens ein Test.
//! Feldfehler (400) prüft die Route, hier geht es um 404, 409, 422 und die Ordnung.

use super::*;
use axum::http::StatusCode;

async fn org(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO organisation (name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn u(s: &str) -> Uhrzeit {
    Uhrzeit::parse("uhrzeit", s).unwrap()
}

fn neu(bezeichnung: &str, beginn: &str, ende: &str) -> NewVorlage {
    NewVorlage {
        bezeichnung: bezeichnung.into(),
        beginn: u(beginn),
        ende: u(ende),
        verpflegungsart: None,
    }
}

fn status<T: std::fmt::Debug>(r: Result<T, AppError>) -> StatusCode {
    r.unwrap_err().status()
}

fn namen(liste: &[VerpflegungVorlage]) -> Vec<&str> {
    liste.iter().map(|v| v.bezeichnung.as_str()).collect()
}

#[tokio::test]
async fn anlegen_liefert_die_mahlzeit_mit_hh_mm() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    let v = create(
        &pool,
        o,
        &NewVorlage {
            verpflegungsart: Some(Verpflegungsart::Warm),
            ..neu("Frühstück", "0630", "08:00")
        },
    )
    .await
    .unwrap();
    assert_eq!(v.bezeichnung, "Frühstück");
    assert_eq!((v.beginn.as_str(), v.ende.as_str()), ("06:30", "08:00"));
    assert!(!v.folgetag);
    assert!(v.aktiv);
    assert_eq!(v.verpflegungsart, Some(Verpflegungsart::Warm));
}

#[tokio::test]
async fn nachtverpflegung_ueber_mitternacht_endet_am_folgetag() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    let v = create(&pool, o, &neu("Nachtverpflegung", "23:00", "01:00"))
        .await
        .unwrap();
    assert!(v.folgetag, "{v:?}");
    assert_eq!((v.beginn.as_str(), v.ende.as_str()), ("23:00", "01:00"));
}

#[tokio::test]
async fn ende_gleich_beginn_ist_422_beim_anlegen_und_im_effektivzustand() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    assert_eq!(
        status(create(&pool, o, &neu("Mittag", "12:00", "12:00")).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(
        list(&pool, o, false).await.unwrap().is_empty(),
        "nichts angelegt"
    );

    let v = create(&pool, o, &neu("Mittag", "12:00", "13:30"))
        .await
        .unwrap();
    // Nur das Ende geändert, aber auf den bestehenden Beginn: der Effektivzustand zählt.
    let r = update(
        &pool,
        o,
        v.id,
        &VorlagePatch {
            ende: Some(u("12:00")),
            ..VorlagePatch::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::UNPROCESSABLE_ENTITY);
    let r = update(
        &pool,
        o,
        v.id,
        &VorlagePatch {
            beginn: Some(u("13:30")),
            ..VorlagePatch::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::UNPROCESSABLE_ENTITY);
    let nachher = list(&pool, o, true).await.unwrap();
    assert_eq!(
        (nachher[0].beginn.as_str(), nachher[0].ende.as_str()),
        ("12:00", "13:30"),
        "422 ändert nichts"
    );
}

#[tokio::test]
async fn gleicher_name_ohne_gross_und_kleinschreibung_ist_409() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    create(&pool, o, &neu("Mittag", "12:00", "13:30"))
        .await
        .unwrap();
    create(&pool, o, &neu("Frühstück", "06:30", "08:00"))
        .await
        .unwrap();
    for name in ["MITTAG", "mittag", "Mittag", "FRÜHSTÜCK", "frühstück"] {
        assert_eq!(
            status(create(&pool, o, &neu(name, "18:00", "19:00")).await),
            StatusCode::CONFLICT,
            "{name}"
        );
    }
    // Umbenennen auf einen vergebenen Namen ebenso.
    let abend = create(&pool, o, &neu("Abendessen", "18:00", "19:30"))
        .await
        .unwrap();
    let r = update(
        &pool,
        o,
        abend.id,
        &VorlagePatch {
            bezeichnung: Some("MITTAG".into()),
            ..VorlagePatch::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::CONFLICT);
    // Der eigene Name in anderer Schreibweise ist kein Konflikt.
    let v = update(
        &pool,
        o,
        abend.id,
        &VorlagePatch {
            bezeichnung: Some("ABENDESSEN".into()),
            ..VorlagePatch::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(v.bezeichnung, "ABENDESSEN");
}

#[tokio::test]
async fn gleicher_name_in_anderer_org_ist_frei() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    create(&pool, a, &neu("Mittag", "12:00", "13:30"))
        .await
        .unwrap();
    create(&pool, b, &neu("Mittag", "12:00", "13:30"))
        .await
        .unwrap();
}

#[tokio::test]
async fn deaktivieren_gibt_den_namen_frei_reaktivieren_prueft_ihn() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    let alt = create(&pool, o, &neu("Nachtverpflegung", "23:00", "01:00"))
        .await
        .unwrap();
    let aus = update(
        &pool,
        o,
        alt.id,
        &VorlagePatch {
            aktiv: Some(false),
            ..VorlagePatch::default()
        },
    )
    .await
    .unwrap();
    assert!(!aus.aktiv);
    assert!(list(&pool, o, true).await.unwrap().is_empty());
    let alle = list(&pool, o, false).await.unwrap();
    assert_eq!(namen(&alle), ["Nachtverpflegung"]);
    assert!(!alle[0].aktiv);

    create(&pool, o, &neu("NACHTVERPFLEGUNG", "22:30", "00:30"))
        .await
        .expect("deaktivierter Name ist wieder frei");
    let r = update(
        &pool,
        o,
        alt.id,
        &VorlagePatch {
            aktiv: Some(true),
            ..VorlagePatch::default()
        },
    )
    .await;
    assert_eq!(
        status(r),
        StatusCode::CONFLICT,
        "Reaktivieren gegen gleichnamige aktive"
    );
    // Ordnung nach Beginn: die neue (22:30) vor der alten (23:00), die aus bleibt.
    let alle = list(&pool, o, false).await.unwrap();
    assert_eq!(namen(&alle), ["NACHTVERPFLEGUNG", "Nachtverpflegung"]);
    assert!(alle[0].aktiv && !alle[1].aktiv, "{alle:?}");
    // Eine deaktivierte darf umbenannt werden, auch auf einen aktiven Namen (sie bleibt aus).
    update(
        &pool,
        o,
        alt.id,
        &VorlagePatch {
            bezeichnung: Some("Nachtverpflegung".into()),
            ..VorlagePatch::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn fremde_oder_unbekannte_mahlzeit_ist_404() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let v = create(&pool, a, &neu("Mittag", "12:00", "13:30"))
        .await
        .unwrap();
    let patch = VorlagePatch {
        bezeichnung: Some("fremd".into()),
        ..VorlagePatch::default()
    };
    assert_eq!(
        status(update(&pool, b, v.id, &patch).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(update(&pool, a, v.id + 100, &patch).await),
        StatusCode::NOT_FOUND
    );
    assert!(list(&pool, b, false).await.unwrap().is_empty());
    assert_eq!(list(&pool, a, true).await.unwrap()[0].bezeichnung, "Mittag");
}

#[tokio::test]
async fn liste_nach_beginn_dann_bezeichnung() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    for (name, beginn, ende) in [
        ("Nachtverpflegung", "23:00", "01:00"),
        ("Mittag", "12:00", "13:30"),
        ("Kaffee", "06:30", "07:00"),
        ("Frühstück", "06:30", "08:00"),
        ("Abendessen", "18:00", "19:30"),
    ] {
        create(&pool, o, &neu(name, beginn, ende)).await.unwrap();
    }
    assert_eq!(
        namen(&list(&pool, o, true).await.unwrap()),
        [
            "Frühstück",
            "Kaffee",
            "Mittag",
            "Abendessen",
            "Nachtverpflegung"
        ]
    );
}

#[tokio::test]
async fn teilaenderung_laesst_den_rest_und_leert_die_art() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "Orga").await;
    let v = create(
        &pool,
        o,
        &NewVorlage {
            verpflegungsart: Some(Verpflegungsart::Kalt),
            ..neu("Mittag", "12:00", "13:30")
        },
    )
    .await
    .unwrap();
    let v = update(
        &pool,
        o,
        v.id,
        &VorlagePatch {
            beginn: Some(u("11:30")),
            ..VorlagePatch::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        (v.bezeichnung.as_str(), v.beginn.as_str(), v.ende.as_str()),
        ("Mittag", "11:30", "13:30")
    );
    assert_eq!(v.verpflegungsart, Some(Verpflegungsart::Kalt));
    let v = update(
        &pool,
        o,
        v.id,
        &VorlagePatch {
            verpflegungsart: Some(None),
            ende: Some(u("01:00")),
            ..VorlagePatch::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(v.verpflegungsart, None);
    assert!(v.folgetag);
}
