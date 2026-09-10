import type { ZodRawShape } from "zod";
import type { Confirmer } from "../elicit.js";
import type { MacClient } from "../mac/client.js";
import type { Capability, SecurityPolicy } from "../security.js";

export interface ToolContext {
  client: MacClient;
  policy: SecurityPolicy;
  /** Human-in-the-loop confirmation for destructive/high-impact ops (no-op fallback when the client can't elicit). */
  confirm: Confirmer;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  capability: Capability;
  /** Marks a mutating tool as destructive (irreversible / high-impact). Defaults to `capability === "admin"`. */
  destructive?: boolean;
  /** Overrides the idempotency hint. Defaults to `true` for read tools, `false` otherwise. */
  idempotent?: boolean;
  config: {
    title: string;
    description: string;
    inputSchema: Shape;
  };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(base64: string, mimeType = "image/png", caption?: string): ToolResult {
  const content: ContentBlock[] = [{ type: "image", data: base64, mimeType }];
  if (caption) content.unshift({ type: "text", text: caption });
  return { content };
}
