import { App, Button, Form, Input } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { loadAbschlussPruefung, schliesseEinsatzAb } from '../../api/einsaetze';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type {
  AbschlussEintrag,
  AbschlussGruppe,
  AbschlussKraft,
  AbschlussPruefung,
  EinsatzAnzeige,
  ModulFreigaben,
} from '../../api/types';
import { registrierNummer } from '../../anzeige/registrierNummer';
import { ErfassungsModal } from '../../components/Erfassung';
import { PANEEL_NEULADEN } from '../../components/instrument/PaneelZustand';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  ListenAbschnitt,
  PaneelZustand,
  listenZeileStil,
  monoStil,
  type PaneelDatenzustand,
  schriftStil,
  Stapel,
  Textstufe,
  useRollen,
} from '../../components/instrument';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { useModulFreigaben } from '../../einsatz/useSprungSperre';
import { WIEDEREROEFFNEN_STUNDEN } from '../../einsatz/schreibrecht';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { NICHT_FREIGEGEBEN } from '../lage-dashboard/fuehrungsZahlen';
import {
  auftraegePfad,
  kraefteuebersichtPfad,
  meldungenPfad,
  nachforderungenPfad,
  personenPfad,
} from '../../routing/deeplinks';

/**
 * Dialog „Einsatz abschließen“ (LLH-1814, Spec `einsatz-abschluss` und `bedien-wortlaut`,
 * design.md D2/D6). Ein `ErfassungsModal` statt `Popconfirm`: er trägt die offenen Punkte und ein
 * Eingabefeld.
 *
 * - **Kopf:** Bezeichnung und interne Einsatznummer in voller Länge (`Datenraster` bricht um,
 *   kürzt nie): im Kopf der Seite ist der Name oft abgeschnitten (LLH-1726).
 * - **Noch offen:** je Gruppe mit offenen Punkten Zahl, Kurzliste und „alle ↗“ ins Modul, der
 *   Sprung nur, wenn das Modul für die Person freigegeben ist (`istKeyFreigegeben`: unbekannt gibt
 *   nichts frei); die Zahl zählt der Server unabhängig von den Freigaben. Einträge eines
 *   gesperrten Moduls liefert er nicht: dann steht nur die Zahl mit „nicht freigegeben“ (D1).
 *   Laden, Fehler und „Nichts offen“ über `PaneelZustand`; ohne Netz und ohne Antwort sagt der
 *   Abschnitt das, statt „wird abgerufen“ zu behaupten (die Prüfung liegt nicht auf der Platte).
 *   Offene Punkte warnen nur, sie sperren nichts.
 * - **Zwei feste Sätze:** zu nicht entlassenen Kräften und zu Kopplungen und Maschinenzugängen.
 *   Beide stehen immer, auch solange die Prüfung lädt oder gescheitert ist: sie sind Pflichtsätze,
 *   kein Ergebnis der Prüfung (der Abschluss lässt Kräfte unverändert, Entscheidung 17.11.2026).
 * - **Bestätigung:** der rote Knopf ist gesperrt, bis Nummer oder Bezeichnung eingetippt sind
 *   ({@link matchesEinsatzkennung}). Geprüft wird nur hier; `POST …/abschliessen` bleibt ohne
 *   Bestätigung im Body (D2), ein Fehlgriff lässt sich binnen 24 Stunden zurücknehmen.
 * - **Ohne Netz gesperrt, nie vorgemerkt:** der Knopf fragt `useOhneVerbindung`, die Mutation
 *   läuft mit `networkMode: 'always'` ({@link SOFORT_ODER_NIE}). Sonst hielte TanStack sie an,
 *   der Dialog ließe sich nicht schließen, und der Abschluss ginge bei der Rückkehr des Netzes
 *   unbemerkt hinaus (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
 * - **Fehler** stehen im Dialog (`speicherung` der Hülle), kein Toast (LFH-1077).
 */

type EinsatzKopf = Pick<EinsatzAnzeige, 'id' | 'bezeichnung' | 'einsatznummer_intern'>;

/** Normalform des Vergleichs: Leerraum am Rand und Groß/Klein zählen nicht. */
function normalisiere(wert: string | null | undefined): string {
  return (wert ?? '').trim().toLocaleLowerCase('de');
}

