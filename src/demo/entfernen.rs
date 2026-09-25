//! Der harte Löschweg der Demo-Daten (LFH-690, design.md D7).
//!
//! **Die sicherheitskritischste Stelle des Features.** Das ETB eines echten Einsatzes schützt
//! in der Datenbank nichts außer der WHERE-Bedingung, mit der hier gelöscht wird. Der Löschweg
//! ist deshalb strukturell an die Marke gebunden:
//!
//! - Die Einsatz-ID kommt **ausschließlich aus dem aktiven Kopf** der eigenen Organisation,
//!   nie aus der Anfrage, und die Org steht im WHERE von `demo_import` **und** von `einsatz`.
//!   Ein Kopf, der auf einen Einsatz einer fremden Org zeigt, löscht nichts.
//! - Stammdaten fallen nur, wenn sie eine Marke dieses Kopfes tragen und zur eigenen Org
//!   gehören. Ob eine Zeile noch verwiesen wird, entscheidet die Datenbank selbst: je Zeile ein
//!   `SAVEPOINT`, und ein Fremdschlüsselfehler (SQLite-Code 787) heißt „behalten“. Das trägt
//!   nur, solange kein Fremdschlüssel auf `fahrzeug`/`personal`/`material` kaskadiert und keiner
//!   aufgeschoben ist (Guard `kein_fk_kaskadiert_in_stammdaten` in `schema_tests.rs`) und die
//!   Verbindung Fremdschlüssel sofort prüft (Laufzeitprüfung in [`fk_pruefung_sicherstellen`]).
//!
//! Die Funktion committet nicht; der Aufrufer fährt sie in `write_retry!` (allein oder, beim
//! Neu-Import, vor `importieren_tx` in derselben Transaktion, D11).

use sqlx::SqliteConnection;

use super::{DemoBericht, DemoBerichtZeile, DemoStammdatenArt, DemoVorgang};
use crate::error::AppError;

/// Wie eine Stammdatenart gelöscht wird. Alle Statements sind feste Literale je Tabelle
/// (sqlx 0.9, design.md D4); ein interpolierter Tabellenname kommt hier nicht vor.
struct Loeschweg {
    art: DemoStammdatenArt,
    /// Läuft im selben Savepoint VOR dem Löschen der Zeile. Bindet `(id, org_id)`.
    vorlauf: Option<&'static str>,
    /// Löscht die Zeile, nur in der eigenen Org. Bindet `(id, org_id)`.
    loeschen: &'static str,
}

/// Reihenfolge nach D7: Personal zuerst (samt Qualifikationen), dann Fahrzeug, dann Material.
/// Die Reihenfolge der Berichtszeilen ist davon unabhängig (siehe [`bericht_zeilen`]).
const LOESCHWEGE: [Loeschweg; 3] = [
    Loeschweg {
        art: DemoStammdatenArt::Personal,
        // Die Qualifikationen gehören zur Person und fallen mit ihr. Sie liegen im Savepoint
        // der Person: scheitert die Person an einer Disposition, bringt `ROLLBACK TO` sie
        // zurück. Die Org-Bedingung sitzt in der Unterabfrage, damit auch hier nichts
        // Fremdes fällt.
        vorlauf: Some(
            "DELETE FROM personal_qualifikation \
             WHERE personal_id = (SELECT id FROM personal WHERE id = ? AND org_id = ?)",
        ),
        loeschen: "DELETE FROM personal WHERE id = ? AND org_id = ?",
    },
    Loeschweg {
        art: DemoStammdatenArt::Fahrzeug,
        vorlauf: None,
        loeschen: "DELETE FROM fahrzeug WHERE id = ? AND org_id = ?",
    },
    Loeschweg {
        art: DemoStammdatenArt::Material,
        vorlauf: None,
        loeschen: "DELETE FROM material WHERE id = ? AND org_id = ?",
    },
];

/// Ausgang des Löschversuchs einer markierten Zeile.
enum Ausgang {
    Entfernt,
    /// Noch verwiesen; die Zeile bleibt.
    Behalten,
    /// Keine Zeile dieser ID in der eigenen Org. Zählt weder als entfernt noch als behalten.
    NichtVorhanden,
}

