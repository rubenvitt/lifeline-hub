//! Spiegel und Anträge (LLH-1492, Change `polrv1lt-spiegel-antraege`, Specs `einsatz-spiegel` und
//! `spiegel-antraege`): Eine gekoppelte Instanz, die einen Einsatz nicht führt, hält ihn als
//! Lesekopie in denselben Tabellen wie ihre eigenen Einsätze. Nachgeholt wird über den Stand im
//! Änderungslog je Einsatz; geschrieben wird am Spiegel nur als Antrag an den Führer.
//!
//! - [`art`]: welche Tabellen gespiegelt werden, ihre Kategorie und die Trigger (D1, D3, D10).
//!
//! Änderungslog und Schreibschutz sitzen in Triggern, damit kein Schreibweg sie umgeht.

pub mod abbildung;
pub mod abgleich;
pub mod anhang;
pub mod antrag;
pub mod art;
pub mod katalog;
pub mod lebensende;
pub mod liefern;
pub mod paket;
pub mod schema;
pub mod takt;
pub mod uebernehmen;

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Schließt Stellvertreter fremder Konten aus (design.md D5, Nachtrag 10.11.2026): sie sind keine
/// Personen dieser Instanz, erscheinen in keiner Verwaltung und werden nie Mitglied. Erwartet den
/// Alias `b` für `benutzer`.
pub const OHNE_STELLVERTRETER: &str =
    "NOT EXISTS (SELECT 1 FROM spiegel_konto sk WHERE sk.benutzer_id = b.id)";

/// Spiegel-Angaben eines Einsatzes aus `einsatz_spiegel` (Spec `einsatz-spiegel`, „Der Spiegel
/// zeigt seine Herkunft und seinen Stand“), gelesen von Einsatzkopf und Einsatzliste.
#[derive(Debug, Clone, Default, sqlx::FromRow)]
pub struct SpiegelSpalten {
    pub spiegel_ist: bool,
    pub spiegel_gegenstelle: Option<String>,
    pub spiegel_abgleich_at: Option<String>,
    pub spiegel_beendet_at: Option<String>,
    pub spiegel_ausstehend: i64,
    pub spiegel_abgelehnt: i64,
}

/// Ein Spiegel, wie der Client ihn zeigt (Hinweisband).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzSpiegelAnzeige {
    /// Name der führenden Instanz.
    pub gegenstelle: String,
    /// Letzter erfolgreicher Abgleich (UTC); fehlt vor dem ersten.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_abgleich_at: Option<String>,
    /// Der Abgleich ist beendet (Widerruf); der Spiegel bleibt lesbar.
    pub beendet: bool,
    pub antraege_ausstehend: i64,
    pub antraege_abgelehnt: i64,
}

impl SpiegelSpalten {
    pub fn anzeige(&self) -> Option<EinsatzSpiegelAnzeige> {
        self.spiegel_ist.then(|| EinsatzSpiegelAnzeige {
            gegenstelle: self
                .spiegel_gegenstelle
                .clone()
                .unwrap_or_else(|| "Gegenstelle".into()),
            letzter_abgleich_at: self.spiegel_abgleich_at.clone(),
            beendet: self.spiegel_beendet_at.is_some(),
            antraege_ausstehend: self.spiegel_ausstehend,
            antraege_abgelehnt: self.spiegel_abgelehnt,
        })
    }
}

/// Beendet den Abgleich der Einsätze einer widerrufenen Org-Zuordnung (D14): Spiegel bleiben
/// lesbar und geschützt, offene Anträge an sie sind abgelehnt, gemerkte Stände des Gegenübers
/// fallen weg. Läuft in der Transaktion des Widerrufs, an beiden Seiten.
pub async fn beende_fuer_zuordnung(
    conn: &mut sqlx::SqliteConnection,
    kopplung_org_id: i64,
    jetzt: &str,
) -> Result<(), crate::error::AppError> {
    sqlx::query(
        "UPDATE spiegel_antrag SET zustand = 'abgelehnt', grund = 'Kopplung widerrufen.', \
         geaendert_at = ? WHERE zustand IN ('ausstehend', 'zugestellt') AND einsatz_id IN \
         (SELECT einsatz_id FROM einsatz_spiegel WHERE kopplung_org_id = ?)",
    )
    .bind(jetzt)
    .bind(kopplung_org_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_spiegel SET beendet_at = ? WHERE kopplung_org_id = ? AND beendet_at IS NULL",
    )
    .bind(jetzt)
    .bind(kopplung_org_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM spiegel_ziel WHERE kopplung_org_id = ?")
        .bind(kopplung_org_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Löscht unter dem Merker der Übernahme (LLH-1494): das Abräumen eines Einsatzes
/// (`einsatz::abraeumen`) geht durch die Schutz-Trigger eines Spiegels. Nur `DELETE`, in der
/// Transaktion des Aufrufers; liefert die Zahl gelöschter Zeilen.
pub async fn loeschen_unter_merker(
    conn: &mut sqlx::SqliteConnection,
    sql: &str,
    id: i64,
) -> Result<u64, crate::error::AppError> {
    if !sql.starts_with("DELETE FROM ") {
        return Err(crate::error::AppError::Internal(
            "loeschen_unter_merker: nur DELETE".into(),
        ));
    }
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await?;
    let n = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *conn)
        .await?;
    Ok(n)
}

/// Nachricht, mit der die Schutz-Trigger abbrechen; `AppError` macht daraus 409 (D10).
pub const SCHUTZ_NACHRICHT: &str = "einsatz_ist_spiegel";

wire_enum! {
    /// Kategorie einer gespiegelten Zeile (Spec `einsatz-spiegel`, „Kategorie je Zeile“). Auf der
    /// Leitung steht sie an jeder Zeile, damit sparsamere Freigabestufen später ohne Protokollbruch
    /// kommen können (Entscheidung 14).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
    pub enum SpiegelKategorie {
        Fuehrung => "fuehrung",
        Etb => "etb",
        Lage => "lage",
        Kraefte => "kraefte",
        Personen => "personen",
        Betreuung => "betreuung",
        Kommunikation => "kommunikation",
        Anhaenge => "anhaenge",
    }
}

wire_enum! {
    /// Freigabestufe eines Einsatzes (D2): welche Kategorien gespiegelt werden. Gebaut ist nur
    /// `alles`; eine spiegelnde Seite übernimmt einen Einsatz mit unbekannter Stufe nicht weiter.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
    pub enum Freigabestufe {
        Alles => "alles",
    }
}

impl Freigabestufe {
    /// Ob diese Stufe die Kategorie `k` spiegelt. Lesende Ansichten am Spiegel (Lagebild für
    /// Externe, LLH-1496) zeigen ein Feld nur, wenn seine Kategorie übertragen wird.
    pub fn liefert(&self, _k: SpiegelKategorie) -> bool {
        match self {
            Freigabestufe::Alles => true,
        }
    }
}

#[cfg(test)]
mod tests;
