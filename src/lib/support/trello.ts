import type { BugAttachment } from "@/types";
import type { TrelloEnv } from "./config";

const API = "https://api.trello.com/1";

function auth(env: TrelloEnv): string {
  return `key=${encodeURIComponent(env.key)}&token=${encodeURIComponent(env.token)}`;
}

async function fail(res: Response, label: string): Promise<never> {
  const detail = await res.text().catch(() => "");
  throw new Error(`Trello ${label} failed (${res.status}): ${detail.slice(0, 200)}`);
}

export async function createCard(args: {
  env: TrelloEnv;
  listId: string;
  name: string;
  desc: string;
}): Promise<{ id: string; url: string }> {
  const { env, listId, name, desc } = args;

  const res = await fetch(`${API}/cards?${auth(env)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idList: listId, name, desc, pos: "top" }),
  });
  if (!res.ok) await fail(res, "createCard");

  const card = (await res.json()) as { id: string; shortUrl: string };
  return { id: card.id, url: card.shortUrl };
}

export async function attachFile(args: {
  env: TrelloEnv;
  cardId: string;
  file: File;
}): Promise<BugAttachment> {
  const { env, cardId, file } = args;

  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`${API}/cards/${cardId}/attachments?${auth(env)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) await fail(res, "attachFile");

  const att = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string | null;
    bytes: number | null;
  };
  return {
    id: att.id,
    name: att.name,
    mime: att.mimeType ?? file.type,
    bytes: att.bytes ?? file.size,
  };
}

export async function fetchCard(args: {
  env: TrelloEnv;
  cardId: string;
}): Promise<{ idList: string; url: string }> {
  const { env, cardId } = args;

  const res = await fetch(`${API}/cards/${cardId}?fields=idList,shortUrl&${auth(env)}`);
  if (!res.ok) await fail(res, "fetchCard");

  const card = (await res.json()) as { idList: string; shortUrl: string };
  return { idList: card.idList, url: card.shortUrl };
}

/**
 * Attachment downloads are the one Trello endpoint that will NOT accept
 * key/token as query parameters — it returns 401 unless the credentials are
 * in an OAuth Authorization header. Do not "simplify" this to `auth(env)`.
 */
export async function downloadAttachment(args: {
  env: TrelloEnv;
  cardId: string;
  attachmentId: string;
  fileName: string;
}): Promise<{ body: ArrayBuffer; contentType: string }> {
  const { env, cardId, attachmentId, fileName } = args;

  const res = await fetch(
    `${API}/cards/${cardId}/attachments/${attachmentId}/download/${encodeURIComponent(fileName)}`,
    {
      headers: {
        Authorization: `OAuth oauth_consumer_key="${env.key}", oauth_token="${env.token}"`,
      },
    }
  );
  if (!res.ok) await fail(res, "downloadAttachment");

  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
