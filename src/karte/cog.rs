//! Cloud Optimized GeoTIFF lesen und kacheln (LLH-2021). Rein und ohne Netz: Den Abruf der
//! Bytes besorgt der Aufrufer (`copernicus.rs`), hier steht nur, welche Bytes gebraucht werden
//! und was aus ihnen wird. Entwurf:
//! `docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md`.

use serde::{Deserialize, Serialize};

/// Kompression einer Kachel, soweit dieser Leser sie entpackt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Kompression {
    Keine,
    Lzw,
    Deflate,
    Jpeg,
}

/// Eine Auflösungsstufe: das Vollbild oder eine Übersicht.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stufe {
    pub breite: u32,
    pub hoehe: u32,
    pub kachel_breite: u32,
    pub kachel_hoehe: u32,
    pub offsets: Vec<u64>,
    pub laengen: Vec<u64>,
}

/// Was ein Kachelabruf über ein Bild wissen muss.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Kopf {
    /// `[0]` ist das Vollbild, danach die Übersichten, jede gröber als die vorige.
    pub stufen: Vec<Stufe>,
    pub kanaele: u8,
    pub alpha: bool,
    pub kompression: Kompression,
    pub praediktor: u8,
    pub jpeg_tabellen: Option<Vec<u8>>,
    pub nodata: Option<u8>,
    /// Linke obere Ecke in EPSG:3857 (Meter).
    pub ursprung: (f64, f64),
    /// Meter je Pixel der Vollauflösung, beide positiv.
    pub pixel: (f64, f64),
    /// Warum das Bild nicht gezeigt werden kann; `None` heißt darstellbar.
    pub nicht_darstellbar: Option<String>,
}

/// Ergebnis von [`parse_kopf`]: fertig gelesen, oder es fehlen Bytes bis zu dieser Länge.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KopfErgebnis {
    Fertig(Kopf),
    BrauchtBytes(u64),
}

/// Fehler beim Lesen eines COG. Nie eine Panik: Die Bytes kommen von außen.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum CogFehler {
    Format(String),
    ZuGross,
}

impl std::fmt::Display for CogFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CogFehler::Format(s) => write!(f, "COG unlesbar: {s}"),
            CogFehler::ZuGross => write!(f, "COG überschreitet die Größengrenze"),
        }
    }
}

/// Länge des ersten Kopfabrufs. Beim GDAL-COG liegen alle IFDs in den ersten Kilobytes.
pub(crate) const KOPF_ERSTER_ABRUF: u64 = 16 * 1024;
/// Größter Kopf, den der Leser nachlädt.
pub(crate) const KOPF_MAX: u64 = 1024 * 1024;
/// Höchstzahl Nachladerunden: Jede Runde entdeckt das nächste IFD hinter dem gelesenen Bereich.
pub(crate) const KOPF_RUNDEN: usize = 8;

/// Höchstzahl IFDs, denen der Leser folgt (Vollbild, Übersichten, Masken).
const MAX_IFDS: usize = 32;

/// Liest Bytes einer TIFF-Datei in ihrer Bytereihenfolge. Ein Bereich hinter dem Ende merkt sich
/// die nötige Länge in `fehlt`, statt zu scheitern: so meldet [`parse_kopf`], wie viel nachzuladen
/// ist.
struct Leser<'a> {
    b: &'a [u8],
    le: bool,
    gross: bool,
    fehlt: u64,
}

impl Leser<'_> {
    fn bereich(&mut self, off: u64, len: u64) -> Option<&[u8]> {
        let ende = off.checked_add(len)?;
        if ende > self.b.len() as u64 {
            self.fehlt = self.fehlt.max(ende);
            return None;
        }
        Some(&self.b[off as usize..ende as usize])
    }

    fn zahl(&self, s: &[u8]) -> u64 {
        let mut v = 0u64;
        if self.le {
            for (i, x) in s.iter().enumerate() {
                v |= (*x as u64) << (8 * i);
            }
        } else {
            for x in s {
                v = (v << 8) | *x as u64;
            }
        }
        v
    }

    fn u(&mut self, off: u64, len: u64) -> Option<u64> {
        let s = self.bereich(off, len)?.to_vec();
        Some(self.zahl(&s))
    }
}

/// Bytebreite eines TIFF-Feldtyps.
fn typ_breite(typ: u16) -> Option<u64> {
    Some(match typ {
        1 | 2 | 6 | 7 => 1,
        3 | 8 => 2,
        4 | 9 | 11 | 13 => 4,
        5 | 10 | 12 | 16 | 17 | 18 => 8,
        _ => return None,
    })
}

/// Rohwert eines IFD-Eintrags.
struct Feld {
    typ: u16,
    werte: Vec<u8>,
}

