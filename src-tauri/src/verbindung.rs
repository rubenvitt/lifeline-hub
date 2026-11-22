//! Gespeicherte Serveradresse: `<app_config_dir>/verbindung.json` mit `{ "server": "…" }`, dazu
//! seit LLH-1282 `"bekannt": […]`, die zuletzt verbundenen Server (neuester zuerst), aus denen die
//! Maske wählen lässt. Eine Datei ohne `bekannt` kennt nur ihren `server`. Seit LLH-1982 dazu
//! `"vertraege": { "<origin>": n }`, der zuletzt bestätigte Hüllen-Vertrag je bekanntem Server; er
//! gilt, wenn der Server nicht erreichbar ist (`vertrag::evaluate`).
//!
//! Eine fehlende, unlesbare oder ungültige Datei heißt „keine Adresse“ — die Hülle zeigt dann
//! die Erststart-Maske, statt an einer kaputten Datei zu scheitern. Beim Lesen wird dieselbe
//! Prüfung angelegt wie bei der Eingabe: eine von Hand auf `http` geänderte Datei lädt nicht.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::adresse::pruefe_adresse;

pub const DATEINAME: &str = "verbindung.json";

/// Höchstzahl der gemerkten Server.
pub const MAX_BEKANNT: usize = 8;

#[derive(Serialize, Deserialize)]
struct Datei {
    server: String,
    #[serde(default)]
    bekannt: Vec<String>,
    /// Zuletzt bestätigter Hüllen-Vertrag je Origin, nur für bekannte Server.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    vertraege: BTreeMap<String, u32>,
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Nur die Verträge der Server, die noch in `liste` stehen.
fn vertraege_fuer(vertraege: BTreeMap<String, u32>, liste: &[Url]) -> BTreeMap<String, u32> {
    let origins: Vec<String> = liste.iter().map(origin).collect();
    vertraege
        .into_iter()
        .filter(|(schluessel, _)| origins.contains(schluessel))
        .collect()
}

fn read_datei(konfig_dir: &Path) -> Option<Datei> {
    let inhalt = fs::read_to_string(pfad(konfig_dir)).ok()?;
    serde_json::from_str(&inhalt).ok()
}

fn write_datei(konfig_dir: &Path, datei: &Datei) -> io::Result<()> {
    fs::create_dir_all(konfig_dir)?;
    fs::write(pfad(konfig_dir), serde_json::to_vec_pretty(datei)?)
}

/// Die gültigen Adressen in Reihenfolge, ohne Dopplungen, höchstens [`MAX_BEKANNT`].
fn bereinigt<'a>(adressen: impl IntoIterator<Item = &'a str>) -> Vec<Url> {
    let mut liste: Vec<Url> = Vec::new();
    for url in adressen.into_iter().filter_map(|a| pruefe_adresse(a).ok()) {
        if !liste.contains(&url) {
            liste.push(url);
        }
    }
    liste.truncate(MAX_BEKANNT);
    liste
}

pub fn pfad(konfig_dir: &Path) -> PathBuf {
    konfig_dir.join(DATEINAME)
}

/// Die gespeicherte, gültige Adresse — oder `None`.
pub fn lesen(konfig_dir: &Path) -> Option<Url> {
    pruefe_adresse(&read_datei(konfig_dir)?.server).ok()
}

/// Die bekannten Server, der verbundene zuerst. Leer ohne gültige Datei.
pub fn bekannte(konfig_dir: &Path) -> Vec<Url> {
    let Some(datei) = read_datei(konfig_dir) else {
        return Vec::new();
    };
    if pruefe_adresse(&datei.server).is_err() {
        return Vec::new();
    }
    bereinigt(
        std::iter::once(datei.server.as_str()).chain(datei.bekannt.iter().map(String::as_str)),
    )
}

