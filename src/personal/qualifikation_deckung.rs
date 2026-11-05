//! Deckungsregel für Qualifikationen (LLH-1553, Change `z14dre9r-qualifikationsstufen-soll`,
//! design.md D5; Spec `qualifikationen`, „Deckungsregel“). Rein, ohne Datenbank.
//!
//! Eine Qualifikation schließt höchstens eine andere direkt ein (`schliesst_ein_id`), und das gilt
//! transitiv: Notfallsanitäter → Rettungssanitäter → Sanitäter. Eine Person deckt eine geforderte
//! Qualifikation, wenn sie sie selbst hat oder eine, die sie einschließt.
//!
//! [`offene_anforderungen`] macht aus jeder geforderten Person einen Platz. Eine Person deckt
//! höchstens einen Platz, und die Zuteilung ist maximal (Kuhn): Eine vielseitige Person verbaut
//! keine Stelle, die nur sie decken könnte. Die strengsten Plätze (längste Kette darunter) kommen
//! zuerst; bei einer Lücke bleibt so die niedrigere Anforderung offen.
//!
//! **Gleichlauf:** `frontend/src/kraefte/qualiDeckung.ts` rechnet dieselbe Regel. Beide Seiten
//! lesen die Fälle aus `tests/fixtures/quali_deckung_faelle.json`.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

/// Der Katalog für die Regel: Qualifikation → die direkt eingeschlossene.
pub type Einschluesse = HashMap<i64, Option<i64>>;

/// Eine Anforderung: so viele Personen mit dieser Qualifikation (oder einer höheren).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Anforderung {
    pub qualifikation_id: i64,
    pub anzahl: i64,
}

/// Was von einer Anforderung offen bleibt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OffeneAnforderung {
    pub qualifikation_id: i64,
    pub fehlen: i64,
}

/// Die Qualifikation selbst und alle, die sie transitiv einschließt. Ein Kreis (den der Server
/// beim Schreiben ablehnt) bricht still ab, statt endlos zu laufen.
pub fn abschluss(katalog: &Einschluesse, qualifikation_id: i64) -> Vec<i64> {
    let mut kette = vec![qualifikation_id];
    let mut gesehen = HashSet::from([qualifikation_id]);
    let mut aktuell = qualifikation_id;
    while let Some(Some(naechste)) = katalog.get(&aktuell) {
        if !gesehen.insert(*naechste) {
            break;
        }
        kette.push(*naechste);
        aktuell = *naechste;
    }
    kette
}

/// Länge der Kette unter einer Qualifikation (Sanitäter 0, Rettungssanitäter 1, …).
fn strenge(katalog: &Einschluesse, qualifikation_id: i64) -> usize {
    abschluss(katalog, qualifikation_id).len() - 1
}

/// Alles, was eine Person mit diesen Qualifikationen deckt.
fn gedeckt(katalog: &Einschluesse, person: &[i64]) -> HashSet<i64> {
    person.iter().flat_map(|q| abschluss(katalog, *q)).collect()
}

/// Ob eine Person mit diesen Qualifikationen die geforderte deckt.
pub fn deckt(katalog: &Einschluesse, person: &[i64], gefordert: i64) -> bool {
    person
        .iter()
        .any(|q| abschluss(katalog, *q).contains(&gefordert))
}

/// Welche Anforderungen die Personen offen lassen, in der Reihenfolge des Solls. Anforderungen
/// ohne Lücke fehlen in der Antwort; ohne Lücke ist sie leer.
pub fn offene_anforderungen(
    katalog: &Einschluesse,
    soll: &[Anforderung],
    personen: &[Vec<i64>],
) -> Vec<OffeneAnforderung> {
    // Ein Platz je geforderter Person, mit dem Index seiner Anforderung.
    let mut plaetze: Vec<(usize, i64)> = soll
        .iter()
        .enumerate()
        .flat_map(|(i, a)| (0..a.anzahl.max(0)).map(move |_| (i, a.qualifikation_id)))
        .collect();
    // Strengste zuerst; bei gleicher Strenge die Reihenfolge des Solls (stabil).
    plaetze.sort_by_key(|(_, q)| std::cmp::Reverse(strenge(katalog, *q)));

    let deckung: Vec<HashSet<i64>> = personen.iter().map(|p| gedeckt(katalog, p)).collect();
    // Person → Platz, den sie gerade deckt.
    let mut person_auf: Vec<Option<usize>> = vec![None; personen.len()];
    let mut offen_je: Vec<i64> = vec![0; soll.len()];

    for platz in 0..plaetze.len() {
        let mut besucht = vec![false; personen.len()];
        if !erweitere(platz, &plaetze, &deckung, &mut person_auf, &mut besucht) {
            offen_je[plaetze[platz].0] += 1;
        }
    }

    soll.iter()
        .zip(offen_je)
        .filter(|(_, fehlen)| *fehlen > 0)
        .map(|(a, fehlen)| OffeneAnforderung {
            qualifikation_id: a.qualifikation_id,
            fehlen,
        })
        .collect()
}

