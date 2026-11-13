//! Webhook und Verlauf in der Datenbank (LLH-1656, design.md D1, D2, D7). Schreibende Funktionen
//! nehmen eine Verbindung, damit sie in `write_retry!` laufen; nichts hier schreibt in die Outbox.

use sqlx::{SqliteConnection, SqlitePool};

use super::ziel::Ergebnis;
use super::zustand::NachFehlschlag;
use super::{WebhookFehler, VERLAUF_MAX};
use crate::error::AppError;
use crate::public_api::events::{self, EventType};

/// Ein Webhook, wie er in `maschine_webhook` steht.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Webhook {
    pub id: String,
    pub zugang_id: String,
    pub url: String,
    /// JSON-Liste der Wire-Werte; über [`Webhook::arten`] gelesen.
    #[sqlx(rename = "arten")]
    pub arten_json: String,
    pub lan_erlaubt: bool,
    /// `aktiv` oder `angehalten`.
    pub zustand: String,
    pub cursor: i64,
    pub offen_id: Option<i64>,
    pub fehler_seit: Option<String>,
    pub fehlversuche: i64,
    pub naechster_versuch_at: Option<String>,
    pub letzter_fehler_at: Option<String>,
    pub letzter_fehler_status: Option<i64>,
    pub letzter_fehler_art: Option<String>,
    pub letzter_erfolg_at: Option<String>,
    pub angehalten_at: Option<String>,
    pub verlust_at: Option<String>,
    pub angelegt_at: String,
    pub geaendert_at: String,
}

impl Webhook {
    /// Die gewählten Arten; unbekannte (neuere Version) fallen weg.
    pub fn arten(&self) -> Vec<EventType> {
        serde_json::from_str::<Vec<String>>(&self.arten_json)
            .unwrap_or_default()
            .iter()
            .filter_map(|a| EventType::parse(a))
            .collect()
    }

    pub fn is_angehalten(&self) -> bool {
        self.zustand == "angehalten"
    }

    pub fn letzter_fehler(&self) -> Option<WebhookFehler> {
        self.letzter_fehler_art
            .as_deref()
            .and_then(WebhookFehler::parse)
    }
}

/// Ein Eintrag im Verlauf.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Versuch {
    pub id: i64,
    pub at: String,
    pub ereignis_id: Option<i64>,
    pub test: bool,
    pub status: Option<i64>,
    pub fehler_art: Option<String>,
    pub dauer_ms: i64,
}

const SPALTEN: &str = "id, zugang_id, url, arten, lan_erlaubt, zustand, cursor, offen_id, \
    fehler_seit, fehlversuche, naechster_versuch_at, letzter_fehler_at, letzter_fehler_status, \
    letzter_fehler_art, letzter_erfolg_at, angehalten_at, verlust_at, angelegt_at, geaendert_at";

/// Die Arten als JSON-Liste in fester Reihenfolge (`EventType::ALLE`), ohne Doppelte.
pub fn arten_json(arten: &[EventType]) -> String {
    let liste: Vec<&str> = EventType::ALLE
        .into_iter()
        .filter(|a| arten.contains(a))
        .map(|a| a.as_str())
        .collect();
    serde_json::to_string(&liste).expect("Liste von Texten ist serialisierbar")
}

/// Neuer Stand für das optimistische Lock: `jetzt`, aber streng nach `vorher`. Die Zeit hat
/// Sekunden-Auflösung; zwei Änderungen in derselben Sekunde bekämen sonst denselben Stand, und
/// eine veraltete Änderung ginge durch.
fn neuer_stand(vorher: &str, jetzt: &str) -> String {
    if jetzt > vorher {
        return jetzt.to_string();
    }
    crate::zeit::parse(vorher)
        .map(|t| crate::zeit::formatiere(t + chrono::Duration::seconds(1)))
        .unwrap_or_else(|| jetzt.to_string())
}

/// Der Webhook eines Zugangs.
pub async fn laden_fuer_zugang(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Option<Webhook>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM maschine_webhook WHERE zugang_id = ?"
    )))
    .bind(zugang_id)
    .fetch_optional(&mut *conn)
    .await
}

/// Ein Webhook über seine Kennung.
pub async fn laden(
    conn: &mut SqliteConnection,
    webhook_id: &str,
) -> Result<Option<Webhook>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM maschine_webhook WHERE id = ?"
    )))
    .bind(webhook_id)
    .fetch_optional(&mut *conn)
    .await
}

/// Neue Eingaben eines Webhooks.
#[derive(Debug, Clone)]
pub struct Eingabe {
    pub url: String,
    pub arten: Vec<EventType>,
    pub lan_erlaubt: bool,
}

