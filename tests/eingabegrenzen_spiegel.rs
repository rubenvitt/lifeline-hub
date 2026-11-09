//! LFH-937: Die Eingabemasken lassen nicht mehr zu als der Server (Spec `eingabegrenzen`,
//! design.md D8). `frontend/src/api/eingabegrenzen.ts` spiegelt jede Grenze; dieser Test liest
//! die Datei und vergleicht Name für Name, damit keine Seite still driftet.

use std::collections::BTreeMap;

use lifeline_hub::abloesung::schichtplan;
use lifeline_hub::einsatz::fuehrungsstelle;
use lifeline_hub::{
    abloesung, auftrag, bereitstellungsraum, betreuung, chat, einheit, einheit_vorlage, einsatz,
    einsatz_vorlage, etb, externe_stelle, fahrzeug, fuehrung, gefahr, infotelefon,
    kraefte_disposition, lage_zone, lagebesprechung, lagemonitor_zugang, material, nachforderung,
    person, personal, planung, programmpunkt, schaden, schichtmodell, sprechgruppe, verpflegung,
    vorlagendokument, zeitachse,
};

fn backend() -> BTreeMap<&'static str, usize> {
    BTreeMap::from([
        ("ETB_INHALT_MAX", etb::INHALT_MAX),
        (
            "BETREUUNG_STELLE_BEZEICHNUNG_MAX",
            betreuung::STELLE_BEZEICHNUNG_MAX,
        ),
        (
            "BETREUUNG_STELLE_STANDORT_MAX",
            betreuung::STELLE_STANDORT_MAX,
        ),
        ("BETREUUNG_STELLE_NOTIZ_MAX", betreuung::STELLE_NOTIZ_MAX),
        ("BETREUUNG_LEITUNG_MAX", betreuung::LEITUNG_MAX),
        ("BETREUUNG_KONTAKTWEG_MAX", betreuung::KONTAKTWEG_MAX),
        (
            "EVAKUIERUNG_BEZIRK_BEZEICHNUNG_MAX",
            betreuung::BEZIRK_BEZEICHNUNG_MAX,
        ),
        (
            "EVAKUIERUNG_BEZIRK_SAMMELSTELLE_MAX",
            betreuung::BEZIRK_SAMMELSTELLE_MAX,
        ),
        ("EVAKUIERUNG_BEZIRK_NOTIZ_MAX", betreuung::BEZIRK_NOTIZ_MAX),
        ("ETB_PARTEI_MAX", etb::PARTEI_MAX),
        ("AUFTRAG_TEXT_MAX", auftrag::AUFTRAG_TEXT_MAX),
        ("AUFTRAG_BEFEHLSFELD_MAX", auftrag::BEFEHLSFELD_MAX),
        ("AUFTRAG_EMPFAENGER_MAX", auftrag::EMPFAENGER_MAX),
        (
            "AUFTRAG_EXTERN_BEZEICHNUNG_MAX",
            auftrag::EXTERN_BEZEICHNUNG_MAX,
        ),
        ("AUFTRAG_AUFHEBUNGSGRUND_MAX", auftrag::AUFHEBUNGSGRUND_MAX),
        (
            "LAGEBESPRECHUNG_ENTSCHLUSS_MAX",
            lagebesprechung::ENTSCHLUSS_MAX,
        ),
        ("VERTEILER_MAX", vorlagendokument::verteiler::VERTEILER_MAX),
        (
            "VERTEILER_BEZEICHNUNG_MAX",
            vorlagendokument::verteiler::VERTEILER_BEZEICHNUNG_MAX,
        ),
        ("FUNKTION_TEXT_MAX", fuehrung::TEXT_MAX),
        ("PAT_NUMMER_MAX", person::PAT_NUMMER_MAX),
        ("EINSATZNUMMER_MAX", person::EINSATZNUMMER_MAX),
        ("VERLETZUNG_NOTIZ_MAX", person::VERLETZUNG_NOTIZ_MAX),
        ("PERSON_NAME_MAX", person::PERSON_NAME_MAX),
        ("PERSON_ANGABE_MAX", person::PERSON_ANGABE_MAX),
        ("PERSON_ZUSTAND_MAX", person::PERSON_ZUSTAND_MAX),
        ("PERSON_NOTIZ_MAX", person::PERSON_NOTIZ_MAX),
        (
            "PERSON_UNVERTRAEGLICHKEITEN_MAX",
            person::PERSON_UNVERTRAEGLICHKEITEN_MAX,
        ),
        (
            "REGISTRIERUNG_PERSONEN_MAX",
            lifeline_hub::betreuung::registrierung::REGISTRIERUNG_PERSONEN_MAX,
        ),
        (
            "ABMELDUNG_PERSONEN_MAX",
            lifeline_hub::betreuung::registrierung::ABMELDUNG_PERSONEN_MAX,
        ),
        (
            "BETREUUNG_ABMELDUNG_ZIEL_MAX",
            lifeline_hub::betreuung::registrierung::ABMELDUNG_ZIEL_MAX,
        ),
        ("VERLAUFSNOTIZ_MAX", person::VERLAUFSNOTIZ_MAX),
        ("PERSONAL_ADHOC_TEXT_MAX", personal::ADHOC_TEXT_MAX),
        (
            "PERSONAL_EINSATZFUNKTION_MAX",
            personal::EINSATZFUNKTION_MAX,
        ),
        ("PERSONAL_BEMERKUNG_MAX", personal::BEMERKUNG_MAX),
        ("MATERIAL_ADHOC_TEXT_MAX", material::ADHOC_TEXT_MAX),
        ("MATERIAL_BEMERKUNG_MAX", material::BEMERKUNG_MAX),
        ("MATERIAL_STAMM_TEXT_MAX", material::STAMM_TEXT_MAX),
        (
            "MATERIAL_STAMM_BEMERKUNG_MAX",
            material::STAMM_BEMERKUNG_MAX,
        ),
        ("FAHRZEUG_ADHOC_TEXT_MAX", fahrzeug::ADHOC_TEXT_MAX),
        ("FAHRZEUG_BEMERKUNG_MAX", fahrzeug::BEMERKUNG_MAX),
        (
            "NACHFORDERUNG_BEZEICHNUNG_MAX",
            nachforderung::BEZEICHNUNG_MAX,
        ),
        ("NACHFORDERUNG_ART_MAX", nachforderung::ART_MAX),
        ("NACHFORDERUNG_ZIEL_TEXT_MAX", nachforderung::ZIEL_TEXT_MAX),
        (
            "NACHFORDERUNG_ZUSAGE_RUFNAME_MAX",
            nachforderung::ZUSAGE_RUFNAME_MAX,
        ),
        (
            "NACHFORDERUNG_ZUSAGE_RUFNAMEN_MAX",
            nachforderung::ZUSAGE_RUFNAMEN_MAX,
        ),
        (
            "NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX",
            nachforderung::ZURUECKZIEHEN_GRUND_MAX,
        ),
        (
            "NACHFORDERUNG_ABLEHNEN_GRUND_MAX",
            nachforderung::ABLEHNEN_GRUND_MAX,
        ),
        (
            "NACHFORDERUNG_UEBERNAHME_EINHEITEN_MAX",
            nachforderung::UEBERNAHME_EINHEITEN_MAX,
        ),
        ("INFOTELEFON_NOTIZ_MAX", infotelefon::NOTIZ_MAX),
        ("INFOTELEFON_KURZ_MAX", infotelefon::KURZ_MAX),
        ("SCHADEN_ORT_MAX", schaden::ORT_MAX),
        ("EINSATZORT_MAX", einsatz::EINSATZORT_MAX),
        ("SCHADEN_BESCHREIBUNG_MAX", schaden::BESCHREIBUNG_MAX),
        ("GEFAHR_BESCHREIBUNG_MAX", gefahr::BESCHREIBUNG_MAX),
        ("GEFAHR_GEMELDET_VON_MAX", gefahr::GEMELDET_VON_MAX),
        ("GEFAHR_GEBIET_LABEL_MAX", gefahr::GEBIET_LABEL_MAX),
        ("ZONE_LABEL_MAX", lage_zone::LABEL_MAX),
        ("ZONE_NOTIZ_MAX", lage_zone::NOTIZ_MAX),
        ("GEOMETRIE_STUETZPUNKTE_MAX", lage_zone::STUETZPUNKTE_MAX),
        ("KREIS_RADIUS_M_MAX", lage_zone::KREIS_RADIUS_M_MAX),
        ("SPRECHGRUPPE_BEDINGUNG_MAX", sprechgruppe::BEDINGUNG_MAX),
        (
            "FUEHRUNGSSTELLE_BEZEICHNUNG_MAX",
            fuehrungsstelle::FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
        ),
        (
            "FUEHRUNGSSTELLE_ADRESSE_MAX",
            fuehrungsstelle::FUEHRUNGSSTELLE_ADRESSE_MAX,
        ),
        (
            "EXTERNE_STELLE_BEZEICHNUNG_MAX",
            externe_stelle::BEZEICHNUNG_MAX,
        ),
        ("EXTERNE_STELLE_KURZ_MAX", externe_stelle::KURZ_MAX),
        ("MELDENDE_STELLE_MAX", einsatz::MELDENDE_STELLE_MAX),
        (
            "FUEHRUNG_GRUND_MAX",
            lifeline_hub::instanz::fuehrung::GRUND_MAX,
        ),
        (
            "EINSATZLEITER_NAME_MAX",
            fuehrungsstelle::EINSATZLEITER_NAME_MAX,
        ),
        (
            "PROGRAMMPUNKT_BEZEICHNUNG_MAX",
            programmpunkt::PROGRAMMPUNKT_BEZEICHNUNG_MAX,
        ),
        ("EINHEIT_VORLAGE_NAME_MAX", einheit_vorlage::NAME_MAX),
        ("EINHEIT_BEMERKUNG_MAX", einheit::BEMERKUNG_MAX),
        (
            "EINHEIT_VORLAGE_FUNKRUFNAME_MAX",
            einheit_vorlage::FUNKRUFNAME_MAX,
        ),
        (
            "EINHEIT_VORLAGE_BEMERKUNG_MAX",
            einheit_vorlage::BEMERKUNG_MAX,
        ),
        (
            "EINHEIT_VORLAGE_FAHRZEUGE_MAX",
            einheit_vorlage::FAHRZEUGE_JE_VORLAGE_MAX,
        ),
        (
            "EINHEIT_VORLAGE_PERSONAL_MAX",
            einheit_vorlage::PERSONAL_JE_VORLAGE_MAX,
        ),
        ("SAMMEL_MAX", kraefte_disposition::SAMMEL_MAX),
        ("EINHEIT_NAME_MAX", einheit::NAME_MAX),
        ("EINHEIT_FUNKRUFNAME_MAX", einheit::FUNKRUFNAME_MAX),
        ("VERBINDUNGEN_MAX", einsatz::verbindungen::VERBINDUNGEN_MAX),
        (
            "VERBINDUNG_TEXT_MAX",
            einsatz::verbindungen::VERBINDUNG_TEXT_MAX,
        ),
        (
            "ABSCHNITT_RUFNAME_MAX",
            einsatz::verbindungen::ABSCHNITT_RUFNAME_MAX,
        ),
        ("ERWAEHNUNGEN_MAX", chat::erwaehnung::ERWAEHNUNGEN_MAX),
        (
            "VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX",
            verpflegung::ZEITFENSTER_BEZEICHNUNG_MAX,
        ),
        (
            "VERPFLEGUNG_STELLE_BEZEICHNUNG_MAX",
            verpflegung::STELLE_BEZEICHNUNG_MAX,
        ),
        ("VERPFLEGUNG_STANDORT_MAX", verpflegung::STANDORT_MAX),
        ("BR_BEZEICHNUNG_MAX", bereitstellungsraum::BEZEICHNUNG_MAX),
        ("BR_STANDORT_MAX", bereitstellungsraum::STANDORT_MAX),
        ("BR_NOTIZ_MAX", bereitstellungsraum::NOTIZ_MAX),
        ("VERPFLEGUNG_ORT_MAX", verpflegung::ORT_MAX),
        ("VERPFLEGUNG_BEMERKUNG_MAX", verpflegung::BEMERKUNG_MAX),
        (
            "VERPFLEGUNG_STELLEN_JE_ZEITFENSTER_MAX",
            verpflegung::STELLEN_JE_ZEITFENSTER_MAX,
        ),
        (
            "VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX",
            verpflegung::vorlage::BEZEICHNUNG_MAX,
        ),
        ("VERPFLEGUNG_AUS_VORLAGE_MAX", verpflegung::AUS_VORLAGE_MAX),
        (
            "VERPFLEGUNG_EP_MAX",
            usize::try_from(verpflegung::MAX_EP).unwrap(),
        ),
        (
            "SCHICHTMODELL_BEZEICHNUNG_MAX",
            schichtmodell::BEZEICHNUNG_MAX,
        ),
        (
            "EINSATZ_VORLAGE_BEZEICHNUNG_MAX",
            einsatz_vorlage::BEZEICHNUNG_MAX,
        ),
        (
            "SCHICHTMODELL_WECHSELZEITEN_MAX",
            schichtmodell::WECHSELZEITEN_MAX,
        ),
        (
            "SCHICHTMODELL_MINDESTDAUER_MAX_MINUTEN",
            usize::try_from(schichtmodell::MINDESTDAUER_MAX_MINUTEN).unwrap(),
        ),
        (
            "SCHICHTMODELL_VORLAUF_MAX_MINUTEN",
            usize::try_from(schichtmodell::VORLAUF_MAX_MINUTEN).unwrap(),
        ),
        (
            "ABLOESUNG_RHYTHMUS_MAX_MINUTEN",
            usize::try_from(abloesung::RHYTHMUS_MAX_MINUTEN).unwrap(),
        ),
        (
            "SCHICHTPLAN_MAX_DIENST_MIN_MINUTEN",
            usize::try_from(*schichtplan::MAX_DIENST_BEREICH.start()).unwrap(),
        ),
        (
            "SCHICHTPLAN_MAX_DIENST_MAX_MINUTEN",
            usize::try_from(*schichtplan::MAX_DIENST_BEREICH.end()).unwrap(),
        ),
        (
            "SCHICHTPLAN_MIN_RUHE_MAX_MINUTEN",
            usize::try_from(*schichtplan::MIN_RUHE_BEREICH.end()).unwrap(),
        ),
        ("ABLOESUNG_ABLOESER_MAX", abloesung::ABLOESER_MAX),
        ("ABLOESUNG_BESATZUNG_MAX", abloesung::BESATZUNG_MAX),
        ("SCHICHTPLAN_PERSONEN_MAX", schichtplan::PLAN_PERSONEN_MAX),
        ("SCHICHTPLAN_ERZEUGEN_MAX", schichtplan::ERZEUGEN_MAX),
        ("SCHICHTPLAN_NOTIZ_MAX", schichtplan::NOTIZ_MAX),
        (
            "SCHICHTPLAN_DATEI_MAX_BYTES",
            schichtplan::uebernahme::DATEI_MAX_BYTES,
        ),
        ("SCHICHTPLAN_HELFER_TEXT_MAX", schichtplan::HELFER_TEXT_MAX),
        (
            "SCHICHTPLAN_HELFER_TELEFON_MAX",
            schichtplan::HELFER_TELEFON_MAX,
        ),
        (
            "SCHICHTPLAN_HELFER_QUALIFIKATIONEN_MAX",
            schichtplan::HELFER_QUALIFIKATIONEN_MAX,
        ),
        (
            "SCHICHTPLAN_SOLL_ANZAHL_MAX",
            usize::try_from(schichtplan::SOLL_ANZAHL_MAX).unwrap(),
        ),
        ("PLANUNG_BEZEICHNUNG_MAX", planung::BEZEICHNUNG_MAX),
        ("PLANUNG_ABSCHNITT_MAX", planung::ABSCHNITT_MAX),
        ("PLANUNG_ORT_MAX", planung::ORT_MAX),
        ("PLANUNG_POSTEN_MAX", planung::POSTEN_MAX as usize),
        (
            "PLANUNG_ZEITRAUM_MAX_TAGE",
            planung::ZEITRAUM_MAX_TAGE as usize,
        ),
        ("ZEITACHSE_GRUND_MAX", zeitachse::GRUND_MAX),
        ("ZEITACHSE_NOTIZ_MAX", zeitachse::NOTIZ_MAX),
        (
            "LAGEMONITOR_BEZEICHNUNG_MAX",
            lagemonitor_zugang::BEZEICHNUNG_MAX,
        ),
        ("QUALI_SOLL_MAX", personal::quali_soll::QUALI_SOLL_MAX),
        (
            "QUALI_SOLL_ANZAHL_MAX",
            usize::try_from(personal::quali_soll::QUALI_SOLL_ANZAHL_MAX).unwrap(),
        ),
        (
            "UHS_SOLL_ANZAHL_MAX",
            usize::try_from(lifeline_hub::uhs::SOLL_ANZAHL_MAX).unwrap(),
        ),
    ])
}

