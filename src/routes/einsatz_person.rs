use crate::app::AppState;
use crate::benachrichtigung::{
    self, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{
    EinsatzLeitungszugriff, EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff,
};
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::geraet::stelle;
use crate::geraet::Bindungsart;
use crate::live::LiveEvent;
use crate::person::abgleich_repo::AbgleichAnzeige;
use crate::person::audit_repo::ZugriffAnzeige;
use crate::person::massnahme_repo::{self, MassnahmeAnzeige};
use crate::person::sichtung_repo::SichtungAnzeige;
use crate::person::transport_repo::{self, TransportAnzeige};
use crate::person::verbleib_repo::VerbleibAnzeige;
use crate::person::verlaufsnotiz_repo::NotizAnzeige;
use crate::person::verletzung_repo::{self, VerletzungAnzeige};
use crate::person::{abgleich_repo, audit_repo, sichtung_repo, verbleib_repo, verlaufsnotiz_repo};
use crate::person::{
    darf_uebergehen, registrier_anzeige, repo, AbgleichStatus, Geschlecht, PersonAnzeige,
    PersonStatus, Sichtungskategorie, TransportDurch, VerbleibArt, VerbleibStatus, PAT_NUMMER_MAX,
    PERSON_ANGABE_MAX, PERSON_NAME_MAX, PERSON_NOTIZ_MAX, PERSON_ZUSTAND_MAX, VERLAUFSNOTIZ_MAX,
};
use crate::routes::support::{
    deserialize_optional_field, optional_max, optional_max_tri, parse_enum, parse_enum_opt,
    pflicht_max, pruefe_koordinate, trimme, trimme_tri,
};
use crate::uhs::{belegung_repo, AufenthaltAnzeige};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
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
    /// UHS, Platz und seit wann; `null` außerhalb jeder UHS (LLH-1129, Patientenkopf).
    pub aufenthalt: Option<AufenthaltAnzeige>,
    /// Transport-Verlauf (LLH-1325), der aktuelle Stand zuerst; ein Stand ohne Felder hebt auf.
    pub transporte: Vec<TransportAnzeige>,
    /// Maßnahmen (LLH-1324), die jüngste Durchführung zuerst, aufgehobene mit `aufgehoben_at`.
    pub massnahmen: Vec<MassnahmeAnzeige>,
    /// Verletzungen (LLH-1113) in Erfassungsfolge, aufgehobene mit `aufgehoben_at`.
    pub verletzungen: Vec<VerletzungAnzeige>,
}

/// Broadcastet ein dediziertes `person`-SSE-Event OHNE sensible Payload
/// (nur einsatz_id + person_id); Clients refetchen die Liste.
pub(crate) fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Person, "person_id", person_id);
}

/// Ob eine Sichtung die Person neu in SK I bringt (Spec `benachrichtigungen`, „Neue Person der
/// Sichtungskategorie I“): Erfassung oder Hochstufung auf SK I ja; war sie schon SK I, oder geht
/// es in eine andere Kategorie (auch herab), nein. `vorher` ist der Stand vor dieser Sichtung,
/// `None` ohne bisherige Sichtung.
fn wird_sk1(vorher: Option<Sichtungskategorie>, neu: Sichtungskategorie) -> bool {
    neu == Sichtungskategorie::Sk1 && vorher != Some(Sichtungskategorie::Sk1)
}

/// Meldet nach dem Commit den Hinweis `sichtung_eins` an die Leser des Moduls Personen, ohne den
/// Auslöser (`src/AGENTS.md`, Benachrichtigungen). Bezug ist die Person; der Text nennt nur ihre
/// Registriernummer, nie Name oder Befund.
async fn melde_sichtung_eins(state: &AppState, einsatz_id: i64, person_id: i64, von: i64) {
    benachrichtigung::melden(
        &state.pool,
        &state.live,
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::SichtungEins,
            Bezug::neu(BenachrichtigungBezugTyp::Person, person_id),
        )
        .von(von)
        .an(Adressat::ModulLeser("personen")),
    )
    .await;
}

/// Emittiert die SSE-Events eines UHS-Auto-Austritts (LFH-124): der pool-basierte
/// `uhs::auto_austritt` erledigt die DB-Writes, der Transport (ETB-Live-Eintrag +
/// uhs/person-Board) bleibt hier im Route-Handler. Nur bei tatsächlichem Austritt
/// (`Some(effekt)`) aufrufen.
fn sse_auto_austritt(state: &AppState, einsatz_id: i64, effekt: &crate::uhs::AutoAustrittEffekt) {
    state.live.publiziere(einsatz_id, effekt.etb_eintrag.id);
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Uhs, "uhs_id", effekt.uhs_id);
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Person, "person_id", effekt.person_id);
}

/// Toleranz für „vermisst seit" in der Zukunft (design.md D4): fängt eine vorgehende
/// Geräteuhr ab. Ohne sie verwürfe die Offline-Queue eine Erfassung mit 400.
const VERMISST_SEIT_TOLERANZ: chrono::Duration = chrono::Duration::minutes(5);

fn jetzt_utc() -> chrono::NaiveDateTime {
    chrono::Utc::now().naive_utc()
}

/// Prüft einen zu SETZENDEN „vermisst seit"-Wert isoliert (LFH-613, design.md D5): unparsebar
/// oder mehr als fünf Minuten in der Zukunft → 400. Liefert die kanonische Schreibweise.
///
/// Das Feld wird bewusst VOR dem Zusammenhang (Status ≠ vermisst → 422) geprüft: ein
/// unbrauchbarer Wert ist schon für sich unbrauchbar (LFH-267). Ein Body mit kaputtem
/// Zeitpunkt UND falschem Status ist deshalb 400, nicht 422.
fn pruefe_vermisst_seit(roh: &str, jetzt: chrono::NaiveDateTime) -> Result<String, AppError> {
    let zeitpunkt = crate::zeit::parse(roh.trim()).ok_or_else(|| {
        AppError::Validation("vermisst_seit muss das Format JJJJ-MM-TT hh:mm:ss (UTC) haben".into())
    })?;
    if zeitpunkt > jetzt + VERMISST_SEIT_TOLERANZ {
        return Err(AppError::Validation(
            "vermisst_seit darf nicht in der Zukunft liegen".into(),
        ));
    }
    Ok(crate::zeit::formatiere(zeitpunkt))
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/personen — Liste (optional `?status=`). NICHT auditiert.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    parse_enum_opt(
        PersonStatus::parse,
        params.status.as_deref(),
        "Unbekannter Status im Filter",
    )?;
    let mut liste = repo::liste(&state.pool, einsatz_id, params.status.as_deref()).await?;
    // Stellenbindung (LFH-892): ein Gerät sieht die Personen seiner Stelle, ein UHS-Gerät etwa,
    // wer je in seiner UHS belegt war.
    if let Some(sichtbar) = stelle::sichtbare_personen(&state.pool, ctx.geraet.as_ref()).await? {
        liste.retain(|p| sichtbar.contains(&p.id));
    }
    Ok(Json(liste))
}

/// GET /api/einsaetze/{id}/personen/auswahl — Personenauswahl ohne Freitexte (LFH-940). NICHT
/// auditiert, wie die Liste. Geräte erreichen die Route nicht (`geraet::ALLE_GERAETE`); bekäme
/// eines sie, gälte die Stellenbindung der Liste.
pub async fn auswahl(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
) -> Result<Json<Vec<crate::person::PersonAuswahl>>, AppError> {
    let mut liste = repo::auswahl(&state.pool, ctx.einsatz.id).await?;
    if let Some(sichtbar) = stelle::sichtbare_personen(&state.pool, ctx.geraet.as_ref()).await? {
        liste.retain(|p| sichtbar.contains(&p.id));
    }
    Ok(Json(liste))
}

