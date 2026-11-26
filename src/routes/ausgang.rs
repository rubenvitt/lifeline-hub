//! Routen des Ausgangskorbs (LLH-2093, Spec `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`
//! Abschnitt 5): Versände anlegen („Senden“) an Lagebericht, Befehl und Nachforderung, die
//! Versandliste und „Erneut senden“.
//!
//! Die drei Anlege-Handler liegen bei ihrem Modul (`routes::lagebericht`, `routes::befehl`,
//! `routes::nachforderung`) und rufen [`anlegen`]; hier stehen der gemeinsame Ablauf, die Liste
//! und das Wiederholen. Rechte wie Schreiben bzw. Lesen im Modul der Quelle; 422 trägt den
//! [`AusgangFehler`]-Code als `grund` (`AppError::UnprocessableGrund`).

use crate::app::AppState;
use crate::ausgang::{self, nachricht, repo, AusgangFehler, QuelleArt, Versand};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::Einsatz;
use crate::error::AppError;
use crate::externe_stelle::{ExterneStelle, ExterneStelleKanal, KanalArt};
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::routes::support::CLIENT_ID_MAX;
use crate::routes::vorlagendokument::DokumentRoute;
use crate::vorlagendokument::repo as dokument_repo;
use crate::vorlagendokument::STATUS_FREIGEGEBEN;
use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use utoipa::ToSchema;

/// Höchstzahl der Empfänger je Anfrage.
pub const EMPFAENGER_MAX: usize = 20;

/// Body von `POST …/deliveries` am Dokument bzw. an der Nachforderung.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDeliveriesBody {
    /// Idempotenzschlüssel der Anfrage (höchstens 64 Zeichen); je Empfänger wird
    /// `{client_id}:{channel_id}` daraus. Dieselbe Anfrage erneut liefert dieselben Versände.
    pub client_id: String,
    /// Die Kanaladressen, an die gesendet wird (1 bis 20, jede höchstens einmal).
    pub recipients: Vec<RecipientBody>,
}

/// Ein Empfänger: die Kanaladresse bestimmt Stelle, Kanal und Adresse.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecipientBody {
    pub channel_id: i64,
}

/// Query von `GET /api/incidents/{id}/deliveries`.
#[derive(Debug, Deserialize)]
pub struct DeliveriesQuery {
    /// Nur Versände dieser Quellart.
    #[serde(default)]
    pub source_kind: Option<String>,
    /// Nur Versände dieser Quelle; verlangt `source_kind`.
    #[serde(default)]
    pub source_id: Option<i64>,
}

/// Modul-Key der Quelle: das Modul, dessen Recht das Senden und Lesen trägt.
fn modul_key(quelle: QuelleArt) -> &'static str {
    match quelle {
        QuelleArt::Lagebericht => "lageberichte",
        QuelleArt::Befehl => "auftraege",
        QuelleArt::Nachforderung => "nachforderungen",
    }
}

fn mit_grund(fehler: AusgangFehler, meldung: &str) -> AppError {
    AppError::UnprocessableGrund {
        meldung: meldung.to_string(),
        grund: fehler.as_str(),
    }
}

/// Die Meldung bei 422, wenn die Anbindung eines Kanals fehlt, angehalten oder nicht nutzbar ist.
fn meldung_anbindung(kanal: KanalArt, fehler: AusgangFehler) -> &'static str {
    match (kanal, fehler) {
        (KanalArt::Fax, AusgangFehler::AnbindungFehlt) => "Kein Faxzugang eingerichtet",
        (KanalArt::Fax, AusgangFehler::AnbindungAngehalten) => "Der Faxzugang ist angehalten",
        (KanalArt::Fax, _) => "Der Faxzugang ist nicht nutzbar; Einstellungen prüfen",
        (KanalArt::Matrix, AusgangFehler::AnbindungFehlt) => "Kein Matrix-Konto eingerichtet",
        (KanalArt::Matrix, AusgangFehler::AnbindungAngehalten) => "Das Matrix-Konto ist angehalten",
        (KanalArt::Matrix, _) => "Das Matrix-Konto ist nicht nutzbar; Einstellungen prüfen",
        (_, AusgangFehler::AnbindungFehlt) => "Kein Mailserver eingerichtet",
        (_, AusgangFehler::AnbindungAngehalten) => "Der Mailserver ist angehalten",
        _ => "Der Mailserver ist nicht nutzbar; Einstellungen prüfen",
    }
}

