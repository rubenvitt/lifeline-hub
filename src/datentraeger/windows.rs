//! Windows: BitLocker bzw. Geräteverschlüsselung je Laufwerk. Gefragt wird über PowerShell die
//! Shell-Eigenschaft `System.Volume.BitLockerProtection`, die auch ohne Adminrechte antwortet;
//! `manage-bde` und WMI `Win32_EncryptableVolume` verlangen Adminrechte und liefern lokalisierte
//! Texte. Die Auslagerungsdateien nennt `Win32_PageFileUsage` (ohne Adminrechte), ihr Laufwerk
//! wird genauso geprüft.
//!
//! Die Auswertung ist rein und läuft auf jedem Rechner; nur der Aufruf hängt an Windows. Die
//! Zuordnung der Werte ist aus Beispielen abgeleitet, nicht auf echter Hardware belegt: was
//! nicht passt, ist `unbekannt`.

#![cfg_attr(not(target_os = "windows"), allow(dead_code, unused_imports))]

use super::{Befund, Grund};
use std::collections::HashMap;

/// Laufwerk (`C:`) eines kanonischen Pfads (`\\?\C:\…`). Netzpfade sind nicht prüfbar.
pub fn laufwerk(pfad: &str) -> Result<String, Grund> {
    let pfad = pfad.strip_prefix(r"\\?\").unwrap_or(pfad);
    if pfad.starts_with(r"UNC\") || pfad.starts_with(r"\\") {
        return Err(Grund::Netzlaufwerk);
    }
    let mut zeichen = pfad.chars();
    match (zeichen.next(), zeichen.next()) {
        (Some(b), Some(':')) if b.is_ascii_alphabetic() => {
            Ok(format!("{}:", b.to_ascii_uppercase()))
        }
        _ => Err(Grund::AusgabeUnbekannt),
    }
}

/// Wert von `System.Volume.BitLockerProtection`: `1` an, `6` an und gesperrt → verschlüsselt;
/// `2` aus → unverschlüsselt. Alles andere (wird verschlüsselt, ausgesetzt, wartet auf
/// Aktivierung, leer) ist `unbekannt`.
pub fn befund_aus_bitlocker(wert: &str) -> Befund {
    match wert.trim() {
        "1" | "6" => Befund::Verschluesselt,
        "2" => Befund::Unverschluesselt,
        _ => Befund::Unbekannt(Grund::AusgabeUnbekannt),
    }
}

/// PowerShell-Skript für die Laufwerke der Orte. Die Laufwerke stammen aus [`laufwerk`] und
/// sind deshalb immer `X:`; nichts anderes gelangt ins Skript.
pub fn skript(laufwerke: &[String]) -> String {
    let liste = laufwerke
        .iter()
        .filter(|l| l.len() == 2 && l.as_bytes()[0].is_ascii_uppercase() && l.ends_with(':'))
        .map(|l| format!("'{l}'"))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "$ErrorActionPreference = 'Stop'\n\
         $p = @()\n\
         try {{ $p = @(Get-CimInstance -ClassName Win32_PageFileUsage | ForEach-Object {{ $_.Name }}); 'AUSLAGERUNG_GELESEN' }} catch {{}}\n\
         foreach ($n in $p) {{ 'AUSLAGERUNG=' + $n }}\n\
         try {{ Get-CimInstance -ClassName Win32_Volume | Where-Object {{ $_.Name -and $_.Name -notmatch '^[A-Za-z]:\\\\$' -and $_.Name -notlike '\\\\?\\*' }} | ForEach-Object {{ 'ORDNER=' + $_.Name }} }} catch {{}}\n\
         $s = New-Object -ComObject Shell.Application\n\
         $l = @({liste}) + @($p | Where-Object {{ $_ -match '^[A-Za-z]:' }} | ForEach-Object {{ $_.Substring(0,2).ToUpper() }}) | Sort-Object -Unique\n\
         foreach ($x in $l) {{ try {{ 'LAUFWERK=' + $x + '=' + $s.NameSpace($x + '\\').Self.ExtendedProperty('System.Volume.BitLockerProtection') }} catch {{ 'LAUFWERK=' + $x + '=' }} }}\n"
    )
}

/// Ausgabe des Skripts.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Ausgabe {
    /// Befund je Laufwerk (`C:`).
    pub laufwerke: HashMap<String, Befund>,
    /// Auslagerungsdateien; `None`, wenn `Win32_PageFileUsage` nicht lesbar war.
    pub auslagerung: Option<Vec<String>>,
    /// Volumes ohne eigenen Buchstaben, in einen Ordner eingehängt (`C:\Daten\`). Ihr
    /// Schutzstatus ist über den Laufwerksbuchstaben nicht zu erfahren.
    pub ordner: Vec<String>,
}

