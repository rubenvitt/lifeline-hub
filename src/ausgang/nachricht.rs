//! Nachricht des Ausgangskorbs (LLH-2093, Spec Abschnitt 4): Betreff und Text als Schnappschuss
//! aus der freigegebenen Fassung bzw. der Nachforderung, die PNG-Anlagen und die fertige
//! RFC-5322-Nachricht.

use super::zustand::{AusgangFehler, QuelleArt};
use crate::error::AppError;
use crate::externe_stelle::KanalArt;
use crate::vorlagendokument::{anlage, repo as dokument_repo, Dokumentart};
use chrono::Utc;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::Message;
use sqlx::{SqliteConnection, SqlitePool};

/// Höchstsumme der Anhänge einer Nachricht (20 MiB).
pub const ANHANG_MAX_BYTES: usize = 20 * 1024 * 1024;

/// Betreff und Text, wie sie beim Anlegen des Versands im Korb gespeichert werden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schnappschuss {
    pub betreff: String,
    pub inhalt: String,
}

/// Die absendende Person für den Fuß der Nachricht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Absenderzeile {
    pub name: String,
    /// Kurzform der Führungsfunktion im Einsatz (wie im ETB, LFH-615); `None`, wenn keine.
    pub funktion: Option<String>,
}

/// Lädt Anzeigename und Führungsfunktion der absendenden Person auf der Verbindung.
pub async fn absender_laden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Absenderzeile, AppError> {
    let name: String = sqlx::query_scalar("SELECT anzeigename FROM benutzer WHERE id = ?")
        .bind(benutzer_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    let funktion = crate::einsatz::funktion::kurz_fuer(&mut *conn, einsatz_id, benutzer_id).await?;
    Ok(Absenderzeile { name, funktion })
}

async fn einsatz_name(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT bezeichnung FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Fuß: Leerzeile, Signaturtrenner `-- `, Einsatz, Absender, Herkunft und Zeit.
fn fuss(einsatz: &str, absender: &Absenderzeile, zeit: &str) -> String {
    let person = match &absender.funktion {
        Some(f) => format!("{} ({f})", absender.name),
        None => absender.name.clone(),
    };
    format!("\n-- \n{einsatz}\n{person}\nGesendet mit Lifeline Hub, {zeit}\n")
}

fn mit_fuss(inhalt: &str, einsatz: &str, absender: &Absenderzeile, zeit: &str) -> String {
    format!("{}\n{}", inhalt.trim_end(), fuss(einsatz, absender, zeit))
}

/// Schnappschuss eines Lageberichts oder Befehls. 422, wenn die Fassung nicht freigegeben oder
/// nicht die jüngste freigegebene ihrer Kette ist (Spec Abschnitt 3, „Quelle im richtigen
/// Zustand“); `NotFound`, wenn sie nicht zum Einsatz gehört. Der Text wird aus der Fassung neu
/// gerendert ([`dokument_repo::render_freigabe`]), nicht aus dem ETB gelesen.
pub async fn schnappschuss_dokument<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    absender: &Absenderzeile,
) -> Result<Schnappschuss, AppError> {
    let dok = dokument_repo::laden::<T>(&mut *conn, einsatz_id, id).await?;
    if dok.status != crate::vorlagendokument::STATUS_FREIGEGEBEN {
        return Err(AppError::UnprocessableEntity(format!(
            "{} ist nicht freigegeben und kann nicht gesendet werden",
            T::NOMEN_MIT_ARTIKEL
        )));
    }
    if !dokument_repo::is_juengste_freigabe::<T>(&mut *conn, einsatz_id, id).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "{} ist überholt; bitte die neue Fassung senden",
            T::NOMEN_MIT_ARTIKEL
        )));
    }
    let einsatz = einsatz_name(&mut *conn, einsatz_id).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?;
    let render = dokument_repo::render_freigabe::<T>(&mut *conn, einsatz_id, &dok).await?;
    // Lagebericht und Befehl tragen keine eigene Nummer je Einsatz: die Nummer im Betreff ist
    // die Version der Kette (1, 2, …).
    let nr = dok.version;
    let betreff = if T::TABELLE == "befehl" {
        format!("Einsatzbefehl Nr. {nr} – {einsatz}")
    } else {
        format!(
            "Lagebericht Nr. {nr} – {einsatz} – Stand {}",
            stil.zeitpunkt_text(&dok.zeitstand)
        )
    };
    let jetzt = stil.zeitpunkt(Utc::now());
    Ok(Schnappschuss {
        betreff,
        inhalt: mit_fuss(&render, &einsatz, absender, &jetzt),
    })
}

