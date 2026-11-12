//! Instanzkopplung (LLH-1490, Herleitung
//! `openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`): Verwaltung durch den
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
    AufnahmeErklaerung, Gegenzeichnung, LetzterSchluesselHalter, UnterschriftSchluesselAnzeige,
    UnterschriftSchluesselLieferung, UnterschriftSchluesselZustand, TYP_AUFNAHME,
};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::instanz::basis32::{b64, fingerabdruck, parse_b64, sha256_b64};
use crate::instanz::code::{self as kcode, Ableitung};
use crate::instanz::extractor::{signed_antwort, GekoppelteInstanz};
use crate::instanz::identitaet::{self, parse_oeffentlich, Identitaet};
use crate::instanz::melden::{self, MeldenAnfrage};
use crate::instanz::repo::{self, Gegenueber, InstanzKopplungAnzeige};
use crate::instanz::signatur::{self, ANTWORT_KOPF};
use crate::instanz::{
    org_kennung, zertifikat, InstanzKopplungArt, InstanzKopplungRichtung, InstanzKopplungZustand,
    PROTOKOLL, PROTOKOLL_VOR_ORT,
};
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

fn identitaet_error(e: anyhow::Error) -> AppError {
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
    /// Diese Instanz spricht selbst TLS (`--tls`): Voraussetzung für einen Code der Art „vor Ort“
    /// (LLH-1497, design.md D3).
    pub tls_eigen: bool,
    /// Die LAN-Entdeckung ist eingeschaltet (`--lan-entdeckung`, design.md D6).
    pub lan_entdeckung: bool,
    /// Der anfragende Admin hat einen gültigen Unterschriftsschlüssel (Voraussetzung für
    /// „Code ausstellen“).
    pub eigener_schluessel: bool,
    /// Der Betreiber hat die Datenträgerverschlüsselung bestätigt
    /// (`--datentraeger-verschluesselung-extern`); ohne sie bekommt diese Instanz keine
    /// Kontogeheimnisse (LLH-1493, D6).
    pub datentraeger_bestaetigt: bool,
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
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(identitaet_error)?;
    let eigener = {
        let mut conn = state.pool.acquire().await?;
        !unterschrift::list_gueltige_eigene(&mut conn, admin.id)
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
        tls_eigen: identitaet::load_tls_zertifikat(&state.pool)
            .await?
            .is_some(),
        lan_entdeckung: crate::instanz::entdeckung::is_an(&state.pool).await?,
        eigener_schluessel: eigener,
        datentraeger_bestaetigt: crate::instanz::stammdaten::geheimnis::is_datentraeger_bestaetigt(
            &state.pool,
        )
        .await?,
        kopplungen: repo::list_fuer_org(&state.pool, admin.org_id).await?,
        schluessel: unterschrift::list_fuer_org(&state.pool, admin.org_id, admin.id).await?,
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
    /// Art der Kopplung, die der Code stiftet (LLH-1497).
    pub art: InstanzKopplungArt,
}

/// Body von `POST /api/admin/instanz/codes`; ohne Body eine Standardkopplung.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct CodeAusstellenBody {
    /// `vor_ort` für eine Direktkopplung zweier Instanzen im selben Netz (LLH-1497).
    #[serde(default)]
    pub art: Option<String>,
}

