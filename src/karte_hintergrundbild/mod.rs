pub mod repo;

use crate::error::AppError;
use serde::Serialize;

/// Max. Upload-Größe (wie anhang). Body-Limit der Route liegt knapp darüber.
pub const MAX_GROESSE: usize = 25 * 1024 * 1024;

/// Anzeige-DTO (ohne BLOB-Bytes). `sichtbar` als bool für saubere JSON-Ausgabe.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct HintergrundbildAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub mime: String,
    pub groesse: i64,
    pub ecken_json: String,
    pub opazitaet: i64,
    pub sichtbar: bool,
    pub reihenfolge: i64,
    pub hochgeladen_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

pub fn pruefe_groesse(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::Validation("Bild ist leer".into()));
    }
    if len > MAX_GROESSE {
        return Err(AppError::Validation(format!(
            "Bild ist zu groß ({} MiB erlaubt)",
            MAX_GROESSE / 1024 / 1024
        )));
    }
    Ok(())
}

/// Erkennt den MIME-Typ an den Magic-Bytes (robuster als Dateiendung).
/// Erlaubt nur PNG und JPEG.
pub fn erkenne_bild_mime(daten: &[u8]) -> Result<&'static str, AppError> {
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF];
    if daten.starts_with(PNG) {
        Ok("image/png")
    } else if daten.starts_with(JPEG) {
        Ok("image/jpeg")
    } else {
        Err(AppError::Validation(
            "Nur PNG- oder JPEG-Bilder werden unterstützt".into(),
        ))
    }
}

/// Validiert `ecken_json`: exakt 4 [lng,lat]-Paare.
pub fn pruefe_ecken(ecken_json: &str) -> Result<(), AppError> {
    let ecken: Vec<[f64; 2]> = serde_json::from_str(ecken_json)
        .map_err(|_| AppError::Validation("Ecken sind kein gültiges JSON".into()))?;
    if ecken.len() != 4 {
        return Err(AppError::Validation("Genau 4 Eckpunkte erforderlich".into()));
    }
    Ok(())
}

pub fn pruefe_opazitaet(o: i64) -> Result<(), AppError> {
    if (0..=100).contains(&o) {
        Ok(())
    } else {
        Err(AppError::Validation("Opazität muss 0–100 sein".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // PNG-Magic: 89 50 4E 47 0D 0A 1A 0A ; JPEG: FF D8 FF
    #[test]
    fn erkennt_png() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        assert_eq!(erkenne_bild_mime(&png).unwrap(), "image/png");
    }
    #[test]
    fn erkennt_jpeg() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
        assert_eq!(erkenne_bild_mime(&jpg).unwrap(), "image/jpeg");
    }
    #[test]
    fn lehnt_fremdformat_ab() {
        let gif = *b"GIF89a..";
        assert!(erkenne_bild_mime(&gif).is_err());
    }
    #[test]
    fn groesse_null_und_zu_gross() {
        assert!(pruefe_groesse(0).is_err());
        assert!(pruefe_groesse(MAX_GROESSE + 1).is_err());
        assert!(pruefe_groesse(1024).is_ok());
    }
    #[test]
    fn ecken_genau_vier_paare() {
        let ok = "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]";
        assert!(pruefe_ecken(ok).is_ok());
        assert!(pruefe_ecken("[[9.0,50.0],[9.1,50.0]]").is_err()); // nur 2
        assert!(pruefe_ecken("kein json").is_err());
    }
    #[test]
    fn opazitaet_bereich() {
        assert!(pruefe_opazitaet(0).is_ok());
        assert!(pruefe_opazitaet(100).is_ok());
        assert!(pruefe_opazitaet(101).is_err());
        assert!(pruefe_opazitaet(-1).is_err());
    }
}
