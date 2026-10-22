use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

use super::{meldungsart_gueltig, prioritaet_gueltig, LageMeldungAnzeige, MeldungAnzeige};

/// Validierte Eingabe für eine neue Meldung (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct MeldungDaten<'a> {
    pub absender: &'a str,
    pub empfaenger: Option<&'a str>,
    /// Empfängerfunktion (LLH-1214), vom Handler gegen den Katalog geprüft.
    pub empfaenger_funktion: Option<crate::fuehrung::Fuehrungsfunktion>,
    pub meldeweg: &'a str,
    pub inhalt: &'a str,
    pub meldungsart: &'a str,
    pub prioritaet: &'a str,
    pub richtung: &'a str,
    pub ereigniszeit: &'a str,
    pub eingang_at: &'a str,
    /// Sofortmeldung & Eskalation (LFH-97): aktive Bestätigungspflicht.
    pub bestaetigung_pflicht: bool,
    /// Absolute Bestätigungsfrist (UTC), nur bei Pflicht gesetzt.
    pub bestaetigung_frist_at: Option<&'a str>,
    /// Strukturierter Absender (LFH-610); höchstens einer gesetzt, Einsatzzugehörigkeit
    /// vom Handler geprüft.
    pub einheit_id: Option<i64>,
    pub abschnitt_id: Option<i64>,
    /// Verortung (Breite, Länge), vom Handler geprüft; nur eine Lagemeldung trägt sie beim Anlegen
    /// (LLH-1031), andere Arten bekommen sie mit der Übernahme in die Lage.
    pub geo: Option<(f64, f64)>,
}

/// Offen: Status ungleich „erledigt" (Posteingang = offene Meldungen). Liste und Modulzähler
/// beziehen das Prädikat von hier (LFH-935), es gibt kein zweites.
macro_rules! ist_offen_sql {
    () => {
        "(m.status != 'erledigt')"
    };
}

/// Bestätigt: die Quittungs-Achse (`kommunikation_status`, Alias `ks`) trägt einen Zeitpunkt.
macro_rules! ist_bestaetigt_sql {
    () => {
        "(ks.quittiert_at IS NOT NULL)"
    };
}

/// Bestätigung überfällig: pflichtig, unbestätigt, Frist abgelaufen. Trägt EIN `?` für `jetzt`.
macro_rules! ist_ueberfaellig_sql {
    () => {
        "(m.bestaetigung_pflicht = 1 AND ks.quittiert_at IS NULL \
          AND m.bestaetigung_frist_at IS NOT NULL AND m.bestaetigung_frist_at <= ?)"
    };
}

/// In der Lage: die Meldung (Alias `m`) ist lagerelevant (LLH-1031, LLH-1027 D1). Liste,
/// Kenntnisnahme und Modulzähler der Lagemeldungen beziehen das Prädikat von hier.
macro_rules! lage_sicht_sql {
    () => {
        "(m.lagerelevant = 1)"
    };
}

/// Neu: noch niemand hat die Lagemeldung (Alias `m`) als gesehen gekennzeichnet (LLH-1206).
/// Liste der Lagemeldungen und Modulzähler beziehen das Prädikat von hier, es gibt kein zweites.
macro_rules! is_neu_sql {
    () => {
        "(m.lage_gesehen_at IS NULL)"
    };
}

/// Jüngste ETB-Berichtigung des Eintrags der Meldung (Alias `m`, LLH-1382, design.md D2): id und
/// Nummer als zwei Spalten `etb_berichtigung_id`/`etb_berichtigung_lfd_nr`, NULL ohne
/// Berichtigung. Dieselbe Regel wie im ETB (jüngste direkte Berichtigung, `typ = 'berichtigung'`,
/// nur im selben Einsatz wie `etb::repo::berichtigungen_nachladen`); Index `idx_etb_berichtigt`.
/// Meldung und Lagemeldung beziehen die Spalten von hier, es gibt kein zweites Fragment.
macro_rules! etb_berichtigung_sql {
    () => {
        "(SELECT b.id FROM etb_eintrag b WHERE b.typ = 'berichtigung' \
            AND b.berichtigt_eintrag_id = m.etb_meldung_id AND b.einsatz_id = m.einsatz_id \
            ORDER BY b.lfd_nr DESC LIMIT 1) AS etb_berichtigung_id, \
         (SELECT b.lfd_nr FROM etb_eintrag b WHERE b.typ = 'berichtigung' \
            AND b.berichtigt_eintrag_id = m.etb_meldung_id AND b.einsatz_id = m.einsatz_id \
            ORDER BY b.lfd_nr DESC LIMIT 1) AS etb_berichtigung_lfd_nr"
    };
}

/// Die Bestätigungs-Achse einer Meldung (Alias `ks`), geteilt von Liste und Zählung.
macro_rules! quittung_join_sql {
    () => {
        " LEFT JOIN kommunikation_status ks ON ks.objekt_typ = 'meldung' AND ks.objekt_id = m.id"
    };
}

/// SELECT-Projektion inkl. Bearbeitername (LEFT JOIN benutzer), Bestätigungs-Achse (LEFT JOIN kommunikation_status, objekt_typ
/// ='meldung') und abgeleiteten Feldern. Reihenfolge der Spalten = Struct (FromRow positional).
///
/// `ist_ueberfaellig` ist eine computed column mit `jetzt`-Vergleich → ihr `?` steht textuell
/// VOR der WHERE-Klausel; alle Aufrufer binden `jetzt` als ERSTEN Parameter (Muster erinnerung).
const ANZEIGE_SELECT: &str = concat!(
    "SELECT m.id, m.einsatz_id, m.lfd_nr, m.absender, m.empfaenger, m.empfaenger_funktion, \
            m.meldeweg, m.inhalt, \
            m.meldungsart, m.prioritaet, m.richtung, m.status, m.bearbeiter_id, b.anzeigename AS bearbeiter_name, \
            m.lagerelevant, m.ereigniszeit, m.eingang_at, m.etb_meldung_id, m.auftrag_id, \
            EXISTS (SELECT 1 FROM auftrag a WHERE a.id = m.auftrag_id AND a.aufgehoben_at IS NOT NULL) \
              AS is_auftrag_aufgehoben, \
            m.erfasst_von_id, m.erstellt_at, ",
    ist_offen_sql!(),
    " AS ist_offen, \
            m.erledigt_at, \
            m.bestaetigung_pflicht, m.bestaetigung_frist_at, m.eskaliert, \
            ks.quittiert_at AS bestaetigt_at, ks.quittiert_von_id AS bestaetigt_von_id, \
            qb.anzeigename AS bestaetigt_von_name, ",
    ist_bestaetigt_sql!(),
    " AS ist_bestaetigt, ",
    ist_ueberfaellig_sql!(),
    " AS ist_ueberfaellig, \
            m.einheit_id, m.abschnitt_id, ",
    etb_berichtigung_sql!(),
    " FROM meldung m \
     LEFT JOIN benutzer b ON b.id = m.bearbeiter_id",
    quittung_join_sql!(),
    " LEFT JOIN benutzer qb ON qb.id = ks.quittiert_von_id"
);

/// Eine Gruppe gleicher Zählmerkmale mit ihrer Anzahl ([`zaehlen`]).
#[derive(sqlx::FromRow)]
struct MerkmalGruppe {
    #[sqlx(try_from = "String")]
    status: super::MeldungStatus,
    ist_offen: bool,
    bestaetigung_pflicht: bool,
    ist_bestaetigt: bool,
    ist_ueberfaellig: bool,
    eskaliert: bool,
    anzahl: i64,
}

/// Modulzähler der Meldungen (LFH-935): EINE Abfrage, gruppiert nach den Merkmalen, die die
/// Zählregel braucht ([`crate::einsatz::zaehler::zaehle_meldungen_gewichtet`]). Die Prädikate
/// sind dieselben Fragmente wie in [`ANZEIGE_SELECT`]; ohne `inhalt`, ohne Benutzer-Joins,
/// ohne Lage-Spalten. Die Ergebnismenge hängt an den Merkmalskombinationen, nicht am Bestand.
/// Bind-Reihenfolge: `jetzt` (Fragment im SELECT), dann `einsatz_id`.
pub async fn zaehlen(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<crate::einsatz::zaehler::MeldungsZaehler, AppError> {
    const SQL: &str = concat!(
        "SELECT m.status, ",
        ist_offen_sql!(),
        " AS ist_offen, m.bestaetigung_pflicht, ",
        ist_bestaetigt_sql!(),
        " AS ist_bestaetigt, ",
        ist_ueberfaellig_sql!(),
        " AS ist_ueberfaellig, m.eskaliert, COUNT(*) AS anzahl \
         FROM meldung m",
        quittung_join_sql!(),
        " WHERE m.einsatz_id = ? GROUP BY 1, 2, 3, 4, 5, 6"
    );
    let gruppen = sqlx::query_as::<_, MerkmalGruppe>(SQL)
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
    Ok(crate::einsatz::zaehler::zaehle_meldungen_gewichtet(
        gruppen.into_iter().map(|g| {
            (
                crate::einsatz::zaehler::MeldungsMerkmale {
                    status: g.status,
                    ist_offen: g.ist_offen,
                    bestaetigung_pflicht: g.bestaetigung_pflicht,
                    ist_bestaetigt: g.ist_bestaetigt,
                    ist_ueberfaellig: g.ist_ueberfaellig,
                    eskaliert: g.eskaliert,
                },
                g.anzahl,
            )
        }),
    ))
}

/// Lädt eine Meldung als Anzeige. `NotFound`, wenn unbekannt.
/// Bind-Reihenfolge: zuerst `jetzt` (computed `ist_ueberfaellig`), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<MeldungAnzeige, AppError> {
    sqlx::query_as::<_, MeldungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE m.id = ?"
    )))
    .bind(jetzt)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Meldung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung',
/// Pattern B mit beidseitigem Backlink). `lfd_nr` atomar (COALESCE(MAX)+1 pro Einsatz).
/// `daten` ist vom Handler validiert (Pflichtfelder, Vokabular, Zeit normalisiert).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: MeldungDaten<'_>,
) -> Result<MeldungAnzeige, AppError> {
    anlegen_mit_client_id(pool, einsatz_id, erfasser_id, None, daten).await
}

/// Legt eine Meldung samt ETB-Eintrag auf einer offenen Verbindung/Transaktion an, ohne
/// `client_id`-Idempotenz (LFH-690, Demo-Import in EINER Transaktion). Öffnet und committet
/// selbst nichts. Einsatz- und Org-Einstellungen (Nummern-Startwerte, Auto-ETB) liest sie
/// über dieselbe Verbindung — so findet sie auch einen Einsatz, den dieselbe Transaktion
/// gerade angelegt hat, und fällt nicht still auf die Einstellungen von Org 0 zurück.
/// Liefert die neue `meldung_id`.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: &MeldungDaten<'_>,
) -> Result<i64, AppError> {
    anlegen_mit_client_id_tx(conn, einsatz_id, erfasser_id, None, daten).await
}