/// Entfernt die Demo-Daten der Organisation (design.md D7) und liefert den Bericht.
///
/// 1. Aktiven Kopf der Org laden, sonst `Conflict` (409, D3).
/// 2. Den Einsatz des Kopfes löschen; die Kaskade räumt alles darunter, auch einen
///    soft-gelöschten oder geschwärzten Demo-Einsatz.
/// 3. Je markierter Stammdatenzeile `SAVEPOINT` → `DELETE` → `RELEASE`; bei einem
///    Fremdschlüsselfehler `ROLLBACK TO` und „behalten“. Jede Marke fällt.
/// 4. Kopf schließen (`entfernt_at`, Bericht). Er bleibt als Historie und ID-Sperre (D6).
///
/// Kein `admin_id`: der Kopf hat keine Spalte „entfernt von“ und der Bericht keinen Akteur.
/// Die Org des Admins reicht für jede Bedingung.
pub async fn entfernen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<DemoBericht, AppError> {
    let (kopf_id, einsatz_id): (i64, i64) = sqlx::query_as(
        "SELECT id, einsatz_id FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| {
        AppError::Conflict("Für diese Organisation sind keine Demo-Daten importiert.".into())
    })?;

    fk_pruefung_sicherstellen(conn).await?;

    // Die ID kommt aus dem Kopf, nie aus der Anfrage, und die Org steht in BEIDEN WHERE:
    // im Kopf (nur der aktive Kopf der eigenen Org) und im Einsatz (nur ein Einsatz der
    // eigenen Org). Ohne das zweite löschte ein Kopf mit fremder `einsatz_id` einen echten
    // Einsatz einer anderen Org samt ETB.
    let geloescht = sqlx::query(
        "DELETE FROM einsatz \
         WHERE id = (SELECT einsatz_id FROM demo_import \
                     WHERE id = ? AND org_id = ? AND entfernt_at IS NULL) \
           AND org_id = ?",
    )
    .bind(kopf_id)
    .bind(org_id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geloescht == 0 {
        // Kein Einsatz der eigenen Org unter dieser ID. Der Kopf wird trotzdem geschlossen,
        // sonst sperrte er den nächsten Import für immer.
        tracing::warn!(
            org_id,
            kopf_id,
            einsatz_id,
            "Demo-Daten entfernen: kein Einsatz der eigenen Org unter der ID des Kopfes"
        );
    }

    let mut zaehler: Vec<(DemoStammdatenArt, i64, i64)> = Vec::new();
    for weg in &LOESCHWEGE {
        let ids: Vec<i64> = sqlx::query_scalar(
            "SELECT datensatz_id FROM demo_herkunft \
             WHERE import_id = ? AND tabelle = ? ORDER BY datensatz_id",
        )
        .bind(kopf_id)
        .bind(weg.art.as_str())
        .fetch_all(&mut *conn)
        .await?;

        let (mut entfernt, mut behalten) = (0, 0);
        for id in ids {
            match zeile_loeschen(conn, weg, id, org_id).await? {
                Ausgang::Entfernt => entfernt += 1,
                Ausgang::Behalten => behalten += 1,
                Ausgang::NichtVorhanden => tracing::warn!(
                    org_id,
                    kopf_id,
                    tabelle = weg.art.as_str(),
                    datensatz_id = id,
                    "Demo-Daten entfernen: Marke ohne Zeile der eigenen Org"
                ),
            }
            // Die Marke fällt in jedem Ausgang: eine behaltene Zeile ist ab jetzt Bestand.
            sqlx::query(
                "DELETE FROM demo_herkunft \
                 WHERE import_id = ? AND tabelle = ? AND datensatz_id = ?",
            )
            .bind(kopf_id)
            .bind(weg.art.as_str())
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
        zaehler.push((weg.art, entfernt, behalten));
    }

    let zeitpunkt: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(&mut *conn)
        .await?;
    let bericht = DemoBericht {
        vorgang: DemoVorgang::Entfernt,
        zeitpunkt,
        je_art: bericht_zeilen(&zaehler),
    };
    let json = serde_json::to_string(&bericht)
        .map_err(|e| AppError::Internal(format!("Demo-Bericht serialisieren: {e}")))?;

    let geschlossen = sqlx::query(
        "UPDATE demo_import SET entfernt_at = ?, bericht = ? \
         WHERE id = ? AND org_id = ? AND entfernt_at IS NULL",
    )
    .bind(&bericht.zeitpunkt)
    .bind(&json)
    .bind(kopf_id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geschlossen != 1 {
        // Unter BEGIN IMMEDIATE kann der Kopf zwischen Laden und Schließen nicht fallen.
        return Err(AppError::Internal(format!(
            "Demo-Kopf {kopf_id} ließ sich nicht schließen ({geschlossen} Zeilen)"
        )));
    }
    Ok(bericht)
}

/// Versucht eine markierte Zeile in einem eigenen Savepoint zu löschen.
async fn zeile_loeschen(
    conn: &mut SqliteConnection,
    weg: &Loeschweg,
    id: i64,
    org_id: i64,
) -> Result<Ausgang, AppError> {
    sqlx::query("SAVEPOINT demo_zeile")
        .execute(&mut *conn)
        .await?;

    let versuch: Result<u64, sqlx::Error> = async {
        if let Some(vorlauf) = weg.vorlauf {
            sqlx::query(vorlauf)
                .bind(id)
                .bind(org_id)
                .execute(&mut *conn)
                .await?;
        }
        Ok(sqlx::query(weg.loeschen)
            .bind(id)
            .bind(org_id)
            .execute(&mut *conn)
            .await?
            .rows_affected())
    }
    .await;

    match versuch {
        Ok(zeilen) => {
            sqlx::query("RELEASE demo_zeile")
                .execute(&mut *conn)
                .await?;
            Ok(if zeilen == 0 {
                Ausgang::NichtVorhanden
            } else {
                Ausgang::Entfernt
            })
        }
        Err(e) if ist_fk_verletzung(&e) => {
            // Noch verwiesen: alles aus diesem Savepoint zurück, auch die Qualifikationen.
            sqlx::query("ROLLBACK TO demo_zeile")
                .execute(&mut *conn)
                .await?;
            sqlx::query("RELEASE demo_zeile")
                .execute(&mut *conn)
                .await?;
            Ok(Ausgang::Behalten)
        }
        // Jeder andere Fehler bricht den ganzen Vorgang ab; der Aufrufer rollt zurück.
        Err(e) => Err(e.into()),
    }
}

/// `true`, wenn der Fehler eine Fremdschlüsselverletzung ist. sqlx 0.9 liest den
/// erweiterten SQLite-Code (`sqlite3_extended_errcode`) und bildet
/// `SQLITE_CONSTRAINT_FOREIGNKEY` (787) auf `ErrorKind::ForeignKeyViolation` ab.
pub(crate) fn ist_fk_verletzung(fehler: &sqlx::Error) -> bool {
    matches!(fehler, sqlx::Error::Database(db) if db.is_foreign_key_violation())
}

/// Der Savepoint erkennt „noch verwiesen“ nur, wenn die Verbindung Fremdschlüssel prüft und
/// sie **sofort** prüft. Ohne Prüfung gelänge jedes Stammdaten-DELETE und ließe
/// Dispositionen echter Einsätze ins Leere zeigen; aufgeschoben käme der Fehler erst beim
/// COMMIT und bräche den ganzen Vorgang ab, statt die Zeile zu behalten. Beides ist heute
/// ausgeschlossen (`db::connect` setzt `foreign_keys(true)`, `defer_foreign_keys` setzt
/// niemand) — die Prüfung hält das zur Laufzeit fest, statt es anzunehmen.
async fn fk_pruefung_sicherstellen(conn: &mut SqliteConnection) -> Result<(), AppError> {
    let an: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *conn)
        .await?;
    let aufgeschoben: i64 = sqlx::query_scalar("PRAGMA defer_foreign_keys")
        .fetch_one(&mut *conn)
        .await?;
    if an != 1 || aufgeschoben != 0 {
        return Err(AppError::Internal(format!(
            "Demo-Daten entfernen verweigert: foreign_keys={an}, defer_foreign_keys={aufgeschoben}"
        )));
    }
    Ok(())
}

/// Je Art eine Zeile, immer alle drei, in Enum-Reihenfolge — auch mit Nullen. `angelegt` und
/// `mitbenutzt` gehören zum Import-Bericht und stehen hier auf 0.
fn bericht_zeilen(zaehler: &[(DemoStammdatenArt, i64, i64)]) -> Vec<DemoBerichtZeile> {
    [
        DemoStammdatenArt::Fahrzeug,
        DemoStammdatenArt::Personal,
        DemoStammdatenArt::Material,
    ]
    .into_iter()
    .map(|art| {
        let (entfernt, behalten) = zaehler
            .iter()
            .find(|(a, _, _)| *a == art)
            .map(|(_, e, b)| (*e, *b))
            .unwrap_or((0, 0));
        DemoBerichtZeile {
            art,
            angelegt: 0,
            mitbenutzt: 0,
            entfernt,
            behalten,
        }
    })
    .collect()
}
