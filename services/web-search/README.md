# Web Crawling Service

A Python-based web crawling service for The Magi system using Crawl4AI.

**Note:** Web search functionality is now handled by Tavily MCP server integration. This service focuses solely on URL crawling and content extraction.

## Features

- URL crawling and content extraction via MCP protocol
- Integration with The Magi orchestrator service  
- Asynchronous processing with Crawl4AI
- Headless browser support for dynamic content

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Run the setup script:
```bash
python setup.py
```

This will install Crawl4AI and set up Playwright browsers.

## Usage

### Start the MCP server
```bash
python mcp_web_search.py
```

The service runs as an MCP server communicating via stdio.

### Available Tools

#### crawl_url
Crawl a specific URL and extract its content.

Parameters:
- `url` (string, required): The URL to crawl
- `include_content` (boolean, optional): Whether to include full page content (default: true)

## Integration with The Magi

This service is automatically started by the orchestrator service as an MCP server. It provides the `crawl_url` tool to Balthazar for extracting content from specific URLs.

## Configuration

- **Protocol**: MCP (Model Context Protocol) via stdio
- **Browser**: Headless mode enabled for performance  
- **Logging**: INFO level by default

## Troubleshooting

Run the Crawl4AI doctor to check your installation:
```bash
crawl4ai-doctor
```

Check service logs for debugging information when issues occur.