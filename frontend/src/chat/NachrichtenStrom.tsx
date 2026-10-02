import { Button, Modal, Popover, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BezugTyp, ChatNachricht } from '../api/types';
import { formatZeit, formatZeitKurz } from '../anzeige/format';
import DownloadAnker from '../components/DownloadAnker';
import { AnhangVorschauGruppe } from '../components/AnhangVorschau';
import { istBildMime, originalPfad } from '../api/anhangFassung';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { aktionsNamen } from './aktionsNamen';
import { StatusChip, monoStil } from '../components/instrument';
import type { BezugKurzinfo } from './bezug';
import { formatGroesse } from '../karten/formatGroesse';

/**
 * Restweg zum unteren Rand, der noch als „der Lesende steht unten" gilt.
 * Deutlich KLEINER als eine Nachrichtenzeile (kompakt ~50 px), sonst bekäme, wer eine
 * Nachricht zurückgeblättert hat, wieder den Sprung; etwas Luft braucht es gegen
 * Subpixel-Rundung.
 */
const TOLERANZ_UNTEN = 24;

/** Steht die Sicht (innerhalb der Toleranz) am unteren Rand des Stroms? */
function istAmBoden(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - TOLERANZ_UNTEN;
}

interface Props {
  nachrichten: ChatNachricht[];
  eigeneBenutzerId: number | null;
  darfSchreiben: boolean;
  onBearbeiten: (n: ChatNachricht) => void;
  onLoeschen: (n: ChatNachricht) => void;
  onHeraufstufen: (n: ChatNachricht) => void;
  onHeraufstufenAuftrag: (n: ChatNachricht) => void;
  /** Sachbezug setzen/ändern (LFH-103). Ohne diesen Callback wird kein Bezug-Button gezeigt. */
  onBezugSetzen?: (n: ChatNachricht) => void;
  /** Sachbezug lösen (LFH-103). */
  onBezugLoeschen?: (n: ChatNachricht) => void;
  /** Löst einen gesetzten Bezug zu einem Anzeige-Label auf. */
  bezugLabel?: (typ: BezugTyp, id: number) => string;
  /** Liefert die Kurzinfo für das Bezug-Popover; `null`, wenn das Objekt nicht
   *  (mehr) geladen/verfügbar ist. Ohne diesen Callback bleibt der Tag statisch. */
  bezugInfo?: (typ: BezugTyp, id: number) => BezugKurzinfo | null;
  /** Zähler der EIGENEN Absendungen. Jede Erhöhung holt die Sicht ans Ende zurück. */
  eigeneSendungen?: number;
  /** Ob an Bild-Anhängen der Original-Verweis steht (`darfOriginalLaden`, LFH-747). */
  darfOriginal?: boolean;
}

/**
 * Lesebreite einer Nachricht: begrenzt wird der TEXT (übliche Obergrenze 60–80 Zeichen), nicht
 * die Seite; Kanalspalte und Scroll-Container bleiben unberührt.
 */
const NACHRICHT_LESEBREITE = '72ch';

