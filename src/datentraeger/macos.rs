//! macOS: FileVault. Das Startvolume (`/`, `/System/Volumes/Data`) prüft `fdesetup isactive`
//! (ohne Adminrechte), jedes andere Volume `diskutil info -plist`. Die Auslagerung verschlüsselt
//! macOS ab Werk; `sysctl vm.swapusage` zeigt das mit `(encrypted)`.
//!
//! Die Auswertung ist rein und läuft auf jedem Rechner; nur der Aufruf hängt an macOS. Die
//! Ausgaben sind aus Beispielen abgeleitet, nicht auf echter Hardware belegt: was nicht passt,
//! ist `unbekannt`.

#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

use super::{Befund, Grund};

/// Einhängepunkte des Startvolumes, für die `fdesetup` gilt.
const STARTVOLUME: [&str; 2] = ["/", "/System/Volumes/Data"];

/// Einhängepunkt aus `df -P <pfad>`: alles nach der Spalte `Capacity` (`45%`) der zweiten Zeile;
/// der Punkt darf Leerzeichen enthalten.
pub fn einhaengepunkt_aus_df(text: &str) -> Option<String> {
    let zeile = text.lines().nth(1)?;
    let (_, rest) = zeile.split_once("% ")?;
    let punkt = rest.trim();
    (!punkt.is_empty()).then(|| punkt.to_string())
}

pub fn ist_startvolume(einhaengepunkt: &str) -> bool {
    STARTVOLUME.contains(&einhaengepunkt)
}

/// `fdesetup isactive` schreibt `true` oder `false`.
pub fn befund_aus_fdesetup(text: &str) -> Befund {
    match text.trim() {
        "true" => Befund::Verschluesselt,
        "false" => Befund::Unverschluesselt,
        _ => Befund::Unbekannt(Grund::AusgabeUnbekannt),
    }
}

/// Wert eines booleschen Schlüssels im plist-XML (`<key>K</key><true/>`).
fn plist_bool(text: &str, schluessel: &str) -> Option<bool> {
    let marke = format!("<key>{schluessel}</key>");
    let rest = text[text.find(&marke)? + marke.len()..].trim_start();
    if rest.starts_with("<true/>") {
        Some(true)
    } else if rest.starts_with("<false/>") {
        Some(false)
    } else {
        None
    }
}

/// `diskutil info -plist <Volume>`: Maßgeblich ist `FileVault` (Schlüssel aus einem Geheimnis
/// der Person). `FileVault` falsch bei `Encryption` wahr ist ein Widerspruch, etwa reine
/// Hardware-Verschlüsselung ohne Geheimnis, und bleibt `unbekannt`; fehlt `FileVault`, ebenso.
pub fn befund_aus_diskutil(text: &str) -> Befund {
    match (
        plist_bool(text, "FileVault"),
        plist_bool(text, "Encryption"),
    ) {
        (Some(true), _) => Befund::Verschluesselt,
        (Some(false), Some(true)) | (None, _) => Befund::Unbekannt(Grund::AusgabeUnbekannt),
        (Some(false), _) => Befund::Unverschluesselt,
    }
}

/// `sysctl vm.swapusage`: `… (encrypted)` → verschlüsselt.
pub fn befund_aus_swapusage(text: &str) -> Befund {
    let text = text.trim();
    if !text.starts_with("vm.swapusage:") {
        Befund::Unbekannt(Grund::AusgabeUnbekannt)
    } else if text.contains("(encrypted)") {
        Befund::Verschluesselt
    } else {
        Befund::Unverschluesselt
    }
}

