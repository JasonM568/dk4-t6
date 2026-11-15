import { z } from "zod";

/** Serialized into the existing Text body column. Unmarked text is legacy content. */
export const BODY_FORMAT = "huibang-edm" as const;

const url = z.string().url().refine((value) => /^https?:\/\//i.test(value));
const inlineSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  href: url.optional(),
}).strict();
const imageSchema = z.object({
  url,
  alt: z.string().max(500),
  caption: z.string().max(500).optional(),
  width: z.union([z.literal(100), z.literal(75), z.literal(50)]),
  align: z.enum(["left", "center", "right"]),
}).strict();

export const bodyContentSchema = z.object({
  format: z.literal(BODY_FORMAT),
  version: z.literal(1),
  blocks: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), content: z.array(inlineSchema) }).strict(),
    z.object({ type: z.literal("heading"), content: z.array(inlineSchema) }).strict(),
    z.object({ type: z.literal("divider") }).strict(),
    z.object({ type: z.literal("button"), label: z.string(), url }).strict(),
    z.object({ type: z.literal("images"), columns: z.union([z.literal(1), z.literal(2)]), images: z.array(imageSchema).min(1).max(2) }).strict()
      .refine((block) => block.images.length === block.columns, "Image count must match columns"),
  ])).max(500),
}).strict();

export type BodyContent = z.infer<typeof bodyContentSchema>;
export type BodyBlock = BodyContent["blocks"][number];
export type BodyImage = Extract<BodyBlock, { type: "images" }>["images"][number];

/** A divider or an empty editor paragraph cannot be sent as an email body. */
export function hasMeaningfulBodyContent(content: BodyContent): boolean {
  return content.blocks.some((block) => {
    if (block.type === "paragraph" || block.type === "heading") {
      return block.content.some((run) => run.text.trim().length > 0);
    }
    if (block.type === "button") return block.label.trim().length > 0;
    if (block.type === "images") return block.images.length === block.columns;
    return false;
  });
}

export type ReadBodyContent =
  | { kind: "legacy"; text: string }
  | { kind: "structured"; content: BodyContent }
  | { kind: "invalid"; error: string };

/** Never silently show a broken or future EDM envelope as prose. */
export function readBodyContent(body: string): ReadBodyContent {
  if (!body.trimStart().startsWith("{")) return { kind: "legacy", text: body };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.includes(`"format":"${BODY_FORMAT}"`) || body.includes(`"format": "${BODY_FORMAT}"`)
      ? { kind: "invalid", error: "EDM JSON 格式不正確" }
      : { kind: "legacy", text: body };
  }
  if (!parsed || typeof parsed !== "object" || !("format" in parsed) || (parsed as { format?: unknown }).format !== BODY_FORMAT) {
    return { kind: "legacy", text: body };
  }
  const result = bodyContentSchema.safeParse(parsed);
  return result.success
    ? { kind: "structured", content: result.data }
    : { kind: "invalid", error: "EDM 內容版本或欄位不受支援" };
}

export function serializeBodyContent(content: BodyContent): string {
  return JSON.stringify(bodyContentSchema.parse(content));
}
