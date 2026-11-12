//! Anbindungen: Maschinenzugänge für Fremdsysteme verwalten (LLH-1652, Spec `maschinenzugang`,
//! design.md D11). Lesen darf, wer die Verwaltung sieht; anlegen, ändern, Code ausstellen und
//! widerrufen nur der System-Admin, immer für die eigene Org. Die Anmeldung der Fremdsysteme
//! selbst trägt `public_api`. Welchen Einsatz ein Zugang liest, entscheidet die Einsatzleitung
//! (`routes::einsatz_anbindungen`, LLH-1638); Widerruf und Entzug des Leserechts beenden diese
//! Freigabe hier.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::instanz::basis32::{fingerabdruck, parse_b64};
use crate::instanz::{code as kcode, identitaet};
use crate::public_api::freigabe;
use crate::public_api::scope::{parse_scopes, AblehnungGrund, Scope, ZugangZustand};
use crate::public_api::zugang::{self, Zugang};
use crate::routes::einsatz_anbindungen::freigabe_entziehen_tx;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;
use utoipa::ToSchema;

/// Höchstlänge des Namens eines Zugangs (gespiegelt in `frontend/src/api/eingabegrenzen.ts`).
pub const NAME_MAX: usize = 80;

/// Letzte Ablehnung einer Anfrage eines Zugangs (design.md D6).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AnbindungAblehnung {
    pub at: String,
    pub grund: AblehnungGrund,
    /// Bei `uhr`: Abweichung der Uhr des Fremdsystems in Sekunden (negativ: geht nach).
    pub abweichung_s: Option<i64>,
}

/// Ein Zugang, wie die Seite „Anbindungen“ ihn zeigt. Schlüssel nur als Fingerabdruck.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AnbindungAnzeige {
    pub id: String,
    pub name: String,
    pub scopes: Vec<Scope>,
    pub gueltig_bis: Option<String>,
    pub zustand: ZugangZustand,
    /// „gültig bis“ ist verstrichen; der Zugang verhält sich wie widerrufen.
    pub is_abgelaufen: bool,
    pub fingerabdruck: Option<String>,
    /// Während eines Schlüsselwechsels: der neue Schlüssel, bis er zum ersten Mal signiert.
    pub fingerabdruck_neu: Option<String>,
    pub angelegt_at: String,
    /// Stand für das optimistische Lock beim Bearbeiten (`basis_geaendert_at`).
    pub geaendert_at: String,
    pub widerrufen_at: Option<String>,
    /// Anzeigename des Admins, der widerrufen hat.
    pub widerrufen_von_name: Option<String>,
    pub zuletzt_genutzt_at: Option<String>,
    pub letzte_ablehnung: Option<AnbindungAblehnung>,
    /// Der aktive Einsatz, den der Zugang gerade liest (Freigabe der Einsatzleitung, LLH-1638).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_bezeichnung: Option<String>,
}

fn fingerabdruck_von(schluessel: Option<&str>) -> Option<String> {
    schluessel
        .and_then(parse_b64)
        .map(|bytes| fingerabdruck(&bytes))
}

impl AnbindungAnzeige {
    fn aus(z: &Zugang, jetzt: &str) -> Self {
        AnbindungAnzeige {
            id: z.id.clone(),
            name: z.name.clone(),
            scopes: z.scopes.clone(),
            gueltig_bis: z.gueltig_bis.clone(),
            zustand: z.zustand,
            is_abgelaufen: z.is_abgelaufen(jetzt),
            fingerabdruck: fingerabdruck_von(z.schluessel.as_deref()),
            fingerabdruck_neu: fingerabdruck_von(z.schluessel_neu.as_deref()),
            angelegt_at: z.angelegt_at.clone(),
            geaendert_at: z.stand().to_string(),
            widerrufen_at: z.widerrufen_at.clone(),
            widerrufen_von_name: z.widerrufen_von_name.clone(),
            zuletzt_genutzt_at: z.zuletzt_genutzt_at.clone(),
            letzte_ablehnung: match (&z.letzte_ablehnung_at, z.letzte_ablehnung_grund) {
                (Some(at), Some(grund)) => Some(AnbindungAblehnung {
                    at: at.clone(),
                    grund,
                    abweichung_s: z.letzte_ablehnung_abweichung_s,
                }),
                _ => None,
            },
            einsatz_id: None,
            einsatz_bezeichnung: None,
        }
    }

