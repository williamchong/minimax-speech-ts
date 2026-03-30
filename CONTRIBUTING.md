# Contributing

Thanks for your interest in contributing to minimax-speech-ts!

## Setup

```bash
git clone https://github.com/williamchong/minimax-speech-ts.git
cd minimax-speech-ts
npm ci
```

## Development

```bash
npm run lint         # ESLint with typescript-eslint (strict mode)
npm run build        # Build ESM + CJS + .d.ts via tsup
npm test             # Run all tests (vitest)
npm run test:watch   # Tests in watch mode
```

Always run the full check before submitting:

```bash
npm run lint && npm run build && npm test
```

## Pull Requests

- All tests must pass and lint must be clean
- Follow existing code patterns and conventions
- Add tests for new functionality
- Keep changes focused — one concern per PR

## Reporting Issues

Open an issue at [github.com/williamchong/minimax-speech-ts/issues](https://github.com/williamchong/minimax-speech-ts/issues).
