//! Tabelle `ausgang` (LLH-2093, Migration 0383). Schreibwege nehmen eine Verbindung (`_tx`), damit
//! der Aufrufer sie mit ETB und Quellprüfung in einer Transaktion bündelt; die Lesewege der
//! Versandliste und der Lauf nehmen den Pool. Fremde Einsätze sind `NotFound` (404).

use super::zustand::{AusgangFehler, QuelleArt};
use super::{NeuerVersand, Versand, VersandZeile};
use crate::error::AppError;
use crate::externe_stelle::KanalArt;
use crate::write_retry;
use chrono::{DateTime, Utc};
use sqlx::{SqliteConnection, SqlitePool};

/// Alle Spalten von `ausgang` für [`VersandZeile`].
const ZEILE: &str = "id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
     externe_stelle_id, stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, \
     naechster_versuch_at, erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, \
     erstellt_von_id, erstellt_at, uebergeben_at, etb_eintrag_id, anbieter_ref, zugestellt_at, \
     naechste_abfrage_at, ohne_pdf";

/// Spalten der Versandliste (ohne Text), mit dem Namen des Absenders.
const ANZEIGE: &str = "a.id, a.quelle_art, a.quelle_id, a.kanal, a.externe_stelle_id, \
     a.stelle_bezeichnung, a.adresse, a.betreff, a.zustand, a.fehler_art, a.fehler_status, \
     a.versuche, a.erstellt_von_id, b.anzeigename AS erstellt_von_name, a.erstellt_at, \
     a.uebergeben_at, a.zugestellt_at, a.ohne_pdf";

#[derive(sqlx::FromRow)]
struct AnzeigeZeile {
    id: String,
    quelle_art: QuelleArt,
    quelle_id: i64,
    #[sqlx(try_from = "String")]
    kanal: KanalArt,
    externe_stelle_id: Option<i64>,
    stelle_bezeichnung: String,
    adresse: String,
    betreff: String,
    zustand: super::VersandZustand,
    fehler_art: Option<AusgangFehler>,
    fehler_status: Option<i64>,
    versuche: i64,
    erstellt_von_id: i64,
    erstellt_von_name: Option<String>,
    erstellt_at: String,
    uebergeben_at: Option<String>,
    zugestellt_at: Option<String>,
    ohne_pdf: bool,
}

impl From<AnzeigeZeile> for Versand {
    fn from(z: AnzeigeZeile) -> Self {
        Versand {
            id: z.id,
            source_kind: z.quelle_art,
            source_id: z.quelle_id,
            channel: z.kanal,
            agency_id: z.externe_stelle_id,
            agency_name: z.stelle_bezeichnung,
            address: z.adresse,
            subject: z.betreff,
            state: z.zustand,
            error: z.fehler_art,
            smtp_status: z.fehler_status.and_then(|s| u16::try_from(s).ok()),
            attempts: z.versuche,
            created_by_id: z.erstellt_von_id,
            created_by_name: z.erstellt_von_name,
            created_at: z.erstellt_at,
            handed_over_at: z.uebergeben_at,
            delivered_at: z.zugestellt_at,
            without_pdf: z.ohne_pdf,
        }
    }
}

/// Ergebnis eines Zustellversuchs, wie [`save_ergebnis_tx`] es schreibt.
#[derive(Debug, Clone)]
pub enum Ergebnis {
    /// Vom Mailserver bzw. Fax-Anbieter angenommen. Ein Fax trägt die Session des Anbieters
    /// (`anbieter_ref`), danach fragt der Lauf ab ([`super::zustand::erste_abfrage`]); eine Mail
    /// ohne PDF trägt `ohne_pdf`.
    Uebergeben {
        at: DateTime<Utc>,
        anbieter_ref: Option<String>,
        ohne_pdf: bool,
    },
    /// Vorübergehender Fehler: bleibt `wartet`, nächster Versuch zum Zeitpunkt `naechster`.
    Wiederholen {
        naechster: DateTime<Utc>,
        fehler: AusgangFehler,
        status: Option<u16>,
    },
    /// Endgültig `fehlgeschlagen`, ohne weitere Wiederholung.
    Fehlgeschlagen {
        fehler: AusgangFehler,
        status: Option<u16>,
    },
}

fn zeit(t: DateTime<Utc>) -> String {
    crate::zeit::formatiere_utc(t)
}

