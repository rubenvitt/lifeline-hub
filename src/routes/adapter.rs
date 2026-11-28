//! Adapter verwalten (LLH-2017, ADR-0077, Design-Doc „Admin-API“).
//!
//! Lesen darf, wer den Admin-Bereich sieht; die Einstellungen sieht nur der System-Admin, weil
//! eine URL darin einen Hinweis auf den Zugang tragen kann. Anlegen, ändern, löschen, Geheimnisse
//! setzen und entfernen, prüfen, anhalten und fortsetzen nur der System-Admin, immer für die eigene
//! Org. Ein Geheimnis kommt nie zurück: die Antwort nennt je Platz nur, ob und wann es gesetzt ist.
//! Jede Änderung schreibt nach ihrem Commit einen Eintrag in die Admin-Spur, ohne Wert und Pfad.
//!
//! Meldet sich die Org bei einem Hub, ist alles Schreiben gesperrt (409, wie die Anbindungen):
//! Eingehendes kommt am Hub an (G5). Abgerufen wird im Hintergrund (`adapter::lauf`), nicht hier.

use age::secrecy::SecretString;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use utoipa::ToSchema;

use crate::adapter::art::{
    check_einstellungen, has_neues_ziel, AdapterArt, AdapterArtAnzeige, AdapterZweck, FeldTyp,
};
use crate::adapter::geheimnis::GEHEIMNIS_MAX;
use crate::adapter::repo::{self, Adapter, Eingabe, Versuch};
use crate::adapter::zustand::{zustand_von, AdapterFehler, AdapterZustand, ZustandAngaben};
use crate::adapter::{lauf, Rahmen};
use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::public_api::webhook::ziel::host_von;
use crate::routes::anbindungen::gesperrt_grund;
use crate::wire_enum::wire_enum;

/// Höchstlänge des Namens eines Adapters (gespiegelt in `frontend/src/api/eingabegrenzen.ts`).
pub const NAME_MAX: usize = 80;

/// Längstes Intervall: ein Tag.
pub const INTERVALL_MAX_S: i64 = 24 * 60 * 60;

wire_enum! {
    /// Zustand des Geheimnisspeichers für die Verwaltung.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum GeheimnisspeicherZustand {
        /// Schlüssel geladen, alle Geheimnisse der Org passen dazu.
        Bereit => "bereit",
        /// Kein Schlüssel (`LIFELINE_GEHEIMNIS_SCHLUESSEL`): Geheimnisse lassen sich nicht
        /// speichern und nicht lesen.
        Fehlt => "fehlt",
        /// Schlüssel geladen, aber mindestens ein Geheimnis der Org gehört zu einem anderen
        /// (Wiederherstellung auf einem anderen Rechner): neu setzen.
        PasstNicht => "passt_nicht",
    }
}

/// Ein Platz für ein Geheimnis, wie die Verwaltung ihn sieht. Nie der Wert.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterGeheimnisAnzeige {
    pub name: String,
    pub bezeichnung: String,
    pub pflicht: bool,
    pub is_gesetzt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesetzt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesetzt_von_name: Option<String>,
    /// Gesetzt, aber an einen anderen als den geladenen Schlüssel verschlüsselt.
    pub is_unlesbar: bool,
}

/// Der letzte Fehlschlag eines Adapters.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterLetzterFehler {
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    pub art: AdapterFehler,
}

/// Ein Adapter, wie die Verwaltung ihn zeigt.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterAnzeige {
    pub id: String,
    /// Code der Art.
    pub art: String,
    /// Anzeigename der Art; fehlt, wenn dieser Server die Art nicht kennt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art_bezeichnung: Option<String>,
    pub name: String,
    /// Die Einstellungen; nur für den System-Admin.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub einstellungen: Option<Value>,
    pub intervall_s: i64,
    pub lan_erlaubt: bool,
    pub zustand: AdapterZustand,
    /// Bei `braucht_eingriff`: der Fehler, der einen Menschen braucht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angehalten_grund: Option<AdapterFehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angehalten_at: Option<String>,
    /// Erster Fehlschlag der laufenden Störung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_seit: Option<String>,
    pub fehlversuche: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naechster_abruf_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_fehler: Option<AdapterLetzterFehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_erfolg_at: Option<String>,
    /// Einträge des letzten erfolgreichen Abrufs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzte_anzahl: Option<i64>,
    pub geheimnisse: Vec<AdapterGeheimnisAnzeige>,
    pub angelegt_at: String,
    /// Optimistisches Lock für Änderungen (`basis_geaendert_at`).
    pub geaendert_at: String,
}

/// Die Adapter der Org, die Arten zum Anlegen und der Zustand des Speichers.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterListe {
    pub adapter: Vec<AdapterAnzeige>,
    pub arten: Vec<AdapterArtAnzeige>,
    pub speicher: GeheimnisspeicherZustand,
    /// Fingerabdruck des geladenen Schlüssels (16 Hex-Zeichen), nie der Schlüssel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speicher_fingerabdruck: Option<String>,
    /// Gesetzt, wenn diese Instanz sich für die Org bei einem Hub meldet: Schreiben gesperrt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesperrt_grund: Option<String>,
}

