#!/usr/bin/env python3
"""
Setup script for the Web Search Service
"""

import asyncio
import subprocess
import sys
import os

async def setup_crawl4ai():
    """Setup Crawl4AI and its dependencies"""
    print("Setting up Crawl4AI...")
    
    try:
        # Install requirements
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        print("✓ Requirements installed")
        
        # Run crawl4ai-setup
        subprocess.run(["crawl4ai-setup"], check=True)
        print("✓ Crawl4AI setup completed")
        
        # Test the installation
        subprocess.run(["crawl4ai-doctor"], check=True)
        print("✓ Crawl4AI doctor check passed")
        
        print("\n🎉 Web Search Service setup completed successfully!")
        print("You can now start the service with: python web_search_server.py")
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Setup failed: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print("❌ crawl4ai command not found. Make sure crawl4ai is installed correctly.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(setup_crawl4ai())