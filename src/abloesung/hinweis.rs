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
//!
//! **Teilbaum eines geplanten Verbands** (LLH-1509, Entscheidung LLH-1310 Punkt 2): das Ereignis
//! einer Untereinheit zählt für die Schicht, die ihren nächsten geplanten Vorfahren plant (wie der
//! Autostart, `kopplung::is_geplanter_abloeser_tx`). Der Hinweis nennt den Verband und hält die
//! Untereinheit fest (`Anlass::durch`). Je Art und Schicht meldet nur das erste Ereignis im
//! Teilbaum: steht eine andere Einheit des Teilbaums schon im selben Zustand (alarmiert,
//! eingetroffen, im Raum, abgerufen), bleibt es still. Ebenso „… gestrichen“: erst, wenn im
//! Teilbaum keine Einheit mehr alarmiert bzw. eingetroffen ist. Plant die Schicht die Einheit
//! selbst, gilt dieselbe Regel für ihren eigenen Teilbaum; ohne Ereignisse darin bleibt alles wie
//! bisher.

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

/// Die laufenden Schichten, die `einheit_id` oder einen ihrer Vorfahren als ablösende planen
/// (LLH-1509), je Schicht einmal mit der nächsten geplanten Einheit der Kette: `(Schicht,
/// geplante Einheit)`, die Einheit selbst vor ihren Vorfahren. Die Kette läuft über
/// `ueber_einheit_id` mit Besucht-Menge, ein korrupter Zyklus terminiert.
pub(crate) async fn load_geplante_vorfahren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Vec<(i64, i64)>, AppError> {
    let mut besucht = std::collections::HashSet::new();
    let mut schichten = std::collections::HashSet::new();
    let mut ergebnis = Vec::new();
    let mut knoten = Some(einheit_id);
    while let Some(k) = knoten {
        if !besucht.insert(k) {
            break;
        }
        for schicht in load_geplante_tx(conn, einsatz_id, k).await? {
            if schichten.insert(schicht) {
                ergebnis.push((schicht, k));
            }
        }
        knoten = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(k)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
    }
    Ok(ergebnis)
}

/// Je laufender Schicht, die `einheit_id` oder einen ihrer Vorfahren als ablösende plant
/// ([`load_geplante_vorfahren_tx`]), ein Anlass `abloesung_abloeser` mit dem Ereignis `typ` (ein
/// `abloeser_*`-Bezug), ausgelöst von `von`, mit der geplanten Einheit festgehalten (LLH-1511)
/// und, ist es ein Vorfahr, `einheit_id` als auslösende Untereinheit (LLH-1509). Nur das erste
/// Ereignis im Teilbaum der geplanten Einheit meldet ([`is_teilbaum_im_zustand_tx`]). Leer, wenn
/// nichts davon geplant ist.
pub(crate) async fn anlaesse_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    typ: BenachrichtigungBezugTyp,
    von: i64,
) -> Result<Vec<Anlass>, AppError> {
    debug_assert!(crate::benachrichtigung::text::abloeser_titel(typ).is_some());
    let mut anlaesse = Vec::new();
    for (schicht, geplant) in load_geplante_vorfahren_tx(conn, einsatz_id, einheit_id).await? {
        if is_teilbaum_im_zustand_tx(conn, einsatz_id, geplant, einheit_id, typ).await? {
            continue;
        }
        let a = anlass(einsatz_id, schicht, typ, von).einheit(geplant);
        anlaesse.push(if geplant == einheit_id {
            a
        } else {
            a.durch(einheit_id)
        });
    }
    Ok(anlaesse)
}

