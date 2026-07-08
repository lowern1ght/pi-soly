# Temporary Files Rule

> **OS-aware temp paths.** Never hardcode `/tmp` — it's wrong on Windows
> (`%TEMP%` resolves to `C:\Users\<user>\AppData\Local\Temp`, not `/tmp`),
> wrong on macOS (`$TMPDIR` is per-user, e.g. `/var/folders/xx/yy/T/`),
> and fragile in multi-tenant / CI scenarios. Always resolve the
> OS-correct temp dir at runtime and put files under a project-scoped
> subfolder.

## The rule

When creating temporary files — intermediate build artifacts, scratch
data, debug dumps, test fixtures, atomic-write staging, anything that
isn't meant to outlive the process:

1. **Resolve the OS temp dir at runtime.** Never hardcode `/tmp`,
   `/var/folders`, `C:\Temp`, `~/tmp`, or any other literal path.
2. **Use a project-scoped subfolder** like `<tempdir>/<project>-<hash>/`
   so multiple projects don't collide and cleanup is easy.
3. **Clean up after yourself** — when the work is done, remove the
   directory (or use `try`/`finally` / `trap EXIT` / `defer`).
4. **Prefer atomic-write patterns** for files that will be renamed into
   place: write to a temp file in the **same directory** as the target,
   `fsync` if durability matters, then rename. Avoids half-written
   files on crash and avoids cross-device rename failures.

## How to get the temp dir per runtime

| Runtime       | API                          | Notes                              |
|---------------|------------------------------|------------------------------------|
| Node.js / Bun | `os.tmpdir()`                | already OS-aware; returns absolute |
| Python        | `tempfile.gettempdir()`      | stdlib                             |
| Go            | `os.TempDir()`               | stdlib                             |
| Rust          | `std::env::temp_dir()`       | stdlib; returns `PathBuf`          |
| .NET          | `Path.GetTempPath()`         | returns trailing slash              |
| Java          | `System.getProperty("java.io.tmpdir")` | JVM-resolved            |
| Bash (POSIX)  | `${TMPDIR:-/tmp}`            | fallback only if env unset          |
| PowerShell    | `$env:TEMP`                  | Windows                            |
| cmd.exe       | `%TEMP%`                     | Windows                            |

**Do not** `cd /tmp && touch foo`. Use the API for the runtime you're in.

## Why this matters

- **Windows**: `C:\Temp` may not exist or be writable; the real temp is
  `C:\Users\<user>\AppData\Local\Temp`. Hardcoding `/tmp` either fails
  outright or pollutes the wrong location.
- **macOS**: `$TMPDIR` is per-user and changes per reboot. `/tmp` is a
  shared system directory, not appropriate for app scratch data.
- **Linux / multi-user**: `/tmp` is shared across users on the host.
  Mixing files across users is a data-leak / collision risk.
- **CI/CD**: runners typically wipe `/tmp` between jobs but leave the
  per-user temp dir intact, so using the right dir keeps artifacts
  available for inspection post-run.
- **Sandboxing**: macOS sandbox and certain Linux sandboxes redirect
  `/tmp` to a per-process private dir. The runtime API follows these
  redirects; hardcoded `/tmp` does not.

## Examples

### Node.js / Bun

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const projectId = "pi-soly"; // or hash(repoUrl) for uniqueness
const scratchDir = path.join(os.tmpdir(), `${projectId}-${process.pid}`);
fs.mkdirSync(scratchDir, { recursive: true });

try {
  // ... use scratchDir for intermediate files ...
} finally {
  fs.rmSync(scratchDir, { recursive: true, force: true });
}
```

For atomic writes to a target file:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function atomicWrite(target: string, data: string | Uint8Array): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  const fh = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fh, data);
    fs.fsyncSync(fh);
  } finally {
    fs.closeSync(fh);
  }
  fs.renameSync(tmp, target); // atomic on same filesystem
}
```

### Python

```python
import shutil
import tempfile

scratch = tempfile.mkdtemp(prefix="myproject-")
try:
    # ... use scratch ...
    pass
finally:
    shutil.rmtree(scratch, ignore_errors=True)

# Atomic write:
import os
def atomic_write(path: str, data: bytes) -> None:
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
```

### Bash (POSIX: Linux / macOS)

```bash
SCRATCH="${TMPDIR:-/tmp}/myproject-$$"
mkdir -p "$SCRATCH"
trap 'rm -rf "$SCRATCH"' EXIT
# ... work in "$SCRATCH" ...
```

### PowerShell (Windows)

```powershell
$scratch = Join-Path $env:TEMP "myproject-$PID"
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
try {
    # ... work in $scratch ...
} finally {
    Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
```

## Forbidden patterns

```ts
// ❌ Hardcoded path — breaks on Windows, breaks sandboxing
const dir = "/tmp/myapp";
const dir = "C:\\Temp\\myapp";
const dir = path.join("/tmp", "myapp");

// ❌ mkdir without cleanup — leaks across runs
fs.mkdirSync("/tmp/myapp", { recursive: true });
// ... no rmSync ...

// ❌ Atomic write to /tmp when target is elsewhere — cross-device rename fails
const tmp = `/tmp/${path.basename(target)}`;
fs.writeFileSync(tmp, data);
fs.renameSync(tmp, target); // EXDEV on different filesystems

// ✓ Correct: resolve temp dir at runtime, project-scoped, cleaned up
const dir = path.join(os.tmpdir(), `${projectId}-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });
try { /* work */ } finally { fs.rmSync(dir, { recursive: true, force: true }); }
```

## Override

This rule is **built-in to the soly extension** and ships with every
install. It has highest priority and cannot be overridden by user rules.
If you need a different convention, name your rule differently
(e.g., `temp-files-windows-only.md` so the paths don't collide).