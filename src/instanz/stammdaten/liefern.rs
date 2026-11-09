//! Nachlieferung an der erreichten Seite (design.md D2, D6): die Zeilen der Org, deren Stand über
//! dem gemeldeten liegt, nach Stand, bis zum Budget; Zeilen, auf die sie verweisen und die die
//! Gegenseite noch nicht kennen kann, kommen mit. Gelöschte Zeilen kommen als Löschung.

use super::art::{self, ArtBeschreibung, Schluessel};
use super::geheimnis::{self, Geheimnis};
use super::{StammdatenArt, StammdatenLieferung, ABHAENGIGE_MAX, UNTERLISTE_MAX};
use crate::error::AppError;
use serde_json::Value;
use sqlx::SqliteConnection;
use std::collections::HashSet;

/// An wen geliefert wird: über diese Felder entscheidet sich, ob Geheimnisse mitgehen (D6).
#[derive(Debug, Clone, Copy)]
pub struct Empfaenger<'a> {
    pub kopplung_org_id: i64,
    /// age-Empfänger aus der letzten signierten Meldung.
    pub age: Option<&'a str>,
    /// Die Gegenseite hat die Datenträgerverschlüsselung bestätigt.
    pub datentraeger_bestaetigt: bool,
}

/// Ergebnis einer Nachlieferung für eine Org.
#[derive(Debug, Default)]
pub struct Nachlieferung {
    pub zeilen: Vec<StammdatenLieferung>,
    /// Höchster Stand der Zeilen innerhalb des Budgets: so weit darf die Gegenseite ihren Stand
    /// setzen. Mitgelieferte Abhängigkeiten zählen nicht.
    pub bis: i64,
}

/// Liest eine Zeile als JSON-Objekt samt Unterlisten; `None`, wenn es sie in dieser Org nicht
/// (mehr) gibt.
async fn load_daten(
    conn: &mut SqliteConnection,
    b: &ArtBeschreibung,
    org_id: i64,
    schluessel: &str,
) -> Result<Option<Value>, AppError> {
    let objekt = art::json_object_sql(b.spalten, "");
    let text: Option<String> = match b.schluessel {
        Schluessel::Id => {
            let Ok(id) = schluessel.parse::<i64>() else {
                return Ok(None);
            };
            sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT {objekt} FROM {} WHERE org_id = ? AND id = ?",
                b.tabelle
            )))
            .bind(org_id)
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
        }
        Schluessel::Spalte(spalte) => {
            sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT {objekt} FROM {} WHERE org_id = ? AND {spalte} = ?",
                b.tabelle
            )))
            .bind(org_id)
            .bind(schluessel)
            .fetch_optional(&mut *conn)
            .await?
        }
        Schluessel::Org => {
            sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT {objekt} FROM {} WHERE org_id = ?",
                b.tabelle
            )))
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?
        }
    };
    let Some(text) = text else {
        return Ok(None);
    };
    let mut daten: Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("Stammdaten unlesbar: {e}")))?;
    if !b.unterlisten.is_empty() {
        let mut listen = serde_json::Map::new();
        for u in b.unterlisten {
            let sql = format!(
                "SELECT json_group_array(json(o)) FROM (SELECT {} AS o FROM {} \
                 WHERE {} = ? ORDER BY rowid LIMIT {UNTERLISTE_MAX})",
                art::json_object_sql(u.spalten, ""),
                u.tabelle,
                u.eltern_spalte
            );
            let text: String = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .bind(schluessel.parse::<i64>().unwrap_or(-1))
                .fetch_one(&mut *conn)
                .await?;
            listen.insert(
                u.tabelle.to_string(),
                serde_json::from_str(&text).unwrap_or(Value::Array(Vec::new())),
            );
        }
        daten["unterlisten"] = Value::Object(listen);
    }
    Ok(Some(daten))
}

