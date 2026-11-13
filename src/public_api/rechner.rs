//! Rechner-API Unterkunft und Zelte für Fremdsysteme (LLH-1524, Spec `rechner-api-unterkunft`):
//! `POST /api/v1/rechner/unterkunft` rechnet und speichert nichts,
//! `GET /api/v1/rechner/unterkunft/richtwerte` nennt die wirksamen Richtwerte. Beide verlangen den
//! Scope `rechner:use` und antworten signiert.
//!
//! Hier stehen die Wire-Formen und die Prüfung der Anfrage; gerechnet wird in
//! `crate::unterkunft::rechner`. Die Anfrage hat die Form der `eingabe` aus
//! `tests/fixtures/unterkunft/faelle.json`, das Ergebnis die Form von `erwartet` (Test
//! `jeder_fall_der_fallsammlung_ergibt_das_erwartete_ergebnis`).
//!
//! Anders als der Rechner der Oberfläche prüft die API streng (design.md D4): erst jedes Feld für
//! sich (400 `invalid_field`, der Text nennt das Feld), dann den Zusammenhang (422
//! `unprocessable`). Wirksam ist je Richtwert Anfrage vor Einsatz vor Organisation des Zugangs
//! vor Basis. Den Einsatz nennt `einsatz_id`; er gilt nur, wenn die Einsatzleitung ihn für den
//! Zugang freigegeben hat (LLH-1856, ADR-0035, Change `q9b4qq0o-rechner-einsatz-richtwerte`),
//! sonst 404. Geprüft wird erst die Anfrage, dann der Einsatz (design.md D3).

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::de::{self, DeserializeOwned, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use super::error::{ApiError, ErrorCode};
use super::freigabe;
use super::machine::MachineClient;
use crate::app::AppState;
use crate::betreuung::MAX_PERSONEN;
use crate::instanz::spiegel::Freigabestufe;
use crate::unterkunft::rechner::{
    self as kern, Aufteilung, ABZUEGE_MAX, BEZEICHNUNG_MAX, FLAECHE_MAX_M2, MASS_MAX_M, RAEUME_MAX,
    ZELTE_JE_TYP_MAX,
};
use crate::unterkunft::{self, repo};
use crate::wire_enum::wire_enum;

wire_enum! {
    /// Grundlage der Rechnung: wovon sie ausgeht.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum UnterkunftWeg {
        /// Personenzahl; gerechnet wird der Bedarf.
        Personen => "personen",
        /// Räume mit Maßen; gerechnet werden Plätze je Raum und daraus der Bedarf.
        Raeume => "raeume",
        /// Fläche in Quadratmetern.
        Flaeche => "flaeche",
        /// Zeltbestand je Typ.
        Zelte => "zelte",
    }
}

wire_enum! {
    /// Gruppe, für die gerechnet wurde: alle zusammen oder Männer und Frauen getrennt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum PersonenGruppe {
        Gesamt => "gesamt",
        Maenner => "maenner",
        Frauen => "frauen",
    }
}

wire_enum! {
    /// Welche Gruppe einen Raum belegt (nur bei Trennung).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum RaumBelegung {
        Maenner => "maenner",
        Frauen => "frauen",
    }
}

// Dieselben Werte wie `zelttypen` in `src/unterkunft/richtwerte_basis.json` (Test
// `zelttypen_des_vertrags_sind_die_der_basis`). Doc-Kommentare der Schemas hier stehen im
// öffentlichen Dokument; Verweise in den Code gehören in normale Kommentare.
wire_enum! {
    /// Zelttyp, SG 20 bis SG 50.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum ZeltTyp {
        Sg20 => "sg20",
        Sg30 => "sg30",
        Sg40 => "sg40",
        Sg50 => "sg50",
    }
}

wire_enum! {
    /// Ebene, aus der ein wirksamer Richtwert stammt. `anfrage` gibt es nur in der Antwort einer
    /// Rechnung.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum RichtwertEbene {
        /// Vorgabe des Programms.
        Basis => "basis",
        /// Wert der Organisation des Zugangs.
        Org => "org",
        /// Wert des Einsatzes aus `einsatz_id`, den die Einsatzleitung für den Zugang freigegeben
        /// hat.
        Einsatz => "einsatz",
        /// Wert aus `richtwerte` dieser Anfrage.
        Anfrage => "anfrage",
    }
}

/// Nimmt für `T` nur ein JSON-Objekt an. Ein abgeleitetes `Deserialize` läse ein Struct auch aus
/// einer Liste in Feldreihenfolge (`"personen": [100]`); die strenge Prüfung (design.md D4) will
/// das nicht, und einmal angenommen wäre es Vertrag.
#[derive(Debug)]
pub struct ObjectOnly<T>(pub T);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for ObjectOnly<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
            type Value = T;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<T, A::Error> {
                T::deserialize(de::value::MapAccessDeserializer::new(map))
            }
        }
        deserializer
            .deserialize_map(ObjectVisitor(std::marker::PhantomData))
            .map(ObjectOnly)
    }
}

/// Zahlen je Schlüssel. Ein doppelter Schlüssel ist ein Fehler: `BTreeMap` nähme still den
/// letzten Wert, und der erste entginge der Prüfung.
#[derive(Debug, Default)]
pub struct Werte(pub BTreeMap<String, f64>);

impl<'de> Deserialize<'de> for Werte {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueKeysVisitor;
        impl<'de> Visitor<'de> for UniqueKeysVisitor {
            type Value = Werte;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object of numbers")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Werte, A::Error> {
                let mut werte = BTreeMap::new();
                while let Some(schluessel) = map.next_key::<String>()? {
                    let wert: f64 = map.next_value()?;
                    if werte.contains_key(&schluessel) {
                        return Err(de::Error::custom(format!("duplicate key `{schluessel}`")));
                    }
                    werte.insert(schluessel, wert);
                }
                Ok(Werte(werte))
            }
        }
        deserializer.deserialize_map(UniqueKeysVisitor)
    }
}

