//! Mitarbeit nach einer Rückgabe an eine ältere Instanz nachtragen (LLH-2007, Design
//! `docs/superpowers/specs/2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md`).
//!
//! Ein Führer ohne die Einsatzrolle `mitarbeit` bekommt sie als `beobachter`, und der Spiegel
//! hält seine `mitarbeit` gegen das zurückkommende `beobachter` fest
//! (`uebernehmen::keep_mitarbeit`). Rüstet der Führer auf, holt dieses Modul die Rolle dort nach:
//!
//! - **Spiegel:** beim Wechsel der Fähigkeit 0 → 1 die festgehaltenen Mitarbeiten vormerken, im
//!   Abgleich schicken, quittierte löschen.
//! - **Führer:** einen Nachtrag nur unter den Bedingungen aus D4 annehmen, sonst die Zeile neu
//!   ins Log legen, damit der Spiegel dem Führer folgt.

use super::schema;
use crate::einsatz::EinsatzRolle;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

/// Höchstzahl Nachträge und Quittungen je Paket.
pub const NACHTRAEGE_MAX: usize = 100;
/// Höchstens so viele Bytes belegen Nachträge und Quittungen in einem Paket. Sie werden nach den
/// Lieferungen gelesen und kommen wie die Hinweise aus der Reserve ([`super::paket::RESERVE`]).
pub const NACHTRAEGE_BYTES_MAX: usize = 64 * 1024;
/// Längster Schlüssel einer Mitgliedschaft in Byte (`[<Einsatz>,<Konto>]` braucht höchstens 43).
pub const SCHLUESSEL_BYTES_MAX: usize = 64;

/// Ein Nachtrag im Paket, mit den Kennungen des Spiegels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MitarbeitNachtrag {
    /// Kennung der Ausgangszeile; der Führer quittiert sie.
    pub id: i64,
    /// Einsatz beim Führer (`einsatz.kennung` dort).
    pub kennung: String,
    /// Schlüssel der Mitgliedschaft beim Spiegel.
    pub schluessel: String,
    /// Schlüssel der Mitgliedschaft beim Führer, wenn der Spiegel ihn kennt (Herkunft der Zeile).
    #[serde(default)]
    pub gegen: Option<String>,
}

// ── Spiegel ─────────────────────────────────────────────────────────────────────────────────

const TABELLE: &str = "einsatz_mitgliedschaft";

