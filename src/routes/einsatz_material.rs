use super::einsatz_uhs::sse_uhs;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Material, Nachforderungen};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::geraet::{stelle, Bindungsart};
use crate::live::LiveEvent;
use crate::material::disposition_repo::{self, AdhocDaten, MaterialPatch};
use crate::material::ort::{self, MaterialOrt, OrtPatch};
use crate::material::{
    EinsatzMaterialAnzeige, MaterialArt, MaterialStatus, ADHOC_TEXT_MAX, BEMERKUNG_MAX,
};
use crate::routes::support::{
    deserialize_optional_field, optional_max, optional_max_tri, parse_flag, pflicht_max,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte/Meldebild): Material-Disposition hat sich geändert.
/// Wird unbedingt nach jeder Mutation gesendet — auch bei reinen Bemerkungs-/
/// UHS-Zuordnungs-Änderungen, die keinen ETB-Eintrag schreiben (LFH-66).
pub(super) fn sse_material(state: &AppState, einsatz_id: i64, em_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Material, "material_id", em_id);
}

/// Live-Ereignis des Orts eines Postens (LLH-1224, Spec `material-modell`, „Ortswechsel live“):
/// `material` erreicht die Leser von Einheit, Fahrzeug, UHS und Bereitstellungsraum ohne
/// Materialrecht nicht (LLH-1182); sie laden über das Ereignis ihres Orts nach.
pub(super) fn sse_ort(state: &AppState, einsatz_id: i64, ort: MaterialOrt) {
    match ort {
        MaterialOrt::Einheit(id) => super::einsatz_einheit::sse_einheit(state, einsatz_id, id),
        MaterialOrt::Fahrzeug(id) => super::einsatz_fahrzeug::sse_fahrzeug(state, einsatz_id, id),
        MaterialOrt::Uhs(id) => sse_uhs(state, einsatz_id, id),
        MaterialOrt::Bereitstellungsraum(id) => {
            super::einsatz_bereitstellungsraum::sse_br(state, einsatz_id, id)
        }
    }
}

/// Nach einem Ortswechsel: alter und neuer Ort melden.
pub(super) fn sse_ortswechsel(state: &AppState, einsatz_id: i64, wechsel: ort::OrtWechsel) {
    if wechsel.is_changed() {
        for o in [wechsel.vorher, wechsel.nachher].into_iter().flatten() {
            sse_ort(state, einsatz_id, o);
        }
    }
}

/// Art aus dem Body: unbekannt → 400 (Statuscode-Konvention, unbekannter Enum-Wert).
fn parse_art(art: Option<&str>) -> Result<Option<MaterialArt>, AppError> {
    art.map(|a| MaterialArt::parse(a).ok_or_else(|| AppError::Validation("Unbekannte Art".into())))
        .transpose()
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `1` = statt des aktiven das aus dem Einsatz genommene Material (LLH-1079, Nachweis).
    #[serde(default)]
    entlassene: Option<String>,
}

/// GET /api/einsaetze/{id}/material — aktives Material (aufgelöst), mit `?entlassene=1` das aus
/// dem Einsatz genommene (Spec `kraefte-entlassung`). Storniertes liefert keine der beiden. Nur
/// Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Material>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<EinsatzMaterialAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let aktiv = ctx.einsatz.ist_aktiv();
    let mut liste = if parse_flag(params.entlassene.as_deref(), "entlassene")? {
        disposition_repo::list_entlassene(&state.pool, einsatz_id, aktiv).await?
    } else {
        disposition_repo::list(&state.pool, einsatz_id, aktiv).await?
    };
    // Stellenbindung (LLH-1252): ein Gerät liest nur das Material seines Bereitstellungsraums,
    // jedes andere Gerät keins (`frontend/src/geraet/AGENTS.md`, „Stellenbindung je Art“).
    if let Some(geraet) = ctx.geraet.as_ref() {
        let sicht = stelle::sicht(Some(geraet), Bindungsart::Bereitstellungsraum);
        liste.retain(|em| em.br_id.is_some_and(|br| sicht.sieht(br)));
    }
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub material_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
    pub menge: Option<i64>,
    /// Nur Ad-hoc (LLH-1224, design.md D1): fehlt = Vorgabe aus der Menge; neben `material_id`
    /// 422, die Art kommt dann aus dem Stamm.
    pub art: Option<String>,
    /// Ort beim Disponieren, höchstens eines der vier Felder (design.md D7).
    pub einheit_id: Option<i64>,
    pub einsatz_fahrzeug_id: Option<i64>,
    pub uhs_id: Option<i64>,
    pub br_id: Option<i64>,
    /// Übernahme aus einer eingetroffenen Nachforderung (LLH-1226, design.md D1): der Posten
    /// verweist auf sie, der ETB-Eintrag nennt sie.
    pub nachforderung_id: Option<i64>,
    /// Weiterer Posten aus einer Nachforderung, die schon einen trägt (design.md D3); fehlt =
    /// `false`, dann ist ein vorhandener Posten 409.
    pub ergaenzen: Option<bool>,
}