/// GET /api/einsaetze/{id}/personen/transportmittel — Vorschläge zum Rettungsmittel der
/// Verbleib-Maske (LLH-1332, design.md D4). Am Modul Personen, damit auch das UHS-Gerät ohne
/// Lesezugriff auf das Modul Fahrzeuge die Fahrzeuge im Einsatz sieht; NICHT auditiert (kein
/// Personenbezug).
pub async fn transportmittel(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
) -> Result<Json<verbleib_repo::TransportmittelAuswahl>, AppError> {
    // Stellenbindung (LFH-892) wie die Liste: die Freitexte stammen aus Verbleiben von Personen.
    let sichtbar = stelle::sichtbare_personen(&state.pool, ctx.geraet.as_ref()).await?;
    Ok(Json(
        verbleib_repo::transportmittel_auswahl(
            &state.pool,
            ctx.einsatz.id,
            ctx.einsatz.org_id,
            sichtbar.as_ref(),
        )
        .await?,
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
    /// Optionaler initialer Arbeitsstatus. Für die Erfassungs-Fastpaths sind
    /// ausschließlich `erfasst`, `vermisst` und `betroffen` zulässig.
    pub status: Option<String>,
    /// Optionale Erst-Sichtung (LFH-340 · C5). Schreibt die Sichtung in DERSELBEN
    /// Transaktion wie die Anlage und hebt `erfasst → betroffen` — dieselbe Mechanik wie
    /// der dedizierte Sichtungs-Endpunkt (`sichten`), nur ohne zweiten Request.
    ///
    /// Der zweite Request wäre nicht bloß langsamer: die Personen-Erfassung hat eine
    /// Offline-Queue mit `client_id`-Idempotenz (siehe unten), ein nachgeschobener
    /// Sichtungs-Call hätte keine — ein Replay legte die Sichtung ein zweites Mal an.
    pub sichtung: Option<String>,
    /// Namentliche Bestätigung der Erst-Sichtung am Gerät (LFH-1046): Kennung in
    /// `einsatz_personal`. Nur mit `sichtung` und nur an einem gekoppelten Gerät (sonst 422).
    pub bestaetigt_personal_id: Option<i64>,
    /// Optionaler Eintritt in den UHS-Wartebereich in derselben Transaktion wie die
    /// Person-Anlage (LFH-458). Ein client_id-Replay erzeugt keine zweite Belegung.
    pub uhs_id: Option<i64>,
    /// LFH-613: Zustand in Kurzform (Freitext, getrimmt; leer = kein Zustand).
    pub zustand: Option<String>,
    /// LFH-613: Fundort-Koordinate (WGS84), nur als Paar (sonst 422).
    pub antreff_lat: Option<f64>,
    pub antreff_lon: Option<f64>,
    /// LFH-613: „vermisst seit" (`YYYY-MM-DD HH:MM:SS`, UTC). Nur mit `status: vermisst`
    /// (sonst 422); fehlt er dort, setzt der Server den Zeitpunkt der Anlage.
    pub vermisst_seit: Option<String>,
    /// Stabiler, client-generierter Idempotenzschlüssel für Offline-Queue und
    /// Timeout-Replay. Leer/fehlend behält das Verhalten älterer Clients.
    pub client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/personen — Person anlegen (initial erfasst/vermisst/betroffen).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonymen ETB-Eintrag + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    JsonBody(mut body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<PersonAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Aufnahme am UHS-Gerät (LFH-892, Spec `funktionsansichten`): immer in den Eingang der
    // eigenen UHS, im selben Schritt wie die Anlage. Eine andere UHS ist 403.
    if let Some(eigene) = stelle::stelle(ctx.geraet.as_ref()) {
        if body.uhs_id.is_some_and(|u| u != eigene) {
            return Err(AppError::Forbidden);
        }
        body.uhs_id = Some(eigene);
    } else if ctx.geraet.is_some() && body.uhs_id.is_some() {
        // Ein Gerät ohne UHS bucht in keine (LFH-1040).
        return Err(AppError::Forbidden);
    }
    if body.uhs_id.is_some() {
        ctx.fordere_modul_zugriff(&state.pool, "unfallhilfsstellen")
            .await?;
    }
    // Aufnahme an der Betreuungsstelle (LFH-1041, Spec `funktionsansichten`): im selben Schritt
    // der Verbleib „Notunterkunft“ an der eigenen Stelle. Eine Erst-Sichtung gibt es dort nicht.
    let betreuungsstelle = stelle::eigene(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle);
    if betreuungsstelle.is_some()
        && body
            .sichtung
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty())
    {
        return Err(AppError::Forbidden);
    }
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;

    // Bereits committete Offline-Aktion nach Auth-/Schreib-/Modul-/Lese-Gates (LFH-769), aber
    // vor dem Aktiv-Gate erkennen. Die Einsatz-ID ist Teil des Lookups (kein Cross-Einsatz-Replay).
    let client_id = trimme(body.client_id);
    if client_id.as_deref().is_some_and(|cid| cid.len() > 64) {
        return Err(AppError::Validation(
            "client_id zu lang (max. 64 Zeichen)".into(),
        ));
    }
    if let Some(cid) = client_id.as_deref() {
        if let Some(person) = repo::laden_nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((StatusCode::CREATED, Json(person)));
        }
    }
    ctx.fordere_aktiv()?;
    parse_enum_opt(
        Geschlecht::parse,
        body.geschlecht.as_deref(),
        "Unbekanntes Geschlecht",
    )?;
    // LLH-1329: die Freitexte für sich (400), vor jedem 422 des Zusammenhangs.
    let name = optional_max(body.name, "Name", PERSON_NAME_MAX)?;
    let vorname = optional_max(body.vorname, "Vorname", PERSON_NAME_MAX)?;
    let herkunft = optional_max(
        body.herkunft_adresse,
        "Herkunft / Adresse",
        PERSON_ANGABE_MAX,
    )?;
    let antreff = optional_max(body.antreff_ort, "Fundort", PERSON_ANGABE_MAX)?;
    let melder = optional_max(body.melder_kontakt, "Melder / Kontakt", PERSON_ANGABE_MAX)?;
    let zustand = optional_max(body.zustand, "Zustand / Verdacht", PERSON_ZUSTAND_MAX)?;
    let notiz = optional_max(body.notiz, "Notiz", PERSON_NOTIZ_MAX)?;
    // LLH-1103 (design.md D6): dieselbe Prüfung wie im PATCH, das Feld für sich (400).
    let geburtsdatum = match trimme(body.geburtsdatum) {
        Some(roh) => Some(pruefe_geburtsdatum(&roh, chrono::Utc::now().date_naive())?),
        None => None,
    };

    let status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        // Wer an einer Betreuungsstelle aufgenommen wird, ist betroffen (LFH-1041); eine Sichtung,
        // die sonst `erfasst → betroffen` hebt, gibt es dort nicht.
        .unwrap_or(if betreuungsstelle.is_some() {
            "betroffen"
        } else {
            "erfasst"
        })
        .to_owned();
    let Some(status_enum) = PersonStatus::parse(&status) else {
        return Err(AppError::Validation(
            "Unbekannter initialer Personenstatus".into(),
        ));
    };
    if !matches!(
        status_enum,
        PersonStatus::Erfasst | PersonStatus::Vermisst | PersonStatus::Betroffen
    ) {
        return Err(AppError::Validation(
            "Initial sind nur erfasst, vermisst oder betroffen zulässig".into(),
        ));
    }

    if body.uhs_id.is_some() && matches!(status_enum, PersonStatus::Vermisst) {
        return Err(AppError::UnprocessableEntity(
            "Eine vermisste Person kann keinen UHS-Wartebereich betreten".into(),
        ));
    }
    if let Some(stelle_id) = betreuungsstelle {
        if matches!(status_enum, PersonStatus::Vermisst) {
            return Err(AppError::UnprocessableEntity(
                "Eine vermisste Person kann nicht in die Betreuungsstelle aufgenommen werden"
                    .into(),
            ));
        }
        let stelle =
            crate::betreuung::repo::stelle_laden(&state.pool, einsatz_id, stelle_id).await?;
        if stelle.storniert_at.is_some() {
            return Err(AppError::Conflict(
                "Die Betreuungsstelle ist storniert".into(),
            ));
        }
    }

    // Erst-Sichtung: das Feld für sich → 400, die Kombination mit dem Status → 422
    // (LFH-267/F22). Eine vermisste Person ist nicht angetroffen und damit nicht sichtbar;
    // dieselbe Linie zieht der dedizierte Sichtungs-Endpunkt über `person.status`.
    let sichtung = trimme(body.sichtung);
    let kategorie = match sichtung.as_deref() {
        None => None,
        Some(roh) => Some(
            Sichtungskategorie::parse(roh)
                .ok_or_else(|| AppError::Validation("Unbekannte Sichtungskategorie".into()))?,
        ),
    };
    if kategorie.is_some()
        && !matches!(status_enum, PersonStatus::Erfasst | PersonStatus::Betroffen)
    {
        return Err(AppError::UnprocessableEntity(
            "Eine Erst-Sichtung ist nur mit Status erfasst oder betroffen zulässig".into(),
        ));
    }
    if kategorie.is_none() && body.bestaetigt_personal_id.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Eine Bestätigung gibt es nur zu einer Erst-Sichtung".into(),
        ));
    }
    // Die Erst-Sichtung trägt die Serverzeit, also gilt „aktiv jetzt“.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        None,
    )
    .await?;

    // LFH-613: erst das Feld isoliert (400), dann der Zusammenhang mit dem Status (422).
    let jetzt = jetzt_utc();
    let vermisst_seit_angabe = match trimme(body.vermisst_seit) {
        Some(roh) => Some(pruefe_vermisst_seit(&roh, jetzt)?),
        None => None,
    };
    if vermisst_seit_angabe.is_some() && status_enum != PersonStatus::Vermisst {
        return Err(AppError::UnprocessableEntity(
            "vermisst_seit ist nur mit Status vermisst zulässig".into(),
        ));
    }
    // Fehlt die Angabe bei einer Vermisstmeldung, gilt die Meldezeit. Sie steht im INSERT und
    // ist damit Teil der Replay-idempotenten Anlage: ein client_id-Replay kommt nicht bis
    // hierher (Lookup oben) bzw. schreibt in der Tx nichts neu (`war_neu`).
    let vermisst_seit = match status_enum {
        PersonStatus::Vermisst => {
            Some(vermisst_seit_angabe.unwrap_or_else(|| crate::zeit::formatiere(jetzt)))
        }
        _ => None,
    };
    pruefe_koordinate(
        body.antreff_lat,
        body.antreff_lon,
        "antreff_lat",
        "antreff_lon",
    )?;

    // F06/LFH-244 Tier-A: Domänen-Write (INSERT) + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für ETB-Text
    // (Reg.-Nr.) UND Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (person, war_neu, uhs_etb_id, verbleib_etb_id) =
        crate::write_retry!(&state.pool, |conn| {
            let (id, reg, war_neu) = repo::anlegen_tx_mit_optionen(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                status_enum.as_str(),
                client_id.as_deref(),
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
                    zustand: zustand.as_deref(),
                    antreff_lat: body.antreff_lat,
                    antreff_lon: body.antreff_lon,
                    vermisst_seit: vermisst_seit.as_deref(),
                },
            )
            .await?;
            let mut uhs_etb_id = None;
            let mut verbleib_etb_id = None;
            if war_neu {
                // Die Registriernummer kommt aus dem RÜCKGABEWERT, nicht aus einem Reload: das
                // Repo liefert sie in beiden Zweigen mit. Ein `laden_tx` an dieser Stelle wäre
                // ein zweiter Roundtrip für einen Wert, der schon dasteht.
                let text = crate::person::etb_text_erfasst(reg);
                crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                    .await?;

                /*
                 * Erst-Sichtung NUR bei einer wirklich neuen Person: bei einem Offline-Replay
                 * stünde sie sonst ein zweites Mal im Verlauf — in genau der Kette, aus der der
                 * medizinische Verlauf gelesen wird.
                 *
                 * DIESER RIEGEL IST PER HTTP NICHT ERREICHBAR, und das gehört dazu: der
                 * Replay-Lookup oben (`laden_nach_client_id`, vor der Transaktion) trägt
                 * dasselbe Prädikat wie der In-Tx-Zweig und gibt vorher zurück. `war_neu` wird
                 * hier also nur dann false, wenn ein fremder Commit zwischen Pool-Read und
                 * `BEGIN IMMEDIATE` fällt — ein sequentieller Test kann das nicht erzeugen.
                 * `replay_derselben_client_id_legt_die_sichtung_nicht_doppelt_an` belegt
                 * deshalb den WEG (ein Replay erzeugt keine zweite Person und keine zweite
                 * Sichtung), nicht diese Bedingung; sie bliebe auch ohne sie grün. Wer den
                 * Riegel entfernt, bricht keinen Test — er bricht das Rennen.
                 */
                if let Some(k) = kategorie {
                    sichtung_repo::erfassen_tx(
                        conn,
                        einsatz_id,
                        id,
                        &sichtung_repo::NeueSichtung {
                            kategorie: k.as_str(),
                            bestaetigung: bestaetigung.as_ref(),
                            ..Default::default()
                        },
                        ctx.benutzer.id,
                        // Anheben nur aus `erfasst` — eine bereits als betroffen angelegte
                        // Person bekäme sonst einen zweiten Statuswechsel ohne Anlass.
                        matches!(status_enum, PersonStatus::Erfasst),
                    )
                    .await?;
                    let text = crate::person::etb_text_bestaetigt(
                        crate::person::etb_text_sichtung(reg, k),
                        bestaetigung.as_ref(),
                    );
                    crate::etb::system_audit_tx(
                        conn,
                        einsatz_id,
                        ctx.benutzer.id,
                        startwert,
                        &text,
                    )
                    .await?;
                }
                if let Some(uhs_id) = body.uhs_id {
                    crate::uhs::belegung_repo::eintritt_tx(
                        conn,
                        einsatz_id,
                        id,
                        uhs_id,
                        None,
                        None,
                        ctx.benutzer.id,
                    )
                    .await?;
                    let uhs = crate::uhs::repo::laden_tx(conn, einsatz_id, uhs_id).await?;
                    let text = crate::person::etb_text_uhs_aufnahme(reg, &uhs.bezeichnung);
                    uhs_etb_id = Some(
                        crate::etb::system_audit_tx(
                            conn,
                            einsatz_id,
                            ctx.benutzer.id,
                            startwert,
                            &text,
                        )
                        .await?,
                    );
                }
                if let Some(stelle_id) = betreuungsstelle {
                    let art = VerbleibArt::Notunterkunft;
                    verbleib_repo::erfassen_tx(
                        conn,
                        einsatz_id,
                        id,
                        verbleib_repo::VerbleibDaten {
                            art: art.as_str(),
                            betreuungsstelle_id: Some(stelle_id),
                            // Eine Bestätigung gibt es nur zu einer Erst-Sichtung (oben).
                            ..Default::default()
                        },
                        ctx.benutzer.id,
                    )
                    .await?;
                    let text = format!(
                        "Person {}: {}",
                        registrier_anzeige(reg),
                        art.etb_sachverhalt()
                    );
                    verbleib_etb_id = Some(
                        crate::etb::system_audit_tx(
                            conn,
                            einsatz_id,
                            ctx.benutzer.id,
                            startwert,
                            &text,
                        )
                        .await?,
                    );
                }
            }
            // NACH Sichtung, UHS-Eintritt und Verbleib geladen: sonst trüge die Antwort den Vorzustand — Status
            // `erfasst`, `aktuelle_sichtung` leer —, und der Client zeigte die Quittung zu
            // einem Datensatz, den es so nie gab.
            let person = repo::laden_tx(conn, einsatz_id, id).await?;
            Ok((person, war_neu, uhs_etb_id, verbleib_etb_id))
        })?;
    if war_neu {
        sse_person(&state, einsatz_id, person.id);
        if let Some(uhs_id) = body.uhs_id {
            state
                .live
                .publiziere_objekt(einsatz_id, LiveEvent::Uhs, "uhs_id", uhs_id);
        }
        for etb_id in uhs_etb_id.into_iter().chain(verbleib_etb_id) {
            state.live.publiziere(einsatz_id, etb_id);
        }
        // Nur bei einer wirklich neuen Person: ein `client_id`-Replay meldet nicht noch einmal.
        if kategorie.is_some_and(|k| wird_sk1(None, k)) {
            melde_sichtung_eins(&state, einsatz_id, person.id, ctx.benutzer.id).await;
        }
    }
    Ok((StatusCode::CREATED, Json(person)))
}

