use super::{EtbEintragAnzeige, FolgeauftragVerweis};
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};
use std::collections::HashMap;

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
    einfuegen(conn, einsatz_id, erfasser_id, startwert, None, &daten).await
}

/// Der EINE INSERT in `etb_eintrag` — für die Kopplungspfade ([`anlegen_tx`], ohne
/// `client_id`) und die Client-Erfassung ([`anlegen_idempotent`], mit). `client_id = NULL`
/// verhält sich für `UNIQUE(einsatz_id, client_id)` wie bisher: SQLite zählt NULLs als
/// verschieden, der Index greift nur bei gesetztem Schlüssel.
async fn einfuegen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    startwert: i64,
    client_id: Option<&str>,
    daten: &EintragDaten<'_>,
) -> Result<i64, AppError> {
    // Funktions-Snapshot (LFH-615) HIER und nicht beim Aufrufer: jeder Kopplungspfad
    // (Meldung, Auftrag, Befehl, Stab …) läuft durch diese Funktion und kann ihn nicht
    // vergessen. Der Client liefert ihn nie — ein Nachweis, den der Absender setzt, wäre keiner.
    let funktion = crate::einsatz::funktion::kurz_fuer(&mut *conn, einsatz_id, erfasser_id).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag \
            (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung, \
             erfasser_id, erfasser_funktion, ereigniszeit, erfasst_lokal_at, \
             berichtigt_eintrag_id, client_id) \
         SELECT ?, COALESCE(MAX(lfd_nr) + 1, ?), ?, ?, ?, ?, ?, ?, ?, ?, \
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
    .bind(funktion)
    .bind(daten.ereigniszeit)
    .bind(daten.erfasst_lokal_at)
    .bind(daten.berichtigt_eintrag_id)
    .bind(client_id)
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

/// Wortlaut der 400 für einen unbekannten oder fremden Anhang (LFH-117, design.md D4). Er
/// nennt den Anhang als Ursache: ein Offline-Eintrag, dessen Datei nach der Karenz
/// weggeräumt wurde, steht damit verständlich unter „abgelehnt".
pub const ANHANG_UNBEKANNT: &str = "Anhang unbekannt oder nicht mehr vorhanden";

/// Wortlaut des 409, wenn eine `client_id` schon für einen Eintrag mit ANDEREM Inhalt steht
/// (Review C1): zwei Browser-Tabs mit demselben Entwurf. Er steht auch unter „abgelehnt"
/// der Offline-Queue, sagt deshalb, was mit dem Wortlaut ist und was „Erneut senden" tut.
pub const CLIENT_ID_KONFLIKT: &str = "client_id bereits für einen anderen Eintrag verwendet: \
     dieser Wortlaut ist nicht erfasst. Erneut senden legt ihn als eigenen Eintrag an.";

/// Ob ein Wiederholversuch derselben `client_id` wirklich DERSELBE Eintrag ist (Review C1):
/// gleicher Typ, gleicher Inhalt (getrimmt) und dieselben Anhänge als Menge. Zeitstempel
/// zählen nicht — `erfasst_lokal_at` entsteht je Absenden neu. Die Anhänge zählen, weil ein
/// zweiter Tab mit demselben Wortlaut, aber weiteren Fotos sonst still seine Fotos verlöre;
/// ein echter Wiederholversuch trägt immer dieselben IDs (die Queue speichert sie, der Client
/// hält hochgeladene Dateien je `File` fest). Reihenfolge und Dubletten zählen nicht.
pub fn ist_derselbe_eintrag(
    typ_bestand: &str,
    inhalt_bestand: &str,
    anhaenge_bestand: &[i64],
    typ: &str,
    inhalt: &str,
    anhang_ids: &[i64],
) -> bool {
    let menge = |ids: &[i64]| {
        let mut v = ids.to_vec();
        v.sort_unstable();
        v.dedup();
        v
    };
    typ_bestand == typ
        && inhalt_bestand.trim() == inhalt.trim()
        && menge(anhaenge_bestand) == menge(anhang_ids)
}

/// Legt einen client-erfassten ETB-Eintrag idempotent an (F03/LFH-261), optional mit
/// Anhängen (LFH-117).
///
/// Trägt der Aufrufer eine `client_id` (client-generierte UUID der Offline-/Direkterfassung),
/// dedupliziert diese Funktion gegen `UNIQUE(einsatz_id, client_id)`: ein erneutes Senden
/// desselben Eintrags — Retry nach verlorener Antwort, Doppel-Flush aus zwei Tabs — liefert
/// die BESTEHENDE Antwort zurück (samt ihren Anhängen), statt eine Dublette mit neuer
/// `lfd_nr` zu erzeugen. Rückgabe `(anzeige, war_neu)`; bei `war_neu = false` (idempotenter
/// Replay) unterdrückt der Aufrufer das Live-Event.
///
/// **Eine Transaktion, feste Reihenfolge** (design.md D3), in beiden Zweigen durch
/// `write_retry!` (`BEGIN IMMEDIATE`):
/// 1. mit `client_id`: bestehenden Eintrag suchen → Rückgabe ohne Anhangsprüfung (seine
///    Anhänge sind ja gebunden);
/// 2. Anhänge klassifizieren: nicht im Einsatz → `Validation` (400), an ETB, Chat oder
///    Dokument gebunden → `UnprocessableEntity` (422);
/// 3. Eintrag einfügen; 4. Verknüpfungen einfügen.
///
/// `BEGIN IMMEDIATE` serialisiert die Schreiber — damit ist Schritt 1 gegen einen
/// gleichzeitigen Flush derselben `client_id` sicher, und der frühere Zweig auf die
/// UNIQUE-Verletzung entfällt. Der UNIQUE-Index bleibt als Netz. Scheitert Schritt 2, rollt
/// die Transaktion zurück: kein Eintrag, keine verbrauchte `lfd_nr`, kein Anhang gebunden.
///
/// Im Body steht ausschließlich Connection-Arbeit: der Test-Pool hat EINE Verbindung, ein
/// Pool-Aufruf in der offenen Transaktion wartete auf sich selbst.
pub async fn anlegen_idempotent(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    anhang_ids: &[i64],
    daten: EintragDaten<'_>,
) -> Result<(EtbEintragAnzeige, bool), AppError> {
    let startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let (id, war_neu) = crate::write_retry!(pool, |conn| {
        if let Some(cid) = client_id {
            if let Some(id) = bestehende_client_id(&mut *conn, einsatz_id, cid).await? {
                // Die Route prüft das schon vor der Transaktion; hier hält es das Rennen
                // zweier Tabs, die beide an der frühen Prüfung vorbeikamen.
                let (typ, inhalt): (String, String) =
                    sqlx::query_as("SELECT typ, inhalt FROM etb_eintrag WHERE id = ?")
                        .bind(id)
                        .fetch_one(&mut *conn)
                        .await?;
                let gebunden: Vec<i64> = sqlx::query_scalar(
                    "SELECT anhang_id FROM etb_eintrag_anhang WHERE eintrag_id = ?",
                )
                .bind(id)
                .fetch_all(&mut *conn)
                .await?;
                if !ist_derselbe_eintrag(
                    &typ,
                    &inhalt,
                    &gebunden,
                    daten.typ,
                    daten.inhalt,
                    anhang_ids,
                ) {
                    return Err(AppError::Conflict(CLIENT_ID_KONFLIKT.into()));
                }
                return Ok((id, false));
            }
        }
        pruefe_anhaenge(&mut *conn, einsatz_id, erfasser_id, anhang_ids).await?;
        let id = einfuegen(
            &mut *conn,
            einsatz_id,
            erfasser_id,
            startwert,
            client_id,
            &daten,
        )
        .await?;
        for &aid in anhang_ids {
            sqlx::query("INSERT INTO etb_eintrag_anhang (eintrag_id, anhang_id) VALUES (?, ?)")
                .bind(id)
                .bind(aid)
                .execute(&mut *conn)
                .await?;
        }
        Ok((id, true))
    })?;
    Ok((laden(pool, id).await?, war_neu))
}

/// Schritt 2 aus [`anlegen_idempotent`]: jeder genannte Anhang muss im Einsatz existieren
/// (sonst 400) und darf an KEINEM Linker hängen — Chat oder Register (sonst 422) — „eine Datei, ein
/// Lebenszyklus". Erst alle prüfen, dann schreiben: so bindet ein Fehler hinten nichts vorn.
///
/// Ein freier Anhang, den eine ANDERE Person hochgeladen hat, gilt als unbekannt (Review C1,
/// design.md D12): gleiche Antwort, gleicher Wortlaut. Sonst holte man sich einen fremden
/// Upload über den eigenen Eintrag, oder läse aus 400/201 ab, welche IDs frei herumliegen.
/// Der Replay (Schritt 1) prüft nichts, und die Offline-Queue sendet nur unter dem Benutzer,
/// unter dem sie entstand (`fordere_offline_queue_benutzer`) — also unter der Hochladenden.
async fn pruefe_anhaenge(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    anhang_ids: &[i64],
) -> Result<(), AppError> {
    for &aid in anhang_ids {
        // Die Bindung kommt aus dem Linker-Register `anhang::repo::MODUL_LINKER` (CLAUDE.md
        // „ETB-Anhänge", LFH-21) plus dem Chat: ein neuer Linker braucht dort einen Eintrag,
        // sonst bände das ETB dessen Dateien ein zweites Mal — der Registerguard macht das rot.
        let stand: Option<(bool, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT EXISTS (SELECT 1 FROM chat_nachricht_anhang c WHERE c.anhang_id = a.id) \
                 OR {}, \
                    a.hochgeladen_von \
             FROM anhang a WHERE a.id = ? AND a.einsatz_id = ?",
            crate::anhang::repo::modul_gebunden_sql("a")
        )))
        .bind(aid)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let gebunden = match stand {
            Some((false, von)) if von != erfasser_id => None,
            anders => anders.map(|(gebunden, _)| gebunden),
        };
        match gebunden {
            None => return Err(AppError::Validation(ANHANG_UNBEKANNT.into())),
            Some(true) => {
                return Err(AppError::UnprocessableEntity(
                    crate::anhang::repo::gebunden_meldung(),
                ))
            }
            Some(false) => {}
        }
    }
    Ok(())
}

