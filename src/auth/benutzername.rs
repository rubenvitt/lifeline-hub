//! Der Benutzername, wie er von außen kommt (LFH-921, LFH-981).
//!
//! Eine Stelle für alle Eingänge, die einen Namen annehmen (Passwort-Login, Passkey-Start mit
//! Namen, Benutzeranlage): **erst trimmen, dann die Länge prüfen.** Angehängte Leerzeichen einer
//! Bildschirmtastatur zählen so weder zur Länge noch zum Vergleich. Die Groß-/Kleinschreibung
//! bleibt hier unberührt; sie faltet die Suche selbst (`COLLATE NOCASE`, Migration `0150`).
//!
//! Ein überlanger Name verlässt den Handler mit 400, bevor Sperre, Audit oder Log ihn sehen:
//! sonst landete ein 2-MiB-Name 90 Tage in `auth_audit` und in jeder WARN-Zeile.

use crate::error::AppError;
use std::borrow::Cow;

/// Höchstlänge eines Benutzernamens in Zeichen, nach dem Trimmen.
pub const MAX_LAENGE: usize = 128;

/// So viele Zeichen eines Namens gehen höchstens in `auth_audit` und Log-Felder.
const PROTOKOLL_LAENGE: usize = 64;

/// Schneidet Randleerzeichen ab und weist einen Namen über [`MAX_LAENGE`] Zeichen mit 400 ab.
/// Ein leerer Name ist hier kein Fehler: der Login behandelt ihn wie einen unbekannten Namen,
/// die Anlage prüft ihn über `pflicht`.
pub fn normalisiere(roh: &str) -> Result<&str, AppError> {
    let name = roh.trim();
    if name.chars().count() > MAX_LAENGE {
        return Err(AppError::Validation(format!(
            "Benutzername darf höchstens {MAX_LAENGE} Zeichen haben"
        )));
    }
    Ok(name)
}

/// Der Name, wie er in `auth_audit` und Log-Felder geht: höchstens [`PROTOKOLL_LAENGE`] Zeichen,
/// sonst gekürzt mit angehängtem „…“.
pub fn fuer_protokoll(name: &str) -> Cow<'_, str> {
    match name.char_indices().nth(PROTOKOLL_LAENGE) {
        None => Cow::Borrowed(name),
        Some((ende, _)) => Cow::Owned(format!("{}…", &name[..ende])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn randleerzeichen_fallen_weg() {
        assert_eq!(normalisiere(" admin ").unwrap(), "admin");
        assert_eq!(normalisiere("\tadmin\n").unwrap(), "admin");
    }

    #[test]
    fn hoechstlaenge_gilt_nach_dem_trimmen() {
        let grenze = "a".repeat(MAX_LAENGE);
        assert_eq!(normalisiere(&grenze).unwrap(), grenze);
        assert_eq!(normalisiere(&format!("  {grenze}  ")).unwrap(), grenze);
    }

    #[test]
    fn ueberlaenge_ist_400() {
        let zu_lang = "a".repeat(MAX_LAENGE + 1);
        assert!(matches!(
            normalisiere(&zu_lang),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn mehrbyte_zeichen_zaehlen_als_eins() {
        let umlaute = "ä".repeat(MAX_LAENGE);
        assert!(
            normalisiere(&umlaute).is_ok(),
            "256 Bytes, aber 128 Zeichen"
        );
        assert!(normalisiere(&format!("{umlaute}ä")).is_err());
    }

    #[test]
    fn protokoll_kuerzt_ab_65_zeichen() {
        let genau = "b".repeat(PROTOKOLL_LAENGE);
        assert!(matches!(fuer_protokoll(&genau), Cow::Borrowed(_)));
        assert_eq!(fuer_protokoll(&genau), genau);

        let laenger = "ü".repeat(PROTOKOLL_LAENGE + 1);
        let gekuerzt = fuer_protokoll(&laenger);
        assert_eq!(gekuerzt, format!("{}…", "ü".repeat(PROTOKOLL_LAENGE)));
    }
}
