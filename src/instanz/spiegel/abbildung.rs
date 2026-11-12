//! Abbildung von Kennungen zwischen Führer und Spiegel (design.md D5).
//!
//! - Einsatzzeilen bildet die spiegelnde Seite über `spiegel_herkunft` ab ([`einsatz_lokal`]).
//! - Stammdaten und Konten bildet die meldende Seite ab, denn nur sie hält
//!   `stammdaten_herkunft` ([`stammdaten_fremd`], [`stammdaten_lokal`]).
//! - Ein Konto ohne Gegenstück zeigt auf einen Stellvertreter ([`stellvertreter`]).
//! - Vorher versucht jede Seite die Ursprungskennung ([`nach_ursprung`], LLH-1497): Zeilen aus
//!   derselben Quelle gelten als dieselben, auch über eine Direktkopplung ohne Stammdaten.

use super::paket::KontoAngabe;
use crate::error::AppError;
use crate::instanz::stammdaten::StammdatenArt;
use sqlx::SqliteConnection;

/// Kennung einer lokalen Stammdatenzeile beim Gegenüber (lokal → fremd), nur an der meldenden
/// Seite bekannt.
pub async fn stammdaten_fremd(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    art: StammdatenArt,
    lokal: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let fremd: Option<String> = sqlx::query_scalar(
        "SELECT fremder_schluessel FROM stammdaten_herkunft \
         WHERE kopplung_org_id = ? AND art = ? AND lokaler_schluessel = ?",
    )
    .bind(kopplung_org_id)
    .bind(art.as_str())
    .bind(lokal.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(fremd.and_then(|f| f.parse().ok()))
}

/// Lokale Kennung einer Stammdatenzeile des Gegenübers (fremd → lokal), nur an der meldenden
/// Seite bekannt.
pub async fn stammdaten_lokal(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    art: StammdatenArt,
    fremd: i64,
) -> Result<Option<i64>, sqlx::Error> {
    let lokal: Option<String> = sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM stammdaten_herkunft \
         WHERE kopplung_org_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(kopplung_org_id)
    .bind(art.as_str())
    .bind(fremd.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(lokal.and_then(|l| l.parse().ok()))
}

/// Lokaler Schlüssel einer Zeile eines Spiegels (`spiegel_herkunft`).
pub async fn einsatz_lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    art: &str,
    fremd: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM spiegel_herkunft \
         WHERE einsatz_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(fremd)
    .fetch_optional(&mut *conn)
    .await
}

/// Ist das Konto ein Stellvertreter, dann seine Kennung beim Gegenüber dieser Kopplung.
pub async fn stellvertreter_fremd(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    benutzer_id: i64,
) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT fremde_id FROM spiegel_konto WHERE kopplung_id = ? AND benutzer_id = ?",
    )
    .bind(kopplung_id)
    .bind(benutzer_id)
    .fetch_optional(&mut *conn)
    .await
}

/// Lokales Konto für ein Konto des Gegenübers (D5, Nachtrag 10.11.2026): die Kennung, die der
/// Absender kennt (nur ein echtes Konto der Org des Einsatzes), sonst die Herkunft der Stammdaten (nur meldende Seite), sonst ein
/// Stellvertreter. Der Stellvertreter kann sich nie anmelden (`aktiv = 0`, Platzhalter-Hash) und
/// trägt den Anzeigenamen des Gegenübers, auch nach einer Umbenennung dort.
pub async fn konto_lokal(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    kopplung_org_id: i64,
    org_id: i64,
    meldend: bool,
    angabe: &KontoAngabe,
) -> Result<i64, sqlx::Error> {
    // Die Kennung des Absenders zählt nur für ein echtes Konto der Org des Einsatzes: nie für ein
    // Konto einer anderen Org und nie für einen Stellvertreter (auch nicht einer anderen Kopplung)
    // oder ein Platzhalter eines eingespielten Archivs (das Einspielen trägt seine eigenen erst nach
    // der Übernahme in `archiv_konto` ein).
    if let Some(id) = angabe.gegen_id {
        let gibt: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT b.id FROM benutzer b WHERE b.id = ? AND b.org_id = ? \
             AND {}",
            super::OHNE_STELLVERTRETER
        )))
        .bind(id)
        .bind(org_id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(id) = gibt {
            return Ok(id);
        }
    }
    if meldend {
        if let Some(id) =
            stammdaten_lokal(conn, kopplung_org_id, StammdatenArt::Konto, angabe.id).await?
        {
            return Ok(id);
        }
    }
    if let Some(u) = &angabe.ursprung {
        if let Some(id) = nach_ursprung(conn, org_id, StammdatenArt::Konto, u)
            .await
            .map_err(|e| match e {
                AppError::Database(d) => d,
                andere => sqlx::Error::Protocol(andere.to_string()),
            })?
        {
            return Ok(id);
        }
    }
    stellvertreter(conn, kopplung_id, org_id, angabe).await
}

