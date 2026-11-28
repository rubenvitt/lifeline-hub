//! Modul-Registry des Backends (LFH-132) — minimale Source of Truth für die
//! gültigen Modul-Keys, die nicht-ausblendbaren Module und das Rollen-Vokabular
//! der Override-Validierung.
//!
//! **Spiegel zur Frontend-`modulRegistry.ts`:** Die Key-Menge MUSS mit der FE-Registry
//! synchron bleiben (`backend_modul_keys_decken_frontend_registry` in
//! `tests/modul_override.rs` fängt Drift). Das Backend braucht
//! nur die Keys + die ausblendbar-Eigenschaft — Labels/Icons/Routen bleiben rein FE.

/// Alle gültigen Modul-Keys (Spiegel der Frontend-`modulRegistry`-`key`-Werte).
/// Reihenfolge wie in der FE-Registry (Kategorie für Kategorie) — rein dokumentarisch.
pub const MODUL_KEYS: [&str; 34] = [
    // Führung (Neuentwurf 21.09.2026: Überblick als Startseite, Aufträge hierher verschoben;
    // y3zh5ymv D10: das ETB als Führungsmittel direkt dahinter)
    "ueberblick",
    "etb",
    "einsatzdaten",
    "einsatzabschnitte",
    "auftraege",
    "lagebesprechung",
    "dokumente",
    // Kräfte & Mittel (Kräfteübersicht = `kraefteuebersicht`, bis 21.09.2026 unter Lage)
    "kraefteuebersicht",
    "einheiten",
    "personal",
    "fahrzeuge",
    "material",
    "verpflegung",
    "bereitstellungsraeume",
    "nachforderungen",
    "abloesung",
    // Betroffene (Schlüssel der Kategorie im Frontend: `erfassung`)
    "personen",
    "unfallhilfsstellen",
    // LLH-1034: Räumung (Bezirke, Stand evakuiert) als eigenes Modul vor der Betreuung.
    "evakuierung",
    "betreuung",
    "tiere",
    "schaeden",
    // Lage
    "lage-dashboard",
    "lagekarte",
    "lageberichte",
    "gefahrenzonen",
    "wetter-pegel",
    "lagemeldungen",
    // Kommunikation
    "chat",
    "erinnerungen",
    "meldungen",
    "fernmeldewesen",
    // i6k6mzed: das Informationstelefon ist ein eigenes Modul statt einer Unterseite des Stabs.
    "infotelefon",
    // Einstellungen
    "einsatz-einstellungen",
];

/// Module, die nicht ausgeblendet werden dürfen (Selbst-Aussperr-Schutz): Stammdaten
/// und die Einstellungen selbst. Auf diesen Keys ignoriert der Guard ein `sichtbar=false`,
/// und die Setz-Route lehnt einen Ausblend-Versuch ab.
pub const NICHT_AUSBLENDBAR: [&str; 2] = ["einsatzdaten", "einsatz-einstellungen"];

/// Gültige Werte für `benoetigte_rolle`: `admin` und `fuehrungskraft` prüfen System- bzw.
/// Org-Rolle (LFH-129), `einsatzfuehrung` zusätzlich die Rolle im Einsatz (LFH-1150, Spec
/// `modul-freigabe`). Auswertung: [`crate::einsatz::berechtigung::modul_freigabe`].
pub const BENOETIGTE_ROLLEN: [&str; 3] = ["admin", "fuehrungskraft", "einsatzfuehrung"];

/// Ob `key` ein in der Registry bekannter Modul-Key ist.
pub fn ist_gueltiger_modul_key(key: &str) -> bool {
    MODUL_KEYS.contains(&key)
}

/// Ob das Modul ausgeblendet werden darf (alle außer den nicht-ausblendbaren).
/// Defensiv auch für unbekannte Keys `true` — die Key-Gültigkeit prüft der Aufrufer separat.
pub fn ist_ausblendbar(key: &str) -> bool {
    !NICHT_AUSBLENDBAR.contains(&key)
}