/// POST /api/einsaetze/{id}/material — Stamm-Material disponieren ODER Ad-hoc anlegen, optional
/// gleich an einen Ort (LLH-1224) und als Übernahme aus einer Nachforderung (LLH-1226).
/// Schreibberechtigt + aktiver Einsatz. Schreibt EINEN ETB-Eintrag (Menge, Ort, Herkunft).
/// Reihenfolge: 400 (Feld) → 422 (Kombination: `ergaenzen` ohne Bezug, zwei Orte, Art am Stamm) →
/// 403 (Bezug ohne Freigabe der Nachforderungen) → in der Transaktion 404/422/409 (Nachforderung:
/// fremd, nicht eingetroffen, schon übernommen) und 404/409/422 (Stamm, Gerät mit Menge über 1,
/// Ziel).
pub async fn disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzMaterialAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let menge = body.menge.unwrap_or(1);
    if menge < 1 {
        return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
    }
    let art = parse_art(body.art.as_deref())?;

    // Vor der Tx: XOR Stamm/Ad-hoc bestimmen + Ad-hoc-Felder validieren/trimmen (Reinheits-
    // Kontrakt: Validierung + Body-Konsum vor der Tx). Die Owned-Holder überleben die
    // write_retry!-Closure, die je Versuch `AdhocDaten` (Copy) aus dem `Ziel`-Enum kopiert.
    enum Ziel<'a> {
        Stamm(i64),
        Adhoc(AdhocDaten<'a>),
    }
    let bezeichnung_owned;
    let kategorie_owned;
    let bestandsnummer_owned;
    let traeger_owned;
    let ziel = match (body.material_id, body.adhoc) {
        (Some(material_id), None) => Ziel::Stamm(material_id),
        (None, Some(adhoc)) => {
            // Grenzen (LLH-1093, `src/AGENTS.md`, „Eingabegrenzen“): 400 vor der Transaktion.
            bezeichnung_owned = pflicht_max(&adhoc.bezeichnung, "Bezeichnung", ADHOC_TEXT_MAX)?;
            kategorie_owned = optional_max(adhoc.kategorie, "Kategorie", ADHOC_TEXT_MAX)?;
            bestandsnummer_owned =
                optional_max(adhoc.bestandsnummer, "Bestandsnummer", ADHOC_TEXT_MAX)?;
            traeger_owned = optional_max(
                adhoc.traegerorganisation,
                "Trägerorganisation",
                ADHOC_TEXT_MAX,
            )?;
            Ziel::Adhoc(AdhocDaten {
                bezeichnung: &bezeichnung_owned,
                kategorie: kategorie_owned.as_deref(),
                bestandsnummer: bestandsnummer_owned.as_deref(),
                traegerorganisation: traeger_owned.as_deref(),
            })
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder material_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };
    // Nach allen 400: die Feld-Kombinationen (422).
    let ergaenzen = body.ergaenzen.unwrap_or(false);
    if ergaenzen && body.nachforderung_id.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Ergänzen nur mit Nachforderung".into(),
        ));
    }
    let ort_patch = OrtPatch {
        einheit_id: body.einheit_id.map(Some),
        einsatz_fahrzeug_id: body.einsatz_fahrzeug_id.map(Some),
        uhs_id: body.uhs_id.map(Some),
        br_id: body.br_id.map(Some),
    };
    ort_patch.validate()?;
    let ort_ziel = ort_patch.ziel(None).flatten();
    if art.is_some() && matches!(ziel, Ziel::Stamm(_)) {
        return Err(AppError::UnprocessableEntity(
            "Die Art kommt aus dem Stamm".into(),
        ));
    }
    // Ein Bezug liest die Nachforderung: erst die Freigabe ihres Moduls (403), sonst verriete
    // 404 gegen 201 ihre Existenz (design.md D1, wie `routes/verpflegung.rs`).
    let nachforderung_id = body.nachforderung_id;
    if nachforderung_id.is_some() {
        ctx.fordere_zielmodul::<Nachforderungen>(&state.pool)
            .await?;
    }

    // F06/LFH-244 Tier-A: Domänen-Write + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige (bei Stamm-
    // Material stammt die Bezeichnung erst aus dem Snapshot des INSERT) für ETB-Text UND
    // Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        // Status und Übernahmen der Nachforderung erst hier: sie kippen sonst zwischen Prüfung
        // und Schreiben (design.md D2).
        let herkunft = match nachforderung_id {
            Some(nid) => Some(
                crate::nachforderung::repo::check_uebernahme_tx(conn, einsatz_id, nid, ergaenzen)
                    .await?,
            ),
            None => None,
        };
        let em_id = match &ziel {
            Ziel::Stamm(material_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *material_id,
                    menge,
                    ctx.benutzer.id,
                    nachforderung_id,
                )
                .await?
            }
            Ziel::Adhoc(daten) => {
                disposition_repo::disponiere_adhoc_tx(
                    conn,
                    einsatz_id,
                    *daten,
                    art,
                    menge,
                    ctx.benutzer.id,
                    nachforderung_id,
                )
                .await?
            }
        };
        // Der Ort über den einen Schreibweg (design.md D9), mit der Prüfung des Ziels (D8).
        let ort_text = match ort_ziel {
            Some(o) => {
                ort::set_ort_tx(conn, einsatz_id, em_id, Some(o)).await?;
                Some(ort::ort_text_tx(conn, einsatz_id, Some(o)).await?)
            }
            None => None,
        };
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let text = crate::material::etb_text_disponiert(
            &anzeige.bezeichnung,
            anzeige.menge,
            ort_text.as_deref(),
        );
        let text = match &herkunft {
            Some(bezeichnung) => crate::material::etb_text_aus_nachforderung(&text, bezeichnung),
            None => text,
        };
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(anzeige)
    })?;
    sse_material(&state, einsatz_id, anzeige.id);
    if let Some(o) = anzeige.ort() {
        sse_ort(&state, einsatz_id, o);
    }
    notify_nachforderung(&state, &anzeige);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// Die Karte einer Nachforderung zeigt ihre Posten (LLH-1226, design.md D7): `nachforderung`
