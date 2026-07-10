//! LFH-120: Guard — Serde-Wire == as_str() für jede Variante jedes union-relevanten
//! Domänen-Enums. Schützt die generierten utoipa-Unions vor stiller Fehlgenerierung.
use lifeline_hub::auth::{OrgRolle, SystemRolle};
use lifeline_hub::bereitstellungsraum::{BrBelegungsArt, BrStatus, ObjektTyp};
use lifeline_hub::chat::BezugTyp;
use lifeline_hub::einsatz::{Einsatzart, EinsatzRolle, EinsatzStatus};
use lifeline_hub::etb::{EtbTyp, MeldeWeg};
use lifeline_hub::gefahr::{Gefahrentyp, Schutzobjekt, Warnstufe};
use lifeline_hub::lage_zone::LageZoneTyp;
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
    wire_eq!(EinsatzStatus::Aktiv, EinsatzStatus::Abgeschlossen);
    wire_eq!(
        Einsatzart::Realeinsatz,
        Einsatzart::Uebung,
        Einsatzart::Sanitaetsdienst,
        Einsatzart::Bereitstellung,
    );

    // staerke
    wire_eq!(
        StaerkePosition::Fuehrer,
        StaerkePosition::Unterfuehrer,
        StaerkePosition::Mannschaft,
    );

    // gefahr
    wire_eq!(
        Gefahrentyp::Atemgifte,
        Gefahrentyp::Angstreaktion,
        Gefahrentyp::Ausbreitung,
        Gefahrentyp::AtomareStrahlung,
        Gefahrentyp::ChemischeStoffe,
        Gefahrentyp::ErkrankungVerletzung,
        Gefahrentyp::Explosion,
        Gefahrentyp::Elektrizitaet,
        Gefahrentyp::Einsturz,
        Gefahrentyp::Absturz,
        Gefahrentyp::Brand,
        Gefahrentyp::Durchbruch,
        Gefahrentyp::Ertrinken,
    );
    wire_eq!(
        Schutzobjekt::Menschen,
        Schutzobjekt::Tiere,
        Schutzobjekt::Umwelt,
        Schutzobjekt::Sachwerte,
        Schutzobjekt::Einsatzkraefte,
    );
    wire_eq!(
        Warnstufe::Keine,
        Warnstufe::Niedrig,
        Warnstufe::Mittel,
        Warnstufe::Hoch,
        Warnstufe::Akut,
    );

    // lage_zone
    wire_eq!(
        LageZoneTyp::Gefahrengebiet,
        LageZoneTyp::Absperrbereich,
        LageZoneTyp::Absperrgrenze,
        LageZoneTyp::Sperrgebiet,
        LageZoneTyp::FreieSkizze,
    );

    // auth
    wire_eq!(SystemRolle::Admin, SystemRolle::Keiner);
    wire_eq!(OrgRolle::Fuehrungskraft, OrgRolle::Keine);
}

/// LFH-120 (Task 1b): Orphan-Union-Schema-Anker. Diese Enums haben KEIN `as_str()` —
/// die erwarteten Wire-Strings sind direkt aus der Mapping-Tabelle kopiert (nicht aus
/// dem Variantennamen abgeleitet), damit ein falscher `rename` hier hart auffällt.
macro_rules! wire_is {
    ($($v:expr => $s:expr),+ $(,)?) => {
        $(assert_eq!(serde_json::to_value(&$v).unwrap(), serde_json::json!($s),
            "Wire falsch für {:?}", $v);)+
    };
}

