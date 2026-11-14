//! Rücknahme eines Vollzugs und Wiederöffnen nach gestrichener Entlassung.

use super::*;

/// Nimmt einen Vollzug zurück, solange jede Folgeschicht unberührt (laufend) ist (LLH-1132):
/// neu angelegte Folgeschichten werden samt Fristen entfernt, übernommene nur vom Vorgänger
/// gelöst. Das Ereignis `abloesung` wird an der Einheit und an jeder Untereinheit gestrichen,
/// die die wieder laufende Schicht erbt. Eine Abschnittsübergabe wird zurückgegeben, wo der
/// Vollzug den Stand hinterlassen hat: die abgelöste Einheit bekommt ihren Abschnitt, solange sie
/// noch ohne ist, jeder Ablöser seinen alten, solange er noch im übergebenen steht. Die Planung
/// von vor dem Vollzug gilt wieder (LLH-1319, [`restore_planung_tx`]): die gesicherte Liste der
/// Ablöser, ein geplanter Besatzungswechsel steht ohnehin noch; ohne Sicherung (Vollzug vor
/// Migration 0264) bleibt die Liste des Vollzugs als Planung stehen. Einen Besatzungswechsel
/// nimmt [`zuruecknehmen_besatzung_tx`] zurück (LLH-1150).
pub async fn zuruecknehmen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(AbloesungAnzeige, i64, VollzugWirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let (etb_id, wirkung) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Abgeloest {
            return Err(AppError::UnprocessableEntity(
                "Die Schicht ist nicht abgelöst — es gibt keinen Vollzug zurückzunehmen".into(),
            ));
        }
        let folgen: Vec<(i64, String, bool)> = sqlx::query_as(
            "SELECT id, status, uebernommen_bei_vollzug FROM einsatz_abloesung \
             WHERE vorgaenger_id = ? ORDER BY id",
        )
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
        if folgen
            .iter()
            .any(|(_, status, _)| status.as_str() != AbloesungStatus::Laufend.as_str())
        {
            return Err(AppError::UnprocessableEntity(
                "Die Folgeschicht ist bereits selbst abgelöst oder beendet — der Vollzug lässt sich nicht mehr zurücknehmen"
                    .into(),
            ));
        }
        for (folge_id, _, uebernommen) in &folgen {
            if *uebernommen {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET vorgaenger_id = NULL, \
                        uebernommen_bei_vollzug = 0 WHERE id = ?",
                )
                .bind(folge_id)
                .execute(&mut *conn)
                .await?;
            } else {
                delete_fristen_tx(conn, *folge_id).await?;
                sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
                    .bind(folge_id)
                    .execute(&mut *conn)
                    .await?;
            }
        }
        let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
        if has_laufende_tx(conn, roh.einheit_id).await? {
            return Err(AppError::UnprocessableEntity(format!(
                "Einheit «{name}» hat inzwischen eine neue laufende Schicht"
            )));
        }
        let (uebergeben, abschnitt): (bool, Option<i64>) = sqlx::query_as(
            "SELECT abschnitt_uebergeben, abgeloest_abschnitt_vorher_id FROM einsatz_abloesung \
             WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE einsatz_abloesung SET status = 'laufend', vollzogen_at = NULL, \
                vollzogen_von_id = NULL, etb_vollzug_id = NULL, abschnitt_uebergeben = 0, \
                abgeloest_abschnitt_vorher_id = NULL, art = ?, verbleib = 'ruhe', \
                verbleib_br_id = NULL WHERE id = ?",
        )
        .bind(AbloesungArt::Einheit.as_str())
        .bind(id)
        .execute(&mut *conn)
        .await?;

        let mut wirkung = VollzugWirkung::default();
        let mut uebernommen: Vec<String> = Vec::new();
        match roh.art {
            // LLH-1150: Personen-Ereignisse streichen und die Besatzung zurücklegen; die
            // Einheiten hatten kein Ereignis.
            AbloesungArt::Besatzung => {
                (wirkung, uebernommen) = zuruecknehmen_besatzung_tx(
                    conn,
                    &Vorgang {
                        einsatz_id,
                        id,
                        benutzer_id,
                        jetzt,
                    },
                    roh.einheit_id,
                )
                .await?;
            }
            // LFH-552/LLH-1132: das Ablösungsereignis (beim Verbleib „entlassen“ die
            // Entlassung, LLH-1308) an der Einheit und an ihren Erben streichen, ihre Perioden
            // sind wieder offen. Die Erben ermittelt die Vererbung jetzt, da die Schicht wieder
            // läuft — darum findet die Kopplung beim Streichen der Entlassung keine mit ihr
            // beendete Schicht (design.md D3).
            AbloesungArt::Einheit => {
                if let Some(vollzogen_at) = &roh.vollzogen_at {
                    let ende = ende_art(roh.verbleib);
                    let erben = load_erben_tx(conn, einsatz_id, roh.einheit_id).await?;
                    for einheit in std::iter::once(roh.einheit_id).chain(erben) {
                        if let Some(w) = crate::zeitachse::repo::vollzug_ende_zurueck_tx(
                            conn,
                            einsatz_id,
                            benutzer_id,
                            einheit,
                            ende,
                            vollzogen_at,
                        )
                        .await?
                        {
                            wirkung.kopplung.append(Wirkung {
                                etb: w.1.abloesung.clone(),
                                anlaesse: w.1.hinweise.clone(),
                            });
                            wirkung.zeitachse.push(w);
                        }
                    }
                }
            }
        }
        let br_saetze =
            buchungen_zuruecknehmen_tx(conn, einsatz_id, benutzer_id, id, &mut wirkung).await?;

        let mut zurueck = None;
        if let (true, Some(abschnitt)) = (uebergeben, abschnitt) {
            let abloeser: Vec<i64> = sqlx::query_scalar(
                "UPDATE einsatz_einheit SET abschnitt_id = \
                    (SELECT l.abschnitt_vorher_id FROM einsatz_abloesung_abloeser l \
                     WHERE l.abloesung_id = ?1 AND l.einheit_id = einsatz_einheit.id) \
                 WHERE abschnitt_id = ?2 AND id IN \
                    (SELECT einheit_id FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?1) \
                 RETURNING id",
            )
            .bind(id)
            .bind(abschnitt)
            .fetch_all(&mut *conn)
            .await?;
            let selbst = sqlx::query(
                "UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ? AND abschnitt_id IS NULL",
            )
            .bind(abschnitt)
            .bind(roh.einheit_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if selbst > 0 {
                wirkung.einheiten.push(roh.einheit_id);
                wirkung.abschnitt_gewechselt.push(roh.einheit_id);
            }
            wirkung.einheiten.extend(abloeser.iter().copied());
            wirkung.abschnitt_gewechselt.extend(abloeser);
            zurueck = abschnitt_tx(conn, abschnitt).await?.map(|(n, _)| n);
        }
        sqlx::query(
            "UPDATE einsatz_abloesung_abloeser SET abschnitt_vorher_id = NULL \
             WHERE abloesung_id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        // Die Planung von vor dem Vollzug gilt wieder (LLH-1319), bevor die Fristen den
        // Planungshinweis setzen; nach der Abschnittsrückgabe, die die Liste noch liest.
        restore_planung_tx(conn, id).await?;
        restore_fristen_tx(conn, einsatz_id, benutzer_id, id, &roh, &name, jetzt).await?;

        let mut inhalt = format!("Vollzug der Ablösung «{name}» zurückgenommen.");
        if let Some(a) = zurueck {
            inhalt.push_str(&format!(" Abschnitt «{a}» zurückgegeben."));
        }
        if roh.art == AbloesungArt::Besatzung {
            inhalt.push_str(" Besatzungswechsel rückgängig.");
        }
        if !uebernommen.is_empty() {
            inhalt.push_str(&format!(
                " Im Einsatz bleiben, ohne Einheit: {}.",
                personen_text(uebernommen.iter().map(String::as_str))
            ));
        }
        if roh.verbleib == AbloesungVerbleib::Entlassen {
            inhalt.push_str(" Entlassung gestrichen.");
        }
        for satz in br_saetze {
            inhalt.push(' ');
            inhalt.push_str(&satz);
            inhalt.push('.');
        }
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_BERICHTIGUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: roh.etb_vollzug_id,
            },
        )
        .await?;
        Ok((etb_id, wirkung))
    })?;
    Ok((laden(pool, einsatz_id, id, jetzt).await?, etb_id, wirkung))
}

