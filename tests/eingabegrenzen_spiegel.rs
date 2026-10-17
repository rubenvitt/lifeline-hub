//! LFH-937: Die Eingabemasken lassen nicht mehr zu als der Server (Spec `eingabegrenzen`,
//! design.md D8). `frontend/src/api/eingabegrenzen.ts` spiegelt jede Grenze; dieser Test liest
//! die Datei und vergleicht Name für Name, damit keine Seite still driftet.

use std::collections::BTreeMap;

use lifeline_hub::einsatz::fuehrungsstelle;
use lifeline_hub::{
    abloesung, auftrag, chat, einheit, einheit_vorlage, einsatz, etb, externe_stelle, fahrzeug,
    fuehrung, infotelefon, kraefte_disposition, lage_zone, lagebesprechung, material,
    nachforderung, personal, presse, schaden, schichtmodell, sprechgruppe, verpflegung,
    vorlagendokument,
};

fn backend() -> BTreeMap<&'static str, usize> {
    BTreeMap::from([
        ("ETB_INHALT_MAX", etb::INHALT_MAX),
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
        ("PERSONAL_ADHOC_TEXT_MAX", personal::ADHOC_TEXT_MAX),
        (
            "PERSONAL_EINSATZFUNKTION_MAX",
            personal::EINSATZFUNKTION_MAX,
        ),
        ("PERSONAL_BEMERKUNG_MAX", personal::BEMERKUNG_MAX),
        ("MATERIAL_ADHOC_TEXT_MAX", material::ADHOC_TEXT_MAX),
        ("MATERIAL_BEMERKUNG_MAX", material::BEMERKUNG_MAX),
        ("FAHRZEUG_ADHOC_TEXT_MAX", fahrzeug::ADHOC_TEXT_MAX),
        ("FAHRZEUG_BEMERKUNG_MAX", fahrzeug::BEMERKUNG_MAX),
        (
            "NACHFORDERUNG_BEZEICHNUNG_MAX",
            nachforderung::BEZEICHNUNG_MAX,
        ),
        ("NACHFORDERUNG_ART_MAX", nachforderung::ART_MAX),
        ("INFOTELEFON_NOTIZ_MAX", infotelefon::NOTIZ_MAX),
        ("INFOTELEFON_KURZ_MAX", infotelefon::KURZ_MAX),
        ("PRESSE_KURZ_MAX", presse::KURZ_MAX),
        ("PRESSE_THEMA_MAX", presse::THEMA_MAX),
        ("PRESSE_ANTWORT_MAX", presse::ANTWORT_MAX),
        ("SCHADEN_ORT_MAX", schaden::ORT_MAX),
        ("EINSATZORT_MAX", einsatz::EINSATZORT_MAX),
        ("SCHADEN_BESCHREIBUNG_MAX", schaden::BESCHREIBUNG_MAX),
        ("GEOMETRIE_STUETZPUNKTE_MAX", lage_zone::STUETZPUNKTE_MAX),
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
            "EINSATZLEITER_NAME_MAX",
            fuehrungsstelle::EINSATZLEITER_NAME_MAX,
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
        ("ABLOESUNG_ABLOESER_MAX", abloesung::ABLOESER_MAX),
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
