//! Bestätigen und Ändern einer Helfer-Kopplung durch die Leitung (Spec
//! `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Ablauf“, Schritt 4, und
//! „Ein Ortungsgerät je Ziel“).
//!
//! - Bestätigen setzt `aktiv`, `bestaetigt_*` und das Ende auf 72 h ab jetzt; dieselbe Route
//!   ändert an einem schon aktiven Helfer Ziel, Person und Ortungsrolle, ohne das Ende zu
//!   verschieben.
//! - Höchstens ein Ortungsgerät je Einheit und je Fahrzeug: die Teilindizes
//!   `ux_helfer_ortung_*` (Migration 0373) sichern es; [`bestaetigen`] prüft vorher und nennt den
//!   bisherigen Halter. Mit `ersetzen` verliert er die Rolle in derselben Transaktion.
//! - Die Person ordnet nur die Leitung zu, und nur, wenn die Organisation „Auch Personen orten“
//!   erlaubt.

use super::HelferStatus;
use crate::error::AppError;
use crate::geraet::repo::{self as geraet_repo, HelferZielSpalte, KopplungEreignis};
use crate::ortung::{self, Ortungsziel};
use sqlx::SqliteConnection;

/// Technische Höchstdauer einer bestätigten Helfer-Kopplung ab der Bestätigung (Spec „Dauer“).
pub const BESTAETIGT_STUNDEN: i64 = 72;

/// Stand einer Helfer-Kopplung für die Schreibwege der Leitung.
#[derive(sqlx::FromRow)]
pub struct HelferStand {
    pub id: i64,
    pub einsatz_id: i64,
    pub anzeigename: String,
    pub helfer_zustand: String,
    /// Nicht widerrufen und nicht abgelaufen.
    pub offen: bool,
    pub einheit_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub person_id: Option<i64>,
}

impl HelferStand {
    pub fn ziel(&self) -> Option<HelferZielSpalte> {
        match (self.einheit_id, self.fahrzeug_id) {
            (Some(id), _) => Some(HelferZielSpalte::Einheit(id)),
            (None, Some(id)) => Some(HelferZielSpalte::Fahrzeug(id)),
            (None, None) => None,
        }
    }

    pub fn ist_unbestaetigt(&self) -> bool {
        self.offen && self.helfer_zustand == HelferStatus::Unbestaetigt.as_str()
    }

    pub fn ist_aktiv(&self) -> bool {
        self.offen && self.helfer_zustand == HelferStatus::Aktiv.as_str()
    }
}

