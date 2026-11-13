// Every page is lazy-loaded by App.js; a broken import would only show up when
// a user opens that page. Load each one here so it fails in CI instead.
const pages = import.meta.glob(['./*.js', '!./*.test.js']);

describe('pages', () => {
  it('finds the pages', () => {
    expect(Object.keys(pages).length).toBeGreaterThan(20);
  });

  it.each(Object.keys(pages))('%s exports a component', async (path) => {
    const mod = await pages[path]();
    expect(typeof mod.default).toBe('function');
  }, 30000);
});
