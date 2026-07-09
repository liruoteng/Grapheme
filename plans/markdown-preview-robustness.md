# Markdown Preview Robustness Plan

## Goal

Make the Markdown to Typst to preview pipeline measurable and resilient under malformed input, large documents, and conversion edge cases.

## Success Criteria

1. Valid Markdown still uses the fast preview path without extra user-visible delay.
2. Preview startup never leaves Markdown users with an empty or missing preview file when generated Typst is invalid.
3. Conversion failures produce a compilable fallback preview that includes diagnostics and the original Markdown.
4. The automated stress pipeline runs Markdown preview fallback tests in addition to frontend store stress and generic Rust stress tests.

## Implementation Steps

1. Promote the current test-only Markdown preview recovery helpers into production code.
   Verify: `cargo test --manifest-path src-tauri/Cargo.toml markdown_preview`.

2. Use the resilient writer for Markdown sidecar preview startup.
   Verify: broken Markdown/Typst input still starts preview from a generated `.preview.typ` file.

3. Keep live typing updates on the fast writer.
   Verify: `write_preview_sidecar_content` still uses the fast conversion path.

4. Add pipeline tests for fallback behavior.
   Verify: invalid generated Typst writes a compilable recovered or diagnostic fallback file.

5. Add the Markdown preview test lane to `npm run test:stress`.
   Verify: `npm run test:stress` runs frontend stress, Markdown preview pipeline tests, and Rust stress tests.

## Future Hardening

- [x] Add a debounced idle resilient validation pass after live typing.
- [x] Add a source-level smoke stress test that verifies Markdown idle validation writes a nonblank compilable preview file.
- [x] Add a UI smoke stress test that opens Markdown files and verifies the preview iframe is not blank.
- [x] Track timing budgets for fast conversion, resilient validation, fallback generation, and stress pipeline steps.

## Re-Evaluation: 2026-05-23

Done:

1. Production fallback helpers exist.
2. Markdown preview startup uses resilient generation.
3. Live typing still uses fast generation.
4. Explicit save now uses resilient validation.
5. Live typing now schedules an idle resilient validation pass.

Remaining:

1. Add a real browser/Tauri smoke test that verifies tinymist-rendered iframe contents, beyond the mocked React smoke test.
