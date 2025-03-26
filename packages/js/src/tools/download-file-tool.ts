import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";
import path from "path";
import fs from "fs/promises";

const downloadFileSchema = z.object({
  sandbox_path: z.string().describe("Path to file in sandbox"),
  local_path: z.string().describe("Absolute target path in allowed directories"),
  overwrite: z.boolean().optional().default(false).describe("Overwrite existing file"),
  session_id: z.string().optional()
});

class DownloadFileTool extends ToolHandler {
  name = "download_file";
  description = "Download a file from sandbox to local system (only to allowed paths)";
  inputSchema = downloadFileSchema;

  async execute(args: any): Promise<any> {
    const { sandbox_path, local_path, overwrite, session_id } = args;

    // Validate target path is in allowed directories
    const allowedPaths = process.env.E2B_ALLOWED_PATHS?.split(',') || [];
    if (allowedPaths.length === 0) {
      throw new Error("No allowed download paths configured. Set E2B_ALLOWED_PATHS environment variable.");
    }

    const normalizedPath = path.normalize(local_path);
    const isPathAllowed = allowedPaths.some(allowedPath => {
      const normalizedAllowedPath = path.normalize(allowedPath);
      return normalizedPath === normalizedAllowedPath ||
             normalizedPath.startsWith(normalizedAllowedPath + path.sep);
    });

    if (!isPathAllowed) {
      throw new Error(`Access denied: ${local_path} is not in allowed download paths`);
    }

    // Check if file exists and handle overwrite
    if (!overwrite) {
      try {
        await fs.access(normalizedPath);
        throw new Error(`File already exists at ${normalizedPath} and overwrite is set to false`);
      } catch (err) {
        // File doesn't exist - proceed
        if (!(err instanceof Error) || !err.message.includes("ENOENT")) {
          throw err;
        }
      }
    }

    const { sandbox, sessionId } = await this.getSandbox(session_id);
    const fileContent = await sandbox.files.read(sandbox_path, { format: 'bytes' });

    // Ensure directory exists
    await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
    await fs.writeFile(normalizedPath, fileContent);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "File downloaded successfully",
          sandbox_path,
          local_path: normalizedPath,
          session_id: sessionId
        }, null, 2)
      }]
    };
  }
}

export default DownloadFileTool;
