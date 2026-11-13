//! Ausgangsereignisse für Fremdsysteme (LLH-1655, Spec `ereignis-abruf`): Lesen ab dem Cursor,
//! Long-Poll, Wartegrenzen und Aufbewahrung, gegen die Funktionen aus `public_api::events`.
//!
//! Die Ereignisse entstehen hier wie im Betrieb: über die Trigger an Freigabe, Einsatzkopf und
//! Lage (`tests/public_api_ereignis_trigger.rs` prüft diese selbst). Direkt in die Outbox fügt
//! nur [`altes_ereignis`] ein, weil ein Trigger immer „jetzt“ schreibt; unter `src/` schreibt
//! niemand hinein (`src/AGENTS.md`, Ausgangsereignisse für Fremdsysteme).

use lifeline_hub::public_api::events::{self, EventType, Warteraum};
use lifeline_hub::public_api::scope::Scope;
use lifeline_hub::public_api::{freigabe, zugang, ErrorCode};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};

const ALLE_LESE_SCOPES: &[Scope] = &[Scope::EventsRead, Scope::EinsaetzeRead, Scope::LageRead];

/// Kurzer Takt für die Warte-Tests; im Betrieb ist es eine Sekunde.
const TAKT: Duration = Duration::from_millis(20);

/// Eine Org mit einer Person, die freigibt.
struct Org {
    pool: SqlitePool,
    id: i64,
    leitung: i64,
}

async fn org() -> Org {
    let pool = lifeline_hub::db::test_pool().await;
    let id: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Test-Orga') RETURNING id")
            .fetch_one(&pool)
            .await
            .expect("Organisation anlegen");
    let leitung: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'Leitung', 'leitung', 'x') RETURNING id",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .expect("Benutzer anlegen");
    Org { pool, id, leitung }
}

async fn zugang_anlegen(o: &Org, name: &str) -> String {
    let mut conn = o.pool.acquire().await.unwrap();
    zugang::anlegen(
        &mut conn,
        o.id,
        name,
        ALLE_LESE_SCOPES,
        None,
        None,
        &lifeline_hub::zeit::jetzt(),
    )
    .await
    .expect("Zugang anlegen")
}

/// Legt einen laufenden Einsatz an und gibt ihn für den Zugang frei. Das schreibt
/// `einsatz.created` und `lage.changed` für ihn.
async fn einsatz_freigeben(o: &Org, zugang: &str) -> i64 {
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Hochwasser') RETURNING id",
    )
    .bind(o.id)
    .fetch_one(&o.pool)
    .await
    .expect("Einsatz anlegen");
    let mut conn = o.pool.acquire().await.unwrap();
    freigabe::freigeben_tx(&mut conn, zugang, einsatz, o.leitung)
        .await
        .expect("Einsatz freigeben");
    einsatz
}

/// Ein Zugang mit freigegebenem Einsatz.
async fn angebunden(o: &Org, name: &str) -> (String, i64) {
    let zugang = zugang_anlegen(o, name).await;
    let einsatz = einsatz_freigeben(o, &zugang).await;
    (zugang, einsatz)
}

async fn hoechste(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM maschine_ereignis")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Ändert ein Kopffeld ohne Lagebezug: genau ein `einsatz.updated` je freigegebenem Zugang.
/// Liefert die Nummer des neuen Ereignisses.
async fn kopf_aendern(pool: &SqlitePool, einsatz: i64) -> i64 {
    sqlx::query("UPDATE einsatz SET leitstellen_nr = hex(randomblob(8)) WHERE id = ?")
        .bind(einsatz)
        .execute(pool)
        .await
        .expect("Kopf ändern");
    hoechste(pool).await
}

/// Ändert die Lage: zeichnet eine Zone ein. Genau ein `lage.changed` je freigegebenem Zugang.
async fn lage_aendern(o: &Org, einsatz: i64) -> i64 {
    sqlx::query(
        "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, erstellt_von) \
         VALUES (?, 'absperrbereich', 'Polygon', '{}', ?)",
    )
    .bind(einsatz)
    .bind(o.leitung)
    .execute(&o.pool)
    .await
    .expect("Zone einzeichnen");
    hoechste(&o.pool).await
}

/// Der Stand, ab dem ein Zugang neu beginnt.
async fn stand(pool: &SqlitePool, zugang: &str) -> i64 {
    events::lesen(pool, zugang, ALLE_LESE_SCOPES, None)
        .await
        .unwrap()
        .cursor
}

/// Fügt ein Ereignis mit einem Alter in Tagen direkt ein. Nur so entsteht eine alte Zeile: ein
/// Trigger schreibt immer „jetzt“.
async fn altes_ereignis(pool: &SqlitePool, zugang: &str, tage: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id, occurred_at) \
         VALUES (?, 'einsatz.updated', 1, datetime('now', ?)) RETURNING id",
    )
    .bind(zugang)
    .bind(format!("-{tage} days"))
    .fetch_one(pool)
    .await
    .expect("altes Ereignis einfügen")
}

