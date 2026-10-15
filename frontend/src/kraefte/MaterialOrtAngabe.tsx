import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ladeModulFreigaben } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeBr } from '../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import {
  bereitstellungsraumDetailPfad,
  einheitDetailPfad,
  fahrzeugePfad,
  uhsDetailPfad,
} from '../routing/deeplinks';
import { buildEinheitOptions } from './kraeftebaumKern';
import { buildOrtOptions, isOrtLesbar, type OrtWahlQuellen } from './materialOrtWahl';
import {
  ortText,
  ortVon,
  parseOrtValue,
  toOrtValue,
  ZUGEORDNET,
  type MaterialOrtRef,
  type OrtNamen,
} from './materialPosten';

/**
 * Der EINE Ort eines Materialpostens als Angabe der Materialliste (LLH-1225, design.md D3; ersetzt
 * die zwei Teile aus LLH-1093): eine `InlineAngabe` mit einer Auswahl über alle Ortsarten
 * ({@link buildOrtOptions}), ausdrückliches Speichern, die Ablehnung an der Angabe. Geschrieben
 * wird über den einen Weg {@link useMaterialOrt} (der Aufrufer reicht ihn als `onSpeichern`), mit
 * dem Recht Material: der Ort gehört dem Material (LLH-1224 D9), auch wer das Modul Einheiten
 * nicht bedienen darf, setzt eine Einheit als Ort.
 *
 * NAMEN LÖST DER CLIENT AUF (1093 D2) aus den Listen der Module. Ohne Leserecht auf ein Modul
 * (Freigabe `zugriff: false`, Abruf gescheitert) steht „zugeordnet“, nie „—“, und die Auswahl
 * bietet die Ortsart nicht an. Ohne Schreibrecht führt der Name als `KennungsLink` in sein Modul.
 */

/** Was die Seite einmal lädt und jede Zeile teilt. */
export interface MaterialOrtKontext {
  einsatzId: number;
  /** Namen je lesbarer Ortsart; eine fehlende Funktion heißt „ohne Leserecht“. */
  namen: OrtNamen;
  /** Angebot der Auswahl (auch für die Disponier-Dialoge, D7). */
  quellen: OrtWahlQuellen;
}

/** Der Ort als Text für Sortierung und Suche: Name, „zugeordnet“ oder „ohne Ort“. */
export function ortSuchText(em: Parameters<typeof ortVon>[0], k: MaterialOrtKontext): string {
  return ortText(ortVon(em), k.namen);
}

/**
 * Lädt, was Angabe, Filter und Gruppierung brauchen, unter denselben Schlüsseln wie die Seiten der
 * Module (live über deren Ereignisse) und nur mit Lesezugriff auf das Modul: eine gesperrte Ortsart
 * erzeugt keinen Abruf. Deshalb wartet jeder Abruf, bis die Freigaben feststehen (geladen oder
 * gescheitert); eine fehlende oder gescheiterte Freigabe heißt offen, der Server prüft selbst.
 * Fahrzeuge und Bereitstellungsräume lädt die Seite, wenn sie schreiben darf (Auswahl) oder ein
 * Posten dort liegt (Name). Die Abschnitte ordnen die Einheiten wie den Kräftebaum (D3/D4, wie
 * `FahrzeugePage.tsx`); ohne Freigabe auf Einheiten oder Abschnitte bleibt die Anlagefolge.
 */
