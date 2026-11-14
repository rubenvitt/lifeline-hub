use super::berechtigung::darf_lesen;
use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, EinsatzStatus, Einsatzart, MitgliedAnzeige,
    MitgliedAuswahl, EINSATZ_ROLLE_LEITUNG, STATUS_ABGESCHLOSSEN,
};
use crate::auth::{Benutzer, FremdeinsatzLesezugriff};
use crate::error::AppError;
use chrono::Utc;
use sqlx::{SqliteConnection, SqlitePool};

/// Die Felder, die beim Anlegen gesetzt werden dürfen (LFH-332 · B4).
///
/// **Warum ein Struct und nicht fünf Parameter:** `einsatzart` und `begonnen_at`
/// kamen erst mit dem erweiterten Anlegedialog dazu. Beide sind `Option` und beide
/// sind Strings — als Stellungsparameter wären sie ohne Blick auf die Signatur
/// vertauschbar. Dasselbe Muster trägt `KopfPatch` weiter unten.
pub struct NeuerEinsatzDaten<'a> {
    pub bezeichnung: &'a str,
    pub stichwort: Option<&'a str>,
    /// `None` → DB-Default `'realeinsatz'`. Der Aufrufer hat den Wert bereits
    /// gegen `Einsatzart::parse` geprüft.
    pub einsatzart: Option<&'a str>,
    /// Alarmzeit. `None` → DB-Default `datetime('now')`. Der Aufrufer hat den Wert
    /// bereits durch `etb::normalisiere_zeit` geschickt.
    pub begonnen_at: Option<&'a str>,
    /// Einsatzort beim Anlegen (LFH-1175). Leer → ohne Ort.
    pub ort: NeuerEinsatzort<'a>,
    /// Einsatz-Vorlage (LLH-1375): jedes ausgeblendete Modul wird ein eigener Einsatzwert
    /// `sichtbar = 0`. Fremd oder unbekannt → 400, ohne dass ein Einsatz entsteht. `None` →
    /// keine Modulwerte.
    pub vorlage_id: Option<i64>,
}

/// Einsatzort beim Anlegen: Adresse und Koordinate, beide optional. Die Koordinate ist ein Paar
/// (Breite, Länge), der Aufrufer hat Bereich und Paar geprüft.
#[derive(Debug, Default, Clone, Copy)]
pub struct NeuerEinsatzort<'a> {
    pub adresse: Option<&'a str>,
    pub koordinate: Option<(f64, f64)>,
}

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    daten: NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    anlegen_zum(pool, daten, ersteller_id, chrono::Utc::now()).await
}

/// [`anlegen`] mit hineingereichtem Zeitpunkt für das Jahr der Einsatznummer — nur damit
/// die Neujahrsgrenze ohne Uhr-Mock prüfbar ist. `angelegt_at`/`begonnen_at` bleiben
/// `datetime('now')` der Datenbank.
///
/// Dünne Hülle über [`anlegen_tx`] (LFH-690, design.md D5): eigene `BEGIN IMMEDIATE`-
/// Transaktion über `write_retry!`, danach das Laden über den Pool.
pub(crate) async fn anlegen_zum(
    pool: &SqlitePool,
    daten: NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<Einsatz, AppError> {
    let einsatz_id = crate::write_retry!(pool, |conn| {
        anlegen_tx(conn, &daten, ersteller_id, jetzt).await
    })?;

    laden(pool, einsatz_id).await
}

/// ID für einen neuen Einsatz (LFH-690, design.md D6): über allen bestehenden Einsätzen UND über
/// jeder ID, die ein Demo-Import je getragen hat oder die das Löschprotokoll der endgültigen
/// Löschung führt (LFH-750, design.md D5). Ohne Demo-Historie ist das `MAX(id)+1`, dieselbe
/// Vergabe wie SQLites eigene für `INTEGER PRIMARY KEY` ohne AUTOINCREMENT. Gilt für jede
/// Anlage, auch für einen Spiegel (LLH-1630). Der Aufrufer hält `BEGIN IMMEDIATE`.
pub(crate) async fn naechste_id(conn: &mut SqliteConnection) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT MAX(COALESCE((SELECT MAX(id) FROM einsatz), 0), \
                    COALESCE((SELECT MAX(einsatz_id) FROM demo_import), 0), \
                    COALESCE((SELECT MAX(einsatz_id) FROM aufbewahrung_loeschprotokoll), 0)) + 1",
    )
    .fetch_one(conn)
    .await
}

/// Legt einen Einsatz auf der Verbindung des Aufrufers an: Einsatznummer aus dem Kreis der
/// Organisation und Mitgliedschaft des Erstellers als Einsatzleitung. Liefert die neue ID.
///
/// Der Aufrufer hält die Transaktion (`BEGIN IMMEDIATE`, sonst ist die Nummernvergabe nicht
/// rennfrei). So kann der Demo-Import (LFH-690) den Einsatz in seiner eigenen Transaktion
/// anlegen und sieht dabei dieselbe Vergabe wie der Betrieb.
pub(crate) async fn anlegen_tx(
    conn: &mut SqliteConnection,
    daten: &NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<i64, AppError> {
    // Ein Einsatz gehört zur Organisation SEINES ERSTELLERS (F05/LFH-232). Vorher stand
    // hier `SELECT id FROM organisation ORDER BY id LIMIT 1` („Single-Org in T1") — sobald
    // eine zweite Organisation existiert, wäre jeder ihrer Einsätze in Org 1 gelandet und
    // der Ersteller sofort ein org-fremdes Mitglied (die Mitgliedschaft unten umgeht
    // `darf_fremdeinsatz_lesen`, weil `darf_lesen` bei vorhandener Rolle nicht mehr
    // org-prüft). Der Wert ist damit auch bei genau einer Org identisch — nur eben aus
    // der richtigen Quelle.
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE id = ?")
        .bind(ersteller_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::Internal("Ersteller nicht gefunden".into()))?;

    // Einsatznummer <Präfix><JJJJ>-<NNNN> (LFH-617): NNNN je Organisation + Jahr
    // fortlaufend über die Zahlenspalten, nicht über die Zerlegung des Textes. Präfix
    // und Zeitzone kommen aus den Org-Einstellungen; das Präfix wird in den Text
    // eingefroren, das Jahr zählt in der Org-Zeitzone (sonst Europe/Berlin).
    // BEGIN IMMEDIATE (F09) schließt die read-then-write-Lücke zwischen MAX-Read und
    // Insert; der Unique-Index (org_id, nummer_jahr, nummer_lfd) sichert zusätzlich ab.
    let (praefix, zeitzone): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT einsatz_nummer_praefix, zeitzone FROM org_einstellungen WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or((None, None));
    // LLH-1375: die Vorlage vor jedem Schreiben prüfen; fremd oder unbekannt ist ein Feldfehler.
    // Sie liefert die ausgeblendeten Module und, seit LLH-1313, ihr Schichtmodell.
    let (vorlage_aus, vorlage_schichtmodell) = match daten.vorlage_id {
        Some(vid) => {
            let v =
                crate::einsatz_vorlage::repo::load_for_anlage_tx(&mut *conn, org_id, vid).await?;
            (v.ausgeblendet, v.schichtmodell_id)
        }
        None => (Vec::new(), None),
    };
    let jahr = super::nummer::jahr_in_zone(jetzt, zeitzone.as_deref());
    // Das Löschprotokoll zählt mit (LFH-750, design.md D5): die Nummer eines endgültig
    // gelöschten Einsatzes kommt nicht wieder. Spiegel zählen nicht (LLH-1630): ihre Nummer
    // vergibt die führende Instanz unabhängig (`idx_einsatz_nummer… WHERE spiegel = 0`).
    let max_lfd: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(lfd) FROM ( \
             SELECT nummer_lfd AS lfd FROM einsatz \
             WHERE org_id = ?1 AND nummer_jahr = ?2 AND spiegel = 0 \
             UNION ALL \
             SELECT nummer_lfd FROM aufbewahrung_loeschprotokoll \
             WHERE org_id = ?1 AND nummer_jahr = ?2)",
    )
    .bind(org_id)
    .bind(jahr)
    .fetch_one(&mut *conn)
    .await?;
    // Belegte TEXTE überspringen: ein früher von Hand gesetzter Wert im neuen Muster
    // (z. B. `E-2026-0005`) trägt keine Zahlen und zählt im MAX nicht mit. Ohne das
    // Ausweichen schlüge der Text-Index aus 0005 an — bei jedem weiteren Versuch
    // wieder, denn MAX(nummer_lfd) wüchse nie darüber hinaus. Die Schleife endet, weil
    // eine Org nur endlich viele Texte hat.
    let mut lfd = max_lfd.unwrap_or(0) + 1;
    let einsatznummer = loop {
        let kandidat = super::nummer::formatiere(praefix.as_deref(), jahr, lfd);
        let belegt: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM einsatz \
                           WHERE org_id = ?1 AND einsatznummer_intern = ?2 AND spiegel = 0) \
                 OR EXISTS(SELECT 1 FROM aufbewahrung_loeschprotokoll \
                           WHERE org_id = ?1 AND einsatznummer_intern = ?2)",
        )
        .bind(org_id)
        .bind(&kandidat)
        .fetch_one(&mut *conn)
        .await?;
        if !belegt {
            break kandidat;
        }
        lfd += 1;
    };

    // COALESCE statt eines zweiten INSERT-Zweigs: `einsatzart` und `begonnen_at`
    // sind NOT NULL mit DB-Default. Ein explizit gebundenes NULL überschriebe den
    // Default und verletzte die Bedingung — COALESCE lässt den Default greifen.
    //
    // Die ID wird ausdrücklich vergeben (LFH-690, design.md D6): über allen bestehenden
    // Einsätzen UND über jeder ID, die ein Demo-Import je getragen hat oder die das
    // Löschprotokoll der endgültigen Löschung führt (LFH-750, design.md D5). `demo_import`
    // behält die ID nach dem Entfernen als Sperre; ohne sie bekäme der nächste echte
    // Einsatz die ID des gelöschten Demo-Einsatzes, und Offline-Queues oder offene Tabs
    // schrieben still in ihn. Das gilt für JEDE Anlage, instanzweit (IDs sind nicht je Org).
    // Regel in [`naechste_id`]; rennfrei unter BEGIN IMMEDIATE.
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (id, org_id, bezeichnung, stichwort, einsatzart, begonnen_at, \
                              einsatznummer_intern, nummer_jahr, nummer_lfd, angelegt_at, \
                              einsatzort, einsatzort_lat, einsatzort_lon) \
         VALUES (?, ?, ?, ?, COALESCE(?, 'realeinsatz'), COALESCE(?, datetime('now')), ?, \
                 ?, ?, datetime('now'), ?, ?, ?) RETURNING id",
    )
    .bind(naechste_id(&mut *conn).await?)
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.stichwort)
    .bind(daten.einsatzart)
    .bind(daten.begonnen_at)
    .bind(&einsatznummer)
    .bind(jahr)
    .bind(lfd)
    .bind(daten.ort.adresse)
    .bind(daten.ort.koordinate.map(|(lat, _)| lat))
    .bind(daten.ort.koordinate.map(|(_, lon)| lon))
    .fetch_one(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *conn)
    .await?;
    // LLH-1122/LLH-1313: das Schichtmodell der Vorlage, sonst die Vorgabe der Organisation wird
    // als Kopie die Vorgabe des Einsatzes, damit die Ablösung vom ersten Eintreffen an rechnen
    // kann; ohne beides keine.
    crate::schichtmodell::repo::copy_vorgabe_tx(
        conn,
        einsatz_id,
        org_id,
        vorlage_schichtmodell,
        ersteller_id,
    )
    .await?;
    write_vorlage_overrides_tx(conn, einsatz_id, &vorlage_aus, ersteller_id).await?;
    // LLH-1574 (design.md D4): ein Sanitätsdienst, auch über die Start-Vorlage, beginnt mit der
    // Reihe „Sanitätsdienst“ im Lagebild.
    super::lagekennzahl::vorbelegen_tx(conn, einsatz_id, daten.einsatzart, ersteller_id).await?;
    Ok(einsatz_id)
}

