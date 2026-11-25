//! KMZ lesen (Entwurf, „Einlesen“): ein ZIP mit einer KML darin.
//!
//! Gelesen wird genau ein Eintrag: `doc.kml`, sonst der erste mit der Endung `.kml` (ohne
//! Rücksicht auf Groß- und Kleinschreibung); andere Einträge (Bilder, Symbole) werden nie
//! entpackt. Die entpackte Größe steht im Kopf des Eintrags, und der kann lügen: entpackt wird
//! deshalb selbst aus den Rohdaten (`Stored` oder `Deflated`), gedeckelt über `Read::take` auf
//! [`KMZ_ENTPACKT_MAX`]. Die Kopfgröße dient nur der frühen Ablehnung. Verschlüsselte Einträge
//! und andere Verfahren sind unlesbar; die Prüfsumme wird nicht verglichen (eine verfälschte KML
//! ist nur ein anderer Inhalt und durchläuft dieselben Prüfungen).

use super::{kml::read_kml, Grenzen, Normiert};
use crate::karte_fremdebene::{FremdebeneFehler, KMZ_ENTPACKT_MAX};
use std::io::{Cursor, Read};
use zip::CompressionMethod;

pub fn read_kmz(bytes: &[u8], grenzen: &mut Grenzen) -> Result<Normiert, FremdebeneFehler> {
    let mut archiv =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| FremdebeneFehler::Unlesbar)?;
    let index = kml_eintrag(&mut archiv)?.ok_or(FremdebeneFehler::Unlesbar)?;
    let roh = archiv
        .by_index_raw(index)
        .map_err(|_| FremdebeneFehler::Unlesbar)?;
    if roh.encrypted() {
        return Err(FremdebeneFehler::Unlesbar);
    }
    if roh.size() > KMZ_ENTPACKT_MAX as u64 {
        return Err(FremdebeneFehler::ZuGross);
    }
    let inhalt = match roh.compression() {
        CompressionMethod::Stored => lies_gedeckelt(roh)?,
        CompressionMethod::Deflated => lies_gedeckelt(flate2::read::DeflateDecoder::new(roh))?,
        _ => return Err(FremdebeneFehler::Unlesbar),
    };
    let inhalt = inhalt.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&inhalt);
    let text = std::str::from_utf8(inhalt).map_err(|_| FremdebeneFehler::Unlesbar)?;
    read_kml(text, grenzen)
}

/// Liest höchstens ein Byte über [`KMZ_ENTPACKT_MAX`]; ist es da, ist der Eintrag zu groß.
fn lies_gedeckelt(quelle: impl Read) -> Result<Vec<u8>, FremdebeneFehler> {
    let mut inhalt = Vec::new();
    quelle
        .take(KMZ_ENTPACKT_MAX as u64 + 1)
        .read_to_end(&mut inhalt)
        .map_err(|_| FremdebeneFehler::Unlesbar)?;
    if inhalt.len() > KMZ_ENTPACKT_MAX {
        return Err(FremdebeneFehler::ZuGross);
    }
    Ok(inhalt)
}

/// Index des zu lesenden Eintrags: `doc.kml`, sonst die erste Datei mit Endung `.kml`. Liest
/// nur das Inhaltsverzeichnis.
fn kml_eintrag(
    archiv: &mut zip::ZipArchive<Cursor<&[u8]>>,
) -> Result<Option<usize>, FremdebeneFehler> {
    let mut erste = None;
    for i in 0..archiv.len() {
        let eintrag = archiv
            .by_index_raw(i)
            .map_err(|_| FremdebeneFehler::Unlesbar)?;
        if eintrag.is_dir() {
            continue;
        }
        // Ein Name, der sich nicht lesen lässt, ist keine KML, die wir suchen.
        let Ok(name) = eintrag.name() else {
            continue;
        };
        let name = name.to_ascii_lowercase();
        if name == "doc.kml" {
            return Ok(Some(i));
        }
        if erste.is_none() && name.ends_with(".kml") {
            erste = Some(i);
        }
    }
    Ok(erste)
}

#[cfg(test)]
mod tests {
    use super::super::read_datei;
    use super::*;
    use serde_json::Value;
    use std::io::Write;

