//! PNG (LFH-747, design.md D4): Chunks auf einer Positivliste behalten, alle Textchunks, `eXIf`
//! und `tIME` weglassen, nach `IEND` abschneiden. Eine Ausrichtung ≠ 1 kommt als neues `eXIf`
//! mit Mini-EXIF vor das erste `IDAT`.

use super::{exif, Bereinigt, Unbereinigbar};

/// Hilfs-Chunks, die das Bild darstellen und keine Personen- oder Gerätedaten tragen.
const BEHALTEN: &[&[u8; 4]] = &[
    b"tRNS", b"cHRM", b"gAMA", b"iCCP", b"sBIT", b"sRGB", b"cICP", b"mDCv", b"cLLi", b"bKGD",
    b"hIST", b"pHYs", b"sPLT", b"acTL", b"fcTL", b"fdAT",
];

/// Kritische Chunks; jeder andere kritische Chunk ist unbekannt.
const KRITISCH: &[&[u8; 4]] = &[b"IHDR", b"PLTE", b"IDAT", b"IEND"];

const SIGNATUR: &[u8] = b"\x89PNG\r\n\x1a\n";

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let kurz = || Unbereinigbar("PNG: Chunk bricht ab");
    let mut aus = Vec::with_capacity(d.len());
    aus.extend_from_slice(SIGNATUR);
    let mut ausrichtung = None;
    let mut mini_geschrieben = false;
    let mut pos = SIGNATUR.len();
    loop {
        let laenge = u32::from_be_bytes(
            d.get(pos..pos + 4)
                .ok_or_else(kurz)?
                .try_into()
                .map_err(|_| kurz())?,
        ) as usize;
        let typ: &[u8; 4] = d
            .get(pos + 4..pos + 8)
            .ok_or_else(kurz)?
            .try_into()
            .map_err(|_| kurz())?;
        let ende = pos
            .checked_add(12)
            .and_then(|p| p.checked_add(laenge))
            .ok_or_else(kurz)?;
        let ganz = d.get(pos..ende).ok_or_else(kurz)?;
        let daten = &ganz[8..8 + laenge];
        // Bit 5 des ersten Bytes: 0 = kritisch.
        let kritisch = typ[0] & 0x20 == 0;
        if typ == b"eXIf" && ausrichtung.is_none() {
            let tiff = daten.strip_prefix(b"Exif\0\0").unwrap_or(daten);
            ausrichtung = exif::ausrichtung(tiff);
        }
        if typ == b"IDAT" && !mini_geschrieben {
            mini_geschrieben = true;
            if let Some((wert, l)) = ausrichtung {
                aus.extend(baue_chunk(b"eXIf", &exif::mini_tiff(wert, l)));
            }
        }
        if kritisch {
            if !KRITISCH.contains(&typ) {
                return Err(Unbereinigbar("PNG: unbekannter kritischer Chunk"));
            }
            aus.extend_from_slice(ganz);
        } else if BEHALTEN.contains(&typ) {
            aus.extend_from_slice(ganz);
        }
        pos = ende;
        if typ == b"IEND" {
            break;
        }
    }
    Ok(Bereinigt::ohne_exif(aus))
}

fn baue_chunk(typ: &[u8; 4], daten: &[u8]) -> Vec<u8> {
    let mut c = (daten.len() as u32).to_be_bytes().to_vec();
    c.extend_from_slice(typ);
    c.extend_from_slice(daten);
    c.extend_from_slice(&crc32(&c[4..]).to_be_bytes());
    c
}

/// CRC-32 (ISO-HDLC, Polynom 0xEDB88320) wie PNG ihn über Typ und Daten verlangt.
pub(crate) fn crc32(d: &[u8]) -> u32 {
    const TABELLE: [u32; 256] = {
        let mut t = [0u32; 256];
        let mut n = 0;
        while n < 256 {
            let mut c = n as u32;
            let mut k = 0;
            while k < 8 {
                c = if c & 1 == 1 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
                k += 1;
            }
            t[n] = c;
            n += 1;
        }
        t
    };
    let mut c = 0xFFFF_FFFFu32;
    for &b in d {
        c = TABELLE[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    c ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod tests {
    use super::super::testbau::*;
    use super::*;

    /// Die Chunks einer PNG-Ausgabe als (Typ, Daten); prüft dabei jede CRC.
    fn chunks(d: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        assert!(d.starts_with(SIGNATUR));
        let mut pos = SIGNATUR.len();
        let mut v = Vec::new();
        while pos < d.len() {
            let n = u32::from_be_bytes(d[pos..pos + 4].try_into().unwrap()) as usize;
            let typ: [u8; 4] = d[pos + 4..pos + 8].try_into().unwrap();
            let crc = u32::from_be_bytes(d[pos + 8 + n..pos + 12 + n].try_into().unwrap());
            assert_eq!(crc, crc32(&d[pos + 4..pos + 8 + n]), "CRC von {:?}", typ);
            v.push((typ, d[pos + 8..pos + 8 + n].to_vec()));
            pos += 12 + n;
        }
        v
    }

    #[test]
    fn crc32_referenzwert() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn entfernt_text_xmp_exif_zeit_und_private_chunks() {
        let aus = bereinigen(&png(false, None)).expect("PNG").daten;
        assert!(!enthaelt(&aus, MARKER));
        let typen: Vec<[u8; 4]> = chunks(&aus).into_iter().map(|(t, _)| t).collect();
        assert_eq!(typen, vec![*b"IHDR", *b"iCCP", *b"IDAT", *b"IEND"]);
    }

    #[test]
    fn farbprofil_und_bilddaten_bytegleich() {
        let aus = bereinigen(&png(true, Some(6))).expect("PNG").daten;
        assert!(enthaelt(&aus, &chunk(b"iCCP", ICCP)));
        assert!(enthaelt(&aus, &chunk(b"IDAT", IDAT)));
    }

    #[test]
    fn ausrichtung_als_mini_exif_vor_idat() {
        for be in [false, true] {
            let aus = bereinigen(&png(be, Some(6))).expect("PNG").daten;
            let c = chunks(&aus);
            let typen: Vec<[u8; 4]> = c.iter().map(|(t, _)| *t).collect();
            assert_eq!(
                typen,
                vec![*b"IHDR", *b"iCCP", *b"eXIf", *b"IDAT", *b"IEND"]
            );
            assert!(exif::ist_mini_tiff(&c[2].1));
            assert_eq!(exif::ausrichtung(&c[2].1).map(|(w, _)| w), Some(6));
        }
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigen(&png(false, Some(3))).expect("PNG").daten;
        assert_eq!(bereinigen(&einmal).expect("PNG").daten, einmal);
    }

    #[test]
    fn unbekannter_kritischer_chunk_ist_unbereinigbar() {
        let mut p = SIGNATUR.to_vec();
        p.extend(chunk(b"IHDR", IHDR));
        p.extend(chunk(b"XYZW", b"?"));
        p.extend(chunk(b"IEND", b""));
        assert!(bereinigen(&p).is_err());
    }

    #[test]
    fn ohne_iend_ist_unbereinigbar() {
        let p = png(false, None);
        let iend = p.windows(4).position(|w| w == b"IEND").unwrap();
        assert!(bereinigen(&p[..iend - 4]).is_err());
    }
}
