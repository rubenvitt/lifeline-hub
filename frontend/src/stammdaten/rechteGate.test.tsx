import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import StichworteTab from './StichworteTab';
import FahrzeugeTab from './FahrzeugeTab';
import MaterialTab from './MaterialTab';
import StatusKatalogTab from './StatusKatalogTab';
import PersonalTab from './PersonalTab';
import QualifikationenTab from './QualifikationenTab';
import PersonalStatusTab from './PersonalStatusTab';
import EtbBausteineTab from './EtbBausteineTab';
import EinheitTypenTab from './EinheitTypenTab';
import OrganisationTab from './OrganisationTab';
import SprechgruppenTab from './SprechgruppenTab';

/**
 * Sektionsübergreifender Rechte-Hinweis (LFH-346 · A2, Befund M45).
 *
 * Zehn Tabs trugen dasselbe `istAdmin`-Gate und VERSTECKTEN damit Primäraktion und
 * Aktionsspalte; `OrganisationTab` hatte gar keins. Wer ohne Admin-Rolle auf eine dieser
 * Seiten kam, sah eine Tabelle ohne Handlungsmöglichkeit und keinen Grund dafür — vier
 * Ausprägungen von „nur lesen" gezählt, drei davon stumm.
 *
 * Der Test steht bewusst QUER zu den elf Dateien und nicht elfmal einzeln in ihnen: die
 * Aussage ist „KEINE Sektion fehlt", und die lässt sich nur an der vollständigen Menge
 * treffen. Ein zwölfter Tab ohne Hinweis fiele hier auf, in elf Einzeltests nicht.
 */
const nichtAdmin = {
  id: 2, anzeigename: 'Führungskraft', benutzername: 'fk', system_rolle: 'keiner',
  org_rolle: 'fuehrung', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const admin = { ...nichtAdmin, id: 1, anzeigename: 'Admin', system_rolle: 'admin' };

/**
 * Alle Abrufe der elf Tabs mit leeren Katalogen. `onUnhandledRequest: 'error'`
 * (test/setup.ts) macht eine fehlende Route zum Fehler statt zum stillen Leerlauf.
 * Leere Kataloge genügen: der Hinweis hängt am Recht, nicht an den Daten.
 */
function handler(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({ fahrzeugtyp: [], traegerorganisation: [], standort: [] }),
    ),
    http.get('/api/material', () => HttpResponse.json([])),
    http.get('/api/material-kategorien', () => HttpResponse.json([])),
    http.get('/api/personal', () => HttpResponse.json([])),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: [] })),
    http.get('/api/personal-status', () => HttpResponse.json([])),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json([])),
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    http.get('/api/sprechgruppen', () => HttpResponse.json([])),
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'Muster', tz_organisation: 'feuerwehr' }),
    ),
  );
}

/**
 * `aktion` ist der zugängliche Name der PRIMÄRAKTION der Sektion — bei sechs Sektionen der
 * Knopf im `aktionen`-Slot, bei fünf der Anlegen-Knopf ihrer `SchnellAnlegen`-Zeile, bei
 * `Organisation` der Speichern-Knopf ihres Formulars. Dass „Status anlegen" zweimal
 * vorkommt, ist unschädlich: je Durchlauf steht genau eine Sektion im Baum.
 */
