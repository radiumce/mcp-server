#!/usr/bin/env node
import { Sandbox } from "@e2b/code-interpreter";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from 'url';

dotenv.config();

const toolSchema = z.object({
  code: z.string(),
  session_id: z.string().optional(),
});

const readFileSchema = z.object({
  path: z.string(),
  session_id: z.string().optional(),
});

const writeFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  session_id: z.string().optional()
});

const uploadFileSchema = z.object({
  local_path: z.string().describe("Absolute path to the local file"),
  sandbox_path: z.string().optional().nullable().describe("Target path with filename inside the sandbox"),
  overwrite: z.boolean().optional().default(true).describe("Overwrite existing file"),
  session_id: z.string().optional()
});

const commandSchema = z.object({
  command: z.string().describe("Full CLI command to execute"),
  cwd: z.string().optional().describe("Working directory (default: user's home)"),
  envs: z.record(z.string()).optional().describe("Environment variables as key-value pairs"),
  timeoutMs: z.number().optional().describe("Execution timeout in milliseconds (default: 60000)"),
  background: z.boolean().optional().describe("Run in background for long-running processes"),
  session_id: z.string().optional()
});

class E2BServer {
  private server: Server;
  private sessions = new Map<string, { sandbox: Sandbox, lastAccessed: number }>();
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
      console.error("[MCP Error]", error);
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
          console.error(`Session ${sessionId} expired and cleaned up`);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  private async getSandbox(sessionId?: string): Promise<{ sandbox: Sandbox, sessionId: string }> {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastAccessed = Date.now();
      return { sandbox: session.sandbox, sessionId };
    }

