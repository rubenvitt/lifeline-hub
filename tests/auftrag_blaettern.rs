//! Aufträge nach Phase, seitenweise, Kennzahlen und Einzelabruf (LFH-1071, Spec
//! `auftraege-blaettern`).

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::collections::HashSet;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

fn auftrag(text: &str, richtung: &str) -> Value {
    json!({
        "auftrag_text": text,
        "richtung": richtung,
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" }],
    })
}

/// Legt `n` Aufträge an und liefert ihre ids in Anlagereihenfolge.
async fn anlegen(app: &axum::Router, cookie: &str, e: i64, n: usize, richtung: &str) -> Vec<i64> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        let (s, v) = anfrage_json(
            app,
            "POST",
            &format!("/api/einsaetze/{e}/auftraege"),
            cookie,
            Some(&auftrag(&format!("Auftrag {i}"), richtung)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        ids.push(v["id"].as_i64().unwrap());
    }
    ids
}

/// Nimmt Aufträge direkt ab, mit gestaffeltem Zeitpunkt.
async fn abnehmen(pool: &sqlx::SqlitePool, ids: &[i64], zeit: impl Fn(usize) -> String) {
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE auftrag SET abgenommen_at = ? WHERE id = ?")
            .bind(zeit(i))
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }
}

/// Setzt die Vollzugs-Achse eines Auftrags direkt auf `vollzogen` zum Zeitpunkt `zeit`.
async fn vollziehen(pool: &sqlx::SqlitePool, id: i64, zeit: &str) {
    let geaendert = sqlx::query(
        "UPDATE kommunikation_status SET vollzug_status = 'vollzogen', vollzogen_at = ? \
         WHERE objekt_typ = 'auftrag' AND objekt_id = ?",
    )
    .bind(zeit)
    .bind(id)
    .execute(pool)
    .await
    .unwrap()
    .rows_affected();
    if geaendert == 0 {
        sqlx::query(
            "INSERT INTO kommunikation_status \
               (org_id, einsatz_id, objekt_typ, objekt_id, vollzug_status, vollzogen_at) \
             SELECT e.org_id, a.einsatz_id, 'auftrag', a.id, 'vollzogen', ? \
             FROM auftrag a JOIN einsatz e ON e.id = a.einsatz_id WHERE a.id = ?",
        )
        .bind(zeit)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }
}

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap_or_else(|| panic!("Liste erwartet: {v}"))
        .iter()
        .map(|a| a["id"].as_i64().unwrap())
        .collect()
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", pfad, cookie, None).await
}

#[tokio::test]
async fn phase_trennt_offen_und_abgeschlossen_ohne_phase_bleibt_alles() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 6, "intern").await;
    abnehmen(&pool, &alle[..2], |i| format!("2026-10-01 10:0{i}:00")).await;
    // Vollzogen, aber nicht abgenommen: zählt ebenfalls als abgeschlossen. Zeitpunkt zwischen den
    // beiden Abnahmen.
    vollziehen(&pool, alle[2], "2026-10-01 10:00:30").await;
    // In Bearbeitung bleibt offen.
    sqlx::query(
        "UPDATE kommunikation_status SET vollzug_status = 'in_arbeit' \
         WHERE objekt_typ = 'auftrag' AND objekt_id = ?",
    )
    .bind(alle[3])
    .execute(&pool)
    .await
    .unwrap();

    let basis = format!("/api/einsaetze/{e}/auftraege");
    let (s, v) = get(&app, &admin, &format!("{basis}?phase=offen")).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        ids(&v).into_iter().collect::<HashSet<_>>(),
        alle[3..].iter().copied().collect(),
        "offen und in Bearbeitung"
    );

    let (_, v) = get(&app, &admin, &format!("{basis}?phase=abgeschlossen")).await;
    assert_eq!(
        ids(&v),
        vec![alle[1], alle[2], alle[0]],
        "zuletzt abgeschlossen oben, Vollzug zählt ohne Abnahme"
    );
    assert_eq!(v[0]["empfaenger"].as_array().unwrap().len(), 1);

    let (_, v) = get(&app, &admin, &basis).await;
    assert_eq!(ids(&v).len(), 6, "ohne Phase wie bisher alles");

    // Status-Filter und Phase lassen sich kombinieren.
    let (_, v) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&status=vollzogen"),
    )
    .await;
    assert_eq!(ids(&v), vec![alle[2]]);
}

#[tokio::test]
async fn unbekannte_phase_ist_400_und_cursor_ohne_abgeschlossen_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{e}/auftraege");

    let (s, _) = get(&app, &admin, &format!("{basis}?phase=alle")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = get(&app, &admin, &format!("{basis}?phase=offen&limit=5")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?vor_id=3&vor_zeit=2026-10-01"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&vor_id=3"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "halber Cursor");
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&vor_id=3&vor_zeit=2026-10-01T10:00:00"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Cursor nicht kanonisch");
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?abschnitt_id=1&einheit_id=1"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "zwei Empfänger-Filter");
}

