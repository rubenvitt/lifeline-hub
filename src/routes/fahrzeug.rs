use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::fahrzeug::repo::{self, FahrzeugDaten, FahrzeugPatch};
use crate::fahrzeug::{FahrzeugAnzeige, FahrzeugVorschlaege};
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use crate::staerke::Staerke;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für das Anlegen (POST). Bewusst getrennt vom PATCH-Body: der POST muss seine
/// Pflichtfelder strukturell erzwingen (fehlender `funkrufname` → 400 schon im Extractor),
/// und `sondersignal` darf hier ein `#[serde(default)]` tragen (Default beim Neuanlegen ist
/// „kein Sondersignal") — im PATCH wäre genau das der stille NOT-NULL-Reset.
#[derive(Debug, Deserialize)]
pub struct FahrzeugBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    #[serde(default)]
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke_fuehrer: Option<i64>,
    pub staerke_unterfuehrer: Option<i64>,
    pub staerke_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
}

/// Owned, validierte Felder; `FahrzeugDaten` borgt daraus.
struct Normalisiert {
    funkrufname: String,
    fahrzeugtyp: Option<String>,
    traegerorganisation: Option<String>,
    kennzeichen: Option<String>,
    opta: Option<String>,
    standort: Option<String>,
    fms_issi: Option<String>,
    sondersignal: bool,
    tragenkapazitaet: Option<i64>,
    staerke: Option<Staerke>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname: &self.funkrufname,
            fahrzeugtyp: self.fahrzeugtyp.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            kennzeichen: self.kennzeichen.as_deref(),
            opta: self.opta.as_deref(),
            standort: self.standort.as_deref(),
            fms_issi: self.fms_issi.as_deref(),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke: self.staerke,
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: FahrzeugBody) -> Result<Normalisiert, AppError> {
    let funkrufname = body.funkrufname.trim().to_string();
    if funkrufname.is_empty() {
        return Err(AppError::Validation(
            "Funkrufname darf nicht leer sein".into(),
        ));
    }
    let staerke = Staerke::aus_optionen(
        body.staerke_fuehrer,
        body.staerke_unterfuehrer,
        body.staerke_mannschaft,
    )
    .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        funkrufname,
        fahrzeugtyp: trimme(body.fahrzeugtyp),
        traegerorganisation: trimme(body.traegerorganisation),
        kennzeichen: trimme(body.kennzeichen),
        opta: trimme(body.opta),
        standort: trimme(body.standort),
        fms_issi: trimme(body.fms_issi),
        sondersignal: body.sondersignal,
        tragenkapazitaet: body.tragenkapazitaet,
        staerke,
        bemerkung: trimme(body.bemerkung),
    })
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert,
/// `null`/`""` = leeren.
///
/// **Kein `#[serde(default)]` an `funkrufname`/`sondersignal`** — das ist hier keine
/// Stilfrage: `sondersignal` liegt auf einer NOT-NULL-Spalte und trug im alten
/// Vollersatz-Body ein `#[serde(default)] bool`; jeder PATCH ohne das Feld setzte die Spalte
/// still auf `false` (das Blaulicht verschwand beim Ändern der Bemerkung). `Option<T>`
/// deserialisiert absent ohnehin zu `None`; `default` braucht nur der Tri-State-Deserializer.
///
/// Das Stärke-Trio kommt als drei **unabhängige** nullable Spalten (nicht als `Staerke`) —
/// die Invariante „alle drei oder keiner" wird in [`normalisiere_patch`] gegen den
/// Effektivzustand geprüft, geschrieben werden nur die gesendeten Spalten.
#[derive(Debug, Deserialize)]
pub struct PatchFahrzeug {
    pub funkrufname: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fahrzeugtyp: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub traegerorganisation: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kennzeichen: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub opta: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fms_issi: Option<Option<String>>,
    pub sondersignal: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tragenkapazitaet: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub staerke_fuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub staerke_unterfuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub staerke_mannschaft: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
}

/// Owned, validierte Patch-Felder; `FahrzeugPatch` borgt daraus.
#[derive(Debug)]
struct PatchNormalisiert {
    funkrufname: Option<String>,
    fahrzeugtyp: Option<Option<String>>,
    traegerorganisation: Option<Option<String>>,
    kennzeichen: Option<Option<String>>,
    opta: Option<Option<String>>,
    standort: Option<Option<String>>,
    fms_issi: Option<Option<String>>,
    sondersignal: Option<bool>,
    tragenkapazitaet: Option<Option<i64>>,
    staerke_fuehrer: Option<Option<i64>>,
    staerke_unterfuehrer: Option<Option<i64>>,
    staerke_mannschaft: Option<Option<i64>>,
    bemerkung: Option<Option<String>>,
}

