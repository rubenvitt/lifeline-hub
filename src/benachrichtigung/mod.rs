//! Benachrichtigungen (LLH-1207, Change `kcjecn9e-benachrichtigungskonzept`, design.md D1–D4,
//! D6; Spec `benachrichtigungen`).
//!
//! **Eine Stelle entscheidet, wer eine Benachrichtigung bekommt.** Ein Schreibweg oder der
//! Scheduler meldet nach dem Commit nur, *was* geschah: Art, Bezug, Auslöser und Adressaten als
//! Vorgabe ([`Anlass`]). [`melden`] löst daraus die Empfänger auf ([`aufloesung`]), schreibt je
//! Empfänger eine Zeile ([`repo`]) und stellt jedem genau sein Ereignis zu: im Einsatz-Strom
//! `benachrichtigung` als EINE Nachricht mit der Nutzlast je Empfänger, für die Org-Arten im
//! Org-Kanal
//! `org_benachrichtigung`. Den Text bildet der Server erst beim Lesen aus dem Bezug ([`text`]).
//!
//! ```ignore
//! // nach dem Commit eines Auftrags an S4
//! benachrichtigung::melden(
//!     &state.pool,
//!     &state.live,
//!     Anlass::neu(einsatz_id, BenachrichtigungArt::AuftragErteilt, Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id))
//!         .von(ctx.benutzer.id)
//!         .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
//! )
//! .await;
//! ```

pub mod aufloesung;
pub mod repo;
pub mod text;
pub mod vorgabe;

#[cfg(test)]
mod tests;

use crate::fuehrung::Fuehrungsfunktion;
use crate::live::{LiveEvent, LiveHub, Zustellung};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

wire_enum! {
    /// Wie laut eine Benachrichtigung ist (Spec „Drei Stufen“; LLH-1143, Entscheidung zu LLH-1142
    /// E1: Alarm, Eingang, Still). Die Stufe einer Art ist fest ([`BenachrichtigungArt::stufe`]);
    /// *still* entsteht erst beim Empfänger, wenn er die Art abgeschaltet hat oder die Vorgabe
    /// des Einsatzes sie für jede seiner Funktionen still stellt ([`aufloesung`], [`vorgabe`]).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum BenachrichtigungStufe {
        /// Lauter Ton, Toast, OS-Meldung bei verdecktem Tab; nicht abschaltbar.
        Alarm => "alarm",
        /// Die Stufe *Eingang* (Wire-Wert bleibt `hinweis`): Eingangsband, dezenter Ton, Zähler im
        /// Knopf „Eingänge“, im Tab-Titel und am App-Symbol; je Art abschaltbar.
        Hinweis => "hinweis",
        /// Nur im Verlauf: schon gelesen geschrieben, zählt nie, kein Ton, kein Band, kein Push.
        Still => "still",
    }
    try_from = |s| format!("Ungültige BenachrichtigungStufe: {s}");
}

