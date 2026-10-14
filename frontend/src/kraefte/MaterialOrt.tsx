import { useQuery } from '@tanstack/react-query';
import { theme } from 'antd';
import { Fragment, type ReactNode } from 'react';
import { listeEinheiten } from '../api/einheiten';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzMaterial, Uhs } from '../api/types';
import { InlineAngabe } from '../components/InlineAngabe';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import { useModulFreigaben } from '../einsatz/useSprungSperre';
import { einheitDetailPfad, uhsDetailPfad } from '../routing/deeplinks';
import EinheitAngabe from './EinheitAngabe';
import { buildEinheitOptions, type EinheitOption } from './einheitAngabeKern';

/**
 * Der Ort eines Material-Postens in der Materialliste (LLH-1093, design.md D1–D3, D13).
 *
 * DOPPELREGEL (Entscheidung 13.10.2026, Nr. 1): ein Posten gehört höchstens einer Einheit
 * (exklusiv, geändert über den Zuordnungsweg der Einheiten mit deren Recht) und unabhängig davon
 * höchstens einer UHS (geändert über den Material-PATCH). Die Spalte „Ort“ zeigt beides
 * („Rettungsstaffel · UHS Turnhalle“), jeder Teil ist eine eigene Angabe mit ausdrücklichem
 * Speichern. LLH-1225 tauscht diese Komponente gegen den Editor eines Standorts; der Adapter
 * {@link ortVon} ist die eine Stelle, die den Ort aus der Zeile liest.
 *
 * NAMEN LÖST DER CLIENT AUF (D2) aus den Listen der Einheiten und UHS. Ohne Leserecht auf ein Modul
 * (Freigabe `zugriff: false`, Abruf gescheitert) steht „zugeordnet“, nie „—“: der Strich behauptete
 * „kein Ort“. Bedienbar ist ein Teil nur mit Schreibrecht im Einsatz UND Zugriff auf sein Modul;
 * der Server bleibt die Prüfung, eine Ablehnung steht am Teil (`InlineAngabe`).
 */

export interface MaterialOrtWert {
  einheitId: number | null;
  uhsId: number | null;
}

/** Der Ort aus der Zeile — einzige Lesestelle, damit LLH-1225 nur hier umstellt. */
export function ortVon(em: Pick<EinsatzMaterial, 'einheit_id' | 'uhs_id'>): MaterialOrtWert {
  return { einheitId: em.einheit_id ?? null, uhsId: em.uhs_id ?? null };
}

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
}

/** Anzeigename einer UHS: „UHS Turnhalle“; heißt sie schon „UHS …“, nicht doppelt. */
export function uhsName(u: Pick<Uhs, 'bezeichnung'>): string {
  return /^UHS\b/i.test(u.bezeichnung) ? u.bezeichnung : `UHS ${u.bezeichnung}`;
}

const ZUGEORDNET = 'zugeordnet';

function einheitText(id: number, k: MaterialOrtKontext): string {
  return (k.einheit.lesbar && k.einheit.name(id)) || ZUGEORDNET;
}

function uhsText(id: number, k: MaterialOrtKontext): string {
  const u = k.uhs.lesbar ? k.uhs.liste.find((x) => x.id === id) : undefined;
  return u ? uhsName(u) : ZUGEORDNET;
}

/** Der Ort als Text (Sortierung, Suche): „Rettungsstaffel · UHS Turnhalle“, leer „“. */
export function ortText(ort: MaterialOrtWert, k: MaterialOrtKontext): string {
  return [
    ...(ort.einheitId != null ? [einheitText(ort.einheitId, k)] : []),
    ...(ort.uhsId != null ? [uhsText(ort.uhsId, k)] : []),
  ].join(' · ');
}

const OHNE_ORT = 'ohne';

/**
 * Filter der Spalte „Ort“ (D13): „ohne Ort“, je Einheit, je UHS der aktuellen Liste. Ein Posten an
 * Einheit und UHS trifft beide Werte. Ohne Leserecht fasst ein Wert „Einheit zugeordnet“ bzw. „UHS
 * zugeordnet“ alle zusammen.
 */
