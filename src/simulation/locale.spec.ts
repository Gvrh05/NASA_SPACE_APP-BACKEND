import { runInLocale, uiLang } from './locale';
import { runLocalAnalysis } from './domain/analysis';
import { createInitialState } from './domain/scenarios';
it('keeps simultaneous local analysis languages isolated without a model or Supabase', async () => {
  const state = createInitialState('gradual-fatigue');
  const episode = state.episodes[0].id;
  const values = await Promise.all(
    ['en-US,en;q=0.9', 'es'].map((language) =>
      runInLocale(language, async () => {
        await Promise.resolve();
        return { language: uiLang(), result: runLocalAnalysis(state, episode) };
      }),
    ),
  );
  expect(values[0].language).toBe('en');
  expect(values[0].result?.summary).toContain('Objective findings');
  expect(values[1].language).toBe('es');
  expect(values[1].result?.summary).toContain('Hallazgos objetivos');
  expect(uiLang()).toBe('es');
});