/// Personenzahl: ohne Trennung `gesamt` oder `maenner` und `frauen` zusammen (dann zählt die
/// Summe), mit Trennung `maenner` und `frauen`, beide; eine leere Gruppe ist 0.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PersonenAngabe {
    #[schema(value_type = Option<i64>, minimum = 0, maximum = 1000000)]
    pub gesamt: Option<f64>,
    #[schema(value_type = Option<i64>, minimum = 0, maximum = 1000000)]
    pub maenner: Option<f64>,
    #[schema(value_type = Option<i64>, minimum = 0, maximum = 1000000)]
    pub frauen: Option<f64>,
}

/// Fläche in Quadratmetern, aufgeteilt wie `personen`: `gesamt_m2` oder `maenner_m2` und
/// `frauen_m2` zusammen.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FlaecheAngabe {
    #[schema(minimum = 0, maximum = 1000000)]
    pub gesamt_m2: Option<f64>,
    #[schema(minimum = 0, maximum = 1000000)]
    pub maenner_m2: Option<f64>,
    #[schema(minimum = 0, maximum = 1000000)]
    pub frauen_m2: Option<f64>,
}

/// Abzug von der Fläche eines Raums (Bühne, Fluchtweg). Maße in Metern, größer als 0 und
/// höchstens 1000.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AbzugAngabe {
    pub laenge_m: f64,
    pub breite_m: f64,
}

/// Ein Raum. Maße in Metern, größer als 0 und höchstens 1000.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RaumAngabe {
    /// Höchstens 80 Zeichen; steht ohne Leerraum am Rand im Ergebnis.
    pub bezeichnung: Option<String>,
    pub laenge_m: f64,
    pub breite_m: f64,
    /// Höchstens 5 Abzüge.
    #[schema(value_type = Option<Vec<AbzugAngabe>>)]
    pub abzuege: Option<Vec<ObjectOnly<AbzugAngabe>>>,
    /// Bei Trennung Pflicht, ohne Trennung nicht erlaubt.
    #[schema(value_type = Option<RaumBelegung>)]
    pub belegung: Option<String>,
}

/// Zeltbestand: je Gruppe die Anzahl je Zelttyp (`sg20`, `sg30`, `sg40`, `sg50`), höchstens 1000
/// je Typ. Ohne Trennung `gesamt`, mit Trennung `maenner` und `frauen`, beide; eine Gruppe ohne
/// Zelte ist `{}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ZelteAngabe {
    #[schema(value_type = Option<HashMap<String, i64>>)]
    pub gesamt: Option<Werte>,
    #[schema(value_type = Option<HashMap<String, i64>>)]
    pub maenner: Option<Werte>,
    #[schema(value_type = Option<HashMap<String, i64>>)]
    pub frauen: Option<Werte>,
}

/// Body von `POST /api/v1/rechner/unterkunft`: `weg`, `trennung` und genau der Block des Wegs.
/// Ein unbekanntes Feld ist 400. Der ganze Body ist höchstens 64 KiB groß.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UnterkunftRequest {
    #[schema(value_type = UnterkunftWeg)]
    pub weg: String,
    /// Männer und Frauen getrennt unterbringen und rechnen.
    pub trennung: bool,
    /// Nur beim Weg `personen`.
    #[schema(value_type = Option<PersonenAngabe>)]
    pub personen: Option<ObjectOnly<PersonenAngabe>>,
    /// Nur beim Weg `flaeche`.
    #[schema(value_type = Option<FlaecheAngabe>)]
    pub flaeche: Option<ObjectOnly<FlaecheAngabe>>,
    /// Nur beim Weg `raeume`; höchstens 200 Räume.
    #[schema(value_type = Option<Vec<RaumAngabe>>)]
    pub raeume: Option<Vec<ObjectOnly<RaumAngabe>>>,
    /// Nur beim Weg `zelte`.
    #[schema(value_type = Option<ZelteAngabe>)]
    pub zelte: Option<ObjectOnly<ZelteAngabe>>,
    /// Richtwerte nur für diese Anfrage, Schlüssel → Wert. Schlüssel und Grenzen nennt
    /// `GET /api/v1/rechner/unterkunft/richtwerte`.
    #[schema(value_type = Option<HashMap<String, f64>>)]
    pub richtwerte: Option<Werte>,
    /// Einsatz, dessen Richtwerte gelten sollen. Nur ein Einsatz, den die Einsatzleitung für den
    /// Zugang freigegeben hat, sonst 404. `null` gilt wie fehlend.
    pub einsatz_id: Option<i64>,
}

/// Personen einer Gruppe.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftGruppe {
    pub gruppe: PersonenGruppe,
    pub personen: u64,
}

/// Anzahl je Zelttyp.
#[derive(Debug, Serialize, ToSchema)]
pub struct ZeltAnzahl {
    pub typ: ZeltTyp,
    pub anzahl: u64,
}

/// Ein Raum im Ergebnis: Nutzfläche nach Abzügen und Plätze (abgerundet).
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftRaum {
    pub bezeichnung: String,
    pub nutzflaeche_m2: f64,
    pub plaetze: u64,
    pub gruppe: PersonenGruppe,
}

