//! Bestand der Org für den Abgleich, in einem Rutsch auf der offenen Verbindung.

use std::collections::HashMap;

use sqlx::SqliteConnection;

use crate::error::AppError;
use crate::stammdaten_eingang::abgleich::{
    Bestand, BestandFahrzeug, BestandPersonal, BestandQualifikation, Kennungen,
};
use crate::stammdaten_eingang::StammdatenArt;

type FahrzeugZeile = (
    i64,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
);
type PersonalZeile = (
    i64,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
);
/// `(fahrzeug_id, personal_id, qualifikation_id, herkunft, kennung)`.
type KennungZeile = (Option<i64>, Option<i64>, Option<i64>, String, String);

/// Liest Fahrzeuge, Personal (samt Qualifikationen) und Qualifikationen der Org, jeweils mit
/// ihren Kennungen. Auch außer Dienst gestellte: eine Kennung, die sie trifft, lässt die Zeile
/// aus statt neu anzulegen. Eine Kennung zählt nur, wenn sie UND ihr Ziel zur Org gehören
/// (Org-Isolation auch gegen eine verirrte Zeile in `stammdaten_kennung`).
pub async fn bestand_tx(conn: &mut SqliteConnection, org_id: i64) -> Result<Bestand, AppError> {
    let fahrzeuge: Vec<FahrzeugZeile> = sqlx::query_as(
        "SELECT id, funkrufname, kennzeichen, opta, fms_issi, fahrzeugtyp, standort, \
                dienststatus = 'in_dienst' \
         FROM fahrzeug WHERE org_id = ? ORDER BY id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let personal: Vec<PersonalZeile> = sqlx::query_as(
        "SELECT id, name, personalnummer, telefon, traegerorganisation, \
                dienststatus = 'in_dienst' \
         FROM personal WHERE org_id = ? ORDER BY id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let zuordnung: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT pq.personal_id, pq.qualifikation_id FROM personal_qualifikation pq \
         JOIN personal p ON p.id = pq.personal_id \
         JOIN qualifikation q ON q.id = pq.qualifikation_id \
         WHERE p.org_id = ?1 AND q.org_id = ?1 ORDER BY pq.personal_id, pq.qualifikation_id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let qualifikationen: Vec<(i64, String, bool)> = sqlx::query_as(
        "SELECT id, label, aktiv <> 0 FROM qualifikation WHERE org_id = ? ORDER BY sortier, id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let kennungen: Vec<KennungZeile> = sqlx::query_as(
        "SELECT k.fahrzeug_id, k.personal_id, k.qualifikation_id, k.herkunft, k.kennung \
         FROM stammdaten_kennung k \
         LEFT JOIN fahrzeug f ON f.id = k.fahrzeug_id \
         LEFT JOIN personal p ON p.id = k.personal_id \
         LEFT JOIN qualifikation q ON q.id = k.qualifikation_id \
         WHERE k.org_id = ?1 AND (f.org_id = ?1 OR p.org_id = ?1 OR q.org_id = ?1) \
         ORDER BY k.id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;

    let belegt: Vec<(Option<i64>, Option<i64>, String, String)> = sqlx::query_as(
        "SELECT fahrzeug_id, personal_id, herkunft, kennung FROM stammdaten_kennung \
         WHERE org_id = ? ORDER BY id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let belegte_kennungen = belegt
        .into_iter()
        .map(|(f, p, h, k)| {
            let art = match (f, p) {
                (Some(_), _) => StammdatenArt::Fahrzeug,
                (_, Some(_)) => StammdatenArt::Personal,
                _ => StammdatenArt::Qualifikation,
            };
            (art, h, k)
        })
        .collect();

    let mut kf: HashMap<i64, Kennungen> = HashMap::new();
    let mut kp: HashMap<i64, Kennungen> = HashMap::new();
    let mut kq: HashMap<i64, Kennungen> = HashMap::new();
    for (f, p, q, h, k) in kennungen {
        let ziel = match (f, p, q) {
            (Some(id), _, _) => kf.entry(id),
            (_, Some(id), _) => kp.entry(id),
            (_, _, Some(id)) => kq.entry(id),
            _ => continue,
        };
        ziel.or_default().push((h, k));
    }
    let mut pq: HashMap<i64, Vec<i64>> = HashMap::new();
    for (p, q) in zuordnung {
        pq.entry(p).or_default().push(q);
    }

    Ok(Bestand {
        fahrzeuge: fahrzeuge
            .into_iter()
            .map(
                |(
                    id,
                    funkrufname,
                    kennzeichen,
                    opta,
                    fms_issi,
                    fahrzeugtyp,
                    standort,
                    in_dienst,
                )| {
                    BestandFahrzeug {
                        id,
                        funkrufname,
                        kennzeichen,
                        opta,
                        fms_issi,
                        fahrzeugtyp,
                        standort,
                        in_dienst,
                        kennungen: kf.remove(&id).unwrap_or_default(),
                    }
                },
            )
            .collect(),
        personal: personal
            .into_iter()
            .map(
                |(id, name, personalnummer, telefon, traegerorganisation, in_dienst)| {
                    BestandPersonal {
                        id,
                        name,
                        personalnummer,
                        telefon,
                        traegerorganisation,
                        in_dienst,
                        qualifikation_ids: pq.remove(&id).unwrap_or_default(),
                        kennungen: kp.remove(&id).unwrap_or_default(),
                    }
                },
            )
            .collect(),
        qualifikationen: qualifikationen
            .into_iter()
            .map(|(id, label, aktiv)| BestandQualifikation {
                id,
                label,
                aktiv,
                kennungen: kq.remove(&id).unwrap_or_default(),
            })
            .collect(),
        belegte_kennungen,
    })
}

/// Die jüngste in der Org gemerkte Herkunft (normalisiert), als Vorschlag fürs Hochladen.
pub async fn herkunft_vorschlag_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT herkunft FROM stammdaten_kennung WHERE org_id = ? AND herkunft <> '' \
         ORDER BY angelegt_at DESC, id DESC LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?)
}
