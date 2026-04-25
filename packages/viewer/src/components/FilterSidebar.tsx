import { useMemo, useState } from "react";

type FilterSidebarProps = {
  edgeStatusFilter: string;
  onEdgeStatusChange: (value: string) => void;
  kindFilter: string;
  onKindChange: (value: string) => void;
  pageStatusFilter: string;
  onPageStatusChange: (value: string) => void;
  projectFilter: string;
  onProjectChange: (value: string) => void;
  projectOptions: string[];
  sourceTypeFilter: string;
  onSourceTypeChange: (value: string) => void;
  sourceTypeOptions: string[];
  sourceClassFilter: string;
  onSourceClassChange: (value: string) => void;
  sourceClassOptions: string[];
  communityFilter: string;
  onCommunityChange: (value: string) => void;
  communityOptions: string[];
  /**
   * Currently selected tag filters. When the array is empty, every page is
   * visible; when populated, pages must match every selected tag (AND).
   */
  selectedTags: string[];
  /**
   * Toggle a tag's selection on or off. The parent owns the selection list
   * so it can keep URL hash state and graph filtering in sync.
   */
  onToggleTag: (tag: string) => void;
  /** Clear the active tag filter back to "show all". */
  onClearTags: () => void;
  tagOptions: { tag: string; count: number }[];
  query: string;
  onQueryChange: (value: string) => void;
};

/** Number of tag pills rendered before the "Show all N tags" expander kicks in. */
const DEFAULT_TAG_LIMIT = 20;

