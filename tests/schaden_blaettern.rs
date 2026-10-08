//! Schadenliste seitenweise, mit Filtern, Suche, Sortierung, Kennzahlen und Auswahl (LFH-1075,
//! Spec `schaden-liste-blaettern`, `listen-projektion`).

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::collections::HashSet;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

const TYPEN: [&str; 3] = ["sachschaden", "umweltschaden", "infrastruktur"];
const AUSMASSE: [&str; 4] = ["gering", "mittel", "gross", "katastrophal"];
const ORTE: [&str; 5] = [
    "Hauptstraße 3",
    "am Deich 7",
    "Bahnhof",
    "hauptstraße 9",
    "Zur Mühle 1",
];

/// Legt `n` Schäden mit wiederkehrenden Typen, Ausmaßen, Orten und jedem dritten verortet an.
async fn anlegen(app: &axum::Router, cookie: &str, e: i64, n: usize) -> Vec<i64> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        let mut body = json!({
            "typ": TYPEN[i % TYPEN.len()],
            "ausmass": AUSMASSE[i % AUSMASSE.len()],
            "ort": ORTE[i % ORTE.len()],
            "beschreibung": format!("Lage {i}"),
        });
        if i % 3 == 0 {
            body["lat"] = json!(52.3 + i as f64 * 0.001);
            body["lon"] = json!(9.7);
        }
        let (s, v) = anfrage_json(
            app,
            "POST",
            &format!("/api/einsaetze/{e}/schaeden"),
            cookie,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        ids.push(v["id"].as_i64().unwrap());
    }
    ids
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", pfad, cookie, None).await
}

fn zeilen(v: &Value) -> &Vec<Value> {
    v.as_array()
        .unwrap_or_else(|| panic!("Liste erwartet: {v}"))
}

fn ids(v: &Value) -> Vec<i64> {
    zeilen(v)
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .collect()
}

/// Schlüssel einer Zeile, wie der Server sortiert (Spiegel von `SortSpalte::ausdruck`).
fn schluessel(spalte: &str, s: &Value) -> Value {
    match spalte {
        "nr" => s["registrier_nr"].clone(),
        "typ" => s["typ"].clone(),
        "ausmass" => json!(AUSMASSE.iter().position(|a| *a == s["ausmass"]).unwrap()),
        "ort" => json!(s["ort"].as_str().unwrap().to_lowercase()),
        "erfasst" => s["erfasst_at"].clone(),
        "verortet" => json!(i64::from(!s["lat"].is_null() && !s["lon"].is_null())),
        _ => unreachable!(),
    }
}

/// Cursor-Parameter für die Folgeseite nach `letzte`.
fn cursor(spalte: &str, letzte: &Value) -> String {
    let nr = letzte["registrier_nr"].as_i64().unwrap();
    if spalte == "nr" {
        return format!("&vor_nr={nr}");
    }
    let wert = match spalte {
        "ort" => letzte["ort"].as_str().unwrap().to_string(),
        _ => match schluessel(spalte, letzte) {
            Value::String(t) => t,
            z => z.to_string(),
        },
    };
    format!("&vor_wert={}&vor_nr={nr}", kodiert(&wert))
}

/// Prozentkodierung für einen Query-Wert.
fn kodiert(wert: &str) -> String {
    wert.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Holt alle Seiten der Größe `limit` und liefert die Zeilen in Lesefolge.
async fn alle_seiten(
    app: &axum::Router,
    cookie: &str,
    basis: &str,
    spalte: &str,
    limit: usize,
) -> Vec<Value> {
    let mut alle = Vec::new();
    let mut weiter = String::new();
    for _ in 0..100 {
        let (s, v) = get(app, cookie, &format!("{basis}&limit={limit}{weiter}")).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let seite = zeilen(&v).clone();
        assert!(seite.len() <= limit);
        let fertig = seite.len() < limit;
        if let Some(letzte) = seite.last() {
            weiter = cursor(spalte, letzte);
        }
        alle.extend(seite);
        if fertig {
            return alle;
        }
    }
    panic!("{basis}: kein Ende nach 100 Seiten, der Cursor kommt nicht voran");
}

#[tokio::test]
async fn seiten_ergeben_die_vollliste_in_jeder_sortierung() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let angelegt = anlegen(&app, &admin, e, 23).await;

    let (s, voll) = get(&app, &admin, &format!("/api/einsaetze/{e}/schaeden")).await;
    assert_eq!(s, StatusCode::OK);
    let mut erwartet: Vec<i64> = angelegt.clone();
    erwartet.reverse();
    assert_eq!(
        ids(&voll),
        erwartet,
        "ohne limit vollständig, Nummer absteigend"
    );

    for spalte in ["nr", "typ", "ausmass", "ort", "erfasst", "verortet"] {
        for richtung in ["ab", "auf"] {
            let basis = format!("/api/einsaetze/{e}/schaeden?sortierung={spalte}_{richtung}");
            let seiten = alle_seiten(&app, &admin, &basis, spalte, 4).await;
            let gelesen: Vec<i64> = seiten.iter().map(|s| s["id"].as_i64().unwrap()).collect();
            assert_eq!(
                gelesen.iter().copied().collect::<HashSet<_>>().len(),
                23,
                "{spalte}_{richtung}: ohne Duplikat und Lücke: {gelesen:?}"
            );
            // Folge: Schlüssel, dann Nummer, beides in der Richtung.
            for paar in seiten.windows(2) {
                let (a, b) = (&paar[0], &paar[1]);
                let ka = (schluessel(spalte, a), a["registrier_nr"].as_i64().unwrap());
                let kb = (schluessel(spalte, b), b["registrier_nr"].as_i64().unwrap());
                let geordnet = match (&ka.0, &kb.0) {
                    (Value::Number(x), Value::Number(y)) => {
                        (x.as_i64().unwrap(), ka.1).cmp(&(y.as_i64().unwrap(), kb.1))
                    }
                    (x, y) => (x.as_str().unwrap(), ka.1).cmp(&(y.as_str().unwrap(), kb.1)),
                };
                let erwartet = if richtung == "ab" {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Less
                };
                assert_eq!(geordnet, erwartet, "{spalte}_{richtung}: {ka:?} vor {kb:?}");
            }
        }
    }
}

