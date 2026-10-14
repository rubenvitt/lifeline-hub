//! Kräfte gesammelt disponieren (LLH-1100, Spec `kraefte-disposition`, Change
//! `iw7x9980-sammel-disposition`).
//!
//! Der gemeinsame Baustein „disponieren und zuordnen in einer Transaktion“: mehrere Stamm-Personen
//! (oder Stamm-Fahrzeuge) auf einer offenen Verbindung disponieren und optional einer Einheit und
//! einem Fahrzeug zuordnen. Alles oder nichts: zuerst prüft **eine** Mengenabfrage jede ID
//! ([`check_personal_tx`], [`check_fahrzeuge_tx`]) und lehnt mit Gründen je Zeile ab
//! ([`AppError::Zeilen`], 422), erst danach wird je Kraft geschrieben (`src/AGENTS.md`,
//! „Eingabegrenzen“, Ausnahme Sammel-Disposition). Der Baustein schreibt kein ETB und sendet
//! nichts; das tut der Aufrufer (ETB in der Transaktion, Ereignisse nach dem Commit).
//!
//! Wiederverwendet von LLH-1049 (Einheit aus Vorlage) und LLH-1036 (Person aus dem Stamm in der
//! Einheit-Ansicht); deshalb ist die Regel für schon disponierte und entlassene Kräfte ein
//! Parameter ([`Regeln`]).

use crate::einheit::mitglied_repo;
use crate::error::{AppError, ZeilenArt, ZeilenGrund};
use crate::fahrzeug::besatzung_repo;
use crate::katalog::DIENSTSTATUS_IN_DIENST;
use crate::personal::disposition_repo;
use sqlx::SqliteConnection;

/// Höchstens so viele Kräfte je Sammel-Disposition, gezählt vor dem Entdoppeln (D9, wie
/// `auftrag::EMPFAENGER_MAX`). Ein Zug hat rund 22 Kräfte. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const SAMMEL_MAX: usize = 50;

/// Grund: die ID ist unbekannt oder gehört einer anderen Organisation.
pub const GRUND_UNBEKANNT: &str = "unbekannt";
/// Grund: die Stamm-Kraft steht außer Dienst.
pub const GRUND_AUSSER_DIENST: &str = "außer Dienst";
/// Grund: die Kraft ist in diesem Einsatz schon aktiv disponiert.
pub const GRUND_SCHON_DISPONIERT: &str = "schon disponiert";
/// Grund: die Kraft wurde aus diesem Einsatz entlassen (LLH-1079); der Sammelweg nimmt sie nicht
/// still wieder auf (Nachtrag 13.10.2026), der Rückweg ist „Erneut disponieren“.
pub const GRUND_ENTLASSEN: &str = "entlassen";

/// Meldung des 422 mit Gründen je Zeile.
pub const MELDUNG_ZEILEN: &str = "Nicht alle Kräfte lassen sich disponieren";

/// Wie eine Kraft behandelt wird, die in diesem Einsatz entlassen ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntlasseneRegel {
    /// Ablehnen mit dem Grund [`GRUND_ENTLASSEN`] (Sammelweg).
    Ablehnen,
    /// Wieder aufnehmen wie „Erneut disponieren“ (Einzelweg, LLH-1079 D7).
    Reaktivieren,
}

/// Die Regeln der Vorprüfung, die ein Aufrufer wählt (D2). Eine stornierte Kraft (Fehldisposition)
/// gilt nie als disponiert und wird wieder aufgenommen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Regeln {
    pub entlassene: EntlasseneRegel,
}

impl Regeln {
    /// Sammelweg: schon disponiert und entlassen lehnen ab.
    pub const SAMMEL: Regeln = Regeln {
        entlassene: EntlasseneRegel::Ablehnen,
    };
    /// Einzelweg einer Stamm-Person: eine entlassene wird wieder aufgenommen (LLH-1079 D7).
    pub const EINZEL: Regeln = Regeln {
        entlassene: EntlasseneRegel::Reaktivieren,
    };
}

/// Wer in welchem Einsatz disponiert.
#[derive(Debug, Clone, Copy)]
pub struct Kontext {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub benutzer_id: i64,
}

/// Eine Stamm-Person und ihre optionale Stärke-Position (LLH-1049 setzt sie aus der Vorlage).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalWahl {
    pub personal_id: i64,
    pub staerke_position: Option<String>,
}

