//! HEIF/HEIC (LFH-747, design.md D4): Exif-Items und XMP-`mime`-Items an Ort und Stelle mit
//! Nullen überschreiben. Kein Offset ändert sich, also muss nichts umgebaut werden. Die
//! Ausrichtung trägt HEIF über die Properties `irot`/`imir`, nicht über EXIF; sie bleibt.

use super::{Bereinigt, Unbereinigbar};

fn kurz() -> Unbereinigbar {
    Unbereinigbar("HEIF: Box bricht ab")
}

fn be(d: &[u8], at: usize, n: usize) -> Result<u64, Unbereinigbar> {
    let b = d
        .get(at..at.checked_add(n).ok_or_else(kurz)?)
        .ok_or_else(kurz)?;
    Ok(b.iter().fold(0u64, |acc, &x| (acc << 8) | x as u64))
}

/// Eine Box: Typ, Beginn der Nutzlast, Ende.
struct Box4 {
    typ: [u8; 4],
    nutzlast: usize,
    ende: usize,
}

/// Die Boxen zwischen `start` und `ende`.
fn boxen(d: &[u8], start: usize, ende: usize) -> Result<Vec<Box4>, Unbereinigbar> {
    let mut v = Vec::new();
    let mut pos = start;
    while pos < ende {
        let groesse = be(d, pos, 4)?;
        let typ: [u8; 4] = d
            .get(pos + 4..pos + 8)
            .ok_or_else(kurz)?
            .try_into()
            .map_err(|_| kurz())?;
        let (kopf, groesse) = match groesse {
            0 => (8, (ende - pos) as u64),
            1 => (16, be(d, pos + 8, 8)?),
            g => (8, g),
        };
        let box_ende = usize::try_from(groesse)
            .ok()
            .and_then(|g| pos.checked_add(g))
            .ok_or_else(kurz)?;
        if groesse < kopf as u64 || box_ende > ende {
            return Err(kurz());
        }
        v.push(Box4 {
            typ,
            nutzlast: pos + kopf,
            ende: box_ende,
        });
        pos = box_ende;
    }
    Ok(v)
}

/// Null-terminierte Zeichenkette ab `pos`; liefert sie und die Stelle dahinter.
fn zeichenkette(d: &[u8], pos: usize, ende: usize) -> Result<(&[u8], usize), Unbereinigbar> {
    let rest = d.get(pos..ende).ok_or_else(kurz)?;
    let n = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());
    Ok((&rest[..n], (pos + n + 1).min(ende)))
}

/// Die IDs der Items, die Metadaten tragen: `Exif` und `mime` mit XMP-Inhaltstyp.
fn metadaten_items(d: &[u8], iinf: &Box4) -> Result<Vec<Item>, Unbereinigbar> {
    let version = *d.get(iinf.nutzlast).ok_or_else(kurz)?;
    let kopf = if version == 0 { 6 } else { 8 };
    let mut ids = Vec::new();
    for infe in boxen(d, iinf.nutzlast + kopf, iinf.ende)? {
        if &infe.typ != b"infe" {
            continue;
        }
        let v = *d.get(infe.nutzlast).ok_or_else(kurz)?;
        let p = infe.nutzlast + 4;
        if v < 2 {
            // Alte Form ohne item_type: nur XMP über den Inhaltstyp erkennbar.
            let id = be(d, p, 2)? as u32;
            let (_, p) = zeichenkette(d, p + 4, infe.ende)?;
            let (inhaltstyp, _) = zeichenkette(d, p, infe.ende)?;
            if ist_xmp(inhaltstyp) {
                ids.push(Item { id, exif: false });
            }
            continue;
        }
        let id_laenge = if v == 2 { 2 } else { 4 };
        let id = be(d, p, id_laenge)? as u32;
        let p = p + id_laenge + 2;
        let typ = d.get(p..p + 4).ok_or_else(kurz)?;
        let (_, p) = zeichenkette(d, p + 4, infe.ende)?;
        match typ {
            b"Exif" => ids.push(Item { id, exif: true }),
            b"mime" => {
                let (inhaltstyp, _) = zeichenkette(d, p, infe.ende)?;
                if ist_xmp(inhaltstyp) {
                    ids.push(Item { id, exif: false });
                }
            }
            _ => {}
        }
    }
    Ok(ids)
}

