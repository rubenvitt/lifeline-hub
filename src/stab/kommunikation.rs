//! Kommunikationsplan des S6 (LFH-848): Verbindungen außerhalb des Funks je Stelle.
//!
//! **Gepflegt werden nur Stellen ohne eigenes Heim:** Führungsfunktionen aus dem Katalog
//! (LFH-549) und externe Stellen (Leitstelle, Behörde, Verbindungsperson, sonstige). Abschnitte
//! und Einheiten tragen Kommunikationsmittel und Erreichbarkeit selbst (0047, 0086); der Client
//! leitet ihre Zeilen ab, hier entsteht keine zweite Datenhaltung.
//!
//! **Die Verbindung gehört der Stelle, nicht einer Person.** Wechselt die Besetzung von S2, bleibt
//! „S2 Mobil 0170 …“ stehen; aus dem Einsatzpersonal wird nichts übernommen.
//!
//! Kein ETB-Eintrag je Änderung: der Plan ist ein Arbeitsmittel des S6, kein Führungsnachweis
//! (dieselbe Linie wie die Checkliste, LFH-551).
//!
//! Design: `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md` (D2, D3, D10).

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use crate::error::AppError;
use crate::fuehrung::{Fuehrungsfunktion, Labelkarte};
use crate::wire_enum::wire_enum;
use crate::write_retry;

wire_enum! {
    /// Art einer gepflegten Stelle des Kommunikationsplans. Wire == `as_str()`.
    ///
    /// `ALLE` ist die Anzeigereihenfolge: Funktionen zuerst, dann die externen Stellen in dieser
    /// Folge (die Leitstelle ist die wichtigste Gegenstelle außerhalb des Einsatzes).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Stellenart {
        /// Führungsfunktion aus dem Katalog (`fuehrung::Fuehrungsfunktion`).
        Funktion => "funktion",
        Leitstelle => "leitstelle",
        Behoerde => "behoerde",
        Verbindungsperson => "verbindungsperson",
        Sonstige => "sonstige",
    }
    try_from = |s| format!("Ungültige Stellenart: {s}");
}

wire_enum! {
    /// Mittel einer Verbindung. Wire == `as_str()`.
    ///
    /// Bewusst getrennt von `KOMMUNIKATIONSMITTEL` an Abschnitt und Einheit (drei Schlüssel, eine
    /// Erreichbarkeit je Datensatz, design.md D2). Funk steht im Funkplan; eine ISSI oder
    /// Einzelrufnummer ist `sonstiges` mit Hinweis.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verbindungsmittel {
        Festnetz => "festnetz",
        Mobil => "mobil",
        Fax => "fax",
        Email => "email",
        Messenger => "messenger",
        Melder => "melder",
        Sonstiges => "sonstiges",
    }
    try_from = |s| format!("Ungültiges Verbindungsmittel: {s}");
}

impl Stellenart {
    pub fn ist_extern(&self) -> bool {
        *self != Stellenart::Funktion
    }
}

/// Höchstlänge von Bezeichnung, Wert und Hinweis (Zeichen, nach dem Trimmen).
pub const TEXT_MAX: usize = 200;

/// Eine Verbindung einer Stelle.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct KommunikationsVerbindung {
    pub id: i64,
    pub mittel: Verbindungsmittel,
    pub wert: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hinweis: Option<String>,
}

/// Eine gepflegte Stelle samt ihren Verbindungen.
///
/// `funktion_label` ist das wirksame Mandantenlabel („S3 Einsatz“), vom Server aufgelöst, damit
/// die Seite den Katalog nicht braucht — auch nicht ohne Netz (design.md D3, D9).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct KommunikationsStelle {
    pub id: i64,
    pub stellenart: Stellenart,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion: Option<Fuehrungsfunktion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    pub verbindungen: Vec<KommunikationsVerbindung>,
}

/// Validierte Eingabe zum Anlegen einer Stelle (Invarianten geprüft im Handler).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StelleEingabe {
    pub stellenart: Stellenart,
    pub funktion: Option<Fuehrungsfunktion>,
    pub bezeichnung: Option<String>,
}

/// Validierte Eingabe zum Anlegen einer Verbindung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerbindungEingabe {
    pub mittel: Verbindungsmittel,
    pub wert: String,
    pub hinweis: Option<String>,
}

