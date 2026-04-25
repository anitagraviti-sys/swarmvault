import { useMemo, useState } from "react";
import type { NavigateNodeFn, OpenPageFn, ViewerMemoryTaskSummary } from "./types";

type MemoryFilter = "all" | ViewerMemoryTaskSummary["status"];

type MemoryDashboardProps = {
  tasks: ViewerMemoryTaskSummary[];
  memoryError?: string | null;
  onOpenPage: OpenPageFn;
  onNavigateNode: NavigateNodeFn;
};

function wikiRelativePath(markdownPath: string): string {
  const marker = "/wiki/";
  const markerIndex = markdownPath.lastIndexOf(marker);
  return markerIndex >= 0 ? markdownPath.slice(markerIndex + marker.length) : markdownPath;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const statusOrder: Record<ViewerMemoryTaskSummary["status"], number> = {
  active: 0,
  blocked: 1,
  completed: 2,
  archived: 3
};

function statusChipClass(status: ViewerMemoryTaskSummary["status"]): string {
  if (status === "completed") return "chip chip-success";
  if (status === "blocked") return "chip chip-warning";
  if (status === "archived") return "chip";
  return "chip chip-tag";
}

export function MemoryDashboard({ tasks, memoryError, onOpenPage, onNavigateNode }: MemoryDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<MemoryFilter>("all");
  const [filterText, setFilterText] = useState("");

  const counts = useMemo(
    () => ({
      active: tasks.filter((task) => task.status === "active").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      archived: tasks.filter((task) => task.status === "archived").length
    }),
    [tasks]
  );

  const visibleTasks = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return [...tasks]
      .filter((task) => (statusFilter === "all" ? true : task.status === statusFilter))
      .filter((task) => {
        if (!query) return true;
        const haystack = [task.title, task.goal, task.target, task.agent, ...task.changedPaths].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort(
        (left, right) =>
          statusOrder[left.status] - statusOrder[right.status] ||
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.title.localeCompare(right.title)
      );
  }, [filterText, statusFilter, tasks]);

  return (
    <div>
      {memoryError ? <p className="text-error">{memoryError}</p> : null}
      <div className="chip-row">
        <span className="chip chip-tag">{counts.active} active</span>
        <span className="chip chip-warning">{counts.blocked} blocked</span>
        <span className="chip chip-success">{counts.completed} completed</span>
        <span className="chip">{counts.archived} archived</span>
      </div>
      {tasks.length ? (
        <>
          <div className="list-filter-bar" style={{ marginTop: 8 }}>
            <input
              type="search"
              className="input"
              placeholder="Filter memory tasks..."
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              aria-label="Filter memory tasks"
            />
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as MemoryFilter)}
              aria-label="Filter memory tasks by status"
              style={{ width: "auto" }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="card-list">
            {visibleTasks.map((task) => {
              const markdownPath = wikiRelativePath(task.markdownPath);
              return (
                <article key={task.id} className="card">
                  <div className="card-row">
                    <span className={statusChipClass(task.status)}>{task.status}</span>
                    <span className="label">updated {formatDate(task.updatedAt)}</span>
                  </div>
                  <strong className="card-title">{task.title}</strong>
                  <p className="text-sm">{task.goal}</p>
                  <div className="chip-row">
                    {task.target ? <span className="chip">target {task.target}</span> : null}
                    {task.agent ? <span className="chip">agent {task.agent}</span> : null}
                    <span className="chip">{task.contextPackIds.length} packs</span>
                    <span className="chip">{task.decisionCount} decisions</span>
                    <span className="chip">{task.followUpCount} follow-ups</span>
                  </div>
                  {task.changedPaths.length ? (
                    <p className="text-mono text-sm">{task.changedPaths.slice(0, 3).join(", ")}</p>
                  ) : (
                    <p className="text-muted text-sm">No changed paths recorded.</p>
                  )}
                  <div className="action-row">
                    <button type="button" className="btn btn-ghost" onClick={() => void onOpenPage(markdownPath, `memory:${task.id}`)}>
                      Open page
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onNavigateNode(`memory:${task.id}`)}>
                      Related graph
                    </button>
                  </div>
                </article>
              );
            })}
            {visibleTasks.length === 0 ? <p className="text-muted text-sm">No memory tasks match the current filter.</p> : null}
          </div>
        </>
      ) : (
        <p className="text-muted text-sm" style={{ marginTop: 8 }}>
          No memory tasks have been recorded yet.
        </p>
      )}
    </div>
  );
}
