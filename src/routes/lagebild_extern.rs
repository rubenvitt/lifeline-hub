//! Lagebild für Externe (LLH-1496, Spec `lagebild-extern`): Freigaben der Einsatzleitung und der
//! öffentliche Abruf `GET /api/extern/v1/lagebild`.
//!
//! Herleitung: `/mnt/project-files/llh-1496/openspec/k11guwns-lagebild-extern/design.md`. Die
//! Zahlen und die Karte kommen aus derselben Verdichtung wie beim externen Lagemonitor
//! ([`super::lagemonitor::verdichte`], [`super::lagemonitor_v1`]). Wie dort gilt: **keine Namen,
//! keine Personenkennungen, keine freien Notizen**; die Stufe `oeffentlich` zeigt nur
//! Gesamtzahlen, den Einsatzort und die Absperrungen.
//!
//! Die Ansicht funktioniert an jeder Instanz, die den Einsatz hat, geführt oder als Spiegel
//! (ADR-0018: derselbe Code). Am Spiegel nennt die Antwort den letzten Abgleich mit dem Führer, und
//! ein Feld fehlt, wenn die Freigabestufe des Spiegels eine seiner Kategorien nicht liefert
//! ([`FELD_QUELLEN`], design.md D5).

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use crate::etb::EtbTyp;
use crate::extract::{JsonBody, PfadParam};
use crate::instanz::spiegel::{Freigabestufe, SpiegelKategorie};
use crate::lage_zone::LageZoneTyp;
use crate::lagebild_extern::{
    self as lagebild, LagebildDauer, LagebildFreigabeAnzeige, LagebildStufe, LagebildZugriff,
    EMPFAENGER_MAX,
};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqliteConnection;
use utoipa::ToSchema;

use super::lagemonitor::{verdichte, LagemonitorBetroffene, LagemonitorKraefte};
use super::lagemonitor_v1::{
    baue_karte, karte_etag, lagemeldung, LageQuery, LagemonitorLagemeldung, LagemonitorUhsZahl,
    KARTE_AUS,
};

/// Version des Drahtformats (`/v1`). Neue Felder kommen nur hinzu; wer eines entfernt oder
/// umdeutet, erhöht die Version.
pub const API_VERSION: u32 = 1;

/// Kopf, mit dem die Seite ihre Öffnung nennt (Protokoll, design.md D6).
pub const OEFFNUNG_KOPF: &str = "x-lagebild-oeffnung";

/// Je Feld des Einsatzes in der Antwort (und `karte`) die Tabellen, aus denen es stammt
/// (design.md D5). Ihre Kategorien nennt `instanz::spiegel::art::kategorie`; liefert die
/// Freigabestufe eines Spiegels eine davon nicht, fehlt das Feld und steht in
/// `nicht_uebertragen`. Wächter: `tests::jedes_feld_hat_quellen_mit_kategorie`.
pub const FELD_QUELLEN: &[(&str, &[&str])] = &[
    ("bezeichnung", &["einsatz"]),
    ("stichwort", &["einsatz"]),
    ("einsatzart", &["einsatz"]),
    ("begonnen_at", &["einsatz"]),
    ("betroffene_gesamt", &["einsatz_person"]),
    ("betroffene", &["einsatz_person"]),
    (
        "sanitaetsdienst",
        &["einsatz_person", "einsatz_lagekennzahl_wahl"],
    ),
    ("einsatzkraefte_gesamt", &["einsatz_personal"]),
    ("kraefte", &["einsatz_einheit", "einsatz_personal"]),
    (
        "uhs",
        &["uhs", "uhs_platz", "einsatz_person", "einsatz_personal"],
    ),
    ("lagemeldung", &["lagebericht"]),
    (
        "karte",
        &[
            "einsatz",
            "lage_zone",
            "einsatzabschnitt",
            "uhs",
            "uhs_platz",
            "einsatz_person",
            "freies_zeichen",
        ],
    ),
];

/// Zonen, die die Stufe `oeffentlich` zeigt: Absperrungen und Sperrgebiete.
const OEFFENTLICHE_ZONEN: &[LageZoneTyp] = &[
    LageZoneTyp::Absperrbereich,
    LageZoneTyp::Absperrgrenze,
    LageZoneTyp::Sperrgebiet,
];