impl Feld {
    fn zahlen(&self, l: &Leser) -> Vec<u64> {
        let Some(w) = typ_breite(self.typ) else {
            return Vec::new();
        };
        if !matches!(self.typ, 1 | 3 | 4 | 16) {
            return Vec::new();
        }
        self.werte.chunks(w as usize).map(|c| l.zahl(c)).collect()
    }

    fn doppelte(&self, l: &Leser) -> Vec<f64> {
        if self.typ != 12 {
            return Vec::new();
        }
        self.werte
            .chunks(8)
            .map(|c| f64::from_bits(l.zahl(c)))
            .collect()
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.werte)
            .trim_end_matches('\0')
            .trim()
            .to_string()
    }
}

type Ifd = std::collections::HashMap<u16, Feld>;

/// Liest ein IFD ab `off`; `None`, wenn Bytes fehlen (dann steht `fehlt`). Gibt die Felder und
/// den Offset des nächsten IFD zurück.
fn lies_ifd(l: &mut Leser, off: u64) -> Result<Option<(Ifd, u64)>, CogFehler> {
    let (zaehler, eintrag, zeiger) = if l.gross { (8, 20, 8) } else { (2, 12, 4) };
    let Some(n) = l.u(off, zaehler) else {
        return Ok(None);
    };
    if n == 0 || n > 4096 {
        return Err(CogFehler::Format(format!("IFD mit {n} Einträgen")));
    }
    let start = off + zaehler;
    let Some(roh) = l.bereich(start, n * eintrag + zeiger).map(<[u8]>::to_vec) else {
        return Ok(None);
    };
    let mut ifd = Ifd::new();
    let mut vollstaendig = true;
    for i in 0..n as usize {
        let e = &roh[i * eintrag as usize..(i + 1) * eintrag as usize];
        let tag = l.zahl(&e[0..2]) as u16;
        let typ = l.zahl(&e[2..4]) as u16;
        let (anzahl, wert) = if l.gross {
            (l.zahl(&e[4..12]), &e[12..20])
        } else {
            (l.zahl(&e[4..8]), &e[8..12])
        };
        let Some(breite) = typ_breite(typ) else {
            continue;
        };
        let laenge = anzahl
            .checked_mul(breite)
            .ok_or_else(|| CogFehler::Format("Feldlänge läuft über".into()))?;
        let werte = if laenge <= wert.len() as u64 {
            wert[..laenge as usize].to_vec()
        } else {
            let ziel = l.zahl(wert);
            if ziel.saturating_add(laenge) > KOPF_MAX {
                return Err(CogFehler::ZuGross);
            }
            match l.bereich(ziel, laenge) {
                Some(s) => s.to_vec(),
                None => {
                    vollstaendig = false;
                    continue;
                }
            }
        };
        ifd.insert(tag, Feld { typ, werte });
    }
    let naechstes = l.zahl(&roh[(n * eintrag) as usize..]);
    Ok(vollstaendig.then_some((ifd, naechstes)))
}

/// Liest den Kopf eines COG aus seinen ersten Bytes. Fehlen Bytes, kommt
/// [`KopfErgebnis::BrauchtBytes`] mit der nötigen Länge (höchstens [`KOPF_MAX`]).
pub(crate) fn parse_kopf(bytes: &[u8]) -> Result<KopfErgebnis, CogFehler> {
    let le = match bytes.get(0..2) {
        Some(b"II") => true,
        Some(b"MM") => false,
        Some(_) => return Err(CogFehler::Format("keine TIFF-Kennung".into())),
        None if bytes.is_empty() => return Ok(KopfErgebnis::BrauchtBytes(16)),
        None => return Err(CogFehler::Format("keine TIFF-Kennung".into())),
    };
    let mut l = Leser {
        b: bytes,
        le,
        gross: false,
        fehlt: 0,
    };
    let Some(version) = l.u(2, 2) else {
        return Ok(KopfErgebnis::BrauchtBytes(16));
    };
    let erstes = match version {
        42 => l.u(4, 4),
        43 => {
            l.gross = true;
            l.u(8, 8)
        }
        v => return Err(CogFehler::Format(format!("TIFF-Version {v}"))),
    };
    let Some(mut off) = erstes else {
        return Ok(KopfErgebnis::BrauchtBytes(16));
    };
    let mut ifds = Vec::new();
    while off != 0 {
        if off > KOPF_MAX {
            return Err(CogFehler::ZuGross);
        }
        if ifds.len() >= MAX_IFDS {
            break;
        }
        match lies_ifd(&mut l, off)? {
            Some((ifd, naechstes)) => {
                ifds.push(ifd);
                if naechstes <= off {
                    break; // Schleife in der IFD-Kette
                }
                off = naechstes;
            }
            None => break,
        }
    }
    if l.fehlt > 0 {
        if l.fehlt > KOPF_MAX {
            return Err(CogFehler::ZuGross);
        }
        return Ok(KopfErgebnis::BrauchtBytes(l.fehlt));
    }
    baue_kopf(&l, &ifds).map(KopfErgebnis::Fertig)
}

