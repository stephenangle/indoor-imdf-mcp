import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { registerTools, handleToolCall } from "./tools/index.js";
// import { registerResources, handleResourceRead } from "./resources/index.js";

const server = new Server({
  name: "indoor-imdf-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: registerTools() };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await handleToolCall(request);
});

/* 
// resources implementation deferred to Phase 3B
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: registerResources() };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return await handleResourceRead(request);
});
*/

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("indoor-imdf-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
