//! TIFF (LFH-747, design.md D4): auf jedem IFD der Kette (jeder Seite eines Scans) an Ort und
//! Stelle Textwerte nullen und die Unter-IFDs für Exif, GPS und Interop leeren. Keine Länge und
//! kein Offset ändern sich, die sortierte Tag-Reihenfolge bleibt; Ausrichtung und Bild-Tags
//! bleiben unberührt.

use super::exif::Leser;
use super::{Bereinigt, Unbereinigbar};

/// Tags, deren Wert genullt wird: Beschreibung, Gerät, Software, Zeit, Urheber, Rechner,
/// Copyright, XMP, IPTC, Photoshop.
const NULLEN: &[u16] = &[270, 271, 272, 305, 306, 315, 316, 33432, 700, 33723, 34377];

/// Zeiger auf Unter-IFDs, die geleert werden: Exif, GPS, Interop.
const LEEREN: &[u16] = &[34665, 34853, 40965];

/// Zeiger auf Unter-Bilder (DNG/Scanner), die wie eine Seite behandelt werden.
const UNTERBILDER: u16 = 330;

/// Obergrenze für besuchte IFDs, gegen Zyklen und aufgeblähte Ketten.
const MAX_IFDS: usize = 1024;

fn kurz() -> Unbereinigbar {
    Unbereinigbar("TIFF: Struktur bricht ab")
}

fn typgroesse(typ: u16) -> Option<usize> {
    Some(match typ {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 => 8,
        _ => return None,
    })
}

struct Lauf<'a> {
    d: &'a [u8],
    aus: Vec<u8>,
    l: Leser,
    besucht: Vec<usize>,
}

impl Lauf<'_> {
    fn besuche(&mut self, ifd: usize) -> Result<(), Unbereinigbar> {
        if self.besucht.contains(&ifd) {
            return Err(Unbereinigbar("TIFF: IFD-Zyklus"));
        }
        if self.besucht.len() >= MAX_IFDS {
            return Err(Unbereinigbar("TIFF: zu viele IFDs"));
        }
        self.besucht.push(ifd);
        Ok(())
    }

    /// Lage eines IFD: Anzahl der Einträge und Stelle des Nachfolger-Offsets.
    fn kopf(&self, ifd: usize) -> Result<(usize, usize), Unbereinigbar> {
        let n = self.l.u16(self.d, ifd).ok_or_else(kurz)? as usize;
        let nach = ifd + 2 + 12 * n;
        if nach + 4 > self.d.len() {
            return Err(kurz());
        }
        Ok((n, nach))
    }

    /// Wo der Wert eines Eintrags liegt und wie lang er ist.
    fn wert(&self, eintrag: usize) -> Result<(usize, usize), Unbereinigbar> {
        let typ = self.l.u16(self.d, eintrag + 2).ok_or_else(kurz)?;
        let anzahl = self.l.u32(self.d, eintrag + 4).ok_or_else(kurz)? as usize;
        let groesse = typgroesse(typ)
            .and_then(|g| g.checked_mul(anzahl))
            .ok_or(Unbereinigbar(
                "TIFF: unbekannter Typ an einem Metadaten-Tag",
            ))?;
        let ort = if groesse <= 4 {
            eintrag + 8
        } else {
            self.l.u32(self.d, eintrag + 8).ok_or_else(kurz)? as usize
        };
        if ort.checked_add(groesse).is_none_or(|e| e > self.d.len()) {
            return Err(kurz());
        }
        Ok((ort, groesse))
    }

    fn nullen(&mut self, ort: usize, laenge: usize) {
        self.aus[ort..ort + laenge].fill(0);
    }

    /// Die Zeiger eines Eintrags (LONG oder IFD, Anzahl ≥ 1).
    fn zeiger(&self, eintrag: usize) -> Result<Vec<usize>, Unbereinigbar> {
        let (ort, groesse) = self.wert(eintrag)?;
        (0..groesse / 4)
            .map(|i| {
                self.l
                    .u32(self.d, ort + 4 * i)
                    .map(|v| v as usize)
                    .ok_or_else(kurz)
            })
            .collect()
    }

    /// Eine Seite: Metadaten-Tags nullen, Metadaten-Unter-IFDs leeren, Unter-Bilder ebenso
    /// behandeln.
    fn seite(&mut self, ifd: usize) -> Result<(), Unbereinigbar> {
        self.besuche(ifd)?;
        let (n, _) = self.kopf(ifd)?;
        for i in 0..n {
            let e = ifd + 2 + 12 * i;
            let tag = self.l.u16(self.d, e).ok_or_else(kurz)?;
            if NULLEN.contains(&tag) {
                let (ort, groesse) = self.wert(e)?;
                self.nullen(ort, groesse);
            } else if LEEREN.contains(&tag) {
                for unter in self.zeiger(e)? {
                    self.leeren(unter)?;
                }
            } else if tag == UNTERBILDER {
                for unter in self.zeiger(e)? {
                    self.seite(unter)?;
                }
            }
        }
        Ok(())
    }

    /// Ein Metadaten-IFD leeren: die Werte aller Einträge nullen (rekursiv für Interop), dann die
    /// Tabelle nullen und den Zähler auf 0 setzen. Ein leeres IFD mit Nachfolger 0 ist gültig.
    fn leeren(&mut self, ifd: usize) -> Result<(), Unbereinigbar> {
        self.besuche(ifd)?;
        let (n, nach) = self.kopf(ifd)?;
        for i in 0..n {
            let e = ifd + 2 + 12 * i;
            let tag = self.l.u16(self.d, e).ok_or_else(kurz)?;
            if LEEREN.contains(&tag) {
                for unter in self.zeiger(e)? {
                    self.leeren(unter)?;
                }
            }
            // Werte außerhalb des Eintrags nullen; inline-Werte fallen mit der Tabelle.
            let typ = self.l.u16(self.d, e + 2).ok_or_else(kurz)?;
            if typgroesse(typ).is_some() {
                let (ort, groesse) = self.wert(e)?;
                if groesse > 4 {
                    self.nullen(ort, groesse);
                }
            } else {
                // Unbekannter Typ in einem Metadaten-IFD: Lage unbekannt, also nicht sicher.
                return Err(Unbereinigbar("TIFF: unbekannter Typ im Metadaten-IFD"));
            }
        }
        self.nullen(ifd, nach + 4 - ifd);
        // Zähler 0, Nachfolger 0 (durch das Nullen schon gesetzt).
        self.l
            .schreibe_u16(&mut self.aus, ifd, 0)
            .ok_or_else(kurz)?;
        Ok(())
    }
}

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let l = Leser::aus_kopf(d).ok_or(Unbereinigbar("TIFF: BigTIFF oder unbekannter Kopf"))?;
    let mut lauf = Lauf {
        d,
        aus: d.to_vec(),
        l,
        besucht: Vec::new(),
    };
    let mut ifd = l.u32(d, 4).ok_or_else(kurz)? as usize;
    while ifd != 0 {
        lauf.seite(ifd)?;
        let (_, nach) = lauf.kopf(ifd)?;
        ifd = l.u32(d, nach).ok_or_else(kurz)? as usize;
    }
    Ok(Bereinigt::ohne_exif(lauf.aus))
}

