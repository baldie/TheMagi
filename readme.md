![magi ui](./magi_ui.png)

# The Magi

![Tests](https://github.com/baldie/TheMagi/workflows/Build%20and%20Test/badge.svg)
![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-orange)
![Node.js](https://img.shields.io/badge/node.js-16+-green)
![Python](https://img.shields.io/badge/python-3.11+-blue)

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Angular](https://img.shields.io/badge/angular-%23DD0031.svg?style=for-the-badge&logo=angular&logoColor=white)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![PyTorch](https://img.shields.io/badge/PyTorch-%23EE4C2C.svg?style=for-the-badge&logo=PyTorch&logoColor=white)

![AI](https://img.shields.io/badge/AI-Powered-ff69b4)
![TTS](https://img.shields.io/badge/TTS-Chatterbox-purple)
![Microservices](https://img.shields.io/badge/architecture-microservices-brightgreen)
![Code Style](https://img.shields.io/badge/code%20style-prettier-ff69b4.svg)
![Linting](https://img.shields.io/badge/linting-ESLint-4B32C3)

A personal, omnipresent Artificial Intelligence system, built to serve a human as a board of directors for decisions large and small.

* Caspar - qwen2.5vl:7b
* Melchior - gemma3:12b
* Balthazar - llama3.2:3b-instruct-q8_0

## Setup

### API Key Configuration

The Magi uses Tavily for web search functionality. To enable this feature:

1. **Get a Tavily API Key:**
   - Visit [https://app.tavily.com/home](https://app.tavily.com/home)
   - Sign up for a free account
   - Copy your API key (it will start with "tvly-")

2. **Configure the API Key:**
   - Copy `.env.template` to `.env` in the project root
   - Edit `.env` and add your Tavily API key:
     ```
     TAVILY_API_KEY=tvly-your-actual-api-key-here
     ```
   - Save the file

The `.env` file is automatically excluded from version control to keep your API key secure.

## Installation and Running

To run, clone the repo, launch a terminal and run:

```
install-magi.bat
```

and then

```
start-magi.bat
```

Copyright 2025 David Baldie (c)