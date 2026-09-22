//! Persistenz der Ablösung (LFH-635).
//!
//! **Alles, was eine Ablösung verändert, läuft in EINER `write_retry!`-Transaktion**: Schicht,
//! Auto-Fristen des Erinnerungs-Schedulers, Folgeschicht und ETB-Eintrag. Ein 422 mitten im
//! Ablauf lässt deshalb nichts zurück (Spec: „Vollzug mit Folgeschicht", Atomarität).
//!
//! Die Fristen hängen polymorph an der Schicht (`bezug_typ` `abloesung` /
//! `abloesung_vorwarnung`, `bezug_id` = Schicht-ID) — ohne FK, wie alle Auto-Fristen.

use sqlx::{SqliteConnection, SqlitePool};

use super::{
    einstufung, faelligkeit, rhythmus_text, vorwarnzeit, AbloesungAnzeige, AbloesungStatus,
    AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige, RhythmusQuelle,
};
use crate::erinnerung::repo as erinnerung_repo;
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG};
use crate::kommunikation::{OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_VORWARNUNG};
use crate::write_retry;

/// Eingabe „Schicht beginnen" — von der Route validiert (Zeit normalisiert, Rhythmus im
/// Wertebereich).
#[derive(Debug, Clone)]
pub struct BeginnEingabe {
    pub einheit_id: i64,
    pub beginn_at: String,
    /// `None` = Vorgabe des Abschnitts übernehmen.
    pub rhythmus_minuten: Option<i64>,
}

/// Eingabe „Schicht ändern" — jedes Feld tri-state: fehlt = unverändert.
#[derive(Debug, Clone, Default)]
pub struct AenderungEingabe {
    pub beginn_at: Option<String>,
    /// `Some(None)` = zurück zur Vorgabe des Abschnitts.
    pub rhythmus_minuten: Option<Option<i64>>,
    /// `Some(None)` = Planung aufheben.
    pub abloesende_einheit_id: Option<Option<i64>>,
}

/// Eine Zeile, wie sie die Anzeige-Projektion liefert.
#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    einheit_id: i64,
    einheit_name: String,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    abloesende_einheit_id: Option<i64>,
    abloesende_einheit_name: Option<String>,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    vollzogen_at: Option<String>,
    vollzogen_von_id: Option<i64>,
    vorgaenger_id: Option<i64>,
    folgeschicht_id: Option<i64>,
    folgeschicht_laufend: Option<i64>,
    einheit_laeuft_anderswo: i64,
    angelegt_at: String,
}

impl Zeile {
    fn anzeige(self, jetzt: &str) -> AbloesungAnzeige {
        let einstufung = match self.status {
            AbloesungStatus::Laufend => Some(einstufung(&self.faellig_at, jetzt)),
            AbloesungStatus::Abgeloest => None,
        };
        let folge_unberuehrt = match self.folgeschicht_id {
            None => true,
            Some(_) => self.folgeschicht_laufend == Some(1),
        };
        let ruecknehmbar = self.status == AbloesungStatus::Abgeloest
            && folge_unberuehrt
            && self.einheit_laeuft_anderswo == 0;
        AbloesungAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            einheit_id: self.einheit_id,
            einheit_name: self.einheit_name,
            abschnitt_id: self.abschnitt_id,
            abschnitt_name: self.abschnitt_name,
            beginn_at: self.beginn_at,
            rhythmus_minuten: self.rhythmus_minuten,
            rhythmus_quelle: self.rhythmus_quelle,
            faellig_at: self.faellig_at,
            abloesende_einheit_id: self.abloesende_einheit_id,
            abloesende_einheit_name: self.abloesende_einheit_name,
            status: self.status,
            einstufung,
            vollzogen_at: self.vollzogen_at,
            vollzogen_von_id: self.vollzogen_von_id,
            vorgaenger_id: self.vorgaenger_id,
            folgeschicht_id: self.folgeschicht_id,
            ruecknehmbar,
            angelegt_at: self.angelegt_at,
        }
    }
}