/// GET /api/einsaetze/{id}/personen/{pid} — Detail inkl. medizinischem Verlauf.
/// **Schreibt EINEN `detail`-Audit-Eintrag VOR der Verlauf-Anreicherung**
/// (auch wenn der Client abbricht). Die Verlauf-Listen sind eigene Reads ohne
/// zusätzliches Audit — der eine Audit-Eintrag steht für die gesamte Öffnung.
pub async fn detail(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<PersonDetail>, AppError> {
    detail_mit_audit(&state, &ctx, person_id, "detail").await
}

/// GET /api/einsaetze/{id}/personen/{pid}/druck — die Druckansicht einer Person (LLH-1120, Spec
/// `druck-dokumente`, „Druckansicht einer Person“): dasselbe Detail, aber im Zugriffsprotokoll
/// als `druck` mit `person_id` (die CHECK-Liste aus 0141 erlaubt die Art). Muster wie
/// `…/personen/druck` neben der Liste: ein eigener Pfad statt eines Query-Parameters, damit
/// die Art des Zugriffs an der Route hängt und kein Aufrufer das Detail-Audit umgehen kann. Die
/// Route steht in keiner Routenliste der Geräte: am Gerät 403 (`tests/geraet_kopplung.rs`).
pub async fn detail_druck(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<PersonDetail>, AppError> {
    detail_mit_audit(&state, &ctx, person_id, "druck").await
}

/// Lädt das Detail einer Person und schreibt VOR der Anreicherung genau einen Audit-Eintrag der
/// Art `art` (`detail` oder `druck`). Eine unbekannte Person ist 404 ohne Eintrag.
async fn detail_mit_audit(
    state: &AppState,
    ctx: &EinsatzLesezugriff<Personen>,
    person_id: i64,
    art: &str,
) -> Result<Json<PersonDetail>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(
        &state.pool,
        einsatz_id,
        Some(person_id),
        ctx.benutzer.id,
        art,
    )
    .await?;

    let sichtungen = sichtung_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let notizen = verlaufsnotiz_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let verbleib = verbleib_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let aufenthalt = belegung_repo::aufenthalt(&state.pool, einsatz_id, person_id).await?;
    let transporte = transport_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let massnahmen = massnahme_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let verletzungen = verletzung_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    // Den Abgleich mit Vermisstenmeldungen führt kein Gerät (Scope-Matrix): er nennt andere
    // Personen des Einsatzes.
    let abgleiche = if ctx.geraet.is_some() {
        Vec::new()
    } else {
        abgleich_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?
    };

    Ok(Json(PersonDetail {
        person,
        sichtungen,
        notizen,
        verbleib,
        abgleiche,
        aufenthalt,
        transporte,
        massnahmen,
        verletzungen,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    // Tri-State (LFH-266/F12): Feld absent = unverändert, `null` = leeren, Wert = setzen.
    // Alle neun Spalten sind nullable, das Leeren ist fachlich vorgesehen (DSGVO-Berichtigung).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub vorname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschlecht: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geburtsdatum: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub alter_geschaetzt: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub herkunft_adresse: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_ort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub melder_kontakt: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    /// LFH-613: Zustand (Tri-State; `null`/`""` leert).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub zustand: Option<Option<String>>,
    /// LFH-613: Fundort-Koordinate (Tri-State je Wert, Paarregel gegen den Effektivzustand).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_lon: Option<Option<f64>>,
    /// LFH-613: „vermisst seit" korrigieren — nur bei Status vermisst (422), `null` ist 400:
    /// Leeren nähme der Dashboard-Zählung die Grundlage (design.md D4).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub vermisst_seit: Option<Option<String>>,
    /// LLH-1326: PAT-Nummer (Tri-State; `null`/`""` leert).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pat_nummer: Option<Option<String>>,
    /// LLH-1326: Kontamination (Tri-State; `null` heißt „keine Angabe“, nicht „nein“).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kontamination: Option<Option<bool>>,
    /// Optimistisches Lock (LFH-241/F10): der beim Laden gelesene `geaendert_at`-Stand.
    /// Stimmt er nicht mehr → 409 statt stillem Overwrite. Fehlt er (Overwrite aus dem
    /// Konfliktdialog), wird bewusst blind geschrieben.
    pub basis_geaendert_at: Option<String>,
    /// Feld-CAS (LLH-1103, design.md D1 der Change `f8218h1i-personendaten-feldweise`): je Feld
    /// der Wert beim Öffnen. Der Server schreibt nur, solange jede genannte Spalte noch diesen
    /// Wert hat, sonst 409. Fehlt es, wird ohne Feldvergleich geschrieben (Überschreiben).
    #[serde(default)]
    pub erwartet: Option<ErwartetBody>,
}

/// Altwerte des Feld-CAS: dieselben Feldnamen wie die Änderung, dreiwertig (fehlt = kein
/// Vergleich, `null` oder `""` = leer erwartet; leer trifft auch eine gespeicherte leere oder nur
/// aus Leerraum bestehende Zeichenkette). Ein Feld hier, das der PATCH nicht ändert, ist 422; die
/// Koordinate steht nur als Paar (`antreff_lat` und `antreff_lon`), sonst 422. Ein unbekannter
/// Feldname ist 400 statt eines stillen Schreibens ohne Vergleich.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErwartetBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub vorname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschlecht: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geburtsdatum: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub alter_geschaetzt: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub herkunft_adresse: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_ort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub melder_kontakt: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub zustand: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub antreff_lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub vermisst_seit: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pat_nummer: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kontamination: Option<Option<bool>>,
}

/// Ein Text-Altwert: `""` (auch nur Leerraum) heißt leer wie `null`. Sonst bleibt der Wert, wie
/// der Client ihn gelesen hat — kein Trimmen, damit ein alter ungetrimmter Bestand vergleichbar
/// bleibt.
fn leer_als_null(wert: Option<Option<String>>) -> Option<Option<String>> {
    wert.map(|w| w.filter(|t| !t.trim().is_empty()))
}

/// Prüft `erwartet` gegen die Änderung: die Koordinate nur als Paar, und jedes Feld mit Altwert
/// muss im selben PATCH geändert werden. Beides ist eine Feldkombination, also 422
/// (`src/AGENTS.md`, Statuscode-Konvention; design.md D1).
fn pruefe_erwartet(erwartet: &ErwartetBody, body: &PatchBody) -> Result<(), AppError> {
    if erwartet.antreff_lat.is_some() != erwartet.antreff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "erwartet trägt die Koordinate nur als Paar (antreff_lat und antreff_lon)".into(),
        ));
    }
    let felder = [
        ("name", erwartet.name.is_some(), body.name.is_some()),
        (
            "vorname",
            erwartet.vorname.is_some(),
            body.vorname.is_some(),
        ),
        (
            "geschlecht",
            erwartet.geschlecht.is_some(),
            body.geschlecht.is_some(),
        ),
        (
            "geburtsdatum",
            erwartet.geburtsdatum.is_some(),
            body.geburtsdatum.is_some(),
        ),
        (
            "alter_geschaetzt",
            erwartet.alter_geschaetzt.is_some(),
            body.alter_geschaetzt.is_some(),
        ),
        (
            "herkunft_adresse",
            erwartet.herkunft_adresse.is_some(),
            body.herkunft_adresse.is_some(),
        ),
        (
            "antreff_ort",
            erwartet.antreff_ort.is_some(),
            body.antreff_ort.is_some(),
        ),
        (
            "melder_kontakt",
            erwartet.melder_kontakt.is_some(),
            body.melder_kontakt.is_some(),
        ),
        ("notiz", erwartet.notiz.is_some(), body.notiz.is_some()),
        (
            "zustand",
            erwartet.zustand.is_some(),
            body.zustand.is_some(),
        ),
        (
            "antreff_lat",
            erwartet.antreff_lat.is_some(),
            body.antreff_lat.is_some(),
        ),
        (
            "antreff_lon",
            erwartet.antreff_lon.is_some(),
            body.antreff_lon.is_some(),
        ),
        (
            "vermisst_seit",
            erwartet.vermisst_seit.is_some(),
            body.vermisst_seit.is_some(),
        ),
        (
            "pat_nummer",
            erwartet.pat_nummer.is_some(),
            body.pat_nummer.is_some(),
        ),
        (
            "kontamination",
            erwartet.kontamination.is_some(),
            body.kontamination.is_some(),
        ),
    ];
    if let Some((feld, _, _)) = felder.iter().find(|(_, alt, neu)| *alt && !*neu) {
        return Err(AppError::UnprocessableEntity(format!(
            "erwartet nennt {feld}, der PATCH ändert {feld} aber nicht"
        )));
    }
    Ok(())
}

