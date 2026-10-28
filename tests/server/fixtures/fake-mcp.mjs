// A tiny MCP server for the tests: "look" only reads (and returns a picture), "send" says nothing about itself.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const server = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'look', description: 'Takes a picture', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'send', description: 'Sends a message', inputSchema: { type: 'object', properties: {} } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  req.params.name === 'look'
    ? { content: [{ type: 'text', text: 'a picture' }, { type: 'image', mimeType: 'image/png', data: PNG }] }
    : { content: [{ type: 'text', text: 'sent' }] },
);
await server.connect(new StdioServerTransport());
