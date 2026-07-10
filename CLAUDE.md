# Project Operational Rules & Custom Skills

## 🔄 Autonomous Execution Loop
- You are operating in a fully pre-approved, non-interactive environment.
- Execute multi-step tasks sequentially and autonomously. Do not stall or stop the loop to ask for intermediate confirmations for file mutations or terminal scripts.
- Make reasonable development assumptions based on existing patterns in the codebase and move forward until the goal is achieved and fully verified.

## 🗺️ Codebase Ingestion & Structural Mapping
- Before tackling broad architectural edits, complex refactors, or multi-file features, run `npx repomix --compress` in the terminal root.
- Read the generated `repomix-output.xml` file to ingest a complete structural map of the system's dependencies and types in a single step.
- Do not make dozens of individual file discovery reads if a structural layout is readily available.

## 📉 Token-Saving Protocol (Strict)
- **No Code Echoing:** Do not reprint, replicate, or explain line-by-line the code blocks inside the chat window that you are already writing directly into workspace files. Chat responses must only consist of high-level bullet points summarizing the changes made.
- **Differential Edits Only:** Read and modify only the precise lines, blocks, or methods required. Never request or output massive files to alter minor segments.
- **Truncated Error Parsing:** If a terminal compiler, linter, or test suite fails, isolate and parse only the relevant error stack trace. Truncate passing logs to preserve context window longevity.

## 🛠️ The 4-Phase Core Engineering Loop

1. EXPLORE: Scan the root configurations (e.g., `package.json`, structural files) to verify package managers (`pnpm`, `npm`, `yarn`) and tooling engines. 
2. PLAN: Outline the explicit target file paths and architecture adjustments before coding. Do not write implementation code during this phase.
3. IMPLEMENT: Apply modifications directly to the codebase. Ensure formatting and linting rules match adjacent files.
4. VERIFY: You must validate all work before stopping. Run the project's native build, typecheck, or test scripts. Fix any immediate regressions automatically without prompting the user.