fn einzahl(l: &Leser, ifd: &Ifd, tag: u16) -> Option<u64> {
    ifd.get(&tag).and_then(|f| f.zahlen(l).first().copied())
}

/// Aus den IFDs den Kopf. Was der Leser nicht zeigen kann, steht als Grund in
/// `nicht_darstellbar`; ein Fehler ist nur ein Kopf, der gar nichts Verwertbares hat.
fn baue_kopf(l: &Leser, ifds: &[Ifd]) -> Result<Kopf, CogFehler> {
    let haupt = ifds
        .first()
        .ok_or_else(|| CogFehler::Format("kein IFD".into()))?;
    let mut grund: Option<String> = None;
    let mut setze = |g: &str| {
        grund.get_or_insert_with(|| g.to_string());
    };

    let kanaele = einzahl(l, haupt, 277).unwrap_or(1);
    let bits = haupt.get(&258).map(|f| f.zahlen(l)).unwrap_or_default();
    if bits.is_empty() || bits.iter().any(|b| *b != 8) {
        setze("nur 8 Bit je Kanal");
    }
    if einzahl(l, haupt, 284).unwrap_or(1) != 1 {
        setze("Kanäle nicht verschränkt");
    }
    if haupt
        .get(&339)
        .map(|f| f.zahlen(l))
        .unwrap_or_default()
        .iter()
        .any(|s| *s != 1)
    {
        setze("Werte nicht vorzeichenlos ganzzahlig");
    }
    if !matches!(kanaele, 1 | 3 | 4) {
        setze("Kanalzahl");
    }
    let kompression = match einzahl(l, haupt, 259).unwrap_or(1) {
        1 => Kompression::Keine,
        5 => Kompression::Lzw,
        7 => Kompression::Jpeg,
        8 | 32946 => Kompression::Deflate,
        _ => {
            setze("Kompression");
            Kompression::Keine
        }
    };
    let praediktor = einzahl(l, haupt, 317).unwrap_or(1);
    if !matches!(praediktor, 1 | 2) {
        setze("Prädiktor");
    }
    if haupt.contains_key(&34264) {
        setze("gedrehte oder verzerrte Georeferenz");
    }
    let epsg = haupt.get(&34735).and_then(|f| {
        let g = f.zahlen(l);
        g.chunks(4)
            .skip(1)
            .find(|e| e.len() == 4 && e[0] == 3072 && e[1] == 0)
            .map(|e| e[3])
    });
    if epsg != Some(3857) {
        setze("nicht in Web-Mercator (EPSG:3857)");
    }
    let skala = haupt.get(&33550).map(|f| f.doppelte(l)).unwrap_or_default();
    let tie = haupt.get(&33922).map(|f| f.doppelte(l)).unwrap_or_default();
    let (pixel, ursprung) = match (skala.as_slice(), tie.as_slice()) {
        ([sx, sy, ..], [0.0, 0.0, _, x, y, ..]) if *sx > 0.0 && *sy > 0.0 => ((*sx, *sy), (*x, *y)),
        _ => {
            setze("ohne Georeferenz");
            ((0.0, 0.0), (0.0, 0.0))
        }
    };
    let nodata = haupt
        .get(&42113)
        .and_then(|f| f.text().parse::<f64>().ok())
        .filter(|v| (0.0..=255.0).contains(v) && v.fract() == 0.0)
        .map(|v| v as u8);
    let jpeg_tabellen = haupt.get(&347).map(|f| f.werte.clone());

    let mut stufen = Vec::new();
    if !haupt.contains_key(&322) {
        setze("nicht gekachelt");
    } else {
        for ifd in ifds {
            // Masken (NewSubfileType Bit 4) gehören zu keiner Stufe.
            if einzahl(l, ifd, 254).unwrap_or(0) & 4 != 0 {
                continue;
            }
            if einzahl(l, ifd, 277).unwrap_or(1) != kanaele {
                continue;
            }
            let (Some(breite), Some(hoehe), Some(kb), Some(kh)) = (
                einzahl(l, ifd, 256),
                einzahl(l, ifd, 257),
                einzahl(l, ifd, 322),
                einzahl(l, ifd, 323),
            ) else {
                continue;
            };
            if breite == 0 || hoehe == 0 || !(16..=4096).contains(&kb) || !(16..=4096).contains(&kh)
            {
                continue;
            }
            let offsets = ifd.get(&324).map(|f| f.zahlen(l)).unwrap_or_default();
            let laengen = ifd.get(&325).map(|f| f.zahlen(l)).unwrap_or_default();
            let soll = breite.div_ceil(kb) * hoehe.div_ceil(kh);
            if offsets.len() as u64 != soll || laengen.len() as u64 != soll {
                continue;
            }
            stufen.push(Stufe {
                breite: breite as u32,
                hoehe: hoehe as u32,
                kachel_breite: kb as u32,
                kachel_hoehe: kh as u32,
                offsets,
                laengen,
            });
        }
        stufen.sort_by(|a, b| b.breite.cmp(&a.breite));
        stufen.dedup_by_key(|s| s.breite);
        if stufen.first().map(|s| s.breite) != einzahl(l, haupt, 256).map(|b| b as u32) {
            setze("Vollbild ohne Kacheltabelle");
        }
    }
    Ok(Kopf {
        stufen,
        kanaele: kanaele.min(255) as u8,
        alpha: kanaele == 4,
        kompression,
        praediktor: praediktor.min(255) as u8,
        jpeg_tabellen,
        nodata,
        ursprung,
        pixel,
        nicht_darstellbar: grund,
    })
}

