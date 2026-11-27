import { RETRY_ALERT, STATUS_ICON, STATUS_TEXT, formatValue, retryNote } from './logic.js';
import { createInstrument } from './instruments.js';

/**
 * Kachel eines Checks: Titel, Messgerät, Statuszeile, Hinweis. Schnittstelle `{ el, update(check) }`.
 * Das Messgerät ist für Screenreader ausgeblendet; die Kachel trägt den vollständigen Text im aria-label
 * und öffnet per Klick/Tastatur die Verlaufsansicht (`onOpen(el)`).
 */
export function createTile(def, onOpen) {
  const el = document.createElement('article');
  el.className = `tile tile-${def.element}`;
  el.dataset.check = def.id;
  el.tabIndex = 0;
  if (def.hint) el.title = def.hint;
  // Klick oder Enter/Leertaste öffnet den Verlauf.
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'dialog');
  el.addEventListener('click', () => onOpen?.(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.(el);
    }
  });

  const title = document.createElement('h4');
  title.className = 'tile-title';
  title.textContent = def.label;
  const instrument = createInstrument(def);
  const status = document.createElement('div');
  status.className = 'tile-status';
  const detail = document.createElement('div');
  detail.className = 'tile-detail';
  const note = document.createElement('div');
  note.className = 'tile-note';
  const slot = document.createElement('div'); // feste Mindesthöhe: Fehlertexte beginnen in allen Kacheln gleich hoch
  slot.className = 'tile-instrument';
  slot.append(instrument.el);
  el.append(title, status, slot, detail, note);

  return {
    el,
    /** `quiet`: Verbindung getrennt. Die Ursache steht im allgemeinen Hinweis, nicht in jeder Kachel. */
    update(check, quiet = false) {
      if (quiet) check = { ...check, detail: undefined };
      el.dataset.status = check.status;
      instrument.update(check);
      status.textContent = `${STATUS_ICON[check.status]} ${STATUS_TEXT[check.status]}`;
      const hint = retryNote(check);
      note.textContent = hint;
      note.dataset.alert = String(check.retries1h >= RETRY_ALERT);
      detail.textContent = check.detail ?? (quiet ? '' : check.status === 'unknown' ? 'Noch keine Messung oder Wert nicht lesbar.' : '');
      el.setAttribute('aria-label', `${def.label}: ${formatValue(def, check.value)}, ${STATUS_TEXT[check.status]}${check.detail ? `. ${check.detail}` : ''}${hint ? `. ${hint}` : ''}`);
    },
  };
}
