import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { listUsers } from "../api/users";

const STATUS_STYLES = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-sky-100 text-sky-700",
  blocked: "bg-red-100 text-red-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  done: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In progress",
  blocked: "Blocked",
  approved: "Approved",
  rejected: "Rejected",
  done: "Done",
};

// The approval-stage workflow:
//   - The stage assignee picks a user (the approver) and sends the approval.
//   - The stage then WAITS — the chosen user is the only one who may decide.
//   - Approve -> the workflow advances to the next stage.
//   - Reject  -> the sender can pick another user and resend.
//   - Admins can always push the stage forward.
export default function ApprovalStagePanel({ stage, busy, onSend, onDecide }) {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  const [users, setUsers] = useState([]);
  const [chosenId, setChosenId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((d) => {
        if (!cancelled) setUsers(d.users || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const awaiting = ["pending", "in_progress", "blocked"].includes(stage.status);
  const isSender = stage.assignee?.id === user?.id;
  const isApprover = stage.approver?.id === user?.id;
  const decided = stage.status === "approved" || stage.status === "done";
  const rejected = stage.status === "rejected";

  async function handleSend(e) {
    e.preventDefault();
    if (!chosenId) return;
    onSend(stage, chosenId);
  }

  // Only people with a say see the controls: the sender picks the approver,
  // the approver decides, and admins get a single clearly-labeled push button
  // (full control). The picker only appears when no approver is chosen yet or
  // the stage was rejected (resend) — once an approval is in flight, the
  // block waits instead of offering a new pick.
  const showPick = (isSender || isAdmin) && !decided && (!stage.approver || rejected);
  const showDecide = isApprover && awaiting && !decided;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_STYLES[stage.status] || "bg-gray-100 text-gray-600"
          }`}
        >
          {STATUS_LABELS[stage.status] || stage.status}
        </span>
        <span className="text-xs text-gray-400">
          {decided
            ? "Approval complete"
            : rejected
              ? "Rejected — send it again"
              : stage.approver
                ? `Waiting on ${stage.approver.email}`
                : "No approver chosen yet"}
        </span>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {decided ? (
        <p className="mt-3 text-sm text-emerald-700">
          ✓ Approved — the workflow moves to the next stage.
        </p>
      ) : (
        <>
          {/* The approver (or admin) decides */}
          {showDecide && (
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => onDecide(stage, "approved")}
                disabled={busy}
                className="btn btn-success w-full"
              >
                Approve
              </button>
              <button
                onClick={() => onDecide(stage, "rejected")}
                disabled={busy}
                className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                Reject
              </button>
              <span className="text-xs text-gray-400">
                You were chosen to approve this stage.
              </span>
            </div>
          )}

          {/* The sender (or admin) picks the approver / resends */}
          {showPick && (
            <form onSubmit={handleSend} className="mt-4 space-y-2">
              <label htmlFor="approval-pick" className="block text-xs font-medium text-gray-600">
                {rejected ? "Resend to a new approver" : "Choose who approves this stage"}
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="approval-pick"
                  value={chosenId}
                  onChange={(e) => setChosenId(e.target.value)}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select a user…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.role})
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy || !chosenId}
                  className="btn btn-primary shrink-0"
                >
                  {rejected ? "Resend" : "OK"}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                The workflow waits here until {chosenId ? "the selected user" : "the approver"}{" "}
                approves or rejects.
              </p>
            </form>
          )}

          {/* Admin full control: push the stage forward */}
          {isAdmin && awaiting && !decided && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <button
                onClick={() => onDecide(stage, "approved")}
                disabled={busy}
                className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                title="Admin override — mark this stage approved and unlock the next stage"
              >
                Admin: push to next stage
              </button>
            </div>
          )}

          {!showPick && !showDecide && !isAdmin && (
            <p className="mt-3 text-sm text-gray-500">
              {stage.approver
                ? `Waiting for ${stage.approver.email} to decide — the workflow advances automatically once approved.`
                : "The stage owner will pick an approver for this stage."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
