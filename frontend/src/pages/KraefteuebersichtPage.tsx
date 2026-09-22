import { App as AntApp, Button, Input, Segmented, Space, Tag, theme } from 'antd';
import { TbFilter, TbPlus } from 'react-icons/tb';
import { taktischeDtgVoll } from '../anzeige/format';
import { Select } from '../components/Select';
import { Link, useNavigate, useParams } from 'react-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { auftraegePfad, einheitenPfad, lageberichtDetailPfad } from '../routing/deeplinks';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeAuftraege } from '../api/auftraege';
import { ApiError } from '../api/client';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  staerkeText,
  verdichte,
  type FilterWerte,
  type Rohdaten,
} from '../kraefte/kraeftebild';
import {
  aufklappbareSchluessel,
  baueMeldebildRaster,
  fahrzeugBand,
  istProblemZeile,
  personalBand,
  type RasterZeile,
} from '../kraefte/meldebildRaster';
import Statusband from '../kraefte/Statusband';
import EinheitZeichen from '../kraefte/EinheitZeichen';
import { KATEGORIE_WERTE } from '../kraefte/statusAchse';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { StatusKategorie } from '../api/types';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { StatusChip, StatusZelle, monoStil, useRollen } from '../components/instrument';
import './kraefteuebersichtPrint.css';

/**
 * MELDEBILD (Neuentwurf S6 „Statusraster über alle Einheiten", 21.09.2026).
 *
 * Aufbau: Seitenkopf (Titel · Mono-Meta · Abschnitt-Filter · „Einheit") → Statusband
 * (Fahrzeuge je FMS-Status, Personal je Kategorie) → Werkzeugzeile außerhalb des Primitivs
 * (Auswahlzeile, weitere Filter, Aufklappen, Lagebericht, Druck) → Raster: EINE Zeile je
 * Einheit, die Mittel als aufklappbares Detail. Die Ableitungen stehen rein in
 * `kraefte/meldebildRaster.ts`.
 *
 * WEGGELASSEN, weil ohne Datenquelle (Entscheidung 4, „keine erfundenen Daten"): der
 * FMS-Status JE EINHEIT und „Seit" (LFH-609), die Rückmeldung und die Kachel „keine
 * Rückmeldung" (LFH-610). Der Funkrufname der Einheit ist ihr gepflegter eigener
 * (LFH-614); fehlt er, steht nur der eines EINZIGEN Fahrzeugs, sonst bleibt die Zelle
 * leer. Die Einheitenzeile trägt statt eines erfundenen Status die VERDICHTETE Verteilung
 * ihrer Mittel (bereit / gebunden / Ausfall).
 */

/**
 * Der leere Filterzustand — EINE Quelle für Startwert, Zurücksetzen und das Zurücknehmen
 * einer einzelnen Marke.
 */
export const LEERER_FILTER: FilterWerte = {
  abschnittId: null,
  traeger: null,
  kategorie: null,
  suche: '',
};

export interface FilterChip {
  schluessel: keyof FilterWerte;
  label: string;
}

/**
 * Die gesetzten Filter als Beschriftungen (LFH-338 · C3, Befund H3). Feste Reihenfolge
 * (Abschnitt · Träger · Status · Suche), nicht die Setzreihenfolge; `suche` getrimmt wie in
 * `filtereKraefte`.
 */
export function aktiveFilterChips(
  filter: FilterWerte,
  abschnittName: (id: number) => string,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.abschnittId != null) {
    chips.push({
      schluessel: 'abschnittId',
      label: `Abschnitt: ${abschnittName(filter.abschnittId)}`,
    });
  }
  if (filter.traeger) chips.push({ schluessel: 'traeger', label: `Träger: ${filter.traeger}` });
  if (filter.kategorie) {
    const wert = KATEGORIE_WERTE.find((w) => w.value === filter.kategorie);
    chips.push({ schluessel: 'kategorie', label: `Status: ${wert?.text ?? filter.kategorie}` });
  }
  if (filter.suche.trim())
    chips.push({ schluessel: 'suche', label: `Suche: „${filter.suche.trim()}"` });
  return chips;
}

