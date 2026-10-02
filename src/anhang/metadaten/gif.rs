//! GIF (LFH-747, design.md D4): Kommentare und fremde Application Extensions (darunter XMP)
//! weglassen, nach dem Trailer abschneiden. Graphic Control und Plain Text bleiben, weil sie
//! dargestellt werden; die Schleife (`NETSCAPE2.0`/`ANIMEXTS1.0`) und das ICC-Profil bleiben.

use super::{Bereinigt, Unbereinigbar};

/// Application-Kennungen (die ersten 8 Bytes), die bleiben.
const ANWENDUNGEN: &[&[u8; 8]] = &[b"NETSCAPE", b"ANIMEXTS", b"ICCRGBG1"];

fn kurz() -> Unbereinigbar {
    Unbereinigbar("GIF: Block bricht ab")
}

/// Ende einer Folge von Unterblöcken ab `pos` (hinter dem Null-Block).
fn ende_der_unterbloecke(d: &[u8], mut pos: usize) -> Result<usize, Unbereinigbar> {
    loop {
        let n = *d.get(pos).ok_or_else(kurz)? as usize;
        pos += 1;
        if n == 0 {
            return Ok(pos);
        }
        pos += n;
        if pos > d.len() {
            return Err(kurz());
        }
    }
}

fn farbtabelle(packed: u8) -> usize {
    if packed & 0x80 != 0 {
        3 * (1usize << ((packed & 0x07) + 1))
    } else {
        0
    }
}

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    // Kopf (6) + Logical Screen Descriptor (7) + globale Farbtabelle.
    let packed = *d.get(10).ok_or_else(kurz)?;
    let mut pos = 13 + farbtabelle(packed);
    let mut aus = d.get(..pos).ok_or_else(kurz)?.to_vec();
    loop {
        let start = pos;
        match *d.get(pos).ok_or_else(kurz)? {
            0x3B => {
                aus.push(0x3B);
                break;
            }
            0x2C => {
                // Image Descriptor (10), lokale Farbtabelle, LZW-Mindestcodegröße (1), Daten.
                let packed = *d.get(pos + 9).ok_or_else(kurz)?;
                pos += 10 + farbtabelle(packed) + 1;
                pos = ende_der_unterbloecke(d, pos)?;
                aus.extend_from_slice(&d[start..pos]);
            }
            0x21 => {
                let label = *d.get(pos + 1).ok_or_else(kurz)?;
                let behalten = match label {
                    0xF9 | 0x01 => true,
                    0xFF => {
                        // Erster Unterblock: 11 Bytes Kennung (8) + Authentisierung (3).
                        let kennung = d.get(pos + 3..pos + 11).ok_or_else(kurz)?;
                        d.get(pos + 2) == Some(&11) && ANWENDUNGEN.iter().any(|a| kennung == &a[..])
                    }
                    // Kommentar (0xFE) und unbekannte Extensions.
                    _ => false,
                };
                pos = ende_der_unterbloecke(d, pos + 2)?;
                if behalten {
                    aus.extend_from_slice(&d[start..pos]);
                }
            }
            _ => return Err(Unbereinigbar("GIF: unbekannter Block")),
        }
    }
    Ok(Bereinigt::ohne_exif(aus))
}

#[cfg(test)]
mod tests {
    use super::super::testbau::*;
    use super::*;

    #[test]
    fn entfernt_kommentar_xmp_und_alles_nach_dem_trailer() {
        let aus = bereinigen(&gif()).expect("GIF").daten;
        assert!(!enthaelt(&aus, MARKER));
        assert!(!enthaelt(&aus, b"XMP Data"));
        assert!(enthaelt(&aus, b"NETSCAPE2.0\x03\x01\x00\x00\x00"));
        assert!(enthaelt(&aus, &[0x21, 0xF9, 4, 0, 10, 0, 0, 0]));
        assert!(enthaelt(&aus, &unterbloecke(GIF_PIXEL)));
        assert_eq!(aus.last(), Some(&0x3B));
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigen(&gif()).expect("GIF").daten;
        assert_eq!(bereinigen(&einmal).expect("GIF").daten, einmal);
    }

    #[test]
    fn ohne_trailer_ist_unbereinigbar() {
        let g = gif();
        // Der Trailer steht direkt vor dem angehängten `MARKER_NACH_TRAILER`.
        let trailer = g.windows(11).position(|w| w == b"MARKER_NACH").unwrap() - 1;
        assert_eq!(g[trailer], 0x3B);
        assert!(bereinigen(&g[..trailer]).is_err());
    }
}
