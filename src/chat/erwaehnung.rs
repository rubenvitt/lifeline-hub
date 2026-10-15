//! Erwähnungen in einer Chat-Nachricht (LLH-1220, Change `kcjecn9e-benachrichtigungskonzept`,
//! design.md D9, Spec `benachrichtigungen`, „Chat-Erwähnung“).
//!
//! Der Client schickt mit einer neuen Nachricht die Liste der Erwähnten: Nutzer (Mitglieder des
//! Einsatzes) oder Codes aus dem Funktionskatalog. Der Text trägt nur `@Anzeige`; der Server
//! parst ihn nicht, gleiche Namen wären mehrdeutig. Gespeichert wird die Liste in
//! `chat_erwaehnung` (in derselben Transaktion wie die Nachricht, `repo::anlegen_mit_erwaehnungen`),
//! gemeldet nach dem Commit über [`melden`]. Wer den Hinweis bekommt, entscheidet allein
//! `benachrichtigung::melden` (`src/AGENTS.md`, Benachrichtigungen): ohne den Autor, nur wer das
//! Modul Chat lesen darf.

use crate::benachrichtigung::{
    self, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;
use serde::Deserialize;
use sqlx::SqlitePool;

/// Höchstzahl der Erwähnungen einer Nachricht im Request (`src/AGENTS.md`, Eingabegrenzen);
/// gezählt vor dem Entdoppeln, damit die Arbeit vor der ersten Abfrage begrenzt ist. Darüber
/// → 400. Spiegel: `ERWAEHNUNGEN_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const ERWAEHNUNGEN_MAX: usize = 20;

/// Eine Erwähnung, wie der Client sie schickt: genau eines der beiden Felder.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ErwaehnungEingabe {
    #[serde(default)]
    pub benutzer_id: Option<i64>,
    /// Code aus `fuehrung::Fuehrungsfunktion` (`s4`).
    #[serde(default)]
    pub funktion: Option<String>,
}

/// Eine geprüfte Erwähnung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Erwaehnung {
    Nutzer(i64),
    Funktion(Fuehrungsfunktion),
}

/// Prüft die Liste für sich (`src/AGENTS.md`, Statuscode-Konvention, Eingabegrenzen): zu lang
/// oder ein unbekannter Funktionscode → 400, eine Erwähnung mit beiden oder keinem Feld → 422.
/// Liefert die Erwähnungen entdoppelt und sortiert. Den Zusammenhang mit dem Einsatz prüfen
/// [`pruefen_fuer_einsatz`] (S7) und die Transaktion (Mitgliedschaft,
/// `repo::anlegen_mit_erwaehnungen`).
pub fn pruefen(eingabe: &[ErwaehnungEingabe]) -> Result<Vec<Erwaehnung>, AppError> {
    if eingabe.len() > ERWAEHNUNGEN_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {ERWAEHNUNGEN_MAX} Erwähnungen je Nachricht"
        )));
    }
    let mut liste = Vec::with_capacity(eingabe.len());
    for e in eingabe {
        let funktion = e.funktion.as_deref().map(str::trim);
        liste.push(match (e.benutzer_id, funktion) {
            (Some(id), None) => Erwaehnung::Nutzer(id),
            (None, Some(code)) => {
                Erwaehnung::Funktion(Fuehrungsfunktion::parse(code).ok_or_else(|| {
                    AppError::Validation(format!("Unbekannte Führungsfunktion: {code}"))
                })?)
            }
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "Eine Erwähnung nennt genau eine Person oder eine Funktion".into(),
                ))
            }
        });
    }
    liste.sort_unstable();
    liste.dedup();
    Ok(liste)
}

/// [`pruefen`] und dazu S7 nur, wenn die Organisation die PSNV eingeschaltet hat (422, wie
/// `fuehrung::pruefe_funktion`). Die Labelkarte wird nur für eine S7-Erwähnung gelesen.
pub async fn pruefen_fuer_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    eingabe: &[ErwaehnungEingabe],
) -> Result<Vec<Erwaehnung>, AppError> {
    let liste = pruefen(eingabe)?;
    if liste.contains(&Erwaehnung::Funktion(Fuehrungsfunktion::S7))
        && !crate::einsatz::repo::labelkarte(pool, einsatz_id)
            .await?
            .s7_aktiv
    {
        return Err(AppError::UnprocessableEntity(
            "S7 (PSNV) ist für diese Organisation nicht eingeschaltet".into(),
        ));
    }
    Ok(liste)
}

/// Meldet `chat_erwaehnung` nach dem Commit einer neuen Nachricht an die Erwähnten; ohne
/// Erwähnung nichts (Spec „Stilles Ereignis“). Der Autor ist Auslöser und bekommt nichts.
pub async fn melden(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    nachricht_id: i64,
    autor_id: i64,
    erwaehnungen: &[Erwaehnung],
) {
    if erwaehnungen.is_empty() {
        return;
    }
    let anlass = erwaehnungen.iter().fold(
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::ChatErwaehnung,
            Bezug::neu(BenachrichtigungBezugTyp::ChatNachricht, nachricht_id),
        )
        .von(autor_id),
        |anlass, e| {
            anlass.an(match *e {
                Erwaehnung::Nutzer(id) => Adressat::Nutzer(id),
                Erwaehnung::Funktion(f) => Adressat::Funktion(f),
            })
        },
    );
    benachrichtigung::melden(pool, live, anlass).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nutzer(id: i64) -> ErwaehnungEingabe {
        ErwaehnungEingabe {
            benutzer_id: Some(id),
            funktion: None,
        }
    }

    fn funktion(code: &str) -> ErwaehnungEingabe {
        ErwaehnungEingabe {
            benutzer_id: None,
            funktion: Some(code.into()),
        }
    }

    fn status(e: AppError) -> u16 {
        e.status().as_u16()
    }

    #[test]
    fn pruefen_entdoppelt_und_sortiert() {
        let liste = pruefen(&[
            funktion("s4"),
            nutzer(7),
            funktion(" s4 "),
            nutzer(7),
            nutzer(3),
        ])
        .unwrap();
        assert_eq!(
            liste,
            vec![
                Erwaehnung::Nutzer(3),
                Erwaehnung::Nutzer(7),
                Erwaehnung::Funktion(Fuehrungsfunktion::S4),
            ]
        );
    }

    #[test]
    fn zu_viele_erwaehnungen_sind_400_vor_dem_entdoppeln() {
        let eingabe = vec![nutzer(1); ERWAEHNUNGEN_MAX + 1];
        assert_eq!(status(pruefen(&eingabe).unwrap_err()), 400);
        assert!(pruefen(&vec![nutzer(1); ERWAEHNUNGEN_MAX]).is_ok());
    }

    #[test]
    fn unbekannte_funktion_ist_400_und_unklare_erwaehnung_422() {
        assert_eq!(status(pruefen(&[funktion("s9")]).unwrap_err()), 400);
        let beides = ErwaehnungEingabe {
            benutzer_id: Some(1),
            funktion: Some("s4".into()),
        };
        assert_eq!(status(pruefen(&[beides]).unwrap_err()), 422);
        assert_eq!(
            status(pruefen(&[ErwaehnungEingabe::default()]).unwrap_err()),
            422
        );
    }
}
