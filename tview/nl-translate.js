// Natural-language → backtest strategy rules, via a small/cheap LLM.
// The model only translates English into our DSL; the returned rules are then
// validated by the same parser the backtest uses, so a bad translation surfaces
// as a clean error instead of a broken run. Execution stays deterministic.
//
// Provider is swappable by env (default: Google Gemini free tier):
//   LLM_PROVIDER = "gemini" (default) | "openai"
//   gemini:  GEMINI_API_KEY   [LLM_MODEL=gemini-2.0-flash]
//   openai-compatible (Groq / OpenAI / Ollama):
//     LLM_API_KEY, LLM_BASE_URL (e.g. https://api.groq.com/openai/v1),
//     LLM_MODEL (e.g. llama-3.3-70b-versatile)
import { compile, VARIABLES, FUNCTIONS } from "./strategy-dsl.js";

const MAX_INPUT = 1000;

const SYSTEM_PROMPT = `You translate a trader's plain-English idea into a tiny rule language for a stock backtester.

Return STRICT JSON only, no prose, shaped exactly:
{"direction": "long" | "short", "entry": "<expression>", "exit": "<expression>", "notes": "<one short sentence or empty>"}

The expression language:
- Variables (per daily bar): ${VARIABLES.filter((v) => !["profit", "held", "bars", "entryprice"].includes(v)).join(", ")}.
  rsi is 0-100 (period 14). adx is period 14. atr is period 14. percentb is Bollinger %B (~0-1).
- EXIT expressions may ALSO use: profit (percent P/L of the open trade, e.g. 8 = +8%), held and bars (days the trade has been open), entryprice.
- Operators: and or not ; comparisons < > <= >= == != ; arithmetic + - * / ; parentheses. A trailing % on a number is cosmetic (10% == 10).
- Functions: ${FUNCTIONS.join(", ")}. crossabove(a, b) is true the bar a rises from <= b to > b; crossbelow(a, b) is the mirror.

Rules:
- "entry" is the condition to open the trade; "exit" is the condition to close it. Both are required and must be non-empty.
- Use ONLY the variables and functions listed above. Never invent names (no macd, no stochastic, no bollinger bands other than percentb).
- If the user implies a profit target or stop loss, express it in exit via profit, e.g. "profit >= 10 or profit <= -5".
- direction is "short" only when the user clearly wants to short/sell-short; otherwise "long".
- Keep expressions simple and robust.`;

function buildUserPrompt(text, priorError) {
  let p = `Trader's idea:\n"""${text}"""`;
  if (priorError) {
    p += `\n\nYour previous answer failed validation: ${priorError}\nFix it and return corrected JSON only.`;
  }
  return p;
}

async function callGemini(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY to enable natural-language translation");
  const model = process.env.LLM_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

async function callOpenAICompatible(system, user) {
  const key = process.env.LLM_API_KEY;
  const base = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!base || !model) throw new Error("Set LLM_BASE_URL and LLM_MODEL for the openai provider");
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("LLM returned an empty response");
  return text;
}

function callProvider(system, user) {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "gemini") return callGemini(system, user);
  if (provider === "openai") return callOpenAICompatible(system, user);
  throw new Error(`Unknown LLM_PROVIDER "${provider}" (use "gemini" or "openai")`);
}

function extractJson(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the first {...} block if the model wrapped it in prose.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("model did not return valid JSON");
  }
}

// Validate/normalise one model response; throws with a reason on any problem.
function validate(parsed) {
  const direction = parsed.direction === "short" ? "short" : "long";
  const entry = String(parsed.entry || "").trim();
  const exit = String(parsed.exit || "").trim();
  if (!entry || !exit) throw new Error("entry and exit rules must both be present");
  // These throw with a readable message if the DSL doesn't accept them.
  try {
    compile(entry);
  } catch (err) {
    throw new Error(`entry rule invalid (${err.message})`);
  }
  try {
    compile(exit);
  } catch (err) {
    throw new Error(`exit rule invalid (${err.message})`);
  }
  return { direction, entry, exit, notes: String(parsed.notes || "").trim() };
}

/**
 * Translate a plain-English strategy into { direction, entry, exit, notes }.
 * Retries once with the validation error fed back to the model.
 */
export async function translateStrategy(text) {
  const input = String(text || "").trim();
  if (!input) throw new Error("Describe your strategy first");
  if (input.length > MAX_INPUT) throw new Error(`Keep it under ${MAX_INPUT} characters`);

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callProvider(SYSTEM_PROMPT, buildUserPrompt(input, lastError));
    try {
      return validate(extractJson(raw));
    } catch (err) {
      lastError = err.message;
    }
  }
  throw new Error(`Could not turn that into valid rules: ${lastError}`);
}
