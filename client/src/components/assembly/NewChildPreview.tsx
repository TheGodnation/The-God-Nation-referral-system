import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

export interface NewChildPreviewData {
  kind: 'ASSEMBLY' | 'GROUP';
  generation: number | null;
  used: number;
  max: number;
  full: boolean;
  parentName: string;
}

/**
 * Before anything is saved: what a new group or assembly inside this assembly would be. A group stays in the
 * assembly's own generation and is never limited; an assembly is the next generation, and each assembly can have only
 * two. `base` is the door that has the preview (the Communities routes of the signed-in role).
 */
export function NewChildPreview({ base, parentId, kind, onFull }: { base: string; parentId: string; kind: 'ASSEMBLY' | 'GROUP'; onFull?: (full: boolean) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<NewChildPreviewData | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    onFull?.(false);
    api
      .get<NewChildPreviewData>(`${base}/${parentId}/new-child-preview?kind=${kind}`)
      .then((r) => {
        if (!live) return;
        setData(r);
        onFull?.(r.full);
      })
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
    // onFull is a setter from the parent; it must not restart the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, parentId, kind]);

  if (!data) return null;
  const gen = data.generation === null ? null : data.generation === 0 ? t('newChild.founding') : String(data.generation);
  return (
    <div className="space-y-1 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900" data-testid="new-child-preview" role="status">
      {data.kind === 'ASSEMBLY' ? (
        <>
          {gen !== null && <p className="font-semibold">{t('newChild.assembly_generation', { generation: gen })}</p>}
          <p>{t('newChild.places_used', { parent: data.parentName, used: data.used, max: data.max })}</p>
          {data.full && <p className="font-medium text-red-700">{t('newChild.full', { parent: data.parentName, max: data.max })}</p>}
        </>
      ) : (
        <>
          {gen !== null && <p className="font-semibold">{t('newChild.group_generation', { generation: gen })}</p>}
          <p>{t('newChild.group_note')}</p>
        </>
      )}
    </div>
  );
}