/// Kapazität aus Räumen, Fläche oder Zelten.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftKapazitaet {
    pub plaetze: u64,
    /// Die Räume einzeln; nur beim Weg `raeume`, sonst `null`.
    #[schema(required)]
    pub raeume: Option<Vec<UnterkunftRaum>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftSchlafen {
    pub flaeche_m2: f64,
    /// Zelte, wenn nur dieser Typ aufgebaut wird.
    pub zelte_je_typ: Vec<ZeltAnzahl>,
    /// Wenigste Zelte: das größte zuerst, der Rest ins kleinste passende.
    pub zeltmix: Vec<ZeltAnzahl>,
    pub zeltmix_grundflaeche_m2: f64,
    /// Grundfläche samt Abstand zwischen den Zelten.
    pub zeltmix_platzbedarf_m2: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftMaterial {
    pub feldbetten: u64,
    pub decken: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftSanitaer {
    pub toiletten: u64,
    pub urinale: u64,
    pub waschplaetze: u64,
    pub duschen: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftGesundheit {
    pub betten: u64,
    pub flaeche_m2: f64,
    pub isolierstation: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftVersorgung {
    pub wasser_l_tag: u64,
    pub davon_trinkwasser_l_tag: u64,
    pub faekalien_l_tag: f64,
    pub abfall_l_tag: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftVerpflegung {
    pub ausgabestellen: u64,
    pub sitzplaetze: u64,
    pub garnituren: u64,
    pub aufenthaltszelte_je_typ: Vec<ZeltAnzahl>,
}

/// Ergebnis einer Rechnung. Bedarf ist aufgerundet, Kapazität abgerundet.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftErgebnis {
    pub weg: UnterkunftWeg,
    pub trennung: bool,
    /// Personen, für die gerechnet wurde: die Angabe oder die errechnete Kapazität.
    pub personen: u64,
    pub gruppen: Vec<UnterkunftGruppe>,
    /// Beim Weg `personen` `null`.
    #[schema(required)]
    pub kapazitaet: Option<UnterkunftKapazitaet>,
    pub schlafen: UnterkunftSchlafen,
    pub material: UnterkunftMaterial,
    pub sanitaer: UnterkunftSanitaer,
    pub gesundheit: UnterkunftGesundheit,
    pub versorgung: UnterkunftVersorgung,
    pub verpflegung: UnterkunftVerpflegung,
}

/// Ein Richtwert, mit dem gerechnet wurde.
#[derive(Debug, Serialize, ToSchema)]
pub struct RichtwertWirksam {
    pub schluessel: String,
    pub wert: f64,
    pub herkunft: RichtwertEbene,
}

/// Antwort auf `POST /api/v1/rechner/unterkunft`.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftResponse {
    pub ergebnis: UnterkunftErgebnis,
    /// Jeder Richtwert der Basis genau einmal, mit dem wirksamen Wert.
    pub richtwerte: Vec<RichtwertWirksam>,
    /// Stand der Basis (`JJJJ-MM-TT`).
    pub stand: String,
}

/// Ein Zelttyp mit seiner Bezeichnung.
#[derive(Debug, Serialize, ToSchema)]
pub struct ZelttypAngabe {
    pub typ: ZeltTyp,
    pub bezeichnung: String,
}

/// Ein Richtwert mit seinen Angaben.
#[derive(Debug, Serialize, ToSchema)]
pub struct RichtwertAuskunft {
    pub schluessel: String,
    pub bezeichnung: String,
    /// Gliederung für die Anzeige, etwa `schlafen` oder `sanitaer`.
    pub gruppe: String,
    pub einheit: String,
    /// Kleinster und größter Wert, den `richtwerte` einer Anfrage annehmen darf.
    pub min: f64,
    pub max: f64,
    /// Nur ganze Zahlen erlaubt.
    pub ganzzahl: bool,
    /// Vorgabe des Programms.
    pub basis: f64,
    /// Wirksamer Wert ohne Werte einer Anfrage.
    pub wert: f64,
    pub herkunft: RichtwertEbene,
}

/// Antwort auf `GET /api/v1/rechner/unterkunft/richtwerte`.
#[derive(Debug, Serialize, ToSchema)]
pub struct UnterkunftRichtwerteResponse {
    /// Stand der Basis (`JJJJ-MM-TT`).
    pub stand: String,
    pub zelttypen: Vec<ZelttypAngabe>,
    pub richtwerte: Vec<RichtwertAuskunft>,
}

fn invalid(text: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::InvalidField, text)
}

fn unprocessable(text: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::Unprocessable, text)
}

/// Liest den Body einer Anfrage als JSON-Objekt. Kein JSON und ein Body, der nicht zur Form passt
/// (falscher Typ, unbekanntes, doppeltes oder fehlendes Feld, nicht darstellbare Zahl), sind 400;
/// der Text nennt den Pfad des Felds (`raeume[1].laenge_m`), soweit es einen gibt.
fn parse_body<T: DeserializeOwned>(body: &[u8]) -> Result<T, ApiError> {
    let mut json = serde_json::Deserializer::from_slice(body);
    let parsed: Result<ObjectOnly<T>, _> = serde_path_to_error::deserialize(&mut json);
    let error = match parsed {
        Ok(ObjectOnly(wert)) => match json.end() {
            Ok(()) => return Ok(wert),
            Err(_) => return Err(invalid("Anfrage-Body ist kein gültiges JSON.")),
        },
        Err(error) => error,
    };
    let path = error.path().to_string();
    let cause = error.into_inner();
    // serde_json stuft eine Zahl wie 1e999 als Syntaxfehler ein; sie ist aber gültiges JSON an
    // einem bestimmten Feld.
    let is_out_of_range = cause.to_string().starts_with("number out of range");
    if !is_out_of_range && !cause.is_data() {
        return Err(invalid("Anfrage-Body ist kein gültiges JSON."));
    }
    let cause = if is_out_of_range {
        "Zahl außerhalb des darstellbaren Bereichs".to_string()
    } else {
        cause.to_string()
    };
    Err(invalid(if path == "." {
        format!("Anfrage-Body passt nicht zum erwarteten Format: {cause}")
    } else {
        format!("Anfrage-Body passt nicht zum erwarteten Format: {path}: {cause}")
    }))
}

/// Macht aus `-0.0` die `0.0`. JSON kennt die negative Null, die Antwort soll sie nicht tragen:
/// ein Richtwert der Anfrage steht unverändert in `richtwerte`. Was durch die Rechnung geht,
/// glättet der Kern (`glatt`).
fn normalize_zero(wert: f64) -> f64 {
    wert + 0.0
}

/// Ganze Zahl von 0 bis `max`.
fn check_anzahl(feld: &str, wert: f64, max: u64) -> Result<u64, ApiError> {
    if !wert.is_finite() || wert < 0.0 {
        return Err(invalid(format!("{feld} darf nicht negativ sein")));
    }
    if wert.fract() != 0.0 {
        return Err(invalid(format!("{feld} muss eine ganze Zahl sein")));
    }
    if wert > max as f64 {
        return Err(invalid(format!("{feld} darf höchstens {max} sein")));
    }
    Ok(wert as u64)
}

/// Maß in Metern: größer als 0, höchstens [`MASS_MAX_M`].
fn check_mass(feld: &str, wert: f64) -> Result<f64, ApiError> {
    if !wert.is_finite() || wert <= 0.0 || wert > MASS_MAX_M {
        return Err(invalid(format!(
            "{feld} muss größer als 0 und höchstens {MASS_MAX_M} m sein"
        )));
    }
    Ok(wert)
}

/// Fläche in Quadratmetern: 0 bis [`FLAECHE_MAX_M2`].
fn check_flaeche(feld: &str, wert: f64) -> Result<f64, ApiError> {
    if !wert.is_finite() || wert < 0.0 {
        return Err(invalid(format!("{feld} darf nicht negativ sein")));
    }
    if wert > FLAECHE_MAX_M2 {
        return Err(invalid(format!(
            "{feld} darf höchstens {FLAECHE_MAX_M2} m² sein"
        )));
    }
    Ok(wert)
}

/// Zeltbestand einer Gruppe: bekannte Typen, je Typ eine ganze Zahl bis [`ZELTE_JE_TYP_MAX`].
fn check_zeltbestand(
    feld: &str,
    bestand: &BTreeMap<String, f64>,
) -> Result<kern::Zeltbestand, ApiError> {
    bestand
        .iter()
        .map(|(typ, anzahl)| {
            let feld = format!("{feld}.{typ}");
            if ZeltTyp::parse(typ).is_none() {
                return Err(invalid(format!("{feld}: unbekannter Zelttyp")));
            }
            Ok((typ.clone(), check_anzahl(&feld, *anzahl, ZELTE_JE_TYP_MAX)?))
        })
        .collect()
}

/// Drei optionale Angaben eines Blocks, jede für sich geprüft.
struct Angaben<T> {
    gesamt: Option<T>,
    maenner: Option<T>,
    frauen: Option<T>,
}

impl<T> Angaben<T> {
    /// Führt die Angaben nach der Trennung zusammen (422 bei Widerspruch). Gruppen kommen immer
    /// als Paar: fehlte eine, rechnete die API still mit 0. `summe` bildet ohne Trennung aus
    /// `maenner` und `frauen` die Gesamtangabe; fehlt sie, verlangt der Block `gesamt`.
    /// `nachsilbe` ist der Rest des Feldnamens (`_m2` bei Flächen), `leer` die Schreibweise einer
    /// leeren Gruppe (`0`, bei Zelten `{}`).
    fn aufteilen(
        self,
        block: &str,
        nachsilbe: &str,
        leer: &str,
        trennung: bool,
        summe: Option<fn(T, T) -> T>,
    ) -> Result<Aufteilung<T>, ApiError> {
        let paar = format!("maenner{nachsilbe} und frauen{nachsilbe}");
        if trennung {
            if self.gesamt.is_some() {
                return Err(unprocessable(format!(
                    "{block}.gesamt{nachsilbe} passt nicht zur Trennung; {paar} angeben"
                )));
            }
            return match (self.maenner, self.frauen) {
                (Some(maenner), Some(frauen)) => Ok(Aufteilung::Getrennt { maenner, frauen }),
                _ => Err(unprocessable(format!(
                    "{block} braucht bei Trennung {paar}, beide; eine leere Gruppe ist {leer}"
                ))),
            };
        }
        match (self.gesamt, self.maenner, self.frauen, summe) {
            (Some(gesamt), None, None, _) => Ok(Aufteilung::Gesamt(gesamt)),
            (Some(_), _, _, Some(_)) => Err(unprocessable(format!(
                "{block}.gesamt{nachsilbe} steht neben einer Gruppe; \
                 gesamt{nachsilbe} oder {paar} angeben"
            ))),
            (None, Some(maenner), Some(frauen), Some(summe)) => {
                Ok(Aufteilung::Gesamt(summe(maenner, frauen)))
            }
            (None, _, _, Some(_)) => Err(unprocessable(format!(
                "{block} braucht gesamt{nachsilbe} oder {paar}, beide"
            ))),
            (_, _, _, None) => Err(unprocessable(format!(
                "{block} braucht ohne Trennung gesamt{nachsilbe}, ohne {paar}"
            ))),
        }
    }
}

/// Ein Raum, jedes Feld für sich geprüft; die Belegung wird erst mit der Trennung gedeutet.
struct RaumGeprueft {
    bezeichnung: String,
    laenge_m: f64,
    breite_m: f64,
    abzuege: Vec<kern::Abzug>,
    belegung: Option<RaumBelegung>,
}

fn check_raeume(raeume: Vec<ObjectOnly<RaumAngabe>>) -> Result<Vec<RaumGeprueft>, ApiError> {
    if raeume.len() > RAEUME_MAX {
        return Err(invalid(format!(
            "raeume darf höchstens {RAEUME_MAX} Räume nennen"
        )));
    }
    raeume
        .into_iter()
        .enumerate()
        .map(|(i, ObjectOnly(r))| {
            let feld = format!("raeume[{i}]");
            let bezeichnung = r.bezeichnung.unwrap_or_default().trim().to_string();
            if bezeichnung.chars().count() > BEZEICHNUNG_MAX {
                return Err(invalid(format!(
                    "{feld}.bezeichnung darf höchstens {BEZEICHNUNG_MAX} Zeichen lang sein"
                )));
            }
            let abzuege = r.abzuege.unwrap_or_default();
            if abzuege.len() > ABZUEGE_MAX {
                return Err(invalid(format!(
                    "{feld}.abzuege darf höchstens {ABZUEGE_MAX} Abzüge nennen"
                )));
            }
            let abzuege = abzuege
                .into_iter()
                .enumerate()
                .map(|(j, ObjectOnly(a))| {
                    Ok(kern::Abzug {
                        laenge_m: check_mass(&format!("{feld}.abzuege[{j}].laenge_m"), a.laenge_m)?,
                        breite_m: check_mass(&format!("{feld}.abzuege[{j}].breite_m"), a.breite_m)?,
                    })
                })
                .collect::<Result<Vec<_>, ApiError>>()?;
            let belegung = r
                .belegung
                .map(|b| {
                    RaumBelegung::parse(&b).ok_or_else(|| {
                        invalid(format!(
                            "{feld}.belegung: unbekannter Wert „{b}“ (maenner oder frauen)"
                        ))
                    })
                })
                .transpose()?;
            Ok(RaumGeprueft {
                bezeichnung,
                laenge_m: check_mass(&format!("{feld}.laenge_m"), r.laenge_m)?,
                breite_m: check_mass(&format!("{feld}.breite_m"), r.breite_m)?,
                abzuege,
                belegung,
            })
        })
        .collect()
}

/// Deutet die Belegung der Räume nach der Trennung (422 bei Widerspruch).
fn raeume_aufteilen(
    raeume: Vec<RaumGeprueft>,
    trennung: bool,
) -> Result<Vec<kern::Raum>, ApiError> {
    raeume
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            let gruppe = match (trennung, r.belegung) {
                (true, Some(RaumBelegung::Maenner)) => kern::Gruppe::Maenner,
                (true, Some(RaumBelegung::Frauen)) => kern::Gruppe::Frauen,
                (true, None) => {
                    return Err(unprocessable(format!(
                        "raeume[{i}].belegung fehlt: bei Trennung belegt jeden Raum eine Gruppe"
                    )))
                }
                (false, Some(_)) => {
                    return Err(unprocessable(format!(
                        "raeume[{i}].belegung passt nur zur Trennung"
                    )))
                }
                (false, None) => kern::Gruppe::Gesamt,
            };
            Ok(kern::Raum {
                bezeichnung: r.bezeichnung,
                laenge_m: r.laenge_m,
                breite_m: r.breite_m,
                abzuege: r.abzuege,
                gruppe,
            })
        })
        .collect()
}