/// Anzeige-Projektion. Die Folgeschicht ist die jüngste Schicht mit `vorgaenger_id` = diese.
const ANZEIGE_SELECT: &str = "SELECT a.id, a.einsatz_id, a.einheit_id, e.name AS einheit_name, \
            a.abschnitt_id, s.name AS abschnitt_name, a.beginn_at, a.rhythmus_minuten, \
            a.rhythmus_quelle, a.faellig_at, a.abloesende_einheit_id, \
            ae.name AS abloesende_einheit_name, a.status, a.vollzogen_at, a.vollzogen_von_id, \
            a.vorgaenger_id, \
            (SELECT f.id FROM einsatz_abloesung f WHERE f.vorgaenger_id = a.id \
               ORDER BY f.id DESC LIMIT 1) AS folgeschicht_id, \
            (SELECT f.status = 'laufend' FROM einsatz_abloesung f WHERE f.vorgaenger_id = a.id \
               ORDER BY f.id DESC LIMIT 1) AS folgeschicht_laufend, \
            EXISTS (SELECT 1 FROM einsatz_abloesung o WHERE o.einheit_id = a.einheit_id \
               AND o.status = 'laufend' AND o.id <> a.id) AS einheit_laeuft_anderswo, \
            a.angelegt_at \
     FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatzabschnitt s ON s.id = a.abschnitt_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id";

/// Laufende nach Fälligkeit (die dringendste zuerst), abgelöste nach Vollzug absteigend.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<AbloesungStatus>,
    jetzt: &str,
) -> Result<Vec<AbloesungAnzeige>, AppError> {
    let sql = match status {
        Some(AbloesungStatus::Laufend) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'laufend' \
             ORDER BY a.faellig_at, a.id"
        ),
        Some(AbloesungStatus::Abgeloest) => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.status = 'abgeloest' \
             ORDER BY a.vollzogen_at DESC, a.id DESC"
        ),
        None => format!(
            "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? \
             ORDER BY a.status = 'abgeloest', a.faellig_at, a.id"
        ),
    };
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(sql))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    Ok(zeilen.into_iter().map(|z| z.anzeige(jetzt)).collect())
}

/// Lädt eine Schicht. `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    jetzt: &str,
) -> Result<AbloesungAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? AND a.id = ?"
    )))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .map(|z| z.anzeige(jetzt))
    .ok_or(AppError::NotFound)
}

/// Rhythmus-Vorgaben aller Abschnitte eines Einsatzes, in Abschnitts-Reihenfolge.
pub async fn vorgaben(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<AbloesungVorgabeAnzeige>, AppError> {
    let zeilen: Vec<(i64, String, Option<i64>, i64)> = sqlx::query_as(
        "SELECT s.id, s.name, s.abloesung_rhythmus_minuten, \
                (SELECT COUNT(*) FROM einsatz_abloesung a \
                 WHERE a.abschnitt_id = s.id AND a.status = 'laufend') \
         FROM einsatzabschnitt s WHERE s.einsatz_id = ? ORDER BY s.sortier, s.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(abschnitt_id, abschnitt_name, rhythmus_minuten, laufende_schichten)| {
                AbloesungVorgabeAnzeige {
                    abschnitt_id,
                    abschnitt_name,
                    rhythmus_minuten,
                    laufende_schichten,
                }
            },
        )
        .collect())
}

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

