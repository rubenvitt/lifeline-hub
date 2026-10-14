import { useQuery } from '@tanstack/react-query';
import { theme } from 'antd';
import { Fragment, type ReactNode } from 'react';
import { listeBr } from '../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial, Uhs } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import { einheitDetailPfad, uhsDetailPfad } from '../routing/deeplinks';
import EinheitAngabe from './EinheitAngabe';
import { buildEinheitOptions, type EinheitOption } from './kraeftebaumKern';
import {
  OHNE_ORT,
  ortText,
  ortVon,
  uhsName,
  ZUGEORDNET,
  type MaterialOrtArt,
  type MaterialOrtRef,
  type OrtNamen,
} from './materialPosten';

/**
 * Der Ort eines Material-Postens in der Materialliste (LLH-1093, design.md D1–D3, D13; LLH-1224
 * D6/D16).
 *
 * EIN ORT JE POSTEN (LLH-1224): Einheit, Fahrzeug, UHS, Bereitstellungsraum oder „ohne Ort“; der
 * Server löst den bisherigen Ort, wenn ein neuer gesetzt wird. Bis LLH-1225 den Ort-Editor bringt,
 * bleiben die zwei Teile aus LLH-1093: die Einheit (Zuordnungsweg der Einheiten, mit deren Recht)
 * und die UHS (Material-PATCH), je mit ausdrücklichem Speichern. Setzt man den einen, wird der
 * andere leer. Fahrzeug und Bereitstellungsraum setzt vorerst nur die API; die Spalte nennt sie dann
 * mit Namen. Den Ort aus der Zeile liest nur {@link ortVon} (`materialPosten.ts`).
 *
 * NAMEN LÖST DER CLIENT AUF (D2) aus den Listen der Module. Ohne Leserecht auf ein Modul (Freigabe
 * `zugriff: false`, Abruf gescheitert) steht „zugeordnet“, nie „—“: der Strich behauptete „kein
 * Ort“. Bedienbar ist ein Teil nur mit Schreibrecht im Einsatz UND Zugriff auf sein Modul; der
 * Server bleibt die Prüfung, eine Ablehnung steht am Teil (`InlineAngabe`).
 */

/** Was die Seite einmal lädt und jede Zeile teilt. */
export interface MaterialOrtKontext {
  einsatzId: number;
  einheit: {
    /** Namen sind lesbar (Freigabe und Abruf). */
    lesbar: boolean;
    /** Schreibrecht im Einsatz, Zugriff auf das Modul Einheiten und die Liste liegt vor. */
    bedienbar: boolean;
    /** Aktive Einheiten in Baumfolge (Auswahl). */
    optionen: readonly EinheitOption[];
    /** Name einer Einheit, auch einer aufgelösten; `undefined`, solange unbekannt. */
    name: (id: number) => string | undefined;
  };
  uhs: {
    lesbar: boolean;
    bedienbar: boolean;
    liste: readonly Uhs[];
  };
  /** Nur lesend (LLH-1224, bis LLH-1225): Funkrufname eines Einsatzfahrzeugs. */
  fahrzeug?: { lesbar: boolean; name: (id: number) => string | undefined };
  /** Nur lesend (LLH-1224, bis LLH-1225): Bezeichnung eines Bereitstellungsraums. */
  bereitstellungsraum?: { lesbar: boolean; name: (id: number) => string | undefined };
}

/** Die Namen je Ortsart für {@link ortText}; ohne Leserecht fehlt die Funktion („zugeordnet“). */
export function ortNamen(k: MaterialOrtKontext): OrtNamen {
  return {
    ...(k.einheit.lesbar ? { einheit: k.einheit.name } : {}),
    ...(k.uhs.lesbar
      ? { uhs: (id: number) => k.uhs.liste.find((u) => u.id === id)?.bezeichnung }
      : {}),
    ...(k.fahrzeug?.lesbar ? { fahrzeug: k.fahrzeug.name } : {}),
    ...(k.bereitstellungsraum?.lesbar ? { bereitstellungsraum: k.bereitstellungsraum.name } : {}),
  };
}

/** Der Ort als Text für Sortierung und Suche: Name, „zugeordnet“ oder „ohne Ort“. */
export function ortSuchText(em: Parameters<typeof ortVon>[0], k: MaterialOrtKontext): string {
  return ortText(ortVon(em), ortNamen(k));
}

const OHNE_WERT = 'ohne';

/** Boden der Ortsangabe in px: ein Wort wie „Musterstadt“ steht in jeder Dichte in einer Zeile. */
const ORT_MINDESTBREITE = 150;

const ART_WORT: Record<MaterialOrtArt, string> = {
  einheit: 'Einheit',
  fahrzeug: 'Fahrzeug',
  uhs: 'UHS',
  bereitstellungsraum: 'Bereitstellungsraum',
};

/** Folge der Ortsarten im Filter. */
const ART_FOLGE: readonly MaterialOrtArt[] = ['einheit', 'fahrzeug', 'uhs', 'bereitstellungsraum'];

