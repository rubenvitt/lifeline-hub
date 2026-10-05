//! Persistenz des Presse-Logs (LFH-554): Medienkontakte je Einsatz.
//!
//! **Schreibpfade laufen auf einer offenen Transaktion** (`_tx`, `&mut SqliteConnection`); die
//! Route öffnet sie mit `write_retry!` und publiziert nach dem Commit.
//!
//! **Statuscodes (design.md D2):** 400 für das Feld allein (leeres Medium oder Thema; unbekannte
//! Enum-Werte fängt schon die Route); 422 für den Zusammenhang (Zielstatus passt nicht zur Art,
//! Übergang nicht aus `offen`, `beantwortet` ohne Antwort, Bezug auf eine nicht freigegebene oder
//! fremde Pressemitteilung); 404 für einen fremden Kontakt.
//!
//! **Kein ETB-Eintrag:** das Log ist Arbeitsstand der Pressearbeit; ins ETB geht nur die
//! freigegebene Pressemitteilung (design.md D4/D5), und nur sie bleibt nach der Schwärzung als
//! Nachweis. Die Schwärzung entfernt jeden Freitext des Logs (LFH-901, Linie A).

use sqlx::{SqliteConnection, SqlitePool};

use super::{MedienkontaktAnzeige, MedienkontaktArt, MedienkontaktStatus};
use crate::error::AppError;
use crate::routes::support::pflicht;

/// Eingabe „Medienkontakt erfassen“. Art und Eingang hat die Route gelesen und normalisiert.
#[derive(Debug, Clone)]
pub struct KontaktEingabe {
    pub art: MedienkontaktArt,
    pub medium: String,
    pub thema: String,
    pub kontakt_name: Option<String>,
    pub kontakt_erreichbarkeit: Option<String>,
    pub eingang_at: String,
}

/// Eingabe „Stammangaben ändern“. Fehlt = unverändert; bei den Kontaktangaben leert `Some(None)`.
#[derive(Debug, Clone, Default)]
pub struct KontaktAenderung {
    pub medium: Option<String>,
    pub thema: Option<String>,
    pub kontakt_name: Option<Option<String>>,
    pub kontakt_erreichbarkeit: Option<Option<String>>,
    pub eingang_at: Option<String>,
}

/// Eingabe „Status setzen“.
#[derive(Debug, Clone)]
pub struct StatusWechsel {
    pub ziel: MedienkontaktStatus,
    pub antwort: Option<String>,
    pub freigabe_durch: Option<String>,
    pub pressemitteilung_id: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    art: String,
    medium: String,
    thema: String,
    kontakt_name: Option<String>,
    kontakt_erreichbarkeit: Option<String>,
    eingang_at: String,
    status: String,
    antwort: Option<String>,
    freigabe_durch: Option<String>,
    pressemitteilung_id: Option<i64>,
    bearbeitet_von_id: Option<i64>,
    bearbeitet_von_name: Option<String>,
    bearbeitet_at: Option<String>,
    angelegt_von_id: i64,
    angelegt_at: String,
}

impl TryFrom<Zeile> for MedienkontaktAnzeige {
    type Error = AppError;
    fn try_from(z: Zeile) -> Result<Self, AppError> {
        Ok(Self {
            id: z.id,
            einsatz_id: z.einsatz_id,
            art: MedienkontaktArt::parse(&z.art)
                .ok_or_else(|| AppError::Internal(format!("Unbekannte Art: {}", z.art)))?,
            medium: z.medium,
            thema: z.thema,
            kontakt_name: z.kontakt_name,
            kontakt_erreichbarkeit: z.kontakt_erreichbarkeit,
            eingang_at: z.eingang_at,
            status: MedienkontaktStatus::parse(&z.status)
                .ok_or_else(|| AppError::Internal(format!("Unbekannter Status: {}", z.status)))?,
            antwort: z.antwort,
            freigabe_durch: z.freigabe_durch,
            pressemitteilung_id: z.pressemitteilung_id,
            bearbeitet_von_id: z.bearbeitet_von_id,
            bearbeitet_von_name: z.bearbeitet_von_name,
            bearbeitet_at: z.bearbeitet_at,
            angelegt_von_id: z.angelegt_von_id,
            angelegt_at: z.angelegt_at,
        })
    }
}

macro_rules! kontakt_select {
    () => {
        "SELECT m.id, m.einsatz_id, m.art, m.medium, m.thema, m.kontakt_name, \
                m.kontakt_erreichbarkeit, m.eingang_at, m.status, m.antwort, m.freigabe_durch, \
                m.pressemitteilung_id, m.bearbeitet_von_id, b.anzeigename AS bearbeitet_von_name, \
                m.bearbeitet_at, m.angelegt_von_id, m.angelegt_at \
         FROM medienkontakt m LEFT JOIN benutzer b ON b.id = m.bearbeitet_von_id "
    };
}

