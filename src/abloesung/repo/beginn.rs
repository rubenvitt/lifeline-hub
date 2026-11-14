//! Schicht beginnen und ändern.

use super::*;

/// Legt eine laufende Schicht an und setzt ihre Fristen. Rhythmus und Fälligkeit rechnet
/// [`compute_faellig`] aus der Quelle, der Schichtplan der Einheit überlagert sie (LLH-1555);
/// `plan_block_id` ist der Block, in den ein Vollzug aus dem Plan wechselt. Liefert die neue ID
/// und den Rhythmus.
#[allow(clippy::too_many_arguments)]
pub(super) async fn create_schicht_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    einheit_name: &str,
    abschnitt_id: Option<i64>,
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
    vorgaenger_id: Option<i64>,
    beginn_quelle: BeginnQuelle,
    plan_block_id: Option<i64>,
    jetzt: &str,
) -> Result<(i64, i64), AppError> {
    if has_laufende_tx(conn, einheit_id).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "Einheit «{einheit_name}» hat bereits eine laufende Schicht"
        )));
    }
    let (regulaer, rhythmus) = compute_faellig(beginn_at, rhythmus, quelle, vorgabe)?;
    let (faellig_at, laut_plan) = mit_plan_tx(
        conn,
        einsatz_id,
        einheit_id,
        beginn_at,
        plan_block_id,
        regulaer,
    )
    .await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_abloesung \
            (einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle, \
             faellig_at, vorgaenger_id, angelegt_von_id, beginn_quelle, faellig_laut_plan, \
             plan_block_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(abschnitt_id)
    .bind(beginn_at)
    .bind(rhythmus)
    .bind(quelle.as_str())
    .bind(&faellig_at)
    .bind(vorgaenger_id)
    .bind(benutzer_id)
    .bind(beginn_quelle.as_str())
    .bind(laut_plan)
    .bind(plan_block_id)
    .fetch_one(&mut *conn)
    .await?;
    set_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        &faellig_at,
        vorgabe,
        jetzt,
    )
    .await?;
    Ok((id, rhythmus))
}

// ── Schreibpfade ────────────────────────────────────────────────────────────────────────────

/// Schicht beginnen. Rangfolge (LLH-1122): eigener Rhythmus → Vorgabe des Abschnitts der
/// Einheit → Vorgabe des Einsatzes; fehlt alles, ist das ein fehlender Pflichtwert → 400
/// (Spec: „Ungültiger Rhythmus").
pub async fn beginnen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &BeginnEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (id, etb_id) = write_retry!(pool, |conn| {
        let beginn_at = match &eingabe.beginn_at {
            Some(b) => b.clone(),
            None => crate::zeitachse::repo::offenes_eintreffen_tx(conn, eingabe.einheit_id)
                .await?
                .unwrap_or_else(|| jetzt.to_string()),
        };
        start_schicht_tx(
            conn,
            &Start {
                einsatz_id,
                benutzer_id,
                startwert,
                einheit_id: eingabe.einheit_id,
                beginn_at: &beginn_at,
                rhythmus_minuten: eingabe.rhythmus_minuten,
                wie: "begonnen",
                beginn_quelle: BeginnQuelle::Hand,
            },
            jetzt,
        )
        .await?
        .ok_or_else(|| {
            AppError::Validation(
                "rhythmus_minuten fehlt, und weder der Abschnitt der Einheit noch der Einsatz \
                 hat eine Vorgabe"
                    .into(),
            )
        })
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}

/// Was der Beginn einer Schicht braucht — von Hand ([`beginnen`]) oder mit dem Eintreffen
/// ([`crate::abloesung::kopplung`]).
pub(crate) struct Start<'a> {
    pub einsatz_id: i64,
    pub benutzer_id: i64,
    pub startwert: i64,
    pub einheit_id: i64,
    pub beginn_at: &'a str,
    /// `None` = Vorgabe übernehmen: die des Abschnitts, sonst die des Einsatzes.
    pub rhythmus_minuten: Option<i64>,
    /// Wie der ETB-Eintrag den Beginn nennt („begonnen“, „mit dem Eintreffen begonnen“).
    pub wie: &'a str,
    /// Herkunft an der Schicht (LLH-1312): `hand` oder `eintreffen`.
    pub beginn_quelle: BeginnQuelle,
}

