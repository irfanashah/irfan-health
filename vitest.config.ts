import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Pure-function unit tests only (no DB/network/Drive/Anthropic) — node
// environment, no jsdom. See `**/*.test.ts` co-located next to source.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
    coverage: {
      provider: 'v8',
      include: [
        'components/dashboard/charts/stats.ts',
        'components/dashboard/connections/engine.ts',
        'components/dashboard/drift/evaluate.ts',
        'components/dashboard/drift-config.ts',
        'components/dashboard/thresholds.ts',
        'app/labs/_lib/targets.ts',
        'app/labs/_lib/ranges.ts',
        'app/log/_lib/glucose.ts',
        'adapters/file-drop/oxylink/parser.ts',
        'adapters/file-drop/contour/parser.ts',
        'adapters/_lib/ingestion-window.ts',
        'adapters/_lib/token-store.ts',
        'components/dashboard/drift-config.ts',
        'app/report/_lib/format.ts',
        'lib/gst.ts',
        'app/food/_lib/estimate.ts',
        'app/lib/dashboard/daily-metrics.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
