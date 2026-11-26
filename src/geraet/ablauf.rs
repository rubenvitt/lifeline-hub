//! Ablauf einer Kopplung an einer Verpflegungsstelle (LLH-1316).
//!
//! Eine Kopplung endet still, sobald `laeuft_ab_at` verstrichen ist; kein Schreibweg läuft dabei.
//! Die Stellenliste der Verpflegung zeigt an jeder Stelle `geraet_gekoppelt` und sperrt danach
//! „Stornieren“. Damit sie nicht bis zum nächsten Abruf einen veralteten Stand zeigt, meldet der
//! Takt des Erinnerungs-Planers ([`crate::erinnerung::scheduler`]) je Einsatz ein `verpflegung`,
//! sobald dort eine solche Kopplung im Fenster `(seit, bis]` abgelaufen ist.
//!
//! Derselbe Takt warnt die Leitung 30 Minuten vor dem Ablauf einer bestätigten Helfer-Kopplung
//! (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Dauer“): ein
//! System-Eintrag im ETB je Einsatz und Takt, live verteilt ([`warne_helfer`]).
//!
//! Derselbe Takt löscht die Personenposition abgelaufener Helfer-Kopplungen
//! ([`raeume_helfer`], `helfer::ende`): ein Ablauf schreibt sonst nichts, und die Person bliebe
//! auf der Karte. Das richtet sich nach dem Zustand, nicht nach dem Fenster, und holt deshalb auch
//! einen Ablauf während eines Neustarts nach.
//!
//! Das Fenster ([`AblaufFenster`]) führt der Planer im Speicher. Ein Ablauf während eines Neustarts bleibt ungemeldet:
//! nach dem Neustart holen die Clients ohnehin alles neu (neuer Live-Kanal, Lücke).

use crate::error::AppError;
use crate::live::{LiveEvent, LiveHub};
use chrono::{DateTime, Duration, Utc};
use sqlx::SqlitePool;

/// Vorlauf der Warnung vor dem Ablauf einer bestätigten Helfer-Kopplung.
pub const HELFER_WARNUNG_MINUTEN: i64 = 30;

/// Einsätze mit einer nicht widerrufenen Kopplung an einer Verpflegungsstelle, deren Ende in
/// `(seit, bis]` liegt.
pub async fn einsaetze_mit_ablauf(
    pool: &SqlitePool,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT DISTINCT einsatz_id FROM geraet_kopplung \
         WHERE verpflegungsstelle_id IS NOT NULL AND widerrufen_at IS NULL \
           AND laeuft_ab_at > ? AND laeuft_ab_at <= ? \
         ORDER BY einsatz_id",
    )
    .bind(crate::zeit::formatiere_utc(seit))
    .bind(crate::zeit::formatiere_utc(bis))
    .fetch_all(pool)
    .await
}

/// Meldet je betroffenem Einsatz ein `verpflegung` (Nutzlast `{einsatz_id}`). Liefert die Zahl
/// der Einsätze; ein Fehler der Abfrage geht an den Aufrufer, damit er das Fenster behält.
pub async fn melde_abgelaufene(
    pool: &SqlitePool,
    live: &LiveHub,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> Result<usize, sqlx::Error> {
    let einsaetze = einsaetze_mit_ablauf(pool, seit, bis).await?;
    for einsatz_id in &einsaetze {
        live.publiziere_einsatz(*einsatz_id, LiveEvent::Verpflegung);
    }
    Ok(einsaetze.len())
}

/// Eine bestätigte Helfer-Kopplung, deren Warnzeit im Fenster liegt.
#[derive(sqlx::FromRow)]
struct BaldAbgelaufen {
    einsatz_id: i64,
    anzeigename: String,
    laeuft_ab_at: String,
    /// Wer bestätigt hat; der ETB-Eintrag steht unter seinem Namen.
    von: i64,
}

/// Schreibt je Einsatz einen ETB-Eintrag für die bestätigten, offenen Helfer-Kopplungen eines
/// aktiven Einsatzes, deren Ende in `(seit, bis]` + [`HELFER_WARNUNG_MINUTEN`] liegt, und
/// verteilt ihn live. Liefert die Zahl der Einträge.
pub async fn warne_helfer(
    pool: &SqlitePool,
    live: &LiveHub,
    seit: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> Result<usize, AppError> {
    let vorlauf = Duration::minutes(HELFER_WARNUNG_MINUTEN);
    let zeilen: Vec<BaldAbgelaufen> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT gk.einsatz_id, COALESCE(gk.anzeigename, gk.bezeichnung) AS anzeigename, \
                gk.laeuft_ab_at, COALESCE(gk.bestaetigt_von, gk.erstellt_von) AS von \
         FROM geraet_kopplung gk JOIN einsatz e ON e.id = gk.einsatz_id \
         WHERE gk.ansicht = 'helfer' AND gk.helfer_zustand = 'aktiv' \
           AND gk.widerrufen_at IS NULL AND gk.laeuft_ab_at > ? AND gk.laeuft_ab_at <= ? \
           AND e.status = 'aktiv' AND e.geloescht_at IS NULL AND {} \
         ORDER BY gk.einsatz_id, gk.laeuft_ab_at, gk.id",
        crate::einsatz::spiegel_filter::nicht_gespiegelt("gk.einsatz_id")
    )))
    .bind(crate::zeit::formatiere_utc(seit + vorlauf))
    .bind(crate::zeit::formatiere_utc(bis + vorlauf))
    .fetch_all(pool)
    .await?;
    let mut je_einsatz: Vec<(i64, i64, Vec<BaldAbgelaufen>)> = Vec::new();
    for z in zeilen {
        match je_einsatz.last_mut() {
            Some((eid, _, liste)) if *eid == z.einsatz_id => liste.push(z),
            _ => je_einsatz.push((z.einsatz_id, z.von, vec![z])),
        }
    }
    let mut n = 0;
    for (einsatz_id, von, liste) in je_einsatz {
        // Je Einsatz für sich: ein Fehler hier hielte sonst das Fenster an, und der nächste Takt
        // schriebe die Warnungen der übrigen Einsätze ein zweites Mal.
        match warne_einsatz(pool, einsatz_id, von, &warnung_text(&liste)).await {
            Ok(etb_id) => {
                live.publiziere(einsatz_id, etb_id);
                n += 1;
            }
            Err(e) => tracing::error!(error = %e, einsatz_id, "Helfer-Warnung nicht geschrieben"),
        }
    }
    Ok(n)
}