// ===== Kachelmathematik (Quelle und Ziel in EPSG:3857, je Achse affin) =====

/// Kleinster Zoom, ab dem die Ebene Kacheln liefert. Gleich `BBOX_MIN_ZOOM` in
/// `frontend/src/pages/lagekarte/fachebenen.ts` (Wächter im Frontend-Test).
pub(crate) const MIN_ZOOM_BACKEND: u8 = 10;
/// Größter Zoom einer Zielkachel (wie `proxy::MAX_KACHEL_ZOOM`).
const MAX_ZOOM: u8 = 24;
/// Ab dieser Breite auf der Karte (px) lohnt das Bild eine Kachel.
const MIN_BILD_PX: f64 = 64.0;
/// Kantenlänge einer Zielkachel.
pub(crate) const ZIEL_PX: u32 = 256;
/// Höchstzahl Quellkacheln je Zielkachel.
pub(crate) const MAX_QUELLKACHELN: usize = 4;

/// Umfang der Web-Mercator-Welt in Metern.
const WELT: f64 = 2.0 * std::f64::consts::PI * 6_378_137.0;

/// Meter je Pixel einer Zielkachel bei Zoom `z`.
fn ziel_pixel(z: u8) -> f64 {
    WELT / (ZIEL_PX as f64 * 2f64.powi(z as i32))
}

/// Meter je Pixel einer Stufe (x, y).
fn stufen_pixel(k: &Kopf, stufe: usize) -> (f64, f64) {
    let voll = &k.stufen[0];
    let s = &k.stufen[stufe];
    (
        k.pixel.0 * voll.breite as f64 / s.breite as f64,
        k.pixel.1 * voll.hoehe as f64 / s.hoehe as f64,
    )
}

/// Ausdehnung des Bildes in EPSG:3857: (west, sued, ost, nord).
fn ausdehnung(k: &Kopf) -> (f64, f64, f64, f64) {
    let voll = &k.stufen[0];
    let (w, n) = k.ursprung;
    (
        w,
        n - voll.hoehe as f64 * k.pixel.1,
        w + voll.breite as f64 * k.pixel.0,
        n,
    )
}

/// Ausdehnung der Zielkachel in EPSG:3857: (west, sued, ost, nord).
fn kachel_ausdehnung(z: u8, x: u32, y: u32) -> (f64, f64, f64, f64) {
    let seite = WELT / 2f64.powi(z as i32);
    let w = -WELT / 2.0 + x as f64 * seite;
    let n = WELT / 2.0 - y as f64 * seite;
    (w, n - seite, w + seite, n)
}

fn merc_nach_wgs84(x: f64, y: f64) -> (f64, f64) {
    let r = 6_378_137.0;
    (
        (x / r).to_degrees(),
        (y / r).sinh().atan().to_degrees(),
    )
}

/// Umriss des Bildes in WGS84: `[west, sued, ost, nord]`.
pub(crate) fn bounds_wgs84(k: &Kopf) -> [f64; 4] {
    let (w, s, o, n) = ausdehnung(k);
    let (w, s) = merc_nach_wgs84(w, s);
    let (o, n) = merc_nach_wgs84(o, n);
    [w, s, o, n]
}

/// `(min_zoom, max_zoom)`: ab `min_zoom` ist das Bild mindestens [`MIN_BILD_PX`] breit (und nie
/// unter [`MIN_ZOOM_BACKEND`]); `max_zoom` ist der erste Zoom, dessen Zielkachel feiner als die
/// Vollauflösung wäre. Darüber vergrößert MapLibre selbst.
pub(crate) fn zoom_grenzen(k: &Kopf) -> (u8, u8) {
    let breite_m = k.stufen[0].breite as f64 * k.pixel.0;
    let max = (0..=MAX_ZOOM)
        .find(|z| ziel_pixel(*z) < k.pixel.0)
        .unwrap_or(MAX_ZOOM);
    let min = (0..=MAX_ZOOM)
        .find(|z| breite_m / ziel_pixel(*z) >= MIN_BILD_PX)
        .unwrap_or(MAX_ZOOM)
        .max(MIN_ZOOM_BACKEND);
    (min.min(max), max)
}