/// Optionale Ziele einer Personal-Disposition: Einheit und Fahrzeug des Einsatzes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Ziel {
    pub einheit_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
}

/// Eine disponierte Kraft mit dem, was der Aufrufer für ETB-Text und Ereignisse braucht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisponiertePerson {
    pub ep_id: i64,
    pub name: String,
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    /// Eine beendete Zeile derselben Person wurde wieder aufgenommen.
    pub reaktiviert: bool,
}

/// Ein benanntes Ziel (ID und Name für den ETB-Text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZielName {
    pub id: i64,
    pub name: String,
}

/// Ergebnis von [`disponiere_personal_tx`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalErgebnis {
    pub kraefte: Vec<DisponiertePerson>,
    pub einheit: Option<ZielName>,
    pub fahrzeug: Option<ZielName>,
}

/// Ein disponiertes Fahrzeug.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisponiertesFahrzeug {
    pub ef_id: i64,
    pub funkrufname: String,
    /// Eine stornierte Zeile desselben Fahrzeugs wieder aufgenommen (LLH-1079, D7)?
    pub reaktiviert: bool,
}

/// Ergebnis von [`disponiere_fahrzeuge_tx`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FahrzeugErgebnis {
    pub fahrzeuge: Vec<DisponiertesFahrzeug>,
    pub einheit: Option<ZielName>,
}

/// Entdoppelt eine ID-Liste und behält die Reihenfolge des ersten Auftretens.
pub fn dedupe<T: Clone, K: PartialEq>(liste: &[T], schluessel: impl Fn(&T) -> K) -> Vec<T> {
    let mut aus: Vec<T> = Vec::with_capacity(liste.len());
    for e in liste {
        if !aus.iter().any(|a| schluessel(a) == schluessel(e)) {
            aus.push(e.clone());
        }
    }
    aus
}

/// Prüft eine ID-Liste von außen vor jeder Abfrage (`src/AGENTS.md`, „Eingabegrenzen“): leer →
/// 400, mehr als [`SAMMEL_MAX`] (gezählt vor dem Entdoppeln) → 400; liefert sie entdoppelt.
pub fn check_ids(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    if ids.is_empty() {
        return Err(AppError::Validation("Mindestens eine Kraft wählen".into()));
    }
    if ids.len() > SAMMEL_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {SAMMEL_MAX} Kräfte je Disposition"
        )));
    }
    Ok(dedupe(ids, |id| *id))
}

fn ids_json(ids: &[i64]) -> String {
    serde_json::to_string(ids).expect("Zahlenliste ist serialisierbar")
}

/// Mengen-Vorprüfung der Personal-IDs (D2) in **einer** Anweisung über `json_each`: unbekannt oder
/// fremd, schon disponiert, entlassen (nach [`Regeln`]), außer Dienst. Liefert je abgelehnter ID
/// einen Grund, in der Reihenfolge der Eingabe; leer = alles disponierbar.
pub async fn check_personal_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    personal_ids: &[i64],
    regeln: Regeln,
) -> Result<Vec<ZeilenGrund>, AppError> {
    // Liest absichtlich auch beendete Zeilen: nur so trennt die Vorprüfung „schon disponiert“
    // (aktive Zeile) von „entlassen“ (beendete Zeile). Ausnahme mit Grund in der ALLOWLIST des
    // Wächters (`src/entlassung.rs`, `jede_abfrage_der_kraeftetabellen_prueft_den_zustand`).
    let zeilen: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT j.value, \
                CASE \
                    WHEN p.id IS NULL THEN ?4 \
                    WHEN ep.id IS NOT NULL AND coalesce(ep.beendet_at, '') = '' THEN ?5 \
                    WHEN ?8 AND coalesce(ep.beendet_als, '') = 'entlassen' THEN ?6 \
                    WHEN p.dienststatus <> ?7 THEN ?9 \
                END \
         FROM json_each(?1) j \
         LEFT JOIN personal p ON p.id = j.value AND p.org_id = ?2 \
         LEFT JOIN einsatz_personal ep ON ep.personal_id = j.value AND ep.einsatz_id = ?3 \
         ORDER BY j.key",
    )
    .bind(ids_json(personal_ids))
    .bind(org_id)
    .bind(einsatz_id)
    .bind(GRUND_UNBEKANNT)
    .bind(GRUND_SCHON_DISPONIERT)
    .bind(GRUND_ENTLASSEN)
    .bind(DIENSTSTATUS_IN_DIENST)
    .bind(regeln.entlassene == EntlasseneRegel::Ablehnen)
    .bind(GRUND_AUSSER_DIENST)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(id, grund)| {
            grund.map(|grund| ZeilenGrund {
                art: ZeilenArt::Personal,
                id,
                grund,
            })
        })
        .collect())
}