/// `export const NAME = 20_000;` je Zeile; andere Zeilen (Kommentare) zählen nicht.
fn frontend() -> BTreeMap<String, usize> {
    let pfad = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/frontend/src/api/eingabegrenzen.ts"
    );
    let text = std::fs::read_to_string(pfad).expect("Spiegeldatei lesbar");
    text.lines()
        .filter_map(|z| z.trim().strip_prefix("export const "))
        .map(|rest| {
            let (name, wert) = rest
                .split_once(" = ")
                .unwrap_or_else(|| panic!("Form `export const NAME = 123;`: {rest}"));
            let zahl = wert
                .trim_end_matches(';')
                .replace('_', "")
                .parse()
                .unwrap_or_else(|_| panic!("{name}: keine Zahl: {wert}"));
            (name.to_string(), zahl)
        })
        .collect()
}

#[test]
fn jede_grenze_des_frontends_entspricht_dem_backend() {
    let b: BTreeMap<String, usize> = backend()
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    assert_eq!(frontend(), b);
}

/// LLH-1560: Die Lagekarte übernimmt die Bezeichnung eines Evakuierungsbezirks beim Zeichnen als
/// Bezeichnung der Zone. Läge die Bezirksgrenze darüber, scheiterte das Zeichnen an einem gültigen
/// Bezirk mit 400.
#[test]
fn bezirksbezeichnung_passt_in_die_zonenbezeichnung() {
    assert!(betreuung::BEZIRK_BEZEICHNUNG_MAX <= lage_zone::LABEL_MAX);
}
