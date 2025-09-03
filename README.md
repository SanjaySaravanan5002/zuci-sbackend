# Zuci Car Wash CRM - Backend

A professional Node.js backend API for managing car wash operations, leads, washers, and reports.

## Features

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Lead Management**: Complete lead lifecycle management
- **Washer Management**: Track washer performance and assignments
- **Reports & Analytics**: Comprehensive reporting system
- **Dashboard**: Real-time business insights

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT
- **Environment**: dotenv

## Project Structure

```
zuci-backend/
├── config/          # Configuration files
├── controllers/     # Route controllers (future)
├── middleware/      # Custom middleware
├── models/          # Database models
├── routes/          # API routes
├── utils/           # Utility functions
├── tests/           # Test files (future)
├── docs/            # API documentation (future)
└── server.js        # Application entry point
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` file with required variables:
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   PORT=5000
   ```
4. Start the server:
   ```bash
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Leads
- `GET /api/leads` - Get all leads
- `POST /api/leads` - Create new lead
- `PUT /api/leads/:id` - Update lead
- `DELETE /api/leads/:id` - Delete lead

### Washers
- `GET /api/washer` - Get all washers
- `POST /api/washer` - Create new washer
- `PUT /api/washer/:id` - Update washer

### Reports
- `GET /api/reports` - Get reports data

### Dashboard
- `GET /api/dashboard` - Get dashboard statistics

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `PORT` | Server port (default: 5000) | No |

## Development

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon (if configured)

## License

Private - Zuci Car Wash CRM