async fn load_anzeige(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
) -> Result<Versand, AppError> {
    sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.id = ? AND a.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .map(Versand::from)
    .ok_or(AppError::NotFound)
}

/// Legt einen Versand im Zustand `wartet` an, sofort fällig. Dieselbe `(org_id, client_id)` liefert
/// die vorhandene Zeile (doppeltes Absenden), ohne eine zweite zu schreiben.
pub async fn create_tx(
    conn: &mut SqliteConnection,
    neu: &NeuerVersand<'_>,
) -> Result<Versand, AppError> {
    let jetzt = crate::zeit::jetzt();
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ausgang (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
             externe_stelle_id, stelle_bezeichnung, adresse, betreff, inhalt, zustand, \
             naechster_versuch_at, erstellt_von_id, erstellt_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wartet', ?, ?, ?) \
         ON CONFLICT (org_id, client_id) DO NOTHING",
    )
    .bind(&id)
    .bind(neu.org_id)
    .bind(neu.einsatz_id)
    .bind(neu.client_id)
    .bind(neu.quelle.as_str())
    .bind(neu.quelle_id)
    .bind(neu.kanal.channel.as_str())
    .bind(neu.stelle.id)
    .bind(&neu.stelle.bezeichnung)
    .bind(&neu.kanal.address)
    .bind(neu.betreff)
    .bind(neu.inhalt)
    .bind(&jetzt)
    .bind(neu.erstellt_von_id)
    .bind(&jetzt)
    .execute(&mut *conn)
    .await?;
    let vorhanden: String =
        sqlx::query_scalar("SELECT id FROM ausgang WHERE org_id = ? AND client_id = ?")
            .bind(neu.org_id)
            .bind(neu.client_id)
            .fetch_one(&mut *conn)
            .await?;
    load_anzeige(conn, neu.einsatz_id, &vorhanden).await
}

/// Der Versand der Org mit dieser `client_id`, falls es ihn gibt, mit seinem Einsatz. Für die
/// Wiederholung einer Anfrage (Replay) vor jeder Zustandsprüfung.
pub async fn find_by_client_id(
    conn: &mut SqliteConnection,
    org_id: i64,
    client_id: &str,
) -> Result<Option<(i64, Versand)>, AppError> {
    let treffer: Option<(String, i64)> =
        sqlx::query_as("SELECT id, einsatz_id FROM ausgang WHERE org_id = ? AND client_id = ?")
            .bind(org_id)
            .bind(client_id)
            .fetch_optional(&mut *conn)
            .await?;
    match treffer {
        None => Ok(None),
        Some((id, einsatz_id)) => {
            let v = load_anzeige(conn, einsatz_id, &id).await?;
            Ok(Some((einsatz_id, v)))
        }
    }
}

/// Die Versände einer Quelle, neueste zuerst.
pub async fn list_fuer_quelle(
    pool: &SqlitePool,
    einsatz_id: i64,
    quelle: QuelleArt,
    quelle_id: i64,
) -> Result<Vec<Versand>, AppError> {
    let zeilen = sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.einsatz_id = ? AND a.quelle_art = ? AND a.quelle_id = ? \
         ORDER BY a.erstellt_at DESC, a.id"
    )))
    .bind(einsatz_id)
    .bind(quelle.as_str())
    .bind(quelle_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(Versand::from).collect())
}

/// Alle Versände eines Einsatzes, neueste zuerst.
pub async fn list_fuer_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<Versand>, AppError> {
    let zeilen = sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.einsatz_id = ? ORDER BY a.erstellt_at DESC, a.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(Versand::from).collect())
}

