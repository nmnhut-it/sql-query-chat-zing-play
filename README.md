# DuckQuery 🦆

An AI-powered SQL query interface built with DuckDB-Wasm and OpenAI.

## Features

- **In-browser DuckDB**: Run lightning-fast SQL queries directly in your browser.
- **AI-Powered SQL Generation**: Ask questions in natural language and get DuckDB SQL.
- **✨ Fix with AI**: Automatically correct failing SQL queries using AI.
- **CSV Import**: Import your own data and query it immediately.
- **History & Export**: Keep track of your queries and export results to CSV.

## Getting Started

1. Clone the repository.
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Open the OpenAI Settings in the app and add your API Key.

## Deployment

This project is configured for GitHub Pages.

1. Create a repository on GitHub.
2. Link your local repo: `git remote add origin https://github.com/<username>/<repo-name>.git`
3. Update `package.json` `"homepage"` and `vite.config.ts` `"base"`.
4. Deploy: `npm run deploy`