#[cfg(test)]
mod tests {
    use super::super::exif::TAG_AUSRICHTUNG;
    use super::super::testbau::*;
    use super::*;

    /// Die Tags eines IFD und sein Nachfolger.
    fn ifd(d: &[u8], l: Leser, at: usize) -> (Vec<u16>, usize) {
        let n = l.u16(d, at).unwrap() as usize;
        let tags = (0..n).map(|i| l.u16(d, at + 2 + 12 * i).unwrap()).collect();
        (tags, l.u32(d, at + 2 + 12 * n).unwrap() as usize)
    }

    #[test]
    fn nullt_metadaten_auf_beiden_seiten_und_behaelt_das_bild() {
        for be in [false, true] {
            let t = tiff_datei(be);
            let aus = bereinigen(&t).expect("TIFF").daten;
            assert_eq!(aus.len(), t.len());
            assert!(!enthaelt(&aus, MARKER), "be={be}");
            assert!(!enthaelt(&aus, b"xmpmeta"));
            assert!(enthaelt(&aus, TIFF_PIXEL_1));
            assert!(enthaelt(&aus, TIFF_PIXEL_2));

            let l = Leser { be };
            let erste = l.u32(&aus, 4).unwrap() as usize;
            let (tags1, zweite) = ifd(&aus, l, erste);
            // Alle Tags bleiben (sortiert), nur ihre Werte sind genullt.
            assert_eq!(tags1.len(), 15);
            assert!(tags1.windows(2).all(|w| w[0] < w[1]));
            assert!(zweite != 0, "Seite 2 bleibt verkettet");
            let (tags2, danach) = ifd(&aus, l, zweite);
            assert_eq!(tags2, vec![256, 257, 271, 273, 279]);
            assert_eq!(danach, 0);

            // Ausrichtung bleibt 6.
            let i = tags1.iter().position(|&t| t == TAG_AUSRICHTUNG).unwrap();
            assert_eq!(l.u16(&aus, erste + 2 + 12 * i + 8), Some(6));

            // Exif- und GPS-IFD sind leer.
            for tag in [34665u16, 34853] {
                let i = tags1.iter().position(|&t| t == tag).unwrap();
                let unter = l.u32(&aus, erste + 2 + 12 * i + 8).unwrap() as usize;
                assert_eq!(ifd(&aus, l, unter), (vec![], 0), "Tag {tag}");
            }
        }
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigen(&tiff_datei(false)).expect("TIFF").daten;
        assert_eq!(bereinigen(&einmal).expect("TIFF").daten, einmal);
    }

    #[test]
    fn bigtiff_ist_unbereinigbar() {
        assert!(bereinigen(b"II+\0\x08\0\0\0\x10\0\0\0\0\0\0\0").is_err());
    }

    #[test]
    fn zyklus_ist_unbereinigbar() {
        let mut t = tiff_datei(false);
        let l = Leser { be: false };
        let erste = l.u32(&t, 4).unwrap() as usize;
        let n = l.u16(&t, erste).unwrap() as usize;
        // Nachfolger von Seite 1 zeigt auf Seite 1.
        t[erste + 2 + 12 * n..erste + 6 + 12 * n].copy_from_slice(&(erste as u32).to_le_bytes());
        assert!(bereinigen(&t).is_err());
    }
}
