//! Abbildung von Kennungen zwischen Führer und Spiegel (design.md D5).
//!
//! - Einsatzzeilen bildet die spiegelnde Seite über `spiegel_herkunft` ab ([`einsatz_lokal`]).
//! - Stammdaten und Konten bildet die meldende Seite ab, denn nur sie hält
//!   `stammdaten_herkunft` ([`stammdaten_fremd`], [`stammdaten_lokal`]).
//! - Ein Konto ohne Gegenstück zeigt auf einen Stellvertreter ([`stellvertreter`]).

use super::paket::KontoAngabe;
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
/// Absender kennt, sonst die Herkunft der Stammdaten (nur meldende Seite), sonst ein
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
    if let Some(id) = angabe.gegen_id {
        let gibt: Option<i64> = sqlx::query_scalar("SELECT id FROM benutzer WHERE id = ?")
            .bind(id)
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
