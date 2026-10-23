# Redesign deploy notes (2026-10-23, ~evening PKT)

## KV key gotcha (learned the hard way)
worker.js reads `env.KV.get("site:" + file)` where `file` = "/index.html" (WITH leading slash).
Correct keys: `site:/index.html`, `site:/practice.html`, `site:/styles.css`, `site:/speakband-avatar.png`.
An upload to `site:index.html` (no slash) succeeds via API but is never served. Wrong keys were deleted.

## GitHub push BLOCKED (retry tomorrow)
Two attempts to `push_files` to Ayaz232005/speakband (7 source files) via `/opt/hatch/bin/github call-tool`
each coincided with a full service restart; repo still has old files (verified via get_file_contents).
Per no-thrash rule, stopped. Likely the write-approval flow destabilizes subagent sessions.
Retry from the main agent session, or split into smaller pushes. Sources are safe in the build dir.