wire_enum! {
    /// Der geschlossene Katalog der Benachrichtigungsarten (design.md D4). Die Stufe ist je Art
    /// fest ([`BenachrichtigungArt::stufe`]); wer sie ändern will, ändert die Spec. Die
    /// CHECK-Liste der jüngsten Migration der Tabelle (`migrations/0255_benachrichtigung_quellen.sql`)
    /// spiegelt `ALLE`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum BenachrichtigungArt {
        Sofortmeldung => "sofortmeldung",
        SofortmeldungEskaliert => "sofortmeldung_eskaliert",
        AuftragUeberfaellig => "auftrag_ueberfaellig",
        AbloesungFaellig => "abloesung_faellig",
        ErinnerungFaellig => "erinnerung_faellig",
        AbloesungVorwarnung => "abloesung_vorwarnung",
        /// Planungshinweis (LLH-1131): kurz vor der Fälligkeit ist noch keine ablösende Einheit
        /// geplant. Eine eigene Art, aber keine Einstufung der Schicht (die bleibt bei drei).
        AbloesungPlanung => "abloesung_planung",
        /// Bei der geplanten ablösenden Einheit tut sich etwas, oder ihre Planung entfällt
        /// (LLH-1131). Was, steckt im Bezug (`abloeser_*`), wie beim Status einer Nachforderung.
        AbloesungAbloeser => "abloesung_abloeser",
        AuftragErteilt => "auftrag_erteilt",
        AuftragQuittiert => "auftrag_quittiert",
        AuftragErledigt => "auftrag_erledigt",
        Befehl => "befehl",
        Lagebericht => "lagebericht",
        Meldung => "meldung",
        /// Die letzte Rückmeldung einer Einheit ist älter als die Rückmeldefrist (LLH-1425):
        /// einmal je Überfälligkeit, vom Scheduler (`meldung::rueckmeldung`).
        RueckmeldungUeberfaellig => "rueckmeldung_ueberfaellig",
        LagebesprechungVorher => "lagebesprechung_vorher",
        LagebesprechungFaellig => "lagebesprechung_faellig",
        NachforderungStatus => "nachforderung_status",
        Gefahr => "gefahr",
        SichtungEins => "sichtung_eins",
        /// Eine Person ist als vermisst gemeldet oder auf vermisst gesetzt (LLH-1425).
        Vermisstenmeldung => "vermisstenmeldung",
        WiederVerfuegbar => "wieder_verfuegbar",
        ChatErwaehnung => "chat_erwaehnung",
        /// Org-Art: erreicht den Aufgenommenen auch außerhalb eines Einsatzes.
        EinsatzAufnahme => "einsatz_aufnahme",
        /// Org-Art: erreicht Führungskräfte, die den neuen Einsatz lesen dürfen.
        EinsatzNeu => "einsatz_neu",
        /// Nur für die Einstellungen: Unwetter erkennt der Browser selbst (design.md D4). Seit
        /// LLH-1425 ein Alarm (Warnstufe rot), also ohne Schalter.
        Unwetter => "unwetter",
    }
    try_from = |s| format!("Ungültige Benachrichtigungsart: {s}");
}

impl BenachrichtigungArt {
    /// Die feste Stufe der Art (design.md D4, Matrix der Spec; Katalog LLH-1142 E1). Alarm sind
    /// genau Sofortmeldung, ihre Eskalation, überfälliger Auftrag, fällige Ablösung,
    /// Vermisstenmeldung und Unwetter (Warnstufe rot, erkannt im Browser, LLH-1425).
    pub const fn stufe(self) -> BenachrichtigungStufe {
        match self {
            BenachrichtigungArt::Sofortmeldung
            | BenachrichtigungArt::SofortmeldungEskaliert
            | BenachrichtigungArt::AuftragUeberfaellig
            | BenachrichtigungArt::AbloesungFaellig
            | BenachrichtigungArt::Vermisstenmeldung
            | BenachrichtigungArt::Unwetter => BenachrichtigungStufe::Alarm,
            BenachrichtigungArt::ErinnerungFaellig
            | BenachrichtigungArt::AbloesungVorwarnung
            | BenachrichtigungArt::AbloesungPlanung
            | BenachrichtigungArt::AbloesungAbloeser
            | BenachrichtigungArt::AuftragErteilt
            | BenachrichtigungArt::AuftragQuittiert
            | BenachrichtigungArt::AuftragErledigt
            | BenachrichtigungArt::Befehl
            | BenachrichtigungArt::Lagebericht
            | BenachrichtigungArt::Meldung
            | BenachrichtigungArt::RueckmeldungUeberfaellig
            | BenachrichtigungArt::LagebesprechungVorher
            | BenachrichtigungArt::LagebesprechungFaellig
            | BenachrichtigungArt::NachforderungStatus
            | BenachrichtigungArt::Gefahr
            | BenachrichtigungArt::SichtungEins
            | BenachrichtigungArt::WiederVerfuegbar
            | BenachrichtigungArt::ChatErwaehnung
            | BenachrichtigungArt::EinsatzAufnahme
            | BenachrichtigungArt::EinsatzNeu => BenachrichtigungStufe::Hinweis,
        }
    }

    /// Org-Arten gehen über den Org-Kanal (`org_benachrichtigung`), nicht über den Einsatz-Strom:
    /// ihr Empfänger hat den Einsatz typischerweise nicht offen (design.md D2).
    pub const fn ist_org(self) -> bool {
        matches!(
            self,
            BenachrichtigungArt::EinsatzAufnahme | BenachrichtigungArt::EinsatzNeu
        )
    }

    /// Arten, die nur als Schalter in den Einstellungen bestehen und nie gemeldet werden.
    pub const fn nur_einstellung(self) -> bool {
        matches!(self, BenachrichtigungArt::Unwetter)
    }

