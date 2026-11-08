//! Instanzkopplung (LLH-1490, Change `ckq15vzr-instanzkopplung-schluessel`): Verwaltung durch den
//! Org-Admin (`/api/admin/instanz/…`) und die Routen, die eine andere Instanz ruft
//! (`/api/instanz/…`: Einlösen öffentlich, Melden signiert). Herleitung im `design.md` der
//! Change, D2–D11.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::auth::unterschrift::pruefen::{self, UnterschriftAssertion};
use crate::auth::unterschrift::repo as unterschrift;
use crate::auth::unterschrift::zeremonie::{self, Zeremonie};
use crate::auth::unterschrift::{
    AufnahmeErklaerung, Gegenzeichnung, UnterschriftSchluesselAnzeige,
    UnterschriftSchluesselLieferung, UnterschriftSchluesselZustand, TYP_AUFNAHME,
};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::instanz::basis32::{b64, b64_lesen, fingerabdruck, sha256_b64};
use crate::instanz::code::{self as kcode, Ableitung};
use crate::instanz::extractor::{signierte_antwort, GekoppelteInstanz};
use crate::instanz::identitaet::{self, oeffentlich_lesen, Identitaet};
use crate::instanz::melden::{self, MeldenAnfrage};
use crate::instanz::repo::{self, Gegenueber, InstanzKopplungAnzeige};
use crate::instanz::signatur::{self, ANTWORT_KOPF};
use crate::instanz::{org_kennung, InstanzKopplungRichtung, InstanzKopplungZustand, PROTOKOLL};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use webauthn_rs::prelude::{
    COSEAlgorithm, COSEKeyType, CreationChallengeResponse, ECDSACurve, RegisterPublicKeyCredential,
};

/// Längste Kennung einer Instanz auf der Leitung (eine UUID hat 36 Zeichen).
const KENNUNG_MAX: usize = 64;
/// Längster Name einer Instanz oder Org auf der Leitung.
const NAME_MAX: usize = 200;
/// Längste Bezeichnung eines Unterschriftsschlüssels.
pub const BEZEICHNUNG_MAX: usize = 80;

fn identitaet_fehler(e: anyhow::Error) -> AppError {
    AppError::Internal(format!("Instanzidentität: {e}"))
}

async fn org_name(pool: &sqlx::SqlitePool, org_id: i64) -> Result<String, AppError> {
    Ok(
        sqlx::query_scalar("SELECT name FROM organisation WHERE id = ?")
            .bind(org_id)
            .fetch_optional(pool)
            .await?
            .unwrap_or_default(),
    )
}

// ── Übersicht ────────────────────────────────────────────────────────────────────────────────

/// Alles, was die Admin-Seite „Instanzkopplung“ zeigt.
#[derive(Debug, Serialize, ToSchema)]
pub struct InstanzUebersicht {
    pub name: String,
    pub kennung: String,
    pub fingerabdruck: String,
    pub protokoll: u32,
    pub softwarestand: String,
    /// Passkeys sind eingerichtet (`--webauthn-rp-id`); ohne sie gibt es keine
    /// Unterschriftsschlüssel und damit keinen Kopplungscode.
    pub passkeys_eingerichtet: bool,
    /// Der anfragende Admin hat einen gültigen Unterschriftsschlüssel (Voraussetzung für
    /// „Code ausstellen“).
    pub eigener_schluessel: bool,
    pub kopplungen: Vec<InstanzKopplungAnzeige>,
    pub schluessel: Vec<UnterschriftSchluesselAnzeige>,
}

/// GET /api/admin/instanz — Identität dieser Instanz, Kopplungen und Unterschriftsschlüssel der
/// eigenen Org. Lesen darf, wer die Verwaltung sieht (wie die Lagemonitore); handeln nur der
/// Admin.
pub async fn uebersicht(
    State(state): State<AppState>,
    CurrentUser(admin): CurrentUser,
) -> Result<Json<InstanzUebersicht>, AppError> {
    if !admin.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let i = identitaet::laden_oder_erzeugen(&state.pool)
        .await
        .map_err(identitaet_fehler)?;
    let eigener = {
        let mut conn = state.pool.acquire().await?;
        !unterschrift::gueltige_eigene(&mut conn, admin.id)
            .await?
            .is_empty()
    };
    Ok(Json(InstanzUebersicht {
        name: crate::instanz::name().to_string(),
        kennung: i.kennung.clone(),
        fingerabdruck: i.fingerabdruck(),
        protokoll: PROTOKOLL,
        softwarestand: crate::instanz::softwarestand().to_string(),
        passkeys_eingerichtet: crate::auth::unterschrift::rp().is_some(),
        eigener_schluessel: eigener,
        kopplungen: repo::liste_fuer_org(&state.pool, admin.org_id).await?,
        schluessel: unterschrift::liste_fuer_org(&state.pool, admin.org_id, admin.id).await?,
    }))
}