/// POST /api/admin/instanz/codes — stellt einen Kopplungscode für die Org des Admins aus. Nur mit
/// eigenem gültigem Unterschriftsschlüssel (409), damit die gekoppelte Instanz mindestens einen
/// Admin-Schlüssel der Org kennt (Spec `instanz-kopplung`).
pub async fn code_ausstellen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    rumpf: axum::body::Bytes,
) -> Result<(StatusCode, Json<KopplungscodeAntwort>), AppError> {
    let body: CodeAusstellenBody = if rumpf.iter().all(u8::is_ascii_whitespace) {
        CodeAusstellenBody::default()
    } else {
        serde_json::from_slice(&rumpf)
            .map_err(|_| AppError::Validation("Ungültiger Body.".into()))?
    };
    let art = match body.art.as_deref() {
        None => InstanzKopplungArt::Standard,
        Some(a) => InstanzKopplungArt::parse(a)
            .ok_or_else(|| AppError::Validation("Unbekannte Art der Kopplung.".into()))?,
    };
    // Eine Direktkopplung beglaubigt das eigene TLS-Zertifikat (design.md D3): ohne `--tls` gibt
    // es keins, das sich beglaubigen ließe.
    if art == InstanzKopplungArt::VorOrt
        && identitaet::load_tls_zertifikat(&state.pool)
            .await?
            .is_none()
    {
        return Err(AppError::Conflict(
            "Eine Direktkopplung vor Ort braucht TLS an dieser Instanz (--tls).".into(),
        ));
    }
    {
        let mut conn = state.pool.acquire().await?;
        if unterschrift::list_gueltige_eigene(&mut conn, admin.id)
            .await?
            .is_empty()
        {
            return Err(AppError::Conflict(
                "Bitte zuerst einen eigenen Unterschriftsschlüssel registrieren: eine gekoppelte \
                 Instanz muss mindestens einen Admin-Schlüssel der Organisation kennen."
                    .into(),
            ));
        }
        // Derselbe Grundstock wie beim Einlösen: zu viele Schlüssel scheitern hier mit Grund,
        // nicht erst an der anderen Instanz.
        unterschrift::grundstock(&mut conn, admin.org_id).await?;
    }
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(identitaet_error)?;
    let code = kcode::generate();
    let ableitung = kcode::derive(&code);
    let laeuft_ab_at = crate::zeit::plus_minuten(&crate::zeit::jetzt(), kcode::GUELTIG_MINUTEN)
        .ok_or_else(|| AppError::Internal("Zeit".into()))?;
    repo::code_ausstellen(
        &state.pool,
        admin.org_id,
        &ableitung,
        admin.id,
        &laeuft_ab_at,
        art,
    )
    .await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::InstanzCodeAusgestellt,
            akteur: &admin,
            ziel: Ziel::Instanz(match art {
                InstanzKopplungArt::Standard => "Kopplungscode",
                InstanzKopplungArt::VorOrt => "Kopplungscode (vor Ort)",
            }),
            angaben: None,
            peer_ip,
        },
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(KopplungscodeAntwort {
            code: kcode::format_anzeige(&code),
            laeuft_ab_at,
            fingerabdruck: i.fingerabdruck(),
            art,
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
    /// Die einlösende Seite nimmt nur einen Code der Art `vor_ort` an: sie erreicht die
    /// ausstellende nur ohne Vertrauen des Betriebssystems ins Zertifikat (LLH-1497, design.md
    /// D3). Ein Code einer anderen Art wird dann nicht verbraucht.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub nur_vor_ort: bool,
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
    /// Art der Kopplung, die der Code stiftet (LLH-1497); fehlt bei Protokoll 2 und heißt dann
    /// `standard`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    /// Direktkopplung: Fingerabdruck des TLS-Zertifikats der ausstellenden Seite, durch die
    /// Signatur dieser Antwort beglaubigt (design.md D3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls_zertifikat: Option<String>,
}

impl KoppelnAntwort {
    /// Art der Kopplung; eine unbekannte Art ist ein Fehler der Gegenstelle.
    fn art(&self) -> Option<InstanzKopplungArt> {
        match self.art.as_deref() {
            None => Some(InstanzKopplungArt::Standard),
            Some(a) => InstanzKopplungArt::parse(a),
        }
    }
}

/// Ziel eines Spur-Eintrags zur Kopplung: der Name der Gegenstelle, bei einer Direktkopplung mit
/// „(vor Ort)“ (LLH-1497).
fn spur_ziel(name: &str, art: Option<InstanzKopplungArt>) -> String {
    match art {
        Some(InstanzKopplungArt::VorOrt) => format!("{name} (vor Ort)"),
        _ => name.to_string(),
    }
}

fn is_zu_lang(text: &str, max: usize) -> bool {
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
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(identitaet_error)?;
    let ergebnis = check_koppeln(&state, &i, &a).await;
    let (org_id, antwort) = match ergebnis {
        Ok(Ok(wert)) => wert,
        // Mit gültigem Code ist die Gegenstelle ausgewiesen: Abweisungen, die sie beheben kann
        // (Art, Protokoll), gehen klar hinaus und verbrauchen den Code nicht (LLH-1497).
        Ok(Err(klar)) => return Err(klar),
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
    let fp = parse_b64(&a.schluessel)
        .map(|b| fingerabdruck(&b))
        .unwrap_or_default();
    let ziel = spur_ziel(&a.name, antwort.art());
    admin_audit::schreibe_ohne_akteur(
        &state.pool,
        AdminAktion::InstanzCodeEingeloest,
        org_id,
        &a.name,
        Ziel::Instanz(&ziel),
        Some(ZugangsAngaben {
            instanz_kennung: Some(a.kennung.clone()),
            fingerabdruck: Some(fp),
            fremde_org: Some(a.org.name.clone()),
            ..ZugangsAngaben::default()
        }),
        peer_ip,
    )
    .await;
    Ok(signed_antwort(
        &i,
        &a.kennung,
        &a.jti,
        StatusCode::OK,
        &antwort,
    ))
}

/// Prüft und vollzieht das Einlösen. Außen `Err` = nach außen einheitlich 401 (oder ein
/// technischer Fehler); innen `Err` = klare Abweisung an eine Gegenstelle mit gültigem Code, ohne
/// dass der Code verbraucht wird.
async fn check_koppeln(
    state: &AppState,
    i: &Identitaet,
    a: &KoppelnAnfrage,
) -> Result<Result<(i64, KoppelnAntwort), AppError>, AppError> {
    if is_zu_lang(&a.kennung, KENNUNG_MAX)
        || is_zu_lang(&a.name, NAME_MAX)
        || is_zu_lang(&a.org.kennung, KENNUNG_MAX + 24)
        || is_zu_lang(&a.org.name, NAME_MAX)
        || a.softwarestand.chars().count() > 64
        || is_zu_lang(&a.jti, 64)
        || a.kennung == i.kennung
        || parse_oeffentlich(&a.schluessel).is_none()
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
    let tls_eigen = identitaet::load_tls_zertifikat(&state.pool).await?;
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        let Some(code) = repo::find_offener_code(conn, &a.suche, &jetzt).await? else {
            return Err(AppError::Unauthorized);
        };
        if !kcode::is_pruefwert_valid(&code.k_einloeser, &transkript_e, &a.pruefwert) {
            return Err(AppError::Unauthorized);
        }
        if let Some(klar) = check_art(conn, a, &code, tls_eigen.as_deref()).await? {
            return Ok(Err(klar));
        }
        if !repo::consume_code(conn, &a.suche, &jetzt).await? {
            return Err(AppError::Unauthorized);
        }
        let kopplung_id = repo::create_or_renew_kopplung(
            conn,
            &Gegenueber {
                kennung: &a.kennung,
                schluessel_b64: &a.schluessel,
                name: &a.name,
                softwarestand: &a.softwarestand,
                protokoll: a.protokoll,
                art: code.art,
            },
            InstanzKopplungRichtung::WirdGemeldet,
            None,
            InstanzKopplungZustand::Angebahnt,
            &jetzt,
        )
        .await?;
        repo::create_org_zuordnung(
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
        Ok(Ok((code.org_id, lieferung, code.k_aussteller, code.art)))
    })?;
    let (org_id, unterschrift, k_aussteller, art) = match ergebnis {
        Ok(wert) => wert,
        Err(klar) => return Ok(Err(klar)),
    };
    let schluessel = i.oeffentlich_b64();
    let pruefwert = kcode::pruefwert(
        &k_aussteller,
        &kcode::transkript_aussteller(&transkript_e, &i.kennung, &schluessel),
    );
    Ok(Ok((
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
            art: Some(art.as_str().to_string()),
            tls_zertifikat: match art {
                InstanzKopplungArt::VorOrt => tls_eigen,
                InstanzKopplungArt::Standard => None,
            },
        },
    )))
}

