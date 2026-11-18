//! Einsatzakte (LLH-1835): `GET /api/einsaetze/{id}/einsatzakte/anlagen.zip` — alle Anhänge und
//! Tabellen eines Einsatzes in einem ZIP (`openspec/changes/hsdhm2ki-einsatzakte/design.md` D6,
//! D7). Den lesbaren Teil der Akte druckt der Browser.

use crate::anhang::audit_repo::{self as anhang_audit, ZugriffFassung};
use crate::app::AppState;
use crate::einsatz::berechtigung::modul_freigaben;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatzakte::{self, AkteDatei, Herkunft, ZipBau};
use crate::error::AppError;
use crate::person::audit_repo as person_audit;
use crate::routes::backup::{chunk_stream, Lauf, LEERLAUF_FRIST};
use crate::routes::support::{anhang_fuer_akte, AkteInhalt};
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::IntoResponse;
use chrono::Local;
use std::collections::HashMap;

/// Welche Module die Akte dieser Person aufnimmt: jedes Modul der Akte muss lesbar sein (sonst
/// 403, Spec `einsatzakte`, „Vollständig oder gar nicht“); ein im Einsatz ausgeblendetes fällt
/// weg, auch für den System-Admin, der es erreichen könnte — wie „nicht genutzt“ im Druck.
fn sichtbare_module(
    freigaben: &HashMap<&'static str, crate::einsatz::berechtigung::ModulFreigabe>,
) -> Result<Vec<&'static str>, AppError> {
    let mut sichtbar = Vec::new();
    for modul in einsatzakte::AKTE_MODULE {
        // Ein Modul ohne Eintrag ist ein Programmierfehler (Test `akte_module_sind_modul_keys`);
        // im Betrieb fail-closed.
        let freigabe = freigaben.get(modul).ok_or(AppError::Forbidden)?;
        if !freigabe.sichtbar {
            continue;
        }
        if !freigabe.zugriff {
            return Err(AppError::Forbidden);
        }
        sichtbar.push(*modul);
    }
    Ok(sichtbar)
}