// ── Code ausstellen ──────────────────────────────────────────────────────────────────────────

/// Ein frisch ausgestellter Kopplungscode. Der Code verlässt den Server nur hier, einmal.
#[derive(Debug, Serialize, ToSchema)]
pub struct KopplungscodeAntwort {
    /// In Vierergruppen, z. B. `ABCD-EFGH-JKMN-PQRS`.
    pub code: String,
    pub laeuft_ab_at: String,
    /// Fingerabdruck dieser Instanz zum Abgleich an der einlösenden Seite.
    pub fingerabdruck: String,
}

/// POST /api/admin/instanz/codes — stellt einen Kopplungscode für die Org des Admins aus. Nur mit
/// eigenem gültigem Unterschriftsschlüssel (409), damit die gekoppelte Instanz mindestens einen
/// Admin-Schlüssel der Org kennt (Spec `instanz-kopplung`).
pub async fn code_ausstellen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
) -> Result<(StatusCode, Json<KopplungscodeAntwort>), AppError> {
    {
        let mut conn = state.pool.acquire().await?;
        if unterschrift::gueltige_eigene(&mut conn, admin.id)
            .await?
            .is_empty()
        {
            return Err(AppError::Conflict(
                "Bitte zuerst einen eigenen Unterschriftsschlüssel registrieren: eine gekoppelte \
                 Instanz muss mindestens einen Admin-Schlüssel der Organisation kennen."
                    .into(),
            ));
        }
    }
    let i = identitaet::laden_oder_erzeugen(&state.pool)
        .await
        .map_err(identitaet_fehler)?;
    let code = kcode::neu();
    let ableitung = kcode::ableiten(&code);
    let laeuft_ab_at = crate::zeit::plus_minuten(&crate::zeit::jetzt(), kcode::GUELTIG_MINUTEN)
        .ok_or_else(|| AppError::Internal("Zeit".into()))?;
    repo::code_ausstellen(
        &state.pool,
        admin.org_id,
        &ableitung,
        admin.id,
        &laeuft_ab_at,
    )
    .await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::InstanzCodeAusgestellt,
            akteur: &admin,
            ziel: Ziel::Instanz("Kopplungscode"),
            angaben: None,
            peer_ip,
        },
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(KopplungscodeAntwort {
            code: kcode::anzeige(&code),
            laeuft_ab_at,
            fingerabdruck: i.fingerabdruck(),
        }),
    ))
}

// ── Einlösen ─────────────────────────────────────────────────────────────────────────────────

/// Eine Org auf der Leitung.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgLeitung {
    pub kennung: String,
    pub name: String,
}

/// Body von `POST /api/instanz/koppeln` (design.md D2). Der Code selbst ist nicht dabei.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KoppelnAnfrage {
    pub suche: String,
    pub jti: String,
    pub protokoll: u32,
    pub kennung: String,
    pub schluessel: String,
    pub name: String,
    pub softwarestand: String,
    pub org: OrgLeitung,
    pub pruefwert: String,
}

/// Antwort auf `POST /api/instanz/koppeln`, zusätzlich signiert (Kopf [`ANTWORT_KOPF`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KoppelnAntwort {
    pub kennung: String,
    pub schluessel: String,
    pub name: String,
    pub softwarestand: String,
    pub protokoll: u32,
    pub org: OrgLeitung,
    pub unterschrift: Vec<UnterschriftSchluesselLieferung>,
    pub pruefwert: String,
}

fn zu_lang(text: &str, max: usize) -> bool {
    text.is_empty() || text.chars().count() > max
}

