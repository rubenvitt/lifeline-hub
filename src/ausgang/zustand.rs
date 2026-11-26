//! Zustandsmodell des Ausgangskorbs und die Wiederholungsfrist (Spec Abschnitt 3).

use crate::wire_enum::wire_enum;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Dokument, aus dem ein Versand stammt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum QuelleArt {
        Lagebericht => "lagebericht",
        Befehl => "befehl",
        Nachforderung => "nachforderung",
    }
    try_from = |s| format!("Ungültige Quelle eines Versands: {s}");
    sqlx = |s| format!("Ungültige Quelle eines Versands: {s}");
}

wire_enum! {
    /// Zustand eines Versands: `wartet` (auch zwischen zwei Versuchen), `uebergeben` an den
    /// Mailserver bzw. Fax-Anbieter, `zugestellt` (nur Fax: der Anbieter hat die Zustellung
    /// bestätigt, LLH-2095) oder `fehlgeschlagen`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VersandZustand {
        Wartet => "wartet",
        Uebergeben => "uebergeben",
        Zugestellt => "zugestellt",
        Fehlgeschlagen => "fehlgeschlagen",
    }
    try_from = |s| format!("Ungültiger Zustand eines Versands: {s}");
    sqlx = |s| format!("Ungültiger Zustand eines Versands: {s}");
}

wire_enum! {
    /// Letzter Fehler eines Versands. Nie Text des Ziels, nur dieser Code und der Status des
    /// Ziels (SMTP-Code bzw. HTTP-Status des Fax-Anbieters). `nicht_zugestellt`: der Fax-Anbieter
    /// meldet, dass das Fax nicht durchging (LLH-2095). `kein_zutritt` und `verschluesselung`
    /// kommen nur aus der Zustellung per Matrix (LLH-2094).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AusgangFehler {
        Voruebergehend => "voruebergehend",
        Abgelehnt => "abgelehnt",
        Ungewiss => "ungewiss",
        Ueberholt => "ueberholt",
        AnbindungFehlt => "anbindung_fehlt",
        AnbindungAngehalten => "anbindung_angehalten",
        AnbindungFehler => "anbindung_fehler",
        ZuGross => "zu_gross",
        Spiegel => "spiegel",
        NichtZugestellt => "nicht_zugestellt",
        KeinZutritt => "kein_zutritt",
        Verschluesselung => "verschluesselung",
    }
    try_from = |s| format!("Ungültiger Fehler eines Versands: {s}");
    sqlx = |s| format!("Ungültiger Fehler eines Versands: {s}");
}

/// Erste Wartezeit der Wiederholung in Sekunden.
pub const BACKOFF_START_S: i64 = 30;
/// Deckel der Wartezeit in Sekunden (5 min).
pub const BACKOFF_DECKEL_S: i64 = 300;
/// Fenster seit dem ersten Versuch, in dem noch wiederholt wird (30 min).
pub const FENSTER_MINUTEN: i64 = 30;

/// Zeitpunkt des nächsten Versuchs nach dem `versuche`-ten Fehlschlag, oder `None`, wenn seit
/// dem ersten Versuch mehr als das Fenster vergangen ist (dann ist der Versand
/// `fehlgeschlagen`). Wartezeit `30 s · 2^(versuche−1)`, gedeckelt auf 5 min.
pub fn naechster_versuch(
    erster: DateTime<Utc>,
    versuche: i64,
    jetzt: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    if jetzt - erster > Duration::minutes(FENSTER_MINUTEN) {
        return None;
    }
    let exponent = (versuche - 1).clamp(0, 16) as u32;
    let warte = (BACKOFF_START_S << exponent).min(BACKOFF_DECKEL_S);
    Some(jetzt + Duration::seconds(warte))
}

/// Erste Abfrage beim Fax-Anbieter nach der Übergabe, in Sekunden (LLH-2095, Spec Abschnitt 5).
pub const ABFRAGE_ERSTE_S: i64 = 30;
/// Abstand jeder weiteren Abfrage in Sekunden.
pub const ABFRAGE_TAKT_S: i64 = 60;
/// Frist seit der Übergabe, nach der ein Fax ohne Endstand `ungewiss` wird (2 h).
pub const ABFRAGE_FRIST_MINUTEN: i64 = 120;

/// Zeitpunkt der ersten Abfrage nach der Übergabe an den Fax-Anbieter.
pub fn erste_abfrage(uebergeben: DateTime<Utc>) -> DateTime<Utc> {
    uebergeben + Duration::seconds(ABFRAGE_ERSTE_S)
}

/// Zeitpunkt der nächsten Abfrage, oder `None`, wenn seit der Übergabe mehr als die Frist
/// vergangen ist (dann ist der Versand `fehlgeschlagen` mit `ungewiss`).
pub fn naechste_abfrage(uebergeben: DateTime<Utc>, jetzt: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if jetzt - uebergeben > Duration::minutes(ABFRAGE_FRIST_MINUTEN) {
        return None;
    }
    Some(jetzt + Duration::seconds(ABFRAGE_TAKT_S))
}
