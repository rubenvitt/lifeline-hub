//! Auflösung zur Lesezeit (LFH-549, design.md D4): ein Empfänger mit Sachgebietscode zeigt die
//! **aktuelle** Besetzung dieses Sachgebiets im Einsatz.
//!
//! Der Snapshot (`auftrag_empfaenger.snap_anzeige`) bleibt die historische Wahrheit und trägt nur
//! das Funktionslabel — der Personenname kommt ausschließlich hier, zur Lesezeit, aus
//! `einsatz_stabsfunktion` (Scrub): nach der Schwärzung ist er weg, ohne dass ein Retain-Feld
//! ihn festhielte.
//!
//! Wer das Stab-Modul im Einsatz nicht lesen darf, bekommt keine Auflösung (das Feld fehlt) —
//! dieselbe Filterlogik wie beim Modulzähler.

use super::Fuehrungsfunktion;
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::stab::{BesetzungArt, Sachgebiet};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::BTreeMap;
use utoipa::ToSchema;

wire_enum! {
    /// Besetzungszustand eines Sachgebiets aus Sicht eines Empfängers. Anders als
    /// [`BesetzungArt`] mit „nicht vergeben“ als eigenem Wert — hier ist die Abwesenheit einer
    /// Zeile eine Auskunft, kein fehlendes Feld.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BesetzungsZustand {
        NichtVergeben => "nicht_vergeben",
        Einsatzleitung => "einsatzleitung",
        Personal => "personal",
        Extern => "extern",
        Rueckwaertig => "rueckwaertig",
    }
}

/// Die aktuelle Besetzung eines Sachgebiets, zur Lesezeit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AktuelleBesetzung {
    pub zustand: BesetzungsZustand,
    /// Person bzw. Stelle; fehlt bei „nicht vergeben“, „bei der Einsatzleitung“ und nach der
    /// Schwärzung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Die Besetzung eines Einsatzes, einmal je Anfrage geladen (keine N+1-Abfrage).
#[derive(Debug, Clone, Default)]
pub struct Aufloeser {
    /// `None` = die Person darf den Stab nicht lesen → nie auflösen.
    besetzung: Option<BTreeMap<Sachgebiet, AktuelleBesetzung>>,
}

impl Aufloeser {
    /// Ohne Recht: löst nichts auf.
    pub fn ohne_recht() -> Self {
        Self { besetzung: None }
    }

    pub async fn laden(
        conn: &mut SqliteConnection,
        einsatz_id: i64,
        darf_stab: bool,
    ) -> Result<Self, AppError> {
        if !darf_stab {
            return Ok(Self::ohne_recht());
        }
        let zeilen = sqlx::query_as::<_, (String, String, Option<String>, Option<String>)>(
            "SELECT sachgebiet, besetzung_art, snap_name, bezeichnung \
             FROM einsatz_stabsfunktion WHERE einsatz_id = ?",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut besetzung = BTreeMap::new();
        for (sg, art, snap_name, bezeichnung) in zeilen {
            let (Some(sg), Some(art)) = (Sachgebiet::parse(&sg), BesetzungArt::parse(&art)) else {
                continue;
            };
            let (zustand, name) = match art {
                BesetzungArt::Einsatzleitung => (BesetzungsZustand::Einsatzleitung, None),
                BesetzungArt::Personal => (BesetzungsZustand::Personal, snap_name),
                BesetzungArt::Extern => (BesetzungsZustand::Extern, bezeichnung),
                BesetzungArt::Rueckwaertig => (BesetzungsZustand::Rueckwaertig, bezeichnung),
            };
            besetzung.insert(sg, AktuelleBesetzung { zustand, name });
        }
        Ok(Self {
            besetzung: Some(besetzung),
        })
    }

    /// Lädt mit Rechteprüfung: das Stab-Modul muss für `benutzer` im Einsatz freigegeben sein.
    pub async fn laden_fuer(
        pool: &SqlitePool,
        einsatz_id: i64,
        org_id: i64,
        benutzer: &Benutzer,
    ) -> Result<Self, AppError> {
        let darf = darf_stab_lesen(pool, einsatz_id, org_id, benutzer).await?;
        let mut conn = pool.acquire().await?;
        Self::laden(&mut conn, einsatz_id, darf).await
    }

    /// Die Auflösung für einen Empfänger; nur s1–s6, sonst `None`.
    pub fn aufloesen(&self, funktion: Option<Fuehrungsfunktion>) -> Option<AktuelleBesetzung> {
        let besetzung = self.besetzung.as_ref()?;
        let sg = funktion?.sachgebiet()?;
        Some(besetzung.get(&sg).cloned().unwrap_or(AktuelleBesetzung {
            zustand: BesetzungsZustand::NichtVergeben,
            name: None,
        }))
    }
}

/// Ob `benutzer` das Stab-Modul im Einsatz lesen darf (Modulfreigabe; die Mitgliedschaft
/// prüft bereits der Extractor der aufrufenden Route).
pub async fn darf_stab_lesen(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &Benutzer,
) -> Result<bool, AppError> {
    let erlaubt =
        crate::einsatz::berechtigung::erlaubte_module(pool, einsatz_id, org_id, benutzer).await?;
    use crate::einsatz::modul::{ModulMarker, Stab};
    Ok(Stab::KEY.is_some_and(|key| erlaubt.contains(key)))
}