/// Ob `rolle` ein gültiger `benoetigte_rolle`-Wert ist (für die Eingabe-Validierung).
pub fn ist_gueltige_benoetigte_rolle(rolle: &str) -> bool {
    BENOETIGTE_ROLLEN.contains(&rolle)
}

/// Compile-time-Marker (LFH-230): bindet einen Einsatz-Gate-Extractor an einen
/// Modul-Key — oder an KEIN Modul-Gate ([`OhneModul`]). Der Extractor liest `KEY`
/// und erzwingt `fordere_modul_zugriff` genau dann, wenn `Some`.
pub trait ModulMarker {
    const KEY: Option<&'static str>;
}

/// Marker für modul-lose Gate-Routen (Einsatz-Kopfdaten, Anhänge): kein Modul-Gate.
pub struct OhneModul;
impl ModulMarker for OhneModul {
    const KEY: Option<&'static str> = None;
}

/// Erzeugt je Eintrag einen Marker-Typ + dessen `ModulMarker`-Impl und sammelt
/// alle (Typname, Key)-Paare in `MARKER_KEYS` — die Tabelle, die der Struktur-Guard
/// (`tests/einsatz_kontext_guard.rs`) liest, um den Marker einer Handler-Signatur
/// gegen die Pfad→Key-Registry zu prüfen. Neue Module: hier eine Zeile ergänzen.
macro_rules! modul_marker {
    ($($typ:ident => $key:literal),+ $(,)?) => {
        $(
            #[doc = concat!("Modul-Marker für den Key `", $key, "`.")]
            pub struct $typ;
            impl ModulMarker for $typ {
                const KEY: Option<&'static str> = Some($key);
            }
        )+
        /// (Marker-Typname → Modul-Key), inkl. `OhneModul`. Vom Guard gelesen.
        pub const MARKER_KEYS: &[(&str, Option<&str>)] = &[
            ("OhneModul", None),
            $((stringify!($typ), Some($key)),)+
        ];
    };
}

modul_marker! {
    Meldungen => "meldungen",
    Lagemeldungen => "lagemeldungen",
    Auftraege => "auftraege",
    Lagebesprechung => "lagebesprechung",
    Lagekarte => "lagekarte",
    Fernmeldewesen => "fernmeldewesen",
    Infotelefon => "infotelefon",
    Dokumente => "dokumente",
    Abloesung => "abloesung",
    Betreuung => "betreuung",
    Evakuierung => "evakuierung",
    Verpflegung => "verpflegung",
    WetterPegel => "wetter-pegel",
    Schaeden => "schaeden",
    Tiere => "tiere",
    Bereitstellungsraeume => "bereitstellungsraeume",
    Fahrzeuge => "fahrzeuge",
    Personal => "personal",
    Material => "material",
    Unfallhilfsstellen => "unfallhilfsstellen",
    Gefahrenzonen => "gefahrenzonen",
    Einsatzabschnitte => "einsatzabschnitte",
    Personen => "personen",
    Einheiten => "einheiten",
    Chat => "chat",
    Etb => "etb",
    Erinnerungen => "erinnerungen",
    Nachforderungen => "nachforderungen",
}

