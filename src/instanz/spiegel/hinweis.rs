//! Hinweise über den Hub (LLH-1495, Change `lc02103g-bruecke-web-push`, design.md D2–D5, Specs
//! `benachrichtigungen` und `web-push`).
//!
//! - **Meldende Seite (ELW):** [`vormerken`] und [`vormerken_erledigt`] schreiben nach dem Commit
//!   eines Hinweises eine Zeile in `hinweis_ausgang`, wenn die erreichte Seite Hinweise annimmt
//!   ([`ziele`]). Der Abgleich sendet sie ([`offene`]) und löscht quittierte ([`quittiert`]).
//! - **Erreichte Seite (Hub):** [`annehmen`] bildet jeden Anlass in der Transaktion des Abgleichs
//!   auf den Spiegel ab; [`ausfuehren`] meldet nach dem Commit wie für einen eigenen Einsatz.
//!
//! Der Anlass reist, nicht das Ergebnis (D1): die Empfänger bestimmt die erreichte Seite selbst.

use super::paket::KontoAngabe;
use crate::benachrichtigung::{
    Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::instanz::repo::KopplungZeile;
use crate::instanz::stammdaten::StammdatenArt;
use crate::live::LiveHub;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};

/// Höchstzahl Hinweise je Paket.
pub const HINWEISE_MAX: usize = 100;
/// Höchstens so viele Bytes Hinweise je Paket; sie kommen aus der Reserve des Pakets
/// ([`super::paket::RESERVE`]), denn sie werden nach den Lieferungen gelesen: erst das Liefern
/// gibt einem neuen Einsatz seine Kennung.
pub const HINWEISE_BYTES_MAX: usize = 64 * 1024;
/// Höchstzahl Adressaten je Hinweis (heute höchstens drei je Schreibweg).
pub const ADRESSATEN_MAX: usize = 32;
/// Höchstzahl Bezüge eines erledigten Hinweises; größere Mengen teilt [`vormerken_erledigt`].
pub const BEZUEGE_MAX: usize = 200;
/// Ein Anlass, der älter ist, wird nicht mehr angenommen (Spec „Ein Hinweis kommt am Hub einmal
/// und höchstens 12 Stunden spät an“; dieselbe Grenze wie das Nachreichen im Client).
pub const NACHREICHEN_STUNDEN: i64 = 12;
/// So lange hält die erreichte Seite fest, welche Anlässe sie angenommen hat.
pub const EINGANG_STUNDEN: i64 = 48;
/// Längster Anzeigename im Paket.
const NAME_MAX: usize = 200;

// ── Wire ────────────────────────────────────────────────────────────────────────────────────

/// Ein Anlass im Paket, mit den Kennungen der meldenden Seite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HinweisAnlass {
    /// Kennung der Ausgangszeile; die erreichte Seite quittiert sie.
    pub id: i64,
    /// Einsatz beim Führer (`einsatz.kennung`).
    pub kennung: String,
    /// Wire-Wert von [`BenachrichtigungArt`]; Text, damit eine ältere Seite eine neue Art
    /// verwirft statt am Lesen zu scheitern.
    pub art: String,
    /// Wire-Wert von [`BenachrichtigungBezugTyp`].
    pub bezug_typ: String,
    /// Bezüge; beim Melden genau einer.
    pub bezug_ids: Vec<i64>,
    /// `true`: für alle erledigt (D5), sonst melden.
    #[serde(default)]
    pub erledigen: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ausloeser: Option<KontoAngabe>,
    #[serde(default)]
    pub adressaten: Vec<AdressatAngabe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub durch_einheit_id: Option<i64>,
    pub erstellt_at: String,
}

/// Ein Adressat im Paket. `art`: `funktion`, `person`, `nutzer`, `modul_leser`,
/// `modul_schreiber`, `fuehrungskraefte`, `einsatzleitung`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdressatAngabe {
    pub art: String,
    /// Funktion (Wire-Wert), Modulschlüssel oder Kennung des Einsatzpersonals.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wert: Option<String>,
    /// Nur `nutzer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub konto: Option<KontoAngabe>,
}

// ── Gespeicherte Form am ELW ────────────────────────────────────────────────────────────────

/// Ein Adressat mit lokalen Kennungen, wie er in `hinweis_ausgang.daten` steht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AdressatLokal {
    art: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wert: Option<String>,
}

/// Inhalt von `hinweis_ausgang.daten`: der Anlass mit den Kennungen dieser Instanz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Gespeichert {
    art: String,
    bezug_typ: String,
    bezug_ids: Vec<i64>,
    #[serde(default)]
    erledigen: bool,
    #[serde(default)]
    ausloeser: Option<i64>,
    #[serde(default)]
    adressaten: Vec<AdressatLokal>,
    #[serde(default)]
    einheit_id: Option<i64>,
    #[serde(default)]
    durch_einheit_id: Option<i64>,
}

fn adressat_lokal(a: &Adressat) -> AdressatLokal {
    let (art, wert) = match a {
        Adressat::Funktion(f) => ("funktion", Some(f.as_str().to_string())),
        Adressat::Person(id) => ("person", Some(id.to_string())),
        Adressat::Nutzer(id) => ("nutzer", Some(id.to_string())),
        Adressat::ModulLeser(m) => ("modul_leser", Some((*m).to_string())),
        Adressat::ModulSchreiber(m) => ("modul_schreiber", Some((*m).to_string())),
        Adressat::Fuehrungskraefte => ("fuehrungskraefte", None),
        Adressat::Einsatzleitung => ("einsatzleitung", None),
    };
    AdressatLokal {
        art: art.into(),
        wert,
    }
}

