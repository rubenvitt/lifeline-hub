//! Statement-Zählung der Listenabfragen (LFH-933): eine Liste setzt eine feste Zahl an
//! SQL-Statements ab, gleich wie viele Zeilen sie liefert — kein N+1 je Zeile.
//!
//! Gezählt wird über das Query-Log von sqlx (`target: "sqlx::query"`, eine Meldung je
//! ausgeführtem Statement). sqlx-sqlite führt Statements im Worker-Thread der Verbindung aus,
//! deshalb hört ein PROZESSWEITER Subscriber zu; dieses Binary hat ihn für sich allein, und die
//! Tests hier laufen über [`SPERRE`] nacheinander, damit keiner die Zählung des anderen sieht.

use std::sync::{Mutex, OnceLock};

use lifeline_hub::auftrag::repo::{self as auftrag_repo, AuftragDaten, EmpfaengerEingabe};
use lifeline_hub::auth::Benutzer;
use sqlx::SqlitePool;
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::Layer;

/// Hält die Tests dieses Binaries nacheinander (die Mitschrift ist prozessweit).
static SPERRE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Mitschrift: `Some` = es wird mitgeschrieben.
static MITSCHRIFT: Mutex<Option<Vec<Statement>>> = Mutex::new(None);

/// Ein ausgeführtes Statement: SQL-Text und Zahl der gelieferten Zeilen.
#[derive(Debug)]
struct Statement {
    sql: String,
    zeilen: u64,
}

/// Schreibt den SQL-Text jedes ausgeführten Statements mit, solange [`MITSCHRIFT`] offen ist.
struct Mitschreiber;

impl<S: tracing::Subscriber> Layer<S> for Mitschreiber {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if event.metadata().target() != "sqlx::query" {
            return;
        }
        let mut text = SqlText::default();
        event.record(&mut text);
        if let Some(liste) = MITSCHRIFT.lock().unwrap().as_mut() {
            // Kurze Statements loggt sqlx nur als `summary`, lange zusätzlich ganz.
            liste.push(Statement {
                sql: if text.statement.trim().is_empty() {
                    text.summary
                } else {
                    text.statement
                },
                zeilen: text.zeilen,
            });
        }
    }
}

#[derive(Default)]
struct SqlText {
    summary: String,
    statement: String,
    zeilen: u64,
}

