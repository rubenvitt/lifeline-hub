//! Aufträge/Befehle (LFH-52): Top-down-Strang des Führungsvorgangs
//! (Befehlsgebung → Vollzug → Kontrolle). Quittung liegt pro Empfänger
//! (`auftrag_empfaenger`), Vollzug pro Auftrag über den geteilten
//! Kommunikations-Unterbau (`kommunikation_status`, LFH-84).
pub mod eingabe;
pub mod repo;

pub use eingabe::{
    validiere_neuen_auftrag, EmpfaengerEingabeReq, NeuerAuftrag, ValidierterAuftrag,
};

use crate::kommunikation::{AdressatKategorie, Prioritaet, Richtung};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstzahl der Empfänger eines Auftrags im Request (LFH-937, design.md D3); gezählt vor
/// dem Entdoppeln, damit die Arbeit vor der ersten Abfrage begrenzt ist. Darüber → 400.
pub const EMPFAENGER_MAX: usize = 50;
/// Höchstlänge des Auftragstexts (LFH-937); er wird der Inhalt der ETB-Anordnung.
pub const AUFTRAG_TEXT_MAX: usize = 10_000;
/// Höchstlänge je Feld des Befehlsschemas (Absicht, Lage, Ort, Zeit, Mittel, Verbindung,
/// Sicherheit; LFH-937).
pub const BEFEHLSFELD_MAX: usize = 2_000;
/// Höchstlänge der Bezeichnung eines externen Empfängers (LFH-937), wie `fuehrung::TEXT_MAX`.
pub const EXTERN_BEZEICHNUNG_MAX: usize = 200;

/// ETB-`an` einer Anordnung aus den Anzeigenamen der Empfänger (LFH-937, design.md D4):
/// kommagetrennt, höchstens `etb::PARTEI_MAX` Zeichen. Passen nicht alle Namen hinein, endet es
/// mit „… und N weitere“; ein Name, der allein zu lang ist, wird mit „…“ gekürzt.
pub fn kappe_an(namen: &[String]) -> String {
    let max = crate::etb::PARTEI_MAX;
    let zeichen = |s: &str| s.chars().count();
    let hinweis = |n: usize| {
        if n == 0 {
            String::new()
        } else {
            format!(" … und {n} weitere")
        }
    };
    let voll = namen.join(", ");
    if zeichen(&voll) <= max {
        return voll;
    }
    // Ab hier braucht es einen Hinweis; jeder Kandidat lässt Platz für den Rest.
    let mut an = String::new();
    for (i, name) in namen.iter().enumerate() {
        let kandidat = if i == 0 {
            name.clone()
        } else {
            format!("{an}, {name}")
        };
        if zeichen(&kandidat) + zeichen(&hinweis(namen.len() - i - 1)) <= max {
            an = kandidat;
            continue;
        }
        let fehlend = namen.len() - i;
        if i > 0 {
            // Der vorige Durchlauf hat genau für diesen Hinweis Platz gelassen.
            return format!("{an}{}", hinweis(fehlend));
        }
        // Schon der erste Name passt nicht neben den Hinweis.
        let rest = hinweis(fehlend - 1);
        let platz = max - zeichen(&rest) - 1;
        return format!("{}…{rest}", name.chars().take(platz).collect::<String>());
    }
    an
}

/// Priorität eines Auftrags (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = Prioritaet::Sofort.as_str();
pub const PRIO_DRINGEND: &str = Prioritaet::Dringend.as_str();
pub const PRIO_NORMAL: &str = Prioritaet::Normal.as_str();

/// Empfänger-Diskriminator (Spiegel des DB-CHECK auf auftrag_empfaenger).
pub const EMPF_ABSCHNITT: &str = EmpfaengerTyp::Abschnitt.as_str();
pub const EMPF_EINHEIT: &str = EmpfaengerTyp::Einheit.as_str();
pub const EMPF_FUNKTION: &str = EmpfaengerTyp::Funktion.as_str();
pub const EMPF_PERSON: &str = EmpfaengerTyp::Person.as_str();
pub const EMPF_FAHRZEUG: &str = EmpfaengerTyp::Fahrzeug.as_str();
/// Externer Adressat (LFH-87): Leitstelle, Nachbar-EA, übergeordnete Führung, andere BOS.
pub const EMPF_EXTERN: &str = EmpfaengerTyp::Extern.as_str();

/// Externe Adressat-Kategorie (code-validiert, kein DB-CHECK).
pub const EXTERN_LEITSTELLE: &str = AdressatKategorie::Leitstelle.as_str();
pub const EXTERN_NACHBAR_EA: &str = AdressatKategorie::NachbarEa.as_str();
pub const EXTERN_UEBERGEORDNET: &str = AdressatKategorie::Uebergeordnet.as_str();
pub const EXTERN_ANDERE_BOS: &str = AdressatKategorie::AndereBos.as_str();