fn ids(antwort: &events::EventsResponse) -> Vec<i64> {
    antwort.events.iter().map(|e| e.id).collect()
}

fn arten(antwort: &events::EventsResponse) -> Vec<EventType> {
    antwort.events.iter().map(|e| e.event_type).collect()
}

#[tokio::test]
async fn die_ereignisarten_sind_die_des_db_checks() {
    let o = org().await;
    let sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'maschine_ereignis'",
    )
    .fetch_one(&o.pool)
    .await
    .unwrap();
    let anfang = sql.find("type IN").expect("CHECK auf type");
    let liste = &sql[anfang..];
    let liste = &liste[liste.find('(').unwrap() + 1..liste.find(')').unwrap()];
    let mut im_check: Vec<&str> = liste
        .split(',')
        .map(|w| w.trim().trim_matches('\''))
        .collect();
    im_check.sort();
    let mut im_enum: Vec<&str> = EventType::ALLE.iter().map(|a| a.as_str()).collect();
    im_enum.sort();
    assert_eq!(im_enum, im_check);
}

#[tokio::test]
async fn ohne_after_kommt_der_hoechststand_ohne_ereignisse() {
    let o = org().await;
    let z = zugang_anlegen(&o, "A").await;

    let leer = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, None)
        .await
        .unwrap();
    assert_eq!(leer.cursor, 0, "ohne je ein Ereignis ist der Stand 0");
    assert!(leer.events.is_empty());

    einsatz_freigeben(&o, &z).await;
    let letzte = hoechste(&o.pool).await;
    assert!(letzte > 0, "die Freigabe hat Ereignisse geschrieben");
    let antwort = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, None)
        .await
        .unwrap();
    assert_eq!(antwort.cursor, letzte);
    assert!(
        antwort.events.is_empty(),
        "ohne `after` beginnt der Zugang ab jetzt, nicht mit dem Bestand"
    );
}

#[tokio::test]
async fn zeilen_kommen_aufsteigend_ab_dem_cursor_und_nur_die_eigenen() {
    let o = org().await;
    let (a, einsatz_a) = angebunden(&o, "A").await;
    let (b, einsatz_b) = angebunden(&o, "B").await;
    let beginn = stand(&o.pool, &a).await;

    let a1 = kopf_aendern(&o.pool, einsatz_a).await;
    let _b1 = kopf_aendern(&o.pool, einsatz_b).await;
    let a2 = kopf_aendern(&o.pool, einsatz_a).await;
    let a3 = lage_aendern(&o, einsatz_a).await;

    let neu = events::lesen(&o.pool, &a, ALLE_LESE_SCOPES, Some(beginn))
        .await
        .unwrap();
    assert_eq!(ids(&neu), vec![a1, a2, a3]);
    assert_eq!(
        arten(&neu),
        vec![
            EventType::EinsatzUpdated,
            EventType::EinsatzUpdated,
            EventType::LageChanged
        ]
    );
    assert_eq!(neu.cursor, a3);
    assert!(neu.events.iter().all(|e| e.einsatz_id == einsatz_a));

    // Von vorn: zuerst die Freigabe, dann alles Weitere, nie etwas von B.
    let alles = events::lesen(&o.pool, &a, ALLE_LESE_SCOPES, Some(0))
        .await
        .unwrap();
    let erstes = &alles.events[0];
    assert_eq!(erstes.event_type, EventType::EinsatzCreated);
    assert_eq!(erstes.einsatz_id, einsatz_a);
    assert!(
        lifeline_hub::zeit::parse(&erstes.occurred_at).is_some(),
        "occurred_at steht in zeit::FORMAT: {}",
        erstes.occurred_at
    );
    assert!(ids(&alles).windows(2).all(|w| w[0] < w[1]), "aufsteigend");
    assert!(alles.events.iter().all(|e| e.einsatz_id != einsatz_b));
    let von_b = events::lesen(&o.pool, &b, ALLE_LESE_SCOPES, Some(0))
        .await
        .unwrap();
    assert!(von_b.events.iter().all(|e| e.einsatz_id == einsatz_b));

    let rest = events::lesen(&o.pool, &a, ALLE_LESE_SCOPES, Some(a1))
        .await
        .unwrap();
    assert_eq!(ids(&rest), vec![a2, a3]);

    let nichts = events::lesen(&o.pool, &a, ALLE_LESE_SCOPES, Some(a3))
        .await
        .unwrap();
    assert!(nichts.events.is_empty());
    assert_eq!(nichts.cursor, a3);
}

