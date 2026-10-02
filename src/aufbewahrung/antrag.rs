//! Schwärzungsanträge — Löschersuchen nach Art. 17 DSGVO (LFH-751, Spec
//! `aufbewahrung-loeschersuchen`).
//!
//! Ein Antrag zielt auf den ganzen Einsatz oder genau eine Person ([`PersonenArt`]). Er ist
//! [`ANTRAG_KARENZ_STUNDEN`](crate::einsatz::retention::ANTRAG_KARENZ_STUNDEN) lang
//! zurücknehmbar; danach vollzieht ihn der Purge-Lauf ([`vollziehe_faellige`]). Stellen,
//! Rücknahme und Vollzug schreiben je einen System-Eintrag ins ETB, der Aktenzeichen und
//! pseudonyme Kennung nennt, nie einen Namen.
//!
//! Alle Schreibvorgänge laufen in `write_retry!` (BEGIN IMMEDIATE) und prüfen den Zustand in
//! derselben Transaktion: Rücknahme und Vollzug sind über `faellig_at` und den offenen Stand
//! bewacht, genau einer gewinnt. Herleitung:
//! `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md`, D1–D4 und D10.

use crate::einsatz::retention::antrag_faellig_at;
use crate::einsatz::schwaerzung_person::{scrubbe_person, PersonenArt};
use crate::einsatz::STATUS_ABGESCHLOSSEN;
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Höchstlänge des Aktenzeichens nach dem Trimmen (Spiegel des DB-CHECKs).
pub const AKTENZEICHEN_MAX: usize = 64;

wire_enum! {
    /// Zielart eines Schwärzungsantrags. Wire == `schwaerzung_antrag.ziel_art`; die vier
    /// Personenarten tragen dieselben Werte wie [`PersonenArt`].
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AntragZielArt {
        Einsatz => "einsatz",
        Betroffene => "betroffene",
        ExterneKraft => "externe_kraft",
        InfotelefonAnruf => "infotelefon_anruf",
        Medienkontakt => "medienkontakt",
    }
}

impl AntragZielArt {
    /// Die Personenart, `None` beim Einsatz.
    pub fn person(self) -> Option<PersonenArt> {
        match self {
            AntragZielArt::Einsatz => None,
            AntragZielArt::Betroffene => Some(PersonenArt::Betroffene),
            AntragZielArt::ExterneKraft => Some(PersonenArt::ExterneKraft),
            AntragZielArt::InfotelefonAnruf => Some(PersonenArt::InfotelefonAnruf),
            AntragZielArt::Medienkontakt => Some(PersonenArt::Medienkontakt),
        }
    }

    pub fn von_person(art: PersonenArt) -> Self {
        match art {
            PersonenArt::Betroffene => AntragZielArt::Betroffene,
            PersonenArt::ExterneKraft => AntragZielArt::ExterneKraft,
            PersonenArt::InfotelefonAnruf => AntragZielArt::InfotelefonAnruf,
            PersonenArt::Medienkontakt => AntragZielArt::Medienkontakt,
        }
    }
}

wire_enum! {
    /// Stand eines Antrags.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AntragStand {
        Offen => "offen",
        Zurueckgenommen => "zurueckgenommen",
        Vollzogen => "vollzogen",
    }
}

/// Ziel eines Antrags, bereits auf Form geprüft (Art bekannt, `id` passend gesetzt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AntragZiel {
    Einsatz,
    Person(PersonenArt, i64),
}

impl AntragZiel {
    fn art(self) -> AntragZielArt {
        match self {
            AntragZiel::Einsatz => AntragZielArt::Einsatz,
            AntragZiel::Person(a, _) => AntragZielArt::von_person(a),
        }
    }

    fn id(self) -> Option<i64> {
        match self {
            AntragZiel::Einsatz => None,
            AntragZiel::Person(_, id) => Some(id),
        }
    }
}

/// Ein Antrag in der Archivakte (`GET …/schwaerzungsantraege`). Das Ziel steht nur als Art und
/// pseudonyme Kennung darin.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SchwaerzungsantragAnzeige {
    pub id: i64,
    pub ziel_art: AntragZielArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_id: Option<i64>,
    /// Einsatznummer bzw. Kennung der Person (`R-042`, `EK-17`, `IT-5`, `MK-3`).
    pub ziel_kennung: String,
    pub aktenzeichen: String,
    pub beantragt_von_name: String,
    pub beantragt_at: String,
    /// Ab hier vollzieht der Purge-Lauf; bis dahin ist der Antrag zurücknehmbar.
    pub faellig_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgenommen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgenommen_von_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vollzogen_at: Option<String>,
    pub stand: AntragStand,
    /// Offen und noch nicht fällig.
    pub zuruecknehmbar: bool,
}

