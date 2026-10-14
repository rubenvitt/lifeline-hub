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

#[cfg(test)]
mod tests;

use crate::fuehrung::Fuehrungsfunktion;
use crate::live::{LiveEvent, LiveHub, Zustellung};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

wire_enum! {
    /// Wie laut eine Benachrichtigung ist (Spec „Drei Stufen“). Die dritte Stufe, *still*, erzeugt
    /// keine Benachrichtigung und hat deshalb keinen Wert.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum BenachrichtigungStufe {
        /// Lauter Ton, Toast, OS-Meldung bei verdecktem Tab; nicht abschaltbar.
        Alarm => "alarm",
        /// Dezenter Ton, Toast, OS-Meldung bei verdecktem Tab; je Art abschaltbar.
        Hinweis => "hinweis",
    }
    try_from = |s| format!("Ungültige BenachrichtigungStufe: {s}");
}

wire_enum! {
    /// Der geschlossene Katalog der Benachrichtigungsarten (design.md D4). Die Stufe ist je Art
    /// fest ([`BenachrichtigungArt::stufe`]); wer sie ändern will, ändert die Spec. Die
    /// CHECK-Liste in `migrations/0196_benachrichtigung.sql` spiegelt `ALLE`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum BenachrichtigungArt {
        Sofortmeldung => "sofortmeldung",
        SofortmeldungEskaliert => "sofortmeldung_eskaliert",
        AuftragUeberfaellig => "auftrag_ueberfaellig",
        AbloesungFaellig => "abloesung_faellig",
        ErinnerungFaellig => "erinnerung_faellig",
        AbloesungVorwarnung => "abloesung_vorwarnung",
        AuftragErteilt => "auftrag_erteilt",
        AuftragQuittiert => "auftrag_quittiert",
        AuftragErledigt => "auftrag_erledigt",
        Befehl => "befehl",
        Lagebericht => "lagebericht",
        Meldung => "meldung",
        LagebesprechungVorher => "lagebesprechung_vorher",
        LagebesprechungFaellig => "lagebesprechung_faellig",
        NachforderungStatus => "nachforderung_status",
        Gefahr => "gefahr",
        SichtungEins => "sichtung_eins",
        WiederVerfuegbar => "wieder_verfuegbar",
        ChatErwaehnung => "chat_erwaehnung",
        /// Org-Art: erreicht den Aufgenommenen auch außerhalb eines Einsatzes.
        EinsatzAufnahme => "einsatz_aufnahme",
        /// Org-Art: erreicht Führungskräfte, die den neuen Einsatz lesen dürfen.
        EinsatzNeu => "einsatz_neu",
        /// Nur für die Einstellungen: Unwetter erkennt der Browser selbst (design.md D4).
        Unwetter => "unwetter",
    }
    try_from = |s| format!("Ungültige Benachrichtigungsart: {s}");
}

impl BenachrichtigungArt {
    /// Die feste Stufe der Art (design.md D4, Matrix der Spec). Alarm sind genau Sofortmeldung,
    /// ihre Eskalation, überfälliger Auftrag und fällige Ablösung.
    pub const fn stufe(self) -> BenachrichtigungStufe {
        match self {
            BenachrichtigungArt::Sofortmeldung
            | BenachrichtigungArt::SofortmeldungEskaliert
            | BenachrichtigungArt::AuftragUeberfaellig
            | BenachrichtigungArt::AbloesungFaellig => BenachrichtigungStufe::Alarm,
            BenachrichtigungArt::ErinnerungFaellig
            | BenachrichtigungArt::AbloesungVorwarnung
            | BenachrichtigungArt::AuftragErteilt
            | BenachrichtigungArt::AuftragQuittiert
            | BenachrichtigungArt::AuftragErledigt
            | BenachrichtigungArt::Befehl
            | BenachrichtigungArt::Lagebericht
            | BenachrichtigungArt::Meldung
            | BenachrichtigungArt::LagebesprechungVorher
            | BenachrichtigungArt::LagebesprechungFaellig
            | BenachrichtigungArt::NachforderungStatus
            | BenachrichtigungArt::Gefahr
            | BenachrichtigungArt::SichtungEins
            | BenachrichtigungArt::WiederVerfuegbar
            | BenachrichtigungArt::ChatErwaehnung
            | BenachrichtigungArt::EinsatzAufnahme
            | BenachrichtigungArt::EinsatzNeu
            | BenachrichtigungArt::Unwetter => BenachrichtigungStufe::Hinweis,
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
}

wire_enum! {
    /// Wozu eine Benachrichtigung gehört. Der Bezug bestimmt das Modul, das ein Empfänger sehen
    /// muss ([`BenachrichtigungBezugTyp::modul`]), den Sprungpfad und die Detailzeile ([`text`]).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum BenachrichtigungBezugTyp {
        /// Der Einsatz selbst (Org-Arten); `bezug_id` ist die Einsatzkennung.
        Einsatz => "einsatz",
        Meldung => "meldung",
        Auftrag => "auftrag",
        Befehl => "befehl",
        Lagebericht => "lagebericht",
        Erinnerung => "erinnerung",
        /// Eine Schicht des Ablösungsmoduls (`einsatz_abloesung.id`).
        Abloesung => "abloesung",
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
            // Befehle sind Teil des Auftrags-Moduls (`routes::befehl::MODUL_KEY`).
            BenachrichtigungBezugTyp::Auftrag | BenachrichtigungBezugTyp::Befehl => {
                Some("auftraege")
            }
            BenachrichtigungBezugTyp::Lagebericht => Some("lageberichte"),
            BenachrichtigungBezugTyp::Erinnerung => Some("erinnerungen"),
            BenachrichtigungBezugTyp::Abloesung => Some("abloesung"),
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
    if aufgeloest.benutzer_ids.is_empty() {
        return Ok(Vec::new());
    }
    let zeilen = repo::anlegen(pool, anlass, &aufgeloest.benutzer_ids).await?;
    let ereignisse: Vec<(i64, BenachrichtigungEreignis)> = zeilen
        .into_iter()
        .map(|(benutzer_id, id)| {
            (
                benutzer_id,
                BenachrichtigungEreignis {
                    einsatz_id: anlass.einsatz_id,
                    benachrichtigung_id: id,
                    art: anlass.art,
                    stufe: anlass.art.stufe(),
                    bezug_typ: anlass.bezug.typ,
                    bezug_id: anlass.bezug.id,
                    quittiert: false,
                },
            )
        })
        .collect();
    zustellen(
        live,
        aufgeloest.org_id,
        anlass.einsatz_id,
        anlass.art,
        &ereignisse,
    );
    Ok(aufgeloest.benutzer_ids)
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
