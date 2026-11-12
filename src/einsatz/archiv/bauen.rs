//! Archivdatei eines Einsatzes bauen (LLH-1494, design.md D9).
//!
//! Eine Archivdatei ist eine SQLite-Datei mit demselben Schema wie die Einsatz-Datenbank samt
//! `_sqlx_migrations`. Sie enthält nur den einen Einsatz. Archive leben Jahre; eine spätere
//! Version spielt sie über ihre Migrationen ein wie eine alte Sicherung.
//!
//! 1. Eine leere Datei neben der Datenbank (`lifeline-zwischen-…`) wird migriert.
//! 2. Die Zeilen des Einsatzes kommen hinein: alle gespiegelten Tabellen
//!    ([`crate::instanz::spiegel::art::GESPIEGELT`]) und die Kategorie-Fristen. Dazu kommen die
//!    Stammdaten, auf die sie verweisen ([`STAMM`]), ohne Anmeldedaten und Notizen.
//! 3. Je Block entsteht eine Kopie, auf der die Schwärzung der früher endenden Kategorien läuft
//!    (vorhandener Code, [`crate::einsatz::aufbewahrung_kategorie::schwaerzen`]). Danach wird sie
//!    neu geschrieben (`VACUUM`) und an die Empfänger verschlüsselt.
//!
//! Die Zwischendateien liegen nur während des Baus im Klartext neben der Datenbank und werden in
//! jedem Fall gelöscht ([`Zwischendatei`]).

use crate::einsatz::aufbewahrung_kategorie as kategorie;
use crate::einsatz::retention::Datenkategorie;
use crate::einsatz::schwaerzung_registry::Scoping;
use crate::error::AppError;
use crate::instanz::spiegel::art;
use futures::TryStreamExt;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, SqlitePool, TypeInfo, ValueRef};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Einsatztabellen außerhalb des Spiegels, die ins Archiv gehören: die Fristen je Kategorie,
/// damit ein Block weiß, was in ihm schon geschwärzt ist.
pub const ZUSAETZLICH: &[&str] = &["einsatz_aufbewahrung_kategorie"];

/// Was eine Stammdaten-Spalte im Archiv trägt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stammspalte {
    /// Der Wert, wie er ist.
    Behalten,
    /// NULL statt des Werts.
    Leer,
    /// Eine feste Zahl statt des Werts (für `NOT NULL`-Spalten).
    Zahl(i64),
    /// Ein fester Text statt des Werts (für `NOT NULL`-Spalten).
    Text(&'static str),
}

use Stammspalte::{Behalten as B, Leer as L};

