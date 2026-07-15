# ReelScheduler: Multi-Account Instagram Reel Scheduler

A production-ready web application that allows users to upload a Reel once and schedule it to be published to multiple connected Instagram Business/Creator accounts using Meta's official APIs.

## Architecture & Tech Stack

- **Frontend**: React + TypeScript (Vite), React Router, Premium Dark Theme Vanilla CSS
- **Backend**: Node.js + Express, TypeScript
- **Database**: PostgreSQL (Prisma ORM)
- **Queues & Workers**: BullMQ + Redis
- **Security**: JWT Authentication, AES-256-GCM token encryption, Helmet, CSRF/CORS protections
- **Storage**: Abstracted `StorageService` (Local + AWS S3)

## Features
- Secure JWT based authentication
- Meta OAuth Integration (Connect Facebook Pages & Instagram Business Accounts)
- Media Upload (MP4/MOV up to 100MB) directly to local storage or AWS S3
- Scheduling via BullMQ and Exponential Backoff Graph API Workers
- Dashboard Analytics and Calendar visualizations

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Meta Developer App credentials

### Installation

1. **Clone & Install Dependencies**
   ```bash
   npm run bootstrap
   ```

2. **Configure Environment**
   - Copy `.env.example` to `.env` in the root.
   - Copy `backend/.env.example` to `backend/.env`.
   - Update `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

3. **Start Infrastructure**
   ```bash
   docker-compose up -d
   ```

4. **Run Migrations**
   ```bash
   cd backend && npx prisma migrate dev
   ```

5. **Start Application**
   ```bash
   npm start
   ```
   - Frontend: `http://localhost:5173`
   - Backend: `http://localhost:3000`
