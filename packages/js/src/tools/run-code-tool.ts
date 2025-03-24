import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";
import { Sandbox } from "@e2b/code-interpreter";

const toolSchema = z.object({
  code: z.string(),
  session_id: z.string().optional(),
});

class RunCodeTool extends ToolHandler {
  name = "run_code";
  description = "Run python code in a secure remote sandbox by E2B. Using the Jupyter Notebook syntax.";
  inputSchema = toolSchema;

  async execute(args: any): Promise<any> {
    const { code, session_id } = args;
    const { sandbox, sessionId } = await this.getSandbox(session_id);
    const exe_res = await sandbox.runCode(code);
    const { results, logs, error } = exe_res;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error,
            results,
            logs,
            session_id: sessionId
          }, null, 2),
        },
      ],
    };
  }

}

export default RunCodeTool;
