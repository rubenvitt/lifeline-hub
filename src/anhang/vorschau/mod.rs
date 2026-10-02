//! Vorschaubilder der Bild-Anhänge (LFH-759, Spec `anhang-vorschau`).
//!
//! Ein Vorschaubild ist ein neu kodiertes JPEG aus den Bildpunkten der gespeicherten Datei: die
//! Ausrichtung ist angewendet, Metadaten kommen nicht mit, weil keine Bytes außer Bildpunkten
//! übernommen werden. Es entsteht bei jedem Abruf neu und wird nie gespeichert; den Cache trägt
//! der ETag mit [`VORSCHAU_VERSION`]. HEIC/HEIF dekodiert der Browser (WASM), nicht der Server.
//!
//! Herleitung: `openspec/changes/lfh-759-bildvorschau-anhaenge/design.md`, D2–D5.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits, RgbImage};

use super::metadaten::{self, Format};

/// Version der Vorschau-Erzeugung. Steht im ETag; wer Größe, Qualität, Filter oder Ablauf ändert,
/// erhöht sie, damit Browser-Caches kein altes Vorschaubild weiter anbieten.
pub const VORSCHAU_VERSION: u32 = 1;

/// Längste Kante, über der ein Bild ohne Dekodieren abgewiesen wird.
pub const MAX_KANTE: u32 = 16_384;

/// Höchstzahl an Bildpunkten (deckt jedes Handyfoto ab, iPhone 48 MP = 8064 × 6048).
pub const MAX_BILDPUNKTE: u64 = 50_000_000;

/// Speicherobergrenze einer einzelnen Dekodierung.
const MAX_SPEICHER: u64 = 512 * 1024 * 1024;

/// JPEG-Qualität der Vorschaubilder.
const QUALITAET: u8 = 80;

/// Die beiden Größen eines Vorschaubilds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Groesse {
    /// Für Listen: längste Kante höchstens 256 px.
    Klein,
    /// Für die Großansicht: längste Kante höchstens 1600 px.
    Gross,
}

impl Groesse {
    /// Längste Kante in Bildpunkten.
    pub fn kante(self) -> u32 {
        match self {
            Groesse::Klein => 256,
            Groesse::Gross => 1600,
        }
    }

    /// Kürzel im ETag (`"<sha256>.v<n>.<k|g>"`).
    pub fn kuerzel(self) -> char {
        match self {
            Groesse::Klein => 'k',
            Groesse::Gross => 'g',
        }
    }
}

/// Höchstzahl gleichzeitiger Dekodierungen im ganzen Prozess (design.md D5): zwei 48-MP-Fotos
/// belegen zusammen rund 400 MB. Weitere Abrufe warten.
pub const VORSCHAU_PARALLEL: usize = 2;

static DEKODIERER: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(VORSCHAU_PARALLEL);

/// [`erzeugen`] außerhalb der Async-Worker (`spawn_blocking`) und begrenzt auf
/// [`VORSCHAU_PARALLEL`] gleichzeitige Läufe. Ein Panic im Decoder endet als
/// [`KeineVorschau::Unmoeglich`], der Prozess läuft weiter.
pub async fn erzeugen_begrenzt(daten: Vec<u8>, groesse: Groesse) -> Result<Vec<u8>, KeineVorschau> {
    let _platz = DEKODIERER
        .acquire()
        .await
        .map_err(|_| unmoeglich("Dekodierer geschlossen"))?;
    tokio::task::spawn_blocking(move || erzeugen(&daten, groesse))
        .await
        .unwrap_or_else(|_| Err(unmoeglich("Panic im Decoder")))
}

/// Warum es kein Vorschaubild gibt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeineVorschau {
    /// Kein Bild, ein Format ohne Server-Vorschau (HEIF, BigTIFF), kaputte Bilddaten oder ein Bild
    /// über den Grenzen → 422. Der Grund geht nur ins Log.
    Unmoeglich(&'static str),
    /// Das Kontrollnetz fand eine Metadaten-Signatur in der Ausgabe. Das ist ein Programmierfehler
    /// (der Encoder schreibt nur JFIF) → 500.
    Kontrollnetz,
}

fn unmoeglich(grund: &'static str) -> KeineVorschau {
    KeineVorschau::Unmoeglich(grund)
}

