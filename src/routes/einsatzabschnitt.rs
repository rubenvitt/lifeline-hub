use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Einsatzabschnitte;
use crate::einsatz::verbindungen::{self, VerbindungBody, ABSCHNITT_RUFNAME_MAX};
use crate::einsatzabschnitt::repo::{
    self as abschnitt_repo, AbschnittDaten, AbschnittPatch, NamensTraeger,
};
use crate::einsatzabschnitt::{AbschnittLagezustand, EinsatzabschnittAnzeige};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, optional_max, optional_max_tri, pflicht, trimme, trimme_tri,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::de::IgnoredAny;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Abschnitt (Fläche/Symbol) hat sich geändert.
pub(super) fn sse_abschnitt(state: &AppState, einsatz_id: i64, aid: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Abschnitt, "abschnitt_id", aid);
}

/// Meldet jedes Objekt, das den Abschnittsnamen per Join trägt, mit dem Ereignis seines Moduls
/// (LLH-1291): `abschnitt` erreicht nur Leser mit Modul `einsatzabschnitte`, wer nur Räume,
/// Stellen oder Bezirke sieht, behielte den alten Namen bis zum Neuladen. Nach dem Commit.
fn sse_namens_traeger(state: &AppState, einsatz_id: i64, t: &NamensTraeger) {
    for &br_id in &t.raeume {
        super::einsatz_bereitstellungsraum::sse_br(state, einsatz_id, br_id);
    }
    for &stelle_id in &t.stellen {
        super::betreuung::publiziere(state, einsatz_id, &[], stelle_id);
    }
    for &bezirk_id in &t.bezirke {
        super::evakuierung::publiziere(state, einsatz_id, &[], bezirk_id);
    }
}

/// [`sse_namens_traeger`] nach einem Umbenennen: liest die Träger nach dem Commit. Scheitert das
/// Lesen, bleibt es bei einer Warnung (Muster `etb_system_degradiert`); der Name ist gespeichert.
async fn sse_umbenannt(state: &AppState, einsatz_id: i64, aid: i64) {
    let gelesen = match state.pool.acquire().await {
        Ok(mut conn) => abschnitt_repo::namens_traeger(&mut conn, einsatz_id, aid).await,
        Err(e) => Err(e),
    };
    match gelesen {
        Ok(t) => sse_namens_traeger(state, einsatz_id, &t),
        Err(e) => tracing::warn!(
            einsatz_id,
            abschnitt_id = aid,
            fehler = %e,
            "Träger des Abschnittsnamens nicht lesbar, Live-Ereignis entfällt"
        ),
    }
}

/// Längster zulässiger Kurzname — ein Rufname wie „EA-Nord", kein zweiter Name.
const KURZBEZEICHNUNG_MAX: usize = 20;

/// Unbekannter Lagezustand → 400: das Feld ist für sich unbrauchbar (LFH-267).
fn parse_lagezustand(s: &str) -> Result<AbschnittLagezustand, AppError> {
    AbschnittLagezustand::parse(s).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannter Lagezustand «{s}» (erlaubt: planmaessig, angespannt, kritisch)"
        ))
    })
}

fn check_kurzbezeichnung(kurz: &str) -> Result<(), AppError> {
    if kurz.chars().count() > KURZBEZEICHNUNG_MAX {
        return Err(AppError::Validation(format!(
            "Kurzbezeichnung darf höchstens {KURZBEZEICHNUNG_MAX} Zeichen lang sein"
        )));
    }
    Ok(())
}

/// Lesbarer Lagezustand für den ETB; `None` = die Beurteilung fehlt.
fn lage_wort(l: Option<AbschnittLagezustand>) -> &'static str {
    l.map_or("nicht beurteilt", |l| l.wort())
}

