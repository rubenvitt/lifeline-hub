//! Übliche Arten der Organisation (LLH-1379, `/mnt/project-files/llh-1021/llh-1379/design.md`):
//! die Arten der Nachforderungen aus den anderen Einsätzen der Einsatz-Org, gezählt nur über
//! Einsätze, deren Nachforderungen der Benutzer selbst lesen dürfte (D1). Speist Schnellwahl und
//! Vorschläge der Erfassung; der laufende Einsatz zählt der Client selbst (D2).
use crate::auth::Benutzer;
use crate::einsatz::berechtigung::{darf_lesen, modul_freigabe};
use crate::einsatz::modul::{ModulMarker, Nachforderungen};
use crate::einsatz::modul_override::EinsatzModulOverride;
use crate::einsatz::{Einsatz, EinsatzRolle};
use crate::error::AppError;
use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

/// Höchstzahl der Einsätze, über die gezählt wird: die jüngsten nach Beginn (D6).
pub const ORG_ARTEN_EINSAETZE_MAX: i64 = 200;
/// Höchstzahl der Arten in der Antwort (D6).
pub const ORG_ARTEN_MAX: usize = 20;

/// Eine übliche Art der Organisation: Wortlaut der jüngsten Anforderung und die Zahl der
/// Einsätze, in denen sie vorkam. Bewusst ohne Einsatz-Kennung, Zeit oder Namen (D4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct NachforderungArtUeblich {
    pub art: String,
    pub einsaetze: i64,
}

/// Eine Zeile der gruppierten Zählung: je Einsatz und getrimmtem Wortlaut.
#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct ArtZeile {
    pub einsatz_id: i64,
    pub art: String,
    pub anzahl: i64,
    pub zuletzt: String,
    pub letzte_id: i64,
}

/// Faltet die Zeilen zur Rangfolge (D5): nach Zahl der Einsätze, dann Zahl der Nachforderungen,
/// dann jüngster Anforderung. Gleich ist, was sich nur in Groß-/Kleinschreibung unterscheidet;
/// es steht in der Schreibweise der jüngsten Anforderung. Rein.
pub(crate) fn rangfolge(zeilen: Vec<ArtZeile>, max: usize) -> Vec<NachforderungArtUeblich> {
    struct Je {
        art: String,
        einsaetze: HashSet<i64>,
        anzahl: i64,
        zuletzt: String,
        letzte_id: i64,
    }
    let mut je: HashMap<String, Je> = HashMap::new();
    for z in zeilen {
        let art = z.art.trim();
        if art.is_empty() || art == crate::einsatz::repo::SCHWAERZUNG_PLATZHALTER {
            continue;
        }
        let eintrag = je.entry(art.to_lowercase()).or_insert_with(|| Je {
            art: art.to_string(),
            einsaetze: HashSet::new(),
            anzahl: 0,
            zuletzt: z.zuletzt.clone(),
            letzte_id: z.letzte_id,
        });
        eintrag.einsaetze.insert(z.einsatz_id);
        eintrag.anzahl += z.anzahl;
        if (z.zuletzt.as_str(), z.letzte_id) > (eintrag.zuletzt.as_str(), eintrag.letzte_id) {
            eintrag.art = art.to_string();
            eintrag.zuletzt = z.zuletzt;
            eintrag.letzte_id = z.letzte_id;
        }
    }
    let mut liste: Vec<Je> = je.into_values().collect();
    liste.sort_by(|a, b| {
        b.einsaetze
            .len()
            .cmp(&a.einsaetze.len())
            .then(b.anzahl.cmp(&a.anzahl))
            .then_with(|| b.zuletzt.cmp(&a.zuletzt))
            .then(b.letzte_id.cmp(&a.letzte_id))
    });
    liste
        .into_iter()
        .take(max)
        .map(|j| NachforderungArtUeblich {
            art: j.art,
            einsaetze: j.einsaetze.len() as i64,
        })
        .collect()
}