// ---------------------------------------------------------------------------------------------
// Freigaben der Einsatzleitung
// ---------------------------------------------------------------------------------------------

/// Darf die Einsatzleitung hier freigeben? Aktiver Einsatz, und diese Instanz führt ihn oder hält
/// ihn als Spiegel (design.md D2). Führt eine andere Instanz, ohne dass hier ein Spiegel liegt,
/// fehlt der Weg für den ETB-Eintrag: 409 wie jeder Schreibweg (LLH-1491).
fn fordere_freigabe_moeglich(ctx: &EinsatzLesezugriff) -> Result<(), AppError> {
    ctx.fordere_einsatzleitung()?;
    if !ctx.einsatz.ist_aktiv() {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    if !ctx.einsatz.spiegel.spiegel_ist {
        if let Some(bei) = &ctx.einsatz.fuehrung.fuehrung_bei {
            return Err(crate::einsatz::berechtigung::fuehrung_error(bei));
        }
    }
    Ok(())
}

/// Prüfung in der Transaktion: beim Führer Status und Führung (`fordere_aktiv_in_tx`, die
/// Sperre „Führung liegt bei …“), am Spiegel nur der Status, denn dort führt immer die andere
/// Instanz und der Eintrag geht als Antrag.
async fn im_tx_aktiv(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    spiegel: bool,
) -> Result<(), AppError> {
    if !spiegel {
        return crate::einsatz::repo::fordere_aktiv_in_tx(conn, einsatz_id).await;
    }
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    if status.as_deref() != Some("aktiv") {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    Ok(())
}

/// Schreibt den ETB-Eintrag einer Freigabe (design.md D7): beim Führer als Systemeintrag, am
/// Spiegel als Antrag an den Führer. Liefert die id eines direkt geschriebenen Eintrags.
async fn etb_vermerken(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    spiegel: Option<SpiegelEintrag<'_>>,
    von: i64,
    text: &str,
) -> Result<Option<i64>, AppError> {
    if let Some(s) = spiegel {
        crate::instanz::spiegel::antrag::etb_beantragen_tx(
            conn,
            einsatz_id,
            von,
            EtbTyp::Entscheidung,
            text,
            s.von,
            s.an,
        )
        .await?;
        return Ok(None);
    }
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    Ok(Some(
        crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, text).await?,
    ))
}

/// Von und An des Antrags am Spiegel: beim Führer ist es eine Entscheidung der Person an den
/// Empfänger des Links.
#[derive(Clone, Copy)]
struct SpiegelEintrag<'a> {
    von: &'a str,
    an: &'a str,
}

fn stufe_wort(stufe: LagebildStufe) -> &'static str {
    match stufe {
        LagebildStufe::Lagebild => "Lagebild",
        LagebildStufe::Oeffentlich => "Öffentlich",
    }
}

fn dauer_wort(dauer: LagebildDauer) -> &'static str {
    match dauer {
        LagebildDauer::ZweiStunden => "2 Stunden",
        LagebildDauer::ZwoelfStunden => "12 Stunden",
        LagebildDauer::VierundzwanzigStunden => "24 Stunden",
        LagebildDauer::Einsatzende => "bis zum Einsatzende",
    }
}