/// GET /api/einsaetze/{id}/abschnitte — flache Liste (Baum baut das FE). Nur Lesezugriff.
pub async fn list(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Einsatzabschnitte>,
) -> Result<Json<Vec<EinsatzabschnittAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let mut liste = abschnitt_repo::list(&state.pool, einsatz_id).await?;
    // Ein Abschnittsgerät (LFH-1043) sieht nur seinen Teilbaum.
    if let Some(b) = crate::geraet::abschnitt::bereich(&state.pool, ctx.geraet.as_ref()).await? {
        liste.retain(|a| b.abschnitte.contains(&a.id));
    }
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct AbschnittBody {
    pub name: String,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<String>,
    /// Funkrufname der Abschnittsleitung (LLH-1134).
    pub rufname: Option<String>,
    /// Telefon und weitere Verbindungen (LLH-1134), in Eingabefolge.
    pub verbindungen: Option<Vec<VerbindungBody>>,
    /// Abgelöst durch `verbindungen` (LLH-1134): gesetzt → 400, nie still verworfen.
    pub kommunikationsmittel: Option<IgnoredAny>,
    /// Abgelöst durch `verbindungen` (LLH-1134): gesetzt → 400, nie still verworfen.
    pub erreichbarkeit: Option<IgnoredAny>,
    #[serde(default)]
    pub sortier: i64,
    /// Sprechgruppen-IDs; `Some` ersetzt die Zuordnung vollständig, `None` lässt sie unverändert.
    pub sprechgruppe_ids: Option<Vec<i64>>,
    pub kurzbezeichnung: Option<String>,
    /// Wire-Wert von [`AbschnittLagezustand`]; als String gelesen, damit ein unbekannter
    /// Wert eine sprechende 400 bekommt statt der Extractor-Meldung.
    pub lagezustand: Option<String>,
    pub abschnittsauftrag: Option<String>,
}

