//! Tests von Änderungslog und Nachlieferung (tasks.md 1.1, 2.1).

use super::*;
use sqlx::SqlitePool;

async fn pool_mit_org() -> SqlitePool {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'DRK KV Nord'), (2, 'Fremd')")
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn stand(pool: &SqlitePool, art: &str, schluessel: &str) -> Option<i64> {
    sqlx::query_scalar(
        "SELECT stand FROM stammdaten_aenderung WHERE org_id = 1 AND art = ? AND schluessel = ?",
    )
    .bind(art)
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
        .unwrap();
}

fn alle_arten() -> HashSet<StammdatenArt> {
    StammdatenArt::ALLE.into_iter().collect()
}

const OHNE: Empfaenger<'static> = Empfaenger {
    kopplung_org_id: 0,
    age: None,
    datentraeger_bestaetigt: false,
};

async fn liefere(pool: &SqlitePool, seit: i64, budget: usize) -> Nachlieferung {
    let mut conn = pool.acquire().await.unwrap();
    let mut b = Budget::neu(1 << 20);
    b.zeilen = budget;
    nachlieferung(&mut conn, 1, seit, &mut b, &alle_arten(), &OHNE)
        .await
        .unwrap()
}

#[tokio::test]
async fn jede_aenderung_erhoeht_den_stand_und_bleibt_eine_logzeile() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (5, 1, 'A')",
    )
    .await;
    let s1 = stand(&pool, "fahrzeug", "5").await.unwrap();
    exec(&pool, "UPDATE fahrzeug SET bemerkung = 'x' WHERE id = 5").await;
    let s2 = stand(&pool, "fahrzeug", "5").await.unwrap();
    exec(
        &pool,
        "UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = 5",
    )
    .await;
    let s3 = stand(&pool, "fahrzeug", "5").await.unwrap();
    exec(&pool, "DELETE FROM fahrzeug WHERE id = 5").await;
    let s4 = stand(&pool, "fahrzeug", "5").await.unwrap();
    assert!(s1 < s2 && s2 < s3 && s3 < s4);
    let zeilen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM stammdaten_aenderung WHERE art = 'fahrzeug' AND schluessel = '5'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen, 1);
}

#[tokio::test]
async fn unterliste_meldet_die_elternzeile() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO personal (id, org_id, name) VALUES (7, 1, 'Max')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO qualifikation (id, org_id, label) VALUES (3, 1, 'San')",
    )
    .await;
    let vorher = stand(&pool, "personal", "7").await.unwrap();
    exec(&pool, "INSERT INTO personal_qualifikation VALUES (7, 3)").await;
    assert!(stand(&pool, "personal", "7").await.unwrap() > vorher);
}

#[tokio::test]
async fn schluessel_arten_und_org_einstellungen_stehen_im_log() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO org_fuehrungsfunktion (org_id, funktion, label) VALUES (1, 's1', 'Personal')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO org_modul_einstellung (org_id, modul_key, sichtbar) VALUES (1, 'etb', 1)",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')",
    )
    .await;
    assert!(stand(&pool, "fuehrungsfunktion", "s1").await.is_some());
    assert!(stand(&pool, "modul_einstellung", "etb").await.is_some());
    assert!(stand(&pool, "org_einstellungen", "").await.is_some());
}

#[tokio::test]
async fn anmeldung_erhoeht_den_stand_eines_kontos_nicht() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (9, 1, 'Max', 'max', 'h')",
    )
    .await;
    let vorher = stand(&pool, "konto", "9").await.unwrap();
    exec(
        &pool,
        "UPDATE benutzer SET totp_letzter_schritt = 5, totp_fehlversuche = 1 WHERE id = 9",
    )
    .await;
    assert_eq!(stand(&pool, "konto", "9").await.unwrap(), vorher);
    exec(
        &pool,
        "UPDATE benutzer SET anzeigename = 'Max M.' WHERE id = 9",
    )
    .await;
    assert!(stand(&pool, "konto", "9").await.unwrap() > vorher);
}