/// Stammdaten, auf die Einsatzzeilen verweisen, mit jeder ihrer Spalten. Ein Konto kommt mit
/// Namen und Rollen ins Archiv, ohne Anmeldedaten und gesperrt; Telefonnummern und Notizen der
/// Stammdaten bleiben draußen. Der Test `stamm_deckt_alle_verweise_und_spalten` hält Tabellen und
/// Spalten gegen das Schema fest: eine neue Spalte muss hier eingeordnet werden.
pub const STAMM: &[(&str, &[(&str, Stammspalte)])] = &[
    (
        "organisation",
        &[
            ("id", B),
            ("name", B),
            ("erstellt_at", B),
            ("tz_organisation", B),
        ],
    ),
    (
        "benutzer",
        &[
            ("id", B),
            ("org_id", B),
            ("anzeigename", B),
            ("benutzername", B),
            ("passwort_hash", Stammspalte::Text("")),
            ("system_rolle", B),
            ("aktiv", Stammspalte::Zahl(0)),
            ("erstellt_at", B),
            ("org_rolle", B),
            ("oidc_subject", L),
            ("oidc_issuer", L),
            ("totp_secret", L),
            ("totp_aktiviert", Stammspalte::Zahl(0)),
            ("webauthn_user_handle", L),
            ("totp_letzter_schritt", L),
            ("totp_fehlversuche", Stammspalte::Zahl(0)),
            ("totp_gesperrt_bis", L),
            ("passwort_wechsel_pflicht", Stammspalte::Zahl(0)),
        ],
    ),
    (
        "personal",
        &[
            ("id", B),
            ("org_id", B),
            ("benutzer_id", B),
            ("name", B),
            ("personalnummer", B),
            ("traegerorganisation", B),
            ("telefon", L),
            ("staerke_position", B),
            ("bemerkung", L),
            ("dienststatus", B),
            ("angelegt_at", B),
        ],
    ),
    (
        "fahrzeug",
        &[
            ("id", B),
            ("org_id", B),
            ("funkrufname", B),
            ("fahrzeugtyp", B),
            ("traegerorganisation", B),
            ("kennzeichen", B),
            ("opta", B),
            ("standort", B),
            ("fms_issi", B),
            ("sondersignal", B),
            ("tragenkapazitaet", B),
            ("staerke_fuehrer", B),
            ("staerke_unterfuehrer", B),
            ("staerke_mannschaft", B),
            ("bemerkung", L),
            ("dienststatus", B),
            ("angelegt_at", B),
        ],
    ),
    (
        "material",
        &[
            ("id", B),
            ("org_id", B),
            ("bezeichnung", B),
            ("kategorie", B),
            ("bestandsnummer", B),
            ("traegerorganisation", B),
            ("standort", B),
            ("bemerkung", L),
            ("dienststatus", B),
            ("angelegt_at", B),
            ("art", B),
        ],
    ),
    (
        "einheit_typ",
        &[
            ("id", B),
            ("org_id", B),
            ("label", B),
            ("soll_fuehrer", B),
            ("soll_unterfuehrer", B),
            ("soll_mannschaft", B),
            ("sortier", B),
            ("aktiv", B),
            ("quali_soll", B),
        ],
    ),
    (
        "fahrzeug_status",
        &[
            ("id", B),
            ("org_id", B),
            ("label", B),
            ("kategorie", B),
            ("farbe", B),
            ("fms_anker", B),
            ("sortier", B),
            ("aktiv", B),
            ("zeitachse_marke", B),
        ],
    ),
    (
        "personal_status",
        &[
            ("id", B),
            ("org_id", B),
            ("label", B),
            ("kategorie", B),
            ("farbe", B),
            ("sortier", B),
            ("aktiv", B),
            ("zeitachse_marke", B),
            ("pause", B),
        ],
    ),
];

/// Die Einsatztabellen im Archiv.
pub fn tabellen() -> impl Iterator<Item = &'static str> {
    art::GESPIEGELT
        .iter()
        .map(|g| g.tabelle)
        .chain(ZUSAETZLICH.iter().copied())
}

/// Bedingung „die Zeile gehört zum Einsatz“; Bind-Parameter ist die `einsatz_id`. Ohne den
/// Zeilenfilter der Registry: ins Archiv gehören auch die Zeilen, die die Schwärzung als
/// Stammdaten übergeht.
fn zum_einsatz(tabelle: &str) -> String {
    match art::scoping(tabelle) {
        Scoping::SelbstId => "id = ?".into(),
        Scoping::EinsatzId => "einsatz_id = ?".into(),
        Scoping::UeberParent { fk, parent } => {
            format!("{fk} IN (SELECT id FROM {parent} WHERE einsatz_id = ?)")
        }
    }
}

/// Eine Zwischendatei im Klartext; wird beim Fallenlassen mit ihren Nebendateien gelöscht.
pub struct Zwischendatei(PathBuf);

impl Zwischendatei {
    pub fn pfad(&self) -> &Path {
        &self.0
    }
}

impl Drop for Zwischendatei {
    fn drop(&mut self) {
        for endung in ["", "-wal", "-shm", "-journal"] {
            let mut p = self.0.clone().into_os_string();
            p.push(endung);
            let _ = std::fs::remove_file(PathBuf::from(p));
        }
    }
}

/// Das Verzeichnis der Datenbank, sonst (In-Memory, Tests) das Temp-Verzeichnis.
async fn verzeichnis(pool: &SqlitePool) -> Result<PathBuf, AppError> {
    let zeilen: Vec<(i64, String, String)> = sqlx::query_as("PRAGMA database_list")
        .fetch_all(pool)
        .await?;
    let datei = zeilen
        .into_iter()
        .find(|(_, name, _)| name == "main")
        .map(|(_, _, datei)| datei)
        .filter(|d| !d.is_empty());
    Ok(
        match datei.as_deref().map(Path::new).and_then(Path::parent) {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => std::env::temp_dir(),
        },
    )
}

