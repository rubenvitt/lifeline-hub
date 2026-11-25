//! Tabellen `adapter`, `adapter_geheimnis` und `adapter_versuch` (LLH-2017, Migration 0360).
//!
//! Alles, was eine Org betrifft, wird mit ihrer `org_id` gefiltert; der Lauf schreibt nur die
//! Zeile des Adapters, den er gerade abgerufen hat.

use serde_json::{Map, Value};
use sqlx::{SqliteConnection, SqlitePool};

use super::zustand::{AdapterFehler, AdapterGemeldet, NachFehlschlag};
use crate::error::AppError;

/// Höchstzahl der gespeicherten Versuche je Adapter.
pub const VERSUCHE_MAX: i64 = 50;

const SPALTEN: &str = "id, org_id, art, name, einstellungen, intervall_s, lan_erlaubt, zustand, \
     angehalten_grund, angehalten_at, fehler_seit, fehlversuche, naechster_abruf_at, \
     letzter_fehler_at, letzter_fehler_status, letzter_fehler_art, letzter_erfolg_at, \
     letzte_anzahl, stand, angelegt_at, geaendert_at, gemeldet";

/// Eine Zeile von `adapter`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Adapter {
    pub id: String,
    pub org_id: i64,
    pub art: String,
    pub name: String,
    #[sqlx(rename = "einstellungen")]
    pub einstellungen_json: String,
    pub intervall_s: i64,
    pub lan_erlaubt: bool,
    pub zustand: String,
    pub angehalten_grund: Option<String>,
    pub angehalten_at: Option<String>,
    pub fehler_seit: Option<String>,
    pub fehlversuche: i64,
    pub naechster_abruf_at: Option<String>,
    pub letzter_fehler_at: Option<String>,
    pub letzter_fehler_status: Option<i64>,
    pub letzter_fehler_art: Option<String>,
    pub letzter_erfolg_at: Option<String>,
    pub letzte_anzahl: Option<i64>,
    /// Zählt Änderungen durch einen Admin; ein Abruf mit älterem Stand schreibt nur seinen Versuch.
    pub stand: i64,
    pub angelegt_at: String,
    pub geaendert_at: String,
    /// Was zur laufenden Störung den Admins schon gemeldet ist (LLH-2026, `AdapterGemeldet`).
    pub gemeldet: Option<String>,
}

impl Adapter {
    pub fn gemeldet(&self) -> Option<AdapterGemeldet> {
        self.gemeldet.as_deref().and_then(AdapterGemeldet::parse)
    }

    pub fn is_angehalten(&self) -> bool {
        self.zustand == "angehalten"
    }

    /// Die Einstellungen als Objekt; eine kaputte Spalte ist ein leeres Objekt (die Prüfung der
    /// Art meldet dann `einstellung_ungueltig`).
    pub fn einstellungen(&self) -> Map<String, Value> {
        serde_json::from_str::<Value>(&self.einstellungen_json)
            .ok()
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default()
    }

    pub fn angehalten_grund(&self) -> Option<AdapterFehler> {
        self.angehalten_grund
            .as_deref()
            .and_then(AdapterFehler::parse)
    }

    pub fn letzter_fehler(&self) -> Option<AdapterFehler> {
        self.letzter_fehler_art
            .as_deref()
            .and_then(AdapterFehler::parse)
    }
}

/// Was beim Anlegen und Ändern gespeichert wird (geprüft).
#[derive(Debug, Clone)]
pub struct Eingabe {
    pub name: String,
    pub einstellungen: Map<String, Value>,
    pub intervall_s: i64,
    pub lan_erlaubt: bool,
}

/// Der nächste CAS-Stand: streng steigend, auch innerhalb derselben Sekunde.
fn neuer_stand(vorher: &str, jetzt: &str) -> String {
    if jetzt > vorher {
        return jetzt.to_string();
    }
    crate::zeit::parse(vorher)
        .map(|t| crate::zeit::formatiere(t + chrono::Duration::seconds(1)))
        .unwrap_or_else(|| jetzt.to_string())
}