/// Offline-/Timeout-fähige Variante (LFH-334/B6). Ein stabiler
/// `(einsatz_id, client_id)`-Schlüssel liefert bei Replay die bestehende Meldung
/// und unterdrückt damit sowohl eine zweite laufende Nummer als auch den
/// gekoppelten ETB-Eintrag. `bool` ist nur bei einem echten Insert `true`.
pub async fn anlegen_idempotent(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    daten: MeldungDaten<'_>,
) -> Result<(MeldungAnzeige, bool), AppError> {
    if !prioritaet_gueltig(daten.prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    if !meldungsart_gueltig(daten.meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    if !super::richtung_gueltig(daten.richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }
    let Some(cid) = client_id else {
        return Ok((anlegen(pool, einsatz_id, erfasser_id, daten).await?, true));
    };
    if let Some(id) = bestehende_client_id(pool, einsatz_id, cid).await? {
        return Ok((laden(pool, id, daten.eingang_at).await?, false));
    }

    match anlegen_mit_client_id(pool, einsatz_id, erfasser_id, Some(cid), daten).await {
        Ok(meldung) => Ok((meldung, true)),
        // Ein paralleler Tab kann zwischen SELECT und INSERT gewonnen haben.
        // Der Unique-Fehler rollt die ganze Meldung+ETB-Tx zurück; danach lesen
        // wir den Gewinner und liefern eine idempotente Antwort.
        Err(e) => match bestehende_client_id(pool, einsatz_id, cid).await? {
            Some(id) => {
                let aktuell = crate::zeit::jetzt();
                Ok((laden(pool, id, &aktuell).await?, false))
            }
            None => Err(e),
        },
    }
}

async fn bestehende_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM meldung WHERE einsatz_id = ? AND client_id = ?")
            .bind(einsatz_id)
            .bind(client_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Lädt eine bereits committete Meldung anhand ihres einsatzgebundenen
/// Idempotenzschlüssels. `einsatz_id` bleibt Teil des Lookups, damit eine gleiche
/// `client_id` in einem anderen Einsatz niemals dessen Datensatz zurückgibt.
pub async fn laden_nach_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
    jetzt: &str,
) -> Result<Option<MeldungAnzeige>, AppError> {
    match bestehende_client_id(pool, einsatz_id, client_id).await? {
        Some(id) => laden(pool, id, jetzt).await.map(Some),
        None => Ok(None),
    }
}

/// Publiziert das persistente Live-/Sofortalarm-Buendel einer Meldung at-least-once.
///
/// Der Marker bleibt bis NACH dem synchronen Publish NULL. Ein Prozessabbruch vor dem Publish
/// wird deshalb durch den naechsten `client_id`-Replay repariert. Ein Abbruch nach Publish, aber
/// vor dem Marker-Commit, kann bewusst eine Dublette erzeugen; ein verlorener Sofortalarm ist
/// die gefaehrlichere Richtung. `BEGIN IMMEDIATE` serialisiert konkurrierende Replays und
/// vermeidet Dubletten im Normalbetrieb. Die Transaktion wird absichtlich NICHT automatisch
/// wiederholt: ein Commit-Fehler nach dem Seiteneffekt bleibt als NULL-Marker fuer den expliziten
/// Request-Replay sichtbar.
pub async fn publiziere_live_ausstehend<F>(
    pool: &SqlitePool,
    meldung_id: i64,
    publiziert_at: &str,
    publiziere: F,
) -> Result<bool, AppError>
where
    F: FnOnce(),
{
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let ausstehend: Option<bool> =
        sqlx::query_scalar("SELECT live_published_at IS NULL FROM meldung WHERE id = ?")
            .bind(meldung_id)
            .fetch_optional(&mut *tx)
            .await?;
    let ausstehend = ausstehend.ok_or(AppError::NotFound)?;
    if !ausstehend {
        tx.commit().await?;
        return Ok(false);
    }

    publiziere();
    sqlx::query(
        "UPDATE meldung SET live_published_at = ? \
         WHERE id = ? AND live_published_at IS NULL",
    )
    .bind(publiziert_at)
    .bind(meldung_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// Pool-Hülle um [`anlegen_mit_client_id_tx`] in einer `write_retry!`-Transaktion. Bis
/// LFH-690 lagen die Einstellungs-Lesezugriffe vor einem deferred `pool.begin()`; seit sie
/// in der Transaktion liegen, liest die Transaktion zuerst und schreibt dann. Unter einem
/// deferred `BEGIN` wäre das ein Lock-Upgrade, das SQLite bei fremdem Writer sofort mit
/// `SQLITE_BUSY` abweist (siehe `crate::tx`). `BEGIN IMMEDIATE` holt die Schreibsperre
/// vorab. Ein Unique-Verstoß auf `client_id` rollt wie bisher die ganze Meldung+ETB-Tx
/// zurück, bevor [`anlegen_idempotent`] den Gewinner über den Pool liest.
async fn anlegen_mit_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    daten: MeldungDaten<'_>,
) -> Result<MeldungAnzeige, AppError> {
    let meldung_id = crate::write_retry!(pool, |conn| {
        anlegen_mit_client_id_tx(&mut *conn, einsatz_id, erfasser_id, client_id, &daten).await
    })?;
    // `eingang_at` ist der Erfassungszeitpunkt = „jetzt" für die frisch erzeugte Meldung;
    // ist_ueberfaellig ist hier ohnehin false (Frist liegt in der Zukunft).
    laden(pool, meldung_id, daten.eingang_at).await
}

/// Rumpf der Meldungsanlage auf einer offenen Verbindung/Transaktion: [`einfuegen_tx`] und —
/// bei aktivem Auto-ETB — der gekoppelte ETB-Eintrag mit beidseitigem Backlink. Liefert die
/// neue `meldung_id`.
async fn anlegen_mit_client_id_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    daten: &MeldungDaten<'_>,
) -> Result<i64, AppError> {
    let (meldung_id, einst, org_einst) =
        einfuegen_tx(&mut *conn, einsatz_id, erfasser_id, client_id, daten).await?;
    let etb_startwert = einst.etb_startwert();

    // ETB-Meldung (Pattern B) im selben Commit. Nachrichtenvordruck-Felder mappen
    // direkt: von=absender, an=empfaenger, meldeweg, inhalt, ereigniszeit.
    // Auto-ETB-Schalter (LFH-133): bei abgeschaltetem Dual-Publish entsteht kein
    // ETB-Folgeeintrag; etb_meldung_id bleibt NULL. Eine Lagemeldung protokolliert als Lage
    // (LLH-1031, LLH-1027 D3), jede andere Art als Meldung.
    if crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst) {
        let typ = if daten.meldungsart == super::ART_LAGEMELDUNG {
            crate::etb::TYP_LAGE
        } else {
            crate::etb::TYP_MELDUNG
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            &mut *conn,
            einsatz_id,
            erfasser_id,
            etb_startwert,
            crate::etb::repo::EintragDaten {
                typ,
                inhalt: daten.inhalt,
                von: Some(daten.absender),
                an: daten.empfaenger,
                meldeweg: Some(daten.meldeweg),
                veranlassung: None,
                ereigniszeit: Some(daten.ereigniszeit),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        verlinke_tx(&mut *conn, meldung_id, etb_id).await?;
    }

    Ok(meldung_id)
}

/// Der EINE INSERT in `meldung` samt Validierung, Einstellungen (über dieselbe Verbindung),
/// atomarer `lfd_nr` und der Invariante „Art Lagemeldung ⇒ lagerelevant“. Ohne ETB: den
/// Eintrag schreibt der Aufrufer (Auto-ETB in [`anlegen_mit_client_id_tx`]) oder es gibt ihn
/// schon ([`anlegen_zu_etb_tx`]). Liefert die neue `meldung_id` und die gelesenen Einstellungen.
async fn einfuegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    daten: &MeldungDaten<'_>,
) -> Result<
    (
        i64,
        crate::einsatz::einstellungen::EinsatzEinstellungen,
        crate::org::einstellungen::OrgEinstellungen,
    ),
    AppError,
> {
    // Enum-Invariante auch im Release durchsetzen (LFH-259/F34): debug_assert wäre
    // wegkompiliert → ein interner Aufrufer könnte still ungültige Werte persistieren.
    if !prioritaet_gueltig(daten.prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    if !meldungsart_gueltig(daten.meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    if !super::richtung_gueltig(daten.richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }
    let einst = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(&mut *conn, org_id.unwrap_or(0)).await?;
    let meldung_startwert = einst.meldung_startwert();

    // lfd_nr atomar je Einsatz (Muster etb/repo.rs); erste Nummer = Startwert aus Einstellungen.
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO meldung \
           (einsatz_id, lfd_nr, absender, empfaenger, empfaenger_funktion, meldeweg, inhalt, \
            meldungsart, prioritaet, richtung, ereigniszeit, eingang_at, bestaetigung_pflicht, \
            bestaetigung_frist_at, erfasst_von_id, client_id, einheit_id, abschnitt_id, lat, lon) \
         SELECT ?, COALESCE(MAX(lfd_nr) + 1, ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? \
         FROM meldung WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(meldung_startwert)
    .bind(daten.absender)
    .bind(daten.empfaenger)
    .bind(daten.empfaenger_funktion.map(|f| f.as_str()))
    .bind(daten.meldeweg)
    .bind(daten.inhalt)
    .bind(daten.meldungsart)
    .bind(daten.prioritaet)
    .bind(daten.richtung)
    .bind(daten.ereigniszeit)
    .bind(daten.eingang_at)
    .bind(daten.bestaetigung_pflicht)
    .bind(daten.bestaetigung_frist_at)
    .bind(erfasser_id)
    .bind(client_id)
    .bind(daten.einheit_id)
    .bind(daten.abschnitt_id)
    .bind(daten.geo.map(|(lat, _)| lat))
    .bind(daten.geo.map(|(_, lon)| lon))
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    apply_lage_invariante_tx(&mut *conn, meldung_id).await?;
    Ok((meldung_id, einst, org_einst))
}

/// Legt zu einem gerade in DERSELBEN Transaktion angelegten ETB-Eintrag die Meldung an (LLH-1037,
/// Spec `meldungseingang`, „ETB-Erfassung von Meldung und Lage …“): Pattern B umgekehrt. Kein
/// Auto-ETB, gleich wie „Automatische ETB-Einträge“ steht — der Eintrag ist ihr Eintrag; die
/// Backlinks stehen beidseitig. `client_id` ist die des Eintrags (dedupliziert wird über ihn).
/// Die Invariante „Art Lagemeldung ⇒ lagerelevant“ läuft über [`einfuegen_tx`].
pub async fn anlegen_zu_etb_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    client_id: Option<&str>,
    etb_id: i64,
    daten: &MeldungDaten<'_>,
) -> Result<i64, AppError> {
    let (meldung_id, _, _) =
        einfuegen_tx(&mut *conn, einsatz_id, erfasser_id, client_id, daten).await?;
    verlinke_tx(&mut *conn, meldung_id, etb_id).await?;
    Ok(meldung_id)
}

/// Ob der ETB-Eintrag `etb_id` der Eintrag einer Meldung dieses Einsatzes ist (`etb_meldung_id`).
/// Eine Berichtigung dieses Eintrags zeigt sich an der Meldung (LLH-1382, design.md D5).
pub async fn is_etb_eintrag_einer_meldung(
    pool: &SqlitePool,
    einsatz_id: i64,
    etb_id: i64,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM meldung WHERE einsatz_id = ? AND etb_meldung_id = ?)",
    )
    .bind(einsatz_id)
    .bind(etb_id)
    .fetch_one(pool)
    .await?)
}

/// Beidseitiger Backlink Meldung ↔ ETB-Eintrag (Pattern B, beide Richtungen).
async fn verlinke_tx(
    conn: &mut SqliteConnection,
    meldung_id: i64,
    etb_id: i64,
) -> Result<(), AppError> {
    sqlx::query("UPDATE etb_eintrag SET meldung_id = ? WHERE id = ?")
        .bind(meldung_id)
        .bind(etb_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE meldung SET etb_meldung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(meldung_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Invariante „Art Lagemeldung ⇒ lagerelevant“ (LLH-1031, LLH-1027 D3): eine Meldung der Art
/// „Lagemeldung“ steht ab ihrer Anlage in der Lage, übernommen am Eingang durch ihren Erfasser.
/// Jeder Schreibweg, der eine Meldung anlegt oder ihre Art setzt, ruft diese Funktion; kein
/// Handler setzt das Flag selbst (`src/AGENTS.md`, „Meldungsmodell“). Eine schon bestehende
/// Übernahme bleibt mit Zeitpunkt und Person; jede andere Art bleibt unberührt.
pub async fn apply_lage_invariante_tx(
    conn: &mut SqliteConnection,
    meldung_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE meldung SET lagerelevant = 1, \
            lage_uebergeben_at = COALESCE(lage_uebergeben_at, eingang_at), \
            lage_uebergeben_von_id = COALESCE(lage_uebergeben_von_id, erfasst_von_id) \
         WHERE id = ? AND meldungsart = ?",
    )
    .bind(meldung_id)
    .bind(super::ART_LAGEMELDUNG)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ordnungszeitpunkt der Abgeschlossen-Ansicht (LFH-940, D2): zuletzt erledigt oben; ohne
/// Stempel (Altbestand vor LFH-113) die Ereigniszeit. Liste und Cursor lesen denselben Ausdruck.
macro_rules! abschluss_zeit_sql {
    () => {
        "COALESCE(m.erledigt_at, m.ereigniszeit)"
    };
}

/// Filter einer Meldungsliste. `seite` gilt nur zusammen mit `phase = Abgeschlossen`
/// ([`crate::kommunikation::phase_und_seite`]).
#[derive(Debug, Default)]
pub struct MeldungFilter<'a> {
    pub status: Option<&'a str>,
    pub richtung: Option<&'a str>,
    /// Gekoppeltes Gerät (LFH-892): nur die selbst erfassten Meldungen. Steht im SQL, nicht
    /// hinter dem LIMIT, sonst wären Seiten kurz und der Cursor falsch (LFH-940, D5).
    pub erfasst_von: Option<i64>,
    pub phase: Option<crate::kommunikation::ListenPhase>,
    pub seite: Option<crate::kommunikation::Seite>,
}

/// WHERE-Ergänzungen (ohne Cursor) samt Bindwerten in textueller Reihenfolge.
fn filter_bedingung(f: &MeldungFilter<'_>) -> (String, Vec<FilterWert>) {
    use crate::kommunikation::ListenPhase;
    let mut sql = String::new();
    let mut werte = Vec::new();
    match f.phase {
        Some(ListenPhase::Offen) => sql.push_str(concat!(" AND ", ist_offen_sql!())),
        Some(ListenPhase::Abgeschlossen) => sql.push_str(concat!(" AND NOT ", ist_offen_sql!())),
        None => {}
    }
    if let Some(s) = f.status {
        sql.push_str(" AND m.status = ?");
        werte.push(FilterWert::Text(s.to_string()));
    }
    if let Some(r) = f.richtung {
        sql.push_str(" AND m.richtung = ?");
        werte.push(FilterWert::Text(r.to_string()));
    }
    if let Some(von) = f.erfasst_von {
        sql.push_str(" AND m.erfasst_von_id = ?");
        werte.push(FilterWert::Zahl(von));
    }
    (sql, werte)
}

enum FilterWert {
    Text(String),
    Zahl(i64),
}

/// Listet Meldungen eines Einsatzes.
///
/// - ohne Phase und `offen`: Priorität (sofort→normal), eskalierte zuerst, dann neueste
///   Ereigniszeit, dann lfd_nr; ungeblättert.
/// - `abgeschlossen`: zuletzt erledigt oben ([`abschluss_zeit_sql`]), bei Gleichstand die höhere
///   id; eine Seite ab dem Cursor.
///
/// Bind-Reihenfolge: zuerst `jetzt` (computed `ist_ueberfaellig`), dann WHERE-Parameter.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &MeldungFilter<'_>,
    jetzt: &str,
) -> Result<Vec<MeldungAnzeige>, AppError> {
    let (bedingung, werte) = filter_bedingung(filter);
    let mut q = format!("{ANZEIGE_SELECT} WHERE m.einsatz_id = ?{bedingung}");
    let seite = match filter.phase {
        Some(crate::kommunikation::ListenPhase::Abgeschlossen) => filter.seite.as_ref(),
        _ => None,
    };
    if let Some(seite) = seite {
        if seite.vor.is_some() {
            q.push_str(concat!(
                " AND (",
                abschluss_zeit_sql!(),
                " < ? OR (",
                abschluss_zeit_sql!(),
                " = ? AND m.id < ?))"
            ));
        }
        q.push_str(concat!(
            " ORDER BY ",
            abschluss_zeit_sql!(),
            " DESC, m.id DESC LIMIT ?"
        ));
    } else {
        q.push_str(
            " ORDER BY CASE m.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
              m.eskaliert DESC, m.ereigniszeit DESC, m.lfd_nr DESC",
        );
    }
    // Bind-Reihenfolge = textuelle ?-Reihenfolge: jetzt, einsatz_id, Filter, [Cursor], [limit].
    let mut query = sqlx::query_as::<_, MeldungAnzeige>(sqlx::AssertSqlSafe(&*q))
        .bind(jetzt)
        .bind(einsatz_id);
    for w in werte {
        query = match w {
            FilterWert::Text(t) => query.bind(t),
            FilterWert::Zahl(z) => query.bind(z),
        };
    }
    if let Some(seite) = seite {
        if let Some(vor) = &seite.vor {
            query = query
                .bind(vor.zeit.clone())
                .bind(vor.zeit.clone())
                .bind(vor.id);
        }
        query = query.bind(seite.limit);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Lädt eine Meldung des Einsatzes als Anzeige (LFH-940, Einzelabruf für den Deeplink).
/// `NotFound` für eine unbekannte oder einsatzfremde Kennung, ebenso für eine fremde Meldung,
/// wenn `erfasst_von` gesetzt ist (Gerät).
pub async fn laden_im_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    erfasst_von: Option<i64>,
    jetzt: &str,
) -> Result<MeldungAnzeige, AppError> {
    let m = laden(pool, id, jetzt).await?;
    if m.einsatz_id != einsatz_id || erfasst_von.is_some_and(|v| v != m.erfasst_von_id) {
        return Err(AppError::NotFound);
    }
    Ok(m)
}

/// Eine Gruppe der Kennzahlen ([`kennzahlen`]).
#[derive(sqlx::FromRow)]
struct KennzahlGruppe {
    ist_offen: bool,
    ist_neu: bool,
    ist_alarmiert: bool,
    anzahl: i64,
}

/// Kennzahlen der Meldungsseite (LFH-940, D3): EINE gruppierte Abfrage über dieselben Fragmente
/// wie Liste und Zähler, mit den Filtern der Liste (ohne Phase, ohne Seite). „Alarmiert“ zählt
/// quer zur Phase wie `istAlarmiert` im Client: pflichtig, unbestätigt, Frist abgelaufen oder
/// eskaliert. Bind-Reihenfolge: `jetzt` (Fragment im SELECT), `einsatz_id`, Filter.
pub async fn kennzahlen(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &MeldungFilter<'_>,
    jetzt: &str,
) -> Result<super::MeldungKennzahlen, AppError> {
    let (bedingung, werte) = filter_bedingung(&MeldungFilter {
        phase: None,
        seite: None,
        ..*filter
    });
    let q = format!(
        concat!(
            "SELECT ",
            ist_offen_sql!(),
            " AS ist_offen, (m.status = 'neu') AS ist_neu, \
             (m.bestaetigung_pflicht = 1 AND NOT ",
            ist_bestaetigt_sql!(),
            " AND (",
            ist_ueberfaellig_sql!(),
            " OR m.eskaliert = 1)) AS ist_alarmiert, COUNT(*) AS anzahl \
             FROM meldung m",
            quittung_join_sql!(),
            " WHERE m.einsatz_id = ?{} GROUP BY 1, 2, 3"
        ),
        bedingung
    );
    let mut query = sqlx::query_as::<_, KennzahlGruppe>(sqlx::AssertSqlSafe(&*q))
        .bind(jetzt)
        .bind(einsatz_id);
    for w in werte {
        query = match w {
            FilterWert::Text(t) => query.bind(t),
            FilterWert::Zahl(z) => query.bind(z),
        };
    }
    let mut k = super::MeldungKennzahlen::default();
    for g in query.fetch_all(pool).await? {
        if !g.ist_offen {
            k.erledigt += g.anzahl;
        } else if g.ist_neu {
            k.unbearbeitet += g.anzahl;
        } else {
            k.in_arbeit += g.anzahl;
        }
        if g.ist_alarmiert {
            k.alarmiert += g.anzahl;
        }
    }
    Ok(k)
}

/// Cross-Einsatz-Schutz: gehört die Meldung zum Einsatz?
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM meldung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt NUR den Triage-Status (LFH-94). Die Bearbeiter-Zuweisung ist eine
/// getrennte Achse (`weise_bearbeiter`) — ein Statuswechsel darf eine bestehende
/// Zuweisung nicht stillschweigend überschreiben (vgl. patch-xor-effektivzustand).
pub async fn setze_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    if !super::status_gueltig(status) {
        return Err(AppError::Validation("Ungültiger Status".into()));
    }
    // Erledigt-Stempel (LFH-113): first-write-wins — nur beim Übergang nach 'erledigt'
    // und nur solange noch NULL (COALESCE). Wird der Status später zurückgesetzt, bleibt
    // erledigt_at erhalten; ein erneutes Erledigen überschreibt den ersten Stempel nicht.
    sqlx::query(
        "UPDATE meldung SET status = ?, \
         erledigt_at = CASE WHEN ? = 'erledigt' THEN COALESCE(erledigt_at, ?) ELSE erledigt_at END \
         WHERE id = ?",
    )
    .bind(status)
    .bind(status)
    .bind(jetzt)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Setzt/entfernt die Bearbeiter-Zuweisung (LFH-94), unabhängig vom Status.
/// `Some(id)` weist zu, `None` gibt frei. Der Aufrufer hat die Mitgliedschaft
/// des Bearbeiters geprüft (Cross-Einsatz-Schutz).
pub async fn weise_bearbeiter(
    pool: &SqlitePool,
    id: i64,
    bearbeiter_id: Option<i64>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE meldung SET bearbeiter_id = ? WHERE id = ?")
        .bind(bearbeiter_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Bestätigt eine Sofortmeldung (LFH-97): setzt die Quittungs-Achse (kommunikation_status,
/// objekt_typ='meldung') **atomar einmalig** und schließt eine etwaige offene Auto-Frist-
/// Erinnerung des Bezugs (stoppt Nachfass/Eskalation). Liefert `true`, wenn DIESER Aufruf
/// bestätigt hat; `false`, wenn bereits bestätigt war (→ Handler antwortet 422, ohne TOCTOU).
/// Der Triage-`status` ist eine eigene Achse (vgl. patch-xor-effektivzustand) mit einer
/// Ausnahme: eine Meldung im Status `neu` geht auf `gesichtet` — wer den Empfang bestätigt,
/// hat sie gesehen (LLH-1052, Spec `benachrichtigungen`, „Bestätigen sichtet die
/// Sofortmeldung“). Spätere Status bleiben. Ein etwaiges `eskaliert`-Flag wird mit der
/// Bestätigung zurückgesetzt (Daten-Hygiene + Sortierung).
pub async fn bestaetige(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let frisch = crate::write_retry!(pool, |conn| {
        bestaetige_tx(conn, org_id, einsatz_id, meldung_id, von_id, jetzt).await
    })?;
    Ok(frisch)
}

/// Rumpf von [`bestaetige`] auf einer offenen Verbindung/Transaktion (LFH-690: der
/// Demo-Import legt seine Sofortmeldung in EINER Transaktion bestätigt an, design.md D5).
/// Öffnet und committet selbst nichts; die Pool-Hülle fährt ihn in `write_retry!`.
pub async fn bestaetige_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let frisch = crate::kommunikation::repo::quittiere_einmalig_tx(
        conn,
        org_id,
        einsatz_id,
        crate::kommunikation::OBJEKT_MELDUNG,
        meldung_id,
        von_id,
        jetzt,
    )
    .await?;
    if !frisch {
        return Ok(false);
    }
    crate::erinnerung::repo::schliesse_offene_auto_tx(
        conn,
        crate::kommunikation::OBJEKT_MELDUNG,
        meldung_id,
        jetzt,
    )
    .await?;
    // Eskalations-Residuum loeschen: nach Bestaetigung ist die Meldung nicht mehr
    // `eskaliert`. Aus `neu` wird `gesichtet`, jeder spätere Status bleibt. Quittung,
    // Reminder-Abschluss, Flag und Status teilen einen Commit.
    sqlx::query(
        "UPDATE meldung SET eskaliert = 0, \
         status = CASE WHEN status = ? THEN ? ELSE status END \
         WHERE id = ?",
    )
    .bind(super::STATUS_NEU)
    .bind(super::STATUS_GESICHTET)
    .bind(meldung_id)
    .execute(&mut *conn)
    .await?;
    Ok(true)
}

/// Setzt das Eskalations-Flag — aber NUR wenn die Meldung bestätigungspflichtig, ihre Frist
/// überschritten und sie noch unbestätigt ist und noch nicht eskaliert war. Liefert `true`,
/// wenn dieser Aufruf frisch eskaliert hat (→ genau ein Re-Highlight). Der `eskaliert = 0`-Guard
/// macht es One-Shot; aufgerufen ausschließlich aus dem Erinnerungs-Tick (kein eigener Timer).
pub async fn setze_eskaliert(
    pool: &SqlitePool,
    meldung_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let rows = sqlx::query(
        "UPDATE meldung SET eskaliert = 1 \
         WHERE id = ? AND bestaetigung_pflicht = 1 AND eskaliert = 0 \
           AND bestaetigung_frist_at IS NOT NULL AND bestaetigung_frist_at <= ? \
           AND NOT EXISTS ( \
             SELECT 1 FROM kommunikation_status ks \
             WHERE ks.objekt_typ = 'meldung' AND ks.objekt_id = meldung.id \
               AND ks.quittiert_at IS NOT NULL)",
    )
    .bind(meldung_id)
    .bind(jetzt)
    .execute(pool)
    .await?;
    Ok(rows.rows_affected() > 0)
}

/// Ergebnis von [`als_lagerelevant`]: die Lagemeldung (seit LLH-1031 die Meldungs-id selbst,
/// LLH-1027 D6) und, bei der ersten Übergabe einer Meldung, die keine Lagemeldung ist, der
/// Systemeintrag im ETB (für das Live-Ereignis).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LageUebergabe {
    pub lage_id: i64,
    pub etb_id: Option<i64>,
}

/// Übernimmt eine Meldung in die Lage (LFH-95; seit LLH-1031 Spalten der Meldung, LLH-1027 D5):
/// setzt `lagerelevant = 1`, beim ersten Mal Zeitpunkt und Person der Übernahme. `text` ist der
/// Lage-Text (Vorgabe des Handlers: der Wortlaut); gleich dem Wortlaut wird er als NULL
/// gespeichert, der Wortlaut gilt. Verortet wird nur, solange keine Verortung besteht (ändern
/// lässt sie sich danach nur über die Korrektur, LLH-1066). Idempotent: eine erneute Übernahme
/// legt nichts Neues an; ändert sie den Lage-Text, ist die Lagemeldung wieder neu (LLH-1206, D3). Alle Ausdrücke des Updates lesen
/// den Stand VOR dem Update (SQLite). `NotFound`, wenn die Meldung nicht zum Einsatz gehört.
///
/// Die ERSTE Übernahme schreibt „Meldung #12 in die Lage übernommen“ als Systemeintrag mit
/// Verweis auf die Meldung (LLH-1104 D8; Wortlaut wie Knopf und Hinweis, LLH-1046), unabhängig
/// vom Auto-ETB-Schalter; nicht für die Art „Lagemeldung“, die ab der Anlage in der Lage steht und
/// ihren Lage-Eintrag über das Auto-ETB trägt (LLH-1027 D3). Atomar (Tx): ein Teilfehler rollt Übernahme und ETB-Eintrag zurück.
pub async fn als_lagerelevant(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    text: &str,
    geo: Option<(f64, f64)>,
) -> Result<LageUebergabe, AppError> {
    crate::write_retry!(pool, |conn| {
        let (lfd_nr, meldungsart, schon_in_der_lage): (i64, String, bool) = sqlx::query_as(
            "SELECT lfd_nr, meldungsart, lagerelevant = 1 FROM meldung \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(meldung_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        sqlx::query(
            "UPDATE meldung SET \
               lage_gesehen_at = CASE WHEN lagerelevant = 1 AND COALESCE(lage_text, inhalt) = ?1 \
                                      THEN lage_gesehen_at END, \
               lage_gesehen_von_id = CASE WHEN lagerelevant = 1 \
                                           AND COALESCE(lage_text, inhalt) = ?1 \
                                          THEN lage_gesehen_von_id END, \
               lage_text = NULLIF(?1, inhalt), \
               lat = CASE WHEN lat IS NULL AND lon IS NULL THEN ?2 ELSE lat END, \
               lon = CASE WHEN lat IS NULL AND lon IS NULL THEN ?3 ELSE lon END, \
               lage_uebergeben_at = COALESCE(lage_uebergeben_at, datetime('now')), \
               lage_uebergeben_von_id = COALESCE(lage_uebergeben_von_id, ?4), \
               lagerelevant = 1 \
             WHERE id = ?5",
        )
        .bind(text)
        .bind(geo.map(|(lat, _)| lat))
        .bind(geo.map(|(_, lon)| lon))
        .bind(von_id)
        .bind(meldung_id)
        .execute(&mut *conn)
        .await?;
        if schon_in_der_lage || meldungsart == super::ART_LAGEMELDUNG {
            return Ok(LageUebergabe {
                lage_id: meldung_id,
                etb_id: None,
            });
        }
        let startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id)
            .await?
            .etb_startwert();
        let inhalt = format!("Meldung #{lfd_nr} in die Lage übernommen");
        let etb_id =
            crate::etb::system_audit_tx(&mut *conn, einsatz_id, von_id, startwert, &inhalt).await?;
        sqlx::query("UPDATE etb_eintrag SET meldung_id = ? WHERE id = ?")
            .bind(meldung_id)
            .bind(etb_id)
            .execute(&mut *conn)
            .await?;
        Ok(LageUebergabe {
            lage_id: meldung_id,
            etb_id: Some(etb_id),
        })
    })
}

/// Erteilt aus einer eingegangenen Meldung einen Auftrag (LFH-113) — in EINEM Commit:
/// legt den Auftrag inkl. seiner ETB-Anordnung an (`auftrag::repo::anlegen_tx`, Pattern B,
/// wie Chat→Auftrag LFH-101) und setzt den Rückverweis `meldung.auftrag_id`. First-write-wins:
/// ist die Meldung bereits mit einem nicht aufgehobenen Auftrag verknüpft → `Conflict` (vor der
/// Auftrags-Anlage geprüft, sodass kein verwaister Auftrag entsteht). Ein aufgehobener Auftrag
/// sperrt nicht (LLH-1177): der Rückverweis wechselt auf den neuen, der alte bleibt über seine
/// ETB-Anordnung und die Abgeschlossen-Ansicht nachvollziehbar. `daten` ist bereits vom Handler validiert
/// (Auftragstext + >=1 Empfänger, Slots/Zugehörigkeit geprüft). Liefert die neue `auftrag_id`.
pub async fn erteile_auftrag_tx(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    erteiler_id: i64,
    daten: crate::auftrag::repo::AuftragDaten<'_>,
) -> Result<i64, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einst =
        crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;
    let auftrag_id = crate::write_retry!(pool, |conn| {
        // Guard: schon mit einem geltenden Auftrag verknüpft? (Sperrt Doppel-Verknüpfung;
        // first-write-wins.) Ein aufgehobener Auftrag zählt nicht (LLH-1177). Meldung kennt kein
        // Soft-Delete (nur erledigt_at/status) → nur den verknüpften Auftrag prüfen.
        let has_geltenden_auftrag: Option<bool> = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM auftrag a \
                            WHERE a.id = m.auftrag_id AND a.aufgehoben_at IS NULL) \
             FROM meldung m WHERE m.id = ?",
        )
        .bind(meldung_id)
        .fetch_optional(&mut *conn)
        .await?;
        if has_geltenden_auftrag.ok_or(AppError::NotFound)? {
            return Err(AppError::Conflict(
                "Aus dieser Meldung wurde bereits ein Auftrag erteilt".into(),
            ));
        }

        let auftrag_id = crate::auftrag::repo::anlegen_tx(
            &mut *conn,
            einsatz_id,
            erteiler_id,
            einst.auftrag_startwert(),
            einst.etb_startwert(),
            crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst),
            &daten,
        )
        .await?;

        sqlx::query("UPDATE meldung SET auftrag_id = ? WHERE id = ?")
            .bind(auftrag_id)
            .bind(meldung_id)
            .execute(&mut *conn)
            .await?;

        Ok(auftrag_id)
    })?;
    Ok(auftrag_id)
}

