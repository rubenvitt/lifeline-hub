pub mod disposition_repo;
pub mod ort;
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

// Geteilte Dienststatus-Konstanten (wie Fahrzeug/Personal) aus crate::katalog.
pub use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};

/// Bezeichnung, Kategorie, Bestandsnummer und Trägerorganisation eines Ad-hoc-Postens, beim
/// Disponieren und beim Korrigieren (LLH-1093, Spec `material-liste`); die Bezeichnung gelangt
/// ins ETB. Wie `personal::ADHOC_TEXT_MAX`.
pub const ADHOC_TEXT_MAX: usize = 200;

/// Bemerkung zu einem Material-Posten im Einsatz (LLH-1093); wie `personal::BEMERKUNG_MAX`.
pub const BEMERKUNG_MAX: usize = 2_000;

/// Bezeichnung, Kategorie, Bestandsnummer, Trägerorganisation und Standort eines Materials im
/// Stamm (LLH-1258, `POST/PATCH /api/material`), Zeichen nach dem Trimmen. So weit wie
/// [`ADHOC_TEXT_MAX`]: Bezeichnung, Kategorie, Bestandsnummer und Träger gehen beim Disponieren
/// als Snapshot in denselben Posten wie ein Ad-hoc-Eintrag. Spiegel: `MATERIAL_STAMM_TEXT_MAX`.
pub const STAMM_TEXT_MAX: usize = 200;

/// Bemerkung eines Materials im Stamm (LLH-1258); wie [`BEMERKUNG_MAX`]. Spiegel:
/// `MATERIAL_STAMM_BEMERKUNG_MAX`.
pub const STAMM_BEMERKUNG_MAX: usize = 2_000;

/// Interner Material-Stamm-Datensatz (alle Spalten von `material`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Material {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
    /// Gerät oder Verbrauchsgut (LLH-1224, design.md D1): Vorgabe jeder neuen Disposition.
    #[sqlx(try_from = "String")]
    pub art: MaterialArt,
    /// Demo-Herkunft (LFH-733): wahr, solange `demo_herkunft` die Zeile markiert. Live gelesen
    /// über `SPALTEN`, kein gespeichertes Flag.
    pub ist_demo: bool,
}

impl Material {
    /// Serialisierbare Anzeige (ohne `org_id`).
    pub fn anzeige(&self) -> MaterialAnzeige {
        MaterialAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            kategorie: self.kategorie.clone(),
            bestandsnummer: self.bestandsnummer.clone(),
            traegerorganisation: self.traegerorganisation.clone(),
            standort: self.standort.clone(),
            bemerkung: self.bemerkung.clone(),
            dienststatus: self.dienststatus.clone(),
            angelegt_at: self.angelegt_at.clone(),
            art: self.art,
            ist_demo: self.ist_demo,
        }
    }
}

/// Öffentliche Material-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct MaterialAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub angelegt_at: String,
    /// Gerät oder Verbrauchsgut (LLH-1224); gilt für neue Dispositionen, nie rückwirkend.
    pub art: MaterialArt,
    /// Trägt die Zeile eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus `demo_herkunft`.
    pub ist_demo: bool,
}

wire_enum! {
    /// Fester Status einer Material-Dispositionszeile (kein admin-pflegbarer Katalog).
    /// Als TEXT in der DB gespeichert; manuell konvertiert (analog `StaerkePosition`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MaterialStatus {
        Einsatzbereit => "einsatzbereit",
        ImEinsatz => "im_einsatz",
        Defekt => "defekt",
        Verbraucht => "verbraucht",
        DesinfektionNoetig => "desinfektion_noetig",
    }
    try_from = |s| format!("Ungültiger MaterialStatus: {s}");
}

