//! Integrationstests „Stammdaten-Abruf“ (LLH-1194): Schnappschüsse ablegen, vorlegen und
//! übernehmen. Der Abruf übers Netz läuft hier nicht (der Zielschutz verbietet Loopback); geprüft
//! wird die zweite Phase (`schnappschuss::ablegen`) und alles danach über die Routen.

use axum::http::StatusCode;
use lifeline_hub::stammdaten_eingang::json::{fingerabdruck, lies_paket};
use lifeline_hub::stammdaten_eingang::schnappschuss::{ablegen, Anzahl};
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{anfrage_json, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

const LISTE: &str = "/api/master-data/import/snapshots";
const ZWEI: &str = r#"{"personal":[{"kennung":"h1","name":"Albers, Jana"},{"kennung":"h2","name":"Brandt, Tom"}]}"#;
const ZWEI_UMGEDREHT: &str = r#"{"personal":[{"kennung":"h2","name":"Brandt, Tom"},{"kennung":"h1","name":"Albers, Jana"}]}"#;
const DREI: &str = r#"{"personal":[{"kennung":"h1","name":"Albers, Jana"},{"kennung":"h2","name":"Brandt, Tom"},{"kennung":"h3","name":"Claßen, Uta"}]}"#;

struct U {
    app: axum::Router,
    pool: SqlitePool,
    org: i64,
    admin: String,
}

async fn umgebung() -> U {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    adapter_in(&pool, "a1", org).await;
    U {
        app,
        pool,
        org,
        admin,
    }
}

async fn adapter_in(pool: &SqlitePool, id: &str, org: i64) {
    sqlx::query(
        "INSERT INTO adapter (id, org_id, art, name, einstellungen, intervall_s) \
         VALUES (?, ?, 'stammdaten_abruf', 'Helferverwaltung', '{\"adresse\":\"https://helfer.example.org/api/stammdaten\",\"herkunft\":\"Helferverwaltung\"}', 21600)",
    )
    .bind(id)
    .bind(org)
    .execute(pool)
    .await
    .unwrap();
}

/// Die zweite Phase des Laufs für `koerper`; `true` = neuer Schnappschuss.
async fn lauf(pool: &SqlitePool, adapter: &str, org: i64, koerper: &str) -> bool {
    let (paket, _, _) = lies_paket(koerper.as_bytes()).unwrap();
    let mut conn = pool.acquire().await.unwrap();
    ablegen(
        &mut conn,
        adapter,
        org,
        koerper,
        &fingerabdruck(&paket),
        &Anzahl::von(&paket),
        "2026-11-25 08:00:00",
    )
    .await
    .unwrap()
}

async fn offene(u: &U) -> Vec<Value> {
    let (s, v) = anfrage_json(&u.app, "GET", LISTE, &u.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["schnappschuesse"].as_array().unwrap().clone()
}

async fn status(pool: &SqlitePool) -> Vec<(String, bool)> {
    sqlx::query_as("SELECT status, inhalt IS NOT NULL FROM stammdaten_schnappschuss ORDER BY rowid")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn gleicher_stand_in_anderer_reihenfolge_legt_nichts_neu_an() {
    let u = umgebung().await;
    assert!(lauf(&u.pool, "a1", u.org, ZWEI).await);
    assert!(!lauf(&u.pool, "a1", u.org, ZWEI_UMGEDREHT).await);
    let liste = offene(&u).await;
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["herkunft"], "Helferverwaltung");
    assert_eq!(liste[0]["adapter_name"], "Helferverwaltung");
    assert_eq!(liste[0]["anzahl"]["personal"], 2);
    assert!(liste[0].get("inhalt").is_none(), "Liste ohne Inhalt");
}

#[tokio::test]
async fn neuer_stand_ersetzt_den_offenen_und_leert_ihn() {
    let u = umgebung().await;
    assert!(lauf(&u.pool, "a1", u.org, ZWEI).await);
    let alt = offene(&u).await[0]["id"].as_str().unwrap().to_string();
    assert!(lauf(&u.pool, "a1", u.org, DREI).await);
    assert_eq!(
        status(&u.pool).await,
        vec![("ersetzt".into(), false), ("offen".into(), true)]
    );
    let (s, _) = anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{alt}"),
        &u.admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "ersetzter Schnappschuss");
    let personen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal WHERE org_id = ?")
        .bind(u.org)
        .fetch_one(&u.pool)
        .await
        .unwrap();
    assert_eq!(personen, 0, "409 schreibt nichts");
}

#[tokio::test]
async fn vorschau_schreibt_nichts_uebernehmen_legt_an_und_leert() {
    let u = umgebung().await;
    lauf(&u.pool, "a1", u.org, ZWEI).await;
    let id = offene(&u).await[0]["id"].as_str().unwrap().to_string();

    let (s, v) = anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}/preview"),
        &u.admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zaehle = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM personal WHERE org_id = ?")
            .bind(u.org)
            .fetch_one(&u.pool)
            .await
            .unwrap()
    };
    assert_eq!(zaehle().await, 0);

    let (s, v) = anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}"),
        &u.admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zaehle().await, 2);
    assert_eq!(status(&u.pool).await, vec![("uebernommen".into(), false)]);
    assert!(offene(&u).await.is_empty());

    // Herkunft aus der Adapter-Einstellung, Kennung gemerkt: der nächste gleiche Abruf ruht.
    let herkunft: String = sqlx::query_scalar(
        "SELECT DISTINCT herkunft FROM stammdaten_kennung WHERE personal_id IS NOT NULL",
    )
    .fetch_one(&u.pool)
    .await
    .unwrap();
    assert_eq!(herkunft, "helferverwaltung");
    assert!(!lauf(&u.pool, "a1", u.org, ZWEI).await);
}

