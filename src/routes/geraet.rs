//! Gerätekopplung (LFH-892): Verwaltung durch die Einsatzleitung und Einlösen des Codes.
//!
//! Herleitung: `openspec/changes/archive/2026-10-05-lfh-892-funktionsansichten-geraete/design.md` (D1, D3, D7).
//! Die Schranke einer Gerätesitzung steht nicht hier, sondern in `CurrentUser`
//! (`crate::geraet::darf_route`).

use crate::app::AppState;
use crate::auth::session::{self, SichererTransport, SESSION_COOKIE};
use crate::einsatz::berechtigung::gesperrt_fuer_einfaches_mitglied;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLeitungszugriff, EinsatzLesezugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::geraet::repo::{self, KopplungAnzeige, NeueKopplung};
use crate::geraet::{
    code, Funktionsansicht, GeraetAnzeige, BEZEICHNUNG_MAX, PROVIDER, STANDARD_STUNDEN,
};
use crate::uhs::UhsStatus;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Module einer Ansicht, die in diesem Einsatz einem einfachen Mitglied gesperrt sind.
#[derive(Debug, Serialize, ToSchema)]
pub struct AnsichtSperre {
    pub ansicht: Funktionsansicht,
    /// Modul-Keys, die das Gerät nicht nutzen könnte. Leer: die Ansicht ist voll nutzbar.
    pub gesperrte_module: Vec<String>,
}

/// Geräteübersicht der Einsatzleitung.
#[derive(Debug, Serialize, ToSchema)]
pub struct GeraeteUebersicht {
    pub kopplungen: Vec<KopplungAnzeige>,
    pub sperren: Vec<AnsichtSperre>,
}

/// Ein frisch ausgestellter Kopplungscode. Der Klartext verlässt den Server nur hier, einmal.
#[derive(Debug, Serialize, ToSchema)]
pub struct KopplungsCode {
    pub code: String,
    pub laeuft_ab_at: String,
}

/// Antwort auf das Anlegen und das Neuausstellen: Kopplung plus Code.
#[derive(Debug, Serialize, ToSchema)]
pub struct KopplungMitCode {
    pub kopplung: KopplungAnzeige,
    pub code: KopplungsCode,
}

/// GET /api/einsaetze/{id}/geraete — alle Kopplungen und die Modulsperren je Ansicht. Nur die
/// Einsatzleitung; auch nach Abschluss lesbar, solange der Einsatz lesbar ist.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<GeraeteUebersicht>, AppError> {
    ctx.fordere_einsatzleitung()?;
    let kopplungen = repo::liste(&state.pool, ctx.einsatz.id).await?;
    let mut sperren = Vec::new();
    for ansicht in Funktionsansicht::ALLE {
        let gesperrt = gesperrt_fuer_einfaches_mitglied(
            &state.pool,
            ctx.einsatz.id,
            ctx.einsatz.org_id,
            ansicht.lese_module(),
        )
        .await?;
        sperren.push(AnsichtSperre {
            ansicht,
            gesperrte_module: gesperrt.into_iter().map(str::to_string).collect(),
        });
    }
    Ok(Json(GeraeteUebersicht {
        kopplungen,
        sperren,
    }))
}

#[derive(Debug, Deserialize)]
pub struct NeueKopplungBody {
    pub ansicht: String,
    pub uhs_id: Option<i64>,
    pub bezeichnung: String,
    /// Ende der Kopplung (UTC, `YYYY-MM-DD HH:MM[:SS]`). Ohne Angabe [`STANDARD_STUNDEN`].
    pub laeuft_ab_at: Option<String>,
}

/// Normalisiert und prüft ein gewünschtes Ende (400 bei Form, Vergangenheit, über 72 h).
fn ende_aus(eingabe: Option<&str>) -> Result<String, AppError> {
    let jetzt = chrono::Utc::now();
    let ende = match eingabe {
        None => crate::zeit::formatiere_utc(jetzt + chrono::Duration::hours(STANDARD_STUNDEN)),
        Some(roh) => crate::zeit::normalisiere_eingabe(roh)
            .ok_or_else(|| AppError::Validation("Ungültiges Ende der Kopplung".into()))?,
    };
    repo::pruefe_ende(&ende, jetzt)?;
    Ok(ende)
}