/// folgt, wenn ein verknüpfter Posten entsteht oder seine Zählung sich ändert (Übernahme,
/// Aufteilen, Stornieren, Reaktivieren). Mengen, Status und Orte liest die Karte aus der
/// Material-Query, die auf `material` hört.
fn notify_nachforderung(state: &AppState, posten: &EinsatzMaterialAnzeige) {
    if posten.nachforderung_id.is_some() {
        super::nachforderung::sse(state, posten.einsatz_id);
    }
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    /// Ausgegebene Menge eines Verbrauchsguts als neuer Gesamtwert (LLH-1224, design.md D4).
    pub ausgegeben: Option<i64>,
    pub status: Option<String>,
    /// Art der Zeile (LLH-1224, design.md D10); `null` → 400 (eine Zeile hat immer eine Art).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub art: Option<Option<String>>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    /// Der eine Ort (LLH-1224, design.md D7), je Feld Tri-State: fehlt = unverändert, Wert =
    /// dorthin (der bisherige Ort geht), `null` = von diesem Ort lösen. Mehr als ein Wert → 422.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einheit_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einsatz_fahrzeug_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub br_id: Option<Option<i64>>,
    /// Ad-hoc-Angaben (LLH-1093, design.md D6), symmetrisch zum Ad-hoc-Body; an einem
    /// Stamm-Posten 422. `bezeichnung` ist Pflicht: `null` oder leer → 400.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bezeichnung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kategorie: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bestandsnummer: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub traegerorganisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/material/{em_id} — Menge, Ausgabe, Status, Art, Bemerkung, der eine
/// Ort und bei Ad-hoc-Posten Bezeichnung, Kategorie, Bestandsnummer und Träger (LLH-1093,
/// LLH-1224). Je geändertem Aspekt ein ETB-Eintrag in der Folge Menge, Ausgabe, Status, Art,
/// Angaben, Ort (design.md D11); eine reine Bemerkung schreibt keinen. Reihenfolge: 400 (Feld) →
/// 422 (zwei Orte) → 404 (Zeile) → 409 (beendet) → 422 (Stamm-Posten, Art/Menge/Ausgabe/Status)
/// → 404/409/422 (Ziel).
pub async fn update(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if let Some(menge) = body.menge {
        if menge < 1 {
            return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
        }
    }
    if let Some(ausgegeben) = body.ausgegeben {
        if ausgegeben < 0 {
            return Err(AppError::Validation(
                "Ausgabe darf nicht negativ sein".into(),
            ));
        }
    }
    // Status validieren (festes Enum). Ungültig → Validation.
    let status = body
        .status
        .as_deref()
        .map(|s| {
            MaterialStatus::parse(s)
                .ok_or_else(|| AppError::Validation("Unbekannter Status".into()))
        })
        .transpose()?;
    let art = match body.art {
        Some(None) => return Err(AppError::Validation("Art darf nicht leer sein".into())),
        Some(Some(a)) => parse_art(Some(&a))?,
        None => None,
    };

    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren passiert hier in
    // der Route, das Repo bleibt dumm.
    let bemerkung = optional_max_tri(body.bemerkung, "Bemerkung", BEMERKUNG_MAX)?;
    let bezeichnung = body
        .bezeichnung
        .map(|b| pflicht_max(b.as_deref().unwrap_or(""), "Bezeichnung", ADHOC_TEXT_MAX))
        .transpose()?;
    let kategorie = optional_max_tri(body.kategorie, "Kategorie", ADHOC_TEXT_MAX)?;
    let bestandsnummer = optional_max_tri(body.bestandsnummer, "Bestandsnummer", ADHOC_TEXT_MAX)?;
    let traeger = optional_max_tri(
        body.traegerorganisation,
        "Trägerorganisation",
        ADHOC_TEXT_MAX,
    )?;
    // Nach allen 400: zwei Orte mit Wert sind eine Feld-Kombination (422), vor der Transaktion.
    let ort_patch = OrtPatch {
        einheit_id: body.einheit_id,
        einsatz_fahrzeug_id: body.einsatz_fahrzeug_id,
        uhs_id: body.uhs_id,
        br_id: body.br_id,
    };
    ort_patch.validate()?;
    fn tri(w: &Option<Option<String>>) -> Option<Option<&str>> {
        w.as_ref().map(|o| o.as_deref())
    }
    let patch = MaterialPatch {
        menge: body.menge,
        ausgegeben: body.ausgegeben,
        status,
        art,
        bemerkung: tri(&bemerkung),
        ort: ort_patch,
        bezeichnung: bezeichnung.as_deref(),
        kategorie: tri(&kategorie),
        bestandsnummer: tri(&bestandsnummer),
        traegerorganisation: tri(&traeger),
    };

    // F06/LFH-244 Tier-A: Domänen-Update und die System-ETB-Einträge atomar in EINER Tx (BEGIN
    // IMMEDIATE + Retry). Vor- und Nachzustand liest die Tx selbst; der Reload (`nachher`) liefert
    // die frischen Werte für ETB-Texte UND Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (vorher, nachher) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        disposition_repo::update_tx(conn, einsatz_id, em_id, patch).await?;
        let nachher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let mut texte = Vec::new();
        if vorher.menge != nachher.menge {
            texte.push(format!(
                "Material «{}»: Menge {} → {}",
                nachher.bezeichnung, vorher.menge, nachher.menge
            ));
        }
        if vorher.ausgegeben != nachher.ausgegeben {
            texte.push(crate::material::etb_text_ausgabe(
                &nachher.bezeichnung,
                vorher.ausgegeben,
                nachher.ausgegeben,
                nachher.menge,
            ));
        }
        if vorher.status != nachher.status {
            texte.push(crate::material::etb_text_status_wechsel(
                &nachher.bezeichnung,
                vorher.status,
                nachher.status,
            ));
        }
        if vorher.art != nachher.art {
            texte.push(crate::material::etb_text_art_geaendert(
                &nachher.bezeichnung,
                vorher.art,
                nachher.art,
            ));
        }
        // LLH-1093, design.md D6: ein Eintrag für alle geänderten Ad-hoc-Angaben.
        if let Some(text) = crate::material::etb_text_angaben(&vorher, &nachher) {
            texte.push(text);
        }
        if vorher.ort() != nachher.ort() {
            texte.push(crate::material::etb_text_ort_gewechselt(
                &nachher.bezeichnung,
                nachher.menge,
                &ort::ort_text_tx(conn, einsatz_id, vorher.ort()).await?,
                &ort::ort_text_tx(conn, einsatz_id, nachher.ort()).await?,
            ));
        }
        for text in &texte {
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, text).await?;
        }
        Ok((vorher, nachher))
    })?;
    sse_material(&state, einsatz_id, em_id);
    notify_orte(&state, einsatz_id, &vorher, &nachher);
    Ok(Json(nachher))
}

