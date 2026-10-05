//! Datenzugriff der Gerätekopplung (LFH-892, design.md D1/D3).

use super::{code, Funktionsansicht, GeraetKontext, HOECHSTENS_STUNDEN};
use crate::auth::PASSWORT_HASH_SSO_ONLY;
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    #[wire(ohne_serde)]
    /// Ereignis der Kopplungsspur. Wire-Werte stehen als CHECK in
    /// `migrations/0147_geraet_kopplung.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum KopplungEreignis {
        Angelegt => "angelegt",
        CodeAusgestellt => "code_ausgestellt",
        Eingeloest => "eingeloest",
        Verlaengert => "verlaengert",
        Widerrufen => "widerrufen",
    }
}

/// SQL-Bedingung „Benutzer `b` ist kein Gerätekonto“, für jede Liste und Auswahl von Personen
/// (design.md D1). Erwartet den Alias `b` für `benutzer`.
pub const OHNE_GERAETEKONTEN: &str =
    "NOT EXISTS (SELECT 1 FROM geraet_kopplung gk WHERE gk.benutzer_id = b.id)";

/// Zustand einer Kopplung, aus Sicht der Einsatzleitung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum KopplungStatus {
    /// Angelegt, aber noch kein Code eingelöst.
    Wartend,
    /// Ein Gerät ist gekoppelt.
    Aktiv,
    Abgelaufen,
    Widerrufen,
}

/// Eine Kopplung für die Geräteübersicht der Einsatzleitung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct KopplungAnzeige {
    pub id: i64,
    pub ansicht: Funktionsansicht,
    pub uhs_id: Option<i64>,
    /// Bezeichnung der UHS, falls stellengebunden.
    pub stelle: Option<String>,
    pub bezeichnung: String,
    /// Anzeigename des Gerätekontos, so wie er an Einträgen steht.
    pub anzeigename: String,
    pub status: KopplungStatus,
    pub erstellt_at: String,
    pub erstellt_von_name: String,
    pub laeuft_ab_at: String,
    pub gekoppelt_at: Option<String>,
    pub letzter_zugriff_at: Option<String>,
    pub widerrufen_at: Option<String>,
    pub widerrufen_von_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct KopplungZeile {
    id: i64,
    ansicht: String,
    uhs_id: Option<i64>,
    stelle: Option<String>,
    bezeichnung: String,
    anzeigename: String,
    erstellt_at: String,
    erstellt_von_name: String,
    laeuft_ab_at: String,
    gekoppelt_at: Option<String>,
    letzter_zugriff_at: Option<String>,
    widerrufen_at: Option<String>,
    widerrufen_von_name: Option<String>,
    abgelaufen: bool,
}

impl KopplungZeile {
    fn anzeige(self) -> Result<KopplungAnzeige, AppError> {
        let status = if self.widerrufen_at.is_some() {
            KopplungStatus::Widerrufen
        } else if self.abgelaufen {
            KopplungStatus::Abgelaufen
        } else if self.gekoppelt_at.is_some() {
            KopplungStatus::Aktiv
        } else {
            KopplungStatus::Wartend
        };
        Ok(KopplungAnzeige {
            id: self.id,
            ansicht: Funktionsansicht::parse(&self.ansicht)
                .ok_or_else(|| AppError::Internal(format!("Ansicht {}", self.ansicht)))?,
            uhs_id: self.uhs_id,
            stelle: self.stelle,
            bezeichnung: self.bezeichnung,
            anzeigename: self.anzeigename,
            status,
            erstellt_at: self.erstellt_at,
            erstellt_von_name: self.erstellt_von_name,
            laeuft_ab_at: self.laeuft_ab_at,
            gekoppelt_at: self.gekoppelt_at,
            letzter_zugriff_at: self.letzter_zugriff_at,
            widerrufen_at: self.widerrufen_at,
            widerrufen_von_name: self.widerrufen_von_name,
        })
    }
}

const ANZEIGE_SELECT: &str = "SELECT k.id, k.ansicht, k.uhs_id, u.bezeichnung AS stelle, \
        k.bezeichnung, g.anzeigename, k.erstellt_at, e.anzeigename AS erstellt_von_name, \
        k.laeuft_ab_at, k.gekoppelt_at, k.letzter_zugriff_at, k.widerrufen_at, \
        w.anzeigename AS widerrufen_von_name, (k.laeuft_ab_at <= datetime('now')) AS abgelaufen \
     FROM geraet_kopplung k \
     JOIN benutzer g ON g.id = k.benutzer_id \
     JOIN benutzer e ON e.id = k.erstellt_von \
     LEFT JOIN benutzer w ON w.id = k.widerrufen_von \
     LEFT JOIN uhs u ON u.id = k.uhs_id";