/// Klare Abweisungen beim Einlösen eines gültigen Codes (LLH-1497, Spec `instanz-kopplung`): ein
/// Code „vor Ort“ an eine zu alte Gegenstelle (426) oder ohne eigenes TLS (409), ein anderer Code
/// an eine Gegenstelle, die nur „vor Ort“ annimmt (409), und eine andere Art als die der
/// bestehenden Kopplung (409).
async fn check_art(
    conn: &mut sqlx::SqliteConnection,
    a: &KoppelnAnfrage,
    code: &repo::OffenerCode,
    tls_eigen: Option<&str>,
) -> Result<Option<AppError>, AppError> {
    if code.art == InstanzKopplungArt::VorOrt && a.protokoll < PROTOKOLL_VOR_ORT {
        return Ok(Some(AppError::UpgradeRequired(
            "Eine Direktkopplung vor Ort braucht an beiden Instanzen Protokoll 3. Update nötig: \
             einlösende Instanz."
                .into(),
        )));
    }
    if code.art == InstanzKopplungArt::VorOrt && tls_eigen.is_none() {
        return Ok(Some(AppError::Conflict(
            "Die ausstellende Instanz spricht kein TLS mehr (--tls); eine Direktkopplung vor Ort \
             ist so nicht möglich."
                .into(),
        )));
    }
    if a.nur_vor_ort && code.art != InstanzKopplungArt::VorOrt {
        return Ok(Some(AppError::Conflict(
            "Das Zertifikat der anderen Instanz ist nicht vertrauenswürdig. Ohne vertrauenswürdiges \
             Zertifikat geht nur ein Code der Art „Direktkopplung vor Ort“."
                .into(),
        )));
    }
    if let Some(alt) = repo::find_kopplung(conn, &a.kennung).await? {
        if alt.art() != code.art && !repo::list_orgs_aktiv(conn, alt.id).await?.is_empty() {
            return Ok(Some(AppError::Conflict(repo::art_konflikt(alt.art()))));
        }
    }
    Ok(None)
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
    let code = kcode::normalize(&body.code).ok_or_else(|| {
        AppError::Validation("Der Code hat 16 Zeichen, etwa ABCD-EFGH-JKMN-PQRS.".into())
    })?;
    let adresse = melden::normalize_adresse(&body.adresse)?;
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(identitaet_error)?;
    let ableitung = kcode::derive(&code);
    let eigene_org = OrgLeitung {
        kennung: org_kennung(&i.kennung, admin.org_id),
        name: org_name(&state.pool, admin.org_id).await?,
    };
    let (antwort, pin) = send_einloesen(&i, &adresse, &ableitung, &eigene_org).await?;
    let art = antwort.art().unwrap_or(InstanzKopplungArt::Standard);
    if antwort.kennung == i.kennung {
        return Err(AppError::UnprocessableEntity(
            "Eine Instanz kann sich nicht mit sich selbst koppeln.".into(),
        ));
    }

    let jetzt = crate::zeit::jetzt();
    let (kopplung_id, abgelehnt) = crate::write_retry!(&state.pool, |conn| {
        let kopplung_id = repo::create_or_renew_kopplung(
            conn,
            &Gegenueber {
                kennung: &antwort.kennung,
                schluessel_b64: &antwort.schluessel,
                name: &antwort.name,
                softwarestand: &antwort.softwarestand,
                protokoll: antwort.protokoll,
                art,
            },
            InstanzKopplungRichtung::MeldetSich,
            Some(&adresse),
            InstanzKopplungZustand::Aktiv,
            &jetzt,
        )
        .await?;
        repo::save_tls_zertifikat(conn, kopplung_id, pin.as_deref()).await?;
        let org_zeile = repo::create_org_zuordnung(
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
            unterschrift::accept_lieferungen(conn, &ziel, &antwort.unterschrift, true, &jetzt)
                .await?;
        Ok((kopplung_id, abgelehnt))
    })?;
    if !abgelehnt.is_empty() {
        tracing::warn!(
            ?abgelehnt,
            "Grundstock enthielt nicht unterstützte Schlüssel"
        );
    }
    let kopplung = repo::load_kopplung(&state.pool, kopplung_id).await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::InstanzGekoppelt,
            akteur: &admin,
            ziel: Ziel::Instanz(&spur_ziel(&antwort.name, Some(art))),
            angaben: Some(melden::build_angaben_gegenstelle(
                &kopplung,
                &antwort.org.name,
            )),
            peer_ip,
        },
    )
    .await;
    // Die erste Meldung macht die Kopplung beim Aussteller aktiv.
    melden::melden_einmal(&state.pool, &kopplung).await?;
    Ok((
        StatusCode::CREATED,
        Json(repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?),
    ))
}

/// Schickt die Einlöse-Anfrage und prüft die Antwort: Prüfwert des Ausstellers (bindet dessen
/// Schlüssel an den Code) und die Signatur der Antwort mit genau diesem Schlüssel.
///
/// Direktkopplung (LLH-1497, design.md D3): Vertraut das Betriebssystem dem Zertifikat der
/// ausstellenden Seite nicht, geht ein zweiter Versuch ohne Kettenprüfung hinaus, der nur einen
/// Code „vor Ort“ annimmt (`nur_vor_ort`). Bei einem Code „vor Ort“ muss die signierte Antwort den
/// Fingerabdruck genau des Zertifikats nennen, über das sie kam; er wird zurückgegeben und gepinnt.
async fn send_einloesen(
    i: &Identitaet,
    adresse: &str,
    ableitung: &Ableitung,
    eigene_org: &OrgLeitung,
) -> Result<(KoppelnAntwort, Option<String>), AppError> {
    let unerreichbar = |e: String| {
        AppError::BadGateway(format!(
            "Die Instanz unter {adresse} ist nicht erreichbar: {e}"
        ))
    };
    let plattform = crate::ausgehend::client_builder(crate::ausgehend::Zweck::Instanzkopplung)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .tls_info(true)
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    match send_einloesen_mit(i, adresse, ableitung, eigene_org, &plattform, false).await {
        Err(EinloesenFehler::Zertifikat(_)) => {
            let erfassung =
                zertifikat::build_client(None).map_err(|e| AppError::Internal(e.clone()))?;
            send_einloesen_mit(i, adresse, ableitung, eigene_org, &erfassung, true)
                .await
                .map_err(|e| match e {
                    EinloesenFehler::Zertifikat(t) | EinloesenFehler::Netz(t) => unerreichbar(t),
                    EinloesenFehler::App(e) => e,
                })
        }
        Err(EinloesenFehler::Netz(t)) => Err(unerreichbar(t)),
        Err(EinloesenFehler::App(e)) => Err(e),
        Ok(wert) => Ok(wert),
    }
}

enum EinloesenFehler {
    /// Das Betriebssystem vertraut dem Zertifikat nicht.
    Zertifikat(String),
    Netz(String),
    App(AppError),
}

impl From<AppError> for EinloesenFehler {
    fn from(e: AppError) -> Self {
        Self::App(e)
    }
}