/// POST /api/einsaetze/{id}/abschnitte — anlegen. Schreibrecht + aktiv. ETB-Eintrag.
pub async fn create(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    JsonBody(body): JsonBody<AbschnittBody>,
) -> Result<(StatusCode, Json<EinsatzabschnittAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Liste vor jedem Schreiben begrenzen (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
    let sprechgruppe_ids = body
        .sprechgruppe_ids
        .map(crate::sprechgruppe::normalisiere_ids)
        .transpose()?;
    verbindungen::lehne_altfelder_ab(
        body.kommunikationsmittel.is_some(),
        body.erreichbarkeit.is_some(),
    )?;
    let neue_verbindungen = body
        .verbindungen
        .map(verbindungen::pruefe_liste)
        .transpose()?;
    let name = pflicht(&body.name, "Name")?;
    let bemerkung = trimme(body.bemerkung);
    let rufname = optional_max(body.rufname, "Rufname", ABSCHNITT_RUFNAME_MAX)?;
    let kurz = trimme(body.kurzbezeichnung);
    if let Some(k) = &kurz {
        check_kurzbezeichnung(k)?;
    }
    let lagezustand = trimme(body.lagezustand)
        .as_deref()
        .map(parse_lagezustand)
        .transpose()?;
    let abschnittsauftrag = trimme(body.abschnittsauftrag);
    let mut anzeige = abschnitt_repo::create(
        &state.pool,
        einsatz_id,
        AbschnittDaten {
            name: &name,
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_deref(),
            rufname: rufname.as_deref(),
            sortier: body.sortier,
            kurzbezeichnung: kurz.as_deref(),
            lagezustand,
            abschnittsauftrag: abschnittsauftrag.as_deref(),
        },
    )
    .await?;
    if let Some(ids) = sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            anzeige.id,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::load(&state.pool, einsatz_id, anzeige.id).await?;
    }
    if let Some(liste) = neue_verbindungen {
        verbindungen::ersetzen(
            &state.pool,
            einsatz_id,
            verbindungen::Bezug::Abschnitt(anzeige.id),
            &liste,
        )
        .await?;
        anzeige = abschnitt_repo::load(&state.pool, einsatz_id, anzeige.id).await?;
    }
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        ctx.benutzer.id,
        &crate::einsatzabschnitt::etb_text_angelegt(&anzeige.name, anzeige.lagezustand),
    )
    .await;
    sse_abschnitt(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH-Body (LFH-306, Tri-State): jedes Feld optional, absent = unverändert,
/// `null`/`""` = leeren. Getrennt von [`AbschnittBody`], damit der POST sein Pflicht-`name`
/// strukturell erzwingt. **Kein `#[serde(default)]` an `sortier`** — das machte aus
/// „nicht gesendet" ein „auf 0 setzen".
#[derive(Debug, Deserialize)]
pub struct AbschnittPatchBody {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ueber_abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub leiter_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub rufname: Option<Option<String>>,
    /// Ersetzt die Verbindungen vollständig (LLH-1134); fehlt = unverändert.
    pub verbindungen: Option<Vec<VerbindungBody>>,
    /// Abgelöst durch `verbindungen` (LLH-1134): im Body (auch `null`) → 400.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kommunikationsmittel: Option<Option<IgnoredAny>>,
    /// Abgelöst durch `verbindungen` (LLH-1134): im Body (auch `null`) → 400.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub erreichbarkeit: Option<Option<IgnoredAny>>,
    pub sortier: Option<i64>,
    /// Sprechgruppen-IDs; `Some` ersetzt die Zuordnung vollständig, `None` lässt sie
    /// unverändert — das Feld war schon vor LFH-306 tri-state.
    pub sprechgruppe_ids: Option<Vec<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kurzbezeichnung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lagezustand: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnittsauftrag: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid} — echter Teil-Patch (LFH-306).
/// Kein ETB-Eintrag für Korrekturen — AUSSER beim Wechsel des Lagezustands (LFH-608):
/// „Abschnitt Nord ist kritisch" ist eine Lagemeldung, keine Stammdatenpflege, und gehört
/// mit Zeitpunkt und Urheber ins Tagebuch.
pub async fn update(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbschnittPatchBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Vor jedem Schreiben, auch vor dem Lagewechsel (LFH-937, design.md D5).
    let sprechgruppe_ids = body
        .sprechgruppe_ids
        .map(crate::sprechgruppe::normalisiere_ids)
        .transpose()?;
    let name = match body.name {
        Some(n) => {
            let n = pflicht(&n, "Name")?;
            Some(n)
        }
        None => None,
    };
    verbindungen::lehne_altfelder_ab(
        body.kommunikationsmittel.is_some(),
        body.erreichbarkeit.is_some(),
    )?;
    let neue_verbindungen = body
        .verbindungen
        .map(verbindungen::pruefe_liste)
        .transpose()?;
    let bemerkung = trimme_tri(body.bemerkung);
    let rufname = optional_max_tri(body.rufname, "Rufname", ABSCHNITT_RUFNAME_MAX)?;
    let kurz = trimme_tri(body.kurzbezeichnung);
    if let Some(Some(k)) = &kurz {
        check_kurzbezeichnung(k)?;
    }
    let lagezustand = match trimme_tri(body.lagezustand) {
        Some(Some(s)) => Some(Some(parse_lagezustand(&s)?)),
        Some(None) => Some(None),
        None => None,
    };
    let abschnittsauftrag = trimme_tri(body.abschnittsauftrag);
    // Nur ein echter Namenswechsel meldet die Träger des Namens (LLH-1291).
    let name_vorher = match &name {
        Some(_) => Some(
            abschnitt_repo::load(&state.pool, einsatz_id, aid)
                .await?
                .name,
        ),
        None => None,
    };
    let mut anzeige = abschnitt_repo::update(
        &state.pool,
        einsatz_id,
        aid,
        AbschnittPatch {
            name: name.as_deref(),
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_ref().map(|v| v.as_deref()),
            rufname: rufname.as_ref().map(|v| v.as_deref()),
            sortier: body.sortier,
            kurzbezeichnung: kurz.as_ref().map(|v| v.as_deref()),
            abschnittsauftrag: abschnittsauftrag.as_ref().map(|v| v.as_deref()),
        },
    )
    .await?;
    // Der Name ist jetzt gespeichert: sofort melden, auch wenn ein späterer Schritt (Sprechgruppen,
    // Verbindungen) mit 422 scheitert.
    if name_vorher.is_some_and(|v| v != anzeige.name) {
        sse_umbenannt(&state, einsatz_id, aid).await;
    }
    // Lagewechsel + ETB-Eintrag atomar in EINER Tx, und zwar VOR der Sprechgruppen-
    // Zuordnung: scheitert die mit 422, bleibt der gespeicherte Wechsel trotzdem nicht
    // undokumentiert (LFH-608, Review). Der Eintrag entsteht nur bei echtem Wechsel.
    if let Some(neu) = lagezustand {
        let startwert = etb_startwert(&state.pool, einsatz_id).await?;
        let etb_id = crate::write_retry!(&state.pool, |conn| {
            match abschnitt_repo::set_lagezustand_tx(conn, einsatz_id, aid, neu).await? {
                Some(wechsel) => {
                    let text = format!(
                        "Lage Abschnitt «{}»: {} → {}",
                        wechsel.name,
                        lage_wort(wechsel.vorher),
                        lage_wort(neu)
                    );
                    Ok(Some(
                        crate::etb::system_audit_tx(
                            conn,
                            einsatz_id,
                            ctx.benutzer.id,
                            startwert,
                            &text,
                        )
                        .await?,
                    ))
                }
                None => Ok(None),
            }
        })?;
        if let Some(etb_id) = etb_id {
            // Live erst nach dem Commit (Reinheits-Kontrakt wie beim Auflösen).
            state.live.publiziere(einsatz_id, etb_id);
        }
        anzeige = abschnitt_repo::load(&state.pool, einsatz_id, aid).await?;
    }
    if let Some(ids) = sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            aid,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::load(&state.pool, einsatz_id, aid).await?;
    }
    if let Some(liste) = neue_verbindungen {
        verbindungen::ersetzen(
            &state.pool,
            einsatz_id,
            verbindungen::Bezug::Abschnitt(aid),
            &liste,
        )
        .await?;
        anzeige = abschnitt_repo::load(&state.pool, einsatz_id, aid).await?;
    }
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid} — auflösen (Reparenting). ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = abschnitt_repo::load(&state.pool, einsatz_id, aid).await?;
    // F06/LFH-244 Tier-A: Auflösen (Reparenting + Freigaben + DELETE) + System-ETB-Eintrag
    // atomar in EINER Tx (BEGIN IMMEDIATE + Retry). ETB-Text aus dem VOR der Tx geladenen
    // `vorher` (Name unverändert). SSE erst nach dem Commit (Reinheits-Kontrakt).
    let text = format!("Abschnitt «{}» aufgelöst", vorher.name);
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let von = ctx.benutzer.id;
    // Ein an den Abschnitt gekoppeltes Gerät (LFH-1040) hätte keine Stelle mehr: es endet mit
    // dem Abschnitt, wie bei einem Widerruf durch die Einsatzleitung.
    let (widerrufen, traeger) = crate::write_retry!(&state.pool, |conn| {
        // Vor dem Freigeben der Bezüge: danach zeigen Räume, Stellen und Bezirke keinen
        // Abschnitt mehr, und ihre Leser erfahren das sonst nicht (LLH-1291).
        let traeger = abschnitt_repo::namens_traeger(conn, einsatz_id, aid).await?;
        let geraete =
            crate::geraet::repo::widerrufe_am_abschnitt(conn, einsatz_id, aid, von).await?;
        abschnitt_repo::aufloesen_tx(conn, einsatz_id, aid).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?;
        for (_, anzeigename) in &geraete {
            let geraet_text = format!(
                "Gerät „{anzeigename}“ (Einsatzabschnitt) widerrufen: Abschnitt «{}» aufgelöst.",
                vorher.name
            );
            crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &geraet_text).await?;
        }
        Ok((geraete, traeger))
    })?;
    for (kopplung_id, _) in &widerrufen {
        state.live.melde_kopplung_ende(*kopplung_id);
    }
    sse_abschnitt(&state, einsatz_id, aid);
    sse_namens_traeger(&state, einsatz_id, &traeger);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/abschnitte/{aid}/sprechgruppen/{sg} — eine Sprechgruppe zuordnen