/// POST /api/instanz/koppeln — eine andere Instanz löst einen Kopplungscode dieser Instanz ein.
/// Öffentlich (das Gegenüber ist noch nicht bekannt). Reihenfolge wie bei der Gerätekopplung:
/// Sperre der Adresse (429), dann prüfen; jeder Fehlschlag ist einheitlich 401.
pub async fn koppeln(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    JsonBody(a): JsonBody<KoppelnAnfrage>,
) -> Result<Response, AppError> {
    if let Some(ip) = peer_ip {
        if crate::auth::rate_limit::ist_gesperrt(ip) {
            return Err(AppError::TooManyRequests(
                "Zu viele fehlgeschlagene Versuche. Bitte kurz warten.".to_string(),
            ));
        }
    }
    let i = identitaet::laden_oder_erzeugen(&state.pool)
        .await
        .map_err(identitaet_fehler)?;
    let ergebnis = koppeln_pruefen(&state, &i, &a).await;
    let (org_id, antwort) = match ergebnis {
        Ok(wert) => wert,
        // Nach außen einheitlich 401, auch bei einem Konflikt mit einer bestehenden Kopplung.
        Err(AppError::Unauthorized | AppError::Conflict(_)) => {
            if let Some(ip) = peer_ip {
                crate::auth::rate_limit::fehlversuch(ip, None);
            }
            tracing::warn!(peer_ip = ?peer_ip, "Instanzkopplung abgewiesen");
            return Err(AppError::Unauthorized);
        }
        Err(e) => return Err(e),
    };
    let fp = b64_lesen(&a.schluessel)
        .map(|b| fingerabdruck(&b))
        .unwrap_or_default();
    admin_audit::schreibe_ohne_akteur(
        &state.pool,
        AdminAktion::InstanzCodeEingeloest,
        org_id,
        &a.name,
        Ziel::Instanz(&a.name),
        Some(ZugangsAngaben {
            instanz_kennung: Some(a.kennung.clone()),
            fingerabdruck: Some(fp),
            fremde_org: Some(a.org.name.clone()),
            ..ZugangsAngaben::default()
        }),
        peer_ip,
    )
    .await;
    Ok(signierte_antwort(
        &i,
        &a.kennung,
        &a.jti,
        StatusCode::OK,
        &antwort,
    ))
}

async fn koppeln_pruefen(
    state: &AppState,
    i: &Identitaet,
    a: &KoppelnAnfrage,
) -> Result<(i64, KoppelnAntwort), AppError> {
    if zu_lang(&a.kennung, KENNUNG_MAX)
        || zu_lang(&a.name, NAME_MAX)
        || zu_lang(&a.org.kennung, KENNUNG_MAX + 24)
        || zu_lang(&a.org.name, NAME_MAX)
        || a.softwarestand.chars().count() > 64
        || zu_lang(&a.jti, 64)
        || a.kennung == i.kennung
        || oeffentlich_lesen(&a.schluessel).is_none()
    {
        return Err(AppError::Unauthorized);
    }
    let jetzt = crate::zeit::jetzt();
    let transkript_e = kcode::transkript_einloeser(
        &a.suche,
        &a.kennung,
        &a.schluessel,
        &a.org.kennung,
        &a.org.name,
        &a.name,
        &a.jti,
    );
    let (org_id, unterschrift, k_aussteller) = crate::write_retry!(&state.pool, |conn| {
        let Some(code) = repo::code_offen(conn, &a.suche, &jetzt).await? else {
            return Err(AppError::Unauthorized);
        };
        if !kcode::pruefwert_stimmt(&code.k_einloeser, &transkript_e, &a.pruefwert) {
            return Err(AppError::Unauthorized);
        }
        if !repo::code_verbrauchen(conn, &a.suche, &jetzt).await? {
            return Err(AppError::Unauthorized);
        }
        let kopplung_id = repo::kopplung_anlegen_oder_erneuern(
            conn,
            &Gegenueber {
                kennung: &a.kennung,
                schluessel_b64: &a.schluessel,
                name: &a.name,
                softwarestand: &a.softwarestand,
                protokoll: a.protokoll,
            },
            InstanzKopplungRichtung::WirdGemeldet,
            None,
            InstanzKopplungZustand::Angebahnt,
            &jetzt,
        )
        .await?;
        repo::org_zuordnen(
            conn,
            kopplung_id,
            code.org_id,
            &a.org.kennung,
            &a.org.name,
            code.ausgestellt_von,
            false,
        )
        .await?;
        let (lieferung, _) = unterschrift::grundstock(conn, code.org_id).await?;
        Ok((code.org_id, lieferung, code.k_aussteller))
    })?;
    let schluessel = i.oeffentlich_b64();
    let pruefwert = kcode::pruefwert(
        &k_aussteller,
        &kcode::transkript_aussteller(&transkript_e, &i.kennung, &schluessel),
    );
    Ok((
        org_id,
        KoppelnAntwort {
            kennung: i.kennung.clone(),
            schluessel,
            name: crate::instanz::name().to_string(),
            softwarestand: crate::instanz::softwarestand().to_string(),
            protokoll: PROTOKOLL,
            org: OrgLeitung {
                kennung: org_kennung(&i.kennung, org_id),
                name: org_name(&state.pool, org_id).await?,
            },
            unterschrift,
            pruefwert,
        },
    ))
}

#[derive(Debug, Deserialize)]
pub struct EinloesenBody {
    pub adresse: String,
    pub code: String,
}

