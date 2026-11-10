//! Übernahme einer Nachlieferung an der meldenden Seite (design.md D3, D4, D5, D6), in der
//! Transaktion der Meldung. Der Merker `stammdaten_uebernahme` lässt die Schutz-Trigger für die
//! Dauer der Übernahme durch.
//!
//! Zwei Durchgänge: erst alle Zeilen in der Reihenfolge von [`art::BESCHREIBUNGEN`] (wer verwiesen
//! wird, kommt vorher), dann Verweise auf die eigene Art und die Unterlisten. Jede Zeile läuft in
//! einem Savepoint: verletzt sie eine Regel hier (etwa ein Name, den eine lokale Zeile schon hat),
//! bleibt sie draußen, und die Kopplung bekommt einen Hinweis; der Rest geht durch.

use super::art::{self, ArtBeschreibung, Schluessel};
use super::geheimnis;
use super::herkunft;
use super::liefern::parse_quali_soll;
use super::{StammdatenArt, StammdatenLieferung};
use crate::auth::PASSWORT_HASH_KEIN_LOKALES;
use crate::error::AppError;
use crate::instanz::repo::OrgZeile;
use serde_json::Value;
use sqlx::SqliteConnection;

/// Was eine Übernahme bewirkt hat.
#[derive(Debug, Default)]
pub struct Ergebnis {
    /// Mindestens eine Zeile wurde angelegt, geändert oder entfernt.
    pub geaendert: bool,
    /// Konten, die hier gerade deaktiviert wurden: ihre Sitzungen enden nach dem Commit.
    pub deaktivierte_konten: Vec<i64>,
    pub hinweise: Vec<String>,
}

fn art_name(art: StammdatenArt) -> &'static str {
    match art {
        StammdatenArt::Konto => "Konto",
        StammdatenArt::OrgEinstellungen => "Org-Einstellungen",
        StammdatenArt::ModulEinstellung => "Modul-Einstellung",
        StammdatenArt::Fuehrungsfunktion => "Führungsfunktion",
        StammdatenArt::FahrzeugStatus => "Fahrzeug-Status",
        StammdatenArt::PersonalStatus => "Personal-Status",
        StammdatenArt::Qualifikation => "Qualifikation",
        StammdatenArt::EinheitTyp => "Einheitstyp",
        StammdatenArt::Fahrzeug => "Fahrzeug",
        StammdatenArt::Material => "Material",
        StammdatenArt::Personal => "Personal",
        StammdatenArt::EinheitVorlage => "Einheiten-Vorlage",
        StammdatenArt::Schichtmodell => "Schichtmodell",
        StammdatenArt::EinsatzVorlage => "Einsatz-Vorlage",
        StammdatenArt::StichwortVorschlag => "Stichwort-Vorschlag",
        StammdatenArt::VerpflegungVorlage => "Mahlzeit",
        StammdatenArt::Sprechgruppe => "Sprechgruppe",
        StammdatenArt::EtbBaustein => "ETB-Baustein",
        StammdatenArt::ExterneStelle => "Externe Stelle",
        StammdatenArt::UnterkunftRichtwert => "Unterkunft-Richtwert",
    }
}

/// Lesbarer Name einer gelieferten Zeile für Hinweise.
fn zeilen_name(l: &StammdatenLieferung) -> String {
    let d = l.daten.as_ref().unwrap_or(&Value::Null);
    for feld in [
        "benutzername",
        "funkrufname",
        "name",
        "label",
        "bezeichnung",
        "funktion",
        "text",
    ] {
        if let Some(t) = d[feld].as_str() {
            return t.to_string();
        }
    }
    l.schluessel.clone()
}

fn ist_selbstverweis(b: &ArtBeschreibung, spalte: &str) -> bool {
    b.verweise
        .iter()
        .any(|v| v.spalte == spalte && v.ziel == b.art)
}