/// Pfad-Präfix (app.rs-Route) → erwarteter Modul-Key (LFH-230). `None` = modul-lose
/// Gate-Route. Der **längste** passende Präfix gewinnt (`…/lage/meldungen` ist ein
/// eigener Eintrag, kein Kind von `…/meldungen`). Wächst pro migriertem Modul; nur
/// nicht-DEFERRED-Routen (die der Guard prüft) müssen eingetragen sein. Der Guard
/// gleicht diese Tabelle gegen die Marker in den Handler-Signaturen ab.
pub const PFAD_KEY: &[(&str, Option<&str>)] = &[
    (
        "/api/incidents/{id}/situation/reports",
        Some("lagemeldungen"),
    ),
    // LLH-1031: Kenntnisnahme der Lagemeldungen, auch unter der Kennung der Meldung.
    ("/api/incidents/{id}/situation/seen", Some("lagemeldungen")),
    (
        "/api/incidents/{id}/reports/{mid}/situation-seen",
        Some("lagemeldungen"),
    ),
    ("/api/incidents/{id}/reports", Some("meldungen")),
    // LLH-2112: Meldungsvorschläge gehören dem Modul Meldungen.
    ("/api/incidents/{id}/report-suggestions", Some("meldungen")),
    ("/api/incidents/{id}/tasks", Some("auftraege")),
    // LLH-1111: Stand und Termin unter `…/briefing`, Verlauf und Abschluss unter
    // `…/briefings` — zwei Einträge, weil der Präfixvergleich an Pfadsegmenten endet.
    ("/api/incidents/{id}/briefing", Some("lagebesprechung")),
    ("/api/incidents/{id}/briefings", Some("lagebesprechung")),
    // LLH-1180: Kommunikationsplan und Fernmeldeskizze liegen unter `…/staff`, gehören
    // aber dem Modul Fernmeldewesen (Herleitung `wgnb0am2-stab-abwaehlbar`, D4). Das Modul `stab`
    // gibt es nicht mehr (i6k6mzed, design.md D1); `…/staff` selbst ist kein Präfix.
    (
        "/api/incidents/{id}/staff/comms-plan",
        Some("fernmeldewesen"),
    ),
    (
        "/api/incidents/{id}/staff/comms-sketch",
        Some("fernmeldewesen"),
    ),
    // i6k6mzed: das Informationstelefon liegt unter `…/staff`, ist aber das eigene
    // Modul `infotelefon` (Herleitung `openspec/changes/archive/2026-11-09-i6k6mzed-stab-herausnehmen/design.md`,
    // D3).
    ("/api/incidents/{id}/staff/info-line", Some("infotelefon")),
    ("/api/incidents/{id}/documents", Some("dokumente")),
    ("/api/incidents/{id}/reliefs", Some("abloesung")),
    ("/api/incidents/{id}/care", Some("betreuung")),
    // LLH-1034: Evakuierungsbezirke und ihre Standmeldungen gehören dem eigenen Modul.
    ("/api/incidents/{id}/evacuation", Some("evakuierung")),
    ("/api/incidents/{id}/catering", Some("verpflegung")),
    ("/api/incidents/{id}/damages", Some("schaeden")),
    ("/api/incidents/{id}/animals", Some("tiere")),
    (
        "/api/incidents/{id}/staging-areas",
        Some("bereitstellungsraeume"),
    ),
    ("/api/incidents/{id}/vehicles", Some("fahrzeuge")),
    ("/api/incidents/{id}/personnel", Some("personal")),
    ("/api/incidents/{id}/material", Some("material")),
    ("/api/incidents/{id}/uhs", Some("unfallhilfsstellen")),
    // Die UHS-Belegung einer Person hängt am UHS-Modul, nicht an den Personen.
    (
        "/api/incidents/{id}/persons/{pid}/uhs-occupancy",
        Some("unfallhilfsstellen"),
    ),
    ("/api/incidents/{id}/persons", Some("personen")),
    ("/api/incidents/{id}/units", Some("einheiten")),
    ("/api/incidents/{id}/chat", Some("chat")),
    ("/api/incidents/{id}/etb", Some("etb")),
    ("/api/incidents/{id}/reminders", Some("erinnerungen")),
    (
        "/api/incidents/{id}/resource-requests",
        Some("nachforderungen"),
    ),
    // Sprechgruppen, Ort-Vorschau und die Ortssuche des Ortsfelds (LFH-1175) gehören keinem
    // Modul (wie die Einsatz-Kopfdaten).
    ("/api/incidents/{id}/talk-groups", None),
    // Die Einsatzakte (LLH-1835) prüft jedes ihrer Module im Handler, nicht im Extractor.
    ("/api/incidents/{id}/case-file", None),
    // Programmpunkte (LLH-1570) gehören wie die Kopfdaten keinem Modul.
    ("/api/incidents/{id}/agenda-items", None),
    ("/api/incidents/{id}/place-preview", None),
    ("/api/incidents/{id}/place-search", None),
    ("/api/incidents/{id}/hazard-areas", Some("gefahrenzonen")),
    ("/api/incidents/{id}/sectors", Some("einsatzabschnitte")),
    ("/api/incidents/{id}/zones", Some("lagekarte")),
    ("/api/incidents/{id}/free-symbols", Some("lagekarte")),
    // Hintergrundbilder und Führungskräfte-Positionen leben auf der Lagekarte.
    ("/api/incidents/{id}/map", Some("lagekarte")),
    // Wetter & Pegel (LFH-633): nur der Wetter-Endpunkt ist am Modul gegatet. Der
    // Pegelverlauf liegt unter dem modul-losen Pegel-Präfix unten.
    ("/api/incidents/{id}/weather", Some("wetter-pegel")),
    ("/api/incidents/{id}/map-views", Some("lagekarte")),
    ("/api/incidents/{id}/situation-snapshots", Some("lagekarte")),
    ("/api/incidents/{id}/attachments", None),
    // Pegel-Kennzahl (LFH-606): steht auf Dashboard und Überblick — modul-los wie die
    // Einsatz-Kopfdaten.
    ("/api/incidents/{id}/gauges", None),
    // Wahl der Lagekennzahlen (LLH-1371): Lageplatz B des Kennzahlenbands, modul-los wie der
    // Pegel. Die Zahl dazu liefert der Modulzähler, gefiltert nach Modulrecht.
    ("/api/incidents/{id}/situation-metric-selection", None),
    // Live-Feed (F01/LFH-227): modul-lose Gate-Route. Die Modul-Berechtigung wirkt
    // NICHT als Türsteher, sondern als Post-Filter pro Event im SSE-Builder — ein
    // Modul-Gate hier würde die anderen Module wieder mit durchlassen.
    ("/api/incidents/{id}/live", None),
    // Modulzähler (LFH-612): modul-lose Gate-Route wie der Live-Feed. Die Modulrechte
    // wirken als Filter über die Felder der Antwort — ein nicht erlaubtes Modul fehlt —,
    // nicht als Türsteher der Route.
    ("/api/incidents/{id}/module-counts", None),
    // Lagebild des Lagemonitors (LFH-892): verdichtete Zahlen ohne Personenbezug, nur für ein
    // gekoppeltes Gerät dieser Ansicht (der Handler weist alles andere mit 403 ab).
    ("/api/incidents/{id}/situation-monitor", None),
    // Modulfreigaben (LFH-669): modul-los wie die Zähler. Die Antwort IST die Auskunft über
    // die Modulrechte des Benutzers; ein Modul-Gate davor wäre ein Zirkel.
    ("/api/incidents/{id}/module-access", None),
    // Verlauf und „alle gelesen“ der Benachrichtigungen (LLH-1143): modul-los wie die Zähler.
    // Berechtigung ist die eigene Empfängerzeile; das Modulrecht am Bezug prüft der Handler je
    // Eintrag (`benachrichtigung::aufloesung::Leserecht`).
    ("/api/incidents/{id}/notifications", None),
    // Vorgabe je Funktion (LLH-1421): Einstellung des Einsatzes, modul-los wie die übrigen
    // Einstellungen.
    ("/api/incidents/{id}/notification-defaults", None),
    // Eigene Anträge an einem Spiegel (LLH-1492): modul-los. Ein Antrag gehört dem Konto, das ihn
    // gestellt hat; das Modulrecht prüfte schon die Erfassung, aus der er entstand.
    ("/api/incidents/{id}/requests", None),
    // Nicht übernommene Erfassungen nach einer Notübernahme (LLH-1646): modul-los. Jede Zeile
    // gehört einem anderen Modul; der Handler prüft das Modul je Zeile (Inhalt, Stellen,
    // Verwerfen) und das Modul der Antragsart.
    ("/api/incidents/{id}/breaks", None),
    // Kopfdaten, Abschluss, Frist, Einstellungen, Modul-Overrides und Mitglieder
    // (`routes::einsatz`): modul-los. Die Wurzel selbst trifft nur exakt, siehe
    // [`EINSATZ_WURZEL`].
    (EINSATZ_WURZEL, None),
    ("/api/incidents/{id}/close", None),
    // LLH-1814: Prüfung vor dem Abschluss und Wiederöffnen, beide ohne Modul.
    ("/api/incidents/{id}/closure", None),
    ("/api/incidents/{id}/reopen", None),
    ("/api/incidents/{id}/retention-period", None),
    // Nachbereitungsfrist (LLH-1494): wie die Aufbewahrungsfrist.
    ("/api/incidents/{id}/follow-up", None),
    ("/api/incidents/{id}/settings", None),
    // Richtwerte des Unterkunftsrechners (LLH-1520): Einstellung des Einsatzes, modul-los wie die
    // übrigen Einstellungen; der Rechner der Betreuung und die Einstellungsseite lesen sie.
    ("/api/incidents/{id}/accommodation-guidelines", None),
    ("/api/incidents/{id}/module-overrides", None),
    // Modul-Vorgaben der Einsatz-Org (LLH-1183): modul-los wie die Overrides, die Antwort
    // beschreibt die Modulregeln selbst.
    ("/api/incidents/{id}/module-defaults", None),
    ("/api/incidents/{id}/members", None),
    // Eigene Führungsstelle (LFH-849): Teil der Kopfdaten, modul-los wie die Wurzel.
    ("/api/incidents/{id}/command-post", None),
    // Präsenz an Einsatzdaten und Führungsstelle (LLH-1946): Gate wie die Kopfdaten, modul-los;
    // die Präsenz an einer Einheit liegt unter `/units` und erbt deren Key.
    ("/api/incidents/{id}/presence", None),
    // Führung je Einsatz (LLH-1491): Zustand der Instanzkopplung, modul-los wie der Abschluss.
    ("/api/incidents/{id}/command", None),
    // Gerätekopplung (LFH-892): Verwaltung der Einsatzleitung, modul-los wie die Mitglieder.
    ("/api/incidents/{id}/devices", None),
    // Helfer-App (Spec 2026-11-24-vakwvkpg): Einladung und Helfer der Leitung, kein Modul.
    ("/api/incidents/{id}/helpers", None),
    // Freigabe für Maschinenzugänge (LLH-1638): Verwaltung der Einsatzleitung wie die Geräte.
    ("/api/incidents/{id}/integrations", None),
    // Versandliste und „Erneut senden“ des Ausgangskorbs (LLH-2093): modul-los am Pfad. Das Modul
    // der Quelle (Lageberichte, Aufträge, Nachforderungen) prüft der Handler je Quellart.
    ("/api/incidents/{id}/deliveries", None),
    // Lagebild für Externe (LLH-1496): Links der Einsatzleitung, modul-los wie die Anbindungen.
    ("/api/incidents/{id}/situation-picture-shares", None),
    // Drohnenquellen je Einsatz (LLH-2105): zuschalten und lesen, Teil der Lagekarte.
    ("/api/incidents/{id}/drone", Some("lagekarte")),
    ("/api/incidents/{id}/map/drone", Some("lagekarte")),
];