const SEKTIONEN = [
  { name: 'Einsatz-Stichworte', Komp: StichworteTab, aktion: 'Hinzufügen' },
  { name: 'Fahrzeuge', Komp: FahrzeugeTab, aktion: 'Fahrzeug anlegen' },
  { name: 'Material', Komp: MaterialTab, aktion: 'Material anlegen' },
  { name: 'Fahrzeug-Status', Komp: StatusKatalogTab, aktion: 'Status anlegen' },
  { name: 'Personal', Komp: PersonalTab, aktion: 'Person anlegen' },
  { name: 'Qualifikationen', Komp: QualifikationenTab, aktion: 'Qualifikation anlegen' },
  { name: 'Personal-Status', Komp: PersonalStatusTab, aktion: 'Status anlegen' },
  { name: 'ETB-Schnellbausteine', Komp: EtbBausteineTab, aktion: 'Baustein anlegen' },
  { name: 'Einheitstypen', Komp: EinheitTypenTab, aktion: 'Typ anlegen' },
  { name: 'Organisation', Komp: OrganisationTab, aktion: 'Speichern' },
  { name: 'Sprechgruppen', Komp: SprechgruppenTab, aktion: 'Sprechgruppe anlegen' },
];

describe('Stammdaten — fehlende Berechtigung wird erklärt', () => {
  it('deckt alle elf Sektionen ab', () => {
    // Ohne diese Zahl wäre die Schleife darunter auch bei halber Menge grün.
    expect(SEKTIONEN).toHaveLength(11);
  });

  it.each(SEKTIONEN)('$name nennt ohne Admin-Recht den Grund', async ({ Komp }) => {
    handler(nichtAdmin);
    renderMitProviders(<Komp />);
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
  });

  /**
   * Die zweite Hälfte derselben Regel (LFH-346, Nacharbeit zu Befund M45) — und die, die
   * hier gefehlt hat: gepinnt war nur der HINWEISTEXT, nicht die BEHANDLUNG der
   * Primäraktion. Fünf der elf Sektionen versteckten sie deshalb weiter, ohne dass etwas
   * rot wurde, während CLAUDE.md „steht gesperrt" für alle elf behauptete. Ein zwölfter
   * Tab, der wieder versteckt, fällt jetzt hier auf: `getByRole` wirft, wenn der Knopf
   * fehlt, `toBeDisabled` schlägt fehl, wenn er offen steht.
   */
  it.each(SEKTIONEN)('$name zeigt die Primäraktion GESPERRT statt versteckt', async ({ Komp, aktion }) => {
    handler(nichtAdmin);
    renderMitProviders(<Komp />);
    // `findBy`, weil das Recht aus `auth/me` eine Runde nach dem ersten Anstrich eintrifft.
    await screen.findByText(STAMMDATEN_RECHTE_TEXT);
    // Symmetrisch zur Admin-Hälfte gewartet. Der Hinweis steht im `hinweis`-Slot, fünf der
    // elf Primäraktionen aber im INHALT — auf den Hinweis zu warten sichert für die also
    // strenggenommen nichts zu. `waitFor` maskiert dabei nichts: ein Knopf, der nie
    // gesperrt wird, läuft in die Zeitüberschreitung statt grün zu werden.
    await waitFor(() => expect(screen.getByRole('button', { name: aktion })).toBeDisabled());
  });

  /**
   * Die Gegenaussage. Ohne sie bliebe ein Hinweis, der IMMER steht, unentdeckt — und ein
   * Alert, der auch dem Admin erklärt, er dürfe nichts, wäre schlimmer als gar keiner.
   */
  it.each(SEKTIONEN)('$name zeigt dem Admin KEINEN Rechte-Hinweis', async ({ name, Komp, aktion }) => {
    handler(admin);
    renderMitProviders(<Komp />);
    // Erst auf den gerenderten Seitenkopf warten — ein `queryBy` vor dem ersten Anstrich
    // wäre trivial `null` und belegte nichts.
    expect(await screen.findByRole('heading', { level: 4, name })).toBeInTheDocument();
    expect(screen.queryByText(STAMMDATEN_RECHTE_TEXT)).not.toBeInTheDocument();
    // Die Gegenaussage zur Sperre. Ohne sie bliebe eine fest verdrahtete `disabled`-Angabe
    // unentdeckt: elf `toBeDisabled` wären dann grün, und die Seite unbedienbar.
    await waitFor(() => expect(screen.getByRole('button', { name: aktion })).toBeEnabled());
  });
});
