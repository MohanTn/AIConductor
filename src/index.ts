/**
 * MCP Server for AIConductor
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AIConductor } from './AIConductor.js';
import { startDashboard } from './dashboard.js';
import { broadcastEvent } from './broadcast.js';
import { wsManager } from './websocket.js';
import { createToolHandlers } from './toolRegistry.js';
import { TOOLS } from './toolSchemas.js';
import Ajv from 'ajv';

// Export error types for use throughout the codebase
export {
  NotFoundError,
  ValidationError,
  ConflictError,
  PermissionError,
  ConcurrencyConflictError,
} from './errors.js';

// Initialize the MCP server
const server = new Server(
  {
    name: 'aiconductor-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize AIConductor and tool handler registry
const reviewManager = new AIConductor();
const TOOL_HANDLERS = createToolHandlers(reviewManager, wsManager, broadcastEvent);

// ─── AJV Runtime Input Validation (T02) ──────────────────────────────────────
// Compile each tool's inputSchema into a fast ajv validator at startup.
// Validated once per server start; near-zero overhead at call time.
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Pre-compiled validators keyed by tool name.
 * Each validator is compiled once at startup from the tool's inputSchema.
 */
const TOOL_VALIDATORS = new Map<string, ReturnType<typeof ajv.compile>>(
  TOOLS.map(tool => [
    tool.name,
    ajv.compile({ ...tool.inputSchema, additionalProperties: true }),
  ])
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error('Missing arguments');
    }

    // ── AJV schema validation (T02): validate before dispatching ──────────
    const validate = TOOL_VALIDATORS.get(name);
    if (validate) {
      const valid = validate(args);
      if (!valid) {
        const validationErrors = (validate.errors || []).map(e =>
          `${e.instancePath || '(root)'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid tool arguments', validationErrors }) }],
          isError: true,
        };
      }
    }

    // ── Registry dispatch (T03) ────────────────────────────────────────────
    const handler = TOOL_HANDLERS.get(name);
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(args as Record<string, unknown>);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  // Start dashboard server on port 5111 only if not running as MCP client connection.
  // When Claude Code connects via `docker exec`, it spawns a new process inside the
  // container where port 5111 is already in use by the container's main process.
  // Set DISABLE_DASHBOARD=true to skip dashboard startup in that case.
  if (process.env.DISABLE_DASHBOARD !== 'true') {
    startDashboard(5111);
  }

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AIConductor MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