/// Nach einer Änderung an einer Zeile die Leser ihres Orts melden (`material` erreicht sie ohne
/// Materialrecht nicht, LLH-1182). Wechselt der Ort, gehen alter und neuer Ort. Sonst die Einheit
/// nur bei dem, was sie zeigt (Bezeichnung, Menge, Ausgabe, Status, Art), die übrigen Orte bei
/// jeder Änderung der Zeile (das UHS-Detail zeigt die ganze Zeile, LFH-892).
fn notify_orte(
    state: &AppState,
    einsatz_id: i64,
    vorher: &EinsatzMaterialAnzeige,
    nachher: &EinsatzMaterialAnzeige,
) {
    let wechsel = ort::OrtWechsel {
        vorher: vorher.ort(),
        nachher: nachher.ort(),
    };
    if wechsel.is_changed() {
        sse_ortswechsel(state, einsatz_id, wechsel);
        return;
    }
    let Some(o) = nachher.ort() else { return };
    let einheit_sieht = vorher.menge != nachher.menge
        || vorher.ausgegeben != nachher.ausgegeben
        || vorher.status != nachher.status
        || vorher.art != nachher.art
        || vorher.bezeichnung != nachher.bezeichnung;
    let zeile = einheit_sieht
        || vorher.bemerkung != nachher.bemerkung
        || vorher.kategorie != nachher.kategorie
        || vorher.bestandsnummer != nachher.bestandsnummer
        || vorher.traegerorganisation != nachher.traegerorganisation;
    let melden = match o {
        MaterialOrt::Einheit(_) => einheit_sieht,
        _ => zeile,
    };
    if melden {
        sse_ort(state, einsatz_id, o);
    }
}

