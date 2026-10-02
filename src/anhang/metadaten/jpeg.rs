//! JPEG (LFH-747, design.md D4): Segmente auf einer Positivliste behalten, Entropiedaten
//! bytegleich übernehmen, alles nach dem ersten EOI abschneiden (MPF-Zweitbilder,
//! Hersteller-Trailer) und bei einer Ausrichtung ≠ 1 ein Mini-EXIF einsetzen.

use super::{exif, Bereinigt, Unbereinigbar};

const SOI: u8 = 0xD8;
const EOI: u8 = 0xD9;
const SOS: u8 = 0xDA;
const APP0: u8 = 0xE0;
const APP1: u8 = 0xE1;
const APP2: u8 = 0xE2;
const APP14: u8 = 0xEE;

/// Was mit einem Segment geschieht.
enum Umgang {
    Behalten,
    /// JFIF-APP0 mit Vorschaubild: auf die 16 Kopfbytes ohne Vorschau kürzen.
    JfifOhneVorschau,
    Weg,
}

fn umgang(marker: u8, nutzlast: &[u8]) -> Result<Umgang, Unbereinigbar> {
    Ok(match marker {
        // SOFn (ohne C4 DHT, C8 JPG, CC DAC), DHT, DAC, DQT, DNL, DRI, DHP, EXP, SOS.
        0xC0..=0xCF | 0xDA..=0xDF if marker != 0xC8 => Umgang::Behalten,
        APP0 if nutzlast.starts_with(b"JFIF\0") => {
            // Kopf: Kennung (5), Version (2), Einheit (1), Dichte (4), Vorschau-Breite/-Höhe (2).
            match nutzlast.get(12..14) {
                Some([0, 0]) if nutzlast.len() == 14 => Umgang::Behalten,
                Some(_) => Umgang::JfifOhneVorschau,
                None => return Err(Unbereinigbar("JPEG: JFIF-Kopf zu kurz")),
            }
        }
        APP2 if nutzlast.starts_with(b"ICC_PROFILE\0") => Umgang::Behalten,
        APP14 if nutzlast.starts_with(b"Adobe") => Umgang::Behalten,
        // Alle übrigen APPn (Exif, XMP, MPF, FlashPix, Photoshop/IPTC, Hersteller) und COM.
        0xE0..=0xEF | 0xFE => Umgang::Weg,
        _ => return Err(Unbereinigbar("JPEG: unbekanntes Segment")),
    })
}

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let kurz = || Unbereinigbar("JPEG: Struktur bricht ab");
    if d.get(..2) != Some(&[0xFF, SOI]) {
        return Err(Unbereinigbar("JPEG: kein SOI"));
    }
    // Direkt in den Ausgabepuffer schreiben, nie ein Vektor je Teil: 13 Mio. eigenständige
    // `FFD0` in 25 MiB ergäben sonst ein Vielfaches der Datei im Speicher (Review LFH-747). Die
    // Ausrichtung steht erst im APP1, das Mini-EXIF gehört aber direkt hinter SOI bzw. ein
    // führendes JFIF-APP0; es kommt am Ende an der gemerkten Stelle hinein.
    let mut aus = Vec::with_capacity(d.len());
    aus.extend_from_slice(&[0xFF, SOI]);
    let mut einfuegestelle = aus.len();
    let mut erster_teil = true;
    let mut ausrichtung = None;
    let mut exif_gesehen = false;
    let mut pos = 2usize;
    loop {
        if *d.get(pos).ok_or_else(kurz)? != 0xFF {
            return Err(Unbereinigbar("JPEG: Marker erwartet"));
        }
        // Füllbytes vor dem Marker überspringen.
        while d.get(pos) == Some(&0xFF) {
            pos += 1;
        }
        let marker = *d.get(pos).ok_or_else(kurz)?;
        pos += 1;
        match marker {
            EOI => {
                // Alles nach dem ersten EOI fällt weg (MPF-Zweitbilder, Hersteller-Trailer).
                aus.extend_from_slice(&[0xFF, EOI]);
                break;
            }
            SOI | 0x00 => return Err(Unbereinigbar("JPEG: SOI oder Stopfbyte an Markerstelle")),
            // Standalone: TEM und RSTn außerhalb eines Scans.
            0x01 | 0xD0..=0xD7 => aus.extend_from_slice(&[0xFF, marker]),
            _ => {
                let laenge = u16::from_be_bytes(
                    d.get(pos..pos + 2)
                        .ok_or_else(kurz)?
                        .try_into()
                        .map_err(|_| kurz())?,
                ) as usize;
                if laenge < 2 {
                    return Err(Unbereinigbar("JPEG: Segmentlänge < 2"));
                }
                let ende = pos + laenge;
                let segment = d.get(pos - 2..ende).ok_or_else(kurz)?;
                let nutzlast = &segment[4..];
                if marker == APP1 && !exif_gesehen && nutzlast.starts_with(b"Exif\0\0") {
                    exif_gesehen = true;
                    ausrichtung = exif::ausrichtung(&nutzlast[6..]);
                }
                let vorher = aus.len();
                match umgang(marker, nutzlast)? {
                    Umgang::Behalten => aus.extend_from_slice(segment),
                    Umgang::JfifOhneVorschau => {
                        aus.extend_from_slice(&[0xFF, APP0, 0x00, 0x10]);
                        aus.extend_from_slice(&nutzlast[..12]);
                        aus.extend_from_slice(&[0, 0]);
                    }
                    Umgang::Weg => {}
                }
                if aus.len() > vorher {
                    if erster_teil && marker == APP0 {
                        einfuegestelle = aus.len();
                    }
                    erster_teil = false;
                }
                pos = ende;
                if marker == SOS {
                    let scan_ende = ende_der_entropiedaten(d, pos)?;
                    aus.extend_from_slice(&d[pos..scan_ende]);
                    pos = scan_ende;
                }
                continue;
            }
        }
        erster_teil = false;
    }
    let mut exif_stelle = None;
    if let Some((wert, l)) = ausrichtung {
        let mini = exif::mini_tiff(wert, l);
        let mut app1 = vec![0xFF, APP1];
        app1.extend_from_slice(&((2 + 6 + mini.len()) as u16).to_be_bytes());
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend(mini);
        exif_stelle = Some(einfuegestelle + 4);
        aus.splice(einfuegestelle..einfuegestelle, app1);
    }
    Ok(Bereinigt {
        daten: aus,
        exif_stelle,
    })
}