/// Spiegel: Das Gegenüber kennt `mitarbeit` neu (Wechsel 0 → 1, `repo::save_rolle_mitarbeit`).
/// Jede Mitgliedschaft `mitarbeit` in einem Einsatz, den diese Instanz über die Kopplung
/// spiegelt, hat sie gegen den älteren Führer festgehalten: Er konnte die Rolle nie liefern. Sie
/// kommt in den Ausgang (Design D1); eine schon vorgemerkte bleibt einmal stehen.
pub async fn queue_nachtraege(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<(), AppError> {
    let Some(t) = schema::schema(conn).await?.tabelle(TABELLE) else {
        return Ok(());
    };
    let sql = format!(
        "INSERT OR IGNORE INTO mitarbeit_nachtrag (kopplung_id, einsatz_id, schluessel) \
         SELECT ?, m.einsatz_id, {} FROM einsatz_mitgliedschaft m \
         JOIN einsatz e ON e.id = m.einsatz_id \
         JOIN einsatz_spiegel s ON s.einsatz_id = m.einsatz_id \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         WHERE m.einsatz_rolle = ? AND e.spiegel = 1 AND s.beendet_at IS NULL \
         AND o.kopplung_id = ? AND o.widerrufen_at IS NULL",
        t.schluessel.ausdruck("m")
    );
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(kopplung_id)
        .bind(EinsatzRolle::Mitarbeit.as_str())
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Führer: Was an einer Mitgliedschaft nach der Grenze geschieht, ist eine bewusste Wahl, die kein
/// Nachtrag mehr überstimmt (Design D4). Die Grenze ist der Stand, ab dem diese Instanz `mitarbeit`
/// kennt: für eine Kopplung von vor dem Aufrüsten setzt sie die Migration 0366 auf das Aufrüsten,
/// sonst setzt sie der erste Wechsel der Fähigkeit hier. Ein späterer Wechsel verschiebt sie nicht:
/// Eine Wahl zwischen Aufrüsten und erstem Melden bliebe sonst überstimmbar. Der Stand ist ein
/// globaler Zähler (`einsatz_aenderung.stand`, AUTOINCREMENT): Jede spätere Änderung liegt darüber.
pub async fn save_grenze(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET mitarbeit_grenze_stand = COALESCE(mitarbeit_grenze_stand, \
         (SELECT COALESCE(MAX(stand), 0) FROM einsatz_aenderung)) WHERE id = ?",
    )
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Spiegel: die offenen Nachträge für das Paket an diese Kopplung, höchstens
/// [`NACHTRAEGE_MAX`]. Leer, solange das Gegenüber die Rolle nicht kennt, und nur für Spiegel,
/// die noch über diese Kopplung laufen. `gegen` ist der Schlüssel beim Führer, wenn die Zeile von
/// ihm stammt (`spiegel_herkunft`).
pub async fn list_offene(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<MitarbeitNachtrag>, AppError> {
    if !crate::instanz::repo::load_gegenueber_rolle_mitarbeit(conn, kopplung_id).await? {
        return Ok(Vec::new());
    }
    let zeilen: Vec<(i64, String, String, Option<String>)> = sqlx::query_as(
        "SELECT n.id, s.fremde_kennung, n.schluessel, \
           (SELECT h.fremder_schluessel FROM spiegel_herkunft h WHERE h.einsatz_id = n.einsatz_id \
            AND h.art = ? AND h.lokaler_schluessel = n.schluessel) \
         FROM mitarbeit_nachtrag n JOIN einsatz_spiegel s ON s.einsatz_id = n.einsatz_id \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         WHERE n.kopplung_id = ? AND o.kopplung_id = n.kopplung_id \
         AND o.widerrufen_at IS NULL AND s.beendet_at IS NULL ORDER BY n.id LIMIT ?",
    )
    .bind(TABELLE)
    .bind(kopplung_id)
    .bind(NACHTRAEGE_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(id, kennung, schluessel, gegen)| MitarbeitNachtrag {
            id,
            kennung,
            schluessel,
            gegen,
        })
        // Was `SpiegelPaket::check` ablehnte, hielte das ganze Paket an.
        .filter(|n| {
            super::paket::is_kennung_nennbar(&n.kennung)
                && n.schluessel.len() <= SCHLUESSEL_BYTES_MAX
                && n.gegen
                    .as_ref()
                    .is_none_or(|g| g.len() <= SCHLUESSEL_BYTES_MAX)
        })
        .collect())
}

/// Spiegel: Der Führer hat diese Nachträge verarbeitet. Nur Zeilen dieser Kopplung.
pub async fn delete_quittiert(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "DELETE FROM mitarbeit_nachtrag WHERE kopplung_id = ? \
         AND id IN (SELECT value FROM json_each(?))",
    )
    .bind(kopplung_id)
    .bind(serde_json::to_string(ids).expect("ID-Liste serialisierbar"))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Legt eine Mitgliedschaft neu ins Änderungslog (wie der Log-Trigger, `art::trigger_sql`): alte
/// Logzeile weg, neue mit frischem Stand. So geht sie im nächsten Abgleich mit ihrem echten Wert
/// hinaus.
pub(super) async fn relog_mitgliedschaft(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schluessel: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM einsatz_aenderung WHERE einsatz_id = ? AND art = ? AND schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(TABELLE)
    .bind(schluessel)
    .execute(&mut *conn)
    .await?;
    sqlx::query("INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (?, ?, ?)")
        .bind(einsatz_id)
        .bind(TABELLE)
        .bind(schluessel)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ── Führer ──────────────────────────────────────────────────────────────────────────────────

/// Ergebnis von [`accept`]: zu quittierende Nachträge und die Einsätze, deren Mitgliedschaft
/// sich geändert hat (für die Live-Meldung nach dem Commit).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Annahme {
    pub quittungen: Vec<i64>,
    pub einsaetze: Vec<i64>,
}

/// Führer: nimmt die Nachträge eines Spiegels an (Design D4). Angehoben wird nur
/// `beobachter` → `mitarbeit`, nur wenn dieser Einsatz hier geführt wird, die Führung von dieser
/// Kopplung kam und die Zeile seit der Grenze unverändert ist. Kam die Führung von anderswo, wird
/// nicht angehoben, aber neu geloggt (Review-Befund 2). Kennt diese Instanz die Fähigkeit
/// des Spiegels noch nicht, bleibt alles unquittiert: Die angehobene Rolle ginge ihm sonst als
/// `beobachter` zu. Abgelehnt, aber auflösbar: die Zeile neu ins Log, damit der Spiegel dem
/// Führer folgt; steht sie schon auf `mitarbeit` (wiederholter Nachtrag), nur quittieren.
pub async fn accept(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    nachtraege: &[MitarbeitNachtrag],
) -> Result<Annahme, AppError> {
    let mut annahme = Annahme::default();
    if nachtraege.is_empty()
        || !crate::instanz::repo::load_gegenueber_rolle_mitarbeit(conn, kopplung_id).await?
    {
        return Ok(annahme);
    }
    let grenze: Option<i64> =
        sqlx::query_scalar("SELECT mitarbeit_grenze_stand FROM instanz_kopplung WHERE id = ?")
            .bind(kopplung_id)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    for n in nachtraege {
        annahme.quittungen.push(n.id);
        let einsatz: Option<(i64, bool)> = sqlx::query_as(
            "SELECT e.id, COALESCE(f.herkunft_kopplung_id = ?, 0) FROM einsatz e \
             LEFT JOIN einsatz_fuehrung f ON f.einsatz_id = e.id \
             WHERE e.kennung = ? AND e.spiegel = 0",
        )
        .bind(kopplung_id)
        .bind(&n.kennung)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((einsatz_id, fuehrung_von_ihr)) = einsatz else {
            continue;
        };
        let Some(lokal) = schluessel_lokal(conn, einsatz_id, n).await? else {
            continue;
        };
        let rolle: Option<String> = sqlx::query_scalar(
            "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
             WHERE einsatz_id = ? AND json_array(einsatz_id, benutzer_id) = ?",
        )
        .bind(einsatz_id)
        .bind(&lokal)
        .fetch_optional(&mut *conn)
        .await?;
        match rolle.as_deref().map(EinsatzRolle::parse) {
            None | Some(Some(EinsatzRolle::Mitarbeit)) => continue,
            Some(Some(EinsatzRolle::Beobachter)) if fuehrung_von_ihr => {}
            Some(_) => {
                relog_mitgliedschaft(conn, einsatz_id, &lokal).await?;
                continue;
            }
        }
        let bearbeitet = match grenze {
            None => true,
            Some(g) => {
                sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = ? \
                 AND art = ? AND schluessel = ? AND stand > ?)",
                )
                .bind(einsatz_id)
                .bind(TABELLE)
                .bind(&lokal)
                .bind(g)
                .fetch_one(&mut *conn)
                .await?
            }
        };
        if bearbeitet {
            relog_mitgliedschaft(conn, einsatz_id, &lokal).await?;
            continue;
        }
        sqlx::query(
            "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = ? \
             WHERE einsatz_id = ? AND json_array(einsatz_id, benutzer_id) = ?",
        )
        .bind(EinsatzRolle::Mitarbeit.as_str())
        .bind(einsatz_id)
        .bind(&lokal)
        .execute(&mut *conn)
        .await?;
        tracing::info!(einsatz_id, kopplung_id, "Mitarbeit nachgetragen");
        if !annahme.einsaetze.contains(&einsatz_id) {
            annahme.einsaetze.push(einsatz_id);
        }
    }
    Ok(annahme)
}

/// Lokaler Schlüssel der Mitgliedschaft eines Nachtrags: das Gegenstück, wenn es eine
/// Mitgliedschaft dieses Einsatzes nennt, sonst die Herkunft der Zeile (der Führer war Spiegel
/// des Absenders).
async fn schluessel_lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    n: &MitarbeitNachtrag,
) -> Result<Option<String>, AppError> {
    if let Some(gegen) = &n.gegen {
        let gibt: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz_mitgliedschaft \
             WHERE einsatz_id = ? AND json_array(einsatz_id, benutzer_id) = ?)",
        )
        .bind(einsatz_id)
        .bind(gegen)
        .fetch_one(&mut *conn)
        .await?;
        if gibt {
            return Ok(Some(gegen.clone()));
        }
    }
    Ok(super::abbildung::einsatz_lokal(conn, einsatz_id, TABELLE, &n.schluessel).await?)
}