/**
 * Der Seitenkopf-Meta — Einheitenzahl und Stärke in BOS-Schreibweise (`F/UF/M//Ges`).
 *
 * DIE H3-ZUSICHERUNG LEBT HIER WEITER: bei gesetztem Filter nennt die Zeile den Ausschnitt
 * UND den Bezugswert („3 von 7 Einheiten · Stärke 1/0/5//6 von 2/3/10//15"). Ohne ihn
 * verschwände die Gesamtstärke des Einsatzes genau in dem Moment, in dem jemand einen
 * Abschnitt anwählt — und dann wird gemeldet. Rein und exportiert, damit beide Zweige ohne
 * Rendern prüfbar sind.
 */
export function meldebildMeta(args: {
  einheiten: number;
  einheitenGesamt: number;
  staerke: string;
  staerkeGesamt: string;
  gefiltert: boolean;
}): string {
  const wort = args.einheitenGesamt === 1 ? 'Einheit' : 'Einheiten';
  if (!args.gefiltert) return `${args.einheitenGesamt} ${wort} · Stärke ${args.staerkeGesamt}`;
  return (
    `${args.einheiten} von ${args.einheitenGesamt} ${wort} · ` +
    `Stärke ${args.staerke} von ${args.staerkeGesamt}`
  );
}

/** Kurzwort der Mittelart — Satz, kein Piktogramm (Regel „Ein Emoji ist keine Ikone"). */
const MITTEL_KURZ = { fahrzeug: 'Fzg.', person: 'Pers.', material: 'Mtl.' } as const;

/**
 * Die Spalten des Rasters. In einer Fabrik statt als Modulkonstante, weil zwei Zellen vom
 * Kontext abhängen (Einsatz-ID für den Auftrags-Deeplink, Abrufzustand der Aufträge).
 * Durch `spaltenFuer<RasterZeile>()` geführt, NICHT annotiert (Schlüsselliterale).
 *
 * Keine Sortierung, kein Spaltenfilter, keine Suche im Primitiv (`VOLLMENGE_PFLICHT`):
 * gefiltert wird außerhalb über die Rohlisten, aus denen Zeilen und Verteilungen neu
 * entstehen.
 */
/** Abrufzustand der Aufträge — `gesperrt` ist 403, kein Defekt. */
type AuftraegeZustand = 'daten' | 'laden' | 'fehler' | 'gesperrt';

function rasterSpalten(einsatzId: number, auftraegeZustand: AuftraegeZustand) {
  return spaltenFuer<RasterZeile>()([
    {
      title: 'Einheit',
      key: 'einheit',
      immerSichtbar: true,
      render: (_t, z) => <EinheitZelle zeile={z} />,
    },
    {
      title: 'Funkrufname',
      key: 'funk',
      width: 140,
      abBreite: 'lg',
      render: (_t, z) =>
        z.art === 'einheit' && z.funkrufname ? (
          <span style={monoStil(12)}>{z.funkrufname}</span>
        ) : null,
    },
    // KEIN `abBreite`: der Abschnitt war im alten Baum eine Ebene und damit in jeder Breite
    // und im Ausdruck da. Als Spalte ist er die Gliederung, die die Zeilenform ersetzt hat —
    // `abBreite` hängt an der Fensterbreite, nicht an `@media print`, und ein Meldeblatt auf
    // A4 (717 px) ginge sonst ohne die Zuordnung Einheit → Abschnitt hinaus.
    { title: 'Abschnitt', dataIndex: 'abschnitt', key: 'abschnitt', width: 140 },
    {
      title: 'Stärke',
      key: 'staerke',
      width: 120,
      render: (_t, z) =>
        z.staerke ? <span style={monoStil(12)}>{staerkeText(z.staerke)}</span> : null,
    },
    {
      title: 'Status',
      key: 'status',
      width: 210,
      render: (_t, z) => <StatusZellen zeile={z} />,
    },
    {
      title: 'Auftrag',
      key: 'auftrag',
      render: (_t, z) => (
        <AuftragZelle einsatzId={einsatzId} zeile={z} zustand={auftraegeZustand} />
      ),
    },
  ]);
}

