//! LFH-120/312: Guard — Serde-Wire == `as_str()` bzw. == gepinntes Literal für **jede**
//! Variante **jedes** union-relevanten Domänen-Enums. Schützt die generierten utoipa-Unions
//! vor stiller Fehlgenerierung.
//!
//! LFH-312 hebt den Guard von handaufgezählten Varianten auf **erzwungene Vollständigkeit**,
//! auf zwei Ebenen:
//!
//! 1. **Je Enum**: die Makros [`enum_wire_as_str!`] / [`enum_wire!`] bauen aus der Variantenliste
//!    zusätzlich einen exhaustiven `match`. Eine neue Variante, die hier nicht nachgetragen wird,
//!    bricht den **Build** (`error[E0004] non-exhaustive patterns`) statt still ungepinnt zu
//!    bleiben. Das trägt nur, weil alle gelisteten Enums feldlos und keins `#[non_exhaustive]`
//!    ist (`tests/` ist ein eigener Crate — bei `#[non_exhaustive]` wäre der `match` von außen
//!    nicht exhaustiv prüfbar).
//! 2. **Über alle Enums**: [`jedes_toschema_enum_ist_gepinnt`] vergleicht die
//!    `ToSchema`-Registrierungen aus `src/api_doc.rs` gegen die Makro-Argumentbereiche dieser
//!    Datei. Ein neu registriertes Enum ohne Block hier bricht den Test.
//!
//! Deshalb tragen die Makro-Invokationen **voll qualifizierte Pfade** und es gibt **keinen
//! `use`-Block**: ein Inventar-Guard, der bloß den Namen sucht, wäre sonst schon vom Import
//! befriedigt worden (ungenutzte Importe sind hier nur eine Warnung, kein Fehler). Nebenbei
//! löst das die Namenskollision `schaden::AbschlussGrund` vs. `tier::AbschlussGrund` ohne Alias.
//!
//! Werkzeugwahl (LFH-312): `macro_rules!` mit eingebettetem exhaustivem `match` — dep-frei,
//! ohne Produktivcode-Änderung, gesamter Zwang in dieser einen Testdatei. `strum::EnumIter`
//! wäre eine neue direkte Dependency (heute nur transitiv via `croner`) samt
//! `scripts/check-deps.sh`-Exposure und `#[derive]` an 62 Produktiv-Enums; ein handgepflegtes
//! `const ALLE` je Enum (Muster `src/live/mod.rs`) erzwingt nichts, weil es selbst vergessen
//! werden kann.

/// Enums **mit** `as_str()`: prüft `serde`-Wire == `as_str()` je Variante und erzwingt per
/// eingebettetem `match`, dass die Variantenliste vollständig ist.
///
/// Bewusst **kein** handkopiertes Wire-Literal je Variante: `as_str()` ist hier die zweite,
/// unabhängige Quelle — ein Literal wäre bloß dessen Duplikat.
macro_rules! enum_wire_as_str {
    ($ty:path { $($var:ident),+ $(,)? }) => {{
        // Vollständigkeitszwang: fehlt eine Variante, bricht der Build mit E0004.
        #[allow(dead_code)]
        fn _exhaustiv(v: &$ty) {
            match v { $(<$ty>::$var => ()),+ }
        }
        $(assert_eq!(
            serde_json::to_value(<$ty>::$var).unwrap(),
            serde_json::json!(<$ty>::$var.as_str()),
            concat!(
                "Serde-Wire != as_str() für ", stringify!($ty), "::", stringify!($var),
                " — utoipa-Union würde still falsch generieren",
            ),
        );)+
    }};
}

