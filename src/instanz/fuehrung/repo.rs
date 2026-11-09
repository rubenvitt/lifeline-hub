//! Speicher der Führung je Einsatz (design.md D1, D4; `migrations/0311_einsatz_fuehrung.sql`).
//!
//! **`einsatz.fuehrung_bei` schreibt nur dieses Modul** ([`sync_sperre`], [`sync_sperre_alle`]),
//! in der Transaktion des Wechsels (ADR-0018).

use super::{Epoche, FuehrungWechselArt};
use crate::error::AppError;
use crate::instanz::InstanzKopplungRichtung;
use serde::Serialize;
use sqlx::SqliteConnection;
use utoipa::ToSchema;

/// Eine Akte, wie sie in der DB steht.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct AkteZeile {
    pub id: i64,
    pub kennung: String,
    pub einsatz_id: Option<i64>,
    pub org_id: i64,
    pub nummer: Option<String>,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub epoche_zaehler: i64,
    pub epoche_instanz: String,
    pub fuehrer_kennung: String,
    pub fuehrer_name: String,
    pub art: String,
    pub erklaerung: Option<String>,
    pub beweis: Option<String>,
    pub offen: Option<String>,
    pub offen_bruch_at: Option<String>,
    pub abgabe_schluessel: Option<String>,
    pub anfrage_at: Option<String>,
    pub bruch_at: Option<String>,
    pub stand: i64,
    pub geaendert_at: String,
}

const SPALTEN: &str = "id, kennung, einsatz_id, org_id, nummer, bezeichnung, stichwort, status, \
     epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, erklaerung, beweis, \
     offen, offen_bruch_at, abgabe_schluessel, anfrage_at, bruch_at, stand, geaendert_at";

impl AkteZeile {
    pub fn epoche(&self) -> Epoche {
        Epoche::neu(self.epoche_zaehler, &self.epoche_instanz)
    }

    pub fn set_epoche(&mut self, e: &Epoche) {
        self.epoche_zaehler = e.zaehler;
        self.epoche_instanz = e.instanz.clone();
    }

    pub fn art(&self) -> FuehrungWechselArt {
        FuehrungWechselArt::parse(&self.art).unwrap_or(FuehrungWechselArt::Angelegt)
    }

    pub fn set_art(&mut self, art: FuehrungWechselArt) {
        self.art = art.as_str().to_string();
    }
}

/// Eigene Kennung und Name dieser Instanz.
#[derive(Debug, Clone)]
pub struct Ich {
    pub kennung: String,
    pub name: String,
}

pub async fn ich(conn: &mut SqliteConnection) -> Result<Ich, AppError> {
    let kennung: String = sqlx::query_scalar("SELECT kennung FROM instanz_identitaet")
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::Internal("Instanzidentität fehlt".into()))?;
    Ok(Ich {
        kennung,
        name: crate::instanz::name().to_string(),
    })
}

/// Ob die Führung an ist, auf der Verbindung des Aufrufers.
pub async fn is_enabled_tx(conn: &mut SqliteConnection) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT fuehrung_an FROM instanz_identitaet")
            .fetch_optional(&mut *conn)
            .await?
            .unwrap_or(0)
            == 1,
    )
}

/// Nächster Stand dieser Instanz (monoton, Zähler an `instanz_identitaet`).
pub async fn next_stand(conn: &mut SqliteConnection) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&mut *conn)
    .await?)
}

pub async fn load(conn: &mut SqliteConnection, id: i64) -> Result<AkteZeile, AppError> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einsatz_fuehrung WHERE id = ?"
    )))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn find_by_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<AkteZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einsatz_fuehrung WHERE einsatz_id = ?"
    )))
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?)
}

pub async fn find_by_kennung(
    conn: &mut SqliteConnection,
    kennung: &str,
) -> Result<Option<AkteZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einsatz_fuehrung WHERE kennung = ?"
    )))
    .bind(kennung)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Akten einer Org, deren Einsatz nicht hier liegt (Akten des Gegenübers).
