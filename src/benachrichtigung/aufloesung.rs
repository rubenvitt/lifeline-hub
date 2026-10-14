//! Empfängerauflösung (design.md D3): aus den Adressaten eines [`Anlass`] die Menge der Nutzer,
//! die eine Benachrichtigung bekommen. Alle Ausschlüsse stehen hier und nur hier:
//!
//! 1. `Funktion` → Stab-Besetzung (S1–S6: `einsatz_stabsfunktion` → `einsatz_personal` →
//!    `personal.benutzer_id`; EL: Einsatzleiter der Führungsstelle; ein Sachgebiet „bei der
//!    Einsatzleitung“ löst wie EL auf). Bringt sie keinen Nutzer, gilt
//!    `einsatz_mitgliedschaft.fuehrungsfunktion`.
//! 2. `Person` → `personal.benutzer_id` des Einsatzpersonals; ohne Verknüpfung niemand.
//! 3. `ModulLeser` → Mitglieder mit Leserecht am Modul.
//! 4. Danach entfallen: der Auslöser, Gerätekonten, inaktive Konten, wer den Einsatz nicht lesen
//!    darf, wer das Modul des Bezugs nicht lesen darf und, bei Stufe Hinweis, wer die Art
//!    abgeschaltet hat (D6).
//!
//! Dieselbe Rechteprüfung ([`Leserecht`]) gilt erneut beim Lesen einer Benachrichtigung.

use super::{Adressat, Anlass, BenachrichtigungArt, BenachrichtigungStufe};
use crate::auth::Benutzer;
use crate::einsatz::berechtigung::{darf_lesen, lade_modul_regeln, modul_freigabe};
use crate::einsatz::modul_override::EinsatzModulOverride;
use crate::einsatz::{repo as einsatz_repo, Einsatz, EinsatzRolle};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::org::modul_einstellung::OrgModulVorgabe;
use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// Ergebnis der Auflösung: die Organisation des Einsatzes (für den Org-Kanal) und die
/// Empfänger, aufsteigend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aufgeloest {
    pub org_id: i64,
    pub benutzer_ids: Vec<i64>,
}

/// Die Leserechte eines Einsatzes, einmal geladen: Einsatz, Modulregeln, Rollen der Mitglieder.
/// Beantwortet für einen Nutzer, ob er den Einsatz und ein Modul darin lesen darf, mit genau der
/// Auswertung der Routen (`darf_lesen`, `modul_freigabe`).
pub struct Leserecht {
    pub einsatz: Einsatz,
    overrides: HashMap<String, EinsatzModulOverride>,
    org_defaults: HashMap<String, OrgModulVorgabe>,
    rollen: HashMap<i64, EinsatzRolle>,
}