/// Alle Medienkontakte des Einsatzes: offene zuerst, dann jüngster Eingang zuerst.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MedienkontaktAnzeige>, AppError> {
    sqlx::query_as::<_, Zeile>(concat!(
        kontakt_select!(),
        "WHERE m.einsatz_id = ? \
         ORDER BY (m.status = 'offen') DESC, m.eingang_at DESC, m.id DESC"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(TryInto::try_into)
    .collect()
}

/// Lädt einen Medienkontakt. `NotFound`, wenn er nicht zum Einsatz gehört.
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<MedienkontaktAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(concat!(
        kontakt_select!(),
        "WHERE m.einsatz_id = ? AND m.id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(executor)
    .await?
    .ok_or(AppError::NotFound)?
    .try_into()
}

fn text_opt(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

/// Legt einen Medienkontakt im Status `offen` an. Liefert die Kennung.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    e: &KontaktEingabe,
) -> Result<i64, AppError> {
    let medium = pflicht(&e.medium, "medium")?;
    let thema = pflicht(&e.thema, "thema")?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO medienkontakt \
            (einsatz_id, art, medium, thema, kontakt_name, kontakt_erreichbarkeit, eingang_at, \
             status, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(e.art.as_str())
    .bind(medium)
    .bind(thema)
    .bind(text_opt(e.kontakt_name.as_deref()))
    .bind(text_opt(e.kontakt_erreichbarkeit.as_deref()))
    .bind(&e.eingang_at)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Ändert die Stammangaben. Status, Antwort und Freigabeangabe ändert nur [`status_tx`].
pub async fn aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    a: &KontaktAenderung,
) -> Result<(), AppError> {
    let alt = laden(&mut *conn, einsatz_id, id).await?;
    let medium = match &a.medium {
        Some(m) => pflicht(m, "medium")?,
        None => alt.medium,
    };
    let thema = match &a.thema {
        Some(t) => pflicht(t, "thema")?,
        None => alt.thema,
    };
    let kontakt_name = match &a.kontakt_name {
        Some(n) => text_opt(n.as_deref()),
        None => alt.kontakt_name,
    };
    let kontakt_erreichbarkeit = match &a.kontakt_erreichbarkeit {
        Some(n) => text_opt(n.as_deref()),
        None => alt.kontakt_erreichbarkeit,
    };
    let eingang_at = a.eingang_at.clone().unwrap_or(alt.eingang_at);
    sqlx::query(
        "UPDATE medienkontakt SET medium = ?, thema = ?, kontakt_name = ?, \
            kontakt_erreichbarkeit = ?, eingang_at = ?, geaendert_at = datetime('now') \
         WHERE einsatz_id = ? AND id = ?",
    )
    .bind(medium)
    .bind(thema)
    .bind(kontakt_name)
    .bind(kontakt_erreichbarkeit)
    .bind(eingang_at)
    .bind(einsatz_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Setzt den Status (design.md D5):
/// - von `offen` in einen Zielstatus, den die Art erlaubt;
/// - aus jedem Zielstatus zurück nach `offen` (Rücknahme, die Antwort bleibt stehen).
///
/// `beantwortet` verlangt eine nichtleere Antwort; ein Bezug auf eine Pressemitteilung ist nur
/// dort erlaubt und nur auf eine freigegebene desselben Einsatzes.
pub async fn status_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    w: &StatusWechsel,
) -> Result<(), AppError> {
    let alt = laden(&mut *conn, einsatz_id, id).await?;
    if alt.status == w.ziel {
        return Err(AppError::UnprocessableEntity(format!(
            "Der Medienkontakt steht bereits auf „{}“",
            w.ziel.as_str()
        )));
    }
    if w.ziel != MedienkontaktStatus::Offen {
        if alt.status != MedienkontaktStatus::Offen {
            return Err(AppError::UnprocessableEntity(
                "Ein erledigter Medienkontakt muss erst wieder geöffnet werden".into(),
            ));
        }
        if !alt.art.erlaubte_ziele().contains(&w.ziel) {
            return Err(AppError::UnprocessableEntity(format!(
                "Ein Medienkontakt der Art „{}“ kann nicht „{}“ werden",
                alt.art.as_str(),
                w.ziel.as_str()
            )));
        }
    }

    let antwort = text_opt(w.antwort.as_deref());
    let freigabe_durch = text_opt(w.freigabe_durch.as_deref());
    if w.ziel == MedienkontaktStatus::Beantwortet && antwort.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Eine beantwortete Anfrage braucht die gegebene Antwort".into(),
        ));
    }
    if let Some(pm) = w.pressemitteilung_id {
        if w.ziel != MedienkontaktStatus::Beantwortet {
            return Err(AppError::UnprocessableEntity(
                "Eine Pressemitteilung lässt sich nur einer Antwort zuordnen".into(),
            ));
        }
        let freigegeben: Option<String> = sqlx::query_scalar(
            "SELECT status FROM pressemitteilung WHERE einsatz_id = ? AND id = ?",
        )
        .bind(einsatz_id)
        .bind(pm)
        .fetch_optional(&mut *conn)
        .await?;
        if freigegeben.as_deref() != Some(crate::vorlagendokument::STATUS_FREIGEGEBEN) {
            return Err(AppError::UnprocessableEntity(
                "Verweisen lässt sich nur auf eine freigegebene Pressemitteilung dieses Einsatzes"
                    .into(),
            ));
        }
    }

    // Die Rücknahme lässt Antwort, Freigabeangabe und Bezug stehen; ein neuer Zielstatus
    // überschreibt nur, was mitkommt.
    let (antwort, freigabe_durch, pressemitteilung_id) = if w.ziel == MedienkontaktStatus::Offen {
        (alt.antwort, alt.freigabe_durch, alt.pressemitteilung_id)
    } else {
        (
            antwort.or(alt.antwort),
            freigabe_durch.or(alt.freigabe_durch),
            w.pressemitteilung_id,
        )
    };
    sqlx::query(
        "UPDATE medienkontakt SET status = ?, antwort = ?, freigabe_durch = ?, \
            pressemitteilung_id = ?, bearbeitet_von_id = ?, bearbeitet_at = ? \
         WHERE einsatz_id = ? AND id = ?",
    )
    .bind(w.ziel.as_str())
    .bind(antwort)
    .bind(freigabe_durch)
    .bind(pressemitteilung_id)
    .bind(benutzer_id)
    .bind(crate::zeit::jetzt())
    .bind(einsatz_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
