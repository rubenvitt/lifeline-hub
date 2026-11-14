//! Vorgaben: Rhythmus des Einsatzes und der Abschnitte, Planvorlage.

use super::*;

/// Was eine Schicht vom Einsatz liest (LLH-1122): die Kopie des Schichtmodells und Zone und
/// Darstellung des Einsatzes (`zeitdarstellung::zeitstil_laden`, Einsatz → Org → Vorgabe). In
/// der Zone gelten die Wechselzeiten, in der Darstellung stehen sie im ETB (LLH-1469).
pub(crate) struct EinsatzVorgabe {
    pub werte: Option<Werte>,
    pub stil: Zeitstil,
}

impl EinsatzVorgabe {
    /// Vorwarnzeit aller Schichten des Einsatzes.
    pub fn vorwarnung(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |w| w.vorwarnung_minuten)
    }

    /// Vorlauf des Planungshinweises aller Schichten des Einsatzes (LLH-1131): aus dem
    /// Schichtmodell, ohne eines [`PLANUNGSVORLAUF_VORGABE_MINUTEN`] (2 h).
    pub fn planungsvorlauf(&self) -> i64 {
        self.werte
            .as_ref()
            .map_or(PLANUNGSVORLAUF_VORGABE_MINUTEN, |w| {
                w.planungsvorlauf_minuten
            })
    }
}

pub(crate) async fn load_einsatz_vorgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<EinsatzVorgabe, AppError> {
    Ok(EinsatzVorgabe {
        werte: schichtmodell_repo::load_einsatz_tx(conn, einsatz_id)
            .await?
            .map(|(w, _)| w),
        stil: crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?,
    })
}