/// Schreibt je ausgeblendetem Modul einer Einsatz-Vorlage einen eigenen Einsatzwert
/// `sichtbar = 0` (LLH-1375, design.md D2), so als hätte die Einsatzleitung den Schalter selbst
/// umgelegt; die Rolle bleibt NULL (erbt). Andere Module bekommen keine Zeile und erben die
/// Org-Vorgabe. Ein nicht (mehr) bekannter oder nicht ausblendbarer Schlüssel fällt weg.
async fn write_vorlage_overrides_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ausgeblendet: &[String],
    ersteller_id: i64,
) -> Result<(), AppError> {
    let keys: Vec<&str> = ausgeblendet
        .iter()
        .map(String::as_str)
        .filter(|k| super::modul::ist_gueltiger_modul_key(k) && super::modul::ist_ausblendbar(k))
        .collect();
    if keys.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(&keys)
        .map_err(|e| AppError::Internal(format!("Modulschlüssel serialisieren: {e}")))?;
    sqlx::query(
        "INSERT INTO einsatz_modul_override \
            (einsatz_id, modul_key, sichtbar, benoetigte_rolle, geaendert_at, geaendert_von) \
         SELECT ?, value, 0, NULL, datetime('now'), ? FROM json_each(?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(json)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Schwärzungsstand eines Einsatzes `e` als Spalte `teilschwaerzungen` (LFH-996, design.md D1):
/// vollzogene Personen-Anträge plus geschwärzte Datenkategorien, `NULL` bei 0. Beide Mengen
/// wachsen nur. Steht in `laden` und `liste_fuer` (Makros, damit beide wortgleich bleiben):
/// die Spalte hinter das SELECT, die Joins hinter `FROM einsatz e`. Gruppiert gezählt statt je
/// Zeile korreliert, damit `GET /api/einsaetze` die Anträge einmal liest und nicht einmal je
/// Einsatz (für Anträge gibt es keinen Index über `einsatz_id`, beide sind Teilindizes).
macro_rules! teilschwaerzungen_spalte {
    () => {
        "NULLIF(COALESCE(tsa.n, 0) + COALESCE(tka.n, 0), 0) AS teilschwaerzungen"
    };
}

macro_rules! teilschwaerzungen_joins {
    () => {
        " LEFT JOIN (SELECT einsatz_id, COUNT(*) AS n FROM schwaerzung_antrag \
                     WHERE ziel_art <> 'einsatz' AND vollzogen_at IS NOT NULL \
                     GROUP BY einsatz_id) tsa ON tsa.einsatz_id = e.id \
          LEFT JOIN (SELECT einsatz_id, COUNT(*) AS n FROM einsatz_aufbewahrung_kategorie \
                     WHERE geschwaerzt_at IS NOT NULL \
                     GROUP BY einsatz_id) tka ON tka.einsatz_id = e.id "
    };
}

/// Der Einsatzleiter der eigenen Führungsstelle `e` (LLH-1168), wortgleich in `laden` und
/// `liste_fuer` wie die Schwärzungsspalte: die Spalten hinter das SELECT, die Joins hinter
/// `FROM einsatz e`. Eine Zeile Führungsstelle je Einsatz (Primärschlüssel `einsatz_id`), der Join
/// vervielfacht also nichts. Gelesen über `fuehrungsstelle::EinsatzleiterSpalten`.
macro_rules! einsatzleiter_spalten {
    () => {
        "elfs.einsatzleiter_art, elfs.einsatzleiter_personal_id, elfs.einsatzleiter_name, \
         elfs.einsatzleiter_seit, elep.id IS NOT NULL AS einsatzleiter_noch_disponiert"
    };
}

macro_rules! einsatzleiter_joins {
    () => {
        " LEFT JOIN einsatz_fuehrungsstelle elfs ON elfs.einsatz_id = e.id \
          LEFT JOIN einsatz_personal elep ON elep.id = elfs.einsatzleiter_personal_id "
    };
}

/// Die Führung je Einsatz (LLH-1491), wortgleich in `laden` und `liste_fuer`: die Spalten hinter
/// das SELECT, der Join hinter `FROM einsatz e`. Ohne Schalter findet der Join keine Akte. Nur
/// Anzeige; geschützt ist ein fremd geführter Einsatz als Spiegel (LLH-1641). Gelesen über
/// `instanz::fuehrung::FuehrungSpalten`.
macro_rules! fuehrung_spalten {
    () => {
        concat!(
            "COALESCE(ef.fuehrer_kennung <> (SELECT kennung FROM instanz_identitaet), 0) \
           AS fuehrung_fremd, \
         ef.epoche_zaehler AS fuehrung_epoche, ef.fuehrer_name AS fuehrung_fuehrer, \
         ef.offen IS NOT NULL AS fuehrung_offen, \
         COALESCE(ef.einsatz_id IS NOT NULL AND ",
            crate::instanz::fuehrung::repo::fuehrung_beendet_sql!(),
            ", 0) AS fuehrung_beendet"
        )
    };
}

macro_rules! fuehrung_joins {
    () => {
        " LEFT JOIN einsatz_fuehrung ef ON ef.einsatz_id = e.id \
            AND (SELECT fuehrung_an FROM instanz_identitaet) = 1 "
    };
}

/// Spiegel-Angaben (LLH-1492): ob der Einsatz ein Spiegel ist, von wem, wann zuletzt abgeglichen,
/// die Zahl offener und abgelehnter Anträge und der offenen Erfassungen der Bruchstelle
/// (LLH-1646: weder nachgereicht noch verworfen, Folgezeilen zählen nicht extra).
macro_rules! spiegel_spalten {
    () => {
        "sp.einsatz_id IS NOT NULL AS spiegel_ist, spk.gegenueber_name AS spiegel_gegenstelle, \
         sp.letzter_abgleich_at AS spiegel_abgleich_at, sp.beendet_at AS spiegel_beendet_at, \
         (SELECT ae.loeschen_at FROM einsatz_archiv_eingespielt ae WHERE ae.einsatz_id = e.id) \
             AS spiegel_archiv_bis, \
         (SELECT COUNT(*) FROM spiegel_antrag sa WHERE sa.einsatz_id = e.id \
             AND sa.zustand IN ('ausstehend', 'zugestellt')) AS spiegel_ausstehend, \
         (SELECT COUNT(*) FROM spiegel_antrag sa WHERE sa.einsatz_id = e.id \
             AND sa.zustand = 'abgelehnt') AS spiegel_abgelehnt, \
         (SELECT COUNT(*) FROM einsatz_bruchstelle eb WHERE eb.einsatz_id = e.id \
             AND eb.entfernt = 1 AND eb.daten IS NOT NULL AND eb.folge_von IS NULL \
             AND eb.erledigt IS NULL) AS spiegel_bruchstelle"
    };
}

macro_rules! spiegel_joins {
    () => {
        " LEFT JOIN einsatz_spiegel sp ON sp.einsatz_id = e.id \
          LEFT JOIN instanz_kopplung_org spo ON spo.id = sp.kopplung_org_id \
          LEFT JOIN instanz_kopplung spk ON spk.id = spo.kopplung_id "
    };
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    // Die vier EXISTS-Spalten sind die Auslöser der Lagekennzahlen (LFH-640/LFH-607/LLH-1371/LLH-1574); sie
    // stehen wortgleich auch in `liste_fuer`, das Bezirksprädikat wie `istAktiverBezirk` im
    // Frontend — siehe `lagekennzahl::ableiten`.
    sqlx::query_as::<_, Einsatz>(concat!(
        "SELECT e.id, e.org_id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.nachbereitung_bis, e.geloescht_at, e.naechste_lagebesprechung_at, \
                o.name AS org_name, \
                (SELECT v.gegenstelle FROM einsatz_verwahrung v WHERE v.einsatz_id = e.id) \
                    AS verwahrung_gegenstelle, \
                (SELECT v.grund FROM einsatz_verwahrung v WHERE v.einsatz_id = e.id) \
                    AS verwahrung_grund, \
                EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id) AS pegel_festgelegt, \
                EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = e.id \
                        AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben') \
                    AS evakuierung_angeordnet, \
                EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl w WHERE w.einsatz_id = e.id \
                        AND w.kennzahl = 'nachforderungen') AS nachforderungen_gewaehlt, \
                EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl w WHERE w.einsatz_id = e.id \
                        AND w.kennzahl = 'sanitaetsdienst') AS sanitaetsdienst_gewaehlt, ",
        teilschwaerzungen_spalte!(),
        ", ",
        einsatzleiter_spalten!(),
        ", ",
        fuehrung_spalten!(),
        ", ",
        spiegel_spalten!(),
        " FROM einsatz e",
        teilschwaerzungen_joins!(),
        einsatzleiter_joins!(),
        fuehrung_joins!(),
        spiegel_joins!(),
        "LEFT JOIN organisation o ON o.id = e.org_id \
         WHERE e.id = ?",
    ))
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Liefert die Einsatz-Rolle eines Benutzers in einem Einsatz (`None` = kein Mitglied).
pub async fn rolle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<EinsatzRolle>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(rolle.and_then(|s| EinsatzRolle::parse(&s)))
}

/// Eigene Führungsstelle (Code und Text), ausdrücklich auf Benutzer UND Einsatz begrenzt —
/// Quelle von `meine_fuehrungsstelle`, `meine_sachgebiete` und `meine_funktion`
/// (`MeineFelder`, i6k6mzed D2). `None` ohne Mitgliedschaft.
pub async fn fuehrungsstelle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<crate::fuehrung::Funktionsangabe>, AppError> {
    let zeile: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT fuehrungsfunktion, fuehrungsstelle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(|(code, text)| crate::fuehrung::aus_spalten(code.as_deref(), text)))
}

/// Vorbelegungstext aus Code und Text einer Führungsstelle (LFH-549).
pub(crate) fn vorbelegung(
    karte: &crate::fuehrung::Labelkarte,
    code: Option<&str>,
    text: Option<String>,
) -> Option<String> {
    let angabe = crate::fuehrung::aus_spalten(code, text);
    match angabe.funktion {
        Some(f) => Some(karte.vorbelegung(f, angabe.text.as_deref())),
        None => angabe.text,
    }
}

/// Wirksame Mandantenlabels der Org eines Einsatzes (LFH-549).
pub async fn labelkarte(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<crate::fuehrung::Labelkarte, AppError> {
    let mut conn = pool.acquire().await?;
    crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut conn, einsatz_id).await
}

/// Alle für den Benutzer lesbaren Einsätze, annotiert mit dessen Rolle
/// (`meine_rolle`).
///
/// Die harten Sperren der DSGVO-Lese-Policy wirken schon im SQL (LFH-933): Tombstone,
/// abgelaufene Aufbewahrungsfrist und die Org-Grenze aus
/// [`Benutzer::fremdeinsatz_lesezugriff`] (ohne Mitgliedschaft nur, was der Benutzer fremd
/// lesen darf). Das SQL lässt nur weg, was `darf_lesen` sicher ablehnt; `darf_lesen` bleibt als
/// Netz dahinter und entscheidet den Rest (Schonfrist, Einsatzleitung).
pub async fn liste_fuer(
    pool: &SqlitePool,
    benutzer: &Benutzer,
) -> Result<Vec<EinsatzAnzeige>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        org_id: i64,
        org_name: String,
        bezeichnung: String,
        stichwort: Option<String>,
        #[sqlx(try_from = "String")]
        status: EinsatzStatus,
        begonnen_at: String,
        naechste_lagebesprechung_at: Option<String>,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        #[sqlx(try_from = "String")]
        einsatzart: Einsatzart,
        einsatznummer_intern: Option<String>,
        angelegt_at: String,
        leitstellen_nr: Option<String>,
        einsatzort: Option<String>,
        einsatzort_lat: Option<f64>,
        einsatzort_lon: Option<f64>,
        meldende_stelle: Option<String>,
        sachverhalt: Option<String>,
        anzahl_betroffene_initial: Option<i64>,
        retention_bis: Option<String>,
        nachbereitung_bis: Option<String>,
        geloescht_at: Option<String>,
        meine_rolle: Option<String>,
        meine_fuehrungsstelle: Option<String>,
        meine_fuehrungsfunktion: Option<String>,
        pegel_festgelegt: bool,
        evakuierung_angeordnet: bool,
        nachforderungen_gewaehlt: bool,
        sanitaetsdienst_gewaehlt: bool,
        teilschwaerzungen: Option<i64>,
        #[sqlx(flatten)]
        einsatzleiter: super::fuehrungsstelle::EinsatzleiterSpalten,
        #[sqlx(flatten)]
        fuehrung: crate::instanz::fuehrung::FuehrungSpalten,
        #[sqlx(flatten)]
        spiegel: crate::instanz::spiegel::SpiegelSpalten,
    }

    // Ein Zeitpunkt für SQL und `darf_lesen`, damit beide dieselbe Fristgrenze ziehen. Die
    // Frist vergleicht als Text wie der Purge (`? >= retention_bis`), aber nur im kanonischen
    // Format (GLOB): einen Wert, den `retention_abgelaufen` nicht parst und deshalb NICHT
    // sperrt, darf das SQL auch nicht weglassen.
    let jetzt = Utc::now();
    let jetzt_text = crate::zeit::formatiere_utc(jetzt);
    let zugriff = benutzer.fremdeinsatz_lesezugriff();
    let org_grenze = match zugriff {
        FremdeinsatzLesezugriff::Serverweit => "",
        FremdeinsatzLesezugriff::EigeneOrg(_) => " AND (e.org_id = ? OR m.benutzer_id IS NOT NULL)",
        FremdeinsatzLesezugriff::Keiner => " AND m.benutzer_id IS NOT NULL",
    };

    // EXISTS-Spalten wortgleich zu `laden` (Auslöser der Lagekennzahlen, `lagekennzahl::ableiten`).
    const LISTE_SELECT: &str = concat!(
        "SELECT e.id, e.org_id, o.name AS org_name, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.nachbereitung_bis, e.geloescht_at, e.naechste_lagebesprechung_at, \
                m.einsatz_rolle AS meine_rolle, m.fuehrungsstelle AS meine_fuehrungsstelle, \
                m.fuehrungsfunktion AS meine_fuehrungsfunktion, \
                EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id) AS pegel_festgelegt, \
                EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = e.id \
                        AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben') \
                    AS evakuierung_angeordnet, \
                EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl w WHERE w.einsatz_id = e.id \
                        AND w.kennzahl = 'nachforderungen') AS nachforderungen_gewaehlt, \
                EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl w WHERE w.einsatz_id = e.id \
                        AND w.kennzahl = 'sanitaetsdienst') AS sanitaetsdienst_gewaehlt, ",
        teilschwaerzungen_spalte!(),
        ", ",
        einsatzleiter_spalten!(),
        ", ",
        fuehrung_spalten!(),
        ", ",
        spiegel_spalten!(),
        " FROM einsatz e",
        teilschwaerzungen_joins!(),
        einsatzleiter_joins!(),
        fuehrung_joins!(),
        spiegel_joins!(),
        "LEFT JOIN organisation o ON o.id = e.org_id \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         WHERE (e.geloescht_at IS NULL OR e.geloescht_at = '') \
           AND NOT (e.status = 'abgeschlossen' AND e.retention_bis IS NOT NULL \
                    AND e.retention_bis GLOB \
                        '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]' \
                    AND ? >= e.retention_bis)",
    );
    let sql = format!("{LISTE_SELECT}{org_grenze} ORDER BY e.begonnen_at DESC, e.id DESC");
    let mut q = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(sql))
        .bind(benutzer.id)
        .bind(&jetzt_text);
    if let FremdeinsatzLesezugriff::EigeneOrg(org_id) = zugriff {
        q = q.bind(org_id);
    }
    let rows: Vec<Row> = q.fetch_all(pool).await?;

    let rows: Vec<Row> = rows
        .into_iter()
        .filter(|r| {
            darf_lesen(
                benutzer,
                r.org_id,
                r.status.as_str(),
                r.abgeschlossen_at.as_deref(),
                r.retention_bis.as_deref(),
                r.geloescht_at.as_deref(),
                r.meine_rolle.as_deref().and_then(EinsatzRolle::parse),
                jetzt,
            )
        })
        .collect();

    // Labelkarten je Org, einmal geladen (LFH-549), und erst NACH dem Filter (LFH-933): nur für
    // Orgs, deren Einsätze der Benutzer tatsächlich sieht. Eine Abfrage je sichtbarer Org —
    // das ist die eigene, bei Mitgliedschaften in fremden Einsätzen deren Orgs; nur der
    // System-Admin sieht alle.
    let mut karten: std::collections::HashMap<i64, crate::fuehrung::Labelkarte> =
        std::collections::HashMap::new();
    {
        let mut conn = pool.acquire().await?;
        for r in &rows {
            if let std::collections::hash_map::Entry::Vacant(v) = karten.entry(r.org_id) {
                v.insert(crate::fuehrung::repo::labelkarte(&mut conn, r.org_id).await?);
            }
        }
    }

    Ok(rows
        .into_iter()
        .map(|r| {
            let karte = karten.get(&r.org_id).cloned().unwrap_or_default();
            // Dieselbe reine Ableitung wie `Einsatz::anzeige` — aus der Mitgliedschaft, die die
            // Listenabfrage ohnehin mitliest, also ohne zweite Abfrage (i6k6mzed D2).
            let stelle = r.meine_rolle.as_ref().map(|_| {
                crate::fuehrung::aus_spalten(
                    r.meine_fuehrungsfunktion.as_deref(),
                    r.meine_fuehrungsstelle.clone(),
                )
            });
            let super::MeineFelder {
                fuehrungsstelle: meine_fuehrungsstelle,
                sachgebiete: meine_sachgebiete,
                funktion: meine_funktion,
                funktion_code: meine_funktion_code,
                funktion_bezeichnung: meine_funktion_bezeichnung,
            } = super::MeineFelder::ableiten(r.meine_rolle.as_deref(), stelle, &karte);
            EinsatzAnzeige {
                id: r.id,
                org_id: r.org_id,
                org_name: r.org_name,
                bezeichnung: r.bezeichnung,
                stichwort: r.stichwort,
                status: r.status,
                begonnen_at: r.begonnen_at,
                naechste_lagebesprechung_at: r.naechste_lagebesprechung_at,
                abgeschlossen_at: r.abgeschlossen_at,
                abgeschlossen_von: r.abgeschlossen_von,
                einsatzart: r.einsatzart,
                einsatznummer_intern: r.einsatznummer_intern,
                angelegt_at: r.angelegt_at,
                leitstellen_nr: r.leitstellen_nr,
                einsatzort: r.einsatzort,
                einsatzort_lat: r.einsatzort_lat,
                einsatzort_lon: r.einsatzort_lon,
                meldende_stelle: r.meldende_stelle,
                sachverhalt: r.sachverhalt,
                anzahl_betroffene_initial: r.anzahl_betroffene_initial,
                retention_bis: r.retention_bis,
                nachbereitung_bis: r.nachbereitung_bis,
                verwahrung: None,
                meine_rolle: r.meine_rolle,
                meine_fuehrungsstelle,
                meine_sachgebiete,
                meine_funktion,
                meine_funktion_code,
                meine_funktion_bezeichnung,
                lagekennzahlen: super::lagekennzahl::ableiten(
                    r.pegel_festgelegt,
                    r.evakuierung_angeordnet,
                    r.nachforderungen_gewaehlt,
                    r.sanitaetsdienst_gewaehlt,
                ),
                teilschwaerzungen: r.teilschwaerzungen,
                einsatzleiter: r.einsatzleiter.anzeige(),
                fuehrung: r.fuehrung.anzeige(),
                spiegel: r.spiegel.anzeige(),
            }
        })
        .collect())
}