/// Eine Zeile mit Text und Merkern; `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn load(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
) -> Result<VersandZeile, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// „Erneut senden“: nur aus `fehlgeschlagen` (sonst 422). Setzt die Versuche zurück, beginnt ein
/// neues Wiederholungsfenster und macht den Versand sofort fällig. Die Prüfung der Quelle liegt
/// beim Aufrufer.
pub async fn retry_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
    jetzt: DateTime<Utc>,
) -> Result<Versand, AppError> {
    load(conn, einsatz_id, id).await?;
    let t = zeit(jetzt);
    let geaendert = sqlx::query(
        "UPDATE ausgang SET zustand = 'wartet', versuche = 0, erster_versuch_at = ?, \
             naechster_versuch_at = ?, versuch_begonnen_at = NULL, fehler_art = NULL, \
             fehler_status = NULL, uebergeben_at = NULL, anbieter_ref = NULL, \
             zugestellt_at = NULL, naechste_abfrage_at = NULL, ohne_pdf = 0 \
         WHERE id = ? AND einsatz_id = ? AND zustand = 'fehlgeschlagen'",
    )
    .bind(&t)
    .bind(&t)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert == 0 {
        return Err(AppError::UnprocessableEntity(
            "Nur ein fehlgeschlagener Versand lässt sich erneut senden".into(),
        ));
    }
    load_anzeige(conn, einsatz_id, id).await
}

/// Fällige Versände: `wartet`, Zeitpunkt erreicht, kein Versuch im Gang; nach Fälligkeit sortiert.
/// Bewusst **nicht** nach Spiegel gefiltert: der Lauf erkennt einen Spiegel und lässt den Versand
/// mit `spiegel` fehlschlagen.
pub async fn load_faellige(
    pool: &SqlitePool,
    jetzt: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<VersandZeile>, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang \
         WHERE zustand = 'wartet' AND naechster_versuch_at <= ? AND versuch_begonnen_at IS NULL \
         ORDER BY naechster_versuch_at, id LIMIT ?"
    )))
    .bind(zeit(jetzt))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Übergebene Faxe, deren nächste Abfrage beim Anbieter fällig ist (LLH-2095, Spec Abschnitt 5);
/// nach Fälligkeit sortiert. Eine Mail hat keine `anbieter_ref` und kommt nie hierher.
pub async fn load_abzufragende(
    pool: &SqlitePool,
    jetzt: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<VersandZeile>, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang \
         WHERE zustand = 'uebergeben' AND anbieter_ref IS NOT NULL \
           AND naechste_abfrage_at <= ? \
         ORDER BY naechste_abfrage_at, id LIMIT ?"
    )))
    .bind(zeit(jetzt))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Ergebnis einer Abfrage beim Fax-Anbieter, wie [`save_abfrage_tx`] es schreibt.
#[derive(Debug, Clone, Copy)]
pub enum Abfrage {
    /// Der Anbieter bestätigt die Zustellung.
    Zugestellt { at: DateTime<Utc> },
    /// Der Anbieter meldet, dass das Fax nicht durchging.
    NichtZugestellt,
    /// Kein Endstand innerhalb der Frist.
    Ungewiss,
    /// Noch kein Endstand: wieder fragen zu `naechste`.
    Weiter { naechste: DateTime<Utc> },
}

/// Schreibt das Ergebnis einer Abfrage, aber nur an einem Fax, das noch `uebergeben` ist.
/// Liefert, ob eine Zeile sich änderte (sonst hat ein anderer Lauf schon abgeschlossen).
pub async fn save_abfrage_tx(
    conn: &mut SqliteConnection,
    id: &str,
    a: Abfrage,
) -> Result<bool, AppError> {
    const BEDINGUNG: &str = "WHERE id = ? AND zustand = 'uebergeben' AND anbieter_ref IS NOT NULL";
    let q = match a {
        Abfrage::Zugestellt { at } => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET zustand = 'zugestellt', zugestellt_at = ?, \
             naechste_abfrage_at = NULL {BEDINGUNG}"
        )))
        .bind(zeit(at)),
        Abfrage::NichtZugestellt => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'nicht_zugestellt', \
             naechste_abfrage_at = NULL {BEDINGUNG}"
        ))),
        Abfrage::Ungewiss => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'ungewiss', \
             naechste_abfrage_at = NULL {BEDINGUNG}"
        ))),
        Abfrage::Weiter { naechste } => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET naechste_abfrage_at = ? {BEDINGUNG}"
        )))
        .bind(zeit(naechste)),
    };
    let n = q.bind(id).execute(&mut *conn).await?.rows_affected();
    Ok(n == 1)
}