/// Lokaler Schlüssel zu einem Verweis der Quelle, als Zahl.
async fn map_id(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    ziel: StammdatenArt,
    wert: &Value,
) -> Result<Option<i64>, AppError> {
    let Some(fremd) = wert.as_i64() else {
        return Ok(None);
    };
    Ok(
        herkunft::find_lokal(conn, zuordnung.id, ziel, &fremd.to_string())
            .await?
            .and_then(|l| l.parse().ok()),
    )
}

/// Übersetzt die Verweise und das Qualifikationssoll einer Zeile in lokale Schlüssel.
/// Selbstverweise bleiben unberührt (zweiter Durchgang); ein unbekannter Verweis wird `null`.
async fn translate(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    b: &ArtBeschreibung,
    daten: &Value,
) -> Result<Value, AppError> {
    let mut aus = daten.clone();
    for v in b.verweise {
        if v.ziel == b.art {
            continue;
        }
        let lokal = map_id(conn, zuordnung, v.ziel, &daten[v.spalte]).await?;
        aus[v.spalte] = lokal.map(Value::from).unwrap_or(Value::Null);
    }
    if let Some(spalte) = b.quali_soll {
        let mut paare = Vec::new();
        for (q, n) in parse_quali_soll(&daten[spalte]) {
            if let Some(lokal) = map_id(
                conn,
                zuordnung,
                StammdatenArt::Qualifikation,
                &Value::from(q),
            )
            .await?
            {
                paare.push(serde_json::json!({ "q": lokal, "n": n }));
            }
        }
        aus[spalte] = if paare.is_empty() {
            Value::Null
        } else {
            Value::String(Value::Array(paare).to_string())
        };
    }
    Ok(aus)
}

