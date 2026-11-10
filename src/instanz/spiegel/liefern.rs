//! Liefern an der führenden Seite (design.md D5, D6): je Einsatz die Zeilen, deren Stand über dem
//! der spiegelnden Seite liegt, nach Stand und bis zum Budget, mit ihrem aktuellen Inhalt.
//! Verweist eine Zeile auf eine Zeile, die die Gegenseite noch nicht kennen kann, kommt diese mit.
//! Inhalte auf Abruf gehen nur als Größe und Prüfsumme hinaus (D8).

use super::abbildung;
use super::paket::{BlobAngabe, EinsatzLieferung, KontoAngabe, Zeile, ABHAENGIGE_MAX};
use super::schema::{self, Schema, Tabelle, Ziel};
use crate::error::AppError;
use crate::instanz::stammdaten::StammdatenArt;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;
use std::collections::{BTreeSet, HashMap, HashSet};

/// Wer liefert.
#[derive(Debug, Clone, Copy)]
pub struct Absender<'a> {
    /// Eigene Instanzkennung.
    pub kennung: &'a str,
    pub kopplung_id: i64,
    pub kopplung_org_id: i64,
    /// Diese Instanz meldet sich; dann übersetzt sie Stammdaten lokal → fremd (D5).
    pub meldend: bool,
}

/// Platz für Zeilen in einem Paket.
#[derive(Debug, Clone)]
pub struct Budget {
    pub bytes: usize,
    pub zeilen: usize,
    pub abhaengige: usize,
}

impl Budget {
    pub fn neu(bytes: usize) -> Self {
        Budget {
            bytes,
            zeilen: super::paket::ZEILEN_MAX,
            abhaengige: ABHAENGIGE_MAX,
        }
    }
}

/// Wie tief mitgelieferte Abhängigkeiten reichen (D6).
const TIEFE_MAX: usize = 4;

/// Ein Einsatz, den diese Instanz führt und an die Org-Zuordnung liefert.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Gefuehrt {
    pub id: i64,
    pub kennung: Option<String>,
    pub freigabestufe: String,
    pub status: String,
    pub org_id: i64,
}

/// Die Einsätze der Org, die diese Instanz führt und liefert (D6): aktive, und abgeschlossene,
/// solange die Gegenseite den Stand des Abschlusses noch nicht hat. Ohne Demo-Einsätze.
pub async fn list_gefuehrt(
    conn: &mut SqliteConnection,
    org_id: i64,
    staende: &HashMap<String, i64>,
) -> Result<Vec<Gefuehrt>, AppError> {
    let alle: Vec<Gefuehrt> = sqlx::query_as(
        "SELECT e.id, e.kennung, e.freigabestufe, e.status, e.org_id FROM einsatz e \
         WHERE e.org_id = ? AND e.spiegel = 0 AND e.geloescht_at IS NULL \
         AND NOT EXISTS (SELECT 1 FROM demo_import d WHERE d.einsatz_id = e.id) ORDER BY e.id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut ergebnis = Vec::new();
    for e in alle {
        if e.status == "aktiv" {
            ergebnis.push(e);
            continue;
        }
        let Some(stand) = e.kennung.as_ref().and_then(|k| staende.get(k)) else {
            continue;
        };
        let hoechster: Option<i64> =
            sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
                .bind(e.id)
                .fetch_one(&mut *conn)
                .await?;
        if hoechster.unwrap_or(0) > *stand {
            ergebnis.push(e);
        }
    }
    Ok(ergebnis)
}

/// Setzt die Kennung eines geführten Einsatzes beim ersten Liefern (D2).
pub async fn ensure_kennung(
    conn: &mut SqliteConnection,
    eigene_kennung: &str,
    e: &Gefuehrt,
) -> Result<String, AppError> {
    if let Some(k) = &e.kennung {
        return Ok(k.clone());
    }
    let k = format!("{eigene_kennung}/{}", e.id);
    sqlx::query("UPDATE einsatz SET kennung = ? WHERE id = ? AND kennung IS NULL")
        .bind(&k)
        .bind(e.id)
        .execute(&mut *conn)
        .await?;
    Ok(k)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `SELECT json_object(…) FROM <t> WHERE <schlüssel> = ?` über die gelieferten Spalten.
fn select_sql(t: &Tabelle) -> String {
    let teile: Vec<String> = t
        .spalten
        .iter()
        .map(|s| format!("'{0}', \"{0}\"", s.name))
        .collect();
    format!(
        "SELECT json_object({}) FROM {} WHERE {} = ?",
        teile.join(", "),
        t.name,
        t.schluessel.ausdruck(t.name)
    )
}

/// Lädt eine Zeile; `None`, wenn es sie nicht (mehr) gibt.
async fn load_zeile(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    schluessel: &str,
) -> Result<Option<(Map<String, Value>, Option<BlobAngabe>)>, AppError> {
    let text: Option<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(select_sql(t)))
        .bind(schluessel)
        .fetch_optional(&mut *conn)
        .await?;
    let Some(text) = text else {
        return Ok(None);
    };
    let Value::Object(daten) = serde_json::from_str(&text)
        .map_err(|e| AppError::Internal(format!("Zeile {} unlesbar: {e}", t.name)))?
    else {
        return Err(AppError::Internal(format!(
            "Zeile {} ist kein Objekt",
            t.name
        )));
    };
    let blob = match &t.blob {
        Some(spalte) => {
            let bytes: Option<Vec<u8>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT \"{spalte}\" FROM {} WHERE {} = ?",
                t.name,
                t.schluessel.ausdruck(t.name)
            )))
            .bind(schluessel)
            .fetch_one(&mut *conn)
            .await?;
            bytes.map(|b| BlobAngabe {
                groesse: b.len() as i64,
                sha256: hex(&Sha256::digest(&b)),
            })
        }
        None => None,
    };
    Ok(Some((daten, blob)))
}

