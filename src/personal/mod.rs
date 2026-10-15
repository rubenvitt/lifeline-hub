pub mod disposition_repo;
pub mod qualifikation_repo;
pub mod repo;
pub mod status_repo;

use crate::katalog::{
    StatusKategorie, KATEGORIE_GEBUNDEN, KATEGORIE_NICHT_VERFUEGBAR, KATEGORIE_VERFUEGBAR,
};
use serde::Serialize;
use utoipa::ToSchema;

/// Default-Qualifikations-Katalog je neu angelegter Organisation (label, sortier).
/// **Muss mit dem Seed in `migrations/0011_qualifikation.sql` übereinstimmen.**
/// Höchstzahl verschiedener Qualifikationen je Person (LFH-937, design.md D5). Darüber → 400.
pub const QUALIFIKATIONEN_MAX: usize = 64;

/// Name, Qualifikation und Trägerorganisation einer Ad-hoc-Kraft, an einer UHS (LFH-1045) oder im
/// Personal erfasst und geändert (LLH-1067, Spec `eingabegrenzen`); der Text gelangt ins ETB.
pub const ADHOC_TEXT_MAX: usize = 200;

/// Einsatzfunktion einer Kraft (LLH-1067, Spec `personal-einsatzangaben`); gelangt ins ETB.
pub const EINSATZFUNKTION_MAX: usize = 200;

/// Bemerkung zu einer Kraft im Einsatz (LLH-1067).
pub const BEMERKUNG_MAX: usize = 2_000;

/// Qualifikations-Liste von außen: sortiert, entdoppelt, höchstens [`QUALIFIKATIONEN_MAX`]
/// (sonst 400), vor jeder Abfrage (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
pub fn normalisiere_qualifikation_ids(
    mut ids: Vec<i64>,
) -> Result<Vec<i64>, crate::error::AppError> {
    ids.sort_unstable();
    ids.dedup();
    if ids.len() > QUALIFIKATIONEN_MAX {
        return Err(crate::error::AppError::Validation(format!(
            "Höchstens {QUALIFIKATIONEN_MAX} Qualifikationen je Person"
        )));
    }
    Ok(ids)
}

pub const QUALIFIKATION_STARTLISTE: [(&str, i64); 9] = [
    ("Sanitäter", 10),
    ("Rettungssanitäter", 20),
    ("Notfallsanitäter", 30),
    ("Notarzt", 40),
    ("Truppführer", 50),
    ("Gruppenführer", 60),
    ("Zugführer", 70),
    ("Maschinist", 80),
    ("Sprechfunker", 90),
];

/// Default-Personal-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, sortier). **Muss mit dem Seed in
/// `migrations/0012_personal_status.sql` übereinstimmen.**
pub const PERSONAL_STATUS_STARTLISTE: [(&str, &str, i64); 6] = [
    ("verfügbar", KATEGORIE_VERFUEGBAR, 10),
    ("alarmiert", KATEGORIE_GEBUNDEN, 20),
    ("auf Anfahrt", KATEGORIE_GEBUNDEN, 30),
    ("im Einsatz", KATEGORIE_GEBUNDEN, 40),
    ("Pause", KATEGORIE_NICHT_VERFUEGBAR, 50),
    ("abgemeldet", KATEGORIE_NICHT_VERFUEGBAR, 60),
];

/// Zeitachsen-Marken der Startliste (LFH-552): nur wo der Status die Art eindeutig benennt.
/// Gilt nur für neu angelegte Organisationen; der Bestand bleibt ohne Marke (Migration 0130).
pub const PERSONAL_STATUS_STARTMARKEN: [(&str, &str); 3] = [
    ("alarmiert", "alarmierung"),
    ("im Einsatz", "eintreffen"),
    ("abgemeldet", "entlassung"),
];

/// Interner Personal-Datensatz (alle Spalten von `personal`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Personal {
    pub id: i64,
    pub org_id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
    /// Demo-Herkunft (LFH-733): wahr, solange `demo_herkunft` die Zeile markiert. Live gelesen
    /// über `SPALTEN`, kein gespeichertes Flag.
    pub ist_demo: bool,
}