#[tokio::test]
async fn nachlieferung_nach_stand_mit_budget_ohne_luecke_und_doppel() {
    let pool = pool_mit_org().await;
    for i in 1..=5 {
        exec(
            &pool,
            &format!("INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES ({i}, 1, 'F{i}')"),
        )
        .await;
    }
    exec(
        &pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'fremde Org')",
    )
    .await;
    let erste = liefere(&pool, 0, 2).await;
    assert_eq!(erste.zeilen.len(), 2);
    let zweite = liefere(&pool, erste.bis, 2).await;
    let dritte = liefere(&pool, zweite.bis, 2).await;
    let alle: Vec<String> = [erste.zeilen, zweite.zeilen, dritte.zeilen]
        .concat()
        .into_iter()
        .map(|l| l.schluessel)
        .collect();
    assert_eq!(alle, ["1", "2", "3", "4", "5"]);
    let leer = liefere(&pool, dritte.bis, 2).await;
    assert!(leer.zeilen.is_empty());
    assert_eq!(leer.bis, dritte.bis);
}

#[tokio::test]
async fn geloeschte_zeile_kommt_als_loeschung_und_daten_mit_unterlisten() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO qualifikation (id, org_id, label) VALUES (3, 1, 'San')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO personal (id, org_id, name, personalnummer) VALUES (7, 1, 'Max', 'P7')",
    )
    .await;
    exec(&pool, "INSERT INTO personal_qualifikation VALUES (7, 3)").await;
    exec(
        &pool,
        "INSERT INTO material (id, org_id, bezeichnung) VALUES (4, 1, 'Decke')",
    )
    .await;
    exec(&pool, "DELETE FROM material WHERE id = 4").await;
    let n = liefere(&pool, 0, 100).await;
    let p = n.zeilen.iter().find(|l| l.art == "personal").unwrap();
    let d = p.daten.as_ref().unwrap();
    assert_eq!(d["name"], "Max");
    assert_eq!(
        d["unterlisten"]["personal_qualifikation"][0]["qualifikation_id"],
        3
    );
    let m = n.zeilen.iter().find(|l| l.art == "material").unwrap();
    assert!(m.geloescht && m.daten.is_none());
}

#[tokio::test]
async fn abhaengigkeit_mit_spaeterem_stand_kommt_mit() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO einheit_typ (id, org_id, label) VALUES (1, 1, 'Zug')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (2, 1, 'F2')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO einheit_vorlage (id, org_id, name, typ_id) VALUES (3, 1, 'Zug 1', 1)",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO einheit_vorlage_fahrzeug (vorlage_id, fahrzeug_id) VALUES (3, 2)",
    )
    .await;
    // Typ und Fahrzeug ändern sich nach der Vorlage: ihr Stand liegt dahinter.
    exec(&pool, "UPDATE einheit_typ SET sortier = 2 WHERE id = 1").await;
    exec(&pool, "UPDATE fahrzeug SET bemerkung = 'neu' WHERE id = 2").await;
    let vorlage = stand(&pool, "einheit_vorlage", "3").await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let nur_vorlage: HashSet<_> = alle_arten();
    let mut b = Budget::neu(1 << 20);
    b.zeilen = 1;
    let n = nachlieferung(&mut conn, 1, vorlage - 1, &mut b, &nur_vorlage, &OHNE)
        .await
        .unwrap();
    let arten: Vec<&str> = n.zeilen.iter().map(|l| l.art.as_str()).collect();
    assert_eq!(arten[0], "einheit_vorlage");
    assert!(
        arten.contains(&"einheit_typ") && arten.contains(&"fahrzeug"),
        "{arten:?}"
    );
    assert_eq!(n.bis, vorlage, "Abhängigkeiten heben den Stand nicht");
}

#[tokio::test]
async fn unbekannte_arten_werden_nicht_geliefert() {
    let pool = pool_mit_org().await;
    exec(
        &pool,
        "INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (1, 1, 'F1')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO material (id, org_id, bezeichnung) VALUES (1, 1, 'Decke')",
    )
    .await;
    let mut conn = pool.acquire().await.unwrap();
    let nur: HashSet<_> = [StammdatenArt::Material].into_iter().collect();
    let mut b = Budget::neu(1 << 20);
    let n = nachlieferung(&mut conn, 1, 0, &mut b, &nur, &OHNE)
        .await
        .unwrap();
    assert!(n.zeilen.iter().all(|l| l.art == "material"));
    assert_eq!(n.zeilen.len(), 1);
}

#[tokio::test]
async fn quali_soll_verweist_auf_qualifikationen() {
    let v = verweise(
        StammdatenArt::EinheitTyp,
        &serde_json::json!({"quali_soll": "[{\"q\":4,\"n\":2}]"}),
    );
    assert_eq!(v, [(StammdatenArt::Qualifikation, "4".to_string())]);
}