/// Speichert die Adresse als verbundenen Server und setzt sie an die Spitze der bekannten; legt
/// das Verzeichnis bei Bedarf an.
pub fn schreiben(konfig_dir: &Path, server: &Url) -> io::Result<()> {
    let bisher: Vec<String> = bekannte(konfig_dir).into_iter().map(String::from).collect();
    let bekannt =
        bereinigt(std::iter::once(server.as_str()).chain(bisher.iter().map(String::as_str)));
    let vertraege = read_datei(konfig_dir)
        .map(|datei| vertraege_fuer(datei.vertraege, &bekannt))
        .unwrap_or_default();
    write_datei(
        konfig_dir,
        &Datei {
            server: server.to_string(),
            bekannt: bekannt.into_iter().map(String::from).collect(),
            vertraege,
        },
    )
}

/// Der zuletzt bestätigte Hüllen-Vertrag von `server` (gleiche Origin), falls gemerkt.
pub fn letzter_vertrag(konfig_dir: &Path, server: &Url) -> Option<u32> {
    read_datei(konfig_dir)?
        .vertraege
        .get(&origin(server))
        .copied()
}

/// Merkt den bestätigten Hüllen-Vertrag eines bekannten Servers; einen unbekannten nicht.
pub fn merke_vertrag(konfig_dir: &Path, server: &Url, vertrag: u32) -> io::Result<()> {
    let Some(mut datei) = read_datei(konfig_dir) else {
        return Ok(());
    };
    let schluessel = origin(server);
    let bekannt = bekannte(konfig_dir)
        .iter()
        .any(|url| origin(url) == schluessel);
    if !bekannt || datei.vertraege.get(&schluessel) == Some(&vertrag) {
        return Ok(());
    }
    datei.vertraege.insert(schluessel, vertrag);
    write_datei(konfig_dir, &datei)
}

