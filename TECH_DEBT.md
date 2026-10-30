# Tech debt

Known shortcuts in the code that work today but should be cleaned up. Each
entry says what the shortcut is and what to do about it.

## Shared UI helpers live in feature components

`project-images.tsx` imports textarea sizing from `task-list.tsx`, and
`task-list.tsx` imports its animation capability check from `project-bar.tsx`.
Move these helpers into small shared UI modules, keeping their behaviour.

## Duplicated JSON request-body reader

`project-handler.server.ts` and `people-handler.server.ts` each implement the
same length check, byte reading, decoding and JSON parsing. Extract one reader
that takes the byte limit, keeping each endpoint's responses.

## Shared server infrastructure lives in the profile module

`account-profile.server.ts` owns the JSON responses, timeouts, error-code
extraction and database and session types used across the server, and
`calendar-store.server.ts` declares its own database type. Move the shared
parts into clearly named server modules and keep profile persistence and
request handling together.

## Duplicated calendar-date primitives

`due-date.ts` and `appointments-api.ts` each implement date validation,
parsing, padding and day arithmetic. Share date-only validation and arithmetic
in a neutral module, and keep appointment wall-time handling separate.