/// Prüft die Anfrage und liefert die Eingabe des Kerns und die Richtwerte der Anfrage. Erst jedes
/// Feld für sich (400), dann der Zusammenhang (422), nach `src/AGENTS.md`,
/// „Statuscode-Konvention“.
/// Eine geprüfte Anfrage: Eingabe des Kerns, Richtwerte der Anfrage und der genannte Einsatz,
/// dessen Freigabe erst der Handler prüft (design.md D3).
struct CheckedRequest {
    eingabe: kern::Eingabe,
    anfrage: BTreeMap<String, f64>,
    einsatz_id: Option<i64>,
}

fn check_request(req: UnterkunftRequest) -> Result<CheckedRequest, ApiError> {
    // 1. Jedes Feld für sich, gleich welcher Weg gilt.
    let weg = UnterkunftWeg::parse(&req.weg).ok_or_else(|| {
        invalid(format!(
            "weg: unbekannter Wert „{}“ (personen, raeume, flaeche oder zelte)",
            req.weg
        ))
    })?;
    let personen_max = MAX_PERSONEN as u64;
    let personen = req
        .personen
        .map(|ObjectOnly(p)| {
            let zahl = |feld: &str, wert: Option<f64>| {
                wert.map(|w| check_anzahl(&format!("personen.{feld}"), w, personen_max))
                    .transpose()
            };
            Ok::<_, ApiError>(Angaben {
                gesamt: zahl("gesamt", p.gesamt)?,
                maenner: zahl("maenner", p.maenner)?,
                frauen: zahl("frauen", p.frauen)?,
            })
        })
        .transpose()?;
    let flaeche = req
        .flaeche
        .map(|ObjectOnly(f)| {
            let zahl = |feld: &str, wert: Option<f64>| {
                wert.map(|w| check_flaeche(&format!("flaeche.{feld}"), w))
                    .transpose()
            };
            Ok::<_, ApiError>(Angaben {
                gesamt: zahl("gesamt_m2", f.gesamt_m2)?,
                maenner: zahl("maenner_m2", f.maenner_m2)?,
                frauen: zahl("frauen_m2", f.frauen_m2)?,
            })
        })
        .transpose()?;
    let raeume = req.raeume.map(check_raeume).transpose()?;
    let zelte = req
        .zelte
        .map(|ObjectOnly(z)| {
            let bestand = |feld: &str, wert: Option<Werte>| {
                wert.map(|Werte(b)| check_zeltbestand(&format!("zelte.{feld}"), &b))
                    .transpose()
            };
            Ok::<_, ApiError>(Angaben {
                gesamt: bestand("gesamt", z.gesamt)?,
                maenner: bestand("maenner", z.maenner)?,
                frauen: bestand("frauen", z.frauen)?,
            })
        })
        .transpose()?;
    let Werte(mut richtwerte) = req.richtwerte.unwrap_or_default();
    for (schluessel, wert) in &mut richtwerte {
        unterkunft::pruefe(schluessel, *wert)?;
        *wert = normalize_zero(*wert);
    }

    // 2. Der Zusammenhang: genau der Block des Wegs, passend zur Trennung.
    let bloecke = [
        (UnterkunftWeg::Personen, personen.is_some()),
        (UnterkunftWeg::Raeume, raeume.is_some()),
        (UnterkunftWeg::Flaeche, flaeche.is_some()),
        (UnterkunftWeg::Zelte, zelte.is_some()),
    ];
    for (block, da) in bloecke {
        if da && block != weg {
            return Err(unprocessable(format!(
                "{} passt nicht zum weg „{}“",
                block.as_str(),
                weg.as_str()
            )));
        }
    }
    let fehlt = || {
        unprocessable(format!(
            "{0} fehlt: der weg „{0}“ braucht diesen Block",
            weg.as_str()
        ))
    };
    let trennung = req.trennung;
    let eingabe = match weg {
        UnterkunftWeg::Personen => kern::Eingabe::Personen(personen.ok_or_else(fehlt)?.aufteilen(
            "personen",
            "",
            "0",
            trennung,
            Some(|m, f| m + f),
        )?),
        UnterkunftWeg::Flaeche => kern::Eingabe::Flaeche(flaeche.ok_or_else(fehlt)?.aufteilen(
            "flaeche",
            "_m2",
            "0",
            trennung,
            Some(|m, f| m + f),
        )?),
        UnterkunftWeg::Raeume => kern::Eingabe::Raeume {
            getrennt: trennung,
            raeume: raeume_aufteilen(raeume.ok_or_else(fehlt)?, trennung)?,
        },
        // Ohne Trennung zählt nur `gesamt`, wie im Rechner der Oberfläche.
        UnterkunftWeg::Zelte => kern::Eingabe::Zelte(
            zelte
                .ok_or_else(fehlt)?
                .aufteilen("zelte", "", "{}", trennung, None)?,
        ),
    };
    Ok(CheckedRequest {
        eingabe,
        anfrage: richtwerte,
        einsatz_id: req.einsatz_id,
    })
}

