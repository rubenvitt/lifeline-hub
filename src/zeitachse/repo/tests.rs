//! Repo-Tests der Kräfte-Zeitachse (LFH-552) — je Spec-Szenario der Schreibpfade.

use super::*;
use crate::error::AppError;

fn t(uhr: &str) -> String {
    format!("2026-09-30 {uhr}:00")
}

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
    f1: i64,
    /// Drei Personen, Florian 1 zugeordnet.
    p: [i64; 3],
}

async fn welt() -> Welt {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let e: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Hochwasser') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let f1 = einheit(&pool, e, "Florian 1").await;
    let mut p = [0; 3];
    for (i, name) in ["Anna", "Bert", "Cem"].iter().enumerate() {
        p[i] = person(&pool, e, name, Some(f1)).await;
    }
    Welt { pool, b, e, f1, p }
}

async fn einheit(pool: &SqlitePool, e: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id")
        .bind(e)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn person(pool: &SqlitePool, e: i64, name: &str, einheit: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) VALUES (?, ?, ?) \
         RETURNING id",
    )
    .bind(e)
    .bind(name)
    .bind(einheit)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn schreibe(
    w: &Welt,
    kraft: Kraft,
    art: ZeitachseArt,
    uhr: &str,
    quelle: ZeitachseQuelle,
) -> Schreibergebnis {
    let mut conn = w.pool.acquire().await.unwrap();
    let z = t(uhr);
    schreibe_tx(
        &mut conn,
        w.e,
        w.b,
        kraft,
        Neu {
            art,
            zeitpunkt_at: &z,
            quelle,
            notiz: None,
        },
    )
    .await
    .unwrap()
    .0
}

/// `(art, zeitpunkt, quelle)` der nicht gestrichenen Ereignisse, nach Zeit.
async fn folge(w: &Welt, kraft: Kraft) -> Vec<(String, String, String)> {
    laden(&w.pool, w.e, kraft)
        .await
        .unwrap()
        .ereignisse
        .into_iter()
        .filter(|e| e.gestrichen_at.is_none())
        .map(|e| {
            (
                e.art.as_str().to_string(),
                e.zeitpunkt_at,
                e.quelle.as_str().to_string(),
            )
        })
        .collect()
}

fn ev(art: &str, uhr: &str, quelle: &str) -> (String, String, String) {
    (art.into(), t(uhr), quelle.into())
}

use ZeitachseArt::*;
use ZeitachseQuelle as Q;

// ── Schreiben ───────────────────────────────────────────────────────────────────────────────

/// Spec „Nachtrag reiht sich nach Zeit ein".
#[tokio::test]
async fn nachtrag_reiht_sich_nach_zeit_ein() {
    let w = welt().await;
    let p = Kraft::Person(w.p[0]);
    schreibe(&w, p, Alarmierung, "06:10", Q::Status).await;
    let r = schreibe(&w, p, Eintreffen, "06:40", Q::Nachtrag).await;
    assert!(matches!(r, Schreibergebnis::Geschrieben(_)));
    assert_eq!(
        folge(&w, p).await,
        vec![
            ev("alarmierung", "06:10", "status"),
            ev("eintreffen", "06:40", "nachtrag")
        ]
    );
}

#[tokio::test]
async fn verstoss_wird_ausgelassen_und_schreibt_nichts() {
    let w = welt().await;
    let p = Kraft::Person(w.p[0]);
    schreibe(&w, p, Eintreffen, "06:40", Q::Status).await;
    let r = schreibe(&w, p, Eintreffen, "06:50", Q::Nachtrag).await;
    assert!(matches!(
        r,
        Schreibergebnis::Ausgelassen(Verstoss::DoppeltesEintreffen { .. })
    ));
    assert_eq!(folge(&w, p).await.len(), 1);
}

#[tokio::test]
async fn fremde_kraft_ist_not_found() {
    let w = welt().await;
    let anderer: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Anderswo') RETURNING id",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let fremd = einheit(&w.pool, anderer, "Fremd").await;
    let mut conn = w.pool.acquire().await.unwrap();
    let z = t("06:40");
    let r = schreibe_tx(
        &mut conn,
        w.e,
        w.b,
        Kraft::Einheit(fremd),
        Neu {
            art: Eintreffen,
            zeitpunkt_at: &z,
            quelle: Q::Nachtrag,
            notiz: None,
        },
    )
    .await;
    assert!(matches!(r, Err(AppError::NotFound)));
}

