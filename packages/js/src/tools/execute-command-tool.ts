import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";
import { CommandExitError } from "@e2b/code-interpreter";
import logger from "../logger.js";

const commandSchema = z.object({
  command: z.string().describe("Full CLI command to execute"),
  cwd: z.string().optional().describe("Working directory (default: user's home)"),
  envs: z.record(z.string()).optional().describe("Environment variables as key-value pairs"),
  timeoutMs: z.number().optional().describe("Execution timeout in milliseconds (default: 600000)"),
  session_id: z.string().optional()
});

class ExecuteCommandTool extends ToolHandler {
  name = "execute_command";
  description = "Execute CLI commands in secure remote sandbox (requires user approval)";
  inputSchema = commandSchema;

  async execute(args: any): Promise<any> {
    const { command, cwd, envs, timeoutMs, session_id } = args;
    const { sandbox, sessionId } = await this.getSandbox(session_id);


    // For foreground processes
    try {
      const result = await sandbox.commands.run(command, {
        cwd,
        envs,
        timeoutMs: timeoutMs ?? 6000000,
        background: false,
        onStdout: (data) => {
          logger.info(JSON.stringify({
            stdout: data
          }))
        },
        onStderr: (data) => {
          logger.info(JSON.stringify({
            stderr: data
          }))
        }
      });

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
    } catch (error) {
      if (error instanceof CommandExitError) {
        const wrappedError = new Error(JSON.stringify({
          code: "COMMAND_FAILED",
          exitCode: error.exitCode,
          stdout: error.stdout,
          stderr: error.stderr,
          message: `Command failed with code ${error.exitCode}`
        }));
        wrappedError.stack = error.stack;
        throw wrappedError;
      }
      throw error;
    }

  }

}

export default ExecuteCommandTool;
