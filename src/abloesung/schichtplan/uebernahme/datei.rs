//! Schichtplan-Datei lesen (LLH-1556, design.md D1, D2): CSV oder XLSX in ein [`PlanPaket`].
//!
//! Eine Zeile steht für eine Person in einer Schicht. Die Kopfzeile nennt die Spalten, ohne Rücksicht
//! auf Groß- und Kleinschreibung, Leerzeichen und Bindestriche; die Reihenfolge ist frei. Pflicht
//! sind `Beginn`, `Ende` und, außer bei der Pause, `Posten`. Format und Beispiele stehen in der
//! Anwenderdoku (`docs/anwender/kapitel/abloesung.md`).
//!
//! Rein bis auf die Zone des Einsatzes, die der Aufrufer mitgibt: Eine Zeit ohne Versatz und eine
//! Datumszelle aus Excel gelten als Ortszeit dort. Eine fehlerhafte Zeile fällt aus dem Paket und
//! steht als Fehler in den Meldungen; eine unlesbare Datei ist 400.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;

use super::abgleich::{herkunft_norm, norm, telefon_norm};
use super::{
    ImportMeldung, PaketBlock, PaketPerson, PaketPosten, PaketPostenArt, PaketQualiSoll,
    PersonAngabe, PlanPaket, QualiAngabe, DATEI_MAX_BYTES, HERKUNFT_MAX, KENNUNG_MAX,
    POSTEN_TEXT_MAX, XLSX_ENTPACKT_MAX_BYTES, ZEILEN_MAX,
};
use crate::abloesung::schichtplan::{
    zerlegung, HELFER_QUALIFIKATIONEN_MAX, HELFER_TELEFON_MAX, HELFER_TEXT_MAX, SOLL_ANZAHL_MAX,
};
use crate::error::AppError;
use crate::personal::quali_soll::{QUALI_SOLL_ANZAHL_MAX, QUALI_SOLL_MAX};

/// Eine Zelle der Tabelle.
#[derive(Debug, Clone, PartialEq)]
pub enum Zelle {
    Leer,
    Text(String),
    Zahl(f64),
    /// Datumszelle aus Excel, ohne Zone.
    Zeit(NaiveDateTime),
}

impl Zelle {
    fn text(&self) -> Option<String> {
        match self {
            Zelle::Leer => None,
            Zelle::Text(t) => Some(t.trim().to_string()).filter(|t| !t.is_empty()),
            Zelle::Zahl(z) if z.fract() == 0.0 && z.abs() < 1e15 => Some(format!("{}", *z as i64)),
            Zelle::Zahl(z) => Some(z.to_string()),
            Zelle::Zeit(t) => Some(t.format("%Y-%m-%d %H:%M").to_string()),
        }
    }
}

/// Eine gelesene Tabelle: Kopf und Zeilen mit ihrer Nummer in der Datei (Kopf = 1).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Tabelle {
    pub kopf: Vec<String>,
    pub zeilen: Vec<(u32, Vec<Zelle>)>,
    pub meldungen: Vec<ImportMeldung>,
}

fn unlesbar(was: &str) -> AppError {
    AppError::Validation(format!("Die Datei ist keine lesbare {was}"))
}

/// Liest CSV oder XLSX (am Inhalt erkannt). Zu groß, zu viele Zeilen oder unlesbar: 400.
pub fn lies_tabelle(bytes: &[u8]) -> Result<Tabelle, AppError> {
    if bytes.len() > DATEI_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "Die Datei ist größer als {} MB",
            DATEI_MAX_BYTES / (1024 * 1024)
        )));
    }
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Err(AppError::Validation("Die Datei ist leer".into()));
    }
    let tabelle = if bytes.starts_with(b"PK\x03\x04") {
        lies_xlsx(bytes)?
    } else {
        lies_csv(bytes)?
    };
    if tabelle.zeilen.len() > ZEILEN_MAX {
        return Err(AppError::Validation(format!(
            "Die Datei hat mehr als {ZEILEN_MAX} Zeilen"
        )));
    }
    Ok(tabelle)
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

/// Windows-1252 für die Bytes 0x80–0x9F; sonst wie Latin-1.
const CP1252: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
];

fn cp1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => CP1252[(b - 0x80) as usize],
            _ => b as char,
        })
        .collect()
}

/// Trennzeichen aus der ersten Zeile: das häufigste von `;`, `,` und Tab außerhalb von
/// Anführungszeichen; bei Gleichstand `;`.
fn trennzeichen(text: &str) -> char {
    let mut zaehl = [(';', 0usize), (',', 0), ('\t', 0)];
    let mut in_quote = false;
    for c in text.chars() {
        match c {
            '"' => in_quote = !in_quote,
            '\n' | '\r' if !in_quote => break,
            _ if !in_quote => {
                for z in zaehl.iter_mut() {
                    if z.0 == c {
                        z.1 += 1;
                    }
                }
            }
            _ => {}
        }
    }
    zaehl
        .iter()
        .fold((';', 0), |best, z| if z.1 > best.1 { *z } else { best })
        .0
}