fn gruppe(g: kern::Gruppe) -> PersonenGruppe {
    match g {
        kern::Gruppe::Gesamt => PersonenGruppe::Gesamt,
        kern::Gruppe::Maenner => PersonenGruppe::Maenner,
        kern::Gruppe::Frauen => PersonenGruppe::Frauen,
    }
}

/// Zelttyp der Basis als Wert des Vertrags. Beide Listen sind gleich (Test
/// `zelttypen_des_vertrags_sind_die_der_basis`).
fn zelt_typ(typ: &str) -> ZeltTyp {
    ZeltTyp::parse(typ).unwrap_or_else(|| panic!("Zelttyp {typ} fehlt im Vertrag"))
}

fn zelt_anzahlen(liste: Vec<kern::TypAnzahl>) -> Vec<ZeltAnzahl> {
    liste
        .into_iter()
        .map(|e| ZeltAnzahl {
            typ: zelt_typ(e.typ),
            anzahl: e.anzahl,
        })
        .collect()
}

impl From<kern::Ergebnis> for UnterkunftErgebnis {
    fn from(e: kern::Ergebnis) -> Self {
        UnterkunftErgebnis {
            weg: match e.weg {
                kern::Weg::Personen => UnterkunftWeg::Personen,
                kern::Weg::Raeume => UnterkunftWeg::Raeume,
                kern::Weg::Flaeche => UnterkunftWeg::Flaeche,
                kern::Weg::Zelte => UnterkunftWeg::Zelte,
            },
            trennung: e.trennung,
            personen: e.personen,
            gruppen: e
                .gruppen
                .into_iter()
                .map(|(g, personen)| UnterkunftGruppe {
                    gruppe: gruppe(g),
                    personen,
                })
                .collect(),
            kapazitaet: e.kapazitaet.map(|k| UnterkunftKapazitaet {
                plaetze: k.plaetze,
                raeume: k.raeume.map(|raeume| {
                    raeume
                        .into_iter()
                        .map(|r| UnterkunftRaum {
                            bezeichnung: r.bezeichnung,
                            nutzflaeche_m2: r.nutzflaeche_m2,
                            plaetze: r.plaetze,
                            gruppe: gruppe(r.gruppe),
                        })
                        .collect()
                }),
            }),
            schlafen: UnterkunftSchlafen {
                flaeche_m2: e.schlafen.flaeche_m2,
                zelte_je_typ: zelt_anzahlen(e.schlafen.zelte_je_typ),
                zeltmix: zelt_anzahlen(e.schlafen.zeltmix),
                zeltmix_grundflaeche_m2: e.schlafen.zeltmix_grundflaeche_m2,
                zeltmix_platzbedarf_m2: e.schlafen.zeltmix_platzbedarf_m2,
            },
            material: UnterkunftMaterial {
                feldbetten: e.material.feldbetten,
                decken: e.material.decken,
            },
            sanitaer: UnterkunftSanitaer {
                toiletten: e.sanitaer.toiletten,
                urinale: e.sanitaer.urinale,
                waschplaetze: e.sanitaer.waschplaetze,
                duschen: e.sanitaer.duschen,
            },
            gesundheit: UnterkunftGesundheit {
                betten: e.gesundheit.betten,
                flaeche_m2: e.gesundheit.flaeche_m2,
                isolierstation: e.gesundheit.isolierstation,
            },
            versorgung: UnterkunftVersorgung {
                wasser_l_tag: e.versorgung.wasser_l_tag,
                davon_trinkwasser_l_tag: e.versorgung.davon_trinkwasser_l_tag,
                faekalien_l_tag: e.versorgung.faekalien_l_tag,
                abfall_l_tag: e.versorgung.abfall_l_tag,
            },
            verpflegung: UnterkunftVerpflegung {
                ausgabestellen: e.verpflegung.ausgabestellen,
                sitzplaetze: e.verpflegung.sitzplaetze,
                garnituren: e.verpflegung.garnituren,
                aufenthaltszelte_je_typ: zelt_anzahlen(e.verpflegung.aufenthaltszelte_je_typ),
            },
        }
    }
}