/// id des Eintrags mit dieser `(einsatz_id, client_id)`, falls vorhanden.
async fn bestehende_client_id(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT id FROM etb_eintrag WHERE einsatz_id = ? AND client_id = ?")
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(Into::into)
}

/// Lädt einen bereits committeten Offline-Eintrag anhand seines einsatzgebundenen
/// Idempotenzschlüssels. Die Einsatz-ID ist Teil des Lookups und verhindert, dass dieselbe
/// `client_id` Daten eines anderen Einsatzes offenlegt.
pub async fn laden_nach_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<EtbEintragAnzeige>, AppError> {
    let id = {
        let mut conn = pool.acquire().await?;
        bestehende_client_id(&mut conn, einsatz_id, client_id).await?
    };
    match id {
        Some(id) => laden(pool, id).await.map(Some),
        None => Ok(None),
    }
}

/// Lädt einen einzelnen Eintrag als Anzeige (inkl. Erfasser-Name).
/// `NotFound`, wenn der Eintrag nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<EtbEintragAnzeige, AppError> {
    let mut eintrag = sqlx::query_as::<_, EtbEintragAnzeige>(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.erfasser_funktion, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id, e.lagebericht_id, e.auftrag_id, \
                e.befehl_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
         WHERE e.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    folgeauftraege_nachladen(pool, std::slice::from_mut(&mut eintrag)).await?;
    anhaenge_nachladen(pool, std::slice::from_mut(&mut eintrag)).await?;
    Ok(eintrag)
}