#[tokio::test]
async fn sechshundert_zeilen_kommen_in_zwei_seiten() {
    let o = org().await;
    let (z, einsatz) = angebunden(&o, "A").await;
    let beginn = stand(&o.pool, &z).await;
    let mut alle = Vec::new();
    for _ in 0..600 {
        alle.push(kopf_aendern(&o.pool, einsatz).await);
    }

    let erste = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(beginn))
        .await
        .unwrap();
    assert_eq!(ids(&erste), alle[..500]);
    assert_eq!(
        erste.cursor, alle[499],
        "volle Seite: Cursor ist die letzte gelieferte Nummer"
    );

    let zweite = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(erste.cursor))
        .await
        .unwrap();
    assert_eq!(ids(&zweite), alle[500..]);
    assert_eq!(zweite.cursor, alle[599]);
}

#[tokio::test]
async fn die_scopes_bestimmen_die_arten() {
    let o = org().await;
    let (z, einsatz) = angebunden(&o, "A").await;
    let beginn = stand(&o.pool, &z).await;
    let kopf = kopf_aendern(&o.pool, einsatz).await;
    let lage = lage_aendern(&o, einsatz).await;

    let nur_lage = events::lesen(
        &o.pool,
        &z,
        &[Scope::EventsRead, Scope::LageRead],
        Some(beginn),
    )
    .await
    .unwrap();
    assert_eq!(ids(&nur_lage), vec![lage]);

    let nur_einsatz = events::lesen(
        &o.pool,
        &z,
        &[Scope::EventsRead, Scope::EinsaetzeRead],
        Some(beginn),
    )
    .await
    .unwrap();
    assert_eq!(ids(&nur_einsatz), vec![kopf]);

    let nichts = events::lesen(&o.pool, &z, &[Scope::EventsRead], Some(beginn))
        .await
        .unwrap();
    assert!(nichts.events.is_empty());
    assert_eq!(
        nichts.cursor, lage,
        "der Cursor rückt auch ohne sichtbare Art vor"
    );
}

#[tokio::test]
async fn ein_ruhiger_zugang_bekommt_den_hoechststand() {
    let o = org().await;
    let ruhig = zugang_anlegen(&o, "ruhig").await;
    let (_laut, einsatz) = angebunden(&o, "laut").await;
    let mut letzte = 0;
    for _ in 0..3 {
        letzte = lage_aendern(&o, einsatz).await;
    }

    let antwort = events::lesen(&o.pool, &ruhig, ALLE_LESE_SCOPES, Some(0))
        .await
        .unwrap();
    assert!(antwort.events.is_empty());
    assert_eq!(antwort.cursor, letzte);
}

#[tokio::test]
async fn ein_cursor_unter_der_loeschgrenze_oder_ueber_dem_hoechststand_ist_abgelaufen() {
    let o = org().await;
    let (z, einsatz) = angebunden(&o, "A").await;
    let mut nummern = Vec::new();
    for _ in 0..5 {
        nummern.push(kopf_aendern(&o.pool, einsatz).await);
    }
    let (grenze, letzte) = (nummern[2], nummern[4]);
    sqlx::query("UPDATE maschine_ereignis_stand SET purged_until = ?")
        .bind(grenze)
        .execute(&o.pool)
        .await
        .unwrap();

    let darunter = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(grenze - 1))
        .await
        .unwrap_err();
    assert_eq!(darunter.code, ErrorCode::CursorExpired);
    assert_eq!(darunter.status, axum::http::StatusCode::GONE);

    let an_der_grenze = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(grenze)).await;
    assert!(
        an_der_grenze.is_ok(),
        "bis zur Grenze selbst ist nichts verloren"
    );

    let darueber = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(letzte + 1))
        .await
        .unwrap_err();
    assert_eq!(darueber.code, ErrorCode::CursorExpired);
}