/// POST /api/admin/instanz/einloesen — koppelt diese Instanz mit dem Code einer anderen. Die
/// Org des Admins wird an die Org des Ausstellers gebunden; danach meldet sich diese Instanz
/// sofort.
pub async fn einloesen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<EinloesenBody>,
) -> Result<(StatusCode, Json<InstanzKopplungAnzeige>), AppError> {
    let code = kcode::normalisiere(&body.code).ok_or_else(|| {
        AppError::Validation("Der Code hat 16 Zeichen, etwa ABCD-EFGH-JKMN-PQRS.".into())
    })?;
    let adresse = melden::adresse_normalisieren(&body.adresse)?;
    let i = identitaet::laden_oder_erzeugen(&state.pool)
        .await
        .map_err(identitaet_fehler)?;
    let ableitung = kcode::ableiten(&code);
    let eigene_org = OrgLeitung {
        kennung: org_kennung(&i.kennung, admin.org_id),
        name: org_name(&state.pool, admin.org_id).await?,
    };
    let antwort = einloesen_senden(&i, &adresse, &ableitung, &eigene_org).await?;
    if antwort.kennung == i.kennung {
        return Err(AppError::UnprocessableEntity(
            "Eine Instanz kann sich nicht mit sich selbst koppeln.".into(),
        ));
    }

    let jetzt = crate::zeit::jetzt();
    let (kopplung_id, abgelehnt) = crate::write_retry!(&state.pool, |conn| {
        let kopplung_id = repo::kopplung_anlegen_oder_erneuern(
            conn,
            &Gegenueber {
                kennung: &antwort.kennung,
                schluessel_b64: &antwort.schluessel,
                name: &antwort.name,
                softwarestand: &antwort.softwarestand,
                protokoll: antwort.protokoll,
            },
            InstanzKopplungRichtung::MeldetSich,
            Some(&adresse),
            InstanzKopplungZustand::Aktiv,
            &jetzt,
        )
        .await?;
        let org_zeile = repo::org_zuordnen(
            conn,
            kopplung_id,
            admin.org_id,
            &antwort.org.kennung,
            &antwort.org.name,
            Some(admin.id),
            true,
        )
        .await?;
        let ziel = unterschrift::Ziel {
            kopplung_org_id: org_zeile,
            org_id: admin.org_id,
            fremde_org_kennung: &antwort.org.kennung,
        };
        let abgelehnt =
            unterschrift::annehmen(conn, &ziel, &antwort.unterschrift, true, &jetzt).await?;
        Ok((kopplung_id, abgelehnt))
    })?;
    if !abgelehnt.is_empty() {
        tracing::warn!(
            ?abgelehnt,
            "Grundstock enthielt nicht unterstützte Schlüssel"
        );
    }
    let kopplung = repo::kopplung_laden(&state.pool, kopplung_id).await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::InstanzGekoppelt,
            akteur: &admin,
            ziel: Ziel::Instanz(&antwort.name),
            angaben: Some(melden::angaben_gegenstelle(&kopplung, &antwort.org.name)),
            peer_ip,
        },
    )
    .await;
    // Die erste Meldung macht die Kopplung beim Aussteller aktiv.
    melden::melden_einmal(&state.pool, &kopplung).await?;
    Ok((
        StatusCode::CREATED,
        Json(repo::anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?),
    ))
}

