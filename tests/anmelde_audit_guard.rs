//! Struktureller Guard: kein Weg zur Sitzung ohne Anmelde-Audit (LFH-846).
//!
//! Bis LFH-792 legten OIDC, Passwort mit TOTP und der benutzergebundene Passkey eine Sitzung
//! an, ohne `login_ok` zu schreiben; aufgefallen ist das erst bei einer Messung. Die
//! Integrationstests in `tests/anmelde_audit.rs` prüfen die heutigen Wege, ein neuer Weg fiele
//! dort nicht auf. Dieser Guard prüft deshalb jede Funktion unter `src/`, die
//! `session::anlegen(` aufruft. Sie besteht, wenn
//!
//! - ihr eigener Rumpf `audit::schreibe(` mit `Ereignis::LoginOk` enthält (so `login` und
//!   `app_code_einloesen`), oder
//! - sie eine innere Prüffunktion ist, deren Aufrufer in derselben Datei das Ergebnis an
//!   `audit_anmeldung(` gibt (so OIDC, Passkey und TOTP seit LFH-792).
//!
//! Dazu prüft er, dass `audit_anmeldung` selbst noch `login_ok` schreibt.
//!
//! Parst Quelltext zeilenweise, bewusst ohne `regex`-Dependency — dasselbe Vorgehen wie
//! `tests/json_extractor_guard.rs`. Kommentarzeilen zählen nicht; ab `#[cfg(test)]` endet der
//! Produktionscode einer Datei.

use std::fs;
use std::path::{Path, PathBuf};

/// Der Sammelpunkt in `routes/auth.rs`, über den die Handler protokollieren.
const SAMMELPUNKT: &str = "audit_anmeldung";

/// Eine Funktion im Quelltext: Name, Kopfzeile und Rumpf bis zur nächsten Funktion.
struct Funktion {
    name: String,
    kopf: String,
    rumpf: String,
}

/// Zeilenanfänge, die eine Funktion beginnen.
fn fn_name(zeile: &str) -> Option<String> {
    let mut t = zeile.trim_start();
    for praefix in ["pub(crate) ", "pub ", "async ", "fn "] {
        if let Some(rest) = t.strip_prefix(praefix) {
            t = rest;
            if praefix == "fn " {
                let name: String = t
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                return (!name.is_empty()).then_some(name);
            }
        }
    }
    None
}

/// Zerlegt den Produktionscode einer Datei in Funktionen.
fn funktionen(quelle: &str) -> Vec<Funktion> {
    let zeilen: Vec<&str> = quelle
        .lines()
        .take_while(|z| z.trim() != "#[cfg(test)]")
        .filter(|z| !z.trim_start().starts_with("//"))
        .collect();
    let anfaenge: Vec<(usize, String)> = zeilen
        .iter()
        .enumerate()
        .filter_map(|(i, z)| fn_name(z).map(|n| (i, n)))
        .collect();
    anfaenge
        .iter()
        .enumerate()
        .map(|(k, (start, name))| {
            let ende = anfaenge.get(k + 1).map_or(zeilen.len(), |(e, _)| *e);
            Funktion {
                name: name.clone(),
                kopf: zeilen[*start].trim().to_string(),
                rumpf: zeilen[*start..ende].join("\n"),
            }
        })
        .collect()
}

/// Ruft `rumpf` die Funktion `name` auf (`name(` ohne Bezeichnerzeichen davor)?
fn ruft_auf(rumpf: &str, name: &str) -> bool {
    let muster = format!("{name}(");
    rumpf.match_indices(&muster).any(|(pos, _)| {
        rumpf[..pos]
            .chars()
            .next_back()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
    })
}

fn schreibt_login_ok(rumpf: &str) -> bool {
    rumpf.contains("schreibe(") && rumpf.contains("Ereignis::LoginOk")
}

/// Kopfzeilen der Funktionen in `quelle`, die eine Sitzung anlegen, ohne dass ein `login_ok`
/// geschrieben wird, und die Anzahl der Funktionen mit `session::anlegen(` insgesamt.
fn sitzung_ohne_audit(quelle: &str) -> (Vec<String>, usize) {
    let alle = funktionen(quelle);
    let mut verstoesse = Vec::new();
    let mut anleger = 0;
    for f in alle
        .iter()
        .filter(|f| f.rumpf.contains("session::anlegen("))
    {
        anleger += 1;
        let direkt = f.rumpf.contains("audit::schreibe(") && schreibt_login_ok(&f.rumpf);
        let ueber_sammelpunkt = alle.iter().any(|aufrufer| {
            aufrufer.name != f.name
                && ruft_auf(&aufrufer.rumpf, &f.name)
                && ruft_auf(&aufrufer.rumpf, SAMMELPUNKT)
        });
        if !(direkt || ueber_sammelpunkt) {
            verstoesse.push(f.kopf.clone());
        }
    }
    (verstoesse, anleger)
}