wire_enum! {
    /// Art eines Materials (LLH-1224, Spec `material-modell`): ein einzeln verfolgtes Gerät steht
    /// je Stück im Einsatz (Menge 1, alle fünf Status); ein Verbrauchsgut hat eine Menge, eine
    /// Ausgabe und keine Status „verbraucht“ und „Desinfektion nötig“. Am Stamm die Vorgabe jeder
    /// Disposition, an der Dispositionszeile eine eigene Spalte (design.md D1).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MaterialArt {
        Geraet => "geraet",
        Verbrauchsgut => "verbrauchsgut",
    }
    try_from = |s| format!("Ungültige MaterialArt: {s}");
}

impl MaterialStatus {
    /// Anzeigewort im ETB („Status «einsatzbereit» → «im Einsatz»“, LLH-1257), gleich dem Wort der
    /// Oberfläche (`materialStatus` in `frontend/src/theme/statusFarben.ts`).
    pub fn label(self) -> &'static str {
        match self {
            MaterialStatus::Einsatzbereit => "einsatzbereit",
            MaterialStatus::ImEinsatz => "im Einsatz",
            MaterialStatus::Defekt => "defekt",
            MaterialStatus::Verbraucht => "verbraucht",
            MaterialStatus::DesinfektionNoetig => "Desinfektion nötig",
        }
    }
}

impl MaterialArt {
    /// Anzeigewort im ETB („Art Gerät → Verbrauchsgut“).
    pub fn label(self) -> &'static str {
        match self {
            MaterialArt::Geraet => "Gerät",
            MaterialArt::Verbrauchsgut => "Verbrauchsgut",
        }
    }

    /// Vorgabe eines Ad-hoc-Postens ohne Angabe und der Übernahme des Bestands (design.md D1,
    /// D12): über 1 Stück Verbrauchsgut, sonst Gerät.
    pub fn from_menge(menge: i64) -> Self {
        if menge > 1 {
            MaterialArt::Verbrauchsgut
        } else {
            MaterialArt::Geraet
        }
    }
}

// Non-null, manuell gemappt (`disposition_repo::zu_anzeige` aus dem internen `Row`) —
// TryFrom<String> für `#[sqlx(try_from = "String")]` auf dem internen FromRow-Struct
// (analog `LageZoneTyp` in `src/lage_zone/repo.rs`).

/// Aufgelöste Material-Dispositionszeile: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Material in Dienst, sonst Snapshot);
/// `menge` und `status` kommen **immer** aus der Dispositionszeile.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzMaterialAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Material (kein Stamm-Bezug).
    pub material_id: Option<i64>,
    /// Ort Einheit; höchstens eines von `einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id`
    /// ist gesetzt, keines heißt „ohne Ort“ (LLH-1224, Spec `material-modell`).
    pub einheit_id: Option<i64>,
    /// Ort Unfallhilfsstelle.
    pub uhs_id: Option<i64>,
    /// Ort Fahrzeug (Beladung, `einsatz_fahrzeug.id`); fehlt, wenn nicht gesetzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_fahrzeug_id: Option<i64>,
    /// Ort Bereitstellungsraum; fehlt, wenn nicht gesetzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub br_id: Option<i64>,
    /// Gerät oder Verbrauchsgut der Zeile, beim Disponieren aus dem Stamm kopiert (LLH-1224).
    pub art: MaterialArt,
    pub ist_adhoc: bool,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub menge: i64,
    /// Ausgegebene Menge eines Verbrauchsguts (0 bei Geräten); Rest = `menge − ausgegeben`. Ganz
    /// ausgegeben heißt „aufgebraucht“ (LLH-1224, design.md D4).
    pub ausgegeben: i64,
    pub status: MaterialStatus,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
    /// Trägt der Stamm-Datensatz eine Demo-Marke (LFH-733, Spec `demo-daten`)? Live aus
    /// `demo_herkunft`, unabhängig von der Live-oder-Snapshot-Regel; Ad-hoc ist nie Demo.
    pub ist_demo: bool,
    /// Ende der Disposition (LLH-1079, Spec `kraefte-entlassung`); fehlt bei aktivem Material.
    /// Nur `GET …/material?entlassene=1` liefert beendete Zeilen, und zwar nur herausgenommene
    /// (`beendet_als = entlassen`; die Oberfläche sagt „aus dem Einsatz genommen“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beendet_von: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::entlassung::BeendetAls>)]
    pub beendet_als: Option<String>,
    /// Nachforderung, aus der der Posten übernommen wurde (LLH-1226, Spec
    /// `nachforderung-material`); nur die Kennung, den Inhalt liest die Oberfläche aus dem Modul
    /// Nachforderungen. Fehlt ohne Bezug.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nachforderung_id: Option<i64>,
}

