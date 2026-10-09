//! Prüfung der Datenträgerverschlüsselung des Server-Rechners (LFH-1100).
//!
//! Auf dem Rechner, der den Server trägt, ist Datenträgerverschlüsselung Pflicht
//! (`docs/betrieb/packaging.md`, „Datenträgerverschlüsselung ist Pflicht“). Dieses Modul prüft
//! beim Start und danach stündlich, ob Datenbankverzeichnis, Sicherungsverzeichnis und
//! Auslagerung auf einem verschlüsselten Datenträger liegen, und hält das Ergebnis für die
//! Verwaltung bereit. Der Betrieb hängt nie daran: jedes Ergebnis, auch ein Fehler, ist nur eine
//! Meldung.
//!
//! Die Erkennung je System ist eine reine Funktion über Beispieldaten ([`linux`], [`macos`],
//! [`windows`]); nur das Einlesen (sysfs, Werkzeugaufruf) hängt am Betriebssystem. Was die
//! Prüfung nicht sicher bestimmen kann, ist `unbekannt`, nie `verschluesselt`.

pub mod linux;
pub mod macos;
pub mod windows;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use utoipa::ToSchema;

/// Abstand der Prüfungen nach der ersten beim Start.
pub const PRUEF_ABSTAND: Duration = Duration::from_secs(60 * 60);

/// Zeitlimit eines Werkzeugaufrufs unter macOS und Windows.
pub const WERKZEUG_ZEITLIMIT: Duration = Duration::from_secs(10);

wire_enum! {
    /// Ergebnis der Prüfung für einen Ort oder gesamt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    #[schema(as = DatentraegerWert)]
    pub enum Wert {
        Verschluesselt => "verschluesselt",
        Unverschluesselt => "unverschluesselt",
        Unbekannt => "unbekannt",
    }
}

wire_enum! {
    /// Warum ein Ort `unbekannt` ist.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    #[schema(as = DatentraegerGrund)]
    pub enum Grund {
        /// Netzlaufwerk oder durchgereichtes Dateisystem (NFS, SMB, 9p, FUSE …).
        Netzlaufwerk => "netzlaufwerk",
        /// Kein Blockgerät dahinter: overlay (Container), tmpfs, ZFS.
        Virtuell => "virtuell",
        /// Gerät oder Pfad nicht lesbar, etwa im Container oder ohne Rechte.
        KeinZugriff => "kein_zugriff",
        /// Betriebssystem ohne Prüfung.
        NichtUnterstuetzt => "nicht_unterstuetzt",
        /// Werkzeug fehlt, startet nicht oder überschreitet das Zeitlimit.
        WerkzeugFehlt => "werkzeug_fehlt",
        /// Ausgabe, die die Prüfung nicht kennt.
        AusgabeUnbekannt => "ausgabe_unbekannt",
    }
}

wire_enum! {
    /// Geprüfter Ort.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    #[schema(as = DatentraegerOrtArt)]
    pub enum OrtArt {
        /// Verzeichnis von `--db-path`.
        Datenbank => "datenbank",
        /// `--backup-verzeichnis`.
        Sicherung => "sicherung",
        /// Swap bzw. Auslagerungsdatei.
        Auslagerung => "auslagerung",
    }
}

/// Befund für einen Ort: der Wert, bei `unbekannt` mit Grund.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Befund {
    Verschluesselt,
    Unverschluesselt,
    Unbekannt(Grund),
}

impl Befund {
    pub fn wert(self) -> Wert {
        match self {
            Befund::Verschluesselt => Wert::Verschluesselt,
            Befund::Unverschluesselt => Wert::Unverschluesselt,
            Befund::Unbekannt(_) => Wert::Unbekannt,
        }
    }

    pub fn grund(self) -> Option<Grund> {
        match self {
            Befund::Unbekannt(g) => Some(g),
            _ => None,
        }
    }

    /// `unverschluesselt` vor `unbekannt` vor `verschluesselt`.
    fn rang(self) -> u8 {
        match self {
            Befund::Verschluesselt => 0,
            Befund::Unbekannt(_) => 1,
            Befund::Unverschluesselt => 2,
        }
    }
}

/// Der schlechteste Befund; bei Gleichstand der erste. Leer → `None`.
pub fn schlechtester(befunde: impl IntoIterator<Item = Befund>) -> Option<Befund> {
    befunde.into_iter().fold(None, |beste, b| match beste {
        Some(alt) if alt.rang() >= b.rang() => Some(alt),
        _ => Some(b),
    })
}

/// Befund eines Ortes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrtErgebnis {
    pub art: OrtArt,
    /// Geprüfter Pfad; bei der Auslagerung die Swap-Einträge, mit `, ` getrennt.
    pub pfad: String,
    pub befund: Befund,
}