/// Enums **ohne** `as_str()` (Orphan-Union-Schema-Anker): prüft `serde`-Wire gegen ein
/// handgepinntes Literal — aus der Mapping-Tabelle kopiert, **nicht** aus dem Variantennamen
/// abgeleitet, damit ein falscher `rename` hart auffällt. Vollständigkeitszwang wie oben.
///
/// Zweite Form `… } in <PFAD>::ALLE)`: zusätzlich wird belegt, dass jede Variante in dem
/// handgepflegten `ALLE`-Slice steht **und** dass `ALLE` genau so viele Einträge hat wie
/// Varianten gelistet sind (fängt zusätzlich eine Dublette in `ALLE`). Gebraucht für
/// `LiveEvent`, dessen `ALLE` die Iterationsbasis der SSE-Gate-Tests in `src/live/mod.rs` ist:
/// eine dort vergessene Variante liefe ungegatet an der Modul-Registry vorbei.
macro_rules! enum_wire {
    ($ty:path { $($var:ident => $wire:expr),+ $(,)? } in $alle:path) => {{
        enum_wire!($ty { $($var => $wire),+ });
        $(assert!(
            $alle.contains(&<$ty>::$var),
            concat!(stringify!($ty), "::", stringify!($var), " fehlt in ", stringify!($alle)),
        );)+
        assert_eq!(
            $alle.len(),
            [$(stringify!($var)),+].len(),
            concat!(stringify!($alle), " hat eine andere Länge als die gepinnte Variantenliste — Dublette?"),
        );
    }};
    ($ty:path { $($var:ident => $wire:expr),+ $(,)? }) => {{
        // Vollständigkeitszwang: fehlt eine Variante, bricht der Build mit E0004.
        #[allow(dead_code)]
        fn _exhaustiv(v: &$ty) {
            match v { $(<$ty>::$var => ()),+ }
        }
        $(assert_eq!(
            serde_json::to_value(<$ty>::$var).unwrap(),
            serde_json::json!($wire),
            concat!("Wire falsch für ", stringify!($ty), "::", stringify!($var)),
        );)+
    }};
}