/// Der Einsatz selbst (`GET`/`PATCH /api/incidents/{id}`). In [`key_fuer_pfad`] trifft dieser
/// Eintrag nur exakt: als Präfix registrierte er jede künftige Sub-Route als modul-los, und der
/// Guard meldete einen vergessenen [`PFAD_KEY`]-Eintrag nicht mehr.
const EINSATZ_WURZEL: &str = "/api/incidents/{id}";

/// Längster-Präfix-Match über [`PFAD_KEY`]. Äußeres `None` = Pfad nicht registriert;
/// `Some(inner)` = registriert (inner `None` = modul-lose Route). Segment-grenzen-sicher:
/// ein Präfix trifft nur bei Gleichheit oder wenn direkt danach `/` folgt — sonst würde
/// z. B. `…/meldungenarchiv` fälschlich als `…/meldungen`-Kind matchen.
pub fn key_fuer_pfad(pfad: &str) -> Option<Option<&'static str>> {
    PFAD_KEY
        .iter()
        .filter(|(prefix, _)| {
            pfad == *prefix
                || (*prefix != EINSATZ_WURZEL
                    && pfad
                        .strip_prefix(*prefix)
                        .is_some_and(|rest| rest.starts_with('/')))
        })
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, key)| *key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_sind_eindeutig() {
        let mut sortiert = MODUL_KEYS.to_vec();
        sortiert.sort_unstable();
        sortiert.dedup();
        assert_eq!(
            sortiert.len(),
            MODUL_KEYS.len(),
            "Modul-Keys müssen eindeutig sein"
        );
    }

    #[test]
    fn gueltiger_modul_key_erkennt_bekannte_und_unbekannte() {
        assert!(ist_gueltiger_modul_key("etb"));
        assert!(ist_gueltiger_modul_key("einsatz-einstellungen"));
        assert!(!ist_gueltiger_modul_key("gibtsnicht"));
        assert!(!ist_gueltiger_modul_key(""));
    }

    #[test]
    fn nicht_ausblendbare_module_sind_geschuetzt() {
        assert!(!ist_ausblendbar("einsatzdaten"));
        assert!(!ist_ausblendbar("einsatz-einstellungen"));
        assert!(ist_ausblendbar("etb"));
        assert!(ist_ausblendbar("chat"));
    }

    #[test]
    fn nicht_ausblendbare_sind_gueltige_keys() {
        for key in NICHT_AUSBLENDBAR {
            assert!(
                ist_gueltiger_modul_key(key),
                "{key} muss ein gültiger Modul-Key sein"
            );
        }
    }

    #[test]
    fn benoetigte_rolle_validierung() {
        assert!(ist_gueltige_benoetigte_rolle("admin"));
        assert!(ist_gueltige_benoetigte_rolle("fuehrungskraft"));
        assert!(ist_gueltige_benoetigte_rolle("einsatzfuehrung"));
        assert!(!ist_gueltige_benoetigte_rolle("einsatzleitung"));
        assert!(!ist_gueltige_benoetigte_rolle(""));
    }

    #[test]
    fn marker_keys_sind_teilmenge_von_modul_keys() {
        for (typ, key) in MARKER_KEYS {
            if let Some(k) = key {
                assert!(
                    MODUL_KEYS.contains(k),
                    "Marker {typ} nutzt Key {k}, der nicht in MODUL_KEYS steht"
                );
            }
        }
    }

    #[test]
    fn marker_key_werte_stimmen() {
        assert_eq!(Meldungen::KEY, Some("meldungen"));
        assert_eq!(Lagemeldungen::KEY, Some("lagemeldungen"));
        assert_eq!(Auftraege::KEY, Some("auftraege"));
        assert_eq!(Lagebesprechung::KEY, Some("lagebesprechung"));
        assert_eq!(Fernmeldewesen::KEY, Some("fernmeldewesen"));
        assert_eq!(Infotelefon::KEY, Some("infotelefon"));
        assert_eq!(Dokumente::KEY, Some("dokumente"));
        assert_eq!(Abloesung::KEY, Some("abloesung"));
        assert_eq!(Betreuung::KEY, Some("betreuung"));
        assert_eq!(Evakuierung::KEY, Some("evakuierung"));
        assert_eq!(Verpflegung::KEY, Some("verpflegung"));
        assert_eq!(WetterPegel::KEY, Some("wetter-pegel"));
        assert_eq!(OhneModul::KEY, None);
    }

    #[test]
    fn pfad_key_laengster_praefix_gewinnt() {
        // Kind-Pfade erben den Modul-Key des Präfixes.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/reports"),
            Some(Some("meldungen"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/reports/{mid}/status"),
            Some(Some("meldungen"))
        );
        // Eigenständiger Lage-Pfad → eigener Key, NICHT "meldungen".
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/situation/reports"),
            Some(Some("lagemeldungen"))
        );
        // Betreuung (LFH-639): Stellen und Belegungen hängen unter einem Präfix.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/care/positions/{sid}/occupancies"),
            Some(Some("betreuung"))
        );
        // Evakuierung (LLH-1034): die Bezirke sind umgezogen, eigener Key.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/evacuation/districts/{bid}/progress"),
            Some(Some("evakuierung"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/evacuation"),
            Some(Some("evakuierung"))
        );
        // Verpflegung (LFH-634): Zeitfenster und Ausgaben hängen unter einem Präfix.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/catering/distributions/{aid}/undo"),
            Some(Some("verpflegung"))
        );
        // Verpflegungsstellen (LLH-1040) hängen unter demselben Präfix.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/catering/positions/{sid}/status"),
            Some(Some("verpflegung"))
        );
        // Lagebesprechung (LLH-1111): eigener Key; beide Präfixe.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/briefing/schedule"),
            Some(Some("lagebesprechung"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/briefings"),
            Some(Some("lagebesprechung"))
        );
        // Fernmeldewesen (LLH-1180): die S6-Pfade liegen unter `…/staff`, gehören aber dem
        // eigenen Modul.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/comms-plan"),
            Some(Some("fernmeldewesen"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/comms-plan/positions/{sid}/talk-groups/{sg}"),
            Some(Some("fernmeldewesen"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/comms-sketch/areas/{bid}"),
            Some(Some("fernmeldewesen"))
        );
        // Informationstelefon (i6k6mzed, design.md D3): eigenes Modul unter `…/staff/info-line`.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/info-line"),
            Some(Some("infotelefon"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/info-line/{aid}/status"),
            Some(Some("infotelefon"))
        );
        // Das Modul Stab ist entfernt (i6k6mzed, design.md D1): seine Pfade sind nicht
        // registriert, auch nicht über einen kürzeren Präfix.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/staff/besetzung/{sachgebiet}"),
            None
        );
        assert_eq!(key_fuer_pfad("/api/incidents/{id}/staff"), None);
        // Modul-lose Route: registriert, aber kein Key.
        assert_eq!(key_fuer_pfad("/api/incidents/{id}/attachments"), Some(None));
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/attachments/{aid}"),
            Some(None)
        );
        // Wetter & Pegel (LFH-633): der Wetter-Endpunkt ist am Modul gegatet, der Pegelverlauf
        // bleibt unter dem modul-losen Pegel-Präfix.
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/weather"),
            Some(Some("wetter-pegel"))
        );
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/gauges/history"),
            Some(None)
        );
        // Nicht registriert.
        assert_eq!(key_fuer_pfad("/api/incidents/{id}/unbekannt"), None);
    }

    #[test]
    fn einsatz_wurzel_trifft_nur_exakt() {
        assert_eq!(key_fuer_pfad("/api/incidents/{id}"), Some(None));
        assert_eq!(
            key_fuer_pfad("/api/incidents/{id}/members/{benutzer_id}"),
            Some(None)
        );
        // Eine unregistrierte Sub-Route erbt die Wurzel NICHT.
        assert_eq!(key_fuer_pfad("/api/incidents/{id}/unbekannt"), None);
    }

    #[test]
    fn pfad_key_ignoriert_teil_segment_treffer() {
        // "meldungenarchiv" verlängert das Präfix "meldungen" als Text, ist aber
        // ein anderes Segment — darf NICHT als "meldungen"-Kind durchgehen.
        assert_eq!(key_fuer_pfad("/api/incidents/{id}/meldungenarchiv"), None);
    }
}
