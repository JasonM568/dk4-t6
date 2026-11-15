"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import { Node, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { BodyBlock, BodyContent, BodyImage } from "@/lib/email/body-content";
import { BODY_FORMAT } from "@/lib/email/body-content";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;
type UploadResult = { ok: true; url: string } | { ok: false; error: string };
type UploadFile = { id: string; file: File; preview: string; status: "queued" | "uploading" | "done" | "failed"; error?: string };
type ImageSlot = BodyImage & { uploadId?: string };
export type EdmEditorHandle = {
  insertVariable: (token: string) => void;
  toggleBold: () => void;
  insertHeading: () => void;
  insertDivider: () => void;
  insertButton: (label?: string, url?: string) => void;
  insertFiles: (files: File[]) => void;
};

type Props = { initial: BodyContent; onChange: (content: BodyContent, ready: boolean) => void; upload: (file: File) => Promise<UploadResult> };

function ImageControls({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const images = (node.attrs.images ?? []) as ImageSlot[];
  const columns = node.attrs.columns as 1 | 2;
  const update = (index: number, patch: Partial<ImageSlot>) => {
    updateAttributes({ images: images.map((image, i) => i === index ? { ...image, ...patch } : image) });
  };
  const remove = (index: number) => {
    if (images.length === 1) deleteNode();
    else updateAttributes({ images: images.filter((_, i) => i !== index), columns: 1 });
  };
  return <NodeViewWrapper className="my-3 rounded-lg border border-gray-200 bg-white p-3" contentEditable={false}>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500">
      <span>{columns === 2 ? "雙欄圖片" : "單欄圖片"}</span>
      <div className="flex gap-1">
        <button type="button" className="rounded border px-2 py-1 text-red-600" onClick={deleteNode}>移除整列</button>
      </div>
    </div>
    <div className={columns === 2 ? "grid grid-cols-2 gap-3" : "space-y-3"}>
      {images.map((image, index) => <div key={image.uploadId ?? image.url ?? index} className="min-w-0 rounded border border-gray-100 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- editor previews temporary blob URLs */}
        {image.url ? <img src={image.url} alt={image.alt} className="max-w-full rounded" style={{ width: `${image.width}%`, marginLeft: image.align === "left" ? 0 : "auto", marginRight: image.align === "right" ? 0 : "auto" }} /> : <div className="flex min-h-28 items-center justify-center rounded bg-gray-100 text-sm text-gray-500">圖片上傳中…</div>}
        <div className="mt-2 flex flex-wrap gap-1 text-xs">
          <select aria-label="圖片寬度" value={image.width} onChange={(e) => update(index, { width: Number(e.target.value) as 100 | 75 | 50 })} className="rounded border px-1 py-1">{[100, 75, 50].map((n) => <option key={n} value={n}>{n}%</option>)}</select>
          <select aria-label="圖片對齊" value={image.align} onChange={(e) => update(index, { align: e.target.value as BodyImage["align"] })} className="rounded border px-1 py-1"><option value="left">靠左</option><option value="center">置中</option><option value="right">靠右</option></select>
          <button type="button" className="rounded border px-2 py-1 text-red-600" onClick={() => remove(index)}>移除</button>
        </div>
        <input aria-label="圖片替代文字" value={image.alt} onChange={(e) => update(index, { alt: e.target.value })} placeholder="圖片說明（替代文字）" className="mt-2 w-full rounded border px-2 py-1 text-xs" />
        <input aria-label="圖片圖說" value={image.caption ?? ""} onChange={(e) => update(index, { caption: e.target.value })} placeholder="圖說（選填）" className="mt-1 w-full rounded border px-2 py-1 text-xs" />
      </div>)}
    </div>
  </NodeViewWrapper>;
}

const ImagesNode = Node.create({
  name: "edmImages", group: "block", atom: true, selectable: true,
  addAttributes() { return { columns: { default: 1 }, images: { default: [] } }; },
  parseHTML() { return [{ tag: "div[data-edm-images]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", { "data-edm-images": "", ...HTMLAttributes }]; },
  addNodeView() { return ReactNodeViewRenderer(ImageControls); },
});

function ButtonControls({ node, updateAttributes, deleteNode }: NodeViewProps) {
  return <NodeViewWrapper className="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2" contentEditable={false}>
    <span className="text-xs">CTA 按鈕</span>
    <input aria-label="按鈕文字" value={node.attrs.label} onChange={(e) => updateAttributes({ label: e.target.value })} className="rounded border px-2 py-1 text-sm" />
    <input aria-label="按鈕網址" value={node.attrs.url} onChange={(e) => updateAttributes({ url: e.target.value })} className="min-w-48 flex-1 rounded border px-2 py-1 text-sm" />
    <button type="button" onClick={deleteNode} className="text-xs text-red-600">移除</button>
  </NodeViewWrapper>;
}
const ButtonNode = Node.create({
  name: "edmButton", group: "block", atom: true,
  addAttributes() { return { label: { default: "立即報名" }, url: { default: "https://" } }; },
  parseHTML() { return [{ tag: "div[data-edm-button]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", { "data-edm-button": "", ...HTMLAttributes }]; },
  addNodeView() { return ReactNodeViewRenderer(ButtonControls); },
});
const VariableNode = Node.create({
  name: "edmVariable", group: "inline", inline: true, atom: true,
  addAttributes() { return { token: { default: "{name}" } }; },
  parseHTML() { return [{ tag: "span[data-edm-variable]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", { "data-edm-variable": "", class: "rounded bg-amber-100 px-1 text-amber-900", ...HTMLAttributes }, HTMLAttributes.token]; },
});

function toTiptap(content: BodyContent): JSONContent {
  const inline = (items: Extract<BodyBlock, { type: "paragraph" | "heading" }>["content"]): JSONContent[] => items.map((item) => ({ type: "text", text: item.text, marks: [...(item.bold ? [{ type: "bold" }] : []), ...(item.href ? [{ type: "link", attrs: { href: item.href } }] : [])] }));
  return { type: "doc", content: content.blocks.map((block): JSONContent => {
    if (block.type === "paragraph") return { type: "paragraph", content: inline(block.content) };
    if (block.type === "heading") return { type: "heading", attrs: { level: 2 }, content: inline(block.content) };
    if (block.type === "divider") return { type: "horizontalRule" };
    if (block.type === "button") return { type: "edmButton", attrs: { label: block.label, url: block.url } };
    return { type: "edmImages", attrs: { columns: block.columns, images: block.images } };
  }) };
}
function fromTiptap(doc: JSONContent): BodyContent {
  const inline = (nodes: JSONContent[] = []) => nodes.flatMap((n) => {
    const text = n.type === "edmVariable" ? String(n.attrs?.token ?? "") : n.text ?? "";
    if (!text) return [];
    const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
    return [{ text, ...(n.marks?.some((m) => m.type === "bold") ? { bold: true } : {}), ...(typeof href === "string" && /^https?:\/\//.test(href) ? { href } : {}) }];
  });
  const blocks: BodyBlock[] = (doc.content ?? []).flatMap((node): BodyBlock[] => {
    if (node.type === "paragraph") return [{ type: "paragraph", content: inline(node.content) }];
    if (node.type === "heading") return [{ type: "heading", content: inline(node.content) }];
    if (node.type === "horizontalRule") return [{ type: "divider" }];
    if (node.type === "edmButton") return [{ type: "button", label: String(node.attrs?.label ?? ""), url: String(node.attrs?.url ?? "") }];
    if (node.type === "edmImages") return [{ type: "images", columns: node.attrs?.columns === 2 ? 2 : 1, images: ((node.attrs?.images ?? []) as ImageSlot[]).filter((image) => !!image.url).map(({ url, alt, caption, width, align }) => ({ url, alt, ...(caption ? { caption } : {}), width, align })) }];
    return [];
  });
  return { format: BODY_FORMAT, version: 1, blocks };
}

export const EdmEditor = forwardRef<EdmEditorHandle, Props>(function EdmEditor({ initial, onChange, upload }, ref) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [columns, setColumns] = useState<1 | 2>(1);
  const filesRef = useRef<UploadFile[]>([]);
  const busyRef = useRef(0);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2] } }), ImagesNode, ButtonNode, VariableNode],
    content: toTiptap(initial), immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const active = new Set<string>();
      editor.state.doc.descendants((node) => { if (node.type.name === "edmImages") (node.attrs.images as ImageSlot[]).forEach((image) => { if (image.uploadId) active.add(image.uploadId); }); });
      onChange(fromTiptap(editor.getJSON()), filesRef.current.every((f) => !active.has(f.id) || f.status === "done"));
    },
  });
  const publish = useCallback((next: UploadFile[]) => {
    filesRef.current = next;
    setFiles(next);
    if (editor) {
      const active = new Set<string>();
      editor.state.doc.descendants((node) => { if (node.type.name === "edmImages") (node.attrs.images as ImageSlot[]).forEach((image) => { if (image.uploadId) active.add(image.uploadId); }); });
      onChange(fromTiptap(editor.getJSON()), next.every((f) => !active.has(f.id) || f.status === "done"));
    }
  }, [editor, onChange]);
  const pump = useCallback(() => {
    if (!editor) return;
    while (busyRef.current < 3) {
      const next = filesRef.current.find((f) => f.status === "queued");
      if (!next) break;
      busyRef.current++;
      publish(filesRef.current.map((f) => f.id === next.id ? { ...f, status: "uploading" } : f));
      void upload(next.file).then((result) => {
        if (result.ok) {
          const changes: { pos: number; images: ImageSlot[]; attrs: Record<string, unknown> }[] = [];
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name !== "edmImages") return;
            const images = (node.attrs.images as ImageSlot[]).map((image) => image.uploadId === next.id ? { ...image, url: result.url, uploadId: undefined } : image);
            if (images.some((image, i) => image.url !== (node.attrs.images as ImageSlot[])[i].url)) changes.push({ pos, images, attrs: node.attrs });
          });
          if (changes.length) editor.commands.command(({ tr }) => { changes.forEach(({ pos, images, attrs }) => tr.setNodeMarkup(pos, undefined, { ...attrs, images })); return true; });
          publish(filesRef.current.map((f) => f.id === next.id ? { ...f, status: "done" } : f));
          URL.revokeObjectURL(next.preview);
        } else publish(filesRef.current.map((f) => f.id === next.id ? { ...f, status: "failed", error: result.error } : f));
      }).catch((error) => publish(filesRef.current.map((f) => f.id === next.id ? { ...f, status: "failed", error: error instanceof Error ? error.message : "上傳失敗" } : f))).finally(() => { busyRef.current--; setFiles([...filesRef.current]); });
    }
  }, [editor, publish, upload]);
  useEffect(() => { pump(); }, [files, pump]);
  useEffect(() => () => { filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview)); }, []);
  const insertFiles = useCallback((selected: File[]) => {
    if (!editor || !selected.length) return;
    const accepted = selected.map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: (TYPES.includes(file.type) && file.size <= MAX_BYTES ? "queued" : "failed") as UploadFile["status"], error: !TYPES.includes(file.type) ? "格式不支援" : file.size > MAX_BYTES ? "圖片超過 5MB" : undefined }));
    publish([...filesRef.current, ...accepted]);
    const blocks: JSONContent[] = [];
    for (let i = 0; i < accepted.length; i += columns) {
      const pair = accepted.slice(i, i + columns);
      blocks.push({ type: "edmImages", attrs: { columns: pair.length as 1 | 2, images: pair.map((f) => ({ url: f.preview, alt: f.file.name, width: 100, align: "center", uploadId: f.id })) } });
    }
    editor.chain().focus().insertContent(blocks).run();
  }, [columns, editor, publish]);
  useImperativeHandle(ref, () => ({
    insertVariable: (token) => editor?.chain().focus().insertContent({ type: "edmVariable", attrs: { token } }).run(),
    toggleBold: () => editor?.chain().focus().toggleBold().run(),
    insertHeading: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    insertDivider: () => editor?.chain().focus().setHorizontalRule().run(),
    insertButton: (label = "立即報名", url = "https://") => editor?.chain().focus().insertContent({ type: "edmButton", attrs: { label, url } }).run(),
    insertFiles,
  }), [editor, insertFiles]);
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    const position = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (position) editor?.chain().focus().setTextSelection(position.pos).run();
    insertFiles(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData.files);
    if (!pasted.length) return;
    event.preventDefault();
    insertFiles(pasted);
  };
  return <div>
    <label className="mb-2 inline-flex items-center gap-2 text-xs text-gray-600">新圖片排列 <select value={columns} onChange={(e) => setColumns(Number(e.target.value) as 1 | 2)} className="rounded border px-2 py-1"><option value={1}>單欄</option><option value={2}>雙欄</option></select></label>
    <div onDrop={onDrop} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onPaste={onPaste} className="min-h-52 rounded-lg border border-gray-300 bg-white px-4 py-3 focus-within:border-black [&_.tiptap]:min-h-44 [&_.tiptap]:outline-none [&_.tiptap_h2]:my-3 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-bold [&_.tiptap_p]:my-2"><EditorContent editor={editor} /></div>
    {files.length > 0 && <div className="mt-2 space-y-1 text-xs" aria-live="polite">{files.map((file) => <div key={file.id} className="flex items-center gap-2"><span className="max-w-52 truncate">{file.file.name}</span><span>{({ queued: "排隊", uploading: "上傳中", done: "完成", failed: "失敗" } as const)[file.status]}{file.error ? `：${file.error}` : ""}</span>{file.status === "failed" && <button type="button" className="text-blue-700 underline" onClick={() => publish(filesRef.current.map((f) => f.id === file.id ? { ...f, status: "queued", error: undefined } : f))}>重試</button>}</div>)}</div>}
  </div>;
});