// ── Fan-out ─────────────────────────────────────────────────────────────────────────────────

/// Spec „Einheit trifft ein".
#[tokio::test]
async fn fanout_einheit_trifft_ein() {
    let w = welt().await;
    let r = schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;
    let Schreibergebnis::Geschrieben(ursprung) = r else {
        panic!("geschrieben erwartet")
    };
    for p in w.p {
        let z = laden(&w.pool, w.e, Kraft::Person(p)).await.unwrap();
        assert_eq!(z.ereignisse.len(), 1);
        let e = &z.ereignisse[0];
        assert_eq!(e.art, Eintreffen);
        assert_eq!(e.zeitpunkt_at, t("06:40"));
        assert_eq!(e.quelle, Q::Einheit);
        assert_eq!(e.ursprung_id, Some(ursprung));
        assert_eq!(e.ursprung_einheit_name.as_deref(), Some("Florian 1"));
    }
}

/// Spec „Person schon eingetroffen".
#[tokio::test]
async fn fanout_laesst_person_mit_eigenem_eintreffen_aus() {
    let w = welt().await;
    schreibe(&w, Kraft::Person(w.p[0]), Eintreffen, "06:30", Q::Status).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let z = t("06:40");
    let (_, beruehrt) = schreibe_tx(
        &mut conn,
        w.e,
        w.b,
        Kraft::Einheit(w.f1),
        Neu {
            art: Eintreffen,
            zeitpunkt_at: &z,
            quelle: Q::Status,
            notiz: None,
        },
    )
    .await
    .unwrap();
    drop(conn);
    assert_eq!(beruehrt.personen, vec![w.p[1], w.p[2]]);
    assert_eq!(
        folge(&w, Kraft::Person(w.p[0])).await,
        vec![ev("eintreffen", "06:30", "status")]
    );
    assert_eq!(
        folge(&w, Kraft::Person(w.p[1])).await,
        vec![ev("eintreffen", "06:40", "einheit")]
    );
}

/// Spec „Nachträglich zugeordnet".
#[tokio::test]
async fn fanout_vererbt_nicht_an_spaeter_zugeordnete() {
    let w = welt().await;
    schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;
    let neu = person(&w.pool, w.e, "Dora", Some(w.f1)).await;
    assert!(folge(&w, Kraft::Person(neu)).await.is_empty());
}

// ── Streichung ──────────────────────────────────────────────────────────────────────────────

async fn streiche(w: &Welt, kraft: Kraft, id: i64, grund: &str) -> Result<Gestrichen, AppError> {
    let mut conn = w.pool.acquire().await.unwrap();
    streiche_tx(&mut conn, w.e, w.b, kraft, id, grund, false).await
}

/// Spec „Falsches Eintreffen streichen" und „Ereignis bleibt nach Streichung lesbar".
#[tokio::test]
async fn streichung_nimmt_die_fanout_kette_mit() {
    let w = welt().await;
    let Schreibergebnis::Geschrieben(id) =
        schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await
    else {
        panic!()
    };
    let g = streiche(&w, Kraft::Einheit(w.f1), id, "Zeit verwechselt")
        .await
        .unwrap();
    assert_eq!(g.art, Eintreffen);
    assert_eq!(g.beruehrt.personen.len(), 3);
    let z = laden(&w.pool, w.e, Kraft::Einheit(w.f1)).await.unwrap();
    assert_eq!(z.ereignisse.len(), 1, "gestrichen bleibt lesbar");
    assert!(z.ereignisse[0].gestrichen_at.is_some());
    assert_eq!(z.ereignisse[0].gestrichen_von, Some(w.b));
    assert_eq!(
        z.ereignisse[0].streichgrund.as_deref(),
        Some("Zeit verwechselt")
    );
    assert!(z.perioden.is_empty());
    for p in w.p {
        assert!(folge(&w, Kraft::Person(p)).await.is_empty());
    }
}

/// Spec „Doppelt gestrichen".
#[tokio::test]
async fn doppelt_gestrichen_ist_422() {
    let w = welt().await;
    let Schreibergebnis::Geschrieben(id) =
        schreibe(&w, Kraft::Person(w.p[0]), Eintreffen, "06:40", Q::Nachtrag).await
    else {
        panic!()
    };
    streiche(&w, Kraft::Person(w.p[0]), id, "x").await.unwrap();
    let r = streiche(&w, Kraft::Person(w.p[0]), id, "x").await;
    assert!(matches!(r, Err(AppError::UnprocessableEntity(_))));
}