wire_enum! {
    /// Bearbeitungsstatus eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `bearbeitungsstatus`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AuftragBearbeitungsstatus {
        Offen => "offen",
        InArbeit => "in_arbeit",
        Vollzogen => "vollzogen",
        Abgenommen => "abgenommen",
    }
    try_from = |s| format!("Ungültiger AuftragBearbeitungsstatus: {s}");
}

impl AuftragBearbeitungsstatus {
    /// Ob der Auftrag noch offen ist, also nicht abgeschlossen (LFH-612, Modulzähler).
    ///
    /// Spiegelt die Phasen des Frontends (`AUFTRAG_STATUS` in `kommunikation/phase.ts`):
    /// `offen`/`in_arbeit` sind nicht abgeschlossen, `vollzogen`/`abgenommen` schon. Ein
    /// vollständiger `match` — ein neuer Status muss hier entschieden werden, statt still
    /// in eine der beiden Mengen zu fallen.
    pub fn ist_offen(&self) -> bool {
        match self {
            AuftragBearbeitungsstatus::Offen | AuftragBearbeitungsstatus::InArbeit => true,
            AuftragBearbeitungsstatus::Vollzogen | AuftragBearbeitungsstatus::Abgenommen => false,
        }
    }
}

wire_enum! {
    /// Empfänger-Diskriminator eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `empfaenger_typ`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EmpfaengerTyp {
        Abschnitt => "abschnitt",
        Einheit => "einheit",
        Funktion => "funktion",
        Person => "person",
        Fahrzeug => "fahrzeug",
        Extern => "extern",
    }
}

// `empfaenger_typ` ist in `AuftragEmpfaengerAnzeige` non-null, aber für einen
// einheitlichen Decode-Mechanismus über beide Enum-Felder dieses GEMISCHTEN DTOs
// (das nullable `extern_kategorie: Option<AdressatKategorie>` daneben) direkt
// `Type`/`Decode` implementieren (statt gemischt mit `#[sqlx(try_from = …)]`) —
// gleiches Muster wie bei `TierAnzeige` (`src/tier/mod.rs`).
impl<DB: sqlx::Database> sqlx::Type<DB> for EmpfaengerTyp
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for EmpfaengerTyp
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        EmpfaengerTyp::parse(s).ok_or_else(|| format!("Ungültiger EmpfaengerTyp: {s}").into())
    }
}

pub fn extern_kategorie_gueltig(k: &str) -> bool {
    AdressatKategorie::parse(k).is_some()
}

/// Effektiver Bearbeitungsstatus (abgeleitet, fürs Frontend).
pub const BEARB_OFFEN: &str = AuftragBearbeitungsstatus::Offen.as_str();
pub const BEARB_IN_ARBEIT: &str = AuftragBearbeitungsstatus::InArbeit.as_str();
pub const BEARB_VOLLZOGEN: &str = AuftragBearbeitungsstatus::Vollzogen.as_str();
pub const BEARB_ABGENOMMEN: &str = AuftragBearbeitungsstatus::Abgenommen.as_str();

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = Richtung::Intern.as_str();
pub const RICHTUNG_EXTERN: &str = Richtung::Extern.as_str();

pub fn prioritaet_gueltig(p: &str) -> bool {
    Prioritaet::parse(p).is_some()
}

pub fn richtung_gueltig(r: &str) -> bool {
    Richtung::parse(r).is_some()
}

pub fn empfaenger_typ_gueltig(t: &str) -> bool {
    EmpfaengerTyp::parse(t).is_some()
}

/// Anzeige eines Auftrags inkl. abgeleiteter Felder und der Vollzugs-Achse aus
/// dem geteilten `kommunikation_status` (per LEFT JOIN). Quittungs-Aggregate
/// (`empfaenger_anzahl`, `quittiert_anzahl`) stammen aus `auftrag_empfaenger`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuftragAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// Laufende Nummer je Einsatz (LFH-133). Nullable, weil per ADD COLUMN eingeführt;
    /// alle ab LFH-133 angelegten Aufträge tragen einen Wert.
    pub lfd_nr: Option<i64>,
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    /// Richtung intern/extern (LFH-87).
    #[sqlx(try_from = "String")]
    pub richtung: Richtung,
    pub frist_at: Option<String>,
    pub erteilt_at: String,
    pub in_arbeit_at: Option<String>,
    pub vollzugsmeldung: Option<String>,
    pub abgenommen_at: Option<String>,
    pub abgenommen_von_id: Option<i64>,
    pub etb_anordnung_id: Option<i64>,
    /// Quell-ETB-Eintrag, AUS DEM dieser Auftrag erteilt wurde (LFH-112). Klar getrennt
    /// von `etb_anordnung_id` (= der vom Auftrag SELBST erzeugte Anordnungs-Eintrag).
    pub quell_etb_eintrag_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    // Vollzugs-Achse aus kommunikation_status (Default 'offen').
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
    // Quittungs-Aggregat aus auftrag_empfaenger.
    pub empfaenger_anzahl: i64,
    pub quittiert_anzahl: i64,
    // Abgeleitet: Frist überschritten UND noch nicht alle Empfänger quittiert.
    pub ist_ueberfaellig: bool,
    // Abgeleitet: 'abgenommen' wenn abgenommen_at gesetzt, sonst vollzug_status.
    #[sqlx(try_from = "String")]
    pub bearbeitungsstatus: AuftragBearbeitungsstatus,
}