    /// Ob die Art am Einsatz je Funktion still gestellt werden kann (LLH-1421, design.md D2):
    /// nur Arten der Stufe Eingang, keine Org-Art (die erreicht den Empfänger außerhalb des
    /// Einsatzes) und nicht `unwetter` (erkennt der Browser selbst). Alarme nie.
    pub const fn vorgabe_einstellbar(self) -> bool {
        matches!(self.stufe(), BenachrichtigungStufe::Hinweis)
            && !self.ist_org()
            && !self.nur_einstellung()
    }

    /// Die Vorgabe des Katalogs, solange die Einsatzleitung für die Art nichts festgelegt hat
    /// (LLH-1421, design.md D2; Entscheidung zu LLH-1142 E2): `true` = für jede Funktion still.
    /// Heute nur „Lagebericht freigegeben“; er steht im Verlauf, ohne zu zählen.
    pub const fn vorgabe_still(self) -> bool {
        matches!(self, BenachrichtigungArt::Lagebericht)
    }
}

wire_enum! {
    /// Wozu eine Benachrichtigung gehört. Der Bezug bestimmt das Modul, das ein Empfänger sehen
    /// muss ([`BenachrichtigungBezugTyp::modul`]), den Sprungpfad und die Detailzeile ([`text`]).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum BenachrichtigungBezugTyp {
        /// Der Einsatz selbst (Org-Arten); `bezug_id` ist die Einsatzkennung.
        Einsatz => "einsatz",
        Meldung => "meldung",
        /// Eine Meldung (`meldung.id`), die gerade in die Lage übernommen wurde (LLH-1062). Wie bei
        /// der Ablösung steckt das Ereignis im Bezug, damit die Übernahme ohne neue Art (und ohne
        /// Tabellenumbau) einen eigenen Titel und Sprung hat. Die Kennung ist die Meldung, nicht
        /// das Lageobjekt.
        LageUebernahme => "lage_uebernahme",
        Auftrag => "auftrag",
        /// Eine Empfänger-Zeile eines Auftrags (`auftrag_empfaenger.id`), für die Quittung: die
        /// Detailzeile nennt den quittierenden Empfänger, der Sprung führt zum Auftrag.
        AuftragEmpfaenger => "auftrag_empfaenger",
        Befehl => "befehl",
        Lagebericht => "lagebericht",
        Erinnerung => "erinnerung",
        /// Eine Schicht des Ablösungsmoduls (`einsatz_abloesung.id`).
        Abloesung => "abloesung",
        /// Eine Schicht (`einsatz_abloesung.id`) mit dem, was ihre geplante ablösende Einheit
        /// getan hat (LLH-1131): alarmiert, eingetroffen, am Bereitstellungsraum eingetroffen,
        /// abgerufen, oder dass ihre Planung entfallen ist. Wie bei der Nachforderung steckt das
        /// Ereignis im Bezug, weil die Zeile keinen Text trägt (design.md D1).
        AbloeserAlarmiert => "abloeser_alarmiert",
        AbloeserEingetroffen => "abloeser_eingetroffen",
        AbloeserBrEingetroffen => "abloeser_br_eingetroffen",
        AbloeserAbgerufen => "abloeser_abgerufen",
        AbloeserEntfallen => "abloeser_entfallen",
        /// Die Alarmierung bzw. das Eintreffen, mit dem die offene Periode der geplanten
        /// ablösenden Einheit begann, ist in der Kräfte-Zeitachse gestrichen (LLH-1425): der
        /// Hinweis „alarmiert“ bzw. „eingetroffen“ gilt nicht mehr.
        AbloeserAlarmierungGestrichen => "abloeser_alarmierung_gestrichen",
        AbloeserEintreffenGestrichen => "abloeser_eintreffen_gestrichen",
        /// Der Termin der Lagebesprechung am Einsatz; `bezug_id` ist die Einsatzkennung.
        Lagebesprechung => "lagebesprechung",
        Nachforderung => "nachforderung",
        /// Eine Nachforderung (`nachforderung.id`) mit dem Status, in den sie gewechselt ist
        /// (`nachforderung_status`, LLH-1216). Der Status steckt im Bezug, weil die Zeile keinen
        /// Text trägt (design.md D1) und die Nachforderung beim Lesen schon weiter sein kann; so
        /// nennt jeder Hinweis den Status seines Wechsels.
        NachforderungZugesagt => "nachforderung_zugesagt",
        NachforderungUnterwegs => "nachforderung_unterwegs",
        NachforderungEingetroffen => "nachforderung_eingetroffen",
        NachforderungAbgelehnt => "nachforderung_abgelehnt",
        Gefahrengebiet => "gefahrengebiet",
        /// Betroffene Person (`einsatz_person.id`).
        Person => "person",
        /// Einheit im Einsatz (`einsatz_einheit.id`).
        Einheit => "einheit",
        /// Disponiertes Fahrzeug (`einsatz_fahrzeug.id`).
        Fahrzeug => "fahrzeug",
        ChatNachricht => "chat_nachricht",
    }
    try_from = |s| format!("Ungültiger Bezug: {s}");
}

