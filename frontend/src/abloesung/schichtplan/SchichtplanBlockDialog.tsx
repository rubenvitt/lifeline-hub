import { Button, Collapse, Form, Input, InputNumber, Popconfirm, Typography } from 'antd';
import { Select } from '../../components/Select';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { SCHICHTPLAN_NOTIZ_MAX, SCHICHTPLAN_PERSONEN_MAX } from '../../api/eingabegrenzen';
import type {
  QualiSollEintrag,
  SchichtplanBlock,
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanPersonEingabe,
} from '../../api/types';
import { ZeitraumEingabe, type Zeitraum } from '../../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { ErfassungsModal, type Speicherung } from '../../components/Erfassung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { mitVorgabe } from '../../components/vorgabeText';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import QualiSollFeld, { vollstaendig, type QualiSollZeile } from '../../kraefte/QualiSollFeld';
import { gleichesQualiSoll, qualiSollEingabe, qualiSollText } from '../../kraefte/qualiSoll';
import type { RasterZeile } from './raster';
import { MINDEST_MS } from './raster';
import {
  befundText,
  eingabeSchluessel,
  lueckeText,
  PAUSE,
  PERSONEN_GRUPPEN,
  personEingabe,
  postenEingabe,
  postenSchluessel,
  type PersonOption,
} from './schichtplanZeilen';

/**
 * Der Blockdialog des Schichtplans (LLH-1554): der Weg ohne Ziehen, für Tastatur und Telefon.
 * Feldbudget wie im Konzept: Posten, Zeit, Personen, Soll; die Notiz eingeklappt. Ein neuer Block
 * ohne Soll übernimmt die Vorgabe des Postens (Server); der Platzhalter nennt sie.
 *
 * Beim Ändern gehen nur die geänderten Felder hinaus (PATCH mit `version`); ein veralteter Stand
 * ist 409 und steht als Fehler im Dialog.
 *
 * LLH-1584: Das Qualifikationssoll steht eingeklappt wie die Notiz, sein Wert im Kopf; beim
 * Anlegen gilt leer die Vorgabe des Postens (Einheit bzw. Typ, UHS), die der Kopf nennt.
 * „Als nächsten Block kopieren“ legt am Ende des Blocks einen gleich langen an, mit Soll und ohne
 * Personen; mit ungespeicherten Änderungen ist der Knopf gesperrt, damit klar bleibt, welcher
 * Stand kopiert wird.
 */

export interface BlockWerte {
  posten: string;
  zeit: Zeitraum | null;
  personen: string[];
  soll?: number | null;
  quali?: QualiSollZeile[];
  notiz?: string;
}

export type BlockSpeichern =
  | { art: 'anlegen'; body: SchichtplanBlockBody }
  | { art: 'aendern'; blockId: number; body: SchichtplanBlockAendernBody };

interface SchichtplanBlockDialogProps {
  /** Der Block beim Ändern; ohne wird angelegt. */
  block: SchichtplanBlock | null;
  /** Beim Anlegen vorbelegt (Zeile und Zeit). */
  vorbelegt?: { zeile?: string; von?: number; bis?: number };
  zeilen: readonly RasterZeile[];
  /** Wen man einteilen kann; `null` lädt noch. */
  personen: readonly PersonOption[] | null;
  /** Grund, warum keine Personen gewählt werden können (Modul Personal). */
  personenGesperrt?: string;
  /** Soll-Anzahl, die ein Posten ohne eigene Angabe gibt. */
  sollVorgabe: ReadonlyMap<string, number | null>;
  /** Qualifikationssoll, das ein Posten ohne eigene Angabe gibt (LLH-1553). */
  qualiVorgabe: ReadonlyMap<string, readonly QualiSollEintrag[] | null>;
  qualiNamen: ReadonlyMap<number, string>;
  darfSchreiben: boolean;
  laeuft: boolean;
  speicherung: Speicherung;
  loeschenLaeuft?: boolean;
  /** Ablehnung des Löschens (etwa 409 bei einem veralteten Stand). */
  loeschFehler?: unknown;
  onSpeichern: (s: BlockSpeichern) => Promise<unknown>;
  onLoeschen?: (block: SchichtplanBlock) => void;
  /** „Als nächsten Block kopieren“; ohne gibt es den Knopf nicht. */
  onKopieren?: (block: SchichtplanBlock) => void;
  kopierenLaeuft?: boolean;
  /** Ablehnung der Kopie (etwa 422, der Folgeplatz ist belegt). */
  kopierFehler?: unknown;
  onSchliessen: () => void;
}

