import { NextResponse } from 'next/server';
import { getStoryBook, loadStory, saveStory, deleteStory } from '@/lib/storage';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('storyId');
  if (id) {
    const story = await loadStory(id);
    if (!story) return NextResponse.json({ error: '스토리를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json(story);
  }
  return NextResponse.json(await getStoryBook());
}

export async function POST(request) {
  const body = await request.json();
  const story = body?.story || body;
  await saveStory(story);
  return NextResponse.json({ ok: true, storyId: story.id });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('storyId');
  if (!id) return NextResponse.json({ error: 'storyId가 필요합니다.' }, { status: 400 });
  await deleteStory(id);
  return NextResponse.json({ ok: true });
}
