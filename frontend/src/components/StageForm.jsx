import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import FieldControl, { inputKind, styleOf, subtypeOf } from "./FieldControl";
import { listUsers } from "../api/users";
import { evaluateFieldConditions } from "../utils/conditions";

// Per-subtype validation so the "right" data format is enforced:
// email -> real email, url -> valid URL, phone -> number, integer -> whole
// number, percentage -> 0-100.
function rulesFor(f) {
  const sub = subtypeOf(f);
  const rules = {
    ...(f.required ? { required: "This field is required" } : {}),
    ...(f.config && f.config.regex
      ? {
          pattern: {
            value: new RegExp(f.config.regex),
            message: "Does not match the required format",
          },
        }
      : {}),
    ...(f.config && (f.config.maxLength || f.config.charLimit)
      ? { maxLength: f.config.maxLength || f.config.charLimit }
      : {}),
  };
  if (sub === "email") {
    rules.pattern = {
      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      message: "Enter a valid email address",
    };
  }
  if (sub === "url") {
    rules.pattern = {
      value: /^(https?:\/\/)?([\w-]+\.)+[a-zA-Z]{2,}(\/\S*)?$/,
      message: "Enter a valid URL",
    };
  }
  if (sub === "phone") {
    rules.pattern = {
      value: /^[0-9+()\-\s.]{7,20}$/,
      message: "Enter a valid phone number",
    };
  }
  if (sub === "integer") {
    rules.pattern = { value: /^-?\d+$/, message: "Whole numbers only" };
  }
  if (sub === "percentage") {
    rules.min = { value: 0, message: "Percentage must be 0–100" };
    rules.max = { value: 100, message: "Percentage must be 0–100" };
  }
  return rules;
}