async fn send_einloesen_mit(
    i: &Identitaet,
    adresse: &str,
    ableitung: &Ableitung,
    eigene_org: &OrgLeitung,
    client: &reqwest::Client,
    nur_vor_ort: bool,
) -> Result<(KoppelnAntwort, Option<String>), EinloesenFehler> {
    let schluessel = i.oeffentlich_b64();
    let jti = signatur::new_jti();
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
        nur_vor_ort,
    };
    let resp = client
        .post(format!("{adresse}/api/instanz/koppeln"))
        .json(&anfrage)
        .send()
        .await
        .map_err(|e| {
            let zertifikat_fehler = zertifikat::is_zertifikat_fehler(&e);
            let text = e.without_url().to_string();
            if zertifikat_fehler {
                EinloesenFehler::Zertifikat(text)
            } else {
                EinloesenFehler::Netz(text)
            }
        })?;
    let gesehen = zertifikat::gesehen(&resp);
    let status = resp.status();
    let token = resp
        .headers()
        .get(ANTWORT_KOPF)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let rumpf = crate::http_begrenzt::lies_begrenzt(resp, melden::ANTWORT_MAX)
        .await
        .map_err(|e| EinloesenFehler::Netz(e.to_string()))?;
    let meldung = || {
        serde_json::from_slice::<serde_json::Value>(&rumpf)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_string))
            .unwrap_or_else(|| "Die andere Instanz lehnt den Code ab.".into())
    };
    match status.as_u16() {
        200 => {}
        401 => {
            return Err(AppError::UnprocessableEntity(
                "Der Code ist ungültig, abgelaufen oder schon eingelöst.".into(),
            )
            .into())
        }
        409 => return Err(AppError::Conflict(meldung()).into()),
        426 => return Err(AppError::UpgradeRequired(meldung()).into()),
        429 => {
            return Err(AppError::TooManyRequests(
                "Die andere Instanz lehnt gerade weitere Versuche ab. Bitte kurz warten.".into(),
            )
            .into())
        }
        s => return Err(EinloesenFehler::Netz(format!("Antwort {s}"))),
    }
    let nicht_vertrauenswuerdig = |grund: &str| {
        tracing::warn!(
            adresse,
            grund,
            "Antwort beim Einlösen nicht vertrauenswürdig"
        );
        EinloesenFehler::App(AppError::BadGateway(format!(
            "Die Antwort von {adresse} ist nicht vertrauenswürdig ({grund}). Steht zwischen den \
             Instanzen etwas, das die Verbindung verändert?"
        )))
    };
    let a: KoppelnAntwort =
        serde_json::from_slice(&rumpf).map_err(|_| nicht_vertrauenswuerdig("Antwort unlesbar"))?;
    if a.unterschrift.len() > unterschrift::LIEFERUNGEN_MAX {
        return Err(nicht_vertrauenswuerdig("zu viele Unterschriftsschlüssel"));
    }
    let transkript_a = kcode::transkript_aussteller(&transkript_e, &a.kennung, &a.schluessel);
    if !kcode::is_pruefwert_valid(&ableitung.k_aussteller, &transkript_a, &a.pruefwert) {
        return Err(nicht_vertrauenswuerdig("Prüfwert stimmt nicht"));
    }
    let schluessel_a =
        parse_oeffentlich(&a.schluessel).ok_or_else(|| nicht_vertrauenswuerdig("Schlüssel"))?;
    let token = token.ok_or_else(|| nicht_vertrauenswuerdig("ohne Signatur"))?;
    signatur::verify_antwort(
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
    // Ab hier ist die Antwort von der ausstellenden Seite signiert: Art und Fingerabdruck sind
    // ihre Aussage (design.md D3).
    let pin = match a.art() {
        Some(InstanzKopplungArt::VorOrt) => {
            let beglaubigt = a.tls_zertifikat.as_deref();
            match (beglaubigt, gesehen.as_deref()) {
                (Some(b), Some(g)) if b == g => Some(g.to_string()),
                _ => return Err(nicht_vertrauenswuerdig("Zertifikat passt nicht")),
            }
        }
        Some(InstanzKopplungArt::Standard) if !nur_vor_ort => None,
        Some(InstanzKopplungArt::Standard) => {
            return Err(nicht_vertrauenswuerdig(
                "Standardcode über ein nicht vertrauenswürdiges Zertifikat",
            ))
        }
        None => return Err(nicht_vertrauenswuerdig("unbekannte Art der Kopplung")),
    };
    Ok((a, pin))
}

// ── Melden ───────────────────────────────────────────────────────────────────────────────────

/// POST /api/instanz/melden — eine gekoppelte Instanz meldet sich (signiert, design.md D4).
pub async fn melden(
    State(state): State<AppState>,
    anfrage: GekoppelteInstanz,
) -> Result<Response, AppError> {
    let body: MeldenAnfrage = anfrage.json()?;
    let antwort =
        melden::handle_meldung(&state.pool, &anfrage.identitaet, &anfrage.kopplung, &body).await?;
    Ok(anfrage.antwort(StatusCode::OK, &antwort))
}

/// POST /api/instanz/zertifikat — signierte Aussage über das eigene TLS-Zertifikat für die
/// meldende Seite einer Direktkopplung (LLH-1497, design.md D3). Ohne Nutzdaten; die meldende
/// Seite vergleicht die Aussage mit dem Zertifikat, das sie gesehen hat.
pub async fn zertifikat(
    State(state): State<AppState>,
    anfrage: GekoppelteInstanz,
) -> Result<Response, AppError> {
    if anfrage.kopplung.richtung() != Some(InstanzKopplungRichtung::WirdGemeldet)
        || anfrage.kopplung.art() != InstanzKopplungArt::VorOrt
    {
        return Err(AppError::Forbidden);
    }
    let antwort = melden::ZertifikatAussage {
        tls_zertifikat: identitaet::load_tls_zertifikat(&state.pool).await?,
    };
    Ok(anfrage.antwort(StatusCode::OK, &antwort))
}

// ── Abgleich der Einsätze (LLH-1492) ─────────────────────────────────────────────────────────

