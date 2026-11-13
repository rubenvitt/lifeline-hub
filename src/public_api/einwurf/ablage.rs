//! Die Ablage, in die ein Einwurf schreibt (Spec `einwurf-zugang`, design.md D2–D5 und D8).
//!
//! - **Alarmmeldungen** werden roh abgelegt: Abfrage und Body unverändert, dazu nur die
//!   Kennungen `external_id` und `message_id`. Die Deutung (Normalform, BOSWatch-Felder) macht
//!   ein Adapter (LLH-1192). Eine Wiederholung legt keinen zweiten Eintrag an, wird aber am
//!   bestehenden gezählt; still verworfen wird nichts.
//! - **Positionen** hängen an der Kennung, die der Absender mitschickt. Je Zugang und Kennung
//!   gibt es genau eine, ohne Verlauf.
//!
//! Niemand liest die Ablage über einen Einwurf-Schlüssel; die Leserouten kommen mit LLH-1192
//! und LLH-1199 und haben ihre eigene Anmeldung.

use chrono::{DateTime, Datelike, TimeDelta, Utc};
use sqlx::SqliteConnection;

use super::EinwurfZugang;
use crate::error::AppError;
use crate::public_api::{ApiError, ErrorCode};

/// Höchstgröße des Bodys eines Einwurfs. Kleiner als die v1-weite Grenze: Der Schlüssel steht in
/// einer URL und gelangt leichter in fremde Hände als ein privater Schlüssel.
pub const BODY_MAX: usize = 16 * 1024;
/// Höchstgröße der Abfrage eines Einwurfs.
pub const ABFRAGE_MAX: usize = 8 * 1024;
/// Höchstgröße der gespeicherten Rohdaten einer Alarmmeldung. JSON bläht Anführungs- und
/// Steuerzeichen auf (bis sechsfach); diese Grenze macht die Größe eines Eintrags trotzdem fest.
pub const ROHDATEN_MAX: usize = 48 * 1024;
/// So viele Zeichen von `Content-Type` werden mit abgelegt.
pub const INHALTSTYP_MAX: usize = 255;
/// Höchstlänge von `external_id` und `message_id` in Zeichen.
pub const KENNUNG_MAX: usize = 200;
/// Höchstlänge der Kennung einer Position in Zeichen.
pub const POSITION_KENNUNG_MAX: usize = 128;
/// Ohne Kennung gilt gleicher Inhalt desselben Zugangs so lange nach dem letzten Empfang als
/// Wiederholung.
pub const WIEDERHOLUNG_SEKUNDEN: i64 = 120;
/// So viele neue Alarmmeldungen speichert ein Zugang höchstens in 24 Stunden.
pub const ALARMMELDUNGEN_JE_TAG: i64 = 5_000;
/// So viele Kennungen können an einem Zugang zugleich eine Position haben.
pub const KENNUNGEN_JE_ZUGANG: i64 = 200;
/// So weit darf der Zeitstempel einer Position in der Zukunft liegen (Uhrtoleranz wie beim
/// Maschinenzugang). Darüber fröre ein Paket mit falscher Uhr die Position ein, weil alle
/// späteren als älter gälten.
pub const ZUKUNFT_SEKUNDEN: i64 = 300;

/// Was ein Absender geschickt hat, roh.
#[derive(Debug, Clone, Copy)]
pub struct Einwurf<'a> {
    /// Die Abfrage ohne `?`, wie sie in der URL stand; leer, wenn es keine gab.
    pub abfrage: &'a str,
    /// Wert von `Content-Type`, falls vorhanden.
    pub inhaltstyp: Option<&'a str>,
    pub body: &'a [u8],
}

fn ungueltig(text: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::InvalidField, text)
}

fn nicht_verarbeitbar(text: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::Unprocessable, text)
}

impl<'a> Einwurf<'a> {
    /// Prüft die Obergrenzen (413) und liefert den Body als Text (400, wenn er kein UTF-8 ist).
    fn body_text(&self) -> Result<&'a str, ApiError> {
        if self.body.len() > BODY_MAX || self.abfrage.len() > ABFRAGE_MAX {
            return Err(ApiError::from_code(ErrorCode::PayloadTooLarge));
        }
        std::str::from_utf8(self.body).map_err(|_| ungueltig("Der Body ist kein UTF-8-Text."))
    }

    fn medientyp(&self) -> &str {
        self.inhaltstyp
            .and_then(|t| t.split(';').next())
            .map(str::trim)
            .unwrap_or_default()
    }

    /// Die Paare der Abfrage in Empfangsreihenfolge.
    fn abfrage_paare(&self) -> Vec<(String, String)> {
        paare(self.abfrage.as_bytes())
    }

    /// Die Felder des Bodys, soweit er eine flache Struktur hat: Formularfelder, oder bei JSON
    /// die Zeichenketten und Zahlen auf oberster Ebene eines Objekts. Sonst leer.
    fn body_felder(&self, text: &str) -> Vec<(String, String)> {
        let typ = self.medientyp();
        if typ.eq_ignore_ascii_case("application/x-www-form-urlencoded") {
            return paare(text.as_bytes());
        }
        if typ.eq_ignore_ascii_case("application/json") {
            if let Ok(serde_json::Value::Object(objekt)) = serde_json::from_str(text) {
                return objekt
                    .into_iter()
                    .filter_map(|(name, wert)| match wert {
                        serde_json::Value::String(s) => Some((name, s)),
                        serde_json::Value::Number(n) => Some((name, n.to_string())),
                        _ => None,
                    })
                    .collect();
            }
        }
        Vec::new()
    }
}

fn paare(roh: &[u8]) -> Vec<(String, String)> {
    form_urlencoded::parse(roh)
        .map(|(name, wert)| (name.into_owned(), wert.into_owned()))
        .collect()
}

/// Löst `%XX` zu Bytes auf, wie `form_urlencoded`, aber ohne ungültige Folgen zu ersetzen.
fn percent_decode_bytes(roh: &str) -> Vec<u8> {
    let bytes = roh.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16).map(|z| z as u8);
    let mut aus = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes.get(i..i + 3) {
            Some([b'%', a, b]) if hex(*a).is_some() && hex(*b).is_some() => {
                aus.push(hex(*a).unwrap_or(0) * 16 + hex(*b).unwrap_or(0));
                i += 3;
            }
            _ => {
                aus.push(bytes[i]);
                i += 1;
            }
        }
    }
    aus
}