export function useMaterialOrtKontext(
  einsatzId: number,
  darfSchreiben: boolean,
  posten: readonly Pick<EinsatzMaterial, 'einsatz_fahrzeug_id' | 'br_id'>[] = [],
): { kontext: MaterialOrtKontext; einheitFolge: OrtWahlQuellen['einheiten'] } {
  // Derselbe Schlüssel wie `useModulFreigaben`; der Abruf hier liefert zusätzlich, ob sie feststehen.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  const fest = freigabenQuery.isSuccess || freigabenQuery.isError;
  const lesbar = {
    einheit: fest && isOrtLesbar('einheit', freigaben),
    fahrzeug: fest && isOrtLesbar('fahrzeug', freigaben),
    uhs: fest && isOrtLesbar('uhs', freigaben),
    bereitstellungsraum: fest && isOrtLesbar('bereitstellungsraum', freigaben),
  };
  const abschnitteLesbar = lesbar.einheit && freigaben?.einsatzabschnitte?.zugriff !== false;
  const brauchtFahrzeuge = darfSchreiben || posten.some((p) => p.einsatz_fahrzeug_id != null);
  const brauchtBr = darfSchreiben || posten.some((p) => p.br_id != null);
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: lesbar.einheit,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: abschnitteLesbar,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: lesbar.uhs,
  });
  const fahrzeugQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: lesbar.fahrzeug && brauchtFahrzeuge,
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
    enabled: lesbar.bereitstellungsraum && brauchtBr,
  });
  const einheiten = einheitenQuery.data;
  const abschnitte = abschnitteQuery.data;
  const einheitOptionen = useMemo(
    () => (einheiten ? buildEinheitOptions(einheiten, abschnitte ?? []) : undefined),
    [einheiten, abschnitte],
  );
  const uhs = uhsQuery.data;
  const fahrzeuge = fahrzeugQuery.data;
  const br = brQuery.data;
  const kontext = useMemo((): MaterialOrtKontext => {
    const nachId = <T extends { id: number }>(
      liste: readonly T[] | undefined,
      name: (t: T) => string,
    ) => {
      const m = new Map((liste ?? []).map((t) => [t.id, name(t)] as const));
      return (id: number) => m.get(id);
    };
    return {
      einsatzId,
      namen: {
        ...(lesbar.einheit && !einheitenQuery.isError
          ? { einheit: nachId(einheiten, (e) => e.name) }
          : {}),
        ...(lesbar.fahrzeug && !fahrzeugQuery.isError
          ? { fahrzeug: nachId(fahrzeuge, (f) => f.funkrufname) }
          : {}),
        ...(lesbar.uhs && !uhsQuery.isError ? { uhs: nachId(uhs, (u) => u.bezeichnung) } : {}),
        ...(lesbar.bereitstellungsraum && !brQuery.isError
          ? { bereitstellungsraum: nachId(br, (b) => b.bezeichnung) }
          : {}),
      },
      quellen: { einheiten: einheitOptionen, fahrzeuge, uhs, br, freigaben },
    };
    // Die Lesbarkeit hängt nur an `freigaben`, die Fehler an den Abfragen.
  }, [
    einsatzId,
    einheiten,
    einheitOptionen,
    fahrzeuge,
    uhs,
    br,
    freigaben,
    lesbar.einheit,
    lesbar.fahrzeug,
    lesbar.uhs,
    lesbar.bereitstellungsraum,
    einheitenQuery.isError,
    fahrzeugQuery.isError,
    uhsQuery.isError,
    brQuery.isError,
  ]);
  return { kontext, einheitFolge: einheitOptionen };
}

/** Boden der Ortsangabe in px: ein Wort wie „Musterstadt“ steht in jeder Dichte in einer Zeile. */
const ORT_MINDESTBREITE = 150;

/** Wortgrenzen statt `anywhere` (Entscheidung 14.10.2026, LLH-1073); `hyphens` braucht `lang`. */
const NAME_STIL = { overflowWrap: 'break-word', hyphens: 'auto' } as const;

/** Sprung in das Modul des Orts (Lesezweig). */
function ortPfad(einsatzId: number, ort: MaterialOrtRef): string {
  switch (ort.art) {
    case 'einheit':
      return einheitDetailPfad(einsatzId, ort.id);
    case 'fahrzeug':
      return fahrzeugePfad(einsatzId, { fahrzeug: ort.id });
    case 'uhs':
      return uhsDetailPfad(einsatzId, ort.id);
    case 'bereitstellungsraum':
      return bereitstellungsraumDetailPfad(einsatzId, ort.id);
  }
}

export interface MaterialOrtAngabeProps {
  /** Zeilenkennung für die zugänglichen Namen („Ort zu Wolldecke“). */
  kennung: string;
  /** Der eine Ort des Postens ({@link ortVon}); `null` heißt „ohne Ort“. */
  ort: MaterialOrtRef | null;
  kontext: MaterialOrtKontext;
  darfSchreiben: boolean;
  /** Ort setzen, wechseln oder lösen (`useMaterialOrt().setOrt`); lehnt bei Ablehnung ab. */
  onSpeichern: (ziel: MaterialOrtRef | null) => Promise<unknown>;
}

export default function MaterialOrtAngabe({
  kennung,
  ort,
  kontext: k,
  darfSchreiben,
  onSpeichern,
}: MaterialOrtAngabeProps) {
  const text = ortText(ort, k.namen);
  const name = (
    <span style={NAME_STIL} lang="de">
      {text}
    </span>
  );
  const wert = toOrtValue(ort);
  const optionen = useMemo(
    () => (darfSchreiben ? buildOrtOptions(k.quellen, { ort, text }) : []),
    [darfSchreiben, k.quellen, ort, text],
  );
  return (
    <span
      data-testid="material-ort"
      style={{ display: 'inline-block', minWidth: ORT_MINDESTBREITE }}
    >
      {darfSchreiben ? (
        <InlineAngabe<string>
          etikett="Ort"
          kennung={kennung}
          wert={wert}
          anzeige={name}
          leer={() => false}
          darfSchreiben
          onSpeichern={(neu) => {
            const ziel = parseOrtValue(neu);
            return ziel === undefined ? Promise.resolve() : onSpeichern(ziel);
          }}
          eingabe={({ feld, value, onChange, popup }) => (
            <Select<string>
              {...feld}
              {...popup}
              value={value}
              onChange={(v) => onChange(v)}
              options={optionen}
              popupMatchSelectWidth={false}
              style={{ width: '100%', minWidth: 0 }}
            />
          )}
        />
      ) : ort == null || text === ZUGEORDNET ? (
        text
      ) : (
        <KennungsLink to={ortPfad(k.einsatzId, ort)}>{name}</KennungsLink>
      )}
    </span>
  );
}