/// Aufgelöste Qualifikation einer Person (id + label), inkl. deaktivierter
/// Zuordnungen (deaktivierte Qualifikation bleibt in der Anzeige sichtbar).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct QualifikationRef {
    pub id: i64,
    pub label: String,
}

/// Öffentliche Personal-Darstellung (ohne `org_id`), inkl. aufgelöster Qualifikationen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PersonalAnzeige {
    pub id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub angelegt_at: String,
    pub qualifikationen: Vec<QualifikationRef>,
    /// Trägt die Zeile eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus `demo_herkunft`.
    pub ist_demo: bool,
}

/// Abgeleitete AutoComplete-Vorschläge für die Trägerorganisation (DISTINCT, org-weit).
/// Bewusst nur ein Feld (anders als FahrzeugVorschlaege mit drei Feldern).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PersonalVorschlaege {
    pub traegerorganisation: Vec<String>,
}

/// Qualifikations-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct Qualifikation {
    pub id: i64,
    pub label: String,
    pub sortier: i64,
}

/// Personal-Status-Katalog-Eintrag (org-weit). Schema wie `FahrzeugStatus` minus `fms_anker`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct PersonalStatus {
    pub id: i64,
    pub label: String,
    pub kategorie: StatusKategorie,
    pub farbe: Option<String>,
    pub sortier: i64,
    /// LFH-552: Zeitachsen-Marke — ein Wechsel auf diesen Status schreibt das Ereignis.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::zeitachse::ZeitachseMarke>)]
    pub zeitachse_marke: Option<String>,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel (Live aus dem
/// Stamm bei aktivem Einsatz + Person in Dienst, sonst Snapshot), aufgelöste
/// Stärke-Position (Dispo-Override vor Stamm-Default) und aufgelöster Status.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzPersonalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externe Person (kein Stamm-Bezug).
    pub personal_id: Option<i64>,
    /// Zugeordnete Einheit (K&M‑3); `None` = freie, nicht zugeordnete Kraft.
    pub einheit_id: Option<i64>,
    /// Fahrzeug, dessen Besatzung die Kraft ist (LFH-9); `None` = keinem Fahrzeug zugeteilt.
    /// Unabhängig von `einheit_id` (orthogonale Zuordnung).
    pub fahrzeug_id: Option<i64>,
    /// UHS, an der die Kraft arbeitet (LFH-1045); `None` = an keiner. Unabhängig von Einheit
    /// und Fahrzeug.
    pub uhs_id: Option<i64>,
    pub ist_adhoc: bool,
    pub name: String,
    /// Qualifikationen als flacher Text (Live recomposed oder Snapshot); bei Ad-hoc-Personen die
    /// erfasste Qualifikation. Die Einsatzfunktion steht getrennt in `einsatzfunktion`.
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    pub status_id: Option<i64>,
    pub status_label: Option<String>,
    pub status_kategorie: Option<StatusKategorie>,
    pub status_farbe: Option<String>,
    pub bemerkung: Option<String>,
    /// Einsatzfunktion (LLH-1067, Spec `personal-einsatzangaben`): was die Kraft im Einsatz gerade
    /// tut, getrennt von `funktion` (Qualifikation). Angezeigt wird sie vor der Qualifikation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzfunktion: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
    /// Trägt der Stamm-Datensatz eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus
    /// `demo_herkunft`, unabhängig von der Live-oder-Snapshot-Regel; Ad-hoc ist nie Demo.
    pub ist_demo: bool,
    /// Ende der Disposition (LLH-1079, Spec `kraefte-entlassung`); fehlt bei aktiven Kräften.
    /// Nur `GET …/personal?entlassene=1` liefert beendete Zeilen, und zwar nur entlassene.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_von: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::entlassung::BeendetAls>)]
    pub beendet_als: Option<String>,
}

impl EinsatzPersonalAnzeige {
    /// Die eine Funktionsangabe einer Stelle, die nur Platz für eine hat (LLH-1067, design.md D2):
    /// die Einsatzfunktion, sonst die Qualifikation. Spiegel `funktionText` in
    /// `frontend/src/kraefte/einsatzfunktionKern.ts`.
    pub fn funktion_text(&self) -> Option<&str> {
        self.einsatzfunktion
            .as_deref()
            .filter(|f| !f.is_empty())
            .or(self.funktion.as_deref())
    }
}