/**
 * Filter der Spalte „Ort“ (D13, LLH-1224): „ohne Ort“, je Einheit, je Fahrzeug, je UHS, je
 * Bereitstellungsraum der aktuellen Liste. Ein Posten trifft genau einen Wert. Ohne Leserecht fasst
 * ein Wert „Einheit zugeordnet“ usw. alle seiner Art zusammen.
 */
export function ortFilter(posten: readonly Parameters<typeof ortVon>[0][], k: MaterialOrtKontext) {
  const namen = ortNamen(k);
  const wertVon = (ort: MaterialOrtRef): { value: string; text: string } => {
    const text = ortText(ort, namen);
    return text === ZUGEORDNET
      ? { value: `${ort.art}:*`, text: `${ART_WORT[ort.art]} zugeordnet` }
      : { value: `${ort.art}:${ort.id}`, text };
  };
  const je = new Map<MaterialOrtArt, Map<string, string>>(ART_FOLGE.map((a) => [a, new Map()]));
  for (const p of posten) {
    const ort = ortVon(p);
    if (ort == null) continue;
    const w = wertVon(ort);
    je.get(ort.art)!.set(w.value, w.text);
  }
  const sortiert = (m: Map<string, string>) =>
    [...m].map(([value, text]) => ({ value, text })).sort((a, b) => a.text.localeCompare(b.text));
  return {
    werte: [
      { value: OHNE_WERT, text: OHNE_ORT },
      ...ART_FOLGE.flatMap((a) => sortiert(je.get(a)!)),
    ],
    trifft: (p: Parameters<typeof ortVon>[0], wert: string) => {
      const ort = ortVon(p);
      if (wert === OHNE_WERT) return ort == null;
      return ort != null && wertVon(ort).value === wert;
    },
  };
}

/**
 * Lädt, was die Ort-Teile brauchen: Einheiten und UHS unter denselben Schlüsseln wie ihre Seiten
 * (live über die Ereignisse `einheit` und `uhs`), nur bei Zugriff auf das Modul. Fahrzeuge und
 * Bereitstellungsräume nur, wenn ein Posten dort liegt (`posten`). Unbekannte Freigaben heißen
 * offen; ein gescheiterter Abruf macht den Teil unlesbar.
 */
export function useMaterialOrtKontext(
  einsatzId: number,
  darfSchreiben: boolean,
  posten: readonly Pick<EinsatzMaterial, 'einsatz_fahrzeug_id' | 'br_id'>[] = [],
) {
  const freigaben = useModulFreigaben(einsatzId);
  const einheitenZugriff = freigaben?.einheiten?.zugriff !== false;
  const uhsZugriff = freigaben?.unfallhilfsstellen?.zugriff !== false;
  const fahrzeugZugriff = freigaben?.fahrzeuge?.zugriff !== false;
  const brZugriff = freigaben?.bereitstellungsraeume?.zugriff !== false;
  const brauchtFahrzeuge = posten.some((p) => p.einsatz_fahrzeug_id != null);
  const brauchtBr = posten.some((p) => p.br_id != null);
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: einheitenZugriff,
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: uhsZugriff,
  });
  const fahrzeugQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: fahrzeugZugriff && brauchtFahrzeuge,
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
    enabled: brZugriff && brauchtBr,
  });
  const einheiten = einheitenQuery.data;
  const nachId = new Map((einheiten ?? []).map((e) => [e.id, e.name] as const));
  const fahrzeugNamen = new Map((fahrzeugQuery.data ?? []).map((f) => [f.id, f.funkrufname]));
  const brNamen = new Map((brQuery.data ?? []).map((b) => [b.id, b.bezeichnung]));
  const kontext: MaterialOrtKontext = {
    einsatzId,
    einheit: {
      lesbar: einheitenZugriff && !einheitenQuery.isError,
      bedienbar: darfSchreiben && einheitenZugriff && einheiten != null,
      optionen: einheiten ? buildEinheitOptions(einheiten, []) : [],
      name: (id) => nachId.get(id),
    },
    uhs: {
      lesbar: uhsZugriff && !uhsQuery.isError,
      bedienbar: darfSchreiben && uhsZugriff && uhsQuery.data != null,
      liste: uhsQuery.data ?? [],
    },
    fahrzeug: {
      lesbar: fahrzeugZugriff && !fahrzeugQuery.isError,
      name: (id) => fahrzeugNamen.get(id),
    },
    bereitstellungsraum: {
      lesbar: brZugriff && !brQuery.isError,
      name: (id) => brNamen.get(id),
    },
  };
  return { kontext };
}

export interface MaterialOrtProps {
  /** Zeilenkennung für die zugänglichen Namen („Einheit zu Wolldecke“). */
  kennung: string;
  /** Der eine Ort des Postens ({@link ortVon}); `null` heißt „ohne Ort“. */
  ort: MaterialOrtRef | null;
  kontext: MaterialOrtKontext;
  darfSchreiben: boolean;
  /** Einheit ändern: der Aufrufer ordnet `neu` zu bzw. gibt `alt` frei. */
  onEinheit: (neu: number | null, alt: number | null) => Promise<unknown>;
  /** UHS ändern (Material-PATCH `uhs_id`). */
  onUhs: (neu: number | null) => Promise<unknown>;
}