impl Leserecht {
    /// Lädt die Rechte des Einsatzes; `NotFound`, wenn es ihn nicht gibt.
    pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Self, AppError> {
        let einsatz = einsatz_repo::laden(pool, einsatz_id).await?;
        let (overrides, org_defaults) = lade_modul_regeln(pool, einsatz.id, einsatz.org_id).await?;
        let rollen = sqlx::query_as::<_, (i64, String)>(
            "SELECT benutzer_id, einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = ?",
        )
        .bind(einsatz.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .filter_map(|(id, r)| EinsatzRolle::parse(&r).map(|r| (id, r)))
        .collect();
        Ok(Self {
            einsatz,
            overrides,
            org_defaults,
            rollen,
        })
    }

    /// Ob `benutzer` Mitglied des Einsatzes ist.
    pub fn ist_mitglied(&self, benutzer_id: i64) -> bool {
        self.rollen.contains_key(&benutzer_id)
    }

    /// Ob `benutzer` den Einsatz lesen darf und, falls `modul` gesetzt ist, auch dieses Modul.
    pub fn darf(&self, benutzer: &Benutzer, modul: Option<&str>) -> bool {
        let rolle = self.rollen.get(&benutzer.id).copied();
        let e = &self.einsatz;
        if !darf_lesen(
            benutzer,
            e.org_id,
            e.status.as_str(),
            e.abgeschlossen_at.as_deref(),
            e.retention_bis.as_deref(),
            e.geloescht_at.as_deref(),
            rolle,
            Utc::now(),
        ) {
            return false;
        }
        modul.is_none_or(|m| {
            modul_freigabe(
                &self.overrides,
                &self.org_defaults,
                m,
                benutzer,
                e.org_id,
                rolle,
            )
            .zugriff
        })
    }
}

/// Löst die Empfänger eines Anlasses auf (Regeln im Modulkopf).
pub async fn empfaenger(pool: &SqlitePool, anlass: &Anlass) -> Result<Aufgeloest, AppError> {
    let recht = Leserecht::laden(pool, anlass.einsatz_id).await?;
    let einsatz_id = recht.einsatz.id;

    // Je Kandidat die Wege, auf denen er adressiert ist: `None` = ohne eigenes Modul (Funktion,
    // Person, Nutzer), `Some(m)` = als Leser von `m`. Ein Weg genügt.
    let mut wege: BTreeMap<i64, Vec<Option<&'static str>>> = BTreeMap::new();
    for adressat in &anlass.adressaten {
        let (ids, modul) = match *adressat {
            Adressat::Funktion(f) => (funktion_nutzer(pool, einsatz_id, f).await?, None),
            Adressat::Person(ep) => (person_nutzer(pool, einsatz_id, ep).await?, None),
            Adressat::Nutzer(id) => (vec![id], None),
            Adressat::ModulLeser(m) => (recht.rollen.keys().copied().collect(), Some(m)),
            Adressat::Fuehrungskraefte => (
                org_nutzer(pool, recht.einsatz.org_id)
                    .await?
                    .into_iter()
                    .filter(|b| b.darf_fremdeinsatz_lesen(recht.einsatz.org_id))
                    .map(|b| b.id)
                    .collect(),
                None,
            ),
        };
        for id in ids {
            wege.entry(id).or_default().push(modul);
        }
    }
    if let Some(ausloeser) = anlass.ausloeser {
        wege.remove(&ausloeser);
    }
    if wege.is_empty() {
        return Ok(Aufgeloest {
            org_id: recht.einsatz.org_id,
            benutzer_ids: Vec::new(),
        });
    }

    let kandidaten: Vec<i64> = wege.keys().copied().collect();
    let benutzer = personen_konten(pool, &kandidaten).await?;
    let abgeschaltet = if anlass.art.stufe() == BenachrichtigungStufe::Hinweis {
        abgeschaltet_fuer(pool, &kandidaten, anlass.art).await?
    } else {
        BTreeSet::new()
    };
    let bezug_modul = anlass.bezug.typ.modul();
    let benutzer_ids = benutzer
        .iter()
        .filter(|b| !abgeschaltet.contains(&b.id))
        .filter(|b| recht.darf(b, bezug_modul))
        .filter(|b| {
            wege.get(&b.id)
                .is_some_and(|w| w.iter().any(|m| m.is_none_or(|m| recht.darf(b, Some(m)))))
        })
        .map(|b| b.id)
        .collect();
    Ok(Aufgeloest {
        org_id: recht.einsatz.org_id,
        benutzer_ids,
    })
}

/// Die Nutzer einer Funktion: Stab-Besetzung, ersatzweise Mitgliedschaft (Spec „Meine Funktion“).
async fn funktion_nutzer(
    pool: &SqlitePool,
    einsatz_id: i64,
    funktion: Fuehrungsfunktion,
) -> Result<Vec<i64>, AppError> {
    let besetzt = besetzung_nutzer(pool, einsatz_id, funktion).await?;
    if !besetzt.is_empty() {
        return Ok(besetzt);
    }
    Ok(sqlx::query_scalar(
        "SELECT benutzer_id FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND fuehrungsfunktion = ? ORDER BY benutzer_id",
    )
    .bind(einsatz_id)
    .bind(funktion.as_str())
    .fetch_all(pool)
    .await?)
}

/// Die verknüpften Nutzer der Stab-Besetzung einer Funktion. EL ist der Einsatzleiter der
/// Führungsstelle; ein Sachgebiet „bei der Einsatzleitung“ (Zusammenlegung) löst wie EL auf.
/// S7, Führungshilfspersonal und Fachberater haben keine Besetzung.
async fn besetzung_nutzer(
    pool: &SqlitePool,
    einsatz_id: i64,
    funktion: Fuehrungsfunktion,
) -> Result<Vec<i64>, AppError> {
    if funktion == Fuehrungsfunktion::El {
        return Ok(sqlx::query_scalar(
            "SELECT p.benutzer_id FROM einsatz_fuehrungsstelle f \
             JOIN einsatz_personal ep ON ep.id = f.einsatzleiter_personal_id \
             JOIN personal p ON p.id = ep.personal_id \
             WHERE f.einsatz_id = ? AND f.einsatzleiter_art = 'personal' \
               AND p.benutzer_id IS NOT NULL",
        )
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?);
    }
    let Some(sg) = funktion.sachgebiet() else {
        return Ok(Vec::new());
    };
    let art: Option<String> = sqlx::query_scalar(
        "SELECT besetzung_art FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = ?",
    )
    .bind(einsatz_id)
    .bind(sg.as_str())
    .fetch_optional(pool)
    .await?;
    match art.as_deref() {
        Some("einsatzleitung") => {
            Box::pin(besetzung_nutzer(pool, einsatz_id, Fuehrungsfunktion::El)).await
        }
        Some("personal") => Ok(sqlx::query_scalar(
            "SELECT p.benutzer_id FROM einsatz_stabsfunktion s \
             JOIN einsatz_personal ep ON ep.id = s.personal_id \
             JOIN personal p ON p.id = ep.personal_id \
             WHERE s.einsatz_id = ? AND s.sachgebiet = ? AND p.benutzer_id IS NOT NULL",
        )
        .bind(einsatz_id)
        .bind(sg.as_str())
        .fetch_all(pool)
        .await?),
        _ => Ok(Vec::new()),
    }
}

/// Der mit einem Einsatzpersonal verknüpfte Nutzer; fremder Einsatz oder ohne Verknüpfung: keiner.
async fn person_nutzer(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_personal_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT p.benutzer_id FROM einsatz_personal ep \
         JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.id = ? AND ep.einsatz_id = ? AND p.benutzer_id IS NOT NULL",
    )
    .bind(einsatz_personal_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

const BENUTZER_SPALTEN: &str = "b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
     b.system_rolle, b.org_rolle, b.aktiv, b.erstellt_at";

/// Aktive Konten einer Organisation ohne Gerätekonten.
async fn org_nutzer(pool: &SqlitePool, org_id: i64) -> Result<Vec<Benutzer>, AppError> {
    let sql = format!(
        "SELECT {BENUTZER_SPALTEN} FROM benutzer b WHERE b.org_id = ? AND b.aktiv = 1 \
         AND NOT EXISTS (SELECT 1 FROM geraet_kopplung g WHERE g.benutzer_id = b.id) \
         ORDER BY b.id"
    );
    Ok(sqlx::query_as::<_, Benutzer>(sqlx::AssertSqlSafe(sql))
        .bind(org_id)
        .fetch_all(pool)
        .await?)
}

/// Die Konten der Kandidaten, ohne inaktive und ohne Gerätekonten (Spec „Gekoppelte Geräte
/// bleiben still“: jede Kopplung hat ein eigenes Konto, auch nach ihrem Ende).
async fn personen_konten(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<Benutzer>, AppError> {
    let sql = format!(
        "SELECT {BENUTZER_SPALTEN} FROM benutzer b \
         WHERE b.id IN (SELECT value FROM json_each(?)) AND b.aktiv = 1 \
         AND NOT EXISTS (SELECT 1 FROM geraet_kopplung g WHERE g.benutzer_id = b.id) \
         ORDER BY b.id"
    );
    Ok(sqlx::query_as::<_, Benutzer>(sqlx::AssertSqlSafe(sql))
        .bind(serde_json::to_string(ids).expect("ID-Liste serialisierbar"))
        .fetch_all(pool)
        .await?)
}

/// Wer von `ids` die Art `art` abgeschaltet hat (Schlüssel `benachrichtigungen_aus`, D6). Ein
/// unlesbarer Wert schaltet nichts ab: lieber eine Benachrichtigung zu viel als eine verlorene.
async fn abgeschaltet_fuer(
    pool: &SqlitePool,
    ids: &[i64],
    art: BenachrichtigungArt,
) -> Result<BTreeSet<i64>, AppError> {
    let zeilen = sqlx::query_as::<_, (i64, String)>(
        "SELECT benutzer_id, wert FROM benutzer_einstellungen \
         WHERE schluessel = ? AND benutzer_id IN (SELECT value FROM json_each(?))",
    )
    .bind(crate::benutzer_einstellungen::SCHLUESSEL_BENACHRICHTIGUNGEN_AUS)
    .bind(serde_json::to_string(ids).expect("ID-Liste serialisierbar"))
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter(|(_, wert)| {
            serde_json::from_str::<Vec<String>>(wert)
                .is_ok_and(|aus| aus.iter().any(|a| a == art.as_str()))
        })
        .map(|(id, _)| id)
        .collect())
}
