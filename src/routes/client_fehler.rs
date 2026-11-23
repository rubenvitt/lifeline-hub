//! Bericht eines Absturzes aus dem Client (LLH-1822, Change `a12ms7g9-seitenzustaende`, D3;
//! Spec `seiten-zustaende`, „Absturz wird dem Server gemeldet“).
//!
//! Fängt die Fehlergrenze des Frontends einen Wurf beim Zeichnen, schickt
//! `frontend/src/api/clientFehler.ts` einen Bericht: Routenmuster ohne Kennungen, App-Version,
//! gekürzte Meldung und gekürzter Stack. Der Server speichert nichts. Er schreibt eine
//! gedrosselte Warnzeile ins Log, ohne Benutzer und Organisation, damit das Log keine
//! Personendaten trägt. Angenommen wird nur mit Sitzung (`CurrentUser`, sonst 401); die
//! Body-Grenze steht an der Route (`app::CLIENT_FEHLER_BODY_MAX`, `src/AGENTS.md`,
//! „Eingabegrenzen“), jedes Feld hat sein `*_MAX` (400).

use crate::auth::session::CurrentUser;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::log_drossel::Sammelzeile;
use crate::routes::support::optional_max;
use axum::http::StatusCode;
use serde::Deserialize;

/// Höchstlänge des Routenmusters (`/einsaetze/:id/personen/:personId`), in Zeichen.
pub const ROUTE_MAX: usize = 300;
/// Höchstlänge der App-Version, in Zeichen.
pub const VERSION_MAX: usize = 64;
/// Höchstlänge der Meldung, in Zeichen; der Client kürzt auf genau diese Länge.
pub const MELDUNG_MAX: usize = 500;
/// Höchstlänge des Stacks, in Zeichen; der Client kürzt auf genau diese Länge.
pub const STACK_MAX: usize = 2000;
/// So viele Zeichen des Stacks stehen in der Logzeile; der Anfang nennt Fehlerart und Ort.
const STACK_ANFANG: usize = 600;

/// Eingang des Berichts. Jedes Feld darf fehlen oder leer sein: Ein Bericht ohne Routenmuster
/// (keine Route passt) oder ohne Stack ist immer noch einer.
#[derive(Debug, Deserialize)]
pub struct ClientFehlerBericht {
    #[serde(default)]
    pub route: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub meldung: Option<String>,
    #[serde(default)]
    pub stack: Option<String>,
}

/// Der geprüfte Bericht, wie er ins Log geht.
#[derive(Debug, PartialEq, Eq)]
struct Bericht {
    route: String,
    version: String,
    meldung: String,
    stack: String,
}

impl Bericht {
    fn from_body(eingang: ClientFehlerBericht) -> Result<Self, AppError> {
        let feld =
            |wert, name, max| Ok::<_, AppError>(optional_max(wert, name, max)?.unwrap_or_default());
        Ok(Bericht {
            route: feld(eingang.route, "Route", ROUTE_MAX)?,
            version: feld(eingang.version, "Version", VERSION_MAX)?,
            meldung: feld(eingang.meldung, "Meldung", MELDUNG_MAX)?,
            stack: feld(eingang.stack, "Stack", STACK_MAX)?,
        })
    }
}

/// Eine Zeile je Minute für alle Berichte zusammen: Wer eine Sitzung hat, löst einen Bericht je
/// Anfrage aus und flutete sonst das Journal (`log_drossel`, LFH-925).
static BERICHTE: Sammelzeile = Sammelzeile::neu();

/// Zählt den Bericht und schreibt die Zeile, wenn sie fällig ist. `true`, wenn geschrieben.
/// Die Texte stammen vom Client und gehen per `Debug` ins Log: Zeilenumbrüche und Steuerzeichen
/// erscheinen maskiert und können keine eigene Logzeile vortäuschen.
fn melden(drossel: &Sammelzeile, bericht: &Bericht) -> bool {
    let Some(faellig) = drossel.zaehlen() else {
        return false;
    };
    let stack_anfang: String = bericht.stack.chars().take(STACK_ANFANG).collect();
    tracing::warn!(
        route = ?bericht.route,
        version = ?bericht.version,
        meldung = ?bericht.meldung,
        stack = ?stack_anfang,
        anzahl = faellig.anzahl,
        seit_s = faellig.seit_s,
        "Absturz im Client gemeldet (Sammelzeile, höchstens eine je Minute)"
    );
    true
}

/// POST /api/client-errors — nimmt einen Absturzbericht an und antwortet 204.
pub async fn melde(
    CurrentUser(_benutzer): CurrentUser,
    JsonBody(eingang): JsonBody<ClientFehlerBericht>,
) -> Result<StatusCode, AppError> {
    let bericht = Bericht::from_body(eingang)?;
    melden(&BERICHTE, &bericht);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bericht() -> Bericht {
        Bericht {
            route: "/einsaetze/:id/etb".into(),
            version: "1.2.3".into(),
            meldung: "kaputt".into(),
            stack: "Error: kaputt\n    at Etb".into(),
        }
    }

    /// Mutationsprobe: ohne die Sammelzeile stünde jeder Bericht im Log.
    #[test]
    fn die_sammelzeile_haelt_die_zweite_zeile_in_derselben_minute_zurueck() {
        let drossel = Sammelzeile::neu();

        assert!(
            melden(&drossel, &bericht()),
            "der erste Bericht steht sofort im Log"
        );
        assert!(
            !melden(&drossel, &bericht()),
            "der zweite in derselben Minute wird nur gezählt"
        );
    }

    #[test]
    fn felder_werden_getrimmt_und_fehlende_bleiben_leer() {
        let b = Bericht::from_body(ClientFehlerBericht {
            route: Some("  /einsaetze/:id  ".into()),
            version: None,
            meldung: Some("   ".into()),
            stack: None,
        })
        .unwrap();
        assert_eq!(
            b,
            Bericht {
                route: "/einsaetze/:id".into(),
                version: String::new(),
                meldung: String::new(),
                stack: String::new(),
            }
        );
    }
}
