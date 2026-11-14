//! Webhooks: signierte Zustellung der Ausgangsereignisse an Fremdsysteme (LLH-1656, Spec
//! `webhook-zustellung`, Herleitung
//! `openspec/changes/archive/2026-11-14-z6ds0ed9-webhooks-outbox/design.md`).
//!
//! Der zweite Leser der Outbox `maschine_ereignis` (der erste ist der Abruf in
//! [`super::events`]). **Dieses Modul schreibt nie in die Outbox** (ADR-0038); es liest die Zeilen
//! seines Zugangs und hält seinen eigenen Stand in `maschine_webhook`.
//!
//! - [`ziel`]: Schutz vor internen Zielen, LAN-Ausnahme, der HTTP-Weg (D5).
//! - [`zustand`]: Backoff und Anhalten als reine Funktion (D6).
//! - [`repo`]: Webhook und Verlauf in der Datenbank (D1, D7).
//! - [`lauf`]: der Hintergrundlauf, der der Reihe nach zustellt (D3).
//!
//! Regeln: `src/AGENTS.md`, „Webhooks“, und die ADR der Webhooks.

pub mod lauf;
pub mod repo;
pub mod ziel;
pub mod zustand;

use std::time::Duration;

use serde::Serialize;
use utoipa::ToSchema;

use crate::wire_enum::wire_enum;

/// Abstand zweier Durchgänge des Laufs (D3).
pub const TAKT: Duration = Duration::from_secs(2);

/// Höchstzahl der Ereignisse, die ein Webhook je Durchgang zugestellt bekommt; der Rest folgt im
/// nächsten, damit ein großer Rückstand die übrigen Webhooks nicht aushungert.
pub const MAX_JE_TAKT: usize = 50;

/// Wie viele Webhooks gleichzeitig beliefert werden.
pub const PARALLEL: usize = 8;

/// Höchstzahl der Einträge im Verlauf je Webhook.
pub const VERLAUF_MAX: i64 = 50;

/// Gesamtzeit einer Zustellung, Verbindungsaufbau eingeschlossen. Liegt unter
/// `zulassung::REQUEST_BUDGET`, weil das Testereignis in einer Anfrage wartet.
pub const ZEITLIMIT: Duration = Duration::from_secs(15);

/// Zeit für den Verbindungsaufbau.
pub const VERBINDUNG_ZEITLIMIT: Duration = Duration::from_secs(5);

/// Höchstlänge der Ziel-URL (Zeichen).
pub const URL_MAX: usize = 2048;

/// Kopf mit der Nummer des Ereignisses, zum Entdoppeln vor dem Parsen (nicht signiert;
/// maßgeblich ist `id` im signierten Body).
pub const EVENT_ID_KOPF: &str = "Lifeline-Event-Id";

wire_enum! {
    /// Zustand eines Webhooks, wie die Verwaltung ihn zeigt. `fehler` und `ruht` sind abgeleitet:
    /// `fehler` ist ein aktiver Webhook in einer Störung, `ruht` einer, dessen Zugang gerade
    /// nicht beliefert werden darf.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum WebhookZustand {
        /// Stellt zu; nichts hängt.
        Aktiv => "aktiv",
        /// Der letzte Versuch scheiterte; der nächste ist geplant.
        Fehler => "fehler",
        /// 24 h ohne Erfolg; erst ein Admin nimmt ihn wieder auf.
        Angehalten => "angehalten",
        /// Der Zugang darf gerade nicht beliefert werden (`ruht_grund`).
        Ruht => "ruht",
    }
}

wire_enum! {
    /// Warum ein Versuch scheiterte. Ein Code, nie Text des Ziels (Spec „Diagnose“).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum WebhookFehler {
        /// Das Ziel antwortete mit einem Status außerhalb von 2xx; der Status steht daneben.
        Status => "status",
        /// Das Ziel wollte weiterleiten (3xx); dem folgt der Lauf nie.
        Weiterleitung => "weiterleitung",
        /// Keine Antwort innerhalb des Zeitlimits.
        Zeitueberschreitung => "zeitueberschreitung",
        /// Die Verbindung kam nicht zustande oder brach ab.
        Verbindung => "verbindung",
        /// Das Zertifikat des Ziels wurde nicht anerkannt.
        Tls => "tls",
        /// Das Ziel liegt in einem gesperrten oder (ohne LAN-Ausnahme) privaten Netz.
        ZielIntern => "ziel_intern",
        /// Der Name des Ziels ließ sich nicht auflösen.
        Dns => "dns",
        /// Die gespeicherte Ziel-URL besteht die Prüfung nicht mehr.
        ZielUngueltig => "ziel_ungueltig",
    }
}

wire_enum! {
    /// Warum ein Webhook ruht: sein Zugang darf gerade nicht beliefert werden.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum RuhtGrund {
        /// Der Zugang wartet noch auf das Einlösen seines Codes.
        ZugangWartet => "zugang_wartet",
        /// Der Zugang ist widerrufen.
        ZugangWiderrufen => "zugang_widerrufen",
        /// „Gültig bis“ des Zugangs ist verstrichen.
        ZugangAbgelaufen => "zugang_abgelaufen",
        /// Dem Zugang fehlt das Recht `events:read`.
        OhneEventsRead => "ohne_events_read",
    }
}

/// Darf der Zugang beliefert werden? `None` heißt ja, sonst der Grund, warum der Webhook ruht.
pub fn ruht_grund(zugang: &super::zugang::Zugang, jetzt: &str) -> Option<RuhtGrund> {
    use super::scope::{Scope, ZugangZustand};
    match zugang.zustand {
        ZugangZustand::Wartet => Some(RuhtGrund::ZugangWartet),
        ZugangZustand::Widerrufen => Some(RuhtGrund::ZugangWiderrufen),
        ZugangZustand::Aktiv if zugang.is_abgelaufen(jetzt) => Some(RuhtGrund::ZugangAbgelaufen),
        ZugangZustand::Aktiv if !zugang.has_scope(Scope::EventsRead) => {
            Some(RuhtGrund::OhneEventsRead)
        }
        ZugangZustand::Aktiv => None,
    }
}