#[tokio::test]
async fn ein_wartender_abruf_kehrt_nach_einer_neuen_zeile_zurueck() {
    let o = org().await;
    let (z, einsatz) = angebunden(&o, "A").await;
    let beginn = stand(&o.pool, &z).await;
    let raum = Warteraum::neu(4);

    let wartender = {
        let (pool, z, raum) = (o.pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(beginn),
                Duration::from_secs(25),
                &raum,
                TAKT,
            )
            .await
        })
    };
    tokio::time::sleep(TAKT * 3).await;
    assert!(!wartender.is_finished(), "ohne Ereignis wartet der Abruf");

    let jetzt = Instant::now();
    let neu = kopf_aendern(&o.pool, einsatz).await;
    let abruf = tokio::time::timeout(Duration::from_secs(2), wartender)
        .await
        .expect("der Abruf endet binnen zwei Sekunden nach dem Ereignis")
        .unwrap()
        .unwrap();
    assert!(jetzt.elapsed() < Duration::from_secs(2));
    assert_eq!(ids(&abruf.antwort), vec![neu]);
    assert!(!abruf.ohne_warteplatz);
}

#[tokio::test]
async fn ohne_zeile_kehrt_der_abruf_nach_der_wartezeit_leer_zurueck() {
    let o = org().await;
    let z = zugang_anlegen(&o, "A").await;
    let (_anderer, einsatz_anderer) = angebunden(&o, "B").await;
    let beginn_stand = stand(&o.pool, &z).await;
    let raum = Warteraum::neu(4);

    let beginn = Instant::now();
    let warten = Duration::from_millis(200);
    let wartender = {
        let (pool, z, raum) = (o.pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(beginn_stand),
                warten,
                &raum,
                TAKT,
            )
            .await
        })
    };
    // Ein Ereignis eines anderen Zugangs weckt nicht, rückt aber den Cursor vor.
    tokio::time::sleep(TAKT * 2).await;
    let fremd = kopf_aendern(&o.pool, einsatz_anderer).await;

    let abruf = wartender.await.unwrap().unwrap();
    assert!(beginn.elapsed() >= warten, "gewartet wurde die ganze Zeit");
    assert!(beginn.elapsed() < warten + Duration::from_secs(1));
    assert!(abruf.antwort.events.is_empty());
    assert_eq!(abruf.antwort.cursor, fremd);
    assert!(!abruf.ohne_warteplatz);
    assert_eq!(raum.wartende(), 0, "der Platz ist wieder frei");
}

#[tokio::test]
async fn ohne_wartezeit_und_ohne_after_wartet_der_abruf_nicht() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let raum = Warteraum::neu(4);

    let beginn = Instant::now();
    let sofort = events::abrufen_mit(
        &pool,
        &z,
        ALLE_LESE_SCOPES,
        Some(0),
        Duration::ZERO,
        &raum,
        TAKT,
    )
    .await
    .unwrap();
    assert!(sofort.antwort.events.is_empty());
    assert!(!sofort.ohne_warteplatz);

    let erster = events::abrufen_mit(
        &pool,
        &z,
        ALLE_LESE_SCOPES,
        None,
        Duration::from_secs(25),
        &raum,
        TAKT,
    )
    .await
    .unwrap();
    assert!(erster.antwort.events.is_empty());
    assert!(!erster.ohne_warteplatz);
    assert!(beginn.elapsed() < Duration::from_secs(1));
}

/// `db::test_pool` hat genau eine Verbindung. Hielte der wartende Abruf sie, käme das Schreiben
/// erst nach seiner Wartezeit dran.
#[tokio::test]
async fn waehrend_des_wartens_bleibt_die_verbindung_frei() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let raum = Warteraum::neu(4);

    let wartender = {
        let (pool, z, raum) = (pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(0),
                Duration::from_secs(25),
                &raum,
                Duration::from_millis(500),
            )
            .await
        })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(raum.wartende(), 1);

    let geschrieben = tokio::time::timeout(
        Duration::from_millis(250),
        sqlx::query("INSERT INTO organisation (name) VALUES ('Zweite')").execute(&pool),
    )
    .await;
    assert!(
        geschrieben.is_ok(),
        "ein Schreiben kommt dran, während der Abruf zwischen zwei Nachfragen schläft"
    );
    wartender.abort();
}