impl BenachrichtigungBezugTyp {
    /// Das Modul, dem das Bezugsobjekt gehört. Ein Empfänger MUSS es lesen dürfen, beim Melden
    /// und erneut beim Lesen (Spec „Der Server bestimmt die Empfänger“). `None` heißt: nur der
    /// Einsatz selbst muss lesbar sein.
    ///
    /// Dieselbe Füll-Regel wie [`LiveEvent::modul_keys`]: das Modul des Datenobjekts, nicht das
    /// der auslösenden Route.
    pub const fn modul(self) -> Option<&'static str> {
        match self {
            BenachrichtigungBezugTyp::Einsatz => None,
            BenachrichtigungBezugTyp::Meldung => Some("meldungen"),
            BenachrichtigungBezugTyp::LageUebernahme => Some("lagemeldungen"),
            // Befehle sind Teil des Auftrags-Moduls (`routes::befehl::MODUL_KEY`).
            BenachrichtigungBezugTyp::Auftrag
            | BenachrichtigungBezugTyp::AuftragEmpfaenger
            | BenachrichtigungBezugTyp::Befehl => Some("auftraege"),
            BenachrichtigungBezugTyp::Lagebericht => Some("lageberichte"),
            BenachrichtigungBezugTyp::Erinnerung => Some("erinnerungen"),
            BenachrichtigungBezugTyp::Abloesung
            | BenachrichtigungBezugTyp::AbloeserAlarmiert
            | BenachrichtigungBezugTyp::AbloeserEingetroffen
            | BenachrichtigungBezugTyp::AbloeserBrEingetroffen
            | BenachrichtigungBezugTyp::AbloeserAbgerufen
            | BenachrichtigungBezugTyp::AbloeserEntfallen
            | BenachrichtigungBezugTyp::AbloeserAlarmierungGestrichen
            | BenachrichtigungBezugTyp::AbloeserEintreffenGestrichen => Some("abloesung"),
            BenachrichtigungBezugTyp::Lagebesprechung => Some("lagebesprechung"),
            BenachrichtigungBezugTyp::Nachforderung
            | BenachrichtigungBezugTyp::NachforderungZugesagt
            | BenachrichtigungBezugTyp::NachforderungUnterwegs
            | BenachrichtigungBezugTyp::NachforderungEingetroffen
            | BenachrichtigungBezugTyp::NachforderungAbgelehnt => Some("nachforderungen"),
            // Die Spec meldet eine neue Gefahr an die Leser der Lagekarte und springt dorthin;
            // die Karte zeigt das Gebiet (`lagekartePfad` mit `gefahrengebiet`).
            BenachrichtigungBezugTyp::Gefahrengebiet => Some("lagekarte"),
            BenachrichtigungBezugTyp::Person => Some("personen"),
            BenachrichtigungBezugTyp::Einheit => Some("einheiten"),
            BenachrichtigungBezugTyp::Fahrzeug => Some("fahrzeuge"),
            BenachrichtigungBezugTyp::ChatNachricht => Some("chat"),
        }
    }
}

/// Das Objekt, auf das eine Benachrichtigung verweist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bezug {
    pub typ: BenachrichtigungBezugTyp,
    pub id: i64,
}

impl Bezug {
    pub const fn neu(typ: BenachrichtigungBezugTyp, id: i64) -> Self {
        Self { typ, id }
    }
}