/// Beansprucht einen Zustellversuch vor dem Netz: setzt `versuch_begonnen_at`, zählt `versuche`
/// hoch und hält beim ersten Versuch `erster_versuch_at` fest, aber nur, wenn der Versand noch
/// `wartet` und kein anderer Versuch ihn hält. Liefert, ob dieser Aufruf ihn bekam; `false`
/// heißt: ein anderer Durchgang stellt zu oder hat schon abgeschlossen (veraltete Zeile), der
/// Aufrufer bricht ab. Die Marke ist `zeit::formatiere_utc(jetzt)` und geht an
/// [`save_ergebnis_tx`].
pub async fn mark_begonnen(
    pool: &SqlitePool,
    id: &str,
    jetzt: DateTime<Utc>,
) -> Result<bool, AppError> {
    let t = zeit(jetzt);
    write_retry!(pool, |conn| {
        let n = sqlx::query(
            "UPDATE ausgang SET versuch_begonnen_at = ?, versuche = versuche + 1, \
                 erster_versuch_at = COALESCE(erster_versuch_at, ?) \
             WHERE id = ? AND zustand = 'wartet' AND versuch_begonnen_at IS NULL",
        )
        .bind(&t)
        .bind(&t)
        .bind(id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        Ok(n == 1)
    })
}

/// Schreibt das Ergebnis eines Versuchs und leert den Merker `versuch_begonnen_at`, aber nur an
/// einem Versand, der noch `wartet` und dessen Merker `begonnen` ist: `Some(marke)` für den
/// Versuch, den [`mark_begonnen`] (oder ein früherer Lauf) mit dieser Marke beansprucht hat,
/// `None` für einen Abschluss vor dem Netz (kein Versuch begonnen). Liefert, ob eine Zeile sich
/// änderte; `false` heißt: ein anderer Lauf hat den Versand schon abgeschlossen, der Aufrufer
/// schreibt dann keinen ETB-Eintrag.
pub async fn save_ergebnis_tx(
    conn: &mut SqliteConnection,
    id: &str,
    begonnen: Option<&str>,
    ergebnis: Ergebnis,
) -> Result<bool, AppError> {
    // `IS ?` vergleicht auch mit NULL (SQLite).
    const BEDINGUNG: &str = "WHERE id = ? AND zustand = 'wartet' AND versuch_begonnen_at IS ?";
    let q = match ergebnis {
        Ergebnis::Uebergeben {
            at,
            anbieter_ref,
            ohne_pdf,
        } => {
            let abfrage = anbieter_ref
                .as_ref()
                .map(|_| zeit(super::zustand::erste_abfrage(at)));
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE ausgang SET zustand = 'uebergeben', uebergeben_at = ?, \
                 naechster_versuch_at = NULL, versuch_begonnen_at = NULL, fehler_art = NULL, \
                 fehler_status = NULL, anbieter_ref = ?, naechste_abfrage_at = ?, ohne_pdf = ? \
                 {BEDINGUNG}"
            )))
            .bind(zeit(at))
            .bind(anbieter_ref)
            .bind(abfrage)
            .bind(ohne_pdf)
        }
        Ergebnis::Wiederholen {
            naechster,
            fehler,
            status,
        } => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET zustand = 'wartet', naechster_versuch_at = ?, \
                 versuch_begonnen_at = NULL, fehler_art = ?, fehler_status = ? {BEDINGUNG}"
        )))
        .bind(zeit(naechster))
        .bind(fehler.as_str())
        .bind(status.map(i64::from)),
        Ergebnis::Fehlgeschlagen { fehler, status } => sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', naechster_versuch_at = NULL, \
                 versuch_begonnen_at = NULL, fehler_art = ?, fehler_status = ? {BEDINGUNG}"
        )))
        .bind(fehler.as_str())
        .bind(status.map(i64::from)),
    };
    let n = q
        .bind(id)
        .bind(begonnen)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    Ok(n == 1)
}

/// Die schon gesendeten und gemerkten Teile eines Versands (LLH-2094, Spec Abschnitt 6,
/// „Doppelte Nachrichten vermeiden“), aufsteigend; ein späterer Versuch lässt sie aus.
pub async fn list_teile(pool: &SqlitePool, versand_id: &str) -> Result<Vec<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT teil FROM ausgang_teil WHERE versand_id = ? ORDER BY teil")
            .bind(versand_id)
            .fetch_all(pool)
            .await?,
    )
}

