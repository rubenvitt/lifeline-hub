//! Personensuche im Archivblock (LLH-1712, Change `xlrgl4du-loeschersuchen-person-im-archiv`,
//! design.md D6).
//!
//! Am archivierten Einsatz stehen keine Namen mehr; ein Löschersuchen für eine Person braucht
//! aber ihre Kennung. Der Befehl `lifeline-hub archiv personen --einsatz … --identitaet …
//! --suche …` entschlüsselt den gültigen Block in eine Zwischendatei und sucht darin wie die
//! pseudonyme Personensuche am Einsatz (`aufbewahrung::suche`). Anders als dort nennt die
//! Ausgabe den Namen, aber nur im Terminal dessen, der den Archiv-Schlüssel hat. Die Admin-Spur
//! hält jede Suche fest, ohne Suchtext; der Suchtext steht in keinem Log.

use super::bauen;
use crate::aufbewahrung::suche;
use crate::auth::admin_audit::{self, AdminAktion, Ziel};
use crate::backup::verschluesselung::Schluessel;
use crate::einsatz::schwaerzung_person::PersonenArt;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

/// Wer sucht, in der Admin-Spur.
const BEFEHL: &str = "Befehl archiv personen";

/// Ein Treffer im Archivblock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Treffer {
    pub art: PersonenArt,
    /// `R-042`, `EK-17`, `IT-5`: dieselbe Kennung nimmt der Antrag in der Archivakte.
    pub kennung: String,
    /// Erfassung bzw. Eingang (UTC, DB-Format).
    pub erfasst_at: String,
    /// Der Name im Block; leer, wenn er dort schon geschwärzt ist.
    pub name: String,
}

/// Sucht im gültigen Block des archivierten Einsatzes nach Name oder Kontakt. Ändert nichts am
/// Archiv. Ein Suchtext unter [`suche::MIN_SUCHTEXT`] Zeichen, ein Einsatz ohne Archiv und ein
/// Schlüssel, der den Block nicht öffnet, sind 400, alle ohne Eintrag in der Admin-Spur.
pub async fn suchen(
    pool: &SqlitePool,
    einsatz_id: i64,
    schluessel: &Schluessel,
    suchtext: &str,
    jetzt: DateTime<Utc>,
) -> Result<Vec<Treffer>, AppError> {
    let suchtext = suchtext.trim();
    if suchtext.chars().count() < suche::MIN_SUCHTEXT {
        return Err(AppError::Validation(format!(
            "Der Suchtext braucht mindestens {} Zeichen.",
            suche::MIN_SUCHTEXT
        )));
    }
    let Some((block, inhalt)) =
        super::gueltiger_block(pool, einsatz_id, &crate::zeit::formatiere_utc(jetzt)).await?
    else {
        return Err(AppError::Validation(format!(
            "Einsatz {einsatz_id} hat hier kein Archiv mit einem gültigen Block."
        )));
    };
    let (org_id, nummer): (i64, Option<String>) =
        sqlx::query_as("SELECT org_id, einsatznummer_intern FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;

    let verzeichnis = bauen::verzeichnis(pool).await?;
    let klar = bauen::entschluesseln(
        &inhalt,
        schluessel,
        &verzeichnis,
        einsatz_id,
        bauen::TEIL_PERSONEN,
    )
    .map_err(|e| match e {
        AppError::Validation(m) => AppError::Validation(format!("Block {block}: {m}")),
        andere => andere,
    })?;
    drop(inhalt);
    let archiv = bauen::oeffnen(klar.pfad(), false).await?;
    let gefunden = im_block(&archiv, einsatz_id, suchtext).await;
    archiv.close().await;
    drop(klar);
    let treffer = gefunden?;

    let einsatz_kennung =
        crate::aufbewahrung::antrag::einsatz_kennung(nummer.as_deref(), einsatz_id);
    crate::write_retry!(pool, |conn| {
        admin_audit::schreibe_ohne_akteur_tx(
            &mut *conn,
            AdminAktion::ArchivDurchsucht,
            org_id,
            BEFEHL,
            Ziel::Archiv(&einsatz_kennung),
        )
        .await?;
        Ok(())
    })?;
    tracing::warn!(
        einsatz_id,
        block,
        treffer = treffer.len(),
        "Archiv: per Befehl nach einer Person gesucht"
    );
    Ok(treffer)
}

async fn im_block(
    archiv: &SqlitePool,
    einsatz_id: i64,
    suchtext: &str,
) -> Result<Vec<Treffer>, AppError> {
    super::einspielen::migrieren(archiv).await?;
    let mut treffer = Vec::new();
    for t in suche::personensuche(archiv, einsatz_id, suchtext).await? {
        let sql = match t.art {
            PersonenArt::Betroffene => {
                "SELECT trim(coalesce(vorname, '') || ' ' || coalesce(name, '')) \
                 FROM einsatz_person WHERE id = ?"
            }
            PersonenArt::ExterneKraft => {
                "SELECT coalesce(snap_name, '') FROM einsatz_personal WHERE id = ?"
            }
            PersonenArt::InfotelefonAnruf => {
                "SELECT coalesce(anrufer_name, '') FROM infotelefon_anruf WHERE id = ?"
            }
        };
        let name: String = sqlx::query_scalar(sql).bind(t.id).fetch_one(archiv).await?;
        treffer.push(Treffer {
            art: t.art,
            kennung: t.kennung,
            erfasst_at: t.erfasst_at,
            name,
        });
    }
    Ok(treffer)
}

#[cfg(test)]
mod tests;
