import { useState } from "react";

export function subtypeOf(f) {
  return (f.config && f.config.subtype) || f.fieldType;
}

export function styleOf(f) {
  const c = f.config || {};
  return c.selectionType || c.booleanStyle || c.subtype || f.fieldType;
}

export function splitOptions(config) {
  const raw = config && config.options;
  if (Array.isArray(raw)) return raw.filter((o) => o !== null && o !== undefined);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function inputKind(f) {
  const sub = subtypeOf(f);
  const map = {
    // Text family
    email: { type: "email" },
    phone: { type: "tel" },
    url: { type: "url" },
    password: { type: "password" },
    // Date family
    time: { type: "time" },
    datetime: { type: "datetime-local" },
    date: { type: "date" },
    // Number family
    integer: { type: "number", step: 1 },
    decimal: { type: "number", step: "any" },
    percentage: { type: "number", step: "any", suffix: "%" },
    currency: { type: "number", step: "0.01", prefix: "$" },
    // Legacy / other
    duration: { type: "number", step: "any" },
    stars: { type: "range", min: 0, max: 5, step: 1 },
    rating: { type: "number", min: 0, max: 10 },
    progress: { type: "range", min: 0, max: 100, step: 1 },
    text: { type: "text" },
    single_line: { type: "text" },
    gps: { type: "text" },
    map: { type: "text" },
    department: { type: "text" },
    team: { type: "text" },
    lookup: { type: "text" },
    auto_number: { type: "text", readOnlyHint: true },
    formula: { type: "text", readOnlyHint: true },
    parent_record: { type: "text", readOnlyHint: true },
    hyperlink: { type: "url" },
    api_call: { type: "text", readOnlyHint: true },
    button: { type: "text", readOnlyHint: true },
    workflow_action: { type: "text", readOnlyHint: true },
    heading: { display: "heading" },
    label: { display: "label" },
    divider: { display: "divider" },
  };
  return map[sub] || map[f.fieldType] || { type: "text" };
}

const inputCls =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
// inputCls minus the top margin — used for inputs nested inside an mt-1 wrapper
// (e.g. prefixed/suffixed number inputs) to avoid a double margin.
const inputClsNoMargin = inputCls.replace(/^mt-1 /, "");

// Real file upload: reads the chosen file(s) into data URLs stored in the
// field value ({ name, type, size, url } — or an array for multi-file). No
// server storage is needed; the value round-trips through the JSON field.
function FileUploadControl({ f, value, onChange, disabled }) {
  const [reading, setReading] = useState(false);
  const sub = subtypeOf(f);
  const multiple = sub === "multi_file";
  const isImage = sub === "image" || sub === "signature";
  const items = multiple
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value]
      : [];

  function readFiles(files) {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setReading(true);
    Promise.all(
      fileList.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, type: file.type, size: file.size, url: reader.result });
            reader.readAsDataURL(file);
          })
      )
    ).then((loaded) => {
      setReading(false);
      onChange(multiple ? [...items, ...loaded] : loaded[0]);
    });
  }

  function remove(index) {
    if (multiple) {
      onChange(items.filter((_, i) => i !== index));
    } else {
      onChange(null);
    }
  }

  return (
    <div className="mt-1">
      <label
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        {reading ? "Reading…" : items.length > 0 ? (multiple ? "Add more files" : "Replace file") : "Upload file"}
        <input
          type="file"
          multiple={multiple}
          accept={isImage ? "image/*" : undefined}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            readFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs">
              {(isImage || (it.type || "").startsWith("image/")) && it.url ? (
                <img src={it.url} alt={it.name} className="h-8 w-8 shrink-0 rounded object-cover" />
              ) : (
                <span className="shrink-0 text-gray-400">📄</span>
              )}
              <span className="min-w-0 flex-1 truncate text-gray-700">{it.name}</span>
              {it.url && (
                <a href={it.url} download={it.name} className="shrink-0 text-indigo-600 hover:underline">
                  View
                </a>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 text-gray-400 hover:text-red-500"
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Password input with a show/hide toggle so the user can verify what they
// typed before submitting.
function PasswordControl({ value, onChange, disabled, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mt-1 relative">
      <input
        type={visible ? "text" : "password"}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClsNoMargin} pr-10`}
        placeholder={placeholder || undefined}
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-400 hover:text-gray-600 disabled:opacity-50"
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            <path
              fillRule="evenodd"
              d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 003.374 3.374l1.091 1.092a4 4 0 01-5.557-5.557z"
              clipRule="evenodd"
            />
            <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L4.18 7.36a8.51 8.51 0 00-.962 2.64A8.51 8.51 0 005.918 12.9a8.51 8.51 0 003.208 1.223l1.622-1.193zM16.752 13.6l1.513 1.513a10.05 10.05 0 001.276-3.102 1.651 1.651 0 000-1.186C18.014 6.66 14.38 4 10.116 4c-1.142 0-2.244.186-3.27.547l1.334 1.334a8.51 8.51 0 014.822 1.913 8.5 8.5 0 011.91 1.91l1.84-1.104z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// Controlled renderer for every field type. Parent supplies value + onChange;
// this component handles the input semantics (dropdown styles, boolean
// styles, number formats, assignee/user picker, file upload, display types).
export default function FieldControl({ f, value, onChange, users = [], developers = [], disabled = false }) {
  const kind = inputKind(f);
  const style = styleOf(f);
  const sub = subtypeOf(f);
  const readOnly = disabled || !!((f.config && f.config.readOnly) || kind.readOnlyHint);
  const placeholder = (f.config && f.config.placeholder) || "";
  const min = f.config && f.config.min !== undefined && f.config.min !== null ? f.config.min : undefined;
  const max = f.config && f.config.max !== undefined && f.config.max !== null ? f.config.max : undefined;

  if (f.config && f.config.hidden) return null;

  if (kind.display === "heading") return <h3 className="mt-1 text-base font-semibold text-gray-900">{f.label}</h3>;
  if (kind.display === "label") return <p className="mt-1 text-sm text-gray-500">{f.label}</p>;
  if (kind.display === "divider") return <hr className="mt-2 border-gray-200" />;
  if (["html", "image_display", "pdf"].includes(sub)) {
    return <p className="mt-1 text-sm text-gray-400">({f.label} — display element)</p>;
  }

  // Selection: dropdown / radio / checkbox list / multiselect
  if (f.fieldType === "dropdown" || f.fieldType === "multiselect") {
    const options = splitOptions(f.config);
    if (style === "radio") {
      return (
        <div className="mt-2 space-y-1.5">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name={f.id}
                checked={String(value ?? "") === String(o)}
                disabled={readOnly}
                onChange={() => onChange(o)}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    if (style === "checkbox_list") {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="mt-2 space-y-1.5">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={arr.includes(o)}
                disabled={readOnly}
                onChange={() => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    if (style === "multiselect" || f.fieldType === "multiselect") {
      const arr = Array.isArray(value) ? value : [];
      return (
        <select
          multiple
          disabled={readOnly}
          value={arr}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
          className={`${inputCls} h-auto`}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <select disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  switch (f.fieldType) {
    case "textarea":
      return (
        <textarea
          rows={3}
          disabled={readOnly}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          placeholder={placeholder || undefined}
        />
      );
    case "number":
    case "currency": {
      // Integer: whole numbers only — strip any decimals as the user types.
      const numeric = {
        type: kind.type || "number",
        step: kind.step,
        min,
        max,
        disabled: readOnly,
        placeholder: f.fieldType === "currency" ? "0.00" : placeholder || "0",
      };
      function handleNumber(e) {
        const raw = e.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        let num = Number(raw);
        if (Number.isNaN(num)) return;
        if (sub === "integer") num = Math.round(num);
        onChange(num);
      }
      if (kind.prefix || kind.suffix) {
        return (
          <div className="mt-1 flex items-center gap-1">
            {kind.prefix && <span className="text-sm text-gray-500">{kind.prefix}</span>}
            <input
              {...numeric}
              value={value ?? ""}
              onChange={handleNumber}
              className={inputClsNoMargin}
            />
            {kind.suffix && <span className="text-sm text-gray-500">{kind.suffix}</span>}
          </div>
        );
      }
      return (
        <input
          {...numeric}
          value={value ?? ""}
          onChange={handleNumber}
          className={inputCls}
        />
      );
    }
    case "date":
      return (
        <input
          type={kind.type || "date"}
          disabled={readOnly}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          min={min}
          max={max}
        />
      );
    case "checkbox": {
      if (style === "yes_no") {
        return (
          <select disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls}>
            <option value="">—</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        );
      }
      return (
        <input
          type="checkbox"
          disabled={readOnly}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
      );
    }
    // Assignee / user picker: draws from the org's Users & Roles list (the
    // developer master was retired as a duplicate). Legacy developer-based
    // stages still render when the users list is empty.
    case "user_picker": {
      const isApprover = style === "approver" || sub === "approver";
      const people = users.length > 0 ? users : developers;
      const options = people.filter((p) => p.active !== false);
      return (
        <select disabled={readOnly} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">{isApprover ? "Select an approver…" : "Select a user…"}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.email}
              {p.designation ? ` — ${p.designation}` : p.role ? ` — ${p.role}` : ""}
            </option>
          ))}
        </select>
      );
    }
    case "file":
      return <FileUploadControl f={f} value={value} onChange={onChange} disabled={readOnly} />;
    default: {
      // Password: dedicated control with show/hide toggle.
      if (sub === "password") {
        return (
          <PasswordControl
            value={value}
            onChange={onChange}
            disabled={readOnly}
            placeholder={placeholder}
          />
        );
      }
      return (
        <input
          type={kind.type || "text"}
          disabled={readOnly}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          placeholder={placeholder || undefined}
        />
      );
    }
  }
}
