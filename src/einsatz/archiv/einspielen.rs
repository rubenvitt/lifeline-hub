//! Einen Archivblock einspielen (LLH-1494, design.md D10 mit Nachtrag 12.11.2026).
//!
//! `lifeline-hub archiv einspielen` entschlüsselt einen Block in eine Zwischendatei neben der
//! Datenbank, bringt sie mit den Migrationen auf den Stand dieser Version und übernimmt den Einsatz
//! wie einen Spiegel: die Datei liefert (`spiegel::liefern`), die Installation übernimmt
//! (`spiegel::uebernehmen`). Der Einsatz erscheint als beendeter Spiegel „aus dem Archiv“, lesbar
//! und schreibgeschützt, und wird nach [`AUFBEWAHRUNG_TAGE`] Tagen abgeräumt.
//!
//! - Die Datei trägt kein Änderungslog; der Grundstock der Spiegel-Trigger trägt jede Zeile ein.
//! - Der Einsatz bekommt eine neue Kennung `archiv/…`: das Skelett desselben Einsatzes kann hier
//!   noch stehen.
//! - Eine Org-Zuordnung braucht die Übernahme nur für `einsatz_spiegel`; sie entsteht in der
//!   Transaktion und geht vor dem Commit wieder.
//! - Jedes Konto der Datei wird ein gesperrtes Platzhalter-Konto mit dem Namen aus dem Archiv
//!   (`archiv_konto`). Stammdaten gelten als dieselben, wenn es sie hier in der Ziel-Org mit
//!   derselben ID und demselben Namen gibt ([`STAMM_NAME`]); sonst fällt der Verweis weg.
//! - Ist die Aufbewahrung im Block abgelaufen, wird nicht eingespielt. Eine Kategorie, deren Frist
//!   inzwischen abgelaufen ist (ein veralteter Block), wird vorher in der Zwischendatei geschwärzt.

use super::bauen;
use crate::backup::verschluesselung::Schluessel;
use crate::einsatz::abraeumen::{self, AbraeumArt};
use crate::einsatz::aufbewahrung_kategorie as kategorie;
use crate::einsatz::STATUS_ABGESCHLOSSEN;
use crate::error::AppError;
use crate::instanz::spiegel::liefern::{self, Absender, Budget, Gefuehrt};
use crate::instanz::spiegel::paket::{KontoAngabe, SPIEGEL_MAX};
use crate::instanz::spiegel::uebernehmen::{self, Empfaenger};
use crate::instanz::spiegel::{art, schema};
use crate::instanz::stammdaten::art as stammdaten_art;
use chrono::{DateTime, TimeDelta, Utc};
use sha2::{Digest, Sha256};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::path::Path;

/// So viele Tage bleibt ein eingespielter Einsatz.
pub const AUFBEWAHRUNG_TAGE: i64 = 7;

/// Name der Gegenstelle eines eingespielten Einsatzes (Band, Löschprotokoll).
pub const GEGENSTELLE: &str = "Archiv";

/// Wer einspielt, in der Admin-Spur.
const BEFEHL: &str = "Befehl archiv einspielen";

/// Name, an dem eine Stammdatenzeile der Datei als dieselbe hier gilt (zusammen mit ID und Org),
/// je Stammdaten-Tabelle des Archivs außer Org und Konten ([`bauen::STAMM`]).
pub const STAMM_NAME: &[(&str, &str)] = &[
    ("personal", "name"),
    ("fahrzeug", "funkrufname"),
    ("material", "bezeichnung"),
    ("einheit_typ", "label"),
    ("fahrzeug_status", "label"),
    ("personal_status", "label"),
];

/// Kennung der Org-Zuordnung in der Zwischendatei (nur dort, für `stammdaten_herkunft`).
const ZUORDNUNG_DATEI: i64 = 1;

/// Was eingespielt wurde.
#[derive(Debug)]
pub struct Eingespielt {
    pub einsatz_id: i64,
    pub bezeichnung: String,
    pub einsatznummer: Option<String>,
    pub org_name: String,
    /// Wann der Einsatz wieder geht (UTC).
    pub loeschen_at: String,
    /// Inhalte (Anhänge, Pläne), die mitkamen.
    pub inhalte: usize,
    /// Was nicht oder anders übernommen wurde.
    pub hinweise: Vec<String>,
}