/// Die üblichen Arten der Org von `einsatz` für `benutzer`, ohne `einsatz` selbst (D1–D6).
/// Vier Abfragen, unabhängig von der Zahl der Einsätze.
pub async fn uebliche_arten(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    einsatz: &Einsatz,
) -> Result<Vec<NachforderungArtUeblich>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Kandidat {
        id: i64,
        org_id: i64,
        status: String,
        abgeschlossen_at: Option<String>,
        retention_bis: Option<String>,
        geloescht_at: Option<String>,
        rolle: Option<String>,
    }
    let modul_key = Nachforderungen::KEY.expect("Nachforderungen ist ein Modul");

    // Vorfilter wie `einsatz::repo::liste_fuer`: ohne Fremdeinsatz-Lesezugriff nur über die
    // Mitgliedschaft. Die Zeit-Policy und die Modulfreigabe entscheidet danach `darf_lesen` bzw.
    // `modul_freigabe` — dieselben Funktionen wie hinter den Türen der Liste.
    let nur_mitglied = !benutzer.darf_fremdeinsatz_lesen(einsatz.org_id);
    let kandidaten: Vec<Kandidat> = sqlx::query_as(
        "SELECT e.id, e.org_id, e.status, e.abgeschlossen_at, e.retention_bis, e.geloescht_at, \
                m.einsatz_rolle AS rolle \
         FROM einsatz e \
         LEFT JOIN einsatz_mitgliedschaft m ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         WHERE e.org_id = ? AND e.id <> ? \
           AND (e.geloescht_at IS NULL OR e.geloescht_at = '') \
           AND (e.geschwaerzt_at IS NULL OR e.geschwaerzt_at = '') \
           AND (? = 0 OR m.benutzer_id IS NOT NULL) \
         ORDER BY e.begonnen_at DESC, e.id DESC \
         LIMIT ?",
    )
    .bind(benutzer.id)
    .bind(einsatz.org_id)
    .bind(einsatz.id)
    .bind(nur_mitglied)
    .bind(ORG_ARTEN_EINSAETZE_MAX)
    .fetch_all(pool)
    .await?;

    let jetzt = Utc::now();
    let lesbar: Vec<(i64, Option<EinsatzRolle>)> = kandidaten
        .into_iter()
        .filter_map(|k| {
            let rolle = k.rolle.as_deref().and_then(EinsatzRolle::parse);
            darf_lesen(
                benutzer,
                k.org_id,
                &k.status,
                k.abgeschlossen_at.as_deref(),
                k.retention_bis.as_deref(),
                k.geloescht_at.as_deref(),
                rolle,
                jetzt,
            )
            .then_some((k.id, rolle))
        })
        .collect();
    if lesbar.is_empty() {
        return Ok(Vec::new());
    }

    let ids = serde_json::to_string(&lesbar.iter().map(|(id, _)| *id).collect::<Vec<_>>())
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let org_vorgaben = crate::org::modul_einstellung::laden_alle(pool, einsatz.org_id).await?;
    let overrides: Vec<EinsatzModulOverride> = sqlx::query_as(
        "SELECT einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von \
         FROM einsatz_modul_override \
         WHERE modul_key = ? AND einsatz_id IN (SELECT value FROM json_each(?))",
    )
    .bind(modul_key)
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    let mut override_je: HashMap<i64, HashMap<String, EinsatzModulOverride>> = HashMap::new();
    for o in overrides {
        override_je
            .entry(o.einsatz_id)
            .or_default()
            .insert(o.modul_key.clone(), o);
    }
    let leer = HashMap::new();
    let freigegeben: Vec<i64> = lesbar
        .into_iter()
        .filter(|(id, rolle)| {
            modul_freigabe(
                override_je.get(id).unwrap_or(&leer),
                &org_vorgaben,
                modul_key,
                benutzer,
                einsatz.org_id,
                *rolle,
            )
            .zugriff
        })
        .map(|(id, _)| id)
        .collect();
    if freigegeben.is_empty() {
        return Ok(Vec::new());
    }

    let ids = serde_json::to_string(&freigegeben).map_err(|e| AppError::Internal(e.to_string()))?;
    let zeilen: Vec<ArtZeile> = sqlx::query_as(
        "SELECT einsatz_id, TRIM(art) AS art, COUNT(*) AS anzahl, \
                MAX(angefordert_at) AS zuletzt, MAX(id) AS letzte_id \
         FROM nachforderung \
         WHERE einsatz_id IN (SELECT value FROM json_each(?)) AND art <> ? \
         GROUP BY einsatz_id, TRIM(art)",
    )
    .bind(&ids)
    .bind(crate::einsatz::repo::SCHWAERZUNG_PLATZHALTER)
    .fetch_all(pool)
    .await?;
    Ok(rangfolge(zeilen, ORG_ARTEN_MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zeile(einsatz_id: i64, art: &str, anzahl: i64, zuletzt: &str, id: i64) -> ArtZeile {
        ArtZeile {
            einsatz_id,
            art: art.into(),
            anzahl,
            zuletzt: zuletzt.into(),
            letzte_id: id,
        }
    }

    #[test]
    fn viele_einsaetze_schlagen_viele_nachforderungen_in_einem() {
        let r = rangfolge(
            vec![
                zeile(1, "Sandsäcke", 40, "2026-10-01 10:00:00", 9),
                zeile(2, "RTW", 1, "2026-09-01 10:00:00", 3),
                zeile(3, "rtw", 1, "2026-09-02 10:00:00", 4),
            ],
            20,
        );
        assert_eq!(
            r,
            vec![
                NachforderungArtUeblich {
                    art: "rtw".into(),
                    einsaetze: 2
                },
                NachforderungArtUeblich {
                    art: "Sandsäcke".into(),
                    einsaetze: 1
                },
            ]
        );
    }

    #[test]
    fn gleichstand_entscheidet_die_zahl_dann_die_juengste() {
        let r = rangfolge(
            vec![
                zeile(1, "KTW", 1, "2026-10-02 10:00:00", 2),
                zeile(1, "NEF", 2, "2026-10-01 10:00:00", 1),
                zeile(2, "ELW 1", 1, "2026-10-03 10:00:00", 5),
            ],
            20,
        );
        let arten: Vec<_> = r.iter().map(|a| a.art.as_str()).collect();
        assert_eq!(arten, vec!["NEF", "ELW 1", "KTW"]);
    }

    #[test]
    fn platzhalter_und_leeres_zaehlen_nicht_und_die_grenze_greift() {
        let r = rangfolge(
            vec![
                zeile(
                    1,
                    crate::einsatz::repo::SCHWAERZUNG_PLATZHALTER,
                    5,
                    "2026-10-01 10:00:00",
                    1,
                ),
                zeile(1, "  ", 1, "2026-10-01 10:00:00", 2),
                zeile(1, "A", 1, "2026-10-01 10:00:00", 3),
                zeile(1, "B", 2, "2026-10-01 10:00:00", 4),
            ],
            1,
        );
        assert_eq!(
            r,
            vec![NachforderungArtUeblich {
                art: "B".into(),
                einsaetze: 1
            }]
        );
    }
}
