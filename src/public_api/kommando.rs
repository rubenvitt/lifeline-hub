//! Kommando `lifeline-hub zugang …` (LLH-1652, design.md D9): Einlösen eines Einmal-Codes und
//! die Prüfroute für Betreiber eines Fremdsystems. Die Krypto steckt im Referenz-Client
//! `lifeline-machine-client`; hier nur Schlüsseldatei und Ausgabe.

use crate::config::ZugangCommand;
use anyhow::{bail, Context};
use lifeline_machine_client::Credentials;
use std::io::Write;
use std::path::Path;

fn client() -> anyhow::Result<reqwest::Client> {
    Ok(
        crate::ausgehend::client_builder(crate::ausgehend::Zweck::Anbindung)
            .timeout(std::time::Duration::from_secs(30))
            .build()?,
    )
}

/// Legt die Schlüsseldatei neu und nur für den Besitzer lesbar an. Eine vorhandene Datei bleibt
/// unangetastet: Sie trägt womöglich den einzigen Schlüssel eines laufenden Fremdsystems.
pub fn oeffne_schluesseldatei(pfad: &Path) -> anyhow::Result<std::fs::File> {
    let mut optionen = std::fs::OpenOptions::new();
    optionen.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        optionen.mode(0o600);
    }
    match optionen.open(pfad) {
        Ok(d) => Ok(d),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            bail!("{} gibt es schon; nicht überschrieben", pfad.display())
        }
        Err(e) => Err(e).with_context(|| format!("{} anlegen", pfad.display())),
    }
}

fn schreibe_in(datei: &mut std::fs::File, cred: &Credentials) -> anyhow::Result<()> {
    datei.write_all(serde_json::to_string_pretty(cred)?.as_bytes())?;
    datei.write_all(b"\n")?;
    datei.sync_all()?;
    Ok(())
}

/// Schreibt die Schlüsseldatei neu und nur für den Besitzer lesbar; nie über eine vorhandene.
pub fn write_schluesseldatei(pfad: &Path, cred: &Credentials) -> anyhow::Result<()> {
    let mut datei = oeffne_schluesseldatei(pfad)?;
    schreibe_in(&mut datei, cred)
}

pub async fn ausfuehren(befehl: ZugangCommand) -> anyhow::Result<()> {
    match befehl {
        ZugangCommand::Redeem { url, code, out } => {
            let pfad = Path::new(&out);
            // Die Datei entsteht VOR dem Einlösen: Danach ist der Code verbraucht, und ein privater
            // Schlüssel, der nirgends landet, wäre verloren.
            let mut datei = oeffne_schluesseldatei(pfad)?;
            let cred = match lifeline_machine_client::redeem(&client()?, &url, &code).await {
                Ok(c) => c,
                Err(e) => {
                    drop(datei);
                    let _ = std::fs::remove_file(pfad);
                    return Err(e.into());
                }
            };
            if let Err(e) = schreibe_in(&mut datei, &cred) {
                // Letzter Ausweg: der Schlüssel steht nur noch hier. Der Betreiber sichert ihn.
                eprintln!(
                    "Schlüsseldatei nicht geschrieben ({e}). Inhalt zum Sichern, geheim halten:\n{}",
                    serde_json::to_string_pretty(&cred)?
                );
                return Err(e);
            }
            println!("Eingelöst: Zugang {} an {}", cred.zugang_id, cred.base_url);
            println!("Schlüsseldatei: {out}");
            println!(
                "Fingerabdruck: {} (muss auf der Seite „Anbindungen“ am Zugang stehen)",
                cred.fingerprint()?
            );
            Ok(())
        }
        ZugangCommand::Me { datei } => {
            let text = std::fs::read_to_string(&datei).with_context(|| format!("{datei} lesen"))?;
            let cred: Credentials = serde_json::from_str(&text)
                .with_context(|| format!("{datei} ist keine Schlüsseldatei"))?;
            let jetzt = chrono::Utc::now().timestamp();
            let me = lifeline_machine_client::me(&client()?, &cred, jetzt).await?;
            println!("{}", serde_json::to_string_pretty(&me)?);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cred() -> Credentials {
        Credentials {
            zugang_id: "z".into(),
            instanz_id: "i".into(),
            base_url: "https://hub.example".into(),
            private_key: "AAAA".into(),
            public_key: "BBBB".into(),
            instanz_public_key: "CCCC".into(),
        }
    }

    #[test]
    fn schluesseldatei_wird_nie_ueberschrieben() {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("zugang.json");
        std::fs::write(&pfad, "alt").unwrap();
        assert!(write_schluesseldatei(&pfad, &cred()).is_err());
        assert_eq!(std::fs::read_to_string(&pfad).unwrap(), "alt");
    }

    #[cfg(unix)]
    #[test]
    fn schluesseldatei_ist_nur_fuer_den_besitzer_lesbar() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("zugang.json");
        write_schluesseldatei(&pfad, &cred()).unwrap();
        let modus = std::fs::metadata(&pfad).unwrap().permissions().mode() & 0o777;
        assert_eq!(modus, 0o600);
        let gelesen: Credentials =
            serde_json::from_str(&std::fs::read_to_string(&pfad).unwrap()).unwrap();
        assert_eq!(gelesen, cred());
    }

    #[test]
    fn kommando_wird_geparst() {
        use clap::Parser;
        let c = crate::config::Config::try_parse_from([
            "lifeline-hub",
            "zugang",
            "redeem",
            "https://hub.example",
            "ABCD-EFGH-JKMN-PQRS",
        ])
        .unwrap();
        match c.command {
            Some(crate::config::Command::Zugang(ZugangCommand::Redeem { url, code, out })) => {
                assert_eq!(
                    (url.as_str(), code.as_str(), out.as_str()),
                    (
                        "https://hub.example",
                        "ABCD-EFGH-JKMN-PQRS",
                        "lifeline-zugang.json"
                    )
                );
            }
            andere => panic!("{andere:?}"),
        }
    }

    /// Scheitert das Einlösen, bleibt keine leere Schlüsseldatei liegen; ist das Ziel nicht
    /// beschreibbar, wird gar nicht erst eingelöst (sonst wäre der Code verbraucht und der Schlüssel
    /// verloren).
    #[tokio::test]
    async fn redeem_legt_die_datei_vorher_an_und_raeumt_bei_fehler() {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("zugang.json");
        let fehler = ausfuehren(ZugangCommand::Redeem {
            url: "http://127.0.0.1:9".into(),
            code: "ABCD-EFGH-JKMN-PQRS".into(),
            out: pfad.to_string_lossy().into_owned(),
        })
        .await;
        assert!(fehler.is_err());
        assert!(
            !pfad.exists(),
            "keine leere Datei nach gescheitertem Einlösen"
        );

        let fehlt = dir.path().join("gibt/es/nicht/zugang.json");
        let fehler = ausfuehren(ZugangCommand::Redeem {
            url: "http://127.0.0.1:9".into(),
            code: "ABCD-EFGH-JKMN-PQRS".into(),
            out: fehlt.to_string_lossy().into_owned(),
        })
        .await
        .unwrap_err();
        assert!(fehler.to_string().contains("anlegen"), "{fehler}");
    }
}