/// Der Einsatz in der Datei.
#[derive(sqlx::FromRow)]
struct Kopf {
    id: i64,
    org_id: i64,
    status: String,
    retention_bis: Option<String>,
    freigabestufe: String,
    bezeichnung: String,
    einsatznummer_intern: Option<String>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn datei_sha256(datei: &Path) -> Result<String, AppError> {
    let mut eingabe = std::fs::File::open(datei)
        .map_err(|e| AppError::Validation(format!("Archivblock nicht lesbar: {e}")))?;
    let mut hash = Sha256::new();
    let mut puffer = vec![0u8; 64 * 1024];
    loop {
        let n = std::io::Read::read(&mut eingabe, &mut puffer)
            .map_err(|e| AppError::Validation(format!("Archivblock nicht lesbar: {e}")))?;
        if n == 0 {
            break;
        }
        hash.update(&puffer[..n]);
    }
    Ok(hex(&hash.finalize()))
}

/// Spielt den Block `datei` mit `schluessel` ein, in die Org `org` (ohne Angabe: die Org des
/// Einsatzes, wenn es sie hier gibt).
pub async fn einspielen(
    pool: &SqlitePool,
    datei: &Path,
    schluessel: &Schluessel,
    org: Option<i64>,
    jetzt: DateTime<Utc>,
) -> Result<Eingespielt, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let sha256 = datei_sha256(datei)?;
    let (zwischen, handle) =
        bauen::zwischendatei(&bauen::verzeichnis(pool).await?, 0, "einspielen")?;
    schluessel
        .entschluessele_datei(datei, std::io::BufWriter::new(handle))
        .and_then(|mut w| {
            std::io::Write::flush(&mut w)
                .map_err(|e| AppError::Internal(format!("Archivblock schreiben: {e}")))
        })
        .map_err(|e| match e {
            AppError::Validation(m) => AppError::Validation(format!("Archivblock: {m}")),
            andere => andere,
        })?;
    let archiv = bauen::oeffnen(zwischen.pfad(), false).await?;
    let ergebnis = einspielen_aus(pool, &archiv, &sha256, org, jetzt, &jetzt_s).await;
    archiv.close().await;
    drop(zwischen);
    ergebnis
}

