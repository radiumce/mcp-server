import { z } from "zod";
import ToolHandler, { SandboxProvider } from "../tool-handler.js";
import path from "path";
import fs from "fs/promises";

const uploadFileSchema = z.object({
  local_path: z.string().describe("Absolute path to the local file"),
  sandbox_path: z.string().optional().nullable().describe("Target path with filename inside the sandbox"),
  overwrite: z.boolean().optional().default(true).describe("Overwrite existing file"),
  session_id: z.string().optional()
});

class UploadFileTool extends ToolHandler {
  name = "upload_file";
  description = "Upload a local file to the remote sandbox (only from allowed paths)";
  inputSchema = uploadFileSchema;

  async execute(args: any): Promise<any> {
    let { local_path, sandbox_path, overwrite, session_id } = args;

    // Convert "null" and "\"\"" to actual null or ""
    if (sandbox_path === "null") {
      sandbox_path = null;
    } else if (sandbox_path === "\"\"") {
      sandbox_path = "";
    }

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
    const fileContent = await fs.readFile(normalizedPath);

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

    // 写入文件
    await sandbox.files.write(sandbox_path, fileContent);

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
  }

}

export default UploadFileTool;
