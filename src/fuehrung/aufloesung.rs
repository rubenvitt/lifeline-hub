//! Auflösung zur Lesezeit (LFH-549, design.md D4): ein Empfänger mit Sachgebietscode zeigt die
//! **aktuelle** Besetzung dieses Sachgebiets im Einsatz.
//!
//! Der Snapshot (`auftrag_empfaenger.snap_anzeige`) ist die historische Wahrheit und trägt nur
//! das Funktionslabel — der Personenname kommt ausschließlich hier, zur Lesezeit, aus der
//! Führungsfunktion der Mitgliedschaft (`einsatz_mitgliedschaft.fuehrungsfunktion`, i6k6mzed,
//! `openspec/changes/archive/2026-11-09-i6k6mzed-stab-herausnehmen/design.md` D2). Führen mehrere Mitglieder
//! dasselbe Sachgebiet, gelten alle: ihre Namen stehen alphabetisch, getrennt durch „, “.
//!
//! Die Mitgliedschaft überlebt die Schwärzung, der Name darf es nicht: an einem geschwärzten
//! Einsatz (`einsatz.geschwaerzt_at`) bleibt der Zustand `personal`, aber ohne Namen. Der
//! Snapshot selbst wird seit LFH-701 mitgeschwärzt; sein Wortlaut bleibt im ETB der Anordnung.
//!
//! Die Auflösung braucht kein Modulrecht: dieselben Namen stehen in `GET …/mitglieder`, das jedes
//! Mitglied lesen darf. Ein gekoppeltes Gerät (LFH-892) bekommt keine Auflösung (das Feld fehlt).

use super::Fuehrungsfunktion;
use crate::error::AppError;
use crate::fuehrung::Sachgebiet;
use crate::geraet::GeraetKontext;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::BTreeMap;
use utoipa::ToSchema;

wire_enum! {
    /// Besetzungszustand eines Sachgebiets aus Sicht eines Empfängers, mit „nicht vergeben“ als
    /// eigenem Wert — hier ist die Abwesenheit eines Mitglieds eine Auskunft, kein fehlendes
    /// Feld. Erzeugt werden nur noch `personal` und `nicht_vergeben` (i6k6mzed, D2);
    /// `einsatzleitung`, `extern` und `rueckwaertig` bleiben als Wire-Werte der früheren
    /// Stab-Besetzung stehen (Grenzwert-Regel, `AGENTS.md`).
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
    /// `None` = keine Auflösung (gekoppeltes Gerät) → das Feld fehlt.
    besetzung: Option<BTreeMap<Sachgebiet, AktuelleBesetzung>>,
}

impl Aufloeser {
    /// Löst nichts auf.
    pub fn ohne_aufloesung() -> Self {
        Self { besetzung: None }
    }

    /// Lädt die Führungsfunktionen S1–S6 der Mitglieder des Einsatzes.
    pub async fn laden(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Self, AppError> {
        let geschwaerzt: bool =
            sqlx::query_scalar("SELECT geschwaerzt_at IS NOT NULL FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_optional(&mut *conn)
                .await?
                .unwrap_or(false);
        let zeilen = sqlx::query_as::<_, (String, String)>(
            "SELECT m.fuehrungsfunktion, b.anzeigename \
             FROM einsatz_mitgliedschaft m JOIN benutzer b ON b.id = m.benutzer_id \
             WHERE m.einsatz_id = ? AND m.fuehrungsfunktion IS NOT NULL",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut namen: BTreeMap<Sachgebiet, Vec<String>> = BTreeMap::new();
        for (code, name) in zeilen {
            if let Some(sg) = Fuehrungsfunktion::parse(&code).and_then(|f| f.sachgebiet()) {
                namen.entry(sg).or_default().push(name);
            }
        }
        let besetzung = namen
            .into_iter()
            .map(|(sg, namen)| {
                let name = (!geschwaerzt).then(|| namensliste(namen));
                (
                    sg,
                    AktuelleBesetzung {
                        zustand: BesetzungsZustand::Personal,
                        name,
                    },
                )
            })
            .collect();
        Ok(Self {
            besetzung: Some(besetzung),
        })
    }

    /// Lädt für eine Anfrage: ein gekoppeltes Gerät bekommt keine Auflösung (D2), sonst genügt
    /// der Lesezugriff, den der Extractor der aufrufenden Route schon geprüft hat.
    pub async fn laden_fuer(
        pool: &SqlitePool,
        einsatz_id: i64,
        geraet: Option<&GeraetKontext>,
    ) -> Result<Self, AppError> {
        if geraet.is_some() {
            return Ok(Self::ohne_aufloesung());
        }
        let mut conn = pool.acquire().await?;
        Self::laden(&mut conn, einsatz_id).await
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

/// Namen alphabetisch, getrennt durch „, “ — die eine Schreibweise für mehrere Träger einer
/// Funktion (Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit derselben Führungsfunktion“).
/// Verglichen wird ohne Groß- und Kleinschreibung und mit Umlauten wie ihrem Grundlaut, wie
/// `localeCompare('de')` im Client (`frontend/src/fuehrung/besetzungAusMitgliedern.ts`).
pub fn namensliste(mut namen: Vec<String>) -> String {
    namen.sort_by(|a, b| {
        sortierschluessel(a)
            .cmp(&sortierschluessel(b))
            .then_with(|| a.cmp(b))
    });
    namen.join(", ")
}

fn sortierschluessel(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| match c {
            'ä' => "a".to_string(),
            'ö' => "o".to_string(),
            'ü' => "u".to_string(),
            'ß' => "ss".to_string(),
            c => c.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::namensliste;

    #[test]
    fn mehrere_namen_alphabetisch_mit_komma() {
        assert_eq!(
            namensliste(vec!["Schulz".into(), "Müller".into(), "albers".into()]),
            "albers, Müller, Schulz"
        );
        // Umlaut wie Grundlaut: „Mü“ vor „Mz“.
        assert_eq!(
            namensliste(vec!["Mzyk".into(), "Müller".into()]),
            "Müller, Mzyk"
        );
        assert_eq!(namensliste(vec!["Weber".into()]), "Weber");
    }
}