/// Alle Kopplungen eines Einsatzes, neueste zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<KopplungAnzeige>, AppError> {
    let zeilen: Vec<KopplungZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE k.einsatz_id = ? ORDER BY k.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    zeilen.into_iter().map(KopplungZeile::anzeige).collect()
}

/// Eine Kopplung des Einsatzes; fremde oder unbekannte Kopplung → 404.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<KopplungAnzeige, AppError> {
    let zeile: Option<KopplungZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE k.einsatz_id = ? AND k.id = ?"
    )))
    .bind(einsatz_id)
    .bind(kopplung_id)
    .fetch_optional(pool)
    .await?;
    zeile.ok_or(AppError::NotFound)?.anzeige()
}

/// Eingabe für eine neue Kopplung, schon geprüft (Handler).
pub struct NeueKopplung<'a> {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub ansicht: Funktionsansicht,
    pub uhs_id: Option<i64>,
    /// Bezeichnung der UHS für den Anzeigenamen des Gerätekontos.
    pub stelle: Option<&'a str>,
    pub bezeichnung: &'a str,
    pub laeuft_ab_at: &'a str,
    pub von: i64,
}

/// Anzeigename eines Gerätekontos: „Stelle · Gerät“, ohne Stelle nur das Gerät.
pub fn anzeigename(stelle: Option<&str>, bezeichnung: &str) -> String {
    match stelle {
        Some(s) => format!("{s} · {bezeichnung}"),
        None => bezeichnung.to_string(),
    }
}

/// Legt Gerätekonto und Kopplung an (eine Transaktion des Aufrufers). Liefert die Kopplungs-ID.
pub async fn anlegen(conn: &mut SqliteConnection, neu: NeueKopplung<'_>) -> Result<i64, AppError> {
    let benutzername = format!("geraet-{}", uuid::Uuid::new_v4().simple());
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, 'keiner', 'keine') RETURNING id",
    )
    .bind(neu.org_id)
    .bind(anzeigename(neu.stelle, neu.bezeichnung))
    .bind(&benutzername)
    .bind(PASSWORT_HASH_SSO_ONLY)
    .fetch_one(&mut *conn)
    .await?;
    let kopplung_id: i64 = sqlx::query_scalar(
        "INSERT INTO geraet_kopplung \
           (einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, laeuft_ab_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(neu.einsatz_id)
    .bind(benutzer_id)
    .bind(neu.ansicht.as_str())
    .bind(neu.uhs_id)
    .bind(neu.bezeichnung)
    .bind(neu.von)
    .bind(neu.laeuft_ab_at)
    .fetch_one(&mut *conn)
    .await?;
    ereignis(
        &mut *conn,
        kopplung_id,
        KopplungEreignis::Angelegt,
        Some(neu.von),
        None,
    )
    .await?;
    Ok(kopplung_id)
}

/// Schreibt ein Ereignis in die Kopplungsspur.
pub async fn ereignis(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    art: KopplungEreignis,
    von: Option<i64>,
    peer_ip: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO geraet_kopplung_ereignis (kopplung_id, ereignis, von, peer_ip) VALUES (?, ?, ?, ?)",
    )
    .bind(kopplung_id)
    .bind(art.as_str())
    .bind(von)
    .bind(peer_ip)
    .execute(conn)
    .await?;
    Ok(())
}

/// Ob die Kopplung noch nutzbar ist: nicht widerrufen, nicht abgelaufen, Einsatz aktiv.
async fn fordere_offen(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError> {
    let offen: bool = sqlx::query_scalar(
        "SELECT k.widerrufen_at IS NULL AND k.laeuft_ab_at > datetime('now') \
         FROM geraet_kopplung k WHERE k.id = ?",
    )
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if offen {
        Ok(())
    } else {
        Err(AppError::Conflict(
            "Die Kopplung ist widerrufen oder abgelaufen".into(),
        ))
    }
}

/// Stellt einen neuen Kopplungscode aus (ersetzt einen alten). Liefert den Klartext-Code und
/// sein Ablaufdatum. Abgelaufene oder widerrufene Kopplung → 409.
pub async fn code_ausstellen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    von: i64,
) -> Result<(String, String), AppError> {
    fordere_offen(&mut *conn, kopplung_id).await?;
    let code = code::neu();
    let laeuft_ab_at: String = sqlx::query_scalar(
        "INSERT INTO geraet_kopplungscode (kopplung_id, code_hash, laeuft_ab_at) \
         VALUES (?, ?, datetime('now', ?)) \
         ON CONFLICT (kopplung_id) DO UPDATE SET code_hash = excluded.code_hash, \
             laeuft_ab_at = excluded.laeuft_ab_at, eingeloest_at = NULL \
         RETURNING laeuft_ab_at",
    )
    .bind(kopplung_id)
    .bind(code::hash(&code))
    .bind(format!("+{} minutes", super::CODE_MINUTEN))
    .fetch_one(&mut *conn)
    .await?;
    ereignis(
        &mut *conn,
        kopplung_id,
        KopplungEreignis::CodeAusgestellt,
        Some(von),
        None,
    )
    .await?;
    Ok((code, laeuft_ab_at))
}