/// Nimmt `adresse` aus den bekannten Servern. Der verbundene bleibt: er ist das Ziel von
/// „Abbrechen“ und jedes Starts.
pub fn vergessen(konfig_dir: &Path, adresse: &str) -> io::Result<()> {
    let (Some(datei), Ok(weg)) = (read_datei(konfig_dir), pruefe_adresse(adresse)) else {
        return Ok(());
    };
    if pruefe_adresse(&datei.server).ok().as_ref() == Some(&weg) {
        return Ok(());
    }
    let bleiben: Vec<Url> = bekannte(konfig_dir)
        .into_iter()
        .filter(|url| *url != weg)
        .collect();
    let vertraege = vertraege_fuer(datei.vertraege, &bleiben);
    write_datei(
        konfig_dir,
        &Datei {
            server: datei.server,
            bekannt: bleiben.into_iter().map(String::from).collect(),
            vertraege,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geschrieben_wird_wieder_gelesen() {
        let dir = tempfile::tempdir().unwrap();
        let unter = dir.path().join("neu/tiefer");
        let url = Url::parse("https://elw.local:8443").unwrap();
        schreiben(&unter, &url).unwrap();
        assert_eq!(lesen(&unter), Some(url));
    }

    #[test]
    fn fehlende_datei_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(lesen(dir.path()), None);
    }

    #[test]
    fn kaputte_datei_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(pfad(dir.path()), "{ kein json").unwrap();
        assert_eq!(lesen(dir.path()), None);
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn verbundene_server_werden_neuester_zuerst_gemerkt() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (
            url("https://elw.local:8443"),
            url("https://lifeline.example.org"),
        );
        schreiben(dir.path(), &a).unwrap();
        schreiben(dir.path(), &b).unwrap();
        assert_eq!(bekannte(dir.path()), [b.clone(), a.clone()]);
        // Erneut mit `a`: wandert nach vorn, ohne Dopplung.
        schreiben(dir.path(), &a).unwrap();
        assert_eq!(bekannte(dir.path()), [a.clone(), b]);
        assert_eq!(lesen(dir.path()), Some(a));
    }

    #[test]
    fn gemerkt_werden_hoechstens_max_bekannt() {
        let dir = tempfile::tempdir().unwrap();
        for nummer in 0..MAX_BEKANNT + 3 {
            schreiben(dir.path(), &url(&format!("https://elw{nummer}.local"))).unwrap();
        }
        let liste = bekannte(dir.path());
        assert_eq!(liste.len(), MAX_BEKANNT);
        assert_eq!(
            liste[0],
            url(&format!("https://elw{}.local", MAX_BEKANNT + 2))
        );
    }

    #[test]
    fn alte_datei_ohne_liste_kennt_ihren_server() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            pfad(dir.path()),
            r#"{ "server": "https://elw.local:8443/" }"#,
        )
        .unwrap();
        assert_eq!(bekannte(dir.path()), [url("https://elw.local:8443")]);
    }

    #[test]
    fn ungueltige_eintraege_der_liste_fallen_weg() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            pfad(dir.path()),
            r#"{ "server": "https://a.local/", "bekannt": ["http://b.local", "unsinn", "https://c.local/"] }"#,
        )
        .unwrap();
        assert_eq!(
            bekannte(dir.path()),
            [url("https://a.local"), url("https://c.local")]
        );
    }

    #[test]
    fn vergessen_nimmt_einen_server_aus_der_liste_aber_nie_den_verbundenen() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (url("https://a.local"), url("https://b.local"));
        schreiben(dir.path(), &a).unwrap();
        schreiben(dir.path(), &b).unwrap();
        vergessen(dir.path(), "https://b.local/").unwrap();
        assert_eq!(bekannte(dir.path()), [b.clone(), a.clone()]);
        vergessen(dir.path(), " https://a.local ").unwrap();
        assert_eq!(bekannte(dir.path()), std::slice::from_ref(&b));
        assert_eq!(lesen(dir.path()), Some(b));
    }

    #[test]
    fn von_hand_auf_http_geaendert_ist_keine_adresse() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(pfad(dir.path()), r#"{ "server": "http://elw.local:8080" }"#).unwrap();
        assert_eq!(lesen(dir.path()), None);
    }

    #[test]
    fn alte_datei_ohne_vertraege_bleibt_lesbar() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            pfad(dir.path()),
            r#"{ "server": "https://elw.local:8443/" }"#,
        )
        .unwrap();
        let server = url("https://elw.local:8443");
        assert_eq!(lesen(dir.path()), Some(server.clone()));
        assert_eq!(letzter_vertrag(dir.path(), &server), None);
    }

    #[test]
    fn gemerkter_vertrag_gilt_je_origin() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (url("https://a.local"), url("https://b.local"));
        schreiben(dir.path(), &a).unwrap();
        merke_vertrag(dir.path(), &a, 1).unwrap();
        assert_eq!(letzter_vertrag(dir.path(), &a), Some(1));
        assert_eq!(
            letzter_vertrag(dir.path(), &url("https://a.local/einsatz/1")),
            Some(1)
        );
        assert_eq!(letzter_vertrag(dir.path(), &b), None);
    }

    #[test]
    fn unbekannter_server_wird_nicht_gemerkt() {
        let dir = tempfile::tempdir().unwrap();
        schreiben(dir.path(), &url("https://a.local")).unwrap();
        let c = url("https://c.local");
        merke_vertrag(dir.path(), &c, 1).unwrap();
        assert_eq!(letzter_vertrag(dir.path(), &c), None);
    }

    #[test]
    fn schreiben_und_vergessen_erhalten_bzw_entfernen_den_vertrag() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (url("https://a.local"), url("https://b.local"));
        schreiben(dir.path(), &a).unwrap();
        merke_vertrag(dir.path(), &a, 1).unwrap();
        schreiben(dir.path(), &b).unwrap();
        assert_eq!(letzter_vertrag(dir.path(), &a), Some(1));
        vergessen(dir.path(), "https://a.local").unwrap();
        assert_eq!(letzter_vertrag(dir.path(), &a), None);
        // Wieder verbunden: kein alter Vertrag lebt auf.
        schreiben(dir.path(), &a).unwrap();
        assert_eq!(letzter_vertrag(dir.path(), &a), None);
    }
}