    fn kmz(teile: &[(&str, &[u8])]) -> Vec<u8> {
        let mut schreiber = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, inhalt) in teile {
            schreiber.start_file(*name, opt).unwrap();
            schreiber.write_all(inhalt).unwrap();
        }
        schreiber.finish().unwrap().into_inner()
    }

    fn kml_mit(name: &str) -> Vec<u8> {
        format!(
            "<kml><Document><name>{name}</name><Placemark><name>{name}</name>\
             <Point><coordinates>9,52</coordinates></Point></Placemark></Document></kml>"
        )
        .into_bytes()
    }

    fn erster_name(bytes: &[u8]) -> String {
        let n = read_datei(bytes).unwrap();
        let v: Value = serde_json::from_str(&n.geojson).unwrap();
        v["features"][0]["properties"]["name"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn kmz_nimmt_doc_kml_sonst_erste_kml() {
        let datei = kmz(&[
            ("liesmich.txt", b"<kml>kein Text</kml>"),
            ("ebene.kml", &kml_mit("Ebene")),
            ("doc.kml", &kml_mit("Doc")),
        ]);
        assert_eq!(erster_name(&datei), "Doc");
        let n = read_kmz(&datei, &mut Grenzen::default()).unwrap();
        assert_eq!(n.namensvorschlag.as_deref(), Some("Doc"));

        let datei = kmz(&[
            ("bilder/symbol.png", b"\x89PNG"),
            ("ordner/erste.KML", &kml_mit("Erste")),
            ("zweite.kml", &kml_mit("Zweite")),
        ]);
        assert_eq!(erster_name(&datei), "Erste");
    }

    /// Setzt die entpackte Größe im lokalen Kopf und im Inhaltsverzeichnis auf `groesse`.
    fn kopf_luegt(mut datei: Vec<u8>, groesse: u32) -> Vec<u8> {
        let finde = |d: &[u8], sig: &[u8]| d.windows(4).position(|w| w == sig).unwrap();
        let lokal = finde(&datei, b"PK\x03\x04");
        datei[lokal + 22..lokal + 26].copy_from_slice(&groesse.to_le_bytes());
        let zentral = finde(&datei, b"PK\x01\x02");
        datei[zentral + 24..zentral + 28].copy_from_slice(&groesse.to_le_bytes());
        datei
    }

    #[test]
    fn kmz_bombe_ist_zu_gross() {
        let mut inhalt = b"<kml>".to_vec();
        inhalt.resize(KMZ_ENTPACKT_MAX + 1024, b' ');
        inhalt.extend_from_slice(b"</kml>");
        let ehrlich = kmz(&[("doc.kml", &inhalt)]);
        assert!(ehrlich.len() < 1024 * 1024, "klein gepackt");
        assert_eq!(read_datei(&ehrlich), Err(FremdebeneFehler::ZuGross));
        // Der Kopf behauptet 64 Bytes: gedeckelt wird beim Lesen, nicht nach dem Kopf.
        let gelogen = kopf_luegt(ehrlich, 64);
        assert_eq!(read_datei(&gelogen), Err(FremdebeneFehler::ZuGross));

        // Genau an der Grenze geht es noch.
        let mut inhalt = kml_mit("Rand");
        inhalt.resize(KMZ_ENTPACKT_MAX, b' ');
        assert_eq!(erster_name(&kmz(&[("doc.kml", &inhalt)])), "Rand");
    }

    /// Liefert Leerzeichen ohne Ende und zählt mit; mehr als die Grenze plus eins ist ein Fehler
    /// des Lesers.
    struct Endlos(usize);

    impl std::io::Read for Endlos {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0 += buf.len();
            assert!(
                self.0 <= KMZ_ENTPACKT_MAX + 1,
                "über den Deckel hinaus gelesen"
            );
            buf.fill(b' ');
            Ok(buf.len())
        }
    }

    #[test]
    fn entpacken_liest_hoechstens_ein_byte_ueber_die_grenze() {
        assert_eq!(lies_gedeckelt(Endlos(0)), Err(FremdebeneFehler::ZuGross));
        assert_eq!(lies_gedeckelt(&b"<kml/>"[..]).unwrap(), b"<kml/>");
    }

    #[test]
    fn kmz_ohne_kml_ist_unlesbar() {
        let datei = kmz(&[("bild.png", b"\x89PNG"), ("doc.kml.bak", &kml_mit("Alt"))]);
        assert_eq!(read_datei(&datei), Err(FremdebeneFehler::Unlesbar));
        assert_eq!(read_datei(&kmz(&[])), Err(FremdebeneFehler::Unlesbar));
        assert_eq!(
            read_datei(b"PK\x03\x04kaputt"),
            Err(FremdebeneFehler::Unlesbar)
        );
        // Eine KML, die kein Text ist, ist ebenfalls unlesbar.
        let datei = kmz(&[("doc.kml", &[0xff, 0xfe, 0x3c])]);
        assert_eq!(read_datei(&datei), Err(FremdebeneFehler::Unlesbar));
    }
}