pub async fn list_fremde_der_org(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<AkteZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM einsatz_fuehrung WHERE org_id = ? AND einsatz_id IS NULL \
         ORDER BY status, geaendert_at DESC, id DESC"
    )))
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Schreibt alle veränderlichen Felder zurück und richtet die Sperre des Einsatzes aus. `bump`:
/// neuer Stand, damit die Änderung an die Gegenüber geht.
pub async fn save(
    conn: &mut SqliteConnection,
    a: &mut AkteZeile,
    bump: bool,
) -> Result<(), AppError> {
    if bump {
        a.stand = next_stand(conn).await?;
    }
    a.geaendert_at = crate::zeit::jetzt();
    sqlx::query(
        "UPDATE einsatz_fuehrung SET nummer = ?, bezeichnung = ?, stichwort = ?, status = ?, \
         epoche_zaehler = ?, epoche_instanz = ?, fuehrer_kennung = ?, fuehrer_name = ?, art = ?, \
         erklaerung = ?, beweis = ?, offen = ?, offen_bruch_at = ?, abgabe_schluessel = ?, \
         anfrage_at = ?, bruch_at = ?, stand = ?, geaendert_at = ? WHERE id = ?",
    )
    .bind(&a.nummer)
    .bind(&a.bezeichnung)
    .bind(&a.stichwort)
    .bind(&a.status)
    .bind(a.epoche_zaehler)
    .bind(&a.epoche_instanz)
    .bind(&a.fuehrer_kennung)
    .bind(&a.fuehrer_name)
    .bind(&a.art)
    .bind(&a.erklaerung)
    .bind(&a.beweis)
    .bind(&a.offen)
    .bind(&a.offen_bruch_at)
    .bind(&a.abgabe_schluessel)
    .bind(&a.anfrage_at)
    .bind(&a.bruch_at)
    .bind(a.stand)
    .bind(&a.geaendert_at)
    .bind(a.id)
    .execute(&mut *conn)
    .await?;
    if let Some(einsatz_id) = a.einsatz_id {
        sync_sperre(conn, einsatz_id).await?;
    }
    Ok(())
}

/// Legt eine vom Gegenüber gelieferte Akte an (ohne lokalen Einsatz). `stand` neu, damit sie an
/// weitere Gegenüber derselben Org geht.
pub async fn insert_fremd(conn: &mut SqliteConnection, a: &mut AkteZeile) -> Result<(), AppError> {
    a.stand = next_stand(conn).await?;
    a.geaendert_at = crate::zeit::jetzt();
    a.id = sqlx::query_scalar(
        "INSERT INTO einsatz_fuehrung (kennung, einsatz_id, org_id, nummer, bezeichnung, \
         stichwort, status, epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, \
         erklaerung, beweis, stand, geaendert_at) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&a.kennung)
    .bind(a.org_id)
    .bind(&a.nummer)
    .bind(&a.bezeichnung)
    .bind(&a.stichwort)
    .bind(&a.status)
    .bind(a.epoche_zaehler)
    .bind(&a.epoche_instanz)
    .bind(&a.fuehrer_kennung)
    .bind(&a.fuehrer_name)
    .bind(&a.art)
    .bind(&a.erklaerung)
    .bind(&a.beweis)
    .bind(a.stand)
    .bind(&a.geaendert_at)
    .fetch_one(&mut *conn)
    .await?;
    Ok(())
}

/// Ein neuer Eintrag im Verlauf.
#[derive(Debug, Clone, Default)]
pub struct VerlaufNeu<'a> {
    /// Ohne Angabe die Art der Akte.
    pub art: Option<FuehrungWechselArt>,
    pub von_name: Option<&'a str>,
    pub nach_name: &'a str,
    pub wer: Option<&'a str>,
    pub grund: Option<&'a str>,
    pub unterzeichner: Option<&'a str>,
    pub bruch_at: Option<&'a str>,
}

/// Schreibt einen Eintrag in den Verlauf, mit der Epoche der Akte.
pub async fn add_verlauf(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
    v: VerlaufNeu<'_>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_fuehrung_verlauf (fuehrung_id, epoche_zaehler, epoche_instanz, art, \
         von_name, nach_name, wer, grund, unterzeichner, bruch_at, at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(a.id)
    .bind(a.epoche_zaehler)
    .bind(&a.epoche_instanz)
    .bind(v.art.unwrap_or(a.art()).as_str())
    .bind(v.von_name)
    .bind(v.nach_name)
    .bind(v.wer)
    .bind(v.grund)
    .bind(v.unterzeichner)
    .bind(v.bruch_at)
    .bind(crate::zeit::jetzt())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ein Eintrag des Verlaufs, wie die Oberfläche ihn zeigt.
#[derive(Debug, Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct FuehrungVerlaufEintrag {
    pub epoche_zaehler: i64,
    #[sqlx(try_from = "String")]
    pub art: FuehrungWechselArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub von_name: Option<String>,
    pub nach_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unterzeichner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bruch_at: Option<String>,
    pub at: String,
}

