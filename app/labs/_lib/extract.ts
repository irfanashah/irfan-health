// Lab-report extraction — hybrid text-layer-first, vision fallback.
//
// Why hybrid: digital PDFs (most lab reports) have a clean text layer
// the LLM can structure deterministically. Sending the verbatim text
// avoids the LLM's main hazard on medical data — digit-misreads from
// vision transcription. We fall back to vision only when no usable text
// layer exists (scanned reports). Either way the draft is reviewed
// before commit; this is the FIRST safety net, not the only one.

import Anthropic from '@anthropic-ai/sdk'
import { extractText, getDocumentProxy } from 'unpdf'
import { ANTHROPIC_MODEL, EXTRACT_TOOL, SYSTEM_PROMPT } from './prompt'
import type { ExtractionDraft, ExtractionPath, DraftValue } from './types'

// Heuristic: a usable text layer should yield SOMETHING substantive.
// Empty / a few characters / pure whitespace → fall back to vision.
// Threshold tuned to catch "just page numbers + headers" cases.
const MIN_USABLE_TEXT_CHARS = 120

interface RawDraftValue {
  raw_marker_name?: string
  numeric_value?: number | null
  text_value?: string | null
  unit?: string | null
  ref_low?: number | null
  ref_high?: number | null
  ref_unit?: string | null
  ref_text?: string | null
  flag?: DraftValue['flag']
  suggested_marker_slug?: string | null
  range_source?: 'reported' | 'proposed' | null
  proposed_ref_low?: number | null
  proposed_ref_high?: number | null
  proposed_ref_unit?: string | null
  proposed_critical_low?: number | null
  proposed_critical_high?: number | null
  proposed_flag?: DraftValue['flag']
  notes?: string | null
}

interface RawDraft {
  panel: {
    drawn_at: string | null
    lab_name: string | null
    ordering_physician: string | null
    notes: string | null
  }
  dateAmbiguous: boolean
  extractionNote: string | null
  values: RawDraftValue[]
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — lab extraction is unavailable.')
  }
  return new Anthropic({ apiKey })
}

/**
 * Try to extract the text layer from the PDF buffer.
 * Returns null when no usable text exists (e.g. a pure-image scan).
 */
async function extractTextLayer(pdf: Buffer): Promise<string | null> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf))
    const { text } = await extractText(doc, { mergePages: true })
    const merged = Array.isArray(text) ? text.join('\n') : text
    const trimmed = merged?.trim() ?? ''
    if (trimmed.length < MIN_USABLE_TEXT_CHARS) return null
    return trimmed
  } catch {
    return null
  }
}

function pickToolUseBlock(content: Anthropic.Messages.ContentBlock[]): Anthropic.Messages.ToolUseBlock | null {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === EXTRACT_TOOL.name) {
      return block
    }
  }
  return null
}

/**
 * Raised one above the model's tool-call ceiling we actually need —
 * the structured output for a typical multi-page lab/discharge doc fits
 * comfortably in 16k. If a future report ever truncates, the
 * stop_reason='max_tokens' guard below surfaces a clear error instead
 * of returning a malformed/partial draft.
 */
const MAX_OUTPUT_TOKENS = 16384

