//! Planungen der ablösenden Einheit, Beenden einer Schicht und der Autostart mit dem Eintreffen.

use super::*;

/// Beendet eine laufende Schicht ohne Ablösung (LLH-1128): Status `beendet` mit Zeitpunkt,
/// Person und Grund als Spur, offene Fristen geschlossen (nicht gelöscht: die Streichung einer
/// Entlassung öffnet sie wieder). Keine Folgeschicht, kein ETB (das schreibt der Aufrufer).
/// Liefert, ob eine laufende Schicht beendet wurde.
pub(crate) async fn end_schicht_tx(
    conn: &mut SqliteConnection,
    id: i64,
    benutzer_id: i64,
    grund: BeendetGrund,
    beendet_at: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'beendet', beendet_at = ?, beendet_von_id = ?, \
            beendet_grund = ? WHERE id = ? AND status = 'laufend'",
    )
    .bind(beendet_at)
    .bind(benutzer_id)
    .bind(grund.as_str())
    .bind(id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n > 0 {
        close_fristen_tx(conn, id, jetzt).await?;
    }
    Ok(n > 0)
}

/// Die laufende Schicht einer Einheit: ID und Name der Einheit, `None` ohne eine.
pub(crate) async fn load_laufende_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<Option<(i64, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT a.id, e.name FROM einsatz_abloesung a \
         JOIN einsatz_einheit e ON e.id = a.einheit_id \
         WHERE a.einheit_id = ? AND a.status = 'laufend'",
    )
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Auflösen einer Einheit (LLH-1079, LLH-1128, Spec `kraefte-abloesung` „Auflösen beendet die
/// laufende Schicht“): ihre laufende Schicht wird mit Grund `aufloesung` beendet (Spur statt
/// Löschen, Entscheidung vom 15.10.2026), ihre Fristen geschlossen; abgelöste bleiben mit ihrem
/// Vollzug. Plant eine laufende Schicht sie als ablösende, entfällt die Planung mit Hinweis und
/// ETB ([`drop_planungen_tx`], LLH-1131), bevor ein FK `SET NULL` sie still leeren könnte;
/// Verweise abgelöster Schichten werden still geleert. Liefert, ob sich die Ablösung geändert
/// hat, und die Wirkung der entfallenen Planungen.
pub async fn release_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<(bool, Wirkung), AppError> {
    let wirkung = drop_planungen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        PlanungEntfallenGrund::Aufloesung,
        None,
        jetzt,
    )
    .await?;
    let laufend = load_laufende_tx(conn, einheit_id).await?;
    if let Some((id, _)) = laufend {
        end_schicht_tx(
            conn,
            id,
            benutzer_id,
            BeendetGrund::Aufloesung,
            jetzt,
            jetzt,
        )
        .await?;
    }
    let geleert = sqlx::query(
        "UPDATE einsatz_abloesung SET abloesende_einheit_id = NULL WHERE abloesende_einheit_id = ?",
    )
    .bind(einheit_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let geaendert = laufend.is_some() || geleert > 0 || !wirkung.is_empty();
    Ok((geaendert, wirkung))
}

/// Hebt jede Planung auf, mit der eine laufende Schicht `einheit_id` als ablösende Einheit
/// trägt (Einzelplanung und Ablöser-Liste), weil die Einheit aufgelöst oder entlassen ist
/// (LLH-1131, Spec `kraefte-abloesung` „Planung entfällt“): je Schicht ein ETB-Eintrag
/// „Ablösung «…»: Planung der ablösenden Einheit entfallen, «…» aufgelöst“, ein Hinweis
/// `abloeser_entfallen`, der Vermerk an der Schicht (LLH-1309, der jüngste gewinnt; mit
/// `entlassung_id` die auslösende Entlassung, LLH-1510) und, ohne verbleibende Planung, wieder
/// die Planungs-Frist. Läuft in der Transaktion des Aufrufers.
pub(crate) async fn drop_planungen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    grund: PlanungEntfallenGrund,
    entlassung_id: Option<i64>,
    jetzt: &str,
) -> Result<Wirkung, AppError> {
    let schichten = hinweis::load_geplante_tx(conn, einsatz_id, einheit_id).await?;
    if schichten.is_empty() {
        return Ok(Wirkung::default());
    }
    let abloeser_name: String =
        sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(einheit_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let mut wirkung = Wirkung::default();
    for id in schichten {
        sqlx::query(
            "UPDATE einsatz_abloesung SET abloesende_einheit_id = NULL \
             WHERE id = ? AND abloesende_einheit_id = ?",
        )
        .bind(id)
        .bind(einheit_id)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "DELETE FROM einsatz_abloesung_abloeser WHERE abloesung_id = ? AND einheit_id = ?",
        )
        .bind(id)
        .bind(einheit_id)
        .execute(&mut *conn)
        .await?;
        // Rückt ein weiterer Ablöser der Liste nach, wird er der Spiegel (LLH-1132).
        sync_spiegel_tx(conn, id).await?;
        // Vermerk für die Karte (LLH-1309); er zeigt sich nur, solange kein Ablöser bleibt. Die
        // Entlassung braucht ihre Streichung (LLH-1510, [`restore_entfallene_planungen_tx`]).
        sqlx::query(
            "UPDATE einsatz_abloesung SET planung_entfallen_at = ?, planung_entfallen_grund = ?, \
                planung_entfallen_einheit_name = ?, planung_entfallen_entlassung_id = ? WHERE id = ?",
        )
        .bind(jetzt)
        .bind(grund.as_str())
        .bind(&abloeser_name)
        .bind(entlassung_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let (name, faellig_at): (String, String) = sqlx::query_as(
            "SELECT e.name, a.faellig_at FROM einsatz_abloesung a \
             JOIN einsatz_einheit e ON e.id = a.einheit_id WHERE a.id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
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
        wirkung.etb.push(
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                benutzer_id,
                startwert,
                &format!(
                    "Ablösung «{name}»: Planung der ablösenden Einheit entfallen, \
                     «{abloeser_name}» {}",
                    grund.partizip()
                ),
            )
            .await?,
        );
        // Die entfallene Einheit festhalten (LLH-1511): der Spiegel ist jetzt leer oder nennt den
        // nachgerückten Ablöser.
        wirkung.anlaesse.push(
            hinweis::anlass(
                einsatz_id,
                id,
                BenachrichtigungBezugTyp::AbloeserEntfallen,
                benutzer_id,
            )
            .einheit(einheit_id),
        );
    }
    Ok(wirkung)
}

/// Holt nach der Streichung einer Entlassung die Planungen zurück, die [`drop_planungen_tx`] mit
/// ihr hat entfallen lassen (LLH-1510, Entscheidung LLH-1310 Punkt 3, Spec `kraefte-abloesung`
/// „Gestrichene Entlassung holt die Planung zurück“). Leitlinie: eine Streichung ist eine
/// Korrektur, ihre Folgen gehen mit, solange nichts anderes daran hängt.
///
/// Zurückgeholt wird an jeder laufenden Schicht, deren Vermerk (LLH-1309) noch Grund
/// `entlassung` und genau diese Entlassung (`entlassung_id`, Zeile der Kräfte-Zeitachse) trägt;
/// eine Planung, Umplanung oder Leerung von Hand ([`set_abloeser_tx`]) und eine jüngere
/// entfallene Planung haben ihn überschrieben, und der Vermerk einer älteren, weiter geltenden
/// Entlassung derselben Einheit bleibt stehen. Nur, wenn
/// die Einheit wieder im Einsatz ist (aktiv, offene Periode), nirgends sonst als Ablöser geplant
/// ist und die Schicht keinen Besatzungswechsel plant (eine Planung je Schicht) und noch Platz
/// in der Liste hat ([`ABLOESER_MAX`]). Die Einheit reiht sich hinten in die Liste ein, ein
/// verbliebener Ablöser bleibt Spiegel. Je Schicht: Vermerk geräumt, Planungs-Frist neu
/// bewertet, ein ETB-Eintrag und ein Hinweis `abloeser_wiederhergestellt`, weil die Führung
/// vorher „entfallen“ bekam. Läuft in der Transaktion des Aufrufers.
pub(crate) async fn restore_entfallene_planungen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_id: i64,
    jetzt: &str,
) -> Result<Wirkung, AppError> {
    let schichten: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT a.id, e.name, a.faellig_at FROM einsatz_abloesung a \
         JOIN einsatz_einheit e ON e.id = a.einheit_id \
         WHERE a.einsatz_id = ? AND a.status = 'laufend' \
           AND a.planung_entfallen_grund = ? AND a.planung_entfallen_entlassung_id = ? \
           AND NOT EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung_plan p \
                           WHERE p.abloesung_id = a.id) \
         ORDER BY a.id",
    )
    .bind(einsatz_id)
    .bind(PlanungEntfallenGrund::Entlassung.as_str())
    .bind(entlassung_id)
    .fetch_all(&mut *conn)
    .await?;
    if schichten.is_empty() {
        return Ok(Wirkung::default());
    }
    let abloeser_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM einsatz_einheit \
         WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(abloeser_name) = abloeser_name else {
        return Ok(Wirkung::default());
    };
    if !crate::zeitachse::repo::has_offene_periode_tx(conn, einheit_id).await?
        || !hinweis::load_geplante_tx(conn, einsatz_id, einheit_id)
            .await?
            .is_empty()
    {
        return Ok(Wirkung::default());
    }
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let mut wirkung = Wirkung::default();
    for (id, name, faellig_at) in schichten {
        if load_abloeser_ids_tx(conn, id).await?.len() >= ABLOESER_MAX {
            continue;
        }
        sqlx::query(
            "INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id) VALUES (?, ?)",
        )
        .bind(id)
        .bind(einheit_id)
        .execute(&mut *conn)
        .await?;
        sync_spiegel_tx(conn, id).await?;
        sqlx::query(
            "UPDATE einsatz_abloesung SET planung_entfallen_at = NULL, \
                planung_entfallen_grund = NULL, planung_entfallen_einheit_name = NULL, \
                planung_entfallen_entlassung_id = NULL WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
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
        wirkung.etb.push(
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                benutzer_id,
                startwert,
                &format!(
                    "Ablösung «{name}»: Planung der ablösenden Einheit wiederhergestellt, \
                     Entlassung von «{abloeser_name}» gestrichen"
                ),
            )
            .await?,
        );
        // Die zurückgeholte Einheit festhalten (LLH-1511): bleibt ein anderer Ablöser vorn, trägt
        // der Spiegel diesen.
        wirkung.anlaesse.push(
            hinweis::anlass(
                einsatz_id,
                id,
                BenachrichtigungBezugTyp::AbloeserWiederhergestellt,
                benutzer_id,
            )
            .einheit(einheit_id),
        );
    }
    Ok(wirkung)
}