#[tokio::test]
async fn erste_seite_traegt_die_hoechsten_nummern() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anlegen(&app, &admin, e, 12).await;
    let (s, v) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/schaeden?limit=5"),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let nr: Vec<i64> = zeilen(&v)
        .iter()
        .map(|s| s["registrier_nr"].as_i64().unwrap())
        .collect();
    assert_eq!(nr, vec![12, 11, 10, 9, 8]);
    let (_, v) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/schaeden?limit=0"),
    )
    .await;
    assert_eq!(zeilen(&v).len(), 1, "limit wird auf mindestens 1 geklemmt");
}

#[tokio::test]
async fn unstimmige_parameter_werden_abgelehnt() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = format!("/api/einsaetze/{e}/schaeden");
    for (q, code) in [
        ("vor_nr=3", StatusCode::UNPROCESSABLE_ENTITY),
        ("sortierung=ort_ab", StatusCode::UNPROCESSABLE_ENTITY),
        (
            "limit=5&sortierung=ort_ab&vor_nr=3",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "limit=5&sortierung=ort_ab&vor_wert=x",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            "limit=5&vor_wert=3&vor_nr=3",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        ("limit=5&sortierung=farbe_ab", StatusCode::BAD_REQUEST),
        ("limit=5&sortierung=nr_seitwaerts", StatusCode::BAD_REQUEST),
        (
            "limit=5&sortierung=ausmass_ab&vor_wert=x&vor_nr=3",
            StatusCode::BAD_REQUEST,
        ),
        ("typ=sachschaden,leserbrief", StatusCode::BAD_REQUEST),
        ("verortet=vielleicht", StatusCode::BAD_REQUEST),
    ] {
        let (s, v) = get(&app, &admin, &format!("{b}?{q}")).await;
        assert_eq!(s, code, "{q}: {v}");
    }
}