fn zwischendatei(verzeichnis: &Path, einsatz_id: i64, teil: &str) -> Zwischendatei {
    let zufall: u64 = {
        use argon2::password_hash::rand_core::{OsRng, RngCore};
        OsRng.next_u64()
    };
    Zwischendatei(verzeichnis.join(format!(
        "lifeline-zwischen-archiv-{einsatz_id}-{teil}-{zufall:016x}.sqlite"
    )))
}

/// Ein Pool mit genau einer Verbindung auf einer Zwischendatei.
async fn oeffnen(pfad: &Path, fremdschluessel: bool) -> Result<SqlitePool, AppError> {
    let optionen = SqliteConnectOptions::new()
        .filename(pfad)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Delete)
        .foreign_keys(fremdschluessel);
    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(optionen)
        .await?)
}

/// Ein Wert beliebigen Typs aus einer Zeile.
enum Wert {
    Null,
    Zahl(i64),
    Real(f64),
    Text(String),
    Bytes(Vec<u8>),
}

fn wert(zeile: &SqliteRow, i: usize) -> Result<Wert, AppError> {
    let roh = zeile.try_get_raw(i)?;
    if roh.is_null() {
        return Ok(Wert::Null);
    }
    let typ = roh.type_info().name().to_string();
    Ok(match typ.as_str() {
        "INTEGER" | "BOOLEAN" => Wert::Zahl(zeile.try_get_unchecked(i)?),
        "REAL" => Wert::Real(zeile.try_get_unchecked(i)?),
        "BLOB" => Wert::Bytes(zeile.try_get_unchecked(i)?),
        _ => Wert::Text(zeile.try_get_unchecked(i)?),
    })
}

/// Kopiert die Zeilen aus `quelle`, die `bedingung` mit `einsatz_id` trifft, in die gleichnamige
/// Tabelle des Archivs. `ersatz` ersetzt Spaltenwerte (Stammdaten). Liefert die Zahl der Zeilen.
async fn kopiere(
    quelle: &SqlitePool,
    archiv: &SqlitePool,
    tabelle: &str,
    bedingung: &str,
    bind: &[i64],
    ersatz: Option<&[(&str, Stammspalte)]>,
) -> Result<usize, AppError> {
    let sql = format!("SELECT * FROM {tabelle} WHERE {bedingung}");
    let mut abfrage = sqlx::query(sqlx::AssertSqlSafe(sql));
    for b in bind {
        abfrage = abfrage.bind(*b);
    }
    let mut zeilen = abfrage.fetch(quelle);
    let mut ziel = archiv.acquire().await?;
    let mut anzahl = 0;
    while let Some(zeile) = zeilen.try_next().await? {
        let spalten: Vec<String> = zeile
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect();
        let liste = spalten
            .iter()
            .map(|s| format!("\"{s}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let platzhalter = vec!["?"; spalten.len()].join(", ");
        let sql = format!("INSERT OR IGNORE INTO {tabelle} ({liste}) VALUES ({platzhalter})");
        let mut einfuegen = sqlx::query(sqlx::AssertSqlSafe(sql));
        for (i, name) in spalten.iter().enumerate() {
            let regel = ersatz.map(|e| {
                e.iter()
                    .find(|(s, _)| s == name)
                    .map(|(_, r)| *r)
                    // Eine Spalte, die STAMM nicht kennt, geht leer hinein (fail-closed); der
                    // Test `stamm_deckt_alle_verweise_und_spalten` meldet sie vorher.
                    .unwrap_or(Stammspalte::Leer)
            });
            let w = match regel {
                Some(Stammspalte::Leer) => Wert::Null,
                Some(Stammspalte::Zahl(z)) => Wert::Zahl(z),
                Some(Stammspalte::Text(t)) => Wert::Text(t.to_string()),
                Some(Stammspalte::Behalten) | None => wert(&zeile, i)?,
            };
            einfuegen = match w {
                Wert::Null => einfuegen.bind(None::<i64>),
                Wert::Zahl(z) => einfuegen.bind(z),
                Wert::Real(r) => einfuegen.bind(r),
                Wert::Text(t) => einfuegen.bind(t),
                Wert::Bytes(b) => einfuegen.bind(b),
            };
        }
        anzahl += einfuegen.execute(&mut *ziel).await?.rows_affected() as usize;
    }
    Ok(anzahl)
}

/// Zieht die Stammdaten nach, auf die Zeilen im Archiv verweisen, bis nichts mehr fehlt.
async fn stamm_nachziehen(quelle: &SqlitePool, archiv: &SqlitePool) -> Result<(), AppError> {
    let stamm: BTreeMap<&str, &[(&str, Stammspalte)]> = STAMM.iter().copied().collect();
    let mut kopiert: BTreeMap<&str, BTreeSet<i64>> = BTreeMap::new();
    loop {
        let mut gewuenscht: BTreeMap<&str, BTreeSet<i64>> = BTreeMap::new();
        let tabellen: Vec<String> = tabellen()
            .map(str::to_string)
            .chain(stamm.keys().map(|s| s.to_string()))
            .collect();
        for t in &tabellen {
            let verweise: Vec<(i64, i64, String, String, Option<String>)> =
                sqlx::query_as(sqlx::AssertSqlSafe(format!(
                    "SELECT id, seq, \"table\", \"from\", \"to\" FROM pragma_foreign_key_list('{t}')"
                )))
                .fetch_all(archiv)
                .await?;
            for (_, _, eltern, spalte, _) in verweise {
                let Some((name, _)) = stamm.get_key_value(eltern.as_str()) else {
                    continue;
                };
                let ids: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT DISTINCT \"{spalte}\" FROM {t} WHERE typeof(\"{spalte}\") = 'integer'"
                )))
                .fetch_all(archiv)
                .await?;
                gewuenscht.entry(name).or_default().extend(ids);
            }
        }
        let mut neu = false;
        for (name, ids) in gewuenscht {
            let schon = kopiert.entry(name).or_default();
            let fehlend: Vec<i64> = ids.difference(schon).copied().collect();
            if fehlend.is_empty() {
                continue;
            }
            for stueck in fehlend.chunks(500) {
                let platzhalter = vec!["?"; stueck.len()].join(", ");
                kopiere(
                    quelle,
                    archiv,
                    name,
                    &format!("id IN ({platzhalter})"),
                    stueck,
                    Some(stamm[name]),
                )
                .await?;
            }
            schon.extend(fehlend);
            neu = true;
        }
        if !neu {
            return Ok(());
        }
    }
}

