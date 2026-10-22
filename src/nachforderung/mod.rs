//! Nachforderung von Kräften/Mitteln (LFH-87): strukturierte Anforderung an externe
//! Stellen mit verfolgbarem, linearem Bedarfs-Status (Abzweig „abgelehnt"). Eigenes Modul
//! nach dem Auftrags-Template (LFH-52); ETB-Kopplung Pattern B. Bewusst KEIN
//! `kommunikation_status` — der lineare Bedarfsfluss passt nicht auf dessen zwei Achsen
//! (vgl. Meldungs-Triage).
pub mod arten;
pub mod benachrichtigung;
pub mod repo;

use crate::kommunikation::{AdressatKategorie, Prioritaet};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge der Bezeichnung einer Nachforderung (LFH-937; in der Oberfläche „Details /
/// Zweck“, seit LLH-1089 optional); sie steht im Inhalt des ETB-Eintrags. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const BEZEICHNUNG_MAX: usize = 200;
/// Höchstlänge der Art einer Nachforderung (Freitext, landet im ETB-Inhalt; LFH-937).
pub const ART_MAX: usize = 200;
/// Höchstlänge des Ziels als Freitext (Meldeort, LLH-1089 design.md D8); landet im ETB-Inhalt.
pub const ZIEL_TEXT_MAX: usize = 200;
/// Höchstlänge eines zugesagten Rufnamens („Wer“ der Zusage, LLH-1097 design.md D2); landet im
/// ETB-Inhalt. Spiegel: `frontend/src/api/eingabegrenzen.ts`.
pub const ZUSAGE_RUFNAME_MAX: usize = 100;
/// Höchstzahl der Rufnamen einer Zusage, gezählt vor dem Entdoppeln (D2).
pub const ZUSAGE_RUFNAMEN_MAX: usize = 20;
/// Höchstlänge des Grunds beim Zurückziehen (D8); landet im ETB-Inhalt.
pub const ZURUECKZIEHEN_GRUND_MAX: usize = 200;
/// Höchstlänge des Grunds beim Ablehnen (LLH-1385, wie beim Zurückziehen); landet im ETB-Inhalt.
/// Spiegel: `frontend/src/api/eingabegrenzen.ts`.
pub const ABLEHNEN_GRUND_MAX: usize = 200;
/// Höchstzahl der Einheiten einer Übernahme aus einer Nachforderung, gezählt vor dem Entdoppeln
/// (LLH-1383 design.md D2; so viele wie Rufnamen einer Zusage). Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const UEBERNAHME_EINHEITEN_MAX: usize = ZUSAGE_RUFNAMEN_MAX;

/// Priorität (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = Prioritaet::Sofort.as_str();
pub const PRIO_DRINGEND: &str = Prioritaet::Dringend.as_str();
pub const PRIO_NORMAL: &str = Prioritaet::Normal.as_str();

/// Adressat-Kategorie (externe Stelle).
pub const ADRESSAT_LEITSTELLE: &str = AdressatKategorie::Leitstelle.as_str();
pub const ADRESSAT_NACHBAR_EA: &str = AdressatKategorie::NachbarEa.as_str();
pub const ADRESSAT_UEBERGEORDNET: &str = AdressatKategorie::Uebergeordnet.as_str();
pub const ADRESSAT_ANDERE_BOS: &str = AdressatKategorie::AndereBos.as_str();

/// Bedarfs-Status (linear + Abzweig).
pub const STATUS_ANGEFORDERT: &str = NachforderungStatus::Angefordert.as_str();
pub const STATUS_ZUGESAGT: &str = NachforderungStatus::Zugesagt.as_str();
pub const STATUS_UNTERWEGS: &str = NachforderungStatus::Unterwegs.as_str();
pub const STATUS_EINGETROFFEN: &str = NachforderungStatus::Eingetroffen.as_str();
pub const STATUS_ABGELEHNT: &str = NachforderungStatus::Abgelehnt.as_str();
pub const STATUS_ZURUECKGEZOGEN: &str = NachforderungStatus::Zurueckgezogen.as_str();

wire_enum! {
    /// Bedarfs-Status einer Nachforderung (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `status`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum NachforderungStatus {
        Angefordert => "angefordert",
        Zugesagt => "zugesagt",
        Unterwegs => "unterwegs",
        Eingetroffen => "eingetroffen",
        Abgelehnt => "abgelehnt",
        /// Von der eigenen Führung zurückgezogen („nicht mehr benötigt“, LLH-1097 design.md D8);
        /// terminal wie `abgelehnt`, das die Absage der angeforderten Stelle ist.
        Zurueckgezogen => "zurueckgezogen",
    }
    try_from = |s| format!("Ungültiger NachforderungStatus: {s}");
}

