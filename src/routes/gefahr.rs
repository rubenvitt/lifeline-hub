use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Gefahrenzonen;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige, GefahrengebietAnzeige};
use crate::live::LiveEvent;
use crate::routes::support::{deserialize_optional_field, parse_enum, trimme, trimme_tri};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: die Gefahrenmatrix eines Gebiets hat sich geändert. Event-Tag `gefahr`.
fn sse_gefahr(state: &AppState, einsatz_id: i64, gefahrengebiet_id: i64) {
    state.live.publiziere_objekt(
        einsatz_id,
        LiveEvent::Gefahr,
        "gefahrengebiet_id",
        gefahrengebiet_id,
    );
}

/// GET /api/einsaetze/{id}/gefahrengebiete — alle Gefahrengebiete (Übersicht/Karten-Styling).
pub async fn gebiete(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Gefahrenzonen>,
) -> Result<Json<Vec<GefahrengebietAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        gefahr_repo::gebiete_liste(&state.pool, einsatz_id).await?,
    ))
}

/// GET /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix — gesetzte Zellen eines Gebiets.
pub async fn matrix(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Gefahrenzonen>,
    PfadParam((_eid, gid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<GefahrBewertungAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Ownership-Gate: Gebiet muss zum Einsatz gehören (sonst NotFound).
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?;
    Ok(Json(gefahr_repo::liste(&state.pool, gid).await?))
}

#[derive(Debug, Deserialize)]
pub struct BewertungBody {
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
}

/// PUT /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung — Zelle setzen (UPSERT).
pub async fn bewerten(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Gefahrenzonen>,
    PfadParam((_eid, gid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<BewertungBody>,
) -> Result<Json<GefahrBewertungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let gebiet = gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate

    // Unbekannter Enum-Wert = das Feld ist für sich unbrauchbar → 400 (LFH-305).
    // Die Kombinationsprüfung darunter bewertet erst den Zusammenhang → bleibt 422.
    parse_enum(
        gefahr::Gefahrentyp::parse,
        &body.gefahrentyp,
        format!("Unbekannter Gefahrentyp: {}", body.gefahrentyp),
    )?;
    parse_enum(
        gefahr::Schutzobjekt::parse,
        &body.schutzobjekt,
        format!("Unbekanntes Schutzobjekt: {}", body.schutzobjekt),
    )?;
    parse_enum(
        gefahr::Warnstufe::parse,
        &body.warnstufe,
        format!("Unbekannte Warnstufe: {}", body.warnstufe),
    )?;
    if !gefahr::kombination_gueltig(&body.gefahrentyp, &body.schutzobjekt) {
        return Err(AppError::UnprocessableEntity(format!(
            "Kombination {} × {} ist nicht zulässig",
            body.gefahrentyp, body.schutzobjekt
        )));
    }

    let alt =
        gefahr_repo::aktuelle_warnstufe(&state.pool, gid, &body.gefahrentyp, &body.schutzobjekt)
            .await?
            .unwrap_or_else(|| "keine".to_string());

    let beschreibung = trimme(body.beschreibung.clone());
    let gemeldet_von = trimme(body.gemeldet_von.clone());

    // F06/LFH-244 Tier-A: UPSERT + System-ETB-Eintrag atomar in EINER Tx (BEGIN IMMEDIATE
    // + Retry). ETB-Entscheidung/-Text folgen exakt dem alten Pfad: nur bei
    // Warnstufen-Änderung, aus der frisch geschriebenen Zelle (`z`) berechnet (der
    // Read-Vergleich gegen `alt` bleibt bewusst VOR der Tx — nur das Schreibpaar ist atomar).
    // SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let z = crate::write_retry!(&state.pool, |conn| {
        let z = gefahr_repo::upsert_bewertung_tx(
            conn,
            gid,
            BewertungDaten {
                gefahrentyp: &body.gefahrentyp,
                schutzobjekt: &body.schutzobjekt,
                warnstufe: &body.warnstufe,
                beschreibung: beschreibung.as_deref(),
                gemeldet_von: gemeldet_von.as_deref(),
                aktualisiert_von: ctx.benutzer.id,
            },
        )
        .await?;
        if z.warnstufe.as_str() != alt {
            let text = gefahr::etb_text_bewertung(
                z.gefahrentyp.as_str(),
                z.schutzobjekt.as_str(),
                gebiet.label.as_deref(),
                gid,
                z.warnstufe,
            );
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        }
        Ok(z)
    })?;
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(z))
}

/// PATCH-Body des Gefahrengebiets (LFH-306, Tri-State). `gefahrengebiet.label` ist nullable
/// (`migrations/0041`), deshalb muss der Ein-Feld-Body drei Fälle tragen: absent = Label
/// unverändert, `null`/`""` = Label leeren, Wert = setzen. Vorher kollabierte `trimme` die
/// ersten beiden Fälle zu `None` — ein Patch ohne `label` löschte das Label still.
#[derive(Debug, Deserialize)]
pub struct UmbenennenBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/gefahrengebiete/{gid} — Label des Gefahrengebiets ändern.
pub async fn umbenennen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Gefahrenzonen>,
    PfadParam((_eid, gid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<UmbenennenBody>,
) -> Result<Json<GefahrengebietAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate
    let label = trimme_tri(body.label);
    let g = gefahr_repo::gebiet_umbenennen(
        &state.pool,
        einsatz_id,
        gid,
        label.as_ref().map(|v| v.as_deref()),
    )
    .await?;
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(g))
}