/// Schickt die Einlöse-Anfrage und prüft die Antwort: Prüfwert des Ausstellers (bindet dessen
/// Schlüssel an den Code) und die Signatur der Antwort mit genau diesem Schlüssel.
async fn einloesen_senden(
    i: &Identitaet,
    adresse: &str,
    ableitung: &Ableitung,
    eigene_org: &OrgLeitung,
) -> Result<KoppelnAntwort, AppError> {
    let schluessel = i.oeffentlich_b64();
    let jti = signatur::neue_jti();
    let transkript_e = kcode::transkript_einloeser(
        &ableitung.suche,
        &i.kennung,
        &schluessel,
        &eigene_org.kennung,
        &eigene_org.name,
        crate::instanz::name(),
        &jti,
    );
    let anfrage = KoppelnAnfrage {
        suche: ableitung.suche.clone(),
        jti: jti.clone(),
        protokoll: PROTOKOLL,
        kennung: i.kennung.clone(),
        schluessel,
        name: crate::instanz::name().to_string(),
        softwarestand: crate::instanz::softwarestand().to_string(),
        org: eigene_org.clone(),
        pruefwert: kcode::pruefwert(&ableitung.k_einloeser, &transkript_e),
    };
    let unerreichbar = |e: String| {
        AppError::BadGateway(format!(
            "Die Instanz unter {adresse} ist nicht erreichbar: {e}"
        ))
    };
    let resp = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .post(format!("{adresse}/api/instanz/koppeln"))
        .json(&anfrage)
        .send()
        .await
        .map_err(|e| unerreichbar(e.without_url().to_string()))?;
    let status = resp.status();
    let token = resp
        .headers()
        .get(ANTWORT_KOPF)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rumpf = crate::http_begrenzt::lies_begrenzt(resp, melden::ANTWORT_MAX)
        .await
        .map_err(|e| unerreichbar(e.to_string()))?;
    match status.as_u16() {
        200 => {}
        401 => {
            return Err(AppError::UnprocessableEntity(
                "Der Code ist ungültig, abgelaufen oder schon eingelöst.".into(),
            ))
        }
        429 => {
            return Err(AppError::TooManyRequests(
                "Die andere Instanz lehnt gerade weitere Versuche ab. Bitte kurz warten.".into(),
            ))
        }
        s => return Err(unerreichbar(format!("Antwort {s}"))),
    }
    let nicht_vertrauenswuerdig = |grund: &str| {
        tracing::warn!(
            adresse,
            grund,
            "Antwort beim Einlösen nicht vertrauenswürdig"
        );
        AppError::BadGateway(format!(
            "Die Antwort von {adresse} ist nicht vertrauenswürdig ({grund}). Steht zwischen den \
             Instanzen etwas, das die Verbindung verändert?"
        ))
    };
    let a: KoppelnAntwort =
        serde_json::from_slice(&rumpf).map_err(|_| nicht_vertrauenswuerdig("Antwort unlesbar"))?;
    let transkript_a = kcode::transkript_aussteller(&transkript_e, &a.kennung, &a.schluessel);
    if !kcode::pruefwert_stimmt(&ableitung.k_aussteller, &transkript_a, &a.pruefwert) {
        return Err(nicht_vertrauenswuerdig("Prüfwert stimmt nicht"));
    }
    let schluessel_a =
        oeffentlich_lesen(&a.schluessel).ok_or_else(|| nicht_vertrauenswuerdig("Schlüssel"))?;
    let token = token.ok_or_else(|| nicht_vertrauenswuerdig("ohne Signatur"))?;
    signatur::antwort_pruefen(
        &token,
        &schluessel_a,
        &a.kennung,
        &i.kennung,
        &jti,
        200,
        &rumpf,
        chrono::Utc::now().timestamp(),
    )
    .map_err(|e| nicht_vertrauenswuerdig(&e.to_string()))?;
    Ok(a)
}

// ── Melden ───────────────────────────────────────────────────────────────────────────────────

/// POST /api/instanz/melden — eine gekoppelte Instanz meldet sich (signiert, design.md D4).
pub async fn melden(
    State(state): State<AppState>,
    anfrage: GekoppelteInstanz,
) -> Result<Response, AppError> {
    let body: MeldenAnfrage = anfrage.json()?;
    let antwort =
        melden::beantworten(&state.pool, &anfrage.identitaet, &anfrage.kopplung, &body).await?;
    Ok(anfrage.antwort(StatusCode::OK, &antwort))
}

// ── Widerruf ─────────────────────────────────────────────────────────────────────────────────

/// POST /api/admin/instanz/kopplungen/{id}/widerrufen — nimmt die Org des Admins aus der Kopplung.
/// Ohne Org-Zuordnung gilt die Kopplung als widerrufen. Meldet sich diese Instanz beim Gegenüber,
/// geht der Widerruf sofort signiert hinaus; sonst erfährt das Gegenüber ihn bei seiner nächsten
/// Meldung. Idempotent.
pub async fn widerrufen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(kopplung_id): PfadParam<i64>,
) -> Result<Json<InstanzKopplungAnzeige>, AppError> {
    let vorher = repo::anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?; // 404
    let jetzt = crate::zeit::jetzt();
    let widerrufen = crate::write_retry!(&state.pool, |conn| {
        let Some(o) = repo::orgs_aktiv(conn, kopplung_id)
            .await?
            .into_iter()
            .find(|o| o.org_id == admin.org_id)
        else {
            return Ok(false);
        };
        let w = repo::org_widerrufen(conn, o.id, Some(admin.id), &jetzt, false).await?;
        repo::zustand_nach_orgs(conn, kopplung_id, InstanzKopplungZustand::Widerrufen).await?;
        Ok(w)
    })?;
    if widerrufen {
        let kopplung = repo::kopplung_laden(&state.pool, kopplung_id).await?;
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::InstanzKopplungWiderrufen,
                akteur: &admin,
                ziel: Ziel::Instanz(&kopplung.gegenueber_name),
                angaben: Some(melden::angaben_gegenstelle(
                    &kopplung,
                    &vorher.org.fremde_org_name,
                )),
                peer_ip,
            },
        )
        .await;
        if kopplung.richtung() == Some(InstanzKopplungRichtung::MeldetSich) {
            melden::melden_einmal(&state.pool, &kopplung).await?;
        }
    }
    Ok(Json(
        repo::anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?,
    ))
}

