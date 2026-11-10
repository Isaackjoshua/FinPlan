import { Empty, Flash, humanise, PageHeader } from '@/components/ui';
import { run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { dismissAssignment, getLessonStates, listItems, listLessons, profileWarnings, recommendLessons, summarise, TOPICS, type Lesson, type LessonState } from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'Lessons' };

async function dismiss(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/lessons', () => dismissAssignment(getCtx(), userId, str(form, 'slug')), 'Removed from your list. You can still read it below.');
}

const LEVELS = ['', 'Beginner', 'Intermediate', 'Advanced'];

function StatusBadge({ state }: { state?: LessonState }) {
  if (state?.status === 'completed') return <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-dark">Completed</span>;
  if (state?.status === 'started') return <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">In progress</span>;
  return null;
}

function LessonCard({ lesson, state, children }: { lesson: Lesson; state?: LessonState; children?: React.ReactNode }) {
  return (
    <li className="card">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/lessons/${lesson.slug}`} className="font-semibold hover:underline">{lesson.title}</Link>
        <StatusBadge state={state} />
      </div>
      <p className="mt-1 text-xs text-muted">{humanise(lesson.topic)} · {LEVELS[lesson.difficulty]} · {lesson.minutes} min</p>
      <p className="mt-2 text-sm">{lesson.summary}</p>
      {children}
    </li>
  );
}

export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; topic?: string; level?: string }> }) {
  const { userId } = await requireProfile();
  const ctx = getCtx();
  const params = await searchParams;
  const [states, items] = await Promise.all([getLessonStates(ctx, userId), listItems(ctx, userId)]);

  const all = listLessons();
  const assigned = all.filter((l) => states.get(l.slug)?.assignment?.status === 'assigned');
  const summary = summarise(items);
  const completed = new Set([...states].filter(([, s]) => s.status === 'completed').map(([slug]) => slug));
  const assignedSlugs = new Set(assigned.map((l) => l.slug));
  const recommended = recommendLessons(summary, profileWarnings(summary), completed).filter((l) => !assignedSlugs.has(l.slug));

  const topic = TOPICS.find((t) => t === params.topic);
  const level = [1, 2, 3].find((n) => String(n) === params.level) as 1 | 2 | 3 | undefined;
  const browse = listLessons({ topic, difficulty: level });
  const filterLink = (next: { topic?: string; level?: number }) => {
    const query = new URLSearchParams();
    const t = 'topic' in next ? next.topic : topic;
    const l = 'level' in next ? next.level : level;
    if (t) query.set('topic', t);
    if (l) query.set('level', String(l));
    return `/lessons${query.size ? `?${query}` : ''}#browse`;
  };
  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-sm ${active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:bg-paper'}`;

  return (
    <>
      <PageHeader title="Lessons">Short lessons with a quick quiz. Pass the quiz to complete a lesson. {completed.size} of {all.length} completed.</PageHeader>
      <Flash searchParams={searchParams} />

      {assigned.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Assigned to you</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {assigned.map((lesson) => {
              const assignment = states.get(lesson.slug)!.assignment!;
              return (
                <LessonCard key={lesson.slug} lesson={lesson} state={states.get(lesson.slug)}>
                  {/* The reason may be written by an agent: plain text only. */}
                  <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">
                    <span className="font-medium">{assignment.by === 'agent' ? 'Your agent' : 'You'} added this:</span>{' '}
                    <span className="whitespace-pre-wrap">{assignment.reason}</span>
                  </p>
                  <form action={dismiss} className="mt-2">
                    <input type="hidden" name="slug" value={lesson.slug} />
                    <button className="text-sm text-muted hover:underline">Not for me</button>
                  </form>
                </LessonCard>
              );
            })}
          </ul>
        </section>
      )}

      {recommended.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold">Suggested for your situation</h2>
          <p className="mb-3 text-sm text-muted">Chosen from what your profile shows right now.</p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {recommended.map((lesson) => <LessonCard key={lesson.slug} lesson={lesson} state={states.get(lesson.slug)} />)}
          </ul>
        </section>
      )}

      <section id="browse">
        <h2 className="mb-3 text-lg font-semibold">All lessons</h2>
        <div className="mb-2 flex flex-wrap gap-2">
          <Link href={filterLink({ topic: undefined })} className={chip(!topic)}>All topics</Link>
          {TOPICS.map((t) => <Link key={t} href={filterLink({ topic: t })} className={chip(topic === t)}>{humanise(t)}</Link>)}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={filterLink({ level: undefined })} className={chip(!level)}>All levels</Link>
          {[1, 2, 3].map((n) => <Link key={n} href={filterLink({ level: n })} className={chip(level === n)}>{LEVELS[n]}</Link>)}
        </div>
        {browse.length === 0 ? (
          <Empty>No lessons match those filters.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {browse.map((lesson) => <LessonCard key={lesson.slug} lesson={lesson} state={states.get(lesson.slug)} />)}
          </ul>
        )}
      </section>
    </>
  );
}
