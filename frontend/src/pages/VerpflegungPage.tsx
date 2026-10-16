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
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import type {
  VerpflegungAusgabe,
  Verpflegungsstelle,
  VerpflegungsstelleEingabe,
  VerpflegungsstellePatch,
  VerpflegungsstelleStatus,
  VerpflegungZeitfenster,
  ZeitfensterEingabe,
  ZeitfensterPatch,
} from '../api/types';
import {
  aendereZeitfenster,
  createStelle,
  ladeVerpflegung,
  legeZeitfensterAn,
  loescheZeitfenster,
  nimmAusgabeZurueck,
  setStelleStatus,
  storniereStelle,
  updateStelle,
} from '../api/verpflegung';
import { useAuth } from '../auth/AuthContext';
import { useGeraetDarf } from '../geraet/geraetSicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { SeitenLeer } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { Sammelbanner, sammelbannerKurz, Segmentleiste, useRollen } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useVorgemerkteAusgaben, type VorgemerkteAusgabe } from '../offline/useVorgemerkteAusgaben';
import { geraetMeldungenPfad, nachforderungenPfad } from '../routing/deeplinks';
import {
  AusgabeDialog,
  LoeschenDialog,
  RuecknahmeDialog,
  ZeitfensterDialog,
} from '../verpflegung/VerpflegungDialoge';
import { StelleDialog } from '../verpflegung/StelleDialog';
import StellenListe from '../verpflegung/StellenListe';
import { offeneStellenAnzahl } from '../verpflegung/stellenKern';
import ZeitfensterKarte from '../verpflegung/ZeitfensterKarte';
import { deckungEinstufung, istVergangen } from '../verpflegung/deckung';
import { useAusgabeNachtragen } from '../verpflegung/useAusgabeNachtragen';
import { useNachforderungWahl } from '../verpflegung/useNachforderungWahl';
import {
  meldungVorbelegung,
  nachforderungVorbelegung,
  zitat,
} from '../verpflegung/verpflegungText';
import { einsatzRechteGrund } from '../components/nurAnsicht';

/** Grund der fehlenden Schreibberechtigung (`components/nurAnsicht.ts`). */
const verpflegungRechteText = einsatzRechteGrund;

/**
 * Sortierschlüssel der Zeitfenster für die Zufluss-Schleuse: der Beginn, wie der Server ordnet
 * (`ORDER BY von_at, id`). Verschiebt eine andere Person den Beginn, bleibt die gezeigte Folge
 * stehen, bis das Banner bedient wird.
 */
const BEGINN: Sortierschluessel<VerpflegungZeitfenster> = (zf) => zf.von_at;

/**
 * „1 neues Zeitfenster, davon 1 mit Unterdeckung" — der Wortlaut des Sammelbanners; bei einer
 * fremden Umordnung zusätzlich „Reihenfolge geändert".
 */