/// POST /api/instanz/spiegel — eine gekoppelte Instanz gleicht Einsätze ab (signiert, design.md
/// D6): Lieferungen ihrer Einsätze und ihre Stände der unseren hinein, unsere hinaus.
pub async fn spiegel_abgleich(
    State(state): State<AppState>,
    axum::Extension(platz): axum::Extension<crate::instanz::spiegel::antrag::RouterPlatz>,
    anfrage: GekoppelteInstanz,
) -> Result<Response, AppError> {
    let body: crate::instanz::spiegel::paket::SpiegelPaket = anfrage.json()?;
    let antwort = crate::instanz::spiegel::abgleich::handle_abgleich(
        &state.pool,
        platz.router().as_ref(),
        &anfrage.identitaet,
        &anfrage.kopplung,
        &body,
    )
    .await?;
    Ok(anfrage.antwort(StatusCode::OK, &antwort))
}

/// GET /api/einsaetze/{id}/antraege — die eigenen Anträge an einem Spiegel (LLH-1492, Spec
/// `spiegel-antraege`); an einem eigenen Einsatz leer.
pub async fn antraege_liste(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzLesezugriff,
) -> Result<Json<Vec<crate::instanz::spiegel::antrag::SpiegelAntragAnzeige>>, AppError> {
    Ok(Json(
        crate::instanz::spiegel::antrag::liste(&state.pool, ctx.einsatz.id, ctx.benutzer.id)
            .await?,
    ))
}

/// DELETE /api/einsaetze/{id}/antraege/{antrag_id} — verwirft einen eigenen, abgelehnten Antrag.
/// Lese- statt Schreib-Gate: der Antrag ist Buchführung dieser Instanz, keine Einsatzdaten, und
/// gehört dem Konto, das ihn gestellt hat.
pub async fn antrag_verwerfen(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzLesezugriff,
    PfadParam((_eid, antrag_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    crate::instanz::spiegel::antrag::verwerfen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        antrag_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Bruchstelle nachreichen (LLH-1646) ─────────────────────────────────────────────────────

/// Welche Module die Person in diesem Einsatz nutzen darf: Die Liste der Bruchstelle zeigt
/// Inhalte nur dort (LLH-1646, Entwurf „Rechte“).
async fn modul_freigabe_fuer(
    state: &AppState,
    ctx: &crate::einsatz::kontext::EinsatzKontext,
) -> Result<impl Fn(&str) -> bool, AppError> {
    let (overrides, org_defaults) = crate::einsatz::berechtigung::lade_modul_regeln(
        &state.pool,
        ctx.einsatz.id,
        ctx.einsatz.org_id,
    )
    .await?;
    let benutzer = ctx.benutzer.clone();
    let org_id = ctx.einsatz.org_id;
    let rolle = ctx.modul_rolle();
    Ok(move |modul: &str| {
        crate::einsatz::berechtigung::modul_freigabe(
            &overrides,
            &org_defaults,
            modul,
            &benutzer,
            org_id,
            rolle,
        )
        .zugriff
    })
}

/// GET /api/einsaetze/{id}/bruchstelle — die nicht übernommenen Erfassungen eines Spiegels nach
/// einer Notübernahme (LLH-1646, N2): offen, nach Zeit; Inhalte nur mit Freigabe des Moduls.
pub async fn bruchstelle_liste(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzLesezugriff,
) -> Result<Json<Vec<crate::instanz::spiegel::bruchstelle::BruchErfassung>>, AppError> {
    let darf = modul_freigabe_fuer(&state, &ctx).await?;
    Ok(Json(
        crate::instanz::spiegel::bruchstelle::liste(&state.pool, ctx.einsatz.id, darf).await?,
    ))
}

/// Antwort auf „Als Antrag stellen“ und „Alle stellen“: die Zähler im Kopf ändern sich.
async fn bruchstelle_geaendert(state: &AppState, einsatz_id: i64) {
    crate::live::org::kopf_melden(&state.pool, &state.live, einsatz_id, &[]).await;
}

/// POST /api/einsaetze/{id}/bruchstelle/{bruch_id}/antrag — stellt eine nicht übernommene
/// Erfassung als Antrag an den Führer (LLH-1646, N1, N3). 202 mit dem Antrag wie eine Erfassung
/// am Spiegel; ein zweites Stellen liefert denselben Antrag.
pub async fn bruchstelle_stellen(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzSchreibzugriff,
    PfadParam((_eid, bruch_id)): PfadParam<(i64, i64)>,
) -> Result<Response, AppError> {
    let darf = modul_freigabe_fuer(&state, &ctx).await?;
    let liste =
        crate::instanz::spiegel::bruchstelle::liste(&state.pool, ctx.einsatz.id, &darf).await?;
    // Nur, was die Person in der Liste stellen könnte (Modul der Zeile und der Antragsart).
    if let Some(e) = liste.iter().find(|e| e.id == bruch_id) {
        if e.verborgen {
            return Err(AppError::Forbidden);
        }
        if let Some(art) = &e.antrag_art {
            ctx.fordere_modul_zugriff(
                &state.pool,
                crate::instanz::spiegel::bruchstelle::modul_des_antrags(art),
            )
            .await?;
        }
    }
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    let gestellt = crate::write_retry!(&state.pool, |conn| {
        crate::instanz::spiegel::bruchstelle::stellen_tx(conn, einsatz_id, bruch_id, benutzer_id)
            .await
    })?;
    if gestellt.neu {
        crate::instanz::spiegel::takt::wecken();
        bruchstelle_geaendert(&state, einsatz_id).await;
    }
    Ok(axum::response::IntoResponse::into_response((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "antrag": { "id": gestellt.antrag_id, "zustand": gestellt.zustand }
        })),
    )))
}

/// POST /api/einsaetze/{id}/bruchstelle/antraege — stellt alle nachreichbaren Erfassungen in der
/// Reihenfolge ihrer Zeit (LLH-1646, N5). Was noch nicht geht, bleibt offen und steht mit Grund in
/// der Antwort.
pub async fn bruchstelle_alle_stellen(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzSchreibzugriff,
) -> Result<Json<crate::instanz::spiegel::bruchstelle::BruchAlleErgebnis>, AppError> {
    let darf = modul_freigabe_fuer(&state, &ctx).await?;
    let ergebnis = crate::instanz::spiegel::bruchstelle::alle_stellen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        darf,
    )
    .await?;
    if ergebnis.gestellt > 0 {
        bruchstelle_geaendert(&state, ctx.einsatz.id).await;
    }
    Ok(Json(ergebnis))
}

