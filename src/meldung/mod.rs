//! Meldungen (eingehend) (LFH-54): Bottom-up-Strang des Führungsvorgangs
//! (digitaler Meldekopf). Strukturierte Erfassung (Nachrichtenvordruck),
//! linearer Triage-Status, ETB-Kopplung. Baut auf dem Kommunikations-Unterbau
//! (`MeldeWeg`-Vokabular, LFH-84) und spiegelt das Aufträge-Template (LFH-52).
pub mod benachrichtigung;
pub mod korrektur;
pub mod repo;
pub mod rueckmeldung;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Meldeweg-Vokabular: Single Source of Truth bleibt das ETB-Modul (über den
/// Kommunikations-Unterbau re-exportiert), keine Eigendefinition.
pub use crate::kommunikation::MeldeWeg;
use crate::kommunikation::{Prioritaet, Richtung};

/// Priorität/Dringlichkeit (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = Prioritaet::Sofort.as_str();
pub const PRIO_DRINGEND: &str = Prioritaet::Dringend.as_str();
pub const PRIO_NORMAL: &str = Prioritaet::Normal.as_str();

/// Default-Bestätigungsfrist (Minuten ab Eingang) für bestätigungspflichtige
/// Sofortmeldungen (LFH-97), wenn der Absetzer kein Override angibt.
pub const BESTAETIGUNG_FRIST_DEFAULT_MIN: i64 = 5;

/// Vorgabe der Rückmeldefrist (Minuten ab der letzten Rückmeldung einer Einheit, LFH-610),
/// wenn weder Einsatz noch Org eine setzen. 60 deckt sich mit den Beispieldaten des
/// Neuentwurfs (50 min unauffällig, 65 min überfällig) — Entscheidung des Auftraggebers.
pub const RUECKMELDUNG_FRIST_DEFAULT_MIN: i64 = 60;

/// Meldungsart (Nachrichtenvordruck-Klassifikation).
pub const ART_LAGEMELDUNG: &str = Meldungsart::Lagemeldung.as_str();
pub const ART_SOFORTMELDUNG: &str = Meldungsart::Sofortmeldung.as_str();
pub const ART_RUECKMELDUNG: &str = Meldungsart::Rueckmeldung.as_str();
pub const ART_VOLLZUGSMELDUNG: &str = Meldungsart::Vollzugsmeldung.as_str();
pub const ART_ANFRAGE: &str = Meldungsart::Anfrage.as_str();
pub const ART_SONSTIGE: &str = Meldungsart::Sonstige.as_str();

wire_enum! {
    /// Triage-Status einer Meldung (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum MeldungStatus {
        Neu => "neu",
        Gesichtet => "gesichtet",
        InBearbeitung => "in_bearbeitung",
        Erledigt => "erledigt",
    }
    try_from = |s| format!("Ungültiger MeldungStatus: {s}");
}

wire_enum! {
    /// Meldungsart (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `meldungsart`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Meldungsart {
        Lagemeldung => "lagemeldung",
        Sofortmeldung => "sofortmeldung",
        Rueckmeldung => "rueckmeldung",
        Vollzugsmeldung => "vollzugsmeldung",
        Anfrage => "anfrage",
        Sonstige => "sonstige",
    }
    try_from = |s| format!("Ungültige Meldungsart: {s}");
}

/// Triage-Status (linearer Workflow). Bewusst KEIN kommunikation_status:
/// dessen zwei unabhängige Achsen (Quittung / Vollzug-3-Zustände) bilden einen
/// linearen 4-Zustands-Fluss nicht ab — „gesichtet" hat dort keinen Slot.
pub const STATUS_NEU: &str = MeldungStatus::Neu.as_str();
pub const STATUS_GESICHTET: &str = MeldungStatus::Gesichtet.as_str();
pub const STATUS_IN_BEARBEITUNG: &str = MeldungStatus::InBearbeitung.as_str();
pub const STATUS_ERLEDIGT: &str = MeldungStatus::Erledigt.as_str();

pub fn prioritaet_gueltig(p: &str) -> bool {
    Prioritaet::parse(p).is_some()
}

pub fn meldungsart_gueltig(a: &str) -> bool {
    Meldungsart::parse(a).is_some()
}

pub fn status_gueltig(s: &str) -> bool {
    MeldungStatus::parse(s).is_some()
}

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = Richtung::Intern.as_str();
pub const RICHTUNG_EXTERN: &str = Richtung::Extern.as_str();

pub fn richtung_gueltig(r: &str) -> bool {
    Richtung::parse(r).is_some()
}

