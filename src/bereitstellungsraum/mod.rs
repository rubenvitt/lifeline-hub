use serde::Serialize;

/// Status eines Bereitstellungsraums. String = CHECK-Constraint in
/// `migrations/0060_bereitstellungsraum.sql`. `aufgeloest` ist terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BrStatus {
    Geplant,
    Aktiv,
    Aufgeloest,
}

impl BrStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrStatus::Geplant => "geplant",
            BrStatus::Aktiv => "aktiv",
            BrStatus::Aufgeloest => "aufgeloest",
        }
    }

    pub fn parse(s: &str) -> Option<BrStatus> {
        match s {
            "geplant" => Some(BrStatus::Geplant),
            "aktiv" => Some(BrStatus::Aktiv),
            "aufgeloest" => Some(BrStatus::Aufgeloest),
            _ => None,
        }
    }
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

/// Typ des belegenden Objekts. String = CHECK-Constraint in
/// `migrations/0061_br_belegung.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ObjektTyp {
    Einheit,
    Fahrzeug,
}

impl ObjektTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            ObjektTyp::Einheit => "einheit",
            ObjektTyp::Fahrzeug => "fahrzeug",
        }
    }

    pub fn parse(s: &str) -> Option<ObjektTyp> {
        match s {
            "einheit" => Some(ObjektTyp::Einheit),
            "fahrzeug" => Some(ObjektTyp::Fahrzeug),
            _ => None,
        }
    }
}

/// Art eines BR-Belegungs-Events. String = CHECK-Constraint in
/// `migrations/0061_br_belegung.sql`. Append-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BrBelegungsArt {
    Eintritt,
    Wechsel,
    Austritt,
}

impl BrBelegungsArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            BrBelegungsArt::Eintritt => "eintritt",
            BrBelegungsArt::Wechsel => "wechsel",
            BrBelegungsArt::Austritt => "austritt",
        }
    }

    pub fn parse(s: &str) -> Option<BrBelegungsArt> {
        match s {
            "eintritt" => Some(BrBelegungsArt::Eintritt),
            "wechsel" => Some(BrBelegungsArt::Wechsel),
            "austritt" => Some(BrBelegungsArt::Austritt),
            _ => None,
        }
    }
}

/// Serialisierbare BR-Anzeige (1:1 zur Tabelle `bereitstellungsraum`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BrAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub bezeichnung: String,
    pub standort: Option<String>,
    pub notiz: Option<String>,
    pub status: String,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
}

/// Belegungs-Verlaufseintrag (1:1 zu `br_belegung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BrBelegungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub br_id: i64,
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub art: String,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip_und_uebergaenge() {
        for s in ["geplant","aktiv","aufgeloest"] { assert_eq!(BrStatus::parse(s).unwrap().as_str(), s); }
        assert!(BrStatus::parse("quatsch").is_none());
        assert!(darf_uebergehen("geplant","aktiv"));
        assert!(darf_uebergehen("geplant","aufgeloest"));
        assert!(darf_uebergehen("aktiv","aufgeloest"));
        assert!(!darf_uebergehen("aufgeloest","aktiv"));
        assert!(!darf_uebergehen("aktiv","aktiv"));
    }

    #[test]
    fn objekt_typ_und_belegungs_art_roundtrip() {
        for t in ["einheit","fahrzeug"] { assert_eq!(ObjektTyp::parse(t).unwrap().as_str(), t); }
        assert!(ObjektTyp::parse("person").is_none());
        for a in ["eintritt","wechsel","austritt"] { assert_eq!(BrBelegungsArt::parse(a).unwrap().as_str(), a); }
    }
}