#[tokio::test]
async fn streichen_das_die_ordnung_bricht_ist_422() {
    let w = welt().await;
    let p = Kraft::Person(w.p[0]);
    let Schreibergebnis::Geschrieben(id) = schreibe(&w, p, Eintreffen, "06:40", Q::Nachtrag).await
    else {
        panic!()
    };
    schreibe(&w, p, Entlassung, "14:40", Q::Nachtrag).await;
    let r = streiche(&w, p, id, "falsch").await;
    assert!(matches!(r, Err(AppError::UnprocessableEntity(_))));
    assert_eq!(folge(&w, p).await.len(), 2, "nichts gestrichen");
}

/// Eine betroffene Person, deren Folge ohne die Kopie bricht, sperrt die ganze Streichung.
#[tokio::test]
async fn streichen_prueft_jede_person_der_kette() {
    let w = welt().await;
    let Schreibergebnis::Geschrieben(id) =
        schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await
    else {
        panic!()
    };
    schreibe(&w, Kraft::Person(w.p[1]), Entlassung, "10:00", Q::Status).await;
    let r = streiche(&w, Kraft::Einheit(w.f1), id, "falsch").await;
    match r {
        Err(AppError::UnprocessableEntity(m)) => assert!(m.contains("Bert"), "{m}"),
        andere => panic!("422 erwartet, war {andere:?}"),
    }
    assert_eq!(folge(&w, Kraft::Einheit(w.f1)).await.len(), 1);
}

#[tokio::test]
async fn ereignis_einer_anderen_kraft_ist_not_found() {
    let w = welt().await;
    let Schreibergebnis::Geschrieben(id) =
        schreibe(&w, Kraft::Person(w.p[0]), Eintreffen, "06:40", Q::Nachtrag).await
    else {
        panic!()
    };
    let r = streiche(&w, Kraft::Person(w.p[1]), id, "x").await;
    assert!(matches!(r, Err(AppError::NotFound)));
}

#[tokio::test]
async fn ablosungsereignis_nur_ueber_ruecknahme() {
    let w = welt().await;
    schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;
    let mut conn = w.pool.acquire().await.unwrap();
    abloesung_vollzogen_tx(&mut conn, w.e, w.b, w.f1, &t("14:40"))
        .await
        .unwrap();
    drop(conn);
    let id = laden(&w.pool, w.e, Kraft::Einheit(w.f1))
        .await
        .unwrap()
        .ereignisse
        .into_iter()
        .find(|e| e.art == Abloesung)
        .unwrap()
        .id;
    let r = streiche(&w, Kraft::Einheit(w.f1), id, "x").await;
    assert!(matches!(r, Err(AppError::UnprocessableEntity(_))));
}

// ── Aus Statuswechseln ──────────────────────────────────────────────────────────────────────

async fn pstatus(pool: &SqlitePool, label: &str, marke: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO personal_status (org_id, label, kategorie, zeitachse_marke) \
         VALUES (1, ?, 'gebunden', ?) RETURNING id",
    )
    .bind(label)
    .bind(marke)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fstatus(pool: &SqlitePool, label: &str, marke: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO fahrzeug_status (org_id, label, kategorie, zeitachse_marke) \
         VALUES (1, ?, 'gebunden', ?) RETURNING id",
    )
    .bind(label)
    .bind(marke)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fahrzeug(pool: &SqlitePool, e: i64, name: &str, einheit: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
         VALUES (?, ?, ?) RETURNING id",
    )
    .bind(e)
    .bind(name)
    .bind(einheit)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn setze_fz(pool: &SqlitePool, ef: i64, status: i64) {
    sqlx::query("UPDATE einsatz_fahrzeug SET status_id = ? WHERE id = ?")
        .bind(status)
        .bind(ef)
        .execute(pool)
        .await
        .unwrap();
}