/// Mengen-Vorprüfung der Fahrzeug-IDs (D2) in **einer** Anweisung: unbekannt oder fremd, schon
/// disponiert, entlassen, außer Dienst. Wie beim Personal nimmt der Sammelweg ein entlassenes
/// Fahrzeug nicht still wieder auf (Rückweg „Erneut disponieren“, LLH-1079 Teil II), ein
/// storniertes dagegen schon: es war nie im Einsatz.
pub async fn check_fahrzeuge_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    fahrzeug_ids: &[i64],
) -> Result<Vec<ZeilenGrund>, AppError> {
    // Liest absichtlich auch beendete Zeilen: nur so trennt die Vorprüfung „schon disponiert“
    // (aktive Zeile) von „entlassen“ (beendete Zeile). Ausnahme mit Grund in der ALLOWLIST des
    // Wächters (`src/entlassung.rs`, `jede_abfrage_der_kraeftetabellen_prueft_den_zustand`).
    let zeilen: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT j.value, \
                CASE \
                    WHEN f.id IS NULL THEN ?4 \
                    WHEN ef.id IS NOT NULL AND coalesce(ef.beendet_at, '') = '' THEN ?5 \
                    WHEN coalesce(ef.beendet_als, '') = 'entlassen' THEN ?6 \
                    WHEN f.dienststatus <> ?7 THEN ?8 \
                END \
         FROM json_each(?1) j \
         LEFT JOIN fahrzeug f ON f.id = j.value AND f.org_id = ?2 \
         LEFT JOIN einsatz_fahrzeug ef ON ef.fahrzeug_id = j.value AND ef.einsatz_id = ?3 \
         ORDER BY j.key",
    )
    .bind(ids_json(fahrzeug_ids))
    .bind(org_id)
    .bind(einsatz_id)
    .bind(GRUND_UNBEKANNT)
    .bind(GRUND_SCHON_DISPONIERT)
    .bind(GRUND_ENTLASSEN)
    .bind(DIENSTSTATUS_IN_DIENST)
    .bind(GRUND_AUSSER_DIENST)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(id, grund)| {
            grund.map(|grund| ZeilenGrund {
                art: ZeilenArt::Fahrzeug,
                id,
                grund,
            })
        })
        .collect())
}

/// Der Einzelweg einer Stamm-Person (`POST …/personal`) behält seine Fehler: die eine
/// abgelehnte Zeile wird zum Fehler der Anfrage — unbekannt 404, schon disponiert 409 (wie der
/// UNIQUE-Konflikt), außer Dienst 422 (Zustand, `src/AGENTS.md`, Statuscode-Konvention).
pub fn als_einzelfehler(fehler: AppError) -> AppError {
    let AppError::Zeilen { zeilen, meldung } = fehler else {
        return fehler;
    };
    match zeilen.first().map(|z| z.grund.as_str()) {
        Some(GRUND_UNBEKANNT) => AppError::NotFound,
        Some(GRUND_SCHON_DISPONIERT) => {
            AppError::Conflict("Person ist bereits in diesem Einsatz disponiert".into())
        }
        Some(GRUND_AUSSER_DIENST) => disposition_repo::ausser_dienst_fehler(),
        Some(GRUND_ENTLASSEN) => disposition_repo::beendet_conflict("entlassen"),
        _ => AppError::Zeilen { meldung, zeilen },
    }
}

fn ablehnen_wenn(zeilen: Vec<ZeilenGrund>) -> Result<(), AppError> {
    if zeilen.is_empty() {
        Ok(())
    } else {
        Err(AppError::Zeilen {
            meldung: MELDUNG_ZEILEN.into(),
            zeilen,
        })
    }
}

/// Die Ziel-Einheit: gehört sie nicht zum Einsatz → 422, aufgelöst → 409 (LLH-1079).
async fn load_ziel_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<ZielName, AppError> {
    let zeile: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT name, aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match zeile {
        None => Err(AppError::UnprocessableEntity(
            "Einheit gehört nicht zum Einsatz".into(),
        )),
        Some((_, Some(_))) => Err(AppError::Conflict("Die Einheit ist aufgelöst".into())),
        Some((name, None)) => Ok(ZielName {
            id: einheit_id,
            name,
        }),
    }
}