#[cfg(target_os = "macos")]
pub async fn pruefe_system(eingabe: &super::Eingabe) -> Vec<super::OrtErgebnis> {
    use super::{werkzeug, OrtArt, OrtErgebnis};
    use tokio::process::Command;

    async fn verzeichnis(pfad: &std::path::Path) -> Befund {
        let Ok(echt) = std::fs::canonicalize(pfad) else {
            return Befund::Unbekannt(Grund::KeinZugriff);
        };
        let mut df = Command::new("/bin/df");
        df.arg("-P").arg(&echt);
        let punkt = match werkzeug(df).await {
            Ok(text) => einhaengepunkt_aus_df(&text),
            Err(g) => return Befund::Unbekannt(g),
        };
        let Some(punkt) = punkt else {
            return Befund::Unbekannt(Grund::AusgabeUnbekannt);
        };
        if ist_startvolume(&punkt) {
            let mut fde = Command::new("/usr/bin/fdesetup");
            fde.arg("isactive");
            werkzeug(fde)
                .await
                .map_or_else(Befund::Unbekannt, |t| befund_aus_fdesetup(&t))
        } else {
            let mut du = Command::new("/usr/sbin/diskutil");
            du.args(["info", "-plist"]).arg(&punkt);
            werkzeug(du)
                .await
                .map_or_else(Befund::Unbekannt, |t| befund_aus_diskutil(&t))
        }
    }

    let mut orte = Vec::new();
    for (art, pfad) in eingabe.verzeichnisse() {
        orte.push(OrtErgebnis {
            art,
            pfad: pfad.display().to_string(),
            befund: verzeichnis(pfad).await,
        });
    }
    let mut sysctl = Command::new("/usr/sbin/sysctl");
    sysctl.arg("vm.swapusage");
    orte.push(OrtErgebnis {
        art: OrtArt::Auslagerung,
        pfad: "/private/var/vm".into(),
        befund: werkzeug(sysctl)
            .await
            .map_or_else(Befund::Unbekannt, |t| befund_aus_swapusage(&t)),
    });
    orte
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn einhaengepunkt_aus_df_auch_mit_leerzeichen() {
        let df = "Filesystem     512-blocks      Used Available Capacity  Mounted on\n\
                  /dev/disk3s5    965595304 412345678 523456789    45%    /System/Volumes/Data\n";
        assert_eq!(
            einhaengepunkt_aus_df(df).as_deref(),
            Some("/System/Volumes/Data")
        );
        let extern_ = "Filesystem 512-blocks Used Available Capacity Mounted on\n\
                       /dev/disk5s1 1000 10 990 1% /Volumes/Einsatz Daten\n";
        assert_eq!(
            einhaengepunkt_aus_df(extern_).as_deref(),
            Some("/Volumes/Einsatz Daten")
        );
        assert_eq!(
            einhaengepunkt_aus_df("df: /x: No such file or directory\n"),
            None
        );
    }

    #[test]
    fn startvolume() {
        assert!(ist_startvolume("/"));
        assert!(ist_startvolume("/System/Volumes/Data"));
        assert!(!ist_startvolume("/Volumes/USB"));
    }

    #[test]
    fn fdesetup() {
        assert_eq!(befund_aus_fdesetup("true\n"), Befund::Verschluesselt);
        assert_eq!(befund_aus_fdesetup("false\n"), Befund::Unverschluesselt);
        assert_eq!(
            befund_aus_fdesetup(""),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
    }

    #[test]
    fn diskutil_plist() {
        let an = "<dict>\n\t<key>Encryption</key>\n\t<true/>\n\t<key>FileVault</key>\n\t<true/>\n</dict>";
        let aus = "<dict><key>Encryption</key><false/><key>FileVault</key><false/></dict>";
        let nur_encryption =
            "<dict><key>Encryption</key><true/><key>FileVault</key><false/></dict>";
        let ohne = "<dict><key>Content</key><string>Apple_HFS</string></dict>";
        assert_eq!(befund_aus_diskutil(an), Befund::Verschluesselt);
        assert_eq!(
            befund_aus_diskutil(nur_encryption),
            Befund::Unbekannt(Grund::AusgabeUnbekannt),
            "Widerspruch bleibt unbekannt"
        );
        assert_eq!(befund_aus_diskutil(aus), Befund::Unverschluesselt);
        assert_eq!(
            befund_aus_diskutil("<dict><key>FileVault</key><false/></dict>"),
            Befund::Unverschluesselt
        );
        assert_eq!(
            befund_aus_diskutil(ohne),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
    }

    #[test]
    fn swapusage() {
        assert_eq!(
            befund_aus_swapusage(
                "vm.swapusage: total = 2048.00M  used = 1093.25M  free = 954.75M  (encrypted)\n"
            ),
            Befund::Verschluesselt
        );
        assert_eq!(
            befund_aus_swapusage("vm.swapusage: total = 1024.00M  used = 0.00M  free = 1024.00M\n"),
            Befund::Unverschluesselt
        );
        assert_eq!(
            befund_aus_swapusage("sysctl: unknown oid"),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
    }
}