/// (LFH-893, design.md D5). Idempotent; dieselbe Prüfung, Zuordnung und Live-Wirkung wie der
/// PATCH mit `sprechgruppe_ids`, kein ETB (auch der PATCH schreibt dafür keinen).
pub async fn sprechgruppe_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    PfadParam((_eid, aid, sg)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Abschnitt(aid);
    if crate::sprechgruppe::repo::einzeln_zuordnen(
        &state.pool,
        ctx.einsatz.org_id,
        einsatz_id,
        ziel,
        sg,
    )
    .await?
    {
        sse_abschnitt(&state, einsatz_id, aid);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid}/sprechgruppen/{sg} — Zuordnung lösen, idempotent.
pub async fn sprechgruppe_loesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    PfadParam((_eid, aid, sg)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Abschnitt(aid);
    if crate::sprechgruppe::repo::einzeln_loesen(&state.pool, einsatz_id, ziel, sg).await? {
        sse_abschnitt(&state, einsatz_id, aid);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct FlaecheBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub flaeche_geojson: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid}/flaeche — Lage-Pflege, KEIN ETB.
pub async fn flaeche(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einsatzabschnitte>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FlaecheBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if let Some(Some(gj)) = &body.flaeche_geojson {
        // Größe vor dem Parsen, Struktur nach den bestehenden 422 (LFH-937, design.md D7).
        crate::lage_zone::pruefe_geometrie_groesse(gj, "flaeche_geojson")?;
        let v: serde_json::Value = serde_json::from_str(gj).map_err(|_| {
            AppError::UnprocessableEntity("flaeche_geojson ist kein gültiges JSON".into())
        })?;
        if v.get("type").and_then(|t| t.as_str()) != Some("Polygon") {
            return Err(AppError::UnprocessableEntity(
                "flaeche_geojson muss ein GeoJSON-Polygon sein".into(),
            ));
        }
        crate::lage_zone::pruefe_geometrie_struktur(&v, "flaeche_geojson")?;
    }

    let nachher = abschnitt_repo::update_flaeche(
        &state.pool,
        einsatz_id,
        aid,
        abschnitt_repo::FlaechePatch {
            flaeche_geojson: body.flaeche_geojson.as_ref().map(|o| o.as_deref()),
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(nachher))
}
