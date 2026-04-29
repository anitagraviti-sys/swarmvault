import { useState } from "react";
import type { ViewerDoctorReport } from "../lib";

type WorkbenchDashboardProps = {
  doctorReport: ViewerDoctorReport | null;
  doctorError?: string;
  busyAction: string;
  actionError?: string | null;
  onRepair: () => Promise<void>;
  onCapture: (payload: {
    url?: string;
    title?: string;
    markdown?: string;
    selectionText?: string;
    sourceMode?: "ingest" | "add" | "inbox";
  }) => Promise<void>;
  onBuildContext: (payload: { goal: string; target?: string; budgetTokens?: number }) => Promise<void>;
  onStartTask: (payload: { goal: string; target?: string; budgetTokens?: number }) => Promise<void>;
};

function statusLabel(status: ViewerDoctorReport["status"] | undefined): string {
  if (!status) return "unknown";
  return status;
}

export function WorkbenchDashboard({
  doctorReport,
  doctorError,
  busyAction,
  actionError,
  onRepair,
  onCapture,
  onBuildContext,
  onStartTask
}: WorkbenchDashboardProps) {
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [goal, setGoal] = useState("");
  const [target, setTarget] = useState("");

  const canCapture = captureUrl.trim().length > 0 || captureText.trim().length > 0;
  const canUseGoal = goal.trim().length > 0;

  return (
    <section className="workbench-dashboard" aria-label="Vault workbench">
      <div className="workbench-strip">
        <div className={`health-pill health-${doctorReport?.status ?? "warning"}`}>
          <span className="health-dot" aria-hidden="true" />
          <span>Health {statusLabel(doctorReport?.status)}</span>
        </div>
        <span className="workbench-metric">Sources {doctorReport?.counts.sources ?? 0}</span>
        <span className="workbench-metric">Managed {doctorReport?.counts.managedSources ?? 0}</span>
        <span className="workbench-metric">Pages {doctorReport?.counts.pages ?? 0}</span>
        <span className="workbench-metric">Review {doctorReport?.counts.approvalsPending ?? 0}</span>
        <span className="workbench-metric">Tasks {doctorReport?.counts.tasks ?? 0}</span>
        <button type="button" className="btn btn-primary" onClick={() => void onRepair()} disabled={busyAction === "doctor:repair"}>
          {busyAction === "doctor:repair" ? "Repairing" : "Repair"}
        </button>
      </div>

      {doctorError ? <p className="workbench-error">{doctorError}</p> : null}
      {actionError ? <p className="workbench-error">{actionError}</p> : null}

      <div className="workbench-grid">
        <div className="workbench-card">
          <h2 className="workbench-card-title">Capture</h2>
          <input
            className="input"
            aria-label="Capture URL"
            placeholder="URL"
            value={captureUrl}
            onChange={(event) => setCaptureUrl(event.target.value)}
          />
          <textarea
            className="input workbench-textarea"
            aria-label="Capture text"
            placeholder="Selected text or notes"
            value={captureText}
            onChange={(event) => setCaptureText(event.target.value)}
          />
          <div className="action-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCapture || busyAction === "capture"}
              onClick={() =>
                void onCapture({
                  url: captureUrl.trim() || undefined,
                  selectionText: captureText.trim() || undefined,
                  sourceMode: captureText.trim() ? "inbox" : "ingest"
                }).then(() => {
                  setCaptureUrl("");
                  setCaptureText("");
                })
              }
            >
              Capture
            </button>
          </div>
        </div>

        <div className="workbench-card">
          <h2 className="workbench-card-title">Agent Context</h2>
          <input
            className="input"
            aria-label="Agent goal"
            placeholder="Goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          <input
            className="input"
            aria-label="Agent target"
            placeholder="Target path, page, or node"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <div className="action-row">
            <button
              type="button"
              className="btn"
              disabled={!canUseGoal || busyAction === "context"}
              onClick={() => void onBuildContext({ goal: goal.trim(), target: target.trim() || undefined, budgetTokens: 8000 })}
            >
              Build Pack
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canUseGoal || busyAction === "task:start"}
              onClick={() =>
                void onStartTask({ goal: goal.trim(), target: target.trim() || undefined, budgetTokens: 8000 }).then(() => {
                  setGoal("");
                  setTarget("");
                })
              }
            >
              Start Task
            </button>
          </div>
        </div>

        <div className="workbench-card workbench-checks">
          <h2 className="workbench-card-title">Checks</h2>
          {(doctorReport?.checks ?? []).slice(0, 4).map((check) => (
            <div key={check.id} className={`workbench-check check-${check.status}`}>
              <span>{check.label}</span>
              <span>{check.status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
