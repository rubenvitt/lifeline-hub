import { Alert, App, Breadcrumb, Button, Flex, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  freigegebenNach,
  LEERER_ZUFLUSSSTAND,
  nachgefuehrtNach,
  teileZuflussNach,
  type Sortierschluessel,
  type Zuflussstand,
} from '../abloesung/zufluss';
import { useUhr } from '../abloesung/useUhr';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { listeNachforderungen } from '../api/nachforderungen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  AusgabeEingabe,
  EinsatzStatus,
  VerpflegungAusgabe,
  VerpflegungZeitfenster,
  ZeitfensterEingabe,
  ZeitfensterPatch,
} from '../api/types';
import {
  aendereZeitfenster,
  erfasseAusgabe,
  ladeVerpflegung,
  legeZeitfensterAn,
  loescheZeitfenster,
  nimmAusgabeZurueck,
} from '../api/verpflegung';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { Sammelbanner, Segmentleiste, useRollen } from '../components/instrument';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { nachforderungenPfad } from '../routing/deeplinks';
import {
  AusgabeDialog,
  LoeschenDialog,
  RuecknahmeDialog,
  ZeitfensterDialog,
  type NachforderungOption,
} from '../verpflegung/VerpflegungDialoge';
import ZeitfensterKarte from '../verpflegung/ZeitfensterKarte';
import { deckungEinstufung, istVergangen } from '../verpflegung/deckung';
import { nachforderungVorbelegung, zitat } from '../verpflegung/verpflegungText';

/** Grund der fehlenden Schreibberechtigung als ganzer Satz (C10/M16). */
export function verpflegungRechteText(status: EinsatzStatus): string {
  return status !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — die Verpflegung ist nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Zeitfenster anlegen und Ausgaben erfassen.';
}

/**
 * Sortierschlüssel der Zeitfenster für die Zufluss-Schleuse: der Beginn, wie der Server ordnet
 * (`ORDER BY von_at, id`). Verschiebt eine andere Person den Beginn, bleibt die gezeigte Folge
 * stehen, bis das Banner bedient wird (Muster LFH-660).
 */
const BEGINN: Sortierschluessel<VerpflegungZeitfenster> = (zf) => zf.von_at;

/**
 * „1 neues Zeitfenster, davon 1 mit Unterdeckung" — der Wortlaut des Sammelbanners; bei einer
 * fremden Umordnung zusätzlich „Reihenfolge geändert".
 */
export function zuflussText(
  zurueckgehalten: readonly VerpflegungZeitfenster[],
  jetzt: Parameters<typeof deckungEinstufung>[1],
  umgeordnet = false,
): string {
  const teile: string[] = [];
  const n = zurueckgehalten.length;
  if (n > 0) {
    const basis = n === 1 ? '1 neues Zeitfenster' : `${n} neue Zeitfenster`;
    const unter = zurueckgehalten.filter(
      (zf) => deckungEinstufung(zf, jetzt) === 'unterdeckung',
    ).length;
    teile.push(unter > 0 ? `${basis}, davon ${unter} mit Unterdeckung` : basis);
  }
  if (umgeordnet) teile.push('Reihenfolge geändert');
  return teile.join(' · ');
}

type Ansicht = 'laufend' | 'vergangen';

type Dialog =
  | { art: 'anlegen' }
  | { art: 'bearbeiten'; zf: VerpflegungZeitfenster }
  | { art: 'ausgabe'; zf: VerpflegungZeitfenster }
  | { art: 'ruecknahme'; zf: VerpflegungZeitfenster; ausgabe: VerpflegungAusgabe }
  | { art: 'loeschen'; zf: VerpflegungZeitfenster };