impl EinsatzMaterialAnzeige {
    /// Der eine Ort der Zeile (LLH-1224); `None` = ohne Ort.
    pub fn ort(&self) -> Option<ort::MaterialOrt> {
        ort::MaterialOrt::aus_spalten(
            self.einheit_id,
            self.einsatz_fahrzeug_id,
            self.uhs_id,
            self.br_id,
        )
    }
}

/// Prüft eine Zeile, wie sie nach einer Änderung aussähe, gegen die Regeln von Art, Menge,
/// Ausgabe und Status (LLH-1224, design.md D2–D4, D10); die CHECKs der Tabelle sind nur das Netz.
/// `ausgabe_geaendert` wählt den Grund, wenn die Ausgabe über der Menge läge: die Anfrage setzt die
/// Ausgabe („Ausgabe größer als die Menge“) oder die Menge („Menge kleiner als die Ausgabe“).
pub fn check_zeile(
    art: MaterialArt,
    menge: i64,
    ausgegeben: i64,
    status: MaterialStatus,
    ausgabe_geaendert: bool,
) -> Result<(), crate::error::AppError> {
    use crate::error::AppError::UnprocessableEntity as U;
    if art == MaterialArt::Geraet && menge != 1 {
        return Err(U(GERAET_JE_STUECK.into()));
    }
    if art == MaterialArt::Geraet && ausgegeben > 0 {
        return Err(U("Ausgabe gibt es nur für Verbrauchsgut".into()));
    }
    if ausgegeben > menge {
        return Err(U(if ausgabe_geaendert {
            "Ausgabe größer als die Menge".into()
        } else {
            "Menge kleiner als die Ausgabe".into()
        }));
    }
    if art == MaterialArt::Verbrauchsgut
        && matches!(
            status,
            MaterialStatus::Verbraucht | MaterialStatus::DesinfektionNoetig
        )
    {
        return Err(U(format!(
            "Status «{}» gibt es nur für Geräte",
            status.label()
        )));
    }
    Ok(())
}

/// Der Grund, wenn ein Gerät mit einer Menge über 1 im Einsatz stehen soll (D2).
pub const GERAET_JE_STUECK: &str = "Ein Gerät steht je Stück im Einsatz";

#[cfg(test)]
mod tests {
    use super::*;

    fn grund(r: Result<(), crate::error::AppError>) -> String {
        match r {
            Err(crate::error::AppError::UnprocessableEntity(m)) => m,
            other => panic!("kein 422: {other:?}"),
        }
    }

    #[test]
    fn check_zeile_je_regel() {
        use MaterialArt::{Geraet as G, Verbrauchsgut as V};
        use MaterialStatus::*;
        assert!(check_zeile(G, 1, 0, DesinfektionNoetig, false).is_ok());
        assert!(check_zeile(V, 50, 50, Einsatzbereit, true).is_ok());
        assert!(check_zeile(V, 50, 0, Defekt, false).is_ok());
        assert_eq!(
            grund(check_zeile(G, 2, 0, Einsatzbereit, false)),
            "Ein Gerät steht je Stück im Einsatz"
        );
        assert_eq!(
            grund(check_zeile(G, 1, 1, Einsatzbereit, true)),
            "Ausgabe gibt es nur für Verbrauchsgut"
        );
        assert_eq!(
            grund(check_zeile(V, 50, 60, Einsatzbereit, true)),
            "Ausgabe größer als die Menge"
        );
        assert_eq!(
            grund(check_zeile(V, 10, 20, Einsatzbereit, false)),
            "Menge kleiner als die Ausgabe"
        );
        assert_eq!(
            grund(check_zeile(V, 5, 0, Verbraucht, false)),
            "Status «verbraucht» gibt es nur für Geräte"
        );
        assert_eq!(
            grund(check_zeile(V, 5, 0, DesinfektionNoetig, false)),
            "Status «Desinfektion nötig» gibt es nur für Geräte"
        );
    }