#[test]
fn serde_wire_gleich_as_str() {
    // uhs
    enum_wire_as_str!(lifeline_hub::uhs::UhsTyp {
        Patientenablage,
        Behandlungsplatz,
        Verletztensammelstelle,
        Sonstige,
    });
    enum_wire_as_str!(lifeline_hub::uhs::UhsStatus {
        Geplant,
        Aktiv,
        Aufgeloest,
    });
    enum_wire_as_str!(lifeline_hub::uhs::PlatzTyp {
        Wartebereich,
        Behandlungsplatz,
        Bett,
        Intensivplatz,
        Trage,
        TransportBereitstellung,
        Sonstige,
    });
    enum_wire_as_str!(lifeline_hub::uhs::Verfuegbarkeit {
        Frei,
        Defekt,
        Aufbereitung,
        Gesperrt,
        Reserviert,
    });
    enum_wire_as_str!(lifeline_hub::uhs::BelegungsArt {
        Eintritt,
        Wechsel,
        Austritt,
    });

    // person
    enum_wire_as_str!(lifeline_hub::person::PersonStatus {
        Erfasst,
        Vermisst,
        Betroffen,
        Verstorben,
        Abgemeldet,
    });
    enum_wire_as_str!(lifeline_hub::person::Geschlecht {
        Maennlich,
        Weiblich,
        Divers,
        Unbekannt,
    });
    enum_wire_as_str!(lifeline_hub::person::Sichtungskategorie {
        Sk1,
        Sk2,
        Sk3,
        Sk4,
        Tot,
        Unverletzt,
    });
    enum_wire_as_str!(lifeline_hub::person::VerbleibArt {
        Transport,
        Entlassung,
        VorOrt,
        Verstorben,
    });
    enum_wire_as_str!(lifeline_hub::person::VerbleibStatus {
        Angemeldet,
        Abtransportiert,
    });
    enum_wire_as_str!(lifeline_hub::person::AbgleichStatus {
        Verdacht,
        Bestaetigt,
        Verworfen,
    });

    // schaden
    enum_wire_as_str!(lifeline_hub::schaden::SchadenStatus {
        Offen,
        Uebergeben,
        Abgeschlossen,
    });
    enum_wire_as_str!(lifeline_hub::schaden::SchadenTyp {
        Sachschaden,
        Verkehrshindernis,
        Infrastruktur,
        Umweltschaden,
        Tierkadaver,
        Sonstige,
    });
    enum_wire_as_str!(lifeline_hub::schaden::Ausmass {
        Gering,
        Mittel,
        Gross,
        Katastrophal,
    });
    // Namensgleich mit tier::AbschlussGrund — als PFAD sind das zwei getrennte Verpflichtungen.
    enum_wire_as_str!(lifeline_hub::schaden::AbschlussGrund {
        Behoben,
        KeinHandlungsbedarf,
        Abgewiesen,
    });

    // tier
    enum_wire_as_str!(lifeline_hub::tier::TierStatus {
        Aktiv,
        Vermisst,
        Abgeschlossen,
    });
    enum_wire_as_str!(lifeline_hub::tier::Spezies {
        Hund,
        Katze,
        Grosstier,
        Nutzgefluegel,
        Kleintier,
        Wildtier,
        Sonstige,
    });
    enum_wire_as_str!(lifeline_hub::tier::TierGeschlecht {
        Maennlich,
        Weiblich,
        Unbekannt,
    });
    enum_wire_as_str!(lifeline_hub::tier::AbschlussGrund {
        UebergabeHalter,
        UebergabeTierarzt,
        UebergabeTierheim,
        Verstorben,
        Freilauf,
        Sonstiges,
    });

    // material
    enum_wire_as_str!(lifeline_hub::material::MaterialStatus {
        Einsatzbereit,
        ImEinsatz,
        Defekt,
        Verbraucht,
        DesinfektionNoetig,
    });

    // katalog
    enum_wire_as_str!(lifeline_hub::katalog::Betriebsart { Tmo, Dmo });
    enum_wire_as_str!(lifeline_hub::katalog::StatusKategorie {
        Verfuegbar,
        Gebunden,
        NichtVerfuegbar,
    });

    // etb
    enum_wire_as_str!(lifeline_hub::etb::EtbTyp {
        Meldung,
        Anordnung,
        Lage,
        Entscheidung,
        System,
        Berichtigung,
    });
    enum_wire_as_str!(lifeline_hub::etb::MeldeWeg {
        Funk,
        Telefon,
        Persoenlich,
        Sonstige,
    });

    // bereitstellungsraum
    enum_wire_as_str!(lifeline_hub::bereitstellungsraum::BrStatus {
        Geplant,
        Aktiv,
        Aufgeloest,
    });
    enum_wire_as_str!(lifeline_hub::bereitstellungsraum::ObjektTyp { Einheit, Fahrzeug });
    enum_wire_as_str!(lifeline_hub::bereitstellungsraum::BrBelegungsArt {
        Eintritt,
        Wechsel,
        Austritt,
    });

    // chat
    enum_wire_as_str!(lifeline_hub::chat::BezugTyp {
        Schaden,
        Uhs,
        Person,
        Lagebericht,
        Meldung,
        Auftrag,
    });

    // kommunikation (geteilt: Auftrag/Meldung/Nachforderung)
    enum_wire_as_str!(lifeline_hub::kommunikation::Prioritaet {
        Sofort,
        Dringend,
        Normal,
    });
    enum_wire_as_str!(lifeline_hub::kommunikation::Richtung { Intern, Extern });
    enum_wire_as_str!(lifeline_hub::kommunikation::AdressatKategorie {
        Leitstelle,
        NachbarEa,
        Uebergeordnet,
        AndereBos,
    });

    // auftrag
    enum_wire_as_str!(lifeline_hub::auftrag::AuftragBearbeitungsstatus {
        Offen,
        InArbeit,
        Vollzogen,
        Abgenommen,
    });
    enum_wire_as_str!(lifeline_hub::auftrag::EmpfaengerTyp {
        Abschnitt,
        Einheit,
        Funktion,
        Person,
        Fahrzeug,
        Extern,
    });

    // meldung
    enum_wire_as_str!(lifeline_hub::meldung::MeldungStatus {
        Neu,
        Gesichtet,
        InBearbeitung,
        Erledigt,
    });
    enum_wire_as_str!(lifeline_hub::meldung::Meldungsart {
        Lagemeldung,
        Sofortmeldung,
        Rueckmeldung,
        Vollzugsmeldung,
        Anfrage,
        Sonstige,
    });

    // nachforderung
    enum_wire_as_str!(lifeline_hub::nachforderung::NachforderungStatus {
        Angefordert,
        Zugesagt,
        Unterwegs,
        Eingetroffen,
        Abgelehnt,
    });

    // einsatz
    enum_wire_as_str!(lifeline_hub::einsatz::EinsatzRolle {
        Einsatzleitung,
        Fuehrungspersonal,
        Beobachter,
    });
    enum_wire_as_str!(lifeline_hub::einsatz::EinsatzStatus {
        Aktiv,
        Abgeschlossen,
    });
    enum_wire_as_str!(lifeline_hub::einsatz::Einsatzart {
        Realeinsatz,
        Uebung,
        Sanitaetsdienst,
        Bereitstellung,
    });

    // staerke
    enum_wire_as_str!(lifeline_hub::staerke::StaerkePosition {
        Fuehrer,
        Unterfuehrer,
        Mannschaft,
    });

    // gefahr
    enum_wire_as_str!(lifeline_hub::gefahr::Gefahrentyp {
        Atemgifte,
        Angstreaktion,
        Ausbreitung,
        AtomareStrahlung,
        ChemischeStoffe,
        ErkrankungVerletzung,
        Explosion,
        Elektrizitaet,
        Einsturz,
        Absturz,
        Brand,
        Durchbruch,
        Ertrinken,
    });
    enum_wire_as_str!(lifeline_hub::gefahr::Schutzobjekt {
        Menschen,
        Tiere,
        Umwelt,
        Sachwerte,
        Einsatzkraefte,
    });
    enum_wire_as_str!(lifeline_hub::gefahr::Warnstufe {
        Keine,
        Niedrig,
        Mittel,
        Hoch,
        Akut,
    });

    // lage_zone
    enum_wire_as_str!(lifeline_hub::lage_zone::LageZoneTyp {
        Gefahrengebiet,
        Absperrbereich,
        Absperrgrenze,
        Sperrgebiet,
        FreieSkizze,
    });

    // auth
    enum_wire_as_str!(lifeline_hub::auth::SystemRolle { Admin, Keiner });
    enum_wire_as_str!(lifeline_hub::auth::OrgRolle {
        Fuehrungskraft,
        Keine
    });

    // auth-provider
    enum_wire_as_str!(lifeline_hub::auth::provider::AuthProviderTyp {
        Passwort,
        Dev,
        Oidc,
        Webauthn,
    });
}

