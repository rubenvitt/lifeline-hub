/**
 * `showSearch` für ein `AutoComplete` mit Freitext-Vorschlägen: ein Vorschlag bleibt stehen,
 * wenn sein Wert die Eingabe irgendwo enthält, ohne Groß-/Kleinschreibung.
 */
export const teilwortSuche = {
  filterOption: (eingabe: string, option?: { value?: unknown }) =>
    String(option?.value ?? '')
      .toLowerCase()
      .includes(eingabe.toLowerCase()),
};