/// Name und Abschnitt einer Einheit des Einsatzes. `NotFound`, wenn sie nicht dazugehört.
async fn einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<(String, Option<i64>), AppError> {
    sqlx::query_as("SELECT name, abschnitt_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Name und Vorgabe eines Abschnitts.
async fn abschnitt_tx(
    conn: &mut SqliteConnection,
    abschnitt_id: i64,
) -> Result<Option<(String, Option<i64>)>, AppError> {
    Ok(
        sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(abschnitt_id)
        .fetch_optional(&mut *conn)
        .await?,
    )
}

async fn hat_laufende_tx(conn: &mut SqliteConnection, einheit_id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung WHERE einheit_id = ? AND status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Rohdaten einer Schicht für die Schreibpfade.
#[derive(sqlx::FromRow)]
struct Roh {
    einheit_id: i64,
    abschnitt_id: Option<i64>,
    beginn_at: String,
    rhythmus_minuten: i64,
    #[sqlx(try_from = "String")]
    rhythmus_quelle: RhythmusQuelle,
    faellig_at: String,
    abloesende_einheit_id: Option<i64>,
    #[sqlx(try_from = "String")]
    status: AbloesungStatus,
    etb_vollzug_id: Option<i64>,
}

async fn roh_tx(conn: &mut SqliteConnection, einsatz_id: i64, id: i64) -> Result<Roh, AppError> {
    sqlx::query_as(
        "SELECT einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
                faellig_at, abloesende_einheit_id, status, etb_vollzug_id \
         FROM einsatz_abloesung WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

fn faellig_oder_400(beginn_at: &str, rhythmus: i64) -> Result<String, AppError> {
    faelligkeit(beginn_at, rhythmus)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'")))
}

/// Setzt die beiden Auto-Fristen einer laufenden Schicht auf ihre Fälligkeit. Liegt die
/// Vorwarnzeit schon hinter `jetzt`, wird eine offene Vorwarnung geschlossen statt verschoben —
/// eine Vorwarnung in der Vergangenheit ist keine mehr.
#[allow(clippy::too_many_arguments)]
async fn setze_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::setze_auto_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        OBJEKT_ABLOESUNG,
        id,
        &format!("Ablösung fällig: {einheit_name}"),
        faellig_at,
    )
    .await?;
    match vorwarnzeit(faellig_at) {
        Some(v) if v.as_str() > jetzt => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_VORWARNUNG,
                id,
                &format!("Ablösung in 30 min: {einheit_name}"),
                &v,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
}

async fn schliesse_fristen_tx(
    conn: &mut SqliteConnection,
    id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt).await
}

async fn loesche_fristen_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await
}

/// Entfernt die Auto-Fristen aller Schichten einer Einheit (LFH-635). Für
/// `einheit::repo::loese_auf_tx`: der CASCADE entfernt die Schichten, die Fristen hängen ohne
/// FK daran und liefen sonst als Geister weiter.
pub async fn loesche_fristen_der_einheit_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<(), AppError> {
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM einsatz_abloesung WHERE einheit_id = ?")
        .bind(einheit_id)
        .fetch_all(&mut *conn)
        .await?;
    for id in ids {
        loesche_fristen_tx(conn, id).await?;
    }
    Ok(())
}

/// Legt eine laufende Schicht an und setzt ihre Fristen. Liefert die neue ID.
#[allow(clippy::too_many_arguments)]
async fn schicht_anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    einheit_name: &str,
    abschnitt_id: Option<i64>,
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgaenger_id: Option<i64>,
    jetzt: &str,
) -> Result<i64, AppError> {
    if hat_laufende_tx(conn, einheit_id).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "Einheit «{einheit_name}» hat bereits eine laufende Schicht"
        )));
    }
    let faellig_at = faellig_oder_400(beginn_at, rhythmus)?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_abloesung \
            (einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
             faellig_at, vorgaenger_id, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(abschnitt_id)
    .bind(beginn_at)
    .bind(rhythmus)
    .bind(quelle.as_str())
    .bind(&faellig_at)
    .bind(vorgaenger_id)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    setze_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        &faellig_at,
        jetzt,
    )
    .await?;
    Ok(id)
}

// ── Schreibpfade ────────────────────────────────────────────────────────────────────────────

