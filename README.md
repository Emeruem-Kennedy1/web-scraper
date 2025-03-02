# WhoSampled.com Scraper

A robust TypeScript-based web scraping system designed to collect and store music sampling data, including artists, songs, genres, and sample relationships.

## Overview

This project provides a comprehensive solution for:
- Scraping artist and song data from music databases
- Recording sample relationships between songs
- Storing genre information
- Managing artist collaborations and features
- Handling data persistence with MySQL via Prisma ORM

## Features

- **Robust Scraping Engine**
  - Rate limiting and request throttling
  - Automatic retry mechanism
  - Cloudflare challenge bypass
  - Page pooling for efficient resource usage
  - Stealth plugin integration to avoid detection

- **Data Models**
  - Artists (with main and featuring relationships)
  - Songs (with release year tracking)
  - Genres
  - Sample relationships (tracks which songs sample others)
  - Full relationship tracking between entities

- **Progress Tracking**
  - Robust progress monitoring system
  - Resumable operations
  - Error logging and recovery
  - Per-artist and per-song progress tracking

## Prerequisites

- Node.js
- TypeScript
- MariaDB or any MySQL database (Note: If you don't use MariaDB you might need to do you'll need to do more setup)
- Google Chrome (for headless browser operations)

## Setup

1. Clone the repository

2. Install dependencies:
```bash
npm install
```

3. Configure your database:
   - Copy `.env.example` to `.env`
   - Update the `DATABASE_URL` with your MySQL connection string

4. Run Prisma migrations:
```bash
npx prisma migrate dev
```

## Configuration

The project uses various configuration files:

- `configs/configs.json`: Base URL and other scraping parameters
- `.env`: Database and environment configuration
- `prisma/schema.prisma`: Database schema definition

The `.env` file should contain your database connection string:
```env
DATABASE_URL="mysql://user:password@localhost:3306/database"
```



## Usage

The project provides several commands for different scraping operations:

```bash
# Run main scraping process
make run_main_scrape
```

## Project Structure

- `/src`
  - `index.ts`: Main entry point
  - `scrapeall.ts`: Artist page scraping logic
  - `main.ts`: Main scraping orchestration
  - `/configs`: Configuration files
  - `/models`: Data models and types

## Progress Tracking

The system implements robust progress tracking:

- Saves progress per artist and song
- Maintains state between runs
- Provides detailed progress summaries
- Handles failures gracefully with retry mechanisms

## Error Handling

The scraper includes comprehensive error handling:

- Automatic retry for failed requests
- Cloudflare challenge handling
- Connection error recovery
- Rate limit compliance
- Detailed error logging

## Database Schema

The database schema includes:

- `Artist`: Artist information and relationships
- `Song`: Song details including release year
- `SongArtist`: Manages artist-song relationships
- `Genre`: Music genres
- `Sample`: Tracks sampling relationships between songs

## Notes

- The scraper is designed to be respectful of rate limits
- Progress is automatically saved and can be resumed
- Ensure your database connection is properly configured before running
