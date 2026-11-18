//! Plan einer Unfallhilfsstelle als Hintergrundbild unter dem Platz-Layout (LFH-999, Spec
//! `uhs-plan`, Herleitung `openspec/changes/…/lfh-999-uhs-plan-hintergrund/design.md`).
//!
//! Der Plan ist **kein Anhang**: eigene, bereinigte Bytes in `uhs_plan`, höchstens einer je UHS.
//! Seine Anzeige schreibt weder Lese-Audit noch ETB (D1); nur die Übernahme aus einem
//! UHS-Anhang ist ein protokollierter Abruf (`routes::uhs_plan::uebernehmen`). Hier stehen die
//! Annahme eines Bildes (D3), das Einrasten und die Startlage (D5) und das Wire-DTO.

use std::io::Cursor;

use serde::Serialize;
use utoipa::ToSchema;

use crate::anhang::metadaten::{self, Format};
use crate::error::AppError;

pub mod repo;

/// Max. Größe eines Plans, wie bei Anhängen und Bild-Hintergründen der Lagekarte.
pub const MAX_GROESSE: usize = crate::karte_hintergrundbild::MAX_GROESSE;

/// Längste erlaubte Kante in Bildpunkten: größere Bilder zeichnen Tablets nicht zuverlässig.
pub const MAX_KANTE: u32 = 10_000;

/// Raster, auf das Versatz und Breite einrasten: der Randabstand des Platzrasters
/// (`platz_repo::raster_position`, `RAND`).
pub const RASTER: i64 = 10;

/// Grenzen der Lage (Spec „Lage des Plans zur Platzfläche“, CHECK in `0152_uhs_plan.sql`).
pub const BREITE_MIN: i64 = 100;
pub const BREITE_MAX: i64 = 5_000;
pub const VERSATZ_MAX: i64 = 10_000;

/// Kartengröße einer Platzkarte (`Grundriss.tsx`, `PLATZ_KARTE_BREITE`/`_HOEHE`) — der Rahmen,
/// den die Startlage überdecken muss.
pub const KARTE_BREITE: i64 = 140;
pub const KARTE_HOEHE: i64 = 116;

/// Rand um die Plätze beim Einpassen.
pub const EINPASS_RAND: i64 = 20;

/// Breite eines Plans ohne Plätze: fünf Rasterspalten (5 × 160) plus zweimal der Rand.
pub const BREITE_OHNE_PLAETZE: i64 = 820;

/// Meldung für ein Bild außerhalb der Plan-Formate. Beim Upload 400, bei der Übernahme 422.
pub const NUR_BILDER: &str = "Nur PNG-, JPEG- oder WebP-Bilder können als Plan dienen";

/// Ein angenommenes Bild: bereinigte Bytes samt Typ, Maßen und Prüfsumme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeprueftesBild {
    pub daten: Vec<u8>,
    pub mime: &'static str,
    pub bild_breite: u32,
    pub bild_hoehe: u32,
    pub sha256: String,
}

/// Warum ein Bild nicht als Plan taugt. Der Aufrufer wählt den Status: das Format ist beim
/// Upload ein Feldfehler (400), bei der Übernahme ein Zusammenhang (422).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Abgelehnt {
    /// Leer oder zu groß (immer 400).
    Groesse(String),
    /// Kein PNG, JPEG oder WebP.
    Format,
    /// Metadaten nicht sicher entfernbar, Maße unlesbar oder Kante zu groß (immer 422).
    Inhalt(String),
}

/// Größe und Format aus den Magic Bytes, ohne die Datei zu parsen: läuft beim Upload VOR dem
/// Virenscan, damit nur ein Bild in den Scanner geht.
pub fn vorpruefung(daten: &[u8]) -> Result<(&'static str, image::ImageFormat), Abgelehnt> {
    if daten.is_empty() {
        return Err(Abgelehnt::Groesse("Bild ist leer".into()));
    }
    if daten.len() > MAX_GROESSE {
        return Err(Abgelehnt::Groesse(format!(
            "Bild ist zu groß ({} MiB erlaubt)",
            MAX_GROESSE / 1024 / 1024
        )));
    }
    match metadaten::erkenne(daten) {
        Some(Format::Png) => Ok(("image/png", image::ImageFormat::Png)),
        Some(Format::Jpeg) => Ok(("image/jpeg", image::ImageFormat::Jpeg)),
        Some(Format::Webp) => Ok(("image/webp", image::ImageFormat::WebP)),
        _ => Err(Abgelehnt::Format),
    }
}

