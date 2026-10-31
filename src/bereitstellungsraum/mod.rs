pub mod abruf;
pub mod belegung_repo;
pub mod eintreffen;
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
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
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum ObjektTyp {
        Einheit => "einheit",
        Fahrzeug => "fahrzeug",
    }
    try_from = |s| format!("Ungültiger ObjektTyp: {s}");
}

wire_enum! {
    /// Art eines BR-Belegungs-Events. String = CHECK-Constraint in
    /// `migrations/0208_br_abruf.sql`. Append-only. `abruf` lässt die Kraft im Raum, bis ein
    /// `austritt` das Ausrücken bucht; `abruf_aufgehoben` nimmt einen Abruf zurück (LLH-1085,
    /// design.md D1/D13). Beide schreibt nur [`abruf`], nie die Belegungsroute.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BrBelegungsArt {
        Eintritt => "eintritt",
        Wechsel => "wechsel",
        Austritt => "austritt",
        Abruf => "abruf",
        AbrufAufgehoben => "abruf_aufgehoben",
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
    /// Koordinate (LLH-1107, Spec `bereitstellungsraum-lagekarte`): beide gesetzt = verortet,
    /// beide leer = nicht verortet; ohne Koordinate fehlen beide Felder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
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
    /// Ziel-Abschnitt eines Abrufs (LLH-1085, design.md D5); fällt weg, wenn der Abschnitt
    /// gelöscht wird.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_abschnitt_id: Option<i64>,
    /// Name des Ziel-Abschnitts zum Zeitpunkt des Abrufs; bleibt nach dem Löschen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_anzeige: Option<String>,
    /// Auftrag, der mit dem Abruf erteilt wurde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_id: Option<i64>,
    /// Abruf der Einheit, mit der diese Untereinheit abgerufen wurde (Verband, D10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mit_abruf_id: Option<i64>,
}

/// Abruf einer Kraft, die im Raum steht (LLH-1085, design.md D3, Spec
/// `bereitstellungsraum-belegung`, „Detail nennt den Abruf“): abgeleitet aus dem jüngsten
/// Belegungsereignis, nicht gespeichert.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BrAbrufKurz {
    /// Zeitpunkt des Abrufs (UTC ohne Zone).
    pub seit_at: String,
    /// Ziel-Abschnitt; bei einer mitgenommenen Untereinheit der ihrer Einheit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_abschnitt_id: Option<i64>,
    /// Name des Ziels zum Zeitpunkt des Abrufs; bei einer mitgenommenen Untereinheit der ihrer
    /// Einheit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_anzeige: Option<String>,
    /// Auftrag des Abrufs; nur an der abgerufenen Einheit, nicht an mitgenommenen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_id: Option<i64>,
    /// Laufende Nummer dieses Auftrags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_nr: Option<i64>,
    /// Die Einheit, mit der diese Untereinheit abgerufen wurde (D10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mit_objekt_id: Option<i64>,
}

/// Antwort von `POST …/bereitstellungsraeume/{bid}/abruf` (LLH-1085, design.md D2).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BrAbrufErgebnis {
    /// Das Abruf-Ereignis der abgerufenen Kraft.
    pub abruf: BrBelegungAnzeige,
    /// Einheiten, die als Untereinheiten mit abgerufen wurden.
    pub mitgenommen: Vec<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_id: Option<i64>,
    /// Laufende Nummer des erteilten Auftrags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_nr: Option<i64>,
}

/// Body von `POST …/bereitstellungsraeume/{bid}/abruf` (handgepflegt, `src/AGENTS.md`,
/// Typ-Codegen).
#[derive(Debug, Deserialize)]
pub struct BrAbrufEingabe {
    pub objekt_typ: String,
    pub objekt_id: i64,
    /// Ziel-Abschnitt; nur für Einheiten.
    pub abschnitt_id: Option<i64>,
    /// Auftrag an die Kraft; leer heißt „kein Auftrag“.
    pub auftrag_text: Option<String>,
    /// Abruf und Austritt in einem Schritt („Rückt sofort aus“).
    #[serde(default)]
    pub ausgerueckt: bool,
}

