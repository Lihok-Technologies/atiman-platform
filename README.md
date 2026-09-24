# ODM-CMMS

**Operator-Driven Maintenance Computerized Maintenance Management System**

A mobile-first CMMS application built with Node.js, Express, and PostgreSQL.

## Database Runtime (Phase 3)

**PostgreSQL (`pg`) is the primary and only runtime database driver.** The API/HTTP
server, models, controllers, services, and routes connect to PostgreSQL exclusively.

The legacy `mysql2` driver remains a dependency solely for documented one-off
import/migration utilities that are run manually and are never loaded by the web
runtime:

- `src/utils/import-csv.js`
- `src/utils/import-smp.js`, `src/utils/import-smp-csv.js`, `src/utils/import-excel-workbook.js`
- `src/utils/batch-import-smps.js`
- `src/utils/init-db.js` (legacy MySQL bootstrap)

This boundary is enforced by `tests/phase3-cutover-guard.test.js`, which scans
the runtime source tree and also verifies that booting the application does not
load `mysql2`. Do not add `mysql2` to any model, controller, service, route, or
middleware. See the full allowlist in `src/config/database.js`
(`LEGACY_MYSQL2_ALLOWLIST`).

## Quick Start (Windows)

The easiest way to get started on Windows is using the provided installer scripts.

