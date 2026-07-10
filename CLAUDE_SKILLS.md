# Custom Skill: Autonomous Execution Loop

You are authorized to work in "Pre-Approved Auto-Mode." Execute the given objective from start to finish without pausing for confirmation on files, terminal scripts, or git commands.

## 🔄 The 4-Phase Execution Pattern

1. CLARIFY & SCOPE: 
   - Analyze the target directories. 
   - Ask any vital clarifying questions *upfront in a single response* before taking action.
2. ARCHITECT & PLAN: 
   - List the exact file paths you plan to create, edit, or delete.
   - Do not print entire code blocks during the planning stage; only output the file structural blueprint.
3. INTERACTIVE EXECUTION: 
   - Write files, execute compilers/linters, and run test suites autonomously.
   - If a test fails, pivot and fix it automatically. Do not stall the loop to report intermediate failures unless you hit an insurmountable dead-end.
4. VERIFICATION & GIT: 
   - Run a final lint/build check. 
   - Stage changes, generate a concise commit message, and commit/push.

## 📉 Token-Saving Protocol (Strict)
To minimize token billing during long autonomous runs, adhere to these rules:
- NO CODE ECHOING: Do not print out code in the chat box that you are already writing directly to the workspace files. Chat output should strictly contain summaries of actions taken.
- DIFFERENTIAL EDITS ONLY: When updating code, only read or write the specific functions or lines needed. Never request or output entire large files just to modify a single line.
- COMPRESSED CLI FEEDBACK: If a test suite or compiler outputs long stack traces, truncate the middle noise and analyze only the specific failure lines.