//! Fälligkeit, Rhythmus und die Auto-Fristen einer Schicht.

use super::*;

/// Fälligkeit und Rhythmus einer Schicht. Folgt sie der Vorgabe des Einsatzes und gibt es eine,
/// rechnet deren Regel (bei Wechselzeiten wird der Rhythmus die Dauer bis zum Wechsel); sonst
/// Beginn + Rhythmus. Eine entfernte Einsatzvorgabe lässt den zuletzt gültigen Rhythmus stehen.
pub(super) fn compute_faellig(
    beginn_at: &str,
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
) -> Result<(String, i64), AppError> {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) => w
            .regel
            .faelligkeit(beginn_at, vorgabe.stil.zone)
            .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{beginn_at}'"))),
        _ => Ok((faellig_oder_400(beginn_at, rhythmus)?, rhythmus)),
    }
}

/// Fälligkeit nach Rangfolge einer gespeicherten Schicht (ohne den Plan). Folgt sie der Vorgabe
/// des Einsatzes, rechnet deren Regel; sonst gilt die gespeicherte sekundengenau (Review PR #833),
/// außer sie kommt aus dem Plan: dann Beginn + Rhythmus.
pub(super) fn regulaer(roh: &Roh, vorgabe: &EinsatzVorgabe) -> Result<(String, i64), AppError> {
    match (roh.rhythmus_quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(_)) => compute_faellig(
            &roh.beginn_at,
            roh.rhythmus_minuten,
            roh.rhythmus_quelle,
            vorgabe,
        ),
        _ if roh.faellig_laut_plan => Ok((
            faellig_oder_400(&roh.beginn_at, roh.rhythmus_minuten)?,
            roh.rhythmus_minuten,
        )),
        _ => Ok((roh.faellig_at.clone(), roh.rhythmus_minuten)),
    }
}

/// Die Fälligkeit einer Schicht mit dem Schichtplan (LLH-1555, design.md D2): `regulaer` ist die
/// nach Rangfolge, der Plan zieht sie vor oder gibt sie im Block. Liefert die gültige und ob sie
/// aus dem Plan kommt.
pub(super) async fn mit_plan_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    beginn_at: &str,
    plan_block_id: Option<i64>,
    regulaer: String,
) -> Result<(String, bool), AppError> {
    let anker = kopplung::load_anker_tx(conn, einheit_id, plan_block_id).await?;
    let bloecke = kopplung::load_bloecke_tx(conn, einsatz_id, einheit_id, beginn_at).await?;
    Ok(
        match kopplung::plan_faelligkeit(beginn_at, anker.as_deref(), &bloecke, &regulaer) {
            Some(p) => (p.faellig_at, true),
            None => (regulaer, false),
        },
    )
}

/// Zieht die laufenden Schichten der Einheiten nach dem Schichtplan nach (LLH-1555, design.md
/// D3), in der Transaktion des Schreibwegs, der den Plan geändert hat: Fälligkeit und Kennzeichen
/// neu, die Fristen nur bei neuer Fälligkeit (sonst löste eine schon gemeldete erneut aus), der
/// Planungshinweis immer (ein Folgeblock mit Personen gilt als geplant). Kein ETB (der Plan ist
/// Soll, LLH-1552 D7).
pub(crate) async fn nachziehen_plan_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheiten: &[i64],
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    let mut einheiten = einheiten.to_vec();
    einheiten.sort_unstable();
    einheiten.dedup();
    let mut vorgabe: Option<EinsatzVorgabe> = None;
    for einheit_id in einheiten {
        let id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_abloesung \
             WHERE einsatz_id = ? AND einheit_id = ? AND status = 'laufend'",
        )
        .bind(einsatz_id)
        .bind(einheit_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(id) = id else {
            continue;
        };
        if vorgabe.is_none() {
            vorgabe = Some(load_einsatz_vorgabe_tx(conn, einsatz_id).await?);
        }
        let vorgabe = vorgabe.as_ref().expect("eben geladen");
        let roh = roh_tx(conn, einsatz_id, id).await?;
        let (regulaer, _) = regulaer(&roh, vorgabe)?;
        let (faellig_at, laut_plan) = mit_plan_tx(
            conn,
            einsatz_id,
            einheit_id,
            &roh.beginn_at,
            roh.plan_block_id,
            regulaer,
        )
        .await?;
        if faellig_at == roh.faellig_at && laut_plan == roh.faellig_laut_plan {
            let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
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
            continue;
        }
        sqlx::query(
            "UPDATE einsatz_abloesung SET faellig_at = ?, faellig_laut_plan = ? WHERE id = ?",
        )
        .bind(&faellig_at)
        .bind(laut_plan)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let (name, _) = einheit_tx(conn, einsatz_id, einheit_id).await?;
        if faellig_at != roh.faellig_at {
            set_fristen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                id,
                &name,
                &faellig_at,
                vorgabe,
                jetzt,
            )
            .await?;
        } else {
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
    }
    Ok(())
}

/// Wie der Rhythmus einer Schicht im ETB heißt: bei Wechselzeiten aus der Einsatzvorgabe deren
/// Regel in der Darstellung des Einsatzes („Wechsel 0600/1800, Mindestdauer 4 h“), sonst die
/// Dauer („6 h“).
pub(super) fn rhythmus_label(
    rhythmus: i64,
    quelle: RhythmusQuelle,
    vorgabe: &EinsatzVorgabe,
) -> String {
    match (quelle, &vorgabe.werte) {
        (RhythmusQuelle::Einsatz, Some(w)) if matches!(w.regel, Regel::Wechselzeiten { .. }) => {
            w.regel.text(vorgabe.stil.darstellung)
        }
        _ => rhythmus_text(rhythmus),
    }
}