#[test]
fn orphan_enums_wire() {
    use lifeline_hub::auftrag::{AuftragBearbeitungsstatus, EmpfaengerTyp};
    use lifeline_hub::befehl::{BefehlStatus, BefehlVorlage};
    use lifeline_hub::einsatz::einstellungen::{
        BasemapModus, EinheitenSystem, Koordinatenformat, Zeitformat,
    };
    use lifeline_hub::katalog::{Betriebsart, Dienststatus, StatusKategorie};
    use lifeline_hub::kommunikation::{AdressatKategorie, Prioritaet, Richtung};
    use lifeline_hub::lagebericht::{LageberichtStatus, LageberichtVorlage};
    use lifeline_hub::meldung::{Meldungsart, MeldungStatus};
    use lifeline_hub::nachforderung::NachforderungStatus;
    use lifeline_hub::person::{AbgleichStatus, VerbleibStatus};
    use lifeline_hub::person::audit_repo::ZugriffArt;
    use lifeline_hub::erinnerung::ErinnerungStatus;

    // review-nachzug (LFH-120): inline-Unions, die der Orphan-Sweep übersah
    wire_is!(ZugriffArt::Detail => "detail", ZugriffArt::Export => "export");
    wire_is!(
        ErinnerungStatus::Offen => "offen",
        ErinnerungStatus::Erledigt => "erledigt",
        ErinnerungStatus::Quittiert => "quittiert",
    );

    // einsatz::einstellungen
    wire_is!(
        BasemapModus::Online => "online",
        BasemapModus::Offline => "offline",
        BasemapModus::Blind => "blind",
    );
    wire_is!(
        Zeitformat::VierundzwanzigStunden => "24h",
        Zeitformat::ZwoelfStunden => "12h",
    );
    wire_is!(EinheitenSystem::Metrisch => "metrisch", EinheitenSystem::Imperial => "imperial");
    wire_is!(
        Koordinatenformat::Wgs84 => "wgs84",
        Koordinatenformat::Dms => "dms",
        Koordinatenformat::Utm => "utm",
        Koordinatenformat::Mgrs => "mgrs",
        Koordinatenformat::Gk => "gk",
    );

    // katalog
    wire_is!(Betriebsart::Tmo => "TMO", Betriebsart::Dmo => "DMO");
    wire_is!(
        StatusKategorie::Verfuegbar => "verfuegbar",
        StatusKategorie::Gebunden => "gebunden",
        StatusKategorie::NichtVerfuegbar => "nicht_verfuegbar",
    );
    wire_is!(Dienststatus::InDienst => "in_dienst", Dienststatus::AusserDienst => "ausser_dienst");

    // person
    wire_is!(
        VerbleibStatus::Angemeldet => "angemeldet",
        VerbleibStatus::Abtransportiert => "abtransportiert",
    );
    wire_is!(
        AbgleichStatus::Verdacht => "verdacht",
        AbgleichStatus::Bestaetigt => "bestaetigt",
        AbgleichStatus::Verworfen => "verworfen",
    );

    // lagebericht
    wire_is!(
        LageberichtVorlage::Lagebericht => "lagebericht",
        LageberichtVorlage::Lagebeurteilung => "lagebeurteilung",
        LageberichtVorlage::Freitext => "freitext",
    );
    wire_is!(
        LageberichtStatus::Entwurf => "entwurf",
        LageberichtStatus::Freigegeben => "freigegeben",
    );

    // befehl
    wire_is!(
        BefehlVorlage::BefehlLad => "befehl_lad",
        BefehlVorlage::BefehlLadef => "befehl_ladef",
        BefehlVorlage::BefehlSchnee => "befehl_schnee",
        BefehlVorlage::BefehlEaZmw => "befehl_ea_zmw",
    );
    wire_is!(BefehlStatus::Entwurf => "entwurf", BefehlStatus::Freigegeben => "freigegeben");

    // auftrag
    wire_is!(
        AuftragBearbeitungsstatus::Offen => "offen",
        AuftragBearbeitungsstatus::InArbeit => "in_arbeit",
        AuftragBearbeitungsstatus::Vollzogen => "vollzogen",
        AuftragBearbeitungsstatus::Abgenommen => "abgenommen",
    );
    wire_is!(
        EmpfaengerTyp::Abschnitt => "abschnitt",
        EmpfaengerTyp::Einheit => "einheit",
        EmpfaengerTyp::Funktion => "funktion",
        EmpfaengerTyp::Person => "person",
        EmpfaengerTyp::Fahrzeug => "fahrzeug",
        EmpfaengerTyp::Extern => "extern",
    );

    // meldung
    wire_is!(
        MeldungStatus::Neu => "neu",
        MeldungStatus::Gesichtet => "gesichtet",
        MeldungStatus::InBearbeitung => "in_bearbeitung",
        MeldungStatus::Erledigt => "erledigt",
    );
    wire_is!(
        Meldungsart::Lagemeldung => "lagemeldung",
        Meldungsart::Sofortmeldung => "sofortmeldung",
        Meldungsart::Rueckmeldung => "rueckmeldung",
        Meldungsart::Vollzugsmeldung => "vollzugsmeldung",
        Meldungsart::Anfrage => "anfrage",
        Meldungsart::Sonstige => "sonstige",
    );

    // nachforderung
    wire_is!(
        NachforderungStatus::Angefordert => "angefordert",
        NachforderungStatus::Zugesagt => "zugesagt",
        NachforderungStatus::Unterwegs => "unterwegs",
        NachforderungStatus::Eingetroffen => "eingetroffen",
        NachforderungStatus::Abgelehnt => "abgelehnt",
    );

    // kommunikation (geteilt)
    wire_is!(
        Prioritaet::Sofort => "sofort",
        Prioritaet::Dringend => "dringend",
        Prioritaet::Normal => "normal",
    );
    wire_is!(Richtung::Intern => "intern", Richtung::Extern => "extern");
    wire_is!(
        AdressatKategorie::Leitstelle => "leitstelle",
        AdressatKategorie::NachbarEa => "nachbar_ea",
        AdressatKategorie::Uebergeordnet => "uebergeordnet",
        AdressatKategorie::AndereBos => "andere_bos",
    );
}