pub async fn create(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: &str,
    eingabe: &Eingabe,
    angelegt_von: i64,
    jetzt: &str,
) -> Result<Adapter, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO adapter (id, org_id, art, name, einstellungen, intervall_s, lan_erlaubt, \
                              angelegt_at, angelegt_von, geaendert_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(org_id)
    .bind(art)
    .bind(&eingabe.name)
    .bind(Value::Object(eingabe.einstellungen.clone()).to_string())
    .bind(eingabe.intervall_s)
    .bind(eingabe.lan_erlaubt)
    .bind(jetzt)
    .bind(angelegt_von)
    .bind(jetzt)
    .execute(&mut *conn)
    .await?;
    load_in_org(conn, org_id, &id)
        .await?
        .ok_or_else(|| AppError::Internal("Adapter nach dem Anlegen nicht lesbar".into()))
}

pub async fn load_in_org(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Option<Adapter>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM adapter WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(conn)
    .await
}

/// Die SMTP-Anbindung einer Org (höchstens eine, auch angehaltene zählen; LLH-2093). Bei Altdaten
/// mit mehreren gilt die zuerst angelegte.
pub async fn load_smtp_fuer_org(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<Option<Adapter>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM adapter WHERE org_id = ? AND art = ? \
         ORDER BY angelegt_at, id LIMIT 1"
    )))
    .bind(org_id)
    .bind(super::smtp_art::CODE)
    .fetch_optional(pool)
    .await
}

pub async fn list_in_org(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<Adapter>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM adapter WHERE org_id = ? ORDER BY name COLLATE NOCASE, id"
    )))
    .bind(org_id)
    .fetch_all(conn)
    .await
}

/// Wer wegen eines Fehlers angehalten ist, läuft nach einer Änderung an Einstellungen oder
/// Geheimnissen wieder, sofort. Von einem Admin Angehaltene bleiben aus.
const WIEDER_FAELLIG: &str = "zustand = CASE WHEN angehalten_grund IS NOT NULL THEN 'aktiv' \
     ELSE zustand END, \
     naechster_abruf_at = CASE WHEN angehalten_grund IS NOT NULL THEN NULL \
     ELSE naechster_abruf_at END, \
     angehalten_at = CASE WHEN angehalten_grund IS NOT NULL THEN NULL ELSE angehalten_at END, \
     angehalten_grund = NULL";

/// Ändert Name, Einstellungen, Intervall und LAN-Ausnahme. `basis`: `geaendert_at` beim Öffnen;
/// weicht er ab → `Veraltet` (409). Liefert vorher und nachher.
pub async fn update(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    basis: Option<&str>,
    eingabe: &Eingabe,
    jetzt: &str,
) -> Result<Option<(Adapter, Adapter)>, AppError> {
    let Some(vorher) = load_in_org(conn, org_id, id).await? else {
        return Ok(None);
    };
    if basis.is_some_and(|b| b != vorher.geaendert_at) {
        return Err(AppError::Veraltet);
    }
    let einstellungen = Value::Object(eingabe.einstellungen.clone()).to_string();
    let wirksam =
        einstellungen != vorher.einstellungen_json || eingabe.lan_erlaubt != vorher.lan_erlaubt;
    let stand = neuer_stand(&vorher.geaendert_at, jetzt);
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE adapter SET name = ?, einstellungen = ?, intervall_s = ?, lan_erlaubt = ?, \
                geaendert_at = ?, stand = stand + 1{} \
         WHERE id = ? AND org_id = ?",
        if wirksam {
            format!(", {WIEDER_FAELLIG}")
        } else {
            String::new()
        }
    )))
    .bind(&eingabe.name)
    .bind(&einstellungen)
    .bind(eingabe.intervall_s)
    .bind(eingabe.lan_erlaubt)
    .bind(&stand)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?;
    let nachher = load_in_org(conn, org_id, id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Some((vorher, nachher)))
}

