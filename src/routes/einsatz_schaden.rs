use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Schaeden;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::person::repo as person_repo; // Org-Isolation der Geschädigt-FK (404 bei fremder Person)
use crate::routes::support::{
    deserialize_optional_field, parse_enum, parse_enum_opt, pflicht, pflicht_tri,
    pruefe_koordinate, trimme,
};
use crate::schaden::{
    darf_uebergehen, ort_kurz, registrier_anzeige, repo as schaden_repo, AbschlussGrund, Ausmass,
    SchadenAnzeige, SchadenStatus, SchadenTyp,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

// ---------- ETB-/SSE-Helfer ----------

/// Verteilt `LiveEvent::Schaden` mit `{einsatz_id, schaden_id}`.
fn sse_schaden(state: &AppState, einsatz_id: i64, schaden_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Schaden, "schaden_id", schaden_id);
}

/// Nach dem Commit eines Schreibwegs mit System-ETB-Eintrag: erst `etb` (ID-only), dann
/// `schaden`. Ohne `etb` sehen andere Sitzungen das Tagebuch erst nach dem Neuladen (LFH-760).
/// Auch von den Anhang-Routen genutzt (LFH-21, `routes::schaden_anhang`), deshalb `pub(crate)`.
pub(crate) fn sse_lebenszyklus(state: &AppState, einsatz_id: i64, schaden_id: i64, etb_id: i64) {
    state.live.publiziere(einsatz_id, etb_id);
    sse_schaden(state, einsatz_id, schaden_id);
}

// ---------- GET /schaeden (Liste) ----------

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub geschaedigt_person_id: Option<i64>,
    #[serde(default)]
    pub inkl_storniert: bool,
}

pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Schaeden>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<SchadenAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Unbekannter Enum-Wert im Query-Filter: das Feld ist für sich unbrauchbar → 400
    // (LFH-305). Ohne diese Prechecks gäbe es hier kein 422, sondern ein 200 mit leerer
    // Liste — der Filterwert landet nur in einer WHERE-Klausel, es gibt keinen DB-CHECK
    // dahinter.
    parse_enum_opt(
        SchadenStatus::parse,
        params.status.as_deref(),
        "Unbekannter Status im Filter",
    )?;
    parse_enum_opt(
        SchadenTyp::parse,
        params.typ.as_deref(),
        "Unbekannter Typ im Filter",
    )?;
    parse_enum_opt(
        Ausmass::parse,
        params.ausmass.as_deref(),
        "Unbekanntes Ausmaß im Filter",
    )?;
    Ok(Json(
        schaden_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.typ.as_deref(),
            params.ausmass.as_deref(),
            params.geschaedigt_person_id,
            params.inkl_storniert,
        )
        .await?,
    ))
}

// ---------- POST /schaeden (Anlegen) ----------

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub geschaedigt_personal_id: Option<i64>,
    pub geschaedigt_organisation_id: Option<i64>,
}

pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<SchadenAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    if let Some(s) = &body.status {
        if s != "offen" {
            return Err(AppError::UnprocessableEntity(
                "Schaden kann nur als 'offen' angelegt werden".into(),
            ));
        }
    }
    // Pflichtfeld-Prechecks (LFH-305): jeder Fall bewertet das Feld ISOLIERT → 400.
    // Bewusst je zwei Zweige statt einer verschmolzenen Meldung — „Feld fehlt" und „Feld ist
    // da, aber unbrauchbar" sind für den Client zwei verschiedene Korrekturen. Die Felder
    // bleiben `Option<String>`: ein Wechsel auf `String` würde „fehlt" in den Extractor
    // verschieben und damit die Meldung für bestehende API-Konsumenten ändern.
    let Some(typ_roh) = body.typ.as_deref() else {
        return Err(AppError::Validation("Typ ist Pflicht".into()));
    };
    let Some(typ) = SchadenTyp::parse(typ_roh) else {
        return Err(AppError::Validation("Unbekannter Typ".into()));
    };
    let Some(ausmass_roh) = body.ausmass.as_deref() else {
        return Err(AppError::Validation("Ausmaß ist Pflicht".into()));
    };
    let Some(ausmass) = Ausmass::parse(ausmass_roh) else {
        return Err(AppError::Validation("Unbekanntes Ausmaß".into()));
    };
    // Gleiches Muster wie im PATCH derselben Datei: fehlend ≠ vorhanden-aber-leer.
    let Some(ort_roh) = body.ort.clone() else {
        return Err(AppError::Validation("Ort ist Pflicht".into()));
    };
    let ort = pflicht(&ort_roh, "Ort")?;
    pruefe_koordinate(body.lat, body.lon, "lat", "lon")?;
    let kontakt = trimme(body.geschaedigt_kontakt.clone());

    // Eigene Organisation: id wird IMMER serverseitig aus ctx.einsatz.org_id abgeleitet,
    // der vom Client gesendete Wert wird ignoriert (nie vertrauen).
    let org_gesetzt = body.geschaedigt_organisation_id.is_some();
    let geschaedigt_org_id = if org_gesetzt {
        Some(ctx.einsatz.org_id)
    } else {
        None
    };

    // 4‑Wege-Exklusivität: höchstens eine Geschädigt-Quelle.
    let anzahl_quellen = body.geschaedigt_person_id.is_some() as u8
        + body.geschaedigt_personal_id.is_some() as u8
        + org_gesetzt as u8
        + kontakt.is_some() as u8;
    if anzahl_quellen > 1 {
        return Err(AppError::UnprocessableEntity(
            "Höchstens eine Geschädigt-Quelle erlaubt".into(),
        ));
    }

    // Org-Isolation der FKs (404 bei fremder/unbekannter Person bzw. Einsatzkraft).
    if let Some(pid) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?;
    }
    if let Some(ep_id) = body.geschaedigt_personal_id {
        if !schaden_repo::personal_im_einsatz(&state.pool, einsatz_id, ep_id).await? {
            return Err(AppError::NotFound);
        }
    }
    let beschreibung = trimme(body.beschreibung.clone());

    // F06/LFH-244 Tier-A: Domänen-Write + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für ETB-Text
    // (Reg.-Nr.) UND Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (schaden, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let (id, _reg) = schaden_repo::anlegen_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            schaden_repo::NeueDaten {
                typ: typ.as_str(),
                ausmass: ausmass.as_str(),
                ort: &ort,
                beschreibung: beschreibung.as_deref(),
                lat: body.lat,
                lon: body.lon,
                geschaedigt_person_id: body.geschaedigt_person_id,
                geschaedigt_kontakt: kontakt.as_deref(),
                geschaedigt_personal_id: body.geschaedigt_personal_id,
                geschaedigt_organisation_id: geschaedigt_org_id,
            },
        )
        .await?;
        let schaden = schaden_repo::laden_tx(conn, einsatz_id, id).await?;
        let text = format!(
            "Schaden {} angelegt: {} ({}) — {}",
            registrier_anzeige(schaden.registrier_nr),
            typ.as_str(),
            ausmass.as_str(),
            ort_kurz(&ort),
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        Ok((schaden, etb_id))
    })?;
    sse_lebenszyklus(&state, einsatz_id, schaden.id, etb_id);
    Ok((StatusCode::CREATED, Json(schaden)))
}

// ---------- GET /schaeden/{sid} (Detail) ----------

pub async fn detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Schaeden>,
    PfadParam((_eid, schaden_id)): PfadParam<(i64, i64)>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- PATCH /schaeden/{sid} (Stammfelder) ----------

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_person_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_kontakt: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_personal_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_organisation_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uebergeben_an: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschluss_grund: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    /// Optimistisches Lock (LFH-300/F10): der beim Laden gelesene `geaendert_at`-Stand.
    /// Stimmt er nicht mehr → 409 statt stillem Overwrite. Fehlt er (Overwrite aus dem
    /// Konfliktdialog, Lagekarten-Drag, Geschädigt-Zuordnung aus der Personen-Detailseite),
    /// wird bewusst blind geschrieben.
    pub basis_geaendert_at: Option<String>,
}

pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_eid, schaden_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht geändert werden".into(),
        ));
    }

    // lat/lon als Paar: Effektivzustand nach dem Patch prüfen (422 statt 500).
    let eff_lat = body.lat.unwrap_or(vorher.lat);
    let eff_lon = body.lon.unwrap_or(vorher.lon);
    pruefe_koordinate(eff_lat, eff_lon, "lat", "lon")?;

    // Enum-Prechecks: Feld isoliert unbrauchbar → 400 (LFH-305). Diese drei sind zugleich
    // der einzige Schutz vor einem stillen Durchfall auf die DB — schaden/repo.rs bindet
    // typ/ausmass/abschluss_grund per COALESCE bzw. CASE als ROHEN String, und die CHECKs
    // aus migrations/0033 würden über das LFH-245-Sicherheitsnetz wieder als 422
    // herauskommen. Wer einen dieser Zweige entfernt, bekommt also kein 500, sondern
    // lautlos den alten Statuscode zurück.
    parse_enum_opt(SchadenTyp::parse, body.typ.as_deref(), "Ungültiger Typ")?;
    parse_enum_opt(Ausmass::parse, body.ausmass.as_deref(), "Ungültiges Ausmaß")?;
    if let Some(Some(g)) = &body.abschluss_grund {
        parse_enum(AbschlussGrund::parse, g.trim(), "Ungültiger Abschlussgrund")?;
    }
    // Vorhanden, aber leer: scheitert am Feld selbst → 400. Der Guard trennt „Feld fehlt"
    // (dann bleibt der Ort unverändert) sauber von „Feld ist da, aber leer".
    let ort_norm = pflicht_tri(body.ort.as_deref(), "Ort")?;

    // Normalisierte Bindungen (müssen den `aktualisiere`-Aufruf überleben → eigene `let`s).
    let beschreibung_norm = trimme(body.beschreibung.clone());
    let kontakt_norm: Option<Option<String>> = body
        .geschaedigt_kontakt
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let uebergeben_an_norm: Option<Option<String>> = body
        .uebergeben_an
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let abschluss_grund_norm: Option<Option<String>> = body
        .abschluss_grund
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    // Eigene Organisation: der vom Client gesendete id-Wert wird ignoriert. Die Tri-State
    // wird auf die ABGELEITETE Org-id gemappt: Some(Some(_)) → Some(Some(ctx.einsatz.org_id)),
    // Some(None) → Some(None) (löschen), None → None (unverändert).
    let org_delta: Option<Option<i64>> = body
        .geschaedigt_organisation_id
        .map(|opt| opt.map(|_| ctx.einsatz.org_id));

    // Effektivzustand NACH dem Patch für ALLE VIER Quellen (4‑Wege-CHECK) → 422 statt 500.
    let eff_person: Option<i64> = match body.geschaedigt_person_id {
        Some(opt) => opt,
        None => vorher.geschaedigt_person_id,
    };
    let eff_personal: Option<i64> = match body.geschaedigt_personal_id {
        Some(opt) => opt,
        None => vorher.geschaedigt_personal_id,
    };
    let eff_org: Option<i64> = match org_delta {
        Some(opt) => opt,
        None => vorher.geschaedigt_organisation_id,
    };
    let eff_kontakt: Option<String> = match &kontakt_norm {
        Some(opt) => opt.clone(),
        None => vorher.geschaedigt_kontakt.clone(),
    };
    let anzahl_quellen = eff_person.is_some() as u8
        + eff_personal.is_some() as u8
        + eff_org.is_some() as u8
        + eff_kontakt.is_some() as u8;
    if anzahl_quellen > 1 {
        return Err(AppError::UnprocessableEntity(
            "Höchstens eine Geschädigt-Quelle erlaubt".into(),
        ));
    }
    let eff_uebergeben_an: Option<String> = match &uebergeben_an_norm {
        Some(opt) => opt.clone(),
        None => vorher.uebergeben_an.clone(),
    };
    let eff_abschluss_grund: Option<String> = match &abschluss_grund_norm {
        Some(opt) => opt.clone(),
        None => vorher.abschluss_grund.map(|g| g.as_str().to_string()),
    };
    if vorher.status == SchadenStatus::Uebergeben && eff_uebergeben_an.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Übergebener Schaden braucht einen Übergabe-Adressaten".into(),
        ));
    }
    if vorher.status == SchadenStatus::Abgeschlossen && eff_abschluss_grund.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Abgeschlossener Schaden braucht einen Abschlussgrund".into(),
        ));
    }

    if let Some(Some(pid)) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?; // Org-Isolation → 404
    }
    if let Some(Some(ep_id)) = body.geschaedigt_personal_id {
        if !schaden_repo::personal_im_einsatz(&state.pool, einsatz_id, ep_id).await? {
            return Err(AppError::NotFound); // Org-Isolation der Einsatzkraft → 404
        }
    }

    let schaden = schaden_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        schaden_id,
        ctx.benutzer.id,
        body.basis_geaendert_at.as_deref(),
        schaden_repo::PatchDaten {
            typ: body.typ.as_deref(),
            ausmass: body.ausmass.as_deref(),
            ort: ort_norm.as_deref(),
            beschreibung: beschreibung_norm.as_deref(),
            geschaedigt_person_id: body.geschaedigt_person_id,
            geschaedigt_kontakt: kontakt_norm.as_ref().map(|o| o.as_deref()),
            geschaedigt_personal_id: body.geschaedigt_personal_id,
            geschaedigt_organisation_id: org_delta,
            uebergeben_an: uebergeben_an_norm.as_ref().map(|o| o.as_deref()),
            abschluss_grund: abschluss_grund_norm.as_ref().map(|o| o.as_deref()),
            lat: body.lat,
            lon: body.lon,
        },
    )
    .await?;

    sse_schaden(&state, einsatz_id, schaden_id); // KEIN ETB bei Stammfeld-PATCH
    Ok(Json(schaden))
}