/// Entfernt die Schicht, die mit einem jetzt gestrichenen Eintreffen automatisch begonnen hat
/// (LLH-1508, Spec `kraefte-abloesung` „Schicht mit dem Eintreffen“): Eine Streichung ist eine
/// Korrektur, was das Eintreffen ausgelöst hat, geht mit, solange nichts anderes daran hängt
/// (LLH-1310). Entfernt wird nur die laufende eigene Schicht der Einheit, die
/// - mit dem Eintreffen begonnen hat (`beginn_quelle` `eintreffen`, ein geänderter Beginn hat
///   `hand` gesetzt) und genau zu `eintreffen_at`,
/// - keinem Vollzug gehört (nicht als Folgeschicht übernommen, `vorgaenger_id` leer) und
/// - keinem eigenen Rhythmus folgt (`rhythmus_quelle` nicht `einheit`).
///
/// Sonst bleibt sie stehen ([`load_autostart_tx`]). Die Schicht verschwindet samt Fristen und
/// Planung (die abhängigen Tabellen löschen mit, `ON DELETE CASCADE`); eine Planung nennt der
/// ETB-Eintrag, eine geplante ablösende Einheit dazu ein Hinweis `abloeser_entfallen` wie bei
/// der Entlassung ([`drop_planungen_tx`]). Einen Vermerk an der Karte gibt es nicht, die Karte
/// ist weg. Läuft in der Transaktion des Aufrufers; leer ohne Wirkung.
pub(crate) async fn drop_autostart_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    eintreffen_at: &str,
) -> Result<Wirkung, AppError> {
    let Some((id, name)) = load_autostart_tx(conn, einsatz_id, einheit_id, eintreffen_at).await?
    else {
        return Ok(Wirkung::default());
    };
    // Die Liste in ihrer Reihenfolge; ohne Liste der Spiegel (Bestand vor LLH-1132).
    let mut abloeser: Vec<String> = sqlx::query_scalar(
        "SELECT e.name FROM einsatz_abloesung_abloeser l \
         JOIN einsatz_einheit e ON e.id = l.einheit_id \
         WHERE l.abloesung_id = ? ORDER BY l.rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    if abloeser.is_empty() {
        abloeser = sqlx::query_scalar(
            "SELECT e.name FROM einsatz_abloesung a \
             JOIN einsatz_einheit e ON e.id = a.abloesende_einheit_id WHERE a.id = ?",
        )
        .bind(id)
        .fetch_all(&mut *conn)
        .await?;
    }
    let besatzung = !load_besatzung_plan_tx(conn, id).await?.is_empty();

    delete_fristen_tx(conn, id).await?;
    sqlx::query("DELETE FROM einsatz_abloesung WHERE id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;

    let mut inhalt = format!("Ablösung: Schicht von «{name}» mit dem Eintreffen gestrichen");
    match abloeser.as_slice() {
        [] => {}
        [a] => inhalt.push_str(&format!(", Planung der ablösenden Einheit «{a}» entfallen")),
        viele => inhalt.push_str(&format!(
            ", Planung der ablösenden Einheiten {} entfallen",
            viele
                .iter()
                .map(|a| format!("«{a}»"))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
    if besatzung {
        inhalt.push_str(", Planung des Besatzungswechsels entfallen");
    }
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
    let anlaesse = if abloeser.is_empty() {
        Vec::new()
    } else {
        vec![hinweis::anlass(
            einsatz_id,
            id,
            BenachrichtigungBezugTyp::AbloeserEntfallen,
            benutzer_id,
        )]
    };
    Ok(Wirkung {
        etb: vec![etb_id],
        anlaesse,
    })
}

/// Verschiebt die Schicht, die mit einem jetzt berichtigten Eintreffen automatisch begonnen hat
/// (LLH-1508), auf das neue Eintreffen: Beginn, Fälligkeit und Fristen folgen, Herkunft,
/// Rhythmusquelle und Planung bleiben. Bedingungen wie [`drop_autostart_tx`]. Die Berichtigung
/// ist die Zeitkorrektur in einem Schritt; eine geplante ablösende Einheit soll dabei nicht
/// entfallen. Leer ohne Wirkung.
pub(crate) async fn move_autostart_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    alt_at: &str,
    neu_at: &str,
) -> Result<Wirkung, AppError> {
    let Some((id, name)) = load_autostart_tx(conn, einsatz_id, einheit_id, alt_at).await? else {
        return Ok(Wirkung::default());
    };
    let roh = roh_tx(conn, einsatz_id, id).await?;
    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let (regulaer, rhythmus) =
        compute_faellig(neu_at, roh.rhythmus_minuten, roh.rhythmus_quelle, &vorgabe)?;
    let (faellig_at, laut_plan) = mit_plan_tx(
        conn,
        einsatz_id,
        einheit_id,
        neu_at,
        roh.plan_block_id,
        regulaer,
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_abloesung SET beginn_at = ?, faellig_at = ?, rhythmus_minuten = ?, \
            faellig_laut_plan = ? WHERE id = ?",
    )
    .bind(neu_at)
    .bind(&faellig_at)
    .bind(rhythmus)
    .bind(laut_plan)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let jetzt = crate::zeit::jetzt();
    set_fristen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        id,
        &name,
        &faellig_at,
        &vorgabe,
        &jetzt,
    )
    .await?;
    let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &format!("Ablösung: Beginn der Schicht von «{name}» folgt dem berichtigten Eintreffen"),
    )
    .await?;
    Ok(Wirkung {
        etb: vec![etb_id],
        anlaesse: Vec::new(),
    })
}

/// Die laufende eigene Schicht der Einheit, die das Eintreffen `eintreffen_at` automatisch
/// begonnen hat und an der sonst nichts hängt (Bedingungen an [`drop_autostart_tx`]): ID und
/// Name der Einheit, `None` ohne eine.
async fn load_autostart_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    eintreffen_at: &str,
) -> Result<Option<(i64, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT a.id, e.name FROM einsatz_abloesung a \
         JOIN einsatz_einheit e ON e.id = a.einheit_id \
         WHERE a.einsatz_id = ? AND a.einheit_id = ? AND a.status = 'laufend' \
           AND a.beginn_quelle = ? AND a.beginn_at = ? AND a.rhythmus_quelle <> ? \
           AND a.vorgaenger_id IS NULL AND a.uebernommen_bei_vollzug = 0",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(BeginnQuelle::Eintreffen.as_str())
    .bind(eintreffen_at)
    .bind(RhythmusQuelle::Einheit.as_str())
    .fetch_optional(&mut *conn)
    .await?)
}