/// Ergebnis einer Einsatz-Mutation, die System-ETB-Einträge schreibt (LFH-858): der neu
/// geladene Einsatz und die Kennungen der Einträge, in Schreibreihenfolge. Die Route meldet
/// jede Kennung nach dem Commit als `etb`-Ereignis (`LiveHub::publiziere`), damit offene
/// ETB-Schirme, die Kopfzahl und der Modulzähler ohne Neuladen nachziehen.
#[derive(Debug)]
pub struct MitEtbEintraegen {
    pub einsatz: Einsatz,
    pub etb_eintrag_ids: Vec<i64>,
}

/// Schließt einen Einsatz ab (nur wenn aktuell `aktiv`) und lädt ihn neu.
/// Das `status = 'aktiv'`-Prädikat im WHERE schützt gegen Races; die fachliche
/// 409-Prüfung erfolgt zusätzlich im Handler. Die ETB-Kennungen sind die der automatischen
/// Frist und der Kategorie-Fristen; ein Re-Close-No-Op liefert keine.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    von_benutzer_id: i64,
) -> Result<MitEtbEintraegen, AppError> {
    // Dauer-Politik vor der tx laden (eigener Pool-Borrow); steuert die Auto-Befüllung.
    let einstellungen = super::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einstellungen =
        crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;
    // LFH-749: Kategorie-Vorgaben der Org; daraus entstehen im selben Vorgang die
    // Kategorie-Fristen (Spec `aufbewahrung-kategorien`, „Kategorie-Frist beim Abschluss“).
    let kategorie_vorgaben =
        crate::org::aufbewahrung_kategorie::laden(pool, org_id.unwrap_or(0)).await?;
    // Die Fristen im ETB in Zone und Darstellung des Einsatzes (LLH-1540).
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;

    let mut etb_eintrag_ids = Vec::new();
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE einsatz \
         SET status = ?, abgeschlossen_at = datetime('now'), abgeschlossen_von = ? \
         WHERE id = ? AND status = 'aktiv'",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(von_benutzer_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    // Auto-Befüllung der Aufbewahrungsfrist NUR, wenn dieser Aufruf den Einsatz
    // tatsächlich abgeschlossen hat (rows_affected == 1, nicht ein Re-Close-No-Op),
    // eine Dauer-Politik gesetzt ist UND noch keine Frist existiert. Letzteres
    // schützt eine manuell gesetzte Frist (überschreibt nie). Setzt direkt im
    // Abschluss-tx, NICHT über frist_setzen — der Verkürzungs-Gate (None→Some)
    // würde das sonst als bestätigungspflichtige Verkürzung werten (LFH-135).
    if ergebnis.rows_affected() == 1 {
        // LLH-1638: Maschinenzugänge lesen nur laufende Einsätze; der Abschluss beendet ihre
        // Freigabe in derselben Transaktion (ADR-0035).
        crate::public_api::freigabe::delete_fuer_einsatz_tx(&mut tx, einsatz_id).await?;
        if let Some(dauer) =
            super::effektiv::effektive_retention_dauer_tage(&einstellungen, &org_einstellungen)
        {
            let (abgeschlossen_at, retention_bis): (Option<String>, Option<String>) =
                sqlx::query_as("SELECT abgeschlossen_at, retention_bis FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if retention_bis.is_none() {
                if let Some(neue_frist) = abgeschlossen_at
                    .as_deref()
                    .and_then(|a| super::retention::berechne_retention_bis(a, dauer))
                {
                    // Die Frist gilt als beim Abschluss gesetzt (LFH-906): ihre Karenz beginnt
                    // mit ihrem Ablauf, nicht erst mit dem Purge-Lauf, der vormerkt.
                    sqlx::query(
                        "UPDATE einsatz SET retention_bis = ?, retention_gesetzt_at = abgeschlossen_at \
                         WHERE id = ? AND retention_bis IS NULL",
                    )
                    .bind(&neue_frist)
                    .bind(einsatz_id)
                    .execute(&mut *tx)
                    .await?;
                    let audit = format!(
                        "Aufbewahrungsfrist automatisch gesetzt auf {} \
                         (Aufbewahrungs-Dauer {dauer} Tage ab Abschluss)",
                        stil.zeitpunkt_text(&neue_frist)
                    );
                    let etb_id = crate::etb::repo::anlegen_tx(
                        &mut tx,
                        einsatz_id,
                        von_benutzer_id,
                        einstellungen.etb_startwert(),
                        crate::etb::repo::EintragDaten {
                            typ: crate::etb::TYP_SYSTEM,
                            inhalt: &audit,
                            von: None,
                            an: None,
                            meldeweg: None,
                            veranlassung: None,
                            ereigniszeit: None,
                            erfasst_lokal_at: None,
                            berichtigt_eintrag_id: None,
                        },
                    )
                    .await?;
                    etb_eintrag_ids.push(etb_id);
                }
            }
        }
        // LLH-1494 (design.md D1): Nachbereitungsfrist aus der Org-Vorgabe.
        if let Some(tage) = org_einstellungen.nachbereitung_tage {
            if let Some(etb_id) = super::nachbereitung::beim_abschluss(
                &mut tx,
                einsatz_id,
                von_benutzer_id,
                einstellungen.etb_startwert(),
                &stil,
                tage,
            )
            .await?
            {
                etb_eintrag_ids.push(etb_id);
            }
        }
        if !kategorie_vorgaben.is_empty() {
            let abgeschlossen_at: Option<String> =
                sqlx::query_scalar("SELECT abgeschlossen_at FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if let Some(abgeschlossen_at) = abgeschlossen_at {
                let kategorie_ids = super::aufbewahrung_kategorie::fristen_beim_abschluss(
                    &mut tx,
                    einsatz_id,
                    von_benutzer_id,
                    einstellungen.etb_startwert(),
                    stil,
                    &abgeschlossen_at,
                    &kategorie_vorgaben,
                )
                .await?;
                etb_eintrag_ids.extend(kategorie_ids);
            }
        }
    }
    tx.commit().await?;
    Ok(MitEtbEintraegen {
        einsatz: laden(pool, einsatz_id).await?,
        etb_eintrag_ids,
    })
}