async fn einspielen_aus(
    pool: &SqlitePool,
    archiv: &SqlitePool,
    sha256: &str,
    org: Option<i64>,
    jetzt: DateTime<Utc>,
    jetzt_s: &str,
) -> Result<Eingespielt, AppError> {
    let kein_block =
        || AppError::Validation("Die Datei ist kein Archivblock eines Einsatzes.".into());
    // Eine Datei, die keine SQLite-Datenbank ist, scheitert schon hier.
    let tabellen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(archiv)
    .await
    .map_err(|_| kein_block())?;
    if tabellen == 0 {
        return Err(kein_block());
    }
    crate::db::migrate(archiv).await.map_err(|e| {
        AppError::Validation(format!(
            "Archivblock: Migration auf diese Version gescheitert ({e}). Stammt er von einer \
             neueren Version, mit dieser einspielen."
        ))
    })?;
    // Migrationen, die Tabellen neu bauen, schalten Fremdschlüssel am Ende wieder ein.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(archiv)
        .await?;
    let koepfe: Vec<Kopf> = sqlx::query_as(
        "SELECT id, org_id, status, retention_bis, freigabestufe, bezeichnung, \
         einsatznummer_intern FROM einsatz",
    )
    .fetch_all(archiv)
    .await?;
    let [kopf] = <[Kopf; 1]>::try_from(koepfe).map_err(|_| kein_block())?;
    if kopf.status != STATUS_ABGESCHLOSSEN {
        return Err(kein_block());
    }
    if let Some(bis) = kopf.retention_bis.as_deref().filter(|b| *b <= jetzt_s) {
        return Err(AppError::Validation(format!(
            "Die Aufbewahrung dieses Einsatzes endete am {bis} (UTC); er wird nicht mehr \
             eingespielt."
        )));
    }

    let ziel_org = org.unwrap_or(kopf.org_id);
    let org_name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = ?")
        .bind(ziel_org)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Organisation {ziel_org} gibt es hier nicht; mit --org die Ziel-Organisation \
                 angeben."
            ))
        })?;

    let mut hinweise = Vec::new();
    // Ein veralteter Block: was inzwischen abgelaufen ist, wird vor dem Einspielen geschwärzt.
    let veraltet: Vec<_> = kategorie::laden(archiv, kopf.id)
        .await?
        .into_iter()
        .filter(|k| k.geschwaerzt_at.is_none())
        .filter(|k| k.frist_bis.as_deref().is_some_and(|f| f <= jetzt_s))
        .map(|k| k.kategorie)
        .collect();
    if !veraltet.is_empty() {
        bauen::schwaerze_ohne_karenz(archiv, kopf.id, &veraltet, jetzt, "der eingespielten Datei")
            .await?;
        hinweise.push(format!(
            "Vor dem Einspielen geschwärzt (Frist abgelaufen): {}",
            veraltet
                .iter()
                .map(|k| k.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let zufall = uuid::Uuid::new_v4().simple().to_string();
    let kennung = format!("archiv/{}", &zufall[..16]);
    vorbereiten(pool, archiv, &kopf, ziel_org, &kennung).await?;

    let loeschen_at = crate::zeit::formatiere_utc(jetzt + TimeDelta::days(AUFBEWAHRUNG_TAGE));
    let gefuehrt = Gefuehrt {
        id: kopf.id,
        kennung: Some(kennung.clone()),
        freigabestufe: kopf.freigabestufe.clone(),
        status: kopf.status.clone(),
        org_id: kopf.org_id,
    };
    let (einsatz_id, uebernahme_hinweise) = crate::write_retry!(pool, |conn| {
        uebernehmen_tx(
            conn,
            archiv,
            &gefuehrt,
            &kennung,
            ziel_org,
            &org_name,
            sha256,
            jetzt_s,
            &loeschen_at,
        )
        .await
    })?;
    hinweise.extend(uebernahme_hinweise);

    let inhalte = match inhalte_schreiben(pool, archiv, einsatz_id).await {
        Ok(n) => n,
        Err(f) => {
            // Ohne seine Inhalte bleibt kein halber Einsatz stehen.
            if let Err(e) = sofort_abraeumen(pool, einsatz_id).await {
                tracing::error!(
                    einsatz_id,
                    "Archiv: unvollständiges Einspielen nicht abgeräumt: {e}"
                );
            }
            return Err(f);
        }
    };

    let ziel = crate::aufbewahrung::antrag::einsatz_kennung(
        kopf.einsatznummer_intern.as_deref(),
        einsatz_id,
    );
    crate::auth::admin_audit::schreibe_ohne_akteur(
        pool,
        crate::auth::admin_audit::AdminAktion::ArchivEingespielt,
        ziel_org,
        BEFEHL,
        crate::auth::admin_audit::Ziel::Archiv(&ziel),
        None,
        None,
    )
    .await;
    tracing::warn!(
        einsatz_id,
        %loeschen_at,
        "Archiv: Block eingespielt, schreibgeschützt bis zum Abräumen"
    );
    Ok(Eingespielt {
        einsatz_id,
        bezeichnung: kopf.bezeichnung,
        einsatznummer: kopf.einsatznummer_intern,
        org_name,
        loeschen_at,
        inhalte,
        hinweise,
    })
}

/// Bereitet die Zwischendatei als liefernde Seite vor: neue Kennung, Herkunft der Stammdaten, die
/// es hier gibt, und das Log aus dem Grundstock.
async fn vorbereiten(
    pool: &SqlitePool,
    archiv: &SqlitePool,
    kopf: &Kopf,
    ziel_org: i64,
    kennung: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE einsatz SET kennung = ? WHERE id = ?")
        .bind(kennung)
        .bind(kopf.id)
        .execute(archiv)
        .await?;
    sqlx::query("DELETE FROM stammdaten_herkunft")
        .execute(archiv)
        .await?;
    for (tabelle, name) in STAMM_NAME {
        let art = stammdaten_art::BESCHREIBUNGEN
            .iter()
            .find(|b| b.tabelle == *tabelle)
            .map(|b| b.art)
            .ok_or_else(|| AppError::Internal(format!("Archiv: Stammdatenart zu {tabelle}")))?;
        let zeilen: Vec<(i64, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT id, \"{name}\" FROM {tabelle}"
        )))
        .fetch_all(archiv)
        .await?;
        for (id, wert) in zeilen {
            let gleich: bool = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT EXISTS (SELECT 1 FROM {tabelle} WHERE id = ? AND org_id = ? \
                 AND \"{name}\" = ?)"
            )))
            .bind(id)
            .bind(ziel_org)
            .bind(&wert)
            .fetch_one(pool)
            .await?;
            if gleich {
                sqlx::query(
                    "INSERT INTO stammdaten_herkunft (kopplung_org_id, org_id, art, \
                     fremder_schluessel, lokaler_schluessel) VALUES (?, ?, ?, ?, ?)",
                )
                .bind(ZUORDNUNG_DATEI)
                .bind(kopf.org_id)
                .bind(art.as_str())
                .bind(id.to_string())
                .bind(id.to_string())
                .execute(archiv)
                .await?;
            }
        }
    }
    // Das Log zuletzt: was die Vorbereitung schrieb, zählt nicht; der Kopf bekommt Stand 1.
    let mut conn = archiv.acquire().await?;
    sqlx::query("DELETE FROM einsatz_aenderung")
        .execute(&mut *conn)
        .await?;
    for g in art::GESPIEGELT {
        let k = art::schluessel(&mut conn, g.tabelle).await?;
        sqlx::query(sqlx::AssertSqlSafe(art::grundstock_sql(
            g.tabelle,
            art::scoping(g.tabelle),
            &k,
        )))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Übernimmt den Einsatz aus der Datei in der Transaktion `conn`. Liefert die lokale ID und die
/// Hinweise der Übernahme. Ohne Seiteneffekte außerhalb der Transaktion (`write_retry!`).
#[allow(clippy::too_many_arguments)]
async fn uebernehmen_tx(
    conn: &mut SqliteConnection,
    archiv: &SqlitePool,
    gefuehrt: &Gefuehrt,
    kennung: &str,
    ziel_org: i64,
    org_name: &str,
    sha256: &str,
    jetzt_s: &str,
    loeschen_at: &str,
) -> Result<(i64, Vec<String>), AppError> {
    // Die Org-Zuordnung, die `uebernehmen` für `einsatz_spiegel` braucht; sie geht unten wieder.
    let kopplung_id: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
         gegenueber_name, richtung, zustand) VALUES (?, '', ?, 'wird_gemeldet', 'widerrufen') \
         RETURNING id",
    )
    .bind(kennung)
    .bind(GEGENSTELLE)
    .fetch_one(&mut *conn)
    .await?;
    let kopplung_org_id: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
         fremde_org_name, widerrufen_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(kopplung_id)
    .bind(ziel_org)
    .bind(kennung)
    .bind(org_name)
    .bind(jetzt_s)
    .fetch_one(&mut *conn)
    .await?;
    let absender = Absender {
        kennung: GEGENSTELLE,
        kopplung_id: ZUORDNUNG_DATEI,
        kopplung_org_id: ZUORDNUNG_DATEI,
        meldend: true,
    };
    let empfaenger = Empfaenger {
        kopplung_id,
        kopplung_org_id,
        org_id: ziel_org,
        meldend: false,
    };
    let kurz = kennung.trim_start_matches("archiv/");
    let mut konten: HashMap<i64, i64> = HashMap::new();
    let mut hinweise = Vec::new();
    let mut seit = 0;
    let mut quelle = archiv.acquire().await?;
    loop {
        let mut budget = Budget::neu(SPIEGEL_MAX);
        let Some(mut l) = liefern::liefere_einsatz(
            &mut quelle,
            &absender,
            gefuehrt,
            kennung,
            GEGENSTELLE,
            seit,
            &mut budget,
        )
        .await?
        else {
            break;
        };
        for k in &mut l.konten {
            k.gegen_id = Some(match konten.get(&k.id) {
                Some(id) => *id,
                None => {
                    let id = platzhalter(conn, ziel_org, kurz, k).await?;
                    konten.insert(k.id, id);
                    id
                }
            });
        }
        let erg = uebernehmen::uebernehmen(conn, &empfaenger, &l).await?;
        hinweise.extend(erg.hinweise);
        if erg.stand <= seit {
            return Err(AppError::Internal(format!(
                "Archiv: Übernahme kommt nicht voran (Stand {seit}); {}",
                hinweise.join("; ")
            )));
        }
        seit = erg.stand;
    }
    drop(quelle);
    let einsatz_id: i64 =
        sqlx::query_scalar("SELECT einsatz_id FROM einsatz_spiegel WHERE fremde_kennung = ?")
            .bind(kennung)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| {
                AppError::Internal(format!(
                    "Archiv: Einsatz nicht übernommen; {}",
                    hinweise.join("; ")
                ))
            })?;
    sqlx::query(
        "UPDATE einsatz_spiegel SET kopplung_org_id = NULL, beendet_at = ?, \
         letzter_abgleich_at = ? WHERE einsatz_id = ?",
    )
    .bind(jetzt_s)
    .bind(jetzt_s)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM instanz_kopplung WHERE id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO einsatz_archiv_eingespielt (einsatz_id, sha256, eingespielt_at, loeschen_at) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(sha256)
    .bind(jetzt_s)
    .bind(loeschen_at)
    .execute(&mut *conn)
    .await?;
    for benutzer_id in konten.values() {
        sqlx::query("INSERT INTO archiv_konto (benutzer_id, einsatz_id) VALUES (?, ?)")
            .bind(benutzer_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok((einsatz_id, hinweise))
}

/// Ein gesperrtes Platzhalter-Konto mit dem Namen aus dem Archiv. Es kann sich nie anmelden.
async fn platzhalter(
    conn: &mut SqliteConnection,
    org_id: i64,
    kurz: &str,
    angabe: &KontoAngabe,
) -> Result<i64, AppError> {
    let name = angabe.anzeigename.chars().take(200).collect::<String>();
    Ok(sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
         aktiv, erstellt_at, org_rolle) VALUES (?, ?, ?, ?, 'keiner', 0, ?, 'keine') RETURNING id",
    )
    .bind(org_id)
    .bind(&name)
    .bind(format!("archiv:{kurz}:{}", angabe.id))
    .bind(crate::auth::PASSWORT_HASH_KEIN_LOKALES)
    .bind(crate::zeit::jetzt())
    .fetch_one(&mut *conn)
    .await?)
}