/// Die Einsatzzeile, auf die eine Spalte verweist: `(Tabelle, Schlüssel)`.
pub fn einsatz_verweis(
    ziel: &Ziel,
    daten: &Map<String, Value>,
    wert: &Value,
) -> Option<(&'static str, String)> {
    let id = wert.as_i64()?;
    match ziel {
        Ziel::Einsatz(t) => Some((t, id.to_string())),
        Ziel::Polymorph { typ_spalte, ziele } => {
            let typ = daten.get(*typ_spalte)?.as_str()?;
            ziele
                .iter()
                .find(|(w, _)| *w == typ)
                .map(|(_, t)| (*t, id.to_string()))
        }
        _ => None,
    }
}

/// Übersetzt an der meldenden Seite Stammdaten lokal → fremd (D5); ohne Gegenstück `NULL` bzw.
/// der Eintrag entfällt.
async fn stammdaten_hinaus(
    conn: &mut SqliteConnection,
    a: &Absender<'_>,
    t: &Tabelle,
    daten: &mut Map<String, Value>,
) -> Result<(), AppError> {
    for s in &t.spalten {
        let Some(ziel) = &s.verweis else { continue };
        let Some(wert) = daten.get(&s.name).cloned() else {
            continue;
        };
        let neu = match ziel {
            Ziel::Stammdaten(art) => match wert.as_i64() {
                Some(id) => abbildung::stammdaten_fremd(conn, a.kopplung_org_id, *art, id)
                    .await?
                    .map_or(Value::Null, Value::from),
                None => wert,
            },
            Ziel::QualiSoll | Ziel::QualiListe => {
                let mut abbildung = HashMap::new();
                for q in quali_ids(&wert) {
                    let f = abbildung::stammdaten_fremd(
                        conn,
                        a.kopplung_org_id,
                        StammdatenArt::Qualifikation,
                        q,
                    )
                    .await?;
                    abbildung.insert(q, f);
                }
                quali_ersetzen(&wert, &abbildung)
            }
            _ => continue,
        };
        daten.insert(s.name.clone(), neu);
    }
    Ok(())
}

/// Die Qualifikationen in `quali_soll` (`[{"q": id, "n": anzahl}]`) oder einer Liste (`[id, …]`),
/// als JSON-Text oder Wert.
pub fn quali_ids(wert: &Value) -> Vec<i64> {
    let liste = match wert {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        w => w.clone(),
    };
    let Value::Array(liste) = liste else {
        return Vec::new();
    };
    liste
        .iter()
        .filter_map(|e| match e {
            Value::Number(n) => n.as_i64(),
            Value::Object(o) => o.get("q").and_then(Value::as_i64),
            _ => None,
        })
        .collect()
}