/// Spec „Person wird alarmiert" und „Status ohne Marke".
#[tokio::test]
async fn personalstatus_mit_und_ohne_marke() {
    let w = welt().await;
    let alarmiert = pstatus(&w.pool, "alarmiert*", Some("alarmierung")).await;
    let pause = pstatus(&w.pool, "Pause*", None).await;
    let mut conn = w.pool.acquire().await.unwrap();
    assert!(
        aus_personalstatus_tx(&mut conn, w.e, w.b, w.p[0], alarmiert, &t("06:10"))
            .await
            .unwrap()
    );
    assert!(
        !aus_personalstatus_tx(&mut conn, w.e, w.b, w.p[0], pause, &t("08:00"))
            .await
            .unwrap()
    );
    drop(conn);
    assert_eq!(
        folge(&w, Kraft::Person(w.p[0])).await,
        vec![ev("alarmierung", "06:10", "status")]
    );
}

/// Spec „Unpassendes Ereignis bricht den Status nicht".
#[tokio::test]
async fn personalstatus_zurueck_auf_alarmiert_wird_ausgelassen() {
    let w = welt().await;
    let alarmiert = pstatus(&w.pool, "alarmiert*", Some("alarmierung")).await;
    let im_einsatz = pstatus(&w.pool, "im Einsatz*", Some("eintreffen")).await;
    let mut conn = w.pool.acquire().await.unwrap();
    for (s, uhr) in [
        (alarmiert, "06:10"),
        (im_einsatz, "06:40"),
        (alarmiert, "07:00"),
    ] {
        aus_personalstatus_tx(&mut conn, w.e, w.b, w.p[0], s, &t(uhr))
            .await
            .unwrap();
    }
    drop(conn);
    assert_eq!(folge(&w, Kraft::Person(w.p[0])).await.len(), 2);
}

/// Spec „Erstes Fahrzeug trifft ein".
#[tokio::test]
async fn erstes_fahrzeug_zaehlt() {
    let w = welt().await;
    let am_ort = fstatus(&w.pool, "am Einsatzort", Some("eintreffen")).await;
    let a = fahrzeug(&w.pool, w.e, "HLF", Some(w.f1)).await;
    let b = fahrzeug(&w.pool, w.e, "MTW", Some(w.f1)).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let erst = aus_fahrzeugstatus_tx(&mut conn, w.e, w.b, a, am_ort, &t("06:40"))
        .await
        .unwrap();
    assert!(erst.is_some());
    let zweit = aus_fahrzeugstatus_tx(&mut conn, w.e, w.b, b, am_ort, &t("06:55"))
        .await
        .unwrap();
    assert!(zweit.is_none());
    drop(conn);
    assert_eq!(
        folge(&w, Kraft::Einheit(w.f1)).await,
        vec![ev("eintreffen", "06:40", "status")]
    );
}

/// Spec „Entlassung erst mit dem letzten Fahrzeug".
#[tokio::test]
async fn entlassung_erst_mit_dem_letzten_fahrzeug() {
    let w = welt().await;
    let am_ort = fstatus(&w.pool, "am Einsatzort", Some("eintreffen")).await;
    let heim = fstatus(&w.pool, "auf Wache", Some("entlassung")).await;
    let a = fahrzeug(&w.pool, w.e, "HLF", Some(w.f1)).await;
    let b = fahrzeug(&w.pool, w.e, "MTW", Some(w.f1)).await;
    setze_fz(&w.pool, a, am_ort).await;
    setze_fz(&w.pool, b, am_ort).await;
    schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;

    setze_fz(&w.pool, a, heim).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let r = aus_fahrzeugstatus_tx(&mut conn, w.e, w.b, a, heim, &t("14:00"))
        .await
        .unwrap();
    assert!(r.is_none(), "erstes Fahrzeug entlässt nicht");
    drop(conn);
    let z = laden(&w.pool, w.e, Kraft::Einheit(w.f1)).await.unwrap();
    assert_eq!(z.perioden[0].ende_at, None);

    setze_fz(&w.pool, b, heim).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let r = aus_fahrzeugstatus_tx(&mut conn, w.e, w.b, b, heim, &t("14:30"))
        .await
        .unwrap();
    assert!(r.is_some());
    drop(conn);
    let z = laden(&w.pool, w.e, Kraft::Einheit(w.f1)).await.unwrap();
    assert_eq!(z.perioden[0].ende_at.as_deref(), Some(t("14:30").as_str()));
    assert_eq!(z.perioden[0].ende_art, Some(Entlassung));
}

