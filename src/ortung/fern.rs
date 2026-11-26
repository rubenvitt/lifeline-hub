//! Fahrzeugortung in gespiegelten Einsätzen, Seite des Hubs (LLH-2119, Entwurf
//! `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`, „Abgleich: neue
//! Felder im `SpiegelPaket`“): Der Hub beantwortet die Ortungsanfragen des ELW im Abgleich.
//!
//! - Eine Position geht nur hinaus, wenn die Org über diese Kopplung abgebildet ist, der Zugang
//!   zu ihr gehört, `positionen:write` trägt, nicht widerrufen und nicht abgelaufen ist und der
//!   Org-Schalter „Ortung im Einsatz“ an ist (ADR-0101, ADR-0103). Sonst entfällt der Eintrag
//!   stumm: das ELW erfährt nicht, warum.
//! - Die Kandidatenliste trägt keine Koordinaten.
//! - Die Antwort entsteht außerhalb der Schreibtransaktion des Abgleichs und ist fehlerfrei nach
//!   außen: ein Fehler zählt eine Sammelzeile ohne Kennung und liefert leere Listen.

use crate::error::AppError;
use crate::instanz::identitaet::Identitaet;
use crate::instanz::org_kennung;
use crate::instanz::repo::{self, KopplungZeile};
use crate::instanz::spiegel::paket::{
    RemoteTrackingCandidate, RemoteTrackingCandidates, RemoteTrackingPosition,
    RemoteTrackingRequest, SpiegelPaket, TRACKING_ANFRAGEN_MAX, TRACKING_KANDIDATEN_MAX,
};
use crate::instanz::InstanzKopplungArt;
use crate::log_drossel::SammelzeileJe;
use crate::ortung::kopplung;
use crate::ortung::uebernahme::{apply_remote_position_tx, Uebernahme};
use crate::public_api::scope::Scope;
use crate::write_retry;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Beantwortet die Ortungsfelder der Anfrage: (Positionen, Kandidaten). Bei einem Fehler leere
/// Listen. `platz` ist, was die Antwort bis [`crate::instanz::spiegel::paket::SPIEGEL_MAX`]
/// noch an Bytes trägt: die Ortungsfelder wachsen serialisiert nie darüber hinaus (Entwurf,
/// „die Kandidaten zählen gegen `SPIEGEL_MAX`“). Nur eine Standardkopplung bekommt eine Antwort;
/// die Direktkopplung ELW↔ELW ist kein Ziel (Entwurf, „Nicht-Ziele“).
pub async fn answer_hub(
    pool: &SqlitePool,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &SpiegelPaket,
    platz: usize,
) -> (Vec<RemoteTrackingPosition>, Vec<RemoteTrackingCandidates>) {
    if anfrage.tracking_requests.is_empty() && anfrage.tracking_candidates_wanted.is_empty() {
        return (Vec::new(), Vec::new());
    }
    if !matches!(kopplung.art(), InstanzKopplungArt::Standard) {
        return (Vec::new(), Vec::new());
    }
    match antworten(pool, eigen, kopplung, anfrage, platz).await {
        Ok(a) => a,
        Err(_) => {
            // Je Kopplung gezählt; weder Kennung noch Zugang noch Koordinaten stehen im Log.
            static FEHLER: SammelzeileJe = SammelzeileJe::neu();
            if let Some(f) = FEHLER.zaehlen(&kopplung.id.to_string()) {
                tracing::warn!(
                    anzahl = f.anzahl,
                    seit_s = f.seit_s,
                    "Ortungsanfragen des Gegenübers nicht beantwortet, Sammelzeile"
                );
            }
            (Vec::new(), Vec::new())
        }
    }
}