/**
 * Fachmodul Verpflegung (LFH-634, design.md D7): Zeitfenster mit Bedarf, Ausgaben und Deckung.
 *
 * FORM: eine LISTE, keine Tabelle (LFH-330/B2) — die Frage ist „was ist mit diesem
 * Zeitfenster?", und die Ordnung ist die Zeit (`von_at`, vom Server). Die Segmentleiste trennt
 * „laufend & anstehend" (`bis ≥ jetzt`, Vorgabe) von „vergangen".
 *
 * LIVE-ZUFLUSS (Spec „Live-Verteilung", Muster Ablösung LFH-647, `abloesung/zufluss.ts`): ein
 * fremdes neues Zeitfenster landet an seinem Platz in der Zeitordnung — auch oberhalb der
 * Karte, auf der der Cursor steht. Es wartet deshalb hinter dem Sammelbanner; eigene stehen
 * sofort. Die Schleuse läuft über ALLE Zeitfenster, nicht je Ansicht: ein Zeitfenster, das mit
 * der Uhr von „laufend" nach „vergangen" wandert, ist kein Neuzugang. Das Banner zählt nur die
 * Zurückgehaltenen der gezeigten Ansicht; ein Ansichtswechsel gibt alle frei. Geänderte Mengen
 * an bestehenden Karten fließen direkt ein — sie verschieben die Ordnung nicht.
 *
 * DAS BANNER NIMMT KEINE EIGENE ZEILE: es steht in der immer gerenderten Werkzeugzeile, deren
 * Höhe es nicht ändert (Bauform der Ablösung).
 *
 * DIE UHR tickt alle 30 s (`useUhr`): Einstufung und Trennung „vergangen" laufen mit, ohne
 * Abruf. Nichts blinkt.
 *
 * KOPFZAHLEN rechnen mit der vollen Menge, nicht mit der gezeigten — die Zahlen dürfen nicht
 * lügen, auch solange ein Neuzugang hinter dem Banner wartet.
 */