// ── Meldende Seite ──────────────────────────────────────────────────────────────────────────

/// Eine Kopplung einer Org, über die Hinweise eines Einsatzes reisen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::FromRow)]
pub struct Ziel {
    pub kopplung_org_id: i64,
    /// Die erreichte Seite bietet Web Push an: dann pusht diese Instanz nicht selbst (D4).
    pub web_push: bool,
}

/// Wohin die Hinweise dieses Einsatzes reisen (D4): nur ein Einsatz, den diese Instanz führt und
/// liefert (ohne Demo-Einsatz und ohne einen zum Abräumen vorgemerkten, wie
/// [`super::liefern`]), und nur zu einer aktiven Kopplung, die sich meldet und Hinweise annimmt,
/// mit nicht widerrufener Zuordnung seiner Org. Was nicht geliefert wird, käme am Hub nie an.
pub async fn ziele(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Vec<Ziel>, sqlx::Error> {
    sqlx::query_as(
        "SELECT o.id AS kopplung_org_id, k.gegenueber_web_push AS web_push \
         FROM einsatz e \
         JOIN instanz_kopplung_org o ON o.org_id = e.org_id AND o.widerrufen_at IS NULL \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE e.id = ? AND e.spiegel = 0 AND k.richtung = 'meldet_sich' \
           AND k.zustand = 'aktiv' AND k.gegenueber_hinweise = 1 \
           AND NOT EXISTS (SELECT 1 FROM demo_import d WHERE d.einsatz_id = e.id) \
           AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = e.id) \
         ORDER BY o.id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await
}

/// Pusht die erreichte Seite für diesen Einsatz (D4)? Dann lässt [`crate::benachrichtigung`] den
/// eigenen Push aus.
pub fn pusht_ueber_hub(ziele: &[Ziel]) -> bool {
    ziele.iter().any(|z| z.web_push)
}

/// Welche dieser Konten der Hub kennt, der für diese Ziele pusht: ihr Konto kam aus einer
/// solchen Kopplung (Herkunft der Stammdaten). Nur ihnen pusht der Hub; den übrigen pusht diese
/// Instanz selbst (Entscheidung 12.11.2026, design.md D4).
pub async fn konten_am_hub(
    conn: &mut SqliteConnection,
    ziele: &[Ziel],
    benutzer_ids: &[i64],
) -> Result<std::collections::HashSet<i64>, sqlx::Error> {
    let kopplungen: Vec<i64> = ziele
        .iter()
        .filter(|z| z.web_push)
        .map(|z| z.kopplung_org_id)
        .collect();
    if kopplungen.is_empty() || benutzer_ids.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    let konten: Vec<String> = benutzer_ids.iter().map(i64::to_string).collect();
    let gefunden: Vec<String> = sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM stammdaten_herkunft WHERE art = 'konto' \
           AND kopplung_org_id IN (SELECT value FROM json_each(?)) \
           AND lokaler_schluessel IN (SELECT value FROM json_each(?))",
    )
    .bind(serde_json::to_string(&kopplungen).expect("IDs serialisierbar"))
    .bind(serde_json::to_string(&konten).expect("IDs serialisierbar"))
    .fetch_all(&mut *conn)
    .await?;
    Ok(gefunden.iter().filter_map(|k| k.parse().ok()).collect())
}

/// Der Hub, über den dieser Nutzer Push bekommt (design.md D7): sein Konto kam aus einer aktiven
/// meldenden Kopplung seiner Org, die Hinweise annimmt und Push anbietet. Name und Adresse für
/// die Seite „Benachrichtigungen“; `None` für Konten, die der Hub nicht kennt.
pub async fn push_hub_fuer(
    conn: &mut SqliteConnection,
    benutzer_id: i64,
) -> Result<Option<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT k.gegenueber_name, COALESCE(k.gegenueber_adresse, '') \
         FROM stammdaten_herkunft h \
         JOIN instanz_kopplung_org o ON o.id = h.kopplung_org_id AND o.widerrufen_at IS NULL \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         JOIN benutzer b ON b.org_id = o.org_id \
         WHERE h.art = 'konto' AND h.lokaler_schluessel = ? AND b.id = ? \
           AND k.richtung = 'meldet_sich' AND k.zustand = 'aktiv' \
           AND k.gegenueber_hinweise = 1 AND k.gegenueber_web_push = 1 \
         ORDER BY k.id LIMIT 1",
    )
    .bind(benutzer_id.to_string())
    .bind(benutzer_id)
    .fetch_optional(&mut *conn)
    .await
}