/// Ein Versuch im Verlauf. Kein Rumpf der Antwort.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterVersuchAnzeige {
    pub at: String,
    /// „Verbindung prüfen“.
    pub probe: bool,
    pub erfolg: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_art: Option<AdapterFehler>,
    pub dauer_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anzahl: Option<i64>,
}

impl AdapterVersuchAnzeige {
    fn aus(v: Versuch) -> Self {
        let fehler_art = v.fehler_art.as_deref().and_then(AdapterFehler::parse);
        AdapterVersuchAnzeige {
            at: v.at,
            probe: v.probe,
            erfolg: v.fehler_art.is_none(),
            status: v.status,
            fehler_art,
            dauer_ms: v.dauer_ms,
            anzahl: v.anzahl,
        }
    }
}

/// Eingabe beim Anlegen.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AdapterEingabe {
    pub art: String,
    pub name: String,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub einstellungen: Option<Value>,
    /// Fehlt es, gilt der Vorschlag der Art.
    #[serde(default)]
    pub intervall_s: Option<i64>,
    #[serde(default)]
    pub lan_erlaubt: bool,
}

/// Änderung; nur die gesendeten Felder. `einstellungen` ersetzt alle Einstellungen.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AdapterAenderung {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    pub einstellungen: Option<Value>,
    #[serde(default)]
    pub intervall_s: Option<i64>,
    #[serde(default)]
    pub lan_erlaubt: Option<bool>,
    /// Optimistisches Lock: `geaendert_at` beim Öffnen. Weicht er ab → 409 `veraltet`; fehlt er,
    /// wird ohne Vergleich geschrieben.
    #[serde(default)]
    pub basis_geaendert_at: Option<String>,
}

/// Ein Geheimnis setzen. Der Wert wird verschlüsselt gespeichert und nie wieder gezeigt.
#[derive(Deserialize, ToSchema)]
pub struct AdapterGeheimnisEingabe {
    pub wert: String,
}

impl std::fmt::Debug for AdapterGeheimnisEingabe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AdapterGeheimnisEingabe(…)")
    }
}

/// Ergebnis von „Verbindung prüfen“.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AdapterPruefErgebnis {
    pub erfolg: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_art: Option<AdapterFehler>,
    pub dauer_ms: i64,
    /// Einträge, die der Abruf geliefert hätte.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anzahl: Option<i64>,
}