/// Füllt `folgeauftraege` (LFH-636) für alle übergebenen Einträge mit EINER Abfrage nach —
/// kein N+1 je Zeile. Die IN-Liste ist durch [`MAX_LIMIT`] begrenzt. Die Zuordnung braucht
/// keinen Einsatz-Filter: die Einträge sind bereits einsatzgefiltert, und
/// `quell_etb_eintrag_id` wird beim Erteilen gegen denselben Einsatz geprüft
/// (`routes::etb::auftrag_erteilen`). Aufsteigend nach `lfd_nr`, bei Altbeständen ohne
/// Nummer nach `id`.
async fn folgeauftraege_nachladen(
    pool: &SqlitePool,
    eintraege: &mut [EtbEintragAnzeige],
) -> Result<(), AppError> {
    if eintraege.is_empty() {
        return Ok(());
    }
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT quell_etb_eintrag_id, id, lfd_nr FROM auftrag WHERE quell_etb_eintrag_id IN (",
    );
    let mut ids = qb.separated(", ");
    for e in eintraege.iter() {
        ids.push_bind(e.id);
    }
    qb.push(") ORDER BY lfd_nr IS NULL, lfd_nr, id");
    let zeilen: Vec<(i64, i64, Option<i64>)> = qb.build_query_as().fetch_all(pool).await?;
    if zeilen.is_empty() {
        return Ok(());
    }
    let index: HashMap<i64, usize> = eintraege
        .iter()
        .enumerate()
        .map(|(i, e)| (e.id, i))
        .collect();
    for (quelle, id, lfd_nr) in zeilen {
        if let Some(&i) = index.get(&quelle) {
            eintraege[i]
                .folgeauftraege
                .push(FolgeauftragVerweis { id, lfd_nr });
        }
    }
    Ok(())
}

/// Füllt `anhaenge` (LFH-117) für alle übergebenen Einträge mit EINER Abfrage nach — das
/// Muster von [`folgeauftraege_nachladen`], kein N+1 je Zeile. Die IN-Liste ist durch
/// [`MAX_LIMIT`] begrenzt. Aufsteigend nach `anhang.id`. Die Bytes bleiben in der Tabelle.
async fn anhaenge_nachladen(
    pool: &SqlitePool,
    eintraege: &mut [EtbEintragAnzeige],
) -> Result<(), AppError> {
    if eintraege.is_empty() {
        return Ok(());
    }
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT l.eintrag_id, a.id, a.einsatz_id, a.dateiname, a.mime, a.groesse, \
                a.hochgeladen_von, a.erstellt_at \
         FROM etb_eintrag_anhang l JOIN anhang a ON a.id = l.anhang_id \
         WHERE l.eintrag_id IN (",
    );
    let mut ids = qb.separated(", ");
    for e in eintraege.iter() {
        ids.push_bind(e.id);
    }
    qb.push(") ORDER BY a.id");
    #[allow(clippy::type_complexity)]
    let zeilen: Vec<(i64, i64, i64, String, String, i64, i64, String)> =
        qb.build_query_as().fetch_all(pool).await?;
    if zeilen.is_empty() {
        return Ok(());
    }
    let index: HashMap<i64, usize> = eintraege
        .iter()
        .enumerate()
        .map(|(i, e)| (e.id, i))
        .collect();
    for (eintrag_id, id, einsatz_id, dateiname, mime, groesse, hochgeladen_von, erstellt_at) in
        zeilen
    {
        if let Some(&i) = index.get(&eintrag_id) {
            eintraege[i].anhaenge.push(crate::anhang::AnhangAnzeige {
                id,
                einsatz_id,
                dateiname,
                mime,
                groesse,
                hochgeladen_von,
                erstellt_at,
            });
        }
    }
    Ok(())
}