async fn antworten(
    pool: &SqlitePool,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &SpiegelPaket,
    platz: usize,
) -> Result<(Vec<RemoteTrackingPosition>, Vec<RemoteTrackingCandidates>), AppError> {
    // Restplatz in Bytes, siehe [`passt`].
    let mut rest = platz;
    let orgs = {
        let mut conn = pool.acquire().await?;
        repo::list_orgs_aktiv(&mut conn, kopplung.id).await?
    };
    // Org-Kennung der Abbildung (wie `org_wire` auf der erreichten Seite) → Org dieser Instanz.
    let org_von = |wire: &str| {
        orgs.iter()
            .find(|o| org_kennung(&eigen.kennung, o.org_id) == wire)
            .map(|o| o.org_id)
    };
    let jetzt = crate::zeit::jetzt();

    let mut positionen = Vec::new();
    for r in anfrage.tracking_requests.iter().take(TRACKING_ANFRAGEN_MAX) {
        let Some(org_id) = org_von(&r.org) else {
            continue;
        };
        if !crate::org::einstellungen::ortung_der_org(pool, org_id)
            .await?
            .im_einsatz
        {
            continue;
        }
        let zeile: Option<(f64, f64, String)> = sqlx::query_as(
            "SELECT p.lat, p.lon, p.gemessen_at \
             FROM position_letzte p JOIN einwurf_zugang z ON z.id = p.zugang_id \
             WHERE p.zugang_id = ? AND p.kennung = ? AND z.org_id = ? AND z.scope = ? \
               AND z.widerrufen_at IS NULL AND (z.gueltig_bis IS NULL OR z.gueltig_bis > ?)",
        )
        .bind(&r.access_id)
        .bind(&r.device_id)
        .bind(org_id)
        .bind(Scope::PositionenWrite.as_str())
        .bind(&jetzt)
        .fetch_optional(pool)
        .await?;
        if let Some((breite, laenge, measured_at)) = zeile {
            let p = RemoteTrackingPosition {
                org: r.org.clone(),
                access_id: r.access_id.clone(),
                device_id: r.device_id.clone(),
                lat: breite,
                lon: laenge,
                measured_at,
            };
            if passt(&mut rest, &p) {
                positionen.push(p);
            }
        }
    }

    let mut kandidaten: Vec<RemoteTrackingCandidates> = Vec::new();
    for wire in anfrage
        .tracking_candidates_wanted
        .iter()
        .take(orgs.len().max(1))
    {
        let Some(org_id) = org_von(wire) else {
            continue;
        };
        if kandidaten.iter().any(|k| &k.org == wire) {
            continue;
        }
        let enabled = crate::org::einstellungen::ortung_der_org(pool, org_id)
            .await?
            .im_einsatz;
        let mut eintrag = RemoteTrackingCandidates {
            org: wire.clone(),
            tracking_enabled: enabled,
            items: Vec::new(),
        };
        if !passt(&mut rest, &eintrag) {
            continue;
        }
        if enabled {
            // Die Liste kommt jüngste zuerst; was über die Obergrenze oder den Platz geht, fällt.
            for k in kopplung::list_kandidaten(pool, org_id, &jetzt)
                .await?
                .into_iter()
                .take(TRACKING_KANDIDATEN_MAX)
            {
                let item = RemoteTrackingCandidate {
                    access_id: k.zugang_id,
                    access_name: k.zugang_name,
                    device_id: k.kennung,
                    received_at: k.empfangen_at,
                };
                if !passt(&mut rest, &item) {
                    break;
                }
                eintrag.items.push(item);
            }
        }
        kandidaten.push(eintrag);
    }
    Ok((positionen, kandidaten))
}

/// Bucht `wert` vom Restplatz ab, wenn er hineinpasst: seine serialisierte Länge und ein Komma.
/// Das Komma fehlt vor dem ersten Element einer Liste; die Rechnung schätzt also nach oben.
fn passt<T: Serialize>(rest: &mut usize, wert: &T) -> bool {
    let kosten = serde_json::to_vec(wert)
        .map_or(usize::MAX, |v| v.len())
        .saturating_add(1);
    if kosten <= *rest {
        *rest -= kosten;
        true
    } else {
        false
    }
}

// ── Seite des ELW ────────────────────────────────────────────────────────────────────────────
//
// Das ELW fragt im Abgleich die Positionen seiner Hub-Kopplungen an und übernimmt die Antwort
// über den Positionsbaustein (Entwurf, „Übernahme am ELW“). Auf diesem Weg gibt es keinen
// Nachlauf: der nächste Abgleich bringt die jüngste Position ohnehin.

/// So lange gilt ein Wunsch nach der Kandidatenliste einer Org des Hubs.
const WUNSCH_DAUER: Duration = Duration::from_secs(60);

/// Schlüssel des Puffers: die Datenbank (Adresse des Pools, wie `NachlaufKey` in
/// `uebernahme.rs`), die Kopplung zum Hub und die eigene Org.
type PufferKey = (usize, i64, i64);