/// Der ETB-Text einer manuell gesetzten, geänderten oder aufgehobenen Aufbewahrungsfrist
/// (LFH-130) für [`frist_setzen`]: alte und neue Frist (Drahtformat) in Zone und Darstellung
/// des Einsatzes (LLH-1540, Spec `zeitdarstellung`, „Servertexte“).
pub fn frist_audit(
    stil: &crate::zeitdarstellung::Zeitstil,
    alt: Option<&str>,
    neu: Option<&str>,
) -> String {
    match (alt, neu) {
        (_, None) => "Aufbewahrungsfrist aufgehoben (unbegrenzt)".to_string(),
        (None, Some(neu)) => format!(
            "Aufbewahrungsfrist gesetzt auf {}",
            stil.zeitpunkt_text(neu)
        ),
        (Some(a), Some(neu)) => format!(
            "Aufbewahrungsfrist geändert von {} auf {}",
            stil.zeitpunkt_text(a),
            stil.zeitpunkt_text(neu)
        ),
    }
}

/// Setzt die Aufbewahrungsfrist (`retention_bis`) eines Einsatzes und schreibt in
/// derselben Transaktion einen ETB-System-Eintrag als Audit (LFH-130, ETB-Kopplung
/// Pattern B). `neue_frist = None` hebt die Frist auf (unbegrenzt). Der Audit-Text
/// wird vom Aufrufer gebildet (er kennt alten/neuen Wert). Die Verkürzungs-
/// Bestätigung ist Sache des Handlers. Liefert genau eine ETB-Kennung, den Audit-Eintrag.
/// `jetzt` ist der Zeitpunkt des Setzens (`retention_gesetzt_at`, LFH-906): liegt die neue
/// Frist davor, beginnt ihre Karenz erst mit ihm.
pub async fn frist_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    neue_frist: Option<&str>,
    audit_inhalt: &str,
    jetzt: chrono::DateTime<Utc>,
) -> Result<MitEtbEintraegen, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    // Bewacht (LFH-23, design.md D6): die Route prüft die Tombstones vorher, aber zwischen
    // Prüfung und Schreiben kann der Purge-Lauf vormerken. Ohne diesen Riegel stünde dann
    // eine „geänderte" Frist samt ETB an einem vorgemerkten Einsatz, und die Schwärzung
    // käme trotzdem (Phase B liest `retention_bis` nicht).
    let res = sqlx::query(
        "UPDATE einsatz SET retention_bis = ?, retention_gesetzt_at = ? \
         WHERE id = ? AND geloescht_at IS NULL AND geschwaerzt_at IS NULL",
    )
    .bind(neue_frist)
    .bind(crate::zeit::formatiere_utc(jetzt))
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        let tombstones: Option<(Option<String>, Option<String>)> =
            sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some((geloescht_at, geschwaerzt_at)) = tombstones else {
            return Err(AppError::NotFound);
        };
        return Err(crate::aufbewahrung::frist_sperre(
            geloescht_at.as_deref(),
            geschwaerzt_at.as_deref(),
            jetzt,
        )
        .unwrap_or_else(|| {
            AppError::Internal("Frist-UPDATE ohne Zeile, aber ohne Tombstone".into())
        }));
    }
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        erfasser_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt: audit_inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(MitEtbEintraegen {
        einsatz: laden(pool, einsatz_id).await?,
        etb_eintrag_ids: vec![etb_id],
    })
}