/// Spielraum für ein Geburtsdatum am Tagesrand (design.md D6): die Oberfläche prüft „nicht nach
/// heute“ im Tag der Anzeigezone, der UTC um bis zu einen Tag voraus sein kann.
const GEBURTSDATUM_SPIELRAUM: chrono::Duration = chrono::Duration::days(1);

/// Prüft ein zu SETZENDES Geburtsdatum (LLH-1103, design.md D6), beim Anlegen und im PATCH: genau
/// `YYYY-MM-DD`, ein gültiger Kalendertag und nicht nach `heute` (UTC) plus Spielraum, sonst 400.
/// Ein schon gespeicherter Wert in anderer Form wird nicht geprüft, nur ein geschriebener.
fn pruefe_geburtsdatum(roh: &str, heute: chrono::NaiveDate) -> Result<String, AppError> {
    let zeichen = roh.as_bytes();
    let form = zeichen.len() == 10
        && zeichen.iter().enumerate().all(|(i, z)| match i {
            4 | 7 => *z == b'-',
            _ => z.is_ascii_digit(),
        });
    if !form {
        return Err(AppError::Validation(
            "Geburtsdatum muss die Form JJJJ-MM-TT haben".into(),
        ));
    }
    let tag = chrono::NaiveDate::parse_from_str(roh, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("Geburtsdatum ist kein gültiger Kalendertag".into()))?;
    if tag > heute + GEBURTSDATUM_SPIELRAUM {
        return Err(AppError::Validation(
            "Geburtsdatum darf nicht in der Zukunft liegen".into(),
        ));
    }
    Ok(roh.to_owned())
}