/** Passt die Eingabe auf die interne Einsatznummer oder die Bezeichnung des Einsatzes? */
export function matchesEinsatzkennung(
  eingabe: string | null | undefined,
  einsatz: Pick<EinsatzAnzeige, 'bezeichnung' | 'einsatznummer_intern'>,
): boolean {
  const e = normalisiere(eingabe);
  if (e === '') return false;
  return (
    e === normalisiere(einsatz.einsatznummer_intern) || e === normalisiere(einsatz.bezeichnung)
  );
}

/**
 * Fester Satz zu nicht entlassenen Kräften (Spec `einsatz-abschluss`). Er steht immer, auch ohne
 * Antwort der Prüfung: eine Warnung, die von der Antwort abhinge, entfiele sonst ohne sie.
 */
export const KRAEFTE_SATZ =
  'Nicht entlassene Kräfte bleiben mit ihrem letzten Status in diesem Einsatz stehen und sind für andere Einsätze frei.';

/** Fester Satz zu Kopplungen und Maschinenzugängen (D5: sie bleiben nach dem Wiederöffnen beendet). */
export const KOPPLUNG_SATZ = `Gekoppelte Geräte und Maschinenzugänge werden getrennt und bleiben es, auch wenn der Einsatz binnen ${WIEDEREROEFFNEN_STUNDEN} Stunden wieder geöffnet wird.`;

/**
 * Einträge je Gruppe im Dialog. Der Server liefert bis zu fünf; drei halten den Dialog mit allen
 * Gruppen in der Höhe eines Führungsplatzes (1440 × 900), wie „Offene Vorgänge“ im Überblick. Die
 * Zahl zählt alle, „alle ↗“ führt zum Rest.
 */
const EINTRAEGE_JE_GRUPPE = 3;

/**
 * Abschluss und Wiederöffnen gehen sofort hinaus oder scheitern sofort, nie angehalten
 * (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“; Muster `instanz/FuehrungPaneel.tsx`).
 */
export const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/** Satz des Abschnitts „Noch offen“, wenn die Prüfung ohne Netz nicht geladen ist. */
export const PRUEFUNG_OHNE_NETZ = 'Ohne Netz nicht geladen';

/** Breiter als antds Vorgabe (520 px): die Zeilen der Kurzliste tragen Nummer, Text und Status. */
const DIALOG_BREITE = 640;

/** Eine Zeile, einzeilig gekürzt; ganz steht der Text im Titel (Hover) und im Modul. */
const EINZEILIG = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
} as const;

interface AbschlussWerte {
  bestaetigung?: string;
}

/** Ist im Ergebnis überhaupt etwas offen? */
function hasOffenePunkte(p: AbschlussPruefung): boolean {
  return (
    p.kraefte.anzahl > 0 ||
    p.auftraege.anzahl > 0 ||
    p.meldungen.anzahl > 0 ||
    p.nachforderungen.anzahl > 0 ||
    p.betroffene.anzahl > 0
  );
}