/// Datensätze nach RFC 4180: Felder in `"` dürfen Trennzeichen, Zeilenumbrüche und `""` tragen.
fn csv_saetze(text: &str, trenner: char) -> Vec<Vec<String>> {
    let mut saetze = Vec::new();
    let mut satz = Vec::new();
    let mut feld = String::new();
    let mut in_quote = false;
    let mut zeichen = text.chars().peekable();
    while let Some(c) = zeichen.next() {
        if in_quote {
            if c == '"' {
                if zeichen.peek() == Some(&'"') {
                    feld.push('"');
                    zeichen.next();
                } else {
                    in_quote = false;
                }
            } else {
                feld.push(c);
            }
            continue;
        }
        match c {
            '"' if feld.is_empty() => in_quote = true,
            '\r' => {}
            '\n' => {
                satz.push(std::mem::take(&mut feld));
                saetze.push(std::mem::take(&mut satz));
            }
            c if c == trenner => satz.push(std::mem::take(&mut feld)),
            c => feld.push(c),
        }
    }
    if !feld.is_empty() || !satz.is_empty() {
        satz.push(feld);
        saetze.push(satz);
    }
    saetze
}

fn lies_csv(bytes: &[u8]) -> Result<Tabelle, AppError> {
    let ohne_bom = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let mut meldungen = Vec::new();
    let text = match std::str::from_utf8(ohne_bom) {
        Ok(t) => t.to_string(),
        Err(_) => {
            meldungen.push(ImportMeldung::hinweis(
                None,
                "Kein UTF-8: als Windows-1252 gelesen",
            ));
            cp1252(ohne_bom)
        }
    };
    let trenner = trennzeichen(&text);
    let mut saetze = csv_saetze(&text, trenner).into_iter();
    let kopf = saetze.next().ok_or_else(|| unlesbar("CSV"))?;
    let zeilen = saetze
        .enumerate()
        .map(|(i, felder)| {
            (
                i as u32 + 2,
                felder
                    .into_iter()
                    .map(|f| {
                        let t = f.trim();
                        if t.is_empty() {
                            Zelle::Leer
                        } else {
                            Zelle::Text(t.to_string())
                        }
                    })
                    .collect(),
            )
        })
        .collect();
    Ok(Tabelle {
        kopf: kopf.into_iter().map(|k| k.trim().to_string()).collect(),
        zeilen,
        meldungen,
    })
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

/// Excel-Seriennummer (Tage seit 1899-12-30, Bruchteil = Uhrzeit) als Zeit, auf die Sekunde
/// gerundet. Außerhalb von 1900–9999 `None`.
pub fn excel_seriell(wert: f64) -> Option<NaiveDateTime> {
    if !(1.0..2_958_466.0).contains(&wert) {
        return None;
    }
    let epoche = NaiveDate::from_ymd_opt(1899, 12, 30)?.and_hms_opt(0, 0, 0)?;
    let sekunden = (wert * 86_400.0).round() as i64;
    epoche.checked_add_signed(chrono::Duration::seconds(sekunden))
}

/// Entpackte Größe aller Teile, ohne zu entpacken; über der Grenze 400.
fn pruefe_entpackt(bytes: &[u8]) -> Result<(), AppError> {
    let mut archiv = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| unlesbar("XLSX"))?;
    let mut summe: u64 = 0;
    for i in 0..archiv.len() {
        let teil = archiv.by_index_raw(i).map_err(|_| unlesbar("XLSX"))?;
        summe = summe.saturating_add(teil.size());
    }
    if summe > XLSX_ENTPACKT_MAX_BYTES {
        return Err(AppError::Validation("Die XLSX ist entpackt zu groß".into()));
    }
    Ok(())
}

fn lies_xlsx(bytes: &[u8]) -> Result<Tabelle, AppError> {
    use calamine::{Data, Reader, Xlsx};
    pruefe_entpackt(bytes)?;
    let mut mappe: Xlsx<_> =
        calamine::open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| unlesbar("XLSX"))?;
    let namen = mappe.sheet_names();
    // Ein Blatt „Austausch“ (Export der Suite, IDA-365) geht vor, sonst das erste.
    let blatt = namen
        .iter()
        .find(|n| norm(n) == "austausch")
        .or_else(|| namen.first())
        .cloned()
        .ok_or_else(|| unlesbar("XLSX"))?;
    let bereich = mappe
        .worksheet_range(&blatt)
        .map_err(|_| unlesbar("XLSX"))?;
    let erste = bereich.start().map(|(r, _)| r).unwrap_or(0);
    let spalte0 = bereich.start().map(|(_, c)| c).unwrap_or(0) as usize;
    let mut zeilen_it = bereich.rows().enumerate();
    let Some((_, kopf_zellen)) = zeilen_it.next() else {
        return Err(AppError::Validation("Die Datei ist leer".into()));
    };
    let zelle = |d: &Data| -> Zelle {
        match d {
            Data::Empty | Data::Error(_) => Zelle::Leer,
            Data::Int(i) => Zelle::Zahl(*i as f64),
            Data::Float(f) => Zelle::Zahl(*f),
            Data::String(s) | Data::DateTimeIso(s) | Data::DurationIso(s) => {
                let t = s.trim();
                if t.is_empty() {
                    Zelle::Leer
                } else {
                    Zelle::Text(t.to_string())
                }
            }
            Data::Bool(b) => Zelle::Text(b.to_string()),
            Data::DateTime(dt) if dt.is_datetime() => excel_seriell(dt.as_f64())
                .map(Zelle::Zeit)
                .unwrap_or(Zelle::Zahl(dt.as_f64())),
            Data::DateTime(dt) => Zelle::Zahl(dt.as_f64()),
        }
    };
    // Spalten links vom Bereich fehlen in `rows()`; auffüllen, damit die Kopfzeile passt.
    let auffuellen = |zellen: &[Data]| -> Vec<Zelle> {
        std::iter::repeat_n(Zelle::Leer, spalte0)
            .chain(zellen.iter().map(zelle))
            .collect()
    };
    let kopf = auffuellen(kopf_zellen)
        .into_iter()
        .map(|z| z.text().unwrap_or_default())
        .collect();
    let zeilen = zeilen_it
        .map(|(i, z)| (erste + i as u32 + 1, auffuellen(z)))
        .collect();
    Ok(Tabelle {
        kopf,
        zeilen,
        meldungen: Vec::new(),
    })
}