pub fn parse_ausgabe(text: &str) -> Ausgabe {
    let mut aus = Ausgabe::default();
    let mut auslagerung = Vec::new();
    let mut gelesen = false;
    for zeile in text.lines().map(str::trim) {
        if zeile == "AUSLAGERUNG_GELESEN" {
            gelesen = true;
        } else if let Some(datei) = zeile.strip_prefix("AUSLAGERUNG=") {
            auslagerung.push(datei.to_string());
        } else if let Some(ordner) = zeile.strip_prefix("ORDNER=") {
            aus.ordner.push(ordner.to_string());
        } else if let Some(rest) = zeile.strip_prefix("LAUFWERK=") {
            if let Some((lw, wert)) = rest.split_once('=') {
                aus.laufwerke
                    .insert(lw.to_ascii_uppercase(), befund_aus_bitlocker(wert));
            }
        }
    }
    aus.auslagerung = gelesen.then_some(auslagerung);
    aus
}

/// Befund eines Pfads aus der Skriptausgabe.
pub fn befund_fuer(ausgabe: &Ausgabe, pfad: &str) -> Befund {
    if in_ordner_volume(&ausgabe.ordner, pfad) {
        return Befund::Unbekannt(Grund::AusgabeUnbekannt);
    }
    match laufwerk(pfad) {
        Ok(lw) => ausgabe
            .laufwerke
            .get(&lw)
            .copied()
            .unwrap_or(Befund::Unbekannt(Grund::AusgabeUnbekannt)),
        Err(g) => Befund::Unbekannt(g),
    }
}

