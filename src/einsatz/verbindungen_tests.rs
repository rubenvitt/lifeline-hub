//! Tests der Verbindungen an Abschnitt, Einheit und Führungsstelle (LLH-1134).

use super::*;
use axum::http::StatusCode;

fn body(mittel: &str, wert: &str, hinweis: Option<&str>) -> VerbindungBody {
    VerbindungBody {
        mittel: mittel.into(),
        wert: wert.into(),
        hinweis: hinweis.map(Into::into),
    }
}

#[test]
fn liste_wird_getrimmt_und_geprueft() {
    let ok = pruefe_liste(vec![
        body(" mobil ", " 0170 1234567 ", Some("  ")),
        body("email", "s6@example.org", Some(" Lagezentrum ")),
    ])
    .unwrap();
    assert_eq!(
        ok,
        vec![
            Verbindung {
                mittel: Verbindungsmittel::Mobil,
                wert: "0170 1234567".into(),
                hinweis: None,
            },
            Verbindung {
                mittel: Verbindungsmittel::Email,
                wert: "s6@example.org".into(),
                hinweis: Some("Lagezentrum".into()),
            },
        ]
    );
    for falsch in [
        vec![body("digitalfunk", "4711", None)],
        vec![body("mobil", "   ", None)],
        vec![body("mobil", &"1".repeat(VERBINDUNG_TEXT_MAX + 1), None)],
        vec![body(
            "mobil",
            "1",
            Some(&"h".repeat(VERBINDUNG_TEXT_MAX + 1)),
        )],
        (0..=VERBINDUNGEN_MAX)
            .map(|i| body("festnetz", &i.to_string(), None))
            .collect(),
    ] {
        let err = pruefe_liste(falsch).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{err:?}");
    }
    assert!(pruefe_liste(Vec::new()).unwrap().is_empty());
}

#[test]
fn altfelder_sind_400() {
    assert!(lehne_altfelder_ab(false, false).is_ok());
    for (k, e) in [(true, false), (false, true), (true, true)] {
        assert_eq!(
            lehne_altfelder_ab(k, e).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
    }
}

async fn einsatz_mit_abschnitt_und_einheit(pool: &SqlitePool) -> (i64, i64, i64) {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap();
    let einheit: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Zug 1') RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap();
    (einsatz, abschnitt, einheit)
}

fn v(mittel: Verbindungsmittel, wert: &str) -> Verbindung {
    Verbindung {
        mittel,
        wert: wert.into(),
        hinweis: None,
    }
}

/// Ersetzen trifft nur den eigenen Bezug, hält die Eingabefolge und räumt per Kaskade mit, wenn
/// der Datensatz geht.
#[tokio::test]
async fn ersetzen_trifft_nur_den_bezug_und_kaskadiert() {
    let pool = crate::db::test_pool().await;
    let (e, a, h) = einsatz_mit_abschnitt_und_einheit(&pool).await;
    ersetzen(
        &pool,
        e,
        Bezug::Abschnitt(a),
        &[
            v(Verbindungsmittel::Mobil, "0170 1"),
            v(Verbindungsmittel::Fax, "05 11"),
        ],
    )
    .await
    .unwrap();
    ersetzen(
        &pool,
        e,
        Bezug::Einheit(h),
        &[v(Verbindungsmittel::Festnetz, "05 22")],
    )
    .await
    .unwrap();
    ersetzen(
        &pool,
        e,
        Bezug::Fuehrungsstelle,
        &[v(Verbindungsmittel::Email, "elw@example.org")],
    )
    .await
    .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let ab = lade_map(&mut conn, e, Bezug::Abschnitt(0)).await.unwrap();
    let werte: Vec<_> = ab[&a].iter().map(|v| v.wert.as_str()).collect();
    assert_eq!(werte, ["0170 1", "05 11"]);
    let eh = lade_map(&mut conn, e, Bezug::Einheit(0)).await.unwrap();
    assert_eq!(eh[&h][0].mittel, Verbindungsmittel::Festnetz);
    assert_eq!(
        lade_fuehrungsstelle(&mut conn, e).await.unwrap()[0].wert,
        "elw@example.org"
    );
    drop(conn);

    // Ersetzen der Einheit lässt Abschnitt und Führungsstelle stehen.
    ersetzen(&pool, e, Bezug::Einheit(h), &[]).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_verbindung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 3);

    sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_verbindung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "nur die Führungsstelle bleibt");
}

/// Der CHECK bindet den Bezug an genau die passende Spalte.
#[tokio::test]
async fn bezug_und_spalte_passen_zusammen() {
    let pool = crate::db::test_pool().await;
    let (e, a, h) = einsatz_mit_abschnitt_und_einheit(&pool).await;
    for (bezug, abschnitt, einheit) in [
        ("abschnitt", None, None),
        ("abschnitt", Some(a), Some(h)),
        ("einheit", Some(a), None),
        ("fuehrungsstelle", Some(a), None),
    ] {
        let r = sqlx::query(
            "INSERT INTO einsatz_verbindung \
               (einsatz_id, bezug, abschnitt_id, einheit_id, mittel, wert, sortier) \
             VALUES (?, ?, ?, ?, 'mobil', '1', 1)",
        )
        .bind(e)
        .bind(bezug)
        .bind(abschnitt)
        .bind(einheit)
        .execute(&pool)
        .await;
        assert!(r.is_err(), "{bezug} {abschnitt:?} {einheit:?}");
    }
}