/// Baut das PDF je Fax-Empfänger und prüft die Fax-Grenze (`zu_gross`). Liest die Bytes der
/// Anlagen, aber nur, wenn ein Fax dabei ist; kein Netz, kein Geheimnis.
async fn pruefe_fax_pdf(
    state: &AppState,
    einsatz: &Einsatz,
    quelle: QuelleArt,
    quelle_id: i64,
    schnappschuss: &nachricht::Schnappschuss,
    faxe: &[&(ExterneStelle, ExterneStelleKanal, String)],
) -> Result<(), AppError> {
    let anlagen =
        match nachricht::load_anhaenge_quelle(&state.pool, quelle, einsatz.id, quelle_id).await {
            Ok(a) => a,
            Err(nachricht::AnhangFehler::ZuGross) => {
                return Err(mit_grund(
                    AusgangFehler::ZuGross,
                    "Die Anlagen sind zusammen größer als 20 MiB",
                ))
            }
            Err(nachricht::AnhangFehler::App(e)) => return Err(e),
        };
    let kennung = crate::adapter::repo::load_fuer_org(
        &state.pool,
        einsatz.org_id,
        crate::adapter::sipgate_fax_art::CODE,
    )
    .await?
    .and_then(|a| {
        a.einstellungen()
            .get("absender_kennung")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });
    let kopf = nachricht::pdf_kopf_laden(
        &state.pool,
        einsatz.id,
        quelle,
        quelle_id,
        kennung.as_deref(),
    )
    .await?;
    // Die Empfänger unterscheiden sich nur in der Zeile „An:“: einmal mit der längsten bauen.
    let an = faxe
        .iter()
        .map(|(stelle, kanal, _)| {
            nachricht::an_text(kanal.channel, &stelle.bezeichnung, &kanal.address)
        })
        .max_by_key(|a| a.chars().count())
        .unwrap_or_default();
    let (pdf, _) = nachricht::baue_pdf_im_hintergrund(
        kopf,
        an,
        schnappschuss.betreff.clone(),
        schnappschuss.inhalt.clone(),
        anlagen,
        chrono::Utc::now(),
    )
    .await;
    let pdf = pdf.map_err(|_| {
        mit_grund(
            AusgangFehler::ZuGross,
            "Aus diesem Dokument lässt sich kein Fax bauen (Anlage nicht lesbar)",
        )
    })?;
    if !ausgang::pdf::passt_fuer_fax(&pdf) {
        return Err(mit_grund(
            AusgangFehler::ZuGross,
            &format!(
                "Das Fax hätte {} Seiten; erlaubt sind höchstens {} Seiten und 10 MiB",
                pdf.seiten,
                ausgang::pdf::FAX_SEITEN_MAX
            ),
        ));
    }
    Ok(())
}

/// Der Einsatz ist ein Spiegel (von einer anderen Instanz geführt): hier wird nicht zugestellt.
async fn pruefe_kein_spiegel(state: &AppState, einsatz_id: i64) -> Result<(), AppError> {
    if ausgang::lauf::is_spiegel(&state.pool, einsatz_id).await? {
        return Err(mit_grund(
            AusgangFehler::Spiegel,
            "Dieser Einsatz wird von einer anderen Instanz geführt; dort wird gesendet",
        ));
    }
    Ok(())
}

/// Prüft den Body (400) und leitet je Empfänger die `client_id` ab.
fn pruefe_body(body: &CreateDeliveriesBody) -> Result<Vec<(i64, String)>, AppError> {
    let client_id = body.client_id.trim();
    if client_id.is_empty() {
        return Err(AppError::Validation("client_id fehlt".into()));
    }
    if client_id.len() > CLIENT_ID_MAX {
        return Err(AppError::Validation(format!(
            "client_id zu lang (max. {CLIENT_ID_MAX} Zeichen)"
        )));
    }
    if body.recipients.is_empty() {
        return Err(AppError::Validation("Empfänger fehlen".into()));
    }
    if body.recipients.len() > EMPFAENGER_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {EMPFAENGER_MAX} Empfänger je Anfrage"
        )));
    }
    let mut ids: Vec<i64> = body.recipients.iter().map(|r| r.channel_id).collect();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        return Err(AppError::Validation(
            "Eine Adresse kommt mehrfach vor".into(),
        ));
    }
    Ok(body
        .recipients
        .iter()
        .map(|r| (r.channel_id, format!("{client_id}:{}", r.channel_id)))
        .collect())
}

