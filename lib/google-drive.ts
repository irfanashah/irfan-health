// Google Drive service-account client for the Slice 4 file-drop pipeline.
//
// Auth: GDRIVE_SA_KEY is the service-account JSON key BASE64-encoded (the
// runbook tells Irfan to encode it before pasting into Vercel — base64
// avoids newline mangling in env var UIs). We decode + JSON-parse before
// handing to googleapis.
//
// Helpers cover the four ops the cron needs:
//   listFolderChildren(parentId, mimeFilter?)
//   downloadFile(id)  — returns bytes + filename
//   moveFile(id, fromParentId, toParentId)   — Drive has no native move;
//                                              files.update swaps parents.
//   findOrCreateSubfolder(name, parentId)
//   resolveRootStructure(rootId, sourceSlugs[])  — one-shot per cron run:
//                                                  finds (or creates) each
//                                                  source's inbox/processed/
//                                                  failed/ subfolder ids.

import { google, drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  createdTime: string
  size: number | null
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * Decode GDRIVE_SA_KEY (base64 of the service-account JSON) and authenticate.
 * Cached at module level so successive helper calls reuse one auth client.
 */
let _driveClient: drive_v3.Drive | null = null

function getDrive(): drive_v3.Drive {
  if (_driveClient) return _driveClient

  const raw = process.env.GDRIVE_SA_KEY
  if (!raw) throw new Error('GDRIVE_SA_KEY env var not set')

  let credentials: { client_email: string; private_key: string; [k: string]: unknown }
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8')
    credentials = JSON.parse(json) as typeof credentials
  } catch (err) {
    throw new Error(
      `GDRIVE_SA_KEY decode/parse failed (expected base64-encoded JSON): ${(err as Error).message}`
    )
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GDRIVE_SA_KEY missing client_email or private_key')
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })

  _driveClient = google.drive({ version: 'v3', auth })
  return _driveClient
}

// ─── Listing ───────────────────────────────────────────────────────────────

/**
 * List children of a folder. Filters out trashed items. Excludes nested
 * subfolders by default (the cron processes files, not folders). Caller
 * can pass mimeFilter='folder' to enumerate child folders for resolution.
 */
export async function listFolderChildren(
  parentId: string,
  opts: { mimeFilter?: 'folder' | 'file' | 'any'; pageSize?: number } = {}
): Promise<DriveFile[]> {
  const drive = getDrive()
  const filter = opts.mimeFilter ?? 'file'

  let q = `'${parentId}' in parents and trashed = false`
  if (filter === 'folder') q += ` and mimeType = '${FOLDER_MIME}'`
  else if (filter === 'file') q += ` and mimeType != '${FOLDER_MIME}'`

  const out: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, createdTime, size)',
      pageSize: opts.pageSize ?? 100,
      pageToken,
      orderBy: 'createdTime',
      // service-account on a shared folder — no team-drive flags needed.
    })
    for (const f of res.data.files ?? []) {
      out.push({
        id: f.id!,
        name: f.name ?? '',
        mimeType: f.mimeType ?? '',
        createdTime: f.createdTime ?? '',
        size: f.size ? Number(f.size) : null,
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return out
}

// ─── Download ──────────────────────────────────────────────────────────────

export async function downloadFile(id: string): Promise<Buffer> {
  const drive = getDrive()
  const res = await drive.files.get(
    { fileId: id, alt: 'media' },
    { responseType: 'stream' }
  )
  return await streamToBuffer(res.data as Readable)
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

// ─── Move (= swap parents) ─────────────────────────────────────────────────

export async function moveFile(
  id: string,
  fromParentId: string,
  toParentId: string
): Promise<void> {
  const drive = getDrive()
  await drive.files.update({
    fileId: id,
    addParents: toParentId,
    removeParents: fromParentId,
    fields: 'id, parents',
  })
}

// ─── Folder resolution ─────────────────────────────────────────────────────

export async function findOrCreateSubfolder(
  name: string,
  parentId: string
): Promise<string> {
  const drive = getDrive()
  const q = `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
  const list = await drive.files.list({
    q,
    fields: 'files(id, name)',
    pageSize: 1,
  })
  const existing = list.data.files?.[0]?.id
  if (existing) return existing

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id',
  })
  if (!created.data.id) throw new Error(`findOrCreateSubfolder: create returned no id for ${name}`)
  return created.data.id
}

// ─── Per-cron-run structure resolution ─────────────────────────────────────

export interface SourceFolders {
  inbox: string
  processed: string
  failed: string
}

export interface RootStructure {
  rootId: string
  /** Per source slug → its inbox/processed/failed ids. Missing source = not configured. */
  bySource: Record<string, SourceFolders>
}

export interface SourceFolderSpec {
  /** Slug used in DB + ingestion_log (e.g. 'oxylink_csv'). */
  slug: string
  /** Drive subfolder name under inbox/processed/failed (e.g. 'oxylink'). */
  folderName: string
}

/**
 * Resolve the inbox/<folderName>/, processed/<folderName>/, failed/<folderName>/
 * folder ids for each registered source under the root. Done ONCE per cron
 * invocation (cron's lifetime ≈ minutes — robust to folder renames between
 * runs without an env var pin).
 *
 * IMPORTANT: the folder name CAN differ from the slug. Oxylink's slug is
 * 'oxylink_csv' but its Drive folder is just 'oxylink'. Always look up by
 * folderName; key the result by slug.
 *
 * Auto-creates processed/<folderName>/ and failed/<folderName>/ if absent.
 *
 * If inbox/<folderName>/ is absent, the source is reported as unconfigured
 * (no inbox = nothing to process; the cron skips it rather than failing).
 */
export async function resolveRootStructure(
  rootId: string,
  sources: readonly SourceFolderSpec[]
): Promise<RootStructure> {
  // Resolve inbox/, processed/, failed/ at the root level (auto-create the
  // last two — they may not exist on first run).
  const inboxId     = await findSubfolder('inbox',     rootId)
  const processedId = await findOrCreateSubfolder('processed', rootId)
  const failedId    = await findOrCreateSubfolder('failed',    rootId)

  if (!inboxId) {
    throw new Error(
      `GDRIVE root structure: 'inbox/' folder not found under root ${rootId}. Create it per the setup guide.`
    )
  }

  const bySource: Record<string, SourceFolders> = {}
  for (const src of sources) {
    const sourceInbox = await findSubfolder(src.folderName, inboxId)
    if (!sourceInbox) continue  // source not yet configured — cron skips it
    bySource[src.slug] = {
      inbox: sourceInbox,
      processed: await findOrCreateSubfolder(src.folderName, processedId),
      failed:    await findOrCreateSubfolder(src.folderName, failedId),
    }
  }

  return { rootId, bySource }
}

async function findSubfolder(name: string, parentId: string): Promise<string | null> {
  const drive = getDrive()
  const q = `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
  const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 })
  return list.data.files?.[0]?.id ?? null
}
