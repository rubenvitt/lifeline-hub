//! Freigabe eines Einsatzes für Maschinenzugänge durch die Einsatzleitung (LLH-1638, ADR-0033,
//! Spec `maschinenzugang`, „Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung“).
//!
//! Das Paneel „Anbindungen“ der Seite „Geräte“ liest und schaltet hier. Die Zugänge legt der
//! System-Admin an (`routes::anbindungen`); welchen Einsatz ein Zugang liest, entscheidet die
//! Einsatzleitung. Je Zugang ist das höchstens einer: Einschalten an einem zweiten Einsatz stellt
//! um (`public_api::freigabe`).
//!
//! Wie das Lagebild für Externe gilt die Freigabe an jeder Instanz, die den Einsatz hat, geführt
//! oder als Spiegel: Fremdsysteme kommen am Hub an, ein vom ELW geführter Einsatz liegt dort als
//! Spiegel. Der ETB-Eintrag geht am Spiegel als Antrag an den Führer
//! ([`super::leitung_freigabe`]). Herleitung:
//! `openspec/changes/archive/2026-11-12-f658d8o6-lage-fuer-maschinenzugaenge/design.md` (D4, D5).

use super::leitung_freigabe::{
    etb_vermerken, fordere_freigabe_moeglich, im_tx_aktiv, SpiegelEintrag,
};
use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::public_api::freigabe::{self, AnbindungFreigabe, FreigabeWirkung};
use axum::extract::State;
use axum::Json;
use sqlx::SqliteConnection;

async fn liste_fuer(
    state: &AppState,
    org_id: i64,
    einsatz_id: i64,
) -> Result<Json<Vec<AnbindungFreigabe>>, AppError> {
    let mut conn = state.pool.acquire().await?;
    Ok(Json(
        freigabe::list_fuer_einsatz(&mut conn, org_id, einsatz_id, &crate::zeit::jetzt()).await?,
    ))
}

/// GET /api/einsaetze/{id}/anbindungen — die Maschinenzugänge der Org, für die sich ein Einsatz
/// freigeben lässt, aus Sicht dieses Einsatzes. Nur die Einsatzleitung, wie die Geräte.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<Vec<AnbindungFreigabe>>, AppError> {
    ctx.fordere_einsatzleitung()?;
    liste_fuer(&state, ctx.einsatz.org_id, ctx.einsatz.id).await
}

/// Hält ein früherer Einsatz hier als Spiegel her und nimmt er Anträge an? `None`: geführt.
async fn spiegel_lage(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<bool>, AppError> {
    let spiegel: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = ?)")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    if !spiegel {
        return Ok(None);
    }
    Ok(Some(
        crate::instanz::spiegel::antrag::abgleich_laeuft_tx(conn, einsatz_id).await?,
    ))
}

/// Vermerkt im ETB eines Einsatzes, der nicht der des Handlers ist (der frühere beim Umstellen),
/// was mit seiner Freigabe geschah. Geführt: Systemeintrag. Als Spiegel: Antrag an den Führer,
/// aber nur, wenn der Abgleich läuft und die Person dort zur Führung gehört; sonst lehnte der
/// Führer den Antrag ab, und er bliebe als abgelehnt stehen.
async fn im_frueheren_vermerken(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    von: i64,
    von_name: &str,
    an: &str,
    text: &str,
) -> Result<Option<i64>, AppError> {
    match spiegel_lage(conn, einsatz_id).await? {
        None => etb_vermerken(conn, einsatz_id, None, von, text).await,
        Some(false) => Ok(None),
        Some(true) => {
            let rolle: Option<String> = sqlx::query_scalar(
                "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
                 WHERE einsatz_id = ? AND benutzer_id = ?",
            )
            .bind(einsatz_id)
            .bind(von)
            .fetch_optional(&mut *conn)
            .await?;
            let fuehrt = rolle
                .as_deref()
                .and_then(crate::einsatz::EinsatzRolle::parse)
                .is_some_and(|r| r.gehoert_zur_fuehrung());
            if !fuehrt {
                return Ok(None);
            }
            etb_vermerken(
                conn,
                einsatz_id,
                Some(SpiegelEintrag { von: von_name, an }),
                von,
                text,
            )
            .await
        }
    }
}