/// Prüft Quelle und Anhänge und liefert den Schnappschuss; 422 mit Code bei überholter Fassung
/// (`ueberholt`) und zu großen Anhängen (`zu_gross`).
async fn lade_dokument_schnappschuss<T: DokumentRoute>(
    state: &AppState,
    benutzer_id: i64,
    einsatz_id: i64,
    id: i64,
) -> Result<nachricht::Schnappschuss, AppError> {
    let mut conn = state.pool.acquire().await?;
    let dok = dokument_repo::laden::<T>(&mut *conn, einsatz_id, id).await?;
    if dok.status == STATUS_FREIGEGEBEN
        && !dokument_repo::is_juengste_freigabe::<T>(&mut conn, einsatz_id, id).await?
    {
        return Err(mit_grund(
            AusgangFehler::Ueberholt,
            &format!(
                "{} ist überholt; bitte die neue Fassung senden",
                T::NOMEN_MIT_ARTIKEL
            ),
        ));
    }
    let absender = nachricht::absender_laden(&mut conn, einsatz_id, benutzer_id).await?;
    let schnappschuss =
        nachricht::schnappschuss_dokument::<T>(&mut conn, einsatz_id, id, &absender).await?;
    drop(conn);
    // Nur die gespeicherte Größe zählt hier, ohne Bytes zu lesen; der Lauf liest die Anhänge
    // beim Zustellen und prüft die echten Bytes.
    match nachricht::pruefe_anhaenge_gespeichert::<T>(&state.pool, einsatz_id, id).await {
        Ok(_) => {}
        Err(nachricht::AnhangFehler::ZuGross) => {
            return Err(mit_grund(
                AusgangFehler::ZuGross,
                "Die Anlagen sind zusammen größer als 20 MiB",
            ))
        }
        Err(nachricht::AnhangFehler::App(e)) => return Err(e),
    }
    Ok(schnappschuss)
}

async fn lade_nachforderung_schnappschuss(
    state: &AppState,
    benutzer_id: i64,
    einsatz_id: i64,
    id: i64,
) -> Result<nachricht::Schnappschuss, AppError> {
    let mut conn = state.pool.acquire().await?;
    let absender = nachricht::absender_laden(&mut conn, einsatz_id, benutzer_id).await?;
    let schnappschuss =
        nachricht::schnappschuss_nachforderung(&mut conn, einsatz_id, id, &absender).await?;
    Ok(schnappschuss)
}