/// SELECT-Projektion einer Lagemeldung: eine lagerelevante Meldung (LLH-1031, LLH-1027 D6) in
/// der Drahtform, die auch alte Lage-Stände tragen (`id = meldung_id`, `text` = eigener Lage-Text
/// oder Wortlaut, `erstellt_*` = Übernahme), dazu die Merkmale der Meldung und die
/// Kenntnisnahme. Reihenfolge der Spalten = Struct [`LageMeldungAnzeige`]. Ein Makro, damit die
/// Abfragen Literale bleiben (`concat!`).
macro_rules! lage_anzeige_select {
    () => {
        concat!(
            "SELECT m.id, m.einsatz_id, m.id AS meldung_id, \
                    COALESCE(m.lage_text, m.inhalt) AS text, m.lat, m.lon, \
                    COALESCE(m.lage_uebergeben_von_id, m.erfasst_von_id) AS erstellt_von_id, \
                    COALESCE(m.lage_uebergeben_at, m.eingang_at) AS erstellt_at, m.ereigniszeit, \
                    m.lfd_nr AS meldung_lfd_nr, m.absender AS meldung_absender, ",
            is_neu_sql!(),
            " AS is_neu, m.lage_gesehen_at AS gesehen_at, m.lage_gesehen_von_id AS gesehen_von_id, \
             g.anzeigename AS gesehen_von_name, \
             m.meldungsart, m.prioritaet, m.status AS meldung_status, m.richtung, \
             EXISTS (SELECT 1 FROM geraet_kopplung gk WHERE gk.benutzer_id = m.erfasst_von_id) \
               AS is_von_geraet, ",
            etb_berichtigung_sql!(),
            " FROM meldung m \
             LEFT JOIN benutzer g ON g.id = m.lage_gesehen_von_id"
        )
    };
}

