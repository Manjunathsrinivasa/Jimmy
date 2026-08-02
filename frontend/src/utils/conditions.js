// Field-level conditional logic — mirrors backend/src/routes/projects.js
// evalCondition so the builder preview and the stage form evaluate rules
// identically.
//
// Field config shape:
//   config.conditions = {
//     enabled: true,
//     mode: "ALL" | "ANY",
//     rules: [
//       // Legacy show/hide rule (field shown only when the rules pass):
//       { sourceField, operator, compareValue }
//       // Modern effect rule (when the condition is true, apply a result):
//       {
//         sourceField,            // variable (current node or previous stage)
//         operator,
//         valueMode: "field" | "literal",
//         compareField,           // when valueMode === "field"
//         compareValue,           // when valueMode === "literal"
//         property: "hidden" | "readOnly" | "disabled" | "raise_error",
//         resultAction: "enable" | "disable",
//         resultText,             // error message for raise_error / text results
//       }
//     ]
//   }

// Numeric comparison that also understands dates: ISO date/time strings
// (e.g. "2026-08-02" or "2026-08-02T09:30") compare by their timestamp, so
// "start date after end date" style rules evaluate correctly instead of
// degrading to NaN. Empty values never match.
function toComparable(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? NaN : t;
}

export function evalCondition(cond, vars) {
  const { sourceField, operator, compareValue, compareField } = cond || {};
  const value = vars[sourceField];
  // Mirrors the backend: any truthy compareField is a field reference (legacy
  // rules predating valueMode set it without valueMode). Keeping the two
  // engines identical means previews, stage forms and decision nodes agree.
  const compare = compareField ? vars[compareField] : compareValue;
  switch (operator) {
    case "equals":
      return String(value ?? "") === String(compare ?? "");
    case "not_equals":
      return String(value ?? "") !== String(compare ?? "");
    case "greater_than":
      return toComparable(value) > toComparable(compare);
    case "greater_than_or_equal":
      return toComparable(value) >= toComparable(compare);
    case "less_than":
      return toComparable(value) < toComparable(compare);
    case "less_than_or_equal":
      return toComparable(value) <= toComparable(compare);
    case "between": {
      const [lo, hi] = String(compare ?? "")
        .split(",")
        .map((s) => toComparable(s.trim()));
      const v = toComparable(value);
      return !Number.isNaN(lo) && !Number.isNaN(hi) && v >= lo && v <= hi;
    }
    case "contains":
      return String(value ?? "").includes(String(compare ?? ""));
    case "does_not_contain":
      return !String(value ?? "").includes(String(compare ?? ""));
    case "starts_with":
      return String(value ?? "").startsWith(String(compare ?? ""));
    case "ends_with":
      return String(value ?? "").endsWith(String(compare ?? ""));
    case "is_empty":
      return value === null || value === undefined || value === "";
    case "is_not_empty":
      return !(value === null || value === undefined || value === "");
    case "true":
      return value === true || value === "true" || value === 1 || value === "1";
    case "false":
      return value === false || value === "false" || value === 0 || value === "0";
    case "regex": {
      try {
        return new RegExp(String(compare ?? "")).test(String(value ?? ""));
      } catch {
        return false;
      }
    }
    case "in_list": {
      const list = String(compare ?? "")
        .split(",")
        .map((s) => s.trim());
      return list.includes(String(value ?? ""));
    }
    default:
      return true;
  }
}

// Evaluate a field's conditions and return the effects to apply:
//   { show, readOnly, disabled, errors }
// Legacy rules (no `property`) behave as show/hide gates — the field is shown
// only when the rules pass. Modern rules trigger their own effect when their
// condition is true: hidden hides, readOnly locks, disabled greys out, and
// raise_error collects an error message (which disables submit until fixed).
export function evaluateFieldConditions(config, vars) {
  const result = { show: true, readOnly: false, disabled: false, errors: [] };
  const cond = config && config.conditions;
  if (!cond || cond.enabled === false || !Array.isArray(cond.rules) || cond.rules.length === 0) {
    return result;
  }
  const hasModern = cond.rules.some((r) => r.property);
  if (!hasModern) {
    const passed = cond.rules.map((r) => evalCondition(r, vars || {}));
    result.show = cond.mode === "ANY" ? passed.some(Boolean) : passed.every(Boolean);
    return result;
  }

  // The Match mode (ALL/ANY) gates the whole rule set, exactly like the
  // legacy path below: every rule must hit for effects to apply in ALL mode,
  // at least one in ANY mode. Without this gate, a lone true rule applied its
  // effect even when a second rule in ALL mode was false.
  const hits = cond.rules.map((r) => evalCondition(r, vars || {}));
  const overall = cond.mode === "ANY" ? hits.some(Boolean) : hits.every(Boolean);
  if (!overall) return result;

  for (let i = 0; i < cond.rules.length; i += 1) {
    const r = cond.rules[i];
    if (!hits[i]) continue;
    // resultAction "disable" means "do not apply the effect"; "enable" applies.
    const apply = r.resultAction !== "disable";
    switch (r.property) {
      case "hidden":
        if (apply) result.show = false;
        break;
      case "readOnly":
        if (apply) result.readOnly = true;
        break;
      case "disabled":
        if (apply) result.disabled = true;
        break;
      case "raise_error":
        if (apply && r.resultText && r.resultText.trim()) {
          result.errors.push(r.resultText.trim());
        }
        break;
      default:
        break;
    }
  }
  return result;
}

// A field is shown when its conditions are satisfied. No conditions (or
// conditions disabled / empty) -> always shown. ALL mode: every rule must be
// true; ANY mode: at least one rule true. (Legacy compatibility helper.)
export function fieldConditionsMet(config, vars) {
  return evaluateFieldConditions(config, vars).show;
}