/// Ersetzt die Qualifikationen nach `abbildung`; Einträge ohne Gegenstück entfallen. Ergebnis ist
/// JSON-Text wie in der Spalte; ein Wert, der keine Liste ist, bleibt.
pub fn quali_ersetzen(wert: &Value, abbildung: &HashMap<i64, Option<i64>>) -> Value {
    let liste = match wert {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        w => w.clone(),
    };
    let Value::Array(liste) = liste else {
        return wert.clone();
    };
    let neu: Vec<Value> = liste
        .into_iter()
        .filter_map(|e| match e {
            Value::Number(n) => n
                .as_i64()
                .and_then(|q| abbildung.get(&q).copied().flatten())
                .map(Value::from),
            Value::Object(mut o) => {
                let q = o.get("q").and_then(Value::as_i64)?;
                let z = abbildung.get(&q).copied().flatten()?;
                o.insert("q".into(), Value::from(z));
                Some(Value::Object(o))
            }
            _ => None,
        })
        .collect();
    Value::String(Value::Array(neu).to_string())
}

/// Die Konten, auf die die Zeilen verweisen, mit Anzeigename und, an der meldenden Seite, der
/// Kennung beim Gegenüber (D5).
async fn konten(
    conn: &mut SqliteConnection,
    schema: &Schema,
    a: &Absender<'_>,
    zeilen: &[Zeile],
) -> Result<Vec<KontoAngabe>, AppError> {
    let mut ids = BTreeSet::new();
    for z in zeilen {
        let (Some(t), Some(Value::Object(d))) = (schema.tabelle(&z.art), &z.daten) else {
            continue;
        };
        for s in &t.spalten {
            if s.verweis == Some(Ziel::Konto) {
                if let Some(id) = d.get(&s.name).and_then(Value::as_i64) {
                    ids.insert(id);
                }
            }
        }
    }
    let mut ergebnis = Vec::with_capacity(ids.len());
    for id in ids {
        let name: Option<String> =
            sqlx::query_scalar("SELECT anzeigename FROM benutzer WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?;
        let gegen_id = if a.meldend {
            abbildung::stammdaten_fremd(conn, a.kopplung_org_id, StammdatenArt::Konto, id).await?
        } else {
            None
        };
        let gegen_id = match gegen_id {
            Some(g) => Some(g),
            None => abbildung::stellvertreter_fremd(conn, a.kopplung_id, id).await?,
        };
        ergebnis.push(KontoAngabe {
            id,
            anzeigename: name.unwrap_or_default(),
            gegen_id,
        });
    }
    Ok(ergebnis)
}

/// Eine Zeile als [`Zeile`], gelöscht oder mit Inhalt.
async fn baue_zeile(
    conn: &mut SqliteConnection,
    a: &Absender<'_>,
    t: &Tabelle,
    schluessel: &str,
    stand: i64,
) -> Result<Zeile, AppError> {
    let geladen = load_zeile(conn, t, schluessel).await?;
    let (daten, blob, geloescht) = match geladen {
        Some((mut daten, blob)) => {
            if a.meldend {
                stammdaten_hinaus(conn, a, t, &mut daten).await?;
            }
            (Some(Value::Object(daten)), blob, false)
        }
        None => (None, None, true),
    };
    Ok(Zeile {
        art: t.name.to_string(),
        schluessel: schluessel.to_string(),
        stand,
        kategorie: t.kategorie.as_str().to_string(),
        geloescht,
        daten,
        blob,
    })
}

/// Liefert einen Einsatz seit `seit` (D6). `None`, wenn es nichts Neues gibt oder das Budget
/// erschöpft ist.
pub async fn liefere_einsatz(
    conn: &mut SqliteConnection,
    a: &Absender<'_>,
    e: &Gefuehrt,
    kennung: &str,
    org_wire: &str,
    seit: i64,
    budget: &mut Budget,
) -> Result<Option<EinsatzLieferung>, AppError> {
    if budget.zeilen == 0 || budget.bytes == 0 {
        return Ok(None);
    }
    let schema = schema::schema(conn).await?;
    let log: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT art, schluessel, stand FROM einsatz_aenderung \
         WHERE einsatz_id = ? AND stand > ? ORDER BY stand LIMIT ?",
    )
    .bind(e.id)
    .bind(seit)
    .bind(budget.zeilen as i64)
    .fetch_all(&mut *conn)
    .await?;
    if log.is_empty() {
        return Ok(None);
    }
    let mut zeilen = Vec::new();
    let mut bis = seit;
    let mut drin: HashSet<(String, String)> = HashSet::new();
    for (art, schluessel, stand) in log {
        let Some(t) = schema.tabelle(&art) else {
            bis = stand;
            continue;
        };
        let z = baue_zeile(conn, a, t, &schluessel, stand).await?;
        let groesse = serde_json::to_vec(&z).map(|v| v.len()).unwrap_or(0);
        // Eine einzelne übergroße Zeile geht, wenn sie die erste des Pakets ist.
        if groesse > budget.bytes
            && !(zeilen.is_empty() && budget.zeilen == super::paket::ZEILEN_MAX)
        {
            break;
        }
        budget.bytes = budget.bytes.saturating_sub(groesse);
        budget.zeilen -= 1;
        drin.insert((art, schluessel));
        zeilen.push(z);
        bis = stand;
        if budget.zeilen == 0 || budget.bytes == 0 {
            break;
        }
    }
    if zeilen.is_empty() {
        if bis > seit {
            // Nur Zeilen unbekannter Tabellen: der Stand rückt trotzdem vor.
            return Ok(Some(leere_lieferung(e, kennung, org_wire, seit, bis)));
        }
        return Ok(None);
    }
    abhaengige(conn, schema, a, e.id, bis, &mut zeilen, &mut drin, budget).await?;
    let konten = konten(conn, schema, a, &zeilen).await?;
    Ok(Some(EinsatzLieferung {
        kennung: kennung.to_string(),
        org: org_wire.to_string(),
        org_id: e.org_id,
        freigabestufe: e.freigabestufe.clone(),
        seit,
        bis,
        zeilen,
        konten,
    }))
}