// ---------- Aufbewahrung / Purge (LFH-135) ----------

/// Ermittelt einen gültigen Benutzer als Akteur für System-ETB-Einträge des
/// Purge-Schedulers (`erfasser_id` ist NOT NULL FK). Reihenfolge (LFH-23): wer den
/// Einsatz abgeschlossen hat, dann eine Einsatzleitung, dann ein System-Admin der
/// Organisation DES EINSATZES (aktive vor inaktiven, dann kleinste id — deterministisch,
/// die Org kommt aus `einsatz.org_id`, nie aus der Zeilenreihenfolge der Organisationen).
/// `None`, wenn keiner auffindbar ist; dann bricht [`system_audit_tx`] die Mutation ab.
/// Läuft auf der übergebenen tx-Verbindung.
pub(crate) async fn ermittle_system_akteur(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<i64>, AppError> {
    let von: Option<i64> = sqlx::query_scalar(
        "SELECT abgeschlossen_von FROM einsatz WHERE id = ? AND abgeschlossen_von IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    if von.is_some() {
        return Ok(von);
    }
    let leit: Option<i64> = sqlx::query_scalar(
        "SELECT benutzer_id FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ? ORDER BY benutzer_id LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_optional(&mut *conn)
    .await?;
    if leit.is_some() {
        return Ok(leit);
    }
    let admin: Option<i64> = sqlx::query_scalar(
        "SELECT b.id FROM benutzer b JOIN einsatz e ON e.org_id = b.org_id \
         WHERE e.id = ? AND b.system_rolle = ? ORDER BY b.aktiv DESC, b.id LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(crate::auth::ROLLE_ADMIN)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(admin)
}

/// Schreibt einen System-ETB-Audit auf der tx-Verbindung. Der Startwert kommt aus den
/// Einstellungen (Nummernkreis), `inhalt` ist der Audit-Text.
///
/// **Fail-closed (LFH-23):** Ist kein Akteur auffindbar, liefert die Funktion einen Fehler.
/// Der Aufrufer rollt damit seine Transaktion zurück — Vormerkung bzw. Schwärzung
/// unterbleiben und werden im nächsten Purge-Lauf erneut versucht. Eine
/// Aufbewahrungs-Mutation ohne ETB-Eintrag gibt es nicht.
pub(crate) async fn system_audit_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    etb_startwert: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    let Some(akteur) = ermittle_system_akteur(conn, einsatz_id).await? else {
        // Die Org steht in der Meldung: sichtbar ist die Blockade NUR im Log (eine Org ohne
        // jeden Admin hat niemanden, der die Aufbewahrungsübersicht öffnen könnte), und der
        // Betrieb soll die betroffene Org ohne DB-Abfrage finden.
        let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
        return Err(AppError::Internal(format!(
            "Purge: kein Benutzer als ETB-Akteur für Einsatz {einsatz_id} (Org {}) auffindbar \
             (weder abschließende Person noch Einsatzleitung noch System-Admin der Org) — \
             Mutation abgebrochen, nächster Lauf versucht es erneut",
            org_id.map_or_else(|| "?".to_string(), |o| o.to_string())
        )));
    };
    crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        akteur,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    Ok(())
}

/// IDs ABGESCHLOSSENER Einsätze, deren Aufbewahrungsfrist abgelaufen ist und die
/// noch nicht soft-gelöscht sind (Phase-A-Kandidaten). `status='abgeschlossen'`
/// ist hart im WHERE — aktive Einsätze sind NIE fällig. Lexikografischer
/// Zeitvergleich (kanonisches Format). Org-isoliert über die `einsatz`-Tabelle.
pub async fn faellige_soft_delete(pool: &SqlitePool, jetzt: &str) -> Result<Vec<i64>, AppError> {
    // Spiegel bleiben aus (LLH-1492, design.md D10): sie enden mit dem Lebensende beim Führer
    // oder nach der Nachbereitung (`einsatz::abraeumen`, LLH-1494).
    let ids = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
        "SELECT id FROM einsatz \
         WHERE status = ? AND retention_bis IS NOT NULL \
           AND ? >= retention_bis AND geloescht_at IS NULL AND {} \
         ORDER BY id",
        super::spiegel_filter::nicht_gespiegelt("einsatz.id")
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Setzt den Soft-Delete-Tombstone (`geloescht_at`) eines fälligen Einsatzes und
/// schreibt einen System-ETB-Audit in derselben Transaktion. Idempotent über den
/// `geloescht_at IS NULL`-Guard: ein bereits soft-gelöschter Einsatz liefert
/// `false` (kein Doppel-Audit). Reversibel (Karenz vor der Schwärzung).
///
/// Der Tombstone ist der Karenz-Beginn (LFH-906, Spec `aufbewahrung`, „Löschvormerkung nach
/// Fristablauf“): der späteste von Fristablauf, Setzen der Frist (eine Frist in die
/// Vergangenheit) und Abschluss (eine Frist, die am aktiven Einsatz ablief) — höchstens `jetzt`.
/// Ohne bekannten Setzzeitpunkt `jetzt`. So
/// beginnt die Karenz nach einem Stillstand oder nach dem Rückspielen einer Sicherung von vor
/// der Vormerkung nicht neu. Liegt der Beginn 30 Tage oder mehr zurück, schwärzt Phase B im
/// selben Lauf.
pub async fn soft_delete_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    // Die Fälligkeit wird im UPDATE selbst noch einmal geprüft (LFH-23): eine Frist, die
    // zwischen Kandidatenliste und diesem Schreibvorgang verlängert wurde, gewinnt.
    // `MAX`/`MIN` vergleichen Text; alle Zeitpunkte stehen im Format von `zeit::formatiere_utc`.
    let karenz_beginn: Option<String> = sqlx::query_scalar(
        "UPDATE einsatz SET geloescht_at = CASE \
             WHEN retention_gesetzt_at IS NULL THEN ? \
             ELSE MIN(?, MAX(retention_bis, retention_gesetzt_at, COALESCE(abgeschlossen_at, ?))) END \
         WHERE id = ? AND status = ? AND geloescht_at IS NULL \
           AND retention_bis IS NOT NULL AND ? >= retention_bis \
         RETURNING geloescht_at",
    )
    .bind(jetzt)
    .bind(jetzt)
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(karenz_beginn) = karenz_beginn else {
        // Nichts zu tun (schon soft-gelöscht, nicht abgeschlossen oder nicht mehr fällig)
        // — kein Audit.
        return Ok(false);
    };
    // Der Karenz-Beginn in Zone und Darstellung des Einsatzes (LLH-1476).
    let audit = if karenz_beginn.as_str() < jetzt {
        format!(
            "Aufbewahrungsfrist abgelaufen — Einsatz zur Löschung vorgemerkt (Soft-Delete). \
             Die Karenz bis zur unwiderruflichen PII-Schwärzung läuft seit {}.",
            stil.zeitpunkt_text(&karenz_beginn)
        )
    } else {
        "Aufbewahrungsfrist abgelaufen — Einsatz zur Löschung vorgemerkt (Soft-Delete). \
         Die Karenz bis zur unwiderruflichen PII-Schwärzung läuft."
            .to_string()
    };
    system_audit_tx(&mut tx, einsatz_id, etb_startwert, &audit).await?;
    tx.commit().await?;
    Ok(true)
}

/// Hebt die Löschvormerkung eines Einsatzes während der Karenz auf und setzt im selben
/// Vorgang eine neue Frist (LFH-23, design.md D5). `neue_frist = None` heißt unbegrenzt.
///
/// Ohne neue Frist stünde `retention_bis` weiter in der Vergangenheit, und der nächste
/// Purge-Lauf merkte den Einsatz sofort wieder vor — deshalb ist sie Teil dieses einen
/// Aufrufs und keine zweite Anfrage. Der Aufrufer prüft, dass die Frist in der Zukunft
/// liegt, und den Archivzugriff (Org-Admin).
///
/// **Ein bewachtes UPDATE** (abgeschlossen, vorgemerkt, nicht geschwärzt, Karenz läuft:
/// `geloescht_at > jetzt − KARENZ_TAGE`, dieselbe Grenze wie
/// [`super::retention::karenz_abgelaufen`]) und der ETB-Eintrag des Admins in derselben
/// Transaktion. Gewinnt eine parallele Schwärzung, findet das UPDATE keine Zeile. Bei 0
/// Zeilen wird neu gelesen und eingeordnet: geschwärzt oder Karenz abgelaufen → 409
/// (endgültiger Lebenszyklus-Zustand, kein Rückweg), nicht vorgemerkt → 422 (die Frist
/// ändert man dort über `PUT …/aufbewahrungsfrist`), aktiv → 409, unbekannt → 404.
/// Keine Ablehnung schreibt. Liefert die Kennung des ETB-Eintrags für das `etb`-Ereignis
/// (LFH-858).
pub async fn wiederherstellen(
    pool: &SqlitePool,
    einsatz_id: i64,
    admin_id: i64,
    admin_org_id: i64,
    neue_frist: Option<&str>,
    jetzt: chrono::DateTime<Utc>,
) -> Result<i64, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    // Vormerkung und neue Frist im ETB in Zone und Darstellung des Einsatzes (LLH-1540).
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;
    // `write_retry!` (BEGIN IMMEDIATE, F09/LFH-240): der Körper liest vor dem Schreiben; in
    // einer verzögerten Transaktion bräche der Lock-Aufstieg bei jedem parallelen Schreiber
    // (etwa dem Purge-Lauf) sofort mit SQLITE_BUSY ab. Der Körper ist reine DB-Arbeit und
    // darf wiederholt werden.
    let karenz_grenze = super::retention::karenz_grenze(jetzt);
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    crate::write_retry!(pool, |conn| {
        let vorher: Option<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT org_id, status, geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?",
        )
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((org_id, status, geloescht_at, geschwaerzt_at)) = vorher else {
            return Err(AppError::NotFound);
        };
        // Die Org-Grenze hält das Schreiben selbst, nicht nur die Vorprüfung der Route
        // (Review LFH-23): der Admin einer fremden Org schreibt hier nie.
        if org_id != admin_org_id {
            return Err(AppError::Forbidden);
        }
        let res = sqlx::query(
            "UPDATE einsatz SET geloescht_at = NULL, retention_bis = ?, retention_gesetzt_at = ? \
             WHERE id = ? AND org_id = ? AND status = ? AND geloescht_at IS NOT NULL \
               AND geschwaerzt_at IS NULL AND geloescht_at > ?",
        )
        .bind(neue_frist)
        .bind(&jetzt_s)
        .bind(einsatz_id)
        .bind(admin_org_id)
        .bind(STATUS_ABGESCHLOSSEN)
        .bind(&karenz_grenze)
        .execute(&mut *conn)
        .await?;
        if res.rows_affected() == 0 {
            return Err(if status != STATUS_ABGESCHLOSSEN {
                AppError::Conflict("Einsatz ist nicht abgeschlossen".into())
            } else if geschwaerzt_at.is_some() {
                AppError::Conflict(
                    "Einsatz ist bereits geschwärzt — eine Wiederherstellung ist nicht mehr möglich"
                        .into(),
                )
            } else if geloescht_at.is_none() {
                AppError::UnprocessableEntity(
                    "Einsatz ist nicht zur Löschung vorgemerkt — die Frist ändert man über die \
                     Aufbewahrungsfrist"
                        .into(),
                )
            } else {
                AppError::Conflict(
                    "Die Karenz ist abgelaufen — eine Wiederherstellung ist nicht mehr möglich"
                        .into(),
                )
            });
        }
        let audit = format!(
            "Löschvormerkung vom {} aufgehoben (Wiederherstellung während der Karenz). \
             Aufbewahrungsfrist neu: {}",
            geloescht_at
                .as_deref()
                .map_or_else(|| "?".to_string(), |g| stil.zeitpunkt_text(g)),
            neue_frist.map_or_else(|| "unbegrenzt".to_string(), |f| stil.zeitpunkt_text(f)),
        );
        crate::etb::repo::anlegen_tx(
            &mut *conn,
            einsatz_id,
            admin_id,
            etb_startwert,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_SYSTEM,
                inhalt: &audit,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await
    })
}

/// Platzhalter für gescrubbte PII-Felder, die wegen NOT-NULL- bzw. CHECK-Constraints
/// nicht auf NULL gesetzt werden dürfen (verlaufsnotiz.text, einsatz_personal.snap_name,
/// einsatz_schaden.uebergeben_an bei status='uebergeben').
pub const SCHWAERZUNG_PLATZHALTER: &str = "[geschwärzt]";

/// Phase-B-Kandidaten: ABGESCHLOSSENE, soft-gelöschte, noch nicht geschwärzte
/// Einsätze, als `(id, geloescht_at)`. Die Karenz-Grenze (`geloescht_at + KARENZ_TAGE`)
/// prüft der Aufrufer in Rust (`retention::karenz_abgelaufen`) gegen das injizierte
/// `jetzt`. `status='abgeschlossen'` ist hart im WHERE — aktive Einsätze sind nie dabei.
pub async fn faellige_purge(
    pool: &SqlitePool,
    _karenz_tage: i64,
) -> Result<Vec<(i64, String)>, AppError> {
    // Spiegel bleiben aus (LLH-1492, design.md D10): sie enden mit dem Lebensende beim Führer
    // oder nach der Nachbereitung (`einsatz::abraeumen`, LLH-1494).
    let rows = sqlx::query_as::<_, (i64, String)>(sqlx::AssertSqlSafe(format!(
        "SELECT id, geloescht_at FROM einsatz \
         WHERE status = ? AND geloescht_at IS NOT NULL AND geschwaerzt_at IS NULL AND {} \
         ORDER BY id",
        super::spiegel_filter::nicht_gespiegelt("einsatz.id")
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Audit-Text einer Schwärzung des ganzen Einsatzes; `grund` steht in der Klammer
/// (Frist und Karenz bzw. das Löschersuchen mit Aktenzeichen, LFH-751).
pub(crate) fn schwaerzungs_audit(grund: &str) -> String {
    format!(
        "PII-Schwärzung durchgeführt ({grund}). \
         Direkte Personenidentifikatoren (Namen, Kontakt, Adresse, Meldebild/Einsatzort, \
         Foto-/Datei-Anhänge, Bilder der Lagekarte, personenbezogene Notizen, Schadens-/Lage-/Gefahren-Freitexte, \
         die Freitexte von Chat-Kanälen, Chat-Nachrichten und Erinnerungen sowie die \
         Freitexte der Führungsmodule (Meldungen, Aufträge, Nachforderungen, Lageberichte, \
         Befehle, Lagebesprechungen)) wurden unwiderruflich entfernt. \
         Erhalten bleiben das operative Skelett (Einsatz-Struktur, Zähler/registrier_nr, \
         operative Objekte, die Struktur von Chat, Erinnerungen und Führungsmodulen mit \
         Nummern, Zeitpunkten, Verfassern und Status), die Führungsdokumentation im ETB im \
         Wortlaut (auch ins ETB heraufgestufte Chat-Nachrichten) und anonymisierte \
         Triage-/Statuskategorien (ohne Personenbezug) für die gesetzliche/statistische \
         Aufbewahrung."
    )
}

/// Schwärzt einen abgeschlossenen, nicht geschwärzten Einsatz auf Antrag (Art. 17, LFH-751) —
/// auf der Transaktion des Aufrufers, unabhängig von Frist und Vormerkung. Setzt die
/// Vormerkung (falls noch nicht gesetzt) und `geschwaerzt_at` im selben bewachten UPDATE, damit
/// der Einsatz danach dieselbe Lesesperre und denselben Zustand trägt wie nach der
/// fristbasierten Schwärzung, und scrubbt aus derselben Registry. Den ETB-Eintrag schreibt der
/// Aufrufer (er kennt Aktenzeichen und Akteur). `false`, wenn der Guard keine Zeile trifft
/// (aktiv oder schon geschwärzt).
pub(crate) async fn schwaerze_einsatz_auf_antrag_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let res = sqlx::query(
        "UPDATE einsatz SET geloescht_at = COALESCE(geloescht_at, ?1), geschwaerzt_at = ?1 \
         WHERE id = ?2 AND status = ?3 AND geschwaerzt_at IS NULL",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *conn)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }
    scrubbe_einsatz_ganz_tx(conn, einsatz_id, jetzt).await?;
    Ok(true)
}

/// Nach jeder Schwärzung am Einsatz (Kategorie, Löschersuchen je Person, ganzer Einsatz), in der
/// Transaktion der Schwärzung: Die Bruchstelle (LLH-1641, E6) hält ganze Zeilen als JSON, und
/// welche Kategorie oder Person darin steht, sagt keine Spalte. Darum geht sie ganz. Die neue
/// Zufallsmarke `schwaerzung_marke` am Kopf reist mit der Lieferung zum Spiegel, der daran seine
/// eigene Bruchstelle räumt (LLH-1649, `instanz::spiegel::fuehrung::raeume_bruchstelle`). Jede
/// Marke merkt sich der Einsatz (`einsatz_schwaerzung_marke`): Bringt ein neuer Führer später
/// eine Marke, die diese Seite schon kannte, hat er seither nicht geschwärzt.
pub(crate) async fn nach_schwaerzung_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM einsatz_bruchstelle WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE einsatz SET schwaerzung_marke = lower(hex(randomblob(8))) WHERE id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO einsatz_schwaerzung_marke (einsatz_id, marke) \
         SELECT id, schwaerzung_marke FROM einsatz WHERE id = ?",
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Der Scrub einer Schwärzung des ganzen Einsatzes — für den fristbasierten Weg (Phase B) und den
/// Antrag (LFH-751) derselbe: alle Scrub-Spalten gleich welcher Zuordnung, die Tombstones jeder
/// Datenkategorie (LFH-749, design.md D5) und jeder offene Löschersuchen-Antrag als erfüllt, damit
/// im ETB keine Rücknahme bereits gelöschter Daten erscheint.
async fn scrubbe_einsatz_ganz_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    super::schwaerzung_registry::scrubbe_aus_registry(
        &mut *conn,
        einsatz_id,
        super::schwaerzung_registry::Umfang::Alles,
    )
    .await?;
    nach_schwaerzung_tx(&mut *conn, einsatz_id).await?;
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET geschwaerzt_at = ? \
         WHERE einsatz_id = ? AND geschwaerzt_at IS NULL",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE schwaerzung_antrag SET vollzogen_at = ? \
         WHERE einsatz_id = ? AND zurueckgenommen_at IS NULL AND vollzogen_at IS NULL",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// IRREVERSIBLE PII-Schwärzung eines Einsatzes (Phase B, LFH-135). Scrubbt die
/// Personendaten in allen einsatz-scoped PII-Tabellen (strikt einsatz-scoped, OHNE
/// `storniert_at`-Filter — auch stornierte Zeilen tragen reale PII), setzt den
/// `geschwaerzt_at`-Tombstone und schreibt einen System-ETB-Audit — alles in EINER
/// Transaktion (partieller Scrub rollt zurück). Das operative Skelett (Einsatz-Struktur,
/// ETB im Wortlaut, Zähler/registrier_nr, anonymisierte Triage) bleibt erhalten.
/// Chat- und Erinnerungs-Freitexte werden seit LFH-290 mitgeschwärzt, die Freitexte der
/// Führungsmodule (Meldung, Auftrag, Nachforderung, Lagebericht, Befehl, Lagebesprechung) seit
/// LFH-701: Die Führungsdokumentation ist allein der ETB-Wortlaut
/// (`etb_eintrag.inhalt`/`von`/`an` sind Retain), dort bleiben auch heraufgestufte
/// Chat-Nachrichten stehen.
///
/// Idempotent: der `geschwaerzt_at IS NULL`-Guard liefert `false`, wenn der Einsatz
/// schon geschwärzt (oder nicht soft-gelöscht/abgeschlossen) ist — kein Doppel-Scrub.
/// Ebenso `false`, solange die Karenz zu `jetzt` noch läuft (LFH-754): das UPDATE prüft sie
/// selbst, der Aufrufer muss sich nicht auf seine Kandidatenliste verlassen.
///
/// **Welche Spalte gescrubbt oder erhalten wird, entscheidet die zentrale Registry
/// `super::schwaerzung_registry`** (F02/LFH-229): sie taggt JEDE Spalte JEDER einsatz-
/// scoped Tabelle, ein Guard-Test erzwingt Vollständigkeit (neue PII-Spalte ⇒ ROT), und
/// [`super::schwaerzung_registry::scrubbe_aus_registry`] treibt den Scrub data-driven aus
/// denselben Konstanten (kein Guard↔Scrub-Drift). Der eigentliche Scrub steht dort, nicht
/// mehr hier als handgepflegte UPDATE-Liste.
///
/// Datei-Anhänge und Bilder der Lagekarte löscht der atomare Vorgang nicht selbst, er macht sie
/// nur unerreichbar; die Zeilen löscht danach
/// [`super::schwaerzung_nachlauf::entferne_vorgesehene`] je Zeile in einer eigenen Transaktion
/// (LFH-905, LFH-997, `Strategie::ZeileEinzelnLoeschen`). Scheitert dieser Nachlauf, bleibt
/// es beim `Ok(true)`: die Schwärzung steht, und der nächste Purge-Lauf holt die Reste nach.
pub async fn schwaerze_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let geschwaerzt = schwaerze_einsatz_atomar(pool, einsatz_id, jetzt).await?;
    if geschwaerzt {
        super::schwaerzung_nachlauf::nachlaufen(pool, einsatz_id).await;
    }
    Ok(geschwaerzt)
}

/// Der atomare Teil von [`schwaerze_einsatz`], ohne den Nachlauf der Anhänge.
pub(crate) async fn schwaerze_einsatz_atomar(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    // Ohne gültiges `jetzt` keine Grenze, also auch keine Schwärzung (fail-closed).
    let karenz_grenze = crate::zeit::parse_utc(jetzt)
        .map(super::retention::karenz_grenze)
        .ok_or_else(|| AppError::Internal(format!("Schwärzung: ungültiges jetzt {jetzt:?}")))?;
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;

    // Idempotenz-/Sicherheits-Guard: nur abgeschlossene, soft-gelöschte, noch nicht
    // geschwärzte Einsätze. Setzt zugleich den Tombstone. rows_affected==0 → fertig.
    // Die Karenz wird im UPDATE selbst noch einmal geprüft (LFH-754, dieselbe Grenze wie
    // `retention::karenz_abgelaufen`): wurde der Einsatz zwischen Kandidatenliste und diesem
    // Schreibvorgang wiederhergestellt und neu vorgemerkt, gewinnt die frische Vormerkung.
    let res = sqlx::query(
        "UPDATE einsatz SET geschwaerzt_at = ? \
         WHERE id = ? AND status = ? AND geloescht_at IS NOT NULL AND geschwaerzt_at IS NULL \
           AND geloescht_at <= ?",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(&karenz_grenze)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }

    // --- PII-Scrub: data-driven aus der zentralen Klassifikations-Registry (F02/LFH-229) ---
    // Kein storniert_at-Filter (auch stornierte Zeilen tragen reale PII). Jede einsatz-
    // scoped Spalte ist in `schwaerzung_registry::TABELLEN` als Scrub|Retain getaggt; ein
    // Guard-Test bricht ROT, sobald eine neue Spalte/Tabelle unklassifiziert bleibt. Die
    // UPDATE/DELETE-Statements entstehen aus denselben Registry-Konstanten → kein Drift
    // zwischen Guard und tatsächlichem Scrub (siehe schwaerzung_registry).
    scrubbe_einsatz_ganz_tx(&mut tx, einsatz_id, jetzt).await?;

    system_audit_tx(
        &mut tx,
        einsatz_id,
        etb_startwert,
        &schwaerzungs_audit("Aufbewahrungsfrist + Karenz abgelaufen"),
    )
    .await?;

    tx.commit().await?;
    tracing::warn!(
        einsatz_id,
        "Purge Phase B abgeschlossen: PII geschwärzt (geschwaerzt_at gesetzt)"
    );
    Ok(true)
}

/// Schwärzt einen Einsatz, dessen Archiv in derselben Transaktion entsteht (LLH-1494, D9), ohne
/// Karenz: die Karenz dient dem Wiederherstellen, und das geht jetzt über das Archiv. Setzt
/// Vormerkung und Tombstone zugleich, damit der Einsatz wie nach Phase B gesperrt ist und Phase A
/// ihn nicht noch einmal vormerkt. Bewacht wie Phase B: nur abgeschlossene, nicht vorgemerkte,
/// nicht geschwärzte Einsätze mit abgelaufener Nachbereitung; `false` = nichts zu tun. Den
/// Nachlauf der Anhänge startet der Aufrufer nach dem Commit.
pub(crate) async fn schwaerze_nach_archiv_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    etb_startwert: i64,
    jetzt: &str,
    grund: &str,
) -> Result<bool, AppError> {
    let res = sqlx::query(
        "UPDATE einsatz SET geloescht_at = ?1, geschwaerzt_at = ?1 \
         WHERE id = ?2 AND status = ?3 AND geloescht_at IS NULL AND geschwaerzt_at IS NULL \
           AND nachbereitung_bis IS NOT NULL AND nachbereitung_bis <= ?1",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *conn)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }
    scrubbe_einsatz_ganz_tx(&mut *conn, einsatz_id, jetzt).await?;
    system_audit_tx(
        &mut *conn,
        einsatz_id,
        etb_startwert,
        &schwaerzungs_audit(grund),
    )
    .await?;
    Ok(true)
}

