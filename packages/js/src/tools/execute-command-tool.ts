import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";

const commandSchema = z.object({
  command: z.string().describe("Full CLI command to execute"),
  cwd: z.string().optional().describe("Working directory (default: user's home)"),
  envs: z.record(z.string()).optional().describe("Environment variables as key-value pairs"),
  timeoutMs: z.number().optional().describe("Execution timeout in milliseconds (default: 60000)"),
  background: z.boolean().optional().describe("Run in background for long-running processes"),
  session_id: z.string().optional()
});

class ExecuteCommandTool extends ToolHandler {
  name = "execute_command";
  description = "Execute CLI commands in secure remote sandbox (requires user approval)";
  inputSchema = commandSchema;

  async execute(args: any): Promise<any> {
    const { command, cwd, envs, timeoutMs, background, session_id } = args;
    const { sandbox, sessionId } = await this.getSandbox(session_id);

    // Handle command execution based on background flag
    if (background) {
      // For background processes
      const result = await sandbox.commands.run(command, {
        cwd,
        envs,
        timeoutMs: timeoutMs ?? 600000,
        background: true
      });

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
        timeoutMs: timeoutMs ?? 600000,
        background: false
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
    }
  }

}

export default ExecuteCommandTool;