/// GET /api/einsaetze/{id}/lagebild-freigaben — die Links dieses Einsatzes an dieser Instanz,
/// mit Protokoll. Nur die Einsatzleitung, wie die Geräte.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<Vec<LagebildFreigabeAnzeige>>, AppError> {
    ctx.fordere_einsatzleitung()?;
    Ok(Json(lagebild::liste(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueLagebildFreigabe {
    pub empfaenger: String,
    pub stufe: LagebildStufe,
    pub dauer: LagebildDauer,
}

/// Eine frisch angelegte Freigabe. Der Schlüssel verlässt den Server nur hier, einmal.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagebildFreigabeMitSchluessel {
    pub freigabe: LagebildFreigabeAnzeige,
    pub schluessel: String,
}

/// POST /api/einsaetze/{id}/lagebild-freigaben — legt einen Link an. Der ETB-Eintrag entsteht
/// in derselben Transaktion, am Spiegel als Antrag.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    JsonBody(body): JsonBody<NeueLagebildFreigabe>,
) -> Result<(StatusCode, Json<LagebildFreigabeMitSchluessel>), AppError> {
    fordere_freigabe_moeglich(&ctx)?;
    let empfaenger =
        crate::routes::support::pflicht_max(&body.empfaenger, "empfaenger", EMPFAENGER_MAX)?;
    let einsatz_id = ctx.einsatz.id;
    let spiegel = ctx.einsatz.spiegel.spiegel_ist;
    let von = ctx.benutzer.id;
    let text = format!(
        "Lagebild für Externe an „{empfaenger}“ freigegeben (Stufe {}, gültig {}) von {}.",
        stufe_wort(body.stufe),
        dauer_wort(body.dauer),
        ctx.benutzer.anzeigename
    );
    let schluessel = lagebild::neuer_schluessel();
    let schluessel_hash = lagebild::hash(&schluessel);
    let (id, etb_id) = crate::write_retry!(&state.pool, |conn| {
        // Der Extractor sah den Stand vor der Transaktion; ein Abschluss oder eine
        // Führungsübergabe dazwischen darf keinen Link hinterlassen.
        im_tx_aktiv(conn, einsatz_id, spiegel).await?;
        let (id, _) = lagebild::anlegen_tx(
            conn,
            einsatz_id,
            &empfaenger,
            body.stufe,
            body.dauer,
            &schluessel_hash,
            von,
        )
        .await?;
        let am_spiegel = spiegel.then_some(SpiegelEintrag {
            von: &ctx.benutzer.anzeigename,
            an: &empfaenger,
        });
        let etb_id = etb_vermerken(conn, einsatz_id, am_spiegel, von, &text).await?;
        Ok((id, etb_id))
    })?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    let freigabe = lagebild::laden(&state.pool, einsatz_id, id).await?;
    Ok((
        StatusCode::CREATED,
        Json(LagebildFreigabeMitSchluessel {
            freigabe,
            schluessel,
        }),
    ))
}

/// POST /api/einsaetze/{id}/lagebild-freigaben/{fid}/widerrufen — der Link gilt sofort nicht
/// mehr. Idempotent; das ETB nennt nur die Wirkung.
pub async fn widerrufen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    PfadParam((_eid, freigabe_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<LagebildFreigabeAnzeige>>, AppError> {
    fordere_freigabe_moeglich(&ctx)?;
    let einsatz_id = ctx.einsatz.id;
    let spiegel = ctx.einsatz.spiegel.spiegel_ist;
    let von = ctx.benutzer.id;
    let name = ctx.benutzer.anzeigename.clone();
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        im_tx_aktiv(conn, einsatz_id, spiegel).await?;
        match lagebild::widerrufen_tx(conn, einsatz_id, freigabe_id, von).await? {
            None => Ok(None),
            // Abgleich beendet: der Widerruf muss trotzdem gelten, nur der Antrag entfällt.
            // Sonst bliebe ein Link „bis Einsatzende“ am Spiegel offen, solange er aktiv ist.
            Some(_)
                if spiegel
                    && !crate::instanz::spiegel::antrag::abgleich_laeuft_tx(conn, einsatz_id)
                        .await? =>
            {
                Ok(None)
            }
            Some(empfaenger) => {
                let text = format!("Lagebild für Externe an „{empfaenger}“ widerrufen von {name}.");
                let am_spiegel = spiegel.then_some(SpiegelEintrag {
                    von: &name,
                    an: &empfaenger,
                });
                etb_vermerken(conn, einsatz_id, am_spiegel, von, &text).await
            }
        }
    })?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(lagebild::liste(&state.pool, einsatz_id).await?))
}

// ---------------------------------------------------------------------------------------------
// Öffentlicher Abruf
// ---------------------------------------------------------------------------------------------