impl NachforderungStatus {
    /// Noch nicht eingetroffen, abgelehnt oder zurückgezogen — dieselbe Regel wie die Spalte
    /// `ist_offen` der Liste (`repo::ANZEIGE_SELECT`); der Modulzähler zählt damit (LLH-1078), und
    /// `tests/modul_zaehler.rs` hält Liste und Zähler gleich.
    pub fn ist_offen(self) -> bool {
        !matches!(
            self,
            Self::Eingetroffen | Self::Abgelehnt | Self::Zurueckgezogen
        )
    }
}

pub fn prioritaet_gueltig(p: &str) -> bool {
    Prioritaet::parse(p).is_some()
}

pub fn adressat_kategorie_gueltig(a: &str) -> bool {
    AdressatKategorie::parse(a).is_some()
}

pub fn status_gueltig(s: &str) -> bool {
    NachforderungStatus::parse(s).is_some()
}

/// Erlaubter Status-Übergang: linear vorwärts (angefordert→zugesagt→unterwegs→eingetroffen)
/// und die Abzweige „abgelehnt" und „zurückgezogen" (LLH-1097 design.md D8) aus jedem offenen
/// Zustand. `abgelehnt`/`zurueckgezogen` sind terminal, `eingetroffen` kennt nur den Rückweg.
pub fn uebergang_erlaubt(von: &str, nach: &str) -> bool {
    match von {
        STATUS_ANGEFORDERT => matches!(
            nach,
            STATUS_ZUGESAGT | STATUS_ABGELEHNT | STATUS_ZURUECKGEZOGEN
        ),
        // Die Rücknahme um genau eine Stufe (LFH-343 · C8) ist der Gegenweg zur
        // Direktaktion ohne Rückfrage: die Fortschaltung kostet seither einen Klick
        // statt zweier, und der Rückgängig-Toast braucht einen Weg, den der Server
        // annimmt. Zwei Stufen zurück bleiben zu — sonst wäre die Kette keine.
        STATUS_ZUGESAGT => matches!(
            nach,
            STATUS_UNTERWEGS | STATUS_ABGELEHNT | STATUS_ANGEFORDERT | STATUS_ZURUECKGEZOGEN
        ),
        STATUS_UNTERWEGS => matches!(
            nach,
            STATUS_EINGETROFFEN | STATUS_ABGELEHNT | STATUS_ZUGESAGT | STATUS_ZURUECKGEZOGEN
        ),
        // `eingetroffen` bekommt NUR den Rückweg, nicht die Abzweige auf `abgelehnt` oder
        // `zurueckgezogen`: was da ist, wird nicht nachträglich abgelehnt oder zurückgezogen.
        STATUS_EINGETROFFEN => matches!(nach, STATUS_UNTERWEGS),
        // `abgelehnt` und `zurueckgezogen` bleiben terminal.
        _ => false,
    }
}

