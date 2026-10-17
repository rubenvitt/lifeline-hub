//! Hinweise an die Führung zur geplanten ablösenden Einheit (LLH-1131, Spec `kraefte-abloesung`
//! „Hinweise zur ablösenden Einheit“, `benachrichtigungen`).
//!
//! **Was ein Hinweis ist:** eine Benachrichtigung der Art `abloesung_abloeser` an alle, die das
//! Modul Ablösung lesen (`Adressat::ModulLeser("abloesung")`, Gate wie Vorwarnung und
//! Fälligkeit), mit der Schicht als Bezug und dem Ereignis im Bezugstyp (`abloeser_*`). Je
//! Ereignis und Schicht genau einer; der Auslöser bekommt keinen (Spec `benachrichtigungen`).
//!
//! **Woher:** gebildet wird der Anlass in der Transaktion des Schreibwegs
//! ([`anlaesse_tx`]: Kopplung der Zeitachse, Eintreffen und Abruf am Bereitstellungsraum,
//! entfallene Planung), gemeldet erst nach dem Commit über `benachrichtigung::melden`
//! (`routes::abloesung::publish_kopplung`). So sieht der Hinweis nie einen Stand, der
//! zurückgerollt wurde.
//!
//! **Geplant** heißt: die laufende Schicht trägt die Einheit als `abloesende_einheit_id` oder in
//! der Liste `einsatz_abloesung_abloeser` (LLH-1118 Punkt 3; beschrieben ab LLH-1132).

use sqlx::SqliteConnection;

use crate::benachrichtigung::{
    Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::error::AppError;

/// Was ein Schreibweg an der Ablösung bewirkt hat, für die Meldung nach dem Commit: ETB-Einträge
/// (Kurzruf und `LiveEvent::Abloesung`) und Anlässe von Hinweisen.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Wirkung {
    pub etb: Vec<i64>,
    pub anlaesse: Vec<Anlass>,
}

impl Wirkung {
    pub fn is_empty(&self) -> bool {
        self.etb.is_empty() && self.anlaesse.is_empty()
    }

    pub fn append(&mut self, mut andere: Wirkung) {
        self.etb.append(&mut andere.etb);
        self.anlaesse.append(&mut andere.anlaesse);
    }
}

/// Die laufenden Schichten des Einsatzes, die `einheit_id` als ablösende Einheit planen, nach
/// ID: über die Einzelplanung oder einen Eintrag der Ablöser-Liste.
pub(crate) async fn load_geplante_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT a.id FROM einsatz_abloesung a \
         WHERE a.einsatz_id = ? AND a.status = 'laufend' \
           AND (a.abloesende_einheit_id = ? \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_abloeser l \
                           WHERE l.abloesung_id = a.id AND l.einheit_id = ?)) \
         ORDER BY a.id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Je laufender Schicht, die `einheit_id` als ablösende plant, ein Anlass `abloesung_abloeser`
/// mit dem Ereignis `typ` (ein `abloeser_*`-Bezug), ausgelöst von `von`. Leer, wenn die Einheit
/// nirgends geplant ist.
pub(crate) async fn anlaesse_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    typ: BenachrichtigungBezugTyp,
    von: i64,
) -> Result<Vec<Anlass>, AppError> {
    debug_assert!(crate::benachrichtigung::text::abloeser_titel(typ).is_some());
    Ok(load_geplante_tx(conn, einsatz_id, einheit_id)
        .await?
        .into_iter()
        .map(|schicht| anlass(einsatz_id, schicht, typ, von))
        .collect())
}

/// Der Anlass eines Hinweises zur ablösenden Einheit einer Schicht.
pub(crate) fn anlass(
    einsatz_id: i64,
    schicht: i64,
    typ: BenachrichtigungBezugTyp,
    von: i64,
) -> Anlass {
    Anlass::neu(
        einsatz_id,
        BenachrichtigungArt::AbloesungAbloeser,
        Bezug::neu(typ, schicht),
    )
    .von(von)
    .an(Adressat::ModulLeser("abloesung"))
}
