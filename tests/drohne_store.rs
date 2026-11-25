//! Zuschaltung einer Drohnenquelle je Einsatz (LLH-2105, Migration `adapter_einsatz`): die DB ist
//! die Quelle der Wahrheit, `drohne::Store` nur ihr Abbild im Arbeitsspeicher.

use lifeline_hub::drohne::repo::{self, Zuschaltung};
use lifeline_hub::drohne::store::{Stand, Store};
use lifeline_hub::drohne::suchlage::Upstream;
use lifeline_hub::drohne::vertrag::DrohnenLage;
use sqlx::SqlitePool;

mod common;
use common::{einsatz_anlegen_mit, login_cookie};

struct Umgebung {
    pool: SqlitePool,
    org_id: i64,
    einsatz: i64,
    app: axum::Router,
    cookie: String,
}

async fn umgebung() -> Umgebung {
    let (app, pool) = common::setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &cookie, "Lage A").await;
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    Umgebung {
        pool,
        org_id,
        einsatz,
        app,
        cookie,
    }
}

impl Umgebung {
    async fn adapter(&self, id: &str) {
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) \
             VALUES (?, ?, 'suchlage', 'Drohnen', 30)",
        )
        .bind(id)
        .bind(self.org_id)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn zuschalten(&self, adapter_id: &str, einsatz_id: i64) {
        let mut conn = self.pool.acquire().await.unwrap();
        repo::upsert(
            &mut conn,
            &Zuschaltung {
                adapter_id: adapter_id.into(),
                einsatz_id,
                zugeschaltet_at: "2026-11-24T10:00:00Z".into(),
                lagemonitor: false,
            },
        )
        .await
        .unwrap();
    }
}

fn stand() -> Stand {
    Stand {
        lage: DrohnenLage {
            stand_ms: 1,
            quelle_stand_ms: 1,
            mission_name: None,
            fluggeraete: vec![],
            karte: None,
            videos: vec![],
            fotos: vec![],
            verworfen: 0,
        },
        map_etag: None,
        photos_latest_ms: None,
        upstream: Upstream::default(),
    }
}

#[tokio::test]
async fn load_setzt_den_merker_für_laufende_einsätze() {
    let u = umgebung().await;
    u.adapter("a1").await;
    u.adapter("a2").await;
    u.zuschalten("a1", u.einsatz).await;

    let store = Store::new();
    store.load(&u.pool).await;

    assert!(store.is_zugeschaltet("a1"));
    assert!(!store.is_zugeschaltet("a2"));
}