function EinheitZelle({ zeile: z }: { zeile: RasterZeile }) {
  const { token, rollen } = useRollen();
  // Umbrechend, NICHT `nowrap`: die Einheitenspalte hat keine feste Breite, und ein
  // nicht umbrechender Nebentext hebt die Mindestbreite der ganzen Tabelle — im Druck auf
  // A4 ragte sie dann aus dem Blatt (`e2e/meldebild-tabelle.spec.ts`, Nachweis 2).
  const nebentext = z.zusatz && (
    <span style={{ display: 'block', fontSize: 11, color: rollen.gedaempft }}>{z.zusatz}</span>
  );
  if (z.art !== 'einheit') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: token.marginXS }}>
        <span style={{ ...monoStil(11), color: rollen.schwach }}>{MITTEL_KURZ[z.art]}</span>
        <span style={{ minWidth: 0 }}>
          {z.art === 'fahrzeug' ? <span style={monoStil(12)}>{z.bezeichnung}</span> : z.bezeichnung}
          {nebentext}
        </span>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginSM }}>
      <EinheitZeichen tz={z.tz} />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{z.bezeichnung}</span>
        {nebentext}
      </span>
    </span>
  );
}

/**
 * Statusspalte. Mittel: der echte Einzelstatus als Chip (Fahrzeug mit FMS-Code).
 * Einheit: die verdichtete Verteilung ihrer Fahrzeuge und ihres Personals als drei
 * Statuszellen in FESTER Folge, auch bei 0 — sonst fluchten zwei Zeilen nicht. Eine 0
 * bekommt keinen Ton: eine rot getönte Null meldete das Gegenteil dessen, was sie heißt.
 */
function StatusZellen({ zeile: z }: { zeile: RasterZeile }) {
  const { rollen } = useRollen();
  if (z.status) {
    return <StatusChip ton={z.status.ton} code={z.status.code ?? undefined} wort={z.status.wort} />;
  }
  const v = z.verteilung;
  if (!v) return null;
  const zellen = [
    { wert: v.bereit, wort: 'bereit', ton: 'normal' as const },
    { wert: v.gebunden, wort: 'gebunden', ton: 'achtung' as const },
    { wert: v.ausfall, wort: 'Ausfall', ton: 'alarm' as const },
  ];
  return (
    <div
      role="group"
      aria-label="Fahrzeuge und Personal"
      data-lfh="meldebild-verteilung"
      title={v.ohne > 0 ? `zusätzlich ${v.ohne} ohne Status` : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(40px, 1fr))',
        gap: 1,
        background: rollen.linie,
        maxWidth: 180,
      }}
    >
      {zellen.map((c) => (
        <StatusZelle
          key={c.wort}
          ton={c.wert > 0 ? c.ton : 'neutral'}
          wert={c.wert}
          wort={c.wort}
          hoehe={24}
        />
      ))}
    </div>
  );
}