fn set_liste(spalten: &[&str]) -> String {
    spalten
        .iter()
        .map(|s| format!("{s} = json_extract(?2, '$.{s}')"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn werte_liste(spalten: &[&str]) -> String {
    spalten
        .iter()
        .map(|s| format!("json_extract(?2, '$.{s}')"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `AND (<bereich>)` der Art oder leer.
fn bereich_sql(b: &ArtBeschreibung) -> String {
    b.bereich
        .map(|bed| format!(" AND ({bed})"))
        .unwrap_or_default()
}

/// Eine Löschung, die auf ihren zweiten Versuch wartet (D5 der Change
/// `kjezbk06-stammdaten-kataloge`). Bis dahin trägt die Zeile noch ihre Herkunft.
struct Wartend<'a> {
    art: StammdatenArt,
    lieferung: &'a StammdatenLieferung,
    lokal: String,
}

/// Erster Abgleich (D5): eine lokale Zeile der Art im Bereich, die in jeder Spalte des natürlichen
/// Schlüssels gleich ist und noch nicht vom Hub stammt, oder deren Löschung vom Hub noch wartet
/// (gelöscht und gleich wieder angelegt: die Zeile bleibt, auf die Einsatzdaten zeigen). Unter
/// mehreren gewinnt eine nicht stillgelegte, dann die älteste. Fehlt ein Wert oder ist er leer,
/// wird nicht abgeglichen. Liefert den lokalen Schlüssel und, wenn die Zeile wartete, den
/// Schlüssel an der Quelle, dessen Herkunft sie verliert.
async fn find_natuerlich(
    conn: &mut SqliteConnection,
    b: &ArtBeschreibung,
    org_id: i64,
    daten: &Value,
    wartend: &[Wartend<'_>],
) -> Result<Option<(String, Option<String>)>, AppError> {
    let mut werte = Vec::with_capacity(b.natuerlich.len());
    for n in b.natuerlich {
        match daten[*n].as_str().filter(|w| !w.trim().is_empty()) {
            Some(w) => werte.push(w),
            None => return Ok(None),
        }
    }
    let gleich: String = b
        .natuerlich
        .iter()
        .map(|n| format!(" AND t.{n} = ?"))
        .collect();
    // Stillgelegte zuletzt: Ihr Name ist oft nur unter aktiven Zeilen eindeutig, eine zweite
    // aktive Zeile desselben Namens stieße sich sonst am Index. Spalte und Wert sind Konstanten.
    let stillgelegt_zuletzt = b
        .stilllegen
        .map(|(spalte, wert)| format!("(t.{spalte} = '{wert}'), "))
        .unwrap_or_default();
    let sql = format!(
        "SELECT t.id, EXISTS (SELECT 1 FROM stammdaten_herkunft h \
           WHERE h.art = ? AND h.org_id = t.org_id \
             AND h.lokaler_schluessel = CAST(t.id AS TEXT)) \
         FROM {tab} t WHERE t.org_id = ?{gleich}{bereich} \
         ORDER BY {stillgelegt_zuletzt}t.id",
        tab = b.tabelle,
        bereich = bereich_sql(b)
    );
    let mut abfrage = sqlx::query_as::<_, (i64, bool)>(sqlx::AssertSqlSafe(sql))
        .bind(b.art.as_str())
        .bind(org_id);
    for w in werte {
        abfrage = abfrage.bind(w);
    }
    for (id, vom_hub) in abfrage.fetch_all(&mut *conn).await? {
        let lokal = id.to_string();
        if !vom_hub {
            return Ok(Some((lokal, None)));
        }
        if let Some(w) = wartend.iter().find(|w| w.art == b.art && w.lokal == lokal) {
            return Ok(Some((lokal, Some(w.lieferung.schluessel.clone()))));
        }
    }
    Ok(None)
}

/// Wie [`upsert`] ausging.
enum Upsert {
    /// Lokaler Schlüssel der Zeile.
    Ok(String),
    /// Übersprungen, mit Hinweis.
    Hinweis(String),
}

/// Erster Durchgang für eine Zeile: anlegen oder ändern, Herkunft festhalten.
async fn upsert(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    b: &ArtBeschreibung,
    l: &StammdatenLieferung,
    daten: &Value,
    wartend: &[Wartend<'_>],
) -> Result<Upsert, AppError> {
    let json = daten.to_string();
    let org_id = zuordnung.org_id;
    match b.schluessel {
        Schluessel::Org | Schluessel::Spalte(_) => {
            let (schluessel_spalte, konflikt) = match b.schluessel {
                Schluessel::Spalte(s) => (Some(s), format!("org_id, {s}")),
                _ => (None, "org_id".to_string()),
            };
            let mut spalten = vec!["org_id".to_string()];
            let mut werte = vec!["?1".to_string()];
            if let Some(s) = schluessel_spalte {
                spalten.push(s.to_string());
                werte.push("?3".to_string());
            }
            spalten.extend(b.spalten.iter().map(|s| s.to_string()));
            werte.push(werte_liste(b.spalten));
            let aktualisieren = b
                .spalten
                .iter()
                .map(|s| format!("{s} = excluded.{s}"))
                .collect::<Vec<_>>()
                .join(", ");
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({konflikt}) DO UPDATE SET {aktualisieren}",
                b.tabelle,
                spalten.join(", "),
                werte.join(", ")
            )))
            .bind(org_id)
            .bind(&json)
            .bind(&l.schluessel)
            .execute(&mut *conn)
            .await?;
            herkunft::save(
                conn,
                zuordnung.id,
                org_id,
                b.art,
                &l.schluessel,
                &l.schluessel,
            )
            .await?;
            Ok(Upsert::Ok(l.schluessel.clone()))
        }
        Schluessel::Id => {
            let mut lokal = herkunft::find_lokal(conn, zuordnung.id, b.art, &l.schluessel).await?;
            if lokal.is_none() {
                if b.art == StammdatenArt::Konto {
                    let name = daten["benutzername"].as_str().unwrap_or_default();
                    let vergeben: bool = sqlx::query_scalar(
                        "SELECT EXISTS (SELECT 1 FROM benutzer WHERE benutzername = ? COLLATE NOCASE)",
                    )
                    .bind(name)
                    .fetch_one(&mut *conn)
                    .await?;
                    if vergeben {
                        return Ok(Upsert::Hinweis(format!(
                            "Konto „{name}“ ist hier schon vergeben."
                        )));
                    }
                } else if !b.natuerlich.is_empty() {
                    if let Some((gefunden, alt)) =
                        find_natuerlich(conn, b, org_id, daten, wartend).await?
                    {
                        // Die Löschung der alten Zeile entfällt; sie trägt ab jetzt die neue.
                        if let Some(alt) = alt {
                            herkunft::delete(conn, zuordnung.id, b.art, &alt).await?;
                        }
                        lokal = Some(gefunden);
                    }
                }
            }
            // Selbstverweise setzt erst der zweite Durchgang.
            let spalten: Vec<&str> = b
                .spalten
                .iter()
                .copied()
                .filter(|s| !ist_selbstverweis(b, s))
                .collect();
            if let Some(x) = b.exklusiv {
                if daten[x].as_i64() == Some(1) {
                    // Die Markierung gibt es je Org nur einmal; die gelieferte gewinnt (D4).
                    sqlx::query(sqlx::AssertSqlSafe(format!(
                        "UPDATE {} SET {x} = 0 WHERE org_id = ? AND {x} = 1 AND id <> ?{}",
                        b.tabelle,
                        bereich_sql(b)
                    )))
                    .bind(org_id)
                    .bind(
                        lokal
                            .as_deref()
                            .and_then(|l| l.parse::<i64>().ok())
                            .unwrap_or(-1),
                    )
                    .execute(&mut *conn)
                    .await?;
                }
            }
            let id = match lokal {
                Some(lokal) => {
                    sqlx::query(sqlx::AssertSqlSafe(format!(
                        "UPDATE {} SET {} WHERE id = ?1 AND org_id = ?3",
                        b.tabelle,
                        set_liste(&spalten)
                    )))
                    .bind(lokal.parse::<i64>().unwrap_or(-1))
                    .bind(&json)
                    .bind(org_id)
                    .execute(&mut *conn)
                    .await?;
                    lokal
                }
                None => {
                    let (extra_spalte, extra_wert) = if b.art == StammdatenArt::Konto {
                        (", passwort_hash", ", ?3")
                    } else {
                        ("", "")
                    };
                    let id: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                        "INSERT INTO {} (org_id, {}{extra_spalte}) VALUES (?1, {}{extra_wert}) \
                         RETURNING id",
                        b.tabelle,
                        spalten.join(", "),
                        werte_liste(&spalten)
                    )))
                    .bind(org_id)
                    .bind(&json)
                    .bind(PASSWORT_HASH_KEIN_LOKALES)
                    .fetch_one(&mut *conn)
                    .await?;
                    id.to_string()
                }
            };
            herkunft::save(conn, zuordnung.id, org_id, b.art, &l.schluessel, &id).await?;
            Ok(Upsert::Ok(id))
        }
    }
}

/// Übernimmt Passwort-Hash und TOTP eines Kontos, wenn sie sich an der Quelle geändert haben
/// (D6). Kommt kein Geheimnis mehr, obwohl vorher eins kam, gilt hier kein Passwort mehr.
async fn apply_geheimnis(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    l: &StammdatenLieferung,
    lokal_id: i64,
    age: Option<&age::x25519::Identity>,
) -> Result<(), AppError> {
    let alt = herkunft::load_merkmal(conn, zuordnung.id, &l.schluessel).await?;
    let neu = match (&l.geheimnis, age) {
        (Some(text), Some(age)) => geheimnis::decrypt(age, text),
        _ => None,
    };
    match neu {
        Some(g) => {
            let merkmal = g.merkmal();
            if alt.as_deref() == Some(merkmal.as_str()) {
                return Ok(());
            }
            // Ein SSO-Konto hat hier keine SSO-Verknüpfung (sie wird nicht verteilt): ohne Netz
            // kommt es nur mit einem Einmalpasswort des Admins hier hinein, und das verweigert die
            // Benutzerverwaltung bei SSO-Konten. Also hier: kein lokales Passwort.
            let hash = if g.passwort_hash == crate::auth::PASSWORT_HASH_SSO_ONLY {
                PASSWORT_HASH_KEIN_LOKALES
            } else {
                g.passwort_hash.as_str()
            };
            sqlx::query(
                "UPDATE benutzer SET passwort_hash = ?, totp_secret = ?, totp_aktiviert = ?, \
                 passwort_wechsel_pflicht = ? WHERE id = ?",
            )
            .bind(hash)
            .bind(&g.totp_secret)
            .bind(g.totp_aktiviert)
            .bind(g.passwort_wechsel_pflicht)
            .bind(lokal_id)
            .execute(&mut *conn)
            .await?;
            herkunft::save_merkmal(conn, zuordnung.id, &l.schluessel, Some(&merkmal)).await?;
        }
        None if alt.is_some() => {
            sqlx::query(
                "UPDATE benutzer SET passwort_hash = ?, totp_secret = NULL, totp_aktiviert = 0 \
                 WHERE id = ?",
            )
            .bind(PASSWORT_HASH_KEIN_LOKALES)
            .bind(lokal_id)
            .execute(&mut *conn)
            .await?;
            herkunft::save_merkmal(conn, zuordnung.id, &l.schluessel, None).await?;
        }
        None => {}
    }
    Ok(())
}

/// Zweiter Durchgang: Selbstverweise setzen, Unterlisten ersetzen.
async fn apply_verweise(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    b: &ArtBeschreibung,
    daten: &Value,
    lokal: i64,
) -> Result<(), AppError> {
    for v in b.verweise.iter().filter(|v| v.ziel == b.art) {
        let wert = map_id(conn, zuordnung, v.ziel, &daten[v.spalte]).await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {} SET {} = ? WHERE id = ?",
            b.tabelle, v.spalte
        )))
        .bind(wert)
        .bind(lokal)
        .execute(&mut *conn)
        .await?;
    }
    for u in b.unterlisten {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {} WHERE {} = ?",
            u.tabelle, u.eltern_spalte
        )))
        .bind(lokal)
        .execute(&mut *conn)
        .await?;
        let Some(eintraege) = daten["unterlisten"][u.tabelle].as_array() else {
            continue;
        };
        'eintrag: for e in eintraege {
            let mut e = e.clone();
            // Der erste Verweis einer Unterliste ist ihr Gegenstand (Pflicht); ohne ihn entfällt
            // der Eintrag, die übrigen werden ohne Treffer leer.
            for (i, v) in u.verweise.iter().enumerate() {
                let wert = map_id(conn, zuordnung, v.ziel, &e[v.spalte]).await?;
                if wert.is_none() && i == 0 {
                    continue 'eintrag;
                }
                e[v.spalte] = wert.map(Value::from).unwrap_or(Value::Null);
            }
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT OR IGNORE INTO {} ({}, {}) VALUES (?1, {})",
                u.tabelle,
                u.eltern_spalte,
                u.spalten.join(", "),
                werte_liste(u.spalten)
            )))
            .bind(lokal)
            .bind(e.to_string())
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