#[tokio::test]
async fn filter_und_suche_wirken_vor_der_seitengrenze() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let angelegt = anlegen(&app, &admin, e, 20).await;
    // Ein Schaden mit Prozentzeichen und Kontakt als Geschädigtem.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/schaeden"),
        &admin,
        Some(&json!({
            "typ": "sonstige", "ausmass": "gering", "ort": "Lager",
            "beschreibung": "zu 50% geflutet", "geschaedigt_kontakt": "Familie Okonkwo",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let sonder = v["id"].as_i64().unwrap();

    let b = format!("/api/einsaetze/{e}/schaeden");
    let anzahl = |v: &Value| zeilen(v).len();

    // Ort ohne Unterschied der Groß-/Kleinschreibung: „Hauptstraße 3“ und „hauptstraße 9“.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=HAUPTSTR")).await;
    assert_eq!(anzahl(&v), 8);
    // Nummer wie angezeigt.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=S-003")).await;
    assert_eq!(ids(&v), vec![angelegt[2]]);
    // Beschreibung, Prozentzeichen als Text.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=50%25")).await;
    assert_eq!(ids(&v), vec![sonder]);
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=%25")).await;
    assert_eq!(ids(&v), vec![sonder], "% trifft nicht alles");
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=_")).await;
    assert_eq!(anzahl(&v), 0, "_ trifft kein beliebiges Zeichen");
    // Geschädigter.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&q=okonkwo")).await;
    assert_eq!(ids(&v), vec![sonder]);

    // Mehrere Typen: einer muss zutreffen.
    let (_, v) = get(
        &app,
        &admin,
        &format!("{b}?limit=100&typ=sachschaden,umweltschaden"),
    )
    .await;
    assert_eq!(anzahl(&v), 14);
    // Verortet: jeder dritte der 20.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&verortet=ja")).await;
    assert_eq!(anzahl(&v), 7);
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&verortet=nein")).await;
    assert_eq!(anzahl(&v), 14);
    let (_, v) = get(&app, &admin, &format!("{b}?limit=100&verortet=ja,nein")).await;
    assert_eq!(anzahl(&v), 21);

    // Filter vor der Grenze: die erste Seite der Katastrophalen enthält nur Katastrophale.
    let (_, v) = get(&app, &admin, &format!("{b}?limit=2&ausmass=katastrophal")).await;
    assert_eq!(anzahl(&v), 2);
    assert!(zeilen(&v).iter().all(|s| s["ausmass"] == "katastrophal"));
}

#[tokio::test]
async fn kennzahlen_zaehlen_den_bestand_zum_filter() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ids = anlegen(&app, &admin, e, 15).await;
    sqlx::query("UPDATE einsatz_schaden SET status = 'uebergeben', uebergeben_an = 'THW', uebergeben_at = '2026-10-08 08:00:00' WHERE id IN (?, ?)")
        .bind(ids[0])
        .bind(ids[1])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz_schaden SET status = 'abgeschlossen', abschluss_grund = 'behoben', abschluss_at = '2026-10-08 08:00:00' WHERE id = ?")
        .bind(ids[2])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz_schaden SET storniert_at = '2026-10-08 08:00:00' WHERE id = ?")
        .bind(ids[3])
        .execute(&pool)
        .await
        .unwrap();

    let b = format!("/api/einsaetze/{e}/schaeden");
    let (s, k) = get(&app, &admin, &format!("{b}/kennzahlen")).await;
    assert_eq!(s, StatusCode::OK, "{k}");
    assert_eq!(
        k,
        json!({ "gesamt": 14, "offen": 11, "uebergeben": 2, "abgeschlossen": 1 })
    );

    // Dieselbe Treffermenge wie die Liste, je Filter.
    for q in [
        "q=hauptstr",
        "typ=umweltschaden",
        "verortet=ja",
        "ausmass=gering,gross",
    ] {
        let (_, k) = get(&app, &admin, &format!("{b}/kennzahlen?{q}")).await;
        let (_, v) = get(&app, &admin, &format!("{b}?{q}")).await;
        let liste = zeilen(&v);
        assert_eq!(k["gesamt"], json!(liste.len()), "{q}");
        let offen = liste.iter().filter(|s| s["status"] == "offen").count();
        assert_eq!(k["offen"], json!(offen), "{q}");
    }
}

#[tokio::test]
async fn auswahl_ohne_freitext_und_ohne_stornierte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ids = anlegen(&app, &admin, e, 3).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/schaeden"),
        &admin,
        Some(&json!({
            "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstraße 3",
            "beschreibung": "Dach abgedeckt", "geschaedigt_kontakt": "Fam. Beispiel",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let belegt = v["id"].as_i64().unwrap();
    sqlx::query("UPDATE einsatz_schaden SET storniert_at = '2026-10-08 08:00:00' WHERE id = ?")
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();

    let (s, v) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/schaeden/auswahl"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zeilen = zeilen(&v);
    assert_eq!(
        zeilen
            .iter()
            .map(|z| z["id"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![belegt, ids[2], ids[1]],
        "ohne Stornierte, Nummer absteigend"
    );
    let schluessel: HashSet<&str> = zeilen[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        schluessel,
        [
            "id",
            "registrier_nr",
            "status",
            "typ",
            "ausmass",
            "ort",
            "frei"
        ]
        .into_iter()
        .collect()
    );
    assert_eq!(zeilen[0]["frei"], false);
    assert_eq!(zeilen[1]["frei"], true);
    assert!(!v.to_string().contains("Dach") && !v.to_string().contains("Beispiel"));
}

/// Spec `schaden-liste-blaettern`/`listen-projektion`: Kennzahlen und Auswahl hinter derselben
/// Sperre wie die Liste.
#[tokio::test]
async fn kennzahlen_und_auswahl_hinter_dem_modulrecht() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, e, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    let b = format!("/api/einsaetze/{e}/schaeden");
    for pfad in [format!("{b}/kennzahlen"), format!("{b}/auswahl")] {
        let (s, _) = get(&app, &gustav, &pfad).await;
        assert_eq!(s, StatusCode::OK, "Vorbedingung: {pfad} lesbar");
    }
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/schaeden"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {v}");
    for pfad in [b.clone(), format!("{b}/kennzahlen"), format!("{b}/auswahl")] {
        let (s, _) = get(&app, &gustav, &pfad).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}");
    }
}
