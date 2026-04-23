import type { GraphArtifact, GraphNode, GraphReportArtifact, GraphShareArtifact } from "./types.js";
import { truncate, uniqueBy } from "./utils.js";

function displayVaultName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "this vault";
}

function sortedFallbackHubs(graph: GraphArtifact): GraphNode[] {
  return graph.nodes
    .filter((node) => node.type !== "source")
    .sort(
      (left, right) =>
        (right.degree ?? 0) - (left.degree ?? 0) ||
        (right.bridgeScore ?? 0) - (left.bridgeScore ?? 0) ||
        left.label.localeCompare(right.label)
    )
    .slice(0, 5);
}

function graphNodeMap(graph: GraphArtifact): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function compactJoin(values: string[], fallback: string): string {
  const filtered = values.filter(Boolean);
  if (!filtered.length) {
    return fallback;
  }
  if (filtered.length === 1) {
    return filtered[0] ?? fallback;
  }
  if (filtered.length === 2) {
    return `${filtered[0]} and ${filtered[1]}`;
  }
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

function buildShortPost(input: {
  vaultName: string;
  overview: GraphShareArtifact["overview"];
  topHubs: GraphShareArtifact["highlights"]["topHubs"];
  surprisingConnections: GraphShareArtifact["highlights"]["surprisingConnections"];
}): string {
  const topHubLine = input.topHubs.length
    ? `Top hubs: ${compactJoin(
        input.topHubs.slice(0, 3).map((node) => node.label),
        "still emerging"
      )}.`
    : "Top hubs are still emerging.";
  const surprise = input.surprisingConnections[0];
  const surpriseLine = surprise
    ? `Most surprising link: ${surprise.sourceLabel} ${surprise.relation} ${surprise.targetLabel}.`
    : "The graph is ready for its first surprising connection.";

  return [
    `I scanned ${input.vaultName} with SwarmVault: ${input.overview.sources} sources -> ${input.overview.pages} wiki pages, ${input.overview.nodes} graph nodes, ${input.overview.edges} edges.`,
    topHubLine,
    surpriseLine,
    "Everything stays local. Try: npm install -g @swarmvaultai/cli && swarmvault scan ./your-repo"
  ].join("\n");
}

export function buildGraphShareArtifact(input: {
  graph: GraphArtifact;
  report?: GraphReportArtifact | null;
  vaultName?: string;
}): GraphShareArtifact {
  const { graph, report } = input;
  const vaultName = displayVaultName(input.vaultName);
  const nodesById = graphNodeMap(graph);
  const fallbackHubs = sortedFallbackHubs(graph);
  const reportHubs =
    report?.godNodes.map((node) => {
      const graphNode = nodesById.get(node.nodeId);
      return {
        nodeId: node.nodeId,
        label: node.label ?? graphNode?.label ?? node.nodeId,
        degree: node.degree ?? graphNode?.degree
      };
    }) ?? [];
  const fallbackHubHighlights = fallbackHubs.map((node) => ({
    nodeId: node.id,
    label: node.label,
    degree: node.degree
  }));
  const topHubs = (reportHubs.length ? reportHubs : fallbackHubHighlights).slice(0, 5);
  const reportBridgeNodes =
    report?.bridgeNodes.map((node) => {
      const graphNode = nodesById.get(node.nodeId);
      return {
        nodeId: node.nodeId,
        label: node.label ?? graphNode?.label ?? node.nodeId,
        bridgeScore: node.bridgeScore ?? graphNode?.bridgeScore
      };
    }) ?? [];
  const fallbackBridgeNodes = fallbackHubs.map((node) => ({
    nodeId: node.id,
    label: node.label,
    bridgeScore: node.bridgeScore
  }));
  const bridgeNodes = (reportBridgeNodes.length ? reportBridgeNodes : fallbackBridgeNodes).slice(0, 3).filter((node) => node.label);
  const surprisingConnections = (report?.surprisingConnections ?? []).slice(0, 3).map((connection) => {
    const source = nodesById.get(connection.sourceNodeId);
    const target = nodesById.get(connection.targetNodeId);
    return {
      sourceLabel: source?.label ?? connection.sourceNodeId,
      targetLabel: target?.label ?? connection.targetNodeId,
      relation: connection.relation,
      why: truncate(connection.why || connection.explanation || "Cross-community connection", 180)
    };
  });
  const overview = {
    sources: graph.sources.length,
    nodes: report?.overview.nodes ?? graph.nodes.length,
    edges: report?.overview.edges ?? graph.edges.length,
    pages: report?.overview.pages ?? graph.pages.length,
    communities: report?.overview.communities ?? graph.communities?.length ?? 0
  };
  const firstPartyOverview = report?.firstPartyOverview ?? {
    nodes: graph.nodes.filter((node) => node.sourceClass === "first_party").length,
    edges: graph.edges.length,
    pages: graph.pages.filter((page) => page.sourceClass === "first_party").length,
    communities: graph.communities?.length ?? 0
  };
  const relatedNodeIds = uniqueBy([...topHubs.map((node) => node.nodeId), ...bridgeNodes.map((node) => node.nodeId)], (value) => value);
  const relatedPageIds = uniqueBy(
    relatedNodeIds.map((nodeId) => nodesById.get(nodeId)?.pageId).filter((pageId): pageId is string => Boolean(pageId)),
    (value) => value
  );
  const relatedSourceIds = uniqueBy(
    [...graph.sources.map((source) => source.sourceId), ...relatedNodeIds.flatMap((nodeId) => nodesById.get(nodeId)?.sourceIds ?? [])],
    (value) => value
  );
  const knowledgeGaps = report?.knowledgeGaps?.warnings?.length
    ? report.knowledgeGaps.warnings.slice(0, 3)
    : report?.warnings?.length
      ? report.warnings.slice(0, 3)
      : [];
  const tagline = `A local-first map of ${vaultName}: ${overview.sources} sources compiled into ${overview.nodes} graph nodes and ${overview.pages} wiki pages.`;
  const artifact = {
    generatedAt: new Date().toISOString(),
    vaultName,
    tagline,
    overview,
    firstPartyOverview,
    highlights: {
      topHubs,
      bridgeNodes,
      surprisingConnections,
      suggestedQuestions: (report?.suggestedQuestions ?? []).slice(0, 5)
    },
    knowledgeGaps,
    shortPost: "",
    relatedNodeIds,
    relatedPageIds,
    relatedSourceIds
  } satisfies GraphShareArtifact;

  return {
    ...artifact,
    shortPost: buildShortPost({
      vaultName,
      overview,
      topHubs,
      surprisingConnections
    })
  };
}

export function renderGraphShareMarkdown(artifact: GraphShareArtifact): string {
  const lines = [
    "# SwarmVault Share Card",
    "",
    `> ${artifact.tagline}`,
    "",
    "## Snapshot",
    "",
    `- Sources: ${artifact.overview.sources}`,
    `- Wiki pages: ${artifact.overview.pages}`,
    `- Graph nodes: ${artifact.overview.nodes}`,
    `- Graph edges: ${artifact.overview.edges}`,
    `- Communities: ${artifact.overview.communities}`,
    `- First-party focus: ${artifact.firstPartyOverview.nodes} nodes, ${artifact.firstPartyOverview.edges} edges, ${artifact.firstPartyOverview.pages} pages`,
    "",
    "## Highlights",
    "",
    artifact.highlights.topHubs.length
      ? `- Top hubs: ${compactJoin(
          artifact.highlights.topHubs.slice(0, 5).map((node) => (node.degree ? `${node.label} (${node.degree})` : node.label)),
          "none yet"
        )}`
      : "- Top hubs: none yet",
    artifact.highlights.bridgeNodes.length
      ? `- Bridge nodes: ${compactJoin(
          artifact.highlights.bridgeNodes.slice(0, 3).map((node) => node.label),
          "none yet"
        )}`
      : "- Bridge nodes: none yet",
    ...(artifact.highlights.surprisingConnections.length
      ? artifact.highlights.surprisingConnections.map(
          (connection) => `- Surprising link: ${connection.sourceLabel} ${connection.relation} ${connection.targetLabel}. ${connection.why}`
        )
      : ["- Surprising link: not enough cross-community evidence yet"]),
    "",
    "## Ask Next",
    "",
    ...(artifact.highlights.suggestedQuestions.length
      ? artifact.highlights.suggestedQuestions.map((question) => `- ${question}`)
      : ["- Add more sources, run `swarmvault compile`, then ask the graph what changed."]),
    "",
    "## Share Post",
    "",
    "```text",
    artifact.shortPost,
    "```",
    "",
    "## Reproduce",
    "",
    "```bash",
    "npm install -g @swarmvaultai/cli",
    "swarmvault scan ./your-repo",
    "swarmvault graph share --post",
    "```",
    ""
  ];

  if (artifact.knowledgeGaps.length) {
    lines.splice(
      lines.indexOf("## Ask Next"),
      0,
      "## Gaps To Strengthen",
      "",
      ...artifact.knowledgeGaps.map((warning) => `- ${warning}`),
      ""
    );
  }

  return `${lines.join("\n")}`;
}
