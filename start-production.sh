#!/bin/bash

# Production Startup Script for Vlocity DataPack Manager
# This script sets up and starts the application in production mode

set -e

echo "🚀 Starting Vlocity DataPack Manager (Production Mode)..."

# Check if running in Docker
if [ -f /.dockerenv ]; then
    echo "📦 Running in Docker container"
    DOCKER_MODE=true
else
    echo "🖥️  Running on host system"
    DOCKER_MODE=false
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js >= 18.0.0"
    exit 1
fi

echo "✅ Node.js version $(node -v) detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm >= 8.0.0"
    exit 1
fi

echo "✅ npm version $(npm -v) detected"

# Check for environment file
if [ ! -f .env ]; then
    if [ -f env.template ]; then
        echo "⚠️  .env file not found. Creating from template..."
        cp env.template .env
        echo "📝 Please edit .env file with your configuration before running again."
        exit 1
    else
        echo "❌ No .env file or template found. Please create .env file with required configuration."
        exit 1
    fi
fi

echo "✅ Environment configuration found"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm ci --only=production
fi

if [ ! -d "client/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd client
    npm ci --only=production
    cd ..
fi

# Build client if needed
if [ ! -d "client/build" ]; then
    echo "🏗️  Building React application..."
    cd client
    npm run build
    cd ..
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs
mkdir -p temp
mkdir -p jobs
mkdir -p uploads

# Set proper permissions
chmod 755 logs temp jobs uploads

# Check database connectivity (if not in Docker)
if [ "$DOCKER_MODE" = false ]; then
    echo "🔍 Checking database connectivity..."
    
    # Check PostgreSQL
    if command -v psql &> /dev/null; then
        if psql -c "SELECT 1;" > /dev/null 2>&1; then
            echo "✅ PostgreSQL connection successful"
        else
            echo "⚠️  PostgreSQL connection failed - continuing anyway"
        fi
    else
        echo "⚠️  PostgreSQL client not found - skipping connection test"
    fi
    
    # Check Redis
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping > /dev/null 2>&1; then
            echo "✅ Redis connection successful"
        else
            echo "⚠️  Redis connection failed - continuing anyway"
        fi
    else
        echo "⚠️  Redis client not found - skipping connection test"
    fi
fi

# Check Vlocity CLI
if ! command -v vlocity &> /dev/null; then
    echo "⚠️  Vlocity CLI not found. Installing..."
    echo "📦 Installing Vlocity CLI globally..."
    npm install -g vlocity
    
    # Verify installation
    if command -v vlocity &> /dev/null; then
        echo "✅ Vlocity CLI installed successfully: $(vlocity --version)"
    else
        echo "❌ Vlocity CLI installation failed. Please install manually:"
        echo "   npm install -g vlocity"
        echo "   Or visit: https://developer.salesforce.com/docs/atlas.en-us.vlocity_cli.meta/vlocity_cli/"
        exit 1
    fi
else
    echo "✅ Vlocity CLI version $(vlocity --version) detected"
fi

# Check Salesforce CLI
if command -v sfdx &> /dev/null; then
    echo "✅ Salesforce CLI version $(sfdx --version) detected"
else
    echo "⚠️  Salesforce CLI not found. Please install sfdx CLI"
    echo "   Visit: https://developer.salesforce.com/tools/sfdxcli"
fi

# Check if PostgreSQL is available
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL not found. Installing PostgreSQL..."
    
    # Detect OS and install PostgreSQL
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux installation
        if command -v apt-get &> /dev/null; then
            # Ubuntu/Debian
            sudo apt-get update
            sudo apt-get install -y postgresql postgresql-contrib
        elif command -v yum &> /dev/null; then
            # CentOS/RHEL
            sudo yum install -y postgresql-server postgresql-contrib
            sudo postgresql-setup initdb
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS installation
        if command -v brew &> /dev/null; then
            brew install postgresql
            brew services start postgresql
        else
            echo "❌ Homebrew not found. Please install PostgreSQL manually:"
            echo "   Visit: https://www.postgresql.org/download/macosx/"
        fi
    else
        echo "❌ Unsupported OS. Please install PostgreSQL manually:"
        echo "   Visit: https://www.postgresql.org/download/"
    fi
else
    echo "✅ PostgreSQL version $(psql --version) detected"
fi

# Check if Redis is available (optional)
if ! command -v redis-server &> /dev/null; then
    echo "⚠️  Redis not found. Installing Redis (optional for caching)..."
    
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &> /dev/null; then
            sudo apt-get install -y redis-server
        elif command -v yum &> /dev/null; then
            sudo yum install -y redis
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install redis
        fi
    fi
else
    echo "✅ Redis version $(redis-server --version | head -n1) detected"
fi

# Set production environment
export NODE_ENV=production

# Start PostgreSQL and Redis services
echo "🚀 Starting required services..."

# Start PostgreSQL
if command -v psql &> /dev/null; then
    echo "📊 Starting PostgreSQL..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start postgresql 2>/dev/null || sudo service postgresql start 2>/dev/null
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start postgresql 2>/dev/null
    else
        pg_ctl start -D /usr/local/var/postgres 2>/dev/null || echo "⚠️  Could not start PostgreSQL automatically"
    fi
    sleep 2
    echo "✅ PostgreSQL started"
else
    echo "⚠️  PostgreSQL not available - continuing without database"
fi

# Start Redis (optional)
if command -v redis-server &> /dev/null; then
    echo "🔄 Starting Redis..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo systemctl start redis 2>/dev/null || sudo service redis-server start 2>/dev/null || redis-server --daemonize yes
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew services start redis 2>/dev/null || redis-server --daemonize yes
    else
        redis-server --daemonize yes
    fi
    sleep 1
    echo "✅ Redis started"
else
    echo "⚠️  Redis not available - continuing without caching"
fi

# Start the application
echo "🚀 Starting Vlocity DataPack Manager in production mode..."
echo "📊 Environment: $NODE_ENV"
echo "🔗 Application will be available at: http://localhost:3001"
echo "📈 Health check: http://localhost:3001/health"
echo "📊 Metrics: http://localhost:3001/metrics"

# Use PM2 for process management if available
if command -v pm2 &> /dev/null; then
    echo "🔄 Starting with PM2 process manager..."
    pm2 start server/index.js --name "vlocity-manager" --env production
    pm2 logs vlocity-manager --lines 50
else
    echo "🔄 Starting with Node.js directly..."
    node server/index.js
fi
