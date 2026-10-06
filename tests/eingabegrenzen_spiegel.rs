//! LFH-937: Die Eingabemasken lassen nicht mehr zu als der Server (Spec `eingabegrenzen`,
//! design.md D8). `frontend/src/api/eingabegrenzen.ts` spiegelt jede Grenze; dieser Test liest
//! die Datei und vergleicht Name für Name, damit keine Seite still driftet.

use std::collections::BTreeMap;

use lifeline_hub::{
    auftrag, etb, fuehrung, infotelefon, lage_zone, nachforderung, presse, schaden,
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
        ("FUNKTION_TEXT_MAX", fuehrung::TEXT_MAX),
        (
            "NACHFORDERUNG_BEZEICHNUNG_MAX",
            nachforderung::BEZEICHNUNG_MAX,
        ),
        ("INFOTELEFON_NOTIZ_MAX", infotelefon::NOTIZ_MAX),
        ("INFOTELEFON_KURZ_MAX", infotelefon::KURZ_MAX),
        ("PRESSE_KURZ_MAX", presse::KURZ_MAX),
        ("PRESSE_THEMA_MAX", presse::THEMA_MAX),
        ("PRESSE_ANTWORT_MAX", presse::ANTWORT_MAX),
        ("SCHADEN_ORT_MAX", schaden::ORT_MAX),
        ("SCHADEN_BESCHREIBUNG_MAX", schaden::BESCHREIBUNG_MAX),
        ("GEOMETRIE_STUETZPUNKTE_MAX", lage_zone::STUETZPUNKTE_MAX),
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