/// Ging beim Dekodieren etwas verloren? `form_urlencoded` ersetzt Bytes, die kein UTF-8 sind
/// (etwa `%F6` aus einem Latin-1-Absender), durch U+FFFD; die Bytes lassen sich aus den Paaren
/// dann nicht zurückgewinnen. Geprüft werden die dekodierten Bytes selbst, nicht das
/// Ersatzzeichen: Ein Absender darf U+FFFD schicken. `&` und `=` sind ASCII und trennen jede
/// Folge, die Prüfung über das Ganze gilt deshalb für jedes Paar.
fn is_verlustbehaftet(roh: &str) -> bool {
    std::str::from_utf8(&percent_decode_bytes(roh)).is_err()
}

/// Kam ein Wert des Felds `name` nicht als UTF-8 an? Wie [`is_verlustbehaftet`], aber nur für
/// dieses Feld: Ein anderes Feld derselben Abfrage ändert das Ergebnis nicht.
fn is_feld_verlustbehaftet(roh: &str, name: &str) -> bool {
    roh.split('&').any(|paar| {
        let (n, wert) = paar.split_once('=').unwrap_or((paar, ""));
        percent_decode_bytes(&n.replace('+', " ")) == name.as_bytes() && is_verlustbehaftet(wert)
    })
}

/// Hat ein Paar Inhalt? `?&` und `?=` sind eine Abfrage ohne Inhalt.
fn has_inhalt(paare: &[(String, String)]) -> bool {
    paare
        .iter()
        .any(|(name, wert)| !name.is_empty() || !wert.is_empty())
}

/// Der erste nicht leere Wert eines Felds; der Body geht der Abfrage vor.
fn feld<'f>(
    body: &'f [(String, String)],
    abfrage: &'f [(String, String)],
    name: &str,
) -> Option<&'f str> {
    body.iter()
        .chain(abfrage)
        .find(|(n, wert)| n == name && !wert.is_empty())
        .map(|(_, wert)| wert.as_str())
}

// ── Alarmmeldung ────────────────────────────────────────────────────────────────────────────

/// Eine Alarmmeldung, bereit für die Ablage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlarmInhalt {
    pub external_id: Option<String>,
    pub message_id: Option<String>,
    /// SHA-256 über die rohe Abfrage, ein Trennbyte und den Body. Keine Normalisierung: Derselbe
    /// Absender erzeugt bei einer Wiederholung dieselben Bytes, und alles Weitere wäre Deutung.
    pub inhalt_hash: String,
    /// JSON mit `abfrage` (dekodierte Paare), `abfrage_roh` (nur wenn das Dekodieren etwas
    /// verlor), `inhaltstyp` und `body`, je nur wenn vorhanden; höchstens [`ROHDATEN_MAX`].
    pub rohdaten: String,
}

/// Liest einen Einwurf als Alarmmeldung. Verlangt nichts, außer dass Abfrage oder Body nicht
/// leer sind (422).
pub fn alarm_inhalt(einwurf: &Einwurf<'_>) -> Result<AlarmInhalt, ApiError> {
    let body = einwurf.body_text()?;
    let abfrage = einwurf.abfrage_paare();
    if !has_inhalt(&abfrage) && body.is_empty() {
        return Err(nicht_verarbeitbar(
            "Der Einwurf ist leer: weder Abfrage noch Body.",
        ));
    }
    let body_felder = einwurf.body_felder(body);
    let kennung = |name: &str| -> Result<Option<String>, ApiError> {
        match feld(&body_felder, &abfrage, name) {
            Some(wert) if wert.chars().count() > KENNUNG_MAX => Err(ungueltig(format!(
                "{name}: höchstens {KENNUNG_MAX} Zeichen"
            ))),
            wert => Ok(wert.map(str::to_string)),
        }
    };
    let external_id = kennung("external_id")?;
    let message_id = kennung("message_id")?;

    let mut roh = serde_json::Map::new();
    if has_inhalt(&abfrage) {
        roh.insert("abfrage".into(), serde_json::json!(abfrage));
        // Unverändert heißt auch: nichts geht beim Dekodieren verloren. Kam die Abfrage nicht in
        // UTF-8 (FE2 oder ältere Skripte unter Windows), liegt sie zusätzlich roh dabei.
        if is_verlustbehaftet(einwurf.abfrage) {
            roh.insert("abfrage_roh".into(), serde_json::json!(einwurf.abfrage));
        }
    }
    if let Some(typ) = einwurf.inhaltstyp.filter(|t| !t.is_empty()) {
        let typ: String = typ.chars().take(INHALTSTYP_MAX).collect();
        roh.insert("inhaltstyp".into(), serde_json::json!(typ));
    }
    if !body.is_empty() {
        roh.insert("body".into(), serde_json::json!(body));
    }

    let mut bytes = Vec::with_capacity(einwurf.abfrage.len() + 1 + einwurf.body.len());
    bytes.extend_from_slice(einwurf.abfrage.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(einwurf.body);

    let rohdaten = serde_json::Value::Object(roh).to_string();
    if rohdaten.len() > ROHDATEN_MAX {
        return Err(ApiError::from_code(ErrorCode::PayloadTooLarge));
    }
    Ok(AlarmInhalt {
        external_id,
        message_id,
        inhalt_hash: crate::anhang::repo::sha256_hex(&bytes),
        rohdaten,
    })
}

/// Was das Ablegen einer Alarmmeldung ergab. Der Absender erfährt den Unterschied zwischen `Neu`
/// und `Wiederholung` nicht (beide 204).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlarmErgebnis {
    Neu,
    /// Am bestehenden Eintrag als erneut empfangen vermerkt.
    Wiederholung,
    /// Der Zugang hat [`ALARMMELDUNGEN_JE_TAG`] neue Einträge in 24 Stunden erreicht; nichts
    /// gespeichert und nichts vermerkt, auch für eine Wiederholung.
    Tagesgrenze,
}

/// `jetzt` minus `sekunden` im kanonischen Format.
fn vor(jetzt: &str, sekunden: i64) -> Result<String, AppError> {
    crate::zeit::parse(jetzt)
        .and_then(|t| t.checked_sub_signed(TimeDelta::try_seconds(sekunden)?))
        .map(crate::zeit::formatiere)
        .ok_or_else(|| AppError::Internal(format!("Zeitpunkt unlesbar: {jetzt}")))
}