/// Gemeinsamer Ablauf des Anlegens nach Recht und aktivem Einsatz: Body (400), dann die
/// Wiederholung derselben Anfrage (Replay), dann für die noch fehlenden Empfänger die
/// Prüfreihenfolge der Spec (Spiegel, Kanaladressen, Anbindung, Schnappschuss, Anhänge), dann
/// alle neuen Zeilen in einer Transaktion, danach Wecker und Live-Ereignis.
///
/// Replay: gibt es zu einer abgeleiteten `client_id` schon einen Versand, kommt er unverändert
/// zurück, ohne die Umstände erneut zu prüfen (die Mail ist angelegt und geht hinaus, auch wenn
/// der Mailserver inzwischen angehalten oder eine neuere Fassung freigegeben ist). Sonst sähe der
/// Client nach verlorener Antwort ein 422 und sendete mit neuem Schlüssel doppelt.
async fn anlegen(
    state: &AppState,
    benutzer_id: i64,
    einsatz: &Einsatz,
    quelle: QuelleArt,
    quelle_id: i64,
    body: CreateDeliveriesBody,
) -> Result<(StatusCode, Json<Vec<Versand>>), AppError> {
    let empfaenger = pruefe_body(&body)?;

    let mut vorhanden: HashMap<String, Versand> = HashMap::new();
    {
        let mut conn = state.pool.acquire().await?;
        for (_, client_id) in &empfaenger {
            if let Some((einsatz_id, v)) =
                repo::find_by_client_id(&mut conn, einsatz.org_id, client_id).await?
            {
                // Dieselbe `client_id` darf nur dieselbe Quelle meinen.
                if einsatz_id != einsatz.id || v.source_kind != quelle || v.source_id != quelle_id {
                    return Err(AppError::Conflict(
                        "client_id gehört zu einem anderen Versand".into(),
                    ));
                }
                vorhanden.insert(client_id.clone(), v);
            }
        }
    }
    if vorhanden.len() == empfaenger.len() {
        let versaende = empfaenger
            .iter()
            .filter_map(|(_, c)| vorhanden.remove(c))
            .collect();
        return Ok((StatusCode::CREATED, Json(versaende)));
    }

    pruefe_kein_spiegel(state, einsatz.id).await?;

    // Jede noch fehlende Adresse gehört zur Org, ihre Stelle ist aktiv, der Kanal ist
    // freigeschaltet.
    let mut adressen = Vec::with_capacity(empfaenger.len());
    {
        let mut conn = state.pool.acquire().await?;
        for (channel_id, client_id) in &empfaenger {
            if vorhanden.contains_key(client_id) {
                continue;
            }
            let (stelle, kanal) =
                crate::externe_stelle::kanal::load_in_org(&mut conn, einsatz.org_id, *channel_id)
                    .await?;
            if !stelle.aktiv {
                return Err(AppError::UnprocessableEntity(format!(
                    "Die Stelle „{}“ ist nicht aktiv",
                    stelle.bezeichnung
                )));
            }
            // Threema nimmt noch kein Versand an, auch wenn die Tabelle es kennt.
            if !kanal.channel.is_freigeschaltet() {
                return Err(AppError::UnprocessableEntity(
                    "Dieser Kanal wird noch nicht unterstützt".into(),
                ));
            }
            adressen.push((stelle, kanal, client_id.clone()));
        }
    }

    // Je Kanal der Empfänger eine nicht angehaltene Anbindung der Org (sonst 422 mit Code);
    // gemischte Empfänger brauchen beide. Nur Zustand, kein Entschlüsseln: das Geheimnis liest
    // allein der Lauf.
    for kanal in KanalArt::ALLE {
        if !adressen.iter().any(|(_, k, _)| k.channel == kanal) {
            continue;
        }
        if let Err(fehler) = crate::adapter::lauf::pruefe_versand_moeglich(
            &state.pool,
            &state.adapter,
            einsatz.org_id,
            kanal,
        )
        .await?
        {
            return Err(mit_grund(fehler, meldung_anbindung(kanal, fehler)));
        }
    }

    let geladen = match quelle {
        QuelleArt::Lagebericht => {
            lade_dokument_schnappschuss::<crate::lagebericht::Lagebericht>(
                state,
                benutzer_id,
                einsatz.id,
                quelle_id,
            )
            .await?
        }
        QuelleArt::Befehl => {
            lade_dokument_schnappschuss::<crate::befehl::Befehl>(
                state,
                benutzer_id,
                einsatz.id,
                quelle_id,
            )
            .await?
        }
        QuelleArt::Nachforderung => {
            lade_nachforderung_schnappschuss(state, benutzer_id, einsatz.id, quelle_id).await?
        }
    };
    let schnappschuss = &geladen;

    // Ein Fax darf höchstens 30 Seiten und 10 MiB haben (nur Fax, Spec Abschnitt 6): geprüft,
    // bevor irgendetwas angelegt wird, auch für die Mail-Empfänger derselben Anfrage.
    let faxe: Vec<_> = adressen
        .iter()
        .filter(|(_, k, _)| k.channel == KanalArt::Fax)
        .collect();
    if !faxe.is_empty() {
        pruefe_fax_pdf(state, einsatz, quelle, quelle_id, schnappschuss, &faxe).await?;
    }

    let neu = crate::write_retry!(&state.pool, |conn| {
        let mut out = Vec::with_capacity(adressen.len());
        for (stelle, kanal, client_id) in &adressen {
            let v = repo::create_tx(
                conn,
                &ausgang::NeuerVersand {
                    org_id: einsatz.org_id,
                    einsatz_id: einsatz.id,
                    client_id,
                    quelle,
                    quelle_id,
                    kanal,
                    stelle,
                    betreff: &schnappschuss.betreff,
                    inhalt: &schnappschuss.inhalt,
                    erstellt_von_id: benutzer_id,
                },
            )
            .await?;
            // Dieselbe `client_id` darf nur dieselbe Quelle meinen.
            if v.source_kind != quelle || v.source_id != quelle_id {
                return Err(AppError::Conflict(
                    "client_id gehört zu einem anderen Versand".into(),
                ));
            }
            out.push((client_id.clone(), v));
        }
        Ok(out)
    })?;
    vorhanden.extend(neu);
    let versaende: Vec<Versand> = empfaenger
        .iter()
        .filter_map(|(_, c)| vorhanden.remove(c))
        .collect();

    state.ausgang_wecker.notify_one();
    state
        .live
        .publiziere_einsatz(einsatz.id, LiveEvent::Ausgang);
    Ok((StatusCode::CREATED, Json(versaende)))
}