#[tokio::test]
async fn fahrzeug_ohne_einheit_schreibt_nichts() {
    let w = welt().await;
    let am_ort = fstatus(&w.pool, "am Einsatzort", Some("eintreffen")).await;
    let solo = fahrzeug(&w.pool, w.e, "ELW", None).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let r = aus_fahrzeugstatus_tx(&mut conn, w.e, w.b, solo, am_ort, &t("06:40"))
        .await
        .unwrap();
    assert!(r.is_none());
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_kraft_zeitachse")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn handstatus_wirkt_an_der_einheit_mit_fanout() {
    let w = welt().await;
    let alarm = fstatus(&w.pool, "alarmiert", Some("alarmierung")).await;
    let mut conn = w.pool.acquire().await.unwrap();
    let r = aus_einheit_handstatus_tx(&mut conn, w.e, w.b, w.f1, alarm, &t("06:10"))
        .await
        .unwrap();
    drop(conn);
    let (einheit, beruehrt) = r.unwrap();
    assert_eq!(einheit, w.f1);
    assert_eq!(beruehrt.personen.len(), 3);
    assert_eq!(
        folge(&w, Kraft::Person(w.p[2])).await,
        vec![ev("alarmierung", "06:10", "einheit")]
    );
}

// ── Ablösung ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn vollzug_und_ruecknahme() {
    let w = welt().await;
    schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;
    let mut conn = w.pool.acquire().await.unwrap();
    assert_eq!(
        offenes_eintreffen_tx(&mut conn, w.f1).await.unwrap(),
        Some(t("06:40"))
    );
    abloesung_vollzogen_tx(&mut conn, w.e, w.b, w.f1, &t("14:40"))
        .await
        .unwrap();
    assert_eq!(offenes_eintreffen_tx(&mut conn, w.f1).await.unwrap(), None);
    drop(conn);
    let z = laden(&w.pool, w.e, Kraft::Einheit(w.f1)).await.unwrap();
    assert_eq!(z.perioden[0].ende_art, Some(Abloesung));
    assert_eq!(
        folge(&w, Kraft::Person(w.p[0])).await[1],
        ev("abloesung", "14:40", "einheit")
    );

    let mut conn = w.pool.acquire().await.unwrap();
    abloesung_zurueckgenommen_tx(&mut conn, w.e, w.b, w.f1, &t("14:40"))
        .await
        .unwrap();
    drop(conn);
    let z = laden(&w.pool, w.e, Kraft::Einheit(w.f1)).await.unwrap();
    assert_eq!(z.perioden[0].ende_at, None, "Periode wieder offen");
    let gestrichen = z.ereignisse.iter().find(|e| e.art == Abloesung).unwrap();
    assert_eq!(
        gestrichen.streichgrund.as_deref(),
        Some(GRUND_ABLOESUNG_ZURUECK)
    );
    assert_eq!(folge(&w, Kraft::Person(w.p[0])).await.len(), 1);
}