/// Legt eine Alarmmeldung ab oder vermerkt sie als Wiederholung (design.md D4). Läuft in der
/// Transaktion des Aufrufers.
///
/// | Meldung trägt | Wiederholung, wenn derselbe Zugang schon hat | Zeitgrenze |
/// | --- | --- | --- |
/// | `message_id` | dieselbe `external_id` (auch beide leer) und `message_id` | keine |
/// | nur `external_id` | dieselbe `external_id` und denselben Inhalt | keine |
/// | keine Kennung | denselben Inhalt ohne Kennung, letzter Empfang ≤ 120 s her | 2 Minuten |
pub async fn alarmmeldung_ablegen(
    conn: &mut SqliteConnection,
    zugang: &EinwurfZugang,
    inhalt: &AlarmInhalt,
    jetzt: &str,
) -> Result<AlarmErgebnis, AppError> {
    // Die Tagesgrenze zuerst: Ist sie erreicht, bekommt jeder Einwurf dieselbe Antwort (429),
    // auch eine Wiederholung. Sonst verriete die Antwort, ob eine Kennung oder ein Inhalt schon
    // in der Ablage liegt (Spec: neu und wiederholt sind nicht zu unterscheiden).
    let heute: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM alarmmeldung WHERE zugang_id = ? AND empfangen_at > ?",
    )
    .bind(&zugang.id)
    .bind(vor(jetzt, 24 * 3600)?)
    .fetch_one(&mut *conn)
    .await?;
    if heute >= ALARMMELDUNGEN_JE_TAG {
        return Ok(AlarmErgebnis::Tagesgrenze);
    }

    let mut frueher_id: Option<i64> = None;
    let wiederholung: Option<i64> = if let Some(message_id) = &inhalt.message_id {
        sqlx::query_scalar(
            "SELECT id FROM alarmmeldung WHERE zugang_id = ? AND message_id = ? \
             AND external_id IS ? ORDER BY id LIMIT 1",
        )
        .bind(&zugang.id)
        .bind(message_id)
        .bind(&inhalt.external_id)
        .fetch_optional(&mut *conn)
        .await?
    } else if let Some(external_id) = &inhalt.external_id {
        sqlx::query_scalar(
            "SELECT id FROM alarmmeldung WHERE zugang_id = ? AND external_id = ? \
             AND message_id IS NULL AND inhalt_hash = ? ORDER BY id LIMIT 1",
        )
        .bind(&zugang.id)
        .bind(external_id)
        .bind(&inhalt.inhalt_hash)
        .fetch_optional(&mut *conn)
        .await?
    } else {
        // Gleitendes Fenster: gemessen ab dem letzten Empfang, nicht ab dem ersten. Ein Absender,
        // der jede Minute wiederholt, erzeugt so einen Eintrag mit Zähler.
        let letzter: Option<(i64, String)> = sqlx::query_as(
            "SELECT id, COALESCE(erneut_empfangen_at, empfangen_at) FROM alarmmeldung \
             WHERE zugang_id = ? AND external_id IS NULL AND message_id IS NULL \
             AND inhalt_hash = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(&zugang.id)
        .bind(&inhalt.inhalt_hash)
        .fetch_optional(&mut *conn)
        .await?;
        let grenze = vor(jetzt, WIEDERHOLUNG_SEKUNDEN)?;
        match letzter {
            Some((id, zuletzt)) if zuletzt >= grenze => Some(id),
            Some((id, _)) => {
                frueher_id = Some(id);
                None
            }
            None => None,
        }
    };

    if let Some(id) = wiederholung {
        sqlx::query(
            "UPDATE alarmmeldung SET erneut_empfangen_anzahl = erneut_empfangen_anzahl + 1, \
             erneut_empfangen_at = ? WHERE id = ?",
        )
        .bind(jetzt)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        return Ok(AlarmErgebnis::Wiederholung);
    }

    sqlx::query(
        "INSERT INTO alarmmeldung (org_id, zugang_id, external_id, message_id, inhalt_hash, \
         rohdaten, empfangen_at, frueher_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(zugang.org_id)
    .bind(&zugang.id)
    .bind(&inhalt.external_id)
    .bind(&inhalt.message_id)
    .bind(&inhalt.inhalt_hash)
    .bind(&inhalt.rohdaten)
    .bind(jetzt)
    .bind(frueher_id)
    .execute(&mut *conn)
    .await?;
    Ok(AlarmErgebnis::Neu)
}

// ── Position ────────────────────────────────────────────────────────────────────────────────

/// Eine Position, bereit für die Ablage.
#[derive(Debug, Clone, PartialEq)]
pub struct PositionInhalt {
    /// Kennung des Absenders (OsmAnd: `id`, Traccar auch `deviceid`).
    pub kennung: String,
    pub lat: f64,
    pub lon: f64,
    /// Zeitstempel des Absenders in `zeit::FORMAT` (UTC); ohne ihn die Empfangszeit.
    pub gemessen_at: String,
    /// JSON der übrigen Felder des Absenders (Geschwindigkeit, Richtung …).
    pub rohdaten: String,
}

const FELDER_POSITION: [&str; 5] = ["id", "deviceid", "lat", "lon", "timestamp"];

fn koordinate(wert: Option<&str>, name: &str, grenze: f64) -> Result<f64, ApiError> {
    let wert = wert.ok_or_else(|| ungueltig(format!("{name} fehlt")))?;
    wert.trim()
        .parse::<f64>()
        .ok()
        .filter(|zahl| zahl.is_finite() && zahl.abs() <= grenze)
        .ok_or_else(|| {
            ungueltig(format!(
                "{name}: Zahl zwischen -{grenze} und {grenze} erwartet"
            ))
        })
}

/// Liest den Zeitstempel einer Position: Unix-Sekunden, Unix-Millisekunden (ab 10¹¹), RFC 3339
/// oder das kanonische Format (UTC).
fn zeitstempel(roh: &str) -> Option<DateTime<Utc>> {
    let roh = roh.trim();
    if let Ok(zahl) = roh.parse::<f64>() {
        if !zahl.is_finite() {
            return None;
        }
        let sekunden = if zahl.abs() >= 1e11 {
            zahl / 1000.0
        } else {
            zahl
        };
        return DateTime::from_timestamp(sekunden.floor() as i64, 0);
    }
    DateTime::parse_from_rfc3339(roh)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| crate::zeit::parse_utc(roh))
}

