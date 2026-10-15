//! Ankündigung der nächsten Lagebesprechung (LLH-1215, Change `kcjecn9e-benachrichtigungskonzept`,
//! design.md D10, Spec `benachrichtigungen`, „Lagebesprechung steht an“).
//!
//! Der Erinnerungs-Scheduler ruft [`ankuendigen`] je Tick. Für jeden laufenden Einsatz mit Termin
//! `naechste_lagebesprechung_at` meldet es 10 Minuten vorher `lagebesprechung_vorher` und bei
//! Erreichen `lagebesprechung_faellig` an EL und S1 bis S7, ohne Auslöser. Wer davon etwas
//! bekommt, entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`, Benachrichtigungen).
//!
//! **Je Termin genau einmal:** zwei Merker am Einsatz (`lagebesprechung_angekuendigt_vorher_at`,
//! `…_faellig_at`) werden VOR dem Melden per Vergleich gesetzt; nur wer die Zeile damit trifft,
//! meldet. Ein zweiter Lauf oder ein paralleler findet den Merker gesetzt. Ändert ein Schreibweg
//! den Termin, leert er beide in derselben Anweisung ([`super::repo`]); der Vergleich auf den
//! gelesenen Termin verhindert, dass ein inzwischen verschobener Termin als der alte angekündigt
//! wird.
//!
//! **Nur im Zeitfenster:** angekündigt wird höchstens [`NACHHOLEN_MINUTEN`] nach dem jeweiligen
//! Zeitpunkt. Ein vergangener Termin, ein Termin, der zu knapp gesetzt wurde, um noch 10 Minuten
//! vorher anzukündigen, oder ein längerer Stillstand des Servers holen nichts nach: „in 10
//! Minuten“ für eine Besprechung in zwei Minuten wäre falsch, „jetzt fällig“ eine Stunde später
//! ebenso. Die Seite Lagebesprechung zeigt den Zustand des Termins ohnehin.

use chrono::{DateTime, Duration, Utc};
use sqlx::SqlitePool;

use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;

/// So viele Minuten vor dem Termin kommt der erste Hinweis (Spec: „10 Minuten vorher“).
pub const VORLAUF_MINUTEN: i64 = 10;

/// So lange nach dem jeweiligen Zeitpunkt wird eine Ankündigung noch nachgeholt (vier Ticks des
/// Schedulers).
pub const NACHHOLEN_MINUTEN: i64 = 2;

/// Der Stab, den die Ankündigung adressiert: EL und S1 bis S7 (design.md D10).
const STAB: [Fuehrungsfunktion; 8] = [
    Fuehrungsfunktion::El,
    Fuehrungsfunktion::S1,
    Fuehrungsfunktion::S2,
    Fuehrungsfunktion::S3,
    Fuehrungsfunktion::S4,
    Fuehrungsfunktion::S5,
    Fuehrungsfunktion::S6,
    Fuehrungsfunktion::S7,
];

/// Die beiden Ankündigungen eines Termins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ankuendigung {
    Vorher,
    Faellig,
}

impl Ankuendigung {
    fn art(self) -> BenachrichtigungArt {
        match self {
            Ankuendigung::Vorher => BenachrichtigungArt::LagebesprechungVorher,
            Ankuendigung::Faellig => BenachrichtigungArt::LagebesprechungFaellig,
        }
    }

    /// Minuten vom Termin bis zum Zeitpunkt der Ankündigung.
    fn versatz_minuten(self) -> i64 {
        match self {
            Ankuendigung::Vorher => -VORLAUF_MINUTEN,
            Ankuendigung::Faellig => 0,
        }
    }