/// Kennzahlen der Meldungsseite (LFH-940, `GET …/meldungen/kennzahlen`): dieselben Mengen wie
/// das Kennzahlenband, gezählt am Server, weil die Abgeschlossenen nur noch seitenweise kommen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct MeldungKennzahlen {
    /// Offen und noch von niemandem angefasst (Status `neu`).
    pub unbearbeitet: i64,
    /// Offen und bereits angefasst.
    pub in_arbeit: i64,
    /// Pflichtig, unbestätigt, Frist abgelaufen oder eskaliert — quer zur Phase.
    pub alarmiert: i64,
    /// Abgeschlossen.
    pub erledigt: i64,
}

/// Anzeige einer Meldung inkl. abgeleiteter Felder (Bearbeitername per JOIN, `ist_offen` für
/// Posteingang-Filter). Ob sie in der Lage steht, sagt `lagerelevant` (LLH-1031).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct MeldungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lfd_nr: i64,
    pub absender: String,
    pub empfaenger: Option<String>,
    /// Empfängerfunktion aus dem Katalog (LLH-1214, design.md D8), neben dem Freitext
    /// `empfaenger`. Ihre Nutzer bekommen beim Erfassen den Hinweis „Neue Meldung“.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<crate::fuehrung::Fuehrungsfunktion>)]
    pub empfaenger_funktion: Option<String>,
    pub meldeweg: MeldeWeg,
    pub inhalt: String,
    #[sqlx(try_from = "String")]
    pub meldungsart: Meldungsart,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    /// Richtung intern/extern (LFH-87).
    #[sqlx(try_from = "String")]
    pub richtung: Richtung,
    #[sqlx(try_from = "String")]
    pub status: MeldungStatus,
    pub bearbeiter_id: Option<i64>,
    pub bearbeiter_name: Option<String>,
    pub lagerelevant: bool,
    pub ereigniszeit: String,
    pub eingang_at: String,
    pub etb_meldung_id: Option<i64>,
    pub auftrag_id: Option<i64>,
    /// Abgeleitet: der verknüpfte Auftrag ist aufgehoben (LLH-1177). Dann lässt sich aus der
    /// Meldung erneut ein Auftrag erteilen; `auftrag_id` zeigt bis dahin auf den alten.
    pub is_auftrag_aufgehoben: bool,
    pub erfasst_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: status != 'erledigt' (Posteingang = offene Meldungen).
    pub ist_offen: bool,
    /// Erledigt-Zeitpunkt (UTC), first-write-wins beim Übergang nach 'erledigt' (LFH-113);
    /// NULL solange nie erledigt. Bleibt erhalten, falls der Status später zurückgesetzt wird.
    pub erledigt_at: Option<String>,
    /// Sofortmeldung & Eskalation (LFH-85/97): aktive Bestätigungspflicht.
    pub bestaetigung_pflicht: bool,
    /// Absolute Bestätigungsfrist (UTC), NULL wenn keine Pflicht.
    pub bestaetigung_frist_at: Option<String>,
    /// Frist überschritten + unbestätigt (vom Erinnerungs-Tick gesetzt, Re-Highlight).
    pub eskaliert: bool,
    /// Abgeleitet (kommunikation_status, Quittungs-Achse): Bestätigt-um.
    pub bestaetigt_at: Option<String>,
    /// Abgeleitet: Bestätigt-von (Benutzer-id).
    pub bestaetigt_von_id: Option<i64>,
    /// Abgeleitet: Bestätigt-von (Anzeigename, JOIN benutzer).
    pub bestaetigt_von_name: Option<String>,
    /// Abgeleitet: quittiert_at IS NOT NULL.
    pub ist_bestaetigt: bool,
    /// Abgeleitet: pflichtig, unbestätigt und Frist <= jetzt.
    pub ist_ueberfaellig: bool,
    /// Strukturierter Absender (LFH-610): die Einheit, von der die Meldung kam. Höchstens
    /// einer von `einheit_id`/`abschnitt_id` ist gesetzt; `absender` bleibt der Name zum
    /// Eingangszeitpunkt. NULL, wenn nicht gebunden oder die Einheit aufgelöst wurde.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    /// Strukturierter Absender (LFH-610): der Einsatzabschnitt, von dem die Meldung kam.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    /// Abgeleitet (LLH-1382): die jüngste ETB-Berichtigung des Eintrags `etb_meldung_id`, für die
    /// Marke „berichtigt“ und den Sprung ins ETB. Der Wortlaut `inhalt` bleibt, wie er einging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etb_berichtigung_id: Option<i64>,
    /// Abgeleitet: laufende Nummer dieser Berichtigung im ETB, gesetzt genau mit
    /// `etb_berichtigung_id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etb_berichtigung_lfd_nr: Option<i64>,
}