/// Löscht samt Geheimnissen und Versuchen; liefert die gelöschte Zeile.
pub async fn delete(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Option<Adapter>, sqlx::Error> {
    let Some(a) = load_in_org(conn, org_id, id).await? else {
        return Ok(None);
    };
    sqlx::query("DELETE FROM adapter WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(conn)
        .await?;
    Ok(Some(a))
}

/// Von einem Admin anhalten. Schon angehalten → `None`.
pub async fn halt(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    jetzt: &str,
) -> Result<Option<Adapter>, sqlx::Error> {
    let n = sqlx::query(
        "UPDATE adapter SET zustand = 'angehalten', angehalten_grund = NULL, angehalten_at = ?, \
                stand = stand + 1 \
         WHERE id = ? AND org_id = ? AND zustand = 'aktiv'",
    )
    .bind(jetzt)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n == 0 {
        return Ok(None);
    }
    load_in_org(conn, org_id, id).await
}

/// Wieder laufen lassen, sofort fällig. Nicht angehalten → `None`.
pub async fn resume(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Option<Adapter>, sqlx::Error> {
    let n = sqlx::query(
        "UPDATE adapter SET zustand = 'aktiv', angehalten_grund = NULL, angehalten_at = NULL, \
                naechster_abruf_at = NULL, stand = stand + 1 \
         WHERE id = ? AND org_id = ? AND zustand = 'angehalten'",
    )
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n == 0 {
        return Ok(None);
    }
    load_in_org(conn, org_id, id).await
}

/// Ein Platz, wie die Verwaltung ihn sieht: ohne Chiffrat.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PlatzStand {
    pub name: String,
    pub schluessel_fp: String,
    pub gesetzt_at: String,
    pub gesetzt_von_name: Option<String>,
}

pub async fn load_plaetze(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Vec<PlatzStand>, sqlx::Error> {
    sqlx::query_as(
        "SELECT g.name, g.schluessel_fp, g.gesetzt_at, b.anzeigename AS gesetzt_von_name \
         FROM adapter_geheimnis g LEFT JOIN benutzer b ON b.id = g.gesetzt_von \
         WHERE g.adapter_id = ? ORDER BY g.name",
    )
    .bind(adapter_id)
    .fetch_all(conn)
    .await
}

/// Ein Chiffrat für den Lauf.
#[derive(Clone, sqlx::FromRow)]
pub struct Chiffrat {
    pub name: String,
    pub chiffrat: Vec<u8>,
    pub schluessel_fp: String,
}

pub async fn load_chiffrate(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Vec<Chiffrat>, sqlx::Error> {
    sqlx::query_as(
        "SELECT name, chiffrat, schluessel_fp FROM adapter_geheimnis WHERE adapter_id = ?",
    )
    .bind(adapter_id)
    .fetch_all(conn)
    .await
}

/// Alle Geheimnisse an den Schlüssel mit `fingerabdruck`, für den Schlüsselwechsel (LLH-2025):
/// `(adapter_id, name, chiffrat)`.
pub async fn load_chiffrate_mit_fp(
    conn: &mut SqliteConnection,
    fingerabdruck: &str,
) -> Result<Vec<(String, String, Vec<u8>)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT adapter_id, name, chiffrat FROM adapter_geheimnis WHERE schluessel_fp = ? \
         ORDER BY adapter_id, name",
    )
    .bind(fingerabdruck)
    .fetch_all(conn)
    .await
}

/// Ersetzt das Chiffrat eines Geheimnisses, das noch an `fp_alt` liegt, durch eines an `fp_neu`
/// (LLH-2025). Wert, `gesetzt_at`, `gesetzt_von` und der Stand des Adapters bleiben: das
/// Geheimnis selbst ändert sich nicht. Liefert, ob die Zeile getroffen wurde.
pub async fn update_chiffrat(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    name: &str,
    chiffrat: &[u8],
    fp_neu: &str,
    fp_alt: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE adapter_geheimnis SET chiffrat = ?, schluessel_fp = ? \
         WHERE adapter_id = ? AND name = ? AND schluessel_fp = ?",
    )
    .bind(chiffrat)
    .bind(fp_neu)
    .bind(adapter_id)
    .bind(name)
    .bind(fp_alt)
    .execute(conn)
    .await?
    .rows_affected()
        == 1)
}