async fn schreiben(
    conn: &mut SqliteConnection,
    ziele: &[Ziel],
    einsatz_id: i64,
    daten: &Gespeichert,
) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(daten).expect("Hinweis serialisierbar");
    let jetzt = crate::zeit::jetzt();
    for z in ziele {
        sqlx::query(
            "INSERT INTO hinweis_ausgang (kopplung_org_id, einsatz_id, daten, erstellt_at) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(z.kopplung_org_id)
        .bind(einsatz_id)
        .bind(&json)
        .bind(&jetzt)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Merkt einen gemeldeten Anlass für die erreichte Seite vor (D2). In einer Transaktion des
/// Aufrufers, damit er alle Ziele trifft oder keines; danach [`super::takt::wecken`].
pub async fn vormerken(
    conn: &mut SqliteConnection,
    ziele: &[Ziel],
    anlass: &Anlass,
) -> Result<(), sqlx::Error> {
    if ziele.is_empty() {
        return Ok(());
    }
    let daten = Gespeichert {
        art: anlass.art.as_str().into(),
        bezug_typ: anlass.bezug.typ.as_str().into(),
        bezug_ids: vec![anlass.bezug.id],
        erledigen: false,
        ausloeser: anlass.ausloeser,
        adressaten: anlass
            .adressaten
            .iter()
            .take(ADRESSATEN_MAX)
            .map(adressat_lokal)
            .collect(),
        einheit_id: anlass.einheit_id,
        durch_einheit_id: anlass.durch_einheit_id,
    };
    schreiben(conn, ziele, anlass.einsatz_id, &daten).await
}

/// Merkt „für alle erledigt“ für die erreichte Seite vor (D5); Transaktion und Wecken wie bei
/// [`vormerken`].
pub async fn vormerken_erledigt(
    conn: &mut SqliteConnection,
    ziele: &[Ziel],
    einsatz_id: i64,
    art: BenachrichtigungArt,
    typ: BenachrichtigungBezugTyp,
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    if ziele.is_empty() || ids.is_empty() {
        return Ok(());
    }
    for teil in ids.chunks(BEZUEGE_MAX) {
        let daten = Gespeichert {
            art: art.as_str().into(),
            bezug_typ: typ.as_str().into(),
            bezug_ids: teil.to_vec(),
            erledigen: true,
            ausloeser: None,
            adressaten: Vec::new(),
            einheit_id: None,
            durch_einheit_id: None,
        };
        schreiben(conn, ziele, einsatz_id, &daten).await?;
    }
    Ok(())
}

/// Das Konto, wie es ins Paket geht: Anzeigename und, wenn bekannt, die Kennung beim Gegenüber.
async fn konto_angabe(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    benutzer_id: i64,
) -> Result<KontoAngabe, sqlx::Error> {
    let name: Option<String> = sqlx::query_scalar("SELECT anzeigename FROM benutzer WHERE id = ?")
        .bind(benutzer_id)
        .fetch_optional(&mut *conn)
        .await?;
    let gegen_id = super::abbildung::stammdaten_fremd(
        conn,
        kopplung_org_id,
        StammdatenArt::Konto,
        benutzer_id,
    )
    .await?;
    Ok(KontoAngabe {
        id: benutzer_id,
        anzeigename: name.unwrap_or_default().chars().take(NAME_MAX).collect(),
        gegen_id,
    })
}

/// Die offenen Hinweise dieser Kopplung, älteste zuerst, höchstens [`HINWEISE_MAX`] und
/// [`HINWEISE_BYTES_MAX`] (der erste immer), dazu ob weitere warten. Was älter als
/// [`NACHREICHEN_STUNDEN`] ist, geht nicht mehr hinaus. Nach den Lieferungen lesen (Kennung).
pub async fn offene(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<(Vec<HinweisAnlass>, bool), sqlx::Error> {
    let grenze = crate::zeit::formatiere_utc(jetzt - Duration::hours(NACHREICHEN_STUNDEN));
    let zeilen: Vec<(i64, i64, String, String, String)> = sqlx::query_as(
        "SELECT a.id, a.kopplung_org_id, e.kennung, a.daten, a.erstellt_at \
         FROM hinweis_ausgang a \
         JOIN instanz_kopplung_org o ON o.id = a.kopplung_org_id \
         JOIN einsatz e ON e.id = a.einsatz_id \
         WHERE o.kopplung_id = ? AND o.widerrufen_at IS NULL AND e.kennung IS NOT NULL \
           AND a.erstellt_at >= ? \
         ORDER BY a.id LIMIT ?",
    )
    .bind(kopplung_id)
    .bind(grenze)
    .bind(HINWEISE_MAX as i64 + 1)
    .fetch_all(&mut *conn)
    .await?;
    let mut mehr = zeilen.len() > HINWEISE_MAX;
    let mut bytes = 0;
    let mut hinweise = Vec::with_capacity(zeilen.len());
    for (id, kopplung_org_id, kennung, daten, erstellt_at) in zeilen.into_iter().take(HINWEISE_MAX)
    {
        let Ok(g) = serde_json::from_str::<Gespeichert>(&daten) else {
            tracing::warn!(hinweis = id, "Hinweis im Ausgang nicht lesbar, verworfen");
            sqlx::query("DELETE FROM hinweis_ausgang WHERE id = ?")
                .bind(id)
                .execute(&mut *conn)
                .await?;
            continue;
        };
        let ausloeser = match g.ausloeser {
            Some(b) => Some(konto_angabe(conn, kopplung_org_id, b).await?),
            None => None,
        };
        let mut adressaten = Vec::with_capacity(g.adressaten.len());
        for a in g.adressaten {
            let konto = match (a.art.as_str(), a.wert.as_deref().map(str::parse::<i64>)) {
                ("nutzer", Some(Ok(b))) => Some(konto_angabe(conn, kopplung_org_id, b).await?),
                _ => None,
            };
            adressaten.push(AdressatAngabe {
                wert: if konto.is_some() { None } else { a.wert },
                art: a.art,
                konto,
            });
        }
        let h = HinweisAnlass {
            id,
            kennung,
            art: g.art,
            bezug_typ: g.bezug_typ,
            bezug_ids: g.bezug_ids,
            erledigen: g.erledigen,
            ausloeser,
            adressaten,
            einheit_id: g.einheit_id,
            durch_einheit_id: g.durch_einheit_id,
            erstellt_at,
        };
        let groesse = serde_json::to_vec(&h).map(|v| v.len()).unwrap_or(0);
        if !hinweise.is_empty() && bytes + groesse > HINWEISE_BYTES_MAX {
            mehr = true;
            break;
        }
        bytes += groesse;
        hinweise.push(h);
    }
    Ok((hinweise, mehr))
}

/// Löscht die Hinweise, die die erreichte Seite quittiert hat (nur eigene dieser Kopplung).
pub async fn quittiert(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "DELETE FROM hinweis_ausgang WHERE id IN (SELECT value FROM json_each(?)) \
         AND kopplung_org_id IN (SELECT id FROM instanz_kopplung_org WHERE kopplung_id = ?)",
    )
    .bind(serde_json::to_string(ids).expect("ID-Liste serialisierbar"))
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Räumt Ausgang (älter als [`NACHREICHEN_STUNDEN`]) und Eingang (älter als
/// [`EINGANG_STUNDEN`]) ab (Erinnerungs-Scheduler). Liefert die Zahl der gelöschten Zeilen.
pub async fn aufraeumen(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<u64, sqlx::Error> {
    let ausgang = crate::zeit::formatiere_utc(jetzt - Duration::hours(NACHREICHEN_STUNDEN));
    let eingang = crate::zeit::formatiere_utc(jetzt - Duration::hours(EINGANG_STUNDEN));
    let a = sqlx::query("DELETE FROM hinweis_ausgang WHERE erstellt_at < ?")
        .bind(ausgang)
        .execute(pool)
        .await?
        .rows_affected();
    let e = sqlx::query("DELETE FROM hinweis_eingang WHERE angenommen_at < ?")
        .bind(eingang)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(a + e)
}

// ── Erreichte Seite ─────────────────────────────────────────────────────────────────────────

/// Was nach dem Commit des Abgleichs geschieht (D2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Folge {
    Melden(Anlass),
    Erledigen {
        einsatz_id: i64,
        art: BenachrichtigungArt,
        typ: BenachrichtigungBezugTyp,
        ids: Vec<i64>,
    },
}

/// Ausgang einer Abbildung.
enum Abgebildet<T> {
    Ja(T),
    /// Etwas fehlt am Spiegel noch: zurückstellen.
    Fehlt,
    /// Unbrauchbar (unbekannter Wert eines neueren Gegenübers): verwerfen.
    Unbrauchbar,
}

/// Die gespiegelte Tabelle eines Bezugs (D3). `None`: der Bezug ist keine Zeile (Einsatz,
/// Lagebesprechung tragen die Einsatzkennung, der Schichtplan-Wechsel einen Zeitpunkt).
pub const fn bezug_tabelle(typ: BenachrichtigungBezugTyp) -> Option<&'static str> {
    use BenachrichtigungBezugTyp as T;
    match typ {
        T::Einsatz | T::Lagebesprechung | T::SchichtplanWechsel => None,
        T::Meldung | T::LageUebernahme => Some("meldung"),
        T::Auftrag => Some("auftrag"),
        T::AuftragEmpfaenger => Some("auftrag_empfaenger"),
        T::Befehl => Some("befehl"),
        T::Lagebericht => Some("lagebericht"),
        T::Erinnerung => Some("erinnerung"),
        T::Abloesung
        | T::AbloeserAlarmiert
        | T::AbloeserEingetroffen
        | T::AbloeserBrEingetroffen
        | T::AbloeserAbgerufen
        | T::AbloeserEntfallen
        | T::AbloeserAlarmierungGestrichen
        | T::AbloeserEintreffenGestrichen
        | T::AbloeserWiederhergestellt => Some("einsatz_abloesung"),
        T::Nachforderung
        | T::NachforderungZugesagt
        | T::NachforderungUnterwegs
        | T::NachforderungEingetroffen
        | T::NachforderungAbgelehnt => Some("nachforderung"),
        T::Gefahrengebiet => Some("gefahrengebiet"),
        T::Person => Some("einsatz_person"),
        T::Einheit => Some("einsatz_einheit"),
        T::Fahrzeug => Some("einsatz_fahrzeug"),
        T::ChatNachricht => Some("chat_nachricht"),
    }
}

/// Lokale Kennungen gespiegelter Zeilen, fremd → lokal, in einer Abfrage (`src/AGENTS.md`,
/// Eingabegrenzen: ID-Listen mit einer von N unabhängigen Zahl von Anweisungen).
async fn zeilen_lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    fremd: &[i64],
) -> Result<std::collections::HashMap<i64, i64>, sqlx::Error> {
    let schluessel: Vec<String> = fremd.iter().map(i64::to_string).collect();
    let zeilen: Vec<(String, String)> = sqlx::query_as(
        "SELECT fremder_schluessel, lokaler_schluessel FROM spiegel_herkunft \
         WHERE einsatz_id = ? AND art = ? \
           AND fremder_schluessel IN (SELECT value FROM json_each(?))",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(serde_json::to_string(&schluessel).expect("Schlüssel serialisierbar"))
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(f, l)| Some((f.parse().ok()?, l.parse().ok()?)))
        .collect())
}

/// Lokale Kennung einer gespiegelten Zeile.
async fn zeile_lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    fremd: i64,
) -> Result<Option<i64>, sqlx::Error> {
    Ok(
        super::abbildung::einsatz_lokal(conn, einsatz_id, tabelle, &fremd.to_string())
            .await?
            .and_then(|l| l.parse().ok()),
    )
}

