// =============================================================================
// env.ts — Project environment summary for the soly extension
// =============================================================================
//
// Detects the project's runtime environment: package manager, node/bun
// version, key dependencies, and common services (postgres, redis, etc.).
// Used by the `soly_env` tool and injected into the system prompt as a
// short "## project env" section.
//
// All detection is best-effort. Missing files just skip their block.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

interface PackageJson {
	name?: string;
	version?: string;
	private?: boolean;
	type?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	engines?: Record<string, string>;
	packageManager?: string;
	workspaces?: string[] | { packages?: string[] };
}

export interface EnvSummary {
	projectName: string | null;
	projectVersion: string | null;
	runtimes: string[];
	packageManager: string | null;
	mainDependencies: string[]; // up to 8 most relevant
	scripts: string[]; // up to 6 most common
	services: string[];
	hasTypeScript: boolean;
	hasTests: boolean;
	hasDocker: boolean;
	hasCI: boolean;
}

/** Heuristic: which top-level deps look "main" rather than "peripheral". */
const MAIN_DEP_HINTS = [
	"react", "vue", "svelte", "next", "nuxt", "remix", "astro",
	"express", "fastify", "koa", "hapi", "nestjs",
	"prisma", "drizzle-orm", "typeorm", "sequelize", "mongoose",
	"@earendil-works/pi-coding-agent", "@earendil-works/pi-ai",
	"typescript", "zod", "typebox",
	"tailwindcss", "@radix-ui/react",
];

const COMMON_SCRIPTS = [
	"dev", "build", "start", "test", "lint", "typecheck", "format", "check",
];

function readJsonSafe<T>(p: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
	} catch {
		return null;
	}
}

function readFirstLine(p: string): string | null {
	try {
		const content = fs.readFileSync(p, "utf-8");
		const first = content.split(/\r?\n/)[0]?.trim() ?? "";
		return first || null;
	} catch {
		return null;
	}
}

export function detectEnv(cwd: string): EnvSummary {
	const out: EnvSummary = {
		projectName: null,
		projectVersion: null,
		runtimes: [],
		packageManager: null,
		mainDependencies: [],
		scripts: [],
		services: [],
		hasTypeScript: false,
		hasTests: false,
		hasDocker: false,
		hasCI: false,
	};

	// package.json
	const pkg = readJsonSafe<PackageJson>(path.join(cwd, "package.json"));
	if (pkg) {
		out.projectName = pkg.name ?? null;
		out.projectVersion = pkg.version ?? null;
		if (pkg.packageManager) out.packageManager = pkg.packageManager;

		// Engines
		if (pkg.engines) {
			for (const [k, v] of Object.entries(pkg.engines)) {
				out.runtimes.push(`${k} ${v}`);
			}
		}

		// Main dependencies — prefer hints, then top-level deps
		const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
		const hinted = MAIN_DEP_HINTS.filter((h) => allDeps[h]).slice(0, 8);
		out.mainDependencies = hinted;

		// Scripts — only those in COMMON_SCRIPTS
		if (pkg.scripts) {
			out.scripts = COMMON_SCRIPTS.filter((s) => pkg.scripts?.[s]).slice(0, 6);
		}

		// Has TypeScript?
		out.hasTypeScript = "typescript" in allDeps || fs.existsSync(path.join(cwd, "tsconfig.json"));
		// Has tests?
		out.hasTests =
			"vitest" in allDeps ||
			"jest" in allDeps ||
			"mocha" in allDeps ||
			"@playwright/test" in allDeps ||
			fs.existsSync(path.join(cwd, "tests")) ||
			fs.existsSync(path.join(cwd, "__tests__"));
	}

	// Has Docker?
	out.hasDocker =
		fs.existsSync(path.join(cwd, "Dockerfile")) ||
		fs.existsSync(path.join(cwd, "docker-compose.yml")) ||
		fs.existsSync(path.join(cwd, "docker-compose.yaml"));

	// Has CI?
	const ciDirs = [".github/workflows", ".gitlab-ci.yml", ".circleci", ".buildkite"];
	out.hasCI = ciDirs.some((d) => fs.existsSync(path.join(cwd, d)));

	// Services — scan compose file for known service names
	const composeFile =
		fs.existsSync(path.join(cwd, "docker-compose.yml"))
			? path.join(cwd, "docker-compose.yml")
			: fs.existsSync(path.join(cwd, "docker-compose.yaml"))
				? path.join(cwd, "docker-compose.yaml")
				: null;
	if (composeFile) {
		try {
			const text = fs.readFileSync(composeFile, "utf-8");
			const serviceHints = ["postgres", "redis", "mysql", "mongo", "rabbitmq", "kafka", "nginx", "traefik"];
			out.services = serviceHints.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(text));
		} catch {
			// ignore
		}
	}

	// .nvmrc / .node-version / .tool-versions
	const nvmrc = readFirstLine(path.join(cwd, ".nvmrc"));
	if (nvmrc) out.runtimes.push(`node ${nvmrc}`);
	const toolVersions = readFirstLine(path.join(cwd, ".tool-versions"));
	if (toolVersions) out.runtimes.push(`asdf ${toolVersions.replace(/\s+/g, " ")}`);

	return out;
}

/** Short env section to inject into the system prompt. */
export function buildEnvSection(env: EnvSummary): string {
	if (!env.projectName && env.runtimes.length === 0 && !env.packageManager) {
		return "";
	}

	const lines: string[] = ["", "## project env", ""];
	if (env.projectName) {
		lines.push(`- **name**: ${env.projectName}${env.projectVersion ? ` @ ${env.projectVersion}` : ""}`);
	}
	if (env.packageManager) {
		lines.push(`- **package manager**: ${env.packageManager}`);
	}
	if (env.runtimes.length > 0) {
		lines.push(`- **runtimes**: ${env.runtimes.join(", ")}`);
	}
	if (env.mainDependencies.length > 0) {
		lines.push(`- **key deps**: ${env.mainDependencies.join(", ")}`);
	}
	if (env.scripts.length > 0) {
		lines.push(`- **scripts**: \`${env.scripts.join("`, `")}\``);
	}
	const flags: string[] = [];
	if (env.hasTypeScript) flags.push("ts");
	if (env.hasTests) flags.push("tests");
	if (env.hasDocker) flags.push("docker");
	if (env.hasCI) flags.push("ci");
	if (flags.length > 0) {
		lines.push(`- **tooling**: ${flags.join(", ")}`);
	}
	if (env.services.length > 0) {
		lines.push(`- **services**: ${env.services.join(", ")}`);
	}
	return lines.join("\n");
}
