# E2B MCP Server

This project is a modified version of [E2B MCP Server](https://github.com/e2b-dev/mcp-server), originally licensed under the Apache 2.0 License. It's based on the JavaScript edition of the MCP Server.

Original project: [https://github.com/e2b-dev/mcp-server](https://github.com/e2b-dev/mcp-server)

The E2B MCP server allows you to add [code interpreting capabilities](https://github.com/e2b-dev/code-interpreter) to your Claude Desktop app via the E2B Sandbox. See demo [here](https://x.com/mishushakov/status/1863286108433317958).

## Modifications

This modified version enhances the JavaScript MCP Server with the following tools:

*   **`write_file`:** Allows the server to write data to files within the E2B Sandbox.
*   **`read_file`:** Allows the server to read data from files within the E2B Sandbox.
*   **`upload_file`:** Allows the server to upload files to the E2B Sandbox.
*   **`download_file`:** Allows the server to download files from the E2B Sandbox to local system (only to allowed paths).
*   **`execute_command`:** Allows the server to execute shell commands within the E2B Sandbox.
*   **`run_code`:** Allows the server to run Python code in a secure remote sandbox using Jupyter Notebook syntax.

- [JavaScript](packages/js/README.md)

## License

This project is licensed under the Apache 2.0 License. See the LICENSE file for details.
