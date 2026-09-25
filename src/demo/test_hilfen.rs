//! Gemeinsame Aufbau- und Auslesehelfer der Demo-Tests (LFH-690). Sie liegen hier statt in
//! einer Testdatei, damit Löschweg und Import dieselbe Zeilenvergleichs-Mechanik nutzen.

use sqlx::SqlitePool;

pub(super) async fn org_anlegen(pool: &SqlitePool, id: i64) {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (?, ?)")
        .bind(id)
        .bind(format!("Org {id}"))
        .execute(pool)
        .await
        .unwrap();
}

/// Die Kataloge einer Org, wie `bootstrap_admin` sie für eine neue Org anlegt.
pub(super) async fn kataloge_seeden(pool: &SqlitePool, org_id: i64) {
    for (label, kategorie, fms_anker, sortier) in crate::fahrzeug::STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(fms_anker)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, sortier) in crate::personal::QUALIFIKATION_STARTLISTE {
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?)")
            .bind(org_id)
            .bind(label)
            .bind(sortier)
            .execute(pool)
            .await
            .unwrap();
    }
    for (label, kategorie, sortier) in crate::personal::PERSONAL_STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, f, u, m, sortier) in crate::einheit::EINHEIT_TYP_STARTLISTE {
        sqlx::query(
            "INSERT INTO einheit_typ \
                (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(f)
        .bind(u)
        .bind(m)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
}

/// Ein System-Admin der Organisation; liefert die Benutzer-ID.
pub(super) async fn admin_anlegen(pool: &SqlitePool, org_id: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, ?, ?, 'x', 'admin') RETURNING id",
    )
    .bind(org_id)
    .bind(format!("Admin {org_id}"))
    .bind(format!("admin-{org_id}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Ein Einsatz über den Betriebsweg (`anlegen_tx`, mit ID-Sperre und Mitgliedschaft).
pub(super) async fn einsatz_anlegen(
    pool: &SqlitePool,
    ersteller_id: i64,
    bezeichnung: &str,
) -> i64 {
    let daten = crate::einsatz::repo::NeuerEinsatzDaten {
        bezeichnung,
        stichwort: None,
        einsatzart: None,
        begonnen_at: None,
    };
    crate::write_retry!(pool, |conn| {
        crate::einsatz::repo::anlegen_tx(conn, &daten, ersteller_id, chrono::Utc::now()).await
    })
    .unwrap()
}

pub(super) async fn fahrzeug_anlegen(pool: &SqlitePool, org_id: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (?, ?) RETURNING id")
        .bind(org_id)
        .bind(funkrufname)
        .fetch_one(pool)
        .await
        .unwrap()
}

pub(super) async fn personal_anlegen(pool: &SqlitePool, org_id: i64, personalnummer: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO personal (org_id, name, personalnummer) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(format!("Name {personalnummer}"))
    .bind(personalnummer)
    .fetch_one(pool)
    .await
    .unwrap()
}

pub(super) async fn material_anlegen(pool: &SqlitePool, org_id: i64, bestandsnummer: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO material (org_id, bezeichnung, bestandsnummer) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(format!("Material {bestandsnummer}"))
    .bind(bestandsnummer)
    .fetch_one(pool)
    .await
    .unwrap()
}

pub(super) async fn kopf_anlegen(pool: &SqlitePool, org_id: i64, einsatz_id: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (?, ?, '{}') RETURNING id",
    )
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Alle Zeilen einer Tabelle unter einer Bedingung mit genau einem Parameter, jede Zeile als
/// Text aus `quote()` aller Spalten, in `rowid`-Reihenfolge. Der Vergleich ist damit
/// zeilengleich statt bloß gleich viele: eine geänderte Spalte fällt auf, nicht nur eine
/// fehlende Zeile.
///
/// `tabelle` und `bedingung` sind feste Literale aus den Demo-Testmodulen, nie Eingabe.
pub(super) async fn zeilen(
    pool: &SqlitePool,
    tabelle: &str,
    bedingung: &str,
    wert: i64,
) -> Vec<String> {
    let spalten: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
            .bind(tabelle)
            .fetch_all(pool)
            .await
            .unwrap();
    assert!(!spalten.is_empty(), "Tabelle {tabelle} hat keine Spalten");
    let ausdruck = spalten
        .iter()
        .map(|s| format!("quote(\"{s}\")"))
        .collect::<Vec<_>>()
        .join(" || '|' || ");
    let sql = format!("SELECT {ausdruck} FROM \"{tabelle}\" WHERE {bedingung} ORDER BY rowid");
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(wert)
        .fetch_all(pool)
        .await
        .unwrap()
}

pub(super) async fn anzahl(pool: &SqlitePool, sql: &'static str, wert: i64) -> i64 {
    sqlx::query_scalar(sql)
        .bind(wert)
        .fetch_one(pool)
        .await
        .unwrap()
}
