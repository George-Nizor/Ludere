import { asLudereError, LudereMcpError } from './errors.mjs';
import { validateSchema } from './schema.mjs';
import { TOOL_CATALOG, TOOL_HANDLERS } from './tools.mjs';

export const LATEST_PROTOCOL_VERSION = '2025-11-25';
export const SUPPORTED_PROTOCOL_VERSIONS = [
  LATEST_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolResult(id, structuredContent, isError = false) {
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  });
}

function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

function requestId(message) {
  return message && validId(message.id) ? message.id : null;
}

function objectParams(message) {
  const params = message.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new LudereMcpError('INVALID_PARAMS', 'params must be an object.');
  }
  return params;
}

export class LudereMcpServer {
  constructor() {
    this.initialized = false;
    this.clientInitialized = false;
  }

  async handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return JSON.stringify(rpcError(null, -32700, 'Parse error', { message: error.message }));
    }
    const response = await this.handleMessage(message);
    return response ? JSON.stringify(response) : '';
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id = requestId(message);
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && !validId(message.id))) {
      return hasId ? rpcError(id, -32600, 'Invalid Request') : null;
    }

    if (!hasId) {
      if (message.method === 'notifications/initialized') this.clientInitialized = true;
      // JSON-RPC notifications, including cancellation and unknown notifications, never receive a response.
      return null;
    }

    try {
      if (message.method === 'initialize') {
        if (this.initialized) return rpcError(id, -32600, 'Server is already initialized.');
        const params = objectParams(message);
        if (typeof params.protocolVersion !== 'string') return rpcError(id, -32602, 'initialize.params.protocolVersion must be a string.');
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(params.protocolVersion)
          ? params.protocolVersion
          : LATEST_PROTOCOL_VERSION;
        this.initialized = true;
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ludere', title: 'Ludere screenplay projects', version: '0.2.0' },
          instructions: 'Ludere tools edit explicit absolute .ludere files locally. Writes are atomic, exports never replace their source project, and new destinations refuse overwrite unless overwrite=true. Browser localStorage autosave is intentionally not modified; portable files use the same validated document schema.',
        });
      }
      if (message.method === 'ping') return rpcResult(id, {});
      if (!this.initialized) return rpcError(id, -32002, 'Server is not initialized.');
      if (message.method === 'tools/list') {
        objectParams(message);
        return rpcResult(id, { tools: TOOL_CATALOG });
      }
      if (message.method === 'tools/call') {
        const params = objectParams(message);
        if (typeof params.name !== 'string') return rpcError(id, -32602, 'tools/call.params.name must be a string.');
        const tool = TOOL_HANDLERS.get(params.name);
        if (!tool) {
          return toolResult(id, {
            ok: false,
            tool: params.name,
            error: { code: 'UNKNOWN_TOOL', message: `Unknown Ludere tool: ${params.name}` },
          }, true);
        }
        const args = params.arguments ?? {};
        try {
          validateSchema(args, tool.inputSchema);
          const result = await tool.handler(args);
          return toolResult(id, { ok: true, tool: tool.name, ...result });
        } catch (error) {
          const normalized = asLudereError(error);
          return toolResult(id, {
            ok: false,
            tool: tool.name,
            error: {
              code: normalized.code,
              message: normalized.message,
              ...(normalized.details === undefined ? {} : { details: normalized.details }),
            },
          }, true);
        }
      }
      return rpcError(id, -32601, 'Method not found', { method: message.method });
    } catch (error) {
      const normalized = asLudereError(error, 'INVALID_PARAMS');
      return rpcError(id, -32602, normalized.message, normalized.details);
    }
  }
}