async fn anzeige(
    conn: &mut SqliteConnection,
    rahmen: &Rahmen,
    a: &Adapter,
    mit_einstellungen: bool,
) -> Result<AdapterAnzeige, AppError> {
    let art = rahmen.arten.find(&a.art);
    let gesetzt = repo::load_plaetze(conn, &a.id).await?;
    let fp = rahmen.speicher.fingerabdruck();
    let geheimnisse = art
        .map(|art| {
            art.plaetze()
                .iter()
                // Interne Plätze (`Platz::intern`) füllt der Server; die Verwaltung sieht sie nie.
                .filter(|p| !p.intern)
                .map(|p| {
                    let stand = gesetzt.iter().find(|g| g.name == p.name);
                    AdapterGeheimnisAnzeige {
                        name: p.name.to_string(),
                        bezeichnung: p.bezeichnung.to_string(),
                        pflicht: p.pflicht,
                        is_gesetzt: stand.is_some(),
                        gesetzt_at: stand.map(|g| g.gesetzt_at.clone()),
                        gesetzt_von_name: stand.and_then(|g| g.gesetzt_von_name.clone()),
                        is_unlesbar: stand.is_some_and(|g| Some(g.schluessel_fp.as_str()) != fp),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let zustand = zustand_von(ZustandAngaben {
        art_bekannt: art.is_some(),
        angehalten: a.is_angehalten(),
        angehalten_grund: a.angehalten_grund.as_deref(),
        fehler_seit: a.fehler_seit.as_deref(),
        letzter_erfolg_at: a.letzter_erfolg_at.as_deref(),
    });
    let letzter_fehler = match (&a.letzter_fehler_at, a.letzter_fehler()) {
        (Some(at), Some(art)) => Some(AdapterLetzterFehler {
            at: at.clone(),
            status: a.letzter_fehler_status,
            art,
        }),
        _ => None,
    };
    Ok(AdapterAnzeige {
        id: a.id.clone(),
        art: a.art.clone(),
        art_bezeichnung: art.map(|art| art.bezeichnung().to_string()),
        name: a.name.clone(),
        einstellungen: mit_einstellungen.then(|| Value::Object(a.einstellungen())),
        intervall_s: a.intervall_s,
        lan_erlaubt: a.lan_erlaubt,
        zustand,
        angehalten_grund: a.angehalten_grund(),
        angehalten_at: a.angehalten_at.clone(),
        fehler_seit: a.fehler_seit.clone(),
        fehlversuche: a.fehlversuche,
        naechster_abruf_at: a.naechster_abruf_at.clone(),
        letzter_fehler,
        letzter_erfolg_at: a.letzter_erfolg_at.clone(),
        letzte_anzahl: a.letzte_anzahl,
        geheimnisse,
        angelegt_at: a.angelegt_at.clone(),
        geaendert_at: a.geaendert_at.clone(),
    })
}

/// Host der ersten URL oder des ersten Host-Felds in den Einstellungen, für die Admin-Spur.
fn host_der_einstellungen(
    art: Option<&dyn AdapterArt>,
    einstellungen: &Map<String, Value>,
) -> Option<String> {
    art?.felder().iter().find_map(|f| {
        let wert = einstellungen.get(f.name).and_then(Value::as_str)?;
        match f.typ {
            FeldTyp::Url => host_von(wert),
            FeldTyp::Host => Some(wert.to_string()),
            _ => None,
        }
    })
}

#[allow(clippy::too_many_arguments)]
async fn spur(
    state: &AppState,
    admin: &Benutzer,
    aktion: AdminAktion,
    a: &Adapter,
    platz: Option<&str>,
    peer_ip: Option<std::net::IpAddr>,
) {
    let art = state.adapter.arten.find(&a.art).map(|a| &**a);
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion,
            akteur: admin,
            ziel: Ziel::Adapter(&a.name),
            angaben: Some(ZugangsAngaben {
                adapter_id: Some(a.id.clone()),
                adapter_art: Some(a.art.clone()),
                platz: platz.map(str::to_string),
                host: host_der_einstellungen(art, &a.einstellungen()),
                ..Default::default()
            }),
            peer_ip,
        },
    )
    .await;
}

/// Das Intervall nach einer Eingabe (`gesendet`) oder, ohne sie, der bisherige Wert. Eine
/// Versand-Art prüft im festen Takt ihres Vorschlags: ein abweichender Wert ist 400, ein
/// fehlender lässt den bisherigen stehen, auch einen älteren anderen (LLH-2126).
fn check_intervall_fuer(
    art: &dyn AdapterArt,
    gesendet: Option<i64>,
    bisher: i64,
) -> Result<i64, AppError> {
    if art.zweck() == AdapterZweck::Versand {
        return match gesendet {
            Some(s) if s != art.intervall_vorschlag_s() => Err(AppError::Validation(
                "intervall_s: bei einer Versand-Anbindung fest".into(),
            )),
            Some(s) => Ok(s),
            None => Ok(bisher),
        };
    }
    check_intervall(art, gesendet.unwrap_or(bisher))
}

/// Prüft Intervall gegen die Art (400).
fn check_intervall(art: &dyn AdapterArt, intervall_s: i64) -> Result<i64, AppError> {
    let min = art.intervall_min_s();
    if intervall_s < min {
        return Err(AppError::Validation(format!(
            "intervall_s: mindestens {min} Sekunden"
        )));
    }
    if intervall_s > INTERVALL_MAX_S {
        return Err(AppError::Validation(format!(
            "intervall_s: höchstens {INTERVALL_MAX_S} Sekunden"
        )));
    }
    Ok(intervall_s)
}

/// Einstellungen als Objekt, geprüft gegen die Art (400).
fn check_einstellungen_von(
    art: &dyn AdapterArt,
    roh: Option<&Value>,
    lan_erlaubt: bool,
) -> Result<Map<String, Value>, AppError> {
    let leer = Map::new();
    let objekt = match roh {
        None | Some(Value::Null) => &leer,
        Some(Value::Object(m)) => m,
        Some(_) => {
            return Err(AppError::Validation(
                "einstellungen: muss ein Objekt sein".into(),
            ))
        }
    };
    check_einstellungen(art, objekt, lan_erlaubt).map_err(AppError::Validation)
}

/// Die Art eines vorhandenen Adapters; kennt der Server sie nicht mehr, ist Ändern sinnlos (422).
fn art_von<'r>(rahmen: &'r Rahmen, a: &Adapter) -> Result<&'r dyn AdapterArt, AppError> {
    rahmen.arten.find(&a.art).map(|a| &**a).ok_or_else(|| {
        AppError::UnprocessableEntity(format!("Die Art „{}“ kennt dieser Server nicht.", a.art))
    })
}

/// Ein Platz, den die Verwaltung setzen und entfernen darf; einen internen (`Platz::intern`) oder
/// unbekannten gibt es für sie nicht (400).
fn check_platz_setzbar(art: &dyn AdapterArt, platz: &str) -> Result<(), AppError> {
    if art.plaetze().iter().any(|p| p.name == platz && !p.intern) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "Platz „{platz}“ gibt es bei dieser Art nicht"
        )))
    }
}