fn puffer_key(pool: &SqlitePool, instanz_kopplung_id: i64, org_id: i64) -> PufferKey {
    (
        std::ptr::from_ref(pool.options()) as usize,
        instanz_kopplung_id,
        org_id,
    )
}

/// Wünsche (bis wann) und zuletzt empfangene Kandidatenlisten, prozessweit.
#[derive(Default)]
struct Puffer {
    wuensche: HashMap<PufferKey, Instant>,
    kandidaten: HashMap<PufferKey, (Instant, RemoteTrackingCandidates)>,
}

static PUFFER: Mutex<Option<Puffer>> = Mutex::new(None);

fn puffer<T>(f: impl FnOnce(&mut Puffer) -> T) -> T {
    let mut g = PUFFER.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(Puffer::default))
}

/// Wünscht für 60 s die Kandidatenliste der Org beim Hub; der nächste Abgleich fragt sie an.
pub fn wish_candidates(pool: &SqlitePool, instanz_kopplung_id: i64, org_id: i64) {
    let bis = Instant::now() + WUNSCH_DAUER;
    puffer(|p| {
        p.wuensche
            .insert(puffer_key(pool, instanz_kopplung_id, org_id), bis);
    });
}

/// Die zuletzt empfangene Kandidatenliste der Org mit dem Zeitpunkt des Empfangs.
pub fn cached_candidates(
    pool: &SqlitePool,
    instanz_kopplung_id: i64,
    org_id: i64,
) -> Option<(Instant, RemoteTrackingCandidates)> {
    puffer(|p| {
        p.kandidaten
            .get(&puffer_key(pool, instanz_kopplung_id, org_id))
            .cloned()
    })
}

/// Die Anfragefelder des nächsten Abgleichs: je Hub-Kopplung eines aktiven Fahrzeugs eines
/// aktiven, nicht gespiegelten Einsatzes mit eingeschaltetem Org-Schalter eine Positionsanfrage,
/// dazu die Org-Kennungen, deren Kandidatenliste gewünscht ist. `org` ist die Kennung der Org
/// beim Hub (`fremde_org_kennung`).
///
/// Fehlerfrei nach außen (Entwurf, „Abgleich“): ein Fehler zählt eine Sammelzeile ohne Kennung
/// und liefert leere Listen, der übrige Abgleich läuft weiter.
pub async fn build_requests(
    pool: &SqlitePool,
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
) -> (Vec<RemoteTrackingRequest>, Vec<String>) {
    match anfragen_bauen(pool, conn, kopplung).await {
        Ok(a) => a,
        Err(_) => {
            // Je Kopplung gezählt; weder Kennung noch Zugang noch Koordinaten stehen im Log.
            static FEHLER: SammelzeileJe = SammelzeileJe::neu();
            if let Some(f) = FEHLER.zaehlen(&kopplung.id.to_string()) {
                tracing::warn!(
                    anzahl = f.anzahl,
                    seit_s = f.seit_s,
                    "Ortungsanfragen an den Hub nicht gebaut, Sammelzeile"
                );
            }
            (Vec::new(), Vec::new())
        }
    }
}

async fn anfragen_bauen(
    pool: &SqlitePool,
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
) -> Result<(Vec<RemoteTrackingRequest>, Vec<String>), AppError> {
    let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
    let wire_von = |org_id: i64| {
        orgs.iter()
            .find(|o| o.org_id == org_id)
            .map(|o| o.fremde_org_kennung.clone())
    };
    let zeilen: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT k.org_id, k.fremder_zugang_id, k.kennung \
         FROM ortung_kopplung k \
         JOIN einsatz_fahrzeug ef ON ef.id = k.einsatz_fahrzeug_id AND ef.beendet_at IS NULL \
         JOIN einsatz e ON e.id = ef.einsatz_id AND e.status = 'aktiv' AND e.spiegel = 0 \
         JOIN org_einstellungen o ON o.org_id = k.org_id AND o.ortung_im_einsatz = 1 \
         WHERE k.instanz_kopplung_id = ? \
         ORDER BY k.einsatz_fahrzeug_id LIMIT ?",
    )
    .bind(kopplung.id)
    .bind(TRACKING_ANFRAGEN_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    let anfragen = zeilen
        .into_iter()
        .filter_map(|(org_id, access_id, device_id)| {
            Some(RemoteTrackingRequest {
                org: wire_von(org_id)?,
                access_id,
                device_id,
            })
        })
        .collect();

    let jetzt = Instant::now();
    let mut gewuenscht: Vec<String> = puffer(|p| {
        p.wuensche.retain(|_, bis| *bis > jetzt);
        orgs.iter()
            .filter(|o| {
                p.wuensche
                    .contains_key(&puffer_key(pool, kopplung.id, o.org_id))
            })
            .map(|o| o.fremde_org_kennung.clone())
            .collect()
    });
    gewuenscht.truncate(TRACKING_ANFRAGEN_MAX);
    Ok((anfragen, gewuenscht))
}