pub async fn list_verlauf(
    conn: &mut SqliteConnection,
    fuehrung_id: i64,
) -> Result<Vec<FuehrungVerlaufEintrag>, AppError> {
    Ok(sqlx::query_as(
        "SELECT epoche_zaehler, art, von_name, nach_name, wer, grund, unterzeichner, bruch_at, at \
         FROM einsatz_fuehrung_verlauf WHERE fuehrung_id = ? ORDER BY id",
    )
    .bind(fuehrung_id)
    .fetch_all(&mut *conn)
    .await?)
}

// ── Schreibsperre ────────────────────────────────────────────────────────────────────────────

/// Wert von `einsatz.fuehrung_bei` aus der Akte: der Name der führenden Instanz, wenn eine andere
/// führt und die Führung an ist, sonst NULL.
macro_rules! sperre_wert {
    () => {
        "CASE WHEN (SELECT fuehrung_an FROM instanz_identitaet) = 1 THEN \
         (SELECT CASE WHEN f.fuehrer_kennung <> (SELECT kennung FROM instanz_identitaet) \
                 THEN f.fuehrer_name END \
          FROM einsatz_fuehrung f WHERE f.einsatz_id = einsatz.id) END"
    };
}

/// Richtet die Sperre eines Einsatzes nach seiner Akte aus.
pub async fn sync_sperre(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<(), AppError> {
    sqlx::query(concat!(
        "UPDATE einsatz SET fuehrung_bei = ",
        sperre_wert!(),
        " WHERE id = ?"
    ))
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Richtet die Sperre aller Einsätze aus (Start, Schalter).
pub async fn sync_sperre_alle(conn: &mut SqliteConnection) -> Result<(), AppError> {
    sqlx::query(concat!(
        "UPDATE einsatz SET fuehrung_bei = ",
        sperre_wert!(),
        " WHERE fuehrung_bei IS NOT NULL \
           OR id IN (SELECT einsatz_id FROM einsatz_fuehrung WHERE einsatz_id IS NOT NULL)"
    ))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ── Akten anlegen und nachführen ─────────────────────────────────────────────────────────────

/// Legt für jeden nicht gelöschten Einsatz einer Org mit aktiver Kopplung eine Akte an (Epoche 1,
/// diese Instanz führt) und führt den Kopf lokaler Akten nach (Spec „Jeder Einsatz einer
/// gekoppelten Org hat eine Führungsakte“). Ohne Schalter: nichts. Läuft beim Start, vor jeder
/// Meldung und vor jedem Lesen der Führung.
pub async fn ensure_akten(conn: &mut SqliteConnection) -> Result<(), AppError> {
    if !is_enabled_tx(conn).await? {
        return Ok(());
    }
    let ich = ich(conn).await?;
    let jetzt = crate::zeit::jetzt();
    let neu: Vec<i64> = sqlx::query_scalar(
        "INSERT INTO einsatz_fuehrung (kennung, einsatz_id, org_id, nummer, bezeichnung, \
         stichwort, status, epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, \
         stand, geaendert_at) \
         SELECT ? || '/' || e.id || '-' || lower(hex(randomblob(4))), e.id, e.org_id, e.einsatznummer_intern, e.bezeichnung, \
                e.stichwort, e.status, 1, ?, ?, ?, 'angelegt', 0, ? \
         FROM einsatz e \
         WHERE (e.geloescht_at IS NULL OR e.geloescht_at = '') \
           AND NOT EXISTS (SELECT 1 FROM einsatz_fuehrung f WHERE f.einsatz_id = e.id) \
           AND EXISTS (SELECT 1 FROM instanz_kopplung_org o \
                       JOIN instanz_kopplung k ON k.id = o.kopplung_id \
                       WHERE o.org_id = e.org_id AND o.widerrufen_at IS NULL \
                         AND k.zustand IN ('angebahnt', 'aktiv')) \
         RETURNING id",
    )
    .bind(&ich.kennung)
    .bind(&ich.kennung)
    .bind(&ich.kennung)
    .bind(&ich.name)
    .bind(&jetzt)
    .fetch_all(&mut *conn)
    .await?;
    for id in neu {
        let mut a = load(conn, id).await?;
        save(conn, &mut a, true).await?;
        add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                art: Some(FuehrungWechselArt::Angelegt),
                nach_name: &ich.name,
                ..VerlaufNeu::default()
            },
        )
        .await?;
    }
    // Kopf lokaler Akten nachführen: der Einsatz liegt hier, also bestimmt diese Instanz ihn.
    let geaendert: Vec<(i64, Option<String>, String, Option<String>, String)> = sqlx::query_as(
        "SELECT f.id, e.einsatznummer_intern, e.bezeichnung, e.stichwort, e.status \
         FROM einsatz_fuehrung f JOIN einsatz e ON e.id = f.einsatz_id \
         WHERE f.nummer IS NOT e.einsatznummer_intern OR f.bezeichnung <> e.bezeichnung \
            OR f.stichwort IS NOT e.stichwort OR f.status <> e.status",
    )
    .fetch_all(&mut *conn)
    .await?;
    for (id, nummer, bezeichnung, stichwort, status) in geaendert {
        let mut a = load(conn, id).await?;
        a.nummer = nummer;
        a.bezeichnung = bezeichnung;
        a.stichwort = stichwort;
        a.status = status;
        save(conn, &mut a, true).await?;
    }
    Ok(())
}

/// Nach dem Widerruf einer Org-Zuordnung (hier oder vom Gegenüber): lokale Einsätze der Org, die
/// dieses Gegenüber führt, holt diese Instanz mit der nächsten Epoche zurück. Sonst bliebe ein Einsatz
/// gesperrt, ohne dass ihn jemand übergeben oder zurückholen kann (Review LLH-1491).
pub async fn release_nach_widerruf(
    conn: &mut SqliteConnection,
    org_id: i64,
    gegenueber_kennung: &str,
) -> Result<(), AppError> {
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_fuehrung WHERE org_id = ? AND fuehrer_kennung = ? \
         AND einsatz_id IS NOT NULL",
    )
    .bind(org_id)
    .bind(gegenueber_kennung)
    .fetch_all(&mut *conn)
    .await?;
    if ids.is_empty() {
        return Ok(());
    }
    let ich = ich(conn).await?;
    for id in ids {
        let mut a = load(conn, id).await?;
        let von = a.fuehrer_name.clone();
        a.set_epoche(&Epoche::naechste([&a.epoche()], &ich.kennung));
        a.fuehrer_kennung = ich.kennung.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(FuehrungWechselArt::Notuebernahme);
        a.erklaerung = None;
        a.beweis = None;
        a.offen = None;
        a.offen_bruch_at = None;
        a.abgabe_schluessel = None;
        a.anfrage_at = None;
        a.bruch_at = Some(crate::zeit::jetzt());
        save(conn, &mut a, true).await?;
        add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&von),
                nach_name: &ich.name,
                grund: Some("Kopplung widerrufen"),
                bruch_at: a.bruch_at.as_deref(),
                ..VerlaufNeu::default()
            },
        )
        .await?;
    }
    Ok(())
}