/// Das Ziel-Fahrzeug: gehört es nicht zum Einsatz → 422; ist eine Einheit gesetzt, MUST es ihr
/// zugeordnet sein (D5) → sonst 422.
async fn load_ziel_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    fahrzeug_id: i64,
    einheit_id: Option<i64>,
) -> Result<ZielName, AppError> {
    let zeile: Option<(String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT snap_funkrufname, einheit_id, beendet_at FROM einsatz_fahrzeug \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(fahrzeug_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (name, fz_einheit, beendet) = zeile
        .ok_or_else(|| AppError::UnprocessableEntity("Fahrzeug gehört nicht zum Einsatz".into()))?;
    if beendet.is_some() {
        return Err(AppError::Conflict(
            "Das Fahrzeug ist aus dem Einsatz entlassen".into(),
        ));
    }
    if let Some(e) = einheit_id {
        if fz_einheit != Some(e) {
            return Err(AppError::UnprocessableEntity(
                "Das Fahrzeug gehört nicht zur gewählten Einheit".into(),
            ));
        }
    }
    Ok(ZielName {
        id: fahrzeug_id,
        name,
    })
}

/// Disponiert mehrere Stamm-Personen auf einer offenen Transaktion und ordnet sie optional
/// Einheit und Fahrzeug zu (D3). `wahl` ist entdoppelt (der Aufrufer zählt vorher gegen
/// [`SAMMEL_MAX`]). Reihenfolge: Ziele prüfen, Mengen-Vorprüfung (422 mit Gründen je Zeile), dann
/// je Person disponieren → Zeitachse des Initialstatus → Einheit → Besatzung. Ein Fehler mitten
/// darin rollt der Aufrufer mit der ganzen Transaktion zurück; ein UNIQUE-Konflikt im Rennen
/// bleibt 409. Schreibt kein ETB, sendet nichts.
pub async fn disponiere_personal_tx(
    conn: &mut SqliteConnection,
    kontext: Kontext,
    wahl: &[PersonalWahl],
    ziel: Ziel,
    regeln: Regeln,
) -> Result<PersonalErgebnis, AppError> {
    let einsatz_id = kontext.einsatz_id;
    let einheit = match ziel.einheit_id {
        Some(eid) => Some(load_ziel_einheit_tx(conn, einsatz_id, eid).await?),
        None => None,
    };
    let fahrzeug = match ziel.fahrzeug_id {
        Some(fid) => Some(load_ziel_fahrzeug_tx(conn, einsatz_id, fid, ziel.einheit_id).await?),
        None => None,
    };
    let ids: Vec<i64> = wahl.iter().map(|w| w.personal_id).collect();
    ablehnen_wenn(check_personal_tx(conn, einsatz_id, kontext.org_id, &ids, regeln).await?)?;

    let mut kraefte = Vec::with_capacity(wahl.len());
    for w in wahl {
        let d = disposition_repo::disponieren_stamm_tx(
            conn,
            einsatz_id,
            kontext.org_id,
            w.personal_id,
            w.staerke_position.as_deref(),
            kontext.benutzer_id,
        )
        .await?;
        disposition_repo::start_zeitachse_tx(conn, einsatz_id, kontext.benutzer_id, d.id).await?;
        if let Some(e) = &einheit {
            mitglied_repo::ordne_personal_zu_tx(conn, einsatz_id, e.id, d.id).await?;
        }
        if let Some(f) = &fahrzeug {
            besatzung_repo::ordne_besatzung_zu_tx(conn, einsatz_id, f.id, d.id).await?;
        }
        let anzeige = disposition_repo::load_anzeige_tx(conn, einsatz_id, d.id, true).await?;
        // Die Bezeichnung im ETB nennt die Einsatzfunktion vor der Qualifikation (LLH-1067).
        let funktion = anzeige.funktion_text().map(str::to_owned);
        kraefte.push(DisponiertePerson {
            ep_id: d.id,
            name: anzeige.name,
            funktion,
            traegerorganisation: anzeige.traegerorganisation,
            reaktiviert: d.reaktiviert,
        });
    }
    Ok(PersonalErgebnis {
        kraefte,
        einheit,
        fahrzeug,
    })
}

/// Disponiert mehrere Stamm-Fahrzeuge auf einer offenen Transaktion und ordnet sie optional einer
/// Einheit zu (D3). Ohne Zeitachse (D6: Fahrzeuge wirken nur über ihre Einheit). Fehler wie
/// [`disponiere_personal_tx`].
pub async fn disponiere_fahrzeuge_tx(
    conn: &mut SqliteConnection,
    kontext: Kontext,
    fahrzeug_ids: &[i64],
    einheit_id: Option<i64>,
) -> Result<FahrzeugErgebnis, AppError> {
    let einsatz_id = kontext.einsatz_id;
    let einheit = match einheit_id {
        Some(eid) => Some(load_ziel_einheit_tx(conn, einsatz_id, eid).await?),
        None => None,
    };
    ablehnen_wenn(check_fahrzeuge_tx(conn, einsatz_id, kontext.org_id, fahrzeug_ids).await?)?;

    let mut fahrzeuge = Vec::with_capacity(fahrzeug_ids.len());
    for &fid in fahrzeug_ids {
        let d = crate::fahrzeug::disposition_repo::disponiere_stamm_tx(
            conn,
            einsatz_id,
            kontext.org_id,
            fid,
            kontext.benutzer_id,
        )
        .await?;
        let ef_id = d.id;
        let funkrufname = match &einheit {
            Some(e) => mitglied_repo::ordne_fahrzeug_zu_tx(conn, einsatz_id, e.id, ef_id).await?,
            None => {
                crate::fahrzeug::disposition_repo::laden_anzeige_tx(conn, einsatz_id, ef_id, true)
                    .await?
                    .funkrufname
            }
        };
        fahrzeuge.push(DisponiertesFahrzeug {
            ef_id,
            funkrufname,
            reaktiviert: d.reaktiviert,
        });
    }
    Ok(FahrzeugErgebnis { fahrzeuge, einheit })
}

/// Bezeichnung einer Kraft in der Namensliste des Sammeleintrags: Name, mit Träger in Klammern (D1).
fn listen_name(k: &DisponiertePerson) -> String {
    match k.traegerorganisation.as_deref() {
        Some(t) if !t.is_empty() => format!("{} ({})", k.name, t),
        _ => k.name.clone(),
    }
}

fn ziel_text(einheit: Option<&ZielName>, fahrzeug: Option<&ZielName>) -> String {
    let mut s = String::new();
    if let Some(e) = einheit {
        s.push_str(&format!(", Einheit «{}»", e.name));
    }
    if let Some(f) = fahrzeug {
        s.push_str(&format!(", Fahrzeug «{}»", f.name));
    }
    s
}

/// Der eine ETB-Systemeintrag einer Personal-Disposition (D1): bei genau einer Kraft der
/// Wortlaut des Einzelwegs (mit Ziel dahinter), sonst „9 Kräfte disponiert, Einheit «…»,
/// Fahrzeug «…»: Name A (Träger), Name B, …“.
pub fn etb_text_personal(e: &PersonalErgebnis) -> String {
    let ziel = ziel_text(e.einheit.as_ref(), e.fahrzeug.as_ref());
    match e.kraefte.as_slice() {
        [k] => {
            let einzel = if k.reaktiviert {
                crate::personal::etb_text_erneut_disponiert(&k.name, k.funktion.as_deref())
            } else {
                crate::personal::etb_text_disponiert(&k.name, k.funktion.as_deref())
            };
            format!("{einzel}{ziel}")
        }
        alle => format!(
            "{} Kräfte disponiert{ziel}: {}",
            alle.len(),
            alle.iter().map(listen_name).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// Der eine ETB-Systemeintrag einer Fahrzeug-Disposition (D1): bei genau einem Fahrzeug der
/// Wortlaut des Einzelwegs (mit Einheit dahinter), sonst „3 Fahrzeuge disponiert, Einheit «…»:
/// 83-1, 83-2, 83-3“.
pub fn etb_text_fahrzeuge(e: &FahrzeugErgebnis) -> String {
    let ziel = ziel_text(e.einheit.as_ref(), None);
    match e.fahrzeuge.as_slice() {
        [f] if f.reaktiviert => format!(
            "{}{ziel}",
            crate::fahrzeug::etb_text_erneut_disponiert(&f.funkrufname)
        ),
        [f] => format!(
            "{}{ziel}",
            crate::fahrzeug::etb_text_disponiert(&f.funkrufname)
        ),
        alle => format!(
            "{} Fahrzeuge disponiert{ziel}: {}",
            alle.len(),
            alle.iter()
                .map(|f| f.funkrufname.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

#[cfg(test)]
mod tests;