/// Prüft das Aktenzeichen auf Form (400): nach dem Trimmen 1 bis [`AKTENZEICHEN_MAX`] Zeichen.
pub fn pruefe_aktenzeichen(roh: &str) -> Result<String, AppError> {
    let az = roh.trim();
    if az.is_empty() {
        return Err(AppError::Validation("Aktenzeichen fehlt".into()));
    }
    if az.chars().count() > AKTENZEICHEN_MAX {
        return Err(AppError::Validation(format!(
            "Aktenzeichen ist länger als {AKTENZEICHEN_MAX} Zeichen"
        )));
    }
    Ok(az.to_string())
}

/// Kennung des Einsatzes für Bestätigung und Audit: die Einsatznummer, ohne sie `#<id>`.
pub fn einsatz_kennung(einsatznummer: Option<&str>, einsatz_id: i64) -> String {
    einsatznummer
        .map(str::to_string)
        .unwrap_or_else(|| format!("#{einsatz_id}"))
}

/// Ziel im Wortlaut der ETB-Einträge: „Einsatz E-2026-0751“ bzw. „Betroffene Person R-042“.
fn ziel_text(art: AntragZielArt, kennung: &str) -> String {
    match art.person() {
        None => format!("Einsatz {kennung}"),
        Some(p) => format!("{} {kennung}", p.bezeichnung()),
    }
}

/// Kennung einer Person dieses Einsatzes. `Ok(None)`, wenn die Zeile nicht zu diesem Einsatz
/// gehört (→ 404). Eine Personal-Disposition mit Stammdatenbezug ist keine externe Kraft (422).
async fn person_kennung(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    art: PersonenArt,
    id: i64,
) -> Result<Option<String>, AppError> {
    Ok(match art {
        PersonenArt::Betroffene => sqlx::query_scalar::<_, i64>(
            "SELECT registrier_nr FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .map(|nr| art.kennung(id, Some(nr))),
        PersonenArt::ExterneKraft => {
            let stamm: Option<Option<i64>> = sqlx::query_scalar(
                "SELECT personal_id FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            match stamm {
                None => None,
                Some(Some(_)) => {
                    return Err(AppError::UnprocessableEntity(
                        "Die Disposition verweist auf eine Stammkraft — deren Daten sind \
                         Stammdaten der Organisation, kein Gegenstand eines Antrags"
                            .into(),
                    ))
                }
                Some(None) => Some(art.kennung(id, None)),
            }
        }
        PersonenArt::InfotelefonAnruf | PersonenArt::Medienkontakt => {
            let sql = format!(
                "SELECT 1 FROM {} WHERE id = ? AND einsatz_id = ?",
                art.wurzel()
            );
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(sql))
                .bind(id)
                .bind(einsatz_id)
                .fetch_optional(&mut *conn)
                .await?
                .map(|_| art.kennung(id, None))
        }
    })
}

fn system_eintrag<'a>(inhalt: &'a str) -> crate::etb::repo::EintragDaten<'a> {
    crate::etb::repo::EintragDaten {
        typ: crate::etb::TYP_SYSTEM,
        inhalt,
        von: None,
        an: None,
        meldeweg: None,
        veranlassung: None,
        ereigniszeit: None,
        erfasst_lokal_at: None,
        berichtigt_eintrag_id: None,
    }
}

