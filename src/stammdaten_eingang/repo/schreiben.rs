//! Schreibt eine übernehmbare [`Planung`] auf der offenen Verbindung (öffnet und committet
//! nichts). Änderungen an bestehenden Datensätzen sind gezielte UPDATEs nur der übernommenen
//! Spalten; `fahrzeug` und `personal` tragen keine Änderungszeit, die Verteilung an gekoppelte
//! Instanzen merken die Trigger aus `0306_stammdaten_verteilung.sql`.

use std::collections::HashMap;

use sqlx::SqliteConnection;

use super::planen::{QualiZiel, Ziel};
use super::{Planung, StammdatenErgebnis};
use crate::einlesen::namen::norm;
use crate::error::AppError;
use crate::fahrzeug::repo::{self as fahrzeug_repo, FahrzeugDaten};
use crate::personal::qualifikation_repo;
use crate::personal::repo::{self as personal_repo, PersonalDaten};

/// Spalten, die der Eingang ändern darf; jede andere wäre ein Programmfehler.
const FAHRZEUG_SPALTEN: &[&str] = &[
    "funkrufname",
    "kennzeichen",
    "opta",
    "fms_issi",
    "fahrzeugtyp",
    "standort",
];
const PERSONAL_SPALTEN: &[&str] = &["name", "personalnummer", "telefon", "traegerorganisation"];

