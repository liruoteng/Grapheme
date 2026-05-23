import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportDir = join(root, "reports", "stress");
const reportPath = join(reportDir, "latest.json");

const steps = [
  {
    name: "frontend",
    command: "npm",
    args: ["run", "test:stress:frontend"],
    budgetMs: 5_000,
  },
  {
    name: "markdown-preview",
    command: "npm",
    args: ["run", "test:preview-pipeline:rust"],
    budgetMs: 25_000,
  },
  {
    name: "rust",
    command: "npm",
    args: ["run", "test:stress:rust"],
    budgetMs: 15_000,
  },
];

function runStep(step) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: root,
      env: {
        ...process.env,
        STRESS_RUN: "1",
      },
      stdio: "inherit",
    });

    child.on("close", (code, signal) => {
      resolve({
        name: step.name,
        command: [step.command, ...step.args].join(" "),
        code,
        signal,
        durationMs: Date.now() - startedAt,
        budgetMs: step.budgetMs,
        withinBudget: !step.budgetMs || Date.now() - startedAt <= step.budgetMs,
      });
    });
  });
}

const startedAt = new Date();
const results = [];

for (const step of steps) {
  results.push(await runStep(step));
  if (results.at(-1).code !== 0) break;
}

const report = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  passed: results.every((result) => result.code === 0),
  budgetsPassed: results.every((result) => !result.budgetMs || result.durationMs <= result.budgetMs),
  results,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\nStress report written to ${reportPath}`);
process.exit(report.passed && report.budgetsPassed ? 0 : 1);
