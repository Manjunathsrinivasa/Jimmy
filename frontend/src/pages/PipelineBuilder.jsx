import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionLineType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import FlowNode from "../components/FlowNode";
import StageForm from "../components/StageForm";
import FieldControl from "../components/FieldControl";
import { evalCondition } from "../utils/conditions";
import AppLayout from "../components/AppLayout";
import {
  getPipeline,
  saveDraft,
  publishPipeline,
  unpublishPipeline,
  listVersions,
  restoreVersion,
  renamePipeline,
} from "../api/pipelines";

// One component registered under every node-type key (module scope so React
// Flow sees a stable reference).
// Kept registered so legacy pipelines (parallel fork/join, approval) still
// render, even though the palette only offers the four core types.
const NODE_TYPES = {
  start: FlowNode,
  stage: FlowNode,
  parallel_fork: FlowNode,
  parallel_join: FlowNode,
  decision: FlowNode,
  approval: FlowNode,
  end: FlowNode,
};

// Palette node types: all seven supported types (Start, Stage, Parallel
// Fork, Parallel Join, Decision, Approval, End).
const PALETTE = [
  { type: "start", label: "Start" },
  { type: "stage", label: "Stage" },
  { type: "parallel_fork", label: "Parallel Fork" },
  { type: "parallel_join", label: "Parallel Join" },
  { type: "decision", label: "Decision" },
  { type: "approval", label: "Approval" },
  { type: "end", label: "End" },
];

// Labels for every registered type (incl. legacy) for display purposes.
const TYPE_LABELS = {
  start: "Start",
  stage: "Stage",
  parallel_fork: "Parallel Fork",
  parallel_join: "Parallel Join",
  decision: "Decision",
  approval: "Approval",
  end: "End",
};

const LABELS = Object.fromEntries(PALETTE.map((p) => [p.type, p.label]));
const DOT_COLORS = {
  start: "bg-emerald-500",
  stage: "bg-sky-500",
  parallel_fork: "bg-amber-500",
  parallel_join: "bg-amber-500",
  decision: "bg-violet-500",
  approval: "bg-teal-500",
  end: "bg-rose-500",
};

// Consolidated field palette — ONE draggable item per family. The concrete
// variant (e.g. Email vs Password, Integer vs Currency) is picked in the
// field's own subtype selector, so "Text" covers single/multi line, rich
// text, email, phone, URL and password; "Number" covers integer/decimal/
// currency/percentage; "Date" covers date/date-time/time (Duration dropped).
// The "Assignee" field replaces the old User/Approver pickers and draws from
// the org's Users & Roles list at run time.
const FIELD_GROUPS = [
  {
    group: "Text",
    items: [{ label: "Text", base: "text", subtype: "single_line" }],
  },
  {
    group: "Number",
    items: [{ label: "Number", base: "number", subtype: "integer" }],
  },
  {
    group: "Date",
    items: [{ label: "Date", base: "date", subtype: "date" }],
  },
  {
    // Multi select / checkbox list / radio are properties of the single
    // "Dropdown" field (config.selectionType), not separate field types.
    group: "Selection",
    items: [{ label: "Dropdown", base: "dropdown", subtype: "dropdown" }],
  },
  {
    // Assignee replaces the old User/Approver pickers. It draws from the
    // org's Users & Roles list (the developer master was retired as a
    // duplicate of users).
    group: "User",
    items: [{ label: "Assignee", base: "user_picker", subtype: "assignee" }],
  },
  {
    // ONE draggable "File Upload" item — Single File / Image / Multiple
    // Files are picked in the field's own subtype selector (Signature
    // removed; legacy signature fields still render).
    group: "File",
    items: [{ label: "File Upload", base: "file", subtype: "file" }],
  },
  {
    // Checkbox / toggle / yes-no are a single field; the style is chosen via
    // config.booleanStyle.
    group: "Boolean",
    items: [{ label: "Checkbox", base: "checkbox", subtype: "checkbox" }],
  },
];

// Subtype options per base family — shown in the field's type selector.
const SUBTYPE_OPTIONS = {
  text: [
    { value: "single_line", label: "Single Line" },
    { value: "multi_line", label: "Multi Line", base: "textarea" },
    { value: "rich_text", label: "Rich Text", base: "textarea" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "url", label: "URL" },
    { value: "password", label: "Password" },
  ],
  number: [
    { value: "integer", label: "Integer" },
    { value: "decimal", label: "Decimal" },
    { value: "currency", label: "Currency", base: "currency" },
    { value: "percentage", label: "Percentage" },
  ],
  date: [
    { value: "date", label: "Date" },
    { value: "datetime", label: "Date & Time" },
    { value: "time", label: "Time" },
  ],
  file: [
    { value: "file", label: "Single File" },
    { value: "image", label: "Image" },
    { value: "multi_file", label: "Multiple Files" },
  ],
};

// The base fieldType a subtype maps to (multi line/rich text live on
// textarea, currency on currency). Used when the subtype changes.
const FAMILY_DEFAULT_BASE = { text: "text", number: "number", date: "date", file: "file" };

function baseForSubtype(subtype) {
  for (const [family, list] of Object.entries(SUBTYPE_OPTIONS)) {
    const hit = list.find((s) => s.value === subtype);
    if (hit) return hit.base || FAMILY_DEFAULT_BASE[family] || "text";
  }
  return "text";
}

// The family (text/number/date) a field belongs to, derived from its subtype
// so a multi_line field (base textarea) still offers the text-family options.
function familyOfField(f) {
  const sub = (f.config && f.config.subtype) || f.fieldType;
  for (const family of Object.keys(SUBTYPE_OPTIONS)) {
    if (SUBTYPE_OPTIONS[family].some((s) => s.value === sub)) return family;
  }
  return null;
}

// Select value for the subtype selector. Legacy fields (fieldType "text"
// with no config.subtype) fall back to the family's first option instead of
// showing a blank, so the dropdown always renders a valid selection.
function legacySubtypeValue(f) {
  const family = familyOfField(f);
  if (!family) return "";
  const sub = (f.config && f.config.subtype) || f.fieldType;
  if (SUBTYPE_OPTIONS[family].some((s) => s.value === sub)) return sub;
  return SUBTYPE_OPTIONS[family][0].value;
}

// Display names for every backend enum value (covers the palette + older/seed types).
const FIELD_TYPE_LABELS = {
  text: "Text",
  textarea: "Text Area",
  number: "Number",
  currency: "Currency",
  date: "Date",
  dropdown: "Dropdown",
  multiselect: "Multi-select",
  file: "File Upload",
  user_picker: "User Picker",
  checkbox: "Checkbox",
};

const FIELD_TYPE_DOTS = {
  text: "bg-gray-400",
  textarea: "bg-gray-400",
  number: "bg-blue-500",
  currency: "bg-emerald-500",
  date: "bg-indigo-500",
  dropdown: "bg-violet-500",
  multiselect: "bg-violet-500",
  file: "bg-amber-500",
  user_picker: "bg-teal-500",
  checkbox: "bg-pink-500",
};

// Decision rule operators (mirrors backend evaluation).
const OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "contains",
  "does_not_contain",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "true",
  "false",
  "regex",
  "in_list",
];

const OP_LABELS = {
  equals: "Equals",
  not_equals: "Not Equals",
  greater_than: "Greater Than",
  greater_than_or_equal: "Greater Than or Equal",
  less_than: "Less Than",
  less_than_or_equal: "Less Than or Equal",
  between: "Between",
  contains: "Contains",
  does_not_contain: "Does Not Contain",
  starts_with: "Starts With",
  ends_with: "Ends With",
  is_empty: "Is Empty",
  is_not_empty: "Is Not Empty",
  true: "True",
  false: "False",
  regex: "Regex",
  in_list: "In List",
};

// Common field properties: [key, label, kind, options?]. Stored in field.config.
const COMMON_PROPERTIES = [
  { key: "internalName", label: "Internal Name", kind: "text" },
  { key: "description", label: "Description", kind: "textarea" },
  { key: "placeholder", label: "Placeholder", kind: "text" },
  { key: "defaultValue", label: "Default Value", kind: "text" },
  { key: "readOnly", label: "Read Only", kind: "checkbox" },
  { key: "hidden", label: "Hidden", kind: "checkbox" },
  { key: "unique", label: "Unique", kind: "checkbox" },
  { key: "min", label: "Min", kind: "number" },
  { key: "max", label: "Max", kind: "number" },
  { key: "charLimit", label: "Character Limit", kind: "number" },
  { key: "regex", label: "Regex", kind: "text" },
  { key: "width", label: "Width", kind: "select", options: ["", "full", "half", "third", "quarter"] },
  { key: "height", label: "Height", kind: "text" },
  { key: "alignment", label: "Alignment", kind: "select", options: ["", "left", "center", "right"] },
  { key: "icon", label: "Icon", kind: "text" },
  { key: "color", label: "Color", kind: "text" },
  { key: "cssClass", label: "CSS Class", kind: "text" },
  { key: "permissions", label: "Permissions", kind: "text" },
  { key: "assignedUser", label: "Assigned User", kind: "text" },
  { key: "approver", label: "Approver", kind: "text" },
  { key: "dueDate", label: "Due Date", kind: "checkbox" },
  { key: "notification", label: "Notification", kind: "checkbox" },
  { key: "showIf", label: "Show If", kind: "text" },
  { key: "hideIf", label: "Hide If", kind: "text" },
  { key: "enableIf", label: "Enable If", kind: "text" },
  { key: "disableIf", label: "Disable If", kind: "text" },
  { key: "autoPopulate", label: "Auto Populate", kind: "text" },
  { key: "formula", label: "Formula", kind: "text" },
  { key: "searchable", label: "Searchable", kind: "checkbox" },
  { key: "sortable", label: "Sortable", kind: "checkbox" },
  { key: "filterable", label: "Filterable", kind: "checkbox" },
  { key: "exportable", label: "Exportable", kind: "checkbox" },
  { key: "auditHistory", label: "Audit History", kind: "checkbox" },
];