export default function StageForm({ stage, onSubmitted, busy, variables, submitLabel = "Save & Mark Done" }) {
  // Assignee / user pickers draw their options from the org's Users & Roles
  // list (the developer master was retired as a duplicate of users).
  const [users, setUsers] = useState([]);
  const hasUserPicker = stage.fields.some((f) => f.fieldType === "user_picker");
  useEffect(() => {
    if (!hasUserPicker) return;
    let cancelled = false;
    listUsers()
      .then((d) => {
        if (!cancelled) setUsers(d.users);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasUserPicker]);

  const { control, handleSubmit, formState, watch, setValue } = useForm({
    defaultValues: Object.fromEntries(
      stage.fields.map((f) => {
        let v = f.value;
        const hasDefault = f.config && f.config.defaultValue !== undefined && f.config.defaultValue !== "";
        const style = styleOf(f);
        // Multi-value fields (checkbox list / multi select) default to arrays.
        if (f.fieldType === "multiselect" || style === "multiselect" || style === "checkbox_list") {
          v = Array.isArray(v) ? v : [];
        } else if (v === null || v === undefined) {
          v =
            f.fieldType === "checkbox"
              ? style === "yes_no"
                ? ""
                : false
              : hasDefault
                ? f.config.defaultValue
                : "";
        }
        if (f.fieldType === "number" || f.fieldType === "currency") {
          v = typeof v === "number" ? v : v === "" ? "" : Number(v);
        }
        if (f.fieldType === "date" && typeof v === "string" && v.length > 10) {
          v = v.slice(0, 10);
        }
        if (subtypeOf(f) === "datetime" && typeof v === "string" && v.length > 16) {
          v = v.slice(0, 16);
        }
        return [f.id, v];
      })
    ),
  });

  // Live values of the current stage, so conditions can compare fields
  // within the very stage being filled (e.g. start date > end date) as well
  // as values from connected previous stages.
  const watched = watch();

  // Condition variables: previous-stage values merged with the live form.
  const conditionVars = useMemo(() => {
    const vars = { ...(variables || {}) };
    for (const f of stage.fields) {
      const live = watched[f.id];
      if (live !== undefined && live !== null && live !== "") vars[f.id] = live;
    }
    return vars;
  }, [stage.fields, variables, watched]);

  // Evaluate every field's conditional logic against the merged variables.
  const evaluation = useMemo(() => {
    const map = {};
    for (const f of stage.fields) {
      map[f.id] = evaluateFieldConditions(f.config, conditionVars);
    }
    return map;
  }, [stage.fields, conditionVars]);

  // Auto-fill: when a field's condition copies another field's value
  // (valueMode "field", operator equals), populate the still-empty field with
  // that referenced value as soon as it's available — e.g. an assignee that
  // should equal the developer chosen in a previous stage, instead of asking
  // the user to pick it again.
  const autoFillValues = useMemo(() => {
    const map = {};
    for (const f of stage.fields) {
      const cur = watched[f.id];
      if (cur !== undefined && cur !== null && cur !== "") continue;
      const cond = f.config && f.config.conditions;
      // Disabled / empty conditional logic never auto-fills.
      if (!cond || cond.enabled === false || !Array.isArray(cond.rules)) continue;
      for (const r of cond.rules) {
        // Only "copy this field's value" rules auto-fill: an equals rule whose
        // value is another field, with an applied effect. Validation-only
        // rules (raise_error) and "do not apply" results never populate.
        if (
          r.valueMode === "field" &&
          r.operator === "equals" &&
          r.compareField &&
          r.property !== "raise_error" &&
          r.resultAction !== "disable"
        ) {
          const v = conditionVars[r.compareField];
          if (v !== undefined && v !== null && v !== "") {
            map[f.id] = v;
            break;
          }
        }
      }
    }
    return map;
  }, [stage.fields, conditionVars, watched]);

  // Write the auto-filled values into the form. Only fills fields that are
  // still empty, so a value the user typed or picked is never overwritten.
  useEffect(() => {
    for (const [fieldId, value] of Object.entries(autoFillValues)) {
      const cur = watched[fieldId];
      if (cur === undefined || cur === null || cur === "") {
        setValue(fieldId, value, { shouldValidate: true, shouldDirty: false });
      }
    }
  }, [autoFillValues, watched, setValue]);

  const visibleFields = useMemo(
    () =>
      stage.fields.filter(
        (f) => !(f.config && f.config.hidden) && evaluation[f.id]?.show !== false
      ),
    [stage.fields, evaluation]
  );

  // Any raised condition errors block submission until corrected.
  const conditionErrors = useMemo(
    () =>
      stage.fields.flatMap((f) => evaluation[f.id]?.errors || []).filter(Boolean),
    [stage.fields, evaluation]
  );

  async function onSubmit(values) {
    // Enter-key submission bypasses the disabled submit button, so guard the
    // handler itself — condition errors must block until corrected.
    if (conditionErrors.length > 0) return;
    const fieldValues = visibleFields.map((f) => {
      let value = values[f.id];
      // Multi-value fields (checkbox list / multi select) keep their array;
      // empty arrays are stored as null. Everything else: blank -> null.
      if (Array.isArray(value)) {
        if (value.length === 0) value = null;
      } else if (value === "" || value === undefined || Number.isNaN(value)) {
        value = null;
      }
      return { fieldDefinitionId: f.id, value };
    });
    await onSubmitted(fieldValues);
  }

  const submitBlocked = conditionErrors.length > 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {conditionErrors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-semibold text-red-700">
            The stage can't be submitted until these are fixed:
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {conditionErrors.map((msg, i) => (
              <li key={i} className="text-xs text-red-600">
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visibleFields.length === 0 ? (
        <p className="text-sm text-gray-500">
          This stage has no fields — just mark it done when your work is complete.
        </p>
      ) : (
        visibleFields.map((f) => {
          const kind = inputKind(f);
          const isDisplay =
            kind.display === "heading" ||
            kind.display === "label" ||
            kind.display === "divider" ||
            ["html", "image_display", "pdf"].includes(subtypeOf(f));
          const eff = evaluation[f.id] || {};
          const fieldErrors = eff.errors || [];
          const readOnly = !!((f.config && f.config.readOnly) || kind.readOnlyHint || eff.readOnly);
          const fieldDisabled = !!eff.disabled;
          return (
            <div key={f.id}>
              {!isDisplay && (
                <label htmlFor={f.id} className="block text-sm font-medium text-gray-700">
                  {f.label}
                  {f.required && <span className="ml-1 text-red-500">*</span>}
                </label>
              )}
              <Controller
                name={f.id}
                control={control}
                rules={rulesFor(f)}
                render={({ field }) => (
                  <FieldControl
                    f={f}
                    value={field.value}
                    onChange={field.onChange}
                    users={users}
                    disabled={readOnly || fieldDisabled || busy}
                  />
                )}
              />
              {formState.errors[f.id] && (
                <p className="mt-1 text-xs text-red-600">{formState.errors[f.id].message}</p>
              )}
              {fieldErrors.map((msg, i) => (
                <p key={i} className="mt-1 text-xs text-red-600">
                  ⚠ {msg}
                </p>
              ))}
            </div>
          );
        })
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || submitBlocked}
          title={submitBlocked ? "Fix the highlighted errors first" : undefined}
          className="btn btn-primary w-full"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {submitBlocked && (
          <span className="text-xs text-red-600">Submit disabled — fix the condition errors above.</span>
        )}
        {formState.isSubmitting && !busy && (
          <span className="text-sm text-gray-400">Submitting…</span>
        )}
      </div>
    </form>
  );
}
