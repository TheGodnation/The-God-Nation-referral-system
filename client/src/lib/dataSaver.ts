import { useEffect, useState } from 'react';

// "Save data": nothing ever waits on a manual tap to download. "auto"
// (recommended) only holds off photos/videos/voice notes by itself when the
// phone says it's on a very slow (2G) network or has its own data saver
// switched on; "off" always downloads them straight away.
export type DataSaverSetting = 'auto' | 'off';

const KEY = 'dataSaver';
const EVENT = 'data-saver-change';

export function getDataSaverSetting(): DataSaverSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setDataSaverSetting(value: DataSaverSetting) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

function slowNetwork(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return false;
  return Boolean(c.saveData) || /(^|-)2g$/.test(c.effectiveType ?? '');
}

export function isDataSaverOn(): boolean {
  const s = getDataSaverSetting();
  return s === 'auto' && slowNetwork();
}

export function useDataSaver(): boolean {
  const [on, setOn] = useState(isDataSaverOn);
  useEffect(() => {
    const update = () => setOn(isDataSaverOn());
    window.addEventListener(EVENT, update);
    const c = (navigator as unknown as { connection?: EventTarget }).connection;
    c?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener(EVENT, update);
      c?.removeEventListener?.('change', update);
    };
  }, []);
  return on;
}