/// Schnappschuss einer Nachforderung. 422 bei `zurueckgezogen` und `abgelehnt`; `NotFound`,
/// wenn sie nicht zum Einsatz gehört.
pub async fn schnappschuss_nachforderung(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    absender: &Absenderzeile,
) -> Result<Schnappschuss, AppError> {
    use crate::nachforderung::{repo, NachforderungStatus};
    let n = repo::load(&mut *conn, id).await?;
    if n.einsatz_id != einsatz_id {
        return Err(AppError::NotFound);
    }
    if matches!(
        n.status,
        NachforderungStatus::Zurueckgezogen | NachforderungStatus::Abgelehnt
    ) {
        return Err(AppError::UnprocessableEntity(
            "Die Nachforderung ist zurückgezogen oder abgelehnt und kann nicht gesendet werden"
                .into(),
        ));
    }
    let einsatz = einsatz_name(&mut *conn, einsatz_id).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(&mut *conn, einsatz_id).await?;
    let ziel = repo::ziel_name_tx(
        &mut *conn,
        einsatz_id,
        repo::Ziel {
            br_id: n.ziel_br_id,
            abschnitt_id: n.ziel_abschnitt_id,
            text: n.ziel_text.as_deref(),
        },
    )
    .await?;
    let text = repo::mail_text(&n, &einsatz, ziel.as_deref(), &stil);
    let jetzt = stil.zeitpunkt(Utc::now());
    Ok(Schnappschuss {
        betreff: format!(
            "Nachforderung: {} – {einsatz}",
            repo::kurzname(n.anzahl, &n.art)
        ),
        inhalt: mit_fuss(&text, &einsatz, absender, &jetzt),
    })
}

/// Summe der Anhänge höchstens [`ANHANG_MAX_BYTES`], sonst [`AusgangFehler::ZuGross`].
pub fn pruefe_anhang_groesse(anhaenge: &[(String, Vec<u8>)]) -> Result<(), AusgangFehler> {
    let summe: usize = anhaenge.iter().map(|(_, d)| d.len()).sum();
    if summe > ANHANG_MAX_BYTES {
        return Err(AusgangFehler::ZuGross);
    }
    Ok(())
}

/// Fehler beim Laden der Anhänge: zu groß (mit Code des Ausgangskorbs) oder ein Fehler der
/// Datenbank.
#[derive(Debug)]
pub enum AnhangFehler {
    ZuGross,
    App(AppError),
}

impl From<AppError> for AnhangFehler {
    fn from(e: AppError) -> Self {
        Self::App(e)
    }
}

impl From<sqlx::Error> for AnhangFehler {
    fn from(e: sqlx::Error) -> Self {
        Self::App(e.into())
    }
}

fn pruefe_gespeicherte_summe(liste: &[anlage::DokumentAnlageAnzeige]) -> Result<(), AnhangFehler> {
    let summe: i64 = liste.iter().map(|a| a.groesse).sum();
    if summe > ANHANG_MAX_BYTES as i64 {
        return Err(AnhangFehler::ZuGross);
    }
    Ok(())
}

/// Prüft die Summe der Anlagen eines Dokuments an den gespeicherten Größen (`anhang.groesse`),
/// ohne ein Byte zu lesen: für das Anlegen eines Versands. Die echten Bytes prüft der Lauf beim
/// Zustellen ([`load_anhaenge`]).
pub async fn pruefe_anhaenge_gespeichert<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<(), AnhangFehler> {
    if T::ANLAGEN.is_none() {
        return Ok(());
    }
    let liste = anlage::liste::<T>(pool, einsatz_id, id).await?;
    pruefe_gespeicherte_summe(&liste)
}