/// LFH-120 (Task 1b): Orphan-Union-Schema-Anker. Diese Enums haben KEIN `as_str()` —
/// die erwarteten Wire-Strings sind direkt aus der Mapping-Tabelle kopiert (nicht aus
/// dem Variantennamen abgeleitet), damit ein falscher `rename` hier hart auffällt.
#[test]
fn orphan_enums_wire() {
    // review-nachzug (LFH-120): inline-Unions, die der Orphan-Sweep übersah
    enum_wire!(lifeline_hub::person::audit_repo::ZugriffArt {
        Detail => "detail",
        Export => "export",
    });
    enum_wire!(lifeline_hub::erinnerung::ErinnerungStatus {
        Offen => "offen",
        Erledigt => "erledigt",
        Quittiert => "quittiert",
    });

    // einsatz::einstellungen
    enum_wire!(lifeline_hub::einsatz::einstellungen::BasemapModus {
        Online => "online",
        Offline => "offline",
        Blind => "blind",
    });
    enum_wire!(lifeline_hub::einsatz::einstellungen::Zeitformat {
        VierundzwanzigStunden => "24h",
        ZwoelfStunden => "12h",
    });
    enum_wire!(lifeline_hub::einsatz::einstellungen::EinheitenSystem {
        Metrisch => "metrisch",
        Imperial => "imperial",
    });
    enum_wire!(lifeline_hub::einsatz::einstellungen::Koordinatenformat {
        Wgs84 => "wgs84",
        Dms => "dms",
        Utm => "utm",
        Mgrs => "mgrs",
        Gk => "gk",
    });

    // katalog (Dienststatus bleibt String — kein as_str/parse, daher weiter orphan)
    enum_wire!(lifeline_hub::katalog::Dienststatus {
        InDienst => "in_dienst",
        AusserDienst => "ausser_dienst",
    });

    // lagebericht
    enum_wire!(lifeline_hub::lagebericht::LageberichtVorlage {
        Lagebericht => "lagebericht",
        Lagebeurteilung => "lagebeurteilung",
        Freitext => "freitext",
    });
    enum_wire!(lifeline_hub::lagebericht::LageberichtStatus {
        Entwurf => "entwurf",
        Freigegeben => "freigegeben",
    });

    // befehl
    enum_wire!(lifeline_hub::befehl::BefehlVorlage {
        BefehlLad => "befehl_lad",
        BefehlLadef => "befehl_ladef",
        BefehlSchnee => "befehl_schnee",
        BefehlEaZmw => "befehl_ea_zmw",
    });
    enum_wire!(lifeline_hub::befehl::BefehlStatus {
        Entwurf => "entwurf",
        Freigegeben => "freigegeben",
    });

    // karte (LFH-265): drei Union-Anker der Karten-Domäne, alle ohne `as_str()`.
    // `OfflineKarteStatus` ist ein reiner Schema-Anker (Speichertyp bleibt String) — dieser
    // Block ist der einzige harte Beleg seiner Einführung: er kompiliert ohne das Enum nicht.
    // Für `FachebeneStatus`/`OnlineStyleTyp` ist er ein PIN gegen künftige rename-Drift,
    // kein Fix (beide tragen `rename_all = "lowercase"` schon länger).
    enum_wire!(lifeline_hub::karte::typen::FachebeneStatus {
        Ok => "ok",
        Leer => "leer",
        Offline => "offline",
    });
    enum_wire!(lifeline_hub::config::OnlineStyleTyp {
        Vektor => "vektor",
        Raster => "raster",
    });
    enum_wire!(lifeline_hub::karte::registry::repo::OfflineKarteStatus {
        Registriert => "registriert",
        Laedt => "laedt",
        Bereit => "bereit",
        Fehler => "fehler",
    });
}

