# Contributing to AIConductor

Thank you for contributing to AIConductor! This guide explains how to develop features, run tests, and understand our CI/CD workflow.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/MohanTn/aiconductor.git
cd aiconductor

# Install dependencies
npm install

# Start development server
npm run dev
```

## CI/CD Workflow

All pull requests are automatically tested by our GitHub Actions CI workflow. The workflow enforces code quality through automated checks.

### Workflow Steps

The `.github/workflows/ci.yml` file defines our CI pipeline with the following stages:

1. **Setup (Node.js 18.x LTS)** - Initializes the CI environment with pinned Node.js version for consistency
2. **Install Dependencies** - Runs `npm ci` (clean install) to ensure reproducible builds
3. **Build** - Runs `npm run build` to compile TypeScript → JavaScript
4. **Lint** - Runs `npm run lint` to validate code style and catch security issues
5. **Test** - Runs `npm test -- --coverage` to execute all Jest tests with coverage tracking
6. **Coverage Report** - Displays coverage summary and uploads to Codecov for tracking

### Running CI Steps Locally

Before pushing your code, run the CI checks locally to catch issues early:

```bash
# Build TypeScript
npm run build

# Run linting
npm run lint

# Run tests with coverage
npm test -- --coverage

# Or run all in sequence
npm run build && npm run lint && npm test -- --coverage
```

## Understanding CI Failures

### Build Failures (`npm run build`)

**Error Message:** TypeScript compilation errors with file paths and line numbers

**Resolution:**
1. Read the error message carefully—it shows the exact file and line number
2. Open the file and fix the TypeScript error
3. Run `npm run build` again locally to verify the fix
4. Push the corrected code

**Common Issues:**
- Type mismatches (`Type 'X' is not assignable to type 'Y'`)
- Missing imports or exports
- Undefined variables or functions

### Linting Failures (`npm run lint`)

**Error Message:** ESLint violations with rule names and file locations

**Resolution:**
1. Read the rule name (e.g., `no-unused-vars`, `security/detect-object-injection`)
2. Open the file and fix the violation
3. Some violations can be auto-fixed: `npx eslint src --fix`
4. Run `npm run lint` to verify

**Common Issues:**
- Unused variables: remove them or prefix with `_` if intentional
- Security violations: avoid dynamic property access, use typed objects
- Import order: follow existing patterns in the codebase

### Test Failures (`npm test`)

**Error Message:** Test name, assertion details, and file path

**Resolution:**
1. Read the test output to understand what assertion failed
2. Locate the test file (path shown in output)
3. Run just that test: `npm test -- <test-file-name>`
4. Fix the code or test as appropriate
5. Run `npm test` to verify all tests pass

**Coverage Threshold:** Tests must maintain >70% code coverage. If your changes reduce coverage:
- Add unit tests for new code
- Increase test coverage for modified functions
- Run `npm test -- --coverage` to see coverage report

### Security Checks

Our linting includes security plugins that detect:
- Hardcoded secrets (API keys, passwords)
- Unsafe DOM manipulation
- Insecure randomness
- Unsafe object property access

**If you see security warnings:**
1. Never commit secrets—use environment variables or GitHub Secrets
2. Use type-safe property access instead of dynamic keys
3. Sanitize user input before using in templates

## Branch Protection Rules

The `main` branch is protected with the following rules:

- ✅ All CI checks (build, lint, test) must pass
- ✅ Pull request must be reviewed and approved
- ✅ Code review dismissal on new commits (keeps review current)
- ❌ Force push is prevented
- ❌ Deletion is prevented

**To merge a pull request:**
1. All CI checks must pass (green checkmarks)
2. At least one code review approval required
3. No merge conflicts
4. All conversations must be resolved

If a PR cannot merge, the "Merge" button will be disabled with a message explaining why.

## Node.js Version

This project pins Node.js to **18.x LTS** (Long-Term Support through April 2026). This ensures:
- Consistency across all development machines
- Reproducible builds in CI/CD
- Security patches are available for the entire LTS period

**To use the correct Node version:**
```bash
# Using nvm (recommended)
nvm install 18
nvm use 18

# Or specify manually
node --version  # Should show v18.x.x
```

## Security Best Practices

When contributing, follow these security guidelines:

### ❌ Never Commit Secrets
- API keys, tokens, passwords, connection strings
- Private keys or certificates
- Database credentials

### ✅ Use GitHub Secrets Instead
```yaml
# In workflow files, use:
env:
  API_KEY: ${{ secrets.API_KEY }}
```

### ❌ Avoid Logging Sensitive Data
- Don't log environment variables
- Don't log API responses containing tokens
- Don't log database queries with credentials

### ✅ Debug Without Exposing Secrets
```bash
# Good: Log the structure without sensitive values
console.log('Request:', { url, method, headers: 'redacted' });

# Bad: Logs everything including tokens
console.log('Request:', request);
```

### ✅ Validate Untrusted Input
- GitHub Actions runs on untrusted PR code
- Never execute user-provided code without validation
- Sanitize all external inputs before use

## Testing Guidelines

### Write Tests First (TDD)
1. Write a failing test that defines the expected behavior
2. Implement the code to make the test pass
3. Refactor if needed while keeping tests green

### Test Coverage
- Aim for >80% coverage on new code
- Test both happy path and error cases
- Include security-related tests (e.g., permission checks)

### Running Tests
```bash
# Run all tests
npm test

# Run tests matching a pattern
npm test -- feature.test.ts

# Run tests in watch mode (re-run on file changes)
npm test -- --watch

# Run with coverage report
npm test -- --coverage
```

## Code Review Checklist

Before submitting a PR, ensure:

- [ ] All CI checks pass locally (`npm run build && npm run lint && npm test`)
- [ ] Code follows existing patterns in the codebase
- [ ] Tests are included for new functionality
- [ ] No secrets or sensitive data are committed
- [ ] Documentation is updated if behavior changed
- [ ] Commit messages are clear and descriptive
- [ ] No TypeScript errors (`npx tsc --noEmit`)

## Questions?

If you encounter issues or have questions:

1. Check this guide first
2. Review the test output carefully for error messages
3. Look at similar code in the codebase for patterns
4. Open an issue with details about the problem

## Troubleshooting

### "My changes build locally but fail in CI"

**Common causes:**
- Different Node.js version: verify you're using 18.x
- Missing dependencies: run `npm ci` after updating package.json
- Cache issues: CI builds are fresh; try `rm -rf node_modules && npm ci`

### "I need to update a dependency"

1. Run `npm install <package>@<version>`
2. Verify the update doesn't break tests: `npm test`
3. Check for security vulnerabilities: `npm audit`
4. Commit package-lock.json along with package.json

### "I got a merge conflict"

1. Fetch the latest main: `git fetch origin main`
2. Rebase your branch: `git rebase origin/main`
3. Resolve conflicts in your editor
4. Test again: `npm test`
5. Force push your branch: `git push origin <branch-name> -f`

---

Thank you for contributing! Our CI/CD workflow ensures code quality and security for all contributors.
