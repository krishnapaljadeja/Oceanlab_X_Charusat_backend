#!/usr/bin/env python3
"""
Thin wrapper around gitingest Python package.
Called by Node.js as a child process.
Usage: python3 gitingest_runner.py <repo_url> [--include "*.json,Dockerfile"] [--exclude "node_modules/*,*.lock"]
Output: JSON to stdout
"""
import sys
import json
import argparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_url")
    parser.add_argument("--include", default="", help="Comma-separated include patterns")
    parser.add_argument(
        "--exclude",
        default="node_modules/*,*.lock,dist/*,build/*,*.min.js",
        help="Comma-separated exclude patterns",
    )
    parser.add_argument("--max-size", type=int, default=51200, help="Max file size in bytes")
    args = parser.parse_args()

    try:
        from gitingest import ingest

        include_patterns = [p.strip() for p in args.include.split(",") if p.strip()] or None
        exclude_patterns = [p.strip() for p in args.exclude.split(",") if p.strip()] or None

        kwargs = {
            "max_file_size": args.max_size,
        }
        if include_patterns:
            kwargs["include_patterns"] = include_patterns
        if exclude_patterns:
            kwargs["exclude_patterns"] = exclude_patterns

        summary, tree, content = ingest(args.repo_url, **kwargs)

        print(
            json.dumps(
                {
                    "success": True,
                    "summary": summary,
                    "tree": tree,
                    "content": content,
                }
            )
        )

    except Exception as exc:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": str(exc),
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
