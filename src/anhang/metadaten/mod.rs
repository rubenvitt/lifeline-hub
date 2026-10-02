//! Metadaten-Bereinigung bei der Auslieferung (LFH-747).
//!
//! Gespeichert wird das Original (Beweismittel, Entscheidung 24.09.2026). Ausgeliefert wird
//! standardmäßig eine Fassung ohne EXIF, XMP, IPTC, Kommentare und Vorschaubilder; nur die
//! Ausrichtung bleibt. Bilddaten und Farbprofil laufen bytegleich durch, nichts wird neu kodiert.
//!
//! Drei Regeln (Herleitung: `openspec/changes/archive/2026-10-02-lfh-747-exif-bereinigung-auslieferung/design.md`,
//! D3–D5):
//! - Das Format bestimmen die Magic Bytes, nicht der gespeicherte MIME-Typ.
//! - Behalten wird nur, was auf einer Positivliste steht.
//! - Fail-closed: Was sich nicht sicher bereinigen lässt, ist [`Unbereinigbar`], nie das
//!   Original. Ein Kontrollnetz prüft jede Ausgabe ein zweites Mal, unabhängig vom Format-Code.

mod exif;
mod gif;
mod heif;
mod jpeg;
pub(crate) mod png;
#[cfg(test)]
pub(crate) mod testbau;
mod tiff;
mod webp;

use std::borrow::Cow;

/// Version der Bereinigung. Steht im ETag der bereinigten Fassung; wer die Bereinigung ändert,
/// erhöht sie, damit Browser-Caches die alte Fassung nicht weiter anbieten.
pub const BEREINIGUNG_VERSION: u32 = 1;

/// Die Datei lässt sich nicht sicher bereinigen. Der Grund geht nur ins Log, nie an den Client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unbereinigbar(pub &'static str);

/// Ergebnis eines Format-Bereinigers: die neuen Bytes und, nur beim JPEG mit Mini-EXIF, die
/// Stelle des einzigen erlaubten `Exif\0\0`.
pub(super) struct Bereinigt {
    pub daten: Vec<u8>,
    pub exif_stelle: Option<usize>,
}

impl Bereinigt {
    fn ohne_exif(daten: Vec<u8>) -> Self {
        Bereinigt {
            daten,
            exif_stelle: None,
        }
    }
}

/// Erkanntes Bildformat; auch die Vorschau (`anhang::vorschau`, LFH-759) wählt danach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Jpeg,
    Png,
    Webp,
    Gif,
    Tiff,
    Heif,
}

/// Marken im `ftyp`, an denen ein HEIF-Container erkannt wird (HEIC, HEIF, deren Folgen, AVIF
/// über `mif1`).
const HEIF_MARKEN: &[&[u8; 4]] = &[
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
];

pub(crate) fn erkenne(d: &[u8]) -> Option<Format> {
    if d.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Format::Jpeg);
    }
    if d.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Format::Png);
    }
    if d.len() >= 12 && &d[..4] == b"RIFF" && &d[8..12] == b"WEBP" {
        return Some(Format::Webp);
    }
    if d.starts_with(b"GIF87a") || d.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    // Klassisches TIFF und BigTIFF (`+` statt `*`); BigTIFF weist der TIFF-Bereiniger ab.
    if matches!(d.get(..4), Some(b"II*\0" | b"MM\0*" | b"II+\0" | b"MM\0+")) {
        return Some(Format::Tiff);
    }
    if d.get(4..8) == Some(b"ftyp") {
        let groesse = u32::from_be_bytes(d.get(..4)?.try_into().ok()?) as usize;
        let ftyp = d.get(8..groesse.min(d.len()))?;
        let ist_heif = ftyp
            .chunks_exact(4)
            .enumerate()
            // Index 1 ist die minor_version, keine Marke.
            .any(|(i, m)| i != 1 && HEIF_MARKEN.iter().any(|h| m == &h[..]));
        if ist_heif {
            return Some(Format::Heif);
        }
    }
    None
}

/// Bereinigt `daten` für die Auslieferung.
///
/// - Erkanntes Bildformat: bereinigt, gleich was `mime` sagt.
/// - Kein Bild erkannt, `mime` ist `image/*`: [`Unbereinigbar`].
/// - Sonst (PDF, Text, Office): unverändert, ohne Kopie.
pub fn bereinigen<'a>(daten: &'a [u8], mime: &str) -> Result<Cow<'a, [u8]>, Unbereinigbar> {
    let Some(format) = erkenne(daten) else {
        if mime.starts_with("image/") {
            return Err(Unbereinigbar("Bildformat nicht erkannt"));
        }
        return Ok(Cow::Borrowed(daten));
    };
    let ergebnis = match format {
        Format::Jpeg => jpeg::bereinigen(daten)?,
        Format::Png => png::bereinigen(daten)?,
        Format::Webp => webp::bereinigen(daten)?,
        Format::Gif => gif::bereinigen(daten)?,
        Format::Tiff => tiff::bereinigen(daten)?,
        Format::Heif => heif::bereinigen(daten)?,
    };
    pruefe_kontrollnetz(&ergebnis.daten, ergebnis.exif_stelle)?;
    Ok(Cow::Owned(ergebnis.daten))
}