/// Sucht das Ende der Entropiedaten ab `start`: den nächsten Marker, der weder Stopfbyte
/// (`FF00`) noch Restart (`FFD0`–`FFD7`) noch Füllbyte ist.
fn ende_der_entropiedaten(d: &[u8], start: usize) -> Result<usize, Unbereinigbar> {
    let mut i = start;
    while i + 1 < d.len() {
        if d[i] == 0xFF {
            match d[i + 1] {
                0x00 | 0xD0..=0xD7 => i += 2,
                0xFF => i += 1,
                _ => return Ok(i),
            }
        } else {
            i += 1;
        }
    }
    Err(Unbereinigbar("JPEG: kein Marker nach den Entropiedaten"))
}

#[cfg(test)]
mod tests {
    use super::super::testbau::*;
    use super::*;

    fn bereinigt(d: &[u8]) -> Bereinigt {
        bereinigen(d).expect("bereinigbar")
    }

    #[test]
    fn entfernt_jeden_metadatenort() {
        for be in [false, true] {
            for progressiv in [false, true] {
                let aus = bereinigt(&jpeg(be, Some(6), progressiv)).daten;
                assert!(!enthaelt(&aus, MARKER), "be={be} progressiv={progressiv}");
                assert!(!enthaelt(&aus, b"SEFH"));
                assert!(!enthaelt(&aus, b"MPF\0"));
                assert!(!enthaelt(&aus, b"JFXX"));
            }
        }
    }

    #[test]
    fn behaelt_bilddaten_farbprofil_und_adobe_bytegleich() {
        let aus = bereinigt(&jpeg(false, None, true)).daten;
        assert!(enthaelt(&aus, &segment(0xE2, ICC_SEGMENT_NUTZLAST)));
        assert!(enthaelt(&aus, &segment(0xEE, ADOBE_NUTZLAST)));
        assert!(enthaelt(&aus, SCAN1));
        assert!(enthaelt(&aus, SCAN2));
        assert!(aus.ends_with(&[0xFF, 0xD9]));
        // JFIF bleibt, aber ohne Vorschau: 16 Bytes Segment, Vorschaugröße 0×0.
        assert_eq!(&aus[2..6], &[0xFF, 0xE0, 0x00, 0x10]);
        assert_eq!(&aus[6..11], b"JFIF\0");
        assert_eq!(&aus[18..20], &[0, 0]);
    }

    #[test]
    fn ausrichtung_bleibt_als_mini_exif() {
        for be in [false, true] {
            let b = bereinigt(&jpeg(be, Some(6), false));
            let stelle = b.exif_stelle.expect("Mini-EXIF");
            // Direkt hinter SOI + JFIF-APP0 (2 + 18 Bytes) + APP1-Kopf (4 Bytes).
            assert_eq!(stelle, 2 + 18 + 4);
            let tiff = &b.daten[stelle + 6..];
            assert!(exif::ist_mini_tiff(tiff));
            assert_eq!(
                exif::ausrichtung(tiff).map(|(w, l)| (w, l.be)),
                Some((6, be))
            );
        }
    }

    #[test]
    fn ohne_ausrichtung_kein_exif() {
        let b = bereinigt(&jpeg(false, None, false));
        assert!(b.exif_stelle.is_none());
        assert!(!enthaelt(&b.daten, b"Exif"));
        let b = bereinigt(&jpeg(false, Some(1), false));
        assert!(b.exif_stelle.is_none());
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigt(&jpeg(true, Some(8), true)).daten;
        let zweimal = bereinigt(&einmal).daten;
        assert_eq!(einmal, zweimal);
    }

    #[test]
    fn abgebrochenes_metadatensegment_ist_unbereinigbar() {
        let j = jpeg(false, Some(6), false);
        // Mitten im Exif-APP1 abschneiden.
        assert!(bereinigen(&j[..60]).is_err());
        // Ohne EOI.
        let ohne_eoi = &j[..j
            .windows(2)
            .position(|w| w == [0xFF, 0xFF])
            .expect("Füllbytes")];
        assert!(bereinigen(ohne_eoi).is_err());
    }

    #[test]
    fn unbekannter_marker_ist_unbereinigbar() {
        let mut j = vec![0xFF, 0xD8];
        j.extend(segment(0xF7, b"JPEG-LS"));
        j.extend_from_slice(&[0xFF, 0xD9]);
        assert!(bereinigen(&j).is_err());
    }
}