/// Antwort der öffentlichen Route.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagebildExtern {
    pub api_version: u32,
    /// Zeitpunkt der Berechnung (UTC, SQLite-Format).
    pub stand_at: String,
    pub stufe: LagebildStufe,
    /// Für wen die Einsatzleitung den Link ausgegeben hat.
    pub empfaenger: String,
    /// Ende der Gültigkeit (UTC); fehlt bei „bis Einsatzende“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gueltig_bis: Option<String>,
    pub quelle: LagebildQuelle,
    pub einsatz: LagebildEinsatz,
    /// Felder, die fehlen, weil die Freigabestufe des Spiegels ihre Kategorie nicht liefert.
    pub nicht_uebertragen: Vec<String>,
    /// Karte als GeoJSON-FeatureCollection; fehlt bei `?karte=aus`, wenn sie der Fassung aus
    /// `?karte=<etag>` gleicht oder nicht übertragen ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::karte::typen::GeoJsonFeatureCollection>)]
    pub karte: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karte_etag: Option<String>,
}

/// Woher die Zahlen kommen: geführt hier oder Spiegel einer anderen Instanz.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagebildQuelle {
    /// Der Einsatz ist an dieser Instanz ein Spiegel.
    pub spiegel: bool,
    /// Letzter erfolgreicher Abgleich mit der führenden Instanz (UTC); nur am Spiegel.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_abgleich_at: Option<String>,
    /// Der Abgleich ist beendet; die Zahlen werden nicht mehr aktuell.
    pub abgleich_beendet: bool,
}

/// Der Einsatz, ohne Sachverhalt, Adresse und meldende Stelle. Die Stufe `oeffentlich` trägt nur
/// die Kopfangaben und die beiden Gesamtzahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagebildEinsatz {
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub einsatzart: Einsatzart,
    pub begonnen_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betroffene_gesamt: Option<i64>,
    /// Nur Stufe `lagebild`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betroffene: Option<LagemonitorBetroffene>,
    /// Nur Stufe `lagebild` und nur bei gewählter Kennzahl Sanitätsdienst.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitaetsdienst: Option<super::lagemonitor::LagemonitorSanitaetsdienst>,
    /// Eingesetztes Personal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzkraefte_gesamt: Option<i64>,
    /// Nur Stufe `lagebild`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kraefte: Option<LagemonitorKraefte>,
    /// Nur Stufe `lagebild`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhs: Option<Vec<LagemonitorUhsZahl>>,
    /// Nur Stufe `lagebild`: Zusammenfassung des jüngsten freigegebenen Lageberichts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lagemeldung: Option<LagemonitorLagemeldung>,
}

/// Die Kategorien, aus denen ein Feld stammt.
fn kategorien(feld: &str) -> Vec<SpiegelKategorie> {
    FELD_QUELLEN
        .iter()
        .find(|(f, _)| *f == feld)
        .map(|(_, tabellen)| {
            tabellen
                .iter()
                .filter_map(|t| crate::instanz::spiegel::art::kategorie(t))
                .collect()
        })
        .unwrap_or_default()
}

/// Liefert die Stufe alle Kategorien des Felds? Eine unbekannte Stufe liefert nichts.
fn uebertragen(stufe: Option<Freigabestufe>, feld: &str) -> bool {
    match stufe {
        None => false,
        Some(s) => kategorien(feld).into_iter().all(|k| s.liefert(k)),
    }
}