### Prerequisites
1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
2. **PostgreSQL 14+** - Download from [postgresql.org](https://www.postgresql.org/download/)

### Installation Steps

#### Option 1: Automatic Installer (Recommended)

1. **Double-click `install-windows.bat`**
   - The script will check prerequisites
   - Install dependencies
   - Configure the database
   - Start the server

2. **Open browser and go to:** http://localhost:3000

3. **Login with:**
   - **Admin:** `admin` / `admin123`
   - **Operator:** `operator1` / `operator123`

#### Option 2: Manual Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env
# Edit .env with your PostgreSQL credentials (DB_HOST, DB_PORT=5432,
# DB_NAME, DB_USER, DB_PASSWORD).

# 3. Create the PostgreSQL database
createdb -U postgres odm_cmms

# 4. Apply the PostgreSQL schema (the canonical, authoritative mechanism).
#    Migrations are discovered dynamically from database/postgresql/ matching
#    ^\d{3}_.*\.sql$ and applied in ascending filename order. Each file runs in
#    its own transaction. The command is forward-only and re-applicable.
npm run db:migrate:postgres

# 5. Assert the schema is ready for this application (read-only)
node scripts/smoke-test-pg.js

# 6. Start server
npm run dev
```

The complete PostgreSQL migration chain (currently 001-013) lives in
`database/postgresql/`:

| Migration | Contents |
|---|---|
| `001_core.sql` | Core identity, facilities, organizations |
| `002_equipment_taxonomy.sql` | Equipment categories, classes, types, ISO 14224 taxonomy |
| `003_templates_maintenance.sql` | Task templates, steps, safety controls |
| `004_work_management.sql` | Work orders, findings, scheduling |
| `005_commercial_security.sql` | Subscriptions, API keys, audit |
| `006_customization_files.sql` | Custom fields, uploads |
| `007_indexes.sql` | Indexes |
| `008_views.sql` | Reporting views |
| `009_knowledge_versioning.sql` | Immutable knowledge versioning (packs, template versions, step versions) |
| `010_knowledge_versioning_indexes.sql` | Knowledge versioning indexes |
| `011_knowledge_provenance.sql` | Knowledge sources, source versions, frozen evidence |
| `012_task_template_safety_control_versioning.sql` | Safety-control versioning |
| `013_knowledge_governance_admission.sql` | ATM-001 M1 knowledge governance: review lifecycle, safety-review state, publication admission attribution, publisher durability |

> **Forward-only.** There is no down-migration and no reset command. A faulty
> migration is corrected by adding a new forward migration.
>
> **Never applied at application startup.** `node src/index.js` does not run
> migrations; schema change is always an explicit operator action.
>
> **Production.** Applying migrations to production changes production schema
> state and requires explicit OWNER authorization. A merge to `main` is not that
> authorization. See `DEPLOYMENT_CLOUD.md`.

> **Legacy note:** `npm run db:init` runs `src/utils/init-db.js`, which is a
> **legacy MySQL-only** bootstrap utility that uses `mysql2`. It is not used
> for PostgreSQL and must not be run against the PostgreSQL runtime. The same
> applies to every runner under `database/migrations/`, which is a legacy MySQL
> directory and is never read by the PostgreSQL migration runner.
>
> `scripts/bootstrap-knowledge/bootstrap.js` (corpus import) and
> `scripts/bootstrap-admin/bootstrap-admin.js` (first administrator) are
> **one-time manual operations, never deployment steps**. The knowledge
> bootstrap additionally requires its target tables to be empty.

### Available Scripts

| Script | Purpose |
|--------|---------|
| `install-windows.bat` | First-time setup - installs everything |
| `start-server.bat` | Start the server (after installation) |
| `reset-database.bat` | Reset database to default state |
| `update.bat` | Update dependencies |

## Features

### For Operators
- Login with secure JWT authentication
- View assigned work orders
- Input inspection readings (numeric, boolean, text, select)
- Submit completed work orders
- Mobile-optimized interface

### For Admins
- Manage equipment and assets
- Create and manage task templates
- Schedule preventive maintenance
- Create and assign work orders
- View reports and analytics

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL 14+ (primary runtime driver: `pg`)
- **Legacy tooling:** `mysql2` retained only for one-off import/migration utilities
- **Frontend:** EJS, Vanilla JavaScript (Mobile-first CSS)
- **Authentication:** JWT with bcrypt
- **PWA:** Service Worker, Web Manifest

## Database Schema

### Tables
- `users` - User accounts and authentication
- `facilities` - Physical locations/facilities
- `equipment` - Assets and equipment
- `task_master` - Task templates/checklists
- `schedules` - Preventive maintenance schedules
- `work_orders` - Work order tracking
- `inspection_points` - Individual inspection checkpoints
- `inspection_readings` - Actual readings from operators
- `attachments` - File uploads
- `audit_log` - Change tracking

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/profile` - Get user profile
- `POST /api/auth/register` - Register new user (admin only)

### Equipment
- `GET /api/equipment` - List all equipment
- `GET /api/equipment/:id` - Get equipment details
- `POST /api/equipment` - Create equipment (admin)
- `PUT /api/equipment/:id` - Update equipment (admin)
- `DELETE /api/equipment/:id` - Delete equipment (admin)

### Work Orders
- `GET /api/work-orders` - List work orders
- `GET /api/work-orders/my-work-orders` - Get operator's work orders
- `GET /api/work-orders/:id` - Get work order details
- `POST /api/work-orders` - Create work order (admin)
- `PUT /api/work-orders/:id/status` - Update status
- `POST /api/work-orders/:id/notes` - Add note

### Inspections
- `GET /api/inspections/points/task/:taskId` - Get inspection points
- `GET /api/inspections/readings/work-order/:workOrderId` - Get readings
- `POST /api/inspections/readings/work-order/:workOrderId` - Submit reading
- `POST /api/inspections/readings/work-order/:workOrderId/bulk` - Submit multiple

## Mobile Features

- **Progressive Web App:** Install on home screen
- **Offline Support:** Cached pages work offline
- **Pull to Refresh:** Swipe down to refresh data
- **Touch Optimized:** Large touch targets, smooth animations
- **Responsive Design:** Works on all screen sizes

## Troubleshooting

### "psql command not found"
Add PostgreSQL to your PATH:
- Default location: `C:\Program Files\PostgreSQL\<version>\bin`

### "Port 3000 already in use"
Edit `.env` file:
```env
PORT=3001
```

### "Access denied for user"
Check your PostgreSQL credentials in `.env` file.

### Reset Everything
Run `reset-database.bat` to restore default data.

## Development

### Available npm Scripts
- `npm start` - Start production server
- `npm run dev` - Start with auto-reload
- `npm test` - Run tests
- `npm run db:init` - **Legacy MySQL-only** bootstrap (`src/utils/init-db.js`, uses `mysql2`); do not use for PostgreSQL. Initialize PostgreSQL with the numbered SQL files under `database/postgresql/` instead.

### Project Structure
```
ODM-CMMS/
├── database/
│   ├── postgresql/         # PostgreSQL schema (numbered .sql files applied in order)
│   └── schema.sql          # Legacy MySQL schema reference
├── src/
│   ├── config/             # Configuration files
│   ├── controllers/        # Route controllers
│   ├── middleware/         # Express middleware
│   ├── models/             # Database models
│   ├── routes/             # API routes
│   ├── utils/              # Utility functions
│   ├── app.js              # Express app setup
│   └── index.js            # Server entry point
├── public/                 # Static assets
├── views/                  # EJS templates
├── install-windows.bat     # Windows installer
├── start-server.bat        # Start server script
├── reset-database.bat      # Reset database script
├── .env.example            # Environment template
└── package.json
```

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for cloud hosting options.

## License

MIT
