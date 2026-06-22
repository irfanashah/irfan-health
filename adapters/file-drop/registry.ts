// File-drop parser registry. The cron iterates this map; adding a new
// parser (Contour, Labs) is a one-entry change here.

import type { FileDropParser } from './types'
import { oxylinkParser } from './oxylink/parser'

export const FILE_DROP_PARSERS: Record<string, FileDropParser> = {
  oxylink_csv: oxylinkParser,
}

export const FILE_DROP_SOURCE_SLUGS = Object.keys(FILE_DROP_PARSERS)