/// GET /api/extern/v1/lagebild — das Lagebild des Links. Ohne wirksamen Schlüssel 401.
pub async fn abruf(
    State(state): State<AppState>,
    zugriff: LagebildZugriff,
    headers: HeaderMap,
    Query(query): Query<LageQuery>,
) -> Result<Json<LagebildExtern>, AppError> {
    let pool = &state.pool;
    let oeffnung = lagebild::oeffnung_aus(headers.get(OEFFNUNG_KOPF).and_then(|v| v.to_str().ok()));
    lagebild::abruf_vermerken(pool, zugriff.freigabe_id, &oeffnung).await;

    let (empfaenger, gueltig_bis): (String, Option<String>) =
        sqlx::query_as("SELECT empfaenger, gueltig_bis FROM lagebild_freigabe WHERE id = ?")
            .bind(zugriff.freigabe_id)
            .fetch_one(pool)
            .await?;
    let kopf = crate::einsatz::repo::laden(pool, zugriff.einsatz_id).await?;
    // Die Freigabestufe gilt nur am Spiegel; geführt liegt hier alles (design.md D5).
    let stufe_spiegel: Option<String> =
        sqlx::query_scalar("SELECT freigabestufe FROM einsatz_spiegel WHERE einsatz_id = ?")
            .bind(kopf.id)
            .fetch_optional(pool)
            .await?;
    let freigabestufe = match &stufe_spiegel {
        Some(s) => Freigabestufe::parse(s),
        None => Some(Freigabestufe::Alles),
    };
    let quelle = LagebildQuelle {
        spiegel: kopf.spiegel.spiegel_ist,
        letzter_abgleich_at: kopf
            .spiegel
            .spiegel_ist
            .then(|| kopf.spiegel.spiegel_abgleich_at.clone())
            .flatten(),
        abgleich_beendet: kopf.spiegel.spiegel_beendet_at.is_some(),
    };

    let verdichtet = verdichte(pool, kopf.id).await?;
    let voll = zugriff.stufe == LagebildStufe::Lagebild;
    let mut nicht_uebertragen = Vec::new();
    let mut nimm = |feld: &'static str, zeigen: bool| -> bool {
        if !zeigen {
            return false;
        }
        if uebertragen(freigabestufe, feld) {
            true
        } else {
            nicht_uebertragen.push(feld.to_string());
            false
        }
    };

    let zeige_betroffene_gesamt = nimm("betroffene_gesamt", true);
    let zeige_betroffene = nimm("betroffene", voll);
    let zeige_san = nimm(
        "sanitaetsdienst",
        voll && verdichtet.sanitaetsdienst.is_some(),
    );
    let zeige_kraefte_gesamt = nimm("einsatzkraefte_gesamt", true);
    let zeige_kraefte = nimm("kraefte", voll);
    let zeige_uhs = nimm("uhs", voll);
    let zeige_lagemeldung = nimm("lagemeldung", voll);
    let zeige_karte = nimm("karte", query.karte.as_deref() != Some(KARTE_AUS));

    let (karte, karte_etag) = if zeige_karte {
        let mut karte = baue_karte(pool, &kopf, &verdichtet).await?;
        if !voll {
            nur_oeffentliche_features(&mut karte);
        }
        let etag = karte_etag(&karte);
        let gleich = query.karte.as_deref() == Some(etag.as_str());
        ((!gleich).then_some(karte), Some(etag))
    } else {
        (None, None)
    };

    let lagemeldung = if zeige_lagemeldung {
        lagemeldung(pool, kopf.id).await?
    } else {
        None
    };
    let einsatz = LagebildEinsatz {
        bezeichnung: kopf.bezeichnung,
        stichwort: kopf.stichwort,
        einsatzart: kopf.einsatzart,
        begonnen_at: kopf.begonnen_at,
        betroffene_gesamt: zeige_betroffene_gesamt.then_some(verdichtet.betroffene.gesamt),
        einsatzkraefte_gesamt: zeige_kraefte_gesamt.then_some(verdichtet.kraefte.personal),
        sanitaetsdienst: if zeige_san {
            verdichtet.sanitaetsdienst
        } else {
            None
        },
        betroffene: zeige_betroffene.then_some(verdichtet.betroffene),
        kraefte: zeige_kraefte.then_some(verdichtet.kraefte),
        uhs: zeige_uhs.then(|| {
            verdichtet
                .uhs
                .into_iter()
                .map(|u| LagemonitorUhsZahl {
                    id: u.id,
                    bezeichnung: u.bezeichnung,
                    typ: u.typ,
                    status: u.status,
                    belegt: u.belegt,
                    plaetze: u.plaetze,
                    kraefte: u.kraefte,
                })
                .collect()
        }),
        lagemeldung,
    };
    Ok(Json(LagebildExtern {
        api_version: API_VERSION,
        stand_at: crate::zeit::jetzt(),
        stufe: zugriff.stufe,
        empfaenger,
        gueltig_bis,
        quelle,
        einsatz,
        nicht_uebertragen,
        karte,
        karte_etag,
    }))
}

