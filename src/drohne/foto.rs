//! Vorschau der Drohnenfotos (LLH-2108): bereinigen und kurz bündeln. Nichts wird gespeichert;
//! fremde Bilder gehen bereinigt und mit `ANHANG_CSP` hinaus, nicht über `anhang_antwort`
//! (`src/AGENTS.md`, „Anhänge“). Das Bündel hält nur bereinigte Bytes, nie einen `LiveKontext`.

use std::sync::OnceLock;
use std::time::Duration;

use super::video::Buendel;
use crate::error::AppError;

/// Lebensdauer einer Vorschau im Bündel.
pub const TTL: Duration = Duration::from_secs(5 * 60);

/// Gesamtdeckel aller gehaltenen Vorschauen.
pub const GESAMT_DECKEL: usize = 32 * 1024 * 1024;

/// Name der Datei im Schlüssel des Bündels (Adapter, Fotokennung, Name).
pub const DATEI: &str = "thumb";

/// Das Bündel der Vorschauen, getrennt vom Videobündel.
pub fn buendel() -> &'static Buendel {
    static B: OnceLock<Buendel> = OnceLock::new();
    B.get_or_init(|| Buendel::with_deckel(GESAMT_DECKEL))
}

/// Bereinigt eine Vorschau der Quelle (EXIF, GPS, XMP, …). Was sich nicht sicher bereinigen
/// lässt, geht nie hinaus (422).
pub fn clean_thumb(bytes: &[u8]) -> Result<Vec<u8>, AppError> {
    crate::anhang::metadaten::bereinigen(bytes, "image/jpeg")
        .map(std::borrow::Cow::into_owned)
        .map_err(|e| {
            tracing::warn!(grund = e.0, "Drohnenfoto nicht bereinigbar");
            AppError::UnprocessableEntity("Das Foto lässt sich nicht sicher anzeigen".into())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anhang::metadaten::testbau::{enthaelt, jpeg, MARKER, SCAN1};

    #[test]
    fn clean_thumb_entfernt_gps_exif() {
        for be in [false, true] {
            let roh = jpeg(be, None, false);
            // Der Eingang trägt GPS-IFD, Seriennummer, XMP und MakerNote.
            assert!(enthaelt(&roh, MARKER));
            assert!(enthaelt(&roh, b"Exif\0\0"));
            let aus = clean_thumb(&roh).expect("bereinigbar");
            assert!(!enthaelt(&aus, MARKER), "be={be}");
            assert!(!enthaelt(&aus, b"Exif\0\0"), "be={be}");
            assert!(!enthaelt(&aus, b"http://ns.adobe.com"), "be={be}");
            assert!(enthaelt(&aus, SCAN1), "Bilddaten bleiben");
        }
    }

    #[test]
    fn clean_thumb_behaelt_nur_die_ausrichtung() {
        let aus = clean_thumb(&jpeg(false, Some(6), false)).expect("bereinigbar");
        assert!(!enthaelt(&aus, MARKER));
    }

    #[test]
    fn clean_thumb_lehnt_kein_bild_mit_422_ab() {
        for kaputt in [&b"kein Bild"[..], &[0xFF, 0xD8, 0xFF][..], &[][..]] {
            let e = clean_thumb(kaputt).unwrap_err();
            assert!(matches!(e, AppError::UnprocessableEntity(_)), "{e:?}");
        }
    }
}
