//! Tests der Vorschau-Erzeugung (LFH-759, tasks.md 2.3). Die Bilder werden im Test mit den
//! Encodern von `image` kodiert, damit es echte, dekodierbare Bildbytes sind.

use super::*;
use crate::anhang::metadaten::testbau::{
    app1_exif, chunk, enthaelt, exif_tiff, heif, tiff, HeifBau, Ifd, Wert, MARKER, PNG_SIGNATUR,
};
use image::codecs::gif::GifEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ExtendedColorType, Frame, ImageEncoder, Rgb, Rgba, RgbaImage};

const ROT: Rgb<u8> = Rgb([220, 20, 20]);
const BLAU: Rgb<u8> = Rgb([20, 20, 220]);

/// JPEG `breite` × `hoehe`, linke Hälfte rot, rechte blau.
fn jpeg_bild(breite: u32, hoehe: u32) -> Vec<u8> {
    let bild = RgbImage::from_fn(
        breite,
        hoehe,
        |x, _| if x < breite / 2 { ROT } else { BLAU },
    );
    let mut aus = Vec::new();
    JpegEncoder::new_with_quality(&mut aus, 90)
        .encode_image(&bild)
        .unwrap();
    aus
}

/// Fügt hinter `SOI` ein EXIF-Segment mit Gerät, Zeit, GPS (`MARKER`) und `ausrichtung` ein.
fn mit_exif(jpeg: &[u8], ausrichtung: u16) -> Vec<u8> {
    let mut aus = jpeg[..2].to_vec();
    aus.extend(app1_exif(&exif_tiff(false, Some(ausrichtung))));
    aus.extend_from_slice(&jpeg[2..]);
    aus
}

fn png_rgba(bild: &RgbaImage) -> Vec<u8> {
    let mut aus = Vec::new();
    PngEncoder::new(&mut aus)
        .write_image(
            bild.as_raw(),
            bild.width(),
            bild.height(),
            ExtendedColorType::Rgba8,
        )
        .unwrap();
    aus
}

fn dekodiert(jpeg: &[u8]) -> RgbImage {
    assert!(jpeg.starts_with(&[0xFF, 0xD8]), "kein JPEG");
    image::load_from_memory_with_format(jpeg, ImageFormat::Jpeg)
        .expect("Vorschau dekodierbar")
        .to_rgb8()
}

fn ist_nah(p: &Rgb<u8>, soll: Rgb<u8>) -> bool {
    p.0.iter()
        .zip(soll.0)
        .all(|(&a, b)| (i16::from(a) - i16::from(b)).abs() < 40)
}

fn grund(e: Result<Vec<u8>, KeineVorschau>) -> &'static str {
    match e {
        Err(KeineVorschau::Unmoeglich(g)) => g,
        anders => panic!("KeineVorschau::Unmoeglich erwartet, war {anders:?}"),
    }
}

#[test]
fn verkleinert_auf_beide_groessen() {
    let foto = jpeg_bild(2016, 1512);
    let klein = dekodiert(&erzeugen(&foto, Groesse::Klein).unwrap());
    assert_eq!(klein.dimensions(), (256, 192));
    let gross = dekodiert(&erzeugen(&foto, Groesse::Gross).unwrap());
    assert_eq!(gross.dimensions(), (1600, 1200));
}

#[test]
fn kleines_bild_wird_nicht_vergroessert() {
    let png = png_rgba(&RgbaImage::from_pixel(120, 80, Rgba([10, 200, 10, 255])));
    for g in [Groesse::Klein, Groesse::Gross] {
        assert_eq!(
            dekodiert(&erzeugen(&png, g).unwrap()).dimensions(),
            (120, 80)
        );
    }
}

#[test]
fn ausrichtung_ist_angewendet_und_metadaten_fehlen() {
    // Ausrichtung 6: zur Anzeige 90° im Uhrzeigersinn drehen, die linke (rote) Hälfte wird oben.
    let foto = mit_exif(&jpeg_bild(400, 300), 6);
    assert!(enthaelt(&foto, MARKER), "Fixture trägt Metadaten");
    let aus = erzeugen(&foto, Groesse::Klein).unwrap();
    assert!(!enthaelt(&aus, MARKER), "Metadaten in der Vorschau");
    assert!(!enthaelt(&aus, b"Exif\0\0"), "EXIF-Block in der Vorschau");
    assert!(!enthaelt(&aus, b"http://ns.adobe.com/xap/1.0/"));
    let bild = dekodiert(&aus);
    assert_eq!(bild.dimensions(), (192, 256));
    assert!(ist_nah(bild.get_pixel(96, 20), ROT), "oben rot");
    assert!(ist_nah(bild.get_pixel(96, 236), BLAU), "unten blau");
}

#[test]
fn alpha_wird_auf_weiss_verrechnet() {
    let mut bild = RgbaImage::from_pixel(40, 40, Rgba([0, 0, 0, 0]));
    bild.put_pixel(0, 0, Rgba([0, 0, 0, 255]));
    let aus = dekodiert(&erzeugen(&png_rgba(&bild), Groesse::Klein).unwrap());
    assert!(ist_nah(aus.get_pixel(30, 30), Rgb([255, 255, 255])));
}

