import { fireEvent } from "@testing-library/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchDashboard } from "../src/components/WorkbenchDashboard";
import type { ViewerDoctorReport } from "../src/lib";

const report: ViewerDoctorReport = {
  ok: false,
  status: "warning",
  generatedAt: "2026-04-29T20:00:00.000Z",
  rootDir: "/tmp/vault",
  version: "3.2.0",
  counts: {
    sources: 2,
    managedSources: 1,
    pages: 7,
    nodes: 12,
    edges: 18,
    approvalsPending: 1,
    candidates: 3,
    tasks: 1,
    pendingSemanticRefresh: 0
  },
  checks: [
    { id: "graph", label: "Graph", status: "ok", summary: "Graph present." },
    { id: "retrieval", label: "Retrieval", status: "warning", summary: "Retrieval stale." }
  ],
  repaired: []
};

function renderDashboard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onRepair = vi.fn().mockResolvedValue(undefined);
  const onCapture = vi.fn().mockResolvedValue(undefined);
  const onBuildContext = vi.fn().mockResolvedValue(undefined);
  const onStartTask = vi.fn().mockResolvedValue(undefined);
  act(() => {
    root.render(
      <WorkbenchDashboard
        doctorReport={report}
        busyAction=""
        actionError={null}
        onRepair={onRepair}
        onCapture={onCapture}
        onBuildContext={onBuildContext}
        onStartTask={onStartTask}
      />
    );
  });
  return {
    container,
    onRepair,
    onCapture,
    onBuildContext,
    onStartTask,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("WorkbenchDashboard", () => {
  it("summarizes doctor counts and triggers workbench actions", async () => {
    const handle = renderDashboard();
    const text = handle.container.textContent ?? "";
    expect(text).toContain("Health warning");
    expect(text).toContain("Sources 2");
    expect(text).toContain("Managed 1");
    expect(text).toContain("Review 1");

    const captureUrl = handle.container.querySelector<HTMLInputElement>('input[aria-label="Capture URL"]');
    const captureText = handle.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Capture text"]');
    const goal = handle.container.querySelector<HTMLInputElement>('input[aria-label="Agent goal"]');
    const target = handle.container.querySelector<HTMLInputElement>('input[aria-label="Agent target"]');
    expect(captureUrl).toBeTruthy();
    expect(captureText).toBeTruthy();
    expect(goal).toBeTruthy();
    expect(target).toBeTruthy();

    await act(async () => {
      fireEvent.input(captureUrl!, { target: { value: "https://example.com/article" } });
      fireEvent.input(captureText!, { target: { value: "important excerpt" } });
    });
    const captureButton = Array.from(handle.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Capture"
    );
    await act(async () => {
      captureButton?.click();
    });
    expect(handle.onCapture).toHaveBeenCalledWith({
      url: "https://example.com/article",
      selectionText: "important excerpt",
      sourceMode: "inbox"
    });

    await act(async () => {
      fireEvent.input(goal!, { target: { value: "Ship the release" } });
      fireEvent.input(target!, { target: { value: "packages/engine" } });
    });
    const taskButton = Array.from(handle.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Start Task"
    );
    await act(async () => {
      taskButton?.click();
    });
    expect(handle.onStartTask).toHaveBeenCalledWith({
      goal: "Ship the release",
      target: "packages/engine",
      budgetTokens: 8000
    });
    handle.cleanup();
  });
});
