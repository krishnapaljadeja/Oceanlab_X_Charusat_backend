# Git History Teller — Backend

Express + TypeScript REST API that powers the Git History Teller. It fetches GitHub commit history, runs AI-driven analysis, persists results to PostgreSQL, serves commit heatmap data derived from stored summaries, and answers natural-language questions about any analyzed repository.

## Python Dependency For Gitingest

```bash
# Required: install gitingest Python package on the server
pip install gitingest
# or
pipx install gitingest
```

Add `pip install gitingest` to your deployment steps or Dockerfile so the child-process integration can run in production.