/// Merkt gesendete Teile `(teil, event_id)` eines Versands. Ein schon gemerkter Teil behält
/// seine erste Event-ID. Ist der Versand inzwischen weg (Einsatz gelöscht, Kaskade), gibt es
/// nichts mehr zu merken: kein Fehler, nur eine Warnung.
pub async fn save_teile_tx(
    conn: &mut SqliteConnection,
    versand_id: &str,
    teile: &[(i64, String)],
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let at = zeit(at);
    for (teil, event_id) in teile {
        let n = sqlx::query(
            "INSERT INTO ausgang_teil (versand_id, teil, event_id, gesendet_at) \
             SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ausgang WHERE id = ?) \
             ON CONFLICT (versand_id, teil) DO NOTHING",
        )
        .bind(versand_id)
        .bind(teil)
        .bind(event_id)
        .bind(&at)
        .bind(versand_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if n == 0
            && !sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM ausgang WHERE id = ?)")
                .bind(versand_id)
                .fetch_one(&mut *conn)
                .await?
        {
            tracing::warn!(versand = %versand_id, "Ausgang: Versand verschwunden, gesendete Teile nicht gemerkt");
            return Ok(());
        }
    }
    Ok(())
}

/// Der gemerkte öffentliche Schlüssel einer Threema-ID der Org (Hex), falls es einen gibt
/// (LLH-2096).
pub async fn load_threema_schluessel(
    pool: &SqlitePool,
    org_id: i64,
    threema_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT public_key FROM org_threema_schluessel WHERE org_id = ? AND threema_id = ?",
    )
    .bind(org_id)
    .bind(threema_id)
    .fetch_optional(pool)
    .await?)
}

/// Merkt den öffentlichen Schlüssel einer Threema-ID; ein schon gemerkter bleibt, er wird nie
/// überschrieben (LLH-2096).
pub async fn save_threema_schluessel_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    threema_id: &str,
    public_key: &str,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO org_threema_schluessel (org_id, threema_id, public_key, gemerkt_at) \
         VALUES (?, ?, ?, ?) ON CONFLICT (org_id, threema_id) DO NOTHING",
    )
    .bind(org_id)
    .bind(threema_id)
    .bind(public_key)
    .bind(zeit(at))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Merkt den ETB-Eintrag eines Versands (der letzte gewinnt).
pub async fn save_etb_eintrag_tx(
    conn: &mut SqliteConnection,
    id: &str,
    etb_eintrag_id: i64,
) -> Result<(), AppError> {
    sqlx::query("UPDATE ausgang SET etb_eintrag_id = ? WHERE id = ?")
        .bind(etb_eintrag_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Zeilen, die bei einem Neustart mitten in der Zustellung waren (`wartet` mit gesetztem
/// Merker). Der Lauf schließt sie beim Start als `ungewiss` ab, samt ETB-Eintrag.
pub async fn load_unterbrochene(pool: &SqlitePool) -> Result<Vec<VersandZeile>, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang \
         WHERE zustand = 'wartet' AND versuch_begonnen_at IS NOT NULL ORDER BY id"
    )))
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Zeilen, deren Versuch vor `vor` begann und noch immer nicht abgeschlossen ist (`wartet` mit
/// gesetztem Merker); der Lauf schließt sie im Betrieb als `ungewiss` ab.
pub async fn load_haengende(
    pool: &SqlitePool,
    vor: DateTime<Utc>,
) -> Result<Vec<VersandZeile>, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang \
         WHERE zustand = 'wartet' AND versuch_begonnen_at IS NOT NULL \
             AND versuch_begonnen_at < ? ORDER BY id"
    )))
    .bind(zeit(vor))
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Nach einem Neustart: Zeilen mit gesetztem Merker waren mitten in der Zustellung, ob die Mail
/// raus ist, ist unklar. Sie werden `fehlgeschlagen` mit `ungewiss`, ohne Wiederholung. Liefert
/// die Anzahl.
pub async fn recover_unterbrochene(pool: &SqlitePool) -> Result<u64, AppError> {
    write_retry!(pool, |conn| {
        let n = sqlx::query(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'ungewiss', \
                 fehler_status = NULL, naechster_versuch_at = NULL, versuch_begonnen_at = NULL \
             WHERE zustand = 'wartet' AND versuch_begonnen_at IS NOT NULL",
        )
        .execute(&mut *conn)
        .await?
        .rows_affected();
        Ok(n)
    })
}