/// Schreibt die Inhalte (Anhänge, Pläne), die die Übernahme als offen gemerkt hat, aus der Datei
/// in ihre Zeilen, je eine Transaktion. Liefert die Zahl.
async fn inhalte_schreiben(
    pool: &SqlitePool,
    archiv: &SqlitePool,
    einsatz_id: i64,
) -> Result<usize, AppError> {
    let offen: Vec<(String, String, String, String, i64)> = sqlx::query_as(
        "SELECT art, lokaler_schluessel, fremder_schluessel, sha256, groesse FROM spiegel_anhang \
         WHERE einsatz_id = ? AND fertig_at IS NULL ORDER BY art, lokaler_schluessel",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut anzahl = 0;
    for (art, lokal, fremd, sha256, groesse) in offen {
        let t = {
            let mut c = pool.acquire().await?;
            schema::schema(&mut c).await?
        }
        .tabelle(&art)
        .ok_or_else(|| AppError::Internal(format!("Archiv: Inhalt einer unbekannten Art {art}")))?;
        let spalte = t
            .blob
            .as_deref()
            .ok_or_else(|| AppError::Internal(format!("Archiv: {art} hat keinen Inhalt")))?;
        let inhalt: Option<Vec<u8>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT \"{spalte}\" FROM {} WHERE {}",
            t.name,
            t.schluessel.gleich(t.name)
        )))
        .bind(&fremd)
        .fetch_optional(archiv)
        .await?
        .flatten();
        let inhalt = inhalt.unwrap_or_default();
        if inhalt.len() as i64 != groesse || hex(&Sha256::digest(&inhalt)) != sha256 {
            return Err(AppError::Validation(format!(
                "Archivblock: Inhalt {art} {fremd} passt nicht zu seiner Prüfsumme."
            )));
        }
        crate::write_retry!(pool, |conn| {
            sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
                .execute(&mut *conn)
                .await?;
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE {} SET \"{spalte}\" = ? WHERE {}",
                t.name,
                t.schluessel.gleich(t.name)
            )))
            .bind(&inhalt)
            .bind(&lokal)
            .execute(&mut *conn)
            .await?;
            sqlx::query("DELETE FROM spiegel_uebernahme")
                .execute(&mut *conn)
                .await?;
            sqlx::query(
                "UPDATE spiegel_anhang SET fertig_at = ? WHERE art = ? AND lokaler_schluessel = ?",
            )
            .bind(crate::zeit::jetzt())
            .bind(&art)
            .bind(&lokal)
            .execute(&mut *conn)
            .await?;
            Ok(())
        })?;
        anzahl += 1;
    }
    Ok(anzahl)
}