// ── Unterschriftsschlüssel ───────────────────────────────────────────────────────────────────

fn passkeys_fehlen() -> AppError {
    AppError::NotImplemented(
        "Passkeys sind an dieser Instanz nicht eingerichtet (LIFELINE_WEBAUTHN_RP_ID und \
         LIFELINE_WEBAUTHN_RP_ORIGIN)."
            .into(),
    )
}

fn zeremonie_voll(_: crate::auth::ablauf_speicher::Voll) -> AppError {
    AppError::ServiceUnavailable("Gerade laufen zu viele Vorgänge. Bitte kurz warten.".into())
}

#[derive(Debug, Deserialize)]
pub struct RegistrierenStartBody {
    pub bezeichnung: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterschriftRegistrierenStart {
    pub zeremonie: String,
    /// Optionen für `navigator.credentials.create` (`publicKey`).
    #[schema(value_type = Object)]
    pub optionen: CreationChallengeResponse,
}

/// POST /api/admin/instanz/unterschrift/registrieren/start — beginnt die Registrierung eines
/// Unterschriftsschlüssels. Eigener, zufälliger User-Handle je Schlüssel: der Anmeldeweg findet
/// ihn nie (design.md D7).
pub async fn registrieren_start(
    AdminUser(admin): AdminUser,
    JsonBody(body): JsonBody<RegistrierenStartBody>,
) -> Result<Json<UnterschriftRegistrierenStart>, AppError> {
    let bezeichnung =
        crate::routes::support::pflicht_max(&body.bezeichnung, "bezeichnung", BEZEICHNUNG_MAX)?;
    crate::auth::unterschrift::rp().ok_or_else(passkeys_fehlen)?;
    let webauthn = crate::auth::webauthn::webauthn().ok_or_else(passkeys_fehlen)?;
    let (optionen, zustand) = webauthn
        .start_passkey_registration(
            uuid::Uuid::new_v4(),
            &format!("{} (Unterschrift)", admin.benutzername),
            &format!("Unterschrift {}", admin.anzeigename),
            None,
        )
        .map_err(|e| AppError::Internal(format!("Registrierung konnte nicht starten: {e}")))?;
    let zeremonie = zeremonie::ablegen(Zeremonie::Registrierung {
        benutzer_id: admin.id,
        bezeichnung,
        zustand,
    })
    .map_err(zeremonie_voll)?;
    Ok(Json(UnterschriftRegistrierenStart {
        zeremonie,
        optionen,
    }))
}

#[derive(Debug, Deserialize)]
pub struct RegistrierenAbschlussBody {
    pub zeremonie: String,
    pub antwort: RegisterPublicKeyCredential,
}

/// POST /api/admin/instanz/unterschrift/registrieren/abschluss — schließt die Registrierung ab.
/// Nur ES256 (P-256); ein RSA-Passkey wird mit 422 abgelehnt.
pub async fn registrieren_abschluss(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<RegistrierenAbschlussBody>,
) -> Result<(StatusCode, Json<UnterschriftSchluesselAnzeige>), AppError> {
    let (rp_id, origin) = crate::auth::unterschrift::rp().ok_or_else(passkeys_fehlen)?;
    let webauthn = crate::auth::webauthn::webauthn().ok_or_else(passkeys_fehlen)?;
    let Some(Zeremonie::Registrierung {
        bezeichnung,
        zustand,
        ..
    }) = zeremonie::entnehmen(&body.zeremonie, admin.id)
    else {
        return Err(AppError::Validation(
            "Registrierung abgelaufen oder unbekannt".into(),
        ));
    };
    let passkey = webauthn
        .finish_passkey_registration(&body.antwort, &zustand)
        .map_err(|e| AppError::Validation(format!("Registrierung abgelehnt: {e}")))?;
    let schluessel = es256_punkt(&passkey).ok_or_else(|| {
        AppError::UnprocessableEntity(
            "Dieser Passkey nutzt ein Verfahren, das für Unterschriften nicht unterstützt wird \
             (nur ES256). Bitte einen anderen Passkey wählen."
                .into(),
        )
    })?;
    let credential_id = b64(passkey.cred_id().as_ref());
    let id = crate::write_retry!(&state.pool, |conn| {
        unterschrift::anlegen_lokal(
            conn,
            &unterschrift::NeuerSchluessel {
                org_id: admin.org_id,
                benutzer_id: admin.id,
                benutzer_name: &admin.anzeigename,
                credential_id: &credential_id,
                schluessel: &schluessel,
                rp_id,
                origin,
                bezeichnung: &bezeichnung,
            },
        )
        .await
    })?;
    let anzeige = unterschrift::anzeige(&state.pool, admin.org_id, admin.id, id).await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::UnterschriftRegistriert,
            akteur: &admin,
            ziel: Ziel::Unterschrift(&format!("{} · {}", admin.anzeigename, bezeichnung)),
            angaben: Some(ZugangsAngaben {
                fingerabdruck: Some(anzeige.fingerabdruck.clone()),
                ..ZugangsAngaben::default()
            }),
            peer_ip,
        },
    )
    .await;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// Der öffentliche Schlüssel eines ES256-Passkeys als unkomprimierter SEC1-Punkt (Base64url).
