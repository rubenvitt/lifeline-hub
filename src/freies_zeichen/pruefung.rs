//! Prüfung der Zeichenbeschreibung `freies_zeichen.zeichen_spec` (LFH-836, design.md D3).
//!
//! Der Client sendet die kanonische Serialisierung von `@einsatzzeichen` (`serializeAnySpec`):
//! `{"v":1,"spec":{…}}` für ein Zeichen mit Grundzeichen oder `{"v":1,"freestanding":{…}}` für ein
//! freistehendes. Der Server kennt die Bibliothek nicht; er prüft Form und Wertezugehörigkeit gegen
//! die erzeugte Werteliste `zeichen_werte.json` (Erzeuger `frontend/scripts/zeichen-werte.mjs`,
//! Wächter `frontend/src/zeichen/zeichenWerte.guard.test.ts`). Ob sich eine gültige Beschreibung
//! zeichnen lässt, prüft nur der Client. Jeder Verstoß ist 400 (`src/AGENTS.md`,
//! Statuscode-Konvention): das Feld ist für sich unbrauchbar.

use crate::error::AppError;
use crate::routes::support::pflicht_max;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

/// Höchstlänge der Zeichenbeschreibung in Zeichen (`src/AGENTS.md`, Eingabegrenzen). Eine reiche
/// Beschreibung mit Grundzeichen, Organisation, Stärke und mehreren Fähigkeiten bleibt unter 600
/// Zeichen; die Grenze lässt Raum für Verläufe, ohne den Body-Limit-Rahmen anzutasten.
pub const ZEICHEN_SPEC_MAX: usize = 4096;

const FELD: &str = "zeichen_spec";

/// Die erzeugte Werteliste, einmal gelesen. Ein Lesefehler ist ein Baufehler, kein Laufzeitfall:
/// `werteliste_ist_lesbar_und_vollstaendig` fängt ihn im Test.
static WERTELISTE: LazyLock<Werteliste> = LazyLock::new(|| {
    serde_json::from_str(include_str!("zeichen_werte.json"))
        .expect("zeichen_werte.json ist eine lesbare Werteliste")
});

fn werteliste() -> &'static Werteliste {
    &WERTELISTE
}

#[derive(Debug, Deserialize)]
struct Werteliste {
    #[serde(rename = "formatVersion")]
    format_version: u64,
    spec: Art,
    freestanding: BTreeMap<String, Art>,
}

#[derive(Debug, Deserialize)]
struct Art {
    felder: BTreeMap<String, Feld>,
    pflicht: Vec<String>,
}

/// Form eines Feldes, wie `frontend/scripts/zeichen-werte.mjs` sie beschreibt.
#[derive(Debug, Deserialize)]
#[serde(tag = "form", rename_all = "lowercase")]
enum Feld {
    Wert {
        werte: BTreeSet<String>,
    },
    Liste {
        werte: BTreeSet<String>,
        min: usize,
    },
    Schalter,
    Fassungen {
        schluessel: BTreeSet<String>,
        werte: BTreeSet<String>,
    },
    Verlauf,
    Flaeche,
    Verboten {
        grund: String,
    },
}

/// Prüft eine gesendete Zeichenbeschreibung und liefert sie getrimmt zurück; sonst 400 mit Pfad.
///
/// Gespeichert wird, was der Client sendet (ohne Rand-Leerraum); Kanonisieren ist seine Sache.
pub fn pruefe_zeichen_spec(roh: &str) -> Result<String, AppError> {
    let spec = pflicht_max(roh, FELD, ZEICHEN_SPEC_MAX)?;
    let wert: Value = serde_json::from_str(&spec)
        .map_err(|e| AppError::Validation(format!("{FELD}: $: kein gültiges JSON ({e})")))?;
    pruefe_huelle(&wert, werteliste()).map_err(|Verstoss { pfad, grund }| {
        AppError::Validation(format!("{FELD}: {pfad}: {grund}"))
    })?;
    Ok(spec)
}

/// Ein Formfehler mit Pfad in die Eingabe (`$` ist die Wurzel, `$.spec.capabilities[1]` ein
/// Listeneintrag) — dieselbe Schreibweise wie `SpecParseError` der Bibliothek.
#[derive(Debug)]
struct Verstoss {
    pfad: String,
    grund: String,
}

