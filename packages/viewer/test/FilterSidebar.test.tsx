import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterSidebar } from "../src/components/FilterSidebar";

/**
 * Tests for Cycle B.6 viewer tag navigation: the FilterSidebar must show
 * tag pills, support multi-select (AND) via a toggle callback, expose a
 * tag search box, and reveal the full tag list through an expander.
 */

type TagOption = { tag: string; count: number };

interface SidebarHandle {
  container: HTMLElement;
  rerender: (props: Partial<RenderProps>) => void;
  cleanup: () => void;
  root: Root;
}

interface RenderProps {
  selectedTags: string[];
  tagOptions: TagOption[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

function render(props: Partial<RenderProps> = {}): SidebarHandle {
  let current: RenderProps = {
    selectedTags: [],
    tagOptions: [],
    onToggleTag: vi.fn(),
    onClearTags: vi.fn(),
    ...props
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const renderOnce = (next: RenderProps) => {
    act(() => {
      root.render(
        <FilterSidebar
          edgeStatusFilter="all"
          onEdgeStatusChange={vi.fn()}
          kindFilter="all"
          onKindChange={vi.fn()}
          pageStatusFilter="all"
          onPageStatusChange={vi.fn()}
          projectFilter="all"
          onProjectChange={vi.fn()}
          projectOptions={[]}
          sourceTypeFilter="all"
          onSourceTypeChange={vi.fn()}
          sourceTypeOptions={[]}
          sourceClassFilter="all"
          onSourceClassChange={vi.fn()}
          sourceClassOptions={[]}
          communityFilter="all"
          onCommunityChange={vi.fn()}
          communityOptions={[]}
          selectedTags={next.selectedTags}
          onToggleTag={next.onToggleTag}
          onClearTags={next.onClearTags}
          tagOptions={next.tagOptions}
          query=""
          onQueryChange={vi.fn()}
        />
      );
    });
  };
  renderOnce(current);
  return {
    container,
    root,
    rerender: (patch) => {
      current = { ...current, ...patch };
      renderOnce(current);
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (!setter) return;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function makeOptions(count: number): TagOption[] {
  return Array.from({ length: count }, (_, index) => ({
    tag: `tag-${index.toString().padStart(2, "0")}`,
    count: 100 - index
  }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("FilterSidebar — tag navigation", () => {
  it("renders up to the default top-N tag pills and hides the rest behind an expander", () => {
    const handle = render({ tagOptions: makeOptions(25) });
    const chips = handle.container.querySelectorAll('[data-testid^="tag-chip-tag-"]');
    expect(chips.length).toBe(20);
    const expander = handle.container.querySelector('[data-testid="tag-expander"]') as HTMLButtonElement | null;
    expect(expander?.textContent ?? "").toContain("Show all 25 tags");
    handle.cleanup();
  });

  it("reveals the full tag list when the expander is clicked", () => {
    const handle = render({ tagOptions: makeOptions(25) });
    const expander = handle.container.querySelector('[data-testid="tag-expander"]') as HTMLButtonElement;
    act(() => {
      expander.click();
    });
    const chips = handle.container.querySelectorAll('[data-testid^="tag-chip-tag-"]');
    expect(chips.length).toBe(25);
    expect(expander.textContent ?? "").toContain("Show fewer tags");
    handle.cleanup();
  });

  it("emits onToggleTag when a pill is clicked for multi-select AND behaviour", () => {
    const onToggleTag = vi.fn();
    const handle = render({ tagOptions: makeOptions(3), onToggleTag });
    const firstChip = handle.container.querySelector('[data-testid="tag-chip-tag-00"]') as HTMLButtonElement;
    const secondChip = handle.container.querySelector('[data-testid="tag-chip-tag-01"]') as HTMLButtonElement;
    act(() => {
      firstChip.click();
      secondChip.click();
    });
    expect(onToggleTag).toHaveBeenNthCalledWith(1, "tag-00");
    expect(onToggleTag).toHaveBeenNthCalledWith(2, "tag-01");
    handle.cleanup();
  });

  it("marks currently selected tag chips as active for AND-filter feedback", () => {
    const handle = render({ tagOptions: makeOptions(3), selectedTags: ["tag-00", "tag-01"] });
    const first = handle.container.querySelector('[data-testid="tag-chip-tag-00"]') as HTMLButtonElement;
    const second = handle.container.querySelector('[data-testid="tag-chip-tag-01"]') as HTMLButtonElement;
    const third = handle.container.querySelector('[data-testid="tag-chip-tag-02"]') as HTMLButtonElement;
    expect(first.className).toContain("is-active");
    expect(second.className).toContain("is-active");
    expect(third.className).not.toContain("is-active");
    handle.cleanup();
  });

  it("calls onClearTags when the all chip is clicked", () => {
    const onClearTags = vi.fn();
    const handle = render({ tagOptions: makeOptions(3), selectedTags: ["tag-00"], onClearTags });
    const all = handle.container.querySelector('[data-testid="tag-chip-all"]') as HTMLButtonElement;
    act(() => {
      all.click();
    });
    expect(onClearTags).toHaveBeenCalled();
    handle.cleanup();
  });

  it("filters the rendered pills by the tag search box", () => {
    const handle = render({ tagOptions: makeOptions(10) });
    const input = handle.container.querySelector('[data-testid="tag-search-input"]') as HTMLInputElement;
    setInputValue(input, "tag-03");
    const chips = handle.container.querySelectorAll('[data-testid^="tag-chip-tag-"]');
    expect(chips.length).toBe(1);
    expect((chips[0] as HTMLElement).getAttribute("data-testid")).toBe("tag-chip-tag-03");
    handle.cleanup();
  });

  it("shows the empty state when there are no tags at all", () => {
    const handle = render({ tagOptions: [] });
    expect(handle.container.textContent ?? "").toContain("No tags in this vault yet.");
    handle.cleanup();
  });
});