#[tokio::test]
async fn der_zweite_wartende_abruf_desselben_zugangs_wartet_nicht() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let raum = Warteraum::neu(4);

    let erster = {
        let (pool, z, raum) = (pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(0),
                Duration::from_secs(25),
                &raum,
                TAKT,
            )
            .await
        })
    };
    tokio::time::sleep(TAKT * 3).await;

    let beginn = Instant::now();
    let zweiter = events::abrufen_mit(
        &pool,
        &z,
        ALLE_LESE_SCOPES,
        Some(0),
        Duration::from_secs(25),
        &raum,
        TAKT,
    )
    .await
    .unwrap();
    assert!(
        beginn.elapsed() < Duration::from_secs(1),
        "der zweite antwortet sofort"
    );
    assert!(zweiter.ohne_warteplatz);
    assert!(zweiter.antwort.events.is_empty());
    assert!(!erster.is_finished(), "der erste wartet weiter");
    erster.abort();
}

#[tokio::test]
async fn sind_alle_warteplaetze_belegt_wartet_ein_weiterer_zugang_nicht() {
    let o = org().await;
    let pool = o.pool.clone();
    let raum = Warteraum::neu(2);
    let mut wartende = Vec::new();
    for name in ["A", "B"] {
        let z = zugang_anlegen(&o, name).await;
        let (pool, raum) = (pool.clone(), raum.clone());
        wartende.push(tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(0),
                Duration::from_secs(25),
                &raum,
                TAKT,
            )
            .await
        }));
    }
    tokio::time::sleep(TAKT * 3).await;
    assert_eq!(raum.wartende(), 2);

    let dritter = zugang_anlegen(&o, "C").await;
    let abruf = events::abrufen_mit(
        &pool,
        &dritter,
        ALLE_LESE_SCOPES,
        Some(0),
        Duration::from_secs(25),
        &raum,
        TAKT,
    )
    .await
    .unwrap();
    assert!(abruf.ohne_warteplatz);

    // Liegt etwas vor, kommt es trotzdem, und der Client muss nicht warten.
    einsatz_freigeben(&o, &dritter).await;
    let mit_ereignis = events::abrufen_mit(
        &pool,
        &dritter,
        ALLE_LESE_SCOPES,
        Some(0),
        Duration::from_secs(25),
        &raum,
        TAKT,
    )
    .await
    .unwrap();
    assert_eq!(
        arten(&mit_ereignis.antwort),
        vec![EventType::EinsatzCreated, EventType::LageChanged]
    );
    assert!(!mit_ereignis.ohne_warteplatz);

    for w in wartende {
        w.abort();
    }
}

#[tokio::test]
async fn ein_abgebrochener_abruf_gibt_seinen_platz_frei() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let raum = Warteraum::neu(1);

    let erster = {
        let (pool, z, raum) = (pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(0),
                Duration::from_secs(25),
                &raum,
                TAKT,
            )
            .await
        })
    };
    tokio::time::sleep(TAKT * 3).await;
    assert_eq!(raum.wartende(), 1);

    erster.abort();
    let _ = erster.await;
    assert_eq!(raum.wartende(), 0);
    assert!(
        raum.belegen(&z).is_some(),
        "derselbe Zugang bekommt wieder einen Platz"
    );
}

#[tokio::test]
async fn der_purge_loescht_nach_sieben_tagen_und_setzt_die_loeschgrenze() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    // Das Alter braucht das direkte Einfügen: ein Trigger schreibt immer „jetzt“.
    let alt = altes_ereignis(&pool, &z, 8).await;
    let jung = altes_ereignis(&pool, &z, 6).await;
    let jetzt = lifeline_hub::zeit::jetzt();

    let geloescht = events::purge(&pool, &jetzt).await.unwrap();
    assert_eq!(geloescht, 1);

    let bleibt: Vec<i64> = sqlx::query_scalar("SELECT id FROM maschine_ereignis ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(bleibt, vec![jung]);
    let grenze: i64 = sqlx::query_scalar("SELECT purged_until FROM maschine_ereignis_stand")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(grenze, alt);

    let zu_alt = events::lesen(&pool, &z, ALLE_LESE_SCOPES, Some(alt - 1))
        .await
        .unwrap_err();
    assert_eq!(zu_alt.code, ErrorCode::CursorExpired);
    let ab_grenze = events::lesen(&pool, &z, ALLE_LESE_SCOPES, Some(alt))
        .await
        .unwrap();
    assert_eq!(ids(&ab_grenze), vec![jung]);

    // Ein zweiter Lauf ohne neue alte Zeilen ändert nichts.
    assert_eq!(events::purge(&pool, &jetzt).await.unwrap(), 0);
    let grenze_danach: i64 = sqlx::query_scalar("SELECT purged_until FROM maschine_ereignis_stand")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(grenze_danach, alt);
}

