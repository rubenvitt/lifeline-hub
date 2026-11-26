//! Das PDF des Ausgangs (LLH-2095, Design-Doc
//! `docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md`, Abschnitt 6;
//! ADR-0107): A4, schwarz auf weiß, eingebettete Archivo, gebaut aus dem Schnappschuss eines
//! Versands und den PNG-Anlagen der Freigabe. Kein Netz, keine Datenbank, keine Systemschrift.
//!
//! Gedruckt wird weiter nur im Browser (`frontend/src/druck/AGENTS.md`); dieses PDF entsteht nur
//! für den Ausgang (Fax und Anhang der Mail).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use chrono::{DateTime, Utc};
use printpdf::{
    Color, FontId, Greyscale, Line, LinePoint, Mm, Op, ParsedFont, PdfDocument, PdfFontHandle,
    PdfPage, PdfSaveOptions, Point, Pt, RawImage, TextItem, XObject, XObjectId, XObjectTransform,
};

use super::zustand::QuelleArt;

/// Höchstzahl Seiten eines Faxes (nur Fax, Freigabe vom 25.11.2026).
pub const FAX_SEITEN_MAX: usize = 30;
/// Höchstgröße eines Fax-PDFs in Bytes (nur Fax; sipgate nimmt bis etwa 21 MB an).
pub const FAX_BYTES_MAX: usize = 10 * 1024 * 1024;

const ARCHIVO_REGULAR: &[u8] = include_bytes!("../../assets/schriften/Archivo-Regular.ttf");
const ARCHIVO_BOLD: &[u8] = include_bytes!("../../assets/schriften/Archivo-Bold.ttf");

/// Was ins PDF kommt.
pub struct PdfVorlage<'a> {
    /// Absenderkennung der Fax-Anbindung oder Name der Organisation.
    pub absender: &'a str,
    /// Zeit der Erzeugung; erscheint als Ortszeit Europe/Berlin und in den Metadaten.
    pub erzeugt_at: DateTime<Utc>,
    pub uebung: bool,
    pub betreff: &'a str,
    /// Empfänger, etwa „Leitstelle Nord (Fax +49…)“.
    pub an: &'a str,
    pub einsatz: &'a str,
    /// Der Schnappschuss-Text, wie er als Mailtext geht.
    pub inhalt: &'a str,
    /// PNG-Anlagen der Freigabe (Dateiname, Bytes).
    pub anlagen: &'a [(String, Vec<u8>)],
}

/// Ein fertiges PDF.
#[derive(Debug, Clone)]
pub struct PdfDatei {
    pub bytes: Vec<u8>,
    pub seiten: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfFehler {
    /// Anlage `n` (ab 1) ist kein lesbares Bild.
    Bild(usize),
    /// Schrift oder Serialisierung gescheitert (Fehler im Bau, nicht in der Eingabe).
    Erzeugung,
}

/// Ob ein PDF als Fax hinaus darf (Grenze nur für Fax).
pub fn passt_fuer_fax(d: &PdfDatei) -> bool {
    d.seiten <= FAX_SEITEN_MAX && d.bytes.len() <= FAX_BYTES_MAX
}

/// Dateiname des PDFs: `lagebericht-3.pdf`, `befehl-2.pdf`, `nachforderung.pdf`.
pub fn dateiname(quelle: QuelleArt, version: Option<i64>) -> String {
    match version {
        Some(v) => format!("{}-{v}.pdf", quelle.as_str()),
        None => format!("{}.pdf", quelle.as_str()),
    }
}

// Maße in Punkt (1 mm = 72 / 25,4 pt).
const MM: f32 = 72.0 / 25.4;
const A4_KURZ: f32 = 210.0 * MM;
const A4_LANG: f32 = 297.0 * MM;
const RAND: f32 = 20.0 * MM;
/// Unterkante des Satzspiegels; darunter steht nur der Fuß.
const UNTEN: f32 = RAND + 8.0 * MM;
const FUSS_Y: f32 = 12.0 * MM;
const TEXT_PT: f32 = 10.5;
const ZEILE: f32 = 1.3;

/// Eine Schrift mit ihren Breiten.
struct Schrift {
    id: FontId,
    font: ParsedFont,
    einheiten: f32,
}

impl Schrift {
    fn laden(bytes: &[u8], id: &str) -> Result<Self, PdfFehler> {
        let font = ParsedFont::from_bytes(bytes, 0, &mut Vec::new()).ok_or(PdfFehler::Erzeugung)?;
        let einheiten = f32::from(font.pdf_font_metrics.units_per_em.max(1));
        Ok(Schrift {
            id: FontId(id.into()),
            font,
            einheiten,
        })
    }

