/**
 * `showSearch` für ein `AutoComplete` mit Freitext-Vorschlägen: ein Vorschlag bleibt stehen,
 * wenn sein Wert oder seine Beschriftung die Eingabe irgendwo enthält, ohne
 * Groß-/Kleinschreibung. Die Beschriftung zählt mit, seit Vorschläge ein anderes Label tragen
 * als ihr Wert („S2 – Lage (Müller)“ setzt „S2“ ein, LFH-549).
 */
export const teilwortSuche = {
  filterOption: (eingabe: string, option?: { value?: unknown; label?: unknown }) => {
    const e = eingabe.toLowerCase();
    return (
      String(option?.value ?? '')
        .toLowerCase()
        .includes(e) ||
      (typeof option?.label === 'string' && option.label.toLowerCase().includes(e))
    );
  },
};