/// Wer eine Benachrichtigung bekommen soll, als Vorgabe des Schreibwegs (design.md D3). Die
/// Auflösung in Nutzer und alle Ausschlüsse übernimmt [`aufloesung::empfaenger`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Adressat {
    /// Die Nutzer, die die Funktion im Einsatz besetzen: Stab-Besetzung (EL: Einsatzleiter der
    /// Führungsstelle), ersatzweise die Funktion der Mitgliedschaft (Spec „Meine Funktion“).
    Funktion(Fuehrungsfunktion),
    /// Der Nutzer, der mit diesem Einsatzpersonal (`einsatz_personal.id`) verknüpft ist; ohne
    /// Verknüpfung niemand.
    Person(i64),
    /// Genau dieser Nutzer.
    Nutzer(i64),
    /// Alle Mitglieder des Einsatzes, die dieses Modul lesen dürfen.
    ModulLeser(&'static str),
    /// Alle Mitglieder des Einsatzes mit Schreibrecht (Einsatzleitung, Führungspersonal), die
    /// dieses Modul erreichen: wer eine Meldung bearbeiten kann, nie ein Beobachter (LLH-1062).
    ModulSchreiber(&'static str),
    /// Die Führungskräfte und Admins der Einsatz-Organisation, die den Einsatz ohne
    /// Mitgliedschaft lesen dürfen (für `einsatz_neu`).
    Fuehrungskraefte,
}

/// Was geschah: die eine Eingabe von [`melden`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anlass {
    pub einsatz_id: i64,
    pub art: BenachrichtigungArt,
    pub bezug: Bezug,
    /// Wer das Ereignis ausgelöst hat; `None` beim Scheduler. Der Auslöser bekommt nie eine
    /// Benachrichtigung dafür (Spec „Eigene Aktionen benachrichtigen den Auslöser nicht“).
    pub ausloeser: Option<i64>,
    pub adressaten: Vec<Adressat>,
}

impl Anlass {
    /// Ein Anlass ohne Auslöser und ohne Adressaten; [`Self::von`] und [`Self::an`] ergänzen.
    pub fn neu(einsatz_id: i64, art: BenachrichtigungArt, bezug: Bezug) -> Self {
        Self {
            einsatz_id,
            art,
            bezug,
            ausloeser: None,
            adressaten: Vec::new(),
        }
    }

    /// Setzt den Auslöser (den angemeldeten Nutzer des Schreibwegs).
    pub fn von(mut self, benutzer_id: i64) -> Self {
        self.ausloeser = Some(benutzer_id);
        self
    }

    /// Fügt einen Adressaten hinzu.
    pub fn an(mut self, adressat: Adressat) -> Self {
        self.adressaten.push(adressat);
        self
    }
}

/// Nutzlast des Live-Ereignisses `benachrichtigung` (Einsatz-Strom) und
/// `org_benachrichtigung` (Org-Kanal). Nur Kennungen und Kataloge (F01): den Text holt der
/// Client über `GET /api/benachrichtigungen/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenachrichtigungEreignis {
    pub einsatz_id: i64,
    pub benachrichtigung_id: i64,
    pub art: BenachrichtigungArt,
    pub stufe: BenachrichtigungStufe,
    pub bezug_typ: BenachrichtigungBezugTyp,
    pub bezug_id: i64,
    /// `true`: der Empfänger hat sie quittiert, ihre Toasts auf seinen anderen Verbindungen
    /// verschwinden (Spec „Quittieren gilt für alle Verbindungen des Nutzers“).
    pub quittiert: bool,
    /// „Alle gelesen“ (LLH-1143, design.md D4): der Empfänger hat seine Eingänge dieses Einsatzes
    /// bis einschließlich dieser Kennung gelesen. Steht nur am Quittier-Ereignis von
    /// `POST …/benachrichtigungen/gelesen`; die übrigen Felder nennen die jüngste davon, ein
    /// älterer Client liest es als deren Einzelquittung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gelesen_bis: Option<i64>,
}

/// Der Verlauf eines Einsatzes für den Knopf „Eingänge“ (LLH-1143, design.md D3): die jüngsten
/// eigenen Benachrichtigungen samt Text und die Zahl der ungelesenen Eingänge darunter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenachrichtigungVerlauf {
    /// Jüngste zuerst, höchstens [`repo::LISTE_MAX`]; ohne die, deren Modul der Nutzer nicht
    /// (mehr) lesen darf.
    pub eintraege: Vec<BenachrichtigungAnzeige>,
    /// Ungelesene Eingänge (Stufe `hinweis`, unquittiert) unter `eintraege`; Alarme und Stilles
    /// zählen nie.
    pub ungelesen: i64,
}