/// Das Kontrollnetz (design.md D5): Signaturen von XMP, Photoshop/IPTC und EXIF dürfen in der
/// Ausgabe nicht vorkommen. Einzige Ausnahme ist ein EXIF-Block an `exif_stelle`, wenn dort ein
/// Mini-EXIF steht. Ein Durchlauf über die Bytes, damit 25 MiB nicht sechsmal gelesen werden.
///
/// Ein EXIF-Block ist `Exif\0\0` **mit folgendem TIFF-Kopf**: die Kennung allein steht in jedem
/// HEIC als Item-Typ im `infe` (Typ `Exif`, leerer Name, dann die Nullbytes der nächsten Box)
/// und hätte jedes iPhone-Foto abgewiesen.
///
/// Auch die Vorschau prüft ihre Ausgabe damit (`anhang::vorschau`, LFH-759), ohne `exif_stelle`.
pub(crate) fn pruefe_kontrollnetz(
    d: &[u8],
    exif_stelle: Option<usize>,
) -> Result<(), Unbereinigbar> {
    const XMP: &[u8] = b"http://ns.adobe.com/xap/1.0/";
    const XMP_ERWEITERT: &[u8] = b"http://ns.adobe.com/xmp/extension/";
    const XMPMETA: &[u8] = b"<x:xmpmeta";
    const XPACKET: &[u8] = b"<?xpacket";
    const PHOTOSHOP: &[u8] = b"Photoshop 3.0";
    const EXIF: &[u8] = b"Exif\0\0";
    let ab = |i: usize, s: &[u8]| d.get(i..i + s.len()) == Some(s);
    for (i, &b) in d.iter().enumerate() {
        let treffer = match b {
            b'h' => ab(i, XMP) || ab(i, XMP_ERWEITERT),
            b'<' => ab(i, XMPMETA) || ab(i, XPACKET),
            b'P' => ab(i, PHOTOSHOP),
            b'E' if ab(i, EXIF) && ist_tiff_kopf(d.get(i + EXIF.len()..).unwrap_or_default()) => {
                exif_stelle != Some(i) || !d.get(i + EXIF.len()..).is_some_and(exif::ist_mini_tiff)
            }
            _ => false,
        };
        if treffer {
            return Err(Unbereinigbar(
                "Kontrollnetz: Metadaten-Signatur in der Ausgabe",
            ));
        }
    }
    Ok(())
}

/// BigTIFF (`II+\0`/`MM\0+`): [`erkenne`] meldet es als TIFF, Bereinigung und Vorschau weisen
/// es ab.
pub(crate) fn ist_bigtiff(d: &[u8]) -> bool {
    matches!(d.get(..4), Some(b"II+\0" | b"MM\0+"))
}

fn ist_tiff_kopf(d: &[u8]) -> bool {
    matches!(d.get(..4), Some(b"II*\0" | b"MM\0*"))
}

#[cfg(test)]
mod tests {
    use super::testbau::*;
    use super::*;

    #[test]
    fn erkennt_jedes_format_an_den_magic_bytes() {
        assert_eq!(erkenne(&jpeg(false, None, false)), Some(Format::Jpeg));
        assert_eq!(erkenne(&png(false, None)), Some(Format::Png));
        assert_eq!(erkenne(&webp_einfach()), Some(Format::Webp));
        assert_eq!(erkenne(&gif()), Some(Format::Gif));
        assert_eq!(erkenne(&tiff_datei(true)), Some(Format::Tiff));
        assert_eq!(erkenne(b"II+\0\x08\0\0\0"), Some(Format::Tiff));
        assert_eq!(erkenne(&heif(&HeifBau::default())), Some(Format::Heif));
        assert_eq!(erkenne(b"%PDF-1.7\n"), None);
        // ftyp ohne HEIF-Marke (MP4) ist kein Bild.
        assert_eq!(erkenne(&boxe(b"ftyp", b"isom\0\0\0\0isomavc1")), None);
    }

    #[test]
    fn kein_bild_wird_unveraendert_und_ohne_kopie_durchgereicht() {
        let pdf = b"%PDF-1.7\n1 0 obj\n<< /Author (MARKER) >>\nendobj\n".to_vec();
        let aus = bereinigen(&pdf, "application/pdf").expect("PDF");
        assert!(matches!(aus, Cow::Borrowed(_)));
        assert_eq!(&*aus, &pdf[..]);
    }

    #[test]
    fn unerkanntes_bild_ist_unbereinigbar() {
        assert!(bereinigen(b"kein Bild", "image/jpeg").is_err());
        assert!(bereinigen(b"kein Bild", "image/heic").is_err());
    }