/// Schlanke Karten-Sicht einer Führungskraft (Einheits- oder Abschnittsführung).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct FuehrungskraftKarte {
    pub id: i64, // einsatz_personal.id
    pub einsatz_id: i64,
    pub name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    /// Qualifikationen/Funktion als flacher Text (Snapshot). Quelle für die FE-Ableitung der
    /// Fachaufgabe des Personen-Zeichens (LFH-172); `tz_fachaufgabe` bleibt vorrangig.
    pub funktion: Option<String>,
    /// Einsatzfunktion (LLH-1239): nur Text in Seitenleiste und Unterzeile, nie Quelle des
    /// Zeichens, sonst lenkte ein Freitext wie „Sprechfunker“ es auf IuK um. Alte Lage-Stände
    /// tragen das Feld nicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzfunktion: Option<String>,
    pub ist_einheitsfuehrer: bool,
    pub ist_abschnittsleiter: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::ist_gueltige_kategorie;

    #[test]
    fn startlisten_konsistent() {
        assert_eq!(QUALIFIKATION_STARTLISTE.len(), 9);
        assert_eq!(PERSONAL_STATUS_STARTLISTE.len(), 6);
        // LFH-552: jede Startmarke gehört zu einem Startstatus und ist eine gültige Marke.
        for (label, marke) in PERSONAL_STATUS_STARTMARKEN {
            assert!(PERSONAL_STATUS_STARTLISTE
                .iter()
                .any(|(l, _, _)| *l == label));
            assert!(crate::zeitachse::ZeitachseMarke::parse(marke).is_some());
        }
        // Jede Seed-Kategorie ist gültig, und es gibt mindestens einen 'gebunden'-Status
        // (Initial-Status der Disposition).
        assert!(PERSONAL_STATUS_STARTLISTE
            .iter()
            .all(|(_, k, _)| ist_gueltige_kategorie(k)));
        assert!(PERSONAL_STATUS_STARTLISTE
            .iter()
            .any(|(_, k, _)| *k == KATEGORIE_GEBUNDEN));
    }
}

// ── System-ETB-Wortlaute ──────────────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein importierter
// Einsatz dieselben ETB-Texte trägt wie ein echter.

/// Personen-Bezeichnung für ETB-Texte: Name, bei nicht leerer Funktion mit der Funktion in
/// Klammern. Eine leere Funktion (`Some("")`) zählt wie keine.
pub fn etb_bezeichnung(name: &str, funktion: Option<&str>) -> String {
    match funktion {
        Some(f) if !f.is_empty() => format!("{} ({})", name, f),
        _ => name.to_string(),
    }
}

/// System-ETB beim Ändern der Angaben einer Kraft (LLH-1067, design.md D4): EIN Eintrag, der jede
/// geänderte Angabe mit altem und neuem Wert nennt (`(Angabe, alt, neu)`, leer als „—“). Ändert
/// sich nichts, gibt es keinen Text.
pub fn etb_text_angaben_geaendert(
    name: &str,
    angaben: &[(&str, Option<&str>, Option<&str>)],
) -> Option<String> {
    let teile: Vec<String> = angaben
        .iter()
        .filter(|(_, alt, neu)| alt != neu)
        .map(|(angabe, alt, neu)| {
            format!(
                "{angabe} «{}» → «{}»",
                alt.unwrap_or("—"),
                neu.unwrap_or("—")
            )
        })
        .collect();
    (!teile.is_empty()).then(|| format!("Person «{name}»: {}", teile.join("; ")))
}

/// [`etb_text_angaben_geaendert`] für Vor- und Nachzustand einer Disposition: Einsatzfunktion,
/// Name, Qualifikation, Träger in dieser Folge, benannt nach dem neuen Namen.
pub fn etb_text_angaben(
    vorher: &EinsatzPersonalAnzeige,
    nachher: &EinsatzPersonalAnzeige,
) -> Option<String> {
    etb_text_angaben_geaendert(
        &nachher.name,
        &[
            (
                "Funktion",
                vorher.einsatzfunktion.as_deref(),
                nachher.einsatzfunktion.as_deref(),
            ),
            ("Name", Some(&vorher.name), Some(&nachher.name)),
            (
                "Qualifikation",
                vorher.funktion.as_deref(),
                nachher.funktion.as_deref(),
            ),
            (
                "Träger",
                vorher.traegerorganisation.as_deref(),
                nachher.traegerorganisation.as_deref(),
            ),
        ],
    )
}

