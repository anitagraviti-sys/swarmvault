import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDashboard } from "../src/components/MemoryDashboard";
import type { ViewerMemoryTaskSummary } from "../src/lib";

function sample(overrides: Partial<ViewerMemoryTaskSummary> = {}): ViewerMemoryTaskSummary {
  return {
    id: "2026-04-25T10-00-00Z-ship-memory",
    title: "Memory Task: Ship memory ledger",
    goal: "Ship the agent memory ledger",
    status: "active",
    target: "packages/engine",
    agent: "codex",
    createdAt: "2026-04-25T10:00:00Z",
    updatedAt: "2026-04-25T10:30:00Z",
    contextPackIds: ["context-pack-1"],
    changedPaths: ["packages/engine/src/memory.ts"],
    decisionCount: 2,
    followUpCount: 1,
    artifactPath: "/tmp/vault/state/memory/tasks/ship-memory.json",
    markdownPath: "/tmp/vault/wiki/memory/tasks/ship-memory.md",
    ...overrides
  };
}

function render(tasks: ViewerMemoryTaskSummary[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpenPage = vi.fn();
  const onNavigateNode = vi.fn();
  act(() => {
    root.render(<MemoryDashboard tasks={tasks} onOpenPage={onOpenPage} onNavigateNode={onNavigateNode} />);
  });
  return {
    container,
    onOpenPage,
    onNavigateNode,
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

describe("MemoryDashboard", () => {
  it("renders an empty state when there are no tasks", () => {
    const handle = render([]);
    expect(handle.container.textContent ?? "").toContain("No memory tasks");
    handle.cleanup();
  });

  it("surfaces status counts and task evidence", () => {
    const handle = render([sample(), sample({ id: "blocked", status: "blocked", decisionCount: 0, followUpCount: 3 })]);
    const text = handle.container.textContent ?? "";
    expect(text).toContain("1 active");
    expect(text).toContain("1 blocked");
    expect(text).toContain("2 decisions");
    expect(text).toContain("3 follow-ups");
    expect(text).toContain("packages/engine/src/memory.ts");
    handle.cleanup();
  });

  it("opens the task page and graph node", () => {
    const handle = render([sample()]);
    const buttons = Array.from(handle.container.querySelectorAll<HTMLButtonElement>("button"));
    const openButton = buttons.find((button) => button.textContent?.trim() === "Open page");
    const graphButton = buttons.find((button) => button.textContent?.trim() === "Related graph");
    expect(openButton).toBeTruthy();
    expect(graphButton).toBeTruthy();
    act(() => {
      openButton?.click();
      graphButton?.click();
    });
    expect(handle.onOpenPage).toHaveBeenCalledWith("memory/tasks/ship-memory.md", "memory:2026-04-25T10-00-00Z-ship-memory");
    expect(handle.onNavigateNode).toHaveBeenCalledWith("memory:2026-04-25T10-00-00Z-ship-memory");
    handle.cleanup();
  });
});
