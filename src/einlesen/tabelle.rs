//! Tabellen lesen: CSV oder XLSX in eine [`Tabelle`] aus Kopf und Zeilen (LLH-1556, LLH-1633).
//!
//! Gemeinsam für die Schichtplan-Übernahme und das Stammdaten-Eingangstor. Die Grenzen
//! ([`DATEI_MAX_BYTES`], [`ZEILEN_MAX`], [`XLSX_ENTPACKT_MAX_BYTES`]) stehen hier; die
//! Übernahme führt sie unter ihren alten Pfaden weiter.

use std::io::Cursor;

use chrono::{NaiveDate, NaiveDateTime};

use super::namen::norm;
use crate::abloesung::schichtplan::uebernahme::ImportMeldung;
use crate::error::AppError;

/// Größte Datei in Bytes (400 darüber). Spiegel: `SCHICHTPLAN_DATEI_MAX_BYTES` in
/// `frontend/src/api/eingabegrenzen.ts`.
pub const DATEI_MAX_BYTES: usize = 2 * 1024 * 1024;

/// Größte Zahl an Zeilen einer Datei ohne Kopfzeile (400 darüber).
pub const ZEILEN_MAX: usize = 5_000;

/// Entpackte Größe aller Teile einer XLSX (400 darüber): schützt vor einer Zip-Bombe.
pub const XLSX_ENTPACKT_MAX_BYTES: u64 = 64 * 1024 * 1024;

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
    pub fn text(&self) -> Option<String> {
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
    /// Tage, die eine Zahl der Mappe zur Excel-Seriennummer des 1900-Systems fehlen: 1462 bei
    /// einer Mappe im 1904-Datumssystem (ältere Mac-Excel), sonst 0.
    pub serien_versatz: f64,
}

fn unlesbar(was: &str) -> AppError {
    AppError::Validation(format!("Die Datei ist keine lesbare {was}"))
}

/// Größe und Leere prüfen; für alle Einstiege gleich.
fn pruefe_eingang(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() > DATEI_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "Die Datei ist größer als {} MB",
            DATEI_MAX_BYTES / (1024 * 1024)
        )));
    }
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Err(AppError::Validation("Die Datei ist leer".into()));
    }
    Ok(())
}

fn pruefe_zeilen(tabelle: &Tabelle, zeilen_max: usize) -> Result<(), AppError> {
    if tabelle.zeilen.len() > zeilen_max {
        return Err(AppError::Validation(format!(
            "Die Datei hat mehr als {zeilen_max} Zeilen"
        )));
    }
    Ok(())
}

/// Liest CSV oder XLSX (am Inhalt erkannt). Zu groß, zu viele Zeilen oder unlesbar: 400.
pub fn lies_tabelle(bytes: &[u8]) -> Result<Tabelle, AppError> {
    pruefe_eingang(bytes)?;
    let tabelle = if bytes.starts_with(b"PK\x03\x04") {
        lies_xlsx(bytes)?
    } else {
        lies_csv(bytes)?
    };
    pruefe_zeilen(&tabelle, ZEILEN_MAX)?;
    Ok(tabelle)
}

/// Liest alle Blätter einer XLSX mit ihrem Namen, in der Reihenfolge der Mappe; eine CSV ist ein
/// Eintrag mit dem Namen `""`. `zeilen_max` gilt je Blatt (ohne Kopfzeile); Größen- und
/// Zip-Grenzen wie bei [`lies_tabelle`]. Ein leeres Blatt ist eine leere [`Tabelle`], kein Fehler.
pub fn lies_blaetter(bytes: &[u8], zeilen_max: usize) -> Result<Vec<(String, Tabelle)>, AppError> {
    use calamine::{Reader, Xlsx};
    pruefe_eingang(bytes)?;
    if !bytes.starts_with(b"PK\x03\x04") {
        let tabelle = lies_csv(bytes)?;
        pruefe_zeilen(&tabelle, zeilen_max)?;
        return Ok(vec![(String::new(), tabelle)]);
    }
    pruefe_entpackt(bytes)?;
    let mut mappe: Xlsx<_> =
        calamine::open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| unlesbar("XLSX"))?;
    let mut ergebnis = Vec::new();
    for name in mappe.sheet_names() {
        let tabelle = lies_blatt(&mut mappe, &name, zeilen_max)?;
        ergebnis.push((name, tabelle));
    }
    Ok(ergebnis)
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
        serien_versatz: 0.0,
    })
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

/// Tage zwischen den Epochen des 1900- und des 1904-Datumssystems von Excel.
pub(crate) const EPOCHE_1904_TAGE: f64 = 1462.0;

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