/// Lädt eine Helfer-Kopplung des Einsatzes; eine fremde oder eine andere Ansicht ist 404.
pub async fn stand(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<HelferStand, AppError> {
    sqlx::query_as(
        "SELECT id, einsatz_id, COALESCE(anzeigename, bezeichnung) AS anzeigename, helfer_zustand, \
                (widerrufen_at IS NULL AND laeuft_ab_at > datetime('now')) AS offen, \
                einheit_id, fahrzeug_id, person_id \
         FROM geraet_kopplung WHERE id = ? AND einsatz_id = ? AND ansicht = 'helfer'",
    )
    .bind(kopplung_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Name des Ziels für das ETB: Name der Einheit bzw. Funkrufname des Fahrzeugs.
pub async fn ziel_name(
    conn: &mut SqliteConnection,
    ziel: HelferZielSpalte,
) -> Result<String, AppError> {
    let name: Option<String> = match ziel {
        HelferZielSpalte::Einheit(id) => {
            sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?
        }
        HelferZielSpalte::Fahrzeug(id) => {
            sqlx::query_scalar(concat!(
                "SELECT ",
                crate::fahrzeug::funkrufname_anzeige_sql!("ef"),
                " FROM einsatz_fahrzeug ef WHERE ef.id = ?"
            ))
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
        }
    };
    Ok(name.unwrap_or_default())
}

/// Prüft die Person: eine nicht entlassene Kraft dieses Einsatzes (sonst 422). Liefert ihren
/// Namen.
async fn pruefe_person(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(p.name, ep.snap_name, '') FROM einsatz_personal ep \
         LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.id = ? AND ep.einsatz_id = ? AND ep.beendet_als IS NULL",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    name.ok_or_else(|| {
        AppError::UnprocessableEntity("Die Person gehört nicht zu diesem Einsatz".into())
    })
}

/// Eingabe von [`bestaetigen`], das Ziel schon gegen den Einsatz geprüft.
pub struct Bestaetigung {
    pub ziel: HelferZielSpalte,
    pub person_id: Option<i64>,
    /// Ob die Organisation „Auch Personen orten“ erlaubt.
    pub personen_erlaubt: bool,
    pub ortungsgeraet: bool,
    /// Das bisherige Ortungsgerät des Ziels verliert die Rolle.
    pub ersetzen: bool,
    pub von: i64,
}

/// Ergebnis von [`bestaetigen`].
pub enum Bestaetigt {
    /// Geschrieben. `ersetzt`: Anzeigename des bisherigen Ortungsgeräts; `alte_person`: die
    /// Person, deren Position gelöscht wurde, weil sie nicht mehr zugeordnet ist.
    Ja {
        erstmals: bool,
        ziel_name: String,
        person_name: Option<String>,
        ersetzt: Option<String>,
        alte_person: Option<i64>,
    },
    /// Das Ziel hat schon ein Ortungsgerät; nichts geschrieben.
    Belegt { halter: i64 },
}

/// Bestätigt eine Helfer-Kopplung oder ändert eine aktive (eine Transaktion des Aufrufers).
/// Eine abgelehnte, beendete oder abgelaufene Kopplung → 409; Person ohne Org-Erlaubnis oder
/// außerhalb des Einsatzes → 422.
pub async fn bestaetigen(
    conn: &mut SqliteConnection,
    stand: &HelferStand,
    eingabe: Bestaetigung,
) -> Result<Bestaetigt, AppError> {
    if !stand.ist_unbestaetigt() && !stand.ist_aktiv() {
        return Err(AppError::Conflict(
            "Die Anmeldung ist abgelehnt oder beendet".into(),
        ));
    }
    let einsatz_id = stand.einsatz_id;
    let person_name = match eingabe.person_id {
        Some(_) if !eingabe.personen_erlaubt => {
            return Err(AppError::UnprocessableEntity(
                "Die Organisation erlaubt keine Ortung von Personen".into(),
            ))
        }
        Some(pid) => Some(pruefe_person(conn, einsatz_id, pid).await?),
        None => None,
    };
    let (einheit_id, fahrzeug_id) = match eingabe.ziel {
        HelferZielSpalte::Einheit(id) => (Some(id), None),
        HelferZielSpalte::Fahrzeug(id) => (None, Some(id)),
    };
    let mut ersetzt = None;
    if eingabe.ortungsgeraet {
        // Ein abgelaufenes, nicht widerrufenes Ortungsgerät hielte den Teilindex sonst fest.
        sqlx::query(
            "UPDATE geraet_kopplung SET ortungsgeraet = 0 \
             WHERE ansicht = 'helfer' AND ortungsgeraet = 1 AND widerrufen_at IS NULL \
               AND laeuft_ab_at <= datetime('now') AND (einheit_id = ? OR fahrzeug_id = ?)",
        )
        .bind(einheit_id)
        .bind(fahrzeug_id)
        .execute(&mut *conn)
        .await?;
        let halter: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, COALESCE(anzeigename, bezeichnung) FROM geraet_kopplung \
             WHERE ansicht = 'helfer' AND ortungsgeraet = 1 AND widerrufen_at IS NULL \
               AND id <> ? AND (einheit_id = ? OR fahrzeug_id = ?)",
        )
        .bind(stand.id)
        .bind(einheit_id)
        .bind(fahrzeug_id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some((halter, name)) = halter {
            if !eingabe.ersetzen {
                return Ok(Bestaetigt::Belegt { halter });
            }
            sqlx::query("UPDATE geraet_kopplung SET ortungsgeraet = 0 WHERE id = ?")
                .bind(halter)
                .execute(&mut *conn)
                .await?;
            ersetzt = Some(name);
        }
    }
    let laeuft_ab_at: String = sqlx::query_scalar(
        "UPDATE geraet_kopplung SET helfer_zustand = 'aktiv', einheit_id = ?, fahrzeug_id = ?, \
                person_id = ?, ortungsgeraet = ?, \
                bestaetigt_at = COALESCE(bestaetigt_at, datetime('now')), \
                bestaetigt_von = COALESCE(bestaetigt_von, ?), \
                laeuft_ab_at = CASE WHEN helfer_zustand = 'unbestaetigt' \
                                    THEN datetime('now', ?) ELSE laeuft_ab_at END \
         WHERE id = ? RETURNING laeuft_ab_at",
    )
    .bind(einheit_id)
    .bind(fahrzeug_id)
    .bind(eingabe.person_id)
    .bind(eingabe.ortungsgeraet)
    .bind(eingabe.von)
    .bind(format!("+{BESTAETIGT_STUNDEN} hours"))
    .bind(stand.id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| match &e {
        // Netz unter der Prüfung oben: der Teilindex `ux_helfer_ortung_*`.
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("Das Ziel hat schon ein Ortungsgerät".into())
        }
        _ => e.into(),
    })?;
    sqlx::query("UPDATE session SET expires_at = ? WHERE kopplung_id = ?")
        .bind(&laeuft_ab_at)
        .bind(stand.id)
        .execute(&mut *conn)
        .await?;
    geraet_repo::ereignis(
        &mut *conn,
        stand.id,
        KopplungEreignis::Bestaetigt,
        Some(eingabe.von),
        None,
    )
    .await?;
    let alte_person = stand
        .person_id
        .filter(|alt| Some(*alt) != eingabe.person_id);
    if let Some(alt) = alte_person {
        ortung::loesche_position(conn, Ortungsziel::Person(alt)).await?;
    }
    Ok(Bestaetigt::Ja {
        erstmals: stand.ist_unbestaetigt(),
        ziel_name: ziel_name(conn, eingabe.ziel).await?,
        person_name,
        ersetzt,
        alte_person,
    })
}

