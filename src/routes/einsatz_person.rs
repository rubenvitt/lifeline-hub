use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_modul_zugriff_laden,
    fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "personen";
use crate::error::AppError;
use crate::person::abgleich_repo::AbgleichAnzeige;
use crate::person::audit_repo::ZugriffAnzeige;
use crate::person::sichtung_repo::SichtungAnzeige;
use crate::person::verbleib_repo::VerbleibAnzeige;
use crate::person::verlaufsnotiz_repo::NotizAnzeige;
use crate::person::{abgleich_repo, audit_repo, sichtung_repo, verbleib_repo, verlaufsnotiz_repo};
use crate::person::{
    darf_uebergehen, registrier_anzeige, repo, AbgleichStatus, Geschlecht, PersonAnzeige,
    PersonStatus, Sichtungskategorie, VerbleibArt, VerbleibStatus,
};
use crate::routes::support::{trimme, trimme_tri};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde::Serialize;
use utoipa::ToSchema;

/// Detail-Antwort: E‑1-Personenfelder (flatten) + E‑2-Verlauf-Arrays. Genau eine
/// Antwort, genau ein `detail`-Audit (Spec-Annahme „Lesen / Lese-Audit").
#[derive(Debug, Serialize, ToSchema)]
pub struct PersonDetail {
    #[serde(flatten)]
    pub person: PersonAnzeige,
    pub sichtungen: Vec<SichtungAnzeige>,
    pub notizen: Vec<NotizAnzeige>,
    pub verbleib: Vec<VerbleibAnzeige>,
    pub abgleiche: Vec<AbgleichAnzeige>,
}

/// Broadcastet ein dediziertes `person`-SSE-Event OHNE sensible Payload
/// (nur einsatz_id + person_id); Clients refetchen die Liste.
fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": person_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Person, data);
}

/// Emittiert die SSE-Events eines UHS-Auto-Austritts (LFH-124): der pool-basierte
/// `uhs::auto_austritt` erledigt die DB-Writes, der Transport (ETB-Live-Eintrag +
/// uhs/person-Board) bleibt hier im Route-Handler. Nur bei tatsächlichem Austritt
/// (`Some(effekt)`) aufrufen.
fn sse_auto_austritt(state: &AppState, einsatz_id: i64, effekt: &crate::uhs::AutoAustrittEffekt) {
    state.live.publiziere(einsatz_id, effekt.etb_eintrag.id);
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Uhs,
        serde_json::json!({ "einsatz_id": einsatz_id, "uhs_id": effekt.uhs_id }).to_string(),
    );
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Person,
        serde_json::json!({ "einsatz_id": einsatz_id, "person_id": effekt.person_id }).to_string(),
    );
}