/// LFH-298: SSE-Wire-Event-Namen als BE↔FE-Kontrakt. `LiveEvent` ist die Wahrheitsquelle der
/// Wire-Event-Namen — die Emitter routen über `as_str()`, utoipa erzeugt daraus die
/// FE-Union (`types.generated.ts`). Pinnt jede Variante gegen ihr load-bearing Wire-Literal
/// (aus der Mapping-Tabelle kopiert, NICHT aus dem Variantennamen abgeleitet — sonst fällt ein
/// falscher `rename` nicht auf) UND dass `serde` == `as_str()` (sonst driftet die generierte
/// openapi-Union still vom echten Wire, den das FE exakt filtert).
///
/// Zusätzlich (LFH-312): jede Variante muss in `LiveEvent::ALLE` stehen — dem handgepflegten
/// Slice, über das die SSE-Gate-Tests in `src/live/mod.rs` iterieren.
#[test]
fn live_event_wire() {
    enum_wire!(lifeline_hub::live::LiveEvent {
        Uhs => "uhs",
        Schaden => "schaden",
        Fahrzeug => "fahrzeug",
        Material => "material",
        Tier => "tier",
        LageZone => "lage_zone",
        FreiesZeichen => "freies_zeichen",
        Gefahr => "gefahr",
        Einheit => "einheit",
        Abschnitt => "abschnitt",
        Person => "person",
        Personal => "personal",
        Lagebericht => "lagebericht",
        Chat => "chat",
        Erinnerung => "erinnerung",
        Auftrag => "auftrag",
        Nachforderung => "nachforderung",
        Meldung => "meldung",
        Bereitstellungsraum => "bereitstellungsraum",
        KarteBild => "karte_bild",
        Etb => "etb",
        Befehl => "befehl",
        Sofortmeldung => "sofortmeldung",
        Lagged => "lagged",
    } in lifeline_hub::live::LiveEvent::ALLE);

    // serde == as_str() für jede Variante. Über `ALLE` iteriert statt neu aufgezählt — der
    // Block oben hat bereits belegt, dass `ALLE` genau alle Varianten enthält.
    for ev in lifeline_hub::live::LiveEvent::ALLE {
        assert_eq!(
            serde_json::to_value(ev).unwrap(),
            serde_json::json!(ev.as_str()),
            "Serde-Wire != as_str() für {ev:?} — utoipa-Union würde still driften",
        );
    }
}