/// Ein echtes Konto der Org über die Kennung, die der Absender kennt (wie
/// [`super::abbildung::konto_lokal`], ohne einen Stellvertreter anzulegen: der bekäme nichts).
async fn konto_echt(
    conn: &mut SqliteConnection,
    org_id: i64,
    angabe: &KontoAngabe,
) -> Result<Option<i64>, sqlx::Error> {
    let Some(id) = angabe.gegen_id else {
        return Ok(None);
    };
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT b.id FROM benutzer b WHERE b.id = ? AND b.org_id = ? AND {}",
        super::OHNE_STELLVERTRETER
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await
}

/// Modulschlüssel als `&'static str` aus dem Katalog.
fn modul_key(wert: &str) -> Option<&'static str> {
    crate::einsatz::modul::MODUL_KEYS
        .iter()
        .copied()
        .find(|k| *k == wert)
}

async fn adressat(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    a: &AdressatAngabe,
) -> Result<Abgebildet<Option<Adressat>>, sqlx::Error> {
    let wert = a.wert.as_deref();
    Ok(match a.art.as_str() {
        "funktion" => match wert.and_then(Fuehrungsfunktion::parse) {
            Some(f) => Abgebildet::Ja(Some(Adressat::Funktion(f))),
            None => Abgebildet::Unbrauchbar,
        },
        "person" => match wert.and_then(|w| w.parse::<i64>().ok()) {
            Some(fremd) => match zeile_lokal(conn, einsatz_id, "einsatz_personal", fremd).await? {
                Some(id) => Abgebildet::Ja(Some(Adressat::Person(id))),
                None => Abgebildet::Fehlt,
            },
            None => Abgebildet::Unbrauchbar,
        },
        // Ohne echtes Konto am Hub entfällt der Adressat (Spec: ein Konto, das nur am ELW
        // besteht, erhält am Hub nichts).
        "nutzer" => match &a.konto {
            Some(k) => Abgebildet::Ja(konto_echt(conn, org_id, k).await?.map(Adressat::Nutzer)),
            None => Abgebildet::Unbrauchbar,
        },
        "modul_leser" => match wert.and_then(modul_key) {
            Some(m) => Abgebildet::Ja(Some(Adressat::ModulLeser(m))),
            None => Abgebildet::Unbrauchbar,
        },
        "modul_schreiber" => match wert.and_then(modul_key) {
            Some(m) => Abgebildet::Ja(Some(Adressat::ModulSchreiber(m))),
            None => Abgebildet::Unbrauchbar,
        },
        "fuehrungskraefte" => Abgebildet::Ja(Some(Adressat::Fuehrungskraefte)),
        "einsatzleitung" => Abgebildet::Ja(Some(Adressat::Einsatzleitung)),
        _ => Abgebildet::Unbrauchbar,
    })
}