/// GET /api/einsaetze/{id}/einsatzakte/anlagen.zip
///
/// Reihenfolge: Gate (Lesezugriff, kein Gerät, jedes Modul der Akte) → Bauplatz (409) →
/// Sammeln → **Protokoll in EINER Transaktion** (Export der Betroffenentabelle, je
/// Personen-Anhang `anhang`, je UHS-Anhang ein Eintrag im Anhang-Protokoll) → ZIP in eine
/// Temp-Datei neben der Datenbank → Streaming. Scheitert das Protokoll, verlässt nichts den
/// Server; scheitert der Bau danach, steht höchstens ein Eintrag zu viel, nie einer zu wenig.
pub async fn anlagen_zip(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<impl IntoResponse, AppError> {
    // Personendaten nie am gekoppelten Gerät (`frontend/src/druck/AGENTS.md`, Personendruck).
    if ctx.geraet.is_some() {
        return Err(AppError::Forbidden);
    }
    let einsatz_id = ctx.einsatz.id;
    let freigaben = modul_freigaben(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
    )
    .await?;
    let module = sichtbare_module(&freigaben)?;
    let platz = state.einsatzakte_bau.belegen(einsatz_id)?;

    let dateien =
        einsatzakte::sammeln(&state.pool, einsatz_id, |h| module.contains(&h.modul())).await?;
    let mit_personen = module.contains(&"personen");
    let mit_tieren = module.contains(&"tiere");
    let mit_schaeden = module.contains(&"schaeden");

    // Protokoll, bevor Daten den Server verlassen.
    let benutzer_id = ctx.benutzer.id;
    let zu_protokollieren = dateien.clone();
    crate::write_retry!(&state.pool, |conn| {
        if mit_personen {
            person_audit::create_tx(conn, einsatz_id, None, benutzer_id, "export").await?;
        }
        for d in &zu_protokollieren {
            match d.herkunft {
                Herkunft::Betroffene => {
                    person_audit::create_tx(conn, einsatz_id, d.person_id, benutzer_id, "anhang")
                        .await?;
                }
                Herkunft::Unfallhilfsstellen => {
                    anhang_audit::anlegen_tx(
                        conn,
                        einsatz_id,
                        d.anhang_id,
                        &d.datensatz,
                        benutzer_id,
                        ZugriffFassung::Bereinigt,
                    )
                    .await?;
                }
                _ => {}
            }
        }
        Ok(())
    })?;

    // Tabellen im selben Stand wie die Einzel-Exporte.
    let mut tabellen: Vec<(&'static str, &'static str, String)> = Vec::new();
    if mit_personen {
        let personen = crate::person::repo::liste(&state.pool, einsatz_id, None).await?;
        tabellen.push((
            "betroffene.csv",
            "personen",
            super::einsatz_person::personen_csv(&personen),
        ));
    }
    if mit_tieren {
        let tiere = crate::tier::repo::liste(&state.pool, einsatz_id, None, None, None).await?;
        tabellen.push(("tiere.csv", "tiere", super::einsatz_tier::tiere_csv(&tiere)));
    }
    if mit_schaeden {
        let mut schaeden = crate::schaden::repo::liste(
            &state.pool,
            einsatz_id,
            &crate::schaden::repo::SchadenFilter::default(),
            None,
        )
        .await?;
        schaeden.reverse();
        tabellen.push((
            "schaeden.csv",
            "schaeden",
            super::einsatz_schaden::schaeden_csv(&schaeden),
        ));
    }

    // Neben der Datenbank, nicht im System-Temp (tmpfs, s. `routes::backup`); das Präfix räumt
    // der Start auf, falls der Prozess mitten im Bau endet.
    let basis = crate::backup::db_verzeichnis(&state.pool)
        .await?
        .unwrap_or_else(std::env::temp_dir);
    let dir = tempfile::Builder::new()
        .prefix(crate::backup::DOWNLOAD_PRAEFIX)
        .tempdir_in(&basis)
        .map_err(|e| AppError::Internal(format!("Tempverzeichnis fehlgeschlagen: {e}")))?;
    let pfad = dir.path().join("einsatzakte.zip");

    // Vom Request entkoppelt (wie `routes::backup`): bricht der Client während des Baus ab, läuft
    // der Bau zu Ende und hält Bauplatz und Verzeichnis so lange. Sonst begänne ein erneuter Klick
    // schon einen zweiten vollen Bau, während der erste noch schreibt.
    let pool = state.pool.clone();
    let ziel = pfad.clone();
    let (dir, platz) = tokio::spawn(async move {
        baue_zip(&pool, &ziel, tabellen, dateien)
            .await
            .map(|()| (dir, platz))
    })
    .await
    .map_err(|e| AppError::Internal(format!("ZIP-Bau abgebrochen: {e}")))??;

    let datei = tokio::fs::File::open(&pfad)
        .await
        .map_err(|e| AppError::Internal(format!("ZIP öffnen fehlgeschlagen: {e}")))?;
    let groesse = datei
        .metadata()
        .await
        .map_err(|e| AppError::Internal(format!("ZIP messen fehlgeschlagen: {e}")))?
        .len();
    let stream = chunk_stream(
        Lauf {
            datei,
            _dir: dir,
            _sperre: Box::new(platz),
        },
        LEERLAUF_FRIST,
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(groesse));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&crate::anhang::content_disposition(&zip_dateiname(
            &ctx.einsatz,
        )))
        .map_err(|e| AppError::Internal(format!("Ungültiger Header: {e}")))?,
    );
    Ok((headers, Body::from_stream(stream)))
}

/// Schreibt Tabellen und Anhänge in die Datei `ziel`. Die Bytes je Anhang holt
/// `support::anhang_fuer_akte`; geschrieben wird synchron außerhalb der Laufzeit-Threads.
async fn baue_zip(
    pool: &sqlx::SqlitePool,
    ziel: &std::path::Path,
    tabellen: Vec<(&'static str, &'static str, String)>,
    dateien: Vec<AkteDatei>,
) -> Result<(), AppError> {
    let datei = std::fs::File::create(ziel)
        .map_err(|e| AppError::Internal(format!("ZIP anlegen fehlgeschlagen: {e}")))?;
    let mut bau = ZipBau::neu(std::io::BufWriter::new(datei));
    bau = blockierend(move || {
        for (name, modul, csv) in &tabellen {
            bau.tabelle(name, modul, csv)?;
        }
        Ok(bau)
    })
    .await?;
    for d in dateien {
        let inhalt = anhang_fuer_akte(pool, d.anhang_id).await?;
        bau = blockierend(move || {
            schreibe_anhang(&mut bau, &d, inhalt)?;
            Ok(bau)
        })
        .await?;
    }
    blockierend(move || {
        let mut w = bau.abschliessen()?;
        std::io::Write::flush(&mut w)
            .map_err(|e| AppError::Internal(format!("ZIP schreiben: {e}")))?;
        Ok(())
    })
    .await
}