/// Spalten einer XLSX, die gelesen werden; eine Zelle weiter rechts ist ein Fehler.
const XLSX_SPALTEN_MAX: u32 = 100;

/// Liest eine XLSX: das Blatt „Austausch“ (Export der Suite, IDA-365), sonst das erste.
pub(crate) fn lies_xlsx(bytes: &[u8]) -> Result<Tabelle, AppError> {
    use calamine::{Reader, Xlsx};
    pruefe_entpackt(bytes)?;
    let mut mappe: Xlsx<_> =
        calamine::open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| unlesbar("XLSX"))?;
    let namen = mappe.sheet_names();
    let blatt = namen
        .iter()
        .find(|n| norm(n) == "austausch")
        .or_else(|| namen.first())
        .cloned()
        .ok_or_else(|| unlesbar("XLSX"))?;
    let tabelle = lies_blatt(&mut mappe, &blatt, ZEILEN_MAX)?;
    if tabelle.kopf.is_empty() {
        return Err(AppError::Validation("Die Datei ist leer".into()));
    }
    Ok(tabelle)
}

/// Liest ein Blatt Zelle für Zelle. `worksheet_range` legte eine dichte Tabelle bis zur letzten
/// belegten Zelle an: eine einzelne Zelle in XFD1048576 kostete Gigabyte. Gezählt werden deshalb
/// Spalten (höchstens [`XLSX_SPALTEN_MAX`]) und belegte Zeilen (höchstens `zeilen_max` plus
/// Kopf), bevor etwas wächst. Ein Blatt ohne Zellen ergibt eine leere [`Tabelle`].
fn lies_blatt<RS: std::io::Read + std::io::Seek>(
    mappe: &mut calamine::Xlsx<RS>,
    blatt: &str,
    zeilen_max: usize,
) -> Result<Tabelle, AppError> {
    use calamine::DataRef;
    use std::collections::BTreeMap;
    let serien_versatz = if mappe.has_1904_epoch() {
        EPOCHE_1904_TAGE
    } else {
        0.0
    };
    let zelle = |d: &DataRef| -> Zelle {
        let text = |t: &str| {
            let t = t.trim();
            if t.is_empty() {
                Zelle::Leer
            } else {
                Zelle::Text(t.to_string())
            }
        };
        match d {
            DataRef::Empty | DataRef::Error(_) => Zelle::Leer,
            DataRef::Int(i) => Zelle::Zahl(*i as f64),
            DataRef::Float(f) => Zelle::Zahl(*f),
            DataRef::String(s) | DataRef::DateTimeIso(s) | DataRef::DurationIso(s) => text(s),
            DataRef::SharedString(s) => text(s),
            DataRef::Bool(b) => Zelle::Text(b.to_string()),
            DataRef::DateTime(dt) if dt.is_datetime() => {
                excel_seriell(dt.as_f64() + serien_versatz)
                    .map(Zelle::Zeit)
                    .unwrap_or(Zelle::Zahl(dt.as_f64()))
            }
            DataRef::DateTime(dt) => Zelle::Zahl(dt.as_f64()),
        }
    };
    // Zeile (0-basiert) → belegte Zellen mit Spalte.
    let mut belegt: BTreeMap<u32, Vec<(u32, Zelle)>> = BTreeMap::new();
    let mut breite: u32 = 0;
    let mut text_bytes: u64 = 0;
    {
        let mut leser = mappe
            .worksheet_cells_reader(blatt)
            .map_err(|_| unlesbar("XLSX"))?;
        while let Some(c) = leser.next_cell().map_err(|_| unlesbar("XLSX"))? {
            let (zeile, spalte) = c.get_position();
            // Eine Position zweimal umginge die Grenzen unten.
            if belegt
                .get(&zeile)
                .is_some_and(|zellen| zellen.iter().any(|(s, _)| *s == spalte))
            {
                return Err(AppError::Validation(
                    "Die Datei enthält eine Zelle doppelt".into(),
                ));
            }
            let z = zelle(c.get_value());
            if matches!(z, Zelle::Leer) {
                continue;
            }
            // Viele Zellen auf einen langen gemeinsamen Text vervielfachten ihn im Speicher.
            if let Zelle::Text(t) = &z {
                text_bytes = text_bytes.saturating_add(t.len() as u64);
                if text_bytes > XLSX_ENTPACKT_MAX_BYTES {
                    return Err(AppError::Validation("Die XLSX ist entpackt zu groß".into()));
                }
            }
            if spalte >= XLSX_SPALTEN_MAX {
                return Err(AppError::Validation(format!(
                    "Die Datei hat mehr als {XLSX_SPALTEN_MAX} Spalten"
                )));
            }
            if !belegt.contains_key(&zeile) && belegt.len() > zeilen_max {
                return Err(AppError::Validation(format!(
                    "Die Datei hat mehr als {zeilen_max} Zeilen"
                )));
            }
            breite = breite.max(spalte + 1);
            belegt.entry(zeile).or_default().push((spalte, z));
        }
    }
    let ausbreiten = |zellen: Vec<(u32, Zelle)>| -> Vec<Zelle> {
        let mut reihe = vec![Zelle::Leer; breite as usize];
        for (spalte, z) in zellen {
            reihe[spalte as usize] = z;
        }
        reihe
    };
    let mut reihen = belegt.into_iter();
    let Some((_, kopf_zellen)) = reihen.next() else {
        return Ok(Tabelle {
            serien_versatz,
            ..Tabelle::default()
        });
    };
    let kopf = ausbreiten(kopf_zellen)
        .into_iter()
        .map(|z| z.text().unwrap_or_default())
        .collect();
    let zeilen = reihen.map(|(r, z)| (r + 1, ausbreiten(z))).collect();
    Ok(Tabelle {
        kopf,
        zeilen,
        meldungen: Vec::new(),
        serien_versatz,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_xlsxwriter::Workbook;

    /// Mappe aus Blättern; je Blatt Name und Zeilen (erste Zeile = Kopf).
    fn mappe(blaetter: &[(&str, &[&[&str]])]) -> Vec<u8> {
        let mut wb = Workbook::new();
        for (name, zeilen) in blaetter {
            let ws = wb.add_worksheet();
            ws.set_name(*name).unwrap();
            for (r, zeile) in zeilen.iter().enumerate() {
                for (c, text) in zeile.iter().enumerate() {
                    ws.write_string(r as u32, c as u16, *text).unwrap();
                }
            }
        }
        wb.save_to_buffer().unwrap()
    }

    #[test]
    fn lies_blaetter_xlsx_mehrere_blaetter() {
        let bytes = mappe(&[
            ("Fahrzeuge", &[&["Kennzeichen", "Typ"], &["B-RK 1", "RTW"]]),
            ("Personal", &[&["Nachname", "Vorname"], &["Muster", "Max"]]),
        ]);
        let blaetter = lies_blaetter(&bytes, 10).unwrap();
        let namen: Vec<&str> = blaetter.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(namen, ["Fahrzeuge", "Personal"]);
        assert_eq!(blaetter[0].1.kopf, ["Kennzeichen", "Typ"]);
        assert_eq!(blaetter[1].1.kopf, ["Nachname", "Vorname"]);
        assert_eq!(blaetter[1].1.zeilen.len(), 1);
        assert_eq!(blaetter[1].1.zeilen[0].0, 2);
    }

    #[test]
    fn lies_blaetter_grenze_je_blatt() {
        let drei: &[&[&str]] = &[&["A"], &["1"], &["2"], &["3"]];
        let vier: &[&[&str]] = &[&["A"], &["1"], &["2"], &["3"], &["4"]];
        let ok = mappe(&[("Eins", drei), ("Zwei", drei)]);
        assert_eq!(lies_blaetter(&ok, 3).unwrap().len(), 2);
        let zu_viel = mappe(&[("Eins", drei), ("Zwei", vier)]);
        assert!(matches!(
            lies_blaetter(&zu_viel, 3),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn lies_blaetter_csv_ein_eintrag() {
        let blaetter = lies_blaetter(b"Nachname;Vorname\nMuster;Max\n", 10).unwrap();
        assert_eq!(blaetter.len(), 1);
        assert_eq!(blaetter[0].0, "");
        assert_eq!(blaetter[0].1.kopf, ["Nachname", "Vorname"]);
        assert_eq!(blaetter[0].1.zeilen.len(), 1);
    }

    #[test]
    fn lies_blaetter_leeres_blatt_ist_leere_tabelle() {
        let bytes = mappe(&[("Leer", &[]), ("Voll", &[&["A"], &["1"]])]);
        let blaetter = lies_blaetter(&bytes, 10).unwrap();
        assert!(blaetter[0].1.kopf.is_empty() && blaetter[0].1.zeilen.is_empty());
        assert_eq!(blaetter[1].1.kopf, ["A"]);
    }

    #[test]
    fn lies_blaetter_prueft_die_dateigroesse() {
        assert!(lies_blaetter(&vec![b'a'; DATEI_MAX_BYTES + 1], 10).is_err());
    }
}
