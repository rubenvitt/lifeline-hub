//! Bild-Anlagen an Lagebericht und Befehl (LFH-1028, Spec `dokument-anlagen`).
//!
//! Eine Anlage ist ein fester Stand neben dem Text, als erstes die Fernmeldeskizze: der Browser
//! zeichnet ihre Druckform als PNG, der Server legt es über die gewöhnliche Anhang-Kette ab
//! (Endung, Größe, Virenscan, Bereinigung, Vorschau). Die Bytes liegen in `anhang`, die
//! Verknüpfung in einem Linker je Dokumentart ([`AnlagenTabelle`], Migration
//! `0157_dokument_anlage.sql`), registriert in `anhang::repo::MODUL_LINKER`.
//!
//! Anfügen und Entfernen gelingen nur im Entwurf; geprüft wird der Status im selben
//! Schreibvorgang, der die Anlage ändert. Entfernen löscht Datei und Linker hart: ein Entwurf
//! ist noch kein Beleg. Mit der Freigabe nennt der ETB-Eintrag die Anlagen
//! ([`snapshot_abschnitt`]), das Fortschreiben kopiert sie in die neue Version
//! ([`kopieren_tx`]). Fällt die Datei mit der Schwärzung (Einsatz oder Kategorie `anhaenge`),
//! verschwindet die Anlage aus Liste und Download; der ETB-Wortlaut bleibt.

use super::{Dokumentart, STATUS_ENTWURF};
use crate::einsatz::schwaerzung_nachlauf::zur_entfernung_vorgesehen_sql;
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{FromRow, SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Höchstzahl der Anlagen eines Dokuments (Spec: die elfte ist 409).
pub const MAX_ANLAGEN: i64 = 10;

/// Erlaubte Dateitypen einer Anlage. Der einzige Anwender (Fernmeldeskizze) erzeugt PNG; ein
/// späterer Anwender erweitert die Liste. SVG bleibt draußen (Skripte, externe Verweise, und
/// `anhang::metadaten` kann es nicht bereinigen).
pub const ERLAUBTE_MIME_ANLAGE: &[&str] = &["image/png"];

/// Linker einer Dokumentart auf `anhang`. Spalten: `id, einsatz_id, <dokument_spalte>,
/// anhang_id, art, titel, stand_at, reihenfolge, abgelegt_von_id, abgelegt_at`.
#[derive(Debug, PartialEq, Eq)]
pub struct AnlagenTabelle {
    /// Tabellenname des Linkers, z. B. `lagebericht_anlage`.
    pub tabelle: &'static str,
    /// Spalte am Linker, die auf das Dokument zeigt, z. B. `lagebericht_id`.
    pub dokument_spalte: &'static str,
}

wire_enum! {
    /// Art einer Anlage. Neue Art = neue Variante plus CHECK-Rebuild der beiden Linker.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AnlageArt {
        Fernmeldeskizze => "fernmeldeskizze",
    }
    try_from = |s| format!("Unbekannte Anlagen-Art «{s}»");
}

/// Eine Anlage auf dem Wire. `id` ist die **Linker-id**; die Datei ist nur über die Route des
/// Dokuments ladbar. `nummer` ist die Anlagen-Nummer (1, 2, …) in der Reihenfolge des Dokuments.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DokumentAnlageAnzeige {
    pub id: i64,
    pub dokument_id: i64,
    pub nummer: i64,
    pub art: AnlageArt,
    pub titel: String,
    /// Zeitpunkt der Aufnahme (SQLite-Zeit), derselbe, der im Bild als „Stand“ steht.
    pub stand_at: String,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    /// Anzeigename der ablegenden Person; fehlt, wenn das Konto nicht mehr existiert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

#[derive(Debug, FromRow)]
struct Zeile {
    id: i64,
    dokument_id: i64,
    art: String,
    titel: String,
    stand_at: String,
    dateiname: String,
    mime: String,
    groesse: i64,
    abgelegt_von_id: i64,
    abgelegt_von_name: Option<String>,
    abgelegt_at: String,
}

/// Eine neue Anlage, vom Handler geprüft (Typ, Größe, Scan, Titel, Zeit).
pub struct NeueAnlage<'a> {
    pub art: AnlageArt,
    pub titel: &'a str,
    pub stand_at: &'a str,
    pub dateiname: &'a str,
    pub mime: &'a str,
    pub daten: &'a [u8],
}

