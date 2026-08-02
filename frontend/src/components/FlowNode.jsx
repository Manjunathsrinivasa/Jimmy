import { Handle, Position } from "@xyflow/react";

// Per-type styling. All node kinds reuse this component; data.nodeType drives
// the look (the same component is registered under every type key).
const STYLES = {
  start: { border: "border-emerald-500", bg: "bg-emerald-50", dot: "bg-emerald-500", shape: "rounded-full" },
  stage: { border: "border-sky-500", bg: "bg-sky-50", dot: "bg-sky-500", shape: "rounded-lg" },
  parallel_fork: { border: "border-amber-500", bg: "bg-amber-50", dot: "bg-amber-500", shape: "rounded-md" },
  parallel_join: { border: "border-amber-500", bg: "bg-amber-50", dot: "bg-amber-500", shape: "rounded-md" },
  decision: { border: "border-violet-500", bg: "bg-violet-50", dot: "bg-violet-500", shape: "rounded-md" },
  approval: { border: "border-teal-500", bg: "bg-teal-50", dot: "bg-teal-500", shape: "rounded-lg" },
  end: { border: "border-rose-500", bg: "bg-rose-50", dot: "bg-rose-500", shape: "rounded-full" },
};

const HANDLE_STYLE = { width: 10, height: 10, background: "#9ca3af" };

const STATUS_STYLES = {
  pending: "bg-gray-100 text-gray-500",
  in_progress: "bg-sky-100 text-sky-700",
  blocked: "bg-red-100 text-red-600",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-600",
  done: "bg-emerald-100 text-emerald-700",
};

// Shared node: the builder renders it editable; the read-only project canvas
// passes data.active (highlight ring) and data.status (badge) instead.
//
// Decision nodes expose EXACTLY one input handle (left) and two output
// handles (right) labeled YES and NO — connecting from each handle tags the
// new edge with the matching label.
export default function FlowNode({ data, selected }) {
  const s = STYLES[data.nodeType] || STYLES.stage;
  const active = !!data.active;
  const status = data.status;
  const isDecision = data.nodeType === "decision";

  const body = (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className={`h-2 w-2 ${s.dot} rounded-full`} />
      <span className="text-sm font-medium text-gray-800">{data.label}</span>
      {status && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            STATUS_STYLES[status] || "bg-gray-100 text-gray-500"
          }`}
        >
          {status.replace("_", " ")}
        </span>
      )}
      {/* Builder-only: the small expand arrow opens the stage's field list and
          a live form so the workflow can be validated before publishing. */}
      {data.onExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            data.onExpand();
          }}
          className="ml-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-200/80 hover:text-gray-700"
          title="Show fields & test this stage"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`${s.bg} ${s.border} ${s.shape} border-2 px-4 py-2 shadow-sm ${
        active ? "stage-pulse ring-2 ring-indigo-500 ring-offset-2" : selected ? "ring-2 ring-indigo-400" : ""
      }`}
    >
      {/* Exactly one input on the left */}
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />

      {body}

      {(data.fields || []).length > 0 && (
        <div className="mt-0.5 text-center text-[10px] font-medium text-gray-400">
          {(data.fields || []).length} field{(data.fields || []).length === 1 ? "" : "s"}
        </div>
      )}

      {isDecision ? (
        <>
          {/* Exactly two outputs on the right: YES (top) and NO (bottom) */}
          <Handle
            id="YES"
            type="source"
            position={Position.Right}
            style={{ ...HANDLE_STYLE, top: "28%", background: "#10b981" }}
            title="YES output"
          />
          <Handle
            id="NO"
            type="source"
            position={Position.Right}
            style={{ ...HANDLE_STYLE, top: "72%", background: "#f43f5e" }}
            title="NO output"
          />
          <div className="mt-1 flex items-center justify-center gap-3 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> YES
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> NO
            </span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      )}
    </div>
  );
}