/// Räumt einen eingespielten Einsatz gleich ab (UNUMKEHRBAR) samt seinen Platzhalter-Konten.
async fn sofort_abraeumen(pool: &SqlitePool, einsatz_id: i64) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        abraeumen::vormerken(conn, einsatz_id, AbraeumArt::Spiegel, Some(GEGENSTELLE)).await
    })?;
    abraeumen::ausfuehren(pool, einsatz_id).await?;
    konten_aufraeumen(pool).await;
    Ok(())
}

/// Phase R des Purge-Laufs: merkt eingespielte Einsätze, deren Zeit zu `jetzt` um ist, zum
/// Abräumen vor (Art `spiegel`, Gegenstelle [`GEGENSTELLE`]). Das Abräumen selbst übernimmt
/// `abraeumen::alle_vorgemerkten`. Liefert die Zahl vorgemerkter Einsätze.
pub async fn faellige_vormerken(pool: &SqlitePool, jetzt: &str) -> usize {
    let faellig: Vec<i64> = match sqlx::query_scalar(
        "SELECT einsatz_id FROM einsatz_archiv_eingespielt WHERE loeschen_at <= ? \
         ORDER BY einsatz_id",
    )
    .bind(jetzt)
    .fetch_all(pool)
    .await
    {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("Archiv: eingespielte Einsätze nicht lesbar: {e}");
            return 0;
        }
    };
    let mut n = 0;
    for id in faellig {
        match crate::write_retry!(pool, |conn| {
            abraeumen::vormerken(conn, id, AbraeumArt::Spiegel, Some(GEGENSTELLE)).await
        }) {
            Ok(()) => {
                tracing::warn!(
                    einsatz_id = id,
                    "Purge Phase R: eingespielter Einsatz nach {AUFBEWAHRUNG_TAGE} Tagen zum \
                     Abräumen vorgemerkt"
                );
                n += 1;
            }
            Err(e) => tracing::error!(einsatz_id = id, "Archiv: Vormerken gescheitert: {e}"),
        }
    }
    n
}