/// Übernimmt die Ortungsfelder der Antwort des Hubs: Kandidatenlisten in den Puffer, jede
/// Position in einer eigenen Schreibtransaktion, danach die Live-Meldung. Fehlerfrei nach außen:
/// ein Fehler zählt eine Sammelzeile ohne Kennung und Koordinaten; ein älterer Hub liefert leere
/// Listen, dann geschieht nichts.
pub async fn apply_answer(pool: &SqlitePool, kopplung: &KopplungZeile, antwort: &SpiegelPaket) {
    if antwort.tracking_positions.is_empty() && antwort.tracking_candidates.is_empty() {
        return;
    }
    let orgs = {
        let Ok(mut conn) = pool.acquire().await else {
            return zaehle_fehler(kopplung);
        };
        match repo::list_orgs_aktiv(&mut conn, kopplung.id).await {
            Ok(o) => o,
            Err(_) => return zaehle_fehler(kopplung),
        }
    };
    let org_von = |wire: &str| {
        orgs.iter()
            .find(|o| o.fremde_org_kennung == wire)
            .map(|o| o.org_id)
    };

    let jetzt_instant = Instant::now();
    for k in &antwort.tracking_candidates {
        if let Some(org_id) = org_von(&k.org) {
            puffer(|p| {
                p.kandidaten.insert(
                    puffer_key(pool, kopplung.id, org_id),
                    (jetzt_instant, k.clone()),
                );
            });
        }
    }

    for p in antwort
        .tracking_positions
        .iter()
        .take(TRACKING_ANFRAGEN_MAX)
    {
        // Die Position gilt nur für Kopplungszeilen genau der Org, unter der sie kam (ADR-0109).
        let Some(org_id) = org_von(&p.org) else {
            continue;
        };
        let jetzt = crate::zeit::jetzt();
        let ergebnis = write_retry!(pool, |conn| {
            apply_remote_position_tx(
                conn,
                kopplung.id,
                org_id,
                &p.access_id,
                &p.device_id,
                p.lat,
                p.lon,
                &p.measured_at,
                &jetzt,
            )
            .await
        });
        match ergebnis {
            Ok(Uebernahme::Geschrieben { einsatz_id, ef_id }) => {
                if let Some(live) = crate::instanz::stammdaten::live() {
                    live.publiziere_objekt(
                        einsatz_id,
                        crate::live::LiveEvent::Fahrzeug,
                        "fahrzeug_id",
                        ef_id,
                    );
                }
            }
            Ok(_) => {}
            Err(_) => zaehle_fehler(kopplung),
        }
    }
}

fn zaehle_fehler(kopplung: &KopplungZeile) {
    // Je Kopplung gezählt; weder Kennung noch Zugang noch Koordinaten stehen im Log.
    static FEHLER: SammelzeileJe = SammelzeileJe::neu();
    if let Some(f) = FEHLER.zaehlen(&kopplung.id.to_string()) {
        tracing::warn!(
            anzahl = f.anzahl,
            seit_s = f.seit_s,
            "Ortungsantwort des Hubs nicht übernommen, Sammelzeile"
        );
    }
}

/// Testhaken: leert den Puffer der Kandidatenliste und den Wunsch der Org, wie nach Verfall.
pub fn clear_candidates(pool: &SqlitePool, instanz_kopplung_id: i64, org_id: i64) {
    let key = puffer_key(pool, instanz_kopplung_id, org_id);
    puffer(|p| {
        p.kandidaten.remove(&key);
        p.wuensche.remove(&key);
    });
}