fn rs_dateien(verzeichnis: &Path, ziel: &mut Vec<PathBuf>) {
    for eintrag in fs::read_dir(verzeichnis)
        .expect("Verzeichnis lesbar")
        .filter_map(Result::ok)
    {
        let pfad = eintrag.path();
        if pfad.is_dir() {
            rs_dateien(&pfad, ziel);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            ziel.push(pfad);
        }
    }
}

#[test]
fn jede_funktion_mit_session_anlegen_schreibt_login_ok() {
    let mut dateien = Vec::new();
    rs_dateien(Path::new("src"), &mut dateien);
    dateien.sort();

    let mut verstoesse = Vec::new();
    let mut anleger = 0;
    for pfad in &dateien {
        let quelle = fs::read_to_string(pfad).expect("Quelldatei lesbar");
        let (treffer, anzahl) = sitzung_ohne_audit(&quelle);
        anleger += anzahl;
        verstoesse.extend(
            treffer
                .into_iter()
                .map(|t| format!("{}: {t}", pfad.display())),
        );
    }

    // Passwort, OIDC, Passkey (benutzergebunden und discoverable), TOTP, Systembrowser.
    assert!(
        anleger >= 6,
        "Guard fand nur {anleger} Funktionen mit session::anlegen — Pfad oder Muster kaputt?"
    );
    assert!(
        verstoesse.is_empty(),
        "Diese Funktionen legen eine Sitzung an, ohne dass ein `login_ok` ins Auth-Audit geht \
         (LFH-846). Entweder selbst `auth::audit::schreibe` mit `Ereignis::LoginOk` aufrufen \
         oder als innere Prüffunktion über `{SAMMELPUNKT}` laufen:\n{}",
        verstoesse.join("\n")
    );
}

#[test]
fn sammelpunkt_schreibt_selbst_login_ok() {
    let quelle = fs::read_to_string("src/routes/auth.rs").expect("routes/auth.rs lesbar");
    let sammelpunkt = funktionen(&quelle)
        .into_iter()
        .find(|f| f.name == SAMMELPUNKT)
        .expect("`audit_anmeldung` in src/routes/auth.rs nicht gefunden — umbenannt?");
    assert!(
        schreibt_login_ok(&sammelpunkt.rumpf),
        "`{SAMMELPUNKT}` schreibt kein `login_ok` mehr; alle Wege darüber wären ohne Spur"
    );
}

/// Der Guard muss greifen, nicht nur per Konstruktion grün sein.
#[test]
fn guard_erkennt_sitzung_ohne_audit() {
    let quelle = r#"
pub async fn direkt(State(state): State<AppState>) -> Result<(), AppError> {
    let token = session::anlegen(&state.pool, 1).await?;
    crate::auth::audit::schreibe(&state.pool, AuditEintrag {
        ereignis: crate::auth::audit::Ereignis::LoginOk,
    }).await;
    Ok(())
}

pub async fn handler(State(state): State<AppState>) -> Result<(), AppError> {
    let ergebnis = innen_pruefen(&state.pool).await;
    audit_anmeldung(&state.pool, "x", None, ergebnis.as_ref()).await;
    Ok(())
}

async fn innen_pruefen(pool: &SqlitePool) -> Result<Benutzer, Abgewiesen> {
    let token = session::anlegen(pool, 1).await?;
    Ok(b)
}

pub async fn neuer_weg(State(state): State<AppState>) -> Result<(), AppError> {
    // session::anlegen(&state.pool, 1) steht hier nur im Kommentar.
    let token = session::anlegen(&state.pool, 1).await?;
    Ok(())
}

async fn verwaist_pruefen(pool: &SqlitePool) -> Result<Benutzer, Abgewiesen> {
    let token = session::anlegen(pool, 1).await?;
    Ok(b)
}

pub async fn ruft_nur_aehnlich_auf(State(state): State<AppState>) {
    let e = nicht_verwaist_pruefen(&state.pool).await;
    audit_anmeldung(&state.pool, "x", None, e.as_ref()).await;
}

#[cfg(test)]
mod tests {
    async fn hilfe() { session::anlegen(&pool, 1).await.unwrap(); }
}
"#;
    let (verstoesse, anleger) = sitzung_ohne_audit(quelle);
    assert_eq!(anleger, 4, "Kommentar und Testmodul zählen nicht");
    assert_eq!(
        verstoesse,
        vec![
            "pub async fn neuer_weg(State(state): State<AppState>) -> Result<(), AppError> {",
            "async fn verwaist_pruefen(pool: &SqlitePool) -> Result<Benutzer, Abgewiesen> {",
        ],
        "direkt protokollierend und über den Sammelpunkt besteht; ohne Audit und mit nur \
         ähnlich benanntem Aufrufer nicht"
    );
}