/// Die Meldung, wenn eine Art höchstens einmal je Org angelegt werden darf und es schon eine gibt
/// (auch eine angehaltene zählt): `smtp` (LLH-2093), `sipgate_fax` (LLH-2095), `matrix`
/// (LLH-2094). `None` für andere Arten.
fn meldung_schon_vorhanden(code: &str) -> Option<&'static str> {
    match code {
        crate::adapter::smtp_art::CODE => {
            Some("Es gibt schon eine E-Mail-Anbindung; ändere oder lösche sie.")
        }
        crate::adapter::sipgate_fax_art::CODE => {
            Some("Es gibt schon eine Fax-Anbindung; ändere oder lösche sie.")
        }
        crate::adapter::matrix_art::CODE => {
            Some("Es gibt schon eine Matrix-Anbindung; ändere oder lösche sie.")
        }
        _ => None,
    }
}

/// Erzeugt die internen Geheimnisse einer Art (`Platz::intern`) für eine neue Anbindung: je Platz
/// 32 Zufallsbytes, base64, verschlüsselt. Ohne Schlüssel des Speichers 422, denn ohne sie taugt
/// die Anbindung nicht.
async fn create_interne_geheimnisse(
    rahmen: &Rahmen,
    art: &dyn AdapterArt,
) -> Result<Vec<(&'static str, Vec<u8>, String)>, AppError> {
    use base64::Engine;
    let mut erzeugt = Vec::new();
    for platz in art.plaetze().iter().filter(|p| p.intern) {
        if !rahmen.speicher.has_schluessel() {
            return Err(AppError::UnprocessableEntity(
                "Der Server hat keinen Schlüssel für Geheimnisse (LIFELINE_GEHEIMNIS_SCHLUESSEL); \
                 ohne ihn lässt sich diese Anbindung nicht anlegen."
                    .into(),
            ));
        }
        let mut zufall = [0u8; 32];
        getrandom::fill(&mut zufall).expect("Zufallsquelle des Systems");
        let wert = SecretString::from(base64::engine::general_purpose::STANDARD.encode(zufall));
        let speicher = rahmen.speicher.clone();
        let (chiffrat, fp) = tokio::task::spawn_blocking(move || speicher.encrypt(&wert))
            .await
            .map_err(|e| AppError::Internal(format!("Verschlüsseln abgebrochen: {e}")))?
            .map_err(|_| AppError::Internal("Verschlüsseln fehlgeschlagen".into()))?;
        erzeugt.push((platz.name, chiffrat, fp));
    }
    Ok(erzeugt)
}

/// Wie lange ein Schreibweg nach dem Commit auf das Verwerfen des Matrix-Clients wartet. Hält ein
/// Versand den Client länger, erledigt es der nächste Zugriff (`matrix::Clients::verwerfen`);
/// der Request bleibt im Zeitbudget.
const VERWERFEN_FRIST: std::time::Duration = std::time::Duration::from_secs(5);

/// Verwirft nach dem Commit den Matrix-Client einer Anbindung samt Schlüsselspeicher (Spec
/// Abschnitt 4: neues Token, neuer Homeserver, Anbindung gelöscht). Für andere Arten nichts.
async fn verwerfen_falls_matrix(rahmen: &Rahmen, art: &str, id: &str) {
    if art != crate::adapter::matrix_art::CODE {
        return;
    }
    // Das Vormerken geschieht sofort; abgewartet wird höchstens die Frist.
    let _ = tokio::time::timeout(VERWERFEN_FRIST, rahmen.matrix.verwerfen(id)).await;
}

/// Ob `platz` das Access-Token einer Matrix-Anbindung ist: ein neues Token ist ein neues Gerät.
fn is_matrix_token(art: &str, platz: &str) -> bool {
    art == crate::adapter::matrix_art::CODE && platz == crate::adapter::matrix_art::PLATZ_TOKEN
}

/// Sperrt das Schreiben, wenn die Org sich bei einem Hub meldet (409).
async fn check_nicht_gesperrt(conn: &mut SqliteConnection, org_id: i64) -> Result<(), AppError> {
    match gesperrt_grund(conn, org_id).await? {
        Some(grund) => Err(AppError::Conflict(grund)),
        None => Ok(()),
    }
}

async fn load_fuer_schreiben(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Adapter, AppError> {
    check_nicht_gesperrt(&mut *conn, org_id).await?;
    repo::load_in_org(conn, org_id, id)
        .await?
        .ok_or(AppError::NotFound)
}

fn speicher_zustand(rahmen: &Rahmen, fremde: bool) -> GeheimnisspeicherZustand {
    if !rahmen.speicher.has_schluessel() {
        GeheimnisspeicherZustand::Fehlt
    } else if fremde {
        GeheimnisspeicherZustand::PasstNicht
    } else {
        GeheimnisspeicherZustand::Bereit
    }
}

/// GET /api/admin/adapter — die Adapter der Org, die Arten und der Zustand des Speichers.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<AdapterListe>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let mit_einstellungen = benutzer.ist_admin();
    let rahmen = &state.adapter;
    let mut conn = state.pool.acquire().await?;
    let mut adapter = Vec::new();
    for a in repo::list_in_org(&mut conn, benutzer.org_id).await? {
        adapter.push(anzeige(&mut conn, rahmen, &a, mit_einstellungen).await?);
    }
    let fremde = match rahmen.speicher.fingerabdruck() {
        Some(fp) => repo::has_fremde_chiffrate(&mut conn, benutzer.org_id, Some(fp)).await?,
        None => false,
    };
    Ok(Json(AdapterListe {
        adapter,
        arten: rahmen
            .arten
            .iter()
            .map(|a| AdapterArtAnzeige::aus(&**a))
            .collect(),
        speicher: speicher_zustand(rahmen, fremde),
        speicher_fingerabdruck: rahmen.speicher.fingerabdruck().map(str::to_string),
        gesperrt_grund: gesperrt_grund(&mut conn, benutzer.org_id).await?,
    }))
}