/// Anzeige einer Nachforderung inkl. Ersteller-Name (JOIN) und abgeleitetem `ist_offen`
/// (noch nicht eingetroffen/abgelehnt). Reihenfolge der Felder = SELECT-Projektion.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct NachforderungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub art: String,
    /// Details/Zweck; fehlt ohne Angabe (LLH-1089 design.md D10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: AdressatKategorie,
    pub adressat_bezeichnung: Option<String>,
    pub begruendung: Option<String>,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    #[sqlx(try_from = "String")]
    pub status: NachforderungStatus,
    pub zugesagt_at: Option<String>,
    pub unterwegs_at: Option<String>,
    pub eingetroffen_at: Option<String>,
    pub abgelehnt_at: Option<String>,
    pub abgelehnt_grund: Option<String>,
    pub angefordert_at: String,
    pub etb_nachforderung_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: Ersteller-Anzeigename (LEFT JOIN benutzer).
    pub erstellt_von_name: Option<String>,
    /// Abgeleitet: status NOT IN ('eingetroffen','abgelehnt','zurueckgezogen').
    pub ist_offen: bool,
    /// Abgeleitet: Kennungen der aus dieser Nachforderung übernommenen, nicht stornierten
    /// Materialposten, aufsteigend; leer ohne Übernahme (LLH-1226, design.md D8). Nur Kennungen:
    /// Bezeichnung, Menge und Ort liest die Oberfläche aus dem Modul Material.
    #[sqlx(try_from = "String")]
    #[schema(value_type = Vec<i64>)]
    pub material_ids: MaterialIds,
    /// Betreuungsstelle, für die angefordert wurde (LLH-1082, design.md D1/D4). Nur die Kennung:
    /// den Namen liest die Oberfläche aus dem Modul Betreuung, sonst sähe ihn auch, wer
    /// Betreuung nicht lesen darf. Fehlt ohne Bezug; der Storno der Stelle löst ihn (D3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betreuungsstelle_id: Option<i64>,
    /// Ziel (Meldeort, LLH-1089 design.md D5/D10): höchstens eines von Raum, Abschnitt und
    /// Freitext. Von Raum und Abschnitt nur die Kennung; den Namen liest die Oberfläche aus deren
    /// Modul, wie bei der Betreuungsstelle. Fehlt ohne Ziel; das Löschen des Abschnitts löst ihn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_br_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_text: Option<String>,
    /// Bedarfszeit „benötigt bis“ (UTC); fehlt = sofort (LLH-1089 design.md D6).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub benoetigt_bis: Option<String>,
    /// „Wer“ der Zusage: Rufnamen oder freie Angaben in Eingabefolge, leer ohne Angabe
    /// (LLH-1097 design.md D2). Teil (b) legt je Eintrag eine Einheit an.
    #[sqlx(try_from = "String")]
    #[schema(value_type = Vec<String>)]
    pub zusage_rufnamen: ZusageRufnamen,
    /// Voraussichtliches Eintreffen laut Zusage (UTC, D3); fehlt ohne Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eintreffen_erwartet_at: Option<String>,
    /// Bei einer Teilzusage die Anzahl vor der Teilung („1 von 2 zugesagt“, D1); fehlt ohne.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anzahl_angefordert: Option<i64>,
    /// Restposition einer Teilzusage: die Nachforderung, aus der sie abgeteilt wurde (D1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub teilung_aus_id: Option<i64>,
    /// Zurückgezogen durch die eigene Führung (D8): Zeitpunkt und optionaler Grund.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgezogen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgezogen_grund: Option<String>,
    /// Abgeleitet: Kennungen der aus dieser Nachforderung übernommenen Einheiten, aufsteigend, auch
    /// aufgelöste; leer ohne Übernahme (LLH-1383, design.md D7). Nur Kennungen: Namen liest die
    /// Oberfläche aus dem Modul Einheiten.
    #[sqlx(try_from = "String")]
    #[schema(value_type = Vec<i64>)]
    pub einheit_ids: MaterialIds,
}

/// Rufnamen einer Zusage, gelesen aus dem JSON-Array der Spalte `zusage_rufnamen` (NULL → `[]` im
/// SELECT); auf dem Draht ein Array von Zeichenketten.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ZusageRufnamen(pub Vec<String>);

impl TryFrom<String> for ZusageRufnamen {
    type Error = serde_json::Error;

    fn try_from(json: String) -> Result<Self, Self::Error> {
        serde_json::from_str(&json).map(ZusageRufnamen)
    }
}

/// Kennungen übernommener Materialposten bzw. Einheiten (LLH-1383), gelesen aus dem JSON-Array
/// einer Unterabfrage in `repo::ANZEIGE_SELECT`; auf dem Draht ein Array von Zahlen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct MaterialIds(pub Vec<i64>);