/// Erzeugt das Vorschaubild der Größe `groesse` aus den gespeicherten Bytes `daten`.
///
/// Rechenintensiv: Aufrufer laufen in `spawn_blocking` (`routes::support::anhang_antwort`).
pub fn erzeugen(daten: &[u8], groesse: Groesse) -> Result<Vec<u8>, KeineVorschau> {
    // 1. Format aus den Magic Bytes, mit fest gesetztem `ImageFormat` (kein Raten in `image`).
    let format = match metadaten::erkenne(daten) {
        Some(Format::Jpeg) => ImageFormat::Jpeg,
        Some(Format::Png) => ImageFormat::Png,
        Some(Format::Gif) => ImageFormat::Gif,
        Some(Format::Webp) => ImageFormat::WebP,
        Some(Format::Tiff) if metadaten::ist_bigtiff(daten) => return Err(unmoeglich("BigTIFF")),
        Some(Format::Tiff) => ImageFormat::Tiff,
        Some(Format::Heif) => return Err(unmoeglich("HEIF dekodiert der Browser")),
        None => return Err(unmoeglich("kein Bild mit Server-Vorschau")),
    };

    let mut grenzen = Limits::default();
    grenzen.max_image_width = Some(MAX_KANTE);
    grenzen.max_image_height = Some(MAX_KANTE);
    grenzen.max_alloc = Some(MAX_SPEICHER);
    let mut leser = ImageReader::with_format(Cursor::new(daten), format);
    leser.limits(grenzen.clone());

    // 2. Abmessungen aus dem Kopf, bevor ein Byte Bilddaten dekodiert wird. Die Kanten prüft
    //    schon `Limits`; die Bildpunkte hier.
    let mut decoder = leser
        .into_decoder()
        .map_err(|_| unmoeglich("Kopf nicht lesbar oder Bild zu groß"))?;
    let (breite, hoehe) = decoder.dimensions();
    if breite == 0 || hoehe == 0 {
        return Err(unmoeglich("leeres Bild"));
    }
    if u64::from(breite) * u64::from(hoehe) > MAX_BILDPUNKTE {
        return Err(unmoeglich("zu viele Bildpunkte"));
    }
    grenzen
        .reserve(decoder.total_bytes())
        .map_err(|_| unmoeglich("Speicherbedarf zu groß"))?;

    // 3./4. Dekodieren (erstes Bild einer Folge, erste TIFF-Seite) und ausrichten.
    let ausrichtung = decoder
        .orientation()
        .map_err(|_| unmoeglich("Ausrichtung nicht lesbar"))?;
    let mut bild =
        DynamicImage::from_decoder(decoder).map_err(|_| unmoeglich("Bilddaten nicht lesbar"))?;
    bild.apply_orientation(ausrichtung);

    // 5. Verkleinern, nie vergrößern.
    let kante = groesse.kante();
    if bild.width() > kante || bild.height() > kante {
        bild = bild.thumbnail(kante, kante);
    }

    // 6. Alpha auf Weiß verrechnen (JPEG kennt kein Alpha). 7. Kodieren.
    let rgb = auf_weiss(&bild);
    let mut aus = Vec::new();
    JpegEncoder::new_with_quality(&mut aus, QUALITAET)
        .encode_image(&rgb)
        .map_err(|_| unmoeglich("JPEG nicht kodierbar"))?;

    // 8. Kontrollnetz wie bei der Bereinigung.
    metadaten::pruefe_kontrollnetz(&aus, None).map_err(|_| KeineVorschau::Kontrollnetz)?;
    Ok(aus)
}

/// RGB-Bild; transparente Bildpunkte werden auf Weiß verrechnet, damit transparente Pläne und
/// Screenshots lesbar bleiben.
fn auf_weiss(bild: &DynamicImage) -> RgbImage {
    if !bild.color().has_alpha() {
        return bild.to_rgb8();
    }
    let rgba = bild.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let mische =
            |c: u8| ((u16::from(c) * u16::from(a) + 255 * (255 - u16::from(a))) / 255) as u8;
        image::Rgb([mische(r), mische(g), mische(b)])
    })
}

#[cfg(test)]
mod tests;