/// Schicht beginnen. Ohne eigenen Rhythmus gilt die Vorgabe des Abschnitts der Einheit; fehlt
/// auch die, ist das ein fehlender Pflichtwert → 400 (Spec: „Ungültiger Rhythmus").
pub async fn beginnen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BeginnEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64), AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let (id, etb_id) = write_retry!(pool, |conn| {
        let (name, abschnitt_id) = einheit_tx(conn, einsatz_id, eingabe.einheit_id).await?;
        let abschnitt = match abschnitt_id {
            Some(a) => abschnitt_tx(conn, a).await?,
            None => None,
        };
        let (rhythmus, quelle) = match (eingabe.rhythmus_minuten, &abschnitt) {
            (Some(r), _) => (r, RhythmusQuelle::Einheit),
            (None, Some((_, Some(v)))) => (*v, RhythmusQuelle::Abschnitt),
            (None, _) => {
                return Err(AppError::Validation(
                    "rhythmus_minuten fehlt und der Abschnitt der Einheit hat keine Vorgabe".into(),
                ))
            }
        };
        let id = schicht_anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            eingabe.einheit_id,
            &name,
            abschnitt_id,
            &eingabe.beginn_at,
            rhythmus,
            quelle,
            None,
            jetzt,
        )
        .await?;
        let herkunft = match (quelle, &abschnitt) {
            (RhythmusQuelle::Abschnitt, Some((a, _))) => format!(" (Vorgabe Abschnitt «{a}»)"),
            _ => String::new(),
        };
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!(
                "Ablösung: Schicht von «{name}» begonnen, Rhythmus {}{herkunft}",
                rhythmus_text(rhythmus)
            ),
        )
        .await?;
        Ok((id, etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Schicht ändern (Beginn, Rhythmus, geplante ablösende Einheit). Liefert den ETB-Eintrag nur,
/// wenn sich etwas geändert hat.
pub async fn aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &AenderungEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, Option<i64>), AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let etb_id = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(
                "Eine abgelöste Schicht lässt sich nicht ändern".into(),
            ));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let mut teile: Vec<String> = Vec::new();

        // Rhythmus
        let (rhythmus, quelle) = match eingabe.rhythmus_minuten {
            None => (roh.rhythmus_minuten, roh.rhythmus_quelle),
            Some(Some(r)) => (r, RhythmusQuelle::Einheit),
            Some(None) => {
                let vorgabe = match roh.abschnitt_id {
                    Some(a) => abschnitt_tx(conn, a).await?.and_then(|(_, v)| v),
                    None => None,
                };
                let v = vorgabe.ok_or_else(|| {
                    AppError::UnprocessableEntity(
                        "Der Abschnitt der Schicht hat keine Rhythmus-Vorgabe".into(),
                    )
                })?;
                (v, RhythmusQuelle::Abschnitt)
            }
        };
        if rhythmus != roh.rhythmus_minuten || quelle != roh.rhythmus_quelle {
            let wie = match quelle {
                RhythmusQuelle::Abschnitt => " (Vorgabe des Abschnitts)",
                RhythmusQuelle::Einheit => "",
            };
            teile.push(format!(
                "Rhythmus {} → {}{wie}",
                rhythmus_text(roh.rhythmus_minuten),
                rhythmus_text(rhythmus)
            ));
        }

        // Beginn
        let beginn_at = eingabe.beginn_at.clone().unwrap_or(roh.beginn_at.clone());
        if beginn_at != roh.beginn_at {
            teile.push("Einsatzbeginn geändert".into());
        }

        // Ablösende Einheit
        let abloesende = match eingabe.abloesende_einheit_id {
            None => roh.abloesende_einheit_id,
            Some(v) => v,
        };
        if abloesende != roh.abloesende_einheit_id {
            match abloesende {
                Some(a) if a == roh.einheit_id => {
                    return Err(AppError::UnprocessableEntity(
                        "Eine Einheit kann sich nicht selbst ablösen".into(),
                    ))
                }
                Some(a) => {
                    let (a_name, _) = einheit_tx(conn, einsatz_id, a).await?;
                    teile.push(format!("ablösende Einheit «{a_name}» geplant"));
                }
                None => teile.push("Planung der ablösenden Einheit aufgehoben".into()),
            }
        }

        if teile.is_empty() {
            return Ok(None);
        }
        let faellig_at = faellig_oder_400(&beginn_at, rhythmus)?;
        sqlx::query(
            "UPDATE einsatz_abloesung SET beginn_at = ?, rhythmus_minuten = ?, \
                rhythmus_quelle = ?, faellig_at = ?, abloesende_einheit_id = ? WHERE id = ?",
        )
        .bind(&beginn_at)
        .bind(rhythmus)
        .bind(quelle.as_str())
        .bind(&faellig_at)
        .bind(abloesende)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        if faellig_at != roh.faellig_at {
            setze_fristen_tx(conn, einsatz_id, benutzer_id, id, &name, &faellig_at, jetzt).await?;
        }
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("Ablösung «{name}»: {}", teile.join(", ")),
        )
        .await?;
        Ok(Some(etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Setzt oder entfernt die Rhythmus-Vorgabe eines Abschnitts und zieht die laufenden
/// Schichten nach, die ihr folgen. `NotFound`, wenn der Abschnitt nicht zum Einsatz gehört.
/// Liefert den Entscheidungseintrag nur, wenn sich der Wert geändert hat.
pub async fn vorgabe_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    abschnitt_id: i64,
    benutzer_id: i64,
    rhythmus_minuten: Option<i64>,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    write_retry!(pool, |conn| {
        let (abschnitt_name, vorher): (String, Option<i64>) = sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschnitt_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        if vorher == rhythmus_minuten {
            return Ok(None);
        }
        sqlx::query("UPDATE einsatzabschnitt SET abloesung_rhythmus_minuten = ? WHERE id = ?")
            .bind(rhythmus_minuten)
            .bind(abschnitt_id)
            .execute(&mut *conn)
            .await?;

        // Weitergabe: nur bei einem neuen Wert. Eine entfernte Vorgabe lässt den zuletzt
        // gültigen Rhythmus stehen (Spec: „Vorgabe entfernen").
        if let Some(neu) = rhythmus_minuten {
            let folgende: Vec<(i64, String, i64)> = sqlx::query_as(
                "SELECT a.id, a.beginn_at, a.einheit_id FROM einsatz_abloesung a \
                 WHERE a.einsatz_id = ? AND a.abschnitt_id = ? AND a.status = 'laufend' \
                   AND a.rhythmus_quelle = 'abschnitt'",
            )
            .bind(einsatz_id)
            .bind(abschnitt_id)
            .fetch_all(&mut *conn)
            .await?;
            for (id, beginn_at, einheit_id) in folgende {
                let faellig_at = faellig_oder_400(&beginn_at, neu)?;
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? WHERE id = ?",
                )
                .bind(neu)
                .bind(&faellig_at)
                .bind(id)
                .execute(&mut *conn)
                .await?;
                let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
                setze_fristen_tx(conn, einsatz_id, benutzer_id, id, &name, &faellig_at, jetzt)
                    .await?;
            }
        }

        let inhalt = match (rhythmus_minuten, vorher) {
            (Some(n), Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}» auf {}-Rhythmus gesetzt (vorher {}).",
                rhythmus_text(n),
                rhythmus_text(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Abschnitt «{abschnitt_name}» auf {}-Rhythmus gesetzt.",
                rhythmus_text(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus-Vorgabe aufgehoben (vorher {}).",
                rhythmus_text(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Vollzieht eine laufende Schicht. Mit ablösender Einheit entsteht deren Folgeschicht
/// (Beginn = Vollzug, Rhythmus und Einsatzstelle der abgelösten Schicht).
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    vollzogen_at: &str,
    abloesende_einheit_id: Option<i64>,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64), AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let (folge_id, etb_id) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist bereits abgelöst".into(),
            ));
        }
        if vollzogen_at < roh.beginn_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "Der Vollzug liegt vor dem Beginn der Schicht".into(),
            ));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let abloeser = match abloesende_einheit_id {
            Some(a) if a == roh.einheit_id => {
                return Err(AppError::UnprocessableEntity(
                    "Eine Einheit kann sich nicht selbst ablösen".into(),
                ))
            }
            Some(a) => Some((a, einheit_tx(conn, einsatz_id, a).await?.0)),
            None => None,
        };

        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
                vollzogen_von_id = ?, abloesende_einheit_id = ? WHERE id = ?",
        )
        .bind(vollzogen_at)
        .bind(benutzer_id)
        .bind(abloesende_einheit_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        schliesse_fristen_tx(conn, id, jetzt).await?;

        let folge_id = match &abloeser {
            Some((a, a_name)) => Some(
                schicht_anlegen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    *a,
                    a_name,
                    roh.abschnitt_id,
                    vollzogen_at,
                    roh.rhythmus_minuten,
                    roh.rhythmus_quelle,
                    Some(id),
                    jetzt,
                )
                .await?,
            ),
            None => None,
        };

        let inhalt = match &abloeser {
            Some((_, a_name)) => format!("Ablösung vollzogen: «{name}» durch «{a_name}»."),
            None => format!("Ablösung vollzogen: «{name}» (ohne ablösende Einheit)."),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_MELDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: Some(vollzogen_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        sqlx::query("UPDATE einsatz_abloesung SET etb_vollzug_id = ? WHERE id = ?")
            .bind(etb_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok((folge_id, etb_id))
    })?;
    let abgeloest = laden(pool, einsatz_id, id, jetzt).await?;
    let folgeschicht = match folge_id {
        Some(f) => Some(laden(pool, einsatz_id, f, jetzt).await?),
        None => None,
    };
    Ok((
        AbloesungVollzugAnzeige {
            abgeloest,
            folgeschicht,
        },
        etb_id,
    ))
}

