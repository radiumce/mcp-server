import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import logger from './logger.js';

class ErrorHandler {
  static handle(error: any, toolName: string, params: any): any {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: toolName,
      stage: 'error',
      status: 'failed',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      params
    }));

    const errorResponse = {
      error: {
        code: ErrorCode.InternalError,
        message: `Tool execution failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
        tool: toolName,
        params: params,
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
}

export default ErrorHandler;