export default function EinsatzAbschlussDialog({
  einsatz,
  onSchliessen,
}: {
  einsatz: EinsatzKopf;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AbschlussWerte>();
  const bestaetigung = Form.useWatch('bestaetigung', form);
  const freigaben = useModulFreigaben(einsatz.id);
  const hatNummer = normalisiere(einsatz.einsatznummer_intern) !== '';
  const ohneNetz = useOhneVerbindung();

  const pruefung = useQuery({
    queryKey: einsatzKeys.abschlussPruefung(einsatz.id),
    queryFn: () => loadAbschlussPruefung(einsatz.id),
    // Jedes Öffnen fragt neu: der Dialog lebt nur, solange er offen ist.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const mutation = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: () => schliesseEinsatzAb(einsatz.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatz.id) });
      void qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success('Einsatz abgeschlossen');
    },
  });

  const offenId = useId();
  const daten = pruefung.data;
  const zustand: PaneelDatenzustand = daten
    ? hasOffenePunkte(daten)
      ? 'daten'
      : 'leer'
    : pruefung.isError
      ? 'fehler'
      : 'laden';
  // Ohne Netz und ohne Antwort bleibt die Abfrage angehalten (sie liegt bewusst nicht auf der
  // Platte): dann sagt der Abschnitt das, statt „wird abgerufen“ zu behaupten (wie
  // `betreuung/registrierung/RegistrierungPaneel.tsx`). Mit dem Netz lädt TanStack von selbst.
  const ohneNetzUngeladen =
    daten == null && pruefung.isPending && pruefung.fetchStatus === 'paused';

  return (
    <ErfassungsModal<AbschlussWerte>
      offen
      titel="Einsatz abschließen"
      breite={DIALOG_BREITE}
      form={form}
      initialValues={{ bestaetigung: '' }}
      erfassenText="Einsatz abschließen"
      unumkehrbar
      gesperrt={ohneNetz || !matchesEinsatzkennung(bestaetigung, einsatz)}
      zusammenfassung={ohneNetz ? OHNE_VERBINDUNG_NICHT_AENDERBAR : undefined}
      laeuft={mutation.isPending}
      speicherung={mutation}
      speicherFehlerTitel="Nicht abgeschlossen"
      speicherFehlerFallback="Abschließen fehlgeschlagen"
      onErfassen={async () => {
        await mutation.mutateAsync();
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <div data-lfh="abschluss-dialog">
        <Stapel abstand="sm">
          <Datenraster spalten={2} beschriftung="Einsatz">
            <Datenfeld label="Bezeichnung">{einsatz.bezeichnung}</Datenfeld>
            {hatNummer && (
              <Datenfeld label="Einsatznummer" mono>
                {einsatz.einsatznummer_intern}
              </Datenfeld>
            )}
          </Datenraster>

          <section aria-labelledby={offenId} data-lfh="abschluss-offen">
            <Augenbraue als="h3" id={offenId}>
              Noch offen
            </Augenbraue>
            {ohneNetzUngeladen ? (
              <div
                data-lfh="abschluss-offen-offline"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: token.marginSM,
                  padding: token.padding,
                }}
              >
                <Textstufe stufe="meta" ton="gedaempft">
                  {PRUEFUNG_OHNE_NETZ}
                </Textstufe>
                <Button onClick={() => void pruefung.refetch()}>{PANEEL_NEULADEN}</Button>
              </div>
            ) : (
              <PaneelZustand
                zustand={zustand}
                titel="Noch offen"
                leerText="Nichts offen"
                onNeuladen={() => void pruefung.refetch()}
              >
                {daten && (
                  <OffenePunkte einsatzId={einsatz.id} pruefung={daten} freigaben={freigaben} />
                )}
              </PaneelZustand>
            )}
          </section>

          {/* Beide Sätze in einem Absatz: der Dialog bleibt mit allen Gruppen in der Höhe eines
            Führungsplatzes (1440 × 900). */}
          <Textstufe als="p">
            <span data-lfh="abschluss-kraefte-satz">{KRAEFTE_SATZ}</span>{' '}
            <span data-lfh="abschluss-kopplung-satz">{KOPPLUNG_SATZ}</span>
          </Textstufe>

          {/* Letztes Feld des Dialogs: ohne Feldabstand darunter. `Feld` kennt das noch nicht
              (Folgeaufgabe zu LLH-1971), deshalb hier noch `Form.Item`. */}
          <Form.Item
            label={
              hatNummer
                ? 'Zur Bestätigung Einsatznummer oder Bezeichnung eintippen'
                : 'Zur Bestätigung Bezeichnung eintippen'
            }
            name="bestaetigung"
            style={{ marginBottom: 0 }}
          >
            <Input autoComplete="off" spellCheck={false} />
          </Form.Item>
        </Stapel>
      </div>
    </ErfassungsModal>
  );
}