    #[test]
    fn falsche_endung_hilft_nicht() {
        let j = jpeg(false, Some(6), false);
        for mime in ["application/pdf", "image/png", "text/plain"] {
            let aus = bereinigen(&j, mime).expect("JPEG");
            assert!(!enthaelt(&aus, MARKER), "{mime}");
        }
    }

    #[test]
    fn kontrollnetz_faengt_durchgerutschtes_xmp() {
        let mut d = b"PIXEL".to_vec();
        d.extend(xmp_paket());
        assert!(pruefe_kontrollnetz(&d, None).is_err());
        assert!(pruefe_kontrollnetz(b"PIXEL http://ns.adobe.com/xap/1.0/", None).is_err());
        assert!(pruefe_kontrollnetz(b"PIXEL Photoshop 3.0\0", None).is_err());
        assert!(pruefe_kontrollnetz(b"PIXEL", None).is_ok());
    }

    #[test]
    fn kontrollnetz_laesst_nur_das_eigene_mini_exif_stehen() {
        let mut mit_mini = b"XXExif\0\0".to_vec();
        mit_mini.extend(exif::mini_tiff(6, exif::Leser { be: false }));
        assert!(pruefe_kontrollnetz(&mit_mini, Some(2)).is_ok());
        // Dasselbe Mini-EXIF an einer nicht angemeldeten Stelle.
        assert!(pruefe_kontrollnetz(&mit_mini, None).is_err());
        // Ein volles EXIF an der angemeldeten Stelle.
        let mut voll = b"XXExif\0\0".to_vec();
        voll.extend(exif_tiff(false, Some(6)));
        assert!(pruefe_kontrollnetz(&voll, Some(2)).is_err());
    }

    #[test]
    fn exif_kennung_ohne_tiff_kopf_ist_kein_exif_block() {
        // So steht `Exif` im `infe` eines HEIC: Item-Typ, leerer Name, nächste Box.
        assert!(pruefe_kontrollnetz(b"infe\0\0Exif\0\0\0\x15infe", None).is_ok());
    }

    /// Die ganze Kette (Format-Bereiniger + Kontrollnetz) nimmt jede Fixture an und lässt keinen
    /// Marker übrig.
    #[test]
    fn jede_fixture_besteht_die_ganze_kette() {
        let fixtures: Vec<(&str, Vec<u8>, &str)> = vec![
            ("jpeg", jpeg(false, Some(6), true), "image/jpeg"),
            ("png", png(true, Some(6)), "image/png"),
            ("webp", webp_erweitert(false, Some(6)), "image/webp"),
            ("gif", gif(), "image/gif"),
            ("heif", heif(&HeifBau::default()), "image/heic"),
            ("tiff", tiff_datei(true), "image/tiff"),
        ];
        for (name, f, mime) in fixtures {
            let aus = bereinigen(&f, mime).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            assert!(!enthaelt(&aus, MARKER), "{name}");
        }
    }

    /// tasks.md 2.7: Jede Fixture, an jeder Länge gekürzt und an 200 Stellen verfälscht, ergibt
    /// `Ok` oder `Err`, nie einen Panic. Jedes `Ok` hat das Kontrollnetz bestanden (das läuft in
    /// `bereinigen`), und jede gekürzte Fassung, die bereinigt wird, trägt keinen Marker mehr.
    #[test]
    fn robust_gegen_gekuerzte_und_verfaelschte_dateien() {
        let fixtures: Vec<(&str, Vec<u8>)> = vec![
            ("jpeg", jpeg(false, Some(6), true)),
            ("jpeg-be", jpeg(true, Some(3), false)),
            ("png", png(true, Some(6))),
            ("webp", webp_erweitert(false, Some(6))),
            ("gif", gif()),
            ("heif", heif(&HeifBau::default())),
            ("tiff", tiff_datei(false)),
            ("tiff-be", tiff_datei(true)),
        ];
        let mut z = Zufall(0x4C46_4837_3437);
        for (name, f) in &fixtures {
            for n in 0..f.len() {
                if let Ok(aus) = bereinigen(&f[..n], "image/jpeg") {
                    // TIFF und HEIF nullen an Ort und Stelle: ein Rest jenseits der Kürzung ist
                    // dort kein Metadatum mehr, das die Struktur noch erreicht. Für die
                    // umbauenden Formate gilt die strenge Aussage.
                    if !matches!(*name, "tiff" | "tiff-be" | "heif") {
                        assert!(!enthaelt(&aus, MARKER), "{name} gekürzt auf {n}");
                    }
                }
            }
            for _ in 0..200 {
                let mut d = f.clone();
                for _ in 0..1 + z.naechste(3) {
                    let i = z.naechste(d.len());
                    d[i] = z.naechste(256) as u8;
                }
                let _ = bereinigen(&d, "image/jpeg");
            }
        }
    }
}