async fn spalten_setzen(
    conn: &mut SqliteConnection,
    tabelle: &str,
    erlaubt: &[&str],
    org_id: i64,
    id: i64,
    setzen: &[(&'static str, String)],
) -> Result<(), AppError> {
    if setzen.is_empty() {
        return Ok(());
    }
    if let Some((s, _)) = setzen.iter().find(|(s, _)| !erlaubt.contains(s)) {
        return Err(AppError::Internal(format!("Spalte {s} ist nicht änderbar")));
    }
    let liste = setzen
        .iter()
        .map(|(s, _)| format!("{s} = ?"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("UPDATE {tabelle} SET {liste} WHERE id = ? AND org_id = ?");
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, w) in setzen {
        q = q.bind(w);
    }
    let r = q.bind(id).bind(org_id).execute(&mut *conn).await?;
    if r.rows_affected() != 1 {
        return Err(AppError::Internal(format!(
            "{tabelle} {id} nicht in der Organisation"
        )));
    }
    Ok(())
}

async fn kennung_schreiben(
    conn: &mut SqliteConnection,
    org_id: i64,
    spalte: &str,
    ziel: i64,
    (herkunft, kennung): &(String, String),
    jetzt: &str,
) -> Result<(), AppError> {
    let sql = format!(
        "INSERT INTO stammdaten_kennung (org_id, herkunft, kennung, {spalte}, angelegt_at) \
         VALUES (?, ?, ?, ?, ?)"
    );
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(org_id)
        .bind(herkunft)
        .bind(kennung.trim())
        .bind(ziel)
        .bind(jetzt)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Schreibt die Planung. Fehlende Herkunft → 400, nicht übernehmbar → 422 mit Zeilen. Liefert
/// die Zählung und die Ids der angelegten oder geänderten Fahrzeuge.
pub async fn write_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung: &Planung,
    jetzt: &str,
) -> Result<(StammdatenErgebnis, Vec<i64>), AppError> {
    if planung.vorschau.herkunft_noetig {
        return Err(AppError::Validation(
            "Herkunft angeben: Zeilen mit Kennung brauchen eine Herkunft".into(),
        ));
    }
    if !planung.vorschau.uebernehmbar {
        return Err(AppError::Zeilen {
            meldung: "Die Stammdaten haben Fehler oder offene Entscheidungen; nichts übernommen"
                .into(),
            zeilen: planung.sperren.clone(),
        });
    }

    // Qualifikationen zuerst: das Personal bekommt ihre Ids.
    let mut q_ids: Vec<Option<i64>> = Vec::with_capacity(planung.qualifikationen.len());
    let mut angelegt: HashMap<String, i64> = HashMap::new();
    for q in &planung.qualifikationen {
        let id = match q.ziel {
            QualiZiel::Id(id) => Some(id),
            QualiZiel::Neu => Some(match angelegt.get(&norm(&q.label)) {
                Some(id) => *id,
                None => {
                    let sortier: i64 = sqlx::query_scalar(
                        "SELECT COALESCE(MAX(sortier), 0) + 10 FROM qualifikation WHERE org_id = ?",
                    )
                    .bind(org_id)
                    .fetch_one(&mut *conn)
                    .await?;
                    let id = qualifikation_repo::anlegen_tx(conn, org_id, &q.label, sortier, None)
                        .await?
                        .id;
                    angelegt.insert(norm(&q.label), id);
                    id
                }
            }),
            QualiZiel::Aus | QualiZiel::Offen | QualiZiel::Fehler => None,
        };
        if let Some(id) = id {
            for k in &q.kennungen {
                // Mehrere Kennungen je Qualifikation sind erlaubt. Eine, die schon gemerkt oder
                // in der Datei doppelt ist, hat `planen` ausgesondert; ein Konflikt hier ist ein
                // Programmfehler und bricht die Transaktion ab, statt still zu verwerfen.
                sqlx::query(
                    "INSERT INTO stammdaten_kennung \
                        (org_id, herkunft, kennung, qualifikation_id, angelegt_at) \
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(org_id)
                .bind(&q.herkunft)
                .bind(k.trim())
                .bind(id)
                .bind(jetzt)
                .execute(&mut *conn)
                .await?;
            }
        }
        q_ids.push(id);
    }

    let mut fahrzeug_ids = Vec::new();
    for f in &planung.fahrzeuge {
        let a = &f.angabe;
        let id = match f.ziel {
            Ziel::Neu => {
                let id = fahrzeug_repo::anlegen_tx(
                    conn,
                    org_id,
                    &FahrzeugDaten {
                        funkrufname: a.funkrufname.trim(),
                        fahrzeugtyp: a.typ.as_deref(),
                        traegerorganisation: None,
                        kennzeichen: a.kennzeichen.as_deref(),
                        opta: a.opta.as_deref(),
                        standort: a.standort.as_deref(),
                        fms_issi: a.issi.as_deref(),
                        sondersignal: false,
                        tragenkapazitaet: None,
                        staerke: None,
                        bemerkung: None,
                    },
                )
                .await?
                .id;
                fahrzeug_ids.push(id);
                id
            }
            Ziel::Bestand(id) => {
                spalten_setzen(conn, "fahrzeug", FAHRZEUG_SPALTEN, org_id, id, &f.setzen).await?;
                if !f.setzen.is_empty() {
                    fahrzeug_ids.push(id);
                }
                id
            }
        };
        if let Some(k) = &f.kennung {
            kennung_schreiben(conn, org_id, "fahrzeug_id", id, k, jetzt).await?;
        }
    }

    for p in &planung.personal {
        let a = &p.angabe;
        let quali: Vec<i64> = p.qualifikationen.iter().filter_map(|i| q_ids[*i]).collect();
        let id = match p.ziel {
            Ziel::Neu => {
                personal_repo::anlegen_tx(
                    conn,
                    org_id,
                    &PersonalDaten {
                        name: a.name.trim(),
                        benutzer_id: None,
                        personalnummer: a.personalnummer.as_deref(),
                        traegerorganisation: a.traegerorganisation.as_deref(),
                        telefon: a.telefon.as_deref(),
                        staerke_position: None,
                        bemerkung: None,
                    },
                    &quali,
                )
                .await?
                .id
            }
            Ziel::Bestand(id) => {
                spalten_setzen(conn, "personal", PERSONAL_SPALTEN, org_id, id, &p.setzen).await?;
                // Nur hinzufügen, nie entfernen; nur Qualifikationen der eigenen Org.
                let ids = serde_json::to_string(&quali)
                    .map_err(|e| AppError::Internal(format!("Qualifikations-ids: {e}")))?;
                sqlx::query(
                    "INSERT OR IGNORE INTO personal_qualifikation (personal_id, qualifikation_id) \
                     SELECT ?, id FROM qualifikation \
                     WHERE org_id = ? AND id IN (SELECT value FROM json_each(?))",
                )
                .bind(id)
                .bind(org_id)
                .bind(ids)
                .execute(&mut *conn)
                .await?;
                id
            }
        };
        if let Some(k) = &p.kennung {
            kennung_schreiben(conn, org_id, "personal_id", id, k, jetzt).await?;
        }
    }

    Ok((
        StammdatenErgebnis {
            zaehlung: planung.vorschau.zaehlung,
        },
        fahrzeug_ids,
    ))
}