/// Teil-Patch der editierbaren Kopf-Spalten (LFH-306, Tri-State): äußere `Option` = „im
/// Patch enthalten?", innere = Wert (`Some(None)` setzt die Spalte auf NULL). Die drei
/// NOT-NULL-Spalten (`bezeichnung`, `einsatzart`, `begonnen_at`) tragen nur die äußere
/// `Option` — sie lassen sich nicht leeren, nur setzen oder unberührt lassen.
#[derive(Debug, Default)]
pub struct KopfPatch<'a> {
    pub bezeichnung: Option<&'a str>,
    pub stichwort: Option<Option<&'a str>>,
    pub einsatzart: Option<&'a str>,
    // Keine `einsatznummer_intern`: die Einsatznummer vergibt das System beim Anlegen und
    // sie ist danach unveränderlich (LFH-617). Der Handler weist das Feld mit 400 ab.
    pub leitstellen_nr: Option<Option<&'a str>>,
    pub einsatzort: Option<Option<&'a str>>,
    pub einsatzort_lat: Option<Option<f64>>,
    pub einsatzort_lon: Option<Option<f64>>,
    pub meldende_stelle: Option<Option<&'a str>>,
    pub sachverhalt: Option<Option<&'a str>>,
    pub anzahl_betroffene_initial: Option<Option<i64>>,
    /// Bereits ins DB-Format normalisierte Alarmzeit.
    pub begonnen_at: Option<&'a str>,
    // Kein Termin der nächsten Lagebesprechung: den schreibt seit LLH-1111 nur das Modul
    // Lagebesprechung (`lagebesprechung::repo`). Der Handler weist das Feld mit 400 ab.
}