function assertNotTruncated(response: Anthropic.Messages.Message, path: ExtractionPath): void {
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Report too long — the extraction was truncated (max_tokens, ${path} path). ` +
        `Split the report into smaller PDFs and upload separately.`
    )
  }
}

function normaliseDraft(raw: unknown, path: ExtractionPath): ExtractionDraft {
  // Defensive guards even though the tool schema enforces structure.
  const r = raw as RawDraft
  const values: DraftValue[] = Array.isArray(r?.values)
    ? r.values.map((v): DraftValue => {
        const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
        const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
        const validFlag = (x: unknown): DraftValue['flag'] =>
          (['H', 'L', 'HH', 'LL', 'N'] as const).includes(x as 'H') ? (x as DraftValue['flag']) : null

        const reportedLow = num(v.ref_low)
        const reportedHigh = num(v.ref_high)
        const reportedText = str(v.ref_text)
        const labFlag = validFlag(v.flag)
        const proposedLow = num(v.proposed_ref_low)
        const proposedHigh = num(v.proposed_ref_high)
        const proposedUnit = str(v.proposed_ref_unit)

        // Determine the FINAL ref range + provenance.
        //   Reported wins. Else proposed (if non-null). Else null.
        // The remembered-standard overlay happens AFTER this in the
        // extract pipeline (overlayRangesOnDraft) — if a remembered
        // range exists for this slug, it overwrites a 'proposed' here.
        let refLow = reportedLow
        let refHigh = reportedHigh
        let refUnit = str(v.ref_unit) ?? str(v.unit)
        let rangeSource: DraftValue['range_source'] = null
        if (reportedLow !== null || reportedHigh !== null || reportedText !== null) {
          rangeSource = 'reported'
        } else if (proposedLow !== null || proposedHigh !== null) {
          refLow = proposedLow
          refHigh = proposedHigh
          refUnit = proposedUnit ?? refUnit
          rangeSource = 'proposed'
        }

        // Final flag: lab-printed wins; else the LLM's proposed_flag.
        // overlayRangesOnDraft re-runs computeFlag after applying any
        // remembered range, so a remembered overlay refreshes the flag.
        const finalFlag = labFlag ?? validFlag(v.proposed_flag)

        return {
          raw_marker_name: String(v.raw_marker_name ?? '').trim(),
          numeric_value: num(v.numeric_value),
          text_value: str(v.text_value),
          unit: str(v.unit),
          ref_low: refLow,
          ref_high: refHigh,
          ref_unit: refUnit,
          ref_text: reportedText,
          range_source: rangeSource,
          critical_low: num(v.proposed_critical_low),
          critical_high: num(v.proposed_critical_high),
          flag: finalFlag,
          suggested_marker_slug: str(v.suggested_marker_slug),
          notes: str(v.notes),
        }
      })
    : []
  return {
    path,
    dateAmbiguous: Boolean(r?.dateAmbiguous),
    extractionNote: typeof r?.extractionNote === 'string' ? r.extractionNote : null,
    panel: {
      drawn_at: typeof r?.panel?.drawn_at === 'string' ? r.panel.drawn_at : null,
      lab_name: typeof r?.panel?.lab_name === 'string' ? r.panel.lab_name : null,
      ordering_physician: typeof r?.panel?.ordering_physician === 'string' ? r.panel.ordering_physician : null,
      notes: typeof r?.panel?.notes === 'string' ? r.panel.notes : null,
    },
    values,
  }
}

/**
 * Extract a lab-report PDF into a structured draft.
 *
 * Strategy:
 *   1. Try to pull the text layer via unpdf (pdfjs under the hood).
 *   2. If usable text → send it as the user message; LLM structures + maps
 *      values WITHOUT altering them. This is the safer path: numbers come
 *      from the real text layer, not vision transcription.
 *   3. Else → send the PDF as a document content block; LLM reads it via
 *      its vision capability. Tagged path='vision' so the review UI can
 *      flag it for extra scrutiny.
 *
 * The draft is returned unmodified — the caller applies the alias table
 * (deterministic) before showing the review UI.
 */
export async function extractLabReport(pdf: Buffer): Promise<ExtractionDraft> {
  const client = getClient()
  const textLayer = await extractTextLayer(pdf)

  if (textLayer) {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Below is the verbatim text extracted from the lab report PDF. Structure it via the extract_lab_panel tool. Reproduce numbers, units, and reference ranges EXACTLY as printed; do not alter, round, infer, or re-derive any value.\n\n--- BEGIN REPORT TEXT ---\n' +
                textLayer +
                '\n--- END REPORT TEXT ---',
            },
          ],
        },
      ],
    })
    assertNotTruncated(response, 'text')
    const block = pickToolUseBlock(response.content)
    if (!block) {
      throw new Error('LLM did not call extract_lab_panel tool (text path).')
    }
    return normaliseDraft(block.input, 'text')
  }

  // Vision fallback — Claude reads the PDF natively via a document block.
  const base64 = pdf.toString('base64')
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text:
              'This PDF has no usable text layer (likely scanned). Read it via vision and structure it via the extract_lab_panel tool. Be extra careful with digit recognition — if any reading is unclear, leave it null and add a per-value note.',
          },
        ],
      },
    ],
  })
  assertNotTruncated(response, 'vision')
  const block = pickToolUseBlock(response.content)
  if (!block) {
    throw new Error('LLM did not call extract_lab_panel tool (vision path).')
  }
  return normaliseDraft(block.input, 'vision')
}
