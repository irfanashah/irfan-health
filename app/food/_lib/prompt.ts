// Anthropic prompt + tool schema for meal-macro estimation.
//
// Tool-use forces structured output: one call to estimate_meal whose
// JSON-schema is the draft shape (items[] + totals). No free-form JSON
// parsing needed.
//
// Discipline:
//   - estimates, not prescriptions — "give your best reasonable estimate";
//   - cuisine-aware (Pakistani / Middle-Eastern default — typical home
//     cooking; not "1 tbsp olive oil" Western defaults);
//   - portion assumptions stated INSIDE each item's name when inferred,
//     so the review UI surfaces them ("Roti — assumed 2 medium, ~30g
//     each");
//   - NEVER refuses (ambiguous food → assume the most common version
//     and note the assumption);
//   - NEVER medical advice, NEVER judgment of the food (no "you should
//     reduce …", no "high-glycemic", no "unhealthy"); the platform's
//     job is to LOG and CORRELATE, not to coach;
//   - sodium matters (cardiac BP), so estimate it even when small —
//     don't leave it null unless you genuinely don't know.

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6'

export const SYSTEM_PROMPT = `You estimate macronutrients (carbs, protein, fat, fiber, sugar, sodium, calories) for a meal described in plain English.

────────────────────────────────────────────────────────────────────
HARD RULES (non-negotiable)
────────────────────────────────────────────────────────────────────
- These are ESTIMATES for pattern-spotting, not clinical macro-counting. Best reasonable estimate per item. Never refuse on ambiguity — assume the most common version of the dish and note the assumption inside the item's name field (e.g. "Chicken karahi — assumed 1 cup with bone-in pieces, typical home recipe").
- Default cuisine: Pakistani / Middle-Eastern home cooking unless the description clearly says otherwise. Use realistic Desi/ME portion sizes (a "roti" ≈ 30 g, a "bowl of daal" ≈ 1 cup cooked, etc.), not Western restaurant defaults.
- Sodium MATTERS for the user (cardiac context). Estimate sodium for every item even when small. Salt + masala + bouillon + soy + sauces all carry sodium — include those when implied.
- Numbers ONLY for what's actually in the food. NEVER include water, electrolyte drinks (zero macros), or supplements unless the user mentions a flavoured / caloric drink.
- NEVER give medical advice, dietary recommendations, or commentary on the food (no "this is high in carbs", no "consider reducing", no "this is healthy/unhealthy"). The platform logs + correlates; it does not coach.
- Output is via the estimate_meal tool. NO text before or after the tool call.

────────────────────────────────────────────────────────────────────
QUANTITY DEFAULTS WHEN NONE GIVEN
────────────────────────────────────────────────────────────────────
- Roti / chapati: 1 medium (~ 30 g flour, ~ 18 g carbs).
- Rice: 1 cup cooked (~ 200 g, ~ 45 g carbs).
- Daal: 1 cup cooked (~ 200 g, ~ 20 g carbs, ~ 7 g protein).
- Curry/karahi/korma (chicken/mutton): 1 cup (~ 200 g, mostly protein + fat).
- Salad (cucumber/tomato/onion): 1 cup (~ 5 g carbs, negligible macros otherwise).
- Tea (chai with milk + sugar): 1 cup (~ 8 g sugar / carbs if 1 tsp sugar; note the sugar assumption).
- Coffee (with milk): 1 cup (negligible macros unless sugar specified).
- Egg: 1 large (~ 6 g protein, ~ 5 g fat).
- Bread (white slice): 1 slice (~ 15 g carbs).
- Yogurt: 1 cup plain whole-milk (~ 12 g carbs, ~ 8 g protein, ~ 8 g fat).
State the assumed quantity in the item's name field so the review UI can show it.

────────────────────────────────────────────────────────────────────
MEAL LABEL HINT
────────────────────────────────────────────────────────────────────
Suggest meal_label from the eaten_at hour (GST 04:00–11:00 → breakfast, 11:00–15:00 → lunch, 17:00–21:00 → dinner, anything else → snack). The user can override.

────────────────────────────────────────────────────────────────────
TOTALS
────────────────────────────────────────────────────────────────────
The totals object MUST equal the sum of the items, rounded to one decimal place for grams and to the nearest integer for sodium_mg and calories. If you skipped sodium on an item because truly zero, count it as 0 in the sum. Never leave totals null when items are non-empty.`

/**
 * JSON-schema for estimate_meal. Anthropic's tool-use forces the model
 * to call this tool — the input matches the draft shape we render in
 * the review UI.
 */
export const ESTIMATE_TOOL = {
  name: 'estimate_meal',
  description:
    'Submit the structured macronutrient estimate for a described meal. Call this tool exactly once.',
  input_schema: {
    type: 'object',
    required: ['items', 'totals', 'meal_label'],
    properties: {
      meal_label: {
        type: 'string',
        enum: ['breakfast', 'lunch', 'dinner', 'snack'],
        description: 'Best-guess meal label from the eaten_at hour (GST).',
      },
      note: {
        type: ['string', 'null'],
        description:
          'Optional free-form note to the user about the estimate (e.g. "assumed Pakistani home portions", "ambiguous quantity — defaulted to 1 serving"). Null if nothing notable.',
      },
      items: {
        type: 'array',
        description: 'One entry per distinct food item identified in the description.',
        items: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description:
                'Item name including any inferred quantity/portion assumption inline (e.g. "Roti — assumed 2 medium").',
            },
            qty: {
              type: ['string', 'null'],
              description:
                'Free-form quantity description ("1 cup cooked", "200g", "2 medium"). Null if not given/inferable.',
            },
            carbs_g: { type: ['number', 'null'], description: 'Carbohydrates in grams.' },
            protein_g: { type: ['number', 'null'], description: 'Protein in grams.' },
            fat_g: { type: ['number', 'null'], description: 'Fat in grams.' },
            fiber_g: { type: ['number', 'null'], description: 'Fiber in grams.' },
            sugar_g: { type: ['number', 'null'], description: 'Total sugars in grams.' },
            sodium_mg: { type: ['number', 'null'], description: 'Sodium in milligrams.' },
            calories: { type: ['number', 'null'], description: 'Calories in kcal.' },
          },
        },
      },
      totals: {
        type: 'object',
        required: ['carbs_g', 'protein_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'calories'],
        description: 'Meal totals — MUST be the sum of items, rounded as per the prompt.',
        properties: {
          carbs_g:   { type: ['number', 'null'] },
          protein_g: { type: ['number', 'null'] },
          fat_g:     { type: ['number', 'null'] },
          fiber_g:   { type: ['number', 'null'] },
          sugar_g:   { type: ['number', 'null'] },
          sodium_mg: { type: ['number', 'null'] },
          calories:  { type: ['number', 'null'] },
        },
      },
    },
  },
}