/// Die Anlagen-Tabelle der Art; eine Art ohne Anlagen (Pressemitteilung) → `NotFound`.
pub fn tabelle<T: Dokumentart>() -> Result<&'static AnlagenTabelle, AppError> {
    T::ANLAGEN.ok_or(AppError::NotFound)
}

/// Lebende Anlagen eines Dokuments in Reihenfolge. Eine zur Entfernung vorgesehene Datei
/// (Schwärzung) zählt nicht mehr.
fn select_sql(t: &AnlagenTabelle) -> String {
    format!(
        "SELECT l.id, l.{d} AS dokument_id, l.art, l.titel, l.stand_at, a.dateiname, a.mime, \
            a.groesse, l.abgelegt_von_id, bn.anzeigename AS abgelegt_von_name, l.abgelegt_at \
         FROM {tab} l \
         JOIN anhang a ON a.id = l.anhang_id \
         LEFT JOIN benutzer bn ON bn.id = l.abgelegt_von_id \
         WHERE l.einsatz_id = ? AND l.{d} = ? AND NOT {vorgesehen} \
         ORDER BY l.reihenfolge",
        tab = t.tabelle,
        d = t.dokument_spalte,
        vorgesehen = zur_entfernung_vorgesehen_sql("a"),
    )
}

fn zu_anzeige(nummer: i64, z: Zeile) -> Result<DokumentAnlageAnzeige, AppError> {
    let art = AnlageArt::parse(&z.art)
        .ok_or_else(|| AppError::Internal(format!("Anlagen-Art «{}» unbekannt", z.art)))?;
    Ok(DokumentAnlageAnzeige {
        id: z.id,
        dokument_id: z.dokument_id,
        nummer,
        art,
        titel: z.titel,
        stand_at: z.stand_at,
        dateiname: z.dateiname,
        mime: z.mime,
        groesse: z.groesse,
        abgelegt_von_id: z.abgelegt_von_id,
        abgelegt_von_name: z.abgelegt_von_name,
        abgelegt_at: z.abgelegt_at,
    })
}

async fn liste_auf(
    conn: &mut SqliteConnection,
    t: &AnlagenTabelle,
    einsatz_id: i64,
    dokument_id: i64,
) -> Result<Vec<DokumentAnlageAnzeige>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(select_sql(t)))
        .bind(einsatz_id)
        .bind(dokument_id)
        .fetch_all(&mut *conn)
        .await?;
    zeilen
        .into_iter()
        .zip(1..)
        .map(|(z, n)| zu_anzeige(n, z))
        .collect()
}

/// Status des Dokuments dieses Einsatzes; fremd oder unbekannt → `NotFound`.
async fn status<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    dokument_id: i64,
) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(format!(
        "SELECT status FROM {} WHERE id = ? AND einsatz_id = ?",
        T::TABELLE
    )))
    .bind(dokument_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie das Bearbeiten: nur im Entwurf, sonst 422.
async fn fordere_entwurf<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    dokument_id: i64,
) -> Result<(), AppError> {
    if status::<T>(conn, einsatz_id, dokument_id).await? != STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(format!(
            "Anlagen ändern sich nur {} im Entwurf",
            T::IM_NOMEN
        )));
    }
    Ok(())
}

/// Lebende Anlagen eines Dokuments dieses Einsatzes; fremd oder unbekannt → `NotFound`.
pub async fn liste<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    dokument_id: i64,
) -> Result<Vec<DokumentAnlageAnzeige>, AppError> {
    let t = tabelle::<T>()?;
    let mut conn = pool.acquire().await?;
    status::<T>(&mut conn, einsatz_id, dokument_id).await?;
    liste_auf(&mut conn, t, einsatz_id, dokument_id).await
}