// Per-field-type property sets: only properties that make sense for the
// field's base type are offered (no character limits on dates, no min/max on
// checkboxes, etc.). Keys are COMMON_PROPERTIES keys.
function commonPropertiesFor(f) {
  const base = f.fieldType;
  const keep = (keys) => COMMON_PROPERTIES.filter((p) => keys.includes(p.key));
  let props;
  switch (base) {
    case "checkbox":
      props = keep([
        "internalName", "description", "defaultValue", "readOnly", "hidden",
        "unique", "permissions", "showIf", "hideIf", "enableIf", "disableIf",
        "auditHistory",
      ]);
      break;
    case "dropdown":
    case "multiselect":
      props = keep([
        "internalName", "description", "placeholder", "defaultValue", "readOnly",
        "hidden", "unique", "width", "permissions", "showIf", "hideIf",
        "enableIf", "disableIf", "searchable", "filterable", "exportable",
        "auditHistory",
      ]);
      break;
    case "file":
      props = keep([
        "internalName", "description", "placeholder", "defaultValue", "readOnly",
        "hidden", "unique", "width", "permissions", "showIf", "hideIf",
        "enableIf", "disableIf", "exportable", "auditHistory",
      ]);
      break;
    case "user_picker":
      props = keep([
        "internalName", "description", "placeholder", "readOnly", "hidden",
        "unique", "width", "permissions", "approver", "showIf", "hideIf",
        "enableIf", "disableIf", "searchable", "filterable", "exportable",
        "auditHistory",
      ]);
      break;
    case "date":
      props = keep([
        "internalName", "description", "defaultValue", "readOnly", "hidden",
        "unique", "min", "max", "width", "permissions", "dueDate", "showIf",
        "hideIf", "enableIf", "disableIf", "searchable", "sortable",
        "filterable", "exportable", "auditHistory",
      ]);
      break;
    case "number":
    case "currency":
      props = keep([
        "internalName", "description", "placeholder", "defaultValue", "readOnly",
        "hidden", "unique", "min", "max", "width", "permissions", "formula",
        "autoPopulate", "showIf", "hideIf", "enableIf", "disableIf",
        "searchable", "sortable", "filterable", "exportable", "auditHistory",
      ]);
      break;
    case "textarea":
      props = keep([
        "internalName", "description", "placeholder", "defaultValue", "readOnly",
        "hidden", "unique", "charLimit", "height", "permissions", "formula",
        "showIf", "hideIf", "enableIf", "disableIf", "searchable", "exportable",
        "auditHistory",
      ]);
      break;
    default:
      props = COMMON_PROPERTIES;
  }
  // Type-aware input kinds: min/max are date pickers for date fields.
  return props.map((p) => {
    if (base === "date" && (p.key === "min" || p.key === "max")) {
      return { ...p, kind: "date" };
    }
    return p;
  });
}

// Keep each field's `order` in sync with its position in the array.
function renumberFields(fields) {
  return fields.map((f, i) => ({ ...f, order: i }));
}

// Dropdown-based fields render an options editor (dropdown / multiselect /
// checkbox list / radio). Legacy multiselect fields are included too.
function isSelectionField(f) {
  return f.fieldType === "dropdown" || f.fieldType === "multiselect";
}

// True when the field's subtype can be switched in the type selector.
function hasSubtypeOptions(f) {
  return familyOfField(f) !== null;
}