export default function NachrichtenStrom({
  nachrichten,
  eigeneBenutzerId,
  darfSchreiben,
  onBearbeiten,
  onLoeschen,
  onHeraufstufen,
  onHeraufstufenAuftrag,
  onBezugSetzen,
  onBezugLoeschen,
  bezugLabel,
  bezugInfo,
  eigeneSendungen = 0,
  darfOriginal = false,
}: Props) {
  const behaelter = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  // Die id der JÜNGSTEN Nachricht unterscheidet die beiden Wachstumsrichtungen (siehe Effekt
  // unten). `nachrichten` ist aufsteigend sortiert.
  const juengsteId = nachrichten.length > 0 ? nachrichten[nachrichten.length - 1].id : null;

  /**
   * „Steht der Lesende unten?" — als REF, gepflegt vom Scroll-Handler.
   * Nicht im Effekt an der jüngsten id messen: der läuft nach dem Commit, `scrollHeight` ist dann
   * schon gewachsen, und wer exakt unten stand, bekäme die Pille statt des Sprungs.
   * Scroll-Ereignisse tragen den Zustand VOR dem Zuwachs. Ein Ref, weil synchron im Effekt
   * gelesen und ohne Rendern je Scroll. Startwert `true`: erster Aufbau und Kanalwechsel
   * springen ans Ende.
   */
  const amBodenRef = useRef(true);

  /**
   * Die id, ab der gezählt wird — gesetzt an der Flanke „unten → nicht unten".
   * Über die ID statt eines Zählers: „Ältere laden" hängt vorne an und jeder Refetch ersetzt das
   * Array; `n.id > markeId` ist gegen beides immun.
   */
  const [markeId, setMarkeId] = useState<number | null>(null);
  /**
   * Die Nachricht, deren Löschen gerade nachgefragt wird (über ihre ID). Die Rückfrage ist EIN `<Modal>` außerhalb
   * der Zeilenschleife (LFH-365): eine Blase am Menüeintrag hielt das Menü per gestopptem Klick
   * offen und war der Grund für Knoten-Etiketten im Menü (LFH-683).
   */
  const [loeschFrageId, setLoeschFrageId] = useState<number | null>(null);
  /**
   * Aus der LIVE-Liste gelesen, nicht als Schnappschuss: wird die Nachricht gelöscht (anderer Tab,
   * Live-Ereignis), während der Dialog offen ist, schließt er, statt ein zweites DELETE zu senden.
   */
  const loeschZiel =
    loeschFrageId == null
      ? undefined
      : nachrichten.find((n) => n.id === loeschFrageId && n.geloescht_at === null);
  const namen = useMemo(() => aktionsNamen(nachrichten), [nachrichten]);
  const neueAnzahl = markeId === null ? 0 : nachrichten.filter((n) => n.id > markeId).length;

  /** Flankenwechsel am unteren Rand: Marke setzen bzw. räumen. */
  function beiScroll() {
    const el = behaelter.current;
    if (!el) return;
    const unten = istAmBoden(el);
    if (unten === amBodenRef.current) return;
    amBodenRef.current = unten;
    setMarkeId(unten ? null : juengsteId);
  }

  /** Klick auf die Pille: ans Ende springen und den Zähler räumen. */
  function zumEnde() {
    const el = behaelter.current;
    el?.scrollTo?.({ top: el.scrollHeight });
    amBodenRef.current = true;
    setMarkeId(null);
  }

  /**
   * Die eigene Absendung holt die Sicht zurück (die Eingabe liegt außerhalb des
   * Scroll-Containers). Unterschieden wird die ABSENDUNG, nicht der Autor: ein Riegel am Autor
   * spränge bei jeder fremden Nachricht desselben Kontos.
   * Der Effekt steht VOR dem Sprung-Effekt: laufen beide in derselben Commit-Runde, muss der
   * Merker stehen, bevor der Sprung ihn liest.
   */
  useEffect(() => {
    if (eigeneSendungen === 0) return;
    amBodenRef.current = true;
    setMarkeId(null);
  }, [eigeneSendungen]);

  /**
   * „Stick to bottom" — aber nur nach unten.
   * Der Strom wächst an zwei Enden: hinten durch neue Nachrichten, vorne durch „Ältere laden".
   * Ein Effekt auf `nachrichten.length` risse den Lesenden beim Nachladen aus seiner Stelle; die
   * jüngste id wächst nur im ersten Fall. Gesprungen wird nur, wenn der Lesende unten steht,
   * sonst erscheint die Pille. `scrollTo` optional, weil jsdom es auf Elementen nicht kennt.
   */
  useEffect(() => {
    if (juengsteId === null) return;
    const el = behaelter.current;
    // Ohne Überlauf gibt es keine Lesestelle und kein Scroll-Ereignis mehr, das den Merker
    // zurückstellt — ohne Rückstellung bliebe die Pille stehen. Hier ist Messen im Effekt richtig:
    // gefragt ist nur, ob es Überlauf gibt.
    if (el && el.scrollHeight <= el.clientHeight) {
      amBodenRef.current = true;
      setMarkeId(null);
    }
    if (!amBodenRef.current) return;
    el?.scrollTo?.({ top: el.scrollHeight });
  }, [juengsteId]);

  return (
    <div
      ref={behaelter}
      onScroll={beiScroll}
      data-testid="nachrichten-strom"
      // Eigener Scroll-Container, sonst wächst der Strom die Seite lang und die Eingabe wandert aus
      // dem Bild. `minHeight: 0` ist tragend: ein Flex-Kind schrumpft sonst nicht unter seinen Inhalt.
      style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
    >
      <Liste<ChatNachricht>
        dataSource={nachrichten}
        emptyText="Noch keine Nachrichten"
        renderItem={(n) => {
          const geloescht = n.geloescht_at !== null;
          const eigene = eigeneBenutzerId !== null && n.autor_id === eigeneBenutzerId;
          const heraufgestuft = n.etb_eintrag_id !== null;
          const heraufgestuftZuAuftrag = n.auftrag_id !== null;
          const hatBezug = n.bezug_typ !== null && n.bezug_id !== null;
          // Aktionen im Menü; gelöschte Nachrichten zeigen keine, und ohne Eintrag gibt es keinen
          // Auslöser.
          type Aktion = 'hoch' | 'auftrag' | 'bezug' | 'edit' | 'del';
          const eintraege: MenueEintrag<Aktion>[] = geloescht
            ? []
            : [
                ...(darfSchreiben && !heraufgestuft
                  ? [{ key: 'hoch' as const, label: 'Zu ETB' }]
                  : []),
                ...(darfSchreiben && !heraufgestuftZuAuftrag
                  ? [{ key: 'auftrag' as const, label: 'Zu Auftrag' }]
                  : []),
                ...(darfSchreiben && onBezugSetzen
                  ? [{ key: 'bezug' as const, label: hatBezug ? 'Bezug ändern' : 'Bezug' }]
                  : []),
                ...(eigene && darfSchreiben
                  ? [
                      { key: 'edit' as const, label: 'Bearbeiten' },
                      { key: 'del' as const, label: 'Löschen', gefahr: true as const },
                    ]
                  : []),
              ];
          const waehle = (key: Aktion) => {
            if (key === 'hoch') onHeraufstufen(n);
            else if (key === 'auftrag') onHeraufstufenAuftrag(n);
            else if (key === 'bezug') onBezugSetzen?.(n);
            else if (key === 'edit') onBearbeiten(n);
            else if (key === 'del') setLoeschFrageId(n.id);
          };
          return (
            <ListenEintrag
              actions={
                eintraege.length > 0
                  ? [
                      // n Nachrichten, n unterscheidbare Auslöser ({@link aktionsNamen}).
                      <MenueAusloeser
                        key="aktionen"
                        eintraege={eintraege}
                        zugaenglicherName={namen.get(n.id)!}
                        onWahl={waehle}
                      />,
                    ]
                  : []
              }
            >
              <ListenEintragMeta
                title={
                  <Space size="small">
                    <Typography.Text strong>{n.autor_name}</Typography.Text>
                    <Tooltip title={formatZeit(n.erstellt_at)}>
                      <Typography.Text type="secondary" style={monoStil(12)}>
                        {formatZeitKurz(n.erstellt_at)}
                      </Typography.Text>
                    </Tooltip>
                    {n.bearbeitet_at && (
                      <Tooltip title={`bearbeitet am ${formatZeit(n.bearbeitet_at)}`}>
                        <span style={{ display: 'inline-flex' }}>
                          <StatusChip ton="neutral" wort="bearbeitet" />
                        </span>
                      </Tooltip>
                    )}
                    {/* Heraufstufung ist eine aktive Beziehung → Ton `bedien`. */}
                    {heraufgestuft && <StatusChip ton="bedien" wort="heraufgestuft zu ETB" />}
                    {heraufgestuftZuAuftrag && (
                      <StatusChip ton="bedien" wort="heraufgestuft zu Auftrag" />
                    )}
                    {!geloescht &&
                      hatBezug &&
                      bezugLabel &&
                      (() => {
                        const typ = n.bezug_typ as BezugTyp;
                        const zielId = n.bezug_id as number;
                        const label = bezugLabel(typ, zielId);
                        const info = bezugInfo?.(typ, zielId) ?? null;
                        return (
                          <Tag
                            color="cyan"
                            closable={darfSchreiben && onBezugLoeschen !== undefined}
                            onClose={(e) => {
                              e.preventDefault();
                              onBezugLoeschen?.(n);
                            }}
                          >
                            {info ? (
                              <Popover
                                trigger="click"
                                title={info.titel}
                                content={
                                  info.zeilen.length ? (
                                    <Space orientation="vertical" size={0}>
                                      {info.zeilen.map((z, i) => (
                                        <span key={i}>{z}</span>
                                      ))}
                                    </Space>
                                  ) : (
                                    'Keine weiteren Angaben'
                                  )
                                }
                              >
                                <span style={{ cursor: 'pointer' }}>{label}</span>
                              </Popover>
                            ) : (
                              label
                            )}
                          </Tag>
                        );
                      })()}
                  </Space>
                }
                description={
                  geloescht ? (
                    <Typography.Text type="secondary" italic>
                      Nachricht gelöscht
                    </Typography.Text>
                  ) : (
                    // Eine Gruppe je Nachricht: die Großansicht blättert durch ihre Bilder
                    // (LFH-759).
                    <AnhangVorschauGruppe>
                      <Space
                        orientation="vertical"
                        size={4}
                        data-lfh="chat-nachricht-text"
                        style={{ width: '100%', maxWidth: NACHRICHT_LESEBREITE }}
                      >
                        {n.inhalt && <Typography.Text>{n.inhalt}</Typography.Text>}
                        {/* Nativer Download wie ETB und Schaden, kein neuer Tab: `target="_blank"`
                         läuft in der Desktop-Hülle ins Leere (LFH-782). */}
                        {n.anhaenge.map((a) => {
                          const href = `/api/einsaetze/${n.einsatz_id}/anhaenge/${a.id}`;
                          return (
                            <DownloadAnker
                              key={a.id}
                              href={href}
                              dateiname={a.dateiname}
                              groesse={a.groesse}
                              zugaenglicherName={`${a.dateiname}, ${formatGroesse(a.groesse)}, Anhang der Nachricht von ${n.autor_name} herunterladen`}
                              originalHref={
                                darfOriginal && istBildMime(a.mime) ? originalPfad(href) : undefined
                              }
                              originalKennung={`${a.dateiname}, Anhang der Nachricht von ${n.autor_name}`}
                              mime={a.mime}
                              vorschauKennung={`Anhang der Nachricht von ${n.autor_name}`}
                            />
                          );
                        })}
                      </Space>
                    </AnhangVorschauGruppe>
                  )
                }
              />
            </ListenEintrag>
          );
        }}
      />
      <Modal
        open={loeschZiel != null}
        title="Nachricht wirklich löschen?"
        okText="Ja, löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onOk={() => {
          if (loeschZiel) onLoeschen(loeschZiel);
          setLoeschFrageId(null);
        }}
        onCancel={() => setLoeschFrageId(null)}
      >
        Die Nachricht bleibt als „Nachricht gelöscht“ im Verlauf stehen.
      </Modal>
      {/* Die Pille klebt am unteren Rand des Scroll-Containers (`sticky`, sie gehört in den Strom).
         Der Wrapper ist reine Positionierschale und lässt Zeiger durch. Die Pille ist ein echter
         antd-`Button`, damit Trefffläche, Fokusring und Tastaturweg vom `ConfigProvider` kommen. */}
      {neueAnzahl > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: token.paddingSM,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Button type="primary" shape="round" style={{ pointerEvents: 'auto' }} onClick={zumEnde}>
            {neueAnzahl === 1 ? '1 neue Nachricht' : `${neueAnzahl} neue Nachrichten`}
          </Button>
        </div>
      )}
    </div>
  );
}