// ---------- POST /schaeden/{sid}/uebergeben ----------

#[derive(Debug, Deserialize)]
pub struct UebergebenBody {
    pub uebergeben_an: Option<String>,
}

pub async fn uebergeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_eid, schaden_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<UebergebenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // LFH-305: DEDIZIERTER Aktions-Endpunkt — wer hierher POSTet, will übergeben, der
    // Adressat ist also unbedingt Pflicht. Damit scheitert das Feld ISOLIERT → 400, in zwei
    // Zweigen (fehlt / vorhanden aber leer).
    // Abgrenzung zu `src/routes/einsatz_tier.rs`: dort ist `/status` der GENERISCHE
    // Status-Endpunkt, an dem das Begleitfeld (Abschlussgrund) nur bei EINEM Zielstatus
    // Pflicht ist — das bewertet den Zusammenhang und bleibt dort 422. Die beiden Stellen
    // sehen ähnlich aus, sind es aber nicht: wer sie „harmonisiert", bricht einen gepinnten
    // Test. Siehe auch `abschliessen` weiter unten.
    let Some(adressat_roh) = body.uebergeben_an.clone() else {
        return Err(AppError::Validation("Übergabe-Adressat ist Pflicht".into()));
    };
    let adressat = pflicht(&adressat_roh, "Übergabe-Adressat")?;
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht übergeben werden".into(),
        ));
    }
    if !darf_uebergehen(vorher.status.as_str(), "uebergeben") {
        // Ungültiger Status-Übergang → 422, nicht 409 (Konvention in src/AGENTS.md; 409 ist für
        // Nebenläufigkeit/CAS und Storno reserviert — die vier Storno-Zweige hier bleiben 409).
        return Err(AppError::UnprocessableEntity(format!(
            "Schaden im Status '{}' kann nicht übergeben werden",
            vorher.status.as_str()
        )));
    }

    let text = format!(
        "Schaden {} übergeben an {}",
        registrier_anzeige(vorher.registrier_nr),
        adressat
    );
    // F06/LFH-244 Tier-A: Status-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus `vorher` + `adressat` VOR der Tx berechenbar (kein In-Tx-Reload nötig). SSE +
    // Response-Reload erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        schaden_repo::uebergebe_tx(conn, einsatz_id, schaden_id, &adressat, ctx.benutzer.id)
            .await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await
    })?;
    sse_lebenszyklus(&state, einsatz_id, schaden_id, etb_id);
    Ok(Json(
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- POST /schaeden/{sid}/abschliessen ----------

#[derive(Debug, Deserialize)]
pub struct AbschliessenBody {
    pub abschluss_grund: Option<String>,
    pub notiz: Option<String>,
}

pub async fn abschliessen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_eid, schaden_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbschliessenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // LFH-305: DEDIZIERTER Aktions-Endpunkt — wer hierher POSTet, will abschließen, der
    // Abschlussgrund ist also unbedingt Pflicht. Damit scheitert das Feld ISOLIERT → 400, in
    // drei Zweigen (fehlt / vorhanden aber leer / vorhanden aber unbekannt).
    // Abgrenzung zu `src/routes/einsatz_tier.rs`: dort ist `/status` der GENERISCHE
    // Status-Endpunkt, und der Grund ist nur bei Zielstatus "abgeschlossen" Pflicht — das
    // bewertet den Zusammenhang und bleibt dort 422. Die beiden Stellen sehen ähnlich aus,
    // sind es aber nicht: wer sie „harmonisiert", bricht einen gepinnten Test.
    //
    // Die Konvertierung nach `AbschlussGrund` bleibt bewusst VOR dem Repo-Aufruf
    // (`schliesse_ab_tx` nimmt `&str` aus dem Enum) — ein unbekannter Wert kann die DB damit
    // gar nicht erreichen.
    let Some(grund_roh) = body.abschluss_grund.clone() else {
        return Err(AppError::Validation("Abschlussgrund ist Pflicht".into()));
    };
    let grund_norm = pflicht(&grund_roh, "Abschlussgrund")?;
    let Some(grund) = AbschlussGrund::parse(&grund_norm) else {
        return Err(AppError::Validation("Unbekannter Abschlussgrund".into()));
    };
    let notiz = trimme(body.notiz.clone());
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht abgeschlossen werden".into(),
        ));
    }
    if !darf_uebergehen(vorher.status.as_str(), "abgeschlossen") {
        // Ungültiger Status-Übergang → 422, siehe oben.
        return Err(AppError::UnprocessableEntity(format!(
            "Schaden im Status '{}' kann nicht abgeschlossen werden",
            vorher.status.as_str()
        )));
    }

    let text = format!(
        "Schaden {} abgeschlossen ({})",
        registrier_anzeige(vorher.registrier_nr),
        grund.as_str()
    );
    // F06/LFH-244 Tier-A: Abschluss-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus `vorher` + `grund` VOR der Tx berechenbar. SSE + Response-Reload erst nach Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        schaden_repo::schliesse_ab_tx(
            conn,
            einsatz_id,
            schaden_id,
            grund.as_str(),
            notiz.as_deref(),
            ctx.benutzer.id,
        )
        .await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await
    })?;
    sse_lebenszyklus(&state, einsatz_id, schaden_id, etb_id);
    Ok(Json(
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- DELETE /schaeden/{sid} (Stornieren) ----------

pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Schaeden>,
    PfadParam((_eid, schaden_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
                                                                                  // F06/LFH-244 Tier-A: Storno-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
                                                                                  // ist aus `vorher` VOR der Tx berechenbar. SSE erst nach dem Commit.
    let text = format!(
        "Schaden {} storniert",
        registrier_anzeige(vorher.registrier_nr)
    );
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        schaden_repo::storniere_tx(conn, einsatz_id, schaden_id, ctx.benutzer.id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await
    })?;
    sse_lebenszyklus(&state, einsatz_id, schaden_id, etb_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------- GET /schaeden/stream (SSE) ----------
