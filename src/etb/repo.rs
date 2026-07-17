use super::EtbEintragAnzeige;
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};

/// Eingabedaten für einen neuen ETB-Eintrag. Alle Werte sind bereits
/// validiert und normalisiert (Zeitformat, Pflichtfelder) — das ist Aufgabe
/// des Handlers. Das Repository vergibt `lfd_nr` und `received_at`.
#[derive(Debug)]
pub struct EintragDaten<'a> {
    pub typ: &'a str,
    pub inhalt: &'a str,
    pub von: Option<&'a str>,
    pub an: Option<&'a str>,
    pub meldeweg: Option<&'a str>,
    pub veranlassung: Option<&'a str>,
    /// `None` = Server vergibt `datetime('now')`.
    pub ereigniszeit: Option<&'a str>,
    pub erfasst_lokal_at: Option<&'a str>,
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Legt einen ETB-Eintrag auf einer beliebigen Connection/Transaktion an und
/// liefert die neue `id`. Vergibt `lfd_nr` atomar (`COALESCE(MAX(lfd_nr)+1, ?startwert)`
/// über alle Einträge desselben Einsatzes — die erste Nummer ist `startwert`, danach
/// fortlaufend); `received_at` per Spalten-Default. Der `startwert` stammt aus den
/// Einsatz-Einstellungen (LFH-133); der pool-besitzende Aufrufer lädt ihn und reicht
/// `etb_startwert()` durch (Default 1 = altes Verhalten).
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    startwert: i64,
    daten: EintragDaten<'_>,
) -> Result<i64, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag \
            (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung, \
             erfasser_id, ereigniszeit, erfasst_lokal_at, berichtigt_eintrag_id) \
         SELECT ?, COALESCE(MAX(lfd_nr) + 1, ?), ?, ?, ?, ?, ?, ?, ?, \
                COALESCE(?, datetime('now')), ?, ? \
         FROM etb_eintrag WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(startwert)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.von)
    .bind(daten.an)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(erfasser_id)
    .bind(daten.ereigniszeit)
    .bind(daten.erfasst_lokal_at)
    .bind(daten.berichtigt_eintrag_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Legt einen ETB-Eintrag an und liefert ihn als Anzeige zurück.
/// Dünner Wrapper um `anlegen_tx` auf einer frischen Pool-Connection. Lädt den
/// ETB-Startwert (LFH-133) aus den Einsatz-Einstellungen (Default 1) und reicht ihn durch.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EintragDaten<'_>,
) -> Result<EtbEintragAnzeige, AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let id = {
        let mut conn = pool.acquire().await?;
        anlegen_tx(&mut *conn, einsatz_id, erfasser_id, startwert, daten).await?
        // conn fällt hier aus dem Scope → PoolConnection::drop gibt die Verbindung zurück
    };
    laden(pool, id).await
}

/// Legt einen client-erfassten ETB-Eintrag idempotent an (F03/LFH-261).
///
/// Trägt der Aufrufer eine `client_id` (client-generierte UUID der Offline-/Direkterfassung),
/// dedupliziert diese Funktion gegen `UNIQUE(einsatz_id, client_id)`: ein erneutes Senden
/// desselben Eintrags — Retry nach verlorener Antwort, Doppel-Flush aus zwei Tabs — liefert
/// die BESTEHENDE Antwort zurück, statt eine Dublette mit neuer `lfd_nr` zu erzeugen. Rückgabe
/// `(anzeige, war_neu)`; bei `war_neu = false` (idempotenter Replay) unterdrückt der Aufrufer
/// das Live-Event, damit kein doppeltes SSE-Signal für denselben Eintrag entsteht.
///
/// Ohne `client_id` (kein Idempotenzschlüssel) ist es ein normaler Insert (`anlegen`),
/// immer `war_neu = true`.
pub async fn anlegen_idempotent(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    daten: EintragDaten<'_>,
) -> Result<(EtbEintragAnzeige, bool), AppError> {
    let Some(cid) = client_id else {
        return Ok((anlegen(pool, einsatz_id, erfasser_id, daten).await?, true));
    };

    // Schneller Replay-Pfad: Eintrag mit dieser client_id existiert schon.
    if let Some(id) = bestehende_client_id(pool, einsatz_id, cid).await? {
        return Ok((laden(pool, id).await?, false));
    }

    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut conn = pool.acquire().await?;
    match insert_mit_client_id(&mut conn, einsatz_id, erfasser_id, startwert, cid, &daten).await {
        Ok(id) => {
            drop(conn);
            Ok((laden(pool, id).await?, true))
        }
        // Race: ein konkurrenter Flush hat dieselbe client_id zwischen SELECT und INSERT
        // eingefügt → exactly-once. Wir liefern den bestehenden Eintrag (war_neu=false).
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            drop(conn);
            match bestehende_client_id(pool, einsatz_id, cid).await? {
                Some(id) => Ok((laden(pool, id).await?, false)),
                None => Err(sqlx::Error::Database(db).into()),
            }
        }
        Err(e) => Err(e.into()),
    }
}

