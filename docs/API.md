# Zuci Car Wash CRM - API Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication
All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Response Format
All API responses follow this standard format:
```json
{
  "success": true|false,
  "message": "Response message",
  "data": {} // Optional, only included when returning data
}
```

## Authentication Endpoints

### POST /auth/login
Login user and get JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "user_id",
      "name": "User Name",
      "email": "user@example.com",
      "role": "admin|washer"
    }
  }
}
```

### GET /auth/me
Get current user information (requires authentication).

**Response:**
```json
{
  "success": true,
  "message": "User retrieved successfully",
  "data": {
    "id": "user_id",
    "name": "User Name",
    "email": "user@example.com",
    "role": "admin|washer"
  }
}
```

## Lead Management Endpoints

### GET /leads
Get all leads (requires authentication).

**Query Parameters:**
- `status` (optional): Filter by lead status
- `page` (optional): Page number for pagination
- `limit` (optional): Number of items per page

### POST /leads
Create a new lead (requires authentication).

**Request Body:**
```json
{
  "customerName": "John Doe",
  "phone": "1234567890",
  "email": "john@example.com",
  "address": "123 Main St",
  "serviceType": "Premium Wash",
  "scheduledDate": "2024-01-15T10:00:00Z"
}
```

### PUT /leads/:id
Update an existing lead (requires authentication).

### DELETE /leads/:id
Delete a lead (requires admin authentication).

## Washer Management Endpoints

### GET /washer
Get all washers (requires authentication).

### POST /washer
Create a new washer (requires admin authentication).

**Request Body:**
```json
{
  "name": "Washer Name",
  "phone": "1234567890",
  "email": "washer@example.com",
  "address": "Washer Address",
  "joiningDate": "2024-01-01"
}
```

### PUT /washer/:id
Update washer information (requires authentication).

## Reports Endpoints

### GET /reports
Get reports data (requires authentication).

**Query Parameters:**
- `startDate` (optional): Start date for report period
- `endDate` (optional): End date for report period
- `type` (optional): Report type (revenue, performance, etc.)

## Dashboard Endpoints

### GET /dashboard
Get dashboard statistics (requires authentication).

**Response:**
```json
{
  "success": true,
  "message": "Dashboard data retrieved successfully",
  "data": {
    "totalLeads": 150,
    "activeWashers": 12,
    "monthlyRevenue": 25000,
    "completedServices": 89
  }
}
```

## Error Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "errors": ["Detailed error messages"] // Optional array for validation errors
}
```