/// Senden an Lagebericht oder Befehl; der Aufrufer hat Schreibrecht, Modul und aktiven Einsatz
/// schon über `routes::vorlagendokument::fordere_schreiben` geprüft.
pub(crate) async fn anlegen_dokument(
    state: &AppState,
    benutzer_id: i64,
    einsatz: &Einsatz,
    quelle: QuelleArt,
    id: i64,
    body: CreateDeliveriesBody,
) -> Result<(StatusCode, Json<Vec<Versand>>), AppError> {
    anlegen(state, benutzer_id, einsatz, quelle, id, body).await
}

/// Senden an eine Nachforderung; der Aufrufer zieht `EinsatzSchreibzugriff<Nachforderungen>`.
pub(crate) async fn anlegen_nachforderung(
    state: &AppState,
    benutzer_id: i64,
    einsatz: &Einsatz,
    id: i64,
    body: CreateDeliveriesBody,
) -> Result<(StatusCode, Json<Vec<Versand>>), AppError> {
    anlegen(
        state,
        benutzer_id,
        einsatz,
        QuelleArt::Nachforderung,
        id,
        body,
    )
    .await
}

/// GET /api/incidents/{id}/deliveries?source_kind&source_id — Versandliste. Mit `source_kind`
/// gilt das Leserecht des Moduls der Quelle; ohne Filter kommen nur Versände von Quellarten,
/// deren Modul die Person lesen darf.
pub async fn list_deliveries(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    Query(q): Query<DeliveriesQuery>,
) -> Result<Json<Vec<Versand>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let art = match q.source_kind.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) => Some(
            QuelleArt::parse(s).ok_or_else(|| AppError::Validation("Ungültige Quellart".into()))?,
        ),
    };
    match (art, q.source_id) {
        (Some(art), Some(id)) => {
            ctx.fordere_modul_zugriff(&state.pool, modul_key(art))
                .await?;
            Ok(Json(
                repo::list_fuer_quelle(&state.pool, einsatz_id, art, id).await?,
            ))
        }
        (Some(art), None) => {
            ctx.fordere_modul_zugriff(&state.pool, modul_key(art))
                .await?;
            let alle = repo::list_fuer_einsatz(&state.pool, einsatz_id).await?;
            Ok(Json(
                alle.into_iter().filter(|v| v.source_kind == art).collect(),
            ))
        }
        (None, Some(_)) => Err(AppError::Validation("source_id braucht source_kind".into())),
        (None, None) => {
            let mut lesbar = Vec::new();
            for art in QuelleArt::ALLE {
                if ctx
                    .fordere_modul_zugriff(&state.pool, modul_key(art))
                    .await
                    .is_ok()
                {
                    lesbar.push(art);
                }
            }
            let alle = repo::list_fuer_einsatz(&state.pool, einsatz_id).await?;
            Ok(Json(
                alle.into_iter()
                    .filter(|v| lesbar.contains(&v.source_kind))
                    .collect(),
            ))
        }
    }
}

/// POST /api/incidents/{id}/deliveries/{did}/retry — „Erneut senden“ aus `fehlgeschlagen`.
/// Schreibrecht im Modul der Quelle; die Quelle darf nicht überholt oder zurückgezogen sein
/// (422 `ueberholt`). Gesendet wird der gespeicherte Schnappschuss.
pub async fn retry_delivery(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff,
    PfadParam((_eid, did)): PfadParam<(i64, String)>,
) -> Result<Json<Versand>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let zeile = {
        let mut conn = state.pool.acquire().await?;
        repo::load(&mut conn, einsatz_id, &did).await?
    };
    ctx.fordere_modul_zugriff(&state.pool, modul_key(zeile.quelle_art))
        .await?;
    pruefe_kein_spiegel(&state, einsatz_id).await?;
    if !ausgang::lauf::is_quelle_aktuell(&state.pool, &zeile).await? {
        return Err(mit_grund(
            AusgangFehler::Ueberholt,
            "Die Quelle ist überholt oder zurückgezogen; bitte die neue Fassung senden",
        ));
    }
    let jetzt = chrono::Utc::now();
    let v = crate::write_retry!(&state.pool, |conn| {
        repo::retry_tx(conn, einsatz_id, &did, jetzt).await
    })?;
    state.ausgang_wecker.notify_one();
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Ausgang);
    Ok(Json(v))
}