/// Body von `POST …/bereitstellungsraeume/{bid}/abruf/aufheben` (handgepflegt).
#[derive(Debug, Deserialize)]
pub struct BrAbrufAufhebenEingabe {
    pub objekt_typ: String,
    pub objekt_id: i64,
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

/// Eintrag der Liste: Raumdaten wie bisher (flatten), dazu Abschnittsname, Kennzahlen und die
/// Einheiten im Raum (LLH-1095, design.md D4; die Stärke rechnet der Client über
/// `summiereStaerke`). Route und Lage-Snapshot lesen ihn aus `repo::list_eintraege` (LLH-1107,
/// design.md D10).
#[derive(Debug, Serialize, ToSchema)]
pub struct BrListenEintrag {
    #[serde(flatten)]
    pub br: BrAnzeige,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub belegung: BrBelegungKennzahlen,
    pub einheit_ids: Vec<i64>,
    /// Die Einheiten, die abgerufen im Raum stehen, mit dem Zeitpunkt des Abrufs, nach Einheit
    /// (LLH-1309, Spec `bereitstellungsraum-belegung` „Liste der Räume mit Belegung“): die Karte
    /// der Ablösung nennt daraus „abgerufen“ beim Ablöser. Abgeleitet wie im Detail
    /// ([`belegung_repo::abruf_je_objekt`]), nicht gespeichert.
    pub abrufe: Vec<BrEinheitAbruf>,
}

/// Eine abgerufen im Raum stehende Einheit in der Liste der Räume (LLH-1309).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BrEinheitAbruf {
    pub einheit_id: i64,
    /// Zeitpunkt des Abrufs (UTC ohne Zone), wie [`BrAbrufKurz::seit_at`].
    pub seit_at: String,
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
        Abruf => "abruf",
        AbrufAufgehoben => "abruf_aufgehoben",
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
    /// Bezeichnung des Raums, in den ein `wechsel_hinaus` ging; bei einem `abruf` und einem
    /// `austritt` direkt nach einem Abruf der Name des Ziel-Abschnitts (LLH-1085, D5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel: Option<String>,
    /// Laufende Nummer des Auftrags eines `abruf`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftrag_nr: Option<i64>,
    /// Name der Einheit, mit der eine Untereinheit abgerufen wurde (D10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mit_einheit: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verlauf_art_roundtrip() {
        for a in [
            "eintritt",
            "wechsel_herein",
            "wechsel_hinaus",
            "austritt",
            "abruf",
            "abruf_aufgehoben",
        ] {
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
        for a in [
            "eintritt",
            "wechsel",
            "austritt",
            "abruf",
            "abruf_aufgehoben",
        ] {
            assert_eq!(BrBelegungsArt::parse(a).unwrap().as_str(), a);
        }
        assert!(BrBelegungsArt::parse("umzug").is_none());
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

/// Kraft und Ziel eines Abrufs für den ETB-Wortlaut (LLH-1085, design.md D8).
#[derive(Debug, Clone, Copy)]
pub struct AbrufText<'a> {
    /// Name der abgerufenen Einheit bzw. Funkrufname des Fahrzeugs.
    pub name: &'a str,
    /// Namen der mitgenommenen Untereinheiten (D10).
    pub mitgenommen: &'a [String],
    pub br_bezeichnung: &'a str,
    /// Name des Ziel-Abschnitts.
    pub ziel: Option<&'a str>,
    pub auftrag_nr: Option<i64>,
    /// Abruf und Austritt in einem Schritt.
    pub ausgerueckt: bool,
}

/// „HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich (Auftrag Nr. 7)“, mit
/// Verband „1. Zug mit Gruppe 1, Gruppe 2 aus …“, mit `ausgerueckt` „… und ausgerückt“. Ohne Ziel
/// fehlt „nach …“, ohne Auftrag die Klammer. Den Auftragstext nennt der Eintrag nie (D8).
pub fn etb_text_abruf(t: &AbrufText<'_>) -> String {
    let mut rest = format!(" aus Bereitstellungsraum {} abgerufen", t.br_bezeichnung);
    if let Some(ziel) = t.ziel {
        rest.push_str(&format!(" nach {ziel}"));
    }
    if let Some(nr) = t.auftrag_nr {
        rest.push_str(&format!(" (Auftrag Nr. {nr})"));
    }
    if t.ausgerueckt {
        rest.push_str(" und ausgerückt");
    }
    format!(
        "{}{rest}",
        kraefte_gekappt(
            t.name,
            t.mitgenommen,
            rest.chars().count(),
            crate::etb::INHALT_MAX
        )
    )
}

/// „Abruf von HLF 20 aus Bereitstellungsraum Sportplatz zurückgenommen“ (D8, D13); mit Verband
/// „Abruf von 1. Zug mit Gruppe 1 aus …“.
pub fn etb_text_abruf_aufgehoben(name: &str, mitgenommen: &[String], bezeichnung: &str) -> String {
    let vorne = "Abruf von ";
    let rest = format!(" aus Bereitstellungsraum {bezeichnung} zurückgenommen");
    let laenge = vorne.chars().count() + rest.chars().count();
    format!(
        "{vorne}{}{rest}",
        kraefte_gekappt(name, mitgenommen, laenge, crate::etb::INHALT_MAX)
    )
}

/// Austritt einer abgerufenen Kraft (D8, D12): „HLF 20 rückt aus Bereitstellungsraum Sportplatz
/// aus nach EA Deich“, ohne Ziel ohne „nach …“; mit Verband „1. Zug mit Gruppe 1 rückt aus …“.
pub fn etb_text_ausgerueckt(
    name: &str,
    mitgenommen: &[String],
    bezeichnung: &str,
    ziel: Option<&str>,
) -> String {
    let mut rest = format!(" rückt aus Bereitstellungsraum {bezeichnung} aus");
    if let Some(ziel) = ziel {
        rest.push_str(&format!(" nach {ziel}"));
    }
    format!(
        "{}{rest}",
        kraefte_gekappt(
            name,
            mitgenommen,
            rest.chars().count(),
            crate::etb::INHALT_MAX
        )
    )
}

/// „<Name> mit <A>, <B>“, so gekappt, dass es zusammen mit `rest` Zeichen höchstens `max`
/// Zeichen lang ist: hinten fallen Namen weg, „und n weitere“ zählt sie (D8). Passt nicht einmal
/// der Name allein, bleibt er stehen: ein Systemtext darf nicht scheitern (`src/AGENTS.md`,
/// „Eingabegrenzen“).
fn kraefte_gekappt(name: &str, mitgenommen: &[String], rest: usize, max: usize) -> String {
    let text = |k: usize| {
        let weitere = mitgenommen.len() - k;
        let mut t = name.to_string();
        if k > 0 {
            t.push_str(" mit ");
            t.push_str(&mitgenommen[..k].join(", "));
        }
        if weitere > 0 {
            t.push_str(&format!(" und {weitere} weitere"));
        }
        t
    };
    (0..=mitgenommen.len())
        .rev()
        .map(text)
        .find(|t| t.chars().count() + rest <= max)
        .unwrap_or_else(|| text(0))
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
    /// Kurzname der Nachforderung, aus der die Kraft erwartet wurde (LLH-1387 D4): ersetzt
    /// „unangemeldet“ durch „aus Nachforderung 2× RTW“.
    pub nachforderung: Option<&'a str>,
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
    match gesetzt(a.nachforderung) {
        Some(n) => text.push_str(&format!(
            " aus Nachforderung {n} im BR {} eingetroffen",
            a.br_bezeichnung
        )),
        None => text.push_str(&format!(
            " unangemeldet im BR {} eingetroffen",
            a.br_bezeichnung
        )),
    }
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

    fn abruf<'a>(mitgenommen: &'a [String]) -> AbrufText<'a> {
        AbrufText {
            name: "HLF 20",
            mitgenommen,
            br_bezeichnung: "Sportplatz",
            ziel: None,
            auftrag_nr: None,
            ausgerueckt: false,
        }
    }

    /// Wortlaute des Abrufs je Variante (LLH-1085, design.md D8).
    #[test]
    fn abruf_ohne_ziel_mit_ziel_mit_auftrag_ausgerueckt() {
        assert_eq!(
            etb_text_abruf(&abruf(&[])),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen"
        );
        let mit_ziel = AbrufText {
            ziel: Some("EA Deich"),
            ..abruf(&[])
        };
        assert_eq!(
            etb_text_abruf(&mit_ziel),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich"
        );
        let mit_auftrag = AbrufText {
            auftrag_nr: Some(7),
            ..mit_ziel
        };
        assert_eq!(
            etb_text_abruf(&mit_auftrag),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich (Auftrag Nr. 7)"
        );
        assert_eq!(
            etb_text_abruf(&AbrufText {
                ausgerueckt: true,
                ..mit_ziel
            }),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich und ausgerückt"
        );
        assert_eq!(
            etb_text_abruf(&AbrufText {
                ausgerueckt: true,
                ..mit_auftrag
            }),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich (Auftrag Nr. 7) \
             und ausgerückt"
        );
        assert_eq!(
            etb_text_abruf(&AbrufText {
                auftrag_nr: Some(3),
                ..abruf(&[])
            }),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen (Auftrag Nr. 3)"
        );
    }

    #[test]
    fn abruf_mit_verband_aufgehoben_ausgerueckt() {
        let gruppen = ["Gruppe 1".to_string(), "Gruppe 2".to_string()];
        assert_eq!(
            etb_text_abruf(&AbrufText {
                name: "1. Zug",
                ziel: Some("EA Deich"),
                ..abruf(&gruppen)
            }),
            "1. Zug mit Gruppe 1, Gruppe 2 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich"
        );
        assert_eq!(
            etb_text_abruf_aufgehoben("HLF 20", &[], "Sportplatz"),
            "Abruf von HLF 20 aus Bereitstellungsraum Sportplatz zurückgenommen"
        );
        assert_eq!(
            etb_text_abruf_aufgehoben("1. Zug", &gruppen[..1], "Sportplatz"),
            "Abruf von 1. Zug mit Gruppe 1 aus Bereitstellungsraum Sportplatz zurückgenommen"
        );
        assert_eq!(
            etb_text_ausgerueckt("HLF 20", &[], "Sportplatz", Some("EA Deich")),
            "HLF 20 rückt aus Bereitstellungsraum Sportplatz aus nach EA Deich"
        );
        assert_eq!(
            etb_text_ausgerueckt("HLF 20", &[], "Sportplatz", None),
            "HLF 20 rückt aus Bereitstellungsraum Sportplatz aus"
        );
        assert_eq!(
            etb_text_ausgerueckt("1. Zug", &gruppen, "Sportplatz", Some("EA Deich")),
            "1. Zug mit Gruppe 1, Gruppe 2 rückt aus Bereitstellungsraum Sportplatz aus nach EA Deich"
        );
    }

    /// Zu viele Namen: hinten fallen Namen weg, „und n weitere“ zählt sie; der Text bleibt unter
    /// der Grenze. Passt nicht einmal ein Name, bleibt nur die Zahl.
    #[test]
    fn verband_wird_auf_die_grenze_gekappt() {
        let gruppen: Vec<String> = (1..=4).map(|i| format!("Gruppe {i}")).collect();
        assert_eq!(
            kraefte_gekappt("1. Zug", &gruppen, 0, 100),
            "1. Zug mit Gruppe 1, Gruppe 2, Gruppe 3, Gruppe 4"
        );
        assert_eq!(
            kraefte_gekappt("1. Zug", &gruppen, 10, 55),
            "1. Zug mit Gruppe 1, Gruppe 2 und 2 weitere"
        );
        assert_eq!(
            kraefte_gekappt("1. Zug", &gruppen, 10, 30),
            "1. Zug und 4 weitere"
        );
        assert_eq!(
            kraefte_gekappt("1. Zug", &gruppen, 10, 5),
            "1. Zug und 4 weitere"
        );
        let viele: Vec<String> = (0..5000).map(|i| format!("Gruppe {i}")).collect();
        let text = etb_text_abruf(&AbrufText {
            name: "1. Zug",
            ..abruf(&viele)
        });
        assert!(
            text.chars().count() <= crate::etb::INHALT_MAX,
            "{}",
            text.len()
        );
        assert!(text.contains(" weitere aus Bereitstellungsraum Sportplatz abgerufen"));
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
            nachforderung: None,
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) unangemeldet im BR Sportplatz eingetroffen, \
             Stärke 1/1/7//9. Abschnitt Nord. Übernahme offen."
        );
        // LLH-1387 D4: aus einer Nachforderung erwartet.
        let a = UnangemeldetAngabe {
            nachforderung: Some("2× HLF"),
            ..a
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) aus Nachforderung 2× HLF im BR Sportplatz \
             eingetroffen, Stärke 1/1/7//9. Abschnitt Nord. Übernahme offen."
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
            nachforderung: None,
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
            nachforderung: None,
        };
        assert_eq!(
            meldung_text_unangemeldet(&a),
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) mit FL-MUS 1-19-1, FL-MUS 1-11-1 unangemeldet \
             im BR Sportplatz eingetroffen. Übernahme offen."
        );
        assert_eq!(absender_text(&f), "FL-MUS 1-44-1");
    }
}
