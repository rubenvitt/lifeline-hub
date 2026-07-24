use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einheit::typ_repo::{self, TypDaten, TypPatch};
use crate::einheit::EinheitTyp;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::routes::support::deserialize_optional_field;
use crate::staerke::Staerke;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TypBody {
    pub label: String,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    #[serde(default)]
    pub sortier: i64,
}

#[derive(Debug)]
struct Normalisiert {
    label: String,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> TypDaten<'_> {
        TypDaten {
            label: &self.label,
            soll_fuehrer: self.soll_fuehrer,
            soll_unterfuehrer: self.soll_unterfuehrer,
            soll_mannschaft: self.soll_mannschaft,
            sortier: self.sortier,
        }
    }
}

/// Trimmt das Label und validiert die Soll-Regel „alle drei oder keiner" über
/// `Staerke::aus_optionen` (mappt String-Fehler auf `Validation`).
fn normalisiere(body: TypBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    // Validierung der Vollständigkeit/Bereiche; Rückgabewert verwerfen wir, wir
    // speichern die rohen Optionen (durch aus_optionen als konsistent bestätigt).
    Staerke::aus_optionen(
        body.soll_fuehrer,
        body.soll_unterfuehrer,
        body.soll_mannschaft,
    )
    .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        label,
        soll_fuehrer: body.soll_fuehrer,
        soll_unterfuehrer: body.soll_unterfuehrer,
        soll_mannschaft: body.soll_mannschaft,
        sortier: body.sortier,
    })
}

/// PATCH-Body (LFH-306, Tri-State): jedes Feld optional, absent = unverändert.
/// Getrennt von [`TypBody`], damit der POST sein Pflicht-`label` strukturell erzwingt.
/// **Kein `#[serde(default)]` an `sortier`** — das machte aus „nicht gesendet" ein
/// „auf 0 setzen" (der stille NOT-NULL-Reset, den LFH-306 beseitigt).
#[derive(Debug, Deserialize)]
pub struct PatchTyp {
    pub label: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_fuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_unterfuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_mannschaft: Option<Option<i64>>,
    pub sortier: Option<i64>,
}

#[derive(Debug)]
struct PatchNormalisiert {
    label: Option<String>,
    soll_fuehrer: Option<Option<i64>>,
    soll_unterfuehrer: Option<Option<i64>>,
    soll_mannschaft: Option<Option<i64>>,
    sortier: Option<i64>,
}

impl PatchNormalisiert {
    fn patch(&self) -> TypPatch<'_> {
        TypPatch {
            label: self.label.as_deref(),
            soll_fuehrer: self.soll_fuehrer,
            soll_unterfuehrer: self.soll_unterfuehrer,
            soll_mannschaft: self.soll_mannschaft,
            sortier: self.sortier,
        }
    }
}

/// Validiert den Teil-Patch gegen den **Effektivzustand** (Patch gewinnt, sonst Bestand).
///
/// Das Soll-Trio trägt die Mehrspalten-Invariante „alle drei oder keiner" (`aus_optionen`).
/// Ein naiver Teil-Patch (`{"soll_mannschaft":20}` auf eine Zeile mit gesetztem Trio)
/// würde die Prüfung mit zwei `None` füttern und die Änderung fälschlich als
/// „Trio halb geleert" ablehnen. Deshalb prüfen wir das **gemergte** Trio — geschrieben
/// wird trotzdem nur der Patch (Muster „PATCH-XOR-Effektivzustand").
fn normalisiere_patch(
    body: PatchTyp,
    bestand: (Option<i64>, Option<i64>, Option<i64>),
) -> Result<PatchNormalisiert, AppError> {
    let label = match body.label {
        Some(l) => {
            let l = l.trim().to_string();
            if l.is_empty() {
                return Err(AppError::Validation("Label darf nicht leer sein".into()));
            }
            Some(l)
        }
        None => None,
    };
    // Effektivwert je Soll-Spalte: im Patch enthalten → Patch-Wert (auch `null`), sonst Bestand.
    let effektiv = |patch: Option<Option<i64>>, gespeichert: Option<i64>| match patch {
        Some(v) => v,
        None => gespeichert,
    };
    Staerke::aus_optionen(
        effektiv(body.soll_fuehrer, bestand.0),
        effektiv(body.soll_unterfuehrer, bestand.1),
        effektiv(body.soll_mannschaft, bestand.2),
    )
    .map_err(AppError::Validation)?;
    Ok(PatchNormalisiert {
        label,
        soll_fuehrer: body.soll_fuehrer,
        soll_unterfuehrer: body.soll_unterfuehrer,
        soll_mannschaft: body.soll_mannschaft,
        sortier: body.sortier,
    })
}