fn es256_punkt(passkey: &webauthn_rs::prelude::Passkey) -> Option<String> {
    let k = passkey.get_public_key();
    if k.type_ != COSEAlgorithm::ES256 {
        return None;
    }
    let COSEKeyType::EC_EC2(ec) = &k.key else {
        return None;
    };
    if ec.curve != ECDSACurve::SECP256R1 || ec.x.len() != 32 || ec.y.len() != 32 {
        return None;
    }
    let mut punkt = Vec::with_capacity(65);
    punkt.push(0x04);
    punkt.extend_from_slice(&ec.x);
    punkt.extend_from_slice(&ec.y);
    Some(b64(&punkt))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterschriftGegenzeichnenStart {
    pub zeremonie: String,
    /// Challenge für `navigator.credentials.get` (Base64url): SHA-256 der Erklärung.
    pub challenge: String,
    pub rp_id: String,
    /// Die eigenen gültigen Unterschriftsschlüssel (Base64url), für `allowCredentials`.
    pub credential_ids: Vec<String>,
    /// Die Erklärung im Wortlaut, zur Anzeige.
    pub erklaerung: String,
}

/// POST /api/admin/instanz/unterschrift/{id}/gegenzeichnen/start — bildet die Erklärung, mit der
/// der Admin einen wartenden Schlüssel seiner Org gegenzeichnet. Die Challenge entsteht hier, nie
/// im Browser.
pub async fn gegenzeichnen_start(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<UnterschriftGegenzeichnenStart>, AppError> {
    let (rp_id, _) = crate::auth::unterschrift::rp().ok_or_else(passkeys_fehlen)?;
    let i = identitaet::laden_oder_erzeugen(&state.pool)
        .await
        .map_err(identitaet_fehler)?;
    let (ziel, eigene) = {
        let mut conn = state.pool.acquire().await?;
        (
            unterschrift::laden(&mut conn, admin.org_id, id).await?,
            unterschrift::gueltige_eigene(&mut conn, admin.id).await?,
        )
    };
    if ziel.herkunft != "lokal"
        || ziel.zustand() != UnterschriftSchluesselZustand::WartetAufGegenzeichnung
    {
        return Err(AppError::Conflict(
            "Dieser Schlüssel wartet nicht auf eine Gegenzeichnung.".into(),
        ));
    }
    if eigene.is_empty() {
        return Err(AppError::Conflict(
            "Gegenzeichnen kann nur, wer selbst einen gültigen Unterschriftsschlüssel hat.".into(),
        ));
    }
    let schluessel_bytes =
        b64_lesen(&ziel.schluessel).ok_or_else(|| AppError::Internal("Schlüssel".into()))?;
    let erklaerung = serde_json::to_string(&AufnahmeErklaerung {
        typ: TYP_AUFNAHME.into(),
        org: org_kennung(&i.kennung, admin.org_id),
        credential_id: ziel.credential_id.clone(),
        schluessel_hash: sha256_b64(&schluessel_bytes),
        fingerabdruck: ziel.fingerabdruck.clone(),
        inhaber: ziel.benutzer_name.clone(),
        zeitpunkt: crate::zeit::jetzt(),
        rp_id: ziel.rp_id.clone(),
        origin: ziel.origin.clone(),
        alg: ziel.alg.clone(),
    })
    .expect("serialisierbar");
    let challenge = pruefen::challenge(&erklaerung);
    let zeremonie = zeremonie::ablegen(Zeremonie::Gegenzeichnung {
        benutzer_id: admin.id,
        ziel_id: id,
        erklaerung: erklaerung.clone(),
    })
    .map_err(zeremonie_voll)?;
    Ok(Json(UnterschriftGegenzeichnenStart {
        zeremonie,
        challenge,
        rp_id: rp_id.to_string(),
        credential_ids: eigene.into_iter().map(|e| e.credential_id).collect(),
        erklaerung,
    }))
}

#[derive(Debug, Deserialize)]
pub struct GegenzeichnenAbschlussBody {
    pub zeremonie: String,
    pub assertion: UnterschriftAssertion,
}

/// POST /api/admin/instanz/unterschrift/{id}/gegenzeichnen/abschluss — prüft die Unterschrift
/// des Admins über die Erklärung mit einem seiner gültigen Schlüssel und macht den neuen gültig.
pub async fn gegenzeichnen_abschluss(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<GegenzeichnenAbschlussBody>,
) -> Result<Json<UnterschriftSchluesselAnzeige>, AppError> {
    let Some(Zeremonie::Gegenzeichnung {
        ziel_id,
        erklaerung,
        ..
    }) = zeremonie::entnehmen(&body.zeremonie, admin.id)
    else {
        return Err(AppError::Validation(
            "Gegenzeichnung abgelaufen oder unbekannt".into(),
        ));
    };
    if ziel_id != id {
        return Err(AppError::Validation(
            "Gegenzeichnung gehört zu einem anderen Schlüssel".into(),
        ));
    }
    let mut conn = state.pool.acquire().await?;
    let eigene = unterschrift::gueltige_eigene(&mut conn, admin.id).await?;
    drop(conn);
    let unterzeichner = eigene
        .iter()
        .find(|e| e.credential_id == body.assertion.credential_id)
        .ok_or_else(|| {
            AppError::UnprocessableEntity(
                "Unterschrieben mit einem Schlüssel, der kein gültiger eigener ist.".into(),
            )
        })?;
    pruefen::pruefe(
        &erklaerung,
        &body.assertion,
        &unterzeichner.pruef_schluessel(),
    )
    .map_err(|f| AppError::UnprocessableEntity(format!("Unterschrift ungültig: {f}")))?;
    let gegenzeichnung = Gegenzeichnung {
        erklaerung,
        assertion: body.assertion.clone(),
        unterzeichner_credential_id: unterzeichner.credential_id.clone(),
    };
    crate::write_retry!(&state.pool, |conn| {
        unterschrift::gegenzeichnung_speichern(conn, admin.org_id, id, &gegenzeichnung).await
    })?;
    let anzeige = unterschrift::anzeige(&state.pool, admin.org_id, admin.id, id).await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::UnterschriftGegengezeichnet,
            akteur: &admin,
            ziel: Ziel::Unterschrift(&format!(
                "{} · {}",
                anzeige.benutzer_name, anzeige.bezeichnung
            )),
            angaben: Some(ZugangsAngaben {
                fingerabdruck: Some(anzeige.fingerabdruck.clone()),
                ..ZugangsAngaben::default()
            }),
            peer_ip,
        },
    )
    .await;
    Ok(Json(anzeige))
}