/// Die gröbste Stufe, deren Pixel nicht gröber als die Zielkachel sind; sonst das Vollbild.
pub(crate) fn waehle_stufe(k: &Kopf, z: u8) -> usize {
    let ziel = ziel_pixel(z) * 1.0001; // Rundung der Übersichtsgrößen
    (0..k.stufen.len())
        .rev()
        .find(|i| stufen_pixel(k, *i).0 <= ziel)
        .unwrap_or(0)
}

/// Eine Quellkachel einer Stufe: Index in `offsets`, Spalte und Zeile im Kachelraster.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Quellkachel {
    pub index: usize,
    pub spalte: u32,
    pub zeile: u32,
}

/// Schneidet die Zielkachel das Bild (Berührung zählt nicht)?
pub(crate) fn kachel_im_bild(k: &Kopf, z: u8, x: u32, y: u32) -> bool {
    if k.stufen.is_empty() {
        return false;
    }
    let (bw, bs, bo, bn) = ausdehnung(k);
    let (kw, ks, ko, kn) = kachel_ausdehnung(z, x, y);
    kw < bo && ko > bw && ks < bn && kn > bs
}

/// Die Quellkacheln der Stufe, die die Zielkachel braucht; leer außerhalb des Bildes.
pub(crate) fn quellkacheln(k: &Kopf, stufe: usize, z: u8, x: u32, y: u32) -> Vec<Quellkachel> {
    if !kachel_im_bild(k, z, x, y) || stufe >= k.stufen.len() {
        return Vec::new();
    }
    let s = &k.stufen[stufe];
    let (px, py) = stufen_pixel(k, stufe);
    let (kw, ks, ko, kn) = kachel_ausdehnung(z, x, y);
    let spalte = |m: f64| ((m - k.ursprung.0) / px).floor();
    let zeile = |m: f64| ((k.ursprung.1 - m) / py).floor();
    // Pixelbereich der Kachel, auf das Bild geklemmt; das östliche/südliche Ende ist exklusiv.
    let klemme = |v: f64, n: u32| v.clamp(0.0, n as f64 - 1.0) as u32;
    let (x0, x1) = (klemme(spalte(kw), s.breite), klemme(spalte(ko - 1e-6), s.breite));
    let (y0, y1) = (klemme(zeile(kn), s.hoehe), klemme(zeile(ks + 1e-6), s.hoehe));
    let spalten = s.breite.div_ceil(s.kachel_breite);
    let mut aus = Vec::new();
    for zr in y0 / s.kachel_hoehe..=y1 / s.kachel_hoehe {
        for sp in x0 / s.kachel_breite..=x1 / s.kachel_breite {
            aus.push(Quellkachel {
                index: (zr * spalten + sp) as usize,
                spalte: sp,
                zeile: zr,
            });
        }
    }
    aus
}

#[cfg(test)]
pub(crate) mod test_cog {
    //! Schreibt kleine COGs für Tests: 32 × 32 px in 2 × 2 Kacheln zu 16 px, dazu eine Übersicht
    //! 16 × 16 px in einer Kachel. Pixelwert je Kanal aus [`TestCog::pixel`]; Nodata 0.
    use super::Kompression;
    use std::io::Write;

    #[derive(Debug, Clone)]
    pub(crate) struct TestCog {
        pub epsg: u16,
        pub kanaele: u8,
        pub bits: u16,
        pub gekachelt: bool,
        pub rotation: bool,
        pub kompression: Kompression,
        pub praediktor: u8,
        /// Ursprung (EPSG:3857) und Meter je Pixel.
        pub ursprung: (f64, f64),
        pub pixel: f64,
    }

    impl Default for TestCog {
        fn default() -> Self {
            TestCog {
                epsg: 3857,
                kanaele: 3,
                bits: 8,
                gekachelt: true,
                rotation: false,
                kompression: Kompression::Deflate,
                praediktor: 2,
                ursprung: (1_000_000.0, 6_000_000.0),
                pixel: 10.0,
            }
        }
    }

    impl TestCog {
        /// Wert von Kanal `c` am Pixel (x, y) der Stufe `stufe`. Die linke obere Ecke (0, 0) ist
        /// in jeder Stufe Nodata (alle Kanäle 0), sonst nie 0.
        pub(crate) fn pixel(stufe: usize, x: u32, y: u32, c: u8) -> u8 {
            if x == 0 && y == 0 {
                return 0;
            }
            (1 + (x * 7 + y * 3 + c as u32 * 50 + stufe as u32 * 100) % 250) as u8
        }
    }

    const KACHEL: u32 = 16;