impl TryFrom<String> for MaterialIds {
    type Error = serde_json::Error;

    fn try_from(json: String) -> Result<Self, Self::Error> {
        serde_json::from_str(&json).map(MaterialIds)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritaet_und_adressat_validierung() {
        assert!(prioritaet_gueltig(PRIO_SOFORT));
        assert!(!prioritaet_gueltig("ultra"));
        assert!(adressat_kategorie_gueltig(ADRESSAT_LEITSTELLE));
        assert!(!adressat_kategorie_gueltig("nachbar"));
    }

    #[test]
    fn offen_sind_die_drei_stufen_vor_dem_abschluss() {
        use NachforderungStatus as S;
        assert!(S::Angefordert.ist_offen());
        assert!(S::Zugesagt.ist_offen());
        assert!(S::Unterwegs.ist_offen());
        assert!(!S::Eingetroffen.ist_offen());
        assert!(!S::Abgelehnt.ist_offen());
        assert!(!S::Zurueckgezogen.ist_offen());
    }

    /// LLH-1097 D8: die eigene Führung zieht nur Offenes zurück; danach geht nichts mehr.
    #[test]
    fn zurueckziehen_nur_aus_offenen_stufen_und_terminal() {
        assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ZURUECKGEZOGEN));
        assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_ZURUECKGEZOGEN));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ZURUECKGEZOGEN));
        assert!(!uebergang_erlaubt(
            STATUS_EINGETROFFEN,
            STATUS_ZURUECKGEZOGEN
        ));
        assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_ZURUECKGEZOGEN));
        for nach in NachforderungStatus::ALLE {
            assert!(
                !uebergang_erlaubt(STATUS_ZURUECKGEZOGEN, nach.as_str()),
                "zurückgezogen → {}",
                nach.as_str()
            );
        }
        assert!(!uebergang_erlaubt(
            STATUS_ZURUECKGEZOGEN,
            STATUS_ZURUECKGEZOGEN
        ));
    }

    #[test]
    fn status_validierung() {
        assert!(status_gueltig(STATUS_UNTERWEGS));
        assert!(!status_gueltig("storniert"));
    }

    #[test]
    fn uebergaenge_linear_und_abzweig() {
        assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ZUGESAGT));
        assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_UNTERWEGS));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_EINGETROFFEN));
        assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ABGELEHNT));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ABGELEHNT));
        // Verboten: Sprünge und der Abzweig aus terminalen Zuständen.
        assert!(!uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_UNTERWEGS));
        assert!(!uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_ABGELEHNT));
        assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_ZUGESAGT));
    }

    /// Die Rücknahme ist der Gegenweg zur Direktaktion ohne Rückfrage
    /// (LFH-343 · C8, Befund H50). Sie ersetzt die frühere Zusicherung
    /// „keine Rückschritte" — bewusst: ohne serverseitigen Rückweg wäre ein
    /// Rückgängig-Knopf ein 422, und das ist schlechter als kein Knopf.
    #[test]
    fn ruecknahme_um_eine_stufe_erlaubt_terminales_bleibt_zu() {
        // Genau EINE Stufe zurück.
        assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_ANGEFORDERT));
        assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ZUGESAGT));
        assert!(uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_UNTERWEGS));
        // Zwei Stufen zurück NICHT — sonst wäre die Kette keine.
        assert!(!uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_ANGEFORDERT));
        assert!(!uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ANGEFORDERT));
        // `abgelehnt` bleibt terminal: das Ablehnen trägt einen Grund und ein
        // eigenes Modal, seine Rücknahme ist eine fachliche Entscheidung und
        // kein Undo-Klick.
        assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_ANGEFORDERT));
        assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_UNTERWEGS));
        // Und aus `eingetroffen` führt kein Weg auf `abgelehnt` (oben gepinnt) —
        // die Rücknahme öffnet nur die eine Stufe, nicht den Abzweig.
        assert!(!uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_ABGELEHNT));
    }
}