function zeitraumGueltig(z: Zeitraum | null | undefined): z is [Dayjs, Dayjs] {
  return !!z && !!z[0] && !!z[1];
}

export default function SchichtplanBlockDialog({
  block,
  vorbelegt,
  zeilen,
  personen,
  personenGesperrt,
  sollVorgabe,
  qualiVorgabe,
  qualiNamen,
  darfSchreiben,
  laeuft,
  speicherung,
  loeschenLaeuft,
  loeschFehler,
  onSpeichern,
  onLoeschen,
  onKopieren,
  kopierenLaeuft,
  kopierFehler,
  onSchliessen,
}: SchichtplanBlockDialogProps) {
  const [form] = Form.useForm<BlockWerte>();
  const posten =
    Form.useWatch('posten', form) ?? (block ? postenSchluessel(block.posten) : vorbelegt?.zeile);
  const istPause = posten === PAUSE;

  const anfang: BlockWerte = useMemo(() => {
    if (block) {
      return {
        posten: postenSchluessel(block.posten),
        zeit: [alsZeitpunkt(block.von) ?? null, alsZeitpunkt(block.bis) ?? null],
        personen: (block.personen ?? []).flatMap((p) => {
          const e = personEingabe(p);
          return e ? [eingabeSchluessel(e)] : [];
        }),
        soll: block.soll_anzahl ?? null,
        quali: qualiSollEingabe(block.quali_soll),
        notiz: block.notiz ?? '',
      };
    }
    return {
      posten: vorbelegt?.zeile ?? (undefined as unknown as string),
      zeit:
        vorbelegt?.von != null && vorbelegt.bis != null
          ? [dayjs(vorbelegt.von), dayjs(vorbelegt.bis)]
          : null,
      personen: [],
      soll: undefined,
      quali: [],
      notiz: '',
    };
  }, [block, vorbelegt]);

  // Die Auswahl: alle Kandidaten, dazu wer schon im Block steht und nicht mehr in der Liste ist.
  const personenOptionen = useMemo(() => {
    const bekannt = new Set((personen ?? []).map((p) => p.schluessel));
    const fremde = (block?.personen ?? []).flatMap((p) => {
      const e = personEingabe(p);
      if (!e) return [];
      const s = eingabeSchluessel(e);
      return bekannt.has(s) ? [] : [{ value: s, label: p.name }];
    });
    const gruppen = PERSONEN_GRUPPEN.map((g) => ({
      label: g.titel,
      title: g.titel,
      options: (personen ?? [])
        .filter((p) => p.gruppe === g.gruppe)
        .map((p) => ({ value: p.schluessel, label: p.name })),
    })).filter((g) => g.options.length > 0);
    return fremde.length
      ? [{ label: 'Eingeteilt', title: 'Eingeteilt', options: fremde }, ...gruppen]
      : gruppen;
  }, [personen, block]);

  const eingabeVon = useMemo(() => {
    const m = new Map((personen ?? []).map((p) => [p.schluessel, p.eingabe]));
    for (const p of block?.personen ?? []) {
      const e = personEingabe(p);
      if (e) m.set(eingabeSchluessel(e), e);
    }
    return m;
  }, [personen, block]);

  const postenOptionen = zeilen.map((z) => ({
    value: z.schluessel,
    label: z.gruppe ? `${z.titel} · ${z.gruppe}` : z.titel,
  }));

  const vorgabe = posten != null ? sollVorgabe.get(posten) : undefined;
  const sollPlatzhalter =
    block != null ? 'kein Soll' : vorgabe != null ? mitVorgabe(String(vorgabe)) : 'kein Soll';

  // Qualifikationssoll: der Kopf der eingeklappten Zeile nennt den Wert, beim Anlegen ohne
  // eigenen Wert die Vorgabe des Postens.
  const quali = Form.useWatch('quali', form) ?? anfang.quali;
  const qualiEigen = vollstaendig(quali);
  const qualiVorgabeText =
    block == null && posten != null ? qualiSollText(qualiVorgabe.get(posten)) : '';
  const qualiKopf =
    qualiEigen.length > 0
      ? qualiSollText(
          qualiEigen.map((e) => ({
            ...e,
            label:
              qualiNamen.get(e.qualifikation_id) ??
              block?.quali_soll?.find((q) => q.qualifikation_id === e.qualifikation_id)?.label ??
              '?',
          })),
        )
      : qualiVorgabeText
        ? mitVorgabe(qualiVorgabeText)
        : '';

  const personenAus = (w: BlockWerte): SchichtplanPersonEingabe[] | undefined =>
    personenGesperrt
      ? undefined
      : (w.personen ?? []).flatMap((s) => {
          const e = eingabeVon.get(s);
          return e ? [e] : [];
        });

  /** Nur Geändertes (frontend/AGENTS.md, „Bearbeiten in der Ansicht“, Punkt 4). */
  const aenderungAus = (
    b: SchichtplanBlock,
    w: BlockWerte,
    von: string,
    bis: string,
  ): SchichtplanBlockAendernBody => {
    const body: SchichtplanBlockAendernBody = { version: b.version };
    const p = postenEingabe(w.posten);
    if (p && w.posten !== anfang.posten) body.posten = p;
    if (von !== b.von) body.von = von;
    if (bis !== b.bis) body.bis = bis;
    const personenEingaben = personenAus(w);
    if (personenEingaben && (w.personen ?? []).join('|') !== anfang.personen.join('|'))
      body.personen = personenEingaben;
    const pause = w.posten === PAUSE;
    if (pause && b.soll_anzahl != null) body.soll_anzahl = null;
    else if (!pause && (w.soll ?? null) !== (b.soll_anzahl ?? null))
      body.soll_anzahl = w.soll ?? null;
    // An die Pause räumt der Server das Qualifikationssoll selbst.
    const qualiNeu = vollstaendig(w.quali);
    if (!pause && !gleichesQualiSoll(qualiNeu, qualiSollEingabe(b.quali_soll)))
      body.quali_soll = qualiNeu.length > 0 ? qualiNeu : null;
    const notiz = w.notiz?.trim() ?? '';
    if (notiz !== (b.notiz ?? '')) body.notiz = notiz || null;
    return body;
  };

  const speichern = (w: BlockWerte) => {
    if (!zeitraumGueltig(w.zeit)) return Promise.reject(new Error('Zeit fehlt'));
    const p = postenEingabe(w.posten);
    if (!p) return Promise.reject(new Error('Posten fehlt'));
    const von = alsBackendZeit(w.zeit[0]);
    const bis = alsBackendZeit(w.zeit[1]);
    const pause = w.posten === PAUSE;
    if (!block) {
      const body: SchichtplanBlockBody = { posten: p, von, bis };
      const personenEingaben = personenAus(w);
      if (personenEingaben?.length) body.personen = personenEingaben;
      if (pause) body.soll_anzahl = null;
      else {
        if (w.soll != null) body.soll_anzahl = w.soll;
        // Leer = Vorgabe des Postens (Server); nur ein eigenes Soll geht hinaus.
        const qualiNeu = vollstaendig(w.quali);
        if (qualiNeu.length > 0) body.quali_soll = qualiNeu;
      }
      const notiz = w.notiz?.trim();
      if (notiz) body.notiz = notiz;
      return onSpeichern({ art: 'anlegen', body });
    }
    const body = aenderungAus(block, w, von, bis);
    if (Object.keys(body).length === 1) return Promise.resolve();
    return onSpeichern({ art: 'aendern', blockId: block.id, body });
  };

  // Ungespeichertes sperrt die Kopie: kopiert wird der gespeicherte Stand.
  const werte = Form.useWatch((v: BlockWerte) => v, form);
  const geaendert = (() => {
    if (!block || !werte) return false;
    const z = werte.zeit === undefined ? anfang.zeit : werte.zeit;
    if (!zeitraumGueltig(z)) return true;
    // Eine Qualifikationszeile ohne Qualifikation fiele beim Speichern weg, ist aber Eingabe.
    if (werte.quali?.some((q) => q.qualifikation_id == null)) return true;
    const body = aenderungAus(
      block,
      { ...anfang, ...werte },
      alsBackendZeit(z[0]),
      alsBackendZeit(z[1]),
    );
    return Object.keys(body).length > 1;
  })();

  const titel = block ? `Block ${block.posten.bezeichnung ?? 'Pause'}` : 'Block anlegen';
  const luecke = block ? lueckeText(block, qualiNamen) : null;
  const befunde = block
    ? [
        ...block.befunde.map((b) => befundText(b, qualiNamen)),
        ...(block.personen ?? []).flatMap((p) =>
          p.befunde.map((b) => befundText(b, qualiNamen, p.name)),
        ),
      ]
    : [];

  return (
    <ErfassungsModal<BlockWerte>
      offen
      titel={titel}
      form={form}
      initialValues={anfang}
      erfassenText={block ? 'Speichern' : 'Block anlegen'}
      laeuft={laeuft}
      gesperrt={!darfSchreiben}
      speicherung={speicherung}
      speicherFehlerTitel={block ? 'Block nicht gespeichert' : 'Block nicht angelegt'}
      onErfassen={speichern}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {(luecke || befunde.length > 0) && (
        <div data-lfh="schichtplan-block-befunde" style={{ marginBottom: 12 }}>
          {luecke && (
            <Typography.Text type="warning" style={{ display: 'block' }}>
              {luecke}
            </Typography.Text>
          )}
          {befunde.map((t) => (
            <Typography.Text key={t} type="danger" style={{ display: 'block' }}>
              {t}
            </Typography.Text>
          ))}
        </div>
      )}
      <Form.Item<BlockWerte>
        name="posten"
        label="Posten"
        rules={[{ required: true, message: 'Bitte einen Posten wählen' }]}
      >
        <Select placeholder="Posten wählen…" options={postenOptionen} />
      </Form.Item>
      <Form.Item<BlockWerte>
        name="zeit"
        label="Zeit"
        rules={[
          {
            validator: (_, z: Zeitraum | null) => {
              if (!zeitraumGueltig(z)) return Promise.reject(new Error('Beginn und Ende angeben'));
              if (z[1].valueOf() - z[0].valueOf() < MINDEST_MS)
                return Promise.reject(new Error('Mindestens 10 Minuten'));
              if (z[0].minute() % 5 !== 0 || z[1].minute() % 5 !== 0)
                return Promise.reject(new Error('Auf volle 5 Minuten'));
              return Promise.resolve();
            },
          },
        ]}
      >
        <ZeitraumEingabe art="frist" />
      </Form.Item>
      <Form.Item<BlockWerte>
        name="personen"
        label="Personen"
        extra={personenGesperrt}
        rules={[
          {
            type: 'array',
            max: SCHICHTPLAN_PERSONEN_MAX,
            message: `Höchstens ${SCHICHTPLAN_PERSONEN_MAX} Personen`,
          },
        ]}
      >
        <Select
          mode="multiple"
          disabled={personenGesperrt != null}
          loading={personen == null && personenGesperrt == null}
          placeholder={personenGesperrt ? '—' : 'unbesetzt'}
          options={personenOptionen}
        />
      </Form.Item>
      {!istPause && (
        <Form.Item<BlockWerte> name="soll" label="Soll">
          <InputNumber
            min={0}
            max={SCHICHTPLAN_PERSONEN_MAX}
            precision={0}
            placeholder={sollPlatzhalter}
            style={{ width: '100%' }}
          />
        </Form.Item>
      )}
      <Collapse
        ghost
        items={[
          ...(istPause
            ? []
            : [
                {
                  key: 'quali',
                  label: qualiKopf ? `Qualifikationssoll · ${qualiKopf}` : 'Qualifikationssoll',
                  forceRender: true,
                  children: (
                    <Form.Item<BlockWerte> name="quali" label="Qualifikationssoll">
                      <QualiSollFeld
                        disabled={!darfSchreiben}
                        bekannt={block?.quali_soll ?? (posten ? qualiVorgabe.get(posten) : null)}
                      />
                    </Form.Item>
                  ),
                },
              ]),
          {
            key: 'notiz',
            label: block?.notiz ? 'Notiz · vorhanden' : 'Notiz',
            forceRender: true,
            children: (
              <Form.Item<BlockWerte>
                name="notiz"
                label="Notiz"
                rules={[zeichenRegel(SCHICHTPLAN_NOTIZ_MAX, 'Notiz')]}
              >
                <Input.TextArea rows={2} count={zeichenGrenze(SCHICHTPLAN_NOTIZ_MAX)} />
              </Form.Item>
            ),
          },
        ]}
      />
      {loeschFehler != null && (
        <SpeicherFehler fehler={loeschFehler} titel="Block nicht gelöscht" />
      )}
      {kopierFehler != null && <SpeicherFehler fehler={kopierFehler} titel="Block nicht kopiert" />}
      {block && onKopieren && darfSchreiben && (
        <Button
          data-lfh="schichtplan-block-kopieren"
          loading={kopierenLaeuft}
          disabled={geaendert}
          onClick={() => onKopieren(block)}
          style={{ marginTop: 8, marginInlineEnd: 8 }}
        >
          Als nächsten Block kopieren
        </Button>
      )}
      {block && onLoeschen && darfSchreiben && (
        <Popconfirm
          title="Block löschen?"
          okText="Block löschen"
          cancelText="Behalten"
          okButtonProps={{ danger: true }}
          onConfirm={() => onLoeschen(block)}
        >
          <Button danger loading={loeschenLaeuft} style={{ marginTop: 8 }}>
            Block löschen
          </Button>
        </Popconfirm>
      )}
    </ErfassungsModal>
  );
}