/// Setzt oder entfernt die Rhythmus-Vorgabe eines Abschnitts und zieht die laufenden
/// Schichten nach, die ihr folgen. `NotFound`, wenn der Abschnitt nicht zum Einsatz gehört.
/// Liefert den Entscheidungseintrag nur, wenn sich der Wert geändert hat.
pub async fn vorgabe_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    abschnitt_id: i64,
    benutzer_id: i64,
    rhythmus_minuten: Option<i64>,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let (abschnitt_name, vorher): (String, Option<i64>) = sqlx::query_as(
            "SELECT name, abloesung_rhythmus_minuten FROM einsatzabschnitt \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschnitt_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        if vorher == rhythmus_minuten {
            return Ok(None);
        }
        sqlx::query("UPDATE einsatzabschnitt SET abloesung_rhythmus_minuten = ? WHERE id = ?")
            .bind(rhythmus_minuten)
            .bind(abschnitt_id)
            .execute(&mut *conn)
            .await?;

        // Weitergabe: nur bei einem neuen Wert. Eine entfernte Vorgabe lässt den zuletzt
        // gültigen Rhythmus stehen (Spec: „Vorgabe entfernen").
        if let Some(neu) = rhythmus_minuten {
            let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
            let folgende: Vec<(i64, String, i64, String, bool, Option<i64>)> = sqlx::query_as(
                "SELECT a.id, a.beginn_at, a.einheit_id, a.faellig_at, a.faellig_laut_plan, \
                        a.plan_block_id \
                 FROM einsatz_abloesung a \
                 WHERE a.einsatz_id = ? AND a.abschnitt_id = ? AND a.status = 'laufend' \
                   AND a.rhythmus_quelle = 'abschnitt'",
            )
            .bind(einsatz_id)
            .bind(abschnitt_id)
            .fetch_all(&mut *conn)
            .await?;
            for (id, beginn_at, einheit_id, vorher_at, vorher_laut, plan_block_id) in folgende {
                // Der Plan überlagert die neue Rangfolge (LLH-1555): im Block bleibt seine
                // Fälligkeit, und er zieht weiter vor.
                let (faellig_at, laut_plan) = mit_plan_tx(
                    conn,
                    einsatz_id,
                    einheit_id,
                    &beginn_at,
                    plan_block_id,
                    faellig_oder_400(&beginn_at, neu)?,
                )
                .await?;
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ?, \
                        faellig_laut_plan = ? WHERE id = ?",
                )
                .bind(neu)
                .bind(&faellig_at)
                .bind(laut_plan)
                .bind(id)
                .execute(&mut *conn)
                .await?;
                if faellig_at == vorher_at && laut_plan == vorher_laut {
                    continue;
                }
                let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    id,
                    &name,
                    &faellig_at,
                    &vorgabe,
                    jetzt,
                )
                .await?;
            }
        }

        let inhalt = match (rhythmus_minuten, vorher) {
            (Some(n), Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt (vorher {}).",
                rhythmus_text(n),
                rhythmus_text(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus auf {} gesetzt.",
                rhythmus_text(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Abschnitt «{abschnitt_name}»: Rhythmus-Vorgabe aufgehoben (vorher {}).",
                rhythmus_text(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Die Vorlage des Besatzungswechsels aus dem Plan (LLH-1555, design.md D5). Die Folgeblöcke
/// sind der der Einheit und die der erbenden Untereinheiten, die am Wechsel (Fälligkeit, binnen
/// der Toleranz) beginnen; ihre Personen kommen in die Einheit ihres Blocks. Wer schon zur
/// Besatzung gehört (Einheit und Erben), bleibt; die übrige Besatzung geht. Stamm-Personal und
/// Helfer, die schon im Einsatz sind, stehen als Kraft des Einsatzes, sonst zur Übernahme.
/// Nur eine laufende Schicht laut Plan (422 sonst).
pub async fn plan_vorlage(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<AbloesungPlanVorlage, AppError> {
    let mut conn = pool.acquire().await?;
    let conn = &mut *conn;
    let roh = roh_tx(conn, einsatz_id, id).await?;
    if roh.status != AbloesungStatus::Laufend || !roh.faellig_laut_plan {
        return Err(AppError::UnprocessableEntity(
            "Die Schicht folgt keinem Block im Schichtplan".into(),
        ));
    }
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let einheiten: Vec<i64> = std::iter::once(roh.einheit_id)
        .chain(erben_von(&g, roh.einheit_id))
        .collect();
    let einheiten_json = crate::kraefte_disposition::ids_json(&einheiten);

    // Je Einheit der früheste Block am Wechsel, wie `kopplung::folgeblock_sql!`.
    #[derive(sqlx::FromRow)]
    struct Kommt {
        einheit_id: i64,
        personal_id: Option<i64>,
        helfer_id: Option<i64>,
        name: Option<String>,
        /// Die Kraft des Einsatzes, als die die Person schon da ist.
        kraft: Option<i64>,
        /// Sie kann nicht kommen (außer Dienst, entlassene Ad-hoc-Kraft).
        gesperrt: bool,
    }
    let kommen: Vec<Kommt> = sqlx::query_as(concat!(
        "WITH folge AS ( \
           SELECT e.value AS einheit_id, \
                  (SELECT f.id FROM einsatz_planschicht f \
                   WHERE f.einsatz_id = ?1 AND f.posten_art = 'einheit' \
                     AND f.einheit_id = e.value AND f.uhs_id IS NULL \
                     AND f.von >= ?3 AND f.von <= datetime(?3, ",
        crate::abloesung::schichtplan::kopplung::toleranz_sql!(),
        ") ORDER BY f.von, f.id LIMIT 1) AS block_id \
           FROM json_each(?2) e) \
         SELECT fo.einheit_id, pp.personal_id, pp.helfer_id, \
                COALESCE(st.name, ad.snap_name, h.name) AS name, \
                COALESCE(sk.id, CASE WHEN ad.beendet_at IS NULL THEN ad.id END, hk.id) AS kraft, \
                (st.id IS NOT NULL AND sk.id IS NULL AND st.dienststatus <> 'in_dienst') \
                  OR (ad.id IS NOT NULL AND ad.beendet_at IS NOT NULL) AS gesperrt \
         FROM folge fo \
         JOIN einsatz_planschicht_person pp ON pp.planschicht_id = fo.block_id \
         LEFT JOIN personal st ON st.id = pp.personal_id \
         LEFT JOIN einsatz_personal sk ON sk.personal_id = pp.personal_id \
              AND sk.einsatz_id = ?1 AND sk.beendet_at IS NULL \
         LEFT JOIN einsatz_personal ad ON ad.id = pp.einsatz_personal_id \
         LEFT JOIN einsatz_plan_helfer h ON h.id = pp.helfer_id \
         LEFT JOIN einsatz_personal hk ON hk.id = h.einsatz_personal_id AND hk.beendet_at IS NULL \
         ORDER BY CASE WHEN fo.einheit_id = ?4 THEN 0 ELSE 1 END, fo.einheit_id, pp.rowid",
    ))
    .bind(einsatz_id)
    .bind(&einheiten_json)
    .bind(&roh.faellig_at)
    .bind(roh.einheit_id)
    .fetch_all(&mut *conn)
    .await?;
    let folgeblock_id: Option<i64> = sqlx::query_scalar(concat!(
        "SELECT ",
        kopplung::folgeblock_sql!(),
        " FROM einsatz_abloesung a WHERE a.id = ?"
    ))
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    let besatzung: Vec<(i64, String)> = sqlx::query_as(
        "SELECT p.id, p.snap_name FROM einsatz_personal p \
         WHERE p.einsatz_id = ?1 AND p.beendet_at IS NULL \
           AND p.einheit_id IN (SELECT value FROM json_each(?2)) \
         ORDER BY p.id",
    )
    .bind(einsatz_id)
    .bind(&einheiten_json)
    .fetch_all(&mut *conn)
    .await?;

    let mut vorlage = AbloesungPlanVorlage {
        folgeblock_id,
        wechsel_at: roh.faellig_at.clone(),
        bleiben: Vec::new(),
        kommen: Vec::new(),
        gehen: Vec::new(),
        fehlen: Vec::new(),
    };
    let mut gesehen: HashSet<(u8, i64)> = HashSet::new();
    for k in kommen {
        let name = k.name.unwrap_or_default();
        if k.gesperrt {
            vorlage.fehlen.push(name);
            continue;
        }
        let (schluessel, eintrag) = match (k.kraft, k.personal_id, k.helfer_id) {
            (Some(kraft), ..) => (
                (0, kraft),
                PlanVorlageKommen {
                    personal_id: Some(kraft),
                    stamm_personal_id: None,
                    plan_helfer_id: None,
                    name,
                    einheit_id: k.einheit_id,
                },
            ),
            (None, Some(pid), _) => (
                (1, pid),
                PlanVorlageKommen {
                    personal_id: None,
                    stamm_personal_id: Some(pid),
                    plan_helfer_id: None,
                    name,
                    einheit_id: k.einheit_id,
                },
            ),
            (None, None, Some(hid)) => (
                (2, hid),
                PlanVorlageKommen {
                    personal_id: None,
                    stamm_personal_id: None,
                    plan_helfer_id: Some(hid),
                    name,
                    einheit_id: k.einheit_id,
                },
            ),
            // Eine Ad-hoc-Kraft ohne Zeile (gelöscht): der Plan verliert sie per CASCADE.
            (None, None, None) => continue,
        };
        if !gesehen.insert(schluessel) {
            continue;
        }
        match eintrag.personal_id {
            Some(kraft) if besatzung.iter().any(|(b, _)| *b == kraft) => {
                vorlage.bleiben.push(PlanVorlagePerson {
                    personal_id: kraft,
                    name: eintrag.name,
                });
            }
            _ => vorlage.kommen.push(eintrag),
        }
    }
    vorlage.gehen = besatzung
        .into_iter()
        .filter(|(b, _)| !vorlage.bleiben.iter().any(|p| p.personal_id == *b))
        .map(|(personal_id, name)| PlanVorlagePerson { personal_id, name })
        .collect();
    Ok(vorlage)
}

/// Vorgabe des Einsatzes (LLH-1122) samt wirksamer Vorwarnung und der Zahl der laufenden
/// Schichten, die ihr folgen.
pub async fn load_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<AbloesungEinsatzVorgabeAnzeige, AppError> {
    let schichtmodell = schichtmodell_repo::load_einsatz(pool, einsatz_id).await?;
    let laufende_schichten: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND status = 'laufend' AND rhythmus_quelle = 'einsatz'",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    Ok(AbloesungEinsatzVorgabeAnzeige {
        vorwarnung_minuten: schichtmodell
            .as_ref()
            .map_or(VORWARNUNG_VORGABE_MINUTEN, |m| m.vorwarnung_minuten),
        schichtmodell,
        laufende_schichten,
    })
}

/// Was die Einsatzvorgabe werden soll.
#[derive(Debug, Clone)]
pub enum EinsatzVorgabeInput {
    /// Kopie eines Schichtmodells der Organisation des Einsatzes (fremd oder unbekannt: 404).
    FromStammdaten(i64),
    /// Eigene Werte, von der Route geprüft.
    Werte(Werte),
    /// Keine Vorgabe mehr.
    Remove,
}

/// Setzt oder entfernt die Vorgabe des Einsatzes und zieht die laufenden Schichten nach: wer der
/// Einsatzvorgabe folgt, bekommt Rhythmus und Fälligkeit aus der neuen Regel; ändert sich die
/// Vorwarnung, wandern die Vorwarn-Fristen aller laufenden Schichten mit. Fristen über
/// `setze_auto_frist_tx` (wie bei der Abschnittsvorgabe). Eine entfernte Vorgabe lässt den
/// zuletzt gültigen Rhythmus stehen; die Vorwarnung fällt auf 30 min zurück. Liefert den
/// Entscheidungseintrag nur, wenn sich etwas geändert hat. Die Stammdaten bleiben unberührt.
pub async fn set_einsatz_vorgabe(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &EinsatzVorgabeInput,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    write_retry!(pool, |conn| {
        let neu = match eingabe {
            EinsatzVorgabeInput::FromStammdaten(id) => {
                let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
                Some(schichtmodell_repo::load_werte_tx(conn, org_id, *id).await?)
            }
            EinsatzVorgabeInput::Werte(w) => Some(w.clone()),
            EinsatzVorgabeInput::Remove => None,
        };
        let vorher = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        if vorher.werte == neu {
            return Ok(None);
        }
        schichtmodell_repo::set_einsatz_tx(conn, einsatz_id, neu.as_ref(), benutzer_id).await?;
        let vorgabe = EinsatzVorgabe {
            werte: neu.clone(),
            stil: vorher.stil,
        };
        let vorwarnung_geaendert = vorgabe.vorwarnung() != vorher.vorwarnung();
        let planungsvorlauf_geaendert = vorgabe.planungsvorlauf() != vorher.planungsvorlauf();

        #[derive(sqlx::FromRow)]
        struct Laufend {
            id: i64,
            einheit_id: i64,
            beginn_at: String,
            rhythmus_minuten: i64,
            #[sqlx(try_from = "String")]
            rhythmus_quelle: RhythmusQuelle,
            faellig_at: String,
            faellig_laut_plan: bool,
            plan_block_id: Option<i64>,
        }
        let laufende: Vec<Laufend> = sqlx::query_as(
            "SELECT id, einheit_id, beginn_at, rhythmus_minuten, rhythmus_quelle, faellig_at, \
                    faellig_laut_plan, plan_block_id \
             FROM einsatz_abloesung WHERE einsatz_id = ? AND status = 'laufend' ORDER BY id",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        for s in laufende {
            // Neu gerechnet wird nur, wer der neuen Vorgabe folgt. Eine entfernte Vorgabe lässt
            // die gespeicherte Fälligkeit sekundengenau stehen (Review PR #833).
            let (faellig_at, rhythmus, laut_plan) = match (s.rhythmus_quelle, &vorgabe.werte) {
                (RhythmusQuelle::Einsatz, Some(_)) => {
                    let (regulaer, rhythmus) = compute_faellig(
                        &s.beginn_at,
                        s.rhythmus_minuten,
                        s.rhythmus_quelle,
                        &vorgabe,
                    )?;
                    // Der Plan überlagert die neue Regel (LLH-1555).
                    let (faellig_at, laut_plan) = mit_plan_tx(
                        conn,
                        einsatz_id,
                        s.einheit_id,
                        &s.beginn_at,
                        s.plan_block_id,
                        regulaer,
                    )
                    .await?;
                    (faellig_at, rhythmus, laut_plan)
                }
                _ => (
                    s.faellig_at.clone(),
                    s.rhythmus_minuten,
                    s.faellig_laut_plan,
                ),
            };
            let faellig_geaendert = faellig_at != s.faellig_at;
            if faellig_geaendert
                || rhythmus != s.rhythmus_minuten
                || laut_plan != s.faellig_laut_plan
            {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ?, \
                        faellig_laut_plan = ? WHERE id = ?",
                )
                .bind(rhythmus)
                .bind(&faellig_at)
                .bind(laut_plan)
                .bind(s.id)
                .execute(&mut *conn)
                .await?;
            }
            if faellig_geaendert {
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                set_fristen_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    s.id,
                    &name,
                    &faellig_at,
                    &vorgabe,
                    jetzt,
                )
                .await?;
            } else if vorwarnung_geaendert || planungsvorlauf_geaendert {
                // Nur die geänderte Vorlauf-Frist wandert; die Fälligkeitsfrist bleibt (Review
                // PR #833), eine schon ausgelöste andere auch.
                let (name, _) = einheit_tx(conn, einsatz_id, s.einheit_id).await?;
                if vorwarnung_geaendert {
                    set_vorwarn_frist_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        s.id,
                        &name,
                        &faellig_at,
                        vorgabe.vorwarnung(),
                        jetzt,
                    )
                    .await?;
                }
                if planungsvorlauf_geaendert {
                    set_planung_frist_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        s.id,
                        &name,
                        &faellig_at,
                        vorgabe.planungsvorlauf(),
                        jetzt,
                    )
                    .await?;
                }
            }
        }

        let darstellung = vorher.stil.darstellung;
        let beschreibung =
            |w: &Werte| format!("«{}», {}", w.bezeichnung, modell_text(w, darstellung));
        let inhalt = match (&neu, &vorher.werte) {
            (Some(n), Some(v)) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt (vorher {}).",
                beschreibung(n),
                beschreibung(v)
            ),
            (Some(n), None) => format!(
                "Ablösung Einsatz: Schichtmodell {} gesetzt.",
                beschreibung(n)
            ),
            (None, Some(v)) => format!(
                "Ablösung Einsatz: Vorgabe aufgehoben (vorher {}).",
                beschreibung(v)
            ),
            (None, None) => unreachable!("gleiche Werte sind oben ausgestiegen"),
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        Ok(Some(etb_id))
    })
}

/// Ein Schichtmodell im ETB: Regel und Vorwarnung („Rhythmus 12 h, Vorwarnung 30 min“), die
/// Wechselzeiten in der Darstellung des Einsatzes.
pub(super) fn modell_text(w: &Werte, darstellung: Zeitdarstellung) -> String {
    format!(
        "{}, Vorwarnung {}",
        w.regel.text(darstellung),
        rhythmus_text(w.vorwarnung_minuten)
    )
}

/// Namen für ETB-Texte: „«A», «B»“.
pub(super) fn namen_text(abloeser: &[Abloeser]) -> String {
    abloeser
        .iter()
        .map(|a| format!("«{}»", a.name))
        .collect::<Vec<_>>()
        .join(", ")
}
