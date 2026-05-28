pub mod belegung_repo;
pub mod platz_repo;
pub mod repo;

use serde::Serialize;

/// Typ einer Unfallhilfsstelle. String = CHECK-Constraint in
/// `migrations/0027_uhs.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum UhsTyp {
    Patientenablage,
    Behandlungsplatz,
    Verletztensammelstelle,
    Bereitstellungsraum,
    Sonstige,
}

impl UhsTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            UhsTyp::Patientenablage => "patientenablage",
            UhsTyp::Behandlungsplatz => "behandlungsplatz",
            UhsTyp::Verletztensammelstelle => "verletztensammelstelle",
            UhsTyp::Bereitstellungsraum => "bereitstellungsraum",
            UhsTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<UhsTyp> {
        match s {
            "patientenablage" => Some(UhsTyp::Patientenablage),
            "behandlungsplatz" => Some(UhsTyp::Behandlungsplatz),
            "verletztensammelstelle" => Some(UhsTyp::Verletztensammelstelle),
            "bereitstellungsraum" => Some(UhsTyp::Bereitstellungsraum),
            "sonstige" => Some(UhsTyp::Sonstige),
            _ => None,
        }
    }

    /// Anzeigelabel (für pseudonyme ETB-Texte, z. B. „BHP 50 (Behandlungsplatz) in Betrieb genommen").
    pub fn anzeige_label(&self) -> &'static str {
        match self {
            UhsTyp::Patientenablage => "Patientenablage",
            UhsTyp::Behandlungsplatz => "Behandlungsplatz",
            UhsTyp::Verletztensammelstelle => "Verletztensammelstelle",
            UhsTyp::Bereitstellungsraum => "Bereitstellungsraum",
            UhsTyp::Sonstige => "Sonstige",
        }
    }
}

/// Status einer UHS. String = CHECK-Constraint. `aufgeloest` ist terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum UhsStatus {
    Geplant,
    Aktiv,
    Aufgeloest,
}

impl UhsStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            UhsStatus::Geplant => "geplant",
            UhsStatus::Aktiv => "aktiv",
            UhsStatus::Aufgeloest => "aufgeloest",
        }
    }

    pub fn parse(s: &str) -> Option<UhsStatus> {
        match s {
            "geplant" => Some(UhsStatus::Geplant),
            "aktiv" => Some(UhsStatus::Aktiv),
            "aufgeloest" => Some(UhsStatus::Aufgeloest),
            _ => None,
        }
    }
}

/// Ob ein UHS-Status-Übergang `von → nach` erlaubt ist. Status-Maschine:
/// `geplant → aktiv → aufgeloest` (terminal); `geplant → aufgeloest` direkt
/// erlaubt (UHS war nie in Betrieb, leerer Abriss). Die Belegungs-Vorbedingung
/// für `→ aufgeloest` (kein aktiv Belegter) prüft der Handler (Task 10).
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use UhsStatus::*;
    let (Some(von), Some(nach)) = (UhsStatus::parse(von), UhsStatus::parse(nach)) else {
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

/// Typ eines Platzes innerhalb einer UHS. String = CHECK-Constraint in
/// `migrations/0028_uhs_platz.sql`. „Eingang"/„Inbox" ist KEIN Typ — die
/// Inbox ist implizit über `platz_id = NULL` in der Belegung modelliert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PlatzTyp {
    Wartebereich,
    Behandlungsplatz,
    Bett,
    Intensivplatz,
    Trage,
    TransportBereitstellung,
    Sonstige,
}

impl PlatzTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlatzTyp::Wartebereich => "wartebereich",
            PlatzTyp::Behandlungsplatz => "behandlungsplatz",
            PlatzTyp::Bett => "bett",
            PlatzTyp::Intensivplatz => "intensivplatz",
            PlatzTyp::Trage => "trage",
            PlatzTyp::TransportBereitstellung => "transport_bereitstellung",
            PlatzTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<PlatzTyp> {
        match s {
            "wartebereich" => Some(PlatzTyp::Wartebereich),
            "behandlungsplatz" => Some(PlatzTyp::Behandlungsplatz),
            "bett" => Some(PlatzTyp::Bett),
            "intensivplatz" => Some(PlatzTyp::Intensivplatz),
            "trage" => Some(PlatzTyp::Trage),
            "transport_bereitstellung" => Some(PlatzTyp::TransportBereitstellung),
            "sonstige" => Some(PlatzTyp::Sonstige),
            _ => None,
        }
    }
}

/// Verfügbarkeit eines Platzes (getrennt von Belegung). String = CHECK in
/// `migrations/0028_uhs_platz.sql`. `reserviert` ist im DB-CHECK an
/// `reserviert_fuer_person_id IS NOT NULL` gekoppelt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Verfuegbarkeit {
    Frei,
    Defekt,
    Aufbereitung,
    Gesperrt,
    Reserviert,
}