fn verstoss(pfad: &str, grund: impl Into<String>) -> Verstoss {
    Verstoss {
        pfad: pfad.to_string(),
        grund: grund.into(),
    }
}

type Ergebnis = Result<(), Verstoss>;

fn beschreibe(wert: &Value) -> String {
    match wert {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => format!("die Zahl {n}"),
        Value::String(s) => format!("„{s}“"),
        Value::Array(_) => "eine Liste".into(),
        Value::Object(_) => "ein Objekt".into(),
    }
}

fn objekt<'a>(wert: &'a Value, pfad: &str, was: &str) -> Result<&'a Map<String, Value>, Verstoss> {
    wert.as_object().ok_or_else(|| {
        verstoss(
            pfad,
            format!("erwartet ein Objekt ({was}), gefunden {}", beschreibe(wert)),
        )
    })
}

fn text<'a>(wert: &'a Value, pfad: &str) -> Result<&'a str, Verstoss> {
    wert.as_str().ok_or_else(|| {
        verstoss(
            pfad,
            format!("erwartet eine Zeichenkette, gefunden {}", beschreibe(wert)),
        )
    })
}

fn zahl(wert: &Value, pfad: &str) -> Result<f64, Verstoss> {
    wert.as_f64().ok_or_else(|| {
        verstoss(
            pfad,
            format!(
                "erwartet eine Zahl in Millimetern, gefunden {}",
                beschreibe(wert)
            ),
        )
    })
}

fn positiv(wert: &Value, pfad: &str) -> Ergebnis {
    let z = zahl(wert, pfad)?;
    if z <= 0.0 {
        return Err(verstoss(
            pfad,
            format!("erwartet eine Zahl größer als null, gefunden {z}"),
        ));
    }
    Ok(())
}

fn punkt(wert: &Value, pfad: &str) -> Ergebnis {
    match wert.as_array() {
        Some(paar) if paar.len() == 2 => {
            zahl(&paar[0], &format!("{pfad}[0]"))?;
            zahl(&paar[1], &format!("{pfad}[1]"))?;
            Ok(())
        }
        _ => Err(verstoss(
            pfad,
            format!(
                "erwartet einen Stützpunkt aus genau zwei Zahlen, gefunden {}",
                beschreibe(wert)
            ),
        )),
    }
}