/// Eine Benachrichtigung mit ihrem Text, wie der Empfänger sie liest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenachrichtigungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub art: BenachrichtigungArt,
    pub stufe: BenachrichtigungStufe,
    pub bezug_typ: BenachrichtigungBezugTyp,
    pub bezug_id: i64,
    pub erstellt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quittiert_at: Option<String>,
    /// Überschrift je Art, etwa „Neuer Auftrag“.
    pub titel: String,
    /// Kennung des Bezugs ohne Inhalte Betroffener, etwa „Auftrag #12“; fehlt, wo es keine gibt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Sprungziel im Frontend (Muster aus `frontend/src/routing/deeplinks.ts`).
    pub pfad: String,
}

/// Meldet einen Anlass nach dem Commit: Empfänger auflösen, je Empfänger eine Zeile schreiben,
/// je Zeile das Ereignis zustellen. Liefert die Empfänger (Nutzerkennungen, aufsteigend).
///
/// Wie bei den Org-Ereignissen lässt ein Fehler die schon committete Anfrage nicht scheitern:
/// er wird geloggt, und niemand wird benachrichtigt.
pub async fn melden(pool: &SqlitePool, live: &LiveHub, anlass: Anlass) -> Vec<i64> {
    match melden_mit_fehler(pool, live, &anlass).await {
        Ok(empfaenger) => empfaenger,
        Err(e) => {
            tracing::warn!(
                einsatz_id = anlass.einsatz_id,
                art = anlass.art.as_str(),
                fehler = %e,
                "Benachrichtigung nicht gemeldet"
            );
            Vec::new()
        }
    }
}

async fn melden_mit_fehler(
    pool: &SqlitePool,
    live: &LiveHub,
    anlass: &Anlass,
) -> Result<Vec<i64>, crate::error::AppError> {
    if anlass.art.nur_einstellung() {
        tracing::warn!(
            art = anlass.art.as_str(),
            "Art besteht nur in den Einstellungen und wird nicht gemeldet"
        );
        return Ok(Vec::new());
    }
    let aufgeloest = aufloesung::empfaenger(pool, anlass).await?;
    let mit_stufe = mit_stufe(anlass, &aufgeloest.benutzer_ids, &aufgeloest.still_ids);
    ausliefern(pool, live, anlass, aufgeloest.org_id, &mit_stufe).await?;
    Ok(aufgeloest.benutzer_ids)
}

/// Je Empfänger seine Stufe: die der Art, für die Stillen `still` (LLH-1143, design.md D2).
fn mit_stufe(
    anlass: &Anlass,
    benutzer_ids: &[i64],
    still_ids: &[i64],
) -> Vec<(i64, BenachrichtigungStufe)> {
    benutzer_ids
        .iter()
        .map(|&id| (id, anlass.art.stufe()))
        .chain(
            still_ids
                .iter()
                .map(|&id| (id, BenachrichtigungStufe::Still)),
        )
        .collect()
}

/// Schreibt je aufgelöstem Empfänger eine Zeile mit seiner Stufe und stellt sie zu (Live, Web
/// Push). Nur für Empfänger, die [`aufloesung::empfaenger`] für diesen Anlass geliefert hat.
async fn ausliefern(
    pool: &SqlitePool,
    live: &LiveHub,
    anlass: &Anlass,
    org_id: i64,
    mit_stufe: &[(i64, BenachrichtigungStufe)],
) -> Result<(), crate::error::AppError> {
    if mit_stufe.is_empty() {
        return Ok(());
    }
    let zeilen = repo::anlegen(pool, anlass, mit_stufe).await?;
    let ereignisse: Vec<(i64, BenachrichtigungEreignis)> = zeilen
        .into_iter()
        .map(|(benutzer_id, stufe, id)| {
            (
                benutzer_id,
                BenachrichtigungEreignis {
                    einsatz_id: anlass.einsatz_id,
                    benachrichtigung_id: id,
                    art: anlass.art,
                    stufe,
                    bezug_typ: anlass.bezug.typ,
                    bezug_id: anlass.bezug.id,
                    quittiert: false,
                    gelesen_bis: None,
                },
            )
        })
        .collect();
    zustellen(live, org_id, anlass.einsatz_id, anlass.art, &ereignisse);
    // Web Push an die Geräte der Empfänger (LLH-1223, Spec `web-push`): dieselbe Nutzlast wie
    // das Live-Ereignis, in einem eigenen Task; ohne `--web-push` nichts.
    if let Some(web_push) = live.web_push() {
        web_push.versenden(
            pool,
            ereignisse
                .iter()
                // Stilles erreicht kein Gerät (design.md D2): es ist schon gelesen.
                .filter(|(_, e)| e.stufe != BenachrichtigungStufe::Still)
                .map(|(benutzer_id, e)| crate::web_push::Sendung {
                    benutzer_id: *benutzer_id,
                    nutzlast: serde_json::to_string(e).expect("Nutzlast serialisierbar"),
                    alarm: e.stufe == BenachrichtigungStufe::Alarm,
                })
                .collect(),
        );
    }
    Ok(())
}