/// Wirksamer Wert und Herkunft je Schlüssel der Basis, in der Reihenfolge der Basis: Anfrage vor
/// Einsatz vor Organisation vor Basis. Die Ebenen unter der Anfrage legt
/// [`unterkunft::zusammenfuehren`] übereinander, dieselbe Rangfolge wie in der Oberfläche
/// (design.md D5); ein gespeicherter Wert zu einem Schlüssel, den die Basis nicht mehr kennt,
/// fällt dort weg.
fn wirksame_werte(
    org: &HashMap<String, f64>,
    einsatz: Option<&HashMap<String, f64>>,
    anfrage: &BTreeMap<String, f64>,
) -> Vec<(&'static unterkunft::Basiswert, f64, RichtwertEbene)> {
    let ebenen = unterkunft::zusammenfuehren(org, einsatz).werte;
    unterkunft::basis()
        .iter()
        .zip(ebenen)
        .map(|(b, e)| {
            debug_assert_eq!(b.schluessel, e.schluessel);
            match anfrage.get(&b.schluessel) {
                Some(a) => (b, *a, RichtwertEbene::Anfrage),
                None => (b, e.wert, ebene(e.herkunft)),
            }
        })
        .collect()
}

/// Herkunft der internen Ebenen als Wert des Vertrags.
fn ebene(herkunft: unterkunft::RichtwertHerkunft) -> RichtwertEbene {
    match herkunft {
        unterkunft::RichtwertHerkunft::Basis => RichtwertEbene::Basis,
        unterkunft::RichtwertHerkunft::Org => RichtwertEbene::Org,
        unterkunft::RichtwertHerkunft::Einsatz => RichtwertEbene::Einsatz,
    }
}