/// Ob ein Geheimnis der Org an einen anderen Schlüssel als `fingerabdruck` gespeichert ist
/// (`None`: überhaupt eines). Für den Zustand des Speichers in der Verwaltung.
pub async fn has_fremde_chiffrate(
    conn: &mut SqliteConnection,
    org_id: i64,
    fingerabdruck: Option<&str>,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM adapter_geheimnis g JOIN adapter a ON a.id = g.adapter_id \
                        WHERE a.org_id = ? AND (? IS NULL OR g.schluessel_fp <> ?))",
    )
    .bind(org_id)
    .bind(fingerabdruck)
    .bind(fingerabdruck)
    .fetch_one(conn)
    .await
}

/// Setzt oder ersetzt ein Geheimnis. Ein wegen eines Fehlers angehaltener Adapter läuft danach
/// wieder, sofort.
pub async fn save_geheimnis(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    name: &str,
    chiffrat: &[u8],
    schluessel_fp: &str,
    gesetzt_von: i64,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO adapter_geheimnis (adapter_id, name, chiffrat, schluessel_fp, gesetzt_at, \
                                        gesetzt_von) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT (adapter_id, name) DO UPDATE SET chiffrat = excluded.chiffrat, \
             schluessel_fp = excluded.schluessel_fp, gesetzt_at = excluded.gesetzt_at, \
             gesetzt_von = excluded.gesetzt_von",
    )
    .bind(adapter_id)
    .bind(name)
    .bind(chiffrat)
    .bind(schluessel_fp)
    .bind(jetzt)
    .bind(gesetzt_von)
    .execute(&mut *conn)
    .await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE adapter SET {WIEDER_FAELLIG}, stand = stand + 1 WHERE id = ?"
    )))
    .bind(adapter_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Entfernt ein Geheimnis; `false`, wenn keines gesetzt war.
pub async fn delete_geheimnis(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let weg = sqlx::query("DELETE FROM adapter_geheimnis WHERE adapter_id = ? AND name = ?")
        .bind(adapter_id)
        .bind(name)
        .execute(&mut *conn)
        .await?
        .rows_affected()
        > 0;
    if weg {
        sqlx::query("UPDATE adapter SET stand = stand + 1 WHERE id = ?")
            .bind(adapter_id)
            .execute(conn)
            .await?;
    }
    Ok(weg)
}

/// Entfernt alle Geheimnisse eines Adapters; liefert die Namen der entfernten Plätze.
pub async fn delete_geheimnisse(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let namen: Vec<String> =
        sqlx::query_scalar("DELETE FROM adapter_geheimnis WHERE adapter_id = ? RETURNING name")
            .bind(adapter_id)
            .fetch_all(&mut *conn)
            .await?;
    if !namen.is_empty() {
        sqlx::query("UPDATE adapter SET stand = stand + 1 WHERE id = ?")
            .bind(adapter_id)
            .execute(conn)
            .await?;
    }
    Ok(namen)
}

/// Ob der Adapter noch aktiv ist und seit dem Beginn eines Abrufs (`stand`) niemand etwas
/// geändert hat. Nur dann gilt dessen Ergebnis für Übernahme und Zustand (in der Transaktion des
/// Laufs gelesen).
pub async fn is_unveraendert(
    conn: &mut SqliteConnection,
    id: &str,
    stand: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM adapter WHERE id = ? AND stand = ? AND zustand = 'aktiv')",
    )
    .bind(id)
    .bind(stand)
    .fetch_one(conn)
    .await
}