/// Listet die Lagemeldungen eines Einsatzes: die lagerelevanten Meldungen (LLH-1031). Jüngste
/// Ereigniszeit zuerst, nicht die jüngste Übernahme (LLH-1039); bei gleicher Ereigniszeit die
/// zuletzt übernommene.
pub async fn liste_lage_meldungen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageMeldungAnzeige>, AppError> {
    sqlx::query_as::<_, LageMeldungAnzeige>(concat!(
        lage_anzeige_select!(),
        " WHERE m.einsatz_id = ? AND ",
        lage_sicht_sql!(),
        " ORDER BY m.ereigniszeit DESC, m.lage_uebergeben_at DESC, m.id DESC"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Eine Lagemeldung des Einsatzes, über die Kennung ihrer Meldung; `None`, wenn es sie dort nicht
/// gibt oder sie nicht lagerelevant ist.
pub async fn load_lage_meldung(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
) -> Result<Option<LageMeldungAnzeige>, AppError> {
    sqlx::query_as::<_, LageMeldungAnzeige>(concat!(
        lage_anzeige_select!(),
        " WHERE m.id = ? AND m.einsatz_id = ? AND ",
        lage_sicht_sql!()
    ))
    .bind(meldung_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

/// Kennzeichnet eine Lagemeldung als gesehen (LLH-1206, D2). Die erste Kenntnisnahme gewinnt:
/// eine schon gesehene bleibt mit Zeitpunkt und Person unverändert. `None`, wenn die Meldung nicht
/// zum Einsatz gehört oder nicht lagerelevant ist.
pub async fn mark_lage_gesehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<Option<LageMeldungAnzeige>, AppError> {
    sqlx::query(concat!(
        "UPDATE meldung AS m SET lage_gesehen_at = ?, lage_gesehen_von_id = ? \
         WHERE m.id = ? AND m.einsatz_id = ? AND ",
        lage_sicht_sql!(),
        " AND ",
        is_neu_sql!()
    ))
    .bind(jetzt)
    .bind(von_id)
    .bind(meldung_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    load_lage_meldung(pool, einsatz_id, meldung_id).await
}

/// Kennzeichnet die angezeigten neuen Lagemeldungen als gesehen (LLH-1031, Spec
/// `lagemeldung-kenntnisnahme`): genau die genannten Meldungen, sofern sie lagerelevant, neu und
/// aus diesem Einsatz sind. Eine, die während des Klicks in die Lage kommt, war nicht angezeigt
/// und bleibt neu — auch wenn sie älter ist. Liefert die Zahl der dabei gesehenen.
pub async fn mark_lage_angezeigte_gesehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_ids: &[i64],
    von_id: i64,
    jetzt: &str,
) -> Result<u64, AppError> {
    if meldung_ids.is_empty() {
        return Ok(0);
    }
    let ids = serde_json::to_string(meldung_ids)
        .map_err(|e| AppError::Internal(format!("meldung_ids: {e}")))?;
    let rows = sqlx::query(concat!(
        "UPDATE meldung AS m SET lage_gesehen_at = ?, lage_gesehen_von_id = ? \
         WHERE m.einsatz_id = ? AND m.id IN (SELECT value FROM json_each(?)) AND ",
        lage_sicht_sql!(),
        " AND ",
        is_neu_sql!()
    ))
    .bind(jetzt)
    .bind(von_id)
    .bind(einsatz_id)
    .bind(ids)
    .execute(pool)
    .await?;
    Ok(rows.rows_affected())
}

/// Modulzähler der Lagemeldungen (LLH-1206, D4): die neuen, mit denselben Prädikaten wie die
/// Liste. Eine Abfrage, ohne Texte.
pub async fn count_lage_neu(pool: &SqlitePool, einsatz_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(concat!(
        "SELECT COUNT(*) FROM meldung m WHERE m.einsatz_id = ? AND ",
        lage_sicht_sql!(),
        " AND ",
        is_neu_sql!()
    ))
    .bind(einsatz_id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Offene Sofortmeldungen für den Lagemonitor (Change `kcjecn9e-benachrichtigungskonzept`, D12):
/// Sofortmeldung ist, was den Sofortalarm auslöst (Meldungsart `sofortmeldung` oder Priorität
/// `sofort`, `routes/meldung.rs`), offen ist sie, solange sie unbestätigt und nicht erledigt ist.
/// Nur die Zahl, ohne Texte.
pub async fn count_sofort_offen(pool: &SqlitePool, einsatz_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(concat!(
        "SELECT COUNT(*) FROM meldung m",
        quittung_join_sql!(),
        " WHERE m.einsatz_id = ? \
           AND (m.meldungsart = 'sofortmeldung' OR m.prioritaet = 'sofort') AND ",
        ist_offen_sql!(),
        " AND NOT ",
        ist_bestaetigt_sql!()
    ))
    .bind(einsatz_id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Jüngste an eine Einheit gebundene Meldung je Einheit des Einsatzes (LFH-610).
/// Gleichstand in `ereigniszeit` entscheidet die höhere id (später erfasst).
/// `faellig_at` bleibt leer; der Handler setzt es aus der effektiven Frist.
pub async fn letzte_je_einheit(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<super::LetzteRueckmeldung>, AppError> {
    letzte_je_bezug(pool, einsatz_id, "einheit_id").await
}

/// Jüngste DIREKT an einen Abschnitt gebundene Meldung je Abschnitt (LFH-610).
pub async fn letzte_je_abschnitt(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<super::LetzteRueckmeldung>, AppError> {
    letzte_je_bezug(pool, einsatz_id, "abschnitt_id").await
}

/// `spalte` ist eine der zwei festen Konstanten oben, kein Nutzereingang.
async fn letzte_je_bezug(
    pool: &SqlitePool,
    einsatz_id: i64,
    spalte: &'static str,
) -> Result<Vec<super::LetzteRueckmeldung>, AppError> {
    debug_assert!(matches!(spalte, "einheit_id" | "abschnitt_id"));
    // Eine aufgelöste Einheit erwartet keine Rückmeldung mehr; ihre Meldungen bleiben als Spur
    // stehen (LLH-1079, Spec `kraefte-entlassung`).
    let aktiv = if spalte == "einheit_id" {
        "AND NOT EXISTS(SELECT 1 FROM einsatz_einheit e \
                        WHERE e.id = m.einheit_id AND e.aufgeloest_at IS NOT NULL)"
    } else {
        ""
    };
    Ok(
        sqlx::query_as::<_, super::LetzteRueckmeldung>(sqlx::AssertSqlSafe(format!(
            "SELECT m.{spalte} AS bezug_id, m.id AS meldung_id, m.lfd_nr, m.ereigniszeit, \
                    m.inhalt, m.meldeweg \
             FROM meldung m \
             WHERE m.einsatz_id = ? AND m.{spalte} IS NOT NULL {aktiv} \
               AND m.id = (SELECT m2.id FROM meldung m2 \
                           WHERE m2.{spalte} = m.{spalte} \
                           ORDER BY m2.ereigniszeit DESC, m2.id DESC LIMIT 1) \
             ORDER BY m.{spalte}"
        )))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::Richtung;
    use crate::meldung::{MeldungStatus, ART_SOFORTMELDUNG, PRIO_NORMAL};

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn daten<'a>(inhalt: &'a str, ereignis: &'a str, eingang: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            absender: "Florian Nord 1",
            empfaenger: Some("ELW 1"),
            empfaenger_funktion: None,
            meldeweg: "funk",
            inhalt,
            meldungsart: ART_SOFORTMELDUNG,
            prioritaet: PRIO_NORMAL,
            richtung: "intern",
            ereigniszeit: ereignis,
            eingang_at: eingang,
            bestaetigung_pflicht: false,
            bestaetigung_frist_at: None,
            einheit_id: None,
            abschnitt_id: None,
            geo: None,
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_meldung_mit_default_status_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten(
                "Deich instabil",
                "2026-06-12 09:00:00",
                "2026-06-12 09:05:00",
            ),
        )
        .await
        .unwrap();
        assert_eq!(m.lfd_nr, 1);
        assert_eq!(m.absender, "Florian Nord 1");
        assert_eq!(m.empfaenger.as_deref(), Some("ELW 1"));
        assert_eq!(m.status, MeldungStatus::Neu);
        assert!(m.ist_offen);
        assert!(!m.lagerelevant);
        assert_eq!(m.ereigniszeit, "2026-06-12 09:00:00");
        assert_eq!(m.eingang_at, "2026-06-12 09:05:00");
        assert!(m.etb_meldung_id.is_some(), "ETB-Meldung wird erzeugt");
        assert!(liste_lage_meldungen(&pool, e).await.unwrap().is_empty());
    }

    /// LLH-1382, design.md D2: eine Berichtigung aus einem fremden Einsatz legte sonst id und
    /// Nummer eines anderen Einsatzes offen; die Route verhindert sie, das Fragment auch.
    #[tokio::test]
    async fn berichtigung_aus_fremdem_einsatz_erscheint_nicht_an_der_meldung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        crate::etb::repo::anlegen(
            &pool,
            fremd,
            b,
            crate::etb::repo::EintragDaten {
                typ: "berichtigung",
                inhalt: "Fremd",
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: m.etb_meldung_id,
            },
        )
        .await
        .unwrap();

        let geladen = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(geladen.etb_berichtigung_id, None);
        assert_eq!(geladen.etb_berichtigung_lfd_nr, None);
        assert!(
            !is_etb_eintrag_einer_meldung(&pool, fremd, m.etb_meldung_id.unwrap())
                .await
                .unwrap()
        );
        assert!(
            is_etb_eintrag_einer_meldung(&pool, e, m.etb_meldung_id.unwrap())
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_meldung_mit_backlink_und_feldmapping() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let etb_id = m.etb_meldung_id.unwrap();
        let (typ, von, an, weg, backlink): (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            i64,
        ) = sqlx::query_as(
            "SELECT typ, von, an, meldeweg, meldung_id FROM etb_eintrag WHERE id = ?",
        )
        .bind(etb_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(von.as_deref(), Some("Florian Nord 1"));
        assert_eq!(an.as_deref(), Some("ELW 1"));
        assert_eq!(weg.as_deref(), Some("funk"));
        assert_eq!(backlink, m.id);
    }

    #[tokio::test]
    async fn lfd_nr_zaehlt_pro_einsatz_hoch() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m1 = anlegen(
            &pool,
            e,
            b,
            daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let m2 = anlegen(
            &pool,
            e,
            b,
            daten("B", "2026-06-12 09:01:00", "2026-06-12 09:01:00"),
        )
        .await
        .unwrap();
        assert_eq!(m1.lfd_nr, 1);
        assert_eq!(m2.lfd_nr, 2);
    }

    #[tokio::test]
    async fn client_id_replay_erzeugt_weder_meldungs_noch_etb_dublette() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let (m1, neu1) = anlegen_idempotent(
            &pool,
            e,
            b,
            Some("offline-meldung-1"),
            daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let (m2, neu2) = anlegen_idempotent(
            &pool,
            e,
            b,
            Some("offline-meldung-1"),
            daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();

        assert!(neu1);
        assert!(!neu2);
        assert_eq!((m2.id, m2.lfd_nr), (m1.id, m1.lfd_nr));
        let meldungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        let etb: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND meldung_id = ?",
        )
        .bind(e)
        .bind(m1.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(meldungen, 1);
        assert_eq!(etb, 1);
    }

    #[tokio::test]
    async fn live_marker_publiziert_null_genau_einmal_und_markiert_danach() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Alarm", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let aufrufe = Arc::new(AtomicUsize::new(0));

        let erster = aufrufe.clone();
        assert!(
            publiziere_live_ausstehend(&pool, m.id, "2026-06-12 09:00:01", move || {
                erster.fetch_add(1, Ordering::SeqCst);
            },)
            .await
            .unwrap()
        );
        let marker: Option<String> =
            sqlx::query_scalar("SELECT live_published_at FROM meldung WHERE id = ?")
                .bind(m.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(marker.as_deref(), Some("2026-06-12 09:00:01"));

        let replay = aufrufe.clone();
        assert!(
            !publiziere_live_ausstehend(&pool, m.id, "2026-06-12 09:00:02", move || {
                replay.fetch_add(1, Ordering::SeqCst);
            },)
            .await
            .unwrap()
        );
        assert_eq!(aufrufe.load(Ordering::SeqCst), 1, "Replay ohne Dublette");
    }

    #[tokio::test]
    async fn meldung_startwert_wirkt_und_etb_hat_eigenen_startwert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Meldungs-Startwert 50, ETB-Startwert 300 — getrennte Nummernkreise.
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                meldung_nummer_start: Some(50),
                etb_nummer_start: Some(300),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let m = anlegen(
            &pool,
            e,
            b,
            daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert_eq!(
            m.lfd_nr, 50,
            "Meldungs-lfd_nr startet beim Meldungs-Startwert"
        );
        // Die im selben Commit erzeugte ETB-Meldung nutzt ihren EIGENEN Startwert (300).
        let etb_lfd: i64 = sqlx::query_scalar("SELECT lfd_nr FROM etb_eintrag WHERE id = ?")
            .bind(m.etb_meldung_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            etb_lfd, 300,
            "ETB-Meldung nutzt den ETB-Startwert, nicht den Meldungs-Startwert"
        );
    }

    #[tokio::test]
    async fn auto_etb_aus_unterdrueckt_etb_meldung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let m = anlegen(
            &pool,
            e,
            b,
            daten("ohne ETB", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(
            m.etb_meldung_id.is_none(),
            "Auto-ETB aus → keine ETB-Meldung"
        );
        let etb_anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(etb_anzahl, 0);
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(
            laden(&pool, 999, "2026-06-12 10:00:00").await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn liste_liefert_meldungen_sortiert_nach_prio() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(
            &pool,
            e,
            b,
            daten("normal", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let d = daten("sofort", "2026-06-12 08:00:00", "2026-06-12 08:00:00");
        let sofort = MeldungDaten {
            prioritaet: crate::meldung::PRIO_SOFORT,
            ..d
        };
        anlegen(&pool, e, b, sofort).await.unwrap();
        let liste = liste(&pool, e, &MeldungFilter::default(), "2026-06-12 10:00:00")
            .await
            .unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(
            liste[0].inhalt, "sofort",
            "sofort vor normal trotz älterer Ereigniszeit"
        );
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(
            &pool,
            e,
            b,
            daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let liste_neu = liste(
            &pool,
            e,
            &MeldungFilter {
                status: Some("neu"),
                ..Default::default()
            },
            "2026-06-12 10:00:00",
        )
        .await
        .unwrap();
        assert_eq!(liste_neu.len(), 1);
        let liste_erledigt = liste(
            &pool,
            e,
            &MeldungFilter {
                status: Some("erledigt"),
                ..Default::default()
            },
            "2026-06-12 10:00:00",
        )
        .await
        .unwrap();
        assert!(liste_erledigt.is_empty());
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(gehoert_zu_einsatz(&pool, m.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn setze_status_fuehrt_nur_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_IN_BEARBEITUNG,
            "2026-06-12 09:30:00",
        )
        .await
        .unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, MeldungStatus::InBearbeitung);
        // ist_offen = status != 'erledigt' → in_bearbeitung bleibt offen.
        assert!(nach.ist_offen);
        // Noch nicht erledigt → kein Erledigt-Stempel.
        assert!(nach.erledigt_at.is_none());
    }

    #[tokio::test]
    async fn weise_bearbeiter_setzt_und_gibt_frei() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.bearbeiter_id, Some(b));
        assert_eq!(nach.bearbeiter_name.as_deref(), Some("Leit"));
        // Freigeben.
        weise_bearbeiter(&pool, m.id, None).await.unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00")
                .await
                .unwrap()
                .bearbeiter_id,
            None
        );
    }

    #[tokio::test]
    async fn statuswechsel_loescht_die_zuweisung_nicht() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        // Reiner Statuswechsel darf den Bearbeiter NICHT clobbern (Regression #2/#3).
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_ERLEDIGT,
            "2026-06-12 09:30:00",
        )
        .await
        .unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, MeldungStatus::Erledigt);
        assert_eq!(
            nach.bearbeiter_id,
            Some(b),
            "Zuweisung bleibt über Statuswechsel erhalten"
        );
    }

    #[tokio::test]
    async fn erledigt_ist_nicht_mehr_offen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_ERLEDIGT,
            "2026-06-12 09:30:00",
        )
        .await
        .unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, MeldungStatus::Erledigt);
        assert!(!nach.ist_offen);
        // Übergang nach 'erledigt' setzt den Erledigt-Stempel (LFH-113).
        assert_eq!(nach.erledigt_at.as_deref(), Some("2026-06-12 09:30:00"));
    }

    #[tokio::test]
    async fn erledigt_at_ist_first_write_wins() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        // Erstes Erledigen setzt den Stempel.
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_ERLEDIGT,
            "2026-06-12 09:30:00",
        )
        .await
        .unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00")
                .await
                .unwrap()
                .erledigt_at
                .as_deref(),
            Some("2026-06-12 09:30:00"),
        );
        // Zurücksetzen (z. B. wieder in Bearbeitung) darf den Stempel NICHT löschen.
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_IN_BEARBEITUNG,
            "2026-06-12 09:40:00",
        )
        .await
        .unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00")
                .await
                .unwrap()
                .erledigt_at
                .as_deref(),
            Some("2026-06-12 09:30:00"),
            "Erledigt-Stempel bleibt über ein Zurücksetzen erhalten",
        );
        // Erneutes Erledigen darf den ersten Stempel NICHT überschreiben (first-write-wins).
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_ERLEDIGT,
            "2026-06-12 09:50:00",
        )
        .await
        .unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00")
                .await
                .unwrap()
                .erledigt_at
                .as_deref(),
            Some("2026-06-12 09:30:00"),
            "erneutes Erledigen behält den ersten Stempel",
        );
    }

    /// Daten einer Lagemeldung (Art `lagemeldung`, ohne Pflicht).
    fn lagemeldung<'a>(inhalt: &'a str, ereignis: &'a str, eingang: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            meldungsart: crate::meldung::ART_LAGEMELDUNG,
            ..daten(inhalt, ereignis, eingang)
        }
    }

    /// Spec `meldungseingang`, „Art Lagemeldung ist immer lagerelevant“ (LLH-1031): ab Anlage in
    /// der Lage, übernommen am Eingang durch den Erfasser, neu für die Kenntnisnahme; der Wortlaut
    /// ist der Lage-Text, die Kennung die der Meldung.
    #[tokio::test]
    async fn lagemeldung_steht_ab_anlage_in_der_lage() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            MeldungDaten {
                geo: Some((51.4, 10.4)),
                ..lagemeldung("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:02:00")
            },
        )
        .await
        .unwrap();
        assert!(m.lagerelevant);
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(liste.len(), 1);
        let l = &liste[0];
        assert_eq!((l.id, l.meldung_id), (m.id, m.id));
        assert_eq!(l.text, "Lage ruhig");
        assert_eq!((l.lat, l.lon), (Some(51.4), Some(10.4)));
        assert_eq!(l.erstellt_at, "2026-06-12 09:02:00", "Übernahme = Eingang");
        assert_eq!(l.erstellt_von_id, b);
        assert_eq!(l.ereigniszeit, "2026-06-12 09:00:00");
        assert!(l.is_neu);
        assert_eq!(l.meldungsart, crate::meldung::Meldungsart::Lagemeldung);
        assert_eq!(l.meldung_status, MeldungStatus::Neu);
        assert!(!l.is_von_geraet);
        assert_eq!(count_lage_neu(&pool, e).await.unwrap(), 1);
        let lage_text: Option<String> =
            sqlx::query_scalar("SELECT lage_text FROM meldung WHERE id = ?")
                .bind(m.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(lage_text, None, "kein Doppel des Wortlauts");
    }

    /// LLH-1027 D3: auch die Lagemeldung an die übergeordnete Stelle steht in der Lage, mit ihrer
    /// Richtung; eine andere Art ohne Übernahme fehlt.
    #[tokio::test]
    async fn lagemeldung_nach_aussen_steht_in_der_lage_andere_art_nicht() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let extern_m = anlegen(
            &pool,
            e,
            b,
            MeldungDaten {
                richtung: crate::meldung::RICHTUNG_EXTERN,
                prioritaet: crate::meldung::PRIO_DRINGEND,
                ..lagemeldung(
                    "Lage an Leitstelle",
                    "2026-06-12 09:00:00",
                    "2026-06-12 09:00:00",
                )
            },
        )
        .await
        .unwrap();
        anlegen(
            &pool,
            e,
            b,
            MeldungDaten {
                meldungsart: crate::meldung::ART_RUECKMELDUNG,
                ..daten(
                    "Einsatzbereit",
                    "2026-06-12 09:01:00",
                    "2026-06-12 09:01:00",
                )
            },
        )
        .await
        .unwrap();
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].id, extern_m.id);
        assert_eq!(liste[0].richtung, crate::kommunikation::Richtung::Extern);
        assert_eq!(
            liste[0].prioritaet,
            crate::kommunikation::Prioritaet::Dringend
        );
    }

    /// Spec `meldungseingang`, „Eine Lagemeldung protokolliert als Lage“: Auto-ETB Typ `lage`
    /// (analog `anlegen_erzeugt_etb_meldung_mit_backlink_und_feldmapping`).
    #[tokio::test]
    async fn anlegen_einer_lagemeldung_erzeugt_etb_lage_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            lagemeldung("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let (typ, inhalt, von, backlink): (String, String, Option<String>, i64) =
            sqlx::query_as("SELECT typ, inhalt, von, meldung_id FROM etb_eintrag WHERE id = ?")
                .bind(m.etb_meldung_id.expect("Auto-ETB an"))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(typ, "lage");
        assert_eq!(inhalt, "Lage ruhig");
        assert_eq!(von.as_deref(), Some("Florian Nord 1"));
        assert_eq!(backlink, m.id);
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 1, "genau ein Eintrag");
    }

    #[tokio::test]
    async fn als_lagerelevant_setzt_flag_und_uebernimmt_mit_herkunft() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten(
                "Brücke gesperrt",
                "2026-06-12 09:00:00",
                "2026-06-12 09:00:00",
            ),
        )
        .await
        .unwrap();
        let uebergabe = als_lagerelevant(&pool, e, m.id, b, "Brücke gesperrt", None)
            .await
            .unwrap();
        assert_eq!(uebergabe.lage_id, m.id);
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert!(nach.lagerelevant);
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].id, m.id, "Kennung ist die Meldung");
        assert_eq!(liste[0].meldung_lfd_nr, m.lfd_nr);
        assert_eq!(liste[0].meldung_absender, "Florian Nord 1");
        assert_eq!(liste[0].text, "Brücke gesperrt");
    }

    /// LLH-1104 D8: Die erste Übergabe in die Lage steht als Systemeintrag mit Verweis auf die
    /// Meldung im ETB; eine erneute Übergabe schreibt nichts mehr.
    #[tokio::test]
    async fn uebergabe_in_die_lage_steht_einmal_im_etb() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten(
                "Brücke gesperrt",
                "2026-06-12 09:00:00",
                "2026-06-12 09:00:00",
            ),
        )
        .await
        .unwrap();
        let erste = als_lagerelevant(&pool, e, m.id, b, "Brücke gesperrt", None)
            .await
            .unwrap();
        let etb_id = erste.etb_id.expect("Systemeintrag der Übergabe");
        let (typ, inhalt, verweis): (String, String, Option<i64>) =
            sqlx::query_as("SELECT typ, inhalt, meldung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(typ, "system");
        assert_eq!(
            inhalt,
            format!("Meldung #{} in die Lage übernommen", m.lfd_nr)
        );
        assert_eq!(verweis, Some(m.id));

        let zweite = als_lagerelevant(&pool, e, m.id, b, "Brücke wieder frei", None)
            .await
            .unwrap();
        assert_eq!(zweite.etb_id, None, "erneute Übergabe schreibt nicht");
        let system: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system'",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(system, 1);
    }

    /// LLH-1104 D8 (Schnittkante LLH-1027 D3): eine Lagemeldung hat ihren Lage-Eintrag schon über
    /// das Auto-ETB; ihre Übergabe schreibt keinen zweiten.
    #[tokio::test]
    async fn uebergabe_einer_lagemeldung_schreibt_kein_etb() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            MeldungDaten {
                meldungsart: crate::meldung::ART_LAGEMELDUNG,
                ..daten("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00")
            },
        )
        .await
        .unwrap();
        let ergebnis = als_lagerelevant(&pool, e, m.id, b, "Lage ruhig", None)
            .await
            .unwrap();
        assert_eq!(ergebnis.etb_id, None);
    }

    /// Spec `meldungseingang`, „Rückmeldung mit Lageinhalt“: eigener Lage-Text und Ort, der
    /// Wortlaut bleibt; die Verortung ist danach nicht mehr änderbar.
    #[tokio::test]
    async fn uebernahme_mit_lage_text_und_ort_laesst_den_wortlaut() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            MeldungDaten {
                meldungsart: crate::meldung::ART_RUECKMELDUNG,
                ..daten(
                    "Wir sind vor Ort",
                    "2026-06-12 09:00:00",
                    "2026-06-12 09:00:00",
                )
            },
        )
        .await
        .unwrap();
        als_lagerelevant(
            &pool,
            e,
            m.id,
            b,
            "Brand unter Kontrolle",
            Some((51.4, 10.4)),
        )
        .await
        .unwrap();
        als_lagerelevant(
            &pool,
            e,
            m.id,
            b,
            "Brand unter Kontrolle",
            Some((52.0, 11.0)),
        )
        .await
        .unwrap();
        let l = &liste_lage_meldungen(&pool, e).await.unwrap()[0];
        assert_eq!(l.text, "Brand unter Kontrolle");
        assert_eq!((l.lat, l.lon), (Some(51.4), Some(10.4)), "Verortung bleibt");
        assert_eq!(l.meldungsart, crate::meldung::Meldungsart::Rueckmeldung);
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.inhalt, "Wir sind vor Ort", "Wortlaut unverändert");
    }

    #[tokio::test]
    async fn als_lagerelevant_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        als_lagerelevant(&pool, e, m.id, b, "erste", None)
            .await
            .unwrap();
        let erst = liste_lage_meldungen(&pool, e).await.unwrap();
        let zweite = als_lagerelevant(&pool, e, m.id, b, "zweite", None)
            .await
            .unwrap();
        assert_eq!(zweite.lage_id, m.id, "Kennung ist die Meldung");
        let zweit = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(zweit.len(), 1, "eine Lagemeldung je Meldung");
        assert_eq!(
            zweit[0].erstellt_at, erst[0].erstellt_at,
            "Übernahme bleibt"
        );
        assert_eq!(zweit[0].text, "zweite");
    }

    #[tokio::test]
    async fn als_lagerelevant_im_fremden_einsatz_ist_not_found() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(matches!(
            als_lagerelevant(&pool, e + 99, m.id, b, "X", None).await,
            Err(AppError::NotFound)
        ));
        assert!(liste_lage_meldungen(&pool, e).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn liste_ordnet_nach_ereigniszeit_der_meldung_nicht_nach_uebergabe() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let spaet = anlegen(
            &pool,
            e,
            b,
            daten("Pegel steigt", "2026-06-12 14:41:00", "2026-06-12 14:42:00"),
        )
        .await
        .unwrap();
        let frueh = anlegen(
            &pool,
            e,
            b,
            daten(
                "Brücke gesperrt",
                "2026-06-12 13:14:00",
                "2026-06-12 13:15:00",
            ),
        )
        .await
        .unwrap();
        // Die frühere Meldung wird ZULETZT übergeben: jüngere Übergabe.
        for (mid, text, uebergabe) in [
            (spaet.id, "Pegel steigt", "2026-06-12 14:50:00"),
            (frueh.id, "Brücke gesperrt", "2026-06-12 15:05:00"),
        ] {
            als_lagerelevant(&pool, e, mid, b, text, None)
                .await
                .unwrap();
            sqlx::query("UPDATE meldung SET lage_uebergeben_at = ? WHERE id = ?")
                .bind(uebergabe)
                .bind(mid)
                .execute(&pool)
                .await
                .unwrap();
        }
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        let folge: Vec<_> = liste
            .iter()
            .map(|l| {
                (
                    l.text.as_str(),
                    l.ereigniszeit.as_str(),
                    l.erstellt_at.as_str(),
                )
            })
            .collect();
        assert_eq!(
            folge,
            [
                ("Pegel steigt", "2026-06-12 14:41:00", "2026-06-12 14:50:00"),
                (
                    "Brücke gesperrt",
                    "2026-06-12 13:14:00",
                    "2026-06-12 15:05:00"
                ),
            ],
            "jüngste Ereigniszeit zuerst; die Übergabezeit bleibt an der Lagemeldung"
        );
        // Einzeln geladen trägt sie dieselbe Ereigniszeit.
        let einzeln = load_lage_meldung(&pool, e, frueh.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(einzeln.ereigniszeit, "2026-06-12 13:14:00");
    }

    #[tokio::test]
    async fn liste_gleiche_ereigniszeit_zuletzt_uebergebene_zuerst() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let erste = uebergeben(&pool, e, b, "erste").await;
        let zweite = uebergeben(&pool, e, b, "zweite").await;
        sqlx::query("UPDATE meldung SET lage_uebergeben_at = '2026-06-12 09:00:00' WHERE id = ?")
            .bind(erste)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE meldung SET lage_uebergeben_at = '2026-06-12 09:05:00' WHERE id = ?")
            .bind(zweite)
            .execute(&pool)
            .await
            .unwrap();
        let ids: Vec<_> = liste_lage_meldungen(&pool, e)
            .await
            .unwrap()
            .into_iter()
            .map(|l| l.id)
            .collect();
        assert_eq!(ids, [zweite, erste]);
    }

    /// Legt eine Meldung an und übergibt sie mit `text` an die Lage; liefert die Kennung der
    /// Meldung (= der Lagemeldung, LLH-1031).
    async fn uebergeben(pool: &SqlitePool, e: i64, b: i64, text: &str) -> i64 {
        let m = anlegen(
            pool,
            e,
            b,
            daten(text, "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        als_lagerelevant(pool, e, m.id, b, text, None)
            .await
            .unwrap();
        m.id
    }

    async fn zweiter_benutzer(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Zweit','zweit','h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn uebergebene_lagemeldung_ist_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        uebergeben(&pool, e, b, "Brücke gesperrt").await;
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert!(liste[0].is_neu);
        assert!(liste[0].gesehen_at.is_none());
        assert!(liste[0].gesehen_von_id.is_none());
        assert_eq!(count_lage_neu(&pool, e).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn gesehen_setzt_zeit_und_person_und_die_erste_kenntnisnahme_gewinnt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let z = zweiter_benutzer(&pool).await;
        let lid = uebergeben(&pool, e, b, "Brücke gesperrt").await;

        let erst = mark_lage_gesehen(&pool, e, lid, b, "2026-06-12 10:00:00")
            .await
            .unwrap()
            .expect("gehört zum Einsatz");
        assert!(!erst.is_neu);
        assert_eq!(erst.gesehen_at.as_deref(), Some("2026-06-12 10:00:00"));
        assert_eq!(erst.gesehen_von_id, Some(b));
        assert_eq!(erst.gesehen_von_name.as_deref(), Some("Leit"));

        let zweit = mark_lage_gesehen(&pool, e, lid, z, "2026-06-12 11:00:00")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(zweit.gesehen_at.as_deref(), Some("2026-06-12 10:00:00"));
        assert_eq!(zweit.gesehen_von_id, Some(b));
        assert_eq!(count_lage_neu(&pool, e).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn gesehen_im_fremden_einsatz_findet_nichts() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let lid = uebergeben(&pool, e, b, "Brücke gesperrt").await;
        assert!(
            mark_lage_gesehen(&pool, fremd, lid, b, "2026-06-12 10:00:00")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(count_lage_neu(&pool, e).await.unwrap(), 1);
    }

    /// Spec `lagemeldung-kenntnisnahme`, „Nicht in der Lage“: eine Meldung ohne Lagerelevanz
    /// lässt sich nicht als gesehen kennzeichnen.
    #[tokio::test]
    async fn gesehen_einer_meldung_ausserhalb_der_lage_findet_nichts() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(mark_lage_gesehen(&pool, e, m.id, b, "2026-06-12 10:00:00")
            .await
            .unwrap()
            .is_none());
        let gesehen: Option<String> =
            sqlx::query_scalar("SELECT lage_gesehen_at FROM meldung WHERE id = ?")
                .bind(m.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(gesehen, None);
    }

    /// Spec `lagemeldung-kenntnisnahme`, „Alle bis zur angezeigten“: nur die angezeigten; eine
    /// währenddessen übernommene, ältere Meldung bleibt neu, fremde und nicht lagerelevante
    /// Kennungen bleiben unberührt.
    #[tokio::test]
    async fn angezeigte_gesehen_laesst_nicht_angezeigte_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let alt = anlegen(
            &pool,
            e,
            b,
            daten("alt", "2026-06-12 08:00:00", "2026-06-12 08:00:00"),
        )
        .await
        .unwrap();
        let a = uebergeben(&pool, e, b, "eins").await;
        let c = uebergeben(&pool, e, b, "zwei").await;
        let d = uebergeben(&pool, e, b, "drei").await;
        mark_lage_gesehen(&pool, e, a, b, "2026-06-12 09:30:00")
            .await
            .unwrap();
        // Während des Klicks übernommen: kleinere Kennung, aber nicht angezeigt.
        als_lagerelevant(&pool, e, alt.id, b, "alt", None)
            .await
            .unwrap();

        let anzahl =
            mark_lage_angezeigte_gesehen(&pool, e, &[a, c, d, 99_999], b, "2026-06-12 10:00:00")
                .await
                .unwrap();
        assert_eq!(anzahl, 2, "nur die noch neuen der angezeigten");

        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        let von = |id: i64| liste.iter().find(|l| l.id == id).unwrap();
        assert_eq!(von(a).gesehen_at.as_deref(), Some("2026-06-12 09:30:00"));
        assert!(!von(c).is_neu);
        assert!(!von(d).is_neu);
        assert!(von(alt.id).is_neu, "nicht angezeigt bleibt neu");
        assert_eq!(count_lage_neu(&pool, e).await.unwrap(), 1);
        assert_eq!(
            mark_lage_angezeigte_gesehen(&pool, e, &[], b, "2026-06-12 10:00:00")
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn erneute_uebergabe_mit_anderem_text_macht_wieder_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        als_lagerelevant(&pool, e, m.id, b, "erste", None)
            .await
            .unwrap();
        mark_lage_gesehen(&pool, e, m.id, b, "2026-06-12 10:00:00")
            .await
            .unwrap();

        als_lagerelevant(&pool, e, m.id, b, "erste", None)
            .await
            .unwrap();
        let gleich = &liste_lage_meldungen(&pool, e).await.unwrap()[0];
        assert!(!gleich.is_neu, "gleicher Text ändert den Stand nicht");
        assert_eq!(gleich.gesehen_at.as_deref(), Some("2026-06-12 10:00:00"));

        als_lagerelevant(&pool, e, m.id, b, "zweite", None)
            .await
            .unwrap();
        let neu = &liste_lage_meldungen(&pool, e).await.unwrap()[0];
        assert!(neu.is_neu, "geänderter Text ist wieder neu");
        assert!(neu.gesehen_at.is_none());
        assert!(neu.gesehen_von_id.is_none());
    }

    /// Eine gesehene Lagemeldung, deren Lage-Text über die Übernahme gleich bleibt (Wortlaut als
    /// Vorgabe), bleibt gesehen (Spec R3, Art Lagemeldung).
    #[tokio::test]
    async fn uebernahme_einer_lagemeldung_mit_wortlaut_bleibt_gesehen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            lagemeldung("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        mark_lage_gesehen(&pool, e, m.id, b, "2026-06-12 10:00:00")
            .await
            .unwrap();
        als_lagerelevant(&pool, e, m.id, b, "Lage ruhig", Some((51.4, 10.4)))
            .await
            .unwrap();
        let l = &liste_lage_meldungen(&pool, e).await.unwrap()[0];
        assert!(!l.is_neu);
        assert_eq!(
            l.erstellt_at, "2026-06-12 09:00:00",
            "Übernahme bleibt der Eingang"
        );
        assert_eq!(l.lat, Some(51.4), "fehlende Verortung kommt dazu");
    }

    /// Hilfsdaten für eine bestätigungspflichtige Sofortmeldung mit absoluter Frist.
    fn daten_pflicht<'a>(inhalt: &'a str, eingang: &'a str, frist: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            bestaetigung_pflicht: true,
            bestaetigung_frist_at: Some(frist),
            einheit_id: None,
            abschnitt_id: None,
            geo: None,
            ..daten(inhalt, eingang, eingang)
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_bestaetigungspflicht_und_frist() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        assert!(m.bestaetigung_pflicht);
        assert_eq!(
            m.bestaetigung_frist_at.as_deref(),
            Some("2026-06-12 09:05:00")
        );
        assert!(!m.eskaliert);
        assert!(!m.ist_bestaetigt, "frisch angelegt → unbestätigt");
        assert!(m.bestaetigt_at.is_none());
    }

    #[tokio::test]
    async fn ist_ueberfaellig_wird_aus_jetzt_abgeleitet() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        // Vor Frist: nicht überfällig.
        let vor = laden(&pool, m.id, "2026-06-12 09:04:00").await.unwrap();
        assert!(!vor.ist_ueberfaellig);
        // Nach Frist + unbestätigt: überfällig.
        let nach = laden(&pool, m.id, "2026-06-12 09:06:00").await.unwrap();
        assert!(nach.ist_ueberfaellig);
    }

    #[tokio::test]
    async fn bestaetige_setzt_quittung_ohne_status_clobber() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        // Bearbeiter + Status gesetzt — dürfen über die Bestätigung NICHT verloren gehen.
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        setze_status(
            &pool,
            m.id,
            crate::meldung::STATUS_IN_BEARBEITUNG,
            "2026-06-12 09:05:30",
        )
        .await
        .unwrap();

        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00")
            .await
            .unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 09:07:00").await.unwrap();
        assert!(nach.ist_bestaetigt);
        assert_eq!(nach.bestaetigt_at.as_deref(), Some("2026-06-12 09:06:00"));
        assert_eq!(nach.bestaetigt_von_id, Some(b));
        assert_eq!(nach.bestaetigt_von_name.as_deref(), Some("Leit"));
        assert!(!nach.ist_ueberfaellig, "bestätigt → nicht mehr überfällig");
        assert_eq!(
            nach.status,
            MeldungStatus::InBearbeitung,
            "Triage-Status bleibt unberührt"
        );
        assert_eq!(nach.bearbeiter_id, Some(b), "Zuweisung bleibt erhalten");
    }

    /// Wer den Empfang bestätigt, hat die Meldung gesehen (LLH-1052, Spec `benachrichtigungen`,
    /// „Bestätigen sichtet die Sofortmeldung“): aus `neu` wird `gesichtet`, im selben Commit.
    #[tokio::test]
    async fn bestaetige_hebt_neu_auf_gesichtet() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        assert_eq!(m.status, MeldungStatus::Neu);

        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:01:00")
            .await
            .unwrap());
        let nach = laden(&pool, m.id, "2026-06-12 09:02:00").await.unwrap();
        assert!(nach.ist_bestaetigt);
        assert_eq!(nach.status, MeldungStatus::Gesichtet);
        assert_eq!(nach.erledigt_at, None, "Sichten ist kein Erledigen");
    }

    /// Eine schon gesichtete oder erledigte Meldung behält beim Bestätigen ihren Status.
    #[tokio::test]
    async fn bestaetige_laesst_spaetere_status_stehen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        for status in [
            crate::meldung::STATUS_GESICHTET,
            crate::meldung::STATUS_ERLEDIGT,
        ] {
            let m = anlegen(
                &pool,
                e,
                b,
                daten_pflicht(status, "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
            )
            .await
            .unwrap();
            setze_status(&pool, m.id, status, "2026-06-12 09:00:30")
                .await
                .unwrap();
            assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:01:00")
                .await
                .unwrap());
            let nach = laden(&pool, m.id, "2026-06-12 09:02:00").await.unwrap();
            assert_eq!(nach.status.as_str(), status);
        }
    }

    #[tokio::test]
    async fn bestaetige_schliesst_offene_auto_erinnerung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        crate::erinnerung::repo::anlegen_aus_frist(
            &pool,
            e,
            b,
            crate::kommunikation::OBJEKT_MELDUNG,
            m.id,
            "Nachfass",
            "2026-06-12 09:05:00",
            "2026-06-12 09:00:00",
        )
        .await
        .unwrap();

        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00")
            .await
            .unwrap();
        // Keine offene Auto-Erinnerung für den Bezug mehr.
        let offen: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM erinnerung WHERE quelle='auto_frist' AND status='offen' AND bezug_typ=? AND bezug_id=?",
        ).bind(crate::kommunikation::OBJEKT_MELDUNG).bind(m.id).fetch_optional(&pool).await.unwrap();
        assert!(
            offen.is_none(),
            "Bestätigung schließt die Nachfass-Erinnerung"
        );
    }

    #[tokio::test]
    async fn bestaetigen_rollt_quittung_reminder_und_eskalation_gemeinsam_zurueck() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        crate::erinnerung::repo::stelle_meldung_auto_frist_sicher(&pool, m.id, "Nachfass")
            .await
            .unwrap();
        sqlx::query("UPDATE meldung SET eskaliert = 1 WHERE id = ?")
            .bind(m.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER test_bestaetigen_fehler \
             BEFORE UPDATE OF eskaliert ON meldung \
             BEGIN SELECT RAISE(ABORT, 'simulierter Folgefehler'); END",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00")
            .await
            .is_err());
        let quittungen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM kommunikation_status \
             WHERE objekt_typ = 'meldung' AND objekt_id = ? AND quittiert_at IS NOT NULL",
        )
        .bind(m.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let reminder_status: String = sqlx::query_scalar(
            "SELECT status FROM erinnerung \
             WHERE quelle = 'auto_frist' AND bezug_typ = 'meldung' AND bezug_id = ?",
        )
        .bind(m.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let eskaliert: bool = sqlx::query_scalar("SELECT eskaliert FROM meldung WHERE id = ?")
            .bind(m.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(quittungen, 0, "Quittung muss zurueckgerollt sein");
        assert_eq!(reminder_status, "offen", "Reminder bleibt gemeinsam offen");
        assert!(eskaliert, "Eskalationsflag bleibt gemeinsam gesetzt");

        sqlx::query("DROP TRIGGER test_bestaetigen_fehler")
            .execute(&pool)
            .await
            .unwrap();
        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:07:00")
            .await
            .unwrap());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn reminder_ensure_gegen_bestaetigen_hinterlaesst_keinen_offenen_reminder() {
        use std::sync::Arc;
        use tokio::sync::Barrier;

        let (_dir, pool) = crate::db::test_pool_datei().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        let start = Arc::new(Barrier::new(3));

        let ensure_pool = pool.clone();
        let ensure_start = start.clone();
        let meldung_id = m.id;
        let ensure = tokio::spawn(async move {
            ensure_start.wait().await;
            crate::erinnerung::repo::stelle_meldung_auto_frist_sicher(
                &ensure_pool,
                meldung_id,
                "Nachfass",
            )
            .await
        });
        let confirm_pool = pool.clone();
        let confirm_start = start.clone();
        let confirm = tokio::spawn(async move {
            confirm_start.wait().await;
            bestaetige(&confirm_pool, 1, e, meldung_id, b, "2026-06-12 09:06:00").await
        });
        start.wait().await;
        ensure.await.unwrap().unwrap();
        assert!(confirm.await.unwrap().unwrap());

        let offen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM erinnerung \
             WHERE quelle = 'auto_frist' AND status = 'offen' \
               AND bezug_typ = 'meldung' AND bezug_id = ?",
        )
        .bind(m.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(offen, 0);
        assert!(
            laden(&pool, m.id, "2026-06-12 09:07:00")
                .await
                .unwrap()
                .ist_bestaetigt
        );
    }

    #[tokio::test]
    async fn setze_eskaliert_nur_ueberfaellig_unbestaetigt_und_one_shot() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        // Vor Frist: keine Eskalation.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:04:00")
            .await
            .unwrap());
        // Nach Frist + unbestätigt: frische Eskalation (true).
        assert!(setze_eskaliert(&pool, m.id, "2026-06-12 09:06:00")
            .await
            .unwrap());
        assert!(
            laden(&pool, m.id, "2026-06-12 09:06:00")
                .await
                .unwrap()
                .eskaliert
        );
        // Erneut: One-Shot, kein Doppel-Highlight.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:07:00")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn bestaetige_einmalig_erste_gewinnt_kein_overwrite() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let b2: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Zwei','zwei','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        // Erste Bestätigung gewinnt (true), zweite (anderer Bestätiger, später) ist No-op (false).
        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00")
            .await
            .unwrap());
        assert!(!bestaetige(&pool, 1, e, m.id, b2, "2026-06-12 09:08:00")
            .await
            .unwrap());
        let nach = laden(&pool, m.id, "2026-06-12 09:09:00").await.unwrap();
        assert_eq!(
            nach.bestaetigt_at.as_deref(),
            Some("2026-06-12 09:06:00"),
            "Erst-Quittung bleibt"
        );
        assert_eq!(
            nach.bestaetigt_von_id,
            Some(b),
            "Erst-Bestätiger bleibt (kein last-writer-wins)"
        );
    }

    #[tokio::test]
    async fn bestaetige_setzt_eskaliert_zurueck() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        assert!(setze_eskaliert(&pool, m.id, "2026-06-12 09:06:00")
            .await
            .unwrap());
        assert!(
            laden(&pool, m.id, "2026-06-12 09:06:00")
                .await
                .unwrap()
                .eskaliert
        );
        // Bestätigung räumt das Eskalations-Residuum ab.
        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:07:00")
            .await
            .unwrap());
        assert!(
            !laden(&pool, m.id, "2026-06-12 09:07:00")
                .await
                .unwrap()
                .eskaliert
        );
    }

    #[tokio::test]
    async fn setze_eskaliert_nicht_nach_bestaetigung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00"),
        )
        .await
        .unwrap();
        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00")
            .await
            .unwrap();
        // Trotz überschrittener Frist: bestätigt → keine Eskalation.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:07:00")
            .await
            .unwrap());
        assert!(
            !laden(&pool, m.id, "2026-06-12 09:07:00")
                .await
                .unwrap()
                .eskaliert
        );
    }

    /// Baut minimale, valide Auftragsdaten (ein Funktions-Empfänger, keine DB-Lookups nötig).
    fn auftrag_daten(text: &str) -> crate::auftrag::repo::AuftragDaten<'_> {
        crate::auftrag::repo::AuftragDaten {
            auftrag_text: text,
            absicht: None,
            lage: None,
            ort: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            weg: None,
            prioritaet: "normal",
            richtung: "intern",
            frist_at: None,
            erteilt_at: "2026-06-12 10:00:00",
            empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                empfaenger_typ: "funktion".into(),
                abschnitt_id: None,
                einheit_id: None,
                person_id: None,
                fahrzeug_id: None,
                funktion_text: Some("S4".into()),
                funktion: None,
                extern_kategorie: None,
                extern_bezeichnung: None,
            }],
        }
    }

    #[tokio::test]
    async fn erteile_auftrag_legt_auftrag_an_und_setzt_rueckverweis() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Tank fordern", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();

        let auftrag_id = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("Tank fordern"))
            .await
            .unwrap();

        // Auftrag landet im Auftrag-Modul, ETB-Anordnung entsteht im selben Commit (Pattern B).
        let detail = crate::auftrag::repo::laden(&pool, auftrag_id, "2026-06-12 10:00:00")
            .await
            .unwrap();
        assert_eq!(detail.auftrag.auftrag_text, "Tank fordern");
        assert!(
            detail.auftrag.etb_anordnung_id.is_some(),
            "ETB-Anordnung im selben Commit erzeugt"
        );
        assert_eq!(detail.empfaenger.len(), 1);

        // Rückverweis an der Meldung ist gesetzt.
        let nachher = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nachher.auftrag_id, Some(auftrag_id));
    }

    #[tokio::test]
    async fn erteile_auftrag_doppelt_ist_konflikt_und_legt_keinen_zweiten_auftrag_an() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("erster"))
            .await
            .unwrap();

        let zweimal = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("zweiter")).await;
        assert!(matches!(zweimal.unwrap_err(), AppError::Conflict(_)));

        // Kein verwaister Auftrag: die zweite (abgewiesene) Anlage darf nichts hinterlassen.
        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auftrag WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            anzahl, 1,
            "abgewiesene Doppel-Erteilung legt keinen zweiten Auftrag an (transaktional)"
        );
    }

    #[tokio::test]
    async fn erteile_auftrag_nach_aufhebung_stellt_verknuepfung_auf_neuen_auftrag_um() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Tank fordern", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        let erster = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("erster"))
            .await
            .unwrap();
        let vorher = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert!(
            !vorher.is_auftrag_aufgehoben,
            "offener Auftrag ist nicht aufgehoben"
        );

        sqlx::query(
            "UPDATE auftrag SET aufgehoben_at = '2026-06-12 10:30:00', aufgehoben_von_id = ?, \
             aufhebungsgrund = 'Lage erledigt' WHERE id = ?",
        )
        .bind(b)
        .bind(erster)
        .execute(&pool)
        .await
        .unwrap();
        let aufgehoben = laden(&pool, m.id, "2026-06-12 11:00:00").await.unwrap();
        assert_eq!(aufgehoben.auftrag_id, Some(erster));
        assert!(
            aufgehoben.is_auftrag_aufgehoben,
            "Meldung zeigt den aufgehobenen Auftrag an"
        );

        let zweiter = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("zweiter"))
            .await
            .unwrap();
        assert_ne!(zweiter, erster);
        let nachher = laden(&pool, m.id, "2026-06-12 11:00:00").await.unwrap();
        assert_eq!(
            nachher.auftrag_id,
            Some(zweiter),
            "Verknüpfung zeigt auf den neuen Auftrag"
        );
        assert!(!nachher.is_auftrag_aufgehoben);

        // Der alte Auftrag bleibt bestehen und aufgehoben (nachvollziehbar über ETB und Abgeschlossen).
        let alt = crate::auftrag::repo::laden(&pool, erster, "2026-06-12 11:00:00")
            .await
            .unwrap();
        assert!(alt.auftrag.aufgehoben_at.is_some());

        // Ein offener (zweiter) Auftrag sperrt weiter.
        let dritter = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("dritter")).await;
        assert!(matches!(dritter.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn erteile_auftrag_unbekannte_meldung_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let ergebnis = erteile_auftrag_tx(&pool, e, 999, b, auftrag_daten("x")).await;
        assert!(matches!(ergebnis.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn richtung_default_intern_und_filter_extern() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Default 'intern' über den daten()-Helper.
        let m_int = anlegen(
            &pool,
            e,
            b,
            daten("intern-m", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert_eq!(m_int.richtung, Richtung::Intern);
        let extern_m = MeldungDaten {
            richtung: "extern",
            ..daten("extern-m", "2026-06-12 09:01:00", "2026-06-12 09:01:00")
        };
        anlegen(&pool, e, b, extern_m).await.unwrap();

        assert_eq!(
            liste(&pool, e, &MeldungFilter::default(), "2026-06-12 10:00:00")
                .await
                .unwrap()
                .len(),
            2
        );
        let nur_extern = liste(
            &pool,
            e,
            &MeldungFilter {
                richtung: Some("extern"),
                ..Default::default()
            },
            "2026-06-12 10:00:00",
        )
        .await
        .unwrap();
        assert_eq!(nur_extern.len(), 1);
        assert_eq!(nur_extern[0].richtung, Richtung::Extern);
        assert_eq!(nur_extern[0].inhalt, "extern-m");
    }

    /// LFH-690: `anlegen_tx` liest die Auto-ETB-Einstellung der EIGENEN Org, auch wenn der
    /// Einsatz in derselben, noch offenen Transaktion entstanden ist. Ein Pool-Lesezugriff
    /// sähe den Einsatz nicht (Datei/WAL: eigener Snapshot), fiele mit `unwrap_or(0)` still
    /// auf Org 0 zurück, deren Vorgabe Auto-ETB AN ist, und schriebe einen ETB-Eintrag.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn anlegen_tx_liest_auto_etb_der_eigenen_org() {
        let (_dir, pool) = crate::db::test_pool_datei().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (7, 'Orga 7')")
            .execute(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (7,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        crate::org::einstellungen::speichern(
            &pool,
            7,
            b,
            crate::org::einstellungen::OrgEinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // Vorbedingung: die Rückfall-Org 0 hätte Auto-ETB an, sonst trennte der Test nicht.
        let org0 = crate::org::einstellungen::laden_oder_default(&pool, 0)
            .await
            .unwrap();
        assert!(crate::einsatz::effektiv::effektiv_auto_etb_aktiv(
            &crate::einsatz::einstellungen::laden_oder_default(&pool, -1)
                .await
                .unwrap(),
            &org0
        ));

        let (e, m) = crate::write_retry!(&pool, |conn| {
            let e: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (7, 'Lage') RETURNING id",
            )
            .fetch_one(&mut *conn)
            .await?;
            let m = anlegen_tx(
                &mut *conn,
                e,
                b,
                &daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
            )
            .await?;
            Ok((e, m))
        })
        .unwrap();

        let etb: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(etb, 0, "Org 7 hat Auto-ETB aus → kein ETB-Eintrag");
        let backlink: Option<i64> =
            sqlx::query_scalar("SELECT etb_meldung_id FROM meldung WHERE id = ?")
                .bind(m)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(backlink, None);
    }

    #[tokio::test]
    async fn auto_etb_einsatz_null_org_aus_kein_etb() {
        // Einsatz-Setting NULL + Org=0 → effektiv aus → kein ETB-Folgeeintrag
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::org::einstellungen::speichern(
            &pool,
            1,
            b,
            crate::org::einstellungen::OrgEinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // Einsatz-Setting bleibt NULL (kein Override)
        let m = anlegen(
            &pool,
            e,
            b,
            daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(
            m.etb_meldung_id.is_none(),
            "Einsatz=NULL, Org=0 → kein ETB-Folgeeintrag"
        );
    }

    #[tokio::test]
    async fn auto_etb_einsatz_an_schlaegt_org_aus() {
        // Einsatz=1 schlägt Org=0 → ETB-Folgeeintrag wird trotz Org-Aus erzeugt
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::org::einstellungen::speichern(
            &pool,
            1,
            b,
            crate::org::einstellungen::OrgEinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auto_etb_eintraege: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let m = anlegen(
            &pool,
            e,
            b,
            daten("Y", "2026-06-12 09:00:00", "2026-06-12 09:00:00"),
        )
        .await
        .unwrap();
        assert!(
            m.etb_meldung_id.is_some(),
            "Einsatz=1 schlägt Org=0 → ETB-Folgeeintrag erzeugt"
        );
    }

    /// LFH-259/F34: Eine ungültige Meldungsart wird an der Repo-Grenze als Validation-Fehler
    /// abgewiesen (nicht nur per debug_assert, das im Release wegkompiliert wäre).
    #[tokio::test]
    async fn anlegen_ungueltige_meldungsart_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut d = daten(
            "Deich instabil",
            "2026-06-12 09:00:00",
            "2026-06-12 09:05:00",
        );
        d.meldungsart = "quatsch";
        assert!(matches!(
            anlegen(&pool, e, b, d).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }
}