/// Legt den Stellvertreter an oder zieht seinen Anzeigenamen nach.
pub async fn stellvertreter(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    org_id: i64,
    angabe: &KontoAngabe,
) -> Result<i64, sqlx::Error> {
    let name = angabe.anzeigename.chars().take(200).collect::<String>();
    let vorhanden: Option<i64> = sqlx::query_scalar(
        "SELECT benutzer_id FROM spiegel_konto WHERE kopplung_id = ? AND fremde_id = ?",
    )
    .bind(kopplung_id)
    .bind(angabe.id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = vorhanden {
        sqlx::query("UPDATE benutzer SET anzeigename = ? WHERE id = ? AND anzeigename IS NOT ?")
            .bind(&name)
            .bind(id)
            .bind(&name)
            .execute(&mut *conn)
            .await?;
        return Ok(id);
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
         aktiv, erstellt_at, org_rolle) VALUES (?, ?, ?, ?, 'keiner', 0, ?, 'keine') RETURNING id",
    )
    .bind(org_id)
    .bind(&name)
    .bind(format!("spiegel:{kopplung_id}:{}", angabe.id))
    .bind(crate::auth::PASSWORT_HASH_KEIN_LOKALES)
    .bind(crate::zeit::jetzt())
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("INSERT INTO spiegel_konto (kopplung_id, fremde_id, benutzer_id) VALUES (?, ?, ?)")
        .bind(kopplung_id)
        .bind(angabe.id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(id)
}

/// Ursprungskennung einer eigenen Stammdatenzeile (LLH-1497, design.md D5): die übernommene,
/// sonst die eigene Instanz mit der lokalen ID. Eine ID ist je Tabelle eindeutig, darum ohne Org.
pub async fn ursprung(
    conn: &mut SqliteConnection,
    art: StammdatenArt,
    id: i64,
) -> Result<String, sqlx::Error> {
    let gespeichert: Option<Option<String>> = sqlx::query_scalar(
        "SELECT ursprung FROM stammdaten_herkunft WHERE art = ? AND lokaler_schluessel = ? \
         ORDER BY id LIMIT 1",
    )
    .bind(art.as_str())
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(Some(u)) = gespeichert {
        return Ok(u);
    }
    let ich: String = sqlx::query_scalar("SELECT kennung FROM instanz_identitaet")
        .fetch_one(&mut *conn)
        .await?;
    Ok(format!("{ich}/{id}"))
}

/// Ursprungskennung eines Kontos; `None` für einen Stellvertreter (er ist nie ein echtes Konto).
pub async fn konto_ursprung(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<String>, sqlx::Error> {
    let stellvertreter: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM spiegel_konto WHERE benutzer_id = ?)")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    if stellvertreter {
        return Ok(None);
    }
    Ok(Some(ursprung(conn, StammdatenArt::Konto, id).await?))
}

/// Die eigene Zeile der Org `org_id` mit dieser Ursprungskennung (LLH-1497, design.md D5): eigenes
/// Präfix → die lokale Zeile, sonst die übernommene. Nur eine Zeile, die es in der Org gibt; ein
/// Konto nur, wenn es kein Stellvertreter ist.
pub async fn nach_ursprung(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: StammdatenArt,
    ursprung: &str,
) -> Result<Option<i64>, AppError> {
    let Some(lokal) =
        crate::instanz::stammdaten::herkunft::find_nach_ursprung(conn, org_id, art, ursprung)
            .await?
    else {
        return Ok(None);
    };
    let Ok(id) = lokal.parse::<i64>() else {
        return Ok(None);
    };
    let tabelle = crate::instanz::stammdaten::art::beschreibung(art).tabelle;
    let gibt: bool = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT EXISTS (SELECT 1 FROM {tabelle} WHERE id = ? AND org_id = ?)"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if !gibt {
        return Ok(None);
    }
    if art == StammdatenArt::Konto && konto_ursprung(conn, id).await?.is_none() {
        return Ok(None);
    }
    Ok(Some(id))
}