    #[test]
    fn status_roundtrip() {
        for s in [
            "einsatzbereit",
            "im_einsatz",
            "defekt",
            "verbraucht",
            "desinfektion_noetig",
        ] {
            assert_eq!(MaterialStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(MaterialStatus::parse("unsinn").is_none());
    }

    #[test]
    fn art_roundtrip_und_vorgabe_aus_der_menge() {
        for s in ["geraet", "verbrauchsgut"] {
            assert_eq!(MaterialArt::parse(s).unwrap().as_str(), s);
        }
        assert!(MaterialArt::parse("Gerät").is_none());
        assert_eq!(MaterialArt::from_menge(1), MaterialArt::Geraet);
        assert_eq!(MaterialArt::from_menge(2), MaterialArt::Verbrauchsgut);
        assert_eq!(MaterialArt::Geraet.label(), "Gerät");
        assert_eq!(MaterialArt::Verbrauchsgut.label(), "Verbrauchsgut");
    }

    /// LLH-1257: der ETB-Wortlaut eines Statuswechsels nennt je Status das Anzeigewort der
    /// Oberfläche (`materialStatus` in `frontend/src/theme/statusFarben.ts`), nie den Wire-Wert.
    #[test]
    fn etb_wortlaut_des_statuswechsels_nennt_je_status_das_label() {
        use MaterialStatus::*;
        let faelle = [
            (Einsatzbereit, "einsatzbereit"),
            (ImEinsatz, "im Einsatz"),
            (Defekt, "defekt"),
            (Verbraucht, "verbraucht"),
            (DesinfektionNoetig, "Desinfektion nötig"),
        ];
        for (status, wort) in faelle {
            assert_eq!(status.label(), wort);
            assert_eq!(
                etb_text_status_wechsel("Trage", Einsatzbereit, status),
                format!("Material «Trage»: Status «einsatzbereit» → «{wort}»")
            );
            assert_eq!(
                etb_text_status_wechsel("Trage", status, Defekt),
                format!("Material «Trage»: Status «{wort}» → «defekt»")
            );
        }
    }

    #[test]
    fn anzeige_ohne_org_id() {
        let m = Material {
            id: 7,
            org_id: 1,
            bezeichnung: "Wolldecke".into(),
            kategorie: Some("Betreuung".into()),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
            dienststatus: DIENSTSTATUS_IN_DIENST.into(),
            angelegt_at: "2026-05-27 10:00:00".into(),
            art: MaterialArt::Verbrauchsgut,
            ist_demo: false,
        };
        let a = m.anzeige();
        assert_eq!(a.id, 7);
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.dienststatus, "in_dienst");
    }
}

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB beim Disponieren von Material (Stamm oder Ad-hoc), mit Menge und, wenn gesetzt,
/// dem Ort im Wortlaut von [`ort::ort_text_tx`] (LLH-1224, design.md D11).
pub fn etb_text_disponiert(bezeichnung: &str, menge: i64, ort: Option<&str>) -> String {
    match ort {
        Some(o) => format!("Material «{bezeichnung}» (×{menge}) disponiert, Ort {o}"),
        None => format!("Material «{bezeichnung}» (×{menge}) disponiert"),
    }
}

/// Herkunft einer Übernahme aus einer Nachforderung (LLH-1226, design.md D6), angehängt an den
/// Text aus [`etb_text_disponiert`]: „{basis}, aus Nachforderung «{bezeichnung}»“. Die Bezeichnung
/// der Nachforderung ist auf [`crate::nachforderung::BEZEICHNUNG_MAX`] begrenzt.
pub fn etb_text_aus_nachforderung(basis: &str, nachforderung_bezeichnung: &str) -> String {
    format!("{basis}, aus Nachforderung «{nachforderung_bezeichnung}»")
}

/// System-ETB beim nachträglichen Verknüpfen eines vorhandenen Postens mit einer eingetroffenen
/// Nachforderung (LLH-1259, design.md D3): „Material «Feldbetten» (×20) mit Nachforderung
/// «20 Feldbetten» verknüpft“. Die Bezeichnung der Nachforderung ist auf
/// [`crate::nachforderung::BEZEICHNUNG_MAX`] begrenzt.
pub fn etb_text_mit_nachforderung_verknuepft(
    bezeichnung: &str,
    menge: i64,
    nachforderung_bezeichnung: &str,
) -> String {
    format!(
        "Material «{bezeichnung}» (×{menge}) mit Nachforderung «{nachforderung_bezeichnung}» \
         verknüpft"
    )
}

/// System-ETB bei jedem Ortswechsel eines Postens, auf jedem Weg (LLH-1224, design.md D11): alter
/// und neuer Ort im Wortlaut von [`ort::ort_text_tx`], leer „ohne Ort“.
pub fn etb_text_ort_gewechselt(
    bezeichnung: &str,
    menge: i64,
    vorher: &str,
    nachher: &str,
) -> String {
    format!("Material «{bezeichnung}» (×{menge}): {vorher} → {nachher}")
}

/// System-ETB bei einem Statuswechsel eines Postens, mit den Anzeigewörtern des Status
/// ([`MaterialStatus::label`], LLH-1257), nicht den Wire-Werten.
pub fn etb_text_status_wechsel(
    bezeichnung: &str,
    vorher: MaterialStatus,
    nachher: MaterialStatus,
) -> String {
    format!(
        "Material «{bezeichnung}»: Status «{}» → «{}»",
        vorher.label(),
        nachher.label()
    )
}

/// System-ETB bei geänderter Ausgabe eines Verbrauchsguts (LLH-1224, design.md D11), mit Rest.
pub fn etb_text_ausgabe(bezeichnung: &str, vorher: i64, nachher: i64, menge: i64) -> String {
    format!(
        "Material «{bezeichnung}»: Ausgabe {vorher} → {nachher} (Rest {} von {menge})",
        menge - nachher
    )
}

/// System-ETB beim Wechsel der Art einer Zeile (LLH-1224, design.md D10/D11).
pub fn etb_text_art_geaendert(
    bezeichnung: &str,
    vorher: MaterialArt,
    nachher: MaterialArt,
) -> String {
    format!(
        "Material «{bezeichnung}»: Art {} → {}",
        vorher.label(),
        nachher.label()
    )
}

/// System-ETB beim Herausnehmen aus dem Einsatz (LLH-1079, Wortlaut LLH-1093 Nr. 3: Material
/// wird nicht „entlassen“). Der Name der Einheit steht nur hier.
pub fn etb_text_aus_einsatz_genommen(
    bezeichnung: &str,
    menge: i64,
    einheit: Option<&str>,
) -> String {
    match einheit {
        Some(e) => {
            format!("Material «{bezeichnung}» (×{menge}, Einheit «{e}») aus dem Einsatz genommen")
        }
        None => format!("Material «{bezeichnung}» (×{menge}) aus dem Einsatz genommen"),
    }
}

/// System-ETB beim Stornieren einer Fehldisposition (LLH-1079, design.md D3).
pub fn etb_text_storniert(bezeichnung: &str, menge: i64) -> String {
    format!("Material «{bezeichnung}» (×{menge}) storniert (Fehldisposition)")
}

/// System-ETB beim erneuten Disponieren (LLH-1079, design.md D7).
pub fn etb_text_erneut_disponiert(bezeichnung: &str, menge: i64) -> String {
    format!("Material «{bezeichnung}» (×{menge}) erneut disponiert")
}

/// System-ETB beim Aufteilen eines Postens (LLH-1093, design.md D8): „aufgeteilt: 50 → 30 + 20“
/// mit Ausgangsmenge, verbleibender und abgeteilter Menge. Wechselt der abgeteilte Teil den Ort
/// (t1hvaqzu, design.md D3), nennt derselbe Eintrag alten und neuen Ort im Wortlaut von
/// [`ort::ort_text_tx`]: „…, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“.
pub fn etb_text_aufgeteilt(
    bezeichnung: &str,
    ausgang: i64,
    abgeteilt: i64,
    ortswechsel: Option<(&str, &str)>,
) -> String {
    let basis = format!(
        "Material «{bezeichnung}» aufgeteilt: {ausgang} → {} + {abgeteilt}",
        ausgang - abgeteilt
    );
    match ortswechsel {
        Some((vorher, nachher)) => format!("{basis}, davon {abgeteilt}: {vorher} → {nachher}"),
        None => basis,
    }
}

/// System-ETB beim Korrigieren der Angaben eines Ad-hoc-Postens (LLH-1093, design.md D6): EIN
/// Eintrag, der jede geänderte Angabe mit altem und neuem Wert nennt (`(Angabe, alt, neu)`, leer
/// als „—“), benannt nach der neuen Bezeichnung. Ändert sich nichts, gibt es keinen Text.
pub fn etb_text_angaben_geaendert(
    bezeichnung: &str,
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
    (!teile.is_empty()).then(|| format!("Material «{bezeichnung}»: {}", teile.join(", ")))
}

/// [`etb_text_angaben_geaendert`] für Vor- und Nachzustand eines Postens: Bezeichnung, Kategorie,
/// Bestandsnummer, Träger in dieser Folge.
pub fn etb_text_angaben(
    vorher: &EinsatzMaterialAnzeige,
    nachher: &EinsatzMaterialAnzeige,
) -> Option<String> {
    etb_text_angaben_geaendert(
        &nachher.bezeichnung,
        &[
            (
                "Bezeichnung",
                Some(&vorher.bezeichnung),
                Some(&nachher.bezeichnung),
            ),
            (
                "Kategorie",
                vorher.kategorie.as_deref(),
                nachher.kategorie.as_deref(),
            ),
            (
                "Bestandsnummer",
                vorher.bestandsnummer.as_deref(),
                nachher.bestandsnummer.as_deref(),
            ),
            (
                "Träger",
                vorher.traegerorganisation.as_deref(),
                nachher.traegerorganisation.as_deref(),
            ),
        ],
    )
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn aus_einsatz_genommen_storniert_erneut() {
        assert_eq!(
            etb_text_aus_einsatz_genommen("Sandsäcke", 250, Some("1. Zug")),
            "Material «Sandsäcke» (×250, Einheit «1. Zug») aus dem Einsatz genommen"
        );
        assert_eq!(
            etb_text_aus_einsatz_genommen("Sandsäcke", 250, None),
            "Material «Sandsäcke» (×250) aus dem Einsatz genommen"
        );
        assert_eq!(
            etb_text_storniert("Sandsäcke", 3),
            "Material «Sandsäcke» (×3) storniert (Fehldisposition)"
        );
        assert_eq!(
            etb_text_erneut_disponiert("Sandsäcke", 3),
            "Material «Sandsäcke» (×3) erneut disponiert"
        );
    }

    #[test]
    fn angaben_geaendert_nennt_jede_angabe_mit_alt_und_neu() {
        assert_eq!(
            etb_text_angaben_geaendert(
                "Feldbetten",
                &[
                    ("Bezeichnung", Some("Feldbeten"), Some("Feldbetten")),
                    ("Kategorie", None, Some("Betreuung")),
                    ("Bestandsnummer", Some("B-1"), Some("B-1")),
                    ("Träger", Some("THW"), None),
                ],
            )
            .as_deref(),
            Some(
                "Material «Feldbetten»: Bezeichnung «Feldbeten» → «Feldbetten», \
                 Kategorie «—» → «Betreuung», Träger «THW» → «—»"
            )
        );
        assert_eq!(
            etb_text_angaben_geaendert("Decke", &[("Kategorie", Some("A"), Some("A"))]),
            None,
            "unverändert: kein Text"
        );
    }

    #[test]
    fn aufgeteilt_nennt_ausgang_rest_und_teil() {
        assert_eq!(
            etb_text_aufgeteilt("Wolldecke", 50, 20, None),
            "Material «Wolldecke» aufgeteilt: 50 → 30 + 20"
        );
    }

    /// t1hvaqzu (LLH-1251), design.md D3: wandert der abgeteilte Teil, nennt derselbe Eintrag den
    /// Ortswechsel in der Pfeilform von [`etb_text_ort_gewechselt`].
    #[test]
    fn aufgeteilt_mit_ortswechsel_in_einem_eintrag() {
        assert_eq!(
            etb_text_aufgeteilt(
                "Wolldecke",
                50,
                20,
                Some(("Einheit «Staffel A»", "UHS «Turnhalle»"))
            ),
            "Material «Wolldecke» aufgeteilt: 50 → 30 + 20, davon 20: Einheit «Staffel A» → \
             UHS «Turnhalle»"
        );
    }

    #[test]
    fn disponiert_mit_menge_und_ort() {
        assert_eq!(
            etb_text_disponiert("Sandsäcke", 250, None),
            "Material «Sandsäcke» (×250) disponiert"
        );
        assert_eq!(
            etb_text_disponiert("Wolldecke", 50, Some("UHS «Turnhalle»")),
            "Material «Wolldecke» (×50) disponiert, Ort UHS «Turnhalle»"
        );
    }

    /// LLH-1226, design.md D6: die Herkunft hängt am Disponier-Text, mit und ohne Ort.
    #[test]
    fn aus_nachforderung_haengt_die_bezeichnung_an() {
        assert_eq!(
            etb_text_aus_nachforderung(
                &etb_text_disponiert("Tauchpumpe", 1, Some("Einheit «Staffel A»")),
                "3 Tauchpumpen für Keller Hauptstraße"
            ),
            "Material «Tauchpumpe» (×1) disponiert, Ort Einheit «Staffel A», aus Nachforderung \
             «3 Tauchpumpen für Keller Hauptstraße»"
        );
        assert_eq!(
            etb_text_aus_nachforderung(
                &etb_text_disponiert("Sandsäcke", 500, None),
                "Sandsäcke Deich Nord"
            ),
            "Material «Sandsäcke» (×500) disponiert, aus Nachforderung «Sandsäcke Deich Nord»"
        );
    }

    #[test]
    fn ort_gewechselt_ausgabe_und_art() {
        assert_eq!(
            etb_text_ort_gewechselt("Wolldecke", 20, "Einheit «Staffel A»", "UHS «Turnhalle»"),
            "Material «Wolldecke» (×20): Einheit «Staffel A» → UHS «Turnhalle»"
        );
        assert_eq!(
            etb_text_ort_gewechselt("Wolldecke", 20, "ohne Ort", "Fahrzeug «Florian 1/83-1»"),
            "Material «Wolldecke» (×20): ohne Ort → Fahrzeug «Florian 1/83-1»"
        );
        assert_eq!(
            etb_text_ort_gewechselt("Wolldecke", 20, "Einheit «Staffel A»", "ohne Ort"),
            "Material «Wolldecke» (×20): Einheit «Staffel A» → ohne Ort"
        );
        assert_eq!(
            etb_text_ausgabe("Wolldecke", 20, 30, 50),
            "Material «Wolldecke»: Ausgabe 20 → 30 (Rest 20 von 50)"
        );
        assert_eq!(
            etb_text_art_geaendert("Wolldecke", MaterialArt::Geraet, MaterialArt::Verbrauchsgut),
            "Material «Wolldecke»: Art Gerät → Verbrauchsgut"
        );
    }
}