/// Kennt diese Instanz jeden Wert des Adressaten (ohne Datenbank)? Ein unbekannter Wert eines
/// neueren Gegenübers verwirft den Anlass, statt ihn ewig zurückzustellen (D3).
fn adressat_bekannt(a: &AdressatAngabe) -> bool {
    let wert = a.wert.as_deref();
    match a.art.as_str() {
        "funktion" => wert.and_then(Fuehrungsfunktion::parse).is_some(),
        "person" => wert.is_some_and(|w| w.parse::<i64>().is_ok()),
        "nutzer" => a.konto.is_some(),
        "modul_leser" | "modul_schreiber" => wert.and_then(modul_key).is_some(),
        "fuehrungskraefte" | "einsatzleitung" => true,
        _ => false,
    }
}

/// Bildet einen Anlass auf den Spiegel ab (D3).
async fn abbilden(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    h: &HinweisAnlass,
) -> Result<Abgebildet<Folge>, sqlx::Error> {
    let (Some(art), Some(typ)) = (
        BenachrichtigungArt::parse(&h.art),
        BenachrichtigungBezugTyp::parse(&h.bezug_typ),
    ) else {
        return Ok(Abgebildet::Unbrauchbar);
    };
    // Einen Alarm quittiert jeder selbst, auch am Hub (Spec „Für alle erledigt gilt auch am Hub“).
    if h.erledigen && art.stufe() == crate::benachrichtigung::BenachrichtigungStufe::Alarm {
        return Ok(Abgebildet::Unbrauchbar);
    }
    if h.bezug_ids.is_empty()
        || h.bezug_ids.len() > BEZUEGE_MAX
        || (!h.erledigen && h.bezug_ids.len() != 1)
        || h.adressaten.len() > ADRESSATEN_MAX
        || !h.adressaten.iter().all(adressat_bekannt)
    {
        return Ok(Abgebildet::Unbrauchbar);
    }
    // Nur ein Spiegel dieser Kopplung.
    let einsatz: Option<(i64, i64)> = sqlx::query_as(
        "SELECT e.id, e.org_id FROM einsatz_spiegel s JOIN einsatz e ON e.id = s.einsatz_id \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         WHERE s.fremde_kennung = ? AND o.kopplung_id = ? AND o.widerrufen_at IS NULL \
           AND e.spiegel = 1",
    )
    .bind(&h.kennung)
    .bind(kopplung.id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((einsatz_id, org_id)) = einsatz else {
        return Ok(Abgebildet::Fehlt);
    };
    let mut ids = Vec::with_capacity(h.bezug_ids.len());
    match bezug_tabelle(typ) {
        None if typ == BenachrichtigungBezugTyp::SchichtplanWechsel => {
            ids.extend_from_slice(&h.bezug_ids);
        }
        // Einsatz und Lagebesprechung tragen die Einsatzkennung.
        None => ids.extend(std::iter::repeat_n(einsatz_id, h.bezug_ids.len())),
        Some(tabelle) => {
            let lokal = zeilen_lokal(conn, einsatz_id, tabelle, &h.bezug_ids).await?;
            for fremd in &h.bezug_ids {
                match lokal.get(fremd) {
                    Some(&id) => ids.push(id),
                    // Auch beim Erledigen zurückstellen: ein älterer Melde-Anlass zu dieser Zeile
                    // kann noch warten und legte sonst danach einen offenen Hinweis an.
                    None => return Ok(Abgebildet::Fehlt),
                }
            }
        }
    }
    if h.erledigen {
        return Ok(Abgebildet::Ja(Folge::Erledigen {
            einsatz_id,
            art,
            typ,
            ids,
        }));
    }
    let mut anlass = Anlass::neu(einsatz_id, art, Bezug::neu(typ, ids[0]));
    if let Some(k) = &h.ausloeser {
        anlass.ausloeser = konto_echt(conn, org_id, k).await?;
    }
    for a in &h.adressaten {
        match adressat(conn, einsatz_id, org_id, a).await? {
            Abgebildet::Ja(Some(a)) => anlass.adressaten.push(a),
            Abgebildet::Ja(None) => {}
            Abgebildet::Fehlt => return Ok(Abgebildet::Fehlt),
            Abgebildet::Unbrauchbar => return Ok(Abgebildet::Unbrauchbar),
        }
    }
    for (fremd, ziel) in [
        (h.einheit_id, &mut anlass.einheit_id),
        (h.durch_einheit_id, &mut anlass.durch_einheit_id),
    ] {
        if let Some(fremd) = fremd {
            // Eine verschwundene Einheit nennt die Detailzeile nicht (Migration 0275).
            *ziel = zeile_lokal(conn, einsatz_id, "einsatz_einheit", fremd).await?;
        }
    }
    Ok(Abgebildet::Ja(Folge::Melden(anlass)))
}

fn fingerabdruck(h: &HinweisAnlass) -> String {
    format!(
        "{}|{}|{:?}|{}|{}",
        h.art, h.bezug_typ, h.bezug_ids, h.erledigen, h.erstellt_at
    )
}

/// Nimmt die Hinweise eines Abgleichs an (D2), in dessen Transaktion nach der Übernahme der
/// Zeilen. Liefert die Quittungen und was nach dem Commit zu melden ist. Was am Spiegel noch
/// fehlt, bleibt ohne Quittung; die meldende Seite sendet es erneut.
pub async fn annehmen(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    hinweise: &[HinweisAnlass],
    jetzt: DateTime<Utc>,
) -> Result<(Vec<i64>, Vec<Folge>), sqlx::Error> {
    let grenze = jetzt - Duration::hours(NACHREICHEN_STUNDEN);
    let jetzt_text = crate::zeit::formatiere_utc(jetzt);
    let mut quittungen = Vec::new();
    let mut folgen = Vec::new();
    for h in hinweise {
        let abdruck = fingerabdruck(h);
        let bekannt: Option<String> = sqlx::query_scalar(
            "SELECT fingerabdruck FROM hinweis_eingang WHERE kopplung_id = ? AND fremde_id = ?",
        )
        .bind(kopplung.id)
        .bind(h.id)
        .fetch_optional(&mut *conn)
        .await?;
        if bekannt.as_deref() == Some(abdruck.as_str()) {
            quittungen.push(h.id);
            continue;
        }
        let zu_alt = crate::zeit::parse_utc(&h.erstellt_at).is_none_or(|t| t < grenze);
        let folge = if zu_alt {
            None
        } else {
            match abbilden(conn, kopplung, h).await? {
                Abgebildet::Ja(f) => Some(f),
                Abgebildet::Fehlt => continue,
                Abgebildet::Unbrauchbar => {
                    tracing::warn!(
                        kopplung = kopplung.id,
                        hinweis = h.id,
                        art = %h.art,
                        "Hinweis des Gegenübers nicht abbildbar, verworfen"
                    );
                    None
                }
            }
        };
        sqlx::query(
            "INSERT INTO hinweis_eingang (kopplung_id, fremde_id, fingerabdruck, angenommen_at) \
             VALUES (?, ?, ?, ?) ON CONFLICT (kopplung_id, fremde_id) DO UPDATE SET \
             fingerabdruck = excluded.fingerabdruck, angenommen_at = excluded.angenommen_at",
        )
        .bind(kopplung.id)
        .bind(h.id)
        .bind(&abdruck)
        .bind(&jetzt_text)
        .execute(&mut *conn)
        .await?;
        quittungen.push(h.id);
        folgen.extend(folge);
    }
    Ok((quittungen, folgen))
}

/// Meldet nach dem Commit (D2): wie für einen eigenen Einsatz, mit Live und Push dieser Instanz.
pub async fn ausfuehren(pool: &SqlitePool, live: &LiveHub, folgen: Vec<Folge>) {
    for f in folgen {
        match f {
            Folge::Melden(anlass) => {
                crate::benachrichtigung::melden(pool, live, anlass).await;
            }
            Folge::Erledigen {
                einsatz_id,
                art,
                typ,
                ids,
            } => {
                crate::benachrichtigung::erledigen(pool, live, einsatz_id, art, typ, &ids).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jeder_bezugstyp_ist_eingeordnet() {
        // Ein neuer Bezug braucht hier seine gespiegelte Tabelle oder `None` mit Grund; die
        // Tabelle muss gespiegelt sein, sonst kommt der Hinweis nie an.
        let gespiegelt: Vec<&str> = super::super::art::GESPIEGELT
            .iter()
            .map(|g| g.tabelle)
            .collect();
        for typ in BenachrichtigungBezugTyp::ALLE {
            if let Some(t) = bezug_tabelle(typ) {
                assert!(
                    gespiegelt.contains(&t),
                    "{t} ({}) wird nicht gespiegelt",
                    typ.as_str()
                );
            }
        }
        assert!(gespiegelt.contains(&"einsatz_personal"));
        assert!(gespiegelt.contains(&"einsatz_einheit"));
    }

    #[test]
    fn jeder_modulschluessel_eines_bezugs_ist_im_katalog() {
        for typ in BenachrichtigungBezugTyp::ALLE {
            if let Some(m) = typ.modul() {
                assert_eq!(modul_key(m), Some(m), "{m} fehlt in MODUL_KEYS");
            }
        }
    }

    #[test]
    fn adressaten_gehen_als_text() {
        let a = adressat_lokal(&Adressat::Funktion(Fuehrungsfunktion::ALLE[0]));
        assert_eq!(a.art, "funktion");
        assert_eq!(
            a.wert.as_deref().and_then(Fuehrungsfunktion::parse),
            Some(Fuehrungsfunktion::ALLE[0])
        );
        assert_eq!(
            adressat_lokal(&Adressat::ModulLeser("meldungen"))
                .wert
                .as_deref(),
            Some("meldungen")
        );
        assert_eq!(adressat_lokal(&Adressat::Einsatzleitung).wert, None);
    }

    /// Kopplung 1 in Richtung `richtung`, Org-Zuordnung 1 für Org 1, Hinweise angenommen.
    async fn kopplung(pool: &SqlitePool, richtung: &str) -> KopplungZeile {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Org')")
            .execute(pool)
            .await
            .unwrap();
        let adresse = if richtung == "meldet_sich" {
            "'https://hub.example.org'"
        } else {
            "NULL"
        };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, zustand, gegenueber_adresse, gegenueber_hinweise) \
             VALUES (1, 'gegen', 'x', 'Hub', '{richtung}', 'aktiv', {adresse}, 1)"
        )))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (1, 1, 1, 'gegen/1', 'Org')",
        )
        .execute(pool)
        .await
        .unwrap();
        crate::instanz::repo::load_kopplung(pool, 1).await.unwrap()
    }

    async fn einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn ziele_von(pool: &SqlitePool, einsatz_id: i64) -> Vec<Ziel> {
        let mut conn = pool.acquire().await.unwrap();
        ziele(&mut conn, einsatz_id).await.unwrap()
    }

    #[tokio::test]
    async fn hinweise_reisen_nur_fuer_gefuehrte_einsaetze_ueber_eine_aktive_meldende_kopplung() {
        let pool = crate::db::test_pool().await;
        kopplung(&pool, "meldet_sich").await;
        let e = einsatz(&pool).await;
        assert_eq!(
            ziele_von(&pool, e).await,
            vec![Ziel {
                kopplung_org_id: 1,
                web_push: false
            }]
        );
        sqlx::query("UPDATE instanz_kopplung SET gegenueber_web_push = 1")
            .execute(&pool)
            .await
            .unwrap();
        assert!(pusht_ueber_hub(&ziele_von(&pool, e).await));
        for (sql, grund) in [
            (
                "UPDATE instanz_kopplung SET gegenueber_hinweise = 0",
                "älterer Hub",
            ),
            (
                "UPDATE instanz_kopplung SET zustand = 'angebahnt'",
                "nicht aktiv",
            ),
            (
                "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-12T00:00:00Z'",
                "Org widerrufen",
            ),
            ("UPDATE einsatz SET org_id = 99", "andere Org"),
        ] {
            let mut tx = pool.begin().await.unwrap();
            sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (99, 'Andere')")
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
                .execute(&mut *tx)
                .await
                .unwrap();
            let mut conn = tx;
            assert!(ziele(&mut conn, e).await.unwrap().is_empty(), "{grund}");
            conn.rollback().await.unwrap();
        }
        crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, e).await;
        assert!(ziele_von(&pool, e).await.is_empty(), "Spiegel");
    }

    #[tokio::test]
    async fn die_erreichte_seite_nimmt_keine_hinweise_an() {
        let pool = crate::db::test_pool().await;
        kopplung(&pool, "wird_gemeldet").await;
        let e = einsatz(&pool).await;
        assert!(ziele_von(&pool, e).await.is_empty());
    }

    #[tokio::test]
    async fn aufraeumen_nach_12_und_48_stunden() {
        let pool = crate::db::test_pool().await;
        kopplung(&pool, "meldet_sich").await;
        let e = einsatz(&pool).await;
        let jetzt = Utc::now();
        let vor = |h: i64| crate::zeit::formatiere_utc(jetzt - Duration::hours(h));
        for h in [11, 13] {
            sqlx::query(
                "INSERT INTO hinweis_ausgang (kopplung_org_id, einsatz_id, daten, erstellt_at) \
                 VALUES (1, ?, '{}', ?)",
            )
            .bind(e)
            .bind(vor(h))
            .execute(&pool)
            .await
            .unwrap();
        }
        for (id, h) in [(1, 47), (2, 49)] {
            sqlx::query(
                "INSERT INTO hinweis_eingang (kopplung_id, fremde_id, fingerabdruck, angenommen_at) \
                 VALUES (1, ?, 'f', ?)",
            )
            .bind(id)
            .bind(vor(h))
            .execute(&pool)
            .await
            .unwrap();
        }
        assert_eq!(aufraeumen(&pool, jetzt).await.unwrap(), 2);
        let bleiben: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM hinweis_ausgang), (SELECT COUNT(*) FROM hinweis_eingang)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(bleiben, (1, 1));
    }

    fn hinweis(id: i64, art: &str) -> HinweisAnlass {
        HinweisAnlass {
            id,
            kennung: "elw/1".into(),
            art: art.into(),
            bezug_typ: "einsatz".into(),
            bezug_ids: vec![1],
            erledigen: false,
            ausloeser: None,
            adressaten: vec![AdressatAngabe {
                art: "einsatzleitung".into(),
                wert: None,
                konto: None,
            }],
            einheit_id: None,
            durch_einheit_id: None,
            erstellt_at: crate::zeit::jetzt(),
        }
    }

    #[tokio::test]
    async fn unbekanntes_wird_quittiert_und_verworfen_fehlendes_bleibt() {
        let pool = crate::db::test_pool().await;
        let k = kopplung(&pool, "wird_gemeldet").await;
        let mut conn = pool.acquire().await.unwrap();
        let mut modul = hinweis(3, "einsatz_neu");
        modul.adressaten[0] = AdressatAngabe {
            art: "modul_leser".into(),
            wert: Some("gibt_es_nicht".into()),
            konto: None,
        };
        let (quittungen, folgen) = annehmen(
            &mut conn,
            &k,
            &[
                hinweis(1, "neue_art_eines_neueren_elw"),
                hinweis(2, "einsatz_neu"),
                modul,
            ],
            Utc::now(),
        )
        .await
        .unwrap();
        // 1 und 3 sind unbrauchbar (quittiert, nichts gemeldet); 2 wartet auf den Spiegel.
        assert_eq!(quittungen, vec![1, 3]);
        assert!(folgen.is_empty());
    }

    #[tokio::test]
    async fn ein_demo_einsatz_hat_kein_ziel() {
        let pool = crate::db::test_pool().await;
        kopplung(&pool, "meldet_sich").await;
        let e = einsatz(&pool).await;
        sqlx::query("INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (1, ?, '{}')")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        assert!(ziele_von(&pool, e).await.is_empty(), "wird nicht geliefert");
    }

    #[tokio::test]
    async fn alt_alarm_erledigt_und_widerrufen() {
        let pool = crate::db::test_pool().await;
        let k = kopplung(&pool, "wird_gemeldet").await;
        let e = einsatz(&pool).await;
        crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, e).await;
        sqlx::query("UPDATE einsatz_spiegel SET fremde_kennung = 'elw/1', kopplung_org_id = 1")
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        let mut alt = hinweis(1, "einsatz_neu");
        alt.erstellt_at =
            crate::zeit::formatiere_utc(Utc::now() - Duration::hours(NACHREICHEN_STUNDEN + 1));
        let mut alarm = hinweis(2, "sofortmeldung");
        alarm.erledigen = true;
        let (q, f) = annehmen(&mut conn, &k, &[alt, alarm], Utc::now())
            .await
            .unwrap();
        assert_eq!(q, vec![1, 2], "zu alt und Alarm-Erledigt: quittiert");
        assert!(f.is_empty(), "nichts gemeldet, kein Alarm quittiert");
        let (q, f) = annehmen(&mut conn, &k, &[hinweis(3, "einsatz_neu")], Utc::now())
            .await
            .unwrap();
        assert_eq!((q, f.len()), (vec![3], 1), "der Spiegel ist bekannt");
        sqlx::query("UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-12T00:00:00Z'")
            .execute(&mut *conn)
            .await
            .unwrap();
        let (q, f) = annehmen(&mut conn, &k, &[hinweis(4, "einsatz_neu")], Utc::now())
            .await
            .unwrap();
        assert!(
            q.is_empty() && f.is_empty(),
            "widerrufene Org: nicht angenommen"
        );
    }

    #[test]
    fn ein_paket_mit_zu_vielen_hinweisen_ist_ungueltig() {
        let mut p = super::super::paket::SpiegelPaket {
            hinweise: vec![hinweis(1, "einsatz_neu"); HINWEISE_MAX],
            ..Default::default()
        };
        assert!(p.check().is_ok());
        p.hinweise.push(hinweis(2, "einsatz_neu"));
        assert!(p.check().is_err());
        p.hinweise.clear();
        p.hinweis_quittungen = vec![1; HINWEISE_MAX + 1];
        assert!(p.check().is_err());
    }

    #[test]
    fn ein_aelterer_hinweis_ohne_neue_felder_liest_sich() {
        let h: HinweisAnlass = serde_json::from_value(serde_json::json!({
            "id": 1, "kennung": "elw/1", "art": "meldung_neu", "bezug_typ": "meldung",
            "bezug_ids": [5], "erstellt_at": "2026-11-12T08:00:00Z"
        }))
        .expect("Hinweis");
        assert!(!h.erledigen);
        assert!(h.adressaten.is_empty());
    }
}