function zuflussText(
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

/** Zwei Zeitfenster-Ansichten und die Stellen (LLH-1040, D13 Punkt 1): EINE Leiste. */
type Ansicht = 'laufend' | 'vergangen' | 'stellen';

/** Erfolgswort je Zielstatus einer Stelle. */
const STELLE_STATUS_ERFOLG: Record<VerpflegungsstelleStatus, string> = {
  geplant: 'geplant',
  aktiv: 'in Betrieb genommen',
  aufgeloest: 'aufgelöst',
};

type Dialog =
  | { art: 'anlegen' }
  | { art: 'bearbeiten'; zf: VerpflegungZeitfenster }
  | { art: 'ausgabe'; zf: VerpflegungZeitfenster }
  | { art: 'ruecknahme'; zf: VerpflegungZeitfenster; ausgabe: VerpflegungAusgabe }
  | { art: 'loeschen'; zf: VerpflegungZeitfenster }
  | { art: 'stelle-anlegen' }
  | { art: 'stelle-bearbeiten'; stelle: Verpflegungsstelle };

/**
 * Fachmodul Verpflegung (LFH-634): Zeitfenster mit Bedarf, Ausgaben und Deckung.
 *
 * Form: eine Liste, keine Tabelle — die Frage ist „was ist mit diesem Zeitfenster?", die Ordnung
 * ist die Zeit (`von_at`, vom Server). Die Segmentleiste trennt „laufend & anstehend" (`bis ≥
 * jetzt`, Vorgabe) von „vergangen".
 *
 * Live-Zufluss (Muster Ablösung, `abloesung/zufluss.ts`): ein fremdes neues Zeitfenster landet an
 * seinem Platz in der Zeitordnung, auch oberhalb des Cursors; es wartet deshalb hinter dem
 * Sammelbanner, eigene stehen sofort. Die Schleuse läuft über alle Zeitfenster, nicht je Ansicht:
 * ein Zeitfenster, das mit der Uhr nach „vergangen" wandert, ist kein Neuzugang. Das Banner zählt
 * nur die Zurückgehaltenen der gezeigten Ansicht; ein Ansichtswechsel gibt alle frei. Geänderte
 * Mengen an bestehenden Karten fließen direkt ein.
 *
 * Das Banner nimmt keine eigene Zeile: es steht in der immer gerenderten Werkzeugzeile, deren Höhe
 * es nicht ändert. Auf dem Handschirm (unter `md`) trägt die Zeile Satz und Knopf nicht (LFH-694:
 * 0 px Text, im Handschuh-Betrieb 59 px Überlauf). Dort heißt das erste Segment „aktuell (n)“, und
 * das Banner steht als Kurzform „1 neu" in einem Knopf; der volle Satz bleibt für Hilfstechnik im
 * Status. Gemessen in `e2e/gate1-ueberlauf.spec.ts`.
 *
 * Die Uhr tickt alle 30 s (`useUhr`): Einstufung und Trennung „vergangen" laufen ohne Abruf mit.
 * Nichts blinkt.
 *
 * Kopfzahlen rechnen mit der vollen Menge, auch solange ein Neuzugang hinter dem Banner wartet.
 *
 * Der dritte Wert der Leiste zeigt die Verpflegungsstellen (LLH-1040, `verpflegung/StellenListe`);
 * dort heißt die Primäraktion „Stelle anlegen“, und das Banner der Zeitfenster schweigt. Die Stellen
 * kommen mit derselben Übersicht (`GET …/verpflegung`), es gibt keinen eigenen Abruf.
 *
 * Auf dem Verpflegungsgerät (LFH-1044) dieselbe Seite ohne Planen (Zeitfenster anlegen, Bedarf
 * ändern, löschen) und ohne Brotkrumen; eine Fehlmenge geht als Meldung an die Einsatzleitung,
 * nicht als Nachforderung.
 */
export default function VerpflegungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer, geraet } = useAuth();
  const darf = useGeraetDarf();
  const planen = darf('verpflegung-planen');
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr();
  const { istSchmal } = useViewport();

  const [ansicht, setAnsicht] = useState<Ansicht>('laufend');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // An den Einsatz gebunden: wechselt die Route den Einsatz bei stehender Komponente, wären sonst
  // alle Zeitfenster des neuen Einsatzes „fremde Neuzugänge".
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
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const freigaben = freigabenQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatzQuery.data);

  // Nachforderungen nur bei bedienbarem Modul und bekannten Freigaben; ein 403 bleibt still.
  const {
    frei: nachforderungenFrei,
    namen: nachforderungNamen,
    optionen: nachforderungOptionen,
  } = useNachforderungWahl(einsatzId, freigaben);

  const alle = useMemo(() => verpflegungQuery.data?.zeitfenster ?? [], [verpflegungQuery.data]);
  const stellen = useMemo(() => verpflegungQuery.data?.stellen ?? [], [verpflegungQuery.data]);
  const stellenAnsicht = ansicht === 'stellen';
  // Abschnitte nur für die offene Stellenmaske; ohne Modulzugriff bleibt das Feld weg.
  const abschnitteLesbar = freigaben?.einsatzabschnitte?.zugriff !== false;
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled:
      abschnitteLesbar && (dialog?.art === 'stelle-anlegen' || dialog?.art === 'stelle-bearbeiten'),
  });
  const abschnittOptionen = useMemo(
    () =>
      abschnitteLesbar
        ? (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))
        : null,
    [abschnitteLesbar, abschnitteQuery.data],
  );
  // Auf diesem Gerät vorgemerkte Ausgaben je Zeitfenster — „ausstehend“, außerhalb der Deckung
  // (LFH-688, design.md D8).
  const vorgemerkt = useVorgemerkteAusgaben(benutzer?.id, einsatzId);
  const ausstehendJe = useMemo(() => {
    const je = new Map<number, VorgemerkteAusgabe[]>();
    for (const v of vorgemerkt) {
      const liste = je.get(v.aktion.zeitfenster_id) ?? [];
      liste.push(v);
      je.set(v.aktion.zeitfenster_id, liste);
    }
    return je;
  }, [vorgemerkt]);

  // ── Live-Zufluss ────────────────────────────────────────────────────────────────────
  const zufluss: Zuflussstand =
    zuflussZustand.einsatzId === einsatzId ? zuflussZustand : LEERER_ZUFLUSSSTAND;
  const geteilt = teileZuflussNach(alle, zufluss, BEGINN);
  const umgeordnet = !stellenAnsicht && geteilt.umgeordnet;
  const inAnsicht = (zf: VerpflegungZeitfenster) =>
    istVergangen(zf, jetzt) === (ansicht === 'vergangen');
  let sichtbar = geteilt.sichtbar;
  // In der Ansicht „Stellen“ hält nichts zurück: dort steht keine Zeitfensterkarte.
  let zurueckgehalten = stellenAnsicht ? [] : geteilt.zurueckgehalten.filter(inAnsicht);
  // Null gezeigte Karten in dieser Ansicht halten nichts zurück: ein Leerzustand neben „1 neues
  // Zeitfenster" wäre ein Widerspruch.
  if (zurueckgehalten.length > 0 && !sichtbar.some(inAnsicht)) {
    const frei = new Set(zurueckgehalten.map((zf) => zf.id));
    sichtbar = alle.filter((zf) => frei.has(zf.id) || sichtbar.includes(zf));
    zurueckgehalten = [];
  }
  // Nachführen im Render (Muster Ablösung): `nachgefuehrt` liefert `null`, wenn nichts zu tun ist —
  // der Riegel gegen die Schleife.
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

  // Fehler stehen im jeweiligen Dialog (SpeicherFehler); `mutateAsync` lehnt ab, die Hülle lässt
  // die Felder stehen.
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
  // Stellen (LLH-1040, D2): Anlegen und Ändern schreiben kein ETB, ein Statuswechsel schon (D7);
  // Storno nicht.
  const stelleAnlegenMut = useMutation({
    mutationFn: (body: VerpflegungsstelleEingabe) => createStelle(einsatzId, body),
    onSuccess: (s) => {
      invalidiere(false);
      message.success(`Stelle ${zitat(s.bezeichnung)} angelegt`);
    },
  });
  const stelleAendernMut = useMutation({
    mutationFn: ({ sid, patch }: { sid: number; patch: VerpflegungsstellePatch }) =>
      updateStelle(einsatzId, sid, patch),
    onSuccess: (s) => {
      invalidiere(false);
      message.success(`Stelle ${zitat(s.bezeichnung)} gespeichert`);
    },
  });
  // Gründe an der Zeile bzw. in der Rückfrage (`StellenListe`), nie als Toast.
  const stelleStatusMut = useMutation({
    mutationFn: ({ s, status }: { s: Verpflegungsstelle; status: VerpflegungsstelleStatus }) =>
      setStelleStatus(einsatzId, s.id, status),
    onSuccess: (s) => {
      invalidiere(true);
      message.success(`Stelle ${zitat(s.bezeichnung)} ${STELLE_STATUS_ERFOLG[s.status]}`);
    },
  });
  const stelleStornoMut = useMutation({
    mutationFn: (s: Verpflegungsstelle) => storniereStelle(einsatzId, s.id),
    onSuccess: (_, s) => {
      invalidiere(false);
      message.success(`Stelle ${zitat(s.bezeichnung)} storniert`);
    },
  });
  // Nachtragen samt Rückgängig- und Vormerk-Hinweis, geteilt mit der Ausgabeansicht (LLH-1032).
  const nachtrag = useAusgabeNachtragen(einsatzId);
  const ruecknahmeFehler = nachtrag.ruecknahmeFehler;
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
  const oeffneZeitfensterAnlegen = () => {
    anlegenMut.reset();
    setDialog({ art: 'anlegen' });
  };
  const oeffneStelleAnlegen = () => {
    stelleAnlegenMut.reset();
    setDialog({ art: 'stelle-anlegen' });
  };
  const oeffneAnlegen = stellenAnsicht ? oeffneStelleAnlegen : oeffneZeitfensterAnlegen;
  const nachfordern = (zf: VerpflegungZeitfenster) => {
    if (geraet) {
      const inhalt = meldungVorbelegung(zf, konventionen);
      if (inhalt) void navigate(geraetMeldungenPfad(einsatzId, { inhalt }));
      return;
    }
    const vorbelegung = nachforderungVorbelegung(zf, konventionen);
    if (vorbelegung) void navigate(nachforderungenPfad(einsatzId, { vorbelegung }));
  };

  return (
    <EinsatzSeite
      titel={modulName('verpflegung')}
      meta={`${alle.length} Zeitfenster · ${unterdeckung} mit Unterdeckung`}
      dataUpdatedAt={verpflegungQuery.dataUpdatedAt}
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: modulName('verpflegung') },
            ]}
          />
        )
      }
      // Gesperrt statt versteckt: der Hinweis darunter nennt den Grund.
      aktionen={
        planen && (
          <Button type="primary" disabled={!darfSchreiben} onClick={oeffneAnlegen}>
            {stellenAnsicht ? 'Stelle anlegen' : 'Zeitfenster anlegen'}
          </Button>
        )
      }
      neueZeile={darfSchreiben && planen ? oeffneAnlegen : undefined}
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (!darfSchreiben || ruecknahmeFehler != null) && (
          <SeitenHinweise
            rechteFehlt={!darfSchreiben}
            rechteText={verpflegungRechteText(einsatz.status)}
            fehler={ruecknahmeFehler}
            fehlerTitel="Nicht zurückgenommen"
            fehlerFallback="Rücknahme fehlgeschlagen"
          />
        )
      }
    >
      {/* Werkzeugzeile: immer gerendert, `nowrap`, Mindesthöhe = Steuerhöhe + 2 px Rahmen. Das
          Banner ändert ihre Höhe nicht, also verschiebt es keine Karte. */}
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
              label: `${istSchmal ? 'aktuell' : 'laufend & anstehend'} (${alle.length - vergangen.length})`,
            },
            { wert: 'vergangen', label: `vergangen (${vergangen.length})` },
            { wert: 'stellen', label: `Stellen (${offeneStellenAnzahl(stellen)})` },
          ]}
          style={{ flex: 'none' }}
        />
        {(zurueckgehalten.length > 0 || umgeordnet) && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: gibFrei }}
            kurz={istSchmal ? sammelbannerKurz(zurueckgehalten.length, umgeordnet) : undefined}
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
          title="Verpflegung konnte nicht geladen werden"
        />
      )}
      {verpflegungQuery.isLoading ? (
        <Spin />
      ) : stellenAnsicht ? (
        <StellenListe
          einsatzId={einsatzId}
          stellen={stellen}
          zeitfenster={alle}
          jetzt={jetzt}
          darfPlanen={darfSchreiben && planen}
          mitOrt={darf('fremde-module')}
          onAnlegen={oeffneStelleAnlegen}
          onBearbeiten={(s) => {
            stelleAendernMut.reset();
            setDialog({ art: 'stelle-bearbeiten', stelle: s });
          }}
          onStatus={(s, status) => stelleStatusMut.mutateAsync({ s, status })}
          onStornieren={(s) => stelleStornoMut.mutateAsync(s)}
        />
      ) : alle.length === 0 ? (
        <SeitenLeer
          titel="Noch kein Zeitfenster"
          aktion={
            darfSchreiben && planen
              ? { label: 'Zeitfenster anlegen', onClick: oeffneZeitfensterAnlegen }
              : undefined
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
              onAusgabeNachtragen={(x) => {
                nachtrag.zuruecksetzen();
                setDialog({ art: 'ausgabe', zf: x });
              }}
              onBearbeiten={
                planen
                  ? (x) => {
                      aendernMut.reset();
                      setDialog({ art: 'bearbeiten', zf: x });
                    }
                  : undefined
              }
              onNachfordern={nachfordern}
              nachschub={geraet ? 'melden' : 'nachfordern'}
              onLoeschen={
                planen
                  ? (x) => {
                      loeschenMut.reset();
                      setDialog({ art: 'loeschen', zf: x });
                    }
                  : undefined
              }
              onZuruecknehmen={(a, x) => {
                ruecknahmeMut.reset();
                setDialog({ art: 'ruecknahme', zf: x, ausgabe: a });
              }}
              ausstehend={ausstehendJe.get(zf.id)}
            />
          ))}
        </section>
      )}

      {/* Dialoge je Ziel frisch montiert und außerhalb der Karten: `initialValues` greift nur
          beim Einhängen, und der Speicher von rc-field-form überlebt sonst ein Schließen. */}
      {dialog?.art === 'anlegen' && (
        <ZeitfensterDialog
          modus={{ art: 'anlegen', onErfassen: (body) => anlegenMut.mutateAsync(body) }}
          einsatzId={einsatzId}
          freigaben={freigaben}
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
          freigaben={freigaben}
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
          laeuft={nachtrag.laeuft}
          fehler={nachtrag.fehler}
          onErfassen={(body) => nachtrag.nachtragen(dialog.zf, body)}
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
      {dialog?.art === 'stelle-anlegen' && (
        <StelleDialog
          modus={{ art: 'anlegen', onErfassen: (body) => stelleAnlegenMut.mutateAsync(body) }}
          einsatzId={einsatzId}
          abschnitte={abschnittOptionen}
          laeuft={stelleAnlegenMut.isPending}
          fehler={stelleAnlegenMut.error}
          onSchliessen={schliesse}
        />
      )}
      {dialog?.art === 'stelle-bearbeiten' && (
        <StelleDialog
          key={`s-${dialog.stelle.id}`}
          modus={{
            art: 'bearbeiten',
            stelle: dialog.stelle,
            onErfassen: (patch) => stelleAendernMut.mutateAsync({ sid: dialog.stelle.id, patch }),
          }}
          einsatzId={einsatzId}
          abschnitte={abschnittOptionen}
          laeuft={stelleAendernMut.isPending}
          fehler={stelleAendernMut.error}
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