    /// Wie [`Self::aus`], mit dem Einsatz, den der Zugang gerade liest.
    async fn load(
        conn: &mut sqlx::SqliteConnection,
        z: &Zugang,
        jetzt: &str,
    ) -> Result<Self, AppError> {
        let mut anzeige = Self::aus(z, jetzt);
        if freigabe::is_freigebbar(z, jetzt) {
            if let Some((id, bezeichnung)) = freigabe::gelesener_einsatz(conn, &z.id).await? {
                anzeige.einsatz_id = Some(id);
                anzeige.einsatz_bezeichnung = Some(bezeichnung);
            }
        }
        Ok(anzeige)
    }
}

/// Die Zugänge der Org und, falls Anbindungen hier nicht angenommen werden, der Grund.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AnbindungenListe {
    pub zugaenge: Vec<AnbindungAnzeige>,
    /// Gesetzt, wenn diese Instanz sich für die Org bei einem Hub meldet (design.md D10):
    /// Anlegen und neue Codes sind dann gesperrt.
    pub gesperrt_grund: Option<String>,
    /// Fingerabdruck dieser Instanz, zum Abgleich am Fremdsystem.
    pub instanz_fingerabdruck: String,
}

/// Ein frisch ausgestellter Einmal-Code. Er verlässt den Server nur hier, einmal.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AnbindungCode {
    pub zugang: AnbindungAnzeige,
    /// In Vierergruppen, z. B. `ABCD-EFGH-JKMN-PQRS`.
    pub code: String,
    pub laeuft_ab_at: String,
}

/// Body von Anlegen und Ändern: der ganze Stand.
#[derive(Debug, Deserialize)]
pub struct AnbindungEingabe {
    pub name: String,
    pub scopes: Vec<String>,
    #[serde(default)]
    pub gueltig_bis: Option<String>,
}

fn check_name(roh: &str) -> Result<String, AppError> {
    crate::routes::support::pflicht_max(roh, "name", NAME_MAX)
}

/// Mindestens ein bekannter Scope, sortiert und ohne Dopplung.
fn check_scopes(roh: &[String]) -> Result<Vec<Scope>, AppError> {
    if roh.len() > 32 {
        return Err(AppError::Validation("scopes: zu viele Einträge".into()));
    }
    let scopes = parse_scopes(roh.iter().map(String::as_str))
        .map_err(|s| AppError::Validation(format!("scopes: unbekannter Wert „{s}“")))?;
    if scopes.is_empty() {
        return Err(AppError::Validation(
            "scopes: mindestens ein Recht ist nötig".into(),
        ));
    }
    Ok(scopes)
}

/// „gültig bis“ in der Zukunft (UTC, `zeit::FORMAT` oder ohne Sekunden); leer heißt unbegrenzt.
fn check_gueltig_bis(roh: Option<&str>, jetzt: &str) -> Result<Option<String>, AppError> {
    match roh.map(str::trim) {
        None | Some("") => Ok(None),
        Some(roh) => {
            let normal = crate::zeit::normalisiere_eingabe(roh).ok_or_else(|| {
                AppError::Validation("gueltig_bis: Zeitpunkt nicht lesbar".into())
            })?;
            let normal = crate::zeit::im_jahresbereich(normal, "gueltig_bis")?;
            if normal.as_str() <= jetzt {
                return Err(AppError::Validation(
                    "gueltig_bis: Zeitpunkt liegt in der Vergangenheit".into(),
                ));
            }
            Ok(Some(normal))
        }
    }
}