/// Ist die Tabelle nach dem Purge leer, bleibt der Höchststand, wo er war: `AUTOINCREMENT`
/// vergibt die Nummern nicht neu, und ein alter Cursor bleibt erkennbar.
#[tokio::test]
async fn nach_dem_purge_aller_zeilen_bleibt_der_hoechststand() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let a = altes_ereignis(&pool, &z, 9).await;
    let b = altes_ereignis(&pool, &z, 8).await;

    assert_eq!(
        events::purge(&pool, &lifeline_hub::zeit::jetzt())
            .await
            .unwrap(),
        2
    );

    let stand = events::lesen(&pool, &z, ALLE_LESE_SCOPES, None)
        .await
        .unwrap();
    assert_eq!(stand.cursor, b);
    let alt = events::lesen(&pool, &z, ALLE_LESE_SCOPES, Some(a))
        .await
        .unwrap_err();
    assert_eq!(alt.code, ErrorCode::CursorExpired);
    einsatz_freigeben(&o, &z).await;
    let neu = hoechste(&pool).await;
    assert!(
        neu > b,
        "die nächste Nummer liegt über dem alten Höchststand"
    );
}

/// Der Purge-Lauf (Phase C) ruft den Purge der Ausgangsereignisse mit seinem `jetzt`.
#[tokio::test]
async fn der_purge_lauf_raeumt_die_ausgangsereignisse() {
    let o = org().await;
    let pool = o.pool.clone();
    let z = zugang_anlegen(&o, "A").await;
    let alt = altes_ereignis(&pool, &z, 8).await;
    let jung = altes_ereignis(&pool, &z, 6).await;

    lifeline_hub::einsatz::purge_scheduler::tick_einmal(
        &pool,
        &lifeline_hub::live::LiveHub::new(),
        chrono::Utc::now(),
    )
    .await;

    let bleibt: Vec<i64> = sqlx::query_scalar("SELECT id FROM maschine_ereignis ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(bleibt, vec![jung]);
    let grenze: i64 = sqlx::query_scalar("SELECT purged_until FROM maschine_ereignis_stand")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(grenze, alt);
}

/// Ein wartender Abruf prüft die Löschgrenze bei jeder Nachfrage: Läuft der Purge über seinen
/// Cursor hinweg, antwortet er mit `cursor_expired`, statt eine Lücke als „nichts Neues“ zu melden.
#[tokio::test]
async fn ein_wartender_abruf_meldet_einen_purge_ueber_seinen_cursor_als_abgelaufen() {
    let o = org().await;
    let (z, einsatz) = angebunden(&o, "A").await;
    let beginn = stand(&o.pool, &z).await;
    let raum = Warteraum::neu(4);

    let wartender = {
        let (pool, z, raum) = (o.pool.clone(), z.clone(), raum.clone());
        tokio::spawn(async move {
            events::abrufen_mit(
                &pool,
                &z,
                ALLE_LESE_SCOPES,
                Some(beginn),
                Duration::from_secs(25),
                &raum,
                TAKT,
            )
            .await
        })
    };
    tokio::time::sleep(TAKT * 3).await;
    // Wie ein Purge, der über den Cursor läuft: Zeilen darüber entstehen und sind gelöscht,
    // bevor der wartende Abruf sie sieht (eine Transaktion, wie es der Abruf von außen sieht).
    let mut tx = o.pool.begin().await.unwrap();
    sqlx::query("UPDATE einsatz SET leitstellen_nr = 'L-weg' WHERE id = ?")
        .bind(einsatz)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE maschine_ereignis_stand SET purged_until = \
         (SELECT seq FROM sqlite_sequence WHERE name = 'maschine_ereignis')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM maschine_ereignis \
         WHERE id <= (SELECT purged_until FROM maschine_ereignis_stand)",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let fehler = tokio::time::timeout(Duration::from_secs(2), wartender)
        .await
        .expect("der Abruf endet bei der nächsten Nachfrage")
        .unwrap()
        .unwrap_err();
    assert_eq!(fehler.code, ErrorCode::CursorExpired);
}
