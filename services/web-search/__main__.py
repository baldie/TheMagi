#!/usr/bin/env python3
"""
Entry point for running the MCP Web Search server as a module.
Usage: python -m mcp_web_search
"""

from .mcp_web_search import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())