    fn kodiere(o: &TestCog, roh: &[u8]) -> Vec<u8> {
        match o.kompression {
            Kompression::Keine => roh.to_vec(),
            Kompression::Deflate => {
                let mut e =
                    flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
                e.write_all(roh).unwrap();
                e.finish().unwrap()
            }
            Kompression::Lzw => {
                weezl::encode::Encoder::with_tiff_size_switch(weezl::BitOrder::Msb, 8)
                    .encode(roh)
                    .unwrap()
            }
            Kompression::Jpeg => panic!("JPEG schreibt der Test-COG nicht"),
        }
    }

    fn kachel(o: &TestCog, stufe: usize, kx: u32, ky: u32) -> Vec<u8> {
        let k = o.kanaele as usize;
        let mut roh = Vec::with_capacity((KACHEL * KACHEL) as usize * k);
        for y in 0..KACHEL {
            for x in 0..KACHEL {
                for c in 0..o.kanaele {
                    roh.push(TestCog::pixel(stufe, kx * KACHEL + x, ky * KACHEL + y, c));
                }
            }
        }
        if o.praediktor == 2 {
            for zeile in roh.chunks_mut(KACHEL as usize * k) {
                for i in (k..zeile.len()).rev() {
                    zeile[i] = zeile[i].wrapping_sub(zeile[i - k]);
                }
            }
        }
        kodiere(o, &roh)
    }

    /// Ein IFD-Eintrag: Tag, Typ, Anzahl, Wertbytes (little-endian).
    type Eintrag = (u16, u16, u32, Vec<u8>);

    fn kurz(tag: u16, v: &[u16]) -> Eintrag {
        (tag, 3, v.len() as u32, v.iter().flat_map(|x| x.to_le_bytes()).collect())
    }
    fn lang(tag: u16, v: &[u32]) -> Eintrag {
        (tag, 4, v.len() as u32, v.iter().flat_map(|x| x.to_le_bytes()).collect())
    }
    fn doppelt(tag: u16, v: &[f64]) -> Eintrag {
        (tag, 12, v.len() as u32, v.iter().flat_map(|x| x.to_le_bytes()).collect())
    }
    fn text(tag: u16, s: &str) -> Eintrag {
        let mut b = s.as_bytes().to_vec();
        b.push(0);
        (tag, 2, b.len() as u32, b)
    }

    /// Klassisches TIFF, little-endian: Kacheldaten ab Byte 8, danach die IFDs.
    pub(crate) fn baue_test_cog(o: &TestCog) -> Vec<u8> {
        let mut daten = vec![0u8; 8];
        let mut stufen_offsets: Vec<(Vec<u32>, Vec<u32>)> = Vec::new();
        for (stufe, kacheln) in [(0usize, 2u32), (1, 1)] {
            let (mut offs, mut lens) = (Vec::new(), Vec::new());
            for ky in 0..kacheln {
                for kx in 0..kacheln {
                    let b = kachel(o, stufe, kx, ky);
                    offs.push(daten.len() as u32);
                    lens.push(b.len() as u32);
                    daten.extend_from_slice(&b);
                }
            }
            stufen_offsets.push((offs, lens));
        }
        let kompression = match o.kompression {
            Kompression::Keine => 1,
            Kompression::Lzw => 5,
            Kompression::Jpeg => 7,
            Kompression::Deflate => 8,
        };
        let mut ifds: Vec<Vec<Eintrag>> = Vec::new();
        for (stufe, (offs, lens)) in stufen_offsets.iter().enumerate() {
            let groesse = 32 >> stufe;
            let mut e = vec![
                lang(256, &[groesse]),
                lang(257, &[groesse]),
                kurz(258, &vec![o.bits; o.kanaele as usize]),
                kurz(259, &[kompression]),
                kurz(262, &[if o.kanaele == 1 { 1 } else { 2 }]),
                kurz(277, &[o.kanaele as u16]),
                kurz(284, &[1]),
                kurz(317, &[o.praediktor as u16]),
                kurz(339, &vec![1; o.kanaele as usize]),
            ];
            if stufe > 0 {
                e.push(lang(254, &[1]));
            }
            if o.gekachelt {
                e.extend([
                    kurz(322, &[KACHEL as u16]),
                    kurz(323, &[KACHEL as u16]),
                    lang(324, offs),
                    lang(325, lens),
                ]);
            } else {
                e.extend([lang(273, offs), lang(279, lens)]);
            }
            if stufe == 0 {
                e.push(doppelt(33550, &[o.pixel, o.pixel, 0.0]));
                e.push(doppelt(
                    33922,
                    &[0.0, 0.0, 0.0, o.ursprung.0, o.ursprung.1, 0.0],
                ));
                if o.rotation {
                    e.push(doppelt(34264, &[o.pixel; 16]));
                }
                e.push(kurz(34735, &[1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, o.epsg]));
                e.push(text(42113, "0"));
            }
            e.sort_by_key(|x| x.0);
            ifds.push(e);
        }
        // IFDs hintereinander; Werte über 4 Byte gleich hinter ihr IFD.
        let erstes = daten.len() as u32;
        daten[0..4].copy_from_slice(b"II*\0");
        daten[4..8].copy_from_slice(&erstes.to_le_bytes());
        let anzahl = ifds.len();
        for (i, ifd) in ifds.into_iter().enumerate() {
            let start = daten.len();
            let tabelle = 2 + ifd.len() * 12 + 4;
            let mut extra_off = (start + tabelle) as u32;
            let mut tab = Vec::new();
            let mut extra = Vec::new();
            tab.extend_from_slice(&(ifd.len() as u16).to_le_bytes());
            for (tag, typ, n, wert) in ifd {
                tab.extend_from_slice(&tag.to_le_bytes());
                tab.extend_from_slice(&typ.to_le_bytes());
                tab.extend_from_slice(&n.to_le_bytes());
                if wert.len() <= 4 {
                    let mut w = wert.clone();
                    w.resize(4, 0);
                    tab.extend_from_slice(&w);
                } else {
                    tab.extend_from_slice(&extra_off.to_le_bytes());
                    extra_off += wert.len() as u32;
                    extra.extend_from_slice(&wert);
                }
            }
            let naechstes = if i + 1 < anzahl {
                extra_off
            } else {
                0
            };
            tab.extend_from_slice(&naechstes.to_le_bytes());
            daten.extend_from_slice(&tab);
            daten.extend_from_slice(&extra);
        }
        daten
    }
}

