#!/usr/bin/env python3
"""
MCP Web Crawling Server for The Magi system.
Provides URL crawling functionality via the Model Context Protocol using Crawl4AI.
Note: Web search is now handled by Tavily MCP server integration.
"""

import asyncio
import logging
import sys
import json
from typing import List, Dict, Any, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    from crawl4ai.extraction_strategy import NoExtractionStrategy
except ImportError:
    logger.error("crawl4ai not installed. Run: pip install crawl4ai")
    sys.exit(1)

try:
    from mcp.server import Server, NotificationOptions
    from mcp.server.models import InitializationOptions
    from mcp.server.stdio import stdio_server
    from mcp.types import (
        Resource,
        Tool,
        TextContent,
        ImageContent,
        EmbeddedResource,
        CallToolRequest,
        ListToolsRequest,
    )
    import mcp.types as types
except ImportError:
    logger.error("MCP server package not installed. Run: pip install mcp")
    sys.exit(1)

# Global crawler instance
crawler = None
server = Server("web-crawl")

async def initialize_crawler():
    """Initialize the web crawler"""
    global crawler
    try:
        logger.info("Initializing Crawl4AI...")
        browser_config = BrowserConfig(
            headless=True,
            verbose=False
        )
        crawler = AsyncWebCrawler(config=browser_config)
        await crawler.start()
        logger.info("Crawl4AI initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize crawler: {e}")
        raise

async def cleanup_crawler():
    """Cleanup the web crawler"""
    global crawler
    if crawler:
        try:
            await crawler.close()
            logger.info("Crawler closed successfully")
        except Exception as e:
            logger.error(f"Error closing crawler: {e}")

@server.list_tools()
async def handle_list_tools() -> List[Tool]:
    """List available tools"""
    return [
        Tool(
            name="crawl_url",
            description="Crawl a specific URL and extract its content",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to crawl"
                    },
                    "include_content": {
                        "type": "boolean",
                        "description": "Whether to include full page content (default: true)",
                        "default": True
                    }
                },
                "required": ["url"]
            }
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: dict) -> List[types.TextContent | types.ImageContent | types.EmbeddedResource]:
    """Handle tool calls"""
    if not crawler:
        return [TextContent(
            type="text",
            text="Error: Crawler not initialized"
        )]
    
    try:
        if name == "crawl_url":
            return await handle_crawl_url(arguments)
        else:
            return [TextContent(
                type="text",
                text=f"Error: Unknown tool '{name}'"
            )]
    except Exception as e:
        logger.error(f"Tool execution failed: {e}")
        return [TextContent(
            type="text",
            text=f"Error: Tool execution failed: {str(e)}"
        )]


async def crawl_page_content(url: str) -> Optional[str]:
    """Crawl content from a specific URL"""
    try:
        content_config = CrawlerRunConfig(
            word_count_threshold=10,
            extraction_strategy=NoExtractionStrategy(),
            cache_mode=CacheMode.BYPASS
        )
        content_result = await crawler.arun(url=url, config=content_config)
        if content_result.success and content_result.markdown:
            return content_result.markdown
        return None
    except Exception as e:
        logger.warning(f"Content crawling failed for {url}: {e}")
        return None


async def handle_crawl_url(arguments: dict) -> List[types.TextContent]:
    """Handle URL crawling requests"""
    url = arguments.get("url")
    include_content = arguments.get("include_content", True)
    
    if not url:
        return [TextContent(
            type="text",
            text="Error: url parameter is required"
        )]
    
    logger.info(f"Crawling URL: {url}")
    
    try:
        run_config = CrawlerRunConfig(
            word_count_threshold=10,
            extraction_strategy=NoExtractionStrategy(),
            cache_mode=CacheMode.BYPASS
        )
        
        result = await crawler.arun(url=url, config=run_config)
        
        if not result.success:
            return [TextContent(
                type="text",
                text=f"Crawling failed: {result.error_message}"
            )]
        
        crawl_result = {
            "url": url,
            "title": result.metadata.get("title", "") if result.metadata else "",
            "content": result.markdown if include_content else None,
            "word_count": len(result.markdown.split()) if result.markdown else 0,
            "links": result.links if hasattr(result, 'links') else []
        }
        
        logger.info(f"URL crawling completed for: {url}")
        
        return [TextContent(
            type="text",
            text=json.dumps(crawl_result, indent=2)
        )]
        
    except Exception as e:
        logger.error(f"URL crawling failed: {e}")
        return [TextContent(
            type="text",
            text=f"Crawling failed: {str(e)}"
        )]

async def main():
    """Main function to run the MCP server"""
    logger.info("Starting MCP Web Crawling Server...")
    
    # Initialize crawler
    await initialize_crawler()
    
    try:
        # Create server options
        options = InitializationOptions(
            server_name="web-crawl",
            server_version="1.0.0",
            capabilities=server.get_capabilities(
                notification_options=NotificationOptions(),
                experimental_capabilities={}
            )
        )
        
        # Run the server
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                options
            )
    finally:
        await cleanup_crawler()

if __name__ == "__main__":
    asyncio.run(main())