/// ETB-Text einer Bestätigung oder Änderung.
pub fn etb_text(
    anzeigename: &str,
    leitung: &str,
    erstmals: bool,
    ziel_name: &str,
    person_name: Option<&str>,
    ortungsgeraet: bool,
    ersetzt: Option<&str>,
) -> String {
    let ziel = match person_name {
        Some(p) => format!("{ziel_name} (Person {p})"),
        None => ziel_name.to_string(),
    };
    let was = if erstmals { "bestätigt" } else { "geändert" };
    let mut text = format!("Helfer „{anzeigename}“ für {ziel} {was} von {leitung}.");
    match (ortungsgeraet, ersetzt) {
        (true, Some(alt)) => {
            text.push_str(&format!(" Ortungsgerät für {ziel_name}, ersetzt „{alt}“."))
        }
        (true, None) => text.push_str(&format!(" Ortungsgerät für {ziel_name}.")),
        (false, _) => {}
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etb_text_nennt_ziel_person_und_ersatz() {
        assert_eq!(
            etb_text("Max M.", "Leitung", true, "San-Trupp 2", None, false, None),
            "Helfer „Max M.“ für San-Trupp 2 bestätigt von Leitung."
        );
        assert_eq!(
            etb_text("B", "L", false, "RTW 1", Some("Erika"), true, Some("A")),
            "Helfer „B“ für RTW 1 (Person Erika) geändert von L. Ortungsgerät für RTW 1, ersetzt „A“."
        );
    }
}