/// Legt die Ebenen übereinander und rechnet. Ohne Datenbank: die Werte der Organisation und des
/// Einsatzes reicht der Aufrufer herein, die Freigabe hat er vorher geprüft.
fn calculate(
    checked: CheckedRequest,
    org: &HashMap<String, f64>,
    einsatz: Option<&HashMap<String, f64>>,
) -> UnterkunftResponse {
    let wirksam = wirksame_werte(org, einsatz, &checked.anfrage);
    let mut rw = kern::Richtwerte::basis();
    for (b, wert, _) in &wirksam {
        rw.setzen(&b.schluessel, *wert);
    }
    UnterkunftResponse {
        ergebnis: kern::rechne(&checked.eingabe, &rw).into(),
        richtwerte: wirksam
            .into_iter()
            .map(|(b, wert, herkunft)| RichtwertWirksam {
                schluessel: b.schluessel.clone(),
                wert,
                herkunft,
            })
            .collect(),
        stand: unterkunft::stand().to_string(),
    }
}

/// Die Werte der Organisation eines Zugangs.
async fn load_org_werte(state: &AppState, org_id: i64) -> Result<HashMap<String, f64>, ApiError> {
    let mut conn = state.pool.acquire().await?;
    Ok(repo::org_werte(&mut conn, org_id).await?)
}

/// Dieselbe Antwort für jeden Einsatz, den der Zugang nicht lesen darf: nicht freigegeben,
/// abgeschlossen, fremd oder unbekannt. Sie verrät nicht, ob es den Einsatz gibt.
fn einsatz_not_found() -> ApiError {
    ApiError::new(
        ErrorCode::NotFound,
        "Kein laufender Einsatz mit dieser Kennung ist für diesen Zugang freigegeben.",
    )
}

/// Liefert die Freigabestufe eines Spiegels die Werte des Einsatzes? Ohne sie rechnete der Server
/// still mit der Organisation und nennte die Herkunft `org` (design.md D2). Eine unbekannte Stufe
/// liefert nichts.
fn is_einsatz_werte_vollstaendig(stufe: Option<Freigabestufe>) -> bool {
    let Some(stufe) = stufe else {
        return false;
    };
    crate::instanz::spiegel::art::kategorie("einsatz_unterkunft_richtwert")
        .is_some_and(|k| stufe.liefert(k))
}

/// Die Werte eines Einsatzes, den der Zugang lesen darf (design.md D2); sonst 404.
async fn load_einsatz_werte(
    pool: &sqlx::SqlitePool,
    zugang_id: &str,
    org_id: i64,
    einsatz_id: i64,
) -> Result<HashMap<String, f64>, ApiError> {
    let lesbar = {
        let mut conn = pool.acquire().await?;
        freigabe::is_lesbar(&mut conn, zugang_id, org_id, einsatz_id).await?
    };
    if !lesbar {
        return Err(einsatz_not_found());
    }
    let stufe = crate::routes::lagebild_extern::load_freigabestufe(pool, einsatz_id).await?;
    if !is_einsatz_werte_vollstaendig(stufe) {
        return Err(einsatz_not_found());
    }
    let mut conn = pool.acquire().await?;
    Ok(repo::einsatz_werte(&mut conn, einsatz_id).await?)
}

/// Die Werte des genannten Einsatzes, falls die Anfrage einen nennt.
async fn load_requested_einsatz_werte(
    state: &AppState,
    client: &MachineClient,
    einsatz_id: Option<i64>,
) -> Result<Option<HashMap<String, f64>>, ApiError> {
    match einsatz_id {
        Some(id) => Ok(Some(
            load_einsatz_werte(&state.pool, &client.zugang.id, client.zugang.org_id, id).await?,
        )),
        None => Ok(None),
    }
}

/// Abfrage von `GET /api/v1/rechner/unterkunft/richtwerte`. Der Wert kommt als Text und wird im
/// Handler geprüft, damit ein falscher Wert den Code `invalid_field` bekommt (wie `after` in
/// `super::events`).
#[derive(Debug, Deserialize)]
pub struct RichtwerteQuery {
    pub einsatz_id: Option<String>,
}

