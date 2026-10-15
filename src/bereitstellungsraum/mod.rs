pub mod belegung_repo;
pub mod eintreffen;
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

/// Kennzahlen der Belegung eines Raums (LLH-1095, design.md D1–D3, Spec
/// `bereitstellungsraum-belegung`, „Kennzahlen der Belegung“). Liste und Detail lesen sie aus
/// demselben Baustein [`belegung_repo::kennzahlen_je_raum`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct BrBelegungKennzahlen {
    /// Einheiten im Raum; eine Untereinheit, die selbst im Raum steht, zählt einzeln.
    pub einheiten: i64,
    /// Verschiedene aktive Fahrzeuge im Raum: einheitenlose und die der Einheiten im Raum.
    pub fahrzeuge: i64,
    /// Frühestes „seit“ über Einheiten und einheitenlose Fahrzeuge (UTC ohne Zone); fehlt, wenn
    /// keine Kraft ein „seit“ hat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub laengste_seit_at: Option<String>,
}

wire_enum! {
    /// Art eines Eintrags im Verlauf eines Raums (LLH-1095, design.md D5). Anders als
    /// [`BrBelegungsArt`] aus Sicht des gelesenen Raums: ein `wechsel` ist für den Zielraum
    /// `wechsel_herein`, für den verlassenen `wechsel_hinaus`. Kein CHECK, nur Anzeige.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BrVerlaufArt {
        Eintritt => "eintritt",
        WechselHerein => "wechsel_herein",
        WechselHinaus => "wechsel_hinaus",
        Austritt => "austritt",
    }
    try_from = |s| format!("Ungültige BrVerlaufArt: {s}");
}

/// Ein Eintrag im Verlauf eines Raums (`GET …/bereitstellungsraeume/{bid}/verlauf`, Spec
/// `bereitstellungsraum-belegung`, „Verlauf eines Raums lesen“).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BrVerlaufEintrag {
    /// Kennung des Belegungsereignisses (`br_belegung.id`).
    pub id: i64,
    /// UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`).
    pub zeitpunkt_at: String,
    pub art: BrVerlaufArt,
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    /// Aktueller Name der Einheit bzw. Funkrufname des Fahrzeugs, auch aufgelöst oder entlassen.
    pub objekt_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    /// Bezeichnung des Raums, aus dem ein `wechsel_herein` kam.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herkunft: Option<String>,
    /// Bezeichnung des Raums, in den ein `wechsel_hinaus` ging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verlauf_art_roundtrip() {
        for a in ["eintritt", "wechsel_herein", "wechsel_hinaus", "austritt"] {
            let art = BrVerlaufArt::parse(a).unwrap();
            assert_eq!(art.as_str(), a);
            assert_eq!(serde_json::to_value(art).unwrap(), serde_json::json!(a));
        }
        assert!(BrVerlaufArt::parse("wechsel").is_none());
    }

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

/// System-ETB beim stillen Eintritt in einen Raum (Seitenleiste „zuweisen“) und beim Eintreffen,
/// dessen Zeitachsen-Ereignis ausgelassen wurde oder das ein Fahrzeug bucht (LLH-1075, D5).
pub fn etb_text_eintritt(name: &str, bezeichnung: &str) -> String {
    format!("{name} tritt in Bereitstellungsraum {bezeichnung} ein")
}

/// System-ETB beim Eintreffen einer bekannten Einheit, deren Eintreffen die Zeitachse geschrieben
/// hat (LLH-1075, design.md D5).
pub fn etb_text_eingetroffen(name: &str, bezeichnung: &str) -> String {
    format!("{name} im BR {bezeichnung} eingetroffen")
}

/// Ein Fahrzeug einer unangemeldeten Kraft, so weit es in Meldung und ETB steht.
#[derive(Debug, Clone, Copy)]
pub struct FahrzeugAngabe<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub organisation: Option<&'a str>,
}

/// Inhalt von Meldung und ETB einer unangemeldeten Kraft (LLH-1075, design.md D5/D6).
#[derive(Debug, Clone, Copy)]
pub struct UnangemeldetAngabe<'a> {
    /// Mindestens ein Fahrzeug; das erste gibt Funkrufname, Organisation und Typ.
    pub fahrzeuge: &'a [FahrzeugAngabe<'a>],
    pub staerke: Option<crate::staerke::Staerke>,
    pub br_bezeichnung: &'a str,
    /// Abschnitt des Raums.
    pub abschnitt: Option<&'a str>,
}

fn gesetzt(wert: Option<&str>) -> Option<&str> {
    wert.map(str::trim).filter(|s| !s.is_empty())
}