/// Ob ein gespeicherter Anhang-Typ als Plan taugt (Vorprüfung der Übernahme vor dem Audit).
pub fn ist_plan_mime(mime: &str) -> bool {
    matches!(mime, "image/png" | "image/jpeg" | "image/webp")
}

/// Die Annahme eines Bildes (design.md D3, ohne Scan): Größe, Format aus den Magic Bytes,
/// Bereinigung, Maße aus dem Kopf, Kantengrenze, Prüfsumme über die gespeicherten Bytes.
pub fn pruefe_bild(daten: &[u8]) -> Result<GeprueftesBild, Abgelehnt> {
    let (mime, format) = vorpruefung(daten)?;
    let bereinigt = metadaten::bereinigen(daten, mime)
        .map_err(|_| {
            Abgelehnt::Inhalt("Die Metadaten des Bildes lassen sich nicht sicher entfernen".into())
        })?
        .into_owned();
    let (bild_breite, bild_hoehe) =
        image::ImageReader::with_format(Cursor::new(&bereinigt), format)
            .into_dimensions()
            .map_err(|_| Abgelehnt::Inhalt("Die Maße des Bildes lassen sich nicht lesen".into()))?;
    if bild_breite == 0 || bild_hoehe == 0 {
        return Err(Abgelehnt::Inhalt("Das Bild hat keine Fläche".into()));
    }
    if bild_breite > MAX_KANTE || bild_hoehe > MAX_KANTE {
        return Err(Abgelehnt::Inhalt(format!(
            "Das Bild ist zu groß ({MAX_KANTE} Bildpunkte je Kante erlaubt)"
        )));
    }
    let sha256 = crate::anhang::repo::sha256_hex(&bereinigt);
    Ok(GeprueftesBild {
        daten: bereinigt,
        mime,
        bild_breite,
        bild_hoehe,
        sha256,
    })
}

/// Rundet auf das nächste Vielfache von [`RASTER`], halbe Schritte vom Nullpunkt weg.
pub fn raste(v: i64) -> i64 {
    let r = RASTER;
    let betrag = (v.abs() + r / 2) / r * r;
    if v < 0 {
        -betrag
    } else {
        betrag
    }
}

/// Lage eines Plans auf der Platzfläche.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lage {
    pub x: i64,
    pub y: i64,
    pub breite: i64,
}

/// „An Plätze einpassen“ (D5a): Rahmen aller platzierten Plätze plus [`EINPASS_RAND`], der Plan
/// überdeckt ihn ganz (größerer der beiden Faktoren) und setzt oben links an. Ohne Plätze
/// `0/0/820`. Versatz auf das Raster abgerundet, Breite aufgerundet, damit die Deckung bleibt.
/// Die Client-Rechnung `einpassen` in `frontend/src/api/uhsPlan.ts` folgt derselben Regel.
pub fn startlage(plaetze: &[(f64, f64)], bild_breite: u32, bild_hoehe: u32) -> Lage {
    if plaetze.is_empty() {
        return Lage {
            x: 0,
            y: 0,
            breite: BREITE_OHNE_PLAETZE,
        };
    }
    let min_x = plaetze.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
    let min_y = plaetze.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
    let max_x = plaetze
        .iter()
        .map(|p| p.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = plaetze
        .iter()
        .map(|p| p.1)
        .fold(f64::NEG_INFINITY, f64::max);
    let ab = |v: f64| ((v.max(0.0) as i64) / RASTER * RASTER).min(VERSATZ_MAX);
    let x = ab(min_x - EINPASS_RAND as f64);
    let y = ab(min_y - EINPASS_RAND as f64);
    let rahmen_b = max_x + (KARTE_BREITE + EINPASS_RAND) as f64 - x as f64;
    let rahmen_h = max_y + (KARTE_HOEHE + EINPASS_RAND) as f64 - y as f64;
    let noetig = rahmen_b.max(rahmen_h * bild_breite as f64 / bild_hoehe as f64);
    let auf = ((noetig / RASTER as f64).ceil() as i64) * RASTER;
    Lage {
        x,
        y,
        breite: auf.clamp(BREITE_MIN, BREITE_MAX),
    }
}

/// Prüft die Werte eines PATCH gegen die Grenzen der Spec (400 je Feld).
pub fn pruefe_bereich(name: &str, wert: i64, min: i64, max: i64) -> Result<(), AppError> {
    if (min..=max).contains(&wert) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "{name} muss zwischen {min} und {max} liegen"
        )))
    }
}