export function ortFilter(
  posten: readonly Pick<EinsatzMaterial, 'einheit_id' | 'uhs_id'>[],
  k: MaterialOrtKontext,
) {
  const einheitWerte = new Map<string, string>();
  const uhsWerte = new Map<string, string>();
  for (const p of posten) {
    const ort = ortVon(p);
    if (ort.einheitId != null) {
      const text = einheitText(ort.einheitId, k);
      einheitWerte.set(
        text === ZUGEORDNET ? 'einheit:*' : `einheit:${ort.einheitId}`,
        text === ZUGEORDNET ? 'Einheit zugeordnet' : text,
      );
    }
    if (ort.uhsId != null) {
      const text = uhsText(ort.uhsId, k);
      uhsWerte.set(
        text === ZUGEORDNET ? 'uhs:*' : `uhs:${ort.uhsId}`,
        text === ZUGEORDNET ? 'UHS zugeordnet' : text,
      );
    }
  }
  const sortiert = (m: Map<string, string>) =>
    [...m].map(([value, text]) => ({ value, text })).sort((a, b) => a.text.localeCompare(b.text));
  return {
    werte: [
      { value: OHNE_ORT, text: 'ohne Ort' },
      ...sortiert(einheitWerte),
      ...sortiert(uhsWerte),
    ],
    trifft: (p: Pick<EinsatzMaterial, 'einheit_id' | 'uhs_id'>, wert: string) => {
      const ort = ortVon(p);
      if (wert === OHNE_ORT) return ort.einheitId == null && ort.uhsId == null;
      if (wert === 'einheit:*')
        return ort.einheitId != null && einheitText(ort.einheitId, k) === ZUGEORDNET;
      if (wert === 'uhs:*') return ort.uhsId != null && uhsText(ort.uhsId, k) === ZUGEORDNET;
      if (wert.startsWith('einheit:')) return ort.einheitId === Number(wert.slice(8));
      if (wert.startsWith('uhs:')) return ort.uhsId === Number(wert.slice(4));
      return false;
    },
  };
}

/**
 * Lädt, was die Ort-Teile brauchen: Einheiten und UHS unter denselben Schlüsseln wie ihre Seiten
 * (live über die Ereignisse `einheit` und `uhs`), nur bei Zugriff auf das Modul. Unbekannte
 * Freigaben heißen offen; ein gescheiterter Abruf macht den Teil unlesbar.
 */
export function useMaterialOrtKontext(einsatzId: number, darfSchreiben: boolean) {
  const freigaben = useModulFreigaben(einsatzId);
  const einheitenZugriff = freigaben?.einheiten?.zugriff !== false;
  const uhsZugriff = freigaben?.unfallhilfsstellen?.zugriff !== false;
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
  const einheiten = einheitenQuery.data;
  const nachId = new Map((einheiten ?? []).map((e) => [e.id, e.name] as const));
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
  };
  return { kontext, dataUpdatedAt: Math.max(einheitenQuery.dataUpdatedAt, uhsQuery.dataUpdatedAt) };
}

export interface MaterialOrtProps {
  /** Zeilenkennung für die zugänglichen Namen („Einheit zu Wolldecke“). */
  kennung: string;
  ort: MaterialOrtWert;
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
  const teile: { key: string; inhalt: ReactNode }[] = [];

  if (darfSchreiben && k.einheit.bedienbar) {
    teile.push({
      key: 'einheit',
      inhalt: (
        <EinheitAngabe
          kennung={kennung}
          wert={ort.einheitId}
          optionen={k.einheit.optionen}
          darfSchreiben
          ohneOption="keine Einheit"
          onSpeichern={onEinheit}
        />
      ),
    });
  } else if (ort.einheitId != null) {
    const text = einheitText(ort.einheitId, k);
    teile.push({
      key: 'einheit',
      inhalt:
        text === ZUGEORDNET ? (
          text
        ) : (
          <KennungsLink to={einheitDetailPfad(k.einsatzId, ort.einheitId)}>{text}</KennungsLink>
        ),
    });
  }

  if (darfSchreiben && k.uhs.bedienbar) {
    const aktuell = ort.uhsId != null ? k.uhs.liste.find((u) => u.id === ort.uhsId) : undefined;
    const waehlbar = k.uhs.liste.filter(
      (u) => !u.storniert_at && (u.status === 'geplant' || u.status === 'aktiv'),
    );
    teile.push({
      key: 'uhs',
      inhalt: (
        <InlineAngabe<number | null>
          etikett="UHS"
          kennung={kennung}
          wert={ort.uhsId}
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
  } else if (ort.uhsId != null) {
    const text = uhsText(ort.uhsId, k);
    teile.push({
      key: 'uhs',
      inhalt:
        text === ZUGEORDNET ? (
          text
        ) : (
          <KennungsLink to={uhsDetailPfad(k.einsatzId, ort.uhsId)}>{text}</KennungsLink>
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
        columnGap: token.marginXS,
        minWidth: 0,
      }}
    >
      {teile.length === 0
        ? '—'
        : teile.map((t, i) => (
            <Fragment key={t.key}>
              {i > 0 && <span aria-hidden>·</span>}
              {t.inhalt}
            </Fragment>
          ))}
    </span>
  );
}