#[tokio::test]
async fn erste_seite_hat_die_vorgabe_und_die_klemme_greift() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 105, "intern").await;
    abnehmen(&pool, &alle, |i| {
        format!("2026-10-01 {:02}:{:02}:00", 10 + i / 60, i % 60)
    })
    .await;
    let basis = format!("/api/einsaetze/{e}/auftraege?phase=abgeschlossen");

    let (_, v) = get(&app, &admin, &basis).await;
    let seite = ids(&v);
    assert_eq!(seite.len(), 100, "Vorgabe 100");
    assert_eq!(seite[0], alle[104], "zuletzt abgenommen zuerst");

    let (_, v) = get(&app, &admin, &format!("{basis}&limit=5000")).await;
    assert_eq!(ids(&v).len(), 105, "geklemmt auf 500, hier alle");
    let (_, v) = get(&app, &admin, &format!("{basis}&limit=0")).await;
    assert_eq!(ids(&v).len(), 1, "geklemmt auf 1");
}

#[tokio::test]
async fn folgeseiten_sind_lueckenlos_und_ueberschneidungsfrei_bei_gleichstand() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 23, "intern").await;
    // Je drei Aufträge teilen sich einen Zeitpunkt: ohne Kennung im Cursor fielen sie zwischen
    // zwei Seiten heraus oder kämen doppelt.
    abnehmen(&pool, &alle, |i| format!("2026-10-01 10:{:02}:00", i / 3)).await;

    let basis = format!("/api/einsaetze/{e}/auftraege?phase=abgeschlossen&limit=4");
    let mut gesehen = Vec::new();
    let mut pfad = basis.clone();
    loop {
        let (s, v) = get(&app, &admin, &pfad).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let seite = v.as_array().unwrap().clone();
        if seite.is_empty() {
            break;
        }
        let letzte = seite.last().unwrap();
        let zeit = letzte["abgenommen_at"]
            .as_str()
            .unwrap()
            .replace(' ', "%20");
        let id = letzte["id"].as_i64().unwrap();
        gesehen.extend(seite.iter().map(|a| a["id"].as_i64().unwrap()));
        pfad = format!("{basis}&vor_zeit={zeit}&vor_id={id}");
    }
    assert_eq!(gesehen.len(), alle.len(), "jeder genau einmal: {gesehen:?}");
    assert_eq!(
        gesehen.iter().copied().collect::<HashSet<_>>(),
        alle.iter().copied().collect()
    );
}

#[tokio::test]
async fn richtung_und_empfaenger_wirken_in_jeder_phase_und_in_den_kennzahlen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let intern = anlegen(&app, &admin, e, 3, "intern").await;
    let extern_ = anlegen(&app, &admin, e, 4, "extern").await;
    abnehmen(&pool, &intern[..1], |_| "2026-10-01 10:00:00".into()).await;
    abnehmen(&pool, &extern_[..3], |i| format!("2026-10-01 11:0{i}:00")).await;

    let basis = format!("/api/einsaetze/{e}/auftraege");
    let (_, v) = get(
        &app,
        &admin,
        &format!("{basis}?phase=offen&richtung=extern"),
    )
    .await;
    assert_eq!(ids(&v), vec![extern_[3]]);
    let (_, v) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&richtung=extern"),
    )
    .await;
    assert_eq!(ids(&v), vec![extern_[2], extern_[1], extern_[0]]);

    // Kennzahlen gleich der Auszählung der Vollliste, mit und ohne Filter.
    for filter in [
        "",
        "?richtung=extern",
        "?richtung=intern",
        "?abschnitt_id=1",
    ] {
        let (s, k) = get(&app, &admin, &format!("{basis}/kennzahlen{filter}")).await;
        assert_eq!(s, StatusCode::OK, "{k}");
        let (_, liste) = get(&app, &admin, &format!("{basis}{filter}")).await;
        let liste = liste.as_array().unwrap();
        let abgeschlossen = liste
            .iter()
            .filter(|a| {
                matches!(
                    a["bearbeitungsstatus"].as_str(),
                    Some("vollzogen" | "abgenommen")
                )
            })
            .count() as i64;
        assert_eq!(k["abgeschlossen"], abgeschlossen, "Filter {filter:?}");
        assert_eq!(
            k["offen"],
            liste.len() as i64 - abgeschlossen,
            "Filter {filter:?}"
        );
    }
    let (_, k) = get(&app, &admin, &format!("{basis}/kennzahlen")).await;
    assert_eq!(k, json!({ "offen": 3, "abgeschlossen": 4 }));

    let (s, _) = get(&app, &admin, &format!("{basis}/kennzahlen?richtung=quer")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einzelabruf_liefert_den_auftrag_und_fremder_einsatz_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eigen = anlegen(&app, &admin, e, 1, "intern").await[0];
    let fremd = anlegen(&app, &admin, anderer, 1, "intern").await[0];

    let (s, v) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/auftraege/{eigen}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["id"], eigen);
    assert_eq!(v["empfaenger"][0]["snap_anzeige"], "Abschnitt Nord");

    let (s, _) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/auftraege/{fremd}"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/auftraege/999999"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn beobachter_liest_kennzahlen_und_einzelabruf_wie_die_liste() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = anlegen(&app, &admin, e, 1, "intern").await[0];
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let beob = login_cookie(&app, "erika", "erikapw1").await;

    for pfad in [
        format!("/api/einsaetze/{e}/auftraege?phase=abgeschlossen"),
        format!("/api/einsaetze/{e}/auftraege/kennzahlen"),
        format!("/api/einsaetze/{e}/auftraege/{a}"),
    ] {
        let (s, v) = get(&app, &beob, &pfad).await;
        assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    }
}
