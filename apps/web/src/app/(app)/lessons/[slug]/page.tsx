import { Flash, humanise } from '@/components/ui';
import { back, run } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { getLatestAttempt, getLessonStates, listLessons, startLesson, submitQuiz, type Block } from '@fin/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const find = (slug: string) => listLessons().find((l) => l.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: find((await params).slug)?.title ?? 'Lesson' };
}

async function answer(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  const lesson = find(String(form.get('slug')));
  if (!lesson) notFound();
  const path = `/lessons/${lesson.slug}`;
  const answers = lesson.quiz.map((_, i) => form.get(`q${i}`));
  if (answers.some((a) => a === null)) back(path, 'error', 'Answer every question before checking.');
  await run(`${path}?result=1`, async () => {
    await submitQuiz(getCtx(), userId, lesson.slug, answers.map(Number));
  });
}

function BodyBlock({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="mt-6 text-lg font-semibold">{block.text}</h2>;
    case 'text':
      return <p className="mt-3 leading-relaxed">{block.text}</p>;
    case 'list':
      return <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
    case 'example':
      return (
        <figure className="mt-4 rounded-lg border border-line bg-paper p-4">
          <figcaption className="text-sm font-semibold">{block.title}</figcaption>
          <ul className="num mt-2 space-y-1 text-sm">{block.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        </figure>
      );
    case 'takeaway':
      return <p className="mt-6 rounded-lg border-l-4 border-brand bg-brand/5 px-4 py-3 font-medium">{block.text}</p>;
  }
}

export default async function LessonPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; result?: string }> }) {
  const { userId } = await requireProfile();
  const lesson = find((await params).slug);
  if (!lesson) notFound();
  const ctx = getCtx();
  await startLesson(ctx, userId, lesson.slug);
  const showResult = (await searchParams).result === '1';
  const [states, attempt] = await Promise.all([getLessonStates(ctx, userId), showResult ? getLatestAttempt(ctx, userId, lesson.slug) : null]);
  const state = states.get(lesson.slug);

  return (
    <article className="mx-auto max-w-2xl">
      <p className="text-sm"><Link href="/lessons" className="link">← All lessons</Link></p>
      <header className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{humanise(lesson.topic)} · {lesson.minutes} min{state?.status === 'completed' && ' · Completed'}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{lesson.title}</h1>
        <p className="mt-2 text-muted">{lesson.summary}</p>
      </header>

      <section className="card mt-6">
        <p className="text-sm font-semibold">After this lesson you can</p>
        <ul className="mt-1 list-disc pl-5 text-sm">{lesson.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
      </section>

      <div className="mt-2">{lesson.body.map((block, i) => <BodyBlock key={i} block={block} />)}</div>

      <section id="quiz" className="card mt-10">
        <h2 className="text-lg font-semibold">Check your understanding</h2>
        <Flash searchParams={searchParams} />
        {attempt && (
          <p role="status" className={`mb-4 mt-2 rounded-lg px-4 py-3 text-sm font-medium ${attempt.passed ? 'bg-brand/10 text-brand-dark' : 'bg-warn/10 text-warn'}`}>
            {attempt.correct} of {attempt.total} correct. {attempt.passed ? 'Lesson completed.' : 'Read the explanations below and try again.'}
          </p>
        )}
        <form action={answer} className="mt-3 space-y-6">
          <input type="hidden" name="slug" value={lesson.slug} />
          {lesson.quiz.map((q, i) => {
            const chosen = attempt?.answers[i];
            return (
              <fieldset key={q.prompt}>
                <legend className="font-medium">{i + 1}. {q.prompt}</legend>
                <div className="mt-2 space-y-1.5">
                  {q.options.map((option, j) => (
                    <label key={option} className="flex items-start gap-2 text-sm">
                      <input type="radio" name={`q${i}`} value={j} required defaultChecked={chosen === j} className="mt-1" />
                      <span>
                        {option}
                        {attempt && j === q.correctIndex && <span className="ml-2 font-medium text-brand-dark">Correct answer</span>}
                        {attempt && chosen === j && j !== q.correctIndex && <span className="ml-2 font-medium text-danger">Your answer</span>}
                      </span>
                    </label>
                  ))}
                </div>
                {attempt && <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm">{q.explanation}</p>}
              </fieldset>
            );
          })}
          <button className="btn">{attempt ? 'Try again' : 'Check answers'}</button>
        </form>
      </section>
    </article>
  );
}