#[tokio::test]
async fn byte_grenze_endet_vor_dem_paket_das_nicht_mehr_passt() {
    let pool = pool_mit_org().await;
    let lang = "x".repeat(4000);
    for i in 1..=10 {
        exec(
            &pool,
            &format!("INSERT INTO fahrzeug (id, org_id, funkrufname, bemerkung) VALUES ({i}, 1, 'F{i}', '{lang}')"),
        )
        .await;
    }
    let mut conn = pool.acquire().await.unwrap();
    // Platz für etwa drei Zeilen; schon etwas in der Antwort, also keine Ausnahme mehr.
    let mut b = Budget::neu(3 * 4100);
    b.leer = false;
    let n = nachlieferung(&mut conn, 1, 0, &mut b, &alle_arten(), &OHNE)
        .await
        .unwrap();
    assert!((1..=3).contains(&n.zeilen.len()), "{}", n.zeilen.len());
    let letzter: i64 = n.zeilen.last().unwrap().stand;
    assert_eq!(
        n.bis, letzter,
        "der Stand bleibt vor der ersten nicht gelieferten Zeile"
    );
    // Die erste Zeile einer Antwort geht auch allein über die Grenze.
    let mut b = Budget::neu(10);
    let n = nachlieferung(&mut conn, 1, 0, &mut b, &alle_arten(), &OHNE)
        .await
        .unwrap();
    assert_eq!(n.zeilen.len(), 1);
    assert!(!b.leer);
}

async fn konto_mit_hash(pool: &SqlitePool, id: i64, rolle: &str) {
    // Die Lieferliste zeigt auf eine Org-Zuordnung, die es hier nicht gibt.
    exec(pool, "PRAGMA foreign_keys = OFF").await;
    exec(
        pool,
        &format!(
            "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
             totp_secret, totp_aktiviert) VALUES ({id}, 1, 'K{id}', 'k{id}', \
             '$argon2id$v=19$m=19456,t=2,p=1$geheimersalt$geheimerhash', '{rolle}', 'JBSWY3DPEHPK3PXP', 1)"
        ),
    )
    .await;
}

async fn geheimnis_von(pool: &SqlitePool, empfaenger: &Empfaenger<'_>, id: i64) -> Option<String> {
    let mut conn = pool.acquire().await.unwrap();
    let mut b = Budget::neu(1 << 20);
    let arten: HashSet<_> = [StammdatenArt::Konto].into_iter().collect();
    let n = nachlieferung(&mut conn, 1, 0, &mut b, &arten, empfaenger)
        .await
        .unwrap();
    let l = n
        .zeilen
        .into_iter()
        .find(|l| l.schluessel == id.to_string())
        .unwrap();
    let text = serde_json::to_string(&l).unwrap();
    assert!(
        !text.contains("argon2") && !text.contains("JBSWY3DP"),
        "kein Geheimnis im Klartext auf der Leitung: {text}"
    );
    l.geheimnis
}

#[tokio::test]
async fn geheimnis_nur_verschluesselt_mit_empfaenger_und_bestaetigter_platte() {
    let pool = pool_mit_org().await;
    konto_mit_hash(&pool, 9, "keiner").await;
    let age = age::x25519::Identity::generate();
    let empfaenger = age.to_public().to_string();
    let mit = Empfaenger {
        kopplung_org_id: 0,
        age: Some(&empfaenger),
        datentraeger_bestaetigt: true,
    };
    let text = geheimnis_von(&pool, &mit, 9)
        .await
        .expect("Geheimnis geliefert");
    let g = super::super::geheimnis::decrypt(&age, &text).unwrap();
    assert!(g.passwort_hash.contains("geheimerhash") && g.totp_aktiviert);
    let ohne_platte = Empfaenger {
        datentraeger_bestaetigt: false,
        ..mit
    };
    assert!(geheimnis_von(&pool, &ohne_platte, 9).await.is_none());
    assert!(geheimnis_von(&pool, &OHNE, 9).await.is_none());
}

#[tokio::test]
async fn admin_geheimnis_nur_mit_anmelde_passkey() {
    let pool = pool_mit_org().await;
    konto_mit_hash(&pool, 9, "admin").await;
    let age = age::x25519::Identity::generate();
    let empfaenger = age.to_public().to_string();
    let mit = Empfaenger {
        kopplung_org_id: 0,
        age: Some(&empfaenger),
        datentraeger_bestaetigt: true,
    };
    assert!(geheimnis_von(&pool, &mit, 9).await.is_none());
    exec(
        &pool,
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key) VALUES (9, x'01', x'02')",
    )
    .await;
    assert!(geheimnis_von(&pool, &mit, 9).await.is_some());
}