/// Erledigt die offenen Benachrichtigungen der Art `art` zu den Bezügen `typ`/`ids` für ALLE
/// Empfänger: der Anlass ist für jeden erledigt, etwa eine gesichtete Meldung (LLH-1062, Spec
/// „Sichten räumt den Hinweis bei allen“). Jeder Empfänger bekommt sein Quittier-Ereignis wie beim
/// eigenen Quittieren, auf allen Verbindungen. Wie [`melden`] lässt ein Fehler die committete
/// Anfrage nicht scheitern. Liefert die Zahl der erledigten Zeilen.
pub async fn erledigen(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    typ: BenachrichtigungBezugTyp,
    ids: &[i64],
) -> usize {
    if ids.is_empty() {
        return 0;
    }
    let zeilen = match repo::quittieren_fuer_bezug(pool, einsatz_id, art, typ, ids).await {
        Ok(z) => z,
        Err(e) => {
            tracing::warn!(einsatz_id, art = art.as_str(), fehler = %e, "Benachrichtigungen nicht erledigt");
            return 0;
        }
    };
    quittiert_zustellen(pool, live, einsatz_id, art, &zeilen).await;
    zeilen.len()
}

/// Stellt jedem Empfänger der gerade quittierten `zeilen` sein Quittier-Ereignis zu, wie beim
/// eigenen Quittieren.
async fn quittiert_zustellen(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    zeilen: &[repo::Zeile],
) {
    if zeilen.is_empty() {
        return;
    }
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    if let Some(org_id) = org_id {
        let ereignisse: Vec<(i64, BenachrichtigungEreignis)> = zeilen
            .iter()
            .map(|z| {
                (
                    z.benutzer_id,
                    BenachrichtigungEreignis {
                        einsatz_id: z.einsatz_id,
                        benachrichtigung_id: z.id,
                        art: z.art,
                        stufe: z.stufe,
                        bezug_typ: z.bezug_typ,
                        bezug_id: z.bezug_id,
                        quittiert: true,
                        gelesen_bis: None,
                    },
                )
            })
            .collect();
        zustellen(live, org_id, einsatz_id, art, &ereignisse);
    }
}

/// Richtet die Benachrichtigungen eines Bezugs neu aus, wenn sich sein Adressat ändert (LLH-1381:
/// korrigierte Empfängerfunktion einer Meldung). `neu` ist der Anlass nach dem neuen Stand,
/// `None`, wenn er keinen mehr hat; Art und Bezug stehen in `art`/`bezug`. Wer nach
/// [`aufloesung::empfaenger`] nicht mehr gemeint ist, dessen offene Zeile ist erledigt (mit
/// Quittier-Ereignis); wer gemeint ist und zu diesem Bezug noch nie eine Zeile hatte, bekommt eine.
/// Wer schon eine hat, offen oder selbst quittiert, behält sie und bekommt keine zweite: je Person
/// höchstens ein Hinweis zum Bezug. Wie [`melden`] lässt ein Fehler die committete Anfrage nicht
/// scheitern.
pub async fn umadressieren(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
    neu: Option<Anlass>,
) {
    if let Err(e) = umadressieren_mit_fehler(pool, live, einsatz_id, art, bezug, neu).await {
        tracing::warn!(einsatz_id, art = art.as_str(), fehler = %e, "Benachrichtigungen nicht umadressiert");
    }
}

