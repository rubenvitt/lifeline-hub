//! LFH-120: Guard — Serde-Wire == as_str() für jede Variante jedes union-relevanten
//! Domänen-Enums. Schützt die generierten utoipa-Unions vor stiller Fehlgenerierung.
use lifeline_hub::bereitstellungsraum::{BrBelegungsArt, BrStatus, ObjektTyp};
use lifeline_hub::chat::BezugTyp;
use lifeline_hub::einsatz::EinsatzRolle;
use lifeline_hub::etb::{EtbTyp, MeldeWeg};
use lifeline_hub::material::MaterialStatus;
use lifeline_hub::person::{Geschlecht, PersonStatus, Sichtungskategorie, VerbleibArt};
use lifeline_hub::schaden::{Ausmass, SchadenStatus, SchadenTyp};
use lifeline_hub::staerke::StaerkePosition;
use lifeline_hub::tier::{Spezies, TierGeschlecht, TierStatus};
use lifeline_hub::uhs::{BelegungsArt, PlatzTyp, UhsStatus, UhsTyp, Verfuegbarkeit};
// schaden::AbschlussGrund und tier::AbschlussGrund heißen gleich → mit Pfad qualifizieren
use lifeline_hub::schaden::AbschlussGrund as SchadenAbschlussGrund;
use lifeline_hub::tier::AbschlussGrund as TierAbschlussGrund;

macro_rules! wire_eq {
    ($($v:expr),+ $(,)?) => {
        $(assert_eq!(
            serde_json::to_value(&$v).unwrap(),
            serde_json::json!($v.as_str()),
            "Serde-Wire != as_str() für {:?} — utoipa-Union würde still falsch generieren", $v
        );)+
    };
}

#[test]
fn serde_wire_gleich_as_str() {
    // uhs
    wire_eq!(
        UhsTyp::Patientenablage,
        UhsTyp::Behandlungsplatz,
        UhsTyp::Verletztensammelstelle,
        UhsTyp::Sonstige,
    );
    wire_eq!(UhsStatus::Geplant, UhsStatus::Aktiv, UhsStatus::Aufgeloest);
    wire_eq!(
        PlatzTyp::Wartebereich,
        PlatzTyp::Behandlungsplatz,
        PlatzTyp::Bett,
        PlatzTyp::Intensivplatz,
        PlatzTyp::Trage,
        PlatzTyp::TransportBereitstellung,
        PlatzTyp::Sonstige,
    );
    wire_eq!(
        Verfuegbarkeit::Frei,
        Verfuegbarkeit::Defekt,
        Verfuegbarkeit::Aufbereitung,
        Verfuegbarkeit::Gesperrt,
        Verfuegbarkeit::Reserviert,
    );
    wire_eq!(
        BelegungsArt::Eintritt,
        BelegungsArt::Wechsel,
        BelegungsArt::Austritt,
    );

    // person
    wire_eq!(
        PersonStatus::Erfasst,
        PersonStatus::Vermisst,
        PersonStatus::Betroffen,
        PersonStatus::Verstorben,
        PersonStatus::Abgemeldet,
    );
    wire_eq!(
        Geschlecht::Maennlich,
        Geschlecht::Weiblich,
        Geschlecht::Divers,
        Geschlecht::Unbekannt,
    );
    wire_eq!(
        Sichtungskategorie::Sk1,
        Sichtungskategorie::Sk2,
        Sichtungskategorie::Sk3,
        Sichtungskategorie::Sk4,
        Sichtungskategorie::Tot,
        Sichtungskategorie::Unverletzt,
    );
    wire_eq!(
        VerbleibArt::Transport,
        VerbleibArt::Entlassung,
        VerbleibArt::VorOrt,
        VerbleibArt::Verstorben,
    );

    // schaden
    wire_eq!(
        SchadenStatus::Offen,
        SchadenStatus::Uebergeben,
        SchadenStatus::Abgeschlossen,
    );
    wire_eq!(
        SchadenTyp::Sachschaden,
        SchadenTyp::Verkehrshindernis,
        SchadenTyp::Infrastruktur,
        SchadenTyp::Umweltschaden,
        SchadenTyp::Tierkadaver,
        SchadenTyp::Sonstige,
    );
    wire_eq!(
        Ausmass::Gering,
        Ausmass::Mittel,
        Ausmass::Gross,
        Ausmass::Katastrophal,
    );
    wire_eq!(
        SchadenAbschlussGrund::Behoben,
        SchadenAbschlussGrund::KeinHandlungsbedarf,
        SchadenAbschlussGrund::Abgewiesen,
    );

    // tier
    wire_eq!(
        TierStatus::Aktiv,
        TierStatus::Vermisst,
        TierStatus::Abgeschlossen,
    );
    wire_eq!(
        Spezies::Hund,
        Spezies::Katze,
        Spezies::Grosstier,
        Spezies::Nutzgefluegel,
        Spezies::Kleintier,
        Spezies::Wildtier,
        Spezies::Sonstige,
    );
    wire_eq!(
        TierGeschlecht::Maennlich,
        TierGeschlecht::Weiblich,
        TierGeschlecht::Unbekannt,
    );
    wire_eq!(
        TierAbschlussGrund::UebergabeHalter,
        TierAbschlussGrund::UebergabeTierarzt,
        TierAbschlussGrund::UebergabeTierheim,
        TierAbschlussGrund::Verstorben,
        TierAbschlussGrund::Freilauf,
        TierAbschlussGrund::Sonstiges,
    );

    // material
    wire_eq!(
        MaterialStatus::Einsatzbereit,
        MaterialStatus::ImEinsatz,
        MaterialStatus::Defekt,
        MaterialStatus::Verbraucht,
        MaterialStatus::DesinfektionNoetig,
    );

    // etb
    wire_eq!(
        EtbTyp::Meldung,
        EtbTyp::Anordnung,
        EtbTyp::Lage,
        EtbTyp::Entscheidung,
        EtbTyp::System,
        EtbTyp::Berichtigung,
    );
    wire_eq!(
        MeldeWeg::Funk,
        MeldeWeg::Telefon,
        MeldeWeg::Persoenlich,
        MeldeWeg::Sonstige,
    );

    // bereitstellungsraum
    wire_eq!(BrStatus::Geplant, BrStatus::Aktiv, BrStatus::Aufgeloest);
    wire_eq!(ObjektTyp::Einheit, ObjektTyp::Fahrzeug);
    wire_eq!(
        BrBelegungsArt::Eintritt,
        BrBelegungsArt::Wechsel,
        BrBelegungsArt::Austritt,
    );

    // chat
    wire_eq!(
        BezugTyp::Schaden,
        BezugTyp::Uhs,
        BezugTyp::Person,
        BezugTyp::Lagebericht,
        BezugTyp::Meldung,
        BezugTyp::Auftrag,
    );

    // einsatz
    wire_eq!(
        EinsatzRolle::Einsatzleitung,
        EinsatzRolle::Fuehrungspersonal,
        EinsatzRolle::Beobachter,
    );

    // staerke
    wire_eq!(
        StaerkePosition::Fuehrer,
        StaerkePosition::Unterfuehrer,
        StaerkePosition::Mannschaft,
    );
}