/// Validierte Teiländerung einer Verbindung: `None` = Feld unverändert, `hinweis: Some(None)`
/// löscht den Hinweis.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerbindungPatch {
    pub mittel: Option<Verbindungsmittel>,
    pub wert: Option<String>,
    pub hinweis: Option<Option<String>>,
}

#[derive(sqlx::FromRow)]
struct StelleRoh {
    id: i64,
    stellenart: String,
    funktion: Option<String>,
    bezeichnung: Option<String>,
    sortier: i64,
}

#[derive(sqlx::FromRow)]
struct VerbindungRoh {
    id: i64,
    stelle_id: i64,
    mittel: String,
    wert: String,
    hinweis: Option<String>,
}

/// Der Kommunikationsplan eines Einsatzes in Anzeigereihenfolge (design.md D3):
/// Funktionen in Katalogfolge (FHP/FB nach Bezeichnung), danach externe Stellen nach
/// [`Stellenart::ALLE`], `sortier`, `id`. Verbindungen in der Reihenfolge ihrer Anlage.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    let mut conn = pool.acquire().await?;
    let karte = crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut conn, einsatz_id).await?;
    laden_conn(&mut conn, einsatz_id, &karte).await
}

async fn laden_conn(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    karte: &Labelkarte,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    let stellen = sqlx::query_as::<_, StelleRoh>(
        "SELECT id, stellenart, funktion, bezeichnung, sortier \
         FROM einsatz_kommunikation_stelle WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let verbindungen = sqlx::query_as::<_, VerbindungRoh>(
        "SELECT id, stelle_id, mittel, wert, hinweis \
         FROM einsatz_kommunikation_verbindung WHERE einsatz_id = ? ORDER BY sortier, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;

    let mut mit_schluessel: Vec<((usize, usize, String, i64, i64), KommunikationsStelle)> = stellen
        .into_iter()
        .map(|s| {
            // Ein unbekannter Wert ist wegen der CHECKs unmöglich; er fiele auf „sonstige“ zurück
            // statt den ganzen Plan scheitern zu lassen.
            let art = Stellenart::parse(&s.stellenart).unwrap_or(Stellenart::Sonstige);
            let funktion = s.funktion.as_deref().and_then(Fuehrungsfunktion::parse);
            let art_rang = Stellenart::ALLE
                .iter()
                .position(|a| *a == art)
                .unwrap_or(usize::MAX);
            let funktion_rang = funktion
                .and_then(|f| Fuehrungsfunktion::ALLE.iter().position(|g| *g == f))
                .unwrap_or(0);
            let bez_schluessel = s.bezeichnung.as_deref().unwrap_or("").to_lowercase();
            let eigene: Vec<KommunikationsVerbindung> = verbindungen
                .iter()
                .filter(|v| v.stelle_id == s.id)
                .map(|v| KommunikationsVerbindung {
                    id: v.id,
                    mittel: Verbindungsmittel::parse(&v.mittel)
                        .unwrap_or(Verbindungsmittel::Sonstiges),
                    wert: v.wert.clone(),
                    hinweis: v.hinweis.clone(),
                })
                .collect();
            // Funktionen ordnen nach Katalog und Bezeichnung, externe Stellen nach Anlage.
            let (bez, sortier) = if art.ist_extern() {
                (String::new(), s.sortier)
            } else {
                (bez_schluessel, 0)
            };
            (
                (art_rang, funktion_rang, bez, sortier, s.id),
                KommunikationsStelle {
                    id: s.id,
                    stellenart: art,
                    funktion,
                    funktion_label: funktion.map(|f| karte.kurz_mit_label(f)),
                    bezeichnung: s.bezeichnung,
                    verbindungen: eigene,
                },
            )
        })
        .collect();
    mit_schluessel.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(mit_schluessel.into_iter().map(|(_, s)| s).collect())
}

/// Lädt die Stelle `stelle_id` des Einsatzes; eine fremde oder unbekannte id ist 404.
async fn stelle_im_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<StelleRoh, AppError> {
    sqlx::query_as::<_, StelleRoh>(
        "SELECT id, stellenart, funktion, bezeichnung, sortier \
         FROM einsatz_kommunikation_stelle WHERE id = ? AND einsatz_id = ?",
    )
    .bind(stelle_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Stelle an. Eine schon vorhandene Funktion (bei FHP/FB: dieselbe Bezeichnung,
/// ohne Groß-/Kleinschreibung) ist 409; der UNIQUE-Index ist das Netz dahinter.
pub async fn stelle_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &StelleEingabe,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        if let Some(f) = eingabe.funktion {
            let vorhanden: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM einsatz_kommunikation_stelle \
                 WHERE einsatz_id = ? AND stellenart = 'funktion' AND funktion = ? \
                   AND lower(COALESCE(bezeichnung, '')) = lower(?)",
            )
            .bind(einsatz_id)
            .bind(f.as_str())
            .bind(eingabe.bezeichnung.as_deref().unwrap_or(""))
            .fetch_optional(&mut *conn)
            .await?;
            if vorhanden.is_some() {
                return Err(AppError::Conflict(
                    "Diese Funktion steht schon im Kommunikationsplan".into(),
                ));
            }
        }
        sqlx::query(
            "INSERT INTO einsatz_kommunikation_stelle \
                (einsatz_id, stellenart, funktion, bezeichnung, sortier, geaendert_von_id) \
             VALUES (?1, ?2, ?3, ?4, \
                     (SELECT COALESCE(MAX(sortier), 0) + 1 FROM einsatz_kommunikation_stelle \
                      WHERE einsatz_id = ?1), ?5)",
        )
        .bind(einsatz_id)
        .bind(eingabe.stellenart.as_str())
        .bind(eingabe.funktion.map(|f| f.as_str()))
        .bind(eingabe.bezeichnung.as_deref())
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

/// Ändert die Bezeichnung einer Stelle. Stellenart und Funktion sind nach dem Anlegen fest
/// (design.md D3). `bezeichnung` ist schon gegen die Stellenart geprüft
/// ([`pruefe_bezeichnung_fuer`]).
pub async fn stelle_umbenennen(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    bezeichnung: Option<&str>,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let stelle = stelle_im_einsatz(conn, einsatz_id, stelle_id).await?;
        let art = Stellenart::parse(&stelle.stellenart).unwrap_or(Stellenart::Sonstige);
        // S7 zählt nur beim Anlegen: eine bestehende Stelle bleibt umbenennbar, auch wenn der
        // Schalter inzwischen aus ist (bestehende Datensätze bleiben lesbar, LFH-549).
        let neu = pruefe_bezeichnung_fuer(art, stelle.funktion.as_deref(), bezeichnung, true)?;
        if let Some(f) = stelle.funktion.as_deref() {
            let vorhanden: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM einsatz_kommunikation_stelle \
                 WHERE einsatz_id = ? AND stellenart = 'funktion' AND funktion = ? AND id <> ? \
                   AND lower(COALESCE(bezeichnung, '')) = lower(?)",
            )
            .bind(einsatz_id)
            .bind(f)
            .bind(stelle_id)
            .bind(neu.as_deref().unwrap_or(""))
            .fetch_optional(&mut *conn)
            .await?;
            if vorhanden.is_some() {
                return Err(AppError::Conflict(
                    "Diese Funktion steht schon im Kommunikationsplan".into(),
                ));
            }
        }
        sqlx::query(
            "UPDATE einsatz_kommunikation_stelle \
             SET bezeichnung = ?, geaendert_von_id = ?, geaendert_at = datetime('now') \
             WHERE id = ?",
        )
        .bind(neu.as_deref())
        .bind(benutzer_id)
        .bind(stelle_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

/// Prüft eine Bezeichnung gegen die Art der Stelle: extern → Pflicht (400 bei leer), Funktion →
/// über `fuehrung::pruefe_funktion` (unbekannter Code 400, Bezeichnung nur bei FHP/FB und dort
/// Pflicht, sonst 422; `s7` nur bei eingeschaltetem S7).
pub fn pruefe_bezeichnung_fuer(
    art: Stellenart,
    funktion: Option<&str>,
    bezeichnung: Option<&str>,
    s7_aktiv: bool,
) -> Result<Option<String>, AppError> {
    let bezeichnung = bezeichnung.map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = bezeichnung {
        if b.chars().count() > TEXT_MAX {
            return Err(AppError::Validation(format!(
                "bezeichnung darf höchstens {TEXT_MAX} Zeichen lang sein"
            )));
        }
    }
    if art.ist_extern() {
        return match bezeichnung {
            Some(b) => Ok(Some(b.to_string())),
            None => Err(AppError::Validation(
                "Eine externe Stelle braucht eine Bezeichnung".into(),
            )),
        };
    }
    let angabe = crate::fuehrung::pruefe_funktion(funktion, bezeichnung, s7_aktiv)?;
    Ok(angabe.text)
}

/// Entfernt eine Stelle samt ihren Verbindungen (CASCADE).
pub async fn stelle_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        stelle_im_einsatz(conn, einsatz_id, stelle_id).await?;
        sqlx::query("DELETE FROM einsatz_kommunikation_stelle WHERE id = ?")
            .bind(stelle_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

/// Hängt eine Verbindung an die Stelle (`sortier` = MAX+1 je Stelle, server-autoritativ).
pub async fn verbindung_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    eingabe: &VerbindungEingabe,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        stelle_im_einsatz(conn, einsatz_id, stelle_id).await?;
        sqlx::query(
            "INSERT INTO einsatz_kommunikation_verbindung \
                (stelle_id, einsatz_id, mittel, wert, hinweis, sortier, geaendert_von_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, \
                     (SELECT COALESCE(MAX(sortier), 0) + 1 FROM einsatz_kommunikation_verbindung \
                      WHERE stelle_id = ?1), ?6)",
        )
        .bind(stelle_id)
        .bind(einsatz_id)
        .bind(eingabe.mittel.as_str())
        .bind(&eingabe.wert)
        .bind(eingabe.hinweis.as_deref())
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

/// Ändert eine Verbindung feldweise; eine fremde oder unbekannte id ist 404.
pub async fn verbindung_aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    verbindung_id: i64,
    benutzer_id: i64,
    patch: &VerbindungPatch,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let treffer = sqlx::query(
            "UPDATE einsatz_kommunikation_verbindung SET \
                mittel = COALESCE(?1, mittel), \
                wert = COALESCE(?2, wert), \
                hinweis = CASE WHEN ?3 = 1 THEN ?4 ELSE hinweis END, \
                geaendert_von_id = ?5, geaendert_at = datetime('now') \
             WHERE id = ?6 AND einsatz_id = ?7",
        )
        .bind(patch.mittel.map(|m| m.as_str()))
        .bind(patch.wert.as_deref())
        .bind(patch.hinweis.is_some())
        .bind(patch.hinweis.clone().flatten())
        .bind(benutzer_id)
        .bind(verbindung_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        if treffer.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

/// Entfernt eine Verbindung; eine fremde oder unbekannte id ist 404.
pub async fn verbindung_entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    verbindung_id: i64,
) -> Result<Vec<KommunikationsStelle>, AppError> {
    write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let treffer = sqlx::query(
            "DELETE FROM einsatz_kommunikation_verbindung WHERE id = ? AND einsatz_id = ?",
        )
        .bind(verbindung_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        if treffer.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })?;
    laden(pool, einsatz_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn stellenart_und_mittel_round_trip() {
        for a in Stellenart::ALLE {
            assert_eq!(Stellenart::parse(a.as_str()), Some(a), "{a:?}");
        }
        for m in Verbindungsmittel::ALLE {
            assert_eq!(Verbindungsmittel::parse(m.as_str()), Some(m), "{m:?}");
        }
        assert_eq!(Verbindungsmittel::parse("brieftaube"), None);
        assert_eq!(
            Stellenart::parse("Leitstelle"),
            None,
            "Wire ist kleingeschrieben"
        );
    }

    #[test]
    fn externe_stelle_braucht_bezeichnung() {
        let err =
            pruefe_bezeichnung_fuer(Stellenart::Leitstelle, None, Some("  "), false).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            pruefe_bezeichnung_fuer(Stellenart::Leitstelle, None, Some(" ILS Nord "), false)
                .unwrap()
                .as_deref(),
            Some("ILS Nord")
        );
    }

    #[test]
    fn funktion_folgt_dem_katalog() {
        // Sachgebiet ohne Bezeichnung: ok; mit Bezeichnung: 422.
        assert_eq!(
            pruefe_bezeichnung_fuer(Stellenart::Funktion, Some("s3"), None, false).unwrap(),
            None
        );
        let err = pruefe_bezeichnung_fuer(Stellenart::Funktion, Some("s3"), Some("Müller"), false)
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
        // Fachberater ohne Bezeichnung: 422.
        let err = pruefe_bezeichnung_fuer(Stellenart::Funktion, Some("fachberater"), None, false)
            .unwrap_err();
        assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn zu_lange_bezeichnung_ist_400() {
        let lang = "x".repeat(TEXT_MAX + 1);
        let err =
            pruefe_bezeichnung_fuer(Stellenart::Behoerde, None, Some(&lang), false).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }
}