/// Beginnt eine Schicht in der Transaktion des Aufrufers. Rangfolge (LLH-1122): eigener
/// Rhythmus → Vorgabe des Abschnitts der Einheit → Vorgabe des Einsatzes. `None`, wenn es
/// nichts davon gibt (keine erfundene Zahl): der Handweg macht daraus eine 400, der Autostart
/// legt nichts an. Sonst Schicht samt Fristen und ETB-Eintrag mit der Herkunft; liefert ihre ID
/// und die des ETB-Eintrags.
pub(crate) async fn start_schicht_tx(
    conn: &mut SqliteConnection,
    s: &Start<'_>,
    jetzt: &str,
) -> Result<Option<(i64, i64)>, AppError> {
    let (name, abschnitt_id) = einheit_tx(conn, s.einsatz_id, s.einheit_id).await?;
    let abschnitt = match abschnitt_id {
        Some(a) => abschnitt_tx(conn, a).await?,
        None => None,
    };
    let vorgabe = load_einsatz_vorgabe_tx(conn, s.einsatz_id).await?;
    let (rhythmus, quelle) = match (s.rhythmus_minuten, &abschnitt, &vorgabe.werte) {
        (Some(r), _, _) => (r, RhythmusQuelle::Einheit),
        (None, Some((_, Some(v))), _) => (*v, RhythmusQuelle::Abschnitt),
        // Der Rhythmus folgt aus der Regel der Einsatzvorgabe (`compute_faellig`).
        (None, _, Some(_)) => (0, RhythmusQuelle::Einsatz),
        (None, _, None) => return Ok(None),
    };
    let (id, rhythmus) = create_schicht_tx(
        conn,
        s.einsatz_id,
        s.benutzer_id,
        s.einheit_id,
        &name,
        abschnitt_id,
        s.beginn_at,
        rhythmus,
        quelle,
        &vorgabe,
        None,
        s.beginn_quelle,
        None,
        jetzt,
    )
    .await?;
    let herkunft = match (quelle, &abschnitt, &vorgabe.werte) {
        (RhythmusQuelle::Abschnitt, Some((a, _)), _) => format!(" (Vorgabe Abschnitt «{a}»)"),
        (RhythmusQuelle::Einsatz, _, Some(w)) => {
            format!(" (Vorgabe Einsatz «{}»)", w.bezeichnung)
        }
        _ => String::new(),
    };
    let etb_id = crate::etb::system_audit_tx(
        conn,
        s.einsatz_id,
        s.benutzer_id,
        s.startwert,
        &format!(
            "Ablösung: Schicht von «{name}» {}, Rhythmus {}{herkunft}",
            s.wie,
            rhythmus_label(rhythmus, quelle, &vorgabe)
        ),
    )
    .await?;
    Ok(Some((id, etb_id)))
}