/// Ergebnis einer Prüfung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ergebnis {
    /// Zeitpunkt der Prüfung (`zeit::FORMAT`, UTC).
    pub geprueft_um: String,
    pub orte: Vec<OrtErgebnis>,
}

impl Ergebnis {
    /// Schlechtester Befund aller Orte; ohne Orte `unbekannt`.
    pub fn gesamt(&self) -> Befund {
        schlechtester(self.orte.iter().map(|o| o.befund))
            .unwrap_or(Befund::Unbekannt(Grund::AusgabeUnbekannt))
    }

    /// Ob gewarnt wird: bei `unverschluesselt` immer, bei `unbekannt` nur ohne Zusicherung
    /// externer Verschlüsselung (`--datentraeger-verschluesselung-extern`).
    pub fn warnung(&self, extern_zugesichert: bool) -> bool {
        match self.gesamt() {
            Befund::Verschluesselt => false,
            Befund::Unverschluesselt => true,
            Befund::Unbekannt(_) => !extern_zugesichert,
        }
    }

    /// Ob sich ein neues Ergebnis vom alten so unterscheidet, dass es eine Logzeile wert ist.
    /// Der Zeitpunkt zählt nicht.
    pub fn geaendert_gegen(&self, alt: Option<&Ergebnis>) -> bool {
        alt.is_none_or(|alt| alt.orte != self.orte)
    }
}

/// Was geprüft wird.
#[derive(Debug, Clone)]
pub struct Eingabe {
    /// Verzeichnis der Datenbank.
    pub datenbank: PathBuf,
    /// Sicherungsverzeichnis, falls konfiguriert.
    pub sicherung: Option<PathBuf>,
}

impl Eingabe {
    /// Aus `--db-path` und `--backup-verzeichnis`. Ein `--db-path` ohne Verzeichnisanteil liegt
    /// im Arbeitsverzeichnis.
    pub fn aus_config(db_path: &str, backup_verzeichnis: Option<&str>) -> Self {
        let eltern = Path::new(db_path)
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        Eingabe {
            datenbank: eltern.to_path_buf(),
            sicherung: backup_verzeichnis.map(PathBuf::from),
        }
    }

    /// Die Verzeichnis-Orte in Prüfreihenfolge.
    fn verzeichnisse(&self) -> Vec<(OrtArt, &Path)> {
        let mut orte = vec![(OrtArt::Datenbank, self.datenbank.as_path())];
        if let Some(s) = &self.sicherung {
            orte.push((OrtArt::Sicherung, s.as_path()));
        }
        orte
    }
}

/// Prüft alle Orte auf dem laufenden Betriebssystem.
pub async fn pruefe(eingabe: &Eingabe) -> Ergebnis {
    let orte = pruefe_orte(eingabe).await;
    Ergebnis {
        geprueft_um: crate::zeit::jetzt(),
        orte,
    }
}

#[cfg(target_os = "linux")]
async fn pruefe_orte(eingabe: &Eingabe) -> Vec<OrtErgebnis> {
    let eingabe = eingabe.clone();
    tokio::task::spawn_blocking(move || linux::pruefe_system(&eingabe))
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("Datenträgerprüfung abgebrochen: {e}");
            Vec::new()
        })
}

#[cfg(target_os = "macos")]
async fn pruefe_orte(eingabe: &Eingabe) -> Vec<OrtErgebnis> {
    macos::pruefe_system(eingabe).await
}

#[cfg(target_os = "windows")]
async fn pruefe_orte(eingabe: &Eingabe) -> Vec<OrtErgebnis> {
    windows::pruefe_system(eingabe).await
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
async fn pruefe_orte(eingabe: &Eingabe) -> Vec<OrtErgebnis> {
    eingabe
        .verzeichnisse()
        .into_iter()
        .map(|(art, pfad)| OrtErgebnis {
            art,
            pfad: pfad.display().to_string(),
            befund: Befund::Unbekannt(Grund::NichtUnterstuetzt),
        })
        .collect()
}

/// Startet einen Werkzeugaufruf mit Zeitlimit und liefert die Standardausgabe. Der Exit-Code
/// zählt nicht (`fdesetup isactive` endet bei „aus“ mit 1), nur ob eine Ausgabe kam.
#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn werkzeug(mut befehl: tokio::process::Command) -> Result<String, Grund> {
    befehl
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(WERKZEUG_ZEITLIMIT, befehl.output()).await {
        Ok(Ok(ausgabe)) => Ok(String::from_utf8_lossy(&ausgabe.stdout).into_owned()),
        Ok(Err(_)) | Err(_) => Err(Grund::WerkzeugFehlt),
    }
}