#[cfg(test)]
mod tests {
    use super::test_cog::{baue_test_cog, TestCog};
    use super::*;

    /// Bytes 0–153 240 des GeoEye-Bildes von EMSR728/AOI01/DEL_MONIT04: alle IFDs und die
    /// einzige Kachel der kleinsten Übersicht.
    pub(super) const ANFANG: &[u8] = include_bytes!("testdaten/copernicus-cog-anfang.bin");

    fn fertig(bytes: &[u8]) -> Kopf {
        match parse_kopf(bytes) {
            Ok(KopfErgebnis::Fertig(k)) => k,
            anders => panic!("Kopf nicht fertig: {anders:?}"),
        }
    }

    #[test]
    fn liest_den_echten_kopf() {
        let k = fertig(&ANFANG[..16384]);
        assert_eq!(k.stufen.len(), 6);
        assert_eq!((k.stufen[0].breite, k.stufen[0].hoehe), (11447, 8594));
        assert_eq!(k.stufen[0].kachel_breite, 512);
        assert_eq!(k.stufen[0].offsets.len(), 391);
        assert_eq!(k.stufen[5].offsets.len(), 1);
        assert_eq!(k.stufen[5].laengen, vec![146627]);
        assert_eq!(k.kanaele, 3);
        assert!(!k.alpha);
        assert_eq!(k.kompression, Kompression::Deflate);
        assert_eq!(k.praediktor, 2);
        assert_eq!(k.nodata, Some(0));
        assert_eq!(k.ursprung, (1019796.0, 6271424.0));
        assert_eq!(k.pixel, (4.0, 4.0));
        assert_eq!(k.nicht_darstellbar, None);
    }

    #[test]
    fn liest_nachgeladenen_kopf() {
        let n = match parse_kopf(&ANFANG[..3000]) {
            Ok(KopfErgebnis::BrauchtBytes(n)) => n,
            anders => panic!("erwartet BrauchtBytes, war {anders:?}"),
        };
        assert!(n > 3000 && n <= 16384, "n = {n}");
        // Jede Runde entdeckt das nächste IFD; der Aufrufer lädt bis zu `KOPF_RUNDEN` Mal nach.
        let mut laenge = n;
        for _ in 0..KOPF_RUNDEN {
            match parse_kopf(&ANFANG[..laenge as usize]).unwrap() {
                KopfErgebnis::Fertig(k) => {
                    assert_eq!(k, fertig(&ANFANG[..16384]));
                    return;
                }
                KopfErgebnis::BrauchtBytes(m) => {
                    assert!(m > laenge);
                    laenge = m;
                }
            }
        }
        panic!("Kopf nach {KOPF_RUNDEN} Runden nicht fertig");
    }

    #[test]
    fn kopf_ueber_grenze_ist_fehler() {
        let mut b = b"II*\0".to_vec();
        b.extend_from_slice(&(2 * KOPF_MAX as u32).to_le_bytes());
        assert_eq!(parse_kopf(&b), Err(CogFehler::ZuGross));
    }

