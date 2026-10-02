//! TIFF-Grundlagen für EXIF (LFH-747, design.md D4 „Mini-EXIF“): Byte-Reihenfolge, Ausrichtung
//! (Tag 274) aus IFD0 lesen und ein Mini-EXIF bauen, das nur die Ausrichtung trägt.

/// Tag der Ausrichtung (Orientation).
pub(super) const TAG_AUSRICHTUNG: u16 = 274;

/// Liest Zahlen in der Byte-Reihenfolge eines TIFF-Blocks, immer mit geprüften Grenzen.
#[derive(Clone, Copy)]
pub(super) struct Leser {
    pub be: bool,
}

impl Leser {
    /// Byte-Reihenfolge aus dem TIFF-Kopf (`II*\0` oder `MM\0*`); BigTIFF und alles andere `None`.
    pub fn aus_kopf(tiff: &[u8]) -> Option<Leser> {
        match tiff.get(..4)? {
            b"II*\0" => Some(Leser { be: false }),
            b"MM\0*" => Some(Leser { be: true }),
            _ => None,
        }
    }

    pub fn u16(&self, d: &[u8], at: usize) -> Option<u16> {
        let b: [u8; 2] = d.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(if self.be {
            u16::from_be_bytes(b)
        } else {
            u16::from_le_bytes(b)
        })
    }

    pub fn u32(&self, d: &[u8], at: usize) -> Option<u32> {
        let b: [u8; 4] = d.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(if self.be {
            u32::from_be_bytes(b)
        } else {
            u32::from_le_bytes(b)
        })
    }

    pub fn schreibe_u16(&self, d: &mut [u8], at: usize, v: u16) -> Option<()> {
        let b = if self.be {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        };
        d.get_mut(at..at.checked_add(2)?)?.copy_from_slice(&b);
        Some(())
    }
}

/// Die Ausrichtung aus IFD0 eines TIFF-Blocks, nur wenn sie ein gültiger Wert ungleich 1 ist
/// (1 ist „normal“ und braucht kein Mini-EXIF). Jeder Strukturfehler ergibt `None`.
pub(super) fn ausrichtung(tiff: &[u8]) -> Option<(u16, Leser)> {
    let l = Leser::aus_kopf(tiff)?;
    let ifd0 = l.u32(tiff, 4)? as usize;
    let anzahl = l.u16(tiff, ifd0)? as usize;
    for i in 0..anzahl {
        let e = ifd0.checked_add(2)?.checked_add(i.checked_mul(12)?)?;
        if l.u16(tiff, e)? == TAG_AUSRICHTUNG {
            // SHORT, Anzahl 1: Wert steht inline in den ersten zwei Bytes des Wertfelds.
            if l.u16(tiff, e + 2)? != 3 || l.u32(tiff, e + 4)? != 1 {
                return None;
            }
            let wert = l.u16(tiff, e + 8)?;
            return (2..=8).contains(&wert).then_some((wert, l));
        }
    }
    None
}

/// Länge eines Mini-EXIF-TIFF-Blocks: Kopf (8), Zähler (2), ein Eintrag (12), Nachfolger (4).
pub(super) const MINI_LAENGE: usize = 26;

/// Ein TIFF-Block mit genau einem Eintrag, der Ausrichtung, in der Byte-Reihenfolge `l`.
pub(super) fn mini_tiff(wert: u16, l: Leser) -> Vec<u8> {
    let mut t = vec![0u8; MINI_LAENGE];
    t[..4].copy_from_slice(if l.be { b"MM\0*" } else { b"II*\0" });
    let (u16b, u32b) = (
        |v: u16| {
            if l.be {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        },
        |v: u32| {
            if l.be {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        },
    );
    t[4..8].copy_from_slice(&u32b(8));
    t[8..10].copy_from_slice(&u16b(1));
    t[10..12].copy_from_slice(&u16b(TAG_AUSRICHTUNG));
    t[12..14].copy_from_slice(&u16b(3));
    t[14..18].copy_from_slice(&u32b(1));
    t[18..20].copy_from_slice(&u16b(wert));
    // t[20..22] Füllung, t[22..26] Nachfolger 0.
    t
}

/// Ob `tiff` mit einem Mini-EXIF aus [`mini_tiff`] beginnt: IFD0 bei 8, genau ein Eintrag
/// (Ausrichtung), kein Nachfolger. Das Kontrollnetz lässt nur so ein `Exif\0\0` stehen.
pub(super) fn ist_mini_tiff(tiff: &[u8]) -> bool {
    let Some(l) = Leser::aus_kopf(tiff) else {
        return false;
    };
    l.u32(tiff, 4) == Some(8)
        && l.u16(tiff, 8) == Some(1)
        && l.u16(tiff, 10) == Some(TAG_AUSRICHTUNG)
        && l.u16(tiff, 12) == Some(3)
        && l.u32(tiff, 14) == Some(1)
        && l.u32(tiff, 22) == Some(0)
}

#[cfg(test)]
mod tests {
    use super::super::testbau::{exif_tiff, Zufall};
    use super::*;

    #[test]
    fn liest_ausrichtung_in_beiden_byte_reihenfolgen() {
        for be in [false, true] {
            let (wert, l) = ausrichtung(&exif_tiff(be, Some(6))).expect("Ausrichtung");
            assert_eq!(wert, 6);
            assert_eq!(l.be, be);
        }
    }

    #[test]
    fn ausrichtung_eins_oder_fehlend_braucht_kein_mini_exif() {
        assert!(ausrichtung(&exif_tiff(false, Some(1))).is_none());
        assert!(ausrichtung(&exif_tiff(true, None)).is_none());
        assert!(ausrichtung(&exif_tiff(false, Some(9))).is_none());
    }

    #[test]
    fn mini_tiff_round_trip() {
        for be in [false, true] {
            let mini = mini_tiff(8, Leser { be });
            assert_eq!(mini.len(), MINI_LAENGE);
            assert!(ist_mini_tiff(&mini));
            assert_eq!(ausrichtung(&mini).map(|(w, _)| w), Some(8));
        }
        assert!(!ist_mini_tiff(&exif_tiff(false, Some(6))));
    }

    #[test]
    fn kaputte_offsets_ergeben_none_statt_panic() {
        let voll = exif_tiff(true, Some(6));
        for n in 0..voll.len() {
            let _ = ausrichtung(&voll[..n]);
            let _ = ist_mini_tiff(&voll[..n]);
        }
        let mut z = Zufall(7);
        for _ in 0..500 {
            let mut d = voll.clone();
            let i = z.naechste(d.len());
            d[i] = z.naechste(256) as u8;
            let _ = ausrichtung(&d);
        }
        let mut riesig = voll.clone();
        riesig[4..8].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(ausrichtung(&riesig).is_none());
    }
}