/// GET /api/admin/adapter/{id}
pub async fn load(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AdapterAnzeige>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let mut conn = state.pool.acquire().await?;
    let a = repo::load_in_org(&mut conn, benutzer.org_id, &id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(
        anzeige(&mut conn, &state.adapter, &a, benutzer.ist_admin()).await?,
    ))
}

/// POST /api/admin/adapter — legt einen Adapter an (201); er ist sofort fällig.
/// Admin-Spur `adapter_angelegt`, mit LAN-Ausnahme zusätzlich `adapter_lan_erlaubt`.
pub async fn create(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<AdapterEingabe>,
) -> Result<(StatusCode, Json<AdapterAnzeige>), AppError> {
    let rahmen = &state.adapter;
    let art = rahmen
        .arten
        .find(body.art.trim())
        .ok_or_else(|| AppError::Validation(format!("art: unbekannte Art „{}“", body.art)))?;
    let eingabe = Eingabe {
        name: crate::routes::support::pflicht_max(&body.name, "name", NAME_MAX)?,
        einstellungen: check_einstellungen_von(
            &**art,
            body.einstellungen.as_ref(),
            body.lan_erlaubt,
        )?,
        intervall_s: check_intervall_fuer(&**art, body.intervall_s, art.intervall_vorschlag_s())?,
        lan_erlaubt: body.lan_erlaubt,
    };
    let interne = create_interne_geheimnisse(rahmen, &**art).await?;
    let jetzt = crate::zeit::jetzt();
    let (org_id, admin_id, code) = (admin.org_id, admin.id, art.code());
    let a = crate::write_retry!(&state.pool, |conn| {
        check_nicht_gesperrt(&mut *conn, org_id).await?;
        // Eine Org hat höchstens eine E-Mail-, eine Fax- und eine Matrix-Anbindung, auch eine
        // angehaltene zählt (LLH-2093, LLH-2095, LLH-2094): der Ausgangskorb wählt die Anbindung
        // je Kanal.
        if let Some(meldung) = meldung_schon_vorhanden(code) {
            let (vorhanden,): (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM adapter WHERE org_id = ? AND art = ?")
                    .bind(org_id)
                    .bind(code)
                    .fetch_one(&mut *conn)
                    .await?;
            if vorhanden > 0 {
                return Err(AppError::UnprocessableEntity(meldung.into()));
            }
        }
        let a = repo::create(&mut *conn, org_id, code, &eingabe, admin_id, &jetzt).await?;
        // Interne Geheimnisse ohne Admin-Spur: kein Admin hat sie gesetzt oder gesehen.
        for (platz, chiffrat, fp) in &interne {
            repo::save_geheimnis(&mut *conn, &a.id, platz, chiffrat, fp, admin_id, &jetzt).await?;
        }
        Ok(a)
    })?;
    spur(
        &state,
        &admin,
        AdminAktion::AdapterAngelegt,
        &a,
        None,
        peer_ip,
    )
    .await;
    if a.lan_erlaubt {
        spur(
            &state,
            &admin,
            AdminAktion::AdapterLanErlaubt,
            &a,
            None,
            peer_ip,
        )
        .await;
    }
    let mut conn = state.pool.acquire().await?;
    Ok((
        StatusCode::CREATED,
        Json(anzeige(&mut conn, rahmen, &a, true).await?),
    ))
}

/// PATCH /api/admin/adapter/{id} — Name, Einstellungen, Intervall, LAN-Ausnahme. Konflikt über
/// `basis_geaendert_at` (409 `veraltet`). Ein wegen eines Fehlers angehaltener Adapter läuft nach
/// geänderten Einstellungen oder geänderter LAN-Ausnahme wieder. Trägt die Änderung ein neues Ziel
/// ein (anderer Host einer URL), werden die Geheimnisse entfernt, je Platz mit Admin-Spur; interne
/// erzeugt der Server neu, und eine Matrix-Anbindung verliert Client und Schlüsselspeicher.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<AdapterAenderung>,
) -> Result<Json<AdapterAnzeige>, AppError> {
    let rahmen = &state.adapter;
    let name = body
        .name
        .as_deref()
        .map(|n| crate::routes::support::pflicht_max(n, "name", NAME_MAX))
        .transpose()?;
    let jetzt = crate::zeit::jetzt();
    let org_id = admin.org_id;
    let (vorher, nachher, entfernt, erledigt, neues_ziel) =
        crate::write_retry!(&state.pool, |conn| {
            let vorher = load_fuer_schreiben(&mut *conn, org_id, &id).await?;
            let art = art_von(rahmen, &vorher)?;
            let lan_erlaubt = body.lan_erlaubt.unwrap_or(vorher.lan_erlaubt);
            // Auch unveränderte Einstellungen werden mit der neuen Ausnahme geprüft: ohne sie darf
            // ein LAN-Ziel nicht stehen bleiben.
            let alte = Value::Object(vorher.einstellungen());
            let einstellungen = check_einstellungen_von(
                art,
                Some(body.einstellungen.as_ref().unwrap_or(&alte)),
                lan_erlaubt,
            )?;
            let eingabe = Eingabe {
                name: name.clone().unwrap_or_else(|| vorher.name.clone()),
                einstellungen,
                intervall_s: check_intervall_fuer(art, body.intervall_s, vorher.intervall_s)?,
                lan_erlaubt,
            };
            let neues_ziel = has_neues_ziel(art, &vorher.einstellungen(), &eingabe.einstellungen);
            let (vorher, nachher) = repo::update(
                &mut *conn,
                org_id,
                &id,
                body.basis_geaendert_at.as_deref(),
                &eingabe,
                &jetzt,
            )
            .await?
            .ok_or(AppError::NotFound)?;
            // Ein neues Ziel bekommt die gespeicherten Geheimnisse nicht: sie werden neu gesetzt.
            // Die internen erzeugt der Server im selben Schreiben neu (Matrix: neue Passphrase für
            // den neuen Speicher), sonst taugte die Anbindung nicht mehr.
            let entfernt = if neues_ziel {
                let entfernt = repo::delete_geheimnisse(&mut *conn, &id).await?;
                for (platz, chiffrat, fp) in &create_interne_geheimnisse(rahmen, art).await? {
                    repo::save_geheimnis(&mut *conn, &id, platz, chiffrat, fp, admin.id, &jetzt)
                        .await?;
                }
                // Die Spur nennt nur, was ein Admin gesetzt hatte.
                entfernt
                    .into_iter()
                    .filter(|platz| !art.plaetze().iter().any(|p| p.intern && p.name == platz))
                    .collect()
            } else {
                Vec::new()
            };
            // Hebt die Änderung einen Stopp des Laufs auf, ist die Meldung erledigt (LLH-2026).
            let erledigt =
                if vorher.angehalten_grund.is_some() && nachher.angehalten_grund.is_none() {
                    repo::clear_gemeldet(&mut *conn, &id).await?
                } else {
                    false
                };
            Ok((vorher, nachher, entfernt, erledigt, neues_ziel))
        })?;
    if neues_ziel {
        verwerfen_falls_matrix(rahmen, &nachher.art, &id).await;
    }
    meldung_erledigen(&state, org_id, &id, erledigt).await;
    if vorher.name != nachher.name
        || vorher.einstellungen_json != nachher.einstellungen_json
        || vorher.intervall_s != nachher.intervall_s
    {
        spur(
            &state,
            &admin,
            AdminAktion::AdapterGeaendert,
            &nachher,
            None,
            peer_ip,
        )
        .await;
    }
    for platz in &entfernt {
        spur(
            &state,
            &admin,
            AdminAktion::AdapterGeheimnisEntfernt,
            &nachher,
            Some(platz),
            peer_ip,
        )
        .await;
    }
    if vorher.lan_erlaubt != nachher.lan_erlaubt {
        let aktion = if nachher.lan_erlaubt {
            AdminAktion::AdapterLanErlaubt
        } else {
            AdminAktion::AdapterLanEntzogen
        };
        spur(&state, &admin, aktion, &nachher, None, peer_ip).await;
    }
    let mut conn = state.pool.acquire().await?;
    Ok(Json(anzeige(&mut conn, rahmen, &nachher, true).await?))
}