/// Legt den Webhook eines Zugangs an. Er beginnt beim Höchststand der Outbox (D1). Gibt es schon
/// einen: 409.
pub async fn anlegen(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    eingabe: &Eingabe,
    jetzt: &str,
) -> Result<Webhook, AppError> {
    if laden_fuer_zugang(conn, zugang_id).await?.is_some() {
        return Err(AppError::Conflict(
            "Diese Anbindung hat schon einen Webhook.".into(),
        ));
    }
    let (head, _) = events::stand_lesen(conn).await?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO maschine_webhook \
         (id, zugang_id, url, arten, lan_erlaubt, cursor, angelegt_at, geaendert_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(zugang_id)
    .bind(&eingabe.url)
    .bind(arten_json(&eingabe.arten))
    .bind(eingabe.lan_erlaubt)
    .bind(head)
    .bind(jetzt)
    .bind(jetzt)
    .execute(&mut *conn)
    .await?;
    laden_fuer_zugang(conn, zugang_id)
        .await?
        .ok_or_else(|| AppError::Internal("Webhook verschwunden".into()))
}

/// Ändert Ziel, Arten und LAN-Ausnahme (D7). `basis` ist `geaendert_at`, auf dem die Änderung
/// beruht (409, wenn er nicht mehr stimmt; ohne Basis wird ohne Vergleich geschrieben). Der Cursor bleibt; ein geändertes Ziel setzt die
/// Störung zurück, ein angehaltener Webhook bleibt angehalten. Ohne wirksame Änderung kein
/// Schreiben, und vorher gleich nachher.
pub async fn aendern(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    basis: Option<&str>,
    eingabe: &Eingabe,
    jetzt: &str,
) -> Result<Option<(Webhook, Webhook)>, AppError> {
    let Some(vorher) = laden_fuer_zugang(conn, zugang_id).await? else {
        return Ok(None);
    };
    if basis.is_some_and(|b| b != vorher.geaendert_at) {
        return Err(AppError::Conflict(
            "Der Webhook wurde zwischenzeitlich geändert.".into(),
        ));
    }
    let arten = arten_json(&eingabe.arten);
    if vorher.url == eingabe.url
        && vorher.arten_json == arten
        && vorher.lan_erlaubt == eingabe.lan_erlaubt
    {
        return Ok(Some((vorher.clone(), vorher)));
    }
    let ziel_neu = vorher.url != eingabe.url || vorher.lan_erlaubt != eingabe.lan_erlaubt;
    let stand = neuer_stand(&vorher.geaendert_at, jetzt);
    sqlx::query(
        "UPDATE maschine_webhook SET url = ?1, arten = ?2, lan_erlaubt = ?3, geaendert_at = ?4, \
             verlust_at = NULL, \
             fehler_seit = CASE WHEN ?5 AND zustand = 'aktiv' THEN NULL ELSE fehler_seit END, \
             fehlversuche = CASE WHEN ?5 AND zustand = 'aktiv' THEN 0 ELSE fehlversuche END, \
             naechster_versuch_at = \
                 CASE WHEN ?5 AND zustand = 'aktiv' THEN NULL ELSE naechster_versuch_at END \
         WHERE id = ?6",
    )
    .bind(&eingabe.url)
    .bind(&arten)
    .bind(eingabe.lan_erlaubt)
    .bind(&stand)
    .bind(ziel_neu)
    .bind(&vorher.id)
    .execute(&mut *conn)
    .await?;
    let nachher = laden_fuer_zugang(conn, zugang_id)
        .await?
        .ok_or_else(|| AppError::Internal("Webhook verschwunden".into()))?;
    Ok(Some((vorher, nachher)))
}

/// Entfernt den Webhook samt Verlauf. Liefert den entfernten.
pub async fn entfernen(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Option<Webhook>, AppError> {
    let Some(vorher) = laden_fuer_zugang(conn, zugang_id).await? else {
        return Ok(None);
    };
    sqlx::query("DELETE FROM maschine_webhook WHERE id = ?")
        .bind(&vorher.id)
        .execute(&mut *conn)
        .await?;
    Ok(Some(vorher))
}

/// Nimmt einen angehaltenen Webhook wieder auf (D7). Liegt das wartende Ereignis schon unter der
/// Löschgrenze, setzt er beim Höchststand an und hält den Verlust fest; sonst liefert er der Reihe
/// nach nach. Nicht angehalten: 409.
pub async fn wieder_aufnehmen(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    jetzt: &str,
) -> Result<Option<Webhook>, AppError> {
    let Some(vorher) = laden_fuer_zugang(conn, zugang_id).await? else {
        return Ok(None);
    };
    if !vorher.is_angehalten() {
        return Err(AppError::Conflict(
            "Der Webhook ist nicht angehalten.".into(),
        ));
    }
    let (head, purged_until) = events::stand_lesen(conn).await?;
    let verloren = vorher.offen_id.is_some_and(|offen| offen <= purged_until);
    let stand = neuer_stand(&vorher.geaendert_at, jetzt);
    sqlx::query(
        "UPDATE maschine_webhook SET zustand = 'aktiv', angehalten_at = NULL, \
             fehler_seit = NULL, fehlversuche = 0, naechster_versuch_at = NULL, \
             geaendert_at = ?5, \
             cursor = CASE WHEN ?2 THEN ?3 ELSE cursor END, \
             offen_id = CASE WHEN ?2 THEN NULL ELSE offen_id END, \
             verlust_at = CASE WHEN ?2 THEN ?1 ELSE NULL END \
         WHERE id = ?4",
    )
    .bind(jetzt)
    .bind(verloren)
    .bind(head)
    .bind(&vorher.id)
    .bind(&stand)
    .execute(&mut *conn)
    .await?;
    Ok(laden_fuer_zugang(conn, zugang_id).await?)
}

/// Aktive Webhooks, deren nächster Versuch fällig ist, mit der Org ihres Zugangs.
pub async fn faellige(pool: &SqlitePool, jetzt: &str) -> Result<Vec<Webhook>, sqlx::Error> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM maschine_webhook \
         WHERE zustand = 'aktiv' AND (naechster_versuch_at IS NULL OR naechster_versuch_at <= ?) \
         ORDER BY id"
    )))
    .bind(jetzt)
    .fetch_all(pool)
    .await
}

