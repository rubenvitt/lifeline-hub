//! Gemeinsamer Kern der Vorlagen-Dokumente Befehl und Lagebericht: Entwurf aus einer festen
//! Vorlage, Freigabe als Snapshot ins ETB, Fortschreibung als neue Version.
//!
//! Die beiden Arten unterscheiden sich nur in den Werten von [`Dokumentart`] (Tabelle,
//! ETB-Typ und -Rückverweis, Vorlagen, Wortlaut). Ihre Wire-Typen (`Abschnitt`, `…Anzeige`)
//! bleiben je Art eigene Structs, weil sie eigene OpenAPI-Schemanamen tragen.

pub mod repo;

use crate::error::AppError;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Status-Konstanten.
pub const STATUS_ENTWURF: &str = "entwurf";
pub const STATUS_FREIGEGEBEN: &str = "freigegeben";

/// Ein Abschnitt der Vorlagen-Definition (fest im Code).
pub struct AbschnittDef {
    pub schluessel: &'static str,
    pub label: &'static str,
}

/// Eine Vorlage: Schlüssel, Anzeigelabel und geordnete Abschnitte.
pub struct VorlageDef {
    pub schluessel: &'static str,
    pub label: &'static str,
    pub abschnitte: &'static [AbschnittDef],
}

/// Ein gefüllter Abschnitt einer Dokumentart (so persistiert als JSON-Array-Element).
pub trait Abschnittsart:
    Serialize + DeserializeOwned + Clone + PartialEq + std::fmt::Debug + Send + Sync + 'static
{
    fn neu(schluessel: String, text: String) -> Self;
    fn schluessel(&self) -> &str;
    fn text(&self) -> &str;
}

/// Was eine Dokumentart vom gemeinsamen Kern unterscheidet.
pub trait Dokumentart: Send + Sync + 'static {
    type Abschnitt: Abschnittsart;
    /// Wire-Typ der Anzeige; entsteht aus dem geladenen [`repo::Dokument`].
    type Anzeige: From<repo::Dokument<Self::Abschnitt>> + Send;

    /// Tabelle der Dokumente.
    const TABELLE: &'static str;
    /// ETB-Typ des Freigabe-Snapshots.
    const ETB_TYP: &'static str;
    /// Spalte am `etb_eintrag`, die auf das Dokument zurückverweist.
    const ETB_VERWEIS: &'static str;
    /// Vorlagen-Registry der Art.
    const VORLAGEN: &'static [VorlageDef];
    /// Nomen in den Meldungen („Befehl"/„Bericht"; beide maskulin).
    const NOMEN: &'static str;
    const NOMEN_PLURAL: &'static str;
}

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage<T: Dokumentart>(schluessel: &str) -> Option<&'static VorlageDef> {
    T::VORLAGEN.iter().find(|v| v.schluessel == schluessel)
}

/// Leeres Abschnitts-Skelett gemäß Vorlage (Reihenfolge der Vorlage).
pub fn leere_abschnitte<A: Abschnittsart>(v: &VorlageDef) -> Vec<A> {
    v.abschnitte
        .iter()
        .map(|a| A::neu(a.schluessel.to_string(), String::new()))
        .collect()
}

/// Abschnitts-Skelett gemäß Vorlage, gefüllt mit einem Startinhalt (LFH-548): Reihenfolge und
/// Schlüsselmenge der Vorlage, der Text aus dem Startinhalt, sonst leer. Die Schlüssel prüft der
/// Handler vorher (`pruefe_abschnitts_schluessel`); ein fremder Schlüssel fiele hier still weg.
pub fn gefuellte_abschnitte<A: Abschnittsart>(v: &VorlageDef, startinhalt: &[A]) -> Vec<A> {
    v.abschnitte
        .iter()
        .map(|d| {
            let text = startinhalt
                .iter()
                .find(|a| a.schluessel() == d.schluessel)
                .map(|a| a.text().to_string())
                .unwrap_or_default();
            A::neu(d.schluessel.to_string(), text)
        })
        .collect()
}

/// Deterministisches Markdown-Rendering (Snapshot-Inhalt für das ETB).
/// Reihenfolge = Vorlage; fehlende Abschnitte werden als leer gerendert.
pub fn render_snapshot<A: Abschnittsart>(
    v: &VorlageDef,
    titel: &str,
    zeitstand: &str,
    abschnitte: &[A],
) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {titel}\n\n"));
    out.push_str(&format!("_Zeitstand: {zeitstand}_\n"));
    for def in v.abschnitte {
        let text = abschnitte
            .iter()
            .find(|a| a.schluessel() == def.schluessel)
            .map(|a| a.text().trim())
            .unwrap_or("");
        out.push_str(&format!("\n## {}\n", def.label));
        if text.is_empty() {
            out.push_str("_(keine Angabe)_\n");
        } else {
            out.push_str(text);
            out.push('\n');
        }
    }
    out
}

/// Freigabe-Validierung (Spec „Offene Punkte"): Pflicht ist die Abschnitts-*Struktur*
/// (alle Vorlagen-Schlüssel vorhanden), nicht jedes einzelne Feld. Zusätzlich darf das
/// *gesamte* Dokument nicht leer sein.
pub fn validiere_freigabe<T: Dokumentart>(
    v: &VorlageDef,
    abschnitte: &[T::Abschnitt],
) -> Result<(), AppError> {
    for def in v.abschnitte {
        if !abschnitte.iter().any(|a| a.schluessel() == def.schluessel) {
            return Err(AppError::UnprocessableEntity(format!(
                "Abschnitt «{}» fehlt im {}",
                def.label,
                T::NOMEN
            )));
        }
    }
    if abschnitte.iter().all(|a| a.text().trim().is_empty()) {
        return Err(AppError::UnprocessableEntity(format!(
            "Der {} ist leer und kann nicht freigegeben werden",
            T::NOMEN
        )));
    }
    Ok(())
}