/// Validiert ein optionales Geschlecht; `Validation`, falls gesetzt und unbekannt.
///
/// Prüft einen zu SETZENDEN Geschlechtswert. `None` heißt „kein Wert wird gesetzt" und ist
/// immer zulässig — beim PATCH deckt das sowohl das absente Feld als auch den Leerwunsch
/// (`null`/`""`) ab. Der Aufrufer flacht das Tri-State entsprechend ab.
fn pruefe_geschlecht(g: Option<&str>) -> Result<(), AppError> {
    if let Some(g) = g {
        if Geschlecht::parse(g).is_none() {
            return Err(AppError::Validation("Unbekanntes Geschlecht".into()));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/personen — Liste (optional `?status=`). NICHT auditiert.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;

    if let Some(s) = &params.status {
        if PersonStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Status im Filter".into()));
        }
    }
    Ok(Json(
        repo::liste(&state.pool, einsatz_id, params.status.as_deref()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen — Person anlegen (Status `erfasst`).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonymen ETB-Eintrag + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<PersonAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(body.geschlecht.as_deref())?;

    let name = trimme(body.name);
    let vorname = trimme(body.vorname);
    let geburtsdatum = trimme(body.geburtsdatum);
    let herkunft = trimme(body.herkunft_adresse);
    let antreff = trimme(body.antreff_ort);
    let melder = trimme(body.melder_kontakt);
    let notiz = trimme(body.notiz);

    // F06/LFH-244 Tier-A: Domänen-Write (INSERT) + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für ETB-Text
    // (Reg.-Nr.) UND Response. SSE erst nach dem Commit.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let person = crate::write_retry!(&state.pool, |conn| {
        let (id, _reg) = repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer.id,
            repo::NeueDaten {
                name: name.as_deref(),
                vorname: vorname.as_deref(),
                geschlecht: body.geschlecht.as_deref(),
                geburtsdatum: geburtsdatum.as_deref(),
                alter_geschaetzt: body.alter_geschaetzt,
                herkunft_adresse: herkunft.as_deref(),
                antreff_ort: antreff.as_deref(),
                melder_kontakt: melder.as_deref(),
                notiz: notiz.as_deref(),
            },
        )
        .await?;
        let person = repo::laden_tx(conn, einsatz_id, id).await?;
        let text = format!(
            "Person {} erfasst",
            registrier_anzeige(person.registrier_nr)
        );
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(person)
    })?;
    sse_person(&state, einsatz_id, person.id);
    Ok((StatusCode::CREATED, Json(person)))
}

/// GET /api/einsaetze/{id}/personen/{pid} — Detail inkl. medizinischem Verlauf.
/// **Schreibt EINEN `detail`-Audit-Eintrag VOR der Verlauf-Anreicherung**
/// (auch wenn der Client abbricht). Die Verlauf-Listen sind eigene Reads ohne
/// zusätzliches Audit — der eine Audit-Eintrag steht für die gesamte Öffnung.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<PersonDetail>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(
        &state.pool,
        einsatz_id,
        Some(person_id),
        benutzer.id,
        "detail",
    )
    .await?;

    let sichtungen = sichtung_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let notizen = verlaufsnotiz_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let verbleib = verbleib_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let abgleiche = abgleich_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;

    Ok(Json(PersonDetail {
        person,
        sichtungen,
        notizen,
        verbleib,
        abgleiche,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    // Tri-State (LFH-266/F12): Feld absent = unverändert, `null` = leeren, Wert = setzen.
    // Alle neun Spalten sind nullable, das Leeren ist fachlich vorgesehen (DSGVO-Berichtigung).
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub name: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub vorname: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geschlecht: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geburtsdatum: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub alter_geschaetzt: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub herkunft_adresse: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub antreff_ort: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub melder_kontakt: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub notiz: Option<Option<String>>,
    /// Optimistisches Lock (LFH-241/F10): der beim Laden gelesene `geaendert_at`-Stand.
    /// Stimmt er nicht mehr → 409 statt stillem Overwrite. Fehlt er (Overwrite aus dem
    /// Konfliktdialog), wird bewusst blind geschrieben.
    pub basis_geaendert_at: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personen/{pid} — Identitäts-/Kontextfelder bearbeiten.
/// Schreibberechtigt + aktiver Einsatz. Kein ETB-Eintrag (E‑1-Felder sind keine
/// besondere Kategorie; aktueller Datensatz genügt).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;
    // Bleibt bewusst VOR der Normalisierung und vor allen weiteren Prüfungen — die
    // Fehler-Präzedenz gegenüber Storno/Zustandsfehlern hängt an dieser Position.
    // Normalisiert wird deshalb nur für diese eine Prüfung inline; ein leerer Wert ist
    // ein Leerwunsch, kein „unbekanntes Geschlecht" (das lieferte vorher 400).
    pruefe_geschlecht(
        body.geschlecht
            .as_ref()
            .and_then(|opt| opt.as_deref().map(str::trim).filter(|s| !s.is_empty())),
    )?;

    let name = trimme_tri(body.name);
    let vorname = trimme_tri(body.vorname);
    let geschlecht = trimme_tri(body.geschlecht);
    let geburtsdatum = trimme_tri(body.geburtsdatum);
    let herkunft = trimme_tri(body.herkunft_adresse);
    let antreff = trimme_tri(body.antreff_ort);
    let melder = trimme_tri(body.melder_kontakt);
    let notiz = trimme_tri(body.notiz);

    let person = repo::aktualisiere(
        &state.pool,
        einsatz_id,
        person_id,
        benutzer.id,
        body.basis_geaendert_at.as_deref(),
        repo::PatchDaten {
            name: name.as_ref().map(|o| o.as_deref()),
            vorname: vorname.as_ref().map(|o| o.as_deref()),
            geschlecht: geschlecht.as_ref().map(|o| o.as_deref()),
            geburtsdatum: geburtsdatum.as_ref().map(|o| o.as_deref()),
            alter_geschaetzt: body.alter_geschaetzt,
            herkunft_adresse: herkunft.as_ref().map(|o| o.as_deref()),
            antreff_ort: antreff.as_ref().map(|o| o.as_deref()),
            melder_kontakt: melder.as_ref().map(|o| o.as_deref()),
            notiz: notiz.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_person(&state, einsatz_id, person.id);
    Ok(Json(person))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/status — validierter Status-Wechsel.
/// Unbekannter Zielstatus → 400; nicht erlaubter Übergang → 422. Schreibt
/// pseudonyme ETB-Spur + SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    if PersonStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann nicht geändert werden".into(),
        ));
    }
    if !darf_uebergehen(vorher.status.as_str(), &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status.as_str(),
            body.status
        )));
    }
    repo::setze_status(
        &state.pool,
        einsatz_id,
        person_id,
        &body.status,
        benutzer.id,
    )
    .await?;

    // E‑3: bei verstorben/abgemeldet → UHS-Auto-Austritt (sequenziell, eigene ETB-Spur).
    if matches!(body.status.as_str(), "verstorben" | "abgemeldet") {
        let anlass = format!("durch Status-Wechsel zu {}", body.status);
        if let Some(effekt) =
            crate::uhs::auto_austritt(&state.pool, einsatz_id, person_id, &anlass, benutzer.id)
                .await?
        {
            sse_auto_austritt(&state, einsatz_id, &effekt);
        }
    }

    super::etb_system_degradiert(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: {} → {}",
            registrier_anzeige(vorher.registrier_nr),
            vorher.status.as_str(),
            body.status
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(repo::laden(&state.pool, einsatz_id, person_id).await?))
}