// ---------------------------------------------------------------------------------------------
// Spalten
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Spalte {
    Posten,
    Abschnitt,
    PostenArt,
    Beginn,
    Ende,
    SollAnzahl,
    SollQualifikationen,
    Nachname,
    Vorname,
    Telefon,
    Organisation,
    Qualifikationen,
    Kennung,
    Herkunft,
}

impl Spalte {
    fn name(self) -> &'static str {
        match self {
            Spalte::Posten => "Posten",
            Spalte::Abschnitt => "Abschnitt",
            Spalte::PostenArt => "Posten-Art",
            Spalte::Beginn => "Beginn",
            Spalte::Ende => "Ende",
            Spalte::SollAnzahl => "Soll-Anzahl",
            Spalte::SollQualifikationen => "Soll-Qualifikationen",
            Spalte::Nachname => "Nachname",
            Spalte::Vorname => "Vorname",
            Spalte::Telefon => "Telefon",
            Spalte::Organisation => "Organisation",
            Spalte::Qualifikationen => "Qualifikationen",
            Spalte::Kennung => "Kennung",
            Spalte::Herkunft => "Herkunft",
        }
    }

    /// Aus einer Kopfzelle, ohne Rücksicht auf Groß/klein, Leerraum, `-` und `_`.
    fn aus_kopf(kopf: &str) -> Option<Self> {
        let k: String = kopf
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
            .collect::<String>()
            .to_lowercase();
        Some(match k.as_str() {
            "posten" => Spalte::Posten,
            "abschnitt" | "einsatzabschnitt" => Spalte::Abschnitt,
            "postenart" | "art" => Spalte::PostenArt,
            "beginn" | "von" | "start" => Spalte::Beginn,
            "ende" | "bis" => Spalte::Ende,
            "sollanzahl" | "soll" => Spalte::SollAnzahl,
            "sollqualifikationen" | "sollqualifikation" => Spalte::SollQualifikationen,
            "nachname" | "name" => Spalte::Nachname,
            "vorname" => Spalte::Vorname,
            "telefon" | "tel" | "handy" | "mobil" => Spalte::Telefon,
            "organisation" | "gliederung" => Spalte::Organisation,
            "qualifikationen" | "qualifikation" => Spalte::Qualifikationen,
            "kennung" | "id" | "hiorgid" => Spalte::Kennung,
            "herkunft" | "quelle" => Spalte::Herkunft,
            _ => return None,
        })
    }
}

struct Spalten(HashMap<Spalte, usize>);

impl Spalten {
    fn aus(kopf: &[String], meldungen: &mut Vec<ImportMeldung>) -> Result<Self, AppError> {
        let mut map = HashMap::new();
        for (i, k) in kopf.iter().enumerate() {
            if k.trim().is_empty() {
                continue;
            }
            match Spalte::aus_kopf(k) {
                Some(s) if map.contains_key(&s) => meldungen.push(ImportMeldung::hinweis(
                    Some(1),
                    format!("Spalte „{k}“ steht doppelt; die erste gilt"),
                )),
                Some(s) => {
                    map.insert(s, i);
                }
                None => meldungen.push(ImportMeldung::hinweis(
                    Some(1),
                    format!("Spalte „{k}“ ist unbekannt und bleibt unbeachtet"),
                )),
            }
        }
        for pflicht in [Spalte::Posten, Spalte::Beginn, Spalte::Ende] {
            if !map.contains_key(&pflicht) {
                return Err(AppError::Validation(format!(
                    "Spalte „{}“ fehlt in der Kopfzeile",
                    pflicht.name()
                )));
            }
        }
        Ok(Spalten(map))
    }

    fn zelle<'a>(&self, zeile: &'a [Zelle], s: Spalte) -> &'a Zelle {
        self.0
            .get(&s)
            .and_then(|i| zeile.get(*i))
            .unwrap_or(&Zelle::Leer)
    }

    fn text(&self, zeile: &[Zelle], s: Spalte) -> Option<String> {
        self.zelle(zeile, s).text()
    }
}

// ---------------------------------------------------------------------------------------------
// Werte
// ---------------------------------------------------------------------------------------------

/// Wie eine Zeit gelesen wurde.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ZeitQuelle {
    MitVersatz,
    Ortszeit,
}

const MIT_VERSATZ: &[&str] = &[
    "%Y-%m-%dT%H:%M%:z",
    "%Y-%m-%d %H:%M%:z",
    "%Y-%m-%dT%H:%M:%S%:z",
    "%Y-%m-%d %H:%M:%S%:z",
    "%Y-%m-%dT%H:%M%z",
    "%Y-%m-%dT%H:%M:%S%z",
];

const ORTSZEIT: &[&str] = &[
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%y %H:%M",
];

