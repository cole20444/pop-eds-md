// Thin abstraction over Figma MCP reads. The orchestrator depends on this
// interface, not on MCP tool names directly — keeps tests fixture-driven
// and isolates us from MCP tool churn.
//
// Sample Page contract (per spec): the orchestrator only consumes the
// `components` field from snapshots, which represents master Components
// on the Components page. Sample Page instance overrides are NOT a
// sync source — they are not included here. See
// specs/2026-05-22-figma-mcp-bootstrap-design.md "Sample Page is not a sync source".

export function makeFixtureClient(snapshot) {
  return {
    async fetchSnapshot(/* fileKey */) {
      return snapshot;
    },
  };
}

// makeStdinClient is the real implementation. It is intentionally minimal
// here — the actual MCP tool calls happen via the Claude Code session,
// not from this script. This client is invoked by the orchestrator in
// "report mode" — it builds the request envelope; the human / Claude
// invokes the MCP tools and feeds the result back via stdin (see
// figma-sync.mjs Task D7).
export function makeStdinClient() {
  return {
    async fetchSnapshot(fileKey) {
      process.stderr.write(
        `Awaiting Figma snapshot on stdin for fileKey=${fileKey}…\n` +
        `Expected JSON shape: { versionId, variables, components }\n`
      );
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  };
}
