#!/usr/bin/env node
import { Sandbox } from "@e2b/code-interpreter";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import logger from "./logger.js";
import RunCodeTool from "./tools/run-code-tool.js";
import ReadFileTool from "./tools/read-file-tool.js";
import WriteFileTool from "./tools/write-file-tool.js";
import ExecuteCommandTool from "./tools/execute-command-tool.js";
import UploadFileTool from "./tools/upload-file-tool.js";
import DownloadFileTool from "./tools/download-file-tool.js";

dotenv.config();

class E2BServer {
  private server: Server;
  private sessions = new Map<string, { sandbox: Sandbox; lastAccessed: number }>();
  private SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.server = new Server(
      {
        name: "e2b-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      // Note: Sandbox doesn't have a close method, so we just clear the sessions map
      this.sessions.clear();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupToolHandlers();
    this.setupSessionCleanup();
  }

  private setupSessionCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastAccessed > this.SESSION_TIMEOUT) {
          // Note: Sandbox doesn't have a close method, so we just remove it from the map
          this.sessions.delete(sessionId);
          logger.info(`Session ${sessionId} expired and cleaned up`);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  private async getSandbox(sessionId?: string): Promise<{ sandbox: Sandbox; sessionId: string }> {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastAccessed = Date.now();
      return { sandbox: session.sandbox, sessionId };
    }

    // Generate a new session ID if none provided or if the provided one doesn't exist
    const newSessionId = sessionId || `sess_${Math.random().toString(36).substring(2, 9)}`;
    const sandbox = await Sandbox.create();
    this.sessions.set(newSessionId, { sandbox, lastAccessed: Date.now() });
    logger.info(`Created new session: ${newSessionId}`);
    return { sandbox, sessionId: newSessionId };
  }

  private setupToolHandlers(): void {
    // Create a sandbox provider function to pass to tools
    const sandboxProvider = this.getSandbox.bind(this);
    
    // Initialize tools with the sandbox provider
    const runCodeTool = new RunCodeTool(sandboxProvider);
    const readFileTool = new ReadFileTool(sandboxProvider);
    const writeFileTool = new WriteFileTool(sandboxProvider);
    const executeCommandTool = new ExecuteCommandTool(sandboxProvider);
    const uploadFileTool = new UploadFileTool(sandboxProvider);
    const downloadFileTool = new DownloadFileTool(sandboxProvider);

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        runCodeTool.getToolDefinition(),
        readFileTool.getToolDefinition(),
        writeFileTool.getToolDefinition(),
        executeCommandTool.getToolDefinition(),
        uploadFileTool.getToolDefinition(),
        downloadFileTool.getToolDefinition(),
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;

      switch (toolName) {
        case "run_code":
          return runCodeTool.handle(request);
        case "read_file":
          return readFileTool.handle(request);
        case "write_file":
          return writeFileTool.handle(request);
        case "execute_command":
          return executeCommandTool.handle(request);
        case "upload_file":
          return uploadFileTool.handle(request);
        case "download_file":
          return downloadFileTool.handle(request);
        default:
          logger.error(`Unknown tool: ${toolName}`);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown tool: ${toolName}` }, null, 2),
              },
            ],
            isError: true,
          };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Although this is just an informative message, we must log to stderr,
    // to avoid interfering with MCP communication that happens on stdout
    logger.info("E2B MCP server running on stdio");
  }
}

const server = new E2BServer();
server.run().catch(console.error);