/// DELETE /api/einsaetze/{id}/personen/{pid} — Stornieren (Soft-Delete).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict("Person ist bereits storniert".into()));
    }
    repo::storniere(&state.pool, einsatz_id, person_id, benutzer.id).await?;
    // E‑3: Storno → UHS-Auto-Austritt + Reservierungs-Cleanup (Repo schreibt nur ETB, wenn Austritt nötig).
    if let Some(effekt) = crate::uhs::auto_austritt(
        &state.pool,
        einsatz_id,
        person_id,
        "durch Storno der Person",
        benutzer.id,
    )
    .await?
    {
        sse_auto_austritt(&state, einsatz_id, &effekt);
    }
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {} storniert",
            registrier_anzeige(person.registrier_nr)
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SichtungBody {
    pub kategorie: String,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/sichtung — Sichtung erfassen.
/// Schreibberechtigt + aktiv. Hebt `erfasst→betroffen` (Annahme 5); bei
/// `vermisst`/`abgemeldet` → 422; bei storniert → 409. Sichtung=`tot` ändert
/// den Admin-Status NICHT (Annahme 4). Pseudonyme ETB-Spur + SSE.
pub async fn sichten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<SichtungBody>,
) -> Result<(StatusCode, Json<SichtungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let kategorie = Sichtungskategorie::parse(&body.kategorie)
        .ok_or_else(|| AppError::Validation("Unbekannte Sichtungskategorie".into()))?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann nicht gesichtet werden".into(),
        ));
    }
    // Anwesenheit: betroffen|verstorben ok; erfasst → anheben; sonst 422.
    let hebe_auf_betroffen = match person.status.as_str() {
        "betroffen" | "verstorben" => false,
        "erfasst" => true,
        _ => {
            return Err(AppError::UnprocessableEntity(format!(
                "Person ist nicht anwesend (Status {})",
                person.status.as_str()
            )))
        }
    };
    let notiz = trimme(body.notiz);

    // F06/LFH-244 Tier-A: Sichtungs-Erfassung (optionaler Status-Hub + INSERT + Cache-Update)
    // + System-ETB-Eintrag atomar in EINER Tx (BEGIN IMMEDIATE + Retry). Der ETB-Text ist aus
    // dem VOR der Tx geladenen `person`-Vorzustand + `kategorie` berechenbar. SSE nach dem Commit.
    let text = format!(
        "Person {}: Sichtung {}",
        registrier_anzeige(person.registrier_nr),
        kategorie.etb_label()
    );
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let sichtung = crate::write_retry!(&state.pool, |conn| {
        let sichtung = sichtung_repo::erfassen_tx(
            conn,
            einsatz_id,
            person_id,
            kategorie.as_str(),
            notiz.as_deref(),
            benutzer.id,
            hebe_auf_betroffen,
        )
        .await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(sichtung)
    })?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(sichtung)))
}

