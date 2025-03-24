import {
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z, ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import logger from './logger.js';
import ErrorHandler from "./error-handler.js";
import { Sandbox } from "@e2b/code-interpreter";

// Define a type for the getSandbox function
export type SandboxProvider = (sessionId?: string) => Promise<{ sandbox: Sandbox; sessionId: string }>;

abstract class ToolHandler {
  protected sandboxProvider?: SandboxProvider;
  abstract name: string;
  abstract description: string;
  abstract inputSchema: ZodSchema;

  async handle(request: any): Promise<any> {
    const startTime = Date.now();
    const toolName = this.name;

    logger.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: toolName,
      stage: 'start',
      params: request.params.arguments
    }));

    try {
      const parsed = this.inputSchema.safeParse(request.params.arguments);
      if (!parsed.success) {
        logger.info(JSON.stringify({
          timestamp: new Date().toISOString(),
          tool: toolName,
          stage: 'validation',
          status: 'failed',
          error: parsed.error.message
        }));

        const errorResponse = {
          error: {
            code: ErrorCode.InvalidParams,
            message: `Invalid ${toolName} arguments`,
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

      logger.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        tool: toolName,
        stage: 'validation',
        status: 'success',
        params: parsed.data
      }));

      const result = await this.execute(parsed.data);

      logger.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        tool: toolName,
        stage: 'complete',
        status: 'success',
        duration: `${Date.now() - startTime}ms`,
        result
      }));

      return result;
    } catch (error: any) {
      return ErrorHandler.handle(error, toolName, request.params.arguments);
    }
  }

  constructor(sandboxProvider?: SandboxProvider) {
    this.sandboxProvider = sandboxProvider;
  }

  protected async getSandbox(sessionId?: string): Promise<{ sandbox: Sandbox; sessionId: string }> {
    if (!this.sandboxProvider) {
      throw new Error("Sandbox provider not initialized");
    }
    return this.sandboxProvider(sessionId);
  }

  abstract execute(args: any): Promise<any>;

  getToolDefinition() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: zodToJsonSchema(this.inputSchema),
    };
  }
}

export default ToolHandler;