/// Stellt einen Antrag (LFH-751). Prüft in einer Transaktion: Einsatz bekannt (404), eigene
/// Organisation (403), abgeschlossen und nicht geschwärzt (409), Ziel in diesem Einsatz (404,
/// Stammkraft 422), Bestätigung gleich Kennung (422), kein offener oder vollzogener Antrag für
/// dasselbe Ziel (409). Schreibt den Antrag und den ETB-Eintrag des Admins. Liefert die ID.
pub async fn stellen(
    pool: &SqlitePool,
    einsatz_id: i64,
    admin_id: i64,
    admin_org_id: i64,
    ziel: AntragZiel,
    aktenzeichen: &str,
    bestaetigung: &str,
    jetzt: DateTime<Utc>,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let faellig = antrag_faellig_at(jetzt);
    crate::write_retry!(pool, |conn| {
        let kopf: Option<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT org_id, status, geschwaerzt_at, einsatznummer_intern FROM einsatz WHERE id = ?",
        )
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((org_id, status, geschwaerzt_at, nummer)) = kopf else {
            return Err(AppError::NotFound);
        };
        if org_id != admin_org_id {
            return Err(AppError::Forbidden);
        }
        if status != STATUS_ABGESCHLOSSEN {
            return Err(AppError::Conflict(
                "Einsatz ist nicht abgeschlossen — ein Löschersuchen gibt es erst nach dem \
                 Abschluss"
                    .into(),
            ));
        }
        if geschwaerzt_at.is_some() {
            return Err(AppError::Conflict("Einsatz ist bereits geschwärzt".into()));
        }
        let kennung = match ziel {
            AntragZiel::Einsatz => einsatz_kennung(nummer.as_deref(), einsatz_id),
            AntragZiel::Person(art, id) => person_kennung(&mut *conn, einsatz_id, art, id)
                .await?
                .ok_or(AppError::NotFound)?,
        };
        if bestaetigung.trim() != kennung {
            return Err(AppError::UnprocessableEntity(format!(
                "Die Bestätigung stimmt nicht mit der Kennung {kennung} überein"
            )));
        }
        let frueher: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT vollzogen_at FROM schwaerzung_antrag \
             WHERE einsatz_id = ? AND ziel_art = ? AND COALESCE(ziel_id, 0) = ? \
               AND zurueckgenommen_at IS NULL \
             ORDER BY vollzogen_at IS NULL DESC LIMIT 1",
        )
        .bind(einsatz_id)
        .bind(ziel.art().as_str())
        .bind(ziel.id().unwrap_or(0))
        .fetch_optional(&mut *conn)
        .await?;
        match frueher {
            Some((None,)) => {
                return Err(AppError::Conflict(format!(
                    "Für {kennung} besteht bereits ein offener Antrag"
                )))
            }
            Some((Some(_),)) => {
                return Err(AppError::Conflict(format!(
                    "{kennung} ist bereits auf Antrag geschwärzt"
                )))
            }
            None => {}
        }
        let antrag_id: i64 = sqlx::query_scalar(
            "INSERT INTO schwaerzung_antrag (einsatz_id, ziel_art, ziel_id, aktenzeichen, \
                beantragt_von, beantragt_at, faellig_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(ziel.art().as_str())
        .bind(ziel.id())
        .bind(aktenzeichen)
        .bind(admin_id)
        .bind(&jetzt_s)
        .bind(&faellig)
        .fetch_one(&mut *conn)
        .await?;
        let audit = format!(
            "Löschersuchen nach Art. 17 DSGVO (Aktenzeichen {aktenzeichen}) für {} \
             eingegangen. Schwärzung fällig am {faellig} UTC; bis dahin zurücknehmbar.",
            ziel_text(ziel.art(), &kennung)
        );
        crate::etb::repo::anlegen_tx(
            &mut *conn,
            einsatz_id,
            admin_id,
            etb_startwert,
            system_eintrag(&audit),
        )
        .await?;
        Ok(antrag_id)
    })
}

/// Rohzeile eines Antrags.
#[derive(Debug, Clone, sqlx::FromRow)]
struct AntragZeile {
    einsatz_id: i64,
    ziel_art: String,
    ziel_id: Option<i64>,
    aktenzeichen: String,
    beantragt_von: i64,
    zurueckgenommen_at: Option<String>,
    vollzogen_at: Option<String>,
}

const ANTRAG_SPALTEN: &str = "id, einsatz_id, ziel_art, ziel_id, aktenzeichen, beantragt_von, \
     beantragt_at, faellig_at, zurueckgenommen_at, vollzogen_at";

impl AntragZeile {
    fn ziel_art(&self) -> Result<AntragZielArt, AppError> {
        AntragZielArt::parse(&self.ziel_art)
            .ok_or_else(|| AppError::Internal(format!("unbekannte ziel_art {}", self.ziel_art)))
    }
}

