---
description: How to deploy the Slacky Hub application
---

# Deploying Slacky Hub

This application is built with [Next.js](https://nextjs.org/) and uses [Prisma](https://www.prisma.io/).

> [!IMPORTANT]
> **Database Requirement**: This app requires a PostgreSQL database for Vercel deployment.
> Make sure `DATABASE_URL` in your `.env` points to a Postgres instance (e.g., Supabase, Neon, Vercel Postgres).

## Vercel Deployment

### 1. Project Configuration
When importing your project into Vercel, use the following settings:
- **Framework Preset**: Next.js
- **Build Command**: `npx prisma generate && next build`
  - *Note: `prisma generate` is required to create the client before the build.*
- **Output Directory**: Next.js default (leave empty/override disabled)
- **Install Command**: `yarn install`

### 2. Environment Variables
You must set the following environment variables in your Vercel Project Settings:
- `DATABASE_URL`: Connection string to your PostgreSQL database.
- `SLACK_BOT_TOKEN`: Your Slack Bot User OAuth Token (`xoxb-...`).
- `HUBSPOT_ACCESS_TOKEN`: Your HubSpot Private App Access Token.
- `OPENAI_API_KEY`: Your OpenAI API Key.
- `CRON_SECRET`: A secure random string to protect your automated sync endpoint.

### 3. Automation (Cron)
The included `vercel.json` automatically configures a Cron Job to trigger `/api/sync` at **4:00 AM UTC (11:00 PM EST)** on Tuesday through Saturday (covering Monday-Friday nights).
To secure this, ensure `CRON_SECRET` is set.

## Self-Hosted Deployment

1.  **Prepare the Server**: Ensure Node.js (v16+) and Yarn are installed.
2.  **Clone & Install**:
    ```bash
    git clone <your-repo-url>
    cd slacky-hub
    yarn install
    ```
3.  **Environment Variables**:
    Create a `.env` file with your production keys.
4.  **Build**:
    ```bash
    npx prisma generate
    yarn build
    ```
5.  **Start**:
    ```bash
    yarn start
    ```
6.  **Automation (Crontab)**:
    ```bash
    # Run at 11:00 PM (23:00) Monday through Friday
    0 23 * * 1-5 curl -H "Authorization: Bearer <YOUR_CRON_SECRET>" http://localhost:3000/api/sync
    ```
