use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (app, pool)
}

// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_fuenf_aktive_bausteine() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 5);
    assert_eq!(json[0]["label"], "Lage unverändert");
    assert_eq!(json[0]["typ"], "lage");
}

#[tokio::test]
async fn admin_crud_und_typ_validierung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(&app, "GET", "/api/etb-bausteine", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &erika,
            Some(r#"{"typ":"meldung","label":"X","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"system","label":"S","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"berichtigung","label":"B","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"M","inhalt":"x","meldeweg":"brieftaube"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"   ","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    let (status, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Räumung {abschnitt} anordnen.","meldeweg":"funk","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["label"], "Räumung anordnen");
    assert_eq!(json["meldeweg"], "funk");
    let id = json["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "PATCH", &format!("/api/etb-bausteine/{id}"), &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Sofort räumen.","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["inhalt"], "Sofort räumen.");
    // LFH-306: früher leerte ein PATCH ohne `meldeweg` das Feld (Vollersatz). Jetzt ist
    // „nicht gesendet" kein Wunsch — das Feld bleibt stehen; geleert wird nur mit `null`.
    assert_eq!(
        json["meldeweg"], "funk",
        "PATCH ohne meldeweg lässt das Feld stehen (Teil-Patch)"
    );

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/etb-bausteine/9999",
            &admin,
            Some(r#"{"typ":"meldung","label":"Z","inhalt":"z"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn label_konflikt_auch_gegen_deaktivierten_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/etb-bausteine",
        &admin,
        Some(r#"{"typ":"lage","label":"Eigenlabel","inhalt":"a"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"b"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/etb-bausteine/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert!(!liste
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["label"] == "Eigenlabel"));

    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"c"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn org_isolation_liste_trennt_orgs() {
    use lifeline_hub::etb_baustein::repo::{self, BausteinDaten};
    let (_app, pool) = setup_mit_pool().await;

    let org_a: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let org_b: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Org B') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();

    repo::anlegen(
        &pool,
        org_b,
        BausteinDaten {
            label: "Nur-B",
            typ: "meldung",
            inhalt: "b",
            meldeweg: None,
            veranlassung: None,
            sortier: 1,
        },
    )
    .await
    .unwrap();

    let liste_a = repo::liste(&pool, org_a).await.unwrap();
    assert!(!liste_a.iter().any(|b| b.label == "Nur-B"));
    let liste_b = repo::liste(&pool, org_b).await.unwrap();
    assert!(liste_b.iter().any(|b| b.label == "Nur-B"));

    let b_id = liste_b.iter().find(|b| b.label == "Nur-B").unwrap().id;
    assert!(matches!(
        repo::laden(&pool, org_a, b_id).await,
        Err(lifeline_hub::error::AppError::NotFound)
    ));
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt einen Baustein mit ALLEN Feldern gesetzt an und liefert seine id.
async fn baustein_voll(app: &axum::Router, admin: &str, label: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/etb-bausteine",
        admin,
        Some(&format!(
            r#"{{"typ":"meldung","label":"{label}","inhalt":"Erstmeldung {{abschnitt}}.",
                 "meldeweg":"funk","veranlassung":"Lagemeldung","sortier":55}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test.** Zusammen mit `patch_meldeweg_null_loescht_meldeweg` bildet
/// er das Paar, das den Tri-State beweist: HIER ist `meldeweg` nicht im Body und muss stehen
/// bleiben, DORT steht `null` im Body und muss löschen. Unter dem alten Vollersatz war beides
/// ununterscheidbar — das fehlende Feld nullte die Spalte.
///
/// Der Body ist bewusst **unter HEAD gültig** (`typ`/`label`/`inhalt`/`sortier` alle da, nur
/// die nullable Felder fehlen): so schlägt der Test gegen HEAD mit dem echten Datenverlust
/// fehl (200 + `meldeweg`/`veranlassung` auf `null`) statt am Extractor — ein 400 wäre ein
/// Fehlschlag aus dem falschen Grund.
#[tokio::test]
async fn patch_ohne_meldeweg_laesst_meldeweg_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/etb-bausteine/{id}"),
        &admin,
        Some(r#"{"typ":"meldung","label":"Erstmeldung","inhalt":"Neue Fassung.","sortier":55}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["inhalt"], "Neue Fassung.");
    assert_eq!(json["meldeweg"], "funk", "nicht gesendetes Feld bleibt");
    assert_eq!(
        json["veranlassung"], "Lagemeldung",
        "nicht gesendetes Feld bleibt"
    );
    assert_eq!(json["label"], "Erstmeldung", "nicht gesendetes Feld bleibt");
    assert_eq!(json["typ"], "meldung", "nicht gesendetes Feld bleibt");
}

#[tokio::test]
async fn patch_meldeweg_null_loescht_meldeweg() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/etb-bausteine/{id}"),
        &admin,
        Some(r#"{"meldeweg":null,"veranlassung":""}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json["meldeweg"].is_null(), "explizites null leert");
    assert!(json["veranlassung"].is_null(), "\"\" leert ebenfalls");
    assert_eq!(json["label"], "Erstmeldung", "Nachbarfeld unberührt");
}

/// Der schärfste Test gegen HEAD: `sortier` ist NOT NULL und trug am alten Body ein
/// `#[serde(default)]` — ein PATCH ohne `sortier` setzte die Spalte still auf 0.
///
/// Der Body ist bewusst **unter HEAD gültig** (alle Pflichtfelder da, nur `sortier` fehlt):
/// nur so schlägt der Test gegen HEAD mit dem echten Datenverlust fehl (200 + `sortier: 0`)
/// statt am Extractor — ein 400 wäre ein Fehlschlag aus dem falschen Grund.
#[tokio::test]
async fn patch_ohne_sortier_laesst_sortier_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/etb-bausteine/{id}"),
        &admin,
        Some(
            r#"{"typ":"meldung","label":"Umbenannt","inhalt":"Erstmeldung.",
                "meldeweg":"funk","veranlassung":"Lagemeldung"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["label"], "Umbenannt");
    assert_eq!(json["sortier"], 55, "nicht gesendetes sortier bleibt");
}

/// Belegt, dass die Enum-Prüfung NUR auf dem gesendeten Feld läuft und nicht auf den
/// Absent-Zweig durchschlägt: mit `meldeweg` im Body → 400, ohne → 200.
#[tokio::test]
async fn patch_meldeweg_ungueltig_ist_400_nur_bei_vorhandenem_feld() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/etb-bausteine/{id}"),
            &admin,
            Some(r#"{"meldeweg":"brieftaube"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Gleicher Patch ohne das Feld — die Prüfung darf hier nicht greifen.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/etb-bausteine/{id}"),
            &admin,
            Some(r#"{"inhalt":"ok"}"#)
        )
        .await
        .0,
        StatusCode::OK
    );
    // Auch der Leerwunsch hat keinen Wert zu validieren.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/etb-bausteine/{id}"),
            &admin,
            Some(r#"{"meldeweg":null}"#)
        )
        .await
        .0,
        StatusCode::OK
    );
}

/// „vorhanden aber leer" ist 400 (LFH-305-Konvention), absent geht durch — für `label`,
/// `inhalt` und den unbekannten `typ`.
#[tokio::test]
async fn patch_leere_pflichtfelder_sind_400_absente_gehen_durch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;
    let u = format!("/api/etb-bausteine/{id}");

    for body in [
        r#"{"label":"   "}"#,
        r#"{"inhalt":""}"#,
        r#"{"typ":"system"}"#,
        r#"{"typ":"quatsch"}"#,
    ] {
        assert_eq!(
            anfrage(&app, "PATCH", &u, &admin, Some(body)).await.0,
            StatusCode::BAD_REQUEST,
            "Body: {body}"
        );
    }
    // Leerer Patch: kein Pflichtfeld gesendet → nichts zu beanstanden.
    assert_eq!(
        anfrage(&app, "PATCH", &u, &admin, Some("{}")).await.0,
        StatusCode::OK
    );
}

/// Bind-Reihenfolge der Flag/Wert-Kette (`src/etb_baustein/repo.rs` hat kein co-lokiertes
/// Testmodul, deshalb steht der Test hier): alle sechs Spalten in EINEM Patch auf distinkte
/// Werte setzen und einzeln prüfen. Eine um eine Position verschobene Kette würde
/// gleichtypige Nachbarspalten (`label`↔`typ`↔`inhalt`) STILL vertauschen.
#[tokio::test]
async fn patche_setzt_jede_spalte_an_ihren_platz() {
    use lifeline_hub::etb::{EtbTyp, MeldeWeg};
    use lifeline_hub::etb_baustein::repo::{self, BausteinPatch};
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;
    let org: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let neu = repo::patche(
        &pool,
        org,
        id,
        BausteinPatch {
            label: Some("Neu-Label"),
            typ: Some("anordnung"),
            inhalt: Some("Neu-Inhalt"),
            meldeweg: Some(Some("telefon")),
            veranlassung: Some(Some("Neu-Veranlassung")),
            sortier: Some(42),
        },
    )
    .await
    .unwrap();
    assert_eq!(neu.label, "Neu-Label");
    assert_eq!(neu.typ, EtbTyp::Anordnung);
    assert_eq!(neu.inhalt, "Neu-Inhalt");
    assert_eq!(neu.meldeweg, Some(MeldeWeg::Telefon));
    assert_eq!(neu.veranlassung.as_deref(), Some("Neu-Veranlassung"));
    assert_eq!(neu.sortier, 42);

    // Und der Default-Patch fasst nichts an.
    let unveraendert = repo::patche(&pool, org, id, BausteinPatch::default())
        .await
        .unwrap();
    assert_eq!(unveraendert.label, "Neu-Label");
    assert_eq!(unveraendert.typ, EtbTyp::Anordnung);
    assert_eq!(unveraendert.inhalt, "Neu-Inhalt");
    assert_eq!(unveraendert.meldeweg, Some(MeldeWeg::Telefon));
    assert_eq!(unveraendert.sortier, 42);
}

/// Der Org-Scope des Teil-Patches: fremde Org trifft die Zeile nicht → `NotFound`.
#[tokio::test]
async fn patche_fremde_org_ist_notfound() {
    use lifeline_hub::etb_baustein::repo::{self, BausteinPatch};
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = baustein_voll(&app, &admin, "Erstmeldung").await;
    let fremd: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Org B') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(matches!(
        repo::patche(
            &pool,
            fremd,
            id,
            BausteinPatch {
                label: Some("fremd"),
                ..Default::default()
            }
        )
        .await,
        Err(lifeline_hub::error::AppError::NotFound)
    ));
}
