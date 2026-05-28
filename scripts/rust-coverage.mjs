import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportDir = join(root, "coverage", "rust");
const manifestPath = join(root, "src-tauri", "Cargo.toml");

const steps = [
  {
    name: "run Rust tests with coverage",
    args: ["llvm-cov", "--manifest-path", manifestPath, "--no-report"],
  },
  {
    name: "write Rust text coverage",
    args: [
      "llvm-cov",
      "report",
      "--manifest-path",
      manifestPath,
      "--text",
      "--output-path",
      join(reportDir, "summary.txt"),
    ],
  },
  {
    name: "write Rust HTML coverage",
    args: [
      "llvm-cov",
      "report",
      "--manifest-path",
      manifestPath,
      "--html",
      "--output-dir",
      reportDir,
    ],
  },
  {
    name: "write Rust JSON coverage",
    args: [
      "llvm-cov",
      "report",
      "--manifest-path",
      manifestPath,
      "--json",
      "--output-path",
      join(reportDir, "coverage.json"),
    ],
  },
  {
    name: "write Rust lcov coverage",
    args: [
      "llvm-cov",
      "report",
      "--manifest-path",
      manifestPath,
      "--lcov",
      "--output-path",
      join(reportDir, "lcov.info"),
    ],
  },
];

function runStep(step) {
  console.log(`\n[rust-coverage] ${step.name}`);

  return new Promise((resolve) => {
    const child = spawn("cargo", step.args, {
      cwd: root,
      stdio: "inherit",
    });

    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

for (const step of steps) {
  mkdirSync(reportDir, { recursive: true });
  const result = await runStep(step);
  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
}

console.log(`\n[rust-coverage] Reports written to ${reportDir}`);