/// Die vollständige Kopie des Einsatzes, ohne Schwärzung (Grundlage aller Blöcke).
pub async fn vollkopie(pool: &SqlitePool, einsatz_id: i64) -> Result<Zwischendatei, AppError> {
    let datei = zwischendatei(&verzeichnis(pool).await?, einsatz_id, "voll");
    let archiv = oeffnen(datei.pfad(), false).await?;
    crate::db::migrate(&archiv)
        .await
        .map_err(|e| AppError::Internal(format!("Archiv: Migration der Datei: {e}")))?;
    // Migrationen, die Tabellen neu bauen, schalten Fremdschlüssel am Ende wieder ein.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&archiv)
        .await?;
    // Der Kopf zuletzt: Trigger, die Zeilen eines abgeschlossenen Einsatzes abweisen, sehen ihn
    // so noch nicht. Fremdschlüssel sind während der Kopie aus; die Stammdaten folgen danach.
    let mut reihenfolge: Vec<&str> = tabellen().filter(|t| *t != "einsatz").collect();
    reihenfolge.push("einsatz");
    for t in reihenfolge {
        kopiere(pool, &archiv, t, &zum_einsatz(t), &[einsatz_id], None).await?;
    }
    stamm_nachziehen(pool, &archiv).await?;
    // Was die Log-Trigger beim Einfügen mitschrieben, gehört nicht ins Archiv.
    sqlx::query("DELETE FROM einsatz_aenderung")
        .execute(&archiv)
        .await?;
    let verletzt: Vec<(String, Option<i64>, String, i64)> =
        sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&archiv)
            .await?;
    for (tabelle, _, eltern, _) in verletzt.iter().take(5) {
        tracing::debug!(einsatz_id, %tabelle, %eltern, "Archiv: Verweis ohne Ziel (bleibt stehen)");
    }
    archiv.close().await;
    Ok(datei)
}

/// Eine Kategorie mit eigener Frist, die beim Archivieren noch nicht geschwärzt ist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffeneKategorie {
    pub kategorie: Datenkategorie,
    pub frist_bis: String,
}

/// Ein Block vor der Verschlüsselung: bis wann er gilt und welche Kategorien in ihm geschwärzt
/// sind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockPlan {
    pub block: i64,
    pub gueltig_bis: Option<String>,
    pub geschwaerzt: Vec<Datenkategorie>,
}

