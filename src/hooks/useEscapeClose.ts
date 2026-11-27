import { useEffect, useId, useRef } from 'react';
import { resolveTopEscapeHandlerId } from '../utils/fuelEngine';

interface RegisteredEscapeHandler {
  id: string;
  priority: number;
  order: number;
  onClose: () => void;
}

const activeEscapeHandlers = new Map<string, RegisteredEscapeHandler>();
let registrationSequence = 0;

function handleGlobalEscapeKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) {
    return;
  }
  if (activeEscapeHandlers.size === 0) return;

  const entries = Array.from(activeEscapeHandlers.values()).map((h) => ({
    id: h.id,
    priority: h.priority,
    order: h.order,
  }));
  const topId = resolveTopEscapeHandlerId(entries);
  if (!topId) return;

  const handler = activeEscapeHandlers.get(topId);
  if (!handler) return;

  event.preventDefault();
  handler.onClose();
}

let listenerAttached = false;

function syncGlobalListener() {
  if (typeof window === 'undefined') return;
  if (activeEscapeHandlers.size > 0 && !listenerAttached) {
    window.addEventListener('keydown', handleGlobalEscapeKeyDown);
    listenerAttached = true;
  } else if (activeEscapeHandlers.size === 0 && listenerAttached) {
    window.removeEventListener('keydown', handleGlobalEscapeKeyDown);
    listenerAttached = false;
  }
}

/**
 * Registers an Escape-key close callback when `active` is true.
 * Higher `priority` layers (e.g. PDF preview = 4, sub-modals = 3,
 * full-record review = 2, floating table preview = 1) take precedence,
 * so a single Escape press closes only the topmost active layer.
 */
export function useEscapeClose(active: boolean, onClose: () => void, priority = 1) {
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) {
      if (activeEscapeHandlers.delete(id)) {
        syncGlobalListener();
      }
      return;
    }

    registrationSequence += 1;
    activeEscapeHandlers.set(id, {
      id,
      priority,
      order: registrationSequence,
      onClose: () => onCloseRef.current(),
    });
    syncGlobalListener();

    return () => {
      activeEscapeHandlers.delete(id);
      syncGlobalListener();
    };
  }, [active, id, priority]);
}