/// PATCH /api/einsaetze/{id}/personen/{pid} — Identitäts-/Kontextfelder bearbeiten.
/// Schreibberechtigt + aktiver Einsatz. Kein ETB-Eintrag (E‑1-Felder sind keine
/// besondere Kategorie; aktueller Datensatz genügt).
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    // Bleibt bewusst VOR der Normalisierung und vor allen weiteren Prüfungen — die
    // Fehler-Präzedenz gegenüber Storno/Zustandsfehlern hängt an dieser Position.
    // Normalisiert wird deshalb nur für diese eine Prüfung inline; ein leerer Wert ist
    // ein Leerwunsch, kein „unbekanntes Geschlecht" (das lieferte vorher 400).
    parse_enum_opt(
        Geschlecht::parse,
        body.geschlecht
            .as_ref()
            .and_then(|opt| opt.as_deref().map(str::trim).filter(|s| !s.is_empty())),
        "Unbekanntes Geschlecht",
    )?;
    if let Some(erwartet) = &body.erwartet {
        pruefe_erwartet(erwartet, &body)?;
    }

    // LLH-1329: nur die genannten Felder; ein Altbestand über der Grenze in einem anderen Feld
    // hält die Änderung nicht auf.
    let name = optional_max_tri(body.name, "Name", PERSON_NAME_MAX)?;
    let vorname = optional_max_tri(body.vorname, "Vorname", PERSON_NAME_MAX)?;
    let geschlecht = trimme_tri(body.geschlecht);
    let geburtsdatum = match trimme_tri(body.geburtsdatum) {
        Some(Some(roh)) => Some(Some(pruefe_geburtsdatum(
            &roh,
            chrono::Utc::now().date_naive(),
        )?)),
        andere => andere,
    };
    let herkunft = optional_max_tri(
        body.herkunft_adresse,
        "Herkunft / Adresse",
        PERSON_ANGABE_MAX,
    )?;
    let antreff = optional_max_tri(body.antreff_ort, "Fundort", PERSON_ANGABE_MAX)?;
    let melder = optional_max_tri(body.melder_kontakt, "Melder / Kontakt", PERSON_ANGABE_MAX)?;
    let notiz = optional_max_tri(body.notiz, "Notiz", PERSON_NOTIZ_MAX)?;
    let zustand = optional_max_tri(body.zustand, "Zustand / Verdacht", PERSON_ZUSTAND_MAX)?;
    let pat_nummer = optional_max_tri(body.pat_nummer, "PAT-Nummer", PAT_NUMMER_MAX)?;

    // LFH-613 „vermisst seit": zuerst das Feld isoliert (400 — leeren, unparsebar, Zukunft),
    // danach der Zusammenhang mit dem Status (422, unten gegen den geladenen Bestand).
    let vermisst_seit = match trimme_tri(body.vermisst_seit) {
        None => None,
        Some(None) => {
            return Err(AppError::Validation(
                "vermisst_seit kann nicht geleert werden".into(),
            ))
        }
        Some(Some(roh)) => Some(pruefe_vermisst_seit(&roh, jetzt_utc())?),
    };

    // Paarregel und „nur bei vermisst" brauchen den Bestand. Wie in `einsatz_uhs.rs` gilt: der
    // Effektivzustand wird vor dem UPDATE gelesen; ein konkurrierender Schreiber dazwischen
    // fängt das optimistische Lock (`basis_geaendert_at` bzw. der Feld-CAS über `erwartet`),
    // wo der Client es mitschickt.
    if body.antreff_lat.is_some() || body.antreff_lon.is_some() || vermisst_seit.is_some() {
        let vorher = repo::laden(&state.pool, einsatz_id, person_id).await?;
        let eff_lat = body.antreff_lat.unwrap_or(vorher.antreff_lat);
        let eff_lon = body.antreff_lon.unwrap_or(vorher.antreff_lon);
        pruefe_koordinate(eff_lat, eff_lon, "antreff_lat", "antreff_lon")?;
        if vermisst_seit.is_some() && vorher.status != PersonStatus::Vermisst {
            return Err(AppError::UnprocessableEntity(
                "vermisst_seit ist nur bei einer vermissten Person änderbar".into(),
            ));
        }
    }

    let erwartet = body.erwartet.unwrap_or_default();
    let alt_name = leer_als_null(erwartet.name);
    let alt_vorname = leer_als_null(erwartet.vorname);
    let alt_geschlecht = leer_als_null(erwartet.geschlecht);
    let alt_geburtsdatum = leer_als_null(erwartet.geburtsdatum);
    let alt_herkunft = leer_als_null(erwartet.herkunft_adresse);
    let alt_antreff = leer_als_null(erwartet.antreff_ort);
    let alt_melder = leer_als_null(erwartet.melder_kontakt);
    let alt_notiz = leer_als_null(erwartet.notiz);
    let alt_zustand = leer_als_null(erwartet.zustand);
    let alt_vermisst_seit = leer_als_null(erwartet.vermisst_seit);
    let alt_pat_nummer = leer_als_null(erwartet.pat_nummer);

    let person = repo::aktualisiere(
        &state.pool,
        einsatz_id,
        person_id,
        ctx.benutzer.id,
        body.basis_geaendert_at.as_deref(),
        &repo::PatchDaten {
            name: alt_name.as_ref().map(|o| o.as_deref()),
            vorname: alt_vorname.as_ref().map(|o| o.as_deref()),
            geschlecht: alt_geschlecht.as_ref().map(|o| o.as_deref()),
            geburtsdatum: alt_geburtsdatum.as_ref().map(|o| o.as_deref()),
            alter_geschaetzt: erwartet.alter_geschaetzt,
            herkunft_adresse: alt_herkunft.as_ref().map(|o| o.as_deref()),
            antreff_ort: alt_antreff.as_ref().map(|o| o.as_deref()),
            melder_kontakt: alt_melder.as_ref().map(|o| o.as_deref()),
            notiz: alt_notiz.as_ref().map(|o| o.as_deref()),
            zustand: alt_zustand.as_ref().map(|o| o.as_deref()),
            antreff_lat: erwartet.antreff_lat,
            antreff_lon: erwartet.antreff_lon,
            vermisst_seit: alt_vermisst_seit.as_ref().map(|o| o.as_deref()),
            pat_nummer: alt_pat_nummer.as_ref().map(|o| o.as_deref()),
            kontamination: erwartet.kontamination,
        },
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
            zustand: zustand.as_ref().map(|o| o.as_deref()),
            antreff_lat: body.antreff_lat,
            antreff_lon: body.antreff_lon,
            vermisst_seit: vermisst_seit.as_deref().map(Some),
            pat_nummer: pat_nummer.as_ref().map(|o| o.as_deref()),
            kontamination: body.kontamination,
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
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    parse_enum(PersonStatus::parse, &body.status, "Unbekannter Status")?;
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
        ctx.benutzer.id,
    )
    .await?;

    // E‑3: bei verstorben/abgemeldet → UHS-Auto-Austritt (sequenziell, eigene ETB-Spur).
    if matches!(body.status.as_str(), "verstorben" | "abgemeldet") {
        let anlass = format!("durch Status-Wechsel zu {}", body.status);
        if let Some(effekt) =
            crate::uhs::auto_austritt(&state.pool, einsatz_id, person_id, &anlass, ctx.benutzer.id)
                .await?
        {
            sse_auto_austritt(&state, einsatz_id, &effekt);
        }
    }

    super::etb_system_degradiert(
        &state,
        einsatz_id,
        ctx.benutzer.id,
        &format!(
            "Person {}: {} → {}",
            registrier_anzeige(vorher.registrier_nr),
            vorher.status.as_str(),
            body.status
        ),
    )
    .await;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(repo::laden(&state.pool, einsatz_id, person_id).await?))
}