/// Kennung des Ziels einer gespeicherten Zeile (für Liste und Audit). Eine Betroffene trägt
/// ihre Registriernummer auch nach der Schwärzung.
async fn gespeicherte_kennung(
    conn: &mut sqlx::SqliteConnection,
    art: AntragZielArt,
    ziel_id: Option<i64>,
    einsatz_id: i64,
) -> Result<String, AppError> {
    match (art.person(), ziel_id) {
        (None, _) => {
            let nummer: Option<String> =
                sqlx::query_scalar("SELECT einsatznummer_intern FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
            Ok(einsatz_kennung(nummer.as_deref(), einsatz_id))
        }
        (Some(PersonenArt::Betroffene), Some(id)) => {
            let nr: Option<i64> =
                sqlx::query_scalar("SELECT registrier_nr FROM einsatz_person WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *conn)
                    .await?;
            Ok(PersonenArt::Betroffene.kennung(id, nr))
        }
        (Some(p), Some(id)) => Ok(p.kennung(id, None)),
        (Some(_), None) => Err(AppError::Internal("Personen-Antrag ohne ziel_id".into())),
    }
}

/// Nimmt einen offenen, noch nicht fälligen Antrag zurück (LFH-751). Bewachtes UPDATE; findet es
/// keine Zeile, wird eingeordnet: unbekannt oder fremder Einsatz 404, sonst 409. Schreibt den
/// ETB-Eintrag des Admins.
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    antrag_id: i64,
    admin_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    crate::write_retry!(pool, |conn| {
        let zeile: Option<AntragZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "UPDATE schwaerzung_antrag SET zurueckgenommen_at = ?1, zurueckgenommen_von = ?2 \
             WHERE id = ?3 AND einsatz_id = ?4 AND zurueckgenommen_at IS NULL \
               AND vollzogen_at IS NULL AND faellig_at > ?1 \
             RETURNING {ANTRAG_SPALTEN}"
        )))
        .bind(&jetzt_s)
        .bind(admin_id)
        .bind(antrag_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(z) = zeile else {
            let vorher: Option<AntragZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT {ANTRAG_SPALTEN} FROM schwaerzung_antrag WHERE id = ? AND einsatz_id = ?"
            )))
            .bind(antrag_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            let Some(v) = vorher else {
                return Err(AppError::NotFound);
            };
            return Err(AppError::Conflict(
                if v.vollzogen_at.is_some() {
                    "Der Antrag ist vollzogen — eine Rücknahme ist nicht mehr möglich"
                } else if v.zurueckgenommen_at.is_some() {
                    "Der Antrag ist bereits zurückgenommen"
                } else {
                    "Die 24 Stunden sind abgelaufen — der Antrag wird im nächsten Purge-Lauf \
                     vollzogen"
                }
                .into(),
            ));
        };
        let kennung =
            gespeicherte_kennung(&mut *conn, z.ziel_art()?, z.ziel_id, einsatz_id).await?;
        let audit = format!(
            "Löschersuchen (Aktenzeichen {}) für {} zurückgenommen.",
            z.aktenzeichen,
            ziel_text(z.ziel_art()?, &kennung)
        );
        crate::etb::repo::anlegen_tx(
            &mut *conn,
            einsatz_id,
            admin_id,
            etb_startwert,
            system_eintrag(&audit),
        )
        .await?;
        Ok(())
    })
}

#[derive(sqlx::FromRow)]
struct ListenZeile {
    id: i64,
    einsatz_id: i64,
    ziel_art: String,
    ziel_id: Option<i64>,
    aktenzeichen: String,
    beantragt_von_name: String,
    beantragt_at: String,
    faellig_at: String,
    zurueckgenommen_at: Option<String>,
    zurueckgenommen_von_name: Option<String>,
    vollzogen_at: Option<String>,
}

/// Alle Anträge eines Einsatzes, neueste zuerst. Liest nur.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<Vec<SchwaerzungsantragAnzeige>, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let zeilen: Vec<ListenZeile> = sqlx::query_as(
        "SELECT a.id, a.einsatz_id, a.ziel_art, a.ziel_id, a.aktenzeichen, \
            b.anzeigename AS beantragt_von_name, a.beantragt_at, a.faellig_at, \
            a.zurueckgenommen_at, z.anzeigename AS zurueckgenommen_von_name, a.vollzogen_at \
         FROM schwaerzung_antrag a \
         JOIN benutzer b ON b.id = a.beantragt_von \
         LEFT JOIN benutzer z ON z.id = a.zurueckgenommen_von \
         WHERE a.einsatz_id = ? ORDER BY a.beantragt_at DESC, a.id DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut conn = pool.acquire().await?;
    let mut aus = Vec::with_capacity(zeilen.len());
    for z in zeilen {
        let art = AntragZielArt::parse(&z.ziel_art)
            .ok_or_else(|| AppError::Internal(format!("unbekannte ziel_art {}", z.ziel_art)))?;
        let kennung = gespeicherte_kennung(&mut conn, art, z.ziel_id, z.einsatz_id).await?;
        let stand = if z.vollzogen_at.is_some() {
            AntragStand::Vollzogen
        } else if z.zurueckgenommen_at.is_some() {
            AntragStand::Zurueckgenommen
        } else {
            AntragStand::Offen
        };
        aus.push(SchwaerzungsantragAnzeige {
            id: z.id,
            ziel_art: art,
            ziel_id: z.ziel_id,
            ziel_kennung: kennung,
            aktenzeichen: z.aktenzeichen,
            beantragt_von_name: z.beantragt_von_name,
            beantragt_at: z.beantragt_at,
            zuruecknehmbar: stand == AntragStand::Offen && z.faellig_at > jetzt_s,
            faellig_at: z.faellig_at,
            zurueckgenommen_at: z.zurueckgenommen_at,
            zurueckgenommen_von_name: z.zurueckgenommen_von_name,
            vollzogen_at: z.vollzogen_at,
            stand,
        });
    }
    Ok(aus)
}