impl MeldungAnzeige {
    /// Sofortmeldung (LFH-97, Spec „Sofortmeldung alarmiert“): Meldungsart Sofortmeldung oder
    /// Priorität sofort.
    pub fn ist_sofort(&self) -> bool {
        self.meldungsart == Meldungsart::Sofortmeldung || self.prioritaet == Prioritaet::Sofort
    }
}

/// Letzte Rückmeldung eines Absenders (Einheit oder direkt gebundener Abschnitt, LFH-610).
/// Als Rückmeldung zählt jede an den Absender gebundene Meldung, gleich welcher
/// Meldungsart; maßgeblich ist die jüngste `ereigniszeit`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LetzteRueckmeldung {
    /// `einsatz_einheit.id` bzw. `einsatzabschnitt.id`, je nach Liste.
    pub bezug_id: i64,
    pub meldung_id: i64,
    pub lfd_nr: i64,
    /// Zeitpunkt der Rückmeldung (UTC, SQLite-Format) — die Ereigniszeit, nicht der Eingang.
    pub ereigniszeit: String,
    pub inhalt: String,
    pub meldeweg: MeldeWeg,
    /// `ereigniszeit` + Rückmeldefrist (UTC). Ab diesem Zeitpunkt gilt der Absender als
    /// überfällig; der Vergleich mit „jetzt" liegt beim Client, damit die Anzeige ohne
    /// neues Ereignis umschlägt.
    #[sqlx(skip)]
    pub faellig_at: String,
}

/// Antwort von `GET …/meldungen/rueckmeldungen` (LFH-610). Einheiten ohne Eintrag haben
/// noch nie zurückgemeldet. Die Abschnittsliste enthält nur DIREKT an den Abschnitt
/// gebundene Meldungen; die Rückmeldung über den Teilbaum rechnet der Client aus beiden.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct RueckmeldungenAnzeige {
    /// Effektive Rückmeldefrist in Minuten (Einsatz ?? Org ?? 60).
    pub frist_min: i64,
    pub einheiten: Vec<LetzteRueckmeldung>,
    pub abschnitte: Vec<LetzteRueckmeldung>,
}

/// Eine Lagemeldung: eine lagerelevante Meldung in der Sicht der Lage (LFH-95; seit LLH-1031 ohne
/// eigenes Lageobjekt, LLH-1027 D1/D6). Die Drahtform bleibt die, die alte Lage-Stände
/// (`lage_snapshot.daten`) tragen: dort ist `id` noch die Kennung des früheren Lageobjekts, heute
/// gilt `id == meldung_id`. Die Felder ab `meldungsart` fehlen in alten Ständen.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LageMeldungAnzeige {
    /// Kennung der Lagemeldung = Kennung der Meldung (`lagemeldung:<id>` im Client).
    pub id: i64,
    pub einsatz_id: i64,
    pub meldung_id: i64,
    /// Eigener Lage-Text der Übernahme, sonst der Wortlaut der Meldung.
    pub text: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Wer sie in die Lage übernommen hat; bei einer Lagemeldung ihr Erfasser.
    pub erstellt_von_id: i64,
    /// Zeitpunkt der Übergabe an die Lage (UTC) — wann S2 sie aufgenommen hat, nicht wann es
    /// geschah. Bei einer Lagemeldung ihr Eingang.
    pub erstellt_at: String,
    /// Ereigniszeit der Quellmeldung (UTC, `meldung.ereigniszeit`, LLH-1039): Zeit, Tag,
    /// Zeitfenster und Ordnung der Zeitachse. Gleicher Name wie an der Meldung.
    pub ereigniszeit: String,
    pub meldung_lfd_nr: i64,
    pub meldung_absender: String,
    /// Abgeleitet: noch niemand hat die Lagemeldung als gesehen gekennzeichnet (LLH-1206). Gilt
    /// für alle Benutzer gleich; Liste und Modulzähler lesen dasselbe Prädikat (`is_neu_sql`).
    pub is_neu: bool,
    /// Zeitpunkt der ersten Kenntnisnahme (UTC); fehlt, solange neu.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesehen_at: Option<String>,
    /// Wer sie zuerst als gesehen gekennzeichnet hat; fehlt auch beim Bestand vor LLH-1206.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesehen_von_id: Option<i64>,
    /// Abgeleitet: Anzeigename zu `gesehen_von_id` (JOIN benutzer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesehen_von_name: Option<String>,
    /// Meldungsart (LLH-1031): `lagemeldung` oder die Art einer übernommenen Meldung.
    #[sqlx(try_from = "String")]
    pub meldungsart: Meldungsart,
    /// Priorität der Meldung, gleicher Name wie an der Meldung.
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    /// Bearbeitungsstand der Meldung im Meldungseingang — nicht die Kenntnisnahme (`is_neu`).
    #[sqlx(try_from = "String")]
    pub meldung_status: MeldungStatus,
    /// Richtung intern/extern (eine Lagemeldung an die übergeordnete Stelle ist `extern`).
    #[sqlx(try_from = "String")]
    pub richtung: Richtung,
    /// Abgeleitet: erfasst von einem gekoppelten Gerät (Erfasser ist ein Gerätekonto).
    pub is_von_geraet: bool,
    /// Abgeleitet (LLH-1382): jüngste ETB-Berichtigung des Eintrags der Meldung, wie an der
    /// Meldung. `text` bleibt Lage-Text oder Wortlaut (design.md D1). Fehlt in alten Ständen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etb_berichtigung_id: Option<i64>,
    /// Abgeleitet: laufende Nummer dieser Berichtigung im ETB.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etb_berichtigung_lfd_nr: Option<i64>,
}