/// Hält fest, dass ein fälliges Ereignis wartet, falls noch keines vermerkt ist (D2).
pub async fn offen_vermerken(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    ereignis_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE maschine_webhook SET offen_id = ? WHERE id = ? AND offen_id IS NULL")
        .bind(ereignis_id)
        .bind(webhook_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Nichts ist fällig: eine Störung ist vorbei, und der Cursor rückt über übersprungene Zeilen
/// (nicht gewählte Arten, fehlendes Recht) hinweg. Der Aufrufer ruft es nur, wenn sich etwas
/// ändert; so schreibt ein ruhiger Webhook nie.
pub async fn leer_festhalten(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    basis: &str,
    uebersprungen_bis: Option<i64>,
) -> Result<(), sqlx::Error> {
    // Nur auf dem Stand, mit dem gelesen wurde: Hat ein Admin inzwischen eine Art dazugewählt,
    // dürfte eine Zeile dieser Art nicht übersprungen sein; der nächste Takt rechnet neu.
    sqlx::query(
        "UPDATE maschine_webhook SET offen_id = NULL, fehler_seit = NULL, fehlversuche = 0, \
             naechster_versuch_at = NULL, cursor = MAX(cursor, COALESCE(?, cursor)) \
         WHERE id = ? AND geaendert_at = ?",
    )
    .bind(uebersprungen_bis)
    .bind(webhook_id)
    .bind(basis)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Das wartende Ereignis ist gelöscht: beim Höchststand ansetzen, Verlust festhalten. Die
/// Störung um das verlorene Ereignis ist damit vorbei.
pub async fn verlust_festhalten(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    head: i64,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE maschine_webhook SET cursor = MAX(cursor, ?), offen_id = NULL, verlust_at = ?, \
             fehler_seit = NULL, fehlversuche = 0, naechster_versuch_at = NULL \
         WHERE id = ?",
    )
    .bind(head)
    .bind(jetzt)
    .bind(webhook_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ein Ereignis ist zugestellt: Cursor vor, Störung vorbei, Verlaufseintrag. `basis` ist
/// `geaendert_at` beim Laden vor dem Versuch: Hat ein Admin den Webhook seither geändert, gilt
/// der Versuch dem alten Stand, und nur der Verlauf hält ihn fest (dann `false`; das Ereignis
/// kommt erneut, mindestens einmal).
pub async fn erfolg_festhalten(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    basis: &str,
    ereignis_id: i64,
    ergebnis: &Ergebnis,
    jetzt: &str,
) -> Result<bool, sqlx::Error> {
    let gilt = sqlx::query(
        "UPDATE maschine_webhook SET cursor = MAX(cursor, ?), offen_id = NULL, \
             fehler_seit = NULL, fehlversuche = 0, naechster_versuch_at = NULL, \
             letzter_erfolg_at = ? \
         WHERE id = ? AND geaendert_at = ? AND zustand = 'aktiv'",
    )
    .bind(ereignis_id)
    .bind(jetzt)
    .bind(webhook_id)
    .bind(basis)
    .execute(&mut *conn)
    .await?
    .rows_affected()
        > 0;
    versuch_eintragen(conn, webhook_id, Some(ereignis_id), false, ergebnis, jetzt).await?;
    Ok(gilt)
}

/// Ein Versuch ist gescheitert: Störung fortschreiben oder anhalten, Verlaufseintrag. Wie bei
/// [`erfolg_festhalten`] nur auf dem Stand `basis`: Ein Fehlschlag an ein inzwischen geändertes
/// Ziel macht das Zurücksetzen der Störung durch den Admin nicht rückgängig.
pub async fn fehlschlag_festhalten(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    basis: &str,
    ereignis_id: i64,
    ergebnis: &Ergebnis,
    folge: &NachFehlschlag,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    let (fehler_seit, fehlversuche, naechster, angehalten) = match folge {
        NachFehlschlag::Wiederholen {
            fehler_seit,
            fehlversuche,
            naechster_versuch_at,
        } => (
            fehler_seit,
            *fehlversuche,
            Some(naechster_versuch_at),
            false,
        ),
        NachFehlschlag::Anhalten {
            fehler_seit,
            fehlversuche,
        } => (fehler_seit, *fehlversuche, None, true),
    };
    sqlx::query(
        "UPDATE maschine_webhook SET \
             offen_id = COALESCE(offen_id, ?1), \
             fehler_seit = ?2, fehlversuche = ?3, naechster_versuch_at = ?4, \
             letzter_fehler_at = ?5, letzter_fehler_status = ?6, letzter_fehler_art = ?7, \
             zustand = CASE WHEN ?8 THEN 'angehalten' ELSE zustand END, \
             angehalten_at = CASE WHEN ?8 THEN ?5 ELSE angehalten_at END \
         WHERE id = ?9 AND geaendert_at = ?10 AND zustand = 'aktiv'",
    )
    .bind(ereignis_id)
    .bind(fehler_seit)
    .bind(fehlversuche)
    .bind(naechster)
    .bind(jetzt)
    .bind(ergebnis.status.map(i64::from))
    .bind(ergebnis.fehler.map(|f| f.as_str()))
    .bind(angehalten)
    .bind(webhook_id)
    .bind(basis)
    .execute(&mut *conn)
    .await?;
    versuch_eintragen(conn, webhook_id, Some(ereignis_id), false, ergebnis, jetzt).await
}

/// Ein Testereignis: nur ein Verlaufseintrag, sonst nichts (Spec „Testzustellung“).
pub async fn test_festhalten(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    ergebnis: &Ergebnis,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    versuch_eintragen(conn, webhook_id, None, true, ergebnis, jetzt).await
}

async fn versuch_eintragen(
    conn: &mut SqliteConnection,
    webhook_id: &str,
    ereignis_id: Option<i64>,
    test: bool,
    ergebnis: &Ergebnis,
    jetzt: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        // Nur, solange es den Webhook gibt: Hat ein Admin ihn während der Zustellung entfernt,
        // fällt der Eintrag weg, statt am Fremdschlüssel zu scheitern.
        "INSERT INTO maschine_webhook_versuch \
         (webhook_id, at, ereignis_id, test, status, fehler_art, dauer_ms) \
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM maschine_webhook WHERE id = ?1)",
    )
    .bind(webhook_id)
    .bind(jetzt)
    .bind(ereignis_id)
    .bind(test)
    .bind(ergebnis.status.map(i64::from))
    .bind(ergebnis.fehler.map(|f| f.as_str()))
    .bind(ergebnis.dauer_ms)
    .execute(&mut *conn)
    .await?;
    // Nur die letzten VERLAUF_MAX behalten.
    sqlx::query(
        "DELETE FROM maschine_webhook_versuch WHERE webhook_id = ?1 AND id NOT IN \
         (SELECT id FROM maschine_webhook_versuch WHERE webhook_id = ?1 ORDER BY id DESC LIMIT ?2)",
    )
    .bind(webhook_id)
    .bind(VERLAUF_MAX)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Der Verlauf eines Webhooks, neueste zuerst.
pub async fn versuche(
    conn: &mut SqliteConnection,
    webhook_id: &str,
) -> Result<Vec<Versuch>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, at, ereignis_id, test, status, fehler_art, dauer_ms \
         FROM maschine_webhook_versuch WHERE webhook_id = ? ORDER BY id DESC LIMIT ?",
    )
    .bind(webhook_id)
    .bind(VERLAUF_MAX)
    .fetch_all(&mut *conn)
    .await
}

#[cfg(test)]
mod tests {
    use super::neuer_stand;

    #[test]
    fn stand_steigt_auch_in_derselben_sekunde() {
        assert_eq!(
            neuer_stand("2026-11-13 10:00:00", "2026-11-13 10:00:05"),
            "2026-11-13 10:00:05"
        );
        assert_eq!(
            neuer_stand("2026-11-13 10:00:00", "2026-11-13 10:00:00"),
            "2026-11-13 10:00:01"
        );
        // Uhr zurückgestellt: trotzdem nach dem alten Stand.
        assert_eq!(
            neuer_stand("2026-11-13 10:00:09", "2026-11-13 10:00:00"),
            "2026-11-13 10:00:10"
        );
    }
}