/// System-ETB beim Disponieren einer Person (Stamm oder Ad-hoc).
pub fn etb_text_disponiert(name: &str, funktion: Option<&str>) -> String {
    format!("Person «{}» disponiert", etb_bezeichnung(name, funktion))
}

/// System-ETB beim erneuten Disponieren einer entlassenen oder stornierten Person (LLH-1079).
pub fn etb_text_erneut_disponiert(name: &str, funktion: Option<&str>) -> String {
    format!(
        "Person «{}» erneut disponiert",
        etb_bezeichnung(name, funktion)
    )
}

/// System-ETB beim Entlassen (LLH-1079, design.md D4): der Name der Einheit steht nur hier, die
/// Zeile behält keinen eingefrorenen Einheitsbezug.
pub fn etb_text_entlassen(name: &str, funktion: Option<&str>, einheit: Option<&str>) -> String {
    let wer = etb_bezeichnung(name, funktion);
    match einheit {
        Some(e) => format!("Person «{wer}» (Einheit «{e}») aus dem Einsatz entlassen"),
        None => format!("Person «{wer}» aus dem Einsatz entlassen"),
    }
}

/// System-ETB beim Stornieren einer Fehldisposition (LLH-1079, design.md D3).
pub fn etb_text_storniert(name: &str, funktion: Option<&str>) -> String {
    format!(
        "Person «{}» storniert (Fehldisposition)",
        etb_bezeichnung(name, funktion)
    )
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn disponiert_mit_ohne_und_mit_leerer_funktion() {
        assert_eq!(
            etb_text_disponiert("Anna Muster", Some("Zugführer, Sanitäter")),
            "Person «Anna Muster (Zugführer, Sanitäter)» disponiert"
        );
        assert_eq!(
            etb_text_disponiert("Anna Muster", None),
            "Person «Anna Muster» disponiert"
        );
        assert_eq!(
            etb_text_disponiert("Anna Muster", Some("")),
            "Person «Anna Muster» disponiert"
        );
        assert_eq!(etb_bezeichnung("B", Some("SAN")), "B (SAN)");
    }

    #[test]
    fn angaben_geaendert_nennt_jede_angabe_mit_alt_und_neu() {
        assert_eq!(
            etb_text_angaben_geaendert(
                "Max Mustermann",
                &[
                    ("Funktion", None, Some("Sprechfunker")),
                    ("Name", Some("Max Mustermann"), Some("Max Mustermann"))
                ]
            )
            .as_deref(),
            Some("Person «Max Mustermann»: Funktion «—» → «Sprechfunker»")
        );
        assert_eq!(
            etb_text_angaben_geaendert(
                "Meier",
                &[
                    ("Name", Some("Maier"), Some("Meier")),
                    ("Träger", Some("ASB"), None)
                ]
            )
            .as_deref(),
            Some("Person «Meier»: Name «Maier» → «Meier»; Träger «ASB» → «—»")
        );
        assert_eq!(
            etb_text_angaben_geaendert("Meier", &[("Funktion", Some("Melder"), Some("Melder"))]),
            None,
            "nichts geändert, kein Eintrag"
        );
    }

    #[test]
    fn entlassen_nennt_die_einheit_nur_im_text() {
        assert_eq!(
            etb_text_entlassen("Anna", Some("SAN"), Some("Florian 1")),
            "Person «Anna (SAN)» (Einheit «Florian 1») aus dem Einsatz entlassen"
        );
        assert_eq!(
            etb_text_entlassen("Anna", None, None),
            "Person «Anna» aus dem Einsatz entlassen"
        );
        assert_eq!(
            etb_text_storniert("Anna", None),
            "Person «Anna» storniert (Fehldisposition)"
        );
        assert_eq!(
            etb_text_erneut_disponiert("Anna", Some("SAN")),
            "Person «Anna (SAN)» erneut disponiert"
        );
    }
}