// Options are stored as an array; older data may hold a comma string.
function toOptionsArray(config) {
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

function uid(prefix) {
  const rand = crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

const GRID_SIZE = 20;

function uniqueLabel(base, existingNodes) {
  const taken = new Set(existingNodes.map((n) => n.data.label));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

function snapToGrid(position) {
  return {
    x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
  };
}

// Deep-clone a node for copy/paste: fresh ids for the copy's fields and a
// remap of every condition reference to those fields, so a pasted node never
// shares variable keys with the original (field ids are workflow-global
// variable keys). References to OTHER nodes' fields stay untouched — those
// nodes still exist with their original ids.
function cloneNodeWithNewIds(node) {
  const data = JSON.parse(JSON.stringify(node.data || {}));
  const idMap = new Map();
  data.fields = (data.fields || []).map((f) => {
    const newId = uid("fld");
    idMap.set(f.id, newId);
    return { ...f, id: newId };
  });
  const remap = (v) => (idMap.has(v) ? idMap.get(v) : v);
  for (const f of data.fields) {
    const rules = f.config && f.config.conditions && f.config.conditions.rules;
    if (Array.isArray(rules)) {
      for (const r of rules) {
        if (r.sourceField) r.sourceField = remap(r.sourceField);
        if (r.compareField) r.compareField = remap(r.compareField);
      }
    }
  }
  return data;
}

function autoLayout(nodes, edges) {
  const byId = new Set(nodes.map((n) => n.id));
  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const indegree = new Map();
  const adj = new Map();
  const edgeLabel = new Map();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indegree.set(e.target, indegree.get(e.target) + 1);
    edgeLabel.set(`${e.source}>${e.target}`, String(e.label || "").toUpperCase());
  }
  const roots = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);

  // Level = longest path from any root.
  const level = new Map();
  const indeg = new Map(indegree);
  const queue = [...roots];
  for (const id of roots) level.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift();
    for (const t of adj.get(id)) {
      const candidate = level.get(id) + 1;
      if (candidate > (level.get(t) ?? -1)) level.set(t, candidate);
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  let maxLevel = nodes.length > 0 ? Math.max(0, ...level.values()) : 0;
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, ++maxLevel);
  }

  // Track: a decision's YES branches run above it and NO branches below;
  // every node downstream of a branch keeps its track until branches merge
  // (a merge point is centered between its incoming tracks).
  const track = new Map();
  const trackQueue = [...roots];
  for (const id of roots) track.set(id, 0);
  while (trackQueue.length > 0) {
    const id = trackQueue.shift();
    const base = track.get(id) ?? 0;
    for (const t of adj.get(id)) {
      const label = edgeLabel.get(`${id}>${t}`);
      let tt = base;
      if (typeById.get(id) === "decision") {
        if (label === "YES") tt = base - 1;
        else if (label === "NO") tt = base + 1;
        // unlabeled legacy decision edges stay on the same track
      }
      if (track.has(t)) {
        track.set(t, (track.get(t) + tt) / 2);
      } else {
        track.set(t, tt);
        trackQueue.push(t);
      }
    }
  }
  for (const n of nodes) {
    if (!track.has(n.id)) track.set(n.id, 0);
  }

  const H_GAP = 220;
  const V_GAP = 150;
  const groups = new Map();
  for (const n of nodes) {
    const key = `${level.get(n.id)}|${track.get(n.id)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n.id);
  }

  const positions = new Map();
  for (const [key, ids] of groups) {
    const [lvl, tr] = key.split("|").map(Number);
    ids.forEach((id, i) => {
      positions.set(id, {
        x: lvl * H_GAP,
        y: tr * V_GAP + (i - (ids.length - 1) / 2) * 56,
      });
    });
  }
  return positions;
}

// Backend nodes/edges <-> React Flow nodes/edges (config + labels preserved).
// `onExpand` (builder only) wires each node's small expand arrow to the stage
// test modal, so fields can be validated before publishing.
function toFlowNodes(backendNodes, onExpand) {
  return (backendNodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.positionX, y: n.positionY },
    data: {
      label: n.label || "",
      nodeType: n.type,
      fields: n.fields || [],
      config: n.config || {},
      ...(onExpand ? { onExpand: () => onExpand(n.id) } : {}),
    },
  }));
}

function normalizeEdgeLabel(label) {
  const up = String(label || "").toUpperCase();
  return up === "YES" || up === "NO" ? up : undefined;
}

function toFlowEdges(backendEdges) {
  return (backendEdges || []).map((e) => {
    const label = normalizeEdgeLabel(e.label);
    return {
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      // Decision edges carry a YES/NO label; map it back onto the matching
      // source handle so the edge attaches to the right output port.
      label,
      sourceHandle: label,
    };
  });
}

function toBackendGraph(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.data.label,
      positionX: n.position.x,
      positionY: n.position.y,
      config: n.data.config || {},
      fields: n.data.fields || [],
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      targetNodeId: e.target,
      label: e.label || undefined,
    })),
  };
}

// Nodes that can reach `startId` via edges (reverse reachability) — the
// "connected parent" set whose variables a decision node may reference.
function connectedAncestors(nodes, edges, startId) {
  const reverse = new Map();
  for (const e of edges) {
    if (!reverse.has(e.target)) reverse.set(e.target, []);
    reverse.get(e.target).push(e.source);
  }
  const seen = new Set([startId]);
  const stack = [startId];
  const ancestors = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    for (const src of reverse.get(id) || []) {
      if (!seen.has(src)) {
        seen.add(src);
        ancestors.add(src);
        stack.push(src);
      }
    }
  }
  return [...ancestors];
}

// Topological order of node ids following edges (Kahn's algorithm). Nodes
// left out by cycles/disconnected graphs are appended at the end so every
// node is always included. Powers the full-workflow test run and the spec.
function orderNodesByEdges(nodes, edges) {
  const byId = new Set(nodes.map((n) => n.id));
  const indegree = new Map();
  const adj = new Map();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indegree.set(e.target, indegree.get(e.target) + 1);
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const next of adj.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  for (const n of nodes) if (!ordered.includes(n.id)) ordered.push(n.id);
  return ordered;
}

// All node ids reachable from `starts` following edges. Used to mark the
// non-chosen decision branch as skipped in the test run.
function reachableSet(edges, starts) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of adj.get(id) || []) stack.push(t);
  }
  return seen;
}

// Client-side mirror of the backend's decision evaluation (ALL mode every
// condition true, ANY at least one). Disabled/empty config falls back to
// defaultOutput, so the test run matches a real project exactly.
function decisionTakesYes(config, vars) {
  const dec = config || {};
  const conditions = Array.isArray(dec.conditions) ? dec.conditions : [];
  if (dec.enabled === false || conditions.length === 0) {
    return (dec.defaultOutput || "YES") === "YES";
  }
  const results = conditions.map((c) => evalCondition(c, vars));
  return dec.conditionMode === "ANY" ? results.some(Boolean) : results.every(Boolean);
}

// ---- Shared small inputs -----------------------------------------------
const inputCls = "input mt-1";
const labelCls = "block text-xs font-medium text-gray-600";

function Builder({ pipelineId }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState(null);
  const [expandedField, setExpandedField] = useState(null); // field id with open properties
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [testNodeId, setTestNodeId] = useState(null); // node open in the stage test modal
  const [testNotice, setTestNotice] = useState(null);
  const [sampleVars, setSampleVars] = useState({}); // sample values for previous stages in the test modal
  const [showTestRun, setShowTestRun] = useState(false); // full-workflow walkthrough
  const [showSpec, setShowSpec] = useState(false); // printable workflow spec
  const clipboardRef = useRef(null); // serialized node for copy/paste
  const lastPastePosRef = useRef(null); // position of the most recent paste (cascade)

  // Opens the stage-test modal for a node (called from each node's expand
  // arrow). The modal previews the node's fields as a live form so validation
  // can be checked before publishing.
  const openTest = useCallback((nodeId) => {
    setTestNotice(null);
    setSampleVars({});
    setTestNodeId(nodeId);
  }, []);

  const { screenToFlowPosition, fitView } = useReactFlow();

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  const testNode = useMemo(
    () => nodes.find((n) => n.id === testNodeId) || null,
    [nodes, testNodeId]
  );

  // Connected previous stages that may feed the stage under test — their
  // fields become "sample values" so cross-stage conditional logic (e.g.
  // stage2.cost equals stage1.cost) can be exercised before publishing.
  const testAncestorNodes = useMemo(() => {
    if (!testNode) return [];
    const ids = new Set(connectedAncestors(nodes, edges, testNode.id));
    return nodes.filter((n) => ids.has(n.id) && (n.data.fields || []).length > 0);
  }, [nodes, edges, testNode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      setSelectedId(null);
      setNotice(null);
      setLoaded(false);
      try {
        const data = await getPipeline(pipelineId);
        if (cancelled) return;
        setPipeline(data.pipeline);
        setNodes(toFlowNodes(data.pipeline.nodes, openTest));
        setEdges(toFlowEdges(data.pipeline.edges));
        setLoaded(true);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId, setNodes, setEdges, openTest]);

  useEffect(() => {
    if (loaded) {
      const t = setTimeout(() => fitView({ padding: 0.15 }), 50);
      return () => clearTimeout(t);
    }
  }, [loaded, fitView]);

  const loadVersions = useCallback(async () => {
    try {
      const d = await listVersions(pipelineId);
      setVersions(d.versions);
    } catch {
      setVersions([]);
    }
  }, [pipelineId]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !LABELS[type]) return;
      const position = snapToGrid(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      setNodes((nds) => {
        const nodeId = uid("node");
        return nds.concat({
          id: nodeId,
          type,
          position,
          data: {
            label: uniqueLabel(LABELS[type], nds),
            nodeType: type,
            fields: [],
            config: {},
            onExpand: () => openTest(nodeId),
          },
        });
      });
    },
    [screenToFlowPosition, setNodes]
  );

  const onConnect = useCallback(
    (params) => {
      // Edges dragged off a decision node's YES/NO handle inherits its label.
      const label = normalizeEdgeLabel(params.sourceHandle);
      setEdges((eds) => addEdge({ ...params, id: uid("edge"), label }, eds));
    },
    [setEdges]
  );


  // Enforce the decision-node input contract while wiring: exactly one input
  // (a second incoming edge is rejected). Outputs may fan out to any number
  // of nodes — each edge inherits the YES/NO label of the handle it was
  // dragged from, and save/publish validation requires both branches.
  const isValidConnection = useCallback(
    (conn) => {
      // No self-loops: a node cannot be its own input.
      if (conn.source === conn.target) return false;
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      if (!sourceNode || !targetNode) return false;
      if (targetNode.type === "decision") {
        const incoming = edges.filter((e) => e.target === targetNode.id);
        if (incoming.length >= 1) return false; // decision already has its one input
      }
      return true;
    },
    [nodes, edges]
  );

  function updateLabel(value) {
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, label: value } } : n))
    );
  }

  function updateNodeConfig(patch) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n
      )
    );
  }

  function deleteSelectedNode() {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }

  // ---- Copy / paste a node (with its fields + config) ----
  function copySelectedNode() {
    if (!selectedNode) return;
    // JSON round-trip drops the onExpand closure; the paste re-binds it to the
    // new node id, and field ids get remapped by cloneNodeWithNewIds on paste.
    clipboardRef.current = JSON.parse(JSON.stringify(selectedNode));
    lastPastePosRef.current = null; // next paste anchors to the copied node
    setNotice({ kind: "ok", text: `Copied "${selectedNode.data.label}" — press Ctrl/Cmd+V to paste.` });
  }

  function pasteNode() {
    const src = clipboardRef.current;
    if (!src) {
      setNotice({ kind: "err", text: "Nothing copied yet — select a node and press Ctrl/Cmd+C first." });
      return;
    }
    const nodeId = uid("node");
    const data = cloneNodeWithNewIds(src);
    // Base = the currently selected node (after the first paste that's the
    // pasted copy itself, since paste auto-selects it), falling back to the
    // last pasted position, then the copied node's original position.
    const base = selectedNode
      ? selectedNode.position
      : lastPastePosRef.current || src.position || { x: 0, y: 0 };
    // Constant 40px cascade: each paste sits 40px down-right of the previous
    // one, so rapid pastes spread linearly instead of stacking or flying off.
    const position = snapToGrid({ x: base.x + 40, y: base.y + 40 });
    lastPastePosRef.current = position;
    setNodes((nds) =>
      nds.concat({
        id: nodeId,
        type: src.type,
        position,
        data: {
          ...data,
          label: uniqueLabel(src.data.label || TYPE_LABELS[src.type] || src.type, nds),
          nodeType: src.type,
          onExpand: () => openTest(nodeId),
        },
      })
    );
    setSelectedId(nodeId); // select the copy so it can be edited/moved immediately
    setNotice({ kind: "ok", text: `Pasted "${src.data.label || src.type}".` });
  }

  // Global Ctrl/Cmd+C and Ctrl/Cmd+V (capture phase, so React Flow's own
  // key handling never interferes; inputs/selects keep their native behavior).
  useEffect(() => {
    function onKeyDown(e) {
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        e.stopPropagation();
        copySelectedNode();
      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        e.stopPropagation();
        pasteNode();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  // ---- Edge label assignment (decision YES/NO outputs) ----
  // Fan-out is allowed: several edges may share the same branch label, so an
  // edge simply keeps the label + port it was assigned. The pair rule (at
  // least one YES and one NO) is enforced by save/publish validation.
  function setEdgeLabel(edgeId, label) {
    const normalized = normalizeEdgeLabel(label);
    setEdges((eds) =>
      eds.map((e) =>
        e.id === edgeId ? { ...e, label: normalized, sourceHandle: normalized } : e
      )
    );
  }

  // ---- Field definition editing (selected node's data.fields) ----
  const fieldsListRef = useRef(null);
  const [listDragActive, setListDragActive] = useState(false);
  const dragDepth = useRef(0);

  function updateSelectedFields(mutator) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, fields: renumberFields(mutator(n.data.fields || [])) } }
          : n
      )
    );
  }

  function updateField(fieldId, patch) {
    updateSelectedFields((fields) =>
      fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f))
    );
  }

  function updateFieldConfig(fieldId, patch) {
    updateSelectedFields((fields) =>
      fields.map((f) => (f.id === fieldId ? { ...f, config: { ...(f.config || {}), ...patch } } : f))
    );
  }

  function removeField(fieldId) {
    updateSelectedFields((fields) => fields.filter((f) => f.id !== fieldId));
  }

  function moveField(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    updateSelectedFields((fields) => {
      const next = fields.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(fromIndex < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
  }

  function dropIndexFromPointer(event) {
    const rows = Array.from(fieldsListRef.current?.querySelectorAll("[data-field-row]") || []);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  }

  function handleFieldsDragOver(event) {
    event.preventDefault();
    const adding = event.dataTransfer.types.includes("application/yojan-field-type");
    event.dataTransfer.dropEffect = adding ? "copy" : "move";
  }

  function handleFieldsDragEnter() {
    dragDepth.current += 1;
    setListDragActive(true);
  }

  function handleFieldsDragLeave() {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setListDragActive(false);
    }
  }

  function handleFieldsDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setListDragActive(false);

    const payload = event.dataTransfer.getData("application/yojan-field-type");
    if (payload) {
      let item;
      try {
        item = JSON.parse(payload);
      } catch {
        item = null;
      }
      if (item && item.base) {
        const index = dropIndexFromPointer(event);
        updateSelectedFields((fields) => {
          const next = fields.slice();
          next.splice(index, 0, {
            id: uid("fld"),
            label: item.label,
            fieldType: item.base,
            required: false,
            order: index,
            config: { subtype: item.subtype, options: "" },
          });
          return next;
        });
        return;
      }
    }

    const from = event.dataTransfer.getData("application/yojan-field-reorder");
    if (from !== "") {
      moveField(Number(from), dropIndexFromPointer(event));
    }
  }

  function handleAutoLayout() {
    const positions = autoLayout(nodes, edges);
    setNodes((nds) =>
      nds.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, position: snapToGrid(p) } : n;
      })
    );
    setTimeout(() => fitView({ padding: 0.15 }), 50);
  }

  // Client-side mirror of the backend's decision-node validation, so the
  // builder surfaces problems before Save/Publish instead of failing silently.
  const decisionErrors = useMemo(() => {
    const errors = [];
    for (const n of nodes) {
      if (n.type !== "decision") continue;
      const incoming = edges.filter((e) => e.target === n.id);
      const outgoing = edges.filter((e) => e.source === n.id);
      if (incoming.length !== 1) {
        errors.push(`"${n.data.label}" needs exactly 1 input (has ${incoming.length})`);
      }
      if (outgoing.length < 2) {
        errors.push(`"${n.data.label}" needs at least 2 outputs (has ${outgoing.length})`);
      } else {
        const hasYes = outgoing.some((e) => String(e.label || "").toUpperCase() === "YES");
        const hasNo = outgoing.some((e) => String(e.label || "").toUpperCase() === "NO");
        if (!hasYes || !hasNo) {
          errors.push(`"${n.data.label}" outputs must include at least one YES and one NO`);
        }
      }
    }
    return errors;
  }, [nodes, edges]);

  async function handleSave() {
    if (decisionErrors.length > 0) {
      setNotice({ kind: "err", text: `Fix decision nodes first: ${decisionErrors.join("; ")}` });
      return;
    }
    setBusy(true);
    setNotice(null);
    const wasPublished = pipeline?.status === "published";
    try {
      const data = await saveDraft(pipelineId, toBackendGraph(nodes, edges));
      // Adopt the server's version info (a save may branch a new version when
      // the previous one is referenced by projects or the pipeline was
      // published) without resetting the canvas.
      setPipeline((prev) => ({
        ...prev,
        versionId: data.pipeline.versionId,
        versionNumber: data.pipeline.versionNumber,
        status: data.pipeline.status,
      }));
      setNotice({
        kind: "ok",
        text: wasPublished
          ? "Saved as a new draft — publish again to make it available for new projects."
          : "Draft saved.",
      });
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (decisionErrors.length > 0) {
      setNotice({ kind: "err", text: `Fix decision nodes first: ${decisionErrors.join("; ")}` });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const data = await publishPipeline(pipelineId);
      setPipeline(data.pipeline);
      setNotice({ kind: "ok", text: "Pipeline published." });
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    if (!window.confirm("Unpublish this pipeline? It returns to draft — existing projects are unaffected.")) return;
    setBusy(true);
    setNotice(null);
    try {
      await unpublishPipeline(pipelineId);
      setPipeline((prev) => ({ ...prev, status: "draft" }));
      setNotice({ kind: "ok", text: "Pipeline unpublished — back to draft." });
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function commitName() {
    const next = (nameDraft || "").trim();
    setEditingName(false);
    if (!next || next === pipeline?.name) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await renamePipeline(pipelineId, next);
      setPipeline((prev) => ({ ...prev, name: data.pipeline.name }));
      setNotice({ kind: "ok", text: "Pipeline renamed." });
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(versionId) {
    if (!window.confirm("Restore this version as the current workflow? Existing projects are unaffected.")) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await restoreVersion(pipelineId, versionId);
      setPipeline(data.pipeline);
      setNodes(toFlowNodes(data.pipeline.nodes, openTest));
      setEdges(toFlowEdges(data.pipeline.edges));
      setShowHistory(false);
      setNotice({ kind: "ok", text: "Version restored." });
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const published = pipeline && pipeline.status === "published";
  const archived = pipeline && pipeline.status === "archived";
  // Drafts are always editable; published pipelines are too (saving branches
  // a fresh draft version, so existing projects keep the published snapshot).
  const editable = !archived;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center text-sm text-gray-500">Loading pipeline…</div>
      </AppLayout>
    );
  }
  if (loadError) {
    return (
      <AppLayout>
        <div className="flex h-screen flex-col items-center justify-center gap-3">
          <p className="text-sm text-red-600">{loadError}</p>
          <Link to="/pipelines" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            ← Back to pipelines
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/pipelines" className="text-sm text-gray-500 hover:text-gray-700">
            ← Pipelines
          </Link>
          {editingName ? (
            <input
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  // Cancel: reset the draft so the blur-triggered commit is a no-op.
                  setNameDraft(pipeline?.name || "");
                  setEditingName(false);
                }
              }}
              className="w-56 rounded-md border border-indigo-300 px-2 py-0.5 text-sm font-semibold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          ) : (
            <h1 className="text-sm font-semibold text-gray-900">{pipeline?.name}</h1>
          )}
          <button
            onClick={() => {
              setNameDraft(pipeline?.name || "");
              setEditingName(true);
            }}
            disabled={busy || !pipeline}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            title="Rename pipeline (allowed even when published)"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              published
                ? "bg-emerald-100 text-emerald-700"
                : archived
                  ? "bg-gray-200 text-gray-600"
                  : "bg-amber-100 text-amber-700"
            }`}
          >
            {pipeline?.status}
          </span>
          {pipeline?.versionNumber != null && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              v{pipeline.versionNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {notice && (
            <span className={`text-xs ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {notice.text}
            </span>
          )}
          {decisionErrors.length > 0 && (
            <span className="max-w-xs truncate text-xs font-medium text-amber-600" title={decisionErrors.join("\n")}>
              ⚠ {decisionErrors.length} decision issue{decisionErrors.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            onClick={() => {
              setShowHistory((v) => !v);
              if (!versions) loadVersions();
            }}
            disabled={busy}
            className="btn btn-secondary"
            title="Workflow version history"
          >
            History
          </button>
          <button
            onClick={handleAutoLayout}
            disabled={busy}
            className="btn btn-secondary"
            title="Arrange nodes by pipeline order"
          >
            Auto-layout
          </button>
          <button
            onClick={() => setShowTestRun(true)}
            disabled={busy || nodes.length === 0}
            className="btn border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            title="Walk the whole workflow with sample values to validate it before publishing"
          >
            ▶ Test run
          </button>
          <button
            onClick={() => setShowSpec(true)}
            disabled={busy || nodes.length === 0}
            className="btn btn-secondary"
            title="Print or export a one-page workflow spec"
          >
            Print spec
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !editable}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              archived
                ? "Archived pipelines cannot be edited"
                : published
                  ? "Save as a new draft — existing projects keep the published workflow"
                  : undefined
            }
          >
            Save Draft
          </button>
          {published && (
            <button
              onClick={handleUnpublish}
              disabled={busy}
              className="btn btn-secondary"
              title="Return to draft — existing projects keep the published workflow"
            >
              Unpublish
            </button>
          )}
          <button
            onClick={handlePublish}
            disabled={busy || !editable || published}
            className="btn btn-primary"
          >
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </header>

      {showHistory && (
        <div className="border-b border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Version history</p>
          {versions === null ? (
            <p className="mt-2 text-sm text-gray-400">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">No versions yet.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-gray-700">v{v.versionNumber}</span>
                  <span className="text-gray-400">
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-gray-400">
                    {v._count.projects} project{v._count.projects === 1 ? "" : "s"}
                  </span>
                  {v.id === pipeline?.versionId ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700">
                      current
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRestore(v.id)}
                      disabled={busy}
                      className="btn btn-primary px-2 py-0.5 text-xs"
                    >
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Palette — node types; the field-types palette is docked on the right */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Node types</p>
          <p className="mt-1 text-xs text-gray-400">Drag a type from the left palette onto the canvas</p>
          <div className="mt-3 space-y-2">
            {PALETTE.map((p) => (
              <div
                key={p.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/reactflow", p.type);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="flex cursor-grab items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 active:cursor-grabbing"
              >
                <span className={`h-2 w-2 ${DOT_COLORS[p.type]} rounded-full`} />
                {p.label}
              </div>            ))}
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={NODE_TYPES}
            isValidConnection={isValidConnection}
            connectionLineType={ConnectionLineType.SmoothStep}
            deleteKeyCode={["Backspace", "Delete"]}
            snapToGrid
            snapGrid={[GRID_SIZE, GRID_SIZE]}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Properties + Fields palette (right end) */}
        <div className="flex shrink-0 border-l border-gray-200 bg-white">
          <aside className="w-[21rem] shrink-0 overflow-y-auto border-r border-gray-200 p-4">
          {selectedNode ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Node</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={copySelectedNode}
                    className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                    title="Copy this node with its fields and config (Ctrl/Cmd+C)"
                  >
                    Copy
                  </button>
                  <button
                    onClick={pasteNode}
                    className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                    title="Paste the copied node here (Ctrl/Cmd+V)"
                  >
                    Paste
                  </button>
                  <button
                    onClick={deleteSelectedNode}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <label className="mt-3 block text-xs font-medium text-gray-600" htmlFor="node-label">
                Label
              </label>
              <input
                id="node-label"
                value={selectedNode.data.label}
                onChange={(e) => updateLabel(e.target.value)}
                className={`${inputCls} mt-1`}
              />
              <div className="mt-4 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${DOT_COLORS[selectedNode.type]}`} />
                <span className="text-sm font-medium text-gray-800">
                  {TYPE_LABELS[selectedNode.type] || selectedNode.type}
                </span>
                <span className="text-xs text-gray-400">({selectedNode.type})</span>
              </div>

              {/* Decision node configuration */}
              {selectedNode.type === "decision" && (
                <DecisionConfig
                  node={selectedNode}
                  nodes={nodes}
                  edges={edges}
                  onConfig={updateNodeConfig}
                  onEdgeLabel={setEdgeLabel}
                />
              )}

              {/* Field definitions */}
              <div className="mt-5 border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fields</p>
                  <button
                    type="button"
                    onClick={() => openTest(selectedNode.id)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                    title="Preview this stage's fields as a live form and check validation before publishing"
                  >
                    ▶ Test this stage
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">Drag a field type from the Fields palette; drag rows to reorder</p>

                <div
                  ref={fieldsListRef}
                  onDragOver={handleFieldsDragOver}
                  onDragEnter={handleFieldsDragEnter}
                  onDragLeave={handleFieldsDragLeave}
                  onDrop={handleFieldsDrop}
                  className={`mt-3 space-y-2 rounded-md border-2 border-dashed p-2 transition-colors ${
                    listDragActive
                      ? "border-indigo-400 bg-indigo-50/50"
                      : "border-gray-200 bg-gray-50/50"
                  }`}
                >
                  {(selectedNode.data.fields || []).length === 0 ? (
                    <p className="py-3 text-center text-xs text-gray-400">
                      No fields yet — drag one here.
                    </p>
                  ) : (
                    (selectedNode.data.fields || []).map((f, i) => {
                      const open = expandedField === f.id;
                      const subtype = f.config?.subtype || f.fieldType;
                      return (
                        <div
                          key={f.id}
                          data-field-row
                          className="rounded-md border border-gray-200 bg-white p-2 shadow-sm"
                        >
                          <div
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("application/yojan-field-reorder", String(i));
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
                            title="Drag to reorder this field"
                          >
                            <span className="text-gray-300">⠿</span>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${FIELD_TYPE_DOTS[f.fieldType] || "bg-gray-400"}`}
                            />
                            <span className="truncate text-xs font-medium text-gray-500">
                              {subtype}
                            </span>
                            <span className="ml-auto text-[10px] text-gray-300">#{i + 1}</span>
                            <button
                              onClick={() => setExpandedField(open ? null : f.id)}
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              title="Field properties"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => removeField(f.id)}
                              className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                              title="Remove field"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                          </div>
                          <input
                            value={f.label}
                            onChange={(e) => updateField(f.id, { label: e.target.value })}
                            placeholder="Field label / question"
                            className="mt-2 block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />

                          {/* Subtype selector — one field family, many
                              variants (Text -> email/phone/url/password, etc.) */}
                          {hasSubtypeOptions(f) && (
                            <div className="mt-2">
                              <label className="block text-[10px] font-medium text-gray-500">Type</label>
                              <select
                                value={legacySubtypeValue(f)}
                                onChange={(e) => {
                                  const subtype = e.target.value;
                                  updateField(f.id, { fieldType: baseForSubtype(subtype) });
                                  updateFieldConfig(f.id, { subtype });
                                }}
                                className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                {SUBTYPE_OPTIONS[familyOfField(f)].map((s) => (
                                  <option key={s.value} value={s.value}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-4">
                            <label className="flex items-center gap-1.5 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={!!f.required}
                                onChange={(e) => updateField(f.id, { required: e.target.checked })}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Required
                            </label>
                            <label
                              className="flex items-center gap-1.5 text-xs text-gray-600"
                              title="Fill this field when creating a new project"
                            >
                              <input
                                type="checkbox"
                                checked={!!(f.config && f.config.input)}
                                onChange={(e) => updateFieldConfig(f.id, { input: e.target.checked })}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Input
                            </label>
                          </div>

                          {/* Selection options — one option per row, add/remove */}
                          {isSelectionField(f) && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-600">Options</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateFieldConfig(f.id, {
                                      options: [...toOptionsArray(f.config), ""],
                                    })
                                  }
                                  className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                                >
                                  + Add option
                                </button>
                              </div>
                              <div className="mt-1 space-y-1">
                                {toOptionsArray(f.config).map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-1.5">
                                    <input
                                      value={opt}
                                      onChange={(e) => {
                                        const arr = toOptionsArray(f.config);
                                        arr[oi] = e.target.value;
                                        updateFieldConfig(f.id, { options: arr });
                                      }}
                                      placeholder={`Option ${oi + 1}`}
                                      className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateFieldConfig(f.id, {
                                          options: toOptionsArray(f.config).filter((_, j) => j !== oi),
                                        })
                                      }
                                      className="rounded p-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-500"
                                      title="Remove option"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                                {toOptionsArray(f.config).length === 0 && (
                                  <p className="text-[10px] text-gray-400">
                                    No options yet — use “+ Add option”.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {open && <CommonProperties f={f} onConfig={(patch) => updateFieldConfig(f.id, patch)} />}
                          {open && (
                            <FieldConditions
                              f={f}
                              nodes={nodes}
                              edges={edges}
                              nodeId={selectedId}
                              onConfig={(patch) => updateFieldConfig(f.id, patch)}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a node to edit its label and fields.</p>
          )}
        </aside>

          {/* Field types palette — its own panel next to the node properties */}
          <aside className="w-64 shrink-0 overflow-y-auto p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fields</p>
            <p className="mt-1 text-xs text-gray-400">Drag into a node's field list</p>
            <div className="mt-3 space-y-4">
              {FIELD_GROUPS.map((g) => (
                <div key={g.group}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {g.group}
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {g.items.map((item) => (
                      <div
                        key={item.subtype}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/yojan-field-type",
                            JSON.stringify(item)
                          );
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className="flex cursor-grab items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 active:cursor-grabbing"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${FIELD_TYPE_DOTS[item.base]}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* ===== Stage test modal =====
          Opens from each node's small expand arrow (or “Test this stage” in
          the properties panel). Lists the fields added to the stage and
          renders a live form so validation (required, email/URL/phone,
          integer/percentage, conditional logic) can be checked before
          publishing — nothing is saved to the backend. */}
      {testNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Test stage</h2>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium text-gray-900">
                  <span className={`h-2 w-2 rounded-full ${DOT_COLORS[testNode.type] || "bg-gray-400"}`} />
                  {testNode.data.label}
                  <span className="text-xs text-gray-400">({TYPE_LABELS[testNode.type] || testNode.type})</span>
                </p>
              </div>
              <button
                onClick={() => setTestNodeId(null)}
                className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {testNotice && (
                <p
                  className={`mb-4 rounded-md border px-3 py-2 text-sm ${
                    testNotice.kind === "ok"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-600"
                  }`}
                >
                  {testNotice.text}
                </p>
              )}

              {/* Fields added to this stage */}
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Fields ({testNode.data.fields.length})
              </p>
              {testNode.data.fields.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-400">
                  No fields on this stage yet — add some in the properties panel.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {testNode.data.fields.map((f) => {
                    const sub = f.config?.subtype || f.fieldType;
                    return (
                      <span
                        key={f.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${FIELD_TYPE_DOTS[f.fieldType] || "bg-gray-400"}`} />
                        <span className="font-medium text-gray-800">{f.label}</span>
                        <span className="text-gray-400">{sub}</span>
                        {f.required && <span className="text-red-500">*</span>}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Sample values for connected previous stages — lets cross-stage
                  conditional logic (stage2.cost equals stage1.cost, etc.) be
                  validated before publishing. */}
              {testAncestorNodes.length > 0 && (
                <div className="mt-5 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                    Sample values — previous stages
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Fill these as if the connected previous stages were completed, so conditions
                    that reference them evaluate live.
                  </p>
                  <div className="mt-3 space-y-4">
                    {testAncestorNodes.map((n) => (
                      <div key={n.id}>
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                          <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLORS[n.type] || "bg-gray-400"}`} />
                          {n.data.label}
                        </p>
                        <div className="space-y-2">
                          {(n.data.fields || []).map((f) => (
                            <div key={f.id}>
                              <label className="block text-[11px] font-medium text-gray-500">
                                {f.label}
                              </label>
                              <FieldControl
                                f={f}
                                value={sampleVars[f.id] ?? ""}
                                onChange={(v) =>
                                  setSampleVars((prev) => ({ ...prev, [f.id]: v }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live form — behaves exactly like the stage form in a running project */}
              {testNode.data.fields.length > 0 && (
                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Live form — try filling it in
                  </p>
                  <StageForm
                    key={testNode.id}
                    stage={{
                      id: testNode.id,
                      node: { id: testNode.id, type: testNode.type, label: testNode.data.label },
                      fields: testNode.data.fields,
                    }}
                    onSubmitted={async () => {
                      setTestNotice({
                        kind: "ok",
                        text: "All validations passed — this stage's form will work in the pipeline.",
                      });
                    }}
                    variables={sampleVars}
                    submitLabel="Validate form"
                  />
                </div>
              )}

              <p className="mt-4 text-[11px] text-gray-400">
                Testing is local only — nothing is saved. Publish the pipeline to make these fields
                available to new projects.
              </p>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ===== Full workflow test run ===== */}
      {showTestRun && (
        <TestRunModal
          nodes={nodes}
          edges={edges}
          pipelineName={pipeline?.name}
          onClose={() => setShowTestRun(false)}
        />
      )}

      {/* ===== Printable workflow spec ===== */}
      {showSpec && (
        <WorkflowSpecModal
          nodes={nodes}
          edges={edges}
          pipelineName={pipeline?.name}
          versionNumber={pipeline?.versionNumber}
          onClose={() => setShowSpec(false)}
        />
      )}
    </AppLayout>
  );
}

// ---- Decision node config panel ---------------------------------------
function DecisionConfig({ node, nodes, edges, onConfig, onEdgeLabel }) {
  const config = node.data.config || {};
  const decision = config.decision || {};

  // Variables = fields of connected ancestor nodes only + this node's own fields.
  const ancestors = useMemo(
    () => connectedAncestors(nodes, edges, node.id),
    [nodes, edges, node.id]
  );
  const variables = useMemo(() => {
    const list = [];
    const ids = new Set([...ancestors, node.id]);
    for (const n of nodes) {
      if (!ids.has(n.id)) continue;
      for (const f of n.data.fields || []) {
        list.push({ fieldId: f.id, label: `${n.data.label || "Node"} · ${f.label}` });
      }
    }
    return list;
  }, [nodes, ancestors, node.id]);

  const outgoing = edges.filter((e) => e.source === node.id);

  function patchDecision(patch) {
    onConfig({ decision: { ...decision, ...patch } });
  }

  function patchCondition(index, patch) {
    const conditions = [...(decision.conditions || [])];
    conditions[index] = { ...conditions[index], ...patch };
    patchDecision({ conditions });
  }

  function addCondition() {
    const conditions = [...(decision.conditions || [])];
    conditions.push({ sourceField: "", operator: "equals", compareValue: "", compareField: "", formula: "" });
    patchDecision({ conditions });
  }

  function removeCondition(index) {
    const conditions = [...(decision.conditions || [])];
    conditions.splice(index, 1);
    patchDecision({ conditions });
  }

  return (
    <div className="mt-5 rounded-md border border-violet-200 bg-violet-50/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
        Decision configuration
      </p>

      <label className={`${labelCls} mt-3`}>Description</label>
      <input
        value={decision.description || ""}
        onChange={(e) => patchDecision({ description: e.target.value })}
        className={`${inputCls} mt-1`}
        placeholder="What is this decision?"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Condition Mode</label>
          <select
            value={decision.conditionMode || "ALL"}
            onChange={(e) => patchDecision({ conditionMode: e.target.value })}
            className={`${inputCls} mt-1`}
          >
            <option value="ALL">ALL</option>
            <option value="ANY">ANY</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Default Output</label>
          <select
            value={decision.defaultOutput || "YES"}
            onChange={(e) => patchDecision({ defaultOutput: e.target.value })}
            className={`${inputCls} mt-1`}
          >
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </div>
      </div>

      <label className={`${labelCls} mt-3 flex items-center gap-2`}>
        <input
          type="checkbox"
          checked={decision.enabled !== false}
          onChange={(e) => patchDecision({ enabled: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
        />
        Enabled
      </label>

      {/* Output edge labels */}
      <div className="mt-4 border-t border-violet-200 pt-3">
        <p className="text-xs font-medium text-gray-700">Outputs (YES / NO)</p>
        {outgoing.length === 0 ? (
          <p className="mt-1 text-xs text-gray-400">Connect two outgoing edges and label them YES / NO.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {outgoing.map((e) => {
              const target = nodes.find((n) => n.id === e.target);
              return (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-gray-600">
                    → {target ? target.data.label : e.target}
                  </span>
                  <select
                    value={e.label || ""}
                    onChange={(ev) => onEdgeLabel(e.id, ev.target.value)}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="">—</option>
                    <option value="YES">YES</option>
                    <option value="NO">NO</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available variables */}
      <div className="mt-4 border-t border-violet-200 pt-3">
        <p className="text-xs font-medium text-gray-700">
          Available variables <span className="font-normal text-gray-400">(connected nodes only)</span>
        </p>
        {variables.length === 0 ? (
          <p className="mt-1 text-xs text-gray-400">No connected fields yet.</p>
        ) : (
          <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {variables.map((v) => (
              <span
                key={v.fieldId}
                className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700"
              >
                {v.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Conditions */}
      <div className="mt-4 border-t border-violet-200 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-700">Conditions</p>
          <button
            onClick={addCondition}
            className="rounded-md bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-700"
          >
            + Add rule
          </button>
        </div>
        {(decision.conditions || []).length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            No rules — the default output will be taken.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {(decision.conditions || []).map((c, i) => (
              <div key={i} className="rounded-md border border-violet-200 bg-white p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Rule {i + 1}
                  </span>
                  <button
                    onClick={() => removeCondition(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <label className={`${labelCls} mt-2`}>Source Field</label>
                <select
                  value={c.sourceField || ""}
                  onChange={(e) => patchCondition(i, { sourceField: e.target.value })}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">Select a connected field…</option>
                  {variables.map((v) => (
                    <option key={v.fieldId} value={v.fieldId}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <label className={`${labelCls} mt-2`}>Operator</label>
                <select
                  value={c.operator || "equals"}
                  onChange={(e) => patchCondition(i, { operator: e.target.value })}
                  className={`${inputCls} mt-1`}
                >
                  {OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <label className={`${labelCls} mt-2`}>Compare Value</label>
                <input
                  value={c.compareValue || ""}
                  onChange={(e) => patchCondition(i, { compareValue: e.target.value })}
                  className={`${inputCls} mt-1`}
                  placeholder="e.g. 1000 or YES"
                />
                <label className={`${labelCls} mt-2`}>Compare Field (optional)</label>
                <select
                  value={c.compareField || ""}
                  onChange={(e) => patchCondition(i, { compareField: e.target.value })}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">— none —</option>
                  {variables.map((v) => (
                    <option key={v.fieldId} value={v.fieldId}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <label className={`${labelCls} mt-2`}>Formula (optional)</label>
                <input
                  value={c.formula || ""}
                  onChange={(e) => patchCondition(i, { formula: e.target.value })}
                  className={`${inputCls} mt-1`}
                  placeholder="e.g. v['fieldId'] > 5"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Common field properties editor ------------------------------------
// ---- Field conditional logic editor -----------------------------------
// Optional per-field conditions: the field is only shown at run time when its
// rules pass, evaluated against field values from connected previous stages.
// Stored as f.config.conditions = { enabled, mode: "ALL"|"ANY", rules: [...] }.
// Field conditional logic editor.
//
// Variables = fields of the connected previous stages PLUS the current node's
// own fields (a field can compare against other fields in the very same
// stage, e.g. start date > end date). Each condition picks a variable, an
// operator, a value (either another field or a typed literal), a property to
// apply, and a result — enable/disable for field properties, or an error
// message for "raise error" which blocks the stage submit until fixed.
//
// Stored shape (per rule):
//   { sourceField, operator, valueMode: "field"|"literal", compareField,
//     compareValue, property: "readOnly"|"hidden"|"disabled"|"raise_error",
//     resultAction: "enable"|"disable", resultText }
function FieldConditions({ f, nodes, edges, nodeId, onConfig }) {
  const config = f.config || {};
  const conditions = config.conditions || {};
  const enabled = conditions.enabled !== false;
  const mode = conditions.mode || "ALL";
  const rules = Array.isArray(conditions.rules) ? conditions.rules : [];
  const [collapsed, setCollapsed] = useState({});

  // Variables = connected previous stages + the current node itself.
  const ancestors = useMemo(
    () => connectedAncestors(nodes, edges, nodeId),
    [nodes, edges, nodeId]
  );
  const variables = useMemo(() => {
    const list = [];
    const ids = new Set([...ancestors, nodeId]);
    for (const n of nodes) {
      if (!ids.has(n.id)) continue;
      for (const field of n.data.fields || []) {
        list.push({ fieldId: field.id, label: `${n.data.label || "Node"} · ${field.label}` });
      }
    }
    return list;
  }, [nodes, ancestors, nodeId]);

  function patchConditions(patch) {
    onConfig({ conditions: { ...conditions, ...patch } });
  }
  function patchRule(index, patch) {
    const next = rules.slice();
    next[index] = { ...(next[index] || {}), ...patch };
    patchConditions({ rules: next });
  }
  function addRule() {
    patchConditions({
      rules: [
        ...rules,
        {
          sourceField: "",
          operator: "equals",
          valueMode: "literal",
          compareField: "",
          compareValue: "",
          property: "readOnly",
          resultAction: "enable",
          resultText: "",
        },
      ],
    });
  }
  function removeRule(index) {
    patchConditions({ rules: rules.filter((_, i) => i !== index) });
  }
  function toggleCollapse(index) {
    setCollapsed((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  return (
    <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50/40 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => patchConditions({ enabled: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
        />
        Conditional logic <span className="font-normal text-gray-400">(optional)</span>
      </label>
      {enabled && (
        <>
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
            When a condition is true, apply its result to this field. Values come from previous stages
            or other fields in this stage.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <label className={labelCls}>Match</label>
            <select
              value={mode}
              onChange={(e) => patchConditions({ mode: e.target.value })}
              className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="ALL">ALL</option>
              <option value="ANY">ANY</option>
            </select>
          </div>
          {variables.length === 0 && (
            <p className="mt-2 text-[10px] text-gray-400">
              Add fields to this stage or connect a previous stage to unlock variables.
            </p>
          )}
          <div className="mt-2 space-y-2">
            {rules.map((r, i) => {
              const isCollapsed = !!collapsed[i];
              const valueMode = r.valueMode || (r.compareField ? "field" : "literal");
              const property = r.property || "readOnly";
              return (
                <div key={i} className="rounded-md border border-cyan-200 bg-white p-2">
                  {/* Header: minimize + remove */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Condition {i + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(i)}
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title={isCollapsed ? "Expand condition" : "Minimize condition"}
                      >
                        <svg
                          className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRule(i)}
                        className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Remove condition"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {isCollapsed ? (
                    <p className="mt-1 truncate text-[10px] text-gray-400">
                      {variables.find((v) => v.fieldId === r.sourceField)?.label || "Variable…"} →{" "}
                      {(r.resultAction || "enable")} {r.property || "readOnly"}
                      {r.resultText ? ` · “${r.resultText}”` : ""}
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {/* Variable */}
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500">Variable</label>
                        <select
                          value={r.sourceField || ""}
                          onChange={(e) => patchRule(i, { sourceField: e.target.value })}
                          className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          <option value="">Select a variable…</option>
                          {variables.map((v) => (
                            <option key={v.fieldId} value={v.fieldId}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Operator */}
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500">Condition</label>
                        <select
                          value={r.operator || "equals"}
                          onChange={(e) => patchRule(i, { operator: e.target.value })}
                          className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          {OPERATORS.map((op) => (
                            <option key={op} value={op}>
                              {OP_LABELS[op]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {/* Value: field or literal */}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-medium text-gray-500">Value</label>
                          <select
                            value={valueMode}
                            onChange={(e) => patchRule(i, { valueMode: e.target.value })}
                            className="rounded-md border border-gray-300 bg-white px-1 py-0.5 text-[10px] focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            <option value="literal">Enter value</option>
                            <option value="field">Pick a field</option>
                          </select>
                        </div>
                        {valueMode === "field" ? (
                          <select
                            value={r.compareField || ""}
                            onChange={(e) => patchRule(i, { compareField: e.target.value })}
                            className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            <option value="">Select a field…</option>
                            {variables.map((v) => (
                              <option key={v.fieldId} value={v.fieldId}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={r.compareValue ?? ""}
                            onChange={(e) => patchRule(i, { compareValue: e.target.value })}
                            placeholder="e.g. 1000 or YES"
                            className="mt-0.5 w-full rounded-md border border-gray-300 px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        )}
                      </div>
                      {/* Property + result */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="block text-[10px] font-medium text-gray-500">Properties</label>
                          <select
                            value={property}
                            onChange={(e) => patchRule(i, { property: e.target.value })}
                            className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            <option value="readOnly">Read Only</option>
                            <option value="hidden">Hidden</option>
                            <option value="disabled">Disabled</option>
                            <option value="raise_error">Raise Error</option>
                          </select>
                        </div>
                        {property === "raise_error" ? (
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500">Error message</label>
                            <input
                              value={r.resultText ?? ""}
                              onChange={(e) => patchRule(i, { resultText: e.target.value })}
                              placeholder="e.g. Start date can't be after end date"
                              className="mt-0.5 w-full rounded-md border border-gray-300 px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[10px] font-medium text-gray-500">Result</label>
                            <select
                              value={r.resultAction || "enable"}
                              onChange={(e) => patchRule(i, { resultAction: e.target.value })}
                              className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            >
                              <option value="enable">Enable</option>
                              <option value="disable">Disable</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addRule}
            className="mt-2 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700 hover:bg-cyan-100"
          >
            + Add condition
          </button>
        </>
      )}
    </div>
  );
}

function CommonProperties({ f, onConfig }) {
  const config = f.config || {};
  const [open, setOpen] = useState(false);
  const props = commonPropertiesFor(f);

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        Common properties ({props.length})
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* Selection / boolean styles are properties of the merged field */}
          {isSelectionField(f) && (
            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-gray-500">Selection Type</label>
              <select
                value={config.selectionType || config.subtype || "dropdown"}
                onChange={(e) => onConfig({ selectionType: e.target.value })}
                className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="dropdown">Dropdown</option>
                <option value="multiselect">Multi Select</option>
                <option value="checkbox_list">Checkbox List</option>
                <option value="radio">Radio Button</option>
              </select>
            </div>
          )}
          {f.fieldType === "checkbox" && (
            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-gray-500">Boolean Style</label>
              <select
                value={config.booleanStyle || config.subtype || "checkbox"}
                onChange={(e) => onConfig({ booleanStyle: e.target.value })}
                className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="checkbox">Checkbox</option>
                <option value="toggle">Toggle</option>
                <option value="yes_no">Yes / No</option>
              </select>
            </div>
          )}

          {props.map((prop) => {
            const value = config[prop.key];
            if (prop.kind === "checkbox") {
              return (
                <label key={prop.key} className="col-span-2 flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => onConfig({ [prop.key]: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {prop.label}
                </label>
              );
            }
            if (prop.kind === "select") {
              return (
                <div key={prop.key} className="col-span-2">
                  <label className="block text-[10px] font-medium text-gray-500">{prop.label}</label>
                  <select
                    value={value || ""}
                    onChange={(e) => onConfig({ [prop.key]: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {prop.options.map((o) => (
                      <option key={o} value={o}>
                        {o || "—"}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
              <div key={prop.key} className={prop.kind === "textarea" ? "col-span-2" : ""}>
                <label className="block text-[10px] font-medium text-gray-500">{prop.label}</label>
                {prop.kind === "textarea" ? (
                  <textarea
                    rows={2}
                    value={value || ""}
                    onChange={(e) => onConfig({ [prop.key]: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                ) : (
                  <input
                    type={prop.kind === "number" ? "number" : prop.kind === "date" ? "date" : "text"}
                    value={value ?? ""}
                    onChange={(e) =>
                      onConfig({
                        [prop.key]: prop.kind === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
                      })
                    }
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== Full-workflow test run =====
// Walks the entire pipeline stage by stage (in edge order) with sample values,
// evaluating decision nodes against the accumulated variables and skipping the
// branch that isn't taken. Nothing is saved to the backend.
function TestRunModal({ nodes, edges, pipelineName, onClose }) {
  const order = useMemo(() => orderNodesByEdges(nodes, edges), [nodes, edges]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const [pos, setPos] = useState(0); // index into `order`
  const [values, setValues] = useState({}); // fieldId -> sample value
  const [done, setDone] = useState(() => new Set());
  const [skipped, setSkipped] = useState(() => new Set());
  const [branches, setBranches] = useState({}); // decision nodeId -> YES|NO

  // Skip nodes already marked as not-taken branches by deriving the first
  // index at/after `pos` whose node isn't skipped. This is deterministic and
  // StrictMode-safe (no effect that could double-fire), and the render never
  // shows a "Skipping…" flash.
  const effectivePos = useMemo(() => {
    let p = pos;
    while (p < order.length && skipped.has(order[p])) p += 1;
    return p;
  }, [pos, order, skipped]);

  const finished = effectivePos >= order.length;
  const currentId = order[effectivePos];
  const current = currentId ? nodeById.get(currentId) : null;
  const isDecision = current && current.type === "decision";
  const hasFields = current && (current.data.fields || []).length > 0;

  function advance() {
    setPos(effectivePos + 1);
  }

  function recordValues(fieldValues) {
    const next = { ...values };
    for (const fv of fieldValues || []) next[fv.fieldDefinitionId] = fv.value;
    setValues(next);
    setDone((d) => new Set(d).add(currentId));
    advance();
  }

  // Evaluate a decision node against accumulated variables, record the branch
  // it takes, and mark the non-chosen branch's exclusive nodes as skipped.
  function decide() {
    const dec = (current.data.config && current.data.config.decision) || null;
    const takeYes = decisionTakesYes(dec, values);
    const branch = takeYes ? "YES" : "NO";
    setBranches((b) => ({ ...b, [currentId]: branch }));
    const outgoing = edges.filter((e) => e.source === currentId);
    // Backward compat: legacy decision nodes built before YES/NO edge labels
    // treat the first two outgoing edges as YES then NO (mirrors projects.js).
    const anyLabeled = outgoing.some((e) => String(e.label || "").toUpperCase());
    const chosen = anyLabeled
      ? outgoing.filter((e) => String(e.label || "").toUpperCase() === branch)
      : takeYes
        ? outgoing.slice(0, 1)
        : outgoing.slice(1, 2);
    const notChosen = outgoing.filter((e) => !chosen.includes(e));
    const chosenReach = reachableSet(edges, chosen.map((e) => e.target));
    const notChosenReach = reachableSet(edges, notChosen.map((e) => e.target));
    const toSkip = new Set();
    for (const id of notChosenReach) {
      if (!chosenReach.has(id) && id !== currentId) toSkip.add(id);
    }
    setSkipped((s) => new Set([...s, ...toSkip]));
    setDone((d) => new Set(d).add(currentId));
    advance();
  }

  // Status per node for the progress list.
  function statusOf(id) {
    if (done.has(id)) return "done";
    if (skipped.has(id)) return "skipped";
    if (id === currentId) return "current";
    return "upcoming";
  }

  const doneCount = done.size;
  const total = nodes.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Test run</h2>
            <p className="mt-1 text-sm font-medium text-gray-900">{pipelineName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden md:grid-cols-[14rem_1fr]">
          {/* Progress rail */}
          <aside className="overflow-y-auto border-r border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {doneCount} / {total} stages
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${doneCount === total ? "bg-emerald-500" : "bg-indigo-500"}`}
                style={{ width: `${total > 0 ? (doneCount / total) * 100 : 0}%` }}
              />
            </div>
            <ul className="mt-3 space-y-1">
              {order.map((id, i) => {
                const n = nodeById.get(id);
                const st = statusOf(id);
                return (
                  <li key={id} className="flex items-center gap-2 text-xs">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        st === "done"
                          ? "bg-emerald-500"
                          : st === "skipped"
                            ? "bg-gray-300"
                            : st === "current"
                              ? "bg-indigo-500"
                              : "bg-gray-200"
                      }`}
                    />
                    <span
                      className={`truncate ${
                        st === "done"
                          ? "text-gray-400 line-through"
                          : st === "skipped"
                            ? "text-gray-300"
                            : st === "current"
                              ? "font-medium text-gray-900"
                              : "text-gray-400"
                      }`}
                    >
                      {i + 1}. {n ? n.data.label : "?"}
                    </span>
                    {st === "skipped" && <span className="ml-auto text-gray-300">—</span>}
                    {branches[id] && (
                      <span
                        className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                          branches[id] === "YES"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {branches[id]}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Current step */}
          <div className="overflow-y-auto p-5">
            {finished ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <p className="text-3xl">🎉</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">Test run complete</p>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  {doneCount} of {total} stages validated with sample values
                  {Object.keys(branches).length > 0
                    ? ` — ${Object.values(branches).filter((b) => b === "YES").length} decision(s) took YES, ${Object.values(branches).filter((b) => b === "NO").length} took NO`
                    : ""}
                  . Publish the pipeline to make it live.
                </p>
                <button
                  onClick={onClose}
                  className="mt-5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Done
                </button>
              </div>
            ) : !current ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${DOT_COLORS[current.type] || "bg-gray-400"}`} />
                  <h3 className="text-base font-semibold text-gray-900">{current.data.label}</h3>
                  <span className="text-xs text-gray-400">({TYPE_LABELS[current.type] || current.type})</span>
                </div>

                {isDecision ? (
                  <DecisionRunStep
                    node={current}
                    values={values}
                    nodes={nodes}
                    edges={edges}
                    onContinue={decide}
                  />
                ) : hasFields ? (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Fill sample values, then continue
                    </p>
                    <StageForm
                      key={current.id}
                      stage={{
                        id: current.id,
                        node: { id: current.id, type: current.type, label: current.data.label },
                        fields: current.data.fields,
                      }}
                      onSubmitted={recordValues}
                      variables={values}
                      submitLabel="Save & continue"
                    />
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm text-gray-500">
                      {current.type === "start"
                        ? "The workflow starts here."
                        : current.type === "end"
                          ? "The workflow ends here."
                          : current.type === "parallel_fork"
                            ? "This stage fans out to multiple branches — every branch continues in parallel."
                            : current.type === "parallel_join"
                              ? "Parallel branches merge back here."
                              : current.type === "approval"
                                ? "An approval stage — the assigned approver reviews it."
                                : "This stage has no fields — just continue."}
                    </p>
                    <button
                      onClick={() => {
                        setDone((d) => new Set(d).add(currentId));
                        advance();
                      }}
                      className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Continue
                    </button>
                  </div>                    )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Decision evaluation step inside the test run: shows each condition with the
// live value, whether it matched, and which branch the workflow will take.
function DecisionRunStep({ node, values, nodes, edges, onContinue }) {
  const dec = (node.data.config && node.data.config.decision) || {};
  const conditions = Array.isArray(dec.conditions) ? dec.conditions : [];
  const takeYes = decisionTakesYes(dec, values);

  // fieldId -> "Stage · label" for readable condition rows
  const fieldLabels = useMemo(() => {
    const map = {};
    for (const n of nodes) {
      for (const f of n.data.fields || []) map[f.id] = `${n.data.label || "Node"} · ${f.label}`;
    }
    return map;
  }, [nodes]);

  function displayValue(fieldId) {
    const v = values[fieldId];
    if (v === null || v === undefined || v === "") return "(empty)";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }

  return (
    <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
        Decision — {dec.conditionMode === "ANY" ? "ANY" : "ALL"} condition
        {conditions.length === 1 ? "" : "s"}
      </p>
      {conditions.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No conditions — uses the default output:{" "}
          <span className="font-semibold">{dec.defaultOutput || "YES"}</span>
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {conditions.map((c, i) => {
            const matched = evalCondition(c, values);
            const sourceLabel = fieldLabels[c.sourceField] || c.sourceField || "? field";
            const compare =
              c.valueMode === "field" && c.compareField
                ? fieldLabels[c.compareField] || c.compareField
                : c.compareValue;
            return (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    matched ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                  }`}
                >
                  {matched ? "✓" : "✗"}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-600">
                  <span className="font-medium text-gray-800">{sourceLabel}</span>{" "}
                  {OP_LABELS[c.operator] || c.operator}{" "}
                  <span className="font-medium text-gray-800">{String(compare ?? "")}</span>
                  <span className="text-gray-400"> (value: {displayValue(c.sourceField)})</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-sm text-gray-700">
        Workflow will take the{" "}
        <span
          className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${
            takeYes ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          {takeYes ? "YES" : "NO"}
        </span>{" "}
        branch.
      </p>
      <button
        onClick={onContinue}
        className="mt-4 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
      >
        Take {takeYes ? "YES" : "NO"} branch & continue
      </button>
    </div>
  );
}

// ===== Printable workflow spec =====
// One-page readable overview of every stage and its fields, for review sign-off
// before publishing. The Print / Save-as-PDF button calls window.print(); the
// print stylesheet (index.css) hides everything except .print-spec.
function WorkflowSpecModal({ nodes, edges, pipelineName, versionNumber, onClose }) {
  const order = useMemo(() => orderNodesByEdges(nodes, edges), [nodes, edges]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Workflow spec</h2>
            <p className="mt-1 text-sm font-medium text-gray-900">{pipelineName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Print / Save as PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="print-spec">
            <header className="mb-6 border-b border-gray-300 pb-4">
              <h1 className="text-xl font-bold text-gray-900">{pipelineName}</h1>
              <p className="mt-1 text-sm text-gray-500">
                Workflow spec
                {versionNumber != null ? ` · Version ${versionNumber}` : ""} ·{" "}
                {new Date().toLocaleDateString()}
              </p>
            </header>

            <ol className="space-y-5">
              {order.map((id, i) => {
                const n = nodeById.get(id);
                if (!n) return null;
                const dec = (n.data.config && n.data.config.decision) || null;
                return (
                  <li key={id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                        {i + 1}
                      </span>
                      <span className={`h-2 w-2 rounded-full ${DOT_COLORS[n.type] || "bg-gray-400"}`} />
                      <h3 className="text-sm font-semibold text-gray-900">{n.data.label}</h3>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                        {TYPE_LABELS[n.type] || n.type}
                      </span>
                    </div>

                    {(n.data.fields || []).length > 0 ? (
                      <table className="mt-3 w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                            <th className="py-1 pr-2 font-medium">Field</th>
                            <th className="py-1 pr-2 font-medium">Type</th>
                            <th className="py-1 font-medium">Required</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(n.data.fields || []).map((f) => {
                            const sub = f.config?.subtype || f.fieldType;
                            return (
                              <tr key={f.id} className="border-b border-gray-100">
                                <td className="py-1.5 pr-2 text-gray-800">{f.label}</td>
                                <td className="py-1.5 pr-2 text-gray-500">{sub}</td>
                                <td className="py-1.5">{f.required ? "Yes" : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="mt-2 text-xs text-gray-400">No fields on this stage.</p>
                    )}

                    {dec && (
                      <div className="mt-2 rounded-md bg-violet-50 p-2 text-xs text-violet-700">
                        <span className="font-semibold">Decision:</span>{" "}
                        {dec.conditionMode === "ANY" ? "ANY" : "ALL"} of{" "}
                        {(dec.conditions || []).length} condition
                        {(dec.conditions || []).length === 1 ? "" : "s"} · default{" "}
                        {dec.defaultOutput || "YES"}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PipelineBuilder() {
  const { id } = useParams();
  return (
    <ReactFlowProvider>
      <Builder pipelineId={id} />
    </ReactFlowProvider>
  );
}