/// Anzeige einer Empfänger-Zeile inkl. Quittung (Achse 1, pro Empfänger).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuftragEmpfaengerAnzeige {
    pub id: i64,
    pub auftrag_id: i64,
    pub empfaenger_typ: EmpfaengerTyp,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    /// Freitext — oder Bezeichnung bei `funktion` Führungshilfspersonal/Fachberater (LFH-549).
    pub funktion_text: Option<String>,
    /// Katalogcode (LFH-549); fehlt bei Freitext und anderen Empfängertypen.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::fuehrung::Fuehrungsfunktion>)]
    pub funktion: Option<String>,
    /// Aktuelle Besetzung des Sachgebiets zur Lesezeit (nur s1–s6, nur mit Stab-Recht,
    /// LFH-549). `snap_anzeige` bleibt die historische Wahrheit.
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_besetzung: Option<crate::fuehrung::aufloesung::AktuelleBesetzung>,
    /// Externer Adressat (LFH-87): Kategorie + Bezeichnung (nur bei empfaenger_typ='extern').
    pub extern_kategorie: Option<AdressatKategorie>,
    pub extern_bezeichnung: Option<String>,
    pub snap_anzeige: String,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
}

/// Kennzahlen des Auftragsboards (LFH-1071, `GET …/auftraege/kennzahlen`): „Offen (n)“ und
/// „Abgeschlossen (n)“, gezählt am Server, weil die Abgeschlossenen nur noch seitenweise kommen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct AuftragKennzahlen {
    /// Offen oder in Bearbeitung.
    pub offen: i64,
    /// Vollzogen oder abgenommen.
    pub abgeschlossen: i64,
}

/// Auftrag + seine Empfänger (Detail-/Anlege-/Mutations-Antwort).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuftragDetail {
    #[serde(flatten)]
    pub auftrag: AuftragAnzeige,
    pub empfaenger: Vec<AuftragEmpfaengerAnzeige>,
}

/// Setzt `aktuelle_besetzung` an Funktionsempfängern mit Sachgebietscode (LFH-549). Die
/// Besetzung wird einmal je Anfrage geladen, nur mit Stab-Recht (`fuehrung::aufloesung`).
pub async fn anreichern_alle(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &crate::auth::Benutzer,
    auftraege: &mut [AuftragDetail],
) -> Result<(), crate::error::AppError> {
    let aufloeser =
        crate::fuehrung::aufloesung::Aufloeser::laden_fuer(pool, einsatz_id, org_id, benutzer)
            .await?;
    for d in auftraege.iter_mut() {
        for e in d.empfaenger.iter_mut() {
            e.aktuelle_besetzung = aufloeser.aufloesen(
                e.funktion
                    .as_deref()
                    .and_then(crate::fuehrung::Fuehrungsfunktion::parse),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod kappe_an_tests {
    use super::kappe_an;
    use crate::etb::PARTEI_MAX;

    fn namen(n: usize, laenge: usize) -> Vec<String> {
        (0..n).map(|i| format!("{i:0>laenge$}")).collect()
    }

    #[test]
    fn passt_alles_bleibt_die_volle_liste() {
        assert_eq!(kappe_an(&namen(3, 2)), "00, 01, 02");
        assert_eq!(kappe_an(&[]), "");
    }

    #[test]
    fn zu_viele_namen_enden_mit_rest_hinweis() {
        let an = kappe_an(&namen(50, 200));
        assert!(an.chars().count() <= PARTEI_MAX, "{}", an.chars().count());
        // Zwei Namen à 200 Zeichen passen samt Hinweis, der dritte nicht.
        assert!(an.ends_with(" … und 48 weitere"), "{an}");
        assert!(an.starts_with(&format!("{:0>200}, ", 0)));
    }

    #[test]
    fn genau_auf_die_grenze_passt_ohne_hinweis() {
        let n = vec!["x".repeat(PARTEI_MAX - 2 - 10), "y".repeat(10)];
        assert_eq!(kappe_an(&n).chars().count(), PARTEI_MAX);
        assert!(!kappe_an(&n).contains('…'));
    }

    #[test]
    fn einzelner_ueberlanger_name_wird_gekuerzt() {
        let an = kappe_an(&["ä".repeat(PARTEI_MAX + 5)]);
        assert_eq!(an.chars().count(), PARTEI_MAX);
        assert!(an.ends_with('…'));
        let an = kappe_an(&["ä".repeat(PARTEI_MAX + 5), "b".into()]);
        assert!(an.chars().count() <= PARTEI_MAX);
        assert!(an.ends_with("… … und 1 weitere"), "{an}");
    }
}