/// Liest einen Einwurf als Position. `jetzt` in `zeit::FORMAT`.
pub fn position_inhalt(einwurf: &Einwurf<'_>, jetzt: &str) -> Result<PositionInhalt, ApiError> {
    let body = einwurf.body_text()?;
    let abfrage = einwurf.abfrage_paare();
    let body_felder = einwurf.body_felder(body);
    let lies = |name: &str| feld(&body_felder, &abfrage, name);

    let kennung = lies("id")
        .or_else(|| lies("deviceid"))
        .ok_or_else(|| ungueltig("id fehlt"))?;
    // Eine Kennung, die nicht als UTF-8 ankam, fiele mit anderen zusammen (`L%F6sch1` und
    // `L%FCsch1` würden beide zu `L\u{FFFD}sch1`) und überschriebe deren Position.
    // Ein JSON-Body ist immer UTF-8; bei ihm findet die Suche nach `id=` kein Feld.
    if ["id", "deviceid"].iter().any(|name| {
        is_feld_verlustbehaftet(einwurf.abfrage, name) || is_feld_verlustbehaftet(body, name)
    }) {
        return Err(ungueltig("id: kein gültiges UTF-8"));
    }
    if kennung.chars().count() > POSITION_KENNUNG_MAX {
        return Err(ungueltig(format!(
            "id: höchstens {POSITION_KENNUNG_MAX} Zeichen"
        )));
    }
    let lat = koordinate(lies("lat"), "lat", 90.0)?;
    let lon = koordinate(lies("lon"), "lon", 180.0)?;

    let jetzt_utc = crate::zeit::parse_utc(jetzt).ok_or_else(|| {
        ApiError::from(AppError::Internal(format!("Zeitpunkt unlesbar: {jetzt}")))
    })?;
    let gemessen = match lies("timestamp") {
        None => jetzt_utc,
        Some(roh) => {
            let t = zeitstempel(roh)
                .filter(|t| crate::zeit::JAHRE.contains(&t.year()))
                .ok_or_else(|| {
                    ungueltig("timestamp: Unix-Sekunden, Unix-Millisekunden oder RFC 3339 erwartet")
                })?;
            if (t - jetzt_utc).num_seconds() > ZUKUNFT_SEKUNDEN {
                return Err(nicht_verarbeitbar(
                    "timestamp liegt mehr als 5 Minuten in der Zukunft.",
                ));
            }
            t
        }
    };

    let uebrige: Vec<&(String, String)> = body_felder
        .iter()
        .chain(&abfrage)
        .filter(|(name, _)| !FELDER_POSITION.contains(&name.as_str()))
        .collect();
    Ok(PositionInhalt {
        kennung: kennung.to_string(),
        lat,
        lon,
        gemessen_at: crate::zeit::formatiere_utc(gemessen),
        rohdaten: serde_json::json!({ "felder": uebrige }).to_string(),
    })
}

/// Was das Ablegen einer Position ergab. `Uebernommen` und `Aelter` antworten beide mit 204.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionErgebnis {
    Uebernommen,
    /// Die gespeicherte Position derselben Kennung ist jünger; nichts geändert.
    Aelter,
    /// Der Zugang hält schon [`KENNUNGEN_JE_ZUGANG`] Kennungen; nichts gespeichert.
    ZuVieleKennungen,
}

/// Ersetzt die letzte Position der Kennung, wenn die neue nicht älter ist. Kein Verlauf: Die
/// vorige Position ist danach nirgends mehr gespeichert. Läuft in der Transaktion des Aufrufers.
pub async fn position_ablegen(
    conn: &mut SqliteConnection,
    zugang: &EinwurfZugang,
    inhalt: &PositionInhalt,
    jetzt: &str,
) -> Result<PositionErgebnis, AppError> {
    let (bekannt, kennungen): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(kennung = ?2), 0), COUNT(*) FROM position_letzte \
         WHERE zugang_id = ?1",
    )
    .bind(&zugang.id)
    .bind(&inhalt.kennung)
    .fetch_one(&mut *conn)
    .await?;
    if bekannt == 0 && kennungen >= KENNUNGEN_JE_ZUGANG {
        return Ok(PositionErgebnis::ZuVieleKennungen);
    }
    let n = sqlx::query(
        "INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
         empfangen_at, rohdaten) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (zugang_id, kennung) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, \
         gemessen_at = excluded.gemessen_at, empfangen_at = excluded.empfangen_at, \
         rohdaten = excluded.rohdaten \
         WHERE excluded.gemessen_at >= position_letzte.gemessen_at",
    )
    .bind(zugang.org_id)
    .bind(&zugang.id)
    .bind(&inhalt.kennung)
    .bind(inhalt.lat)
    .bind(inhalt.lon)
    .bind(&inhalt.gemessen_at)
    .bind(jetzt)
    .bind(&inhalt.rohdaten)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(if n > 0 {
        PositionErgebnis::Uebernommen
    } else {
        PositionErgebnis::Aelter
    })
}

#[cfg(test)]
mod tests {
    use super::super::tests::{neuer_zugang, JETZT};
    use super::*;
    use crate::db;
    use crate::public_api::scope::Scope;
    use axum::http::StatusCode;
    use serde_json::{json, Value};
    use sqlx::SqlitePool;