    fn hat(&self, c: char) -> bool {
        self.font.lookup_glyph_index(c as u32).is_some()
    }

    fn breite(&self, text: &str, groesse: f32) -> f32 {
        text.chars()
            .map(|c| {
                self.font
                    .lookup_glyph_index(c as u32)
                    .and_then(|g| self.font.get_glyph_width(g))
                    .map_or(0.0, f32::from)
            })
            .sum::<f32>()
            / self.einheiten
            * groesse
    }

    /// Ersetzt Zeichen, die die Schrift nicht kennt (Emoji, seltene Zeichen), durch `?`; ein
    /// Tab wird zu vier Leerzeichen, andere Steuerzeichen fallen weg.
    fn saeubern(&self, text: &str) -> String {
        let mut aus = String::with_capacity(text.len());
        for c in text.chars() {
            match c {
                '\t' => aus.push_str("    "),
                c if c.is_control() => {}
                c if self.hat(c) => aus.push(c),
                _ => aus.push('?'),
            }
        }
        aus
    }
}

/// Der Satz: Seiten mit ihren Operationen und der Schreibkopf auf der aktuellen Seite.
struct Satz<'s> {
    normal: &'s Schrift,
    fett: &'s Schrift,
    seiten: Vec<(f32, f32, Vec<Op>)>,
    y: f32,
}

impl<'s> Satz<'s> {
    fn neue_seite(&mut self, breite: f32, hoehe: f32) {
        self.seiten.push((breite, hoehe, Vec::new()));
        self.y = hoehe - RAND;
    }

    fn ops(&mut self) -> &mut Vec<Op> {
        &mut self.seiten.last_mut().expect("eine Seite").2
    }

    fn seitenbreite(&self) -> f32 {
        self.seiten.last().map_or(A4_KURZ, |s| s.0)
    }

    fn text_an(&mut self, x: f32, y: f32, text: &str, fett: bool, groesse: f32) {
        let schrift = if fett { self.fett } else { self.normal };
        let id = schrift.id.clone();
        let text = text.to_string();
        self.ops().extend([
            Op::StartTextSection,
            Op::SetFont {
                font: PdfFontHandle::External(id),
                size: Pt(groesse),
            },
            Op::SetTextCursor {
                pos: Point { x: Pt(x), y: Pt(y) },
            },
            Op::ShowText {
                items: vec![TextItem::Text(text)],
            },
            Op::EndTextSection,
        ]);
    }

    /// Eine Zeile am linken Rand; bricht vorher auf eine neue Seite um, wenn sie nicht mehr passt.
    fn zeile(&mut self, text: &str, fett: bool, groesse: f32) {
        let hoehe = groesse * ZEILE;
        if self.y - hoehe < UNTEN {
            self.neue_seite(A4_KURZ, A4_LANG);
        }
        self.y -= hoehe;
        if !text.is_empty() {
            self.text_an(RAND, self.y, text, fett, groesse);
        }
    }

    /// Ein Absatz, an Wortgrenzen umbrochen; ein Wort breiter als die Zeile bricht hart um.
    fn absatz(&mut self, text: &str, fett: bool, groesse: f32) {
        let schrift = if fett { self.fett } else { self.normal };
        let text = schrift.saeubern(text);
        let max = self.seitenbreite() - 2.0 * RAND;
        for z in umbrechen(schrift, &text, groesse, max) {
            self.zeile(&z, fett, groesse);
        }
    }