/// `anhang_id` einer lebenden Anlage für den Download. Der Lookup IST die Zugriffsprüfung
/// (Einsatz, Dokument, Datei nicht zur Entfernung vorgesehen); sonst `NotFound`.
pub async fn anhang_id_fuer_download<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    dokument_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    let t = tabelle::<T>()?;
    sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
        "SELECT l.anhang_id FROM {tab} l JOIN anhang a ON a.id = l.anhang_id \
         WHERE l.id = ? AND l.einsatz_id = ? AND l.{d} = ? AND NOT {vorgesehen}",
        tab = t.tabelle,
        d = t.dokument_spalte,
        vorgesehen = zur_entfernung_vorgesehen_sql("a"),
    )))
    .bind(id)
    .bind(einsatz_id)
    .bind(dokument_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt Datei und Linker in EINER Transaktion an. Dokument fremd → `NotFound`, freigegeben →
/// 422, schon [`MAX_ANLAGEN`] Anlagen → 409; dann ohne jede Zeile. Liefert die neue Anlage.
pub async fn ablegen<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    dokument_id: i64,
    benutzer_id: i64,
    neu: &NeueAnlage<'_>,
) -> Result<DokumentAnlageAnzeige, AppError> {
    let t = tabelle::<T>()?;
    crate::write_retry!(pool, |conn| {
        fordere_entwurf::<T>(conn, einsatz_id, dokument_id).await?;
        let (anzahl, hoechste): (i64, Option<i64>) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*), MAX(reihenfolge) FROM {} WHERE {} = ?",
            t.tabelle, t.dokument_spalte
        )))
        .bind(dokument_id)
        .fetch_one(&mut *conn)
        .await?;
        if anzahl >= MAX_ANLAGEN {
            return Err(AppError::Conflict(format!(
                "Höchstens {MAX_ANLAGEN} Anlagen {}",
                T::IM_NOMEN
            )));
        }
        let anhang_id = crate::anhang::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            neu.dateiname,
            neu.mime,
            neu.daten,
        )
        .await?;
        let id: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {} (einsatz_id, {}, anhang_id, art, titel, stand_at, reihenfolge, \
                abgelegt_von_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            t.tabelle, t.dokument_spalte
        )))
        .bind(einsatz_id)
        .bind(dokument_id)
        .bind(anhang_id)
        .bind(neu.art.as_str())
        .bind(neu.titel)
        .bind(neu.stand_at)
        .bind(hoechste.unwrap_or(0) + 1)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        liste_auf(conn, t, einsatz_id, dokument_id)
            .await?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or(AppError::Internal(
                "Anlage nach dem Anlegen verschwunden".into(),
            ))
    })
}