/// Prüft die Eingabe des Anlegens: Name 1..=80 Zeichen, mindestens ein bekannter Scope, „gültig
/// bis“ in der Zukunft.
fn check_eingabe(
    e: &AnbindungEingabe,
    jetzt: &str,
) -> Result<(String, Vec<Scope>, Option<String>), AppError> {
    Ok((
        check_name(&e.name)?,
        check_scopes(&e.scopes)?,
        check_gueltig_bis(e.gueltig_bis.as_deref(), jetzt)?,
    ))
}

/// Body von `PATCH /api/admin/anbindungen/{id}`: nur geänderte Felder (LLH-1139).
#[derive(Debug, Deserialize)]
pub struct AnbindungAenderung {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    /// Tri-State: fehlt = unverändert, `null` = unbegrenzt.
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub gueltig_bis: Option<Option<String>>,
    /// Optimistisches Lock: `geaendert_at` beim Öffnen. Weicht er ab → 409; fehlt er („Meine
    /// Änderung übernehmen“ nach der Rückfrage), wird ohne Vergleich geschrieben.
    #[serde(default)]
    pub basis_geaendert_at: Option<String>,
}

/// Text für den gekoppelten ELW (design.md D10), `None` wenn Anbindungen hier angenommen werden.
async fn gesperrt_grund(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<String>, AppError> {
    Ok(zugang::hub_fuer_org(conn, org_id)
        .await?
        .map(|(name, adresse)| {
            let wo = match adresse {
                Some(a) => format!("{name} ({a})"),
                None => name,
            };
            format!(
                "Diese Instanz meldet sich für die Organisation bei {wo}. Anbindungen von \
             Fremdsystemen gehören dorthin."
            )
        }))
}

fn scopes_wire(scopes: &[Scope]) -> Vec<String> {
    scopes.iter().map(|s| s.as_str().to_string()).collect()
}

/// Stellt einen Code für den Zugang aus und liefert ihn in Anzeigeform samt Ablauf.
async fn neuer_code(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    von: i64,
    jetzt: &str,
) -> Result<(String, String), AppError> {
    let code = kcode::generate();
    let ableitung = kcode::derive_mit_salz(&code, kcode::SALZ_MACHINE);
    let laeuft_ab_at = crate::zeit::plus_minuten(jetzt, kcode::GUELTIG_MINUTEN)
        .ok_or_else(|| AppError::Internal("Zeit".into()))?;
    zugang::code_ausstellen(conn, zugang_id, &ableitung, Some(von), &laeuft_ab_at).await?;
    Ok((kcode::format_anzeige(&code), laeuft_ab_at))
}

/// GET /api/admin/anbindungen — alle Zugänge der eigenen Org, widerrufene eingeschlossen.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<AnbindungenListe>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let jetzt = crate::zeit::jetzt();
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(|e| AppError::Internal(format!("Instanzidentität: {e}")))?;
    let mut conn = state.pool.acquire().await?;
    let mut zugaenge = Vec::new();
    for z in zugang::liste(&mut conn, benutzer.org_id).await? {
        zugaenge.push(AnbindungAnzeige::load(&mut conn, &z, &jetzt).await?);
    }
    Ok(Json(AnbindungenListe {
        zugaenge,
        gesperrt_grund: gesperrt_grund(&mut conn, benutzer.org_id).await?,
        instanz_fingerabdruck: i.fingerabdruck(),
    }))
}

