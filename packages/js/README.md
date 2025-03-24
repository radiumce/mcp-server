# E2B MCP Server (JavaScript)

A Model Context Protocol server for running code in a secure sandbox by [E2B](https://e2b.dev).

## Development

Install dependencies:
```
npm install
```

Build the server:
```
npm run build
```

For development with auto-rebuild:
```
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "e2b-server": {
      "command": "node",
      "args": ["/your_path/mcp-server/packages/js/build/index.js"],
      "env": {
        "E2B_API_KEY": "${e2bApiKey}",
        "E2B_ALLOWED_UPLOAD_PATHS": "${your_local_paths}"
      }
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.