/** Auswahlwert für „keine UHS“; keine UHS hat eine negative ID. */
const KEINE_UHS = -1;

export default function MaterialOrt({
  kennung,
  ort,
  kontext: k,
  darfSchreiben,
  onEinheit,
  onUhs,
}: MaterialOrtProps) {
  const { token } = theme.useToken();
  const namen = ortNamen(k);
  const einheitId = ort?.art === 'einheit' ? ort.id : null;
  const uhsId = ort?.art === 'uhs' ? ort.id : null;
  const teile: { key: string; inhalt: ReactNode }[] = [];

  // Fahrzeug und Bereitstellungsraum: nur der Name, bis LLH-1225 den Ort-Editor bringt.
  if (ort?.art === 'fahrzeug' || ort?.art === 'bereitstellungsraum') {
    teile.push({ key: ort.art, inhalt: ortText(ort, namen) });
  }

  if (darfSchreiben && k.einheit.bedienbar) {
    teile.push({
      key: 'einheit',
      inhalt: (
        <EinheitAngabe
          kennung={kennung}
          wert={einheitId}
          optionen={k.einheit.optionen}
          darfSchreiben
          ohneOption="keine Einheit"
          onSpeichern={onEinheit}
        />
      ),
    });
  } else if (ort?.art === 'einheit') {
    const text = ortText(ort, namen);
    teile.push({
      key: 'einheit',
      inhalt:
        text === ZUGEORDNET ? (
          text
        ) : (
          <KennungsLink to={einheitDetailPfad(k.einsatzId, ort.id)}>{text}</KennungsLink>
        ),
    });
  }

  if (darfSchreiben && k.uhs.bedienbar) {
    const aktuell = uhsId != null ? k.uhs.liste.find((u) => u.id === uhsId) : undefined;
    const waehlbar = k.uhs.liste.filter(
      (u) => !u.storniert_at && (u.status === 'geplant' || u.status === 'aktiv'),
    );
    // Eine aufgelöste, stornierte oder nicht gelistete UHS ist nicht wählbar, steht aber noch am
    // Posten: als gesperrte Option vorn, damit die Auswahl ihren Namen zeigt statt der rohen ID.
    const aktuellGesperrt =
      uhsId != null && !waehlbar.some((u) => u.id === uhsId)
        ? [{ value: uhsId, label: aktuell ? uhsName(aktuell) : ZUGEORDNET, disabled: true }]
        : [];
    teile.push({
      key: 'uhs',
      inhalt: (
        <InlineAngabe<number | null>
          etikett="UHS"
          kennung={kennung}
          wert={uhsId}
          anzeige={aktuell ? uhsName(aktuell) : ZUGEORDNET}
          leer={(w) => w == null}
          darfSchreiben
          onSpeichern={(neu) => onUhs(neu)}
          eingabe={({ feld, value, onChange, popup }) => (
            <Select<number>
              {...feld}
              {...popup}
              value={value ?? KEINE_UHS}
              onChange={(v) => onChange(v == null || v === KEINE_UHS ? null : v)}
              options={[
                ...aktuellGesperrt,
                { value: KEINE_UHS, label: 'keine UHS' },
                ...waehlbar.map((u) => ({ value: u.id, label: uhsName(u) })),
              ]}
              popupMatchSelectWidth={false}
              style={{ width: '100%', minWidth: 0 }}
            />
          )}
        />
      ),
    });
  } else if (ort?.art === 'uhs') {
    const text = ortText(ort, namen);
    teile.push({
      key: 'uhs',
      inhalt:
        text === ZUGEORDNET ? (
          text
        ) : (
          <KennungsLink to={uhsDetailPfad(k.einsatzId, ort.id)}>{text}</KennungsLink>
        ),
    });
  }

  return (
    <span
      data-testid="material-ort"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        // Der Wertknopf von `InlineAngabe` ragt je Seite um `paddingSM` über seinen Text hinaus
        // (Text bündig mit der Spalte). Ohne Ausgleich überlappten die Knöpfe von Einheit und UHS
        // (gemessen −3,5 px kompakt, −13 px handschuh); so bleiben 10 / 15 / 19 px frei
        // (Prüfliste LLH-1093, Kriterien 1 und 2).
        columnGap: token.paddingSM + token.marginXS,
        rowGap: token.paddingSM,
        // Die Wertknöpfe brechen überall um (`overflowWrap: anywhere`); ohne Boden drückte die
        // Tabelle die Ortsspalte so schmal, dass „Musterstadt“ Silbe für Silbe stand.
        minWidth: ORT_MINDESTBREITE,
      }}
    >
      {teile.length === 0
        ? OHNE_ORT
        : teile.map((t, i) => (
            <Fragment key={t.key}>
              {i > 0 && <span aria-hidden>·</span>}
              {t.inhalt}
            </Fragment>
          ))}
    </span>
  );
}
