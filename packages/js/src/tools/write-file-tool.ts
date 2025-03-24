import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";

const writeFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  session_id: z.string().optional()
});

class WriteFileTool extends ToolHandler {
  name = "write_file";
  description = "Write content to temporary remote sandbox filesystem (data cleared after session)";
  inputSchema = writeFileSchema;

  async execute(args: any): Promise<any> {
    const { path, content, session_id } = args;
    const { sandbox, sessionId } = await this.getSandbox(session_id);
    await sandbox.files.write(path, content);

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
  }

}

export default WriteFileTool;