async fn umadressieren_mit_fehler(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
    neu: Option<Anlass>,
) -> Result<(), crate::error::AppError> {
    debug_assert!(neu
        .as_ref()
        .is_none_or(|a| a.einsatz_id == einsatz_id && a.art == art && a.bezug == bezug));
    let aufgeloest = match &neu {
        Some(anlass) => Some(aufloesung::empfaenger(pool, anlass).await?),
        None => None,
    };
    // Gemeint sind auch die Stillen (LLH-1143): ihre Zeile bleibt, sie ist nur schon gelesen.
    let gemeint: Vec<i64> = aufgeloest.as_ref().map_or_else(Vec::new, |a| {
        a.benutzer_ids.iter().chain(&a.still_ids).copied().collect()
    });
    let erledigt =
        repo::quittieren_fuer_bezug_ausser(pool, einsatz_id, art, bezug.typ, bezug.id, &gemeint)
            .await?;
    quittiert_zustellen(pool, live, einsatz_id, art, &erledigt).await;
    let (Some(anlass), Some(aufgeloest)) = (neu, aufgeloest) else {
        return Ok(());
    };
    let hatten = repo::empfaenger_des_bezugs(pool, einsatz_id, art, bezug.typ, bezug.id).await?;
    let dazu: Vec<(i64, BenachrichtigungStufe)> =
        mit_stufe(&anlass, &aufgeloest.benutzer_ids, &aufgeloest.still_ids)
            .into_iter()
            .filter(|(id, _)| !hatten.contains(id))
            .collect();
    ausliefern(pool, live, &anlass, aufgeloest.org_id, &dazu).await
}

/// „Alle gelesen“ (LLH-1143, design.md D4): quittiert die eigenen Zeilen von `benutzer_id` im
/// Einsatz bis einschließlich `bis_id`, außer Alarmen (die quittiert jeder einzeln, Spec), und
/// meldet es seinen Verbindungen mit EINEM Quittier-Ereignis samt `gelesen_bis` — nie eines je
/// Zeile, das drängte bei vielen Eingängen die anderen Clients in `lagged`. Liefert die Zahl der
/// jetzt gelesenen Zeilen.
pub async fn gelesen_bis(
    pool: &SqlitePool,
    live: &LiveHub,
    org_id: i64,
    einsatz_id: i64,
    benutzer_id: i64,
    bis_id: i64,
) -> Result<usize, crate::error::AppError> {
    let zeilen = repo::gelesen_bis(pool, benutzer_id, einsatz_id, bis_id).await?;
    if let Some(j) = zeilen.iter().max_by_key(|z| z.id) {
        let ereignis = BenachrichtigungEreignis {
            einsatz_id,
            benachrichtigung_id: j.id,
            art: j.art,
            stufe: j.stufe,
            bezug_typ: j.bezug_typ,
            bezug_id: j.bezug_id,
            quittiert: true,
            gelesen_bis: Some(bis_id),
        };
        zustellen(live, org_id, einsatz_id, j.art, &[(benutzer_id, ereignis)]);
    }
    Ok(zeilen.len())
}

/// Stellt die Ereignisse einer Art und eines Einsatzes zu, je `(benutzer_id, Ereignis)` genau
/// an diesen Nutzer. Einsatz-Arten gehen als EINE Nachricht in den Einsatz-Strom (ein Platz im
/// Ring, gleich wie viele Empfänger), jede Verbindung bekommt nur die Nutzlast ihres Nutzers;
/// Org-Arten gehen einzeln über den Org-Kanal (ohne Ring). Auch das Quittier-Ereignis geht
/// diesen Weg, dann mit einem einzigen Eintrag.
pub fn zustellen(
    live: &LiveHub,
    org_id: i64,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    ereignisse: &[(i64, BenachrichtigungEreignis)],
) {
    let nutzlast = |e: &BenachrichtigungEreignis| {
        debug_assert!(e.einsatz_id == einsatz_id && e.art == art);
        serde_json::to_string(e).expect("Nutzlast serialisierbar")
    };
    if art.ist_org() {
        for (benutzer_id, e) in ereignisse {
            live.publiziere_org_benachrichtigung(org_id, nutzlast(e), vec![*benutzer_id]);
        }
    } else {
        live.publiziere_an(
            einsatz_id,
            LiveEvent::Benachrichtigung,
            ereignisse
                .iter()
                .map(|(benutzer_id, e)| Zustellung {
                    benutzer_id: *benutzer_id,
                    data: nutzlast(e).into(),
                })
                .collect(),
        );
    }
}