/// Schiebt den nächsten Abruf auf, ohne Zustand oder Stand zu ändern (Org meldet sich bei einem
/// Hub: kein Abruf, aber auch kein Abfragen alle paar Sekunden).
pub async fn postpone(pool: &SqlitePool, id: &str, naechster: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE adapter SET naechster_abruf_at = ? WHERE id = ?")
        .bind(naechster)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Nach einem Start mit Schlüssel: Adapter, die nur wegen des Speichers angehalten sind, laufen
/// wieder. Passt ein Geheimnis weiterhin nicht, halten sie beim ersten Abruf erneut an, ohne
/// das Netz zu fragen. Liefert, wie viele es waren.
pub async fn rearm_nach_schluessel(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE adapter SET zustand = 'aktiv', angehalten_grund = NULL, angehalten_at = NULL, \
                naechster_abruf_at = NULL, stand = stand + 1 \
         WHERE zustand = 'angehalten' \
           AND angehalten_grund IN ('geheimnisspeicher_gesperrt', 'geheimnis_unlesbar')",
    )
    .execute(pool)
    .await?
    .rows_affected())
}

/// Wie viele Geheimnisse gespeichert sind, die nicht zu `fingerabdruck` passen (`None`: alle).
pub async fn count_fremde_chiffrate(
    pool: &SqlitePool,
    fingerabdruck: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM adapter_geheimnis WHERE ? IS NULL OR schluessel_fp <> ?",
    )
    .bind(fingerabdruck)
    .bind(fingerabdruck)
    .fetch_one(pool)
    .await
}

/// Die fälligen Adapter aller Orgs.
pub async fn load_faellige(pool: &SqlitePool, jetzt: &str) -> Result<Vec<Adapter>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM adapter \
         WHERE zustand = 'aktiv' AND (naechster_abruf_at IS NULL OR naechster_abruf_at <= ?) \
         ORDER BY naechster_abruf_at IS NOT NULL, naechster_abruf_at, id"
    )))
    .bind(jetzt)
    .fetch_all(pool)
    .await
}