/// Ergebnis einer erfolgreichen Einlösung.
pub struct Eingeloest {
    pub kopplung_id: i64,
    pub einsatz_id: i64,
    pub benutzer_id: i64,
    /// Sitzungen, die diese Einlösung beendet hat (Gerätetausch). Der Aufrufer meldet die
    /// Kopplung dann an den Live-Kanal, damit offene Ströme des alten Geräts enden.
    pub alte_sitzungen: u64,
    pub laeuft_ab_at: String,
}

/// Löst einen (normalisierten) Code ein: Code gültig und unverbraucht, Kopplung offen, Einsatz
/// aktiv. Beendet alle bisherigen Sitzungen der Kopplung (ein Gerät je Kopplung). Jeder
/// Fehlschlag ist [`AppError::Unauthorized`], damit der Statuscode nichts verrät.
pub async fn einloesen(
    conn: &mut SqliteConnection,
    code: &str,
    peer_ip: Option<&str>,
) -> Result<Eingeloest, AppError> {
    let treffer: Option<(i64, i64, i64, String)> = sqlx::query_as(
        "SELECT k.id, k.einsatz_id, k.benutzer_id, k.laeuft_ab_at \
         FROM geraet_kopplungscode c \
         JOIN geraet_kopplung k ON k.id = c.kopplung_id \
         JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE c.code_hash = ? AND c.eingeloest_at IS NULL AND c.laeuft_ab_at > datetime('now') \
           AND k.widerrufen_at IS NULL AND k.laeuft_ab_at > datetime('now') \
           AND e.status = 'aktiv' AND e.geloescht_at IS NULL",
    )
    .bind(code::hash(code))
    .fetch_optional(&mut *conn)
    .await?;
    let (kopplung_id, einsatz_id, benutzer_id, laeuft_ab_at) =
        treffer.ok_or(AppError::Unauthorized)?;

    // Bedingtes UPDATE: zwei gleichzeitige Einlösungen desselben Codes, nur eine gewinnt.
    let verbraucht = sqlx::query(
        "UPDATE geraet_kopplungscode SET eingeloest_at = datetime('now') \
         WHERE kopplung_id = ? AND eingeloest_at IS NULL",
    )
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    if verbraucht.rows_affected() != 1 {
        return Err(AppError::Unauthorized);
    }
    let alte_sitzungen = sqlx::query("DELETE FROM session WHERE kopplung_id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    sqlx::query("UPDATE geraet_kopplung SET gekoppelt_at = datetime('now') WHERE id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    ereignis(
        &mut *conn,
        kopplung_id,
        KopplungEreignis::Eingeloest,
        None,
        peer_ip,
    )
    .await?;
    Ok(Eingeloest {
        kopplung_id,
        einsatz_id,
        benutzer_id,
        alte_sitzungen,
        laeuft_ab_at,
    })
}

/// Setzt ein neues Ende der Kopplung (höchstens [`HOECHSTENS_STUNDEN`] ab jetzt; prüft der
/// Handler). Offene Gerätesitzungen bekommen dasselbe Ende.
pub async fn verlaengern(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    laeuft_ab_at: &str,
    von: i64,
) -> Result<(), AppError> {
    fordere_offen(&mut *conn, kopplung_id).await?;
    sqlx::query("UPDATE geraet_kopplung SET laeuft_ab_at = ? WHERE id = ?")
        .bind(laeuft_ab_at)
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE session SET expires_at = ? WHERE kopplung_id = ?")
        .bind(laeuft_ab_at)
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    ereignis(
        &mut *conn,
        kopplung_id,
        KopplungEreignis::Verlaengert,
        Some(von),
        None,
    )
    .await
}

/// Widerruft eine Kopplung: Sitzungen und Code weg, Gerätekonto inaktiv. Idempotent; ein
/// zweiter Widerruf ändert nichts und schreibt kein Ereignis. Liefert, ob widerrufen wurde.
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    von: i64,
) -> Result<bool, AppError> {
    let geaendert = sqlx::query(
        "UPDATE geraet_kopplung SET widerrufen_at = datetime('now'), widerrufen_von = ? \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(von)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert == 0 {
        return Ok(false);
    }
    sqlx::query("DELETE FROM session WHERE kopplung_id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM geraet_kopplungscode WHERE kopplung_id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE benutzer SET aktiv = 0 WHERE id = (SELECT benutzer_id FROM geraet_kopplung WHERE id = ?)",
    )
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    ereignis(
        &mut *conn,
        kopplung_id,
        KopplungEreignis::Widerrufen,
        Some(von),
        None,
    )
    .await?;
    Ok(true)
}

