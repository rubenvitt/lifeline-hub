//! Generische Datei-Anhang-Infrastruktur (LFH-102).
//!
//! Bewusst als **Top-Level-Modul** geschnitten — nicht unter `kommunikation` —,
//! weil Anhänge modulübergreifend gedacht sind (Chat dockt jetzt an, ETB/Lageobjekte
//! können dieselbe `anhang`-Tabelle später nutzen). Die chat-spezifische Verknüpfung
//! (`chat_nachricht_anhang`) lebt deshalb im `chat`-Modul, nicht hier.
//!
//! Dateien werden als BLOB in der SQLite-DB gespeichert (siehe Migration 0052):
//! ein einziger Zustands-Container, vom file-copy-/VACUUM-INTO-Backup automatisch
//! miterfasst.

pub mod repo;

use crate::error::AppError;
use serde::Serialize;

/// Maximale Upload-Größe pro Datei (25 MiB). Muss mit dem Body-Limit der
/// Upload-Route (`DefaultBodyLimit`) zusammenpassen und ist bewusst am späteren
/// clamd-`StreamMaxLength` (Default 25M, LFH-114) orientiert.
pub const MAX_GROESSE: usize = 25 * 1024 * 1024;

/// Erlaubte MIME-Typen (Allowlist). Bewusst kuratiert: Bilder, PDF, einfache
/// Texte/CSV und Office-Open-XML — das deckt die typischen BOS-Dokumente
/// (Fotos, Lagekarten als PDF, Listen) ab, ohne ausführbare Inhalte zuzulassen.
/// Erweiterbar; eine echte Inhalts-Sniffing-Prüfung folgt mit der AV-Anbindung
/// (LFH-114) — heute wird der aus der Dateiendung abgeleitete MIME-Typ geprüft.
pub const ERLAUBTE_MIME: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/// Öffentliche Darstellung eines Anhangs — ohne die Bytes (`daten`), die nur
/// über den Download-Endpoint ausgeliefert werden.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AnhangAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub hochgeladen_von: i64,
    pub erstellt_at: String,
}

/// Prüft die Upload-Größe gegen `MAX_GROESSE`. Leere Dateien sind unzulässig.
pub fn pruefe_groesse(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::Validation("Datei ist leer".into()));
    }
    if len > MAX_GROESSE {
        return Err(AppError::Validation(format!(
            "Datei ist zu groß ({} MiB erlaubt)",
            MAX_GROESSE / 1024 / 1024
        )));
    }
    Ok(())
}

/// Leitet den MIME-Typ aus der Dateiendung ab (mime_guess) und prüft ihn gegen
/// die Allowlist. Der vom Client gemeldete Content-Type wird bewusst NICHT als
/// Sicherheitsentscheidung herangezogen (manipulierbar) — die Endung ist hier
/// die maßgebliche, knappe Heuristik; echtes Content-Sniffing folgt mit LFH-114.
pub fn ermittle_mime(dateiname: &str) -> Result<String, AppError> {
    let mime = mime_guess::from_path(dateiname)
        .first_raw()
        .ok_or_else(|| AppError::Validation("Dateityp nicht erkennbar".into()))?;
    if !ERLAUBTE_MIME.contains(&mime) {
        return Err(AppError::Validation(format!("Dateityp {mime} ist nicht erlaubt")));
    }
    Ok(mime.to_string())
}

/// AV-Scan-Seam (LFH-114). Aktuell ein No-op — der Upload-Flow ist bereits nach
/// dem Muster *scan-vor-persist* geschnitten: der Handler ruft `scan` mit den
/// gepufferten Bytes, BEVOR persistiert wird. Hier wird später der ClamAV-Scan
/// (clamd) eingehängt; bei Fund liefert die Funktion dann `Err(...)` und nichts
/// erreicht den Speicher. Bis dahin passiert jeder Upload den Seam.
pub fn scan(_daten: &[u8]) -> Result<(), AppError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pruefe_groesse_lehnt_leer_und_zu_gross_ab() {
        assert!(matches!(pruefe_groesse(0).unwrap_err(), AppError::Validation(_)));
        assert!(pruefe_groesse(1).is_ok());
        assert!(pruefe_groesse(MAX_GROESSE).is_ok());
        assert!(matches!(
            pruefe_groesse(MAX_GROESSE + 1).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn ermittle_mime_akzeptiert_erlaubte_und_lehnt_andere_ab() {
        assert_eq!(ermittle_mime("lage.pdf").unwrap(), "application/pdf");
        assert_eq!(ermittle_mime("foto.JPG").unwrap(), "image/jpeg");
        // Ausführbares / unbekanntes wird abgelehnt.
        assert!(matches!(ermittle_mime("schad.exe").unwrap_err(), AppError::Validation(_)));
        assert!(matches!(ermittle_mime("ohne_endung").unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn scan_seam_ist_aktuell_durchlaessig() {
        assert!(scan(b"beliebige bytes").is_ok());
    }
}