/// Setzt die Auto-Fristen einer laufenden Schicht auf ihre Fälligkeit; die Vorwarnung liegt
/// die Vorwarnzeit davor, der Planungshinweis den Planungsvorlauf (beide aus dem Schichtmodell
/// des Einsatzes, [`set_planung_frist_tx`]). Liegt die Vorwarnzeit schon hinter `jetzt`, wird
/// eine offene Vorwarnung geschlossen statt verschoben — eine Vorwarnung in der Vergangenheit ist
/// keine mehr.
#[allow(clippy::too_many_arguments)]
pub(super) async fn set_fristen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorgabe: &EinsatzVorgabe,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::setze_auto_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        OBJEKT_ABLOESUNG,
        id,
        &format!("Ablösung fällig: {einheit_name}"),
        faellig_at,
    )
    .await?;
    set_vorwarn_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        faellig_at,
        vorgabe.vorwarnung(),
        jetzt,
    )
    .await?;
    set_planung_frist_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        einheit_name,
        faellig_at,
        vorgabe.planungsvorlauf(),
        jetzt,
    )
    .await
}

/// Ob für die Schicht eine Ablösung geplant ist: Einzelplanung, Ablöser-Liste, ein geplanter
/// Besatzungswechsel (LLH-1319) oder, laut Plan, ein Folgeblock mit Personen; laut Plan ohne
/// Folgeblock endet der Posten und braucht keine Planung (LLH-1555, design.md D4).
pub(super) async fn has_planung_tx(conn: &mut SqliteConnection, id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(concat!(
        "SELECT 1 FROM einsatz_abloesung a WHERE a.id = ? \
           AND (a.abloesende_einheit_id IS NOT NULL \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_abloeser l \
                           WHERE l.abloesung_id = a.id) \
                OR EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung_plan p \
                           WHERE p.abloesung_id = a.id) \
                OR ",
        kopplung::plan_braucht_keine_planung_sql!(),
        ")"
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Zeitpunkt des Planungshinweises: `planungsvorlauf_minuten` vor der Fälligkeit.
pub(super) fn planungszeit(faellig_at: &str, planungsvorlauf_minuten: i64) -> Option<String> {
    crate::zeit::plus_minuten(faellig_at, -planungsvorlauf_minuten)
}

/// Setzt die Planungs-Frist einer laufenden Schicht (LLH-1131): `planungsvorlauf_minuten` vor
/// der Fälligkeit, aber nur, solange keine ablösende Einheit geplant ist und der Zeitpunkt noch
/// vor `jetzt` liegt; sonst wird eine offene geschlossen (wie die Vorwarnung). Der Hinweis kommt
/// damit einmal je Zustand: Planen schließt die Frist, eine aufgehobene oder entfallene Planung
/// setzt sie neu, eine neue Fälligkeit verschiebt sie.
#[allow(clippy::too_many_arguments)]
pub(super) async fn set_planung_frist_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    planungsvorlauf_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    let zeit = planungszeit(faellig_at, planungsvorlauf_minuten).filter(|p| p.as_str() > jetzt);
    match zeit {
        Some(p) if !has_planung_tx(conn, id).await? => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_PLANUNG,
                id,
                &format!("Keine ablösende Einheit geplant: {einheit_name}"),
                &p,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
}

/// Setzt nur die Vorwarn-Frist einer laufenden Schicht (Regeln wie [`set_fristen_tx`]). Für eine
/// reine Änderung der Vorwarnzeit: die Fälligkeitsfrist bleibt unberührt, sonst leerte
/// `setze_auto_frist_tx` ihr `zuletzt_ausgeloest_at`, und eine überfällige Schicht meldete
/// „fällig“ ein zweites Mal (Spec „Einmaliges Auslösen“, Review PR #833).
#[allow(clippy::too_many_arguments)]
pub(super) async fn set_vorwarn_frist_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    id: i64,
    einheit_name: &str,
    faellig_at: &str,
    vorwarnung_minuten: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    match vorwarnzeit(faellig_at, vorwarnung_minuten) {
        Some(v) if v.as_str() > jetzt => {
            erinnerung_repo::setze_auto_frist_tx(
                conn,
                einsatz_id,
                benutzer_id,
                OBJEKT_ABLOESUNG_VORWARNUNG,
                id,
                &format!(
                    "Ablösung in {}: {einheit_name}",
                    rhythmus_text(vorwarnung_minuten)
                ),
                &v,
            )
            .await?;
        }
        _ => {
            erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt)
                .await?;
        }
    }
    Ok(())
}

/// Zeitpunkt der offenen Auto-Frist eines Bezugs, `None` ohne eine.
pub(super) async fn open_frist_at_tx(
    conn: &mut SqliteConnection,
    bezug_typ: &str,
    id: i64,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT faellig_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = ? AND bezug_id = ?",
    )
    .bind(bezug_typ)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?)
}

pub(super) async fn close_fristen_tx(
    conn: &mut SqliteConnection,
    id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id, jetzt).await?;
    erinnerung_repo::schliesse_offene_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id, jetzt).await
}

pub(super) async fn delete_fristen_tx(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<(), AppError> {
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_VORWARNUNG, id).await?;
    erinnerung_repo::loesche_auto_tx(conn, OBJEKT_ABLOESUNG_PLANUNG, id).await
}