#[derive(Debug, Deserialize)]
pub struct AufteilenBody {
    /// Die abzuteilende Menge: mindestens 1 (sonst 400) und kleiner als die Menge des Postens
    /// (sonst 422).
    pub menge: i64,
    /// Der Ort des abgeteilten Teils (t1hvaqzu, design.md D1), dieselben Tri-State-Felder wie im
    /// PATCH, bezogen auf den Ort der Ausgangszeile: fehlen alle = gleicher Ort, Wert = dorthin,
    /// `null` am aktuellen Ort = ohne Ort. Mehr als ein Wert → 422.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einheit_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einsatz_fahrzeug_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub br_id: Option<Option<i64>>,
}

/// POST /api/einsaetze/{id}/material/{em_id}/aufteilen — einen Posten auf zwei Zeilen aufteilen
/// (LLH-1093, design.md D8): die Ausgangszeile wird um `menge` gemindert, eine neue Zeile mit
/// `menge` übernimmt Angaben, Art, Status, Bemerkung, Ort und Dispositionszeitpunkt und beginnt
/// ohne Ausgabe (LLH-1224 D14). Nennt der Body einen Ort, steht die neue Zeile dort (t1hvaqzu,
/// design.md D1/D2). Ein ETB-Eintrag in derselben Transaktion, bei einem Ortswechsel mit altem und
/// neuem Ort (D3). Reihenfolge: 400 (`menge` < 1) → 422 (zwei Orte) → 404 (Zeile) → 409
/// (beendet) → 422 (Gerät, `menge` ab der Menge, über dem Rest) → 404/409/422 (Ziel); jede
/// Ablehnung schreibt nichts. Liefert 201 mit `[Ausgang, neu]`.
pub async fn aufteilen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AufteilenBody>,
) -> Result<(StatusCode, Json<Vec<EinsatzMaterialAnzeige>>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    if body.menge < 1 {
        return Err(AppError::Validation(
            "Abzuteilende Menge muss mindestens 1 sein".into(),
        ));
    }
    let ort_patch = OrtPatch {
        einheit_id: body.einheit_id,
        einsatz_fahrzeug_id: body.einsatz_fahrzeug_id,
        uhs_id: body.uhs_id,
        br_id: body.br_id,
    };
    ort_patch.validate()?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    // F06/LFH-244 Tier-A: Mindern, Anlegen, Ort und System-ETB atomar in EINER Tx; SSE erst nach
    // dem Commit.
    let (ausgang, neu, wechsel) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let (neu_id, wechsel) =
            disposition_repo::teile_auf_tx(conn, einsatz_id, em_id, body.menge, ort_patch).await?;
        let ortswechsel = if wechsel.is_changed() {
            Some((
                ort::ort_text_tx(conn, einsatz_id, wechsel.vorher).await?,
                ort::ort_text_tx(conn, einsatz_id, wechsel.nachher).await?,
            ))
        } else {
            None
        };
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_aufgeteilt(
                &vorher.bezeichnung,
                vorher.menge,
                body.menge,
                ortswechsel
                    .as_ref()
                    .map(|(alt, neu)| (alt.as_str(), neu.as_str())),
            ),
        )
        .await?;
        let ausgang = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let neu = disposition_repo::load_anzeige_tx(conn, einsatz_id, neu_id, true).await?;
        Ok((ausgang, neu, wechsel))
    })?;
    sse_material(&state, einsatz_id, ausgang.id);
    sse_material(&state, einsatz_id, neu.id);
    notify_nachforderung(&state, &ausgang);
    // Der Ort zeigt sein Material als Liste und bekommt eine Zeile dazu (`material` erreicht
    // seine Leser ohne Materialrecht nicht, LLH-1182); wandert der abgeteilte Teil, auch das Ziel
    // (Spec `material-modell`, „Ortswechsel live“).
    if let Some(o) = ausgang.ort() {
        sse_ort(&state, einsatz_id, o);
    }
    if let (true, Some(ziel)) = (wechsel.is_changed(), wechsel.nachher) {
        sse_ort(&state, einsatz_id, ziel);
    }
    Ok((StatusCode::CREATED, Json(vec![ausgang, neu])))
}