impl PatchNormalisiert {
    fn patch(&self) -> FahrzeugPatch<'_> {
        FahrzeugPatch {
            funkrufname: self.funkrufname.as_deref(),
            fahrzeugtyp: self.fahrzeugtyp.as_ref().map(|v| v.as_deref()),
            traegerorganisation: self.traegerorganisation.as_ref().map(|v| v.as_deref()),
            kennzeichen: self.kennzeichen.as_ref().map(|v| v.as_deref()),
            opta: self.opta.as_ref().map(|v| v.as_deref()),
            standort: self.standort.as_ref().map(|v| v.as_deref()),
            fms_issi: self.fms_issi.as_ref().map(|v| v.as_deref()),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke_fuehrer: self.staerke_fuehrer,
            staerke_unterfuehrer: self.staerke_unterfuehrer,
            staerke_mannschaft: self.staerke_mannschaft,
            bemerkung: self.bemerkung.as_ref().map(|v| v.as_deref()),
        }
    }
}

/// Validiert den Teil-Patch gegen den **Effektivzustand** (Patch gewinnt, sonst Bestand).
///
/// Das Stärke-Trio trägt die Mehrspalten-Invariante „alle drei oder keiner"
/// (`Staerke::aus_optionen`). Ein naiver Teil-Patch (`{"staerke_mannschaft":9}` auf ein
/// Fahrzeug mit gesetztem Trio) würde die Prüfung mit zwei `None` füttern und die Änderung
/// fälschlich als „Trio halb geleert" ablehnen. Deshalb prüfen wir das **gemergte** Trio —
/// geschrieben wird trotzdem nur der Patch (Muster „PATCH-XOR-Effektivzustand").
/// Vorlage: `routes/einheit_typ.rs::normalisiere_patch` + `einheit/typ_repo.rs::soll_roh`.
fn normalisiere_patch(
    body: PatchFahrzeug,
    bestand: (Option<i64>, Option<i64>, Option<i64>),
) -> Result<PatchNormalisiert, AppError> {
    let funkrufname = match body.funkrufname {
        Some(f) => {
            let f = f.trim().to_string();
            if f.is_empty() {
                return Err(AppError::Validation(
                    "Funkrufname darf nicht leer sein".into(),
                ));
            }
            Some(f)
        }
        None => None,
    };
    // Effektivwert je Stärke-Spalte: im Patch enthalten → Patch-Wert (auch `null`), sonst Bestand.
    let effektiv = |patch: Option<Option<i64>>, gespeichert: Option<i64>| match patch {
        Some(v) => v,
        None => gespeichert,
    };
    Staerke::aus_optionen(
        effektiv(body.staerke_fuehrer, bestand.0),
        effektiv(body.staerke_unterfuehrer, bestand.1),
        effektiv(body.staerke_mannschaft, bestand.2),
    )
    .map_err(AppError::Validation)?;
    Ok(PatchNormalisiert {
        funkrufname,
        fahrzeugtyp: trimme_tri(body.fahrzeugtyp),
        traegerorganisation: trimme_tri(body.traegerorganisation),
        kennzeichen: trimme_tri(body.kennzeichen),
        opta: trimme_tri(body.opta),
        standort: trimme_tri(body.standort),
        fms_issi: trimme_tri(body.fms_issi),
        sondersignal: body.sondersignal,
        tragenkapazitaet: body.tragenkapazitaet,
        staerke_fuehrer: body.staerke_fuehrer,
        staerke_unterfuehrer: body.staerke_unterfuehrer,
        staerke_mannschaft: body.staerke_mannschaft,
        bemerkung: trimme_tri(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/fahrzeuge — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<FahrzeugAnzeige>>, AppError> {
    let fahrzeuge = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(fahrzeuge.iter().map(|f| f.anzeige()).collect()))
}

/// GET /api/fahrzeug-vorschlaege — abgeleitete AutoComplete-Vorschläge (eigene Org)
/// für Fahrzeugtyp, Trägerorganisation und Standort.
pub async fn vorschlaege(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<FahrzeugVorschlaege>, AppError> {
    Ok(Json(repo::vorschlaege(&state.pool, benutzer.org_id).await?))
}

/// POST /api/fahrzeuge — Admin. Dublette Funkrufname → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<FahrzeugBody>,
) -> Result<(StatusCode, Json<FahrzeugAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let f = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(f.anzeige())))
}

/// PATCH /api/fahrzeuge/{id} — Admin, echter Teil-Patch (LFH-306): Feld absent =
/// unverändert, `null`/`""` = leeren. Das Stärke-Trio wird gegen den Effektivzustand
/// geprüft. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    JsonBody(body): JsonBody<PatchFahrzeug>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    // Bestand vor der Validierung — liefert zugleich das 404 für fremde/unbekannte id.
    let bestand = repo::staerke_roh(&state.pool, benutzer.org_id, id).await?;
    let n = normalisiere_patch(body, bestand)?;
    let f = repo::patche(&state.pool, benutzer.org_id, id, n.patch()).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Namenskollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(f.anzeige()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leerer_patch() -> PatchFahrzeug {
        PatchFahrzeug {
            funkrufname: None,
            fahrzeugtyp: None,
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: None,
            tragenkapazitaet: None,
            staerke_fuehrer: None,
            staerke_unterfuehrer: None,
            staerke_mannschaft: None,
            bemerkung: None,
        }
    }

    /// Kern der Effektivzustands-Prüfung: EIN Stärke-Feld zu patchen ist zulässig, solange
    /// der Bestand die anderen zwei trägt. Ohne den Merge sähe die Prüfung zwei `None`
    /// und lehnte die Änderung als „Trio halb geleert" ab (400 statt 200).
    #[test]
    fn patch_ein_staerke_feld_prueft_gegen_bestand() {
        let mut p = leerer_patch();
        p.staerke_mannschaft = Some(Some(9));
        assert!(normalisiere_patch(p, (Some(1), Some(2), Some(5))).is_ok());
    }

    /// Grenzt gegen den vorigen ab: derselbe Patch auf ein Fahrzeug OHNE Trio ist ein
    /// halbes Trio und bleibt 400.
    #[test]
    fn patch_ein_staerke_feld_ohne_bestand_ist_validation() {
        let mut p = leerer_patch();
        p.staerke_mannschaft = Some(Some(9));
        assert!(matches!(
            normalisiere_patch(p, (None, None, None)).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    /// Das Trio darf nicht halb geleert werden — `null` auf genau einem Feld ist 400.
    #[test]
    fn patch_ein_staerke_feld_null_bei_gesetztem_trio_ist_validation() {
        let mut p = leerer_patch();
        p.staerke_fuehrer = Some(None);
        assert!(matches!(
            normalisiere_patch(p, (Some(1), Some(2), Some(5))).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    /// Der legitime Leer-Weg bleibt offen: alle drei `null` leeren das Trio.
    #[test]
    fn patch_alle_drei_staerke_null_leert_das_trio() {
        let mut p = leerer_patch();
        p.staerke_fuehrer = Some(None);
        p.staerke_unterfuehrer = Some(None);
        p.staerke_mannschaft = Some(None);
        assert!(normalisiere_patch(p, (Some(1), Some(2), Some(5))).is_ok());
    }

    /// Ein Patch ganz ohne Stärke-Felder fasst das Trio nicht an — auch nicht validierend.
    #[test]
    fn patch_ohne_staerke_felder_ist_ok_bei_jedem_bestand() {
        let mut p = leerer_patch();
        p.bemerkung = Some(Some("neu".into()));
        assert!(normalisiere_patch(p, (Some(1), Some(2), Some(5))).is_ok());
        let mut p = leerer_patch();
        p.bemerkung = Some(Some("neu".into()));
        assert!(normalisiere_patch(p, (None, None, None)).is_ok());
    }

    #[test]
    fn patch_leerer_funkrufname_ist_validation_absenter_nicht() {
        let mut p = leerer_patch();
        p.funkrufname = Some("   ".into());
        assert!(matches!(
            normalisiere_patch(p, (None, None, None)).unwrap_err(),
            AppError::Validation(_)
        ));
        assert!(normalisiere_patch(leerer_patch(), (None, None, None)).is_ok());
    }

    /// Der Tri-State kommt bis in den Repo-Patch durch: absent bleibt `None`, `null`/`""`
    /// wird zum Leerwunsch `Some(None)`, ein Wert zu `Some(Some(..))`.
    #[test]
    fn patch_accessor_traegt_den_tri_state_weiter() {
        let mut p = leerer_patch();
        p.kennzeichen = Some(None);
        p.opta = Some(Some("  OPTA-1  ".into()));
        p.standort = Some(Some("   ".into())); // Leerstring = Leerwunsch
        let n = normalisiere_patch(p, (None, None, None)).unwrap();
        let patch = n.patch();
        assert_eq!(patch.kennzeichen, Some(None));
        assert_eq!(patch.opta, Some(Some("OPTA-1")), "getrimmt");
        assert_eq!(patch.standort, Some(None), "Leerstring → Leerwunsch");
        assert_eq!(patch.fms_issi, None, "absent bleibt absent");
        assert_eq!(patch.sondersignal, None, "absent bleibt absent");
    }
}