/// DELETE /api/einsaetze/{id}/personen/{pid} — Stornieren (Soft-Delete).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    repo::storniere(&state.pool, einsatz_id, person_id, ctx.benutzer.id).await?;
    // E‑3: Storno → UHS-Auto-Austritt + Reservierungs-Cleanup (Repo schreibt nur ETB, wenn Austritt nötig).
    if let Some(effekt) = crate::uhs::auto_austritt(
        &state.pool,
        einsatz_id,
        person_id,
        "durch Storno der Person",
        ctx.benutzer.id,
    )
    .await?
    {
        sse_auto_austritt(&state, einsatz_id, &effekt);
    }
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        ctx.benutzer.id,
        &format!(
            "Person {} storniert",
            registrier_anzeige(person.registrier_nr)
        ),
    )
    .await;
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SichtungBody {
    pub kategorie: String,
    pub notiz: Option<String>,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Kennung in `einsatz_personal`.
    pub bestaetigt_personal_id: Option<i64>,
    /// Erfassungszeit, offline vorgemerkt (LLH-1138); fehlt = jetzt. Gekappt über
    /// [`crate::routes::support::erfassungszeitpunkt`].
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    #[serde(default)]
    pub client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/sichtung — Sichtung erfassen.
/// Schreibberechtigt + aktiv. Hebt `erfasst→betroffen` (Annahme 5); bei
/// `vermisst`/`abgemeldet` → 422; bei storniert → 409. Sichtung=`tot` ändert
/// den Admin-Status NICHT (Annahme 4). Pseudonyme ETB-Spur + SSE.
///
/// Ohne Netz vormerkbar (LLH-1138, Spec `personen-verlauf`): ein Replay derselben `client_id`
/// kommt vor dem Aktiv-Gate zurück (Muster `anlegen`), ohne zweiten ETB-Eintrag und ohne
/// Hinweis. Der Cache folgt der jüngsten Erfassungszeit; eine nachgereichte ältere Sichtung
/// steht im Verlauf und im ETB („nachgetragen“, zu ihrer Erfassungszeit), meldet aber kein
/// „Sichtung I“.
pub async fn sichten(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<SichtungBody>,
) -> Result<(StatusCode, Json<SichtungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = sichtung_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |s| s.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let kategorie = Sichtungskategorie::parse(&body.kategorie)
        .ok_or_else(|| AppError::Validation("Unbekannte Sichtungskategorie".into()))?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let gesichtet_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &person.erfasst_at,
    )?;
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
    // Zur Erfassungszeit (D7): eine vor der Übertragung entlassene Kraft bestätigt weiter.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        Some(&gesichtet_at),
    )
    .await?;

    // F06/LFH-244 Tier-A: Sichtungs-Erfassung (optionaler Status-Hub + INSERT + Cache-Update)
    // + System-ETB-Eintrag atomar in EINER Tx (BEGIN IMMEDIATE + Retry). Welcher ETB-Text gilt,
    // entscheidet erst der Cache nach dem INSERT (gewinnt der Eintrag?). SSE nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let neu = sichtung_repo::NeueSichtung {
        kategorie: kategorie.as_str(),
        notiz: notiz.as_deref(),
        gesichtet_at: Some(&gesichtet_at),
        client_id: client_id.as_deref(),
        bestaetigung: bestaetigung.as_ref(),
    };
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        // Zwei gleichzeitige Übertragungen desselben Schlüssels: unter `BEGIN IMMEDIATE` sieht
        // die zweite die erste und liefert sie zurück, statt am Unique-Index zu scheitern.
        if let Some(cid) = client_id.as_deref() {
            if let Some(replay) = sichtung_repo::nach_client_id(&mut *conn, einsatz_id, cid).await?
            {
                return Ok(Sichtet::Replay(replay));
            }
        }
        // Vorzustand in DERSELBEN Transaktion: eine parallele Sichtung kann den vor der Tx
        // geladenen `person.aktuelle_sichtung` schon überholt haben.
        let vorher = sichtung_repo::aktuelle_kategorie_tx(conn, einsatz_id, person_id).await?;
        let erfasst = sichtung_repo::erfassen_tx(
            conn,
            einsatz_id,
            person_id,
            &neu,
            ctx.benutzer.id,
            hebe_auf_betroffen,
        )
        .await?;
        let text = if erfasst.gewinnt {
            crate::person::etb_text_sichtung(person.registrier_nr, kategorie)
        } else {
            let aktuell = sichtung_repo::aktuelle_kategorie_tx(conn, einsatz_id, person_id)
                .await?
                .ok_or_else(|| AppError::Internal("Sichtung ohne aktuelle Kategorie".into()))?;
            crate::person::etb_text_sichtung_nachgetragen(person.registrier_nr, kategorie, aktuell)
        };
        let text = crate::person::etb_text_bestaetigt(text, bestaetigung.as_ref());
        let etb_id = crate::etb::system_audit_zu_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &text,
            &erfasst.sichtung.gesichtet_at,
        )
        .await?;
        Ok(Sichtet::Neu {
            erfasst,
            vorher,
            etb_id,
        })
    })?;
    let (erfasst, vorher, etb_id) = match ergebnis {
        Sichtet::Replay(replay) => {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |s| s.person_id)?),
            ))
        }
        Sichtet::Neu {
            erfasst,
            vorher,
            etb_id,
        } => (erfasst, vorher, etb_id),
    };
    state.live.publiziere(einsatz_id, etb_id);
    sse_person(&state, einsatz_id, person_id);
    // Der Hinweis hängt am aktuellen Stand (D6): nur wenn dieser Eintrag ihn bestimmt.
    if erfasst.gewinnt && wird_sk1(vorher, kategorie) {
        melde_sichtung_eins(&state, einsatz_id, person_id, ctx.benutzer.id).await;
    }
    Ok((StatusCode::CREATED, Json(erfasst.sichtung)))
}

/// Ein neuer medizinischer Eintrag (Transport, Maßnahme, Verletzung; Change `y18v58dt-pat-kern`)
/// gilt nur an einer angetroffenen Person: storniert ist Lebenszyklus (409), vermisst oder
/// abgemeldet ein Zusammenhang (422, `src/AGENTS.md`, Statuscode-Konvention). `was` nennt den
/// Eintrag im Wortlaut („keinen Transport“).
pub(crate) fn fordere_angetroffen(person: &PersonAnzeige, was: &str) -> Result<(), AppError> {
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(format!(
            "Stornierte Person kann {was} erhalten"
        )));
    }
    match person.status {
        PersonStatus::Vermisst | PersonStatus::Abgemeldet => {
            Err(AppError::UnprocessableEntity(format!(
                "Person ist nicht anwesend (Status {})",
                person.status.as_str()
            )))
        }
        PersonStatus::Erfasst | PersonStatus::Betroffen | PersonStatus::Verstorben => Ok(()),
    }
}

/// Ausgang der Sichtungs-Transaktion.
enum Sichtet {
    /// Schon gespeichert (gleichzeitiger Replay derselben `client_id`).
    Replay(SichtungAnzeige),
    Neu {
        erfasst: sichtung_repo::ErfassteSichtung,
        vorher: Option<Sichtungskategorie>,
        etb_id: i64,
    },
}

/// Ein Replay gilt nur an der Person, an der der Eintrag gespeichert ist; eine `client_id`, die
/// an einer anderen Person vergeben ist, ist 422 (Muster `betreuung::repo::replay_am_objekt`).
pub(crate) fn replay_an_person<T>(
    replay: T,
    person_id: i64,
    person: impl Fn(&T) -> i64,
) -> Result<T, AppError> {
    if person(&replay) == person_id {
        Ok(replay)
    } else {
        Err(AppError::UnprocessableEntity(
            "client_id gehört zu einem Eintrag an einer anderen Person".into(),
        ))
    }
}

/// GET /api/einsaetze/{id}/personen/bestaetiger — Auswahl „Bestätigt von“ am Gerät (LFH-1046,
/// Spec `geraete-kopplung`): das Personal des Einsatzes mit Name und Funktion. Nur für
/// UHS-Geräte (Routenliste in `src/geraet/mod.rs`); eine Person bestätigt durch ihre eigene
/// Anmeldung und bekommt 403.
pub async fn bestaetiger(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
) -> Result<Json<Vec<crate::geraet::bestaetigung::Bestaetiger>>, AppError> {
    if ctx.geraet.is_none() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(
        crate::geraet::bestaetigung::auswahl(&state.pool, ctx.einsatz.id).await?,
    ))
}

/// GET /api/einsaetze/{id}/personen/{pid}/audit — Lese-Audit der Person, samt den Listenzugriffen
/// aus ihrem Erfassungsfenster (LFH-916, design.md D3). Nur Einsatzleitung. Selbst NICHT
/// auditiert (kein detail-Eintrag).
pub async fn audit(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<ZugriffAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    ctx.fordere_einsatzleitung()?;
    // Existenz der Person sicherstellen (404 statt leerer Liste bei Tippfehler).
    repo::laden(&state.pool, einsatz_id, person_id).await?;
    Ok(Json(
        audit_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?,
    ))
}