/// Akzeptanzkriterium LLH-1134: die Migration 0248 überführt `erreichbarkeit` verlustfrei — je
/// nach `kommunikationsmittel` zu Mobil bzw. Festnetz, sonst (Digitalfunk, leer, Altwert) zu
/// Sonstiges; Digitalfunk ohne Nummer und eine leere Erreichbarkeit ergeben keine Verbindung.
/// Danach entfernt LLH-1418 die Altspalten; die überführten Verbindungen bleiben.
#[tokio::test]
async fn ueberfuehrung_erreichbarkeit_zu_verbindungen() {
    use sqlx::migrate::Migrator;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::borrow::Cow;

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .foreign_keys(true),
        )
        .await
        .unwrap();
    let alle = sqlx::migrate!("./migrations");
    let bis = |hoechste: i64| Migrator {
        migrations: Cow::Owned(
            alle.iter()
                .filter(|m| m.version <= hoechste)
                .cloned()
                .collect(),
        ),
        ..Migrator::DEFAULT
    };
    bis(247).run(&pool).await.unwrap();
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Bestand')")
        .execute(&pool)
        .await
        .unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    // (Name, kommunikationsmittel, erreichbarkeit) je Abschnitt und je Einheit.
    let faelle: [(&str, Option<&str>, Option<&str>); 6] = [
        ("Mobil", Some("mobil"), Some(" 0170 1111111 ")),
        ("Festnetz", Some("festnetz"), Some("0511 222")),
        ("Digitalfunk", Some("digitalfunk"), Some("ISSI 4711")),
        ("Leer", None, Some("über ELW")),
        ("Funk ohne Nummer", Some("digitalfunk"), None),
        ("Nur Leerzeichen", Some("mobil"), Some("   ")),
    ];
    for (name, mittel, wert) in faelle {
        for tabelle in ["einsatzabschnitt", "einsatz_einheit"] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO {tabelle} (einsatz_id, name, kommunikationsmittel, erreichbarkeit) \
                 VALUES (?, ?, ?, ?)"
            )))
            .bind(einsatz)
            .bind(name)
            .bind(mittel)
            .bind(wert)
            .execute(&pool)
            .await
            .unwrap();
        }
    }
    sqlx::query(
        "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, rufname, kommunikationsmittel, \
           erreichbarkeit) VALUES (?, 'Florian 10/1', 'festnetz', '0511 999')",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    bis(248).run(&pool).await.unwrap();
    // Nach der Überführung stehen die alten Spalten noch (nicht mehr geschrieben).
    let alt: Option<String> =
        sqlx::query_scalar("SELECT erreichbarkeit FROM einsatz_einheit WHERE name = 'Mobil'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(alt.as_deref(), Some(" 0170 1111111 "));

    alle.run(&pool).await.unwrap();

    let erwartet = [
        ("Mobil", "mobil", "0170 1111111"),
        ("Festnetz", "festnetz", "0511 222"),
        ("Digitalfunk", "sonstiges", "ISSI 4711"),
        ("Leer", "sonstiges", "über ELW"),
    ];
    for (tabelle, spalte) in [
        ("einsatzabschnitt", "abschnitt_id"),
        ("einsatz_einheit", "einheit_id"),
    ] {
        let ist: Vec<(String, String, String, Option<String>)> =
            sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT t.name, v.mittel, v.wert, v.hinweis FROM einsatz_verbindung v \
                 JOIN {tabelle} t ON t.id = v.{spalte} ORDER BY t.id"
            )))
            .fetch_all(&pool)
            .await
            .unwrap();
        let ist: Vec<(&str, &str, &str)> = ist
            .iter()
            .map(|(n, m, w, h)| {
                assert_eq!(*h, None, "kein erfundener Hinweis");
                (n.as_str(), m.as_str(), w.as_str())
            })
            .collect();
        assert_eq!(ist, erwartet, "{tabelle}");
    }
    let fs: Vec<(String, String, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT mittel, wert, abschnitt_id, einheit_id FROM einsatz_verbindung \
         WHERE bezug = 'fuehrungsstelle'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(fs, [("festnetz".into(), "0511 999".into(), None, None)]);
    // LLH-1418: die alten Spalten sind an allen drei Tabellen entfernt.
    for tabelle in [
        "einsatzabschnitt",
        "einsatz_einheit",
        "einsatz_fuehrungsstelle",
    ] {
        let spalten: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT name FROM pragma_table_info('{tabelle}')"
        )))
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(
            !spalten
                .iter()
                .any(|s| s == "kommunikationsmittel" || s == "erreichbarkeit"),
            "{tabelle}: {spalten:?}"
        );
    }
    // Der Abschnitt hat jetzt einen Rufnamen, leer für den Bestand.
    let rufnamen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt WHERE rufname IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rufnamen, 0);
}