/// Teil-Patch der editierbaren Kopf-Spalten. Nicht-editierbare Spalten (status,
/// abgeschlossen_*, angelegt_at, org_id, id) bleiben unberührt — ebenso die Einsatznummer
/// (`einsatznummer_intern`, `nummer_jahr`, `nummer_lfd`), die nur `anlegen` schreibt (LFH-617).
///
/// Flag/Wert-Paare mit **nummerierten** Parametern (LFH-266/F12, Vorlage `person/repo.rs`).
/// Bei elf gleichtypigen Paaren ist die Nummerierung die eigentliche Absicherung: eine um
/// eine Position verschobene Bind-Kette vertauschte Nachbarspalten
/// (`meldende_stelle`↔`sachverhalt`, `einsatzort_lat`↔`einsatzort_lon`) STILL — ohne
/// Compile- und ohne Laufzeitfehler. Abgesichert von
/// `patche_kopf_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche_kopf(
    pool: &SqlitePool,
    einsatz_id: i64,
    patch: KopfPatch<'_>,
) -> Result<Einsatz, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einsatz SET \
            bezeichnung = CASE WHEN ?1 IS NULL THEN bezeichnung ELSE ?2 END, \
            stichwort = CASE WHEN ?3 IS NULL THEN stichwort ELSE ?4 END, \
            einsatzart = CASE WHEN ?5 IS NULL THEN einsatzart ELSE ?6 END, \
            leitstellen_nr = CASE WHEN ?7 IS NULL THEN leitstellen_nr ELSE ?8 END, \
            einsatzort = CASE WHEN ?9 IS NULL THEN einsatzort ELSE ?10 END, \
            einsatzort_lat = CASE WHEN ?11 IS NULL THEN einsatzort_lat ELSE ?12 END, \
            einsatzort_lon = CASE WHEN ?13 IS NULL THEN einsatzort_lon ELSE ?14 END, \
            meldende_stelle = CASE WHEN ?15 IS NULL THEN meldende_stelle ELSE ?16 END, \
            sachverhalt = CASE WHEN ?17 IS NULL THEN sachverhalt ELSE ?18 END, \
            anzahl_betroffene_initial = \
                CASE WHEN ?19 IS NULL THEN anzahl_betroffene_initial ELSE ?20 END, \
            begonnen_at = CASE WHEN ?21 IS NULL THEN begonnen_at ELSE ?22 END \
         WHERE id = ?23",
    )
    .bind(patch.bezeichnung.map(|_| 1_i64))
    .bind(patch.bezeichnung)
    .bind(patch.stichwort.map(|_| 1_i64))
    .bind(patch.stichwort.and_then(|v| v))
    .bind(patch.einsatzart.map(|_| 1_i64))
    .bind(patch.einsatzart)
    .bind(patch.leitstellen_nr.map(|_| 1_i64))
    .bind(patch.leitstellen_nr.and_then(|v| v))
    .bind(patch.einsatzort.map(|_| 1_i64))
    .bind(patch.einsatzort.and_then(|v| v))
    .bind(patch.einsatzort_lat.map(|_| 1_i64))
    .bind(patch.einsatzort_lat.and_then(|v| v))
    .bind(patch.einsatzort_lon.map(|_| 1_i64))
    .bind(patch.einsatzort_lon.and_then(|v| v))
    .bind(patch.meldende_stelle.map(|_| 1_i64))
    .bind(patch.meldende_stelle.and_then(|v| v))
    .bind(patch.sachverhalt.map(|_| 1_i64))
    .bind(patch.sachverhalt.and_then(|v| v))
    .bind(patch.anzahl_betroffene_initial.map(|_| 1_i64))
    .bind(patch.anzahl_betroffene_initial.and_then(|v| v))
    .bind(patch.begonnen_at.map(|_| 1_i64))
    .bind(patch.begonnen_at)
    .bind(einsatz_id)
    .execute(pool)
    .await;

    ergebnis?;

    laden(pool, einsatz_id).await
}