function AuftragZelle({
  einsatzId,
  zeile: z,
  zustand,
}: {
  einsatzId: number;
  zeile: RasterZeile;
  zustand: AuftraegeZustand;
}) {
  const { rollen } = useRollen();
  if (z.art !== 'einheit' || z.einheitId == null) return null;
  // Scheitert der Auftragsabruf, bleibt die Tabelle stehen — die Zelle sagt, dass sie
  // nichts weiß, statt „kein Auftrag" zu behaupten (Fehler ≠ leer).
  // Eine Rolle ohne Auftragsrecht bekommt 403 — das ist „nicht für dich", keine Störung,
  // und darf nicht wie eine aussehen.
  if (zustand === 'gesperrt') {
    return (
      <span title="Aufträge für diese Rolle nicht einsehbar" style={{ color: rollen.gedaempft }}>
        —
      </span>
    );
  }
  if (zustand === 'fehler') {
    return (
      <span title="Aufträge nicht abrufbar" style={{ color: rollen.gedaempft }}>
        ?
      </span>
    );
  }
  if (zustand === 'laden' || !z.auftrag) return null;
  const a = z.auftrag;
  const text = [
    a.nr != null ? `Nr. ${a.nr}` : null,
    a.ueberfaellig ? 'überfällig' : a.inArbeit ? 'in Arbeit' : null,
    a.text,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={auftraegePfad(einsatzId, { auftrag: a.id })}
      title={text}
      // Zwei Zeilen mit Auslassung statt `nowrap`: eine nicht umbrechende Zeile setzte die
      // Mindestbreite der Spalte auf die Textlänge. Der Volltext steht im `title`.
      style={{
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        maxWidth: 360,
      }}
    >
      {text}
    </Link>
  );
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();

  const [filter, setFilter] = useState<FilterWerte>(LEERER_FILTER);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [printPending, setPrintPending] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  // Die zwei Zusatzabrufe des Rasters. Beide dürfen scheitern, ohne die Seite zu nehmen:
  // ohne Katalog fehlen nur die FMS-Codes, ohne Aufträge nur die Auftragsspalte.
  const statusKatalogQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });

  const traeger = useMemo(
    () =>
      [
        ...new Set(
          [
            ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
            ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
          ].filter((t): t is string => !!t),
        ),
      ].sort(),
    [personalQuery.data, fahrzeugeQuery.data],
  );

  const gefiltertRoh = useMemo(() => {
    const roh: Rohdaten = {
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
    };
    return filtereKraefte(roh, filter);
  }, [
    abschnitteQuery.data,
    einheitenQuery.data,
    personalQuery.data,
    fahrzeugeQuery.data,
    materialQuery.data,
    filter,
  ]);

  const raster = useMemo(
    () =>
      baueMeldebildRaster({
        ...gefiltertRoh,
        statusKatalog: statusKatalogQuery.data ?? [],
        auftraege: auftraegeQuery.data ?? [],
      }),
    [gefiltertRoh, statusKatalogQuery.data, auftraegeQuery.data],
  );

  const band = useMemo(
    () => ({
      fahrzeuge: fahrzeugBand(gefiltertRoh.fahrzeuge, statusKatalogQuery.data ?? []),
      personal: personalBand(gefiltertRoh.personal),
    }),
    [gefiltertRoh, statusKatalogQuery.data],
  );

  const v = useMemo(
    () => verdichte(gefiltertRoh.personal, gefiltertRoh.fahrzeuge, gefiltertRoh.material),
    [gefiltertRoh],
  );
  /** Der Bezugswert — dieselbe Rechnung über die UNGEFILTERTEN Listen (Befund H3). */
  const gesamt = useMemo(
    () => verdichte(personalQuery.data ?? [], fahrzeugeQuery.data ?? [], materialQuery.data ?? []),
    [personalQuery.data, fahrzeugeQuery.data, materialQuery.data],
  );

  const spalten = useMemo(
    () =>
      rasterSpalten(
        einsatzId,
        auftraegeQuery.error instanceof ApiError && auftraegeQuery.error.status === 403
          ? 'gesperrt'
          : auftraegeQuery.isError
            ? 'fehler'
            : auftraegeQuery.isLoading
              ? 'laden'
              : 'daten',
      ),
    [einsatzId, auftraegeQuery.error, auftraegeQuery.isError, auftraegeQuery.isLoading],
  );

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = taktischeDtgVoll(new Date().toISOString());
      // Der Lagebericht behält die Abschnittsgliederung: ein Meldetext wird nach Abschnitten
      // gelesen, das Raster am Schirm nach Einheiten verglichen.
      const bild = baueKraeftebild(
        gefiltertRoh.abschnitte,
        gefiltertRoh.einheiten,
        gefiltertRoh.personal,
        gefiltertRoh.fahrzeuge,
        gefiltertRoh.material,
      );
      const md = rendereMeldebildMarkdown(bild, stand);
      const lb = await legeLageberichtAn(einsatzId, {
        vorlage: 'freitext',
        titel: `Kräftemeldebild ${stand}`,
      });
      // Schlägt der PATCH fehl, bleibt ein leerer Entwurf zurück (vom EL löschbar) —
      // atomar wäre nur ein eigener Backend-Endpunkt, bewusster v1-Kompromiss.
      await aktualisiereLagebericht(einsatzId, lb.id, {
        abschnitte: [{ schluessel: 'text', text: md }],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatzId, lbId)),
    onError: () => message.error('Übernahme fehlgeschlagen'),
  });

  // Ein Einsatzwechsel setzt Filter und Aufklappzustand zurück — sonst trüge die
  // Filtermarke den Abschnittsnamen des vorigen Einsatzes.
  //
  // ZUGEKLAPPT STARTEN ist hier richtig, und es dreht H7 (LFH-338 · C3) nicht zurück: der
  // Befund war, dass im alten Baum die meldefähigen Zahlen erst nach n Klicks zu sehen
  // waren. Im Raster trägt die EINHEITENZEILE selbst Stärke, Verteilung und Auftrag; die
  // Mittel darunter sind Detail. Ein Riegel „nur einmal aufklappen" ist damit entfallen.
  useEffect(() => {
    setExpandedKeys([]);
    setFilter(LEERER_FILTER);
  }, [einsatzId]);

  // Erst nach committetem Aufklappen drucken (sonst fehlen die Mittel im Ausdruck).
  useEffect(() => {
    if (printPending) {
      window.print();
      setPrintPending(false);
    }
  }, [printPending]);

  const handleDrucken = () => {
    setExpandedKeys(aufklappbareSchluessel(raster));
    setPrintPending(true);
  };

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /** Ältester erfolgreicher Listenabruf — trägt Kopfzeile UND Druckstand. */
  const datenstand = gemeinsamerDatenstand(
    einheitenQuery.dataUpdatedAt,
    personalQuery.dataUpdatedAt,
    fahrzeugeQuery.dataUpdatedAt,
    materialQuery.dataUpdatedAt,
    abschnitteQuery.dataUpdatedAt,
  );

  /**
   * Stehen alle Mittel offen? Trägt den Zustand des Umschalters. Als benannte
   * Zwischenvariable, nicht inline im `value` — `datensicht.guard.test.ts` liest aus dem
   * Schalter-Attribut eine „Reiterachse"; hier liest der Schalter die Daten, nicht umgekehrt.
   */
  const alleAufgeklappt =
    expandedKeys.length > 0 && expandedKeys.length === aufklappbareSchluessel(raster).length;

  const abschnittName = (aid: number) =>
    (abschnitteQuery.data ?? []).find((a) => a.id === aid)?.name ?? `Abschnitt ${aid}`;
  const chips = aktiveFilterChips(filter, abschnittName);
  const gefiltert = chips.length > 0;
  /** „Kräfte" = Personal + Fahrzeuge, kein Material (eigene Statusachse, kein Kategoriefilter). */
  const sichtbareKraefte = v.anzahlPersonal + v.anzahlFahrzeuge;
  const alleKraefte = gesamt.anzahlPersonal + gesamt.anzahlFahrzeuge;
  const einheitenZeilen = raster.filter((z) => z.einheitId != null).length;

  const listenFehler = personalQuery.isError || fahrzeugeQuery.isError || einheitenQuery.isError;
  const listenLaden = personalQuery.isLoading || fahrzeugeQuery.isLoading;

  const meta = meldebildMeta({
    einheiten: einheitenZeilen,
    einheitenGesamt: (einheitenQuery.data ?? []).length,
    staerke: staerkeText(v.staerke),
    staerkeGesamt: staerkeText(gesamt.staerke),
    gefiltert,
  });

  return (
    // `kraefte-print-root` bleibt die ÄUSSERE Hülle: `kraefteuebersichtPrint.css` hängt daran,
    // und `EinsatzSeite` nimmt kein `className` entgegen.
    <div className="kraefte-print-root">
      <EinsatzSeite
        titel="Meldebild"
        meta={meta}
        dataUpdatedAt={datenstand}
        aktionen={
          <Space className="kraefte-no-print" wrap>
            {/* Sekundär: der Abschnitt-Filter. Er wirkt wie alle Filter AUSSERHALB des
                Primitivs auf die Rohlisten (VOLLMENGE_PFLICHT). */}
            <Select
              aria-label="Abschnitt filtern"
              placeholder="Abschnitt"
              prefix={
                <span aria-hidden style={{ display: 'inline-flex' }}>
                  <TbFilter />
                </span>
              }
              allowClear
              style={{ minWidth: 160 }}
              value={filter.abschnittId ?? undefined}
              options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              onChange={(wert) => setFilter((f) => ({ ...f, abschnittId: wert ?? null }))}
            />
            {/* Primär: eine Einheit bilden. Die Maske lebt auf der Einheiten-Seite (dort
                steht das Anlegen-Modal); ein zweites Formular hier wäre eine zweite
                Erfassungsmaske derselben Sache. Ohne Schreibrecht kein Knopf — dort
                entstünde keine Einheit. */}
            {darfSchreiben && (
              <Button
                type="primary"
                icon={
                  <span aria-hidden style={{ display: 'inline-flex' }}>
                    <TbPlus />
                  </span>
                }
                title="Einheit anlegen (Einheiten-Seite)"
                onClick={() => navigate(einheitenPfad(einsatzId))}
              >
                Einheit
              </Button>
            )}
          </Space>
        }
      >
        {/* ── NUR IM DRUCK (LFH-338 · C3, Befund H4) ──────────────────────────────────
          Einsatzbezeichnung, Zeitstand, Ersteller und Auswahl — ohne diese vier Angaben ist
          ein Meldeblatt nicht zuordenbar. `data-testid`, weil der Knoten am Schirm per CSS
          verborgen ist und jsdom kein CSS auswertet. */}
        <div className="kraefte-nur-print" data-testid="kraefte-druckkopf">
          <div style={{ fontWeight: 600 }}>
            Meldebild — {einsatz.bezeichnung}
            {einsatz.einsatznummer_intern ? ` (${einsatz.einsatznummer_intern})` : ''}
          </div>
          {/* Der Stand ist der ÄLTESTE erfolgreiche Listenabruf, nicht die Druckzeit. */}
          <div>Stand: {taktischeDtgVoll(new Date(datenstand || Date.now()).toISOString())}</div>
          <div>Erstellt von: {benutzer?.anzeigename ?? '—'}</div>
          <div>{meta}</div>
          {gefiltert && <div>Auswahl: {chips.map((c) => c.label).join(' · ')}</div>}
        </div>

        <div style={{ marginBlock: token.marginLG }}>
          <Statusband
            fahrzeuge={band.fahrzeuge}
            personal={band.personal}
            zustand={listenFehler ? 'fehler' : listenLaden ? 'laden' : 'daten'}
          />
        </div>

        {/* ── WERKZEUGZEILE, AUSSERHALB DES PRIMITIVS ─────────────────────────────────
          Die Auswahlzeile sagt IMMER, wie viel von wie viel gezeigt wird (H3) — auch
          ungefiltert, sonst wäre ihr Erscheinen selbst das Signal. Träger, Status und Suche
          filtern die Rohlisten wie der Abschnitt im Kopf. Druck und Lagebericht stehen HIER
          und nicht in der Werkzeugzeile von `Datensicht`: nur hier trägt `.kraefte-no-print`. */}
        <div
          className="kraefte-no-print"
          data-lfh="meldebild-werkzeuge"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: token.marginSM,
            marginBlockEnd: token.margin,
          }}
        >
          <span style={{ color: token.colorTextSecondary }}>
            {sichtbareKraefte} von {alleKraefte} Kräften
          </span>
          {chips.map((chip) => (
            <Tag
              key={chip.schluessel}
              closable
              onClose={() =>
                setFilter((f) => ({ ...f, [chip.schluessel]: LEERER_FILTER[chip.schluessel] }))
              }
            >
              {chip.label}
            </Tag>
          ))}
          {gefiltert && (
            <Button type="link" onClick={() => setFilter(LEERER_FILTER)}>
              Filter zurücksetzen
            </Button>
          )}
          <Select
            placeholder="Trägerorganisation"
            allowClear
            style={{ minWidth: 180 }}
            value={filter.traeger ?? undefined}
            options={traeger.map((t) => ({ value: t, label: t }))}
            onChange={(wert) => setFilter((f) => ({ ...f, traeger: wert ?? null }))}
          />
          {/* Der vierte Eimer („ohne Status") bleibt draußen: `filtereKraefte` vergleicht
            `kat === f.kategorie`, ein Wert `'ohne'` träfe nie eine Zeile. */}
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.kategorie ?? undefined}
            options={KATEGORIE_WERTE.filter((w) => w.value !== 'ohne').map((w) => ({
              value: w.value as StatusKategorie,
              label: w.text,
            }))}
            onChange={(wert) => setFilter((f) => ({ ...f, kategorie: wert ?? null }))}
          />
          <Input.Search
            placeholder="Suche..."
            allowClear
            style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
          {/* Zwei Zustände desselben Rasters, keine zwei Handlungen. Der Wert wird aus
            `expandedKeys` ABGELEITET, gegen die Vollzähligkeit — mit `length > 0` stünde der
            Umschalter nach dem Zuklappen einer einzelnen Zeile weiter auf „alles". */}
          <Segmented
            value={alleAufgeklappt ? 'mittel' : 'einheiten'}
            onChange={(wert) =>
              setExpandedKeys(wert === 'mittel' ? aufklappbareSchluessel(raster) : [])
            }
            options={[
              { value: 'einheiten', label: 'Nur Einheiten' },
              { value: 'mittel', label: 'Mit Mitteln' },
            ]}
          />
          {darfSchreiben && (
            <Button loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>
              In Lagebericht übernehmen
            </Button>
          )}
          <Button onClick={handleDrucken}>Drucken / als PDF</Button>
        </div>

        {/* Das Raster läuft mit `form="tabelle"` — in JEDER Breite Tabelle (Vergleichsfläche,
          Kriterium 14; `NUR_TABELLE`). Die fixierte menschenlesbare Kennung ist die
          Einheitenspalte.

          KEIN `suche`, KEIN Spaltenfilter, KEINE Sortierung im Primitiv (`VOLLMENGE_PFLICHT`):
          die Verteilungen je Einheit entstehen aus den gefilterten Rohlisten; fiele im
          Primitiv eine Mittelzeile weg, behielte die Einheit Zahlen über unsichtbare Kinder.

          ZUFLUSS: Vorgabe `sammelbanner`. Bis 21.09. stand hier `sofort`, weil die Schleuse
          nur die WURZEL-Schlüsselfolge führt und eine neue Disposition tief im alten Baum
          landete. Die Wurzel ist jetzt die Einheitenliste — eine neu gebildete Einheit
          erscheint als Banner statt unter dem Cursor einzurutschen; neue Mittel wachsen in
          den Kindern und ändern die Wurzelfolge nicht.

          PROBLEMZEILE: eine Einheit mit Ausfall trägt `meldebild-problemzeile` (Tönung aus
          `--lfh-problem-zeile`, Regel in `kraefteuebersichtPrint.css`); der zweite Kanal ist
          die Ausfall-Zahl in der Statusspalte. */}
        <Datensicht
          bezeichnung="Meldebild"
          form="tabelle"
          spalten={spalten}
          daten={raster}
          zeilenSchluessel="key"
          ladend={einheitenQuery.isLoading}
          leerText={
            <span>
              Keine Einheiten und keine Kräfte im Einsatz
              {darfSchreiben && (
                <>
                  {' — '}
                  <Link to={einheitenPfad(einsatzId)}>Einheit bilden</Link>
                </>
              )}
            </span>
          }
          baum={{ kinder: 'children', aufgeklappt: expandedKeys, onAufgeklappt: setExpandedKeys }}
          zeilenKlasse={(z) => (istProblemZeile(z) ? 'meldebild-problemzeile' : undefined)}
          karte={{
            art: 'plan',
            titel: { spalte: 'einheit' },
            sekundaer: ['abschnitt', 'staerke', 'auftrag'],
          }}
        />
      </EinsatzSeite>
    </div>
  );
}
