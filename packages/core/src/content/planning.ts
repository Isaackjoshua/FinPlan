import type { Lesson } from './types';

export const planningLessons: Lesson[] = [
  {
    slug: 'setting-goals',
    title: 'Setting financial goals you can reach',
    topic: 'planning',
    difficulty: 1,
    minutes: 4,
    tags: ['goals', 'getting-started', 'saving'],
    summary: 'A goal with an amount and a date becomes a monthly number you can budget for. How to write one and what to do when goals compete.',
    objectives: ['Turn a wish into a goal with an amount and a date', 'Work out the monthly amount a goal needs', 'Put competing goals in order'],
    body: [
      { type: 'text', text: '"Save more" is a wish. "Save 120,000 for school fees by next January" is a goal. The difference is that the second one can be divided into a monthly amount and checked.' },
      { type: 'heading', text: 'Amount, date, monthly number' },
      { type: 'example', title: 'From a goal to a budget line', lines: [
        'Goal: 120,000 in 12 months.',
        '120,000 divided by 12 is 10,000 a month.',
        'If 10,000 does not fit your budget, change the date or the amount until the monthly number does.',
      ] },
      { type: 'text', text: 'That last step matters. A goal whose monthly amount you cannot afford will be dropped. A smaller or slower goal that fits will be reached.' },
      { type: 'heading', text: 'When goals compete' },
      { type: 'text', text: 'Most people have more goals than spare money. A common order that works for many situations:' },
      { type: 'list', items: [
        'A small starter emergency fund, so a surprise does not undo everything else.',
        'Expensive debt, because its interest usually costs more than savings earn.',
        'A full emergency fund.',
        'Everything else, in the order that matters to you.',
      ] },
      { type: 'text', text: 'You can work on more than one at a time. Just make sure each has its own monthly amount, and that the amounts together fit inside your budget.' },
      { type: 'heading', text: 'Review, do not abandon' },
      { type: 'text', text: 'Income changes, prices change, plans change. Check your goals every few months and adjust the numbers. A goal that has been revised is still a goal.' },
      { type: 'takeaway', text: 'Give every goal an amount, a date and a monthly number that fits your budget, then review it regularly.' },
    ],
    quiz: [
      { prompt: 'Which of these is a goal in the sense used here?', options: ['Be better with money', 'Save 60,000 for a deposit within 10 months', 'Spend less', 'Get rich'], correctIndex: 1, explanation: 'It has an amount and a date, so it can be turned into 6,000 a month and tracked.' },
      { prompt: 'A goal of 90,000 in 18 months needs how much a month?', options: ['3,000', '5,000', '9,000', '18,000'], correctIndex: 1, explanation: '90,000 divided by 18 is 5,000.' },
      { prompt: 'The monthly amount for your goal does not fit your budget. What does the lesson suggest?', options: ['Borrow the difference', 'Drop the goal', 'Change the date or the amount until it fits', 'Ignore the budget'], correctIndex: 2, explanation: 'A goal that fits your budget gets reached. Stretching the date or lowering the amount keeps it alive.' },
    ],
  },
];