    fn abstand(&mut self, pt: f32) {
        self.y -= pt;
    }

    fn linie(&mut self) {
        let y = self.y;
        let x2 = self.seitenbreite() - RAND;
        self.ops().extend([
            Op::SetOutlineColor {
                col: Color::Greyscale(Greyscale {
                    percent: 0.0,
                    icc_profile: None,
                }),
            },
            Op::SetOutlineThickness { pt: Pt(0.8) },
            Op::DrawLine {
                line: Line {
                    points: vec![
                        LinePoint {
                            p: Point {
                                x: Pt(RAND),
                                y: Pt(y),
                            },
                            bezier: false,
                        },
                        LinePoint {
                            p: Point {
                                x: Pt(x2),
                                y: Pt(y),
                            },
                            bezier: false,
                        },
                    ],
                    is_closed: false,
                },
            },
        ]);
    }
}

/// Bricht `text` (ohne Zeilenumbrüche) in Zeilen höchstens `max` pt breit.
fn umbrechen(schrift: &Schrift, text: &str, groesse: f32, max: f32) -> Vec<String> {
    let mut zeilen = Vec::new();
    let mut aktuell = String::new();
    for wort in text.split(' ') {
        let kandidat = if aktuell.is_empty() {
            wort.to_string()
        } else {
            format!("{aktuell} {wort}")
        };
        if schrift.breite(&kandidat, groesse) <= max {
            aktuell = kandidat;
            continue;
        }
        if !aktuell.is_empty() {
            zeilen.push(std::mem::take(&mut aktuell));
        }
        // Das Wort allein: passt es nicht, wird es Zeichen für Zeichen geteilt.
        for c in wort.chars() {
            let mut neu = aktuell.clone();
            neu.push(c);
            if !aktuell.is_empty() && schrift.breite(&neu, groesse) > max {
                zeilen.push(std::mem::take(&mut aktuell));
                aktuell.push(c);
            } else {
                aktuell = neu;
            }
        }
    }
    zeilen.push(aktuell);
    zeilen
}

fn ortszeit(t: DateTime<Utc>) -> String {
    t.with_timezone(&chrono_tz::Europe::Berlin)
        .format("%d.%m.%Y %H:%M")
        .to_string()
}