/// GET /api/einsaetze/{id}/personen/{pid}/audit — Lese-Audit der Person.
/// Nur Einsatzleitung. Selbst NICHT auditiert (kein detail-Eintrag).
pub async fn audit(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<ZugriffAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_einsatzleitung(rolle)?;
    // Existenz der Person sicherstellen (404 statt leerer Liste bei Tippfehler).
    repo::laden(&state.pool, einsatz_id, person_id).await?;
    Ok(Json(
        audit_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?,
    ))
}

/// Einfaches CSV-Feld-Quoting (RFC 4180): in Anführungszeichen, innere `"` verdoppelt.
/// Entschärft zusätzlich Formel-Injektion (Excel/LibreOffice): Felder, die mit
/// =,+,-,@,Tab oder CR beginnen, werden mit einem führenden Apostroph neutralisiert.
fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/einsaetze/{id}/personen/export — CSV aller (nicht-stornierten)
/// Personen. **Schreibt einen `export`-Audit-Eintrag** (person_id = NULL).
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Response, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;

    let personen = repo::liste(&state.pool, einsatz_id, None).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, None, benutzer.id, "export").await?;

    let mut csv =
        String::from("registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort\n");
    for p in &personen {
        let alter = p
            .alter_geschaetzt
            .map(|a| a.to_string())
            .unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{};{}\n",
            registrier_anzeige(p.registrier_nr),
            csv_feld(p.status.as_str()),
            csv_feld(p.aktuelle_sichtung.map(|s| s.as_str()).unwrap_or("")),
            csv_feld(p.name.as_deref().unwrap_or("")),
            csv_feld(p.vorname.as_deref().unwrap_or("")),
            csv_feld(p.geschlecht.map(|g| g.as_str()).unwrap_or("")),
            alter,
            csv_feld(p.antreff_ort.as_deref().unwrap_or("")),
        ));
    }
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    )
        .into_response())
}

#[derive(Debug, Deserialize)]
pub struct VerbleibBody {
    pub art: String,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/verbleib — Verbleib-Ereignis erfassen.
/// Schreibberechtigt + aktiv. Cache-Kurzform via `VerbleibArt::kurzform`. Pseudonyme ETB-Spur + SSE.
pub async fn verbleib(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<VerbleibBody>,
) -> Result<(StatusCode, Json<VerbleibAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let art = VerbleibArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Verbleib-Art".into()))?;
    if let Some(s) = &body.status {
        if VerbleibStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Verbleib-Status".into()));
        }
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keinen Verbleib erhalten".into(),
        ));
    }
    let transportmittel = trimme(body.transportmittel);
    let ziel = trimme(body.ziel);
    let notiz = trimme(body.notiz);
    let kurzform = art.kurzform(ziel.as_deref());

    let verbleib = verbleib_repo::erfassen(
        &state.pool,
        einsatz_id,
        person_id,
        verbleib_repo::VerbleibDaten {
            art: art.as_str(),
            transportmittel: transportmittel.as_deref(),
            ziel: ziel.as_deref(),
            status: body.status.as_deref(),
            notiz: notiz.as_deref(),
        },
        &kurzform,
        benutzer.id,
    )
    .await?;

    // E‑3: bei transport/entlassung → UHS-Auto-Austritt (eigene ETB-Spur).
    if matches!(art, VerbleibArt::Transport | VerbleibArt::Entlassung) {
        let anlass = format!("durch Verbleib {}", art.as_str());
        if let Some(effekt) =
            crate::uhs::auto_austritt(&state.pool, einsatz_id, person_id, &anlass, benutzer.id)
                .await?
        {
            sse_auto_austritt(&state, einsatz_id, &effekt);
        }
    }

    super::etb_system_degradiert(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: {}",
            registrier_anzeige(person.registrier_nr),
            art.etb_sachverhalt(ziel.as_deref())
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(verbleib)))
}

#[derive(Debug, Deserialize)]
pub struct NotizBody {
    pub text: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/notizen — append-only Befundnotiz.
/// Schreibberechtigt + aktiv. **KEIN ETB-Eintrag** (besondere Kategorie). SSE.
pub async fn notiz(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<NotizBody>,
) -> Result<(StatusCode, Json<NotizAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::Validation(
            "Notiztext darf nicht leer sein".into(),
        ));
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keine Notiz erhalten".into(),
        ));
    }
    let notiz =
        verlaufsnotiz_repo::anlegen(&state.pool, einsatz_id, person_id, text, benutzer.id).await?;
    // BEWUSST kein super::etb_system_degradiert(): besondere Kategorie gehört NICHT in den ETB.
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(notiz)))
}