/// GET /api/einsaetze/{id}/personen/listenzugriffe — Zugriffe auf die ganze Personenliste
/// (Export, Druck), neueste zuerst (LFH-916, Spec `personen-zugriffsprotokoll`). Gate wie
/// `audit`: nur Einsatzleitung, selbst NICHT auditiert.
pub async fn listenzugriffe(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
) -> Result<Json<Vec<ZugriffAnzeige>>, AppError> {
    ctx.fordere_einsatzleitung()?;
    Ok(Json(
        audit_repo::liste_listenweit(&state.pool, ctx.einsatz.id).await?,
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
    ctx: EinsatzLesezugriff<Personen>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let personen = repo::liste(&state.pool, einsatz_id, None).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, None, ctx.benutzer.id, "export").await?;

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

/// GET /api/einsaetze/{id}/personen/druck — Personenliste für die Druckansicht (LFH-727,
/// `openspec/changes/archive/2026-10-01-lfh-727-druck-modul-listen/design.md` D1). Dieselbe Menge und dasselbe Gate
/// wie die Liste, aber **protokolliert**: erst der `druck`-Eintrag (person_id = NULL), dann die
/// Daten. Scheitert der Eintrag, verlässt keine Person den Server; ein Fehler danach hinterlässt
/// höchstens einen Eintrag zu viel, nie einen zu wenig. Kein Statusfilter: gefiltert wird im
/// Client, wie am Bildschirm.
pub async fn druck(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
) -> Result<Json<Vec<PersonAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    audit_repo::anlegen(&state.pool, einsatz_id, None, ctx.benutzer.id, "druck").await?;
    Ok(Json(repo::liste(&state.pool, einsatz_id, None).await?))
}

#[derive(Debug, Deserialize)]
pub struct VerbleibBody {
    pub art: String,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<String>,
    pub notiz: Option<String>,
    /// LFH-674: Betreuungsstelle eines Notunterkunft-Verbleibs. Nur die Kennung — `ziel`
    /// bleibt, was mitgeschickt wurde (der Client belegt es mit dem Namen vor).
    pub betreuungsstelle_id: Option<i64>,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Kennung in `einsatz_personal`.
    pub bestaetigt_personal_id: Option<i64>,
    /// Erfassungszeit, offline vorgemerkt (LLH-1138); fehlt = jetzt.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    #[serde(default)]
    pub client_id: Option<String>,
    /// Wer fährt (LLH-1332): `fremd` oder `eigen`, nur bei `transport`.
    #[serde(default)]
    pub transport_durch: Option<String>,
    /// Disposition des Fahrzeugs eines Eigentransports (LLH-1332), Pflicht bei `eigen`.
    #[serde(default)]
    pub einsatz_fahrzeug_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/verbleib — Verbleib-Ereignis erfassen.
/// Schreibberechtigt + aktiv. Cache-Kurzform via `VerbleibArt::kurzform`. Pseudonyme ETB-Spur + SSE.
///
/// LFH-674 (design.md D2): ein Verweis auf eine Betreuungsstelle wird in fester Reihenfolge
/// geprüft — 422 bei anderer Art als `notunterkunft`, 403 ohne Lesezugriff auf das Modul
/// Betreuung (VOR jedem Lesen der Stelle, sonst verrieten 404/409 ihre Existenz), 404 bei
/// fremder/unbekannter Stelle, 409 bei stornierter. Eine geschlossene Stelle ist erlaubt
/// (Entscheidung 24.09.2026: ein Verbleib wird oft nachgetragen). Der Server setzt keinen
/// Stellennamen in Ziel, Kurzform oder ETB.
///
/// Ohne Netz vormerkbar (LLH-1138, Spec `personen-verlauf`): Replay vor dem Aktiv-Gate,
/// Erfassungszeit gekappt, Cache und Kurzform aus dem jüngsten Ereignis. Verbleib, Auto-Austritt
/// und ETB stehen in EINER Transaktion; der Austritt läuft nur, wenn der neue Verbleib gewinnt.
pub async fn verbleib(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<VerbleibBody>,
) -> Result<(StatusCode, Json<VerbleibAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = verbleib_repo::nach_client_id(&state.pool, einsatz_id, cid).await? {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |v| v.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let art = VerbleibArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Verbleib-Art".into()))?;
    let status = parse_enum_opt(
        VerbleibStatus::parse,
        body.status.as_deref(),
        "Unbekannter Verbleib-Status",
    )?;
    let durch = parse_enum_opt(
        TransportDurch::parse,
        body.transport_durch.as_deref(),
        "Unbekannte Fahrer-Angabe",
    )?;
    // Das Feld für sich (400) vor jedem Zusammenhang (422); die Untergrenze kommt mit der Person.
    let jetzt = chrono::Utc::now();
    crate::routes::support::meldezeitpunkt(body.zeitpunkt_at.as_deref(), jetzt)?;
    // Stellenbindung (LFH-1041): ein Gerät der Betreuungsstelle bringt in keine andere
    // Notunterkunft, auch nicht ohne Stelle; die übrigen Verbleib-Arten bleiben frei.
    if art == VerbleibArt::Notunterkunft
        && stelle::eigene(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle).is_some()
    {
        stelle::fordere_ziel_stelle(
            ctx.geraet.as_ref(),
            Bindungsart::Betreuungsstelle,
            body.betreuungsstelle_id,
        )?;
    }
    if let Some(stelle_id) = body.betreuungsstelle_id {
        if art != VerbleibArt::Notunterkunft {
            return Err(AppError::UnprocessableEntity(
                "Eine Betreuungsstelle gibt es nur beim Verbleib Notunterkunft".into(),
            ));
        }
        ctx.fordere_modul_zugriff(
            &state.pool,
            <crate::einsatz::modul::Betreuung as crate::einsatz::modul::ModulMarker>::KEY
                .expect("Betreuung ist an ein Modul gebunden"),
        )
        .await?;
        let stelle =
            crate::betreuung::repo::stelle_laden(&state.pool, einsatz_id, stelle_id).await?;
        if stelle.storniert_at.is_some() {
            return Err(AppError::Conflict(
                "Die Betreuungsstelle ist storniert".into(),
            ));
        }
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let zeitpunkt_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        jetzt,
        &person.erfasst_at,
    )?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keinen Verbleib erhalten".into(),
        ));
    }
    // Fahrer-Angabe (LLH-1332, design.md D2): Paarung vor dem Lesen des Fahrzeugs, die
    // Momentaufnahme des Funkrufnamens ersetzt einen mitgeschickten Text.
    pruefe_fahrer_angabe(art, status, durch, body.einsatz_fahrzeug_id)?;
    let uebergabe = status == Some(VerbleibStatus::Uebergeben);
    if uebergabe {
        pruefe_uebergabe(
            verbleib_repo::aktueller(&state.pool, einsatz_id, person_id).await?,
            body.einsatz_fahrzeug_id,
            &zeitpunkt_at,
        )?;
    }
    let transportmittel = match body.einsatz_fahrzeug_id {
        Some(ef_id) => {
            let fahrzeug = crate::fahrzeug::disposition_repo::transport_fahrzeug(
                &state.pool,
                einsatz_id,
                ef_id,
            )
            .await?
            .ok_or(AppError::NotFound)?;
            // Die Übergabe quittiert eine Fahrt, die schon geprüft ist: das Fahrzeug darf
            // inzwischen entlassen oder neu disponiert sein (design.md, Risiken).
            if !uebergabe && !fahrzeug.bestand_zu(&zeitpunkt_at) {
                return Err(AppError::UnprocessableEntity(
                    "Das Fahrzeug war zur Erfassungszeit nicht im Einsatz disponiert".into(),
                ));
            }
            Some(fahrzeug.funkrufname)
        }
        None => trimme(body.transportmittel),
    };
    let ziel = trimme(body.ziel);
    let notiz = trimme(body.notiz);
    // Zur Erfassungszeit (D7), wie bei der Sichtung.
    let bestaetigung = crate::geraet::bestaetigung::aufloesen(
        &state.pool,
        ctx.geraet.as_ref(),
        einsatz_id,
        body.bestaetigt_personal_id,
        Some(&zeitpunkt_at),
    )
    .await?;

    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let daten = verbleib_repo::VerbleibDaten {
        art: art.as_str(),
        transportmittel: transportmittel.as_deref(),
        ziel: ziel.as_deref(),
        status: body.status.as_deref(),
        notiz: notiz.as_deref(),
        betreuungsstelle_id: body.betreuungsstelle_id,
        bestaetigung: bestaetigung.as_ref(),
        zeitpunkt_at: Some(&zeitpunkt_at),
        client_id: client_id.as_deref(),
        transport_durch: durch.map(|d| d.as_str()),
        einsatz_fahrzeug_id: body.einsatz_fahrzeug_id,
    };
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        if let Some(cid) = client_id.as_deref() {
            if let Some(replay) = verbleib_repo::nach_client_id(&mut *conn, einsatz_id, cid).await?
            {
                return Ok(Verbleibt::Replay(replay));
            }
        }
        let erfasst = verbleib_repo::erfassen_tx(
            conn,
            einsatz_id,
            person_id,
            verbleib_repo::VerbleibDaten { ..daten },
            ctx.benutzer.id,
        )
        .await?;
        // E‑3: bei transport/entlassung/notunterkunft → UHS-Auto-Austritt (eigene ETB-Spur).
        // Notunterkunft (LFH-613) verlässt die Unfallhilfsstelle ebenso wie ein Transport. Nur,
        // wenn dieser Verbleib der aktuelle ist (D6): ein älterer nachgereichter Transport holt
        // die zurückgekehrte Person nicht aus der UHS. Ebenso wenig einer, der älter ist als der
        // jüngste Eintritt oder Wechsel in eine UHS: die Belegung ist dann der jüngere Stand.
        let austritt = if erfasst.gewinnt
            && matches!(
                art,
                VerbleibArt::Transport | VerbleibArt::Entlassung | VerbleibArt::Notunterkunft
            )
            && !crate::uhs::belegung_repo::has_zugang_nach_tx(
                conn,
                einsatz_id,
                person_id,
                &zeitpunkt_at,
            )
            .await?
        {
            crate::uhs::auto_austritt_tx(
                conn,
                einsatz_id,
                person_id,
                &format!("durch Verbleib {}", art.as_str()),
                ctx.benutzer.id,
                startwert,
            )
            .await?
        } else {
            None
        };
        let verbleib = verbleib_repo::laden_tx(conn, einsatz_id, erfasst.id).await?;
        let text = format!(
            "Person {}: {}",
            registrier_anzeige(person.registrier_nr),
            crate::person::verbleib_etb_sachverhalt(art, status, durch)
        );
        let text = if erfasst.gewinnt {
            text
        } else {
            format!("{text}, nachgetragen")
        };
        let etb_id = crate::etb::system_audit_zu_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::person::etb_text_bestaetigt(text, bestaetigung.as_ref()),
            &verbleib.zeitpunkt_at,
        )
        .await?;
        Ok(Verbleibt::Neu {
            verbleib,
            austritt,
            etb_id,
        })
    })?;
    let (verbleib, austritt, etb_id) = match ergebnis {
        Verbleibt::Replay(replay) => {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |v| v.person_id)?),
            ))
        }
        Verbleibt::Neu {
            verbleib,
            austritt,
            etb_id,
        } => (verbleib, austritt, etb_id),
    };
    if let Some(a) = austritt {
        state.live.publiziere(einsatz_id, a.etb_id);
        state
            .live
            .publiziere_objekt(einsatz_id, LiveEvent::Uhs, "uhs_id", a.uhs_id);
    }
    state.live.publiziere(einsatz_id, etb_id);
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(verbleib)))
}

