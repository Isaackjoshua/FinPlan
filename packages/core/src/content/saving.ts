import type { Lesson } from './types';

export const savingLessons: Lesson[] = [
  {
    slug: 'emergency-fund',
    title: 'Building an emergency fund',
    topic: 'saving',
    difficulty: 1,
    minutes: 4,
    tags: ['emergency-fund', 'saving', 'getting-started'],
    summary: 'Money set aside for the unexpected is what stops a bad month from becoming a debt. How much, where, and how to start.',
    objectives: ['Explain what an emergency fund is for', 'Work out a target from essential expenses', 'Plan how long it takes to reach it'],
    body: [
      { type: 'text', text: 'An emergency fund is money kept for things you cannot plan: a lost job, a medical bill, an urgent repair. Without it, each surprise is paid for by borrowing, often at a high rate.' },
      { type: 'heading', text: 'How much' },
      { type: 'text', text: 'A common target is three to six months of essential expenses. Essentials only: housing, food, transport, utilities, minimum debt payments. If your income is irregular or others depend on you, aim for the higher end.' },
      { type: 'example', title: 'Essentials of 40,000 a month', lines: [
        'A three-month fund is 120,000.',
        'Starting with 30,000 and adding 10,000 a month, the gap of 90,000 closes in 9 months.',
      ] },
      { type: 'heading', text: 'Start small' },
      { type: 'text', text: 'Three months can look out of reach. Aim for one week of expenses first, then one month. Even a small fund turns most emergencies from a crisis into an inconvenience.' },
      { type: 'heading', text: 'Where to keep it' },
      { type: 'text', text: 'Somewhere safe that you can reach within a day or two, and separate from your everyday spending money so it is not spent by accident. Earning interest on it is a bonus, not the point: this money is for safety.' },
      { type: 'text', text: 'If you also have expensive debt, a sensible order is to build a small starter fund first, then attack the debt, then finish the fund. Otherwise the next surprise goes straight back on the debt.' },
      { type: 'takeaway', text: 'Keep three to six months of essentials somewhere safe and separate. Start with whatever you can and build from there.' },
    ],
    quiz: [
      { prompt: 'What should an emergency fund target be based on?', options: ['Your total income', 'Your essential monthly expenses', 'Your total debt', 'What your friends save'], correctIndex: 1, explanation: 'The fund is there to cover what you must pay if income stops, so it is sized from essentials.' },
      { prompt: 'Essentials are 25,000 a month. What is a three-month target?', options: ['25,000', '50,000', '75,000', '150,000'], correctIndex: 2, explanation: '25,000 times 3 is 75,000.' },
      { prompt: 'What matters most about where the fund is kept?', options: ['It earns the highest possible return', 'It is safe and can be reached quickly', 'It is locked away for years', 'It is in cash at home'], correctIndex: 1, explanation: 'The fund exists for safety. It has to be there, and reachable, on the day you need it.' },
    ],
  },
  {
    slug: 'compound-growth',
    title: 'How savings grow: compounding and time',
    topic: 'saving',
    difficulty: 2,
    minutes: 5,
    tags: ['saving', 'goals'],
    summary: 'Interest earned on interest is slow at first and powerful later. Why starting early matters more than starting big.',
    objectives: ['Explain compound growth', 'See how time changes the result', 'Read a projection as an illustration, not a promise'],
    body: [
      { type: 'text', text: 'When savings earn interest and you leave it in, the next round of interest is paid on a slightly larger amount. This is compounding: the same effect that makes debt grow, working for you.' },
      { type: 'example', title: 'Saving 5,000 a month', lines: [
        'After 10 years you have put in 600,000. At 8% a year it has grown to about 915,000.',
        'After 20 years you have put in 1,200,000. At 8% a year it has grown to about 2,945,000.',
        'Twice the time, twice the deposits, but more than three times the balance.',
      ] },
      { type: 'text', text: 'In the first ten years, growth added about 315,000. In the second ten, it added about 1,430,000 on top of the new deposits. Nothing changed except the time the money had been there.' },
      { type: 'heading', text: 'What this means for you' },
      { type: 'list', items: [
        'Time does more of the work than the amount. Starting small now usually beats starting larger later.',
        'Leaving the interest in is what makes it compound. Taking it out resets the effect.',
        'Rising prices reduce what a balance will buy. Money earning less than prices are rising is losing buying power.',
      ] },
      { type: 'heading', text: 'A caution about projections' },
      { type: 'text', text: 'The 8% here is only an example. Real rates change, some savings products carry fees or tax, and anything offering a high return carries a risk of loss. A projection shows how the arithmetic works. It is not a prediction, and this lesson does not recommend any product.' },
      { type: 'takeaway', text: 'Compounding rewards time above all. Start early, add regularly, and leave the growth in.' },
    ],
    quiz: [
      { prompt: 'What is compound growth?', options: ['Interest paid only on what you deposited', 'Interest earned on earlier interest as well as on deposits', 'A fee charged by banks', 'A guaranteed return'], correctIndex: 1, explanation: 'Each round of interest is added to the balance, so the next round is calculated on more.' },
      { prompt: 'In the example, doubling the time from 10 to 20 years did what to the balance?', options: ['Doubled it', 'More than tripled it', 'Left it unchanged', 'Halved it'], correctIndex: 1, explanation: 'About 915,000 became about 2,945,000, because the earlier money had far longer to compound.' },
      { prompt: 'How should you treat a savings projection?', options: ['As a promise', 'As an illustration that depends on its assumptions', 'As advice to buy a product', 'As a minimum you will receive'], correctIndex: 1, explanation: 'Rates, fees and tax vary. A projection shows the arithmetic under stated assumptions and nothing more.' },
    ],
  },
];