#[test]
fn gif_zeigt_das_erste_bild() {
    let mut gif = Vec::new();
    {
        let mut enc = GifEncoder::new(&mut gif);
        enc.encode_frames([
            Frame::new(RgbaImage::from_pixel(16, 16, Rgba([220, 20, 20, 255]))),
            Frame::new(RgbaImage::from_pixel(16, 16, Rgba([20, 20, 220, 255]))),
        ])
        .unwrap();
    }
    let aus = dekodiert(&erzeugen(&gif, Groesse::Klein).unwrap());
    assert!(ist_nah(aus.get_pixel(8, 8), ROT));
}

/// Zweiseitiges Graustufen-TIFF 2 × 2: Seite 1 weiß, Seite 2 schwarz.
fn tiff_zwei_seiten() -> Vec<u8> {
    let seite = |wert: u8| {
        Ifd(vec![
            (256, Wert::Short(2)),
            (257, Wert::Short(2)),
            (258, Wert::Short(8)),
            (259, Wert::Short(1)),
            (262, Wert::Short(1)),
            (273, Wert::Verweis(vec![wert; 4])),
            (277, Wert::Short(1)),
            (278, Wert::Short(2)),
            (279, Wert::Long(4)),
        ])
    };
    tiff(false, &[seite(255), seite(0)], &[0, 1])
}

#[test]
fn tiff_zeigt_die_erste_seite() {
    let aus = dekodiert(&erzeugen(&tiff_zwei_seiten(), Groesse::Klein).unwrap());
    assert_eq!(aus.dimensions(), (2, 2));
    assert!(aus.get_pixel(0, 0).0[0] > 200, "Seite 1 ist weiß");
}

#[test]
fn webp_wird_zu_jpeg() {
    let bild = RgbaImage::from_pixel(300, 150, Rgba([20, 20, 220, 255]));
    let mut webp = Vec::new();
    WebPEncoder::new_lossless(&mut webp)
        .encode(bild.as_raw(), 300, 150, ExtendedColorType::Rgba8)
        .unwrap();
    let aus = dekodiert(&erzeugen(&webp, Groesse::Klein).unwrap());
    assert_eq!(aus.dimensions(), (256, 128));
}

fn png_kopf(breite: u32, hoehe: u32) -> Vec<u8> {
    let mut ihdr = breite.to_be_bytes().to_vec();
    ihdr.extend(hoehe.to_be_bytes());
    ihdr.extend([8, 2, 0, 0, 0]);
    let mut png = PNG_SIGNATUR.to_vec();
    png.extend(chunk(b"IHDR", &ihdr));
    // Ein IDAT-Anfang: der png-Decoder liest den Kopf bis zum ersten IDAT. Die Bilddaten
    // selbst fehlen, ein Dekodieren schlüge also fehl.
    png.extend(chunk(b"IDAT", b"\x78\x9c"));
    png.extend(chunk(b"IEND", b""));
    png
}

#[test]
fn riesige_kante_wird_ohne_dekodieren_abgewiesen() {
    // Nur der Kopf: es gibt keine Bilddaten, die dekodiert werden könnten.
    assert_eq!(
        grund(erzeugen(&png_kopf(20_000, 20_000), Groesse::Klein)),
        "Kopf nicht lesbar oder Bild zu groß"
    );
}

#[test]
fn zu_viele_bildpunkte_werden_ohne_dekodieren_abgewiesen() {
    // Beide Kanten unter 16 384 px, zusammen 60 MP.
    assert_eq!(
        grund(erzeugen(&png_kopf(10_000, 6_000), Groesse::Klein)),
        "zu viele Bildpunkte"
    );
}

#[test]
fn abgeschnittenes_png_hat_keine_vorschau() {
    let rausch = RgbaImage::from_fn(64, 64, |x, y| {
        Rgba([(x * 7 + y * 13) as u8, (x * y) as u8, (x ^ y) as u8, 255])
    });
    let png = png_rgba(&rausch);
    grund(erzeugen(&png[..png.len() / 2], Groesse::Klein));
}

#[test]
fn formate_ohne_server_vorschau() {
    grund(erzeugen(b"%PDF-1.7\n%%EOF", Groesse::Klein));
    assert_eq!(
        grund(erzeugen(&heif(&HeifBau::default()), Groesse::Klein)),
        "HEIF dekodiert der Browser"
    );
    assert_eq!(
        grund(erzeugen(
            b"II+\0\x08\0\0\0\x10\0\0\0\0\0\0\0",
            Groesse::Klein
        )),
        "BigTIFF"
    );
}

#[test]
fn etag_kuerzel_unterscheiden_die_groessen() {
    assert_ne!(Groesse::Klein.kuerzel(), Groesse::Gross.kuerzel());
}
