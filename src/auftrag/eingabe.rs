//! Auftrags-Eingabe: Request-DTOs + geteilte Validierung/Normalisierung (LFH-124).
//! Route-übergreifend genutzt (POST /auftraege sowie die Heraufstufungen aus ETB,
//! Meldung und Chat) — liegt daher im Domänenmodul `auftrag`, nicht in einem
//! Route-Modul. Routes rufen dieses Modul, nicht andere Routes.
use crate::auftrag::repo;
use crate::auftrag::{
    EMPF_ABSCHNITT, EMPF_EINHEIT, EMPF_EXTERN, EMPF_FAHRZEUG, EMPF_FUNKTION, EMPF_PERSON,
    PRIO_NORMAL, RICHTUNG_INTERN,
};
use crate::error::AppError;
use chrono::{Duration, NaiveDateTime};
use serde::Deserialize;

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
fn parse_zeit(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Zeitpunkt".into()))
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct EmpfaengerEingabeReq {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
    pub extern_kategorie: Option<String>,
    pub extern_bezeichnung: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NeuerAuftrag {
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    pub prioritaet: Option<String>,
    /// Richtung intern/extern (LFH-87); Default 'intern'.
    pub richtung: Option<String>,
    pub frist_at: Option<String>,
    /// Optional: Erteilzeitpunkt (mündlich/per Funk nachträglich). Default = jetzt.
    pub erteilt_at: Option<String>,
    pub empfaenger: Vec<EmpfaengerEingabeReq>,
}

/// Prüft Slot-Konsistenz + Einsatz-Zugehörigkeit einer Empfänger-Zeile.
async fn validiere_empfaenger(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    req: &EmpfaengerEingabeReq,
) -> Result<repo::EmpfaengerEingabe, AppError> {
    let belegt = [
        req.abschnitt_id.is_some(),
        req.einheit_id.is_some(),
        req.person_id.is_some(),
        req.fahrzeug_id.is_some(),
        trimme(&req.funktion_text).is_some(),
        trimme(&req.extern_bezeichnung).is_some(),
    ]
    .iter()
    .filter(|b| **b)
    .count();
    if belegt != 1 {
        return Err(AppError::Validation("Empfänger braucht genau ein Ziel".into()));
    }

    async fn gehoert(
        pool: &sqlx::SqlitePool,
        tab: &str,
        id: i64,
        einsatz_id: i64,
    ) -> Result<bool, AppError> {
        let q = format!("SELECT 1 FROM {tab} WHERE id = ? AND einsatz_id = ?");
        Ok(sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(&*q))
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?
            .is_some())
    }

    let typ = match req.empfaenger_typ.as_str() {
        EMPF_ABSCHNITT => {
            let id = req.abschnitt_id.ok_or_else(|| AppError::Validation("abschnitt_id fehlt".into()))?;
            if !gehoert(pool, "einsatzabschnitt", id, einsatz_id).await? {
                return Err(AppError::Validation("Abschnitt gehört nicht zum Einsatz".into()));
            }
            EMPF_ABSCHNITT
        }
        EMPF_EINHEIT => {
            let id = req.einheit_id.ok_or_else(|| AppError::Validation("einheit_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_einheit", id, einsatz_id).await? {
                return Err(AppError::Validation("Einheit gehört nicht zum Einsatz".into()));
            }
            EMPF_EINHEIT
        }
        EMPF_PERSON => {
            let id = req.person_id.ok_or_else(|| AppError::Validation("person_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_personal", id, einsatz_id).await? {
                return Err(AppError::Validation("Person gehört nicht zum Einsatz".into()));
            }
            EMPF_PERSON
        }
        EMPF_FAHRZEUG => {
            let id = req.fahrzeug_id.ok_or_else(|| AppError::Validation("fahrzeug_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_fahrzeug", id, einsatz_id).await? {
                return Err(AppError::Validation("Fahrzeug gehört nicht zum Einsatz".into()));
            }
            EMPF_FAHRZEUG
        }
        EMPF_FUNKTION => {
            if trimme(&req.funktion_text).is_none() {
                return Err(AppError::Validation("funktion_text fehlt".into()));
            }
            EMPF_FUNKTION
        }
        EMPF_EXTERN => {
            let kat = req.extern_kategorie.as_deref().map(str::trim).unwrap_or("");
            if !crate::auftrag::extern_kategorie_gueltig(kat) {
                return Err(AppError::Validation("Ungültige externe Adressat-Kategorie".into()));
            }
            if trimme(&req.extern_bezeichnung).is_none() {
                return Err(AppError::Validation("externe Bezeichnung fehlt".into()));
            }
            EMPF_EXTERN
        }
        _ => return Err(AppError::Validation("Ungültiger Empfänger-Typ".into())),
    };

    let ist_extern = typ == EMPF_EXTERN;
    Ok(repo::EmpfaengerEingabe {
        empfaenger_typ: typ.to_string(),
        abschnitt_id: req.abschnitt_id,
        einheit_id: req.einheit_id,
        person_id: req.person_id,
        fahrzeug_id: req.fahrzeug_id,
        funktion_text: trimme(&req.funktion_text).map(str::to_string),
        // extern_* nur bei externem Adressat übernehmen (sonst verirrte Werte an anderen Typen).
        extern_kategorie: ist_extern.then(|| trimme(&req.extern_kategorie).map(str::to_string)).flatten(),
        extern_bezeichnung: ist_extern.then(|| trimme(&req.extern_bezeichnung).map(str::to_string)).flatten(),
    })
}

/// Validierte, besitzende Auftrags-Eingabe. Geteilt zwischen POST /auftraege und der
/// Chat→Auftrag-Heraufstufung (LFH-101), damit BEIDE Pfade dieselben Pflicht-, Slot-
/// und Zugehörigkeitsprüfungen durchlaufen. `daten()` baut daraus die borrowende
/// `repo::AuftragDaten`.
pub struct ValidierterAuftrag {
    text: String,
    absicht: Option<String>,
    lage: Option<String>,
    ort: Option<String>,
    zeit: Option<String>,
    mittel: Option<String>,
    verbindung: Option<String>,
    sicherheit: Option<String>,
    prioritaet: String,
    richtung: String,
    frist_at: Option<String>,
    erteilt_at: String,
    empfaenger: Vec<repo::EmpfaengerEingabe>,
}

impl ValidierterAuftrag {
    pub fn daten(&self) -> repo::AuftragDaten<'_> {
        repo::AuftragDaten {
            auftrag_text: &self.text,
            absicht: self.absicht.as_deref(),
            lage: self.lage.as_deref(),
            ort: self.ort.as_deref(),
            zeit: self.zeit.as_deref(),
            mittel: self.mittel.as_deref(),
            verbindung: self.verbindung.as_deref(),
            sicherheit: self.sicherheit.as_deref(),
            prioritaet: &self.prioritaet,
            richtung: &self.richtung,
            frist_at: self.frist_at.as_deref(),
            erteilt_at: &self.erteilt_at,
            empfaenger: self.empfaenger.clone(),
        }
    }
}

/// Leitet aus Erteilzeit + Default-Minuten eine absolute Quittierfrist ab (DB-Format).
/// Defensiv `None` statt Panik bei (theoretisch unmöglichem) Parse-Fehler.
fn frist_aus_minuten(erteilt: &str, min: i64) -> Option<String> {
    NaiveDateTime::parse_from_str(erteilt, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|n| (n + Duration::minutes(min)).format("%Y-%m-%d %H:%M:%S").to_string())
}

/// Validiert + normalisiert eine Auftrags-Eingabe: Auftragstext UND >=1 Empfänger
/// (Pflicht-Akzeptanzkriterium), Priorität, Frist/Erteilzeit (Parsing) sowie jede
/// Empfänger-Zeile (Slot-Konsistenz + Einsatz-Zugehörigkeit). `now` ist der Default
/// für `erteilt_at`. Fehlt `frist_at` und ist `default_quittierung_frist_min` gesetzt
/// (LFH-133), wird die Frist aus Erteilzeit + Minuten abgeleitet. Gemeinsamer Eingang
/// für POST /auftraege und die Heraufstufungen.
pub async fn validiere_neuen_auftrag(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    req: &NeuerAuftrag,
    now: &str,
    default_quittierung_frist_min: Option<i64>,
) -> Result<ValidierterAuftrag, AppError> {
    let text = req.auftrag_text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Auftragstext darf nicht leer sein".into()));
    }
    if req.empfaenger.is_empty() {
        return Err(AppError::Validation("Mindestens ein Empfänger ist erforderlich".into()));
    }
    let prioritaet = req.prioritaet.as_deref().unwrap_or(PRIO_NORMAL);
    if !crate::auftrag::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let richtung = req.richtung.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(RICHTUNG_INTERN);
    if !crate::auftrag::richtung_gueltig(richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }
    let erteilt = match trimme(&req.erteilt_at) {
        Some(e) => parse_zeit(e)?,
        None => now.to_string(),
    };
    // Frist: expliziter Request-Wert; sonst (LFH-133) aus Default-Quittierfrist abgeleitet
    // (Erteilzeit + Minuten); ohne beides keine Frist (heutiges Verhalten).
    let frist = match trimme(&req.frist_at) {
        Some(f) => Some(parse_zeit(f)?),
        None => default_quittierung_frist_min.and_then(|min| frist_aus_minuten(&erteilt, min)),
    };

    let mut empfaenger = Vec::with_capacity(req.empfaenger.len());
    for r in &req.empfaenger {
        empfaenger.push(validiere_empfaenger(pool, einsatz_id, r).await?);
    }

    Ok(ValidierterAuftrag {
        text: text.to_string(),
        absicht: trimme(&req.absicht).map(str::to_string),
        lage: trimme(&req.lage).map(str::to_string),
        ort: trimme(&req.ort).map(str::to_string),
        zeit: trimme(&req.zeit).map(str::to_string),
        mittel: trimme(&req.mittel).map(str::to_string),
        verbindung: trimme(&req.verbindung).map(str::to_string),
        sicherheit: trimme(&req.sicherheit).map(str::to_string),
        prioritaet: prioritaet.to_string(),
        richtung: richtung.to_string(),
        frist_at: frist,
        erteilt_at: erteilt,
        empfaenger,
    })
}