/// „<Funkrufname> (<Organisation>, <Typ>) [mit <weitere>] unangemeldet im BR <Bezeichnung>
/// eingetroffen, Stärke <F/UF/M//Σ>. Abschnitt <Name>. Übernahme offen.“ Teile ohne Wert entfallen.
/// Die Bemerkung steht nie darin: sie ist freier Text an der Einheit und wird geschwärzt, das ETB
/// nicht (design.md D5).
pub fn meldung_text_unangemeldet(a: &UnangemeldetAngabe<'_>) -> String {
    let mut text = absender_text(a.fahrzeuge);
    if let Some(erstes) = a.fahrzeuge.first() {
        let klammer: Vec<&str> = [gesetzt(erstes.organisation), gesetzt(erstes.fahrzeugtyp)]
            .into_iter()
            .flatten()
            .collect();
        if !klammer.is_empty() {
            text.push_str(&format!(" ({})", klammer.join(", ")));
        }
    }
    let weitere: Vec<&str> = a
        .fahrzeuge
        .iter()
        .skip(1)
        .map(|f| f.funkrufname.trim())
        .collect();
    if !weitere.is_empty() {
        text.push_str(&format!(" mit {}", weitere.join(", ")));
    }
    text.push_str(&format!(
        " unangemeldet im BR {} eingetroffen",
        a.br_bezeichnung
    ));
    if let Some(s) = a.staerke {
        text.push_str(&format!(", Stärke {}", s.anzeige()));
    }
    text.push('.');
    if let Some(abschnitt) = gesetzt(a.abschnitt) {
        text.push_str(&format!(" Abschnitt {abschnitt}."));
    }
    text.push_str(" Übernahme offen.");
    text
}

/// Absender der Meldung: der Funkrufname des ersten Fahrzeugs (≤ `etb::PARTEI_MAX`, weil
/// `fahrzeug::ADHOC_TEXT_MAX` kleiner ist). Der Raum steht im Inhalt, nicht im Absender: seine
/// Bezeichnung ist unbegrenzt.
pub fn absender_text(fahrzeuge: &[FahrzeugAngabe<'_>]) -> String {
    fahrzeuge
        .first()
        .map(|f| f.funkrufname.trim().to_string())
        .unwrap_or_default()
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

    fn fz<'a>(fr: &'a str, typ: Option<&'a str>, org: Option<&'a str>) -> FahrzeugAngabe<'a> {
        FahrzeugAngabe {
            funkrufname: fr,
            fahrzeugtyp: typ,
            organisation: org,
        }
    }

    #[test]
    fn eintritt_und_eingetroffen() {
        assert_eq!(
            etb_text_eingetroffen("HLF 20 FF Musterstadt", "Sportplatz"),
            "HLF 20 FF Musterstadt im BR Sportplatz eingetroffen"
        );
        assert_eq!(
            etb_text_eintritt("HLF 20 FF Musterstadt", "Sportplatz"),
            "HLF 20 FF Musterstadt tritt in Bereitstellungsraum Sportplatz ein"
        );
    }

    #[test]
    fn unangemeldet_alle_teile() {
        let f = [fz("FL-MUS 1-44-1", Some("HLF 20"), Some("FF Musterstadt"))];
        let a = UnangemeldetAngabe {
            fahrzeuge: &f,
            staerke: Some(crate::staerke::Staerke::neu(1, 1, 7)),
            br_bezeichnung: "Sportplatz",
            abschnitt: Some("Nord"),
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) unangemeldet im BR Sportplatz eingetroffen, \
             Stärke 1/1/7//9. Abschnitt Nord. Übernahme offen."
        );
        assert_eq!(absender_text(&f), "FL-MUS 1-44-1");
    }

    #[test]
    fn unangemeldet_ohne_organisation_ohne_staerke_ohne_abschnitt() {
        let f = [fz("FL-MUS 1-44-1", Some("HLF 20"), None)];
        let a = UnangemeldetAngabe {
            fahrzeuge: &f,
            staerke: None,
            br_bezeichnung: "Sportplatz",
            abschnitt: None,
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (HLF 20) unangemeldet im BR Sportplatz eingetroffen. Übernahme offen."
        );
        let f = [fz("FL-MUS 1-44-1", Some("  "), Some(""))];
        let a = UnangemeldetAngabe {
            fahrzeuge: &f,
            abschnitt: Some(" "),
            ..a
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 unangemeldet im BR Sportplatz eingetroffen. Übernahme offen."
        );
        let f = [fz("FL-MUS 1-44-1", None, Some("FF Musterstadt"))];
        let a = UnangemeldetAngabe { fahrzeuge: &f, ..a };
        assert!(meldung_text_unangemeldet(&a)
            .starts_with("FL-MUS 1-44-1 (FF Musterstadt) unangemeldet"));
    }

    #[test]
    fn unangemeldet_zwei_fahrzeuge() {
        let f = [
            fz("FL-MUS 1-44-1", Some("HLF 20"), Some("FF Musterstadt")),
            fz("FL-MUS 1-19-1", Some("ELW 1"), Some("FF Musterstadt")),
            fz("FL-MUS 1-11-1", None, None),
        ];
        let a = UnangemeldetAngabe {
            fahrzeuge: &f,
            staerke: None,
            br_bezeichnung: "Sportplatz",
            abschnitt: None,
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) mit FL-MUS 1-19-1, FL-MUS 1-11-1 unangemeldet \
             im BR Sportplatz eingetroffen. Übernahme offen."
        );
        assert_eq!(absender_text(&f), "FL-MUS 1-44-1");
    }
}