/// Letztes Ergebnis und die Zusicherung externer Verschlüsselung; die Prüfschleife schreibt,
/// `GET /api/system/datentraeger` liest.
#[derive(Debug, Clone, Default)]
pub struct Stand(Arc<RwLock<Zustand>>);

#[derive(Debug, Default)]
struct Zustand {
    ergebnis: Option<Ergebnis>,
    extern_zugesichert: bool,
}

impl Stand {
    pub fn neu(extern_zugesichert: bool) -> Self {
        Stand(Arc::new(RwLock::new(Zustand {
            ergebnis: None,
            extern_zugesichert,
        })))
    }

    /// Letztes Ergebnis (vor der ersten Prüfung `None`) und die Zusicherung.
    pub fn lesen(&self) -> (Option<Ergebnis>, bool) {
        let z = self.0.read().unwrap_or_else(|e| e.into_inner());
        (z.ergebnis.clone(), z.extern_zugesichert)
    }

    /// Legt ein neues Ergebnis ab und schreibt die Logzeile, wenn es sich geändert hat.
    pub fn ablegen(&self, neu: Ergebnis) {
        let mut z = self.0.write().unwrap_or_else(|e| e.into_inner());
        if neu.geaendert_gegen(z.ergebnis.as_ref()) {
            protokolliere(&neu, z.extern_zugesichert);
        }
        z.ergebnis = Some(neu);
    }
}

/// Eine Zeile je Ergebnis: `warn` bei Warnung, sonst `info`.
fn protokolliere(ergebnis: &Ergebnis, extern_zugesichert: bool) {
    let orte = ergebnis
        .orte
        .iter()
        .map(|o| match o.befund.grund() {
            Some(g) => format!(
                "{} {}: {} ({})",
                o.art.as_str(),
                o.pfad,
                o.befund.wert().as_str(),
                g.as_str()
            ),
            None => format!(
                "{} {}: {}",
                o.art.as_str(),
                o.pfad,
                o.befund.wert().as_str()
            ),
        })
        .collect::<Vec<_>>()
        .join("; ");
    let gesamt = ergebnis.gesamt().wert().as_str();
    if ergebnis.warnung(extern_zugesichert) {
        tracing::warn!(
            gesamt,
            "Datenträgerverschlüsselung ist Pflicht, Prüfung ergibt {gesamt}: {orte}"
        );
    } else {
        tracing::info!(gesamt, extern_zugesichert, "Datenträgerprüfung: {orte}");
    }
}

/// Startet die Prüfschleife: sofort, danach alle [`PRUEF_ABSTAND`]. Der Start wartet nicht.
pub fn starte(stand: Stand, eingabe: Eingabe) {
    tokio::spawn(async move {
        let mut takt = tokio::time::interval(PRUEF_ABSTAND);
        takt.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            takt.tick().await;
            stand.ablegen(pruefe(&eingabe).await);
        }
    });
}

/// Antwort von `GET /api/system/datentraeger`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DatentraegerStatus {
    /// Schlechtester Wert aller Orte; vor der ersten Prüfung `unbekannt`.
    pub gesamt: Wert,
    /// Ob die Verwaltung warnt (vor der ersten Prüfung nie).
    pub warnung: bool,
    /// `--datentraeger-verschluesselung-extern` ist gesetzt.
    pub extern_zugesichert: bool,
    /// Zeitpunkt der letzten Prüfung; fehlt vor der ersten.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geprueft_um: Option<String>,
    pub orte: Vec<DatentraegerOrt>,
}

/// Ein Ort in [`DatentraegerStatus`].
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DatentraegerOrt {
    pub art: OrtArt,
    pub pfad: String,
    pub wert: Wert,
    /// Nur bei `unbekannt`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<Grund>,
}

