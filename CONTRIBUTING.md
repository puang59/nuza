# Contribute to nuza

First off, thank you for considering contributing to nuza! Whether it's squashing bugs, tweaking the UI, or adding cool new features to the editor, your help is highly appreciated.

To ensure a smooth process for everyone, please review the guidelines below before diving into the code.

## Getting Started

nuza is built with a modern stack consisting of React, TypeScript, Bun, and Rust (via Tauri).

**Setting up your local environment:**

1. Make sure you have `Node.js`, `Bun`, and `Rust` installed on your machine.
2. Clone the repo and boot up the development server:
   ```bash
   bun install
   bun run tauri dev
   ```

**Compiling the app:**
If you want to build the standalone executable for your operating system:

```bash
bun run tauri build
```

Once finished, you can find the compiled binaries in the `src-tauri/target/release` directory.

## Contribution Workflow

### 1. Discuss Before Coding (Issue-First)

We strongly believe in communication over blind commits. **Every Pull Request must be tied to an open issue.**

- If you spot a bug or have a feature idea, search the existing issues first.
- If it hasn't been reported, open a new issue.
- For significant changes, please wait for a maintainer's green light before spending hours on a massive PR.

### 2. Crafting your Pull Request

- **Keep it bite-sized:** Smaller PRs are reviewed faster and are much easier to merge.
- **Link your issue:** Always mention `Fixes #ISSUE_ID` in your PR description.
- **Avoid redundancy:** Ensure your proposed change isn't already handled somewhere else in the application.

### 3. Review Guidelines

- **Visual Changes:** If you tweaked the UI, please attach screenshots or a quick screen recording to your PR.
- **Behavioral Changes:** For bugs or logic adjustments, explicitly list out the steps you took to test and verify the fix so reviewers can reproduce it.
- **No AI Spam:** Please write your PR descriptions yourself. Excessively long, AI-generated essays are difficult to parse and slow down the review process. Keep it concise, direct, and human.

### 4. Commit Etiquette

Please use standard conventional commits for your PR titles so our git history remains clean:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation updates
- `chore:` for tooling, dependencies, etc.
- `refactor:` for code restructuring without behavioral changes

## Looking for something to do?

If you're eager to contribute but aren't sure where to start, take a look at issues tagged with `good first issue` or `help wanted`. Drop a comment saying you'd like to tackle it, and it's yours!