/// Ob eine andere Einheit als `ausloeser` im Teilbaum von `geplant` (sie selbst und ihre
/// aktiven Untereinheiten, `repo::load_untereinheiten_tx`) schon im Zustand steht, den `typ`
/// meldet (LLH-1509): alarmiert bzw. eingetroffen (Beginn ihrer offenen Periode, wie
/// `kopplung`), im Bereitstellungsraum, abgerufen (Abruf-Ereignis im Raum, in dem sie steht; vom
/// Abruf des Auslösers mitgenommene zählen nicht, sie gehören zu seinem Ereignis). Dann hat der
/// Teilbaum dieses Ereignis schon gemeldet, bzw. ist es nach einer Streichung noch offen.
async fn is_teilbaum_im_zustand_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    geplant: i64,
    ausloeser: i64,
    typ: BenachrichtigungBezugTyp,
) -> Result<bool, AppError> {
    use BenachrichtigungBezugTyp as B;
    let mut teilbaum = super::repo::load_untereinheiten_tx(conn, einsatz_id, geplant).await?;
    teilbaum.insert(0, geplant);
    for k in teilbaum.into_iter().filter(|&k| k != ausloeser) {
        let im_zustand = match typ {
            B::AbloeserAlarmiert | B::AbloeserAlarmierungGestrichen => {
                crate::zeitachse::repo::offene_alarmierung_tx(conn, k)
                    .await?
                    .is_some()
            }
            B::AbloeserEingetroffen | B::AbloeserEintreffenGestrichen => {
                crate::zeitachse::repo::offenes_eintreffen_tx(conn, k)
                    .await?
                    .is_some()
            }
            B::AbloeserBrEingetroffen => sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ? \
                   AND aufgeloest_at IS NULL AND aktueller_br_id IS NOT NULL",
            )
            .bind(k)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?
            .is_some(),
            B::AbloeserAbgerufen => sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM einsatz_einheit e \
                 JOIN br_belegung b ON b.id = ( \
                     SELECT MAX(x.id) FROM br_belegung x \
                     WHERE x.objekt_typ = 'einheit' AND x.objekt_id = e.id \
                       AND x.einsatz_id = e.einsatz_id) \
                 LEFT JOIN br_belegung w ON w.id = b.mit_abruf_id \
                 WHERE e.id = ? AND e.einsatz_id = ? AND e.aufgeloest_at IS NULL \
                   AND b.art = 'abruf' AND b.br_id = e.aktueller_br_id \
                   AND NOT (w.objekt_typ IS 'einheit' AND w.objekt_id IS ?)",
            )
            .bind(k)
            .bind(einsatz_id)
            .bind(ausloeser)
            .fetch_optional(&mut *conn)
            .await?
            .is_some(),
            _ => false,
        };
        if im_zustand {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Der Anlass eines Hinweises zur ablösenden Einheit einer Schicht. Die gemeinte Einheit hält
/// [`Anlass::einheit`] fest (LLH-1511); ohne sie liest die Detailzeile den Spiegel der Schicht,
/// also die gerade geplante, nicht die gemeinte Einheit.
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

/// Hebt die Hinweise „wiederhergestellt“ und „entfallen“ derselben Schicht gegeneinander auf.
/// Für die Berichtigung einer Entlassung (LLH-1455: Streichung, dann Nachtrag in einer
/// Transaktion): die Streichung holt die Planung zurück (LLH-1510), der Nachtrag lässt sie gleich
/// wieder entfallen. Die Führung hat „entfallen“ schon bekommen; zwei Hinweise, die sich
/// aufheben, sagten ihr nichts Neues. Die ETB-Einträge bleiben als Spur.
pub(crate) fn cancel_wiederhergestellt_entfallen(anlaesse: &mut Vec<Anlass>) {
    use std::collections::HashSet;
    let schichten = |typ: BenachrichtigungBezugTyp| {
        anlaesse
            .iter()
            .filter(|a| a.bezug.typ == typ)
            .map(|a| a.bezug.id)
            .collect::<HashSet<_>>()
    };
    let wieder = schichten(BenachrichtigungBezugTyp::AbloeserWiederhergestellt);
    let beide: HashSet<i64> = schichten(BenachrichtigungBezugTyp::AbloeserEntfallen)
        .intersection(&wieder)
        .copied()
        .collect();
    anlaesse.retain(|a| {
        !(matches!(
            a.bezug.typ,
            BenachrichtigungBezugTyp::AbloeserWiederhergestellt
                | BenachrichtigungBezugTyp::AbloeserEntfallen
        ) && beide.contains(&a.bezug.id))
    });
}