/// Der Plan einer UHS ohne Bytes: Teil von `UhsDetail` und Antwort der schreibenden Routen.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow, ToSchema)]
pub struct UhsPlanAnzeige {
    pub uhs_id: i64,
    pub mime: String,
    /// Prüfsumme der gespeicherten Bytes; ETag des Bildes und Cache-Schlüssel im Client.
    pub sha256: String,
    pub bild_breite: i64,
    pub bild_hoehe: i64,
    /// Versatz und Breite in Koordinaten der Platzfläche; Höhe = breite × bild_hoehe / bild_breite.
    pub x: i64,
    pub y: i64,
    pub breite: i64,
    /// Prozent: Helligkeit 20–100, Kontrast 50–150.
    pub helligkeit: i64,
    pub kontrast: i64,
    /// Im dunklen Thema umkehren (helle Flächen werden dunkel).
    pub nacht_umkehren: bool,
    pub hinterlegt_at: String,
    pub geaendert_at: String,
}

#[cfg(test)]
pub(crate) mod testbild {
    //! Echte, dekodierbare Bilder für Tests (Bildmaße müssen lesbar sein).
    use image::{ImageFormat, RgbImage};
    use std::io::Cursor;

    pub fn kodiert(breite: u32, hoehe: u32, format: ImageFormat) -> Vec<u8> {
        let bild = RgbImage::from_fn(breite, hoehe, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 200])
        });
        let mut out = Cursor::new(Vec::new());
        bild.write_to(&mut out, format).unwrap();
        out.into_inner()
    }

    pub fn png(breite: u32, hoehe: u32) -> Vec<u8> {
        kodiert(breite, hoehe, ImageFormat::Png)
    }
}

#[cfg(test)]
mod tests {
    use super::testbild::{kodiert, png};
    use super::*;
    use crate::anhang::metadaten::testbau;
    use image::ImageFormat;

    #[test]
    fn png_jpeg_und_webp_werden_angenommen_mit_massen() {
        for (format, mime) in [
            (ImageFormat::Png, "image/png"),
            (ImageFormat::Jpeg, "image/jpeg"),
            (ImageFormat::WebP, "image/webp"),
        ] {
            let b = pruefe_bild(&kodiert(64, 48, format)).unwrap();
            assert_eq!(
                (b.mime, b.bild_breite, b.bild_hoehe),
                (mime, 64, 48),
                "{mime}"
            );
            assert_eq!(b.sha256, crate::anhang::repo::sha256_hex(&b.daten));
        }
    }

    #[test]
    fn andere_formate_sind_kein_plan() {
        assert_eq!(pruefe_bild(b"%PDF-1.7 ...").unwrap_err(), Abgelehnt::Format);
        assert_eq!(pruefe_bild(&testbau::gif()).unwrap_err(), Abgelehnt::Format);
        assert_eq!(
            pruefe_bild(&testbau::heif(&testbau::HeifBau::default())).unwrap_err(),
            Abgelehnt::Format
        );
    }

    #[test]
    fn leer_und_zu_gross_sind_groessenfehler() {
        assert!(matches!(pruefe_bild(b""), Err(Abgelehnt::Groesse(_))));
        let mut zu_gross = png(4, 4);
        zu_gross.resize(MAX_GROESSE + 1, 0);
        assert!(matches!(pruefe_bild(&zu_gross), Err(Abgelehnt::Groesse(_))));
    }