/// Fälligkeit des offenen Einsatz-Antrags eines Einsatzes, falls es einen gibt (für den
/// Zustand `schwaerzung_beantragt`).
pub async fn offener_einsatz_antrag(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT faellig_at FROM schwaerzung_antrag \
         WHERE einsatz_id = ? AND ziel_art = 'einsatz' \
           AND zurueckgenommen_at IS NULL AND vollzogen_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?)
}

/// IDs der fälligen, offenen Anträge (Kandidaten des Purge-Laufs), älteste zuerst.
pub async fn faellige(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM schwaerzung_antrag \
         WHERE zurueckgenommen_at IS NULL AND vollzogen_at IS NULL AND faellig_at <= ? \
         ORDER BY faellig_at, id",
    )
    .bind(crate::zeit::formatiere_utc(jetzt))
    .fetch_all(pool)
    .await?)
}

/// Vollzieht einen fälligen Antrag (LFH-751) — Scrub, Kennzeichen und ETB-Eintrag in EINER
/// Transaktion. `Ok(true)`, wenn etwas geschwärzt wurde (der Aufrufer schreibt dann den WAL
/// zurück), `Ok(false)`, wenn der Antrag nicht (mehr) offen und fällig ist oder der Einsatz
/// schon geschwärzt war (dann nur das Kennzeichen samt Eintrag). Ein Fehler rollt alles zurück;
/// der nächste Lauf versucht es erneut.
///
/// ETB-Erfasser ist die Person, die den Antrag gestellt hat (FK, nie gelöscht), ersatzweise
/// die Akteurskette des Purge-Laufs.
pub async fn vollziehen(
    pool: &SqlitePool,
    antrag_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<bool, AppError> {
    Ok(vollziehen_ergebnis(pool, antrag_id, jetzt).await? != Vollzug::Nichts)
}

/// Wie [`vollziehen`], mit der Art des Vollzugs.
pub async fn vollziehen_ergebnis(
    pool: &SqlitePool,
    antrag_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<Vollzug, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let Some(einsatz_id): Option<i64> =
        sqlx::query_scalar("SELECT einsatz_id FROM schwaerzung_antrag WHERE id = ?")
            .bind(antrag_id)
            .fetch_optional(pool)
            .await?
    else {
        return Ok(Vollzug::Nichts);
    };
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    crate::write_retry!(pool, |conn| {
        let zeile: Option<AntragZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "UPDATE schwaerzung_antrag SET vollzogen_at = ?1 \
             WHERE id = ?2 AND zurueckgenommen_at IS NULL AND vollzogen_at IS NULL \
               AND faellig_at <= ?1 \
             RETURNING {ANTRAG_SPALTEN}"
        )))
        .bind(&jetzt_s)
        .bind(antrag_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(z) = zeile else {
            return Ok(Vollzug::Nichts);
        };
        let art = z.ziel_art()?;
        let kennung = gespeicherte_kennung(&mut *conn, art, z.ziel_id, z.einsatz_id).await?;
        let ziel = ziel_text(art, &kennung);
        let akteur: Option<i64> = sqlx::query_scalar("SELECT id FROM benutzer WHERE id = ?")
            .bind(z.beantragt_von)
            .fetch_optional(&mut *conn)
            .await?;
        let akteur = match akteur {
            Some(a) => a,
            None => crate::einsatz::repo::ermittle_system_akteur(&mut *conn, z.einsatz_id)
                .await?
                .ok_or_else(|| {
                    AppError::Internal(format!(
                        "Vollzug Antrag {antrag_id}: kein ETB-Akteur auffindbar"
                    ))
                })?,
        };
        let geschwaerzt: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(z.einsatz_id)
                .fetch_one(&mut *conn)
                .await?;
        let (audit, geaendert) = if geschwaerzt.is_some() {
            (
                format!(
                    "Löschersuchen (Aktenzeichen {}) für {ziel} erledigt: der Einsatz war \
                     bereits geschwärzt.",
                    z.aktenzeichen
                ),
                Vollzug::Nichts,
            )
        } else {
            match art.person() {
                None => {
                    if !crate::einsatz::repo::schwaerze_einsatz_auf_antrag_tx(
                        &mut *conn,
                        z.einsatz_id,
                        &jetzt_s,
                    )
                    .await?
                    {
                        return Err(AppError::Internal(format!(
                            "Vollzug Antrag {antrag_id}: Einsatz {} nicht schwärzbar",
                            z.einsatz_id
                        )));
                    }
                    // Jeder andere offene Antrag dieses Einsatzes ist damit erledigt.
                    sqlx::query(
                        "UPDATE schwaerzung_antrag SET vollzogen_at = ? \
                         WHERE einsatz_id = ? AND zurueckgenommen_at IS NULL \
                           AND vollzogen_at IS NULL",
                    )
                    .bind(&jetzt_s)
                    .bind(z.einsatz_id)
                    .execute(&mut *conn)
                    .await?;
                    (
                        crate::einsatz::repo::schwaerzungs_audit(&format!(
                            "Löschersuchen nach Art. 17 DSGVO für {ziel}, Aktenzeichen {}",
                            z.aktenzeichen
                        )),
                        Vollzug::Einsatz(z.einsatz_id),
                    )
                }
                Some(p) => {
                    let id = z
                        .ziel_id
                        .ok_or_else(|| AppError::Internal("Personen-Antrag ohne ziel_id".into()))?;
                    scrubbe_person(&mut *conn, z.einsatz_id, p, id).await?;
                    (
                        format!(
                            "Löschersuchen (Aktenzeichen {}) vollzogen: personenbezogene \
                             Angaben von {ziel} unwiderruflich entfernt. Erwähnungen in \
                             Freitexten und im ETB bleiben bis zur Schwärzung des Einsatzes.",
                            z.aktenzeichen
                        ),
                        Vollzug::Person,
                    )
                }
            }
        };
        crate::etb::repo::anlegen_tx(
            &mut *conn,
            z.einsatz_id,
            akteur,
            etb_startwert,
            system_eintrag(&audit),
        )
        .await?;
        Ok(geaendert)
    })
}