// ── Nach dem Commit: Live-Bündel, Benachrichtigung, Auto-Frist (aus `routes/meldung.rs`
// gehoben, LLH-1075 design.md D12) ─────────────────────────────────────────────────────
// Jeder Schreibweg, der eine Meldung anlegt (Meldungsroute, Eintreffen am Bereitstellungsraum),
// stellt ihr Bündel über dieselben Funktionen zu: so erreicht die Benachrichtigung ihre
// Empfänger genau einmal, auch bei einem Replay.

/// SSE-Notify: Meldungen des Einsatzes haben sich geändert (Tag `meldung`).
pub(crate) fn sse(state: &crate::app::AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, crate::live::LiveEvent::Meldung);
}

/// SSE-Notify: unübersehbares Sofort-Highlight (Tag `sofortmeldung`, LFH-97). Läuft über
/// dieselbe eine EventSource pro Einsatz; der Client löst Alarm (visuell + Ton) aus.
fn sse_sofort(state: &crate::app::AppState, einsatz_id: i64, meldung_id: i64) {
    state.live.publiziere_objekt(
        einsatz_id,
        crate::live::LiveEvent::Sofortmeldung,
        "meldung_id",
        meldung_id,
    );
}

/// Leitet die Bestätigungs-Frist in Minuten ab.
/// Fallback-Kette: Request-Override ?? effektive_meldung_frist_min(Einsatz ?? Org) ?? Konstante.
pub(crate) fn meldung_bestaetigung_frist_min_ableiten(
    e: &crate::einsatz::einstellungen::EinsatzEinstellungen,
    o: &crate::org::einstellungen::OrgEinstellungen,
    req_override: Option<i64>,
    konstante: i64,
) -> i64 {
    req_override
        .or_else(|| crate::einsatz::effektiv::effektive_meldung_frist_min(e, o))
        .unwrap_or(konstante)
}

/// Stellt die offene Auto-Frist-Erinnerung ausnahmslos aus dem persistierten
/// Meldungsstand sicher. Dadurch repariert auch ein Replay nach verlorener/fehlgeschlagener
/// Reminder-Anlage den abgeleiteten Datensatz, ohne geänderte Request-Felder zu übernehmen.
/// `titel` nennt der Schreibweg (Meldungsroute „Sofortmeldung #n unbestätigt“, Eintreffen
/// „Unangemeldete Kraft #n unbestätigt“).
pub(crate) async fn auto_frist_erinnerung_sicherstellen(
    state: &crate::app::AppState,
    meldung: &MeldungAnzeige,
    titel: &str,
) -> Result<(), crate::error::AppError> {
    if meldung.bestaetigung_pflicht && meldung.bestaetigung_frist_at.is_some() {
        crate::erinnerung::repo::stelle_meldung_auto_frist_sicher(&state.pool, meldung.id, titel)
            .await?;
    }
    Ok(())
}