/// Paarung von Art, Status, Fahrer-Angabe und Fahrzeug (LLH-1332, Spec `patienten-uebergabe`):
/// die Fahrer-Angabe nur beim Transport, ein Eigentransport nur mit Fahrzeug, ein Fahrzeug nur
/// beim Eigentransport, die Übergabe nur beim Eigentransport. Jeder Verstoß ist 422.
fn pruefe_fahrer_angabe(
    art: VerbleibArt,
    status: Option<VerbleibStatus>,
    durch: Option<TransportDurch>,
    einsatz_fahrzeug_id: Option<i64>,
) -> Result<(), AppError> {
    let fehler = |text: &str| Err(AppError::UnprocessableEntity(text.into()));
    if durch.is_some() && art != VerbleibArt::Transport {
        return fehler("Wer fährt, gibt es nur beim Verbleib Transport");
    }
    let eigen = durch == Some(TransportDurch::Eigen);
    if eigen && einsatz_fahrzeug_id.is_none() {
        return fehler("Ein Eigentransport braucht ein Fahrzeug aus dem Einsatz");
    }
    if !eigen && einsatz_fahrzeug_id.is_some() {
        return fehler("Ein Fahrzeug aus dem Einsatz gibt es nur beim Eigentransport");
    }
    if status == Some(VerbleibStatus::Uebergeben) && !eigen {
        return fehler("Eine Übergabe gibt es nur beim Eigentransport");
    }
    Ok(())
}

/// Eine Übergabe schließt den laufenden Eigentransport ab (LLH-1332, Spec `patienten-uebergabe`):
/// der aktuelle Verbleib ist ein noch nicht übergebener Eigentransport mit demselben Fahrzeug, und
/// die Übergabe liegt nicht vor ihm. Sonst würde sie still nachgetragen und der Patient bliebe
/// unterwegs, obwohl der Dialog „quittiert“ meldet. Jeder Verstoß ist 422.
fn pruefe_uebergabe(
    aktuell: Option<VerbleibAnzeige>,
    einsatz_fahrzeug_id: Option<i64>,
    zeitpunkt_at: &str,
) -> Result<(), AppError> {
    let laufend = aktuell.filter(|v| {
        v.art == VerbleibArt::Transport
            && v.transport_durch == Some(TransportDurch::Eigen)
            && v.status != Some(VerbleibStatus::Uebergeben)
            && v.einsatz_fahrzeug_id == einsatz_fahrzeug_id
    });
    let Some(laufend) = laufend else {
        return Err(AppError::UnprocessableEntity(
            "Die Person ist nicht mit diesem Fahrzeug im Eigentransport".into(),
        ));
    };
    if zeitpunkt_at < laufend.zeitpunkt_at.as_str() {
        return Err(AppError::UnprocessableEntity(
            "Die Übergabe kann nicht vor dem Beginn des Eigentransports liegen".into(),
        ));
    }
    Ok(())
}

/// Ausgang der Verbleib-Transaktion.
enum Verbleibt {
    /// Schon gespeichert (gleichzeitiger Replay derselben `client_id`).
    Replay(VerbleibAnzeige),
    Neu {
        verbleib: VerbleibAnzeige,
        austritt: Option<crate::uhs::AutoAustrittTx>,
        etb_id: i64,
    },
}

#[derive(Debug, Deserialize)]
pub struct NotizBody {
    pub text: String,
    /// Erfassungszeit, offline vorgemerkt (LLH-1138); fehlt = jetzt.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    #[serde(default)]
    pub client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/notizen — append-only Befundnotiz.
/// Schreibberechtigt + aktiv. **KEIN ETB-Eintrag** (besondere Kategorie). SSE.
///
/// Ohne Netz vormerkbar (LLH-1138, Spec `personen-verlauf`): Replay derselben `client_id` vor
/// dem Aktiv-Gate, Erfassungszeit gekappt.
pub async fn notiz(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Personen>,
    headers: HeaderMap,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<NotizBody>,
) -> Result<(StatusCode, Json<NotizAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_person(&state.pool, ctx.geraet.as_ref(), person_id).await?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = crate::routes::support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) =
            verlaufsnotiz_repo::nach_client_id(&state.pool, einsatz_id, cid).await?
        {
            return Ok((
                StatusCode::CREATED,
                Json(replay_an_person(replay, person_id, |n| n.person_id)?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let text = pflicht_max(&body.text, "Notiztext", VERLAUFSNOTIZ_MAX)?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    let erfasst_at = crate::routes::support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &person.erfasst_at,
    )?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keine Notiz erhalten".into(),
        ));
    }
    let notiz = verlaufsnotiz_repo::anlegen(
        &state.pool,
        einsatz_id,
        person_id,
        &verlaufsnotiz_repo::NeueNotiz {
            text: &text,
            erfasst_at: Some(&erfasst_at),
            client_id: client_id.as_deref(),
        },
        ctx.benutzer.id,
    )
    .await?;
    // Ein gleichzeitiger Replay kam in der Transaktion zurück; er gehört zu dieser Person nur,
    // wenn die Kennung passt.
    let notiz = replay_an_person(notiz, person_id, |n| n.person_id)?;
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
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_eid, person_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbgleichBody>,
) -> Result<(StatusCode, Json<AbgleichAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
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
        ctx.benutzer.id,
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
    ctx: EinsatzLeitungszugriff<Personen>,
    PfadParam((_eid, person_id, abgleich_id)): PfadParam<(i64, i64, i64)>,
    JsonBody(body): JsonBody<EntscheidungBody>,
) -> Result<Json<AbgleichAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
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
        ctx.benutzer.id,
    )
    .await?;

    if body.entscheidung == "bestaetigt" {
        let vermisst = repo::laden(&state.pool, einsatz_id, abgleich.vermisst_person_id).await?;
        let gefunden = repo::laden(&state.pool, einsatz_id, abgleich.gefunden_person_id).await?;
        super::etb_system_degradiert(
            &state,
            einsatz_id,
            ctx.benutzer.id,
            &format!(
                "Vermisstmeldung {} aufgeklärt — identisch mit {}",
                registrier_anzeige(vermisst.registrier_nr),
                registrier_anzeige(gefunden.registrier_nr)
            ),
        )
        .await;
    }
    sse_person(&state, einsatz_id, abgleich.vermisst_person_id);
    sse_person(&state, einsatz_id, abgleich.gefunden_person_id);
    Ok(Json(entschieden))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(s: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn meldung(r: Result<String, AppError>) -> String {
        match r {
            Err(AppError::Validation(m)) => m,
            andere => panic!("400 erwartet, war {andere:?}"),
        }
    }

    #[test]
    fn geburtsdatum_nimmt_gueltige_tage_bis_morgen() {
        let heute = tag("2026-10-19");
        for gut in ["1980-02-01", "2024-02-29", "2026-10-19", "2026-10-20"] {
            assert_eq!(pruefe_geburtsdatum(gut, heute).unwrap(), gut);
        }
    }

    #[test]
    fn geburtsdatum_lehnt_form_kalender_und_zukunft_ab() {
        let heute = tag("2026-10-19");
        for form in [
            "1980-2-1",
            "01.02.1980",
            "+1980-02-01",
            "19800201",
            "1980-02-01 ",
        ] {
            assert_eq!(
                meldung(pruefe_geburtsdatum(form, heute)),
                "Geburtsdatum muss die Form JJJJ-MM-TT haben",
                "{form}"
            );
        }
        for kalender in ["2023-02-29", "1980-02-31", "1980-13-01", "1980-00-10"] {
            assert_eq!(
                meldung(pruefe_geburtsdatum(kalender, heute)),
                "Geburtsdatum ist kein gültiger Kalendertag",
                "{kalender}"
            );
        }
        assert_eq!(
            meldung(pruefe_geburtsdatum("2026-10-21", heute)),
            "Geburtsdatum darf nicht in der Zukunft liegen"
        );
    }

    #[test]
    fn leerer_text_altwert_heisst_leer() {
        assert_eq!(leer_als_null(None), None);
        assert_eq!(leer_als_null(Some(None)), Some(None));
        assert_eq!(leer_als_null(Some(Some("  ".into()))), Some(None));
        assert_eq!(
            leer_als_null(Some(Some(" Alt ".into()))),
            Some(Some(" Alt ".into())),
            "kein Trimmen"
        );
    }
}
