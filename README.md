# Migunani Motor - Sistem Omnichannel dengan WhatsApp Integration

> **Full-stack application** untuk manajemen toko suku cadang motor dengan integrasi WhatsApp, POS system, dan e-commerce.

## 🏗️ Tech Stack

### Backend
- **Framework**: Express.js + TypeScript
- **Database**: MySQL 8.0 (Docker)
- **ORM**: Sequelize
- **Real-time**: Socket.io
- **WhatsApp**: whatsapp-web.js
- **Auth**: JWT + bcrypt

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 (Mobile-First)
- **State**: Zustand
- **Real-time**: Socket.io Client

## 🚀 Quick Start

Panduan lengkap Docker Compose tersedia di:
- `DOCKER_COMPOSE_TUTORIAL.md`

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm/yarn/pnpm

### 1. Clone & Install Dependencies

```bash
# Install root dependencies (concurrently)
npm install

# Install backend dependencies
cd back_end
npm install

# Install frontend dependencies
cd ../front_end
npm install
cd ..
```

### 2. Setup Environment Variables

```bash
# Copy environment example
cp .env.example .env

# Edit .env if needed (default values should work)
```

### 3. Start Everything (One Command!)

```bash
# Option 1: Using bash script
./start.sh

# Option 2: Using npm
npm start
```

This will:
1. Start MySQL database in Docker
2. Wait for database to be ready
3. Ask if you want to run seeder (recommended for first time)
4. Start backend (port 5000) and frontend (port 3000) concurrently

### 4. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **MySQL**: localhost:3306

### 5. Login

#### Admin Account
- Email: `admin@migunani.com`
- Password: `admin123`
- Role: `super_admin`

#### Customer Account
- Email: `customer@migunani.com`
- Password: `customer123`
- Role: `customer`

## 📋 Available Scripts

### Root Level
```bash
npm run dev              # Run backend + frontend concurrently
npm run dev:backend      # Run backend only
npm run dev:frontend     # Run frontend only
npm run docker:up        # Start Docker database
npm run docker:down      # Stop Docker database
npm run docker:logs      # View MySQL logs
npm run seed             # Run database seeder
npm run setup            # Docker up + wait + seed
npm start                # Full startup (docker + dev)
```

### Bash Scripts
```bash
./start.sh               # Start everything (interactive)
./stop.sh                # Stop Docker database
```

## 🗂️ Project Structure

```
Migunani_Motor_Project/
├── back_end/                 # Express.js backend
│   ├── src/
│   │   ├── config/          # Database config
│   │   ├── controllers/     # Request handlers
│   │   ├── middleware/      # Auth middleware
│   │   ├── models/          # Sequelize models
│   │   ├── routes/          # API routes
│   │   ├── seeders/         # Database seeders
│   │   ├── services/        # WhatsApp service
│   │   └── server.ts        # Entry point
│   └── package.json
├── front_end/               # Next.js frontend
│   ├── app/                 # App Router pages
│   ├── components/          # React components
│   ├── lib/                 # Utilities & API client
│   ├── store/               # Zustand stores
│   └── package.json
├── docker-compose.yml       # Docker setup
├── start.sh                 # Startup script
├── stop.sh                  # Stop script
└── package.json             # Root package (concurrently)
```

## 🗄️ Database

### Docker MySQL

MySQL 8.0 running in Docker container:
- **Container**: `migunani_motor_db`
- **Port**: 3306
- **Database**: `migunani_motor_db`
- **User**: `root`
- **Password**: `password` (change in production!)

### Data Seeder

Database seeder creates:
- **2 Users** (1 admin, 1 customer)
- **7 Categories** (Ban, Oli, Kampas Rem, Lampu, Aki, Filter, Suku Cadang Mesin)
- **3 Suppliers**
- **18 Products** dengan harga dan stok realistis

Run seeder:
```bash
npm run seed
```

> **Note**: Seeder akan menghapus semua data existing (`force: true`). Hati-hati di production!

## 📱 Features

### Customer Features
- ✅ Product catalog dengan search & filter
- ✅ Shopping cart
- ✅ Checkout & payment proof upload
- ✅ Order tracking
- ✅ WhatsApp chat dengan bot
- ⬜ Mobile-optimized UI

### Admin Features
- ✅ Dashboard statistics
- ✅ Inventory management
- ✅ Order management
- ✅ WhatsApp chat admin panel
- ✅ POS system
- ✅ Finance reporting
- ⬜ Driver assignment

## 🔌 API Endpoints

### Public
- `GET /api/v1/catalog` - Get products
- `GET /api/v1/catalog/:id` - Get product detail

### Auth
- `POST /api/v1/auth/register` - Register
- `POST /api/v1/auth/login` - Login

### Cart (Auth Required)
- `GET /api/v1/cart` - Get cart
- `POST /api/v1/cart` - Add to cart
- `PATCH /api/v1/cart/item/:id` - Update quantity
- `DELETE /api/v1/cart/item/:id` - Remove item

### Orders (Auth Required)
- `POST /api/v1/orders/checkout` - Create order
- `GET /api/v1/orders/my-orders` - Get my orders
- `GET /api/v1/orders/:id` - Get order detail
- `POST /api/v1/orders/:id/proof` - Upload payment proof

### Admin (Admin Role Required)
- `GET /api/v1/admin/inventory/products` - Get all products
- `GET /api/v1/admin/list` - Get all orders
- `PATCH /api/v1/admin/:id/status` - Update order status
- `GET /api/v1/chat/sessions` - Get chat sessions
- ... and more

## 🛠️ Development

### Running Backend Only
```bash
cd back_end
npm run dev
```
Backend runs on http://localhost:5000

### Running Frontend Only
```bash
cd front_end
npm run dev
```
Frontend runs on http://localhost:3000

### Viewing Database
```bash
# Connect to MySQL
docker exec -it migunani_motor_db mysql -u root -ppassword migunani_motor_db

# Or view logs
npm run docker:logs
```

## 🐛 Troubleshooting

### Database Connection Error
```bash
# Restart Docker database
npm run docker:down
npm run docker:up

# Wait and retry
sleep 10
npm run seed
```

### Port Already in Use
```bash
# Find process using port 3000 or 5000
lsof -i :3000
lsof -i :5000

# Kill process
kill -9 <PID>
```

### WhatsApp QR Code
Backend will show QR code in terminal on first run. Scan with WhatsApp to connect.

## 📚 Next Steps

1. ✅ Frontend kerangka (mobile-first)
2. ✅ Docker database setup
3. ✅ Database seeder
4. ⬜ Implement remaining frontend pages (cart, checkout, admin)
5. ⬜ Add image upload functionality
6. ⬜ WhatsApp chat widget
7. ⬜ PWA configuration
8. ⬜ Production deployment

## 🤝 Contributing

Contributions are welcome! Please follow the mobile-first approach for frontend development.

## 📄 License

© 2026 Migunani Motor. All rights reserved.

---

**Need help?** Check the README files in `back_end/` and `front_end/` directories for more details.
