//! Guard über die eingebackene SQLite-Version (LFH-233/G02).
//!
//! Das Backend kompiliert SQLite als C-Amalgamation ins Binary (`libsqlite3-sys` mit
//! Feature `bundled`). Damit ist die ausgelieferte SQLite-Version **vollständig vom
//! Betriebssystem entkoppelt**: ein `apt upgrade` auf dem Zielrechner erreicht sie nie.
//! Der einzige Fix-Pfad für eine SQLite-CVE ist Crate-Bump → Rebuild → Redeploy.
//!
//! `bundled` ist bewusst (reproduzierbare Builds, keine System-Abhängigkeit); nachgehalten
//! werden muss aber, WELCHE Version drinsteckt — ohne diese Zahl lässt sich im Advisory-Fall
//! nicht einmal feststellen, ob man betroffen ist.
//!
//! Deshalb pinnt dieser Guard die Version hart. Bei jedem `libsqlite3-sys`-Bump wird er rot
//! und erzwingt, dass `docs/betrieb/packaging.md` nachgezogen wird — die Doku kann so nicht
//! unbemerkt veralten.

use lifeline_hub::db;

/// Die aktuell eingebackene SQLite-Version.
///
/// Wird dieser Test rot, ist `libsqlite3-sys` gebumpt worden. Dann BEIDES tun:
/// 1. den Wert hier auf die neue Version setzen,
/// 2. `docs/betrieb/packaging.md` (Abschnitt „Eingebettetes SQLite") nachziehen.
const ERWARTETE_SQLITE_VERSION: &str = "3.51.3";

#[tokio::test]
async fn eingebettete_sqlite_version_ist_dokumentiert() {
    let pool = db::test_pool().await;
    let version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&pool)
        .await
        .expect("sqlite_version() abfragbar");

    assert_eq!(
        version, ERWARTETE_SQLITE_VERSION,
        "Die eingebackene SQLite-Version hat sich von {ERWARTETE_SQLITE_VERSION} auf {version} \
         geändert (libsqlite3-sys-Bump). Diese Version steckt als C-Amalgamation im \
         ausgelieferten Binary und wird von keinem System-Update erreicht — sie muss \
         nachgehalten werden.\n\
         Zu tun: Konstante in tests/sqlite_version.rs aktualisieren UND den Abschnitt \
         „Eingebettetes SQLite\" in docs/betrieb/packaging.md nachziehen."
    );
}