/// POST /api/einsaetze/{id}/bruchstelle/{bruch_id}/verwerfen — legt eine nicht übernommene
/// Erfassung ab (LLH-1646, N6). Auch am abgeschlossenen Einsatz und nach beendetem Abgleich.
pub async fn bruchstelle_verwerfen(
    State(state): State<AppState>,
    ctx: crate::einsatz::kontext::EinsatzSchreibfreigabe,
    PfadParam((_eid, bruch_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    // Ablegen nur, was die Person auch sehen darf: `verwerfen` prüft das Modul der Zeile.
    let darf = modul_freigabe_fuer(&state, &ctx).await?;
    crate::instanz::spiegel::bruchstelle::verwerfen(
        &state.pool,
        ctx.einsatz.id,
        bruch_id,
        ctx.benutzer.id,
        darf,
    )
    .await?;
    bruchstelle_geaendert(&state, ctx.einsatz.id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/antraege/abgelehnt — die eigenen abgelehnten Anträge an Einsätzen, die kein Spiegel
/// mehr sind (LLH-1648, nach der Verwahrung am Hub). Einsatzübergreifend und ohne Einsatz-Lese-Gate:
/// nach der Schonfrist liest die Person den Einsatz nicht mehr, ihren Antrag aber schon.
pub async fn antraege_abgelehnt(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<crate::instanz::spiegel::antrag::AbgelehnterAntragAnzeige>>, AppError> {
    Ok(Json(
        crate::instanz::spiegel::antrag::abgelehnte_ohne_spiegel(&state.pool, benutzer.id).await?,
    ))
}

/// DELETE /api/antraege/abgelehnt/{antrag_id} — verwirft einen davon (204; fremd oder am Spiegel
/// 404).
pub async fn antrag_abgelehnt_verwerfen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(antrag_id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    crate::instanz::spiegel::antrag::verwerfen_ohne_spiegel(&state.pool, benutzer.id, antrag_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
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
    let vorher = repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?; // 404
    let jetzt = crate::zeit::jetzt();
    let widerrufen = crate::write_retry!(&state.pool, |conn| {
        let Some(o) = repo::list_orgs_aktiv(conn, kopplung_id)
            .await?
            .into_iter()
            .find(|o| o.org_id == admin.org_id)
        else {
            return Ok(None);
        };
        let w = repo::org_widerrufen(conn, o.id, Some(admin.id), &jetzt, false).await?;
        repo::update_zustand_nach_orgs(conn, kopplung_id, InstanzKopplungZustand::Widerrufen)
            .await?;
        Ok(w)
    })?;
    if let Some(einsaetze) = widerrufen {
        // Freigegebene Einsätze: geöffnete Oberflächen laden den Kopf neu (LLH-1491).
        for einsatz_id in einsaetze {
            crate::live::org::kopf_melden(&state.pool, &state.live, einsatz_id, &[]).await;
        }
        let kopplung = repo::load_kopplung(&state.pool, kopplung_id).await?;
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::InstanzKopplungWiderrufen,
                akteur: &admin,
                ziel: Ziel::Instanz(&kopplung.gegenueber_name),
                angaben: Some(melden::build_angaben_gegenstelle(
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
        repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?,
    ))
}

// ── Stammdaten (LLH-1493) ────────────────────────────────────────────────────────────────────

/// POST /api/admin/instanz/kopplungen/{id}/stammdaten-neu — „Erneut abgleichen“ an der meldenden
/// Seite (design.md D5): Stand der Org-Zuordnung des Admins auf 0, Hinweise leer; die nächste
/// Meldung holt alles neu und gleicht ab. 422 an der erreichten Seite.
pub async fn stammdaten_neu(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(kopplung_id): PfadParam<i64>,
) -> Result<Json<InstanzKopplungAnzeige>, AppError> {
    repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?; // 404
    let kopplung = repo::load_kopplung(&state.pool, kopplung_id).await?;
    if kopplung.richtung() != Some(InstanzKopplungRichtung::MeldetSich) {
        return Err(AppError::UnprocessableEntity(
            "Stammdaten kommen nur in der Kopplung, in der sich diese Instanz meldet.".into(),
        ));
    }
    let zuordnung = {
        let mut conn = state.pool.acquire().await?;
        repo::list_orgs_aktiv(&mut conn, kopplung_id)
            .await?
            .into_iter()
            .find(|o| o.org_id == admin.org_id)
            .ok_or(AppError::NotFound)?
    };
    repo::reset_stammdaten(&state.pool, zuordnung.id).await?;
    melden::melden_einmal(&state.pool, &kopplung).await?;
    Ok(Json(
        repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?,
    ))
}

/// Antwort auf „ELW verloren“: die Kopplung danach und wie viele Konten betroffen sind.
#[derive(Debug, Serialize, ToSchema)]
pub struct ElwVerlorenAntwort {
    pub kopplung: InstanzKopplungAnzeige,
    pub konten: i64,
}

/// POST /api/admin/instanz/kopplungen/{id}/verloren — „ELW verloren“ an der erreichten Seite
/// (LLH-1493, design.md D8): widerruft die Org-Zuordnung des Admins, macht Passwort und zweiten
/// Faktor jedes Kontos ungültig, dessen Geheimnisse dorthin gingen, und beendet dessen Sitzungen.
/// Wieder hinein geht es per Passkey oder Einmalpasswort. 422 an der meldenden Seite.
pub async fn elw_verloren(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(kopplung_id): PfadParam<i64>,
) -> Result<Json<ElwVerlorenAntwort>, AppError> {
    let vorher = repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?; // 404
    let kopplung = repo::load_kopplung(&state.pool, kopplung_id).await?;
    if kopplung.richtung() != Some(InstanzKopplungRichtung::WirdGemeldet) {
        return Err(AppError::UnprocessableEntity(
            "„ELW verloren“ gibt es nur an der Instanz, bei der sich der ELW meldet.".into(),
        ));
    }
    // Nach einem normalen Widerruf bleibt die Aktion, solange dort gelieferte Geheimnisse
    // gelten; ein zweites Mal setzte sie wiederhergestellte Zugänge erneut zurück.
    if vorher.org.widerrufen_at.is_some() && vorher.org.stammdaten.konten_mit_geheimnis == 0 {
        return Err(AppError::Conflict(
            "Dort gilt kein Passwort von hier mehr; die Kopplung ist schon widerrufen.".into(),
        ));
    }
    let jetzt = crate::zeit::jetzt();
    let zuordnung_id = vorher.org.id;
    let (konten, beendet, freigegeben) = crate::write_retry!(&state.pool, |conn| {
        let freigegeben = repo::org_widerrufen(conn, zuordnung_id, Some(admin.id), &jetzt, false)
            .await?
            .unwrap_or_default();
        repo::update_zustand_nach_orgs(conn, kopplung_id, InstanzKopplungZustand::Widerrufen)
            .await?;
        // Jede Zuordnung der eigenen Org an dieser Kopplung, auch frühere: was je dorthin ging,
        // gilt als bekannt.
        let konten: Vec<i64> = sqlx::query_scalar(
            "SELECT DISTINCT l.benutzer_id FROM instanz_geheimnis_lieferung l \
             JOIN instanz_kopplung_org o ON o.id = l.kopplung_org_id \
             JOIN benutzer b ON b.id = l.benutzer_id \
             WHERE o.kopplung_id = ? AND o.org_id = ? AND b.org_id = ?",
        )
        .bind(kopplung_id)
        .bind(admin.org_id)
        .bind(admin.org_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut beendet = Vec::new();
        for id in &konten {
            sqlx::query(
                "UPDATE benutzer SET passwort_hash = ?, totp_secret = NULL, totp_aktiviert = 0, \
                 totp_letzter_schritt = NULL, totp_fehlversuche = 0, totp_gesperrt_bis = NULL \
                 WHERE id = ?",
            )
            .bind(crate::auth::PASSWORT_HASH_KEIN_LOKALES)
            .bind(id)
            .execute(&mut *conn)
            .await?;
            crate::auth::totp::storage::loesche_recovery_codes(&mut *conn, *id).await?;
            beendet.extend(crate::auth::session::alle_loeschen(conn, *id).await?);
        }
        // Was dorthin ging, ist jetzt wertlos: die Spur fällt, damit die Aktion nicht erneut
        // greift und die Passkey-Pflicht nicht mehr an diesen Lieferungen hängt.
        sqlx::query(
            "DELETE FROM instanz_geheimnis_lieferung WHERE kopplung_org_id IN \
             (SELECT id FROM instanz_kopplung_org WHERE kopplung_id = ? AND org_id = ?)",
        )
        .bind(kopplung_id)
        .bind(admin.org_id)
        .execute(&mut *conn)
        .await?;
        Ok((konten.len() as i64, beendet, freigegeben))
    })?;
    state.live.melde_sitzung_ende(beendet);
    for einsatz_id in freigegeben {
        crate::live::org::kopf_melden(&state.pool, &state.live, einsatz_id, &[]).await;
    }
    let mut angaben = melden::build_angaben_gegenstelle(&kopplung, &vorher.org.fremde_org_name);
    angaben.anzahl = Some(konten);
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::InstanzElwVerloren,
            akteur: &admin,
            ziel: Ziel::Instanz(&kopplung.gegenueber_name),
            angaben: Some(angaben),
            peer_ip,
        },
    )
    .await;
    Ok(Json(ElwVerlorenAntwort {
        kopplung: repo::load_anzeige_fuer_org(&state.pool, kopplung_id, admin.org_id).await?,
        konten,
    }))
}

/// GET /api/instanz/stammdaten/herkunft — welche Stammdaten der eigenen Org vom Hub kommen
/// (design.md D9). Lesen darf jede angemeldete Person: die Oberfläche sperrt danach die
/// Bearbeitung, verrät aber nichts, was die Listen nicht ohnehin zeigen.
pub async fn stammdaten_herkunft(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<crate::instanz::stammdaten::herkunft::StammdatenHerkunftAnzeige>, AppError> {
    Ok(Json(
        crate::instanz::stammdaten::herkunft::load_anzeige(
            &state.pool,
            user.org_id,
            user.system_rolle == crate::auth::SystemRolle::Admin,
        )
        .await?,
    ))
}

// ── Unterschriftsschlüssel ───────────────────────────────────────────────────────────────────

fn passkeys_missing() -> AppError {
    AppError::NotImplemented(
        "Passkeys sind an dieser Instanz nicht eingerichtet (LIFELINE_WEBAUTHN_RP_ID und \
         LIFELINE_WEBAUTHN_RP_ORIGIN)."
            .into(),
    )
}

fn zeremonie_full(_: crate::auth::ablauf_speicher::Voll) -> AppError {
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
    crate::auth::unterschrift::rp().ok_or_else(passkeys_missing)?;
    let webauthn = crate::auth::webauthn::webauthn().ok_or_else(passkeys_missing)?;
    let (optionen, zustand) = webauthn
        .start_passkey_registration(
            uuid::Uuid::new_v4(),
            &format!("{} (Unterschrift)", admin.benutzername),
            &format!("Unterschrift {}", admin.anzeigename),
            None,
        )
        .map_err(|e| AppError::Internal(format!("Registrierung konnte nicht starten: {e}")))?;
    let zeremonie = zeremonie::store(Zeremonie::Registrierung {
        benutzer_id: admin.id,
        bezeichnung,
        zustand,
    })
    .map_err(zeremonie_full)?;
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
    let (rp_id, origin) = crate::auth::unterschrift::rp().ok_or_else(passkeys_missing)?;
    let webauthn = crate::auth::webauthn::webauthn().ok_or_else(passkeys_missing)?;
    let Some(Zeremonie::Registrierung {
        bezeichnung,
        zustand,
        ..
    }) = zeremonie::take(&body.zeremonie, admin.id)
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
        unterschrift::create_lokal(
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
    let anzeige = unterschrift::load_anzeige(&state.pool, admin.org_id, admin.id, id).await?;
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
    let (rp_id, _) = crate::auth::unterschrift::rp().ok_or_else(passkeys_missing)?;
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(identitaet_error)?;
    let (ziel, eigene) = {
        let mut conn = state.pool.acquire().await?;
        (
            unterschrift::load(&mut conn, admin.org_id, id).await?,
            unterschrift::list_gueltige_eigene(&mut conn, admin.id).await?,
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
        parse_b64(&ziel.schluessel).ok_or_else(|| AppError::Internal("Schlüssel".into()))?;
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
    let zeremonie = zeremonie::store(Zeremonie::Gegenzeichnung {
        benutzer_id: admin.id,
        ziel_id: id,
        erklaerung: erklaerung.clone(),
    })
    .map_err(zeremonie_full)?;
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
    }) = zeremonie::take(&body.zeremonie, admin.id)
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
    let eigene = unterschrift::list_gueltige_eigene(&mut conn, admin.id).await?;
    drop(conn);
    let unterzeichner = eigene
        .iter()
        .find(|e| e.credential_id == body.assertion.credential_id)
        .ok_or_else(|| {
            AppError::UnprocessableEntity(
                "Unterschrieben mit einem Schlüssel, der kein gültiger eigener ist.".into(),
            )
        })?;
    pruefen::verify(
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
        unterschrift::save_gegenzeichnung(conn, admin.org_id, id, &gegenzeichnung).await
    })?;
    let anzeige = unterschrift::load_anzeige(&state.pool, admin.org_id, admin.id, id).await?;
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

/// GET /api/admin/instanz/letzte-schluessel — Konten der eigenen Org, deren Deaktivieren oder
/// Herabstufen die Kopplungen ohne gültigen Unterschriftsschlüssel zurückließe; die
/// Benutzerverwaltung warnt davor (LLH-1605, design.md D5).
pub async fn letzte_schluessel(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
) -> Result<Json<Vec<LetzterSchluesselHalter>>, AppError> {
    Ok(Json(
        unterschrift::list_letzte_halter(&state.pool, admin.org_id).await?,
    ))
}

/// Obergrenze der Eingabe beim Bestätigen (`src/AGENTS.md`, Eingabegrenzen): vier Zeichen,
/// großzügig mit Trennzeichen und Leerraum.
const FINGERABDRUCK_ENDE_MAX: usize = 16;

#[derive(Debug, Deserialize)]
pub struct BestaetigenBody {
    /// Die letzten vier Zeichen des Fingerabdrucks, wie der Inhaber sie nennt.
    pub fingerabdruck_ende: String,
}

/// POST /api/admin/instanz/unterschrift/{id}/bestaetigen — bestätigt einen vom Gegenüber
/// nachgelieferten, wartenden Schlüssel (LLH-1605, design.md D3). Verlangt die letzten vier
/// Zeichen des Fingerabdrucks (422, wenn sie nicht passen); ein eigener Unterschriftsschlüssel ist
/// nicht nötig.
pub async fn unterschrift_bestaetigen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<BestaetigenBody>,
) -> Result<Json<UnterschriftSchluesselAnzeige>, AppError> {
    let eingabe = crate::routes::support::pflicht_max(
        &body.fingerabdruck_ende,
        "fingerabdruck_ende",
        FINGERABDRUCK_ENDE_MAX,
    )?;
    decide_unterschrift(&state, &admin, peer_ip, id, Some(&eingabe)).await
}

/// POST /api/admin/instanz/unterschrift/{id}/zurueckweisen — weist einen vom Gegenüber
/// nachgelieferten, wartenden Schlüssel zurück; er wird nie gültig.
pub async fn unterschrift_zurueckweisen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<UnterschriftSchluesselAnzeige>, AppError> {
    decide_unterschrift(&state, &admin, peer_ip, id, None).await
}

/// Bestätigt (`eingabe` gesetzt) oder weist zurück (`None`).
async fn decide_unterschrift(
    state: &AppState,
    admin: &crate::auth::Benutzer,
    peer_ip: Option<std::net::IpAddr>,
    id: i64,
    eingabe: Option<&str>,
) -> Result<Json<UnterschriftSchluesselAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    // Die Zuordnung für die Admin-Spur kommt aus derselben Transaktion: scheitert das Lesen,
    // bleibt auch die Entscheidung aus, statt ohne Spureintrag zu gelten.
    let (zeile, gegenstelle) = crate::write_retry!(&state.pool, |conn| {
        let zeile = unterschrift::load(conn, admin.org_id, id).await?;
        if zeile.zustand() != UnterschriftSchluesselZustand::WartetAufBestaetigung {
            return Err(AppError::UnprocessableEntity(
                "Der Schlüssel wartet nicht auf eine Bestätigung.".into(),
            ));
        }
        let wirkung = match eingabe {
            Some(e) => {
                if !unterschrift::is_fingerabdruck_ende(&zeile.fingerabdruck, e) {
                    return Err(AppError::UnprocessableEntity(
                        "Die Zeichen passen nicht zum Fingerabdruck. Bitte die letzten vier \
                         Zeichen beim Inhaber erfragen."
                            .into(),
                    ));
                }
                unterschrift::confirm(conn, admin.org_id, id, admin.id, &jetzt).await?
            }
            None => unterschrift::reject(conn, admin.org_id, id, admin.id, &jetzt).await?,
        };
        if !wirkung {
            return Err(AppError::UnprocessableEntity(
                "Der Schlüssel wartet nicht auf eine Bestätigung.".into(),
            ));
        }
        let gegenstelle = match zeile.kopplung_org_id {
            Some(ko) => repo::load_zuordnung_gegenstelle(conn, ko).await?,
            None => None,
        };
        Ok((zeile, gegenstelle))
    })?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: if eingabe.is_some() {
                AdminAktion::UnterschriftBestaetigt
            } else {
                AdminAktion::UnterschriftZurueckgewiesen
            },
            akteur: admin,
            ziel: Ziel::Unterschrift(&format!("{} · {}", zeile.benutzer_name, zeile.bezeichnung)),
            angaben: Some(ZugangsAngaben {
                fingerabdruck: Some(zeile.fingerabdruck.clone()),
                instanz_kennung: gegenstelle.as_ref().map(|(k, _)| k.clone()),
                fremde_org: gegenstelle.map(|(_, o)| o),
                ..ZugangsAngaben::default()
            }),
            peer_ip,
        },
    )
    .await;
    Ok(Json(
        unterschrift::load_anzeige(&state.pool, admin.org_id, admin.id, id).await?,
    ))
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
        let zeile = unterschrift::load(conn, admin.org_id, id).await?;
        if zeile.herkunft != "lokal" {
            return Err(AppError::UnprocessableEntity(
                "Schlüssel einer gekoppelten Instanz widerruft diese selbst.".into(),
            ));
        }
        // Nur ein gültiger Schlüssel kann der letzte gültige sein; ein wartender (etwa nach dem
        // Deaktivieren des letzten Halters, LLH-1605) bliebe sonst unwiderrufbar hängen.
        if zeile.zustand() == UnterschriftSchluesselZustand::Gueltig
            && unterschrift::is_letzter_bei_kopplung(conn, admin.org_id, id).await?
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
        unterschrift::load_anzeige(&state.pool, admin.org_id, admin.id, id).await?,
    ))
}
