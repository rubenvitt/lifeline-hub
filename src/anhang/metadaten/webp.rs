//! WebP (LFH-747, design.md D4): RIFF-Chunks auf einer Positivliste behalten, `EXIF` und `XMP `
//! weglassen, die Flags in `VP8X` nachziehen und die RIFF-Länge neu berechnen. Eine Ausrichtung
//! ≠ 1 kommt als Mini-EXIF ans Ende (nur im erweiterten Format mit `VP8X`).

use super::{exif, Bereinigt, Unbereinigbar};

const BEHALTEN: &[&[u8; 4]] = &[
    b"VP8 ", b"VP8L", b"VP8X", b"ALPH", b"ANIM", b"ANMF", b"ICCP",
];

const FLAG_EXIF: u8 = 0x08;
const FLAG_XMP: u8 = 0x04;

fn kurz() -> Unbereinigbar {
    Unbereinigbar("WebP: Chunk bricht ab")
}

fn le32(d: &[u8], at: usize) -> Result<usize, Unbereinigbar> {
    let b: [u8; 4] = d
        .get(at..at.checked_add(4).ok_or_else(kurz)?)
        .ok_or_else(kurz)?
        .try_into()
        .map_err(|_| kurz())?;
    Ok(u32::from_le_bytes(b) as usize)
}

/// Ein `ANMF`-Frame trägt hinter 16 Bytes Kopf eigene Chunks. Erlaubt sind nur Bilddaten; ein
/// darin geschachteltes `EXIF` oder `XMP ` liefe sonst bytegleich durch (Review LFH-747).
fn pruefe_anmf(daten: &[u8]) -> Result<(), Unbereinigbar> {
    const IM_FRAME: &[&[u8; 4]] = &[b"ALPH", b"VP8 ", b"VP8L"];
    let mut pos = 16usize;
    if daten.len() < pos {
        return Err(kurz());
    }
    while pos < daten.len() {
        let typ = daten.get(pos..pos + 4).ok_or_else(kurz)?;
        if !IM_FRAME.iter().any(|t| typ == &t[..]) {
            return Err(Unbereinigbar("WebP: unbekannter Chunk im ANMF-Frame"));
        }
        let laenge = le32(daten, pos + 4)?;
        let daten_ende = (pos + 8).checked_add(laenge).ok_or_else(kurz)?;
        if daten_ende > daten.len() {
            return Err(kurz());
        }
        pos = daten_ende + (laenge & 1);
    }
    Ok(())
}

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let riff_ende = le32(d, 4)?.checked_add(8).ok_or_else(kurz)?;
    if riff_ende > d.len() {
        return Err(kurz());
    }
    // Direkt in den Ausgabepuffer, nie ein Vektor je Chunk (Speicher-Verstärkung, Review
    // LFH-747). RIFF-Länge und VP8X-Flags werden am Ende nachgetragen.
    let mut aus = Vec::with_capacity(riff_ende);
    aus.extend_from_slice(b"RIFF\0\0\0\0WEBP");
    let mut ausrichtung = None;
    let mut vp8x_flags = None;
    let mut pos = 12usize;
    while pos < riff_ende {
        let typ: &[u8; 4] = d
            .get(pos..pos + 4)
            .ok_or_else(kurz)?
            .try_into()
            .map_err(|_| kurz())?;
        let laenge = le32(d, pos + 4)?;
        let daten_ende = (pos + 8).checked_add(laenge).ok_or_else(kurz)?;
        if daten_ende > riff_ende {
            return Err(kurz());
        }
        // Auffüllbyte bei ungerader Länge; am Dateiende darf es fehlen.
        let ende = (daten_ende + (laenge & 1)).min(riff_ende);
        let daten = &d[pos + 8..daten_ende];
        if typ == b"EXIF" && ausrichtung.is_none() {
            let tiff = daten.strip_prefix(b"Exif\0\0").unwrap_or(daten);
            ausrichtung = exif::ausrichtung(tiff);
        }
        if BEHALTEN.contains(&typ) {
            if typ == b"VP8X" {
                if laenge < 10 {
                    return Err(Unbereinigbar("WebP: VP8X zu kurz"));
                }
                vp8x_flags = Some(aus.len() + 8);
            }
            if typ == b"ANMF" {
                pruefe_anmf(daten)?;
            }
            aus.extend_from_slice(&d[pos..ende]);
            if ende < daten_ende + (laenge & 1) {
                aus.push(0);
            }
        }
        pos = ende;
    }
    // Einfaches Format (ohne VP8X): kann keine Metadaten tragen und keine Ausrichtung ausdrücken.
    if let Some(i) = vp8x_flags {
        aus[i] &= !(FLAG_EXIF | FLAG_XMP);
        if let Some((wert, l)) = ausrichtung {
            aus[i] |= FLAG_EXIF;
            let mini = exif::mini_tiff(wert, l);
            aus.extend_from_slice(b"EXIF");
            aus.extend_from_slice(&(mini.len() as u32).to_le_bytes());
            aus.extend(mini);
        }
    }
    let riff = (aus.len() - 8) as u32;
    aus[4..8].copy_from_slice(&riff.to_le_bytes());
    Ok(Bereinigt::ohne_exif(aus))
}

