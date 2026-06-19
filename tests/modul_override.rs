//! Integrationstests für die Modul-Sichtbarkeit & Berechtigungen pro Einsatz (LFH-132).

use lifeline_hub::einsatz::modul::MODUL_KEYS;
use std::collections::BTreeSet;

/// Source-of-Truth-Drift-Wächter: Die Backend-`MODUL_KEYS` müssen exakt mit den
/// `key`-Werten der Frontend-`modulRegistry.ts` übereinstimmen. Driftet eine Seite
/// (Modul hinzugefügt/entfernt/umbenannt, ohne die andere nachzuziehen), schlägt
/// dieser Test fehl — der Guard würde sonst auf einen unbekannten Key laufen oder
/// ein neues Modul ungeschützt lassen.
#[test]
fn backend_modul_keys_decken_frontend_registry() {
    let quelle = std::fs::read_to_string("frontend/src/einsatz/modulRegistry.ts")
        .expect("frontend/src/einsatz/modulRegistry.ts muss lesbar sein");

    // Nur den `modulRegistry`-Array-Block betrachten (die `kategorien`-Liste davor
    // hat ebenfalls `key:`-Felder, gehört aber nicht dazu).
    let start = quelle
        .find("export const modulRegistry")
        .expect("modulRegistry-Deklaration nicht gefunden");
    let block_ende = quelle[start..]
        .find("\n];")
        .map(|rel| start + rel)
        .expect("Ende des modulRegistry-Arrays nicht gefunden");
    let block = &quelle[start..block_ende];

    // `key: 'xyz'` aus dem Block extrahieren.
    let mut fe_keys = BTreeSet::new();
    for stueck in block.split("key:").skip(1) {
        let nach_quote = stueck.find('\'').expect("key ohne öffnendes '");
        let rest = &stueck[nach_quote + 1..];
        let ende = rest.find('\'').expect("key ohne schließendes '");
        fe_keys.insert(rest[..ende].to_string());
    }

    let be_keys: BTreeSet<String> = MODUL_KEYS.iter().map(|s| s.to_string()).collect();

    assert_eq!(
        be_keys, fe_keys,
        "Backend-MODUL_KEYS und Frontend-modulRegistry-Keys müssen synchron sein.\n\
         Nur Backend: {:?}\nNur Frontend: {:?}",
        be_keys.difference(&fe_keys).collect::<Vec<_>>(),
        fe_keys.difference(&be_keys).collect::<Vec<_>>(),
    );
}
