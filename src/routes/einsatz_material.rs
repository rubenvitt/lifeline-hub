use super::einsatz_uhs::sse_uhs;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Material;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::material::disposition_repo::{self, AdhocDaten, MaterialPatch};
use crate::material::{EinsatzMaterialAnzeige, MaterialStatus, ADHOC_TEXT_MAX, BEMERKUNG_MAX};
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
    Ok(Json(
        if parse_flag(params.entlassene.as_deref(), "entlassene")? {
            disposition_repo::list_entlassene(&state.pool, einsatz_id, aktiv).await?
        } else {
            disposition_repo::liste(&state.pool, einsatz_id, aktiv).await?
        },
    ))
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
}

/// POST /api/einsaetze/{id}/material — Stamm-Material disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag (inkl. Menge).
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

    // F06/LFH-244 Tier-A: Domänen-Write + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige (bei Stamm-
    // Material stammt die Bezeichnung erst aus dem Snapshot des INSERT) für ETB-Text UND
    // Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let em_id = match &ziel {
            Ziel::Stamm(material_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *material_id,
                    menge,
                    ctx.benutzer.id,
                )
                .await?
            }
            Ziel::Adhoc(daten) => {
                disposition_repo::disponiere_adhoc_tx(
                    conn,
                    einsatz_id,
                    *daten,
                    menge,
                    ctx.benutzer.id,
                )
                .await?
            }
        };
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_disponiert(&anzeige.bezeichnung, anzeige.menge),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_material(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    pub status: Option<String>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    /// Verortung an einer UHS, Tri-State; ein neuer Wert muss eine UHS des Einsatzes in `geplant`
    /// oder `aktiv` sein (LLH-1093, design.md D4).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
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

/// PATCH /api/einsaetze/{id}/material/{em_id} — Menge, Status, Bemerkung, UHS und bei
/// Ad-hoc-Posten Bezeichnung, Kategorie, Bestandsnummer und Träger (LLH-1093).
/// Mengen-Änderung und Status-Wechsel schreiben je einen ETB-Eintrag, geänderte Angaben zusammen
/// einen weiteren; eine reine Bemerkungs- oder UHS-Änderung schreibt keinen. Reihenfolge: 400
/// (Feld) → 404 (Zeile) → 409 (beendet) → 422 (Stamm-Posten, UHS aufgelöst).
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
    // Status validieren (festes Enum). Ungültig → Validation.
    let status = match &body.status {
        Some(s) => {
            let parsed = MaterialStatus::parse(s)
                .ok_or_else(|| AppError::Validation("Unbekannter Status".into()))?;
            Some(parsed.as_str())
        }
        None => None,
    };

    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren passiert hier in
    // der Route, das Repo bleibt dumm — wie bei `uhs_id`.
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
    fn tri(w: &Option<Option<String>>) -> Option<Option<&str>> {
        w.as_ref().map(|o| o.as_deref())
    }
    let patch = MaterialPatch {
        menge: body.menge,
        status,
        bemerkung: tri(&bemerkung),
        uhs_id: body.uhs_id,
        bezeichnung: bezeichnung.as_deref(),
        kategorie: tri(&kategorie),
        bestandsnummer: tri(&bestandsnummer),
        traegerorganisation: tri(&traeger),
    };

    // F06/LFH-244 Tier-A: Domänen-Update + die (bis zu drei) System-ETB-Einträge atomar in
    // EINER Tx (BEGIN IMMEDIATE + Retry). Vor- und Nachzustand liest die Tx selbst; der Reload
    // (`nachher`) liefert die frischen Werte für ETB-Texte UND Response; ein Menge-Wechsel und
    // ein Status-Wechsel schreiben je einen Eintrag (eine reine Bemerkungsänderung keinen). SSE
    // erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (vorher, nachher) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        disposition_repo::update_tx(conn, einsatz_id, em_id, patch).await?;
        let nachher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        if vorher.menge != nachher.menge {
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!(
                    "Material «{}»: Menge {} → {}",
                    nachher.bezeichnung, vorher.menge, nachher.menge
                ),
            )
            .await?;
        }
        if vorher.status != nachher.status {
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!(
                    "Material «{}»: Status «{}» → «{}»",
                    nachher.bezeichnung,
                    vorher.status.as_str(),
                    nachher.status.as_str()
                ),
            )
            .await?;
        }
        // LLH-1093, design.md D6: ein Eintrag für alle geänderten Ad-hoc-Angaben.
        if let Some(text) = crate::material::etb_text_angaben(&vorher, &nachher) {
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        }
        Ok((vorher, nachher))
    })?;
    sse_material(&state, einsatz_id, em_id);
    // `material` erreicht Einheiten- und UHS-Leser ohne Materialrecht nicht (LLH-1182). Die
    // Einheit zeigt Bezeichnung, Menge und Status ihres Materials, das UHS-Detail die ganze Zeile
    // des dort verorteten Materials (LFH-892); beim Umverorten ändern sich alte und neue UHS.
    if let Some(einheit_id) = nachher.einheit_id {
        if vorher.menge != nachher.menge
            || vorher.status != nachher.status
            || vorher.bezeichnung != nachher.bezeichnung
        {
            super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
        }
    }
    let has_row_changed = vorher.menge != nachher.menge
        || vorher.status != nachher.status
        || vorher.bemerkung != nachher.bemerkung
        || vorher.uhs_id != nachher.uhs_id
        || vorher.bezeichnung != nachher.bezeichnung
        || vorher.kategorie != nachher.kategorie
        || vorher.bestandsnummer != nachher.bestandsnummer
        || vorher.traegerorganisation != nachher.traegerorganisation;
    if has_row_changed {
        if let Some(uhs_id) = vorher.uhs_id {
            sse_uhs(&state, einsatz_id, uhs_id);
        }
        if let Some(uhs_id) = nachher.uhs_id.filter(|u| Some(*u) != vorher.uhs_id) {
            sse_uhs(&state, einsatz_id, uhs_id);
        }
    }
    Ok(Json(nachher))
}