#[cfg(test)]
mod tests {
    use super::super::testbau::*;
    use super::*;

    fn chunks(d: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        assert_eq!(&d[..4], b"RIFF");
        assert_eq!(
            u32::from_le_bytes(d[4..8].try_into().unwrap()) as usize + 8,
            d.len()
        );
        let mut pos = 12;
        let mut v = Vec::new();
        while pos < d.len() {
            let n = u32::from_le_bytes(d[pos + 4..pos + 8].try_into().unwrap()) as usize;
            v.push((
                d[pos..pos + 4].try_into().unwrap(),
                d[pos + 8..pos + 8 + n].to_vec(),
            ));
            pos += 8 + n + (n & 1);
        }
        assert_eq!(pos, d.len());
        v
    }

    #[test]
    fn einfaches_vp8_bleibt_unveraendert() {
        let w = webp_einfach();
        assert_eq!(bereinigen(&w).expect("WebP").daten, w);
    }

    #[test]
    fn entfernt_exif_xmp_und_private_chunks_und_zieht_flags_nach() {
        let aus = bereinigen(&webp_erweitert(false, None))
            .expect("WebP")
            .daten;
        assert!(!enthaelt(&aus, MARKER));
        let c = chunks(&aus);
        let typen: Vec<[u8; 4]> = c.iter().map(|(t, _)| *t).collect();
        assert_eq!(typen, vec![*b"VP8X", *b"ICCP", *b"VP8 "]);
        assert_eq!(c[0].1[0], 0x20, "nur noch ICC");
        assert_eq!(c[2].1, VP8);
    }

    #[test]
    fn ausrichtung_als_mini_exif_mit_flag() {
        for be in [false, true] {
            let aus = bereinigen(&webp_erweitert(be, Some(6)))
                .expect("WebP")
                .daten;
            let c = chunks(&aus);
            let typen: Vec<[u8; 4]> = c.iter().map(|(t, _)| *t).collect();
            assert_eq!(typen, vec![*b"VP8X", *b"ICCP", *b"VP8 ", *b"EXIF"]);
            assert_eq!(c[0].1[0], 0x20 | FLAG_EXIF);
            assert!(exif::ist_mini_tiff(&c[3].1));
        }
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigen(&webp_erweitert(true, Some(8)))
            .expect("WebP")
            .daten;
        assert_eq!(bereinigen(&einmal).expect("WebP").daten, einmal);
    }

    #[test]
    fn anmf_mit_geschachteltem_exif_ist_unbereinigbar() {
        let mut frame = vec![0u8; 16];
        frame.extend(riff_chunk(b"VP8 ", VP8));
        let sauber = riff(&[
            riff_chunk(b"VP8X", &[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            riff_chunk(b"ANIM", &[0; 6]),
            riff_chunk(b"ANMF", &frame),
        ]);
        assert_eq!(bereinigen(&sauber).expect("ANMF").daten, sauber);
        frame.extend(riff_chunk(b"EXIF", &exif_tiff(false, Some(6))));
        let mit_exif = riff(&[
            riff_chunk(b"VP8X", &[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            riff_chunk(b"ANMF", &frame),
        ]);
        assert!(bereinigen(&mit_exif).is_err());
    }

    #[test]
    fn riff_laenge_jenseits_des_endes_ist_unbereinigbar() {
        let mut w = webp_erweitert(false, None);
        w[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(bereinigen(&w).is_err());
    }
}