fn leere_lieferung(
    e: &Gefuehrt,
    kennung: &str,
    org_wire: &str,
    seit: i64,
    bis: i64,
) -> EinsatzLieferung {
    EinsatzLieferung {
        kennung: kennung.to_string(),
        org: org_wire.to_string(),
        org_id: e.org_id,
        freigabestufe: e.freigabestufe.clone(),
        seit,
        bis,
        ..Default::default()
    }
}

/// Liefert Zeilen mit, auf die gelieferte Zeilen verweisen und deren Stand über `bis` liegt: die
/// Gegenseite kennt sie noch nicht (D6). Höchstens [`TIEFE_MAX`] Ebenen.
#[allow(clippy::too_many_arguments)]
async fn abhaengige(
    conn: &mut SqliteConnection,
    schema: &Schema,
    a: &Absender<'_>,
    einsatz_id: i64,
    bis: i64,
    zeilen: &mut Vec<Zeile>,
    drin: &mut HashSet<(String, String)>,
    budget: &mut Budget,
) -> Result<(), AppError> {
    let mut von = 0;
    for _ in 0..TIEFE_MAX {
        let bis_jetzt = zeilen.len();
        let mut neu = Vec::new();
        for z in &zeilen[von..] {
            let (Some(t), Some(Value::Object(d))) = (schema.tabelle(&z.art), &z.daten) else {
                continue;
            };
            for s in &t.spalten {
                let (Some(ziel), Some(w)) = (&s.verweis, d.get(&s.name)) else {
                    continue;
                };
                if let Some(v) = einsatz_verweis(ziel, d, w) {
                    neu.push(v);
                }
            }
        }
        for (art, schluessel) in neu {
            if budget.abhaengige == 0 || drin.contains(&(art.to_string(), schluessel.clone())) {
                continue;
            }
            let stand: Option<i64> = sqlx::query_scalar(
                "SELECT stand FROM einsatz_aenderung WHERE einsatz_id = ? AND art = ? AND schluessel = ?",
            )
            .bind(einsatz_id)
            .bind(art)
            .bind(&schluessel)
            .fetch_optional(&mut *conn)
            .await?;
            let Some(stand) = stand.filter(|s| *s > bis) else {
                continue;
            };
            let Some(t) = schema.tabelle(art) else {
                continue;
            };
            let z = baue_zeile(conn, a, t, &schluessel, stand).await?;
            if z.geloescht {
                continue;
            }
            budget.abhaengige -= 1;
            drin.insert((art.to_string(), schluessel));
            zeilen.push(z);
        }
        if zeilen.len() == bis_jetzt {
            break;
        }
        von = bis_jetzt;
    }
    Ok(())
}