/// IDs aller nicht widerrufenen Kopplungen eines Einsatzes (für das Ende beim Abschluss).
pub async fn offene_ids(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM geraet_kopplung WHERE einsatz_id = ? AND widerrufen_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

/// Kontext einer Gerätesitzung, wenn die Kopplung noch gilt (nicht widerrufen, nicht abgelaufen,
/// Einsatz aktiv und nicht gelöscht). `None` heißt: die Sitzung ist tot.
pub async fn kontext_wenn_gueltig(
    pool: &SqlitePool,
    kopplung_id: i64,
) -> Result<Option<GeraetKontext>, AppError> {
    let zeile: Option<(i64, i64, String, Option<i64>, String, String)> = sqlx::query_as(
        "SELECT k.id, k.einsatz_id, k.ansicht, k.uhs_id, k.bezeichnung, k.laeuft_ab_at \
         FROM geraet_kopplung k JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE k.id = ? AND k.widerrufen_at IS NULL AND k.laeuft_ab_at > datetime('now') \
           AND e.status = 'aktiv' AND e.geloescht_at IS NULL",
    )
    .bind(kopplung_id)
    .fetch_optional(pool)
    .await?;
    let Some((kopplung_id, einsatz_id, ansicht, uhs_id, bezeichnung, laeuft_ab_at)) = zeile else {
        return Ok(None);
    };
    let ansicht = Funktionsansicht::parse(&ansicht)
        .ok_or_else(|| AppError::Internal(format!("Ansicht {ansicht}")))?;
    // Letzter Zugriff, höchstens minütlich: ein Schreibzugriff je Anfrage wäre zu teuer.
    sqlx::query(
        "UPDATE geraet_kopplung SET letzter_zugriff_at = datetime('now') WHERE id = ? \
           AND (letzter_zugriff_at IS NULL OR letzter_zugriff_at < datetime('now', '-60 seconds'))",
    )
    .bind(kopplung_id)
    .execute(pool)
    .await?;
    Ok(Some(GeraetKontext {
        kopplung_id,
        einsatz_id,
        ansicht,
        uhs_id,
        bezeichnung,
        laeuft_ab_at,
    }))
}

/// Ob der Benutzer ein Gerätekonto ist.
pub async fn ist_geraetekonto(pool: &SqlitePool, benutzer_id: i64) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM geraet_kopplung WHERE benutzer_id = ?)")
            .bind(benutzer_id)
            .fetch_one(pool)
            .await?,
    )
}

/// Prüft ein gewünschtes Ende gegen [`HOECHSTENS_STUNDEN`] ab jetzt. Erwartet die normalisierte
/// Form `%Y-%m-%d %H:%M:%S` (UTC). Vergangenheit oder zu weit → 400.
pub fn pruefe_ende(
    laeuft_ab_at: &str,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<(), AppError> {
    let ende = crate::zeit::parse_utc(laeuft_ab_at)
        .ok_or_else(|| AppError::Validation("Ungültiges Ende der Kopplung".into()))?;
    if ende <= jetzt {
        return Err(AppError::Validation(
            "Das Ende der Kopplung liegt in der Vergangenheit".into(),
        ));
    }
    if ende > jetzt + chrono::Duration::hours(HOECHSTENS_STUNDEN) {
        return Err(AppError::Validation(format!(
            "Eine Kopplung gilt höchstens {HOECHSTENS_STUNDEN} Stunden"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn ende_wird_begrenzt() {
        let jetzt = chrono::Utc.with_ymd_and_hms(2026, 10, 4, 12, 0, 0).unwrap();
        assert!(pruefe_ende("2026-10-05 12:00:00", jetzt).is_ok());
        assert!(
            pruefe_ende("2026-10-07 12:00:00", jetzt).is_ok(),
            "genau 72 h"
        );
        assert!(matches!(
            pruefe_ende("2026-10-07 12:00:01", jetzt),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            pruefe_ende("2026-10-04 11:59:59", jetzt),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            pruefe_ende("morgen", jetzt),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn anzeigename_nennt_stelle() {
        assert_eq!(
            anzeigename(Some("UHS Nord"), "Tablet 1"),
            "UHS Nord · Tablet 1"
        );
        assert_eq!(anzeigename(None, "Monitor EL"), "Monitor EL");
    }
}
