import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";

const readFileSchema = z.object({
  path: z.string(),
  session_id: z.string().optional(),
});

class ReadFileTool extends ToolHandler {
  name = "read_file";
  description = "Read file content from temporary remote sandbox filesystem (non-persistent)";
  inputSchema = readFileSchema;

  async execute(args: any): Promise<any> {
    const { path, session_id } = args;
    const { sandbox, sessionId } = await this.getSandbox(session_id);
    const content = await sandbox.files.read(path);

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
  }

}

export default ReadFileTool;