async fn warne_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    von: i64,
    text: &str,
) -> Result<i64, AppError> {
    let startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    crate::write_retry!(pool, |conn| {
        crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, text).await
    })
}

/// Löscht die Personenposition abgelaufener Helfer-Kopplungen und meldet je Person `personal`
/// und je Kopplung `helfer`. Liefert die Zahl der Personen.
pub async fn raeume_helfer(pool: &SqlitePool, live: &LiveHub) -> Result<usize, AppError> {
    let geraeumt = crate::write_retry!(pool, |conn| {
        // Stufe 2 (ADR-0107): Push-Anmeldungen beendeter Kopplungen gehen mit.
        crate::helfer::push::delete_ended(conn).await?;
        crate::helfer::ende::raeume_abgelaufene(conn, None).await
    })?;
    for g in &geraeumt {
        live.publiziere_objekt(
            g.einsatz_id,
            LiveEvent::Personal,
            "personal_id",
            g.person_id,
        );
        live.publiziere_helfer(g.einsatz_id, g.kopplung_id);
    }
    Ok(geraeumt.len())
}

fn warnung_text(liste: &[BaldAbgelaufen]) -> String {
    let namen: Vec<String> = liste
        .iter()
        .map(|z| format!("„{}“", z.anzeigename))
        .collect();
    let ende = liste.last().map(|z| z.laeuft_ab_at.as_str()).unwrap_or("");
    match namen.as_slice() {
        [einer] => format!("Anmeldung von Helfer {einer} endet um {ende} UTC."),
        _ => format!(
            "Anmeldung von {} Helfern endet bis {ende} UTC: {}.",
            namen.len(),
            namen.join(", ")
        ),
    }
}

/// Führt das Fenster von Takt zu Takt. Es rückt nur nach einer gelungenen Prüfung vor: scheitert
/// die Abfrage, prüft der nächste Takt dasselbe Fenster mit, statt den Ablauf zu verlieren.
#[derive(Debug, Clone, Copy)]
pub struct AblaufFenster {
    letzter: DateTime<Utc>,
}

impl AblaufFenster {
    /// Beginnt bei `start`: Abläufe davor gelten als bekannt.
    pub fn ab(start: DateTime<Utc>) -> Self {
        Self { letzter: start }
    }

    /// Ein Takt bis `jetzt`: Abläufe an Verpflegungsstellen melden und Helfer vor dem Ablauf
    /// warnen. Liefert die Zahl der gemeldeten Einsätze (Verpflegung). Der ETB-Wächter
    /// (`etb::nachlauf::klammer`, `src/AGENTS.md`, „ETB live verteilen“) prüft die Warnungen;
    /// eine Lücke steht im Log.
    pub async fn takt(
        &mut self,
        pool: &SqlitePool,
        live: &LiveHub,
        jetzt: DateTime<Utc>,
    ) -> Result<usize, AppError> {
        let (ergebnis, luecken) = crate::etb::nachlauf::klammer(pool, async {
            let n = melde_abgelaufene(pool, live, self.letzter, jetzt).await?;
            warne_helfer(pool, live, self.letzter, jetzt).await?;
            raeume_helfer(pool, live).await?;
            Ok::<_, AppError>(n)
        })
        .await;
        if !luecken.is_empty() {
            tracing::error!("{}", crate::etb::nachlauf::melde(&luecken));
        }
        let n = ergebnis?;
        self.letzter = jetzt;
        Ok(n)
    }
}