export function FilterSidebar({
  edgeStatusFilter,
  onEdgeStatusChange,
  kindFilter,
  onKindChange,
  pageStatusFilter,
  onPageStatusChange,
  projectFilter,
  onProjectChange,
  projectOptions,
  sourceTypeFilter,
  onSourceTypeChange,
  sourceTypeOptions,
  sourceClassFilter,
  onSourceClassChange,
  sourceClassOptions,
  communityFilter,
  onCommunityChange,
  communityOptions,
  selectedTags,
  onToggleTag,
  onClearTags,
  tagOptions,
  query,
  onQueryChange
}: FilterSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["graph", "tags"]));
  const [tagSearch, setTagSearch] = useState("");
  const [showAllTags, setShowAllTags] = useState(false);

  const toggle = (section: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const filteredTags = useMemo(() => {
    const needle = tagSearch.trim().toLowerCase();
    if (!needle) return tagOptions;
    return tagOptions.filter(({ tag }) => tag.toLowerCase().includes(needle));
  }, [tagOptions, tagSearch]);

  const visibleTags = useMemo(() => {
    if (showAllTags || tagSearch.trim().length > 0) return filteredTags;
    return filteredTags.slice(0, DEFAULT_TAG_LIMIT);
  }, [filteredTags, showAllTags, tagSearch]);

  const hiddenTagCount = filteredTags.length - visibleTags.length;

  const graphActiveCount = [edgeStatusFilter, communityFilter, sourceClassFilter].filter((v) => v !== "all").length;
  const pagesActiveCount = [kindFilter, pageStatusFilter, projectFilter, sourceTypeFilter].filter((v) => v !== "all").length;
  const tagsActiveCount = selectedTags.length;

  return (
    <div className="sidebar" data-drawer="sidebar">
      <div className="sidebar-section">
        <label className="filter-group">
          <span className="filter-label">Search</span>
          <input
            type="search"
            className="input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Pages, outputs, candidates…"
            aria-label="Search pages"
          />
        </label>
      </div>

      <div className="sidebar-section">
        <button
          type="button"
          className={`sidebar-section-toggle ${expanded.has("graph") ? "is-expanded" : ""}`}
          onClick={() => toggle("graph")}
        >
          Graph{graphActiveCount > 0 ? <span className="filter-badge">{graphActiveCount}</span> : null}
        </button>
        <div className={`sidebar-section-body ${expanded.has("graph") ? "is-expanded" : ""}`}>
          <label className="filter-group">
            <span className="filter-label">Edge status</span>
            <select className="input" value={edgeStatusFilter} onChange={(event) => onEdgeStatusChange(event.target.value)}>
              <option value="all">All</option>
              <option value="extracted">Extracted</option>
              <option value="conflicted">Conflicted</option>
              <option value="inferred">Inferred</option>
              <option value="stale">Stale</option>
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Source class</span>
            <select className="input" value={sourceClassFilter} onChange={(event) => onSourceClassChange(event.target.value)}>
              <option value="all">All</option>
              {sourceClassOptions.map((sourceClass) => (
                <option key={sourceClass} value={sourceClass}>
                  {sourceClass}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Community</span>
            <select className="input" value={communityFilter} onChange={(event) => onCommunityChange(event.target.value)}>
              <option value="all">All</option>
              {communityOptions.map((communityId) => (
                <option key={communityId} value={communityId}>
                  {communityId}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="sidebar-section">
        <button
          type="button"
          className={`sidebar-section-toggle ${expanded.has("tags") ? "is-expanded" : ""}`}
          onClick={() => toggle("tags")}
        >
          Tags{tagsActiveCount > 0 ? <span className="filter-badge">{tagsActiveCount}</span> : null}
        </button>
        <div className={`sidebar-section-body ${expanded.has("tags") ? "is-expanded" : ""}`}>
          {tagOptions.length === 0 ? (
            <p className="text-muted text-sm">No tags in this vault yet.</p>
          ) : (
            <>
              <label className="filter-group">
                <span className="filter-label">Filter tags</span>
                <input
                  type="search"
                  className="input"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  placeholder="Search tags…"
                  aria-label="Search tags"
                  data-testid="tag-search-input"
                />
              </label>
              <div className="chip-row" data-testid="tag-chip-row">
                <button
                  type="button"
                  className={`chip chip-tag${selectedTags.length === 0 ? " is-active" : ""}`}
                  onClick={onClearTags}
                  data-testid="tag-chip-all"
                >
                  all
                </button>
                {visibleTags.map(({ tag, count }) => {
                  const active = selectedTagSet.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`chip chip-tag${active ? " is-active" : ""}`}
                      onClick={() => onToggleTag(tag)}
                      title={`${count} pages`}
                      data-testid={`tag-chip-${tag}`}
                      aria-pressed={active}
                    >
                      #{tag} <span className="text-muted text-xs">{count}</span>
                    </button>
                  );
                })}
              </div>
              {hiddenTagCount > 0 || (showAllTags && filteredTags.length > DEFAULT_TAG_LIMIT) ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowAllTags((value) => !value)}
                  data-testid="tag-expander"
                >
                  {showAllTags ? "Show fewer tags" : `Show all ${filteredTags.length} tags`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="sidebar-section">
        <button
          type="button"
          className={`sidebar-section-toggle ${expanded.has("pages") ? "is-expanded" : ""}`}
          onClick={() => toggle("pages")}
        >
          Pages{pagesActiveCount > 0 ? <span className="filter-badge">{pagesActiveCount}</span> : null}
        </button>
        <div className={`sidebar-section-body ${expanded.has("pages") ? "is-expanded" : ""}`}>
          <label className="filter-group">
            <span className="filter-label">Page kind</span>
            <select className="input" value={kindFilter} onChange={(event) => onKindChange(event.target.value)}>
              <option value="all">All</option>
              <option value="source">Source</option>
              <option value="module">Module</option>
              <option value="concept">Concept</option>
              <option value="entity">Entity</option>
              <option value="output">Output</option>
              <option value="insight">Insight</option>
              <option value="graph_report">Graph report</option>
              <option value="community_summary">Community summary</option>
              <option value="index">Index</option>
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Status</span>
            <select className="input" value={pageStatusFilter} onChange={(event) => onPageStatusChange(event.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="candidate">Candidate</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Project</span>
            <select className="input" value={projectFilter} onChange={(event) => onProjectChange(event.target.value)}>
              <option value="all">All</option>
              <option value="unassigned">Unassigned</option>
              {projectOptions.map((projectId) => (
                <option key={projectId} value={projectId}>
                  {projectId}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Source type</span>
            <select className="input" value={sourceTypeFilter} onChange={(event) => onSourceTypeChange(event.target.value)}>
              <option value="all">All</option>
              {sourceTypeOptions.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {sourceType}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