    #[test]
    fn test_cog_ist_darstellbar() {
        let k = fertig(&baue_test_cog(&TestCog::default()));
        assert_eq!(k.nicht_darstellbar, None);
        assert_eq!(k.stufen.len(), 2);
        assert_eq!(k.stufen[0].offsets.len(), 4);
        assert_eq!(k.ursprung, (1_000_000.0, 6_000_000.0));
        assert_eq!(k.pixel, (10.0, 10.0));
    }

    #[test]
    fn nicht_darstellbar_mit_grund() {
        for o in [
            TestCog {
                epsg: 32632,
                ..TestCog::default()
            },
            TestCog {
                gekachelt: false,
                ..TestCog::default()
            },
            TestCog {
                bits: 16,
                ..TestCog::default()
            },
            TestCog {
                rotation: true,
                ..TestCog::default()
            },
        ] {
            let k = fertig(&baue_test_cog(&o));
            assert!(k.nicht_darstellbar.is_some(), "{o:?}");
        }
    }

    /// Kachel (x, y) bei Zoom z, die einen Punkt in WGS84 enthält (Standardformel).
    fn kachel_von(lon: f64, lat: f64, z: u8) -> (u32, u32) {
        let n = 2f64.powi(z as i32);
        let x = ((lon + 180.0) / 360.0 * n).floor() as u32;
        let lat = lat.to_radians();
        let y = ((1.0 - lat.tan().asinh() / std::f64::consts::PI) / 2.0 * n).floor() as u32;
        (x, y)
    }

    #[test]
    fn bounds_von_emsr728() {
        let b = bounds_wgs84(&fertig(&ANFANG[..16384]));
        for (ist, soll) in b.iter().zip([9.16098, 48.77665, 9.57230, 48.97974]) {
            assert!((ist - soll).abs() < 1e-4, "{b:?}");
        }
    }

    #[test]
    fn abnahme_lagerichtig() {
        let k = fertig(&ANFANG[..16384]);
        let b = bounds_wgs84(&k);
        // Die linke obere Ecke des Bildes liegt in Kachel 14/8608/5628, nach der Standardformel
        // aus Länge und Breite gerechnet, nicht aus dem Code unter Test.
        assert_eq!(kachel_von(b[0] + 1e-9, b[3] - 1e-9, 14), (8608, 5628));
        assert!(kachel_im_bild(&k, 14, 8608, 5628));
        assert!(!kachel_im_bild(&k, 14, 8607, 5628));
        assert!(!kachel_im_bild(&k, 14, 8608, 5627));
        // Die Quellkachel dazu ist die linke obere des Vollbilds.
        let q = quellkacheln(&k, waehle_stufe(&k, 14), 14, 8608, 5628);
        assert_eq!((q[0].spalte, q[0].zeile), (0, 0));
    }

    #[test]
    fn stufe_je_zoom() {
        let k = fertig(&ANFANG[..16384]);
        assert_eq!(waehle_stufe(&k, 15), 0);
        assert_eq!(waehle_stufe(&k, 13), 2);
        assert_eq!(waehle_stufe(&k, 10), 5);
        assert_eq!(waehle_stufe(&k, 3), 5);
        assert_eq!(waehle_stufe(&k, 20), 0);
    }

    #[test]
    fn zoom_grenzen_emsr728() {
        assert_eq!(zoom_grenzen(&fertig(&ANFANG[..16384])), (10, 16));
    }

    #[test]
    fn hoechstens_vier_quellkacheln() {
        let k = fertig(&ANFANG[..16384]);
        let b = bounds_wgs84(&k);
        for z in 10..=16u8 {
            let (x0, y0) = kachel_von(b[0], b[3], z);
            let (x1, y1) = kachel_von(b[2], b[1], z);
            for x in x0..=x1 {
                for y in y0..=y1 {
                    let q = quellkacheln(&k, waehle_stufe(&k, z), z, x, y);
                    assert!(q.len() <= 4, "z {z} x {x} y {y}: {}", q.len());
                    assert!(!q.is_empty(), "z {z} x {x} y {y} ohne Quellkachel");
                }
            }
        }
    }

    #[test]
    fn ausserhalb_nicht_im_bild() {
        let k = fertig(&ANFANG[..16384]);
        assert!(!kachel_im_bild(&k, 14, 0, 0));
        assert!(quellkacheln(&k, 0, 14, 0, 0).is_empty());
    }

    #[test]
    fn kaputter_kopf_ist_fehler() {
        for b in [&b"II*\0\xff\xff\xff\x7f"[..], b"XX", b"", b"MM\0*\0\0\0\x08\0"] {
            match parse_kopf(b) {
                Err(_) | Ok(KopfErgebnis::BrauchtBytes(_)) => {}
                Ok(KopfErgebnis::Fertig(k)) => panic!("kaputter Kopf gelesen: {k:?}"),
            }
        }
        assert!(matches!(parse_kopf(b"XX"), Err(CogFehler::Format(_))));
    }
}
