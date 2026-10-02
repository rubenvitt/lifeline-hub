//! WebP (LFH-747, design.md D4): RIFF-Chunks auf einer Positivliste behalten, `EXIF` und `XMP `
//! weglassen, die Flags in `VP8X` nachziehen und die RIFF-Länge neu berechnen. Eine Ausrichtung
//! ≠ 1 kommt als Mini-EXIF ans Ende (nur im erweiterten Format mit `VP8X`).

use super::{exif, Bereinigt, Unbereinigbar};

const BEHALTEN: &[&[u8; 4]] = &[
    b"VP8 ", b"VP8L", b"VP8X", b"ALPH", b"ANIM", b"ANMF", b"ICCP",
];

const FLAG_EXIF: u8 = 0x08;
const FLAG_XMP: u8 = 0x04;

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let kurz = || Unbereinigbar("WebP: Chunk bricht ab");
    let riff_laenge = u32::from_le_bytes(
        d.get(4..8)
            .ok_or_else(kurz)?
            .try_into()
            .map_err(|_| kurz())?,
    ) as usize;
    let riff_ende = riff_laenge.checked_add(8).ok_or_else(kurz)?;
    if riff_ende > d.len() {
        return Err(kurz());
    }
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    let mut ausrichtung = None;
    let mut vp8x_index = None;
    let mut pos = 12usize;
    while pos < riff_ende {
        let typ: &[u8; 4] = d
            .get(pos..pos + 4)
            .ok_or_else(kurz)?
            .try_into()
            .map_err(|_| kurz())?;
        let laenge = u32::from_le_bytes(
            d.get(pos + 4..pos + 8)
                .ok_or_else(kurz)?
                .try_into()
                .map_err(|_| kurz())?,
        ) as usize;
        let daten_ende = (pos + 8).checked_add(laenge).ok_or_else(kurz)?;
        // Auffüllbyte bei ungerader Länge; am Dateiende darf es fehlen.
        let ende = (daten_ende + (laenge & 1)).min(riff_ende);
        if daten_ende > riff_ende {
            return Err(kurz());
        }
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
                vp8x_index = Some(chunks.len());
            }
            let mut c = d[pos..ende].to_vec();
            if c.len() < 8 + laenge + (laenge & 1) {
                c.push(0);
            }
            chunks.push(c);
        }
        pos = ende;
    }
    match vp8x_index {
        Some(i) => {
            let flags = &mut chunks[i][8];
            *flags &= !(FLAG_EXIF | FLAG_XMP);
            if let Some((wert, l)) = ausrichtung {
                *flags |= FLAG_EXIF;
                let mini = exif::mini_tiff(wert, l);
                let mut c = b"EXIF".to_vec();
                c.extend_from_slice(&(mini.len() as u32).to_le_bytes());
                c.extend(mini);
                chunks.push(c);
            }
        }
        // Einfaches Format: kann keine Metadaten tragen und keine Ausrichtung ausdrücken.
        None => {}
    }
    let inhalt = chunks.concat();
    let mut aus = Vec::with_capacity(inhalt.len() + 12);
    aus.extend_from_slice(b"RIFF");
    aus.extend_from_slice(&((inhalt.len() + 4) as u32).to_le_bytes());
    aus.extend_from_slice(b"WEBP");
    aus.extend(inhalt);
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
    fn riff_laenge_jenseits_des_endes_ist_unbereinigbar() {
        let mut w = webp_erweitert(false, None);
        w[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(bereinigen(&w).is_err());
    }
}