/// Die Personen, die sich in den Einsatz aufnehmen lassen (LFH-1141): aktive Personenkonten der
/// Organisation des Einsatzes ohne Mitgliedschaft, sortiert nach Anzeigename. Dieselbe Menge, die
/// `routes::einsatz::mitglied_setzen` und [`setze_mitgliedschaft`] annehmen (design.md D2); ein
/// Test nimmt jeden Eintrag auf (`tests/einsatz_mitglieder_auswahl.rs`).
pub async fn mitglied_auswahl(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAuswahl>, AppError> {
    let sql = format!(
        "SELECT b.id AS benutzer_id, b.anzeigename \
         FROM benutzer b JOIN einsatz e ON e.id = ? \
         WHERE b.org_id = e.org_id AND b.aktiv = 1 AND {} AND {} \
           AND NOT EXISTS (SELECT 1 FROM einsatz_mitgliedschaft m \
                           WHERE m.einsatz_id = e.id AND m.benutzer_id = b.id) \
         ORDER BY b.anzeigename COLLATE NOCASE, b.id",
        crate::geraet::repo::OHNE_GERAETEKONTEN,
        crate::instanz::spiegel::OHNE_STELLVERTRETER
    );
    Ok(
        sqlx::query_as::<_, MitgliedAuswahl>(sqlx::AssertSqlSafe(sql))
            .bind(einsatz_id)
            .fetch_all(pool)
            .await?,
    )
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    let mut liste = sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at, \
                m.fuehrungsstelle, m.fuehrungsfunktion \
         FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id \
         WHERE m.einsatz_id = ? \
         ORDER BY m.zugewiesen_at, m.benutzer_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    // Anzeige der Führungsstelle mit wirksamem Label (LFH-549).
    let karte = labelkarte(pool, einsatz_id).await?;
    for m in liste.iter_mut() {
        let angabe =
            crate::fuehrung::aus_spalten(m.fuehrungsfunktion.as_deref(), m.fuehrungsstelle.clone());
        m.fuehrungsstelle_anzeige = match angabe.funktion {
            Some(f) => Some(karte.anzeige(f, angabe.text.as_deref())),
            None => angabe.text,
        };
    }
    Ok(liste)
}

/// Setzt (oder aktualisiert) die Einsatz-Rolle eines Benutzers in einem Einsatz.
pub async fn setze_rolle(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
) -> Result<(), AppError> {
    setze_mitgliedschaft(pool, einsatz_id, benutzer_id, rolle, None)
        .await
        .map(|_| ())
}

/// Rolle und optional die Führungsstelle setzen. Fehlendes Feld erhält den Bestand; explizites
/// null löscht die Stelle. Liefert `true`, wenn die Person dabei neu aufgenommen wurde, `false`
/// bei einer bestehenden Mitgliedschaft (Rollenwechsel, Wiederholung). Daran hängt die
/// Benachrichtigung `einsatz_aufnahme` (`routes::einsatz::mitglied_setzen`): sie kommt genau
/// einmal je Aufnahme.
pub async fn setze_mitgliedschaft(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
    // `None` = Bestand behalten; `Some` setzt Code und Text als Paar (LFH-549), eine leere
    // Angabe leert beide.
    fuehrungsstelle: Option<&crate::fuehrung::Funktionsangabe>,
) -> Result<bool, AppError> {
    // Org-Guard IM SQL (F05/LFH-232), nicht im Handler: dies ist einer von nur zwei
    // produktiven INSERTs in `einsatz_mitgliedschaft` und damit ein Chokepoint der
    // Mandanten-Grenze. Eine org-fremde Mitgliedschaft würde die Isolation aus LFH-115
    // vollständig aushebeln — `darf_lesen` prüft bei vorhandener Rolle die Org nicht mehr.
    // Als `WHERE EXISTS` kann kein künftiger Aufrufer den Check vergessen; er steht im INSERT
    // und im UPDATE.
    // Ein Gerätekonto (LFH-892) ist nie Mitglied; seine Rolle kommt aus der Ansicht.
    //
    // Zwei Anweisungen statt eines UPSERT, damit feststeht, ob die Person neu ist: das
    // INSERT ändert nur ohne bestehende Zeile etwas, sonst greift das UPDATE. Unter zwei
    // gleichzeitigen Aufnahmen derselben Person gewinnt genau ein INSERT.
    let guard = format!(
        "EXISTS (SELECT 1 FROM benutzer b JOIN einsatz e ON e.id = ?1 \
                 WHERE b.id = ?2 AND b.org_id = e.org_id AND {} AND {})",
        crate::geraet::repo::OHNE_GERAETEKONTEN,
        crate::instanz::spiegel::OHNE_STELLVERTRETER
    );
    let eingefuegt = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO einsatz_mitgliedschaft \
            (einsatz_id, benutzer_id, einsatz_rolle, fuehrungsstelle, fuehrungsfunktion) \
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE {guard} \
         ON CONFLICT(einsatz_id, benutzer_id) DO NOTHING"
    )))
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .bind(fuehrungsstelle.and_then(|a| a.text.as_deref()))
    .bind(fuehrungsstelle.and_then(|a| a.funktion).map(|f| f.as_str()))
    .execute(pool)
    .await?
    .rows_affected();
    if eingefuegt > 0 {
        return Ok(true);
    }

    let betroffen = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = ?3, \
             fuehrungsstelle = CASE WHEN ?6 THEN ?4 ELSE fuehrungsstelle END, \
             fuehrungsfunktion = CASE WHEN ?6 THEN ?5 ELSE fuehrungsfunktion END \
         WHERE einsatz_id = ?1 AND benutzer_id = ?2 AND {guard}"
    )))
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .bind(fuehrungsstelle.and_then(|a| a.text.as_deref()))
    .bind(fuehrungsstelle.and_then(|a| a.funktion).map(|f| f.as_str()))
    .bind(fuehrungsstelle.is_some())
    .execute(pool)
    .await?
    .rows_affected();

    if betroffen == 0 {
        // `NotFound` statt `Forbidden`: aus Sicht dieses Einsatzes gibt es den Benutzer
        // nicht — die Existenz org-fremder Konten bleibt so unbeobachtbar (konsistent mit
        // dem bestehenden „Ziel-Benutzer unbekannt"-Pfad in `mitglied_setzen`).
        return Err(AppError::NotFound);
    }
    Ok(false)
}

/// Entfernt eine Mitgliedschaft (idempotent).
pub async fn entferne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?")
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Anzahl der Einsatzleitungen in einem Einsatz (für den „letzte Leitung"-Schutz).
pub async fn zaehle_einsatzleitung(pool: &SqlitePool, einsatz_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ?",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Riegel gegen den Lebenszyklus INNERHALB einer Schreibtransaktion.
///
/// `fordere_aktiv` läuft im Extractor und liest einen Stand von VOR der Transaktion.
/// `write_retry!` wartet bei BUSY am `BEGIN IMMEDIATE` mit Backoff — hält ein
/// konkurrierendes „Einsatz abschliessen" gerade den Schreib-Lock, wartet der Aufruf also
/// absichtlich, bis jenes committet hat, und schriebe danach in einen geschlossenen Einsatz.
/// Der Retry-Pfad VERBREITERT das Fenster, statt es zu schliessen.
///
/// 409 wie `fordere_aktiv` am Route-Gate (Lebenszyklus, src/AGENTS.md) — zwei Codes für dieselbe
/// Tatsache, unterschieden nur durch Timing, könnte ein Client nicht auseinanderhalten.
pub(crate) async fn fordere_aktiv_in_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<(), AppError> {
    // Führt eine andere Instanz, ist der Einsatz hier ein Spiegel; den Schutz tragen dessen
    // Trigger (LLH-1641, ADR-0018).
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    match status {
        Some(status) if status == "aktiv" => Ok(()),
        _ => Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        )),
    }
}

#[cfg(test)]
mod tests;