/// Hängt `anhang_id` an genau diesem Eintrag dieses Einsatzes? Die EINE Zugriffsfrage des
/// ETB-Downloads (LFH-117, design.md D6): kein Treffer heißt 404, gleich ob Einsatz, Eintrag
/// oder Anhang nicht passt — die Antwort verrät nicht, welcher der drei.
pub async fn anhang_am_eintrag(
    pool: &SqlitePool,
    einsatz_id: i64,
    eintrag_id: i64,
    anhang_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM etb_eintrag_anhang l JOIN etb_eintrag e ON e.id = l.eintrag_id \
         WHERE l.anhang_id = ? AND l.eintrag_id = ? AND e.einsatz_id = ?",
    )
    .bind(anhang_id)
    .bind(eintrag_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(treffer.is_some())
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
    /// Filter „betrifft Einheit" (LFH-616). Ein ETB-Eintrag hat keine Einheit-Spalte; er
    /// betrifft eine Einheit, wenn EINER von zwei Wegen trägt:
    /// 1. **Fremdschlüssel über den Auftrag**: `e.auftrag_id` zeigt auf einen Auftrag mit der
    ///    Einheit als Empfänger (Anordnung und Vollzugsmeldung).
    /// 2. **Name in von/an**: `von` oder `an` ist — getrimmt, ASCII-Groß/Klein egal — der
    ///    AKTUELLE Einheitsname. Das deckt den freien Funkverkehr ab, die Mehrheit im ETB.
    ///    Grenzen, bewusst: nach einer Umbenennung fallen ältere Einträge heraus; eine
    ///    Empfängerliste in `an` trifft nicht exakt (die fängt Weg 1); Funkrufnamen der
    ///    Fahrzeuge einer Einheit zählen nicht mit.
    ///
    /// Eine Einheit aus einem fremden Einsatz liefert über `ee.einsatz_id = e.einsatz_id`
    /// nichts statt fremder Treffer.
    pub einheit_id: Option<i64>,
    /// Cursor: nur Einträge mit `lfd_nr <` diesem Wert (für ältere Seiten).
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (vom Handler auf [1, MAX_LIMIT] geklemmt).
    pub limit: i64,
}

impl EtbFilter {
    /// Die Filtermerkmale ohne Cursor und Limit — genau das, was auch die Zählungen
    /// ([`zaehle`], [`anzahl`]) bekommen.
    pub fn merkmale(&self) -> EtbZaehlFilter {
        EtbZaehlFilter {
            q: self.q.clone(),
            typ: self.typ.clone(),
            von_zeit: self.von_zeit.clone(),
            bis_zeit: self.bis_zeit.clone(),
            erfasser_id: self.erfasser_id,
            einheit_id: self.einheit_id,
        }
    }
}

/// Die Filtermerkmale der ETB-Abfrage OHNE Seitenparameter (LFH-612). Die Zählungen nehmen
/// bewusst diesen Typ und nicht [`EtbFilter`]: sie können damit gar keinen Cursor und kein
/// Limit bekommen, eine „Gesamtzahl" über eine Seite ist strukturell ausgeschlossen.
/// Die Bedeutung der Felder steht an [`EtbFilter`].
#[derive(Debug, Default, Clone)]
pub struct EtbZaehlFilter {
    pub q: Option<String>,
    pub typ: Option<String>,
    pub von_zeit: Option<String>,
    pub bis_zeit: Option<String>,
    pub erfasser_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// Schreibt FTS-Join und WHERE-Bedingung einer ETB-Abfrage (Einsatz + Filtermerkmale) in
/// `qb`. **Die eine Quelle** für Liste und beide Zählungen (LFH-612, LFH-619): zählte eine
/// Zählung mit einer eigenen Bedingung, liefen Kopf („n Treffer") und Liste bei der ersten
/// Abweichung still auseinander — ohne roten Test, ohne Fehlerbild.
///
/// Erwartet, dass `qb` bis zum `FROM etb_eintrag e …` gefüllt ist; der Aufrufer hängt danach
/// Cursor, `GROUP BY`, `ORDER BY`, `LIMIT` an.
fn filter_bedingung(qb: &mut QueryBuilder<Sqlite>, einsatz_id: i64, filter: &EtbZaehlFilter) {
    // FTS-Join nur, wenn ein Volltext-Query gesetzt ist.
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
        qb.push_bind(typ.clone());
    }
    if let Some(v) = &filter.von_zeit {
        qb.push(" AND e.ereigniszeit >= ");
        qb.push_bind(v.clone());
    }
    if let Some(b) = &filter.bis_zeit {
        qb.push(" AND e.ereigniszeit <= ");
        qb.push_bind(b.clone());
    }
    if let Some(eid) = filter.erfasser_id {
        qb.push(" AND e.erfasser_id = ");
        qb.push_bind(eid);
    }
    if let Some(einheit) = filter.einheit_id {
        qb.push(
            " AND (EXISTS (SELECT 1 FROM auftrag_empfaenger ae \
                           WHERE ae.auftrag_id = e.auftrag_id \
                             AND ae.empfaenger_typ = 'einheit' AND ae.einheit_id = ",
        );
        qb.push_bind(einheit);
        qb.push(
            ") OR EXISTS (SELECT 1 FROM einsatz_einheit ee \
                          WHERE ee.einsatz_id = e.einsatz_id AND ee.id = ",
        );
        qb.push_bind(einheit);
        qb.push(
            " AND (TRIM(e.von) = ee.name COLLATE NOCASE \
                               OR TRIM(e.an) = ee.name COLLATE NOCASE)))",
        );
    }
}

/// Fragt Einträge eines Einsatzes ab. Sortierung: `lfd_nr DESC` (neueste zuerst),
/// stabiler Cursor über `before_lfd_nr`. Die fachliche Anzeige-Sortierung nach
/// `ereigniszeit` erfolgt clientseitig (beide Zeitstempel werden geliefert).
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &EtbFilter,
) -> Result<Vec<EtbEintragAnzeige>, AppError> {
    // Der Join auf `benutzer` liefert nur `erfasser_name` und filtert nichts
    // (`erfasser_id` ist ein NOT-NULL-Fremdschlüssel) — deshalb steht er hier und nicht
    // in der gemeinsamen Bedingung, die die Zählungen ohne ihn fahren.
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.erfasser_funktion, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id, e.lagebericht_id, e.auftrag_id, \
                e.befehl_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id",
    );
    filter_bedingung(&mut qb, einsatz_id, &filter.merkmale());

    if let Some(cursor) = filter.before_lfd_nr {
        qb.push(" AND e.lfd_nr < ");
        qb.push_bind(cursor);
    }

    qb.push(" ORDER BY e.lfd_nr DESC LIMIT ");
    qb.push_bind(filter.limit);

    let mut eintraege = qb
        .build_query_as::<EtbEintragAnzeige>()
        .fetch_all(pool)
        .await?;
    folgeauftraege_nachladen(pool, &mut eintraege).await?;
    anhaenge_nachladen(pool, &mut eintraege).await?;
    Ok(eintraege)
}