/// Schicht ändern (Beginn, Rhythmus, geplante ablösende Einheit). Liefert den ETB-Eintrag nur,
/// wenn sich etwas geändert hat.
pub async fn aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &AenderungEingabe,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, Option<i64>), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let etb_id = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(nicht_laufend(
                roh.status,
                "lässt sich nicht ändern",
            )));
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
        let mut teile: Vec<String> = Vec::new();

        // Laut Plan gibt der Block die Fälligkeit (LLH-1555, design.md D3): wer abweichen will,
        // ändert den Block.
        if roh.faellig_laut_plan
            && matches!(eingabe.rhythmus_minuten, Some(Some(r))
                if r != roh.rhythmus_minuten || roh.rhythmus_quelle != RhythmusQuelle::Einheit)
        {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht folgt dem Schichtplan".into(),
            ));
        }

        // Rhythmus. Zurück zur Vorgabe heißt: die des Abschnitts, sonst die des Einsatzes.
        let (rhythmus, quelle) = match eingabe.rhythmus_minuten {
            None => (roh.rhythmus_minuten, roh.rhythmus_quelle),
            Some(Some(r)) => (r, RhythmusQuelle::Einheit),
            Some(None) => {
                let abschnitt = match roh.abschnitt_id {
                    Some(a) => abschnitt_tx(conn, a).await?.and_then(|(_, v)| v),
                    None => None,
                };
                match (abschnitt, &vorgabe.werte) {
                    (Some(v), _) => (v, RhythmusQuelle::Abschnitt),
                    (None, Some(_)) => (roh.rhythmus_minuten, RhythmusQuelle::Einsatz),
                    (None, None) => {
                        return Err(AppError::UnprocessableEntity(
                            "Weder der Abschnitt der Schicht noch der Einsatz hat eine \
                             Rhythmus-Vorgabe"
                                .into(),
                        ))
                    }
                }
            }
        };

        // Beginn
        let beginn_at = eingabe.beginn_at.clone().unwrap_or(roh.beginn_at.clone());
        // Ohne neuen Beginn und ohne Rhythmusangabe bleibt die gespeicherte Fälligkeit: nach einer
        // entfernten Wechselzeiten-Vorgabe ergäbe Beginn + aufgerundeter Rhythmus sonst eine um
        // Sekunden verschobene Fälligkeit samt neu gesetzter Fristen (Review PR #833).
        let (faellig_at, rhythmus, laut_plan) =
            if eingabe.rhythmus_minuten.is_none() && beginn_at == roh.beginn_at {
                (
                    roh.faellig_at.clone(),
                    roh.rhythmus_minuten,
                    roh.faellig_laut_plan,
                )
            } else {
                let (regulaer, rhythmus) = compute_faellig(&beginn_at, rhythmus, quelle, &vorgabe)?;
                let (faellig_at, laut_plan) = mit_plan_tx(
                    conn,
                    einsatz_id,
                    roh.einheit_id,
                    &beginn_at,
                    roh.plan_block_id,
                    regulaer,
                )
                .await?;
                (faellig_at, rhythmus, laut_plan)
            };
        // Bei der Einsatzvorgabe folgt der Rhythmus der Regel; ändert ihn nur der Beginn
        // (Wechselzeiten), ist das keine Rhythmusänderung.
        let rhythmus_geaendert = quelle != roh.rhythmus_quelle
            || (quelle != RhythmusQuelle::Einsatz && rhythmus != roh.rhythmus_minuten);
        if rhythmus_geaendert {
            let wie = match quelle {
                RhythmusQuelle::Abschnitt => " (Vorgabe des Abschnitts)",
                RhythmusQuelle::Einsatz => " (Vorgabe des Einsatzes)",
                RhythmusQuelle::Einheit => "",
            };
            teile.push(format!(
                "Rhythmus {} → {}{wie}",
                rhythmus_text(roh.rhythmus_minuten),
                rhythmus_label(rhythmus, quelle, &vorgabe)
            ));
        }
        if beginn_at != roh.beginn_at {
            teile.push("Einsatzbeginn geändert".into());
        }

        // Ablöser (LLH-1132: eine Liste, `einsatz_abloesung_abloeser`)
        let neue_abloeser = match &eingabe.abloeser {
            Some(neu) if *neu != load_abloeser_ids_tx(conn, id).await? => {
                let geprueft = check_abloeser_tx(conn, einsatz_id, roh.einheit_id, neu).await?;
                teile.push(match geprueft.as_slice() {
                    [] => "Planung der ablösenden Einheit aufgehoben".into(),
                    [a] => format!("ablösende Einheit «{}» geplant", a.name),
                    viele => format!("ablösende Einheiten {} geplant", namen_text(viele)),
                });
                Some(neu)
            }
            _ => None,
        };

        // Geplanter Besatzungswechsel (LLH-1319): eine Liste von Personen mit Ziel; ein Ziel gleich
        // der Einheit der Schicht steht als „kein Ziel“.
        let neuer_plan = match &eingabe.besatzung_plan {
            Some(neu) => {
                let neu: Vec<BesatzungZiel> = neu
                    .iter()
                    .map(|z| BesatzungZiel {
                        einheit_id: z.einheit_id.filter(|e| *e != roh.einheit_id),
                        ..*z
                    })
                    .collect();
                let bisher = load_besatzung_plan_tx(conn, id).await?;
                if neu == bisher {
                    None
                } else {
                    let geprueft = if neu.is_empty() {
                        Vec::new()
                    } else {
                        let g = load_gliederung(&mut *conn, einsatz_id).await?;
                        let einheiten: Vec<i64> = std::iter::once(roh.einheit_id)
                            .chain(erben_von(&g, roh.einheit_id))
                            .collect();
                        check_neue_besatzung_tx(conn, einsatz_id, &einheiten, &neu).await?
                    };
                    let gleiche_personen = {
                        let mut a: Vec<i64> = neu.iter().map(|z| z.personal_id).collect();
                        let mut b: Vec<i64> = bisher.iter().map(|z| z.personal_id).collect();
                        a.sort_unstable();
                        b.sort_unstable();
                        a == b
                    };
                    teile.push(if geprueft.is_empty() {
                        "Planung des Besatzungswechsels aufgehoben".into()
                    } else if gleiche_personen {
                        "Besatzungswechsel umgeplant".into()
                    } else {
                        format!(
                            "Besatzungswechsel geplant, neu {}",
                            personen_text(geprueft.iter().map(|p| p.name.as_str()))
                        )
                    });
                    Some(neu)
                }
            }
            None => None,
        };
        // Eine Planung je Schicht: Ablöser oder Besatzungswechsel (design.md D1).
        let hat_abloeser = match neue_abloeser {
            Some(neu) => !neu.is_empty(),
            None => !load_abloeser_ids_tx(conn, id).await?.is_empty(),
        };
        let hat_plan = match &neuer_plan {
            Some(neu) => !neu.is_empty(),
            None => !load_besatzung_plan_tx(conn, id).await?.is_empty(),
        };
        if hat_abloeser && hat_plan {
            return Err(AppError::UnprocessableEntity(
                "Geplant ist entweder eine Ablösung durch Einheiten oder ein Besatzungswechsel"
                    .into(),
            ));
        }

        if teile.is_empty() {
            return Ok(None);
        }
        // Ein geänderter Beginn ist nicht mehr das Eintreffen: die Schicht gilt danach als von Hand
        // begonnen; eine Folgeschicht bleibt Folgeschicht (LLH-1312, design.md D2).
        sqlx::query(
            "UPDATE einsatz_abloesung SET beginn_at = ?, rhythmus_minuten = ?, \
                rhythmus_quelle = ?, faellig_at = ?, faellig_laut_plan = ?, \
                beginn_quelle = CASE WHEN ? AND beginn_quelle = 'eintreffen' THEN 'hand' \
                    ELSE beginn_quelle END \
             WHERE id = ?",
        )
        .bind(&beginn_at)
        .bind(rhythmus)
        .bind(quelle.as_str())
        .bind(&faellig_at)
        .bind(laut_plan)
        .bind(beginn_at != roh.beginn_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let abloeser_geaendert = neue_abloeser.is_some() || neuer_plan.is_some();
        if let Some(neu) = neue_abloeser {
            set_abloeser_tx(conn, id, neu).await?;
        }
        if let Some(neu) = &neuer_plan {
            set_besatzung_plan_tx(conn, id, neu).await?;
        }
        if faellig_at != roh.faellig_at {
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
        } else if abloeser_geaendert || laut_plan != roh.faellig_laut_plan {
            // Geplant schließt den Planungshinweis, aufgehoben setzt ihn wieder (LLH-1131).
            set_planung_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                vorgabe.planungsvorlauf(),
                jetzt,
            )
            .await?;
        }
        let etb_id = crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &format!("Ablösung «{name}»: {}", teile.join(", ")),
        )
        .await?;
        Ok(Some(etb_id))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id))
}