/// POST /api/einsaetze/{id}/geraete — Kopplung anlegen und ersten Code ausstellen. Nur die
/// Einsatzleitung eines aktiven Einsatzes. Schreibt einen System-Eintrag ins ETB.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    JsonBody(body): JsonBody<NeueKopplungBody>,
) -> Result<(StatusCode, Json<KopplungMitCode>), AppError> {
    let ansicht = Funktionsansicht::parse(&body.ansicht)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Ansicht: {}", body.ansicht)))?;
    let bezeichnung = crate::routes::support::pflicht(&body.bezeichnung, "bezeichnung")?;
    if bezeichnung.chars().count() > BEZEICHNUNG_MAX {
        return Err(AppError::Validation(format!(
            "bezeichnung darf höchstens {BEZEICHNUNG_MAX} Zeichen haben"
        )));
    }
    let einsatz_id = ctx.einsatz.id;
    let stelle = match (ansicht.ist_stellengebunden(), body.uhs_id) {
        (true, None) => {
            return Err(AppError::Validation(format!(
                "{} braucht eine UHS (uhs_id)",
                ansicht.label()
            )))
        }
        (false, Some(_)) => {
            return Err(AppError::Validation(format!(
                "{} ist an keine UHS gebunden",
                ansicht.label()
            )))
        }
        (false, None) => None,
        (true, Some(uhs_id)) => {
            let uhs = crate::uhs::repo::laden(&state.pool, einsatz_id, uhs_id).await?; // 404
            if uhs.storniert_at.is_some() || uhs.status == UhsStatus::Aufgeloest {
                return Err(AppError::UnprocessableEntity(
                    "Die UHS ist storniert oder aufgelöst".into(),
                ));
            }
            Some(uhs.bezeichnung)
        }
    };
    let laeuft_ab_at = ende_aus(body.laeuft_ab_at.as_deref())?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_text = format!(
        "Gerät „{}“ als {} angelegt, Kopplung bis {} UTC.",
        repo::anzeigename(stelle.as_deref(), &bezeichnung),
        ansicht.label(),
        laeuft_ab_at
    );
    let von = ctx.benutzer.id;
    let (kopplung_id, code, code_bis, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let kopplung_id = repo::anlegen(
            conn,
            NeueKopplung {
                einsatz_id,
                org_id: ctx.einsatz.org_id,
                ansicht,
                uhs_id: body.uhs_id,
                stelle: stelle.as_deref(),
                bezeichnung: &bezeichnung,
                laeuft_ab_at: &laeuft_ab_at,
                von,
            },
        )
        .await?;
        let (code, code_bis) = repo::code_ausstellen(conn, kopplung_id, von).await?;
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &etb_text).await?;
        Ok((kopplung_id, code, code_bis, etb_id))
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    let kopplung = repo::laden(&state.pool, einsatz_id, kopplung_id).await?;
    Ok((
        StatusCode::CREATED,
        Json(KopplungMitCode {
            kopplung,
            code: KopplungsCode {
                code,
                laeuft_ab_at: code_bis,
            },
        }),
    ))
}

/// POST /api/einsaetze/{id}/geraete/{gid}/code — neuen Code ausstellen (Gerät getauscht, Browser
/// geleert). Der alte Code verfällt; beim Einlösen des neuen enden die alten Sitzungen.
pub async fn code_ausstellen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<KopplungMitCode>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    repo::laden(&state.pool, einsatz_id, kopplung_id).await?; // 404 falls fremd
    let von = ctx.benutzer.id;
    let (code, laeuft_ab_at) = crate::write_retry!(&state.pool, |conn| {
        repo::code_ausstellen(conn, kopplung_id, von).await
    })?;
    let kopplung = repo::laden(&state.pool, einsatz_id, kopplung_id).await?;
    Ok(Json(KopplungMitCode {
        kopplung,
        code: KopplungsCode { code, laeuft_ab_at },
    }))
}

#[derive(Debug, Deserialize)]
pub struct VerlaengernBody {
    pub laeuft_ab_at: String,
}

/// POST /api/einsaetze/{id}/geraete/{gid}/verlaengern — neues Ende (höchstens 72 h ab jetzt).
pub async fn verlaengern(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<VerlaengernBody>,
) -> Result<Json<KopplungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    repo::laden(&state.pool, einsatz_id, kopplung_id).await?; // 404 falls fremd
    let ende = ende_aus(Some(&body.laeuft_ab_at))?;
    let von = ctx.benutzer.id;
    crate::write_retry!(&state.pool, |conn| {
        repo::verlaengern(conn, kopplung_id, &ende, von).await
    })?;
    Ok(Json(
        repo::laden(&state.pool, einsatz_id, kopplung_id).await?,
    ))
}