/// Ob die Geheimnisse eines Kontos an diesen Empfänger dürfen (D6, D7), und wenn ja, welche.
async fn load_geheimnis(
    conn: &mut SqliteConnection,
    empfaenger: &Empfaenger<'_>,
    konto_id: i64,
) -> Result<Option<String>, AppError> {
    let Some(age) = empfaenger.age else {
        return Ok(None);
    };
    if !empfaenger.datentraeger_bestaetigt {
        return Ok(None);
    }
    let zeile: Option<(String, Option<String>, bool, String, bool)> = sqlx::query_as(
        "SELECT passwort_hash, totp_secret, totp_aktiviert, system_rolle, \
         EXISTS (SELECT 1 FROM webauthn_credential w WHERE w.benutzer_id = b.id) \
         FROM benutzer b WHERE id = ?",
    )
    .bind(konto_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((passwort_hash, totp_secret, totp_aktiviert, system_rolle, hat_passkey)) = zeile
    else {
        return Ok(None);
    };
    // Ein Admin-Hash ohne Passkey bliebe am Hub ein Weg hinein (D7).
    if system_rolle == crate::auth::ROLLE_ADMIN && !hat_passkey {
        return Ok(None);
    }
    let g = Geheimnis {
        passwort_hash,
        totp_secret,
        totp_aktiviert,
    };
    let Some(text) = geheimnis::encrypt(age, &g) else {
        return Ok(None);
    };
    sqlx::query(
        "INSERT INTO instanz_geheimnis_lieferung (kopplung_org_id, benutzer_id, geliefert_at) \
         VALUES (?, ?, ?) ON CONFLICT (kopplung_org_id, benutzer_id) \
         DO UPDATE SET geliefert_at = excluded.geliefert_at",
    )
    .bind(empfaenger.kopplung_org_id)
    .bind(konto_id)
    .bind(crate::zeit::jetzt())
    .execute(&mut *conn)
    .await?;
    Ok(Some(text))
}

async fn build_lieferung(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: StammdatenArt,
    schluessel: &str,
    stand: i64,
    empfaenger: &Empfaenger<'_>,
) -> Result<StammdatenLieferung, AppError> {
    let b = art::beschreibung(art);
    let daten = load_daten(conn, b, org_id, schluessel).await?;
    let geheimnis = match (art, &daten) {
        (StammdatenArt::Konto, Some(_)) => match schluessel.parse::<i64>() {
            Ok(id) => load_geheimnis(conn, empfaenger, id).await?,
            Err(_) => None,
        },
        _ => None,
    };
    Ok(StammdatenLieferung {
        art: art.as_str().to_string(),
        schluessel: schluessel.to_string(),
        stand,
        geloescht: daten.is_none(),
        daten,
        geheimnis,
    })
}

/// Alle Verweise einer gelieferten Zeile als (Art, Schlüssel an der Quelle).
pub fn verweise(art: StammdatenArt, daten: &Value) -> Vec<(StammdatenArt, String)> {
    let b = art::beschreibung(art);
    let mut aus: Vec<(StammdatenArt, String)> = Vec::new();
    for v in b.verweise {
        if let Some(id) = daten[v.spalte].as_i64() {
            aus.push((v.ziel, id.to_string()));
        }
    }
    if let Some(spalte) = b.quali_soll {
        for (q, _) in parse_quali_soll(&daten[spalte]) {
            aus.push((StammdatenArt::Qualifikation, q.to_string()));
        }
    }
    for u in b.unterlisten {
        for eintrag in daten["unterlisten"][u.tabelle]
            .as_array()
            .into_iter()
            .flatten()
        {
            for v in u.verweise {
                if let Some(id) = eintrag[v.spalte].as_i64() {
                    aus.push((v.ziel, id.to_string()));
                }
            }
        }
    }
    aus
}

/// Liest ein Qualifikationssoll in gespeicherter Form (`[{"q": id, "n": anzahl}]`, als Text in
/// der Spalte) als Paare.
pub fn parse_quali_soll(wert: &Value) -> Vec<(i64, i64)> {
    let Some(text) = wert.as_str() else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<Value>>(text)
        .unwrap_or_default()
        .iter()
        .filter_map(|e| Some((e["q"].as_i64()?, e["n"].as_i64()?)))
        .collect()
}

/// Nachlieferung der Org `org_id` seit `seit`, höchstens `budget` Zeilen, nur `arten` (D2).
pub async fn nachlieferung(
    conn: &mut SqliteConnection,
    org_id: i64,
    seit: i64,
    budget: usize,
    arten: &HashSet<StammdatenArt>,
    empfaenger: &Empfaenger<'_>,
) -> Result<Nachlieferung, AppError> {
    if budget == 0 || arten.is_empty() {
        return Ok(Nachlieferung {
            zeilen: Vec::new(),
            bis: seit,
        });
    }
    let arten_json = serde_json::to_string(&arten.iter().map(|a| a.as_str()).collect::<Vec<_>>())
        .expect("Arten sind serialisierbar");
    let log: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT stand, art, schluessel FROM stammdaten_aenderung \
         WHERE org_id = ? AND stand > ? AND art IN (SELECT value FROM json_each(?)) \
         ORDER BY stand LIMIT ?",
    )
    .bind(org_id)
    .bind(seit)
    .bind(&arten_json)
    .bind(budget as i64)
    .fetch_all(&mut *conn)
    .await?;
    let mut aus = Nachlieferung {
        zeilen: Vec::with_capacity(log.len()),
        bis: seit,
    };
    let mut drin: HashSet<(StammdatenArt, String)> = HashSet::new();
    for (stand, art_text, schluessel) in log {
        aus.bis = stand;
        let Some(art) = StammdatenArt::parse(&art_text) else {
            continue;
        };
        let l = build_lieferung(conn, org_id, art, &schluessel, stand, empfaenger).await?;
        drin.insert((art, schluessel));
        aus.zeilen.push(l);
    }
    // Abhängigkeiten, die die Gegenseite noch nicht haben kann (Stand über `seit`), kommen mit.
    // Ein Durchgang je Ebene; Verweise reichen höchstens drei Ebenen tief (Vorlage → Personal →
    // Konto/Qualifikation → Qualifikation).
    let mut offen: Vec<StammdatenLieferung> = aus.zeilen.clone();
    let mut abhaengige = 0usize;
    for _ in 0..4 {
        let mut neu = Vec::new();
        for l in &offen {
            let (Some(art), Some(daten)) = (StammdatenArt::parse(&l.art), &l.daten) else {
                continue;
            };
            for (ziel, schluessel) in verweise(art, daten) {
                if !arten.contains(&ziel) || drin.contains(&(ziel, schluessel.clone())) {
                    continue;
                }
                let stand: Option<i64> = sqlx::query_scalar(
                    "SELECT stand FROM stammdaten_aenderung \
                     WHERE org_id = ? AND art = ? AND schluessel = ? AND stand > ?",
                )
                .bind(org_id)
                .bind(ziel.as_str())
                .bind(&schluessel)
                .bind(seit)
                .fetch_optional(&mut *conn)
                .await?;
                drin.insert((ziel, schluessel.clone()));
                let Some(stand) = stand else { continue };
                if abhaengige >= ABHAENGIGE_MAX {
                    continue;
                }
                abhaengige += 1;
                neu.push(
                    build_lieferung(conn, org_id, ziel, &schluessel, stand, empfaenger).await?,
                );
            }
        }
        if neu.is_empty() {
            break;
        }
        aus.zeilen.extend(neu.iter().cloned());
        offen = neu;
    }
    Ok(aus)
}

#[cfg(test)]
mod tests;