/// Die PNG-Anlagen eines freigegebenen Dokuments als `(anlage-{n}.png, Bytes)` in der Reihenfolge
/// der Anlagen, bereinigt wie jeder Download (LFH-747; unbereinigbar → [`AnhangFehler::App`]).
/// Die Anlagen einer freigegebenen Fassung sind unveränderlich. Summe
/// über [`ANHANG_MAX_BYTES`] → [`AnhangFehler::ZuGross`] (der Aufrufer macht daraus 422 beim
/// Anlegen bzw. `zu_gross` im Lauf). Eine Art ohne Anlagen liefert eine leere Liste.
pub async fn load_anhaenge<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<Vec<(String, Vec<u8>)>, AnhangFehler> {
    if T::ANLAGEN.is_none() {
        return Ok(Vec::new());
    }
    let liste = anlage::liste::<T>(pool, einsatz_id, id).await?;
    // Vor dem Lesen der Bytes abbrechen.
    pruefe_gespeicherte_summe(&liste)?;
    let mut out = Vec::with_capacity(liste.len());
    for a in &liste {
        let anhang_id = anlage::anhang_id_fuer_download::<T>(pool, einsatz_id, id, a.id).await?;
        // Nach außen nur die bereinigte Fassung (src/AGENTS.md, „Anhänge“, LFH-747).
        let (_, daten) = crate::routes::support::anhang_bereinigt_kopieren(pool, anhang_id).await?;
        out.push((format!("anlage-{}.png", a.nummer), daten));
    }
    pruefe_anhang_groesse(&out).map_err(|_| AnhangFehler::ZuGross)?;
    Ok(out)
}

/// Die PNG-Anlagen der Quelle eines Versands (Nachforderung: keine).
pub async fn load_anhaenge_quelle(
    pool: &SqlitePool,
    quelle: QuelleArt,
    einsatz_id: i64,
    quelle_id: i64,
) -> Result<Vec<(String, Vec<u8>)>, AnhangFehler> {
    match quelle {
        QuelleArt::Lagebericht => {
            load_anhaenge::<crate::lagebericht::Lagebericht>(pool, einsatz_id, quelle_id).await
        }
        QuelleArt::Befehl => {
            load_anhaenge::<crate::befehl::Befehl>(pool, einsatz_id, quelle_id).await
        }
        QuelleArt::Nachforderung => Ok(Vec::new()),
    }
}

/// Was das PDF über Absender, Einsatz und Quelle braucht (LLH-2095, Spec Abschnitt 6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfKopf {
    /// Absenderkennung der Fax-Anbindung oder der Name der Organisation.
    pub absender: String,
    pub einsatz: String,
    pub uebung: bool,
    /// Version der Kette bei Lagebericht und Befehl, für den Dateinamen.
    pub version: Option<i64>,
}

/// Lädt den Kopf des PDFs. `absender_kennung` ohne Inhalt gilt als nicht gesetzt.
pub async fn pdf_kopf_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    quelle: QuelleArt,
    quelle_id: i64,
    absender_kennung: Option<&str>,
) -> Result<PdfKopf, AppError> {
    let mut conn = pool.acquire().await?;
    let (einsatz, art, org): (String, String, String) = sqlx::query_as(
        "SELECT e.bezeichnung, e.einsatzart, o.name FROM einsatz e \
         JOIN organisation o ON o.id = e.org_id WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let version = match quelle {
        QuelleArt::Lagebericht => Some(
            dokument_repo::laden::<crate::lagebericht::Lagebericht>(
                &mut *conn, einsatz_id, quelle_id,
            )
            .await?
            .version,
        ),
        QuelleArt::Befehl => Some(
            dokument_repo::laden::<crate::befehl::Befehl>(&mut *conn, einsatz_id, quelle_id)
                .await?
                .version,
        ),
        QuelleArt::Nachforderung => None,
    };
    let absender = absender_kennung
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map_or(org, str::to_string);
    Ok(PdfKopf {
        absender,
        einsatz,
        uebung: art == crate::einsatz::EINSATZART_UEBUNG,
        version,
    })
}

/// Die Zeile „An:“ des PDFs: Stelle und Adresse mit Kanal.
pub fn an_text(kanal: KanalArt, stelle: &str, adresse: &str) -> String {
    match kanal {
        KanalArt::Fax => format!("{stelle} (Fax {adresse})"),
        _ => format!("{stelle} ({adresse})"),
    }
}