#[derive(Debug, Deserialize)]
pub struct VerknuepfenBody {
    pub nachforderung_id: i64,
    /// Wie bei der Übernahme (LLH-1226 D3): fehlt = `false`, dann ist ein schon übernommener
    /// Posten der Nachforderung 409.
    pub ergaenzen: Option<bool>,
}

/// POST /api/einsaetze/{id}/material/{em_id}/nachforderung — einen vorhandenen Posten nachträglich
/// mit einer eingetroffenen Nachforderung verknüpfen (LLH-1259, design.md D1–D4); der PATCH nimmt
/// `nachforderung_id` bewusst nicht an. Gleiche Prüfungen wie die Übernahme. Reihenfolge: 400
/// (Feld) → 403 (Nachforderungen nicht freigegeben, vor jedem Lesen) → in der Transaktion 404/409
/// (Posten: fremd, beendet, schon mit Bezug) → 404/422/409 (Nachforderung: fremd, nicht
/// eingetroffen, schon übernommen ohne `ergaenzen`). Bezug und genau ein ETB-Eintrag atomar.
/// Liefert den Posten.
pub async fn verknuepfen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<VerknuepfenBody>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let nachforderung_id = body.nachforderung_id;
    let ergaenzen = body.ergaenzen.unwrap_or(false);
    // Erst die Freigabe (403), sonst verriete 404 gegen 200 die Nachforderung (LLH-1226 D1).
    ctx.fordere_zielmodul::<Nachforderungen>(&state.pool)
        .await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let posten = disposition_repo::check_verknuepfbar_tx(conn, einsatz_id, em_id).await?;
        let herkunft = crate::nachforderung::repo::check_uebernahme_tx(
            conn,
            einsatz_id,
            nachforderung_id,
            ergaenzen,
        )
        .await?;
        disposition_repo::set_nachforderung_tx(conn, einsatz_id, em_id, nachforderung_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_mit_nachforderung_verknuepft(
                &posten.bezeichnung,
                posten.menge,
                &herkunft,
            ),
        )
        .await?;
        disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await
    })?;
    sse_material(&state, einsatz_id, em_id);
    notify_nachforderung(&state, &anzeige);
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/material/{em_id}/entlassen — aus dem Einsatz nehmen (LLH-1079, Spec
/// `kraefte-entlassung`; die Oberfläche sagt „Aus dem Einsatz nehmen“, LLH-1093 Nr. 3). Die
/// Zeile bleibt, der Ort geht (LLH-1224 D13). Ohne Rückfrage, der Rückweg ist `…/reaktivieren`.
/// Schreibt ETB-Eintrag; beendetes Material → 409. Liefert das herausgenommene Material.
pub async fn entlassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    // F06/LFH-244 Tier-A: Bindungen lösen, Endzustand und System-ETB atomar in EINER Tx; SSE erst
    // nach dem Commit.
    let (ergebnis, anzeige) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let ergebnis =
            disposition_repo::entlassen_tx(conn, einsatz_id, em_id, ctx.benutzer.id, &jetzt)
                .await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_aus_einsatz_genommen(
                &vorher.bezeichnung,
                vorher.menge,
                ergebnis.einheit.as_ref().map(|(_, name)| name.as_str()),
            ),
        )
        .await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        Ok((ergebnis, anzeige))
    })?;
    sse_material(&state, einsatz_id, em_id);
    // Der Ort zeigt das Material; `material` erreicht seine Leser ohne Materialrecht nicht
    // (LLH-1182).
    if let Some(o) = ergebnis.ort {
        sse_ort(&state, einsatz_id, o);
    }
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/material/{em_id}/stornieren — Fehldisposition stornieren (LLH-1079,
/// design.md D3): nur ohne Ort (LLH-1224 D13) und in den ersten 15 Minuten, sonst 422 mit dem
/// Grund; beendetes Material → 409. ETB-Eintrag.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let vorher = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::require_aktiv_tx(conn, einsatz_id, em_id).await?;
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        disposition_repo::stornieren_tx(conn, einsatz_id, em_id, ctx.benutzer.id, &jetzt).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_storniert(&vorher.bezeichnung, vorher.menge),
        )
        .await?;
        Ok(vorher)
    })?;
    sse_material(&state, einsatz_id, em_id);
    // Ein stornierter Posten zählt nicht mehr als Übernahme (LLH-1226, design.md D3).
    notify_nachforderung(&state, &vorher);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/einsaetze/{id}/material/{em_id}/reaktivieren — herausgenommenes oder storniertes
