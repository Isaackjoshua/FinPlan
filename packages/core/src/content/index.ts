import { budgetingLessons } from './budgeting';
import { debtLessons } from './debt';
import { planningLessons } from './planning';
import { savingLessons } from './saving';
import type { Lesson } from './types';

export * from './types';

/** The full catalogue, in the order it is shown when browsing. */
export const LESSONS: readonly Lesson[] = [...budgetingLessons, ...debtLessons, ...savingLessons, ...planningLessons];