// ───────────────────────── Inventar-Guard (LFH-312) ─────────────────────────
//
// Die Makro-Exhaustiveness oben erzwingt Vollständigkeit nur JE GELISTETEM Enum. Ein NEU in
// `src/api_doc.rs` registriertes Enum bliebe still ungepinnt — das schließt der Guard unten.
//
// Idiom wie `tests/json_extractor_guard.rs`: Quelltext lesen und per Klammer-Tiefenzähler
// schneiden, bewusst ohne `regex`-Dependency.
//
// GRENZE DES GUARDS (bewusst, damit ihn niemand für stärker hält, als er ist):
// Er erkennt Enums per Textsuche nach `pub enum <Name>` im Quellbaum, nicht per Typsystem.
// Ein unter anderem Namen re-exportiertes und so registriertes Schema entginge ihm. Vertretbar,
// weil `src/api_doc.rs` durchgehend voll qualifizierte `crate::…`-Pfade nutzt.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// Entfernt Zeilenkommentare, damit ein `crate::…`-Pfad in einem Kommentar nicht als
/// Registrierung zählt.
fn ohne_zeilenkommentare(quelle: &str) -> String {
    quelle
        .lines()
        .map(|z| match z.find("//") {
            Some(i) => &z[..i],
            None => z,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Schneidet den Inhalt des ersten `schemas( … )`-Blocks per Klammer-Tiefe und liefert daraus
/// jeden `crate::…`-Pfad in Quelltext-Reihenfolge.
fn schema_pfade_aus(quelle: &str) -> Vec<String> {
    let quelle = ohne_zeilenkommentare(quelle);
    let Some(start) = quelle.find("schemas(") else {
        return Vec::new();
    };
    let open = start + "schemas".len();
    let Some(inhalt) = klammer_inhalt(&quelle, open) else {
        return Vec::new();
    };

    let mut pfade = Vec::new();
    let mut suche_ab = 0usize;
    while let Some(rel) = inhalt[suche_ab..].find("crate::") {
        let pos = suche_ab + rel;
        let ende = inhalt[pos..]
            .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == ':'))
            .map_or(inhalt.len(), |off| pos + off);
        pfade.push(inhalt[pos..ende].trim_end_matches(':').to_string());
        suche_ab = ende;
    }
    pfade
}

/// Inhalt der Klammergruppe, die bei `open` (Index der öffnenden Klammer) beginnt — ohne die
/// Klammern selbst. `None`, wenn die Gruppe unbalanciert ist.
fn klammer_inhalt(quelle: &str, open: usize) -> Option<&str> {
    let bytes = quelle.as_bytes();
    if bytes.get(open) != Some(&b'(') {
        return None;
    }
    let mut tiefe = 0i32;
    for (offset, &b) in bytes[open..].iter().enumerate() {
        match b {
            b'(' => tiefe += 1,
            b')' => {
                tiefe -= 1;
                if tiefe == 0 {
                    return Some(&quelle[open + 1..open + offset]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Alle `pub enum <Name>` unterhalb der übergebenen Wurzeln.
fn enum_namen_im_quellbaum(wurzeln: &[&str]) -> BTreeSet<String> {
    let mut namen = BTreeSet::new();
    for wurzel in wurzeln {
        sammle_enum_namen(Path::new(wurzel), &mut namen);
    }
    namen
}

fn sammle_enum_namen(pfad: &Path, namen: &mut BTreeSet<String>) {
    let Ok(eintraege) = fs::read_dir(pfad) else {
        return;
    };
    for eintrag in eintraege.filter_map(Result::ok) {
        let p = eintrag.path();
        if p.is_dir() {
            sammle_enum_namen(&p, namen);
        } else if p.extension().is_some_and(|e| e == "rs") {
            let Ok(quelle) = fs::read_to_string(&p) else {
                continue;
            };
            let mut suche_ab = 0usize;
            while let Some(rel) = quelle[suche_ab..].find("pub enum ") {
                let pos = suche_ab + rel + "pub enum ".len();
                let ende = quelle[pos..]
                    .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .map_or(quelle.len(), |off| pos + off);
                if ende > pos {
                    namen.insert(quelle[pos..ende].to_string());
                }
                suche_ab = ende;
            }
        }
    }
}

/// Nur die ARGUMENTBEREICHE der Wire-Makros — der Text zwischen `enum_wire_as_str!(` bzw.
/// `enum_wire!(` und der zugehörigen schließenden Klammer.
///
/// Das ist der Kern des Guards: ein `contains` über die ganze Datei wäre wertlos gewesen, weil
/// vor LFH-312 jeder Enum-Name schon im `use`-Block stand — und ein Name in einem Kommentar
/// oder einer Fehlermeldung darf den Guard ebenfalls nicht befriedigen.
fn makro_bereiche_aus(quelle: &str) -> Vec<String> {
    let mut bereiche = Vec::new();
    for makro in ["enum_wire_as_str!(", "enum_wire!("] {
        let mut suche_ab = 0usize;
        while let Some(rel) = quelle[suche_ab..].find(makro) {
            let open = suche_ab + rel + makro.len() - 1;
            suche_ab = open + 1;
            if let Some(inhalt) = klammer_inhalt(quelle, open) {
                bereiche.push(inhalt.to_string());
            }
        }
    }
    bereiche
}

/// Exaktes Pfad-Token-Match: `…::tier::AbschlussGrund` darf nicht auf
/// `…::schaden::AbschlussGrund` und `…::Geschlecht` nicht auf `…::TierGeschlecht` passen.
fn pfad_kommt_vor(text: &str, pfad: &str) -> bool {
    let ist_pfad_zeichen = |c: char| c.is_alphanumeric() || c == '_' || c == ':';
    let mut suche_ab = 0usize;
    while let Some(rel) = text[suche_ab..].find(pfad) {
        let pos = suche_ab + rel;
        let davor_ok = text[..pos]
            .chars()
            .next_back()
            .is_none_or(|c| !ist_pfad_zeichen(c));
        let danach_ok = text[pos + pfad.len()..]
            .chars()
            .next()
            .is_none_or(|c| !ist_pfad_zeichen(c));
        if davor_ok && danach_ok {
            return true;
        }
        suche_ab = pos + pfad.len();
    }
    false
}

/// Jede `ToSchema`-Enum-Registrierung aus `src/api_doc.rs` muss als voll qualifizierter Pfad in
/// einem Wire-Makro dieser Datei stehen. Ohne diesen Guard bliebe ein neu registriertes Enum
/// still ungepinnt — die Makro-Exhaustiveness greift erst, wenn das Enum überhaupt gelistet ist.
#[test]
fn jedes_toschema_enum_ist_gepinnt() {
    let api_doc = fs::read_to_string("src/api_doc.rs").expect("src/api_doc.rs lesbar");
    let schema_pfade = schema_pfade_aus(&api_doc);
    // Leerlauf-Schutz: bricht, wenn die Extraktion durch eine Formatierungsänderung leer läuft
    // (Stand LFH-312: 149 Schema-Einträge).
    assert!(
        schema_pfade.len() >= 130,
        "nur {} Schema-Registrierungen aus src/api_doc.rs extrahiert — Extraktion kaputt?",
        schema_pfade.len()
    );

    let enum_namen = enum_namen_im_quellbaum(&["src", "crates"]);
    let enum_pfade: Vec<&String> = schema_pfade
        .iter()
        .filter(|p| {
            p.rsplit("::")
                .next()
                .is_some_and(|name| enum_namen.contains(name))
        })
        .collect();
    // Leerlauf-Schutz. Gezählt werden PFADE (Stand LFH-312: 62) bei 61 distinkten NAMEN —
    // `schaden::AbschlussGrund` und `tier::AbschlussGrund` heißen gleich. Bewusst `>=` statt
    // einer harten Zahl: die darf wachsen, aber nicht still fallen.
    assert!(
        enum_pfade.len() >= 55,
        "nur {} Enum-Registrierungen erkannt — Enum-Erkennung kaputt?",
        enum_pfade.len()
    );

    let bereiche = makro_bereiche_aus(include_str!("enum_wire_kontrakt.rs"));
    // Leerlauf-Schutz: ohne Argumentbereiche wäre die Hauptassertion trivial rot.
    assert!(
        !bereiche.is_empty(),
        "keine enum_wire!/enum_wire_as_str!-Argumentbereiche gefunden — Schnitt kaputt?"
    );
    let gepinnt = bereiche.join("\n");

    let fehlend: Vec<String> = enum_pfade
        .iter()
        .map(|p| p.replace("crate::", "lifeline_hub::"))
        .filter(|p| !pfad_kommt_vor(&gepinnt, p))
        .collect();
    assert!(
        fehlend.is_empty(),
        "In src/api_doc.rs registriert, aber in tests/enum_wire_kontrakt.rs NICHT per \
         enum_wire!/enum_wire_as_str! gepinnt:\n  {}\n\
         Jedes ToSchema-Enum braucht einen Block mit voll qualifiziertem Pfad — sonst kann die \
         generierte utoipa-Union still vom echten Serde-Wire abweichen.",
        fehlend.join("\n  ")
    );
}

#[test]
fn schema_pfade_aus_liest_den_schemas_block() {
    let quelle = "#[openapi(components(schemas(\n    crate::a::Foo,\n    // ein Kommentar mit crate::x::Ignoriert\n    crate::b::Bar,\n)))]";
    assert_eq!(
        schema_pfade_aus(quelle),
        vec!["crate::a::Foo".to_string(), "crate::b::Bar".to_string()]
    );
}

#[test]
fn makro_bereiche_sehen_nur_die_makro_argumente() {
    // Genau der Fall, der den Guard vor LFH-312 wertlos gemacht hätte: der Name aus dem
    // `use`-Block darf NICHT als gepinnt gelten.
    let quelle = "use lifeline_hub::aa::Foo;\nenum_wire_as_str!(lifeline_hub::bb::Bar { X });\n";
    let bereiche = makro_bereiche_aus(quelle);
    assert_eq!(bereiche.len(), 1);
    assert!(pfad_kommt_vor(&bereiche[0], "lifeline_hub::bb::Bar"));
    assert!(!pfad_kommt_vor(&bereiche[0], "lifeline_hub::aa::Foo"));
}

#[test]
fn makro_bereiche_trennen_beide_makronamen() {
    let quelle = "enum_wire!(lifeline_hub::cc::Orphan { X => \"x\" });\nenum_wire_as_str!(lifeline_hub::dd::MitAsStr { Y });\n";
    let bereiche = makro_bereiche_aus(quelle);
    assert_eq!(bereiche.len(), 2);
    let alle = bereiche.join("\n");
    assert!(pfad_kommt_vor(&alle, "lifeline_hub::cc::Orphan"));
    assert!(pfad_kommt_vor(&alle, "lifeline_hub::dd::MitAsStr"));
}

#[test]
fn pfad_match_ist_token_genau() {
    let text = "lifeline_hub::schaden::AbschlussGrund { Behoben } lifeline_hub::tier::TierGeschlecht { Weiblich }";
    assert!(pfad_kommt_vor(
        text,
        "lifeline_hub::schaden::AbschlussGrund"
    ));
    // Namensgleiches Enum aus einem anderen Modul zählt NICHT als gepinnt.
    assert!(!pfad_kommt_vor(text, "lifeline_hub::tier::AbschlussGrund"));
    // Kein Substring-Fehlpass: TierGeschlecht befriedigt Geschlecht nicht.
    assert!(!pfad_kommt_vor(text, "lifeline_hub::person::Geschlecht"));
}