impl DatentraegerStatus {
    pub fn aus(ergebnis: Option<&Ergebnis>, extern_zugesichert: bool) -> Self {
        match ergebnis {
            None => DatentraegerStatus {
                gesamt: Wert::Unbekannt,
                warnung: false,
                extern_zugesichert,
                geprueft_um: None,
                orte: Vec::new(),
            },
            Some(e) => DatentraegerStatus {
                gesamt: e.gesamt().wert(),
                warnung: e.warnung(extern_zugesichert),
                extern_zugesichert,
                geprueft_um: Some(e.geprueft_um.clone()),
                orte: e
                    .orte
                    .iter()
                    .map(|o| DatentraegerOrt {
                        art: o.art,
                        pfad: o.pfad.clone(),
                        wert: o.befund.wert(),
                        grund: o.befund.grund(),
                    })
                    .collect(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ort(art: OrtArt, befund: Befund) -> OrtErgebnis {
        OrtErgebnis {
            art,
            pfad: "/data".into(),
            befund,
        }
    }

    fn ergebnis(befunde: &[Befund]) -> Ergebnis {
        Ergebnis {
            geprueft_um: "2026-10-09 12:00:00".into(),
            orte: befunde.iter().map(|b| ort(OrtArt::Datenbank, *b)).collect(),
        }
    }

    const UNBEKANNT: Befund = Befund::Unbekannt(Grund::KeinZugriff);

    #[test]
    fn gesamt_ist_der_schlechteste_wert() {
        use Befund::*;
        assert_eq!(ergebnis(&[Verschluesselt]).gesamt(), Verschluesselt);
        assert_eq!(ergebnis(&[Verschluesselt, UNBEKANNT]).gesamt(), UNBEKANNT);
        assert_eq!(
            ergebnis(&[UNBEKANNT, Unverschluesselt, Verschluesselt]).gesamt(),
            Unverschluesselt
        );
        assert_eq!(
            ergebnis(&[]).gesamt(),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
    }

    #[test]
    fn bei_gleichstand_bleibt_der_erste_grund() {
        let b = schlechtester([
            Befund::Unbekannt(Grund::Netzlaufwerk),
            Befund::Unbekannt(Grund::Virtuell),
        ]);
        assert_eq!(b, Some(Befund::Unbekannt(Grund::Netzlaufwerk)));
    }

    #[test]
    fn zusicherung_schaltet_nur_unbekannt_ab() {
        let unbekannt = ergebnis(&[Befund::Verschluesselt, UNBEKANNT]);
        assert!(unbekannt.warnung(false));
        assert!(!unbekannt.warnung(true));

        let unverschluesselt = ergebnis(&[Befund::Unverschluesselt]);
        assert!(unverschluesselt.warnung(false));
        assert!(
            unverschluesselt.warnung(true),
            "Zusicherung verdeckt keinen Befund"
        );

        let gut = ergebnis(&[Befund::Verschluesselt]);
        assert!(!gut.warnung(false));
    }

    #[test]
    fn log_nur_beim_ersten_ergebnis_und_bei_aenderung() {
        let a = ergebnis(&[Befund::Verschluesselt]);
        let mut a_spaeter = a.clone();
        a_spaeter.geprueft_um = "2026-10-09 13:00:00".into();
        let b = ergebnis(&[Befund::Unverschluesselt]);

        assert!(a.geaendert_gegen(None));
        assert!(!a_spaeter.geaendert_gegen(Some(&a)), "nur die Zeit ist neu");
        assert!(b.geaendert_gegen(Some(&a)));
    }

    #[test]
    fn status_vor_der_ersten_pruefung_warnt_nicht() {
        let s = DatentraegerStatus::aus(None, false);
        assert_eq!(s.gesamt, Wert::Unbekannt);
        assert!(!s.warnung);
        assert!(s.geprueft_um.is_none());
        assert!(s.orte.is_empty());
    }

    #[test]
    fn status_traegt_grund_nur_bei_unbekannt() {
        let e = Ergebnis {
            geprueft_um: "2026-10-09 12:00:00".into(),
            orte: vec![
                ort(OrtArt::Datenbank, Befund::Verschluesselt),
                ort(OrtArt::Auslagerung, Befund::Unbekannt(Grund::Netzlaufwerk)),
            ],
        };
        let s = DatentraegerStatus::aus(Some(&e), false);
        assert_eq!(s.gesamt, Wert::Unbekannt);
        assert!(s.warnung);
        assert_eq!(s.orte[0].grund, None);
        assert_eq!(s.orte[1].grund, Some(Grund::Netzlaufwerk));
        let json = serde_json::to_value(&s).unwrap();
        assert!(!json["orte"][0].as_object().unwrap().contains_key("grund"));
        assert_eq!(json["orte"][1]["grund"], "netzlaufwerk");
        assert_eq!(json["orte"][1]["art"], "auslagerung");
    }

    #[test]
    fn eingabe_nimmt_das_verzeichnis_der_datenbank() {
        let e = Eingabe::aus_config("/data/lifeline.db", Some("/mnt/usb"));
        assert_eq!(e.datenbank, PathBuf::from("/data"));
        assert_eq!(e.sicherung, Some(PathBuf::from("/mnt/usb")));
        assert_eq!(
            Eingabe::aus_config("lifeline.db", None).datenbank,
            PathBuf::from(".")
        );
    }

    #[test]
    fn stand_merkt_ergebnis_und_zusicherung() {
        let stand = Stand::neu(true);
        assert_eq!(stand.lesen(), (None, true));
        let e = ergebnis(&[Befund::Verschluesselt]);
        stand.ablegen(e.clone());
        assert_eq!(stand.lesen(), (Some(e), true));
    }
}