/// Entfernt eine Anlage samt Datei, nur im Entwurf (sonst 422). Unbekannt, fremdes Dokument
/// oder fremder Einsatz → `NotFound`.
pub async fn entfernen<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    dokument_id: i64,
    id: i64,
) -> Result<(), AppError> {
    let t = tabelle::<T>()?;
    crate::write_retry!(pool, |conn| {
        fordere_entwurf::<T>(conn, einsatz_id, dokument_id).await?;
        let anhang_id: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT anhang_id FROM {} WHERE id = ? AND einsatz_id = ? AND {} = ?",
            t.tabelle, t.dokument_spalte
        )))
        .bind(id)
        .bind(einsatz_id)
        .bind(dokument_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        // Der Linker fällt per ON DELETE CASCADE mit der Datei.
        sqlx::query("DELETE FROM anhang WHERE id = ? AND einsatz_id = ?")
            .bind(anhang_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}

/// Kopiert jede lebende Anlage von `von_id` an `nach_id` (Fortschreiben, Spec „Anlagen beim
/// Fortschreiben“): neue `anhang`-Zeile mit denselben Bytes, neuer Linker mit gleicher Art,
/// gleichem Titel, Stand, Reihenfolge und gleicher ablegender Person. Eine Kopie statt eines
/// geteilten Verweises, weil `anhang_id` je Linker eindeutig ist und die Anlage des Vorgängers
/// unveränderlich bleiben muss. Öffnet und committet nichts.
pub async fn kopieren_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    von_id: i64,
    nach_id: i64,
) -> Result<(), AppError> {
    let Some(t) = T::ANLAGEN else {
        return Ok(());
    };
    let quellen: Vec<(i64, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT l.id, l.anhang_id FROM {tab} l JOIN anhang a ON a.id = l.anhang_id \
         WHERE l.einsatz_id = ? AND l.{d} = ? AND NOT {vorgesehen} ORDER BY l.reihenfolge",
        tab = t.tabelle,
        d = t.dokument_spalte,
        vorgesehen = zur_entfernung_vorgesehen_sql("a"),
    )))
    .bind(einsatz_id)
    .bind(von_id)
    .fetch_all(&mut *conn)
    .await?;
    for (linker_id, anhang_id) in quellen {
        let neu_anhang: i64 = sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                hochgeladen_von) \
             SELECT einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von \
             FROM anhang WHERE id = ? RETURNING id",
        )
        .bind(anhang_id)
        .fetch_one(&mut *conn)
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {tab} (einsatz_id, {d}, anhang_id, art, titel, stand_at, reihenfolge, \
                abgelegt_von_id, abgelegt_at) \
             SELECT einsatz_id, ?, ?, art, titel, stand_at, reihenfolge, abgelegt_von_id, \
                abgelegt_at FROM {tab} WHERE id = ?",
            tab = t.tabelle,
            d = t.dokument_spalte,
        )))
        .bind(nach_id)
        .bind(neu_anhang)
        .bind(linker_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Abschnitt „Anlagen“ für den ETB-Snapshot der Freigabe (Spec „Anlagen in Freigabe und
/// ETB“): je Anlage Nummer, Titel und Stand. Ohne Anlagen leer, der Snapshot bleibt dann
/// wortgleich wie vor LFH-1028.
pub async fn snapshot_abschnitt<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    dokument_id: i64,
) -> Result<String, AppError> {
    let Some(t) = T::ANLAGEN else {
        return Ok(String::new());
    };
    Ok(render_anlagen(
        &liste_auf(conn, t, einsatz_id, dokument_id).await?,
    ))
}

/// Deterministischer Wortlaut des Abschnitts „Anlagen“ (siehe [`snapshot_abschnitt`]).
pub fn render_anlagen(anlagen: &[DokumentAnlageAnzeige]) -> String {
    if anlagen.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n## Anlagen\n");
    for a in anlagen {
        out.push_str(&format!(
            "{}. {}, Stand {}\n",
            a.nummer, a.titel, a.stand_at
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::befehl::Befehl;
    use crate::lagebericht::Lagebericht;
    use crate::presse::mitteilung::Pressemitteilung;
    use crate::vorlagendokument::repo::{
        aktualisiere, anlegen, fortschreiben, freigeben_gerendert, laden, Patch,
    };
    use crate::vorlagendokument::{vorlage, Abschnittsart};

    /// Kleinstes gültiges PNG (1×1, transparent).
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, benutzer)
    }

    /// Entwurf der ersten Vorlage der Art, jeder Abschnitt mit Text (freigabefähig).
    async fn entwurf<T: Dokumentart>(pool: &SqlitePool, einsatz: i64, benutzer: i64) -> i64 {
        let v = &T::VORLAGEN[0];
        let d = anlegen::<T>(
            pool,
            einsatz,
            v.schluessel,
            "Dokument",
            "2026-10-08 12:00:00",
            benutzer,
            None,
        )
        .await
        .unwrap();
        let abschnitte: Vec<T::Abschnitt> = vorlage::<T>(v.schluessel)
            .unwrap()
            .abschnitte
            .iter()
            .map(|a| T::Abschnitt::neu(a.schluessel.into(), "Inhalt".into()))
            .collect();
        aktualisiere::<T>(
            pool,
            einsatz,
            d.id,
            Patch {
                abschnitte: Some(&abschnitte),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        d.id
    }

    fn skizze(stand: &str) -> NeueAnlage<'_> {
        NeueAnlage {
            art: AnlageArt::Fernmeldeskizze,
            titel: "Fernmeldeskizze",
            stand_at: stand,
            dateiname: "fernmeldeskizze.png",
            mime: "image/png",
            daten: PNG,
        }
    }

    async fn anhaenge(pool: &SqlitePool, einsatz: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn anfuegen_im_entwurf_fall<T: Dokumentart>() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<T>(&pool, einsatz, benutzer).await;

        let a = ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        assert_eq!(a.nummer, 1);
        assert_eq!(a.art, AnlageArt::Fernmeldeskizze);
        assert_eq!(a.stand_at, "2026-10-08 12:15:00");
        assert_eq!(a.abgelegt_von_name.as_deref(), Some("Leitung"));
        let b = ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:20:00"))
            .await
            .unwrap();
        assert_eq!(b.nummer, 2);

        let zwei = liste::<T>(&pool, einsatz, d).await.unwrap();
        assert_eq!(
            zwei.iter().map(|a| a.id).collect::<Vec<_>>(),
            vec![a.id, b.id]
        );
        let aid = anhang_id_fuer_download::<T>(&pool, einsatz, d, a.id)
            .await
            .unwrap();
        let bytes: Vec<u8> = sqlx::query_scalar("SELECT daten FROM anhang WHERE id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(bytes, PNG);

        // Entfernen der ersten: Datei weg, die zweite rückt auf Nummer 1.
        entfernen::<T>(&pool, einsatz, d, a.id).await.unwrap();
        let eine = liste::<T>(&pool, einsatz, d).await.unwrap();
        assert_eq!(eine.len(), 1);
        assert_eq!((eine[0].id, eine[0].nummer), (b.id, 1));
        assert_eq!(anhaenge(&pool, einsatz).await, 1);
    }

    #[tokio::test]
    async fn anfuegen_und_entfernen_im_entwurf() {
        anfuegen_im_entwurf_fall::<Lagebericht>().await;
        anfuegen_im_entwurf_fall::<Befehl>().await;
    }

    async fn nach_freigabe_unveraenderlich_fall<T: Dokumentart>() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<T>(&pool, einsatz, benutzer).await;
        let a = ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        freigeben_gerendert::<T>(&pool, einsatz, d, benutzer)
            .await
            .unwrap();

        let err = ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 13:00:00"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
        let err = entfernen::<T>(&pool, einsatz, d, a.id).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
        assert_eq!(liste::<T>(&pool, einsatz, d).await.unwrap().len(), 1);
        assert_eq!(anhaenge(&pool, einsatz).await, 1);
    }

    #[tokio::test]
    async fn nach_freigabe_sind_anlagen_unveraenderlich() {
        nach_freigabe_unveraenderlich_fall::<Lagebericht>().await;
        nach_freigabe_unveraenderlich_fall::<Befehl>().await;
    }

    #[tokio::test]
    async fn elfte_anlage_ist_409_ohne_rest() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<Befehl>(&pool, einsatz, benutzer).await;
        for _ in 0..MAX_ANLAGEN {
            ablegen::<Befehl>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
                .await
                .unwrap();
        }
        let err = ablegen::<Befehl>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(anhaenge(&pool, einsatz).await, MAX_ANLAGEN);
    }

    #[tokio::test]
    async fn fremder_einsatz_und_pressemitteilung_sind_404() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<Lagebericht>(&pool, einsatz, benutzer).await;
        let a = ablegen::<Lagebericht>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(matches!(
            liste::<Lagebericht>(&pool, fremd, d).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            anhang_id_fuer_download::<Lagebericht>(&pool, fremd, d, a.id).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            ablegen::<Lagebericht>(&pool, fremd, d, benutzer, &skizze("2026-10-08 12:15:00")).await,
            Err(AppError::NotFound)
        ));
        // Die Linker-id eines Lageberichts gilt nicht am Befehl gleicher id.
        assert!(matches!(
            entfernen::<Befehl>(&pool, einsatz, d, a.id).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            liste::<Pressemitteilung>(&pool, einsatz, d).await,
            Err(AppError::NotFound)
        ));
    }

    async fn freigabe_nennt_anlagen_fall<T: Dokumentart>() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<T>(&pool, einsatz, benutzer).await;
        ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        let dok = freigeben_gerendert::<T>(&pool, einsatz, d, benutzer)
            .await
            .unwrap();
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(dok.etb_eintrag_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            inhalt.ends_with("\n## Anlagen\n1. Fernmeldeskizze, Stand 2026-10-08 12:15:00\n"),
            "{inhalt}"
        );
    }

    #[tokio::test]
    async fn freigabe_nennt_anlagen_im_etb() {
        freigabe_nennt_anlagen_fall::<Lagebericht>().await;
        freigabe_nennt_anlagen_fall::<Befehl>().await;
    }

    #[tokio::test]
    async fn freigabe_ohne_anlagen_bleibt_wortgleich() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<Befehl>(&pool, einsatz, benutzer).await;
        let dok = freigeben_gerendert::<Befehl>(&pool, einsatz, d, benutzer)
            .await
            .unwrap();
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(dok.etb_eintrag_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(!inhalt.contains("Anlagen"), "{inhalt}");
    }

    async fn fortschreiben_kopiert_fall<T: Dokumentart>() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<T>(&pool, einsatz, benutzer).await;
        let a = ablegen::<T>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        freigeben_gerendert::<T>(&pool, einsatz, d, benutzer)
            .await
            .unwrap();

        let fort = fortschreiben::<T>(&pool, einsatz, d, benutzer, "2026-10-08 14:00:00")
            .await
            .unwrap();
        let neu = liste::<T>(&pool, einsatz, fort.id).await.unwrap();
        assert_eq!(neu.len(), 1);
        assert_ne!(neu[0].id, a.id);
        assert_eq!(
            (neu[0].art, neu[0].titel.as_str(), neu[0].stand_at.as_str()),
            (
                AnlageArt::Fernmeldeskizze,
                "Fernmeldeskizze",
                "2026-10-08 12:15:00"
            )
        );
        let neu_aid = anhang_id_fuer_download::<T>(&pool, einsatz, fort.id, neu[0].id)
            .await
            .unwrap();
        let alt_aid = anhang_id_fuer_download::<T>(&pool, einsatz, d, a.id)
            .await
            .unwrap();
        assert_ne!(neu_aid, alt_aid);

        // In der neuen Version entfernt: der Vorgänger trägt seine Anlage weiter.
        entfernen::<T>(&pool, einsatz, fort.id, neu[0].id)
            .await
            .unwrap();
        assert!(liste::<T>(&pool, einsatz, fort.id)
            .await
            .unwrap()
            .is_empty());
        let alt = liste::<T>(&pool, einsatz, d).await.unwrap();
        assert_eq!(alt.len(), 1);
        let bytes: Vec<u8> = sqlx::query_scalar("SELECT daten FROM anhang WHERE id = ?")
            .bind(alt_aid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(bytes, PNG);
        assert_eq!(laden::<T>(&pool, einsatz, d).await.unwrap().version, 1);
    }

    #[tokio::test]
    async fn fortschreiben_nimmt_anlagen_mit() {
        fortschreiben_kopiert_fall::<Lagebericht>().await;
        fortschreiben_kopiert_fall::<Befehl>().await;
    }

    #[tokio::test]
    async fn kategorie_anhaenge_entfernt_die_anlage_aber_nicht_den_etb_wortlaut() {
        let pool = crate::db::test_pool().await;
        let (einsatz, benutzer) = setup(&pool).await;
        let d = entwurf::<Befehl>(&pool, einsatz, benutzer).await;
        ablegen::<Befehl>(&pool, einsatz, d, benutzer, &skizze("2026-10-08 12:15:00"))
            .await
            .unwrap();
        let dok = freigeben_gerendert::<Befehl>(&pool, einsatz, d, benutzer)
            .await
            .unwrap();
        // Einsatz abgeschlossen, Kategorie `anhaenge` geschwärzt: die Datei ist zur Entfernung
        // vorgesehen, bis der Nachlauf sie löscht.
        sqlx::query("UPDATE einsatz SET status = ? WHERE id = ?")
            .bind(crate::einsatz::STATUS_ABGESCHLOSSEN)
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, rechtsgrundlage, \
                geschwaerzt_at) VALUES (?, 'anhaenge', 'Test', datetime('now'))",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        assert!(liste::<Befehl>(&pool, einsatz, d).await.unwrap().is_empty());
        crate::einsatz::schwaerzung_nachlauf::entferne_vorgesehene(&pool, Some(einsatz))
            .await
            .unwrap();
        let linker: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM befehl_anlage")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(linker, 0);
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(dok.etb_eintrag_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(inhalt.contains("1. Fernmeldeskizze, Stand"), "{inhalt}");
    }

    #[test]
    fn render_anlagen_ist_leer_ohne_anlagen() {
        assert_eq!(render_anlagen(&[]), "");
    }
}