/// POST /api/einsaetze/{id}/geraete/{gid}/widerrufen — das Gerät verliert sofort jeden Zugriff,
/// auch einen offenen Live-Kanal (design.md D7). Idempotent. Auch am abgeschlossenen Einsatz
/// erlaubt wäre sinnlos: dort ist jede Kopplung schon beendet, deshalb der Leitungszugriff.
pub async fn widerrufen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<KopplungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = repo::laden(&state.pool, einsatz_id, kopplung_id).await?; // 404 falls fremd
    let von = ctx.benutzer.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_text = format!(
        "Gerät „{}“ ({}) widerrufen von {}.",
        vorher.anzeigename,
        vorher.ansicht.label(),
        ctx.benutzer.anzeigename
    );
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        if repo::widerrufen(conn, kopplung_id, von).await? {
            Ok(Some(
                crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &etb_text).await?,
            ))
        } else {
            Ok(None)
        }
    })?;
    state.live.melde_kopplung_ende(kopplung_id);
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(
        repo::laden(&state.pool, einsatz_id, kopplung_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct KoppelnBody {
    pub code: String,
}

/// POST /api/geraete/koppeln — ein Gerät löst seinen Kopplungscode ein und bekommt eine
/// Gerätesitzung. Öffentlich (das Gerät hat noch keine Sitzung).
///
/// Reihenfolge wie beim App-Code (LFH-818): Sperre der Adresse (429) → Code prüfen. Jeder
/// Fehlschlag ist einheitlich 401, auch eine falsche Form, damit die Antwort nichts verrät.
/// Beide Ausgänge stehen in `auth_audit` (Anmeldeweg [`PROVIDER`]).
pub async fn koppeln(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    SichererTransport(secure): SichererTransport,
    jar: CookieJar,
    JsonBody(body): JsonBody<KoppelnBody>,
) -> Result<(CookieJar, Json<GeraetAnzeige>), AppError> {
    if let Some(ip) = peer_ip {
        if crate::auth::rate_limit::ist_gesperrt(ip) {
            return Err(AppError::TooManyRequests(
                "Zu viele fehlgeschlagene Versuche. Bitte kurz warten.".to_string(),
            ));
        }
    }
    let ip_text = peer_ip.map(|ip| ip.to_string());
    let ergebnis = match code::normalisiere(&body.code) {
        None => Err(AppError::Unauthorized),
        Some(code) => {
            crate::write_retry!(&state.pool, |conn| {
                let ein = repo::einloesen(conn, &code, ip_text.as_deref()).await?;
                let token = session::anlegen_geraet(
                    conn,
                    ein.benutzer_id,
                    ein.kopplung_id,
                    &ein.laeuft_ab_at,
                )
                .await?;
                Ok((ein, token))
            })
        }
    };
    let (ein, token) = match ergebnis {
        Ok(wert) => wert,
        Err(AppError::Unauthorized) => {
            if let Some(ip) = peer_ip {
                crate::auth::rate_limit::fehlversuch(ip, None);
            }
            tracing::warn!(peer_ip = ?peer_ip, "Gerätekopplung abgewiesen");
            crate::auth::audit::schreibe(
                &state.pool,
                crate::auth::audit::AuditEintrag {
                    ereignis: crate::auth::audit::Ereignis::LoginFehlgeschlagen,
                    benutzername: None,
                    benutzer_id: None,
                    peer_ip: ip_text.clone(),
                    provider: PROVIDER,
                },
            )
            .await;
            return Err(AppError::Unauthorized);
        }
        Err(e) => return Err(e),
    };
    if ein.alte_sitzungen > 0 {
        // Gerätetausch: der Live-Kanal des alten Geräts endet sofort.
        state.live.melde_kopplung_ende(ein.kopplung_id);
    }
    // Eine übrig gebliebene Sitzung im Browser (etwa einer Person) stünde sonst verwaist da.
    if let Some(alt) = jar.get(SESSION_COOKIE) {
        session::loeschen(&state.pool, alt.value()).await?;
    }
    let jar = jar.add(crate::routes::auth::session_cookie(token, secure));
    tracing::info!(kopplung_id = ein.kopplung_id, peer_ip = ?peer_ip, "Gerät gekoppelt");
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginOk,
            benutzername: None,
            benutzer_id: Some(ein.benutzer_id),
            peer_ip: ip_text,
            provider: PROVIDER,
        },
    )
    .await;

    let anzeige = repo::laden(&state.pool, ein.einsatz_id, ein.kopplung_id).await?;
    let etb_text = format!(
        "Gerät „{}“ ({}) gekoppelt.",
        anzeige.anzeigename,
        anzeige.ansicht.label()
    );
    // Nach dem Commit der Sitzung, nicht atomar: scheitert der Eintrag, ist das Gerät trotzdem
    // gekoppelt, und die Ereignisspur der Kopplung trägt die Einlösung.
    match crate::etb::system_audit(&state.pool, ein.einsatz_id, ein.benutzer_id, &etb_text).await {
        Ok(eintrag) => state.live.publiziere(ein.einsatz_id, eintrag.id),
        Err(e) => tracing::error!("ETB-Eintrag zur Gerätekopplung fehlgeschlagen: {e}"),
    }
    Ok((
        jar,
        Json(geraet_anzeige(&anzeige, ein.einsatz_id, ein.kopplung_id)),
    ))
}

/// Selbstsicht eines Geräts aus seiner Kopplung.
pub fn geraet_anzeige(k: &KopplungAnzeige, einsatz_id: i64, kopplung_id: i64) -> GeraetAnzeige {
    GeraetAnzeige {
        kopplung_id,
        einsatz_id,
        ansicht: k.ansicht,
        uhs_id: k.uhs_id,
        stelle: k.stelle.clone(),
        bezeichnung: k.bezeichnung.clone(),
        laeuft_ab_at: k.laeuft_ab_at.clone(),
    }
}