/// Löscht die Platzhalter-Konten abgeräumter eingespielter Einsätze. Liefert die Zahl.
pub async fn konten_aufraeumen(pool: &SqlitePool) -> usize {
    let verwaist: Vec<i64> = match sqlx::query_scalar(
        "SELECT benutzer_id FROM archiv_konto ak \
         WHERE NOT EXISTS (SELECT 1 FROM einsatz e WHERE e.id = ak.einsatz_id) \
         ORDER BY benutzer_id",
    )
    .fetch_all(pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Archiv: Platzhalter-Konten nicht lesbar: {e}");
            return 0;
        }
    };
    let mut n = 0;
    for id in verwaist {
        // `archiv_konto` geht per Kaskade mit. Hängt am Konto noch etwas, bleibt es verborgen
        // stehen, und der nächste Lauf versucht es erneut.
        match crate::write_retry!(pool, |conn| {
            Ok(sqlx::query("DELETE FROM benutzer WHERE id = ?")
                .bind(id)
                .execute(&mut *conn)
                .await?
                .rows_affected())
        }) {
            Ok(_) => n += 1,
            Err(e) => tracing::error!(
                benutzer_id = id,
                "Archiv: Platzhalter-Konto nicht löschbar: {e}"
            ),
        }
    }
    n
}

#[cfg(test)]
mod tests;