/// Nimmt einen Vollzug zurück, solange die Folgeschicht unberührt (laufend) ist.
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64), AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let etb_id = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Abgeloest {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist nicht abgelöst — es gibt keinen Vollzug zurückzunehmen".into(),
            ));
        }
        let folge: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, status FROM einsatz_abloesung WHERE vorgaenger_id = ? \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some((folge_id, status)) = &folge {
            if status.as_str() != AbloesungStatus::Laufend.as_str() {
                return Err(AppError::UnprocessableEntity(
                    "Die Folgeschicht ist bereits selbst abgelöst — der Vollzug lässt sich nicht mehr zurücknehmen"
                        .into(),
                ));
            }
            loesche_fristen_tx(conn, *folge_id).await?;
            sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
                .bind(folge_id)
                .execute(&mut *conn)
                .await?;
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        if hat_laufende_tx(conn, roh.einheit_id).await? {
            return Err(AppError::UnprocessableEntity(format!(
                "Einheit «{name}» hat inzwischen eine neue laufende Schicht"
            )));
        }
        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'laufend', vollzogen_at = NULL, \
                vollzogen_von_id = NULL, etb_vollzug_id = NULL WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
        // Die Vorwarnung nur wieder öffnen, solange sie noch vor uns liegt.
        if vorwarnzeit(&roh.faellig_at).is_some_and(|v| v.as_str() > jetzt) {
            erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
        }

        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_BERICHTIGUNG,
                inhalt: &format!("Vollzug der Ablösung «{name}» zurückgenommen."),
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: roh.etb_vollzug_id,
            },
        )
        .await?;
        Ok(etb_id)
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

#[cfg(test)]
mod tests;
