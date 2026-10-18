# 🏫 SOP Management System — Backend API

[![Node.js](https://img.shields.io/badge/Node.js-v18+-68a063?style=flat&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2d3748?style=flat&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e?style=flat&logo=postgresql)](https://supabase.com/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-2.5_Flash-4285f4?style=flat&logo=google)](https://ai.google.dev/)
[![Render](https://img.shields.io/badge/Deployed_on-Render-46e3b7?style=flat&logo=render)](https://sop-backend-x9x2.onrender.com)

A robust, multi-tenant REST API powering the **Standard Operating Procedure (SOP) Management & Compliance System** for educational institutions. The platform automates SOP document ingestion, text extraction, AI-driven assessment generation via Google Gemini, role-based staff assignments, and audit-ready compliance reporting.

---

## 🌐 Live Deployments

- **Backend API:** [https://sop-backend-x9x2.onrender.com](https://sop-backend-x9x2.onrender.com)
- **Admin & Compliance Portal:** [https://sop-frontend-three.vercel.app](https://sop-frontend-three.vercel.app)
- **Staff Learning Portal:** [https://sop-frontend-staff-henna.vercel.app](https://sop-frontend-staff-henna.vercel.app)

---

## 🏗️ System Architecture

```mermaid
graph TD
    A[Admin Portal - Next.js] -->|REST API + JWT| C[Express Backend Engine]
    B[Staff Portal - Next.js] -->|REST API + JWT| C
    
    C -->|ORM / SQL Queries| D[(PostgreSQL - Supabase)]
    C -->|Document Parsing| E[Multer + pdf-parse / mammoth]
    C -->|Generate Assessment MCQs| F[Google Gemini 2.5 Flash]
    
    subgraph Core Backend Modules
        C --> M1[Auth & RBAC]
        C --> M2[SOP Document Management]
        C --> M3[AI Assessment Engine]
        C --> M4[Assignments & Tracking]
        C --> M5[Compliance & Reports]
    end
```

---

## ✨ Key Features

1. **Document Ingestion & Parsing:**
   - Supports upload of `.pdf` and `.docx` policy documents via `multer`.
   - Extracts plain text automatically using `pdf-parse` and `mammoth`.
   - Organizes documents into versioned revisions (`SOPVersion`).

2. **Automated AI Question Generation:**
   - Integrates **Google Gemini 2.5 Flash** (`@google/genai`) to generate 5 challenging multiple-choice questions from policy text.
   - Enforces structured JSON output schema: question prompt, 4 distinct options, correct answer index, and pedagogical explanations.
   - Saves drafted questions for admin review and approval before publishing.

3. **Comprehension Assessment Engine:**
   - Strict 80% passing threshold to guarantee policy understanding.
   - React StrictMode-safe in-progress session resumption to prevent duplicate ghost attempts.
   - Post-submission explanation breakdown so staff learn from incorrect answers.

4. **Multi-Tenancy & School Data Isolation:**
   - Every user, SOP, assignment, and report is strictly scoped by `schoolName`.
   - Role-based queries ensure administrators only access records within their respective institution.

5. **Role-Based Access Control (RBAC):**
   - Supported Roles: `SUPER_ADMIN`, `ADMIN`, `TEACHING_STAFF`, `NON_TEACHING_STAFF`.
   - Two-tier JWT authentication: short-lived Access Tokens (15 min) + rotating Refresh Tokens (7 days).
   - Password hashing with `bcrypt` (10 salt rounds).

---

## 📁 Repository Structure

```
backend/
├── prisma/
│   ├── schema.prisma       # Prisma ORM models & relations
│   └── seed.ts             # Initial demo database seeder
├── src/
│   ├── app.ts              # Express application bootstrap & route mounting
│   ├── lib/
│   │   ├── gemini.ts       # Google Gemini SDK client initialization
│   │   └── prisma.ts       # Shared PrismaClient instance
│   ├── middleware/
│   │   └── auth.ts         # JWT authentication & role-authorization guards
│   └── modules/
│       ├── ai-questions/   # AI prompt formatting & generation service
│       ├── assessments/    # Quiz submission, scoring & explanation handlers
│       ├── assignments/    # Staff assignment distribution & due dates
│       ├── auth/           # Login, registration, token refresh & profile
│       ├── learning/       # Staff document reading & assignment retrieval
│       ├── reports/        # Compliance rate calculations & overdue stats
│       └── sops/           # SOP CRUD, document upload & versioning
└── package.json
```

---

## 🔌 API Endpoints Summary

### Authentication (`/api/v1/auth`)
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticate with email & password | Public |
| `POST` | `/api/v1/auth/register` | Register new user account | Public |
| `POST` | `/api/v1/auth/refresh` | Exchange refresh token for new access token | Public |
| `GET` | `/api/v1/auth/me` | Fetch authenticated user profile | Authenticated |

### Standard Operating Procedures (`/api/v1/sops`)
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/sops` | List all SOPs for current school | Admin |
| `POST` | `/api/v1/sops` | Create a new SOP document | Admin |
| `GET` | `/api/v1/sops/:id` | Get SOP details and versions | Admin |
| `POST` | `/api/v1/sops/:sopId/versions` | Upload new PDF/DOCX file version | Admin |

### Assessments & Questions (`/api/v1/assessments`)
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/assessments/generate` | Trigger Gemini AI question generation | Admin |
| `GET` | `/api/v1/assessments/:sopVersionId` | Fetch assessment and questions | Staff / Admin |
| `POST` | `/api/v1/assessments/start` | Start or resume an assessment attempt | Staff |
| `POST` | `/api/v1/assessments/submit` | Submit answers, calculate score & get explanations | Staff |

### Assignments & Learning (`/api/v1/assignments` & `/api/v1/learning`)
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/assignments` | List all SOP assignments with statuses | Admin |
| `POST` | `/api/v1/assignments` | Assign SOP to individual staff or whole role | Admin |
| `GET` | `/api/v1/learning/my-sops` | Get active user's assigned SOPs | Staff |
| `GET` | `/api/v1/learning/:assignmentId/read` | Mark reading started & view document | Staff |

### Compliance & Reports (`/api/v1/reports`)
| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/reports/summary` | Organization-wide compliance KPIs | Admin |
| `GET` | `/api/v1/reports/compliance` | Tabular compliance audit trail (filterable) | Admin |
| `GET` | `/api/v1/reports/overdue` | List overdue staff assignments | Admin |

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js** 18.x or higher
- **PostgreSQL** database (Local or Cloud instance such as Supabase)
- **Google Gemini API Key** ([Google AI Studio](https://aistudio.google.com/))

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/chintansood/sop-management-system.git
cd sop-management-system/backend
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the `backend/` directory:
```env
# Database Connection (Supabase or Local Postgres)
DATABASE_URL="postgresql://postgres:password@localhost:5432/sop_management_dev"

# Authentication Secrets
JWT_ACCESS_SECRET="your_super_secret_access_jwt_key"
JWT_REFRESH_SECRET="your_super_secret_refresh_jwt_key"

# AI Question Generation
GEMINI_API_KEY="your_google_gemini_api_key"

# Application Settings
PORT=3000
NODE_ENV=development
```

### 4. Database Setup & Seeding
```bash
# Push schema to database
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Populate with mock school, staff, and SOP test data
npm run seed
```

### 5. Run the Server
```bash
# Development mode with hot reload
npm run dev

# Production build and run
npm run build
npm start
```
The server will start listening at `http://localhost:3000` (Health check: `http://localhost:3000/health`).

---

## 🔑 Demo Login Credentials

| Role | Email | Password | School |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@school.test` | `password` | My School |
| **Teaching Staff** | `teacher1@school.test` | `password` | My School |
| **Non-Teaching Staff** | `staff1@school.test` | `password` | My School |
| **Tamil School Admin** | `admintt@school.test` | `123456` | Tamil School |

---

## 📄 License
This project is licensed under the ISC License.