export default function VerpflegungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr();

  const [ansicht, setAnsicht] = useState<Ansicht>('laufend');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // An den Einsatz gebunden: wechselt die Route den Einsatz bei stehender Komponente, wären
  // sonst alle Zeitfenster des neuen Einsatzes „fremde Neuzugänge".
  const [zuflussZustand, setZuflussZustand] = useState<{ einsatzId: number } & Zuflussstand>({
    einsatzId,
    ...LEERER_ZUFLUSSSTAND,
  });

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const verpflegungQuery = useQuery({
    queryKey: einsatzKeys.verpflegung(einsatzId),
    queryFn: () => ladeVerpflegung(einsatzId),
  });
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });
  const overrides = overridesQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  // Nachforderungen nur bei BEDIENBAREM Modul (D4/D8) — und erst, wenn die Overrides bekannt
  // sind: ohne sie hielte `istKeyFreigegeben` jedes Modul für sichtbar. Ein 403 bleibt still.
  const nachforderungenFrei =
    overrides !== undefined && istKeyFreigegeben('nachforderungen', benutzer, overrides);
  const nachforderungenQuery = useQuery({
    // Derselbe Schlüssel und dieselbe Abfrage wie `NachforderungenPage` — ein Cache-Fach, eine Form.
    queryKey: einsatzKeys.nachforderungen(einsatzId),
    queryFn: () => listeNachforderungen(einsatzId, {}),
    enabled: nachforderungenFrei,
    retry: false,
  });
  const nachforderungen = useMemo(
    () =>
      nachforderungenFrei && !nachforderungenQuery.isError ? (nachforderungenQuery.data ?? []) : [],
    [nachforderungenFrei, nachforderungenQuery.isError, nachforderungenQuery.data],
  );
  const nachforderungNamen = useMemo(
    () => new Map(nachforderungen.map((n) => [n.id, n.bezeichnung])),
    [nachforderungen],
  );
  const nachforderungOptionen: NachforderungOption[] | null = nachforderungenFrei
    ? nachforderungen.map((n) => ({ value: n.id, label: n.bezeichnung }))
    : null;

  const alle = useMemo(() => verpflegungQuery.data?.zeitfenster ?? [], [verpflegungQuery.data]);

  // ── Live-Zufluss ────────────────────────────────────────────────────────────────────
  const zufluss: Zuflussstand =
    zuflussZustand.einsatzId === einsatzId ? zuflussZustand : LEERER_ZUFLUSSSTAND;
  const geteilt = teileZuflussNach(alle, zufluss, BEGINN);
  const umgeordnet = geteilt.umgeordnet;
  const inAnsicht = (zf: VerpflegungZeitfenster) =>
    istVergangen(zf, jetzt) === (ansicht === 'vergangen');
  let sichtbar = geteilt.sichtbar;
  let zurueckgehalten = geteilt.zurueckgehalten.filter(inAnsicht);
  // Null gezeigte Karten in DIESER Ansicht halten nichts zurück: ein Leerzustand neben einem
  // Banner „1 neues Zeitfenster" wäre ein Widerspruch (Regel aus `abloesung/zufluss.ts`).
  if (zurueckgehalten.length > 0 && !sichtbar.some(inAnsicht)) {
    const frei = new Set(zurueckgehalten.map((zf) => zf.id));
    sichtbar = alle.filter((zf) => frei.has(zf.id) || sichtbar.includes(zf));
    zurueckgehalten = [];
  }
  // Nachführen IM RENDER (Muster Ablösung): `nachgefuehrt` liefert `null`, wenn nichts zu tun
  // ist — der Riegel gegen die Schleife.
  if (verpflegungQuery.data) {
    const neu = nachgefuehrtNach(zufluss, sichtbar, umgeordnet, BEGINN);
    if (neu || zuflussZustand.einsatzId !== einsatzId) {
      setZuflussZustand({ einsatzId, ...(neu ?? zufluss) });
    }
  }
  const merkeEigenes = (zfId: number) =>
    setZuflussZustand((z) => {
      const basis = z.einsatzId === einsatzId ? z : { einsatzId, ...LEERER_ZUFLUSSSTAND };
      return { ...basis, eigene: new Set([...basis.eigene, zfId]) };
    });
  const gibFrei = () =>
    setZuflussZustand((z) => ({
      einsatzId,
      ...freigegebenNach(z.einsatzId === einsatzId ? z : LEERER_ZUFLUSSSTAND, alle, BEGINN),
    }));

  // ── Mutationen ──────────────────────────────────────────────────────────────────────
  // Zeitfenster schreiben einen ETB-Eintrag (D5), Ausgaben nicht.
  const invalidiere = (mitEtb: boolean) => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.verpflegung(einsatzId) });
    if (mitEtb) void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  };
  const schliesse = () => setDialog(null);

  // Fehler stehen IM jeweiligen Dialog (SpeicherFehler); `mutateAsync` lehnt ab, die Hülle
  // lässt die Felder stehen (LFH-332/B4).
  const anlegenMut = useMutation({
    mutationFn: (body: ZeitfensterEingabe) => legeZeitfensterAn(einsatzId, body),
    onSuccess: (zf) => {
      merkeEigenes(zf.id);
      invalidiere(true);
      message.success(`Zeitfenster ${zitat(zf.bezeichnung)} angelegt`);
    },
  });
  const aendernMut = useMutation({
    mutationFn: ({ zfId, patch }: { zfId: number; patch: ZeitfensterPatch }) =>
      aendereZeitfenster(einsatzId, zfId, patch),
    onSuccess: (zf) => {
      invalidiere(true);
      message.success(`Bedarf ${zitat(zf.bezeichnung)} gespeichert`);
    },
  });
  const loeschenMut = useMutation({
    mutationFn: (zf: VerpflegungZeitfenster) => loescheZeitfenster(einsatzId, zf.id),
    onSuccess: (_, zf) => {
      invalidiere(true);
      schliesse();
      message.success(`Zeitfenster ${zitat(zf.bezeichnung)} gelöscht`);
    },
  });
  // Rückgängig aus dem Toast: kein Dialog, in dem ein Fehler stehen könnte — also Toast.
  const rueckgaengigMut = useMutation({
    mutationFn: (ausgabeId: number) => nimmAusgabeZurueck(einsatzId, ausgabeId),
    onSuccess: () => {
      invalidiere(false);
      message.success('Ausgabe zurückgenommen');
    },
    onError: (e) => {
      invalidiere(false);
      message.error(e instanceof Error ? e.message : 'Rücknahme fehlgeschlagen');
    },
  });
  const ausgabeMut = useMutation({
    mutationFn: ({ zf, body }: { zf: VerpflegungZeitfenster; body: AusgabeEingabe }) =>
      erfasseAusgabe(einsatzId, zf.id, body),
    // Die Ausgabe hat einen serverseitigen Rückweg → Rückgängig-Toast statt Rückfrage
    // (LFH-343 · C8).
    onSuccess: (erg, { zf, body }) => {
      invalidiere(false);
      zeigeRueckgaengig(
        message,
        `Ausgabe erfasst: ${body.menge} EP zu ${zitat(zf.bezeichnung)}`,
        () => rueckgaengigMut.mutate(erg.ausgabe_id),
      );
    },
  });
  // Rücknahme aus der Liste: endgültig, mit Rückfrage; der Fehler steht im Dialog.
  const ruecknahmeMut = useMutation({
    mutationFn: (ausgabeId: number) => nimmAusgabeZurueck(einsatzId, ausgabeId),
    onSuccess: () => {
      invalidiere(false);
      schliesse();
      message.success('Ausgabe zurückgenommen');
    },
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  const vergangen = alle.filter((zf) => istVergangen(zf, jetzt));
  const unterdeckung = alle.filter((zf) => deckungEinstufung(zf, jetzt) === 'unterdeckung').length;
  const liste = sichtbar.filter(inAnsicht);
  const oeffneAnlegen = () => {
    anlegenMut.reset();
    setDialog({ art: 'anlegen' });
  };
  const nachfordern = (zf: VerpflegungZeitfenster) => {
    const vorbelegung = nachforderungVorbelegung(zf, konventionen);
    if (vorbelegung) void navigate(nachforderungenPfad(einsatzId, { vorbelegung }));
  };

  return (
    <EinsatzSeite
      titel="Verpflegung"
      meta={`${alle.length} Zeitfenster · ${unterdeckung} mit Unterdeckung`}
      dataUpdatedAt={verpflegungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Verpflegung' },
          ]}
        />
      }
      // Gesperrt statt versteckt (C10/M16): der Hinweis darunter nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={oeffneAnlegen}>
          Zeitfenster anlegen
        </Button>
      }
      neueZeile={darfSchreiben ? oeffneAnlegen : undefined}
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={verpflegungRechteText(einsatz.status)} />
      }
    >
      {/* Werkzeugzeile: immer gerendert, `nowrap`, Mindesthöhe = Steuerhöhe + 2 px Rahmen. Das
          Banner ändert ihre Höhe nicht, also verschiebt es keine Karte (Bauform Ablösung). */}
      <Flex
        gap={token.marginSM}
        align="center"
        data-lfh="verpflegung-werkzeugzeile"
        style={{ marginBottom: token.margin, minHeight: token.controlHeight + 2 }}
      >
        <Segmentleiste
          beschriftung="Ansicht"
          wert={ansicht}
          onWechsel={(w) => {
            // Ein Ansichtswechsel ist die Bitte, den aktuellen Stand zu sehen.
            gibFrei();
            setAnsicht(w);
          }}
          optionen={[
            {
              wert: 'laufend',
              label: `laufend & anstehend (${alle.length - vergangen.length})`,
            },
            { wert: 'vergangen', label: `vergangen (${vergangen.length})` },
          ]}
          style={{ flex: 'none' }}
        />
        {(zurueckgehalten.length > 0 || umgeordnet) && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: gibFrei }}
            style={{ flex: '1 1 0', minWidth: 0, flexWrap: 'nowrap', paddingBlock: 0 }}
          >
            <span
              title={zuflussText(zurueckgehalten, jetzt, umgeordnet)}
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {zuflussText(zurueckgehalten, jetzt, umgeordnet)}
            </span>
          </Sammelbanner>
        )}
      </Flex>

      {verpflegungQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.marginSM }}
          title="Zeitfenster konnten nicht geladen werden"
        />
      )}
      {verpflegungQuery.isLoading ? (
        <Spin />
      ) : alle.length === 0 ? (
        <SeitenLeer
          titel="Noch kein Zeitfenster"
          hinweis="Ein Zeitfenster ist eine Mahlzeit mit ihrem Bedarf an Essensportionen, z. B. „Mittag“."
          aktion={
            darfSchreiben ? { label: 'Zeitfenster anlegen', onClick: oeffneAnlegen } : undefined
          }
        />
      ) : liste.length === 0 ? (
        <SeitenLeer
          titel={
            ansicht === 'laufend'
              ? 'Kein laufendes oder anstehendes Zeitfenster'
              : 'Noch kein Zeitfenster vorbei'
          }
        />
      ) : (
        <section
          aria-label={
            ansicht === 'laufend' ? 'Laufende und anstehende Zeitfenster' : 'Vergangene Zeitfenster'
          }
        >
          {liste.map((zf) => (
            <ZeitfensterKarte
              key={zf.id}
              zeitfenster={zf}
              jetzt={jetzt}
              darfSchreiben={darfSchreiben}
              nachforderungenFrei={nachforderungenFrei}
              nachforderungName={(nfId) => nachforderungNamen.get(nfId)}
              onAusgabeErfassen={(x) => {
                ausgabeMut.reset();
                setDialog({ art: 'ausgabe', zf: x });
              }}
              onBearbeiten={(x) => {
                aendernMut.reset();
                setDialog({ art: 'bearbeiten', zf: x });
              }}
              onNachfordern={nachfordern}
              onLoeschen={(x) => {
                loeschenMut.reset();
                setDialog({ art: 'loeschen', zf: x });
              }}
              onZuruecknehmen={(a, x) => {
                ruecknahmeMut.reset();
                setDialog({ art: 'ruecknahme', zf: x, ausgabe: a });
              }}
            />
          ))}
        </section>
      )}

      {/* Dialoge je Ziel frisch montiert und AUSSERHALB der Karten (LFH-365): `initialValues`
          greift nur beim Einhängen, und der Speicher von rc-field-form überlebt sonst ein
          Schließen (CLAUDE.md, B4). */}
      {dialog?.art === 'anlegen' && (
        <ZeitfensterDialog
          modus={{ art: 'anlegen', onErfassen: (body) => anlegenMut.mutateAsync(body) }}
          einsatzId={einsatzId}
          benutzer={benutzer}
          overrides={overrides}
          jetzt={jetzt}
          laeuft={anlegenMut.isPending}
          fehler={anlegenMut.error}
          onSchliessen={schliesse}
        />
      )}
      {dialog?.art === 'bearbeiten' && (
        <ZeitfensterDialog
          key={`b-${dialog.zf.id}`}
          modus={{
            art: 'bearbeiten',
            zeitfenster: dialog.zf,
            onErfassen: (patch) => aendernMut.mutateAsync({ zfId: dialog.zf.id, patch }),
          }}
          einsatzId={einsatzId}
          benutzer={benutzer}
          overrides={overrides}
          jetzt={jetzt}
          laeuft={aendernMut.isPending}
          fehler={aendernMut.error}
          onSchliessen={schliesse}
        />
      )}
      {dialog?.art === 'ausgabe' && (
        <AusgabeDialog
          key={`a-${dialog.zf.id}`}
          zeitfenster={alle.find((zf) => zf.id === dialog.zf.id) ?? dialog.zf}
          nachforderungen={nachforderungOptionen}
          laeuft={ausgabeMut.isPending}
          fehler={ausgabeMut.error}
          onErfassen={(body) => ausgabeMut.mutateAsync({ zf: dialog.zf, body })}
          onSchliessen={schliesse}
        />
      )}
      {dialog?.art === 'ruecknahme' && (
        <RuecknahmeDialog
          ausgabe={dialog.ausgabe}
          zeitfenster={dialog.zf}
          laeuft={ruecknahmeMut.isPending}
          fehler={ruecknahmeMut.error}
          onBestaetigen={() => ruecknahmeMut.mutate(dialog.ausgabe.id)}
          onSchliessen={schliesse}
        />
      )}
      {dialog?.art === 'loeschen' && (
        <LoeschenDialog
          zeitfenster={dialog.zf}
          laeuft={loeschenMut.isPending}
          fehler={loeschenMut.error}
          onBestaetigen={() => loeschenMut.mutate(dialog.zf)}
          onSchliessen={schliesse}
        />
      )}
    </EinsatzSeite>
  );
}