/// Liefert das Live-Buendel einer persistierten Meldung at-least-once aus. Der DB-Marker wird
/// erst nach ETB-, Meldungs- und ggf. Sofortalarm-Event gesetzt. Ein `client_id`-Replay holt
/// daher einen Crash vor dem Publish nach; bereits markierte Meldungen erzeugen keine Dublette.
///
/// Eine Sofortmeldung alarmiert danach über die Benachrichtigungen (LLH-1209, Spec
/// `benachrichtigungen`, „Sofortmeldung alarmiert“): alle mit dem Modul Meldungen außer dem
/// Erfasser. Wer das Bündel zustellt, meldet außerdem die Benachrichtigung an die
/// Empfängerfunktion ([`benachrichtigung`]). `melden` schreibt selbst, also erst nach dem
/// Commit des Markers und nur, wenn dieser Aufruf ihn gesetzt hat: so genau einmal je Meldung,
/// auch bei einem Replay.
pub(crate) async fn live_publikation_sicherstellen(
    state: &crate::app::AppState,
    meldung: &MeldungAnzeige,
) -> Result<(), crate::error::AppError> {
    let einsatz_id = meldung.einsatz_id;
    let meldung_id = meldung.id;
    let etb_id = meldung.etb_meldung_id;
    let ist_sofort = meldung.ist_sofort();
    let publiziert_at = crate::zeit::jetzt();
    let zugestellt =
        repo::publiziere_live_ausstehend(&state.pool, meldung_id, &publiziert_at, || {
            if let Some(etb_id) = etb_id {
                state.live.publiziere(einsatz_id, etb_id);
            }
            sse(state, einsatz_id);
            if ist_sofort {
                sse_sofort(state, einsatz_id, meldung_id);
            }
        })
        .await?;
    if zugestellt {
        if ist_sofort {
            sofortalarm_melden(state, meldung, meldung.erfasst_von_id).await;
        }
        benachrichtigung::erfasst(&state.pool, &state.live, meldung).await;
    }
    Ok(())
}

/// Der Sofortalarm als Benachrichtigung (Spec `benachrichtigungen`, „Sofortmeldung alarmiert“):
/// alle mit dem Modul Meldungen außer dem Auslöser. Beim Erfassen ist das der Erfasser, beim
/// Heraufstufen der Korrigierende (LLH-1380).
async fn sofortalarm_melden(
    state: &crate::app::AppState,
    meldung: &MeldungAnzeige,
    ausloeser_id: i64,
) {
    use crate::benachrichtigung::{
        melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
    };
    melden(
        &state.pool,
        &state.live,
        Anlass::neu(
            meldung.einsatz_id,
            BenachrichtigungArt::Sofortmeldung,
            Bezug::neu(BenachrichtigungBezugTyp::Meldung, meldung.id),
        )
        .von(ausloeser_id)
        .an(Adressat::ModulLeser("meldungen")),
    )
    .await;
}

/// Titel der Auto-Frist-Erinnerung einer Sofortmeldung (Wortlaut seit LFH-97; für jede pflichtige
/// Meldung der Meldungsroute „Sofortmeldung“, Folgeaufgabe aus LLH-1075).
pub(crate) fn titel_sofort(meldung: &MeldungAnzeige) -> String {
    format!("Sofortmeldung #{} unbestätigt", meldung.lfd_nr)
}

/// Nach dem Commit einer Korrektur, die eine Meldung erst zur Sofortmeldung machte und ihren
/// Sofortalarm auslöst (`korrektur::Ergebnis::sofortalarm`, LLH-1380): Sofort-Highlight mit Ton,
/// Alarm an die Leser des Moduls und die Auto-Frist-Erinnerung, wie beim Erfassen. Einmal je
/// Meldung trägt der Merker `sofortalarm_at`, den die Korrektur in ihrer Transaktion setzt.
pub(crate) async fn sofortalarm_nach_heraufstufung(
    state: &crate::app::AppState,
    meldung: &MeldungAnzeige,
    ausloeser_id: i64,
) -> Result<(), crate::error::AppError> {
    sse_sofort(state, meldung.einsatz_id, meldung.id);
    sofortalarm_melden(state, meldung, ausloeser_id).await;
    auto_frist_erinnerung_sicherstellen(state, meldung, &titel_sofort(meldung)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritaet_validierung() {
        assert!(prioritaet_gueltig(PRIO_SOFORT));
        assert!(!prioritaet_gueltig("blubb"));
    }

    #[test]
    fn meldungsart_validierung() {
        assert!(meldungsart_gueltig(ART_VOLLZUGSMELDUNG));
        assert!(!meldungsart_gueltig("brieftaube"));
    }

    #[test]
    fn status_validierung() {
        assert!(status_gueltig(STATUS_GESICHTET));
        assert!(!status_gueltig("archiviert"));
    }

    #[test]
    fn meldeweg_kommt_aus_kommunikation() {
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }
}