// ── Gegenüber ────────────────────────────────────────────────────────────────────────────────

/// Ein Gegenüber, an das die Führung einer Akte gehen kann: eine aktive Kopplung, in der die Org
/// der Akte zugeordnet ist.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungGegenueber {
    pub kopplung_id: i64,
    pub kennung: String,
    pub name: String,
    pub richtung: InstanzKopplungRichtung,
    /// Org-Schlüssel der Akte auf der Leitung (die Org der erreichten Seite).
    #[serde(skip)]
    pub org_schluessel: String,
}

/// Die Gegenüber einer Org (aktive Kopplungen mit gültiger Zuordnung).
pub async fn list_gegenueber(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<FuehrungGegenueber>, AppError> {
    let ich = ich(conn).await?;
    let rows: Vec<(i64, String, String, String, String)> = sqlx::query_as(
        "SELECT k.id, k.gegenueber_kennung, k.gegenueber_name, k.richtung, \
                CASE WHEN k.richtung = 'meldet_sich' THEN o.fremde_org_kennung \
                     ELSE ? || '/' || o.org_id END \
         FROM instanz_kopplung_org o JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL AND k.zustand = 'aktiv' \
         ORDER BY k.id",
    )
    .bind(&ich.kennung)
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(kopplung_id, kennung, name, richtung, org_schluessel)| {
            Some(FuehrungGegenueber {
                kopplung_id,
                kennung,
                name,
                richtung: InstanzKopplungRichtung::parse(&richtung)?,
                org_schluessel,
            })
        })
        .collect())
}