/// Baut das PDF. Gleiche Vorlage, gleiche Bytes.
pub fn baue_pdf(v: &PdfVorlage<'_>) -> Result<PdfDatei, PdfFehler> {
    let normal = Schrift::laden(ARCHIVO_REGULAR, "F1")?;
    let fett = Schrift::laden(ARCHIVO_BOLD, "F2")?;

    // Bilder zuerst prüfen: eine kaputte Anlage ist ein Fehler der Eingabe.
    let mut bilder = Vec::with_capacity(v.anlagen.len());
    for (n, (_, bytes)) in v.anlagen.iter().enumerate() {
        let bild = RawImage::decode_from_bytes(bytes, &mut Vec::new())
            .map_err(|_| PdfFehler::Bild(n + 1))?;
        if bild.width == 0 || bild.height == 0 {
            return Err(PdfFehler::Bild(n + 1));
        }
        bilder.push(bild);
    }

    let mut satz = Satz {
        normal: &normal,
        fett: &fett,
        seiten: Vec::new(),
        y: 0.0,
    };
    satz.neue_seite(A4_KURZ, A4_LANG);

    // Kopf der ersten Seite.
    let zeit = ortszeit(v.erzeugt_at);
    let kopf = normal.saeubern(v.absender);
    satz.zeile(&kopf, false, 9.0);
    let x_zeit = A4_KURZ - RAND - normal.breite(&zeit, 9.0);
    let y = satz.y;
    satz.text_an(x_zeit, y, &zeit, false, 9.0);
    satz.abstand(6.0);
    if v.uebung {
        satz.zeile("ÜBUNG", true, 20.0);
        satz.abstand(4.0);
    }
    satz.absatz(v.betreff, true, 14.0);
    satz.abstand(4.0);
    satz.absatz(&format!("An: {}", v.an), false, 10.0);
    satz.absatz(&format!("Einsatz: {}", v.einsatz), false, 10.0);
    satz.abstand(6.0);
    satz.linie();
    satz.abstand(8.0);

    // Text: jede Zeile des Schnappschusses ein Absatz, Leerzeilen bleiben.
    for z in v.inhalt.lines() {
        satz.absatz(z, false, TEXT_PT);
    }

    // Anlagen: je eine Seite, quer bei breiten Bildern.
    let mut ids = Vec::with_capacity(bilder.len());
    for (n, bild) in bilder.iter().enumerate() {
        let quer = bild.width > bild.height;
        let (b, h) = if quer {
            (A4_LANG, A4_KURZ)
        } else {
            (A4_KURZ, A4_LANG)
        };
        satz.neue_seite(b, h);
        satz.zeile(&format!("Anlage {}", n + 1), true, 12.0);
        satz.abstand(6.0);
        let frei_b = b - 2.0 * RAND;
        let frei_h = satz.y - UNTEN;
        // Bei dpi 72 ist ein Pixel ein Punkt.
        let s = (frei_b / bild.width as f32).min(frei_h / bild.height as f32);
        let x = RAND + (frei_b - bild.width as f32 * s) / 2.0;
        let y = satz.y - bild.height as f32 * s;
        let id = XObjectId(format!("Im{}", n + 1));
        satz.ops().push(Op::UseXobject {
            id: id.clone(),
            transform: XObjectTransform {
                translate_x: Some(Pt(x)),
                translate_y: Some(Pt(y)),
                rotate: None,
                scale_x: Some(s),
                scale_y: Some(s),
                dpi: Some(72.0),
                ..Default::default()
            },
        });
        ids.push(id);
    }

    // Fuß jeder Seite.
    let gesamt = satz.seiten.len();
    for i in 0..gesamt {
        let fuss = format!("Seite {} von {gesamt} · Lifeline Hub", i + 1);
        let breite = satz.seiten[i].0;
        let x = breite - RAND - normal.breite(&fuss, 8.0);
        let id = normal.id.clone();
        satz.seiten[i].2.extend([
            Op::StartTextSection,
            Op::SetFont {
                font: PdfFontHandle::External(id),
                size: Pt(8.0),
            },
            Op::SetTextCursor {
                pos: Point {
                    x: Pt(x),
                    y: Pt(FUSS_Y),
                },
            },
            Op::ShowText {
                items: vec![TextItem::Text(fuss)],
            },
            Op::EndTextSection,
        ]);
    }

    let seiten: Vec<PdfPage> = satz
        .seiten
        .into_iter()
        .map(|(b, h, ops)| PdfPage::new(Mm(b / MM), Mm(h / MM), ops))
        .collect();

    let mut doc = PdfDocument::new(v.betreff);
    // Eigene, feste IDs statt der zufälligen von `add_font`/`add_image` (Determinismus).
    doc.resources.fonts.map.insert(
        normal.id.clone(),
        printpdf::PdfFont::new(normal.font.clone()),
    );
    doc.resources
        .fonts
        .map
        .insert(fett.id.clone(), printpdf::PdfFont::new(fett.font.clone()));
    for (id, bild) in ids.into_iter().zip(bilder) {
        doc.resources.xobjects.map.insert(id, XObject::Image(bild));
    }
    let zeitpunkt = printpdf::OffsetDateTime::from_unix_timestamp(v.erzeugt_at.timestamp())
        .map_err(|_| PdfFehler::Erzeugung)?;
    let info = &mut doc.metadata.info;
    info.creation_date = zeitpunkt.clone();
    info.modification_date = zeitpunkt.clone();
    info.metadata_date = zeitpunkt;
    info.creator = "Lifeline Hub".into();
    info.producer = "Lifeline Hub".into();
    doc.metadata.xmp = None;
    let mut bytes = doc
        .with_pages(seiten)
        .save(&PdfSaveOptions::default(), &mut Vec::new());

    let mut h = DefaultHasher::new();
    (v.absender, v.betreff, v.an, v.einsatz, v.inhalt, v.uebung).hash(&mut h);
    v.erzeugt_at.timestamp().hash(&mut h);
    for (name, b) in v.anlagen {
        (name, b).hash(&mut h);
    }
    feste_id(&mut bytes, h.finish());
    Ok(PdfDatei {
        bytes,
        seiten: gesamt,
    })
}