#[derive(Debug, Deserialize)]
pub struct AbgleichBody {
    pub gefunden_person_id: i64,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich — Verdachts-Link anlegen.
/// `pid` = vermisste Person. Schreibberechtigt + aktiver Einsatz. KEIN ETB; SSE für beide Personen.
pub async fn abgleich_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbgleichBody>,
) -> Result<(StatusCode, Json<AbgleichAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    if body.gefunden_person_id == person_id {
        return Err(AppError::Validation(
            "Vermisste und gefundene Person müssen verschieden sein".into(),
        ));
    }
    let vermisst = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if vermisst.storniert_at.is_some() || vermisst.status != PersonStatus::Vermisst {
        return Err(AppError::UnprocessableEntity(
            "Abgleich nur ausgehend von einer vermissten Person".into(),
        ));
    }
    // `repo::laden` schützt org-isoliert: NotFound (404), falls in fremdem Einsatz.
    let gefunden = repo::laden(&state.pool, einsatz_id, body.gefunden_person_id).await?;
    if gefunden.storniert_at.is_some()
        || !matches!(gefunden.status.as_str(), "betroffen" | "verstorben")
    {
        return Err(AppError::UnprocessableEntity(
            "Gefundene Person muss Status betroffen/verstorben haben".into(),
        ));
    }

    let abgleich = abgleich_repo::anlegen_verdacht(
        &state.pool,
        einsatz_id,
        person_id,
        body.gefunden_person_id,
        benutzer.id,
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    sse_person(&state, einsatz_id, body.gefunden_person_id);
    Ok((StatusCode::CREATED, Json(abgleich)))
}

#[derive(Debug, Deserialize)]
pub struct EntscheidungBody {
    pub entscheidung: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung — bestätigen
/// oder verwerfen. **Nur Einsatzleitung** (Annahme 8). Routing-Invariante:
/// `abgleich.vermisst_person_id == pid`, sonst `404`. Nur aus `verdacht` heraus
/// (sonst `409`). Bei `bestaetigt`: Vermisstmeldung → `abgemeldet` + pseudonyme
/// ETB-Spur. SSE für beide beteiligten Personen.
pub async fn abgleich_entscheiden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, person_id, abgleich_id)): PfadParam<(i64, i64, i64)>,
    JsonBody(body): JsonBody<EntscheidungBody>,
) -> Result<Json<AbgleichAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    if !matches!(
        AbgleichStatus::parse(&body.entscheidung),
        Some(AbgleichStatus::Bestaetigt | AbgleichStatus::Verworfen)
    ) {
        return Err(AppError::Validation(
            "Entscheidung muss 'bestaetigt' oder 'verworfen' sein".into(),
        ));
    }
    let abgleich = abgleich_repo::laden(&state.pool, einsatz_id, abgleich_id).await?;
    if abgleich.vermisst_person_id != person_id {
        // pid-Invariante verletzt: nicht der Pfad zu DIESEM Abgleich.
        return Err(AppError::NotFound);
    }
    if abgleich.status != AbgleichStatus::Verdacht {
        return Err(AppError::Conflict(
            "Abgleich ist bereits entschieden".into(),
        ));
    }
    let entschieden = abgleich_repo::entscheide(
        &state.pool,
        einsatz_id,
        abgleich_id,
        &body.entscheidung,
        benutzer.id,
    )
    .await?;

    if body.entscheidung == "bestaetigt" {
        let vermisst = repo::laden(&state.pool, einsatz_id, abgleich.vermisst_person_id).await?;
        let gefunden = repo::laden(&state.pool, einsatz_id, abgleich.gefunden_person_id).await?;
        super::etb_system_degradiert(
            &state,
            einsatz_id,
            benutzer.id,
            &format!(
                "Vermisstmeldung {} aufgeklärt — identisch mit {}",
                registrier_anzeige(vermisst.registrier_nr),
                registrier_anzeige(gefunden.registrier_nr)
            ),
        )
        .await?;
    }
    sse_person(&state, einsatz_id, abgleich.vermisst_person_id);
    sse_person(&state, einsatz_id, abgleich.gefunden_person_id);
    Ok(Json(entschieden))
}