/// Org-Zuordnungen einer Kopplung: lokale Org und Org-Schlüssel auf der Leitung (immer der der
/// erreichten Seite, wie bei den Orgs der Meldung).
pub async fn list_orgs_der_kopplung(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    richtung: InstanzKopplungRichtung,
) -> Result<Vec<(i64, String)>, AppError> {
    let ich = ich(conn).await?;
    Ok(sqlx::query_as(
        "SELECT org_id, CASE WHEN ? THEN fremde_org_kennung ELSE ? || '/' || org_id END \
         FROM instanz_kopplung_org WHERE kopplung_id = ? AND widerrufen_at IS NULL ORDER BY id",
    )
    .bind(richtung == InstanzKopplungRichtung::MeldetSich)
    .bind(&ich.kennung)
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Akten der Orgs `org_ids` mit Stand über `ab`, nach Stand.
pub async fn list_zu_senden(
    conn: &mut SqliteConnection,
    org_ids: &[i64],
    ab: i64,
    max: usize,
) -> Result<Vec<AkteZeile>, AppError> {
    if org_ids.is_empty() {
        return Ok(Vec::new());
    }
    let platz = vec!["?"; org_ids.len()].join(", ");
    let sql = format!(
        "SELECT {SPALTEN} FROM einsatz_fuehrung WHERE org_id IN ({platz}) AND stand > ? \
         ORDER BY stand LIMIT ?"
    );
    let mut q = sqlx::query_as::<_, AkteZeile>(sqlx::AssertSqlSafe(sql));
    for id in org_ids {
        q = q.bind(id);
    }
    Ok(q.bind(ab).bind(max as i64).fetch_all(&mut *conn).await?)
}

/// Stände des Austauschs an der Kopplung; jeder wandert nur vorwärts.
pub async fn save_kopplung_staende(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    gesendet_bis: Option<i64>,
    empfangen_bis: Option<i64>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET \
         fuehrung_gesendet_bis = MAX(fuehrung_gesendet_bis, COALESCE(?, fuehrung_gesendet_bis)), \
         fuehrung_empfangen_bis = MAX(fuehrung_empfangen_bis, COALESCE(?, fuehrung_empfangen_bis)) \
         WHERE id = ?",
    )
    .bind(gesendet_bis)
    .bind(empfangen_bis)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `(gesendet_bis, empfangen_bis)` einer Kopplung.
pub async fn load_kopplung_staende(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<(i64, i64), AppError> {
    Ok(sqlx::query_as(
        "SELECT fuehrung_gesendet_bis, fuehrung_empfangen_bis FROM instanz_kopplung WHERE id = ?",
    )
    .bind(kopplung_id)
    .fetch_one(&mut *conn)
    .await?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Diese Instanz meldet sich bei „Hub Nord“ (Kennung `hub`), Org 1 ↔ `hub/1`.
    pub(crate) async fn gekoppelt(pool: &sqlx::SqlitePool) {
        org(pool).await;
        crate::instanz::identitaet::load_or_create(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, gegenueber_adresse, zustand) \
             VALUES (1, 'hub', 's', 'Hub Nord', 'meldet_sich', 'http://127.0.0.1:1', 'aktiv')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (1, 1, 'hub/1', 'Hub-Org')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn org(pool: &sqlx::SqlitePool) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
    }

    pub(crate) async fn einsatz(pool: &sqlx::SqlitePool, bezeichnung: &str) -> i64 {
        org(pool).await;
        sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
            .bind(bezeichnung)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn akten(pool: &sqlx::SqlitePool) -> Vec<AkteZeile> {
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT {SPALTEN} FROM einsatz_fuehrung ORDER BY id"
        )))
        .fetch_all(pool)
        .await
        .unwrap()
    }

    pub(crate) async fn ensure(pool: &sqlx::SqlitePool) {
        let mut conn = pool.acquire().await.unwrap();
        ensure_akten(&mut conn).await.unwrap();
    }

    async fn bei(pool: &sqlx::SqlitePool, id: i64) -> Option<String> {
        sqlx::query_scalar("SELECT fuehrung_bei FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn schalter_aus_legt_nichts_an() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        einsatz(&pool, "Lage").await;
        ensure(&pool).await;
        assert!(akten(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn einsatz_einer_gekoppelten_org_bekommt_eine_akte_mit_epoche_eins() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        let id = einsatz(&pool, "Lage").await;
        let geloescht = einsatz(&pool, "Weg").await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-11-01 00:00:00' WHERE id = ?")
            .bind(geloescht)
            .execute(&pool)
            .await
            .unwrap();
        ensure(&pool).await;
        let a = akten(&pool).await;
        assert_eq!(a.len(), 1, "gelöschter Einsatz ohne Akte");
        let mut conn = pool.acquire().await.unwrap();
        let ich = ich(&mut conn).await.unwrap();
        assert_eq!(a[0].einsatz_id, Some(id));
        assert!(
            a[0].kennung.starts_with(&format!("{}/{id}-", ich.kennung)),
            "Kennung mit Zufallsteil, damit eine wieder vergebene Einsatz-ID keine alte Akte trifft"
        );
        assert_eq!(a[0].epoche(), Epoche::neu(1, &ich.kennung));
        assert_eq!(a[0].fuehrer_kennung, ich.kennung);
        assert!(a[0].stand > 0);
        assert_eq!(list_verlauf(&mut conn, a[0].id).await.unwrap().len(), 1);
        drop(conn);
        ensure(&pool).await;
        assert_eq!(akten(&pool).await.len(), 1, "kein zweites Mal");
    }

    #[tokio::test]
    async fn einsatz_ohne_kopplung_bekommt_keine_akte() {
        let pool = crate::db::test_pool().await;
        super::super::save_schalter(&pool, true).await.unwrap();
        einsatz(&pool, "Lage").await;
        ensure(&pool).await;
        assert!(akten(&pool).await.is_empty());
    }

    #[tokio::test]
    async fn kopf_wird_nachgefuehrt_und_der_stand_steigt() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        let id = einsatz(&pool, "Lage").await;
        ensure(&pool).await;
        let vorher = akten(&pool).await[0].stand;
        ensure(&pool).await;
        assert_eq!(
            akten(&pool).await[0].stand,
            vorher,
            "unverändert, kein Stand"
        );
        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        ensure(&pool).await;
        let a = &akten(&pool).await[0];
        assert_eq!(a.status, "abgeschlossen");
        assert!(a.stand > vorher);
    }

    #[tokio::test]
    async fn sperre_folgt_der_akte_und_dem_schalter() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        let id = einsatz(&pool, "Lage").await;
        ensure(&pool).await;
        assert_eq!(bei(&pool, id).await, None);
        let mut conn = pool.acquire().await.unwrap();
        let mut a = find_by_einsatz(&mut conn, id).await.unwrap().unwrap();
        a.fuehrer_kennung = "hub".into();
        a.fuehrer_name = "Hub Nord".into();
        save(&mut conn, &mut a, true).await.unwrap();
        drop(conn);
        assert_eq!(bei(&pool, id).await.as_deref(), Some("Hub Nord"));
        let mut conn = pool.acquire().await.unwrap();
        match crate::einsatz::repo::fordere_aktiv_in_tx(&mut conn, id).await {
            Err(AppError::Conflict(t)) => assert_eq!(t, "Führung liegt bei „Hub Nord“."),
            f => panic!("{f:?}"),
        }
        drop(conn);
        let geladen = crate::einsatz::repo::laden(&pool, id).await.unwrap();
        assert!(crate::einsatz::berechtigung::fordere_aktiv(&geladen).is_err());
        assert_eq!(
            geladen.fuehrung.anzeige().map(|f| (f.fuehrend, f.bei)),
            Some((false, "Hub Nord".to_string()))
        );
        super::super::save_schalter(&pool, false).await.unwrap();
        assert_eq!(bei(&pool, id).await, None, "Schalter aus sperrt nichts");
        let mut conn = pool.acquire().await.unwrap();
        assert!(crate::einsatz::repo::fordere_aktiv_in_tx(&mut conn, id)
            .await
            .is_ok());
        drop(conn);
        assert_eq!(
            crate::einsatz::repo::laden(&pool, id)
                .await
                .unwrap()
                .fuehrung
                .anzeige(),
            None,
            "ohne Schalter keine Anzeige"
        );
        super::super::save_schalter(&pool, true).await.unwrap();
        assert_eq!(bei(&pool, id).await.as_deref(), Some("Hub Nord"));
    }

    #[tokio::test]
    async fn stand_bleibt_monoton_wenn_die_juengste_akte_verschwindet() {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        super::super::save_schalter(&pool, true).await.unwrap();
        let id = einsatz(&pool, "Lage").await;
        ensure(&pool).await;
        let alt = akten(&pool).await[0].stand;
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        einsatz(&pool, "Neu").await;
        ensure(&pool).await;
        assert!(akten(&pool).await[0].stand > alt);
    }
}
