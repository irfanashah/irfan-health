'use client'

import { useTransition } from 'react'
import { deleteEntry } from './actions'
import { formatStamp } from './_lib/datetime'
import { kindLabel } from './_lib/fetch-recent'
import type { EntryKind, RecentEntry } from './_lib/types'

interface Props {
  entries: RecentEntry[]
  onEdit: (entry: RecentEntry) => void
}

export function RecentList({ entries, onEdit }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No entries yet.</p>
    )
  }
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <RecentRow key={`${e.kind}_${e.id}`} entry={e} onEdit={() => onEdit(e)} />
      ))}
    </ul>
  )
}

function RecentRow({ entry, onEdit }: { entry: RecentEntry; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    const ok = window.confirm("Delete this entry? This can't be undone.")
    if (!ok) return
    startTransition(async () => {
      const res = await deleteEntry(entry.id, entry.kind as EntryKind)
      if (!res.ok) {
        window.alert(`Delete failed: ${res.error ?? 'unknown error'}`)
      }
    })
  }

  return (
    <li className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <span className="text-accent-teal font-medium">{kindLabel(entry.kind)}</span>
          {' · '}
          {formatStamp(entry.occurred_at)}
        </p>
        <p className="text-sm text-foreground mt-0.5 break-words">{entry.summary}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="text-xs px-2 py-1 rounded border border-input bg-card text-foreground
                     hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="text-xs px-2 py-1 rounded border border-destructive/40 bg-card text-destructive
                     hover:bg-destructive/10 disabled:opacity-50 transition-colors"
        >
          {pending ? '…' : 'Delete'}
        </button>
      </div>
    </li>
  )
}