/// PUT /api/einsaetze/{id}/anbindungen/{zid}/freigabe — der Zugang liest ab jetzt diesen Einsatz.
/// Las er einen anderen, endet dessen Freigabe; beide ETBs nennen das. Idempotent.
pub async fn freigeben(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    PfadParam((_eid, zugang_id)): PfadParam<(i64, String)>,
) -> Result<Json<Vec<AnbindungFreigabe>>, AppError> {
    fordere_freigabe_moeglich(&ctx)?;
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let spiegel = ctx.einsatz.spiegel.spiegel_ist;
    let von = ctx.benutzer.id;
    let name = ctx.benutzer.anzeigename.clone();
    let jetzt = crate::zeit::jetzt();
    let etb_ids = crate::write_retry!(&state.pool, |conn| {
        // Der Extractor sah den Stand vor der Transaktion; ein Abschluss oder eine
        // Führungsübergabe dazwischen darf keine Freigabe hinterlassen.
        im_tx_aktiv(conn, einsatz_id, spiegel).await?;
        let zugang = freigabe::load_freigebbar(conn, org_id, &zugang_id, &jetzt).await?;
        let mut etb_ids = Vec::new();
        match freigabe::freigeben_tx(conn, &zugang.id, einsatz_id, von).await? {
            FreigabeWirkung::Keine => {}
            wirkung => {
                let text = format!(
                    "Einsatz für die Anbindung „{}“ freigegeben von {name}.",
                    zugang.name
                );
                let am_spiegel = spiegel.then_some(SpiegelEintrag {
                    von: &name,
                    an: &zugang.name,
                });
                if let Some(id) = etb_vermerken(conn, einsatz_id, am_spiegel, von, &text).await? {
                    etb_ids.push((einsatz_id, id));
                }
                if let FreigabeWirkung::Abgeloest { vorher } = wirkung {
                    let text = format!(
                        "Anbindung „{}“ liest jetzt einen anderen Einsatz (umgestellt von \
                         {name}).",
                        zugang.name
                    );
                    if let Some(id) =
                        im_frueheren_vermerken(conn, vorher, von, &name, &zugang.name, &text)
                            .await?
                    {
                        etb_ids.push((vorher, id));
                    }
                }
            }
        }
        Ok(etb_ids)
    })?;
    for (einsatz_id, etb_id) in etb_ids {
        state.live.publiziere(einsatz_id, etb_id);
    }
    liste_fuer(&state, org_id, einsatz_id).await
}

/// DELETE /api/einsaetze/{id}/anbindungen/{zid}/freigabe — der Zugang liest diesen Einsatz nicht
/// mehr. Idempotent; das ETB nennt nur die Wirkung.
pub async fn freigabe_beenden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    PfadParam((_eid, zugang_id)): PfadParam<(i64, String)>,
) -> Result<Json<Vec<AnbindungFreigabe>>, AppError> {
    fordere_freigabe_moeglich(&ctx)?;
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let spiegel = ctx.einsatz.spiegel.spiegel_ist;
    let von = ctx.benutzer.id;
    let name = ctx.benutzer.anzeigename.clone();
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        im_tx_aktiv(conn, einsatz_id, spiegel).await?;
        // Auch ein Zugang, der inzwischen widerrufen oder abgelaufen ist, lässt sich ausschalten;
        // nur ein fremder ist 404.
        let zugang = crate::public_api::zugang::laden_in_org(conn, org_id, &zugang_id)
            .await?
            .ok_or(AppError::NotFound)?;
        if !freigabe::beenden_tx(conn, &zugang.id, einsatz_id).await? {
            return Ok(None);
        }
        // Abgleich beendet: das Ende muss trotzdem gelten, nur der Antrag entfällt. Sonst läse
        // der Zugang den Spiegel weiter, solange er aktiv ist.
        if spiegel && !crate::instanz::spiegel::antrag::abgleich_laeuft_tx(conn, einsatz_id).await?
        {
            return Ok(None);
        }
        let text = format!(
            "Freigabe für die Anbindung „{}“ beendet von {name}.",
            zugang.name
        );
        let am_spiegel = spiegel.then_some(SpiegelEintrag {
            von: &name,
            an: &zugang.name,
        });
        etb_vermerken(conn, einsatz_id, am_spiegel, von, &text).await
    })?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    liste_fuer(&state, org_id, einsatz_id).await
}

/// Beendet die Freigabe eines Zugangs, weil ein Admin ihn widerrufen oder ihm den letzten
/// Lese-Scope mit Einsatzbezug entzogen hat (design.md D5). Führt die Instanz den gelesenen
/// Einsatz, nennt dessen ETB den Vorgang mit `text`; liegt er als Spiegel vor, steht er allein
/// in der Admin-Spur: ein Admin ohne Rolle im Einsatz ist kein Absender, den der Führer annähme.
/// Liefert Einsatz und ETB-Eintrag für den Live-Kanal.
pub(crate) async fn freigabe_entziehen_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    von: i64,
    text: &str,
) -> Result<Option<(i64, i64)>, AppError> {
    let Some(einsatz_id) = freigabe::delete_fuer_zugang_tx(conn, zugang_id).await? else {
        return Ok(None);
    };
    if spiegel_lage(conn, einsatz_id).await?.is_some() {
        return Ok(None);
    }
    Ok(etb_vermerken(conn, einsatz_id, None, von, text)
        .await?
        .map(|etb_id| (einsatz_id, etb_id)))
}
