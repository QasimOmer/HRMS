'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { Button } from './ui/button';
import { useConfirm } from './ui/overlay';

/**
 * Permanent delete with confirmation. Only shown to people with the "Delete records" permission
 * (Super Admin, or roles it was granted to). The server explains when something is still in use.
 */
export function DeleteButton({
  path,
  what,
  invalidate,
  onDeleted,
  label = 'Delete',
  iconOnly = false,
  detail,
}: {
  path: string;
  what: string;
  invalidate: string[];
  onDeleted?: () => void;
  label?: string;
  iconOnly?: boolean;
  detail?: string;
}) {
  const { can } = useAuth();
  const { confirm, node } = useConfirm();
  const del = useAction('del', path, { invalidate, success: `${what.charAt(0).toUpperCase()}${what.slice(1)} deleted`, onSuccess: () => onDeleted?.() });
  if (!can(P.DATA_DELETE)) return null;
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: `Delete ${what}?`, body: detail ?? 'This permanently removes it and cannot be undone.', danger: true, confirmLabel: 'Delete' })) del.mutate(undefined);
  };
  return (
    <>
      {iconOnly ? (
        <Button type="button" size="icon" variant="ghost" className="bg-danger-soft text-danger hover:bg-danger hover:text-white" aria-label={`Delete ${what}`} loading={del.isPending} onClick={run}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" size="sm" variant="danger" loading={del.isPending} onClick={run}>
          <Trash2 className="h-4 w-4" /> {label}
        </Button>
      )}
      {node}
    </>
  );
}