#[tokio::test]
async fn abgeschlossener_einsatz_zählt_nicht() {
    let u = umgebung().await;
    u.adapter("a1").await;
    u.zuschalten("a1", u.einsatz).await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(u.einsatz)
        .execute(&u.pool)
        .await
        .unwrap();

    let store = Store::new();
    store.load(&u.pool).await;
    assert!(!store.is_zugeschaltet("a1"));

    let mut conn = u.pool.acquire().await.unwrap();
    assert!(!repo::is_active(&mut conn, "a1").await.unwrap());
    assert_eq!(
        repo::find_active_holder(&mut conn, "a1").await.unwrap(),
        None
    );
    assert!(repo::load_active_adapter_ids(&mut conn)
        .await
        .unwrap()
        .is_empty());
    // Die Zeile bleibt für den Einsatz lesbar.
    assert_eq!(
        repo::load_for_einsatz(&mut conn, u.einsatz)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn find_active_holder_findet_den_anderen_einsatz() {
    let u = umgebung().await;
    let zweiter = einsatz_anlegen_mit(&u.app, &u.cookie, "Lage B").await;
    u.adapter("a1").await;
    u.zuschalten("a1", u.einsatz).await;

    let mut conn = u.pool.acquire().await.unwrap();
    assert_eq!(
        repo::find_active_holder(&mut conn, "a1").await.unwrap(),
        Some(u.einsatz)
    );
    assert!(repo::is_active(&mut conn, "a1").await.unwrap());
    assert_ne!(zweiter, u.einsatz);

    // Abschalten im ersten Einsatz gibt den Adapter frei.
    assert!(repo::delete(&mut conn, "a1", u.einsatz).await.unwrap());
    assert!(!repo::delete(&mut conn, "a1", u.einsatz).await.unwrap());
    assert_eq!(
        repo::find_active_holder(&mut conn, "a1").await.unwrap(),
        None
    );
    drop(conn);
    u.zuschalten("a1", zweiter).await;
    let mut conn = u.pool.acquire().await.unwrap();
    assert_eq!(
        repo::find_active_holder(&mut conn, "a1").await.unwrap(),
        Some(zweiter)
    );
}

#[tokio::test]
async fn abschalten_leert_den_stand() {
    let store = Store::new();
    store.set_zugeschaltet("a1", true, store.marke());
    store.put("a1", stand());
    assert!(store.get("a1").is_some());

    store.set_zugeschaltet("a1", false, store.marke());
    assert!(!store.is_zugeschaltet("a1"));
    assert!(store.get("a1").is_none());
}

#[tokio::test]
async fn find_video_und_foto_nutzen_nur_den_upstream_im_speicher() {
    let store = Store::new();
    let mut s = stand();
    s.upstream.videos.insert("vk".into(), "sn-1".into());
    s.upstream.fotos.insert("fk".into(), "/thumb/1".into());
    store.put("a1", s);

    assert_eq!(store.find_video("vk"), Some(("a1".into(), "sn-1".into())));
    assert_eq!(
        store.find_photo("fk"),
        Some(("a1".into(), "/thumb/1".into()))
    );
    assert_eq!(store.find_video("fk"), None);
}

#[tokio::test]
async fn löschen_des_adapters_entfernt_die_zuschaltung() {
    let u = umgebung().await;
    u.adapter("a1").await;
    u.zuschalten("a1", u.einsatz).await;

    sqlx::query("DELETE FROM adapter WHERE id = 'a1'")
        .execute(&u.pool)
        .await
        .unwrap();

    let mut conn = u.pool.acquire().await.unwrap();
    assert!(repo::load_for_einsatz(&mut conn, u.einsatz)
        .await
        .unwrap()
        .is_empty());
}

// LLH-2123: Wer seine Marke früher gezogen hat, hat die Datenbank früher gelesen. Sein Wert ist
// veraltet, sobald ein späterer Abgleich schon gesetzt hat.
#[tokio::test]
async fn ein_älterer_abgleich_überschreibt_keinen_neueren() {
    let store = Store::new();
    let a = store.marke();
    let b = store.marke();
    assert!(store.set_zugeschaltet("a1", true, b));
    assert!(!store.set_zugeschaltet("a1", false, a));
    assert!(store.is_zugeschaltet("a1"));

    // Und umgekehrt: ein späteres Abschalten gilt.
    assert!(store.set_zugeschaltet("a1", false, store.marke()));
    assert!(!store.is_zugeschaltet("a1"));
}

#[tokio::test]
async fn marken_gelten_je_adapter() {
    let store = Store::new();
    let a = store.marke();
    let b = store.marke();
    assert!(store.set_zugeschaltet("a2", true, b));
    assert!(store.set_zugeschaltet("a1", true, a));
    assert!(store.is_zugeschaltet("a1"));
}

// Die Reihenfolge aus LLH-2123: Einsatz A schließt, sein Nachführen liest „nicht gehalten“;
// bevor es den Merker setzt, schaltet Einsatz B zu und gleicht ab. Der Merker bleibt an.
#[tokio::test]
async fn abschluss_und_zuschalten_im_selben_moment_lassen_den_merker_an() {
    let u = umgebung().await;
    let zweiter = einsatz_anlegen_mit(&u.app, &u.cookie, "Lage B").await;
    u.adapter("a1").await;
    u.zuschalten("a1", u.einsatz).await;
    let store = Store::new();
    store.load(&u.pool).await;
    assert!(store.is_zugeschaltet("a1"));

    // A schließt: Zeile weg, das Nachführen zieht seine Marke und liest.
    {
        let mut conn = u.pool.acquire().await.unwrap();
        repo::delete_for_einsatz(&mut conn, u.einsatz)
            .await
            .unwrap();
    }
    let marke_a = store.marke();
    let an_a = {
        let mut conn = u.pool.acquire().await.unwrap();
        repo::is_active(&mut conn, "a1").await.unwrap()
    };
    assert!(!an_a);

    // B schaltet zu und gleicht nach seinem Commit ab.
    u.zuschalten("a1", zweiter).await;
    {
        let mut conn = u.pool.acquire().await.unwrap();
        store.abgleichen(&mut conn, "a1").await.unwrap();
    }
    assert!(store.is_zugeschaltet("a1"));

    // Erst jetzt setzt A: zu spät, der Wert ist überholt.
    store.set_zugeschaltet("a1", an_a, marke_a);
    assert!(store.is_zugeschaltet("a1"));
}

#[tokio::test]
async fn abgleichen_folgt_der_datenbank() {
    let u = umgebung().await;
    u.adapter("a1").await;
    let store = Store::new();
    let mut conn = u.pool.acquire().await.unwrap();
    store.abgleichen(&mut conn, "a1").await.unwrap();
    assert!(!store.is_zugeschaltet("a1"));
    drop(conn);

    u.zuschalten("a1", u.einsatz).await;
    let mut conn = u.pool.acquire().await.unwrap();
    store.abgleichen(&mut conn, "a1").await.unwrap();
    assert!(store.is_zugeschaltet("a1"));
}

// Eine Übernahme, die ein späterer Abgleich überholt hat, legt keinen Stand ab.
#[tokio::test]
async fn eine_überholte_übernahme_legt_keinen_stand_ab() {
    let store = Store::new();
    let alt = store.marke();
    store.set_zugeschaltet("a1", false, store.marke());
    assert!(!store.uebernehmen("a1", true, alt, stand()));
    assert!(!store.is_zugeschaltet("a1"));
    assert!(store.get("a1").is_none());

    assert!(store.uebernehmen("a1", true, store.marke(), stand()));
    assert!(store.get("a1").is_some());
}
