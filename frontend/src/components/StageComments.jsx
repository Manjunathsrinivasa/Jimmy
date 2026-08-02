import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { listComments, addComment } from "../api/projects";

const MAX_LEN = 5000;

// "just now", "5m ago", "3h ago", "2d ago", or a date for anything older.
function relativeTime(iso) {
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Initial avatar: first letter of the commenter's email, uppercase.
function initials(email) {
  return (email || "?").trim().charAt(0).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
];

export default function StageComments({ projectId, stageId }) {
  const user = useAuthStore((s) => s.user);
  const [comments, setComments] = useState(null); // null = loading
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const load = useCallback(() => {
    let cancelled = false;
    setError("");
    listComments(projectId, stageId)
      .then((d) => {
        if (!cancelled) setComments(d.comments);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setComments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, stageId]);

  useEffect(() => {
    setComments(null);
    const cancel = load();
    return cancel;
  }, [load]);

  // Keep the newest comment in view after posting.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments]);

  async function handlePost(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError("");
    try {
      const d = await addComment(projectId, stageId, trimmed);
      setComments((prev) => [...(prev || []), d.comment]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  const isMe = (id) => user && id === user.id;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12 3c-4.97 0-9 3.92-9 8.75 0 2.62 1.3 4.95 3.33 6.47-.1.67-.4 1.86-.93 2.78 0 0 2.25-.4 3.8-1.2.9.26 1.86.45 2.8.45 4.97 0 9-3.92 9-8.75S16.97 3 12 3z"
          />
        </svg>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Comments</p>
        {comments && comments.length > 0 && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {comments.length}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Comment list */}
      {comments === null ? (
        <p className="mt-3 text-xs text-gray-400">Loading comments…</p>
      ) : comments.length === 0 && !error ? (
        <p className="mt-3 text-xs text-gray-400">No comments yet — start the conversation.</p>
      ) : comments.length === 0 ? null : (
        <ul ref={listRef} className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {comments.map((c, i) => (
            <li key={c.id} className="flex gap-2.5">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  AVATAR_COLORS[i % AVATAR_COLORS.length]
                }`}
                title={c.user?.email || "Unknown"}
              >
                {initials(c.user?.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p className="truncate text-xs font-medium text-gray-800">
                    {c.user?.email || "Unknown"}
                    {isMe(c.userId) && (
                      <span className="ml-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-600">
                        you
                      </span>
                    )}
                  </p>
                  <span className="shrink-0 text-[10px] text-gray-400">{relativeTime(c.createdAt)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">
                  {c.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Composer */}
      <form onSubmit={handlePost} className="mt-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter posts quickly.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) handlePost(e);
            }
          }}
          rows={2}
          maxLength={MAX_LEN}
          placeholder="Add a comment…"
          className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400">
            {text.length > 0 ? `${text.length}/${MAX_LEN}` : "Everyone on the project can see these"}
          </span>
          <button
            type="submit"
            disabled={posting || text.trim().length === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}