/// Sichert die geplante Ablöser-Liste einer Schicht vor dem Vollzug (LLH-1319, design.md D4) in
/// `einsatz_abloesung_planung_vorher` und markiert die Schicht (`planung_gesichert`), auch bei
/// leerer Planung. Ein geplanter Besatzungswechsel braucht keine Sicherung: der Vollzug lässt
/// seine Zeilen stehen.
pub(super) async fn save_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_abloesung_planung_vorher WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO einsatz_abloesung_planung_vorher (abloesung_id, einheit_id) \
         SELECT abloesung_id, einheit_id FROM einsatz_abloesung_abloeser \
         WHERE abloesung_id = ? ORDER BY rowid",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE einsatz_abloesung SET planung_gesichert = 1 WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Stellt bei der Rücknahme die vor dem Vollzug gesicherte Ablöser-Liste wieder her (LLH-1319),
/// ohne inzwischen aufgelöste Einheiten, und räumt die Sicherung. Ohne Sicherung (Vollzug vor
/// Migration 0264) bleibt die Liste des Vollzugs als Planung, wie bisher.
async fn restore_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<(), AppError> {
    let gesichert: bool =
        sqlx::query_scalar("SELECT planung_gesichert FROM einsatz_abloesung WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    if !gesichert {
        return Ok(());
    }
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT v.einheit_id FROM einsatz_abloesung_planung_vorher v \
         JOIN einsatz_einheit e ON e.id = v.einheit_id AND e.aufgeloest_at IS NULL \
         WHERE v.abloesung_id = ? ORDER BY v.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    set_abloeser_tx(conn, id, &ids).await?;
    sqlx::query("DELETE FROM einsatz_abloesung_planung_vorher WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE einsatz_abloesung SET planung_gesichert = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Legt die Belegungsbuchungen eines Vollzugs im Bereitstellungsraum zurück (LLH-1308, design.md
/// D4/D5), je Buchung nur, solange sie noch das jüngste Ereignis ihrer Einheit ist, der Raum aktiv
/// und die Einheit nicht aufgelöst ist: ein Eintritt bekommt den Austritt, ein Austritt den
/// Eintritt in denselben Raum (Notiz „Ablösung zurückgenommen“). Hat sich seitdem etwas bewegt,
/// bleibt der Raum, wie er ist. Die Reihe bleibt angehängt, wie ETB und Zeitachse. Danach fallen
/// die Zeilen. Liefert je Buchung einen Teilsatz für die Berichtigung.
async fn buchungen_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    wirkung: &mut VollzugWirkung,
) -> Result<Vec<String>, AppError> {
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    /// `(Raum, Einheit, Art, Raum-Bezeichnung, Einheit-Name)` je Buchung, die noch den Stand des
    /// Vollzugs trägt.
    type Offen = (i64, i64, String, String, String);
    let offen: Vec<Offen> = sqlx::query_as(
        "SELECT b.br_id, b.objekt_id, b.art, r.bezeichnung, e.name \
         FROM einsatz_abloesung_br_buchung x \
         JOIN br_belegung b ON b.id = x.belegung_id \
         JOIN bereitstellungsraum r ON r.id = b.br_id \
         JOIN einsatz_einheit e ON e.id = b.objekt_id AND e.einsatz_id = b.einsatz_id \
         WHERE x.abloesung_id = ? AND b.objekt_typ = 'einheit' \
           AND r.status = 'aktiv' AND r.storniert_at IS NULL AND e.aufgeloest_at IS NULL \
           AND b.id = (SELECT MAX(y.id) FROM br_belegung y WHERE y.einsatz_id = b.einsatz_id \
                         AND y.objekt_typ = 'einheit' AND y.objekt_id = b.objekt_id) \
         ORDER BY b.id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let mut saetze = Vec::new();
    for (br_id, einheit_id, art, bezeichnung, name) in offen {
        let (gegen, satz) = if art == BrBelegungsArt::Eintritt.as_str() {
            (
                BrBelegungsArt::Austritt,
                format!("«{name}» verlässt Bereitstellungsraum {bezeichnung} wieder"),
            )
        } else {
            (
                BrBelegungsArt::Eintritt,
                format!("«{name}» wieder in Bereitstellungsraum {bezeichnung}"),
            )
        };
        belegung_repo::belege_tx(
            &mut *conn,
            einsatz_id,
            br_id,
            ObjektTyp::Einheit,
            einheit_id,
            &Buchung {
                art: gegen,
                notiz: Some(crate::zeitachse::repo::GRUND_ABLOESUNG_ZURUECK),
                client_id: None,
                zeitpunkt_at: None,
                von_br_id: None,
            },
            benutzer_id,
        )
        .await?;
        saetze.push(satz);
        wirkung.raeume.push(br_id);
        wirkung.einheiten.push(einheit_id);
    }
    sqlx::query("DELETE FROM einsatz_abloesung_br_buchung WHERE abloesung_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(saetze)
}

/// Nimmt einen Besatzungswechsel zurück (LLH-1150): streicht die Ereignisse der Personen aus dem
/// Vollzug (Grund „Ablösung zurückgenommen“; bräche das die Folge einer Person → 422 mit ihrem
/// Namen, nichts geändert) und legt jede Person zurück, solange sie noch so steht, wie der
/// Vollzug sie hinterlassen hat: die neue verlässt die Einheit wieder, in die der Vollzug sie
/// verteilt hat (zurück in ihre bisherige, solange die aktiv ist), und das Ziel-Fahrzeug (zurück
/// auf ihr bisheriges, solange es aktiv ist; LLH-1319), die alte kommt in ihre Einheit
/// (solange sie ohne Einheit und aktiv ist und die Einheit nicht aufgelöst), auf ihr Fahrzeug
/// (solange sie auf keinem sitzt und es aktiv ist) und in ihre Führung (solange die Einheit
/// keine hat). Danach fallen die Zeilen.
async fn zuruecknehmen_besatzung_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    einheit_id: i64,
) -> Result<(VollzugWirkung, Vec<String>), AppError> {
    use crate::zeitachse::repo::{streiche_tx, Kraft, GRUND_ABLOESUNG_ZURUECK};
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        ..
    } = *v;
    let ereignisse: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT b.personal_id, z.id, p.snap_name FROM einsatz_abloesung_besatzung b \
         JOIN einsatz_kraft_zeitachse z ON z.id = b.zeitachse_id AND z.gestrichen_at IS NULL \
         JOIN einsatz_personal p ON p.id = b.personal_id \
         WHERE b.abloesung_id = ? ORDER BY b.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    for (person, ereignis, name) in ereignisse {
        streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            Kraft::Person(person),
            ereignis,
            GRUND_ABLOESUNG_ZURUECK,
            true,
        )
        .await
        .map_err(|e| match e {
            AppError::UnprocessableEntity(m) => AppError::UnprocessableEntity(format!(
                "Die Zeitachse von «{name}» verlöre ihre Ordnung: {m}"
            )),
            e => e,
        })?;
    }

    let mut wirkung = VollzugWirkung::default();
    // Die neue Besatzung zurück, solange sie noch in ihrer Ziel-Einheit steht (LLH-1319; ohne
    // Ziel, Bestand vor 0264, die Einheit der Schicht).
    let neu: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "UPDATE einsatz_personal SET einheit_id = \
            (SELECT e.id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_einheit e ON e.id = b.einheit_vorher_id AND e.aufgeloest_at IS NULL \
             WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id) \
         WHERE EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                       WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                         AND b.rolle = 'neu' \
                         AND einsatz_personal.einheit_id = COALESCE(b.einheit_nachher_id, ?2)) \
         RETURNING id, einheit_id",
    )
    .bind(id)
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?;
    // Ihr Fahrzeug zurück, solange sie noch auf dem sitzt, das der Wechsel ihr gab: auf das
    // vorherige, solange es aktiv ist, sonst auf keins (LLH-1319).
    sqlx::query(
        "UPDATE einsatz_personal SET fahrzeug_id = \
            (SELECT f.id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_fahrzeug f ON f.id = b.fahrzeug_vorher_id AND f.beendet_at IS NULL \
             WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id) \
         WHERE EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                       WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                         AND b.rolle = 'neu' \
                         AND b.fahrzeug_nachher_id = einsatz_personal.fahrzeug_id)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // Die alte Besatzung zurück, solange sie ohne Einheit und noch im Einsatz ist.
    let alt: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "UPDATE einsatz_personal SET \
            einheit_id = (SELECT e.id FROM einsatz_abloesung_besatzung b \
                JOIN einsatz_einheit e ON e.id = b.einheit_vorher_id AND e.aufgeloest_at IS NULL \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), \
            fahrzeug_id = COALESCE(fahrzeug_id, (SELECT f.id FROM einsatz_abloesung_besatzung b \
                JOIN einsatz_fahrzeug f ON f.id = b.fahrzeug_vorher_id AND f.beendet_at IS NULL \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id)) \
         WHERE einheit_id IS NULL AND beendet_at IS NULL \
           AND id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'alt') \
         RETURNING id, einheit_id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    // Die Führung zurück, wo die Person wieder in ihrer Einheit steht und die Einheit keine hat.
    sqlx::query(
        "UPDATE einsatz_einheit SET fuehrer_id = \
            (SELECT b.personal_id FROM einsatz_abloesung_besatzung b \
             JOIN einsatz_personal p ON p.id = b.personal_id AND p.einheit_id = b.einheit_vorher_id \
             WHERE b.abloesung_id = ?1 AND b.rolle = 'alt' AND b.war_fuehrer = 1 \
               AND b.einheit_vorher_id = einsatz_einheit.id) \
         WHERE fuehrer_id IS NULL AND id IN (SELECT einheit_vorher_id \
            FROM einsatz_abloesung_besatzung \
            WHERE abloesung_id = ?1 AND rolle = 'alt' AND war_fuehrer = 1)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // Wer mit dem Vollzug erst aus dem Plan kam, bleibt im Einsatz (LLH-1555, design.md D5);
    // die Rücknahme nennt sie.
    let uebernommen: Vec<String> = sqlx::query_scalar(
        "SELECT p.snap_name FROM einsatz_abloesung_besatzung b \
         JOIN einsatz_personal p ON p.id = b.personal_id \
         WHERE b.abloesung_id = ? AND b.rolle = 'neu' AND b.uebernommen = 1 ORDER BY b.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let alle: Vec<i64> = sqlx::query_scalar(
        "DELETE FROM einsatz_abloesung_besatzung WHERE abloesung_id = ? RETURNING personal_id",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    wirkung.einheiten.push(einheit_id);
    wirkung
        .einheiten
        .extend(neu.iter().chain(alt.iter()).filter_map(|(_, e)| *e));
    wirkung.personen = alle;
    Ok((wirkung, uebernommen))
}

/// Fristen einer wieder laufenden Schicht (Rücknahme des Vollzugs, gestrichene Entlassung) nach
/// der aktuellen Vorgabe (Review PR #833). Folgt die Schicht der Vorgabe des Einsatzes und
/// rechnet deren Regel inzwischen anders, gilt die neue Fälligkeit samt neuer Fristen. Sonst
/// öffnet das die alte Fälligkeitsfrist, ohne eine schon erfolgte Auslösung zu wiederholen, und
/// legt die Vorwarnung auf die aktuelle Vorwarnzeit — nur, solange sie noch vor uns liegt.
async fn restore_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    roh: &Roh,
    name: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let vorwarnung = vorgabe.vorwarnung();
    let (regulaer, rhythmus) = regulaer(roh, &vorgabe)?;
    // Der Plan gilt wie beim Beginn (LLH-1555): er kann sich seit dem Vollzug geändert haben.
    let (faellig_at, laut_plan) = mit_plan_tx(
        conn,
        einsatz_id,
        roh.einheit_id,
        &roh.beginn_at,
        roh.plan_block_id,
        regulaer,
    )
    .await?;
    if laut_plan != roh.faellig_laut_plan {
        sqlx::query("UPDATE einsatz_abloesung SET faellig_laut_plan = ? WHERE id = ?")
            .bind(laut_plan)
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    if faellig_at != roh.faellig_at {
        sqlx::query(
            "UPDATE einsatz_abloesung SET rhythmus_minuten = ?, faellig_at = ? WHERE id = ?",
        )
        .bind(rhythmus)
        .bind(&faellig_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        set_fristen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            id,
            name,
            &faellig_at,
            &vorgabe,
            jetzt,
        )
        .await?;
    } else {
        erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
        if let Some(v) = vorwarnzeit(&faellig_at, vorwarnung).filter(|v| v.as_str() > jetzt) {
            erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
            if open_frist_at_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await? != Some(v) {
                set_vorwarn_frist_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    id,
                    name,
                    &faellig_at,
                    vorwarnung,
                    jetzt,
                )
                .await?;
            }
        }
        // Planungshinweis (LLH-1131) wie die Vorwarnung: nur vor uns und ohne Planung, ein schon
        // ausgelöster wird nicht wiederholt.
        let vorlauf = vorgabe.planungsvorlauf();
        if let Some(p) = planungszeit(&faellig_at, vorlauf).filter(|p| p.as_str() > jetzt) {
            if !has_planung_tx(conn, id).await? {
                erinnerung_repo::oeffne_letzte_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await?;
                if open_frist_at_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await? != Some(p) {
                    set_planung_frist_tx(
                        conn,
                        einsatz_id,
                        benutzer_id,
                        id,
                        name,
                        &faellig_at,
                        vorlauf,
                        jetzt,
                    )
                    .await?;
                }
            }
        }
    }
    Ok(())
}

/// Öffnet die mit einer Entlassung beendete Schicht einer Einheit wieder, wenn genau diese
/// Entlassung gestrichen wurde (LLH-1128): Grund `entlassung`, Ende = Zeitpunkt der
/// gestrichenen Entlassung, die jüngste solche Schicht. Hat die Einheit inzwischen eine neue
/// laufende Schicht, bleibt sie beendet. Fristen wie bei der Rücknahme eines Vollzugs. Liefert
/// die ID der Schicht und den Namen der Einheit, `None` ohne Wirkung.
pub(crate) async fn reopen_nach_entlassung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
    jetzt: &str,
) -> Result<Option<(i64, String)>, AppError> {
    let id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_abloesung \
         WHERE einsatz_id = ? AND einheit_id = ? AND status = 'beendet' \
           AND beendet_grund = ? AND beendet_at = ? \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(BeendetGrund::Entlassung.as_str())
    .bind(entlassung_at)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(id) = id else {
        return Ok(None);
    };
    if has_laufende_tx(conn, einheit_id).await? {
        return Ok(None);
    }
    let roh = roh_tx(conn, einsatz_id, id).await?;
    let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'laufend', beendet_at = NULL, \
            beendet_von_id = NULL, beendet_grund = NULL WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    restore_fristen_tx(conn, einsatz_id, benutzer_id, id, &roh, &name, jetzt).await?;
    Ok(Some((id, name)))
}