/// id des Eintrags mit dieser `(einsatz_id, client_id)`, falls vorhanden.
async fn bestehende_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT id FROM etb_eintrag WHERE einsatz_id = ? AND client_id = ?")
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Wie `anlegen_tx`, bindet zusätzlich `client_id`. Liefert den rohen sqlx-Fehler,
/// damit der Aufrufer die UNIQUE-Verletzung (Race) vom übrigen Fehlerbild trennen kann.
async fn insert_mit_client_id(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    startwert: i64,
    client_id: &str,
    daten: &EintragDaten<'_>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO etb_eintrag \
            (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung, \
             erfasser_id, ereigniszeit, erfasst_lokal_at, berichtigt_eintrag_id, client_id) \
         SELECT ?, COALESCE(MAX(lfd_nr) + 1, ?), ?, ?, ?, ?, ?, ?, ?, \
                COALESCE(?, datetime('now')), ?, ?, ? \
         FROM etb_eintrag WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(startwert)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.von)
    .bind(daten.an)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(erfasser_id)
    .bind(daten.ereigniszeit)
    .bind(daten.erfasst_lokal_at)
    .bind(daten.berichtigt_eintrag_id)
    .bind(client_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await
}

/// Lädt einen einzelnen Eintrag als Anzeige (inkl. Erfasser-Name).
/// `NotFound`, wenn der Eintrag nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<EtbEintragAnzeige, AppError> {
    sqlx::query_as::<_, EtbEintragAnzeige>(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id, e.lagebericht_id, e.auftrag_id, \
                e.befehl_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
         WHERE e.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Eintrag mit `eintrag_id` zum angegebenen `einsatz_id` gehört.
/// Für die Validierung von Berichtigungs-Verweisen.
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    eintrag_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM etb_eintrag WHERE id = ? AND einsatz_id = ?")
            .bind(eintrag_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Standard-Seitengröße der ETB-Abfrage.
pub const STANDARD_LIMIT: i64 = 100;
/// Maximale Seitengröße (Schutz vor Riesen-Responses).
pub const MAX_LIMIT: i64 = 500;

/// Filter- und Pagination-Parameter für die ETB-Abfrage.
/// Alle Filter sind optional und werden mit UND verknüpft.
#[derive(Debug, Default)]
pub struct EtbFilter {
    /// Volltextsuche (FTS5) über Inhalt/Von/An/Veranlassung. Wird in Task 6 ausgewertet.
    pub q: Option<String>,
    /// Eintragstyp-Filter (z.B. "meldung").
    pub typ: Option<String>,
    /// Untere Grenze `ereigniszeit >=` (normalisiert).
    pub von_zeit: Option<String>,
    /// Obere Grenze `ereigniszeit <=` (normalisiert).
    pub bis_zeit: Option<String>,
    /// Filter nach Erfasser.
    pub erfasser_id: Option<i64>,
    /// Cursor: nur Einträge mit `lfd_nr <` diesem Wert (für ältere Seiten).
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (vom Handler auf [1, MAX_LIMIT] geklemmt).
    pub limit: i64,
}

/// Fragt Einträge eines Einsatzes ab. Sortierung: `lfd_nr DESC` (neueste zuerst),
/// stabiler Cursor über `before_lfd_nr`. Die fachliche Anzeige-Sortierung nach
/// `ereigniszeit` erfolgt clientseitig (beide Zeitstempel werden geliefert).
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &EtbFilter,
) -> Result<Vec<EtbEintragAnzeige>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id, e.lagebericht_id, e.auftrag_id, \
                e.befehl_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id",
    );

    // FTS-Join nur, wenn ein Volltext-Query gesetzt ist (Auswertung in Task 6).
    // Der Join verbindet nur per rowid; das MATCH gehört in die WHERE-Klausel
    // (FTS5 wertet MATCH nur als top-level AND-Term gegen die FTS-Tabelle aus).
    let fts: Option<String> = filter
        .q
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(fts_query)
        // Falls die Eingabe nur Sonderzeichen war, ist die FTS-Query leer → kein Filter.
        .filter(|s| !s.is_empty());
    // FTS-Tabelle NICHT aliasen: das MATCH-Prädikat muss die FTS-Tabelle beim
    // Originalnamen ansprechen (`etb_eintrag_fts MATCH ?`). Eine Alias-Kurzform
    // wie `f MATCH ?` lehnt SQLite mit "no such column: f" ab.
    if fts.is_some() {
        qb.push(" JOIN etb_eintrag_fts ON etb_eintrag_fts.rowid = e.id");
    }

    qb.push(" WHERE e.einsatz_id = ");
    qb.push_bind(einsatz_id);

    if let Some(fts_q) = fts {
        qb.push(" AND etb_eintrag_fts MATCH ");
        qb.push_bind(fts_q);
    }

    if let Some(typ) = &filter.typ {
        qb.push(" AND e.typ = ");
        qb.push_bind(typ);
    }
    if let Some(v) = &filter.von_zeit {
        qb.push(" AND e.ereigniszeit >= ");
        qb.push_bind(v);
    }
    if let Some(b) = &filter.bis_zeit {
        qb.push(" AND e.ereigniszeit <= ");
        qb.push_bind(b);
    }
    if let Some(eid) = filter.erfasser_id {
        qb.push(" AND e.erfasser_id = ");
        qb.push_bind(eid);
    }
    if let Some(cursor) = filter.before_lfd_nr {
        qb.push(" AND e.lfd_nr < ");
        qb.push_bind(cursor);
    }

    qb.push(" ORDER BY e.lfd_nr DESC LIMIT ");
    qb.push_bind(filter.limit);

    qb.build_query_as::<EtbEintragAnzeige>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Wandelt eine Nutzereingabe in eine sichere FTS5-Query um: jedes Token wird
/// als Phrase in Anführungszeichen gesetzt (interne `"` verdoppelt), Tokens mit
/// Leerzeichen verbunden (FTS5 = implizites UND). Verhindert Syntaxfehler bei
/// Sonderzeichen wie `:`, `*`, `AND`.
///
/// Tokens ohne alphanumerische Zeichen (z.B. `*`, `:`) werden verworfen: sie
/// würden nach dem Quoten zu einer leeren Phrase, die FTS5 als Syntaxfehler
/// ablehnt. Enthält die Eingabe nur solche Tokens, ist das Ergebnis ein leerer
/// String (der Aufrufer behandelt leeres `q` als „kein Filter").
fn fts_query(eingabe: &str) -> String {
    eingabe
        .split_whitespace()
        .filter(|t| t.chars().any(|c| c.is_alphanumeric()))
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::etb::EtbTyp;

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an;
    /// liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h')",
        )
        .execute(pool)
        .await
        .unwrap();
        let benutzer_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(pool)
                .await
                .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    fn daten(inhalt: &str) -> EintragDaten<'_> {
        EintragDaten {
            typ: "meldung",
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some("2026-05-23 10:00:00"),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        }
    }

    #[tokio::test]
    async fn anlegen_idempotent_gleiche_client_id_ist_replay_ohne_dublette() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let (e1, neu1) =
            anlegen_idempotent(&pool, einsatz, benutzer, Some("uuid-1"), daten("Erste"))
                .await
                .unwrap();
        assert!(neu1, "erster Insert ist neu");

        // Retry mit derselben client_id (verlorene Antwort / Doppel-Flush) → bestehender
        // Eintrag, KEINE Dublette, war_neu=false.
        let (e1_wieder, neu2) =
            anlegen_idempotent(&pool, einsatz, benutzer, Some("uuid-1"), daten("Erste"))
                .await
                .unwrap();
        assert!(!neu2, "Replay derselben client_id ist nicht neu");
        assert_eq!(e1.id, e1_wieder.id, "Replay liefert dieselbe id");
        assert_eq!(
            e1.lfd_nr, e1_wieder.lfd_nr,
            "Replay liefert dieselbe lfd_nr"
        );

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "kein doppelter Eintrag trotz zweitem Aufruf");
    }

    #[tokio::test]
    async fn anlegen_idempotent_ohne_client_id_immer_neu() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let (_e1, neu1) = anlegen_idempotent(&pool, einsatz, benutzer, None, daten("A"))
            .await
            .unwrap();
        let (_e2, neu2) = anlegen_idempotent(&pool, einsatz, benutzer, None, daten("B"))
            .await
            .unwrap();
        assert!(neu1 && neu2, "ohne client_id ist jeder Insert neu");

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2, "ohne client_id kein Dedup");
    }

    #[tokio::test]
    async fn lfd_nr_startet_bei_eins_und_zaehlt_hoch() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let e1 = anlegen(&pool, einsatz, benutzer, daten("Erste Meldung"))
            .await
            .unwrap();
        let e2 = anlegen(&pool, einsatz, benutzer, daten("Zweite Meldung"))
            .await
            .unwrap();
        assert_eq!(e1.lfd_nr, 1);
        assert_eq!(e2.lfd_nr, 2);
        assert_eq!(e1.erfasser_name, "Leitung");
        assert!(!e1.received_at.is_empty());
    }

    #[tokio::test]
    async fn startwert_aus_einstellungen_wirkt_auf_erste_nummer() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        // Nummernkreis-Startwert 100 konfigurieren (LFH-133).
        crate::einsatz::einstellungen::speichern(
            &pool,
            einsatz,
            benutzer,
            crate::einsatz::einstellungen::EinstellungenDaten {
                etb_nummer_start: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let e1 = anlegen(&pool, einsatz, benutzer, daten("Erste"))
            .await
            .unwrap();
        let e2 = anlegen(&pool, einsatz, benutzer, daten("Zweite"))
            .await
            .unwrap();
        assert_eq!(e1.lfd_nr, 100, "erste Nummer = Startwert");
        assert_eq!(e2.lfd_nr, 101, "danach fortlaufend");
    }

    #[tokio::test]
    async fn ohne_einstellung_startet_lfd_nr_weiter_bei_eins() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        // Keine Einstellungen → Default-Startwert 1 (altes Verhalten unverändert).
        let e1 = anlegen(&pool, einsatz, benutzer, daten("Erste"))
            .await
            .unwrap();
        assert_eq!(e1.lfd_nr, 1);
    }

    #[tokio::test]
    async fn lfd_nr_ist_pro_einsatz_unabhaengig() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz_a) = setup(&pool).await;
        let einsatz_b: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        anlegen(&pool, einsatz_a, benutzer, daten("A1"))
            .await
            .unwrap();
        let b1 = anlegen(&pool, einsatz_b, benutzer, daten("B1"))
            .await
            .unwrap();
        assert_eq!(b1.lfd_nr, 1);
    }

    #[tokio::test]
    async fn ereigniszeit_default_wird_gesetzt_wenn_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut d = daten("Ohne Ereigniszeit");
        d.ereigniszeit = None;

        let e = anlegen(&pool, einsatz, benutzer, d).await.unwrap();
        // datetime('now') liefert das kanonische Format YYYY-MM-DD HH:MM:SS (19 Zeichen).
        assert_eq!(
            e.ereigniszeit.len(),
            19,
            "Server-Default muss kanonisches SQLite-Zeitformat sein"
        );
    }

    #[tokio::test]
    async fn berichtigung_verknuepft_originaleintrag() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let original = anlegen(&pool, einsatz, benutzer, daten("Tippfehler"))
            .await
            .unwrap();

        let mut korrektur = daten("Korrektur des Eintrags");
        korrektur.typ = "berichtigung";
        korrektur.berichtigt_eintrag_id = Some(original.id);
        let b = anlegen(&pool, einsatz, benutzer, korrektur).await.unwrap();

        assert_eq!(b.typ, EtbTyp::Berichtigung);
        assert_eq!(b.berichtigt_eintrag_id, Some(original.id));
        assert_eq!(b.lfd_nr, 2);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, benutzer, daten("X")).await.unwrap();

        assert!(gehoert_zu_einsatz(&pool, e.id, einsatz).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, e.id, 999).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(
            laden(&pool, 999).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    fn filter() -> EtbFilter {
        EtbFilter {
            limit: STANDARD_LIMIT,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn abfrage_sortiert_neueste_zuerst() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("erst"))
            .await
            .unwrap();
        anlegen(&pool, einsatz, benutzer, daten("dann"))
            .await
            .unwrap();

        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].lfd_nr, 2, "neuester Eintrag zuerst");
        assert_eq!(liste[1].lfd_nr, 1);
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_typ() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("eine meldung"))
            .await
            .unwrap();
        let mut anordnung = daten("eine anordnung");
        anordnung.typ = "anordnung";
        anlegen(&pool, einsatz, benutzer, anordnung).await.unwrap();

        let mut f = filter();
        f.typ = Some("anordnung".into());
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].typ, EtbTyp::Anordnung);
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_zeitraum() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut frueh = daten("frueh");
        frueh.ereigniszeit = Some("2026-05-23 08:00:00");
        anlegen(&pool, einsatz, benutzer, frueh).await.unwrap();
        let mut spaet = daten("spaet");
        spaet.ereigniszeit = Some("2026-05-23 18:00:00");
        anlegen(&pool, einsatz, benutzer, spaet).await.unwrap();

        let mut f = filter();
        f.von_zeit = Some("2026-05-23 12:00:00".into());
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt, "spaet");
    }

    #[tokio::test]
    async fn abfrage_cursor_blaettert_zu_aelteren() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for i in 1..=3 {
            anlegen(&pool, einsatz, benutzer, daten(&format!("e{i}")))
                .await
                .unwrap();
        }

        let mut f = filter();
        f.limit = 1;
        let seite1 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite1[0].lfd_nr, 3);

        f.before_lfd_nr = Some(seite1[0].lfd_nr);
        let seite2 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite2[0].lfd_nr, 2);
    }

    #[tokio::test]
    async fn abfrage_limit_begrenzt_anzahl() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for i in 1..=5 {
            anlegen(&pool, einsatz, benutzer, daten(&format!("e{i}")))
                .await
                .unwrap();
        }
        let mut f = filter();
        f.limit = 2;
        assert_eq!(abfrage(&pool, einsatz, &f).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn suche_findet_eintrag_per_volltext() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Deich bei km 12 instabil"))
            .await
            .unwrap();
        anlegen(&pool, einsatz, benutzer, daten("Lagebesprechung 14 Uhr"))
            .await
            .unwrap();

        let mut f = filter();
        f.q = Some("Deich".into());
        let treffer = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(treffer.len(), 1);
        assert!(treffer[0].inhalt.contains("Deich"));
    }

    #[tokio::test]
    async fn suche_kombiniert_mit_typ_filter() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Hochwasser steigt"))
            .await
            .unwrap();
        let mut anordnung = daten("Hochwasser-Sperre einrichten");
        anordnung.typ = "anordnung";
        anlegen(&pool, einsatz, benutzer, anordnung).await.unwrap();

        let mut f = filter();
        f.q = Some("Hochwasser".into());
        f.typ = Some("anordnung".into());
        let treffer = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(treffer.len(), 1);
        assert_eq!(treffer[0].typ, EtbTyp::Anordnung);
    }

    #[tokio::test]
    async fn suche_mit_sonderzeichen_wirft_keinen_fehler() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Status: alles ruhig"))
            .await
            .unwrap();

        // FTS5-Sonderzeichen dürfen keinen Syntaxfehler auslösen (Escaping greift).
        let mut f = filter();
        f.q = Some("Status: \"alles\" AND *".into());
        let ergebnis = abfrage(&pool, einsatz, &f).await;
        assert!(
            ergebnis.is_ok(),
            "Sonderzeichen müssen sicher behandelt werden"
        );
    }

    #[tokio::test]
    async fn suche_findet_in_von_feld() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut d = daten("Routinemeldung");
        d.von = Some("Abschnitt Nord");
        anlegen(&pool, einsatz, benutzer, d).await.unwrap();

        let mut f = filter();
        f.q = Some("Nord".into());
        assert_eq!(abfrage(&pool, einsatz, &f).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_bis_zeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut frueh = daten("frueh");
        frueh.ereigniszeit = Some("2026-05-23 08:00:00");
        anlegen(&pool, einsatz, benutzer, frueh).await.unwrap();
        let mut spaet = daten("spaet");
        spaet.ereigniszeit = Some("2026-05-23 18:00:00");
        anlegen(&pool, einsatz, benutzer, spaet).await.unwrap();

        let mut f = filter();
        f.bis_zeit = Some("2026-05-23 12:00:00".into());
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt, "frueh");
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_erfasser() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let zweiter: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Zweiter', 'zwei', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        anlegen(&pool, einsatz, benutzer, daten("von leit"))
            .await
            .unwrap();
        anlegen(&pool, einsatz, zweiter, daten("von zwei"))
            .await
            .unwrap();

        let mut f = filter();
        f.erfasser_id = Some(zweiter);
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].erfasser_id, zweiter);
    }

    #[tokio::test]
    async fn anlegen_setzt_lagebericht_id_auf_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let a = anlegen(&pool, einsatz, benutzer, daten("Test"))
            .await
            .unwrap();

        assert_eq!(a.lagebericht_id, None);
        assert_eq!(a.auftrag_id, None);
    }
}
