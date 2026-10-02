//! Synthetische Fixtures für die Bereinigungs-Tests (LFH-747, tasks.md). Jede personenbezogene
//! Angabe trägt den Marker `MARKER`, damit ein Test mit einer einzigen Suche belegt, dass nichts
//! davon die Bereinigung überlebt hat. Bilddaten tragen eigene, erkennbare Zeichenketten
//! (`PIXEL…`, `ICCDATEN`), damit ein Test zeigt, dass sie bytegleich durchlaufen.

use super::png::crc32;

pub const MARKER: &[u8] = b"MARKER";

/// Ob `heuhaufen` die Zeichenkette `nadel` enthält.
pub fn enthaelt(heuhaufen: &[u8], nadel: &[u8]) -> bool {
    heuhaufen.windows(nadel.len()).any(|w| w == nadel)
}

// ── TIFF-Bauer ──────────────────────────────────────────────────────────────────────────

/// Ein Wert eines IFD-Eintrags. `Verweis` ist ein LONG, der auf angehängte Bytes zeigt (Strips,
/// Vorschaubild); `Unter` ein LONG auf ein weiteres IFD dieser Liste.
pub enum Wert {
    Ascii(&'static str),
    Short(u16),
    Long(u32),
    Rational(Vec<(u32, u32)>),
    Undefined(Vec<u8>),
    Verweis(Vec<u8>),
    Unter(usize),
}

pub struct Ifd(pub Vec<(u16, Wert)>);

fn u16b(be: bool, v: u16) -> [u8; 2] {
    if be {
        v.to_be_bytes()
    } else {
        v.to_le_bytes()
    }
}

fn u32b(be: bool, v: u32) -> [u8; 4] {
    if be {
        v.to_be_bytes()
    } else {
        v.to_le_bytes()
    }
}

/// Baut einen TIFF-Block. `kette` sind die Hauptseiten in Reihenfolge (über Nachfolger-Offsets
/// verbunden); alle übrigen IFDs sind nur über `Wert::Unter` erreichbar.
pub fn tiff(be: bool, ifds: &[Ifd], kette: &[usize]) -> Vec<u8> {
    // Pass 1: Lage jedes IFD und seiner Zusatzdaten.
    let mut ifd_offset = vec![0u32; ifds.len()];
    let mut pos = 8u32;
    for (i, ifd) in ifds.iter().enumerate() {
        ifd_offset[i] = pos;
        pos += 2 + 12 * ifd.0.len() as u32 + 4;
        for (_, w) in &ifd.0 {
            let n = zusatzlaenge(w);
            pos += n + (n & 1);
        }
    }
    // Pass 2: schreiben.
    let mut aus = Vec::new();
    aus.extend_from_slice(if be { b"MM\0*" } else { b"II*\0" });
    aus.extend_from_slice(&u32b(be, kette.first().map_or(0, |&i| ifd_offset[i])));
    for (i, ifd) in ifds.iter().enumerate() {
        assert_eq!(aus.len() as u32, ifd_offset[i]);
        let mut zusatz_pos = ifd_offset[i] + 2 + 12 * ifd.0.len() as u32 + 4;
        let mut zusatz = Vec::new();
        aus.extend_from_slice(&u16b(be, ifd.0.len() as u16));
        for (tag, w) in &ifd.0 {
            aus.extend_from_slice(&u16b(be, *tag));
            let (typ, anzahl, bytes): (u16, u32, Vec<u8>) = match w {
                Wert::Ascii(s) => {
                    let mut b = s.as_bytes().to_vec();
                    b.push(0);
                    (2, b.len() as u32, b)
                }
                Wert::Short(v) => (3, 1, u16b(be, *v).to_vec()),
                Wert::Long(v) => (4, 1, u32b(be, *v).to_vec()),
                Wert::Rational(r) => {
                    let mut b = Vec::new();
                    for (z, n) in r {
                        b.extend_from_slice(&u32b(be, *z));
                        b.extend_from_slice(&u32b(be, *n));
                    }
                    (5, r.len() as u32, b)
                }
                Wert::Undefined(b) => (7, b.len() as u32, b.clone()),
                Wert::Verweis(_) => (4, 1, Vec::new()),
                Wert::Unter(ziel) => (4, 1, u32b(be, ifd_offset[*ziel]).to_vec()),
            };
            aus.extend_from_slice(&u16b(be, typ));
            aus.extend_from_slice(&u32b(be, anzahl));
            match w {
                Wert::Verweis(b) => {
                    aus.extend_from_slice(&u32b(be, zusatz_pos));
                    zusatz.extend_from_slice(b);
                    zusatz_pos += b.len() as u32;
                    if b.len() & 1 == 1 {
                        zusatz.push(0);
                        zusatz_pos += 1;
                    }
                }
                _ if bytes.len() <= 4 => {
                    let mut feld = bytes.clone();
                    feld.resize(4, 0);
                    aus.extend_from_slice(&feld);
                }
                _ => {
                    aus.extend_from_slice(&u32b(be, zusatz_pos));
                    zusatz.extend_from_slice(&bytes);
                    zusatz_pos += bytes.len() as u32;
                    if bytes.len() & 1 == 1 {
                        zusatz.push(0);
                        zusatz_pos += 1;
                    }
                }
            }
        }
        let naechste = kette
            .iter()
            .position(|&k| k == i)
            .and_then(|p| kette.get(p + 1))
            .map_or(0, |&k| ifd_offset[k]);
        aus.extend_from_slice(&u32b(be, naechste));
        aus.extend_from_slice(&zusatz);
    }
    aus
}

fn zusatzlaenge(w: &Wert) -> u32 {
    let n = match w {
        Wert::Ascii(s) => s.len() + 1,
        Wert::Rational(r) => r.len() * 8,
        Wert::Undefined(b) | Wert::Verweis(b) => b.len(),
        _ => 0,
    };
    if matches!(w, Wert::Verweis(_)) || n > 4 {
        n as u32
    } else {
        0
    }
}

/// GPS-Breite als RATIONAL, deren Bytes den Marker tragen („MARK“ / „ERGP“).
fn gps_rational() -> Wert {
    Wert::Rational(vec![
        (u32::from_be_bytes(*b"MARK"), u32::from_be_bytes(*b"ERGP")),
        (1, 1),
        (2, 1),
    ])
}

/// Ein EXIF-TIFF-Block wie aus einer Handykamera: IFD0 mit Gerät, Zeit und Ausrichtung,
/// Exif-IFD mit Seriennummer und MakerNote, GPS-IFD, IFD1 mit Vorschaubild.
pub fn exif_tiff(be: bool, ausrichtung: Option<u16>) -> Vec<u8> {
    let mut ifd0 = vec![
        (271, Wert::Ascii("MARKER_MAKE")),
        (272, Wert::Ascii("MARKER_MODEL")),
    ];
    if let Some(a) = ausrichtung {
        ifd0.push((274, Wert::Short(a)));
    }
    ifd0.extend([
        (306, Wert::Ascii("MARKER_ZEIT 2026:09:24")),
        (34665, Wert::Unter(1)),
        (34853, Wert::Unter(2)),
    ]);
    let ifds = [
        Ifd(ifd0),
        Ifd(vec![
            (36867, Wert::Ascii("MARKER_AUFNAHME")),
            (37500, Wert::Undefined(b"MARKER_MAKERNOTE".to_vec())),
            (42033, Wert::Ascii("MARKER_SERIE")),
        ]),
        Ifd(vec![(1, Wert::Ascii("N")), (2, gps_rational())]),
        Ifd(vec![
            (259, Wert::Short(6)),
            (
                513,
                Wert::Verweis(b"\xFF\xD8MARKER_VORSCHAU\xFF\xD9".to_vec()),
            ),
            (514, Wert::Long(22)),
        ]),
    ];
    tiff(be, &ifds, &[0, 3])
}

/// Ein XMP-Paket mit Standort.
pub fn xmp_paket() -> Vec<u8> {
    br#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="MARKER_XMP_GPS"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#
        .to_vec()
}

// ── JPEG ────────────────────────────────────────────────────────────────────────────────

pub fn segment(marker: u8, nutzlast: &[u8]) -> Vec<u8> {
    let mut s = vec![0xFF, marker];
    s.extend_from_slice(&((nutzlast.len() + 2) as u16).to_be_bytes());
    s.extend_from_slice(nutzlast);
    s
}

pub fn app1_exif(tiff: &[u8]) -> Vec<u8> {
    let mut n = b"Exif\0\0".to_vec();
    n.extend_from_slice(tiff);
    segment(0xE1, &n)
}

pub const ICC_SEGMENT_NUTZLAST: &[u8] = b"ICC_PROFILE\0\x01\x01ICCDATEN";
pub const ADOBE_NUTZLAST: &[u8] = b"Adobe\x00\x64\x00\x00\x00\x00\x01";
/// Entropiedaten mit Stopfbyte (`FF00`), Restart-Marker (`FFD0`) und Füllbytes vor dem Marker.
pub const SCAN1: &[u8] = b"PIXEL_SCAN1\x12\xFF\x00\x34\xFF\xD0\x56";
pub const SCAN2: &[u8] = b"PIXEL_SCAN2\x78\xFF\x00";

fn sof0() -> Vec<u8> {
    segment(0xC0, &[8, 0, 16, 0, 16, 1, 1, 0x11, 0])
}

fn dqt() -> Vec<u8> {
    let mut n = vec![0u8];
    n.extend(1..=64u8);
    segment(0xDB, &n)
}

fn dht(klasse: u8) -> Vec<u8> {
    let mut n = vec![klasse];
    let mut laengen = [0u8; 16];
    laengen[0] = 1;
    n.extend_from_slice(&laengen);
    n.push(0);
    segment(0xC4, &n)
}

fn sos() -> Vec<u8> {
    segment(0xDA, &[1, 1, 0x00, 0, 63, 0])
}

/// Ein JPEG mit allen bekannten Metadatenorten: Exif (samt GPS, Vorschau), XMP, erweitertes XMP,
/// MPF, Photoshop/IPTC, Kommentar, JFIF-Vorschau, dahinter ein MPF-Zweitbild mit eigenem Exif und
/// ein Samsung-Trailer. Mit `progressiv` zwei Scans mit einer DHT dazwischen.
pub fn jpeg(be: bool, ausrichtung: Option<u16>, progressiv: bool) -> Vec<u8> {
    let mut j = vec![0xFF, 0xD8];
    // JFIF mit 2×1-Vorschaubild (6 Bytes RGB), dessen Bytes den Marker bilden.
    let mut jfif = b"JFIF\0\x01\x02\x00\x00\x48\x00\x48\x02\x01".to_vec();
    jfif.extend_from_slice(MARKER);
    j.extend(segment(0xE0, &jfif));
    j.extend(segment(0xE0, b"JFXX\0\x10MARKER_JFXX"));
    j.extend(app1_exif(&exif_tiff(be, ausrichtung)));
    let mut xmp = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
    xmp.extend(xmp_paket());
    j.extend(segment(0xE1, &xmp));
    let mut xmp_ext = b"http://ns.adobe.com/xmp/extension/\0".to_vec();
    xmp_ext.extend_from_slice(b"0123456789ABCDEF0123456789ABCDEF\0\0\0\x10\0\0\0\0MARKER_XMP_EXT");
    j.extend(segment(0xE1, &xmp_ext));
    j.extend(segment(0xE2, ICC_SEGMENT_NUTZLAST));
    j.extend(segment(0xE2, b"MPF\0MARKER_MPF"));
    j.extend(segment(
        0xED,
        b"Photoshop 3.0\08BIM\x04\x04\0\0\0\0\0\x10MARKER_IPTC",
    ));
    j.extend(segment(0xEE, ADOBE_NUTZLAST));
    j.extend(segment(0xFE, b"MARKER_KOMMENTAR"));
    j.extend(dqt());
    j.extend(sof0());
    j.extend(dht(0x00));
    j.extend(sos());
    j.extend_from_slice(SCAN1);
    if progressiv {
        j.extend(dht(0x10));
        j.extend(segment(0xFE, b"MARKER_KOMMENTAR_ZWISCHEN"));
        j.extend(sos());
        j.extend_from_slice(SCAN2);
    }
    // Füllbytes vor EOI.
    j.extend_from_slice(&[0xFF, 0xFF, 0xD9]);
    // MPF-Zweitbild (Tiefenkarte) mit eigenem Exif samt GPS.
    j.extend_from_slice(&[0xFF, 0xD8]);
    j.extend(app1_exif(&exif_tiff(be, None)));
    j.extend_from_slice(&[0xFF, 0xD9]);
    // Samsung-Trailer.
    j.extend_from_slice(b"SEFHMARKER_SAMSUNG_GPS");
    j
}

// ── PNG ─────────────────────────────────────────────────────────────────────────────────

pub const PNG_SIGNATUR: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn chunk(typ: &[u8; 4], daten: &[u8]) -> Vec<u8> {
    let mut c = (daten.len() as u32).to_be_bytes().to_vec();
    c.extend_from_slice(typ);
    c.extend_from_slice(daten);
    let mut crc_ein = typ.to_vec();
    crc_ein.extend_from_slice(daten);
    c.extend_from_slice(&crc32(&crc_ein).to_be_bytes());
    c
}

pub const IHDR: &[u8] = b"\0\0\0\x01\0\0\0\x01\x08\x02\0\0\0";
pub const ICCP: &[u8] = b"icc\0\0ICCDATEN";
pub const IDAT: &[u8] = b"PIXEL_IDAT";

pub fn png(be: bool, ausrichtung: Option<u16>) -> Vec<u8> {
    let mut p = PNG_SIGNATUR.to_vec();
    p.extend(chunk(b"IHDR", IHDR));
    p.extend(chunk(b"iCCP", ICCP));
    p.extend(chunk(b"eXIf", &exif_tiff(be, ausrichtung)));
    p.extend(chunk(b"tEXt", b"Comment\0MARKER_TEXT"));
    p.extend(chunk(b"zTXt", b"Author\0\0MARKER_Z"));
    let mut itxt = b"XML:com.adobe.xmp\0\0\0\0\0".to_vec();
    itxt.extend(xmp_paket());
    p.extend(chunk(b"iTXt", &itxt));
    p.extend(chunk(b"tIME", &[0x07, 0xEA, 9, 24, 12, 0, 0]));
    p.extend(chunk(b"prVt", b"MARKER_PRIVAT"));
    p.extend(chunk(b"IDAT", IDAT));
    p.extend(chunk(b"IEND", b""));
    p.extend_from_slice(b"MARKER_NACH_IEND");
    p
}

// ── WebP ────────────────────────────────────────────────────────────────────────────────

pub fn riff_chunk(typ: &[u8; 4], daten: &[u8]) -> Vec<u8> {
    let mut c = typ.to_vec();
    c.extend_from_slice(&(daten.len() as u32).to_le_bytes());
    c.extend_from_slice(daten);
    if daten.len() & 1 == 1 {
        c.push(0);
    }
    c
}

pub fn riff(chunks: &[Vec<u8>]) -> Vec<u8> {
    let inhalt: Vec<u8> = chunks.concat();
    let mut r = b"RIFF".to_vec();
    r.extend_from_slice(&((inhalt.len() + 4) as u32).to_le_bytes());
    r.extend_from_slice(b"WEBP");
    r.extend(inhalt);
    r
}

/// Ungerade Länge, damit das Auffüllbyte mitgeprüft wird.
pub const VP8: &[u8] = b"PIXEL_VP8";

pub fn webp_erweitert(be: bool, ausrichtung: Option<u16>) -> Vec<u8> {
    // Flags: ICC (0x20) | EXIF (0x08) | XMP (0x04); Breite/Höhe 1×1 (Wert − 1, 24 Bit).
    let vp8x = [0x2C, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let mut w = riff(&[
        riff_chunk(b"VP8X", &vp8x),
        riff_chunk(b"ICCP", b"ICCDATEN"),
        riff_chunk(b"VP8 ", VP8),
        riff_chunk(b"EXIF", &exif_tiff(be, ausrichtung)),
        riff_chunk(b"XMP ", &xmp_paket()),
        riff_chunk(b"prVt", b"MARKER_PRIVAT"),
    ]);
    w.extend_from_slice(b"MARKER_NACH_RIFF");
    w
}

pub fn webp_einfach() -> Vec<u8> {
    riff(&[riff_chunk(b"VP8 ", VP8)])
}

// ── GIF ─────────────────────────────────────────────────────────────────────────────────

pub fn unterbloecke(daten: &[u8]) -> Vec<u8> {
    let mut b = Vec::new();
    for teil in daten.chunks(255) {
        b.push(teil.len() as u8);
        b.extend_from_slice(teil);
    }
    b.push(0);
    b
}

pub const GIF_PIXEL: &[u8] = b"PIXEL_GIF";

pub fn gif() -> Vec<u8> {
    let mut g = b"GIF89a".to_vec();
    // 1×1, globale Farbtabelle mit 2 Einträgen (Packed 0x80).
    g.extend_from_slice(&[1, 0, 1, 0, 0x80, 0, 0]);
    g.extend_from_slice(&[0, 0, 0, 0xFF, 0xFF, 0xFF]);
    // NETSCAPE2.0-Schleife.
    g.extend_from_slice(&[0x21, 0xFF, 11]);
    g.extend_from_slice(b"NETSCAPE2.0");
    g.extend_from_slice(&[3, 1, 0, 0, 0]);
    // Kommentar.
    g.extend_from_slice(&[0x21, 0xFE]);
    g.extend(unterbloecke(b"MARKER_KOMMENTAR"));
    // XMP als Application Extension.
    g.extend_from_slice(&[0x21, 0xFF, 11]);
    g.extend_from_slice(b"XMP DataXMP");
    g.extend(unterbloecke(&xmp_paket()));
    // Graphic Control Extension.
    g.extend_from_slice(&[0x21, 0xF9, 4, 0, 10, 0, 0, 0]);
    // Bild: Descriptor ohne lokale Farbtabelle, LZW-Mindestcodegröße 2, Daten.
    g.extend_from_slice(&[0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2]);
    g.extend(unterbloecke(GIF_PIXEL));
    g.push(0x3B);
    g.extend_from_slice(b"MARKER_NACH_TRAILER");
    g
}

// ── HEIF ────────────────────────────────────────────────────────────────────────────────

pub fn boxe(typ: &[u8; 4], inhalt: &[u8]) -> Vec<u8> {
    let mut b = ((inhalt.len() + 8) as u32).to_be_bytes().to_vec();
    b.extend_from_slice(typ);
    b.extend_from_slice(inhalt);
    b
}

pub fn vollbox(typ: &[u8; 4], version: u8, inhalt: &[u8]) -> Vec<u8> {
    let mut i = vec![version, 0, 0, 0];
    i.extend_from_slice(inhalt);
    boxe(typ, &i)
}

pub fn infe(id: u16, typ: &[u8; 4], inhaltstyp: Option<&str>) -> Vec<u8> {
    let mut i = id.to_be_bytes().to_vec();
    i.extend_from_slice(&[0, 0]);
    i.extend_from_slice(typ);
    i.push(0); // leerer item_name
    if let Some(ct) = inhaltstyp {
        i.extend_from_slice(ct.as_bytes());
        i.push(0);
    }
    vollbox(b"infe", 2, &i)
}

pub const HEVC: &[u8] = b"PIXEL_HEVC";

/// HEIF-Bauteile, damit Tests einzelne Felder verfälschen können.
pub struct HeifBau {
    pub exif_methode: u16,
    pub exif_laenge_extra: u32,
}

impl Default for HeifBau {
    fn default() -> Self {
        HeifBau {
            exif_methode: 0,
            exif_laenge_extra: 0,
        }
    }
}

/// Ein HEIC mit Bild-Item (in `mdat`), Exif-Item (in `mdat`, `construction_method` 0) und
/// XMP-`mime`-Item (in `idat`, `construction_method` 1).
pub fn heif(bau: &HeifBau) -> Vec<u8> {
    let mut exif = vec![0, 0, 0, 6];
    exif.extend_from_slice(b"Exif\0\0");
    exif.extend(exif_tiff(false, Some(6)));
    let xmp = xmp_paket();
    let bauen = |mdat_start: u32| -> Vec<u8> {
        let ftyp = boxe(b"ftyp", b"heic\0\0\0\0mif1heic");
        let hdlr = vollbox(b"hdlr", 0, b"\0\0\0\0pict\0\0\0\0\0\0\0\0\0\0\0\0\0");
        let pitm = vollbox(b"pitm", 0, &1u16.to_be_bytes());
        let mut iinf_inhalt = 3u16.to_be_bytes().to_vec();
        iinf_inhalt.extend(infe(1, b"hvc1", None));
        iinf_inhalt.extend(infe(2, b"Exif", None));
        iinf_inhalt.extend(infe(3, b"mime", Some("application/rdf+xml")));
        let iinf = vollbox(b"iinf", 0, &iinf_inhalt);
        // iloc v1: offset_size 4, length_size 4, base_offset_size 0, index_size 0.
        let mut iloc = vec![0x44, 0x00];
        iloc.extend_from_slice(&3u16.to_be_bytes());
        let eintrag = |id: u16, methode: u16, offset: u32, laenge: u32| {
            let mut e = id.to_be_bytes().to_vec();
            e.extend_from_slice(&methode.to_be_bytes());
            e.extend_from_slice(&0u16.to_be_bytes());
            e.extend_from_slice(&1u16.to_be_bytes());
            e.extend_from_slice(&offset.to_be_bytes());
            e.extend_from_slice(&laenge.to_be_bytes());
            e
        };
        iloc.extend(eintrag(1, 0, mdat_start, HEVC.len() as u32));
        iloc.extend(eintrag(
            2,
            bau.exif_methode,
            mdat_start + HEVC.len() as u32,
            exif.len() as u32 + bau.exif_laenge_extra,
        ));
        iloc.extend(eintrag(3, 1, 0, xmp.len() as u32));
        let iloc = vollbox(b"iloc", 1, &iloc);
        let idat = boxe(b"idat", &xmp);
        let meta = vollbox(b"meta", 0, &[hdlr, pitm, iinf, iloc, idat].concat());
        let mut mdat_inhalt = HEVC.to_vec();
        mdat_inhalt.extend_from_slice(&exif);
        let mdat = boxe(b"mdat", &mdat_inhalt);
        [ftyp, meta, mdat].concat()
    };
    let probe = bauen(0);
    let mdat_start = (probe.len() - (HEVC.len() + exif.len())) as u32;
    bauen(mdat_start)
}

// ── TIFF als Datei ──────────────────────────────────────────────────────────────────────

pub const TIFF_PIXEL_1: &[u8] = b"PIXEL_SEITE1";
pub const TIFF_PIXEL_2: &[u8] = b"PIXEL_SEITE2";

/// Ein zweiseitiger Scan: Seite 1 mit Gerät, Software, Zeit, Ausrichtung 6, XMP, IPTC, Exif-IFD
/// (samt Interop-IFD) und GPS-IFD, Seite 2 mit Gerät.
pub fn tiff_datei(be: bool) -> Vec<u8> {
    let ifds = [
        Ifd(vec![
            (256, Wert::Short(1)),
            (257, Wert::Short(1)),
            (269, Wert::Ascii("MARKER_DOKUMENT")),
            (270, Wert::Ascii("MARKER_BESCHREIBUNG")),
            (271, Wert::Ascii("MARKER_MAKE")),
            (272, Wert::Ascii("MARKER_MODEL")),
            (273, Wert::Verweis(TIFF_PIXEL_1.to_vec())),
            (274, Wert::Short(6)),
            (279, Wert::Long(TIFF_PIXEL_1.len() as u32)),
            (305, Wert::Ascii("MARKER_SOFTWARE")),
            (306, Wert::Ascii("MARKER_ZEIT 2026:09:24")),
            (315, Wert::Ascii("MARKER_ARTIST")),
            (700, Wert::Undefined(xmp_paket())),
            (33723, Wert::Undefined(b"MARKER_IPTC".to_vec())),
            (34665, Wert::Unter(1)),
            (34853, Wert::Unter(2)),
            (
                40092,
                Wert::Undefined(b"M\0A\0R\0K\0E\0R\0MARKER_XPCOMMENT".to_vec()),
            ),
            (42016, Wert::Ascii("MARKER_UNIQUE_ID")),
            (50735, Wert::Ascii("MARKER_KAMERASERIE")),
        ]),
        Ifd(vec![
            (36867, Wert::Ascii("MARKER_AUFNAHME")),
            (37500, Wert::Undefined(b"MARKER_MAKERNOTE".to_vec())),
            (40965, Wert::Unter(3)),
            (42033, Wert::Ascii("MARKER_SERIE")),
        ]),
        Ifd(vec![(1, Wert::Ascii("N")), (2, gps_rational())]),
        Ifd(vec![(1, Wert::Ascii("MARKER_INTEROP"))]),
        Ifd(vec![
            (256, Wert::Short(1)),
            (257, Wert::Short(1)),
            (271, Wert::Ascii("MARKER_MAKE_2")),
            (273, Wert::Verweis(TIFF_PIXEL_2.to_vec())),
            (279, Wert::Long(TIFF_PIXEL_2.len() as u32)),
        ]),
    ];
    tiff(be, &ifds, &[0, 4])
}

/// Deterministischer Zufall (LCG) für die Robustheitstests — ohne Crate.
pub struct Zufall(pub u64);

impl Zufall {
    pub fn naechste(&mut self, grenze: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 33) as usize) % grenze.max(1)
    }
}