impl Verfuegbarkeit {
    pub fn as_str(&self) -> &'static str {
        match self {
            Verfuegbarkeit::Frei => "frei",
            Verfuegbarkeit::Defekt => "defekt",
            Verfuegbarkeit::Aufbereitung => "aufbereitung",
            Verfuegbarkeit::Gesperrt => "gesperrt",
            Verfuegbarkeit::Reserviert => "reserviert",
        }
    }

    pub fn parse(s: &str) -> Option<Verfuegbarkeit> {
        match s {
            "frei" => Some(Verfuegbarkeit::Frei),
            "defekt" => Some(Verfuegbarkeit::Defekt),
            "aufbereitung" => Some(Verfuegbarkeit::Aufbereitung),
            "gesperrt" => Some(Verfuegbarkeit::Gesperrt),
            "reserviert" => Some(Verfuegbarkeit::Reserviert),
            _ => None,
        }
    }
}

/// Art eines Belegungs-Events. String = CHECK in
/// `migrations/0029_person_uhs_belegung.sql`. Append-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BelegungsArt {
    Eintritt,
    Wechsel,
    Austritt,
}

impl BelegungsArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            BelegungsArt::Eintritt => "eintritt",
            BelegungsArt::Wechsel => "wechsel",
            BelegungsArt::Austritt => "austritt",
        }
    }

    pub fn parse(s: &str) -> Option<BelegungsArt> {
        match s {
            "eintritt" => Some(BelegungsArt::Eintritt),
            "wechsel" => Some(BelegungsArt::Wechsel),
            "austritt" => Some(BelegungsArt::Austritt),
            _ => None,
        }
    }
}

/// Serialisierbare UHS-Anzeige (1:1 zur Tabelle, ohne abgeleitete Felder).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct UhsAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub typ: String,
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

/// Serialisierbare Platz-Anzeige (1:1 zur Tabelle).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PlatzAnzeige {
    pub id: i64,
    pub uhs_id: i64,
    pub typ: String,
    pub bezeichnung: String,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
    pub verfuegbarkeit: String,
    pub reserviert_fuer_person_id: Option<i64>,
    pub storniert_at: Option<String>,
}

/// Belegungs-Verlaufseintrag (1:1 zu `person_uhs_belegung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BelegungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub uhs_id: i64,
    pub platz_id: Option<i64>,
    pub art: String,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uhs_typ_roundtrip() {
        for t in ["patientenablage", "behandlungsplatz", "verletztensammelstelle",
                  "bereitstellungsraum", "sonstige"] {
            assert_eq!(UhsTyp::parse(t).unwrap().as_str(), t);
        }
        assert!(UhsTyp::parse("zeltkrankenhaus").is_none());
        assert_eq!(UhsTyp::parse("behandlungsplatz").unwrap().anzeige_label(), "Behandlungsplatz");
    }

    #[test]
    fn uhs_status_roundtrip() {
        for s in ["geplant", "aktiv", "aufgeloest"] {
            assert_eq!(UhsStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(UhsStatus::parse("unsinn").is_none());
    }

    #[test]
    fn platz_typ_roundtrip() {
        for t in ["wartebereich", "behandlungsplatz", "bett", "intensivplatz",
                  "trage", "transport_bereitstellung", "sonstige"] {
            assert_eq!(PlatzTyp::parse(t).unwrap().as_str(), t);
        }
        assert!(PlatzTyp::parse("eingang").is_none(), "Eingang ist KEIN Platz-Typ (Inbox ist implizit)");
    }

    #[test]
    fn verfuegbarkeit_roundtrip() {
        for v in ["frei", "defekt", "aufbereitung", "gesperrt", "reserviert"] {
            assert_eq!(Verfuegbarkeit::parse(v).unwrap().as_str(), v);
        }
        assert!(Verfuegbarkeit::parse("besetzt").is_none(), "Belegung ist KEINE Verfügbarkeit");
    }

    #[test]
    fn belegungs_art_roundtrip() {
        for a in ["eintritt", "wechsel", "austritt"] {
            assert_eq!(BelegungsArt::parse(a).unwrap().as_str(), a);
        }
        assert!(BelegungsArt::parse("verlegung").is_none());
    }

    #[test]
    fn status_uebergaenge_geplant_aktiv_aufgeloest() {
        assert!(darf_uebergehen("geplant", "aktiv"));
        assert!(darf_uebergehen("aktiv", "aufgeloest"));
        // Direkt geplant → aufgeloest: erlaubt (Fehl-Anlage; Spec implizit über
        // „aufgeloest nur wenn keine Belegung" — aus geplant ist es trivial leer).
        assert!(darf_uebergehen("geplant", "aufgeloest"));
        // Rückwege:
        assert!(!darf_uebergehen("aktiv", "geplant"));
        assert!(!darf_uebergehen("aufgeloest", "aktiv"), "aufgeloest ist terminal");
        assert!(!darf_uebergehen("aufgeloest", "geplant"));
        // Gleichbleibend nicht erlaubt:
        assert!(!darf_uebergehen("aktiv", "aktiv"));
        // Unbekannt:
        assert!(!darf_uebergehen("geplant", "quatsch"));
    }
}