    #[test]
    fn jpeg_verliert_die_personenbezogenen_metadaten() {
        // Echtes JPEG, dahinter ein APP1-EXIF mit dem Marker der Bereinigungs-Fixtures (GPS,
        // Kamera, Zeit tragen ihn).
        let roh = kodiert(32, 16, ImageFormat::Jpeg);
        let exif = testbau::app1_exif(&testbau::exif_tiff(false, None));
        let mut mit = roh[..2].to_vec();
        mit.extend_from_slice(&exif);
        mit.extend_from_slice(&roh[2..]);
        assert!(testbau::enthaelt(&mit, testbau::MARKER));
        let b = pruefe_bild(&mit).unwrap();
        assert!(!testbau::enthaelt(&b.daten, testbau::MARKER));
        assert_eq!((b.bild_breite, b.bild_hoehe), (32, 16));
    }

    #[test]
    fn kante_ueber_der_grenze_ist_inhaltsfehler() {
        // PNG-Kopf mit 10 001 × 1 px: Maße kommen aus dem IHDR, ohne Dekodieren.
        let mut b = png(1, 1);
        b[16..20].copy_from_slice(&(MAX_KANTE + 1).to_be_bytes());
        // CRC des IHDR stimmt nicht mehr; der Bereiniger prüft ihn nicht, `into_dimensions`
        // liest nur den Kopf. Scheitert einer davon, ist es ebenfalls ein Inhaltsfehler.
        assert!(matches!(pruefe_bild(&b), Err(Abgelehnt::Inhalt(_))));
    }

    #[test]
    fn rasten_auf_zehn() {
        assert_eq!(raste(37), 40);
        assert_eq!(raste(35), 40);
        assert_eq!(raste(34), 30);
        assert_eq!(raste(0), 0);
        assert_eq!(raste(-37), -40);
    }

    #[test]
    fn startlage_ohne_plaetze() {
        assert_eq!(
            startlage(&[], 800, 600),
            Lage {
                x: 0,
                y: 0,
                breite: 820
            }
        );
    }

    /// Positionen von `n` Plätzen im Server-Raster (5 Spalten, 160 × 120, Rand 10).
    fn raster(n: i64) -> Vec<(f64, f64)> {
        (0..n)
            .map(|i| ((10 + (i % 5) * 160) as f64, (10 + (i / 5) * 120) as f64))
            .collect()
    }

    fn deckt(l: Lage, plaetze: &[(f64, f64)], bb: u32, bh: u32) -> bool {
        let hoehe = l.breite as f64 * bh as f64 / bb as f64;
        plaetze.iter().all(|&(px, py)| {
            px >= l.x as f64
                && py >= l.y as f64
                && px + KARTE_BREITE as f64 <= (l.x + l.breite) as f64
                && py + KARTE_HOEHE as f64 <= l.y as f64 + hoehe
        })
    }

    #[test]
    fn startlage_ueberdeckt_zehn_rasterplaetze() {
        let p = raster(10);
        for (bb, bh) in [(800, 600), (1600, 400), (400, 1600)] {
            let l = startlage(&p, bb, bh);
            assert!(deckt(l, &p, bb, bh), "{bb}×{bh}: {l:?}");
            assert_eq!((l.x % RASTER, l.y % RASTER, l.breite % RASTER), (0, 0, 0));
        }
        // Hohes Bild: die Breite des Rahmens entscheidet — 0 bis 10 + 4 × 160 + 140 + 20.
        assert_eq!(startlage(&p, 400, 1600).breite, 810);
        // Breites Bild (4 : 1): die Höhe entscheidet — 10 + 120 + 116 + 20 = 266, × 4 = 1064.
        assert_eq!(startlage(&p, 1600, 400).breite, 1070);
    }

    #[test]
    fn startlage_haelt_die_grenzen() {
        // Ein sehr breites, flaches Bild würde riesig: auf BREITE_MAX gedeckelt.
        let l = startlage(&raster(50), 5000, 10);
        assert_eq!(l.breite, BREITE_MAX);
    }
}