/// POST /api/admin/anbindungen — legt einen Zugang an und stellt seinen ersten Code aus.
/// Admin-Spur `maschinenzugang_angelegt`.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<AnbindungEingabe>,
) -> Result<(StatusCode, Json<AnbindungCode>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let (name, scopes, gueltig_bis) = check_eingabe(&body, &jetzt)?;
    let (org_id, von) = (admin.org_id, admin.id);
    let (z, code, laeuft_ab_at) = crate::write_retry!(&state.pool, |conn| {
        if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
            return Err(AppError::Conflict(grund));
        }
        let id = zugang::anlegen(
            &mut *conn,
            org_id,
            &name,
            &scopes,
            gueltig_bis.as_deref(),
            Some(von),
            &jetzt,
        )
        .await?;
        let (code, laeuft_ab_at) = neuer_code(&mut *conn, &id, von, &jetzt).await?;
        let z = zugang::laden(&mut *conn, &id)
            .await?
            .ok_or_else(|| AppError::Internal("Maschinenzugang verschwunden".into()))?;
        Ok((z, code, laeuft_ab_at))
    })?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::MaschinenzugangAngelegt,
            akteur: &admin,
            ziel: Ziel::Maschinenzugang(&name),
            angaben: Some(ZugangsAngaben {
                zugang_id: Some(z.id.clone()),
                scopes: Some(scopes_wire(&scopes)),
                ..Default::default()
            }),
            peer_ip,
        },
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(AnbindungCode {
            zugang: AnbindungAnzeige::aus(&z, &jetzt),
            code,
            laeuft_ab_at,
        }),
    ))
}

/// PATCH /api/admin/anbindungen/{id} — nur die gesendeten Felder (LLH-1139); Konflikt über
/// `basis_geaendert_at` (409). Ein widerrufener Zugang: 409. Admin-Spur
/// `maschinenzugang_geaendert` nur bei einer wirksamen Änderung.
pub async fn aendern(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<AnbindungAenderung>,
) -> Result<Json<AnbindungAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let aenderung = zugang::Aenderung {
        name: body.name.as_deref().map(check_name).transpose()?,
        scopes: body.scopes.as_deref().map(check_scopes).transpose()?,
        gueltig_bis: body
            .gueltig_bis
            .as_ref()
            .map(|g| check_gueltig_bis(g.as_deref(), &jetzt))
            .transpose()?,
        basis: body.basis_geaendert_at,
    };
    let (org_id, von) = (admin.org_id, admin.id);
    let admin_name = admin.anzeigename.clone();
    let (vorher, nachher, etb, anzeige) = crate::write_retry!(&state.pool, |conn| {
        let (vorher, nachher) = zugang::aendern(&mut *conn, org_id, &id, &aenderung, &jetzt)
            .await?
            .ok_or(AppError::NotFound)?;
        // Mit dem letzten Lese-Scope mit Einsatzbezug endet die Freigabe (LLH-1638): bekäme der
        // Zugang das Recht später wieder, läse er sonst ohne neue Entscheidung der Einsatzleitung.
        let etb = if vorher.has_einsatzbezug() && !nachher.has_einsatzbezug() {
            // Ein Zugang, der nur Einsätze las (LLH-1655), hatte nie eine Lage.
            let was = if vorher.has_scope(Scope::LageRead) {
                "darf keine Lage mehr lesen"
            } else {
                "darf den Einsatz nicht mehr lesen"
            };
            let text = format!(
                "Anbindung „{}“ {was} (geändert von {admin_name}); die Freigabe dieses \
                 Einsatzes ist beendet.",
                nachher.name
            );
            freigabe_entziehen_tx(&mut *conn, &nachher.id, von, &text).await?
        } else {
            None
        };
        let anzeige = AnbindungAnzeige::load(&mut *conn, &nachher, &jetzt).await?;
        Ok((vorher, nachher, etb, anzeige))
    })?;
    if let Some((einsatz_id, etb_id)) = etb {
        state.live.publiziere(einsatz_id, etb_id);
    }
    if vorher != nachher {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::MaschinenzugangGeaendert,
                akteur: &admin,
                ziel: Ziel::Maschinenzugang(&nachher.name),
                angaben: Some(ZugangsAngaben {
                    zugang_id: Some(nachher.id.clone()),
                    scopes: Some(scopes_wire(&nachher.scopes)),
                    scopes_vorher: (vorher.scopes != nachher.scopes)
                        .then(|| scopes_wire(&vorher.scopes)),
                    ..Default::default()
                }),
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(anzeige))
}