fn ist_xmp(inhaltstyp: &[u8]) -> bool {
    let t = String::from_utf8_lossy(inhaltstyp).to_ascii_lowercase();
    t.contains("rdf+xml") || t.contains("xmp")
}

/// Ein Metadaten-Item: EXIF oder XMP.
#[derive(Clone, Copy)]
struct Item {
    id: u32,
    exif: bool,
}

/// Ein Bereich der Datei, der genullt wird. `leeres_exif`: hier beginnt der erste Extent eines
/// Exif-Items, dort kommt ein gültiger leerer TIFF-Block hin.
struct Bereich {
    start: usize,
    laenge: usize,
    leeres_exif: bool,
}

/// Inhalt eines leeren Exif-Items: `exif_tiff_header_offset` 0, dann ein TIFF-Kopf (II) mit einem
/// IFD ohne Einträge und ohne Nachfolger. Ein genulltes Item ist kein gültiger TIFF-Block, und
/// Leser wie Pillow brechen beim EXIF-Lesen daran ab (Praxistest LFH-747).
const LEERES_EXIF: [u8; 18] = [
    0, 0, 0, 0, b'I', b'I', b'*', 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/// Liest `iloc` und liefert die Dateibereiche der Items `ids`.
fn bereiche(
    d: &[u8],
    iloc: &Box4,
    idat: Option<&Box4>,
    items: &[Item],
) -> Result<Vec<Bereich>, Unbereinigbar> {
    let version = *d.get(iloc.nutzlast).ok_or_else(kurz)?;
    if version > 2 {
        return Err(Unbereinigbar("HEIF: unbekannte iloc-Version"));
    }
    let mut p = iloc.nutzlast + 4;
    let groessen = be(d, p, 2)? as u16;
    let offset_groesse = (groessen >> 12) as usize;
    let laengen_groesse = ((groessen >> 8) & 0xF) as usize;
    let basis_groesse = ((groessen >> 4) & 0xF) as usize;
    let index_groesse = if version >= 1 {
        (groessen & 0xF) as usize
    } else {
        0
    };
    for g in [
        offset_groesse,
        laengen_groesse,
        basis_groesse,
        index_groesse,
    ] {
        if ![0, 4, 8].contains(&g) {
            return Err(Unbereinigbar("HEIF: ungültige iloc-Feldgröße"));
        }
    }
    p += 2;
    let (anzahl, n) = if version < 2 {
        (be(d, p, 2)?, 2)
    } else {
        (be(d, p, 4)?, 4)
    };
    p += n;
    let id_laenge = if version < 2 { 2 } else { 4 };
    let mut gefunden = Vec::new();
    let mut v = Vec::new();
    for _ in 0..anzahl {
        if p >= iloc.ende {
            return Err(kurz());
        }
        let id = be(d, p, id_laenge)? as u32;
        p += id_laenge;
        let methode = if version >= 1 {
            let m = (be(d, p, 2)? & 0xF) as u16;
            p += 2;
            m
        } else {
            0
        };
        let datenreferenz = be(d, p, 2)?;
        p += 2;
        let basis = be(d, p, basis_groesse)?;
        p += basis_groesse;
        let extents = be(d, p, 2)?;
        p += 2;
        let item = items.iter().find(|i| i.id == id).copied();
        let gesucht = item.is_some();
        if gesucht {
            gefunden.push(id);
            if datenreferenz != 0 {
                return Err(Unbereinigbar("HEIF: Metadaten in externer Datei"));
            }
        }
        for extent in 0..extents {
            p += index_groesse;
            let offset = be(d, p, offset_groesse)?;
            p += offset_groesse;
            let laenge = be(d, p, laengen_groesse)?;
            p += laengen_groesse;
            if !gesucht {
                continue;
            }
            let anfang = match methode {
                0 => 0u64,
                1 => idat.ok_or(Unbereinigbar("HEIF: idat fehlt"))?.nutzlast as u64,
                _ => return Err(Unbereinigbar("HEIF: construction_method nicht unterstützt")),
            };
            let start = anfang
                .checked_add(basis)
                .and_then(|s| s.checked_add(offset))
                .ok_or_else(kurz)?;
            let grenze = match methode {
                1 => idat.map_or(0, |b| b.ende) as u64,
                _ => d.len() as u64,
            };
            if laenge == 0 || start.checked_add(laenge).is_none_or(|e| e > grenze) {
                return Err(Unbereinigbar("HEIF: Metadaten-Extent außerhalb der Datei"));
            }
            v.push(Bereich {
                start: start as usize,
                laenge: laenge as usize,
                leeres_exif: extent == 0 && item.is_some_and(|i| i.exif),
            });
        }
    }
    if p > iloc.ende {
        return Err(kurz());
    }
    if items.iter().any(|i| !gefunden.contains(&i.id)) {
        return Err(Unbereinigbar("HEIF: Metadaten-Item ohne Ort"));
    }
    Ok(v)
}

pub(super) fn bereinigen(d: &[u8]) -> Result<Bereinigt, Unbereinigbar> {
    let oben = boxen(d, 0, d.len())?;
    let mut aus = d.to_vec();
    for meta in oben.iter().filter(|b| &b.typ == b"meta") {
        // `meta` ist eine FullBox: 4 Bytes Version und Flags vor den Kindern.
        let kinder = boxen(d, meta.nutzlast + 4, meta.ende)?;
        let finde = |t: &[u8; 4]| kinder.iter().find(|b| &b.typ == t);
        let items = match finde(b"iinf") {
            Some(iinf) => metadaten_items(d, iinf)?,
            None => continue,
        };
        if items.is_empty() {
            continue;
        }
        let iloc = finde(b"iloc").ok_or(Unbereinigbar("HEIF: iloc fehlt"))?;
        for b in bereiche(d, iloc, finde(b"idat"), &items)? {
            let ziel = &mut aus[b.start..b.start + b.laenge];
            ziel.fill(0);
            if b.leeres_exif && ziel.len() >= LEERES_EXIF.len() {
                ziel[..LEERES_EXIF.len()].copy_from_slice(&LEERES_EXIF);
            }
        }
    }
    Ok(Bereinigt::ohne_exif(aus))
}

#[cfg(test)]
mod tests {
    use super::super::testbau::*;
    use super::*;

    #[test]
    fn nullt_exif_und_xmp_an_ort_und_stelle() {
        let h = heif(&HeifBau::default());
        let aus = bereinigen(&h).expect("HEIF").daten;
        assert_eq!(aus.len(), h.len());
        assert!(!enthaelt(&aus, MARKER));
        // Die Kennung `Exif` als Item-Typ im `infe` bleibt, der EXIF-Block selbst nicht.
        assert!(!enthaelt(&aus, b"Exif\0\0II*\0"));
        assert!(!enthaelt(&aus, b"xmpmeta"));
        assert!(enthaelt(&aus, HEVC));
        // Das Exif-Item trägt jetzt einen gültigen leeren TIFF-Block.
        assert!(enthaelt(&aus, &LEERES_EXIF));
        // Alles außer den genullten Bytes und dem leeren TIFF-Block ist gleich.
        let stelle = aus
            .windows(LEERES_EXIF.len())
            .position(|w| w == LEERES_EXIF)
            .unwrap();
        let geaendert: Vec<usize> = (0..h.len()).filter(|&i| h[i] != aus[i]).collect();
        assert!(geaendert
            .iter()
            .all(|&i| aus[i] == 0 || (stelle..stelle + LEERES_EXIF.len()).contains(&i)));
    }

    #[test]
    fn idempotent() {
        let einmal = bereinigen(&heif(&HeifBau::default())).expect("HEIF").daten;
        assert_eq!(bereinigen(&einmal).expect("HEIF").daten, einmal);
    }

    #[test]
    fn construction_method_zwei_ist_unbereinigbar() {
        let h = heif(&HeifBau {
            exif_methode: 2,
            ..HeifBau::default()
        });
        assert!(bereinigen(&h).is_err());
    }

    #[test]
    fn extent_jenseits_des_dateiendes_ist_unbereinigbar() {
        let h = heif(&HeifBau {
            exif_laenge_extra: 1000,
            ..HeifBau::default()
        });
        assert!(bereinigen(&h).is_err());
    }
}