/// Ortszeit in der Zone als UTC; eine doppelte Stunde nimmt die frühere, eine fehlende ist ein
/// Fehler.
fn ortszeit(t: NaiveDateTime, zone: Tz) -> Result<DateTime<Utc>, String> {
    match zone.from_local_datetime(&t) {
        chrono::LocalResult::Single(z) => Ok(z.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(a, _) => Ok(a.with_timezone(&Utc)),
        chrono::LocalResult::None => Err(format!(
            "{} gibt es in der Zone {zone} nicht (Zeitumstellung)",
            t.format("%d.%m.%Y %H:%M")
        )),
    }
}

fn lies_zeit(zelle: &Zelle, zone: Tz) -> Result<Option<(DateTime<Utc>, ZeitQuelle)>, String> {
    let ort = |t: NaiveDateTime| ortszeit(t, zone).map(|z| Some((z, ZeitQuelle::Ortszeit)));
    match zelle {
        Zelle::Leer => Ok(None),
        Zelle::Zeit(t) => ort(*t),
        Zelle::Zahl(z) => match excel_seriell(*z) {
            Some(t) => ort(t),
            None => Err(format!("„{z}“ ist keine Zeit")),
        },
        Zelle::Text(s) => {
            let s = s.trim();
            if let Ok(t) = DateTime::parse_from_rfc3339(s) {
                return Ok(Some((t.with_timezone(&Utc), ZeitQuelle::MitVersatz)));
            }
            if let Some(rest) = s.strip_suffix('Z') {
                for f in ORTSZEIT {
                    if let Ok(t) = NaiveDateTime::parse_from_str(rest, f) {
                        return Ok(Some((t.and_utc(), ZeitQuelle::MitVersatz)));
                    }
                }
            }
            for f in MIT_VERSATZ {
                if let Ok(t) = DateTime::parse_from_str(s, f) {
                    return Ok(Some((t.with_timezone(&Utc), ZeitQuelle::MitVersatz)));
                }
            }
            for f in ORTSZEIT {
                if let Ok(t) = NaiveDateTime::parse_from_str(s, f) {
                    return ort(t);
                }
            }
            Err(format!("„{s}“ ist keine lesbare Zeit"))
        }
    }
}

fn lies_ganzzahl(zelle: &Zelle) -> Result<Option<i64>, String> {
    match zelle {
        Zelle::Leer => Ok(None),
        Zelle::Zahl(z) if z.fract() == 0.0 && z.abs() < 1e9 => Ok(Some(*z as i64)),
        Zelle::Text(t) => t
            .trim()
            .parse::<i64>()
            .map(Some)
            .map_err(|_| format!("„{t}“ ist keine ganze Zahl")),
        andere => Err(format!(
            "„{}“ ist keine ganze Zahl",
            andere.text().unwrap_or_default()
        )),
    }
}

/// Liste in einer Zelle: Komma oder Semikolon trennt, leere Teile fallen weg.
fn liste(text: &str) -> Vec<String> {
    text.split([',', ';'])
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect()
}

/// „1 Rettungssanitäter, 2× Sanitäter, Fahrer C1“: Anzahl vorn, ohne Anzahl 1.
fn lies_quali_soll(text: &str) -> Result<Vec<PaketQualiSoll>, String> {
    let mut eintraege: Vec<PaketQualiSoll> = Vec::new();
    for teil in liste(text) {
        let ziffern: String = teil.chars().take_while(char::is_ascii_digit).collect();
        let (anzahl, rest) = if ziffern.is_empty() {
            (1, teil.as_str())
        } else {
            let rest = teil[ziffern.len()..].trim_start();
            let rest = rest
                .strip_prefix(['x', 'X', '×', '*'])
                .unwrap_or(rest)
                .trim_start();
            (ziffern.parse::<i64>().unwrap_or(0), rest)
        };
        if rest.is_empty() {
            return Err(format!("„{teil}“ nennt keine Qualifikation"));
        }
        if !(1..=QUALI_SOLL_ANZAHL_MAX).contains(&anzahl) {
            return Err(format!(
                "Anzahl je Qualifikation: 1 bis {QUALI_SOLL_ANZAHL_MAX}"
            ));
        }
        let q = QualiAngabe::Bezeichnung(rest.to_string());
        match eintraege.iter_mut().find(|e| e.qualifikation == q) {
            Some(e) => e.anzahl = e.anzahl.max(anzahl),
            None => eintraege.push(PaketQualiSoll {
                qualifikation: q,
                anzahl,
            }),
        }
    }
    if eintraege.len() > QUALI_SOLL_MAX {
        return Err(format!(
            "Höchstens {QUALI_SOLL_MAX} Qualifikationen im Soll"
        ));
    }
    Ok(eintraege)
}

fn quali_soll_schluessel(q: &[PaketQualiSoll]) -> Vec<(String, i64)> {
    let mut v: Vec<(String, i64)> = q
        .iter()
        .map(|e| match &e.qualifikation {
            QualiAngabe::Bezeichnung(b) => (norm(b), e.anzahl),
            QualiAngabe::Id(id) => (id.to_string(), e.anzahl),
        })
        .collect();
    v.sort();
    v
}

fn lies_art(text: Option<&str>, posten: Option<&str>) -> Result<PaketPostenArt, String> {
    match text.map(norm).as_deref() {
        None | Some("") => Ok(if posten.map(norm).as_deref() == Some("pause") {
            PaketPostenArt::Pause
        } else {
            PaketPostenArt::Einheit
        }),
        Some("einheit") | Some("trupp") | Some("streife") => Ok(PaketPostenArt::Einheit),
        Some("fahrzeug") => Ok(PaketPostenArt::Fahrzeug),
        Some("uhs") | Some("unfallhilfsstelle") => Ok(PaketPostenArt::Uhs),
        Some("pause") => Ok(PaketPostenArt::Pause),
        Some(_) => Err(format!(
            "Posten-Art „{}“: erlaubt sind Einheit, Fahrzeug, UHS, Pause",
            text.unwrap_or_default()
        )),
    }
}

fn hoechstens(text: Option<String>, max: usize, feld: &str) -> Result<Option<String>, String> {
    match text {
        Some(t) if t.chars().count() > max => {
            Err(format!("{feld} darf höchstens {max} Zeichen lang sein"))
        }
        t => Ok(t),
    }
}

// ---------------------------------------------------------------------------------------------
// Paket
// ---------------------------------------------------------------------------------------------

/// Eine geprüfte Zeile.
struct Zeile {
    nr: u32,
    art: PaketPostenArt,
    posten: String,
    abschnitt: Option<String>,
    von: DateTime<Utc>,
    bis: DateTime<Utc>,
    soll_anzahl: Option<i64>,
    quali_soll: Option<Vec<PaketQualiSoll>>,
    person: Option<PersonAngabe>,
    ortszeit: bool,
}

fn pruefe_zeile(
    sp: &Spalten,
    nr: u32,
    z: &[Zelle],
    zone: Tz,
    meldungen: &mut Vec<ImportMeldung>,
) -> Result<Zeile, String> {
    let posten_text = sp.text(z, Spalte::Posten);
    let art = lies_art(
        sp.text(z, Spalte::PostenArt).as_deref(),
        posten_text.as_deref(),
    )?;
    let (posten, abschnitt) = if art == PaketPostenArt::Pause {
        (String::new(), None)
    } else {
        let p = posten_text.ok_or("Posten fehlt")?;
        (
            hoechstens(Some(p), POSTEN_TEXT_MAX, "Posten")?.unwrap_or_default(),
            hoechstens(sp.text(z, Spalte::Abschnitt), POSTEN_TEXT_MAX, "Abschnitt")?,
        )
    };
    let (von, q1) = lies_zeit(sp.zelle(z, Spalte::Beginn), zone)?.ok_or("Beginn fehlt")?;
    let (bis, q2) = lies_zeit(sp.zelle(z, Spalte::Ende), zone)?.ok_or("Ende fehlt")?;
    for t in [von, bis] {
        if !crate::zeit::JAHRE.contains(&chrono::Datelike::year(&t)) {
            return Err(format!(
                "Zeiten liegen zwischen den Jahren {} und {}",
                crate::zeit::JAHRE.start(),
                crate::zeit::JAHRE.end()
            ));
        }
    }
    if bis <= von {
        return Err("Ende liegt nicht nach dem Beginn".into());
    }
    zerlegung::pruefe_zeitraum(von, bis).map_err(|e| e.to_string())?;

    let soll_anzahl = lies_ganzzahl(sp.zelle(z, Spalte::SollAnzahl))?;
    if let Some(n) = soll_anzahl {
        if !(1..=SOLL_ANZAHL_MAX).contains(&n) {
            return Err(format!("Soll-Anzahl: 1 bis {SOLL_ANZAHL_MAX}"));
        }
    }
    let quali_soll = sp
        .text(z, Spalte::SollQualifikationen)
        .map(|t| lies_quali_soll(&t))
        .transpose()?;
    if art == PaketPostenArt::Pause && (soll_anzahl.is_some() || quali_soll.is_some()) {
        meldungen.push(ImportMeldung::hinweis(
            Some(nr),
            "Die Pause hat kein Soll; die Angabe bleibt unbeachtet",
        ));
    }
    let (soll_anzahl, quali_soll) = if art == PaketPostenArt::Pause {
        (None, None)
    } else {
        (soll_anzahl, quali_soll)
    };

    let nachname = sp.text(z, Spalte::Nachname);
    let vorname = sp.text(z, Spalte::Vorname);
    let person = match (nachname, vorname) {
        (None, None) => None,
        (None, Some(_)) => return Err("Nachname fehlt".into()),
        (Some(nachname), vorname) => {
            let quals = sp
                .text(z, Spalte::Qualifikationen)
                .map(|t| liste(&t))
                .unwrap_or_default();
            if quals.len() > HELFER_QUALIFIKATIONEN_MAX {
                return Err(format!(
                    "Höchstens {HELFER_QUALIFIKATIONEN_MAX} Qualifikationen je Person"
                ));
            }
            let kennung = hoechstens(sp.text(z, Spalte::Kennung), KENNUNG_MAX, "Kennung")?;
            let herkunft = hoechstens(sp.text(z, Spalte::Herkunft), HERKUNFT_MAX, "Herkunft")?
                .filter(|_| kennung.is_some());
            let a = PersonAngabe {
                schluessel: String::new(),
                nachname,
                vorname,
                telefon: hoechstens(sp.text(z, Spalte::Telefon), HELFER_TELEFON_MAX, "Telefon")?,
                organisation: hoechstens(
                    sp.text(z, Spalte::Organisation),
                    HELFER_TEXT_MAX,
                    "Organisation",
                )?,
                qualifikationen: quals.into_iter().map(QualiAngabe::Bezeichnung).collect(),
                kennung,
                herkunft,
                zeilen: vec![nr],
            };
            if a.anzeigename().chars().count() > HELFER_TEXT_MAX {
                return Err(format!(
                    "Name darf höchstens {HELFER_TEXT_MAX} Zeichen lang sein"
                ));
            }
            Some(a)
        }
    };
    Ok(Zeile {
        nr,
        art,
        posten,
        abschnitt,
        von,
        bis,
        soll_anzahl,
        quali_soll,
        person,
        ortszeit: q1 == ZeitQuelle::Ortszeit || q2 == ZeitQuelle::Ortszeit,
    })
}

/// Schlüssel einer Person: Kennung mit Herkunft, sonst Name mit Telefon.
fn person_schluessel(a: &PersonAngabe) -> String {
    match a.kennung.as_deref() {
        Some(k) => format!("k|{}|{}", herkunft_norm(a.herkunft.as_deref()), k.trim()),
        None => format!(
            "n|{}|{}",
            norm(&a.anzeigename()),
            a.telefon.as_deref().map(telefon_norm).unwrap_or_default()
        ),
    }
}

/// Liest eine Datei in ein Paket. Die Zone des Einsatzes gilt für Zeiten ohne Versatz.
pub fn lies_paket(bytes: &[u8], zone: Tz) -> Result<(PlanPaket, Vec<ImportMeldung>), AppError> {
    let tabelle = lies_tabelle(bytes)?;
    let mut meldungen = tabelle.meldungen;
    let sp = Spalten::aus(&tabelle.kopf, &mut meldungen)?;

    let mut paket = PlanPaket::default();
    let mut posten_index: HashMap<(PaketPostenArt, String, String), usize> = HashMap::new();
    let mut block_index: HashMap<(usize, DateTime<Utc>, DateTime<Utc>), usize> = HashMap::new();
    let mut person_index: HashMap<String, usize> = HashMap::new();
    let mut ortszeit_zeilen: Vec<u32> = Vec::new();

    for (nr, z) in &tabelle.zeilen {
        if z.iter().all(|c| *c == Zelle::Leer) {
            continue;
        }
        let zeile = match pruefe_zeile(&sp, *nr, z, zone, &mut meldungen) {
            Ok(zeile) => zeile,
            Err(grund) => {
                meldungen.push(ImportMeldung::fehler(Some(*nr), grund));
                continue;
            }
        };
        if zeile.ortszeit {
            ortszeit_zeilen.push(zeile.nr);
        }

        // Posten
        let pk = (
            zeile.art,
            norm(&zeile.posten),
            zeile.abschnitt.as_deref().map(norm).unwrap_or_default(),
        );
        let pi = *posten_index.entry(pk).or_insert_with(|| {
            paket.posten.push(PaketPosten {
                schluessel: format!("p{}", paket.posten.len() + 1),
                art: zeile.art,
                name: zeile.posten.clone(),
                abschnitt: zeile.abschnitt.clone(),
                einheit_vorlage_id: None,
                fahrzeug_id: None,
                uhs_typ: None,
                sortier: None,
                zeilen: Vec::new(),
            });
            paket.posten.len() - 1
        });
        paket.posten[pi].zeilen.push(zeile.nr);

        // Block
        let bk = (pi, zeile.von, zeile.bis);
        let bi = match block_index.get(&bk) {
            Some(bi) => {
                let b = &mut paket.bloecke[*bi];
                let widerspruch = match (b.soll_anzahl, zeile.soll_anzahl) {
                    (Some(a), Some(n)) => a != n,
                    _ => false,
                } || match (&b.quali_soll, &zeile.quali_soll) {
                    (Some(a), Some(n)) => quali_soll_schluessel(a) != quali_soll_schluessel(n),
                    _ => false,
                };
                if widerspruch {
                    meldungen.push(ImportMeldung::fehler(
                        Some(zeile.nr),
                        format!(
                            "Das Soll widerspricht Zeile {} derselben Schicht",
                            b.zeile.unwrap_or(0)
                        ),
                    ));
                    continue;
                }
                if b.soll_anzahl.is_none() {
                    b.soll_anzahl = zeile.soll_anzahl;
                }
                if b.quali_soll.is_none() {
                    b.quali_soll = zeile.quali_soll.clone();
                }
                *bi
            }
            None => {
                paket.bloecke.push(PaketBlock {
                    posten: paket.posten[pi].schluessel.clone(),
                    von: crate::zeit::formatiere_utc(zeile.von),
                    bis: crate::zeit::formatiere_utc(zeile.bis),
                    soll_anzahl: zeile.soll_anzahl,
                    quali_soll: zeile.quali_soll.clone(),
                    notiz: None,
                    personen: Vec::new(),
                    zeile: Some(zeile.nr),
                });
                block_index.insert(bk, paket.bloecke.len() - 1);
                paket.bloecke.len() - 1
            }
        };

        // Person
        let Some(mut angabe) = zeile.person else {
            continue;
        };
        let schluessel_inhalt = person_schluessel(&angabe);
        let mi = match person_index.get(&schluessel_inhalt) {
            Some(mi) => {
                let PaketPerson::Angabe(bisher) = &mut paket.personen[*mi] else {
                    unreachable!("die Datei kennt nur Angaben");
                };
                if norm(&bisher.anzeigename()) != norm(&angabe.anzeigename()) {
                    meldungen.push(ImportMeldung::hinweis(
                        Some(zeile.nr),
                        format!(
                            "Kennung „{}“ steht auch mit dem Namen „{}“; der erste gilt",
                            angabe.kennung.as_deref().unwrap_or_default(),
                            bisher.anzeigename()
                        ),
                    ));
                }
                if bisher.telefon.is_none() {
                    bisher.telefon = angabe.telefon.take();
                }
                if bisher.organisation.is_none() {
                    bisher.organisation = angabe.organisation.take();
                }
                for q in angabe.qualifikationen {
                    if !bisher.qualifikationen.contains(&q)
                        && bisher.qualifikationen.len() < HELFER_QUALIFIKATIONEN_MAX
                    {
                        bisher.qualifikationen.push(q);
                    }
                }
                bisher.zeilen.push(zeile.nr);
                *mi
            }
            None => {
                angabe.schluessel = format!("m{}", paket.personen.len() + 1);
                paket.personen.push(PaketPerson::Angabe(angabe));
                person_index.insert(schluessel_inhalt, paket.personen.len() - 1);
                paket.personen.len() - 1
            }
        };
        let ms = paket.personen[mi].schluessel().to_string();
        let block = &mut paket.bloecke[bi];
        if !block.personen.contains(&ms) {
            block.personen.push(ms);
        }
    }

    if let Some(erste) = ortszeit_zeilen.first() {
        meldungen.push(ImportMeldung::hinweis(
            Some(*erste),
            format!(
                "{} {} ohne Zone als Ortszeit ({zone}) gelesen",
                ortszeit_zeilen.len(),
                if ortszeit_zeilen.len() == 1 {
                    "Zeile"
                } else {
                    "Zeilen"
                }
            ),
        ));
    }
    if paket.bloecke.is_empty()
        && !meldungen
            .iter()
            .any(|m| m.stufe == super::MeldungStufe::Fehler)
    {
        return Err(AppError::Validation(
            "Die Datei enthält keine Schicht".into(),
        ));
    }
    Ok((paket, meldungen))
}

/// Bytes einer Datei aus einem Lesestrom, höchstens [`DATEI_MAX_BYTES`] (400 darüber).
pub fn begrenzt_lesen(mut r: impl Read) -> Result<Vec<u8>, AppError> {
    let mut puffer = Vec::new();
    r.by_ref()
        .take(DATEI_MAX_BYTES as u64 + 1)
        .read_to_end(&mut puffer)
        .map_err(|_| unlesbar("Datei"))?;
    if puffer.len() > DATEI_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "Die Datei ist größer als {} MB",
            DATEI_MAX_BYTES / (1024 * 1024)
        )));
    }
    Ok(puffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abloesung::schichtplan::uebernahme::MeldungStufe;

    const BERLIN: Tz = chrono_tz::Europe::Berlin;

    fn csv(text: &str) -> (PlanPaket, Vec<ImportMeldung>) {
        lies_paket(text.as_bytes(), BERLIN).expect("lesbar")
    }

    fn fehler(m: &[ImportMeldung]) -> Vec<(Option<u32>, String)> {
        m.iter()
            .filter(|m| m.stufe == MeldungStufe::Fehler)
            .map(|m| (m.zeile, m.text.clone()))
            .collect()
    }

    #[test]
    fn csv_mit_semikolon_bom_und_anfuehrungszeichen() {
        let text = "\u{feff}Posten;Abschnitt;Beginn;Ende;Soll-Anzahl;Nachname;Vorname;Qualifikationen\r\n\
            Streife 1;Festmeile;2026-08-15T14:00+02:00;2026-08-15T16:00+02:00;2;Muster;Mia;\"Sanitäter, Truppführer\"\r\n\
            Streife 1;Festmeile;2026-08-15T14:00+02:00;2026-08-15T16:00+02:00;;Probe;Emil;Rettungssanitäter\r\n";
        let (p, m) = csv(text);
        assert!(fehler(&m).is_empty(), "{m:?}");
        assert_eq!(p.posten.len(), 1);
        assert_eq!(p.posten[0].abschnitt.as_deref(), Some("Festmeile"));
        assert_eq!(p.bloecke.len(), 1);
        let b = &p.bloecke[0];
        assert_eq!(
            (b.von.as_str(), b.bis.as_str()),
            ("2026-08-15 12:00:00", "2026-08-15 14:00:00")
        );
        assert_eq!(b.soll_anzahl, Some(2));
        assert_eq!(b.personen, vec!["m1".to_string(), "m2".to_string()]);
        let PaketPerson::Angabe(a) = &p.personen[0] else {
            panic!()
        };
        assert_eq!(a.qualifikationen.len(), 2);
    }

    #[test]
    fn komma_als_trennzeichen_und_zeit_ohne_zone() {
        let text = "Posten,Beginn,Ende\nUHS Markt,2026-08-15 14:00,15.08.2026 18:00\n";
        let (p, m) = csv(text);
        assert_eq!(p.bloecke[0].von, "2026-08-15 12:00:00");
        assert_eq!(p.bloecke[0].bis, "2026-08-15 16:00:00");
        assert!(m
            .iter()
            .any(|m| m.stufe == MeldungStufe::Hinweis && m.text.contains("Ortszeit")));
    }

    #[test]
    fn windows_1252_wird_gelesen() {
        let bytes =
            b"Posten;Beginn;Ende;Nachname\nB\xfchne;2026-08-15 14:00;2026-08-15 16:00;M\xfcller\n"
                .to_vec();
        let (p, m) = lies_paket(&bytes, BERLIN).unwrap();
        assert_eq!(p.posten[0].name, "Bühne");
        assert!(m.iter().any(|m| m.text.contains("Windows-1252")));
    }

    #[test]
    fn pflichtspalte_fehlt_ist_400() {
        let e = lies_paket(b"Posten;Beginn\nA;2026-08-15 14:00\n", BERLIN).unwrap_err();
        assert!(matches!(e, AppError::Validation(t) if t.contains("Ende")));
    }

    #[test]
    fn fehlerhafte_zeilen_fallen_heraus_und_stehen_als_fehler() {
        let text = "Posten;Beginn;Ende;Soll-Anzahl;Posten-Art\n\
            A;2026-08-15 14:00;2026-08-15 14:05;;\n\
            A;2026-08-15 14:02;2026-08-15 15:00;;\n\
            A;2026-08-15 14:00;2026-08-15 16:00;0;\n\
            A;morgen;2026-08-15 16:00;;\n\
            A;2026-08-15 14:00;2026-08-15 16:00;;Zelt\n\
            ;2026-08-15 14:00;2026-08-15 16:00;;\n\
            A;2026-08-15 16:00;2026-08-15 18:00;;\n";
        let (p, m) = csv(text);
        let f = fehler(&m);
        assert_eq!(
            f.iter().map(|(z, _)| z.unwrap()).collect::<Vec<_>>(),
            vec![2, 3, 4, 5, 6, 7]
        );
        assert_eq!(p.bloecke.len(), 1);
    }

    #[test]
    fn widerspruechliches_soll_ist_ein_fehler() {
        let text = "Posten;Beginn;Ende;Soll-Anzahl;Nachname\n\
            A;2026-08-15 14:00;2026-08-15 16:00;2;X\n\
            A;2026-08-15 14:00;2026-08-15 16:00;3;Y\n";
        let (p, m) = csv(text);
        assert_eq!(fehler(&m).len(), 1);
        assert_eq!(p.bloecke[0].personen.len(), 1);
    }

    #[test]
    fn pause_ohne_posten_und_person_ueber_kennung_zusammengefasst() {
        let text = "Posten;Posten-Art;Beginn;Ende;Nachname;Vorname;Telefon;Kennung;Herkunft\n\
            ;Pause;2026-08-15 16:00;2026-08-15 16:30;Neu;Nina;;4711;HiOrg\n\
            Streife 2;;2026-08-15 16:30;2026-08-15 18:30;Neu;Nina;0170 9;4711;hiorg\n\
            Pause;;2026-08-15 18:30;2026-08-15 19:00;Neu;Nina;;4711;HiOrg\n";
        let (p, m) = csv(text);
        assert!(fehler(&m).is_empty(), "{m:?}");
        assert_eq!(p.posten.len(), 2);
        assert_eq!(p.posten[0].art, PaketPostenArt::Pause);
        assert_eq!(p.personen.len(), 1);
        let PaketPerson::Angabe(a) = &p.personen[0] else {
            panic!()
        };
        assert_eq!(a.telefon.as_deref(), Some("0170 9"));
        assert_eq!(a.zeilen, vec![2, 3, 4]);
    }

    #[test]
    fn quali_soll_mit_und_ohne_anzahl() {
        let q = lies_quali_soll("1 Rettungssanitäter, 2× Sanitäter; Fahrer C1").unwrap();
        assert_eq!(
            q.iter()
                .map(|e| (e.qualifikation.clone(), e.anzahl))
                .collect::<Vec<_>>(),
            vec![
                (QualiAngabe::Bezeichnung("Rettungssanitäter".into()), 1),
                (QualiAngabe::Bezeichnung("Sanitäter".into()), 2),
                (QualiAngabe::Bezeichnung("Fahrer C1".into()), 1),
            ]
        );
        assert!(lies_quali_soll("0 Sanitäter").is_err());
        assert!(lies_quali_soll("3").is_err());
    }

    #[test]
    fn zeitumstellung_doppelte_stunde_frueher_fehlende_fehler() {
        // 25.10.2026: 02:00–03:00 doppelt; 29.03.2026: 02:00–03:00 fehlt.
        let z = lies_zeit(&Zelle::Text("2026-10-25 02:30".into()), BERLIN)
            .unwrap()
            .unwrap();
        assert_eq!(crate::zeit::formatiere_utc(z.0), "2026-10-25 00:30:00");
        assert!(lies_zeit(&Zelle::Text("2026-03-29 02:30".into()), BERLIN).is_err());
    }

    #[test]
    fn excel_seriennummer() {
        // 45943.5 = 13.10.2025 12:00
        assert_eq!(
            excel_seriell(45943.5).unwrap(),
            NaiveDate::from_ymd_opt(2025, 10, 13)
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap()
        );
        // Fließkomma knapp unter der vollen Minute rundet richtig.
        let fast = 45943.5 + 14.0 / 24.0 / 60.0 - 1e-9;
        assert_eq!(
            excel_seriell(fast).unwrap().format("%H:%M:%S").to_string(),
            "12:14:00"
        );
    }

    #[test]
    fn zu_gross_und_leer_sind_400() {
        assert!(lies_tabelle(&vec![b'a'; DATEI_MAX_BYTES + 1]).is_err());
        assert!(lies_tabelle(b"  \n").is_err());
        assert!(lies_tabelle(b"PK\x03\x04kaputt").is_err());
    }
}