/// Gestaffelte Blöcke (K3): Fristenden `t1 < … < tn` aus den Kategorie-Fristen vor dem Ende der
/// Aufbewahrung und dem Ende selbst (`None` = unbegrenzt). In Block i sind alle Kategorien
/// geschwärzt, deren Frist spätestens mit Block i−1 endet; eine schon abgelaufene Frist zählt
/// für alle Blöcke.
pub fn plane_bloecke(
    kategorien: &[OffeneKategorie],
    aufbewahrung_bis: Option<&str>,
    jetzt: &str,
) -> Vec<BlockPlan> {
    let mut enden: BTreeSet<&str> = kategorien
        .iter()
        .map(|k| k.frist_bis.as_str())
        .filter(|f| *f > jetzt && aufbewahrung_bis.is_none_or(|a| *f < a))
        .collect();
    let mut grenzen: Vec<Option<&str>> = enden.iter().map(|e| Some(*e)).collect();
    grenzen.push(aufbewahrung_bis);
    enden.clear();
    let mut vorher = jetzt;
    let mut plan = Vec::with_capacity(grenzen.len());
    for (i, grenze) in grenzen.into_iter().enumerate() {
        let geschwaerzt = kategorien
            .iter()
            .filter(|k| k.frist_bis.as_str() <= vorher)
            .map(|k| k.kategorie)
            .collect();
        plan.push(BlockPlan {
            block: i as i64 + 1,
            gueltig_bis: grenze.map(str::to_string),
            geschwaerzt,
        });
        if let Some(g) = grenze {
            vorher = g;
        }
    }
    plan
}

/// Ein fertiger, verschlüsselter Block.
pub struct Block {
    pub plan: BlockPlan,
    pub inhalt: Vec<u8>,
    pub sha256: String,
}

/// Baut einen Block aus der Vollkopie: Kopie, Schwärzung der Kategorien des Plans, `VACUUM`,
/// Verschlüsselung.
pub async fn baue_block(
    voll: &Zwischendatei,
    einsatz_id: i64,
    plan: BlockPlan,
    empfaenger: &[age::x25519::Recipient],
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<Block, AppError> {
    let verzeichnis = voll
        .pfad()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let datei = zwischendatei(&verzeichnis, einsatz_id, &format!("block{}", plan.block));
    std::fs::copy(voll.pfad(), datei.pfad())
        .map_err(|e| AppError::Internal(format!("Archiv: Kopie für Block: {e}")))?;
    let archiv = oeffnen(datei.pfad(), true).await?;
    for k in &plan.geschwaerzt {
        // Die Karenz gilt im Archiv nicht: der Block ist für die Zeit nach dem Fristende.
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = '2000-01-01 00:00:00' \
             WHERE einsatz_id = ? AND kategorie = ? AND geschwaerzt_at IS NULL",
        )
        .bind(einsatz_id)
        .bind(k.as_str())
        .execute(&archiv)
        .await?;
        kategorie::schwaerzen(&archiv, einsatz_id, *k, jetzt)
            .await
            .map_err(|e| {
                AppError::Internal(format!(
                    "Archiv: Schwärzung „{}“ in Block {}: {e}",
                    k.as_str(),
                    plan.block
                ))
            })?;
    }
    sqlx::query("DELETE FROM einsatz_aenderung")
        .execute(&archiv)
        .await?;
    sqlx::query("VACUUM").execute(&archiv).await?;
    archiv.close().await;

    let empfaenger = crate::backup::verschluesselung::Empfaenger::neu(empfaenger.to_vec());
    let abbruch = std::sync::atomic::AtomicBool::new(false);
    let pfad = datei.pfad().to_path_buf();
    let inhalt = tokio::task::spawn_blocking(move || {
        crate::backup::verschluesselung::verschluessele_datei(
            &pfad,
            Vec::new(),
            &empfaenger,
            &abbruch,
        )
    })
    .await
    .map_err(|e| AppError::Internal(format!("Archiv: Verschlüsselung: {e}")))?
    .map_err(|e| AppError::Internal(format!("Archiv: Verschlüsselung: {e}")))?;
    drop(datei);
    let sha256 = Sha256::digest(&inhalt)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(Block {
        plan,
        inhalt,
        sha256,
    })
}