/// GET /api/admin/anbindungen/{id} — ein Zugang der eigenen Org (Ansicht, Deeplink).
pub async fn laden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AnbindungAnzeige>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let mut conn = state.pool.acquire().await?;
    let z = zugang::laden_in_org(&mut conn, benutzer.org_id, &id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(
        AnbindungAnzeige::load(&mut conn, &z, &crate::zeit::jetzt()).await?,
    ))
}

/// POST /api/admin/anbindungen/{id}/code — neuer Einmal-Code für einen bestehenden Zugang
/// (Schlüsselwechsel, oder der erste Code lief ab). Ein früherer offener Code verfällt.
pub async fn code(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<(StatusCode, Json<AnbindungCode>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let (org_id, von) = (admin.org_id, admin.id);
    let (z, code, laeuft_ab_at, anzeige) = crate::write_retry!(&state.pool, |conn| {
        let z = zugang::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        if z.zustand == ZugangZustand::Widerrufen {
            return Err(AppError::Conflict(
                "Ein widerrufener Zugang bekommt keinen neuen Code.".into(),
            ));
        }
        if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
            return Err(AppError::Conflict(grund));
        }
        let (code, laeuft_ab_at) = neuer_code(&mut *conn, &id, von, &jetzt).await?;
        let anzeige = AnbindungAnzeige::load(&mut *conn, &z, &jetzt).await?;
        Ok((z, code, laeuft_ab_at, anzeige))
    })?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::MaschinenzugangCodeAusgestellt,
            akteur: &admin,
            ziel: Ziel::Maschinenzugang(&z.name),
            angaben: Some(ZugangsAngaben {
                zugang_id: Some(z.id.clone()),
                scopes: Some(scopes_wire(&z.scopes)),
                fingerabdruck: fingerabdruck_von(z.schluessel.as_deref()),
                ..Default::default()
            }),
            peer_ip,
        },
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(AnbindungCode {
            zugang: anzeige,
            code,
            laeuft_ab_at,
        }),
    ))
}

/// POST /api/admin/anbindungen/{id}/widerrufen — wirkt sofort und berührt nichts anderes.
/// Idempotent; die Admin-Spur schreibt nur die Wirkung.
pub async fn widerrufen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AnbindungAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let (org_id, von) = (admin.org_id, admin.id);
    // Der Stand für Antwort und Spur kommt aus derselben Transaktion: scheiterte ein Lesen nach
    // dem Commit, gälte der Widerruf ohne Spureintrag (Prüfliste, Atomarität).
    let admin_name = admin.anzeigename.clone();
    let (wirkung, z, etb) = crate::write_retry!(&state.pool, |conn| {
        let wirkung = zugang::widerrufen(&mut *conn, org_id, &id, Some(von), &jetzt)
            .await?
            .ok_or(AppError::NotFound)?;
        let z = zugang::laden(&mut *conn, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        // Der Widerruf beendet auch die Freigabe (LLH-1638); das ETB des gelesenen Einsatzes
        // nennt es. Auch ohne Wirkung am Zugang: eine stehengebliebene Zeile fällt hier mit.
        let text = format!(
            "Anbindung „{}“ widerrufen von {admin_name}; der Einsatz wird dort nicht mehr gelesen.",
            z.name
        );
        let etb = freigabe_entziehen_tx(&mut *conn, &id, von, &text).await?;
        Ok((wirkung, z, etb))
    })?;
    if let Some((einsatz_id, etb_id)) = etb {
        state.live.publiziere(einsatz_id, etb_id);
    }
    if wirkung {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::MaschinenzugangWiderrufen,
                akteur: &admin,
                ziel: Ziel::Maschinenzugang(&z.name),
                angaben: Some(ZugangsAngaben {
                    zugang_id: Some(z.id.clone()),
                    scopes: Some(scopes_wire(&z.scopes)),
                    fingerabdruck: fingerabdruck_von(z.schluessel.as_deref()),
                    ..Default::default()
                }),
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(AnbindungAnzeige::aus(&z, &jetzt)))
}