#[tokio::test]
async fn vollzug_ohne_periode_schreibt_nichts() {
    let w = welt().await;
    let mut conn = w.pool.acquire().await.unwrap();
    abloesung_vollzogen_tx(&mut conn, w.e, w.b, w.f1, &t("14:40"))
        .await
        .unwrap();
    abloesung_zurueckgenommen_tx(&mut conn, w.e, w.b, w.f1, &t("14:40"))
        .await
        .unwrap();
    drop(conn);
    assert!(folge(&w, Kraft::Einheit(w.f1)).await.is_empty());
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn listen_je_kraft_nur_mit_ereignissen() {
    let w = welt().await;
    let f2 = einheit(&w.pool, w.e, "Florian 2").await;
    schreibe(&w, Kraft::Einheit(w.f1), Alarmierung, "06:10", Q::Status).await;
    let e = perioden_einheiten(&w.pool, w.e).await.unwrap();
    assert_eq!(e.len(), 1);
    assert_eq!(e[0].einheit_id, w.f1);
    assert!(e.iter().all(|x| x.einheit_id != f2));
    let p = perioden_personal(&w.pool, w.e).await.unwrap();
    assert_eq!(p.len(), 3, "Fan-out");
    assert_eq!(p[0].perioden[0].anker, Alarmierung);
}

#[test]
fn etb_texte_in_der_org_zone() {
    let tz: Tz = "Europe/Berlin".parse().unwrap();
    // 04:40 UTC = 06:40 MESZ
    let s = etb_text_nachtrag(
        Kraft::Einheit(1),
        "Florian 1",
        Eintreffen,
        "2026-09-30 04:40:00",
        tz,
    );
    assert_eq!(
        s,
        "Zeitachse: Einheit «Florian 1» eingetroffen 30.09. 06:40 (nachgetragen)"
    );
    let s = etb_text_streichung(
        Kraft::Person(1),
        "Anna",
        Alarmierung,
        "2026-09-30 04:10:00",
        "Zeit verwechselt",
        tz,
    );
    assert_eq!(
        s,
        "Zeitachse: Person «Anna» alarmiert 30.09. 06:10 gestrichen — Grund: Zeit verwechselt"
    );
}

// ── Append-only (Task 2.4) ──────────────────────────────────────────────────────────────────

/// Außer der Streichung schreibt das Repo kein UPDATE und kein DELETE. Die Streichung setzt
/// genau die Streich-Spalten und nur an einem noch nicht gestrichenen Ereignis.
#[test]
fn repo_ist_append_only() {
    let quelle = include_str!("../repo.rs");
    // Nur Code, keine Kommentare: die Doku nennt „UPDATE" und „DELETE" beim Namen.
    let sql_teil: String = quelle
        .split("#[cfg(test)]")
        .next()
        .unwrap()
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    let sql_teil = sql_teil.as_str();
    assert!(
        !sql_teil.contains("DELETE"),
        "zeitachse::repo darf nichts löschen"
    );
    let updates: Vec<&str> = sql_teil
        .match_indices("UPDATE ")
        .map(|(i, _)| &sql_teil[i..])
        .collect();
    assert_eq!(updates.len(), 1, "genau ein UPDATE (die Streichung)");
    let update = &updates[0][..updates[0].find("\",").unwrap()];
    assert!(update
        .contains("SET gestrichen_at = datetime('now'), gestrichen_von = ?, streichgrund = ?"));
    assert!(update.contains("WHERE id = ? AND gestrichen_at IS NULL"));
    assert!(!update.contains(" art "), "{update}");
}

// ── Schema (Task 1.1) ───────────────────────────────────────────────────────────────────────

/// Genau eine Kraft je Zeile: beide oder keine scheitern am CHECK.
#[tokio::test]
async fn check_verlangt_genau_eine_kraft() {
    let w = welt().await;
    for (einheit, person) in [(Some(w.f1), Some(w.p[0])), (None, None)] {
        let r = sqlx::query(
            "INSERT INTO einsatz_kraft_zeitachse \
                (einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, erfasst_von) \
             VALUES (?, ?, ?, 'eintreffen', '2026-09-30 06:40:00', 'nachtrag', ?)",
        )
        .bind(w.e)
        .bind(einheit)
        .bind(person)
        .bind(w.b)
        .execute(&w.pool)
        .await;
        assert!(r.is_err(), "einheit={einheit:?} person={person:?}");
    }
}

#[tokio::test]
async fn check_kennt_nur_bekannte_arten_und_marken() {
    let w = welt().await;
    let r = sqlx::query(
        "INSERT INTO einsatz_kraft_zeitachse \
            (einsatz_id, einheit_id, art, zeitpunkt_at, quelle, erfasst_von) \
         VALUES (?, ?, 'pause', '2026-09-30 06:40:00', 'nachtrag', ?)",
    )
    .bind(w.e)
    .bind(w.f1)
    .bind(w.b)
    .execute(&w.pool)
    .await;
    assert!(r.is_err());
    let r = sqlx::query(
        "INSERT INTO personal_status (org_id, label, kategorie, zeitachse_marke) \
         VALUES (1, 'x', 'gebunden', 'abloesung')",
    )
    .execute(&w.pool)
    .await;
    assert!(r.is_err(), "abloesung ist keine Marke");
}

/// Wird die Einheit aufgelöst, bleibt die Zeitachse ihrer Personen stehen (SET NULL).
#[tokio::test]
async fn einheit_loeschen_laesst_personen_zeitachse_stehen() {
    let w = welt().await;
    schreibe(&w, Kraft::Einheit(w.f1), Eintreffen, "06:40", Q::Status).await;
    // Wie `einheit::repo::loese_auf_tx`: erst die Mitglieder lösen, dann löschen.
    sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE einheit_id = ?")
        .bind(w.f1)
        .execute(&w.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM einsatz_einheit WHERE id = ?")
        .bind(w.f1)
        .execute(&w.pool)
        .await
        .unwrap();
    let z = laden(&w.pool, w.e, Kraft::Person(w.p[0])).await.unwrap();
    assert_eq!(z.ereignisse.len(), 1);
    assert_eq!(z.ereignisse[0].ursprung_id, None);
}