    fn abfrage(abfrage: &str) -> Einwurf<'_> {
        Einwurf {
            abfrage,
            inhaltstyp: None,
            body: b"",
        }
    }

    fn body<'a>(inhaltstyp: &'a str, body: &'a str) -> Einwurf<'a> {
        Einwurf {
            abfrage: "",
            inhaltstyp: Some(inhaltstyp),
            body: body.as_bytes(),
        }
    }

    fn roh(inhalt: &AlarmInhalt) -> Value {
        serde_json::from_str(&inhalt.rohdaten).unwrap()
    }

    // ── Alarmmeldung lesen ──

    #[test]
    fn abfrage_landet_unveraendert_in_den_rohdaten() {
        let inhalt = alarm_inhalt(&abfrage("ric=1234567&subric=a&text=B2%20Wohnung")).unwrap();
        assert_eq!(
            roh(&inhalt),
            json!({ "abfrage": [["ric", "1234567"], ["subric", "a"], ["text", "B2 Wohnung"]] })
        );
        assert_eq!((inhalt.external_id, inhalt.message_id), (None, None));
        assert_eq!(inhalt.inhalt_hash.len(), 64);
    }

    #[test]
    fn json_body_bleibt_text_und_liefert_die_kennungen() {
        let text = r#"{"external_id": "LS-1", "message_id": 7, "stichwort": "RD 2"}"#;
        let inhalt = alarm_inhalt(&body("application/json; charset=utf-8", text)).unwrap();
        assert_eq!(inhalt.external_id.as_deref(), Some("LS-1"));
        assert_eq!(inhalt.message_id.as_deref(), Some("7"), "Zahl als Text");
        assert_eq!(
            roh(&inhalt),
            json!({ "inhaltstyp": "application/json; charset=utf-8", "body": text })
        );
    }

    #[test]
    fn formular_body_zaehlt_wie_die_abfrage_und_geht_ihr_vor() {
        let einwurf = Einwurf {
            abfrage: "external_id=aus-abfrage&message_id=m1",
            inhaltstyp: Some("application/x-www-form-urlencoded"),
            body: b"external_id=aus-body&text=Brand",
        };
        let inhalt = alarm_inhalt(&einwurf).unwrap();
        assert_eq!(inhalt.external_id.as_deref(), Some("aus-body"));
        assert_eq!(inhalt.message_id.as_deref(), Some("m1"));
    }

    #[test]
    fn unlesbares_json_wird_als_text_abgelegt() {
        let inhalt = alarm_inhalt(&body("application/json", "{kaputt")).unwrap();
        assert_eq!(roh(&inhalt)["body"], "{kaputt");
        assert_eq!(inhalt.external_id, None);
    }

    #[test]
    fn fremder_inhaltstyp_wird_nicht_nach_kennungen_durchsucht() {
        let inhalt = alarm_inhalt(&body("text/xml", "<a external_id=\"x\"/>")).unwrap();
        assert_eq!(inhalt.external_id, None);
        assert_eq!(roh(&inhalt)["inhaltstyp"], "text/xml");
    }

    #[test]
    fn leere_kennung_gilt_als_keine() {
        let inhalt = alarm_inhalt(&abfrage("external_id=&text=x")).unwrap();
        assert_eq!(inhalt.external_id, None);
    }

    #[test]
    fn leerer_einwurf_ist_422() {
        // Auch eine Abfrage ohne Inhalt ist leer: nur Trenner, nur ein Gleichheitszeichen.
        for leer in ["", "&", "&&", "=", "=&="] {
            let fehler = alarm_inhalt(&abfrage(leer)).unwrap_err();
            assert_eq!(fehler.status, StatusCode::UNPROCESSABLE_ENTITY, "{leer:?}");
            assert_eq!(fehler.code, ErrorCode::Unprocessable);
        }
        // Ein Name ohne Wert und ein Wert ohne Name sind Inhalt.
        assert!(alarm_inhalt(&abfrage("alarm")).is_ok());
        assert!(alarm_inhalt(&abfrage("=Brand")).is_ok());
    }

    /// „Unverändert“ gilt auch für eine Abfrage, die nicht in UTF-8 kam: Die Paare tragen dann
    /// das Ersatzzeichen, und die rohe Abfrage liegt dabei.
    #[test]
    fn abfrage_ohne_utf8_liegt_zusaetzlich_roh_dabei() {
        let latin1 = "text=Brand%20K%F6ln&ric=1";
        let inhalt = alarm_inhalt(&abfrage(latin1)).unwrap();
        let roh = roh(&inhalt);
        assert_eq!(roh["abfrage"][0][1], "Brand K\u{FFFD}ln");
        assert_eq!(roh["abfrage_roh"], latin1);

        // Gültiges UTF-8 braucht die Rohform nicht, auch wenn der Absender selbst U+FFFD schickt.
        for utf8 in ["text=Brand%20K%C3%B6ln", "text=%EF%BF%BD", "text=%ef%bf%bd"] {
            let inhalt = alarm_inhalt(&abfrage(utf8)).unwrap();
            assert!(self::roh(&inhalt).get("abfrage_roh").is_none(), "{utf8}");
        }
        // Ein Ersatzzeichen in einem Feld entschuldigt kein verlorenes Byte in einem anderen.
        let gemischt = "text=K%F6ln&x=%EF%BF%BD";
        let inhalt = alarm_inhalt(&abfrage(gemischt)).unwrap();
        assert_eq!(self::roh(&inhalt)["abfrage_roh"], gemischt);
    }

    #[test]
    fn inhaltstyp_wird_gekuerzt_und_die_rohdaten_sind_begrenzt() {
        let lang = format!("text/plain; x={}", "y".repeat(4000));
        let inhalt = alarm_inhalt(&body(&lang, "Brand")).unwrap();
        let typ = roh(&inhalt)["inhaltstyp"].as_str().unwrap().to_string();
        assert_eq!(typ.chars().count(), INHALTSTYP_MAX);

        // Steuerzeichen bläht JSON sechsfach auf: 16 KiB Body würden 96 KiB Rohdaten.
        let steuerzeichen = "\u{1}".repeat(BODY_MAX);
        let fehler = alarm_inhalt(&body("text/plain", &steuerzeichen)).unwrap_err();
        assert_eq!(fehler.code, ErrorCode::PayloadTooLarge);
        // Gewöhnlicher Text in voller Größe samt voller Abfrage bleibt darunter.
        let abfrage = format!("text={}", "x".repeat(ABFRAGE_MAX - 5));
        let voll = "x".repeat(BODY_MAX);
        let einwurf = Einwurf {
            abfrage: &abfrage,
            inhaltstyp: Some("text/plain"),
            body: voll.as_bytes(),
        };
        let inhalt = alarm_inhalt(&einwurf).unwrap();
        assert!(inhalt.rohdaten.len() <= ROHDATEN_MAX);
    }

    #[test]
    fn grenzen_von_body_abfrage_und_kennung() {
        let gross = "x".repeat(BODY_MAX + 1);
        let fehler = alarm_inhalt(&body("text/plain", &gross)).unwrap_err();
        assert_eq!(fehler.code, ErrorCode::PayloadTooLarge);
        assert!(alarm_inhalt(&body("text/plain", &gross[..BODY_MAX])).is_ok());

        let lang = format!("text={}", "x".repeat(ABFRAGE_MAX - 4));
        assert_eq!(lang.len(), ABFRAGE_MAX + 1);
        assert_eq!(
            alarm_inhalt(&abfrage(&lang)).unwrap_err().code,
            ErrorCode::PayloadTooLarge
        );
        assert!(
            alarm_inhalt(&abfrage(&lang[..ABFRAGE_MAX])).is_ok(),
            "genau die Grenze geht"
        );

        let kennung = format!("external_id={}", "ä".repeat(KENNUNG_MAX + 1));
        let fehler = alarm_inhalt(&abfrage(&kennung)).unwrap_err();
        assert_eq!(fehler.status, StatusCode::BAD_REQUEST);
        let kennung = format!("external_id={}", "ä".repeat(KENNUNG_MAX));
        assert!(
            alarm_inhalt(&abfrage(&kennung)).is_ok(),
            "Zeichen, nicht Bytes"
        );
    }

    #[test]
    fn body_ohne_utf8_ist_400() {
        let einwurf = Einwurf {
            abfrage: "",
            inhaltstyp: None,
            body: &[0xff, 0xfe],
        };
        assert_eq!(
            alarm_inhalt(&einwurf).unwrap_err().status,
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn inhalt_hash_trennt_abfrage_und_body() {
        let a = Einwurf {
            abfrage: "ab",
            inhaltstyp: None,
            body: b"c",
        };
        let b = Einwurf {
            abfrage: "a",
            inhaltstyp: None,
            body: b"bc",
        };
        assert_ne!(
            alarm_inhalt(&a).unwrap().inhalt_hash,
            alarm_inhalt(&b).unwrap().inhalt_hash
        );
    }

    // ── Alarmmeldung ablegen ──

    async fn ablegen(
        pool: &SqlitePool,
        zugang: &EinwurfZugang,
        q: &str,
        jetzt: &str,
    ) -> AlarmErgebnis {
        let inhalt = alarm_inhalt(&abfrage(q)).unwrap();
        let mut c = pool.acquire().await.unwrap();
        alarmmeldung_ablegen(&mut c, zugang, &inhalt, jetzt)
            .await
            .unwrap()
    }

    /// (id, erneut_empfangen_anzahl, erneut_empfangen_at, frueher_id) aller Einträge.
    async fn eintraege(pool: &SqlitePool) -> Vec<(i64, i64, Option<String>, Option<i64>)> {
        sqlx::query_as(
            "SELECT id, erneut_empfangen_anzahl, erneut_empfangen_at, frueher_id \
             FROM alarmmeldung ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn message_id_ist_dauerhaft_idempotent() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let q = "external_id=LS-1&message_id=m1&text=Brand";
        assert_eq!(ablegen(&pool, &zugang, q, JETZT).await, AlarmErgebnis::Neu);
        // Drei Stunden später, sogar mit anderem Text: dieselbe Meldung.
        let q2 = "external_id=LS-1&message_id=m1&text=Brand%202";
        assert_eq!(
            ablegen(&pool, &zugang, q2, "2026-11-12 13:00:00").await,
            AlarmErgebnis::Wiederholung
        );
        assert_eq!(
            eintraege(&pool).await,
            vec![(1, 1, Some("2026-11-12 13:00:00".into()), None)]
        );
    }

    #[tokio::test]
    async fn neue_message_id_zur_selben_external_id_ist_ein_nachtrag() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        ablegen(
            &pool,
            &zugang,
            "external_id=LS-1&message_id=m1&text=a",
            JETZT,
        )
        .await;
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "external_id=LS-1&message_id=m2&text=a",
                JETZT
            )
            .await,
            AlarmErgebnis::Neu
        );
        // Dieselbe `message_id` unter einer anderen `external_id` ist eine andere Meldung.
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "external_id=LS-2&message_id=m1&text=a",
                JETZT
            )
            .await,
            AlarmErgebnis::Neu
        );
        assert_eq!(eintraege(&pool).await.len(), 3);
    }

    #[tokio::test]
    async fn nur_message_id_ohne_external_id_ist_auch_dauerhaft() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        ablegen(&pool, &zugang, "message_id=m1&text=a", JETZT).await;
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "message_id=m1&text=a",
                "2026-11-13 09:00:00"
            )
            .await,
            AlarmErgebnis::Wiederholung
        );
    }

    #[tokio::test]
    async fn nur_external_id_zaehlt_mit_gleichem_inhalt_als_wiederholung() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        ablegen(&pool, &zugang, "external_id=LS-1&text=a", JETZT).await;
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "external_id=LS-1&text=a",
                "2026-11-12 18:00:00"
            )
            .await,
            AlarmErgebnis::Wiederholung
        );
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "external_id=LS-1&text=b",
                "2026-11-12 18:00:01"
            )
            .await,
            AlarmErgebnis::Neu,
            "anderer Inhalt ist ein Nachtrag"
        );
        // Nach A und B wieder A: am Eintrag A vermerkt, jünger als B.
        assert_eq!(
            ablegen(
                &pool,
                &zugang,
                "external_id=LS-1&text=a",
                "2026-11-12 18:00:02"
            )
            .await,
            AlarmErgebnis::Wiederholung
        );
        let alle = eintraege(&pool).await;
        assert_eq!(alle.len(), 2);
        assert_eq!(alle[0].1, 2);
        assert_eq!(alle[0].2.as_deref(), Some("2026-11-12 18:00:02"));
    }

    #[tokio::test]
    async fn ohne_kennung_gilt_gleicher_inhalt_zwei_minuten_als_wiederholung() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let q = "ric=1234567&text=Brand";
        assert_eq!(
            ablegen(&pool, &zugang, q, "2026-11-12 10:00:00").await,
            AlarmErgebnis::Neu
        );
        for zeit in ["2026-11-12 10:00:30", "2026-11-12 10:01:00"] {
            assert_eq!(
                ablegen(&pool, &zugang, q, zeit).await,
                AlarmErgebnis::Wiederholung
            );
        }
        assert_eq!(
            eintraege(&pool).await,
            vec![(1, 2, Some("2026-11-12 10:01:00".into()), None)]
        );
        // Gleitend: 120 s nach dem letzten Empfang gilt noch, 121 s nicht mehr.
        assert_eq!(
            ablegen(&pool, &zugang, q, "2026-11-12 10:03:00").await,
            AlarmErgebnis::Wiederholung
        );
        assert_eq!(
            ablegen(&pool, &zugang, q, "2026-11-12 10:05:01").await,
            AlarmErgebnis::Neu
        );
        let alle = eintraege(&pool).await;
        assert_eq!(alle.len(), 2);
        assert_eq!(alle[1], (2, 0, None, Some(1)), "Verweis auf den früheren");
    }

    #[tokio::test]
    async fn anderer_inhalt_und_anderer_zugang_sind_eigene_eintraege() {
        let pool = db::test_pool().await;
        let (a, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let (b, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        ablegen(&pool, &a, "text=Brand", JETZT).await;
        assert_eq!(
            ablegen(&pool, &a, "text=Unfall", JETZT).await,
            AlarmErgebnis::Neu
        );
        assert_eq!(
            ablegen(&pool, &b, "text=Brand", JETZT).await,
            AlarmErgebnis::Neu
        );
        // Dieselbe Kennung an zwei Zugängen: zwei Einträge.
        ablegen(&pool, &a, "external_id=x&message_id=m", JETZT).await;
        assert_eq!(
            ablegen(&pool, &b, "external_id=x&message_id=m", JETZT).await,
            AlarmErgebnis::Neu
        );
        let alle = eintraege(&pool).await;
        assert_eq!(alle.len(), 5);
        assert!(alle.iter().all(|e| e.1 == 0 && e.3.is_none()), "{alle:?}");
    }

    #[tokio::test]
    async fn tagesgrenze_haelt_neue_eintraege_und_wiederholungen_an() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        ablegen(&pool, &zugang, "text=erste", "2026-11-12 09:59:00").await;
        // Die Grenze mit einem Schlag füllen statt 5 000 Einwürfe zu schicken.
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) \
             INSERT INTO alarmmeldung (org_id, zugang_id, inhalt_hash, rohdaten, empfangen_at) \
             SELECT 1, ?, 'h' || i, '{}', '2026-11-12 09:59:30' FROM n",
        )
        .bind(ALARMMELDUNGEN_JE_TAG - 1)
        .bind(&zugang.id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            ablegen(&pool, &zugang, "text=zu-viel", JETZT).await,
            AlarmErgebnis::Tagesgrenze
        );
        // An der Grenze bekommt auch eine Wiederholung dieselbe Antwort: sonst verriete sie, ob
        // ein Inhalt schon in der Ablage liegt. Vermerkt wird dann nichts.
        assert_eq!(
            ablegen(&pool, &zugang, "text=erste", JETZT).await,
            AlarmErgebnis::Tagesgrenze
        );
        let vermerkt: i64 =
            sqlx::query_scalar("SELECT SUM(erneut_empfangen_anzahl) FROM alarmmeldung")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(vermerkt, 0);
        // 24 Stunden nach dem ersten Eintrag ist wieder Platz.
        assert_eq!(
            ablegen(&pool, &zugang, "text=morgen", "2026-11-13 09:59:01").await,
            AlarmErgebnis::Neu
        );
    }

    // ── Position lesen ──

    #[test]
    fn osmand_aufruf_wird_gelesen() {
        let p = position_inhalt(
            &abfrage("id=elw1&lat=52.1&lon=9.3&timestamp=1794475200&speed=12.5&bearing=90"),
            JETZT,
        )
        .unwrap();
        assert_eq!(p.kennung, "elw1");
        assert_eq!((p.lat, p.lon), (52.1, 9.3));
        assert_eq!(p.gemessen_at, "2026-11-12 09:20:00");
        let roh: Value = serde_json::from_str(&p.rohdaten).unwrap();
        assert_eq!(
            roh,
            json!({ "felder": [["speed", "12.5"], ["bearing", "90"]] })
        );
    }

    #[test]
    fn zeitstempel_in_drei_formen_und_ohne() {
        let lies = |q: &str| position_inhalt(&abfrage(q), JETZT).unwrap().gemessen_at;
        assert_eq!(
            lies("id=a&lat=1&lon=2&timestamp=1794475200000"),
            "2026-11-12 09:20:00"
        );
        assert_eq!(
            lies("id=a&lat=1&lon=2&timestamp=2026-11-12T10:20:00%2B01:00"),
            "2026-11-12 09:20:00"
        );
        assert_eq!(
            lies("id=a&lat=1&lon=2&timestamp=2026-11-12T09:20:00Z"),
            "2026-11-12 09:20:00"
        );
        assert_eq!(
            lies("id=a&lat=1&lon=2"),
            JETZT,
            "ohne Zeitstempel gilt der Empfang"
        );
        // Bis fünf Minuten voraus ist Uhrtoleranz.
        assert_eq!(
            lies("id=a&lat=1&lon=2&timestamp=2026-11-12T10:05:00Z"),
            "2026-11-12 10:05:00"
        );
    }

    #[test]
    fn deviceid_json_und_formular_werden_gelesen() {
        let p = position_inhalt(&abfrage("deviceid=fw2&lat=-33.9&lon=151.2"), JETZT).unwrap();
        assert_eq!(p.kennung, "fw2");
        let p = position_inhalt(
            &body(
                "application/json",
                r#"{"id": "k1", "lat": 52.5, "lon": 13.4}"#,
            ),
            JETZT,
        )
        .unwrap();
        assert_eq!((p.kennung.as_str(), p.lat, p.lon), ("k1", 52.5, 13.4));
        let p = position_inhalt(
            &body("application/x-www-form-urlencoded", "id=k2&lat=1&lon=2"),
            JETZT,
        )
        .unwrap();
        assert_eq!(p.kennung, "k2");
    }

    #[test]
    fn ungueltige_positionen_sind_400_und_die_zukunft_422() {
        let status = |q: &str| position_inhalt(&abfrage(q), JETZT).unwrap_err().status;
        for q in [
            "",
            "lat=1&lon=2",
            "id=a&lon=2",
            "id=a&lat=1",
            "id=a&lat=123&lon=2",
            "id=a&lat=1&lon=181",
            "id=a&lat=NaN&lon=2",
            "id=a&lat=inf&lon=2",
            "id=a&lat=abc&lon=2",
            "id=a&lat=1&lon=2&timestamp=gestern",
            "id=a&lat=1&lon=2&timestamp=99999999999999999999",
        ] {
            assert_eq!(status(q), StatusCode::BAD_REQUEST, "{q}");
        }
        let lang = format!("id={}&lat=1&lon=2", "k".repeat(POSITION_KENNUNG_MAX + 1));
        assert_eq!(status(&lang), StatusCode::BAD_REQUEST);
        let genau = format!("id={}&lat=1&lon=2", "k".repeat(POSITION_KENNUNG_MAX));
        assert!(position_inhalt(&abfrage(&genau), JETZT).is_ok());
        // Eine Kennung, die nicht als UTF-8 kam, fiele mit anderen zusammen.
        assert_eq!(status("id=L%F6sch1&lat=1&lon=2"), StatusCode::BAD_REQUEST);
        assert!(position_inhalt(&abfrage("id=L%C3%B6sch1&lat=1&lon=2"), JETZT).is_ok());
        // Je Feld geprüft: Ein Ersatzzeichen an anderer Stelle rettet die Kennung nicht, und
        // eine Kennung mit echtem U+FFFD (JSON ist immer UTF-8) ist gültig.
        assert_eq!(
            status("id=L%F6sch1&note=%EF%BF%BD&lat=1&lon=2"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status("deviceid=L%F6sch1&lat=1&lon=2"),
            StatusCode::BAD_REQUEST
        );
        assert!(position_inhalt(&abfrage("id=a&note=K%F6ln&lat=1&lon=2"), JETZT).is_ok());
        let json = body(
            "application/json",
            "{\"id\":\"a\u{FFFD}b\",\"lat\":1,\"lon\":2}",
        );
        assert!(position_inhalt(&json, JETZT).is_ok());
        assert_eq!(
            status("id=a&lat=1&lon=2&timestamp=2026-11-12T10:30:00Z"),
            StatusCode::UNPROCESSABLE_ENTITY,
            "30 Minuten in der Zukunft"
        );
    }

    // ── Position ablegen ──

    async fn position(
        pool: &SqlitePool,
        zugang: &EinwurfZugang,
        q: &str,
        jetzt: &str,
    ) -> PositionErgebnis {
        let inhalt = position_inhalt(&abfrage(q), jetzt).unwrap();
        let mut c = pool.acquire().await.unwrap();
        position_ablegen(&mut c, zugang, &inhalt, jetzt)
            .await
            .unwrap()
    }

    async fn positionen(pool: &SqlitePool) -> Vec<(String, f64, f64, String, String)> {
        sqlx::query_as(
            "SELECT kennung, lat, lon, gemessen_at, empfangen_at FROM position_letzte \
             ORDER BY kennung",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn neue_position_ersetzt_die_alte_ohne_verlauf() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        let q1 = "id=elw1&lat=52.1&lon=9.3&timestamp=2026-11-12T09:58:00Z";
        let q2 = "id=elw1&lat=52.2&lon=9.4&timestamp=2026-11-12T09:59:00Z";
        assert_eq!(
            position(&pool, &zugang, q1, JETZT).await,
            PositionErgebnis::Uebernommen
        );
        assert_eq!(
            position(&pool, &zugang, q2, "2026-11-12 10:00:10").await,
            PositionErgebnis::Uebernommen
        );
        assert_eq!(
            positionen(&pool).await,
            vec![(
                "elw1".into(),
                52.2,
                9.4,
                "2026-11-12 09:59:00".into(),
                "2026-11-12 10:00:10".into()
            )]
        );
    }

    #[tokio::test]
    async fn aeltere_position_wird_nicht_uebernommen() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        let neu = "id=elw1&lat=52.2&lon=9.4&timestamp=2026-11-12T09:59:00Z";
        let alt = "id=elw1&lat=52.1&lon=9.3&timestamp=2026-11-12T09:58:00Z";
        position(&pool, &zugang, neu, JETZT).await;
        assert_eq!(
            position(&pool, &zugang, alt, "2026-11-12 10:00:10").await,
            PositionErgebnis::Aelter
        );
        let stand = positionen(&pool).await;
        assert_eq!(
            (stand[0].1, stand[0].4.as_str()),
            (52.2, JETZT),
            "unverändert"
        );
        // Derselbe Zeitstempel ersetzt (eine Wiederholung schadet nicht).
        assert_eq!(
            position(&pool, &zugang, neu, "2026-11-12 10:00:20").await,
            PositionErgebnis::Uebernommen
        );
    }

    #[tokio::test]
    async fn kennungen_sind_je_zugang_getrennt_und_begrenzt() {
        let pool = db::test_pool().await;
        let (a, _) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        let (b, _) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) \
             INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
             empfangen_at, rohdaten) SELECT 1, ?, 'k' || i, 1, 2, ?, ?, '{}' FROM n",
        )
        .bind(KENNUNGEN_JE_ZUGANG - 1)
        .bind(&a.id)
        .bind("2026-11-12 09:00:00")
        .bind("2026-11-12 09:00:00")
        .execute(&pool)
        .await
        .unwrap();
        // 199 Kennungen stehen: die 200. geht, die 201. nicht.
        assert_eq!(
            position(&pool, &a, "id=zweihundert&lat=1&lon=2", JETZT).await,
            PositionErgebnis::Uebernommen
        );
        assert_eq!(
            position(&pool, &a, "id=neu&lat=1&lon=2", JETZT).await,
            PositionErgebnis::ZuVieleKennungen
        );
        assert_eq!(
            position(&pool, &a, "id=k7&lat=5&lon=6", JETZT).await,
            PositionErgebnis::Uebernommen,
            "eine bekannte Kennung geht weiter"
        );
        assert_eq!(
            position(&pool, &b, "id=k7&lat=7&lon=8", JETZT).await,
            PositionErgebnis::Uebernommen,
            "anderer Zugang, eigene Zählung und eigene Position"
        );
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM position_letzte")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, KENNUNGEN_JE_ZUGANG + 1);
    }

    // ── Löschfristen ──

    #[tokio::test]
    async fn purge_loescht_alarmmeldungen_nach_sieben_tagen_und_positionen_nach_einem() {
        let pool = db::test_pool().await;
        let (za, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let (zp, _) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        ablegen(&pool, &za, "text=alt", "2026-11-04 09:59:59").await;
        ablegen(&pool, &za, "text=jung", "2026-11-06 10:00:00").await;
        // Ein erneuter Empfang verlängert die Frist nicht.
        sqlx::query(
            "UPDATE alarmmeldung SET erneut_empfangen_anzahl = 1, \
             erneut_empfangen_at = '2026-11-12 09:00:00' WHERE id = 1",
        )
        .execute(&pool)
        .await
        .unwrap();
        position(&pool, &zp, "id=alt&lat=1&lon=2", "2026-11-11 09:59:59").await;
        position(&pool, &zp, "id=jung&lat=1&lon=2", "2026-11-11 11:00:00").await;

        super::super::purge(&pool, JETZT).await.unwrap();

        let rest: Vec<String> = sqlx::query_scalar("SELECT rohdaten FROM alarmmeldung")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rest.len(), 1);
        assert!(rest[0].contains("jung"));
        let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM position_letzte")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(kennungen, vec!["jung".to_string()]);
    }
}