impl Visit for SqlText {
    fn record_u64(&mut self, field: &Field, value: u64) {
        if field.name() == "rows_returned" {
            self.zeilen = value;
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        match field.name() {
            "summary" => self.summary = value.to_owned(),
            "db.statement" => self.statement = value.to_owned(),
            _ => {}
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.record_str(field, &format!("{value:?}"));
    }
}

/// Führt `f` aus und liefert die dabei abgesetzten Statements.
async fn mitschneiden<T>(f: impl std::future::Future<Output = T>) -> (T, Vec<Statement>) {
    static EINMAL: OnceLock<()> = OnceLock::new();
    EINMAL.get_or_init(|| {
        let subscriber = tracing_subscriber::registry().with(
            Mitschreiber.with_filter(
                tracing_subscriber::filter::Targets::new()
                    .with_target("sqlx::query", tracing::Level::TRACE),
            ),
        );
        tracing::subscriber::set_global_default(subscriber).expect("eigener Subscriber");
    });
    *MITSCHRIFT.lock().unwrap() = Some(Vec::new());
    let ergebnis = f.await;
    let statements = MITSCHRIFT.lock().unwrap().take().unwrap_or_default();
    (ergebnis, statements)
}

async fn org_und_benutzer(pool: &SqlitePool, org_id: i64, name: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, ?)")
        .bind(org_id)
        .bind(format!("Org {org_id}"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, ?, ?, 'h') RETURNING id",
    )
    .bind(org_id)
    .bind(name)
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn einsatz(pool: &SqlitePool, org_id: i64) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Lage') RETURNING id")
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn funktion(text: &str) -> EmpfaengerEingabe {
    EmpfaengerEingabe {
        empfaenger_typ: "funktion".into(),
        abschnitt_id: None,
        einheit_id: None,
        person_id: None,
        fahrzeug_id: None,
        funktion_text: Some(text.into()),
        funktion: None,
        extern_kategorie: None,
        extern_bezeichnung: None,
    }
}

/// Einsatz mit `n` Aufträgen zu je zwei Empfängern.
async fn einsatz_mit_auftraegen(pool: &SqlitePool, benutzer: i64, n: usize) -> i64 {
    let e = einsatz(pool, 1).await;
    for i in 0..n {
        let text = format!("Auftrag {i}");
        auftrag_repo::anlegen(
            pool,
            e,
            benutzer,
            AuftragDaten {
                auftrag_text: &text,
                absicht: None,
                lage: None,
                ort: None,
                zeit: None,
                mittel: None,
                verbindung: None,
                sicherheit: None,
                prioritaet: "normal",
                richtung: "intern",
                frist_at: None,
                erteilt_at: "2026-06-11 09:00:00",
                empfaenger: vec![funktion("S3"), funktion("EA Nord")],
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
    }
    e
}

#[tokio::test]
async fn auftragsliste_setzt_feste_zahl_an_statements_ab() {
    let _sperre = SPERRE.lock().await;
    let pool = lifeline_hub::db::test_pool().await;
    let b = org_und_benutzer(&pool, 1, "leit").await;
    let klein = einsatz_mit_auftraegen(&pool, b, 2).await;
    let gross = einsatz_mit_auftraegen(&pool, b, 40).await;
    let jetzt = "2026-06-11 10:00:00";

    let (liste_klein, sql_klein) =
        mitschneiden(auftrag_repo::liste(&pool, klein, None, None, None, jetzt)).await;
    let (liste_gross, sql_gross) =
        mitschneiden(auftrag_repo::liste(&pool, gross, None, None, None, jetzt)).await;
    assert_eq!(liste_klein.unwrap().len(), 2);
    let liste_gross = liste_gross.unwrap();
    assert_eq!(liste_gross.len(), 40);
    assert!(liste_gross.iter().all(|d| d.empfaenger.len() == 2));

    assert_eq!(
        sql_gross.len(),
        sql_klein.len(),
        "Statements wachsen mit der Zahl der Aufträge (N+1): {sql_gross:#?}"
    );
    assert_eq!(
        sql_gross.len(),
        2,
        "Aufträge + Empfänger gebündelt: {sql_gross:#?}"
    );

    // Mit Empfänger-Filter genauso: der Filter wirkt im SQL, nicht nach dem Vollladen.
    let filter = auftrag_repo::EmpfaengerFilter {
        abschnitt_id: Some(1),
        einheit_id: None,
    };
    let (gefiltert, sql_filter) = mitschneiden(auftrag_repo::liste(
        &pool,
        gross,
        Some("offen"),
        None,
        Some(&filter),
        jetzt,
    ))
    .await;
    assert!(gefiltert.unwrap().is_empty());
    assert_eq!(
        sql_filter.len(),
        1,
        "ohne Treffer keine Empfänger-Abfrage: {sql_filter:#?}"
    );
}

/// Die Einsatzliste lädt Labelkarten nur für Orgs, deren Einsätze der Benutzer sieht — für
/// den Helfer die eigene, für den System-Admin alle.
#[tokio::test]
async fn einsatzliste_laedt_labelkarten_nur_fuer_sichtbare_orgs() {
    let _sperre = SPERRE.lock().await;
    let pool = lifeline_hub::db::test_pool().await;
    let helfer = org_und_benutzer(&pool, 1, "helfer").await;
    let admin = org_und_benutzer(&pool, 1, "admin").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(admin)
        .execute(&pool)
        .await
        .unwrap();
    let eigener = einsatz(&pool, 1).await;
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, 'fuehrungspersonal')",
    )
    .bind(eigener)
    .bind(helfer)
    .execute(&pool)
    .await
    .unwrap();
    // Gesperrt, obwohl Mitglied: Tombstone und abgelaufene Aufbewahrungsfrist.
    for sperre in [
        "geloescht_at = '2026-01-02 00:00:00'",
        "status = 'abgeschlossen', abgeschlossen_at = '2026-01-01 00:00:00', \
         retention_bis = '2026-01-02 00:00:00'",
    ] {
        let id = einsatz(&pool, 1).await;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE einsatz SET {sperre} WHERE id = ?"
        )))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        for b in [helfer, admin] {
            sqlx::query(
                "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
                 VALUES (?, ?, 'einsatzleitung')",
            )
            .bind(id)
            .bind(b)
            .execute(&pool)
            .await
            .unwrap();
        }
    }
    for org in 2..=6 {
        org_und_benutzer(&pool, org, &format!("leit{org}")).await;
        einsatz(&pool, org).await;
        einsatz(&pool, org).await;
    }

    let laden = |id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, Benutzer>("SELECT * FROM benutzer WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let karten = |sql: &[Statement]| {
        sql.iter()
            .filter(|s| s.sql.contains("org_fuehrungsfunktion"))
            .count()
    };
    // Die Einsatz-Abfrage selbst: sie liest nur, was der Benutzer sehen darf.
    let gelesene_einsaetze = |sql: &[Statement]| {
        sql.iter()
            .find(|s| s.sql.contains("FROM einsatz e"))
            .map(|s| s.zeilen)
    };

    let helfer = laden(helfer).await;
    let (liste, sql) = mitschneiden(lifeline_hub::einsatz::repo::liste_fuer(&pool, &helfer)).await;
    let liste = liste.unwrap();
    assert_eq!(
        liste.iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![eigener]
    );
    assert_eq!(karten(&sql), 1, "nur die eigene Org: {sql:#?}");
    assert_eq!(
        gelesene_einsaetze(&sql),
        Some(1),
        "gesperrte und fremde Einsätze liest das SQL nicht: {sql:#?}"
    );

    let admin = laden(admin).await;
    let (liste, sql) = mitschneiden(lifeline_hub::einsatz::repo::liste_fuer(&pool, &admin)).await;
    assert_eq!(liste.unwrap().len(), 11);
    assert_eq!(karten(&sql), 6, "je sichtbare Org eine: {sql:#?}");
    assert_eq!(
        gelesene_einsaetze(&sql),
        Some(11),
        "die Sperren gelten auch für den System-Admin"
    );
}
