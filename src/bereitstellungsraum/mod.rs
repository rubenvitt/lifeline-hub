pub mod belegung_repo;
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Status eines Bereitstellungsraums. String = CHECK-Constraint in
    /// `migrations/0060_bereitstellungsraum.sql`. `aufgeloest` ist terminal.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BrStatus {
        Geplant => "geplant",
        Aktiv => "aktiv",
        Aufgeloest => "aufgeloest",
    }
    try_from = |s| format!("Ungültiger BrStatus: {s}");
}

/// Ob ein BR-Status-Übergang `von → nach` erlaubt ist. Status-Maschine:
/// `geplant → aktiv → aufgeloest` (terminal); `geplant → aufgeloest` direkt
/// erlaubt (BR war nie in Betrieb). Die Belegungs-Vorbedingung
/// für `→ aufgeloest` (kein aktiv Belegter) prüft der Handler.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use BrStatus::*;
    let (Some(von), Some(nach)) = (BrStatus::parse(von), BrStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Geplant => matches!(nach, Aktiv | Aufgeloest),
        Aktiv => matches!(nach, Aufgeloest),
        Aufgeloest => false, // terminal
    }
}

wire_enum! {
    /// Typ des belegenden Objekts. String = CHECK-Constraint in
    /// `migrations/0061_br_belegung.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ObjektTyp {
        Einheit => "einheit",
        Fahrzeug => "fahrzeug",
    }
    try_from = |s| format!("Ungültiger ObjektTyp: {s}");
}

wire_enum! {
    /// Art eines BR-Belegungs-Events. String = CHECK-Constraint in
    /// `migrations/0061_br_belegung.sql`. Append-only.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BrBelegungsArt {
        Eintritt => "eintritt",
        Wechsel => "wechsel",
        Austritt => "austritt",
    }
    try_from = |s| format!("Ungültige BrBelegungsArt: {s}");
}

/// Serialisierbare BR-Anzeige (1:1 zur Tabelle `bereitstellungsraum`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct BrAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub bezeichnung: String,
    pub standort: Option<String>,
    pub notiz: Option<String>,
    #[sqlx(try_from = "String")]
    pub status: BrStatus,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
}

/// Belegungs-Verlaufseintrag (1:1 zu `br_belegung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct BrBelegungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub br_id: i64,
    #[sqlx(try_from = "String")]
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    #[sqlx(try_from = "String")]
    pub art: BrBelegungsArt,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip_und_uebergaenge() {
        for s in ["geplant", "aktiv", "aufgeloest"] {
            assert_eq!(BrStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(BrStatus::parse("quatsch").is_none());
        assert!(darf_uebergehen("geplant", "aktiv"));
        assert!(darf_uebergehen("geplant", "aufgeloest"));
        assert!(darf_uebergehen("aktiv", "aufgeloest"));
        assert!(!darf_uebergehen("aufgeloest", "aktiv"));
        assert!(!darf_uebergehen("aktiv", "aktiv"));
    }

    #[test]
    fn objekt_typ_und_belegungs_art_roundtrip() {
        for t in ["einheit", "fahrzeug"] {
            assert_eq!(ObjektTyp::parse(t).unwrap().as_str(), t);
        }
        assert!(ObjektTyp::parse("person").is_none());
        for a in ["eintritt", "wechsel", "austritt"] {
            assert_eq!(BrBelegungsArt::parse(a).unwrap().as_str(), a);
        }
    }
}

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB beim Statuswechsel eines Bereitstellungsraums. Nur `aktiv` und `aufgeloest`
/// schreiben einen Eintrag; jeder andere Zielstatus liefert `None`.
pub fn etb_text_status(bezeichnung: &str, neuer_status: &str) -> Option<String> {
    match neuer_status {
        "aktiv" => Some(format!(
            "Bereitstellungsraum {} in Betrieb genommen",
            bezeichnung
        )),
        "aufgeloest" => Some(format!("Bereitstellungsraum {} aufgelöst", bezeichnung)),
        _ => None,
    }
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn status_aktiv_aufgeloest_und_ohne_eintrag() {
        assert_eq!(
            etb_text_status("BR Sportplatz", "aktiv").as_deref(),
            Some("Bereitstellungsraum BR Sportplatz in Betrieb genommen")
        );
        assert_eq!(
            etb_text_status("BR Sportplatz", "aufgeloest").as_deref(),
            Some("Bereitstellungsraum BR Sportplatz aufgelöst")
        );
        assert_eq!(etb_text_status("BR Sportplatz", "geplant"), None);
    }
}