#[derive(Debug, Deserialize)]
pub struct AufteilenBody {
    /// Die abzuteilende Menge: mindestens 1 (sonst 400) und kleiner als die Menge des Postens
    /// (sonst 422).
    pub menge: i64,
}

/// POST /api/einsaetze/{id}/material/{em_id}/aufteilen — einen Posten auf zwei Zeilen aufteilen
/// (LLH-1093, design.md D8): die Ausgangszeile wird um `menge` gemindert, eine neue Zeile mit
/// `menge` übernimmt Angaben, Status, Bemerkung, Ort und Dispositionszeitpunkt. Ein ETB-Eintrag in
/// derselben Transaktion. 400 bei `menge` < 1, 404 bei fremder Zeile, 409 bei beendetem Material,
/// 422 bei `menge` ab der Menge des Postens. Liefert 201 mit `[Ausgang, neu]`.
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
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    // F06/LFH-244 Tier-A: Mindern, Anlegen und System-ETB atomar in EINER Tx; SSE erst nach dem
    // Commit.
    let (ausgang, neu) = crate::write_retry!(&state.pool, |conn| {
        let vorher = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let neu_id = disposition_repo::teile_auf_tx(conn, einsatz_id, em_id, body.menge).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_aufgeteilt(&vorher.bezeichnung, vorher.menge, body.menge),
        )
        .await?;
        let ausgang = disposition_repo::load_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        let neu = disposition_repo::load_anzeige_tx(conn, einsatz_id, neu_id, true).await?;
        Ok((ausgang, neu))
    })?;
    sse_material(&state, einsatz_id, ausgang.id);
    sse_material(&state, einsatz_id, neu.id);
    // Die Einheit zeigt ihr Material als Liste, das UHS-Detail die Zeilen der UHS; beide bekommen
    // eine Zeile dazu (`material` erreicht ihre Leser ohne Materialrecht nicht, LLH-1182).
    if let Some(einheit_id) = ausgang.einheit_id {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
    }
    if let Some(uhs_id) = ausgang.uhs_id {
        sse_uhs(&state, einsatz_id, uhs_id);
    }
    Ok((StatusCode::CREATED, Json(vec![ausgang, neu])))
}

/// POST /api/einsaetze/{id}/material/{em_id}/entlassen — aus dem Einsatz nehmen (LLH-1079, Spec
/// `kraefte-entlassung`; die Oberfläche sagt „Aus dem Einsatz nehmen“, LLH-1093 Nr. 3). Die
/// Zeile bleibt, Einheit und UHS gehen. Ohne Rückfrage, der Rückweg ist `…/reaktivieren`.
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
    // Einheit und UHS-Detail zeigen das Material; `material` erreicht ihre Leser ohne
    // Materialrecht nicht (LLH-1182).
    if let Some((einheit_id, _)) = ergebnis.einheit {
        super::einsatz_einheit::sse_einheit(&state, einsatz_id, einheit_id);
    }
    if let Some(uhs_id) = ergebnis.uhs_id {
        sse_uhs(&state, einsatz_id, uhs_id);
    }
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/material/{em_id}/stornieren — Fehldisposition stornieren (LLH-1079,
/// design.md D3): nur ohne Einheit und UHS und in den ersten 15 Minuten, sonst 422 mit dem
/// Grund; beendetes Material → 409. ETB-Eintrag.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    crate::write_retry!(&state.pool, |conn| {
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
        Ok(())
    })?;
    sse_material(&state, einsatz_id, em_id);
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/einsaetze/{id}/material/{em_id}/reaktivieren — herausgenommenes oder storniertes
/// Material erneut disponieren (LLH-1079, design.md D7): Block „Aus dem Einsatz genommen“ und
/// Rückgängig nach dem Herausnehmen. Aktiv → 409. ETB-Eintrag.
pub async fn reaktivieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
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
    Ok(Json(anzeige))
}