/// Hülle: `v` gleich der Formatversion, genau eines von `spec`/`freestanding`, sonst nichts.
fn pruefe_huelle(wert: &Value, w: &Werteliste) -> Ergebnis {
    let huelle = objekt(
        wert,
        "$",
        r#"die Hülle {"v":1,"spec":{…}} oder {"v":1,"freestanding":{…}}"#,
    )?;
    for schluessel in huelle.keys() {
        if !matches!(schluessel.as_str(), "v" | "spec" | "freestanding") {
            return Err(verstoss(
                &format!("$.{schluessel}"),
                format!(
                    "unbekanntes Feld „{schluessel}“ in der Hülle; erlaubt sind v und entweder \
                     spec oder freestanding"
                ),
            ));
        }
    }
    match huelle.get("v") {
        None => return Err(verstoss("$.v", "Pflichtfeld „v“ (Formatversion) fehlt")),
        Some(v) if v.as_f64() == Some(w.format_version as f64) => {}
        Some(v) => {
            return Err(verstoss(
                "$.v",
                format!(
                    "Formatversion {} wird nicht gelesen; gelesen wird nur Version {}",
                    beschreibe(v),
                    w.format_version
                ),
            ))
        }
    }
    match (huelle.get("spec"), huelle.get("freestanding")) {
        (Some(_), Some(_)) => Err(verstoss(
            "$",
            "die Hülle trägt entweder spec oder freestanding, nicht beides",
        )),
        (None, None) => Err(verstoss(
            "$.spec",
            "Pflichtfeld „spec“ oder „freestanding“ fehlt in der Hülle",
        )),
        (Some(spec), None) => {
            let spec = objekt(spec, "$.spec", "eine SymbolSpec")?;
            pruefe_art(spec, &w.spec, "$.spec")
        }
        (None, Some(frei)) => {
            let pfad = "$.freestanding";
            let frei = objekt(frei, pfad, "ein freistehendes Zeichen")?;
            let kind = frei
                .get("kind")
                .ok_or_else(|| verstoss("$.freestanding.kind", "Pflichtfeld „kind“ fehlt"))?;
            let kind = text(kind, "$.freestanding.kind")?;
            let art = w.freestanding.get(kind).ok_or_else(|| {
                verstoss(
                    "$.freestanding.kind",
                    format!(
                        "unbekannte Art „{kind}“; erlaubt sind: {}",
                        w.freestanding
                            .keys()
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                )
            })?;
            pruefe_art(frei, art, pfad)
        }
    }
}

/// Eine Art: Pflichtfelder vorhanden, nur ihre Felder, jeder Wert nach seiner Form.
fn pruefe_art(objekt: &Map<String, Value>, art: &Art, pfad: &str) -> Ergebnis {
    for (name, wert) in objekt {
        let feldpfad = format!("{pfad}.{name}");
        let feld = art.felder.get(name).ok_or_else(|| {
            verstoss(
                &feldpfad,
                format!("unbekanntes Feld „{name}“ an dieser Art"),
            )
        })?;
        if let Feld::Verboten { grund } = feld {
            return Err(verstoss(&feldpfad, grund.clone()));
        }
        if wert.is_null() {
            return Err(verstoss(
                &feldpfad,
                "null ist kein zulässiger Wert; ein nicht gesetztes Feld wird weggelassen",
            ));
        }
        pruefe_feld(name, wert, feld, &feldpfad)?;
    }
    for name in &art.pflicht {
        if !objekt.contains_key(name) {
            return Err(verstoss(
                &format!("{pfad}.{name}"),
                format!("Pflichtfeld „{name}“ fehlt"),
            ));
        }
    }
    Ok(())
}

fn ein_wert(name: &str, wert: &Value, werte: &BTreeSet<String>, pfad: &str) -> Ergebnis {
    let w = text(wert, pfad)?;
    if !werte.contains(w) {
        let grund = if name == "kind" {
            format!("unbekannte Art „{w}“")
        } else {
            format!("unbekannter Wert „{w}“")
        };
        return Err(verstoss(pfad, grund));
    }
    Ok(())
}

fn pruefe_feld(name: &str, wert: &Value, feld: &Feld, pfad: &str) -> Ergebnis {
    match feld {
        Feld::Wert { werte } => ein_wert(name, wert, werte, pfad),
        Feld::Liste { werte, min } => {
            let liste = wert.as_array().ok_or_else(|| {
                verstoss(
                    pfad,
                    format!("erwartet eine Liste, gefunden {}", beschreibe(wert)),
                )
            })?;
            if liste.len() < *min {
                return Err(verstoss(
                    pfad,
                    format!(
                        "erwartet mindestens {min} Einträge, gefunden {}",
                        liste.len()
                    ),
                ));
            }
            let mut gesehen = BTreeSet::new();
            for (i, eintrag) in liste.iter().enumerate() {
                let eintragspfad = format!("{pfad}[{i}]");
                ein_wert(name, eintrag, werte, &eintragspfad)?;
                let w = text(eintrag, &eintragspfad)?;
                if !gesehen.insert(w) {
                    return Err(verstoss(
                        &eintragspfad,
                        format!("„{w}“ steht doppelt in der Liste"),
                    ));
                }
            }
            Ok(())
        }
        Feld::Schalter => {
            if wert != &Value::Bool(true) {
                return Err(verstoss(
                    pfad,
                    format!(
                        "erlaubt ist nur true (sonst das Feld weglassen), gefunden {}",
                        beschreibe(wert)
                    ),
                ));
            }
            Ok(())
        }
        Feld::Fassungen { schluessel, werte } => {
            let fassungen = objekt(wert, pfad, "Fassung je Körpermarke")?;
            for (marke, fassung) in fassungen {
                let fpfad = format!("{pfad}.{marke}");
                if !schluessel.contains(marke) {
                    return Err(verstoss(
                        &fpfad,
                        format!("unbekannte Körpermarke „{marke}“"),
                    ));
                }
                ein_wert("", fassung, werte, &fpfad)?;
            }
            Ok(())
        }
        Feld::Verlauf => pruefe_verlauf(wert, pfad),
        Feld::Flaeche => {
            let flaeche = objekt(wert, pfad, "Zeichenfläche mit width und height")?;
            for (schluessel, mass) in flaeche {
                if !matches!(schluessel.as_str(), "width" | "height") {
                    return Err(verstoss(
                        &format!("{pfad}.{schluessel}"),
                        format!("unbekanntes Feld „{schluessel}“ in der Zeichenfläche"),
                    ));
                }
                positiv(mass, &format!("{pfad}.{schluessel}"))?;
            }
            for pflicht in ["width", "height"] {
                if !flaeche.contains_key(pflicht) {
                    return Err(verstoss(
                        &format!("{pfad}.{pflicht}"),
                        format!("Pflichtfeld „{pflicht}“ fehlt in der Zeichenfläche"),
                    ));
                }
            }
            Ok(())
        }
        // Steht vor dem Aufruf fest (pruefe_art); hier nur der Vollständigkeit halber.
        Feld::Verboten { grund } => Err(verstoss(pfad, grund.clone())),
    }
}

/// Ein Verlauf nur der Form nach: Stützpunkte (mindestens zwei) ODER ein gerader Verlauf aus
/// `start`, `directionDeg` und `lengthMm` — nicht beides, nichts sonst. Der Picker bietet Pfeile
/// und Linien nicht an (design.md D3); ob ein Verlauf in die Fläche passt, prüft der Client.
fn pruefe_verlauf(wert: &Value, pfad: &str) -> Ergebnis {
    const GERADE: [&str; 3] = ["start", "directionDeg", "lengthMm"];
    let verlauf = objekt(wert, pfad, "einen Verlauf")?;
    for schluessel in verlauf.keys() {
        if schluessel != "points" && !GERADE.contains(&schluessel.as_str()) {
            return Err(verstoss(
                &format!("{pfad}.{schluessel}"),
                format!("unbekanntes Feld „{schluessel}“ im Verlauf"),
            ));
        }
    }
    let gerade = GERADE.iter().any(|k| verlauf.contains_key(*k));
    match (verlauf.get("points"), gerade) {
        (Some(_), true) => Err(verstoss(
            pfad,
            "ein Verlauf ist entweder points oder start, directionDeg und lengthMm, nicht beides",
        )),
        (Some(punkte), false) => {
            let ppfad = format!("{pfad}.points");
            let liste = punkte.as_array().ok_or_else(|| {
                verstoss(
                    &ppfad,
                    format!("erwartet eine Liste, gefunden {}", beschreibe(punkte)),
                )
            })?;
            if liste.len() < 2 {
                return Err(verstoss(
                    &ppfad,
                    format!(
                        "erwartet mindestens zwei Stützpunkte, gefunden {}",
                        liste.len()
                    ),
                ));
            }
            for (i, p) in liste.iter().enumerate() {
                punkt(p, &format!("{ppfad}[{i}]"))?;
            }
            Ok(())
        }
        (None, true) => {
            for k in GERADE {
                if !verlauf.contains_key(k) {
                    return Err(verstoss(
                        &format!("{pfad}.{k}"),
                        format!("Pflichtfeld „{k}“ fehlt im geraden Verlauf"),
                    ));
                }
            }
            punkt(&verlauf["start"], &format!("{pfad}.start"))?;
            zahl(&verlauf["directionDeg"], &format!("{pfad}.directionDeg"))?;
            positiv(&verlauf["lengthMm"], &format!("{pfad}.lengthMm"))
        }
        (None, false) => Err(verstoss(
            pfad,
            "erwartet einen Verlauf: points oder start, directionDeg und lengthMm",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ausgaben von `serializeAnySpec` aus `@einsatzzeichen/core` 5.2.0 (per Node erzeugt, nicht
    /// von Hand geschrieben); die ersten fünf zeichnet `drawAnySpec` auch.
    const STELLE_SANITAET: &str = r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;
    const THW_ZUG: &str = r#"{"v":1,"spec":{"capabilities":["recovery","lighting"],"kind":"formation","organization":"thw","strength":"zug"}}"#;
    const GEFAHR_ROT: &str = r#"{"v":1,"spec":{"kind":"hazard","technicalFill":"rot"}}"#;
    const ZUSTAND_BRAND: &str =
        r#"{"v":1,"freestanding":{"kind":"state","state":"developed-fire"}}"#;
    const DREHLEITER: &str = r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"capability.rescue-aerial-ladder"}}"#;
    /// Lesbar, aber nicht zeichenbar (Verlauf ragt aus der Fläche): der Server prüft nur die Form.
    const PFEIL: &str = r#"{"v":1,"freestanding":{"kind":"movement","movement":"direction-of-action","path":{"points":[[0,0],[20,5]]}}}"#;

    fn meldung(roh: &str) -> String {
        match pruefe_zeichen_spec(roh) {
            Err(AppError::Validation(m)) => m,
            anders => panic!("400 erwartet für {roh}, bekommen {anders:?}"),
        }
    }

    #[test]
    fn gueltige_symbol_spec_wird_angenommen() {
        for spec in [STELLE_SANITAET, THW_ZUG, GEFAHR_ROT] {
            assert_eq!(pruefe_zeichen_spec(spec).unwrap(), spec);
        }
    }

    #[test]
    fn gueltiger_zustand_und_piktogramm_werden_angenommen() {
        for spec in [ZUSTAND_BRAND, DREHLEITER] {
            assert_eq!(pruefe_zeichen_spec(spec).unwrap(), spec);
        }
    }

    #[test]
    fn verlauf_wird_nur_der_form_nach_geprueft() {
        assert_eq!(pruefe_zeichen_spec(PFEIL).unwrap(), PFEIL);
        let gerade = r#"{"v":1,"freestanding":{"kind":"line","line":"escape-route","path":{"directionDeg":90,"lengthMm":20,"start":[2,16]},"canvasMm":{"height":32,"width":32}}}"#;
        assert_eq!(pruefe_zeichen_spec(gerade).unwrap(), gerade);

        let m = meldung(
            r#"{"v":1,"freestanding":{"kind":"movement","movement":"direction-of-action","path":{"points":[[0,0]]}}}"#,
        );
        assert!(m.contains("$.freestanding.path"), "{m}");
        let m = meldung(
            r#"{"v":1,"freestanding":{"kind":"movement","movement":"direction-of-action","path":{"points":[[0,0],[1,1]],"lengthMm":3}}}"#,
        );
        assert!(m.contains("$.freestanding.path"), "{m}");
        let m = meldung(
            r#"{"v":1,"freestanding":{"kind":"line","line":"escape-route","path":{"points":[[0,0],[1,1]]},"canvasMm":{"height":0,"width":32}}}"#,
        );
        assert!(m.contains("$.freestanding.canvasMm.height"), "{m}");
    }

    #[test]
    fn wird_getrimmt_zurueckgegeben() {
        assert_eq!(
            pruefe_zeichen_spec(&format!("  {GEFAHR_ROT}\n")).unwrap(),
            GEFAHR_ROT
        );
    }

    #[test]
    fn leer_ist_400() {
        assert!(meldung("   ").contains("zeichen_spec darf nicht leer sein"));
    }

    #[test]
    fn kaputtes_json_ist_400() {
        let m = meldung(r#"{"v":1,"spec":{"kind":"post""#);
        assert!(m.contains("kein gültiges JSON"), "{m}");
        let m = meldung(r#"[1,2]"#);
        assert!(m.contains("$"), "{m}");
    }

    #[test]
    fn formatversion_2_ist_400() {
        let m = meldung(r#"{"v":2,"spec":{"kind":"post"}}"#);
        assert!(m.contains("$.v"), "{m}");
        assert!(m.contains("Formatversion"), "{m}");
        let m = meldung(r#"{"spec":{"kind":"post"}}"#);
        assert!(m.contains("$.v"), "Hülle ohne v: {m}");
    }

    #[test]
    fn genau_eine_huelle() {
        let m = meldung(
            r#"{"v":1,"spec":{"kind":"post"},"freestanding":{"kind":"state","state":"developed-fire"}}"#,
        );
        assert!(m.contains("entweder spec oder freestanding"), "{m}");
        let m = meldung(r#"{"v":1}"#);
        assert!(m.contains("spec") && m.contains("freestanding"), "{m}");
        let m = meldung(r#"{"v":1,"spec":{"kind":"post"},"extra":1}"#);
        assert!(m.contains("$.extra"), "{m}");
    }

    #[test]
    fn unbekannte_art_ist_400() {
        let m = meldung(r#"{"v":1,"spec":{"kind":"raumschiff"}}"#);
        assert!(m.contains("$.spec.kind"), "{m}");
        assert!(m.contains("unbekannte Art „raumschiff“"), "{m}");
        let m = meldung(r#"{"v":1,"freestanding":{"kind":"post"}}"#);
        assert!(m.contains("$.freestanding.kind"), "{m}");
        assert!(m.contains("unbekannte Art „post“"), "{m}");
        let m = meldung(r#"{"v":1,"spec":{"organization":"feuerwehr"}}"#);
        assert!(m.contains("$.spec.kind"), "Pflichtfeld: {m}");
    }

    #[test]
    fn fremdes_feld_ist_400() {
        // Ein Feld einer anderen Art: die Stärke gehört nicht an ein Piktogramm.
        let m = meldung(
            r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"capability.rescue-aerial-ladder","strength":"zug"}}"#,
        );
        assert!(m.contains("$.freestanding.strength"), "{m}");
        assert!(m.contains("unbekanntes Feld"), "{m}");
        // Ein Tippfehler fällt nicht still weg.
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","organisation":"feuerwehr"}}"#);
        assert!(m.contains("$.spec.organisation"), "{m}");
        // Pflichtfeld der Art fehlt.
        let m = meldung(r#"{"v":1,"freestanding":{"kind":"pictogram"}}"#);
        assert!(m.contains("$.freestanding.pictogram"), "{m}");
    }

    #[test]
    fn unbekannter_wert_ist_400() {
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","organization":"gibt-es-nicht"}}"#);
        assert!(m.contains("$.spec.organization"), "{m}");
        assert!(m.contains("unbekannter Wert „gibt-es-nicht“"), "{m}");
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","capabilities":["recovery","quatsch"]}}"#);
        assert!(m.contains("$.spec.capabilities[1]"), "{m}");
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","organization":7}}"#);
        assert!(m.contains("$.spec.organization"), "falscher Typ: {m}");
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","organization":null}}"#);
        assert!(m.contains("null"), "{m}");
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","whiteInnerContour":false}}"#);
        assert!(m.contains("$.spec.whiteInnerContour"), "{m}");
        let m = meldung(
            r#"{"v":1,"spec":{"kind":"post","bodyMarks":["recovery"],"bodyMarkRenditions":{"recovery":"quer"}}}"#,
        );
        assert!(m.contains("$.spec.bodyMarkRenditions.recovery"), "{m}");
        let m = meldung(r#"{"v":1,"freestanding":{"kind":"weather","values":[]}}"#);
        assert!(m.contains("$.freestanding.values"), "Mindestlänge: {m}");
    }

    #[test]
    fn dublette_in_einer_liste_ist_400() {
        let m = meldung(
            r#"{"v":1,"spec":{"capabilities":["recovery","lighting","recovery"],"kind":"formation"}}"#,
        );
        assert!(m.contains("$.spec.capabilities[2]"), "{m}");
        assert!(m.contains("doppelt"), "{m}");
    }

    #[test]
    fn designation_ist_400_und_verweist_auf_label() {
        let m = meldung(r#"{"v":1,"spec":{"designation":"ELW 1","kind":"vehicle-land"}}"#);
        assert!(m.contains("$.spec.designation"), "{m}");
        assert!(m.contains("„label“"), "{m}");
    }

    #[test]
    fn labels_ist_400_und_verweist_auf_label() {
        let m = meldung(r#"{"v":1,"spec":{"kind":"post","labels":{"center":"Fam. Müller"}}}"#);
        assert!(m.contains("$.spec.labels"), "{m}");
        assert!(m.contains("„label“"), "{m}");
    }

    #[test]
    fn ueberlaenge_ist_400() {
        let lang = format!(
            r#"{{"v":1,"spec":{{"kind":"post"}}{}}}"#,
            " ".repeat(ZEICHEN_SPEC_MAX)
        );
        let m = meldung(&lang);
        assert_eq!(
            m,
            format!("zeichen_spec darf höchstens {ZEICHEN_SPEC_MAX} Zeichen lang sein")
        );
    }

    /// Die eingebundene Werteliste kennt jede Art der Bibliothek, die der Picker anbietet.
    #[test]
    fn werteliste_ist_lesbar_und_vollstaendig() {
        let w = werteliste();
        assert_eq!(w.format_version, 1);
        for art in [
            "animal-state",
            "line",
            "movement",
            "pictogram",
            "state",
            "weather",
        ] {
            assert!(w.freestanding.contains_key(art), "Art {art} fehlt");
        }
        assert!(w.spec.felder.contains_key("kind"));
    }
}