/// Baut das PDF eines Versands aus Kopf, Schnappschuss und Anlagen.
pub fn baue_pdf_fuer(
    kopf: &PdfKopf,
    an: &str,
    betreff: &str,
    inhalt: &str,
    anlagen: &[(String, Vec<u8>)],
    erzeugt_at: chrono::DateTime<Utc>,
) -> Result<super::pdf::PdfDatei, super::pdf::PdfFehler> {
    super::pdf::baue_pdf(&super::pdf::PdfVorlage {
        absender: &kopf.absender,
        erzeugt_at,
        uebung: kopf.uebung,
        betreff,
        an,
        einsatz: &kopf.einsatz,
        inhalt,
        anlagen,
    })
}

/// Baut die Nachricht als RFC-5322-Bytes: `text/plain; charset=utf-8`, mit Anhängen als
/// `multipart/mixed` mit `image/png`. Betreff und Anzeigename kodiert lettre nach RFC 2047.
/// `message_id` steht mit den spitzen Klammern, wie sie in den Kopf kommen.
pub fn baue_mail(
    von_adresse: &str,
    von_name: Option<&str>,
    an: &str,
    message_id: &str,
    s: &Schnappschuss,
    anhaenge: &[(String, Vec<u8>)],
) -> Result<Vec<u8>, AusgangFehler> {
    fn fehler<E>(_: E) -> AusgangFehler {
        AusgangFehler::AnbindungFehler
    }
    let von = Mailbox::new(
        von_name.map(str::to_string),
        von_adresse.parse().map_err(fehler)?,
    );
    let an = Mailbox::new(None, an.parse().map_err(fehler)?);
    let builder = Message::builder()
        .from(von)
        .to(an)
        .subject(s.betreff.clone())
        .date_now()
        .message_id(Some(message_id.to_string()));
    let text = SinglePart::builder()
        .header(ContentType::parse("text/plain; charset=utf-8").map_err(fehler)?)
        .body(s.inhalt.clone());
    let png = ContentType::parse("image/png").map_err(fehler)?;
    let mail = if anhaenge.is_empty() {
        builder.singlepart(text)
    } else {
        let mut teile = MultiPart::mixed().singlepart(text);
        for (name, daten) in anhaenge {
            teile =
                teile.singlepart(Attachment::new(name.clone()).body(daten.clone(), png.clone()));
        }
        builder.multipart(teile)
    }
    .map_err(fehler)?;
    Ok(mail.formatted())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::befehl::Befehl;
    use crate::lagebericht::Lagebericht;
    use crate::vorlagendokument::repo as dokument_repo;
    use crate::vorlagendokument::{vorlage, Abschnittsart, Dokumentart};
    use base64::Engine;
    use sqlx::SqlitePool;

    struct Welt {
        pool: SqlitePool,
        einsatz_id: i64,
        benutzer_id: i64,
    }

    async fn welt() -> Welt {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Erika Muster', 'erika', 'x') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Hochwasser Süd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        Welt {
            pool,
            einsatz_id,
            benutzer_id,
        }
    }

    fn absender() -> Absenderzeile {
        Absenderzeile {
            name: "Erika Muster".into(),
            funktion: Some("S3".into()),
        }
    }

    /// Entwurf mit gefüllten Abschnitten.
    async fn entwurf<T: Dokumentart>(w: &Welt, vorlage_key: &str) -> i64 {
        let v = vorlage::<T>(vorlage_key).unwrap();
        let d = dokument_repo::anlegen::<T>(
            &w.pool,
            w.einsatz_id,
            vorlage_key,
            "Lage 10:00",
            "2026-06-02 10:00:00",
            w.benutzer_id,
            None,
        )
        .await
        .unwrap();
        let abschnitte: Vec<T::Abschnitt> = v
            .abschnitte
            .iter()
            .map(|a| T::Abschnitt::neu(a.schluessel.into(), "Pegel steigt".into()))
            .collect();
        dokument_repo::aktualisiere::<T>(
            &w.pool,
            w.einsatz_id,
            d.id,
            dokument_repo::Patch {
                abschnitte: Some(&abschnitte),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        d.id
    }

    async fn freigeben<T: Dokumentart>(w: &Welt, id: i64) {
        dokument_repo::freigeben_gerendert::<T>(&w.pool, w.einsatz_id, id, w.benutzer_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn render_freigabe_gleicht_etb_text() {
        let w = welt().await;
        let id = entwurf::<Lagebericht>(&w, "freitext").await;
        freigeben::<Lagebericht>(&w, id).await;
        let dok = dokument_repo::laden::<Lagebericht>(&w.pool, w.einsatz_id, id)
            .await
            .unwrap();
        let etb: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(dok.etb_eintrag_id.unwrap())
            .fetch_one(&w.pool)
            .await
            .unwrap();
        let mut conn = w.pool.acquire().await.unwrap();
        let text = dokument_repo::render_freigabe::<Lagebericht>(&mut conn, w.einsatz_id, &dok)
            .await
            .unwrap();
        assert_eq!(text, etb);
    }

    #[tokio::test]
    async fn ueberholte_fassung_ist_422() {
        let w = welt().await;
        let alt = entwurf::<Lagebericht>(&w, "freitext").await;
        freigeben::<Lagebericht>(&w, alt).await;
        let neu = dokument_repo::fortschreiben::<Lagebericht>(
            &w.pool,
            w.einsatz_id,
            alt,
            w.benutzer_id,
            "2026-06-02 11:00:00",
        )
        .await
        .unwrap()
        .id;
        freigeben::<Lagebericht>(&w, neu).await;
        let mut conn = w.pool.acquire().await.unwrap();
        let err = schnappschuss_dokument::<Lagebericht>(&mut conn, w.einsatz_id, alt, &absender())
            .await
            .unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::UnprocessableEntity(_)),
            "{err:?}"
        );
        let s = schnappschuss_dokument::<Lagebericht>(&mut conn, w.einsatz_id, neu, &absender())
            .await
            .unwrap();
        assert!(
            s.betreff
                .starts_with("Lagebericht Nr. 2 – Hochwasser Süd – Stand "),
            "{}",
            s.betreff
        );
        assert!(s.inhalt.contains("Pegel steigt"));
        assert!(s
            .inhalt
            .contains("\n\n-- \nHochwasser Süd\nErika Muster (S3)\nGesendet mit Lifeline Hub, "));
    }

    #[tokio::test]
    async fn entwurf_ist_422() {
        let w = welt().await;
        let id = entwurf::<Befehl>(&w, "befehl_lad").await;
        let mut conn = w.pool.acquire().await.unwrap();
        let err = schnappschuss_dokument::<Befehl>(&mut conn, w.einsatz_id, id, &absender())
            .await
            .unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::UnprocessableEntity(_)),
            "{err:?}"
        );
    }

    /// Entschlüsselt den Betreff (RFC 2047, Teile `b` oder `q`) aus den Mail-Bytes.
    fn betreff_aus(mail: &[u8]) -> String {
        let text = String::from_utf8_lossy(mail).replace("\r\n ", " ");
        let zeile = text
            .lines()
            .find(|l| l.starts_with("Subject:"))
            .expect("Subject")
            .trim_start_matches("Subject:")
            .trim()
            .to_string();
        let mut out: Vec<u8> = Vec::new();
        let mut vorher_kodiert = false;
        for (i, wort) in zeile.split(' ').filter(|w| !w.is_empty()).enumerate() {
            let kodiert = wort.starts_with("=?utf-8?");
            // Zwischen zwei kodierten Wörtern gehört das Leerzeichen nicht zum Text (RFC 2047).
            if i > 0 && !(kodiert && vorher_kodiert) {
                out.push(b' ');
            }
            vorher_kodiert = kodiert;
            if let Some(rest) = wort.strip_prefix("=?utf-8?") {
                let (kodierung, daten) = rest.split_once('?').unwrap();
                let daten = daten.trim_end_matches("?=");
                if kodierung.eq_ignore_ascii_case("b") {
                    out.extend(
                        base64::engine::general_purpose::STANDARD
                            .decode(daten)
                            .unwrap(),
                    );
                } else {
                    let b = daten.as_bytes();
                    let mut i = 0;
                    while i < b.len() {
                        match b[i] {
                            b'=' => {
                                out.push(u8::from_str_radix(&daten[i + 1..i + 3], 16).unwrap());
                                i += 3;
                            }
                            b'_' => {
                                out.push(b' ');
                                i += 1;
                            }
                            c => {
                                out.push(c);
                                i += 1;
                            }
                        }
                    }
                }
            } else {
                out.extend(wort.as_bytes());
            }
        }
        String::from_utf8(out).unwrap()
    }

    fn schnappschuss() -> Schnappschuss {
        Schnappschuss {
            betreff: "Lagebericht Nr. 1 – Hochwasser Süd – Stand 021000jun26".into(),
            inhalt: "# Lage\n\nÜberflutung Straße\n".into(),
        }
    }

    #[test]
    fn umlaute_in_betreff_und_name_sind_kodiert() {
        let mail = baue_mail(
            "lage@lifeline.example",
            Some("Einsatzleitung Süd"),
            "ils@example.org",
            "<ausgang-1@host.example>",
            &schnappschuss(),
            &[],
        )
        .unwrap();
        assert!(
            mail.is_ascii(),
            "Kopfzeilen und Text müssen ASCII-sicher kodiert sein"
        );
        assert_eq!(
            betreff_aus(&mail),
            "Lagebericht Nr. 1 – Hochwasser Süd – Stand 021000jun26"
        );
        let text = String::from_utf8_lossy(&mail);
        assert!(
            text.contains("Message-ID: <ausgang-1@host.example>"),
            "{text}"
        );
        assert!(
            text.contains("Content-Type: text/plain; charset=utf-8"),
            "{text}"
        );
        assert!(text.contains("\r\nDate: "), "{text}");
        assert!(!text.contains("Süd <"), "Anzeigename muss kodiert sein");
    }

    #[test]
    fn png_anlage_haengt_an() {
        let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
        let mail = baue_mail(
            "lage@lifeline.example",
            None,
            "ils@example.org",
            "<ausgang-2@host.example>",
            &schnappschuss(),
            &[("anlage-1.png".to_string(), png.clone())],
        )
        .unwrap();
        let text = String::from_utf8_lossy(&mail).to_lowercase();
        assert!(text.contains("multipart/mixed"), "{text}");
        assert!(text.contains("content-type: image/png"), "{text}");
        assert!(text.contains("filename=\"anlage-1.png\""), "{text}");
        let b64 = base64::engine::general_purpose::STANDARD
            .encode(&png)
            .to_lowercase();
        assert!(text.contains(&b64), "{text}");
    }

    #[tokio::test]
    async fn nachforderung_text_enthaelt_anzahl_bezeichnung_begruendung() {
        let w = welt().await;
        let n = crate::nachforderung::repo::create(
            &w.pool,
            w.einsatz_id,
            w.benutzer_id,
            crate::nachforderung::repo::NachforderungDaten {
                art: "RTW",
                bezeichnung: Some("Transport aus der UHS"),
                anzahl: Some(2),
                adressat_kategorie: "leitstelle",
                adressat_bezeichnung: Some("ILS Nord"),
                begruendung: Some("Pegel steigt weiter"),
                prioritaet: "dringend",
                angefordert_at: "2026-06-02 10:00:00",
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let mut conn = w.pool.acquire().await.unwrap();
        let s = schnappschuss_nachforderung(&mut conn, w.einsatz_id, n.id, &absender())
            .await
            .unwrap();
        assert_eq!(s.betreff, "Nachforderung: 2× RTW – Hochwasser Süd");
        assert!(s.inhalt.contains("2× RTW"), "{}", s.inhalt);
        assert!(s.inhalt.contains("Transport aus der UHS"));
        assert!(s.inhalt.contains("Pegel steigt weiter"));
        assert!(s.inhalt.contains("Dringend"));
        assert!(s.inhalt.contains("Leitstelle (ILS Nord)"));
        drop(conn);
        sqlx::query("UPDATE nachforderung SET status = 'zurueckgezogen' WHERE id = ?")
            .bind(n.id)
            .execute(&w.pool)
            .await
            .unwrap();
        let mut conn = w.pool.acquire().await.unwrap();
        let err = schnappschuss_nachforderung(&mut conn, w.einsatz_id, n.id, &absender())
            .await
            .unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::UnprocessableEntity(_)),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn anhaenge_ueber_20_mib_sind_zu_gross() {
        let a = vec![
            ("a.png".to_string(), vec![0u8; 11 * 1024 * 1024]),
            ("b.png".to_string(), vec![0u8; 10 * 1024 * 1024]),
        ];
        assert!(matches!(
            pruefe_anhang_groesse(&a),
            Err(AusgangFehler::ZuGross)
        ));
        assert!(pruefe_anhang_groesse(&a[..1]).is_ok());
    }
}