/// Kuhn: sucht für `platz` eine Person, notfalls über einen Umweg, bei dem eine schon
/// zugeteilte Person auf einen anderen Platz wechselt. Ein einmal gedeckter Platz bleibt gedeckt.
fn erweitere(
    platz: usize,
    plaetze: &[(usize, i64)],
    deckung: &[HashSet<i64>],
    person_auf: &mut [Option<usize>],
    besucht: &mut [bool],
) -> bool {
    let gefordert = plaetze[platz].1;
    for person in 0..deckung.len() {
        if besucht[person] || !deckung[person].contains(&gefordert) {
            continue;
        }
        besucht[person] = true;
        let frei = match person_auf[person] {
            None => true,
            Some(anderer) => erweitere(anderer, plaetze, deckung, person_auf, besucht),
        };
        if frei {
            person_auf[person] = Some(platz);
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Datei {
        katalog: Vec<Eintrag>,
        faelle: Vec<Fall>,
    }

    #[derive(Deserialize)]
    struct Eintrag {
        id: i64,
        schliesst_ein_id: Option<i64>,
    }

    #[derive(Deserialize)]
    struct Fall {
        name: String,
        soll: Vec<Anforderung>,
        personen: Vec<Vec<i64>>,
        offen: Vec<OffeneAnforderung>,
    }

    fn datei() -> Datei {
        serde_json::from_str(include_str!(
            "../../tests/fixtures/quali_deckung_faelle.json"
        ))
        .expect("Fall-Datei lesbar")
    }

    fn katalog(d: &Datei) -> Einschluesse {
        d.katalog
            .iter()
            .map(|e| (e.id, e.schliesst_ein_id))
            .collect()
    }

    /// Die gemeinsamen Fälle (Gleichlauf mit `qualiDeckung.test.ts`).
    #[test]
    fn gemeinsame_faelle() {
        let d = datei();
        let k = katalog(&d);
        assert!(d.faelle.len() >= 10, "Fall-Datei vollständig");
        for fall in &d.faelle {
            assert_eq!(
                offene_anforderungen(&k, &fall.soll, &fall.personen),
                fall.offen,
                "{}",
                fall.name
            );
        }
    }

    #[test]
    fn abschluss_folgt_der_kette() {
        let k = katalog(&datei());
        assert_eq!(abschluss(&k, 3), vec![3, 2, 1]);
        assert_eq!(abschluss(&k, 4), vec![4]);
        assert_eq!(abschluss(&k, 99), vec![99], "unbekannt: nur sie selbst");
    }

    #[test]
    fn deckt_ueber_einschluss_nicht_umgekehrt() {
        let k = katalog(&datei());
        assert!(deckt(&k, &[2], 1), "Rettungssanitäterin deckt Sanitäter");
        assert!(!deckt(&k, &[1], 2));
        assert!(!deckt(&k, &[4], 1), "Notarzt schließt nichts ein");
        assert!(!deckt(&k, &[], 1));
    }

    #[test]
    fn kreis_bricht_ab() {
        let k: Einschluesse = HashMap::from([(1, Some(2)), (2, Some(1))]);
        assert_eq!(abschluss(&k, 1), vec![1, 2]);
        assert!(offene_anforderungen(
            &k,
            &[Anforderung {
                qualifikation_id: 2,
                anzahl: 1
            }],
            &[vec![1]]
        )
        .is_empty());
    }
}