/// Ob `pfad` unter einem in einen Ordner eingehängten Volume liegt (Vergleich ohne Groß- und
/// Kleinschreibung, je Pfadkomponente).
fn in_ordner_volume(ordner: &[String], pfad: &str) -> bool {
    let pfad = pfad.strip_prefix(r"\\?\").unwrap_or(pfad).to_lowercase();
    let pfad = format!("{}\\", pfad.trim_end_matches('\\'));
    ordner.iter().any(|o| {
        let o = format!("{}\\", o.to_lowercase().trim_end_matches('\\'));
        pfad.starts_with(&o)
    })
}

/// Befund der Auslagerung: schlechtestes Laufwerk der Auslagerungsdateien; ohne Datei `None`.
pub fn befund_auslagerung(ausgabe: &Ausgabe) -> Option<(String, Befund)> {
    match &ausgabe.auslagerung {
        None => Some((
            "Win32_PageFileUsage".into(),
            Befund::Unbekannt(Grund::KeinZugriff),
        )),
        Some(dateien) if dateien.is_empty() => None,
        Some(dateien) => {
            let befund = super::schlechtester(dateien.iter().map(|d| befund_fuer(ausgabe, d)))?;
            Some((dateien.join(", "), befund))
        }
    }
}

#[cfg(target_os = "windows")]
pub async fn pruefe_system(eingabe: &super::Eingabe) -> Vec<super::OrtErgebnis> {
    use super::{werkzeug, OrtArt, OrtErgebnis};

    // Kanonische Pfade und ihre Laufwerke; ein nicht auflösbarer Pfad ist `kein_zugriff`.
    let orte: Vec<(OrtArt, String, Option<String>)> = eingabe
        .verzeichnisse()
        .into_iter()
        .map(|(art, pfad)| {
            let echt = std::fs::canonicalize(pfad)
                .ok()
                .map(|p| p.display().to_string());
            (art, pfad.display().to_string(), echt)
        })
        .collect();
    let laufwerke: Vec<String> = orte
        .iter()
        .filter_map(|(_, _, echt)| echt.as_deref().and_then(|e| laufwerk(e).ok()))
        .collect();

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut ps = tokio::process::Command::new("powershell.exe");
    ps.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &skript(&laufwerke),
    ])
    .creation_flags(CREATE_NO_WINDOW);
    let ausgabe = werkzeug(ps).await;

    let mut ergebnis: Vec<OrtErgebnis> = orte
        .into_iter()
        .map(|(art, pfad, echt)| {
            let befund = match (&ausgabe, echt) {
                (_, None) => Befund::Unbekannt(Grund::KeinZugriff),
                (Err(g), _) => Befund::Unbekannt(*g),
                (Ok(text), Some(echt)) => befund_fuer(&parse_ausgabe(text), &echt),
            };
            OrtErgebnis { art, pfad, befund }
        })
        .collect();
    let auslagerung = match &ausgabe {
        Ok(text) => befund_auslagerung(&parse_ausgabe(text)),
        Err(g) => Some(("Win32_PageFileUsage".into(), Befund::Unbekannt(*g))),
    };
    if let Some((pfad, befund)) = auslagerung {
        ergebnis.push(OrtErgebnis {
            art: OrtArt::Auslagerung,
            pfad,
            befund,
        });
    }
    ergebnis
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn laufwerk_aus_kanonischem_pfad() {
        assert_eq!(laufwerk(r"\\?\C:\Lifeline\daten").unwrap(), "C:");
        assert_eq!(laufwerk(r"d:\x").unwrap(), "D:");
        assert_eq!(
            laufwerk(r"\\?\UNC\nas\freigabe\lifeline"),
            Err(Grund::Netzlaufwerk)
        );
        assert_eq!(laufwerk(r"\\nas\freigabe"), Err(Grund::Netzlaufwerk));
        assert_eq!(laufwerk("relativ"), Err(Grund::AusgabeUnbekannt));
    }

    #[test]
    fn bitlocker_werte() {
        assert_eq!(befund_aus_bitlocker("1"), Befund::Verschluesselt);
        assert_eq!(befund_aus_bitlocker("6"), Befund::Verschluesselt);
        assert_eq!(befund_aus_bitlocker("2"), Befund::Unverschluesselt);
        for wert in ["", "0", "3", "5", "8", "An"] {
            assert_eq!(
                befund_aus_bitlocker(wert),
                Befund::Unbekannt(Grund::AusgabeUnbekannt),
                "{wert:?}"
            );
        }
    }

    #[test]
    fn skript_nimmt_nur_laufwerksbuchstaben() {
        let s = skript(&["C:".into(), "D:".into(), "'; Remove-Item x; '".into()]);
        assert!(s.contains("$l = @('C:','D:') +"));
        assert!(!s.contains("Remove-Item"));
    }

    const AUSGABE: &str = "AUSLAGERUNG_GELESEN\r\n\
                           AUSLAGERUNG=C:\\pagefile.sys\r\n\
                           AUSLAGERUNG=E:\\pagefile.sys\r\n\
                           LAUFWERK=C:=1\r\n\
                           LAUFWERK=D:=2\r\n\
                           LAUFWERK=E:=\r\n";

    #[test]
    fn ausgabe_wird_gelesen() {
        let a = parse_ausgabe(AUSGABE);
        assert_eq!(a.laufwerke["C:"], Befund::Verschluesselt);
        assert_eq!(a.laufwerke["D:"], Befund::Unverschluesselt);
        assert_eq!(
            a.laufwerke["E:"],
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
        assert_eq!(
            a.auslagerung,
            Some(vec![r"C:\pagefile.sys".into(), r"E:\pagefile.sys".into()])
        );
    }

    #[test]
    fn befund_je_pfad() {
        let a = parse_ausgabe(AUSGABE);
        assert_eq!(befund_fuer(&a, r"\\?\C:\Lifeline"), Befund::Verschluesselt);
        assert_eq!(
            befund_fuer(&a, r"\\?\D:\Sicherung"),
            Befund::Unverschluesselt
        );
        assert_eq!(
            befund_fuer(&a, r"\\?\F:\fehlt"),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
        assert_eq!(
            befund_fuer(&a, r"\\?\UNC\nas\x"),
            Befund::Unbekannt(Grund::Netzlaufwerk)
        );
    }

    #[test]
    fn volume_in_einem_ordner_ist_unbekannt() {
        let a = parse_ausgabe("LAUFWERK=C:=1\nORDNER=C:\\Daten\\\nORDNER=C:\\Leer\\\n");
        assert_eq!(
            a.ordner,
            vec![r"C:\Daten\".to_string(), r"C:\Leer\".to_string()]
        );
        assert_eq!(
            befund_fuer(&a, r"\\?\C:\Daten\lifeline"),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
        assert_eq!(
            befund_fuer(&a, r"\\?\c:\daten"),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
        // Nur ganze Komponenten: `C:\Datenbank` liegt nicht unter `C:\Daten\`.
        assert_eq!(befund_fuer(&a, r"\\?\C:\Datenbank"), Befund::Verschluesselt);
    }

    #[test]
    fn skript_fragt_ordner_volumes_ab() {
        let s = skript(&["C:".into()]);
        assert!(s.contains("Win32_Volume"));
        assert!(s.contains(r"-notmatch '^[A-Za-z]:\\$'"));
        assert!(s.contains(r"-notlike '\\?\*'"));
    }

    #[test]
    fn auslagerung() {
        assert_eq!(
            befund_auslagerung(&parse_ausgabe(AUSGABE)),
            Some((
                r"C:\pagefile.sys, E:\pagefile.sys".into(),
                Befund::Unbekannt(Grund::AusgabeUnbekannt)
            ))
        );
        let nur_c = "AUSLAGERUNG_GELESEN\nAUSLAGERUNG=C:\\pagefile.sys\nLAUFWERK=C:=2\n";
        assert_eq!(
            befund_auslagerung(&parse_ausgabe(nur_c)),
            Some((r"C:\pagefile.sys".into(), Befund::Unverschluesselt))
        );
        // Keine Auslagerungsdatei: kein Ort.
        assert_eq!(
            befund_auslagerung(&parse_ausgabe("AUSLAGERUNG_GELESEN\nLAUFWERK=C:=1\n")),
            None
        );
        // Abfrage gescheitert: unbekannt statt still „keine“.
        assert_eq!(
            befund_auslagerung(&parse_ausgabe("LAUFWERK=C:=1\n")),
            Some((
                "Win32_PageFileUsage".into(),
                Befund::Unbekannt(Grund::KeinZugriff)
            ))
        );
    }
}