/// Ersetzt die zufälligen Zeichenketten der Dokument-ID im Trailer (`/ID [(…)(…)]`) durch eine
/// aus der Eingabe abgeleitete gleicher Länge; die Byte-Offsets der Querverweise bleiben gleich.
fn feste_id(bytes: &mut [u8], hash: u64) {
    let Some(start) = bytes.windows(3).rposition(|w| w == b"/ID") else {
        return;
    };
    let ersatz = format!("{hash:016x}{:016x}", hash.rotate_left(32));
    let ersatz = ersatz.as_bytes();
    let mut i = start + 3;
    for _ in 0..2 {
        let Some(auf) = bytes[i..]
            .iter()
            .position(|b| *b == b'(')
            .map(|p| i + p + 1)
        else {
            return;
        };
        let Some(zu) = bytes[auf..]
            .iter()
            .position(|b| *b == b')')
            .map(|p| auf + p)
        else {
            return;
        };
        for (k, b) in bytes[auf..zu].iter_mut().enumerate() {
            *b = ersatz[k % ersatz.len()];
        }
        i = zu + 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn png(breite: u32, hoehe: u32) -> Vec<u8> {
        let bild = image::RgbImage::from_pixel(breite, hoehe, image::Rgb([20, 20, 20]));
        let mut aus = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(bild)
            .write_to(&mut aus, image::ImageFormat::Png)
            .unwrap();
        aus.into_inner()
    }

    fn vorlage<'a>(inhalt: &'a str, anlagen: &'a [(String, Vec<u8>)]) -> PdfVorlage<'a> {
        PdfVorlage {
            absender: "ELW 1 Kreis Musterstadt",
            erzeugt_at: chrono::Utc
                .with_ymd_and_hms(2026, 11, 25, 16, 40, 0)
                .unwrap(),
            uebung: false,
            betreff: "Lagebericht Nr. 3 – Hochwasser",
            an: "Leitstelle Nord (Fax +49511123456)",
            einsatz: "Hochwasser Musterstadt",
            inhalt,
            anlagen,
        }
    }

    /// Text aller Seiten, wie ein PDF-Leser ihn herausholt.
    fn text(d: &PdfDatei) -> String {
        let doc = printpdf::PdfDocument::parse(
            &d.bytes,
            &printpdf::PdfParseOptions::default(),
            &mut Vec::new(),
        )
        .unwrap();
        doc.extract_text()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn ein_kurzer_text_ergibt_eine_seite() {
        let d = baue_pdf(&vorlage("Lage ruhig.", &[])).unwrap();
        assert_eq!(d.seiten, 1);
        assert!(d.bytes.starts_with(b"%PDF-"));
    }

    #[test]
    fn jede_anlage_bekommt_eine_eigene_seite() {
        let anlagen = vec![
            ("anlage-1.png".to_string(), png(1, 1)),
            ("anlage-2.png".to_string(), png(4000, 1000)),
        ];
        let d = baue_pdf(&vorlage("Lage ruhig.", &anlagen)).unwrap();
        assert_eq!(d.seiten, 3);
        let t = text(&d);
        assert!(t.contains("Anlage 1"), "{t}");
        assert!(t.contains("Anlage 2"), "{t}");
    }

    #[test]
    fn umlaute_und_eszett_stehen_im_pdf() {
        let d = baue_pdf(&vorlage("Größe Übergabe Straße", &[])).unwrap();
        let t = text(&d);
        assert!(t.contains("Größe"), "{t}");
        assert!(t.contains("Übergabe"), "{t}");
        assert!(t.contains("Straße"), "{t}");
        assert!(t.contains("Leitstelle Nord"), "{t}");
        assert!(t.contains("Hochwasser Musterstadt"), "{t}");
    }

    #[test]
    fn uebung_steht_nur_bei_einer_uebung_im_kopf() {
        let mut v = vorlage("Lage ruhig.", &[]);
        assert!(!text(&baue_pdf(&v).unwrap()).contains("ÜBUNG"));
        v.uebung = true;
        assert!(text(&baue_pdf(&v).unwrap()).contains("ÜBUNG"));
    }

    #[test]
    fn ein_ueberlanges_wort_bricht_hart_um() {
        let wort = "q".repeat(500);
        let d = baue_pdf(&vorlage(&wort, &[])).unwrap();
        assert!(d.seiten >= 1);
        let t: String = text(&d).chars().filter(|c| *c == 'q').collect();
        assert_eq!(t.len(), 500, "kein Zeichen geht beim Umbruch verloren");
    }

    #[test]
    fn langer_text_macht_mehrere_seiten_mit_seitenzahl() {
        let inhalt = (1..=400)
            .map(|n| format!("Absatz {n}: Wasserstand steigt."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let d = baue_pdf(&vorlage(&inhalt, &[])).unwrap();
        assert!(d.seiten > 1);
        let t = text(&d);
        assert!(t.contains(&format!("Seite 2 von {}", d.seiten)), "{t}");
        assert!(t.contains("Absatz 400"), "{t}");
    }

    #[test]
    fn gleiche_eingabe_gleiche_bytes() {
        let anlagen = vec![("anlage-1.png".to_string(), png(30, 20))];
        let a = baue_pdf(&vorlage("Lage ruhig.", &anlagen)).unwrap();
        let b = baue_pdf(&vorlage("Lage ruhig.", &anlagen)).unwrap();
        assert!(a.bytes == b.bytes);
    }

    #[test]
    fn kaputte_anlage_ist_bild_fehler() {
        let anlagen = vec![("anlage-1.png".to_string(), b"kein png".to_vec())];
        assert!(matches!(
            baue_pdf(&vorlage("x", &anlagen)),
            Err(PdfFehler::Bild(1))
        ));
    }

    #[test]
    fn zeichen_ausserhalb_der_schrift_brechen_nichts() {
        let d = baue_pdf(&vorlage("Achtung 🚒 Tab\tEnde", &[])).unwrap();
        assert!(text(&d).contains("Ende"));
    }

    #[test]
    fn fax_grenze() {
        let mit = |seiten: usize, bytes: usize| PdfDatei {
            bytes: vec![0; bytes],
            seiten,
        };
        assert!(passt_fuer_fax(&mit(30, 1000)));
        assert!(!passt_fuer_fax(&mit(31, 1000)));
        assert!(passt_fuer_fax(&mit(1, FAX_BYTES_MAX)));
        assert!(!passt_fuer_fax(&mit(1, FAX_BYTES_MAX + 1)));
    }

    #[test]
    fn dateinamen_je_quelle() {
        assert_eq!(
            dateiname(QuelleArt::Lagebericht, Some(3)),
            "lagebericht-3.pdf"
        );
        assert_eq!(dateiname(QuelleArt::Befehl, Some(2)), "befehl-2.pdf");
        assert_eq!(
            dateiname(QuelleArt::Nachforderung, None),
            "nachforderung.pdf"
        );
        assert_eq!(dateiname(QuelleArt::Lagebericht, None), "lagebericht.pdf");
    }
}