    /// Laufende Einsätze, deren Ankündigung jetzt ansteht und noch nicht erfolgt ist: der
    /// Zeitpunkt (Termin + Versatz) liegt in `(jetzt − NACHHOLEN, jetzt]`, also der Termin in
    /// `(?1, ?2]`. Die Zeiten sind kanonisch (`crate::zeit::FORMAT`), der Textvergleich ordnet
    /// richtig.
    fn sql_faellige(self) -> &'static str {
        match self {
            Ankuendigung::Vorher => {
                "SELECT id, naechste_lagebesprechung_at FROM einsatz \
                 WHERE status = 'aktiv' AND lagebesprechung_angekuendigt_vorher_at IS NULL \
                   AND naechste_lagebesprechung_at > ?1 AND naechste_lagebesprechung_at <= ?2 \
                 ORDER BY id"
            }
            Ankuendigung::Faellig => {
                "SELECT id, naechste_lagebesprechung_at FROM einsatz \
                 WHERE status = 'aktiv' AND lagebesprechung_angekuendigt_faellig_at IS NULL \
                   AND naechste_lagebesprechung_at > ?1 AND naechste_lagebesprechung_at <= ?2 \
                 ORDER BY id"
            }
        }
    }

    /// Setzt den Merker, solange der Termin noch der gelesene ist und der Merker leer.
    fn sql_merken(self) -> &'static str {
        match self {
            Ankuendigung::Vorher => {
                "UPDATE einsatz SET lagebesprechung_angekuendigt_vorher_at = ?1 \
                 WHERE id = ?2 AND status = 'aktiv' AND naechste_lagebesprechung_at = ?3 \
                   AND lagebesprechung_angekuendigt_vorher_at IS NULL"
            }
            Ankuendigung::Faellig => {
                "UPDATE einsatz SET lagebesprechung_angekuendigt_faellig_at = ?1 \
                 WHERE id = ?2 AND status = 'aktiv' AND naechste_lagebesprechung_at = ?3 \
                   AND lagebesprechung_angekuendigt_faellig_at IS NULL"
            }
        }
    }
}

/// Ein Lauf für den Zeitpunkt `jetzt`: kündigt jeden anstehenden Termin an. Liefert die Zahl der
/// Ankündigungen (Einsätze, nicht Empfänger). Fehler werden geloggt; der nächste Tick versucht es
/// erneut, solange das Zeitfenster offen ist.
pub async fn ankuendigen(pool: &SqlitePool, live: &LiveHub, jetzt: DateTime<Utc>) -> usize {
    let mut anzahl = 0;
    for ankuendigung in [Ankuendigung::Vorher, Ankuendigung::Faellig] {
        match ankuendigen_fuer(pool, live, jetzt, ankuendigung).await {
            Ok(n) => anzahl += n,
            Err(e) => tracing::warn!(
                art = ankuendigung.art().as_str(),
                fehler = %e,
                "Lagebesprechung nicht angekündigt"
            ),
        }
    }
    anzahl
}

async fn ankuendigen_fuer(
    pool: &SqlitePool,
    live: &LiveHub,
    jetzt: DateTime<Utc>,
    ankuendigung: Ankuendigung,
) -> Result<usize, AppError> {
    // Termin = Zeitpunkt − Versatz; der Zeitpunkt liegt in (jetzt − NACHHOLEN, jetzt].
    let bis = jetzt - Duration::minutes(ankuendigung.versatz_minuten());
    let ab = bis - Duration::minutes(NACHHOLEN_MINUTEN);
    let faellige: Vec<(i64, String)> = sqlx::query_as(ankuendigung.sql_faellige())
        .bind(crate::zeit::formatiere_utc(ab))
        .bind(crate::zeit::formatiere_utc(bis))
        .fetch_all(pool)
        .await?;
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let mut anzahl = 0;
    for (einsatz_id, termin) in faellige {
        let gemerkt = sqlx::query(ankuendigung.sql_merken())
            .bind(&jetzt_s)
            .bind(einsatz_id)
            .bind(&termin)
            .execute(pool)
            .await?
            .rows_affected()
            == 1;
        if !gemerkt {
            continue;
        }
        let anlass = STAB.into_iter().fold(
            Anlass::neu(
                einsatz_id,
                ankuendigung.art(),
                Bezug::neu(BenachrichtigungBezugTyp::Lagebesprechung, einsatz_id),
            ),
            |anlass, f| anlass.an(Adressat::Funktion(f)),
        );
        melden(pool, live, anlass).await;
        anzahl += 1;
    }
    Ok(anzahl)
}