/// POST /api/admin/instanz/unterschrift/{id}/widerrufen — widerruft einen lokalen
/// Unterschriftsschlüssel der Org. Der letzte gültige einer Org, die ihre Schlüssel an eine
/// gekoppelte Instanz verteilt, bleibt (409). Idempotent.
pub async fn unterschrift_widerrufen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<UnterschriftSchluesselAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let (wirkung, zeile) = crate::write_retry!(&state.pool, |conn| {
        let zeile = unterschrift::laden(conn, admin.org_id, id).await?;
        if zeile.herkunft != "lokal" {
            return Err(AppError::UnprocessableEntity(
                "Schlüssel einer gekoppelten Instanz widerruft diese selbst.".into(),
            ));
        }
        if zeile.zustand() != UnterschriftSchluesselZustand::Widerrufen
            && unterschrift::ist_letzter_bei_kopplung(conn, admin.org_id, id).await?
        {
            return Err(AppError::Conflict(
                "Das ist der letzte gültige Unterschriftsschlüssel der Organisation, und eine \
                 gekoppelte Instanz verlässt sich auf ihn. Erst einen weiteren registrieren und \
                 gegenzeichnen oder die Kopplungen widerrufen."
                    .into(),
            ));
        }
        let w = unterschrift::widerrufen(conn, admin.org_id, id, &jetzt).await?;
        Ok((w, zeile))
    })?;
    if wirkung {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::UnterschriftWiderrufen,
                akteur: &admin,
                ziel: Ziel::Unterschrift(&format!(
                    "{} · {}",
                    zeile.benutzer_name, zeile.bezeichnung
                )),
                angaben: Some(ZugangsAngaben {
                    fingerabdruck: Some(zeile.fingerabdruck.clone()),
                    ..ZugangsAngaben::default()
                }),
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(
        unterschrift::anzeige(&state.pool, admin.org_id, admin.id, id).await?,
    ))
}