/** Die Gruppen mit offenen Punkten, in fester Folge. */
function OffenePunkte({
  einsatzId,
  pruefung,
  freigaben,
}: {
  einsatzId: number;
  pruefung: AbschlussPruefung;
  freigaben: ModulFreigaben | undefined;
}) {
  const { token, rollen } = useRollen();
  const zeilenStil = listenZeileStil(rollen, token);
  const sprung = (modul: string, ziel: string, name: string) =>
    istKeyFreigegeben(modul, freigaben) ? { ziel, name } : undefined;
  const meta = { ...schriftStil('meta'), color: rollen.gedaempft } as const;
  const nummerStil = { ...monoStil(12), color: rollen.gedaempft, flex: '0 0 auto' } as const;

  const eintragZeile = (kennung: (nr: number) => string) => (e: AbschlussEintrag) => (
    <div style={zeilenStil}>
      {e.nummer != null && <span style={nummerStil}>{kennung(e.nummer)}</span>}
      <span style={EINZEILIG} title={e.bezeichnung}>
        {e.bezeichnung}
      </span>
    </div>
  );
  const lfdNr = (nr: number) => `#${nr}`;

  const gruppe = (p: {
    titel: string;
    kennung: string;
    gruppe: AbschlussGruppe;
    nummer: (nr: number) => string;
    sprung: { ziel: string; name: string } | undefined;
  }): ReactNode =>
    p.gruppe.anzahl > 0 && (
      <ListenAbschnitt<AbschlussEintrag>
        titel={p.titel}
        kennung={p.kennung}
        ueberschrift="h4"
        zahl={p.gruppe.anzahl}
        zustand="daten"
        eintraege={p.gruppe.eintraege}
        max={EINTRAEGE_JE_GRUPPE}
        schluessel={(e) => e.id}
        zeile={eintragZeile(p.nummer)}
        sprung={p.sprung}
        // Zahl über null und keine Einträge: der Server nennt sie nur aus Modulen, die die Person
        // lesen darf (D1). Dann steht die Zahl mit dem Grund, nicht „keine“.
        leerText={NICHT_FREIGEGEBEN}
        gesperrtText=""
        onNeuladen={() => {}}
      />
    );

  const { kraefte } = pruefung;
  // Einheiten oder Fahrzeuge sind offen, aber nicht genannt: ihre Module sind gesperrt (D1).
  const einheitenVerdeckt = kraefte.eintraege.length === 0 && kraefte.anzahl > kraefte.personal;
  return (
    <div data-lfh="abschluss-gruppen">
      {kraefte.anzahl > 0 && (
        <ListenAbschnitt<AbschlussKraft>
          titel="Kräfte"
          kennung="abschluss-kraefte"
          ueberschrift="h4"
          zahl={kraefte.anzahl}
          notiz={
            kraefte.personal > 0 && (kraefte.eintraege.length > 0 || einheitenVerdeckt)
              ? `davon ${kraefte.personal} Einsatzkräfte`
              : undefined
          }
          zustand="daten"
          eintraege={kraefte.eintraege}
          max={EINTRAEGE_JE_GRUPPE}
          schluessel={(k) => `${k.art}-${k.id}`}
          zeile={(k) => (
            <div style={zeilenStil}>
              <span style={EINZEILIG} title={k.bezeichnung}>
                {k.bezeichnung}
              </span>
              {k.status && <span style={{ ...meta, flex: '0 1 auto' }}>{k.status}</span>}
            </div>
          )}
          sprung={sprung('kraefteuebersicht', kraefteuebersichtPfad(einsatzId), 'Kräfte')}
          leerText={einheitenVerdeckt ? NICHT_FREIGEGEBEN : `${kraefte.personal} Einsatzkräfte`}
          gesperrtText=""
          onNeuladen={() => {}}
        />
      )}
      {gruppe({
        titel: 'Aufträge',
        kennung: 'abschluss-auftraege',
        gruppe: pruefung.auftraege,
        nummer: lfdNr,
        sprung: sprung('auftraege', auftraegePfad(einsatzId), 'Aufträge'),
      })}
      {gruppe({
        titel: 'Meldungen',
        kennung: 'abschluss-meldungen',
        gruppe: pruefung.meldungen,
        nummer: lfdNr,
        sprung: sprung('meldungen', meldungenPfad(einsatzId), 'Meldungen'),
      })}
      {gruppe({
        titel: 'Nachforderungen',
        kennung: 'abschluss-nachforderungen',
        gruppe: pruefung.nachforderungen,
        nummer: lfdNr,
        sprung: sprung('nachforderungen', nachforderungenPfad(einsatzId), 'Nachforderungen'),
      })}
      {gruppe({
        titel: 'Betroffene',
        kennung: 'abschluss-betroffene',
        gruppe: pruefung.betroffene,
        nummer: (nr) => registrierNummer('R', nr),
        sprung: sprung('personen', personenPfad(einsatzId), 'Betroffenen'),
      })}
    </div>
  );
}
