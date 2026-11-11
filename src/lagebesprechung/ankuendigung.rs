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
    ///
    /// Spiegel bleiben aus (LLH-1492, design.md D10): ihren Termin kündigt der Führer an, und der
    /// Merker an einem Spiegel scheiterte am Schutz-Trigger samt allen Einsätzen dahinter.
    fn sql_faellige(self) -> String {
        let merker = match self {
            Ankuendigung::Vorher => "lagebesprechung_angekuendigt_vorher_at",
            Ankuendigung::Faellig => "lagebesprechung_angekuendigt_faellig_at",
        };
        format!(
            "SELECT id, naechste_lagebesprechung_at FROM einsatz \
             WHERE status = 'aktiv' AND {merker} IS NULL \
               AND naechste_lagebesprechung_at > ?1 AND naechste_lagebesprechung_at <= ?2 \
               AND {} \
             ORDER BY id",
            crate::einsatz::spiegel_filter::nicht_gespiegelt("einsatz.id")
        )
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
    let faellige: Vec<(i64, String)> =
        sqlx::query_as(sqlx::AssertSqlSafe(ankuendigung.sql_faellige()))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    /// LLH-1492 (design.md D10): ein Spiegel wird nicht angekündigt, und sein Merker bleibt leer.
    /// Der Spiegel steht vor dem eigenen Einsatz; versuchte der Lauf ihn zu merken, bräche das am
    /// Schutz-Trigger ab und nähme den eigenen Einsatz mit.
    #[tokio::test]
    async fn spiegel_wird_ausgelassen_und_haelt_den_eigenen_nicht_auf() {
        let (puffer, _log) = crate::test_log::LogPuffer::einfangen();
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let mut ids = Vec::new();
        for bezeichnung in ["Spiegel", "Eigen"] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung, naechste_lagebesprechung_at) \
                 VALUES (1, ?, '2026-06-11 10:10:00') RETURNING id",
            )
            .bind(bezeichnung)
            .fetch_one(&pool)
            .await
            .unwrap();
            ids.push(id);
        }
        let (spiegel, eigen) = (ids[0], ids[1]);
        crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, spiegel).await;

        let live = LiveHub::new();
        assert_eq!(ankuendigen(&pool, &live, t("2026-06-11 10:00:00")).await, 1);

        let merker = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, Option<String>>(
                    "SELECT lagebesprechung_angekuendigt_vorher_at FROM einsatz WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(merker(eigen).await.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(merker(spiegel).await, None);
        let log = puffer.text();
        assert!(
            !log.contains(crate::instanz::spiegel::SCHUTZ_NACHRICHT),
            "{log}"
        );
    }
}