/// Material erneut disponieren (LLH-1079, design.md D7): Block „Aus dem Einsatz genommen“ und
/// Rückgängig nach dem Herausnehmen. Aktiv → 409. ETB-Eintrag. Ein stornierter Posten aus einer
/// Nachforderung zählt danach wieder als Übernahme und verlangt wie diese eine eingetroffene
/// Nachforderung (422, LLH-1226); ein schon vorhandener Posten sperrt nicht, das Reaktivieren ist
/// bewusstes Rückgängigmachen des Stornos.
pub async fn reaktivieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let storniert = vorher.beendet_als.as_deref()
            == Some(crate::entlassung::BeendetAls::Storniert.as_str());
        if let (true, Some(nid)) = (storniert, vorher.nachforderung_id) {
            crate::nachforderung::repo::check_uebernahme_tx(conn, einsatz_id, nid, true).await?;
        }
        disposition_repo::reaktivieren_tx(
            conn,
            einsatz_id,
            ctx.einsatz.org_id,
            em_id,
            ctx.benutzer.id,
        )
        .await?;
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_erneut_disponiert(&anzeige.bezeichnung, anzeige.menge),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_material(&state, einsatz_id, em_id);
    notify_nachforderung(&state, &anzeige);
    Ok(Json(anzeige))
}