/// Was ein Vollzug geschwärzt hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vollzug {
    /// Nichts (nicht mehr offen bzw. fällig, oder der Einsatz war schon geschwärzt).
    Nichts,
    /// Die Werte einer Person.
    Person,
    /// Der ganze Einsatz — er ist danach gesperrt und verschwindet aus den Einsatzlisten.
    Einsatz(i64),
}

/// Vollzieht alle fälligen Anträge (Phase des Purge-Laufs). Liefert die Zahl der Vollzüge, die
/// etwas geschwärzt haben. Ein Fehler bei einem Antrag hält die übrigen nicht auf. Ein
/// geschwärzter Einsatz ist danach gesperrt und wird wie in Phase A aus den Einsatzlisten
/// seiner Leser gemeldet (LFH-734).
pub async fn vollziehe_faellige(
    pool: &SqlitePool,
    live: &crate::live::LiveHub,
    jetzt: DateTime<Utc>,
) -> usize {
    let ids = match faellige(pool, jetzt).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!("Purge Anträge: Abfrage fehlgeschlagen: {e}");
            return 0;
        }
    };
    let mut geschwaerzt = 0;
    for id in ids {
        tracing::warn!(
            antrag_id = id,
            "Purge: Schwärzungsantrag fällig — Vollzug (irreversibel)"
        );
        match vollziehen_ergebnis(pool, id, jetzt).await {
            Ok(Vollzug::Einsatz(einsatz_id)) => {
                geschwaerzt += 1;
                crate::live::org::einsatzliste_melden(pool, live, einsatz_id, &[]).await;
            }
            Ok(Vollzug::Person) => geschwaerzt += 1,
            Ok(Vollzug::Nichts) => {}
            Err(e) => tracing::error!(antrag_id = id, "Vollzug des Antrags fehlgeschlagen: {e}"),
        }
    }
    geschwaerzt
}

#[cfg(test)]
#[path = "antrag_tests.rs"]
mod tests;