/// Stufe `oeffentlich`: nur der Einsatzort und die Zonen aus [`OEFFENTLICHE_ZONEN`].
fn nur_oeffentliche_features(karte: &mut Value) {
    let erlaubt: Vec<&str> = OEFFENTLICHE_ZONEN.iter().map(|z| z.as_str()).collect();
    if let Some(features) = karte.get_mut("features").and_then(Value::as_array_mut) {
        features.retain(|f| {
            let p = &f["properties"];
            match p["kind"].as_str() {
                Some("einsatzort") => true,
                Some("zone") => p["typ"].as_str().is_some_and(|t| erlaubt.contains(&t)),
                _ => false,
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jedes_feld_hat_quellen_mit_kategorie() {
        // Jede Quelle ist eine gespiegelte Tabelle mit Kategorie.
        for (feld, tabellen) in FELD_QUELLEN {
            assert!(!tabellen.is_empty(), "{feld} ohne Quelle");
            for t in *tabellen {
                assert!(
                    crate::instanz::spiegel::art::kategorie(t).is_some(),
                    "{feld}: Tabelle {t} ist nicht gespiegelt oder ohne Kategorie"
                );
            }
        }
        // Jedes Feld des Einsatzes und die Karte stehen in der Liste.
        let einsatz = LagebildEinsatz {
            bezeichnung: String::new(),
            stichwort: Some(String::new()),
            einsatzart: Einsatzart::ALLE[0],
            begonnen_at: String::new(),
            betroffene_gesamt: Some(0),
            betroffene: Some(LagemonitorBetroffene::default()),
            sanitaetsdienst: Some(super::super::lagemonitor::LagemonitorSanitaetsdienst {
                kontakte: 0,
                kontakte_letzte_stunde: 0,
                in_versorgung: 0,
                transporte: 0,
            }),
            einsatzkraefte_gesamt: Some(0),
            kraefte: Some(LagemonitorKraefte {
                einheiten: 0,
                personal: 0,
                staerke: crate::staerke::Staerke::neu(0, 0, 0),
            }),
            uhs: Some(Vec::new()),
            lagemeldung: Some(LagemonitorLagemeldung {
                text: String::new(),
                freigegeben_at: String::new(),
            }),
        };
        let wert = serde_json::to_value(&einsatz).unwrap();
        let mut felder: Vec<&str> = wert
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        felder.push("karte");
        for feld in felder {
            assert!(
                FELD_QUELLEN.iter().any(|(f, _)| *f == feld),
                "Feld {feld} fehlt in FELD_QUELLEN"
            );
        }
    }

    #[test]
    fn alles_uebertraegt_jedes_feld_unbekannt_keines() {
        for (feld, _) in FELD_QUELLEN {
            assert!(uebertragen(Some(Freigabestufe::Alles), feld));
            assert!(!uebertragen(None, feld));
        }
    }

    #[test]
    fn oeffentlich_behaelt_nur_einsatzort_und_absperrungen() {
        let mut karte = json!({"type": "FeatureCollection", "features": [
            {"properties": {"kind": "einsatzort"}},
            {"properties": {"kind": "zone", "typ": "gefahrengebiet"}},
            {"properties": {"kind": "zone", "typ": "absperrbereich"}},
            {"properties": {"kind": "zone", "typ": "sperrgebiet"}},
            {"properties": {"kind": "uhs", "belegt": 3}},
            {"properties": {"kind": "abschnitt"}},
            {"properties": {"kind": "zeichen"}},
        ]});
        nur_oeffentliche_features(&mut karte);
        let arten: Vec<String> = karte["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| {
                format!(
                    "{}:{}",
                    f["properties"]["kind"].as_str().unwrap(),
                    f["properties"]["typ"].as_str().unwrap_or("")
                )
            })
            .collect();
        assert_eq!(
            arten,
            ["einsatzort:", "zone:absperrbereich", "zone:sperrgebiet"]
        );
    }
}
