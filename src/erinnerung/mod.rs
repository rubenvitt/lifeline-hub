pub mod faelligkeit;
pub mod repo;
pub mod scheduler;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Öffentliche Darstellung einer Erinnerung. `ist_faellig` wird pro Read aus
/// `faellig_at <= jetzt` berechnet (nicht persistiert) — die Fälligkeit ist
/// damit unabhängig davon korrekt, ob/wann der Scheduler-Tick lief.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ErinnerungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub titel: String,
    pub beschreibung: Option<String>,
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    /// Freitext-Empfänger — oder, bei `empfaenger_funktion_code` Führungshilfspersonal/
    /// Fachberater, dessen Bezeichnung (Doppelrolle, LFH-549).
    pub empfaenger_funktion: Option<String>,
    /// Katalogcode des Empfängers (LFH-549); fehlt bei Freitext.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::fuehrung::Fuehrungsfunktion>)]
    pub empfaenger_funktion_code: Option<String>,
    /// Anzeige des Empfängers: Katalogwert mit wirksamem Label („S3 Einsatz“, „Fachberater:
    /// THW“) oder der Freitext. Fehlt ohne Empfänger.
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empfaenger_anzeige: Option<String>,
    /// Aktuelle Besetzung des Sachgebiets zur Lesezeit (nur s1–s6, nur mit Stab-Recht).
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_besetzung: Option<crate::fuehrung::aufloesung::AktuelleBesetzung>,
    pub bezug_typ: Option<String>,
    pub bezug_id: Option<i64>,
    pub quelle: String,
    #[schema(value_type = ErinnerungStatus)]
    pub status: String,
    pub erledigt_at: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: `faellig_at <= jetzt` zum Zeitpunkt der Abfrage.
    pub ist_faellig: bool,
    // Geteilte Kommunikations-Achsen (LFH-84) per LEFT JOIN; Default für Zeilen
    // ohne kommunikation_status-Eintrag: Vollzug 'offen', Quittung NULL.
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

impl ErinnerungAnzeige {
    /// Setzt die abgeleiteten Felder `empfaenger_anzeige` und `aktuelle_besetzung` (LFH-549).
    pub fn anreichern(
        &mut self,
        karte: &crate::fuehrung::Labelkarte,
        aufloeser: &crate::fuehrung::aufloesung::Aufloeser,
    ) {
        let angabe = crate::fuehrung::aus_spalten(
            self.empfaenger_funktion_code.as_deref(),
            self.empfaenger_funktion.clone(),
        );
        self.empfaenger_anzeige = match angabe.funktion {
            Some(f) => Some(karte.anzeige(f, angabe.text.as_deref())),
            None => angabe.text,
        };
        self.aktuelle_besetzung = aufloeser.aufloesen(angabe.funktion);
    }
}

/// Reichert Erinnerungen für die Antwort an: Labelkarte der Einsatz-Org, Besetzung nur mit
/// Stab-Recht (`fuehrung::aufloesung`). Einmal je Anfrage geladen.
pub async fn anreichern_alle(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &crate::auth::Benutzer,
    erinnerungen: &mut [ErinnerungAnzeige],
) -> Result<(), crate::error::AppError> {
    let aufloeser =
        crate::fuehrung::aufloesung::Aufloeser::laden_fuer(pool, einsatz_id, org_id, benutzer)
            .await?;
    let mut conn = pool.acquire().await?;
    let karte = crate::fuehrung::repo::labelkarte(&mut conn, org_id).await?;
    for e in erinnerungen.iter_mut() {
        e.anreichern(&karte, &aufloeser);
    }
    Ok(())
}

pub const STATUS_OFFEN: &str = ErinnerungStatus::Offen.as_str();
pub const STATUS_ERLEDIGT: &str = ErinnerungStatus::Erledigt.as_str();
pub const STATUS_QUITTIERT: &str = ErinnerungStatus::Quittiert.as_str();

wire_enum! {
    /// LFH-120: Schema-Anker für die `status`-Union (geschlossenes Code-Vokabular, s. STATUS_*).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ErinnerungStatus {
        Offen => "offen",
        Erledigt => "erledigt",
        Quittiert => "quittiert",
    }
}

/// Obergrenze für das Wiederholintervall: 7 Tage (LFH-924). Ein Einsatz dauert Stunden bis
/// wenige Wochen; der längste Rhythmus der Stabsarbeit ist der Tag, ein Wochenrhythmus deckt
/// lange Lagen mit ab. Was darüber liegt, wiederholt sich im Einsatz praktisch nie und ist
/// ein Tippfehler.
pub const INTERVALL_MAX_MINUTEN: i64 = 7 * 24 * 60;

/// Plausibler Jahresbereich einer Fälligkeit (LFH-924). Darin hat das Jahr immer vier
/// Stellen, die Textsortierung von `faellig_at` stimmt also.
pub const FAELLIG_JAHRE: std::ops::RangeInclusive<i32> = 2000..=2100;

pub const QUELLE_MANUELL: &str = "manuell";
pub const QUELLE_AUTO_FRIST: &str = "auto_frist";