/// Zählt die Einträge, die [`abfrage`] mit denselben Filtermerkmalen liefern würde — OHNE
/// Seitendeckel (LFH-619, Sammeltreffer der Sprungpalette). Die Bedingung kommt aus
/// [`filter_bedingung`], derselben Funktion wie bei der Liste.
pub async fn anzahl(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &EtbZaehlFilter,
) -> Result<i64, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new("SELECT COUNT(*) FROM etb_eintrag e");
    filter_bedingung(&mut qb, einsatz_id, filter);
    qb.build_query_scalar::<i64>()
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

/// Zählt die Einträge eines Einsatzes je Typ über dieselbe Bedingung wie [`abfrage`]
/// (LFH-612). Liefert die Rohzeilen `(typ, anzahl)`; die Zuordnung zu den Feldern macht
/// [`super::zaehler::EtbZaehlerAnzeige::aus_zeilen`] mit einem vollständigen `match`.
pub async fn zaehle(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &EtbZaehlFilter,
) -> Result<Vec<(String, i64)>, AppError> {
    let mut qb: QueryBuilder<Sqlite> =
        QueryBuilder::new("SELECT e.typ, COUNT(*) FROM etb_eintrag e");
    filter_bedingung(&mut qb, einsatz_id, filter);
    qb.push(" GROUP BY e.typ");
    qb.build_query_as::<(String, i64)>()
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

        let (e1, neu1) = anlegen_idempotent(
            &pool,
            einsatz,
            benutzer,
            Some("uuid-1"),
            &[],
            daten("Erste"),
        )
        .await
        .unwrap();
        assert!(neu1, "erster Insert ist neu");

        // Retry mit derselben client_id (verlorene Antwort / Doppel-Flush) → bestehender
        // Eintrag, KEINE Dublette, war_neu=false.
        let (e1_wieder, neu2) = anlegen_idempotent(
            &pool,
            einsatz,
            benutzer,
            Some("uuid-1"),
            &[],
            daten("Erste"),
        )
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

        let (_e1, neu1) = anlegen_idempotent(&pool, einsatz, benutzer, None, &[], daten("A"))
            .await
            .unwrap();
        let (_e2, neu2) = anlegen_idempotent(&pool, einsatz, benutzer, None, &[], daten("B"))
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

    /// Datei-DB mit WAL und mehreren Verbindungen: der Test-Pool hat EINE Verbindung und
    /// serialisierte zwei Aufrufe schon vor der Transaktion — die Nebenläufigkeit, um die es
    /// geht, entstünde gar nicht.
    async fn nebenlaeufiger_pool(dir: &tempfile::TempDir) -> SqlitePool {
        use std::time::Duration;
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(dir.path().join("race.db"))
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(opts)
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn anlegen_idempotent_ist_exactly_once_unter_nebenlaeufigkeit() {
        // Zwei Tabs flushen dieselbe client_id parallel. `write_retry!` öffnet die Transaktion
        // mit `BEGIN IMMEDIATE` und serialisiert damit die Schreiber: wer zweitens drankommt,
        // findet die client_id in Schritt 1 und bekommt den Bestand. Einen Zweig auf die
        // UNIQUE-Verletzung gibt es nicht mehr (design.md D3), der Index bleibt nur als Netz.
        // Das Ergebnis ist exactly-once: EIN Eintrag, beide Aufrufe liefern dieselbe id.
        let dir = tempfile::tempdir().unwrap();
        let pool = nebenlaeufiger_pool(&dir).await;
        let (benutzer, einsatz) = setup(&pool).await;

        let p1 = pool.clone();
        let p2 = pool.clone();
        let t1 = tokio::spawn(async move {
            anlegen_idempotent(&p1, einsatz, benutzer, Some("race-1"), &[], daten("A")).await
        });
        let t2 = tokio::spawn(async move {
            anlegen_idempotent(&p2, einsatz, benutzer, Some("race-1"), &[], daten("A")).await
        });
        let (r1, r2) = tokio::join!(t1, t2);
        let (e1, _) = r1.unwrap().expect("Task 1 idempotent OK");
        let (e2, _) = r2.unwrap().expect("Task 2 idempotent OK");
        assert_eq!(
            e1.id, e2.id,
            "beide parallelen Aufrufe liefern denselben Eintrag"
        );

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            count, 1,
            "exactly-once: kein Duplikat trotz Nebenlaeufigkeit"
        );
    }

    /// Zusage aus tasks.md 3.2 mit Anhang (Review C1): zwei gleichzeitige Anfragen derselben
    /// `client_id` tragen denselben freien Anhang. Die zweite darf NICHT an der Anhangsprüfung
    /// scheitern (422, weil `a` inzwischen gebunden ist) — sie ist ein Replay und bekommt den
    /// Bestand samt Anhang. Mehrere Durchläufe, damit beide Reihenfolgen vorkommen.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn gleichzeitiger_replay_mit_anhang_liefert_beiden_den_bestand() {
        let dir = tempfile::tempdir().unwrap();
        let pool = nebenlaeufiger_pool(&dir).await;
        let (benutzer, einsatz) = setup(&pool).await;

        for runde in 0..20 {
            let a = freier_anhang(&pool, einsatz, benutzer, "foto.jpg").await;
            let cid = format!("race-anhang-{runde}");
            let (p1, p2) = (pool.clone(), pool.clone());
            let (c1, c2) = (cid.clone(), cid.clone());
            let t1 = tokio::spawn(async move {
                anlegen_idempotent(&p1, einsatz, benutzer, Some(&c1), &[a], daten("Foto")).await
            });
            let t2 = tokio::spawn(async move {
                anlegen_idempotent(&p2, einsatz, benutzer, Some(&c2), &[a], daten("Foto")).await
            });
            let (r1, r2) = tokio::join!(t1, t2);
            let (e1, neu1) = r1.unwrap().expect("Aufruf 1 liefert den Eintrag");
            let (e2, neu2) = r2.unwrap().expect("Aufruf 2 liefert den Eintrag");
            assert_eq!(e1.id, e2.id, "Runde {runde}: derselbe Eintrag");
            assert!(neu1 ^ neu2, "Runde {runde}: genau einer legt an");
            assert_eq!(ids(&e1), vec![a], "Runde {runde}");
            assert_eq!(ids(&e2), vec![a], "Runde {runde}");

            let eintraege: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE client_id = ?")
                    .bind(&cid)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(eintraege, 1, "Runde {runde}: genau ein Eintrag");
            let links: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?")
                    .bind(a)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(links, 1, "Runde {runde}: der Anhang hängt einmal");
        }
    }

    /// Review C1 (WICHTIG 1), Transaktionsebene: dieselbe client_id mit anderem Inhalt, Typ
    /// oder anderen Anhängen ist ein Konflikt (409), kein Replay — auch wenn die Route ihre
    /// frühe Prüfung übersprungen hätte (Rennen zweier Tabs).
    #[tokio::test]
    async fn gleiche_client_id_mit_anderem_inhalt_ist_konflikt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        let b = freier_anhang(&pool, einsatz, benutzer, "b.jpg").await;
        let (erst, _) =
            anlegen_idempotent(&pool, einsatz, benutzer, Some("c-x"), &[a], daten("Tab 1"))
                .await
                .unwrap();

        for (anhaenge, d) in [
            (vec![a], daten("Tab 2")),
            (
                vec![a],
                EintragDaten {
                    typ: "lage",
                    ..daten("Tab 1")
                },
            ),
            (vec![a, b], daten("Tab 1")),
        ] {
            let r = anlegen_idempotent(&pool, einsatz, benutzer, Some("c-x"), &anhaenge, d).await;
            assert!(matches!(r, Err(AppError::Conflict(_))), "{r:?}");
        }
        assert_eq!(verknuepfte_anhaenge(&pool).await, 1, "b bleibt frei");
        let eintraege: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(eintraege, 1);

        // Gleicher Inhalt mit anderem Leerraum: Replay.
        let (wieder, neu) = anlegen_idempotent(
            &pool,
            einsatz,
            benutzer,
            Some("c-x"),
            &[a],
            daten("  Tab 1 "),
        )
        .await
        .unwrap();
        assert!(!neu);
        assert_eq!(wieder.id, erst.id);
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

    // ── Folgeaufträge (LFH-636) ─────────────────────────────────────────────────────

    /// Erteilt über den echten Weg (`erteile_aus_etb_tx`) einen Auftrag aus `quelle` —
    /// damit entsteht auch die eigene Anordnung, die selbst KEINEN Folgeauftrag tragen darf.
    async fn erteile(
        pool: &SqlitePool,
        einsatz: i64,
        benutzer: i64,
        quelle: i64,
        text: &str,
    ) -> i64 {
        crate::auftrag::repo::erteile_aus_etb_tx(
            pool,
            einsatz,
            quelle,
            benutzer,
            crate::auftrag::repo::AuftragDaten {
                auftrag_text: text,
                absicht: None,
                lage: None,
                ort: None,
                zeit: None,
                mittel: None,
                verbindung: None,
                sicherheit: None,
                prioritaet: crate::auftrag::PRIO_NORMAL,
                richtung: crate::auftrag::RICHTUNG_INTERN,
                frist_at: None,
                erteilt_at: "2026-05-23 10:05:00",
                empfaenger: vec![],
            },
        )
        .await
        .unwrap()
    }

    async fn lfd_nr_von(pool: &SqlitePool, auftrag_id: i64) -> i64 {
        sqlx::query_scalar("SELECT lfd_nr FROM auftrag WHERE id = ?")
            .bind(auftrag_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn eintrag_ohne_folgeauftrag_traegt_leere_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, benutzer, daten("ruhig"))
            .await
            .unwrap();

        assert!(e.folgeauftraege.is_empty());
        assert!(laden(&pool, e.id).await.unwrap().folgeauftraege.is_empty());
        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        assert!(liste[0].folgeauftraege.is_empty());
    }

    #[tokio::test]
    async fn zwei_folgeauftraege_stehen_am_quell_eintrag_aufsteigend() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let quelle = anlegen(
            &pool,
            einsatz,
            benutzer,
            EintragDaten {
                typ: "entscheidung",
                ..daten("Evakuierung Ortsteil Nord")
            },
        )
        .await
        .unwrap();
        let a1 = erteile(&pool, einsatz, benutzer, quelle.id, "Betreuung").await;
        let a2 = erteile(&pool, einsatz, benutzer, quelle.id, "Transport").await;
        let erwartet = vec![
            FolgeauftragVerweis {
                id: a1,
                lfd_nr: Some(lfd_nr_von(&pool, a1).await),
            },
            FolgeauftragVerweis {
                id: a2,
                lfd_nr: Some(lfd_nr_von(&pool, a2).await),
            },
        ];
        assert!(
            erwartet[0].lfd_nr < erwartet[1].lfd_nr,
            "Vorbedingung: Nummern steigen"
        );

        assert_eq!(
            laden(&pool, quelle.id).await.unwrap().folgeauftraege,
            erwartet
        );

        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        // Quelle + zwei Anordnungen der Aufträge.
        assert_eq!(liste.len(), 3);
        for e in &liste {
            if e.id == quelle.id {
                assert_eq!(e.folgeauftraege, erwartet);
            } else {
                assert!(
                    e.folgeauftraege.is_empty(),
                    "die eigene Anordnung eines Auftrags ist nicht seine Quelle (Eintrag {})",
                    e.id
                );
            }
        }
    }

    /// Die Ordnung folgt der Auftragsnummer, nicht der Anlagereihenfolge: im Test oben
    /// fallen beide zusammen, und SQLite liefert über den Index ohnehin in rowid-Folge — ohne
    /// diesen Test bliebe ein gestrichenes `ORDER BY` unbemerkt (Review LFH-636).
    #[tokio::test]
    async fn folgeauftraege_ordnen_nach_nummer_nicht_nach_anlage() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let quelle = anlegen(&pool, einsatz, benutzer, daten("Lage"))
            .await
            .unwrap();
        let frueh = erteile(&pool, einsatz, benutzer, quelle.id, "zuerst angelegt").await;
        let spaet = erteile(&pool, einsatz, benutzer, quelle.id, "danach angelegt").await;
        let ohne = erteile(&pool, einsatz, benutzer, quelle.id, "Altbestand").await;
        // Nummer gegen die Anlagereihenfolge drehen; der Altbestand verliert seine Nummer.
        sqlx::query("UPDATE auftrag SET lfd_nr = 900 WHERE id = ?")
            .bind(frueh)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE auftrag SET lfd_nr = NULL WHERE id = ?")
            .bind(ohne)
            .execute(&pool)
            .await
            .unwrap();

        let ids: Vec<i64> = laden(&pool, quelle.id)
            .await
            .unwrap()
            .folgeauftraege
            .iter()
            .map(|f| f.id)
            .collect();
        assert_eq!(
            ids,
            vec![spaet, frueh, ohne],
            "nach Nummer, ohne Nummer zuletzt"
        );
    }

    #[tokio::test]
    async fn abgenommener_folgeauftrag_zaehlt_weiter() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let quelle = anlegen(&pool, einsatz, benutzer, daten("Lage"))
            .await
            .unwrap();
        let a = erteile(&pool, einsatz, benutzer, quelle.id, "Sichern").await;
        sqlx::query("UPDATE auftrag SET abgenommen_at = '2026-05-23 11:00:00' WHERE id = ?")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();

        let geladen = laden(&pool, quelle.id).await.unwrap();
        assert_eq!(geladen.folgeauftraege.len(), 1);
        assert_eq!(geladen.folgeauftraege[0].id, a);
    }

    #[tokio::test]
    async fn cursor_seite_traegt_vollstaendige_folgeauftraege() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let quelle = anlegen(&pool, einsatz, benutzer, daten("alt"))
            .await
            .unwrap();
        // Die Aufträge (und ihre Anordnungen) entstehen NACH der Quelle, stehen also auf
        // einer neueren Seite als sie.
        erteile(&pool, einsatz, benutzer, quelle.id, "eins").await;
        erteile(&pool, einsatz, benutzer, quelle.id, "zwei").await;

        let mut f = filter();
        f.limit = 1;
        f.before_lfd_nr = Some(quelle.lfd_nr + 1);
        let seite = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite.len(), 1);
        assert_eq!(seite[0].id, quelle.id);
        assert_eq!(seite[0].folgeauftraege.len(), 2);
    }

    // --- LFH-117: Anhänge an ETB-Einträgen ---

    /// Freier (ungebundener) Anhang im Einsatz, direkt eingefügt.
    async fn freier_anhang(pool: &SqlitePool, einsatz: i64, von: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, ?, 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(name)
        .bind(b"ABC".as_slice())
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn zweiter_einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Nachbar') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn verknuepfte_anhaenge(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag_anhang")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn ids(e: &EtbEintragAnzeige) -> Vec<i64> {
        e.anhaenge.iter().map(|a| a.id).collect()
    }

    #[tokio::test]
    async fn anlegen_mit_zwei_anhaengen_bindet_beide() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        let b = freier_anhang(&pool, einsatz, benutzer, "b.jpg").await;

        let (e, neu) = anlegen_idempotent(
            &pool,
            einsatz,
            benutzer,
            Some("c-1"),
            &[a, b],
            daten("Foto"),
        )
        .await
        .unwrap();
        assert!(neu);
        assert_eq!(ids(&e), vec![a, b]);
        assert_eq!(e.anhaenge[0].dateiname, "a.jpg");
        assert_eq!(verknuepfte_anhaenge(&pool).await, 2);
    }

    #[tokio::test]
    async fn fremder_anhang_rollt_alles_zurueck() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let nachbar = zweiter_einsatz(&pool).await;
        let eigen = freier_anhang(&pool, einsatz, benutzer, "eigen.jpg").await;
        let fremd = freier_anhang(&pool, nachbar, benutzer, "fremd.jpg").await;

        // Der eigene steht VORN: ein Pfad, der je ID prüft und sofort verknüpft, hätte ihn
        // schon gebunden, bevor der fremde scheitert.
        let err = anlegen_idempotent(
            &pool,
            einsatz,
            benutzer,
            Some("c-2"),
            &[eigen, fremd],
            daten("Foto"),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
        let AppError::Validation(text) = err else {
            unreachable!()
        };
        assert!(
            text.contains("Anhang"),
            "der Wortlaut nennt den Anhang: {text}"
        );

        let eintraege: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(eintraege, 0, "kein Eintrag");
        assert_eq!(
            verknuepfte_anhaenge(&pool).await,
            0,
            "der eigene bleibt frei"
        );

        let naechster = anlegen(&pool, einsatz, benutzer, daten("danach"))
            .await
            .unwrap();
        assert_eq!(naechster.lfd_nr, 1, "keine laufende Nummer verbraucht");
    }

    #[tokio::test]
    async fn unbekannter_anhang_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let err = anlegen_idempotent(&pool, einsatz, benutzer, None, &[4711], daten("x"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    }

    #[tokio::test]
    async fn anhang_an_anderem_eintrag_ist_422() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        anlegen_idempotent(&pool, einsatz, benutzer, None, &[a], daten("erster"))
            .await
            .unwrap();

        let err = anlegen_idempotent(&pool, einsatz, benutzer, None, &[a], daten("zweiter"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1, "kein zweiter Eintrag");
    }

    #[tokio::test]
    async fn chat_anhang_ist_422() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "chat.jpg").await;
        let kanal: i64 = sqlx::query_scalar(
            "INSERT INTO chat_kanal (einsatz_id, name, erstellt_von_id) VALUES (?, 'Allgemein', ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        let nachricht: i64 = sqlx::query_scalar(
            "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) VALUES (?, ?, ?, 'x') RETURNING id",
        )
        .bind(einsatz)
        .bind(kanal)
        .bind(benutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_nachricht_anhang (nachricht_id, anhang_id) VALUES (?, ?)")
            .bind(nachricht)
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();

        let err = anlegen_idempotent(&pool, einsatz, benutzer, None, &[a], daten("x"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
    }

    #[tokio::test]
    async fn dokument_anhang_ist_422() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "plan.pdf").await;
        let nachweis = anlegen(&pool, einsatz, benutzer, daten("Dokument abgelegt"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, etb_eintrag_id, abgelegt_von_id) \
             VALUES (?, ?, 'foto', 'Titel', ?, ?)",
        )
        .bind(einsatz)
        .bind(a)
        .bind(nachweis.id)
        .bind(benutzer)
        .execute(&pool)
        .await
        .unwrap();

        let err = anlegen_idempotent(&pool, einsatz, benutzer, None, &[a], daten("x"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
    }

    #[tokio::test]
    async fn replay_liefert_bestand_samt_anhaengen_ohne_anhangspruefung() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        let (erst, _) =
            anlegen_idempotent(&pool, einsatz, benutzer, Some("c-3"), &[a], daten("Foto"))
                .await
                .unwrap();

        // Derselbe Eintrag noch einmal: `a` ist inzwischen gebunden. Das darf den Replay nicht
        // stören — er prüft nicht, ob die Anhänge frei sind, nur ob es DIESELBEN sind (Review
        // C1; andere Anhänge wären ein Konflikt, `gleiche_client_id_mit_anderem_inhalt_…`).
        let (wieder, neu) =
            anlegen_idempotent(&pool, einsatz, benutzer, Some("c-3"), &[a], daten("Foto"))
                .await
                .unwrap();
        assert!(!neu);
        assert_eq!(wieder.id, erst.id);
        assert_eq!(ids(&wieder), vec![a]);
        assert_eq!(verknuepfte_anhaenge(&pool).await, 1);
    }

    #[tokio::test]
    async fn eintrag_ohne_anhang_traegt_leere_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, benutzer, daten("ohne"))
            .await
            .unwrap();
        assert!(e.anhaenge.is_empty());
        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        assert!(liste[0].anhaenge.is_empty());
    }

    #[tokio::test]
    async fn anhaenge_stehen_aufsteigend_nach_id() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        let b = freier_anhang(&pool, einsatz, benutzer, "b.jpg").await;
        // Genannt in umgekehrter Reihenfolge — geliefert wird nach id.
        let (e, _) = anlegen_idempotent(&pool, einsatz, benutzer, None, &[b, a], daten("x"))
            .await
            .unwrap();
        assert_eq!(ids(&e), vec![a, b]);
        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        assert_eq!(ids(&liste[0]), vec![a, b]);
    }

    #[tokio::test]
    async fn cursor_seite_traegt_vollstaendige_anhaenge() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = freier_anhang(&pool, einsatz, benutzer, "a.jpg").await;
        let b = freier_anhang(&pool, einsatz, benutzer, "b.jpg").await;
        let c = freier_anhang(&pool, einsatz, benutzer, "c.jpg").await;
        let (alt, _) = anlegen_idempotent(&pool, einsatz, benutzer, None, &[a, b], daten("alt"))
            .await
            .unwrap();
        anlegen_idempotent(&pool, einsatz, benutzer, None, &[c], daten("neu"))
            .await
            .unwrap();

        let mut f = filter();
        f.limit = 1;
        f.before_lfd_nr = Some(alt.lfd_nr + 1);
        let seite = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite.len(), 1);
        assert_eq!(ids(&seite[0]), vec![a, b]);
    }
}