/// Ein erfolgreicher Abruf: Störung vorbei, nächster nach dem Intervall. `ab` ist der Zeitpunkt,
/// ab dem das Intervall zählt: das Ende des Laufs, bei flüchtigen Arten sein Beginn.
pub async fn save_erfolg(
    conn: &mut SqliteConnection,
    a: &Adapter,
    anzahl: i64,
    jetzt: &str,
    ab: &str,
) -> Result<(), sqlx::Error> {
    let naechster = crate::zeit::parse(ab)
        .map(|t| crate::zeit::formatiere(t + chrono::Duration::seconds(a.intervall_s)))
        .unwrap_or_else(|| ab.to_string());
    sqlx::query(
        "UPDATE adapter SET fehler_seit = NULL, fehlversuche = 0, letzter_erfolg_at = ?, \
                letzte_anzahl = ?, naechster_abruf_at = ? \
         WHERE id = ?",
    )
    .bind(jetzt)
    .bind(anzahl)
    .bind(naechster)
    .bind(&a.id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Ein Fehlschlag: wiederholen oder anhalten (`zustand::nach_fehlschlag`).
pub async fn save_fehlschlag(
    conn: &mut SqliteConnection,
    a: &Adapter,
    fehler: AdapterFehler,
    status: Option<u16>,
    nach: &NachFehlschlag,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    let (fehler_seit, fehlversuche, naechster, anhalten) = match nach {
        NachFehlschlag::Wiederholen {
            fehler_seit,
            fehlversuche,
            naechster_abruf_at,
        } => (fehler_seit, *fehlversuche, Some(naechster_abruf_at), false),
        NachFehlschlag::Anhalten {
            fehler_seit,
            fehlversuche,
        } => (fehler_seit, *fehlversuche, None, true),
    };
    // Ein Admin, der während des Abrufs angehalten hat, bleibt maßgeblich: angehalten wird nur
    // ein aktiver Adapter.
    sqlx::query(
        "UPDATE adapter SET fehler_seit = ?, fehlversuche = ?, naechster_abruf_at = ?, \
                letzter_fehler_at = ?, letzter_fehler_status = ?, letzter_fehler_art = ?, \
                zustand = CASE WHEN ? AND zustand = 'aktiv' THEN 'angehalten' ELSE zustand END, \
                angehalten_grund = CASE WHEN ? AND zustand = 'aktiv' THEN ? \
                                        ELSE angehalten_grund END, \
                angehalten_at = CASE WHEN ? AND zustand = 'aktiv' THEN ? ELSE angehalten_at END \
         WHERE id = ?",
    )
    .bind(fehler_seit)
    .bind(fehlversuche)
    .bind(naechster)
    .bind(jetzt)
    .bind(status.map(i64::from))
    .bind(fehler.as_str())
    .bind(anhalten)
    .bind(anhalten)
    .bind(fehler.as_str())
    .bind(anhalten)
    .bind(jetzt)
    .bind(&a.id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Ein Versuch im Verlauf.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Versuch {
    pub at: String,
    pub probe: bool,
    pub status: Option<i64>,
    pub fehler_art: Option<String>,
    pub dauer_ms: i64,
    pub anzahl: Option<i64>,
}

/// Hält einen Versuch fest und kappt den Verlauf auf [`VERSUCHE_MAX`].
/// Liefert die Kennung des Versuchs (Bezug einer Störungsmeldung, LLH-2026).
pub async fn save_versuch(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    v: &Versuch,
) -> Result<i64, sqlx::Error> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO adapter_versuch (adapter_id, at, probe, status, fehler_art, dauer_ms, anzahl) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(adapter_id)
    .bind(&v.at)
    .bind(v.probe)
    .bind(v.status)
    .bind(&v.fehler_art)
    .bind(v.dauer_ms)
    .bind(v.anzahl)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "DELETE FROM adapter_versuch WHERE adapter_id = ? AND id NOT IN \
         (SELECT id FROM adapter_versuch WHERE adapter_id = ? ORDER BY id DESC LIMIT ?)",
    )
    .bind(adapter_id)
    .bind(adapter_id)
    .bind(VERSUCHE_MAX)
    .execute(conn)
    .await?;
    Ok(id)
}

/// Merkt die Meldung `stufe` zur laufenden Störung vor (LLH-2026), nur wenn sie neu ist:
/// „gestört“ nur ohne Meldung, „braucht Eingriff“ nur, wenn er noch nicht gemeldet ist. `true`,
/// wenn die Zeile sich änderte: dann meldet der Aufrufer nach dem Commit.
pub async fn mark_gemeldet(
    conn: &mut SqliteConnection,
    id: &str,
    stufe: AdapterGemeldet,
) -> Result<bool, sqlx::Error> {
    let bedingung = match stufe {
        AdapterGemeldet::Gestoert => "gemeldet IS NULL",
        AdapterGemeldet::Eingriff => "gemeldet IS NOT 'eingriff'",
    };
    let n = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE adapter SET gemeldet = ? WHERE id = ? AND {bedingung}"
    )))
    .bind(stufe.as_str())
    .bind(id)
    .execute(conn)
    .await?
    .rows_affected();
    Ok(n == 1)
}

/// Löscht den Merker der Störung (LLH-2026): der Adapter läuft wieder, oder ein Admin hat
/// eingegriffen. `true`, wenn er gesetzt war: dann erledigt der Aufrufer die offene Meldung.
pub async fn clear_gemeldet(conn: &mut SqliteConnection, id: &str) -> Result<bool, sqlx::Error> {
    let n = sqlx::query("UPDATE adapter SET gemeldet = NULL WHERE id = ? AND gemeldet IS NOT NULL")
        .bind(id)
        .execute(conn)
        .await?
        .rows_affected();
    Ok(n == 1)
}

/// Die letzten Versuche, neueste zuerst.
pub async fn load_versuche(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Vec<Versuch>, sqlx::Error> {
    sqlx::query_as(
        "SELECT at, probe, status, fehler_art, dauer_ms, anzahl FROM adapter_versuch \
         WHERE adapter_id = ? ORDER BY id DESC",
    )
    .bind(adapter_id)
    .fetch_all(conn)
    .await
}