/// DELETE /api/admin/adapter/{id} — löscht samt Geheimnissen und Verlauf (204), bei Matrix auch
/// den Schlüsselspeicher.
pub async fn delete(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<StatusCode, AppError> {
    let org_id = admin.org_id;
    // Offene Störungsmeldungen in derselben Transaktion quittieren (LLH-2026): mit dem Adapter
    // fallen ihre Zeilen; scheitert das Löschen, bleiben sie offen. Das Quittier-Ereignis geht
    // nach dem Commit aus den gelesenen Zeilen.
    let (a, erledigt) = crate::write_retry!(&state.pool, |conn| {
        check_nicht_gesperrt(&mut *conn, org_id).await?;
        if repo::load_in_org(&mut *conn, org_id, &id).await?.is_none() {
            return Err(AppError::NotFound);
        }
        let erledigt =
            crate::benachrichtigung::repo::quittieren_fuer_adapter_in(&mut *conn, &id).await?;
        let a = repo::delete(&mut *conn, org_id, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok((a, erledigt))
    })?;
    // Mit dem Adapter fallen seine Zuschaltungen (`ON DELETE CASCADE`); erst nach dem Commit
    // vergisst der Store Merker und Stand (LLH-2105), über den geordneten Abgleich (LLH-2123).
    // Der Adapter ist schon weg; ein Lesefehler lässt höchstens einen Merker ohne Abruf stehen.
    if let Err(e) = crate::routes::drohne::sync_store(&state, std::slice::from_ref(&id)).await {
        tracing::error!("Drohnen-Store nach dem Löschen nicht nachgeführt: {e}");
    }
    verwerfen_falls_matrix(&state.adapter, &a.art, &id).await;
    crate::benachrichtigung::quittiert_zustellen_adapter(&state.live, org_id, &erledigt);
    spur(
        &state,
        &admin,
        AdminAktion::AdapterGeloescht,
        &a,
        None,
        peer_ip,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/admin/adapter/{id}/secrets/{name} — setzt oder ersetzt ein Geheimnis (204). Ohne
/// Schlüssel des Speichers 422. Der Wert steht nirgends im Klartext, auch nicht in der Spur.
pub async fn set_geheimnis(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam((id, platz)): PfadParam<(String, String)>,
    JsonBody(body): JsonBody<AdapterGeheimnisEingabe>,
) -> Result<StatusCode, AppError> {
    // Nur Zeilenumbrüche am Rand fallen weg (Einfügen aus der Zwischenablage); Leerzeichen
    // gehören womöglich zum Passwort und bleiben.
    let wert = body.wert.trim_matches(|c| c == '\r' || c == '\n');
    if wert.trim().is_empty() {
        return Err(AppError::Validation("wert: Pflichtfeld".into()));
    }
    if wert.chars().count() > GEHEIMNIS_MAX {
        return Err(AppError::Validation(format!(
            "wert darf höchstens {GEHEIMNIS_MAX} Zeichen lang sein"
        )));
    }
    let wert = SecretString::from(wert.to_string());
    drop(body);
    let rahmen = &state.adapter;
    let org_id = admin.org_id;
    // Vorprüfung ohne Schreibsperre: Adapter, Art und Platz, bevor verschlüsselt wird.
    let (art, neues_geraet) = {
        let mut conn = state.pool.acquire().await?;
        let a = load_fuer_schreiben(&mut conn, org_id, &id).await?;
        let art = art_von(rahmen, &a)?;
        check_platz_setzbar(art, &platz)?;
        (art, is_matrix_token(&a.art, &platz))
    };
    if !rahmen.speicher.has_schluessel() {
        return Err(AppError::UnprocessableEntity(
            "Der Server hat keinen Schlüssel für Geheimnisse (LIFELINE_GEHEIMNIS_SCHLUESSEL); \
             ohne ihn lässt sich nichts speichern."
                .into(),
        ));
    }
    let speicher = rahmen.speicher.clone();
    let (chiffrat, fp) = tokio::task::spawn_blocking(move || speicher.encrypt(&wert))
        .await
        .map_err(|e| AppError::Internal(format!("Verschlüsseln abgebrochen: {e}")))?
        .map_err(|_| AppError::Internal("Verschlüsseln fehlgeschlagen".into()))?;
    // Ein neues Token ist ein neues Gerät mit neuem Speicher: der bekommt eine neue Passphrase.
    let interne = if neues_geraet {
        create_interne_geheimnisse(rahmen, art).await?
    } else {
        Vec::new()
    };
    let jetzt = crate::zeit::jetzt();
    let admin_id = admin.id;
    let (a, erledigt) = crate::write_retry!(&state.pool, |conn| {
        let a = load_fuer_schreiben(&mut *conn, org_id, &id).await?;
        repo::save_geheimnis(&mut *conn, &a.id, &platz, &chiffrat, &fp, admin_id, &jetzt).await?;
        for (intern, chiffrat, fp) in &interne {
            repo::save_geheimnis(&mut *conn, &a.id, intern, chiffrat, fp, admin_id, &jetzt).await?;
        }
        // Ein neues Geheimnis hebt einen Stopp des Laufs auf: die Meldung ist erledigt (LLH-2026).
        let erledigt = if a.angehalten_grund.is_some() {
            repo::clear_gemeldet(&mut *conn, &a.id).await?
        } else {
            false
        };
        Ok((a, erledigt))
    })?;
    if neues_geraet {
        verwerfen_falls_matrix(rahmen, &a.art, &id).await;
    }
    meldung_erledigen(&state, org_id, &id, erledigt).await;
    spur(
        &state,
        &admin,
        AdminAktion::AdapterGeheimnisGesetzt,
        &a,
        Some(&platz),
        peer_ip,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/admin/adapter/{id}/secrets/{name} — entfernt ein Geheimnis (204); nicht
/// gesetzt → 404.
pub async fn delete_geheimnis(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam((id, platz)): PfadParam<(String, String)>,
) -> Result<StatusCode, AppError> {
    let org_id = admin.org_id;
    let rahmen = &state.adapter;
    let a = crate::write_retry!(&state.pool, |conn| {
        let a = load_fuer_schreiben(&mut *conn, org_id, &id).await?;
        // Eine Art, die der Server nicht mehr kennt, behält das Entfernen ihrer Geheimnisse.
        if let Some(art) = rahmen.arten.find(&a.art) {
            check_platz_setzbar(&**art, &platz)?;
        }
        if !repo::delete_geheimnis(&mut *conn, &a.id, &platz).await? {
            return Err(AppError::NotFound);
        }
        Ok(a)
    })?;
    // Ohne Token ist das Gerät des Speichers nicht mehr zu benutzen.
    if is_matrix_token(&a.art, &platz) {
        verwerfen_falls_matrix(rahmen, &a.art, &id).await;
    }
    spur(
        &state,
        &admin,
        AdminAktion::AdapterGeheimnisEntfernt,
        &a,
        Some(&platz),
        peer_ip,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/adapter/{id}/check — „Verbindung prüfen“: ruft einmal ab, übernimmt nichts,
/// ändert den Zustand nicht; der Versuch steht im Verlauf. Kein Eintrag in der Admin-Spur.
pub async fn check(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AdapterPruefErgebnis>, AppError> {
    let rahmen = &state.adapter;
    let a = {
        let mut conn = state.pool.acquire().await?;
        load_fuer_schreiben(&mut conn, admin.org_id, &id).await?
    };
    let art = art_von(rahmen, &a)?;
    let v = lauf::probe(&state.pool, rahmen, art, &a, chrono::Utc::now()).await?;
    let fehler_art = v.fehler_art.as_deref().and_then(AdapterFehler::parse);
    Ok(Json(AdapterPruefErgebnis {
        erfolg: v.fehler_art.is_none(),
        status: v.status,
        fehler_art,
        dauer_ms: v.dauer_ms,
        anzahl: v.anzahl,
    }))
}

/// POST /api/admin/adapter/{id}/pause — nur aus „aktiv“, sonst 422.
pub async fn halt(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AdapterAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let org_id = admin.org_id;
    let (a, erledigt) = crate::write_retry!(&state.pool, |conn| {
        load_fuer_schreiben(&mut *conn, org_id, &id).await?;
        let a = repo::halt(&mut *conn, org_id, &id, &jetzt)
            .await?
            .ok_or_else(|| {
                AppError::UnprocessableEntity("Der Adapter ist schon angehalten.".into())
            })?;
        Ok((a, repo::clear_gemeldet(&mut *conn, &id).await?))
    })?;
    meldung_erledigen(&state, org_id, &id, erledigt).await;
    spur(
        &state,
        &admin,
        AdminAktion::AdapterAngehalten,
        &a,
        None,
        peer_ip,
    )
    .await;
    let mut conn = state.pool.acquire().await?;
    Ok(Json(anzeige(&mut conn, &state.adapter, &a, true).await?))
}

/// POST /api/admin/adapter/{id}/resume — nur aus „angehalten“, sonst 422; sofort fällig.
pub async fn resume(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<AdapterAnzeige>, AppError> {
    let org_id = admin.org_id;
    let (a, erledigt) = crate::write_retry!(&state.pool, |conn| {
        load_fuer_schreiben(&mut *conn, org_id, &id).await?;
        let a = repo::resume(&mut *conn, org_id, &id)
            .await?
            .ok_or_else(|| AppError::UnprocessableEntity("Der Adapter läuft schon.".into()))?;
        Ok((a, repo::clear_gemeldet(&mut *conn, &id).await?))
    })?;
    meldung_erledigen(&state, org_id, &id, erledigt).await;
    spur(
        &state,
        &admin,
        AdminAktion::AdapterFortgesetzt,
        &a,
        None,
        peer_ip,
    )
    .await;
    let mut conn = state.pool.acquire().await?;
    Ok(Json(anzeige(&mut conn, &state.adapter, &a, true).await?))
}

/// Erledigt die offene Störungsmeldung eines Adapters, wenn ein Admin eingegriffen hat und eine
/// gemeldet war (LLH-2026): ohne Entwarnung, der Admin weiß es schon.
async fn meldung_erledigen(state: &AppState, org_id: i64, id: &str, war_gemeldet: bool) {
    if war_gemeldet {
        crate::benachrichtigung::erledigen_adapter(&state.pool, &state.live, org_id, id).await;
    }
}

/// GET /api/admin/adapter/{id}/attempts — die letzten Versuche, neueste zuerst.
pub async fn list_versuche(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<Vec<AdapterVersuchAnzeige>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let mut conn = state.pool.acquire().await?;
    let a = repo::load_in_org(&mut conn, benutzer.org_id, &id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(
        repo::load_versuche(&mut conn, &a.id)
            .await?
            .into_iter()
            .map(AdapterVersuchAnzeige::aus)
            .collect(),
    ))
}