/// `einsatz_id` der Abfrage: eine ganze Zahl; fehlt sie, gilt kein Einsatz.
fn parse_einsatz_id(roh: Option<&str>) -> Result<Option<i64>, ApiError> {
    let Some(roh) = roh else { return Ok(None) };
    roh.parse::<i64>().map(Some).map_err(|_| {
        invalid(format!(
            "einsatz_id: „{roh}“ ist keine ganze Zahl (Kennung eines Einsatzes)"
        ))
    })
}

/// Unterkunft und Zelte durchrechnen. Speichert nichts.
///
/// Wirksam ist je Richtwert der Wert aus `richtwerte` der Anfrage, sonst der Wert des Einsatzes aus
/// `einsatz_id`, sonst der Wert der Organisation des Zugangs, sonst die Vorgabe des Programms. Den
/// Einsatz nimmt die Rechnung nur, wenn die Einsatzleitung ihn für den Zugang freigegeben hat.
#[utoipa::path(
    post,
    path = "/api/v1/rechner/unterkunft",
    tag = "Rechner",
    operation_id = "calculate_unterkunft",
    security(("machine" = [])),
    request_body = UnterkunftRequest,
    responses(
        (status = 200, description = "Ergebnis, wirksame Richtwerte und Stand der Basis; Antwort signiert im Kopf `Lifeline-Signature`", body = UnterkunftResponse),
        (status = 400, description = "Ein Feld für sich ist ungültig: kein JSON, unbekanntes oder doppeltes Feld, falscher Typ, unbekannter Wert oder Richtwert, Zahl außerhalb der Grenzen. Der Text nennt das Feld.", body = super::ApiErrorBody),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt das Recht `rechner:use`", body = super::ApiErrorBody),
        (status = 404, description = "`einsatz_id` nennt keinen laufenden Einsatz, den die Einsatzleitung für den Zugang freigegeben hat (`not_found`); die Antwort verrät nicht, ob es den Einsatz gibt. Geprüft wird nach 400 und 422.", body = super::ApiErrorBody),
        (status = 413, description = "Der Body ist größer als 64 KiB", body = super::ApiErrorBody),
        (status = 422, description = "Die Felder passen nicht zusammen: Block fehlt oder gehört zu einem anderen Weg; `personen`, `flaeche` oder `zelte` ohne Angabe; `gesamt` neben einer Gruppe oder bei Trennung; von `maenner` und `frauen` fehlt eine; Zelte ohne Trennung ohne `gesamt`; Belegung eines Raums passt nicht zur Trennung. Eine leere Raumliste ist gültig und ergibt 0 Plätze.", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn calculate_unterkunft(
    State(state): State<AppState>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    // Erst die Anfrage (400, 422), dann der Einsatz (404): design.md D3.
    let checked = check_request(parse_body(&client.body)?)?;
    let einsatz = load_requested_einsatz_werte(&state, &client, checked.einsatz_id).await?;
    let org = load_org_werte(&state, client.zugang.org_id).await?;
    let antwort = calculate(checked, &org, einsatz.as_ref());
    Ok(client.antwort(StatusCode::OK, &antwort))
}

/// Die Richtwerte des Rechners mit Bezeichnung, Einheit und Grenzen, dazu die Zelttypen.
///
/// `wert` ist mit `einsatz_id` der Wert dieses Einsatzes, sonst der Wert der Organisation des
/// Zugangs, sonst die Vorgabe des Programms. Den Einsatz nimmt die Auskunft nur, wenn die
/// Einsatzleitung ihn für den Zugang freigegeben hat.
#[utoipa::path(
    get,
    path = "/api/v1/rechner/unterkunft/richtwerte",
    tag = "Rechner",
    operation_id = "get_unterkunft_richtwerte",
    security(("machine" = [])),
    params(
        ("einsatz_id" = Option<i64>, Query,
            description = "Einsatz, dessen Richtwerte gelten sollen; nur ein Einsatz, den die Einsatzleitung für den Zugang freigegeben hat"),
    ),
    responses(
        (status = 200, description = "Richtwerte und Zelttypen; Antwort signiert im Kopf `Lifeline-Signature`", body = UnterkunftRichtwerteResponse),
        (status = 400, description = "`einsatz_id` ist keine ganze Zahl (`invalid_field`)", body = super::ApiErrorBody),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt das Recht `rechner:use`", body = super::ApiErrorBody),
        (status = 404, description = "`einsatz_id` nennt keinen laufenden Einsatz, den die Einsatzleitung für den Zugang freigegeben hat (`not_found`); die Antwort verrät nicht, ob es den Einsatz gibt", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn get_unterkunft_richtwerte(
    State(state): State<AppState>,
    Query(query): Query<RichtwerteQuery>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    let einsatz_id = parse_einsatz_id(query.einsatz_id.as_deref())?;
    let einsatz = load_requested_einsatz_werte(&state, &client, einsatz_id).await?;
    let org = load_org_werte(&state, client.zugang.org_id).await?;
    let antwort = UnterkunftRichtwerteResponse {
        stand: unterkunft::stand().to_string(),
        zelttypen: unterkunft::zelttypen()
            .iter()
            .map(|z| ZelttypAngabe {
                typ: zelt_typ(&z.typ),
                bezeichnung: z.bezeichnung.clone(),
            })
            .collect(),
        richtwerte: wirksame_werte(&org, einsatz.as_ref(), &BTreeMap::new())
            .into_iter()
            .map(|(b, wert, herkunft)| RichtwertAuskunft {
                schluessel: b.schluessel.clone(),
                bezeichnung: b.bezeichnung.clone(),
                gruppe: b.gruppe.clone(),
                einheit: b.einheit.clone(),
                min: b.min,
                max: b.max,
                ganzzahl: b.ganzzahl,
                basis: b.wert,
                wert,
                herkunft,
            })
            .collect(),
    };
    Ok(client.antwort(StatusCode::OK, &antwort))
}

#[cfg(test)]
mod tests;
