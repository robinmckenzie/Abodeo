# Code conventions

- Use the project's existing stack. Do not add a framework, library or tool without agreement.
- For React Router, follow the docs for the installed version in `node_modules/react-router/docs/`, not memory.
- Prefer function names that start with a verb and say what the function does, not how, so that a call can be read without inspecting the implementation. Follow established conventions where clearer, such as predicates starting with `is`, `has` or `can`.
- Keep logic separately testable from the user interface where useful. Keep unit tests beside the code they test.
- Text files use LF line endings, set by `.gitattributes`. Do not remove or override it.
- Before creating a local file that holds credentials, ensure `.gitignore` excludes it. Never show a secret value in output, logs or messages.
