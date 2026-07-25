<!-- cona:begin -->
## cona — token-efficient code navigation

**The rule, before you Read a code file or Grep:** this project is cona-indexed.
Default to `cona outline <file>` → `cona show <Sym>` to pull ONE symbol, not the
whole file. Reach for Read only with an explicit offset/limit, or on a file cona
doesn't index. For finding a name, `cona grep`/`refs` beat Grep (code-only, semantic).
If a repo isn't indexed yet, `cona index` (~1s) first — then the above applies.

Coarse → fine: `cona tree --rank` → `cona outline <file>` → `cona show <Sym>` → `cona edit <Sym>`.

### Commands

- `cona find <Name> [--kind fn] [--json]` — locate a symbol (file:start-end + signature)
- `cona show <Sym> [<Sym2> …] [--context 3] [--sig]` — print only those symbols' source (several names in one call); `--sig` = signature line only, the leanest peek; `<Sym>` = `Name`, `Parent.Name` or `file.rs:Name`
- `cona refs <Name>` — usage sites as file:line (semantic — string/comment mentions don't match)
- `cona tree --rank [--budget 2000]` — symbols ranked by reference fan-in — fastest orientation in an unknown codebase
- `cona grep <pattern> [-i]` — code-only substring search, hits labeled with their enclosing symbol
- `cona diff [ref]` — changed symbols vs a git ref (incl. uncommitted/untracked) — start code reviews here
- `cona context <Sym>` — one pack: symbol source + callee signatures + call sites (instead of show+refs+shows)
- `cona edit <Sym> --file new.txt` (or stdin) — replace symbol body, syntax-verified, rollback on error
- `cona edit <file> --range S-E` — replace just lines S-E of a file (patch without resending a whole symbol)
- `cona insert <Sym> --after|--before` (or `--at <file> <line>`) — add code without touching a body; `--at` works on a new/empty file; syntax re-verified
- `cona check [<file>]` — syntax-only parse diagnostics (not a compiler); no file = all changed vs HEAD — confirm a file still parses after editing without a full build
- `cona impact <Sym>` — blast radius before an edit: refs + callers + tests + recent history in one pack
- `cona entries` — entry points (mains, public API, tests) — first command in an unknown repo
- `cona deps [path]` — file-level import graph + most-imported + cycles — the architecture view
- `cona callers/callees <Sym> [--depth 2]`, `cona path <A> <B>` — transitive call trees and shortest call chain
- `cona tests <Sym>` — which tests exercise a symbol (loud when none do)
- `cona blame <Sym>` / `hot` / `coupling <file>` — symbol-level git history, churn hotspots, co-change coupling
- `cona shape <Sym>` — symbol source + referenced types expanded one level
- `cona note <Sym> <text…>` — persistent notes on symbols, auto-surfaced in show/context (`note` lists, `--rm <id>` deletes)
- `cona rename <Sym> <new>` — semantic project-wide rename, collision-guarded, syntax-verified, all-or-nothing
- `cona stats [--json]` — savings per project + global; `cona ui` — live dashboard.
- Index is incremental and auto-refreshes (git hooks / agent hooks); `cona index` if in doubt.
- NEVER read a whole file just to find one function — `outline`/`show` get you there for a fraction of the tokens.
<!-- cona:end -->
