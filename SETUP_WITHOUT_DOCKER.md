# Setup Database tanpa Docker (Manual MySQL Installation)

Jika Docker tidak tersedia, Anda bisa install MySQL secara manual:

## Install MySQL 8.0

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
```

### Secure Installation
```bash
sudo mysql_secure_installation
```

## Create Database

```bash
# Login to MySQL
sudo mysql -u root -p

# Create database
CREATE DATABASE migunani_motor_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# Create user (optional)
CREATE USER 'migunani'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON migunani_motor_db.* TO 'migunani'@'localhost';
FLUSH PRIVILEGES;

# Exit
EXIT;
```

## Update .env

Update `/home/thouka/Migunani_Motor_Project/back_end/.env`:

```env
DB_HOST=localhost
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=migunani_motor_db
```

## Run Seeder

```bash
cd /home/thouka/Migunani_Motor_Project/back_end
npm run seed
```

## Start Application

```bash
# From root directory
cd /home/thouka/Migunani_Motor_Project
npm run dev
```

This will start both backend and frontend concurrently.

## Login Credentials

- **Admin**: `admin@migunani.com` / `admin123`
- **Customer**: `customer@migunani.com` / `customer123`