    // Generate a new session ID if none provided or if the provided one doesn't exist
    const newSessionId = sessionId || `sess_${Math.random().toString(36).substring(2, 9)}`;
    const sandbox = await Sandbox.create();
    this.sessions.set(newSessionId, { sandbox, lastAccessed: Date.now() });
    console.error(`Created new session: ${newSessionId}`);
    return { sandbox, sessionId: newSessionId };
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "run_code",
          description:
            "Run python code in a secure remote sandbox by E2B. Using the Jupyter Notebook syntax.",
          inputSchema: zodToJsonSchema(toolSchema),
        },
        {
          name: "read_file",
          description:
            "Read file content from temporary remote sandbox filesystem (non-persistent)",
          inputSchema: zodToJsonSchema(readFileSchema),
        },
        {
          name: "write_file",
          description:
            "Write content to temporary remote sandbox filesystem (data cleared after session)",
          inputSchema: zodToJsonSchema(writeFileSchema),
        },
        {
          name: "execute_command",
          description: "Execute CLI commands in secure remote sandbox (requires user approval)",
          inputSchema: zodToJsonSchema(commandSchema),
        },
        {
          name: "upload_file",
          description: "Upload a local file to the remote sandbox (only from allowed paths)",
          inputSchema: zodToJsonSchema(uploadFileSchema),
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // 记录工具调用开始
      const startTime = Date.now();
      const toolName = request.params.name;
      
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        tool: toolName,
        stage: 'start',
        params: request.params.arguments
      }));
      
      if (request.params.name === "run_code") {
        const parsed = toolSchema.safeParse(request.params.arguments);
        if (!parsed.success) {
          // 记录参数验证失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'validation',
            status: 'failed',
            error: parsed.error.message
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InvalidParams,
              message: "Invalid code interpreter arguments",
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              error_details: parsed.error.message
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }

        // 记录参数验证成功
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'success',
          params: parsed.data
        }));

        const { code, session_id } = parsed.data;
        
        try {
          const { sandbox, sessionId } = await this.getSandbox(session_id);
          const exe_res = await sandbox.runCode(code);
          const { results, logs } = exe_res;
          // 记录工具执行完成
          console.error(JSON.stringify({
            info: exe_res,
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'complete',
            status: 'success',
            duration: `${Date.now() - startTime}ms`,
            session_id: sessionId
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ 
                  exe_res,
                  results, 
                  logs,
                  session_id: sessionId 
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 记录工具执行失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'error',
            status: 'failed',
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${Date.now() - startTime}ms`
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InternalError,
              message: `Tool execution failed: ${errorMessage}`,
              session_id: session_id,
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              stack: error instanceof Error ? error.stack : undefined
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }
      } else if (request.params.name === "read_file") {
        const parsed = readFileSchema.safeParse(request.params.arguments);
        if (!parsed.success) {
          // 记录参数验证失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'validation',
            status: 'failed',
            error: parsed.error.message
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InvalidParams,
              message: "Invalid read_file arguments",
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              error_details: parsed.error.message
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }

        // 记录参数验证成功
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'success',
          params: parsed.data
        }));

        const { path, session_id } = parsed.data;
        
        try {
          const { sandbox, sessionId } = await this.getSandbox(session_id);
          const content = await sandbox.files.read(path);
          
          // 记录工具执行完成
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'complete',
            status: 'success',
            duration: `${Date.now() - startTime}ms`,
            session_id: sessionId,
            path
          }));
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  content,
                  session_id: sessionId
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 记录工具执行失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'error',
            status: 'failed',
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${Date.now() - startTime}ms`,
            path
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InternalError,
              message: `Tool execution failed: ${errorMessage}`,
              session_id: session_id,
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              stack: error instanceof Error ? error.stack : undefined
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }
      } else if (request.params.name === "write_file") {
        const parsed = writeFileSchema.safeParse(request.params.arguments);
        if (!parsed.success) {
          // 记录参数验证失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'validation',
            status: 'failed',
            error: parsed.error.message
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InvalidParams,
              message: "Invalid write_file arguments",
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              error_details: parsed.error.message
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }

        // 记录参数验证成功
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'success',
          params: parsed.data
        }));

        const { path, content, session_id } = parsed.data;
        
        try {
          const { sandbox, sessionId } = await this.getSandbox(session_id);
          await sandbox.files.write(path, content);
          
          // 记录工具执行完成
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'complete',
            status: 'success',
            duration: `${Date.now() - startTime}ms`,
            session_id: sessionId,
            path
          }));
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "File written successfully",
                  session_id: sessionId
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 记录工具执行失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'error',
            status: 'failed',
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${Date.now() - startTime}ms`,
            path
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InternalError,
              message: `Tool execution failed: ${errorMessage}`,
              session_id: session_id,
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              stack: error instanceof Error ? error.stack : undefined
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }
      } else if (request.params.name === "execute_command") {
        const parsed = commandSchema.safeParse(request.params.arguments);
        if (!parsed.success) {
          // 记录参数验证失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'validation',
            status: 'failed',
            error: parsed.error.message
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InvalidParams,
              message: "Invalid command parameters",
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              error_details: parsed.error.message
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }

        // 记录参数验证成功
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'success',
          params: parsed.data
        }));

        const { command, cwd, envs, timeoutMs, background, session_id } = parsed.data;
        
        try {
          const { sandbox, sessionId } = await this.getSandbox(session_id);
          
          // Handle command execution based on background flag
          if (background) {
            // For background processes
            const result = await sandbox.commands.run(command, {
              cwd,
              envs,
              timeoutMs: timeoutMs ?? 60000,
              background: true
            });
            
            // 记录工具执行完成（后台进程）
            console.error(JSON.stringify({
              timestamp: new Date().toISOString(),
              tool: toolName,
              stage: 'complete',
              status: 'success',
              duration: `${Date.now() - startTime}ms`,
              session_id: sessionId,
              background: true,
              pid: result.pid
            }));
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "Command started in background",
                  pid: result.pid,
                  session_id: sessionId
                }, null, 2)
              }]
            };
          } else {
            // For foreground processes
            const result = await sandbox.commands.run(command, {
              cwd,
              envs,
              timeoutMs: timeoutMs ?? 60000,
              background: false
            });
            
            // 记录工具执行完成（前台进程）
            console.error(JSON.stringify({
              timestamp: new Date().toISOString(),
              tool: toolName,
              stage: 'complete',
              status: 'success',
              duration: `${Date.now() - startTime}ms`,
              session_id: sessionId,
              background: false,
              stdoutLength: result.stdout?.length || 0,
              stderrLength: result.stderr?.length || 0
            }));
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  stdout: result.stdout,
                  stderr: result.stderr,
                  session_id: sessionId
                }, null, 2)
              }]
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 记录工具执行失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'error',
            status: 'failed',
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${Date.now() - startTime}ms`,
            command
          }));
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
              }, null, 2)
            }]
          };
        }
      } else if (request.params.name === "upload_file") {
        const parsed = uploadFileSchema.safeParse(request.params.arguments);
        if (!parsed.success) {
          // 记录参数验证失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'validation',
            status: 'failed',
            error: parsed.error.message
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InvalidParams,
              message: "Invalid upload_file arguments",
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              error_details: parsed.error.message
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }

        // 记录参数验证成功
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'success',
          params: parsed.data
        }));

        let { local_path, sandbox_path, overwrite, session_id } = parsed.data;

        // Convert "null" and "\"\"" to actual null or ""
        if (sandbox_path === "null") {
          sandbox_path = null;
        } else if (sandbox_path === "\"\"") {
          sandbox_path = "";
        }

        try {
          // If sandbox_path is not provided, set it to the filename of local_path
          if (!sandbox_path)
            sandbox_path = path.basename(local_path);

          // 验证本地路径是否在允许的目录中
          const allowedPaths = process.env.E2B_ALLOWED_UPLOAD_PATHS?.split(',') || [];
          if (allowedPaths.length === 0) {
            throw new Error("No allowed upload paths configured. Set E2B_ALLOWED_UPLOAD_PATHS environment variable.");
          }
          
          // 规范化路径
          const normalizedPath = path.normalize(local_path);
          
          // 检查路径是否在允许的目录中
          const isPathAllowed = allowedPaths.some(allowedPath => {
            const normalizedAllowedPath = path.normalize(allowedPath);
            return normalizedPath === normalizedAllowedPath || 
                   normalizedPath.startsWith(normalizedAllowedPath + path.sep);
          });
          
          if (!isPathAllowed) {
            throw new Error(`Access denied: ${local_path} is not in allowed upload paths`);
          }
          
          // 读取本地文件
          const fileContent = await fs.readFile(normalizedPath, 'utf-8');
          
          // 获取沙箱实例
          const { sandbox, sessionId } = await this.getSandbox(session_id);
          
          // 写入沙箱文件系统
          // 如果需要检查文件是否存在并处理覆盖逻辑，可以先尝试读取文件
          if (overwrite === false) {
            try {
              await sandbox.files.read(sandbox_path);
              throw new Error(`File already exists at ${sandbox_path} and overwrite is set to false`);
            } catch (readError) {
              // 如果文件不存在，会抛出错误，这是我们期望的情况
              if (!(readError instanceof Error) || !readError.message.includes("not found")) {
                throw readError; // 如果是其他错误，则重新抛出
              }
              // 文件不存在，继续写入
            }
          }

          console.error(JSON.stringify({
            tool: toolName,
            stage: 'before upload',
            local_path,
            sandbox_path
          }));
          
          // 写入文件
          await sandbox.files.write(sandbox_path, fileContent);
          
          // 记录工具执行完成
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'complete',
            status: 'success',
            duration: `${Date.now() - startTime}ms`,
            session_id: sessionId,
            local_path: normalizedPath,
            sandbox_path
          }));
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "File uploaded successfully",
                  local_path: normalizedPath,
                  sandbox_path,
                  session_id: sessionId
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 记录工具执行失败
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool: toolName,
            stage: 'error',
            status: 'failed',
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
            duration: `${Date.now() - startTime}ms`,
            local_path,
            sandbox_path
          }));
          
          const errorResponse = {
            error: {
              code: ErrorCode.InternalError,
              message: `Tool execution failed: ${errorMessage}`,
              session_id: session_id,
              timestamp: new Date().toISOString(),
              tool: toolName,
              params: request.params.arguments,
              stack: error instanceof Error ? error.stack : undefined
            }
          };
          return {
            content: [{
              type: "text",
              text: JSON.stringify(errorResponse, null, 2)
            }],
            isError: true
          };
        }
      } else {
        // 记录未知工具调用
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'error',
          status: 'failed',
          error: `Unknown tool: ${toolName}`
        }));
        
        const errorResponse = {
          error: {
            code: ErrorCode.MethodNotFound,
            message: `Unknown tool: ${toolName}`,
            timestamp: new Date().toISOString(),
            tool: toolName,
            params: request.params.arguments
          }
        };
        return {
          content: [{
            type: "text",
            text: JSON.stringify(errorResponse, null, 2)
          }],
          isError: true
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Although this is just an informative message, we must log to stderr,
    // to avoid interfering with MCP communication that happens on stdout
    console.error("E2B MCP server running on stdio");
  }
}

const server = new E2BServer();
server.run().catch(console.error);
