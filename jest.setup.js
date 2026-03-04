// Jest setup file - suppress console logs during tests
// Allow console.error and console.warn for actual errors

const originalLog = console.log;
const originalWarn = console.warn;

beforeAll(() => {
  // Suppress console.log during tests (too verbose)
  // Keep console.error and console.warn for actual issues
  console.log = jest.fn();
  console.warn = jest.fn();
});

afterAll(() => {
  // Restore original console methods
  console.log = originalLog;
  console.warn = originalWarn;
});