/// GET /api/einheit-typen — aktive Katalog-Einträge der eigenen Org (für Auswahl).
/// Alle eingeloggten Nutzer.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinheitTyp>>, AppError> {
    Ok(Json(typ_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/einheit-typen — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<TypBody>,
) -> Result<(StatusCode, Json<EinheitTyp>), AppError> {
    let n = normalisiere(body)?;
    let t = typ_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

/// PATCH /api/einheit-typen/{id} — Admin, echter Teil-Patch (LFH-306): Feld absent =
/// unverändert, `null` = leeren. Das Soll-Trio wird gegen den Effektivzustand geprüft.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchTyp>,
) -> Result<Json<EinheitTyp>, AppError> {
    // Bestand vor der Validierung — liefert zugleich das 404 für fremde/unbekannte id.
    let bestand = typ_repo::soll_roh(&state.pool, benutzer.org_id, id).await?;
    let n = normalisiere_patch(body, bestand)?;
    let t = typ_repo::patche(&state.pool, benutzer.org_id, id, n.patch()).await?;
    Ok(Json(t))
}

/// POST /api/einheit-typen/{id}/deaktivieren — Admin (Soft-Delete).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    typ_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(label: &str, soll: Option<(i64, i64, i64)>) -> TypBody {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        TypBody {
            label: label.into(),
            soll_fuehrer: f,
            soll_unterfuehrer: u,
            soll_mannschaft: m,
            sortier: 0,
        }
    }

    #[test]
    fn normalisiere_leeres_label_ist_validation() {
        assert!(matches!(
            normalisiere(body("   ", None)).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn normalisiere_teilweise_soll_ist_validation() {
        let mut b = body("Zug", None);
        b.soll_fuehrer = Some(1); // nur einer gesetzt
        assert!(matches!(
            normalisiere(b).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn normalisiere_vollstaendig_ok() {
        assert!(normalisiere(body("Zug", Some((1, 3, 18)))).is_ok());
        assert!(normalisiere(body("Sonstige", None)).is_ok());
    }

    fn leerer_patch() -> PatchTyp {
        PatchTyp {
            label: None,
            soll_fuehrer: None,
            soll_unterfuehrer: None,
            soll_mannschaft: None,
            sortier: None,
        }
    }

    /// Kern der Effektivzustands-Prüfung: EIN Soll-Feld zu patchen ist zulässig, solange
    /// der Bestand die anderen zwei trägt. Ohne den Merge sähe die Prüfung zwei `None`
    /// und lehnte die Änderung als „Trio halb geleert" ab (400 statt 200).
    #[test]
    fn patch_ein_soll_feld_prueft_gegen_bestand() {
        let mut p = leerer_patch();
        p.soll_mannschaft = Some(Some(20));
        assert!(normalisiere_patch(p, (Some(1), Some(3), Some(18))).is_ok());
    }

    /// Grenzt gegen den vorigen ab: derselbe Patch auf eine Zeile OHNE Trio ist ein halbes
    /// Trio und bleibt 400.
    #[test]
    fn patch_ein_soll_feld_ohne_bestand_ist_validation() {
        let mut p = leerer_patch();
        p.soll_mannschaft = Some(Some(20));
        assert!(matches!(
            normalisiere_patch(p, (None, None, None)).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    /// Das Trio darf nicht halb geleert werden — `null` auf genau einem Feld ist 400.
    #[test]
    fn patch_ein_soll_feld_null_bei_gesetztem_trio_ist_validation() {
        let mut p = leerer_patch();
        p.soll_fuehrer = Some(None);
        assert!(matches!(
            normalisiere_patch(p, (Some(1), Some(3), Some(18))).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    /// Der legitime Leer-Weg bleibt offen: alle drei `null` leert das Trio.
    #[test]
    fn patch_alle_drei_null_leert_das_trio() {
        let mut p = leerer_patch();
        p.soll_fuehrer = Some(None);
        p.soll_unterfuehrer = Some(None);
        p.soll_mannschaft = Some(None);
        assert!(normalisiere_patch(p, (Some(1), Some(3), Some(18))).is_ok());
    }

    /// Ein Patch ganz ohne Soll-Felder fasst das Trio nicht an — auch nicht validierend.
    #[test]
    fn patch_ohne_soll_felder_ist_ok_bei_jedem_bestand() {
        let mut p = leerer_patch();
        p.label = Some("Umbenannt".into());
        assert!(normalisiere_patch(p, (Some(1), Some(3), Some(18))).is_ok());
        let mut p = leerer_patch();
        p.label = Some("Umbenannt".into());
        assert!(normalisiere_patch(p, (None, None, None)).is_ok());
    }

    #[test]
    fn patch_leeres_label_ist_validation_absentes_nicht() {
        let mut p = leerer_patch();
        p.label = Some("   ".into());
        assert!(matches!(
            normalisiere_patch(p, (None, None, None)).unwrap_err(),
            AppError::Validation(_)
        ));
        assert!(normalisiere_patch(leerer_patch(), (None, None, None)).is_ok());
    }
}