#[tokio::test]
async fn erneut_vorlegen_erzwingt_einen_schnappschuss() {
    let u = umgebung().await;
    lauf(&u.pool, "a1", u.org, ZWEI).await;
    let id = offene(&u).await[0]["id"].as_str().unwrap().to_string();
    let (s, _) = anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}"),
        &u.admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(!lauf(&u.pool, "a1", u.org, ZWEI).await);

    let (s, _) = anfrage_json(
        &u.app,
        "POST",
        "/api/admin/adapter/a1/resubmit",
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(lauf(&u.pool, "a1", u.org, ZWEI).await);
    let erzwingen: i64 =
        sqlx::query_scalar("SELECT vorlegen_erzwingen FROM adapter WHERE id = 'a1'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    assert_eq!(erzwingen, 0, "Markierung nach dem Schnappschuss gelöscht");
}

#[tokio::test]
async fn fremde_org_und_ohne_adminrecht() {
    let u = umgebung().await;
    let (fremde_org, _) =
        fremde_org_anlegen(&u.pool, "Fremde Orga", "fremdadmin", "fremdpw123", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE org_id = ?")
        .bind(fremde_org)
        .execute(&u.pool)
        .await
        .unwrap();
    let fremd = login_cookie(&u.app, "fremdadmin", "fremdpw123").await;
    lauf(&u.pool, "a1", u.org, ZWEI).await;
    let id = offene(&u).await[0]["id"].as_str().unwrap().to_string();

    let (s, v) = anfrage_json(&u.app, "GET", LISTE, &fremd, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["schnappschuesse"], json!([]));
    let (s, _) = anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}/preview"),
        &fremd,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage_json(
        &u.app,
        "POST",
        "/api/admin/adapter/a1/resubmit",
        &fremd,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    benutzer_anlegen(&u.app, &u.admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&u.app, "fuehrung", "fuehrungpw1").await;
    let (s, _) = anfrage_json(&u.app, "GET", LISTE, &fk, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn erledigte_schnappschuesse_nach_90_tagen_aufgeraeumt_der_juengste_uebernommene_bleibt() {
    let u = umgebung().await;
    for (id, status, erledigt) in [
        ("alt-ersetzt", "ersetzt", "2026-08-01 00:00:00"),
        ("alt-uebernommen", "uebernommen", "2026-08-02 00:00:00"),
        (
            "juengster-uebernommen",
            "uebernommen",
            "2026-08-03 00:00:00",
        ),
        ("frisch-ersetzt", "ersetzt", "2026-11-20 00:00:00"),
    ] {
        sqlx::query(
            "INSERT INTO stammdaten_schnappschuss (id, org_id, adapter_id, status, fingerabdruck, anzahl, abgerufen_at, erledigt_at) \
             VALUES (?, ?, 'a1', ?, ?, '{}', ?, ?)",
        )
        .bind(id)
        .bind(u.org)
        .bind(status)
        .bind(id)
        .bind(erledigt)
        .bind(erledigt)
        .execute(&u.pool)
        .await
        .unwrap();
    }
    assert!(lauf(&u.pool, "a1", u.org, ZWEI).await);
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM stammdaten_schnappschuss WHERE status <> 'offen' ORDER BY id",
    )
    .fetch_all(&u.pool)
    .await
    .unwrap();
    assert_eq!(
        ids,
        vec![
            "frisch-ersetzt".to_string(),
            "juengster-uebernommen".to_string()
        ]
    );
}