/// Wie [`delete_zeile`] ausging.
#[derive(Debug, PartialEq, Eq)]
enum Loeschung {
    Erledigt,
    /// Eine andere Zeile zeigt noch auf sie; nach dem Rest der Lieferung erneut versuchen. Der
    /// lokale Schlüssel der Zeile.
    Nachholen(String),
}

/// Entfernt eine an der Quelle gelöschte Zeile; ist sie hier verwendet, wird sie stillgelegt.
/// Ein Konto wird nur deaktiviert. Mit `nachholen` gibt eine am Verweis gescheiterte Löschung
/// [`Loeschung::Nachholen`] zurück, statt schon stillzulegen (D5 der Change
/// `kjezbk06-stammdaten-kataloge`): Die Quelle löst einen Verweis oft im selben Paket, etwa die
/// Einsatz-Vorlage, die ein gelöschtes Schichtmodell vorgab, und die kommt im Rang danach.
async fn delete_zeile(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    b: &ArtBeschreibung,
    l: &StammdatenLieferung,
    ergebnis: &mut Ergebnis,
    nachholen: bool,
) -> Result<Loeschung, AppError> {
    let Some(lokal) = herkunft::find_lokal(conn, zuordnung.id, b.art, &l.schluessel).await? else {
        return Ok(Loeschung::Erledigt);
    };
    match b.schluessel {
        Schluessel::Org => {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {} WHERE org_id = ?",
                b.tabelle
            )))
            .bind(zuordnung.org_id)
            .execute(&mut *conn)
            .await?;
        }
        Schluessel::Spalte(s) => {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {} WHERE org_id = ? AND {s} = ?",
                b.tabelle
            )))
            .bind(zuordnung.org_id)
            .bind(&lokal)
            .execute(&mut *conn)
            .await?;
        }
        Schluessel::Id => {
            let id: i64 = lokal.parse().unwrap_or(-1);
            if b.art == StammdatenArt::Konto {
                let n = sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ? AND aktiv = 1")
                    .bind(id)
                    .execute(&mut *conn)
                    .await?
                    .rows_affected();
                if n == 1 {
                    ergebnis.deaktivierte_konten.push(id);
                }
                // Gelöscht an der Quelle: hier ein deaktiviertes Konto der Instanz. Eine neue Zeile
                // mit derselben id an der Quelle wird so ein neues Konto statt dieses.
                herkunft::delete(conn, zuordnung.id, b.art, &l.schluessel).await?;
                ergebnis.geaendert = true;
                return Ok(Loeschung::Erledigt);
            }
            sqlx::query("SAVEPOINT stammdaten_loeschen")
                .execute(&mut *conn)
                .await?;
            let mut versuch: Result<(), sqlx::Error> = Ok(());
            for u in b.unterlisten {
                if versuch.is_ok() {
                    versuch = sqlx::query(sqlx::AssertSqlSafe(format!(
                        "DELETE FROM {} WHERE {} = ?",
                        u.tabelle, u.eltern_spalte
                    )))
                    .bind(id)
                    .execute(&mut *conn)
                    .await
                    .map(|_| ());
                }
            }
            if versuch.is_ok() {
                versuch = sqlx::query(sqlx::AssertSqlSafe(format!(
                    "DELETE FROM {} WHERE id = ?",
                    b.tabelle
                )))
                .bind(id)
                .execute(&mut *conn)
                .await
                .map(|_| ());
            }
            match versuch {
                Ok(()) => {
                    sqlx::query("RELEASE stammdaten_loeschen")
                        .execute(&mut *conn)
                        .await?;
                }
                Err(sqlx::Error::Database(_)) => {
                    // Einsatzdaten zeigen noch auf die Zeile: stilllegen statt löschen.
                    sqlx::query("ROLLBACK TO stammdaten_loeschen")
                        .execute(&mut *conn)
                        .await?;
                    sqlx::query("RELEASE stammdaten_loeschen")
                        .execute(&mut *conn)
                        .await?;
                    if nachholen {
                        return Ok(Loeschung::Nachholen(lokal));
                    }
                    if let Some((spalte, wert)) = b.stilllegen {
                        sqlx::query(sqlx::AssertSqlSafe(format!(
                            "UPDATE {} SET {spalte} = ? WHERE id = ?",
                            b.tabelle
                        )))
                        .bind(wert)
                        .bind(id)
                        .execute(&mut *conn)
                        .await?;
                    }
                    // Stillgelegt, gehört der Instanz: eine wiederverwendete id an der Quelle
                    // träfe sonst diese Zeile, auf die noch Einsatzdaten zeigen.
                    herkunft::delete(conn, zuordnung.id, b.art, &l.schluessel).await?;
                    ergebnis.geaendert = true;
                    return Ok(Loeschung::Erledigt);
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
    herkunft::delete(conn, zuordnung.id, b.art, &l.schluessel).await?;
    ergebnis.geaendert = true;
    Ok(Loeschung::Erledigt)
}

/// Ob ein Fehler eine Regel der Datenbank ist (dann bleibt die Zeile draußen), kein Defekt.
fn ist_regelverstoss(e: &AppError) -> bool {
    matches!(e, AppError::Database(sqlx::Error::Database(_)))
}

/// Übernimmt eine Nachlieferung für eine Org-Zuordnung (D3–D6).
pub async fn uebernehmen(
    conn: &mut SqliteConnection,
    zuordnung: &OrgZeile,
    lieferungen: &[StammdatenLieferung],
    age: Option<&age::x25519::Identity>,
) -> Result<Ergebnis, AppError> {
    let mut ergebnis = Ergebnis::default();
    if lieferungen.is_empty() {
        return Ok(ergebnis);
    }
    sqlx::query("INSERT OR IGNORE INTO stammdaten_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await?;
    let mut sortiert: Vec<(StammdatenArt, &StammdatenLieferung)> = lieferungen
        .iter()
        .filter_map(|l| StammdatenArt::parse(&l.art).map(|a| (a, l)))
        .collect();
    sortiert.sort_by_key(|(a, l)| (art::rang(*a), l.stand));
    // Die System-Rolle gilt für die ganze Instanz. Trägt sie mehrere Orgs, verwaltete ein Admin
    // vom Hub sonst auch die anderen (Entscheidung 09.11.2026): dann kommt er als `keiner`.
    let mehrere_orgs: bool = sqlx::query_scalar("SELECT COUNT(*) > 1 FROM organisation")
        .fetch_one(&mut *conn)
        .await?;

    let mut zweiter: Vec<(&ArtBeschreibung, Value, i64)> = Vec::new();
    let mut nachholen: Vec<Wartend<'_>> = Vec::new();
    for (a, l) in &sortiert {
        let b = art::beschreibung(*a);
        if l.geloescht || l.daten.is_none() {
            if let Loeschung::Nachholen(lokal) =
                delete_zeile(conn, zuordnung, b, l, &mut ergebnis, true).await?
            {
                nachholen.push(Wartend {
                    art: *a,
                    lieferung: l,
                    lokal,
                });
            }
            continue;
        }
        let daten = l.daten.as_ref().expect("geprüft");
        let mut uebersetzt = translate(conn, zuordnung, b, daten).await?;
        if *a == StammdatenArt::Konto
            && mehrere_orgs
            && uebersetzt["system_rolle"].as_str() == Some(crate::auth::ROLLE_ADMIN)
        {
            uebersetzt["system_rolle"] = Value::from(crate::auth::ROLLE_KEINER);
            ergebnis.hinweise.push(format!(
                "Konto „{}“ ist am Hub Admin, hier nicht: diese Instanz trägt mehrere Organisationen.",
                zeilen_name(l)
            ));
        }
        let vorher_aktiv: Option<bool> = if *a == StammdatenArt::Konto {
            match herkunft::find_lokal(conn, zuordnung.id, *a, &l.schluessel).await? {
                Some(lokal) => {
                    sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE id = ?")
                        .bind(lokal.parse::<i64>().unwrap_or(-1))
                        .fetch_optional(&mut *conn)
                        .await?
                }
                None => None,
            }
        } else {
            None
        };
        sqlx::query("SAVEPOINT stammdaten_zeile")
            .execute(&mut *conn)
            .await?;
        let mut versuch = upsert(conn, zuordnung, b, l, &uebersetzt, &nachholen).await;
        if let (Ok(Upsert::Ok(lokal)), StammdatenArt::Konto) = (&versuch, a) {
            let id = lokal.parse::<i64>().unwrap_or(-1);
            if let Err(e) = apply_geheimnis(conn, zuordnung, l, id, age).await {
                versuch = Err(e);
            }
        }
        match versuch {
            Ok(Upsert::Ok(lokal)) => {
                sqlx::query("RELEASE stammdaten_zeile")
                    .execute(&mut *conn)
                    .await?;
                ergebnis.geaendert = true;
                // Hat die Zeile eine wartende Löschung übernommen, entfällt diese.
                nachholen.retain(|w| !(w.art == *a && w.lokal == lokal));
                if *a == StammdatenArt::Konto
                    && vorher_aktiv == Some(true)
                    && uebersetzt["aktiv"].as_i64() == Some(0)
                {
                    ergebnis
                        .deaktivierte_konten
                        .push(lokal.parse().unwrap_or(-1));
                }
                if let Ok(id) = lokal.parse::<i64>() {
                    zweiter.push((b, uebersetzt.clone(), id));
                }
            }
            Ok(Upsert::Hinweis(h)) => {
                sqlx::query("RELEASE stammdaten_zeile")
                    .execute(&mut *conn)
                    .await?;
                ergebnis.hinweise.push(h);
            }
            Err(e) if ist_regelverstoss(&e) => {
                tracing::warn!(art = a.as_str(), fehler = %e, "Stammdaten-Zeile nicht übernommen");
                sqlx::query("ROLLBACK TO stammdaten_zeile")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("RELEASE stammdaten_zeile")
                    .execute(&mut *conn)
                    .await?;
                ergebnis.hinweise.push(format!(
                    "{} „{}“ nicht übernommen: Konflikt mit einer Zeile hier.",
                    art_name(*a),
                    zeilen_name(l)
                ));
            }
            Err(e) => return Err(e),
        }
    }
    for (b, daten, lokal) in &zweiter {
        if b.unterlisten.is_empty() && !b.verweise.iter().any(|v| v.ziel == b.art) {
            continue;
        }
        sqlx::query("SAVEPOINT stammdaten_verweise")
            .execute(&mut *conn)
            .await?;
        match apply_verweise(conn, zuordnung, b, daten, *lokal).await {
            Ok(()) => {
                sqlx::query("RELEASE stammdaten_verweise")
                    .execute(&mut *conn)
                    .await?;
            }
            Err(e) if ist_regelverstoss(&e) => {
                sqlx::query("ROLLBACK TO stammdaten_verweise")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("RELEASE stammdaten_verweise")
                    .execute(&mut *conn)
                    .await?;
                ergebnis.hinweise.push(format!(
                    "{} {lokal}: Verweise nicht vollständig übernommen.",
                    art_name(b.art)
                ));
            }
            Err(e) => return Err(e),
        }
    }
    // Zweiter Versuch der am Verweis gescheiterten Löschungen, wer verweist, zuerst (D5).
    nachholen.sort_by_key(|w| (std::cmp::Reverse(art::rang(w.art)), w.lieferung.stand));
    for w in nachholen {
        delete_zeile(
            conn,
            zuordnung,
            art::beschreibung(w.art),
            w.lieferung,
            &mut ergebnis,
            false,
        )
        .await?;
    }
    sqlx::query("DELETE FROM stammdaten_uebernahme")
        .execute(&mut *conn)
        .await?;
    Ok(ergebnis)
}

#[cfg(test)]
mod tests;
