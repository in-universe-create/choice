import fs from 'fs/promises';
import path from 'path';

const STORIES_DIR = path.join(process.cwd(), 'data', 'stories');
const MANIFEST_KEY = 'story:manifest';

function normalizeStory(raw) {
  if (raw?.stories) return raw.stories[0] || null;
  return raw;
}

function storyMeta(story) {
  return {
    id: story.id,
    name: story.name || story.id,
    description: story.description || '',
    accessCodes: story.accessCodes || [],
  };
}

async function ensureDir() {
  await fs.mkdir(STORIES_DIR, { recursive: true });
}

async function getKv() {
  if (!process.env.KV_REST_API_URL) return null;
  const { kv } = await import('@vercel/kv');
  return kv;
}

export async function listStories() {
  const kv = await getKv();
  if (kv) {
    const manifest = await kv.get(MANIFEST_KEY);
    if (Array.isArray(manifest) && manifest.length) return manifest;
    return [];
  }
  await ensureDir();
  const files = (await fs.readdir(STORIES_DIR)).filter(f => f.endsWith('.json')).sort();
  const stories = [];
  for (const file of files) {
    try {
      const story = JSON.parse(await fs.readFile(path.join(STORIES_DIR, file), 'utf8'));
      if (story?.id) stories.push(storyMeta(story));
    } catch {}
  }
  return stories;
}

export async function loadStory(storyId) {
  if (!storyId) return null;
  const kv = await getKv();
  if (kv) return (await kv.get(`story:${storyId}`)) || null;
  await ensureDir();
  try {
    return JSON.parse(await fs.readFile(path.join(STORIES_DIR, `${storyId}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function saveStory(story) {
  if (!story?.id) throw new Error('story.id is required');
  const kv = await getKv();
  if (kv) {
    await kv.set(`story:${story.id}`, story);
    const current = Array.isArray(await kv.get(MANIFEST_KEY)) ? await kv.get(MANIFEST_KEY) : [];
    const next = [...current.filter(s => s.id !== story.id), storyMeta(story)];
    await kv.set(MANIFEST_KEY, next);
    return;
  }
  await ensureDir();
  await fs.writeFile(path.join(STORIES_DIR, `${story.id}.json`), JSON.stringify(story, null, 2), 'utf8');
}

export async function deleteStory(storyId) {
  const kv = await getKv();
  if (kv) {
    await kv.del(`story:${storyId}`);
    const current = Array.isArray(await kv.get(MANIFEST_KEY)) ? await kv.get(MANIFEST_KEY) : [];
    await kv.set(MANIFEST_KEY, current.filter(s => s.id !== storyId));
    return;
  }
  await ensureDir();
  try { await fs.unlink(path.join(STORIES_DIR, `${storyId}.json`)); } catch {}
}

export async function getStoryBook() {
  const stories = await listStories();
  return { stories, activeStoryId: stories[0]?.id || null };
}

// Backward-compatible aliases for older imports.
export async function loadStoryBook() { return getStoryBook(); }
export async function saveStoryBook(book) {
  for (const story of book?.stories || []) await saveStory(story);
}
export function getStory(book, storyId) {
  return (book?.stories || []).find(s => s.id === storyId) || book?.stories?.[0] || null;
}
