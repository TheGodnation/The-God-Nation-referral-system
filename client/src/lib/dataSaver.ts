import { useEffect, useState } from 'react';

// "Save data": when on, photos, videos and voice notes are not downloaded
// until you tap them. "auto" turns it on by itself when the phone says it
// is on a very slow (2G) network or has its own data saver switched on.
export type DataSaverSetting = 'auto' | 'on' | 'off';

const KEY = 'dataSaver';
const EVENT = 'data-saver-change';

export function getDataSaverSetting(): DataSaverSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
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
  return s === 'on' || (s === 'auto' && slowNetwork());
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
