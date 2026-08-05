// A tiny, safe expression language for user-defined backtest rules. No eval():
// text is tokenized, parsed to an AST, and evaluated against a per-bar context.
//
// Grammar (lowest → highest precedence):
//   or   := and ("or" and)*
//   and  := not ("and" not)*
//   not  := "not" not | cmp
//   cmp  := add (("<"|">"|"<="|">="|"=="|"!=") add)*
//   add  := mul (("+"|"-") mul)*
//   mul  := unary (("*"|"/") unary)*
//   unary:= "-" unary | primary
//   primary := number["%"] | ident | ident "(" args ")" | "(" or ")"
//
// Booleans are numbers: comparisons yield 1/0, and/or treat non-zero as true.
// A null/NaN operand makes any comparison false, so rules never fire while an
// indicator is still warming up.

// Variables the rules may reference. Exit-only ones are NaN during entry.
export const VARIABLES = [
  "close", "open", "high", "low", "volume",
  "sma20", "sma50", "sma100", "sma200",
  "ema10", "ema21", "rsi", "adx", "atr", "percentb",
  // exit context only:
  "profit", "held", "bars", "entryprice",
];

export const FUNCTIONS = ["crossabove", "crossbelow", "min", "max", "abs"];

const VAR_SET = new Set(VARIABLES);
const KEYWORDS = new Set(["and", "or", "not"]);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = src;
  const two = { ">=": 1, "<=": 1, "==": 1, "!=": 1 };
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      let text = s.slice(i, j);
      if (s[j] === "%") j++; // trailing % is cosmetic (10% === 10)
      tokens.push({ type: "num", value: Number(text) });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j).toLowerCase();
      tokens.push({ type: KEYWORDS.has(word) ? word : "ident", value: word });
      i = j;
      continue;
    }
    const pair = s.slice(i, i + 2);
    if (two[pair]) { tokens.push({ type: "op", value: pair }); i += 2; continue; }
    if ("<>+-*/(),".includes(c)) { tokens.push({ type: "op", value: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (value) => {
    const t = tokens[pos];
    if ((t.type === "op" && t.value === value) || t.type === value) return next();
    throw new Error(`Expected "${value}" but found "${t.value ?? t.type}"`);
  };

  function parseOr() {
    let node = parseAnd();
    while (peek().type === "or") { next(); node = { type: "or", a: node, b: parseAnd() }; }
    return node;
  }
  function parseAnd() {
    let node = parseNot();
    while (peek().type === "and") { next(); node = { type: "and", a: node, b: parseNot() }; }
    return node;
  }
  function parseNot() {
    if (peek().type === "not") { next(); return { type: "not", a: parseNot() }; }
    return parseCmp();
  }
  function parseCmp() {
    let node = parseAdd();
    while (peek().type === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(peek().value)) {
      const op = next().value;
      node = { type: "cmp", op, a: node, b: parseAdd() };
    }
    return node;
  }
  function parseAdd() {
    let node = parseMul();
    while (peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      node = { type: "bin", op, a: node, b: parseMul() };
    }
    return node;
  }
  function parseMul() {
    let node = parseUnary();
    while (peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = next().value;
      node = { type: "bin", op, a: node, b: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (peek().type === "op" && peek().value === "-") { next(); return { type: "neg", a: parseUnary() }; }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (t.type === "num") { next(); return { type: "num", value: t.value }; }
    if (t.type === "op" && t.value === "(") {
      next();
      const node = parseOr();
      expect(")");
      return node;
    }
    if (t.type === "ident") {
      next();
      if (peek().type === "op" && peek().value === "(") {
        next();
        const args = [];
        if (!(peek().type === "op" && peek().value === ")")) {
          args.push(parseOr());
          while (peek().type === "op" && peek().value === ",") { next(); args.push(parseOr()); }
        }
        expect(")");
        if (!FUNCTIONS.includes(t.value)) throw new Error(`Unknown function "${t.value}"`);
        return { type: "call", name: t.value, args };
      }
      if (!VAR_SET.has(t.value)) throw new Error(`Unknown name "${t.value}"`);
      return { type: "var", name: t.value };
    }
    throw new Error(`Unexpected "${t.value ?? t.type}"`);
  }

  const node = parseOr();
  if (peek().type !== "eof") throw new Error(`Unexpected trailing "${peek().value ?? peek().type}"`);
  return node;
}

function truthy(v) {
  return Number.isFinite(v) && v !== 0;
}

// Evaluate a node against `vars`; `prev` (previous bar's vars, or null) powers
// the cross functions.
function ev(node, vars, prev) {
  switch (node.type) {
    case "num": return node.value;
    case "var": {
      const v = vars[node.name];
      return v == null ? NaN : v;
    }
    case "neg": return -ev(node.a, vars, prev);
    case "not": return truthy(ev(node.a, vars, prev)) ? 0 : 1;
    case "and": return truthy(ev(node.a, vars, prev)) && truthy(ev(node.b, vars, prev)) ? 1 : 0;
    case "or": return truthy(ev(node.a, vars, prev)) || truthy(ev(node.b, vars, prev)) ? 1 : 0;
    case "bin": {
      const a = ev(node.a, vars, prev);
      const b = ev(node.b, vars, prev);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      return a / b;
    }
    case "cmp": {
      const a = ev(node.a, vars, prev);
      const b = ev(node.b, vars, prev);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
      switch (node.op) {
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0;
        case "!=": return a !== b ? 1 : 0;
      }
      return 0;
    }
    case "call": {
      const { name, args } = node;
      if (name === "abs") return Math.abs(ev(args[0], vars, prev));
      if (name === "min") return Math.min(...args.map((a) => ev(a, vars, prev)));
      if (name === "max") return Math.max(...args.map((a) => ev(a, vars, prev)));
      // cross(a, b): a was on one side last bar and flipped to the other now.
      if (name === "crossabove" || name === "crossbelow") {
        if (args.length !== 2) throw new Error(`${name}() needs two arguments`);
        if (!prev) return 0;
        const aCur = ev(args[0], vars, prev);
        const bCur = ev(args[1], vars, prev);
        const aPrev = ev(args[0], prev, null);
        const bPrev = ev(args[1], prev, null);
        if (![aCur, bCur, aPrev, bPrev].every(Number.isFinite)) return 0;
        return name === "crossabove"
          ? aPrev <= bPrev && aCur > bCur ? 1 : 0
          : aPrev >= bPrev && aCur < bCur ? 1 : 0;
      }
      throw new Error(`Unknown function "${name}"`);
    }
  }
  throw new Error(`Bad node ${node.type}`);
}

/**
 * Compile rule text into { evaluate(vars, prevVars) -> boolean }.
 * Throws Error with a readable message on any syntax problem.
 */
export function compile(text) {
  const src = String(text || "").trim();
  if (!src) throw new Error("Rule is empty");
  const ast = parse(tokenize(src));
  return {
    ast,
    evaluate(vars, prevVars = null) {
      return truthy(ev(ast, vars, prevVars));
    },
  };
}