fn schreibe_anhang<W: std::io::Write + std::io::Seek>(
    bau: &mut ZipBau<W>,
    d: &AkteDatei,
    inhalt: AkteInhalt,
) -> Result<(), AppError> {
    match inhalt {
        AkteInhalt::Datei(daten) => bau.anhang(d, &daten),
        AkteInhalt::NichtEnthalten(grund) => {
            bau.nicht_enthalten(d, grund);
            Ok(())
        }
    }
}

/// Synchrones Schreiben außerhalb der Laufzeit-Threads.
async fn blockierend<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("ZIP-Bau abgebrochen: {e}")))?
}

/// `Einsatzakte_<Einsatznummer>_<JJJJ-MM-TT>_Anlagen.zip`. Ohne interne Einsatznummer die
/// Kennung. Das Datum in der Zeit des Servers, wie der Name der Sicherung (ADR-0012 regelt den
/// Wire, nicht Dateinamen).
fn zip_dateiname(einsatz: &crate::einsatz::Einsatz) -> String {
    let nummer = einsatz
        .einsatznummer_intern
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| einsatzakte::sicherer_teil(n, "Einsatz"))
        .unwrap_or_else(|| einsatz.id.to_string());
    format!(
        "Einsatzakte_{nummer}_{}_Anlagen.zip",
        Local::now().format("%Y-%m-%d")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::berechtigung::ModulFreigabe;

    fn alle(sichtbar: bool, zugriff: bool) -> HashMap<&'static str, ModulFreigabe> {
        crate::einsatz::modul::MODUL_KEYS
            .iter()
            .map(|k| (*k, ModulFreigabe { sichtbar, zugriff }))
            .collect()
    }

    #[test]
    fn akte_module_sind_modul_keys() {
        for m in einsatzakte::AKTE_MODULE {
            assert!(
                crate::einsatz::modul::MODUL_KEYS.contains(m),
                "{m} ist kein Modul-Key"
            );
        }
        for h in Herkunft::ALLE {
            assert!(einsatzakte::AKTE_MODULE.contains(&h.modul()));
        }
    }

    #[test]
    fn gesperrtes_modul_sperrt_die_akte() {
        let mut f = alle(true, true);
        f.insert(
            "personen",
            ModulFreigabe {
                sichtbar: true,
                zugriff: false,
            },
        );
        assert!(matches!(sichtbare_module(&f), Err(AppError::Forbidden)));
    }

    #[test]
    fn ausgeblendetes_modul_faellt_weg_statt_zu_sperren() {
        let mut f = alle(true, true);
        f.insert(
            "tiere",
            ModulFreigabe {
                sichtbar: false,
                zugriff: false,
            },
        );
        let module = sichtbare_module(&f).unwrap();
        assert!(!module.contains(&"tiere"));
        assert!(module.contains(&"personen"));
    }

    #[test]
    fn akte_module_wie_im_client() {
        let client = include_str!("../../frontend/src/druck/einsatzakte/quellen.ts");
        let start = client
            .find("export const AKTE_MODULE")
            .expect("AKTE_MODULE im Client");
        let ende = start + client[start..].find("];").expect("Ende der Liste");
        let liste = &client[start..ende];
        let im_client: Vec<&str> = liste
            .split('\'')
            .enumerate()
            .filter(|(i, _)| i % 2 == 1)
            .map(|(_, s)| s)
            .collect();
        assert_eq!(im_client, einsatzakte::AKTE_MODULE.to_vec());
    }
}
